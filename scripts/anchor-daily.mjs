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
const RPC = "https://polygon-bor-rpc.publicnode.com";

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

async function main() {
  const rows = await fetchUnanchored();
  if (!rows.length) {
    console.log(JSON.stringify({ anchored: 0, note: "no unanchored rows" }));
    return;
  }
  const byDay = {};
  for (const r of rows) (byDay[r.day] ||= []).push(r);
  const provider = new JsonRpcProvider(RPC, 137, { staticNetwork: true });
  const wallet = new Wallet(pk.startsWith("0x") ? pk : `0x${pk}`, provider);
  const anchor = new Contract(ANCHOR_ADDRESS, ANCHOR_ABI, wallet);
  const summary = [];
  for (const [day, dayRows] of Object.entries(byDay)) {
    const leaves = dayRows.map((r) => r.struct_hash);
    const { root, proofs } = buildMerkle(leaves);
    const dayNum = Number(day.replaceAll("-", ""));
    const onchain = await anchor.anchoredAt(root);
    if (onchain !== 0n) {
      console.log(JSON.stringify({ day, root, skipped: "already anchored on-chain" }));
      continue;
    }
    if (DRY) {
      summary.push({ day, count: dayRows.length, root, dry_run: true });
      continue;
    }
    const tx = await anchor.anchor(root, dayNum, dayRows.length);
    const rc = await waitReceipt(provider, tx.hash);
    // write back per-row proof + anchor metadata (single UPDATE per row)
    for (const r of dayRows) {
      const proof = proofs[r.struct_hash.toLowerCase()] || [];
      await runSql(
        `UPDATE public.attestation_log SET merkle_root='${esc(root)}', merkle_proof='${JSON.stringify(proof)}'::jsonb, anchor_tx='${esc(tx.hash)}', anchor_block=${rc.blockNumber} WHERE id='${esc(r.id)}';`,
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
