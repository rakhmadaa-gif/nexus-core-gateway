"""
Nexus Gateway Core Client
=========================
HTTP client for the Nexus Gateway M2M API.

Base URL: https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world
"""

import json
import time
import urllib.request
import urllib.error
from typing import Any, Dict, Optional


class NexusError(Exception):
    """Base exception for Nexus Gateway errors."""

    def __init__(self, message: str, status_code: int = 0, payload: Optional[dict] = None):
        super().__init__(message)
        self.status_code = status_code
        self.payload = payload or {}


class NexusClient:
    """
    Core HTTP client for Nexus Gateway.

    Args:
        client_id: Unique identifier for your agent/application (required for paid services).
        base_url: Override the default gateway URL.
        timeout: Request timeout in seconds.
    """

    BASE_URL = "https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world"

    def __init__(
        self,
        client_id: str = "nexus-python-sdk",
        base_url: Optional[str] = None,
        timeout: int = 30,
    ):
        self.client_id = client_id
        self.base_url = base_url or self.BASE_URL
        self.timeout = timeout

    # ─── Free Endpoints ───

    def get_manifest(self) -> dict:
        """Get the A2A agent discovery manifest (free, no auth)."""
        return self._get("/manifest.json")

    def get_samples(self, tier: Optional[str] = None) -> dict:
        """
        Get sample manifests (free, no auth).

        Args:
            tier: Optional tier ID ('tier1', 'tier2', 'tier3'). If None, returns all tiers.
        """
        path = f"/samples/{tier}" if tier else "/samples"
        return self._get(path)

    def get_metrics(self) -> dict:
        """Get live telemetry metrics (free, no auth)."""
        return self._get("/metrics")

    def dry_run(
        self,
        source_code: str,
        contract_type: Optional[str] = None,
        clauses: Optional[list] = None,
        check_nonce_db: bool = False,
        client_address: Optional[str] = None,
    ) -> dict:
        """
        Run free Solidity validation with breach simulation (free, no auth).

        Args:
            source_code: Solidity source code to validate.
            contract_type: Optional contract type hint.
            clauses: Optional legal clauses for twin matrix mapping.
            check_nonce_db: If True, query pull_payment_authorizations DB for nonce uniqueness.
            client_address: Client address for nonce DB check (hex format).

        Returns:
            Validation result with syntax check, Digital Twin v3.1 matrix,
            7 breach scenarios, nonce defense, and deployable flag.
        """
        body: Dict[str, Any] = {"source_code": source_code}
        if contract_type:
            body["contract_type"] = contract_type
        if clauses:
            body["clauses"] = clauses
        if check_nonce_db:
            body["check_nonce_db"] = True
            if client_address:
                body["client_address"] = client_address
        return self._post("/gateway/dry-run", body, auth=False)

    # ─── Paid Services ───

    def structured_data(self, **params) -> dict:
        """
        Generate verified structured JSON data (20 CRED = $0.20).

        Free trial available: 20 CRED (1x, 24hr expiry).

        Common params:
            schema_type: Type of schema (e.g., 'erc20_metadata', 'erc721_metadata', 'compliance_report')
            name, symbol, decimals, total_supply, etc.
        """
        return self._call_service("structured_data", params)

    def code_modules(self, **params) -> dict:
        """
        Generate security-checked Solidity smart contract code (120 CRED = $1.20).

        Discount trial available: 100 CRED off (1x, 24hr expiry).

        Common params:
            contract_type: 'erc20', 'erc721', 'escrow'
            name, symbol, decimals, total_supply, etc.
        """
        return self._call_service("code_modules", params)

    def legal_code(self, **params) -> dict:
        """
        Generate bilingual (EN/ID) legal contract + Solidity code + Digital Twin matrix (29,900 CRED = $299.00).

        Common params:
            contract_type: 'token_sale', 'nft_minting', 'escrow_agreement'
            jurisdiction: 'ID', 'EN', 'BOTH'
            language_pair: 'EN-ID'
            parties: {'issuer': '0x...', 'purchaser': '0x...'}
            token: {'name': '...', 'symbol': '...', 'decimals': 18, 'total_supply': 1000000}
        """
        return self._call_service("legal_code", params)

    def pull_payment(self, **params) -> dict:
        """
        Top-up credits via USDC pull payment on Polygon (FREE — adds credits, no charge).

        Common params:
            client_address: Signer's wallet address
            amount_usdc: Amount in USDC (6 decimals)
            deadline: Permit deadline in seconds
            v, r, s: EIP-712 signature components
        """
        return self._call_service("pull_payment", params)

    # ─── Internal ───

    def _call_service(self, service_type: str, params: dict) -> dict:
        """Call a paid service endpoint."""
        return self._post("/", {
            "service_type": service_type,
            "params": params,
        }, auth=True)

    def _get(self, path: str) -> dict:
        """Make a GET request (no auth required)."""
        url = f"{self.base_url}{path}"
        req = urllib.request.Request(url, method="GET")
        return self._execute(req)

    def _post(self, path: str, body: dict, auth: bool = False) -> dict:
        """Make a POST request."""
        url = f"{self.base_url}{path}"
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        if auth:
            req.add_header("x-client-id", self.client_id)
        return self._execute(req)

    def _execute(self, req: urllib.request.Request) -> dict:
        """Execute an HTTP request and return parsed JSON."""
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8") if e.fp else "{}"
            try:
                err = json.loads(body)
            except json.JSONDecodeError:
                err = {"error": body}
            raise NexusError(
                f"Nexus Gateway error {e.code}: {err.get('error', err.get('message', body))}",
                status_code=e.code,
                payload=err,
            )
        except urllib.error.URLError as e:
            raise NexusError(f"Network error: {e.reason}", status_code=0)
