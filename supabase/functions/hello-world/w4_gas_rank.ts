// ============================================================================
// W4 — GAS EFFICIENCY RANK (Fitness Lite weapon) — pure-TS estimator module
// ----------------------------------------------------------------------------
// Spec: specs/w4-gas-efficiency-rank.md (v1.0). Deterministic static heuristic
// gas estimation from Solidity SOURCE (no compilation — Deno edge runtime has
// no solc). Fixed public formula, legal_weight 0, reproducible byte-for-byte.
// This module is Deno-free on purpose: it runs in the Supabase edge runtime
// AND in plain Node (via tsx) for the offline test suite in tests/w4/.
// ============================================================================

// ---------------------------------------------------------------------------
// GAS_RANK_MODEL — single source of truth for W4 parameters (mirrors the spec;
// index.ts re-exports it so the 501 skeleton + future handler share one const).
// ---------------------------------------------------------------------------
export const GAS_RANK_MODEL = {
  model_version: "1.0.0",
  spec: "specs/w4-gas-efficiency-rank.md",
  legal_weight: 0,
  error_band: "±40% (static heuristic vs deployed actuals; optimizer + warm/cold order)",
  gas_schedule: {
    TX_BASE: 21000,
    SSTORE_NEW: 22100, // 20,000 set (0→≠0) + 2,100 cold access
    SSTORE_UPDATE: 7100, // 5,000 reset (≠0→≠0) + 2,100 cold access
    SLOAD_COLD: 2100,
    SLOAD_WARM: 100,
    CALL_COLD: 2600,
    CALL_WARM: 100,
    CALL_VALUE: 9000,
    LOG_BASE: 375,
    LOG_TOPIC: 375, // per topic
    LOG_DATA_BYTE: 8, // per byte
    MEMORY_WORD: 3, // per 32-byte word
    CALLDATA_ZERO: 4,
    CALLDATA_NONZERO: 16,
    KECCAK_BASE: 30,
    KECCAK_WORD: 6,
  },
  loop_model: { unbounded_sample_ns: [1, 5, 10], scoring_n: 5 },
  op_class_patterns: {
    transfer_like: ["transfer", "send"],
    approval_like: ["approve", "permit", "allowance"],
    mint_like: ["mint"],
    burn_like: ["burn"],
    swap_like: ["swap"],
    stake_like: ["stake", "deposit"],
    claim_like: ["claim", "withdraw", "harvest"],
    admin_like: ["onlyOwner", "onlyGovernance", "onlyAdmin"],
  },
  rank_bands: [
    { band: "A", min: 80 }, { band: "B", min: 60 }, { band: "C", min: 40 },
    { band: "D", min: 20 }, { band: "E", min: 0 },
  ],
  class_weight: { strong_pattern: 1.0, weak_pattern: 0.5 },
  cohort: {
    version: "1.2.0-m4-static-cohort",
    description: "Fixed reference distribution per op-class, built from STATIC ESTIMATES of well-known reference contracts (USDC FiatTokenV1, WMATIC WETH9, OZ ERC20 v5, Solady ERC20, OZ ERC20Burnable, Uniswap V2 Router/Pair + V3 Pool, Sushi MasterChef) — same estimator basis as ranked subjects, so systematic static-vs-runtime bias cancels out. Mainnet measurements (Polygon PoS 2026-10-04: USDC 368 transfer / 65 transferFrom / 28 approve txs, router swaps, WMATIC withdraw) validate the error band, not the cohort. Live ERC-8004 cohort sampling = v2.",
    seed: {
      transfer_like: { p25: 28720, median: 43097, p75: 53360, n: 12 },
      approval_like: { p25: 24166, median: 28720, p75: 44166, n: 8 },
      mint_like: { p25: 32193, median: 69377, p75: 76198, n: 7 },
      burn_like: { p25: 25810, median: 45412, p75: 75297, n: 5 },
      swap_like: { p25: 37248, median: 37760, p75: 58877, n: 8 },
      stake_like: { p25: 54012, median: 74321, p75: 87885, n: 8 },
      claim_like: { p25: 42396, median: 68922, p75: 82134, n: 3 },
      admin_like: { p25: 32193, median: 40936, p75: 46050, n: 9 },
    },
  },
  limits: { max_sol_files: 25, max_total_bytes: 153600, cache_ttl_seconds: 600 },
  sla_target: "< 2s (static, no compilation)",
  vendored_exclusions: ["node_modules/", "lib/", "vendor/", "@openzeppelin", "solmate", "solady"],
} as const;

export type OpClass = keyof typeof GAS_RANK_MODEL.cohort.seed | "custom";

export interface ParsedFunction {
  name: string;
  visibility: string;
  modifiers: string[];
  params: string;
  body: string;
}

export interface ParsedContract {
  stateVars: Map<string, { isMapping: boolean; isConstant: boolean }>;
  functions: ParsedFunction[];
  events: Map<string, { args: number; indexed: number }>;
  /** internal/private functions by name — for M4 internal-call inlining (wrapper pattern) */
  internalFns: Map<string, ParsedFunction>;
  /** modifier declarations with bodies — for M4 modifier inlining (USDC blacklist-class) */
  modifierBodies: Map<string, string>;
}

export interface OpCount {
  sstoreNew: number; sstoreUpdate: number; sloadCold: number; sloadWarm: number;
  callCold: number; callWarm: number; callValue: number;
  logs: number; logTopics: number; logBytes: number;
  keccak: number; memoryWords: number; loopCost: number;
  loopRange: { n: number[]; perIteration: number } | null;
}

// ---------------------------------------------------------------------------
// Comment stripping — char scanner (tempo-std lesson: naive /* ... */ regex
// breaks on banner art like /*////...*/). Handles line comments, block
// comments, and string literals so comment text never pollutes op counting.
// ---------------------------------------------------------------------------
export function stripSolidityComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = i + 1 < n ? src[i + 1] : "";
    if (c === "/" && c2 === "/") {
      while (i < n && src[i] !== "\n") i++;
    } else if (c === "/" && c2 === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && i + 1 < n && src[i + 1] === "/")) i++;
      i += 2;
    } else if (c === '"' || c === "'") {
      out += c; i++;
      while (i < n && src[i] !== c) {
        if (src[i] === "\\") { out += src[i] + (i + 1 < n ? src[i + 1] : ""); i += 2; }
        else { out += src[i]; i++; }
      }
      if (i < n) { out += src[i]; i++; }
    } else {
      out += c; i++;
    }
  }
  return out;
}

// Brace matching from the index of an opening "{".
function matchBrace(src: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Parser — state vars, functions (public/external only for ranking), events.
// Heuristic, line-oriented at declaration level; NOT a full Solidity AST.
// ---------------------------------------------------------------------------
export function parseContract(source: string): ParsedContract {
  const src = stripSolidityComments(source);
  const stateVars = new Map<string, { isMapping: boolean; isConstant: boolean }>();
  const events = new Map<string, { args: number; indexed: number }>();
  const functions: ParsedFunction[] = [];
  const internalFns = new Map<string, ParsedFunction>();
  const modifierBodies = new Map<string, string>();

  // Events: event Transfer(address indexed from, address to, uint256 value);
  const evRe = /\bevent\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/g;
  for (let m = evRe.exec(src); m; m = evRe.exec(src)) {
    const params = m[2].split(",").map((s) => s.trim()).filter(Boolean);
    events.set(m[1], {
      args: params.length,
      indexed: params.filter((p) => p.includes("indexed")).length,
    });
  }

  // State vars: mapping(...) ... name; | type [modifiers] name [= ...];
  // Skip anything declared inside a function body by cutting function regions first.
  const fnRe = /\bfunction\s+([A-Za-z_]\w*)?\s*\(([^)]*)\)\s*([^\{;]*)([\{;])/g;
  const regions: Array<[number, number]> = [];
  for (let m = fnRe.exec(src); m; m = fnRe.exec(src)) {
    if (m[4] === "{") {
      const end = matchBrace(src, m.index + m[0].length - 1);
      if (end > 0) regions.push([m.index, end + 1]);
    }
  }
  const inRegion = (idx: number) => regions.some(([a, b]) => idx >= a && idx < b);

  // NOTE: value type may nest one level — mapping(address => mapping(address => uint256))
  const mapRe = /\bmapping\s*\((?:[^()]|\([^)]*\))*\)\s*(?:public\s+|private\s+|internal\s+)*([A-Za-z_]\w*)\s*(?:=[^;]*)?;/g;
  for (let m = mapRe.exec(src); m; m = mapRe.exec(src)) {
    if (!inRegion(m.index)) stateVars.set(m[1], { isMapping: true, isConstant: false });
  }
  // NOTE: modifier span captured as ONE group — a repeated (a|b|\s)* group would
  // only keep the LAST iteration's capture (a whitespace), losing "constant".
  const svRe = /\b(?:uint\d*|int\d*|address|bool|bytes\d*|string|bytes)\s+((?:public|private|internal|constant|immutable|\s)*)\s*([A-Za-z_]\w*)\s*(?:=[^;]*)?;/g;
  for (let m = svRe.exec(src); m; m = svRe.exec(src)) {
    if (inRegion(m.index)) continue;
    const mods = m[1] ?? "";
    if (mods.includes("constant") || mods.includes("immutable")) {
      stateVars.set(m[2], { isMapping: false, isConstant: true });
    } else if (!stateVars.has(m[2])) {
      stateVars.set(m[2], { isMapping: false, isConstant: false });
    }
  }

  // Functions with bodies (public/external only matter for ranking).
  // Modifier declarations: `modifier name(args) { ... }` — body kept for inlining.
  const modRe = /\bmodifier\s+([A-Za-z_]\w*)\s*(?:\([^)]*\))?\s*\{/g;
  for (let m = modRe.exec(src); m; m = modRe.exec(src)) {
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = matchBrace(src, openIdx);
    if (closeIdx < 0) continue;
    modifierBodies.set(m[1], src.slice(openIdx + 1, closeIdx));
  }
  const fnRe2 = /\bfunction\s+([A-Za-z_]\w*)?\s*\(([^)]*)\)\s*([^\{;]*)\{/g;
  for (let m = fnRe2.exec(src); m; m = fnRe2.exec(src)) {
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = matchBrace(src, openIdx);
    if (closeIdx < 0) continue;
    const tail = m[3] ?? "";
    const vis = /\bexternal\b/.test(tail) ? "external" : /\bpublic\b/.test(tail) ? "public"
      : /\binternal\b/.test(tail) ? "internal" : /\bprivate\b/.test(tail) ? "private" : "default";
    const mods = (tail.match(/\b[A-Za-z_]\w*(?=\s*(?:\(|$|\s))/g) ?? [])
      .filter((w) => !["external", "public", "internal", "private", "view", "pure", "payable", "virtual", "override", "returns", "memory", "calldata"].includes(w));
    const parsedFn: ParsedFunction = {
      name: m[1] ?? "(anonymous)",
      visibility: vis,
      modifiers: mods,
      params: m[2] ?? "",
      body: src.slice(openIdx + 1, closeIdx),
    };
    functions.push(parsedFn);
    if (vis === "internal" || vis === "private") internalFns.set(parsedFn.name, parsedFn);
  }
  return { stateVars, functions, events, internalFns, modifierBodies };
}

// ---------------------------------------------------------------------------
// Internal-call inlining (M4 calibration fix): a public wrapper like USDC's
// `transfer() { _transfer(msg.sender, to, value); }` delegates all real work to
// an internal function. Without inlining the estimate is TX_BASE + calldata
// only (measured: -63% vs mainnet). Inline internal/private call bodies into
// the caller, one level deep, cycle-guarded (no self-recursive chains).
// ---------------------------------------------------------------------------
export function inlineInternalCalls(fn: ParsedFunction, contract: ParsedContract): ParsedFunction {
  const seen = new Set<string>([fn.name]);
  let body = fn.body;
  let changed = true;
  let guard = 0;
  while (changed && guard < 8) {
    changed = false;
    guard++;
    for (const [name, inner] of contract.internalFns) {
      if (seen.has(name)) continue;
      const callRe = new RegExp(`\\b${name}\\s*\\(`, "g");
      if (callRe.test(body)) {
        seen.add(name);
        body = body + "\n" + inner.body;
        changed = true;
      }
    }
  }
  return { ...fn, body };
}

// ---------------------------------------------------------------------------
// Modifier inlining (M4 calibration fix): USDC-class tokens gate every entry
// point with body modifiers (whenNotPaused, notBlacklisted(x)) whose bodies do
// real SLOADs. Without inlining, estimates under-count by ~1 modifier-sload
// each. Inline each used modifier's body once into the caller.
// ---------------------------------------------------------------------------
export function inlineModifierBodies(fn: ParsedFunction, contract: ParsedContract): ParsedFunction {
  let extra = "";
  for (const mod of fn.modifiers) {
    const body = contract.modifierBodies.get(mod);
    if (body) extra += "\n" + body;
  }
  return extra ? { ...fn, body: fn.body + extra } : fn;
}

// ---------------------------------------------------------------------------
// Estimator — count ops in one function body. Deterministic, documented
// simplifications (spec §3). Loop bodies are costed once and multiplied by the
// iteration model (bounded literal → N; else unbounded → range at N ∈ {1,5,10}).
// ---------------------------------------------------------------------------
const IDENT = "[A-Za-z_][A-Za-z0-9_]*";

function localVarNames(body: string): Set<string> {
  const names = new Set<string>();
  const re = new RegExp(`\\b(?:uint\\d*|int\\d*|address|bool|bytes\\d*|string|bytes)\\s+(?:memory\\s+|storage\\s+|calldata\\s+)?(${IDENT})`, "g");
  for (let m = re.exec(body); m; m = re.exec(body)) names.add(m[1]);
  return names;
}

export function estimateFunctionGas(
  fn: ParsedFunction,
  contract: ParsedContract,
): { estimate: number; ops: OpCount; breakdown: Record<string, number> } {
  const G = GAS_RANK_MODEL.gas_schedule;
  const ops: OpCount = {
    sstoreNew: 0, sstoreUpdate: 0, sloadCold: 0, sloadWarm: 0,
    callCold: 0, callWarm: 0, callValue: 0,
    logs: 0, logTopics: 0, logBytes: 0, keccak: 0, memoryWords: 0,
    loopCost: 0, loopRange: null,
  };
  const fnInlined = inlineModifierBodies(inlineInternalCalls(fn, contract), contract);
  const locals = localVarNames(fnInlined.body);

  // --- loops first: cost each loop body in a FRESH op-counter (single pass),
  // then multiply by the iteration model into ops.loopCost. The main body is
  // costed with loop regions blanked, so loop ops are never double-counted.
  let body = fnInlined.body;
  const loopRe = /\b(for|while)\s*\(([^)]*)\)\s*\{/g;
  const loopSegments: Array<{ kind: string; cond: string; body: string }> = [];
  for (let m = loopRe.exec(body); m; m = loopRe.exec(body)) {
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = matchBrace(body, openIdx);
    if (closeIdx < 0) continue;
    const header = m[2] ?? "";
    const cond = header.includes(";") ? (header.split(";")[1] ?? "") : header;
    loopSegments.push({ kind: m[1], cond, body: body.slice(openIdx + 1, closeIdx) });
    body = body.slice(0, m.index) + " /*LOOP*/ " + body.slice(closeIdx + 1);
    loopRe.lastIndex = m.index + 8;
  }
  for (const seg of loopSegments) {
    const tempOps: OpCount = {
      sstoreNew: 0, sstoreUpdate: 0, sloadCold: 0, sloadWarm: 0,
      callCold: 0, callWarm: 0, callValue: 0,
      logs: 0, logTopics: 0, logBytes: 0, keccak: 0, memoryWords: 0,
      loopCost: 0, loopRange: null,
    };
    estimateBodyCost(seg.body, contract, locals, tempOps);
    const sub = costOfOps(tempOps);
    const literalBound = /<\s*(\d+)\b/.exec(seg.cond);
    const unbounded = /\.length\b/.test(seg.cond) || !literalBound;
    if (!unbounded && literalBound) {
      const nTimes = Math.min(parseInt(literalBound[1], 10), 1000);
      ops.loopCost += sub * nTimes;
    } else {
      const ns = GAS_RANK_MODEL.loop_model.unbounded_sample_ns;
      ops.loopRange = { n: [...ns], perIteration: sub };
      ops.loopCost += sub * GAS_RANK_MODEL.loop_model.scoring_n;
    }
  }
  estimateBodyCost(body, contract, locals, ops);

  // --- calldata + base
  const nParams = fn.params.trim() ? fn.params.split(",").length : 0;
  const calldata = nParams * 32 * G.CALLDATA_NONZERO;

  const breakdown: Record<string, number> = {
    tx_base: G.TX_BASE,
    calldata,
    sstore: ops.sstoreNew * G.SSTORE_NEW + ops.sstoreUpdate * G.SSTORE_UPDATE,
    sload: ops.sloadCold * G.SLOAD_COLD + ops.sloadWarm * G.SLOAD_WARM,
    calls: ops.callCold * G.CALL_COLD + ops.callWarm * G.CALL_WARM + ops.callValue * G.CALL_VALUE,
    logs: ops.logs * G.LOG_BASE + ops.logTopics * G.LOG_TOPIC + ops.logBytes * G.LOG_DATA_BYTE,
    keccak: ops.keccak * (G.KECCAK_BASE + 2 * G.KECCAK_WORD),
    memory: ops.memoryWords * G.MEMORY_WORD,
    loops: ops.loopCost,
  };
  const estimate = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { estimate, ops, breakdown };
}

// Gas total of an OpCount (excluding loopCost, which is carried separately).
function costOfOps(o: OpCount): number {
  const G = GAS_RANK_MODEL.gas_schedule;
  return (o.sstoreNew * G.SSTORE_NEW + o.sstoreUpdate * G.SSTORE_UPDATE) +
    (o.sloadCold * G.SLOAD_COLD + o.sloadWarm * G.SLOAD_WARM) +
    (o.callCold * G.CALL_COLD + o.callWarm * G.CALL_WARM + o.callValue * G.CALL_VALUE) +
    (o.logs * G.LOG_BASE + o.logTopics * G.LOG_TOPIC + o.logBytes * G.LOG_DATA_BYTE) +
    (o.keccak * (G.KECCAK_BASE + 2 * G.KECCAK_WORD)) +
    (o.memoryWords * G.MEMORY_WORD);
}

// Count non-loop ops in a body fragment into the ops accumulator.
function estimateBodyCost(
  body: string,
  contract: ParsedContract,
  locals: Set<string>,
  ops: OpCount,
): void {
  const G = GAS_RANK_MODEL.gas_schedule;
  const count = (re: RegExp) => (body.match(re) ?? []).length;

  // storage writes/reads per state var
  for (const [name, meta] of contract.stateVars) {
    if (meta.isConstant || locals.has(name)) continue;
    const writeRe = new RegExp(`\\b${name}\\s*(?:\\[[^\\]]*\\]\\s*(?:\\.\\w+\\s*)?)*\\s*(?:=[^=]|\\+=|-=|\\+\\+|--)`, "g");
    const writes = count(writeRe);
    const keyRe = new RegExp(`\\b${name}\\s*\\[`, "g");
    const keyUses = count(keyRe);
    const totalUses = count(new RegExp(`\\b${name}\\b`, "g"));
    const reads = Math.max(0, totalUses - writes - (meta.isMapping ? 0 : 0));
    if (writes > 0) {
      // M4 calibration fix: read-before-write implies the slot is already
      // non-zero → first write is an UPDATE (7100), not NEW (22100). Measured
      // on WMATIC withdraw: -15k over-estimate eliminated. A write with no
      // prior read in the body (e.g. constructor-style init) stays SSTORE_NEW.
      const readBeforeWrite = reads > 0;
      if (readBeforeWrite) {
        ops.sstoreUpdate += writes;
      } else {
        ops.sstoreNew += 1;
        ops.sstoreUpdate += writes - 1;
      }
      if (meta.isMapping) ops.keccak += writes;
    }
    if (reads > 0 && !(meta.isMapping && reads === keyUses && writes === 0 && totalUses === 0)) {
      const effectiveReads = meta.isMapping ? Math.max(0, reads - 0) : reads;
      if (effectiveReads > 0) {
        ops.sloadCold += 1;
        ops.sloadWarm += effectiveReads - 1;
        if (meta.isMapping && keyUses > writes) ops.keccak += 1;
      }
    }
  }

  // external calls
  const tokenCalls = count(/\.(?:transfer|transferFrom|safeTransferFrom|safeTransfer|send)\s*\(/g);
  ops.callCold += tokenCalls;
  ops.callValue += tokenCalls;
  const lowLevel = count(/\.(?:call|delegatecall|staticcall)\s*[\{(]/g);
  ops.callCold += lowLevel;
  const ifaceCalls = count(new RegExp(`\\bI[A-Z]\\w*\\([^)]*\\)\\.\\w+\\s*\\(`, "g"));
  ops.callCold += ifaceCalls;

  // events
  const emitRe = /\bemit\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/g;
  for (let m = emitRe.exec(body); m; m = emitRe.exec(body)) {
    const ev = contract.events.get(m[1]);
    const argCount = m[2].trim() ? m[2].split(",").length : 0;
    ops.logs += 1;
    ops.logTopics += 1 + (ev ? ev.indexed : Math.min(1, argCount));
    ops.logBytes += 32 * argCount;
  }

  // keccak + memory
  ops.keccak += count(/\bkeccak256\s*\(/g);
  const newArr = /new\s+\w+(?:\[\])?\s*\(\s*(\d+)?\s*\)/g;
  for (let m = newArr.exec(body); m; m = newArr.exec(body)) {
    ops.memoryWords += m[1] ? parseInt(m[1], 10) : 10;
  }
}

// ---------------------------------------------------------------------------
// Classification — name patterns (strong) then op-dominance (weak).
// ---------------------------------------------------------------------------
export function classifyFunction(
  fn: ParsedFunction,
  ops: OpCount,
): { op_class: OpClass; strength: "strong" | "weak" } {
  const name = fn.name.toLowerCase();
  for (const [cls, patterns] of Object.entries(GAS_RANK_MODEL.op_class_patterns)) {
    for (const p of patterns) {
      if (cls === "admin_like") {
        if (fn.modifiers.some((m) => m.toLowerCase() === p.toLowerCase())) {
          return { op_class: cls as OpClass, strength: "strong" };
        }
      } else if (name.includes(p)) {
        return { op_class: cls as OpClass, strength: "strong" };
      }
    }
  }
  // weak op-dominance fallback
  const sstores = ops.sstoreNew + ops.sstoreUpdate;
  if (sstores >= 2 && ops.logs >= 1 && ops.callCold === 0) return { op_class: "transfer_like", strength: "weak" };
  if (ops.callCold >= 1 && sstores >= 1) return { op_class: "stake_like", strength: "weak" };
  if (fn.modifiers.length > 0 && sstores === 1 && ops.callCold === 0) return { op_class: "admin_like", strength: "weak" };
  return { op_class: "custom", strength: "weak" };
}

// ---------------------------------------------------------------------------
// Percentile vs fixed cohort — fixed public interpolation formula (spec §6).
// Higher = more efficient than that share of the cohort.
// ---------------------------------------------------------------------------
export function percentileVsCohort(estimate: number, seed: { p25: number; median: number; p75: number }): number {
  let pct: number;
  if (estimate <= seed.p25) {
    pct = 75 + 25 * (seed.p25 - estimate) / seed.p25;
  } else if (estimate <= seed.median) {
    pct = 50 + 25 * (seed.median - estimate) / (seed.median - seed.p25);
  } else if (estimate <= seed.p75) {
    pct = 25 + 25 * (seed.p75 - estimate) / (seed.p75 - seed.median);
  } else {
    pct = 25 * seed.p75 / estimate;
  }
  return Math.max(1, Math.min(99, Math.round(pct)));
}

// ---------------------------------------------------------------------------
// Vendored-path filter (case-hunter lesson: vendored code is not the subject's
// work; substring matching, not prefix — @openzeppelin can appear mid-path).
// ---------------------------------------------------------------------------
export function isVendoredPath(path: string): boolean {
  const p = path.toLowerCase();
  return GAS_RANK_MODEL.vendored_exclusions.some((ex) => p.includes(ex.toLowerCase()));
}

// ---------------------------------------------------------------------------
// buildGasRank — top-level: files → full result object (or NO_RANKABLE marker).
// ---------------------------------------------------------------------------
export interface GasRankInput { path: string; source: string }

export function buildGasRank(files: GasRankInput[], subject: { repo?: string } = {}) {
  const G = GAS_RANK_MODEL;
  const screened = files.filter((f) => f.path.endsWith(".sol") && !isVendoredPath(f.path));
  const skippedVendored = files.filter((f) => f.path.endsWith(".sol") && isVendoredPath(f.path)).length;

  // M4: union of modifier bodies + internal fns ACROSS files (inheritance chain
  // lives in sibling files: FiatTokenV1 uses notBlacklisted declared in
  // Blacklistable.sol). Merge into every per-file contract view so modifier and
  // internal-call inlining resolve cross-file.
  const unionModifierBodies = new Map<string, string>();
  const unionInternalFns = new Map<string, ParsedFunction>();
  const parsedAll = screened.slice(0, G.limits.max_sol_files).map((f) => parseContract(f.source));
  for (const p of parsedAll) {
    for (const [k, v] of p.modifierBodies) if (!unionModifierBodies.has(k)) unionModifierBodies.set(k, v);
    for (const [k, v] of p.internalFns) if (!unionInternalFns.has(k)) unionInternalFns.set(k, v);
  }

  const fnResults: Array<Record<string, unknown>> = [];
  const ranked: Array<{ percentile: number; weight: number }> = [];

  for (let i = 0; i < parsedAll.length; i++) {
    const f = screened[i];
    const parsed = {
      ...parsedAll[i],
      modifierBodies: unionModifierBodies,
      internalFns: unionInternalFns,
    };
    for (const fn of parsed.functions) {
      if (fn.visibility !== "public" && fn.visibility !== "external") continue;
      const { estimate, ops, breakdown } = estimateFunctionGas(fn, parsed);
      const { op_class, strength } = classifyFunction(fn, ops);
      const entry: Record<string, unknown> = {
        name: fn.name, file: f.path, visibility: fn.visibility,
        estimate_gas: estimate, op_class,
        loop_range: ops.loopRange
          ? { ns: ops.loopRange.n, per_iteration: ops.loopRange.perIteration, scored_at_n: G.loop_model.scoring_n }
          : null,
        breakdown,
      };
      if (op_class !== "custom") {
        const seed = G.cohort.seed[op_class as keyof typeof G.cohort.seed];
        const percentile = percentileVsCohort(estimate, seed);
        entry.cohort = { class: op_class, n: seed.n, median: seed.median };
        entry.percentile = percentile;
        ranked.push({ percentile, weight: strength === "strong" ? G.class_weight.strong_pattern : G.class_weight.weak_pattern });
      }
      fnResults.push(entry);
    }
  }

  if (ranked.length === 0) {
    return {
      gas_rank_version: G.model_version,
      status: "NO_RANKABLE_FUNCTIONS",
      http_status_hint: 422,
      message: "No public/external functions could be classified into a benchmark op-class (after vendored exclusions). Nothing to rank — billing must NOT trigger (pre-billing validation, spec §6).",
      attested_subject: { ...subject, contracts_analyzed: screened.length, contracts_skipped_vendored: skippedVendored },
      legal_weight: G.legal_weight,
    };
  }

  const wSum = ranked.reduce((a, r) => a + r.weight, 0);
  const composite = Math.round(ranked.reduce((a, r) => a + r.percentile * r.weight, 0) / wSum);
  const band = G.rank_bands.find((b) => composite >= b.min)?.band ?? "E";

  return {
    gas_rank_version: G.model_version,
    attested_subject: { ...subject, contracts_analyzed: screened.length, contracts_skipped_vendored: skippedVendored },
    functions: fnResults,
    composite: {
      score: composite,
      band,
      ranked_functions: ranked.length,
      unranked_functions: fnResults.length - ranked.length,
    },
    cohort_version: G.cohort.version,
    formula: "static opcode heuristics (GAS_SCHEDULE v1) + class percentile vs fixed public cohort (piecewise-linear on p25/median/p75)",
    limits: { static_estimate_only: true, error_band: G.error_band, ...G.limits },
    legal_weight: G.legal_weight,
    disclaimer: "Static heuristic estimate from source code; not on-chain measurement, not optimization advice. Reproducible: GAS_SCHEDULE v1 + COHORT v1 are fixed and public.",
  };
}
