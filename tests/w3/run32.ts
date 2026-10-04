// v5.7.2 tests: cvssFromAdvisory precedence ladder + regression.
import { cvssFromAdvisory, cvss31BaseFromVector, computeExploitability } from "../../supabase/functions/hello-world/w3_fitness_full.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); }
}

// ---- precedence ladder ----
check("V1 raw vector wins: CVSS:3.1 critical → 98-100",
  cvssFromAdvisory("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H", "LOW") >= 95);
check("V2 raw vector HIGH (7.5-class) → ~75",
  Math.abs(cvssFromAdvisory("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N", "LOW") - 75) <= 2);
check("V3 numeric fallback: '7.5' → 75", cvssFromAdvisory("7.5", null) === 75);
check("V4 label CRITICAL → 95", cvssFromAdvisory(null, "CRITICAL") === 95);
check("V5 label HIGH → 80", cvssFromAdvisory(null, "HIGH") === 80);
check("V6 label MODERATE → 55", cvssFromAdvisory(null, "MODERATE") === 55);
check("V7 label MEDIUM → 55", cvssFromAdvisory(null, "MEDIUM") === 55);
check("V8 label LOW → 25", cvssFromAdvisory(null, "LOW") === 25);
check("V9 nothing → 50 neutral", cvssFromAdvisory(null, null) === 50);
check("V10 label wins over garbage vector", cvssFromAdvisory("not-a-vector", "HIGH") === 80);
check("V11 empty strings → 50", cvssFromAdvisory("", "") === 50);

// ---- CVSS 3.1 parser spot checks (known public vectors) ----
check("P1 AV:N/AC:H S:U C:H/I:H/A:H → 8.1 (FIRST official)",
  cvss31BaseFromVector("CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:H") === 8.1);
check("P2 9.8 vector → 9.8",
  cvss31BaseFromVector("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H") === 9.8);
check("P3 low vector AV:P/AC:H/PR:H/C:L → 1.6 (FIRST official)",
  cvss31BaseFromVector("CVSS:3.1/AV:P/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N") === 1.6);
check("P4 malformed vector → null", cvss31BaseFromVector("CVSS:3.1/AV:X") === null);
check("P5 scope changed (S:C) 10.0 max",
  cvss31BaseFromVector("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H") === 10.0);

// ---- exploitability end-to-end with real cvss ----
const score = computeExploitability({
  cvss: cvssFromAdvisory("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", null), // 100
  reachability: 60, exploit_maturity: 30, freshness_penalty: 100, asset_exposure: 50,
});
check("E2E critical advisory → score in 50-75 band", score >= 50 && score <= 75, `got ${score}`);
const scoreLow = computeExploitability({
  cvss: cvssFromAdvisory(null, "LOW"), // 25
  reachability: 60, exploit_maturity: 30, freshness_penalty: 20, asset_exposure: 50,
});
check("E2E low advisory → below 40", scoreLow < 40, `got ${scoreLow}`);
check("E2E determinism", (() => {
  const c = { cvss: cvssFromAdvisory("CVSS:3.1/AV:N/AC:L/PR:L/UI:R/S:U/C:H/I:H/A:H", null), reachability: 60, exploit_maturity: 30, freshness_penalty: 60, asset_exposure: 50 };
  return computeExploitability(c) === computeExploitability(c);
})());

console.log(`\n${"=".repeat(50)}\nV5.7.2 SUITE: ${pass} PASS, ${fail} FAIL`);
if (fail > 0) process.exit(1);
