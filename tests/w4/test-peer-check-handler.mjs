// Peer-check handler tests — offline (billing denied path via stub DB).
import "./deno-stub.mjs";
import * as engine from "./engine-bundle.js";

const results = [];
function check(name, cond, extra = "") {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? " | " + extra : ""}`);
}
function mkReq(body) {
  return new Request("https://gw.test/x402/fitness/peer-check", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-client-id": "pc-test" },
    body: JSON.stringify(body),
  });
}

// T1: 400 tanpa peer_url
{
  const r = await engine.handlePeerCheckWithBilling(mkReq({}));
  check("T1 no url -> 400", r.status === 400, `status=${r.status}`);
  const j = await r.json();
  check("T1 INVALID_INPUT", j.error?.error_code === "INVALID_INPUT");
}
// T2: 400 URL bukan http(s)
{
  const r = await engine.handlePeerCheckWithBilling(mkReq({ peer_url: "ftp://bad.example" }));
  check("T2 non-http url -> 400", r.status === 400);
}
// T3: 400 > 3 URLs
{
  const r = await engine.handlePeerCheckWithBilling(mkReq({ peer_urls: ["https://a.example","https://b.example","https://c.example","https://d.example"] }));
  check("T3 >3 urls -> 400 TOO_MANY_URLS", r.status === 400, `status=${r.status}`);
  const j = await r.json();
  check("T3 error TOO_MANY_URLS", j.error?.error_code === "TOO_MANY_URLS", j.error?.error_code);
}
// T4: 402 tanpa saldo — x402 envelope $0.05 (5 CRED = 50000 atomic)
{
  const r = await engine.handlePeerCheckWithBilling(mkReq({ peer_url: "https://example.com/api" }));
  check("T4 valid url no-balance -> 402", r.status === 402, `status=${r.status}`);
  const pr = r.headers.get("payment-required");
  check("T4 payment-required header", !!pr);
  if (pr) {
    const x402 = JSON.parse(atob(pr));
    check("T4 amount 50000 (0.05 USDC)", x402.accepts?.[0]?.amount === "50000", x402.accepts?.[0]?.amount);
    check("T4 url /x402/fitness/peer-check", x402.resource?.url === "/x402/fitness/peer-check");
  }
}
// T5: probe langsung (unit — pakai server publik stabil)
{
  const p = await engine.probePeerEndpoint("https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world/manifest.json");
  check("T5 probe reachable", p.reachable === true);
  check("T5 http_status 200", p.http_status === 200, String(p.http_status));
  check("T5 content_shape json", p.content_shape === "json", String(p.content_shape));
  check("T5 latency_ms number", typeof p.latency_ms === "number");
  check("T5 probed_at ada", typeof p.probed_at === "string");
}
// T6: probe timeout host tidak ada
{
  const p = await engine.probePeerEndpoint("https://nonexistent-host-xyz-12345.example.invalid");
  check("T6 unreachable -> reachable false", p.reachable === false);
  check("T6 error tercatat", typeof p.error === "string");
}
// T7: isValidPeerUrl unit
{
  check("T7a https valid", engine.isValidPeerUrl("https://a.example/x") === true);
  check("T7b javascript: invalid", engine.isValidPeerUrl("javascript:alert(1)") === false);
  check("T7c bukan string", engine.isValidPeerUrl(123) === false);
  check("T7d string kosong", engine.isValidPeerUrl("") === false);
}

const fails = results.filter(r => !r.pass);
console.log(`\n=== peer-check tests: ${results.length - fails.length}/${results.length} PASS ===`);
if (fails.length) { console.log("FAILED:", fails.map(f=>f.name).join(", ")); process.exit(1); }
process.exit(0);
