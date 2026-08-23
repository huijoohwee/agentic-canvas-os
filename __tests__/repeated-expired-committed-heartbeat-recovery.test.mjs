import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";

import {
  authorizeRepeatedRecovery,
  buildRepeatedRecoveryCompletion,
  buildRepeatedRecoveryPlan,
  INTENT_SCHEMA,
} from "../scripts/repeated-expired-committed-heartbeat-recovery-contract.mjs";
import { createRepeatedRecoveryController }
  from "../scripts/repeated-expired-committed-heartbeat-recovery-controller.mjs";
import { classifyRepeatedSuccessorBindState }
  from "../scripts/repeated-expired-committed-heartbeat-recovery-repository-adapter.mjs";

const digest = character => character.repeat(64);
const sha = character => character.repeat(40);

function evidence() {
  return {
    repositoryId: "R_repository",
    branch: "agent/device/repeated-expired-committed-heartbeat-recovery",
    sessionId: "owner-session",
    semanticScope: "orphaned-task-authority-recovery",
    pullRequestNumber: 646,
    reviewRequestId: "github-pull-request:PR_example",
    baseSha: sha("1"),
    fenceSha: sha("2"),
    headSha: sha("3"),
    remoteHeadSha: sha("4"),
    protectedParentSha: sha("5"),
    claimId: digest("a"),
    claimDigest: digest("b"),
    cloudTransitionCounter: 7,
    leaseEpoch: 426,
    leaseDigest: digest("c"),
    taskBindingDigest: digest("d"),
    previousRecoveryDigest: digest("e"),
    sourceMarkerDigest: digest("f"),
    pullRequestBodyDigest: digest("0"),
    snapshotDigest: digest("1"),
    sourceDeclaredWriteSet: [
      "path:docs/ORPHANED-TASK-AUTHORITY-RECOVERY.md",
      "semantic:orphaned-task-authority-recovery",
    ],
    sourceWriteSetDigest: digestValue([
      "path:docs/ORPHANED-TASK-AUTHORITY-RECOVERY.md",
      "semantic:orphaned-task-authority-recovery",
    ]),
    sourceManifestDigest: digest("2"),
    authoredPaths: ["scripts/orphaned-task-authority-recovery-controller.mjs"],
    rangeDiffDigest: digest("6"),
    controllerDigest: digest("7"),
    expiresAt: "2026-08-23T07:48:36.000Z",
  };
}

function targetManifest() {
  return {
    schema: "agentic-declared-write-scope/v1",
    semanticScope: "orphaned-task-authority-recovery",
    declaredWriteSet: [
      "path:docs/ORPHANED-TASK-AUTHORITY-RECOVERY.md",
      "path:scripts/orphaned-task-authority-recovery-controller.mjs",
      "semantic:orphaned-task-authority-recovery",
    ],
  };
}

test("plan binds the exact source and authorization", () => {
  const plan = buildRepeatedRecoveryPlan({ evidence: evidence(), targetManifest: targetManifest() });
  assert.match(plan.exactAuthorization,
    /^authorize repeated-expired-committed-heartbeat-recovery [0-9a-f]{64}$/u);
  assert.equal(authorizeRepeatedRecovery({
    plan,
    authorization: plan.exactAuthorization,
  }).planDigest, plan.planDigest);
  assert.throws(() => authorizeRepeatedRecovery({
    plan,
    authorization: `${plan.exactAuthorization} `,
  }), /exact authorization/u);
});

test("plan rejects a target that preserves source scope but omits an authored path", () => {
  assert.throws(() => buildRepeatedRecoveryPlan({
    evidence: evidence(),
    targetManifest: {
      ...targetManifest(),
      declaredWriteSet: [
        "path:docs/ORPHANED-TASK-AUTHORITY-RECOVERY.md",
        "path:unrelated-file.mjs",
        "semantic:orphaned-task-authority-recovery",
      ],
    },
  }), /cover every protected-refresh authored path/u);
});

test("controller plans read-only and executes only through its adapter", async () => {
  const calls = [];
  const adapter = {
    inspect: async () => { calls.push("inspect"); return evidence(); },
    readTargetManifest: async () => { calls.push("manifest"); return targetManifest(); },
    execute: async ({ plan }) => { calls.push("execute"); return { status: "complete", planDigest: plan.planDigest }; },
    readActiveIntent: async () => null,
    readIntentForAuthorization: async () => null,
  };
  const controller = createRepeatedRecoveryController({ adapter });
  const planned = await controller.plan();
  assert.deepEqual(calls, ["inspect", "manifest"]);
  const completed = await controller.run({ authorization: planned.exactAuthorization });
  assert.equal(completed.status, "complete");
  assert.deepEqual(calls, ["inspect", "manifest", "inspect", "manifest", "execute"]);
});

test("successor bind state adopts only the exact response-loss transition", () => {
  const plan = buildRepeatedRecoveryPlan({
    evidence: evidence(),
    targetManifest: targetManifest(),
  });
  const promoted = {
    claimId: digest("3"),
    claimDigest: digest("4"),
    transitionCounter: 2,
  };
  const common = {
    claimId: promoted.claimId,
    canonicalBaseRevision: plan.evidence.baseSha,
    declaredWriteScope: plan.target.declaredWriteSet,
    writeSetDigest: plan.target.writeSetDigest,
  };
  assert.equal(classifyRepeatedSuccessorBindState({
    claim: {
      ...common,
      state: "current",
      fenceRevision: promoted.claimDigest,
      transitionCounter: 2,
      laneRevision: plan.evidence.fenceSha,
      reviewRequestId: null,
    },
    promoted,
    plan,
  }), "bind");
  assert.equal(classifyRepeatedSuccessorBindState({
    claim: {
      ...common,
      state: "active",
      transitionCounter: 3,
      laneRevision: plan.evidence.headSha,
      reviewRequestId: plan.evidence.reviewRequestId,
    },
    promoted,
    plan,
  }), "adopt");
  assert.throws(() => classifyRepeatedSuccessorBindState({
    claim: {
      ...common,
      state: "active",
      transitionCounter: 4,
      laneRevision: plan.evidence.headSha,
      reviewRequestId: plan.evidence.reviewRequestId,
    },
    promoted,
    plan,
  }), /neither pre-bind nor exact bound response-loss/u);
});

test("completion proves successor recovery effects and forbids delivery effects", () => {
  const plan = buildRepeatedRecoveryPlan({ evidence: evidence(), targetManifest: targetManifest() });
  const intent = {
    schema: INTENT_SCHEMA,
    status: "marker-projected",
    planDigest: plan.planDigest,
  };
  const completion = buildRepeatedRecoveryCompletion({
    plan,
    intent,
    finalEvidence: {
      successorClaimId: digest("3"),
      successorClaimDigest: digest("4"),
      successorTransitionCounter: 3,
      targetLeaseDigest: digest("5"),
      targetTaskBindingDigest: digest("8"),
      targetMarkerDigest: digest("9"),
      completedAt: "2026-08-23T11:30:00.000Z",
    },
  });
  assert.equal(completion.effects.cloudSuccessor, true);
  assert.equal(completion.effects.writerLeaseCas, true);
  assert.equal(completion.effects.taskAuthoritySuccessorBinding, true);
  assert.equal(completion.effects.pullRequestMarkerReplacement, true);
  assert.equal(completion.effects.merge, false);
  assert.equal(completion.effects.deployment, false);
  assert.match(completion.receiptDigest, /^[0-9a-f]{64}$/u);
});
