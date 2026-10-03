// W4 M3 — handler-level tests (3 paths). Node, offline.
import "./deno-stub.mjs";
import * as engine from "./engine-bundle.js";

const results = [];
function check(name, cond, extra = "") {
  results.push({ name, pass: !!cond, extra });
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? " | " + extra : ""}`);
}

function mkReq(body, headers = {}) {
  return new Request("https://gw.test/x402/fitness/lite", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-client-id": "w4-m3-test", ...headers },
    body: JSON.stringify(body),
  });
}

const SIMPLE_ERC20 = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
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

const NO_EXTERNAL = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract OnlyInternal {
    uint256 internal x;
    function _helper() internal { x = 1; }
}`;

// ---- T1: 400 invalid input (no repo, no files) — pre-billing
{
  const r = await engine.handleFitnessLiteWithBilling(mkReq({}));
  check("T1 invalid input -> 400", r.status === 400, `status=${r.status}`);
  const j = await r.json();
  check("T1 error_code INVALID_INPUT", j.error?.error_code === "INVALID_INPUT", j.error?.error_code);
}

// ---- T2: 422 NO_RANKABLE_FUNCTIONS — pre-billing, no charge
{
  const r = await engine.handleFitnessLiteWithBilling(mkReq({ files: [{ path: "src/OnlyInternal.sol", source: NO_EXTERNAL }] }));
  check("T2 unrankable -> 422", r.status === 422, `status=${r.status}`);
  const j = await r.json();
  check("T2 error_code NO_RANKABLE_FUNCTIONS", j.error?.error_code === "NO_RANKABLE_FUNCTIONS", j.error?.error_code);
  check("T2 credits_charged 0", j.metadata?.credits_charged === 0, String(j.metadata?.credits_charged));
}

// ---- T3: 422 vendored-only files — pre-billing
{
  const r = await engine.handleFitnessLiteWithBilling(mkReq({ files: [{ path: "lib/vendored.sol", source: SIMPLE_ERC20 }] }));
  check("T3 vendored-only -> 422", r.status === 422, `status=${r.status}`);
}

// ---- T4: 402 no balance — x402 envelope with 125 CRED = $1.25
{
  const r = await engine.handleFitnessLiteWithBilling(mkReq({ files: [{ path: "src/SimpleToken.sol", source: SIMPLE_ERC20 }] }));
  check("T4 rankable no-balance -> 402", r.status === 402, `status=${r.status}`);
  const prHeader = r.headers.get("payment-required");
  check("T4 payment-required header ada", !!prHeader);
  if (prHeader) {
    const x402 = JSON.parse(atob(prHeader));
    check("T4 x402Version 2", x402.x402Version === 2);
    check("T4 amount 1250000 (1.25 USDC atomic)", x402.accepts?.[0]?.amount === "1250000", x402.accepts?.[0]?.amount);
    check("T4 asset USDC eip155:137", x402.accepts?.[0]?.network === "eip155:137");
    check("T4 payTo treasury", x402.accepts?.[0]?.payTo === "0x80963791ce7cb9c5d580fe638c39fdd9ffdae2d5");
  }
  const j = await r.json();
  check("T4 error_code INSUFFICIENT_CREDITS", j.error?.error_code === "INSUFFICIENT_CREDITS", j.error?.error_code);
}

// ---- T5: isVendoredSolPath unit checks
{
  check("T5a node_modules", engine.isVendoredSolPath("node_modules/OZ.sol"));
  check("T5b lib/", engine.isVendoredSolPath("lib/forge-std.sol"));
  check("T5c nested lib", engine.isVendoredSolPath("src/lib/Helper.sol"));
  check("T5d @openzeppelin", engine.isVendoredSolPath("@openzeppelin/token.sol"));
  check("T5e .t.sol test", engine.isVendoredSolPath("test/Thing.t.sol"));
  check("T5f src bersih TIDAK vendored", !engine.isVendoredSolPath("src/Token.sol"));
}

const fails = results.filter(r => !r.pass);
console.log(`\n=== W4 M3 handler tests: ${results.length - fails.length}/${results.length} PASS ===`);
if (fails.length > 0) { console.log("FAILED:", fails.map(f => f.name).join(", ")); process.exit(1); }
process.exit(0);
