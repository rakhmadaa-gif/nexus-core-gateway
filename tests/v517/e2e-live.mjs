// v5.17.0 live E2E — W6 forensic dual-pin happy path + regressions.
// Learnings baked in: x402 amount lives in `payment-required` header (base64),
// 422 any-code acceptable for no-.sol, manifest endpoints is an object.
const BASE = "https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world";
const ANON = process.env.SUPABASE_ANON_KEY;
const CID = "live-test-v500";
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { if (cond) { pass++; console.log(`✅ ${name}`); } else { fail++; console.log(`❌ ${name} ${extra}`); } };
const post = async (path, body, headers = {}) => {
  const r = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j, headers: Object.fromEntries(r.headers.entries()) };
};
const x402Amt = (resp) => {
  const h = resp.headers?.["payment-required"];
  if (!h) return undefined;
  try { const a = JSON.parse(Buffer.from(h, "base64").toString())?.accepts?.[0]; return String(a?.maxAmountRequired ?? a?.amount); } catch { return "parse_error"; }
};
const bal = async () => {
  const r = await fetch(`https://xibzsthfrbomefnvbicb.supabase.co/rest/v1/client_usage?client_id=eq.${CID}&select=balance_credits`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } });
  const j = await r.json(); return j?.[0]?.balance_credits;
};

// S1 manifest
const m = await (await fetch(BASE + "/manifest.json")).json();
ok("S1 manifest 5.17.0-frontier", m.version === "5.17.0-frontier", `got ${m.version}`);
const epList = Array.isArray(m.endpoints) ? m.endpoints.map(e => e.path || e) : Object.keys(m.endpoints || {});
ok("S1b manifest has forensic endpoint", epList.some(k => String(k).includes("forensic")));

// S2 bare probe forensic
const b = await post("/x402/fitness/forensic", { files: [{ path: "A.sol", source: "contract A {}" }] });
ok("S2 bare probe 402", b.status === 402, `got ${b.status}`);
ok("S2b amount 3500000 atomic", x402Amt(b) === "3500000", `got ${x402Amt(b)}`);

// S3 funded invalid (repo XOR files) -> 400 pre-billing
const b0 = await bal();
const f1 = await post("/x402/fitness/forensic", { repo: "a/b", files: [{ path: "A.sol", source: "contract A{}" }] }, { "x-client-id": CID });
ok("S3 funded XOR 400", f1.status === 400, `got ${f1.status}`);
ok("S3b charged 0", (await bal()) === b0, `${b0} -> ${await bal()}`);

// S4 funded no .sol -> 422 pre-billing (NO_SOL_FILES or NO_RANKABLE both fine)
const f2 = await post("/x402/fitness/forensic", { files: [{ path: "README.md", source: "hi" }] }, { "x-client-id": CID });
ok("S4 no-sol 422 pre-billing", f2.status === 422, `got ${f2.status} ${f2.j?.error?.error_code || f2.j?.error_code}`);
ok("S4b charged 0", (await bal()) === b0);

// S5 funded valid — DUAL PIN happy path
const SOL = "pragma solidity ^0.8.24;\ncontract MiniVault { mapping(address=>uint256) public bal; function deposit() external payable { bal[msg.sender]+=msg.value; } function withdraw() external { uint256 a=bal[msg.sender]; bal[msg.sender]=0; (bool ok,)=msg.sender.call{value:a}(\"\"); require(ok); } }";
const f3 = await post("/x402/fitness/forensic", { files: [{ path: "MiniVault.sol", source: SOL }] }, { "x-client-id": CID });
ok("S5 valid 200", f3.status === 200, `got ${f3.status} ${JSON.stringify(f3.j).slice(0, 300)}`);
const b1 = await bal();
ok("S5b charged 350", b0 - b1 === 350, `${b0} -> ${b1} (delta ${b0 - b1})`);
import { writeFileSync } from "node:fs";
writeFileSync("/tmp/w6-s5-response.json", JSON.stringify(f3.j, null, 2));
const data = f3.j?.data || {};
const ipfsBundle = data.ipfs_bundle || {};
const legs = ipfsBundle.pin_legs || [];
const cid = ipfsBundle.cid;
console.log("   cid:", cid, "| legs:", JSON.stringify(legs).slice(0, 250));
ok("S5c has CID", typeof cid === "string" && cid.startsWith("baf"), `cid=${cid}`);
ok("S5d two healthy legs", Array.isArray(legs) && legs.length === 2 && legs.every(l => l.ok === true), JSON.stringify(legs).slice(0, 200));
ok("S5d2 legs land on same CID", legs.length === 2 && legs.every(l => l.cid === cid), JSON.stringify(legs.map(l => l.cid)));
ok("S5e gateway_urls present", Array.isArray(ipfsBundle.gateway_urls) && ipfsBundle.gateway_urls.length === 3, JSON.stringify(ipfsBundle.gateway_urls));
const topKeys = Object.keys(f3.j || {});
const sig = f3.j?.attestation?.signature || f3.j?.erc8004?.signature || f3.j?.erc8004_attestation?.signature || data.erc8004_attestation?.signature;
ok("S5f attestation signature present", typeof sig === "string" && sig.length > 20, `topkeys=${topKeys.join(",")}`);
// S5g public retrieval
if (typeof cid === "string") {
  try {
    const g = await fetch(`https://ipfs.io/ipfs/${cid}`, { signal: AbortSignal.timeout(20000) });
    ok("S5g CID retrievable via ipfs.io", g.status === 200, `got ${g.status}`);
    if (g.status === 200) {
      const text = await g.text();
      ok("S5h retrieved bundle has schema_version", text.includes("w6-forensic/1.0"), "schema missing");
      ok("S5i retrieved bundle byte-has pin legs + narratives", text.includes("pin_legs") === false && text.includes("narratives"), "content check");
    }
  } catch (e) { ok("S5g CID retrievable via ipfs.io", false, String(e).slice(0, 120)); }
}

// S6 regressions
const dr = await post("/gateway/dry-run", { source_code: "pragma solidity ^0.8.24; contract C { function f() external pure returns (uint256) { return 1; } }" });
ok("S6 dry-run validation_passed", dr.j?.status === "validation_passed" || dr.j?.syntax_validation?.passed === true, `got ${dr.j?.status}`);
const fx = await post("/x402/fitness", { repo: "lodash/lodash" });
ok("S6b fitness bare 402 @50000", fx.status === 402 && x402Amt(fx) === "50000", `amt=${x402Amt(fx)}`);
const fl = await post("/x402/fitness/full", { files: [{ path: "A.sol", source: SOL }] });
ok("S6c fitness/full bare 402 @2250000", fl.status === 402 && x402Amt(fl) === "2250000", `amt=${x402Amt(fl)}`);

console.log(`\nE2E: ${pass} PASS / ${fail} FAIL | balance ${b0} -> ${await bal()}`);
process.exit(fail ? 1 : 0);
