import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { digestValue, normalizeWriteSet } from "../scripts/cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "../scripts/github-cloud-collaboration-mapping.mjs";
import { advanceScopeExpansionSuccessorProjectionRecoveryIntent, buildScopeExpansionSuccessorProjectionRecoveryPlan, createScopeExpansionSuccessorProjectionRecoveryIntent, scopeExpansionSuccessorProjectionRecoveryTaskOperation, scopeExpansionSuccessorProjectionTerminalStableDigest } from "../scripts/scope-expansion-successor-projection-recovery-contract.mjs";
import { createScopeExpansionSuccessorProjectionRecoveryController, ensureSecureRecoveryDirectory, readScopeExpansionSuccessorProjectionRecoveryJournal, withScopeExpansionSuccessorProjectionRecoveryFence, writeScopeExpansionSuccessorProjectionRecoveryJournal } from "../scripts/scope-expansion-successor-projection-recovery-controller.mjs";
import { assertScopeExpansionRecoverySuccessorUnexpired, assertScopeExpansionSuccessorRecoveryProtectedFrame, assertScopeExpansionSuccessorRecoveryPullRequest, buildScopeExpansionSuccessorProjectionRecoveryEvidence, normalizeScopeExpansionSuccessorProjectionRecoveryEvidence, readScopeExpansionSuccessorProjectionRecoveryLane } from "../scripts/scope-expansion-successor-projection-recovery-evidence.mjs";
import { advanceExactScopeExpansionIntent, bindExactRecoverySuccessor, createRepositoryAdapter, scopeExpansionSuccessorProjectionRecoveryJournalKey } from "../scripts/scope-expansion-successor-projection-recovery-repository-adapter.mjs";
import { runScopeExpansionSuccessorProjectionRecoveryCli } from "../scripts/scope-expansion-successor-projection-recovery.mjs";
import { createTaskAuthorityBinding, createTaskAuthorityCapability } from "../scripts/task-bound-lane-authority-contract.mjs";
import { authorizeTaskBoundLeaseMutation } from "../scripts/task-bound-lane-authority-store.mjs";
import { projectWriterLeasePullRequestMarker, updateWriterLeasePullRequestBody } from "../scripts/writer-lease-lib.mjs";
import { writerLeaseDigest } from "../scripts/writer-lease-registry-cas.mjs";
const sha = value => value.repeat(40), digest = value => value.repeat(64);
const BRANCH = "agent/recovery-device/successor-projection";
const SOURCE_SESSION = "source-session", OPERATOR_SESSION = "operator-session", REVIEW = "github-pull-request:PR_node";
const CONTROLLER_ROOT = path.resolve(import.meta.dirname, "..");
const CONTROLLER_IMPLEMENTATION = ["active-dirty-scope-expansion-controller.mjs", "active-dirty-scope-expansion-successor-projection.mjs", "scope-expansion-successor-projection-recovery-evidence.mjs",
  "scope-expansion-successor-projection-recovery-contract.mjs", "scope-expansion-successor-projection-recovery-controller.mjs",
  "scope-expansion-successor-projection-recovery-repository-adapter.mjs", "scope-expansion-successor-projection-recovery.mjs"];
function verificationResult({
  claim,
  claims,
  ledgerRevision,
  ledgerDigest,
  evaluationTime,
  contractReceiptDigest,
} = {}) {
  const currentClaimInventoryCore = {
    schema: "agentic-cloud-collaboration-current-claim-inventory/v1",
    ledgerRevision,
    ledgerDigest,
    evaluationTime,
    claims,
  };
  const currentClaimInventory = {
    ...currentClaimInventoryCore,
    claimInventoryDigest: digestValue(currentClaimInventoryCore),
  };
  const receiptCore = {
    schema: "agentic-cloud-collaboration-github-verification/v1",
    ok: true,
    ledgerRevision,
    ledgerDigest,
    claimId: claim.claimId,
    claimDigest: claim.fenceRevision,
    contractReceiptDigest,
    claimInventoryDigest: currentClaimInventory.claimInventoryDigest,
    evaluationTime,
    findings: [],
  };
  return {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "verify",
    status: "ready",
    ledgerRevision,
    claimDigest: claim.fenceRevision,
    claim,
    currentClaimInventory,
    findings: [],
    receipt: { ...receiptCore, receiptDigest: digestValue(receiptCore) },
  };
}
function fixture({ worktreePath = "/workspace/source", implementationDigest = digest("b"),
  targetWriteSet = ["path:one.txt", "path:two.txt", "semantic:successor-projection"],
  protectedChangedPaths = [" leading-controller.mjs", "line\nbreak.mjs"] } = {}) {
  targetWriteSet = normalizeWriteSet(targetWriteSet);
  const sourceWriteSet = ["path:one.txt", "semantic:successor-projection"];
  const sourceAdmission = { schema: "agentic-lane-admission-lease/v1", status: "admitted", semanticScope: "successor-projection",
    declaredWriteSet: sourceWriteSet, writeSetDigest: digestValue(sourceWriteSet), manifestDigest: digest("1"), planReceiptDigest: digest("2"),
    admissionReceiptDigest: digest("3"), existingLaneStateDigest: digest("4"), admittedReportDigest: digest("5"), preservationReceiptDigest: digest("6") };
  const sourceAuthority = { schema: "agentic-lane-cloud-authority/v1", provider: "github", ledgerRepository: "example/project", targetRepository: "example/project",
    claimId: digest("a"), claimDigest: digest("b"), ledgerRevision: sha("1"), ledgerDigest: digest("c"), claimLedgerRevision: digest("d"),
    entrySchema: "agentic-cloud-collaboration-entry/v2", claimIdentitySchema: "agentic-cloud-collaboration-entry/v2", operationReceiptDigest: digest("e"), mutationAuthorityEligible: true,
    canonicalBaseSha: sha("2"), laneRevision: sha("3"), cloudDeclaredWriteScope: sourceWriteSet, writeSetDigest: digestValue(sourceWriteSet), deviceId: "recovery-device",
    sessionId: SOURCE_SESSION, reviewRequestId: REVIEW, leaseEpoch: 1, transitionCounter: 2, state: "active", expiresAt: "2026-08-15T01:00:00.000Z",
    integrationReceiptDigest: null, integration: null, manifestDigest: sourceAdmission.manifestDigest };
  const leaseCore = { schema: "agentic-writer-lease/v2", status: "active", epoch: 7, sessionId: SOURCE_SESSION, device: "recovery-device", scope: "successor-projection",
    branch: BRANCH, worktreePath, baseSha: sha("2"), fenceSha: sha("3"), pullRequestUrl: "https://github.com/example/project/pull/7", autoDelivery: false,
    runtimeRequired: false, admission: sourceAdmission, cloudAuthority: sourceAuthority, acquiredAt: "2026-08-14T00:00:00.000Z",
    heartbeatAt: "2026-08-14T00:00:00.000Z", expiresAt: "2026-08-15T01:00:00.000Z" };
  const capability = createTaskAuthorityCapability({ authoritySubjectId: `urn:agentic-task:${digest("f")}`, issuedAt: "2026-08-14T00:00:00.000Z" });
  const lease = { ...leaseCore, taskAuthority: createTaskAuthorityBinding({ capability, lease: leaseCore, boundAt: "2026-08-14T00:00:00.000Z" }) };
  const stagedPatch = "", unstagedPatch = "diff --git a/one.txt b/one.txt";
  const status = " M one.txt\0", changedPaths = ["one.txt"];
  const sourceDirtyDigest = digestValue({ stagedPatch, unstagedPatch, changedPaths, untracked: [] });
  const planCore = { schema: "agentic-active-dirty-scope-expansion-plan/v1", sourceBranch: BRANCH, sourceFenceSha: lease.fenceSha,
    sourceLeaseDigest: writerLeaseDigest(lease), sourceClaimId: sourceAuthority.claimId, sourceClaimDigest: sourceAuthority.claimDigest,
    sourceClaimTransitionCounter: 2, sourceReviewRequestId: REVIEW, sourceWriteSetDigest: sourceAdmission.writeSetDigest,
    sourceManifestDigest: sourceAdmission.manifestDigest, sourceDirtyDigest, sourceChangedPaths: changedPaths,
    targetCanonicalBaseSha: sha("2"), targetManifestDigest: digest("8"), targetWriteSetDigest: digestValue(targetWriteSet),
    targetDeclaredWriteSet: targetWriteSet, targetCloudLeaseEpoch: 1 };
  const originalPlan = { ...planCore, planDigest: digestValue(planCore) };
  const successorClaimId = digest("9"), waitingClaimDigest = digest("0"), waitingTransition = digest("1");
  const scopeExpansionIntent = { schema: "agentic-active-dirty-scope-expansion-intent/v1", status: "source-retired", branch: BRANCH,
    sourceLeaseDigest: originalPlan.sourceLeaseDigest, sourceClaimId: originalPlan.sourceClaimId, sourceFenceSha: originalPlan.sourceFenceSha,
    targetWriteSetDigest: originalPlan.targetWriteSetDigest, targetManifestDigest: originalPlan.targetManifestDigest, planDigest: originalPlan.planDigest,
    targetClaimId: successorClaimId, targetClaimDigest: waitingClaimDigest, targetLeaseEpoch: 1, targetCanonicalBaseSha: originalPlan.targetCanonicalBaseSha,
    targetReviewRequestId: null, completedReceiptDigest: null, waiting: { claimId: successorClaimId, claimDigest: waitingClaimDigest,
      ledgerRevision: sha("4"), claimLedgerRevision: waitingTransition, transitionCounter: 1, expiresAt: "2026-08-16T00:00:00.000Z" },
    waitingReceiptDigest: digest("2"), sourceRetirementReceiptDigest: digest("3"), promoted: null, promotedReceiptDigest: null,
    boundAuthority: null, boundReceiptDigest: null, localProjection: null, localProjectionReceiptDigest: null,
    pullRequestProjection: null, pullRequestProjectionReceiptDigest: null, finalReceiptDigest: null, planSnapshot: originalPlan };
  const entries = [{ path: changedPaths[0], headMode: "100644", headObject: sha("5"), indexMode: "100644", indexObject: sha("5"),
    worktreeMode: "644", size: 9, contentDigest: createHash("sha256").update("recovery\n").digest("hex") }];
  const laneSubject = { statusDigest: digestValue(status), stagedPatchDigest: digestValue(stagedPatch),
    unstagedPatchDigest: digestValue(unstagedPatch), changedPaths, untrackedPaths: [], entries };
  const lane = { branch: BRANCH, headSha: lease.fenceSha, remoteHeadSha: lease.fenceSha,
    dirty: true, legacyDirtyDigest: originalPlan.sourceDirtyDigest, ...laneSubject,
    dirtDigest: digestValue(laneSubject) };
  const retiredClaimDigest = digest("8"), retiredTransition = digest("a");
  const sourceRetirement = { claimId: sourceAuthority.claimId, actorId: "github-user:1", deviceId: pseudonymousIdentifier("device", lease.device),
    sessionId: pseudonymousIdentifier("session", lease.sessionId), repositoryId: "github-repository:1", workItemId: pseudonymousIdentifier("work-item", "historical-source-scope"),
    canonicalBaseRevision: lease.baseSha, declaredWriteScope: sourceWriteSet, writeSetDigest: sourceAdmission.writeSetDigest, laneRevision: lease.fenceSha,
    leaseEpoch: 1, transitionCounter: 3, heartbeatCounter: 0, state: "retired", expiresAt: lease.expiresAt, reviewRequestId: REVIEW, predecessorClaimId: null,
    retirement: { reason: "superseded", finalRevision: lease.fenceSha, reviewRequestId: REVIEW, bytesDigest: digest("b"), namedChecksDigest: digest("c"),
      handoffEvidenceDigest: digest("d"), integrationReceiptDigest: null, retiredAt: "2026-08-15T02:00:00.000Z" }, claimDigest: retiredClaimDigest,
    transitionDigest: retiredTransition, priorClaimDigest: sourceAuthority.claimDigest, action: "retire" };
  const successorCore = { claimId: successorClaimId, actorId: sourceRetirement.actorId, deviceId: pseudonymousIdentifier("device", lease.device),
    sessionId: pseudonymousIdentifier("session", lease.sessionId), repositoryId: sourceRetirement.repositoryId, workItemId: pseudonymousIdentifier("work-item", lease.scope),
    canonicalBaseRevision: originalPlan.targetCanonicalBaseSha, declaredWriteScope: targetWriteSet, writeSetDigest: originalPlan.targetWriteSetDigest,
    laneRevision: originalPlan.sourceFenceSha, leaseEpoch: 1, transitionCounter: 2, heartbeatCounter: 0, state: "current", expiresAt: "2099-08-16T00:00:00.000Z",
    reviewRequestId: null, predecessorClaimId: sourceAuthority.claimId, promotedAt: "2026-08-15T02:00:01.000Z" };
  const successor = { claimId: successorClaimId, entrySchema: "agentic-cloud-collaboration-entry/v2", claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    state: "current", writeAuthority: true, scopeReserved: true, actorId: successorCore.actorId, repositoryId: successorCore.repositoryId,
    workItemId: successorCore.workItemId, canonicalBaseRevision: successorCore.canonicalBaseRevision, laneRevision: successorCore.laneRevision,
    declaredWriteScope: targetWriteSet, writeSetDigest: originalPlan.targetWriteSetDigest, leaseEpoch: 1, transitionCounter: 2, heartbeatCounter: 0,
    reviewRequestId: null, predecessorClaimId: sourceAuthority.claimId, expiresAt: successorCore.expiresAt, fenceRevision: digest("e"), transitionDigest: digest("f"),
    operationReceiptDigest: digest("a"), integrationReceiptDigest: null, integration: null, waitingClaimDigest,
    waitingTransitionDigest: waitingTransition, claimCore: successorCore };
  const recoveryLineage = [{ sequence: 10, action: "continue", claimId: sourceAuthority.claimId, claimDigest: sourceAuthority.claimDigest,
    transitionDigest: sourceAuthority.claimLedgerRevision, transitionCounter: 2 }, { sequence: 11, action: "claim", claimId: successorClaimId,
    claimDigest: waitingClaimDigest, transitionDigest: waitingTransition, transitionCounter: 1 }, { sequence: 12, action: "retire", claimId: sourceAuthority.claimId,
    claimDigest: retiredClaimDigest, transitionDigest: retiredTransition, transitionCounter: 3 }, { sequence: 13, action: "continue", claimId: successorClaimId,
    claimDigest: successor.fenceRevision, transitionDigest: successor.transitionDigest, transitionCounter: 2 }];
  const controller = { repository: "example/project", origin: "https://github.com/example/project.git", headSha: sha("6"), originMainSha: sha("6"),
    remoteMainSha: sha("6"), treeSha: sha("7"), clean: true, implementationDigest, canonicalBaseLineage: { ancestorSha: originalPlan.targetCanonicalBaseSha,
      descendantSha: sha("6"), mergeBaseSha: originalPlan.targetCanonicalBaseSha, protectedChangedPaths } };
  const marker = projectWriterLeasePullRequestMarker(lease), pullRequestBody = updateWriterLeasePullRequestBody("", lease);
  const pullRequest = { url: lease.pullRequestUrl, number: 7, nodeId: "PR_node", state: "OPEN", isDraft: true, autoMergeAbsent: true,
    headRepository: controller.repository, headRefName: BRANCH, headRefOid: lease.fenceSha, baseRefName: "main", baseRefOid: originalPlan.targetCanonicalBaseSha,
    marker, markerDigest: digestValue(marker), bodyDigest: digestValue(pullRequestBody),
    bodyWithoutMarkerDigest: digestValue(pullRequestBody.replace(/<!--\s*agentic-writer-lease\/v2\s+\{.*?\}\s*-->/gsu, "")) };
  const evidence = buildScopeExpansionSuccessorProjectionRecoveryEvidence({
    controller, lane, lease, scopeExpansionIntent, pullRequest, sourceRetirement, successor,
    cloud: { observedLedgerRevision: sha("8"), observedLedgerDigest: digest("d"), observedLedgerSequence: 13, observedInventoryDigest: digestValue([publicSuccessor(successor)]),
      sourceRetirementDigest: digestValue(sourceRetirement), successorDigest: digestValue(successor), successorCandidateCount: 1, sourceLineageCount: 3,
      successorLineageCount: 2, sourceLineageDigest: digestValue([digest("7"), sourceAuthority.claimLedgerRevision, retiredTransition]),
      successorLineageDigest: digestValue([waitingTransition, successor.transitionDigest]), recoveryLineage,
      validatedLedgerDigest: digestValue({ schema: "ledger", ledgerRepositoryId: "repo", headDigest: digest("d"), sequence: 13, recoveryLineage }) },
  });
  return { evidence, successorClaimId, lease, capability, scopeExpansionIntent, pullRequestBody, laneSources: { stagedPatch, unstagedPatch, status } };
}
test("evidence seals expired C1, exact four-transition lineage, file modes, and current C2", () => {
  const { evidence } = fixture();
  assert.deepEqual(normalizeScopeExpansionSuccessorProjectionRecoveryEvidence(evidence), evidence);
  assert.equal(evidence.scopeExpansionIntent.status, "source-retired"); assert.equal(evidence.sourceRetirement.transitionCounter, 3);
  assert.equal(evidence.successor.transitionCounter, 2); assert.equal(evidence.lane.entries[0].worktreeMode, "644");
  assert.equal(evidence.lane.statusDigest, digestValue(" M one.txt\0"));
  assert.notEqual(evidence.pullRequest.baseRefOid, evidence.controller.headSha);
  assert.deepEqual(evidence.controller.canonicalBaseLineage.protectedChangedPaths,
    [" leading-controller.mjs", "line\nbreak.mjs"]);
  assert.throws(() => normalizeScopeExpansionSuccessorProjectionRecoveryEvidence({ ...evidence,
    successor: { ...evidence.successor, scopeReserved: false } }), /evidence drifted|successor/u);
  assert.throws(() => buildScopeExpansionSuccessorProjectionRecoveryEvidence({
    ...evidence, successor: { ...evidence.successor,
      claimCore: { ...evidence.successor.claimCore, deviceId: evidence.lease.device } } }), /identity/u);
  assert.throws(() => buildScopeExpansionSuccessorProjectionRecoveryEvidence({
    ...evidence, successor: { ...evidence.successor, workItemId: pseudonymousIdentifier("work-item", "drift"),
      claimCore: { ...evidence.successor.claimCore,
        workItemId: pseudonymousIdentifier("work-item", "drift") } } }), /identity/u);
  assert.throws(() => buildScopeExpansionSuccessorProjectionRecoveryEvidence({ ...evidence,
    pullRequest: { ...evidence.pullRequest, baseRefOid: evidence.controller.headSha } }), /pull-request identity/iu);
  assert.throws(() => buildScopeExpansionSuccessorProjectionRecoveryEvidence({ ...evidence,
    controller: { ...evidence.controller, canonicalBaseLineage: {
      ...evidence.controller.canonicalBaseLineage, mergeBaseSha: sha("3") } } }), /canonical-base lineage/iu);
  const semantic = "semantic:successor-projection";
  for (const [target, changed] of [["one.txt", "one.txt"], ["one.txt", "one.txt/nested"],
    ["dir/file", "dir"], ["leading-controller.mjs", " leading-controller.mjs"]]) {
    assert.throws(() => fixture({ targetWriteSet: ["path:one.txt", `path:${target}`, semantic],
      protectedChangedPaths: [changed] }), /overlaps/iu);
  }
  assert.throws(() => fixture({ targetWriteSet: ["path:.", "semantic:successor-projection"] }), /overlaps/iu);
  assert.doesNotThrow(() => fixture({ targetWriteSet: ["path:dir/file", semantic],
    protectedChangedPaths: ["dir/file-sibling"] }));
  assert.doesNotThrow(() => fixture({ protectedChangedPaths: [] }));
});
test("contract requires a fresh recovery token and rejects untyped phase values", () => {
  const plan = buildScopeExpansionSuccessorProjectionRecoveryPlan({ evidence: fixture().evidence,
    operatorSessionId: OPERATOR_SESSION });
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
    adoptPromotion: async ({ plan }) => { calls.push("adopt"); return promotedValues(plan); },
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
  stored = advanceScopeExpansionSuccessorProjectionRecoveryIntent(stored, {
    status: "promotion-adopted", values: promotedValues(plan),
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
    currentController: { ...evidence.controller, canonicalBaseLineage: {
      ...evidence.controller.canonicalBaseLineage, protectedChangedPaths: ["scripts/drift.mjs"] } },
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
    const oddPath = " tracked\nline.txt", untrackedPath = " untracked\nline.txt";
    fs.writeFileSync(path.join(repository, oddPath), "recovery\n", { mode: 0o644 });
    const oddSource = { ...source, evidence: { ...source.evidence, lane: {
      ...source.evidence.lane, changedPaths: [oddPath], untrackedPaths: [untrackedPath] } },
    laneSources: { ...source.laneSources, status: ` M ${oddPath}\0?? ${untrackedPath}\0` } };
    const untrackedGit = recoveryGit({ repository, commonDirectory, source: oddSource });
    const rawLane = readScopeExpansionSuccessorProjectionRecoveryLane({ repository,
      git: (...input) => untrackedGit(...input).trim(), gitRaw: untrackedGit });
    assert.deepEqual([rawLane.changedPaths, rawLane.untrackedPaths], [[oddPath], [untrackedPath]]);
    assert.equal(rawLane.statusDigest, digestValue(oddSource.laneSources.status));
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
    const rawGit = recoveryGit({ repository, commonDirectory, source });
    let bindWrites = 0;
    for (const [key, value] of [["observedLedgerRevision", sha("9")], ["observedLedgerDigest", digest("9")],
      ["observedLedgerSequence", 14], ["validatedLedgerDigest", digest("9")]]) {
      const drifted = buildScopeExpansionSuccessorProjectionRecoveryEvidence({ ...source.evidence,
        cloud: { ...source.evidence.cloud, [key]: value } });
      assert.throws(() => bindExactRecoverySuccessor({ plan, readEvidence: () => drifted,
        bind: () => { bindWrites += 1; } }), /decision subject/u);
    }
    assert.equal(bindWrites, 0);
    const unboundStatus = { schema: "agentic-cloud-collaboration-result/v1", ok: true,
      claims: [publicSuccessor(source.evidence.successor)] };
    const driftedHead = buildScopeExpansionSuccessorProjectionRecoveryEvidence({ ...source.evidence,
      cloud: { ...source.evidence.cloud, observedLedgerDigest: digest("9") } });
    let bindCaptures = 0, bindInvokes = 0;
    const bindStore = { ...leaseStore, statePath: path.join(temporary, "bind-registry.json"),
      withRegistryLock: action => action(leaseStore.readRegistry()) };
    const bindAdapter = createRepositoryAdapter({ repository, sourceSessionId: SOURCE_SESSION,
      operatorSessionId: OPERATOR_SESSION, pullRequestNumber: 7, taskAuthorityFile: authorityPath }, {
      git: (...input) => rawGit(...input).trim(), gitRaw: rawGit, leaseStore: bindStore,
      gh: () => JSON.stringify(pullRequestView(source)), cloudStatus: () => unboundStatus,
      captureEvidence: () => ++bindCaptures === 4 ? driftedHead : source.evidence,
      invoke: () => { bindInvokes += 1; throw new Error("unexpected bind"); }, now: () => new Date("2026-08-15T03:00:00.000Z") });
    await assert.rejects(bindAdapter.bindSuccessor({ plan, intent }), /decision subject/u); assert.equal(bindInvokes, 0);
    const adapter = createRepositoryAdapter({ repository, sourceSessionId: SOURCE_SESSION,
      operatorSessionId: OPERATOR_SESSION, pullRequestNumber: 7, taskAuthorityFile: authorityPath }, {
      git: (...input) => rawGit(...input).trim(), gitRaw: rawGit, leaseStore,
      gh: () => JSON.stringify(pullRequestView(source)), cloudStatus: () => status,
      readLedger: () => ledger, invoke: () => { cloudWrites += 1; throw new Error("unexpected cloud write"); },
      now: () => new Date("2026-08-15T03:00:00.000Z") });
    const adopted = await adapter.reconcilePhase({ phase: "successor-bound", plan, intent });
    assert.equal(adopted.authority.claimId, plan.successorClaimId);
    assert.equal(cloudWrites, 0);
    for (const drift of [{ claimDigest: digest("0") }, { parentDigest: digest("0") }, { sequence: 15 }]) {
      ledger = { ...bound.ledger, entries: [{ ...bound.entry, ...drift }] };
      await assert.rejects(adapter.reconcilePhase({ phase: "successor-bound", plan, intent }), /ledger transition/u);
    }
    ledger = bound.ledger;
    status = { ...status, claims: [{ ...bound.claim, operationReceiptDigest: digest("0") }] };
    await assert.rejects(adapter.reconcilePhase({ phase: "successor-bound", plan, intent }), /ledger transition/u);
    const projected = projectedState(source, plan, bound); let body, liveIntent;
    let edits = 0, registryWrites = 0, protectedDrift = false, pullReads = 0, driftMode, insideLock = false;
    const projectedStore = { statePath: path.join(temporary, "writer-leases.json"),
      read: () => projected.lease, readRegistry: () => ({ schema: "agentic-writer-lease-registry/v2",
        revision: 1, leases: { [BRANCH]: projected.lease }, scopeExpansionIntents: { [BRANCH]: liveIntent } }),
      withRegistryLock: action => { if (driftMode === "intent") liveIntent = { ...liveIntent, promotedReceiptDigest: digest("6") };
        insideLock = true; try { const result = action(projectedStore.readRegistry()); registryWrites += 1;
          liveIntent = result.intent || liveIntent; return result; } finally { insideLock = false; } } };
    const guardedGit = (args, cwd) => protectedDrift && path.resolve(cwd || repository) === CONTROLLER_ROOT
      && args.includes("--name-only") ? "protected-drift.mjs\0" : rawGit(args, cwd);
    const prAdapter = createRepositoryAdapter({ repository, sourceSessionId: SOURCE_SESSION,
      operatorSessionId: OPERATOR_SESSION, pullRequestNumber: 7, taskAuthorityFile: authorityPath }, {
      git: (...input) => rawGit(...input).trim(), gitRaw: guardedGit, leaseStore: projectedStore,
      gh: () => { pullReads += 1; if (driftMode === "pull" && pullReads === 3) protectedDrift = true;
        return JSON.stringify(pullRequestView(source, body)); }, invoke: () => bound.status,
      verify: () => { if (driftMode === "verify" || driftMode === "lock-cloud" && insideLock) protectedDrift = true; return projected.verification; },
      execute: (command, args) => {
        if (command !== "gh") throw new Error("unexpected effect"); edits += 1; body = args.at(-1); return ""; },
      now: () => new Date("2026-08-15T03:00:00.000Z") });
    for (driftMode of ["verify", "pull", "intent", "lock-cloud"]) { body = source.pullRequestBody; liveIntent = projected.intent;
      edits = 0; registryWrites = 0; protectedDrift = false; pullReads = 0;
      await assert.rejects(prAdapter.projectPullRequest({ plan }), /protected controller|intent changed/iu);
      assert.deepEqual([edits, registryWrites], [0, 0]); }
    driftMode = null; protectedDrift = false; pullReads = edits = registryWrites = 0;
    body = updateWriterLeasePullRequestBody(source.pullRequestBody, projected.lease); liveIntent = projected.intent;
    const recovered = await prAdapter.projectPullRequest({ plan });
    assert.equal(recovered.pullRequestMarkerDigest, liveIntent.pullRequestProjection.markerDigest);
    assert.deepEqual([edits, registryWrites, liveIntent.status], [0, 1, "pr-marker"]);
    await prAdapter.projectPullRequest({ plan }); assert.equal(registryWrites, 1);
    liveIntent = { ...liveIntent, status: "complete", finalReceiptDigest: digest("f") };
    await prAdapter.projectPullRequest({ plan }); assert.equal(registryWrites, 1);
    const prMarker = { ...projected.intent, status: "pr-marker", pullRequestProjection: { markerDigest: digest("1") },
      pullRequestProjectionReceiptDigest: digest("2") };
    for (const [sourceIntent, statusName, values] of [[projected.intent, "pr-marker", { pullRequestProjection: { markerDigest: digest("1") }, projectionReceiptDigest: digest("2") }],
      [prMarker, "complete", { finalReceiptDigest: digest("3") }]]) {
      let effects = 0, writes = 0; const raced = { ...sourceIntent, promotedReceiptDigest: digest("7") };
      const raceStore = { statePath: path.join(temporary, `${statusName}.json`), withRegistryLock: action => {
        const result = action({ schema: "agentic-writer-lease-registry/v2", revision: 1, leases: { [BRANCH]: projected.lease }, scopeExpansionIntents: { [BRANCH]: raced } }); writes += 1; return result; } };
      assert.throws(() => advanceExactScopeExpansionIntent({ leaseStore: raceStore, branch: BRANCH,
        expectedLeaseDigest: writerLeaseDigest(projected.lease), expectedClaimId: plan.successorClaimId,
        expectedPlanDigest: plan.evidence.originalPlanDigest, expectedIntentDigest: digestValue(sourceIntent),
        status: statusName, ...values, beforeMutation: () => { effects += 1; } }), /intent changed/u);
      assert.deepEqual([effects, writes, fs.existsSync(raceStore.statePath)], [0, 0, false]);
    }
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
    const plan = buildScopeExpansionSuccessorProjectionRecoveryPlan({ evidence: fixture().evidence,
      operatorSessionId: OPERATOR_SESSION });
    const intent = createScopeExpansionSuccessorProjectionRecoveryIntent(plan,
      plan.exactAuthorization);
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
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
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
  const entry = { schema: "agentic-cloud-collaboration-entry/v2", sequence: evidence.cloud.observedLedgerSequence + 1,
    parentDigest: evidence.cloud.observedLedgerDigest, action: "continue",
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
  const status = { schema: "agentic-cloud-collaboration-result/v1", ok: true, action: "status", status: "ready",
    ledgerRevision: sha("9"), ledgerDigest: entry.digest, sequence: entry.sequence, claims: [claim] };
  return { entry, claim, status, ledger: { headDigest: status.ledgerDigest,
    sequence: status.sequence, entries: [entry] } }; }
function publicSuccessor(successor) { const { claimCore, waitingClaimDigest, waitingTransitionDigest, ...claim } = successor;
  return claim; }
function projectedState(source, plan, bound) { const claim = bound.claim, original = plan.evidence.originalPlan;
  const authority = { ...source.lease.cloudAuthority, claimId: claim.claimId, claimDigest: claim.fenceRevision,
    ledgerRevision: bound.status.ledgerRevision, ledgerDigest: bound.status.ledgerDigest,
    claimLedgerRevision: claim.transitionDigest, canonicalBaseSha: original.targetCanonicalBaseSha,
    laneRevision: original.sourceFenceSha, cloudDeclaredWriteScope: original.targetDeclaredWriteSet,
    writeSetDigest: original.targetWriteSetDigest, reviewRequestId: original.sourceReviewRequestId,
    transitionCounter: claim.transitionCounter, state: "active", expiresAt: claim.expiresAt,
    operationReceiptDigest: claim.operationReceiptDigest, manifestDigest: original.targetManifestDigest };
  const leaseCore = { ...source.lease, expiresAt: claim.expiresAt,
    admission: { ...source.lease.admission, declaredWriteSet: original.targetDeclaredWriteSet,
      writeSetDigest: original.targetWriteSetDigest, manifestDigest: original.targetManifestDigest },
    cloudAuthority: authority };
  const lease = { ...leaseCore, taskAuthority: createTaskAuthorityBinding({ capability: source.capability,
    lease: leaseCore, bindingMode: "continuation", priorBindingDigest: source.lease.taskAuthority.bindingDigest,
    boundAt: "2026-08-15T03:00:00.000Z" }) };
  const promoted = promotedValues(plan), leaseDigest = writerLeaseDigest(lease);
  const intent = { ...source.scopeExpansionIntent, status: "local-cas", promoted: promoted.promoted,
    promotedReceiptDigest: promoted.receiptDigest, boundAuthority: authority,
    boundReceiptDigest: authority.operationReceiptDigest, targetClaimId: authority.claimId,
    targetClaimDigest: authority.claimDigest, targetReviewRequestId: authority.reviewRequestId,
    localProjection: { claimId: authority.claimId, leaseDigest }, localProjectionReceiptDigest: digest("4") };
    const verification = verificationResult({
      claim,
      claims: [claim],
      ledgerRevision: bound.status.ledgerRevision,
      ledgerDigest: bound.status.ledgerDigest,
      evaluationTime: "2026-08-15T03:00:00.000Z",
      contractReceiptDigest: digest("3"),
    });
  return { lease, intent, verification }; }
function pullRequestView(source, body = source.pullRequestBody) { const pull = source.evidence.pullRequest; return {
  url: pull.url, number: pull.number, id: pull.nodeId, state: pull.state, isDraft: pull.isDraft,
  isCrossRepository: false, autoMergeRequest: null, headRefName: pull.headRefName,
  headRefOid: pull.headRefOid, headRepository: { nameWithOwner: pull.headRepository },
  baseRefName: pull.baseRefName, baseRefOid: pull.baseRefOid, body }; }
function recoveryGit({ repository, commonDirectory, source }) { const lane = source.evidence.lane;
  const changedPath = lane.changedPaths[0];
  const sourceValues = { "branch --show-current": BRANCH,
    "worktree list --porcelain -z": `worktree ${repository}\0HEAD ${lane.headSha}\0branch refs/heads/${BRANCH}\0`,
    "rev-parse --git-common-dir": commonDirectory, "diff --name-only -z HEAD --": `${lane.changedPaths.join("\0")}\0`,
    "ls-files --others --exclude-standard -z": lane.untrackedPaths.length ? `${lane.untrackedPaths.join("\0")}\0` : "",
    "diff --cached --binary": source.laneSources.stagedPatch,
    "diff --binary": source.laneSources.unstagedPatch,
    "status --porcelain=v1 -z --untracked-files=all": source.laneSources.status,
    [`ls-tree HEAD -- ${changedPath}`]: `100644 blob ${sha("5")}\t${changedPath}`,
    [`ls-files --stage -- ${changedPath}`]: `100644 ${sha("5")} 0\t${changedPath}`, "rev-parse HEAD": lane.headSha,
    [`ls-remote --heads origin refs/heads/${BRANCH}`]: `${lane.remoteHeadSha}\trefs/heads/${BRANCH}` };
  const controller = source.evidence.controller; const controllerValues = {
    "rev-parse HEAD": controller.headSha, "config --get remote.origin.url": controller.origin,
    "rev-parse origin/main": controller.originMainSha,
    [`--no-replace-objects diff --no-ext-diff --no-renames --name-only -z ${controller.canonicalBaseLineage.ancestorSha} ${controller.headSha} --`]:
      `${controller.canonicalBaseLineage.protectedChangedPaths.join("\0")}\0`,
    [`--no-replace-objects merge-base ${controller.canonicalBaseLineage.ancestorSha} ${controller.headSha}`]:
      controller.canonicalBaseLineage.mergeBaseSha,
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
