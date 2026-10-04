// ---------------------------------------------------------------------------
// W3 — FITNESS FULL TIER (spec v1.0-FINAL, reference/w3-fitness-full-spec.md)
// /x402/fitness/full — $2.25 (225 CRED)
//
// Scope of THIS module (decision-independent parts, built pre-D1):
//   - input validation (spec §5, 400-class)
//   - exploitability score formula (spec §3.1, fixed published weights)
//   - component calculators: cvss / reachability / exploit_maturity /
//     freshness_penalty / asset_exposure
//   - source-match via Blockscout explorer (D1 decision, user-ratified
//     2026-10-04: source-match, NOT self-compile — self-compile deferred to
//     v5.8+). "unverified contract" is itself a factual fitness signal.
//   - cache policy: cache hit still charges full price (D2 decision,
//     user-ratified 2026-10-04 — cache = speed, not discount; consistent
//     with fitness/lite and scan wrapper).
//
// legal_weight: 0 — factual only. Deterministic: same input = same output.
// ---------------------------------------------------------------------------

export const W3_MODEL = {
  service: "fitness/full",
  schema_version: "1.0.0",
  spec_version: "1.0-FINAL",
  credits: 225,
  x402_atomic_usdc: "2250000", // 6 decimals
  legal_weight: 0,
  disclaimer: "Not legal advice, factual only",
  chains: ["polygon"], // v5.7.0: polygon only (spec D3), enum open for expansion
  limits: {
    max_files: 200,
    max_total_bytes: 2 * 1024 * 1024,
  },
  exploitability_weights: {
    cvss: 0.35,
    reachability: 0.25,
    exploit_maturity: 0.15,
    freshness_penalty: 0.15,
    asset_exposure: 0.10,
  },
  // Neutral defaults when a data source is unavailable (spec §3.1/§4)
  neutral: {
    cvss: 50,
    reachability: 50,
    exploit_maturity: 30,
    asset_exposure: 50,
  },
} as const;

// ---------------------------------------------------------------------------
// Source-match (D1: explorer-based) — factual comparison of the submitted
// source against the explorer-verified on-chain source for `address`.
// NOT a bytecode compilation: we compare normalized source text.
// ---------------------------------------------------------------------------

export type SourceMatchResult = {
  address: string;
  chain: string;
  explorer_verified: boolean;
  source_hash: string; // sha256 of normalized submitted source
  explorer_source_hash: string; // sha256 of normalized explorer source
  match: boolean;
  match_ratio: number; // 0.0-1.0 fuzzy similarity after normalization
  metadata_note: string; // factual explanation
};

/** Normalize Solidity source for deterministic comparison: strip comments,
 *  collapse whitespace, drop pragma/spec version lines. */
export function normalizeSourceForMatch(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
    .replace(/\/\/[^\n]*/g, "") // line comments
    .replace(/^\s*pragma\s+solidity[^;]*;\s*$/gm, "") // pragma lines
    .replace(/\s+/g, " ")
    .trim();
}

/** Deterministic similarity ratio between two normalized strings (0.0-1.0).
 *  Line-free character bigram Jaccard — cheap, stable, good enough for
 *  "is this the same code" without overclaiming. */
export function similarityRatio(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const grams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const A = grams(a), B = grams(b);
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 1 : inter / union;
}

/** Fetch explorer-verified source for an address on a chain.
 *  Returns { kind: "verified"|"unverified"|"no_code"|"unavailable", ... }. */
export async function fetchExplorerSource(
  address: string,
  chain: string,
  fetchFn: typeof fetch = fetch,
): Promise<
  | { kind: "verified"; source: string; name: string | null; compiler: string | null }
  | { kind: "unverified" }
  | { kind: "no_code" }
  | { kind: "unavailable"; error: string }
> {
  // v5.7.0: polygon only (spec D3). Chain map open for expansion.
  const explorers: Record<string, string> = {
    polygon: "https://polygon.blockscout.com/api/v2",
  };
  const base = explorers[chain];
  if (!base) return { kind: "unavailable", error: `chain ${chain} not supported in v5.7.x` };
  try {
    const res = await fetchFn(`${base}/smart-contracts/${address}`, {
      headers: { "User-Agent": "nexus-gateway" },
    });
    if (res.status === 404) return { kind: "no_code" };
    if (!res.ok) return { kind: "unavailable", error: `explorer HTTP ${res.status}` };
    const d = (await res.json()) as Record<string, unknown>;
    const verified = d.is_verified === true || d.is_verified_via_verifier_alliance === true ||
      d.is_verified_via_eth_bytecode_db === true;
    if (!verified) return { kind: "unverified" };
    const source = String(d.source_code ?? "");
    if (!source) return { kind: "unverified" };
    return {
      kind: "verified",
      source,
      name: typeof d.name === "string" ? d.name : null,
      compiler: typeof d.compiler_version === "string" ? d.compiler_version : null,
    };
  } catch (e) {
    return { kind: "unavailable", error: e instanceof Error ? e.message : String(e) };
  }
}

/** Build the factual source-match result. Fuzzy ratio after normalization —
 *  metadata_note explains the cause factually, never speculates. */
export async function buildSourceMatch(
  submittedFiles: Array<{ path: string; source: string }>,
  address: string,
  chain: string,
  sha256Hex: (s: string) => Promise<string>,
  fetchFn: typeof fetch = fetch,
): Promise<SourceMatchResult | { unavailable: string } | { no_code: true } | { unverified: true }> {
  const explorer = await fetchExplorerSource(address, chain, fetchFn);
  if (explorer.kind === "no_code") return { no_code: true };
  if (explorer.kind === "unavailable") return { unavailable: explorer.error };
  // Concatenate submitted sources in stable path order.
  const submitted = [...submittedFiles]
    .sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0))
    .map((f) => f.source)
    .join("\n");
  const normSub = normalizeSourceForMatch(submitted);
  const source_hash = await sha256Hex(normSub);
  if (explorer.kind === "unverified") {
    // Unverified contract is itself a factual fitness signal — report it.
    return {
      address, chain, explorer_verified: false,
      source_hash, explorer_source_hash: "",
      match: false, match_ratio: 0,
      metadata_note: "Contract at this address is not verified on the explorer. On-chain source could not be compared. Unverified deployed code is a factual fitness signal.",
    };
  }
  const normExp = normalizeSourceForMatch(explorer.source);
  const explorer_source_hash = await sha256Hex(normExp);
  const ratio = similarityRatio(normSub, normExp);
  const match = normSub === normExp;
  let note: string;
  if (match) {
    note = "Submitted source is byte-identical to the explorer-verified source (after comment/whitespace/pragma normalization).";
  } else if (ratio >= 0.95) {
    note = "Submitted source is near-identical to the explorer-verified source (normalized). Minor differences exist — see match_ratio.";
  } else {
    note = "Submitted source differs from the explorer-verified source (normalized). match_ratio quantifies the difference. This is a factual comparison, not a security judgment.";
  }
  return {
    address, chain, explorer_verified: true,
    source_hash, explorer_source_hash,
    match, match_ratio: Math.round(ratio * 1000) / 1000,
    metadata_note: note,
  };
}

// ---------------------------------------------------------------------------
// Input validation — spec §5. Returns { ok: true, mode } or { ok: false, error }
// All failures are HTTP 400, credits_charged 0, raised BEFORE any fetch/billing.
// ---------------------------------------------------------------------------

export type W3Input = {
  mode: "repo" | "files";
  repo?: string;
  files?: Array<{ path: string; source: string }>;
  packages?: Array<{ name: string; ecosystem?: string; version?: string }>;
  address: string;
  chain: string;
};

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

export function validateFullInput(
  body: unknown,
): { ok: true; input: W3Input } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Body must be a JSON object." };
  }
  const b = body as Record<string, unknown>;
  const hasRepo = typeof b.repo === "string" && b.repo.length > 0;
  const hasFiles = Array.isArray(b.files) && b.files.length > 0;
  if (hasRepo && hasFiles) {
    return { ok: false, error: "Provide either {repo} or {files}, not both (XOR)." };
  }
  if (!hasRepo && !hasFiles) {
    return { ok: false, error: "Provide {repo: 'owner/name'} or {files: [...]}." };
  }
  if (hasRepo && !REPO_RE.test(b.repo as string)) {
    return { ok: false, error: "repo must match owner/name (alphanumeric, _, -, .)." };
  }
  // address REQUIRED (spec §2: bytecode_match is the tier differentiator)
  if (typeof b.address !== "string" || !ADDR_RE.test(b.address)) {
    return { ok: false, error: "address required: 0x + 40 hex chars (deployed contract)." };
  }
  const chain = typeof b.chain === "string" && b.chain.length > 0 ? b.chain : "polygon";
  if (!(W3_MODEL.chains as readonly string[]).includes(chain)) {
    return {
      ok: false,
      error: `chain must be one of: ${W3_MODEL.chains.join(", ")} (v5.7.0; enum open for expansion).`,
    };
  }
  if (hasFiles) {
    const files = b.files as Array<Record<string, unknown>>;
    if (files.length > W3_MODEL.limits.max_files) {
      return { ok: false, error: `files: max ${W3_MODEL.limits.max_files} entries.` };
    }
    let total = 0;
    const norm: Array<{ path: string; source: string }> = [];
    for (const f of files) {
      // Field name is `source` (aligned with fitness/lite; spec draft said `content`)
      const src = typeof f.source === "string" ? f.source
        : typeof f.content === "string" ? f.content : null; // accept both, normalize to source
      if (typeof f.path !== "string" || src === null) {
        return { ok: false, error: "each file needs {path: string, source: string}." };
      }
      total += src.length;
      norm.push({ path: f.path, source: src });
    }
    if (total > W3_MODEL.limits.max_total_bytes) {
      return { ok: false, error: "files: total size exceeds 2 MiB." };
    }
    // W3.1: optional packages list (max 25) — drives per-advisory exploitability.
    const packages = parsePackagesField(b.packages);
    if (typeof packages === "string") return { ok: false, error: packages };
    return { ok: true, input: { mode: "files", files: norm, packages, address: b.address as string, chain } };
  }
  const packages = parsePackagesField(b.packages);
  if (typeof packages === "string") return { ok: false, error: packages };
  return { ok: true, input: { mode: "repo", repo: b.repo as string, packages, address: b.address as string, chain } };
}

function parsePackagesField(
  v: unknown,
): Array<{ name: string; ecosystem?: string; version?: string }> | string {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return "packages must be an array: [{name, ecosystem?, version?}].";
  if (v.length > 25) return "packages: max 25 entries.";
  const out: Array<{ name: string; ecosystem?: string; version?: string }> = [];
  for (const p of v) {
    if (typeof p !== "object" || p === null || typeof (p as Record<string, unknown>).name !== "string" ||
      (p as Record<string, unknown>).name.length === 0) {
      return "each package needs {name: string} (ecosystem/version optional).";
    }
    const r = p as Record<string, unknown>;
    out.push({
      name: r.name as string,
      ecosystem: typeof r.ecosystem === "string" ? r.ecosystem : undefined,
      version: typeof r.version === "string" ? r.version : undefined,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// W3.1: automatic dependency extraction from Solidity import directives.
// Import statements are top-level AST constructs — a directive-level scan is
// the deterministic, compile-free way to detect dependencies (no guessing
// inside function bodies). Maps import paths to package names.
// ---------------------------------------------------------------------------

/** Dev/test tooling — never runtime attack surface. */
const DEV_TOOLING_PACKAGES = new Set(["forge-std", "ds-test", "ds-script", "script", "test"]);

/** Well-known Solidity library path -> npm package name. */
const IMPORT_PACKAGE_ALIASES: Array<[RegExp, string]> = [
  [/^@openzeppelin\/contracts-upgradeable\//, "@openzeppelin/contracts-upgradeable"],
  [/^openzeppelin\/contracts\//, "@openzeppelin/contracts"],
  [/^solady\//, "solady"],
  [/^solmate\//, "solmate"],
  [/^murky\//, "murky"],
  [/^erc4626\//, "erc4626"],
];

/** Extract dependency packages imported by the given .sol sources.
 *  Returns [{name, ecosystem, origin: "imports"}] — deterministic order. */
export function extractSolidityImports(
  files: Array<{ path: string; source: string }>,
): Array<{ name: string; ecosystem: string; origin: "imports" }> {
  const found = new Map<string, { name: string; ecosystem: string; origin: "imports" }>();
  // Import directives: `import "path";` / `import X from "path";` / `import {a,b} from "path";`
  const importRe = /import\s+(?:[\w{},\s]+\s+from\s+)?["']([^"']+)["']/g;
  for (const f of files) {
    let m: RegExpExecArray | null;
    importRe.lastIndex = 0;
    while ((m = importRe.exec(f.source)) !== null) {
      const pkg = mapImportPathToPackage(m[1]);
      if (pkg && !found.has(pkg)) found.set(pkg, { name: pkg, ecosystem: "npm", origin: "imports" });
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function mapImportPathToPackage(importPath: string): string | null {
  // Local/relative imports are not external dependencies.
  if (importPath.startsWith("./") || importPath.startsWith("../") || importPath.startsWith("/")) return null;
  for (const [re, alias] of IMPORT_PACKAGE_ALIASES) {
    if (re.test(importPath)) return alias;
  }
  // Scoped packages: @scope/name/... -> @scope/name
  if (importPath.startsWith("@")) {
    const parts = importPath.split("/");
    if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
    return null;
  }
  // Bare paths: name/... -> name (skip dev tooling; single file names are local)
  if (!importPath.includes("/")) return null;
  const first = importPath.split("/")[0];
  if (!first || DEV_TOOLING_PACKAGES.has(first)) return null;
  return first;
}

/** Merge user-supplied packages with auto-extracted imports (dedup, cap 25).
 *  User-supplied wins on ecosystem/version; imports add origin "imports". */
export function mergeDependencyLists(
  userPackages: Array<{ name: string; ecosystem?: string; version?: string }> | undefined,
  imported: Array<{ name: string; ecosystem: string; origin: "imports" }>,
): {
  packages: Array<{ name: string; ecosystem: string; version?: string; origin: "input" | "imports" }>;
  truncated: boolean;
} {
  const merged = new Map<string, { name: string; ecosystem: string; version?: string; origin: "input" | "imports" }>();
  for (const p of userPackages ?? []) {
    merged.set(p.name.toLowerCase(), { name: p.name, ecosystem: p.ecosystem ?? "npm", version: p.version, origin: "input" });
  }
  for (const p of imported) {
    const key = p.name.toLowerCase();
    if (!merged.has(key)) merged.set(key, { name: p.name, ecosystem: p.ecosystem, origin: "imports" });
  }
  const all = [...merged.values()];
  // Deterministic order: user-supplied first, then imports alphabetically.
  all.sort((a, b) => a.origin === b.origin ? a.name.localeCompare(b.name) : a.origin === "input" ? -1 : 1);
  const truncated = all.length > 25;
  return { packages: all.slice(0, 25), truncated };
}

// ---------------------------------------------------------------------------
// Exploitability score — spec §3.1. Fixed published weights. Deterministic.
// Each component is 0-100; final = round(weighted sum).
// ---------------------------------------------------------------------------

export type ExploitComponents = {
  cvss: number;
  reachability: number;
  exploit_maturity: number;
  freshness_penalty: number;
  asset_exposure: number;
};

export function computeExploitability(c: ExploitComponents): number {
  const w = W3_MODEL.exploitability_weights;
  const v = w.cvss * c.cvss + w.reachability * c.reachability +
    w.exploit_maturity * c.exploit_maturity + w.freshness_penalty * c.freshness_penalty +
    w.asset_exposure * c.asset_exposure;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** CVSS v3.1 base score × 100 from an OSV severity vector; missing → 50 neutral. */
export function cvssComponent(severityEntries: unknown): number {
  if (!Array.isArray(severityEntries)) return W3_MODEL.neutral.cvss;
  for (const e of severityEntries) {
    const score = String((e as Record<string, unknown>)?.score ?? "");
    // Vector form: "CVSS:3.1/AV:N/AC:L/..." — derive base score from metrics
    if (score.startsWith("CVSS:3")) {
      const base = cvss31BaseFromVector(score);
      if (base !== null) return Math.round(base * 10); // base 0-10 → 0-100
    }
    const num = parseFloat(score);
    if (Number.isFinite(num)) return Math.round(Math.min(10, num) * 10);
  }
  return W3_MODEL.neutral.cvss;
}

/** Minimal CVSS 3.1 base-score derivation from vector (deterministic, no lib). */
export function cvss31BaseFromVector(vector: string): number | null {
  const m = (k: string) => {
    const r = new RegExp(`(?:^|/)${k}:([A-Z])`).exec(vector);
    return r ? r[1] : null;
  };
  try {
    const av = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 }[m("AV") ?? ""] ;
    const ac = { L: 0.77, H: 0.44 }[m("AC") ?? ""];
    const ui = { N: 0.85, R: 0.62 }[m("UI") ?? ""];
    const s = m("S");
    const c = { H: 0.56, L: 0.22, N: 0 }[m("C") ?? ""];
    const i = { H: 0.56, L: 0.22, N: 0 }[m("I") ?? ""];
    const a = { H: 0.56, L: 0.22, N: 0 }[m("A") ?? ""];
    if (av === undefined || ac === undefined || ui === undefined || !s ||
        c === undefined || i === undefined || a === undefined) return null;
    const prVal = m("PR");
    const pr = s === "U"
      ? { N: 0.85, L: 0.62, H: 0.27 }[prVal ?? ""]
      : { N: 0.85, L: 0.68, H: 0.5 }[prVal ?? ""];
    if (pr === undefined) return null;
    const iscBase = 1 - (1 - c) * (1 - i) * (1 - a);
    // CVSS v3.1 spec (FIRST): S:U → 6.42×ISC; S:C → 7.52×(ISC−0.029) −
    // 3.25×(ISC−0.973)^13. (v5.7.2 fix: the previous line used the v3.0
    // term (ISC−0.02)^15 — wrong for CVSS:3.1 vectors.)
    const impact = s === "U"
      ? 6.42 * iscBase
      : 7.52 * (iscBase - 0.029) - 3.25 * Math.pow(iscBase - 0.973, 13);
    const exploitability = 8.22 * av * ac * pr * ui;
    if (impact <= 0) return 0;
    const base = s === "U"
      ? Math.min(impact + exploitability, 10)
      : Math.min(1.08 * (impact + exploitability), 10);
    return Math.ceil(base * 10) / 10; // CVSS roundup
  } catch {
    return null;
  }
}

/** W3.1/v5.7.2: cvss component from an OSV advisory. Order of precedence
 *  (deterministic, published):
 *    1. Raw CVSS v3.x vector string ("CVSS:3.1/AV:N/...") → base score × 10
 *    2. Numeric score string ("7.5") → × 10
 *    3. GHSA database_specific severity label (CRITICAL/HIGH/MODERATE/LOW —
 *       npm advisories carry the label, not the vector) → fixed published
 *       mapping: CRITICAL=95, HIGH=80, MODERATE|MEDIUM=55, LOW=25
 *    4. Nothing → 50 neutral (stated, never fabricated) */
export function cvssFromAdvisory(vector: string | null, label: string | null): number {
  if (vector && vector.startsWith("CVSS:")) {
    const base = cvss31BaseFromVector(vector);
    if (base !== null) return Math.round(base * 10);
  }
  if (vector) {
    const n = parseFloat(vector);
    if (Number.isFinite(n) && n > 0) return Math.round(Math.min(10, n) * 10);
  }
  const l = (label ?? "").toUpperCase();
  if (l === "CRITICAL") return 95;
  if (l === "HIGH") return 80;
  if (l === "MODERATE" || l === "MEDIUM") return 55;
  if (l === "LOW") return 25;
  return W3_MODEL.neutral.cvss;
}

/** reachability: does the advisory-affected function appear in the static
 *  function map of the input? direct call = 100, present uncalled = 60,
 *  absent = 20, undeterminable = 50. */
export function reachabilityComponent(opts: {
  affectedSymbols: string[]; // symbols named by the advisory (may be empty)
  knownFunctions: string[] | null; // static function names from input (null = unknown)
  calledFunctions?: string[]; // subset confirmed called from public entries
}): number {
  const { affectedSymbols, knownFunctions, calledFunctions } = opts;
  if (knownFunctions === null || affectedSymbols.length === 0) return W3_MODEL.neutral.reachability;
  const known = new Set(knownFunctions.map((f) => f.toLowerCase()));
  const called = new Set((calledFunctions ?? []).map((f) => f.toLowerCase()));
  const hits = affectedSymbols.filter((s) => known.has(s.toLowerCase()));
  if (hits.length === 0) return 20;
  return hits.some((h) => called.has(h.toLowerCase())) ? 100 : 60;
}

/** exploit_maturity: public PoC / CISA KEV = 100, technical discussion = 70,
 *  none = 30. */
export function exploitMaturityComponent(opts: {
  inKev: boolean;
  hasPublicReferences: boolean; // advisory has non-advisory-db references (writeup/PoC)
}): number {
  if (opts.inKev) return 100;
  if (opts.hasPublicReferences) return 70;
  return W3_MODEL.neutral.exploit_maturity;
}

/** freshness_penalty = min(100, days_since_patch_published × 2). Null when no
 *  patch date known → neutral 50 (spec: unknown components fall to neutral). */
export function freshnessPenaltyComponent(daysSincePatch: number | null): number {
  if (daysSincePatch === null || !Number.isFinite(daysSincePatch)) return 50;
  return Math.min(100, Math.max(0, Math.round(daysSincePatch * 2)));
}

/** asset_exposure ladder from TVL USD: >$1M = 100, $100k-$1M = 70,
 *  <$100k = 40, undetectable = 50. NOTE (honest): DefiLlama does not map
 *  arbitrary addresses to protocols; null is the common case. */
export function assetExposureComponent(tvlUsd: number | null): number {
  if (tvlUsd === null || !Number.isFinite(tvlUsd)) return W3_MODEL.neutral.asset_exposure;
  if (tvlUsd > 1_000_000) return 100;
  if (tvlUsd >= 100_000) return 70;
  return 40;
}
