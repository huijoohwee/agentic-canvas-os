import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { createRecoverableLaneCleanupController } from "../scripts/recoverable-lane-cleanup-controller.mjs";
import { createRecoverableLaneCleanupRepositoryAdapter } from "../scripts/recoverable-lane-cleanup-repository-adapter.mjs";

test("repository adapter captures one exact clean attached noncanonical lane", () => {
  withFixture(fixture => {
    const adapter = createAdapter(fixture);
    const evidence = adapter.captureEvidence({});
    assert.equal(evidence.canonical.headSha, fixture.mainSha);
    assert.equal(evidence.target.headSha, fixture.laneSha);
    assert.equal(evidence.target.branch, "refs/heads/agent/device/cleanup-lane");
    assert.equal(evidence.authority.currentLocalWriter, false);
    assert.equal(evidence.authority.disposition, "unowned-terminal");
  });
});

test("canonical ignored residue is not part of the removed-lane cleanliness gate", () => {
  withFixture(fixture => {
    writeFileSync(path.join(fixture.repo, "late-ignored.txt"), "canonical ignored residue\n");
    assert.doesNotThrow(() => createAdapter(fixture).captureEvidence({}));
  });
});

test("repository adapter binds every observed preservation receipt", () => {
  withFixture(fixture => {
    const receiptDigest = "8".repeat(64);
    const adapter = createAdapter(fixture, {
      readPreservationReceipts: () => [receiptDigest],
    });
    const controller = createRecoverableLaneCleanupController({ adapter });
    const input = request(fixture);
    assert.throws(() => controller.plan(input), /supersede the exact observed/);
    const planned = controller.plan({
      ...input, supersededPreservationDigests: [receiptDigest],
    });
    assert.deepEqual(planned.plan.supersededPreservationDigests, [receiptDigest]);
  });
});

test("repository adapter discovers a completed dormant-preservation journal", () => {
  withFixture(fixture => {
    const receiptDigest = "9".repeat(64);
    const directory = path.join(
      fixture.repo, ".git", "agentic-canvas-os", "dormant-preservation-admission",
    );
    mkdirSync(directory, { recursive: true });
    const intent = {
      status: "complete",
      planSnapshot: {
        sourceEvidence: {
          preservation: {
            selectedLanes: [{ worktree: {
              path: fixture.worktree,
              branch: "refs/heads/agent/device/cleanup-lane",
              headSha: fixture.laneSha,
              treeSha: git(fixture.worktree, ["rev-parse", "HEAD^{tree}"]).trim(),
            } }],
          },
        },
      },
      phases: { complete: { values: { receipt: { receiptDigest } } } },
    };
    writeFileSync(path.join(directory, "preservation.json"), `${JSON.stringify({
      schema: "agentic-dormant-preservation-admission-journal/v1",
      intent,
      intentDigest: digestValue(intent),
    })}\n`);
    const adapter = createAdapter(fixture, { normalizeDormantIntent: value => value });
    const controller = createRecoverableLaneCleanupController({ adapter });
    const input = request(fixture);
    assert.throws(() => controller.plan(input), /supersede the exact observed/);
    const planned = controller.plan({
      ...input, supersededPreservationDigests: [receiptDigest],
    });
    assert.deepEqual(planned.plan.supersededPreservationDigests, [receiptDigest]);
  });
});

test("repository adapter refuses tracked, untracked, ignored, unmerged, and operation residue", () => {
  withFixture(fixture => {
    writeFileSync(path.join(fixture.worktree, "README.md"), "tracked dirt\n");
    assert.throws(() => createAdapter(fixture).captureEvidence({}), /clean/);
  });
  withFixture(fixture => {
    writeFileSync(path.join(fixture.worktree, "README.md"), "staged dirt\n");
    git(fixture.worktree, ["add", "README.md"]);
    assert.throws(() => createAdapter(fixture).captureEvidence({}), /clean/);
  });
  withFixture(fixture => {
    writeFileSync(path.join(fixture.worktree, "dirty.txt"), "dirty\n");
    assert.throws(() => createAdapter(fixture).captureEvidence({}), /clean/);
  });
  withFixture(fixture => {
    writeFileSync(path.join(fixture.worktree, ".gitignore"), "ignored.txt\n");
    git(fixture.worktree, ["add", ".gitignore"]);
    git(fixture.worktree, ["commit", "-m", "test: ignore residue"]);
    writeFileSync(path.join(fixture.worktree, "ignored.txt"), "ignored\n");
    assert.throws(() => createAdapter(fixture).captureEvidence({}), /clean/);
  });
  withFixture(fixture => {
    const mergeHeadPath = git(fixture.worktree, ["rev-parse", "--git-path", "MERGE_HEAD"]).trim();
    writeFileSync(mergeHeadPath, `${fixture.mainSha}\n`);
    assert.throws(() => createAdapter(fixture).captureEvidence({}), /in-progress Git state/);
  });
});

test("controller with repository adapter bundles, verifies, removes non-force, and preserves refs", () => {
  withFixture(fixture => {
    const invocations = [];
    const adapter = createAdapter(fixture, {
      git(cwd, args) {
        invocations.push([...args]);
        return git(cwd, args);
      },
      checkpoint(name) {
        if (name === "after-worktree-move") writeFileSync(
          path.join(fixture.recovery, "worktree-staging", "late-ignored.txt"),
          "late but preserved\n",
        );
      },
    });
    const controller = createRecoverableLaneCleanupController({ adapter });
    const input = request(fixture);
    const planned = controller.plan(input);
    assert.equal(existsSync(fixture.recovery), false);
    const result = controller.run({
      ...input,
      planDigest: planned.planDigest,
      authorization: planned.exactAuthorization,
    });
    assert.equal(result.status, "complete");
    assert.equal(existsSync(fixture.worktree), false);
    assert.equal(git(fixture.repo, ["show-ref", "--verify", "refs/heads/agent/device/cleanup-lane"]).trim().split(" ")[0], fixture.laneSha);
    assert.equal(git(fixture.repo, ["rev-parse", "HEAD"]).trim(), fixture.mainSha);
    assert.equal(existsSync(path.join(fixture.recovery, "lane.bundle")), true);
    assert.equal(existsSync(path.join(fixture.recovery, "cleanup-intent.json")), true);
    assert.equal(existsSync(path.join(fixture.recovery, "cleanup-receipt.json")), true);
    assert.equal(existsSync(path.join(fixture.recovery, "worktree-snapshot", "lane.txt")), true);
    assert.equal(git(path.join(fixture.recovery, "worktree-snapshot"), ["status", "--porcelain"]), "");
    assert.equal(existsSync(path.join(fixture.recovery, "worktree-gitdir-snapshot", "HEAD")), true);
    assert.equal(
      readFileSync(path.join(fixture.recovery, "worktree-snapshot", "late-ignored.txt"), "utf8"),
      "late but preserved\n",
    );
    const receipt = JSON.parse(readFileSync(path.join(fixture.recovery, "cleanup-receipt.json"), "utf8"));
    assert.equal(receipt.effects.localBranch, "preserve");
    assert.deepEqual(
      invocations.filter(args => args[0] === "worktree" && args[1] === "remove"),
      [["worktree", "remove", "--", path.join(fixture.recovery, "worktree-staging")]],
    );
    assert.deepEqual(
      invocations.filter(args => args[0] === "worktree" && args[1] === "move"),
      [[
        "worktree", "move", "--", fixture.worktree,
        path.join(fixture.recovery, "worktree-staging"),
      ]],
    );
    assert.equal(invocations.some(args => args.includes("--force")), false);
    assert.equal(invocations.some(args => args[0] === "worktree" && args[1] === "prune"), false);
    assert.equal(invocations.some(args => args[0] === "branch" || args[0] === "push"), false);
    const replay = controller.run({
      ...input,
      planDigest: planned.planDigest,
      authorization: planned.exactAuthorization,
    });
    assert.equal(replay.receipt.receiptDigest, result.receipt.receiptDigest);
    const latePath = path.join(fixture.recovery, "worktree-snapshot", "late-ignored.txt");
    writeFileSync(latePath, "tampered snapshot\n");
    assert.throws(() => controller.run({
      ...input, planDigest: planned.planDigest, authorization: planned.exactAuthorization,
    }), /snapshot|drifted/i);
    assert.throws(() => controller.observe({
      ...input, planDigest: planned.planDigest,
    }), /snapshot|drifted/i);
    writeFileSync(latePath, "late but preserved\n");
    assert.equal(controller.run({
      ...input, planDigest: planned.planDigest, authorization: planned.exactAuthorization,
    }).status, "complete");
    const bundlePath = path.join(fixture.recovery, "lane.bundle");
    const bundleBytes = readFileSync(bundlePath);
    writeFileSync(bundlePath, Buffer.concat([bundleBytes, Buffer.from("corrupt")]));
    assert.throws(() => controller.run({
      ...input,
      planDigest: planned.planDigest,
      authorization: planned.exactAuthorization,
    }), /bundle|trailer|pack|index|drift/i);
    writeFileSync(bundlePath, bundleBytes);
    mkdirSync(fixture.worktree);
    assert.throws(() => controller.run({
      ...input,
      planDigest: planned.planDigest,
      authorization: planned.exactAuthorization,
    }), /recreated|drifted/);
    rmSync(fixture.worktree, { recursive: true });
    const snapshotPath = path.join(fixture.recovery, "worktree-snapshot");
    rmSync(snapshotPath, { recursive: true });
    mkdirSync(snapshotPath, { mode: 0o700 });
    assert.throws(() => controller.run({
      ...input, planDigest: planned.planDigest, authorization: planned.exactAuthorization,
    }), /snapshot|drifted/i);
  });
});

test("real adapter replays every checkout, Git-directory, and removal crash boundary", () => {
  for (const boundary of [
    "after-worktree-move", "after-checkout-snapshot", "after-gitdir-snapshot",
    "after-snapshot-seal", "after-disposable-copy", "after-disposable-publish",
    "before-worktree-remove", "after-worktree-remove",
  ]) withFixture(fixture => {
    let injected = false;
    const first = createRecoverableLaneCleanupController({ adapter: createAdapter(fixture, {
      checkpoint(name) {
        if (!injected && name === boundary) {
          injected = true;
          throw new Error(`simulated crash at ${name}`);
        }
      },
    }) });
    const input = request(fixture);
    const planned = first.plan(input);
    assert.throws(() => first.run({
      ...input, planDigest: planned.planDigest, authorization: planned.exactAuthorization,
    }), new RegExp(`simulated crash at ${boundary}`));
    assert.equal(injected, true);
    const replay = createRecoverableLaneCleanupController({ adapter: createAdapter(fixture) });
    const result = replay.run({
      ...input, planDigest: planned.planDigest, authorization: planned.exactAuthorization,
    });
    assert.equal(result.status, "complete");
    assert.equal(existsSync(fixture.worktree), false);
    assert.equal(git(path.join(fixture.recovery, "worktree-snapshot"), ["status", "--porcelain"]), "");
    assert.equal(existsSync(path.join(fixture.recovery, "worktree-gitdir-snapshot", "HEAD")), true);
  });
});

test("recovery path must be absent, external, and backed by a real parent", () => {
  withFixture(fixture => {
    mkdirSync(fixture.recovery);
    assert.throws(() => createAdapter(fixture).captureEvidence({}), /must be absent/);
  });
  withFixture(fixture => {
    const adapter = createRecoverableLaneCleanupRepositoryAdapter({
      repository: fixture.repo,
      worktree: fixture.worktree,
      recoveryDirectory: path.join(fixture.repo, "recovery"),
    });
    const controller = createRecoverableLaneCleanupController({ adapter });
    assert.throws(() => controller.plan({
      ...request(fixture),
      recoveryDirectory: path.join(fixture.repo, "recovery"),
    }), /isolated/);
  });
});

test("subject fence recovers a dead owner and refuses a live owner", () => {
  withFixture(fixture => {
    const adapter = createAdapter(fixture);
    const controller = createRecoverableLaneCleanupController({ adapter });
    const input = request(fixture);
    const planned = controller.plan(input);
    const lockPath = subjectLockPath(fixture, planned.subjectKey);
    mkdirSync(path.dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, `${JSON.stringify({ pid: 99_999_999, token: "dead" })}\n`);
    const result = controller.run({
      ...input, planDigest: planned.planDigest, authorization: planned.exactAuthorization,
    });
    assert.equal(result.status, "complete");
  });
  withFixture(fixture => {
    const adapter = createAdapter(fixture);
    const controller = createRecoverableLaneCleanupController({ adapter });
    const input = request(fixture);
    const planned = controller.plan(input);
    const lockPath = subjectLockPath(fixture, planned.subjectKey);
    mkdirSync(path.dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, `${JSON.stringify({ pid: process.pid, token: "live" })}\n`);
    assert.throws(() => controller.run({
      ...input, planDigest: planned.planDigest, authorization: planned.exactAuthorization,
    }), /already fenced/);
    assert.equal(existsSync(fixture.worktree), true);
    assert.equal(existsSync(fixture.recovery), false);
  });
});

function createAdapter(fixture, options = {}) {
  return createRecoverableLaneCleanupRepositoryAdapter({
    repository: fixture.repo,
    worktree: fixture.worktree,
    recoveryDirectory: fixture.recovery,
    readRemoteAuthority: () => remoteAuthority(),
    ...options,
  });
}

function remoteAuthority() {
  const core = {
    provider: "neutral-test", ledgerRepository: "owner/repo",
    targetRepository: "owner/repo", targetClaims: [],
    currentRemoteWriter: false, waitingSuccessors: 0,
  };
  return { ...core, verificationReceiptDigest: digestValue(core) };
}

function subjectLockPath(fixture, subjectKey) {
  return path.join(
    fixture.repo, ".git", "agentic-canvas-os", "recoverable-lane-cleanup",
    `${subjectKey}.lock`,
  );
}

function request(fixture) {
  return {
    repository: fixture.repo,
    worktree: fixture.worktree,
    recoveryDirectory: fixture.recovery,
    sessionId: "session-cleanup",
    operatorDecisionDigest: "7".repeat(64),
    supersededPreservationDigests: [],
  };
}

function withFixture(action) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "acos-cleanup-adapter-")));
  const remote = path.join(root, "remote.git");
  const repo = path.join(root, "repo");
  const worktree = path.join(root, "lane");
  const recovery = path.join(root, "recovery", "lane-a");
  try {
    mkdirSync(path.dirname(recovery));
    git(root, ["init", "--bare", remote]);
    git(root, ["init", "-b", "main", repo]);
    git(repo, ["config", "user.name", "Cleanup Test"]);
    git(repo, ["config", "user.email", "cleanup@example.test"]);
    writeFileSync(path.join(repo, "README.md"), "main\n");
    writeFileSync(path.join(repo, ".gitignore"), "late-ignored.txt\n");
    git(repo, ["add", "README.md", ".gitignore"]);
    git(repo, ["commit", "-m", "initial"]);
    git(repo, ["remote", "add", "origin", remote]);
    git(repo, ["push", "-u", "origin", "main"]);
    git(repo, ["worktree", "add", "-b", "agent/device/cleanup-lane", worktree, "main"]);
    writeFileSync(path.join(worktree, "lane.txt"), "lane\n");
    git(worktree, ["add", "lane.txt"]);
    git(worktree, ["commit", "-m", "feat: lane"]);
    git(worktree, ["push", "-u", "origin", "agent/device/cleanup-lane"]);
    const fixture = {
      root,
      remote,
      repo,
      worktree,
      recovery,
      mainSha: git(repo, ["rev-parse", "main"]).trim(),
      laneSha: git(worktree, ["rev-parse", "HEAD"]).trim(),
    };
    action(fixture);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
