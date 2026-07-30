import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { captureOwnedDirtEvidence } from "../scripts/owned-dirt-resume-lib.mjs";

test("empty --only claim preserves staged, unstaged, and untracked dirt evidence", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-owned-dirt-resume-"));
  const gitText = args => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  const gitOptional = args => {
    const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    return result.status === 0 ? result.stdout.trim() : "";
  };
  try {
    gitText(["init", "--quiet"]);
    gitText(["config", "user.name", "Agentic Test"]);
    gitText(["config", "user.email", "agentic-test@example.invalid"]);
    writeFileSync(path.join(repo, "staged.txt"), "base staged\n");
    writeFileSync(path.join(repo, "unstaged.txt"), "base unstaged\n");
    gitText(["add", "staged.txt", "unstaged.txt"]);
    gitText(["commit", "--quiet", "-m", "base"]);

    writeFileSync(path.join(repo, "staged.txt"), "changed staged\n");
    gitText(["add", "staged.txt"]);
    writeFileSync(path.join(repo, "unstaged.txt"), "changed unstaged\n");
    writeFileSync(path.join(repo, "untracked.txt"), "new untracked\n");

    const before = captureOwnedDirtEvidence({ gitText, gitOptional });
    const parentTree = gitText(["rev-parse", "HEAD^{tree}"]).trim();
    gitText(["commit", "--allow-empty", "--only", "-m", "claim"]);
    const after = captureOwnedDirtEvidence({ gitText, gitOptional });

    assert.deepEqual(after, before);
    assert.equal(gitText(["rev-parse", "HEAD^{tree}"]).trim(), parentTree);
    assert.equal(gitText(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]).trim(), "");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
