import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const scriptPath = path.resolve("scripts/canonical-main-fast-forward-equivalence.mjs");

test("reconciles canonical main when its tracked working bytes exactly equal protected fast-forward", () => {
  const fixture = createFixture();
  writeFileSync(path.join(fixture.primary, "tracked.txt"), "protected\n");
  writeFileSync(path.join(fixture.writer, "tracked.txt"), "protected\n");
  git(fixture.writer, ["add", "tracked.txt"]);
  git(fixture.writer, ["commit", "-m", "protected"]);
  git(fixture.writer, ["push", "origin", "main"]);
  const originHead = git(fixture.writer, ["rev-parse", "HEAD"]);

  const result = invoke({
    repository: fixture.primary,
    session: "test-session",
    localHead: fixture.baseHead,
    originHead,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.status, "completed");
  assert.equal(payload.pathCount, 1);
  assert.equal(payload.headSha, originHead);
  assert.equal(git(fixture.primary, ["status", "--porcelain"]), "");
  assert.equal(readFileSync(path.join(fixture.primary, "tracked.txt"), "utf8"), "protected\n");

  const replay = invoke({
    repository: fixture.primary,
    session: "test-session",
    localHead: fixture.baseHead,
    originHead,
  });
  assert.equal(replay.status, 0, `${replay.stdout}\n${replay.stderr}`);
  assert.equal(JSON.parse(replay.stdout.trim()).replayed, true);
});

test("rejects canonical bytes that differ from protected origin", () => {
  const fixture = createFixture();
  writeFileSync(path.join(fixture.primary, "tracked.txt"), "local-only\n");
  writeFileSync(path.join(fixture.writer, "tracked.txt"), "protected\n");
  git(fixture.writer, ["add", "tracked.txt"]);
  git(fixture.writer, ["commit", "-m", "protected"]);
  git(fixture.writer, ["push", "origin", "main"]);
  const result = invoke({
    repository: fixture.primary,
    session: "mismatch-session",
    localHead: fixture.baseHead,
    originHead: git(fixture.writer, ["rev-parse", "HEAD"]),
  });
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout.trim()).error.message, /do not exactly match/);
  assert.equal(git(fixture.primary, ["rev-parse", "HEAD"]), fixture.baseHead);
});

test("rejects untracked canonical state even when tracked bytes equal protected origin", () => {
  const fixture = createFixture();
  writeFileSync(path.join(fixture.primary, "tracked.txt"), "protected\n");
  writeFileSync(path.join(fixture.primary, "untracked.txt"), "retain\n");
  writeFileSync(path.join(fixture.writer, "tracked.txt"), "protected\n");
  git(fixture.writer, ["add", "tracked.txt"]);
  git(fixture.writer, ["commit", "-m", "protected"]);
  git(fixture.writer, ["push", "origin", "main"]);
  const result = invoke({
    repository: fixture.primary,
    session: "untracked-session",
    localHead: fixture.baseHead,
    originHead: git(fixture.writer, ["rev-parse", "HEAD"]),
  });
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout.trim()).error.message, /rejects untracked path/);
  assert.equal(readFileSync(path.join(fixture.primary, "untracked.txt"), "utf8"), "retain\n");
});

function createFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "canonical-equivalence-"));
  const remote = path.join(root, "remote.git");
  const primary = path.join(root, "primary");
  const writer = path.join(root, "writer");
  execFileSync("git", ["init", "--bare", "--initial-branch=main", remote]);
  execFileSync("git", ["clone", remote, primary]);
  configure(primary);
  writeFileSync(path.join(primary, "tracked.txt"), "base\n");
  git(primary, ["add", "tracked.txt"]);
  git(primary, ["commit", "-m", "base"]);
  git(primary, ["push", "-u", "origin", "main"]);
  const baseHead = git(primary, ["rev-parse", "HEAD"]);
  execFileSync("git", ["clone", remote, writer]);
  configure(writer);
  return { root, remote, primary, writer, baseHead };
}

function configure(repository) {
  git(repository, ["config", "user.name", "Test"]);
  git(repository, ["config", "user.email", "test@example.com"]);
}

function git(repository, args) {
  return execFileSync("git", ["-C", repository, ...args], { encoding: "utf8" }).trim();
}

function invoke({ repository, session, localHead, originHead }) {
  return spawnSync(process.execPath, [
    scriptPath,
    `--repository=${repository}`,
    `--session=${session}`,
    `--expected-local-head=${localHead}`,
    `--expected-origin-head=${originHead}`,
    "--acknowledge-protected-equivalence",
    "--json",
  ], { encoding: "utf8" });
}
