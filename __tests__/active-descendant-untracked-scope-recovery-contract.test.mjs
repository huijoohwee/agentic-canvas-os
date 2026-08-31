import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  activeDescendantUntrackedScopeRecoveryOperationKey,
  activeDescendantUntrackedPullRequestIdentityDigest,
  advanceActiveDescendantUntrackedScopeRecoveryIntent,
  authorizeActiveDescendantUntrackedScopeRecovery,
  buildActiveDescendantUntrackedScopeRecoveryPlan,
  buildActiveDescendantUntrackedScopeRecoveryReceipt,
  createActiveDescendantUntrackedScopeRecoveryIntent,
  normalizeActiveDescendantUntrackedScopeRecoveryIntent,
  OPERATION,
  PHASES,
  stableActiveDescendantUntrackedTerminalDigest,
} from "../scripts/active-descendant-untracked-scope-recovery-contract.mjs";
import {
  buildActiveDescendantUntrackedOwnerStopEvidence,
  buildActiveDescendantUntrackedScopeRecoveryEvidence,
  buildActiveDescendantUntrackedTargetAvailabilityEvidence,
  normalizeActiveDescendantUntrackedScopeRecoveryEvidence,
} from "../scripts/active-descendant-untracked-scope-recovery-evidence.mjs";
import {
  createTaskAuthorityBinding,
  createTaskAuthorityCapability,
} from "../scripts/task-bound-lane-authority-contract.mjs";

const FENCE = "1".repeat(40);
const HEAD = "2".repeat(40);
const BASE = "3".repeat(40);
const CLAIM = "a".repeat(64);
const SUCCESSOR = "b".repeat(64);
const BRANCH = "agent/device/owner-recovery";
const SCOPE = "owner-recovery";
const SOURCE_PATH = "scripts/source-owned.mjs";
const UNTRACKED_PATH = "scripts/new-recovery-contract.mjs";
const FUTURE_PATH = "scripts/new-recovery-adapter.mjs";

test("evidence joins same-owner descendant, byte dirt, owner stop, and future absence", () => {
  const evidence = evidenceFixture();
  assert.equal(evidence.lane.remoteFenceSha, FENCE);
  assert.equal(evidence.lane.headSha, HEAD);
  assert.deepEqual(evidence.ownerStop.untrackedPaths, [UNTRACKED_PATH]);
  assert.deepEqual(evidence.targetAvailability.absentPaths, [FUTURE_PATH]);
  assert.equal(evidence.dirt.stagedPathCount, 1);
  assert.equal(evidence.dirt.untrackedPathCount, 1);
  assert.equal(evidence.mutationBoundary.pullRequestBody, false);
  assert.equal(evidence.mutationBoundary.pullRequestMarker, false);
  assert.equal("pullRequestMarkerCas" in evidence.mutationBoundary, false);
  assert.deepEqual(normalizeActiveDescendantUntrackedScopeRecoveryEvidence(evidence), evidence);
});

test("evidence rejects unstopped bytes, source-scope escape, and unavailable future paths", () => {
  const valid = evidenceInput();
  const wrongStop = structuredClone(valid);
  const stopCore = { ...wrongStop.ownerStop, sourceHeadSha: FENCE };
  delete stopCore.receiptDigest;
  wrongStop.ownerStop = { ...stopCore, receiptDigest: digestValue(stopCore) };
  assert.throws(
    () => buildActiveDescendantUntrackedScopeRecoveryEvidence(wrongStop),
    /joins/u,
  );

  const uncoveredTracked = structuredClone(valid);
  uncoveredTracked.dirt = dirtEvidence([
    trackedEntry("outside/source-scope.mjs"),
    untrackedEntry(UNTRACKED_PATH),
  ]);
  assert.throws(
    () => buildActiveDescendantUntrackedScopeRecoveryEvidence(uncoveredTracked),
    /joins/u,
  );

  const unavailable = structuredClone(valid);
  unavailable.targetAvailability = buildActiveDescendantUntrackedTargetAvailabilityEvidence({
    sourceClaimId: CLAIM,
    targetWriteSetDigest: valid.targetManifest.writeSetDigest,
    absentPaths: [],
    inventoryDigest: d("c"),
    verificationReceiptDigest: d("d"),
    observedAt: valid.observedAt,
  });
  assert.throws(
    () => buildActiveDescendantUntrackedScopeRecoveryEvidence(unavailable),
    /joins/u,
  );
});

test("plan seals only the exact authorization and no Git or review authority", () => {
  const plan = planFixture();
  assert.equal(plan.exactAuthorization, `authorize ${OPERATION} ${plan.planDigest}`);
  assert.deepEqual(plan.forbiddenMutations, [
    "source-bytes", "index", "head", "local-ref", "remote-ref", "commit", "push",
    "pull-request-body", "pull-request-marker", "pull-request-state", "review",
    "integration", "merge", "deployment", "cleanup",
  ]);
  assert.equal(plan.allowedMutations.includes("pull-request-marker-cas"), false);
  assert.equal(PHASES.includes("pr-preserved"), false);
  assert.equal(plan.pullRequestIdentityDigest,
    activeDescendantUntrackedPullRequestIdentityDigest(plan.evidence.pullRequest));
  assert.match(plan.evidence.pullRequest.bodyDigest, /^[0-9a-f]{64}$/u);
  assert.match(plan.evidence.pullRequest.markerDigest, /^[0-9a-f]{64}$/u);
  assert.throws(
    () => authorizeActiveDescendantUntrackedScopeRecovery(plan, "authorize recovery"),
    /exact authorization/u,
  );
  assert.match(activeDescendantUntrackedScopeRecoveryOperationKey(plan, "authorized"),
    /^active-descendant-untracked-scope-recovery:authorized:/u);
});

test("intent keeps every cloud phase at the remote fence and grants authoring only", () => {
  const plan = planFixture();
  const authorizationReceipt = authorizeActiveDescendantUntrackedScopeRecovery(
    plan,
    plan.exactAuthorization,
  );
  let intent = createActiveDescendantUntrackedScopeRecoveryIntent({
    plan,
    authorizationReceipt,
  });
  const values = phaseValues(plan);
  for (const phase of PHASES.slice(1)) {
    intent = advanceActiveDescendantUntrackedScopeRecoveryIntent(intent, {
      phase,
      values: values[phase],
    });
  }
  assert.deepEqual(normalizeActiveDescendantUntrackedScopeRecoveryIntent(intent), intent);
  const receipt = buildActiveDescendantUntrackedScopeRecoveryReceipt(intent);
  assert.equal(receipt.status, "authoring-authority-restored");
  assert.equal(receipt.mutationAuthorityGranted, true);
  assert.equal(receipt.authoringAuthority, true);
  assert.equal(receipt.reviewAuthority, false);
  assert.equal(receipt.integrationAuthority, false);
  assert.equal(receipt.deploymentAuthority, false);
  assert.equal(receipt.cleanupAuthority, false);
  assert.equal(receipt.pullRequestMutation, false);
  assert.equal(receipt.providerProjection, "deferred");
  assert.equal(receipt.crossDeviceResumeAuthority, false);
  assert.equal(receipt.sourceMutation, false);
  assert.equal(receipt.indexMutation, false);
  assert.equal(receipt.headMutation, false);
  assert.equal(receipt.localRefMutation, false);
  assert.equal(receipt.remoteRefMutation, false);
  assert.equal(
    stableActiveDescendantUntrackedTerminalDigest(values.verified),
    values.verified.terminalEvidenceDigest,
  );

  assert.equal("pullRequestBodyDigest" in values.verified.terminalEvidence, false);
  assert.equal("pullRequestMarkerDigest" in values.verified.terminalEvidence, false);
  const refreshed = structuredClone(values.verified);
  refreshed.terminalEvidence.verifiedAt = "2026-08-31T00:21:00.000Z";
  refreshed.terminalEvidence.cloudVerificationReceiptDigest = d("7");
  refreshed.terminalEvidence.mutationAuthorityReceiptDigest = d("8");
  refreshed.cloudVerificationReceiptDigest = d("7");
  refreshed.mutationAuthorityReceiptDigest = d("8");
  assert.equal(
    stableActiveDescendantUntrackedTerminalDigest(refreshed),
    values.verified.terminalEvidenceDigest,
  );

  const drifted = phaseValues(plan);
  drifted["successor-current"] = {
    ...drifted["successor-current"],
    laneRevision: HEAD,
  };
  let stopped = createActiveDescendantUntrackedScopeRecoveryIntent({
    plan,
    authorizationReceipt,
  });
  for (const phase of ["task-authority-verified", "successor-waiting",
    "source-retired"]) {
    stopped = advanceActiveDescendantUntrackedScopeRecoveryIntent(stopped, {
      phase,
      values: drifted[phase],
    });
  }
  assert.throws(
    () => advanceActiveDescendantUntrackedScopeRecoveryIntent(stopped, {
      phase: "successor-current",
      values: drifted["successor-current"],
    }),
    /successor transition/u,
  );
});

function evidenceFixture() {
  return buildActiveDescendantUntrackedScopeRecoveryEvidence(evidenceInput());
}

function evidenceInput() {
  const sourceWriteSet = [`path:${SOURCE_PATH}`, `semantic:${SCOPE}`].sort();
  const targetManifestCore = { schema: "agentic-declared-write-scope/v1",
    semanticScope: SCOPE, paths: [FUTURE_PATH, SOURCE_PATH, UNTRACKED_PATH].sort() };
  const targetWriteSet = [`path:${FUTURE_PATH}`, `path:${SOURCE_PATH}`,
    `path:${UNTRACKED_PATH}`, `semantic:${SCOPE}`].sort();
  const targetManifest = { ...targetManifestCore, declaredWriteSet: targetWriteSet,
    manifestDigest: digestValue(targetManifestCore), writeSetDigest: digestValue(targetWriteSet) };
  const cloudAuthority = { schema: "agentic-lane-cloud-authority/v1",
    ledgerRepository: "authority/repository", targetRepository: "owner/repository",
    claimId: CLAIM, claimDigest: d("4"), claimLedgerRevision: d("5"),
    operationReceiptDigest: d("6"), transitionCounter: 4,
    reviewRequestId: "review-id", laneRevision: FENCE };
  const leaseCore = { schema: "agentic-writer-lease/v2", status: "active", epoch: 1,
    sessionId: "source-session", device: "device", scope: SCOPE, branch: BRANCH,
    worktreePath: "/workspace/source", baseSha: BASE, fenceSha: FENCE,
    pullRequestUrl: "https://review.invalid/1", cloudAuthority,
    admission: { schema: "agentic-lane-admission-lease/v1", status: "admitted",
      semanticScope: SCOPE, declaredWriteSet: sourceWriteSet,
      writeSetDigest: digestValue(sourceWriteSet), manifestDigest: d("7") } };
  const capability = createTaskAuthorityCapability({
    authoritySubjectId: `urn:agentic-task:${"8".repeat(64)}`,
    issuedAt: "2026-08-31T00:00:00.000Z",
  });
  const taskAuthority = createTaskAuthorityBinding({ capability, lease: leaseCore,
    boundAt: "2026-08-31T00:01:00.000Z" });
  const lease = { ...leaseCore, taskAuthority };
  const dirt = dirtEvidence([trackedEntry(SOURCE_PATH), untrackedEntry(UNTRACKED_PATH)]);
  const ownerStop = buildActiveDescendantUntrackedOwnerStopEvidence({
    sourceSessionId: lease.sessionId,
    sourceBranch: BRANCH,
    sourceHeadSha: HEAD,
    sourceFenceSha: FENCE,
    untrackedPaths: [UNTRACKED_PATH],
    stoppedAt: "2026-08-31T00:10:00.000Z",
  });
  return {
    repository: "owner/repository",
    authorityRepository: "authority/repository",
    observedAt: "2026-08-31T00:11:00.000Z",
    lane: { schema: "agentic-clean-unpublished-descendant/v1",
      status: "clean-unpublished-descendant", branch: BRANCH, scope: SCOPE,
      sessionId: lease.sessionId, device: lease.device, worktreeIdentityDigest: d("9"),
      baseSha: BASE, remoteFenceSha: FENCE, headSha: HEAD,
      headTreeSha: "5".repeat(40), linearDescendant: true, headPublished: false,
      commitCount: 1, commitInventoryDigest: d("a"), rangeDiffDigest: d("b"),
      changedPaths: [SOURCE_PATH] },
    lease,
    registry: (() => { const snapshot = { schema: "agentic-writer-lease-registry/v2",
      revision: 7, leases: { [BRANCH]: lease } }; return { snapshot, revision: 7,
      leaseDigest: digestValue(lease), registryDigest: digestValue(snapshot) }; })(),
    claim: { schema: "agentic-current-cloud-claim-evidence/v1",
      claimId: CLAIM, fenceRevision: cloudAuthority.claimDigest,
      transitionDigest: cloudAuthority.claimLedgerRevision,
      operationReceiptDigest: cloudAuthority.operationReceiptDigest,
      state: "current", writeAuthority: true, scopeReserved: true,
      actorId: "actor", repositoryId: "owner/repository", workItemId: SCOPE,
      predecessorClaimId: null, canonicalBaseRevision: BASE, laneRevision: FENCE,
      declaredWriteScope: sourceWriteSet, writeSetDigest: digestValue(sourceWriteSet),
      leaseEpoch: 1, transitionCounter: 4, heartbeatCounter: 1,
      reviewRequestId: "review-id", expiresAt: "2026-08-31T01:00:00.000Z",
      ledgerRevision: "6".repeat(40), ledgerDigest: d("d"),
      inventoryDigest: d("e"), verificationReceiptDigest: d("f") },
    pullRequest: { schema: "agentic-draft-review-subject/v1", adapterId: "provider",
      repository: "owner/repository", id: "review-id", nodeId: "node-id",
      number: 1, url: lease.pullRequestUrl,
      state: "open", draft: true, autoDelivery: null, branch: BRANCH,
      headSha: FENCE, baseSha: BASE, bodyDigest: d("e"),
      bodyRemainderDigest: d("f"), markerDigest: d("0"),
      observedAt: "2026-08-31T00:11:00.000Z" },
    dirt,
    ownerStop,
    targetManifest,
    targetAvailability: buildActiveDescendantUntrackedTargetAvailabilityEvidence({
      sourceClaimId: CLAIM,
      targetWriteSetDigest: targetManifest.writeSetDigest,
      absentPaths: [FUTURE_PATH],
      inventoryDigest: d("1"),
      verificationReceiptDigest: d("2"),
      observedAt: "2026-08-31T00:11:00.000Z",
    }),
    controller: { repository: "owner/repository", branch: "agent/controller/recovery",
      baseSha: "7".repeat(40), headSha: "8".repeat(40), remoteHeadSha: "8".repeat(40),
      treeSha: "9".repeat(40), clean: true, published: true, leaseDigest: d("3"),
      claimId: d("4"), claimDigest: d("5"), transitionCounter: 2,
      writeSetDigest: d("6"), taskAuthorityBindingDigest: d("7"),
      implementationDigest: d("8") },
    mutationBoundary: { privateJournal: true, taskAuthorityProof: true,
      cloudSuccessorClaim: true, cloudSourceRetirement: true,
      cloudSuccessorPromotion: true, cloudReviewBinding: true,
      writerRegistryCas: true, sourceBytes: false, index: false, head: false,
      localRef: false, remoteRef: false, commit: false, push: false,
      pullRequestBody: false, pullRequestMarker: false, pullRequestState: false,
      reviewAuthority: false,
      integration: false, deployment: false, cleanup: false },
  };
}

function dirtEvidence(entries) {
  const sorted = [...entries].sort((left, right) => left.path.localeCompare(right.path));
  const core = { schema: "agentic-active-owned-dirt-evidence/v1", headSha: HEAD,
    entries: sorted, pathCount: sorted.length,
    stagedPathCount: sorted.filter(entry => entry.staged).length,
    unstagedPathCount: sorted.filter(entry => entry.unstaged).length,
    untrackedPathCount: sorted.filter(entry => entry.untracked).length };
  return { ...core, evidenceDigest: digestValue(core) };
}

function trackedEntry(file) {
  return { path: file, staged: true, unstaged: false, untracked: false,
    headMode: "100644", headBlob: "a".repeat(40),
    indexMode: "100644", indexBlob: "b".repeat(40),
    worktreeType: "file", worktreeMode: "100644", worktreeBlob: "b".repeat(40) };
}

function untrackedEntry(file) {
  return { path: file, staged: false, unstaged: false, untracked: true,
    headMode: null, headBlob: null, indexMode: null, indexBlob: null,
    worktreeType: "file", worktreeMode: "100644", worktreeBlob: "c".repeat(40) };
}

function planFixture() {
  return buildActiveDescendantUntrackedScopeRecoveryPlan({ evidence: evidenceFixture() });
}

function phaseValues(plan) {
  const task = { taskAuthorityReceiptDigest: d("1"),
    taskAuthorityProofDigest: d("2"),
    sourceTaskAuthorityBindingDigest: plan.sourceTaskAuthorityBindingDigest };
  const waiting = { claimId: SUCCESSOR, claimDigest: d("3"), transitionCounter: 1,
    state: "waiting-successor", predecessorClaimId: CLAIM,
    writeSetDigest: plan.targetWriteSetDigest, laneRevision: FENCE,
    operationReceiptDigest: d("4"), receiptDigest: d("5") };
  const current = { ...waiting, claimDigest: d("6"), transitionCounter: 2,
    state: "current", operationReceiptDigest: d("7"), receiptDigest: d("8") };
  const boundAuthority = { claimId: SUCCESSOR, claimDigest: d("9"),
    transitionCounter: 3, state: "active", laneRevision: FENCE,
    reviewRequestId: "review-id" };
  const bound = { authority: boundAuthority, claimId: SUCCESSOR,
    claimDigest: boundAuthority.claimDigest, transitionCounter: 3, state: "current",
    laneRevision: FENCE, reviewRequestId: "review-id",
    operationReceiptDigest: d("a"), verificationReceiptDigest: d("b"),
    receiptDigest: d("c") };
  const local = { leaseDigest: d("d"), registryRevision: 8,
    taskAuthorityBindingDigest: d("e"), mutationAuthorityReceiptDigest: d("f"),
    adopted: false, receiptDigest: d("0") };
  const terminalEvidence = { sourceHeadSha: HEAD,
    sourceIndexEvidenceDigest: plan.sourceIndexEvidenceDigest,
    sourceDirtEvidenceDigest: plan.sourceDirtEvidenceDigest,
    successorClaimId: SUCCESSOR, successorClaimDigest: bound.claimDigest,
    successorTransitionCounter: bound.transitionCounter,
    successorLaneRevision: FENCE, targetWriteSetDigest: plan.targetWriteSetDigest,
    targetManifestDigest: plan.targetManifestDigest,
    sourceLeaseDigest: plan.sourceLeaseDigest, targetLeaseDigest: local.leaseDigest,
    registryRevision: local.registryRevision, registryDigest: d("5"),
    pullRequestIdentityDigest: plan.pullRequestIdentityDigest,
    taskAuthorityReceiptDigest: task.taskAuthorityReceiptDigest,
    mutationAuthorityReceiptDigest: local.mutationAuthorityReceiptDigest,
    cloudVerificationReceiptDigest: d("6"), verifiedAt: "2026-08-31T00:20:00.000Z",
    sourceMutation: false, indexMutation: false, headMutation: false,
    localRefMutation: false, remoteRefMutation: false, commitMutation: false,
    pushMutation: false, authoringAuthority: true, reviewAuthority: false,
    integrationAuthority: false, deploymentAuthority: false, cleanupAuthority: false,
    pullRequestMutation: false, providerProjection: "deferred",
    crossDeviceResumeAuthority: false };
  const verifiedCore = { terminalEvidence,
    terminalEvidenceDigest: stableActiveDescendantUntrackedTerminalDigest(terminalEvidence),
    mutationAuthorityReceiptDigest: terminalEvidence.mutationAuthorityReceiptDigest,
    cloudVerificationReceiptDigest: terminalEvidence.cloudVerificationReceiptDigest };
  return { "task-authority-verified": task, "successor-waiting": waiting,
    "source-retired": { sourceClaimId: CLAIM, sourceClaimDigest: d("7"),
      transitionCounter: plan.sourceTransitionCounter + 1, state: "retired",
      operationReceiptDigest: d("8"), receiptDigest: d("9") },
    "successor-current": current, "successor-bound": bound, "local-cas": local,
    verified: { ...verifiedCore, receiptDigest: digestValue(verifiedCore) }, complete: {} };
}

function d(character) { return character.repeat(64); }
