// Canonical Merkle tree for Nexus attestation batches.
// OZ-style: leaves are sorted, pairs are hashed commutatively (sorted),
// an odd leaf is paired with itself. Leaf = EIP-712 struct hash (32-byte hex).
import { concat, keccak256 } from "ethers";

export function hashPair(a, b) {
  const [x, y] = a.toLowerCase() <= b.toLowerCase() ? [a, b] : [b, a];
  return keccak256(concat([x, y]));
}

// Returns { root, proofs } where proofs maps leaf -> array of sibling hashes.
export function buildMerkle(leaves) {
  if (!leaves.length) throw new Error("empty leaves");
  const sorted = [...new Set(leaves.map((l) => l.toLowerCase()))].sort();
  const layers = [sorted];
  while (layers[layers.length - 1].length > 1) {
    const cur = layers[layers.length - 1];
    const next = [];
    for (let i = 0; i < cur.length; i += 2) {
      const a = cur[i];
      const b = i + 1 < cur.length ? cur[i + 1] : cur[i];
      next.push(hashPair(a, b));
    }
    layers.push(next);
  }
  const proofs = {};
  for (const leaf of sorted) {
    const proof = [];
    let idx = layers[0].indexOf(leaf);
    for (let d = 0; d < layers.length - 1; d++) {
      const layer = layers[d];
      const sib = idx % 2 === 0 ? idx + 1 : idx - 1;
      proof.push(sib < layer.length ? layer[sib] : layer[idx]);
      idx = Math.floor(idx / 2);
    }
    proofs[leaf] = proof;
  }
  return { root: layers[layers.length - 1][0], leaves: sorted, proofs };
}

export function verifyMerkleProof(leaf, proof, root) {
  let acc = leaf.toLowerCase();
  for (const sib of proof) acc = hashPair(acc, sib.toLowerCase());
  return acc === root.toLowerCase();
}
