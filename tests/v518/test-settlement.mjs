// v5.18.0 — x402 multi-chain settlement tests
// Covers: buildX402Accepts flag off/on, deriveSettlementClientId,
// validatePaymentPayload cross-chain, EIP-3009 Base domain round-trip,
// verifyIncomingPayment chain threading.
// Run: node test-settlement.mjs  (needs settlement-bundle.js + POLYGON_PRIVATE_KEY env)

import {
  buildX402Accepts,
  deriveSettlementClientId,
  validatePaymentPayload,
  verifyEip3009Signature,
  verifyIncomingPayment,
  getChainConfig,
  X402_CHAINS,
  X402_CONFIG,
} from "./settlement-bundle.js";
import { Wallet } from "ethers";

const TREASURY = X402_CONFIG.treasury;
const POLY = X402_CHAINS["eip155:137"];
const BASE = X402_CHAINS["eip155:8453"];

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`); }
}
function eq(name, got, want) {
  check(name, got === want, `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
}

// ---------------------------------------------------------------- A. buildX402Accepts
console.log("A. buildX402Accepts");
const polyAccept = {
  scheme: "exact",
  network: "eip155:137",
  asset: POLY.usdc_address,
  amount: "50000",
  payTo: TREASURY,
  maxTimeoutSeconds: 300,
  extra: { name: "USD Coin", version: "2", description: "Payment for Nexus Gateway services" },
};

// A1: flag OFF (no Deno global) — byte-identical single accept
delete globalThis.Deno;
{
  const out = buildX402Accepts(polyAccept);
  eq("A1 flag-off returns exactly 1 accept", out.length, 1);
  eq("A1 byte-identical to input", JSON.stringify(out[0]), JSON.stringify(polyAccept));
}

// A2: flag ON via Deno.env stub — 2 accepts, [0] untouched, [1] = Base mirror
globalThis.Deno = { env: { get: (k) => (k === "BASE_ACCEPTS_ENABLED" ? "true" : undefined) } };
{
  const out = buildX402Accepts(polyAccept);
  eq("A2 flag-on returns 2 accepts", out.length, 2);
  eq("A2 [0] byte-identical to input", JSON.stringify(out[0]), JSON.stringify(polyAccept));
  eq("A2 [1] network eip155:8453", out[1].network, "eip155:8453");
  eq("A2 [1] asset = USDC Base", out[1].asset, BASE.usdc_address);
  eq("A2 [1] amount mirrors input", out[1].amount, polyAccept.amount);
  eq("A2 [1] payTo = treasury", out[1].payTo, TREASURY);
}

// A3: flag value parsing — "1" ON; "0"/"yes"/undefined OFF
{
  const f = (v) => { globalThis.Deno = { env: { get: () => v } }; return buildX402Accepts(polyAccept).length; };
  eq("A3 flag '1' → ON (2 accepts)", f("1"), 2);
  eq("A3 flag '0' → OFF (1 accept)", f("0"), 1);
  eq("A3 flag 'yes' → OFF (1 accept)", f("yes"), 1);
  eq("A3 flag undefined → OFF (1 accept)", f(undefined), 1);
}
delete globalThis.Deno;

// ---------------------------------------------------------------- B. deriveSettlementClientId
console.log("B. deriveSettlementClientId");
eq("B1 header present → header", deriveSettlementClientId("my-client", "0xAbC"), "my-client");
eq("B2 header null + payer → payer-derived lowercased", deriveSettlementClientId(null, "0xAbCdef0000000000000000000000000000000001"), "x402-payer-0xabcdef0000000000000000000000000000000001");
eq("B3 header empty-string + payer → payer-derived", deriveSettlementClientId("", "0xAbC"), "x402-payer-0xabc");
eq("B4 whitespace header + empty payer → x402-unknown", deriveSettlementClientId("   ", ""), "x402-unknown");

// ---------------------------------------------------------------- C. validatePaymentPayload cross-chain
console.log("C. validatePaymentPayload cross-chain");
const nowSec = Math.floor(Date.now() / 1000);
function makePayload(network, asset, payTo = TREASURY, amount = "50000") {
  return {
    x402Version: 2,
    accepted: { scheme: "exact", network, asset, payTo, amount },
    payload: {
      signature: "0x" + "ab".repeat(65),
      authorization: {
        from: "0x1111111111111111111111111111111111111111",
        to: payTo,
        value: amount,
        validAfter: "0",
        validBefore: String(nowSec + 600),
        nonce: "0x" + "cd".repeat(32),
      },
    },
  };
}
{
  const r = validatePaymentPayload(makePayload("eip155:137", POLY.usdc_address), TREASURY);
  check("C1 Polygon payload ok", r.ok, JSON.stringify(r));
  eq("C1 network eip155:137", r.network, "eip155:137");
}
{
  const r = validatePaymentPayload(makePayload("eip155:8453", BASE.usdc_address), TREASURY);
  check("C2 Base payload ok", r.ok, JSON.stringify(r));
  eq("C2 network eip155:8453", r.network, "eip155:8453");
}
{
  const r = validatePaymentPayload(makePayload("eip155:8453", POLY.usdc_address), TREASURY);
  check("C3 Base network + Polygon asset → UNSUPPORTED_ASSET", !r.ok && r.error_code === "UNSUPPORTED_ASSET", JSON.stringify(r));
}
{
  const r = validatePaymentPayload(makePayload("eip155:999", BASE.usdc_address), TREASURY);
  check("C4 unknown network → UNSUPPORTED_NETWORK", !r.ok && r.error_code === "UNSUPPORTED_NETWORK", JSON.stringify(r));
  check("C4 message lists supported chains", r.message?.includes("eip155:137") && r.message?.includes("eip155:8453"), r.message);
}
{
  const r = validatePaymentPayload(makePayload("eip155:137", BASE.usdc_address), TREASURY);
  check("C5 Polygon network + Base asset → UNSUPPORTED_ASSET", !r.ok && r.error_code === "UNSUPPORTED_ASSET", JSON.stringify(r));
}
{
  const r = validatePaymentPayload(makePayload("eip155:137", POLY.usdc_address, "0x2222222222222222222222222222222222222222"), TREASURY);
  check("C6 wrong payTo → WRONG_PAYEE", !r.ok && r.error_code === "WRONG_PAYEE", JSON.stringify(r));
}

// ---------------------------------------------------------------- D. EIP-3009 round-trip (real ethers)
console.log("D. EIP-3009 Base domain round-trip");
const rawKey = process.env.POLYGON_PRIVATE_KEY || "";
const pk = rawKey.startsWith("0x") ? rawKey : "0x" + rawKey;
if (pk.length !== 66) {
  console.log("  SKIP D-tests (POLYGON_PRIVATE_KEY env not provided)");
} else {
  const wallet = new Wallet(pk);
  const auth = {
    from: wallet.address,
    to: TREASURY,
    value: BigInt("50000"),
    validAfter: BigInt(0),
    validBefore: BigInt(nowSec + 600),
    nonce: "0x" + "ee".repeat(32),
  };
  const baseDomain = { name: BASE.usdc_name, version: BASE.usdc_version, chainId: BASE.chain_id, verifyingContract: BASE.usdc_address };
  const types = { TransferWithAuthorization: [
    { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
  ] };
  const sig = await wallet.signTypedData(baseDomain, types, auth);

  const signedPayload = {
    x402Version: 2,
    accepted: { scheme: "exact", network: "eip155:8453", asset: BASE.usdc_address, payTo: TREASURY, amount: "50000" },
    payload: {
      signature: sig,
      authorization: { from: auth.from, to: auth.to, value: "50000", validAfter: "0", validBefore: String(nowSec + 600), nonce: auth.nonce },
    },
  };

  // D1: verify with Base chain config → ok, payer = signer, network threaded
  {
    const r = verifyEip3009Signature(signedPayload, getChainConfig("eip155:8453"));
    check("D1 Base signature verifies on Base config", r.ok, JSON.stringify(r));
    eq("D1 payer = signer address", r.payer?.toLowerCase(), wallet.address.toLowerCase());
    eq("D1 network threaded eip155:8453", r.network, "eip155:8453");
  }

  // D2 (negative control): same signature on Polygon config → INVALID_SIGNATURE (domain mismatch)
  {
    const r = verifyEip3009Signature(signedPayload, getChainConfig("eip155:137"));
    check("D2 Base sig on Polygon config → INVALID_SIGNATURE", !r.ok && r.error_code === "INVALID_SIGNATURE", JSON.stringify(r));
  }

  // D3: verifyIncomingPayment end-to-end via base64 header (Bearer form) — chain threading through the entry point
  {
    const header = "Bearer " + Buffer.from(JSON.stringify(signedPayload), "utf8").toString("base64");
    const r = verifyIncomingPayment(header, TREASURY);
    check("D3 verifyIncomingPayment ok (Base payload)", r.ok, JSON.stringify(r));
    eq("D3 network threaded eip155:8453", r.network, "eip155:8453");
  }
}

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
