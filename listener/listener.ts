// ============================================================================
// NEXUS PAYMENT LISTENER — standalone Node/TypeScript
// Polls Polygon PoS for USDC transfers → treasury, matches payment_intents,
// credits client_usage via confirm_payment_intent RPC.
// ============================================================================

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { JsonRpcProvider, formatUnits, getAddress, zeroPadValue } from "ethers";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const RPC_URL = process.env.POLYGON_RPC_URL || "https://polygon-rpc.com";
const TREASURY = (process.env.TREASURY_WALLET_ADDRESS || "").toLowerCase();
const POLL_MS = Number(process.env.POLL_INTERVAL_MS || 15000);
const FIRST_SCAN_LOOKBACK = 2000;
const CHUNK = 500;

const USDC_ADDRESS = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"; // native USDC, Polygon PoS
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

if (!SUPABASE_URL || !SUPABASE_KEY || !TREASURY) {
  console.error("Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TREASURY_WALLET_ADDRESS");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const provider = new JsonRpcProvider(RPC_URL, 137, { staticNetwork: true });

async function scanOnce(): Promise<void> {
  const latest = await provider.getBlockNumber();

  const { data: stateRow } = await supabase
    .from("chain_state").select("*").eq("key", "polygon_usdc_scan").maybeSingle();

  let fromBlock = stateRow?.value?.last_block
    ? stateRow.value.last_block + 1
    : Math.max(0, latest - FIRST_SCAN_LOOKBACK);

  if (fromBlock > latest) return;

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

  if (transfers.length === 0) {
    await saveCursor(latest);
    return;
  }

  const { data: intents } = await supabase
    .from("payment_intents").select("*").eq("status", "pending");

  for (const t of transfers) {
    const hit = (intents || []).find(
      (i) => BigInt(Math.round(Number(i.expected_amount) * 1e6)) === t.valueMicro,
    );
    if (hit) {
      const { data, error } = await supabase.rpc("confirm_payment_intent", {
        p_intent_id: hit.id,
        p_tx_hash: t.txHash,
        p_from_address: t.from,
        p_actual_amount: Number(formatUnits(t.valueMicro, 6)),
      });
      console.log(
        `[CONFIRM] ${hit.client_id} +${hit.credits} CRED | tx ${t.txHash} | rpc:`,
        error ? error.message : JSON.stringify(data),
      );
    } else {
      console.log(
        `[UNMATCHED] ${formatUnits(t.valueMicro, 6)} USDC from ${t.from} | tx ${t.txHash} — manual review`,
      );
    }
  }

  await supabase.from("payment_intents")
    .update({ status: "expired" })
    .eq("status", "pending")
    .lt("expires_at", new Date().toISOString());

  await saveCursor(latest);
}

async function saveCursor(block: number): Promise<void> {
  await supabase.from("chain_state").upsert({
    key: "polygon_usdc_scan",
    value: { last_block: block },
    updated_at: new Date().toISOString(),
  });
}

console.log(`Nexus payment listener started`);
console.log(`  Treasury : ${TREASURY}`);
console.log(`  RPC      : ${RPC_URL}`);
console.log(`  Interval : ${POLL_MS}ms`);

const loop = async () => {
  try {
    await scanOnce();
  } catch (err) {
    console.error("[SCAN ERROR]", err instanceof Error ? err.message : err);
  }
};

await loop();
setInterval(loop, POLL_MS);
