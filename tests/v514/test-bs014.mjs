import "./deno-stub.mjs";
import { parseSolidityContract } from "./engine-bundle.js";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
};
const pv = (file) => parseSolidityContract(readFileSync(`fixtures/${file}`, "utf8")).phantom_vote;

// Detection
const t1 = pv("F16-confetti-governor-compound-auth.sol");
check("T1 F16 confetti v6.21 vulnerable -> detected", t1.risk_level === "high" && t1.detected !== false && t1.functions.includes("castVote"), JSON.stringify(t1));
const t2 = pv("vuln-vote-minimal.sol");
check("T2 synthetic minimal vulnerable vote -> detected high", t2.risk_level === "high" && t2.functions.includes("vote"), JSON.stringify(t2));

// Clean
const t3 = pv("F19-confetti-governor-v622-fixed.sol");
check("T3 confetti v6.22 fixed (.exists guard) -> clean", t3.risk_level === "low" && t3.functions.length === 0, JSON.stringify(t3));
const t4 = pv("oz-governor-style.sol");
check("T4 OZ Governor closure guard (state->GovernorNonexistentProposal) -> clean", t4.risk_level === "low", JSON.stringify(t4));
const t5 = pv("counter-bounds-vote.sol");
check("T5 counter-bounds guard -> clean", t5.risk_level === "low", JSON.stringify(t5));
const t6 = pv("vote-no-proposalid.sol");
check("T6 vote(bool) no proposalId -> not flagged", t6.risk_level === "low", JSON.stringify(t6));
const t7 = pv("castballot-no-guard.sol");
check("T7 castBallot (non-matching name) -> not flagged", t7.risk_level === "low", JSON.stringify(t7));
const t8 = pv("internal-castvote.sol");
check("T8 internal castVote -> not flagged", t8.risk_level === "low", JSON.stringify(t8));

// Scenario surfacing via full parse on F16
const f16 = parseSolidityContract(readFileSync("fixtures/F16-confetti-governor-compound-auth.sol", "utf8"));
check("T9 phantom_vote details non-empty on F16", f16.phantom_vote.details.length > 0);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
