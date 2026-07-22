import test from "node:test";
import assert from "node:assert/strict";

import {
  createDeviceCommandError,
  createDeviceCommandResult,
  DEVICE_COMMAND_RESULT_SCHEMA,
} from "../scripts/device-command-result.mjs";

const lease = {
  schema: "agentic-writer-lease/v2",
  status: "active",
  epoch: 12,
  sessionId: "session-a",
  device: "device.local",
  scope: "managed-run",
  branch: "agent/device.local/managed-run",
  worktreePath: "/workspace/task",
  baseSha: "a".repeat(40),
  fenceSha: "b".repeat(40),
  pullRequestUrl: "https://github.example/org/repo/pull/42",
  acquiredAt: "2026-07-22T00:00:00.000Z",
  heartbeatAt: "2026-07-22T00:01:00.000Z",
  expiresAt: "2026-07-22T00:31:00.000Z",
  ignored: "not part of the machine contract",
};

test("device command results project stable lease and pull-request evidence", () => {
  const result = createDeviceCommandResult({
    action: "start",
    repoRoot: "/workspace/task",
    worktreePath: "/workspace/task",
    branch: lease.branch,
    lease,
    result: lease.branch,
  });

  assert.equal(result.schema, DEVICE_COMMAND_RESULT_SCHEMA);
  assert.equal(result.ok, true);
  assert.equal(result.status, "active");
  assert.deepEqual(result.pullRequest, {
    url: lease.pullRequestUrl,
    number: 42,
  });
  assert.equal(result.lease.epoch, 12);
  assert.equal(result.lease.fenceSha, "b".repeat(40));
  assert.equal("ignored" in result.lease, false);
});

test("park results retain deterministic detached-worktree evidence", () => {
  const result = createDeviceCommandResult({
    action: "park",
    repoRoot: "/workspace/task",
    worktreePath: "/workspace/task",
    result: { branch: "agent/device/scope", headSha: "c".repeat(40), stashRef: null },
  });

  assert.equal(result.status, "detached");
  assert.equal(result.branch, "agent/device/scope");
  assert.equal(result.headSha, "c".repeat(40));
  assert.equal(result.stashRef, null);
  assert.equal(result.lease, null);
});

test("device command failures are typed without exposing a stack", () => {
  const result = createDeviceCommandError({
    action: "heartbeat",
    repoRoot: "/workspace/task",
    worktreePath: "/workspace/task",
    error: new Error("lease expired"),
  });

  assert.deepEqual(result, {
    schema: DEVICE_COMMAND_RESULT_SCHEMA,
    ok: false,
    action: "heartbeat",
    status: "error",
    repoRoot: "/workspace/task",
    worktreePath: "/workspace/task",
    error: { code: "device_command_failed", message: "lease expired" },
  });
});

test("every managed lifecycle action preserves its authoritative branch and lease status", () => {
  for (const [action, status] of [
    ["start", "active"],
    ["resume", "active"],
    ["heartbeat", "active"],
    ["review", "review_ready"],
    ["publish", "delivery"],
    ["park", "parked"],
  ]) {
    const result = createDeviceCommandResult({
      action,
      repoRoot: "/workspace/task",
      worktreePath: "/workspace/task",
      branch: lease.branch,
      lease: { ...lease, status },
      result: { branch: lease.branch },
      provisioned: action === "start",
    });
    assert.equal(result.action, action);
    assert.equal(result.status, status);
    assert.equal(result.branch, lease.branch);
    assert.equal(result.provisioned, action === "start");
  }
});
