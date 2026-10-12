import "./deno-stub.mjs";
import { parseSolidityContract, validateSoliditySyntax, stripStringsAndComments } from "./engine-bundle.js";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
};
const rd = (f) => readFileSync(`fixtures/${f}`, "utf8");
const errs = (file) => validateSoliditySyntax(rd(file)).issues.filter(i => i.severity === "error").map(i => i.rule);
const pv = (file) => parseSolidityContract(rd(file)).phantom_vote;

// --- Validator: real-world false-422 fix ---
const e1 = errs("F22-sosovalue-enum-state-guard.sol");
check("V1 SoSoValue real file passes validation (no BALANCED_*)", !e1.includes("BALANCED_PARENS") && !e1.includes("BALANCED_BRACES"), JSON.stringify(e1));
const e2 = errs("F24-ethstrategy-string-parens.sol");
check("V2 ethstrategy real file passes validation", !e2.includes("BALANCED_PARENS") && !e2.includes("BALANCED_BRACES"), JSON.stringify(e2));
const e3 = errs("F21-genyleap-zerowindow-guard.sol");
check("V3 genyleap real file passes validation", !e3.includes("BALANCED_PARENS") && !e3.includes("BALANCED_BRACES"), JSON.stringify(e3));

// --- Validator negative controls ---
const bad1 = "pragma solidity ^0.8.24; contract B { function f() public { require((true); } }";
check("V4 genuinely unbalanced parens still error", validateSoliditySyntax(bad1).issues.some(i => i.rule === "BALANCED_PARENS"));
const bad2 = "pragma solidity ^0.8.24; contract B { function f() public { if (true) { }  }";
check("V5 genuinely unbalanced braces still error", validateSoliditySyntax(bad2).issues.some(i => i.rule === "BALANCED_BRACES"));
const tricky = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract T {
  string constant S = "((( ))) {{{ }}}";
  // comment with ((( and {{{
  /* block comment with ))) and }}} */
  function f() public pure returns (string memory) { return S; }
}`;
check("V6 strings/comments with parens+braces do not break balance", validateSoliditySyntax(tricky).issues.filter(i => i.rule.startsWith("BALANCED")).length === 0);
// stripStringsAndComments unit: newlines preserved
const st = stripStringsAndComments("a/*\n\n*/b");
check("V7 strip preserves newlines (line numbers stable)", st.split("\n").length === 3 && st.endsWith("b"));

// --- BS-014 v2 guard classes (real files) ---
const g1 = pv("F21-genyleap-zerowindow-guard.sol");
check("G1 genyleap zero-endTime window guard -> clean", g1.risk_level === "low" && g1.functions.length === 0, JSON.stringify(g1));
const g2 = pv("F22-sosovalue-enum-state-guard.sol");
check("G2 SoSoValue enum-state (NonExistent zero-default) guard -> clean", g2.risk_level === "low" && g2.functions.length === 0, JSON.stringify(g2));
// Known-limit documentation: bare signaling vote counter without proposal
// lifecycle is still flagged (impact path analysis out of static scope).
const g3 = pv("F23-grok-signaling-vote.sol");
check("G3 grok bare signaling vote -> still flagged (documented known limit)", g3.risk_level === "high" && g3.functions.includes("vote"), JSON.stringify(g3));
// Confetti negative must still fire (no enum-state or per-proposal window guard)
const g4 = pv("F16-confetti-governor-compound-auth.sol");
check("G4 Confetti v6.21 STILL detected high (no regression)", g4.risk_level === "high" && g4.functions.includes("castVote"), JSON.stringify(g4));

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
