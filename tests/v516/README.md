# tests/v516 — W7 Web2 Dependency Fitness + Gas Bahasa (v5.18.1) test harness

Offline harness for the fitness/lockfile engine. No Deno, no network, no billing.

## Suites

- `test-lockfile-parse.mjs` — unit tests for `lockfile_parse.ts`
  (10 formats: package-lock/npm-shrinkwrap, yarn.lock v1+berry, requirements.txt,
  Pipfile.lock, go.mod, Cargo.lock, package.json, PHP composer.lock + composer.json
  manifest (Packagist), Dart pubspec.lock (Pub, hosted pub.dev packages only —
  sdk/path/git skipped), Ruby Gemfile.lock (RubyGems, platform suffixes stripped);
  format detection by filename with content sniffing; dedup, precedence
  input>lockfile>manifest, 250 cap, 512 KiB size guard, version_source provenance).
  Run: `node test-lockfile-parse.mjs` (bundles lockfile_parse.ts via esbuild).
- `test-handler-nc.mjs` — 8 handler negative controls (NC1–NC6 + NC6b) for
  `handleFitnessWithBilling`: 400 LOCKFILE_PARSE_FAILED / LOCKFILE_TOO_LARGE /
  INVALID_INPUT all pre-billing; valid package-lock reaches billing (402 in stub);
  fitness free trial: first call 200 free, second call 402 (stub flag
  `globalThis.__STUB_TRIAL`).
  Run: `node test-handler-nc.mjs` (needs engine-bundle.js).

## Bundle regen (from repo root)

`engine-copy.ts` is a sed-rewritten copy of the live `index.ts` with `npm:`
imports pointed at local stubs, plus a trailing export line. It imports these
companion modules, so copy them fresh before bundling:

```bash
sed -e 's|npm:@supabase/supabase-js@2|./supabase-stub.ts|' \
    -e 's|npm:ethers@6|./ethers-stub.ts|' \
    supabase/functions/hello-world/index.ts > tests/v516/engine-copy.ts
printf '\nexport { parseSolidityContract, dryRunHandler, simulateBreachScenarios, handleFitnessWithBilling, handleFitnessLiteWithBilling, handlePeerCheckWithBilling, isVendoredSolPath, validateSoliditySyntax, stripStringsAndComments };\nexport { buildGasRank, GAS_RANK_MODEL } from "./w4_gas_rank.ts";\n' \
    >> tests/v516/engine-copy.ts
cp supabase/functions/hello-world/{lockfile_parse,attestation_signer,modexp_gas,revenue_bell,w3_fitness_full,w4_gas_rank,w6_forensic,x402_settlement}.ts tests/v516/
cd tests/v516 && rm -f engine-bundle.js && \
    npx --yes esbuild@0.20.2 engine-copy.ts --bundle --platform=node \
    --format=esm --outfile=engine-bundle.js --log-level=error && echo "EXIT=$?"
```

DISCIPLINE: no pipes swallowing esbuild's exit code; `rm` the old bundle first
(a stale `engine-bundle.js` silently runs old code and produces fake PASSes —
this bit us once; the NC6 failure was a stale bundle, not a code bug).

`engine-bundle.js` is gitignored (regenerable); commit `engine-copy.ts` +
stubs + companion modules only.
