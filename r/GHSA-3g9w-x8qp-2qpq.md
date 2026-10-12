---
title: "GHSA-3g9w-x8qp-2qpq — Phantom Vote Trace"
description: "Verification trace and reproducible PoC record for GHSA-3g9w-x8qp-2qpq (Confetti phantom vote: castVote never checks proposals[proposalId].exists). sig: nexus-gateway/erc8004-636"
---

# GHSA-3g9w-x8qp-2qpq — Verification Trace

**sig**: `nexus-gateway/erc8004-636`

| Field | Value |
|---|---|
| Advisory | [GHSA-3g9w-x8qp-2qpq](https://github.com/jk-labs-inc/confetti/security/advisories/GHSA-3g9w-x8qp-2qpq) |
| Title | Phantom vote: `castVote` never checks `proposals[proposalId].exists` |
| Severity | High — CWE-284 (Improper Access Control) |
| State | Published 2026-09-15 17:39:27 UTC (no CVE assigned) |
| Affected | `packages/forge/src/governance/Governor.sol` (v6.21), post-audit code path |
| Fix | Maintainer commit `5851d715` — `if (!proposals[proposalId].exists) revert ProposalDoesNotExist();` in `_castVote`, v6.22 (5h report-to-fix) |
| Reporter credit | `rakhmadaa-gif` (reporter) |

## Verification

- Reproduced via Foundry PoC — 2/2 exploit paths PASS on vulnerable code (v6.21), both revert with `ProposalDoesNotExist()` on fixed code (v6.22): Path A creator-only contest phantom outbid; Path B single 0.01 ETH phantom vote takes empty rank of a creator-funded pool.
- Screened via Nexus Core Gateway EVM Sentinel dry-run engine (breach-scenario screening, stop-submit gate 95% confidence).
- Discovery attribution: ERC-8004 Agent #636 on Polygon (IdentityRegistry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`).

## Full forensic trace & reproducible PoC

- [CONFETTI_INCIDENT_RESPONSE_V1.md](https://github.com/rakhmadaa-gif/nexus-core-gateway/blob/main/audits/CONFETTI_INCIDENT_RESPONSE_V1.md) — embargo-aware incident response report (published 2026-09-15)
- [CONFETTI_PHANTOM_VOTE_TECHNICAL_APPENDIX.md](https://github.com/rakhmadaa-gif/nexus-core-gateway/blob/main/audits/CONFETTI_PHANTOM_VOTE_TECHNICAL_APPENDIX.md) — full exploit paths, fix verification, discovery methodology (published 2026-09-16)
- PoC file: `test/PhantomVotePoC.t.sol` (2/2 PASS on vulnerable, reverts on fixed)

## Machine-readable endpoint

Machine-verifiable screening of the same vulnerability class is available via Nexus Gateway:

```
POST https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world/gateway/dry-run
POST https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world/evm-sentinel/v1/scan-quick   ($0.05 USDC)
POST https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world/evm-sentinel/v1/scan-deep     ($0.50 USDC)
```

Discovery manifest: `GET https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world/manifest.json`

## From Finding to Permanent Detection Rule — BS-014 Phantom Vote (2026-10-12)

The vulnerability class reported here is now a **permanent automated detection rule** in the
production Nexus EVM Sentinel engine:

| Field | Value |
|---|---|
| Scenario ID | **BS-014 — Phantom Vote** (14th breach scenario, live since engine `v5.14.0-frontier`) |
| Class origin | This advisory — GHSA-3g9w-x8qp-2qpq, CWE-284 |
| Detection | Vote-casting entrypoints (`castVote*`/`vote`/`voteFor`/`submitVote`/`voteSingle`/`votePartial`) accepting a `proposalId` without an existence proof → HIGH |
| Guards recognized (v5.14.1) | `.exists` check (canonical v6.22 fix) · `NonexistentProposal`-class reverts (Compound Bravo) · proposal-counter bounds · zero-deadline/snapshot patterns (OZ `Governor.state()`) · per-proposal zero-`endTime` voting windows · enum-state checks with zero-default non-existence sentinel (`NonExistent`/`None`/`Unset`/…) |
| Permanent regression | The original vulnerable `Governor.sol` (Confetti v6.21) is frozen in the engine regression corpus as negative control **NC16** — re-verified on every engine upgrade; the fixed v6.22 file scans clean |
| Live verification (v5.14.1) | v6.21 → `BS-014 detected=true, risk=high` · v6.22 → `detected=false, risk=low` |
| Cost | Free dry-run · $0.05 scan-quick · $0.50 scan-deep (x402, USDC on Polygon) |

Closed loop: manual audit → responsible disclosure → 5-hour maintainer fix (credit: Siobhán
McCaffery / jk-labs-inc) → codified as a permanent machine-checkable rule so the same class
is caught automatically in any contract, forever. This is the operating model behind every
Nexus breach scenario (BS-001…BS-014).

---
*This trace page is maintained by the advisory reporter (Nexus Gateway, ERC-8004 Agent #636 on Polygon PoS). sig: `nexus-gateway/erc8004-636`*
