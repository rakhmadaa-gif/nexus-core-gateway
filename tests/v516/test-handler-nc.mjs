// v5.16.0 (W7) — handler negative controls for lockfile ingestion.
// All validation must fire pre-billing (400, zero credits charged).
// Run: node test-handler-nc.mjs   (engine-bundle.js must be fresh — see README)
import "./deno-stub.mjs";
import { handleFitnessWithBilling } from "./engine-bundle.js";

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const codeOf = (json) => json?.error?.error_code ?? json?.error_code ?? null;

const call = async (body) => {
  const req = new Request("https://stub.local/x402/fitness", {
    method: "POST",
    headers: { "content-type": "application/json", "x-client-id": "nc-v516" },
    body: JSON.stringify(body),
  });
  const res = await handleFitnessWithBilling(req);
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
};

console.log("v5.16.0 W7 handler negative controls");
// v5.16.1: unfunded callers now get the priced 402 BEFORE validation
// (paywallPrecheck). Fund the stub for NC1-NC5 so they still exercise
// validation-before-charge for clients who CAN pay; NC6 unfunds again.
globalThis.__STUB_BALANCE = 10000;

// NC1: garbage lockfile content -> 400 LOCKFILE_PARSE_FAILED (pre-billing)
{
  const r = await call({ lockfile: { filename: "package-lock.json", content: "this is not a lockfile {{{" } });
  t("NC1 garbage lockfile -> 400 LOCKFILE_PARSE_FAILED",
    r.status === 400 && codeOf(r.json) === "LOCKFILE_PARSE_FAILED",
    `got ${r.status}/${codeOf(r.json)}`);
}

// NC2: oversized lockfile (>512 KiB) -> 400 LOCKFILE_TOO_LARGE (pre-billing)
{
  const big = "x".repeat(600_000);
  const r = await call({ lockfile: { filename: "yarn.lock", content: big } });
  t("NC2 oversized lockfile -> 400 LOCKFILE_TOO_LARGE",
    r.status === 400 && codeOf(r.json) === "LOCKFILE_TOO_LARGE",
    `got ${r.status}/${codeOf(r.json)}`);
}

// NC3: empty body -> 400 INVALID_INPUT
{
  const r = await call({});
  t("NC3 empty body -> 400 INVALID_INPUT",
    r.status === 400 && codeOf(r.json) === "INVALID_INPUT",
    `got ${r.status}/${codeOf(r.json)}`);
}

// NC4: empty lockfile.content -> 400 INVALID_INPUT
{
  const r = await call({ lockfile: { filename: "package-lock.json", content: "" } });
  t("NC4 empty lockfile.content -> 400 INVALID_INPUT",
    r.status === 400 && codeOf(r.json) === "INVALID_INPUT",
    `got ${r.status}/${codeOf(r.json)}`);
}

// NC5: packages exceeding merged cap 250 -> 400 INVALID_INPUT
{
  const pkgs = Array.from({ length: 251 }, (_, i) => ({ name: `pkg-${i}`, ecosystem: "npm" }));
  const r = await call({ packages: pkgs });
  t("NC5 251 packages -> 400 INVALID_INPUT",
    r.status === 400 && codeOf(r.json) === "INVALID_INPUT",
    `got ${r.status}/${codeOf(r.json)}`);
}

globalThis.__STUB_BALANCE = 0;
// NC6: VALID package-lock parses pre-billing and reaches billing (stub balance 0 -> 402).
// Proves order: parse OK -> then billing. Any 400 here = resolution bug.
{
  const lock = JSON.stringify({
    name: "demo", lockfileVersion: 3,
    packages: { "": { name: "demo" }, "node_modules/lodash": { version: "4.17.20" } },
  });
  const r = await call({ lockfile: { filename: "package-lock.json", content: lock } });
  t("NC6 valid package-lock reaches billing (402, not 400)",
    r.status === 402,
    `got ${r.status}/${codeOf(r.json)}`);
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
