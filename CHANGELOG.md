# Nexus Gateway Changelog

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
