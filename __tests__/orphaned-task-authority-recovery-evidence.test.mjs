import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  captureOrphanedTaskAuthorityGitEvidence,
  requireSameOrphanedTaskAuthorityGitEvidence,
} from "../scripts/orphaned-task-authority-recovery-evidence.mjs";

function fixture() {
  const repository = mkdtempSync(path.join(os.tmpdir(), "orphaned-authority-evidence-"));
  const git = args => execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();
  git(["init", "--quiet"]);
  git(["config", "user.name", "Test"]);
  git(["config", "user.email", "test@example.invalid"]);
  writeFileSync(path.join(repository, "tracked.txt"), "source\n");
  git(["add", "tracked.txt"]);
  git(["commit", "--quiet", "-m", "source"]);
  const headSha = git(["rev-parse", "HEAD"]);
  const treeSha = git(["show", "-s", "--format=%T", headSha]);
  return { repository, git, headSha, treeSha };
}

test("Git evidence distinguishes exact clean and covered dirty bytes", () => {
  const setup = fixture();
  try {
    const clean = captureOrphanedTaskAuthorityGitEvidence({
      ...setup,
      gitText: setup.git,
      declaredWriteSet: ["path:dirty.txt"],
    });
    assert.equal(clean.kind, "clean");
    writeFileSync(path.join(setup.repository, "dirty.txt"), "owned bytes\n");
    const dirty = captureOrphanedTaskAuthorityGitEvidence({
      ...setup,
      gitText: setup.git,
      declaredWriteSet: ["path:dirty.txt"],
    });
    assert.equal(dirty.kind, "dirty");
    assert.equal(dirty.evidence.entries[0].path, "dirty.txt");
    assert.equal(requireSameOrphanedTaskAuthorityGitEvidence(dirty, dirty), dirty);
    assert.throws(() => requireSameOrphanedTaskAuthorityGitEvidence(clean, dirty), /changed/u);
  } finally {
    rmSync(setup.repository, { recursive: true, force: true });
  }
});

test("Git evidence rejects dirty bytes outside the admitted write set", () => {
  const setup = fixture();
  try {
    writeFileSync(path.join(setup.repository, "outside.txt"), "unowned\n");
    assert.throws(() => captureOrphanedTaskAuthorityGitEvidence({
      ...setup,
      gitText: setup.git,
      declaredWriteSet: ["path:inside.txt"],
    }), /outside the admitted write set/u);
  } finally {
    rmSync(setup.repository, { recursive: true, force: true });
  }
});
