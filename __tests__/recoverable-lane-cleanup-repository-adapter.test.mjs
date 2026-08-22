import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync, mkdtempSync, mkdirSync, readFileSync, readlinkSync,
  realpathSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { createRecoverableLaneCleanupController } from "../scripts/recoverable-lane-cleanup-controller.mjs";
import { createRecoverableLaneCleanupRepositoryAdapter,
  inspectRemoteAuthority } from "../scripts/recoverable-lane-cleanup-repository-adapter.mjs";
test("repository adapter captures one exact clean attached noncanonical lane", () => {
  withFixture(fixture => {
    const adapter = createAdapter(fixture);
    const evidence = adapter.captureEvidence({});
    assert.equal(evidence.canonical.headSha, fixture.mainSha);
    assert.equal(evidence.target.headSha, fixture.laneSha);
    assert.equal(evidence.target.branch, "refs/heads/agent/device/cleanup-lane");
    assert.equal(evidence.authority.currentLocalWriter, false);
    assert.equal(evidence.authority.disposition, "unowned-terminal");
    assert.equal(evidence.target.generatedResidue.mode, "none");
  });
});
test("repository adapter accepts a fresh empty provider inventory", () => {
  const evidence = inspectRemoteAuthority({
    originUrl: "https://github.com/owner/repo.git",
    headSha: "1".repeat(40),
    claimId: null,
    invokeCloudAction: () => ({
      schema: "agentic-cloud-collaboration-result/v1",
      ok: true,
      action: "status",
      status: "empty",
      claims: [],
    }),
  });
  assert.equal(evidence.currentRemoteWriter, false);
  assert.equal(evidence.targetClaims.length, 0);
});
test("repository adapter content-binds only the exact generated residue roots", () => {
  withFixture(fixture => {
    addGeneratedResidue(fixture);
    const visited = [];
    const evidence = createAdapter(fixture, {
      observeGeneratedResidueEntry: entry => visited.push(entry),
    }).captureEvidence({});
    assert.equal(evidence.target.generatedResidue.mode, "preserve-exact-generated-roots");
    assert.deepEqual(evidence.target.generatedResidue.roots, ["node_modules/", "web/dist/"]);
    assert.equal(evidence.target.generatedResidue.entryCount >= 4, true);
    assert.equal(evidence.target.generatedResidue.totalBytes > 0, true);
    assert.equal(new Set(visited).size, visited.length);
  });
  withFixture(fixture => {
    addGeneratedResidue(fixture);
    writeFileSync(path.join(fixture.worktree, "late-ignored.txt"), "outside profile\n");
    assert.throws(() => createAdapter(fixture).captureEvidence({}), /outside the generated residue profile/);
  });
  withFixture(fixture => {
    mkdirSync(path.join(fixture.worktree, "node_modules"));
    mkdirSync(path.join(fixture.worktree, "web", "dist"), { recursive: true });
    assert.throws(() => createAdapter(fixture).captureEvidence({}), /at least one ignored entry/);
  });
  for (const relative of ["empty-cache", "web/cache", "ordinary-empty"]) withFixture(fixture => {
    mkdirSync(path.join(fixture.worktree, relative), { recursive: true });
    assert.throws(() => createAdapter(fixture).captureEvidence({}), /outside the generated residue profile/);
  });
  withFixture(fixture => {
    mkdirSync(path.join(fixture.worktree, "node_modules"));
    mkdirSync(path.join(fixture.worktree, "web", "dist"), { recursive: true });
    writeFileSync(path.join(fixture.worktree, "node_modules", "one.js"), "one\n");
    assert.throws(() => createAdapter(fixture).captureEvidence({}), /at least one ignored entry/);
  });
  withFixture(fixture => {
    addGeneratedResidue(fixture);
    mkdirSync(path.join(fixture.worktree, "node_modules", ".bin"));
    symlinkSync("../package/index.js", path.join(
      fixture.worktree, "node_modules", ".bin", "package-tool",
    ));
    assert.doesNotThrow(() => createAdapter(fixture).captureEvidence({}));
  });
  for (const [name, target, pattern] of [
    ["escaping-link", "../../../../outside", /escapes its relocated checkout/],
    ["absolute-link", "/private/tmp/outside", /escapes its relocated checkout/],
    ["indirect-link", "../tracked-link", /traverses another link/], ["dangling-link", "../missing", /does not resolve/],
  ]) withFixture(fixture => {
    addGeneratedResidue(fixture);
    symlinkSync(target, path.join(fixture.worktree, "node_modules", name));
    assert.throws(() => createAdapter(fixture).captureEvidence({}), pattern);
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

test("repository adapter ignores an unrelated stale dormant-preservation journal", () => {
  withFixture(fixture => {
    const directory = path.join(
      fixture.repo, ".git", "agentic-canvas-os", "dormant-preservation-admission",
    );
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "unrelated-stale.json"), `${JSON.stringify({
      intent: {
        planSnapshot: {
          sourceEvidence: {
            preservation: {
              selectedLanes: [{ worktree: {
                path: path.join(fixture.root, "another-lane"),
                branch: "refs/heads/agent/device/another-lane",
                headSha: "a".repeat(40),
                treeSha: "b".repeat(40),
              } }],
            },
          },
        },
      },
    })}\n`);
    let normalizationCalls = 0;
    const adapter = createAdapter(fixture, {
      normalizeDormantIntent() {
        normalizationCalls += 1;
        throw new Error("unrelated stale journal was normalized");
      },
    });
    assert.doesNotThrow(() => adapter.captureEvidence({}));
    assert.equal(normalizationCalls, 0);
  });
});

test("repository adapter ignores an unrelated journal with incomplete historical lane identity", () => {
  withFixture(fixture => {
    const directory = path.join(
      fixture.repo, ".git", "agentic-canvas-os", "dormant-preservation-admission",
    );
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "unrelated-incomplete.json"), `${JSON.stringify({
      intent: {
        planSnapshot: {
          sourceEvidence: {
            preservation: {
              selectedLanes: [{ worktree: { path: path.join(fixture.root, "another-lane") } }],
            },
          },
        },
      },
    })}\n`);
    const adapter = createAdapter(fixture, {
      normalizeDormantIntent() {
        throw new Error("unrelated historical journal was normalized");
      },
    });
    assert.doesNotThrow(() => adapter.captureEvidence({}));
  });
});

test("repository adapter still validates a stale journal selecting the target lane", () => {
  withFixture(fixture => {
    const directory = path.join(
      fixture.repo, ".git", "agentic-canvas-os", "dormant-preservation-admission",
    );
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "target-stale.json"), `${JSON.stringify({
      intent: {
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
      },
    })}\n`);
    const adapter = createAdapter(fixture, {
      normalizeDormantIntent() {
        throw new Error("target stale journal is invalid");
      },
    });
    assert.throws(() => adapter.captureEvidence({}), /target stale journal is invalid/);
  });
});

test("repository adapter still validates a journal with an ambiguous subject", () => {
  withFixture(fixture => {
    const directory = path.join(
      fixture.repo, ".git", "agentic-canvas-os", "dormant-preservation-admission",
    );
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "ambiguous.json"), `${JSON.stringify({
      intent: {
        planSnapshot: {
          sourceEvidence: {
            preservation: {
              selectedLanes: [{ worktree: { path: fixture.worktree } }],
            },
          },
        },
      },
    })}\n`);
    const adapter = createAdapter(fixture, {
      normalizeDormantIntent() {
        throw new Error("ambiguous journal is invalid");
      },
    });
    assert.throws(() => adapter.captureEvidence({}), /ambiguous journal is invalid/);
  });
});

test("repository adapter refuses tracked, untracked, non-profile ignored, unmerged, and operation residue", () => {
  withFixture(fixture => {
    writeFileSync(path.join(fixture.worktree, "README.md"), "tracked dirt\n");
    assert.throws(() => createAdapter(fixture).captureEvidence({}), /tracked|untracked|residue/);
  });
  withFixture(fixture => {
    writeFileSync(path.join(fixture.worktree, "README.md"), "staged dirt\n");
    git(fixture.worktree, ["add", "README.md"]);
    assert.throws(() => createAdapter(fixture).captureEvidence({}), /tracked|untracked|residue/);
  });
  withFixture(fixture => {
    writeFileSync(path.join(fixture.worktree, "dirty.txt"), "dirty\n");
    assert.throws(() => createAdapter(fixture).captureEvidence({}), /tracked|untracked|residue/);
  });
  withFixture(fixture => {
    writeFileSync(path.join(fixture.worktree, ".gitignore"), "ignored.txt\n");
    git(fixture.worktree, ["add", ".gitignore"]);
    git(fixture.worktree, ["commit", "-m", "test: ignore residue"]);
    writeFileSync(path.join(fixture.worktree, "ignored.txt"), "ignored\n");
    assert.throws(() => createAdapter(fixture).captureEvidence({}), /tracked|untracked|residue/);
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
      git(cwd, args, options) {
        invocations.push([...args]);
        return git(cwd, args, options);
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
    const lanePath = path.join(fixture.recovery, "worktree-snapshot", "lane.txt");
    writeFileSync(lanePath, "tampered snapshot\n");
    assert.throws(() => controller.run({
      ...input, planDigest: planned.planDigest, authorization: planned.exactAuthorization,
    }), /snapshot|drifted/i);
    assert.throws(() => controller.observe({
      ...input, planDigest: planned.planDigest,
    }), /snapshot|drifted/i);
    writeFileSync(lanePath, "lane\n");
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

test("cleanup preserves exact generated residue and rejects pre-quarantine byte drift", () => {
  withFixture(fixture => {
    addGeneratedResidue(fixture);
    mkdirSync(path.join(fixture.worktree, "node_modules", ".bin"));
    symlinkSync("../package/index.js", path.join(
      fixture.worktree, "node_modules", ".bin", "package-tool",
    ));
    const controller = createRecoverableLaneCleanupController({ adapter: createAdapter(fixture) });
    const input = request(fixture);
    const planned = controller.plan(input);
    const result = controller.run({
      ...input, planDigest: planned.planDigest, authorization: planned.exactAuthorization,
    });
    assert.equal(result.status, "complete");
    assert.equal(readFileSync(path.join(
      fixture.recovery, "worktree-snapshot", "node_modules", "package", "index.js",
    ), "utf8"), "generated dependency\n");
    assert.equal(readFileSync(path.join(
      fixture.recovery, "worktree-snapshot", "web", "dist", "bundle.js",
    ), "utf8"), "generated bundle\n");
    assert.equal(readlinkSync(path.join(
      fixture.recovery, "worktree-snapshot", "node_modules", ".bin", "package-tool",
    )), "../package/index.js");
  });
  withFixture(fixture => {
    addGeneratedResidue(fixture);
    const invocations = [];
    const controller = createRecoverableLaneCleanupController({ adapter: createAdapter(fixture, {
      git(cwd, args, options) {
        invocations.push([...args]);
        return git(cwd, args, options);
      },
      checkpoint(name) {
        if (name === "before-worktree-remove") writeFileSync(path.join(
          fixture.recovery, "worktree-snapshot", "web", "dist", "late.js",
        ), "late drift\n");
      },
    }) });
    const input = request(fixture);
    const planned = controller.plan(input);
    assert.throws(() => controller.run({
      ...input, planDigest: planned.planDigest, authorization: planned.exactAuthorization,
    }), /snapshot|drifted/i);
    assert.equal(invocations.some(args => args[0] === "worktree" && args[1] === "remove"), false);
    const intent = JSON.parse(readFileSync(path.join(
      fixture.recovery, "cleanup-intent.json",
    ), "utf8"));
    assert.equal(intent.status, "worktree_quarantined");
    assert.throws(() => controller.run({
      ...input, planDigest: planned.planDigest, authorization: planned.exactAuthorization,
    }), /snapshot|drifted/i);
  });
  withFixture(fixture => {
    addGeneratedResidue(fixture);
    let instant = Date.parse("2026-08-15T00:00:00.000Z"), loseAbortResponse = true;
    const controller = createRecoverableLaneCleanupController({ adapter: createAdapter(fixture, {
      now: () => new Date(instant),
      checkpoint(name) {
        if (name === "after-worktree-move") writeFileSync(path.join(fixture.recovery,
          "worktree-staging", "web", "dist", "late.js"), "post-move drift\n");
        if (name === "after-drift-abort-release" && loseAbortResponse) {
          loseAbortResponse = false;
          instant += 11 * 60_000;
          throw new Error("lost drift-abort response");
        }
      },
    }) });
    const input = request(fixture);
    const planned = controller.plan(input);
    assert.throws(() => controller.run({
      ...input, planDigest: planned.planDigest, authorization: planned.exactAuthorization,
    }), /lost drift-abort response/);
    assert.equal(existsSync(fixture.worktree), true);
    assert.equal(git(fixture.worktree, ["rev-parse", "HEAD"]).trim(), fixture.laneSha);
    const run = () => controller.run({ ...input, planDigest: planned.planDigest,
      authorization: planned.exactAuthorization });
    const result = run();
    assert.equal(result.status, "drift_aborted");
    assert.equal(run().status, "drift_aborted");
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
    symlinkSync("/private/tmp/outside", path.join(repo, "tracked-link"));
    writeFileSync(path.join(repo, ".gitignore"), [
      "late-ignored.txt", "node_modules/", "web/dist/", "empty-cache/", "",
    ].join("\n"));
    git(repo, ["add", "README.md", ".gitignore", "tracked-link"]);
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

function addGeneratedResidue(fixture) {
  mkdirSync(path.join(fixture.worktree, "node_modules", "package"), { recursive: true });
  mkdirSync(path.join(fixture.worktree, "web", "dist"), { recursive: true });
  writeFileSync(path.join(
    fixture.worktree, "node_modules", "package", "index.js",
  ), "generated dependency\n");
  writeFileSync(path.join(fixture.worktree, "web", "dist", "bundle.js"), "generated bundle\n");
}

function git(cwd, args, { input } = {}) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    input,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
}
