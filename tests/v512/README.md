# v5.12.0 — BS-008 v2 fork-aware MODEXP pricing tests

- `run-modexp-calc.ts` — 36 unit tests for `modexp_gas.ts` (dual-regime gas
  calculators anchored to official EIP-2565/EIP-7883 price vectors, regime map,
  formula-tampering NCs). Run: `npx tsx run-modexp-calc.ts`
- `test-engine-regime.mjs` — 21 engine-level tests (parseSolidityContract +
  dryRunHandler across chains; TSTORE guard; conservative-default NC).
  Needs the bundled engine (see tests/w4/README-M3.md regeneration recipe —
  same pattern, exports: dryRunHandler, parseSolidityContract +
  w4/w3/peer-check handler set). Run: `node test-engine-regime.mjs`
- Offline mirror of the live regression corpus runner lives in
  /tmp harness per session (CORPUS_DIR env → MemFS engine-regression-corpus);
  after deploy, the canonical live runner is
  `$MEMORY_DIR/reference/engine-regression-corpus/run_regression.py`.
