import test from "node:test";
import assert from "node:assert/strict";

import {
  acquirePortLock,
  REVIEWED_RUNTIME_SCHEMA,
  reconcileTurnEndListeners,
  validateReviewedRuntimeCandidate,
  validateRuntimeStopOwnership,
  validateTurnEndListenerOwnership,
} from "../scripts/reviewed-runtime-lib.mjs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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

test("turn-end listener ownership accepts only same-repository Vite processes", () => {
  const candidate = { gitCommonDir: "/workspace/knowgrph/.git" };
  const processEvidence = {
    pid: 101,
    processGroupId: 100,
    command: "node /workspace/knowgrph/node_modules/.bin/vite --host 127.0.0.1",
    gitCommonDir: candidate.gitCommonDir,
  };
  assert.equal(validateTurnEndListenerOwnership(processEvidence, candidate), true);
  assert.throws(
    () => validateTurnEndListenerOwnership({ ...processEvidence, gitCommonDir: "/workspace/unrelated/.git" }, candidate),
    /unrelated repository/,
  );
  assert.throws(
    () => validateTurnEndListenerOwnership({ ...processEvidence, command: "python -m http.server" }, candidate),
    /not a repository-owned Vite runtime/,
  );
});

test("turn-end reconciliation validates every listener before stopping unique process groups", async () => {
  const candidate = { gitCommonDir: "/workspace/knowgrph/.git" };
  const stopped = [];
  let releasedPort = null;
  const viteProcess = (pid, processGroupId) => ({
    pid,
    processGroupId,
    command: `node /workspace/knowgrph/node_modules/.bin/vite --pid=${pid}`,
    gitCommonDir: candidate.gitCommonDir,
  });
  await reconcileTurnEndListeners({
    candidate,
    port: 5173,
    processes: [viteProcess(101, 100), viteProcess(102, 100), viteProcess(201, 200)],
  }, {
    stopProcessGroup: processGroupId => stopped.push(processGroupId),
    waitForPortRelease: async port => { releasedPort = port; },
  });
  assert.deepEqual(stopped, [100, 200]);
  assert.equal(releasedPort, 5173);

  stopped.length = 0;
  await assert.rejects(
    reconcileTurnEndListeners({
      candidate,
      port: 5173,
      processes: [viteProcess(101, 100), { ...viteProcess(202, 200), gitCommonDir: "/workspace/unrelated/.git" }],
    }, {
      stopProcessGroup: processGroupId => stopped.push(processGroupId),
      waitForPortRelease: async () => {},
    }),
    /unrelated repository/,
  );
  assert.deepEqual(stopped, []);
});

test("turn-end port lock serializes live owners and recovers a dead stale owner", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-turn-end-lock-"));
  const lockPath = path.join(directory, "5173.lock");
  try {
    const release = acquirePortLock(lockPath);
    assert.throws(() => acquirePortLock(lockPath), new RegExp(`active PID ${process.pid}`));
    release();
    await writeFile(lockPath, `${JSON.stringify({ pid: 999_999_999 })}\n`, "utf8");
    const releaseRecovered = acquirePortLock(lockPath);
    releaseRecovered();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reviewed runtime package scripts expose explicit start status and stop commands", async () => {
  const packageJson = JSON.parse(await (await import("node:fs/promises")).readFile(new URL("../package.json", import.meta.url), "utf8"));
  const runtimeSource = await (await import("node:fs/promises")).readFile(new URL("../scripts/reviewed-runtime-lib.mjs", import.meta.url), "utf8");
  assert.equal(packageJson.scripts["device:serve-reviewed"], "node ./scripts/reviewed-runtime.mjs start");
  assert.equal(packageJson.scripts["device:turn-end"], "node ./scripts/reviewed-runtime.mjs handoff");
  assert.equal(packageJson.scripts["device:runtime-status"], "node ./scripts/reviewed-runtime.mjs status");
  assert.equal(packageJson.scripts["device:runtime-stop"], "node ./scripts/reviewed-runtime.mjs stop");
  assert.match(runtimeSource, /VITE_WORKSPACE_INITIALIZATION_DOCS_ABS_ROOT: path\.join\(candidate\.canonicalRepository, "docs"\)/);
  assert.match(runtimeSource, /VITE_WORKSPACE_INITIALIZATION_AGENTIC_CANVAS_OS_DOCS_ABS_ROOT: path\.join\(candidate\.agenticCanvasOsRoot, "docs"\)/);
});
