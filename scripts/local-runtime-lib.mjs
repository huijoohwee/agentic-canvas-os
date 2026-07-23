import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export const LOCAL_RUNTIME_SCHEMA = "agentic-local-runtime-readiness/v1";
export const LOCAL_RUNTIME_HOST = "127.0.0.1";
export const APEX_PORT = 5173;
export const STORAGE_PORT = 8787;
export const DEFAULT_TIMEOUT_MS = 120_000;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const STORAGE_EXPORT_PATH = "/api/storage/export/kgws%3Acanonical-docs";
const REQUIRED_CHECKS = Object.freeze({
  "agentic-canvas-os": ["test", "build", "docs-contract", "collaboration-integration"],
  knowgrph: ["Integration Gate"],
});

export async function ensureLocalRuntime(options = {}, dependencies = {}) {
  const deps = createDependencies(dependencies);
  const normalized = normalizeOptions(options);
  const candidate = inspectCanonicalCandidate(normalized, deps, { verifyProtected: true });
  const locations = runtimeLocations(candidate.workspaceRoot);
  const releaseLock = deps.acquireLock(locations.lockPath);
  try {
    const currentState = readJson(locations.statePath);
    if (currentState) {
      const currentStatus = await inspectRuntimeState(currentState, candidate, locations, deps);
      if (currentStatus.ready) return currentStatus;
      await stopRecordedServices(currentState, candidate, locations, deps);
      deps.removeFile(locations.statePath);
      deps.removeFile(locations.tokenPath);
    }
    assertPortsUnclaimed(deps);
    return await startRuntime(candidate, normalized, locations, deps);
  } finally {
    releaseLock();
  }
}

export async function readLocalRuntimeStatus(options = {}, dependencies = {}) {
  const deps = createDependencies(dependencies);
  const normalized = normalizeOptions(options);
  const candidate = inspectCanonicalCandidate(normalized, deps, { verifyProtected: true });
  const locations = runtimeLocations(candidate.workspaceRoot);
  const state = readJson(locations.statePath);
  if (!state) return stoppedProjection(candidate);
  return inspectRuntimeState(state, candidate, locations, deps);
}

export async function stopLocalRuntime(options = {}, dependencies = {}) {
  const deps = createDependencies(dependencies);
  const normalized = normalizeOptions(options);
  const candidate = inspectOwnershipCandidate(normalized, deps);
  const locations = runtimeLocations(candidate.workspaceRoot);
  const releaseLock = deps.acquireLock(locations.lockPath);
  try {
    const state = readJson(locations.statePath);
    if (!state) return stoppedProjection(candidate);
    await stopRecordedServices(state, candidate, locations, deps);
    deps.removeFile(locations.statePath);
    deps.removeFile(locations.tokenPath);
    return { ...projectState(state), status: "stopped", ready: false };
  } finally {
    releaseLock();
  }
}

export async function endLocalRuntimeTurn(options = {}, dependencies = {}) {
  const deps = createDependencies(dependencies);
  const normalized = normalizeOptions(options);
  const candidate = inspectCanonicalCandidate(normalized, deps, { verifyProtected: false });
  const lifecycle = deps.runLifecycle(candidate.agenticCanvasOsRoot);
  const runtime = await ensureLocalRuntime(normalized, deps);
  return { ...runtime, action: "turn-end", lifecycle };
}

export function validateCanonicalRuntimeCandidate(evidence) {
  for (const repository of [evidence.agenticCanvasOs, evidence.knowgrph]) {
    if (repository.branch !== "main") throw new Error(`${repository.id} canonical runtime checkout must be on main.`);
    if (!repository.clean) throw new Error(`${repository.id} canonical runtime checkout must be clean.`);
    if (!SHA_PATTERN.test(String(repository.headSha || ""))) throw new Error(`${repository.id} requires an exact 40-character SHA.`);
    if (repository.headSha !== repository.remoteSha) throw new Error(`${repository.id} canonical HEAD must equal fetched origin/main.`);
    if (!repository.protectedChecksVerified) throw new Error(`${repository.id} protected checks are not verified for ${repository.headSha}.`);
  }
  if (!evidence.knowgrph.hasDevApexScript || !evidence.knowgrph.hasStorageWorkerScript) {
    throw new Error("Knowgrph must expose repository-owned dev:apex and storage:worker:dev scripts.");
  }
  return evidence;
}

export function validateOwnedService({ service, processEvidence, token, tokenDigest, candidate }) {
  if (!service || !Number.isInteger(service.supervisorPid) || service.supervisorPid <= 0) {
    throw new Error("Runtime service state has no valid supervisor PID.");
  }
  if (!processEvidence || processEvidence.pid !== service.listenerPid) {
    throw new Error(`${service.name} listener PID no longer matches recorded ownership.`);
  }
  if (processEvidence.processGroupId !== service.supervisorPid) {
    throw new Error(`${service.name} listener no longer belongs to its recorded process group.`);
  }
  if (path.resolve(processEvidence.gitCommonDir || "") !== path.resolve(candidate.knowgrph.gitCommonDir)) {
    throw new Error(`${service.name} listener belongs to an unrelated repository.`);
  }
  if (!String(processEvidence.command || "").includes(service.commandMarker)) {
    throw new Error(`${service.name} listener command does not match its runtime owner.`);
  }
  if (!String(processEvidence.listenerEnvironment || "").includes(`AGENTIC_LOCAL_RUNTIME_TOKEN=${token}`)) {
    throw new Error(`${service.name} process ownership token is missing or changed.`);
  }
  if (sha256(token) !== tokenDigest) throw new Error("Runtime ownership token digest does not match local state.");
  return true;
}

async function startRuntime(candidate, options, locations, deps) {
  deps.mkdir(locations.runtimeRoot);
  const token = randomUUID();
  deps.writePrivateFile(locations.tokenPath, `${token}\n`);
  const tokenDigest = sha256(token);
  const environment = {
    ...process.env,
    AGENTIC_LOCAL_RUNTIME_TOKEN: token,
    KNOWGRPH_SOURCE_REVISION: candidate.knowgrph.headSha,
    KNOWGRPH_AGENTIC_CANVAS_OS_DOCS_ROOT: path.join(candidate.agenticCanvasOsRoot, "docs"),
    KNOWGRPH_AGENTIC_CANVAS_OS_DOCS_REVISION: candidate.agenticCanvasOs.headSha,
    VITE_WORKSPACE_INITIALIZATION_AGENTIC_CANVAS_OS_DOCS_ABS_ROOT: path.join(candidate.agenticCanvasOsRoot, "docs"),
  };
  const started = [];
  try {
    const storage = await launchService({
      name: "storage",
      port: STORAGE_PORT,
      commandMarker: "workerd",
      command: ["npm", ["run", "storage:worker:dev", "--", "--ip", LOCAL_RUNTIME_HOST, "--port", String(STORAGE_PORT)]],
      healthUrl: `http://${LOCAL_RUNTIME_HOST}:${STORAGE_PORT}${STORAGE_EXPORT_PATH}`,
      logPath: locations.storageLogPath,
    }, candidate, environment, options.timeoutMs, deps);
    started.push(storage);
    const apex = await launchService({
      name: "apex",
      port: APEX_PORT,
      commandMarker: "node_modules/.bin/vite",
      command: ["npm", ["run", "dev:apex", "--", "--host", LOCAL_RUNTIME_HOST, "--port", String(APEX_PORT), "--strictPort"]],
      healthUrl: `http://${LOCAL_RUNTIME_HOST}:${APEX_PORT}/`,
      logPath: locations.apexLogPath,
    }, candidate, environment, options.timeoutMs, deps);
    started.push(apex);
    const proxyStatus = await deps.waitForHttp(`http://${LOCAL_RUNTIME_HOST}:${APEX_PORT}${STORAGE_EXPORT_PATH}`, options.timeoutMs);
    const state = {
      schema: LOCAL_RUNTIME_SCHEMA,
      status: "runtime-ready",
      application: "knowgrph",
      surface: "apex",
      source: { repository: "huijoohwee/knowgrph", revision: candidate.knowgrph.headSha },
      agenticCanvasOs: { repository: "huijoohwee/agentic-canvas-os", revision: candidate.agenticCanvasOs.headSha },
      catalogRevision: candidate.agenticCanvasOs.headSha,
      host: LOCAL_RUNTIME_HOST,
      ports: { apex: APEX_PORT, storage: STORAGE_PORT },
      services: { storage, apex },
      probes: { apex: apex.httpStatus, storage: storage.httpStatus, storageProxy: proxyStatus },
      protectedChecks: candidate.protectedChecks,
      ownershipTokenDigest: tokenDigest,
      startedAt: deps.now().toISOString(),
      verifiedAt: deps.now().toISOString(),
    };
    writeJsonAtomic(locations.statePath, state, deps);
    return readyProjection(state);
  } catch (error) {
    for (const service of started.reverse()) deps.stopProcessGroup(service.supervisorPid);
    await Promise.all(started.map(service => deps.waitForPortRelease(service.port, 10_000).catch(() => {})));
    deps.removeFile(locations.tokenPath);
    throw error;
  }
}

async function launchService(spec, candidate, environment, timeoutMs, deps) {
  const logFd = deps.openLog(spec.logPath);
  let child;
  try {
    child = deps.spawnService({ cwd: candidate.knowgrph.root, env: environment, command: spec.command[0], args: spec.command[1], logFd });
  } finally {
    deps.closeLog(logFd);
  }
  if (!Number.isInteger(child.pid) || child.pid <= 0) throw new Error(`${spec.name} did not return a valid supervisor PID.`);
  child.unref?.();
  try {
    const httpStatus = await deps.waitForHttp(spec.healthUrl, timeoutMs);
    const listenerPid = deps.readListenerPid(spec.port);
    if (!listenerPid) throw new Error(`${spec.name} responded without an observable listener PID.`);
    return {
      name: spec.name,
      port: spec.port,
      supervisorPid: child.pid,
      listenerPid,
      commandMarker: spec.commandMarker,
      logPath: spec.logPath,
      healthUrl: spec.healthUrl,
      httpStatus,
      processStartedAt: deps.inspectListenerProcess(listenerPid).processStartedAt,
    };
  } catch (error) {
    deps.stopProcessGroup(child.pid);
    throw error;
  }
}

async function inspectRuntimeState(state, candidate, locations, deps) {
  try {
    validateStateShape(state, candidate);
    const token = deps.readPrivateFile(locations.tokenPath).trim();
    for (const service of Object.values(state.services)) {
      const listenerPid = deps.readListenerPid(service.port);
      const processEvidence = listenerPid ? deps.inspectListenerProcess(listenerPid) : null;
      validateOwnedService({ service, processEvidence, token, tokenDigest: state.ownershipTokenDigest, candidate });
    }
    const probes = await probeRuntime(deps);
    if (Object.values(probes).some(status => status !== 200)) throw new Error("One or more local runtime probes are unavailable.");
    return readyProjection({ ...state, probes, verifiedAt: deps.now().toISOString() });
  } catch (error) {
    return {
      ...projectState(state),
      status: "blocked",
      ready: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function validateStateShape(state, candidate) {
  if (state?.schema !== LOCAL_RUNTIME_SCHEMA) throw new Error("Local runtime state has an unsupported schema.");
  if (state.source?.revision !== candidate.knowgrph.headSha) throw new Error("Recorded Knowgrph SHA does not match canonical main.");
  if (state.agenticCanvasOs?.revision !== candidate.agenticCanvasOs.headSha) throw new Error("Recorded Agentic Canvas OS SHA does not match canonical main.");
  if (state.catalogRevision !== candidate.agenticCanvasOs.headSha) throw new Error("Recorded catalog SHA does not match Agentic Canvas OS.");
  if (!state.services?.storage || !state.services?.apex) throw new Error("Local runtime state is missing a required service.");
}

async function stopRecordedServices(state, candidate, locations, deps) {
  if (state?.schema !== LOCAL_RUNTIME_SCHEMA) throw new Error("Local runtime state has an unsupported schema.");
  if (!state.services?.storage || !state.services?.apex) throw new Error("Local runtime state is missing a required service.");
  const token = deps.readPrivateFile(locations.tokenPath).trim();
  const owned = [];
  for (const service of Object.values(state.services)) {
    const listenerPid = deps.readListenerPid(service.port);
    if (!listenerPid) continue;
    const processEvidence = deps.inspectListenerProcess(listenerPid);
    validateOwnedService({ service, processEvidence, token, tokenDigest: state.ownershipTokenDigest, candidate });
    owned.push(service);
  }
  for (const service of owned) deps.stopProcessGroup(service.supervisorPid);
  await Promise.all(owned.map(service => deps.waitForPortRelease(service.port, 10_000)));
}

function inspectCanonicalCandidate(options, deps, { verifyProtected }) {
  const invokingRoot = realpathSync(options.agenticCanvasOsRoot);
  const commonDir = resolveGitCommonDir(invokingRoot, deps);
  const agenticCanvasOsRoot = path.dirname(commonDir);
  const workspaceRoot = path.dirname(agenticCanvasOsRoot);
  const knowgrphRoot = realpathSync(options.repository || path.join(workspaceRoot, "knowgrph"));
  const repositories = [
    inspectRepository("agentic-canvas-os", agenticCanvasOsRoot, deps, verifyProtected),
    inspectRepository("knowgrph", knowgrphRoot, deps, verifyProtected),
  ];
  const packageJson = JSON.parse(readFileSync(path.join(knowgrphRoot, "package.json"), "utf8"));
  const protectedChecks = Object.fromEntries(repositories.map(repository => [repository.id, repository.checks]));
  const evidence = validateCanonicalRuntimeCandidate({
    agenticCanvasOs: repositories[0],
    knowgrph: {
      ...repositories[1],
      hasDevApexScript: typeof packageJson.scripts?.["dev:apex"] === "string",
      hasStorageWorkerScript: typeof packageJson.scripts?.["storage:worker:dev"] === "string",
    },
  });
  return { workspaceRoot, agenticCanvasOsRoot, knowgrph: { ...evidence.knowgrph, root: knowgrphRoot }, agenticCanvasOs: evidence.agenticCanvasOs, protectedChecks };
}

function inspectOwnershipCandidate(options, deps) {
  const invokingRoot = realpathSync(options.agenticCanvasOsRoot);
  const agenticCanvasOsRoot = path.dirname(resolveGitCommonDir(invokingRoot, deps));
  const workspaceRoot = path.dirname(agenticCanvasOsRoot);
  const knowgrphRoot = realpathSync(options.repository || path.join(workspaceRoot, "knowgrph"));
  return {
    workspaceRoot,
    agenticCanvasOsRoot,
    agenticCanvasOs: { headSha: deps.gitText(agenticCanvasOsRoot, ["rev-parse", "HEAD"]).trim() },
    knowgrph: {
      root: knowgrphRoot,
      headSha: deps.gitText(knowgrphRoot, ["rev-parse", "HEAD"]).trim(),
      gitCommonDir: resolveGitCommonDir(knowgrphRoot, deps),
    },
  };
}

function inspectRepository(id, root, deps, verifyProtected) {
  deps.gitText(root, ["fetch", "--quiet", "--prune", "origin", "main"]);
  const headSha = deps.gitText(root, ["rev-parse", "HEAD"]).trim();
  const remoteSha = deps.gitText(root, ["rev-parse", "origin/main"]).trim();
  const checks = verifyProtected ? deps.verifyProtectedChecks(id, root, remoteSha, REQUIRED_CHECKS[id]) : ["cached-status-check"];
  return {
    id,
    root,
    gitCommonDir: resolveGitCommonDir(root, deps),
    branch: deps.gitText(root, ["branch", "--show-current"]).trim(),
    clean: deps.gitText(root, ["status", "--porcelain"]).trim() === "",
    headSha,
    remoteSha,
    protectedChecksVerified: checks.length > 0,
    checks,
  };
}

function verifyProtectedChecks(id, root, revision, requiredNames) {
  const remote = execFileSync("git", ["remote", "get-url", "origin"], { cwd: root, encoding: "utf8" }).trim();
  const slug = /github\.com[/:]([^/]+\/[^/.]+)(?:\.git)?$/.exec(remote)?.[1];
  if (!slug) throw new Error(`${id} origin is not a GitHub repository.`);
  const response = JSON.parse(execFileSync("gh", ["api", `repos/${slug}/commits/${revision}/check-runs?per_page=100`], { cwd: root, encoding: "utf8" }));
  const runs = Array.isArray(response.check_runs) ? response.check_runs : [];
  for (const name of requiredNames) {
    if (!runs.some(run => run.name === name && run.status === "completed" && run.conclusion === "success")) {
      throw new Error(`${id} protected check ${name} is not successful at ${revision}.`);
    }
  }
  return [...requiredNames];
}

function assertPortsUnclaimed(deps) {
  for (const port of [APEX_PORT, STORAGE_PORT]) {
    const pids = deps.readListenerPids(port);
    if (pids.length) throw new Error(`Port ${port} is owned by unmanaged PID ${pids.join(", ")}; refusing takeover.`);
  }
}

async function probeRuntime(deps) {
  return {
    apex: await deps.readHttpStatus(`http://${LOCAL_RUNTIME_HOST}:${APEX_PORT}/`),
    storage: await deps.readHttpStatus(`http://${LOCAL_RUNTIME_HOST}:${STORAGE_PORT}${STORAGE_EXPORT_PATH}`),
    storageProxy: await deps.readHttpStatus(`http://${LOCAL_RUNTIME_HOST}:${APEX_PORT}${STORAGE_EXPORT_PATH}`),
  };
}

function runtimeLocations(workspaceRoot) {
  const runtimeRoot = path.join(workspaceRoot, ".runtime-state", "agentic-canvas-os", "knowgrph-local-runtime");
  return {
    runtimeRoot,
    statePath: path.join(runtimeRoot, "readiness.json"),
    tokenPath: path.join(runtimeRoot, "owner.token"),
    lockPath: path.join(runtimeRoot, "supervisor.lock"),
    apexLogPath: path.join(runtimeRoot, "apex.log"),
    storageLogPath: path.join(runtimeRoot, "storage.log"),
  };
}

function readyProjection(state) {
  return { ...projectState(state), status: "runtime-ready", ready: true };
}

function projectState(state) {
  return {
    schema: state.schema,
    status: state.status,
    ready: state.status === "runtime-ready",
    application: state.application,
    surface: state.surface,
    source: state.source,
    agenticCanvasOs: state.agenticCanvasOs,
    catalogRevision: state.catalogRevision,
    host: state.host,
    ports: state.ports,
    services: state.services,
    probes: state.probes,
    protectedChecks: state.protectedChecks,
    ownershipTokenDigest: state.ownershipTokenDigest,
    startedAt: state.startedAt,
    verifiedAt: state.verifiedAt,
  };
}

function stoppedProjection(candidate) {
  return {
    schema: LOCAL_RUNTIME_SCHEMA,
    status: "stopped",
    ready: false,
    application: "knowgrph",
    surface: "apex",
    source: { repository: "huijoohwee/knowgrph", revision: candidate.knowgrph.headSha },
    agenticCanvasOs: { repository: "huijoohwee/agentic-canvas-os", revision: candidate.agenticCanvasOs.headSha },
    catalogRevision: candidate.agenticCanvasOs.headSha,
    host: LOCAL_RUNTIME_HOST,
    ports: { apex: APEX_PORT, storage: STORAGE_PORT },
  };
}

function normalizeOptions(options) {
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000) throw new Error("--timeout-ms must be from 1000 to 300000.");
  return {
    repository: String(options.repository || "").trim() ? path.resolve(options.repository) : "",
    agenticCanvasOsRoot: path.resolve(options.agenticCanvasOsRoot || process.cwd()),
    timeoutMs,
  };
}

function resolveGitCommonDir(repository, deps) {
  return path.resolve(repository, deps.gitText(repository, ["rev-parse", "--git-common-dir"]).trim());
}

function readJson(filePath) {
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJsonAtomic(filePath, value, deps) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  deps.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  deps.renameFile(temporaryPath, filePath);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function createDependencies(overrides) {
  return {
    gitText: (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8" }),
    verifyProtectedChecks,
    mkdir: directory => mkdirSync(directory, { recursive: true }),
    openLog: logPath => openSync(logPath, "a"),
    closeLog: closeSync,
    writeFile: (filePath, text) => writeFileSync(filePath, text, "utf8"),
    renameFile: renameSync,
    writePrivateFile: (filePath, text) => { writeFileSync(filePath, text, { encoding: "utf8", mode: 0o600 }); chmodSync(filePath, 0o600); },
    readPrivateFile: filePath => readFileSync(filePath, "utf8"),
    removeFile: filePath => { if (existsSync(filePath)) rmSync(filePath); },
    spawnService: ({ cwd, env, command, args, logFd }) => spawn(command, args, { cwd, env, detached: true, stdio: ["ignore", logFd, logFd] }),
    readListenerPid,
    readListenerPids,
    inspectListenerProcess,
    readHttpStatus,
    waitForHttp,
    waitForPortRelease,
    stopProcessGroup: pid => { try { process.kill(-pid, "SIGTERM"); } catch (error) { if (error?.code !== "ESRCH") throw error; } },
    acquireLock,
    runLifecycle: root => JSON.parse(execFileSync("node", ["./scripts/worktree-lifecycle.mjs", "check", `--repository=${root}`], { cwd: root, encoding: "utf8" })),
    now: () => new Date(),
    ...overrides,
  };
}

function readListenerPid(port) {
  const pids = readListenerPids(port);
  if (pids.length > 1) throw new Error(`Port ${port} has multiple listener PIDs: ${pids.join(", ")}.`);
  return pids[0] || null;
}

function readListenerPids(port) {
  try {
    const output = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" }).trim();
    return [...new Set(output.split(/\s+/).filter(Boolean).map(Number).filter(Number.isInteger))];
  } catch (error) {
    if (error?.status === 1) return [];
    throw error;
  }
}

function inspectListenerProcess(pid) {
  const cwdOutput = execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { encoding: "utf8" });
  const cwd = cwdOutput.split("\n").find(line => line.startsWith("n"))?.slice(1).trim() || "";
  if (!cwd) throw new Error(`Unable to resolve listener PID ${pid} working directory.`);
  return {
    pid,
    cwd,
    processGroupId: Number(execFileSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8" }).trim()),
    processStartedAt: execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" }).trim(),
    command: execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" }).trim(),
    listenerEnvironment: execFileSync("ps", ["eww", "-p", String(pid), "-o", "command="], { encoding: "utf8" }),
    gitCommonDir: path.resolve(cwd, execFileSync("git", ["-C", cwd, "rev-parse", "--git-common-dir"], { encoding: "utf8" }).trim()),
  };
}

export function acquireLock(lockPath) {
  mkdirSync(path.dirname(lockPath), { recursive: true });
  let descriptor;
  try {
    descriptor = openSync(lockPath, "wx");
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const owner = readJson(lockPath);
    try {
      process.kill(Number(owner?.pid), 0);
      throw new Error(`Local runtime supervisor lock is held by active PID ${owner?.pid}.`);
    } catch (ownerError) {
      if (ownerError?.code !== "ESRCH") throw ownerError;
      unlinkSync(lockPath);
      descriptor = openSync(lockPath, "wx");
    }
  }
  writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`, "utf8");
  closeSync(descriptor);
  return () => { if (existsSync(lockPath)) unlinkSync(lockPath); };
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await readHttpStatus(url);
    if (status === 200) return status;
    await delay(250);
  }
  throw new Error(`Local runtime did not become ready within ${timeoutMs} ms at ${url}.`);
}

async function readHttpStatus(url) {
  try {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(2_000) });
    return response.status;
  } catch {
    return null;
  }
}

async function waitForPortRelease(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!readListenerPid(port)) return;
    await delay(100);
  }
  throw new Error(`Local runtime port ${port} did not stop within ${timeoutMs} ms.`);
}
