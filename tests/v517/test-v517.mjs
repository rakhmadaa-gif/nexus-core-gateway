// v5.17.0 — W6 forensic handler negative controls (offline).
// Stub env: no PINATA_JWT/FILEBASE_TOKEN (Deno.env.get -> undefined) so the
// dual-pin step always degrades -> 422 DEGRADED_IPFS pre-billing on the
// success path. Run: node test-v517.mjs  (engine-bundle.js must be fresh)
import "./deno-stub.mjs";
import { telemetryWrapper } from "./engine-bundle.js";

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const decode402 = (res) => {
  const hdr = res.headers.get("payment-required");
  if (!hdr) return null;
  try { return JSON.parse(Buffer.from(hdr, "base64").toString("utf8")); } catch { return null; }
};
const amountOf = (env) => env?.accepts?.[0]?.amount ?? null;

const post = async (path, body, headers = {}) => {
  const req = new Request(`https://stub.local${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await telemetryWrapper(req);
  return { status: res.status, env: decode402(res), json: await res.json().catch(() => null) };
};
const get = async (path) => {
  const res = await telemetryWrapper(new Request(`https://stub.local${path}`));
  return { status: res.status, json: await res.json().catch(() => null) };
};

const FN = "/functions/v1/hello-world";
const FUNDED = { "x-client-id": "v517-funded-nc" };
const SOL = `pragma solidity ^0.8.24;
contract SimpleToken {
    mapping(address => uint256) public balanceOf;
    function transfer(address to, uint256 amount) public returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}`;

console.log("v5.17.0 forensic handler NCs");

// --- T1: bare probe (balance 0) -> 402 @ $3.50 ---
globalThis.__STUB_BALANCE = 0;
{
  const r = await post(`${FN}/x402/fitness/forensic`);
  t("T1 bare probe -> 402 @ 3500000 atomic",
    r.status === 402 && amountOf(r.env) === "3500000",
    `got ${r.status}/${amountOf(r.env)}`);
}

// --- T2: unfunded + invalid input -> 402 still (paywall precheck first) ---
{
  const r = await post(`${FN}/x402/fitness/forensic`, { repo: "a/b", files: [{ path: "A.sol", source: SOL }] });
  t("T2 unfunded invalid input -> 402 (precheck before validation)",
    r.status === 402, `got ${r.status}`);
}

// --- Funded path: validation still pre-billing ---
globalThis.__STUB_BALANCE = 100000;
{
  const r = await post(`${FN}/x402/fitness/forensic`, { repo: "a/b", files: [{ path: "A.sol", source: SOL }] }, FUNDED);
  t("T3 funded + repo XOR files -> 400 pre-billing",
    r.status === 400, `got ${r.status} ${JSON.stringify(r.json).slice(0, 150)}`);
}
{
  const r = await post(`${FN}/x402/fitness/forensic`, { files: [{ path: "README.md", source: "not solidity" }] }, FUNDED);
  t("T4 funded + no .sol files -> 422 NO_SOL_FILES pre-billing",
    r.status === 422, `got ${r.status} ${JSON.stringify(r.json).slice(0, 150)}`);
}
{
  const r = await post(`${FN}/x402/fitness/forensic`, { files: [{ path: "A.sol", source: SOL }], address: "0x123" }, FUNDED);
  t("T5 funded + bad address -> 400 pre-billing",
    r.status === 400, `got ${r.status} ${JSON.stringify(r.json).slice(0, 150)}`);
}

// --- T6: full success path to pin step; no pin secrets -> 422 DEGRADED_IPFS ---
{
  const r = await post(`${FN}/x402/fitness/forensic`, { files: [{ path: "SimpleToken.sol", source: SOL }] }, FUNDED);
  const code = r.json?.error?.error_code ?? r.json?.error_code ?? r.json?.error?.code ?? null;
  t("T6 funded valid .sol, no pin secrets -> 422 DEGRADED_IPFS pre-billing",
    r.status === 422 && String(code).includes("DEGRADED_IPFS"),
    `got ${r.status} code=${code} ${JSON.stringify(r.json).slice(0, 200)}`);
}

// --- T7: GET -> 405 ---
{
  const r = await get(`${FN}/x402/fitness/forensic`);
  t("T7 GET -> 405", r.status === 405, `got ${r.status}`);
}

// --- T8: regression — full tier still priced correctly on bare probe ---
globalThis.__STUB_BALANCE = 0;
{
  const r = await post(`${FN}/x402/fitness/full`);
  t("T8 regression /x402/fitness/full bare -> 402 @ 2250000",
    r.status === 402 && amountOf(r.env) === "2250000",
    `got ${r.status}/${amountOf(r.env)}`);
}

console.log(`\nv5.17.0 handler NCs: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
