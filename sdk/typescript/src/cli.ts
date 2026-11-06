#!/usr/bin/env node
/**
 * nexus-gateway CLI (SDK v2)
 * Commands:
 *   parse    --lockfile <path>                          local, free
 *   fitness  --lockfile <path> | --repo o/n --client-id X
 *   forensic --repo o/n --client-id X                  ($3.50, 350 CRED)
 *   topup    --amount 5 --client-id X [--key <hex>]    (1 USDC = 100 CRED)
 *   verify   --hash 0x<struct-hash>
 */

import * as fs from "node:fs";
import { parseLockfile, preparePackages, toFitnessPayload } from "./lockfile";
import { attestFitnessBatched, chunkPackages, FITNESS_DEFAULT_BASE_URL, proofUrl } from "./fitness";
import { topupCredits } from "./topup";
import { fetchAttestationProof, verifyAttestationLocally, EXPECTED_SIGNER } from "./verify";
import type { FitnessPackageInput } from "./lockfile";

type Flags = Record<string, string | boolean>;

function parseArgv(argv: string[]): { command: string; flags: Flags } {
  const command = argv[0] ?? "help";
  const flags: Flags = {};
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return { command, flags };
}

const str = (f: Flags, k: string): string | undefined => (typeof f[k] === "string" ? (f[k] as string) : undefined);

function fail(msg: string): never {
  console.error(`\n[x] ${msg}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const { command, flags } = parseArgv(process.argv.slice(2));
  const baseUrl = str(flags, "base-url") ?? FITNESS_DEFAULT_BASE_URL;

  if (command === "help" || command === "--help" || command === "-h" || command === "help") {
    console.log(`nexus-gateway CLI (SDK v2)

  parse    --lockfile <path>                Parse a lockfile locally (free). Prints package counts.
  fitness  --lockfile <path> | --repo o/n] --client-id <id>
                                         Dependency fitness attestation ($0.05/call, 25 pkgs/call).
  forensic --repo owner/name --client-id <id>
                                         Top-3 exploit scenarios + IPFS forensic bundle ($3.50).
  topup    --amount <usdc> --client-id <id> [--key <hex>]
                                         Add credits via EIP-712 USDC permit (1 USDC = 100 CRED).
                                         Key defaults to $POLYGON_PRIVATE_KEY. NEVER put keys in CI.
  verify   --hash 0x<struct-hash>          Fetch public proof package + verify EIP-712 signer.
`);
    return;
  }

  if (command === "parse") {
    const path = str(flags, "lockfile");
    if (!path) fail("parse requires --lockfile <path>");
    const content = fs.readFileSync(path, "utf8");
    const result = parseLockfile(path, content);
    if (result.error) fail(result.error);
    const prep = preparePackages(result.packages, 250);
    console.log(`format: ${result.format}`);
    console.log(`packages total: ${result.packages.length} (runtime: ${prep.packages.length}, dev excluded: ${prep.excludedDev}, capped: ${prep.capped ? "yes" : "no"})`);
    for (const p of prep.packages.slice(0, 10)) {
      console.log(`  ${p.ecosystem}  ${p.name}@${p.version ?? "(unpinned)"}`);
    }
    if (prep.packages.length > 10) console.log(`  ... and ${prep.packages.length - 10} more`);
    return;
  }

  if (command === "fitness") {
    const clientId = str(flags, "client-id");
    if (!clientId) fail("fitness requires --client-id (get one at https://nexus-m2m-gateway.rakhmadaa.workers.dev)");
    const lockPath = str(flags, "lockfile");
    const repo = str(flags, "repo");
    if (!lockPath && !repo) fail("fitness requires --lockfile <path> or --repo owner/name");

    let packages: FitnessPackageInput[] = [];
    if (lockPath) {
      const parsed = parseLockfile(lockPath, fs.readFileSync(lockPath, "utf8"));
      if (parsed.error) fail(parsed.error);
      const prep = preparePackages(parsed.packages, 250);
      packages = toFitnessPayload(prep.packages);
    }
    const merged = await attestFitnessBatched({
      clientId,
      packages,
      repo,
      baseUrl,
      onBatch: ({ batchIndex, totalBatches }) =>
        process.stdout.write(`  batch ${batchIndex + 1}/${totalBatches}...\n`),
    });
    console.log(`\nScore: ${merged.score}/100`);
    console.log(`Advisories: ${merged.total_advisories} (critical: ${merged.critical_count}, high: ${merged.high_count})`);
    for (const a of merged.advisories.slice(0, 15)) {
      console.log(`  [${a.severity_class}] ${a.package}: ${a.id} — ${a.url}`);
    }
    console.log(`\nAttestations (${merged.attestation_hashes.length}):`);
    for (const u of merged.proof_urls) console.log(`  ${u}`);
    if (merged.truncated) {
      console.log(`\n[!] Truncated by spend guard — ${merged.unscanned_packages} packages unscanned.`);
    }
    console.log(`Credits charged: ${merged.credits_charged}`);
    return;
  }

  if (command === "forensic") {
    const clientId = str(flags, "client-id");
    const repo = str(flags, "repo");
    if (!clientId || !repo) fail("forensic requires --repo owner/name and --client-id <id>");
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/x402/fitness/forensic`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-client-id": clientId },
      body: JSON.stringify({ repo }),
      signal: AbortSignal.timeout(120_000),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      fail(`forensic failed (HTTP ${res.status}): ${String(json.error ?? "")} — needs 350 CRED ($3.50). Top up: npx nexus-gateway-sdk@2 topup --amount 5 --client-id ${clientId}`);
    }
    const data = (json.data as Record<string, unknown>) ?? {};
    const scenarios = (data.scenarios as Array<Record<string, unknown>>) ?? [];
    console.log(`Forensic attestation for ${repo}`);
    for (const s of scenarios) {
      console.log(`  [${String(s.severity ?? "?")}] ${String(s.scenario_id ?? s.title ?? "")} — ${String(s.narrative ?? "").slice(0, 120)}`);
    }
    const bundle = (data.ipfs_bundle as Record<string, unknown>) ?? {};
    console.log(`\nIPFS bundle CID: ${String(bundle.cid ?? "n/a")}`);
    for (const u of (bundle.gateway_urls as string[]) ?? []) console.log(`  ${u}`);
    const att = (json.attestation as Record<string, unknown>) ?? {};
    if (att.struct_hash) console.log(`\nProof: ${proofUrl(baseUrl, String(att.struct_hash))}`);
    return;
  }

  if (command === "topup") {
    const clientId = str(flags, "client-id");
    const amount = Number(str(flags, "amount"));
    if (!clientId || !(amount > 0)) fail("topup requires --amount <usdc> and --client-id <id>");
    const key = str(flags, "key") ?? process.env.POLYGON_PRIVATE_KEY;
    if (!key) fail("private key required: pass --key <hex> or set POLYGON_PRIVATE_KEY (never in CI)");
    const result = await topupCredits({ clientId, amountUsdc: amount, privateKey: key });
    console.log(`\nStatus: ${result.status}`);
    if (result.txHash) console.log(`TX: ${result.txHash}`);
    if (result.creditsMinted !== null) console.log(`Credits minted: ${result.creditsMinted}`);
    console.log(`\nClient-id "${clientId}" is now funded. Use it in CI as a NON-secret input.`);
    return;
  }

  if (command === "verify") {
    const hash = str(flags, "hash");
    if (!hash) fail("verify requires --hash 0x<struct-hash>");
    const pkg = await fetchAttestationProof(hash, baseUrl);
    console.log(JSON.stringify(pkg, null, 2).slice(0, 4000));
    const att = (pkg.attestation as Record<string, unknown>) ?? (pkg as Record<string, unknown>);
    if (att.signature && att.domain && att.message) {
      const local = verifyAttestationLocally(att as never);
      console.log(`\nLocal EIP-712 recovery: ${local.recoveredSigner}`);
      console.log(`Expected signer (ERC-8004 #636 owner): ${local.expectedSigner}`);
      console.log(`VALID: ${local.valid}`);
    }
    return;
  }

  fail(`Unknown command "${command}". Run: npx nexus-gateway-sdk@2 help`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  fail(msg);
});
