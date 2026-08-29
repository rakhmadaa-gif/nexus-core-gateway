// ============================================================================
// NEXUS PAYMENT GATEWAY — Supabase Edge Function
// v1.1.0 — USDC (Polygon PoS) top-up → auto-credit CRED ($1 = 100 CRED)
//          + Deno.cron self-scan every minute (no pg_net needed)
// ============================================================================
//
// Endpoints:
//   POST {action:"create_intent", usd_amount}   header: x-client-id  → deposit instructions
//   GET  ?intent_id=...                          header: x-client-id  → intent status
//   POST {action:"scan"}                         header: x-scan-secret → one scan cycle (manual)
//   (auto) Deno.cron "scan-usdc" every 1 min    → same scan, runs inside this function
//
// Required Edge secrets:
//   TREASURY_WALLET_ADDRESS  — existing MetaMask address receiving USDC
//   SCAN_SECRET              — shared secret protecting the scan action (manual trigger)
// Optional:
//   POLYGON_RPC_URL          — default https://polygon-rpc.com
//   USDC_CONTRACT            — default native USDC on Polygon PoS
//
// Surge pricing note: this function credits gross CRED only. Surge pricing
// ($300 / $450 / $800 → 30,000 / 45,000 / 80,000 CRED) is applied by the
// main gateway at request time — any top-up amount is accepted here.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  JsonRpcProvider,
  formatUnits,
  getAddress,
  zeroPadValue,
} from "npm:ethers@6.13.4";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CREDIT_RATE = 100;            // $1 USDC = 100 CRED
const INTENT_TTL_MIN = 60;          // intent expires after 60 minutes
const MAX_USD = 10000;              // sanity cap per intent
const FIRST_SCAN_LOOKBACK = 2000;   // blocks scanned on first run
const CHUNK = 500;                  // getLogs chunk size
const POLYGON_CHAIN_ID = 137;

const USDC_ADDRESS = (Deno.env.get("USDC_CONTRACT") ||
  "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359").toLowerCase(); // native USDC, Polygon PoS

const TREASURY = (Deno.env.get("TREASURY_WALLET_ADDRESS") || "").toLowerCase();
const RPC_URL = Deno.env.get("POLYGON_RPC_URL") || "https://polygon-bor-rpc.publicnode.com";
const SCAN_SECRET = Deno.env.get("SCAN_SECRET") || "";

// keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-id, x-scan-secret",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function supabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
  );
}

// ---------------------------------------------------------------------------
// create_intent — allocate a unique 4-decimal tag, return deposit instructions
// ---------------------------------------------------------------------------

async function createIntent(clientId: string, usdAmount: number) {
  if (!TREASURY) {
    return jsonResponse({ error: "TREASURY_WALLET_ADDRESS not configured" }, 500);
  }
  if (!Number.isFinite(usdAmount) || usdAmount <= 0 || usdAmount > MAX_USD) {
    return jsonResponse({ error: `usd_amount must be > 0 and <= ${MAX_USD}` }, 400);
  }

  const credits = Math.round(usdAmount * CREDIT_RATE);
  const supabase = supabaseAdmin();

  for (let attempt = 0; attempt < 10; attempt++) {
    const tag = 1 + Math.floor(Math.random() * 9999);
    // Work in units of 1e-4 dollars to avoid float drift
    const expectedUnits = Math.round(usdAmount * 10000) + tag;
    const expected = expectedUnits / 10000;

    const { data, error } = await supabase
      .from("payment_intents")
      .insert([{
        client_id: clientId,
        usd_amount: usdAmount,
        tag,
        expected_amount: expected,
        credits,
        deposit_address: TREASURY,
        expires_at: new Date(Date.now() + INTENT_TTL_MIN * 60000).toISOString(),
      }])
      .select()
      .single();

    if (!error) {
      return jsonResponse({
        status: "pending",
        intent_id: data.id,
        deposit: {
          chain: "polygon-pos",
          chain_id: POLYGON_CHAIN_ID,
          token: "USDC",
          token_contract: USDC_ADDRESS,
          to_address: TREASURY,
          exact_amount: expected.toFixed(4),
        },
        credits_on_confirm: credits,
        rate: "$1 USDC = 100 CRED",
        expires_at: data.expires_at,
        instructions:
          `Send EXACTLY ${expected.toFixed(4)} USDC on Polygon PoS to ${TREASURY}. ` +
          `The 4-decimal amount identifies your payment. Credited automatically within ~1 minute.`,
      });
    }
    if (error.code !== "23505") { // unique violation → tag taken, retry
      return jsonResponse({ error: "Failed to create intent", detail: error.message }, 500);
    }
  }
  return jsonResponse({ error: "No free payment tag, please retry" }, 503);
}

// ---------------------------------------------------------------------------
// scan — one cycle: fetch USDC transfers → treasury, match, confirm, credit
// ---------------------------------------------------------------------------

async function runScan() {
  if (!TREASURY) return jsonResponse({ error: "TREASURY_WALLET_ADDRESS not configured" }, 500);

  const supabase = supabaseAdmin();
  const provider = new JsonRpcProvider(RPC_URL, POLYGON_CHAIN_ID, { staticNetwork: true });
  const latest = await provider.getBlockNumber();

  const { data: stateRow } = await supabase
    .from("chain_state").select("*").eq("key", "polygon_usdc_scan").maybeSingle();

  let fromBlock = stateRow?.value?.last_block
    ? stateRow.value.last_block + 1
    : Math.max(0, latest - FIRST_SCAN_LOOKBACK);

  if (fromBlock > latest) {
    return jsonResponse({ ok: true, scanned: 0, matched: 0, latest_block: latest });
  }

  const toPadded = zeroPadValue(TREASURY, 32);
  const transfers: { from: string; valueMicro: bigint; txHash: string }[] = [];

  for (let start = fromBlock; start <= latest; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, latest);
    const logs = await provider.getLogs({
      address: USDC_ADDRESS,
      topics: [TRANSFER_TOPIC, null, toPadded],
      fromBlock: start,
      toBlock: end,
    });
    for (const log of logs) {
      transfers.push({
        from: getAddress("0x" + log.topics[1].slice(26)),
        valueMicro: BigInt(log.data),
        txHash: log.transactionHash,
      });
    }
  }

  const { data: intents } = await supabase
    .from("payment_intents").select("*").eq("status", "pending");

  const matched: unknown[] = [];
  const unmatched: unknown[] = [];

  for (const t of transfers) {
    const hit = (intents || []).find((i) =>
      BigInt(Math.round(Number(i.expected_amount) * 1e6)) === t.valueMicro
    );
    if (hit) {
      const { data: rpcRes } = await supabase.rpc("confirm_payment_intent", {
        p_intent_id: hit.id,
        p_tx_hash: t.txHash,
        p_from_address: t.from,
        p_actual_amount: Number(formatUnits(t.valueMicro, 6)),
      });
      matched.push({ tx: t.txHash, client_id: hit.client_id, credits: hit.credits, result: rpcRes });
    } else {
      unmatched.push({ tx: t.txHash, amount: formatUnits(t.valueMicro, 6), from: t.from });
    }
  }

  // Expire stale intents
  await supabase.from("payment_intents")
    .update({ status: "expired" })
    .eq("status", "pending")
    .lt("expires_at", new Date().toISOString());

  // Save cursor
  await supabase.from("chain_state").upsert({
    key: "polygon_usdc_scan",
    value: { last_block: latest },
    updated_at: new Date().toISOString(),
  });

  return jsonResponse({
    ok: true,
    latest_block: latest,
    transfers_found: transfers.length,
    matched: matched.length,
    unmatched,
    results: matched,
  });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(req.url);

  // GET ?ping=1 → keep-alive + trigger scan (no secret needed, safe)
  if (req.method === "GET" && url.searchParams.get("ping") === "1") {
    try {
      const res = await runScan();
      const body = await res.text();
      return jsonResponse({ ok: true, trigger: "ping", scan: JSON.parse(body) });
    } catch (err) {
      return jsonResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // GET → intent status (requires x-client-id)
  if (req.method === "GET") {
    const clientId = req.headers.get("x-client-id");
    if (!clientId) {
      return jsonResponse({ error: "MISSING_CLIENT_ID", message: "x-client-id header required" }, 400);
    }
    const intentId = url.searchParams.get("intent_id");
    if (!intentId) {
      return jsonResponse({ error: "Missing intent_id query param" }, 400);
    }
    const { data, error } = await supabaseAdmin()
      .from("payment_intents").select("*")
      .eq("id", intentId).eq("client_id", clientId).single();
    if (error || !data) {
      return jsonResponse({ error: "Intent not found" }, 404);
    }
    return jsonResponse({
      intent_id: data.id,
      status: data.status,
      credits: data.credits,
      expected_amount: data.expected_amount,
      tx_hash: data.tx_hash,
      expires_at: data.expires_at,
    });
  }

  // POST → route by body.action
  let body: { action?: string; usd_amount?: number };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (body.action === "scan") {
    if (!SCAN_SECRET || req.headers.get("x-scan-secret") !== SCAN_SECRET) {
      return jsonResponse({ error: "FORBIDDEN", message: "Invalid x-scan-secret" }, 403);
    }
    try {
      return await runScan();
    } catch (err) {
      return jsonResponse({ error: "Scan failed", detail: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  if (body.action === "create_intent") {
    const clientId = req.headers.get("x-client-id");
    if (!clientId) {
      return jsonResponse({ error: "MISSING_CLIENT_ID", message: "x-client-id header required" }, 400);
    }
    return await createIntent(clientId, Number(body.usd_amount));
  }

  return jsonResponse({ error: "Unknown action", valid_actions: ["create_intent", "scan"] }, 400);
}

// ---------------------------------------------------------------------------
// Auto-scan: register Deno.cron inside serve() so it doesn't crash on cold start
// ---------------------------------------------------------------------------

let cronRegistered = false;

async function mainHandler(req: Request): Promise<Response> {
  if (!cronRegistered) {
    try {
      Deno.cron("scan-usdc", "* * * * *", async () => {
        try {
          const res = await runScan();
          const body = await res.text();
          console.log(`[cron scan-usdc] ${body}`);
        } catch (err) {
          console.error("[cron scan-usdc] ERROR:", err instanceof Error ? err.message : err);
        }
      });
      cronRegistered = true;
      console.log("[payment-gateway] Deno.cron registered — scan every 1 min");
    } catch (err) {
      console.warn("[payment-gateway] Deno.cron not available, manual scan only:", err);
    }
  }
  return handler(req);
}

Deno.serve(mainHandler);
