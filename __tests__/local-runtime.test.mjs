import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  APEX_PORT,
  LOCAL_RUNTIME_SCHEMA,
  SESSION_RUNTIME_SCHEMA,
  STORAGE_PORT,
  acquireLock,
  endLocalRuntimeTurn,
  startSessionRuntime,
  validateCanonicalRuntimeCandidate,
  validateOwnedService,
  validateOwnedSessionService,
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

test("session Vite ownership binds exact session, process start, repository, command, and token", () => {
  const token = "runtime-owner-token";
  const state = {
    schema: SESSION_RUNTIME_SCHEMA,
    status: "session-dev",
    sessionId: "session-a",
    source: { revision: applicationSha },
    agenticCanvasOs: { revision: docsSha },
    ownershipTokenDigest: "5822ab207d650e4afca6e5c0f3c0b153bda3b69c2b969f61793a5467704d6b0f",
    service: {
      supervisorPid: 100,
      listenerPid: 101,
      commandMarker: "node_modules/.bin/vite",
      processStartedAt: "Sat Jul 26 12:00:00 2026",
      listenerCwd: "/workspace/knowgrph/canvas",
    },
  };
  const candidate = {
    knowgrph: {
      root: "/workspace/knowgrph",
      gitCommonDir: "/workspace/knowgrph/.git",
      headSha: applicationSha,
    },
  };
  const evidence = {
    pid: 101,
    processGroupId: 100,
    processStartedAt: state.service.processStartedAt,
    cwd: state.service.listenerCwd,
    command: "node /workspace/knowgrph/node_modules/.bin/vite --strictPort",
    gitCommonDir: candidate.knowgrph.gitCommonDir,
    listenerEnvironment: `AGENTIC_SESSION_ID=session-a AGENTIC_SESSION_RUNTIME_TOKEN=${token} ` +
      `KNOWGRPH_SOURCE_REVISION=${applicationSha} KNOWGRPH_AGENTIC_CANVAS_OS_DOCS_REVISION=${docsSha}`,
  };
  assert.equal(validateOwnedSessionService({
    state, processEvidence: evidence, token, candidate, sessionId: "session-a",
  }), true);
  assert.throws(() => validateOwnedSessionService({
    state, processEvidence: evidence, token, candidate, sessionId: "session-b",
  }), /another session/);
  assert.throws(() => validateOwnedSessionService({
    state,
    processEvidence: { ...evidence, processStartedAt: "Sat Jul 26 12:00:01 2026" },
    token,
    candidate,
    sessionId: "session-a",
  }), /start identity/);
  assert.throws(() => validateOwnedSessionService({
    state,
    processEvidence: { ...evidence, listenerEnvironment: "AGENTIC_SESSION_ID=session-a" },
    token,
    candidate,
    sessionId: "session-a",
  }), /ownership token/);
});

test("turn end atomically stops the exact session Vite group and proves canonical runtime ready", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "agentic-session-runtime-"));
  const candidate = {
    workspaceRoot,
    agenticCanvasOsRoot: "/workspace/agentic-canvas-os",
    agenticCanvasOs: { headSha: docsSha },
    knowgrph: {
      root: "/workspace/knowgrph",
      gitCommonDir: "/workspace/knowgrph/.git",
      headSha: applicationSha,
    },
    protectedChecks: {
      "agentic-canvas-os": ["test", "build", "docs-contract", "collaboration-integration"],
      knowgrph: ["Integration Gate"],
    },
  };
  const listeners = new Map();
  const processes = new Map();
  const stoppedGroups = [];
  let nextGroup = 100;
  const dependencies = {
    inspectCanonicalCandidate: () => candidate,
    runLifecycle: () => ({ schema: "agentic-worktree-lifecycle-report/v1", status: "clean" }),
    openLog: () => 1,
    closeLog: () => {},
    spawnService: ({ cwd, env, args }) => {
      const port = args.includes(String(STORAGE_PORT)) ? STORAGE_PORT : APEX_PORT;
      const supervisorPid = nextGroup;
      nextGroup += 100;
      const listenerPid = supervisorPid + 1;
      const commandMarker = port === STORAGE_PORT ? "workerd" : "node_modules/.bin/vite";
      listeners.set(port, listenerPid);
      processes.set(listenerPid, {
        pid: listenerPid,
        cwd,
        processGroupId: supervisorPid,
        processStartedAt: `process-start-${listenerPid}`,
        command: `node ${commandMarker}`,
        listenerEnvironment: Object.entries(env).map(([key, value]) => `${key}=${value}`).join(" "),
        gitCommonDir: candidate.knowgrph.gitCommonDir,
      });
      return { pid: supervisorPid, unref: () => {} };
    },
    readListenerPid: port => listeners.get(port) || null,
    readListenerPids: port => listeners.has(port) ? [listeners.get(port)] : [],
    inspectListenerProcess: pid => processes.get(pid),
    readHttpStatus: async () => 200,
    waitForHttp: async () => 200,
    stopProcessGroup: supervisorPid => {
      stoppedGroups.push(supervisorPid);
      for (const [port, listenerPid] of listeners) {
        if (processes.get(listenerPid)?.processGroupId === supervisorPid) listeners.delete(port);
      }
    },
    waitForPortRelease: async port => assert.equal(listeners.has(port), false),
    now: () => new Date("2026-07-26T05:00:00.000Z"),
  };
  const options = {
    repository: candidate.knowgrph.root,
    agenticCanvasOsRoot: candidate.agenticCanvasOsRoot,
    sessionId: "session-a",
    timeoutMs: 10_000,
  };
  try {
    const session = await startSessionRuntime(options, dependencies);
    assert.equal(session.schema, SESSION_RUNTIME_SCHEMA);
    assert.equal(session.status, "session-dev");
    assert.equal(session.ready, false);
    assert.equal(listeners.get(APEX_PORT), 101);

    await assert.rejects(() => endLocalRuntimeTurn({ ...options, sessionId: "session-b" }, dependencies), /another session/);
    assert.deepEqual(stoppedGroups, []);
    assert.equal(listeners.get(APEX_PORT), 101);

    const result = await endLocalRuntimeTurn(options, dependencies);
    assert.equal(result.schema, LOCAL_RUNTIME_SCHEMA);
    assert.equal(result.status, "runtime-ready");
    assert.equal(result.ready, true);
    assert.equal(result.handoff.status, "session-runtime-stopped");
    assert.equal(result.handoff.stoppedSessionRuntime, true);
    assert.ok(stoppedGroups.includes(100));
    assert.equal(listeners.get(STORAGE_PORT), 201);
    assert.equal(listeners.get(APEX_PORT), 301);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
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

test("package exposes canonical and session-handoff supervisor commands", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.scripts["runtime:local:ensure"], "node ./scripts/local-runtime.mjs ensure");
  assert.equal(packageJson.scripts["runtime:local:status"], "node ./scripts/local-runtime.mjs status");
  assert.equal(packageJson.scripts["runtime:local:stop"], "node ./scripts/local-runtime.mjs stop");
  assert.equal(packageJson.scripts["runtime:session:start"], "node ./scripts/local-runtime.mjs session-start");
  assert.equal(packageJson.scripts["runtime:session:status"], "node ./scripts/local-runtime.mjs session-status");
  assert.equal(packageJson.scripts["runtime:session:stop"], "node ./scripts/local-runtime.mjs session-stop");
  assert.equal(packageJson.scripts["turn:end"], "node ./scripts/local-runtime.mjs turn-end");
  assert.equal(packageJson.scripts["device:turn-end"], undefined);
  assert.deepEqual({ apex: APEX_PORT, storage: STORAGE_PORT }, { apex: 5173, storage: 8787 });
  assert.equal(LOCAL_RUNTIME_SCHEMA, "agentic-local-runtime-readiness/v1");
});
