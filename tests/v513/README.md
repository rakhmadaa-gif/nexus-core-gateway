# v5.13.1 — BS-008 v3 chain-aware precompile AVAILABILITY tests

- `test-engine-availability.mjs` — 41 engine-level tests
  (parseSolidityContract + dryRunHandler) for the availability_blocked
  verdict: probe-verified missing-precompile sets on zksync / polygon-zkevm /
  scroll / monad(+testnet), linea full-set negative control, alias and
  zero-diff guards (ethereum / no-chain / unknown-chain unchanged).
  Needs the bundled engine (same regeneration recipe as tests/v512 —
  remember the trailing `export { buildGasRank, GAS_RANK_MODEL } from
  "./w4_gas_rank.ts";` line in engine-copy.ts).
  Run: `node test-engine-availability.mjs`
- Resolver-level availability cases (24) live in
  `tests/v512/run-modexp-calc.ts` ("v5.13.1" section) — run:
  `cd tests/v512 && npx tsx run-modexp-calc.ts` (87 total).
- Ground truth: live valid-vector probes 2026-10-11 via
  `scripts/probe-modexp-regimes.mjs` (availability scan) — zksync HAS
  MODEXP (≤32B operand bound, eip7883-class); linea has the FULL set incl.
  0x0a; polygon-zkevm has NO MODEXP (unsupported); monad(+testnet) missing
  0x0a; scroll missing 0x03/0x09. Inconclusive empty-success results
  (polygon-zkevm/scroll 0x0a) are never claimed.
