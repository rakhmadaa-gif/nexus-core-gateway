import "./deno-stub.mjs";
import { parseSolidityContract, simulateBreachScenarios } from "./engine-bundle.js";
import { readFileSync } from "node:fs";
const G = process.env.MEMORY_DIR + "/reference/engine-regression-corpus/guarded";
const EXPECT = {
  "F21-genyleap-zerowindow-guard.sol": (s) => s.every(x => !(x.detected && ["high","critical"].includes(x.risk_level))),
  "F22-sosovalue-enum-state-guard.sol": (s) => s.every(x => !(x.detected && ["high","critical"].includes(x.risk_level))),
  "F24-ethstrategy-string-parens.sol": (s) => s.every(x => !(x.detected && ["high","critical"].includes(x.risk_level))),
};
let fail = 0;
for (const [f, ok] of Object.entries(EXPECT)) {
  const r = simulateBreachScenarios(parseSolidityContract(readFileSync(`${G}/${f}`, "utf8")));
  const flagged = (r.scenarios || []).filter(s => s.detected && ["high","critical"].includes(s.risk_level));
  const pass = ok(r.scenarios || []);
  console.log(`${pass ? "✅" : "❌"} ${f} high/critical=${flagged.map(x=>x.scenario_id+":"+x.risk_level).join(",")||"none"}`);
  if (!pass) fail++;
}
process.exit(fail ? 1 : 0);
