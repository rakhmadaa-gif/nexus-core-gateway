# v5.14.2 — BS-015 HyperCore Porting Trap tests

- `test-bs015.mjs` — 12 engine-level tests (parseSolidityContract.hypercore_porting
  + simulateBreachScenarios BS-015) for the HyperEVM protocol review #6 class.
  Grading ladder: hyperevm/999/998 -> low (clean); known non-HyperEVM chain
  (db/snapshot source) -> HIGH + deployable=false; absent/unknown hint -> MEDIUM.
  Covers: literal 0x0800 interface cast, CoreWriter 0x3333... literal, named
  constant indirection (CORE_WRITER.call), cast shorthand address(0x800),
  comment-only mention (stripped), clean contract, numeric alias 999/998.
  Run: `node test-bs015.mjs` (needs engine-bundle.js).
- `run-offline-regression.mjs` — offline mirror of MemFS run_regression.py:
  22 fixtures (zero medium+), 3 guarded (named scenario must stay silent +
  zero severity-error validator issues), 17 negatives (severity floors, incl.
  NC17 hypercore-porting-trap {"BS-015":"medium"} — corpus parses WITHOUT
  chain hint, so medium is the expected grade there).
  Run: `MEMORY_DIR=$MEMORY_DIR node run-offline-regression.mjs`.

Bundle regen (from repo root):
  sed -e 's|npm:@supabase/supabase-js@2|./supabase-stub.ts|' \
      -e 's|npm:ethers@6|./ethers-stub.ts|' \
      supabase/functions/hello-world/index.ts > tests/v5142/engine-copy.ts
  printf '\nexport { parseSolidityContract, dryRunHandler, simulateBreachScenarios, handleFitnessLiteWithBilling, handlePeerCheckWithBilling, isVendoredSolPath, isValidPeerUrl, probePeerEndpoint, validateSoliditySyntax, stripStringsAndComments };\nexport { buildGasRank, GAS_RANK_MODEL } from "./w4_gas_rank.ts";\n' \
      >> tests/v5142/engine-copy.ts
  cd tests/v5142 && rm -f engine-bundle.js && \
      npx --yes esbuild@0.20.2 engine-copy.ts --bundle --platform=node \
      --format=esm --outfile=engine-bundle.js --log-level=error && echo "EXIT=$?"
  (DISCIPLINE: no pipes swallowing esbuild's exit code; rm old bundle first.)
