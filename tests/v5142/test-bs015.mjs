// v5.14.2 — BS-015 HyperCore Porting Trap unit tests (HyperEVM review #6 class).
// Run: node test-bs015.mjs   (engine-bundle.js must be fresh — see README)
import "./deno-stub.mjs";
import { parseSolidityContract, simulateBreachScenarios } from "./engine-bundle.js";

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const READER = `
pragma solidity ^0.8.24;
interface IRead { function read() external view returns (uint256); }
contract HyperReader {
    function price() external view returns (uint256) {
        return IRead(0x0000000000000000000000000000000000000800).read();
    }
}`;

const WRITER_CONST = `
pragma solidity ^0.8.24;
contract HyperWriter {
    address constant CORE_WRITER = 0x3333333333333333333333333333333333333333;
    function sendAction(bytes memory data) external {
        (bool ok,) = CORE_WRITER.call(data);
        require(ok, "write failed");
    }
}`;

const CAST_SHORT = `
pragma solidity ^0.8.24;
interface IRead { function read() external view returns (uint256); }
contract CastReader {
    function oracle() external view returns (uint256) {
        return IRead(address(0x800)).read();
    }
}`;

const COMMENT_ONLY = `
pragma solidity ^0.8.24;
/// @notice Modeled after HyperEVM precompile 0x0000000000000000000000000000000000000800
/// but does NOT call it.
contract CommentMention {
    function price() external pure returns (uint256) { return 42; }
}`;

const CLEAN = `
pragma solidity ^0.8.24;
contract Plain {
    uint256 public x;
    function set(uint256 v) external { x = v; }
}`;

const bs015 = (src, chain) => {
  const parsed = parseSolidityContract(src, chain ?? null);
  const sim = simulateBreachScenarios(parsed);
  const sc = sim.scenarios.find(s => s.scenario_id === "BS-015");
  return { parsed, sim, sc };
};

// T1: literal read-precompile call, explicit known non-HyperEVM chain -> HIGH
{
  const { parsed, sc } = bs015(READER, "ethereum");
  t("T1 chain=ethereum literal 0x0800 -> high+detected", parsed.hypercore_porting.risk_level === "high" && sc.detected && sc.risk_level === "high");
  t("T1b affected function attributed", parsed.hypercore_porting.functions.includes("price"), JSON.stringify(parsed.hypercore_porting.functions));
  t("T1c chain_key recorded", parsed.hypercore_porting.chain_key === "ethereum");
}
// T2: same contract on hyperevm -> clean
{
  const { parsed, sc } = bs015(READER, "hyperevm");
  t("T2 chain=hyperevm -> low+not detected", parsed.hypercore_porting.risk_level === "low" && !sc.detected);
}
// T3: no chain hint -> MEDIUM
{
  const { parsed, sc } = bs015(READER, null);
  t("T3 no chain -> medium+detected", parsed.hypercore_porting.risk_level === "medium" && sc.detected && sc.risk_level === "medium");
}
// T4: numeric alias 999 -> clean
{
  const { parsed, sc } = bs015(READER, "999");
  t("T4 chain=999 alias -> low", parsed.hypercore_porting.risk_level === "low" && !sc.detected);
}
// T5: CoreWriter literal, polygon -> HIGH
{
  const { parsed } = bs015(WRITER_CONST, "polygon");
  t("T5 CoreWriter on polygon -> high", parsed.hypercore_porting.risk_level === "high");
  t("T5b constant-indirect function attributed", parsed.hypercore_porting.functions.includes("sendAction"), JSON.stringify(parsed.hypercore_porting.functions));
}
// T6: cast shorthand address(0x800), base -> HIGH
{
  const { parsed } = bs015(CAST_SHORT, "base");
  t("T6 cast shorthand on base -> high", parsed.hypercore_porting.risk_level === "high");
}
// T7: clean contract, ethereum -> LOW, chain_key still recorded
{
  const { parsed, sc } = bs015(CLEAN, "ethereum");
  t("T7 clean contract -> low+not detected", parsed.hypercore_porting.risk_level === "low" && !sc.detected && parsed.hypercore_porting.chain_key === "ethereum");
}
// T8: comment-only mention -> LOW (comment stripped)
{
  const { parsed, sc } = bs015(COMMENT_ONLY, "ethereum");
  t("T8 comment-mention -> low (comments stripped)", parsed.hypercore_porting.risk_level === "low" && !sc.detected);
}
// T9: unknown chain -> MEDIUM
{
  const { parsed, sc } = bs015(READER, "fakernet");
  t("T9 unknown chain -> medium", parsed.hypercore_porting.risk_level === "medium" && sc.detected);
}

console.log(`\nBS-015: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
