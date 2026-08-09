import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeActiveOwnedDirtRecovery,
  buildActiveOwnedDirtRecoveryPlan,
  classifyActiveOwnedDirtCloudRecoveryState,
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

test("cloud response-loss replay accepts only the exact recovered same claim", () => {
  const source = sourceFixture();
  const plan = buildActiveOwnedDirtRecoveryPlan({ source, ttlSeconds: 1_800 });
  const snapshotReceiptDigest = "8".repeat(64);
  assert.equal(classifyActiveOwnedDirtCloudRecoveryState({
    plan, source, snapshotReceiptDigest,
  }), "source");
  source.claim = {
    ...source.claim,
    state: "current",
    fenceRevision: "6".repeat(64),
    transitionDigest: "a".repeat(64),
    transitionCounter: plan.sourceCloudTransitionCounter + 1,
    operationReceiptDigest: "9".repeat(64),
    recovery: {
      evidenceDigest: snapshotReceiptDigest,
      recoveredAt: "2026-08-09T00:00:00.000Z",
    },
  };
  assert.equal(classifyActiveOwnedDirtCloudRecoveryState({
    plan, source, snapshotReceiptDigest,
  }), "recovered");
  source.claim.recovery.evidenceDigest = "0".repeat(64);
  assert.throws(() => classifyActiveOwnedDirtCloudRecoveryState({
    plan, source, snapshotReceiptDigest,
  }), /neither the exact source/);
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
  const cloud = verifyActiveOwnedDirtCloudRecovery({
    plan,
    result,
    recoveryEvidenceDigest: "8".repeat(64),
  });
  assert.equal(cloud.transitionCounter, plan.sourceCloudTransitionCounter + 1);
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

  result.claim.sessionId = "successor-session";
  assert.throws(() => verifyActiveOwnedDirtCloudRecovery({
    plan,
    result,
    recoveryEvidenceDigest: "8".repeat(64),
  }), /claim identity/);
});

function sourceFixture() {
  const evidence = evidenceFixture("src/runtime.mjs");
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
      claimId: "d".repeat(64),
      claimDigest: "e".repeat(64),
      claimLedgerRevision: "f".repeat(64),
      transitionCounter: 3,
      leaseEpoch: 1,
      deviceId: "device",
      sessionId: "source-session",
      reviewRequestId: "github-pull-request:9",
    },
  };
  const claim = {
    claimId: lease.cloudAuthority.claimId,
    fenceRevision: lease.cloudAuthority.claimDigest,
    transitionDigest: "f".repeat(64),
    transitionCounter: 3,
    leaseEpoch: 1,
    state: "dormant-preserved",
    canonicalBaseRevision: lease.baseSha,
    laneRevision: lease.fenceSha,
    writeSetDigest,
    declaredWriteScope: writeSet,
    reviewRequestId: lease.cloudAuthority.reviewRequestId,
    deviceId: lease.device,
    sessionId: lease.sessionId,
  };
  const expectedMarker = { marker: "source" };
  const pullRequest = {
    state: "OPEN",
    isDraft: true,
    headRefName: lease.branch,
    headRefOid: lease.fenceSha,
    baseRefName: "main",
    baseRefOid: lease.baseSha,
  };
  return {
    sessionId: lease.sessionId,
    branch: lease.branch,
    lease,
    leaseDigest: "1".repeat(64),
    headSha: lease.fenceSha,
    remoteHeadSha: lease.fenceSha,
    remoteMainSha: lease.baseSha,
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

function cloudResult(plan) {
  return {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "continue",
    claimDigest: "6".repeat(64),
    ledgerRevision: "7".repeat(40),
    ledgerDigest: "8".repeat(64),
    receipt: {
      receiptDigest: "9".repeat(64),
      ledgerDigest: "8".repeat(64),
      evaluationTime: "2026-08-09T00:00:00.000Z",
    },
    claim: {
      claimId: plan.sourceClaimId,
      state: "current",
      canonicalBaseRevision: plan.sourceBaseSha,
      laneRevision: plan.sourceFenceSha,
      writeSetDigest: plan.sourceWriteSetDigest,
      declaredWriteScope: plan.sourceDeclaredWriteSet,
      reviewRequestId: plan.sourceReviewRequestId,
      leaseEpoch: 1,
      transitionCounter: plan.sourceCloudTransitionCounter + 1,
      transitionDigest: "a".repeat(64),
      operationReceiptDigest: "b".repeat(64),
      deviceId: plan.sourceDevice,
      sessionId: plan.sourceSessionId,
      expiresAt: "2099-08-09T01:00:00.000Z",
      recovery: { evidenceDigest: "8".repeat(64) },
    },
  };
}
