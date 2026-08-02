import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const script = path.resolve("scripts/legacy-integrated-lane-disposition.mjs");

test("detaches a non-ancestor legacy lane only when its complete write set equals protected main", () => {
  const fixture = createFixture();
  const receiptPath = path.join(fixture.root, "receipt.json");
  const result = runDisposition(fixture, receiptPath);

  assert.equal(result.status, "completed");
  assert.equal(result.sourceHead, fixture.legacyHead);
  assert.equal(result.protectedTip, fixture.protectedTip);
  assert.equal(result.pathCount, 1);
  assert.equal(git(fixture.repository, ["rev-parse", "HEAD"]), fixture.protectedTip);
  assert.equal(gitOptional(fixture.repository, ["symbolic-ref", "--short", "HEAD"]), "");
  assert.equal(git(fixture.repository, ["status", "--porcelain=v1"]), "");
  assert.equal(git(fixture.repository, ["rev-parse", "origin/legacy/policy"]), fixture.legacyHead);

  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  assert.equal(receipt.state, "completed");
  assert.equal(receipt.equivalenceScope, "complete-legacy-lane-write-set");
  assert.deepEqual(receipt.recoveryHandles, [
    `protected-commit:${fixture.protectedTip}`,
    `remote-ref:refs/heads/legacy/policy@${fixture.legacyHead}`,
  ]);
});

test("rejects a working byte that differs from protected main without changing the lane", () => {
  const fixture = createFixture({ workingValue: "unique local value\n" });
  const result = runDisposition(fixture, path.join(fixture.root, "receipt.json"), false);

  assert.equal(result.status, "blocked");
  assert.match(result.message, /not byte-and-mode equivalent/);
  assert.equal(git(fixture.repository, ["branch", "--show-current"]), "legacy/policy");
  assert.equal(git(fixture.repository, ["rev-parse", "HEAD"]), fixture.legacyHead);
});

test("rejects committed branch paths outside the equivalent dirty working set", () => {
  const fixture = createFixture({ extraCommittedPath: true });
  const result = runDisposition(fixture, path.join(fixture.root, "receipt.json"), false);

  assert.equal(result.status, "blocked");
  assert.match(result.message, /committed path outside/);
  assert.equal(git(fixture.repository, ["branch", "--show-current"]), "legacy/policy");
});

test("rejects staged or untracked state", () => {
  const staged = createFixture();
  git(staged.repository, ["add", "policy.md"]);
  let result = runDisposition(staged, path.join(staged.root, "receipt.json"), false);
  assert.equal(result.status, "blocked");
  assert.match(result.message, /staged state/);

  const untracked = createFixture();
  writeFileSync(path.join(untracked.repository, "untracked.md"), "retain me\n");
  result = runDisposition(untracked, path.join(untracked.root, "receipt.json"), false);
  assert.equal(result.status, "blocked");
  assert.match(result.message, /untracked path/);
});

function createFixture({ workingValue = "portable formatter and local source\n", extraCommittedPath = false } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "legacy-integrated-disposition-"));
  const remote = path.join(root, "remote.git");
  const repository = path.join(root, "repository");
  git(root, ["init", "--bare", remote]);
  git(root, ["clone", remote, repository]);
  git(repository, ["config", "user.name", "Disposition Test"]);
  git(repository, ["config", "user.email", "disposition@example.test"]);
  git(repository, ["switch", "-c", "main"]);
  writeFileSync(path.join(repository, "policy.md"), "old formatter\n");
  git(repository, ["add", "policy.md"]);
  git(repository, ["commit", "-m", "initial"]);
  git(repository, ["push", "-u", "origin", "main"]);

  git(repository, ["switch", "-c", "legacy/policy"]);
  git(repository, ["commit", "--allow-empty", "-m", "claim"]);
  writeFileSync(path.join(repository, "policy.md"), "portable formatter\n");
  if (extraCommittedPath) writeFileSync(path.join(repository, "extra.md"), "legacy extra\n");
  git(repository, ["add", "."]);
  git(repository, ["commit", "-m", "legacy policy"]);
  git(repository, ["push", "-u", "origin", "legacy/policy"]);
  const legacyHead = git(repository, ["rev-parse", "HEAD"]);

  git(repository, ["switch", "main"]);
  writeFileSync(path.join(repository, "policy.md"), "portable formatter and local source\n");
  git(repository, ["add", "policy.md"]);
  git(repository, ["commit", "-m", "protected superseding policy"]);
  git(repository, ["push", "origin", "main"]);
  const protectedTip = git(repository, ["rev-parse", "HEAD"]);

  git(repository, ["switch", "legacy/policy"]);
  writeFileSync(path.join(repository, "policy.md"), workingValue);
  return { root, remote, repository, legacyHead, protectedTip };
}

function runDisposition(fixture, receiptPath, expectSuccess = true) {
  const result = spawnSync(process.execPath, [
    script,
    `--source=${fixture.repository}`,
    "--branch=legacy/policy",
    `--expected-head=${fixture.legacyHead}`,
    `--protected-tip=${fixture.protectedTip}`,
    "--session=test-disposition-session",
    `--receipt=${receiptPath}`,
    "--acknowledge-protected-equivalence",
    "--json",
  ], { encoding: "utf8" });
  assert.equal(result.status, expectSuccess ? 0 : 1, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function gitOptional(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}
