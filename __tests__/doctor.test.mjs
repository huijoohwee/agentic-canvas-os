import assert from "node:assert/strict";
import test from "node:test";

import { auditLaneLifecycleRisks } from "../scripts/doctor-lib.mjs";

const mainSha = "a".repeat(40);
const canonical = {
  path: "/repo",
  head: mainSha,
  branch: "refs/heads/main",
  state: "canonical",
  lease: null,
};

test("doctor passes when no lane expiry or projection drift is present", () => {
  const result = auditLaneLifecycleRisks({
    report: {
      schema: "agentic-worktree-lifecycle-report/v1",
      repository: "/repo",
      worktrees: [
        canonical,
        {
          path: "/repo/tasks/healthy",
          head: "b".repeat(40),
          branch: "refs/heads/agent/mac/healthy",
          state: "active",
          lease: {
            status: "active",
            branch: "agent/mac/healthy",
            expiresAt: "2099-08-06T03:00:00.000Z",
          },
        },
      ],
    },
    now: new Date("2099-08-06T02:00:00.000Z"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.level, "PASS");
  assert.equal(result.findings.length, 0);
});

test("doctor warns for expiring authority and projection repair drift", () => {
  const result = auditLaneLifecycleRisks({
    report: {
      schema: "agentic-worktree-lifecycle-report/v1",
      repository: "/repo",
      worktrees: [
        canonical,
        {
          path: "/repo/tasks/risky",
          head: "b".repeat(40),
          branch: "refs/heads/agent/mac/risky",
          state: "active",
          lease: {
            status: "active",
            branch: "agent/mac/risky",
            expiresAt: "2099-08-06T02:12:00.000Z",
            pullRequestProjectionRepair: {
              schema: "agentic-pull-request-projection-repair/v1",
              status: "repairing",
            },
            cloudAuthority: {
              laneRevision: "c".repeat(40),
              expiresAt: "2099-08-06T02:10:00.000Z",
            },
          },
        },
      ],
    },
    now: new Date("2099-08-06T02:00:00.000Z"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.level, "WARN");
  assert.deepEqual(result.findings.map(finding => finding.code).sort(), [
    "lane-revision-drift",
    "lease-expiring-soon",
    "pull-request-projection-repair-pending",
  ]);
});

test("doctor fails for expired authority and branch projection mismatch", () => {
  const result = auditLaneLifecycleRisks({
    report: {
      schema: "agentic-worktree-lifecycle-report/v1",
      repository: "/repo",
      worktrees: [
        canonical,
        {
          path: "/repo/tasks/stale",
          head: "d".repeat(40),
          branch: "refs/heads/agent/mac/stale-local",
          state: "review-required",
          lease: {
            status: "review_ready",
            branch: "agent/mac/stale-remote",
            expiresAt: "2099-08-06T01:59:00.000Z",
          },
        },
      ],
    },
    now: new Date("2099-08-06T02:00:00.000Z"),
  });

  assert.equal(result.ok, false);
  assert.equal(result.level, "FAIL");
  assert.deepEqual(result.findings.map(finding => finding.code).sort(), [
    "branch-projection-mismatch",
    "lease-expired",
    "review-required-transition-drift",
  ]);
});
