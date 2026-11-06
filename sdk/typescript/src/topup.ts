/**
 * Nexus credit top-up via EIP-712 USDC permit pull payment (SDK v2).
 * =================================================================
 * 1 USDC = 100 CRED. Fitness attestation = 5 CRED/call.
 *
 * Flow: read USDC nonce on-chain → sign EIP-2612 Permit (owner→Gateway
 * contract as spender) → POST to the gateway pull_payment service (FREE,
 * adds credits). The private key NEVER touches CI — run topup once from
 * your laptop: `npx nexus-gateway-sdk@2 topup --amount 5 --client-id my-id`.
 */

import { JsonRpcProvider, Wallet, Contract, keccak256, toUtf8Bytes, Signature } from "ethers";
import { NexusError } from "./client";

export const USDC_POLYGON = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
/** Gateway.sol v4.2.0 (current). NOT the treasury wallet. */
export const GATEWAY_CONTRACT = "0x2a3D917379Bf94D7B6f239D6BcbBdD7cD8543683";
export const DEFAULT_RPC = "https://polygon-bor-rpc.publicnode.com";
export const PULL_PAYMENT_BASE_URL =
  "https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world";
/** Contract enforces 30-60 min (1800-3600s). 2400s = 40 min, mid-window. */
export const DEADLINE_BUFFER_SECONDS = 2400;

/** Normalize hex private keys — storage without a 0x prefix must still work. */
export function normalizePrivateKey(key: string): string {
  const k = key.trim();
  return k.startsWith("0x") ? k : `0x${k}`;
}

export interface TopupOptions {
  clientId: string;
  /** USDC amount, e.g. 5 for 500 CRED. Min 0.01 (dust-rejected below). */
  amountUsdc: number;
  privateKey: string;
  rpcUrl?: string;
  gatewayAddress?: string;
  usdcAddress?: string;
  baseUrl?: string;
  deadlineSeconds?: number;
  fetchImpl?: typeof fetch;
}

export interface TopupResult {
  status: "verified" | "pending";
  txHash: string | null;
  blockNumber: number | null;
  creditsMinted: number | null;
  amountUsdc: number | null;
  raw: Record<string, unknown>;
}

export async function topupCredits(opts: TopupOptions): Promise<TopupResult> {
  if (!(opts.amountUsdc > 0)) throw new Error("amountUsdc must be > 0");
  const atomic = BigInt(Math.round(opts.amountUsdc * 1_000_000));
  if (atomic <= 0n) throw new Error("amountUsdc too small (min 0.01 USDC)");

  const provider = new JsonRpcProvider(opts.rpcUrl ?? DEFAULT_RPC);
  const wallet = new Wallet(normalizePrivateKey(opts.privateKey), provider);
  const usdc = new Contract(
    opts.usdcAddress ?? USDC_POLYGON,
    ["function nonces(address owner) view returns (uint256)"],
    provider,
  );

  const nonce = await usdc.nonces(wallet.address);
  const deadline = Math.floor(Date.now() / 1000) + (opts.deadlineSeconds ?? DEADLINE_BUFFER_SECONDS);

  const domain = {
    name: "USD Coin",
    version: "2",
    chainId: 137,
    verifyingContract: opts.usdcAddress ?? USDC_POLYGON,
  };
  const types = {
    Permit: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };
  const message = {
    owner: wallet.address,
    spender: opts.gatewayAddress ?? GATEWAY_CONTRACT,
    value: atomic,
    nonce,
    deadline,
  };

  const sig = await wallet.signTypedData(domain, types, message);
  const { v, r, s } = Signature.from(sig);
  const clientIdHash = keccak256(toUtf8Bytes(opts.clientId));

  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch((opts.baseUrl ?? PULL_PAYMENT_BASE_URL).replace(/\/+$/, ""), {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-client-id": opts.clientId },
    body: JSON.stringify({
      service_type: "pull_payment",
      params: {
        client_address: wallet.address,
        amount_usdc: atomic.toString(),
        deadline,
        v,
        r,
        s,
        client_id_hash: clientIdHash,
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  let json: Record<string, unknown> | null = null;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    /* non-JSON */
  }
  if (!res.ok && res.status !== 202) {
    const nested = (json?.error as Record<string, unknown> | undefined) ?? {};
    const msg =
      String(nested.message ?? json?.message ?? "") ||
      `Top-up failed (HTTP ${res.status}). Check: deadline window 30-60 min, current USDC nonce, spender = Gateway contract 0x2a3D...3683.`;
    throw new NexusError(msg, res.status, json ?? {});
  }

  // m2mSuccess envelope: { status, data: { status, payload: {...} } }
  const data = (json?.data as Record<string, unknown> | undefined) ?? {};
  const payload = (data.payload as Record<string, unknown> | undefined) ??
    (json?.payload as Record<string, unknown> | undefined) ?? {};
  const statusStr = String(data.status ?? json?.status ?? "unknown");

  return {
    status: statusStr === "verified" ? "verified" : "pending",
    txHash: (payload.tx_hash as string) ?? null,
    blockNumber: (payload.block_number as number) ?? null,
    creditsMinted: (payload.credits_minted as number) ?? null,
    amountUsdc: (payload.amount_usdc as number) ?? null,
    raw: json ?? {},
  };
}
