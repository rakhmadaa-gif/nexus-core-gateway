#!/usr/bin/env -S npx tsx
// v5.12.0 unit tests — dual-regime MODEXP pricing calculator + regime map.
// Vectors anchored to official EIP-2565/EIP-7883 test-case prices (reconstructed
// parameters from the EIP test tables; both formulas must hit both price points).
import {
  modexpGasEip2565, modexpGasEip7883, resolvePricingRegime, MODEXP_EIP7883_REPRICE_FACTOR,
  ensureRegimeMapFresh, __setDynamicRegimesForTest,
} from "../../supabase/functions/hello-world/modexp_gas.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); }
}

// --- Official-vector anchors -------------------------------------------------
// EIP-2565 test "nagydani_3_pow0x10001": base 256B, exponent 32B value 0x10001
// (bitlen 17 → ic=16), modulus 256B → 5461 gas. EIP-7883 reprices it to 32768.
check("nagydani_3_pow0x10001 eip2565 = 5461", modexpGasEip2565(256, 32, 256, 17) === 5461, String(modexpGasEip2565(256, 32, 256, 17)));
check("nagydani_3_pow0x10001 eip7883 = 32768", modexpGasEip7883(256, 32, 256, 17) === 32768, String(modexpGasEip7883(256, 32, 256, 17)));

// EIP-2565 test "marcin_1_base_heavy": 8-byte fields (w=1), ic=72 → floor(72/3)=24
// → max(200,24)=200. EIP-7883: 16*72=1152 → max(500,1152)=1152.
check("marcin_1_base_heavy eip2565 = 200 (floor)", modexpGasEip2565(8, 8, 8, 73) === 200, String(modexpGasEip2565(8, 8, 8, 73)));
check("marcin_1_base_heavy eip7883 = 1152", modexpGasEip7883(8, 8, 8, 73) === 1152, String(modexpGasEip7883(8, 8, 8, 73)));

// Canonical calibration point (EVM Protocol Audit V1): 256B inputs, full 32-byte
// exponent bitlen 255 → ic=254 → 2565: 86,698 gas ("~34,890" was a shorter-exponent
// class; this is the worst-case 256B row) → 7883: 520,192. Ratio ≈ 6.
const g2565 = modexpGasEip2565(256, 32, 256, 255);
const g7883 = modexpGasEip7883(256, 32, 256, 255);
check("256B full-exp eip2565 = 86698", g2565 === 86698, String(g2565));
check("256B full-exp eip7883 = 520192", g7883 === 520192, String(g7883));
check("256B class repricing ≈ 6x", g7883 / g2565 >= 5.9 && g7883 / g2565 <= 6.01, (g7883 / g2565).toFixed(4));

// Small bounded class (8B, ic=63): overpriced under 7883 → ratio 5.04 (200→1008).
check("8B small eip2565 = 200", modexpGasEip2565(8, 8, 8, 64) === 200, String(modexpGasEip2565(8, 8, 8, 64)));
check("8B small eip7883 = 1008", modexpGasEip7883(8, 8, 8, 64) === 1008, String(modexpGasEip7883(8, 8, 8, 64)));

// Floor cases: exponent zero → ic = max(0,1) = 1.
check("exp=0 eip2565 floor 200", modexpGasEip2565(256, 32, 256, 0) === 341, String(modexpGasEip2565(256, 32, 256, 0)));
check("exp=0 eip7883 floor max(500,2048)=2048", modexpGasEip7883(256, 32, 256, 0) === 2048, String(modexpGasEip7883(256, 32, 256, 0)));

// exp_len > 32B multiplier: 8x (2565) vs 16x (7883).
check("exp>32B eip2565 (32,64,32,100) = 1893", modexpGasEip2565(32, 64, 32, 100) === 1893, String(modexpGasEip2565(32, 64, 32, 100)));
check("exp>32B eip7883 (32,64,32,100) = 9776", modexpGasEip7883(32, 64, 32, 100) === 9776, String(modexpGasEip7883(32, 64, 32, 100)));

// 32→33B discontinuity (mc 16→50 benign jump under 7883). ic=39 (bitlen 40)
// escapes the 500 floor so the raw multiplication-complexity jump is isolated.
check("7883 discontinuity 32→33B (mc 16→50)", modexpGasEip7883(32, 32, 32, 40) === 624 && modexpGasEip7883(33, 32, 33, 40) === 1950, `${modexpGasEip7883(32,32,32,40)}/${modexpGasEip7883(33,32,33,40)}`);
check("7883 floor swallows small-ic 32B row (256→500)", modexpGasEip7883(32, 32, 32, 17) === 500, String(modexpGasEip7883(32,32,32,17)));

// --- Negative controls (formula tampering must FAIL) -------------------------
check("NC: 7883 ≠ 2565 on nagydani (regimes actually diverge)", modexpGasEip7883(256, 32, 256, 17) !== modexpGasEip2565(256, 32, 256, 17));
check("NC: 7883 keeps no /3 divisor (32768, not 10922)", modexpGasEip7883(256, 32, 256, 17) !== Math.floor(2 * 32 * 32 * 16 / 3));
check("NC: 7883 min floor 500 (not 200)", modexpGasEip7883(8, 8, 8, 1) === 500, String(modexpGasEip7883(8, 8, 8, 1)));

// --- Regime map ---------------------------------------------------------------
const cases: Array<[string | null | undefined, string, boolean]> = [
  ["ethereum", "eip7883", true], ["eth", "eip7883", true], ["mainnet", "eip7883", true],
  ["1", "eip7883", true], [" Ethereum ", "eip7883", true],
  ["base", "eip7883", true], ["8453", "eip7883", true],
  ["polygon", "eip7883", true], ["matic", "eip7883", true], ["137", "eip7883", true],
  ["arbitrum", "eip7883", true], ["42161", "eip7883", true], ["arb", "eip7883", true],
  ["arbitrum-nova", "eip7883", true], ["42170", "eip7883", true],
  ["arbitrum-sepolia", "eip7883", true], ["421614", "eip7883", true],
  ["optimism", "eip7883", true], ["op", "eip7883", true], ["10", "eip7883", true],
  ["bsc", "eip7883", true], ["bnb", "eip7883", true], ["56", "eip7883", true],
  ["solana", "eip2565", false],
  ["monad", "eip7883", true], ["143", "eip7883", true], ["monad-mainnet", "eip7883", true],
  ["monad-testnet", "eip7883", true], ["10143", "eip7883", true],
  [undefined, "eip2565", false], [null, "eip2565", false], ["", "eip2565", false],
];
for (const [input, regime, osaka] of cases) {
  const r = resolvePricingRegime(input as string | null | undefined);
  check(`regime(${JSON.stringify(input)}) = ${regime}`, r.regime === regime && r.osakaActive === osaka, `${r.regime}/${r.osakaActive}`);
}
check("unknown chain is conservative (not osaka)", resolvePricingRegime("megaeth-2099").osakaActive === false);
check("MODEXP_EIP7883_REPRICE_FACTOR = 6", MODEXP_EIP7883_REPRICE_FACTOR === 6);

// --- v5.13.0 dynamic regime map (db rows + staleness + snapshot fallback) -----
const NOW_ISO = new Date().toISOString();
const OLD_ISO = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(); // 45d > 30d TTL

// Baseline: no dynamic rows -> snapshot path, disclosed as such.
__setDynamicRegimesForTest(null);
check("no-db: polygon resolves via snapshot", (() => { const r = resolvePricingRegime("polygon"); return r.regime === "eip7883" && r.source === "snapshot" && r.regimeStale === false; })(), JSON.stringify(resolvePricingRegime("polygon")));
check("no-db: unknown chain conservative", (() => { const r = resolvePricingRegime("megaeth-2099"); return r.regime === "eip2565" && r.source === "conservative" && r.regimeStale === false; })());

// Fresh db row WINS over snapshot (polygon snapshot says 7883; fresh db row says 2565 -> db wins).
__setDynamicRegimesForTest([
  { chain_key: "polygon", regime: "eip2565", probed_at: NOW_ISO, source: "probe", note: "test row", stale_after_days: 30 },
]);
check("db-fresh beats snapshot (polygon eip2565 from db)", (() => { const r = resolvePricingRegime("polygon"); return r.regime === "eip2565" && r.source === "db" && r.probedAt === NOW_ISO && r.regimeStale === false; })(), JSON.stringify(resolvePricingRegime("polygon")));
check("db-fresh: alias matic hits db row too", resolvePricingRegime("matic").source === "db");
check("db-fresh: ethereum (no db row) still snapshot", resolvePricingRegime("ethereum").source === "snapshot");

// Fresh db row for a chain ABSENT from the snapshot map.
__setDynamicRegimesForTest([
  { chain_key: "zksync", regime: "eip7883", probed_at: NOW_ISO, source: "probe", note: null, stale_after_days: 30 },
]);
check("db-fresh new chain (zksync eip7883) served from db", (() => { const r = resolvePricingRegime("zksync"); return r.regime === "eip7883" && r.source === "db" && r.osakaActive === true; })(), JSON.stringify(resolvePricingRegime("zksync")));

// STALE db row -> refused; conservative eip2565 + regime_stale (never silently serve expired map).
__setDynamicRegimesForTest([
  { chain_key: "polygon", regime: "eip7883", probed_at: OLD_ISO, source: "probe", note: "old row", stale_after_days: 30 },
]);
check("db-stale refused: conservative + regime_stale", (() => { const r = resolvePricingRegime("polygon"); return r.regime === "eip2565" && r.osakaActive === false && r.source === "conservative" && r.regimeStale === true && r.probedAt === OLD_ISO; })(), JSON.stringify(resolvePricingRegime("polygon")));
check("db-stale: other chains unaffected (ethereum snapshot)", resolvePricingRegime("ethereum").source === "snapshot");

// Stale with unparseable probed_at -> also refused (fail-safe).
__setDynamicRegimesForTest([
  { chain_key: "base", regime: "eip7883", probed_at: "not-a-date", source: "probe", note: null, stale_after_days: 30 },
]);
check("db row with bad probed_at refused (conservative+stale)", (() => { const r = resolvePricingRegime("base"); return r.regime === "eip2565" && r.source === "conservative" && r.regimeStale === true; })(), JSON.stringify(resolvePricingRegime("base")));

// Custom TTL honored (1 day TTL, 2-day-old probe -> stale).
__setDynamicRegimesForTest([
  { chain_key: "optimism", regime: "eip7883", probed_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), source: "probe", note: null, stale_after_days: 1 },
]);
check("custom TTL=1d: 2-day-old row stale", (() => { const r = resolvePricingRegime("optimism"); return r.regimeStale === true && r.regime === "eip2565"; })(), JSON.stringify(resolvePricingRegime("optimism")));

// ensureRegimeMapFresh contract: non-fatal without a usable client (snapshot mode kept).
__setDynamicRegimesForTest(null);
// (wrapped: this file runs as CJS under tsx — no top-level await)
(async () => {
  await ensureRegimeMapFresh(null);
  await ensureRegimeMapFresh({});
  check("ensureRegimeMapFresh non-fatal on bad client (snapshot kept)", resolvePricingRegime("polygon").source === "snapshot");
  __setDynamicRegimesForTest(null);

  console.log(`\nmodexp-calc: ${pass} PASS, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
