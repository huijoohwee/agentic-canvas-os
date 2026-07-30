import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  deriveTaskWorktreeRoot,
  provisionTaskWorktree,
  rollbackUnclaimedProvision,
} from "../scripts/task-worktree-provision.mjs";

const repoRoot = "/workspace/repository";
const safeRoot = deriveTaskWorktreeRoot(repoRoot);
const target = path.join(safeRoot, "work-item-42");
const sha = "a".repeat(40);
const canonicalRecord = `worktree ${repoRoot}\0HEAD ${sha}\0branch refs/heads/main\0`;
const gitCommonDir = path.join(repoRoot, ".git");

function gitTextFor(overrides = {}) {
  const responses = {
    "rev-parse --git-common-dir": gitCommonDir,
    "worktree list --porcelain -z": canonicalRecord,
    "status --porcelain": "",
    "rev-parse origin/main": sha,
    "rev-parse HEAD": sha,
    ...overrides,
  };
  return args => {
    const key = args.join(" ");
    if (!(key in responses)) throw new Error(`unexpected git command: ${key}`);
    return responses[key];
  };
}

test("provision creates a detached task worktree from the one exact fetched main object", () => {
  const calls = [];
  const advancedSha = "b".repeat(40);
  const treeSha = "c".repeat(40);
  const registeredCandidate =
    `${canonicalRecord}\0worktree ${target}\0HEAD ${sha}\0detached\0`;
  let created = false;
  let originReads = 0;
  const baseGitText = gitTextFor();
  const result = provisionTaskWorktree({
    invocationPath: repoRoot,
    repoRoot,
    targetPath: target,
    gitText: args => {
      const key = args.join(" ");
      if (key === "worktree list --porcelain -z") {
        return created ? registeredCandidate : canonicalRecord;
      }
      if (key === "rev-parse origin/main") {
        return ++originReads === 1 ? sha : advancedSha;
      }
      if (key === `rev-parse ${sha}^{tree}`) return treeSha;
      if (key === `-C ${target} rev-parse HEAD`) return sha;
      if (key === `-C ${target} rev-parse HEAD^{tree}`) return treeSha;
      if (key === `-C ${target} status --porcelain=v1 -z --untracked-files=all`) return "";
      if (key === `-C ${target} rev-parse --show-toplevel`) return target;
      return baseGitText(args);
    },
    run: (command, args) => {
      calls.push([command, ...args]);
      if (command === "git" && args[0] === "worktree" && args[1] === "add") {
        created = true;
      }
    },
    makeDirectory: () => {},
    pathExists: candidate => candidate === path.dirname(safeRoot),
    pathStat: () => ({ isSymbolicLink: () => false }),
  });

  assert.equal(result.target, target);
  assert.equal(result.baseSha, sha);
  assert.equal(originReads, 1);
  assert.deepEqual(calls, [
    ["git", "fetch", "origin", "main"],
    ["git", "worktree", "add", "--detach", target, sha],
  ]);
});

test("provision rejects an unrelated concurrent worktree registration after add", () => {
  const calls = [];
  const unrelatedTarget = path.join(safeRoot, "other-work-item");
  const mutatedRegistry = [
    canonicalRecord,
    `worktree ${target}\0HEAD ${sha}\0detached\0`,
    `worktree ${unrelatedTarget}\0HEAD ${sha}\0detached\0`,
  ].join("\0");
  let created = false;
  const baseGitText = gitTextFor();

  assert.throws(() => provisionTaskWorktree({
    invocationPath: repoRoot,
    repoRoot,
    targetPath: target,
    gitText: args => {
      const key = args.join(" ");
      if (key === "worktree list --porcelain -z") {
        return created ? mutatedRegistry : canonicalRecord;
      }
      if (key === `-C ${target} status --porcelain`) return "";
      if (key === `-C ${target} rev-parse HEAD`) return sha;
      return baseGitText(args);
    },
    run: (command, args) => {
      calls.push([command, ...args]);
      if (command === "git" && args[0] === "worktree" && args[1] === "add") {
        created = true;
      }
      if (command === "git" && args[0] === "worktree" && args[1] === "remove") {
        created = false;
      }
    },
    makeDirectory: () => {},
    pathExists: candidate => (
      candidate === path.dirname(safeRoot)
      || (candidate === target && created)
    ),
    pathStat: () => ({ isSymbolicLink: () => false }),
  }), /changed by more than the single detached candidate registration.*automatic rollback removed/);

  assert.deepEqual(calls, [
    ["git", "fetch", "origin", "main"],
    ["git", "worktree", "add", "--detach", target, sha],
    ["git", "worktree", "remove", target],
  ]);
  assert.equal(created, false);
});

test("post-add rollback retains a candidate that cannot be re-proven clean", () => {
  const calls = [];
  const treeSha = "c".repeat(40);
  const registeredCandidate =
    `${canonicalRecord}\0worktree ${target}\0HEAD ${sha}\0detached\0`;
  let created = false;
  const baseGitText = gitTextFor();

  assert.throws(() => provisionTaskWorktree({
    invocationPath: repoRoot,
    repoRoot,
    targetPath: target,
    gitText: args => {
      const key = args.join(" ");
      if (key === "worktree list --porcelain -z") {
        return created ? registeredCandidate : canonicalRecord;
      }
      if (key === `rev-parse ${sha}^{tree}`) return treeSha;
      if (key === `-C ${target} rev-parse HEAD`) return sha;
      if (key === `-C ${target} rev-parse HEAD^{tree}`) return treeSha;
      if (key === `-C ${target} status --porcelain=v1 -z --untracked-files=all`) {
        return "?? preserve-me.txt\0";
      }
      if (key === `-C ${target} status --porcelain`) return "?? preserve-me.txt";
      if (key === `-C ${target} rev-parse --show-toplevel`) return target;
      return baseGitText(args);
    },
    run: (command, args) => {
      calls.push([command, ...args]);
      if (command === "git" && args[0] === "worktree" && args[1] === "add") {
        created = true;
      }
    },
    makeDirectory: () => {},
    pathExists: candidate => (
      candidate === path.dirname(safeRoot)
      || (candidate === target && created)
    ),
    pathStat: () => ({ isSymbolicLink: () => false }),
  }), /could not safely re-prove.*retained.*owner-led recovery/);

  assert.deepEqual(calls, [
    ["git", "fetch", "origin", "main"],
    ["git", "worktree", "add", "--detach", target, sha],
  ]);
  assert.equal(created, true);
});

test("provision derives the shared task root from Git ownership when canonical main is displaced", () => {
  assert.equal(
    deriveTaskWorktreeRoot(
      "/workspace/.worktrees/canonical/repository",
      "/workspace/repository/.git",
    ),
    path.resolve("/workspace/.worktrees/repository"),
  );
});

test("provision rejects collisions and paths outside the derived safe root before git mutation", () => {
  for (const candidate of [target, "/workspace/other/task", "relative-task"]) {
    const calls = [];
    assert.throws(() => provisionTaskWorktree({
      invocationPath: repoRoot,
      repoRoot,
      targetPath: candidate,
      gitText: gitTextFor(),
      run: (command, args) => calls.push([command, ...args]),
      makeDirectory: () => {},
      pathExists: value => value === target,
      pathStat: () => ({ isSymbolicLink: () => false }),
    }), /already exists|safe direct child|must be absolute/);
    assert.deepEqual(calls, []);
  }
});

test("provision rejects dirty or divergent canonical main without creating a worktree", () => {
  for (const overrides of [
    { "status --porcelain": " M source.js" },
    { "rev-parse HEAD": "b".repeat(40) },
  ]) {
    const calls = [];
    assert.throws(() => provisionTaskWorktree({
      invocationPath: repoRoot,
      repoRoot,
      targetPath: target,
      gitText: gitTextFor(overrides),
      run: (command, args) => calls.push([command, ...args]),
      makeDirectory: () => {},
      pathExists: () => false,
      pathStat: () => ({ isSymbolicLink: () => false }),
    }), /clean|must equal/);
    assert.equal(calls.some(call => call.includes("worktree")), false);
  }
});

test("rollback removes only the clean detached exact-base worktree before any lease claim", () => {
  const calls = [];
  const provision = { target, baseSha: sha };
  const detached = `${canonicalRecord}\0worktree ${target}\0HEAD ${sha}\0detached\0`;
  const gitText = gitTextFor({
    "worktree list --porcelain -z": detached,
    [`-C ${target} status --porcelain`]: "",
    [`-C ${target} rev-parse HEAD`]: sha,
  });
  assert.equal(rollbackUnclaimedProvision({
    provision,
    registryUnchanged: true,
    gitText,
    run: (command, args) => calls.push([command, ...args]),
    pathExists: () => true,
  }), true);
  assert.deepEqual(calls, [["git", "worktree", "remove", target]]);
  // A changed registry models leaseStore.claim succeeding before a later git switch failure.
  assert.equal(rollbackUnclaimedProvision({
    provision,
    registryUnchanged: false,
    gitText,
    run: () => { throw new Error("must not run"); },
    pathExists: () => true,
  }), false);
});

test("provision rejects any symbolic-link ancestor inside the derived workspace root", () => {
  const linked = path.dirname(safeRoot);
  assert.throws(() => provisionTaskWorktree({
    invocationPath: repoRoot,
    repoRoot,
    targetPath: target,
    gitText: gitTextFor(),
    run: () => { throw new Error("must not run"); },
    makeDirectory: () => { throw new Error("must not create"); },
    pathExists: candidate => [path.dirname(repoRoot), linked].includes(candidate),
    pathStat: candidate => ({ isSymbolicLink: () => candidate === linked }),
  }), /cannot traverse a symbolic link/);
});
