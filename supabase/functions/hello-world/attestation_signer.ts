// ============================================================================
// ATTESTATION SIGNER (v5.10.0) — ERC-8004 signed fitness attestations
// ----------------------------------------------------------------------------
// Every paid fitness-suite response (fitness_attestation / fitness_lite /
// fitness_full — peer-check bills as fitness_attestation) carries an EIP-712
// signature over a canonical attestation message, signed by the wallet that
// owns ERC-8004 Agent #636 on the IdentityRegistry (Polygon).
//
// Verification chain (fully public, no trust in Nexus required):
//   1. recover signer from signature (verifyTypedData)
//   2. signer must equal attestation.signer
//   3. signer must equal ownerOf(636) on ERC8004_REGISTRY (on-chain read)
//
// legal_weight: 0 — the signature attests ORIGIN and INTEGRITY of the facts,
// not their legal meaning.
// ============================================================================

import {
  keccak256,
  Signature,
  SigningKey,
  toUtf8Bytes,
  TypedDataEncoder,
  Wallet,
} from "npm:ethers@6";

export const ERC8004_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
export const ERC8004_AGENT_ID = 636;

export const ATTESTATION_DOMAIN = {
  name: "Nexus Fitness Attestation",
  version: "1",
  chainId: 137,
} as const;

export const ATTESTATION_TYPES = {
  FitnessAttestation: [
    { name: "serviceType", type: "string" },
    { name: "subjectHash", type: "bytes32" },
    { name: "resultHash", type: "bytes32" },
    { name: "score", type: "uint256" },
    { name: "issuedAt", type: "uint256" },
    { name: "agentId", type: "uint256" },
    { name: "registry", type: "address" },
  ],
} as const;

// Service types whose successful responses get signed.
export const ATTESTED_SERVICE_TYPES: ReadonlySet<string> = new Set([
  "fitness_attestation", // base fitness ($0.05) AND peer-check ($0.05)
  "fitness_lite", // gas efficiency rank ($1.25)
  "fitness_full", // exploitability + source-match ($2.25)
]);

/**
 * Normalize a private key from env/secrets storage: ethers v6 requires
 * 0x-prefixed hex, but secrets have been stored both ways (a missing 0x
 * silently broke pull_payment + x402 settlement once). Accept both.
 */
export function normalizePrivateKey(raw: string): string {
  const k = (raw || "").trim();
  if (/^[0-9a-fA-F]{64}$/.test(k)) return "0x" + k;
  return k;
}

/** Deterministic JSON: recursive sort-keys stringify (no whitespace). */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  const o = v as Record<string, unknown>;
  return "{" + Object.keys(o).sort().map((k) =>
    JSON.stringify(k) + ":" + canonicalJson(o[k])
  ).join(",") + "}";
}

export interface AttestationMessage {
  serviceType: string;
  subjectHash: string;
  resultHash: string;
  score: number;
  issuedAt: number;
  agentId: number;
  registry: string;
}

function pickScore(data: Record<string, unknown>): number {
  const s = data.score ?? data.composite_score ?? data.fitness_score;
  return typeof s === "number" && Number.isFinite(s) ? Math.round(s) : 0;
}

export function buildAttestationMessage(
  serviceType: string,
  data: Record<string, unknown>,
  issuedAt?: number,
): AttestationMessage {
  const subject = data.attested_subject ?? data.subject ?? serviceType;
  const subjectHash = keccak256(
    toUtf8Bytes(typeof subject === "string" ? subject : canonicalJson(subject)),
  );
  const resultHash = keccak256(toUtf8Bytes(canonicalJson(data)));
  return {
    serviceType,
    subjectHash,
    resultHash,
    score: pickScore(data),
    issuedAt: issuedAt ?? Math.floor(Date.now() / 1000),
    agentId: ERC8004_AGENT_ID,
    registry: ERC8004_REGISTRY,
  };
}

/**
 * Sign a fitness attestation. Returns the attestation block for the M2M
 * envelope, or null when no signing key is configured (non-fatal: the
 * response still succeeds, it just carries no attestation).
 * Synchronous — safe to call inside m2mSuccess without async refactor.
 */
export function signFitnessAttestation(
  serviceType: string,
  data: Record<string, unknown>,
  privateKey: string,
): Record<string, unknown> | null {
  privateKey = normalizePrivateKey(privateKey);
  if (!privateKey) return null;
  try {
    const message = buildAttestationMessage(serviceType, data);
    const digest = TypedDataEncoder.hash(
      ATTESTATION_DOMAIN,
      ATTESTATION_TYPES,
      message,
    );
    const signature = Signature.from(new SigningKey(privateKey).sign(digest))
      .serialized;
    const signer = new Wallet(privateKey).address;
    return {
      scheme: "eip712",
      domain: ATTESTATION_DOMAIN,
      types: ATTESTATION_TYPES,
      message,
      signature,
      signer,
      agent_id: ERC8004_AGENT_ID,
      registry: ERC8004_REGISTRY,
      verify:
        "verifyTypedData(domain, types, message, signature) must recover signer; signer must equal ownerOf(636) on registry (Polygon)",
      legal_weight: 0,
    };
  } catch (_) {
    return null; // signing failure must never break a paid response
  }
}
