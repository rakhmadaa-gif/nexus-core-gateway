// v5.16.1 — paywall precheck + legacy per-path routes, offline negative controls.
// Simulates the x402-list monitor: bare POST per declared path must return 402
// with an x402 payment-required envelope priced at the ADVERTISED service price.
// Run: node test-v5161.mjs   (engine-bundle.js must be fresh)
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

// Monitor style A: full external Supabase form (old listing base_url).
const FN = "/functions/v1/hello-world";

console.log("v5.16.1 paywall precheck + legacy routes — offline NCs (stub balance 0)");

// --- Legacy /v1/* service routes: priced per service, not the $0.20 catch-all ---
{
  const r = await post(`${FN}/v1/structured-data`);
  t("T1 /v1/structured-data bare -> 402 @ $0.20",
    r.status === 402 && amountOf(r.env) === "200000",
    `got ${r.status}/${amountOf(r.env)}`);
}
{
  const r = await post(`${FN}/v1/code-modules`);
  t("T2 /v1/code-modules bare -> 402 @ $1.20 (not $0.20)",
    r.status === 402 && amountOf(r.env) === "1200000",
    `got ${r.status}/${amountOf(r.env)}`);
}
{
  const r = await post(`${FN}/v1/legal-code`);
  t("T3 /v1/legal-code bare -> 402 @ $450 standard (not $0.20)",
    r.status === 402 && amountOf(r.env) === "450000000",
    `got ${r.status}/${amountOf(r.env)}`);
}
{
  const r = await post(`${FN}/v1/legal-code`, { params: { tier: "light" } });
  t("T4 /v1/legal-code tier=light -> 402 @ $300",
    r.status === 402 && amountOf(r.env) === "300000000",
    `got ${r.status}/${amountOf(r.env)}`);
}

// --- Dedicated endpoints: 402 BEFORE validation ---
{
  const r = await post(`${FN}/x402/fitness`);
  t("T5 /x402/fitness bare -> 402 @ $0.05 (not 400)",
    r.status === 402 && amountOf(r.env) === "50000",
    `got ${r.status}/${amountOf(r.env)}`);
}
{
  const r = await post(`${FN}/x402/fitness/lite`);
  t("T6 /x402/fitness/lite bare -> 402 @ $1.25",
    r.status === 402 && amountOf(r.env) === "1250000",
    `got ${r.status}/${amountOf(r.env)}`);
}
{
  const r = await post(`${FN}/x402/fitness/full`);
  t("T7 /x402/fitness/full bare -> 402 @ $2.25",
    r.status === 402 && amountOf(r.env) === "2250000",
    `got ${r.status}/${amountOf(r.env)}`);
}
{
  const r = await post(`${FN}/x402/fitness/peer-check`);
  t("T8 /x402/fitness/peer-check bare -> 402 @ $0.05",
    r.status === 402 && amountOf(r.env) === "50000",
    `got ${r.status}/${amountOf(r.env)}`);
}
{
  const r = await post(`${FN}/evm-sentinel/v1/scan-quick`);
  t("T9 scan-quick bare -> 402 @ $0.05",
    r.status === 402 && amountOf(r.env) === "50000",
    `got ${r.status}/${amountOf(r.env)}`);
}
{
  const r = await post(`${FN}/evm-sentinel/v1/scan-deep`);
  t("T10 scan-deep bare -> 402 @ $0.50",
    r.status === 402 && amountOf(r.env) === "500000",
    `got ${r.status}/${amountOf(r.env)}`);
}

// --- Route forcing: body service_type cannot override the path's price ---
{
  const r = await post(`${FN}/v1/code-modules`, { service_type: "structured_data" });
  t("T11 body override attempt -> still $1.20",
    r.status === 402 && amountOf(r.env) === "1200000",
    `got ${r.status}/${amountOf(r.env)}`);
}

// --- GET on legacy path -> 405 ---
{
  const req = new Request(`https://stub.local${FN}/v1/code-modules`, { method: "GET" });
  const res = await telemetryWrapper(req);
  t("T12 GET /v1/code-modules -> 405", res.status === 405, `got ${res.status}`);
}

// --- Worker-proxied mount style (path without function prefix) ---
{
  const r = await post("/v1/code-modules");
  t("T13 worker-style /v1/code-modules -> 402 @ $1.20",
    r.status === 402 && amountOf(r.env) === "1200000",
    `got ${r.status}/${amountOf(r.env)}`);
}

// --- Funded clients: validation still fires BEFORE charge (400, no charge) ---
globalThis.__STUB_BALANCE = 10000;
{
  const r = await post(`${FN}/x402/fitness`, {}, { "x-client-id": "nc-v5161-funded" });
  t("T14 funded client empty body -> 400 INVALID_INPUT (validation intact)",
    r.status === 400,
    `got ${r.status}`);
}
{
  const r = await post(`${FN}/evm-sentinel/v1/scan-quick`, {}, { "x-client-id": "nc-v5161-funded" });
  t("T15 funded client scan empty body -> 400 (validation intact)",
    r.status === 400,
    `got ${r.status}`);
}
globalThis.__STUB_BALANCE = 0;

{
  const r = await post(`${FN}/x402/fitness`, {}, { "x-client-id": "nc-v5161-unfunded" });
  t("T16b unfunded client id empty body -> 402 @ $0.05 (not 400)",
    r.status === 402 && amountOf(r.env) === "50000",
    `got ${r.status}/${amountOf(r.env)}`);
}

// --- Free endpoints untouched ---
{
  const req = new Request(`https://stub.local${FN}/manifest.json`, { method: "GET" });
  const res = await telemetryWrapper(req);
  const j = await res.json().catch(() => null);
  t("T16 manifest free -> 200 + version 5.16.1-frontier",
    res.status === 200 && j?.version === "5.16.1-frontier",
    `got ${res.status}/${j?.version}`);
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
