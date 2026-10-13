# Nexus Gateway Changelog

## v5.16.0-frontier — 2026-10-13

### W7 Web2 Dependency Fitness — lockfile ingestion + repo manifest extraction
- **POST /x402/fitness ($0.05) now ingests dependency lockfiles/manifests.**
  Paste any supported file via `{lockfile:{filename?,content}}` (content
  max 512 KiB): package-lock.json / npm-shrinkwrap.json, yarn.lock,
  requirements.txt, Pipfile.lock, go.mod, Cargo.lock, or package.json.
  Format is detected from the filename with content-sniffing fallback.
- **Repo mode auto-extracts dependency manifests** from the repo root
  (default branch): the same 7 file candidates are fetched (deterministic
  order), so a bare `{repo:"owner/name"}` call now scans real dependencies
  instead of reporting "no packages supplied".
- **Exact versions from lockfiles are queried version-scoped at OSV** —
  a pinned `lodash@4.17.20` reports its own advisories instead of every
  lodash advisory ever published (false-positive reduction). Range
  specifiers (`^1.2.3`, `>=1.0`) stay unpinned and are disclosed as such
  (no registry guessing).
- **Merged cap 250 packages** (input > lockfile > repo manifest precedence,
  dedup by ecosystem|name|version); OSV querybatch for lists > 10.
  Resolution provenance disclosed per package:
  `subject.packages_resolved[]` with `version_source`
  (input/lockfile/manifest/unpinned), `subject.lockfiles_detected[]`,
  `subject.dependency_capped`.
- **Pre-billing validation** (never charged): 400 LOCKFILE_PARSE_FAILED
  (unrecognized/corrupt lockfile), 400 LOCKFILE_TOO_LARGE (>512 KiB).
  FITNESS_VERSION 1.0.0 → 1.1.0.
- Validation: 40/40 lockfile-parse unit tests + 6/6 handler negative
  controls + 97/97 modexp-calc + 40/40 engine-regime + 41/41 availability +
  9/9 BS-014 + 11/11 v5.14.1 + 12/12 BS-015 + W4 19/19+10/10+20/20 +
  W3 35/35+22/22+19/19 + offline regression 22F/3G/17NC 0 FAIL.

## v5.14.3-frontier — 2026-10-12

### BS-008 regime map + Berachain/Bepolia (Protocol Review #7 correction)
- **Berachain mainnet (80094) and Bepolia testnet (80069) added to the
  EIP-7883 regime.** Live MODEXP price probe (2026-10-12): BIG 554,303 /
  SMALL 27,380 gas on both chains — identical to the Osaka schedule.
  Source-verified: bera-reth uses stock revm precompiles
  (`Precompiles::new(PrecompileSpecId::from_spec_id(spec_id))`, zero custom
  precompiles); Fusaka-class EIPs active via BRIP-0010 (mainnet 2026-06-24,
  Bepolia 2026-05-27). Previously both chains fell through to the conservative
  EIP-2565 default and over-flagged protocol-mitigated MODEXP contracts.
- Aliases: `berachain`, `bera`, `berachain-mainnet`, `80094`; `bepolia`,
  `berachain-testnet`, `80069`.
- Full standard precompile set on both chains (incl. BLS 0x0b–0x11 and
  P-256 0x100 at the standard EIP-7951 price) — no availability_blocked
  entries.
- Probe script now covers 18 chains; chain_regimes DB upserted 18/18.
- **Zero behavior change for all other chains** (unknown/absent chain hint
  still serves conservative EIP-2565).
- Validation: 97/97 modexp-calc + 40/40 engine-regime + 42/42 offline
  regression (22F/3G/17NC) + W4 19/19+10/10+20/20 + W3 35/35+22/22+19/19 +
  v513 41/41 + v514 9/9+11/11 + v5142 12/12 + live E2E 12/12 + live
  regression 22F/3G/17NC 0 FAIL (844ms).

## v5.14.2-frontier — 2026-10-12

### BS-015 HyperCore Porting Trap (HyperEVM protocol review #6 class)
- **New scenario 15/15: HyperCore Porting Trap.** Contracts calling HyperCore
  read precompiles (`0x0800`-`0x0813`) or the CoreWriter
  (`0x3333...3333`) — addresses that exist ONLY on HyperEVM (chains 999/998) —
  are graded chain-aware:
  - `chain=hyperevm|hyperevm-testnet` (or 999/998 aliases): valid usage, no flag.
  - Known non-HyperEVM chain hint: **HIGH** — the call reverts on ABI decode
    (empty returndata) or silently returns zeros on low-level calls; the
    contract cannot execute as written. `deployable=false`.
  - Absent/unknown chain hint: **MEDIUM** — undeclared target chain,
    unverifiable availability.
- Named-constant resolution: functions referencing a constant whose value is a
  HyperCore address (e.g. `address constant CORE_WRITER = 0x3333...`) are
  attributed, not only literal call sites. Comments/strings stripped before
  matching.
- Closes the "koreksi proyek" loop of Protocol Review #6 (HyperEVM) — the
  porting-trap direction complementing BS-008 v3 availability_blocked (which
  covers standard precompiles missing on ZK chains; BS-015 covers
  chain-specific precompiles used on foreign chains).
- Wiring: dry-run `contract_info.hypercore_porting`, scan-deep
  `hypercore_porting`, breach scenario list, `deployable` gate (high only).
- Tests: `tests/v5142/` — 11 unit cases (grading ladder, aliases, constant
  indirection, comment-strip, deployable gate) + offline regression 25F/17NC
  0 FAIL (NC17 HyperCore-trap permanent negative control).

## v5.14.0-frontier — 2026-10-12

### BS-014 Phantom Vote detection (Confetti GHSA-3g9w-x8qp-2qpq class)
- **New scenario 14/14: Phantom Vote (vote without proposal-existence check).**
  Public/external vote-casting entry points (`castVote*` family, `vote`,
  `voteFor`, `submitVote`, `voteSingle`, `votePartial`) that take a proposalId
  and apply vote effects WITHOUT verifying the proposal exists are flagged
  HIGH. Class source: Confetti Governor v6.21 phantom-vote bug
  (GHSA-3g9w-x8qp-2qpq, validated High, our first confirmed advisory) — an
  attacker votes on a never-submitted proposalId; the phantom enters
  rankings/rewards and its voters get paid at completion.
- **Guard recognition across the transitive same-file call closure**
  (reachableHelpers): (1) `proposals[id].exists` require/if-revert (the
  canonical Confetti v6.22 fix); (2) NonexistentProposal-class revert names
  (incl. Compound Bravo "invalid proposal id" messages); (3) counter-bounds
  checks both directions (`proposalId < proposalCount`,
  `proposalCount >= proposalId`); (4) zero-deadline/snapshot `== 0` reverts
  (OZ Governor `state()` class). `proposalIsDeleted` / contest-state /
  timestamp checks do NOT establish existence.
- **Corpus**: F16 (real Confetti v6.21 Governor) moved fixtures ->
  negatives/NC16-confetti-phantom-vote.sol ({"BS-014": "high"}); new fixtures
  F18 (compound if-revert auth, carries the v5.13.3 coverage F16 held),
  F19 (real Confetti v6.22 fixed Governor — clean), F20 (OZ-Governor-style
  closure guard — clean).
- **Validation**: 9/9 new BS-014 tests + offline regression 22F/16NC 0 FAIL +
  v512 34/34 & 87/87 + v513 41/41 + W4 19+10+20 + W3 35+22+19.
  Zero-diff: BS-001..BS-013 behavior unchanged on the full corpus.

## v5.13.3-frontier — 2026-10-12

### FP-precision round (engine-progress-test 2026-10-11: zFi / Confetti / sqrtDAO classes)
- **BS-002 — inline checked-arithmetic guard recognition.** Transfers whose
  EVERY transfer function deducts the sender balance inline
  (`balanceOf[msg.sender][id] -= amount`, nested-mapping aware) are recognized
  as underflow-revert guarded (ERC-6909/solmate class); `transferFrom` also
  requires allowance/operator deduction. Unchecked credit-only transfers
  still flag high (permanent NC14).
- **BS-012 — bare block.timestamp comparisons stripped as bookkeeping.**
  Deadline/window/cooldown comparisons in ANY position (not just require
  lines) — e.g. the if-return guard form
  `if (... || block.timestamp >= m.close) return (0,0)` (zFi quote() class).
  Timestamp in arithmetic/keccak still counts as entropy (NC5/NC10 unchanged).
- **BS-009 — read-only iteration excluded + guarded-reach exclusion.**
  view/pure iterators can no longer raise unbounded-iteration risk (eth_call
  is not consensus-gas-bound; paginated views like zFi `_page(start,count)`
  are the STANDARD anti-DoS pattern). Append-only medium now requires at
  least one state-changing non-calldata iterator — the DoS targets the array
  CONSUMER, so iterator access control alone does not neutralize it (NC3
  class preserved). Private/internal iterators are excluded when EVERY public
  entry that transitively reaches them is access-controlled (sqrtDAO Metadata
  class: `_get`/`_setMetadata` only reachable via onlyOwner setMetadata*).
- **Access control — compound if-revert conditions recognized.**
  `if ((msg.sender != creator) && (msg.sender != proposals[id].author)) revert`
  now counts as a guard (Confetti deleteProposals class); the condition
  matcher widened from `[^)]*` to `[^;{]*` for nested parens/`&&`. Non-auth
  compound conditions get no credit (permanent NC15).
- Validation: offline regression 20 fixtures/15 negatives 0 FAIL; suites
  v513 41/41, v512 34/34+87/87, W4 19+10+20, W3 35+22+19, v5.13.3 NCs 6/6;
  live regression 20/15 0 FAIL (699ms avg); positive controls (real files
  zFi PM.sol, Confetti Governor v6.21, sqrtDAO Metadata) OLD high/medium →
  NEW clean; paywall 402 + x402 payment-required header intact.
- Corpus: fixtures F15-F17 (real zFi/Confetti/sqrtDAO files), negatives
  NC14/NC15 added; NC12 evolved (public sweep() added — same fake-guard
  invariant under the new append-only semantics).

## v5.13.2-frontier — 2026-10-11

### HyperEVM regime entries (Protocol Review #6 correction)
- **hyperevm (hyperliquid, 999) + hyperevm-testnet (998) → eip2565, probe-verified.**
  Live MODEXP price probes: BIG 114,614 / SMALL 24,655 gas (identical on
  mainnet and testnet) = pre-Osaka EIP-2565 class. Full standard precompile
  set including 0x0a KZG pointEval (valid-vector verified) — no availability
  entries. Aliases: hyperliquid, hyperevm-mainnet, hyperliquid-mainnet, 999,
  hyperliquid-testnet, 998.
- **Zero grading change**: unknown/absent chain hints already default to
  conservative eip2565 — this makes HyperEVM explicit (regime_source
  db/snapshot instead of conservative fallback) and adds the chain to the
  weekly probe refresh set (16 chains probed, `scripts/probe-modexp-regimes.mjs`).
- Review findings (reference/hyperevm-review.md, verdict NEGATIF — 6/6 protocol
  reviews negative): HyperCore read precompiles 0x0800-0x0813 measure
  ~1334+33*(in+out) gas — BELOW the documented 2000+65*(in+out) (safe
  direction, docs divergence); no flat-price unbounded-iteration surface
  (variable-output precompiles charge linearly); CoreWriter async semantics +
  invalid-input full-frame burn = documented footguns, informational only.
- Validation: 87/87 modexp-calc + 34/34 engine-regime (5 new hyperevm checks) +
  41/41 availability + W4 19/19+10/10+peer-check + W3 35/35+22/22+19/19 +
  offline regression 17F/13NC 0 FAIL + live E2E 10/10 + live regression
  17F/13NC 0 FAIL + DB upsert 16/16.

## v5.13.1-frontier — 2026-10-11

### BS-008 v3: chain-aware precompile AVAILABILITY (ZK chains review #5 correction)
- **New verdict class: `availability_blocked`.** The engine now checks whether
  the precompiles a contract actually CALLS (RIPEMD-160 0x03, MODEXP 0x05,
  BLAKE2f 0x09, pointEvaluation 0x0a) exist on the hinted chain. Calling a
  missing precompile is a **deployment-blocking porting trap** (every such
  call reverts at runtime): risk_level `high`, risk_score **0.9** (a new rung
  below the 0.95 validator-delay class — availability, not compute
  asymmetry), `deployable: false`, and a per-precompile detail naming the
  chain and the consequence.
- **Probe-verified missing sets** (live valid-vector probes 2026-10-11,
  `scripts/probe-modexp-regimes.mjs` availability scan): zksync (324, era)
  missing [0x03, 0x09, 0x0a]; polygon-zkevm (1101, zkevm) missing
  [0x03, 0x05, 0x09] — no MODEXP at all, pricing_regime `"unsupported"`;
  scroll (534352) missing [0x03, 0x09]; monad (143) + monad-testnet (10143)
  missing [0x0a]; **linea (59144) has the FULL standard set** including
  0x0a (KZG valid-vector verified).
- **Build-probe corrected the review table twice** (methodology working as
  designed — live probe > on-chain/source > docs): (1) zksync DOES have
  MODEXP (3^5 mod 11 = 1 verified on-chain) with a ≤32-byte operand bound —
  big-input probes revert even under eth_call, so the review's "0x05 REVERT"
  row was a probing artifact; stored as `eip7883` with a BOUNDED-INPUT note.
  (2) linea's 0x0a "REVERT" row was a zeros-input artifact; the valid KZG
  vector returns 0x1000. Inconclusive empty-success responses (polygon-zkevm
  and scroll 0x0a) are deliberately NOT claimed either way.
- **MODEXP gas-ratio analysis is skipped when regime = "unsupported"** — the
  availability verdict owns the outcome (ratio 0, `compute_to_gas_ratio` not
  meaningful on a chain where the precompile does not exist).
- **Dynamic by design (v5.13.0 architecture):** `chain_regimes` gains
  `unsupported_precompiles text[]` (14 rows probed + upserted live);
  resolution hierarchy db-fresh-with-column > snapshot > none; a stale or
  column-less db row falls back to the embedded snapshot; an explicit empty
  db list means "probed, nothing missing" and beats the snapshot.
  `pricing_regime` enum extended with `"unsupported"` (db CHECK constraint
  migrated live).
- **New gas_asymmetry response fields** on dry-run / scan-quick / scan-deep /
  fitness-full: `unsupported_precompiles` (detected ∩ chain-missing),
  `unsupported_precompiles_source` (`db` | `snapshot` | `none`),
  `availability_blocked`. Zero-diff guaranteed for chains without missing
  precompiles and for absent/unknown chain hints (guarded by tests).
- Validation: 87/87 modexp-calc (24 new availability + corrected-regime
  cases) + 29/29 engine-regime + **41/41 new availability engine tests**
  (tests/v513/) + W4 19/19+10/10+20/20 + W3 35/35+22/22+19/19 + offline
  regression 17F/13NC 0 FAIL + live E2E 8/8 (polygon-zkevm+MODEXP blocked,
  zksync+RIPEMD blocked, zksync+MODEXP NOT blocked ratio 2.2, linea+pointEval
  NOT blocked, scroll+RIPEMD blocked, monad+pointEval blocked, no-chain
  zero-diff, manifest 5.13.1-frontier 19 endpoints) + live regression
  17F/13NC 0 FAIL (793ms avg) + paywall 402 intact.

## v5.13.0-frontier — 2026-10-11

### BS-008 v2: DYNAMIC regime map (chain_regimes table + staleness refusal)
- **The chain → MODEXP-pricing regime map no longer lives only in the engine
  bundle.** New `public.chain_regimes` Supabase table is the live source of
  truth, refreshed weekly by `scripts/probe-modexp-regimes.mjs --upsert`
  (live MODEXP price probes; explained anomalies like Arbitrum Nova's
  estimator quirk carry documented overrides, unexplained anomalies fail the
  refresh loudly). `modexp_gas.ts` keeps a 10-minute in-memory cache with a
  4-second non-fatal fetch — hot path stays sub-millisecond and the embedded
  map becomes the disclosed fallback (`regime_source: "snapshot"`).
- **Staleness refusal (user-mandated "no expired maps served silently").** A
  db row older than its `stale_after_days` TTL (30d default) is refused: the
  chain falls back to conservative `eip2565` with `regime_stale: true` and the
  stale `regime_probed_at` disclosed in the response. Failure direction is
  always "flag more, never silently downgrade".
- **New gas_asymmetry response fields** on dry-run / scan-quick / scan-deep /
  fitness-full: `regime_source` (`db` | `snapshot` | `conservative`),
  `regime_stale`, `regime_probed_at`. `ensureRegimeMapFresh()` is called in
  dryRunHandler, handleEvmSentinelScan and handleFitnessFullWithBilling before
  parsing; handlers stay sync beyond that one await.
- **Pre-flight probe is now a standing operational rule** (alongside the
  tool): any protocol review / sweep touching chain pricing must run the
  probe and cite its output.
- Validation: 63/63 modexp-calc (11 new dynamic-map cases: db-fresh beats
  snapshot, stale refused, TTL honored, non-fatal fetch) + 29/29
  engine-regime + W4 19/19+10/10+20/20 + W3 35/35+22/22+19/19 + offline
  regression 17F/13NC 0 FAIL + live E2E (db verdict on polygon, conservative
  on unknown, live stale-flip → refused → restored) + live regression
  17F/13NC 0 FAIL + manifest 5.13.0-frontier 19 endpoints + paywall intact.
- Zero behavior change for chains without a db row and for unknown chains
  (verified zero-diff against v5.12.2 fixtures).

## v5.12.2-frontier — 2026-10-11

### BS-008 v2 regime map: probe-verified corrections + 5 chains added
- **Methodology upgrade: docs-verified → probe-verified.** New permanent tool
  `scripts/probe-modexp-regimes.mjs` distinguishes EIP-2565 vs EIP-7883 by
  live `eth_estimateGas` MODEXP price probes (big-case ~113.6K vs ~549.1K gas,
  ≥3x discriminant). It immediately caught that v5.12.0's docs-based
  `polygon = eip2565` entry had been **wrong since 2025-12-09** (Madhugiri
  hardfork, PIP-76, block 80,084,800, activates EIP-7823/7825/7883 — docs
  search is insufficient as negative evidence; live price behavior is ground
  truth). Lesson recorded: regime claims require probe or on-chain/source
  verification, never docs-only absence claims.
- **Corrected:** `polygon`/`matic`/`137` → `eip7883` (was eip2565). Effect:
  MODEXP-heavy contracts on Polygon now grade protocol-mitigated (ratio ~2.3,
  below high) instead of over-flagged high.
- **Added (all EIP-7883):**
  - `arbitrum`/`arb`/`arbitrum-one`/`42161` — ArbOS 51 Dia, 2026-01-08.
    Source-verified in OffchainLabs/nitro: `gethhook/geth-hook.go`
    `addPrecompiles(StartingFromArbOS50, PrecompiledContractsOsaka)` with
    `bigModExp{eip7883: true}`; on-chain `ArbSys.arbOSVersion()` = 116
    (= 61 + 55 legacy offset); probe-verified.
  - `arbitrum-nova`/`nova`/`42170` — same on-chain ArbOS 61. NOTE: Nova's
    `eth_estimateGas` returns inflated MODEXP estimates (~2M gas floor on two
    independent RPCs — estimator quirk, overpriced/safe direction, not a
    protocol divergence); execution rules identical per source gate.
  - `arbitrum-sepolia`/`421614` — ArbOS 50 Dia, 2025-11-20. Probe-verified.
  - `optimism`/`op`/`10` — probe-verified (554,303 gas big-case).
  - `bsc`/`bnb`/`56` — probe-verified (554,303 gas big-case).
- Origin: protocol review #4 (Arbitrum Stylus, see
  `reference/arbitrum-stylus-review.md`) — Stylus gas model adjudicated CLEAN
  (6/6 hypotheses), regime corrections executed as the "koreksi proyek".
- Validation: 52/52 modexp-calc + 29/29 engine-regime + offline regression
  corpus 0 FAIL (17 fixtures + 13 negatives) + live E2E + live regression.
- Zero behavior change for absent/unknown chain hints (conservative eip2565
  default preserved; NC guards in both suites).

## v5.12.1-frontier — 2026-10-11

### BS-008 v2 regime map: Monad (Osaka) added
- Protocol-review correction #3 (see `reference/monad-protocol-review.md`):
  Monad mainnet (chain id 143) activated Osaka EIPs (EIP-7823/7883/7939) at
  MONAD_NINE, 2026-03-19; Monad testnet (10143) at 2026-03-10. Mechanically
  source-verified in category-labs/monad: `traits.hpp` `eip_7883_active()`
  gated on `evm_rev() >= MONAD_ETH_OSAKA`, `monad_mainnet.cpp` /
  `monad_testnet.cpp` revision gates, and `precompiles_gas_cost_impl.cpp`
  EIP-7883 MODEXP constants (exp_mult 16, min 500, words multiplier) live on
  mainnet (RPC-probed: chainId 0x8f, block gas limit 150M, base fee 100 gwei).
- Regime map: `monad` / `monad-mainnet` / `143` and `monad-testnet` / `10143`
  → `eip7883`. Previously a `chain=monad` hint fell through to the
  conservative eip2565 default and over-flagged unbounded-MODEXP contracts
  that are protocol-mitigated on Monad.
- Zero behavior change for all other chains (verified-only map discipline;
  unknown/absent → eip2565 conservative default unchanged).
- Tests: 41/41 modexp-calc (regime map + Monad aliases), 24/24 engine-regime
  (monad/143/monad-testnet → eip7883, not-high), offline regression mirror
  0 FAIL.

## v5.12.0-frontier — 2026-10-11

### BS-008 v2: fork-aware MODEXP pricing (gas asymmetry)
- Protocol-review correction (see `reference/eip-7883-modexp-review.md`): two
  MODEXP pricing regimes are live side by side. EIP-7883 (Osaka) is active on
  Ethereum mainnet (Fusaka, 2025-12-03) and Base (Azul, 2026-05-28); Polygon
  PoS and unverified chains remain on EIP-2565. EIP-7883 reprices the
  canonical large-input MODEXP class exactly ~6x (multiplication_complexity
  `2*words^2` vs `words^2/3`, identical iteration-count scaling), pushing the
  classic unbounded-MODEXP bomb below the 12.5 validator-delay threshold —
  protocol-mitigated, additionally bounded by EIP-7823's 1024-byte input cap.
- New module `supabase/functions/hello-world/modexp_gas.ts`: deterministic
  dual-regime MODEXP gas calculators (`modexpGasEip2565` / `modexpGasEip7883`),
  `resolvePricingRegime(chain)` with verified-only regime map
  (ethereum/eth/mainnet/1 + base/8453 → eip7883; polygon/matic/137 → eip2565;
  **unknown/absent → eip2565 conservative default — flags more, never silently
  downgrades**), `MODEXP_EIP7883_REPRICE_FACTOR = 6`.
- `parseSolidityContract(source, chain?)` — optional chain hint threaded
  through: free dry-run (`{"chain": "..."}` body field),
  `/evm-sentinel/v1/scan-quick|scan-deep` (`chain` in request body), and
  fitness-full multi-file analysis (`input.chain`, already present).
- Under `eip7883`: unbounded MODEXP ratio becomes `(12.5 + 0.5*calls)/6 ≈ 2.1`
  with `risk_level` below high, `dos_validator_delay=false`, and a dedicated
  "protocol-mitigated" details message; `ratio_basis` cites EIP-7883/7823.
  Bounded-small MODEXP stays 0.4 in both regimes. TSTORE / cold-access
  patterns are **unchanged** (EIP-7883 does not touch TSTORE).
- Response: `contract_info.gas_asymmetry` gains `pricing_regime`
  (`"eip2565"|"eip7883"`) and `osaka_active` (bool). Scan cache key now
  includes the resolved regime (a cached eip2565 verdict is never served for
  an eip7883 query). Downstream gating (localization advice, scan risk score,
  deployable=false) follows automatically.
- **Zero-diff guarantee**: absent/unknown chain ⇒ identical verdicts to
  v5.11.0 (only the two new output fields are added).
- Docs: OpenAPI 3.1 `ScanRequest.chain`; llms.txt chain-hint note.
- Validation: 36/36 calculator unit tests anchored to official EIP price
  vectors (nagydani_3_pow0x10001 5461/32768; marcin_1_base_heavy 200/1152;
  discontinuity + floor cases; formula-tampering NCs) + 21/21 engine-level
  regime tests (default/polygon/unverified flag high; ethereum/base do not;
  TSTORE bomb still flagged under eip7883; aliases) + offline regression
  corpus 12 fixtures + 13 negative controls 0 FAIL + w3/w4 handler suites
  179/179 PASS.
- Known pre-existing quirk (unchanged, documented for v5.13 candidates):
  TSTORE-only bombs grade `risk_level=medium` with `dos_validator_delay=true`
  (the TSTORE grading ladder predates this change by design).

## v5.11.0-frontier — 2026-10-10

### M3: Public Attestation Audit endpoints (zero-trust)
- `GET /attestations` (free, no auth) — public list of every ERC-8004 signed
  fitness attestation ever issued, with anchor status
  (`anchored` / `pending_anchor`). Filters: `day=YYYY-MM-DD`, `service_type`,
  `subject=0x<subjectHash>`, `anchored=0|1`, `limit<=100`.
  `attestation_log` stores no client identifiers — full transparency by design.
- `GET /attestations/proof?hash=0x<struct_hash>` (free, no auth) — full
  zero-trust proof package: EIP-712 domain/types/message/signature/signer
  (verify `signer == ownerOf(636)` on IdentityRegistry
  `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`) + Merkle proof + anchor
  tx/block/`anchored_at` + 5-step verification instructions + standalone
  verifier script link (`scripts/verify-attestation.mjs`). `verdict_hint` is a
  DB convenience; true verification is client-side recomputation.
- New `attestation_log.anchored_at` column (block timestamp of the anchor);
  first batch backfilled (2026-10-10T02:40:08Z). `scripts/anchor-daily.mjs`
  now writes `anchored_at` on every anchor.
- Docs: OpenAPI 3.1 gains both paths (info.version 5.11.0, x-endpoints-free
  updated); llms.txt gains "Signed attestations & public audit" section;
  manifest 5.11.0-frontier lists both endpoints.
- Live validation: public list 200 no-auth (4 rows); proof of anchored
  attestation → status anchored + proof + anchored_at + signer
  0x8096...E2d5; NC malformed hash → 400 INVALID_HASH; NC unknown hash →
  404 ATTESTATION_NOT_FOUND; day/anchored filters verified.

## v5.10.1-frontier — 2026-10-10

### M2: On-Chain Merkle Anchoring for attestations
- New contract `NexusAttestationAnchor` deployed on Polygon PoS:
  `0x3AC325c3FA803192A3E20e726b78F71654E2A02d` (block 95263041, owner = ERC-8004
  #636 treasury). One `anchor(bytes32 root, uint64 day, uint32 count)` per batch;
  root => timestamp is immutable once set.
- Every signed attestation now also returns `struct_hash` (the exact EIP-712
  digest = Merkle leaf) and is persisted to `attestation_log` (PostgREST-readable,
  RLS insert+select) via fire-and-forget `EdgeRuntime.waitUntil` — zero added
  latency, non-fatal.
- `scripts/anchor-daily.mjs`: builds a canonical (sorted, OZ-style) Merkle tree
  per UTC day of unanchored rows, anchors on-chain, writes back
  merkle_root/proof/anchor_tx/anchor_block, records PoA. Runs daily 03:30 UTC via
  cron; ~0.015 POL per anchor.
- `scripts/verify-attestation.mjs`: full public trust-chain verifier —
  (1) EIP-712 recover == signer, (2) signer == ownerOf(636) on IdentityRegistry,
  (3) recomputed struct_hash included in anchored Merkle root, (4) anchoredAt
  timestamp. Verdicts: VERIFIED / PENDING_ANCHOR / FAILED.
- First live anchor: root 0x60626bf2...d559, tx 0x2ea0b4ee...8965f, block 95263172
  (2 attestations, day 2026-10-10). Full chain verified end-to-end.
- Tests: 13/13 Merkle (incl. 3 negative controls), 5/5 signer struct_hash,
  6/6 forge contract tests, live regression (manifest 5.10.1, attestation OK,
  paywall 402, dry-run green).

## v5.10.0-frontier — 2026-10-10

**ERC-8004 Signed Attestations (M1).** Every paid fitness-suite response (`/x402/fitness`, `/x402/fitness/lite`, `/x402/fitness/full`, `/x402/fitness/peer-check`) now carries an `attestation` block: an EIP-712 signature (domain `Nexus Fitness Attestation` v1, chainId 137) over `{serviceType, subjectHash, resultHash, score, issuedAt, agentId, registry}`, signed by the wallet owning ERC-8004 Agent #636. Anyone can verify origin+integrity on-chain: `verifyTypedData` must recover the signer, and signer must equal `ownerOf(636)` on IdentityRegistry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`. New module `attestation_signer.ts`; synchronous signing inside `m2mSuccess` (zero call-site refactors, non-fatal when key absent). Turns attestation track record into a publicly auditable asset — the "credit bureau" moat. legal_weight: 0. Validation: 11/11 unit tests (roundtrip + 3 negative controls + determinism + guard) + live E2E below.


## v5.7.2-frontier (2026-10-04) — Real CVSS Vector Parsing for Exploitability

W3.1 roadmap item closed: the exploitability formula no longer uses the neutral cvss=50
placeholder — it now derives the cvss component from real advisory data.

### Changes
- `osvQuery` exposes the raw CVSS vector string + GHSA `database_specific.severity` label
  per advisory (both previously discarded at parse time).
- New `cvssFromAdvisory()` precedence ladder (deterministic, published):
  1. raw `CVSS:3.x` vector → base score ×10 via `cvss31BaseFromVector`
  2. numeric score string → ×10
  3. GHSA severity label → CRITICAL=95 / HIGH=80 / MODERATE=55 / LOW=25
     (npm advisories carry the label, not the vector)
  4. nothing → 50 neutral (stated, never fabricated)
- Advisories surface `cvss_vector` + `severity_label` in the attestation for independent verification.
- **Bug fix:** CVSS 3.1 Scope-Changed impact term used the v3.0 form `((ISC−0.02)^15)` —
  corrected to the v3.1 spec `((ISC−0.973)^13, FIRST)`.

### Validation
- 19/19 v5.7.2 unit suite (ladder + FIRST-official vector values + E2E determinism).
- Regression: 22/22 W3.1 + 35/35 W3.0 + 4/4 handler NC + explorer-down NC + 6/6 source-match.
- Live E2E: paid call (lodash) 225 CRED → 10 advisories with real cvss components (53–91,
  previously all 50), max exploitability 57→71; cvss_vector visible in attestation;
  regressions green (dry-run 200, paywalls 402, forensic 501).

## v5.7.1-frontier (2026-10-04) — W3.1: Packages Input + Auto Import Extraction

- Optional `{packages:[{name, ecosystem?, version?}]}` (max 25) on `POST /x402/fitness/full`.
- Dependencies auto-extracted from Solidity import directives (OZ/OZ-upgradeable/solady/
  solmate/murky/erc4626 aliases, `@scope/name`, bare first-segment; relative imports and
  dev-tooling excluded), merged with user input (dedup, cap 25, deterministic order,
  `origin: "input"|"imports"`).
- Per-advisory OSV queries drive exploitability; advisories surface in the attestation
  with package attribution.
- Graceful fallback: no dependency list → transparent `dependency_notice` (never fabricated).
  OSV down → `degraded: true`, cvss component 50 neutral (non-fatal, spec §4).
- Fix: duplicate `fitness_full` PRICING_MODEL key removed (stale PLANNED entry).
- Tests: 22/22 W3.1 unit + 4/4 handler NC.

## v5.7.0-frontier (2026-10-04) — W3 Fitness Full: Exploitability + Source Match

- `POST /x402/fitness/full` $2.25 (225 CRED) live: gas rank (identical to Lite) +
  base attestation + Exploitability Score 0-100 (fixed weights 0.35 cvss / 0.25 reachability /
  0.15 exploit_maturity / 0.15 freshness_penalty / 0.10 asset_exposure) + bytecode_match
  via Blockscout source-match (D1: source-match, NOT self-compile — deferred to v5.8+;
  D2: cache hit charges full price — cache is speed, not discount).
- Module `w3_fitness_full.ts`; handler `handleFitnessFullWithBilling` in index.ts.
- Validation: offline 53/53 + live E2E (402 x402 2250000 atomic, paid 225 CRED,
  422 ADDRESS_HAS_NO_CODE pre-billing, regressions intact). Manifest 17 endpoints.

## v5.6.0-frontier (2026-10-04) — W4 M4: Mainnet Calibration + Static Reference Cohort

W4 (Gas Efficiency Rank) milestone 4 complete. `/x402/fitness/lite` now ranks against a
mainnet-calibrated reference cohort.

### Engine (w4_gas_rank.ts)
- **Modifier-body inlining**: body modifiers (USDC `notBlacklisted`/`whenNotPaused` class) now
  inlined into callers — their SLOADs are counted (previously invisible).
- **Cross-file union**: modifier bodies + internal fns merged across all repo files (inheritance
  chains live in sibling files: FiatTokenV1 uses notBlacklisted declared in Blacklistable.sol).
- **Read-before-write SSTORE classification**: a state var read before write implies non-zero
  slot → SSTORE_UPDATE (7100) not SSTORE_NEW (22100). WMATIC withdraw error -69% → -25%.

### Cohort v1.2.0-m4-static-cohort
- Distribution built from STATIC ESTIMATES of reference contracts (USDC FiatTokenV1, WMATIC WETH9,
  OZ ERC20 v5, Solady ERC20, OZ ERC20Burnable, Uniswap V2 Router/Pair + V3 Pool, Sushi MasterChef)
  — same estimator basis as ranked subjects, so systematic static-vs-runtime bias cancels out.
- Mainnet measurements (Polygon PoS 2026-10-04: USDC 368 transfer / 65 transferFrom / 28 approve
  txs, QuickSwap-class router swaps, WMATIC withdraw) validate the ±40% error band, NOT the cohort
  distribution (measured-vs-static would be apples-vs-oranges ranking).

### Tests
- M4-CALIBRATION suite: NC 422-class ×3 (no-sol, vendored-only, interface-only), determinism
  byte-identical, cohort version — 35/35 total green (M2 30 + M4 5).
- Offline handler harness: fitness-lite 19/19, GAS_RANK_RESULT structure 10/10, peer-check 20/20.
- Live E2E: manifest 5.6.0-frontier (16 endpoints), fitness/lite paid call 125 CRED charged
  (cohort 1.2.0, composite 25/D on SimpleToken), cache hit 200, 422 NO_SOL_FILES pre-billing
  credits 0, dry-run regression green (pragma contract deployable true), scan-quick/fitness/
  peer-check 402 paywalls intact, docs routes 200.
- PoA: engine_v5.6.0_w4_m4_calibration (184cf385).

---

## v5.5.1-frontier (2026-10-03)

**EVM Sentinel FP Precision Upgrade — bounty-sweep hardening**

### Fixed (all FP classes found in BS-012 Sweep Round 1: Boros/Intuition/Ostium)
- **Modifier helper-call guard resolution**: custom modifiers delegating the check to a
  private helper (`modifier onlyVault() { _onlyVault(msg.sender); }` — Ostium pattern)
  now resolve the helper body (one hop, with-arg and no-arg forms). Fake guards whose
  helper contains no msg.sender check/revert still count as unguarded.
- **Comment stripping in guard classification**: a comment saying "reverts if unauthorized"
  inside a modifier/helper body no longer makes an unguarded modifier look guarded.
- **BS-012 PRNG word boundaries**: `withdrawal` (contains "draw") no longer matches the
  game-context regex — only whole-word PRNG terms (random/winner/raffle/...) count.
- **BS-012 cooldown bookkeeping strip**: cast forms like `user.start = uint32(block.timestamp);`
  (withdrawal cooldown bookkeeping, Boros MarketHubEntry) are stripped before entropy analysis.
- **BS-013 initializer modifiers**: OZ `initializer`/`reinitializer`/`onlyInitializing`/
  `disableInitializers` count as guarded initializers (Boros DepositBox, Ostium PriceUpKeep).
- **Self-delegatecall trusted**: `address(this).delegatecall(...)` (Ostium retry/delegation
  pattern) is not a reentrancy surface — target is own code, not attacker-controlled.
  Bare/user-address delegatecall still counts.

### Validation
- Local bundle harness: 7 real trigger files (Boros MarketHubEntry/DepositBox, Ostium
  LockedDepositNft/PriceUpKeep/Delegatable/Trading, Intuition TrustBonding) → all CLEAN.
- Regression corpus: 12 fixtures + 11 negatives (3 new: NC9 fake-guard helper modifier
  → BS-001 critical, NC10 raffle-withdraw → BS-012 high, NC11 attacker delegatecall →
  BS-006 high) → 0 fail PASS.

## v5.0.0-frontier (2026-09-24)

**EVM Sentinel M2M Scan Endpoints — USDC-only external pricing**

### Added
- **`POST /evm-sentinel/v1/scan-quick`** ($0.05 USDC): fast static security scan for
  machine agents. Returns `{risk_score, breach_scenarios[], gas_ratio, action: ALLOW|BLOCK}`
  plus honeypot indicators and cache status. Input validation (min 20 chars, max 150000)
  runs BEFORE billing (400/413, not 402).
- **`POST /evm-sentinel/v1/scan-deep`** ($0.50 USDC): full-depth scan adding BS-010
  Permit2 wallet-drainer detection and BS-011 arbitrage-execution manipulation analysis
  with per-scenario detail.
- **x402-native billing**: 402 responses carry the x402 `payment-required` header
  (x402Version 2, eip155:137, USDC, atomic amounts 50000/500000, payTo treasury).
  External surface is USDC-only; CRED remains the internal DB unit.
- **1-hour scan cache** keyed on code hash + tier (scan_cache table).
- **GET on scan routes → 405** (POST-only resource).

### Changed
- **USDC-only docs purge**: llms.txt, pricing, OpenAPI spec (scan paths + schemas +
  x-keywords honeypot-check/drainer-detector/risk-gate), terms (read-only
  no-wallet-approval clause), node manifest (currency_unit USDC, version 5.0.0-frontier),
  and all 402/trial/auto-reply messages now quote USDC directly.

### Fixed (engine v5.0.1 false-positive reductions)
- **BS-006 Reentrancy**: an "external function" is no longer automatically a reentrancy
  surface — the function body must actually perform an external call
  (`.call(`/`.transfer(`/`.send(`/`delegatecall`). Plain external setters/getters no
  longer flag high.
- **BS-007 Replay**: nonce-absence only counts as detected when a signature/permit
  surface exists (matches Gate v1.1 design where BS-007 medium is excluded as noise).
- **BS-010 Drainer**: a `permit2.permit()` / ISignatureTransfer call site is treated as
  a signature-verification surface (verification happens inside Permit2) — unbound
  signature + full-balance sweep now correctly rates critical.
- **BS-011 Arbitrage**: zero-min-out detection extended to positional zero arguments
  (`swap(0, ...)`, `swap(x, 0, ...)`) and `minOut`/`amountOutMinimum` aliases.
- **overall_risk**: computed from DETECTED scenarios only — undetected scenarios no
  longer inflate clean contracts to "medium".

### Validation
- 29/29 local tests PASS; live verified: honeypot BLOCK (risk 1), drainer BS-010
  critical BLOCK, clean contract ALLOW (risk 0.05), cache hit, 402 x402 headers,
  docs routes 200, dry-run regression (clean → low risk, deployable).

## v4.7.0-frontier (2026-09-21)

**Custom Access-Control Modifier Recognition + 150KB Payload Limit**

### Added
- **Custom modifier guard classification (v4.7.0)**: the static parser now classifies
  developer-defined modifiers by analyzing their body. A custom modifier whose body
  enforces a guard (msg.sender check, revert, or authority/ACL delegation such as
  `canCall`/`hasRole`/`requiresAuth`) is recognized as access control on functions
  that apply it. Previously only built-in OZ-style names (`onlyOwner`, `onlyRole`, ...)
  counted, producing false positives on contracts using e.g. Solmate-style
  `requiresAuth`.
- **Inherited-modifier name convention layer**: modifiers not declared in the parsed
  file (inherited from base contracts) are evaluated by naming convention
  (`requiresAuth`, `onlyXxx`, `authorized`, `restricted`, ...). Non-guard inherited
  modifiers (`whenNotPaused`, `initializer`, `nonReentrant`) do not match.
- **ERC-4626 vault awareness**: a contract detected as an ERC-4626 vault
  (inheritance/interface or deposit+asset() signature) no longer flags BS-001/BS-003
  critical for its by-design open `deposit`/`mint` share issuance — provided at least
  one guarded operator path exists (the standard vault pattern). A broken vault with
  open mint and NO guarded operator path is still flagged critical (negative-control
  verified). This eliminates the false-positive class observed on real-world vaults
  (e.g. YoVault async-redemption pattern).

### Changed
- **Dry-run payload limit raised 50KB → 150KB**: modern multi-function contracts
  (facet-based diamonds, large vaults) routinely exceed 50KB and were rejected with
  HTTP 413, forcing manual-review fallback in automated pipelines. 150KB keeps abuse
  protection intact while covering real-world contract sizes.

### Validation (Quality Gate Layer 2.5)
- Local suite: 11/11 PASS (custom modifier parse, guarded modifier recognition,
  unguarded-modifier negative control, onlyOwner regression, unprotected-mint
  regression, authority-delegation recognition, BS-009 dust-spam regression,
  150KB-scale parse).
- ERC-4626 negative controls: 2/2 PASS (broken vault with open mint + no operator
  path still critical; vault without guarded operator path still critical).
- Real-world verification: YoVault.sol (495 lines, previously BS-001/BS-003 critical
  false positive) now evaluates BS-001/BS-003 low, deployable=true.
  DynamicFeesVault.sol (52.7KB, previously HTTP 413) now screens cleanly.
- Live production verification: all green (YoVault low/low, DynamicFeesVault parsed,
  negative control critical).

### Integration
- Delta-commit monitoring pipeline (`nexus-outbound-advisory/delta_monitor.py`)
  client-side payload cap updated 48KB → 145KB to match the new engine limit.

---

## v4.6.0-frontier (2026-09-21)

Outbound PoA Ledger (public.poa_ledger, RLS append-only) + Quantitative Gas
Asymmetry Detector (compute_to_gas_ratio, threshold 12.5, risk ladder
0.05/0.25/0.6/0.95, dos_validator_delay) + H2M Email Ingestion
(POST /ingest/security-inquiry, urgency classifier, H2M baseline quotes).
Validation: 28/28 local tests + negative control (6 injected defects caught) + live.

## v4.5.0-frontier (2026-09-18)

Tiered Legal-Code Pricing (light $300 / standard $450 / enterprise $800 via
params.tier) + EVM Sentinel Quick Scan relabel for code_modules.

## v4.4.0–v4.2.0-frontier (2026-09-08 → 09)

BS-009 Unbounded Iteration DoS + Revert-Blocking Detection, Signature Binding
Analysis (BS-007 extension), BS-001/BS-003 access-control modifier recognition
(onlyOwner class), BS-008 Gas Asymmetry DoS Detection (MODEXP/TSTORE/cold access),
Deadline Buffer Extension 30–60 min (Polygon PoS checkpoint interval),
False-Positive Reduction (transient storage, immutability, Permit2 chain-binding).

## v4.1.0-frontier (2026-09-08)

Phase 3.4 False Positive Reduction: transient storage detection, immutability
awareness, Permit2 chain-binding recognition.

## v4.0.0 (2026-09-05)

Digital Twin Engine Upgrade: deep parser (Phase 3.1), Automated Breach Simulation
(Phase 3.2, 6 scenarios), Nonce & Replay Defense Alignment (Phase 3.3). E2E 17/17.

## v3.x (2026-08-31 → 09-04)

M2M Output Standardizer, Pipeline Optimization, Concurrency Guard, Algorithmic
Nudging, Interactive Dry-Run, Live Telemetry, Sample Manifests, Pull Payment Module
(EIP-712 USDC on Polygon), mandatory x-client-id, free-trial bugfix.

## [5.5.3] — 2026-10-03 (Sweep Round 2 FP fixes)

5 fix FP dari adjudikasi Layer 1 target sweep nyata (Morpho vault-v2, nitro-contracts, Polymarket, Compose):

- **Internal-call guard resolution**: `addAdapter(){ timelocked(); }` — guard via internal function call di body di-resolve satu hop (helper body berisi require/revert/msg.sender check, comment-stripped). Fake helper (bookkeeping only) tetap unguarded (NC12).
- **Self-delegatecall loop exclusion**: `address(this).delegatecall` dalam loop (multicall pattern) bukan revert-blocking surface (Morpho VaultV2).
- **Bounded MODEXP**: input fixed 32-byte (`abi.encode(32,32,32,...)`, nitro modExp256) tidak lagi BS-008 high; unbounded/dynamic tetap high (NC13).
- **ERC-8042 free-function file awareness**: file tanpa contract/library wrapper (Compose "Mod" files) = semua function internal-only, tidak ada state vars. Sebelumnya local `address owner = s.ownerOf[...]` diparse sebagai state var privileged → BS-013 critical FP x16.
- **Guard idiom extensions**: if-revert brace form `if (msg.sender != X) { revert }`; BS-002 delegation prefixed helper (internalTransferFrom); BS-013 dotted member assignment (s.owner = x) lookbehind.
- **Validator**: CONTRACT_REQUIRED hanya error bila tidak ada contract DAN tidak ada function declaration (free-function file valid = 200).

Validasi: regression 12 fixture + 13 negatives 0 fail; Compose 105/105 clean; ToB Unprotected real tetap BS-013 critical; Morpho VaultV2 + nitro + Polymarket clean; live PASS (latency 449ms). Commits: f27faa7, 980839a, 54e9925, 11ae767. PoA recorded.

## [4.8.0-frontier] — 2026-09-24

### Added
- **Agent-Readable Docs Routes** — 6 routes served at base_url so agent
  directories (x402-list site-signal checker) find valid content instead
  of the manifest catch-all:
  - `GET /openapi.json` — OpenAPI 3.1.0 spec (3 paid endpoints, request/response schemas, x-pricing extensions)
  - `GET /llms.txt` — agent-first discovery doc (text/plain)
  - `GET /pricing` — plain-text pricing sheet (text/plain)
  - `GET /robots.txt` — crawler directives with discovery URLs (text/plain)
  - `GET /terms` — terms of service (text/plain)
  - `GET /` — 301 redirect to landing page (homepage signal)

### Fixed
- Route normalization for the Supabase Deno runtime mount prefix: the
  runtime hands the function a pathname of `/v1/hello-world/<path>`
  (not the full external `/functions/v1/hello-world/<path>`), which
  broke naive prefix stripping. Normalization now slices after the
  function slug, handling all observed mount styles.

### Validation
- 22/22 local harness PASS across 3 mount-path styles; live all 6
  signals green; regressions intact (manifest, metrics, samples,
  dry-run, 402/x402 paid flow). Commit af1e098. PoA a21f9e4d.

## v5.14.1-frontier (2026-10-12)
- **Validator bug fix (2/12 real-file false-422)**: paren/brace balance counter no longer counts literals inside strings and comments. New `stripStringsAndComments()` state machine runs before both balance loops; newlines preserved so error line numbers stay exact. Real-world cases fixed: SoSoValueLabs/ssi-protocol (422→200 clean), dangerousfood/ethstrategy (422→200 clean).
- **BS-014 guard class (a): zero-endTime voting window** — per-proposal upper-bound window (`block.timestamp <= proposal.endTime/deadline/...` forward or reversed, prefix proposal/proposals[]/prop required) counts as an existence proof: a phantom id yields endTime=0, so the window check reverts. Real-world FP fixed: genyleap/geny-token (536★).
- **BS-014 guard class (b): enum-state existence** — `.state != ProposalState.X` guard credited when the enum's first member is a zero-default non-existence sentinel (NonExistent/None/Unset/Uninitialized/Empty/Null/Undefined). Real-world FP fixed: SoSoValueLabs/ssi-protocol. Computed `state()` mappings (Confetti class) remain non-guards by design.
- **Known limit (documented, not fixed)**: bare signaling vote counters with no proposal lifecycle/execution path (Grok-chain class) remain flagged — distinguishing impactless signaling votes needs cross-function impact analysis beyond static scope; Layer 1 catches these.
- Validation: tests/v514 9/9 + new v5.14.1 suite 11/11 + offline regression 22F/16NC 0 FAIL + v512 34+87 + v513 41 + W4 30+5+19+10+20 + W3 35+22+19 + live E2E (SoSoValue/ethstrategy 200 clean, NC16 Confetti still high, genyleap clean, grok flagged) + live regression 22F/16NC 0 FAIL 740ms. PoA 462e33a7.
