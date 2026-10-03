import "./deno-stub.mjs";
import * as engine from "./engine-bundle.js";
const SIMPLE_ERC20 = `pragma solidity ^0.8.24;
contract SimpleToken {
    mapping(address => uint256) public balanceOf;
    event Transfer(address indexed from, address indexed to, uint256 value);
    function transfer(address to, uint256 amount) public returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }
}`;
const r = engine.buildGasRank([{ path: "src/SimpleToken.sol", source: SIMPLE_ERC20 }], { repo: "test/repo" });
const checks = [
  ["gas_rank_version 1.0.0", r.gas_rank_version === "1.0.0"],
  ["attested_subject.repo", r.attested_subject?.repo === "test/repo"],
  ["functions[0].name transfer", r.functions?.[0]?.name === "transfer"],
  ["functions[0].op_class transfer_like", r.functions?.[0]?.op_class === "transfer_like"],
  ["functions[0].estimate_gas number", typeof r.functions?.[0]?.estimate_gas === "number"],
  ["composite ada", typeof r.composite === "object"],
  ["cohort_version", typeof r.cohort_version === "string"],
  ["legal_weight 0", r.legal_weight === 0],
  ["disclaimer ada", typeof r.disclaimer === "string"],
  ["limits.error_band", typeof r.limits?.error_band === "string" || r.limits?.error_band !== undefined],
];
let fails = 0;
for (const [n, ok] of checks) { console.log(`${ok ? "PASS" : "FAIL"} — ${n}`); if (!ok) fails++; }
console.log(`\n=== struktur GAS_RANK_RESULT: ${checks.length - fails}/${checks.length} PASS ===`);
process.exit(fails ? 1 : 0);
