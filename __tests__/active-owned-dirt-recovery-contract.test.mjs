import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeActiveOwnedDirtRecovery,
  buildActiveOwnedDirtRecoveryPlan,
  createActiveOwnedDirtLeaseRecovery,
  normalizeActiveOwnedDirtLeaseRecovery,
  normalizeActiveOwnedDirtRecoveryPlan,
  verifyActiveOwnedDirtCloudRecovery,
} from "../scripts/active-owned-dirt-recovery-contract.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";

const writeSet = ["path:src", "path:tests/recovery.test.mjs", "semantic:recovery"];
const writeSetDigest = digestValue(writeSet);

test("plan binds the exact expired admitted dormant lane and typed authorization", () => {
  const source = sourceFixture();
  const plan = buildActiveOwnedDirtRecoveryPlan({ source, ttlSeconds: 1_800 });
  assert.equal(plan.sourceSessionId, "source-session");
  assert.equal(plan.sourceCloudLeaseEpoch, 3);
  assert.equal(plan.sourceReviewRequestId, null);
  assert.match(plan.sourceWorkItemId, /^work-item:[0-9a-f]{64}$/u);
  assert.equal(plan.dirtyPathCount, 2);
  assert.deepEqual(normalizeActiveOwnedDirtRecoveryPlan(plan), plan);
  assert.throws(() => authorizeActiveOwnedDirtRecovery({
    plan,
    authorization: `authorize active-owned-dirt-reclaim ${"0".repeat(64)}`,
  }), /requires exact authorization/);
  assert.equal(authorizeActiveOwnedDirtRecovery({
    plan,
    authorization: `authorize active-owned-dirt-reclaim ${plan.planDigest}`,
  }).planDigest, plan.planDigest);
});

test("cloud response-loss replay accepts only the exact producer receipt", () => {
  const source = sourceFixture();
  const plan = buildActiveOwnedDirtRecoveryPlan({ source, ttlSeconds: 1_800 });
  const result = cloudResult(plan, { replayed: true });
  assert.equal(verifyActiveOwnedDirtCloudRecovery({
    plan, result, recoveryEvidenceDigest: "8".repeat(64),
  }).claimId, plan.sourceClaimId);
  result.operationReceipt.requestDigest = "0".repeat(64);
  assert.throws(() => verifyActiveOwnedDirtCloudRecovery({
    plan, result, recoveryEvidenceDigest: "8".repeat(64),
  }), /claim identity/);
});

test("plan rejects a different session and out-of-scope dirt", () => {
  const wrongSession = sourceFixture();
  wrongSession.sessionId = "successor-session";
  assert.throws(() => buildActiveOwnedDirtRecoveryPlan({
    source: wrongSession,
    ttlSeconds: 1_800,
  }), /exact expired, admitted/);

  const outside = sourceFixture();
  outside.evidence = evidenceFixture("outside.txt");
  assert.throws(() => buildActiveOwnedDirtRecoveryPlan({
    source: outside,
    ttlSeconds: 1_800,
  }), /outside the admitted write set/);
});

test("cloud recovery reuses the exact claim identity and produces compact lease evidence", () => {
  const plan = buildActiveOwnedDirtRecoveryPlan({
    source: sourceFixture(),
    ttlSeconds: 1_800,
  });
  const result = cloudResult(plan);
  assert.equal("deviceId" in result.claim, false);
  assert.equal("sessionId" in result.claim, false);
  assert.equal("recovery" in result.claim, false);
  const cloud = verifyActiveOwnedDirtCloudRecovery({
    plan,
    result,
    recoveryEvidenceDigest: "8".repeat(64),
  });
  assert.equal(cloud.transitionCounter, plan.sourceCloudTransitionCounter + 1);
  assert.notEqual(result.receipt.ledgerDigest, result.claim.transitionDigest);
  const snapshot = {
    snapshotReceiptDigest: "8".repeat(64),
    snapshotRef: `refs/agentic-canvas-os/recovery/active-owned-dirt/${plan.sourceClaimId}/${plan.planDigest}`,
    commitSha: "9".repeat(40),
    indexCommitSha: "a".repeat(40),
  };
  const recovery = createActiveOwnedDirtLeaseRecovery({
    plan,
    snapshot,
    cloud,
    recoveredAt: cloud.recoveredAt,
  });
  assert.deepEqual(normalizeActiveOwnedDirtLeaseRecovery(recovery), recovery);
  assert.equal(recovery.sourceSessionId, plan.sourceSessionId);
  assert.equal(recovery.snapshotReceiptDigest, snapshot.snapshotReceiptDigest);

  result.claim.workItemId = `work-item:${"0".repeat(64)}`;
  assert.throws(() => verifyActiveOwnedDirtCloudRecovery({
    plan,
    result,
    recoveryEvidenceDigest: "8".repeat(64),
  }), /claim identity/);

  for (const mutate of [
    value => { value.claim.predecessorClaimId = "1".repeat(64); },
    value => { value.operationReceipt.receiptDigest = "2".repeat(64); },
    value => { value.receipt.receiptDigest = "3".repeat(64); },
  ]) {
    const tampered = cloudResult(plan);
    mutate(tampered);
    assert.throws(() => verifyActiveOwnedDirtCloudRecovery({
      plan, result: tampered, recoveryEvidenceDigest: "8".repeat(64),
    }), /claim identity/);
  }
});

function sourceFixture() {
  const evidence = evidenceFixture("src/runtime.mjs");
  const actorId = "github-user:123";
  const repositoryId = "github-repository:R_repo";
  const workItemId = `work-item:${"9".repeat(64)}`;
  const leaseEpoch = 3;
  const claimId = digestValue({ actorId, canonicalBaseRevision: "a".repeat(40),
    leaseEpoch, repositoryId, workItemId, writeSetDigest });
  const operationReceiptDigest = "0".repeat(64);
  const lease = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 9,
    sessionId: "source-session",
    device: "device",
    scope: "recovery",
    branch: "agent/device/recovery",
    worktreePath: "/worktree",
    baseSha: "a".repeat(40),
    fenceSha: "b".repeat(40),
    pullRequestUrl: "https://github.test/org/repo/pull/9",
    heartbeatAt: "2026-08-08T00:00:00.000Z",
    expiresAt: "2026-08-08T00:30:00.000Z",
    admission: {
      schema: "agentic-lane-admission-lease/v1",
      status: "admitted",
      declaredWriteSet: writeSet,
      writeSetDigest,
      manifestDigest: "c".repeat(64),
    },
    cloudAuthority: {
      schema: "agentic-lane-cloud-authority/v1",
      state: "active",
      claimId,
      claimDigest: "e".repeat(64),
      claimLedgerRevision: "f".repeat(64),
      transitionCounter: 3,
      leaseEpoch,
      entrySchema: "agentic-cloud-collaboration-entry/v2",
      claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
      operationReceiptDigest,
      deviceId: "device",
      sessionId: "source-session",
      reviewRequestId: null,
    },
  };
  const claim = {
    claimId: lease.cloudAuthority.claimId,
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    actorId,
    repositoryId,
    workItemId,
    fenceRevision: lease.cloudAuthority.claimDigest,
    transitionDigest: "f".repeat(64),
    transitionCounter: 3,
    leaseEpoch,
    state: "dormant-preserved",
    canonicalBaseRevision: lease.baseSha,
    laneRevision: lease.fenceSha,
    writeSetDigest,
    declaredWriteScope: writeSet,
    reviewRequestId: lease.cloudAuthority.reviewRequestId,
    operationReceiptDigest,
  };
  const expectedMarker = { marker: "source" };
  const pullRequest = {
    id: "PR_source",
    url: lease.pullRequestUrl,
    state: "OPEN",
    isDraft: true,
    headRefName: lease.branch,
    headRefOid: lease.fenceSha,
    baseRefName: "main",
    baseRefOid: "c".repeat(40),
    headRepository: { nameWithOwner: "org/repo" },
    autoMergeRequest: null,
  };
  lease.cloudAuthority.targetRepository = "org/repo";
  return {
    sessionId: lease.sessionId,
    branch: lease.branch,
    lease,
    leaseDigest: "1".repeat(64),
    headSha: lease.fenceSha,
    remoteHeadSha: lease.fenceSha,
    remoteMainSha: "d".repeat(40),
    pullRequest,
    pullRequestBodyDigest: "2".repeat(64),
    markerDigest: digestValue(expectedMarker),
    expectedMarker,
    worktreeIdentityDigest: "3".repeat(64),
    claim,
    overlappingClaims: [],
    ledgerRevision: "4".repeat(40),
    ledgerDigest: "5".repeat(64),
    evidence,
    protectedMainAdvance: {
      schema: "agentic-active-owned-dirt-protected-main-advance/v1",
      baseSha: lease.baseSha,
      pullRequestBaseSha: pullRequest.baseRefOid,
      protectedMainSha: "d".repeat(40),
      protectedMainTreeSha: "e".repeat(40),
      declaredWriteSetDigest: writeSetDigest,
      changedPathCount: 1,
      changedPathsDigest: digestValue(["docs/unrelated.md"]),
    },
    evaluatedAt: "2026-08-09T00:00:00.000Z",
  };
}

function evidenceFixture(firstPath) {
  const entries = [firstPath, "tests/recovery.test.mjs"].map((entryPath, index) => ({
    path: entryPath,
    staged: index === 0,
    unstaged: index === 0,
    untracked: index === 1,
    headMode: index === 0 ? "100644" : null,
    headBlob: index === 0 ? "1".repeat(40) : null,
    indexMode: index === 0 ? "100644" : null,
    indexBlob: index === 0 ? "2".repeat(40) : null,
    worktreeType: "file",
    worktreeMode: "100644",
    worktreeBlob: String(index + 3).repeat(40),
  })).sort((left, right) => left.path.localeCompare(right.path));
  const core = {
    schema: "agentic-active-owned-dirt-evidence/v1",
    headSha: "b".repeat(40),
    entries,
    pathCount: 2,
    stagedPathCount: 1,
    unstagedPathCount: 1,
    untrackedPathCount: 1,
  };
  return { ...core, evidenceDigest: digestValue(core) };
}

function cloudResult(plan, { replayed = false } = {}) {
  const evaluationTime = "2026-08-09T00:00:00.000Z";
  const expiresAt = "2026-08-09T00:30:00.000Z";
  const claimDigest = "6".repeat(64);
  const claimTransitionDigest = "a".repeat(64);
  const idempotencyKey = digestValue(`active-owned-dirt-recovery:${plan.planDigest}`);
  const requestDigest = digestValue({ action: "continue", intent: {
    repositoryId: plan.sourceRepositoryId,
    actorId: plan.sourceActorId,
    deviceId: plan.sourceCloudDeviceId,
    sessionId: plan.sourceCloudSessionId,
    claimId: plan.sourceClaimId,
    expectedFenceRevision: plan.sourceClaimDigest,
    expectedTransitionCounter: plan.sourceCloudTransitionCounter,
    mode: "recovery",
    laneRevision: null,
    reviewRequestId: null,
    expiresAt,
    focusedEvidenceDigest: null,
    handoffEvidenceDigest: null,
    recoveryEvidenceDigest: "8".repeat(64),
  } });
  const operationCore = {
    schema: "agentic-collaboration-continuation-receipt/v1",
    operation: "continue",
    status: "current",
    repositoryId: plan.sourceRepositoryId,
    claimId: plan.sourceClaimId,
    claimDigest,
    fenceRevision: claimDigest,
    ledgerRevision: claimTransitionDigest,
    ledgerSequence: 5,
    idempotencyKey,
    requestDigest,
    evaluationTime,
  };
  const operationReceipt = { ...operationCore, receiptDigest: digestValue(operationCore) };
  const receiptCore = {
    schema: "agentic-cloud-collaboration-github-receipt/v1",
    action: "continue",
    ledgerRevision: "7".repeat(40),
    ledgerDigest: "8".repeat(64),
    claimId: plan.sourceClaimId,
    claimDigest,
    contractReceiptDigest: operationReceipt.receiptDigest,
    sequence: 6,
    evaluationTime,
  };
  return {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "continue",
    status: "current",
    replayed,
    attempts: 1,
    claimDigest,
    ledgerRevision: "7".repeat(40),
    operationReceipt,
    receipt: { ...receiptCore, receiptDigest: digestValue(receiptCore) },
    claim: {
      claimId: plan.sourceClaimId,
      entrySchema: "agentic-cloud-collaboration-entry/v2",
      claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
      state: "current",
      writeAuthority: true,
      scopeReserved: true,
      actorId: plan.sourceActorId,
      repositoryId: plan.sourceRepositoryId,
      workItemId: plan.sourceWorkItemId,
      canonicalBaseRevision: plan.sourceBaseSha,
      laneRevision: plan.sourceFenceSha,
      writeSetDigest: plan.sourceWriteSetDigest,
      declaredWriteScope: plan.sourceDeclaredWriteSet,
      reviewRequestId: plan.sourceReviewRequestId,
      leaseEpoch: plan.sourceCloudLeaseEpoch,
      transitionCounter: plan.sourceCloudTransitionCounter + 1,
      heartbeatCounter: 0,
      predecessorClaimId: null,
      transitionDigest: claimTransitionDigest,
      fenceRevision: claimDigest,
      operationReceiptDigest: operationReceipt.receiptDigest,
      integrationReceiptDigest: null,
      integration: null,
      expiresAt,
    },
  };
}
