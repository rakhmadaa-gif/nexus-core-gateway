import { test } from "node:test";
import * as assert from "node:assert/strict";
import { attestFitness, attestFitnessBatched, chunkPackages, proofUrl, FITNESS_BATCH_MAX } from "../fitness";
import { NexusError } from "../client";
import type { FitnessResponse } from "../fitness";

function mockResponse(score: number, critical: number, high: number, structHash: string): FitnessResponse {
  return {
    status: "success",
    payload_id: "pid",
    timestamp: "2026-10-22T00:00:00Z",
    service_type: "fitness_attestation",
    data: {
      attestation_version: "1.1.0",
      attested_at: "2026-10-22T00:00:00Z",
      subject: {},
      facts: {
        advisories: [],
        advisory_counts: { critical, high, total: critical + high },
        license: null,
        license_source: "none",
        last_commit_days: 1,
        stars: 1,
      },
      score,
      score_formula: "fixed",
      exposure_window: [],
      sbom: {},
      legal_weight: 0,
      disclaimer: "",
      erc8004: { registry: "0x8004", sibling_agent_id: 636 },
    },
    metadata: { node_id: "nexus", version: "v5.17.0-frontier", latency_ms: 1, credits_charged: 5 },
    attestation: {
      scheme: "eip712",
      domain: { name: "Nexus Fitness Attestation", version: "1", chainId: 137 },
      types: {},
      message: {
        serviceType: "fitness_attestation",
        subjectHash: "0x00",
        resultHash: "0x00",
        score,
        issuedAt: "2026-10-22T00:00:00Z",
        agentId: 636,
        registry: "0x8004",
      },
      struct_hash: structHash,
      signature: "0x",
      signer: "0x8096",
      legal_weight: 0,
    },
  } as unknown as FitnessResponse;
}

test("chunkPackages respects batch max", () => {
  const pkgs = [...Array(60).keys()].map((i) => ({ name: `p${i}`, ecosystem: "npm", version: "1.0.0" }));
  const chunks = chunkPackages(pkgs);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].length, FITNESS_BATCH_MAX);
});

test("attestFitness rejects >25 packages in one call", async () => {
  const pkgs = [...Array(26).keys()].map((i) => ({ name: `p${i}`, ecosystem: "npm" }));
  await assert.rejects(
    attestFitness({ clientId: "c", packages: pkgs, fetchImpl: (async () => { throw new Error("unreachable"); }) as never }),
    /Use attestFitnessBatched/,
  );
});

test("attestFitnessBatched merges worst-case score and sums counts", async () => {
  const pkgs = [...Array(30).keys()].map((i) => ({ name: `p${i}`, ecosystem: "npm" }));
  let call = 0;
  const fetchImpl = (async () => {
    call++;
    return new Response(JSON.stringify(mockResponse(call === 1 ? 85 : 60, 0, call, `0xhash${call}`)), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  const merged = await attestFitnessBatched({ clientId: "c", packages: pkgs, fetchImpl });
  assert.equal(call, 2);
  assert.equal(merged.score, 60); // min(85, 60)
  assert.equal(merged.high_count, 3); // 1 + 2
  assert.equal(merged.credits_charged, 10);
  assert.equal(merged.proof_urls.length, 2);
  assert.equal(merged.truncated, false);
});

test("spend guard truncates batches honestly", async () => {
  const pkgs = [...Array(60).keys()].map((i) => ({ name: `p${i}`, ecosystem: "npm" }));
  let call = 0;
  const fetchImpl = (async () => {
    call++;
    return new Response(JSON.stringify(mockResponse(90, 0, 0, `0xh${call}`)), { status: 200 });
  }) as unknown as typeof fetch;
  const merged = await attestFitnessBatched({ clientId: "c", packages: pkgs, maxSpendUsdc: 0.1, fetchImpl });
  assert.equal(call, 2); // $0.10 / $0.05 = 2 calls
  assert.equal(merged.truncated, true);
  assert.equal(merged.unscanned_packages, 10);
});

test("402 surfaces actionable NexusError with topup instructions", async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ error: "INSUFFICIENT_CREDITS" }), {
      status: 402,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;
  try {
    await attestFitness({ clientId: "broke", packages: [{ name: "x", ecosystem: "npm" }], fetchImpl });
    assert.fail("should throw");
  } catch (e) {
    const ne = e as NexusError;
    assert.equal(ne.statusCode, 402);
    assert.ok(ne.message.includes("topup"));
  }
});

test("proofUrl builds zero-trust proof link", () => {
  assert.equal(
    proofUrl("https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world/", "0xabc"),
    "https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world/attestations/proof?hash=0xabc",
  );
});
