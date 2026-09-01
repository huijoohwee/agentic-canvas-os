import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { collectScopedLaneState } from "../scripts/scoped-lane-admission-state.mjs";
import { summarizeOwnedPaths } from "../scripts/worktree-lifecycle.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHA = "a".repeat(40);
const PROFILE = Object.freeze({
  canonical: Object.freeze({
    localRef: "refs/heads/main",
    remoteRef: "refs/remotes/origin/main",
  }),
});

test("ACOS pins the reviewed agentic-os compatibility contract", () => {
  const packageJson = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(
    packageJson.devDependencies["agentic-os"],
    "https://codeload.github.com/huijoohwee/agentic-os/tar.gz/3d27ffd564d311709193ca11dd20746e0851b96a",
  );
  assert.equal(packageJson.scripts["autonomy-class"], "agentic-os autonomy-class");
  assert.equal(existsSync(path.join(ROOT, "scripts", "autonomy-class.mjs")), false);
  assert.equal(existsSync(path.join(ROOT, "__tests__", "autonomy-class.test.mjs")), false);
});

test("compatibility projections are observation-only and have no private imports", () => {
  const sources = [
    "scripts/worktree-lifecycle.mjs",
    "scripts/scoped-lane-admission-state.mjs",
  ].map(relativePath => readFileSync(path.join(ROOT, relativePath), "utf8"));
  for (const source of sources) assert.doesNotMatch(source, /agentic-os\/src\//u);
  assert.match(sources[0], /agentic-os\/adapters\/git/u);
  assert.match(sources[0], /agentic-os\/compat\//u);
  assert.match(sources[1], /agentic-os\/adapters\/git/u);
  assert.match(sources[1], /agentic-os\/compat\//u);
  assert.doesNotMatch(sources[0], /cleanupIntegratedLane|\bretire\b|\bremoveLaneRecord\b/u);
});

test("legacy cleanup aliases are removed while the profile retains every cleanup effect", () => {
  const packageJson = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(Object.hasOwn(packageJson.scripts, "device:complete"), false);
  assert.equal(Object.hasOwn(packageJson.scripts, "worktree:lifecycle:cleanup"), false);
  assert.equal(existsSync(path.join(ROOT, "scripts", "device-branch.mjs")), false);
  const profile = JSON.parse(readFileSync(path.join(ROOT, ".agentic-os.json"), "utf8"));
  assert.ok(Object.values(profile.cleanup).every(effect => effect === "retain"));
});

test("lifecycle observation bounds owned-path output without concealing its digest", () => {
  const summary = summarizeOwnedPaths(["z", "a", "z", "b"], 2);
  assert.deepEqual(summary.sample, ["a", "b"]);
  assert.equal(summary.count, 3);
  assert.equal(summary.truncated, true);
  assert.match(summary.digest, /^[0-9a-f]{64}$/u);
});

test("lane-state compatibility derives canonical identity from the ADLC profile", () => {
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
    if (command === "rev-parse refs/remotes/origin/main") return SHA;
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
    readProfile: () => PROFILE,
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
