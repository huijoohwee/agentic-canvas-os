import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createRepositoryAdapter } from
  "../scripts/planned-recovery-pr-marker-reconciliation-repository-adapter.mjs";

function git(repository, args) {
  return execFileSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

test("real adapter rejects changed source identity before provider access", () => {
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), "planned-recovery-adapter-"));
  try {
    execFileSync("git", ["init", "--initial-branch=main", repository], { stdio: "ignore" });
    git(repository, ["config", "user.email", "adapter-test@example.invalid"]);
    git(repository, ["config", "user.name", "Adapter Test"]);
    fs.writeFileSync(path.join(repository, "fixture.txt"), "fixture\n", "utf8");
    git(repository, ["add", "fixture.txt"]);
    git(repository, ["commit", "-m", "test: seed repository"]);
    const adapter = createRepositoryAdapter({ repository, sourceWorktree: repository });

    assert.throws(() => adapter.verifyPlan({
      plan: {
        branch: "agent/device/not-main",
        headSha: "0".repeat(40),
        treeSha: "0".repeat(40),
        remoteHeadSha: "0".repeat(40),
      },
    }), /Reconciliation source identity changed/u);
  } finally {
    fs.rmSync(repository, { recursive: true, force: true });
  }
});
