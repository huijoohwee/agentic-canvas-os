import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeOrphanedTaskAuthorityRecovery,
  createOrphanedTaskAuthorityRecoveryPlan,
} from "../scripts/orphaned-task-authority-recovery-contract.mjs";

const digest = character => character.repeat(64);

function source() {
  return {
    schema: "agentic-orphaned-task-authority-source/v1",
    repository: { id: "repo-node", nameWithOwner: "owner/repo" },
    branch: "agent/device/scope",
    headSha: "a".repeat(40),
    treeSha: "b".repeat(40),
    worktreeIdentityDigest: digest("1"),
    leaseDigest: digest("2"),
    claimId: digest("3"),
    cloudClaimDigest: digest("e"),
    pullRequest: { id: "pr-node", url: "https://github.test/owner/repo/pull/7",
      bodyDigest: digest("4"), bodyRemainderDigest: digest("d"),
      markerDigest: digest("5"), state: "OPEN", isDraft: true },
    taskAuthority: { authoritySubjectId: `urn:agentic-task:${digest("6")}`,
      generation: 1, bindingDigest: digest("7"), publicKeyDigest: digest("8") },
    git: { kind: "clean", evidenceDigest: digest("9") },
  };
}

function target(overrides = {}) {
  return {
    authoritySubjectId: `urn:agentic-task:${digest("a")}`,
    proofAdapterId: "urn:agentic-proof:ed25519-file:v1",
    generation: 2,
    publicKey: "MCowBQYDK2VwAyEAo1/9t4vYw+1MZ4D1vR2zq5qfVj8qXq4O0DD5nZw1gCk=",
    publicKeyDigest: digest("b"),
    ...overrides,
  };
}

test("plan is deterministic, path-free, and binds a monotonic distinct target", () => {
  const input = { source: source(), targetCapability: target(),
    incidentReference: "incident-2026-08-23-marketplace",
    lossAttestationDigest: digest("c"), plannedAt: "2026-08-23T04:00:00.000Z" };
  const first = createOrphanedTaskAuthorityRecoveryPlan(input);
  const second = createOrphanedTaskAuthorityRecoveryPlan(input);
  assert.deepEqual(first, second);
  assert.equal(first.exactAuthorization,
    `authorize orphaned-task-authority-recovery ${first.planDigest}`);
  assert.equal(JSON.stringify(first).includes("/Users/"), false);
  assert.equal(authorizeOrphanedTaskAuthorityRecovery(first, first.exactAuthorization).status,
    "authorized");
});

test("plan rejects subject reuse, generation jumps, and wrong authorization", () => {
  const common = { source: source(), incidentReference: "incident-reference-1234",
    lossAttestationDigest: digest("c"), plannedAt: "2026-08-23T04:00:00.000Z" };
  assert.throws(() => createOrphanedTaskAuthorityRecoveryPlan({ ...common,
    targetCapability: target({ authoritySubjectId: common.source.taskAuthority.authoritySubjectId }) }),
  /distinct/u);
  assert.throws(() => createOrphanedTaskAuthorityRecoveryPlan({ ...common,
    targetCapability: target({ generation: 3 }) }), /generation/u);
  const plan = createOrphanedTaskAuthorityRecoveryPlan({ ...common, targetCapability: target() });
  assert.throws(() => authorizeOrphanedTaskAuthorityRecovery(plan,
    "authorize orphaned-task-authority-recovery wrong"), /exact authorization/u);
});
