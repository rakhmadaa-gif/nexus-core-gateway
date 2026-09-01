# Nexus Gateway TypeScript SDK

> Native tool wrappers for **LangChain.js** and **Vercel AI SDK** — generate bilingual legal contracts, audited Solidity smart contracts, and Digital Twin v3.1 mapping.

## Install

```bash
npm install nexus-gateway-sdk

# Optional peer dependencies:
npm install @langchain/core   # for LangChain.js tools
npm install ai                 # for Vercel AI SDK tools
```

## Quick Start

### Direct Client

```typescript
import { NexusClient } from "nexus-gateway-sdk";

const client = new NexusClient({ clientId: "my-agent" });

// Free endpoints
const manifest = await client.getManifest();
const audit = await client.dryRun({
  sourceCode: "pragma solidity ^0.8.20; contract Token { }",
});

// Paid services (free trial available)
const result = await client.structuredData({
  schemaType: "erc20_metadata",
  name: "MyToken",
  symbol: "MTK",
  decimals: 18,
});
```

### LangChain.js

```typescript
import { createNexusTools } from "nexus-gateway-sdk/langchain";

const tools = createNexusTools({ clientId: "my-agent" });
// 5 tools: nexus_structured_data, nexus_code_modules, nexus_legal_code, nexus_dry_run, nexus_manifest
// Wrap with DynamicStructuredTool from @langchain/core/tools
```

### Vercel AI SDK

```typescript
import { createNexusVercelTools } from "nexus-gateway-sdk/langchain";
import { generateText } from "ai";

const tools = createNexusVercelTools({ clientId: "my-agent" });
const result = await generateText({
  model: openai("gpt-4"),
  tools,
  prompt: "Audit this contract: pragma solidity ^0.8.20; contract Token { }",
});
```

## Available Tools

| Tool | Service | Cost | Auth |
|---|---|---|---|
| `nexus_structured_data` | structured_data | 20 CRED ($0.20) | Yes |
| `nexus_code_modules` | code_modules | 120 CRED ($1.20) | Yes |
| `nexus_legal_code` | legal_code | 29,900 CRED ($299.00) | Yes |
| `nexus_dry_run` | dry-run | FREE | No |
| `nexus_manifest` | manifest | FREE | No |

## License

MIT
