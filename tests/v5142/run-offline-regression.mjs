// Offline regression mirror (v5.14.1) — mirrors MemFS run_regression.py
// exactly, but runs against the local engine bundle (pre-deploy gate).
import "./deno-stub.mjs";
import { parseSolidityContract, simulateBreachScenarios, validateSoliditySyntax } from "./engine-bundle.js";
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const CORPUS = process.env.MEMORY_DIR + "/reference/engine-regression-corpus";
const SEV = { low: 1, medium: 2, high: 3, critical: 4 };
const NEG_MIN_SEVERITY = {
  "NC1-bad-transfer.sol": { "BS-002": "high" },
  "NC2-dust-spam.sol": { "BS-009": "high" },
  "NC3-public-grow-admin-loop.sol": { "BS-009": "medium" },
  "NC4-public-reentrancy.sol": { "BS-006": "high" },
  "NC5-therun-randomness.sol": { "BS-012": "critical" },
  "NC6-unprotected-owner.sol": { "BS-013": "critical" },
  "NC7-dao-refund-reentrancy.sol": { "BS-006": "high" },
  "NC8-spankchain-createchannel-reentrancy.sol": { "BS-006": "high" },
  "NC9-helper-modifier-bypass.sol": { "BS-001": "critical" },
  "NC10-raffle-withdraw.sol": { "BS-012": "high" },
  "NC11-delegatecall-attacker-target.sol": { "BS-006": "high" },
  "NC12-fake-guard-internal-call.sol": { "BS-009": "medium" },
  "NC13-modexp-unbounded.sol": { "BS-008": "high" },
  "NC14-unchecked-6909-transfer.sol": { "BS-002": "high" },
  "NC15-compound-ifrevert-noauth.sol": { "BS-013": "critical" },
  "NC16-confetti-phantom-vote.sol": { "BS-014": "high" },
  "NC17-hypercore-porting-trap.sol": { "BS-015": "medium" },
};

const sim = (file) => simulateBreachScenarios(parseSolidityContract(readFileSync(file, "utf8")));
const fails = [];
const t0 = Date.now();

// GUARDED (v5.14.2): real-world files that carry accepted medium warnings
// (documented engine behavior) but whose specific guard-class scenario must
// stay silent. Also covers the validator: zero severity-"error" issues (the
// v5.14.1 false-422 string/comment literal class).
const GUARDED_MUST_NOT_DETECT = {
  "F21-genyleap-zerowindow-guard.sol": ["BS-014"],
  "F22-sosovalue-enum-state-guard.sol": ["BS-014"],
  "F24-ethstrategy-string-parens.sol": ["BS-014"],
};

for (const f of readdirSync(path.join(CORPUS, "guarded")).filter(x => x.endsWith(".sol")).sort()) {
  const src = readFileSync(path.join(CORPUS, "guarded", f), "utf8");
  const errCount = validateSoliditySyntax(src).issues.filter(i => i.severity === "error").length;
  if (errCount > 0) fails.push(`${f}: VALIDATOR 422-class (${errCount} error issue(s))`);
  const r = sim(path.join(CORPUS, "guarded", f));
  const det = new Set((r.scenarios || []).filter(s => s.detected).map(s => s.scenario_id));
  for (const sid of GUARDED_MUST_NOT_DETECT[f] || []) {
    if (det.has(sid)) fails.push(`${f}: GUARD-BROKEN ${sid} detected (harus tetap silent)`);
  }
}

for (const f of readdirSync(path.join(CORPUS, "fixtures")).filter(x => x.endsWith(".sol")).sort()) {
  const r = sim(path.join(CORPUS, "fixtures", f));
  const flags = (r.scenarios || []).filter(s => s.detected && ["high", "critical", "medium"].includes(s.risk_level))
    .map(s => `${s.scenario_id}:${s.risk_level}`);
  if (flags.length) fails.push(`${f}: FP ${flags.join(",")}`);
}
for (const f of readdirSync(path.join(CORPUS, "negatives")).filter(x => x.endsWith(".sol")).sort()) {
  const r = sim(path.join(CORPUS, "negatives", f));
  const det = {};
  for (const s of r.scenarios || []) if (s.detected) det[s.scenario_id] = s.risk_level;
  for (const [sid, min] of Object.entries(NEG_MIN_SEVERITY[f] || {})) {
    const act = det[sid];
    if (!act) fails.push(`${f}: MISS ${sid} (harus ${min})`);
    else if (SEV[act] < SEV[min]) fails.push(`${f}: UNDER-SEVERITY ${sid}=${act} (harus >= ${min})`);
  }
}
const nF = readdirSync(path.join(CORPUS, "fixtures")).filter(x => x.endsWith(".sol")).length;
const nN = readdirSync(path.join(CORPUS, "negatives")).filter(x => x.endsWith(".sol")).length;
const nG = readdirSync(path.join(CORPUS, "guarded")).filter(x => x.endsWith(".sol")).length;
console.log(`Fixtures: ${nF} | Guarded: ${nG} | Negatives: ${nN} | Fail: ${fails.length} | ${Date.now() - t0}ms`);
for (const f of fails) console.log("  ❌", f);
console.log("VERDICT:", fails.length ? "FAIL" : "PASS");
process.exit(fails.length ? 1 : 0);
