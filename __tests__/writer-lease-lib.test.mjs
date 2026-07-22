import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createWriterLeaseStore,
  parseDeviceBranch,
  parseWriterLeasePullRequestBody,
  renderWriterLeasePullRequestBody,
  updateWriterLeasePullRequestBody,
} from "../scripts/writer-lease-lib.mjs";

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
