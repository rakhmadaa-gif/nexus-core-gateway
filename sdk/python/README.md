# Nexus Gateway Python SDK

> Native tool wrappers for **CrewAI** and **LangChain** — generate bilingual legal contracts, audited Solidity smart contracts, and Digital Twin v3.1 mapping via a single import.

## Install

```bash
pip install nexus-gateway-sdk

# Optional framework dependencies:
pip install "nexus-gateway-sdk[crewai]"     # CrewAI tools
pip install "nexus-gateway-sdk[langchain]"  # LangChain tools
pip install "nexus-gateway-sdk[all]"        # Both
```

## Quick Start

### CrewAI

```python
from crewai import Agent, Task, Crew
from nexus_gateway import (
    NexusStructuredDataTool,
    NexusCodeModulesTool,
    NexusLegalCodeTool,
    NexusDryRunTool,
    NexusManifestTool,
)

# Free tools (no auth needed)
dry_run = NexusDryRunTool()
manifest = NexusManifestTool()

# Paid tools (free trial available)
structured_data = NexusStructuredDataTool(client_id="my-agent")
code_modules = NexusCodeModulesTool(client_id="my-agent")

# Create agents with Nexus tools
auditor = Agent(
    role="Smart Contract Auditor",
    goal="Audit Solidity contracts for security vulnerabilities",
    backstory="Expert in smart contract security",
    tools=[dry_run, manifest],
)

crew = Crew(agents=[auditor], tasks=[...])
result = crew.kickoff()
```

### LangChain

```python
from langchain.agents import AgentExecutor, create_react_agent
from langchain_openai import ChatOpenAI
from nexus_gateway import create_langchain_tools

tools = create_langchain_tools(client_id="my-agent")
agent = create_react_agent(ChatOpenAI(model="gpt-4"), tools, prompt)
executor = AgentExecutor(agent=agent, tools=tools)
```

### Direct Client

```python
from nexus_gateway import NexusClient

client = NexusClient(client_id="my-agent")
manifest = client.get_manifest()
audit = client.dry_run(source_code="pragma solidity ^0.8.20; contract Token { }")
result = client.structured_data(schema_type="erc20_metadata", name="MyToken", symbol="MTK", decimals=18)
```

## Available Tools

| Tool | Service | Cost | Auth |
|---|---|---|---|
| `NexusStructuredDataTool` | structured_data | 20 CRED ($0.20) | Yes |
| `NexusCodeModulesTool` | code_modules | 120 CRED ($1.20) | Yes |
| `NexusLegalCodeTool` | legal_code | 29,900 CRED ($299.00) | Yes |
| `NexusDryRunTool` | dry-run | FREE | No |
| `NexusManifestTool` | manifest | FREE | No |

## License

MIT
