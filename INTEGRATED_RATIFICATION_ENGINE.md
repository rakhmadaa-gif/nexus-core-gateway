# INTEGRATED RATIFICATION ENGINE

> Autonomous identity registration + marketplace submission system for Nexus Gateway (Aegis)
>
> **Status**: DRAFT — Ready for execution
> **Date**: September 2026
> **Node ID**: `nexus.legal.contractdrafter`
> **Gateway**: v4.0.0-frontier (LOCKED)

---

## TABLE OF CONTENTS

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Phase 1: ERC-8004 On-Chain Identity Registration](#3-phase-1-erc-8004-on-chain-identity-registration)
4. [Phase 2: Agent Marketplace Submissions](#4-phase-2-agent-marketplace-submissions)
5. [Phase 3: Autonolas/Olas Assessment](#5-phase-3-autonolasolas-assessment)
6. [Pre-Submit Self-Validation Checklist](#6-pre-submit-self-validation-checklist)
7. [Fallback & Retry Logic](#7-fallback--retry-logic)
8. [Execution Scripts](#8-execution-scripts)
9. [Post-Registration Maintenance](#9-post-registration-maintenance)

---

## 1. EXECUTIVE SUMMARY

### The Problem

Nexus Gateway has **0 external paying clients** despite fully operational infrastructure:
- 5 services live (structured_data, code_modules, legal_code, dry_run, pull_payment)
- 7 breach scenarios in automated security audit
- Digital Twin v3.1 with bipolar mapping
- EIP-712 pull payment on Polygon PoS (tested, verified)
- SDK published on PyPI (118+ downloads) and npm
- Landing page with interactive playground

The gap is **discovery and trust** — agents and machines cannot find or verify Aegis because it lacks on-chain identity and marketplace presence.

### The Solution

This document defines a 3-phase ratification pipeline:

| Phase | Target | Type | Effort | Impact |
|-------|--------|------|--------|--------|
| 1 | ERC-8004 Registries | On-chain identity (Polygon) | Medium | Agents can discover + verify Aegis on-chain |
| 2 | x402 Marketplaces | Off-chain directories | Low | Agent directories list Aegis services |
| 3 | Autonolas/Olas | NFT-based agent registry | High (assess) | Cross-chain agent marketplace |

### Key Parameters

- **Wallet**: Treasury `0x80963791ce7cb9c5d580fe638c39fdd9ffdae2d5` (needs MATIC for gas)
- **Chain**: Polygon PoS mainnet (chainId: 137)
- **Gateway contract**: `0xDEEc5BE05F0911b4aCD7FB6C8a4aa603C13F60e4`
- **Private key**: `$POLYGON_PRIVATE_KEY` (Edge Function secret)
- **RPC**: `polygon-bor-rpc.publicnode.com` (free, no API key)

---

## 2. ARCHITECTURE OVERVIEW

```
                     ┌──────────────────────────────────┐
                     │   INTEGRATED RATIFICATION ENGINE  │
                     └──────────────────────────────────┘
                                   │
          ┌────────────────────────┼────────────────────────┐
          │                        │                        │
          ▼                        ▼                        ▼
  ┌───────────────┐      ┌──────────────────┐      ┌──────────────────┐
  │  PHASE 1      │      │  PHASE 2         │      │  PHASE 3         │
  │  ERC-8004     │      │  Marketplaces    │      │  Autonolas       │
  │  On-Chain ID  │      │  Off-Chain Dir   │      │  (Assessment)    │
  └───────┬───────┘      └────────┬─────────┘      └──────────────────┘
          │                       │
          ▼                       ▼
  ┌───────────────┐      ┌──────────────────┐
  │ IdentityRegistry│    │ Agora402         │
  │ register()      │    │ x402-list         │
  │ ReputationRegistry│  │ x402 Hub          │
  │ (future)        │    │ The Grid (skip)   │
  └───────────────┘      └──────────────────┘
          │
          ▼
  ┌───────────────┐
  │ SELF-VALIDATION │
  │ (Pre-Submit)    │
  └───────────────┘
          │
          ▼
  ┌───────────────┐
  │ FALLBACK/RETRY │
  └───────────────┘
```

### Data Flow

1. **Self-Validate** — Run pre-submit checklist (manifest, agent.json, openapi.yaml, gateway health)
2. **Register On-Chain** — Mint ERC-8004 identity NFT on Polygon
3. **Submit to Marketplaces** — Push to x402 directories via API
4. **Verify** — Confirm registration on Polygonscan + marketplace listings
5. **Fallback** — Retry failed submissions with exponential backoff

---

## 3. PHASE 1: ERC-8004 ON-CHAIN IDENTITY REGISTRATION

### 3.1 What is ERC-8004?

ERC-8004 ("Trustless Agents") is a Standards Track ERC proposal (August 2025) defining three on-chain registries for autonomous agent identity and trust:

| Registry | Purpose | Polygon Mainnet | Polygon Amoy (testnet) |
|----------|---------|-----------------|----------------------|
| **IdentityRegistry** | ERC-721 NFT, mints `agentId`, `tokenURI` -> JSON registration file | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| **ReputationRegistry** | Feedback scores (0-100), tags, off-chain proof URIs | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| **ValidationRegistry** | Validator request/response log (TEE, zkML) | *(mainnet pending)* | `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` |

**Key properties:**
- CREATE2-deterministic addresses (byte-identical across all mainnets)
- Identity = ERC-721 NFT (ownership = ownership of agent entry)
- `tokenURI` points to JSON registration file (IPFS or HTTPS)
- Payment-agnostic (x402 proofs can be referenced in reputation data)
- Complements A2A, MCP — does not replace them
- Standard created August 13, 2025; currently under public review
- Coordinated by Marco De Rossi (MetaMask), Davide Crapis (EF), Jordan Ellis (Google), Erik Reppel (Coinbase)

### 3.2 Registration Plan

#### Step 1: Prepare Agent Registration File

The `agentURI` must point to a JSON file conforming to the ERC-8004 registration file shape. We use our existing `.well-known/agent.json` (already on GitHub) as the `agentURI`:

```
agentURI = https://raw.githubusercontent.com/rakhmadaa-gif/nexus-core-gateway/main/.well-known/agent.json
```

This file already contains:
- `node_id`, `node_name`, `description`
- `capabilities` (5 services with pricing)
- `protocol_compatibility` (A2A, OpenAI Plugin, MCP, x402)
- `blockchain` info (Gateway contract, USDC, treasury)
- `sdk` references (PyPI, npm)

**ERC-8004 recommended registration file shape** (our agent.json maps to this):

| ERC-8004 Field | Our agent.json Field |
|----------------|---------------------|
| `type` (schema identifier) | `schema_version: "1.0"` |
| `name` | `node_name` |
| `description` | `description` |
| `services` (endpoint list) | `capabilities` + `base_url` |
| `registrations` ({agentRegistry, agentId}) | Added after registration |
| `supportedTrust` | `["reputation"]` (add after Phase 1) |

#### Step 2: Mint Identity on Polygon Mainnet

Call `IdentityRegistry.register(string agentURI, MetadataEntry[] metadata)`:

```solidity
// Contract function signature (from ABI):
function register(
    string agentURI,
    MetadataEntry[] calldata metadata
) external returns (uint256 agentId);

struct MetadataEntry {
    string metadataKey;
    bytes metadataValue;
}
```

**Metadata entries to include:**

| Key | Value (UTF-8 bytes) | Purpose |
|-----|---------------------|---------|
| `category` | `legal-code` | Service category for discovery |
| `version` | `4.0.0-frontier` | Gateway version |
| `gateway` | `0xDEEc5BE05F0911b4aCD7FB6C8a4aa603C13F60e4` | On-chain payment contract |
| `sla` | `99.9` | Service level agreement |

**Expected event from transaction logs:**
```
Registered(uint256 agentId, string agentURI, address owner)
```
- `agentId` = the NFT tokenId — **save this, needed for all subsequent operations**

#### Step 3: Set Agent Wallet (Optional)

After registration, the `agentWallet` is initially set to the owner's address. To update it to our treasury:

```solidity
function setAgentWallet(
    uint256 agentId,
    address newWallet,
    uint256 deadline,
    bytes signature  // EIP-712 signature from newWallet
) external
```

This requires an EIP-712 signature from the new wallet proving control. For now, the default (owner address) is sufficient.

#### Step 4: Verify on Polygonscan

After the transaction is confirmed:
1. Open the transaction on [polygonscan.com](https://polygonscan.com)
2. Check **Logs** tab for `Registered` event
3. Copy the `agentId` (uint256 value)
4. Call `tokenURI(agentId)` — should return our agent.json URL
5. Call `ownerOf(agentId)` — should return treasury address
6. Call `getMetadata(agentId, "category")` — should return `legal-code`

#### Step 5: Update agent.json with agentId

After registration, add the `registrations` field to `.well-known/agent.json`:

```json
"registrations": [
  {
    "agentRegistry": "eip155:137:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    "agentId": "<MINTED_AGENT_ID>"
  }
]
```

### 3.3 Testnet First (Amoy)

Before mainnet, test on Polygon Amoy testnet:
- Get free testnet MATIC from a Polygon Amoy faucet
- Use testnet contract addresses (see table in 3.1)
- Verify full flow: register -> check logs -> verify tokenURI -> verify metadata
- Testnet MATIC has no real value, so no cost risk

### 3.4 Cost Estimate

| Item | Value |
|------|-------|
| Gas estimate for `register()` with metadata | ~150,000-250,000 gas |
| Typical Polygon gas price | 30-80 gwei |
| Estimated cost | 0.005-0.02 MATIC (~$0.01-$0.04 USD) |
| Minimum wallet balance recommended | 0.05 MATIC (buffer for retries) |

### 3.5 IdentityRegistry ABI (Key Functions)

```json
[
  {
    "inputs": [
      {"internalType": "string", "name": "agentURI", "type": "string"},
      {
        "components": [
          {"internalType": "string", "name": "metadataKey", "type": "string"},
          {"internalType": "bytes", "name": "metadataValue", "type": "bytes"}
        ],
        "internalType": "struct IdentityRegistryUpgradeable.MetadataEntry[]",
        "name": "metadata",
        "type": "tuple[]"
      }
    ],
    "name": "register",
    "outputs": [{"internalType": "uint256", "name": "agentId", "type": "uint256"}],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "uint256", "name": "agentId", "type": "uint256"}],
    "name": "tokenURI",
    "outputs": [{"internalType": "string", "name": "", "type": "string"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "uint256", "name": "agentId", "type": "uint256"}],
    "name": "ownerOf",
    "outputs": [{"internalType": "address", "name": "", "type": "address"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {"internalType": "uint256", "name": "agentId", "type": "uint256"},
      {"internalType": "string", "name": "metadataKey", "type": "string"}
    ],
    "name": "getMetadata",
    "outputs": [{"internalType": "bytes", "name": "", "type": "bytes"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "uint256", "name": "agentId", "type": "uint256"}],
    "name": "getAgentWallet",
    "outputs": [{"internalType": "address", "name": "", "type": "address"}],
    "stateMutability": "view",
    "type": "function"
  }
]
```

**Event signature for log parsing:**
```
Registered(uint256 agentId, string agentURI, address owner)
```

---

## 4. PHASE 2: AGENT MARKETPLACE SUBMISSIONS

### 4.1 Agora402 (agora402.io)

**What**: Open x402 agent registry on Base/Solana/Polygon. AgentCard-compatible cards.

**Discovery**: `GET /api/v1/discover?category=...`

**Registration approach:**
- Host `/.well-known/agent-card.json` on GitHub Pages (A2A AgentCard format)
- Submit to Agora402 for indexing
- Agent card includes: `name`, `description`, `capabilities`, `endpoints`

**Agent Card JSON** (to create at `.well-known/agent-card.json`):
```json
{
  "name": "Nexus.Legal.ContractDrafter",
  "description": "M2M Autonomous Legal, Smart Contract & Web3 Schema Verification Gateway",
  "version": "4.0.0-frontier",
  "capabilities": [
    {"name": "structured_data", "description": "Verified JSON schemas for Web3/regulatory compliance"},
    {"name": "code_modules", "description": "Security-checked Solidity smart contracts"},
    {"name": "legal_code", "description": "Bilingual EN/ID legal contracts mapped to Solidity"},
    {"name": "dry_run", "description": "Free Solidity security audit — 7 breach scenarios"},
    {"name": "pull_payment", "description": "USDC top-up via EIP-712 pull payment on Polygon"}
  ],
  "endpoints": {
    "a2a": "https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world/manifest.json",
    "mcp": "https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world",
    "landing": "https://rakhmadaa-gif.github.io/nexus-core-gateway/"
  },
  "blockchain": {
    "network": "polygon-pos",
    "gateway_contract": "0xDEEc5BE05F0911b4aCD7FB6C8a4aa603C13F60e4",
    "usdc": "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"
  },
  "pricing": {
    "model": "credit-based",
    "rate": "1 CREDIT = $0.01 USD",
    "payment_rail": "USDC on Polygon PoS"
  }
}
```

**Status**: Check if Agora402 has a public submit API or auto-crawls `.well-known/agent-card.json`.

### 4.2 x402-list.com

**What**: Agent-first canonical x402 directory with uptime/verification probes.

**Registration API**: `POST /api/v1/submit`

**Payload:**
```json
{
  "name": "Nexus.Legal.ContractDrafter",
  "description": "M2M Autonomous Legal-Code Gateway — structured data, Solidity audits, bilingual legal contracts",
  "endpoints": [
    "https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world/manifest.json"
  ],
  "categories": ["legal", "solidity", "compliance", "web3"],
  "pricing_model": "credit-based (1 CREDIT = $0.01, USDC on Polygon)",
  "source": "submitted",
  "documentation": "https://github.com/rakhmadaa-gif/nexus-core-gateway",
  "sdk": {
    "pypi": "nexus-gateway-sdk",
    "npm": "nexus-gateway-sdk"
  }
}
```

**Owner update flow**: `/services/{slug}/update` — update listing after initial submission.

**Verification**: x402-list runs uptime/verification probes on submitted services. Our gateway must respond to `GET /manifest.json` with valid JSON.

### 4.3 x402 Hub (api.x402hub.ai)

**What**: ERC-721 agent NFTs on Base L2. Trust Ladder: UNVERIFIED -> PROVISIONAL -> ESTABLISHED.

**Registration API**: `POST /api/agents/register` (gasless — no gas needed)

**Payload:**
```json
{
  "name": "Nexus.Legal.ContractDrafter",
  "capabilities": ["structured_data", "code_modules", "legal_code", "dry_run", "pull_payment"],
  "endpoints": [
    "https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world"
  ]
}
```

**Expected response:**
```json
{
  "agentId": "...",
  "claimCode": "...",
  "claimURL": "..."
}
```

**Notes:**
- Gasless registration (no MATIC/ETH needed)
- Marketplace with USDC escrow ($20 min stake for higher trust tier)
- Trust Ladder progression requires stake + usage history

### 4.4 The Grid (thegrid.ai) — SKIP

**What**: AI inference spot market (GPU compute marketplace).

**Assessment**: LOW PRIORITY. The Grid is an inference marketplace for AI model execution, not a legal/code agent registry. Aegis is a service provider, not an inference consumer. Registering Aegis here doesn't fit the use case. Skip.

---

## 5. PHASE 3: AUTONOLAS/OLAS ASSESSMENT

### 5.1 Overview

Autonolas (Olas) is an on-chain agent registry that mints agents as ERC-721 NFTs on Ethereum mainnet. Agents are composed of components -> agent blueprint -> AI agent (dependency order).

### 5.2 Why It's Complex

- **CLI-based** — requires `autonomy` CLI tool installation, not a simple API call
- Components must be published to a remote registry first (packages.json)
- NFT minting happens on **Ethereum mainnet only** (expensive gas, $50-100+)
- Agent instances can be registered on Polygon via `--use-polygon` flag
- Requires OLAS token for optional bonds
- Testing requires Docker image `valory/autonolas-registries` with local Hardhat node

### 5.3 Assessment: DEFER

**Recommendation**: Defer Autonolas registration to a later phase.

| Factor | Detail |
|--------|--------|
| Setup complexity | High (CLI, component packaging, remote registry) |
| Gas cost | $50-100+ on Ethereum mainnet for NFT minting |
| Fit | Aegis is a service provider, not an autonomous Olas agent |
| Alternative | ERC-8004 already provides on-chain identity (Phase 1) — lighter, Polygon-native |

**Revisit when**: Aegis has external clients and the ETH gas cost is justified by revenue.

---

## 6. PRE-SUBMIT SELF-VALIDATION CHECKLIST

Before executing any registration, the engine runs automated checks to verify Aegis is production-ready.

### 6.1 Endpoint Health Checks

| # | Check | Endpoint | Expected | Status |
|---|-------|----------|----------|--------|
| 1 | Manifest accessible | `GET /manifest.json` | HTTP 200, JSON with 5 services | ☐ |
| 2 | Samples accessible | `GET /samples` | HTTP 200, JSON with 3 tiers | ☐ |
| 3 | Metrics accessible | `GET /metrics` | HTTP 200, JSON with uptime/latency | ☐ |
| 4 | Dry-run functional | `POST /gateway/dry-run` | HTTP 200, JSON with 7 breach scenarios | ☐ |
| 5 | Landing page live | `GET github.io/nexus-core-gateway/` | HTTP 200, HTML with playground | ☐ |
| 6 | agent.json accessible | `GET raw.githubusercontent.com/.../agent.json` | HTTP 200, valid JSON | ☐ |
| 7 | openapi.yaml accessible | `GET raw.githubusercontent.com/.../openapi.yaml` | HTTP 200, valid YAML | ☐ |
| 8 | SDK PyPI live | `GET pypi.org/project/nexus-gateway-sdk/` | HTTP 200 | ☐ |
| 9 | SDK npm live | `GET npmjs.com/package/nexus-gateway-sdk` | HTTP 200 | ☐ |
| 10 | Gateway contract on-chain | `eth_getCode` at `0xDEEc5BE...` | Non-empty code | ☐ |

### 6.2 Schema Validation

| # | Check | File | Expected | Status |
|---|-------|------|----------|--------|
| 11 | agent.json schema | `.well-known/agent.json` | Has: node_id, capabilities, base_url, blockchain | ☐ |
| 12 | openapi.yaml x-extensions | `openapi.yaml` | Has: x-node-id, x-protocol-compatibility | ☐ |
| 13 | ai-plugin.json schema | `.well-known/ai-plugin.json` | Has: schema_version, auth | ☐ |
| 14 | security.txt | `.well-known/security.txt` | Has: Contact, Expires | ☐ |
| 15 | robots.txt | `robots.txt` | Has: Allow, Sitemap | ☐ |

### 6.3 Blockchain Verification

| # | Check | Method | Expected | Status |
|---|-------|--------|----------|--------|
| 16 | Treasury wallet has MATIC | `eth_getBalance` | > 0.01 MATIC | ☐ |
| 17 | USDC contract exists | `eth_getCode` | Non-empty code | ☐ |

### 6.4 "Verified Production-Ready" Badge

All 17 checks must pass before the engine proceeds to registration. Output:

```json
{
  "badge": "Verified Production-Ready",
  "timestamp": "2026-09-05T...",
  "checks_total": 17,
  "checks_passed": 17,
  "checks_failed": 0,
  "failures": [],
  "ready_to_submit": true
}
```

If any check fails:
```json
{
  "badge": "NOT READY",
  "ready_to_submit": false,
  "failures": ["check_4: dry-run endpoint returned 500"]
}
```

---

## 7. FALLBACK & RETRY LOGIC

### 7.1 Retry Strategy

All registration and submission operations use exponential backoff with jitter:

```
Attempt 1: immediate
Attempt 2: wait 2s + random(0, 1s)
Attempt 3: wait 4s + random(0, 2s)
Attempt 4: wait 8s + random(0, 4s)
Attempt 5: wait 16s + random(0, 8s) — FINAL
```

Max 5 attempts per operation. If all fail, log error and continue to next target.

### 7.2 Fallback Scenarios

| Scenario | Trigger | Fallback Action |
|----------|---------|-----------------|
| Polygon RPC down | `eth_call` timeout (10s) | Switch RPC: `polygon-bor-rpc.publicnode.com` -> `polygon-rpc.com` -> `rpc-mainnet.matic.network` |
| Gas price spike | `eth_gasPrice` > 500 gwei | Wait 60s, recheck. Cap at 500 gwei (Gateway.sol MAX_GAS_PRICE) |
| Transaction reverted | `eth_sendRawTransaction` reverts | Check revert reason, log, retry with higher gas limit |
| Marketplace API down | HTTP 5xx or timeout | Retry with backoff. If 5 attempts fail, schedule retry in 1 hour |
| Marketplace API 4xx | HTTP 4xx (bad request) | Log payload + response, do NOT retry (schema issue) |
| agent.json fetch fails | GitHub raw URL non-200 | Fallback to jsdelivr CDN: `https://cdn.jsdelivr.net/gh/rakhmadaa-gif/nexus-core-gateway@main/.well-known/agent.json` |
| Identity already registered | `register()` reverts | Skip registration, query existing `agentId` from Registered events |

### 7.3 RPC Failover Chain

```
Primary:   https://polygon-bor-rpc.publicnode.com
Secondary: https://polygon-rpc.com
Tertiary:  https://rpc-mainnet.matic.network
Quaternary: https://polygonscan.com/rpc (public)
```

### 7.4 State Persistence

The engine saves state to `ratification-state.json` so it can resume if interrupted:

```json
{
  "started_at": "2026-09-05T...",
  "self_validation": {
    "badge": "Verified Production-Ready",
    "checks_passed": 17,
    "checks_failed": 0
  },
  "phase1_erc8004": {
    "status": "completed|pending|failed",
    "agentId": 42,
    "tx_hash": "0x...",
    "registered_at": "2026-09-05T...",
    "attempts": 1
  },
  "phase2_marketplaces": {
    "agora402": {"status": "pending", "attempts": 0, "last_error": null},
    "x402_list": {"status": "pending", "attempts": 0, "last_error": null},
    "x402_hub": {"status": "pending", "attempts": 0, "last_error": null}
  }
}
```

---

## 8. EXECUTION SCRIPTS

Scripts are located in `scripts/` directory. Each script is standalone and executable with Node.js.

### 8.1 Self-Validation Script

**File**: `scripts/self-validate.js`
**Purpose**: Run all 17 pre-submit checks before any registration.
**Usage**: `node scripts/self-validate.js`
**Output**: Console report + `ratification-state.json` file

### 8.2 ERC-8004 Registration Script

**File**: `scripts/erc8004-register.js`
**Purpose**: Mint agent identity NFT on ERC-8004 IdentityRegistry (Polygon mainnet).
**Prerequisites**: 
- `npm install ethers` (ethers.js v6)
- `$POLYGON_PRIVATE_KEY` environment variable
- Treasury wallet has >= 0.05 MATIC
**Usage**: `node scripts/erc8004-register.js`
**Output**: Transaction hash + agentId

### 8.3 ERC-8004 Verify Script

**File**: `scripts/erc8004-verify.js`
**Purpose**: Verify ERC-8004 registration by reading on-chain data.
**Usage**: `node scripts/erc8004-verify.js <agentId>`
**Output**: agentId, owner, tokenURI, metadata, agentWallet

### 8.4 Marketplace Submission Script

**File**: `scripts/marketplace-submit.js`
**Purpose**: Submit Aegis to x402 agent directories (x402-list, x402 Hub, Agora402).
**Usage**: `node scripts/marketplace-submit.js`
**Output**: Submission status per marketplace

### 8.5 Full Pipeline Orchestrator

**File**: `scripts/ratify.js`
**Purpose**: Run the complete ratification pipeline in order:
1. Self-validate (must pass all checks)
2. ERC-8004 register on Polygon
3. Verify ERC-8004 registration
4. Submit to marketplaces
5. Save final state report

**Usage**: `node scripts/ratify.js`
**Output**: Complete ratification report

---

## 9. POST-REGISTRATION MAINTENANCE

### 9.1 Update Discovery Files

After ERC-8004 registration, update these files with the new `agentId`:

| File | Update |
|------|--------|
| `.well-known/agent.json` | Add `registrations` array with `{agentRegistry, agentId}` |
| `.well-known/ai-plugin.json` | Add `erc8004_agent_id` field |
| `openapi.yaml` | Add `x-erc8004-agent-id` extension |
| GitHub Pages `index.html` | Add "ERC-8004 Verified" badge to landing page |
| `README.md` | Add ERC-8004 registration section |

### 9.2 Monitoring

Set up periodic checks (cron) to verify:
- ERC-8004 identity still exists (ownerOf doesn't revert)
- tokenURI still resolves to valid JSON
- Marketplace listings still active
- Gateway endpoints still responding

### 9.3 Reputation Building

After registration, build reputation on ERC-8004:
- Encourage early clients to submit `giveFeedback()` on ReputationRegistry
- Track feedback scores and aggregate via `getSummary()`
- Publish off-chain feedback files with payment proofs (x402 transaction hashes)

### 9.4 Future: Validation Registry

When ERC-8004 ValidationRegistry deploys on Polygon mainnet (currently testnet-only):
- Submit validation requests for Aegis security audit results
- Use the 7 breach scenarios as validation evidence
- Link off-chain audit reports via `requestURI`/`responseURI`

---

## APPENDIX A: CONTRACT ADDRESSES QUICK REFERENCE

| Contract | Address | Chain |
|----------|---------|-------|
| ERC-8004 IdentityRegistry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | Polygon Mainnet |
| ERC-8004 ReputationRegistry | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | Polygon Mainnet |
| ERC-8004 IdentityRegistry (testnet) | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | Polygon Amoy |
| ERC-8004 ReputationRegistry (testnet) | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | Polygon Amoy |
| ERC-8004 ValidationRegistry (testnet) | `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` | Polygon Amoy |
| Nexus Gateway (PullPayment) | `0xDEEc5BE05F0911b4aCD7FB6C8a4aa603C13F60e4` | Polygon Mainnet |
| USDC (native) | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | Polygon Mainnet |
| Treasury/Owner | `0x80963791ce7cb9c5d580fe638c39fdd9ffdae2d5` | Polygon Mainnet |

## APPENDIX B: EVENT SIGNATURES

```
IdentityRegistry:
  Registered(uint256 agentId, string agentURI, address owner)
  MetadataSet(uint256 agentId, string indexedMetadataKey, string metadataKey, bytes metadataValue)
  URIUpdated(uint256 agentId, string newURI, address updatedBy)
  Transfer(address from, address to, uint256 tokenId)

ReputationRegistry:
  NewFeedback(uint256 agentId, address clientAddress, uint64 feedbackIndex, int128 value, uint8 valueDecimals, string indexedTag1, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)
  FeedbackRevoked(uint256 agentId, address clientAddress, uint64 feedbackIndex)
  ResponseAppended(uint256 agentId, address clientAddress, uint64 feedbackIndex, address responder, string responseURI, bytes32 responseHash)

ValidationRegistry:
  ValidationRequest(address validator, uint256 agentId, string requestURI, bytes32 requestHash)
  ValidationResponse(address validator, uint256 agentId, bytes32 requestHash, uint8 response, string responseURI, bytes32 responseHash, string tag)
```

## APPENDIX C: REFERENCES

- [ERC-8004 Specification](https://eips.ethereum.org/EIPS/eip-8004)
- [ERC-8004 Contracts Repo](https://github.com/erc-8004/erc-8004-contracts)
- [ERC-8004 on Polygon Docs](https://docs.polygon.technology/payment-services/agentic-payments/agent-integration/erc8004)
- [Polygon Agentic Payments CLI](https://docs.polygon.technology/payment-services/agentic-payments/cli/agent-identity)
- [ERC-8004 QuickNode Docs](https://erc-8004.quicknode.com/docs/contracts)
- [Agora402](https://agora402.io)
- [x402-list.com](https://x402-list.com)
- [x402 Hub](https://api.x402hub.ai)
- [Autonolas/Olas](https://github.com/valory-xyz/autonolas-registries)

---

*Generated by Nexus.Legal.ContractDrafter — Autonomous Execution Node*
