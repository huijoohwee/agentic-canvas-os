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

function gitTextFor(overrides = {}) {
  const responses = {
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
  let originReads = 0;
  const baseGitText = gitTextFor();
  const result = provisionTaskWorktree({
    invocationPath: repoRoot,
    repoRoot,
    targetPath: target,
    gitText: args => args.join(" ") === "rev-parse origin/main"
      ? (++originReads === 1 ? sha : advancedSha)
      : baseGitText(args),
    run: (command, args) => calls.push([command, ...args]),
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
