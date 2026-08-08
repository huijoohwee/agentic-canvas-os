import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  LOCAL_REVIEW_RETIREMENT_INTENT_SCHEMA,
  LOCAL_REVIEW_RETIREMENT_RECEIPT_SCHEMA,
  renderLocalReviewRetirementMarker,
} from "../scripts/legacy-review-ready-retirement-lib.mjs";
import {
  buildLifecycleReport,
  classifyWorktreeLifecycle,
  cleanupCompletedWorktree,
} from "../scripts/worktree-lifecycle-lib.mjs";
import {
  projectWriterLeasePullRequestMarker,
  WRITER_LEASE_SCHEMA,
} from "../scripts/writer-lease-lib.mjs";

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
    { epoch: 3, status: "completed", branch: "agent/mac/completed", worktreePath: "/tasks/completed", completion: { mainSha: canonicalSha } },
  ];
  const result = classifyWorktreeLifecycle({
    records,
    canonicalSha,
    leases,
    dirt: new Map(),
    integratedCompletionShas: new Set([canonicalSha]),
    now: new Date("2026-07-20T10:00:00.000Z"),
  });
  assert.deepEqual(result.map(item => item.state), ["canonical", "active", "review-ready", "parked", "cleanup-ready"]);
});

test("completed historical main objects remain cleanup-ready after canonical main advances", () => {
  const completedSha = "c".repeat(40);
  const records = [main, { path: "/tasks/completed-old", head: completedSha, detached: true }];
  const leases = [{
    epoch: 3,
    status: "completed",
    branch: "agent/mac/completed-old",
    worktreePath: "/tasks/completed-old",
    completion: { mainSha: completedSha },
  }];
  const integrated = classifyWorktreeLifecycle({
    records,
    canonicalSha,
    leases,
    integratedCompletionShas: new Set([completedSha]),
  });
  const unproven = classifyWorktreeLifecycle({ records, canonicalSha, leases });
  assert.equal(integrated[1].state, "cleanup-ready");
  assert.equal(unproven[1].state, "review-required");
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

test("owned untracked state stays in its task lane and blocks only that semantic scope", () => {
  const taskPath = "/tasks/authored-after-baseline";
  const records = [
    main,
    { path: taskPath, head: "b".repeat(40), branch: "refs/heads/agent/mac/parallel-task" },
  ];
  const leases = [{
    epoch: 9,
    status: "review_ready",
    sessionId: "session-parallel-task",
    scope: "parallel-task",
    branch: "agent/mac/parallel-task",
    worktreePath: taskPath,
    pullRequestUrl: "https://example.test/pull/9",
  }];
  const result = classifyWorktreeLifecycle({
    records,
    canonicalSha,
    leases,
    dirt: new Map([[taskPath, {
      dirty: true,
      untrackedPaths: ["docs/new-contract.md", "scripts/new-policy.mjs"],
      untrackedFiles: [
        { path: "docs/new-contract.md", sizeBytes: 42, gitObjectId: "c".repeat(40) },
        { path: "scripts/new-policy.mjs", sizeBytes: 84, gitObjectId: "d".repeat(40) },
      ],
      observedAt: "2026-07-27T01:02:03.000Z",
    }]]),
  });
  assert.equal(result[0].state, "canonical");
  assert.equal(result[1].state, "owned-untracked");
  assert.equal(result[1].blockScope, "semantic-scope");
  assert.equal(result[1].cleanupEligible, false);
  assert.deepEqual(result[1].authoredState, {
    schema: "agentic-owned-untracked-state/v1",
    preservation: "in-place",
    observedAt: "2026-07-27T01:02:03.000Z",
    paths: ["docs/new-contract.md", "scripts/new-policy.mjs"],
    files: [
      { path: "docs/new-contract.md", sizeBytes: 42, gitObjectId: "c".repeat(40) },
      { path: "scripts/new-policy.mjs", sizeBytes: 84, gitObjectId: "d".repeat(40) },
    ],
    owner: {
      sessionId: "session-parallel-task",
      branch: "agent/mac/parallel-task",
      scope: "parallel-task",
      epoch: 9,
      pullRequestUrl: "https://example.test/pull/9",
    },
  });
});

test("untracked state without a durable task owner remains blocked dirt", () => {
  const taskPath = "/tasks/unattributed";
  const record = { path: taskPath, head: "b".repeat(40), branch: "refs/heads/agent/mac/current" };
  const noOwner = classifyWorktreeLifecycle({
    records: [main, record],
    canonicalSha,
    dirt: new Map([[taskPath, { dirty: true, untrackedPaths: ["unknown.md"] }]]),
  });
  const staleOwner = classifyWorktreeLifecycle({
    records: [main, record],
    canonicalSha,
    leases: [{
      epoch: 3,
      sessionId: "old-session",
      scope: "old",
      branch: "agent/mac/old",
      worktreePath: taskPath,
      pullRequestUrl: "https://example.test/pull/3",
    }],
    dirt: new Map([[taskPath, { dirty: true, untrackedPaths: ["unknown.md"] }]]),
  });
  assert.equal(noOwner[1].state, "blocked-dirty");
  assert.equal(staleOwner[1].state, "blocked-dirty");
});

test("lifecycle report remains ready when another scope has attributed untracked work", () => {
  const taskPath = "/tasks/parallel-task";
  const porcelain = [
    `worktree /repo\nHEAD ${canonicalSha}\nbranch refs/heads/main`,
    `worktree ${taskPath}\nHEAD ${"b".repeat(40)}\nbranch refs/heads/agent/mac/parallel-task`,
    "",
  ].join("\n\n");
  const git = (cwd, args) => {
    const command = args.join(" ");
    if (command === "worktree list --porcelain") return porcelain;
    if (command === "rev-parse origin/main") return `${canonicalSha}\n`;
    if (command === "status --porcelain=v1 -z --untracked-files=all") {
      return cwd === taskPath ? "?? docs/new-contract.md\0" : "";
    }
    throw new Error(`Unexpected git call: ${cwd} ${command}`);
  };
  const report = buildLifecycleReport({
    repository: "/repo",
    git,
    readLeases: () => [{
      epoch: 9,
      status: "active",
      sessionId: "session-parallel-task",
      scope: "parallel-task",
      branch: "agent/mac/parallel-task",
      worktreePath: taskPath,
      pullRequestUrl: "https://example.test/pull/9",
      expiresAt: "2099-01-01T00:00:00.000Z",
    }],
    isAncestor: () => false,
    describeUntracked: (_worktreePath, relativePath) => ({
      path: relativePath,
      sizeBytes: 42,
      gitObjectId: "c".repeat(40),
    }),
  });
  assert.equal(report.status, "ready");
  assert.equal(report.worktrees[1].state, "owned-untracked");
  assert.deepEqual(report.worktrees[1].authoredState.paths, ["docs/new-contract.md"]);
  assert.deepEqual(report.worktrees[1].authoredState.files, [{
    path: "docs/new-contract.md",
    sizeBytes: 42,
    gitObjectId: "c".repeat(40),
  }]);
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
  assert.throws(() => cleanupCompletedWorktree({
    report: { ...report, worktrees: [{ path: "/tasks/completed", state: "owned-untracked" }] },
    target: "/tasks/completed",
  }), /lifecycle state is owned-untracked/);
});

test("released local review lanes stay retired-preserved and never become cleanup candidates", () => {
  const taskPath = "/tasks/retired-review";
  const head = "9".repeat(40);
  const branch = "agent/old-device/retired-review";
  const lease = retiredLease({ taskPath, head, branch });
  const records = [
    main,
    { path: taskPath, head, branch: `refs/heads/${branch}` },
  ];
  const result = classifyWorktreeLifecycle({ records, canonicalSha, leases: [lease] });
  assert.equal(result[1].state, "retired-preserved");
  assert.equal(result[1].cleanupEligible, false);
  assert.throws(() => cleanupCompletedWorktree({
    report: { repository: "/repo", worktrees: result },
    target: taskPath,
  }), /lifecycle state is retired-preserved/);

  const invalid = structuredClone(lease);
  invalid.localReviewRetirement.receiptDigest = "0".repeat(64);
  assert.equal(classifyWorktreeLifecycle({
    records,
    canonicalSha,
    leases: [invalid],
  })[1].state, "review-required");
  assert.equal(classifyWorktreeLifecycle({
    records,
    canonicalSha,
    leases: [lease],
    dirt: new Map([[taskPath, true]]),
  })[1].state, "blocked-dirty");
});

test("lifecycle report treats cryptographically attributed retirement as safe preservation", () => {
  const taskPath = "/tasks/retired-review";
  const head = "9".repeat(40);
  const branch = "agent/old-device/retired-review";
  const porcelain = [
    `worktree /repo\nHEAD ${canonicalSha}\nbranch refs/heads/main`,
    `worktree ${taskPath}\nHEAD ${head}\nbranch refs/heads/${branch}`,
    "",
  ].join("\n\n");
  const report = buildLifecycleReport({
    repository: "/repo",
    git: (_cwd, args) => {
      const command = args.join(" ");
      if (command === "worktree list --porcelain") return porcelain;
      if (command === "rev-parse origin/main") return `${canonicalSha}\n`;
      if (command === "status --porcelain=v1 -z --untracked-files=all") return "";
      throw new Error(`Unexpected git call: ${command}`);
    },
    readLeases: () => [retiredLease({ taskPath, head, branch })],
  });
  assert.equal(report.status, "ready");
  assert.equal(report.worktrees[1].state, "retired-preserved");
});

function retiredLease({ taskPath, head, branch }) {
  const retiredAt = "2026-08-08T12:00:00.000Z";
  const sourceLease = {
    schema: WRITER_LEASE_SCHEMA,
    status: "review_ready",
    epoch: 9,
    sessionId: "retired-source-session",
    device: "old-device",
    scope: "retired-review",
    branch,
    worktreePath: taskPath,
    baseSha: "7".repeat(40),
    fenceSha: "6".repeat(40),
    pullRequestUrl: "https://github.com/owner/repository/pull/9",
    reviewHeadSha: head,
    heartbeatAt: "2026-08-01T00:00:00.000Z",
    expiresAt: "2026-08-01T00:00:00.000Z",
  };
  const preservation = {
    worktree: "preserved",
    branch: "preserved",
    pullRequest: "closed-preserved",
    bytes: "exact",
    cleanupEligible: false,
  };
  const source = {
    worktreePath: taskPath,
    branch,
    headSha: head,
    treeSha: "8".repeat(40),
    remoteHeadSha: head,
    indexDigest: "1".repeat(64),
    workingTreeDigest: "2".repeat(64),
    stateDigest: "3".repeat(64),
    lease: {
      status: "review_ready",
      epoch: sourceLease.epoch,
      sessionId: sourceLease.sessionId,
      device: sourceLease.device,
      scope: sourceLease.scope,
      baseSha: sourceLease.baseSha,
      fenceSha: sourceLease.fenceSha,
      heartbeatAt: sourceLease.heartbeatAt,
      expiresAt: sourceLease.expiresAt,
      leaseDigest: digestValue(sourceLease),
    },
    pullRequest: {
      url: "https://github.com/owner/repository/pull/9",
      number: 9,
      nodeId: "PR_node_9",
      reviewRequestId: "github-pull-request:PR_node_9",
      headRepository: "owner/repository",
      headBranch: branch,
      headSha: head,
      baseRepository: "owner/repository",
      baseBranch: "main",
    },
  };
  const intentCore = {
    schema: LOCAL_REVIEW_RETIREMENT_INTENT_SCHEMA,
    targetRepository: "owner/repository",
    ledgerRepository: "owner/ledger",
    operatorSessionId: "retirement-operator-session",
    operatorDecisionDigest: "5".repeat(64),
    source,
    preservation,
  };
  const intent = { ...intentCore, intentDigest: digestValue(intentCore) };
  const releasedLease = {
    ...sourceLease,
    status: "released",
    heartbeatAt: retiredAt,
    expiresAt: retiredAt,
  };
  const marker = {
    schema: LOCAL_REVIEW_RETIREMENT_INTENT_SCHEMA,
    intentDigest: intent.intentDigest,
    retiredAt,
    releasedWriterMarkerDigest: digestValue(
      projectWriterLeasePullRequestMarker(releasedLease),
    ),
  };
  const receiptCore = {
    schema: LOCAL_REVIEW_RETIREMENT_RECEIPT_SCHEMA,
    status: "completed",
    intent,
    intentDigest: intent.intentDigest,
    preservation,
    cloud: {
      ledgerRepository: "owner/ledger",
      ledgerRevision: "b".repeat(40),
      ledgerDigest: "c".repeat(64),
      remoteClaimInventoryDigest: "d".repeat(64),
      cloudVerificationReceiptDigest: "e".repeat(64),
      dormantPreservationReceiptDigest: "f".repeat(64),
    },
    provider: {
      state: "CLOSED",
      merged: false,
      closedAt: retiredAt,
      headSha: head,
      bodyDigest: "0".repeat(64),
      marker,
      markerDigest: digestValue(renderLocalReviewRetirementMarker(marker)),
      releasedWriterMarkerDigest: marker.releasedWriterMarkerDigest,
    },
    retiredAt,
  };
  return {
    ...releasedLease,
    localReviewRetirement: {
      ...receiptCore,
      receiptDigest: digestValue(receiptCore),
    },
  };
}
