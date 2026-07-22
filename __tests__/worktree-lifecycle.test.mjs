import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyWorktreeLifecycle,
  cleanupCompletedWorktree,
} from "../scripts/worktree-lifecycle-lib.mjs";

const canonicalSha = "a".repeat(40);
const main = { path: "/repo", head: canonicalSha, branch: "refs/heads/main" };

test("lifecycle keeps canonical, active, review-ready, and parked lanes while surfacing completed cleanup", () => {
  const records = [
    main,
    { path: "/tasks/active", head: "b".repeat(40), branch: "refs/heads/agent/mac/active" },
    { path: "/tasks/review", head: "e".repeat(40), branch: "refs/heads/agent/mac/review" },
    { path: "/tasks/parked", head: canonicalSha, detached: true },
    { path: "/tasks/completed", head: canonicalSha, detached: true },
  ];
  const leases = [
    { epoch: 1, status: "active", expiresAt: "2026-07-20T11:00:00.000Z", worktreePath: "/tasks/active" },
    { epoch: 4, status: "review_ready", worktreePath: "/tasks/review" },
    { epoch: 2, status: "parked", worktreePath: "/tasks/parked" },
    { epoch: 3, status: "completed", branch: "agent/mac/completed", worktreePath: "/tasks/completed" },
  ];
  const result = classifyWorktreeLifecycle({
    records,
    canonicalSha,
    leases,
    dirt: new Map(),
    now: new Date("2026-07-20T10:00:00.000Z"),
  });
  assert.deepEqual(result.map(item => item.state), ["canonical", "active", "review-ready", "parked", "cleanup-ready"]);
});

test("lifecycle never upgrades dirty, ambiguous, or stale active lanes to cleanup-ready", () => {
  const records = [
    main,
    { path: "/tasks/dirty", head: canonicalSha, detached: true },
    { path: "/tasks/unknown", head: canonicalSha, detached: true },
    { path: "/tasks/stale", head: "b".repeat(40), branch: "refs/heads/agent/mac/stale" },
  ];
  const result = classifyWorktreeLifecycle({
    records,
    canonicalSha,
    leases: [{
      epoch: 1,
      status: "active",
      expiresAt: "2026-07-20T09:00:00.000Z",
      worktreePath: "/tasks/stale",
    }],
    dirt: new Map([["/tasks/dirty", true]]),
    now: new Date("2026-07-20T10:00:00.000Z"),
  });
  assert.deepEqual(result.map(item => item.state), [
    "canonical",
    "blocked-dirty",
    "review-required",
    "review-required",
  ]);
});

test("cleanup removes only an explicitly completed candidate and preserves its branch", () => {
  const calls = [];
  const report = {
    repository: "/repo",
    worktrees: [{
      path: "/tasks/completed",
      state: "cleanup-ready",
      lease: { branch: "agent/mac/completed" },
    }],
  };
  const result = cleanupCompletedWorktree({
    report,
    target: "/tasks/completed",
    remove: (...args) => calls.push(args),
  });
  assert.deepEqual(calls, [["/repo", "/tasks/completed"]]);
  assert.deepEqual(result, {
    removedWorktree: "/tasks/completed",
    preservedBranch: "agent/mac/completed",
  });
  assert.throws(() => cleanupCompletedWorktree({
    report: { ...report, worktrees: [{ path: "/tasks/completed", state: "parked" }] },
    target: "/tasks/completed",
  }), /lifecycle state is parked/);
});
