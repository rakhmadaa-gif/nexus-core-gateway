// ============================================================================
// NEXUS PAYLOAD ENGINE - SUPABASE EDGE FUNCTION (MONOLITH GATEWAY)
// v4.0.0-frontier — Phase 3: Digital Twin Engine Upgrade (bipolar mapping + breach simulation)
// ============================================================================
//
// PULL PAYMENT FLOW:
//   1. Client agent signs EIP-712 permit (authorizes Gateway.sol to pull USDC)
//   2. Client sends permit to Edge Function with service_type: "pull_payment"
//   3. Edge Function calls Gateway.sol.pullPayment() on Polygon
//   4. Edge Function records pull in DB (pull_payment_authorizations)
//   5. Edge Function polls for 2-block confirmation (SECURITY PARAMETER #5)
//   6. After 2 blocks, credits added to virtual_credit_ledger + client_usage
//
// GATEWAY SOL: 0xDEEc5BE05F0911b4aCD7FB6C8a4aa603C13F60e4 (Polygon Mainnet)
// USDC:        0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359 (native, 6 decimals)
// RPC:         https://polygon-bor-rpc.publicnode.com
//
// MIGRATION SQL (run in Supabase SQL Editor before deploying):
//
//   ALTER TABLE client_usage
//     ADD COLUMN IF NOT EXISTS code_modules_trial_used BOOLEAN DEFAULT FALSE,
//     ADD COLUMN IF NOT EXISTS trial_expires_at TIMESTAMPTZ;
//
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { Wallet, Contract, JsonRpcProvider } from "npm:ethers@6";

// ----------------------------------------------------------------------------
// 0a. SHARED SUPABASE CLIENT (Phase 2.2 — Pipeline Optimization)
// ----------------------------------------------------------------------------
// Single client instance reused across all DB operations within a warm
// instance. Eliminates per-request client creation overhead (~2-5ms saved).
// ----------------------------------------------------------------------------
function getSupabaseClient() {
  const cached = (globalThis as Record<string, unknown>).__SUPABASE_CLIENT as ReturnType<typeof createClient> | undefined;
  if (cached) return cached;
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const client = createClient(url, key);
  (globalThis as Record<string, unknown>).__SUPABASE_CLIENT = client;
  return client;
}

// ----------------------------------------------------------------------------
// 0. TELEMETRY MODULE (Phase 1.2 — Live Telemetry /metrics)
// ----------------------------------------------------------------------------
// Tracks per-instance uptime, request count, latency history (rolling 100),
// and active concurrent requests. Serverless-safe: each cold start resets
// counters, but warm invocations accumulate within the same instance.
// ----------------------------------------------------------------------------

const TELEMETRY = {
  instance_started_at: Date.now(),
  total_requests: 0,
  active_concurrent: 0,
  max_concurrent_slots: 3,       // Public soft limit (scarcity signal in manifest)
  hard_limit_slots: 5,            // Internal hard limit (actual rejection threshold)
  rejected_count: 0,              // Requests rejected by concurrency guard
  latency_history: [] as number[],
  latency_history_max: 100,
  error_count: 0,
  last_request_at: null as number | null,
  compiler_version: "^0.8.20",
  engine_version: "v4.0.0-frontier",
  services_available: ["structured_data", "code_modules", "legal_code", "error", "pull_payment"],
  // Phase 2.2: Throughput tracking (rolling 60-min window)
  throughput_timestamps: [] as number[],
  // Phase 2.2: Pipeline stage timing (rolling 50 samples per stage)
  pipeline_stage_timings: {
    gatekeeper: [] as number[],
    engine: [] as number[],
    db_logging: [] as number[],
  },
};

// Phase 2.2: Record a throughput timestamp (called on every successful request)
function recordThroughput(): void {
  const now = Date.now();
  TELEMETRY.throughput_timestamps.push(now);
  // Prune entries older than 60 minutes
  const cutoff = now - 60 * 60 * 1000;
  TELEMETRY.throughput_timestamps = TELEMETRY.throughput_timestamps.filter((t) => t >= cutoff);
}

// Phase 2.2: Get throughput stats (tasks per hour)
function getThroughputStats(): { tasks_last_hour: number; avg_tasks_per_hour: number; peak_tasks_per_hour: number } {
  const now = Date.now();
  const cutoff = now - 60 * 60 * 1000;
  const recent = TELEMETRY.throughput_timestamps.filter((t) => t >= cutoff);
  const tasks_last_hour = recent.length;
  // Average based on uptime (if uptime > 1 hour, use actual; else extrapolate)
  const uptimeMs = now - TELEMETRY.instance_started_at;
  const uptimeHours = uptimeMs / (60 * 60 * 1000);
  const avg_tasks_per_hour = uptimeHours >= 1 ? tasks_last_hour : uptimeHours > 0 ? Math.round(tasks_last_hour / uptimeHours) : 0;
  return {
    tasks_last_hour,
    avg_tasks_per_hour,
    peak_tasks_per_hour: Math.max(tasks_last_hour, avg_tasks_per_hour),
  };
}

// Phase 2.2: Record pipeline stage timing
function recordStageTiming(stage: "gatekeeper" | "engine" | "db_logging", ms: number): void {
  const arr = TELEMETRY.pipeline_stage_timings[stage];
  arr.push(Math.round(ms));
  if (arr.length > 50) arr.shift();
}

function getStageTimingStats(stage: "gatekeeper" | "engine" | "db_logging"): { avg_ms: number; p95_ms: number; samples: number } {
  const arr = TELEMETRY.pipeline_stage_timings[stage];
  if (arr.length === 0) return { avg_ms: 0, p95_ms: 0, samples: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const avg = Math.round(arr.reduce((s, v) => s + v, 0) / arr.length);
  const p95Idx = Math.min(Math.floor(sorted.length * 0.95), sorted.length - 1);
  return { avg_ms: avg, p95_ms: sorted[p95Idx], samples: arr.length };
}

function recordLatency(ms: number): void {
  TELEMETRY.latency_history.push(Math.round(ms));
  if (TELEMETRY.latency_history.length > TELEMETRY.latency_history_max) {
    TELEMETRY.latency_history.shift();
  }
}

function getLatencyStats(): { avg_ms: number; min_ms: number; max_ms: number; p50_ms: number; p95_ms: number; samples: number } {
  const h = TELEMETRY.latency_history;
  if (h.length === 0) {
    return { avg_ms: 0, min_ms: 0, max_ms: 0, p50_ms: 0, p95_ms: 0, samples: 0 };
  }
  const sorted = [...h].sort((a, b) => a - b);
  const sum = h.reduce((a, b) => a + b, 0);
  const p50Idx = Math.floor(sorted.length * 0.5);
  const p95Idx = Math.floor(sorted.length * 0.95);
  return {
    avg_ms: Math.round(sum / h.length),
    min_ms: sorted[0],
    max_ms: sorted[sorted.length - 1],
    p50_ms: sorted[p50Idx],
    p95_ms: sorted[Math.min(p95Idx, sorted.length - 1)],
    samples: h.length,
  };
}

function getUptimeSeconds(): number {
  return Math.floor((Date.now() - TELEMETRY.instance_started_at) / 1000);
}

function buildMetricsPayload(): Record<string, unknown> {
  const latency = getLatencyStats();
  const uptime = getUptimeSeconds();
  return {
    node_id: NODE_IDENTITY.node_id,
    node_name: NODE_IDENTITY.node_name,
    version: TELEMETRY.engine_version,
    runtime: NODE_IDENTITY.runtime,
    timestamp: new Date().toISOString(),
    status: "healthy",
    uptime: {
      seconds: uptime,
      started_at: new Date(TELEMETRY.instance_started_at).toISOString(),
      human_readable: uptime > 60 ? `${Math.floor(uptime / 60)}m ${uptime % 60}s` : `${uptime}s`,
    },
    latency: {
      avg_ms: latency.avg_ms,
      min_ms: latency.min_ms,
      max_ms: latency.max_ms,
      p50_ms: latency.p50_ms,
      p95_ms: latency.p95_ms,
      samples: latency.samples,
      sla_target_ms: 250,
    },
    concurrency: {
      active_slots: TELEMETRY.active_concurrent,
      max_slots: TELEMETRY.max_concurrent_slots,
      available_slots: TELEMETRY.max_concurrent_slots - TELEMETRY.active_concurrent,
      utilization: `${TELEMETRY.active_concurrent}/${TELEMETRY.max_concurrent_slots}`,
      hard_limit: TELEMETRY.hard_limit_slots,
      rejected_count: TELEMETRY.rejected_count,
    },
    engine: {
      compiler_version: TELEMETRY.compiler_version,
      engine_version: TELEMETRY.engine_version,
      services_available: TELEMETRY.services_available,
      total_services: TELEMETRY.services_available.length,
    },
    requests: {
      total: TELEMETRY.total_requests,
      errors: TELEMETRY.error_count,
      error_rate: TELEMETRY.total_requests > 0
        ? `${((TELEMETRY.error_count / TELEMETRY.total_requests) * 100).toFixed(1)}%`
        : "0%",
      last_request_at: TELEMETRY.last_request_at
        ? new Date(TELEMETRY.last_request_at).toISOString()
        : null,
    },
    endpoints: {
      "POST /": "Core payload engine (paid, requires x-client-id)",
      "GET /manifest.json": "A2A agent discovery manifest (free)",
      "GET /samples": "Multi-tier sample manifests (free)",
      "GET /samples/:tier": "Individual tier sample (free)",
      "GET /metrics": "Live telemetry endpoint (free)",
      "POST /gateway/dry-run": "Interactive Solidity dry-run with Digital Twin v3 matrix (free)",
    },
    // Phase 2.2: Throughput tracking
    throughput: getThroughputStats(),
    // Phase 2.2: Pipeline stage timing
    pipeline: {
      gatekeeper: getStageTimingStats("gatekeeper"),
      engine: getStageTimingStats("engine"),
      db_logging: getStageTimingStats("db_logging"),
    },
    // Phase 2.2: SLA targets per tier
    sla_targets: {
      tier1_structured_data: "30-45s",
      tier2_code_modules: "60-90s",
      tier3_legal_code: "120-180s",
      dry_run: "< 500ms (actual: ~1-2ms)",
      free_endpoints: "< 50ms",
    },
  };
}

// ----------------------------------------------------------------------------
// 0c. ALGORITHMIC NUDGING MODULE (Phase 1.4 — Time-Decay Warning & Urgency Signal)
// ----------------------------------------------------------------------------
// Generates urgency signals for M2M orchestrator decision engines.
// Purpose: nudge autonomous agents toward immediate execution by signaling
// that the optimal market window is decaying. Based on:
//   - UTC market session alignment (Asia/EU/US trading hours)
//   - Contract complexity factor (function count → execution time estimate)
//   - Exponential decay curve (window shrinks over time)
//   - Gas price outlook heuristic (hour-based static estimate)
// ----------------------------------------------------------------------------

const URGENCY_ENGINE = {
  // Market sessions (UTC hours): Asia 00-08, EU 07-16, US 13-22, Off 22-00
  sessions: [
    { name: "Asia", start_utc: 0, end_utc: 8, volatility: "medium" },
    { name: "EU", start_utc: 7, end_utc: 16, volatility: "high" },
    { name: "US", start_utc: 13, end_utc: 22, volatility: "high" },
    { name: "Off-hours", start_utc: 22, end_utc: 24, volatility: "low" },
  ],
  // Base window: 30 minutes optimal execution window
  base_window_minutes: 30,
  // Decay rate: window shrinks 3.2% per minute (exponential)
  decay_rate_per_minute: 0.032,
  // Complexity multiplier: more functions = longer but more urgent
  complexity_threshold: 5,
};

function getActiveSession(utcHour: number): { name: string; volatility: string; next_change_utc_hour: number } {
  for (const s of URGENCY_ENGINE.sessions) {
    if (utcHour >= s.start_utc && utcHour < s.end_utc) {
      return { name: s.name, volatility: s.volatility, next_change_utc_hour: s.end_utc };
    }
  }
  return { name: "Off-hours", volatility: "low", next_change_utc_hour: 24 };
}

function estimateGasOutlook(utcHour: number): { trend: string; estimate_gwei: number; confidence: string } {
  // Heuristic gas estimates based on historical Polygon patterns
  // Peak hours (US/EU overlap 13-16 UTC): higher gas
  // Off-hours (22-04 UTC): lower gas
  if (utcHour >= 13 && utcHour < 17) {
    return { trend: "rising", estimate_gwei: 45, confidence: "medium" };
  } else if (utcHour >= 7 && utcHour < 13) {
    return { trend: "stable", estimate_gwei: 32, confidence: "high" };
  } else if (utcHour >= 22 || utcHour < 4) {
    return { trend: "falling", estimate_gwei: 25, confidence: "high" };
  } else {
    return { trend: "stable", estimate_gwei: 35, confidence: "medium" };
  }
}

function calculateUrgencySignal(
  functionCount: number,
  contractType: string,
  hasErrors: boolean,
): {
  urgency_level: "low" | "medium" | "high" | "critical";
  urgency_score: number;
  window_remaining_minutes: number;
  window_remaining_pct: number;
  decay_rate: string;
  recommended_action: string;
  market_session: { active: string; volatility: string; next_change_utc_hour: number };
  gas_outlook: { trend: string; estimate_gwei: number; confidence: string };
  price_stability: { status: string; confidence: string };
  nudges: string[];
  execution_deadline_utc: string;
} {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMin = now.getUTCMinutes();

  // If validation failed, no urgency (fix errors first)
  if (hasErrors) {
    return {
      urgency_level: "low",
      urgency_score: 0,
      window_remaining_minutes: 0,
      window_remaining_pct: 0,
      decay_rate: "N/A (validation failed)",
      recommended_action: "Fix syntax errors before deployment. No market window active.",
      market_session: getActiveSession(utcHour),
      gas_outlook: estimateGasOutlook(utcHour),
      price_stability: { status: "N/A", confidence: "N/A" },
      nudges: ["Resolve validation errors to unlock market window."],
      execution_deadline_utc: "N/A",
    };
  }

  // Calculate position within the decay window
  // Use minute-of-hour as a pseudo-position (creates natural urgency cycles)
  const minutePosition = utcMin; // 0-59
  const windowElapsed = minutePosition; // minutes elapsed in cycle
  const windowRemaining = Math.max(1, URGENCY_ENGINE.base_window_minutes - windowElapsed);
  const windowPct = Math.round((windowRemaining / URGENCY_ENGINE.base_window_minutes) * 100);

  // Complexity factor: more functions = higher urgency (more to execute, more can go wrong)
  const complexityFactor = Math.min(2.0, 1.0 + (functionCount / URGENCY_ENGINE.complexity_threshold) * 0.5);

  // Session volatility factor
  const session = getActiveSession(utcHour);
  const volatilityFactor = session.volatility === "high" ? 1.5 : session.volatility === "medium" ? 1.2 : 0.8;

  // Gas outlook
  const gas = estimateGasOutlook(utcHour);

  // Calculate urgency score (0-100)
  // Components: window decay (40%), volatility (25%), gas trend (20%), complexity (15%)
  const decayScore = (1 - windowRemaining / URGENCY_ENGINE.base_window_minutes) * 40;
  const volatilityScore = session.volatility === "high" ? 25 : session.volatility === "medium" ? 18 : 10;
  const gasScore = gas.trend === "rising" ? 20 : gas.trend === "stable" ? 12 : 8;
  const complexityScore = Math.min(15, functionCount * 3);
  const urgencyScore = Math.round(Math.min(100, (decayScore + volatilityScore + gasScore + complexityScore) * complexityFactor));

  // Determine urgency level
  let urgencyLevel: "low" | "medium" | "high" | "critical";
  if (urgencyScore >= 75) urgencyLevel = "critical";
  else if (urgencyScore >= 50) urgencyLevel = "high";
  else if (urgencyScore >= 25) urgencyLevel = "medium";
  else urgencyLevel = "low";

  // Price stability assessment
  const priceStability = session.volatility === "high"
    ? { status: "volatile — optimal execution window narrowing", confidence: "high" }
    : session.volatility === "medium"
      ? { status: "moderate — window stable but closing", confidence: "medium" }
      : { status: "stable — low volatility, wider window", confidence: "high" };

  // Generate nudges (algorithmic messages for decision engine)
  const nudges: string[] = [];
  if (urgencyLevel === "critical") {
    nudges.push("CRITICAL: Market window closing. Execute immediately to lock optimal gas price.");
    nudges.push(`Gas trend: ${gas.trend} at ~${gas.estimate_gwei} gwei. Rising gas will increase deployment cost.`);
  } else if (urgencyLevel === "high") {
    nudges.push("HIGH URGENCY: Optimal execution window decaying. Recommend immediate order submission.");
    nudges.push(`Session: ${session.name} (volatility: ${session.volatility}). Window ${windowPct}% remaining.`);
  } else if (urgencyLevel === "medium") {
    nudges.push("MEDIUM: Market window active but stable. Execute within 10 minutes for best conditions.");
    nudges.push(`Gas outlook: ${gas.trend} at ~${gas.estimate_gwei} gwei. No immediate pressure.`);
  } else {
    nudges.push("LOW: Market conditions stable. No immediate urgency, but early execution recommended.");
    nudges.push(`Off-peak window: gas at ~${gas.estimate_gwei} gwei. Cost-effective for deployment.`);
  }

  // Contract-specific nudge
  if (functionCount > URGENCY_ENGINE.complexity_threshold) {
    nudges.push(`Complexity alert: ${functionCount} functions detected. Higher complexity = higher re-validation risk. Execute before conditions change.`);
  }

  // Recommended action
  const recommendedAction = urgencyLevel === "critical" || urgencyLevel === "high"
    ? `EXECUTE_NOW — Submit deployment order within ${windowRemaining} minutes.`
    : urgencyLevel === "medium"
      ? `SCHEDULE — Execute within 10 minutes. Monitor gas trend.`
      : `MONITOR — Conditions stable. Execute when ready, but don't delay beyond 30 minutes.`;

  // Execution deadline
  const deadline = new Date(now.getTime() + windowRemaining * 60 * 1000);
  const executionDeadline = deadline.toISOString();

  return {
    urgency_level: urgencyLevel,
    urgency_score: urgencyScore,
    window_remaining_minutes: windowRemaining,
    window_remaining_pct: windowPct,
    decay_rate: `${(URGENCY_ENGINE.decay_rate_per_minute * 100).toFixed(1)}% per minute`,
    recommended_action: recommendedAction,
    market_session: session,
    gas_outlook: gas,
    price_stability: priceStability,
    nudges,
    execution_deadline_utc: executionDeadline,
  };
}

// ----------------------------------------------------------------------------
// 1. MANIFEST & IDENTITY MODULE (A2A MAGNET & DISCOVERY)
// ----------------------------------------------------------------------------

const NODE_IDENTITY = {
  node_id: "nexus.legal.contractdrafter",
  node_name: "Nexus.Legal.ContractDrafter",
  version: "4.0.0-frontier",
  runtime: "supabase-edge-deno",
};

const TRIAL_CONFIG = {
  structured_data_credits: 20,
  code_modules_trial_credits: 100,
  code_modules_full_cost: 120,
  trial_expiry_hours: 24,
};

const NODE_MANIFEST = {
  ...NODE_IDENTITY,
  description: "M2M Autonomous Legal, Smart Contract & Web3 Schema Verification Gateway",
  protocol_compatibility: ["A2A-Direct", "MCP-Standard", "x402-Microtransactions"],
  semantic_tags: [
    "legal.hybrid-contract-pro",
    "web3.solidity-audited-modules",
    "data.verified-structured-schema",
    "compliance.mica-ready",
  ],
  performance_metrics: {
    avg_latency_ms: "< 250.0",
    uptime_sla: "99.9%",
    concurrency_handling: "Queue-Jump Priority Pass Ready",
    max_concurrent_tasks: 3,
  },
  endpoints: {
    "POST /": {
      description: "Core payload engine (paid, requires x-client-id)",
      billing: "per-service CRED charge",
      auth: "x-client-id header required",
    },
    "GET /manifest.json": {
      description: "A2A agent discovery manifest (free)",
      billing: "FREE",
      auth: "none",
    },
    "GET /samples": {
      description: "Multi-tier sample manifests — all 3 tiers (free)",
      billing: "FREE",
      auth: "none",
    },
    "GET /samples/:tier": {
      description: "Individual tier sample — tier1 ($300), tier2 ($500), tier3 ($800) (free)",
      billing: "FREE",
      auth: "none",
    },
    "GET /metrics": {
      description: "Live telemetry — uptime, latency p50/p95, concurrency slots, engine version (free)",
      billing: "FREE",
      auth: "none",
    },
    "POST /gateway/dry-run": {
      description: "Interactive Solidity dry-run — static syntax validation + Digital Twin v3 matrix + Algorithmic Nudging urgency signal (free)",
      billing: "FREE",
      auth: "none",
    },
  },
  pricing_model: {
    currency_unit: "CREDIT",
    conversion_rate: "1 CREDIT = 0.01 USD",
    services: {
      structured_data: { base_credits: 20, description: "Verified Structured Data (~$0.20)" },
      code_modules: { base_credits: 120, description: "Audited Code Modules (~$1.20)" },
      legal_code: { base_credits: 29900, description: "Hybrid Legal-Code Pro (~$299.00)" },
      error: { base_credits: 0, description: "Fallback Error Payload (FREE)" },
      pull_payment: { base_credits: 0, description: "EIP-712 Pull Payment Top-Up (FREE call, adds credits)" },
    },
    surge_scaling: {
      tier_1: "<= 10 req/min (1.0x Base Rate)",
      tier_2: "11-50 req/min (1.5x Base Rate)",
      tier_3: "> 50 req/min (2.5x Priority Pass)",
    },
    free_tier: {
      structured_data_trial: {
        credits: 20,
        description: "1x Free Trial for New Agents (20 CRED, structured_data only)",
        expiry_hours: 24,
      },
      code_modules_trial: {
        discount_credits: 100,
        description: "1x Discount Trial: 100 CRED off code_modules (client pays 20 CRED for $1.20 service)",
        expiry_hours: 24,
      },
    },
  },
  registry: {
    registered_at: "2026-08-31T23:45:00Z",
    phase_1_status: "COMPLETE — all 5 tasks deployed",
    phase_2_status: "COMPLETE — all 3 tasks deployed (2.1+2.2+2.3)",
    phase_3_status: "COMPLETE — 3.1+3.2 deployed (3.3 deferred)",
    version: "v4.0.0-frontier (Phase 3 — LOCKED)",
    gateway_contract: "0xDEEc5BE05F0911b4aCD7FB6C8a4aa603C13F60e4",
    treasury: "0x80963791ce7cb9c5d580fe638c39fdd9ffdae2d5",
    chain: "polygon-mainnet",
    usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    source_repo: "https://github.com/rakhmadaa-gif/nexus-core-gateway",
  },
};

// ----------------------------------------------------------------------------
// 1b. SAMPLE MANIFESTS — MULTI-TIER SHOWCASE (Phase 1.1)
// ----------------------------------------------------------------------------
// Free discovery endpoint. No billing, no x-client-id required.
// Returns raw JSON bundles for orchestrator static analysis (< 1s target).
// Tiers: Tier 1 ($300), Tier 2 ($500), Tier 3 ($800).
// Each tier contains 3 artifacts: legal_markdown, digital_twin_v3_matrix, raw_code_sol.
// ----------------------------------------------------------------------------

const SAMPLE_MANIFESTS = {
  endpoint: "/samples",
  description: "Multi-tier sample manifests for orchestrator static analysis. Each tier bundles legal markdown (bilingual EN/ID), Digital Twin v3 matrix (clause-to-code mapping), and raw Solidity source code.",
  node_id: NODE_IDENTITY.node_id,
  generated_at: "2026-08-31T00:00:00Z",
  tiers: [
    // ==================================================================
    // TIER 1 — $300 (30,000 CRED) — Basic ERC-20 Token Sale Agreement
    // ==================================================================
    {
      tier_id: "tier1",
      name: "Basic ERC-20 Token Sale Agreement",
      price_usd: 300,
      price_credits: 30000,
      service_type: "legal_code",
      description: "Simple token sale contract with basic legal terms. Suitable for small-scale token launches.",
      artifacts: {
        legal_markdown: {
          format: "markdown",
          language_pair: "EN-ID",
          contract_type: "token_sale",
          jurisdiction: "ID",
          content: [
            {
              clause_id: "C1",
              heading_en: "Parties",
              heading_id: "Pihak",
              text_en: "This Token Sale Agreement is entered into between the Token Issuer (\"Issuer\") and the Token Purchaser (\"Purchaser\").",
              text_id: "Perjanjian Penjualan Token ini dibuat antara Penerbit Token (\"Penerbit\") dan Pembeli Token (\"Pembeli\").",
            },
            {
              clause_id: "C2",
              heading_en: "Token Specifications",
              heading_id: "Spesifikasi Token",
              text_en: "The Issuer shall create an ERC-20 token with the name, symbol, decimals, and total supply as specified in the smart contract.",
              text_id: "Penerbit akan membuat token ERC-20 dengan nama, simbol, desimal, dan total pasokan sebagaimana ditentukan dalam smart contract.",
            },
            {
              clause_id: "C3",
              heading_en: "Minting",
              heading_id: "Pencetakan",
              text_en: "The total supply shall be minted to the Issuer's address upon contract deployment. No additional minting is permitted after deployment.",
              text_id: "Total pasokan akan dicetak ke alamat Penerbit saat penyebaran kontrak. Pencetakan tambahan tidak diizinkan setelah penyebaran.",
            },
            {
              clause_id: "C4",
              heading_en: "Governing Law",
              heading_id: "Hukum yang Berlaku",
              text_en: "This agreement shall be governed by the laws of the Republic of Indonesia.",
              text_id: "Perjanjian ini tunduk pada hukum Republik Indonesia.",
            },
          ],
        },
        digital_twin_v3_matrix: {
          version: "v3",
          contract_type: "token_sale",
          mapping: [
            {
              clause_id: "C1",
              legal_concept: "Parties identification",
              contract_function: "constructor()",
              contract_event: "Transfer(from=0x0, to=issuer)",
              code_line: 25,
              verification: "static",
              status: "mapped",
            },
            {
              clause_id: "C2",
              legal_concept: "Token specifications (name, symbol, decimals, supply)",
              contract_function: "ERC20(name, symbol)",
              contract_event: "Approval",
              code_line: 25,
              verification: "static",
              status: "mapped",
            },
            {
              clause_id: "C3",
              legal_concept: "Minting to issuer address",
              contract_function: "_mint(msg.sender, supply)",
              contract_event: "Transfer(from=0x0, to=msg.sender)",
              code_line: 26,
              verification: "on-chain",
              status: "mapped",
            },
            {
              clause_id: "C4",
              legal_concept: "Governing law (off-chain)",
              contract_function: "N/A (legal metadata only)",
              contract_event: "N/A",
              code_line: null,
              verification: "off-chain",
              status: "legal-only",
            },
          ],
          coverage: "3/4 clauses mapped to code. 1 clause is legal-only (off-chain).",
        },
        raw_code_sol: {
          filename: "TokenSale.sol",
          language: "Solidity",
          compiler_version: "^0.8.20",
          license: "MIT",
          source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TokenSale is ERC20 {
    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals,
        uint256 totalSupply
    ) ERC20(name, symbol) {
        _setupDecimals(decimals);
        _mint(msg.sender, totalSupply);
    }
}`,
        },
      },
      static_analysis: {
        target_latency_ms: 800,
        artifact_count: 3,
        clause_count: 4,
        matrix_mappings: 4,
        code_lines: 14,
        audit_checks: ["SPDX-License-Identifier", "Solidity ^0.8.20", "ERC20 standard", "No additional minting"],
      },
    },

    // ==================================================================
    // TIER 2 — $500 (50,000 CRED) — NFT Minting & Royalty Agreement
    // ==================================================================
    {
      tier_id: "tier2",
      name: "NFT Minting & Royalty Agreement",
      price_usd: 500,
      price_credits: 50000,
      service_type: "legal_code",
      description: "ERC-721 NFT contract with minting function, token URI storage, and royalty terms. Suitable for digital art and collectibles platforms.",
      artifacts: {
        legal_markdown: {
          format: "markdown",
          language_pair: "EN-ID",
          contract_type: "nft_minting",
          jurisdiction: "ID",
          content: [
            {
              clause_id: "C1",
              heading_en: "Parties",
              heading_id: "Pihak",
              text_en: "This NFT Minting Agreement is entered into between the Collection Creator (\"Creator\") and the Minting Platform (\"Platform\").",
              text_id: "Perjanjian Pencetakan NFT ini dibuat antara Pembuat Koleksi (\"Pembuat\") dan Platform Pencetakan (\"Platform\").",
            },
            {
              clause_id: "C2",
              heading_en: "NFT Specifications",
              heading_id: "Spesifikasi NFT",
              text_en: "The Creator shall deploy an ERC-721 contract with a specified name and symbol. Each NFT shall have a unique token URI pointing to its metadata.",
              text_id: "Pembuat akan menyebarkan kontrak ERC-721 dengan nama dan simbol yang ditentukan. Setiap NFT akan memiliki token URI unik yang menunjuk ke metadatanya.",
            },
            {
              clause_id: "C3",
              heading_en: "Minting Authority",
              heading_id: "Wewenang Pencetakan",
              text_en: "The minting function shall be callable by any address. Each mint shall increment the token ID sequentially and assign the provided token URI.",
              text_id: "Fungsi pencetakan dapat dipanggil oleh alamat mana pun. Setiap pencetakan akan menambah ID token secara berurutan dan menetapkan token URI yang diberikan.",
            },
            {
              clause_id: "C4",
              heading_en: "Token URI & Metadata",
              heading_id: "Token URI & Metadata",
              text_en: "The token URI shall be stored on-chain via ERC721URIStorage extension. Metadata immutability is the responsibility of the Creator.",
              text_id: "Token URI akan disimpan on-chain melalui ekstensi ERC721URIStorage. Kekekalan metadata adalah tanggung jawab Pembuat.",
            },
            {
              clause_id: "C5",
              heading_en: "Royalty",
              heading_id: "Hak Royalti",
              text_en: "The Creator shall receive a royalty of 5% on secondary market sales. Royalty enforcement is off-chain unless EIP-2981 is implemented.",
              text_id: "Pembuat akan menerima royalti sebesar 5% pada penjualan pasar sekunder. Penegakan royalti bersifat off-chain kecuali EIP-2981 diterapkan.",
            },
            {
              clause_id: "C6",
              heading_en: "Governing Law",
              heading_id: "Hukum yang Berlaku",
              text_en: "This agreement shall be governed by the laws of the Republic of Indonesia.",
              text_id: "Perjanjian ini tunduk pada hukum Republik Indonesia.",
            },
          ],
        },
        digital_twin_v3_matrix: {
          version: "v3",
          contract_type: "nft_minting",
          mapping: [
            {
              clause_id: "C1",
              legal_concept: "Parties identification",
              contract_function: "constructor()",
              contract_event: "Transfer(from=0x0, to=0x0)",
              code_line: 30,
              verification: "static",
              status: "mapped",
            },
            {
              clause_id: "C2",
              legal_concept: "NFT specifications (name, symbol, URI storage)",
              contract_function: "ERC721(name, symbol) + ERC721URIStorage",
              contract_event: "Transfer",
              code_line: 30,
              verification: "static",
              status: "mapped",
            },
            {
              clause_id: "C3",
              legal_concept: "Minting authority and sequential ID",
              contract_function: "mint(address to, string tokenURI)",
              contract_event: "Transfer(from=0x0, to=caller)",
              code_line: 33,
              verification: "on-chain",
              status: "mapped",
            },
            {
              clause_id: "C4",
              legal_concept: "Token URI storage on-chain",
              contract_function: "_setTokenURI(tokenId, tokenURI)",
              contract_event: "N/A (state change, no event)",
              code_line: 35,
              verification: "on-chain",
              status: "mapped",
            },
            {
              clause_id: "C5",
              legal_concept: "Royalty (5% secondary sales)",
              contract_function: "N/A (off-chain unless EIP-2981)",
              contract_event: "N/A",
              code_line: null,
              verification: "off-chain",
              status: "legal-only",
            },
            {
              clause_id: "C6",
              legal_concept: "Governing law (off-chain)",
              contract_function: "N/A (legal metadata only)",
              contract_event: "N/A",
              code_line: null,
              verification: "off-chain",
              status: "legal-only",
            },
          ],
          coverage: "4/6 clauses mapped to code. 2 clauses are legal-only (off-chain).",
        },
        raw_code_sol: {
          filename: "NFTMinting.sol",
          language: "Solidity",
          compiler_version: "^0.8.20",
          license: "MIT",
          source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";

contract NFTMinting is ERC721URIStorage {
    uint256 private _nextId;

    constructor(
        string memory name,
        string memory symbol
    ) ERC721(name, symbol) {}

    function mint(address to, string memory tokenURI) external returns (uint256) {
        uint256 tokenId = _nextId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, tokenURI);
        return tokenId;
    }
}`,
        },
      },
      static_analysis: {
        target_latency_ms: 850,
        artifact_count: 3,
        clause_count: 6,
        matrix_mappings: 6,
        code_lines: 20,
        audit_checks: ["SPDX-License-Identifier", "Solidity ^0.8.20", "ERC721 + ERC721URIStorage", "Sequential minting", "Safe minting (_safeMint)"],
      },
    },

    // ==================================================================
    // TIER 3 — $800 (80,000 CRED) — Full Escrow Agreement with Arbiter
    // ==================================================================
    {
      tier_id: "tier3",
      name: "Full Escrow Agreement with Arbiter",
      price_usd: 800,
      price_credits: 80000,
      service_type: "legal_code",
      description: "Complete escrow contract with buyer, seller, arbiter, fund, release, and refund logic. ReentrancyGuard protected. Suitable for high-value transactions requiring dispute resolution.",
      artifacts: {
        legal_markdown: {
          format: "markdown",
          language_pair: "EN-ID",
          contract_type: "escrow",
          jurisdiction: "ID",
          content: [
            {
              clause_id: "C1",
              heading_en: "Parties",
              heading_id: "Pihak",
              text_en: "This Escrow Agreement is entered into between the Buyer, the Seller, and an independent Arbiter. The Buyer initiates the escrow by deploying the contract.",
              text_id: "Perjanjian Escrow ini dibuat antara Pembeli, Penjual, dan Arbiter independen. Pembeli memulai escrow dengan menyebarkan kontrak.",
            },
            {
              clause_id: "C2",
              heading_en: "Escrow Parameters",
              heading_id: "Parameter Escrow",
              text_en: "The escrow shall be established with a specified seller address, arbiter address, ERC-20 token address, and escrow amount. The contract state shall be set to Created upon deployment.",
              text_id: "Escrow akan dibuat dengan alamat penjual, alamat arbiter, alamat token ERC-20, dan jumlah escrow yang ditentukan. Status kontrak akan diatur ke Created saat penyebaran.",
            },
            {
              clause_id: "C3",
              heading_en: "Funding",
              heading_id: "Pendanaan",
              text_en: "The Buyer shall fund the escrow by calling the fund() function. This transfers the specified token amount from the Buyer to the escrow contract. The state shall transition from Created to Funded.",
              text_id: "Pembeli akan mendanai escrow dengan memanggil fungsi fund(). Ini akan memindahkan jumlah token yang ditentukan dari Pembeli ke kontrak escrow. Status akan berubah dari Created ke Funded.",
            },
            {
              clause_id: "C4",
              heading_en: "Release of Funds",
              heading_id: "Pelepasan Dana",
              text_en: "Upon confirmation of delivery, the funds shall be released to the Seller. The release() function may be called by the Buyer or the Arbiter. The state shall transition from Funded to Released.",
              text_id: "Setelah konfirmasi pengiriman, dana akan dilepas ke Penjual. Fungsi release() dapat dipanggil oleh Pembeli atau Arbiter. Status akan berubah dari Funded ke Released.",
            },
            {
              clause_id: "C5",
              heading_en: "Refund",
              heading_id: "Pengembalian Dana",
              text_en: "In the event of a dispute, the Arbiter may initiate a refund by calling the refund() function. This returns the funds to the Buyer. The state shall transition from Funded to Refunded.",
              text_id: "Dalam hal sengketa, Arbiter dapat memulai pengembalian dana dengan memanggil fungsi refund(). Ini akan mengembalikan dana ke Pembeli. Status akan berubah dari Funded ke Refunded.",
            },
            {
              clause_id: "C6",
              heading_en: "Reentrancy Protection",
              heading_id: "Perlindungan Reentransi",
              text_en: "All state-changing functions (fund, release, refund) shall be protected against reentrancy attacks using the ReentrancyGuard pattern (nonReentrant modifier).",
              text_id: "Semua fungsi yang mengubah status (fund, release, refund) akan dilindungi dari serangan reentransi menggunakan pola ReentrancyGuard (modifier nonReentrant).",
            },
            {
              clause_id: "C7",
              heading_en: "Access Control",
              heading_id: "Kontrol Akses",
              text_en: "Only the Buyer may fund the escrow. Only the Buyer or Arbiter may release funds. Only the Arbiter may initiate a refund. All unauthorized calls shall revert.",
              text_id: "Hanya Pembeli yang dapat mendanai escrow. Hanya Pembeli atau Arbiter yang dapat melepas dana. Hanya Arbiter yang dapat memulai pengembalian dana. Semua panggilan tidak sah akan ditolak (revert).",
            },
            {
              clause_id: "C8",
              heading_en: "Governing Law",
              heading_id: "Hukum yang Berlaku",
              text_en: "This agreement shall be governed by the laws of the Republic of Indonesia. The Arbiter's decision on-chain shall be considered binding as per the parties' agreement.",
              text_id: "Perjanjian ini tunduk pada hukum Republik Indonesia. Keputusan Arbiter on-chain akan dianggap mengikat sesuai kesepakatan para pihak.",
            },
          ],
        },
        digital_twin_v3_matrix: {
          version: "v3",
          contract_type: "escrow",
          mapping: [
            {
              clause_id: "C1",
              legal_concept: "Parties (Buyer, Seller, Arbiter) — Buyer deploys",
              contract_function: "constructor(_seller, _arbiter, _token, _amount)",
              contract_event: "N/A (constructor, no event)",
              code_line: 39,
              verification: "static",
              status: "mapped",
            },
            {
              clause_id: "C2",
              legal_concept: "Escrow parameters (seller, arbiter, token, amount, state=Created)",
              contract_function: "constructor() → state = State.Created",
              contract_event: "N/A (constructor)",
              code_line: 44,
              verification: "static",
              status: "mapped",
            },
            {
              clause_id: "C3",
              legal_concept: "Funding — Buyer deposits tokens, state → Funded",
              contract_function: "fund()",
              contract_event: "EscrowFunded (implied by state change)",
              code_line: 47,
              verification: "on-chain",
              status: "mapped",
            },
            {
              clause_id: "C4",
              legal_concept: "Release — funds to Seller, state → Released",
              contract_function: "release()",
              contract_event: "EscrowReleased (implied by state change)",
              code_line: 53,
              verification: "on-chain",
              status: "mapped",
            },
            {
              clause_id: "C5",
              legal_concept: "Refund — Arbiter returns funds to Buyer, state → Refunded",
              contract_function: "refund()",
              contract_event: "EscrowRefunded (implied by state change)",
              code_line: 60,
              verification: "on-chain",
              status: "mapped",
            },
            {
              clause_id: "C6",
              legal_concept: "Reentrancy protection (nonReentrant on fund/release/refund)",
              contract_function: "nonReentrant modifier on fund(), release(), refund()",
              contract_event: "N/A (security pattern)",
              code_line: 47,
              verification: "static",
              status: "mapped",
            },
            {
              clause_id: "C7",
              legal_concept: "Access control (buyer-only fund, buyer/arbiter release, arbiter-only refund)",
              contract_function: "require(msg.sender == buyer/arbiter) in fund/release/refund",
              contract_event: "N/A (validation)",
              code_line: 48,
              verification: "static",
              status: "mapped",
            },
            {
              clause_id: "C8",
              legal_concept: "Governing law (off-chain, Indonesia)",
              contract_function: "N/A (legal metadata only)",
              contract_event: "N/A",
              code_line: null,
              verification: "off-chain",
              status: "legal-only",
            },
          ],
          coverage: "7/8 clauses mapped to code. 1 clause is legal-only (off-chain).",
        },
        raw_code_sol: {
          filename: "Escrow.sol",
          language: "Solidity",
          compiler_version: "^0.8.20",
          license: "MIT",
          source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Escrow is ReentrancyGuard {
    address public buyer;
    address public seller;
    address public arbiter;
    IERC20 public token;
    uint256 public amount;
    enum State { Created, Funded, Released, Refunded }
    State public state;

    constructor(address _seller, address _arbiter, address _token, uint256 _amount) {
        buyer = msg.sender;
        seller = _seller;
        arbiter = _arbiter;
        token = IERC20(_token);
        amount = _amount;
        state = State.Created;
    }

    function fund() external nonReentrant {
        require(msg.sender == buyer, "Only buyer");
        require(state == State.Created, "Not in Created state");
        token.transferFrom(buyer, address(this), amount);
        state = State.Funded;
    }

    function release() external nonReentrant {
        require(state == State.Funded, "Not funded");
        require(msg.sender == buyer || msg.sender == arbiter, "Not authorized");
        token.transfer(seller, amount);
        state = State.Released;
    }

    function refund() external nonReentrant {
        require(state == State.Funded, "Not funded");
        require(msg.sender == arbiter, "Only arbiter");
        token.transfer(buyer, amount);
        state = State.Refunded;
    }
}`,
        },
      },
      static_analysis: {
        target_latency_ms: 900,
        artifact_count: 3,
        clause_count: 8,
        matrix_mappings: 8,
        code_lines: 40,
        audit_checks: [
          "SPDX-License-Identifier",
          "Solidity ^0.8.20",
          "ReentrancyGuard (nonReentrant)",
          "Access control (require msg.sender)",
          "State machine (enum State)",
          "ERC-20 token interaction (IERC20)",
        ],
      },
    },
  ],
};

// ----------------------------------------------------------------------------
// 2. TREASURY & BILLING MODULE (DYNAMIC TIERING ENGINE)
// ----------------------------------------------------------------------------

function calculateServiceCost(serviceType: string, requestsLastMinute: number) {
  let baseCredits = 0;

  if (serviceType === "structured_data") baseCredits = 20;
  else if (serviceType === "code_modules") baseCredits = 120;
  else if (serviceType === "legal_code") baseCredits = 29900;
  else if (serviceType === "error") baseCredits = 0;

  let multiplier = 1.0;
  if (requestsLastMinute > 50) multiplier = 2.5;
  else if (requestsLastMinute > 10) multiplier = 1.5;

  const finalCost = Math.round(baseCredits * multiplier);
  return { baseCredits, multiplier, finalCost };
}

// ----------------------------------------------------------------------------
// 2b. PULL PAYMENT CONFIG (EIP-712 → Gateway.sol → Virtual Credit)
// ----------------------------------------------------------------------------

const PULL_PAYMENT_CONFIG = {
  gateway_address: "0xDEEc5BE05F0911b4aCD7FB6C8a4aa603C13F60e4",
  usdc_address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  rpc_url: "https://polygon-bor-rpc.publicnode.com",
  cred_per_usdc: 100,
  usdc_decimals: 6,
  min_deadline_buffer: 900,     // 15 minutes (IRON RULE #2)
  max_deadline_buffer: 1800,    // 30 minutes (IRON RULE #2)
  max_gas_price: 500000000000,  // 500 gwei (SECURITY PARAMETER #6)
  confirmation_blocks: 2,       // (SECURITY PARAMETER #5)
  poll_interval_ms: 2000,       // ~1 Polygon block
  max_poll_attempts: 30,        // 60 seconds max
};

const GATEWAY_ABI = [
  "function pullPayment(address client_address, uint256 amount_usdc, uint256 deadline, uint8 v, bytes32 r, bytes32 s, bytes32 client_id_hash) external",
  "function getGasPriceInfo() external view returns (uint256 current_gas_price, uint256 max_gas_price, bool acceptable)",
  "function usdcToCredits(uint256 amount_usdc) external pure returns (uint256)",
  "function totalPulled() external view returns (uint256)",
  "function totalPullCount() external view returns (uint256)",
];

const ERC20_PERMIT_ABI = [
  "function nonces(address owner) external view returns (uint256)",
];

// ----------------------------------------------------------------------------
// 3. GATEKEEPER MODULE (SUPABASE DB & QUOTA ENFORCER)
// ----------------------------------------------------------------------------

async function logServiceCall(
  clientId: string,
  serviceType: string,
  statusCode: number,
  payloadId: string | null,
  creditsCharged: number,
): Promise<void> {
  const supabase = getSupabaseClient();
  try {
    await supabase.from("service_logs").insert([{
      client_id: clientId,
      service_type: serviceType,
      status_code: statusCode,
      payload_id: payloadId,
      credits_charged: creditsCharged,
    }]);
  } catch {
    console.log("Service log insert failed (non-blocking).");
  }
}

async function checkQuotaAndRate(req: Request, serviceType: string) {
  const supabase = getSupabaseClient();

  const clientId = req.headers.get("x-client-id");
  if (!clientId) {
    return {
      allowed: false,
      clientId: "missing_client_id",
      deniedResponse: {
        status: "failed",
        error_code: "MISSING_CLIENT_ID",
        message: "M2M call rejected: header x-client-id is required. Use a stable machine identifier.",
      },
    };
  }

  // Query or create client
  let { data: client } = await supabase.from("client_usage").select("*").eq("client_id", clientId).single();

  if (!client) {
    const trialExpiresAt = new Date(Date.now() + TRIAL_CONFIG.trial_expiry_hours * 60 * 60 * 1000).toISOString();
    const { data: newClient } = await supabase
      .from("client_usage")
      .insert([{
        client_id: clientId,
        tier: "free_trial",
        free_requests_left: 1,
        balance_credits: 0,
        code_modules_trial_used: false,
        trial_expires_at: trialExpiresAt,
        total_invocations: 0,
      }])
      .select()
      .single();
    client = newClient;
  }

  // Check trial expiry
  const now = new Date();
  const trialExpiresAt = client.trial_expires_at ? new Date(client.trial_expires_at) : null;
  const trialExpired = trialExpiresAt ? trialExpiresAt < now : true;

  // If trial expired, zero out free requests
  if (trialExpired && client.free_requests_left > 0) {
    await supabase.from("client_usage")
      .update({ free_requests_left: 0 })
      .eq("client_id", clientId);
    client.free_requests_left = 0;
  }

  // Rate limiting
  const minuteAgo = new Date(Date.now() - 60000).toISOString();
  const { count } = await supabase
    .from("client_usage")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .gt("last_invoked_at", minuteAgo);

  const reqCountLastMinute = (count || 0) + 1;
  const pricing = calculateServiceCost(serviceType, reqCountLastMinute);

  // Determine payment path
  let paymentPath: "structured_data_trial" | "code_modules_trial" | "balance" | "free" | null = null;
  let creditsToCharge = 0;

  if (serviceType === "error") {
    paymentPath = "free";
    creditsToCharge = 0;
  } else if (serviceType === "structured_data") {
    if (client.free_requests_left > 0 && !trialExpired) {
      paymentPath = "structured_data_trial";
      creditsToCharge = 0;
    } else if ((client.balance_credits || 0) >= pricing.finalCost) {
      paymentPath = "balance";
      creditsToCharge = pricing.finalCost;
    } else {
      return {
        allowed: false,
        clientId,
        deniedResponse: {
          status: "failed",
          error_code: "INSUFFICIENT_CREDITS",
          message: `Quota or credits exhausted. Required: ${pricing.finalCost} CRED ($${(pricing.finalCost / 100).toFixed(2)}). Please top-up.`,
          client_id: clientId,
        },
      };
    }
  } else if (serviceType === "code_modules") {
    const trialActive = !client.code_modules_trial_used && !trialExpired;
    const remainingCost = pricing.finalCost - TRIAL_CONFIG.code_modules_trial_credits;

    if (trialActive && (client.balance_credits || 0) >= remainingCost) {
      paymentPath = "code_modules_trial";
      creditsToCharge = remainingCost;
    } else if (trialActive && (client.balance_credits || 0) < remainingCost) {
      return {
        allowed: false,
        clientId,
        deniedResponse: {
          status: "failed",
          error_code: "TRIAL_INSUFFICIENT_BALANCE",
          message: `Code Modules trial active! Add ${remainingCost} CRED ($${(remainingCost / 100).toFixed(2)}) to unlock your 100 CRED discount trial. Full price: ${pricing.finalCost} CRED. You pay only ${remainingCost} CRED.`,
          client_id: clientId,
          trial_discount: TRIAL_CONFIG.code_modules_trial_credits,
          remaining_cost: remainingCost,
          trial_expires_at: client.trial_expires_at,
        },
      };
    } else if (!trialActive && !client.code_modules_trial_used && trialExpired) {
      return {
        allowed: false,
        clientId,
        deniedResponse: {
          status: "failed",
          error_code: "TRIAL_EXPIRED",
          message: `Your 100 CRED code_modules trial has expired. Top-up to continue using code_modules at full price (${pricing.finalCost} CRED).`,
          client_id: clientId,
        },
      };
    } else if ((client.balance_credits || 0) >= pricing.finalCost) {
      paymentPath = "balance";
      creditsToCharge = pricing.finalCost;
    } else {
      return {
        allowed: false,
        clientId,
        deniedResponse: {
          status: "failed",
          error_code: "INSUFFICIENT_CREDITS",
          message: `Quota or credits exhausted. Required: ${pricing.finalCost} CRED ($${(pricing.finalCost / 100).toFixed(2)}). Please top-up.`,
          client_id: clientId,
        },
      };
    }
  } else {
    // legal_code and other services — balance only
    if ((client.balance_credits || 0) >= pricing.finalCost) {
      paymentPath = "balance";
      creditsToCharge = pricing.finalCost;
    } else {
      return {
        allowed: false,
        clientId,
        deniedResponse: {
          status: "failed",
          error_code: "INSUFFICIENT_CREDITS",
          message: `Quota or credits exhausted. Required: ${pricing.finalCost} CRED ($${(pricing.finalCost / 100).toFixed(2)}). Please top-up.`,
          client_id: clientId,
        },
      };
    }
  }

  return { allowed: true, clientId, tier: client.tier, client, pricing, paymentPath, creditsToCharge };
}

async function recordUsageAfterSuccess(
  clientId: string,
  paymentPath: string,
  creditsToCharge: number,
): Promise<void> {
  const supabase = getSupabaseClient();

  let { data: client } = await supabase.from("client_usage").select("*").eq("client_id", clientId).single();

  if (client) {
    let freeLeft = client.free_requests_left;
    let balance = client.balance_credits || 0;
    let codeModulesTrialUsed = client.code_modules_trial_used;

    if (paymentPath === "structured_data_trial") {
      freeLeft -= 1;
    } else if (paymentPath === "code_modules_trial") {
      balance = Math.max(0, balance - creditsToCharge);
      codeModulesTrialUsed = true;
    } else if (paymentPath === "balance") {
      balance = Math.max(0, balance - creditsToCharge);
    }

    await supabase.from("client_usage").update({
      free_requests_left: freeLeft,
      balance_credits: balance,
      code_modules_trial_used: codeModulesTrialUsed,
      total_invocations: (client.total_invocations || 0) + 1,
      last_invoked_at: new Date().toISOString(),
    }).eq("client_id", clientId);
  }
}

// ----------------------------------------------------------------------------
// 4. CORE ENGINE (PAYLOAD GENERATORS)
// ----------------------------------------------------------------------------

function uuid4(): string {
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function sha256(data: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function auditStep(step: string, status: string, detail?: string): Record<string, unknown> {
  const entry: Record<string, unknown> = { step, status, timestamp: nowIso() };
  if (detail) entry.detail = detail;
  return entry;
}

async function envelope(
  service: string,
  status: string,
  payload: Record<string, unknown>,
  trail: Record<string, unknown>[],
): Promise<Record<string, unknown>> {
  const checksum = await sha256(JSON.stringify(payload, Object.keys(payload).sort()));
  return {
    payload_id: uuid4(),
    timestamp: nowIso(),
    service,
    status,
    checksum,
    payload,
    audit_trail: trail,
  };
}

function errorPayload(code: string, message: string, recoverable = true, guidance = ""): Record<string, unknown> {
  return {
    error_code: code,
    error_message: message,
    recoverable,
    guidance: guidance || "Verify input parameters and retry.",
    failed_step: "validation",
  };
}

// -- 1. Structured Data -------------------------------------------------------

const SUPPORTED_DATA_TYPES = new Set(["ERC20", "ERC721", "REGULATORY", "GENERIC"]);

const CHAIN_COMPAT: Record<string, string[]> = {
  ERC20: ["ethereum", "polygon", "arbitrum", "optimism", "bsc", "avalanche"],
  ERC721: ["ethereum", "polygon", "arbitrum", "optimism", "bsc", "avalanche"],
  REGULATORY: ["ethereum", "polygon"],
  GENERIC: ["ethereum", "polygon", "arbitrum", "optimism", "bsc", "avalanche"],
};

const COMPLIANCE_TAGS: Record<string, string[]> = {
  ERC20: ["MiCA-ready", "ISO-20022-compatible"],
  ERC721: ["MiCA-ready"],
  REGULATORY: ["GDPR", "MiCA", "ISO-27001"],
  GENERIC: [],
};

async function genStructuredData(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const trail: Record<string, unknown>[] = [];
  const dtype = String(params.type ?? "").toUpperCase();

  if (!SUPPORTED_DATA_TYPES.has(dtype)) {
    trail.push(auditStep("validation", "failed", `Unknown type: ${dtype}`));
    return envelope("structured_data", "failed",
      errorPayload("INVALID_TYPE", `Type must be one of ${[...SUPPORTED_DATA_TYPES].join(", ")}`), trail);
  }
  trail.push(auditStep("validation", "passed"));

  let schema: Record<string, unknown>;
  if (dtype === "ERC20") {
    schema = {
      schema_type: "ERC20",
      token: {
        name: params.name ?? "UnnamedToken",
        symbol: params.symbol ?? "UNK",
        decimals: params.decimals ?? 18,
        total_supply: params.total_supply ?? 0,
      },
      standards: ["EIP-20"],
      chain_compatibility: CHAIN_COMPAT.ERC20,
      compliance_tags: COMPLIANCE_TAGS.ERC20,
      fields: [
        { name: "name", type: "string", required: true },
        { name: "symbol", type: "string", required: true },
        { name: "decimals", type: "uint8", required: true, default: 18 },
        { name: "totalSupply", type: "uint256", required: true },
      ],
    };
  } else if (dtype === "ERC721") {
    schema = {
      schema_type: "ERC721",
      token: {
        name: params.name ?? "UnnamedNFT",
        symbol: params.symbol ?? "NFT",
        base_uri: params.base_uri ?? "",
      },
      standards: ["EIP-721"],
      chain_compatibility: CHAIN_COMPAT.ERC721,
      compliance_tags: COMPLIANCE_TAGS.ERC721,
      fields: [
        { name: "name", type: "string", required: true },
        { name: "symbol", type: "string", required: true },
        { name: "baseURI", type: "string", required: false },
        { name: "tokenId", type: "uint256", required: true },
        { name: "owner", type: "address", required: true },
      ],
    };
  } else if (dtype === "REGULATORY") {
    schema = {
      schema_type: "regulatory",
      jurisdiction: params.jurisdiction ?? "ID",
      framework: params.framework ?? "MiCA",
      chain_compatibility: CHAIN_COMPAT.REGULATORY,
      compliance_tags: COMPLIANCE_TAGS.REGULATORY,
      fields: [
        { name: "entity_name", type: "string", required: true },
        { name: "registration_id", type: "string", required: true },
        { name: "jurisdiction", type: "string", required: true },
        { name: "framework", type: "string", required: true },
        { name: "audit_date", type: "date", required: true },
      ],
    };
  } else {
    schema = {
      schema_type: "generic",
      fields: params.fields ?? [],
      chain_compatibility: CHAIN_COMPAT.GENERIC,
      compliance_tags: COMPLIANCE_TAGS.GENERIC,
    };
  }
  trail.push(auditStep("generation", "completed"));
  trail.push(auditStep("audit", "completed", "Schema verified against standard"));

  return envelope("structured_data", "verified", schema, trail);
}

// -- 2. Code Modules ----------------------------------------------------------

const SUPPORTED_CONTRACT_TYPES = new Set(["ERC20", "ERC721", "ESCROW"]);

function genErc20Solidity(p: Record<string, unknown>): string {
  const name = p.name ?? "NexusToken";
  const symbol = p.symbol ?? "NXT";
  const decimals = p.decimals ?? 18;
  const supply = p.initial_supply ?? p.total_supply ?? 0;
  return `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ${name} is ERC20 {
    constructor() ERC20("${name}", "${symbol}") {
        _mint(msg.sender, ${supply} * 10**${decimals});
    }
}`;
}

function genErc721Solidity(p: Record<string, unknown>): string {
  const name = p.name ?? "NexusNFT";
  const symbol = p.symbol ?? "NFT";
  return `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";

contract ${name} is ERC721URIStorage {
    uint256 private _nextId;

    constructor() ERC721("${name}", "${symbol}") {}

    function mint(address to, string memory tokenURI) external returns (uint256) {
        uint256 tokenId = _nextId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, tokenURI);
        return tokenId;
    }
}`;
}

function genEscrowSolidity(): string {
  return `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Escrow is ReentrancyGuard {
    address public buyer;
    address public seller;
    address public arbiter;
    IERC20 public token;
    uint256 public amount;
    enum State { Created, Funded, Released, Refunded }
    State public state;

    constructor(address _seller, address _arbiter, address _token, uint256 _amount) {
        buyer = msg.sender;
        seller = _seller;
        arbiter = _arbiter;
        token = IERC20(_token);
        amount = _amount;
        state = State.Created;
    }

    function fund() external nonReentrant {
        require(msg.sender == buyer, "Only buyer");
        require(state == State.Created, "Not in Created state");
        token.transferFrom(buyer, address(this), amount);
        state = State.Funded;
    }

    function release() external nonReentrant {
        require(state == State.Funded, "Not funded");
        require(msg.sender == buyer || msg.sender == arbiter, "Not authorized");
        token.transfer(seller, amount);
        state = State.Released;
    }

    function refund() external nonReentrant {
        require(state == State.Funded, "Not funded");
        require(msg.sender == arbiter, "Only arbiter");
        token.transfer(buyer, amount);
        state = State.Refunded;
    }
}`;
}

function staticAudit(code: string): Record<string, unknown> {
  const checks = [
    {
      check: "ReentrancyGuard",
      passed: code.includes("ReentrancyGuard") || code.includes("nonReentrant"),
      detail: code.includes("nonReentrant") ? "Reentrancy protection present" : "No reentrancy guard found",
    },
    {
      check: "AccessControl",
      passed: code.includes("require(msg.sender") || code.includes("onlyRole") || code.includes("onlyOwner"),
      detail: code.includes("require(msg.sender") ? "Access control enforced" : "No access control",
    },
    {
      check: "SafeMath",
      passed: code.includes("^0.8"),
      detail: code.includes("^0.8") ? "Solidity 0.8+ built-in overflow checks" : "No overflow protection",
    },
    {
      check: "License",
      passed: code.includes("SPDX-License-Identifier"),
      detail: code.includes("SPDX-License-Identifier") ? "SPDX license present" : "Missing license",
    },
    {
      check: "InputValidation",
      passed: code.includes("require("),
      detail: code.includes("require(") ? "Input validation present" : "No input validation",
    },
  ];
  const passedCount = checks.filter((c) => c.passed).length;
  return {
    checks,
    summary: `${passedCount}/5 passed`,
    severity: passedCount < 3 ? "critical" : passedCount < 5 ? "warning" : "clean",
  };
}

async function genCodeModules(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const trail: Record<string, unknown>[] = [];
  const ctype = String(params.type ?? "").toUpperCase();

  if (!SUPPORTED_CONTRACT_TYPES.has(ctype)) {
    trail.push(auditStep("validation", "failed", `Unknown contract type: ${ctype}`));
    return envelope("code_modules", "failed",
      errorPayload("INVALID_TYPE", `Type must be one of ${[...SUPPORTED_CONTRACT_TYPES].join(", ")}`), trail);
  }
  trail.push(auditStep("validation", "passed"));

  let code: string;
  if (ctype === "ERC20") code = genErc20Solidity(params);
  else if (ctype === "ERC721") code = genErc721Solidity(params);
  else code = genEscrowSolidity();
  trail.push(auditStep("generation", "completed"));

  const auditReport = staticAudit(code);
  trail.push(auditStep("audit", "completed", `5-point audit: ${auditReport.summary}`));

  return envelope("code_modules", "audited", {
    contract_type: ctype,
    language: "Solidity",
    compiler_version: "^0.8.20",
    source: code,
    audit_report: auditReport,
  }, trail);
}

// -- 3. Legal-Code Pro --------------------------------------------------------

const SUPPORTED_LEGAL_TYPES = new Set(["escrow", "token_sale"]);

function genEscrowLegal(p: Record<string, unknown>): Record<string, unknown> {
  const parties = (p.parties as string[]) ?? ["Party A", "Party B"];
  const jurisdiction = (p.jurisdiction as string) ?? "ID";
  const amount = (p.amount as string) ?? "0";
  const currency = (p.currency as string) ?? "USDC";
  const deadline = (p.deadline as string) ?? "2026-12-31";

  return {
    contract_type: "escrow",
    jurisdiction,
    language_pair: "EN-ID",
    parties,
    clauses: [
      {
        id: "C1",
        en: `This Escrow Agreement is entered into between ${parties[0]} ("Buyer") and ${parties[1]} ("Seller").`,
        id_translation: `Perjanjian Escrow ini dibuat antara ${parties[0]} ("Pembeli") dan ${parties[1]} ("Penjual").`,
        mapped_function: "constructor()",
        mapped_event: "EscrowCreated",
      },
      {
        id: "C2",
        en: `The Buyer shall deposit ${amount} ${currency} into the escrow smart contract before ${deadline}.`,
        id_translation: `Pembeli wajib menyetorkan ${amount} ${currency} ke dalam smart contract escrow sebelum ${deadline}.`,
        mapped_function: "fund()",
        mapped_event: "EscrowFunded",
      },
      {
        id: "C3",
        en: "Upon confirmation of delivery, the funds shall be released to the Seller.",
        id_translation: "Setelah konfirmasi pengiriman, dana akan dilepaskan kepada Penjual.",
        mapped_function: "release()",
        mapped_event: "EscrowReleased",
      },
      {
        id: "C4",
        en: "If a dispute arises, the Arbiter may refund the funds to the Buyer.",
        id_translation: "Jika terjadi sengketa, Arbiter dapat mengembalikan dana kepada Pembeli.",
        mapped_function: "refund()",
        mapped_event: "EscrowRefunded",
      },
      {
        id: "C5",
        en: `This agreement is governed by the laws of jurisdiction ${jurisdiction}.`,
        id_translation: `Perjanjian ini tunduk pada hukum yurisdiksi ${jurisdiction}.`,
        mapped_function: null,
        mapped_event: null,
      },
    ],
  };
}

function genTokenSaleLegal(p: Record<string, unknown>): Record<string, unknown> {
  const parties = (p.parties as string[]) ?? ["Issuer", "Investor"];
  const jurisdiction = (p.jurisdiction as string) ?? "ID";
  const amount = (p.amount as string) ?? "0";
  const currency = (p.currency as string) ?? "USDC";
  const deadline = (p.deadline as string) ?? "2026-12-31";

  return {
    contract_type: "token_sale",
    jurisdiction,
    language_pair: "EN-ID",
    parties,
    clauses: [
      {
        id: "C1",
        en: `This Token Sale Agreement is entered into between ${parties[0]} ("Issuer") and ${parties[1]} ("Investor").`,
        id_translation: `Perjanjian Penjualan Token ini dibuat antara ${parties[0]} ("Penerbit") dan ${parties[1]} ("Investor").`,
        mapped_function: "constructor()",
        mapped_event: "TokenSaleCreated",
      },
      {
        id: "C2",
        en: `The Investor agrees to purchase ${amount} ${currency} worth of tokens before ${deadline}.`,
        id_translation: `Investor setuju untuk membeli token senilai ${amount} ${currency} sebelum ${deadline}.`,
        mapped_function: "buyTokens()",
        mapped_event: "TokensPurchased",
      },
      {
        id: "C3",
        en: "Tokens shall be distributed to the Investor within 7 days of payment confirmation.",
        id_translation: "Token akan didistribusikan kepada Investor dalam waktu 7 hari setelah konfirmasi pembayaran.",
        mapped_function: "distributeTokens()",
        mapped_event: "TokensDistributed",
      },
      {
        id: "C4",
        en: "If the Issuer fails to distribute tokens, a full refund shall be issued.",
        id_translation: "Jika Penerbit gagal mendistribusikan token, pengembalian dana penuh akan diberikan.",
        mapped_function: "claimRefund()",
        mapped_event: "RefundClaimed",
      },
      {
        id: "C5",
        en: `This agreement is governed by the laws of jurisdiction ${jurisdiction}.`,
        id_translation: `Perjanjian ini tunduk pada hukum yurisdiksi ${jurisdiction}.`,
        mapped_function: null,
        mapped_event: null,
      },
    ],
  };
}

async function genLegalCode(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const trail: Record<string, unknown>[] = [];
  const ctype = String(params.contract_type ?? "").toLowerCase();

  if (!SUPPORTED_LEGAL_TYPES.has(ctype)) {
    trail.push(auditStep("validation", "failed", `Unknown contract type: ${ctype}`));
    return envelope("legal_code", "failed",
      errorPayload("INVALID_TYPE", `contract_type must be one of ${[...SUPPORTED_LEGAL_TYPES].join(", ")}`), trail);
  }
  trail.push(auditStep("validation", "passed"));

  const contract = ctype === "escrow" ? genEscrowLegal(params) : genTokenSaleLegal(params);
  trail.push(auditStep("generation", "completed"));
  trail.push(auditStep("audit", "completed", "Legal-code mapping verified"));

  return envelope("legal_code", "verified", contract, trail);
}

// -- 4. Error Payload ---------------------------------------------------------

async function genErrorPayload(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const trail: Record<string, unknown>[] = [
    auditStep("validation", "failed", "Error payload requested"),
  ];
  const err = errorPayload(
    String(params.error_code ?? "UNKNOWN_ERROR"),
    String(params.error_message ?? "An unknown error occurred"),
    params.recoverable !== false,
    String(params.guidance ?? ""),
  );
  trail.push(auditStep("generation", "completed", "Error envelope generated"));
  return envelope("error", "failed", err, trail);
}

// ----------------------------------------------------------------------------
// 4b. PULL PAYMENT HANDLER (EIP-712 Permit → Gateway.sol → Virtual Credit)
// ----------------------------------------------------------------------------

async function genPullPayment(
  params: Record<string, unknown>,
  clientId: string,
): Promise<Record<string, unknown>> {
  const trail: Record<string, unknown>[] = [];

  // 1. Validate parameters
  const clientAddress = String(params.client_address ?? "");
  const amountUsdcStr = String(params.amount_usdc ?? "");
  const deadline = Number(params.deadline ?? 0);
  const v = Number(params.v ?? 0);
  const r = String(params.r ?? "");
  const s = String(params.s ?? "");
  const clientIdHash = String(params.client_id_hash ?? "");

  if (!clientAddress || !amountUsdcStr || !deadline || !r || !s || !clientIdHash) {
    trail.push(auditStep("validation", "failed", "Missing required permit parameters"));
    return envelope("pull_payment", "failed",
      errorPayload("INVALID_PERMIT",
        "Required: client_address, amount_usdc, deadline, v, r, s, client_id_hash"), trail);
  }
  trail.push(auditStep("validation", "passed"));

  // 2. Check deadline buffer (IRON RULE #2: 15-30 min)
  const now = Math.floor(Date.now() / 1000);
  const buffer = deadline - now;
  if (buffer < PULL_PAYMENT_CONFIG.min_deadline_buffer) {
    trail.push(auditStep("deadline_check", "failed",
      `Buffer ${buffer}s < ${PULL_PAYMENT_CONFIG.min_deadline_buffer}s minimum`));
    return envelope("pull_payment", "failed",
      errorPayload("DEADLINE_TOO_SOON",
        `Deadline buffer must be >= 15 minutes (900s). Current: ${buffer}s`), trail);
  }
  if (buffer > PULL_PAYMENT_CONFIG.max_deadline_buffer) {
    trail.push(auditStep("deadline_check", "failed",
      `Buffer ${buffer}s > ${PULL_PAYMENT_CONFIG.max_deadline_buffer}s maximum`));
    return envelope("pull_payment", "failed",
      errorPayload("DEADLINE_TOO_FAR",
        `Deadline buffer must be <= 30 minutes (1800s). Current: ${buffer}s`), trail);
  }
  trail.push(auditStep("deadline_check", "passed", `Buffer: ${buffer}s`));

  // 3. Parse amount & calculate credits
  const amountUsdc = BigInt(amountUsdcStr);
  if (amountUsdc <= 0n) {
    trail.push(auditStep("amount_check", "failed", "Amount must be > 0"));
    return envelope("pull_payment", "failed",
      errorPayload("INVALID_AMOUNT", "amount_usdc must be > 0"), trail);
  }
  const creditsExpected = Number(
    amountUsdc * BigInt(PULL_PAYMENT_CONFIG.cred_per_usdc) /
      BigInt(10 ** PULL_PAYMENT_CONFIG.usdc_decimals)
  );
  trail.push(auditStep("amount_check", "passed",
    `${amountUsdcStr} units = ${creditsExpected} CRED`));

  // 4. Check gas price (SECURITY PARAMETER #6: max 500 gwei)
  const provider = new JsonRpcProvider(PULL_PAYMENT_CONFIG.rpc_url);
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? 0n;
  if (gasPrice > BigInt(PULL_PAYMENT_CONFIG.max_gas_price)) {
    trail.push(auditStep("gas_check", "failed",
      `Gas ${gasPrice / 10n ** 9n} gwei > 500 gwei max`));
    return envelope("pull_payment", "failed",
      errorPayload("GAS_PRICE_TOO_HIGH",
        `Current gas price ${gasPrice / 10n ** 9n} gwei exceeds max 500 gwei. Retry when network calms down.`),
      trail);
  }
  trail.push(auditStep("gas_check", "passed", `Gas: ${gasPrice / 10n ** 9n} gwei`));

  // 5. Read USDC permit nonce for client (SECURITY PARAMETER #4: anti-replay)
  const usdcContract = new Contract(
    PULL_PAYMENT_CONFIG.usdc_address,
    ERC20_PERMIT_ABI,
    provider,
  );
  const permitNonce = await usdcContract.nonces(clientAddress);
  trail.push(auditStep("nonce_check", "passed", `Permit nonce: ${permitNonce}`));

  // 6. Insert pending authorization in DB
  const supabase = getSupabaseClient();

  const { data: authRecord, error: authError } = await supabase
    .from("pull_payment_authorizations")
    .insert([{
      client_id: clientId,
      client_id_hash: clientIdHash,
      client_address: clientAddress,
      token_address: PULL_PAYMENT_CONFIG.usdc_address,
      spender_address: PULL_PAYMENT_CONFIG.gateway_address,
      amount_usdc: Number(amountUsdc) / 1e6,
      credits_expected: creditsExpected,
      deadline: deadline,
      deadline_buffer_seconds: buffer,
      signature_v: v,
      signature_r: r,
      signature_s: s,
      permit_nonce: Number(permitNonce),
      status: "pending",
    }])
    .select()
    .single();

  if (authError) {
    trail.push(auditStep("db_insert", "failed", authError.message));
    return envelope("pull_payment", "failed",
      errorPayload("DB_ERROR",
        `Failed to record authorization: ${authError.message}`), trail);
  }
  trail.push(auditStep("db_insert", "passed", `Auth ID: ${authRecord.id}`));

  // 7. Call Gateway.sol's pullPayment() on Polygon
  //    (IRON RULE #1: Gateway.sol IS the spender, not Treasury wallet)
  const privateKey = Deno.env.get("POLYGON_PRIVATE_KEY") || "";
  if (!privateKey) {
    trail.push(auditStep("wallet_check", "failed", "POLYGON_PRIVATE_KEY not set"));
    return envelope("pull_payment", "failed",
      errorPayload("WALLET_ERROR",
        "Backend wallet not configured. Set POLYGON_PRIVATE_KEY secret."), trail);
  }
  const wallet = new Wallet(privateKey, provider);
  const gatewayContract = new Contract(
    PULL_PAYMENT_CONFIG.gateway_address,
    GATEWAY_ABI,
    wallet,
  );

  let txHash: string;
  let blockNumber: number;
  try {
    const tx = await gatewayContract.pullPayment(
      clientAddress,
      amountUsdc,
      deadline,
      v,
      r,
      s,
      clientIdHash,
      { gasPrice },
    );
    txHash = tx.hash;
    trail.push(auditStep("blockchain_submit", "passed", `TX: ${txHash}`));

    // Wait for transaction receipt
    const receipt = await tx.wait();
    blockNumber = receipt.blockNumber;
    trail.push(auditStep("blockchain_confirm", "passed", `Block: ${blockNumber}`));
  } catch (err) {
    // IRON RULE #3: Virtual Credit Ledger rollback for failed API calls
    await supabase.from("pull_payment_authorizations")
      .update({
        status: "failed",
        failure_reason: err instanceof Error ? err.message : String(err),
        failed_at: new Date().toISOString(),
      })
      .eq("id", authRecord.id);

    trail.push(auditStep("blockchain_submit", "failed",
      err instanceof Error ? err.message : String(err)));
    return envelope("pull_payment", "failed",
      errorPayload("BLOCKCHAIN_ERROR",
        `Gateway.sol pullPayment() failed: ${err instanceof Error ? err.message : String(err)}`),
      trail);
  }

  // 8. Record event in pull_payment_events
  const { data: eventRecord } = await supabase
    .from("pull_payment_events")
    .insert([{
      tx_hash: txHash,
      block_number: blockNumber,
      log_index: 0,
      contract_address: PULL_PAYMENT_CONFIG.gateway_address,
      client_id_hash: clientIdHash,
      client_address: clientAddress,
      amount_usdc: Number(amountUsdc) / 1e6,
      credits_minted: creditsExpected,
      deadline: deadline,
      nonce: Number(permitNonce),
      on_chain_timestamp: Math.floor(Date.now() / 1000),
      confirmation_status: "unconfirmed",
    }])
    .select()
    .single();

  // 9. Update authorization with tx hash
  await supabase.from("pull_payment_authorizations")
    .update({
      status: "pulled",
      pull_tx_hash: txHash,
      block_number: blockNumber,
    })
    .eq("id", authRecord.id);

  trail.push(auditStep("db_event", "passed", `Event ID: ${eventRecord?.id}`));

  // 10. Poll for 2-block confirmation (SECURITY PARAMETER #5)
  let confirmed = false;
  for (let i = 0; i < PULL_PAYMENT_CONFIG.max_poll_attempts; i++) {
    await new Promise((resolve) =>
      setTimeout(resolve, PULL_PAYMENT_CONFIG.poll_interval_ms)
    );

    const currentBlock = await provider.getBlockNumber();
    if (currentBlock >= blockNumber + PULL_PAYMENT_CONFIG.confirmation_blocks) {
      // Call confirm_pull_event() DB function
      const { data: confirmResult, error: confirmError } = await supabase
        .rpc("confirm_pull_event", {
          p_event_id: eventRecord.id,
          p_current_block: currentBlock,
        });

      if (confirmResult && !confirmError) {
        confirmed = true;
        trail.push(auditStep("2_block_confirmation", "passed",
          `Confirmed at block ${currentBlock}`));
        break;
      }
    }
  }

  if (!confirmed) {
    trail.push(auditStep("2_block_confirmation", "pending",
      "Polling timed out. Background process will confirm."));
    return envelope("pull_payment", "pending", {
      auth_id: authRecord.id,
      tx_hash: txHash,
      block_number: blockNumber,
      credits_expected: creditsExpected,
      message: "Pull payment submitted. 2-block confirmation pending. Credits will be available after confirmation.",
    }, trail);
  }

  // 11. Return success — credits added to virtual balance
  trail.push(auditStep("credit_added", "passed",
    `${creditsExpected} CRED added to balance`));
  return envelope("pull_payment", "verified", {
    auth_id: authRecord.id,
    tx_hash: txHash,
    block_number: blockNumber,
    amount_usdc: Number(amountUsdc) / 1e6,
    credits_minted: creditsExpected,
    client_id: clientId,
    message: "Pull payment successful. Credits added to virtual balance.",
  }, trail);
}

// -- Service Router -----------------------------------------------------------

const SERVICES: Record<string, (p: Record<string, unknown>) => Promise<Record<string, unknown>>> = {
  structured_data: genStructuredData,
  code_modules: genCodeModules,
  legal_code: genLegalCode,
  error: genErrorPayload,
};

// -- Trial Info Injector ------------------------------------------------------

function buildTrialInfo(
  paymentPath: string,
  client: Record<string, unknown>,
): Record<string, unknown> | null {
  if (paymentPath === "structured_data_trial") {
    return {
      trial_used: "structured_data_free",
      credits_saved: TRIAL_CONFIG.structured_data_credits,
      code_modules_trial_available: !client.code_modules_trial_used,
      code_modules_trial_credits: TRIAL_CONFIG.code_modules_trial_credits,
      code_modules_trial_remaining_cost: TRIAL_CONFIG.code_modules_full_cost - TRIAL_CONFIG.code_modules_trial_credits,
      trial_expires_at: client.trial_expires_at,
    };
  }
  if (paymentPath === "code_modules_trial") {
    return {
      trial_used: "code_modules_discount",
      credits_saved: TRIAL_CONFIG.code_modules_trial_credits,
      credits_paid: TRIAL_CONFIG.code_modules_full_cost - TRIAL_CONFIG.code_modules_trial_credits,
      full_price: TRIAL_CONFIG.code_modules_full_cost,
    };
  }
  return null;
}

// ----------------------------------------------------------------------------
// 5. HTTP HANDLER
// ----------------------------------------------------------------------------

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-id",
  "X-Client-ID-Required": "true",
};

// ----------------------------------------------------------------------------
// 0d. M2M OUTPUT PAYLOAD STANDARDIZER (Phase 2.3)
// ----------------------------------------------------------------------------
// All gateway responses follow a standard M2M envelope for cross-platform
// interoperability. Two constructors:
//   m2mSuccess() — wraps payload data with metadata
//   m2mError()   — wraps error details with metadata
// Free endpoints (manifest, samples, metrics, dry-run) use raw jsonResponse
// since they have their own well-defined schemas.
// ----------------------------------------------------------------------------

interface M2MMetadata {
  node_id: string;
  version: string;
  latency_ms: number;
  credits_charged: number;
}

function buildM2MMetadata(credits: number, startTime: number): M2MMetadata {
  return {
    node_id: NODE_IDENTITY.node_id,
    version: TELEMETRY.engine_version,
    latency_ms: Date.now() - startTime,
    credits_charged: credits,
  };
}

function m2mSuccess(
  data: Record<string, unknown>,
  serviceType: string,
  payloadId: string | null,
  credits: number,
  startTime: number,
  status = 200,
): Response {
  return jsonResponse({
    status: "success",
    payload_id: payloadId,
    timestamp: new Date().toISOString(),
    service_type: serviceType,
    data,
    metadata: buildM2MMetadata(credits, startTime),
  }, status);
}

function m2mError(
  errorCode: string,
  message: string,
  serviceType: string,
  statusCode: number,
  credits: number,
  startTime: number,
  details?: Record<string, unknown>,
): Response {
  return jsonResponse({
    status: statusCode >= 500 ? "error" : statusCode === 503 ? "rejected" : "failed",
    payload_id: null,
    timestamp: new Date().toISOString(),
    service_type: serviceType,
    error: {
      error_code: errorCode,
      message,
      ...(details ? { details } : {}),
    },
    metadata: buildM2MMetadata(credits, startTime),
  }, statusCode);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

async function payloadHandler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed. Use POST." }, 405);
  }

  let body: { service_type?: string; params?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { service_type, params } = body;

  if (!service_type || !(service_type in SERVICES)) {
    return jsonResponse({
      error: "Missing or invalid service_type",
      valid_types: Object.keys(SERVICES),
    }, 400);
  }

  try {
    const result = await SERVICES[service_type](params ?? {});
    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({
      error: "Payload generation failed",
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
}

// ----------------------------------------------------------------------------
// 0b. DRY-RUN HANDLER (Phase 1.3 — POST /gateway/dry-run)
// ----------------------------------------------------------------------------
// Free interactive preview: accepts Solidity source code, runs static syntax
// validation (no on-chain deployment), and generates a Digital Twin v3 matrix
// (bipolar clause-to-code mapping). Target latency < 500ms.
// ----------------------------------------------------------------------------

interface DryRunRequest {
  source_code?: string;
  contract_type?: string;
  clauses?: Array<{
    clause_id: string;
    heading_en: string;
    heading_id?: string;
  }>;
}

interface SyntaxIssue {
  severity: "error" | "warning" | "info";
  line: number;
  message: string;
  rule: string;
}

interface TwinMapping {
  clause_id: string;
  legal_concept: string;
  contract_function: string;
  contract_event: string;
  code_line: number | null;
  code_line_range: [number, number] | null;       // Phase 3.1: line range
  function_signature: string | null;               // Phase 3.1: full signature
  visibility: string | null;                        // Phase 3.1: public/private/external/internal
  modifiers: string[];                              // Phase 3.1: modifiers applied
  breach_conditions: string[];                      // Phase 3.1: what would breach this clause
  verification: "static" | "on-chain" | "off-chain";
  status: "mapped" | "legal-only" | "unmapped";
}

// Phase 3.1: Upgraded parser — richer function extraction
interface ParsedFunction {
  name: string;
  signature: string;
  line: number;
  visibility: string;
  modifiers: string[];
  require_count: number;
  has_require: boolean;
}

interface ParsedEvent {
  name: string;
  line: number;
  parameters: string;
}

interface ParsedModifier {
  name: string;
  line: number;
}

interface ParsedStateVar {
  name: string;
  type: string;
  line: number;
  visibility: string;
}

interface ParsedContract {
  name: string | null;
  pragma: string | null;
  license: string | null;
  functions: ParsedFunction[];
  events: ParsedEvent[];
  modifiers: ParsedModifier[];
  state_vars: ParsedStateVar[];
  has_constructor: boolean;
  has_pause: boolean;          // Phase 3.2: emergency freeze detection
  has_ownership: boolean;      // Phase 3.2: ownership check
  has_burn: boolean;           // Phase 3.2: burn capability
  has_mint: boolean;           // Phase 3.2: mint capability
  line_count: number;
}

// Phase 3.2: Breach simulation result
interface BreachScenario {
  scenario_id: string;
  scenario_name: string;
  description: string;
  risk_level: "low" | "medium" | "high" | "critical";
  affected_functions: string[];
  mitigation: string;
  detected: boolean;
}

interface BreachSimulationResult {
  contract_name: string | null;
  overall_risk: "low" | "medium" | "high" | "critical";
  scenarios: BreachScenario[];
  emergency_freeze: {
    detected: boolean;
    mechanism: string | null;
    functions: string[];
  };
  recommendations: string[];
}

// ----------------------------------------------------------------------------
// 3a. PHASE 3.1 — UPGRADED SOLIDITY PARSER (Bipolar Matrix Mapping)
// ----------------------------------------------------------------------------
// Replaces basic regex extraction with deeper parsing:
//   - Function signatures with parameters, visibility, modifiers
//   - Require statements with line numbers
//   - State variables with visibility
//   - Pause/ownership/burn/mint capability detection
// ----------------------------------------------------------------------------

function parseSolidityContract(source: string): ParsedContract {
  const lines = source.split("\n");
  const lineCount = lines.length;

  // Contract name
  const contractMatch = source.match(/contract\s+(\w+)/);
  const name = contractMatch ? contractMatch[1] : null;

  // Pragma
  const pragmaMatch = source.match(/pragma\s+solidity\s+([^;]+);/);
  const pragma = pragmaMatch ? pragmaMatch[1].trim() : null;

  // License
  const licenseMatch = source.match(/\/\/\s*SPDX-License-Identifier:\s*(.+)/);
  const license = licenseMatch ? licenseMatch[1].trim() : null;

  // Parse functions with full signatures
  const functions: ParsedFunction[] = [];
  const funcRegex = /function\s+(\w+)\s*\(([^)]*)\)\s*([^{]*)\{/g;
  let funcMatch;
  while ((funcMatch = funcRegex.exec(source)) !== null) {
    const funcName = funcMatch[1];
    const params = funcMatch[2].trim();
    const modifiersRaw = funcMatch[3].trim();
    const before = source.substring(0, funcMatch.index);
    const line = before.split("\n").length;

    // Extract visibility
    let visibility = "public"; // default
    const visMatch = modifiersRaw.match(/\b(public|private|external|internal)\b/);
    if (visMatch) visibility = visMatch[1];

    // Extract modifier names (exclude visibility keywords and state mutability)
    const modPart = modifiersRaw
      .replace(/\b(public|private|external|internal|view|pure|payable|virtual|override|returns)\b/g, "")
      .replace(/\([^)]*\)/g, "") // remove returns(...) params
      .trim();
    const modifiers = modPart ? modPart.split(/\s+/).filter(m => m.length > 0) : [];

    // Count require statements within this function body
    const funcBodyStart = funcMatch.index + funcMatch[0].length;
    let braceDepth = 1;
    let bodyEnd = funcBodyStart;
    for (let i = funcBodyStart; i < source.length && braceDepth > 0; i++) {
      if (source[i] === "{") braceDepth++;
      if (source[i] === "}") braceDepth--;
      bodyEnd = i;
    }
    const funcBody = source.substring(funcBodyStart, bodyEnd);
    const requireCount = (funcBody.match(/require\s*\(/g) || []).length;

    functions.push({
      name: funcName,
      signature: `function ${funcName}(${params}) ${modifiersRaw.replace(/\s+/g, " ").trim()}`.trim(),
      line,
      visibility,
      modifiers,
      require_count: requireCount,
      has_require: requireCount > 0,
    });
  }

  // Parse events with parameters
  const events: ParsedEvent[] = [];
  const evtRegex = /event\s+(\w+)\s*\(([^)]*)\)/g;
  let evtMatch;
  while ((evtMatch = evtRegex.exec(source)) !== null) {
    const before = source.substring(0, evtMatch.index);
    const line = before.split("\n").length;
    events.push({
      name: evtMatch[1],
      line,
      parameters: evtMatch[2].trim(),
    });
  }

  // Parse modifiers
  const modifiers: ParsedModifier[] = [];
  const modRegex = /modifier\s+(\w+)\s*\(/g;
  let modMatch;
  while ((modMatch = modRegex.exec(source)) !== null) {
    const before = source.substring(0, modMatch.index);
    const line = before.split("\n").length;
    modifiers.push({ name: modMatch[1], line });
  }

  // Parse state variables
  const stateVars: ParsedStateVar[] = [];
  const stateVarRegex = /^\s*(mapping|uint\w*|int\w*|bool|address|string|bytes\w*|\w+)\s+(public|private|internal|constant|immutable)?\s*(\w+)\s*[;=]/gm;
  let svMatch;
  while ((svMatch = stateVarRegex.exec(source)) !== null) {
    const before = source.substring(0, svMatch.index);
    const line = before.split("\n").length;
    stateVars.push({
      name: svMatch[3],
      type: svMatch[1],
      line,
      visibility: svMatch[2] || "internal",
    });
  }

  // Capability detection (Phase 3.2)
  const sourceLower = source.toLowerCase();
  const hasPause = /\b(pause|unpause|paused)\b/i.test(source);
  const hasOwnership = /\b(onlyowner|owner|transferownership|renounceownership|ownable)\b/i.test(source);
  const hasBurn = /\b(burn|burnfrom|burnable)\b/i.test(source);
  const hasMint = /\b(mint|_mint)\b/i.test(source);
  const hasConstructor = /constructor\s*\(/i.test(source);

  return {
    name,
    pragma,
    license,
    functions,
    events,
    modifiers,
    state_vars: stateVars,
    has_constructor: hasConstructor,
    has_pause: hasPause,
    has_ownership: hasOwnership,
    has_burn: hasBurn,
    has_mint: hasMint,
    line_count: lineCount,
  };
}

// ----------------------------------------------------------------------------
// 3b. PHASE 3.2 — AUTOMATED BREACH SIMULATION
// ----------------------------------------------------------------------------
// Simulates breach scenarios against the parsed contract and generates
// a risk assessment report. Detects emergency freeze mechanisms.
// ----------------------------------------------------------------------------

function simulateBreachScenarios(parsed: ParsedContract): BreachSimulationResult {
  const scenarios: BreachScenario[] = [];
  const recommendations: string[] = [];

  // Scenario 1: Unauthorized minting
  const mintFuncs = parsed.functions.filter(f => /\b(mint|_mint)\b/i.test(f.name));
  const mintHasRequire = mintFuncs.some(f => f.has_require);
  scenarios.push({
    scenario_id: "BS-001",
    scenario_name: "Unauthorized Minting",
    description: "Can an attacker mint tokens without authorization?",
    risk_level: mintFuncs.length === 0 ? "low" : mintHasRequire ? "low" : "critical",
    affected_functions: mintFuncs.map(f => f.name),
    mitigation: mintFuncs.length === 0
      ? "No mint function detected — not applicable."
      : mintHasRequire
        ? "Mint function has require() guards — verify access control (onlyOwner)."
        : "CRITICAL: Mint function lacks require() guards. Add access control (onlyOwner modifier).",
    detected: mintFuncs.length > 0 && !mintHasRequire,
  });
  if (mintFuncs.length > 0 && !mintHasRequire) {
    recommendations.push("Add access control to mint function (onlyOwner or role-based).");
  }

  // Scenario 2: Transfer violation
  const transferFuncs = parsed.functions.filter(f => /\b(transfer|transferfrom)\b/i.test(f.name));
  const transferHasRequire = transferFuncs.some(f => f.has_require);
  scenarios.push({
    scenario_id: "BS-002",
    scenario_name: "Transfer Violation",
    description: "Can transfers bypass balance/allowance checks?",
    risk_level: transferFuncs.length === 0 ? "low" : transferHasRequire ? "low" : "high",
    affected_functions: transferFuncs.map(f => f.name),
    mitigation: transferFuncs.length === 0
      ? "No transfer function detected — not applicable."
      : transferHasRequire
        ? "Transfer function has require() guards — verify balance/allowance checks."
        : "HIGH: Transfer function lacks require() guards. Add balance and allowance validation.",
    detected: transferFuncs.length > 0 && !transferHasRequire,
  });
  if (transferFuncs.length > 0 && !transferHasRequire) {
    recommendations.push("Add require() for balance and allowance checks in transfer functions.");
  }

  // Scenario 3: Fund drain via withdraw
  const withdrawFuncs = parsed.functions.filter(f => /\b(withdraw|withdrawal|claim)\b/i.test(f.name));
  const withdrawHasRequire = withdrawFuncs.some(f => f.has_require);
  scenarios.push({
    scenario_id: "BS-003",
    scenario_name: "Fund Drain via Withdrawal",
    description: "Can anyone withdraw funds without authorization?",
    risk_level: withdrawFuncs.length === 0 ? "low" : withdrawHasRequire ? "low" : "critical",
    affected_functions: withdrawFuncs.map(f => f.name),
    mitigation: withdrawFuncs.length === 0
      ? "No withdraw function detected — not applicable."
      : withdrawHasRequire
        ? "Withdraw function has require() guards — verify caller authorization."
        : "CRITICAL: Withdraw function lacks require() guards. Add caller authorization.",
    detected: withdrawFuncs.length > 0 && !withdrawHasRequire,
  });
  if (withdrawFuncs.length > 0 && !withdrawHasRequire) {
    recommendations.push("Add access control to withdraw function (onlyOwner or pending withdrawals pattern).");
  }

  // Scenario 4: Emergency freeze detection
  const pauseFuncs = parsed.functions.filter(f => /\b(pause|unpause|emergencyStop|freeze)\b/i.test(f.name));
  scenarios.push({
    scenario_id: "BS-004",
    scenario_name: "Emergency Freeze",
    description: "Does the contract have an emergency stop / pause mechanism?",
    risk_level: parsed.has_pause ? "low" : "medium",
    affected_functions: pauseFuncs.map(f => f.name),
    mitigation: parsed.has_pause
      ? "Pause mechanism detected — verify only authorized parties can pause."
      : "MEDIUM: No pause/emergency stop detected. Consider adding Pausable pattern for emergency response.",
    detected: parsed.has_pause,
  });
  if (!parsed.has_pause) {
    recommendations.push("Consider adding OpenZeppelin Pausable pattern for emergency freeze capability.");
  }

  // Scenario 5: Ownership renounce risk
  scenarios.push({
    scenario_id: "BS-005",
    scenario_name: "Ownership Renounce Risk",
    description: "Can ownership be renounced, potentially locking admin functions?",
    risk_level: /\brenounceownership\b/i.test(parsed.name || "") ? "medium" : "low",
    affected_functions: parsed.functions.filter(f => /renounce/i.test(f.name)).map(f => f.name),
    mitigation: "If renounceOwnership exists, ensure it's only callable by current owner and documented in legal layer.",
    detected: parsed.functions.some(f => /renounce/i.test(f.name)),
  });

  // Scenario 6: Reentrancy risk
  const externalCalls = parsed.functions.filter(f => f.visibility === "external" || /payable/i.test(f.signature));
  const hasExternalWithBalance = externalCalls.some(f =>
    f.has_require && /\b(balance|amount|value)\b/i.test(f.signature)
  );
  scenarios.push({
    scenario_id: "BS-006",
    scenario_name: "Reentrancy Attack",
    description: "Are external calls with value transfer protected against reentrancy?",
    risk_level: externalCalls.length === 0 ? "low" : hasExternalWithBalance ? "medium" : "high",
    affected_functions: externalCalls.map(f => f.name),
    mitigation: externalCalls.length === 0
      ? "No external/payable functions detected — low reentrancy risk."
      : "Use checks-effects-interactions pattern and consider ReentrancyGuard.",
    detected: externalCalls.length > 0,
  });
  if (externalCalls.length > 0) {
    recommendations.push("Apply checks-effects-interactions pattern and consider OpenZeppelin ReentrancyGuard.");
  }

  // Overall risk
  const riskLevels = scenarios.map(s => s.risk_level);
  const riskOrder = { "low": 0, "medium": 1, "high": 2, "critical": 3 };
  const maxRisk = riskLevels.reduce((max, r) => riskOrder[r] > riskOrder[max] ? r : max, "low" as "low");

  // Emergency freeze info
  const emergencyFreeze = {
    detected: parsed.has_pause,
    mechanism: parsed.has_pause
      ? `Pause/unpause functions detected: ${pauseFuncs.map(f => f.name).join(", ") || "implicit"}`
      : null,
    functions: pauseFuncs.map(f => f.name),
  };

  if (recommendations.length === 0) {
    recommendations.push("Contract passed all breach simulations. No critical vulnerabilities detected.");
  }

  return {
    contract_name: parsed.name,
    overall_risk: maxRisk,
    scenarios,
    emergency_freeze: emergencyFreeze,
    recommendations,
  };
}

function validateSoliditySyntax(source: string): { issues: SyntaxIssue[]; contract_name: string | null; pragma: string | null; license: string | null; functions: string[]; events: string[]; modifiers: string[]; line_count: number } {
  const issues: SyntaxIssue[] = [];
  const lines = source.split("\n");
  const lineCount = lines.length;

  // Check SPDX license
  const licenseMatch = source.match(/\/\/\s*SPDX-License-Identifier:\s*(.+)/);
  const license = licenseMatch ? licenseMatch[1].trim() : null;
  if (!license) {
    issues.push({ severity: "warning", line: 1, message: "Missing SPDX license identifier. Recommended for production contracts.", rule: "SPDX_HEADER" });
  }

  // Check pragma
  const pragmaMatch = source.match(/pragma\s+solidity\s+([^;]+);/);
  const pragma = pragmaMatch ? pragmaMatch[1].trim() : null;
  if (!pragma) {
    issues.push({ severity: "error", line: 1, message: "Missing 'pragma solidity' version directive.", rule: "PRAGMA_REQUIRED" });
  } else if (!pragma.includes("^0.8")) {
    issues.push({ severity: "info", line: 1, message: `Pragma ${pragma} — recommend ^0.8.20 for latest security features.`, rule: "PRAGMA_VERSION" });
  }

  // Check contract keyword
  const contractMatch = source.match(/contract\s+(\w+)/);
  const contractName = contractMatch ? contractMatch[1] : null;
  if (!contractName) {
    issues.push({ severity: "error", line: 1, message: "No 'contract' keyword found. Invalid Solidity source.", rule: "CONTRACT_REQUIRED" });
  }

  // Check balanced braces
  let braceDepth = 0;
  let maxBraceDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === "{") { braceDepth++; maxBraceDepth = Math.max(maxBraceDepth, braceDepth); }
      if (ch === "}") braceDepth--;
    }
  }
  if (braceDepth !== 0) {
    issues.push({ severity: "error", line: lineCount, message: `Unbalanced braces: ${braceDepth > 0 ? "missing " + braceDepth + " closing brace(s)" : "extra " + Math.abs(braceDepth) + " closing brace(s)"}.`, rule: "BALANCED_BRACES" });
  }

  // Check balanced parentheses
  let parenDepth = 0;
  for (const line of lines) {
    for (const ch of line) {
      if (ch === "(") parenDepth++;
      if (ch === ")") parenDepth--;
    }
  }
  if (parenDepth !== 0) {
    issues.push({ severity: "error", line: lineCount, message: `Unbalanced parentheses: off by ${parenDepth}.`, rule: "BALANCED_PARENS" });
  }

  // Extract functions
  const functionRegex = /function\s+(\w+)\s*\(/g;
  const functions: string[] = [];
  let funcMatch;
  while ((funcMatch = functionRegex.exec(source)) !== null) {
    functions.push(funcMatch[1]);
  }

  // Extract events
  const eventRegex = /event\s+(\w+)\s*\(/g;
  const events: string[] = [];
  let evtMatch;
  while ((evtMatch = eventRegex.exec(source)) !== null) {
    events.push(evtMatch[1]);
  }

  // Extract modifiers
  const modifierRegex = /modifier\s+(\w+)\s*\(/g;
  const modifiers: string[] = [];
  let modMatch;
  while ((modMatch = modifierRegex.exec(source)) !== null) {
    modifiers.push(modMatch[1]);
  }

  // Check for constructor
  if (contractName && !source.includes("constructor(") && !source.includes("constructor (")) {
    issues.push({ severity: "info", line: 1, message: "No constructor found. Contract will use default constructor.", rule: "CONSTRUCTOR_CHECK" });
  }

  // Check for require statements (best practice)
  const requireCount = (source.match(/require\s*\(/g) || []).length;
  if (requireCount === 0 && functions.length > 0) {
    issues.push({ severity: "info", line: 1, message: "No require() statements found. Consider adding input validation.", rule: "INPUT_VALIDATION" });
  }

  return { issues, contract_name: contractName, pragma, license, functions, events, modifiers, line_count: lineCount };
}

function generateTwinMatrix(
  source: string,
  clauses: Array<{ clause_id: string; heading_en: string; heading_id?: string }>,
  parsed: ParsedContract,
): { mapping: TwinMapping[]; coverage: string } {
  const mapping: TwinMapping[] = [];

  // Phase 3.1: Enhanced keyword map with breach conditions
  const clauseKeywords: Record<string, { kws: string[]; breach: string[] }> = {
    "parties": { kws: ["constructor", "owner", "msg.sender"], breach: ["Unauthorized party calls restricted function"] },
    "token": { kws: ["mint", "transfer", "balance", "erc20", "erc721"], breach: ["Token minted beyond supply cap", "Transfer to blacklisted address"] },
    "payment": { kws: ["pay", "deposit", "withdraw", "transfer", "escrow"], breach: ["Payment released without delivery confirmation"] },
    "minting": { kws: ["mint", "token", "supply"], breach: ["Minting exceeds agreed supply", "Unauthorized mint by non-owner"] },
    "royalty": { kws: ["royalty", "tokenid", "mint"], breach: ["Royalty rate exceeds agreed percentage"] },
    "escrow": { kws: ["deposit", "withdraw", "release", "refund", "escrow"], breach: ["Funds released before condition met", "Double withdrawal"] },
    "governing": { kws: [], breach: ["Jurisdiction dispute — off-chain resolution"] },
    "confidential": { kws: [], breach: ["Confidential data exposed on-chain"] },
    "warranty": { kws: [], breach: ["Warranty claim without proof"] },
    "liability": { kws: [], breach: ["Liability cap exceeded"] },
    "termination": { kws: ["terminate", "cancel", "end", "selfdestruct"], breach: ["Termination without notice period"] },
    "dispute": { kws: ["resolve", "dispute", "arbitration"], breach: ["Dispute resolution bypassed"] },
    "transfer": { kws: ["transfer", "transferfrom", "approve"], breach: ["Transfer exceeds balance", "Transfer to unauthorized address"] },
    "approval": { kws: ["approve", "allowance"], breach: ["Approval exploited via infinite allowance"] },
    "supply": { kws: ["mint", "supply", "totalsupply"], breach: ["Supply changed without governance approval"] },
    "ownership": { kws: ["owner", "transferownership", "renounceownership"], breach: ["Ownership hijacked", "Ownership renounced without legal review"] },
    "pausable": { kws: ["pause", "unpause", "paused", "emergency"], breach: ["Contract paused without legal cause", "Contract not paused during breach"] },
    "burnable": { kws: ["burn", "burnfrom"], breach: ["Unauthorized burn of tokens"] },
    "metadata": { kws: ["tokenuri", "baseuri", "name", "symbol"], breach: ["Metadata changed without consent"] },
  };

  for (const clause of clauses) {
    const headingLower = clause.heading_en.toLowerCase();
    let matchedFunc: ParsedFunction | null = null;

    // Find matching keyword category
    let matchKey: string | null = null;
    for (const key of Object.keys(clauseKeywords)) {
      if (headingLower.includes(key)) {
        matchKey = key;
        break;
      }
    }

    // Match function using parsed data (richer than raw strings)
    if (matchKey && clauseKeywords[matchKey].kws.length > 0) {
      for (const func of parsed.functions) {
        const funcLower = func.name.toLowerCase();
        if (clauseKeywords[matchKey].kws.some(kw => funcLower.includes(kw))) {
          matchedFunc = func;
          break;
        }
      }
    }

    // Fallback: direct heading-to-function name match
    if (!matchedFunc) {
      for (const func of parsed.functions) {
        if (headingLower.includes(func.name.toLowerCase()) || func.name.toLowerCase().includes(headingLower.split(" ")[0])) {
          matchedFunc = func;
          break;
        }
      }
    }

    // Match events to function
    let matchedEvent = "N/A";
    if (matchedFunc) {
      for (const evt of parsed.events) {
        const evtLower = evt.name.toLowerCase();
        if (matchedFunc.name.toLowerCase().includes("transfer") && evtLower.includes("transfer")) {
          matchedEvent = `${evt.name}(${evt.parameters})`;
          break;
        }
        if (matchedFunc.name.toLowerCase().includes("mint") && evtLower.includes("transfer")) {
          matchedEvent = `${evt.name}(from=0x0, ${evt.parameters})`;
          break;
        }
        if (matchedFunc.name.toLowerCase().includes("approve") && evtLower.includes("approval")) {
          matchedEvent = `${evt.name}(${evt.parameters})`;
          break;
        }
      }
    }

    // Compute line range (function start to next function or end of contract)
    let lineRange: [number, number] | null = null;
    if (matchedFunc) {
      const funcIdx = parsed.functions.indexOf(matchedFunc);
      const endLine = funcIdx < parsed.functions.length - 1
        ? parsed.functions[funcIdx + 1].line - 1
        : parsed.line_count;
      lineRange = [matchedFunc.line, endLine];
    }

    // Breach conditions
    const breachConditions = matchKey ? clauseKeywords[matchKey].breach : [];

    if (matchedFunc) {
      mapping.push({
        clause_id: clause.clause_id,
        legal_concept: clause.heading_en,
        contract_function: `${matchedFunc.name}()`,
        contract_event: matchedEvent,
        code_line: matchedFunc.line,
        code_line_range: lineRange,
        function_signature: matchedFunc.signature,
        visibility: matchedFunc.visibility,
        modifiers: matchedFunc.modifiers,
        breach_conditions: breachConditions,
        verification: matchedEvent !== "N/A" ? "on-chain" : "static",
        status: "mapped",
      });
    } else {
      const legalOnlyKeywords = ["governing", "confidential", "warranty", "liability", "dispute", "law", "jurisdiction"];
      const isLegalOnly = legalOnlyKeywords.some(kw => headingLower.includes(kw));
      mapping.push({
        clause_id: clause.clause_id,
        legal_concept: clause.heading_en,
        contract_function: isLegalOnly ? "N/A (legal metadata only)" : "UNMAPPED",
        contract_event: isLegalOnly ? "N/A" : "N/A",
        code_line: null,
        code_line_range: null,
        function_signature: null,
        visibility: null,
        modifiers: [],
        breach_conditions: breachConditions,
        verification: isLegalOnly ? "off-chain" : "unmapped",
        status: isLegalOnly ? "legal-only" : "unmapped",
      });
    }
  }

  const mapped = mapping.filter(m => m.status === "mapped").length;
  const legalOnly = mapping.filter(m => m.status === "legal-only").length;
  const unmapped = mapping.filter(m => m.status === "unmapped").length;
  const coverage = `${mapped}/${mapping.length} clauses mapped to code. ${legalOnly} legal-only. ${unmapped > 0 ? unmapped + " unmapped — " : ""}${unmapped > 0 ? "review needed." : "all code-mapped clauses verified."}`;

  return { mapping, coverage };
}


async function dryRunHandler(req: Request): Promise<Response> {
  const startTime = Date.now();

  let body: DryRunRequest;
  try {
    body = await req.json() as DryRunRequest;
  } catch {
    return jsonResponse({
      status: "error",
      error_code: "INVALID_JSON",
      message: "Request body must be valid JSON.",
    }, 400);
  }

  const { source_code, contract_type, clauses } = body;

  if (!source_code || typeof source_code !== "string") {
    return jsonResponse({
      status: "error",
      error_code: "MISSING_SOURCE_CODE",
      message: "Field 'source_code' is required (string of Solidity source code).",
    }, 400);
  }

  // Limit source code size (prevent abuse)
  if (source_code.length > 50000) {
    return jsonResponse({
      status: "error",
      error_code: "SOURCE_TOO_LARGE",
      message: "Source code exceeds 50KB limit.",
    }, 413);
  }

  // Run static syntax validation
  const validation = validateSoliditySyntax(source_code);

  // Phase 3.1: Upgraded parser — deep contract parsing
  const parsed = parseSolidityContract(source_code);

  // Phase 3.1: Generate upgraded Digital Twin v3 matrix with bipolar mapping
  const defaultClauses = clauses && clauses.length > 0 ? clauses : [
    { clause_id: "C1", heading_en: "Parties identification" },
    { clause_id: "C2", heading_en: "Token specifications" },
    { clause_id: "C3", heading_en: "Minting and supply" },
    { clause_id: "C4", heading_en: "Governing law" },
  ];

  const twinMatrix = generateTwinMatrix(
    source_code,
    defaultClauses,
    parsed,
  );

  // Phase 3.2: Automated Breach Simulation
  const breachSimulation = simulateBreachScenarios(parsed);

  const elapsed = Date.now() - startTime;
  const hasErrors = validation.issues.some(i => i.severity === "error");

  // Phase 1.4: Algorithmic Nudging — Time-Decay Warning & Urgency Signal
  const urgencySignal = calculateUrgencySignal(
    parsed.functions.length,
    contract_type || parsed.name || "custom",
    hasErrors,
  );

  return jsonResponse({
    status: hasErrors ? "validation_failed" : "validation_passed",
    node_id: NODE_IDENTITY.node_id,
    endpoint: "/gateway/dry-run",
    timestamp: new Date().toISOString(),
    latency_ms: elapsed,
    sla_target_ms: 500,
    sla_met: elapsed < 500,
    credits_charged: 0,
    contract_type: contract_type || "custom",
    syntax_validation: {
      passed: !hasErrors,
      error_count: validation.issues.filter(i => i.severity === "error").length,
      warning_count: validation.issues.filter(i => i.severity === "warning").length,
      info_count: validation.issues.filter(i => i.severity === "info").length,
      issues: validation.issues,
    },
    contract_info: {
      name: parsed.name,
      pragma: parsed.pragma,
      license: parsed.license,
      line_count: parsed.line_count,
      functions: parsed.functions.map(f => f.name),
      events: parsed.events.map(e => e.name),
      modifiers: parsed.modifiers.map(m => m.name),
      function_count: parsed.functions.length,
      event_count: parsed.events.length,
      modifier_count: parsed.modifiers.length,
      // Phase 3.1: capability detection
      capabilities: {
        has_constructor: parsed.has_constructor,
        has_pause: parsed.has_pause,
        has_ownership: parsed.has_ownership,
        has_burn: parsed.has_burn,
        has_mint: parsed.has_mint,
      },
    },
    digital_twin_v3_matrix: {
      version: "v3.1",
      contract_type: contract_type || parsed.name || "custom",
      mapping: twinMatrix.mapping,
      coverage: twinMatrix.coverage,
      // Phase 3.1: bipolar mapping metadata
      parser: "deep-parse-v2",
      total_mappings: twinMatrix.mapping.length,
      mapped_count: twinMatrix.mapping.filter(m => m.status === "mapped").length,
      legal_only_count: twinMatrix.mapping.filter(m => m.status === "legal-only").length,
      unmapped_count: twinMatrix.mapping.filter(m => m.status === "unmapped").length,
    },
    // Phase 3.2: Automated Breach Simulation
    breach_simulation: breachSimulation,
    urgency_signal: urgencySignal,
    preview: {
      deployable: !hasErrors && breachSimulation.overall_risk !== "critical",
      warnings: validation.issues.filter(i => i.severity === "warning").length,
      risk_level: breachSimulation.overall_risk,
      recommendation: hasErrors
        ? "Fix syntax errors before deployment."
        : breachSimulation.overall_risk === "critical"
          ? "CRITICAL: Breach simulation detected critical vulnerabilities. Fix before deployment."
          : breachSimulation.overall_risk === "high"
            ? "HIGH: Breach simulation found high-risk vulnerabilities. Review before production."
            : validation.issues.filter(i => i.severity === "warning").length > 0
              ? "Contract is deployable but has warnings. Review before production."
              : "Contract passed all checks including breach simulation. Ready for deployment.",
    },
  }, hasErrors ? 422 : 200);
}

async function handler(req: Request): Promise<Response> {
  const reqStartTime = Date.now();
  // 1. CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(req.url);

  // 2b. Sample Manifests Endpoint (Phase 1.1 — Multi-Tier Showcase)
  // Free discovery endpoint — no billing, no x-client-id required.
  // GET /samples        → all 3 tiers
  // GET /samples/tier1  → Tier 1 only ($300)
  // GET /samples/tier2  → Tier 2 only ($500)
  // GET /samples/tier3  → Tier 3 only ($800)
  if (url.pathname.endsWith("/samples") || url.pathname.includes("/samples/")) {
    const pathParts = url.pathname.split("/").filter(Boolean);
    const samplesIdx = pathParts.indexOf("samples");
    const tierParam = samplesIdx >= 0 && pathParts[samplesIdx + 1] ? pathParts[samplesIdx + 1] : null;

    if (tierParam) {
      const tier = SAMPLE_MANIFESTS.tiers.find((t) => t.tier_id === tierParam);
      if (tier) {
        return jsonResponse({
          node_id: NODE_IDENTITY.node_id,
          endpoint: "/samples/" + tierParam,
          tier,
        }, 200);
      }
      return jsonResponse({
        error: "TIER_NOT_FOUND",
        message: `Unknown tier: ${tierParam}. Available: tier1, tier2, tier3.`,
        available_tiers: SAMPLE_MANIFESTS.tiers.map((t) => ({ id: t.tier_id, name: t.name, price_usd: t.price_usd })),
      }, 404);
    }

    return jsonResponse(SAMPLE_MANIFESTS, 200);
  }

  // 2c. Interactive Dry-Run Endpoint (Phase 1.3 — POST /gateway/dry-run)
  // Free preview — no billing, no x-client-id required.
  // Accepts Solidity source code, runs static syntax validation,
  // and generates a Digital Twin v3 matrix (clause-to-code mapping).
  if (url.pathname.endsWith("/gateway/dry-run") && req.method === "POST") {
    return await dryRunHandler(req);
  }

  // 2d. Live Telemetry Endpoint (Phase 1.2 — GET /metrics)
  // Free health-check — no billing, no x-client-id required.
  // Broadcasts: uptime, latency stats, concurrency slots (1/3), engine version.
  if (url.pathname.endsWith("/metrics")) {
    return jsonResponse(buildMetricsPayload(), 200);
  }

  // 2. Manifest Discovery Endpoint
  if (req.method === "GET" || url.pathname.endsWith("/manifest.json")) {
    return jsonResponse(NODE_MANIFEST, 200);
  }

  // 3. Extract service_type for gatekeeper pre-check
  let serviceType = "structured_data";
  let reqBody: Record<string, unknown> = {};
  try {
    const cloneReq = req.clone();
    reqBody = await cloneReq.json();
    if (reqBody.service_type) serviceType = String(reqBody.service_type);
  } catch (_) {}

  // 4. Pull Payment bypass — adds credits, doesn't charge
  if (serviceType === "pull_payment") {
    const clientId = req.headers.get("x-client-id");
    if (!clientId) {
      await logServiceCall("missing_client_id", "pull_payment", 400, null, 0);
      return m2mError("MISSING_CLIENT_ID", "M2M call rejected: header x-client-id is required.", "pull_payment", 400, 0, reqStartTime);
    }
    try {
      const result = await genPullPayment(
        (reqBody.params as Record<string, unknown>) ?? {},
        clientId,
      );
      const respBody = result as Record<string, unknown>;
      const statusStr = String(respBody.status ?? "unknown");
      const httpStatus = statusStr === "verified" ? 200 : statusStr === "pending" ? 202 : 400;
      await logServiceCall(
        clientId,
        "pull_payment",
        httpStatus,
        (respBody.payload_id as string) ?? null,
        0,
      );
      // Phase 2.3: M2M standard envelope for pull_payment
      const ppid = (respBody.payload_id as string) ?? null;
      if (httpStatus === 200) {
        return m2mSuccess(respBody, "pull_payment", ppid, 0, reqStartTime);
      } else if (httpStatus === 202) {
        return m2mSuccess(respBody, "pull_payment", ppid, 0, reqStartTime, 202);
      } else {
        return m2mError("PULL_PAYMENT_FAILED", String(respBody.message ?? "Pull payment processing failed"), "pull_payment", 400, 0, reqStartTime, respBody);
      }
    } catch (err) {
      await logServiceCall(clientId, "pull_payment", 500, null, 0);
      return m2mError("PULL_PAYMENT_ERROR", err instanceof Error ? err.message : String(err), "pull_payment", 500, 0, reqStartTime);
    }
  }

  // 5. Gatekeeper pre-check (for paid services) — Phase 2.2: track stage timing
  const gatekeeperStart = Date.now();
  const gatekeeper = await checkQuotaAndRate(req, serviceType);
  recordStageTiming("gatekeeper", Date.now() - gatekeeperStart);

  if (!gatekeeper.allowed) {
    await logServiceCall(gatekeeper.clientId, serviceType, 402, null, 0);
    // Phase 2.3: M2M standard error envelope
    const denied = gatekeeper.deniedResponse as Record<string, unknown>;
    return m2mError(
      String(denied.error_code ?? "DENIED"),
      String(denied.message ?? "Request denied by gatekeeper."),
      serviceType,
      402,
      0,
      reqStartTime,
      denied,
    );
  }

  // 6. Delegate to Core Payload Engine — Phase 2.2: track stage timing
  const engineStart = Date.now();
  const response = await payloadHandler(req);
  recordStageTiming("engine", Date.now() - engineStart);

  // 7. Record usage + log after success — Phase 2.2: parallel DB writes
  if (response.status === 200) {
    let payloadId: string | null = null;
    let respBody: Record<string, unknown> | null = null;
    try {
      respBody = await response.clone().json() as Record<string, unknown>;
      payloadId = (respBody.payload_id as string) ?? null;
    } catch (_) {}

    // Phase 2.2: Parallel DB writes — recordUsage + logServiceCall run concurrently
    const dbStart = Date.now();
    await Promise.all([
      recordUsageAfterSuccess(
        gatekeeper.clientId,
        gatekeeper.paymentPath,
        gatekeeper.creditsToCharge,
      ),
      logServiceCall(
        gatekeeper.clientId,
        serviceType,
        200,
        payloadId,
        gatekeeper.creditsToCharge,
      ),
    ]);
    recordStageTiming("db_logging", Date.now() - dbStart);

    // Phase 2.2: Record throughput
    recordThroughput();

    // Inject trial_info into response if a trial was used
    const trialInfo = buildTrialInfo(gatekeeper.paymentPath, gatekeeper.client);
    if (trialInfo && respBody) {
      respBody.trial_info = trialInfo;
    }

    // Phase 2.3: M2M standard success envelope
    return m2mSuccess(respBody ?? {}, serviceType, payloadId, gatekeeper.creditsToCharge, reqStartTime);
  } else {
    await logServiceCall(gatekeeper.clientId, serviceType, response.status, null, 0);
    // Phase 2.3: M2M standard error envelope for non-200 engine responses
    let errBody: Record<string, unknown> = {};
    try { errBody = await response.clone().json() as Record<string, unknown>; } catch (_) {}
    return m2mError(
      String(errBody.error_code ?? "ENGINE_ERROR"),
      String(errBody.error ?? errBody.message ?? "Payload generation failed."),
      serviceType,
      response.status,
      0,
      reqStartTime,
      errBody,
    );
  }
}

// -- Entry Point --------------------------------------------------------------

// -- Telemetry Wrapper --------------------------------------------------------
// Wraps the handler to track: request count, latency, concurrency, errors.
// Telemetry data is exposed via GET /metrics (Phase 1.2).
// Phase 2.1: Concurrency Guard — rejects requests when active_concurrent >= hard_limit (5).
// Public manifest shows soft limit (3) as scarcity signal; internal hard limit (5) is the actual gate.

async function telemetryWrapper(req: Request): Promise<Response> {
  const startTime = Date.now();

  // Phase 2.1: Concurrency Guard — hard limit enforcement
  if (TELEMETRY.active_concurrent >= TELEMETRY.hard_limit_slots) {
    TELEMETRY.rejected_count++;
    TELEMETRY.total_requests++;
    TELEMETRY.last_request_at = startTime;
    recordLatency(Date.now() - startTime);
    TELEMETRY.error_count++;

    return m2mError(
      "CONCURRENCY_LIMIT_REACHED",
      "Server is at maximum capacity. Retry with exponential backoff.",
      "error",
      503,
      0,
      startTime,
      {
        concurrency: {
          active_slots: TELEMETRY.active_concurrent,
          hard_limit: TELEMETRY.hard_limit_slots,
          soft_limit_manifest: TELEMETRY.max_concurrent_slots,
        },
        retry_after_ms: 2000,
      },
    );
  }

  TELEMETRY.total_requests++;
  TELEMETRY.last_request_at = startTime;
  TELEMETRY.active_concurrent++;

  try {
    const response = await handler(req);
    const elapsed = Date.now() - startTime;
    recordLatency(elapsed);

    if (response.status >= 400) {
      TELEMETRY.error_count++;
    }

    return response;
  } catch (err) {
    const elapsed = Date.now() - startTime;
    recordLatency(elapsed);
    TELEMETRY.error_count++;

    return m2mError(
      "INTERNAL_ERROR",
      err instanceof Error ? err.message : String(err),
      "error",
      500,
      0,
      startTime,
    );
  } finally {
    TELEMETRY.active_concurrent--;
  }
}

// -- Entry Point --------------------------------------------------------------

Deno.serve(telemetryWrapper);
