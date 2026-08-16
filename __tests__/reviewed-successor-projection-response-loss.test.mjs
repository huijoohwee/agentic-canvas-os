import test from "node:test";
import assert from "node:assert/strict";
import { digestValue as digest } from "../scripts/cloud-collaboration-primitives.mjs";
import { createTaskAuthorityBinding, createTaskAuthorityCapability } from "../scripts/task-bound-lane-authority-contract.mjs";
import {
  AUTHORIZATION_PREFIX, MUTATION_POLICY, PARTIAL_LOCAL_MUTATION_POLICY, buildReviewedSuccessorProjectionResponseLossPlan,
  normalizeReviewedSuccessorProjectionResponseLossPlan,
} from "../scripts/reviewed-successor-projection-response-loss-contract.mjs";
import { createReviewedSuccessorProjectionResponseLossController } from "../scripts/reviewed-successor-projection-response-loss-controller.mjs";

const D = value => digest(value);
const SHA = value => value.repeat(40);

function fixture() {
  const oldClaim = D("old");
  const newClaim = D("new");
  const head = SHA("2");
  const base = SHA("1");
  const markerDigest = D("marker");
  const local = { status: "review_ready", admissionStatus: "admitted", clean: true, baseSha: base, headSha: head, writeSetDigest: D("write-set"), reviewRequestId: "github-pull-request:PR519", leaseEpoch: 1, claimId: oldClaim, taskBindingDigest: D("old-binding"), leaseDigest: D("lease"), markerDigest };
  const evidenceCore = {
    mode: "absent-predecessor", observedAt: "2026-08-16T06:00:00.000Z", repository: "huijoohwee/agentic-canvas-os", actorId: "actor", workItemId: "repository-teardown", branch: "agent/device/repository-teardown", sessionId: "session", local, remoteHeadSha: head,
    pullRequest: { number: 519, id: "PR519", url: "https://github.com/huijoohwee/agentic-canvas-os/pull/519", state: "OPEN", isDraft: false, autoMergeRequest: null, headRefName: "agent/device/repository-teardown", headRefOid: head, baseRefName: "main", markerClaimId: oldClaim, markerLeaseEpoch: 1, markerDigest },
    predecessor: { claimId: oldClaim, cloudInventoryMatches: 0, leaseEpoch: 1 },
    successor: { cloudInventoryMatches: 1, claimId: newClaim, predecessorClaimId: oldClaim, state: "dormant-preserved", actorId: "actor", repository: "huijoohwee/agentic-canvas-os", workItemId: "repository-teardown", canonicalBaseSha: base, laneRevision: head, writeSetDigest: local.writeSetDigest, reviewRequestId: local.reviewRequestId, leaseEpoch: 2, integrationState: "not-integrated", operationReceiptDigest: D("operation"), verificationReceiptDigest: D("verification"), authorityDigest: D("authority") },
    partialLocal: null,
  };
  const evidence = { ...evidenceCore, evidenceDigest: D(evidenceCore) };
  const prepared = { expectedLeaseDigest: local.leaseDigest, expectedMarkerDigest: markerDigest, expectedSuccessorClaimId: newClaim, binding: { bindingDigest: D("binding") }, successorReceipt: { receiptDigest: D("successor-receipt") }, targetCloudAuthority: { claimId: newClaim, leaseEpoch: 2 } };
  const projected = { ...prepared, taskAuthorityReceiptDigest: D("task-authority"), targetBindingDigest: D("binding"), successorReceiptDigest: D("successor-receipt"), targetLeaseDigest: D("target-lease"), targetMarkerDigest: D("target-marker"), registryRevision: 8 };
  const terminal = { targetLeaseDigest: projected.targetLeaseDigest, targetMarkerDigest: projected.targetMarkerDigest, registryRevision: 8, verifiedAt: "2026-08-16T06:01:00.000Z" };
  return { evidence, prepared, projected, terminal };
}

function partialFixture({ repaired = false } = {}) {
  const subject = fixture();
  const { evidence } = subject;
  const predecessorClaimId = evidence.predecessor.claimId;
  const successorClaimId = evidence.successor.claimId;
  const branch = evidence.branch;
  const bindingSourceCore = { schema: "agentic-writer-lease/v2", status: "review_ready", branch, scope: "handoff-successor-response-loss", device: "device", epoch: 323, baseSha: evidence.local.baseSha, fenceSha: evidence.local.headSha, cloudAuthority: { claimId: predecessorClaimId, leaseEpoch: 2 } };
  const capability = createTaskAuthorityCapability({ issuedAt: "2026-08-16T05:00:00.000Z" });
  const retainedTaskAuthority = createTaskAuthorityBinding({ capability, lease: bindingSourceCore, boundAt: "2026-08-16T05:00:01.000Z" });
  const bindingSourceLease = { ...bindingSourceCore, taskAuthority: retainedTaskAuthority };
  let actualLease = { ...bindingSourceLease, cloudAuthority: { ...bindingSourceLease.cloudAuthority, claimId: successorClaimId, leaseEpoch: 2 } };
  let repair = null;
  if (repaired) {
    const targetTaskAuthority = { ...retainedTaskAuthority, bindingMode: "continuation", boundAt: "2026-08-16T05:01:00.000Z", priorBindingDigest: retainedTaskAuthority.bindingDigest, bindingDigest: D("target-binding") };
    const repairCore = { schema: "agentic-reviewed-successor-partial-local-projection-repair/v1", status: "repaired", evidenceDigest: D("repair-evidence"), branch, predecessorClaimId, successorClaimId, sourceBindingDigest: retainedTaskAuthority.bindingDigest, targetBindingDigest: targetTaskAuthority.bindingDigest, boundAt: "2026-08-16T05:01:00.000Z", cloudEffect: false, pullRequestEffect: false, gitEffect: false, sourceEffect: false, integrationEffect: false, deploymentEffect: false };
    repair = { ...repairCore, receiptDigest: D(repairCore) };
    actualLease = { ...actualLease, taskAuthority: targetTaskAuthority, reviewedSuccessorPartialLocalProjectionRepair: repair };
    subject.projected = { ...subject.projected, binding: targetTaskAuthority, successorReceipt: repair, targetBindingDigest: targetTaskAuthority.bindingDigest, successorReceiptDigest: repair.receiptDigest };
  }
  const { taskAuthority: _taskAuthority, reviewedSuccessorPartialLocalProjectionRepair: _repair, ...stableLease } = actualLease;
  const partialLocal = { projectionState: repaired ? "repaired" : "pending", stableLeaseDigest: D(stableLease), actualLease, bindingSourceLease: repaired ? null : bindingSourceLease, sourceBindingDigest: retainedTaskAuthority.bindingDigest, repair };
  const local = { ...evidence.local, status: "active", claimId: successorClaimId, leaseEpoch: 2, taskBindingDigest: actualLease.taskAuthority.bindingDigest, leaseDigest: D(actualLease) };
  const pullRequest = { ...evidence.pullRequest, markerClaimId: successorClaimId, markerLeaseEpoch: 2 };
  const core = { ...evidence, mode: "partial-local-successor", local, pullRequest, partialLocal };
  delete core.evidenceDigest;
  const partialEvidence = { ...core, evidenceDigest: D(core) };
  return { ...subject, evidence: partialEvidence, bindingSourceLease, actualLease, repair };
}

function adapter(subject = fixture()) {
  const effects = { projection: 0, verifies: 0 };
  return {
    inspect: () => structuredClone(subject.evidence),
    project: ({ taskAuthorityFile }) => { assert.equal(taskAuthorityFile, "/capability.json"); effects.projection += 1; return subject.projected; },
    verify: () => { effects.verifies += 1; return subject.terminal; }, effects,
  };
}

test("plan seals the unique reviewed successor and projection-only policy", () => {
  const plan = buildReviewedSuccessorProjectionResponseLossPlan(fixture().evidence);
  assert.deepEqual(normalizeReviewedSuccessorProjectionResponseLossPlan(plan), plan);
  assert.deepEqual(plan.mutationPolicy, MUTATION_POLICY);
  for (const forbidden of ["sourceMutation", "cloudMutation", "gitRefMutation", "mergeMutation", "integrationMutation", "deployMutation"]) assert.equal(plan.mutationPolicy[forbidden], false);
});

test("plan rejects a present predecessor, multiple successors, subject drift, integration, or mismatched heads", () => {
  const cases = [
    evidence => { evidence.predecessor.cloudInventoryMatches = 1; },
    evidence => { evidence.successor.cloudInventoryMatches = 2; },
    evidence => { evidence.successor.actorId = "other"; },
    evidence => { evidence.successor.integrationState = "integrated"; },
    evidence => { evidence.remoteHeadSha = SHA("3"); },
    evidence => { evidence.successor.leaseEpoch = 3; },
  ];
  for (const mutate of cases) { const evidence = structuredClone(fixture().evidence); mutate(evidence); delete evidence.evidenceDigest; assert.throws(() => buildReviewedSuccessorProjectionResponseLossPlan(evidence), /invalid/); }
});

test("exact authorization and capability proof precede the one atomic projection", () => {
  const runtime = adapter();
  const controller = createReviewedSuccessorProjectionResponseLossController(runtime);
  const plan = controller.plan();
  assert.throws(() => controller.run({ plan, authorization: "yes" }), /Exact authorization required/);
  assert.deepEqual(runtime.effects, { projection: 0, verifies: 0 });
  const receipt = controller.run({ plan, authorization: `${AUTHORIZATION_PREFIX} ${plan.planDigest}`, taskAuthorityFile: "/capability.json" });
  assert.deepEqual(runtime.effects, { projection: 1, verifies: 1 });
  assert.equal(receipt.successorClaimId, fixture().evidence.successor.claimId);
  assert.equal(receipt.mutationPolicy.cloudMutation, false);
});

test("a changed live subject fails before capability proof", () => {
  const changed = adapter();
  const changedController = createReviewedSuccessorProjectionResponseLossController(changed);
  const sealed = changedController.plan();
  const changedEvidence = structuredClone(fixture().evidence);
  changedEvidence.actorId = "replacement-actor";
  changedEvidence.successor.actorId = "replacement-actor";
  delete changedEvidence.evidenceDigest;
  changedEvidence.evidenceDigest = D(changedEvidence);
  changed.inspect = () => changedEvidence;
  assert.throws(() => changedController.run({ plan: sealed, authorization: `${AUTHORIZATION_PREFIX} ${sealed.planDigest}`, taskAuthorityFile: "/capability.json" }), /invalid|changed/);
  assert.deepEqual(changed.effects, { projection: 0, verifies: 0 });
});

test("fresh observation metadata preserves the exact replay subject", () => {
  const runtime = adapter();
  const controller = createReviewedSuccessorProjectionResponseLossController(runtime);
  const plan = controller.plan();
  const freshEvidence = structuredClone(fixture().evidence);
  freshEvidence.observedAt = "2026-08-16T06:05:00.000Z";
  delete freshEvidence.evidenceDigest;
  freshEvidence.evidenceDigest = D(freshEvidence);
  runtime.inspect = () => freshEvidence;

  const receipt = controller.run({
    plan,
    authorization: `${AUTHORIZATION_PREFIX} ${plan.planDigest}`,
    taskAuthorityFile: "/capability.json",
  });

  assert.equal(receipt.successorClaimId, fixture().evidence.successor.claimId);
  assert.deepEqual(runtime.effects, { projection: 1, verifies: 1 });
});

test("atomic projection result and terminal verification remain digest-fenced", () => {
  const runtime = adapter();
  const controller = createReviewedSuccessorProjectionResponseLossController(runtime);
  const plan = controller.plan();
  runtime.verify = () => ({ ...fixture().terminal, targetMarkerDigest: D("wrong") });
  assert.throws(() => controller.run({ plan, authorization: `${AUTHORIZATION_PREFIX} ${plan.planDigest}`, taskAuthorityFile: "/capability.json" }), /terminal projection/);
});

test("partial-local plan seals exact reconstructed predecessor binding source and forbids PR or cloud effects", () => {
  const partial = partialFixture();
  const plan = buildReviewedSuccessorProjectionResponseLossPlan(partial.evidence);
  assert.deepEqual(plan.mutationPolicy, PARTIAL_LOCAL_MUTATION_POLICY);
  assert.equal(plan.evidence.partialLocal.bindingSourceLease.cloudAuthority.claimId, plan.evidence.predecessor.claimId);
  assert.equal(plan.evidence.partialLocal.actualLease.cloudAuthority.claimId, plan.evidence.successor.claimId);
  assert.equal(plan.evidence.partialLocal.sourceBindingDigest, partial.bindingSourceLease.taskAuthority.bindingDigest);
  assert.equal(plan.mutationPolicy.pullRequestMutation, false);
  assert.equal(plan.mutationPolicy.cloudMutation, false);

  const reviewedCore = {
    ...partial.evidence,
    local: { ...partial.evidence.local, status: "review_ready" },
  };
  delete reviewedCore.evidenceDigest;
  assert.doesNotThrow(() => buildReviewedSuccessorProjectionResponseLossPlan({
    ...reviewedCore,
    evidenceDigest: digest(reviewedCore),
  }));
});

test("partial-local mode rejects any reconstructed source change beyond claim identity", () => {
  const partial = partialFixture();
  partial.evidence.partialLocal.bindingSourceLease.scope = "changed-scope";
  delete partial.evidence.evidenceDigest;
  partial.evidence.evidenceDigest = D(partial.evidence);
  assert.throws(() => buildReviewedSuccessorProjectionResponseLossPlan(partial.evidence), /binding source reconstruction|binding/);
});

test("typed repaired lease supports terminal adoption without replaying the atomic CAS", () => {
  const partial = partialFixture({ repaired: true });
  const runtime = adapter(partial);
  const controller = createReviewedSuccessorProjectionResponseLossController(runtime);
  const plan = controller.plan();
  runtime.verify = () => { runtime.effects.verifies += 1; return { projection: partial.projected, terminal: partial.terminal }; };
  const receipt = controller.run({ plan, authorization: `${AUTHORIZATION_PREFIX} ${plan.planDigest}`, taskAuthorityFile: "/capability.json" });
  assert.equal(runtime.effects.projection, 0);
  assert.equal(runtime.effects.verifies, 1);
  assert.equal(receipt.predecessorClaimId, partial.evidence.predecessor.claimId);
  assert.equal(receipt.successorClaimId, partial.evidence.successor.claimId);
  assert.equal(receipt.partialLocalRepairReceiptDigest, partial.repair.receiptDigest);
  assert.equal(receipt.mutationPolicy.pullRequestMutation, false);
});
