// v5.13.1 engine-level precompile AVAILABILITY tests (BS-008 v3, ZK chains review #5).
// Ground truth: live valid-vector probes 2026-10-11 (see scripts/probe-modexp-regimes.mjs).
//   zksync:        MODEXP EXISTS (≤32B operand bound, eip7883-class) — missing 0x03/0x09/0x0a
//   polygon-zkevm: NO MODEXP — missing 0x03/0x05/0x09 (0x0a inconclusive, never claimed)
//   scroll:        eip7883 — missing 0x03/0x09
//   linea:         eip7883 — FULL standard set (0x0a valid-vector verified)
//   monad(+test):  eip7883 — missing 0x0a
import "./deno-stub.mjs";
import * as engine from "./engine-bundle.js";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); }
}

const HDR = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
`;
const MODEXP_UNBOUNDED = HDR + `contract UnboundedModExp {
    function run(bytes memory input) external returns (bytes memory) {
        (bool ok, bytes memory out) = address(0x05).staticcall(input);
        require(ok);
        return out;
    }
}`;
const RIPEMD_USE = HDR + `contract RipemdUse {
    function h(bytes memory input) external returns (bytes memory) {
        (bool ok, bytes memory out) = address(0x03).staticcall(input);
        require(ok);
        return out;
    }
}`;
const BLAKE2_USE = HDR + `contract Blake2Use {
    function h(bytes memory input) external returns (bytes memory) {
        (bool ok, bytes memory out) = address(0x09).staticcall(input);
        require(ok);
        return out;
    }
}`;
const POINTEVAL_USE = HDR + `contract PointEvalUse {
    function v(bytes memory input) external returns (bytes memory) {
        (bool ok, bytes memory out) = address(0x0a).staticcall(input);
        require(ok);
        return out;
    }
}`;
const ALL_FOUR = HDR + `contract AllFour {
    function run(bytes memory input) external returns (bytes memory) {
        (bool ok1, bytes memory a) = address(0x03).staticcall(input);
        (bool ok2, bytes memory b) = address(0x05).staticcall(input);
        (bool ok3, bytes memory c) = address(0x09).staticcall(input);
        (bool ok4, bytes memory d) = address(0x0a).staticcall(input);
        require(ok1 && ok2 && ok3 && ok4);
        return a;
    }
}`;
const CLEAN = HDR + `contract Clean {
    uint256 public x;
    function set(uint256 v) external { x = v; }
}`;

function mkReq(body) {
  return new Request("https://gw.test/gateway/dry-run", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-client-id": "v513-test" },
    body: JSON.stringify(body),
  });
}

async function dryRun(src, chain) {
  const r = await engine.dryRunHandler(mkReq({ source_code: src, ...(chain ? { chain } : {}) }));
  const j = await r.json();
  const ci = (j.data ?? j).contract_info;
  return { status: r.status, ga: ci.gas_asymmetry, deployable: (j.data ?? j).preview?.deployable };
}

(async () => {
// --- parseSolidityContract: ZK chain availability verdicts -------------------
{
  const p = engine.parseSolidityContract(RIPEMD_USE, "zksync");
  check("zksync+RIPEMD: availability_blocked", p.gas_asymmetry.availability_blocked === true);
  check("zksync+RIPEMD: unsupported [3]", JSON.stringify(p.gas_asymmetry.unsupported_precompiles) === "[3]", JSON.stringify(p.gas_asymmetry.unsupported_precompiles));
  check("zksync+RIPEMD: risk high", p.gas_asymmetry.risk_level === "high", p.gas_asymmetry.risk_level);
  check("zksync+RIPEMD: risk_score 0.9 rung", p.gas_asymmetry.risk_score === 0.9, String(p.gas_asymmetry.risk_score));
  check("zksync+RIPEMD: detail names chain + revert", p.gas_asymmetry.details.some(d => /RIPEMD-160.*zksync.*reverts at runtime/s.test(d)), p.gas_asymmetry.details.join(" | "));
  check("zksync+RIPEMD: regime still eip7883 (MODEXP exists there)", p.gas_asymmetry.pricing_regime === "eip7883", p.gas_asymmetry.pricing_regime);
}
{
  const p = engine.parseSolidityContract(MODEXP_UNBOUNDED, "zksync");
  check("zksync+MODEXP: NOT blocked (0x05 exists)", p.gas_asymmetry.availability_blocked === false);
  check("zksync+MODEXP: unsupported []", p.gas_asymmetry.unsupported_precompiles.length === 0);
  check("zksync+MODEXP: ratio normalized ~2.3", p.gas_asymmetry.compute_to_gas_ratio < 12.5 && p.gas_asymmetry.compute_to_gas_ratio > 1, String(p.gas_asymmetry.compute_to_gas_ratio));
  check("zksync+MODEXP: risk NOT high (mitigated)", p.gas_asymmetry.risk_level !== "high", p.gas_asymmetry.risk_level);
}
{
  const p = engine.parseSolidityContract(MODEXP_UNBOUNDED, "polygon-zkevm");
  check("polygon-zkevm+MODEXP: availability_blocked", p.gas_asymmetry.availability_blocked === true);
  check("polygon-zkevm+MODEXP: unsupported [5]", JSON.stringify(p.gas_asymmetry.unsupported_precompiles) === "[5]", JSON.stringify(p.gas_asymmetry.unsupported_precompiles));
  check("polygon-zkevm+MODEXP: pricing_regime unsupported", p.gas_asymmetry.pricing_regime === "unsupported", p.gas_asymmetry.pricing_regime);
  check("polygon-zkevm+MODEXP: osaka_active false", p.gas_asymmetry.osaka_active === false);
  check("polygon-zkevm+MODEXP: NO gas ratio computed (0)", p.gas_asymmetry.compute_to_gas_ratio === 0, String(p.gas_asymmetry.compute_to_gas_ratio));
  check("polygon-zkevm+MODEXP: risk high + score 0.9", p.gas_asymmetry.risk_level === "high" && p.gas_asymmetry.risk_score === 0.9, `${p.gas_asymmetry.risk_level}/${p.gas_asymmetry.risk_score}`);
  check("polygon-zkevm+MODEXP: detail = porting trap", p.gas_asymmetry.details.some(d => /MODEXP.*polygon-zkevm.*reverts at runtime/s.test(d)), p.gas_asymmetry.details.join(" | "));
}
{
  const p = engine.parseSolidityContract(BLAKE2_USE, "polygon-zkevm");
  check("polygon-zkevm+BLAKE2: blocked [9]", p.gas_asymmetry.availability_blocked === true && JSON.stringify(p.gas_asymmetry.unsupported_precompiles) === "[9]", JSON.stringify(p.gas_asymmetry.unsupported_precompiles));
}
{
  const p = engine.parseSolidityContract(RIPEMD_USE, "scroll");
  check("scroll+RIPEMD: blocked [3]", p.gas_asymmetry.availability_blocked === true && JSON.stringify(p.gas_asymmetry.unsupported_precompiles) === "[3]", JSON.stringify(p.gas_asymmetry.unsupported_precompiles));
  const p2 = engine.parseSolidityContract(MODEXP_UNBOUNDED, "scroll");
  check("scroll+MODEXP: NOT blocked + normalized", p2.gas_asymmetry.availability_blocked === false && p2.gas_asymmetry.compute_to_gas_ratio < 12.5, String(p2.gas_asymmetry.compute_to_gas_ratio));
}
{
  const p = engine.parseSolidityContract(POINTEVAL_USE, "linea");
  check("linea+pointEval: NOT blocked (full set)", p.gas_asymmetry.availability_blocked === false);
  check("linea+pointEval: unsupported []", p.gas_asymmetry.unsupported_precompiles.length === 0);
  check("linea+pointEval: risk stays low", p.gas_asymmetry.risk_level === "low", p.gas_asymmetry.risk_level);
}
{
  const p = engine.parseSolidityContract(POINTEVAL_USE, "monad");
  check("monad+pointEval: blocked [10]", p.gas_asymmetry.availability_blocked === true && JSON.stringify(p.gas_asymmetry.unsupported_precompiles) === "[10]", JSON.stringify(p.gas_asymmetry.unsupported_precompiles));
  check("monad+pointEval: risk high", p.gas_asymmetry.risk_level === "high", p.gas_asymmetry.risk_level);
  const p2 = engine.parseSolidityContract(POINTEVAL_USE, "monad-testnet");
  check("monad-testnet+pointEval: blocked [10]", p2.gas_asymmetry.availability_blocked === true && JSON.stringify(p2.gas_asymmetry.unsupported_precompiles) === "[10]");
}
{
  const p = engine.parseSolidityContract(ALL_FOUR, "zksync");
  check("zksync+ALL_FOUR: blocked [3,9,10] (MODEXP excluded)", JSON.stringify(p.gas_asymmetry.unsupported_precompiles) === "[3,9,10]", JSON.stringify(p.gas_asymmetry.unsupported_precompiles));
}
// --- zero-diff guards (chains without missing precompiles) -------------------
{
  const p = engine.parseSolidityContract(ALL_FOUR, "ethereum");
  check("ethereum+ALL_FOUR: NOT blocked (zero-diff)", p.gas_asymmetry.availability_blocked === false);
  check("ethereum+ALL_FOUR: unsupported []", p.gas_asymmetry.unsupported_precompiles.length === 0);
  const p2 = engine.parseSolidityContract(ALL_FOUR);
  check("no-chain+ALL_FOUR: NOT blocked (zero-diff)", p2.gas_asymmetry.availability_blocked === false);
  const p3 = engine.parseSolidityContract(MODEXP_UNBOUNDED, "unknownchain");
  check("unknown-chain+MODEXP: NOT blocked + ratio 13.5 (conservative zero-diff)", p3.gas_asymmetry.availability_blocked === false && p3.gas_asymmetry.compute_to_gas_ratio === 13.5, String(p3.gas_asymmetry.compute_to_gas_ratio));
  const p4 = engine.parseSolidityContract(CLEAN, "zksync");
  check("zksync+CLEAN: low + not blocked", p4.gas_asymmetry.risk_level === "low" && p4.gas_asymmetry.availability_blocked === false, p4.gas_asymmetry.risk_level);
}
// --- aliases ------------------------------------------------------------------
{
  const p = engine.parseSolidityContract(RIPEMD_USE, "324");
  check("chain id 324 alias → zksync blocked", p.gas_asymmetry.availability_blocked === true);
  const p2 = engine.parseSolidityContract(MODEXP_UNBOUNDED, "1101");
  check("chain id 1101 alias → polygon-zkevm blocked", p2.gas_asymmetry.availability_blocked === true);
  const p3 = engine.parseSolidityContract(POINTEVAL_USE, "59144");
  check("chain id 59144 alias → linea NOT blocked", p3.gas_asymmetry.availability_blocked === false);
}
// --- dryRunHandler: deployable gate + response fields -------------------------
{
  const r = await dryRun(RIPEMD_USE, "zksync");
  check("dry-run zksync+RIPEMD: deployable false", r.deployable === false, String(r.deployable));
  check("dry-run zksync+RIPEMD: ga high + blocked", r.ga.risk_level === "high" && r.ga.availability_blocked === true, `${r.ga.risk_level}/${r.ga.availability_blocked}`);
  check("dry-run zksync+RIPEMD: source field present", typeof r.ga.unsupported_precompiles_source === "string", r.ga.unsupported_precompiles_source);
}
{
  const r = await dryRun(MODEXP_UNBOUNDED, "polygon-zkevm");
  check("dry-run polygon-zkevm+MODEXP: deployable false", r.deployable === false, String(r.deployable));
  check("dry-run polygon-zkevm+MODEXP: blocked + unsupported regime", r.ga.availability_blocked === true && r.ga.pricing_regime === "unsupported", `${r.ga.availability_blocked}/${r.ga.pricing_regime}`);
}
{
  const r = await dryRun(RIPEMD_USE, "ethereum");
  check("dry-run ethereum+RIPEMD: deployable true (zero-diff)", r.deployable === true, String(r.deployable));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
})();
