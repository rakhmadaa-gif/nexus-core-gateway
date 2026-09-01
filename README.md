# Nexus Gateway — M2M Legal-Code Services for Web3

> **Autonomous legal-code engine** that generates verified structured data, audited Solidity smart contracts, and bilingual (English-Indonesian) legal contracts — mapped directly to code functions via Digital Twin v3.1 technology.

[![Deployed](https://img.shields.io/badge/status-DEPLOYED-brightgreen)](https://supabase.com/dashboard/project/xibzsthfrbomefnvbicb/functions)
[![Version](https://img.shields.io/badge/version-v4.0.0--frontier-blue)](#)
[![Network](https://img.shields.io/badge/network-Polygon%20PoS-8247E5)](https://polygonscan.com/address/0xDEEc5BE05F0911b4aCD7FB6C8a4aa603C13F60e4)
[![Latency](https://img.shields.io/badge/latency-~3ms-orange)](#)
[![License](https://img.shields.io/badge/license-MIT-green)](#)

---

## What is Nexus Gateway?

Nexus Gateway is a **Machine-to-Machine (M2M) API** that serves other AI agents, smart contracts, and automated systems. It combines three disciplines into one endpoint:

1. **Legal Contract Generation** — Bilingual (EN/ID) legal contracts with clause-by-clause structure
2. **Smart Contract Auditing** — Solidity code generation with deep parsing and breach simulation
3. **Digital Twin Mapping** — Every legal clause is mapped to specific code functions with breach conditions

### Why use Nexus?

| Problem | Nexus Solution |
|---|---|
| Legal contracts and smart contracts are created separately, often misaligned | Digital Twin v3.1 maps every legal clause to exact code lines (bipolar mapping) |
| Smart contract security audits are expensive and slow | Free instant dry-run with 7 breach scenarios + nonce/replay defense |
| Cross-border (ID/EN) legal agreements are hard to standardize | Built-in bilingual EN/ID legal contract generation |
| Payment rails for API services are complex | USDC pull-payment on Polygon (EIP-712 Permit → auto-credit) |

---

## Quick Start

### 1. Discover (Free — No Auth)

```bash
# Get the manifest — see what services are available
curl https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world/manifest.json

# View sample manifests (3 tiers: $300/$500/$800 showcases)
curl https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world/samples

# Check live telemetry
curl https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world/metrics
```

### 2. Try Dry-Run (Free — No Auth)

```bash
# Test any Solidity contract for free — 7 breach scenarios + nonce defense
curl -X POST https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world/gateway/dry-run \
  -H "Content-Type: application/json" \
  -d '{
    "source_code": "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\ncontract Token { function mint(address to, uint256 amt) public { } }"
  }'
```

### 3. Call a Service (Paid — Requires x-client-id)

```bash
# Generate structured data (20 CRED = $0.20)
curl -X POST https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world \
  -H "Content-Type: application/json" \
  -H "x-client-id: my-agent-001" \
  -d '{
    "service_type": "structured_data",
    "params": {
      "schema_type": "erc20_metadata",
      "name": "MyToken",
      "symbol": "MTK",
      "decimals": 18
    }
  }'
```

### 4. Top-Up Credits (USDC on Polygon)

```bash
# Pull payment — sign EIP-712 permit, gateway pulls USDC, credits CRED
curl -X POST https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world \
  -H "Content-Type: application/json" \
  -H "x-client-id: my-agent-001" \
  -d '{
    "service_type": "pull_payment",
    "params": {
      "client_address": "0x...",
      "amount_usdc": 10,
      "deadline": 1200,
      "v": 27, "r": "0x...", "s": "0x..."
    }
  }'
```

---

## Services & Pricing

| Service | Type | Cost | Description |
|---|---|---|---|
| `structured_data` | JSON | 20 CRED ($0.20) | Verified JSON schemas for Web3, regulatory compliance |
| `code_modules` | Solidity | 120 CRED ($1.20) | Security-checked smart contract code (ERC-20, ERC-721, Escrow) |
| `legal_code` | Hybrid | 29,900 CRED ($299.00) | Bilingual EN/ID legal contract + Solidity code + Digital Twin matrix |
| `pull_payment` | Top-Up | FREE | USDC pull payment → auto-credit CRED (adds credits, no charge) |
| `error` | System | FREE | Standard error response |

**Free trial:** `structured_data` gets 20 CRED free (1x, 24hr expiry). `code_modules` gets 100 CRED discount (1x, 24hr expiry).

**1 CRED = $0.01 USD** — 100 CRED = 1 USDC

---

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/manifest.json` | None | A2A agent discovery — services, pricing, capabilities |
| `GET` | `/samples` | None | 3-tier sample manifests with full artifacts |
| `GET` | `/samples/tier1\|tier2\|tier3` | None | Individual tier ($300/$500/$800 showcase) |
| `GET` | `/metrics` | None | Live telemetry — uptime, latency, concurrency, throughput |
| `POST` | `/gateway/dry-run` | None | Free Solidity validation + breach simulation + nonce defense |
| `POST` | `/` | `x-client-id` | Main service endpoint (all paid services) |

---

## Digital Twin v3.1 — How It Works

```
Legal Contract (EN/ID)          Smart Contract (Solidity)
─────────────────────          ─────────────────────────
Clause C1: "Parties"     ←→   constructor() line 25
Clause C2: "Token Spec"  ←→   ERC20(name, symbol) line 25
Clause C3: "Minting"     ←→   _mint(msg.sender) line 26
Clause C4: "Governing"   ←→   N/A (off-chain legal only)
```

Each mapping includes:
- `code_line_range` — exact start/end lines in the Solidity source
- `function_signature` — full function signature with parameters
- `visibility` — public/private/external/internal
- `modifiers` — access control modifiers applied
- `breach_conditions` — what would constitute a breach of this clause

### Breach Simulation (7 Scenarios)

| ID | Scenario | What It Checks |
|---|---|---|
| BS-001 | Unauthorized Minting | Can attacker mint without authorization? |
| BS-002 | Transfer Violation | Can transfers bypass balance/allowance checks? |
| BS-003 | Fund Drain | Can anyone withdraw without authorization? |
| BS-004 | Emergency Freeze | Does contract have pause/emergency stop? |
| BS-005 | Ownership Renounce | Can ownership be renounced, locking admin? |
| BS-006 | Reentrancy Attack | Are external calls protected? |
| BS-007 | Replay Attack | Does contract have nonce-based replay protection? |

**Deployable = false** when overall risk is `critical` or replay attack is detected.

---

## Architecture

```
Client Agent ──POST──→ Supabase Edge Function (Deno/TypeScript)
                          │
                          ├── Gatekeeper (x-client-id, credit check, trial)
                          ├── Concurrency Guard (soft=3, hard=5)
                          ├── Core Engine (structured_data / code_modules / legal_code)
                          ├── Dry-Run Engine (parser + twin matrix + breach sim)
                          ├── Pull Payment Module (EIP-712 → Gateway.sol → CRED)
                          ├── M2M Output Standardizer (envelope for all responses)
                          ├── Pipeline Optimization (parallel DB writes, stage timing)
                          └── Service Logging (audit trail in Supabase)
                          │
                          ├── Supabase DB (client_usage, service_logs, pull_payment_*)
                          └── Polygon PoS (Gateway.sol, USDC)
```

**Monolith:** 3,241 lines in a single `index.ts` — all modules in one file for zero cold-start overhead.

---

## Blockchain

| Item | Address | Network |
|---|---|---|
| Gateway.sol (Pull Payment) | `0xDEEc5BE05F0911b4aCD7FB6C8a4aa603C13F60e4` | Polygon PoS |
| USDC (native) | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | Polygon PoS |
| Treasury / Owner | `0x80963791ce7cb9c5d580fe638c39fdd9ffdae2d5` | Polygon PoS |

---

## Tech Stack

- **Runtime:** Supabase Edge Functions (Deno / TypeScript)
- **Database:** Supabase (PostgreSQL + RLS)
- **Blockchain:** Polygon PoS (EIP-712 Permit, ERC-20 TransferFrom)
- **Payment:** USDC native (6 decimals) via pull-payment architecture
- **Security:** 7 breach scenarios, nonce anti-replay, 2-block confirmation, max gas enforcement

---

## Links

- **Live API:** `https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world`
- **GitHub:** `https://github.com/rakhmadaa-gif/nexus-core-gateway`
- **PolygonScan:** `https://polygonscan.com/address/0xDEEc5BE05F0911b4aCD7FB6C8a4aa603C13F60e4`
- **API Docs (Pull Payment):** [`nexus-pull-payment-api-v3.md`](./nexus-pull-payment-api-v3.md)
- **OpenAPI Spec:** [`openapi.yaml`](./openapi.yaml)
- **Postman Collection:** [`nexus-gateway.postman_collection.json`](./nexus-gateway.postman_collection.json)

---

## License

MIT — see [LICENSE](./LICENSE)

---

## Status

**Phase 3 FINAL — v4.0.0-frontier — LOCKED**

| Phase | Status | Tasks |
|---|---|---|
| Phase 1: Agent Discoverability | ✅ 100% | 5/5 |
| Phase 2: System Architecture | ✅ 100% | 3/3 |
| Phase 3: Digital Twin Engine | ✅ 100% | 3/3 |

E2E Test: 17/17 PASS
