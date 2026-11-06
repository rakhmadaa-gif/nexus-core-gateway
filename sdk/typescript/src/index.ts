/**
 * Nexus Gateway TypeScript SDK v2
 * ================================
 * M2M Legal-Code Services for Web3 + Web2 Dependency Fitness Attestation.
 *
 * v2 additions:
 *  - attestFitness() / attestFitnessBatched() — factual dependency fitness
 *    (GHSA/CVE via OSV, license, freshness, CycloneDX SBOM, deterministic
 *    score, EIP-712 signed attestation, Merkle-anchored public proofs).
 *  - parseLockfile() — 7 lockfile formats, pure, zero-dep.
 *  - Subpaths: "./topup" (EIP-712 USDC permit top-up CLI core),
 *    "./verify" (zero-trust proof verification), "./cli" (bin).
 *
 * @example
 * ```typescript
 * import { attestFitnessBatched, parseLockfile, preparePackages, toFitnessPayload } from "nexus-gateway-sdk";
 *
 * const parsed = parseLockfile("package-lock.json", fs.readFileSync("package-lock.json", "utf8"));
 * const prep = preparePackages(parsed.packages, 250);
 * const merged = await attestFitnessBatched({
 *   clientId: "my-ci-client",
 *   packages: toFitnessPayload(prep.packages),
 *   maxSpendUsdc: 0.5,
 * });
 * console.log(merged.score, merged.proof_urls);
 * ```
 */

export { NexusClient, NexusError } from "./client";
export type { NexusClientOptions, DryRunOptions, ServiceResponse } from "./client";
export { createNexusTools, createNexusVercelTools } from "./langchain";
export type { ToolLike, NexusToolOptions } from "./langchain";

export {
  parseLockfile,
  detectLockfileFormat,
  dedupePackages,
  mergePackageLists,
  filterRuntimePackages,
  sortPackagesDeterministic,
  capPackages,
  toFitnessPayload,
  preparePackages,
  LOCKFILE_MAX_BYTES,
  PACKAGES_MAX,
} from "./lockfile";
export type { ResolvedPackage, LockfileParseResult, VersionSource, FitnessPackageInput } from "./lockfile";

export {
  attestFitness,
  attestFitnessBatched,
  chunkPackages,
  proofUrl,
  FITNESS_DEFAULT_BASE_URL,
  FITNESS_BATCH_MAX,
  FITNESS_PRICE_USDC,
  FITNESS_DEFAULT_TIMEOUT_MS,
} from "./fitness";
export type {
  AttestFitnessOptions,
  AttestFitnessBatchedOptions,
  MergedFitnessResult,
  FitnessResponse,
  FitnessData,
  FitnessFacts,
  FitnessAdvisory,
  FitnessAttestation,
} from "./fitness";

export const VERSION = "2.0.0";
