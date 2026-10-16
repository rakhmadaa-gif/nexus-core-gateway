/**
 * w6_forensic.ts — W6 Fitness Forensic (v5.17.0-frontier)
 *
 * Spec: reference/w6-forensic-spec.md v1.0-FINAL + Amendment A1 + Amendment A2.
 *
 * Pipeline (handler in index.ts):
 *   full-tier analysis → top-3 breach scenarios (severity desc, tie scenario_id asc)
 *   → pure deterministic narratives (NO clock, NO RNG — spec §3.c)
 *   → observable_impact (address-mode only; drain-class scoping per Amendment A1:
 *     affected functions MUST contain a value-transfer op, else explicit omit-reason)
 *   → canonical JSON bundle → dual-pin (Pinata primary + Filebase redundant;
 *     <2 legs = 422 DEGRADED_IPFS pre-billing) → EIP-712 attestation whose
 *     resultHash = keccak256(canonicalJson(data)) already covers the CID
 *     (no EIP-712 schema change — spec §3.f).
 *
 * Determinism contract (spec §5): same input (+ same block B in address mode)
 * produces a byte-identical bundle. Wall-clock timestamps live ONLY in the API
 * response wrapper, never inside the pinned bundle.
 */

export const W6_MODEL = {
  service: "fitness/forensic",
  schema_version: "1.0.0",
  spec_version: "1.0-FINAL+A1+A2",
  credits: 350,
  x402_atomic_usdc: "3500000", // $3.50, 6 decimals
  legal_weight: 0,
  disclaimer: "Not legal advice, factual only.",
  // Mirrors full tier (v5.7.0: polygon only, enum open for expansion).
  chains: ["polygon"],
  limits: {
    max_files: 200,
    max_total_bytes: 2 * 1024 * 1024,
    max_packages: 25,
  },
  top_scenarios: 3,
  // 13 dry-run scenario IDs (BS-010/011 are scan-deep only, never in this list).
  scenario_library: [
    "BS-001", "BS-002", "BS-003", "BS-004", "BS-005", "BS-006", "BS-007",
    "BS-008", "BS-009", "BS-012", "BS-013", "BS-014", "BS-015",
  ],
} as const;

// ---------------------------------------------------------------------------
// Input validation (400-class, pre-billing). Mirrors validateFullInput but
// address is OPTIONAL (observable-impact mode activates only when present).
// ---------------------------------------------------------------------------

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

export type ForensicInput = {
  mode: "repo" | "files";
  repo?: string;
  files?: Array<{ path: string; source: string }>;
  packages?: Array<{ name: string; ecosystem?: string; version?: string; origin?: string }>;
  address?: string | null;
  chain: string;
};

export function validateForensicInput(
  body: unknown,
): { ok: true; input: ForensicInput } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "body must be a JSON object." };
  }
  const b = body as Record<string, unknown>;
  const hasRepo = typeof b.repo === "string" && b.repo.length > 0;
  const hasFiles = Array.isArray(b.files);
  if (hasRepo === hasFiles) {
    return { ok: false, error: "exactly one of {repo} or {files} is required." };
  }
  if (hasRepo && !REPO_RE.test(b.repo as string)) {
    return { ok: false, error: "repo must match owner/name (alphanumeric, _, -, .)." };
  }
  // address OPTIONAL (spec §2). When present it must be a deployed-contract
  // address shape; source-match + observable impact then activate.
  let address: string | null = null;
  if (b.address !== undefined && b.address !== null) {
    if (typeof b.address !== "string" || !ADDR_RE.test(b.address)) {
      return { ok: false, error: "address, when supplied, must be 0x + 40 hex chars." };
    }
    address = b.address;
  }
  const chain = typeof b.chain === "string" && b.chain.length > 0 ? b.chain : "polygon";
  if (!(W6_MODEL.chains as readonly string[]).includes(chain)) {
    return {
      ok: false,
      error: `chain must be one of: ${W6_MODEL.chains.join(", ")} (v5.17.0; enum open for expansion).`,
    };
  }
  const packages = parsePackagesField(b.packages);
  if (typeof packages === "string") return { ok: false, error: packages };
  if (hasFiles) {
    const files = b.files as Array<Record<string, unknown>>;
    if (files.length > W6_MODEL.limits.max_files) {
      return { ok: false, error: `files: max ${W6_MODEL.limits.max_files} entries.` };
    }
    let total = 0;
    const norm: Array<{ path: string; source: string }> = [];
    for (const f of files) {
      const src = typeof f.source === "string" ? f.source
        : typeof f.content === "string" ? f.content : null; // accept both, normalize to source
      if (typeof f.path !== "string" || src === null) {
        return { ok: false, error: "each file needs {path: string, source: string}." };
      }
      total += src.length;
      norm.push({ path: f.path, source: src });
    }
    if (total > W6_MODEL.limits.max_total_bytes) {
      return { ok: false, error: "files: total size exceeds 2 MiB." };
    }
    return { ok: true, input: { mode: "files", files: norm, packages, address, chain } };
  }
  return { ok: true, input: { mode: "repo", repo: b.repo as string, packages, address, chain } };
}

function parsePackagesField(
  raw: unknown,
): Array<{ name: string; ecosystem?: string; version?: string; origin?: string }> | string {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return "packages must be an array of {name, ecosystem?, version?}.";
  if (raw.length > W6_MODEL.limits.max_packages) {
    return `packages: max ${W6_MODEL.limits.max_packages} entries.`;
  }
  const out: Array<{ name: string; ecosystem?: string; version?: string; origin?: string }> = [];
  for (const p of raw) {
    if (typeof p !== "object" || p === null || typeof (p as Record<string, unknown>).name !== "string") {
      return "each package needs {name: string}.";
    }
    const r = p as Record<string, unknown>;
    out.push({
      name: r.name as string,
      ecosystem: typeof r.ecosystem === "string" ? r.ecosystem : undefined,
      version: typeof r.version === "string" ? r.version : undefined,
      origin: "input",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Top-3 scenario selection (spec §3.b): detected only, severity desc,
// tie-break scenario_id asc. Pure and deterministic.
// ---------------------------------------------------------------------------

export const SEV_RANK: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 0 };

export interface ScenarioLike {
  scenario_id: string;
  scenario_name: string;
  description: string;
  risk_level: string;
  affected_functions: string[];
  mitigation: string;
  detected: boolean;
}

export interface MergedScenario {
  scenario: ScenarioLike;
  detected_in: string[];
}

/**
 * Merge per-file simulation results into one scenario map. Worst severity
 * wins per scenario_id; affected_functions unioned in first-seen order;
 * detected_in records every file that fired the scenario (input order).
 * Deterministic: files and scenarios arrive in stable engine order.
 */
export function mergeScenarios(
  perFile: Array<{ file: string; scenarios: ScenarioLike[] }>,
): MergedScenario[] {
  const map = new Map<string, MergedScenario>();
  for (const pf of perFile) {
    for (const s of pf.scenarios) {
      const existing = map.get(s.scenario_id);
      if (!existing) {
        map.set(s.scenario_id, {
          scenario: { ...s, affected_functions: [...s.affected_functions] },
          detected_in: s.detected ? [pf.file] : [],
        });
        continue;
      }
      const ex = existing;
      if (s.detected && !ex.detected_in.includes(pf.file)) ex.detected_in.push(pf.file);
      ex.scenario.detected = ex.scenario.detected || s.detected;
      if ((SEV_RANK[s.risk_level] ?? 0) > (SEV_RANK[ex.scenario.risk_level] ?? 0)) {
        ex.scenario.risk_level = s.risk_level;
      }
      for (const fn of s.affected_functions) {
        if (!ex.scenario.affected_functions.includes(fn)) ex.scenario.affected_functions.push(fn);
      }
    }
  }
  return [...map.values()];
}

export function selectTopScenarios(merged: MergedScenario[], top = W6_MODEL.top_scenarios): MergedScenario[] {
  return merged
    .filter((m) => m.scenario.detected)
    .sort((a, b) => {
      const d = (SEV_RANK[b.scenario.risk_level] ?? 0) - (SEV_RANK[a.scenario.risk_level] ?? 0);
      if (d !== 0) return d;
      return a.scenario.scenario_id < b.scenario.scenario_id ? -1
        : a.scenario.scenario_id > b.scenario.scenario_id ? 1 : 0;
    })
    .slice(0, top);
}

// ---------------------------------------------------------------------------
// Narrative generation (spec §3.c) — pure functions over scenario data.
// NO clock, NO RNG, NO I/O. Slot-bound to detection evidence so the text
// cannot drift from what the engine actually found.
// ---------------------------------------------------------------------------

export interface NarrativeContext {
  chain: string;
  gas_asymmetry?: Record<string, unknown> | null;
}

export interface ForensicNarrative {
  scenario_id: string;
  scenario_name: string;
  severity: string;
  detected_in: string[];
  entry_points: string[];
  prerequisites: string[];
  attack_path: string[];
  evidence: Record<string, unknown>;
  mitigation: string;
}

function fnList(fns: string[]): string {
  return fns.length > 0 ? fns.join(", ") : "(unresolved function name)";
}

type NarrativeParts = { prerequisites: string[]; attack_path: string[]; evidence_extra?: Record<string, unknown> };

const NARRATIVE_BUILDERS: Record<string, (s: ScenarioLike, ctx: NarrativeContext) => NarrativeParts> = {
  "BS-001": (s) => ({
    prerequisites: [
      "an externally owned account — no special role is required",
      "a mint-like entry point callable without an authorization check",
    ],
    attack_path: [
      `call ${fnList(s.affected_functions)} from any account`,
      "the token supply increases without the caller being verified",
      "newly minted supply is sold or used to dilute existing holders",
    ],
  }),
  "BS-002": (s) => ({
    prerequisites: [
      "an externally owned account",
      "a transfer path intended to be restricted is callable",
    ],
    attack_path: [
      `call ${fnList(s.affected_functions)}`,
      "token balances move without the intended restriction being enforced",
    ],
  }),
  "BS-003": (s) => ({
    prerequisites: [
      "an externally owned account",
      "a withdrawal or payout entry point lacks authorization checks",
    ],
    attack_path: [
      `call ${fnList(s.affected_functions)}`,
      "contract-held value is paid out to an address the caller controls",
    ],
  }),
  "BS-004": (s) => ({
    prerequisites: ["a privileged account (owner/role) controls the freeze mechanism"],
    attack_path: [
      `the privileged caller triggers the freeze mechanism (${fnList(s.affected_functions)})`,
      "user-facing transfers and operations halt until the contract is unpaused",
    ],
    evidence_extra: {
      posture_note: "a freeze capability is a centralization property, not an exploit — reported as factual posture",
    },
  }),
  "BS-005": (s) => ({
    prerequisites: ["the current owner still controls the contract"],
    attack_path: [
      `the owner calls ${fnList(s.affected_functions)}`,
      "admin functions become permanently uncallable — no upgrade or configuration path remains",
    ],
  }),
  "BS-006": (s) => ({
    prerequisites: [
      "an attacker contract with a malicious fallback/receive function",
      "an affected function performs an external call before its state settles",
    ],
    attack_path: [
      `call ${fnList(s.affected_functions)} from the attacker contract`,
      "re-enter the same function via the fallback before the first call updates state",
      "repeat until funds are drained or accounting diverges from reality",
    ],
  }),
  "BS-007": (s) => ({
    prerequisites: ["a valid signed authorization captured from a victim or a previous transaction"],
    attack_path: [
      `replay the captured signature against ${fnList(s.affected_functions)}`,
      "the contract accepts it again because nonce/chain binding is absent or weak",
    ],
  }),
  "BS-008": (s, ctx) => {
    const ga = (ctx.gas_asymmetry ?? {}) as Record<string, unknown>;
    const ratio = typeof ga.compute_to_gas_ratio === "number" ? ga.compute_to_gas_ratio : null;
    return {
      prerequisites: ["the ability to craft transaction inputs — no privileges required"],
      attack_path: [
        "submit transactions that hit the underpriced compute pattern",
        `validators spend far more CPU/RAM than the gas charged (compute_to_gas_ratio ${ratio ?? "n/a"})`,
        "block validation is delayed network-wide",
      ],
      evidence_extra: { gas_asymmetry: ctx.gas_asymmetry ?? null },
    };
  },
  "BS-009": (s) => ({
    prerequisites: ["an attacker-influenceable collection grows without a cap"],
    attack_path: [
      "grow the collection through the public append path",
      `iteration in ${fnList(s.affected_functions)} becomes O(n) over attacker-controlled length`,
      "the function exceeds the block gas limit and becomes uncallable — funds or payouts freeze",
    ],
  }),
  "BS-012": (s) => ({
    prerequisites: ["the ability to observe or influence block-level entropy (timestamp/number/prevrandao/blockhash)"],
    attack_path: [
      `predict or grind the entropy consumed by ${fnList(s.affected_functions)}`,
      "call the function only when the outcome favors the caller",
      "extract value from outcomes the designer intended to be random",
    ],
  }),
  "BS-013": (s) => ({
    prerequisites: ["an externally owned account"],
    attack_path: [
      `call ${fnList(s.affected_functions)}, which assigns owner/admin without an authorization check`,
      "the caller takes over the privileged role and every function gated behind it",
    ],
  }),
  "BS-014": (s) => ({
    prerequisites: ["a governance vote path that never verifies the proposal exists"],
    attack_path: [
      `call ${fnList(s.affected_functions)} with a proposalId that was never proposed`,
      "the phantom proposal enters tally and ranking paths",
      "rewards or outcomes allocated to that rank become claimable by the phantom's voters",
    ],
  }),
  "BS-015": (s, ctx) => ({
    prerequisites: [`this bytecode is deployed on ${ctx.chain}`],
    attack_path: [
      `calls to HyperCore read precompiles (0x0800-0x0813) or CoreWriter (0x3333...3333) hit empty code on ${ctx.chain}`,
      "HyperCore reads/writes revert or silently no-op",
      "any integration depending on HyperCore state is bricked",
    ],
  }),
};

function genericNarrative(s: ScenarioLike): NarrativeParts {
  return {
    prerequisites: ["an externally owned account"],
    attack_path: [
      `call ${fnList(s.affected_functions)}`,
      s.description,
    ],
  };
}

export function buildNarrative(m: MergedScenario, ctx: NarrativeContext): ForensicNarrative {
  const s = m.scenario;
  const builder = NARRATIVE_BUILDERS[s.scenario_id] ?? genericNarrative;
  const parts = builder(s, ctx);
  return {
    scenario_id: s.scenario_id,
    scenario_name: s.scenario_name,
    severity: s.risk_level,
    detected_in: [...m.detected_in],
    entry_points: [...s.affected_functions],
    prerequisites: parts.prerequisites,
    attack_path: parts.attack_path,
    evidence: {
      description: s.description,
      risk_level: s.risk_level,
      affected_functions: [...s.affected_functions],
      detected_in: [...m.detected_in],
      ...(parts.evidence_extra ?? {}),
    },
    mitigation: s.mitigation,
  };
}

// ---------------------------------------------------------------------------
// Observable impact (spec §3.d + Amendment A1).
// Drain-class scoping (A1): observable_impact is computed ONLY for scenarios
// whose affected functions contain a value-transfer op. Otherwise the entry
// is omitted with the exact A1.1 reason string. Source-only mode omits all.
// ---------------------------------------------------------------------------

export const OMIT_REASON_NO_VALUE_TRANSFER =
  "no value-transfer operation in affected functions — economic observation not applicable";
export const OMIT_REASON_SOURCE_ONLY =
  "source-only mode (no contract address supplied) — economic observation not applicable";
export const OMIT_REASON_TOKEN_ENUM =
  "token balance enumeration omitted — the set of relevant token contracts is not derivable from the address alone without an indexer; native balance only";
export const OBSERVED_LABEL = "observed state at block B, not a loss prediction";

// A1: value-transfer ops = call-with-value (modern + legacy), transfer, transferFrom.
const VALUE_TRANSFER_RE = /\.call\s*\{[^}]*\bvalue\s*:|\.call\s*\.\s*value\s*\(|\.transfer\s*\(|\.transferFrom\s*\(/;

export function isDrainClass(
  scenario: ScenarioLike,
  fnBody: (name: string) => string | undefined,
): boolean {
  for (const name of scenario.affected_functions) {
    const body = fnBody(name);
    if (body && VALUE_TRANSFER_RE.test(body)) return true;
  }
  return false;
}

const RPC_BY_CHAIN: Record<string, string> = {
  polygon: "https://polygon-bor-rpc.publicnode.com",
};

async function rpcCall(url: string, method: string, params: unknown[], timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(`RPC ${method}: ${j.error.message ?? JSON.stringify(j.error)}`);
  return j.result;
}

export type ObservableState =
  | { ok: true; chain: string; address: string; block_number: number; native_balance_wei: string }
  | { ok: false; error: string };

/**
 * Read native balance at the current latest block B (recorded, never
 * silently re-read — the cached response keeps the original B, spec §3.d).
 */
export async function fetchObservableState(
  address: string,
  chain: string,
  timeoutMs = 10_000,
): Promise<ObservableState> {
  const rpc = RPC_BY_CHAIN[chain];
  if (!rpc) return { ok: false, error: `no RPC configured for chain ${chain}` };
  try {
    const blockHex = await rpcCall(rpc, "eth_blockNumber", [], timeoutMs) as string;
    const blockNumber = parseInt(blockHex, 16);
    const balHex = await rpcCall(rpc, "eth_getBalance", [address, blockHex], timeoutMs) as string;
    return {
      ok: true,
      chain,
      address: address.toLowerCase(),
      block_number: blockNumber,
      native_balance_wei: BigInt(balHex).toString(),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface ObservableEntry {
  scenario_id: string;
  status: "observed" | "omitted" | "unavailable";
  omit_reason?: string;
  label?: string;
  chain?: string;
  address?: string;
  block_number?: number;
  native_balance_wei?: string;
  token_note?: string;
  error?: string;
}

/**
 * Build one observable_impact entry per selected scenario (A1 scoping).
 * `state` is the single shared read (block B) reused across scenarios.
 * Pure when `state` is supplied — I/O happens once in fetchObservableState.
 */
export function buildObservableImpact(
  selected: MergedScenario[],
  opts: {
    address: string | null;
    state: ObservableState | null;
    fnBody: (name: string) => string | undefined;
  },
): ObservableEntry[] {
  return selected.map((m) => {
    const s = m.scenario;
    if (!opts.address) {
      return { scenario_id: s.scenario_id, status: "omitted", omit_reason: OMIT_REASON_SOURCE_ONLY };
    }
    if (!isDrainClass(s, opts.fnBody)) {
      return { scenario_id: s.scenario_id, status: "omitted", omit_reason: OMIT_REASON_NO_VALUE_TRANSFER };
    }
    if (!opts.state || !opts.state.ok) {
      return {
        scenario_id: s.scenario_id,
        status: "unavailable",
        error: (opts.state && !opts.state.ok) ? opts.state.error : "state read not performed",
      };
    }
    return {
      scenario_id: s.scenario_id,
      status: "observed",
      label: OBSERVED_LABEL,
      chain: opts.state.chain,
      address: opts.state.address,
      block_number: opts.state.block_number,
      native_balance_wei: opts.state.native_balance_wei,
      token_note: OMIT_REASON_TOKEN_ENUM,
    };
  });
}

// ---------------------------------------------------------------------------
// Canonical bundle (spec §3.e) — the pinned artifact. Deterministic:
// no wall-clock fields. Block B (address mode) is part of the input.
// ---------------------------------------------------------------------------

export function buildForensicBundle(args: {
  subject: Record<string, unknown>;
  engine_version: string;
  detected_scenario_ids: string[];
  selected: ForensicNarrative[];
  observable_impact: ObservableEntry[];
}): Record<string, unknown> {
  return {
    schema_version: "w6-forensic/1.0",
    report_type: "nexus_fitness_forensic",
    legal_weight: 0,
    disclaimer: W6_MODEL.disclaimer,
    engine_version: args.engine_version,
    subject: args.subject,
    scenario_selection: {
      rule: "top 3 by severity desc, tie scenario_id asc",
      detected_count: args.detected_scenario_ids.length,
      detected_scenario_ids: args.detected_scenario_ids,
      selected_scenario_ids: args.selected.map((n) => n.scenario_id),
    },
    narratives: args.selected,
    observable_impact: args.observable_impact,
    scenario_library: W6_MODEL.scenario_library,
    spec_version: W6_MODEL.spec_version,
  };
}

// ---------------------------------------------------------------------------
// Dual IPFS pinning (spec §3.e + Amendment A2: Pinata primary, Filebase
// redundant via the Pinning Services API). <2 healthy legs = degraded.
// ---------------------------------------------------------------------------

export interface PinLeg {
  provider: "pinata" | "filebase";
  ok: boolean;
  cid?: string;
  http_status?: number;
  error?: string;
  latency_ms: number;
}

export interface DualPinResult {
  ok: boolean;
  cid: string | null;
  legs: PinLeg[];
  gateway_urls: string[];
}

// Byte-exact pin of the canonical JSON string to Pinata (pinFileToIPFS).
// We deliberately upload the canonical bytes (not pinJSONToIPFS) so the CID
// is a pure function of OUR bytes — this is what makes the Filebase leg
// verifiable via content addressing (Amendment A2 impl note, 2026-10-16).
export async function pinBytesToPinata(canonical: string, jwt: string, timeoutMs = 15_000): Promise<PinLeg> {
  const t0 = Date.now();
  try {
    const fd = new FormData();
    fd.append("file", new Blob([canonical], { type: "application/json" }), "bundle.json");
    fd.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));
    const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}` },
      body: fd,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || typeof j.IpfsHash !== "string") {
      return { provider: "pinata", ok: false, http_status: res.status, error: `HTTP ${res.status}: ${JSON.stringify(j).slice(0, 300)}`, latency_ms: Date.now() - t0 };
    }
    return { provider: "pinata", ok: true, cid: j.IpfsHash, http_status: res.status, latency_ms: Date.now() - t0 };
  } catch (e) {
    return { provider: "pinata", ok: false, error: e instanceof Error ? e.message : String(e), latency_ms: Date.now() - t0 };
  }
}

// Filebase leg via the IPFS RPC API (`add`), NOT the Pinning Service API —
// PSA remote-pin AND RPC pin/add-by-CID both require a paid Filebase plan,
// while `add` (direct content upload) works on the free tier. Uploading the
// identical canonical bytes with cid-version=1 + raw-leaves yields the SAME
// CID as the Pinata leg (verified live 2026-10-16), enforced by the caller.
export async function addFileToFilebase(canonical: string, name: string, token: string, timeoutMs = 15_000): Promise<PinLeg> {
  const t0 = Date.now();
  try {
    const fd = new FormData();
    fd.append("file", new Blob([canonical], { type: "application/json" }), `${name}.json`);
    const res = await fetch("https://rpc.filebase.io/api/v0/add?cid-version=1&raw-leaves=true&pin=true", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || typeof j.Hash !== "string") {
      return { provider: "filebase", ok: false, http_status: res.status, error: `HTTP ${res.status}: ${JSON.stringify(j).slice(0, 300)}`, latency_ms: Date.now() - t0 };
    }
    return { provider: "filebase", ok: true, cid: j.Hash, http_status: res.status, latency_ms: Date.now() - t0 };
  } catch (e) {
    return { provider: "filebase", ok: false, error: e instanceof Error ? e.message : String(e), latency_ms: Date.now() - t0 };
  }
}

export async function pinBundleDual(
  canonicalJson: string,
  opts: { pinataJwt: string | null; filebaseToken: string | null; name?: string; timeoutMs?: number },
): Promise<DualPinResult> {
  const legs: PinLeg[] = [];
  if (!opts.pinataJwt || !opts.filebaseToken) {
    if (!opts.pinataJwt) legs.push({ provider: "pinata", ok: false, error: "PINATA_JWT secret not configured", latency_ms: 0 });
    if (!opts.filebaseToken) legs.push({ provider: "filebase", ok: false, error: "FILEBASE_TOKEN secret not configured", latency_ms: 0 });
    return { ok: false, cid: null, legs, gateway_urls: [] };
  }
  const pinata = await pinBytesToPinata(canonicalJson, opts.pinataJwt, opts.timeoutMs);
  legs.push(pinata);
  if (!pinata.ok || !pinata.cid) return { ok: false, cid: null, legs, gateway_urls: [] };
  const filebase = await addFileToFilebase(canonicalJson, opts.name ?? "nexus-fitness-forensic", opts.filebaseToken, opts.timeoutMs);
  legs.push(filebase);
  if (!filebase.ok) return { ok: false, cid: pinata.cid, legs, gateway_urls: [] };
  // Content-addressing integrity: both legs MUST land on the same CID —
  // anything else means the pinned evidence is not the canonical bundle.
  if (filebase.cid !== pinata.cid) {
    legs[legs.length - 1] = { ...filebase, ok: false, error: `cid_mismatch (pinata:${pinata.cid} filebase:${filebase.cid})` };
    return { ok: false, cid: pinata.cid, legs, gateway_urls: [] };
  }
  const cid = pinata.cid;
  return {
    ok: true,
    cid,
    legs,
    gateway_urls: [
      `https://gateway.pinata.cloud/ipfs/${cid}`,
      `https://ipfs.filebase.io/ipfs/${cid}`,
      `https://ipfs.io/ipfs/${cid}`,
    ],
  };
}
