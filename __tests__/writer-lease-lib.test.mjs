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
