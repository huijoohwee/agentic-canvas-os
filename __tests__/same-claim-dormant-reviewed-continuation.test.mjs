import test from "node:test";
import assert from "node:assert/strict";
import { digestValue as D } from "../scripts/cloud-collaboration-primitives.mjs";
import { AUTHORIZATION_PREFIX, LOCAL_REPAIR_SCHEMA, POLICY, buildSameClaimDormantReviewedPlan, buildSameClaimDormantReviewedReceipt, normalizeSameClaimDormantReviewedEvidence } from "../scripts/same-claim-dormant-reviewed-continuation-contract.mjs";
import { createSameClaimDormantReviewedContinuationController } from "../scripts/same-claim-dormant-reviewed-continuation-controller.mjs";
import { adoptReviewedResponseLossCloudRecovery, projectRenewedReviewedLeaseSubject, projectReviewedAuthorityForSameClaimRecovery } from "../scripts/same-claim-dormant-reviewed-continuation-repository-adapter.mjs";

const SHA = value => value.repeat(40);
function fixture({ complete = false } = {}) {
  const claimId = D("claim"); const headSha = SHA("a"); const baseSha = SHA("b"); const bodyDigest = D("body"); const prCore = { id: "PR519", url: "https://github.com/o/r/pull/519", state: "OPEN", isDraft: false, autoMergeRequest: null, headRefName: "agent/device/repository-teardown", headRefOid: headSha, baseRefName: "main" }; const stateDigest = D(prCore);
  const cloudAuthority = { schema: "agentic-lane-cloud-authority/v1", claimId, canonicalBaseSha: baseSha, laneRevision: headSha, leaseEpoch: 2, operationReceiptDigest: D("renewed-operation"), expiresAt: "2026-08-16T12:30:00.000Z" };
  const cloudCore = { claimId, authority: cloudAuthority, verificationReceiptDigest: D("verification"), cloudOperationReceiptDigest: cloudAuthority.operationReceiptDigest, recoveredAt: "2026-08-16T12:00:10.000Z" }; const cloudRecovery = { ...cloudCore, recoveryDigest: D(cloudCore) };
  const repairCore = { schema: LOCAL_REPAIR_SCHEMA, status: "recovered", planDigest: D("original-plan"), claimId, sourceLeaseDigest: D("source-lease"), targetLeaseSubjectDigest: D("target-subject"), taskAuthorityReceiptDigest: D("task-receipt"), cloudRecoveryDigest: cloudRecovery.recoveryDigest, cloudRecovery, recoveredAt: "2026-08-16T12:00:20.000Z", cloudEffect: false, pullRequestEffect: false, sourceEffect: false, gitEffect: false, mergeEffect: false, integrationEffect: false, deploymentEffect: false }; const localRepair = { ...repairCore, receiptDigest: D(repairCore) };
  const evidenceCore = { observedAt: "2026-08-16T12:00:00.000Z", repository: "o/r", branch: prCore.headRefName, targetSessionId: "target-session", operatorAuthority: { repository: "o/r", branch: "agent/device/controller", sessionId: "operator-session", leaseDigest: D("operator-lease"), claimId: D("operator-claim"), bindingDigest: D("operator-binding") }, local: { leaseDigest: complete ? D("target-lease") : D("source-lease"), status: "review_ready", admissionStatus: "admitted", clean: true, claimId, leaseEpoch: 2, baseSha, headSha, writeSetDigest: D("write-set"), reviewRequestId: "github-pull-request:PR519", taskBindingDigest: D("current-binding"), priorTaskBindingDigest: D("prior-binding"), repairReceiptDigest: D("partial-repair") }, pullRequest: { number: 519, ...prCore, bodyDigest, stateDigest }, marker: { status: "review_ready", claimId, leaseEpoch: 2, reviewHeadSha: headSha, taskBindingDigest: D("prior-binding"), markerDigest: D("marker") }, cloud: { claimId, matches: 1, state: complete ? "current" : "dormant-preserved", writeAuthority: complete, scopeReserved: true, leaseEpoch: 2, canonicalBaseSha: baseSha, laneRevision: headSha, writeSetDigest: D("write-set"), reviewRequestId: "github-pull-request:PR519", integrationState: "not-integrated", claimDigest: D(complete ? "current-fence" : "dormant-fence"), transitionCounter: complete ? 4 : 3, operationReceiptDigest: D(complete ? "current-operation" : "dormant-operation") }, projectionState: complete ? "complete" : "pending", localRepair: complete ? localRepair : null };
  const evidence = { ...evidenceCore, evidenceDigest: D(evidenceCore) };
  const taskAuthorityReceipt = { receiptDigest: D("task-receipt") };
  const projection = { taskAuthorityReceiptDigest: taskAuthorityReceipt.receiptDigest, cloudRecoveryDigest: cloudRecovery.recoveryDigest, localRepair, targetLeaseDigest: D("target-lease"), registryRevision: 12 };
  const terminal = { claimId, headSha, pullRequestBodyDigest: bodyDigest, pullRequestStateDigest: stateDigest, localRepairReceiptDigest: localRepair.receiptDigest, targetLeaseDigest: projection.targetLeaseDigest, registryRevision: 12, verifiedAt: "2026-08-16T12:00:30.000Z" };
  return { evidence, taskAuthorityReceipt, cloudRecovery, projection, terminal };
}

function bindRepairToPlan(subject, planDigest) {
  const { receiptDigest: _oldReceipt, ...oldCore } = subject.projection.localRepair;
  const repairCore = { ...oldCore, planDigest };
  const localRepair = { ...repairCore, receiptDigest: D(repairCore) };
  const projection = { ...subject.projection, localRepair };
  const terminal = { ...subject.terminal, localRepairReceiptDigest: localRepair.receiptDigest };
  let evidence = subject.evidence;
  if (evidence.projectionState === "complete") { const core = { ...evidence, localRepair }; delete core.evidenceDigest; evidence = { ...core, evidenceDigest: D(core) }; }
  return { ...subject, evidence, projection, terminal };
}

function completedEvidence(subject) {
  const core = { ...subject.evidence, observedAt: "2026-08-16T12:00:25.000Z", local: { ...subject.evidence.local, leaseDigest: subject.projection.targetLeaseDigest }, cloud: { ...subject.evidence.cloud, state: "current", writeAuthority: true, claimDigest: D("current-fence"), transitionCounter: subject.evidence.cloud.transitionCounter + 1, operationReceiptDigest: subject.cloudRecovery.cloudOperationReceiptDigest }, projectionState: "complete", localRepair: subject.projection.localRepair };
  delete core.evidenceDigest; return { ...core, evidenceDigest: D(core) };
}

function fakeAdapter(subject = fixture()) {
  let journal = null; let failLocal = false; let landThenFail = false; let liveEvidence = subject.evidence; const calls = [];
  return { inspect: () => structuredClone(liveEvidence), authorizeTask: () => { calls.push("authorize"); return subject.taskAuthorityReceipt; }, recoverCloud: () => { calls.push("cloud"); return subject.cloudRecovery; }, projectLocal: () => { calls.push("local"); if (landThenFail) { landThenFail = false; liveEvidence = completedEvidence(subject); throw new Error("simulated post-CAS response loss"); } if (failLocal) { failLocal = false; throw new Error("simulated local response loss"); } return subject.projection; }, verify: () => { calls.push("verify"); return subject.terminal; }, readJournal: () => structuredClone(journal), writeJournal: value => { journal = structuredClone(value); }, withLock: action => action(), setFailLocal: () => { failLocal = true; }, setLandThenFail: () => { landThenFail = true; }, clearJournal: () => { journal = null; }, calls, journal: () => structuredClone(journal) };
}

test("plan seals clean reviewed non-draft same-claim evidence and zero-PR policy", () => {
  const subject = fixture(); const plan = buildSameClaimDormantReviewedPlan(subject.evidence);
  assert.deepEqual(normalizeSameClaimDormantReviewedEvidence(subject.evidence), plan.evidence);
  assert.equal(plan.evidence.pullRequest.isDraft, false); assert.equal(plan.evidence.pullRequest.autoMergeRequest, null); assert.equal(plan.evidence.marker.taskBindingDigest, plan.evidence.local.priorTaskBindingDigest); assert.equal(plan.evidence.cloud.state, "dormant-preserved"); assert.equal(plan.policy.pullRequestMutation, false); assert.equal(plan.policy.sourceMutation, false);
});

test("subject rejects draft, auto-merge, body/head/claim drift, or current marker binding", () => {
  const mutations = [e => { e.pullRequest.isDraft = true; }, e => { e.pullRequest.autoMergeRequest = {}; }, e => { e.pullRequest.headRefOid = SHA("c"); }, e => { e.marker.claimId = D("other"); }, e => { e.marker.taskBindingDigest = e.local.taskBindingDigest; }];
  for (const mutate of mutations) { const evidence = structuredClone(fixture().evidence); mutate(evidence); delete evidence.evidenceDigest; evidence.evidenceDigest = D(evidence); assert.throws(() => buildSameClaimDormantReviewedPlan(evidence), /invalid/); }
});

test("exact authorization orders capability, cloud, local CAS, then terminal verification", () => {
  const initial = fixture(); const plan = buildSameClaimDormantReviewedPlan(initial.evidence); const runtime = fakeAdapter(bindRepairToPlan(initial, plan.planDigest)); const controller = createSameClaimDormantReviewedContinuationController(runtime);
  assert.throws(() => controller.run({ plan, authorization: "yes", taskAuthorityFile: "/cap" }), /Exact authorization/); assert.deepEqual(runtime.calls, []);
  const receipt = controller.run({ plan, authorization: `${AUTHORIZATION_PREFIX} ${plan.planDigest}`, taskAuthorityFile: "/cap" });
  assert.deepEqual(runtime.calls, ["authorize", "cloud", "local", "verify", "verify"]); assert.equal(receipt.claimId, plan.evidence.cloud.claimId); assert.deepEqual(receipt.policy, POLICY); assert.equal(runtime.journal().phase, "complete");
  assert.equal(controller.run({ plan, authorization: `${AUTHORIZATION_PREFIX} ${plan.planDigest}`, taskAuthorityFile: "/cap" }).receiptDigest, receipt.receiptDigest); assert.equal(runtime.calls.at(-1), "verify");
});

test("durable local response loss resumes without repeating task proof or cloud recovery", () => {
  const initial = fixture(); const plan = buildSameClaimDormantReviewedPlan(initial.evidence); const runtime = fakeAdapter(bindRepairToPlan(initial, plan.planDigest)); runtime.setFailLocal(); const controller = createSameClaimDormantReviewedContinuationController(runtime); const run = () => controller.run({ plan, authorization: `${AUTHORIZATION_PREFIX} ${plan.planDigest}`, taskAuthorityFile: "/cap" });
  assert.throws(run, /simulated local response loss/); assert.deepEqual(runtime.calls, ["authorize", "cloud", "local"]); assert.equal(runtime.journal().phase, "local-attempted");
  run(); assert.deepEqual(runtime.calls, ["authorize", "cloud", "local", "local", "verify", "verify"]);
});

test("identical terminal lease adopts embedded cloud and task receipts without effects", () => {
  const original = fixture(); const plan = buildSameClaimDormantReviewedPlan(original.evidence); const subject = bindRepairToPlan(fixture({ complete: true }), plan.planDigest); const runtime = fakeAdapter(subject); runtime.verify = () => ({ taskAuthorityReceipt: subject.taskAuthorityReceipt, cloudRecovery: subject.cloudRecovery, projection: subject.projection, terminal: subject.terminal }); const controller = createSameClaimDormantReviewedContinuationController(runtime); const receipt = controller.run({ plan, authorization: `${AUTHORIZATION_PREFIX} ${plan.planDigest}`, taskAuthorityFile: "/cap" });
  assert.equal(receipt.localRepairReceiptDigest, subject.projection.localRepair.receiptDigest); assert.deepEqual(runtime.calls, []);
});

test("post-CAS response loss adopts through the durable local-attempted phase", () => {
  const initial = fixture(); const plan = buildSameClaimDormantReviewedPlan(initial.evidence); const runtime = fakeAdapter(bindRepairToPlan(initial, plan.planDigest)); runtime.setLandThenFail(); const controller = createSameClaimDormantReviewedContinuationController(runtime); const run = () => controller.run({ plan, authorization: `${AUTHORIZATION_PREFIX} ${plan.planDigest}`, taskAuthorityFile: "/cap" });
  assert.throws(run, /post-CAS response loss/); assert.equal(runtime.journal().phase, "local-attempted");
  run(); assert.deepEqual(runtime.calls, ["authorize", "cloud", "local", "local", "verify", "verify"]);
});

test("terminal adoption rejects a typed repair owned by another plan", () => {
  const original = fixture(); const plan = buildSameClaimDormantReviewedPlan(original.evidence); const subject = bindRepairToPlan(fixture({ complete: true }), D("different-plan"));
  assert.throws(() => buildSameClaimDormantReviewedReceipt({ plan, taskAuthorityReceipt: subject.taskAuthorityReceipt, cloudRecovery: subject.cloudRecovery, projection: subject.projection, terminal: subject.terminal }), /terminal subject/);
});

test("reviewed authority adapter restores cloud current while local reviewed semantics remain immutable", () => {
  const authority = { state: "review_ready", claimId: D("claim"), reviewRequestId: "github-pull-request:PR519", expiresAt: "2026-08-16T12:30:00.000Z" };
  const sourceLease = { status: "review_ready", reviewHeadSha: SHA("a"), taskAuthority: { bindingDigest: D("binding") }, cloudAuthority: authority, heartbeatAt: "2026-08-16T11:00:00.000Z", expiresAt: "2026-08-16T11:00:00.000Z" };
  const activeAuthority = projectReviewedAuthorityForSameClaimRecovery(authority); const projected = projectRenewedReviewedLeaseSubject(sourceLease, activeAuthority);
  assert.equal(activeAuthority.state, "active"); assert.equal(projected.status, "review_ready"); assert.equal(projected.reviewHeadSha, sourceLease.reviewHeadSha); assert.equal(projected.taskAuthority, sourceLease.taskAuthority); assert.equal(projected.cloudAuthority, activeAuthority); assert.equal(POLICY.authoringAuthorityGranted, false); assert.equal(POLICY.pullRequestMutation, false);
});

test("reviewed response-loss adoption reconstructs the exact landed transition without authoring authority", () => {
  const sourceAuthority = { schema: "agentic-lane-cloud-authority/v1", provider: "github", ledgerRepository: "o/ledger", targetRepository: "o/r", claimId: D("claim"), claimDigest: D("old-fence"), ledgerRevision: SHA("1"), ledgerDigest: D("old-ledger"), claimLedgerRevision: D("old-transition"), entrySchema: "agentic-cloud-collaboration-entry/v2", claimIdentitySchema: "agentic-cloud-collaboration-entry/v2", operationReceiptDigest: D("old-operation"), mutationAuthorityEligible: true, canonicalBaseSha: SHA("b"), laneRevision: SHA("a"), cloudDeclaredWriteScope: ["path:docs/a.md", "semantic:test"], writeSetDigest: D("write-set"), deviceId: "device", sessionId: "target-session", reviewRequestId: "github-pull-request:PR519", leaseEpoch: 2, transitionCounter: 3, state: "review_ready", expiresAt: "2026-08-16T11:00:00.000Z", integrationReceiptDigest: null, integration: null, manifestDigest: D("manifest") };
  const claim = { claimId: sourceAuthority.claimId, entrySchema: sourceAuthority.entrySchema, claimIdentitySchema: sourceAuthority.claimIdentitySchema, state: "reviewed", writeAuthority: false, scopeReserved: true, actorId: "actor", repositoryId: "repository", workItemId: "work-item", canonicalBaseRevision: sourceAuthority.canonicalBaseSha, laneRevision: sourceAuthority.laneRevision, declaredWriteScope: sourceAuthority.cloudDeclaredWriteScope, writeSetDigest: sourceAuthority.writeSetDigest, leaseEpoch: 2, transitionCounter: 4, heartbeatCounter: 0, reviewRequestId: sourceAuthority.reviewRequestId, predecessorClaimId: D("predecessor"), expiresAt: "2026-08-16T12:32:53.000Z", fenceRevision: D("new-fence"), transitionDigest: D("new-transition"), operationReceiptDigest: D("new-operation"), integrationReceiptDigest: null, integration: null };
  const recovery = adoptReviewedResponseLossCloudRecovery({ sourceAuthority, claim, status: { ledgerRevision: SHA("2"), ledgerDigest: D("ledger") }, manifest: { manifestDigest: D("manifest"), declaredWriteSet: sourceAuthority.cloudDeclaredWriteScope, writeSetDigest: sourceAuthority.writeSetDigest }, recoveredAt: "2026-08-16T12:33:00.000Z" });
  assert.equal(recovery.authority.state, "review_ready"); assert.equal(recovery.authority.claimDigest, claim.fenceRevision); assert.equal(recovery.authority.transitionCounter, 4); assert.equal(recovery.authority.expiresAt, claim.expiresAt); assert.equal(recovery.cloudOperationReceiptDigest, claim.operationReceiptDigest);
  const projected = projectRenewedReviewedLeaseSubject({ status: "review_ready", cloudAuthority: sourceAuthority }, recovery.authority); assert.equal(projected.status, "review_ready"); assert.equal(POLICY.authoringAuthorityGranted, false);
});

test("time-derived dormant view adopts the exact landed reviewed transition", () => {
  const sourceAuthority = { schema: "agentic-lane-cloud-authority/v1", provider: "github", ledgerRepository: "o/ledger", targetRepository: "o/r", claimId: D("claim"), claimDigest: D("old-fence"), ledgerRevision: SHA("1"), ledgerDigest: D("old-ledger"), claimLedgerRevision: D("old-transition"), entrySchema: "agentic-cloud-collaboration-entry/v2", claimIdentitySchema: "agentic-cloud-collaboration-entry/v2", operationReceiptDigest: D("old-operation"), mutationAuthorityEligible: true, canonicalBaseSha: SHA("b"), laneRevision: SHA("a"), cloudDeclaredWriteScope: ["path:docs/a.md", "semantic:test"], writeSetDigest: D("write-set"), deviceId: "device", sessionId: "target-session", reviewRequestId: "github-pull-request:PR519", leaseEpoch: 2, transitionCounter: 3, state: "review_ready", expiresAt: "2026-08-16T11:00:00.000Z", integrationReceiptDigest: null, integration: null, manifestDigest: D("manifest") };
  const claim = { claimId: sourceAuthority.claimId, entrySchema: sourceAuthority.entrySchema, claimIdentitySchema: sourceAuthority.claimIdentitySchema, state: "dormant-preserved", writeAuthority: false, scopeReserved: true, actorId: "actor", repositoryId: "repository", workItemId: "work-item", canonicalBaseRevision: sourceAuthority.canonicalBaseSha, laneRevision: sourceAuthority.laneRevision, declaredWriteScope: sourceAuthority.cloudDeclaredWriteScope, writeSetDigest: sourceAuthority.writeSetDigest, leaseEpoch: 2, transitionCounter: 4, heartbeatCounter: 0, reviewRequestId: sourceAuthority.reviewRequestId, predecessorClaimId: D("predecessor"), expiresAt: "2026-08-16T12:32:53.000Z", fenceRevision: D("new-fence"), transitionDigest: D("new-transition"), operationReceiptDigest: D("new-operation"), integrationReceiptDigest: null, integration: null };
  const recovery = adoptReviewedResponseLossCloudRecovery({ sourceAuthority, claim, status: { ledgerRevision: SHA("2"), ledgerDigest: D("ledger") }, manifest: { manifestDigest: D("manifest"), declaredWriteSet: sourceAuthority.cloudDeclaredWriteScope, writeSetDigest: sourceAuthority.writeSetDigest }, recoveredAt: "2026-08-16T12:40:00.000Z" });
  assert.equal(recovery.authority.state, "review_ready"); assert.equal(recovery.authority.claimDigest, claim.fenceRevision); assert.equal(recovery.authority.transitionCounter, 4); assert.equal(recovery.cloudOperationReceiptDigest, claim.operationReceiptDigest);
});

test("cloud contract accepts provider reviewed as non-authoring terminal evidence", () => {
  const subject = fixture(); const { evidenceDigest: _evidenceDigest, ...evidence } = subject.evidence; const core = { ...evidence, cloud: { ...subject.evidence.cloud, state: "reviewed", writeAuthority: false, claimDigest: D("reviewed-fence"), transitionCounter: 4, operationReceiptDigest: D("reviewed-operation") } };
  assert.equal(normalizeSameClaimDormantReviewedEvidence({ ...core, evidenceDigest: D(core) }).cloud.state, "reviewed");
});
