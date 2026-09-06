#!/usr/bin/env node
/**
 * Nexus Gateway — Agent Marketplace Submission
 * 
 * Submits Aegis to x402 agent directories.
 * 
 * Usage: node scripts/marketplace-submit.js [--dry-run]
 * Output: Submission status per marketplace
 */

const https = require('node:https');
const fs = require('node:fs');

const isDryRun = process.argv.includes('--dry-run');

// ─── Marketplace Configurations ─────────────────────────

const MARKETPLACES = [
  {
    name: 'x402-list.com',
    url: 'https://x402-list.com/api/v1/submit',
    method: 'POST',
    payload: {
      service_name: 'Nexus Legal ContractDrafter',
      url: 'https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world',
      website_url: 'https://rakhmadaa-gif.github.io/nexus-core-gateway/',
      email: 'rakhmadaa@gmail.com',
      category: 'Blockchain',
      description: 'M2M Autonomous Legal-Code Gateway — structured data, Solidity security audits (7 breach scenarios), bilingual legal contracts mapped to code via Digital Twin v3.1. Credit-based billing (1 CREDIT = $0.01, USDC on Polygon). Free endpoints: manifest, samples, metrics, dry-run, landing page.',
      endpoints: [
        '/manifest.json',
        '/samples',
        '/metrics',
        '/gateway/dry-run',
        '/landing'
      ]
    }
  },
  {
    name: 'x402 Hub',
    url: 'https://api.x402hub.ai/api/agents/register',
    method: 'POST',
    payload: {
      name: 'Nexus.Legal.ContractDrafter',
      capabilities: ['structured_data', 'code_modules', 'legal_code', 'dry_run', 'pull_payment'],
      endpoints: [
        'https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world'
      ]
    },
    skipOnSSLError: true
  },
  {
    name: 'Agora402',
    url: 'https://agora402.io/api/v1/discover?category=legal',
    method: 'GET',
    payload: null,
    note: 'Agora402 may auto-crawl .well-known/agent-card.json. Check if manual submission is needed.'
  }
];

// ─── Retry Helper ────────────────────────────────────────

async function withRetry(fn, maxAttempts = 5) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
      console.log(`    ⏳ Attempt ${attempt} failed, retrying in ${Math.round(delay/1000)}s... (${err.message})`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// ─── HTTP Helper ─────────────────────────────────────────

function httpRequest(url, method, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const postData = body ? JSON.stringify(body) : null;
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: { 'Accept': 'application/json', 'User-Agent': 'Nexus-Gateway-Ratification/1.0' },
      timeout: 15000
    };
    
    if (postData) {
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
    });
    
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    
    if (postData) req.write(postData);
    req.end();
  });
}

// ─── Main ───────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  AGENT MARKETPLACE SUBMISSION                                 ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  if (isDryRun) {
    console.log('  🔍 DRY RUN MODE — no actual submissions will be made\n');
  }

  // Load state
  let state = {};
  try { state = JSON.parse(fs.readFileSync('ratification-state.json', 'utf8')); } catch {}
  
  if (!state.phase2_marketplaces) {
    state.phase2_marketplaces = {};
  }

  const results = [];

  for (const mkt of MARKETPLACES) {
    console.log(`\n  ─── ${mkt.name} ───`);
    console.log(`  URL: ${mkt.url}`);
    console.log(`  Method: ${mkt.method}`);
    
    if (mkt.note) {
      console.log(`  Note: ${mkt.note}`);
    }

    if (isDryRun) {
      if (mkt.payload) {
        console.log(`  Payload:`);
        console.log(`  ${JSON.stringify(mkt.payload, null, 2).split('\n').join('\n  ')}`);
      }
      results.push({ marketplace: mkt.name, status: 'dry-run', url: mkt.url });
      state.phase2_marketplaces[mkt.name.toLowerCase().replace(/\s/g, '_')] = {
        status: 'dry-run',
        attempts: 0,
        last_error: null
      };
      continue;
    }

    try {
      const response = await withRetry(async () => {
        return await httpRequest(mkt.url, mkt.method, mkt.payload);
      });

      if (response.status >= 200 && response.status < 300) {
        console.log(`  ✅ SUCCESS — HTTP ${response.status}`);
        let parsed;
        try { parsed = JSON.parse(response.data); } catch { parsed = response.data.substring(0, 200); }
        console.log(`  Response: ${JSON.stringify(parsed).substring(0, 200)}`);
        results.push({ marketplace: mkt.name, status: 'success', response: parsed });
        state.phase2_marketplaces[mkt.name.toLowerCase().replace(/\s/g, '_')] = {
          status: 'success',
          attempts: 1,
          last_error: null,
          submitted_at: new Date().toISOString()
        };
      } else if (response.status >= 400 && response.status < 500) {
        console.log(`  ❌ CLIENT ERROR — HTTP ${response.status}`);
        console.log(`  Response: ${response.data.substring(0, 200)}`);
        console.log(`  ⚠️  Not retrying (likely schema issue)`);
        results.push({ marketplace: mkt.name, status: 'client_error', code: response.status });
        state.phase2_marketplaces[mkt.name.toLowerCase().replace(/\s/g, '_')] = {
          status: 'client_error',
          attempts: 1,
          last_error: `HTTP ${response.status}: ${response.data.substring(0, 100)}`
        };
      } else {
        console.log(`  ❌ SERVER ERROR — HTTP ${response.status}`);
        console.log(`  Response: ${response.data.substring(0, 200)}`);
        results.push({ marketplace: mkt.name, status: 'server_error', code: response.status });
        state.phase2_marketplaces[mkt.name.toLowerCase().replace(/\s/g, '_')] = {
          status: 'server_error',
          attempts: 5,
          last_error: `HTTP ${response.status}: ${response.data.substring(0, 100)}`
        };
      }
    } catch (err) {
      const isSSLError = err.message.includes('Hostname/IP') || err.message.includes('certificate') || err.message.includes('SSL');
      if (mkt.skipOnSSLError && isSSLError) {
        console.log(`  ⏭️  SKIPPED — SSL/cert issue on ${mkt.name} (expected, skipping)`);
        results.push({ marketplace: mkt.name, status: 'skipped_ssl', error: err.message });
        state.phase2_marketplaces[mkt.name.toLowerCase().replace(/\s/g, '_')] = {
          status: 'skipped_ssl',
          attempts: 1,
          last_error: err.message
        };
      } else {
        console.log(`  ❌ FAILED — ${err.message}`);
        results.push({ marketplace: mkt.name, status: 'failed', error: err.message });
        state.phase2_marketplaces[mkt.name.toLowerCase().replace(/\s/g, '_')] = {
          status: 'failed',
          attempts: 5,
          last_error: err.message
        };
      }
    }
  }

  // Save state
  fs.writeFileSync('ratification-state.json', JSON.stringify(state, null, 2));
  console.log(`\n  💾 State saved to ratification-state.json`);

  // Summary
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  SUBMISSION SUMMARY                                           ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  for (const r of results) {
    const icon = r.status === 'success' ? '✅' : r.status === 'dry-run' ? '🔍' : r.status === 'skipped_ssl' ? '⏭️' : '❌';
    console.log(`  ${icon} ${r.marketplace}: ${r.status}`);
  }

  console.log('');
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  process.exit(1);
});
