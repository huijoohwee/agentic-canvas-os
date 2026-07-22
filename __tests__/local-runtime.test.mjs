import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  APEX_PORT,
  LOCAL_RUNTIME_SCHEMA,
  STORAGE_PORT,
  acquireLock,
  validateCanonicalRuntimeCandidate,
  validateOwnedService,
} from "../scripts/local-runtime-lib.mjs";

const applicationSha = "a".repeat(40);
const docsSha = "b".repeat(40);

function repository(id, revision, overrides = {}) {
  return {
    id,
    branch: "main",
    clean: true,
    headSha: revision,
    remoteSha: revision,
    protectedChecksVerified: true,
    checks: ["verified"],
    ...overrides,
  };
}

function validCandidate(overrides = {}) {
  return {
    agenticCanvasOs: repository("agentic-canvas-os", docsSha),
    knowgrph: {
      ...repository("knowgrph", applicationSha),
      gitCommonDir: "/workspace/knowgrph/.git",
      hasDevApexScript: true,
      hasStorageWorkerScript: true,
    },
    ...overrides,
  };
}

test("canonical runtime accepts only clean protected exact-main sources", () => {
  assert.equal(validateCanonicalRuntimeCandidate(validCandidate()).knowgrph.headSha, applicationSha);
});

for (const [name, candidate, expected] of [
  ["task branch", validCandidate({ knowgrph: { ...validCandidate().knowgrph, branch: "agent/device/task" } }), /must be on main/],
  ["dirty docs", validCandidate({ agenticCanvasOs: repository("agentic-canvas-os", docsSha, { clean: false }) }), /must be clean/],
  ["stale application", validCandidate({ knowgrph: { ...validCandidate().knowgrph, remoteSha: "c".repeat(40) } }), /must equal fetched origin\/main/],
  ["missing protected checks", validCandidate({ knowgrph: { ...validCandidate().knowgrph, protectedChecksVerified: false } }), /protected checks/],
  ["missing storage owner", validCandidate({ knowgrph: { ...validCandidate().knowgrph, hasStorageWorkerScript: false } }), /storage:worker:dev/],
]) {
  test(`canonical runtime rejects ${name}`, () => {
    assert.throws(() => validateCanonicalRuntimeCandidate(candidate), expected);
  });
}

test("service ownership binds listener group repository command and token", () => {
  const token = "runtime-owner-token";
  const tokenDigest = "5822ab207d650e4afca6e5c0f3c0b153bda3b69c2b969f61793a5467704d6b0f";
  const service = { name: "apex", supervisorPid: 100, listenerPid: 101, commandMarker: "node_modules/.bin/vite" };
  const evidence = {
    pid: 101,
    processGroupId: 100,
    command: "node /workspace/knowgrph/node_modules/.bin/vite --strictPort",
    gitCommonDir: "/workspace/knowgrph/.git",
    listenerEnvironment: `node_modules/.bin/vite AGENTIC_LOCAL_RUNTIME_TOKEN=${token}`,
  };
  assert.equal(validateOwnedService({ service, processEvidence: evidence, token, tokenDigest, candidate: validCandidate() }), true);
  assert.throws(
    () => validateOwnedService({ service, processEvidence: { ...evidence, gitCommonDir: "/workspace/other/.git" }, token, tokenDigest, candidate: validCandidate() }),
    /unrelated repository/,
  );
  assert.throws(
    () => validateOwnedService({ service, processEvidence: { ...evidence, processGroupId: 999 }, token, tokenDigest, candidate: validCandidate() }),
    /process group/,
  );
  assert.throws(
    () => validateOwnedService({ service, processEvidence: { ...evidence, listenerEnvironment: "node_modules/.bin/vite" }, token, tokenDigest, candidate: validCandidate() }),
    /ownership token/,
  );
});

test("host lock serializes active owners and recovers a dead stale owner", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-local-runtime-lock-"));
  const lockPath = path.join(directory, "supervisor.lock");
  try {
    const release = acquireLock(lockPath);
    assert.throws(() => acquireLock(lockPath), new RegExp(`active PID ${process.pid}`));
    release();
    await writeFile(lockPath, `${JSON.stringify({ pid: 999_999_999 })}\n`, "utf8");
    const releaseRecovered = acquireLock(lockPath);
    releaseRecovered();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("package exposes one canonical supervisor command family", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.scripts["runtime:local:ensure"], "node ./scripts/local-runtime.mjs ensure");
  assert.equal(packageJson.scripts["runtime:local:status"], "node ./scripts/local-runtime.mjs status");
  assert.equal(packageJson.scripts["runtime:local:stop"], "node ./scripts/local-runtime.mjs stop");
  assert.equal(packageJson.scripts["turn:end"], "node ./scripts/local-runtime.mjs turn-end");
  assert.equal(packageJson.scripts["device:turn-end"], undefined);
  assert.deepEqual({ apex: APEX_PORT, storage: STORAGE_PORT }, { apex: 5173, storage: 8787 });
  assert.equal(LOCAL_RUNTIME_SCHEMA, "agentic-local-runtime-readiness/v1");
});
