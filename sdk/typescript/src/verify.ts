/**
 * Zero-trust attestation verification (SDK v2).
 * ==============================================
 * Two layers:
 *  1. fetchAttestationProof() — pull the public proof package from the
 *     gateway (EIP-712 block + Merkle proof + anchor TX) — free, no auth.
 *  2. verifyAttestationLocally() — recover the EIP-712 signer with ethers
 *     and compare against the expected ERC-8004 #636 owner. No network.
 */

import { verifyTypedData } from "ethers";
import type { FitnessAttestation } from "./fitness";

export const EXPECTED_SIGNER = "0x80963791cE7cB9c5d580Fe638C39Fdd9ffdaE2d5";
export const PROOF_BASE_URL =
  "https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world";

export interface AttestationProofPackage {
  [key: string]: unknown;
}

export async function fetchAttestationProof(
  structHash: string,
  baseUrl?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AttestationProofPackage> {
  const url = `${(baseUrl ?? PROOF_BASE_URL).replace(/\/+$/, "")}/attestations/proof?hash=${structHash}`;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    throw new Error(`Proof fetch failed (HTTP ${res.status}) for hash ${structHash}. Fresh attestations may not be Merkle-anchored yet (daily anchor cron) — status PENDING_ANCHOR is expected for <24h attestations.`);
  }
  return (await res.json()) as AttestationProofPackage;
}

export interface LocalVerifyResult {
  recoveredSigner: string;
  expectedSigner: string;
  valid: boolean;
}

/** Recover the EIP-712 signer from a fitness attestation block. Pure, offline. */
export function verifyAttestationLocally(
  attestation: FitnessAttestation,
  expectedSigner: string = EXPECTED_SIGNER,
): LocalVerifyResult {
  // Strip EIP712Domain from types if the server included it — ethers v6
  // takes the domain separately.
  const types: Record<string, Array<{ name: string; type: string }>> = {};
  for (const [k, v] of Object.entries(attestation.types ?? {})) {
    if (k === "EIP712Domain") continue;
    types[k] = v;
  }
  const recovered = verifyTypedData(attestation.domain, types, attestation.message, attestation.signature);
  return {
    recoveredSigner: recovered,
    expectedSigner,
    valid: recovered.toLowerCase() === expectedSigner.toLowerCase(),
  };
}
