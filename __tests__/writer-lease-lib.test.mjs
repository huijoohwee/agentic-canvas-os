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
  assert.equal(parseDeviceBranch("main"), null);
});

test("writer lease serializes chats, increments fencing epochs, and supports heartbeat", () => {
  const gitCommonDir = mkdtempSync(path.join(os.tmpdir(), "agentic-writer-lease-"));
  let instant = new Date("2026-07-17T10:00:00.000Z");
  const store = createWriterLeaseStore({ gitCommonDir, now: () => instant });
  const input = {
    sessionId: "chat-a",
    device: "mac-a",
    scope: "runtime-leases",
    branch: "agent/mac-a/runtime-leases",
    baseSha: "a".repeat(40),
    ttlMs: 60_000,
  };

  try {
    const first = store.claim(input);
    assert.equal(first.epoch, 1);
    assert.throws(() => store.claim({ ...input, sessionId: "chat-b" }), /leased to another session/);

    instant = new Date("2026-07-17T10:00:30.000Z");
    const renewed = store.heartbeat({ sessionId: "chat-a", branch: input.branch, ttlMs: 120_000 });
    assert.equal(renewed.expiresAt, "2026-07-17T10:02:30.000Z");

    instant = new Date("2026-07-17T10:03:00.000Z");
    const takeover = store.claim({ ...input, sessionId: "chat-b" });
    assert.equal(takeover.epoch, 2);
    assert.throws(() => store.verify({ sessionId: "chat-a", branch: input.branch }), /belongs to another session/);
  } finally {
    rmSync(gitCommonDir, { recursive: true, force: true });
  }
});

test("pull request metadata round-trips the current fencing identity", () => {
  const lease = {
    schema: "agentic-writer-lease/v1",
    status: "active",
    epoch: 4,
    sessionId: "chat-a",
    device: "mac-a",
    scope: "runtime-leases",
    branch: "agent/mac-a/runtime-leases",
    baseSha: "a".repeat(40),
    fenceSha: "b".repeat(40),
    heartbeatAt: "2026-07-17T10:00:00.000Z",
    expiresAt: "2026-07-17T10:30:00.000Z",
  };
  assert.deepEqual(parseWriterLeasePullRequestBody(renderWriterLeasePullRequestBody(lease)), lease);
});
