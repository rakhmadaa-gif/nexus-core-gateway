/**
 * Nexus Fitness Attestation client (SDK v2).
 * ==========================================
 * Factual dependency fitness: GHSA/CVE advisories (OSV), license, freshness,
 * CycloneDX SBOM, deterministic score 0-100, EIP-712 signed attestation
 * (ERC-8004 agent #636), Merkle-anchored public proofs. legal_weight: 0.
 *
 * Endpoint: POST {baseUrl}/x402/fitness — $0.05 USDC (5 CRED) per call,
 * max 25 packages per call. Batching is SERIAL by design (spend control +
 * server politeness).
 */

import { NexusError } from "./client";
import type { FitnessPackageInput } from "./lockfile";

export const FITNESS_DEFAULT_BASE_URL =
  "https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world";
export const FITNESS_BATCH_MAX = 25;
export const FITNESS_PRICE_USDC = 0.05;
export const FITNESS_DEFAULT_TIMEOUT_MS = 60_000;

// -- response types (mirrors live v5.17.0 shape) --------------------------------

export interface FitnessAdvisory {
  package: string;
  id: string;
  summary: string;
  severity_class: string;
  published: string;
  url: string;
  cvss_vector: string | null;
  severity_label: string | null;
  exposure_days?: number;
}

export interface FitnessFacts {
  advisories: FitnessAdvisory[];
  advisory_counts: { critical: number; high: number; total: number };
  license: string | null;
  license_source: string;
  last_commit_days: number | null;
  stars: number | null;
}

export interface FitnessData {
  attestation_version: string;
  attested_at: string;
  subject: Record<string, unknown>;
  facts: FitnessFacts;
  score: number;
  score_formula: string;
  exposure_window: unknown[];
  sbom: Record<string, unknown>; // CycloneDX 1.5
  legal_weight: 0;
  disclaimer: string;
  erc8004: { registry: string; sibling_agent_id: number };
  cache?: Record<string, unknown>;
}

export interface FitnessAttestation {
  scheme: string;
  domain: { name: string; version: string; chainId: number };
  types: Record<string, Array<{ name: string; type: string }>>;
  message: {
    serviceType: string;
    subjectHash: string;
    resultHash: string;
    score: number;
    issuedAt: string;
    agentId: number;
    registry: string;
  };
  struct_hash: string;
  signature: string;
  signer: string;
  verify?: unknown;
  legal_weight: 0;
}

export interface FitnessResponse {
  status: string;
  payload_id: string;
  timestamp: string;
  service_type: string;
  data: FitnessData;
  metadata: {
    node_id: string;
    version: string;
    latency_ms: number;
    credits_charged: number;
  };
  attestation?: FitnessAttestation;
}

// -- single call ----------------------------------------------------------------

export interface AttestFitnessOptions {
  clientId: string;
  packages?: FitnessPackageInput[];
  repo?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * One fitness attestation call (≤25 packages). Throws NexusError on
 * 402 (insufficient credits — payload carries the x402 envelope), 400/422
 * (validation, charged 0), or network/timeout errors.
 */
export async function attestFitness(opts: AttestFitnessOptions): Promise<FitnessResponse> {
  const base = (opts.baseUrl ?? FITNESS_DEFAULT_BASE_URL).replace(/\/+$/, "");
  const url = `${base}/x402/fitness`;
  const body: Record<string, unknown> = {};
  if (opts.repo) body.repo = opts.repo;
  if (opts.packages && opts.packages.length > 0) {
    if (opts.packages.length > FITNESS_BATCH_MAX) {
      throw new Error(`Too many packages in one call: ${opts.packages.length} > ${FITNESS_BATCH_MAX}. Use attestFitnessBatched().`);
    }
    body.packages = opts.packages;
  }
  if (Object.keys(body).length === 0) {
    throw new Error("Provide packages and/or repo.");
  }

  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": opts.clientId,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? FITNESS_DEFAULT_TIMEOUT_MS),
  });

  let json: Record<string, unknown> | null = null;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    /* non-JSON body */
  }

  if (!res.ok) {
    const errCode = String((json as Record<string, unknown> | null)?.error ?? "");
    const message =
      res.status === 402
        ? `Payment required (402): insufficient credits for client-id "${opts.clientId}". Top up via \`npx nexus-gateway-sdk@2 topup --amount 5 --client-id ${opts.clientId}\` (1 USDC = 100 CRED; fitness = 5 CRED/call).`
        : `Fitness attestation failed (HTTP ${res.status}${errCode ? `: ${errCode}` : ""})`;
    throw new NexusError(message, res.status, json ?? {});
  }
  return json as unknown as FitnessResponse;
}

// -- batching --------------------------------------------------------------------

export function chunkPackages(packages: FitnessPackageInput[], size: number = FITNESS_BATCH_MAX): FitnessPackageInput[][] {
  const out: FitnessPackageInput[][] = [];
  for (let i = 0; i < packages.length; i += size) out.push(packages.slice(i, i + size));
  return out;
}

export interface MergedFitnessResult {
  batches: FitnessResponse[];
  /** Worst-case (minimum) score across scanned batches — honest aggregation. */
  score: number;
  critical_count: number;
  high_count: number;
  total_advisories: number;
  advisories: FitnessAdvisory[];
  attestation_hashes: string[];
  proof_urls: string[];
  credits_charged: number;
  cache_hits: number;
  /** true if maxSpendUsdc stopped scanning before all batches */
  truncated: boolean;
  unscanned_packages: number;
}

export interface AttestFitnessBatchedOptions extends AttestFitnessOptions {
  /** Spend ceiling in USDC. Each call costs $0.05. Default: no ceiling. */
  maxSpendUsdc?: number;
  /** Progress callback after each batch. */
  onBatch?: (info: { batchIndex: number; totalBatches: number; response: FitnessResponse }) => void;
}

/**
 * Serial batching for >25 packages. Each batch gets its own signed
 * attestation. Merged score = minimum across batches (worst-case).
 */
export async function attestFitnessBatched(opts: AttestFitnessBatchedOptions): Promise<MergedFitnessResult> {
  const packages = opts.packages ?? [];
  const batches = chunkPackages(packages);
  const maxCalls =
    opts.maxSpendUsdc !== undefined ? Math.max(0, Math.floor(opts.maxSpendUsdc / FITNESS_PRICE_USDC)) : batches.length;

  const scanned: FitnessResponse[] = [];
  for (let i = 0; i < batches.length && i < maxCalls; i++) {
    const response = await attestFitness({
      ...opts,
      packages: batches[i],
      repo: i === 0 ? opts.repo : undefined, // repo metadata only on first batch
    });
    scanned.push(response);
    opts.onBatch?.({ batchIndex: i, totalBatches: batches.length, response });
  }

  const unscanned = packages.slice(scanned.length * FITNESS_BATCH_MAX);
  const advisories = scanned.flatMap((r) => r.data.facts.advisories ?? []);
  const counts = scanned.map((r) => r.data.facts.advisory_counts);
  const base = (opts.baseUrl ?? FITNESS_DEFAULT_BASE_URL).replace(/\/+$/, "");
  const hashes = scanned.map((r) => r.attestation?.struct_hash ?? "").filter(Boolean);

  return {
    batches: scanned,
    score: scanned.length > 0 ? Math.min(...scanned.map((r) => r.data.score)) : 0,
    critical_count: counts.reduce((a, c) => a + (c?.critical ?? 0), 0),
    high_count: counts.reduce((a, c) => a + (c?.high ?? 0), 0),
    total_advisories: advisories.length,
    advisories,
    attestation_hashes: hashes,
    proof_urls: hashes.map((h) => `${base}/attestations/proof?hash=${h}`),
    credits_charged: scanned.reduce((a, r) => a + (r.metadata?.credits_charged ?? 0), 0),
    cache_hits: scanned.filter((r) => (r.data.cache as { hit?: boolean } | undefined)?.hit === true).length,
    truncated: scanned.length < batches.length,
    unscanned_packages: unscanned.length,
  };
}

/** Public zero-trust proof URL for one attestation struct hash. */
export function proofUrl(baseUrl: string, structHash: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/attestations/proof?hash=${structHash}`;
}
