/**
 * Nexus Gateway TypeScript SDK — LangChain.js Tools
 * ===================================================
 * LangChain.js DynamicStructuredTool wrappers for Nexus Gateway services.
 *
 * @example
 * ```typescript
 * import { createNexusTools } from "nexus-gateway-sdk/langchain";
 * import { AgentExecutor } from "langchain/agents";
 *
 * const tools = createNexusTools({ clientId: "my-agent-001" });
 * // Use with any LangChain.js agent
 * ```
 */

import { NexusClient, NexusError, type NexusClientOptions } from "./client";

// Minimal type so we don't hard-depend on @langchain/core
export interface ToolLike {
  name: string;
  description: string;
  schema?: any;
  _call(input: string): Promise<string>;
}

export interface NexusToolOptions extends NexusClientOptions {
  /** Only create specific tools. Default: all. */
  only?: Array<"structured_data" | "code_modules" | "legal_code" | "dry_run" | "manifest">;
}

/**
 * Create LangChain.js-compatible tool wrappers for Nexus Gateway.
 *
 * Returns plain tool objects that can be wrapped with DynamicStructuredTool
 * from @langchain/core/tools, or used directly.
 *
 * @example
 * ```typescript
 * import { DynamicStructuredTool } from "@langchain/core/tools";
 * import { createNexusTools } from "nexus-gateway-sdk/langchain";
 *
 * const rawTools = createNexusTools({ clientId: "my-agent" });
 * const tools = rawTools.map(t => new DynamicStructuredTool({
 *   name: t.name,
 *   description: t.description,
 *   schema: t.schema,
 *   func: async (input) => t._call(JSON.stringify(input)),
 * }));
 * ```
 */
export function createNexusTools(options: NexusToolOptions = {}): ToolLike[] {
  const client = new NexusClient(options);
  const filter = options.only;
  const tools: ToolLike[] = [];

  const shouldInclude = (name: string) => !filter || filter.includes(name as any);

  if (shouldInclude("structured_data")) {
    tools.push({
      name: "nexus_structured_data",
      description:
        "Generate verified structured JSON data for Web3/regulatory compliance. Costs 20 CRED ($0.20). " +
        'Input: JSON like {"schema_type":"erc20_metadata","name":"MyToken","symbol":"MTK","decimals":18}',
      schema: undefined,
      async _call(input: string): Promise<string> {
        try {
          const params = JSON.parse(input);
          const result = await client.structuredData(params);
          return JSON.stringify(result, null, 2);
        } catch (e) {
          return `Error: ${(e as Error).message}`;
        }
      },
    });
  }

  if (shouldInclude("code_modules")) {
    tools.push({
      name: "nexus_code_modules",
      description:
        "Generate security-checked Solidity smart contract code (ERC-20, ERC-721, Escrow). Costs 120 CRED ($1.20). " +
        'Input: JSON like {"contract_type":"erc20","name":"MyToken","symbol":"MTK","decimals":18}',
      schema: undefined,
      async _call(input: string): Promise<string> {
        try {
          const params = JSON.parse(input);
          const result = await client.codeModules(params);
          return JSON.stringify(result, null, 2);
        } catch (e) {
          return `Error: ${(e as Error).message}`;
        }
      },
    });
  }

  if (shouldInclude("legal_code")) {
    tools.push({
      name: "nexus_legal_code",
      description:
        "Generate bilingual (EN/ID) legal contract + Solidity code + Digital Twin v3.1 mapping. Costs 29,900 CRED ($299.00). " +
        'Input: JSON like {"contract_type":"token_sale","jurisdiction":"ID","token":{"name":"MyToken","symbol":"MTK"}}',
      schema: undefined,
      async _call(input: string): Promise<string> {
        try {
          const params = JSON.parse(input);
          const result = await client.legalCode(params);
          return JSON.stringify(result, null, 2);
        } catch (e) {
          return `Error: ${(e as Error).message}`;
        }
      },
    });
  }

  if (shouldInclude("dry_run")) {
    tools.push({
      name: "nexus_dry_run",
      description:
        "Run a FREE Solidity security validation. Returns syntax validation, 7 breach scenarios, " +
        "Digital Twin v3.1 mapping, and deployable flag. No cost. " +
        'Input: JSON like {"source_code":"pragma solidity ^0.8.20; contract Token { }"}',
      schema: undefined,
      async _call(input: string): Promise<string> {
        try {
          const params = JSON.parse(input);
          const result = await client.dryRun(params);
          return JSON.stringify(result, null, 2);
        } catch (e) {
          return `Error: ${(e as Error).message}`;
        }
      },
    });
  }

  if (shouldInclude("manifest")) {
    tools.push({
      name: "nexus_manifest",
      description:
        "Get the Nexus Gateway service manifest for A2A agent discovery. Returns all services, pricing, endpoints. Free.",
      schema: undefined,
      async _call(_input: string): Promise<string> {
        try {
          const result = await client.getManifest();
          return JSON.stringify(result, null, 2);
        } catch (e) {
          return `Error: ${(e as Error).message}`;
        }
      },
    });
  }

  return tools;
}

// ─── Vercel AI SDK Support ───

/**
 * Create tools compatible with the Vercel AI SDK `tool()` function.
 * Returns a record of tool definitions ready for `streamText` / `generateText`.
 *
 * @example
 * ```typescript
 * import { streamText, tool } from "ai";
 * import { createNexusVercelTools } from "nexus-gateway-sdk/langchain";
 *
 * const tools = createNexusVercelTools({ clientId: "my-agent" });
 * const result = await streamText({ model, tools, prompt: "..." });
 * ```
 */
export function createNexusVercelTools(options: NexusToolOptions = {}): Record<string, any> {
  const rawTools = createNexusTools(options);
  const tools: Record<string, any> = {};

  for (const t of rawTools) {
    tools[t.name] = {
      description: t.description,
      parameters: {
        type: "object",
        properties: {
          input: { type: "string", description: "JSON string with service parameters" },
        },
        required: ["input"],
      },
      execute: async ({ input }: { input: string }) => {
        return t._call(input);
      },
    };
  }

  return tools;
}
