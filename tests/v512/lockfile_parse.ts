// ----------------------------------------------------------------------------
// W7 (v5.16.0) — Web2 Dependency Fitness: lockfile/manifest parsing.
// Spec: specs/w7-web2-dependency-fitness.md v1.0.
// Pure functions, no Deno/network deps — unit-testable in isolation.
// Deterministic: same input → same resolved package list (sorted, deduped).
// ----------------------------------------------------------------------------

export const LOCKFILE_MAX_BYTES = 512 * 1024; // 512 KiB
export const PACKAGES_MAX = 250;

export type VersionSource = "input" | "lockfile" | "manifest" | "unpinned";

export interface ResolvedPackage {
  name: string;
  ecosystem: string; // OSV ecosystem: npm | PyPI | Go | crates.io
  version?: string;
  version_source: VersionSource;
  source_file?: string;
  dev?: boolean;
}

export interface LockfileParseResult {
  packages: ResolvedPackage[];
  format: string; // package-lock|yarn|requirements|pipfile|go-mod|cargo|package-json
  error?: string;
}

// -- format detection --------------------------------------------------------

export function detectLockfileFormat(filename: string | undefined, content: string): string {
  const base = (filename ?? "").split("/").pop()!.toLowerCase();
  if (base === "package-lock.json" || base === "npm-shrinkwrap.json") return "package-lock";
  if (base === "yarn.lock") return "yarn";
  if (base === "requirements.txt" || /^requirements.*\.txt$/.test(base)) return "requirements";
  if (base === "pipfile.lock") return "pipfile";
  if (base === "go.mod") return "go-mod";
  if (base === "cargo.lock") return "cargo";
  if (base === "package.json") return "package-json";

  // Content sniffing (order matters — most distinctive first).
  const head = content.slice(0, 4096);
  const trimmed = content.trimStart();
  if (trimmed.startsWith("{")) {
    try {
      const j = JSON.parse(content);
      if (j && typeof j === "object") {
        if ("lockfileVersion" in j) return "package-lock";
        if ("default" in j && typeof j.default === "object" && ("_meta" in j || "develop" in j)) return "pipfile";
        if ("name" in j && ("dependencies" in j || "devDependencies" in j)) return "package-json";
      }
    } catch { /* not JSON — fall through */ }
  }
  if (content.includes("[[package]]")) return "cargo";
  if (/^# yarn lockfile/m.test(head) || /^__metadata:/m.test(head)) return "yarn";
  if (/^module\s+\S+/m.test(head)) return "go-mod";
  if (/^[A-Za-z0-9_.-]+(\[[^\]]*\])?\s*==\s*\S+/m.test(content)) return "requirements";
  // yarn v1 bare grammar: `name@range:` headers followed by `version "x"`.
  if (/^[^\s#][^\n]*@[^\n]*:\s*$/m.test(content) && /^\s+version\s+"[^"]+"/m.test(content)) return "yarn";
  return "unknown";
}

// -- per-format parsers ------------------------------------------------------

function pkg(name: string, ecosystem: string, version: string | undefined,
  versionSource: VersionSource, sourceFile?: string, dev?: boolean): ResolvedPackage {
  const out: ResolvedPackage = { name, ecosystem, version_source: versionSource };
  if (version) out.version = version;
  if (sourceFile) out.source_file = sourceFile;
  if (dev) out.dev = true;
  return out;
}

function parsePackageLock(content: string, file?: string): ResolvedPackage[] {
  const j = JSON.parse(content);
  const out: ResolvedPackage[] = [];
  // v2/v3: flat "packages" map keyed by path.
  if (j.packages && typeof j.packages === "object") {
    for (const [path, entry] of Object.entries(j.packages as Record<string, { version?: string; dev?: boolean }>)) {
      if (!path) continue; // root entry
      const idx = path.lastIndexOf("node_modules/");
      if (idx === -1) continue;
      const name = path.slice(idx + "node_modules/".length);
      if (!name) continue;
      const e = entry ?? {};
      out.push(pkg(name, "npm", e.version, e.version ? "lockfile" : "unpinned", file, e.dev === true));
    }
    return out;
  }
  // v1: nested "dependencies" tree.
  const walk = (deps: Record<string, { version?: string; dev?: boolean; dependencies?: Record<string, unknown> }> | undefined, dev: boolean) => {
    if (!deps) return;
    for (const [name, e] of Object.entries(deps)) {
      const isDev = dev || e.dev === true;
      out.push(pkg(name, "npm", e.version, e.version ? "lockfile" : "unpinned", file, isDev));
      walk(e.dependencies as typeof deps, isDev);
    }
  };
  walk(j.dependencies, false);
  return out;
}

function parseYarnLock(content: string, file?: string): ResolvedPackage[] {
  const out: ResolvedPackage[] = [];
  // Entries: one or more `name@range:` header lines, then indented fields.
  // v1: `version "1.2.3"`; berry: `version: 1.2.3`.
  const entryRe = /^([^\s#][^\n]*?):\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(content)) !== null) {
    const header = m[1];
    if (header.startsWith("__metadata")) continue;
    // Body = lines until next unindented header or EOF.
    const rest = content.slice(m.index + m[0].length);
    const bodyMatch = rest.match(/^((?:\s[^\n]*\n?)+)/);
    const body = bodyMatch ? bodyMatch[1] : "";
    const vM = body.match(/^\s+version:?\s+"?([^"\s]+)"?/m);
    if (!vM) continue;
    const version = vM[1];
    // Header may list several aliases: `lodash@^4.17.20, lodash@^4.17.21:`
    for (const alias of header.split(",")) {
      const a = alias.trim().replace(/:$/, "").replace(/^"|"$/g, "");
      // Strip range: name is everything before the LAST @ that is followed by a range char,
      // but scoped names start with @ — handle: @scope/name@range → @scope/name.
      let name = a;
      const atIdx = a.startsWith("@") ? a.indexOf("@", 1) : a.indexOf("@");
      if (atIdx > 0) name = a.slice(0, atIdx);
      if (name) out.push(pkg(name, "npm", version, "lockfile", file));
    }
  }
  return out;
}

function parseRequirements(content: string, file?: string): ResolvedPackage[] {
  const out: ResolvedPackage[] = [];
  for (const rawLine of content.split("\n")) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (/^(-[a-zA-Z]|--)/.test(line)) continue; // -r, -e, --hash, --index-url...
    line = line.split(/\s+#/)[0].trim(); // trailing comment
    line = line.split(";")[0].trim(); // environment markers
    const m = line.match(/^([A-Za-z0-9_.-]+)(\[[^\]]*\])?/);
    if (!m) continue;
    const name = m[1];
    const exact = line.match(/==\s*([^,\s;]+)/);
    if (exact) out.push(pkg(name, "PyPI", exact[1], "lockfile", file));
    else out.push(pkg(name, "PyPI", undefined, "unpinned", file));
  }
  return out;
}

function parsePipfileLock(content: string, file?: string): ResolvedPackage[] {
  const j = JSON.parse(content);
  const out: ResolvedPackage[] = [];
  const section = (obj: Record<string, { version?: string }> | undefined, dev: boolean) => {
    if (!obj) return;
    for (const [name, e] of Object.entries(obj)) {
      const v = (e?.version ?? "").replace(/^==/, "") || undefined;
      out.push(pkg(name, "PyPI", v, v ? "lockfile" : "unpinned", file, dev));
    }
  };
  section(j.default, false);
  section(j.develop, true);
  return out;
}

function parseGoMod(content: string, file?: string): ResolvedPackage[] {
  const out: ResolvedPackage[] = [];
  const lines = content.split("\n");
  let inRequireBlock = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^require\s*\($/.test(line)) { inRequireBlock = true; continue; }
    if (inRequireBlock && line === ")") { inRequireBlock = false; continue; }
    const reqLine = inRequireBlock ? line : (line.startsWith("require ") ? line.slice(8).trim() : null);
    if (reqLine === null || reqLine === "") continue;
    if (reqLine.startsWith("//")) continue;
    const indirect = /\/\/\s*indirect/.test(reqLine);
    const cleaned = reqLine.replace(/\/\/.*$/, "").trim();
    const parts = cleaned.split(/\s+/);
    if (parts.length < 2) continue;
    out.push(pkg(parts[0], "Go", parts[1], "lockfile", file, indirect));
  }
  return out;
}

function parseCargoLock(content: string, file?: string): ResolvedPackage[] {
  const out: ResolvedPackage[] = [];
  const stanzas = content.split("[[package]]").slice(1);
  for (const s of stanzas) {
    const nameM = s.match(/^name\s*=\s*"([^"]+)"/m);
    const verM = s.match(/^version\s*=\s*"([^"]+)"/m);
    if (!nameM) continue;
    out.push(pkg(nameM[1], "crates.io", verM?.[1], verM ? "lockfile" : "unpinned", file));
  }
  return out;
}

function parsePackageJson(content: string, file?: string): ResolvedPackage[] {
  const j = JSON.parse(content);
  const out: ResolvedPackage[] = [];
  const section = (obj: Record<string, string> | undefined, dev: boolean) => {
    if (!obj) return;
    for (const name of Object.keys(obj)) {
      // Manifest entries are ranges (^, ~, >=) — never treated as exact pins.
      out.push(pkg(name, "npm", undefined, "manifest", file, dev));
    }
  };
  section(j.dependencies, false);
  section(j.devDependencies, true);
  return out;
}

// -- top-level entry ----------------------------------------------------------

export function parseLockfile(filename: string | undefined, content: string): LockfileParseResult {
  const format = detectLockfileFormat(filename, content);
  if (format === "unknown") {
    return { packages: [], format, error: "unrecognized lockfile/manifest format (supported: package-lock.json, yarn.lock, requirements.txt, Pipfile.lock, go.mod, Cargo.lock, package.json)" };
  }
  const file = filename?.split("/").pop();
  try {
    let packages: ResolvedPackage[];
    switch (format) {
      case "package-lock": packages = parsePackageLock(content, file); break;
      case "yarn": packages = parseYarnLock(content, file); break;
      case "requirements": packages = parseRequirements(content, file); break;
      case "pipfile": packages = parsePipfileLock(content, file); break;
      case "go-mod": packages = parseGoMod(content, file); break;
      case "cargo": packages = parseCargoLock(content, file); break;
      case "package-json": packages = parsePackageJson(content, file); break;
      default: packages = [];
    }
    if (packages.length === 0) {
      return { packages: [], format, error: `format detected as ${format} but zero packages were extracted` };
    }
    return { packages: dedupePackages(packages), format };
  } catch (e) {
    return { packages: [], format, error: `parse failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// -- merge & dedupe ------------------------------------------------------------

function dedupeKey(p: ResolvedPackage): string {
  return `${p.ecosystem}|${p.name.toLowerCase()}|${p.version ?? ""}`;
}

export function dedupePackages(list: ResolvedPackage[]): ResolvedPackage[] {
  const seen = new Set<string>();
  const out: ResolvedPackage[] = [];
  for (const p of list) {
    const k = dedupeKey(p);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

// Merge in precedence order (input > lockfile > manifest). Deterministic:
// stable order of first appearance, no clock/RNG.
export function mergePackageLists(...lists: ResolvedPackage[][]): { packages: ResolvedPackage[]; capped: boolean } {
  const merged = dedupePackages(lists.flat());
  if (merged.length > PACKAGES_MAX) {
    return { packages: merged.slice(0, PACKAGES_MAX), capped: true };
  }
  return { packages: merged, capped: false };
}
