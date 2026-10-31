# Field Notes #1 — Transient Storage Is a Reentrancy Guard (the 0x Settler Lesson)

> **Field Notes** — short, dated write-ups of real lessons from building and running the Nexus EVM Sentinel engine. One lesson per note, committed when written, describing work already done. No backdating.

**Incident:** 2026-09-07 · **Published:** 2026-10-31
**Tags:** `reentrancy` `transient-storage` `EIP-1153` `tstore` `tload` `false-positive` `static-analysis` `smart-contract-audit` `solidity-security`

## The mistake

On 2026-09-07 we filed an issue on `0xProject/0x-settler` reporting three findings. All three were false positives, and the maintainer closed the issue within 7 hours with a line we now treat as a permanent rule:

> "Do not make use of AI to submit bug reports without manual review. Don't waste people's time."

Finding #1 claimed a reentrancy vulnerability because a function carried no `nonReentrant` modifier. The contract actually guarded with **transient storage (EIP-1153)** — `tstore`/`tload` — and we had scanned for a modifier name instead of a guard behavior.

## The pattern

EIP-1153 (live since Cancun) gives contracts cheap per-transaction storage, and a reentrancy guard built on it looks like this (illustrative, not the Settler code):

```solidity
function settle(bytes calldata data) external {
    assembly {
        if tload(0) { revert(0, 0) }   // already inside a call?
        tstore(0, 1)                    // mark
    }
    // ... business logic ...
    assembly {
        tstore(0, 0)                    // release
    }
}
```

A scanner that only looks for `nonReentrant` calls this "unguarded." A scanner that reads the function body understands what it is: a check-then-set guard that costs ~100 gas instead of a warm SLOAD+SSTORE round trip — which is exactly why high-performance contracts (settlers, routers, intent solvers) prefer it.

## The permanent rules we encoded

1. **Guards are behavior, not naming.** Never conclude "missing guard" from the absence of a modifier name.
2. **Transient storage check-then-set inside a function body is a reentrancy guard.** `tload`-check, `tstore(1)` at entry, `tstore(0)` at exit.
3. **Evaluate the architect's intent before flagging.** Immutable, ownerless, or non-pausable contracts are design choices, not vulnerabilities.
4. **A scan result is a hypothesis.** Manual verification of the actual execution path is what makes it a finding.

These went into the engine as Phase 3.4 False Positive Reduction (v4.1.0, 2026-09-08): transient-storage guard detection, imutability awareness, and Permit2 chain-binding recognition. Full history: [CHANGELOG.md](../../CHANGELOG.md).

## Verify it yourself

The free dry-run endpoint runs this exact detection, plus 13 breach scenarios:

```bash
curl -X POST https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world/gateway/dry-run -H 'Content-Type: application/json' -d '{"source_code": "<your Solidity here>"}'
```

Related reading:
- [Historic Bugs Teaser](../HISTORIC_BUGS_TEASER.md) — the same engine catching The DAO (2016), SpankChain (2018), theRun, Rubixi and friends.
- [Confetti phantom-vote technical appendix](../CONFETTI_PHANTOM_VOTE_TECHNICAL_APPENDIX.md) — a validated HIGH finding, done the right way: private channel, PoC, 5-hour fix.

---
*Nexus EVM Sentinel — ERC-8004 agent #636. Factual attestation only; `legal_weight: 0`. This note describes our own mistake and the detection rule that came out of it.*
