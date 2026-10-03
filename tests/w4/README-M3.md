# W4 M3 — Fitness Lite handler tests

Offline handler-level tests for POST /x402/fitness/lite (v5.4.0). Mirrors the
bs009 harness pattern: copy index.ts, sed-export the handler, stub npm imports
+ Deno globals, esbuild bundle, run in Node.

## Regenerate the bundle after engine changes
```bash
mkdir -p /tmp/w4m3-check && cd /tmp/w4m3-check
cp <repo>/supabase/functions/hello-world/{index.ts,w4_gas_rank.ts} .
sed -i 's|from "npm:@supabase/supabase-js@2"|from "./supabase-stub.ts"|; s|from "npm:ethers@6"|from "./ethers-stub.ts"|' index.ts
cp index.ts engine-copy.ts
sed -i 's/^async function handleFitnessLiteWithBilling/export async function handleFitnessLiteWithBilling/; s/^function isVendoredSolPath/export function isVendoredSolPath/' engine-copy.ts
echo 'export { buildGasRank, GAS_RANK_MODEL };' >> engine-copy.ts
npx esbuild engine-copy.ts --bundle --outfile=engine-bundle.js --format=esm --platform=node
node test-fitness-lite-handler.mjs && node test-gas-rank-structure.mjs
```

## Coverage
- T1: 400 INVALID_INPUT (no repo/files) — pre-billing
- T2: 422 NO_RANKABLE_FUNCTIONS — pre-billing, credits_charged 0
- T3: 422 vendored-only files — pre-billing
- T4: 402 x402 envelope (125 CRED = 1,250,000 atomic USDC, eip155:137, treasury payTo)
- T5: isVendoredSolPath unit (node_modules, lib/, nested lib, @openzeppelin, .t.sol)
- Structure: GAS_RANK_RESULT fields (gas_rank_version, attested_subject, functions[], composite, cohort_version, legal_weight 0, disclaimer, limits.error_band)

Success-path with real billing is verified live E2E post-deploy (cache hit + 125 CRED charge).
