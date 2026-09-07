# npm SDK Promotion Content — v2 (Updated 2026-09-07)

> Context: PyPI 498 downloads, npm 136 downloads (not 0 as previously tracked).
> Self-validation: 17/17 checks PASS (verified production-ready).
> ERC-8004 Agent #636 registered on Polygon Mainnet.

---

## 1. Twitter/X Thread

```
1/ We just shipped a TypeScript SDK for autonomous Solidity security auditing.

npm install nexus-gateway-sdk

No API key. No signup. Paste Solidity → get 7 breach scenarios in ~2ms.

🧵 Thread ↓

2/ What it audits (7 automated breach simulations):

BS-001 Unauthorized Minting
BS-002 Transfer Violation
BS-003 Fund Drain via Withdrawal
BS-004 Emergency Freeze
BS-005 Ownership Renounce Risk
BS-006 Reentrancy Attack
BS-007 Replay Attack (Nonce Defense)

Each scenario: risk_level (low→critical), affected functions, mitigation.

3/ 3 lines to run a full audit:

import { NexusClient } from "nexus-gateway-sdk";
const client = new NexusClient({ clientId: "my-agent" });
const result = await client.dryRun({ source_code: contractSource });

Output: overall_risk, deployable (bool), 7 scenarios, Digital Twin v3.1 matrix, recommendations.

4/ The SDK ships with native tool wrappers for agent frameworks:

LangChain.js → createNexusTools({ clientId })
Vercel AI SDK → createNexusVercelTools({ clientId })

Drop into your agent's tool array. It speaks M2M.

5/ Production-verified: 17/17 self-validation checks PASS.

✅ Gateway endpoints live
✅ ERC-8004 on-chain identity (Agent #636, Polygon Mainnet)
✅ EIP-712 USDC pull payment deployed
✅ PyPI + npm packages live
✅ OpenAPI 3.0.3 spec with x-extensions
✅ A2A discovery manifest (.well-known/agent.json)

6/ Also on PyPI (498 downloads):
pip install nexus-gateway-sdk

Interactive playground (no terminal needed):
https://rakhmadaa-gif.github.io/nexus-core-gateway/

GitHub: https://github.com/rakhmadaa-gif/nexus-core-gateway
npm: https://www.npmjs.com/package/nexus-gateway-sdk

#Solidity #TypeScript #Web3 #SmartContracts #SecurityAudit #LangChain
```

---

## 2. Reddit Post — r/solidity

**Title:** [TypeScript SDK] Run 7-breach-scenario Solidity security audits from Node.js — free, no signup, ~2ms latency

**Body:**

```
I've been building an autonomous security auditing gateway for Solidity contracts. The TypeScript SDK is now on npm. It runs 7 automated breach simulations against any Solidity source code — no signup, no API key for the free tier.

## Install

```bash
npm install nexus-gateway-sdk
```

## What it does

The dry-run endpoint performs static analysis and runs 7 breach scenarios:

| ID | Scenario | What it checks |
|----|----------|---------------|
| BS-001 | Unauthorized Minting | Can an attacker mint tokens without authorization? |
| BS-002 | Transfer Violation | Can transfers bypass balance/allowance checks? |
| BS-003 | Fund Drain | Can anyone withdraw funds without authorization? |
| BS-004 | Emergency Freeze | Does the contract have an emergency stop mechanism? |
| BS-005 | Ownership Renounce | Can ownership be renounced, locking admin functions? |
| BS-006 | Reentrancy Attack | Are external calls protected against reentrancy? |
| BS-007 | Replay Attack | Does the contract implement nonce-based replay protection? |

Each scenario returns: risk_level (low/medium/high/critical), affected functions, detected (bool), and mitigation recommendation.

## Usage

```typescript
import { NexusClient } from "nexus-gateway-sdk";

const client = new NexusClient({ clientId: "my-app" });

const result = await client.dryRun({
  source_code: "pragma solidity ^0.8.20; contract Vault { mapping(address => uint256) public balances; function withdraw() external { payable(msg.sender).send(balances[msg.sender]); balances[msg.sender] = 0; } }"
});

console.log(result.breach_simulation.overall_risk);  // "high"
console.log(result.deployable);                       // false
console.log(result.breach_simulation.scenarios);       // 7 scenarios
```

## Agent Framework Integration

The SDK includes native tool wrappers:

```typescript
import { createNexusTools } from "nexus-gateway-sdk";

// LangChain.js
const tools = createNexusTools({ clientId: "my-agent" });

// Vercel AI SDK
import { createNexusVercelTools } from "nexus-gateway-sdk";
const vercelTools = createNexusVercelTools({ clientId: "my-agent" });
```

## Production Status

- 17/17 self-validation checks PASS (endpoints, blockchain, packages, specs)
- ERC-8004 on-chain identity registered: Agent #636 on Polygon Mainnet
- EIP-712 USDC pull payment architecture deployed (Gateway.sol)
- Latency: ~2ms per audit. SLA: <500ms.
- Runs on Supabase Edge Functions (Deno)

## Try Without Installing

Interactive playground — paste Solidity in your browser:
https://rakhmadaa-gif.github.io/nexus-core-gateway/

Or via curl:

```bash
curl -X POST https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world/gateway/dry-run \
  -H 'Content-Type: application/json' \
  -d '{"source_code": "pragma solidity ^0.8.20; contract Token {}"}'
```

## Links

- npm: https://www.npmjs.com/package/nexus-gateway-sdk
- GitHub: https://github.com/rakhmadaa-gif/nexus-core-gateway
- Python SDK (498 downloads): `pip install nexus-gateway-sdk`

I'm using this as part of an autonomous M2M legal-code gateway for Web3 compliance. The free tier (dry-run audit) is intentionally open — no auth, no rate limit for reasonable use. Feedback welcome.
```

---

## 3. Dev.to Article

**Title:** TypeScript SDK for autonomous Solidity security auditing — 7 breach scenarios, LangChain.js + Vercel AI SDK integration

**Body:**

```markdown
![ERC-8004 Agent #636](https://img.shields.io/badge/ERC--8004-Agent%20%23636-blue)

I've been working on an autonomous security auditing gateway for Solidity smart contracts. The TypeScript SDK just went live on npm — it runs 7 automated breach simulations against any Solidity source code in ~2ms, with no signup or API key required for the free tier.

## What problem does this solve?

Most Solidity security tools are either:
- **Paid SaaS** (Slither Pro, MythX) — requires account, subscription, API key
- **CLI-only** (Slither, Mythril) — requires local installation, Python/Foundry setup
- **Manual** — human auditors, weeks of lead time

This SDK gives you a **programmatic, agent-native** audit that runs 7 breach scenarios via a single function call. No local toolchain. No signup. No API key for the free tier.

## Install

```bash
npm install nexus-gateway-sdk
```

## The 7 Breach Scenarios

| ID | Scenario | Question |
|----|----------|----------|
| BS-001 | Unauthorized Minting | Can tokens be minted without authorization? |
| BS-002 | Transfer Violation | Can transfers bypass balance/allowance checks? |
| BS-003 | Fund Drain | Can funds be withdrawn without authorization? |
| BS-004 | Emergency Freeze | Is there an emergency stop / pause mechanism? |
| BS-005 | Ownership Renounce | Can ownership renunciation lock admin functions? |
| BS-006 | Reentrancy Attack | Are external calls protected against reentrancy? |
| BS-007 | Replay Attack | Is nonce-based replay protection implemented? |

Each scenario returns a structured result: `risk_level`, `affected_functions`, `detected`, `mitigation`.

## Usage — 3 lines

```typescript
import { NexusClient } from "nexus-gateway-sdk";

const client = new NexusClient({ clientId: "my-app" });

const result = await client.dryRun({
  source_code: contractSource
});

// result.breach_simulation.overall_risk → "high" | "medium" | "low" | "critical"
// result.deployable → true | false
// result.breach_simulation.scenarios → array of 7 scenario objects
// result.digital_twin_v3_matrix → clause-to-code mapping
// result.urgency_signal → time-decay warning for M2M orchestrators
```

## Agent Framework Integration

The SDK ships with native tool wrappers for AI agent frameworks:

```typescript
// LangChain.js
import { createNexusTools } from "nexus-gateway-sdk";
const tools = createNexusTools({ clientId: "my-agent" });
// → Returns Tool[] compatible with LangChain.js agent executor

// Vercel AI SDK
import { createNexusVercelTools } from "nexus-gateway-sdk";
const tools = createNexusVercelTools({ clientId: "my-agent" });
// → Returns tools compatible with Vercel AI SDK generateText
```

This means any LangChain.js or Vercel AI agent can autonomously audit Solidity contracts as part of its toolset — no custom integration needed.

## Digital Twin v3.1 Matrix

Beyond the 7 breach scenarios, the audit produces a **Digital Twin matrix** — a clause-to-code mapping that links contract functions to their breach conditions:

```typescript
// Each function in the contract gets mapped:
{
  function_signature: "withdraw()",
  visibility: "external",
  modifiers: [],
  breach_conditions: ["BS-006: reentrancy via external call before state update"]
}
```

This is designed for M2M orchestration — agents can programmatically assess which functions are safe to call and which require additional guards.

## Production Verification

The gateway passed **17/17 self-validation checks**:

- ✅ All 7 gateway endpoints live
- ✅ ERC-8004 on-chain identity (Agent #636, Polygon Mainnet)
- ✅ EIP-712 USDC pull payment contract deployed
- ✅ npm + PyPI packages live
- ✅ OpenAPI 3.0.3 spec with M2M x-extensions
- ✅ A2A discovery manifest (.well-known/agent.json)
- ✅ Treasury wallet funded
- ✅ USDC contract verified

## Try It Now — No Install

**Interactive playground:** https://rakhmadaa-gif.github.io/nexus-core-gateway/

Paste any Solidity code → click "Run Security Audit" → instant results with 7 breach scenarios, risk badges, and recommendations.

Or via curl:

```bash
curl -X POST https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world/gateway/dry-run \
  -H 'Content-Type: application/json' \
  -d '{"source_code": "pragma solidity ^0.8.20; contract Token { }"}'
```

## SDK Stats

- **npm:** `nexus-gateway-sdk@1.0.0` — 136 downloads
- **PyPI:** `nexus-gateway-sdk@1.0.0` — 498 downloads
- **License:** MIT
- **Latency:** ~2ms per audit
- **SLA:** <500ms

## Links

- [npm package](https://www.npmjs.com/package/nexus-gateway-sdk)
- [GitHub](https://github.com/rakhmadaa-gif/nexus-core-gateway)
- [Interactive Playground](https://rakhmadaa-gif.github.io/nexus-core-gateway/)
- [Python SDK](https://pypi.org/project/nexus-gateway-sdk/) (498 downloads)

---

*This is part of the Nexus Gateway — an autonomous M2M legal-code gateway for Web3 compliance. ERC-8004 Agent #636 on Polygon Mainnet. The free tier (dry-run audit) is intentionally open for community use.*
```

---

## Publishing Instructions

### Twitter/X
1. Post thread manually (copy each numbered block as a separate tweet)
2. Or use a thread scheduler

### Reddit — r/solidity
1. Go to https://www.reddit.com/r/solidity/submit
2. Title: `[TypeScript SDK] Run 7-breach-scenario Solidity security audits from Node.js — free, no signup, ~2ms latency`
3. Paste body
4. Flair: Resource / Tool

### Dev.to
1. Go to https://dev.to/enter
2. Title: `TypeScript SDK for autonomous Solidity security auditing — 7 breach scenarios, LangChain.js + Vercel AI SDK integration`
3. Paste markdown body
4. Tags: `typescript`, `solidity`, `web3`, `security`, `smartcontracts`
5. Published: true

### Dev.to API (automated)
```bash
curl -X POST https://dev.to/api/articles \
  -H "api-key: $DEVTO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "article": {
      "title": "TypeScript SDK for autonomous Solidity security auditing — 7 breach scenarios, LangChain.js + Vercel AI SDK integration",
      "published": true,
      "body_markdown": "<paste article body>",
      "tags": ["typescript", "solidity", "web3", "security", "smartcontracts"]
    }
  }'
```
