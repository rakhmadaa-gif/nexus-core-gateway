/**
 * LangChain.js Example — Nexus Gateway Integration
 * =================================================
 * Demonstrates using Nexus Gateway tools with LangChain.js agents.
 *
 * Install:
 *   npm install @langchain/core @langchain/openai
 *   npm install nexus-gateway-sdk  # or use directly from sdk/typescript/src
 *
 * Run:
 *   npx tsx examples/langchain_example.ts
 */

import { NexusClient, createNexusTools } from "../src/index";

// ─── 1. Direct Client Usage ───

async function directUsage() {
  console.log("📡 Direct Client Usage\n" + "=".repeat(40));

  const client = new NexusClient({ clientId: "ts-demo" });

  // Get manifest (free)
  const manifest = await client.getManifest();
  console.log("Manifest version:", manifest.version);
  console.log("Services:", Object.keys(manifest.pricing_model?.services || {}));

  // Dry-run (free)
  const sampleCode = `
    pragma solidity ^0.8.20;
    contract Token {
      address public owner;
      mapping(address => uint256) public balanceOf;
      constructor() { owner = msg.sender; }
      function mint(address to, uint256 amount) public { balanceOf[to] += amount; }
    }
  `;
  const audit = await client.dryRun({ source_code: sampleCode });
  console.log("\nDry-run result:");
  console.log("  Deployable:", audit.preview?.deployable);
  console.log("  Risk level:", audit.preview?.risk_level);
  console.log("  Breach scenarios:", audit.breach_simulation?.scenarios?.length || 0);
}

// ─── 2. LangChain.js Tool Wrappers ───

async function langchainUsage() {
  console.log("\n🔧 LangChain.js Tool Wrappers\n" + "=".repeat(40));

  const tools = createNexusTools({ clientId: "ts-langchain-demo" });

  console.log("Available tools:");
  for (const t of tools) {
    console.log(`  - ${t.name}: ${t.description.substring(0, 80)}...`);
  }

  // Use dry-run tool directly (free, no auth)
  const dryRunTool = tools.find((t) => t.name === "nexus_dry_run")!;
  const result = await dryRunTool._call(
    JSON.stringify({
      source_code:
        "pragma solidity ^0.8.20; contract Token { function mint(address to, uint256 amt) public { } }",
    })
  );
  console.log("\nDry-run via tool:");
  console.log(result.substring(0, 500));
}

// ─── 3. Vercel AI SDK Integration ───

async function vercelAISDKUsage() {
  console.log("\n🤖 Vercel AI SDK Integration\n" + "=".repeat(40));

  // The createNexusVercelTools function returns tools compatible with
  // the Vercel AI SDK's `tool()` function format.
  //
  // import { generateText } from "ai";
  // import { createNexusVercelTools } from "nexus-gateway-sdk/langchain";
  //
  // const tools = createNexusVercelTools({ clientId: "vercel-demo" });
  // const result = await generateText({
  //   model: openai("gpt-4"),
  //   tools,
  //   prompt: "Audit this contract: pragma solidity ^0.8.20; contract Token { }",
  // });

  console.log("See code comments for Vercel AI SDK usage example.");
  console.log("The createNexusVercelTools() function returns tools in the format");
  console.log("expected by the Vercel AI SDK's streamText/generateText functions.");
}

// ─── Run ───

async function main() {
  console.log("🚀 Nexus Gateway TypeScript SDK Demo\n");

  try {
    await directUsage();
  } catch (e) {
    console.error("Direct usage error:", (e as Error).message);
  }

  try {
    await langchainUsage();
  } catch (e) {
    console.error("LangChain usage error:", (e as Error).message);
  }

  await vercelAISDKUsage();

  console.log("\n✅ Demo complete!");
}

main();
