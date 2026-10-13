# W7 — Web2 Dependency Fitness & SBOM Attestation (v5.16.0-frontier)

Status: RATIFIED (user directive "Gas!" 2026-10-13). Product: repackaging of Fitness Attestation
for Web2 dependency ecosystems. Regulatory drivers: EU Cyber Resilience Act (obligations phase
2026-2027) + US EO 14028 (SBOM for federal vendors). Routine demand: CI/CD per-build calls.

## 1. Scope

Extend `POST /x402/fitness` ($0.05 = 5 CRED, unchanged price) with two new input modes:

1. **Lockfile ingestion** — caller pastes a dependency lockfile/manifest; the gateway parses it
   into a package list server-side.
2. **Repo manifest auto-extraction** — `{repo}` mode now fetches known manifest/lockfile files
   from the repository root and derives the dependency list automatically (closes the W3.1 gap:
   repo mode previously had no package list).

Out of scope (explicit non-goals): Stripe/fiat billing, subscription/watch infra, Maven pom.xml,
multi-directory monorepo manifests (root only in v1), W3-full exploitability changes.

## 2. Input schema (additive, backward compatible)

```jsonc
{
  "repo": "owner/name",                    // optional (unchanged)
  "packages": [{ "name": "...", "ecosystem": "npm", "version": "1.2.3" }],  // optional (unchanged)
  "lockfile": {                            // NEW, optional
    "filename": "package-lock.json",       // optional — used for format detection
    "content": "<file contents>"           // required, <= 512 KiB
  }
}
```

At least one of `repo`, `packages`, `lockfile` must be present and valid.

## 3. Supported formats → OSV ecosystem

| File | Format key | Ecosystem |
|---|---|---|
| package-lock.json (v1/v2/v3) | `package-lock` | npm |
| yarn.lock (v1 + berry) | `yarn` | npm |
| requirements.txt | `requirements` | PyPI |
| Pipfile.lock | `pipfile` | PyPI |
| go.mod | `go-mod` | Go |
| Cargo.lock | `cargo` | crates.io |
| package.json (manifest fallback) | `package-json` | npm (ranges → unpinned) |

Detection: basename first; content sniffing fallback (lockfileVersion key, `[[package]]`
stanzas, `# yarn lockfile` header / entry grammar, `module ` header, `==` lines, Pipfile
default/develop keys, package.json name+dependencies shape).

## 4. Version resolution & precedence

- Lockfiles yield exact versions → OSV queried with `version` (fewer false positives).
- Ranges (`^1.2.3`, `>=`, `~=`, unpinned lines) → name-only query, `version_source: "unpinned"`,
  disclosed in output. No registry-latest guessing (determinism + honesty).
- Merge precedence (dedup key = ecosystem + name.lower + version??""):
  `packages` input > `lockfile` > repo manifest. Dev dependencies included, flagged `dev: true`
  (Pipfile `develop`, package.json `devDependencies`, go.mod `// indirect`).
- Ecosystem rule: when an npm lockfile is found for a repo, bare package.json is skipped
  (lockfile is authoritative). Same for other ecosystems.
- Cap: 250 packages merged (user-supplied first). `dependency_capped: true` when truncated.

## 5. OSV querying

- `version` is passed to OSV when exact (new; previously name-only even when version was given
  — documented accuracy improvement, reduces advisory noise to version-applicable ones).
- `POST /v1/querybatch` (chunks of 1000) when resolved list > 10 packages; per-package
  `/v1/query` otherwise (unchanged small path).

## 6. Error classes (all pre-billing, credits untouched)

| Code | HTTP | Trigger |
|---|---|---|
| INVALID_JSON | 400 | unparseable body (unchanged) |
| INVALID_INPUT | 400 | none of repo/packages/lockfile valid (unchanged) |
| LOCKFILE_TOO_LARGE | 400 | content > 512 KiB |
| LOCKFILE_PARSE_FAILED | 400 | format detected but zero packages extracted / undetectable |

Repo manifest fetch failures are non-fatal (`repo_warning` field, unchanged pattern).

## 7. Output additions

- `subject.packages_resolved`: `[{name, ecosystem, version?, version_source, source_file?, dev?}]`
- `subject.lockfiles_detected`: `[{file, format, package_count}]`
- `subject.dependency_capped`: bool
- `facts.advisory_counts` / `score` / `sbom` / `exposure_window`: unchanged shapes, computed over
  the merged resolved list.
- `legal_weight: 0`, fixed public score formula: unchanged.

Cache key = sha256 of `{repo, resolved packages}` (post-resolution → robust to formatting).
10-minute TTL, cache = speed not discount (unchanged policy).

## 8. Negative controls (must FAIL pre-fix, PASS post-fix)

- NC1: garbage lockfile content → 400 LOCKFILE_PARSE_FAILED, 0 credits charged.
- NC2: 513 KiB content → 400 LOCKFILE_TOO_LARGE, 0 credits.
- NC3: package-lock containing lodash@4.17.20 → version-scoped advisories present,
  score < 100; a clean modern lockfile → 0 critical/high.
- NC4: determinism — same lockfile twice → byte-identical output modulo `attested_at`.
- NC5: `{repo}` with only package.json (no lockfile) → packages extracted, `version_source`
  manifest/unpinned disclosed; repo with lockfile → lockfile wins over package.json.

## 9. Anti-overclaim limits

- No "safe/unsafe" language; facts + fixed formula only.
- `version_source` and `unpinned` are always disclosed; advisory list for unpinned packages is
  labeled name-only (may include non-applicable versions).
- legal_weight: 0 everywhere. No SLA/liveness claims about OSV.dev or GitHub.
