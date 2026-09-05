#!/usr/bin/env node
/**
 * Nexus Gateway — Full Ratification Pipeline Orchestrator
 * 
 * Runs the complete ratification pipeline in order:
 * 1. Self-validate (must pass all checks)
 * 2. ERC-8004 register on Polygon
 * 3. Verify ERC-8004 registration
 * 4. Submit to marketplaces
 * 5. Save final state report
 * 
 * Usage: node scripts/ratify.js [--testnet] [--skip-erc8004] [--skip-marketplaces]
 * Output: Complete ratification report
 */

const { execSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const isTestnet = args.includes('--testnet');
const skipErc8004 = args.includes('--skip-erc8004');
const skipMarketplaces = args.includes('--skip-marketplaces');

function runScript(scriptPath, scriptArgs = []) {
  const cmd = `node ${scriptPath} ${scriptArgs.join(' ')}`;
  console.log(`\n  $ ${cmd}\n`);
  try {
    execSync(cmd, { cwd: process.cwd(), encoding: 'utf8', stdio: 'inherit', env: process.env });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  NEXUS GATEWAY — FULL RATIFICATION PIPELINE                   ║');
  console.log(`║  Mode: ${isTestnet ? 'TESTNET (Amoy)' : 'MAINNET (Polygon)'}${' '.repeat(Math.max(0, 40 - (isTestnet ? 17 : 19)))}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const startTime = new Date();
  const report = {
    started_at: startTime.toISOString(),
    mode: isTestnet ? 'testnet' : 'mainnet',
    steps: {}
  };

  // ─── Step 1: Self-Validation ────────────────────────────
  
  console.log('━━━ Step 1/4: Self-Validation ━━━\n');
  const step1 = runScript(path.join(__dirname, 'self-validate.js'));
  report.steps.self_validation = {
    success: step1.success,
    badge: step1.success ? 'Verified Production-Ready' : 'NOT READY'
  };

  if (!step1.success) {
    console.log('\n❌ Self-validation failed. Aborting pipeline.');
    console.log('   Fix the failing checks before proceeding.\n');
    report.completed_at = new Date().toISOString();
    report.status = 'failed_at_validation';
    fs.writeFileSync('ratification-state.json', JSON.stringify(report, null, 2));
    process.exit(1);
  }

  console.log('  ✅ Self-validation passed!\n');

  // ─── Step 2: ERC-8004 Registration ──────────────────────
  
  if (!skipErc8004) {
    console.log('━━━ Step 2/4: ERC-8004 Registration ━━━\n');
    const erc8004Args = [];
    if (isTestnet) erc8004Args.push('--testnet');
    
    const step2 = runScript(path.join(__dirname, 'erc8004-register.js'), erc8004Args);
    report.steps.erc8004_registration = { success: step2.success };

    if (!step2.success) {
      console.log('\n⚠️  ERC-8004 registration failed. Continuing to marketplace submissions.');
      report.steps.erc8004_registration.error = step2.error;
    } else {
      console.log('  ✅ ERC-8004 registration completed!\n');

      // ─── Step 3: Verify ERC-8004 ──────────────────────────
      
      // Extract agentId from state file
      let agentId = null;
      try {
        const state = JSON.parse(fs.readFileSync('ratification-state.json', 'utf8'));
        agentId = state.phase1_erc8004?.agentId;
      } catch {}

      if (agentId) {
        console.log('━━━ Step 3/4: ERC-8004 Verification ━━━\n');
        const verifyArgs = [agentId];
        if (isTestnet) verifyArgs.push('--testnet');
        
        const step3 = runScript(path.join(__dirname, 'erc8004-verify.js'), verifyArgs);
        report.steps.erc8004_verification = { success: step3.success, agentId };
      }
    }
  } else {
    console.log('━━━ Step 2/4: ERC-8004 Registration — SKIPPED ━━━\n');
    report.steps.erc8004_registration = { success: true, skipped: true };
  }

  // ─── Step 4: Marketplace Submissions ────────────────────
  
  if (!skipMarketplaces) {
    console.log('━━━ Step 4/4: Marketplace Submissions ━━━\n');
    const step4 = runScript(path.join(__dirname, 'marketplace-submit.js'));
    report.steps.marketplace_submission = { success: step4.success };
  } else {
    console.log('━━━ Step 4/4: Marketplace Submissions — SKIPPED ━━━\n');
    report.steps.marketplace_submission = { success: true, skipped: true };
  }

  // ─── Final Report ───────────────────────────────────────
  
  const endTime = new Date();
  report.completed_at = endTime.toISOString();
  report.duration_seconds = Math.round((endTime - startTime) / 1000);
  
  const allSuccess = Object.values(report.steps).every(s => s.success);
  report.status = allSuccess ? 'completed' : 'completed_with_errors';

  // Save final state
  fs.writeFileSync('ratification-state.json', JSON.stringify(report, null, 2));

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  RATIFICATION COMPLETE                                        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  console.log(`  Status: ${report.status}`);
  console.log(`  Duration: ${report.duration_seconds}s`);
  console.log('');
  
  for (const [step, result] of Object.entries(report.steps)) {
    const icon = result.success ? '✅' : '❌';
    console.log(`  ${icon} ${step}: ${result.success ? 'success' : 'failed'}`);
  }

  console.log('\n  Next steps:');
  console.log('  1. Update .well-known/agent.json with ERC-8004 agentId');
  console.log('  2. Update GitHub Pages with "ERC-8004 Verified" badge');
  console.log('  3. Update README.md with registration info');
  console.log('  4. Set up monitoring cron for registration health');
  console.log('');
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  process.exit(1);
});
