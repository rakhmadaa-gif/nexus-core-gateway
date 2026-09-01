"""
CrewAI Example — Nexus Gateway Integration
==========================================
Demonstrates using Nexus Gateway tools with CrewAI agents.

Install:
    pip install crewai nexus-gateway-sdk

Run:
    python examples/crewai_example.py
"""

from crewai import Agent, Task, Crew, Process
from nexus_gateway import (
    NexusStructuredDataTool,
    NexusCodeModulesTool,
    NexusLegalCodeTool,
    NexusDryRunTool,
    NexusManifestTool,
)

# ─── 1. Initialize Tools ───

# Paid tools (require client_id — free trial available for structured_data)
structured_data_tool = NexusStructuredDataTool(client_id="crewai-demo")
code_tool = NexusCodeModulesTool(client_id="crewai-demo")
legal_tool = NexusLegalCodeTool(client_id="crewai-demo")

# Free tools (no auth needed)
dry_run_tool = NexusDryRunTool()
manifest_tool = NexusManifestTool()

# ─── 2. Create Agents ───

# Agent 1: Discovers what Nexus Gateway offers
scout = Agent(
    role="Service Discovery Scout",
    goal="Discover what services Nexus Gateway offers and report the manifest",
    backstory=(
        "You are an expert at evaluating M2M API services. "
        "You explore available services and report their capabilities and pricing."
    ),
    tools=[manifest_tool],
    verbose=True,
    allow_delegation=False,
)

# Agent 2: Audits Solidity contracts for free
auditor = Agent(
    role="Smart Contract Security Auditor",
    goal="Audit Solidity smart contracts for security vulnerabilities using the free dry-run tool",
    backstory=(
        "You are a meticulous smart contract security auditor. "
        "You use the Nexus Gateway dry-run tool to check contracts for 7 breach scenarios "
        "before they are deployed. You report risk levels and recommendations."
    ),
    tools=[dry_run_tool],
    verbose=True,
    allow_delegation=False,
)

# Agent 3: Generates legal-code packages
generator = Agent(
    role="Legal-Code Package Generator",
    goal="Generate bilingual (EN/ID) legal contracts with corresponding Solidity code",
    backstory=(
        "You are a legal-tech specialist who generates bilingual legal contracts "
        "mapped to Solidity smart contracts via Digital Twin v3.1 technology. "
        "You can generate structured data, code modules, and full legal-code hybrids."
    ),
    tools=[structured_data_tool, code_tool, legal_tool, dry_run_tool],
    verbose=True,
    allow_delegation=False,
)

# ─── 3. Create Tasks ───

task1 = Task(
    description=(
        "Use the nexus_manifest tool to get the Nexus Gateway service manifest. "
        "Report all available services, their costs, and what each one does."
    ),
    expected_output="A summary of all 5 Nexus Gateway services with pricing and descriptions.",
    agent=scout,
)

# Sample Solidity contract for the auditor to check
SAMPLE_CONTRACT = """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract SimpleToken {
    string public name = "DemoToken";
    string public symbol = "DMT";
    uint8 public decimals = 18;
    uint256 public totalSupply;
    address public owner;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(uint256 _totalSupply) {
        owner = msg.sender;
        totalSupply = _totalSupply;
        balanceOf[msg.sender] = _totalSupply;
    }

    function transfer(address to, uint256 amount) public returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function mint(address to, uint256 amount) public {
        balanceOf[to] += amount;
        totalSupply += amount;
    }
}
"""

task2 = Task(
    description=(
        f"Use the nexus_dry_run tool to audit this Solidity contract:\n\n{SAMPLE_CONTRACT}\n\n"
        "Report the 7 breach scenario results, overall risk level, and whether the contract is deployable."
    ),
    expected_output="Security audit report with 7 breach scenario results and deployable flag.",
    agent=auditor,
)

task3 = Task(
    description=(
        "Use the nexus_structured_data tool to generate ERC-20 metadata for a token called "
        "'NexusToken' with symbol 'NXS' and 18 decimals. "
        "Then use the nexus_code_modules tool to generate an ERC-20 Solidity contract for the same token."
    ),
    expected_output="Generated ERC-20 metadata JSON and Solidity contract code.",
    agent=generator,
)

# ─── 4. Create and Run Crew ───

crew = Crew(
    agents=[scout, auditor, generator],
    tasks=[task1, task2, task3],
    process=Process.sequential,
    verbose=True,
)

if __name__ == "__main__":
    print("🚀 Starting Nexus Gateway CrewAI Demo\n")
    result = crew.kickoff()
    print("\n✅ Crew completed!")
    print(result)
