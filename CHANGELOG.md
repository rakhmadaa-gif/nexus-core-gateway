# Nexus Gateway Changelog

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
