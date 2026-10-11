// modexp_gas.ts — v5.13.0: dual-regime MODEXP precompile pricing (BS-008 v2 fork-awareness)
// with DYNAMIC regime map (chain_regimes DB table + embedded snapshot fallback).
//
// Two live pricing regimes for the MODEXP precompile (0x05) exist side by side:
//   - EIP-2565 (Berlin-era, now only a conservative default for unknown chains)
//   - EIP-7883 (Osaka/Fusaka, LIVE on Ethereum mainnet since 2025-12-03 and
//     adopted by every major chain we probed: Base, Polygon, Arbitrum, Optimism,
//     BSC, Monad — see CHAIN_PRICING_REGIMES notes)
// v5.12.2 METHODOLOGY UPGRADE: regime entries are PROBE-VERIFIED, not docs-only.
// A live eth_estimateGas MODEXP price probe (scripts/probe-modexp-regimes.mjs)
// distinguishes 2565 vs 7883 mechanically (big-case ~113.6K vs ~549.1K gas).
// The probe caught that v5.12.0's docs-based "polygon = eip2565" entry had been
// WRONG since the Madhugiri hardfork (2025-12-09) — docs search is insufficient
// as negative evidence; live price behavior is ground truth.
// EIP-7883 reprices the canonical large-input class ~6x (e.g. the EVM Protocol
// Audit V1 calibration point "256-byte inputs: 34,890 gas" becomes ~209,000 gas),
// pushing the compute-to-gas ratio of the classic MODEXP-bomb below the 12.5
// validator-delay threshold. EIP-7823 (same fork) caps each input field at 1024
// bytes, further bounding worst-case inputs on Osaka chains.
//
// Sources: eips.ethereum.org/EIPS/eip-7883 (Final), eips.ethereum.org/EIPS/eip-7823,
// EIP-7607 Fusaka meta, docs.base.org Azul overview, review reference/eip-7883-modexp-review.md.
//
// v5.13.1 — PRECOMPILE AVAILABILITY layer (BS-008 v3, ZK chains review #5):
// the pricing question ("2565 vs 7883?") only exists where MODEXP EXISTS. Live
// availability probes (eth_call to 0x01..0x0a on 5 chains, 2026-10-11) show
// ZKsync Era and Polygon zkEVM have NO MODEXP (0x05), and several ZK chains
// lack RIPEMD-160 (0x03), BLAKE2f (0x09), and/or the KZG point-evaluation
// precompile (0x0a). Calls to a missing precompile REVERT at runtime —
// a deployment-blocking porting trap, graded high regardless of gas math.
// resolveUnsupportedPrecompiles(chain) serves the probed lists with the same
// hierarchy as the pricing map: fresh db row (with the column populated) >
// embedded snapshot > none; a STALE db row falls back to the snapshot
// (consistent with the regime rule — expired live data is never served).

export type ModexpPricingRegime = "eip2565" | "eip7883" | "unsupported";
// "unsupported" = the chain has NO MODEXP precompile at all (live-probe verified:
// the call REVERTS at runtime). This is not a pricing question — it is a
// deployment-blocking porting trap. See v5.13.1 / reference/zk-chains-review.md.

// Canonical repricing factor for the large-input class (base/modulus > 32 bytes):
// both formulas scale iteration_count identically for exponent_length <= 32, and
// multiplication_complexity goes from words^2 to 2*words^2 while the /3 divisor is
// removed: 2*words^2 / (words^2/3) = 6 exactly.
export const MODEXP_EIP7883_REPRICE_FACTOR = 6;

// Compute instructions-per-gas calibration kept from the v4.6.0 quantitative model
// (EVM Protocol-Level Audit V1): unbounded MODEXP ≈ 12.5 + 0.5 per extra call site.
// Under EIP-7883 the same pattern normalizes to (12.5 + 0.5*calls) / 6 ≈ 2.1.

function wordsCeil(maxLen: number): number {
  return Math.ceil(maxLen / 8);
}

function iterationCount(expLen: number, expLowBitLen: number, bigExpMultiplier: number): number {
  let it = 0;
  if (expLen <= 32 && expLowBitLen === 0) it = 0;
  else if (expLen <= 32) it = expLowBitLen - 1;
  else it = bigExpMultiplier * (expLen - 32) + (expLowBitLen - 1);
  return Math.max(it, 1);
}

/** EIP-2565 gas cost for MODEXP. expLowBitLen = bit length of the low 256 bits of the exponent (0 when zero). */
export function modexpGasEip2565(baseLen: number, expLen: number, modLen: number, expLowBitLen: number): number {
  const maxLen = Math.max(baseLen, modLen);
  const w = wordsCeil(maxLen);
  const mc = w * w;
  const ic = iterationCount(expLen, expLowBitLen, 8);
  return Math.max(200, Math.floor((mc * ic) / 3));
}

/** EIP-7883 (Osaka) gas cost for MODEXP. Same parameter convention as modexpGasEip2565. */
export function modexpGasEip7883(baseLen: number, expLen: number, modLen: number, expLowBitLen: number): number {
  const maxLen = Math.max(baseLen, modLen);
  const w = wordsCeil(maxLen);
  const mc = maxLen <= 32 ? 16 : 2 * w * w;
  const ic = iterationCount(expLen, expLowBitLen, 16);
  return Math.max(500, mc * ic);
}

export interface ChainPricingInfo {
  regime: ModexpPricingRegime;
  osakaActive: boolean;
  chainKey: string;      // normalized chain key actually used (or the raw unknown input)
  since: string | null;  // activation date for eip7883 chains
  note: string;
  source: "db" | "snapshot" | "conservative"; // where the verdict came from (v5.13.0)
  regimeStale: boolean;  // true when a live-map entry exceeded its TTL and we fell back to conservative
  probedAt: string | null; // last live-probe timestamp for the entry used (db rows only)
}

interface RegimeEntry { regime: ModexpPricingRegime; since: string | null; note: string }

// ---------------------------------------------------------------------------
// v5.13.0 DYNAMIC REGIME MAP — chain_regimes table + snapshot fallback.
//
// The embedded CHAIN_PRICING_REGIMES map below is now ONLY a snapshot fallback
// (frozen at probe date 2026-10-11). The live source of truth is the
// public.chain_regimes Supabase table, refreshed weekly by
// scripts/probe-modexp-regimes.mjs (upsert mode). Handlers call
// ensureRegimeMapFresh(supabase) before parsing; this module keeps a 10-minute
// in-memory cache so the hot path stays sub-millisecond and deterministic.
//
// STALENESS RULE (user-mandated "no expired maps served silently"):
// a db row whose probed_at is older than stale_after_days is NOT served — the
// chain falls back to conservative eip2565 and the output carries
// regime_stale: true. Failure direction is always "flag more, never silently
// downgrade". Snapshot entries are served with source: "snapshot" (disclosed,
// not silent) when the db is unreachable; they never mask a stale db row.
// ---------------------------------------------------------------------------

export interface DynamicRegimeRow {
  chain_key: string;
  regime: ModexpPricingRegime;
  probed_at: string;
  source: string | null;
  note: string | null;
  stale_after_days: number | null;
  unsupported_precompiles?: string[] | null; // v5.13.1: e.g. ["0x03","0x05","0x09","0x0a"]
}

const DYNAMIC_TTL_MS = 10 * 60 * 1000; // 10-minute module cache (regimes change only at hardforks)
const DEFAULT_STALE_AFTER_DAYS = 30;
let dynamicRegimes: Record<string, DynamicRegimeRow> | null = null;
let dynamicFetchedAt = 0;

/** Refresh the in-module regime cache from public.chain_regimes. Non-fatal by
 *  contract: any failure leaves the previous cache (or null = snapshot mode). */
export async function ensureRegimeMapFresh(supabase: unknown): Promise<void> {
  if (dynamicRegimes !== null && Date.now() - dynamicFetchedAt < DYNAMIC_TTL_MS) return;
  try {
    if (!supabase || typeof (supabase as { from?: unknown }).from !== "function") return;
    const fetchPromise = (supabase as {
      from: (t: string) => {
        select: (c: string) => { limit: (n: number) => Promise<{ data?: DynamicRegimeRow[] | null; error?: unknown }> };
      };
    }).from("chain_regimes")
      .select("chain_key, regime, probed_at, source, note, stale_after_days, unsupported_precompiles")
      .limit(500);
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("regime-map fetch timeout")), 4000));
    const { data, error } = await Promise.race([fetchPromise, timeout]);
    if (error || !Array.isArray(data)) return; // keep old cache / snapshot mode
    const map: Record<string, DynamicRegimeRow> = {};
    for (const row of data) {
      if (row && typeof row.chain_key === "string" && (row.regime === "eip2565" || row.regime === "eip7883" || row.regime === "unsupported")) {
        map[row.chain_key] = row;
      }
    }
    dynamicRegimes = map;
    dynamicFetchedAt = Date.now();
  } catch {
    // non-fatal: snapshot fallback
  }
}

/** Test hook: inject (or clear) the dynamic map without a database. */
export function __setDynamicRegimesForTest(rows: DynamicRegimeRow[] | null): void {
  if (rows === null) {
    dynamicRegimes = null;
    dynamicFetchedAt = 0;
    return;
  }
  dynamicRegimes = {};
  for (const row of rows) dynamicRegimes[row.chain_key] = row;
  dynamicFetchedAt = Date.now();
}

const CHAIN_PRICING_REGIMES: Record<string, RegimeEntry> = {
  // Verified Osaka deployments (extend only with sourced data AND/OR live probe):
  ethereum: { regime: "eip7883", since: "2025-12-03", note: "Fusaka/Osaka mainnet activation (EIP-7607, epoch 411392). Probe-verified 2026-10-11." },
  base: { regime: "eip7883", since: "2026-05-28", note: "Base Azul hardfork = Osaka EVM support. Probe-verified 2026-10-11." },
  monad: { regime: "eip7883", since: "2026-03-19", note: "MONAD_NINE mainnet activates Osaka EIPs (EIP-7823/7883/7939). Source-verified: traits.hpp eip_7883_active() w/ evm_rev>=MONAD_ETH_OSAKA; monad_mainnet.cpp revision gate 2026-03-19T14:30Z. Probe-verified 2026-10-11." },
  "monad-testnet": { regime: "eip7883", since: "2026-03-10", note: "MONAD_NINE testnet activates Osaka EIPs. Source-verified: monad_testnet.cpp revision gate 2026-03-10T14:30Z. Probe-verified 2026-10-11." },
  // v5.12.2 probe-driven corrections/additions (2026-10-11, Arbitrum Stylus review):
  polygon: { regime: "eip7883", since: "2025-12-09", note: "Madhugiri hardfork (PIP-76, block 80,084,800) activates EIP-7823/7825/7883 — v5.12.0 docs-based eip2565 entry was WRONG; corrected via live MODEXP price probe 2026-10-11." },
  arbitrum: { regime: "eip7883", since: "2026-01-08", note: "Arbitrum One ArbOS 51 Dia activates Osaka EIPs. Source-verified: nitro gethhook addPrecompiles(StartingFromArbOS50, PrecompiledContractsOsaka) w/ bigModExp eip7883=true; on-chain ArbSys.arbOSVersion()=116 (=61+55 legacy offset); probe-verified 2026-10-11." },
  "arbitrum-nova": { regime: "eip7883", since: "2026-01-08", note: "ArbOS 51 Dia on Nova; on-chain arbOSVersion()=116 same as One. NOTE: Nova eth_estimateGas returns inflated MODEXP estimates (~2M gas floor, overpriced/safe direction — estimator quirk, not protocol divergence); execution rules identical per source gate. Version-verified 2026-10-11." },
  "arbitrum-sepolia": { regime: "eip7883", since: "2025-11-20", note: "ArbOS 50 Dia (Sepolia-only precursor release) activates Osaka EIPs. Probe-verified 2026-10-11." },
  optimism: { regime: "eip7883", since: null, note: "Live MODEXP price probe 2026-10-11 shows 7883-class pricing (554,303 gas big-case). Activation fork/date not separately sourced." },
  bsc: { regime: "eip7883", since: null, note: "Live MODEXP price probe 2026-10-11 shows 7883-class pricing (554,303 gas big-case). Activation fork/date not separately sourced." },
  // v5.13.1 ZK chains (Protocol Review #5 + build-time valid-vector probe corrections 2026-10-11):
  scroll: { regime: "eip7883", since: null, note: "Live MODEXP price probe 2026-10-11 shows 7883-class pricing (548,780 gas big-case). ZK rollup missing 0x03/0x09 (see CHAIN_UNSUPPORTED_PRECOMPILES); 0x0a returns empty-success (inconclusive, not claimed)." },
  linea: { regime: "eip7883", since: null, note: "Live MODEXP price probe 2026-10-11 shows 7883-class pricing (554,303 gas big-case). Full standard precompile set incl. 0x0a (valid KZG vector returns 0x1000) — review-table '0x0a reverts' was a zeros-input artifact, corrected 2026-10-11." },
  zksync: { regime: "eip7883", since: null, note: "MODEXP EXISTS on ZKsync Era (3^5 mod 11 verified correct, 2026-10-11) — review-table 'no MODEXP' was an artifact of probing with 256B operands: EraVM bounds MODEXP operands to ≤32 bytes (larger REVERT, even in eth_call) and small-case pricing ≈7883-class (150,787 total incl. ~147K AA/pubdata floor). Asymmetry bomb dead on arrival (input bound stricter than EIP-7823). Missing: 0x03/0x09/0x0a (see CHAIN_UNSUPPORTED_PRECOMPILES)." },
  "polygon-zkevm": { regime: "unsupported", since: null, note: "Polygon zkEVM has NO MODEXP precompile — live eth_call to 0x05 REVERTS (2026-10-11); unsupported precompiles revert per Alchemy/zkEVM docs. Pricing question does not exist here. 0x0a returns empty-success (inconclusive, not claimed either way)." },
};

const CHAIN_ALIASES: Record<string, string> = {
  eth: "ethereum", mainnet: "ethereum", "ethereum-mainnet": "ethereum", "1": "ethereum",
  "base-mainnet": "base", "8453": "base",
  matic: "polygon", "polygon-pos": "polygon", "137": "polygon",
  "monad-mainnet": "monad", "143": "monad",
  "10143": "monad-testnet",
  arb: "arbitrum", "arbitrum-one": "arbitrum", arb1: "arbitrum", "42161": "arbitrum",
  nova: "arbitrum-nova", "42170": "arbitrum-nova",
  "arb-sepolia": "arbitrum-sepolia", "421614": "arbitrum-sepolia",
  op: "optimism", "op-mainnet": "optimism", "10": "optimism",
  bnb: "bsc", "bnb-chain": "bsc", binance: "bsc", "56": "bsc",
  era: "zksync", "zksync-era": "zksync", "zksync-mainnet": "zksync", "324": "zksync",
  zkevm: "polygon-zkevm", "polygon-zkevm-mainnet": "polygon-zkevm", "1101": "polygon-zkevm",
  "scroll-mainnet": "scroll", "534352": "scroll",
  "linea-mainnet": "linea", "59144": "linea",
};

// ---------------------------------------------------------------------------
// v5.13.1 PRECOMPILE AVAILABILITY (BS-008 v3) — snapshot fallback.
//
// Precompiles that DO NOT EXIST on a chain (live-probe verified 2026-10-11;
// see reference/zk-chains-review.md). A call to a missing precompile REVERTS
// at runtime → deployment-blocking porting trap, graded high.
// Only chains with a NON-EMPTY list are recorded; absent key = standard set.
// ---------------------------------------------------------------------------
const CHAIN_UNSUPPORTED_PRECOMPILES: Record<string, number[]> = {
  zksync: [0x03, 0x09, 0x0a],                 // RIPEMD160, BLAKE2f, pointEval (MODEXP EXISTS — ≤32B operand bound)
  "polygon-zkevm": [0x03, 0x05, 0x09],        // RIPEMD160, MODEXP, BLAKE2f (0x0a probe inconclusive — not claimed)
  scroll: [0x03, 0x09],                       // RIPEMD160, BLAKE2f
  monad: [0x0a],                              // KZG point evaluation absent (no blob tx support; reverts)
  "monad-testnet": [0x0a],                    // same as monad mainnet
  // linea: FULL standard set (0x0a valid-vector verified) — no entry needed.
};

/** Human label for precompile detail strings in engine output. */
export const PRECOMPILE_LABELS: Record<number, string> = {
  0x01: "ECRECOVER (0x01)",
  0x02: "SHA2-256 (0x02)",
  0x03: "RIPEMD-160 (0x03)",
  0x04: "IDENTITY (0x04)",
  0x05: "MODEXP (0x05)",
  0x06: "ECADD (0x06)",
  0x07: "ECMUL (0x07)",
  0x08: "ECPAIRING (0x08)",
  0x09: "BLAKE2f (0x09)",
  0x0a: "KZG point evaluation (0x0a)",
};

export interface UnsupportedPrecompilesInfo {
  list: number[];                       // sorted ascending; empty = nothing unsupported known
  source: "db" | "snapshot" | "none";   // where the list came from
  chainKey: string;                     // normalized chain key actually used (or raw unknown input)
}

/** Resolve which standard precompiles are missing on a chain. Hierarchy:
 *  fresh db row WITH the column populated > embedded snapshot > none.
 *  A STALE db row falls back to the snapshot (consistent with the pricing
 *  rule: expired live data is never served as live data). */
export function resolveUnsupportedPrecompiles(chain?: string | null): UnsupportedPrecompilesInfo {
  if (!chain || typeof chain !== "string" || chain.trim() === "") {
    return { list: [], source: "none", chainKey: "default" };
  }
  const raw = chain.trim().toLowerCase();
  const key = CHAIN_ALIASES[raw] ?? raw;

  // 1) Live map (db) — only when fresh AND the column is populated.
  const row = dynamicRegimes?.[key];
  if (row && Array.isArray(row.unsupported_precompiles)) {
    const ttlDays = typeof row.stale_after_days === "number" && row.stale_after_days > 0 ? row.stale_after_days : DEFAULT_STALE_AFTER_DAYS;
    const probedMs = Date.parse(row.probed_at);
    const ageMs = Number.isFinite(probedMs) ? Date.now() - probedMs : Number.POSITIVE_INFINITY;
    if (ageMs <= ttlDays * 24 * 60 * 60 * 1000) {
      const parsed = row.unsupported_precompiles
        .map((s) => (typeof s === "string" ? Number.parseInt(s.trim().toLowerCase().replace(/^0x/, ""), 16) : NaN))
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 255);
      return { list: Array.from(new Set(parsed)).sort((a, b) => a - b), source: "db", chainKey: key };
    }
    // stale db row → fall through to snapshot (never serve expired live data)
  }

  // 2) Embedded snapshot fallback.
  const snap = CHAIN_UNSUPPORTED_PRECOMPILES[key];
  if (snap) {
    return { list: Array.from(new Set(snap)).sort((a, b) => a - b), source: "snapshot", chainKey: key };
  }

  // 3) No knowledge → nothing claimed unsupported.
  return { list: [], source: "none", chainKey: key };
}

/** Resolve the MODEXP pricing regime for a chain. Unknown chains default to eip2565
 *  (conservative for a security detector: flags more, never silently downgrades). */
export function resolvePricingRegime(chain?: string | null): ChainPricingInfo {
  if (!chain || typeof chain !== "string" || chain.trim() === "") {
    return { regime: "eip2565", osakaActive: false, chainKey: "default", since: null, note: "No chain supplied — conservative default eip2565.", source: "conservative", regimeStale: false, probedAt: null };
  }
  const raw = chain.trim().toLowerCase();
  const key = CHAIN_ALIASES[raw] ?? raw;

  // 1) Live map (db). A stale db row is never served: conservative + regime_stale.
  const row = dynamicRegimes?.[key];
  if (row) {
    const ttlDays = typeof row.stale_after_days === "number" && row.stale_after_days > 0 ? row.stale_after_days : DEFAULT_STALE_AFTER_DAYS;
    const probedMs = Date.parse(row.probed_at);
    const ageMs = Number.isFinite(probedMs) ? Date.now() - probedMs : Number.POSITIVE_INFINITY;
    if (ageMs <= ttlDays * 24 * 60 * 60 * 1000) {
      return {
        regime: row.regime, osakaActive: row.regime === "eip7883", chainKey: key,
        since: null, note: row.note ?? `Live chain_regimes entry (${row.source ?? "probe"}).`,
        source: "db", regimeStale: false, probedAt: row.probed_at,
      };
    }
    return {
      regime: "eip2565", osakaActive: false, chainKey: key, since: null,
      note: `Live chain_regimes entry for "${key}" is stale (probed_at ${row.probed_at}, TTL ${ttlDays}d) — refusing to serve an expired map; conservative eip2565.`,
      source: "conservative", regimeStale: true, probedAt: row.probed_at,
    };
  }

  // 2) Embedded snapshot fallback (disclosed via source: "snapshot").
  const entry = CHAIN_PRICING_REGIMES[key];
  if (entry) {
    return { regime: entry.regime, osakaActive: entry.regime === "eip7883", chainKey: key, since: entry.since, note: entry.note, source: "snapshot", regimeStale: false, probedAt: null };
  }

  // 3) Unknown chain: conservative default.
  return { regime: "eip2565", osakaActive: false, chainKey: key, since: null, note: `Unknown chain "${raw}" — conservative default eip2565.`, source: "conservative", regimeStale: false, probedAt: null };
}
