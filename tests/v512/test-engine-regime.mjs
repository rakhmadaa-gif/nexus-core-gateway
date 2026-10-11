// v5.12.0 engine-level regime tests — dryRunHandler + parseSolidityContract.
import "./deno-stub.mjs";
import * as engine from "./engine-bundle.js";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); }
}

const MODEXP_UNBOUNDED = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract UnboundedModExp {
    function run(bytes memory input) external returns (bytes memory) {
        (bool ok, bytes memory out) = address(0x05).staticcall(input);
        require(ok);
        return out;
    }
}`;

const TSTORE_BOMB = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract TstoreBomb {
    function bomb(uint256 n) external {
        for (uint256 i = 0; i < n; i++) {
            assembly { tstore(i, i) }
        }
    }
}`;

function mkReq(body) {
  return new Request("https://gw.test/gateway/dry-run", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-client-id": "v512-test" },
    body: JSON.stringify(body),
  });
}

async function gasAsym(src, chain) {
  const r = await engine.dryRunHandler(mkReq({ source_code: src, ...(chain ? { chain } : {}) }));
  const j = await r.json();
  const ci = (j.data ?? j).contract_info;
  return { status: r.status, ga: ci.gas_asymmetry, deployable: (j.data ?? j).preview?.deployable };
}

// --- parseSolidityContract direct level --------------------------------------
{
  const p = engine.parseSolidityContract(MODEXP_UNBOUNDED);
  check("default (no chain): pricing_regime eip2565", p.gas_asymmetry.pricing_regime === "eip2565", p.gas_asymmetry.pricing_regime);
  check("default: osaka_active false", p.gas_asymmetry.osaka_active === false);
  check("default: ratio 13.5 high (12.5 + 2 call sites x 0.5)", p.gas_asymmetry.compute_to_gas_ratio === 13.5 && p.gas_asymmetry.risk_level === "high", `${p.gas_asymmetry.compute_to_gas_ratio}/${p.gas_asymmetry.risk_level}`);
  check("default: dos_validator_delay true", p.gas_asymmetry.dos_validator_delay === true);
}
{
  const p = engine.parseSolidityContract(MODEXP_UNBOUNDED, "ethereum");
  check("ethereum: pricing_regime eip7883", p.gas_asymmetry.pricing_regime === "eip7883", p.gas_asymmetry.pricing_regime);
  check("ethereum: osaka_active true", p.gas_asymmetry.osaka_active === true);
  const r = p.gas_asymmetry.compute_to_gas_ratio;
  check("ethereum: ratio ~2.3 (13.5/6 = 2.25)", Math.abs(r - 2.25) < 0.06, String(r));
  check("ethereum: risk NOT high", p.gas_asymmetry.risk_level !== "high", p.gas_asymmetry.risk_level);
  check("ethereum: dos_validator_delay false", p.gas_asymmetry.dos_validator_delay === false);
  check("ethereum: basis mentions EIP-7883", p.gas_asymmetry.ratio_basis.includes("EIP-7883"), p.gas_asymmetry.ratio_basis.slice(0, 80));
  check("ethereum: details mention protocol-mitigated", p.gas_asymmetry.details.some(d => d.includes("EIP-7883") || d.includes("protocol-mitigated")), JSON.stringify(p.gas_asymmetry.details));
}
{
  const pBase = engine.parseSolidityContract(MODEXP_UNBOUNDED, "base");
  check("base: eip7883 (Azul)", pBase.gas_asymmetry.osaka_active === true && pBase.gas_asymmetry.risk_level !== "high", pBase.gas_asymmetry.risk_level);
  const pPoly = engine.parseSolidityContract(MODEXP_UNBOUNDED, "polygon");
  check("polygon: eip7883 (Madhugiri 2025-12-09, probe-corrected v5.12.2) not high", pPoly.gas_asymmetry.osaka_active === true && pPoly.gas_asymmetry.pricing_regime === "eip7883" && pPoly.gas_asymmetry.risk_level !== "high", `${pPoly.gas_asymmetry.pricing_regime}/${pPoly.gas_asymmetry.risk_level}`);
  const pArb = engine.parseSolidityContract(MODEXP_UNBOUNDED, "arbitrum");
  check("arbitrum: eip7883 (ArbOS 51, source+probe verified v5.12.2) not high", pArb.gas_asymmetry.osaka_active === true && pArb.gas_asymmetry.pricing_regime === "eip7883" && pArb.gas_asymmetry.risk_level !== "high", `${pArb.gas_asymmetry.pricing_regime}/${pArb.gas_asymmetry.risk_level}`);
  const pArbNova = engine.parseSolidityContract(MODEXP_UNBOUNDED, "arbitrum-nova");
  check("arbitrum-nova: eip7883 (on-chain ArbOS 61)", pArbNova.gas_asymmetry.osaka_active === true && pArbNova.gas_asymmetry.risk_level !== "high", pArbNova.gas_asymmetry.pricing_regime);
  const pArbSep = engine.parseSolidityContract(MODEXP_UNBOUNDED, "421614");
  check("arbitrum-sepolia 421614: eip7883", pArbSep.gas_asymmetry.osaka_active === true && pArbSep.gas_asymmetry.pricing_regime === "eip7883", pArbSep.gas_asymmetry.pricing_regime);
  const pOp = engine.parseSolidityContract(MODEXP_UNBOUNDED, "optimism");
  check("optimism: eip7883 (probe-verified)", pOp.gas_asymmetry.osaka_active === true && pOp.gas_asymmetry.risk_level !== "high", pOp.gas_asymmetry.pricing_regime);
  const pBsc = engine.parseSolidityContract(MODEXP_UNBOUNDED, "56");
  check("bsc 56: eip7883 (probe-verified)", pBsc.gas_asymmetry.osaka_active === true && pBsc.gas_asymmetry.risk_level !== "high", pBsc.gas_asymmetry.pricing_regime);
  const pMonad = engine.parseSolidityContract(MODEXP_UNBOUNDED, "monad");
  check("monad: eip7883 (MONAD_NINE Osaka) not high", pMonad.gas_asymmetry.osaka_active === true && pMonad.gas_asymmetry.pricing_regime === "eip7883" && pMonad.gas_asymmetry.risk_level !== "high", `${pMonad.gas_asymmetry.pricing_regime}/${pMonad.gas_asymmetry.risk_level}`);
  const pMonad143 = engine.parseSolidityContract(MODEXP_UNBOUNDED, "143");
  check("monad chain-id 143: eip7883", pMonad143.gas_asymmetry.osaka_active === true, pMonad143.gas_asymmetry.pricing_regime);
  const pMonadTest = engine.parseSolidityContract(MODEXP_UNBOUNDED, "monad-testnet");
  check("monad-testnet: eip7883", pMonadTest.gas_asymmetry.osaka_active === true, pMonadTest.gas_asymmetry.pricing_regime);
  // v5.13.2 HyperEVM (Protocol Review #6, probe-verified 2026-10-11):
  const pHyper = engine.parseSolidityContract(MODEXP_UNBOUNDED, "hyperevm");
  check("hyperevm: eip2565 (Cancun pre-Osaka) unbounded MODEXP stays high", pHyper.gas_asymmetry.pricing_regime === "eip2565" && pHyper.gas_asymmetry.osaka_active === false && pHyper.gas_asymmetry.risk_level === "high", `${pHyper.gas_asymmetry.pricing_regime}/${pHyper.gas_asymmetry.risk_level}`);
  const pHyper999 = engine.parseSolidityContract(MODEXP_UNBOUNDED, "999");
  check("hyperevm chain-id 999: eip2565", pHyper999.gas_asymmetry.pricing_regime === "eip2565" && pHyper999.gas_asymmetry.osaka_active === false, pHyper999.gas_asymmetry.pricing_regime);
  const pHyperTest = engine.parseSolidityContract(MODEXP_UNBOUNDED, "998");
  check("hyperevm-testnet 998: eip2565", pHyperTest.gas_asymmetry.pricing_regime === "eip2565" && pHyperTest.gas_asymmetry.risk_level === "high", pHyperTest.gas_asymmetry.pricing_regime);
  const pHyperAlias = engine.parseSolidityContract(MODEXP_UNBOUNDED, "hyperliquid");
  check("hyperliquid alias: eip2565", pHyperAlias.gas_asymmetry.pricing_regime === "eip2565", pHyperAlias.gas_asymmetry.pricing_regime);
  // Full standard precompile set on HyperEVM → no availability_blocked verdict.
  check("hyperevm: no availability_blocked", pHyper.gas_asymmetry.availability_blocked !== true, String(pHyper.gas_asymmetry.availability_blocked));
}
// TSTORE unaffected by 7883 (guard test).
{
  const p = engine.parseSolidityContract(TSTORE_BOMB, "ethereum");
  // TSTORE-only grading is PRE-EXISTING: risk_level caps at medium, but
  // dos_validator_delay=true + risk_score 0.95 still fire. 7883 must NOT change that.
  check("ethereum+TSTORE-bomb: still flagged (dos_validator_delay + 0.95)", p.gas_asymmetry.dos_validator_delay === true && p.gas_asymmetry.risk_score === 0.95 && p.gas_asymmetry.compute_to_gas_ratio === 13.8, `${p.gas_asymmetry.risk_level}/${p.gas_asymmetry.compute_to_gas_ratio}/${p.gas_asymmetry.risk_score}`);
}

// --- dryRunHandler level (HTTP) ----------------------------------------------
{
  const { status, ga, deployable } = await gasAsym(MODEXP_UNBOUNDED);
  check("dry-run default: 200 + high + deployable=false", status === 200 && ga.risk_level === "high" && deployable === false, `${status}/${ga.risk_level}/${deployable}`);
  check("dry-run default: pricing fields present in response", ga.pricing_regime === "eip2565" && ga.osaka_active === false);
}
{
  const { ga, deployable } = await gasAsym(MODEXP_UNBOUNDED, "ethereum");
  check("dry-run ethereum: NOT high + deployable not blocked by gas", ga.risk_level !== "high" && deployable !== false, `${ga.risk_level}/${deployable}`);
}
{
  const { ga } = await gasAsym(MODEXP_UNBOUNDED, "matic");
  check("dry-run matic alias: eip7883 not high (v5.12.2 probe-corrected)", ga.pricing_regime === "eip7883" && ga.risk_level !== "high", `${ga.pricing_regime}/${ga.risk_level}`);
}
{
  const { ga } = await gasAsym(MODEXP_UNBOUNDED, "8453");
  check("dry-run 8453 alias: eip7883", ga.pricing_regime === "eip7883" && ga.osaka_active === true);
}
{
  const { ga } = await gasAsym(MODEXP_UNBOUNDED, "42161");
  check("dry-run 42161 alias: eip7883", ga.pricing_regime === "eip7883" && ga.osaka_active === true && ga.risk_level !== "high", `${ga.pricing_regime}/${ga.risk_level}`);
}

// --- NC: tampered regime map must fail ---------------------------------------
{
  // If someone upgraded the DEFAULT to osaka, unknown chains would stop flagging.
  const pDef = engine.parseSolidityContract(MODEXP_UNBOUNDED);
  const pUnk = engine.parseSolidityContract(MODEXP_UNBOUNDED, "unknown-chain-xyz");
  check("NC: default+unknown both still flag high", pDef.gas_asymmetry.risk_level === "high" && pUnk.gas_asymmetry.risk_level === "high");
}

console.log(`\nengine-regime: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
