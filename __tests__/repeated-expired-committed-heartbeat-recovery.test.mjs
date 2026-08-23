import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeRepeatedRecovery,
  buildRepeatedRecoveryCompletion,
  buildRepeatedRecoveryPlan,
  INTENT_SCHEMA,
} from "../scripts/repeated-expired-committed-heartbeat-recovery-contract.mjs";
import { createRepeatedRecoveryController }
  from "../scripts/repeated-expired-committed-heartbeat-recovery-controller.mjs";

const digest = character => character.repeat(64);
const sha = character => character.repeat(40);

function evidence() {
  return {
    repositoryId: "R_repository",
    branch: "agent/device/repeated-expired-committed-heartbeat-recovery",
    sessionId: "owner-session",
    pullRequestNumber: 646,
    baseSha: sha("1"),
    fenceSha: sha("2"),
    headSha: sha("3"),
    remoteHeadSha: sha("4"),
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
    writeSetDigest: digest("2"),
    expiresAt: "2026-08-23T07:48:36.000Z",
  };
}

test("plan binds the exact source and authorization", () => {
  const plan = buildRepeatedRecoveryPlan({ evidence: evidence() });
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

test("controller plans read-only and executes only through its adapter", async () => {
  const calls = [];
  const adapter = {
    inspect: async () => { calls.push("inspect"); return evidence(); },
    execute: async ({ plan }) => { calls.push("execute"); return { status: "complete", planDigest: plan.planDigest }; },
    readActiveIntent: async () => null,
    readIntentForAuthorization: async () => null,
  };
  const controller = createRepeatedRecoveryController({ adapter });
  const planned = await controller.plan();
  assert.deepEqual(calls, ["inspect"]);
  const completed = await controller.run({ authorization: planned.exactAuthorization });
  assert.equal(completed.status, "complete");
  assert.deepEqual(calls, ["inspect", "inspect", "execute"]);
});

test("completion proves the three narrow effects and forbids delivery effects", () => {
  const plan = buildRepeatedRecoveryPlan({ evidence: evidence() });
  const intent = {
    schema: INTENT_SCHEMA,
    status: "marker-projected",
    planDigest: plan.planDigest,
  };
  const completion = buildRepeatedRecoveryCompletion({
    plan,
    intent,
    finalEvidence: {
      renewedClaimDigest: digest("3"),
      renewedTransitionCounter: 8,
      targetLeaseDigest: digest("4"),
      targetMarkerDigest: digest("5"),
      completedAt: "2026-08-23T11:30:00.000Z",
    },
  });
  assert.equal(completion.effects.cloudContinuation, true);
  assert.equal(completion.effects.writerLeaseCas, true);
  assert.equal(completion.effects.pullRequestMarkerReplacement, true);
  assert.equal(completion.effects.merge, false);
  assert.equal(completion.effects.deployment, false);
  assert.match(completion.receiptDigest, /^[0-9a-f]{64}$/u);
});
