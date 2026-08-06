import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createWriterLeaseStore,
  EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_SCHEMA,
  PRE_PUSHED_PREFIX_EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_SCHEMA,
  parseDeviceBranch,
  parseWriterLeasePullRequestBody,
  renderWriterLeasePullRequestBody,
  updateWriterLeasePullRequestBody,
} from "../scripts/writer-lease-lib.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { OWNED_DIRT_RECOVERY_SCHEMA } from "../scripts/owned-dirt-resume-lib.mjs";

test("device branch identity separates device from semantic scope", () => {
  assert.deepEqual(parseDeviceBranch("agent/mac-a/rich-media"), {
    branch: "agent/mac-a/rich-media",
    device: "mac-a",
    scope: "rich-media",
  });
  assert.deepEqual(parseDeviceBranch("agent/katrinas-macbook-pro.local/rich-media"), {
    branch: "agent/katrinas-macbook-pro.local/rich-media",
    device: "katrinas-macbook-pro.local",
    scope: "rich-media",
  });
  assert.deepEqual(parseDeviceBranch("agent/build_host/rich-media"), {
    branch: "agent/build_host/rich-media",
    device: "build_host",
    scope: "rich-media",
  });
  assert.equal(parseDeviceBranch("main"), null);
  assert.equal(parseDeviceBranch("agent/.local/rich-media"), null);
  assert.equal(parseDeviceBranch("agent/mac-a/rich_media"), null);
  assert.equal(parseDeviceBranch("agent/mac-a/rich.media"), null);
});

test("writer lease registry isolates worktrees, increments fencing epochs, and supports heartbeat", () => {
  const gitCommonDir = mkdtempSync(path.join(os.tmpdir(), "agentic-writer-lease-"));
  let instant = new Date("2026-07-17T10:00:00.000Z");
  const store = createWriterLeaseStore({ gitCommonDir, now: () => instant });
  const input = {
    sessionId: "chat-a",
    device: "mac-a",
    scope: "runtime-leases",
    branch: "agent/mac-a/runtime-leases",
    worktreePath: "/worktrees/runtime-leases",
    baseSha: "a".repeat(40),
    ttlMs: 60_000,
  };

  try {
    const first = store.claim(input);
    assert.equal(first.epoch, 1);
    assert.throws(() => store.claim({ ...input, sessionId: "chat-b" }), /leased to another session/);
    const parallel = store.claim({
      ...input,
      sessionId: "chat-b",
      scope: "camera-controls",
      branch: "agent/mac-a/camera-controls",
      worktreePath: "/worktrees/camera-controls",
    });
    assert.equal(parallel.epoch, 2);
    assert.equal(store.readRegistry().leases[parallel.branch].worktreePath, "/worktrees/camera-controls");
    assert.throws(() => store.claim({
      ...input,
      sessionId: "chat-c",
      scope: "other-scope",
      branch: "agent/mac-a/other-scope",
    }), /Worktree .* is leased to another session/);

    instant = new Date("2026-07-17T10:00:30.000Z");
    const renewed = store.heartbeat({ sessionId: "chat-a", branch: input.branch, ttlMs: 120_000 });
    assert.equal(renewed.expiresAt, "2026-07-17T10:02:30.000Z");

    instant = new Date("2026-07-17T10:03:00.000Z");
    const takeover = store.claim({ ...input, sessionId: "chat-b" });
    assert.equal(takeover.epoch, 3);
    assert.throws(() => store.verify({ sessionId: "chat-a", branch: input.branch }), /belongs to another session/);
  } finally {
    rmSync(gitCommonDir, { recursive: true, force: true });
  }
});

test("writer lease rejects branch metadata that disagrees with its parsed identity", () => {
  const gitCommonDir = mkdtempSync(path.join(os.tmpdir(), "agentic-writer-lease-"));
  const store = createWriterLeaseStore({ gitCommonDir });
  try {
    assert.throws(() => store.claim({
      sessionId: "chat-a",
      device: "mac-a",
      scope: "runtime-leases",
      branch: "agent/mac-b/runtime-leases",
      worktreePath: "/worktrees/runtime-leases",
      baseSha: "a".repeat(40),
    }), /must match its branch identity/);
  } finally {
    rmSync(gitCommonDir, { recursive: true, force: true });
  }
});

test("failed remote claim publication restores only the exact previous local lease", () => {
  const gitCommonDir = mkdtempSync(path.join(os.tmpdir(), "agentic-writer-lease-"));
  const store = createWriterLeaseStore({ gitCommonDir });
  const input = {
    sessionId: "chat-a", device: "mac-a", scope: "runtime-leases",
    branch: "agent/mac-a/runtime-leases", worktreePath: "/worktrees/runtime-leases",
    baseSha: "a".repeat(40),
  };
  try {
    store.claim(input);
    store.annotate({ sessionId: input.sessionId, branch: input.branch, values: { fenceSha: "b".repeat(40) } });
    const previousLease = store.release({ sessionId: input.sessionId, branch: input.branch, status: "parked" });
    const claimed = store.claim({ ...input, previousEpoch: previousLease.epoch });
    const active = store.annotate({ sessionId: input.sessionId, branch: input.branch, values: { fenceSha: "c".repeat(40) } });
    assert.throws(() => store.rollbackClaim({
      sessionId: input.sessionId, branch: input.branch, epoch: claimed.epoch,
      fenceSha: "d".repeat(40), previousLease,
    }), /changed before rollback/);
    store.rollbackClaim({
      sessionId: input.sessionId, branch: input.branch, epoch: claimed.epoch,
      fenceSha: active.fenceSha, previousLease,
    });
    assert.deepEqual(store.read(input.branch), previousLease);
  } finally {
    rmSync(gitCommonDir, { recursive: true, force: true });
  }
});

test("park release refuses a lease snapshot changed after PR projection", () => {
  const gitCommonDir = mkdtempSync(path.join(os.tmpdir(), "agentic-writer-lease-"));
  let instant = new Date("2026-07-22T00:00:00.000Z");
  const store = createWriterLeaseStore({ gitCommonDir, now: () => instant });
  const branch = "agent/mac-a/runtime-leases";
  try {
    const claimed = store.claim({
      sessionId: "chat-a",
      device: "mac-a",
      scope: "runtime-leases",
      branch,
      worktreePath: "/worktrees/runtime-leases",
      baseSha: "a".repeat(40),
    });
    const projectedFrom = store.annotate({
      sessionId: "chat-a",
      branch,
      values: { fenceSha: "b".repeat(40), pullRequestUrl: "https://github.test/pull/42" },
    });
    assert.equal(projectedFrom.epoch, claimed.epoch);
    instant = new Date("2026-07-22T00:01:00.000Z");
    store.heartbeat({ sessionId: "chat-a", branch });
    assert.throws(() => store.release({
      sessionId: "chat-a",
      branch,
      status: "parked",
      expectedLease: projectedFrom,
      timestamp: "2026-07-22T00:02:00.000Z",
    }), /changed before parked/);
    assert.equal(store.read(branch).status, "active");
  } finally {
    rmSync(gitCommonDir, { recursive: true, force: true });
  }
});

test("review-ready projection refresh can rebind the same preserved lease", () => {
  const gitCommonDir = mkdtempSync(path.join(os.tmpdir(), "agentic-writer-lease-"));
  const store = createWriterLeaseStore({ gitCommonDir });
  const branch = "agent/mac-a/runtime-leases";
  try {
    store.claim({
      sessionId: "chat-a",
      device: "mac-a",
      scope: "runtime-leases",
      branch,
      worktreePath: "/worktrees/runtime-leases",
      baseSha: "a".repeat(40),
    });
    store.annotate({
      sessionId: "chat-a",
      branch,
      values: { fenceSha: "b".repeat(40), pullRequestUrl: "https://github.com/example/repo/pull/42" },
    });
    const ready = store.release({
      sessionId: "chat-a",
      branch,
      status: "review_ready",
      values: { reviewHeadSha: "c".repeat(40) },
    });

    const rebound = store.release({
      sessionId: "chat-a",
      branch,
      status: "review_ready",
      expectedLease: ready,
      values: {
        epoch: 2,
        cloudAuthority: { claimId: "d".repeat(64) },
      },
    });

    assert.equal(rebound.status, "review_ready");
    assert.equal(rebound.epoch, 2);
    assert.equal(rebound.reviewHeadSha, "c".repeat(40));
    assert.equal(rebound.cloudAuthority.claimId, "d".repeat(64));
  } finally {
    rmSync(gitCommonDir, { recursive: true, force: true });
  }
});

test("pull request metadata round-trips the current fencing identity", () => {
  const lease = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 4,
    sessionId: "chat-a",
    device: "mac-a",
    scope: "runtime-leases",
    branch: "agent/mac-a/runtime-leases",
    worktreePath: "/worktrees/runtime-leases",
    baseSha: "a".repeat(40),
    fenceSha: "b".repeat(40),
    heartbeatAt: "2026-07-17T10:00:00.000Z",
    expiresAt: "2026-07-17T10:30:00.000Z",
  };
  const body = renderWriterLeasePullRequestBody(lease);
  const parsed = parseWriterLeasePullRequestBody(body);
  assert.deepEqual(parsed, {
    schema: lease.schema,
    status: lease.status,
    epoch: lease.epoch,
    sessionId: lease.sessionId,
    device: lease.device,
    scope: lease.scope,
    branch: lease.branch,
    baseSha: lease.baseSha,
    fenceSha: lease.fenceSha,
    autoDelivery: false,
    runtimeRequired: false,
    heartbeatAt: lease.heartbeatAt,
    expiresAt: lease.expiresAt,
  });
  assert.match(body, /^---\naction: \/change\nscope: "#runtime-leases"\nactor: "@mac-a"\nbase_sha: "a{40}"\n---\n/);
  assert.doesNotMatch(body, /worktrees\/runtime-leases/);
});

test("writer lease updates replace only the hidden marker and preserve handoff context", () => {
  const active = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 1,
    sessionId: "session-a",
    device: "device",
    scope: "scope",
    branch: "agent/device/scope",
    baseSha: "a".repeat(40),
    fenceSha: "b".repeat(40),
    heartbeatAt: "2026-07-22T00:00:00.000Z",
    expiresAt: "2026-07-22T00:30:00.000Z",
  };
  const original = `## Work item\n\nAcceptance and evidence.\n\n${renderWriterLeasePullRequestBody(active)}`;
  const updated = updateWriterLeasePullRequestBody(original, { ...active, epoch: 2 });
  assert.match(updated, /Acceptance and evidence/);
  assert.equal((updated.match(/<!-- agentic-writer-lease\/v2/g) || []).length, 1);
  assert.equal(parseWriterLeasePullRequestBody(updated).epoch, 2);
});

test("writer lease marker round-trips exact owned-dirt recovery evidence", () => {
  const recovery = {
    schema: OWNED_DIRT_RECOVERY_SCHEMA,
    sourceEpoch: 9,
    sourceSessionId: "session-a",
    reviewHeadSha: "c".repeat(40),
    evidenceDigest: "d".repeat(64),
    pathCount: 85,
  };
  const lease = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 10,
    sessionId: "session-a",
    device: "mac-a",
    scope: "runtime-leases",
    branch: "agent/mac-a/runtime-leases",
    baseSha: recovery.reviewHeadSha,
    fenceSha: "e".repeat(40),
    ownedDirtRecovery: recovery,
    heartbeatAt: "2026-07-30T00:00:00.000Z",
    expiresAt: "2026-07-30T00:30:00.000Z",
  };

  assert.deepEqual(
    parseWriterLeasePullRequestBody(renderWriterLeasePullRequestBody(lease)).ownedDirtRecovery,
    recovery,
  );
  const malformed = renderWriterLeasePullRequestBody(lease)
    .replace(recovery.evidenceDigest, "invalid");
  assert.equal(parseWriterLeasePullRequestBody(malformed), null);
});

test("expired committed heartbeat atomically preserves epoch and replaces only cloud and lease timing", () => {
  const gitCommonDir = mkdtempSync(path.join(os.tmpdir(), "agentic-expired-heartbeat-"));
  let instant = new Date("2026-08-04T10:00:00.000Z");
  const store = createWriterLeaseStore({ gitCommonDir, now: () => instant });
  const branch = "agent/mac-a/expired-heartbeat";
  const baseSha = "a".repeat(40);
  const fenceSha = "b".repeat(40);
  const headSha = "c".repeat(40);
  const declaredWriteSet = ["path:scripts/recovery.mjs", "semantic:expired-heartbeat"];
  const writeSetDigest = digestValue(declaredWriteSet);
  const admission = {
    schema: "agentic-lane-admission-lease/v1",
    status: "admitted",
    semanticScope: "expired-heartbeat",
    declaredWriteSet,
    writeSetDigest,
    manifestDigest: "1".repeat(64),
    planReceiptDigest: "2".repeat(64),
    admissionReceiptDigest: "3".repeat(64),
    existingLaneStateDigest: "4".repeat(64),
    admittedReportDigest: "5".repeat(64),
    preservationReceiptDigest: "6".repeat(64),
  };
  const cloudAuthority = {
    schema: "agentic-lane-cloud-authority/v1",
    provider: "github",
    ledgerRepository: "org/ledger",
    targetRepository: "org/repo",
    claimId: "7".repeat(64),
    claimDigest: "8".repeat(64),
    ledgerRevision: "9".repeat(40),
    claimLedgerRevision: "a".repeat(64),
    canonicalBaseSha: baseSha,
    laneRevision: fenceSha,
    cloudDeclaredWriteScope: declaredWriteSet,
    writeSetDigest,
    deviceId: "mac-a",
    sessionId: "session-a",
    reviewRequestId: "github-pull-request:81",
    leaseEpoch: 1,
    transitionCounter: 2,
    state: "active",
    manifestDigest: "1".repeat(64),
    expiresAt: "2026-08-04T12:00:00.000Z",
  };
  try {
    store.claim({
      sessionId: "session-a",
      device: "mac-a",
      scope: "expired-heartbeat",
      branch,
      worktreePath: "/worktrees/expired-heartbeat",
      baseSha,
      admission,
      cloudAuthority,
      ttlMs: 60_000,
    });
    const source = store.annotate({
      sessionId: "session-a",
      branch,
      values: {
        fenceSha,
        pullRequestUrl: "https://github.com/org/repo/pull/81",
      },
    });
    const renewedCloudAuthority = {
      ...cloudAuthority,
      transitionCounter: cloudAuthority.transitionCounter + 1,
      ledgerRevision: "d".repeat(40),
      claimLedgerRevision: "e".repeat(64),
      expiresAt: "2026-08-04T13:00:00.000Z",
    };
    const evidence = recoveryEvidence({ source, headSha });

    assert.throws(() => store.recoverExpiredCommittedHeartbeat({
      sessionId: "session-a",
      branch,
      expectedLease: source,
      renewedCloudAuthority,
      recoveryEvidence: evidence,
      ttlMs: 1_800_000,
      recoveredAt: "2026-08-04T10:02:00.000Z",
    }), /requires an expired/);

    instant = new Date("2026-08-04T10:02:00.000Z");
    assert.throws(() => store.recoverExpiredCommittedHeartbeat({
      sessionId: "session-a",
      branch,
      expectedLease: source,
      renewedCloudAuthority: {
        ...renewedCloudAuthority,
        transitionCounter: cloudAuthority.transitionCounter,
      },
      recoveryEvidence: evidence,
      ttlMs: 1_800_000,
      recoveredAt: "2026-08-04T10:02:00.000Z",
    }), /changed the expired lease claim subject/);
    assert.throws(() => store.recoverExpiredCommittedHeartbeat({
      sessionId: "session-a",
      branch,
      expectedLease: source,
      renewedCloudAuthority: {
        ...renewedCloudAuthority,
        transitionCounter: cloudAuthority.transitionCounter + 2,
      },
      recoveryEvidence: evidence,
      ttlMs: 1_800_000,
      recoveredAt: "2026-08-04T10:02:00.000Z",
    }), /changed the expired lease claim subject/);
    assert.throws(() => store.recoverExpiredCommittedHeartbeat({
      sessionId: "session-a",
      branch,
      expectedLease: { ...source, epoch: source.epoch + 1 },
      renewedCloudAuthority,
      recoveryEvidence: evidence,
      ttlMs: 1_800_000,
      recoveredAt: "2026-08-04T10:02:00.000Z",
    }), /changed before expired committed recovery/);

    const revisionBefore = store.readRegistry().revision;
    const recovered = store.recoverExpiredCommittedHeartbeat({
      sessionId: "session-a",
      branch,
      expectedLease: source,
      renewedCloudAuthority,
      recoveryEvidence: evidence,
      ttlMs: 1_800_000,
      recoveredAt: "2026-08-04T10:02:00.000Z",
    });
    assert.equal(store.readRegistry().revision, revisionBefore + 1);
    assert.equal(recovered.epoch, source.epoch);
    assert.equal(recovered.fenceSha, source.fenceSha);
    assert.equal(recovered.pullRequestUrl, source.pullRequestUrl);
    assert.equal(recovered.cloudAuthority.claimId, source.cloudAuthority.claimId);
    assert.equal(recovered.cloudAuthority.ledgerRevision, renewedCloudAuthority.ledgerRevision);
    assert.equal(recovered.heartbeatAt, "2026-08-04T10:02:00.000Z");
    assert.equal(recovered.expiresAt, "2026-08-04T10:32:00.000Z");
    assert.equal(recovered.expiredCommittedHeartbeatRecovery.schema,
      EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_SCHEMA);
    assert.deepEqual(parseWriterLeasePullRequestBody(
      renderWriterLeasePullRequestBody(recovered),
    ).expiredCommittedHeartbeatRecovery, recovered.expiredCommittedHeartbeatRecovery);
    const {
      sourceRemoteHeadSha: _sourceRemoteHeadSha,
      sourceRemoteTreeSha: _sourceRemoteTreeSha,
      sourceRemoteChangedPathCount: _sourceRemoteChangedPathCount,
      sourceRemoteChangedPathsDigest: _sourceRemoteChangedPathsDigest,
      sourceRemoteDeclaredChangedPathCount:
        _sourceRemoteDeclaredChangedPathCount,
      sourceRemoteDeclaredChangedPathsDigest:
        _sourceRemoteDeclaredChangedPathsDigest,
      sourceRemoteProtectedEquivalentPathCount:
        _sourceRemoteProtectedEquivalentPathCount,
      sourceRemoteProtectedEquivalentPathsDigest:
        _sourceRemoteProtectedEquivalentPathsDigest,
      sourceRemoteProtectedMainEquivalence:
        _sourceRemoteProtectedMainEquivalence,
      sourceRemoteProtectedMainEquivalenceDigest:
        _sourceRemoteProtectedMainEquivalenceDigest,
      sourceRemoteRangeDiffDigest: _sourceRemoteRangeDiffDigest,
      ...prePushedPrefixRecovery
    } = recovered.expiredCommittedHeartbeatRecovery;
    const v2Recovery = {
      ...prePushedPrefixRecovery,
      schema:
        PRE_PUSHED_PREFIX_EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_SCHEMA,
    };
    const v2Lease = {
      ...recovered,
      expiredCommittedHeartbeatRecovery: v2Recovery,
    };
    assert.deepEqual(parseWriterLeasePullRequestBody(
      renderWriterLeasePullRequestBody(v2Lease),
    ).expiredCommittedHeartbeatRecovery, v2Recovery);
    assert.equal(parseWriterLeasePullRequestBody(
      renderWriterLeasePullRequestBody(v2Lease).replace(
        '"sourcePullRequestUrl":',
        `"sourceRemoteHeadSha":"${source.fenceSha}","sourcePullRequestUrl":`,
      ),
    ), null);
    assert.equal(parseWriterLeasePullRequestBody(
      renderWriterLeasePullRequestBody(recovered).replace(
        `"sourceRemoteHeadSha":"${source.fenceSha}",`,
        "",
      ),
    ), null);
    const markerBody = renderWriterLeasePullRequestBody(recovered);
    assert.doesNotMatch(markerBody, /worktreePathDigest|sourceLeaseDigest|changedPaths"|snapshotDigest/);
    assert.match(markerBody, /changedPathCount|changedPathsDigest/);
    assert.equal(parseWriterLeasePullRequestBody(markerBody.replace(
      '"recoveredAt":',
      `"worktreePathDigest":"${"0".repeat(64)}","recoveredAt":`,
    )), null);
  } finally {
    rmSync(gitCommonDir, { recursive: true, force: true });
  }
});

test("merged completion uses an explicit cleanup intent before the final fence", () => {
  const gitCommonDir = mkdtempSync(path.join(os.tmpdir(), "agentic-writer-lease-"));
  const store = createWriterLeaseStore({ gitCommonDir });
  const branch = "agent/mac-a/runtime-leases";
  try {
    store.claim({
      sessionId: "chat-a",
      device: "mac-a",
      scope: "runtime-leases",
      branch,
      worktreePath: "/worktrees/runtime-leases",
      baseSha: "a".repeat(40),
    });
    store.annotate({ sessionId: "chat-a", branch, values: {
      fenceSha: "b".repeat(40),
      pullRequestUrl: "https://github.com/example/repo/pull/42",
    } });
    const completing = store.beginCompletion({
      branch,
      pullRequestUrl: "https://github.com/example/repo/pull/42",
      mergeCommitSha: "c".repeat(40),
      mainSha: "d".repeat(40),
    });
    assert.equal(completing.status, "completing");
    assert.throws(() => store.verify({ sessionId: "chat-a", branch }), /No active writer lease/);
    assert.throws(() => store.claim({
      sessionId: "chat-a", device: "mac-a", scope: "runtime-leases", branch,
      worktreePath: "/worktrees/runtime-leases", baseSha: "a".repeat(40),
    }), /completing merged cleanup/);
    const completed = store.complete({
      branch,
      pullRequestUrl: "https://github.com/example/repo/pull/42",
      mergeCommitSha: "c".repeat(40),
      mainSha: "d".repeat(40),
    });
    assert.equal(completed.status, "completed");
    assert.deepEqual(completed.completion, {
      mergeCommitSha: "c".repeat(40),
      mainSha: "d".repeat(40),
    });
    assert.deepEqual(store.complete({
      branch,
      pullRequestUrl: "https://github.com/example/repo/pull/42",
      mergeCommitSha: "c".repeat(40),
      mainSha: "d".repeat(40),
    }), completed);
  } finally {
    rmSync(gitCommonDir, { recursive: true, force: true });
  }
});

test("merged pull request recovery can synthesize a completed lease when no marker remains", () => {
  const gitCommonDir = mkdtempSync(path.join(os.tmpdir(), "agentic-writer-lease-"));
  const store = createWriterLeaseStore({ gitCommonDir });
  const branch = "agent/mac-a/runtime-leases";
  try {
    const recovered = store.recoverMergedPullRequestCompletion({
      branch,
      worktreePath: "/worktrees/runtime-leases",
      pullRequestUrl: "https://github.com/example/repo/pull/42",
      mergeCommitSha: "c".repeat(40),
      mainSha: "d".repeat(40),
      headSha: "e".repeat(40),
    });
    assert.equal(recovered.status, "completed");
    assert.equal(recovered.branch, branch);
    assert.equal(recovered.device, "mac-a");
    assert.equal(recovered.scope, "runtime-leases");
    assert.equal(recovered.pullRequestUrl, "https://github.com/example/repo/pull/42");
    assert.equal(recovered.baseSha, "d".repeat(40));
    assert.equal(recovered.fenceSha, "e".repeat(40));
    assert.equal(recovered.reviewHeadSha, "e".repeat(40));
    assert.match(recovered.sessionId, /^recovered-merged-pr:/);
    assert.deepEqual(recovered.completion, {
      mergeCommitSha: "c".repeat(40),
      mainSha: "d".repeat(40),
    });
    assert.deepEqual(store.read(branch), recovered);
    assert.deepEqual(store.recoverMergedPullRequestCompletion({
      branch,
      worktreePath: "/worktrees/runtime-leases",
      pullRequestUrl: "https://github.com/example/repo/pull/42",
      mergeCommitSha: "c".repeat(40),
      mainSha: "d".repeat(40),
      headSha: "e".repeat(40),
    }), recovered);
  } finally {
    rmSync(gitCommonDir, { recursive: true, force: true });
  }
});

test("writer lease marker recovery distinguishes invalid markers from absent markers", () => {
  const gitCommonDir = mkdtempSync(path.join(os.tmpdir(), "agentic-writer-lease-"));
  const store = createWriterLeaseStore({ gitCommonDir });
  const branch = "agent/mac-a/runtime-leases";
  try {
    assert.throws(() => store.recoverFromPullRequestMarker({
      branch,
      worktreePath: "/worktrees/runtime-leases",
      pullRequestUrl: "https://github.com/example/repo/pull/42",
      pullRequestBody: "<!-- agentic-writer-lease/v2 {\"schema\":\"agentic-writer-lease/v2\",\"branch\":\"agent/mac-a/runtime-leases\"} -->",
    }), /present but invalid/);
    assert.throws(() => store.recoverFromPullRequestMarker({
      branch,
      worktreePath: "/worktrees/runtime-leases",
      pullRequestUrl: "https://github.com/example/repo/pull/42",
      pullRequestBody: "",
    }), /No recoverable writer lease marker records/);
  } finally {
    rmSync(gitCommonDir, { recursive: true, force: true });
  }
});

function recoveryEvidence({ source, headSha }) {
  const declaredChangedPaths = ["scripts/recovery.mjs"];
  const protectedEquivalentPaths = [];
  const sourceRemoteProtectedMainEquivalence = {
    schema: "agentic-protected-main-path-equivalence/v1",
    baseSha: source.baseSha,
    headSha: source.fenceSha,
    headTreeSha: "7".repeat(40),
    protectedMainRef: "refs/remotes/origin/main",
    protectedMainSha: "5".repeat(40),
    protectedMainTreeSha: "6".repeat(40),
    exemptPathCount: 0,
    entries: [],
    exemptPathsDigest: digestValue(protectedEquivalentPaths),
  };
  const protectedMainEquivalence = {
    schema: "agentic-protected-main-path-equivalence/v1", baseSha: source.baseSha,
    headSha, headTreeSha: "f".repeat(40),
    protectedMainRef: "refs/remotes/origin/main", protectedMainSha: "5".repeat(40),
    protectedMainTreeSha: "6".repeat(40),
    exemptPathCount: 0, entries: [],
    exemptPathsDigest: digestValue(protectedEquivalentPaths),
  };
  return {
    sourceEpoch: source.epoch, sourceSessionId: source.sessionId,
    sourceDevice: source.device, sourceScope: source.scope,
    sourceBranch: source.branch, sourceBaseSha: source.baseSha,
    sourceFenceSha: source.fenceSha, sourceRemoteHeadSha: source.fenceSha,
    sourceRemoteTreeSha: "7".repeat(40),
    sourceRemoteChangedPathCount: 0,
    sourceRemoteChangedPathsDigest: digestValue([]),
    sourceRemoteDeclaredChangedPathCount: 0,
    sourceRemoteDeclaredChangedPathsDigest: digestValue([]),
    sourceRemoteProtectedEquivalentPathCount: 0,
    sourceRemoteProtectedEquivalentPathsDigest: digestValue([]),
    sourceRemoteProtectedMainEquivalence,
    sourceRemoteProtectedMainEquivalenceDigest:
      digestValue(sourceRemoteProtectedMainEquivalence),
    sourceRemoteRangeDiffDigest: "8".repeat(64),
    sourcePullRequestUrl: source.pullRequestUrl,
    sourceClaimId: source.cloudAuthority.claimId, sourceClaimDigest: source.cloudAuthority.claimDigest,
    sourceLedgerRevision: source.cloudAuthority.ledgerRevision,
    sourceClaimLedgerRevision: source.cloudAuthority.claimLedgerRevision,
    sourceCloudTransitionCounter: source.cloudAuthority.transitionCounter,
    headSha, treeSha: "f".repeat(40), changedPathCount: 1,
    changedPathsDigest: digestValue(declaredChangedPaths),
    declaredChangedPathCount: declaredChangedPaths.length,
    declaredChangedPathsDigest: digestValue(declaredChangedPaths),
    protectedEquivalentPathCount: protectedEquivalentPaths.length,
    protectedEquivalentPathsDigest: digestValue(protectedEquivalentPaths),
    protectedMainEquivalence, sourceMarkerDigest: "2".repeat(64),
    protectedMainEquivalenceDigest: digestValue(protectedMainEquivalence),
    pullRequestBodyDigest: "3".repeat(64), rangeDiffDigest: "4".repeat(64),
  };
}
