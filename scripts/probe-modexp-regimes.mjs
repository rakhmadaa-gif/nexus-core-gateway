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
//
// Re-run cadence: after any protocol review, before any regime-map edit, and
// periodically (monthly) — regimes change only at hardforks, but docs lag.

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

const extra = process.argv.slice(2).map((s) => {
  const idx = s.indexOf("=");
  return idx > 0 ? [s.slice(0, idx), s.slice(idx + 1)] : [s, ""];
}).filter(([n, u]) => n && u.startsWith("http"));

const targets = [...CHAINS, ...extra];
let anomalous = 0;
console.log("chain             big-case      small-case    verdict");
for (const [name, url] of targets) {
  const b = await estimate(url, BIG);
  const s = await estimate(url, SMALL);
  if (b.err || s.err) {
    anomalous++;
    console.log(`${name.padEnd(18)}ERR           ERR           ${b.err ?? s.err}`);
    continue;
  }
  const verdict = classify(b.gas, s.gas);
  if (!verdict.startsWith("eip") && !verdict.startsWith("LIKELY")) anomalous++;
  console.log(`${name.padEnd(18)}${String(b.gas).padEnd(14)}${String(s.gas).padEnd(14)}${verdict}`);
}
console.log(`\n${targets.length} chains probed, ${anomalous} anomalous. Map edits require a green (or explained) probe.`);
