#!/usr/bin/env node
// probe-modexp-regimes.mjs — v5.12.2 permanent regime-verification tool.
//
// WHY THIS EXISTS: the BS-008 v2 fork-aware regime map (supabase/functions/
// hello-world/modexp_gas.ts CHAIN_PRICING_REGIMES) must reflect LIVE chain
// behavior, not docs. v5.12.0's docs-based "polygon = eip2565" entry was wrong
// for 10 months (Madhugiri activated EIP-7883 on 2025-12-09, block 80,084,800).
// A live MODEXP price probe distinguishes the regimes mechanically:
//
//   big case   (baseLen=32, expLen=32(0xFF..), modLen=256):
//     EIP-2565 → 87,040 precompile gas   (~113.6K total estimate)
//     EIP-7883 → 522,240 precompile gas  (~549.1K total estimate)
//   small case (32/32/32, exp 0xFF..):
//     EIP-2565 → 1,360 precompile gas    (~24.3K total)
//     EIP-7883 → 4,080 precompile gas    (~27.4K total, incl. ~344 estimator overhead)
//
// Classification bands are wide on purpose (≥3x discriminant between regimes).
// Anomalous results (e.g. Arbitrum Nova's inflated estimator, ~2M gas floor)
// are reported as ANOMALOUS — they never silently flip the map.
//
// Usage:
//   node scripts/probe-modexp-regimes.mjs                # probe canonical set
//   node scripts/probe-modexp-regimes.mjs name=rpcUrl …  # probe extra chains
//   node scripts/probe-modexp-regimes.mjs --upsert       # probe + upsert public.chain_regimes
//                                                        #   (needs $SUPABASE_ACCESS_TOKEN; weekly cron)
//
// Re-run cadence: after any protocol review, before any regime-map edit, and
// periodically (weekly cron → chain_regimes) — regimes change only at hardforks,
// but docs lag and a stale map must never be served silently (v5.13.0 TTL rule).
//
// v5.13.1: PRECOMPILE AVAILABILITY scan (ZK chains review #5). Before pricing,
// every target is probed for the EXISTENCE of 0x03 RIPEMD160 / 0x05 MODEXP /
// 0x09 BLAKE2f / 0x0a KZG point-evaluation via eth_call with VALID inputs
// (a missing precompile REVERTS; an invalid input would revert everywhere —
// the point-eval vector below is the canonical point-at-infinity case, which
// verifies successfully on chains that implement 0x0a). A chain without 0x05
// has no pricing regime at all → verdict "unsupported".

const SUPABASE_PROJECT_REF = "xibzsthfrbomefnvbicb";
import { createHash } from "node:crypto";

// Explained anomalies: probe-verified-by-other-means chains whose eth_estimateGas
// classification is known-quirky. Upsert refreshes probed_at with the documented
// regime; the note carries the evidence so the row is auditable.
const EXPLAINED_OVERRIDES = {
  "arbitrum-nova": {
    regime: "eip7883",
    note: "ArbOS 61 on-chain + nitro source (Osaka precompiles); eth_estimateGas inflates ~2M gas (estimator quirk, overpriced direction — safe). Probe-verified v5.12.2.",
  },
};

const CHAINS = [
  ["ethereum", "https://ethereum-rpc.publicnode.com"],
  ["polygon", "https://polygon-bor-rpc.publicnode.com"],
  ["arbitrum", "https://arb1.arbitrum.io/rpc"],
  ["arbitrum-nova", "https://nova.arbitrum.io/rpc"],
  ["arbitrum-sepolia", "https://sepolia-rollup.arbitrum.io/rpc"],
  ["base", "https://mainnet.base.org"],
  ["optimism", "https://mainnet.optimism.io"],
  ["bsc", "https://bsc-dataseed.binance.org"],
  ["monad", "https://rpc.monad.xyz"],
  ["monad-testnet", "https://testnet-rpc.monad.xyz"],
  ["zksync", "https://mainnet.era.zksync.io"],
  ["polygon-zkevm", "https://polygon-zkevm.drpc.org"],
  ["scroll", "https://rpc.scroll.io"],
  ["linea", "https://rpc.linea.build"],
  ["hyperevm", "https://rpc.hyperliquid.xyz/evm"],
  ["hyperevm-testnet", "https://rpc.hyperliquid-testnet.xyz/evm"],
];

function modexpCalldata(baseLen, expLen, modLen) {
  const hdr = Buffer.alloc(96);
  hdr.writeUInt32BE(baseLen, 28);
  hdr.writeUInt32BE(expLen, 60);
  hdr.writeUInt32BE(modLen, 92);
  const base = Buffer.alloc(baseLen, 2);
  const exp = Buffer.alloc(expLen, 0xff);
  const mod = Buffer.alloc(modLen, 0xff);
  return "0x" + Buffer.concat([hdr, base, exp, mod]).toString("hex");
}

const BIG = modexpCalldata(32, 32, 256); // 2565: ~113,580 | 7883: ~549,124
const SMALL = modexpCalldata(32, 32, 32); // 2565: ~24,316  | 7883: ~27,380

// Canonical VALID KZG point-evaluation input (EIP-4844): the point-at-infinity
// commitment (0xc0 + 47 zero bytes) with z=0, y=0 and the infinity proof always
// verifies. versioned_hash = sha256(commitment) with byte[0] = 0x01.
const KZG_INFINITY = Buffer.concat([Buffer.from([0xc0]), Buffer.alloc(47)]);
const KZG_VHASH = createHash("sha256").update(KZG_INFINITY).digest();
KZG_VHASH[0] = 0x01;
const POINT_EVAL_VECTOR = "0x" + Buffer.concat([
  KZG_VHASH, Buffer.alloc(32), Buffer.alloc(32), KZG_INFINITY, KZG_INFINITY,
]).toString("hex"); // 192 bytes

const AVAIL_VECTORS = [
  [0x03, "0x" + "00".repeat(64)],   // RIPEMD160: any input valid
  [0x05, SMALL],                    // MODEXP: valid header + inputs
  [0x09, "0x" + "00".repeat(213)],  // BLAKE2f: exactly 213 bytes, rounds=0 valid
  [0x0a, POINT_EVAL_VECTOR],        // pointEval: canonical valid vector
];

async function ethCall(url, to, data) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "nexus-regime-probe/1.1" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
      signal: ctrl.signal,
    });
    const j = await r.json();
    if (j.error) return { err: j.error.message ?? JSON.stringify(j.error) };
    return { result: j.result ?? "0x" };
  } catch (e) {
    return { err: String(e?.message ?? e) };
  } finally {
    clearTimeout(t);
  }
}

const PRECOMPILE_NAMES = { 0x03: "RIPEMD160(0x03)", 0x05: "MODEXP(0x05)", 0x09: "BLAKE2f(0x09)", 0x0a: "pointEval(0x0a)" };

// Returns { missing: number[], inconclusive: number[] } | { err: string }.
// "inconclusive" (pointEval-only): call succeeded but returned a non-64-byte
// body — observed on Polygon zkEVM; honest probes never claim unsupported on
// inconclusive evidence.
async function availability(url) {
  const missing = [], inconclusive = [];
  for (const [addr, data] of AVAIL_VECTORS) {
    const to = "0x" + addr.toString(16).padStart(40, "0");
    const r = await ethCall(url, to, data);
    if (r.err) { missing.push(addr); continue; }
    if (addr === 0x0a) {
      const bodyLen = (r.result.length - 2) / 2;
      if (bodyLen === 64) continue;               // FIELD_ELEMENTS_PER_BLOB + version
      inconclusive.push(addr);                    // success but unexpected body
    }
  }
  return { missing, inconclusive };
}

async function estimate(url, data) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "nexus-regime-probe/1.0" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_estimateGas", params: [{ to: "0x0000000000000000000000000000000000000005", data }] }),
      signal: ctrl.signal,
    });
    const j = await r.json();
    if (j.error) {
      // v5.13.1: zkSync-class RPCs refuse estimation without an active sender
      // ("invalid sender. can't start a transaction from a non-account").
      // Retry once with `from` = sender of the latest block's first tx.
      if (/invalid sender|non-account|from/i.test(j.error.message ?? "")) {
        const blk = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", "user-agent": "nexus-regime-probe/1.1" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "eth_getBlockByNumber", params: ["latest", true] }),
        }).then((x) => x.json()).catch(() => null);
        const from = blk?.result?.transactions?.[0]?.from;
        if (from) {
          const r2 = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json", "user-agent": "nexus-regime-probe/1.1" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "eth_estimateGas", params: [{ to: "0x0000000000000000000000000000000000000005", data, from }] }),
            signal: ctrl.signal,
          });
          const j2 = await r2.json();
          if (j2.error) return { err: j2.error.message ?? JSON.stringify(j2.error) };
          return { gas: parseInt(j2.result, 16) };
        }
      }
      return { err: j.error.message ?? JSON.stringify(j.error) };
    }
    return { gas: parseInt(j.result, 16) };
  } catch (e) {
    return { err: String(e?.message ?? e) };
  } finally {
    clearTimeout(t);
  }
}

function classify(big, small) {
  // Expected centers: 2565 ≈ 113.6K / 24.3K; 7883 ≈ 549.1K / 27.4K.
  if (big > 300000) {
    if (big > 1000000) return "ANOMALOUS-HIGH (estimator inflation? verify by other means)";
    if (small > 25000 && small < 33000) return "eip7883";
    return "LIKELY-eip7883 (small-case mismatch — investigate)";
  }
  if (big < 200000) return small < 26000 ? "eip2565" : "LIKELY-eip2565 (small-case mismatch — investigate)";
  return "AMBIGUOUS (between bands — investigate)";
}

// v5.13.1: BOUNDED-INPUT signature — the big case REVERTS while the small case
// prices normally. Observed on ZKsync Era (MODEXP operand bound ≤32 bytes,
// stricter than EIP-7823's 1024B): the large-input asymmetry class is dead on
// arrival there regardless of pricing. Small-case ≈7883-class (cannot separate
// the AA/pubdata floor precisely) → stored as eip7883 with a documenting note.
function isBoundedSignature(b, s) {
  return !!(b.err && /revert/i.test(String(b.err)) && s.gas);
}

const upsertMode = process.argv.includes("--upsert");
const extra = process.argv.slice(2).filter((s) => s !== "--upsert").map((s) => {
  const idx = s.indexOf("=");
  return idx > 0 ? [s.slice(0, idx), s.slice(idx + 1)] : [s, ""];
}).filter(([n, u]) => n && u.startsWith("http"));

const targets = [...CHAINS, ...extra];
let anomalous = 0;
let unexplained = 0;
const results = [];
console.log("chain             big-case      small-case    missing-precompiles      verdict");
for (const [name, url] of targets) {
  const avail = await availability(url);
  if (avail.err) {
    anomalous++;
    if (!EXPLAINED_OVERRIDES[name]) unexplained++;
    results.push({ name, err: String(avail.err) });
    console.log(`${name.padEnd(18)}ERR           ERR           ?                      ${avail.err}`);
    continue;
  }
  const missing = avail.missing;
  const missingStr = missing.length > 0 ? missing.map((a) => PRECOMPILE_NAMES[a]).join(",") : "-";
  if (missing.includes(0x05)) {
    // No MODEXP → no pricing regime exists on this chain (v5.13.1).
    results.push({ name, verdict: "unsupported", missing, inconclusive: avail.inconclusive });
    console.log(`${name.padEnd(18)}${"n/a".padEnd(14)}${"n/a".padEnd(14)}${missingStr.padEnd(23)}unsupported (no MODEXP)`);
    continue;
  }
  const b = await estimate(url, BIG);
  const s = await estimate(url, SMALL);
  if (isBoundedSignature(b, s)) {
    results.push({ name, verdict: "BOUNDED-INPUT", big: null, small: s.gas, missing, inconclusive: avail.inconclusive });
    console.log(`${name.padEnd(18)}${"REVERT".padEnd(14)}${String(s.gas).padEnd(14)}${missingStr.padEnd(23)}BOUNDED-INPUT (big case reverts — input bound; stored as eip7883-class mitigated)`);
    continue;
  }
  if (b.err || s.err) {
    anomalous++;
    if (!EXPLAINED_OVERRIDES[name]) unexplained++;
    results.push({ name, err: String(b.err ?? s.err), missing });
    console.log(`${name.padEnd(18)}ERR           ERR           ${missingStr.padEnd(23)}${b.err ?? s.err}`);
    continue;
  }
  const verdict = classify(b.gas, s.gas);
  if (!verdict.startsWith("eip") && !verdict.startsWith("LIKELY") && verdict !== "BOUNDED-INPUT") {
    anomalous++;
    if (!EXPLAINED_OVERRIDES[name]) unexplained++;
  }
  results.push({ name, big: b.gas, small: s.gas, verdict, missing, inconclusive: avail.inconclusive });
  console.log(`${name.padEnd(18)}${String(b.gas).padEnd(14)}${String(s.gas).padEnd(14)}${missingStr.padEnd(23)}${verdict}`);
}
console.log(`\n${targets.length} chains probed, ${anomalous} anomalous (${unexplained} unexplained). Map edits require a green (or explained) probe.`);

if (upsertMode) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    console.error("--upsert requires $SUPABASE_ACCESS_TOKEN");
    process.exit(2);
  }
  async function sql(query) {
    const r = await fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query`, {
      method: "POST",
      headers: { "authorization": `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (!r.ok) throw new Error(`management API ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r.json();
  }
  const now = new Date().toISOString();
  let upserted = 0, skipped = 0;
  for (const r of results) {
    const override = EXPLAINED_OVERRIDES[r.name];
    let regime = null, note = null;
    if (override) {
      regime = override.regime;
      note = override.note;
    } else if (r.verdict === "unsupported") {
      regime = "unsupported";
      note = `live availability probe: ${r.missing.map((a) => PRECOMPILE_NAMES[a]).join(", ")} revert (no such precompile)`;
    } else if (r.verdict === "BOUNDED-INPUT") {
      regime = "eip7883";
      note = `live probe: MODEXP big case (256B operands) REVERTS — protocol input bound (stricter than EIP-7823), asymmetry class dead on arrival; small case ${r.small} gas ≈7883-class`;
    } else if (r.verdict === "eip2565" || r.verdict === "eip7883") {
      regime = r.verdict;
      note = "live MODEXP price probe" + (r.missing?.length ? `; missing precompiles: ${r.missing.map((a) => PRECOMPILE_NAMES[a]).join(", ")}` : "");
    } else {
      skipped++;
      console.log(`SKIP upsert ${r.name}: verdict "${r.verdict ?? r.err}" is not a clean regime — human review required (existing row untouched).`);
      continue;
    }
    const missingList = (r.missing ?? []).filter((a) => Number.isInteger(a));
    const missingSql = `'{${missingList.map((a) => "0x" + a.toString(16).padStart(2, "0")).join(",")}}'`;
    const inconclusiveNote = r.inconclusive?.length ? ` Inconclusive (not claimed): ${r.inconclusive.map((a) => PRECOMPILE_NAMES[a]).join(", ")}.` : "";
    const big = r.big ?? "NULL", small = r.small ?? "NULL";
    await sql(
      `INSERT INTO public.chain_regimes (chain_key, regime, probed_at, probe_big_gas, probe_small_gas, source, note, unsupported_precompiles) VALUES ('${r.name}', '${regime}', '${now}', ${big}, ${small}, 'probe', '${(note + inconclusiveNote).replace(/'/g, "''")}', ${missingSql}) ON CONFLICT (chain_key) DO UPDATE SET regime = EXCLUDED.regime, probed_at = EXCLUDED.probed_at, probe_big_gas = EXCLUDED.probe_big_gas, probe_small_gas = EXCLUDED.probe_small_gas, source = EXCLUDED.source, note = EXCLUDED.note, unsupported_precompiles = EXCLUDED.unsupported_precompiles;`,
    );
    upserted++;
    console.log(`UPSERTED ${r.name}: ${regime} @ ${now}${missingList.length ? ` (missing: ${missingList.map((a) => PRECOMPILE_NAMES[a]).join(", ")})` : ""}`);
  }
  console.log(`\nupsert complete: ${upserted} upserted, ${skipped} skipped (skipped rows keep their previous probed_at — they will go stale per TTL if unresolved).`);
  if (unexplained > 0) process.exit(1); // cron must see UNEXPLAINED anomalies; explained overrides (e.g. Nova) are permanent
}
