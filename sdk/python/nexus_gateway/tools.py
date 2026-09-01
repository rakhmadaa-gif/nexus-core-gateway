"""
Nexus Gateway CrewAI Tools
==========================
CrewAI-compatible tool wrappers for Nexus Gateway services.

Usage:
    from crewai import Agent, Task, Crew
    from nexus_gateway import NexusStructuredDataTool, NexusCodeModulesTool, NexusLegalCodeTool, NexusDryRunTool

    structured_data_tool = NexusStructuredDataTool(client_id="my-agent-001")
    code_tool = NexusCodeModulesTool(client_id="my-agent-001")
    legal_tool = NexusLegalCodeTool(client_id="my-agent-001")
    dry_run_tool = NexusDryRunTool()

    analyst = Agent(
        role="Web3 Compliance Analyst",
        goal="Generate legal-code packages for token launches",
        backstory="Expert in bilingual legal contracts and Solidity auditing",
        tools=[structured_data_tool, code_tool, legal_tool, dry_run_tool],
    )
"""

from typing import Optional
from .client import NexusClient, NexusError

try:
    from crewai.tools import BaseTool
except ImportError:
    # Fallback: define a minimal BaseTool so the module imports without crewai installed
    class BaseTool:  # type: ignore
        name: str = ""
        description: str = ""

        def _run(self, *args, **kwargs):
            raise NotImplementedError

        def run(self, *args, **kwargs):
            return self._run(*args, **kwargs)


class NexusStructuredDataTool(BaseTool):
    """Generate verified structured JSON data for Web3/regulatory compliance (20 CRED)."""

    name: str = "nexus_structured_data"
    description: str = (
        "Generate verified structured JSON data for Web3, regulatory compliance, "
        "and cross-platform orchestration. Costs 20 CRED ($0.20). "
        "Provide schema_type and relevant parameters (e.g., name, symbol, decimals for ERC-20)."
    )

    def __init__(self, client_id: str = "nexus-crewai", base_url: Optional[str] = None):
        super().__init__()
        self._client = NexusClient(client_id=client_id, base_url=base_url)

    def _run(self, schema_type: str, **kwargs) -> str:
        """Run the structured data generation service.

        Args:
            schema_type: Type of schema (e.g., 'erc20_metadata', 'erc721_metadata', 'compliance_report')
            **kwargs: Additional parameters (name, symbol, decimals, total_supply, etc.)

        Returns:
            JSON string with the generated structured data.
        """
        try:
            kwargs["schema_type"] = schema_type
            result = self._client.structured_data(**kwargs)
            import json
            return json.dumps(result, indent=2, ensure_ascii=False)
        except NexusError as e:
            return f"Error: {e}"


class NexusCodeModulesTool(BaseTool):
    """Generate security-checked Solidity smart contract code (120 CRED)."""

    name: str = "nexus_code_modules"
    description: str = (
        "Generate security-checked Solidity smart contract code (ERC-20, ERC-721, Escrow). "
        "Costs 120 CRED ($1.20). Provide contract_type and token parameters."
    )

    def __init__(self, client_id: str = "nexus-crewai", base_url: Optional[str] = None):
        super().__init__()
        self._client = NexusClient(client_id=client_id, base_url=base_url)

    def _run(self, contract_type: str, **kwargs) -> str:
        """Run the code module generation service.

        Args:
            contract_type: Type of contract ('erc20', 'erc721', 'escrow')
            **kwargs: Additional parameters (name, symbol, decimals, total_supply, etc.)

        Returns:
            JSON string with the generated Solidity code and metadata.
        """
        try:
            kwargs["contract_type"] = contract_type
            result = self._client.code_modules(**kwargs)
            import json
            return json.dumps(result, indent=2, ensure_ascii=False)
        except NexusError as e:
            return f"Error: {e}"


class NexusLegalCodeTool(BaseTool):
    """Generate bilingual (EN/ID) legal contract + Solidity code + Digital Twin matrix (29,900 CRED)."""

    name: str = "nexus_legal_code"
    description: str = (
        "Generate a bilingual (English-Indonesian) legal contract mapped directly to "
        "Solidity code functions via Digital Twin v3.1. Includes clause-to-code bipolar "
        "mapping, breach conditions, and audit trail. Costs 29,900 CRED ($299.00). "
        "Provide contract_type, jurisdiction, parties, and token details."
    )

    def __init__(self, client_id: str = "nexus-crewai", base_url: Optional[str] = None):
        super().__init__()
        self._client = NexusClient(client_id=client_id, base_url=base_url)

    def _run(self, contract_type: str, jurisdiction: str = "ID", **kwargs) -> str:
        """Run the legal-code hybrid generation service.

        Args:
            contract_type: Type of contract ('token_sale', 'nft_minting', 'escrow_agreement')
            jurisdiction: Legal jurisdiction ('ID', 'EN', 'BOTH')
            **kwargs: Additional parameters (parties, token, language_pair, etc.)

        Returns:
            JSON string with the legal contract (markdown), Solidity code, and Digital Twin matrix.
        """
        try:
            kwargs["contract_type"] = contract_type
            kwargs["jurisdiction"] = jurisdiction
            result = self._client.legal_code(**kwargs)
            import json
            return json.dumps(result, indent=2, ensure_ascii=False)
        except NexusError as e:
            return f"Error: {e}"


class NexusDryRunTool(BaseTool):
    """Run free Solidity validation with 7 breach scenarios and Digital Twin v3.1 analysis."""

    name: str = "nexus_dry_run"
    description: str = (
        "Run a FREE Solidity security validation on smart contract source code. "
        "Returns syntax validation, Digital Twin v3.1 bipolar mapping (clause-to-code), "
        "7 breach scenarios (unauthorized minting, transfer violation, fund drain, "
        "emergency freeze, ownership renounce, reentrancy, replay attack), "
        "nonce defense check, and a deployable flag. No cost, no auth required."
    )

    def __init__(self, base_url: Optional[str] = None):
        super().__init__()
        self._client = NexusClient(base_url=base_url)

    def _run(self, source_code: str, check_nonce_db: bool = False, client_address: str = "") -> str:
        """Run the free Solidity dry-run validation.

        Args:
            source_code: Solidity source code to validate
            check_nonce_db: If True, check nonce uniqueness in the DB
            client_address: Client address for nonce DB check (hex format)

        Returns:
            JSON string with validation results, breach simulation, and deployable flag.
        """
        try:
            result = self._client.dry_run(
                source_code=source_code,
                check_nonce_db=check_nonce_db if check_nonce_db else False,
                client_address=client_address if client_address else None,
            )
            import json
            return json.dumps(result, indent=2, ensure_ascii=False)
        except NexusError as e:
            return f"Error: {e}"


class NexusManifestTool(BaseTool):
    """Get the Nexus Gateway service manifest for A2A agent discovery (free)."""

    name: str = "nexus_manifest"
    description: str = (
        "Get the Nexus Gateway service manifest for agent-to-agent (A2A) discovery. "
        "Returns all available services, pricing, endpoints, and blockchain addresses. "
        "Free, no authentication required."
    )

    def __init__(self, base_url: Optional[str] = None):
        super().__init__()
        self._client = NexusClient(base_url=base_url)

    def _run(self) -> str:
        """Get the service manifest."""
        try:
            result = self._client.get_manifest()
            import json
            return json.dumps(result, indent=2, ensure_ascii=False)
        except NexusError as e:
            return f"Error: {e}"
