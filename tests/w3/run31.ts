// W3.1 tests: packages field + import extraction + merge.
import {
  validateFullInput, extractSolidityImports, mergeDependencyLists,
} from "../../supabase/functions/hello-world/w3_fitness_full.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); }
}

const ADDR = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";

// ---- packages field ----
check("P1 repo mode + packages ok", (() => {
  const r = validateFullInput({ repo: "a/b", address: ADDR, packages: [{ name: "lodash" }] });
  return r.ok && r.input.packages?.length === 1;
})());
check("P2 files mode + packages ok", (() => {
  const r = validateFullInput({ files: [{ path: "a.sol", source: "c" }], address: ADDR, packages: [{ name: "x", ecosystem: "npm", version: "1.0" }] });
  return r.ok && r.input.packages?.[0].version === "1.0";
})());
check("P3 no packages → empty list", (() => {
  const r = validateFullInput({ repo: "a/b", address: ADDR });
  return r.ok && r.input.packages !== undefined && r.input.packages.length === 0;
})());
check("P4 packages not array → 400", validateFullInput({ repo: "a/b", address: ADDR, packages: "lodash" }).ok === false);
check("P5 packages >25 → 400", validateFullInput({ repo: "a/b", address: ADDR, packages: Array.from({length:26},(_,i)=>({name:`p${i}`})) }).ok === false);
check("P6 package without name → 400", validateFullInput({ repo: "a/b", address: ADDR, packages: [{ ecosystem: "npm" }] }).ok === false);

// ---- import extraction ----
const SRC = `pragma solidity ^0.8.20;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {MockERC20} from "solady/tokens/MockERC20.sol";
import "solmate/tokens/ERC721.sol";
import "./Local.sol";
import "../parent/Other.sol";
import "forge-std/Test.sol";
import "@uniswap/v4-core/PoolManager.sol";
contract X is ERC20 {}
`;
const im = extractSolidityImports([{ path: "X.sol", source: SRC }]);
const names = im.map((x) => x.name);
check("I1 OZ contracts detected", names.includes("@openzeppelin/contracts"));
check("I2 OZ upgradeable detected (not conflated with contracts)", names.includes("@openzeppelin/contracts-upgradeable"));
check("I3 solady detected", names.includes("solady"));
check("I4 solmate detected", names.includes("solmate"));
check("I5 scoped uniswap detected", names.includes("@uniswap/v4-core"));
check("I6 relative imports excluded", !names.some((n) => n.includes("Local") || n.includes("parent")));
check("I7 forge-std excluded (dev tooling)", !names.includes("forge-std"));
check("I8 dedup: 2 OZ imports → single entry per package", names.filter((n) => n === "@openzeppelin/contracts").length === 1);
check("I9 empty files → empty list", extractSolidityImports([]).length === 0);
check("I10 no imports → empty", extractSolidityImports([{ path: "a.sol", source: "contract A{}" }]).length === 0);

// ---- merge ----
const m1 = mergeDependencyLists([{ name: "lodash", version: "4.17.21" }], im);
check("M1 user package first, origin input", m1.packages[0].name === "lodash" && m1.packages[0].origin === "input");
check("M2 imports merged with origin imports", m1.packages.some((p) => p.origin === "imports" && p.name === "solady"));
check("M3 dedup case-insensitive", mergeDependencyLists([{ name: "SOLADY" }], im).packages.filter((p) => p.name.toLowerCase() === "solady").length === 1);
check("M4 cap 25 + truncated flag", (() => {
  const many = Array.from({ length: 30 }, (_, i) => ({ name: `pkg${i}`, ecosystem: "npm", origin: "imports" as const }));
  const r = mergeDependencyLists(undefined, many);
  return r.packages.length === 25 && r.truncated === true;
})());
check("M5 empty both → empty, not truncated", mergeDependencyLists([], []).packages.length === 0 && mergeDependencyLists([], []).truncated === false);
check("M6 deterministic order (input first, imports alphabetical)", (() => {
  const a = mergeDependencyLists([{ name: "zeta" }], [{ name: "solady", ecosystem: "npm", origin: "imports" }, { name: "solmate", ecosystem: "npm", origin: "imports" }]);
  const b = mergeDependencyLists([{ name: "zeta" }], [{ name: "solmate", ecosystem: "npm", origin: "imports" }, { name: "solady", ecosystem: "npm", origin: "imports" }]);
  return JSON.stringify(a.packages.map((p) => p.name)) === JSON.stringify(b.packages.map((p) => p.name));
})());

console.log(`\n${"=".repeat(50)}\nW3.1 SUITE: ${pass} PASS, ${fail} FAIL`);
if (fail > 0) process.exit(1);
