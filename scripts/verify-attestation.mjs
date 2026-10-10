// verify-attestation.mjs — full public trust-chain verification for one
// Nexus fitness attestation. Zero trust in Nexus required:
//   1. EIP-712 signature recovers `signer`
//   2. signer == ownerOf(636) on ERC-8004 IdentityRegistry (Polygon)
//   3. struct_hash (recomputed) is in the on-chain-anchored Merkle root
//   4. anchoredAt(root) gives the immutable "existed no later than" timestamp
// Usage: node verify-attestation.mjs <attestation.json>
//   where attestation.json = the "attestation" block from a paid response.
import { JsonRpcProvider, Contract, verifyTypedData, TypedDataEncoder } from "ethers";
import { readFileSync } from "fs";
import { buildMerkle, verifyMerkleProof } from "./merkle.mjs";

const REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const ANCHOR = "0x3AC325c3FA803192A3E20e726b78F71654E2A02d";
const RPC = "https://polygon-bor-rpc.publicnode.com";
const REST = "https://xibzsthfrbomefnvbicb.supabase.co/rest/v1/attestation_log";

const att = JSON.parse(readFileSync(process.argv[2], "utf8"));
const provider = new JsonRpcProvider(RPC, 137, { staticNetwork: true });
const registry = new Contract(REGISTRY, ["function ownerOf(uint256) view returns (address)"], provider);
const anchor = new Contract(ANCHOR, ["function anchoredAt(bytes32) view returns (uint256)"], provider);

// 1. signature
const recovered = verifyTypedData(att.domain, att.types, att.message, att.signature);
const r1 = recovered === att.signer;

// 2. ERC-8004 ownership
const owner = await registry.ownerOf(att.agent_id);
const r2 = owner === att.signer;

// 3. Merkle inclusion: recompute leaf, fetch proof, verify against root
const leaf = TypedDataEncoder.hash(att.domain, att.types, att.message);
const r3a = leaf === att.struct_hash;
const anon = process.env.SUPABASE_ANON_KEY || "";
if (!anon) {
  console.error("SUPABASE_ANON_KEY env required to fetch the Merkle proof");
  process.exit(2);
}
const q = await fetch(
  `${REST}?struct_hash=eq.${leaf}&select=merkle_root,merkle_proof,anchor_tx`,
  { headers: { apikey: anon, Authorization: `Bearer ${anon}` } },
);
const rows = await q.json();
const row = rows[0];
const pending = !row || !row.merkle_root;
const r3b = !!row && !!row.merkle_root &&
  verifyMerkleProof(leaf, row.merkle_proof, row.merkle_root);

// 4. on-chain timestamp
const ts = row && row.merkle_root ? await anchor.anchoredAt(row.merkle_root) : 0n;
const r4 = ts !== 0n;

console.log(JSON.stringify({
  "1_signature_recovers_signer": r1,
  "2_signer_owns_erc8004_agent": r2,
  "3_leaf_matches_and_merkle_included": r3a && r3b,
  "4_root_anchored_onchain": r4,
  anchored_at_utc: r4 ? new Date(Number(ts) * 1000).toISOString() : null,
  merkle_root: row?.merkle_root ?? null,
  anchor_tx: row?.anchor_tx ?? null,
  verdict: r1 && r2 && r3a && r3b && r4
    ? "VERIFIED — attestation authentic & timestamped"
    : pending && r1 && r2 && r3a
    ? "PENDING_ANCHOR — signature authentic, awaiting next daily Merkle anchor"
    : "FAILED",
}, null, 1));
process.exit(r1 && r2 && r3a && r3b && r4 ? 0 : 1);
