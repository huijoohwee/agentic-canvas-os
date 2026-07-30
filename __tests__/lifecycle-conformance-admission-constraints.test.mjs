import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateAdmissionEvidence,
} from "../scripts/agentic-sdlc/admission-evaluator.mjs";
import { lifecyclePolicyIdentity } from "../scripts/lifecycle-conformance-policy.mjs";
import {
  canonicalAdmissionEvidence,
} from "./fixtures/agentic-sdlc-admission-evidence.mjs";

const identities = Object.freeze({
  policy: lifecyclePolicyIdentity(),
  evaluator: Object.freeze({
    repository: "huijoohwee/agentic-canvas-os",
    revision: "a".repeat(40),
    digest: "b".repeat(64),
    mechanismId: "agentic-sdlc-admission-evaluator/v1",
  }),
  schema: Object.freeze({
    repository: "huijoohwee/agentic-canvas-os",
    revision: "a".repeat(40),
    digest: "c".repeat(64),
  }),
});

test("an incomplete collaboration inventory blocks admission", () => {
  const receipt = evaluatePrepared((draft) => {
    draft.admissionEvidence.collaboration.inventoryComplete = false;
  });

  assertBlockedWith(receipt, "parallel-scope-collision");
});

test("an overlapping active peer writer blocks admission", () => {
  const receipt = evaluatePrepared((draft) => {
    draft.admissionEvidence.collaboration.peerWriters = [
      peerWriter(["src/feature.mjs"]),
    ];
  });

  assertBlockedWith(receipt, "parallel-scope-collision");
});

test("a disjoint active peer writer preserves verified admission", () => {
  const receipt = evaluatePrepared((draft) => {
    draft.admissionEvidence.collaboration.peerWriters = [
      peerWriter(["docs/**"]),
    ];
  });

  assert.equal(receipt.verdict, "verified");
  assert.equal(receipt.ready, true);
  assert.deepEqual(receipt.findings, []);
});

test("a disjoint path cannot make duplicate active lane ownership admissible", () => {
  const receipt = evaluatePrepared((draft) => {
    const peer = peerWriter(["docs/**"]);
    const current = draft.admissionEvidence.collaboration;
    peer.branchId = current.branchId;
    peer.worktreeId = current.worktreeId;
    peer.scopeId = current.scopeId;
    current.peerWriters = [peer];
  });

  assertBlockedWith(receipt, "parallel-scope-collision");
});

test("a consumer cannot occupy an earlier numeric wave than its dependency", () => {
  const receipt = evaluatePrepared((draft) => {
    const dependency = draft.admissionEvidence.tasks[0];
    dependency.waveId = "2";
    const consumer = structuredClone(dependency);
    consumer.taskId = "2";
    consumer.waveId = "1";
    consumer.dependencyIds = ["1"];
    consumer.writeSet = ["src/consumer.mjs"];
    const writeGrant = consumer.capabilityGrants.find(
      (grant) => grant.class === "local-write",
    );
    writeGrant.scope = ["src/consumer.mjs"];
    draft.admissionEvidence.tasks.push(consumer);
  });

  assertBlockedWith(receipt, "runtime-readiness-unproven");
});

test("non-ASCII write, grant, and scope set ordering is receipt-stable", () => {
  const canonical = canonicalAdmissionEvidence({
    identities,
    prepare: addUnicodeSets,
  });
  const reordered = canonicalAdmissionEvidence({
    identities,
    prepare: addUnicodeSets,
    mutate: (input) => {
      const task = input.admissionEvidence.tasks[0];
      task.writeSet.reverse();
      task.capabilityGrants.reverse();
      task.capabilityGrants.forEach((grant) => grant.scope?.reverse());
      input.admissionEvidence.collaboration.declaredWriteScope.reverse();
    },
  });
  const before = structuredClone(reordered);

  const expected = evaluateAdmissionEvidence(canonical, identities);
  const observed = evaluateAdmissionEvidence(reordered, identities);

  assert.equal(expected.verdict, "verified");
  assert.deepEqual(observed, expected);
  assert.deepEqual(reordered, before);
});

function evaluatePrepared(prepare) {
  return evaluateAdmissionEvidence(
    canonicalAdmissionEvidence({ identities, prepare }),
    identities,
  );
}

function peerWriter(declaredWriteScope) {
  return {
    actorId: "actor:peer",
    deviceId: "device:peer",
    sessionId: "session:peer",
    worktreeId: "worktree:peer",
    branchId: "agent/device/peer",
    scopeId: "scope:peer",
    leaseEpoch: 8,
    fenceRevision: "e".repeat(40),
    status: "active",
    expiresAt: "2026-07-30T01:30:00.000Z",
    declaredWriteScope,
  };
}

function addUnicodeSets(draft) {
  const task = draft.admissionEvidence.tasks[0];
  const unicodeWrites = ["src/Ångström.mjs", "src/東京.mjs"];
  task.writeSet.push(...unicodeWrites);
  const writeGrant = task.capabilityGrants.find(
    (grant) => grant.class === "local-write",
  );
  writeGrant.intendedUse = "Write source and tests — 安全";
  writeGrant.scope.push(...unicodeWrites);
  draft.admissionEvidence.collaboration.declaredWriteScope.push(
    ...unicodeWrites,
  );
}

function assertBlockedWith(receipt, findingType) {
  assert.equal(receipt.verdict, "blocked");
  assert.equal(receipt.ready, false);
  assert.ok(receipt.findingCounts[findingType] > 0);
  assert.ok(
    receipt.findings.some((finding) => finding.findingType === findingType),
  );
}
