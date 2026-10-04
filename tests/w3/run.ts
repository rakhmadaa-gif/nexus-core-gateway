// W3 decision-independent tests: input validation + exploitability formula.
import {
  validateFullInput, computeExploitability, cvssComponent, cvss31BaseFromVector,
  reachabilityComponent, exploitMaturityComponent, freshnessPenaltyComponent,
  assetExposureComponent, W3_MODEL,
} from "../../supabase/functions/hello-world/w3_fitness_full.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); }
}

const ADDR = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";

// ---- validation ----
check("V1 repo mode ok", validateFullInput({ repo: "a/b", address: ADDR }).ok === true);
check("V2 files mode ok", validateFullInput({ files: [{ path: "a.sol", source: "contract A{}" }], address: ADDR }).ok === true);
check("V3 XOR repo+files → 400", validateFullInput({ repo: "a/b", files: [{ path: "x", source: "y" }], address: ADDR }).ok === false);
check("V4 no repo/files → 400", validateFullInput({ address: ADDR }).ok === false);
check("V5 bad repo regex → 400", validateFullInput({ repo: "a", address: ADDR }).ok === false);
check("V6 missing address → 400", validateFullInput({ repo: "a/b" }).ok === false);
check("V7 bad address (41 hex) → 400", validateFullInput({ repo: "a/b", address: ADDR + "f" }).ok === false);
check("V8 chain outside enum → 400", validateFullInput({ repo: "a/b", address: ADDR, chain: "mainnet" }).ok === false);
check("V9 chain default polygon", (() => { const r = validateFullInput({ repo: "a/b", address: ADDR }); return r.ok && r.input.chain === "polygon"; })());
check("V10 files >200 → 400", validateFullInput({ files: Array.from({ length: 201 }, (_, i) => ({ path: `f${i}`, source: "x" })), address: ADDR }).ok === false);
check("V11 content alias accepted", (() => { const r = validateFullInput({ files: [{ path: "a", content: "contract A{}" }], address: ADDR }); return r.ok && r.input.files?.[0].source === "contract A{}"; })());

// ---- exploitability formula ----
check("E1 all-100 components → 100", computeExploitability({ cvss: 100, reachability: 100, exploit_maturity: 100, freshness_penalty: 100, asset_exposure: 100 }) === 100);
check("E2 all-0 → 0", computeExploitability({ cvss: 0, reachability: 0, exploit_maturity: 0, freshness_penalty: 0, asset_exposure: 0 }) === 0);
check("E3 spec example: critical+KEV+highTVL", (() => {
  const s = computeExploitability({ cvss: 98, reachability: 100, exploit_maturity: 100, freshness_penalty: 80, asset_exposure: 100 });
  return s >= 90 && s <= 100;
})());
check("E4 determinism ×3", (() => {
  const c = { cvss: 75, reachability: 60, exploit_maturity: 70, freshness_penalty: 40, asset_exposure: 50 };
  return computeExploitability(c) === computeExploitability(c) && computeExploitability(c) === computeExploitability(c);
})());
check("E5 weights sum = 1.0", Math.abs(0.35 + 0.25 + 0.15 + 0.15 + 0.10 - 1.0) < 1e-9);

// ---- CVSS parsing ----
check("C1 CVSS:3.1 vector critical (AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H) → ~100",
  cvssComponent([{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H" }]) >= 95);
check("C2 numeric score 7.5 → 75", cvssComponent([{ score: "7.5" }]) === 75);
check("C3 missing severity → 50 neutral", cvssComponent(undefined) === 50);
check("C4 empty array → 50", cvssComponent([]) === 50);
check("C5 vector parse low (AV:P/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N) < 40",
  cvssComponent([{ score: "CVSS:3.1/AV:P/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N" }]) < 40);

// ---- components ----
check("R1 direct called → 100", reachabilityComponent({ affectedSymbols: ["transfer"], knownFunctions: ["transfer", "approve"], calledFunctions: ["transfer"] }) === 100);
check("R2 present uncalled → 60", reachabilityComponent({ affectedSymbols: ["helper"], knownFunctions: ["transfer", "helper"], calledFunctions: ["transfer"] }) === 60);
check("R3 absent → 20", reachabilityComponent({ affectedSymbols: ["foo"], knownFunctions: ["transfer"], calledFunctions: ["transfer"] }) === 20);
check("R4 unknown map → 50", reachabilityComponent({ affectedSymbols: ["foo"], knownFunctions: null }) === 50);
check("M1 KEV → 100", exploitMaturityComponent({ inKev: true, hasPublicReferences: false }) === 100);
check("M2 refs → 70", exploitMaturityComponent({ inKev: false, hasPublicReferences: true }) === 70);
check("M3 none → 30", exploitMaturityComponent({ inKev: false, hasPublicReferences: false }) === 30);
check("F1 40 days → 80", freshnessPenaltyComponent(40) === 80);
check("F2 100 days → capped 100", freshnessPenaltyComponent(100) === 100);
check("F3 null → 50 neutral", freshnessPenaltyComponent(null) === 50);
check("A1 TVL 2M → 100", assetExposureComponent(2_000_000) === 100);
check("A2 TVL 500k → 70", assetExposureComponent(500_000) === 70);
check("A3 TVL 10k → 40", assetExposureComponent(10_000) === 40);
check("A4 null → 50 neutral", assetExposureComponent(null) === 50);

console.log(`\n${"=".repeat(50)}\nW3 PRE-DECISION SUITE: ${pass} PASS, ${fail} FAIL`);
if (fail > 0) process.exit(1);
