import test from "node:test";
import assert from "node:assert/strict";

import {
  REVIEWED_RUNTIME_SCHEMA,
  validateReviewedRuntimeCandidate,
  validateRuntimeStopOwnership,
} from "../scripts/reviewed-runtime-lib.mjs";

const repository = "/workspace/.worktrees/knowgrph/reviewed-runtime";
const branch = "agent/device/reviewed-runtime";
const reviewHeadSha = "a".repeat(40);
const docsSha = "b".repeat(40);

function validEvidence(overrides = {}) {
  return {
    repository,
    repositoryClean: true,
    branch,
    headSha: reviewHeadSha,
    lease: {
      status: "review_ready",
      branch,
      worktreePath: repository,
      reviewHeadSha,
    },
    remoteHeadSha: reviewHeadSha,
    pullRequest: { state: "OPEN", isDraft: false, headRefOid: reviewHeadSha },
    hasDevApexScript: true,
    agenticCanvasOsClean: true,
    agenticCanvasOsBranch: "main",
    agenticCanvasOsRevision: docsSha,
    agenticCanvasOsRemoteRevision: docsSha,
    ...overrides,
  };
}

test("reviewed runtime accepts only an exact clean review-ready source", () => {
  assert.equal(validateReviewedRuntimeCandidate(validEvidence()).headSha, reviewHeadSha);
});

for (const [name, override, expected] of [
  ["dirty worktree", { repositoryClean: false }, /clean task worktree/],
  ["active lease", { lease: { ...validEvidence().lease, status: "active" } }, /status review_ready/],
  ["review head drift", { headSha: "c".repeat(40) }, /HEAD does not equal reviewHeadSha/],
  ["remote drift", { remoteHeadSha: "c".repeat(40) }, /remote head/],
  ["draft pull request", { pullRequest: { state: "OPEN", isDraft: true, headRefOid: reviewHeadSha } }, /ready-for-review/],
  ["pull request head drift", { pullRequest: { state: "OPEN", isDraft: false, headRefOid: "c".repeat(40) } }, /pull-request head/],
  ["missing dev owner", { hasDevApexScript: false }, /dev:apex/],
  ["dirty docs main", { agenticCanvasOsClean: false }, /clean canonical Agentic Canvas OS/],
  ["docs revision drift", { agenticCanvasOsRemoteRevision: "c".repeat(40) }, /equal fetched origin\/main/],
]) {
  test(`reviewed runtime rejects ${name}`, () => {
    assert.throws(() => validateReviewedRuntimeCandidate(validEvidence(override)), expected);
  });
}

test("reviewed runtime stop rejects an unrelated listener PID", () => {
  const state = {
    schema: REVIEWED_RUNTIME_SCHEMA,
    port: 5176,
    supervisorPid: 100,
    listenerPid: 101,
  };
  assert.throws(() => validateRuntimeStopOwnership(state, 202), /unrelated PID 202/);
  assert.equal(validateRuntimeStopOwnership(state, 101), true);
  assert.equal(validateRuntimeStopOwnership(state, null), true);
});

test("reviewed runtime package scripts expose explicit start status and stop commands", async () => {
  const packageJson = JSON.parse(await (await import("node:fs/promises")).readFile(new URL("../package.json", import.meta.url), "utf8"));
  const runtimeSource = await (await import("node:fs/promises")).readFile(new URL("../scripts/reviewed-runtime-lib.mjs", import.meta.url), "utf8");
  assert.equal(packageJson.scripts["device:serve-reviewed"], "node ./scripts/reviewed-runtime.mjs start");
  assert.equal(packageJson.scripts["device:runtime-status"], "node ./scripts/reviewed-runtime.mjs status");
  assert.equal(packageJson.scripts["device:runtime-stop"], "node ./scripts/reviewed-runtime.mjs stop");
  assert.match(runtimeSource, /VITE_WORKSPACE_INITIALIZATION_DOCS_ABS_ROOT: path\.join\(candidate\.canonicalRepository, "docs"\)/);
  assert.match(runtimeSource, /VITE_WORKSPACE_INITIALIZATION_AGENTIC_CANVAS_OS_DOCS_ABS_ROOT: path\.join\(candidate\.agenticCanvasOsRoot, "docs"\)/);
});
