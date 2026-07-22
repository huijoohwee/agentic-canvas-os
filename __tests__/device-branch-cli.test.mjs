import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const script = path.resolve("scripts/device-branch.mjs");

test("device CLI emits exactly one JSON object on machine success and failure", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "agentic-device-cli-"));
  const remote = path.join(root, "origin.git");
  const repo = path.join(root, "repo");
  try {
    git(root, ["init", "--bare", "--initial-branch=main", remote]);
    git(root, ["init", "--initial-branch=main", repo]);
    git(repo, ["config", "user.email", "tests@example.invalid"]);
    git(repo, ["config", "user.name", "Device CLI Test"]);
    writeFileSync(path.join(repo, "README.md"), "fixture\n");
    git(repo, ["add", "README.md"]);
    git(repo, ["commit", "-m", "test: seed"]);
    git(repo, ["remote", "add", "origin", remote]);
    git(repo, ["push", "--set-upstream", "origin", "main"]);
    const canonicalRepo = realpathSync(repo);

    const success = spawnSync(process.execPath, [script, "park", `--repository=${canonicalRepo}`, "--json"], {
      encoding: "utf8",
    });
    assert.equal(success.status, 0, `${success.stderr}\n${success.stdout}`);
    assert.equal(success.stdout.trim().split("\n").length, 1);
    const result = JSON.parse(success.stdout);
    assert.equal(result.schema, "agentic-device-command-result/v1");
    assert.equal(result.action, "park");
    assert.equal(result.status, "main");
    assert.equal(result.worktreePath, canonicalRepo);

    const failure = spawnSync(process.execPath, [
      script,
      "park",
      `--repository=${canonicalRepo}`,
      "--ttl-seconds=invalid",
      "--json",
    ], { encoding: "utf8" });
    assert.equal(failure.status, 1);
    assert.equal(failure.stdout.trim().split("\n").length, 1);
    const error = JSON.parse(failure.stdout);
    assert.equal(error.ok, false);
    assert.equal(error.status, "error");
    assert.match(error.error.message, /positive number/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
