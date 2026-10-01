import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const CLI = join(TEST_DIR, "..", "scripts", "sprint-harness.mjs");

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function configureIdentity(repository) {
  git(repository, "config", "user.name", "Sprint Harness Test");
  git(repository, "config", "user.email", "sprint-harness@example.invalid");
}

function commitFile(repository, name, contents, message) {
  writeFileSync(join(repository, name), contents, "utf8");
  git(repository, "add", name);
  git(repository, "commit", "-m", message);
  return git(repository, "rev-parse", "HEAD");
}

function runCli(cwd, args, input = undefined) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    input,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return { text: result.stdout.trim(), value: JSON.parse(result.stdout) };
}

function snapshot(repositories, primary) {
  return {
    worktrees: git(primary, "worktree", "list", "--porcelain"),
    repositories: repositories.map((repository) => ({
      repository,
      head: git(repository, "rev-parse", "HEAD"),
      status: git(repository, "status", "--porcelain=v1", "--untracked-files=all"),
    })),
  };
}

test("cold clone plans disjoint worktrees and an immutable stacked child without mutation", (t) => {
  const root = mkdtempSync(join(tmpdir(), "sprint-harness-e2e-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const remote = join(root, "remote.git");
  const seed = join(root, "seed");
  const workspace = join(root, "workspace");
  const unitA = join(root, "unit-a");
  const unitB = join(root, "unit-b");
  const unitC = join(root, "unit-c");
  mkdirSync(remote);
  git(root, "init", "--bare", remote);
  git(root, "clone", remote, seed);
  configureIdentity(seed);
  git(seed, "switch", "-c", "main");
  const baseSha = commitFile(seed, "base.txt", "base\n", "base");
  git(seed, "push", "-u", "origin", "main");
  execFileSync("git", ["--git-dir", remote, "symbolic-ref", "HEAD", "refs/heads/main"]);

  git(root, "clone", remote, workspace);
  configureIdentity(workspace);
  git(workspace, "worktree", "add", "-b", "unit-a", unitA, baseSha);
  git(workspace, "worktree", "add", "-b", "unit-c", unitC, baseSha);
  configureIdentity(unitA);
  configureIdentity(unitC);
  const aSha = commitFile(unitA, "a.txt", "A\n", "unit A");
  const cSha = commitFile(unitC, "c.txt", "C\n", "unit C");

  git(workspace, "worktree", "add", "-b", "unit-b", unitB, aSha);
  configureIdentity(unitB);
  const bSha = commitFile(unitB, "b.txt", "B\n", "unit B");

  assert.deepEqual(
    git(unitB, "diff", "--name-only", `${aSha}..${bSha}`).split("\n"),
    ["b.txt"],
  );
  assert.deepEqual(
    git(unitB, "diff", "--name-only", `${baseSha}..${bSha}`).split("\n"),
    ["a.txt", "b.txt"],
  );

  const plan = {
    schema: "agentic-sprint-plan/v1",
    profile: "standalone",
    sprint: { id: "cold-clone", timeboxMinutes: 60 },
    units: [
      {
        id: "A",
        paths: ["a.txt"],
        dependsOn: [],
        immutableHead: { ref: "refs/heads/unit-a", sha: aSha },
        estimatedMinutes: 20,
        estimatedTokens: 900,
        evidenceDigests: [],
      },
      {
        id: "C",
        paths: ["c.txt"],
        dependsOn: [],
        immutableHead: { ref: "refs/heads/unit-c", sha: cSha },
        estimatedMinutes: 10,
        estimatedTokens: 500,
        evidenceDigests: [],
      },
      {
        id: "B",
        paths: ["b.txt"],
        dependsOn: ["A"],
        immutableHead: { ref: "refs/heads/unit-b", sha: bSha },
        estimatedMinutes: 15,
        estimatedTokens: 700,
        evidenceDigests: [],
      },
    ],
  };

  const repositories = [workspace, unitA, unitB, unitC];
  const before = snapshot(repositories, workspace);
  const first = runCli(workspace, ["plan", "-"], JSON.stringify(plan));
  const second = runCli(workspace, ["plan", "-"], JSON.stringify(plan));
  const planPath = join(root, "plan.json");
  writeFileSync(planPath, JSON.stringify(plan), "utf8");
  const fromFile = runCli(workspace, ["plan", planPath]);
  const after = snapshot(repositories, workspace);

  assert.equal(first.text, second.text);
  assert.equal(first.text, fromFile.text);
  assert.deepEqual(after, before);
  const receipt = first.value.receipt ?? first.value;
  assert.equal(receipt.schema, "agentic-sprint-receipt/v1");
  assert.deepEqual(receipt.waves.map((wave) => wave.unitIds), [["A", "C"], ["B"]]);

  const demoOne = runCli(workspace, ["demo"]);
  const demoTwo = runCli(workspace, ["demo"]);
  assert.equal(demoOne.text, demoTwo.text);
  assert.deepEqual(snapshot(repositories, workspace), before);

  const invalid = spawnSync(process.execPath, [CLI, "plan", "-"], {
    cwd: workspace,
    encoding: "utf8",
    input: "not-json",
  });
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stdout, "");
  const error = JSON.parse(invalid.stderr);
  assert.equal(error.schema, "agentic-sprint-harness-error/v1");
  assert.equal(error.mutation, false);
  assert.deepEqual(snapshot(repositories, workspace), before);

  assert.equal(readFileSync(join(unitB, "a.txt"), "utf8"), "A\n");
  assert.equal(readFileSync(join(unitB, "b.txt"), "utf8"), "B\n");
});
