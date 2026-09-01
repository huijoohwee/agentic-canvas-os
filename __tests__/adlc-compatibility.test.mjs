import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { completeDeviceLane } from "../scripts/device-branch.mjs";
import { collectScopedLaneState } from "../scripts/scoped-lane-admission-state.mjs";
import { buildLifecycleReport } from "../scripts/worktree-lifecycle.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHA = "a".repeat(40);

test("compatibility entrypoints import no deleted ACOS lifecycle implementation", () => {
  const relativeImports = /from\s+["']\.\/([^"']+)["']/gu;
  const allowedRelativeImports = new Set(["repository-guards.mjs", "worktree-lifecycle.mjs"]);
  for (const relativePath of [
    "scripts/worktree-lifecycle.mjs",
    "scripts/device-branch.mjs",
    "scripts/scoped-lane-admission-state.mjs",
    "scripts/repository-guards.mjs",
  ]) {
    const source = readFileSync(path.join(ROOT, relativePath), "utf8");
    const imports = [...source.matchAll(relativeImports)].map(match => match[1]);
    assert.deepEqual(
      imports.filter(candidate => !allowedRelativeImports.has(candidate)),
      [],
      relativePath,
    );
  }
});

test("lane-state compatibility exposes honest ADLC identity and no writer lease", () => {
  const repository = "/repo";
  const lanePath = "/tasks/device--scope";
  const laneHead = "b".repeat(40);
  const porcelain = [
    `worktree ${repository}`,
    `HEAD ${SHA}`,
    "branch refs/heads/main",
    `worktree ${lanePath}`,
    `HEAD ${laneHead}`,
    "branch refs/heads/agent/device/scope",
    "",
  ].join("\0");
  const git = (cwd, args) => {
    const command = args.join(" ");
    if (command === "worktree list --porcelain -z") return porcelain;
    if (command === "rev-parse origin/main") return SHA;
    if (command === "status --porcelain=v1 -z --untracked-files=all") return "";
    if (command === "ls-files --stage -z") return "";
    if (command === "ls-files --modified --deleted --others --exclude-standard -z") return "";
    if (command === "rev-parse HEAD^{tree}") {
      return cwd === repository ? "c".repeat(40) : "d".repeat(40);
    }
    throw new Error(`unexpected git call: ${cwd} ${command}`);
  };
  const result = collectScopedLaneState({
    repository,
    git,
    readLaneStore: () => ({
      schema: "agentic-os/lanes/v1",
      lanes: {
        "agent/device/scope": { ref: "agent/device/scope", state: "queued" },
      },
    }),
  });

  assert.equal(result.canonicalBaseSha, SHA);
  assert.equal(result.canonicalSourceDisposition, "exact");
  assert.match(result.registryDigest, /^[0-9a-f]{64}$/u);
  assert.match(result.laneStateDigest, /^[0-9a-f]{64}$/u);
  assert.equal(result.lanes[1].lease, null);
  assert.equal(result.lanes[1].leaseAmbiguous, false);
  assert.deepEqual(result.lanes[1].branchIdentity, {
    schema: "agentic-os-lane-identity/v1",
    coordination: "git-branch",
    ref: "agent/device/scope",
    device: "device",
    scope: "scope",
    state: "queued",
  });
});

test("device complete retires only a clean lane with ADLC integration proof", () => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "acos-adlc-compat-"));
  const remote = path.join(fixture, "origin.git");
  const canonical = path.join(fixture, "repository");
  const target = path.join(fixture, "lane");
  const branch = "agent/test-device/compat-cleanup";
  try {
    git(fixture, ["init", "--bare", remote]);
    git(remote, ["symbolic-ref", "HEAD", "refs/heads/main"]);
    git(fixture, ["clone", remote, canonical]);
    writeFileSync(path.join(canonical, "README.md"), "fixture\n");
    git(canonical, ["add", "README.md"]);
    commit(canonical, "test: initialize fixture");
    git(canonical, ["push", "--set-upstream", "origin", "main"]);

    git(canonical, ["worktree", "add", "-b", branch, target]);
    writeFileSync(path.join(target, "lane.txt"), "lane\n");
    git(target, ["add", "lane.txt"]);
    commit(target, "test: lane change");
    const laneHead = git(target, ["rev-parse", "HEAD"]);
    git(target, ["push", "--set-upstream", "origin", branch]);

    commit(canonical, "test: integrate lane", ["--allow-empty", "-m", `Source-Head: ${laneHead}`]);
    git(canonical, ["push", "origin", "main"]);
    assert.equal(buildLifecycleReport({ repository: target }).status, "ready");

    const result = completeDeviceLane({ repository: target });
    assert.equal(result.status, "ok");
    assert.equal(result.completedBranch, branch);
    assert.equal(result.integrationProof.kind, "source-head-trailer");
    assert.equal(result.cleanup.registeredAfter, false);
    assert.equal(result.cleanup.pathPresentAfter, false);
    assert.equal(result.cleanup.branchPresentAfter, false);
    assert.equal(existsSync(target), false);
    assert.equal(git(canonical, ["branch", "--list", branch]), "");

    const script = path.join(ROOT, "scripts/device-branch.mjs");
    const unsupported = spawnSync(process.execPath, [script, "start"], {
      cwd: canonical,
      encoding: "utf8",
    });
    assert.equal(unsupported.status, 1);
    assert.match(unsupported.stderr, /Unsupported legacy device command start/u);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function commit(cwd, subject, extra = []) {
  git(cwd, [
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "-m",
    subject,
    ...extra,
  ]);
}
