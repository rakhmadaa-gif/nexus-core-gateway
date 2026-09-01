"""
Nexus Gateway LangChain Tools
=============================
LangChain-compatible tool wrappers for Nexus Gateway services.

Usage:
    from nexus_gateway import NexusClient, create_langchain_tools

    tools = create_langchain_tools(client_id="my-agent-001")
    # tools is a list of LangChain Tool objects ready to use with any LangChain agent

    # Or use individual tools:
    from nexus_gateway.langchain import NexusStructuredDataTool, NexusDryRunTool
"""

from typing import Optional, List
from .client import NexusClient, NexusError

try:
    from langchain.tools import Tool
    from langchain.agents import AgentExecutor, create_react_agent
    _LANGCHAIN_AVAILABLE = True
except ImportError:
    _LANGCHAIN_AVAILABLE = False
    Tool = None  # type: ignore


def create_langchain_tools(client_id: str = "nexus-langchain", base_url: Optional[str] = None) -> list:
    """
    Create a list of LangChain Tool objects for all Nexus Gateway services.

    Returns a list of Tool objects that can be used with any LangChain agent
    (create_react_agent, AgentExecutor, etc.).

    Args:
        client_id: Unique identifier for your agent/application.
        base_url: Override the default gateway URL.

    Returns:
        List of LangChain Tool objects:
        - nexus_structured_data (20 CRED)
        - nexus_code_modules (120 CRED)
        - nexus_legal_code (29,900 CRED)
        - nexus_dry_run (FREE)
        - nexus_manifest (FREE)

    Example:
        from langchain.agents import AgentExecutor, create_react_agent
        from langchain_openai import ChatOpenAI
        from nexus_gateway import create_langchain_tools

        tools = create_langchain_tools(client_id="my-agent")
        llm = ChatOpenAI(model="gpt-4")
        agent = create_react_agent(llm, tools, prompt)
        executor = AgentExecutor(agent=agent, tools=tools)
    """
    if not _LANGCHAIN_AVAILABLE:
        raise ImportError(
            "LangChain is not installed. Install with: pip install langchain"
        )

    client = NexusClient(client_id=client_id, base_url=base_url)
    tools = []

    # Structured Data Tool (20 CRED)
    def _structured_data(query: str) -> str:
        """Generate structured JSON data. Input should be a description of what you need."""
        import json
        try:
            # Parse query as JSON params, or use as schema_type
            try:
                params = json.loads(query)
            except json.JSONDecodeError:
                params = {"schema_type": query}
            result = client.structured_data(**params)
            return json.dumps(result, indent=2, ensure_ascii=False)
        except NexusError as e:
            return f"Error: {e}"

    tools.append(Tool(
        name="nexus_structured_data",
        description=(
            "Generate verified structured JSON data for Web3/regulatory compliance. "
            "Costs 20 CRED ($0.20). "
            "Input: JSON string with schema_type and parameters, or just the schema type name. "
            "Example: '{\"schema_type\": \"erc20_metadata\", \"name\": \"MyToken\", \"symbol\": \"MTK\", \"decimals\": 18}'"
        ),
        func=_structured_data,
    ))

    # Code Modules Tool (120 CRED)
    def _code_modules(query: str) -> str:
        """Generate Solidity code. Input should be JSON with contract_type and params."""
        import json
        try:
            try:
                params = json.loads(query)
            except json.JSONDecodeError:
                params = {"contract_type": query}
            result = client.code_modules(**params)
            return json.dumps(result, indent=2, ensure_ascii=False)
        except NexusError as e:
            return f"Error: {e}"

    tools.append(Tool(
        name="nexus_code_modules",
        description=(
            "Generate security-checked Solidity smart contract code (ERC-20, ERC-721, Escrow). "
            "Costs 120 CRED ($1.20). "
            "Input: JSON string with contract_type and parameters. "
            "Example: '{\"contract_type\": \"erc20\", \"name\": \"MyToken\", \"symbol\": \"MTK\", \"decimals\": 18}'"
        ),
        func=_code_modules,
    ))

    # Legal-Code Tool (29,900 CRED)
    def _legal_code(query: str) -> str:
        """Generate legal-code hybrid. Input should be JSON with contract details."""
        import json
        try:
            params = json.loads(query)
            result = client.legal_code(**params)
            return json.dumps(result, indent=2, ensure_ascii=False)
        except NexusError as e:
            return f"Error: {e}"

    tools.append(Tool(
        name="nexus_legal_code",
        description=(
            "Generate a bilingual (English-Indonesian) legal contract + Solidity code + "
            "Digital Twin v3.1 mapping. Costs 29,900 CRED ($299.00). "
            "Input: JSON string with contract_type, jurisdiction, parties, and token details. "
            "Example: '{\"contract_type\": \"token_sale\", \"jurisdiction\": \"ID\", \"token\": {\"name\": \"MyToken\", \"symbol\": \"MTK\"}}'"
        ),
        func=_legal_code,
    ))

    # Dry-Run Tool (FREE)
    def _dry_run(source_code: str) -> str:
        """Run free Solidity validation. Input should be the Solidity source code."""
        import json
        try:
            result = client.dry_run(source_code=source_code)
            return json.dumps(result, indent=2, ensure_ascii=False)
        except NexusError as e:
            return f"Error: {e}"

    tools.append(Tool(
        name="nexus_dry_run",
        description=(
            "Run a FREE Solidity security validation on smart contract source code. "
            "Returns syntax validation, 7 breach scenarios, Digital Twin v3.1 mapping, "
            "and deployable flag. No cost, no auth required. "
            "Input: The Solidity source code to validate."
        ),
        func=_dry_run,
    ))

    # Manifest Tool (FREE)
    def _manifest(_input: str = "") -> str:
        """Get the service manifest."""
        import json
        try:
            result = client.get_manifest()
            return json.dumps(result, indent=2, ensure_ascii=False)
        except NexusError as e:
            return f"Error: {e}"

    tools.append(Tool(
        name="nexus_manifest",
        description=(
            "Get the Nexus Gateway service manifest for A2A agent discovery. "
            "Returns all services, pricing, endpoints, and blockchain addresses. "
            "Free, no auth required. Input: any string (ignored)."
        ),
        func=_manifest,
    ))

    return tools
