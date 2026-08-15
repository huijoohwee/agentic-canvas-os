import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "../scripts/github-cloud-collaboration-mapping.mjs";
import {
  advanceScopeExpansionSuccessorProjectionRecoveryIntent,
  buildScopeExpansionSuccessorProjectionRecoveryPlan,
  createScopeExpansionSuccessorProjectionRecoveryIntent,
  scopeExpansionSuccessorProjectionRecoveryTaskOperation,
  scopeExpansionSuccessorProjectionTerminalStableDigest,
} from "../scripts/scope-expansion-successor-projection-recovery-contract.mjs";
import {
  createScopeExpansionSuccessorProjectionRecoveryController,
  ensureSecureRecoveryDirectory,
  readScopeExpansionSuccessorProjectionRecoveryJournal,
  withScopeExpansionSuccessorProjectionRecoveryFence,
  writeScopeExpansionSuccessorProjectionRecoveryJournal,
}
  from "../scripts/scope-expansion-successor-projection-recovery-controller.mjs";
import {
  assertScopeExpansionRecoverySuccessorUnexpired,
  assertScopeExpansionSuccessorRecoveryProtectedFrame,
  assertScopeExpansionSuccessorRecoveryPullRequest,
  buildScopeExpansionSuccessorProjectionRecoveryEvidence,
  normalizeScopeExpansionSuccessorProjectionRecoveryEvidence,
} from "../scripts/scope-expansion-successor-projection-recovery-evidence.mjs";
import { createRepositoryAdapter, scopeExpansionSuccessorProjectionRecoveryJournalKey } from "../scripts/scope-expansion-successor-projection-recovery-repository-adapter.mjs";
import { runScopeExpansionSuccessorProjectionRecoveryCli } from "../scripts/scope-expansion-successor-projection-recovery.mjs";
import { createTaskAuthorityBinding, createTaskAuthorityCapability } from "../scripts/task-bound-lane-authority-contract.mjs";
import { authorizeTaskBoundLeaseMutation } from "../scripts/task-bound-lane-authority-store.mjs";
import { projectWriterLeasePullRequestMarker, updateWriterLeasePullRequestBody } from "../scripts/writer-lease-lib.mjs";
import { writerLeaseDigest } from "../scripts/writer-lease-registry-cas.mjs";
const sha = value => value.repeat(40);
const digest = value => value.repeat(64);
const BRANCH = "agent/recovery-device/successor-projection";
const SOURCE_SESSION = "source-session", OPERATOR_SESSION = "operator-session", REVIEW = "github-pull-request:PR_node";
const CONTROLLER_ROOT = path.resolve(import.meta.dirname, "..");
const CONTROLLER_IMPLEMENTATION = ["active-dirty-scope-expansion-controller.mjs",
  "active-dirty-scope-expansion-successor-projection.mjs", "scope-expansion-successor-projection-recovery-evidence.mjs", "scope-expansion-successor-projection-recovery-contract.mjs",
  "scope-expansion-successor-projection-recovery-controller.mjs",
  "scope-expansion-successor-projection-recovery-repository-adapter.mjs", "scope-expansion-successor-projection-recovery.mjs"];
function fixture({ worktreePath = "/workspace/source", implementationDigest = digest("b") } = {}) {
  const sourceWriteSet = ["path:one.txt", "semantic:successor-projection"];
  const targetWriteSet = ["path:one.txt", "path:two.txt", "semantic:successor-projection"];
  const sourceAdmission = {
    schema: "agentic-lane-admission-lease/v1", status: "admitted",
    semanticScope: "successor-projection", declaredWriteSet: sourceWriteSet,
    writeSetDigest: digestValue(sourceWriteSet), manifestDigest: digest("1"),
    planReceiptDigest: digest("2"), admissionReceiptDigest: digest("3"),
    existingLaneStateDigest: digest("4"), admittedReportDigest: digest("5"),
    preservationReceiptDigest: digest("6"),
  };
  const sourceAuthority = {
    schema: "agentic-lane-cloud-authority/v1", provider: "github",
    ledgerRepository: "example/project", targetRepository: "example/project",
    claimId: digest("a"), claimDigest: digest("b"), ledgerRevision: sha("1"),
    ledgerDigest: digest("c"), claimLedgerRevision: digest("d"),
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    operationReceiptDigest: digest("e"), mutationAuthorityEligible: true,
    canonicalBaseSha: sha("2"), laneRevision: sha("3"),
    cloudDeclaredWriteScope: sourceWriteSet, writeSetDigest: digestValue(sourceWriteSet),
    deviceId: "recovery-device", sessionId: SOURCE_SESSION, reviewRequestId: REVIEW,
    leaseEpoch: 1, transitionCounter: 2, state: "active",
    expiresAt: "2026-08-15T01:00:00.000Z", integrationReceiptDigest: null,
    integration: null, manifestDigest: sourceAdmission.manifestDigest,
  };
  const leaseCore = {
    schema: "agentic-writer-lease/v2", status: "active", epoch: 7,
    sessionId: SOURCE_SESSION, device: "recovery-device", scope: "successor-projection",
    branch: BRANCH, worktreePath, baseSha: sha("2"), fenceSha: sha("3"),
    pullRequestUrl: "https://github.com/example/project/pull/7", autoDelivery: false,
    runtimeRequired: false, admission: sourceAdmission, cloudAuthority: sourceAuthority,
    acquiredAt: "2026-08-14T00:00:00.000Z", heartbeatAt: "2026-08-14T00:00:00.000Z",
    expiresAt: "2026-08-15T01:00:00.000Z",
  };
  const capability = createTaskAuthorityCapability({
    authoritySubjectId: `urn:agentic-task:${digest("f")}`,
    issuedAt: "2026-08-14T00:00:00.000Z",
  });
  const lease = { ...leaseCore, taskAuthority: createTaskAuthorityBinding({
    capability, lease: leaseCore, boundAt: "2026-08-14T00:00:00.000Z",
  }) };
  const stagedPatch = "";
  const unstagedPatch = "diff --git a/one.txt b/one.txt";
  const status = " M one.txt\0";
  const changedPaths = ["one.txt"];
  const sourceDirtyDigest = digestValue({ stagedPatch, unstagedPatch, changedPaths, untracked: [] });
  const planCore = {
    schema: "agentic-active-dirty-scope-expansion-plan/v1", sourceBranch: BRANCH,
    sourceFenceSha: lease.fenceSha, sourceLeaseDigest: writerLeaseDigest(lease),
    sourceClaimId: sourceAuthority.claimId, sourceClaimDigest: sourceAuthority.claimDigest,
    sourceClaimTransitionCounter: 2, sourceReviewRequestId: REVIEW,
    sourceWriteSetDigest: sourceAdmission.writeSetDigest,
    sourceManifestDigest: sourceAdmission.manifestDigest,
    sourceDirtyDigest, sourceChangedPaths: changedPaths,
    targetCanonicalBaseSha: sha("2"), targetManifestDigest: digest("8"),
    targetWriteSetDigest: digestValue(targetWriteSet), targetDeclaredWriteSet: targetWriteSet,
    targetCloudLeaseEpoch: 1,
  };
  const originalPlan = { ...planCore, planDigest: digestValue(planCore) };
  const successorClaimId = digest("9");
  const waitingClaimDigest = digest("0");
  const waitingTransition = digest("1");
  const scopeExpansionIntent = {
    schema: "agentic-active-dirty-scope-expansion-intent/v1", status: "source-retired",
    branch: BRANCH, sourceLeaseDigest: originalPlan.sourceLeaseDigest,
    sourceClaimId: originalPlan.sourceClaimId, sourceFenceSha: originalPlan.sourceFenceSha,
    targetWriteSetDigest: originalPlan.targetWriteSetDigest,
    targetManifestDigest: originalPlan.targetManifestDigest, planDigest: originalPlan.planDigest,
    targetClaimId: successorClaimId, targetClaimDigest: waitingClaimDigest,
    targetLeaseEpoch: 1, targetCanonicalBaseSha: originalPlan.targetCanonicalBaseSha,
    targetReviewRequestId: null, completedReceiptDigest: null,
    waiting: { claimId: successorClaimId, claimDigest: waitingClaimDigest,
      ledgerRevision: sha("4"), claimLedgerRevision: waitingTransition,
      transitionCounter: 1, expiresAt: "2026-08-16T00:00:00.000Z" },
    waitingReceiptDigest: digest("2"), sourceRetirementReceiptDigest: digest("3"),
    promoted: null, promotedReceiptDigest: null, boundAuthority: null, boundReceiptDigest: null,
    localProjection: null, localProjectionReceiptDigest: null,
    pullRequestProjection: null, pullRequestProjectionReceiptDigest: null,
    finalReceiptDigest: null, planSnapshot: originalPlan,
  };
  const entries = [{ path: "one.txt", headMode: "100644", headObject: sha("5"),
    indexMode: "100644", indexObject: sha("5"), worktreeMode: "644", size: 9,
    contentDigest: createHash("sha256").update("recovery\n").digest("hex") }];
  const laneSubject = { statusDigest: digestValue(status), stagedPatchDigest: digestValue(stagedPatch),
    unstagedPatchDigest: digestValue(unstagedPatch), changedPaths, untrackedPaths: [], entries };
  const lane = { branch: BRANCH, headSha: lease.fenceSha, remoteHeadSha: lease.fenceSha,
    dirty: true, legacyDirtyDigest: originalPlan.sourceDirtyDigest, ...laneSubject,
    dirtDigest: digestValue(laneSubject) };
  const retiredClaimDigest = digest("8");
  const retiredTransition = digest("a");
  const sourceRetirement = {
    claimId: sourceAuthority.claimId, actorId: "github-user:1",
    deviceId: pseudonymousIdentifier("device", lease.device),
    sessionId: pseudonymousIdentifier("session", lease.sessionId),
    repositoryId: "github-repository:1",
    workItemId: pseudonymousIdentifier("work-item", "historical-source-scope"),
    canonicalBaseRevision: lease.baseSha,
    declaredWriteScope: sourceWriteSet, writeSetDigest: sourceAdmission.writeSetDigest,
    laneRevision: lease.fenceSha, leaseEpoch: 1, transitionCounter: 3,
    heartbeatCounter: 0, state: "retired", expiresAt: lease.expiresAt,
    reviewRequestId: REVIEW, predecessorClaimId: null,
    retirement: { reason: "superseded", finalRevision: lease.fenceSha,
      reviewRequestId: REVIEW, bytesDigest: digest("b"), namedChecksDigest: digest("c"),
      handoffEvidenceDigest: digest("d"), integrationReceiptDigest: null,
      retiredAt: "2026-08-15T02:00:00.000Z" },
    claimDigest: retiredClaimDigest, transitionDigest: retiredTransition,
    priorClaimDigest: sourceAuthority.claimDigest, action: "retire",
  };
  const successorCore = {
    claimId: successorClaimId, actorId: sourceRetirement.actorId,
    deviceId: pseudonymousIdentifier("device", lease.device),
    sessionId: pseudonymousIdentifier("session", lease.sessionId),
    repositoryId: sourceRetirement.repositoryId,
    workItemId: pseudonymousIdentifier("work-item", lease.scope),
    canonicalBaseRevision: originalPlan.targetCanonicalBaseSha,
    declaredWriteScope: targetWriteSet, writeSetDigest: originalPlan.targetWriteSetDigest,
    laneRevision: originalPlan.sourceFenceSha, leaseEpoch: 1, transitionCounter: 2,
    heartbeatCounter: 0, state: "current", expiresAt: "2099-08-16T00:00:00.000Z",
    reviewRequestId: null, predecessorClaimId: sourceAuthority.claimId,
    promotedAt: "2026-08-15T02:00:01.000Z",
  };
  const successor = { claimId: successorClaimId,
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2", state: "current",
    writeAuthority: true, scopeReserved: true, actorId: successorCore.actorId,
    repositoryId: successorCore.repositoryId, workItemId: successorCore.workItemId,
    canonicalBaseRevision: successorCore.canonicalBaseRevision,
    laneRevision: successorCore.laneRevision, declaredWriteScope: targetWriteSet,
    writeSetDigest: originalPlan.targetWriteSetDigest, leaseEpoch: 1,
    transitionCounter: 2, heartbeatCounter: 0, reviewRequestId: null,
    predecessorClaimId: sourceAuthority.claimId, expiresAt: successorCore.expiresAt,
    fenceRevision: digest("e"), transitionDigest: digest("f"),
    operationReceiptDigest: digest("a"), integrationReceiptDigest: null, integration: null,
    waitingClaimDigest, waitingTransitionDigest: waitingTransition, claimCore: successorCore };
  const recoveryLineage = [
    { sequence: 10, action: "continue", claimId: sourceAuthority.claimId,
      claimDigest: sourceAuthority.claimDigest, transitionDigest: sourceAuthority.claimLedgerRevision,
      transitionCounter: 2 },
    { sequence: 11, action: "claim", claimId: successorClaimId,
      claimDigest: waitingClaimDigest, transitionDigest: waitingTransition, transitionCounter: 1 },
    { sequence: 12, action: "retire", claimId: sourceAuthority.claimId,
      claimDigest: retiredClaimDigest, transitionDigest: retiredTransition, transitionCounter: 3 },
    { sequence: 13, action: "continue", claimId: successorClaimId,
      claimDigest: successor.fenceRevision, transitionDigest: successor.transitionDigest,
      transitionCounter: 2 },
  ];
  const controller = { repository: "example/project", origin: "https://github.com/example/project.git",
    headSha: sha("6"), originMainSha: sha("6"), remoteMainSha: sha("6"), treeSha: sha("7"),
    clean: true, implementationDigest };
  const marker = projectWriterLeasePullRequestMarker(lease);
  const pullRequestBody = updateWriterLeasePullRequestBody("", lease);
  const pullRequest = { url: lease.pullRequestUrl, number: 7, nodeId: "PR_node", state: "OPEN",
    isDraft: true, autoMergeAbsent: true, headRepository: controller.repository,
    headRefName: BRANCH, headRefOid: lease.fenceSha, baseRefName: "main",
    baseRefOid: controller.headSha, marker, markerDigest: digestValue(marker),
    bodyDigest: digestValue(pullRequestBody),
    bodyWithoutMarkerDigest: digestValue(pullRequestBody.replace(/<!--\s*agentic-writer-lease\/v2\s+\{.*?\}\s*-->/gsu, "")) };
  const evidence = buildScopeExpansionSuccessorProjectionRecoveryEvidence({
    controller, lane, lease, scopeExpansionIntent, pullRequest, sourceRetirement, successor,
    cloud: { observedLedgerRevision: sha("8"), observedLedgerDigest: digest("d"),
      observedLedgerSequence: 13,
      observedInventoryDigest: digest("e"), sourceRetirementDigest: digestValue(sourceRetirement),
      successorDigest: digestValue(successor), successorCandidateCount: 1,
      sourceLineageCount: 3, successorLineageCount: 2, sourceLineageDigest: digest("1"),
      successorLineageDigest: digest("2"), recoveryLineage,
      validatedLedgerDigest: digestValue({ schema: "ledger", ledgerRepositoryId: "repo",
        headDigest: digest("d"), sequence: 13, recoveryLineage }) },
  });
  return { evidence, successorClaimId, lease, capability, scopeExpansionIntent, pullRequestBody,
    laneSources: { stagedPatch, unstagedPatch, status } };
}
test("evidence seals expired C1, exact four-transition lineage, file modes, and current C2", () => {
  const { evidence } = fixture();
  assert.deepEqual(normalizeScopeExpansionSuccessorProjectionRecoveryEvidence(evidence), evidence);
  assert.equal(evidence.scopeExpansionIntent.status, "source-retired");
  assert.equal(evidence.sourceRetirement.transitionCounter, 3);
  assert.equal(evidence.successor.transitionCounter, 2);
  assert.equal(evidence.lane.entries[0].worktreeMode, "644");
  assert.throws(() => normalizeScopeExpansionSuccessorProjectionRecoveryEvidence({
    ...evidence, successor: { ...evidence.successor, scopeReserved: false },
  }), /evidence drifted|successor/u);
  assert.throws(() => buildScopeExpansionSuccessorProjectionRecoveryEvidence({
    ...evidence, successor: { ...evidence.successor,
      claimCore: { ...evidence.successor.claimCore, deviceId: evidence.lease.device } },
  }), /identity/u);
  assert.throws(() => buildScopeExpansionSuccessorProjectionRecoveryEvidence({
    ...evidence, successor: { ...evidence.successor, workItemId: pseudonymousIdentifier("work-item", "drift"),
      claimCore: { ...evidence.successor.claimCore, workItemId: pseudonymousIdentifier("work-item", "drift") } },
  }), /identity/u);
});
test("contract requires a fresh recovery token and rejects untyped phase values", () => {
  const plan = buildScopeExpansionSuccessorProjectionRecoveryPlan({
    evidence: fixture().evidence, operatorSessionId: OPERATOR_SESSION,
  });
  assert.match(plan.exactAuthorization,
    /^authorize scope-expansion-successor-projection-recovery [0-9a-f]{64}$/u);
  assert.doesNotMatch(plan.exactAuthorization, /authorize scope-expansion [0-9a-f]/u);
  const intent = createScopeExpansionSuccessorProjectionRecoveryIntent(plan, plan.exactAuthorization);
  assert.throws(() => advanceScopeExpansionSuccessorProjectionRecoveryIntent(intent, {
    status: "task-authority-verified", values: { unexpected: true },
  }), /invalid task-authority-verified phase values/u);
});
test("controller consumes the caller plan, advances once, and live-verifies replay", async () => {
  const { evidence, successorClaimId } = fixture();
  let stored = null;
  let completedChecks = 0;
  const calls = [];
  const terminalCore = plan => ({ schema: "agentic-scope-expansion-successor-projection-terminal/v1",
    recoveryPlanDigest: plan.planDigest, leaseDigest: digest("1"), originalIntentDigest: digest("2"),
    pullRequestMarkerDigest: digest("3"), dirtDigest: digest("4"),
    mutationAuthorityReceiptDigest: digest("5"), taskAuthorityBindingDigest: digest("6"),
    cloudAuthorityDigest: digest("7") });
  const adapter = {
    withFence: action => action(), readEvidence: async () => evidence,
    readIntent: async () => stored,
    writeIntent: async ({ expected, value }) => { assert.equal(stored, expected); stored = value; },
    reconcilePhase: async () => null,
    verifyTaskAuthority: async () => (calls.push("task"), {
      taskAuthorityReceiptDigest: digest("1"),
      sourceTaskAuthorityBindingDigest: evidence.sourceTaskAuthorityBindingDigest }),
    adoptPromotion: async ({ plan }) => { calls.push("adopt");
      const promoted = { claimId: successorClaimId,
        claimDigest: evidence.successor.fenceRevision,
        ledgerRevision: evidence.cloud.observedLedgerRevision,
        claimLedgerRevision: evidence.successor.transitionDigest,
        transitionCounter: evidence.successor.transitionCounter,
        expiresAt: evidence.successor.expiresAt };
      return { promoted, receiptDigest: digestValue({
        schema: "agentic-scope-expansion-successor-promotion-adoption/v1",
        recoveryPlanDigest: plan.planDigest, originalPlanDigest: evidence.originalPlanDigest,
        promoted,
      }) }; },
    bindSuccessor: async ({ plan }) => (calls.push("bind"), { authority: {
      claimId: successorClaimId, reviewRequestId: plan.evidence.originalPlan.sourceReviewRequestId,
      claimDigest: digest("b"), transitionCounter: 3,
      writeSetDigest: plan.evidence.originalPlan.targetWriteSetDigest,
      canonicalBaseSha: plan.evidence.originalPlan.targetCanonicalBaseSha,
      laneRevision: plan.evidence.originalPlan.sourceFenceSha,
    }, receiptDigest: digest("4") }),
    projectLocal: async () => (calls.push("local"), { leaseDigest: digest("5"),
      projection: { leaseDigest: digest("5"), claimId: successorClaimId, receiptDigest: digest("6"),
        sourceTaskAuthorityBindingDigest: evidence.sourceTaskAuthorityBindingDigest,
        targetTaskAuthorityBindingDigest: digest("f") },
      receiptDigest: digest("6"), adopted: false }),
    projectPullRequest: async () => (calls.push("marker"), {
      pullRequestMarkerDigest: digest("7"), receiptDigest: digest("8") }),
    verifyTerminal: async ({ plan, intent }) => { calls.push("verify"); const core = {
      ...terminalCore(plan), leaseDigest: intent.phases["local-cas"].values.leaseDigest,
      pullRequestMarkerDigest: intent.phases["pr-marker"].values.pullRequestMarkerDigest };
      const stable = { ...core }; delete stable.mutationAuthorityReceiptDigest;
      return { ...core, terminalVerificationDigest: digestValue(stable) }; },
    completeOriginalIntent: async ({ intent }) => (calls.push("complete"), {
      taskAuthorityReceiptDigest: intent.phases["task-authority-verified"].values.taskAuthorityReceiptDigest,
      successorBindReceiptDigest: intent.phases["successor-bound"].values.receiptDigest,
      localProjectionReceiptDigest: intent.phases["local-cas"].values.receiptDigest,
      pullRequestMarkerDigest: intent.phases["pr-marker"].values.pullRequestMarkerDigest,
      terminalVerificationDigest: intent.phases.verified.values.terminalVerificationDigest,
      finalScopeExpansionReceiptDigest: digest("9") }),
    verifyCompleted: async () => { completedChecks += 1; },
  };
  const controller = createScopeExpansionSuccessorProjectionRecoveryController(adapter);
  const plan = await controller.plan({ operatorSessionId: OPERATOR_SESSION });
  const completion = await controller.run({ plan, operatorSessionId: OPERATOR_SESSION,
    authorization: plan.exactAuthorization });
  assert.equal(completion.status, "successor-projected");
  assert.deepEqual(calls, ["task", "adopt", "task", "bind", "task", "local",
    "task", "marker", "verify", "task", "complete"]);
  await controller.run({ plan, operatorSessionId: OPERATOR_SESSION,
    authorization: plan.exactAuthorization });
  assert.equal(completedChecks, 1);
  assert.equal(calls.length, 11);
  await assert.rejects(controller.plan({ operatorSessionId: "competing-operator" }),
    /another operator session/u);
});
test("phase-specific capability proofs remain distinct at one fixed instant", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "successor-recovery-capability-"));
  try {
    const { lease, capability } = fixture();
    const capabilityPath = path.join(fs.realpathSync(root), "authority.json");
    fs.writeFileSync(capabilityPath, JSON.stringify(capability), { mode: 0o600 });
    const now = new Date("2026-08-14T00:00:01.000Z");
    const prove = phase => authorizeTaskBoundLeaseMutation({ lease, capabilityPath, now,
      operation: scopeExpansionSuccessorProjectionRecoveryTaskOperation(phase) });
    const first = prove("task-authority-verified"); const second = prove("successor-bound");
    assert.notEqual(first.proofDigest, second.proofDigest);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test("resume re-proves capability before an unjournaled C2 bind", async () => {
  const { evidence } = fixture();
  const plan = buildScopeExpansionSuccessorProjectionRecoveryPlan({
    evidence, operatorSessionId: OPERATOR_SESSION,
  });
  let stored = createScopeExpansionSuccessorProjectionRecoveryIntent(plan, plan.exactAuthorization);
  stored = advanceScopeExpansionSuccessorProjectionRecoveryIntent(stored, {
    status: "task-authority-verified", values: {
      taskAuthorityReceiptDigest: digest("1"),
      sourceTaskAuthorityBindingDigest: evidence.sourceTaskAuthorityBindingDigest,
    },
  });
  const promoted = { claimId: evidence.successor.claimId,
    claimDigest: evidence.successor.fenceRevision,
    ledgerRevision: evidence.cloud.observedLedgerRevision,
    claimLedgerRevision: evidence.successor.transitionDigest,
    transitionCounter: evidence.successor.transitionCounter,
    expiresAt: evidence.successor.expiresAt };
  stored = advanceScopeExpansionSuccessorProjectionRecoveryIntent(stored, {
    status: "promotion-adopted", values: { promoted, receiptDigest: digestValue({
      schema: "agentic-scope-expansion-successor-promotion-adoption/v1",
      recoveryPlanDigest: plan.planDigest, originalPlanDigest: evidence.originalPlanDigest,
      promoted,
    }) },
  });
  let binds = 0;
  const controller = createScopeExpansionSuccessorProjectionRecoveryController({
    withFence: action => action(), readEvidence: async () => evidence,
    readIntent: async () => stored, writeIntent: async () => assert.fail(),
    reconcilePhase: async () => null,
    verifyTaskAuthority: async () => { throw new Error("external capability missing"); },
    adoptPromotion: async () => null, bindSuccessor: async () => { binds += 1; },
    projectLocal: async () => null, projectPullRequest: async () => null,
    verifyTerminal: async () => null, completeOriginalIntent: async () => null,
    verifyCompleted: async () => null,
  });
  await assert.rejects(controller.run({ plan, operatorSessionId: OPERATOR_SESSION,
    authorization: plan.exactAuthorization }), /capability missing/u);
  assert.equal(binds, 0);
});
test("controller rejects a drifted fresh decision subject before its prepared journal", async () => {
  const { evidence } = fixture();
  const controller = createScopeExpansionSuccessorProjectionRecoveryController({
    withFence: action => action(), readIntent: async () => null, writeIntent: async () => assert.fail(),
    readEvidence: async () => ({ ...evidence,
      pullRequest: { ...evidence.pullRequest, bodyDigest: digest("f") },
      evidenceDigest: digest("0") }),
    reconcilePhase: async () => null, verifyTaskAuthority: async () => null,
    adoptPromotion: async () => null, bindSuccessor: async () => null,
    projectLocal: async () => null, projectPullRequest: async () => null,
    verifyTerminal: async () => null, completeOriginalIntent: async () => null,
    verifyCompleted: async () => null,
  });
  const plan = buildScopeExpansionSuccessorProjectionRecoveryPlan({
    evidence, operatorSessionId: OPERATOR_SESSION,
  });
  await assert.rejects(controller.run({ plan, operatorSessionId: OPERATOR_SESSION,
    authorization: plan.exactAuthorization }), /evidence drifted|decision subject/u);
});
test("stage validators reject controller, dirt, and PR drift before effects", () => {
  const { evidence } = fixture();
  assert.throws(() => assertScopeExpansionSuccessorRecoveryProtectedFrame({
    sealedController: evidence.controller,
    currentController: { ...evidence.controller, treeSha: sha("f") },
    sealedLane: evidence.lane,
    currentLane: evidence.lane,
  }), /protected controller/iu);
  assert.throws(() => assertScopeExpansionSuccessorRecoveryProtectedFrame({
    sealedController: evidence.controller, currentController: evidence.controller,
    sealedLane: evidence.lane, currentLane: { ...evidence.lane, branch: `${BRANCH}-drift` },
  }), /tracked source bytes/iu);
  assert.throws(() => assertScopeExpansionSuccessorRecoveryPullRequest({
    sealed: evidence.pullRequest,
    current: { ...evidence.pullRequest, isDraft: false },
    markerDigest: evidence.pullRequest.markerDigest,
    requireOriginalBody: true,
  }), /isDraft/u);
  assert.equal(assertScopeExpansionRecoverySuccessorUnexpired(
    evidence.successor.expiresAt,
    new Date("2026-08-15T00:00:00.000Z"),
  ), evidence.successor.expiresAt);
  assert.throws(() => assertScopeExpansionRecoverySuccessorUnexpired(
    "2026-08-15T00:00:00.000Z",
    new Date("2026-08-15T00:00:01.000Z"),
  ), /expired C2/u);
  assert.ok(Date.parse(evidence.lease.expiresAt) < Date.parse(evidence.successor.expiresAt));
});
test("terminal stable subject permits a fresh verifier receipt on complete replay", () => {
  const core = { schema: "agentic-scope-expansion-successor-projection-terminal/v1",
    recoveryPlanDigest: digest("1"), leaseDigest: digest("2"), originalIntentDigest: digest("3"),
    pullRequestMarkerDigest: digest("4"), dirtDigest: digest("5"),
    taskAuthorityBindingDigest: digest("6"), cloudAuthorityDigest: digest("7"),
    mutationAuthorityReceiptDigest: digest("8") };
  assert.equal(scopeExpansionSuccessorProjectionTerminalStableDigest(core),
    scopeExpansionSuccessorProjectionTerminalStableDigest({
      ...core, mutationAuthorityReceiptDigest: digest("9"),
    }));
});
test("repository adapter adopts exact bound-t3 response loss without a second cloud write", async () => {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "successor-adapter-")));
  try {
    const repository = path.join(temporary, "source");
    const commonDirectory = path.join(temporary, "common");
    fs.mkdirSync(repository); fs.mkdirSync(commonDirectory);
    fs.writeFileSync(path.join(repository, "one.txt"), "recovery\n", { mode: 0o644 });
    const implementationDigest = digestValue(CONTROLLER_IMPLEMENTATION.map(name => ({ name,
      digest: createHash("sha256").update(fs.readFileSync(path.join(CONTROLLER_ROOT, "scripts", name))).digest("hex") })));
    const source = fixture({ worktreePath: repository, implementationDigest });
    const plan = buildScopeExpansionSuccessorProjectionRecoveryPlan({
      evidence: source.evidence, operatorSessionId: OPERATOR_SESSION });
    let intent = createScopeExpansionSuccessorProjectionRecoveryIntent(plan, plan.exactAuthorization);
    intent = advanceScopeExpansionSuccessorProjectionRecoveryIntent(intent, {
      status: "task-authority-verified", values: { taskAuthorityReceiptDigest: digest("1"),
        sourceTaskAuthorityBindingDigest: source.evidence.sourceTaskAuthorityBindingDigest } });
    const promoted = promotedValues(plan);
    intent = advanceScopeExpansionSuccessorProjectionRecoveryIntent(intent, {
      status: "promotion-adopted", values: promoted });
    const bound = boundTransition(source.evidence);
    let status = bound.status;
    let ledger = bound.ledger;
    let cloudWrites = 0;
    const authorityPath = path.join(temporary, "authority.json");
    fs.writeFileSync(authorityPath, "{}", { mode: 0o600 });
    const leaseStore = { read: () => source.lease, readRegistry: () => ({
      schema: "agentic-writer-lease-registry/v2", revision: 1,
      leases: { [BRANCH]: source.lease },
      scopeExpansionIntents: { [BRANCH]: source.scopeExpansionIntent } }) };
    const adapter = createRepositoryAdapter({ repository, sourceSessionId: SOURCE_SESSION,
      operatorSessionId: OPERATOR_SESSION, pullRequestNumber: 7, taskAuthorityFile: authorityPath }, {
      git: recoveryGit({ repository, commonDirectory, source }), leaseStore,
      gh: () => JSON.stringify(pullRequestView(source)), cloudStatus: () => status,
      readLedger: () => ledger, invoke: () => { cloudWrites += 1; throw new Error("unexpected cloud write"); },
      now: () => new Date("2026-08-15T03:00:00.000Z") });
    const adopted = await adapter.reconcilePhase({ phase: "successor-bound", plan, intent });
    assert.equal(adopted.authority.claimId, plan.successorClaimId);
    assert.equal(cloudWrites, 0);
    ledger = { ...ledger, entries: [{ ...bound.entry, claimDigest: digest("0") }] };
    await assert.rejects(adapter.reconcilePhase({ phase: "successor-bound", plan, intent }), /ledger transition/u);
    ledger = bound.ledger;
    status = { ...status, claims: [{ ...bound.claim, operationReceiptDigest: digest("0") }] };
    await assert.rejects(adapter.reconcilePhase({ phase: "successor-bound", plan, intent }), /ledger transition/u);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});
test("journal rejects malformed files and symlinks, then recovers a stale lock", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "successor-recovery-journal-"));
  fs.chmodSync(root, 0o700);
  try {
    const directory = path.join(root, "agentic-canvas-os", "successor-recovery");
    ensureSecureRecoveryDirectory(root, directory);
    const journalPath = path.join(directory, "journal.json");
    assert.equal(scopeExpansionSuccessorProjectionRecoveryJournalKey(BRANCH),
      digestValue(`${BRANCH}:c9028c510bad6b44aa7538e7e6cc8829adebdc24a2284da4ed598e8aa69bbff9`));
    assert.throws(() => writeScopeExpansionSuccessorProjectionRecoveryJournal({ filePath: journalPath,
      stateRoot: root, expected: null, value: { padding: "x".repeat(2_100_000) } }), /size bound/u);
    const plan = buildScopeExpansionSuccessorProjectionRecoveryPlan({
      evidence: fixture().evidence, operatorSessionId: OPERATOR_SESSION,
    });
    const intent = createScopeExpansionSuccessorProjectionRecoveryIntent(
      plan,
      plan.exactAuthorization,
    );
    writeScopeExpansionSuccessorProjectionRecoveryJournal({
      filePath: journalPath, stateRoot: root, expected: null, value: intent,
    });
    assert.deepEqual(readScopeExpansionSuccessorProjectionRecoveryJournal(journalPath), intent);
    fs.writeFileSync(journalPath, `${JSON.stringify({ schema: "wrong", intent,
      intentDigest: digestValue(intent), extra: true })}\n`, { mode: 0o600 });
    assert.throws(() => readScopeExpansionSuccessorProjectionRecoveryJournal(journalPath),
      /unexpected or missing fields/u);
    fs.unlinkSync(journalPath);
    fs.symlinkSync(path.join(root, "missing"), journalPath);
    assert.throws(() => readScopeExpansionSuccessorProjectionRecoveryJournal(journalPath),
      /non-symlink/u);
    fs.unlinkSync(journalPath);
    const lockPath = `${journalPath}.lock`;
    fs.writeFileSync(lockPath, `${JSON.stringify({ pid: 999999, token: "stale",
      acquiredAt: "2026-08-15T00:00:00.000Z" })}\n`, { mode: 0o600 });
    let ran = 0;
    await withScopeExpansionSuccessorProjectionRecoveryFence({ lockPath, stateRoot: root,
      processAlive: () => false, action: async () => { ran += 1; } });
    assert.equal(ran, 1);
    assert.equal(fs.existsSync(lockPath), false);
    const target = path.join(root, "elsewhere");
    fs.mkdirSync(target, { mode: 0o700 });
    const linked = path.join(root, "linked");
    fs.symlinkSync(target, linked);
    assert.throws(() => ensureSecureRecoveryDirectory(root, linked), /real directory/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
function promotedValues(plan) { const promoted = { claimId: plan.evidence.successor.claimId,
  claimDigest: plan.evidence.successor.fenceRevision,
  ledgerRevision: plan.evidence.cloud.observedLedgerRevision,
  claimLedgerRevision: plan.evidence.successor.transitionDigest,
  transitionCounter: plan.evidence.successor.transitionCounter, expiresAt: plan.evidence.successor.expiresAt };
  return { promoted, receiptDigest: digestValue({ schema: "agentic-scope-expansion-successor-promotion-adoption/v1",
    recoveryPlanDigest: plan.planDigest, originalPlanDigest: plan.evidence.originalPlanDigest, promoted }) }; }
function boundTransition(evidence) { const claimCore = JSON.parse(JSON.stringify({ ...evidence.successor.claimCore,
  transitionCounter: evidence.successor.transitionCounter + 1,
  reviewRequestId: evidence.originalPlan.sourceReviewRequestId }));
  const claimDigest = digestValue(claimCore);
  const entry = { schema: "agentic-cloud-collaboration-entry/v2", sequence: 14,
    parentDigest: evidence.successor.transitionDigest, action: "continue",
    repositoryId: claimCore.repositoryId, claimId: claimCore.claimId, claimCore, claimDigest,
    idempotencyKey: digest("a"), requestDigest: digest("b"),
    evaluationTime: "2026-08-15T02:00:02.000Z", digest: digest("c") };
  const receipt = { schema: "agentic-collaboration-continuation-receipt/v1", operation: "continue",
    status: "current", repositoryId: entry.repositoryId, claimId: entry.claimId, claimDigest,
    fenceRevision: claimDigest, ledgerRevision: entry.digest, ledgerSequence: entry.sequence,
    idempotencyKey: entry.idempotencyKey, requestDigest: entry.requestDigest,
    evaluationTime: entry.evaluationTime };
  const { claimCore: ignored, ...prior } = evidence.successor;
  const claim = { ...prior, transitionCounter: claimCore.transitionCounter,
    reviewRequestId: claimCore.reviewRequestId, fenceRevision: claimDigest,
    transitionDigest: entry.digest, operationReceiptDigest: digestValue(receipt) };
  const status = { schema: "agentic-cloud-collaboration-result/v1", ok: true,
    ledgerRevision: sha("9"), ledgerDigest: digest("d"), sequence: 14, claims: [claim] };
  return { entry, claim, status, ledger: { headDigest: status.ledgerDigest,
    sequence: status.sequence, entries: [entry] } }; }
function pullRequestView(source) { const pull = source.evidence.pullRequest; return {
  url: pull.url, number: pull.number, id: pull.nodeId, state: pull.state, isDraft: pull.isDraft,
  isCrossRepository: false, autoMergeRequest: null, headRefName: pull.headRefName,
  headRefOid: pull.headRefOid, headRepository: { nameWithOwner: pull.headRepository },
  baseRefName: pull.baseRefName, baseRefOid: pull.baseRefOid, body: source.pullRequestBody }; }
function recoveryGit({ repository, commonDirectory, source }) { const lane = source.evidence.lane;
  const sourceValues = { "branch --show-current": BRANCH,
    "worktree list --porcelain -z": `worktree ${repository}\0HEAD ${lane.headSha}\0branch refs/heads/${BRANCH}\0`,
    "rev-parse --git-common-dir": commonDirectory, "diff --name-only -z HEAD --": "one.txt\0",
    "ls-files --others --exclude-standard -z": "", "diff --cached --binary": source.laneSources.stagedPatch,
    "diff --binary": source.laneSources.unstagedPatch,
    "status --porcelain=v1 -z --untracked-files=all": source.laneSources.status,
    "ls-tree HEAD -- one.txt": `100644 blob ${sha("5")}\tone.txt`,
    "ls-files --stage -- one.txt": `100644 ${sha("5")} 0\tone.txt`, "rev-parse HEAD": lane.headSha,
    [`ls-remote --heads origin refs/heads/${BRANCH}`]: `${lane.remoteHeadSha}\trefs/heads/${BRANCH}` };
  const controller = source.evidence.controller; const controllerValues = {
    "rev-parse HEAD": controller.headSha, "config --get remote.origin.url": controller.origin,
    "rev-parse origin/main": controller.originMainSha,
    "ls-remote origin refs/heads/main": `${controller.remoteMainSha}\trefs/heads/main`,
    "rev-parse HEAD^{tree}": controller.treeSha, "status --porcelain=v1": "" };
  return (args, cwd = repository) => { const values = path.resolve(cwd) === CONTROLLER_ROOT
    ? controllerValues : sourceValues; const key = args.join(" ");
    if (!Object.hasOwn(values, key)) throw new Error(`Unexpected git command: ${key}`); return values[key]; }; }
test("CLI canonicalizes the repository and rejects unsafe external plan paths", async () => {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "successor-cli-")));
  try {
    const repository = path.join(temporary, "source"), external = path.join(temporary, "external");
    fs.mkdirSync(repository); fs.mkdirSync(external); const repositoryAlias = path.join(temporary, "source-alias");
    fs.symlinkSync(repository, repositoryAlias); const plan = buildScopeExpansionSuccessorProjectionRecoveryPlan({
      evidence: fixture().evidence, operatorSessionId: OPERATOR_SESSION });
    const planPath = path.join(external, "plan.json"); fs.writeFileSync(planPath, JSON.stringify(plan), { mode: 0o644 });
    const common = [`--repository=${repositoryAlias}`, `--source-session=${SOURCE_SESSION}`,
      `--operator-session=${OPERATOR_SESSION}`, "--pull-request=7"];
    let canonicalRepository; const dependencies = { createController: options => { canonicalRepository = options.repository;
      return { run: async () => ({ receiptDigest: digest("1") }), plan: async () => plan }; } };
    await assert.rejects(runScopeExpansionSuccessorProjectionRecoveryCli(["execute", ...common,
      `--plan=${planPath}`, `--authorization=${plan.exactAuthorization}`], dependencies), /private regular/u);
    fs.chmodSync(planPath, 0o600); await runScopeExpansionSuccessorProjectionRecoveryCli(["execute", ...common,
      `--plan=${planPath}`, `--authorization=${plan.exactAuthorization}`], dependencies); assert.equal(canonicalRepository, repository);
    const link = path.join(external, "linked.json"); fs.symlinkSync(planPath, link);
    await assert.rejects(runScopeExpansionSuccessorProjectionRecoveryCli(["execute", ...common, `--plan=${link}`], dependencies), /non-symlink/u);
    const outputAlias = path.join(temporary, "output-alias"); fs.symlinkSync(repository, outputAlias);
    await assert.rejects(runScopeExpansionSuccessorProjectionRecoveryCli(["plan", ...common,
      `--output=${path.join(outputAlias, "plan.json")}`], dependencies), /outside the source worktree/u);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});
