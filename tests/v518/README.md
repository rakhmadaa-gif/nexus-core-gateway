# v5.18.0 — x402 multi-chain settlement + Revenue Bell tests

- `test-settlement.mjs` — 31 tests for `x402_settlement.ts` (v5.18.0 edits):
  A. `buildX402Accepts` — BASE_ACCEPTS_ENABLED flag off = byte-identical single
     Polygon accept (zero-diff guarantee); flag on ("true"/"1") = Base mirror
     accept appended (network/asset/amount/payTo); "0"/"yes"/undefined = off.
  B. `deriveSettlementClientId` — header passthrough, payer-derived
     `x402-payer-<addr>` (lowercased), `x402-unknown` fallback.
  C. `validatePaymentPayload` cross-chain — Polygon ok, Base ok, Base network +
     Polygon asset → UNSUPPORTED_ASSET (both directions), unknown network →
     UNSUPPORTED_NETWORK (message lists supported chains), wrong payTo →
     WRONG_PAYEE.
  D. EIP-3009 round-trip with REAL ethers — sign over Base domain (chainId 8453,
     USDC Base) with the treasury key → verifies on Base config (payer = signer,
     network threaded); negative control: same signature on Polygon config →
     INVALID_SIGNATURE (domain mismatch); `verifyIncomingPayment` end-to-end via
     base64 Bearer header.
  Run: `POLYGON_PRIVATE_KEY=$POLYGON_PRIVATE_KEY node test-settlement.mjs`
  (D-tests skip gracefully without the key).

Bundle regen (from this dir):
  sed 's|npm:ethers@6|ethers|' ../../supabase/functions/hello-world/x402_settlement.ts > x402_copy.ts
  rm -f settlement-bundle.js && \
      npx --yes esbuild@0.20.2 x402_copy.ts --bundle --platform=node \
      --format=esm --outfile=settlement-bundle.js --log-level=error && echo "EXIT=$?"
  (DISCIPLINE: rm old bundle first; no pipes swallowing esbuild's exit code.)

Note: `node_modules/` + `settlement-bundle.js` are regenerable — not committed.
Revenue Bell (`revenue_bell.ts`) is validated by live E2E post-deploy
(paid call → webhook fires → conversation receives bell), not by unit tests:
its body is fire-and-forget + catch-all by design.
