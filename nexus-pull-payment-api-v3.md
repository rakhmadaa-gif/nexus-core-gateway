# Nexus Gateway API — Pull Payment v3.0
### M2M Legal-Code Service Gateway for Web3 & Regulatory Compliance

**Version**: 3.0.0-frontier  
**Base URL**: `https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world`  
**Network**: Polygon PoS (Chain ID 137)  
**Gateway Contract**: `0xDEEc5BE05F0911b4aCD7FB6C8a4aa603C13F60e4`  
**USDC Token**: `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` (native, 6 decimals)  
**RPC**: `https://polygon-bor-rpc.publicnode.com`

---

## Table of Contents

1. [Overview](#1-overview)
2. [Authentication](#2-authentication)
3. [Services & Pricing](#3-services--pricing)
4. [Pull Payment Flow](#4-pull-payment-flow)
5. [EIP-712 Permit Signing Guide](#5-eip-712-permit-signing-guide)
6. [API Reference](#6-api-reference)
7. [Error Codes](#7-error-codes)
8. [Code Examples](#8-code-examples)

---

## 1. Overview

Nexus Gateway is an M2M (Machine-to-Machine) service gateway that provides:

| Service | Description | Cost |
|---|---|---|
| `structured_data` | Verified JSON schemas for ERC-20, ERC-721, regulatory compliance | 20 CRED ($0.20) |
| `code_modules` | Audited Solidity smart contract source code | 120 CRED ($1.20) |
| `legal_code` | Hybrid bilingual (EN-ID) legal contracts mapped to code | 29,900 CRED ($299.00) |
| `pull_payment` | Top-up credits via EIP-712 USDC permit | FREE (adds credits) |
| `error` | Fallback error payload | FREE |

**1 CRED = $0.01 USD**  
**1 USDC = 100 CRED** (rate: $1 = 100 CRED)

### How It Works

```
Client Agent                          Nexus Gateway
    │                                      │
    │  1. Sign EIP-712 permit              │
    │     (authorize Gateway.sol           │
    │      to pull USDC)                   │
    │                                      │
    │  2. POST /pull_payment ──────────►  │
    │     {permit signature}               │
    │                                      │
    │                              3. Gateway.sol.pullPayment()
    │                              4. USDC: Client → Treasury
    │                              5. Wait 2-block confirmation
    │                              6. Credits added to balance
    │                                      │
    │  ◄────────── 7. Return verified ──────│
    │     {credits_minted: 10}             │
    │                                      │
    │  8. POST /structured_data ────────►  │
    │     (uses balance credits)           │
    │                                      │
    │  ◄────────── 9. Return payload ──────│
    │     {schema, audit_trail}            │
```

---

## 2. Authentication

All requests require the `x-client-id` header:

```
x-client-id: your-stable-machine-identifier
```

- Use a stable, unique identifier for your agent/machine
- Example: `my-agent-prod-001`, `trading-bot-v2`, `compliance-checker`
- Missing header → `400 MISSING_CLIENT_ID`
- No JWT required (M2M mode, `verify_jwt` disabled)

---

## 3. Services & Pricing

### Surge Pricing

| Tier | Requests/min | Multiplier |
|---|---|---|
| 1 (normal) | ≤ 10 | 1.0× (base rate) |
| 2 (busy) | 11-50 | 1.5× |
| 3 (peak) | > 50 | 2.5× |

### Free Trials

| Trial | Service | Credits | Limit | Expiry |
|---|---|---|---|---|
| Structured Data Free | `structured_data` | 20 CRED free | 1× only | 24 hours |
| Code Modules Discount | `code_modules` | 100 CRED off (pay 20 CRED for $1.20 service) | 1× only | 24 hours |

New clients start with `balance_credits: 0`. Use `pull_payment` to top up.

---

## 4. Pull Payment Flow

### Architecture

```
                    EIP-712 Permit Signature
                    ┌─────────────────────┐
                    │ owner: client_address│
                    │ spender: Gateway.sol  │
                    │ value: amount_usdc   │
                    │ nonce: token_nonce   │
                    │ deadline: unix_ts    │
                    └─────────────────────┘
                              │
    Client Agent ──────────────┤
         │                    │
         │   POST /pull_payment with permit {v, r, s}
         │   ─────────────────────────────────────────► Edge Function
         │                                              │
         │                                    ┌─────────┴─────────┐
         │                                    │ 1. Validate       │
         │                                    │ 2. Check deadline  │
         │                                    │ 3. Check gas price │
         │                                    │ 4. Read USDC nonce │
         │                                    │ 5. Insert DB auth  │
         │                                    │ 6. Call Gateway.sol│
         │                                    │ 7. Wait for TX     │
         │                                    │ 8. Record event   │
         │                                    │ 9. Poll 2 blocks   │
         │                                    │ 10. Confirm credit │
         │                                    └─────────┬─────────┘
         │                                              │
         │   ◄───────── 200 {status: "verified"} ───────┘
         │                  {credits_minted: N}
```

### Security Parameters (6 Rules)

| # | Rule | Enforcement |
|---|---|---|
| 1 | Gateway.sol IS the spender | On-chain (contract logic) |
| 2 | Deadline buffer 15-30 min | Edge Function + on-chain |
| 3 | Virtual credit rollback | DB-only refund (no on-chain USDC return) |
| 4 | Nonce anti-replay | DB UNIQUE INDEX + on-chain |
| 5 | 2-block confirmation | Edge Function polling |
| 6 | Max gas price 500 gwei | Edge Function + on-chain |

---

## 5. EIP-712 Permit Signing Guide

### Domain

```json
{
  "name": "USD Coin",
  "version": "2",
  "chainId": 137,
  "verifyingContract": "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"
}
```

### Types

```json
{
  "Permit": [
    {"name": "owner", "type": "address"},
    {"name": "spender", "type": "address"},
    {"name": "value", "type": "uint256"},
    {"name": "nonce", "type": "uint256"},
    {"name": "deadline", "type": "uint256"}
  ]
}
```

### Message

```json
{
  "owner": "0xYOUR_WALLET_ADDRESS",
  "spender": "0xDEEc5BE05F0911b4aCD7FB6C8a4aa603C13F60e4",
  "value": "100000",
  "nonce": 0,
  "deadline": 1788126579
}
```

### Steps

1. **Get your USDC nonce**: Call `nonces(your_address)` on USDC contract
2. **Set deadline**: `deadline = current_time + 1200` (20 minutes)
3. **Sign EIP-712 typed data** with your wallet's private key
4. **Extract v, r, s** from signature
5. **Compute client_id_hash**: `keccak256(utf8bytes(your_client_id))` — must be `0x`-prefixed

### Important

- `spender` MUST be the Gateway contract address (not Treasury wallet)
- `value` is in USDC's 6 decimals (0.1 USDC = 100000)
- `nonce` must match the current USDC contract nonce for your address
- `deadline` must be 15-30 minutes from now (900-1800 seconds buffer)
- `client_id_hash` must be `0x`-prefixed hex string (32 bytes)

---

## 6. API Reference

### POST / — Service Request

All services are called via POST to the base URL.

#### Headers

```
Content-Type: application/json
x-client-id: your-client-id
```

#### Pull Payment Request

```json
{
  "service_type": "pull_payment",
  "params": {
    "client_address": "0x504477e24aB49beD06DD1E4ABE2C1685FC357395",
    "amount_usdc": "100000",
    "deadline": 1788126579,
    "v": 28,
    "r": "0x35721bd7530c81e36a817ec0c653b27ee99db853fe78b61a9a755caf6dbc5a80",
    "s": "0x2e27e3f88887e3fc172e8e7387a49636052e6d3c0f86e784fb28a8310d3a5862",
    "client_id_hash": "0x54b9491e68257f4cb8f1e942269d1621fa9b0968d71a28733e001842855982bd"
  }
}
```

#### Pull Payment Response (Success)

```json
{
  "payload_id": "db7c0943-7b41-4d44-b1c9-f07d5ef273ec",
  "timestamp": "2026-08-30T21:29:49Z",
  "service": "pull_payment",
  "status": "verified",
  "checksum": "c680531d...",
  "payload": {
    "auth_id": "1710ef16-d6db-4a2d-b4f1-914cc2510af5",
    "tx_hash": "0x032b7622aed45b04eb5800a88e5b019a0d1a6ecd918b30c3d5b3112081bdaf35",
    "block_number": 92946904,
    "amount_usdc": 0.1,
    "credits_minted": 10,
    "client_id": "nexus-e2e-test-client",
    "message": "Pull payment successful. Credits added to virtual balance."
  },
  "audit_trail": [
    {"step": "validation", "status": "passed", "timestamp": "..."},
    {"step": "deadline_check", "status": "passed", "detail": "Buffer: 1200s"},
    {"step": "amount_check", "status": "passed", "detail": "100000 units = 10 CRED"},
    {"step": "gas_check", "status": "passed", "detail": "Gas: 258 gwei"},
    {"step": "nonce_check", "status": "passed", "detail": "Permit nonce: 0"},
    {"step": "db_insert", "status": "passed", "detail": "Auth ID: 1710ef16..."},
    {"step": "blockchain_submit", "status": "passed", "detail": "TX: 0x032b7622..."},
    {"step": "blockchain_confirm", "status": "passed", "detail": "Block: 92946904"},
    {"step": "db_event", "status": "passed", "detail": "Event ID: 94c60cb5..."},
    {"step": "2_block_confirmation", "status": "passed", "detail": "Confirmed at block 92946908"},
    {"step": "credit_added", "status": "passed", "detail": "10 CRED added to balance"}
  ]
}
```

#### Pull Payment Response (Pending — 202)

If 2-block confirmation polling times out:

```json
{
  "status": "pending",
  "payload": {
    "auth_id": "...",
    "tx_hash": "0x...",
    "block_number": 92946904,
    "credits_expected": 10,
    "message": "Pull payment submitted. 2-block confirmation pending."
  }
}
```

#### Structured Data Request

```json
{
  "service_type": "structured_data",
  "params": {
    "type": "ERC20",
    "name": "MyToken",
    "symbol": "MTK",
    "decimals": 18,
    "total_supply": 1000000
  }
}
```

#### Code Modules Request

```json
{
  "service_type": "code_modules",
  "params": {
    "type": "ERC20",
    "name": "MyToken",
    "symbol": "MTK",
    "decimals": 18,
    "initial_supply": 1000000
  }
}
```

#### Legal-Code Pro Request

```json
{
  "service_type": "legal_code",
  "params": {
    "contract_type": "escrow",
    "parties": ["Buyer Corp", "Seller Inc"],
    "jurisdiction": "ID",
    "amount": "50000",
    "currency": "USDC",
    "deadline": "2026-12-31"
  }
}
```

### GET /manifest.json — A2A Discovery

Returns the node manifest for agent-to-agent discovery:

```bash
curl https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world/manifest.json
```

---

## 7. Error Codes

| Code | HTTP | Description |
|---|---|---|
| `MISSING_CLIENT_ID` | 400 | `x-client-id` header not provided |
| `INVALID_PERMIT` | 400 | Missing permit parameters (client_address, amount, deadline, v/r/s, client_id_hash) |
| `DEADLINE_TOO_SOON` | 400 | Deadline buffer < 15 minutes (900s) |
| `DEADLINE_TOO_FAR` | 400 | Deadline buffer > 30 minutes (1800s) |
| `INVALID_AMOUNT` | 400 | amount_usdc is 0 or negative |
| `GAS_PRICE_TOO_HIGH` | 400 | Current Polygon gas > 500 gwei. Retry when network calms down |
| `BLOCKCHAIN_ERROR` | 400 | Gateway.sol.pullPayment() failed on-chain |
| `WALLET_ERROR` | 500 | POLYGON_PRIVATE_KEY not configured on server |
| `DB_ERROR` | 500 | Failed to record authorization in database |
| `INSUFFICIENT_CREDITS` | 402 | Balance too low for requested service. Top-up via pull_payment |
| `TRIAL_INSUFFICIENT_BALANCE` | 402 | Code modules trial active but balance < 20 CRED |
| `TRIAL_EXPIRED` | 402 | Free trial has expired (24h). Top-up to continue |
| `INVALID_TYPE` | 400 | Unknown service type or contract type |

---

## 8. Code Examples

### Python — Full Pull Payment + Service Call

```python
import json
import time
import requests
from web3 import Web3
from eth_account import Account

# Config
EDGE_URL = "https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world"
GATEWAY = "0xDEEc5BE05F0911b4aCD7FB6C8a4aa603C13F60e4"
USDC = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"
CLIENT_ID = "my-agent-001"
RPC = "https://polygon-bor-rpc.publicnode.com"

# 1. Sign EIP-712 permit
w3 = Web3(Web3.HTTPProvider(RPC))
wallet = Account.from_key("YOUR_PRIVATE_KEY")  # Client wallet with USDC

# Read current USDC nonce
usdc = w3.eth.contract(address=USDC, abi=[
    "function nonces(address) view returns (uint256)"
])
nonce = usdc.functions.nonces(wallet.address).call()

# Set deadline (20 min from now)
deadline = int(time.time()) + 1200

# Sign permit
typed_data = {
    "types": {
        "EIP712Domain": [
            {"name": "name", "type": "string"},
            {"name": "version", "type": "string"},
            {"name": "chainId", "type": "uint256"},
            {"name": "verifyingContract", "type": "address"},
        ],
        "Permit": [
            {"name": "owner", "type": "address"},
            {"name": "spender", "type": "address"},
            {"name": "value", "type": "uint256"},
            {"name": "nonce", "type": "uint256"},
            {"name": "deadline", "type": "uint256"},
        ],
    },
    "primaryType": "Permit",
    "domain": {
        "name": "USD Coin",
        "version": "2",
        "chainId": 137,
        "verifyingContract": USDC,
    },
    "message": {
        "owner": wallet.address,
        "spender": GATEWAY,
        "value": 100000,  # 0.1 USDC
        "nonce": nonce,
        "deadline": deadline,
    },
}

signed = Account.sign_typed_data(
    private_key=wallet.key,
    full_message=typed_data,
)

client_id_hash = w3.keccak(text=CLIENT_ID).hex()

# 2. Send pull_payment to Edge Function
resp = requests.post(EDGE_URL, json={
    "service_type": "pull_payment",
    "params": {
        "client_address": wallet.address,
        "amount_usdc": "100000",
        "deadline": deadline,
        "v": signed.v,
        "r": hex(signed.r),
        "s": hex(signed.s),
        "client_id_hash": "0x" + client_id_hash,
    }
}, headers={"x-client-id": CLIENT_ID})

result = resp.json()
print(f"Status: {result['status']}")
if result["status"] == "verified":
    print(f"Credits: {result['payload']['credits_minted']}")

# 3. Use credits for structured_data
resp = requests.post(EDGE_URL, json={
    "service_type": "structured_data",
    "params": {"type": "ERC20", "name": "MyToken", "symbol": "MTK"}
}, headers={"x-client-id": CLIENT_ID})

print(f"Service: {resp.json()['status']}")
```

### TypeScript/Node.js — EIP-712 Signing

```typescript
import { ethers } from "ethers";

const RPC = "https://polygon-bor-rpc.publicnode.com";
const USDC = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const GATEWAY = "0xDEEc5BE05F0911b4aCD7FB6C8a4aa603C13F60e4";

const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet("YOUR_PRIVATE_KEY", provider);

// Read USDC nonce
const usdc = new ethers.Contract(USDC, [
  "function nonces(address) view returns (uint256)"
], provider);
const nonce = await usdc.nonces(wallet.address);

// Set deadline
const deadline = Math.floor(Date.now() / 1000) + 1200;

// Sign EIP-712 permit
const domain = {
  name: "USD Coin",
  version: "2",
  chainId: 137,
  verifyingContract: USDC,
};

const types = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

const value = {
  owner: wallet.address,
  spender: GATEWAY,
  value: 100000,  // 0.1 USDC
  nonce: nonce,
  deadline: deadline,
};

const sig = await wallet.signTypedData(domain, types, value);
const { v, r, s } = ethers.Signature.from(sig);

// Compute client_id_hash
const clientId = "my-agent-001";
const clientIdHash = ethers.id(clientId); // keccak256

// Send to Edge Function
const resp = await fetch("https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-client-id": clientId,
  },
  body: JSON.stringify({
    service_type: "pull_payment",
    params: {
      client_address: wallet.address,
      amount_usdc: "100000",
      deadline: deadline,
      v: v,
      r: r,
      s: s,
      client_id_hash: clientIdHash,
    },
  }),
});

const result = await resp.json();
console.log("Status:", result.status);
if (result.status === "verified") {
  console.log("Credits:", result.payload.credits_minted);
}
```

### cURL — Quick Test

```bash
# Check manifest (no auth needed)
curl https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world/manifest.json

# Free trial structured_data (new client only)
curl -X POST https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world \
  -H "Content-Type: application/json" \
  -H "x-client-id: my-test-agent" \
  -d '{"service_type":"structured_data","params":{"type":"ERC20","name":"Test","symbol":"TST"}}'
```

---

## Appendix

### Contract Addresses

| Contract | Address | Network |
|---|---|---|
| Gateway.sol (NexusPullPaymentGateway) | `0xDEEc5BE05F0911b4aCD7FB6C8a4aa603C13F60e4` | Polygon PoS |
| USDC (native, Circle) | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | Polygon PoS |
| Treasury/Owner | `0x80963791ce7cb9c5d580fe638c39fdd9ffdae2d5` | Polygon PoS |

### DB Tables

| Table | Purpose |
|---|---|
| `client_usage` | Client quota/balance tracking |
| `service_logs` | Per-request audit log |
| `pull_payment_authorizations` | EIP-712 permit records |
| `pull_payment_events` | On-chain pull events + confirmation status |
| `virtual_credit_ledger` | Credit/debit ledger with rollback support |
| `refund_queue` | Failed API call refunds (DB-only, no on-chain USDC return) |

### Rate Limits

- Surge pricing applies automatically based on requests/minute per client
- No hard rate limit — cost scales with demand
- Gas price cap at 500 gwei protects against network congestion

---

*Generated: 2026-08-30  
*Gateway Version: 3.0.0-frontier  
*Status: LIVE on Polygon Mainnet + Supabase Edge Functions*
