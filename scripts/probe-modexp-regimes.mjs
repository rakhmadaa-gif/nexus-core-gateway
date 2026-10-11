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

const SUPABASE_PROJECT_REF = "xibzsthfrbomefnvbicb";

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
    if (j.error) return { err: j.error.message ?? JSON.stringify(j.error) };
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

const upsertMode = process.argv.includes("--upsert");
const extra = process.argv.slice(2).filter((s) => s !== "--upsert").map((s) => {
  const idx = s.indexOf("=");
  return idx > 0 ? [s.slice(0, idx), s.slice(idx + 1)] : [s, ""];
}).filter(([n, u]) => n && u.startsWith("http"));

const targets = [...CHAINS, ...extra];
let anomalous = 0;
let unexplained = 0;
const results = [];
console.log("chain             big-case      small-case    verdict");
for (const [name, url] of targets) {
  const b = await estimate(url, BIG);
  const s = await estimate(url, SMALL);
  if (b.err || s.err) {
    anomalous++;
    if (!EXPLAINED_OVERRIDES[name]) unexplained++;
    results.push({ name, err: String(b.err ?? s.err) });
    console.log(`${name.padEnd(18)}ERR           ERR           ${b.err ?? s.err}`);
    continue;
  }
  const verdict = classify(b.gas, s.gas);
  if (!verdict.startsWith("eip") && !verdict.startsWith("LIKELY")) {
    anomalous++;
    if (!EXPLAINED_OVERRIDES[name]) unexplained++;
  }
  results.push({ name, big: b.gas, small: s.gas, verdict });
  console.log(`${name.padEnd(18)}${String(b.gas).padEnd(14)}${String(s.gas).padEnd(14)}${verdict}`);
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
    } else if (r.verdict === "eip2565" || r.verdict === "eip7883") {
      regime = r.verdict;
      note = "live MODEXP price probe";
    } else {
      skipped++;
      console.log(`SKIP upsert ${r.name}: verdict "${r.verdict ?? r.err}" is not a clean regime — human review required (existing row untouched).`);
      continue;
    }
    const big = r.big ?? "NULL", small = r.small ?? "NULL";
    await sql(
      `INSERT INTO public.chain_regimes (chain_key, regime, probed_at, probe_big_gas, probe_small_gas, source, note) VALUES ('${r.name}', '${regime}', '${now}', ${big}, ${small}, 'probe', '${note.replace(/'/g, "''")}') ON CONFLICT (chain_key) DO UPDATE SET regime = EXCLUDED.regime, probed_at = EXCLUDED.probed_at, probe_big_gas = EXCLUDED.probe_big_gas, probe_small_gas = EXCLUDED.probe_small_gas, source = EXCLUDED.source, note = EXCLUDED.note;`,
    );
    upserted++;
    console.log(`UPSERTED ${r.name}: ${regime} @ ${now}`);
  }
  console.log(`\nupsert complete: ${upserted} upserted, ${skipped} skipped (skipped rows keep their previous probed_at — they will go stale per TTL if unresolved).`);
  if (unexplained > 0) process.exit(1); // cron must see UNEXPLAINED anomalies; explained overrides (e.g. Nova) are permanent
}
