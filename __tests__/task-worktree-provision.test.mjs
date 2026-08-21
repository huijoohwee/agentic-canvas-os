import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  cleanupEmptyTaskWorktreeContainers,
  deriveTaskWorktreeContainers,
} from "../scripts/task-worktree-owned-containers.mjs";
import {
  deriveTaskWorktreeRoot,
  inspectTaskWorktreeTarget,
  provisionTaskWorktree,
  recoverCandidateCreateRegisterResult,
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

test("clean canonical main behind origin is preserved while the candidate starts at origin", () => {
  const behindSha = "b".repeat(40);
  const treeSha = "c".repeat(40);
  const behindRecord = `worktree ${repoRoot}\0HEAD ${behindSha}\0branch refs/heads/main\0`;
  const registeredCandidate =
    `${behindRecord}\0worktree ${target}\0HEAD ${sha}\0detached\0`;
  let created = false;
  const gitText = gitTextFor({
    "worktree list --porcelain -z": behindRecord,
    "rev-parse HEAD": behindSha,
    [`merge-base --is-ancestor ${behindSha} ${sha}`]: "",
  });
  const targetPlan = inspectTaskWorktreeTarget({
    invocationPath: repoRoot,
    repoRoot,
    targetPath: target,
    gitText,
    pathExists: () => false,
    pathStat: () => ({ isSymbolicLink: () => false }),
  });
  assert.equal(targetPlan.canonicalSourceDisposition, "preserved-behind");

  const result = provisionTaskWorktree({
    invocationPath: repoRoot,
    repoRoot,
    targetPath: target,
    expectedBaseSha: sha,
    expectedTargetObservationDigest: targetPlan.targetObservationDigest,
    fetchBase: false,
    gitText: args => {
      const key = args.join(" ");
      if (key === "worktree list --porcelain -z") {
        return created ? registeredCandidate : behindRecord;
      }
      if (key === `rev-parse ${sha}^{tree}`) return treeSha;
      if (key === `-C ${target} rev-parse HEAD`) return sha;
      if (key === `-C ${target} rev-parse HEAD^{tree}`) return treeSha;
      if (key === `-C ${target} status --porcelain=v1 -z --untracked-files=all`) return "";
      if (key === `-C ${target} rev-parse --show-toplevel`) return target;
      return gitText(args);
    },
    run: (command, args) => {
      if (command === "git" && args[0] === "worktree" && args[1] === "add") {
        created = true;
      }
    },
    makeDirectory: () => {},
    pathExists: candidate => candidate === path.dirname(safeRoot),
    pathStat: () => ({ isSymbolicLink: () => false }),
  });
  assert.equal(result.baseSha, sha);
  assert.equal(created, true);
});

test("dirty canonical main is eligible only for the explicit root-bootstrap provisioner", () => {
  const behindSha = "b".repeat(40);
  const treeSha = "c".repeat(40);
  const behindRecord = `worktree ${repoRoot}\0HEAD ${behindSha}\0branch refs/heads/main\0`;
  const registeredCandidate =
    `${behindRecord}\0worktree ${target}\0HEAD ${sha}\0detached\0`;
  let created = false;
  const gitText = gitTextFor({
    "worktree list --porcelain -z": behindRecord,
    "status --porcelain": " M docs/retained.md",
    "rev-parse HEAD": behindSha,
    [`merge-base --is-ancestor ${behindSha} ${sha}`]: "",
  });
  const targetPlan = inspectTaskWorktreeTarget({
    invocationPath: repoRoot,
    repoRoot,
    targetPath: target,
    gitText,
    pathExists: () => false,
    pathStat: () => ({ isSymbolicLink: () => false }),
    allowDirtyCanonicalForRootBootstrap: true,
  });
  assert.equal(targetPlan.canonicalSourceDisposition, "root-bootstrap-dirty");

  const result = provisionTaskWorktree({
    invocationPath: repoRoot,
    repoRoot,
    targetPath: target,
    expectedBaseSha: sha,
    expectedTargetObservationDigest: targetPlan.targetObservationDigest,
    fetchBase: false,
    gitText: args => {
      const key = args.join(" ");
      if (key === "worktree list --porcelain -z") {
        return created ? registeredCandidate : behindRecord;
      }
      if (key === `rev-parse ${sha}^{tree}`) return treeSha;
      if (key === `-C ${target} rev-parse HEAD`) return sha;
      if (key === `-C ${target} rev-parse HEAD^{tree}`) return treeSha;
      if (key === `-C ${target} status --porcelain=v1 -z --untracked-files=all`) return "";
      if (key === `-C ${target} rev-parse --show-toplevel`) return target;
      return gitText(args);
    },
    run: (command, args) => {
      if (command === "git" && args[0] === "worktree" && args[1] === "add") {
        created = true;
      }
    },
    makeDirectory: () => {},
    pathExists: candidate => candidate === path.dirname(safeRoot),
    pathStat: () => ({ isSymbolicLink: () => false }),
    allowDirtyCanonicalForRootBootstrap: true,
  });
  assert.equal(result.baseSha, sha);
  assert.equal(created, true);
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

test("owned-container cleanup removes only the empty managed root and shared root leaf-to-root", () => {
  withOwnedContainerFixture(fixture => {
    mkdirSync(fixture.managedRoot, { recursive: true });
    const ownership = deriveTaskWorktreeContainers({
      repoRoot: fixture.repoRoot,
      gitCommonDir: fixture.gitCommonDir,
      targetPath: fixture.target,
    });
    assert.equal(ownership.kind, "managed");
    assert.equal(ownership.managedContainer.root, fixture.managedRoot);
    assert.equal(ownership.sharedContainer.root, fixture.sharedRoot);

    const result = cleanupEmptyTaskWorktreeContainers({
      repoRoot: fixture.repoRoot,
      gitCommonDir: fixture.gitCommonDir,
      targetPath: fixture.target,
    });
    assert.deepEqual(result, {
      kind: "managed",
      managedContainer: { root: fixture.managedRoot, disposition: "removed-empty" },
      sharedContainer: { root: fixture.sharedRoot, disposition: "removed-empty" },
      removedEmptyDirectories: [fixture.managedRoot, fixture.sharedRoot],
    });
    assert.equal(existsSync(fixture.managedRoot), false);
    assert.equal(existsSync(fixture.sharedRoot), false);

    assert.deepEqual(cleanupEmptyTaskWorktreeContainers({
      repoRoot: fixture.repoRoot,
      gitCommonDir: fixture.gitCommonDir,
    }), {
      kind: "managed",
      managedContainer: { root: fixture.managedRoot, disposition: "absent" },
      sharedContainer: { root: fixture.sharedRoot, disposition: "absent" },
      removedEmptyDirectories: [],
    });
  });
});

test("owned-container cleanup retains nonempty task and repository siblings", () => {
  withOwnedContainerFixture(fixture => {
    mkdirSync(path.join(fixture.managedRoot, "other-task"), { recursive: true });
    const result = cleanupEmptyTaskWorktreeContainers({
      repoRoot: fixture.repoRoot,
      gitCommonDir: fixture.gitCommonDir,
      targetPath: fixture.target,
    });
    assert.equal(result.managedContainer.disposition, "retained-nonempty");
    assert.equal(result.sharedContainer.disposition, "not-attempted");
    assert.deepEqual(result.removedEmptyDirectories, []);
    assert.equal(existsSync(path.join(fixture.managedRoot, "other-task")), true);
  });

  withOwnedContainerFixture(fixture => {
    mkdirSync(fixture.managedRoot, { recursive: true });
    const otherRepository = path.join(fixture.sharedRoot, "other-repository");
    mkdirSync(otherRepository);
    const result = cleanupEmptyTaskWorktreeContainers({
      repoRoot: fixture.repoRoot,
      gitCommonDir: fixture.gitCommonDir,
    });
    assert.equal(result.managedContainer.disposition, "removed-empty");
    assert.equal(result.sharedContainer.disposition, "retained-nonempty");
    assert.deepEqual(result.removedEmptyDirectories, [fixture.managedRoot]);
    assert.equal(existsSync(otherRepository), true);
    const replay = cleanupEmptyTaskWorktreeContainers({
      repoRoot: fixture.repoRoot,
      gitCommonDir: fixture.gitCommonDir,
    });
    assert.equal(replay.managedContainer.disposition, "absent");
    assert.equal(replay.sharedContainer.disposition, "retained-nonempty");
    assert.deepEqual(replay.removedEmptyDirectories, []);
    assert.equal(existsSync(otherRepository), true);
  });
});

test("owned-container cleanup treats non-direct-child targets as external without mutation", () => {
  for (const selectTarget of [
    fixture => path.join(fixture.workspace, "external-task"),
    fixture => path.join(fixture.managedRoot, "nested", "task"),
    () => "relative-task",
  ]) withOwnedContainerFixture(fixture => {
    mkdirSync(fixture.managedRoot, { recursive: true });
    const result = cleanupEmptyTaskWorktreeContainers({
      repoRoot: fixture.repoRoot,
      gitCommonDir: fixture.gitCommonDir,
      targetPath: selectTarget(fixture),
    });
    assert.deepEqual(result, {
      kind: "external",
      managedContainer: { root: fixture.managedRoot, disposition: "not-managed" },
      sharedContainer: { root: fixture.sharedRoot, disposition: "not-managed" },
      removedEmptyDirectories: [],
    });
    assert.equal(existsSync(fixture.managedRoot), true);
    assert.equal(existsSync(fixture.sharedRoot), true);
  });
});

test("owned-container cleanup never traverses managed or shared symlinks", () => {
  withOwnedContainerFixture(fixture => {
    const linkedRoot = path.join(fixture.workspace, "linked-managed-root");
    mkdirSync(linkedRoot);
    mkdirSync(fixture.sharedRoot);
    symlinkSync(linkedRoot, fixture.managedRoot);
    const result = cleanupEmptyTaskWorktreeContainers({
      repoRoot: fixture.repoRoot,
      gitCommonDir: fixture.gitCommonDir,
    });
    assert.equal(result.managedContainer.disposition, "retained-symlink");
    assert.equal(result.sharedContainer.disposition, "not-attempted");
    assert.deepEqual(result.removedEmptyDirectories, []);
    assert.equal(existsSync(linkedRoot), true);
  });

  withOwnedContainerFixture(fixture => {
    const linkedSharedRoot = path.join(fixture.workspace, "linked-shared-root");
    mkdirSync(path.join(linkedSharedRoot, path.basename(fixture.repoRoot)), { recursive: true });
    symlinkSync(linkedSharedRoot, fixture.sharedRoot);
    const result = cleanupEmptyTaskWorktreeContainers({
      repoRoot: fixture.repoRoot,
      gitCommonDir: fixture.gitCommonDir,
    });
    assert.equal(result.managedContainer.disposition, "not-attempted");
    assert.equal(result.sharedContainer.disposition, "retained-symlink");
    assert.deepEqual(result.removedEmptyDirectories, []);
    assert.equal(existsSync(path.join(linkedSharedRoot, path.basename(fixture.repoRoot))), true);
  });
});

test("owned-container cleanup rejects a shared-container identity swap before managed removal", () => {
  withOwnedContainerFixture(fixture => {
    mkdirSync(fixture.managedRoot, { recursive: true });
    const displacedShared = path.join(fixture.workspace, "displaced-shared");
    const externalShared = path.join(fixture.workspace, "external-shared");
    const externalManaged = path.join(externalShared, path.basename(fixture.repoRoot));
    mkdirSync(externalManaged, { recursive: true });
    let workspaceProbes = 0;
    const removals = [];

    const result = cleanupEmptyTaskWorktreeContainers({
      repoRoot: fixture.repoRoot,
      gitCommonDir: fixture.gitCommonDir,
      pathStat: candidate => {
        if (candidate === fixture.workspace && ++workspaceProbes === 2) {
          renameSync(fixture.sharedRoot, displacedShared);
          symlinkSync(externalShared, fixture.sharedRoot);
        }
        return lstatSync(candidate);
      },
      removeDirectory: candidate => {
        removals.push(candidate);
        rmdirSync(candidate);
      },
    });

    assert.deepEqual(removals, []);
    assert.equal(result.managedContainer.disposition, "retained-ambiguous");
    assert.equal(result.sharedContainer.disposition, "retained-ambiguous");
    assert.deepEqual(result.removedEmptyDirectories, []);
    assert.equal(existsSync(externalManaged), true);
    assert.equal(existsSync(path.join(displacedShared, path.basename(fixture.repoRoot))), true);
  });
});

test("owned-container cleanup rejects a managed-container identity swap before removal", () => {
  withOwnedContainerFixture(fixture => {
    mkdirSync(fixture.managedRoot, { recursive: true });
    const displacedManaged = path.join(fixture.workspace, "displaced-managed");
    const externalManaged = path.join(fixture.workspace, "external-managed");
    mkdirSync(externalManaged);
    let workspaceProbes = 0;
    const removals = [];

    const result = cleanupEmptyTaskWorktreeContainers({
      repoRoot: fixture.repoRoot,
      gitCommonDir: fixture.gitCommonDir,
      pathStat: candidate => {
        if (candidate === fixture.workspace && ++workspaceProbes === 2) {
          renameSync(fixture.managedRoot, displacedManaged);
          renameSync(externalManaged, fixture.managedRoot);
        }
        return lstatSync(candidate);
      },
      removeDirectory: candidate => {
        removals.push(candidate);
        rmdirSync(candidate);
      },
    });

    assert.deepEqual(removals, []);
    assert.equal(result.managedContainer.disposition, "retained-ambiguous");
    assert.equal(result.sharedContainer.disposition, "retained-ambiguous");
    assert.deepEqual(result.removedEmptyDirectories, []);
    assert.equal(existsSync(fixture.managedRoot), true);
    assert.equal(existsSync(displacedManaged), true);
  });
});

test("owned-container cleanup revalidates the shared identity after managed removal", () => {
  withOwnedContainerFixture(fixture => {
    mkdirSync(fixture.managedRoot, { recursive: true });
    const displacedShared = path.join(fixture.workspace, "displaced-after-managed-removal");
    const externalShared = path.join(fixture.workspace, "external-after-managed-removal");
    mkdirSync(externalShared);
    const removals = [];

    const result = cleanupEmptyTaskWorktreeContainers({
      repoRoot: fixture.repoRoot,
      gitCommonDir: fixture.gitCommonDir,
      removeDirectory: candidate => {
        removals.push(candidate);
        rmdirSync(candidate);
        if (candidate === fixture.managedRoot) {
          renameSync(fixture.sharedRoot, displacedShared);
          symlinkSync(externalShared, fixture.sharedRoot);
        }
      },
    });

    assert.deepEqual(removals, [fixture.managedRoot]);
    assert.equal(result.managedContainer.disposition, "removed-empty");
    assert.equal(result.sharedContainer.disposition, "retained-ambiguous");
    assert.deepEqual(result.removedEmptyDirectories, [fixture.managedRoot]);
    assert.equal(existsSync(externalShared), true);
    assert.equal(existsSync(displacedShared), true);
  });
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
    }), /clean|must be an ancestor/);
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

test("rollback removes empty owned containers after the exact candidate worktree", () => {
  withOwnedContainerFixture(fixture => {
    mkdirSync(fixture.target, { recursive: true });
    const detached = [
      `worktree ${fixture.repoRoot}\0HEAD ${sha}\0branch refs/heads/main\0`,
      `worktree ${fixture.target}\0HEAD ${sha}\0detached\0`,
    ].join("\0");
    const gitText = args => {
      const key = args.join(" ");
      if (key === "worktree list --porcelain -z") return detached;
      if (key === `-C ${fixture.target} status --porcelain`) return "";
      if (key === `-C ${fixture.target} rev-parse HEAD`) return sha;
      if (key === "rev-parse --git-common-dir") return fixture.gitCommonDir;
      throw new Error(`unexpected git command: ${key}`);
    };
    assert.equal(rollbackUnclaimedProvision({
      provision: {
        canonicalRoot: fixture.repoRoot,
        safeRoot: fixture.managedRoot,
        target: fixture.target,
        baseSha: sha,
      },
      candidateUnclaimed: true,
      gitText,
      run: (command, args) => {
        assert.deepEqual([command, ...args], ["git", "worktree", "remove", fixture.target]);
        rmSync(fixture.target, { recursive: true });
      },
    }), true);
    assert.equal(existsSync(fixture.target), false);
    assert.equal(existsSync(fixture.managedRoot), false);
    assert.equal(existsSync(fixture.sharedRoot), false);
  });
});

test("interrupted admission recovery reconstructs only the exact clean pushed fence candidate", () => {
  const fenceSha = "b".repeat(40);
  const treeSha = "c".repeat(40);
  const branch = "agent/device-a/work-item-42";
  const epoch = 7;
  const registry = [
    canonicalRecord,
    `worktree ${target}\0HEAD ${fenceSha}\0branch refs/heads/${branch}\0`,
  ].join("\0");
  const responses = {
    "rev-parse --git-common-dir": gitCommonDir,
    "worktree list --porcelain -z": registry,
    [`rev-parse ${sha}^{tree}`]: treeSha,
    [`-C ${target} rev-parse HEAD`]: fenceSha,
    [`-C ${target} rev-parse HEAD^{tree}`]: treeSha,
    [`-C ${target} branch --show-current`]: branch,
    [`-C ${target} status --porcelain=v1 -z --untracked-files=all`]: "",
    [`-C ${target} rev-parse HEAD^`]: sha,
    [`-C ${target} log -1 --format=%s`]:
      `chore(coordination): claim work-item-42 lease ${epoch}`,
    [`-C ${target} rev-list --count ${sha}..${fenceSha}`]: "1",
    [`ls-remote origin refs/heads/${branch}`]:
      `${fenceSha}\trefs/heads/${branch}`,
    "rev-parse HEAD": sha,
    "status --porcelain": "",
  };
  const gitText = args => {
    const key = args.join(" ");
    if (!(key in responses)) throw new Error(`unexpected git command: ${key}`);
    return responses[key];
  };
  const recovered = recoverCandidateCreateRegisterResult({
    repoRoot,
    targetPath: target,
    expectedBaseSha: sha,
    expectedBranch: branch,
    expectedFenceSha: fenceSha,
    expectedScope: "work-item-42",
    expectedLeaseEpoch: epoch,
    gitText,
  });
  assert.equal(recovered.status, "created");
  assert.equal(recovered.targetPath, target);
  assert.equal(recovered.baseSha, sha);
  assert.deepEqual(recovered.mutationSet, ["candidate-registration"]);
  assert.match(recovered.resultDigest, /^[0-9a-f]{64}$/u);

  responses[`-C ${target} status --porcelain=v1 -z --untracked-files=all`] =
    "?? authored.mjs\0";
  assert.throws(() => recoverCandidateCreateRegisterResult({
    repoRoot,
    targetPath: target,
    expectedBaseSha: sha,
    expectedBranch: branch,
    expectedFenceSha: fenceSha,
    expectedScope: "work-item-42",
    expectedLeaseEpoch: epoch,
    gitText,
  }), /exact clean, pushed, fence-only continuation/);
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

function withOwnedContainerFixture(action) {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "acos-owned-containers-"));
  const repo = path.join(workspace, "repository");
  const common = path.join(repo, ".git");
  const shared = path.join(workspace, ".worktrees");
  const managed = path.join(shared, path.basename(repo));
  mkdirSync(common, { recursive: true });
  try {
    action({
      workspace,
      repoRoot: repo,
      gitCommonDir: common,
      sharedRoot: shared,
      managedRoot: managed,
      target: path.join(managed, "task-a"),
    });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}
