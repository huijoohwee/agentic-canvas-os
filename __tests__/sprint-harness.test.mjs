import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalStringify,
  normalizePlan,
  planSprint,
  sha256,
  validateMergeTrainFence,
} from "../scripts/sprint-harness-contract.mjs";

const SHA = {
  base: "0".repeat(40),
  a: "1".repeat(40),
  b: "2".repeat(40),
  c: "3".repeat(40),
  merge: "4".repeat(40),
};

const DIGEST = {
  a: "a".repeat(64),
  b: "b".repeat(64),
  c: "c".repeat(64),
};

function unit(id, paths, options = {}) {
  return {
    id,
    paths,
    dependsOn: options.dependsOn ?? [],
    immutableHead: {
      ref: `refs/heads/${id.toLowerCase()}`,
      sha: options.sha ?? SHA[id.toLowerCase()] ?? SHA.a,
    },
    estimatedMinutes: options.estimatedMinutes ?? 10,
    estimatedTokens: options.estimatedTokens ?? 500,
    evidenceDigests: options.evidenceDigests ?? [],
  };
}

function mergeTrain() {
  return {
    queueId: "queue-7",
    baseRef: "refs/heads/main",
    baseSha: SHA.base,
    mergeHeadRef: "refs/heads/merge-train/7",
    mergeHeadSha: SHA.merge,
    rebuildId: "rebuild-1",
    members: [
      { id: "A", reviewedHeadSha: SHA.a, evidenceDigest: DIGEST.a },
      { id: "B", reviewedHeadSha: SHA.b, evidenceDigest: DIGEST.b },
    ],
  };
}

function basePlan(overrides = {}) {
  return {
    schema: "agentic-sprint-plan/v1",
    profile: "standalone",
    sprint: { id: "bounded-mvp", timeboxMinutes: 60 },
    units: [
      unit("B", ["src/b.mjs"], {
        dependsOn: ["A"],
        sha: SHA.b,
        estimatedMinutes: 15,
        estimatedTokens: 700,
        evidenceDigests: [DIGEST.a],
      }),
      unit("C", ["docs/c.md"], {
        sha: SHA.c,
        estimatedMinutes: 10,
        estimatedTokens: 500,
        evidenceDigests: [DIGEST.c],
      }),
      unit("A", ["src/a.mjs"], {
        sha: SHA.a,
        estimatedMinutes: 20,
        estimatedTokens: 900,
        evidenceDigests: [DIGEST.a],
      }),
    ],
    ...overrides,
  };
}

test("canonical hashing and sprint receipts are byte deterministic", () => {
  assert.equal(canonicalStringify({ z: 1, a: { y: 2, x: 1 } }), '{"a":{"x":1,"y":2},"z":1}');
  assert.equal(sha256("same"), sha256("same"));

  const first = planSprint(basePlan());
  const second = planSprint(JSON.parse(JSON.stringify(basePlan())));
  assert.equal(canonicalStringify(first), canonicalStringify(second));
  assert.equal(first.planDigest, second.planDigest);
  assert.deepEqual(first.waves.map((wave) => wave.unitIds), [["A", "C"], ["B"]]);
  assert.equal(first.economics.plannedTokens, 2100);
  assert.equal(first.economics.criticalPathMinutes, 35);
  assert.equal(first.economics.estimatedVelocityUnitsPerHour, 5.14);
  assert.equal(first.economics.estimatedTokensPerUnit, 700);
  assert.equal(first.economics.estimatedTokensPerMinute, 60);
  assert.equal(first.economics.reusedEvidence, 1);
  assert.equal(first.economics.avoidedRestacks, 1);
  assert.equal(first.economics.avoidedConflictResolutions, 0);
  assert.equal(first.economics.estimatesOnly, true);
  assert.deepEqual(first.convergence, {
    sourceMutation: false,
    gitMutation: false,
    network: false,
    providerMutation: false,
    dispatch: false,
    onCanonicalAdvance: "validate-descendant-or-wait",
    conflictOwnership: "source-owner-once",
    downstreamRewrite: false,
  });
});

test("path overlap is serialized deterministically without rewriting work", () => {
  const receipt = planSprint(basePlan({
    units: [
      unit("Y", ["src/shared.mjs"], { sha: SHA.b }),
      unit("X", ["src/shared.mjs"], { sha: SHA.a }),
      unit("Z", ["src/other.mjs"], { sha: SHA.c }),
    ],
  }));
  assert.deepEqual(receipt.waves.map((wave) => wave.unitIds), [["X", "Z"], ["Y"]]);
  assert.equal(receipt.economics.avoidedRestacks, 0);
  assert.equal(receipt.economics.avoidedConflictResolutions, 1);
});

test("normalization requires explicit profiles and rejects invalid graphs", () => {
  for (const profile of ["standalone", "fork", "enrolled"]) {
    assert.equal(normalizePlan(basePlan({ profile })).profile, profile);
  }
  assert.throws(() => normalizePlan(basePlan({ profile: undefined })), /profile/i);
  assert.throws(() => normalizePlan(basePlan({ profile: "inferred" })), /profile/i);
  assert.throws(
    () => planSprint(basePlan({ units: [unit("A", ["a"], { dependsOn: ["missing"] })] })),
    /missing|dependency/i,
  );
  assert.throws(
    () => planSprint(basePlan({
      units: [
        unit("A", ["a"], { dependsOn: ["B"] }),
        unit("B", ["b"], { dependsOn: ["A"], sha: SHA.b }),
      ],
    })),
    /cycle|cyclic/i,
  );
});

test("exact merge-train fencing preserves authored work and invalidates only stale queue evidence", () => {
  const expected = mergeTrain();
  const exact = validateMergeTrainFence(expected, structuredClone(expected));
  assert.equal(exact.valid, true);

  const drifts = [
    ["queue", (value) => { value.queueId = "queue-8"; }],
    ["base ref", (value) => { value.baseRef = "refs/heads/next"; }],
    ["base SHA", (value) => { value.baseSha = "5".repeat(40); }],
    ["merge ref", (value) => { value.mergeHeadRef = "refs/heads/merge-train/8"; }],
    ["merge SHA", (value) => { value.mergeHeadSha = "6".repeat(40); }],
    ["rebuild", (value) => { value.rebuildId = "rebuild-2"; }],
    ["order", (value) => { value.members.reverse(); }],
    ["reviewed head", (value) => { value.members[0].reviewedHeadSha = "7".repeat(40); }],
    ["evidence", (value) => { value.members[0].evidenceDigest = DIGEST.c; }],
  ];

  for (const [label, mutate] of drifts) {
    const observed = structuredClone(expected);
    mutate(observed);
    const result = validateMergeTrainFence(expected, observed);
    assert.equal(result.valid, false, label);
    assert.equal(result.authoredWork, "preserved", label);
    assert.equal(result.invalidation, "merge-train-evidence-only", label);
    assert.ok(result.drift.length > 0, label);
  }

  const receipt = planSprint(basePlan({ mergeTrain: expected }));
  assert.deepEqual(receipt.mergeTrainEvidence, expected);
});
