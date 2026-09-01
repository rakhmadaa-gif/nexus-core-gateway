"""
LangChain Example — Nexus Gateway Integration
==============================================
Demonstrates using Nexus Gateway tools with LangChain agents.

Install:
    pip install langchain langchain-openai nexus-gateway-sdk

Run:
    python examples/langchain_example.py
"""

import json
from langchain.agents import AgentExecutor, create_react_agent
from langchain_openai import ChatOpenAI
from langchain import hub

from nexus_gateway import create_langchain_tools

# ─── 1. Create Tools ───

tools = create_langchain_tools(client_id="langchain-demo")

print("Available tools:")
for t in tools:
    print(f"  - {t.name}: {t.description[:80]}...")

# ─── 2. Create Agent ───

llm = ChatOpenAI(model="gpt-4", temperature=0)
prompt = hub.pull("hwchase17/react")

agent = create_react_agent(llm, tools, prompt)
executor = AgentExecutor(agent=agent, tools=tools, verbose=True)

# ─── 3. Run Examples ───

if __name__ == "__main__":
    print("\n🚀 Example 1: Discover Nexus Gateway services\n")
    result = executor.invoke({
        "input": "What services does Nexus Gateway offer? Get the manifest and summarize the services and pricing."
    })
    print(result["output"])

    print("\n🚀 Example 2: Free Solidity security audit\n")
    sample_contract = """
    pragma solidity ^0.8.20;
    contract Token {
        address public owner;
        mapping(address => uint256) public balanceOf;
        constructor() { owner = msg.sender; }
        function mint(address to, uint256 amount) public { balanceOf[to] += amount; }
        function transfer(address to, uint256 amount) public returns (bool) {
            balanceOf[msg.sender] -= amount;
            balanceOf[to] += amount;
            return true;
        }
    }
    """
    result = executor.invoke({
        "input": f"Run a security audit on this Solidity contract using the dry-run tool:\n\n{sample_contract}\n\nReport the breach scenarios and whether it's deployable."
    })
    print(result["output"])

    print("\n🚀 Example 3: Generate ERC-20 metadata (free trial)\n")
    result = executor.invoke({
        "input": "Generate structured data for an ERC-20 token called 'NexusToken' with symbol 'NXS' and 18 decimals."
    })
    print(result["output"])
