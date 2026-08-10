import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  LOCAL_REVIEW_RETIREMENT_INTENT_SCHEMA,
  LOCAL_REVIEW_RETIREMENT_RECEIPT_SCHEMA,
  renderLocalReviewRetirementMarker,
} from "../scripts/legacy-review-ready-retirement-lib.mjs";
import {
  buildLifecycleReport,
  buildWorktreeCleanupReport,
  classifyWorktreeLifecycle,
  cleanupCompletedWorktree,
  cleanupEmptyWorktreeContainers,
  createWorktreeCleanupOperationId,
  WORKTREE_CLEANUP_RESULT_SCHEMA,
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

test("lifecycle ancestry probes are unique and limited to registered detached completion candidates", () => {
  const completedSha = "c".repeat(40);
  const firstPath = "/tasks/completed-one";
  const secondPath = "/tasks/completed-two";
  const attachedPath = "/tasks/completed-attached";
  const porcelain = [
    `worktree /repo\nHEAD ${canonicalSha}\nbranch refs/heads/main`,
    `worktree ${firstPath}\nHEAD ${completedSha}\ndetached`,
    `worktree ${secondPath}\nHEAD ${completedSha}\ndetached`,
    `worktree ${attachedPath}\nHEAD ${completedSha}\nbranch refs/heads/agent/mac/attached`,
    "",
  ].join("\n\n");
  const leases = [
    completedLease(firstPath, completedSha, "agent/mac/completed-one"),
    completedLease(secondPath, completedSha, "agent/mac/completed-two"),
    completedLease(attachedPath, completedSha, "agent/mac/attached"),
    ...Array.from({ length: 40 }, (_, index) => completedLease(
      `/historical/absent-${index}`,
      String(index).padStart(40, "0"),
      `agent/mac/absent-${index}`,
    )),
  ];
  const probes = [];
  const report = buildLifecycleReport({
    repository: "/repo",
    git: (_cwd, args) => {
      const command = args.join(" ");
      if (command === "worktree list --porcelain") return porcelain;
      if (command === "rev-parse origin/main") return `${canonicalSha}\n`;
      if (command === "status --porcelain=v1 -z --untracked-files=all") return "";
      throw new Error(`Unexpected git call: ${command}`);
    },
    readLeases: () => leases,
    isAncestor: (_root, ancestor, descendant) => {
      probes.push([ancestor, descendant]);
      return true;
    },
  });

  assert.deepEqual(probes, [[completedSha, canonicalSha]]);
  assert.deepEqual(report.worktrees.map(item => item.state), [
    "canonical",
    "cleanup-ready",
    "cleanup-ready",
    "review-required",
  ]);
});

test("target-scoped cleanup report ignores unrelated lanes and historical completion leases", () => {
  const target = "/tasks/completed";
  const unrelated = "/tasks/unrelated";
  const completedSha = "c".repeat(40);
  const porcelain = [
    `worktree /repo\nHEAD ${canonicalSha}\nbranch refs/heads/main`,
    `worktree ${target}\nHEAD ${completedSha}\ndetached`,
    `worktree ${unrelated}\nHEAD ${"d".repeat(40)}\nbranch refs/heads/agent/mac/unrelated`,
    "",
  ].join("\n\n");
  const probes = [];
  const statusPaths = [];
  const report = buildWorktreeCleanupReport({
    repository: "/repo",
    target,
    gitCommonDir: "/repo/.git",
    git: (cwd, args) => {
      const command = args.join(" ");
      if (command === "worktree list --porcelain") return porcelain;
      if (command === "rev-parse origin/main") return `${canonicalSha}\n`;
      if (command === "status --porcelain=v1 -z --untracked-files=all") {
        statusPaths.push(cwd);
        return "";
      }
      throw new Error(`Unexpected git call: ${cwd} ${command}`);
    },
    readLeases: () => [
      completedLease(target, completedSha, "agent/mac/completed"),
      ...Array.from({ length: 40 }, (_, index) => completedLease(
        `/historical/absent-${index}`,
        String(index).padStart(40, "0"),
        `agent/mac/absent-${index}`,
      )),
    ],
    isAncestor: (_root, ancestor, descendant) => {
      probes.push([ancestor, descendant]);
      return true;
    },
    pathExists: candidate => candidate === target,
  });

  assert.deepEqual(statusPaths, [target]);
  assert.deepEqual(probes, [[completedSha, canonicalSha]]);
  assert.equal(report.candidate.state, "cleanup-ready");
  assert.equal(report.target.path, target);
});

test("target-scoped cleanup treats a broken symlink as retained path-entry residue", () => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "agentic-worktree-broken-link-"));
  const target = path.join(fixture, "completed");
  symlinkSync(path.join(fixture, "missing-target"), target);
  try {
    assert.throws(() => buildWorktreeCleanupReport({
      repository: "/repo",
      target,
      gitCommonDir: "/repo/.git",
      git: (_cwd, args) => {
        const command = args.join(" ");
        if (command === "worktree list --porcelain") {
          return `worktree /repo\nHEAD ${canonicalSha}\nbranch refs/heads/main\n`;
        }
        if (command === "rev-parse origin/main") return `${canonicalSha}\n`;
        throw new Error(`Unexpected git call: ${command}`);
      },
      readLeases: () => [completedLease(target, canonicalSha, "agent/mac/completed")],
      isAncestor: () => true,
    }), /remains present without worktree registration/u);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("cleanup removes only an explicitly completed candidate and emits a typed exact-absence receipt", () => {
  const calls = [];
  const target = "/tasks/completed";
  const completionMainSha = "c".repeat(40);
  const report = {
    repository: "/repo",
    canonicalSha,
    gitCommonDir: "/repo/.git",
    target: {
      path: target,
      registeredBefore: true,
      pathPresentBefore: true,
      head: completionMainSha,
      completionMainSha,
      state: "cleanup-ready",
    },
    lease: { branch: "agent/mac/completed", completion: { mainSha: completionMainSha } },
  };
  const result = cleanupCompletedWorktree({
    report,
    target,
    remove: (...args) => {
      calls.push(args);
      return { registeredAfter: false, pathExistsAfter: false };
    },
    cleanupContainers: input => ({
      kind: "managed",
      managedContainer: { root: "/tasks", disposition: "retained-nonempty" },
      sharedContainer: { root: "/", disposition: "not-attempted" },
      removedEmptyDirectories: [],
      input,
    }),
  });
  assert.deepEqual(calls, [["/repo", target]]);
  assert.equal(result.schema, WORKTREE_CLEANUP_RESULT_SCHEMA);
  assert.equal(result.status, "cleaned");
  assert.equal(result.gitCommonDir, "/repo/.git");
  assert.equal(result.canonicalSha, canonicalSha);
  assert.deepEqual(result.target, {
    ...report.target,
    registeredAfter: false,
    pathExistsAfter: false,
  });
  assert.equal(result.removedWorktree, target);
  assert.equal(result.preservedBranch, "agent/mac/completed");
  assert.equal(result.registrationPruned, false);
  assert.deepEqual(result.removedEmptyDirectories, []);
  assert.match(result.operationId, /^[0-9a-f]{64}$/u);
  assert.equal(result.operationId, createWorktreeCleanupOperationId({
    repository: report.repository,
    gitCommonDir: report.gitCommonDir,
    targetPath: target,
    completionMainSha,
    preservedBranch: "agent/mac/completed",
    managedContainer: result.managedContainer,
    sharedContainer: result.sharedContainer,
  }));
  assert.equal(result.replayed, false);
  assert.throws(() => cleanupCompletedWorktree({
    report: { ...report, target: { ...report.target, state: "parked" } },
    target,
  }), /lifecycle state is parked/);
  assert.throws(() => cleanupCompletedWorktree({
    report: { ...report, target: { ...report.target, state: "owned-untracked" } },
    target,
  }), /lifecycle state is owned-untracked/);
});

test("already-cleaned target replay proves absence without invoking worktree removal", () => {
  const target = "/tasks/completed";
  const completionMainSha = "c".repeat(40);
  const report = {
    repository: "/repo",
    canonicalSha,
    gitCommonDir: "/repo/.git",
    target: {
      path: target,
      registeredBefore: false,
      pathPresentBefore: false,
      head: null,
      completionMainSha,
      state: "already-cleaned",
    },
    lease: { branch: "agent/mac/completed", completion: { mainSha: completionMainSha } },
  };
  const result = cleanupCompletedWorktree({
    report,
    target,
    remove: () => { throw new Error("replay must not remove again"); },
    cleanupContainers: () => ({
      kind: "managed",
      managedContainer: { root: "/tasks", disposition: "absent" },
      sharedContainer: { root: "/", disposition: "retained-nonempty" },
      removedEmptyDirectories: [],
    }),
  });

  assert.equal(result.status, "already-cleaned");
  assert.equal(result.removedWorktree, null);
  assert.equal(result.target.registeredAfter, false);
  assert.equal(result.target.pathExistsAfter, false);
  assert.equal(result.replayed, true);
});

test("cleanup-empty emits an idempotent typed orphan-container sweep receipt", () => {
  const removals = [["/workspace/.worktrees/repository", "/workspace/.worktrees"], []];
  const run = () => cleanupEmptyWorktreeContainers({
    repository: "/workspace/repository",
    gitCommonDir: "/workspace/repository/.git",
    git: (_cwd, args) => {
      if (args.join(" ") === "rev-parse origin/main") return `${canonicalSha}\n`;
      throw new Error(`Unexpected git call: ${args.join(" ")}`);
    },
    cleanupContainers: () => ({
      kind: "managed",
      managedContainer: { root: "/workspace/.worktrees/repository", disposition: removals[0].length ? "removed-empty" : "absent" },
      sharedContainer: { root: "/workspace/.worktrees", disposition: removals[0].length ? "removed-empty" : "absent" },
      removedEmptyDirectories: removals.shift(),
    }),
  });

  const cleaned = run();
  const replay = run();
  assert.equal(cleaned.schema, WORKTREE_CLEANUP_RESULT_SCHEMA);
  assert.equal(cleaned.status, "cleaned");
  assert.equal(cleaned.target, null);
  assert.equal(cleaned.registrationPruned, false);
  assert.equal(cleaned.replayed, false);
  assert.equal(replay.status, "already-cleaned");
  assert.equal(replay.replayed, true);
  assert.equal(replay.operationId, cleaned.operationId);
});

test("cleanup-empty replays as already cleaned when only sibling repositories retain the shared root", () => {
  const observations = [
    {
      kind: "managed",
      managedContainer: {
        root: "/workspace/.worktrees/repository",
        disposition: "removed-empty",
      },
      sharedContainer: {
        root: "/workspace/.worktrees",
        disposition: "retained-nonempty",
      },
      removedEmptyDirectories: ["/workspace/.worktrees/repository"],
    },
    {
      kind: "managed",
      managedContainer: {
        root: "/workspace/.worktrees/repository",
        disposition: "absent",
      },
      sharedContainer: {
        root: "/workspace/.worktrees",
        disposition: "retained-nonempty",
      },
      removedEmptyDirectories: [],
    },
  ];
  const run = () => cleanupEmptyWorktreeContainers({
    repository: "/workspace/repository",
    gitCommonDir: "/workspace/repository/.git",
    git: (_cwd, args) => {
      if (args.join(" ") === "rev-parse origin/main") return `${canonicalSha}\n`;
      throw new Error(`Unexpected git call: ${args.join(" ")}`);
    },
    cleanupContainers: () => observations.shift(),
  });

  const cleaned = run();
  const replay = run();
  assert.equal(cleaned.status, "cleaned");
  assert.equal(cleaned.replayed, false);
  assert.equal(replay.status, "already-cleaned");
  assert.equal(replay.replayed, true);
  assert.equal(replay.operationId, cleaned.operationId);
});

test("cleanup-empty distinguishes retained container residue from an exact-absence replay", () => {
  for (const [name, managedDisposition, sharedDisposition] of [
    ["nonempty", "retained-nonempty", "not-attempted"],
    ["symlink", "retained-symlink", "not-attempted"],
    ["ambiguous", "retained-ambiguous", "retained-ambiguous"],
  ]) {
    const result = cleanupEmptyWorktreeContainers({
      repository: "/workspace/repository",
      gitCommonDir: "/workspace/separate-git-common",
      git: (_cwd, args) => {
        if (args.join(" ") === "rev-parse origin/main") return `${canonicalSha}\n`;
        throw new Error(`Unexpected git call: ${args.join(" ")}`);
      },
      cleanupContainers: () => ({
        kind: "managed",
        managedContainer: {
          root: "/workspace/.worktrees/repository",
          disposition: managedDisposition,
        },
        sharedContainer: {
          root: "/workspace/.worktrees",
          disposition: sharedDisposition,
        },
        removedEmptyDirectories: [],
      }),
    });

    assert.equal(result.status, "retained", name);
    assert.equal(result.replayed, false, name);
    assert.equal(result.gitCommonDir, "/workspace/separate-git-common", name);
    assert.deepEqual(result.removedEmptyDirectories, [], name);
  }
});

test("cleanup-empty CLI removes only empty owned containers and replays idempotently", () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agentic-worktree-cleanup-empty-"));
  const repository = path.join(workspace, "repository");
  const sharedContainer = path.join(workspace, ".worktrees");
  const managedContainer = path.join(sharedContainer, "repository");
  const script = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../scripts/worktree-lifecycle.mjs",
  );
  try {
    mkdirSync(repository, { recursive: true });
    execFileSync("git", ["init", "-b", "main"], { cwd: repository, stdio: "ignore" });
    writeFileSync(path.join(repository, "README.md"), "fixture\n");
    execFileSync("git", ["add", "README.md"], { cwd: repository });
    execFileSync("git", [
      "-c", "user.name=Fixture",
      "-c", "user.email=fixture@example.test",
      "commit", "-m", "test: initialize fixture",
    ], { cwd: repository, stdio: "ignore" });
    const revision = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repository,
      encoding: "utf8",
    }).trim();
    execFileSync("git", ["update-ref", "refs/remotes/origin/main", revision], { cwd: repository });
    mkdirSync(managedContainer, { recursive: true });

    const invoke = () => spawnSync(process.execPath, [
      script,
      "cleanup-empty",
      `--repository=${repository}`,
    ], { cwd: repository, encoding: "utf8" });
    const first = invoke();
    assert.equal(first.status, 0, first.stderr);
    const cleaned = JSON.parse(first.stdout);
    assert.equal(cleaned.status, "cleaned");
    assert.deepEqual(cleaned.removedEmptyDirectories, [managedContainer, sharedContainer]);
    assert.equal(existsSync(sharedContainer), false);

    const second = invoke();
    assert.equal(second.status, 0, second.stderr);
    const replay = JSON.parse(second.stdout);
    assert.equal(replay.status, "already-cleaned");
    assert.deepEqual(replay.removedEmptyDirectories, []);
    assert.equal(replay.operationId, cleaned.operationId);

    mkdirSync(managedContainer, { recursive: true });
    writeFileSync(path.join(managedContainer, "retained.txt"), "retain\n");
    const retainedRun = invoke();
    assert.equal(retainedRun.status, 0, retainedRun.stderr);
    const retained = JSON.parse(retainedRun.stdout);
    assert.equal(retained.status, "retained");
    assert.equal(retained.replayed, false);
    assert.deepEqual(retained.removedEmptyDirectories, []);
    assert.equal(existsSync(path.join(managedContainer, "retained.txt")), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("cleanup CLI removes the exact completed worktree without pruning unrelated stale registration", () => {
  const workspace = realpathSync(mkdtempSync(path.join(os.tmpdir(), "agentic-worktree-cleanup-exact-")));
  const repository = path.join(workspace, "repository");
  const target = path.join(workspace, ".worktrees", "repository", "completed");
  const stale = path.join(workspace, "unrelated-stale-worktree");
  const branch = "agent/mac/completed";
  const script = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../scripts/worktree-lifecycle.mjs",
  );
  try {
    mkdirSync(repository, { recursive: true });
    execFileSync("git", ["init", "-b", "main"], { cwd: repository, stdio: "ignore" });
    writeFileSync(path.join(repository, "README.md"), "fixture\n");
    execFileSync("git", ["add", "README.md"], { cwd: repository });
    execFileSync("git", [
      "-c", "user.name=Fixture",
      "-c", "user.email=fixture@example.test",
      "commit", "-m", "test: initialize fixture",
    ], { cwd: repository, stdio: "ignore" });
    const revision = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repository,
      encoding: "utf8",
    }).trim();
    execFileSync("git", ["update-ref", "refs/remotes/origin/main", revision], { cwd: repository });
    mkdirSync(path.dirname(target), { recursive: true });
    execFileSync("git", ["worktree", "add", "--detach", target, revision], {
      cwd: repository,
      stdio: "ignore",
    });
    execFileSync("git", ["worktree", "add", "--detach", stale, revision], {
      cwd: repository,
      stdio: "ignore",
    });
    rmSync(stale, { recursive: true, force: true });
    const commonDirectory = path.join(repository, ".git", "agentic-canvas-os");
    mkdirSync(commonDirectory, { recursive: true });
    writeFileSync(path.join(commonDirectory, "writer-leases.json"), `${JSON.stringify({
      schema: "agentic-writer-lease-registry/v2",
      revision: 1,
      leases: {
        [branch]: completedLease(target, revision, branch),
      },
    })}\n`);

    const invoke = () => spawnSync(process.execPath, [
      script,
      "cleanup",
      `--repository=${repository}`,
      `--worktree=${target}`,
    ], { cwd: repository, encoding: "utf8" });
    const first = invoke();
    assert.equal(first.status, 0, first.stderr);
    const cleaned = JSON.parse(first.stdout);
    assert.equal(cleaned.status, "cleaned");
    assert.equal(cleaned.removedWorktree, target);
    assert.equal(cleaned.registrationPruned, false);
    assert.equal(cleaned.target.registeredAfter, false);
    assert.equal(cleaned.target.pathExistsAfter, false);
    assert.equal(existsSync(target), false);
    const registryAfter = execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd: repository,
      encoding: "utf8",
    });
    assert.match(registryAfter, new RegExp(`worktree ${escapeRegExp(stale)}`));
    assert.match(registryAfter, /prunable/u);

    const second = invoke();
    assert.equal(second.status, 0, second.stderr);
    const replay = JSON.parse(second.stdout);
    assert.equal(replay.status, "already-cleaned");
    assert.equal(replay.removedWorktree, null);
    assert.equal(replay.operationId, cleaned.operationId);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
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

function completedLease(worktreePath, mainSha, branch) {
  return {
    epoch: 1,
    status: "completed",
    branch,
    worktreePath,
    completion: { mainSha },
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

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
