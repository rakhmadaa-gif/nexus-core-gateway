// ============================================================================
// x402_settlement.ts — P0: PAYMENT-SIGNATURE handler (x402 handshake completion)
// ============================================================================
// Closes the half-open x402 handshake: our 402 responses were spec-compliant
// (PAYMENT-REQUIRED header, 14/14 x402-list compliance) but no handler existed
// for the client's PAYMENT-SIGNATURE header — spec-compliant x402 clients
// could not complete a purchase. This module completes the loop:
//
//   client ── 402 + PAYMENT-REQUIRED ──> gateway            (existing)
//   client ── req + PAYMENT-SIGNATURE ──> gateway            (NEW — this module)
//     1. decode base64 PaymentPayload (x402 v2)
//     2. validate schema: scheme=exact, network in X402_CHAINS, asset=USDC,
//        payTo=treasury, amount>0
//     3. verify EIP-3009 transferWithAuthorization signature LOCALLY
//        (ethers verifyTypedData, USDC domain name "USD Coin" version "2",
//        chainId 137) — standard industry scheme, no exotic validation
//     4. check on-chain authorizationState(from, nonce) == unused (authoritative
//        anti-replay, same source of truth USDC itself uses)
//     5. settle: submit transferWithAuthorization on-chain via treasury wallet
//        (same proven pattern as the pull-payment rail)
//     6. credit balance INSTANTLY via record_x402_credits() DB function
//        (atomic, replay-safe via unique tx hash)
//     7. return PAYMENT-RESPONSE header (SettlementResponse base64) + 200
//
// Model: pay-to-top-up. Payment credits the client's CRED balance
// (1 USDC = 100 CRED), then the original request proceeds through the normal
// gatekeeper. If the service costs more than the payment, the client gets a
// fresh 402 with the remaining price — credits are never lost.
// ============================================================================

import { Wallet, Contract, JsonRpcProvider, verifyTypedData } from "ethers";

// -- Constants (mirror PULL_PAYMENT_CONFIG / PRICING_MODEL in index.ts) ------

export const X402_CONFIG = {
  usdc_address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  treasury: "0x80963791ce7cb9c5d580fe638c39fdd9ffdae2d5",
  rpc_url: "https://polygon-bor-rpc.publicnode.com",
  chain_id: 137,
  usdc_name: "USD Coin",
  usdc_version: "2",
  cred_per_usdc: 100,
  usdc_decimals: 6,
  max_settle_wait_ms: 15_000, // keep inside x402 client 10-15s timeout
};

// -- v5.18.0: Multi-chain support (Polygon PoS + Base) -------------------------
// Settlement is chain-aware: the PAYMENT-SIGNATURE payload names the network it
// pays on, and verification/settlement use that chain's USDC domain + RPC.
// The Base accept is advertised only while the BASE_ACCEPTS_ENABLED edge secret
// is "true" — the treasury needs ETH on Base for settlement gas before the
// rail can be advertised (settlement reverts without gas).

export interface X402ChainConfig {
  network: string;
  chain_id: number;
  name: string;
  rpc_url: string;
  usdc_address: string;
  usdc_name: string;
  usdc_version: string;
  usdc_decimals: number;
}

export const X402_CHAINS: Record<string, X402ChainConfig> = {
  "eip155:137": {
    network: "eip155:137",
    chain_id: 137,
    name: "Polygon PoS",
    rpc_url: "https://polygon-bor-rpc.publicnode.com",
    usdc_address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    usdc_name: "USD Coin",
    usdc_version: "2",
    usdc_decimals: 6,
  },
  "eip155:8453": {
    network: "eip155:8453",
    chain_id: 8453,
    name: "Base",
    rpc_url: "https://mainnet.base.org",
    usdc_address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    usdc_name: "USD Coin",
    usdc_version: "2",
    usdc_decimals: 6,
  },
};

export function getChainConfig(network: string | undefined | null): X402ChainConfig {
  const key = (network ?? "eip155:137").toLowerCase();
  return X402_CHAINS[key] ?? X402_CHAINS["eip155:137"];
}

// v5.18.0: payer-derived settlement client id. Spec-compliant x402 clients may
// send no x-client-id at all — crediting "x402-anonymous" lumped every
// anonymous payer into one bucket and the paid request then died at the
// gatekeeper's MISSING_CLIENT_ID check. Derive a stable per-payer id instead:
// the same payer always maps to the same id, credits persist across calls,
// and the paid request proceeds through the gatekeeper with that id injected.
export function deriveSettlementClientId(
  headerClientId: string | null | undefined,
  payer: string,
): string {
  if (headerClientId && headerClientId.trim().length > 0) return headerClientId;
  const p = (payer ?? "").trim().toLowerCase();
  if (p.length > 0) return `x402-payer-${p}`;
  return "x402-unknown";
}

// v5.18.0: x402 accepts array builder. The Polygon accept stays byte-identical
// to the pre-v5.18.0 single accept (zero-diff while the flag is off). When
// BASE_ACCEPTS_ENABLED is "true", an equivalent Base accept is appended.
export function buildX402Accepts(
  polygonAccept: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const accepts: Array<Record<string, unknown>> = [polygonAccept];
  let baseEnabled = false;
  try {
    const deno = (globalThis as Record<string, unknown>)["Deno"] as
      | { env?: { get?: (k: string) => string | undefined } }
      | undefined;
    const flag = deno?.env?.get?.("BASE_ACCEPTS_ENABLED");
    baseEnabled = flag === "true" || flag === "1";
  } catch { /* flag off */ }
  if (baseEnabled) {
    const base = X402_CHAINS["eip155:8453"];
    accepts.push({
      scheme: "exact",
      network: base.network,
      asset: base.usdc_address,
      amount: polygonAccept.amount,
      payTo: X402_CONFIG.treasury,
      maxTimeoutSeconds: polygonAccept.maxTimeoutSeconds ?? 300,
      extra: {
        name: base.usdc_name,
        version: base.usdc_version,
        description: "Payment for Nexus Gateway services (Base)",
      },
    });
  }
  return accepts;
}

// -- Minimal ABIs -------------------------------------------------------------

const ERC3009_ABI = [
  "function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s) external",
  "function authorizationState(address authorizer,bytes32 nonce) external view returns (bytes32)",
  "function balanceOf(address account) external view returns (uint256)",
];

// The x402 payload signature is a single 65-byte hex string (r ‖ s ‖ v).
// USDC's transferWithAuthorization takes (v, r, s) separately — split them.
export function splitSignature65(sig: string): { v: number; r: string; s: string } {
  const hex = sig.replace(/^0x/, "");
  if (hex.length !== 130) {
    throw new Error(`signature must be 65 bytes (130 hex chars), got ${hex.length}`);
  }
  return {
    r: "0x" + hex.slice(0, 64),
    s: "0x" + hex.slice(64, 128),
    v: parseInt(hex.slice(128, 130), 16),
  };
}

// -- Types --------------------------------------------------------------------

export interface X402PaymentPayload {
  x402Version: number;
  resource?: { url?: string; description?: string; mimeType?: string };
  accepted?: Record<string, unknown>;
  payload?: {
    signature?: string;
    authorization?: {
      from?: string;
      to?: string;
      value?: string;
      validAfter?: string;
      validBefore?: string;
      nonce?: string;
    };
  };
  extensions?: Record<string, unknown>;
}

export interface X402VerifyResult {
  ok: boolean;
  error_code?: string;
  message?: string;
  payload?: X402PaymentPayload;
  payer?: string;
  amount_atomic?: string;
  nonce?: string;
  network?: string;
}

// -- Decode -------------------------------------------------------------------

export function decodePaymentSignatureHeader(headerValue: string): X402VerifyResult {
  try {
    // Handle "Bearer <b64>" and raw base64 forms
    const b64 = headerValue.replace(/^Bearer\s+/i, "").trim();
    const json = atob(b64);
    const parsed = JSON.parse(json) as X402PaymentPayload;
    if (!parsed || typeof parsed !== "object") {
      return { ok: false, error_code: "INVALID_PAYMENT_PAYLOAD", message: "Payload is not a JSON object." };
    }
    return { ok: true, payload: parsed };
  } catch {
    return { ok: false, error_code: "INVALID_PAYMENT_PAYLOAD", message: "PAYMENT-SIGNATURE header is not valid base64 JSON." };
  }
}

// -- Schema validation ---------------------------------------------------------

export function validatePaymentPayload(
  p: X402PaymentPayload,
  expectedPayTo: string,
): X402VerifyResult {
  if (p.x402Version !== 2 && p.x402Version !== 1) {
    return { ok: false, error_code: "UNSUPPORTED_X402_VERSION", message: `Unsupported x402Version: ${p.x402Version}` };
  }
  const accepted = p.accepted ?? {};
  const scheme = String(accepted["scheme"] ?? "");
  const network = String(accepted["network"] ?? "");
  const asset = String(accepted["asset"] ?? "");
  const payTo = String(accepted["payTo"] ?? "");
  const amount = String(accepted["amount"] ?? "");

  if (scheme !== "exact") {
    return { ok: false, error_code: "UNSUPPORTED_SCHEME", message: `Only 'exact' scheme accepted, got '${scheme}'.` };
  }
  const chain = getChainConfig(network);
  if (!X402_CHAINS[network.toLowerCase()]) {
    return { ok: false, error_code: "UNSUPPORTED_NETWORK", message: `Unsupported network '${network}'. Supported: ${Object.keys(X402_CHAINS).join(", ")}.` };
  }
  if (asset.toLowerCase() !== chain.usdc_address.toLowerCase()) {
    return { ok: false, error_code: "UNSUPPORTED_ASSET", message: `Only native USDC on ${chain.name} accepted.` };
  }
  if (payTo.toLowerCase() !== expectedPayTo.toLowerCase()) {
    return { ok: false, error_code: "WRONG_PAYEE", message: `payTo mismatch: expected ${expectedPayTo}.` };
  }
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return { ok: false, error_code: "INVALID_AMOUNT", message: `Invalid amount: ${amount}` };
  }

  const auth = p.payload?.authorization;
  if (!auth?.from || !auth?.to || !auth?.value || !auth?.validBefore || !auth?.nonce) {
    return { ok: false, error_code: "MISSING_AUTHORIZATION", message: "payload.authorization incomplete (need from,to,value,validBefore,nonce)." };
  }
  if (!p.payload?.signature) {
    return { ok: false, error_code: "MISSING_SIGNATURE", message: "payload.signature missing." };
  }
  if (auth.to.toLowerCase() !== expectedPayTo.toLowerCase()) {
    return { ok: false, error_code: "WRONG_PAYEE", message: "authorization.to is not the treasury." };
  }
  // Amount in accepts vs authorization.value must match
  if (BigInt(auth.value) !== BigInt(amount)) {
    return { ok: false, error_code: "AMOUNT_MISMATCH", message: "accepted.amount != authorization.value." };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const validAfter = Number(auth.validAfter ?? "0");
  const validBefore = Number(auth.validBefore);
  if (nowSec < validAfter) {
    return { ok: false, error_code: "AUTHORIZATION_NOT_YET_VALID", message: `validAfter in future (${validAfter}).` };
  }
  if (nowSec >= validBefore) {
    return { ok: false, error_code: "AUTHORIZATION_EXPIRED", message: `validBefore passed (${validBefore}).` };
  }
  return { ok: true, payer: auth.from, amount_atomic: auth.value, nonce: auth.nonce, network: chain.network };
}

// -- EIP-3009 signature verification (local, standard USDC domain) ------------

export function verifyEip3009Signature(
  p: X402PaymentPayload,
  chain: X402ChainConfig = getChainConfig("eip155:137"),
): X402VerifyResult {
  const auth = p.payload!.authorization!;
  const domain = {
    name: chain.usdc_name,
    version: chain.usdc_version,
    chainId: chain.chain_id,
    verifyingContract: chain.usdc_address,
  };
  const types = {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  };
  const message = {
    from: auth.from!,
    to: auth.to!,
    value: BigInt(auth.value!),
    validAfter: BigInt(auth.validAfter ?? "0"),
    validBefore: BigInt(auth.validBefore!),
    nonce: auth.nonce!,
  };
  try {
    const recovered = verifyTypedData(domain, types, message, p.payload!.signature!);
    if (recovered.toLowerCase() === auth.from!.toLowerCase()) {
      return { ok: true, payer: auth.from, amount_atomic: auth.value, nonce: auth.nonce, network: chain.network };
    }
    return {
      ok: false,
      error_code: "INVALID_SIGNATURE",
      message: `Signature recovers ${recovered}, expected ${auth.from}.`,
    };
  } catch (err) {
    return {
      ok: false,
      error_code: "SIGNATURE_VERIFY_FAILED",
      message: `verifyTypedData threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// -- Full verify pipeline (decode → schema → signature) -------------------------

export function verifyIncomingPayment(headerValue: string, expectedPayTo: string): X402VerifyResult {
  const decoded = decodePaymentSignatureHeader(headerValue);
  if (!decoded.ok) return decoded;
  const schema = validatePaymentPayload(decoded.payload!, expectedPayTo);
  if (!schema.ok) return schema;
  const sig = verifyEip3009Signature(decoded.payload!, getChainConfig(schema.network));
  if (!sig.ok) return sig;
  return { ...sig, payload: decoded.payload };
}

// -- Settlement (on-chain transferWithAuthorization via treasury wallet) -------

export interface SettlementResult {
  ok: boolean;
  tx_hash?: string;
  pending?: boolean;
  nonce_used?: boolean;
  error_code?: string;
  message?: string;
}

export async function settleTransferWithAuthorization(
  p: X402PaymentPayload,
  privateKey: string,
  chain: X402ChainConfig = getChainConfig("eip155:137"),
): Promise<SettlementResult> {
  const provider = new JsonRpcProvider(chain.rpc_url);
  const wallet = new Wallet(privateKey, provider);
  const usdc = new Contract(chain.usdc_address, ERC3009_ABI, wallet);
  const auth = p.payload!.authorization!;
  const sig = p.payload!.signature!;
  const { v, r, s } = splitSignature65(sig);

  // Authoritative anti-replay check: USDC's own authorizationState
  try {
    const state: string = await usdc.authorizationState(auth.from!, auth.nonce!);
    if (state !== "0x" + "00".repeat(32) && BigInt(state) !== 0n) {
      return { ok: false, nonce_used: true, error_code: "NONCE_ALREADY_USED", message: `authorizationState nonzero — nonce already used/cancelled.` };
    }
  } catch (err) {
    return { ok: false, error_code: "RPC_ERROR", message: `authorizationState check failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Griefing guard: payer must actually hold the USDC they signed away.
  // (EIP-3009 needs no allowance, but a signature from an empty wallet would
  // make our settlement tx revert and waste our gas.)
  try {
    const payerBalance: bigint = await usdc.balanceOf(auth.from!);
    if (payerBalance < BigInt(auth.value!)) {
      return { ok: false, error_code: "INSUFFICIENT_PAYER_BALANCE", message: `Payer holds ${payerBalance} atomic USDC, payment requires ${auth.value}.` };
    }
  } catch (err) {
    return { ok: false, error_code: "RPC_ERROR", message: `balanceOf check failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  try {
    const tx = await usdc.transferWithAuthorization(
      auth.from!,
      auth.to!,
      BigInt(auth.value!),
      BigInt(auth.validAfter ?? "0"),
      BigInt(auth.validBefore!),
      auth.nonce!,
      v, r, s,
      { gasLimit: 180_000 },
    );

    // Manual fast receipt polling (ethers' tx.wait() default poll interval is
    // too slow for the x402 client timeout). Polygon blocks are ~2s; poll
    // every 1.5s up to ~20s.
    const pollInterval = 1_500;
    const maxPolls = Math.floor(X402_CONFIG.max_settle_wait_ms * 1.5 / pollInterval); // ~20s ceiling
    for (let i = 0; i < maxPolls; i++) {
      await new Promise((resolve) => setTimeout(resolve, i === 0 ? 1_000 : pollInterval));
      const receipt = await provider.getTransactionReceipt(tx.hash);
      if (receipt) {
        if (receipt.status === 1) {
          return { ok: true, tx_hash: tx.hash };
        }
        return { ok: false, error_code: "SETTLEMENT_REVERTED", tx_hash: tx.hash, message: `Settlement tx reverted: ${tx.hash}` };
      }
    }
    // Submitted & broadcast but not yet confirmed — caller records a pending
    // marker and reconciles on the next request (idempotent by tx hash).
    return { ok: false, pending: true, tx_hash: tx.hash, error_code: "SETTLEMENT_PENDING", message: `Settlement tx ${tx.hash} submitted, confirmation pending.` };
  } catch (err) {
    return { ok: false, error_code: "SETTLEMENT_FAILED", message: err instanceof Error ? err.message : String(err) };
  }
}

// -- PAYMENT-RESPONSE header (SettlementResponse) -------------------------------

export function buildPaymentResponseHeader(
  txHash: string,
  network = "eip155:137",
  payer?: string,
): string {
  const settlement = {
    success: true,
    transaction: txHash,
    network,
    payer: payer ?? "",
    errorReason: "",
  };
  const bytes = new TextEncoder().encode(JSON.stringify(settlement));
  return btoa(String.fromCharCode(...bytes));
}
