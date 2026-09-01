"""
Nexus Gateway Python SDK
========================
M2M Legal-Code Services for Web3 — bilingual (EN/ID) legal contracts,
audited Solidity smart contracts, and Digital Twin v3.1 mapping.

Usage:
    from nexus_gateway import NexusClient

    client = NexusClient(client_id="my-agent-001")
    result = client.structured_data(schema_type="erc20_metadata", name="MyToken", symbol="MTK", decimals=18)

CrewAI:
    from nexus_gateway import NexusStructuredDataTool, NexusCodeModulesTool, NexusLegalCodeTool, NexusDryRunTool

LangChain:
    from nexus_gateway import create_langchain_tools
    tools = create_langchain_tools(client_id="my-agent-001")
"""

from .client import NexusClient
from .tools import (
    NexusStructuredDataTool,
    NexusCodeModulesTool,
    NexusLegalCodeTool,
    NexusDryRunTool,
    NexusManifestTool,
)
from .langchain import create_langchain_tools

__version__ = "1.0.0"
__all__ = [
    "NexusClient",
    "NexusStructuredDataTool",
    "NexusCodeModulesTool",
    "NexusLegalCodeTool",
    "NexusDryRunTool",
    "NexusManifestTool",
    "create_langchain_tools",
]
