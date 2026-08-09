import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  assertActiveOwnedDirtWithinWriteSet,
  captureActiveOwnedDirtEvidence,
  createActiveOwnedDirtSnapshot,
  verifyActiveOwnedDirtSnapshot,
} from "../scripts/active-owned-dirt-recovery-evidence.mjs";

test("snapshot preserves staged, unstaged, untracked, deletion, executable, and symlink bytes", () => {
  const repository = mkdtempSync(path.join(os.tmpdir(), "active-owned-dirt-evidence-"));
  const git = (args, options = {}) => execFileSync("git", args, {
    cwd: repository,
    encoding: "utf8",
    ...options,
  }).trim();
  try {
    git(["init", "-q"]);
    git(["config", "user.name", "Test"]);
    git(["config", "user.email", "test@example.test"]);
    git(["config", "core.filemode", "true"]);
    writeFileSync(path.join(repository, "staged.txt"), "base\n");
    writeFileSync(path.join(repository, "mixed.txt"), "base\n");
    writeFileSync(path.join(repository, "deleted.txt"), "delete me\n");
    writeFileSync(path.join(repository, "mode.sh"), "#!/bin/sh\nexit 0\n");
    symlinkSync("staged.txt", path.join(repository, "link"));
    git(["add", "."]);
    git(["commit", "-qm", "base"]);

    writeFileSync(path.join(repository, "staged.txt"), "staged bytes\n");
    git(["add", "staged.txt"]);
    writeFileSync(path.join(repository, "mixed.txt"), "index bytes\n");
    git(["add", "mixed.txt"]);
    writeFileSync(path.join(repository, "mixed.txt"), "worktree bytes\n");
    unlinkSync(path.join(repository, "deleted.txt"));
    git(["add", "-u", "deleted.txt"]);
    chmodSync(path.join(repository, "mode.sh"), 0o755);
    unlinkSync(path.join(repository, "link"));
    symlinkSync("mixed.txt", path.join(repository, "link"));
    writeFileSync(path.join(repository, "new file.txt"), "untracked bytes\n");

    const before = {
      head: git(["rev-parse", "HEAD"]),
      index: git(["ls-files", "--stage", "-z"]),
      status: git(["status", "--porcelain=v2", "-z", "--untracked-files=all"]),
    };
    const evidence = captureActiveOwnedDirtEvidence({ repository });
    assert.equal(evidence.pathCount, 6);
    assert.equal(evidence.untrackedPathCount, 1);
    assert.equal(evidence.entries.find(entry => entry.path === "deleted.txt").worktreeType, "deleted");
    assert.equal(evidence.entries.find(entry => entry.path === "mode.sh").worktreeMode, "100755");
    assert.equal(evidence.entries.find(entry => entry.path === "link").worktreeType, "symlink");
    assertActiveOwnedDirtWithinWriteSet({
      evidence,
      declaredWriteSet: ["path:deleted.txt", "path:link", "path:mixed.txt", "path:mode.sh", "path:new file.txt", "path:staged.txt", "semantic:test"],
    });

    const snapshot = createActiveOwnedDirtSnapshot({
      repository,
      evidence,
      claimId: "a".repeat(64),
      planDigest: "b".repeat(64),
      timestamp: "2026-08-09T00:00:00.000Z",
    });
    assert.deepEqual(verifyActiveOwnedDirtSnapshot({ repository, snapshot }), snapshot);
    assert.equal(git(["show", `${snapshot.commitSha}:new file.txt`]), "untracked bytes");
    assert.equal(git(["show", `${snapshot.commitSha}:mixed.txt`]), "worktree bytes");
    assert.equal(git(["show", `${snapshot.indexCommitSha}:mixed.txt`]), "index bytes");
    git(["gc", "--prune=now"]);
    assert.deepEqual(verifyActiveOwnedDirtSnapshot({ repository, snapshot }), snapshot);
    assert.equal(git(["cat-file", "-t", snapshot.indexCommitSha]), "commit");
    assert.equal(git(["show", `${snapshot.indexCommitSha}:mixed.txt`]), "index bytes");
    assert.equal(git(["rev-parse", "HEAD"]), before.head);
    assert.equal(git(["ls-files", "--stage", "-z"]), before.index);
    assert.equal(git(["status", "--porcelain=v2", "-z", "--untracked-files=all"]), before.status);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("evidence rejects paths outside the admitted write set", () => {
  const core = {
    schema: "agentic-active-owned-dirt-evidence/v1",
    headSha: "a".repeat(40),
    entries: [{
      path: "outside.txt", staged: false, unstaged: false, untracked: true,
      headMode: null, headBlob: null, indexMode: null, indexBlob: null,
      worktreeType: "file", worktreeMode: "100644", worktreeBlob: "b".repeat(40),
    }],
    pathCount: 1,
    stagedPathCount: 0,
    unstagedPathCount: 0,
    untrackedPathCount: 1,
  };
  const evidence = { ...core, evidenceDigest: digestValue(core) };
  assert.throws(() => assertActiveOwnedDirtWithinWriteSet({
    evidence,
    declaredWriteSet: ["path:inside", "semantic:test"],
  }), /outside the admitted write set/);
});
