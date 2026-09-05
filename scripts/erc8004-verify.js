#!/usr/bin/env node
/**
 * Nexus Gateway — ERC-8004 Registration Verification
 * 
 * Verifies ERC-8004 registration by reading on-chain data.
 * 
 * Usage: node scripts/erc8004-verify.js <agentId> [--testnet]
 * Output: agentId, owner, tokenURI, metadata, agentWallet
 */

const { ethers } = require('ethers');

const isTestnet = process.argv.includes('--testnet');
const agentIdArg = process.argv.find(arg => !arg.startsWith('-') && arg !== process.argv[0] && arg !== process.argv[1]);

if (!agentIdArg) {
  console.error('Usage: node scripts/erc8004-verify.js <agentId> [--testnet]');
  process.exit(1);
}

const agentId = BigInt(agentIdArg);

const CONFIG = {
  mainnet: {
    rpc: 'https://polygon-bor-rpc.publicnode.com',
    identityRegistry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    reputationRegistry: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
    explorer: 'https://polygonscan.com',
  },
  testnet: {
    rpc: 'https://rpc-amoy.polygon.technology',
    identityRegistry: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
    reputationRegistry: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
    explorer: 'https://amoy.polygonscan.com',
  }
};

const net = isTestnet ? CONFIG.testnet : CONFIG.mainnet;

const IDENTITY_ABI = [
  { inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }], name: 'tokenURI', outputs: [{ internalType: 'string', name: '', type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }], name: 'ownerOf', outputs: [{ internalType: 'address', name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }, { internalType: 'string', name: 'metadataKey', type: 'string' }], name: 'getMetadata', outputs: [{ internalType: 'bytes', name: '', type: 'bytes' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }], name: 'getAgentWallet', outputs: [{ internalType: 'address', name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'name', outputs: [{ internalType: 'string', name: '', type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'symbol', outputs: [{ internalType: 'string', name: '', type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'totalSupply', outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
];

const REPUTATION_ABI = [
  { inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }, { internalType: 'address[]', name: 'clientAddresses', type: 'address[]' }, { internalType: 'string', name: 'tag1', type: 'string' }, { internalType: 'string', name: 'tag2', type: 'string' }], name: 'getSummary', outputs: [{ internalType: 'uint256', name: 'count', type: 'uint256' }, { internalType: 'int128', name: 'summaryValue', type: 'int128' }, { internalType: 'uint8', name: 'summaryValueDecimals', type: 'uint8' }], stateMutability: 'view', type: 'function' },
];

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log(`║  ERC-8004 VERIFICATION — ${isTestnet ? 'AMOY TESTNET' : 'POLYGON MAINNET'}${' '.repeat(Math.max(0, 20 - (isTestnet ? 13 : 15)))}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const provider = new ethers.JsonRpcProvider(net.rpc);
  const registry = new ethers.Contract(net.identityRegistry, IDENTITY_ABI, provider);

  // Registry info
  try {
    const name = await registry.name();
    const symbol = await registry.symbol();
    console.log(`  Registry: ${name} (${symbol})`);
    console.log(`  Address:  ${net.identityRegistry}`);
    console.log('');

    try {
      const totalSupply = await registry.totalSupply();
      console.log(`  Total agents registered: ${totalSupply.toString()}`);
    } catch {}
  } catch (err) {
    console.log(`  ⚠️  Could not read registry name: ${err.message}`);
  }

  console.log(`\n  Verifying agentId: ${agentId.toString()}`);
  console.log('');

  // Owner
  try {
    const owner = await registry.ownerOf(agentId);
    console.log(`  ✅ Owner:     ${owner}`);
  } catch (err) {
    console.log(`  ❌ Owner:     NOT FOUND (${err.message})`);
    process.exit(1);
  }

  // tokenURI
  try {
    const uri = await registry.tokenURI(agentId);
    console.log(`  ✅ tokenURI:  ${uri}`);
  } catch (err) {
    console.log(`  ❌ tokenURI:  ${err.message}`);
  }

  // agentWallet
  try {
    const wallet = await registry.getAgentWallet(agentId);
    console.log(`  ✅ Wallet:    ${wallet}`);
  } catch (err) {
    console.log(`  ⚠️  Wallet:    Not set or not available`);
  }

  // Metadata
  console.log('\n  Metadata:');
  const metadataKeys = ['category', 'version', 'gateway', 'sla'];
  for (const key of metadataKeys) {
    try {
      const valueBytes = await registry.getMetadata(agentId, key);
      const value = ethers.toUtf8String(valueBytes);
      console.log(`    ✅ ${key}: ${value}`);
    } catch (err) {
      console.log(`    ⚠️  ${key}: not set or error`);
    }
  }

  // Reputation (if available)
  console.log('\n  Reputation:');
  try {
    const repRegistry = new ethers.Contract(net.reputationRegistry, REPUTATION_ABI, provider);
    const summary = await repRegistry.getSummary(agentId, [ethers.ZeroAddress], '', '');
    if (summary.count > 0) {
      const score = Number(summary.summaryValue) / Math.pow(10, summary.summaryValueDecimals);
      console.log(`    ✅ Feedback count: ${summary.count.toString()}`);
      console.log(`    ✅ Average score: ${score}`);
    } else {
      console.log(`    ℹ️  No feedback yet (agent is new)`);
    }
  } catch (err) {
    console.log(`    ⚠️  Could not read reputation: ${err.message}`);
  }

  // Explorer link
  console.log(`\n  Explorer: ${net.explorer}/address/${net.identityRegistry}#readContract`);
  console.log(`  Token ID:  ${agentId.toString()}`);
  console.log('');
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  process.exit(1);
});
