import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
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

test("materializes unrelated protected changes while reconciling only equivalent dirty paths", () => {
  const fixture = createFixture();
  writeFileSync(path.join(fixture.primary, "tracked.txt"), "protected\n");
  writeFileSync(path.join(fixture.writer, "tracked.txt"), "protected\n");
  writeFileSync(path.join(fixture.writer, "unrelated.txt"), "protected-only\n");
  git(fixture.writer, ["add", "tracked.txt", "unrelated.txt"]);
  git(fixture.writer, ["commit", "-m", "protected with unrelated change"]);
  git(fixture.writer, ["push", "origin", "main"]);
  const originHead = git(fixture.writer, ["rev-parse", "HEAD"]);

  const result = invoke({
    repository: fixture.primary,
    session: "partial-equivalence-session",
    localHead: fixture.baseHead,
    originHead,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.pathCount, 1);
  assert.equal(payload.protectedAdvancePathCount, 2);
  assert.equal(readFileSync(path.join(fixture.primary, "tracked.txt"), "utf8"), "protected\n");
  assert.equal(readFileSync(path.join(fixture.primary, "unrelated.txt"), "utf8"), "protected-only\n");
  assert.equal(git(fixture.primary, ["status", "--porcelain"]), "");
});

test("replays a prepared ref-advanced transition without losing unrelated protected changes", () => {
  const fixture = createFixture();
  writeFileSync(path.join(fixture.primary, "tracked.txt"), "protected\n");
  writeFileSync(path.join(fixture.writer, "tracked.txt"), "protected\n");
  writeFileSync(path.join(fixture.writer, "unrelated.txt"), "protected-only\n");
  git(fixture.writer, ["add", "tracked.txt", "unrelated.txt"]);
  git(fixture.writer, ["commit", "-m", "protected with unrelated change"]);
  git(fixture.writer, ["push", "origin", "main"]);
  const originHead = git(fixture.writer, ["rev-parse", "HEAD"]);
  const wrapperPath = createFailingReadTreeGitWrapper(fixture.root);

  const interrupted = invoke({
    repository: fixture.primary,
    session: "transition-replay-session",
    localHead: fixture.baseHead,
    originHead,
    env: { PATH: `${wrapperPath}:${process.env.PATH}` },
  });
  assert.equal(interrupted.status, 1);
  assert.match(JSON.parse(interrupted.stdout.trim()).error.message, /git read-tree .* failed/);
  assert.equal(git(fixture.primary, ["rev-parse", "HEAD"]), originHead);
  assert.notEqual(git(fixture.primary, ["status", "--porcelain"]), "");

  const replay = invoke({
    repository: fixture.primary,
    session: "transition-replay-session",
    localHead: fixture.baseHead,
    originHead,
  });
  assert.equal(replay.status, 0, `${replay.stdout}\n${replay.stderr}`);
  assert.equal(readFileSync(path.join(fixture.primary, "unrelated.txt"), "utf8"), "protected-only\n");
  assert.equal(git(fixture.primary, ["status", "--porcelain"]), "");
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
  assert.match(JSON.parse(result.stdout.trim()).error.message, /Working blob differs/);
  assert.equal(git(fixture.primary, ["rev-parse", "HEAD"]), fixture.baseHead);
});

test("rejects a dirty path whose working mode differs from the protected target", () => {
  const fixture = createFixture();
  writeFileSync(path.join(fixture.primary, "tracked.txt"), "protected\n");
  writeFileSync(path.join(fixture.writer, "tracked.txt"), "protected\n");
  chmodSync(path.join(fixture.writer, "tracked.txt"), 0o755);
  git(fixture.writer, ["add", "tracked.txt"]);
  git(fixture.writer, ["commit", "-m", "protected executable"]);
  git(fixture.writer, ["push", "origin", "main"]);
  const result = invoke({
    repository: fixture.primary,
    session: "mode-mismatch-session",
    localHead: fixture.baseHead,
    originHead: git(fixture.writer, ["rev-parse", "HEAD"]),
  });
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout.trim()).error.message, /Working mode .* differs/);
  assert.equal(git(fixture.primary, ["rev-parse", "HEAD"]), fixture.baseHead);
});

test("rejects deleted tracked canonical state even when protected origin deletes the same path", () => {
  const fixture = createFixture();
  unlinkSync(path.join(fixture.primary, "tracked.txt"));
  git(fixture.writer, ["rm", "tracked.txt"]);
  git(fixture.writer, ["commit", "-m", "protected deletion"]);
  git(fixture.writer, ["push", "origin", "main"]);
  const result = invoke({
    repository: fixture.primary,
    session: "deleted-session",
    localHead: fixture.baseHead,
    originHead: git(fixture.writer, ["rev-parse", "HEAD"]),
  });
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout.trim()).error.message, /rejects deleted tracked path/);
  assert.equal(git(fixture.primary, ["rev-parse", "HEAD"]), fixture.baseHead);
});

test("rejects staged canonical state even when its bytes equal protected origin", () => {
  const fixture = createFixture();
  writeFileSync(path.join(fixture.primary, "tracked.txt"), "protected\n");
  git(fixture.primary, ["add", "tracked.txt"]);
  writeFileSync(path.join(fixture.writer, "tracked.txt"), "protected\n");
  git(fixture.writer, ["add", "tracked.txt"]);
  git(fixture.writer, ["commit", "-m", "protected"]);
  git(fixture.writer, ["push", "origin", "main"]);
  const result = invoke({
    repository: fixture.primary,
    session: "staged-session",
    localHead: fixture.baseHead,
    originHead: git(fixture.writer, ["rev-parse", "HEAD"]),
  });
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout.trim()).error.message, /rejects staged state/);
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

test("rejects ignored local state that collides with a protected tracked path", () => {
  const fixture = createFixture({
    seed: repository => {
      writeFileSync(path.join(repository, ".gitignore"), "ignored.txt\n");
    },
  });
  writeFileSync(path.join(fixture.primary, "tracked.txt"), "protected\n");
  writeFileSync(path.join(fixture.primary, "ignored.txt"), "retain\n");
  writeFileSync(path.join(fixture.writer, "tracked.txt"), "protected\n");
  writeFileSync(path.join(fixture.writer, "ignored.txt"), "protected ignored path\n");
  git(fixture.writer, ["add", "tracked.txt"]);
  git(fixture.writer, ["add", "-f", "ignored.txt"]);
  git(fixture.writer, ["commit", "-m", "protected ignored collision"]);
  git(fixture.writer, ["push", "origin", "main"]);
  const result = invoke({
    repository: fixture.primary,
    session: "ignored-collision-session",
    localHead: fixture.baseHead,
    originHead: git(fixture.writer, ["rev-parse", "HEAD"]),
  });
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout.trim()).error.message, /Ignored local state collides/);
  assert.equal(readFileSync(path.join(fixture.primary, "ignored.txt"), "utf8"), "retain\n");
  assert.equal(git(fixture.primary, ["rev-parse", "HEAD"]), fixture.baseHead);
});

function createFixture({ seed } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "canonical-equivalence-"));
  const remote = path.join(root, "remote.git");
  const primary = path.join(root, "primary");
  const writer = path.join(root, "writer");
  execFileSync("git", ["init", "--bare", "--initial-branch=main", remote]);
  execFileSync("git", ["clone", remote, primary]);
  configure(primary);
  writeFileSync(path.join(primary, "tracked.txt"), "base\n");
  seed?.(primary);
  git(primary, ["add", "tracked.txt"]);
  if (seed) git(primary, ["add", ".gitignore"]);
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

function createFailingReadTreeGitWrapper(root) {
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  const wrapper = path.join(bin, "git");
  const gitExecutable = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  writeFileSync(wrapper, [
    "#!/usr/bin/env node",
    "const { spawnSync } = require(\"node:child_process\");",
    "if (process.argv[2] === \"read-tree\") process.exit(23);",
    `const result = spawnSync(${JSON.stringify(gitExecutable)}, process.argv.slice(2), { stdio: "inherit" });`,
    "process.exit(result.status ?? 1);",
    "",
  ].join("\n"));
  chmodSync(wrapper, 0o755);
  return bin;
}

function git(repository, args) {
  return execFileSync("git", ["-C", repository, ...args], { encoding: "utf8" }).trim();
}

function invoke({ repository, session, localHead, originHead, env = {} }) {
  return spawnSync(process.execPath, [
    scriptPath,
    `--repository=${repository}`,
    `--session=${session}`,
    `--expected-local-head=${localHead}`,
    `--expected-origin-head=${originHead}`,
    "--acknowledge-protected-equivalence",
    "--json",
  ], { encoding: "utf8", env: { ...process.env, ...env } });
}
