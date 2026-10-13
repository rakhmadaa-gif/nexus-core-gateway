# v5.16.0 — W7 Web2 Dependency Fitness tests

- `test-lockfile-parse.mjs` — 40 unit tests for `lockfile_parse.ts`
  (7 formats: package-lock/npm-shrinkwrap, yarn.lock v1+berry, requirements.txt,
  Pipfile.lock, go.mod, Cargo.lock, package.json; format detection by filename
  with content sniffing; dedup, precedence input>lockfile>manifest, 250 cap,
  512 KiB size guard, version_source provenance).
  Run: `node test-lockfile-parse.mjs` (bundles lockfile_parse.ts via esbuild).
- `test-handler-nc.mjs` — 6 handler negative controls for
  `handleFitnessWithBilling`: 400 LOCKFILE_PARSE_FAILED / LOCKFILE_TOO_LARGE /
  INVALID_INPUT all pre-billing; valid package-lock reaches billing (402 in stub).
  Run: `node test-handler-nc.mjs` (needs engine-bundle.js).

Bundle regen (from repo root):
  sed -e 's|npm:@supabase/supabase-js@2|./supabase-stub.ts|' \
      -e 's|npm:ethers@6|./ethers-stub.ts|' \
      supabase/functions/hello-world/index.ts > tests/v516/engine-copy.ts
  printf '\nexport { parseSolidityContract, dryRunHandler, simulateBreachScenarios, handleFitnessWithBilling, handleFitnessLiteWithBilling, handlePeerCheckWithBilling, isVendoredSolPath, validateSoliditySyntax, stripStringsAndComments };\nexport { buildGasRank, GAS_RANK_MODEL } from "./w4_gas_rank.ts";\n' \
      >> tests/v516/engine-copy.ts
  cp supabase/functions/hello-world/lockfile_parse.ts tests/v516/
  cd tests/v516 && rm -f engine-bundle.js && \
      npx --yes esbuild@0.20.2 engine-copy.ts --bundle --platform=node \
      --format=esm --outfile=engine-bundle.js --log-level=error && echo "EXIT=$?"
  (DISCIPLINE: no pipes swallowing esbuild's exit code; rm old bundle first.)
