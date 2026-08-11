import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  advanceRecoverableLaneCleanupIntent,
  authorizeRecoverableLaneCleanup,
  buildRecoverableLaneCleanupPlan,
  buildRecoverableLaneCleanupReceipt,
  createRecoverableLaneCleanupIntent,
  normalizeRecoverableLaneCleanupEvidence,
  normalizeRecoverableLaneCleanupIntent,
  normalizeRecoverableLaneCleanupPlan,
  normalizeRecoverableLaneCleanupReceipt,
  RECOVERABLE_LANE_CLEANUP_EVIDENCE_SCHEMA,
} from "../scripts/recoverable-lane-cleanup-contract.mjs";

test("cleanup plan is deterministic and emits one exact digest authorization", () => {
  const first = plan();
  const second = plan();
  assert.deepEqual(first, second);
  assert.equal(first.exactAuthorization, `authorize recoverable-lane-cleanup ${first.planDigest}`);
  assert.deepEqual(normalizeRecoverableLaneCleanupPlan(first), first);
  assert.deepEqual(first.effects, {
    worktree: "quarantine-then-remove-non-force",
    worktreeSnapshot: "preserve",
    gitDirectorySnapshot: "preserve",
    localBranch: "preserve",
    remoteRefs: "preserve",
    providerObjects: "preserve",
    objectPruning: "forbid",
    globalWorktreePrune: "forbid",
  });
});

test("cleanup authorization rejects missing, approximate, or foreign decisions", () => {
  const cleanupPlan = plan();
  assert.throws(() => authorizeRecoverableLaneCleanup({
    plan: cleanupPlan,
    authorization: `authorize recoverable-lane-cleanup ${"0".repeat(64)}`,
  }), /requires exact authorization/);
  const authorization = authorizeRecoverableLaneCleanup({
    plan: cleanupPlan,
    authorization: cleanupPlan.exactAuthorization,
  });
  assert.equal(authorization.planDigest, cleanupPlan.planDigest);
});

test("cleanup evidence rejects canonical, dirty, current-writer, and operation-state targets", () => {
  assert.throws(() => normalizeRecoverableLaneCleanupEvidence(evidence({
    target: { worktreePath: "/repo", branch: "refs/heads/main" },
  })), /non-main|canonical/);
  assert.throws(() => normalizeRecoverableLaneCleanupEvidence(evidence({
    target: { clean: false },
  })), /clean target/);
  assert.throws(() => normalizeRecoverableLaneCleanupEvidence(evidence({
    target: { operationMarkers: ["MERGE_HEAD"] },
  })), /operation state/);
  assert.throws(() => normalizeRecoverableLaneCleanupEvidence(evidence({
    authority: { currentLocalWriter: true, disposition: "nonterminal" },
  })), /terminal local and remote authority/);
  assert.doesNotThrow(() => normalizeRecoverableLaneCleanupEvidence(evidence({
    authority: { currentLocalWriter: false, disposition: "retired-preserved-terminal" },
  })));
});

test("cleanup evidence and phases reject coerced or open-shaped values", () => {
  assert.throws(() => normalizeRecoverableLaneCleanupEvidence(evidence({
    authority: { currentLocalWriter: "true" },
  })), /boolean/);
  assert.throws(() => normalizeRecoverableLaneCleanupEvidence(evidence({
    target: { unmergedEntries: "0" },
  })), /non-negative integer/);
  const cleanupPlan = plan();
  const authorization = authorizeRecoverableLaneCleanup({
    plan: cleanupPlan, authorization: cleanupPlan.exactAuthorization,
  });
  const intent = createRecoverableLaneCleanupIntent({ plan: cleanupPlan, authorization });
  assert.throws(() => advanceRecoverableLaneCleanupIntent(intent, {
    status: "bundle_verified",
    evidence: {
      bundle: bundle(cleanupPlan), reservation: reservation(),
      quarantineStateDigest: "9".repeat(64), extra: true,
    },
  }), /malformed|incomplete/);
});

test("cleanup plan requires exact preservation supersession and isolated recovery", () => {
  const receiptDigest = "8".repeat(64);
  assert.throws(() => plan({
    evidenceValue: evidence({ preservationReceiptDigests: [receiptDigest] }),
  }), /supersede the exact observed/);
  const accepted = plan({
    evidenceValue: evidence({ preservationReceiptDigests: [receiptDigest] }),
    supersededPreservationDigests: [receiptDigest],
  });
  assert.deepEqual(accepted.supersededPreservationDigests, [receiptDigest]);
  assert.throws(() => plan({ recoveryDirectory: "/repo/recovery" }), /isolated/);
  assert.throws(() => plan({ recoveryDirectory: "/tasks" }), /isolated/);
});

test("intent phases and completion receipt remain digest-bound and ordered", () => {
  const cleanupPlan = plan();
  const authorization = authorizeRecoverableLaneCleanup({
    plan: cleanupPlan,
    authorization: cleanupPlan.exactAuthorization,
  });
  let intent = createRecoverableLaneCleanupIntent({ plan: cleanupPlan, authorization });
  assert.equal(intent.status, "prepared");
  assert.throws(() => advanceRecoverableLaneCleanupIntent(intent, {
    status: "worktree_removed",
    evidence: { removed: true },
  }), /cannot advance/);
  intent = advanceRecoverableLaneCleanupIntent(intent, {
    status: "bundle_verified",
    evidence: {
      bundle: bundle(cleanupPlan), reservation: reservation(),
      quarantineStateDigest: "9".repeat(64),
    },
  });
  intent = advanceRecoverableLaneCleanupIntent(intent, {
    status: "worktree_quarantined",
    evidence: {
      ...artifacts(true),
      disposableGitDirDigest: "8".repeat(64),
      disposableGitDirGenerationDigest: "9".repeat(64),
      removalStateDigest: "a".repeat(64),
    },
  });
  assert.throws(() => advanceRecoverableLaneCleanupIntent(intent, {
    status: "worktree_removed",
    evidence: {
      ...artifacts(false), snapshotDigest: "6".repeat(64),
      replayedAbsentRegistration: false,
    },
  }), /snapshots changed/);
  intent = advanceRecoverableLaneCleanupIntent(intent, {
    status: "worktree_removed",
    evidence: {
      ...artifacts(false), replayedAbsentRegistration: false,
    },
  });
  const released = release(cleanupPlan);
  intent = advanceRecoverableLaneCleanupIntent(intent, {
    status: "reservation_released", evidence: { release: released },
  });
  assert.deepEqual(normalizeRecoverableLaneCleanupIntent(intent), intent);
  const receipt = buildRecoverableLaneCleanupReceipt({
    intent,
    bundle: bundle(cleanupPlan),
    finalObservation: finalObservation(cleanupPlan),
  });
  assert.deepEqual(normalizeRecoverableLaneCleanupReceipt(receipt), receipt);
  const complete = advanceRecoverableLaneCleanupIntent(intent, {
    status: "complete",
    evidence: { receiptDigest: receipt.receiptDigest },
  });
  assert.equal(complete.status, "complete");
});

function plan({
  evidenceValue = evidence(),
  recoveryDirectory = "/recovery/lane-a",
  supersededPreservationDigests = [],
} = {}) {
  return buildRecoverableLaneCleanupPlan({
    evidence: evidenceValue,
    recoveryDirectory,
    sessionId: "session-cleanup",
    operatorDecisionDigest: "7".repeat(64),
    supersededPreservationDigests,
  });
}

function evidence({ target = {}, authority = {}, preservationReceiptDigests = [] } = {}) {
  const authorityCore = {
    lifecycleState: "review-required",
    leaseStatus: null,
    currentLocalWriter: false,
    disposition: "unowned-terminal",
    priorLease: null,
    priorLeaseDigest: null,
    preservationReceiptDigests,
    remoteAuthority: remoteAuthority(),
    ...authority,
  };
  const core = {
    schema: RECOVERABLE_LANE_CLEANUP_EVIDENCE_SCHEMA,
    repository: {
      root: "/repo",
      gitCommonDir: "/repo/.git",
      identityDigest: "1".repeat(64),
    },
    canonical: {
      worktreePath: "/repo",
      headSha: "a".repeat(40),
      treeSha: "b".repeat(40),
      originMainSha: "a".repeat(40),
      remoteMainSha: "a".repeat(40),
      clean: true,
    },
    target: {
      worktreePath: "/tasks/lane-a",
      branch: "refs/heads/agent/device/lane-a",
      headSha: "c".repeat(40),
      branchHeadSha: "c".repeat(40),
      treeSha: "d".repeat(40),
      worktreeGenerationDigest: "3".repeat(64),
      gitDir: "/repo/.git/worktrees/lane-a",
      gitDirIdentityDigest: "4".repeat(64),
      gitDirGenerationDigest: "5".repeat(64),
      clean: true,
      unmergedEntries: 0,
      operationMarkers: [],
      stateDigest: "2".repeat(64),
      ...target,
    },
    authority: {
      ...authorityCore,
      authorityDigest: digestValue(authorityCore),
    },
    remoteBranch: {
      ref: target.branch || "refs/heads/agent/device/lane-a",
      sha: "c".repeat(40),
    },
  };
  return { ...core, evidenceDigest: digestValue(core) };
}

function bundle(cleanupPlan) {
  return {
    path: cleanupPlan.recovery.bundlePath,
    sha256: "3".repeat(64),
    sizeBytes: 42,
    headSha: cleanupPlan.evidence.target.headSha,
    treeSha: cleanupPlan.evidence.target.treeSha,
    headRef: cleanupPlan.evidence.target.branch,
    complete: true,
  };
}

function finalObservation(cleanupPlan) {
  return {
    ...artifacts(false),
    priorLeaseRestored: true,
    canonicalHeadSha: cleanupPlan.evidence.canonical.headSha,
    branchHeadSha: cleanupPlan.evidence.target.branchHeadSha,
    remoteBranchSha: cleanupPlan.evidence.remoteBranch.sha,
  };
}

function artifacts(disposable) {
  return {
    targetRegistered: false, targetExists: false,
    stagingRegistered: disposable, stagingExists: false,
    snapshotExists: true, snapshotDigest: "5".repeat(64),
    snapshotGenerationDigest: "6".repeat(64),
    gitDirSnapshotExists: true, gitDirSnapshotDigest: "7".repeat(64),
    gitDirSnapshotGenerationDigest: "8".repeat(64),
    disposableGitDirExists: disposable,
  };
}

function reservation() {
  return {
    schema: "agentic-recoverable-lane-cleanup-reservation/v1",
    branch: "agent/device/lane-a", epoch: 1, sessionId: "cleanup-session",
    reservationDigest: "9".repeat(64),
  };
}

function release(cleanupPlan) {
  const core = {
    schema: "agentic-recoverable-lane-cleanup-reservation-release/v1",
    planDigest: cleanupPlan.planDigest, priorLeaseDigest: null,
  };
  return { ...core, receiptDigest: digestValue(core) };
}

function remoteAuthority() {
  const core = {
    provider: "neutral-test", ledgerRepository: "owner/repo",
    targetRepository: "owner/repo", targetClaims: [],
    currentRemoteWriter: false, waitingSuccessors: 0,
  };
  return { ...core, verificationReceiptDigest: digestValue(core) };
}
