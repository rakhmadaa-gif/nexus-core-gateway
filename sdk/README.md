# Nexus Gateway SDK

> **Python & TypeScript SDKs** for integrating Nexus Gateway M2M Legal-Code Services into popular agent frameworks.

[![Python](https://img.shields.io/badge/Python-3.8+-blue)](./python/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue)](./typescript/)
[![CrewAI](https://img.shields.io/badge/CrewAI-compatible-orange)](./python/)
[![LangChain](https://img.shields.io/badge/LangChain-compatible-green)](./python/)
[![Vercel AI](https://img.shields.io/badge/Vercel%20AI%20SDK-compatible-black)](./typescript/)

---

## What This SDK Does

The Nexus Gateway SDK lets you integrate **M2M legal-code services** into your AI agent workflows with a single import:

| Service | Cost | What It Does |
|---|---|---|
| `structured_data` | 20 CRED ($0.20) | Verified JSON schemas for Web3/regulatory compliance |
| `code_modules` | 120 CRED ($1.20) | Security-checked Solidity smart contracts |
| `legal_code` | 29,900 CRED ($299.00) | Bilingual (EN/ID) legal contract + Solidity code + Digital Twin matrix |
| `dry_run` | **FREE** | Solidity validation with 7 breach scenarios + nonce defense |
| `manifest` | **FREE** | A2A agent discovery — services, pricing, endpoints |

---

## Quick Start

### Python (CrewAI)

```bash
pip install crewai
# nexus-gateway-sdk uses stdlib only (no pip install needed for core client)
```

```python
from crewai import Agent, Task, Crew
from nexus_gateway import (
    NexusStructuredDataTool,
    NexusCodeModulesTool,
    NexusDryRunTool,
    NexusManifestTool,
)

# Create tools
structured_data = NexusStructuredDataTool(client_id="my-agent")
code_modules = NexusCodeModulesTool(client_id="my-agent")
dry_run = NexusDryRunTool()  # Free — no client_id needed
manifest = NexusManifestTool()

# Create an agent with Nexus tools
auditor = Agent(
    role="Smart Contract Auditor",
    goal="Audit Solidity contracts for security vulnerabilities",
    backstory="Expert in smart contract security and breach simulation",
    tools=[dry_run, manifest],
)

# Run a crew
crew = Crew(agents=[auditor], tasks=[...])
result = crew.kickoff()
```

### Python (LangChain)

```bash
pip install langchain langchain-openai
```

```python
from langchain.agents import AgentExecutor, create_react_agent
from langchain_openai import ChatOpenAI
from nexus_gateway import create_langchain_tools

# Create all Nexus tools at once
tools = create_langchain_tools(client_id="my-agent")

# Use with any LangChain agent
llm = ChatOpenAI(model="gpt-4")
agent = create_react_agent(llm, tools, prompt)
executor = AgentExecutor(agent=agent, tools=tools)

result = executor.invoke({
    "input": "Audit this contract: pragma solidity ^0.8.20; contract Token { function mint(address to, uint256 amt) public { } }"
})
```

### TypeScript (LangChain.js / Vercel AI SDK)

```bash
npm install @langchain/core @langchain/openai
# or: npm install ai  (for Vercel AI SDK)
```

```typescript
import { NexusClient, createNexusTools } from "nexus-gateway-sdk";

// Direct client usage
const client = new NexusClient({ clientId: "my-agent" });
const manifest = await client.getManifest();
const audit = await client.dryRun({
  source_code: "pragma solidity ^0.8.20; contract Token { }",
});
console.log("Deployable:", audit.preview?.deployable);

// LangChain.js tools
const tools = createNexusTools({ clientId: "my-agent" });
// Wrap with DynamicStructuredTool from @langchain/core/tools

// Vercel AI SDK
import { createNexusVercelTools } from "nexus-gateway-sdk/langchain";
const vercelTools = createNexusVercelTools({ clientId: "my-agent" });
// Use with streamText/generateText from "ai"
```

---

## SDK Structure

```
sdk/
├── python/
│   ├── nexus_gateway/
│   │   ├── __init__.py      # Package exports
│   │   ├── client.py        # NexusClient — core HTTP client (stdlib only)
│   │   ├── tools.py         # CrewAI BaseTool wrappers (5 tools)
│   │   └── langchain.py     # LangChain Tool wrappers (create_langchain_tools)
│   ├── examples/
│   │   ├── crewai_example.py     # Full CrewAI crew demo (3 agents, 3 tasks)
│   │   └── langchain_example.py  # LangChain ReAct agent demo
│   └── setup.py             # pip installable
│
├── typescript/
│   ├── src/
│   │   ├── index.ts          # Package exports
│   │   ├── client.ts         # NexusClient — core HTTP client (fetch-based)
│   │   └── langchain.ts      # LangChain.js + Vercel AI SDK tool wrappers
│   ├── examples/
│   │   └── langchain_example.ts  # Full TS demo (direct + LangChain + Vercel)
│   ├── package.json
│   └── tsconfig.json
│
└── README.md                # This file
```

---

## Tool Reference

### Python — CrewAI Tools

| Tool Class | Service | Cost | Auth Required |
|---|---|---|---|
| `NexusStructuredDataTool` | structured_data | 20 CRED | Yes (client_id) |
| `NexusCodeModulesTool` | code_modules | 120 CRED | Yes (client_id) |
| `NexusLegalCodeTool` | legal_code | 29,900 CRED | Yes (client_id) |
| `NexusDryRunTool` | dry-run | FREE | No |
| `NexusManifestTool` | manifest | FREE | No |

### Python — LangChain Tools

Use `create_langchain_tools(client_id="my-agent")` to get a list of 5 `Tool` objects.

### TypeScript — LangChain.js / Vercel AI

Use `createNexusTools({ clientId: "my-agent" })` for LangChain.js-compatible tools.
Use `createNexusVercelTools({ clientId: "my-agent" })` for Vercel AI SDK format.

---

## Free Trial

- **structured_data**: 20 CRED free (1x only, 24hr expiry)
- **code_modules**: 100 CRED discount (1x only, 24hr expiry)
- **dry_run**: Always free, unlimited
- **manifest**: Always free, unlimited
- **samples**: Always free, unlimited
- **metrics**: Always free, unlimited

---

## Payment

Top up credits using USDC on Polygon PoS:

1. Sign an EIP-712 permit for USDC transfer
2. Call `pull_payment` service with the signed permit
3. Gateway.sol pulls USDC and credits CRED (1 USDC = 100 CRED)

```python
client.pull_payment(
    client_address="0x...",
    amount_usdc=10,  # 10 USDC → 1000 CRED
    deadline=1200,
    v=27, r="0x...", s="0x..."
)
```

---

## Links

- **Gateway API:** `https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world`
- **Landing Page:** `https://rakhmadaa-gif.github.io/nexus-core-gateway/`
- **GitHub:** `https://github.com/rakhmadaa-gif/nexus-core-gateway`
- **OpenAPI Spec:** [`openapi.yaml`](../openapi.yaml)
- **Postman Collection:** [`nexus-gateway.postman_collection.json`](../nexus-gateway.postman_collection.json)
- **Main README:** [`../README.md`](../README.md)

---

## License

MIT
