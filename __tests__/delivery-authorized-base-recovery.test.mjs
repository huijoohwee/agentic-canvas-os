import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertDeliveryAuthorizedBaseRecoveryAuthorization,
  buildDeliveryAuthorizedBaseRecoveryPlan,
} from "../scripts/delivery-authorized-base-recovery-contract.mjs";
import {
  complete,
  createDeliveryAuthorizedBaseRecoveryController,
  pending,
} from "../scripts/delivery-authorized-base-recovery-controller.mjs";
import {
  advanceDeliveryAuthorizedBaseRecoveryIntent,
  createDeliveryAuthorizedBaseRecoveryIntent,
} from "../scripts/delivery-authorized-base-recovery-intent.mjs";
import { requireAuthorizedDeliveryCloudPreimage }
  from "../scripts/delivery-authorized-base-recovery-repository-adapter.mjs";

const sha = character => character.repeat(40);
const digest = character => character.repeat(64);
const declaredWriteSet = Object.freeze([
  "path:scripts/recover.mjs",
  "semantic:delivery-peer-root-ledger-projection",
]);
const allowedEffects = Object.freeze([
  "pull-request-draft-demotion",
  "same-owner-successor-claim",
  "predecessor-retirement",
  "writer-lease-base-cas",
  "pull-request-marker-projection",
]);

function evidence(overrides = {}) {
  return {
    schema: "agentic-delivery-authorized-base-recovery-evidence/v1",
    repository: "owner/repository",
    repositoryId: "R_repository",
    actorLogin: "owner",
    actorId: 42,
    pullRequestAuthorLogin: "owner",
    branch: "agent/device/delivery-peer-root-ledger-projection",
    sessionId: "owner-session",
    deviceId: "device",
    semanticScope: "delivery-peer-root-ledger-projection",
    headSha: sha("d"),
    treeSha: sha("e"),
    remoteHeadSha: sha("d"),
    protectedMainSha: sha("c"),
    protectedMainTreeSha: sha("f"),
    originalBaseSha: sha("a"),
    deliveryBaseSha: sha("c"),
    fenceSha: sha("b"),
    deliveryHeadSha: sha("d"),
    protectedRefreshReceiptDigest: null,
    protectedRefreshBaseSha: null,
    protectedRefreshCount: 0,
    leaseStatus: "active",
    leaseEpoch: 234,
    leaseDigest: digest("1"),
    pullRequestNumber: 368,
    pullRequestNodeId: "PR_368",
    pullRequestState: "OPEN",
    pullRequestIsDraft: false,
    pullRequestHeadSha: sha("d"),
    pullRequestBaseSha: sha("c"),
    pullRequestAutoMergeRequest: null,
    pullRequestBodyDigest: digest("2"),
    pullRequestMarkerDigest: digest("3"),
    claimId: digest("4"),
    claimDigest: digest("5"),
    claimLedgerRevision: digest("6"),
    ledgerRevision: sha("7"),
    ledgerDigest: digest("7"),
    claimInventoryDigest: digest("0"),
    claimState: "dormant-preserved",
    projectedAuthorityState: "delivery_authorized",
    projectedAuthorityDigest: digest("f"),
    claimActorId: "github-user:42",
    claimRepositoryId: "github-repository:R_repository",
    claimWriteAuthority: false,
    claimScopeReserved: true,
    claimLeaseEpoch: 18,
    claimTransitionCounter: 9,
    claimCanonicalBaseSha: sha("a"),
    claimLaneRevision: sha("d"),
    claimReviewRequestId: "github-pull-request:PR_368",
    claimWorkItemId: "work-item:delivery-peer-root-ledger-projection",
    operationReceiptDigest: digest("8"),
    integrationReceiptDigest: digest("9"),
    manifestDigest: digest("a"),
    writeSetDigest: digest("b"),
    declaredWriteSet,
    deliveryChangedPaths: ["scripts/recover.mjs"],
    protectedMainChangedPaths: ["scripts/controller.mjs"],
    protectedMainOverlapPaths: [],
    originalAuthoredPaths: ["scripts/recover.mjs"],
    outsideScopeEquivalenceDigest: digest("c"),
    clean: true,
    originalBaseAncestor: true,
    deliveryBaseAncestor: true,
    deliveryBaseAncestorOfProtectedMain: true,
    fenceAncestor: true,
    ...overrides,
  };
}

function planned() {
  return buildDeliveryAuthorizedBaseRecoveryPlan(evidence());
}

test("plan binds exact identities and one authorization", () => {
  const plan = planned();
  assert.equal(plan.status, "planned");
  assert.equal(
    plan.exactAuthorization,
    `authorize delivery-authorized-base-recovery ${plan.planDigest}`,
  );
  assert.throws(
    () => assertDeliveryAuthorizedBaseRecoveryAuthorization(
      plan,
      `${plan.exactAuthorization} `,
    ),
    /does not match/u,
  );
});

test("plan admits active and delivery source projections only", () => {
  assert.equal(
    buildDeliveryAuthorizedBaseRecoveryPlan(evidence({ leaseStatus: "active" })).status,
    "planned",
  );
  assert.equal(
    buildDeliveryAuthorizedBaseRecoveryPlan(evidence({ leaseStatus: "delivery" })).status,
    "planned",
  );
  assert.deepEqual(
    buildDeliveryAuthorizedBaseRecoveryPlan(evidence({ leaseStatus: "review_ready" })).findings,
    ["local-lease-state-not-recoverable"],
  );
});

test("plan binds an exact protected-main refresh above the delivered head", () => {
  const refreshed = evidence({
    headSha: sha("e"),
    remoteHeadSha: sha("e"),
    pullRequestHeadSha: sha("e"),
    protectedRefreshReceiptDigest: digest("d"),
    protectedRefreshBaseSha: sha("c"),
    protectedRefreshCount: 3,
  });
  assert.equal(buildDeliveryAuthorizedBaseRecoveryPlan(refreshed).status, "planned");
  assert.deepEqual(
    buildDeliveryAuthorizedBaseRecoveryPlan({
      ...refreshed,
      protectedRefreshBaseSha: sha("b"),
    }).findings,
    ["protected-refresh-proof-invalid"],
  );
  assert.deepEqual(
    buildDeliveryAuthorizedBaseRecoveryPlan(evidence({
      protectedRefreshReceiptDigest: digest("d"),
      protectedRefreshBaseSha: sha("c"),
      protectedRefreshCount: 1,
    })).findings,
    ["unexpected-protected-refresh-proof"],
  );
});

test("plan blocks provider, authority, ancestry, and write-set drift", () => {
  assert.deepEqual(
    buildDeliveryAuthorizedBaseRecoveryPlan(evidence({ pullRequestIsDraft: true })).findings,
    ["pull-request-not-open-ready"],
  );
  assert.deepEqual(
    buildDeliveryAuthorizedBaseRecoveryPlan(evidence({ claimWriteAuthority: true })).findings,
    ["claim-authority-shape-invalid"],
  );
  assert.deepEqual(
    buildDeliveryAuthorizedBaseRecoveryPlan(evidence({ deliveryBaseAncestor: false })).findings,
    ["delivery-base-not-ancestor"],
  );
  assert.deepEqual(
    buildDeliveryAuthorizedBaseRecoveryPlan(evidence({
      deliveryChangedPaths: ["docs/unowned.md"],
    })).findings,
    ["delivery-diff-outside-write-set"],
  );
  assert.deepEqual(
    buildDeliveryAuthorizedBaseRecoveryPlan(evidence({
      protectedMainOverlapPaths: ["scripts/recover.mjs"],
    })).findings,
    ["protected-main-drift-overlaps-write-set"],
  );
  assert.deepEqual(
    buildDeliveryAuthorizedBaseRecoveryPlan(evidence({
      deliveryBaseAncestorOfProtectedMain: false,
    })).findings,
    ["protected-main-not-delivery-base-descendant"],
  );
});

test("intent is monotonic and content-bound", () => {
  const plan = planned();
  const intent = createDeliveryAuthorizedBaseRecoveryIntent(plan, plan.exactAuthorization);
  assert.equal(intent.status, "prepared");
  assert.throws(
    () => advanceDeliveryAuthorizedBaseRecoveryIntent(intent, {
      status: "successor_waiting",
      values: { claimId: digest("d") },
    }),
    /cannot skip/u,
  );
});

function fakeAdapter({ loseResponseAt = null } = {}) {
  let intent = null;
  const completed = new Map();
  const effects = [];
  const authority = {
    claimId: digest("d"),
    claimDigest: digest("e"),
    leaseEpoch: 19,
    transitionCounter: 3,
  };
  const values = {
    pull_request_drafted: { pullRequestDigest: digest("1") },
    successor_waiting: { successorClaimId: digest("d") },
    predecessor_retired: { retirementDigest: digest("2") },
    successor_active: { successorClaimId: digest("d") },
    lease_projected: { leaseDigest: digest("3") },
    marker_projected: { markerDigest: digest("4") },
  };
  const adapter = {
    withFence: action => action(),
    readEvidence: async () => evidence(),
    readIntent: async () => intent,
    writeIntent: async ({ expected, value }) => {
      assert.deepEqual(intent, expected);
      intent = value;
    },
    reconcilePhase: async ({ phase }) => completed.has(phase)
      ? complete(completed.get(phase)) : pending(),
  };
  for (const [phase, method] of Object.entries({
    pull_request_drafted: "demotePullRequest",
    successor_waiting: "createWaitingSuccessor",
    predecessor_retired: "retirePredecessor",
    successor_active: "promoteSuccessor",
    lease_projected: "projectLease",
    marker_projected: "projectMarker",
  })) {
    adapter[method] = async () => {
      effects.push(phase);
      completed.set(phase, values[phase]);
      if (phase === loseResponseAt) throw new Error("simulated lost response");
      return complete(values[phase]);
    };
  }
  adapter.verifyTerminal = async ({ plan }) => {
    effects.push("verified");
    const receipt = {
      schema: "agentic-delivery-authorized-base-recovery-receipt/v1",
      outcome: "recovered",
      planDigest: plan.planDigest,
      originalBaseSha: plan.evidence.originalBaseSha,
      deliveryBaseSha: plan.evidence.deliveryBaseSha,
      sourceLeaseDigest: plan.evidence.leaseDigest,
      sourceClaimId: plan.evidence.claimId,
      successorClaimId: authority.claimId,
      successorClaimDigest: authority.claimDigest,
      successorLeaseEpoch: authority.leaseEpoch,
      successorTransitionCounter: authority.transitionCounter,
      finalLeaseDigest: digest("3"),
      finalMarkerDigest: digest("4"),
      effects: allowedEffects,
      forbiddenEffectsObserved: [],
    };
    const { digestValue } = await import("../scripts/cloud-collaboration-primitives.mjs");
    receipt.receiptDigest = digestValue(receipt);
    completed.set("verified", { receipt });
    return complete({ receipt });
  };
  return { adapter, effects, getIntent: () => intent };
}

test("controller sequences phases and returns a terminal receipt", async () => {
  const fake = fakeAdapter();
  const controller = createDeliveryAuthorizedBaseRecoveryController({ adapter: fake.adapter });
  const plan = await controller.plan();
  const receipt = await controller.run({ authorization: plan.exactAuthorization });
  assert.equal(receipt.outcome, "recovered");
  assert.deepEqual(fake.effects, [
    "pull_request_drafted",
    "successor_waiting",
    "predecessor_retired",
    "successor_active",
    "lease_projected",
    "marker_projected",
    "verified",
  ]);
  assert.equal(fake.getIntent().status, "complete");
});

test("lost response reconciles without duplicating a phase", async () => {
  const fake = fakeAdapter({ loseResponseAt: "successor_waiting" });
  const controller = createDeliveryAuthorizedBaseRecoveryController({ adapter: fake.adapter });
  const plan = await controller.plan();
  const receipt = await controller.run({ authorization: plan.exactAuthorization });
  assert.equal(receipt.outcome, "recovered");
  assert.equal(fake.effects.filter(item => item === "successor_waiting").length, 1);
});

test("stale authorization reaches no protected effect", async () => {
  const fake = fakeAdapter();
  const controller = createDeliveryAuthorizedBaseRecoveryController({ adapter: fake.adapter });
  const plan = await controller.plan();
  await assert.rejects(
    controller.run({ authorization: `${plan.exactAuthorization}-stale` }),
    /does not match/u,
  );
  assert.deepEqual(fake.effects, []);
  assert.equal(fake.getIntent(), null);
});

test("cloud replay permits only disjoint global-ledger movement", () => {
  const plan = planned();
  const source = {
    claimId: plan.evidence.claimId, fenceRevision: plan.evidence.claimDigest,
    transitionDigest: plan.evidence.claimLedgerRevision,
    transitionCounter: plan.evidence.claimTransitionCounter,
    leaseEpoch: plan.evidence.claimLeaseEpoch, actorId: plan.evidence.claimActorId,
    repositoryId: plan.evidence.claimRepositoryId, workItemId: plan.evidence.claimWorkItemId,
    canonicalBaseRevision: plan.evidence.claimCanonicalBaseSha,
    laneRevision: plan.evidence.claimLaneRevision, writeSetDigest: plan.evidence.writeSetDigest,
    reviewRequestId: plan.evidence.claimReviewRequestId,
    integrationReceiptDigest: plan.evidence.integrationReceiptDigest,
    state: "dormant-preserved", scopeReserved: true, writeAuthority: false,
  };
  const disjoint = { claimId: digest("d"), scopeReserved: true,
    declaredWriteScope: ["path:docs/disjoint.md", "semantic:disjoint"] };
  assert.equal(requireAuthorizedDeliveryCloudPreimage(plan, {
    ledgerDigest: digest("e"), claims: [source, disjoint],
  }), source);
  assert.throws(() => requireAuthorizedDeliveryCloudPreimage(plan, {
    claims: [{ ...source, fenceRevision: digest("e") }],
  }), /authorized cloud preimage drift/u);
  assert.throws(() => requireAuthorizedDeliveryCloudPreimage(plan, {
    claims: [source, { ...disjoint, declaredWriteScope: declaredWriteSet }],
  }), /authorized cloud preimage drift/u);
});

test("repository adapter preserves CAS and no-force invariants", () => {
  const source = readFileSync(
    new URL("../scripts/delivery-authorized-base-recovery-repository-adapter.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /expectedLedgerDigest/u);
  assert.match(source, /requireAuthorizedDeliveryCloudPreimage\(plan, before\)/u);
  assert.match(source, /source\.fenceRevision !== plan\.evidence\.claimDigest/u);
  assert.match(source, /source\.transitionDigest !== plan\.evidence\.claimLedgerRevision/u);
  assert.match(source, /writeSetsOverlap\(item\.declaredWriteScope, plan\.evidence\.declaredWriteSet\)/u);
  assert.doesNotMatch(source, /before\.ledgerDigest !== plan\.evidence\.ledgerDigest/u);
  assert.doesNotMatch(source, /digestValue\(before\.claims\) !== plan\.evidence\.claimInventoryDigest/u);
  assert.match(source, /casWriterLeaseProjection/u);
  assert.match(source, /predecessorClaimId/u);
  assert.match(source, /RECOVERABLE_SOURCE_STATUSES/u);
  assert.match(source, /const canonicalBaseSha = protectedSource\(plan\)/u);
  assert.match(source, /baseSha: authority\.canonicalBaseSha/u);
  assert.match(source, /taskAuthority:\s*current\.taskAuthority\s*\?\s*continueTaskAuthorityBinding/u);
  assert.match(source, /merge-base", "--is-ancestor", plan\.evidence\.protectedMainSha, selected/u);
  assert.match(
    source,
    /changed\.length > 0 && writeSetsOverlap\(changed, plan\.evidence\.declaredWriteSet\)/u,
  );
  assert.match(source, /declaredWriteScope: plan\.evidence\.declaredWriteSet/u);
  assert.doesNotMatch(source, /declaredWriteSet: plan\.evidence\.declaredWriteSet/u);
  assert.match(source, /pull\.baseRefOid !== plan\.evidence\.deliveryBaseSha/u);
  assert.doesNotMatch(source, /canonicalBaseSha: plan\.evidence\.(?:deliveryBaseSha|protectedMainSha)/u);
  assert.match(source, /openSync\(lockPath, "wx"/u);
  assert.doesNotMatch(source, /--force|force-with-lease/u);
});
