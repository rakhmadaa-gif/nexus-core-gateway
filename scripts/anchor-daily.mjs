// anchor-daily.mjs — Merkle-anchor unanchored attestation_log rows on-chain.
// Usage: node anchor-daily.mjs [--include-today] [--dry-run]
// Needs env: SUPABASE_ACCESS_TOKEN, SUPABASE_ANON_KEY, POLYGON_PRIVATE_KEY.
// Anchors one Merkle root per UTC day-group of unanchored rows, then writes
// merkle_root/proof/anchor_tx/anchor_block back and records a PoA entry.
import { JsonRpcProvider, Wallet, Contract } from "ethers";
import { buildMerkle } from "./merkle.mjs";

const ANCHOR_ADDRESS = "0x3AC325c3FA803192A3E20e726b78F71654E2A02d";
const ANCHOR_ABI = [
  "function anchor(bytes32 root, uint64 day, uint32 count) external",
  "function anchoredAt(bytes32 root) view returns (uint256)",
];
const PROJECT = "xibzsthfrbomefnvbicb";
const REST = `https://${PROJECT}.supabase.co/rest/v1/attestation_log`;
const MGMT = `https://api.supabase.com/v1/projects/${PROJECT}/database/query`;
const POA = `https://${PROJECT}.supabase.co/functions/v1/hello-world/poa/record`;
const RPC_CANDIDATES = [
  process.env.POLYGON_RPC_URL,
  "https://polygon.drpc.org",
  "https://polygon-bor-rpc.publicnode.com",
  "https://1rpc.io/matic",
].filter(Boolean);

const args = process.argv.slice(2);
const INCLUDE_TODAY = args.includes("--include-today");
const DRY = args.includes("--dry-run");
const today = new Date().toISOString().slice(0, 10);

const anon = process.env.SUPABASE_ANON_KEY || "";
const mgmtToken = process.env.SUPABASE_ACCESS_TOKEN || "";
const pk = process.env.POLYGON_PRIVATE_KEY || "";

async function fetchUnanchored() {
  let url = `${REST}?merkle_root=is.null&select=id,day,struct_hash&order=day.asc&limit=10000`;
  if (!INCLUDE_TODAY) url += `&day=lt.${today}`;
  const r = await fetch(url, { headers: { apikey: anon, Authorization: `Bearer ${anon}` } });
  if (!r.ok) throw new Error(`rest ${r.status}: ${await r.text()}`);
  return r.json();
}

async function runSql(query) {
  const r = await fetch(MGMT, {
    method: "POST",
    headers: { Authorization: `Bearer ${mgmtToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`mgmt ${r.status}: ${t}`);
  return JSON.parse(t);
}

async function waitReceipt(provider, hash, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const rc = await provider.getTransactionReceipt(hash);
    if (rc && rc.status === 1) return rc;
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw new Error("receipt timeout");
}

const esc = (s) => String(s).replace(/'/g, "''");

// Recover anchor tx metadata via the public explorer (browser UA required —
// Blockscout Cloudflare-blocks bare clients). Returns { tx, block } or null.
async function findAnchorTx(root) {
  try {
    const r = await fetch(
      `https://polygon.blockscout.com/api/v2/addresses/${ANCHOR_ADDRESS}/transactions`,
      { headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36" } },
    );
    if (!r.ok) return null;
    const d = await r.json();
    const needle = root.toLowerCase().replace(/^0x/, "");
    for (const tx of d.items || []) {
      if (String(tx.raw_input || "").toLowerCase().includes(needle)) {
        return { tx: tx.hash, block: tx.block_number };
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function main() {
  const rows = await fetchUnanchored();
  if (!rows.length) {
    console.log(JSON.stringify({ anchored: 0, note: "no unanchored rows" }));
    return;
  }
  const byDay = {};
  for (const r of rows) (byDay[r.day] ||= []).push(r);
  // RPC failover: some free endpoints now classify fee-history/archive calls
  // as premium. Probe each candidate with a full fee-data round-trip and use
  // the first that answers cleanly.
  let provider = null;
  let rpcUsed = null;
  const probeErrors = [];
  for (const url of RPC_CANDIDATES) {
    try {
      const p = new JsonRpcProvider(url, 137, { staticNetwork: true });
      await p.getBlockNumber();
      await p.getFeeData();
      provider = p;
      rpcUsed = url;
      break;
    } catch (e) {
      probeErrors.push(`${url}: ${String(e.message || e).slice(0, 120)}`);
    }
  }
  if (!provider) throw new Error(`no usable RPC: ${probeErrors.join(" | ")}`);
  console.log(JSON.stringify({ rpc: rpcUsed }));
  const wallet = new Wallet(pk.startsWith("0x") ? pk : `0x${pk}`, provider);
  const anchor = new Contract(ANCHOR_ADDRESS, ANCHOR_ABI, wallet);
  const summary = [];
  for (const [day, dayRows] of Object.entries(byDay)) {
    const leaves = dayRows.map((r) => r.struct_hash);
    const { root, proofs } = buildMerkle(leaves);
    const dayNum = Number(day.replaceAll("-", ""));
    const onchain = await anchor.anchoredAt(root);
    if (onchain !== 0n) {
      // Self-heal: a previous run broadcast the anchor tx but died before the
      // DB write-back (e.g. transient RPC failure). Backfill merkle metadata
      // so the public proof endpoint stops reporting PENDING_ANCHOR.
      const anchoredAtIso = new Date(Number(onchain) * 1000).toISOString();
      const info = await findAnchorTx(root);
      let backfilled = 0;
      for (const r of dayRows) {
        const proof = proofs[r.struct_hash.toLowerCase()] || [];
        let set =
          `merkle_root='${esc(root)}', merkle_proof='${JSON.stringify(proof)}'::jsonb, anchored_at='${esc(anchoredAtIso)}'`;
        if (info) set += `, anchor_tx='${esc(info.tx)}', anchor_block=${info.block}`;
        await runSql(
          `UPDATE public.attestation_log SET ${set} WHERE id='${esc(r.id)}' AND merkle_root IS NULL;`,
        );
        backfilled++;
      }
      console.log(
        JSON.stringify({ day, root, skipped: "already anchored on-chain", backfilled, anchor_tx: info?.tx || null }),
      );
      continue;
    }
    if (DRY) {
      summary.push({ day, count: dayRows.length, root, dry_run: true });
      continue;
    }
    const tx = await anchor.anchor(root, dayNum, dayRows.length);
    const rc = await waitReceipt(provider, tx.hash);
    const blk = await provider.getBlock(rc.blockNumber);
    const anchoredAt = new Date(Number(blk.timestamp) * 1000).toISOString();
    // write back per-row proof + anchor metadata (single UPDATE per row)
    for (const r of dayRows) {
      const proof = proofs[r.struct_hash.toLowerCase()] || [];
      await runSql(
        `UPDATE public.attestation_log SET merkle_root='${esc(root)}', merkle_proof='${JSON.stringify(proof)}'::jsonb, anchor_tx='${esc(tx.hash)}', anchor_block=${rc.blockNumber}, anchored_at='${esc(anchoredAt)}' WHERE id='${esc(r.id)}';`,
      );
    }
    summary.push({ day, count: dayRows.length, root, tx: tx.hash, block: rc.blockNumber });
  }
  if (!DRY && summary.length) {
    await fetch(POA, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entity_id: "nexus-gateway",
        action_type: "attestation_merkle_anchor",
        payload: { contract: ANCHOR_ADDRESS, batches: summary },
        signature: "nexus-gateway/erc8004-636",
        status: "completed",
      }),
    }).catch(() => {});
  }
  console.log(JSON.stringify({ anchored: summary.length, batches: summary }, null, 1));
}

main().catch((e) => {
  console.error(JSON.stringify({ error: String(e.message || e) }));
  process.exit(1);
});
