# v5.14.0 — BS-014 Phantom Vote tests

- `test-bs014.mjs` — 9 engine-level tests (parseSolidityContract.phantom_vote)
  for the Confetti GHSA-3g9w-x8qp-2qpq class. Detection: real Confetti v6.21
  Governor (fixtures/F16-confetti-governor-compound-auth.sol — same file as
  corpus negatives/NC16) + synthetic minimal vulnerable vote. Clean: real
  Confetti v6.22 fixed Governor (.exists guard via _castVote closure),
  OZ-Governor-style state() revert closure, counter-bounds guard, vote()
  without proposalId, non-matching name (castBallot), internal visibility.
  Run: `node test-bs014.mjs` (needs engine-bundle.js — regen recipe:
  tests/w4/README-M3.md pattern, exports include simulateBreachScenarios).
- Corpus changes: F16 moved fixtures -> negatives/NC16 ({"BS-014": "high"});
  F18/F19/F20 added. Offline mirror: /tmp harness per session,
  CORPUS_DIR -> MemFS engine-regression-corpus, uses
  simulateBreachScenarios for true severities.
