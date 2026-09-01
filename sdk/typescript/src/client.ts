/**
 * Nexus Gateway TypeScript SDK — Core Client
 * ===========================================
 * HTTP client for the Nexus Gateway M2M API.
 *
 * Base URL: https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world
 */

export class NexusError extends Error {
  statusCode: number;
  payload: Record<string, any>;

  constructor(message: string, statusCode: number = 0, payload: Record<string, any> = {}) {
    super(message);
    this.name = "NexusError";
    this.statusCode = statusCode;
    this.payload = payload;
  }
}

export interface NexusClientOptions {
  clientId?: string;
  baseUrl?: string;
  timeout?: number;
}

export interface DryRunOptions {
  source_code: string;
  contract_type?: string;
  clauses?: Array<{ clause_id: string; heading_en: string; heading_id: string }>;
  check_nonce_db?: boolean;
  client_address?: string;
}

export interface ServiceResponse {
  status: string;
  payload_id?: string;
  timestamp?: string;
  service_type?: string;
  data?: any;
  error?: any;
  metadata?: {
    node_id: string;
    version: string;
    latency_ms: number;
    credits_charged: number;
  };
}

/**
 * Core HTTP client for Nexus Gateway.
 *
 * @example
 * ```typescript
 * import { NexusClient } from "nexus-gateway-sdk";
 *
 * const client = new NexusClient({ clientId: "my-agent-001" });
 * const result = await client.structuredData({ schema_type: "erc20_metadata", name: "MyToken", symbol: "MTK", decimals: 18 });
 * console.log(result);
 * ```
 */
export class NexusClient {
  private clientId: string;
  private baseUrl: string;
  private timeout: number;

  static DEFAULT_URL = "https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world";

  constructor(options: NexusClientOptions = {}) {
    this.clientId = options.clientId || "nexus-ts-sdk";
    this.baseUrl = options.baseUrl || NexusClient.DEFAULT_URL;
    this.timeout = options.timeout || 30000;
  }

  // ─── Free Endpoints ───

  /** Get the A2A agent discovery manifest (free, no auth). */
  async getManifest(): Promise<Record<string, any>> {
    return this._get("/manifest.json");
  }

  /** Get sample manifests (free, no auth). Pass tier for individual tier. */
  async getSamples(tier?: string): Promise<Record<string, any>> {
    const path = tier ? `/samples/${tier}` : "/samples";
    return this._get(path);
  }

  /** Get live telemetry metrics (free, no auth). */
  async getMetrics(): Promise<Record<string, any>> {
    return this._get("/metrics");
  }

  /** Run free Solidity validation with breach simulation (free, no auth). */
  async dryRun(options: DryRunOptions): Promise<Record<string, any>> {
    return this._post("/gateway/dry-run", options as Record<string, any>, false);
  }

  // ─── Paid Services ───

  /** Generate verified structured JSON data (20 CRED = $0.20). Free trial available. */
  async structuredData(params: Record<string, any>): Promise<ServiceResponse> {
    return this._callService("structured_data", params);
  }

  /** Generate security-checked Solidity smart contract code (120 CRED = $1.20). */
  async codeModules(params: Record<string, any>): Promise<ServiceResponse> {
    return this._callService("code_modules", params);
  }

  /** Generate bilingual (EN/ID) legal contract + Solidity code + Digital Twin matrix (29,900 CRED = $299.00). */
  async legalCode(params: Record<string, any>): Promise<ServiceResponse> {
    return this._callService("legal_code", params);
  }

  /** Top-up credits via USDC pull payment on Polygon (FREE — adds credits). */
  async pullPayment(params: Record<string, any>): Promise<ServiceResponse> {
    return this._callService("pull_payment", params);
  }

  // ─── Internal ───

  private async _callService(serviceType: string, params: Record<string, any>): Promise<ServiceResponse> {
    return this._post("/", { service_type: serviceType, params }, true);
  }

  private async _get(path: string): Promise<Record<string, any>> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const resp = await fetch(url, { method: "GET", signal: controller.signal });
      return await resp.json() as Record<string, any>;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async _post(path: string, body: Record<string, any>, auth: boolean): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (auth) headers["x-client-id"] = this.clientId;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const data: any = await resp.json();

      if (!resp.ok) {
        throw new NexusError(
          `Nexus Gateway error ${resp.status}: ${data?.error || data?.message || "Unknown error"}`,
          resp.status,
          data || {},
        );
      }

      return data;
    } catch (err) {
      if (err instanceof NexusError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new NexusError("Request timeout", 0);
      }
      throw new NexusError(`Network error: ${(err as Error).message}`, 0);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
