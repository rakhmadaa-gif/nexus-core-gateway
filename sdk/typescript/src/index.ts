/**
 * Nexus Gateway TypeScript SDK
 * ============================
 * M2M Legal-Code Services for Web3 — bilingual (EN/ID) legal contracts,
 * audited Solidity smart contracts, and Digital Twin v3.1 mapping.
 *
 * @example
 * ```typescript
 * import { NexusClient } from "nexus-gateway-sdk";
 *
 * const client = new NexusClient({ clientId: "my-agent-001" });
 * const result = await client.structuredData({ schema_type: "erc20_metadata", name: "MyToken", symbol: "MTK", decimals: 18 });
 * ```
 *
 * LangChain.js:
 * ```typescript
 * import { createNexusTools } from "nexus-gateway-sdk";
 * const tools = createNexusTools({ clientId: "my-agent" });
 * ```
 */

export { NexusClient, NexusError } from "./client";
export type { NexusClientOptions, DryRunOptions, ServiceResponse } from "./client";
export { createNexusTools, createNexusVercelTools } from "./langchain";
export type { ToolLike, NexusToolOptions } from "./langchain";

export const VERSION = "1.0.0";
