#!/usr/bin/env node
/**
 * Nexus Gateway — ERC-8004 Identity Registration on Polygon
 * 
 * Mints an agent identity NFT on the ERC-8004 IdentityRegistry.
 * Uses ethers.js v6 (npm install ethers).
 * 
 * Prerequisites:
 *   - npm install ethers
 *   - POLYGON_PRIVATE_KEY environment variable set
 *   - Treasury wallet has >= 0.05 MATIC
 * 
 * Usage: node scripts/erc8004-register.js [--testnet]
 * Output: Transaction hash + agentId
 */

const { ethers } = require('ethers');

// ─── Configuration ───────────────────────────────────────

const isTestnet = process.argv.includes('--testnet');

const CONFIG = {
  mainnet: {
    rpc: 'https://polygon-bor-rpc.publicnode.com',
    chainId: 137,
    identityRegistry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    explorer: 'https://polygonscan.com',
  },
  testnet: {
    rpc: 'https://rpc-amoy.polygon.technology',
    chainId: 80002,
    identityRegistry: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
    explorer: 'https://amoy.polygonscan.com',
  }
};

const net = isTestnet ? CONFIG.testnet : CONFIG.mainnet;

const AGENT_URI = 'https://raw.githubusercontent.com/rakhmadaa-gif/nexus-core-gateway/main/.well-known/agent.json';

// Metadata entries
const METADATA = [
  { metadataKey: 'category', metadataValue: ethers.toUtf8Bytes('legal-code') },
  { metadataKey: 'version', metadataValue: ethers.toUtf8Bytes('4.0.0-frontier') },
  { metadataKey: 'gateway', metadataValue: ethers.toUtf8Bytes('0xDEEc5BE05F0911b4aCD7FB6C8a4aa603C13F60e4') },
  { metadataKey: 'sla', metadataValue: ethers.toUtf8Bytes('99.9') },
];

// IdentityRegistry ABI (all register overloads + key functions)
const IDENTITY_ABI = [
  // register() — no args
  {
    inputs: [],
    name: 'register',
    outputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  // register(string agentURI)
  {
    inputs: [
      { internalType: 'string', name: 'agentURI', type: 'string' }
    ],
    name: 'register',
    outputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  // register(string agentURI, MetadataEntry[] metadata)
  {
    inputs: [
      { internalType: 'string', name: 'agentURI', type: 'string' },
      {
        components: [
          { internalType: 'string', name: 'metadataKey', type: 'string' },
          { internalType: 'bytes', name: 'metadataValue', type: 'bytes' }
        ],
        internalType: 'struct IdentityRegistryUpgradeable.MetadataEntry[]',
        name: 'metadata',
        type: 'tuple[]'
      }
    ],
    name: 'register',
    outputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  // setMetadata(uint256 agentId, string metadataKey, bytes metadataValue)
  {
    inputs: [
      { internalType: 'uint256', name: 'agentId', type: 'uint256' },
      { internalType: 'string', name: 'metadataKey', type: 'string' },
      { internalType: 'bytes', name: 'metadataValue', type: 'bytes' }
    ],
    name: 'setMetadata',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  // setAgentURI(uint256 agentId, string newURI)
  {
    inputs: [
      { internalType: 'uint256', name: 'agentId', type: 'uint256' },
      { internalType: 'string', name: 'newURI', type: 'string' }
    ],
    name: 'setAgentURI',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }],
    name: 'tokenURI',
    outputs: [{ internalType: 'string', name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }],
    name: 'ownerOf',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }],
    name: 'getAgentWallet',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'agentId', type: 'uint256' },
      { internalType: 'string', name: 'metadataKey', type: 'string' }
    ],
    name: 'getMetadata',
    outputs: [{ internalType: 'bytes', name: '', type: 'bytes' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'uint256', name: 'agentId', type: 'uint256' },
      { indexed: false, internalType: 'string', name: 'agentURI', type: 'string' },
      { indexed: true, internalType: 'address', name: 'owner', type: 'address' }
    ],
    name: 'Registered',
    type: 'event'
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
      console.log(`  ⏳ Attempt ${attempt} failed, retrying in ${Math.round(delay/1000)}s... (${err.message})`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// ─── Main ───────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log(`║  ERC-8004 IDENTITY REGISTRATION — ${isTestnet ? 'AMOY TESTNET' : 'POLYGON MAINNET'}${' '.repeat(Math.max(0, 22 - (isTestnet ? 13 : 15)))}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Check private key
  let privateKey = process.env.POLYGON_PRIVATE_KEY;
  if (!privateKey) {
    console.error('❌ POLYGON_PRIVATE_KEY not set');
    process.exit(1);
  }
  // Ensure 0x prefix for ethers.js
  if (!privateKey.startsWith('0x')) privateKey = '0x' + privateKey;

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider(net.rpc);
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log(`  Network: ${isTestnet ? 'Polygon Amoy' : 'Polygon Mainnet'} (chainId: ${net.chainId})`);
  console.log(`  IdentityRegistry: ${net.identityRegistry}`);
  console.log(`  Wallet: ${wallet.address}`);
  console.log(`  Agent URI: ${AGENT_URI}`);
  console.log('');

  // Check balance
  const balance = await provider.getBalance(wallet.address);
  const balanceMatic = Number(balance) / 1e18;
  console.log(`  Wallet balance: ${balanceMatic.toFixed(4)} MATIC`);

  if (balanceMatic < 0.005) {
    console.error(`❌ Insufficient MATIC. Need >= 0.005, have ${balanceMatic.toFixed(4)}`);
    console.error(`   Get testnet MATIC: https://www.alchemy.com/faucets/polygon-amoy`);
    process.exit(1);
  }

  // Create interface for encoding function calls
  const iface = new ethers.Interface(IDENTITY_ABI);

  // Register
  console.log('\n  📝 Registering agent identity...');
  console.log(`     URI: ${AGENT_URI}`);
  console.log(`     Metadata: ${METADATA.length} entries`);

  const tx = await withRetry(async () => {
    const feeData = await provider.getFeeData();
    // Encode function call manually to avoid ethers v6 overload resolution issues
    const calldata = iface.encodeFunctionData('register(string,(string,bytes)[])', [AGENT_URI, METADATA]);
    console.log(`     Encoded calldata length: ${calldata.length} chars`);
    // Estimate gas and add 20% buffer
    let gasLimit;
    try {
      const estimated = await provider.estimateGas({
        to: net.identityRegistry,
        data: calldata,
        from: wallet.address,
      });
      gasLimit = Math.ceil(Number(estimated) * 1.2);
      console.log(`     Gas estimate: ${estimated.toString()}, using: ${gasLimit}`);
    } catch (e) {
      gasLimit = 500000;
      console.log(`     Gas estimate failed, using default: ${gasLimit}`);
    }
    const tx = await wallet.sendTransaction({
      to: net.identityRegistry,
      data: calldata,
      gasLimit: gasLimit,
      gasPrice: feeData.gasPrice,
    });
    return tx;
  });

  console.log(`\n  ✅ Transaction sent: ${tx.hash}`);
  console.log(`     Explorer: ${net.explorer}/tx/${tx.hash}`);

  // Wait for confirmation
  console.log('\n  ⏳ Waiting for confirmation...');
  const receipt = await tx.wait();

  if (receipt.status === 0) {
    console.error('❌ Transaction reverted!');
    process.exit(1);
  }

  console.log(`  ✅ Confirmed in block ${receipt.blockNumber}`);
  console.log(`     Gas used: ${receipt.gasUsed.toString()}`);

  // Parse Registered event to get agentId
  const registeredEvent = receipt.logs.find(log => {
    try {
      const parsed = iface.parseLog(log);
      return parsed && parsed.name === 'Registered';
    } catch { return false; }
  });

  let agentId;
  if (registeredEvent) {
    const parsed = iface.parseLog(registeredEvent);
    agentId = parsed.args.agentId.toString();
    console.log(`\n  🎉 Agent ID: ${agentId}`);
    console.log(`     Owner: ${parsed.args.owner}`);
    console.log(`     URI: ${parsed.args.agentURI}`);
  } else {
    // Fallback: try reading the latest token
    console.log('\n  ⚠️  Could not parse Registered event from logs.');
    console.log('     Check transaction logs manually on explorer.');
    console.log(`     ${net.explorer}/tx/${tx.hash}#eventlog`);
  }

  // Verify registration
  if (agentId) {
    console.log('\n  📋 Verifying registration...');
    try {
      const registry = new ethers.Contract(net.identityRegistry, IDENTITY_ABI, provider);
      const uri = await registry.tokenURI(agentId);
      const owner = await registry.ownerOf(agentId);
      console.log(`     tokenURI(${agentId}): ${uri}`);
      console.log(`     ownerOf(${agentId}): ${owner}`);
    } catch (err) {
      console.log(`     ⚠️  Verification failed: ${err.message}`);
    }
  }

  // Save state
  const fs = require('node:fs');
  const stateFile = 'ratification-state.json';
  let state = {};
  try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
  
  state.phase1_erc8004 = {
    status: 'completed',
    agentId: agentId || null,
    tx_hash: tx.hash,
    registered_at: new Date().toISOString(),
    network: isTestnet ? 'amoy' : 'mainnet',
    block_number: receipt.blockNumber,
    gas_used: receipt.gasUsed.toString(),
  };
  
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  console.log(`\n  💾 State saved to ${stateFile}`);

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  REGISTRATION COMPLETE                                      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  if (agentId) {
    console.log(`  Next steps:`);
    console.log(`  1. Update .well-known/agent.json with registrations array`);
    console.log(`     "registrations": [{"agentRegistry": "eip155:${net.chainId}:${net.identityRegistry}", "agentId": "${agentId}"}]`);
    console.log(`  2. Run verification: node scripts/erc8004-verify.js ${agentId}`);
    console.log(`  3. Submit to marketplaces: node scripts/marketplace-submit.js`);
  }
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  if (err.reason) console.error('   Reason:', err.reason);
  process.exit(1);
});
