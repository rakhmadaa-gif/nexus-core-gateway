// modexp_gas.ts — v5.12.0: dual-regime MODEXP precompile pricing (BS-008 v2 fork-awareness).
//
// Two live pricing regimes for the MODEXP precompile (0x05) exist side by side:
//   - EIP-2565 (Berlin-era, still active on chains without Osaka, e.g. Polygon PoS)
//   - EIP-7883 (Osaka/Fusaka, LIVE on Ethereum mainnet since 2025-12-03 and on
//     Base since the Azul hardfork 2026-05-28)
// EIP-7883 reprices the canonical large-input class ~6x (e.g. the EVM Protocol
// Audit V1 calibration point "256-byte inputs: 34,890 gas" becomes ~209,000 gas),
// pushing the compute-to-gas ratio of the classic MODEXP-bomb below the 12.5
// validator-delay threshold. EIP-7823 (same fork) caps each input field at 1024
// bytes, further bounding worst-case inputs on Osaka chains.
//
// Sources: eips.ethereum.org/EIPS/eip-7883 (Final), eips.ethereum.org/EIPS/eip-7823,
// EIP-7607 Fusaka meta, docs.base.org Azul overview, review reference/eip-7883-modexp-review.md.

export type ModexpPricingRegime = "eip2565" | "eip7883";

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
}

interface RegimeEntry { regime: ModexpPricingRegime; since: string | null; note: string }

const CHAIN_PRICING_REGIMES: Record<string, RegimeEntry> = {
  // Verified Osaka deployments (facts as of 2026-10-11 — extend only with sourced data):
  ethereum: { regime: "eip7883", since: "2025-12-03", note: "Fusaka/Osaka mainnet activation (EIP-7607, epoch 411392)." },
  base: { regime: "eip7883", since: "2026-05-28", note: "Base Azul hardfork = Osaka EVM support." },
  monad: { regime: "eip7883", since: "2026-03-19", note: "MONAD_NINE mainnet activates Osaka EIPs (EIP-7823/7883/7939). Source-verified: traits.hpp eip_7883_active() w/ evm_rev>=MONAD_ETH_OSAKA; monad_mainnet.cpp revision gate 2026-03-19T14:30Z." },
  "monad-testnet": { regime: "eip7883", since: "2026-03-10", note: "MONAD_NINE testnet activates Osaka EIPs. Source-verified: monad_testnet.cpp revision gate 2026-03-10T14:30Z." },
  // Verified NOT Osaka (still EIP-2565 pricing):
  polygon: { regime: "eip2565", since: null, note: "No Bor Osaka adoption found as of 2026-10-11 — EIP-2565 pricing still applies." },
};

const CHAIN_ALIASES: Record<string, string> = {
  eth: "ethereum", mainnet: "ethereum", "ethereum-mainnet": "ethereum", "1": "ethereum",
  "base-mainnet": "base", "8453": "base",
  matic: "polygon", "polygon-pos": "polygon", "137": "polygon",
  "monad-mainnet": "monad", "143": "monad",
  "10143": "monad-testnet",
};

/** Resolve the MODEXP pricing regime for a chain. Unknown chains default to eip2565
 *  (conservative for a security detector: flags more, never silently downgrades). */
export function resolvePricingRegime(chain?: string | null): ChainPricingInfo {
  if (!chain || typeof chain !== "string" || chain.trim() === "") {
    return { regime: "eip2565", osakaActive: false, chainKey: "default", since: null, note: "No chain supplied — conservative default eip2565." };
  }
  const raw = chain.trim().toLowerCase();
  const key = CHAIN_ALIASES[raw] ?? raw;
  const entry = CHAIN_PRICING_REGIMES[key];
  if (entry) {
    return { regime: entry.regime, osakaActive: entry.regime === "eip7883", chainKey: key, since: entry.since, note: entry.note };
  }
  return { regime: "eip2565", osakaActive: false, chainKey: key, since: null, note: `Unknown chain "${raw}" — conservative default eip2565.` };
}
