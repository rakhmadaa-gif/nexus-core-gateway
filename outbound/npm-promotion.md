# npm SDK Promotion Content

## 1. Twitter/X Post (thread)

```
TypeScript SDK for Nexus Gateway is now on npm! 🚀

npm install nexus-gateway-sdk

What you get:
✅ Free Solidity security audit (7 breach scenarios)
✅ Smart contract generation (ERC-20, ERC-721, Escrow)
✅ Bilingual legal contracts (EN/ID) with Digital Twin mapping
✅ LangChain.js + Vercel AI SDK native tool wrappers
✅ Polygon PoS USDC pull payment integration

Quick example — audit any Solidity contract in 3 lines:

import { NexusClient } from "nexus-gateway-sdk";
const client = new NexusClient({ clientId: "my-agent" });
const result = await client.dryRun({ source_code: "pragma solidity ^0.8.20; contract Token {}" });

→ 7 breach scenarios, risk level, deployable check, ~2ms latency

Python SDK also available: pip install nexus-gateway-sdk (118+ downloads!)

GitHub: https://github.com/rakhmadaa-gif/nexus-core-gateway
npm: https://www.npmjs.com/package/nexus-gateway-sdk
Try the playground: https://rakhmadaa-gif.github.io/nexus-core-gateway/

#TypeScript #Web3 #Solidity #SmartContracts #npm #LangChain #VercelAI
```

---

## 2. Reddit Post (r/typescript or r/node)

**Title:** TypeScript SDK for free Solidity security audits — 7 breach scenarios, no signup needed

**Body:**

```
I built a TypeScript SDK that runs free Solidity smart contract security audits. No signup, no API key needed for the free tier.

**npm install nexus-gateway-sdk**

What it does:
- Static syntax validation
- 7 automated breach simulations (Unauthorized Minting, Transfer Violation, Fund Drain, Emergency Freeze, Ownership Renounce, Reentrancy Attack, Replay Attack)
- Risk assessment (low/medium/high/critical)
- Deployable check (true/false)
- Digital Twin v3.1 matrix — clause-to-code mapping with breach conditions
- Nonce & replay defense check

Example:

```typescript
import { NexusClient } from "nexus-gateway-sdk";

const client = new NexusClient({ clientId: "my-app" });

// Free Solidity security audit
const result = await client.dryRun({
  source_code: "pragma solidity ^0.8.20; contract Token { mapping(address => uint256) public balanceOf; }"
});

console.log(result.breach_simulation.overall_risk); // "medium"
console.log(result.breach_simulation.scenarios);   // 7 scenarios with risk levels
```

Also has LangChain.js and Vercel AI SDK tool wrappers for agent integration:

```typescript
import { createNexusTools } from "nexus-gateway-sdk";

const tools = createNexusTools({ clientId: "my-agent" });
// Returns tool array compatible with LangChain.js / Vercel AI SDK
```

Latency: ~2ms. SLA: <500ms. Runs on Supabase Edge Functions (Deno).

Paid services: structured JSON schemas ($0.20), Solidity contract generation ($1.20), bilingual legal contracts with Digital Twin ($299). Payment via USDC on Polygon PoS.

GitHub: https://github.com/rakhmadaa-gif/nexus-core-gateway
npm: https://www.npmjs.com/package/nexus-gateway-sdk
Interactive playground (no terminal needed): https://rakhmadaa-gif.github.io/nexus-core-gateway/

Python SDK also available: pip install nexus-gateway-sdk (118+ downloads)
```

---

## 3. Dev.to Article (short follow-up to existing article)

**Title:** TypeScript SDK now available — run free Solidity security audits from Node.js

**Body:**

```
Following up on our [previous article](link to existing Dev.to post), the TypeScript SDK for Nexus Gateway is now live on npm.

## Install

```bash
npm install nexus-gateway-sdk
```

## Free Solidity Security Audit — 3 Lines

```typescript
import { NexusClient } from "nexus-gateway-sdk";

const client = new NexusClient({ clientId: "my-app" });
const result = await client.dryRun({
  source_code: "pragma solidity ^0.8.20; contract Token { }"
});

// Result includes:
// - 7 breach scenarios with risk levels
// - Overall risk assessment (low/medium/high/critical)
// - Deployable check
// - Digital Twin v3.1 matrix
// - Nonce & replay defense check
// - Recommendations
```

## LangChain.js + Vercel AI SDK Integration

The SDK ships with native tool wrappers for AI agent frameworks:

```typescript
import { createNexusTools, createNexusVercelTools } from "nexus-gateway-sdk";

// LangChain.js tools
const langchainTools = createNexusTools({ clientId: "my-agent" });

// Vercel AI SDK tools
const vercelTools = createNexusVercelTools({ clientId: "my-agent" });
```

## Try It Without Installing

Visit the interactive playground — paste Solidity code in your browser and get instant results:
https://rakhmadaa-gif.github.io/nexus-core-gateway/

## Links

- npm: https://www.npmjs.com/package/nexus-gateway-sdk
- GitHub: https://github.com/rakhmadaa-gif/nexus-core-gateway
- Python SDK (118+ downloads): pip install nexus-gateway-sdk

Tags: #typescript #npm #solidity #web3 #security #smartcontracts #langchain #vercelai
```
