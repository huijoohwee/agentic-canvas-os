import assert from "node:assert/strict";
import test from "node:test";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  EXPIRED_PLANNED_COMMITTED_PR_MARKER_RESPONSE_LOSS_OPERATION,
  buildExpiredPlannedCommittedPrMarkerResponseLossPlan,
  normalizeExpiredPlannedCommittedPrMarkerResponseLossIntent,
} from "../scripts/expired-planned-committed-pr-marker-response-loss-contract.mjs";
import {
  createExpiredPlannedCommittedPrMarkerResponseLossController,
} from "../scripts/expired-planned-committed-pr-marker-response-loss-controller.mjs";

const D = value => digestValue({ value });
const S = value => value.repeat(40);
const BASE = S("1");
const FENCE = S("2");
const DESCENDANT = S("3");
const TREE = S("4");
const BRANCH = "agent/device.local/expired-planned-marker";
const EXPIRES_AT = "2026-08-16T01:00:00.000Z";
const OBSERVED_AT = "2026-08-16T02:00:00.000Z";

function authority(transitionCounter, heartbeatCounter, expiresAt, suffix) {
  return {
    schema: "agentic-lane-cloud-authority/v1",
    claimId: D("claim"),
    claimDigest: D(`claim-${suffix}`),
    claimLedgerRevision: D(`transition-${suffix}`),
    operationReceiptDigest: D(`receipt-${suffix}`),
    laneRevision: FENCE,
    writeSetDigest: D("write-set"),
    transitionCounter,
    heartbeatCounter,
    expiresAt,
  };
}

function evidence({ providerState = "source" } = {}) {
  const sourceAuthority = authority(6, 2, "2026-08-16T00:30:00.000Z", "source");
  const targetAuthority = authority(7, 2, EXPIRES_AT, "target");
  const leaseStable = {
    status: "active",
    admissionStatus: "admitted",
    branch: BRANCH,
    baseSha: BASE,
    fenceSha: FENCE,
    taskAuthorityBindingDigest: D("binding"),
  };
  const sourceBodyDigest = D("source-body");
  const targetBodyDigest = D("target-body");
  const sourceMarkerDigest = D("source-marker");
  const targetMarkerDigest = D("target-marker");
  return {
    schema: "agentic-expired-planned-committed-pr-marker-response-loss-evidence/v1",
    repository: "example/repository",
    observedAt: OBSERVED_AT,
    worktree: {
      identityDigest: D("worktree"),
      branch: BRANCH,
      headSha: DESCENDANT,
      treeSha: TREE,
      clean: true,
      registered: true,
      fenceAncestorOfHead: true,
    },
    remoteHeadSha: FENCE,
    lease: {
      ...leaseStable,
      leaseDigest: D("lease"),
      expiresAt: EXPIRES_AT,
      cloudAuthority: targetAuthority,
    },
    providerReview: {
      id: "PR_793",
      url: "https://provider.test/example/repository/pull/793",
      state: "open",
      draft: true,
      headBranch: BRANCH,
      headSha: FENCE,
      sourceBodyDigest,
      targetBodyDigest,
      sourceMarkerDigest,
      targetMarkerDigest,
      providerState,
      currentBodyDigest: providerState === "source" ? sourceBodyDigest : targetBodyDigest,
      currentMarkerDigest: providerState === "source"
        ? sourceMarkerDigest : targetMarkerDigest,
      mutationSemantics: "observable-pre-read-edit-post-read",
    },
    providerMarker: {
      stableLeaseDigest: digestValue(leaseStable),
      cloudAuthority: sourceAuthority,
    },
    cloudClaim: {
      state: "dormant-preserved",
      writeAuthority: false,
      scopeReserved: true,
      claimId: targetAuthority.claimId,
      fenceRevision: targetAuthority.claimDigest,
      transitionDigest: targetAuthority.claimLedgerRevision,
      operationReceiptDigest: targetAuthority.operationReceiptDigest,
      transitionCounter: targetAuthority.transitionCounter,
      heartbeatCounter: targetAuthority.heartbeatCounter,
    },
  };
}

function fakeAdapter({ projection = "source", initialIntent = null } = {}) {
  let intent = initialIntent;
  const calls = [];
  const observed = evidence({ providerState: projection === "target" ? "target" : "source" });
  const targetDigest = observed.providerReview.targetBodyDigest;
  const adapter = {
    async readPlanEvidence() { calls.push("plan-evidence"); return observed; },
    async withOperationLock(action) { calls.push("lock"); return action(); },
    async readIntent() { calls.push("read-intent"); return intent; },
    async writeIntent({ expected, value }) {
      assert.equal(intent, expected);
      intent = value;
      calls.push(`write:${value.status}`);
    },
    async authorizeTask(plan) {
      calls.push("task-proof");
      assert.equal(
        plan.taskAuthorityOperation,
        `${EXPIRED_PLANNED_COMMITTED_PR_MARKER_RESPONSE_LOSS_OPERATION}:${plan.planDigest}`,
      );
      return {
        taskAuthorityReceiptDigest: D("task-authorization"),
        bindingDigest: observed.lease.taskAuthorityBindingDigest,
      };
    },
    async revalidate(_plan, stage) {
      calls.push(`revalidate:${stage}`);
      if (stage === "after-provider-error") {
        return projection === "response-loss-target"
          ? {
              providerProjected: true,
              disposition: "adopted-response-loss",
              providerMutation: false,
              projectionDigest: targetDigest,
            }
          : { providerProjected: false, disposition: "third-body" };
      }
      return {
        revalidationDigest: D(stage),
        providerState: projection === "target" ? "target" : "source",
      };
    },
    async projectProviderBody() {
      calls.push("project-provider");
      if (projection.startsWith("response-loss")) throw new Error("provider response lost");
      return {
        disposition: projection === "target" ? "adopted-response-loss" : "projected",
        providerMutation: projection !== "target",
        projectionDigest: targetDigest,
      };
    },
    async verifyTerminal(_plan, { replay }) {
      calls.push(`verify-terminal:${replay}`);
      return { verificationDigest: D(`terminal-${replay}`) };
    },
  };
  return { adapter, calls, intent: () => intent };
}

test("plan seals only the exact expired planned descendant and dormant cloud join", () => {
  const plan = buildExpiredPlannedCommittedPrMarkerResponseLossPlan({ evidence: evidence() });
  assert.equal(
    plan.taskAuthorityOperation,
    `${EXPIRED_PLANNED_COMMITTED_PR_MARKER_RESPONSE_LOSS_OPERATION}:${plan.planDigest}`,
  );
  assert.equal(Object.hasOwn(plan, "exactAuthorization"), false);
  for (const mutate of [
    value => { value.worktree.clean = false; },
    value => { value.worktree.headSha = FENCE; },
    value => { value.remoteHeadSha = DESCENDANT; },
    value => { value.lease.admissionStatus = "planned"; },
    value => { value.providerMarker.cloudAuthority.transitionCounter = 5; },
    value => { value.cloudClaim.state = "current"; },
    value => { value.providerReview.currentBodyDigest = D("third-body"); },
  ]) {
    const changed = structuredClone(evidence());
    mutate(changed);
    assert.throws(
      () => buildExpiredPlannedCommittedPrMarkerResponseLossPlan({ evidence: changed }),
      /exact expired planned marker repair boundary|lease admission status|cloud claim state/u,
    );
  }
});

test("run requires task authorization and grants only provider-body repair", async () => {
  const fixture = fakeAdapter();
  const controller = createExpiredPlannedCommittedPrMarkerResponseLossController(fixture.adapter);
  const receipt = await controller.run({ plan: await controller.plan() });
  assert.equal(receipt.status, "projection-restored-expired-admitted");
  assert.deepEqual(receipt.mutationSet, ["provider-review-body"]);
  assert.equal(receipt.privateJournalMutation, true);
  assert.deepEqual([
    receipt.cloudMutation,
    receipt.writerRegistryMutation,
    receipt.leaseRegistryMutation,
    receipt.claimRegistryMutation,
    receipt.gitMutation,
    receipt.remoteRefMutation,
    receipt.sourceMutation,
    receipt.providerReviewMetadataMutation,
    receipt.authoringAuthorityGranted,
    receipt.integrationAuthorityGranted,
    receipt.releaseAuthorityGranted,
    receipt.deploymentAuthorityGranted,
    receipt.cleanupAuthorityGranted,
  ], Array(13).fill(false));
  assert.deepEqual(fixture.calls, [
    "plan-evidence", "lock", "read-intent", "write:prepared",
    "revalidate:before-authority", "task-proof", "write:authority-verified",
    "revalidate:before-provider", "write:provider-attempted", "project-provider",
    "write:provider-projected", "verify-terminal:false", "write:complete",
  ]);
});

test("source, target, and response-loss replay are exact and third bodies fail closed", async () => {
  const target = fakeAdapter({ projection: "target" });
  const targetController = createExpiredPlannedCommittedPrMarkerResponseLossController(
    target.adapter,
  );
  const targetReceipt = await targetController.run({ plan: await targetController.plan() });
  assert.equal(targetReceipt.providerDisposition, "adopted-response-loss");
  assert.equal(targetReceipt.providerMutation, false);

  const lost = fakeAdapter({ projection: "response-loss-target" });
  const lostController = createExpiredPlannedCommittedPrMarkerResponseLossController(lost.adapter);
  const expected = await lostController.run({ plan: await lostController.plan() });
  assert.ok(lost.calls.includes("revalidate:after-provider-error"));
  const replay = fakeAdapter({ initialIntent: lost.intent() });
  const replayed = await createExpiredPlannedCommittedPrMarkerResponseLossController(replay.adapter)
    .run({ plan: lost.intent().planSnapshot });
  assert.equal(replayed.receiptDigest, expected.receiptDigest);
  assert.deepEqual(replay.calls, ["lock", "read-intent", "verify-terminal:true"]);

  const third = fakeAdapter({ projection: "response-loss-third" });
  const thirdController = createExpiredPlannedCommittedPrMarkerResponseLossController(third.adapter);
  const thirdPlan = await thirdController.plan();
  await assert.rejects(() => thirdController.run({ plan: thirdPlan }), /provider response lost/u);
  assert.equal(
    normalizeExpiredPlannedCommittedPrMarkerResponseLossIntent(third.intent()).status,
    "provider-attempted",
  );
});
