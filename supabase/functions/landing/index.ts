import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const LANDING_URL = "https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/landing";
const MANIFEST_URL = "https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world/manifest.json";
const SAMPLES_URL = "https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world/samples";
const METRICS_URL = "https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world/metrics";

const ROBOTS_TXT = `User-agent: *
Allow: /
Disallow: /functions/v1/hello-world

Sitemap: ${LANDING_URL}?sitemap=1
`;

const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${LANDING_URL}</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${MANIFEST_URL}</loc>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${SAMPLES_URL}</loc>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>${METRICS_URL}</loc>
    <changefreq>hourly</changefreq>
    <priority>0.5</priority>
  </url>
</urlset>`;

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Nexus Gateway — M2M Legal-Code Services for Web3</title>
<meta name="description" content="Autonomous legal-code engine that generates verified structured data, audited Solidity smart contracts, and bilingual (EN/ID) legal contracts with Digital Twin v3.1 mapping.">
<meta name="keywords" content="smart contract, legal contract, solidity, web3, blockchain, ERC-20, ERC-721, escrow, digital twin, bilingual legal, Indonesia, M2M, API, Polygon, USDC">
<meta property="og:title" content="Nexus Gateway — M2M Legal-Code Services for Web3">
<meta property="og:description" content="Autonomous legal-code engine. Legal contracts + Solidity code + Digital Twin mapping. Bilingual EN/ID.">
<meta property="og:type" content="website">
<meta property="og:url" content="${LANDING_URL}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Nexus Gateway — M2M Legal-Code Services">
<meta name="twitter:description" content="Legal contracts + Solidity code + Digital Twin mapping. Bilingual EN/ID.">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0a0a;color:#e0e0e0;line-height:1.6}
.container{max-width:900px;margin:0 auto;padding:0 20px}
header{padding:60px 0 40px;text-align:center}
header h1{font-size:2.5em;color:#fff;margin-bottom:10px}
header h1 span{color:#8247E5}
header p{font-size:1.2em;color:#999;max-width:600px;margin:0 auto 20px}
.badges{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-bottom:30px}
.badge{padding:5px 12px;border-radius:20px;font-size:.85em;font-weight:600}
.badge-green{background:#1a3a1a;color:#4ade80;border:1px solid #4ade80}
.badge-blue{background:#1a1a3a;color:#60a5fa;border:1px solid #60a5fa}
.badge-purple{background:#2a1a3a;color:#c084fc;border:1px solid #8247E5}
.badge-orange{background:#3a2a1a;color:#fbbf24;border:1px solid #fbbf24}
section{padding:40px 0}
h2{font-size:1.8em;color:#fff;margin-bottom:20px}
.services{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:20px}
.service{background:#1a1a1a;border:1px solid #333;border-radius:10px;padding:25px;transition:border-color .3s}
.service:hover{border-color:#8247E5}
.service h3{color:#8247E5;margin-bottom:10px;font-size:1.2em}
.service .price{color:#fbbf24;font-weight:700;font-size:1.1em;margin-bottom:8px}
.service p{color:#999;font-size:.95em}
.endpoints{background:#1a1a1a;border-radius:10px;overflow:hidden}
.endpoint{display:flex;align-items:center;padding:15px 20px;border-bottom:1px solid #333}
.endpoint:last-child{border-bottom:none}
.method{padding:3px 10px;border-radius:5px;font-size:.8em;font-weight:700;margin-right:15px;min-width:50px;text-align:center}
.get{background:#1a3a1a;color:#4ade80}
.post{background:#3a2a1a;color:#fbbf24}
.path{font-family:monospace;color:#60a5fa}
.desc{color:#666;margin-left:auto;font-size:.85em}
.free{color:#4ade80;font-weight:600}
.code-block{background:#111;border:1px solid #333;border-radius:8px;padding:20px;overflow-x:auto;margin:15px 0}
.code-block code{font-family:'Fira Code',monospace;font-size:.9em;color:#e0e0e0}
.comment{color:#666}
.string{color:#4ade80}
.breach-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:15px}
.breach{background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:15px}
.breach h4{color:#fbbf24;margin-bottom:5px;font-size:.95em}
.breach p{color:#888;font-size:.85em}
.blockchain{display:flex;flex-direction:column;gap:10px}
.chain-item{display:flex;justify-content:space-between;padding:12px 20px;background:#1a1a1a;border:1px solid #333;border-radius:8px}
.chain-item .label{color:#999}
.chain-item .value{font-family:monospace;color:#60a5fa}
.cta{text-align:center;padding:50px 0}
.btn{display:inline-block;padding:12px 30px;border-radius:8px;font-weight:700;text-decoration:none;margin:5px}
.btn-primary{background:#8247E5;color:#fff}
.btn-secondary{background:#1a1a1a;color:#8247E5;border:1px solid #8247E5}
footer{padding:30px 0;text-align:center;color:#555;font-size:.85em;border-top:1px solid #222}
a{color:#8247E5;text-decoration:none}
a:hover{text-decoration:underline}
.stats{display:flex;justify-content:center;gap:40px;margin:30px 0;flex-wrap:wrap}
.stat{text-align:center}
.stat .num{font-size:2em;color:#8247E5;font-weight:700}
.stat .label{color:#666;font-size:.9em}
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>Nexus<span>.</span>Gateway</h1>
    <p>Autonomous legal-code engine for Web3. Generates verified structured data, audited Solidity smart contracts, and bilingual (EN/ID) legal contracts — mapped via Digital Twin v3.1.</p>
    <div class="badges">
      <span class="badge badge-green">DEPLOYED</span>
      <span class="badge badge-blue">v4.0.0-frontier</span>
      <span class="badge badge-purple">Polygon PoS</span>
      <span class="badge badge-orange">~3ms latency</span>
    </div>
    <div class="stats">
      <div class="stat"><div class="num">5</div><div class="label">Services</div></div>
      <div class="stat"><div class="num">7</div><div class="label">Breach Scenarios</div></div>
      <div class="stat"><div class="num">3</div><div class="label">Sample Tiers</div></div>
      <div class="stat"><div class="num">17/17</div><div class="label">E2E Tests</div></div>
    </div>
  </header>

  <section>
    <h2>Services</h2>
    <div class="services">
      <div class="service"><h3>Structured Data</h3><div class="price">20 CRED ($0.20)</div><p>Verified JSON schemas for Web3, regulatory compliance, and cross-platform orchestration.</p></div>
      <div class="service"><h3>Code Modules</h3><div class="price">120 CRED ($1.20)</div><p>Security-checked Solidity smart contracts — ERC-20, ERC-721, Escrow logic.</p></div>
      <div class="service"><h3>Legal-Code Hybrid</h3><div class="price">29,900 CRED ($299.00)</div><p>Bilingual (EN/ID) legal contracts mapped directly to code functions via Digital Twin v3.1.</p></div>
      <div class="service"><h3>Pull Payment</h3><div class="price">FREE (adds credits)</div><p>USDC top-up on Polygon via EIP-712 Permit. Auto-converts to CRED. No charge.</p></div>
    </div>
  </section>

  <section>
    <h2>Quick Start — Try It Free</h2>
    <div class="code-block">
<code><span class="comment"># 1. Discover — see what we offer (free, no auth)</span>
curl ${MANIFEST_URL}

<span class="comment"># 2. Test your Solidity contract — free, 7 breach scenarios</span>
curl -X POST https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world/gateway/dry-run \\
  -H <span class="string">"Content-Type: application/json"</span> \\
  -d <span class="string">'{"source_code": "pragma solidity ^0.8.20; contract Token { }"}</span>'

<span class="comment"># 3. View sample manifests (3 tiers)</span>
curl ${SAMPLES_URL}</code>
    </div>
  </section>

  <section>
    <h2>Endpoints</h2>
    <div class="endpoints">
      <div class="endpoint"><span class="method get">GET</span><span class="path">/manifest.json</span><span class="desc"><span class="free">FREE</span> — A2A agent discovery</span></div>
      <div class="endpoint"><span class="method get">GET</span><span class="path">/samples</span><span class="desc"><span class="free">FREE</span> — 3-tier sample manifests</span></div>
      <div class="endpoint"><span class="method get">GET</span><span class="path">/metrics</span><span class="desc"><span class="free">FREE</span> — Live telemetry</span></div>
      <div class="endpoint"><span class="method post">POST</span><span class="path">/gateway/dry-run</span><span class="desc"><span class="free">FREE</span> — Solidity validation + breach sim</span></div>
      <div class="endpoint"><span class="method post">POST</span><span class="path">/</span><span class="desc">Paid — All services (x-client-id required)</span></div>
    </div>
  </section>

  <section>
    <h2>Breach Simulation — 7 Scenarios</h2>
    <div class="breach-grid">
      <div class="breach"><h4>BS-001 Unauthorized Minting</h4><p>Can attacker mint without authorization?</p></div>
      <div class="breach"><h4>BS-002 Transfer Violation</h4><p>Can transfers bypass balance checks?</p></div>
      <div class="breach"><h4>BS-003 Fund Drain</h4><p>Can anyone withdraw without auth?</p></div>
      <div class="breach"><h4>BS-004 Emergency Freeze</h4><p>Does contract have pause mechanism?</p></div>
      <div class="breach"><h4>BS-005 Ownership Renounce</h4><p>Can ownership be renounced?</p></div>
      <div class="breach"><h4>BS-006 Reentrancy Attack</h4><p>Are external calls protected?</p></div>
      <div class="breach"><h4>BS-007 Replay Attack</h4><p>Is nonce-based replay protection present?</p></div>
    </div>
  </section>

  <section>
    <h2>Blockchain</h2>
    <div class="blockchain">
      <div class="chain-item"><span class="label">Gateway.sol (Pull Payment)</span><span class="value">0xDEEc5BE05F0911b4aCD7FB6C8a4aa603C13F60e4</span></div>
      <div class="chain-item"><span class="label">USDC (native, 6 decimals)</span><span class="value">0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359</span></div>
      <div class="chain-item"><span class="label">Network</span><span class="value">Polygon PoS (Chain ID 137)</span></div>
    </div>
  </section>

  <div class="cta">
    <a href="https://github.com/rakhmadaa-gif/nexus-core-gateway" class="btn btn-primary">View on GitHub</a>
    <a href="${MANIFEST_URL}" class="btn btn-secondary">Get Manifest</a>
    <a href="${SAMPLES_URL}" class="btn btn-secondary">View Samples</a>
  </div>

  <footer>
    <p>Nexus Gateway v4.0.0-frontier — Phase 3 FINAL — FULLY OPERATIONAL</p>
    <p>1 CREDIT = $0.01 USD · 100 CREDIT = 1 USDC · MIT License</p>
    <p><a href="https://github.com/rakhmadaa-gif/nexus-core-gateway">GitHub</a> · <a href="https://polygonscan.com/address/0xDEEc5BE05F0911b4aCD7FB6C8a4aa603C13F60e4">PolygonScan</a> · <a href="${METRICS_URL}">Live Metrics</a></p>
  </footer>
</div>
</body>
</html>`;

serve(async (req: Request) => {
  const url = new URL(req.url);
  
  // Serve robots.txt
  if (url.searchParams.get("robots") === "1" || url.pathname.endsWith("/robots.txt")) {
    return new Response(ROBOTS_TXT, {
      headers: { "Content-Type": "text/plain", "Cache-Control": "public, max-age=86400" },
    });
  }
  
  // Serve sitemap.xml
  if (url.searchParams.get("sitemap") === "1" || url.pathname.endsWith("/sitemap.xml")) {
    return new Response(SITEMAP_XML, {
      headers: { "Content-Type": "application/xml", "Cache-Control": "public, max-age=3600" },
    });
  }
  
  // Serve landing page
  return new Response(HTML, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
});
