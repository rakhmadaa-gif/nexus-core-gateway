// ============================================================================
// revenue_bell.ts — v5.18.0 Revenue Bell
// ============================================================================
// Fire-and-forget webhook to the operator's Letta agent whenever real revenue
// lands, so the agent wakes per-transaction instead of on a fixed schedule
// (quota-proportional: the bell is silent while revenue is $0, rings when
// dollars come in).
//
//   Triggers:
//     - m2mSuccess with credits_charged > 0  (any paid API call)
//     - x402 settlement credits              (pay-to-top-up rail)
//
// Non-fatal by design: a bell failure must NEVER affect the response. No-op
// when LETTA_WEBHOOK_URL / LETTA_WEBHOOK_SECRET edge secrets are absent.
// The receiving agent verifies the bell against the DB (revenue-pulse.py)
// before trusting its contents — the bell is a wake-up signal, not a ledger.
// ============================================================================

export interface RevenueBellEvent {
  source: "m2m_success" | "x402_settlement";
  service_type: string;
  credits_charged: number;
  client_id?: string | null;
  payer?: string | null;
  tx_hash?: string | null;
  network?: string | null;
  payload_id?: string | null;
}

export function notifyRevenueBell(event: RevenueBellEvent): Promise<void> {
  let url = "";
  let secret = "";
  try {
    const deno = (globalThis as Record<string, unknown>)["Deno"] as
      | { env?: { get?: (k: string) => string | undefined } }
      | undefined;
    url = deno?.env?.get?.("LETTA_WEBHOOK_URL") ?? "";
    secret = deno?.env?.get?.("LETTA_WEBHOOK_SECRET") ?? "";
  } catch { /* not configured */ }
  if (!url || !secret) return Promise.resolve(); // bell not configured — silent no-op

  const body = JSON.stringify({
    event: "revenue",
    source: event.source,
    service_type: event.service_type,
    credits_charged: event.credits_charged,
    client_id: event.client_id ?? null,
    payer: event.payer ?? null,
    tx_hash: event.tx_hash ?? null,
    network: event.network ?? null,
    payload_id: event.payload_id ?? null,
    secret, // agent-side authenticity check (only the gateway knows this)
    timestamp: new Date().toISOString(),
  });

  const p = fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Letta secured-webhook ingress expects Basic auth (base64 "webhook:<key>").
      "authorization": `Basic ${btoa(`webhook:${secret}`)}`,
      // Redundant custom header — agent-side authenticity check (spec v1.0).
      "x-nexus-webhook-secret": secret,
    },
    body,
  })
    .then((r) => r.text().then(() => undefined, () => undefined))
    .catch(() => undefined);

  // Attach to waitUntil when available (Supabase Edge Runtime) so the fetch
  // survives response completion; otherwise the promise floats (local tests
  // can await the returned promise directly).
  try {
    const runtime = (globalThis as Record<string, unknown>)["EdgeRuntime"] as
      | { waitUntil?: (p: Promise<unknown>) => void }
      | undefined;
    runtime?.waitUntil?.(p);
  } catch { /* no runtime */ }
  return p;
}
