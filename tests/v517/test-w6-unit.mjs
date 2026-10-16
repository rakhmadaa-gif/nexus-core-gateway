// v5.17.0 — W6 forensic unit tests, written against the REAL w6_forensic API.
// MergedScenario = { scenario: ScenarioLike, detected_in: string[] }
// Run: node test-w6-unit.mjs  (w6-bundle.js must be fresh)
import {
  W6_MODEL,
  validateForensicInput,
  mergeScenarios,
  selectTopScenarios,
  buildNarrative,
  isDrainClass,
  buildObservableImpact,
  buildForensicBundle,
  OMIT_REASON_NO_VALUE_TRANSFER,
  OMIT_REASON_SOURCE_ONLY,
  OBSERVED_LABEL,
} from "./w6-bundle.js";

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const scen = (id, sev, fns = ["f"], detected = true) => ({
  scenario_id: id,
  scenario_name: `Name ${id}`,
  description: `desc ${id}`,
  risk_level: sev,
  affected_functions: fns,
  mitigation: "mit",
  detected,
});
const mergedOf = (s, files = ["A.sol"]) => ({ scenario: s, detected_in: files });

console.log("W6 unit — validateForensicInput");
{
  const r1 = validateForensicInput({ files: [{ path: "A.sol", source: "contract A{}" }] });
  t("V1 valid files input", r1.ok === true, JSON.stringify(r1));
  const r2 = validateForensicInput({ repo: "a/b", files: [{ path: "A.sol", source: "x" }] });
  t("V2 repo XOR files -> reject", r2.ok === false, JSON.stringify(r2));
  const r3 = validateForensicInput({});
  t("V3 neither repo nor files -> reject", r3.ok === false);
  const r4 = validateForensicInput({ files: [{ path: "A.sol", source: "x" }], address: "0x123" });
  t("V4 bad address -> reject", r4.ok === false);
  const r5 = validateForensicInput({ files: [{ path: "A.sol", source: "x" }], address: "0x" + "ab".repeat(20) });
  t("V5 valid address accepted (observable mode)", r5.ok === true);
  const r6 = validateForensicInput({ files: [{ path: "A.sol", source: "x" }], chain: "ethereum" });
  t("V6 non-polygon chain -> reject (v5.17.0 polygon only)", r6.ok === false);
}

console.log("W6 unit — mergeScenarios");
{
  const perFile = [
    { file: "A.sol", scenarios: [scen("BS-006", "medium", ["a"]), scen("BS-009", "low", ["x"])] },
    { file: "B.sol", scenarios: [scen("BS-006", "high", ["b"]), scen("BS-009", "low", ["y"])] },
  ];
  const merged = mergeScenarios(perFile);
  const bs6 = merged.find((m) => m.scenario.scenario_id === "BS-006");
  const bs9 = merged.find((m) => m.scenario.scenario_id === "BS-009");
  t("M1 worst severity wins (medium+high -> high)", bs6.scenario.risk_level === "high");
  t("M2 fn union first-seen", JSON.stringify(bs6.scenario.affected_functions) === JSON.stringify(["a", "b"]), JSON.stringify(bs6.scenario.affected_functions));
  t("M3 detected_in attribution both files", JSON.stringify(bs6.detected_in) === JSON.stringify(["A.sol", "B.sol"]), JSON.stringify(bs6.detected_in));
  t("M4 same severity keeps first", bs9.scenario.risk_level === "low");
  const merged2 = mergeScenarios(perFile);
  t("M5 merge deterministic", JSON.stringify(merged) === JSON.stringify(merged2));
}

console.log("W6 unit — selectTopScenarios");
{
  const merged = [
    mergedOf(scen("BS-009", "critical")),
    mergedOf(scen("BS-001", "high")),
    mergedOf(scen("BS-006", "high")),
    mergedOf(scen("BS-012", "medium")),
    { scenario: scen("BS-002", "low", ["f"], false), detected_in: [] },
  ];
  const top = selectTopScenarios(merged);
  t("S1 top-3 slice", top.length === 3);
  t("S2 severity desc first", top[0].scenario.scenario_id === "BS-009");
  t("S3 tie-break scenario_id asc (BS-001 before BS-006)",
    top[1].scenario.scenario_id === "BS-001" && top[2].scenario.scenario_id === "BS-006");
  t("S4 undetected excluded", !top.some((m) => m.scenario.scenario_id === "BS-002"));
  const top2 = selectTopScenarios(merged);
  t("S5 selection deterministic", JSON.stringify(top) === JSON.stringify(top2));
  const fewer = selectTopScenarios([merged[3]]);
  t("S6 fewer than 3 -> all detected returned", fewer.length === 1 && fewer[0].scenario.scenario_id === "BS-012");
}

console.log("W6 unit — buildNarrative golden determinism");
{
  const ctx = { chain: "polygon" };
  const m1 = mergedOf(scen("BS-006", "high", ["withdraw", "refund"]), ["Vault.sol"]);
  const n1 = buildNarrative(m1, ctx);
  const n2 = buildNarrative(m1, ctx);
  t("N1 narrative byte-identical across calls (no clock/RNG)", JSON.stringify(n1) === JSON.stringify(n2));
  t("N2 narrative slots bound to evidence (fn names)",
    JSON.stringify(n1).includes("withdraw"), JSON.stringify(n1).slice(0, 200));
  t("N3 narrative carries detected_in + severity",
    JSON.stringify(n1).includes("Vault.sol") && n1.severity === "high");
  t("N4 narrative shape (scenario_id/entry_points/prerequisites/attack_path/evidence)",
    n1.scenario_id === "BS-006" && Array.isArray(n1.entry_points) && Array.isArray(n1.prerequisites)
    && Array.isArray(n1.attack_path) && typeof n1.evidence === "object");
  const ids = ["BS-001","BS-002","BS-003","BS-004","BS-005","BS-006","BS-007","BS-008","BS-009","BS-012","BS-013","BS-014","BS-015"];
  let allOk = true;
  for (const id of ids) {
    try {
      const n = buildNarrative(mergedOf(scen(id, "high", ["f"])), ctx);
      if (!n || JSON.stringify(n).length < 20) allOk = false;
    } catch (e) { allOk = false; console.log("    narrative crash", id, e.message); }
  }
  t("N5 all 13 library scenarios produce narratives", allOk);
  const nx = buildNarrative(mergedOf(scen("BS-999", "low", ["f"])), ctx);
  t("N6 unknown scenario -> genericNarrative fallback", nx && JSON.stringify(nx).length > 20);
}

console.log("W6 unit — drain-class scoping + observable_impact (Amendment A1)");
{
  const drainMap = { withdraw: "function withdraw() public { (bool ok,) = msg.sender.call{value: bal}(\"\"); }" };
  const cleanMap = { vote: "function vote(uint256 id) public { votes[id] += 1; }" };
  const fnFrom = (map) => (name) => map[name];
  t("D1 drain-class: call{value:} in affected fn",
    isDrainClass(scen("BS-003", "high", ["withdraw"]), fnFrom(drainMap)) === true);
  t("D2 non-drain: no value-transfer op",
    isDrainClass(scen("BS-014", "high", ["vote"]), fnFrom(cleanMap)) === false);
  t("D3 non-drain: missing fn body -> false (honest)",
    isDrainClass(scen("BS-006", "high", ["ghost"]), fnFrom({})) === false);

  const srcOnly = buildObservableImpact(
    [mergedOf(scen("BS-003", "high", ["withdraw"]))],
    { address: null, state: null, fnBody: fnFrom(drainMap) },
  );
  t("D4 source-only mode -> OMIT_REASON_SOURCE_ONLY",
    srcOnly[0].status === "omitted" && srcOnly[0].omit_reason === OMIT_REASON_SOURCE_ONLY,
    JSON.stringify(srcOnly));
  const nonDrain = buildObservableImpact(
    [mergedOf(scen("BS-014", "high", ["vote"]))],
    { address: "0x" + "ab".repeat(20), state: { ok: true, chain: "polygon", address: "0x" + "ab".repeat(20), block_number: 12345, native_balance_wei: "0" }, fnBody: fnFrom(cleanMap) },
  );
  t("D5 non-drain address mode -> OMIT_REASON_NO_VALUE_TRANSFER",
    nonDrain[0].status === "omitted" && nonDrain[0].omit_reason === OMIT_REASON_NO_VALUE_TRANSFER,
    JSON.stringify(nonDrain));
  const drain = buildObservableImpact(
    [mergedOf(scen("BS-003", "high", ["withdraw"]))],
    { address: "0x" + "ab".repeat(20), state: { ok: true, chain: "polygon", address: "0x" + "ab".repeat(20), block_number: 12345, native_balance_wei: "1000" }, fnBody: fnFrom(drainMap) },
  );
  t("D6 drain address mode -> observed + OBSERVED_LABEL",
    drain[0].status === "observed" && drain[0].label === OBSERVED_LABEL, JSON.stringify(drain));
  t("D7 observed entry carries block B + balance",
    drain[0].block_number === 12345 && drain[0].native_balance_wei === "1000");
  const unavailable = buildObservableImpact(
    [mergedOf(scen("BS-003", "high", ["withdraw"]))],
    { address: "0x" + "ab".repeat(20), state: null, fnBody: fnFrom(drainMap) },
  );
  t("D8 drain + no state read -> unavailable (honest)",
    unavailable[0].status === "unavailable", JSON.stringify(unavailable));
}

console.log("W6 unit — buildForensicBundle determinism (spec §5)");
{
  const ctx = { chain: "polygon" };
  const m1 = mergedOf(scen("BS-006", "high", ["withdraw"]));
  const n1 = buildNarrative(m1, ctx);
  const args = {
    subject: { kind: "files", ref: "A.sol" },
    engine_version: "v5.17.0-frontier",
    detected_scenario_ids: ["BS-006"],
    selected: [n1],
    observable_impact: [],
  };
  const b1 = buildForensicBundle(args);
  const b2 = buildForensicBundle(args);
  t("B1 bundle byte-identical (no wall-clock fields)", JSON.stringify(b1) === JSON.stringify(b2));
  t("B2 schema marker w6-forensic/1.0", b1.schema_version === "w6-forensic/1.0");
  t("B3 no volatile timestamp keys in bundle",
    !/"(issued_at|timestamp|created_at|generated_at)"\s*:/.test(JSON.stringify(b1)),
    Object.keys(b1).join(","));
  const b3 = buildForensicBundle({ ...args, detected_scenario_ids: ["BS-006", "BS-009"] });
  t("B4 different input -> different bundle", JSON.stringify(b1) !== JSON.stringify(b3));
  t("B5 selection rule recorded",
    b1.scenario_selection.rule === "top 3 by severity desc, tie scenario_id asc");
  t("B6 legal_weight 0 + disclaimer + library + spec version",
    b1.legal_weight === 0 && b1.spec_version === "1.0-FINAL+A1+A2" && Array.isArray(b1.scenario_library));
}

console.log("W6 unit — W6_MODEL constants");
{
  t("C1 credits 350", W6_MODEL.credits === 350);
  t("C2 x402 atomic 3500000", W6_MODEL.x402_atomic_usdc === "3500000");
  t("C3 chains polygon only", JSON.stringify(W6_MODEL.chains) === JSON.stringify(["polygon"]));
  t("C4 top_scenarios 3", W6_MODEL.top_scenarios === 3);
  t("C5 spec version A1+A2", W6_MODEL.spec_version === "1.0-FINAL+A1+A2");
  t("C6 scenario library 13 ids", W6_MODEL.scenario_library.length === 13, (W6_MODEL.scenario_library || []).join(","));
}

console.log(`\nW6 unit: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
