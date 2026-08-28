import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
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

import { parseWorktreeRecords } from "./repository-guards.mjs";
import { createLocalReviewCandidate } from "./production-release-authorization-contract.mjs";

export const LOCAL_RUNTIME_SCHEMA = "agentic-local-runtime-readiness/v1";
export const SESSION_RUNTIME_SCHEMA = "agentic-session-runtime/v1";
export const LOCAL_RUNTIME_HOST = "127.0.0.1";
export const APEX_PORT = 5173;
export const STORAGE_PORT = 8787;
export const DEFAULT_TIMEOUT_MS = 120_000;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const STORAGE_EXPORT_PATH = "/api/storage/export/kgws%3Acanonical-docs";
const STORAGE_LOCAL_RUNTIME_WRANGLER_VAR = "AGENTICGRAPH_STORAGE_LOCAL_RUNTIME:true";
const REQUIRED_CHECKS = Object.freeze({
  "agentic-canvas-os": ["test", "build", "docs-contract", "collaboration-integration", "cloud-collaboration"],
  knowgrph: ["Integration Gate"],
});
const BLOCKING_CONFIG_FILES = Object.freeze([
  /^\.env(?:\..+)?$/u,
  /^package(?:-lock)?\.json$/u,
  /^pnpm-lock\.ya?ml$/u,
  /^bun\.lockb?$/u,
  /^tsconfig(?:\..+)?\.json$/u,
  /^vite\.config\.[^.]+$/u,
  /^vitest\.config\.[^.]+$/u,
  /^playwright\.config\.[^.]+$/u,
  /^wrangler(?:\.[^.]+)?\.(?:jsonc?|toml)$/u,
  /^\.npmrc$/u,
  /^\.nvmrc$/u,
]);
const BLOCKING_AUTHORITY_ROOTS = Object.freeze({
  "agentic-canvas-os": Object.freeze([
    "agent-api",
    "scripts",
    ".github/workflows",
  ]),
  knowgrph: Object.freeze([
    "app",
    "src",
    "api",
    "canvas",
    "components",
    "functions",
    "public",
    "scripts",
    "server",
    "storage",
    "workers",
  ]),
});

export async function ensureLocalRuntime(options = {}, dependencies = {}) {
  const deps = createDependencies(dependencies);
  const normalized = normalizeOptions(options);
  const candidate = resolveCanonicalCandidate(normalized, deps, { verifyProtected: true });
  const locations = runtimeLocations(candidate.workspaceRoot);
  const releaseLock = deps.acquireLock(locations.lockPath);
  try {
    return await ensureLocalRuntimeLocked(candidate, normalized, locations, deps);
  } finally {
    releaseLock();
  }
}

export async function readLocalRuntimeStatus(options = {}, dependencies = {}) {
  const deps = createDependencies(dependencies);
  const normalized = normalizeOptions(options);
  const candidate = resolveCanonicalCandidate(normalized, deps, { verifyProtected: true });
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
  const preflight = resolveCanonicalCandidate(normalized, deps, { verifyProtected: false });
  const lifecycle = deps.runLifecycle(preflight.agenticCanvasOsRoot);
  const candidate = resolveCanonicalCandidate(normalized, deps, { verifyProtected: true });
  const locations = runtimeLocations(candidate.workspaceRoot);
  const releaseLock = deps.acquireLock(locations.lockPath);
  try {
    const handoff = await stopOwnedSessionRuntimeLocked(candidate, normalized, locations, deps);
    const runtime = await ensureLocalRuntimeLocked(candidate, normalized, locations, deps);
    const reviewCandidate = createLocalReviewCandidate(runtime, {
      source: {
        repository: runtime.source.repository,
        revision: candidate.knowgrph.headSha,
        tree: candidate.knowgrph.treeSha,
      },
      agenticCanvasOs: {
        repository: runtime.agenticCanvasOs.repository,
        revision: candidate.agenticCanvasOs.headSha,
        tree: candidate.agenticCanvasOs.treeSha,
      },
    });
    writeJsonAtomic(locations.reviewCandidatePath, reviewCandidate, deps);
    return { ...runtime, action: "turn-end", lifecycle, handoff, reviewCandidate };
  } finally {
    releaseLock();
  }
}

export async function startSessionRuntime(options = {}, dependencies = {}) {
  const deps = createDependencies(dependencies);
  const normalized = normalizeOptions(options, { requireSession: true });
  const candidate = resolveCanonicalCandidate(normalized, deps, { verifyProtected: false });
  const locations = runtimeLocations(candidate.workspaceRoot);
  const releaseLock = deps.acquireLock(locations.lockPath);
  try {
    const existingSession = readJson(locations.sessionStatePath);
    if (existingSession) {
      return inspectSessionRuntimeState(existingSession, candidate, normalized, locations, deps);
    }
    const canonicalState = readJson(locations.statePath);
    if (canonicalState) {
      await stopRecordedServices(canonicalState, candidate, locations, deps);
      deps.removeFile(locations.statePath);
      deps.removeFile(locations.tokenPath);
    }
    assertPortsUnclaimed(deps);
    return await launchSessionRuntime(candidate, normalized, locations, deps);
  } finally {
    releaseLock();
  }
}

export async function readSessionRuntimeStatus(options = {}, dependencies = {}) {
  const deps = createDependencies(dependencies);
  const normalized = normalizeOptions(options, { requireSession: true });
  const candidate = resolveCanonicalCandidate(normalized, deps, { verifyProtected: false });
  const locations = runtimeLocations(candidate.workspaceRoot);
  const state = readJson(locations.sessionStatePath);
  return state
    ? inspectSessionRuntimeState(state, candidate, normalized, locations, deps)
    : stoppedSessionProjection(candidate, normalized.sessionId);
}

export async function stopSessionRuntime(options = {}, dependencies = {}) {
  const deps = createDependencies(dependencies);
  const normalized = normalizeOptions(options, { requireSession: true });
  const candidate = resolveOwnershipCandidate(normalized, deps);
  const locations = runtimeLocations(candidate.workspaceRoot);
  const releaseLock = deps.acquireLock(locations.lockPath);
  try {
    const state = readJson(locations.sessionStatePath);
    if (!state) return stoppedSessionProjection(candidate, normalized.sessionId);
    const stopped = await stopSessionRuntimeState(state, candidate, normalized, locations, deps);
    deps.removeFile(locations.sessionStatePath);
    deps.removeFile(locations.sessionTokenPath);
    return { ...stopped, status: "session-stopped" };
  } finally {
    releaseLock();
  }
}

export function validateCanonicalRuntimeCandidate(evidence) {
  for (const repository of [evidence.agenticCanvasOs, evidence.knowgrph]) {
    if (repository.branch !== "main") throw new Error(`${repository.id} canonical runtime checkout must be on main.`);
    const residue = normalizeCanonicalRuntimeResidue(repository);
    if (!residue.runtimeSafe) {
      throw new Error(
        `${repository.id} canonical runtime checkout has runtime-blocking residue: ${summarizeCanonicalRuntimeResidue(residue.blocking)}.`,
      );
    }
    if (!SHA_PATTERN.test(String(repository.headSha || ""))) throw new Error(`${repository.id} requires an exact 40-character SHA.`);
    if (repository === evidence.knowgrph && repository.headSha !== repository.remoteSha) {
      throw new Error(`${repository.id} canonical HEAD must equal fetched origin/main.`);
    }
    if (!repository.protectedChecksVerified) throw new Error(`${repository.id} protected checks are not verified for ${repository.headSha}.`);
  }
  const revisionBinding = resolveAgenticCanvasOsRevisionBinding(evidence.agenticCanvasOs);
  if (!evidence.knowgrph.hasDevApexScript || !evidence.knowgrph.hasStorageWorkerScript) {
    throw new Error("Knowgrph must expose repository-owned dev:apex and storage:worker:dev scripts.");
  }
  return { ...evidence, agenticCanvasOs: { ...evidence.agenticCanvasOs, revisionBinding } };
}

function resolveAgenticCanvasOsRevisionBinding(repository) {
  if (repository.headSha === repository.remoteSha) return "fetched-tip";
  const pin = String(repository.consumerPinnedRef || "");
  if (SHA_PATTERN.test(pin) &&
      repository.headSha === pin &&
      repository.consumerPinnedRefIsAncestorOfRemote === true) {
    return "consumer-pin";
  }
  throw new Error(
    `${repository.id} canonical HEAD must equal fetched origin/main or the consumer-pinned docs_dependency ref that is an ancestor of origin/main.`,
  );
}

export function parseConsumerPinnedDocsRef(markdown) {
  const text = String(markdown ?? "");
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return null;
  let inDocsDependency = false;
  for (const line of text.slice(0, end).split("\n")) {
    if (/^docs_dependency:\s*$/u.test(line)) {
      inDocsDependency = true;
      continue;
    }
    if (!inDocsDependency) continue;
    if (!/^\s/u.test(line)) {
      inDocsDependency = false;
      continue;
    }
    const match = /^ {2}ref:\s*"?([0-9a-f]{40})"?\s*$/u.exec(line);
    if (match) return match[1];
  }
  return null;
}

function readConsumerPinnedDocsRef(knowgrphRoot) {
  try {
    return parseConsumerPinnedDocsRef(
      readFileSync(path.join(knowgrphRoot, "docs", "runtime-readiness-contract.md"), "utf8"),
    );
  } catch {
    return null;
  }
}

function isAncestorCommit(root, ancestorSha, descendantSha, deps) {
  try {
    deps.gitText(root, ["merge-base", "--is-ancestor", ancestorSha, descendantSha]);
    return true;
  } catch {
    return false;
  }
}

function withConsumerPinEvidence(repository, knowgrphRoot, deps) {
  const consumerPinnedRef = readConsumerPinnedDocsRef(knowgrphRoot);
  return {
    ...repository,
    consumerPinnedRef,
    consumerPinnedRefIsAncestorOfRemote: consumerPinnedRef !== null &&
      isAncestorCommit(repository.root, consumerPinnedRef, repository.remoteSha, deps),
  };
}

export function validateOwnedService({ service, processEvidence, token, tokenDigest, candidate }) {
  if (!service || !Number.isInteger(service.supervisorPid) || service.supervisorPid <= 0) {
    throw new Error("Runtime service state has no valid supervisor PID.");
  }
  if (!processEvidence || !Number.isInteger(processEvidence.pid) || processEvidence.pid <= 0) {
    throw new Error(`${service.name} listener process is unavailable.`);
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

export function validateOwnedSessionService({ state, processEvidence, token, candidate, sessionId }) {
  const service = state?.service;
  validateSessionStateIdentity({ state, token, sessionId });
  if (!service || !Number.isInteger(service.supervisorPid) || service.supervisorPid <= 0) {
    throw new Error("Session runtime state has no valid supervisor PID.");
  }
  if (!processEvidence || processEvidence.pid !== service.listenerPid) {
    throw new Error("Session Vite listener PID no longer matches recorded ownership.");
  }
  if (processEvidence.processGroupId !== service.supervisorPid) {
    throw new Error("Session Vite listener no longer belongs to its recorded process group.");
  }
  if (processEvidence.processStartedAt !== service.processStartedAt) {
    throw new Error("Session Vite process start identity changed.");
  }
  if (!service.listenerCwd || path.resolve(processEvidence.cwd || "") !== path.resolve(service.listenerCwd)) {
    throw new Error("Session Vite working directory changed.");
  }
  if (path.resolve(processEvidence.gitCommonDir || "") !== path.resolve(candidate.knowgrph.gitCommonDir)) {
    throw new Error("Session Vite listener belongs to an unrelated repository.");
  }
  if (!String(processEvidence.command || "").includes(service.commandMarker)) {
    throw new Error("Session Vite listener command does not match its runtime owner.");
  }
  if (!String(processEvidence.listenerEnvironment || "").includes(`AGENTIC_SESSION_RUNTIME_TOKEN=${token}`)) {
    throw new Error("Session Vite ownership token is missing or changed.");
  }
  if (!String(processEvidence.listenerEnvironment || "").includes(`AGENTIC_SESSION_ID=${sessionId}`)) {
    throw new Error("Session Vite process session identity is missing or changed.");
  }
  if (!String(processEvidence.listenerEnvironment || "").includes(`AGENTICGRAPH_SOURCE_REVISION=${state.source?.revision}`)) {
    throw new Error("Session Vite source revision evidence is missing or changed.");
  }
  if (!String(processEvidence.listenerEnvironment || "").includes(
    `AGENTICGRAPH_AGENTIC_CANVAS_OS_DOCS_REVISION=${state.agenticCanvasOs?.revision}`,
  )) {
    throw new Error("Session Vite Agentic Canvas OS revision evidence is missing or changed.");
  }
  return true;
}

function validateSessionStateIdentity({ state, token, sessionId }) {
  if (state?.schema !== SESSION_RUNTIME_SCHEMA || state.status !== "session-dev") {
    throw new Error("Session runtime state has an unsupported schema or status.");
  }
  if (!sessionId || state.sessionId !== sessionId) {
    throw new Error("Session runtime belongs to another session.");
  }
  if (!SHA_PATTERN.test(String(state.source?.revision || "")) ||
      !SHA_PATTERN.test(String(state.agenticCanvasOs?.revision || ""))) {
    throw new Error("Session runtime state lacks exact source revisions.");
  }
  if (sha256(token) !== state.ownershipTokenDigest) {
    throw new Error("Session Vite ownership token digest does not match local state.");
  }
}

async function ensureLocalRuntimeLocked(candidate, options, locations, deps) {
  const currentState = readJson(locations.statePath);
  if (currentState) {
    const currentStatus = await inspectRuntimeState(currentState, candidate, locations, deps);
    if (currentStatus.ready) return currentStatus;
    await stopRecordedServices(currentState, candidate, locations, deps);
    deps.removeFile(locations.statePath);
    deps.removeFile(locations.tokenPath);
  }
  assertPortsUnclaimed(deps);
  return startRuntime(candidate, options, locations, deps);
}

async function launchSessionRuntime(candidate, options, locations, deps) {
  deps.mkdir(locations.runtimeRoot);
  const token = randomUUID();
  deps.writePrivateFile(locations.sessionTokenPath, `${token}\n`);
  const environment = {
    ...process.env,
    AGENTIC_SESSION_ID: options.sessionId,
    AGENTIC_SESSION_RUNTIME_TOKEN: token,
    AGENTICGRAPH_SOURCE_REVISION: candidate.knowgrph.headSha,
    AGENTICGRAPH_AGENTIC_CANVAS_OS_DOCS_ROOT: path.join(candidate.agenticCanvasOsRoot, "docs"),
    AGENTICGRAPH_AGENTIC_CANVAS_OS_DOCS_REVISION: candidate.agenticCanvasOs.headSha,
    VITE_WORKSPACE_INITIALIZATION_AGENTIC_CANVAS_OS_DOCS_ABS_ROOT: path.join(candidate.agenticCanvasOsRoot, "docs"),
  };
  try {
    const service = await launchService({
      name: "session-apex",
      port: APEX_PORT,
      commandMarker: "node_modules/.bin/vite",
      command: ["npm", ["run", "dev:apex", "--", "--host", LOCAL_RUNTIME_HOST, "--port", String(APEX_PORT), "--strictPort"]],
      healthUrl: `http://${LOCAL_RUNTIME_HOST}:${APEX_PORT}/`,
      logPath: locations.sessionApexLogPath,
    }, candidate, environment, options.timeoutMs, deps);
    const state = {
      schema: SESSION_RUNTIME_SCHEMA,
      status: "session-dev",
      ready: false,
      sessionId: options.sessionId,
      source: { repository: "huijoohwee/knowgrph", revision: candidate.knowgrph.headSha },
      agenticCanvasOs: { repository: "huijoohwee/agentic-canvas-os", revision: candidate.agenticCanvasOs.headSha },
      host: LOCAL_RUNTIME_HOST,
      ports: { apex: APEX_PORT },
      service,
      ownershipTokenDigest: sha256(token),
      startedAt: deps.now().toISOString(),
      verifiedAt: deps.now().toISOString(),
    };
    writeJsonAtomic(locations.sessionStatePath, state, deps);
    return projectSessionState(state);
  } catch (error) {
    deps.removeFile(locations.sessionTokenPath);
    throw error;
  }
}

async function inspectSessionRuntimeState(state, candidate, options, locations, deps) {
  const token = deps.readPrivateFile(locations.sessionTokenPath).trim();
  const listenerPid = deps.readListenerPid(APEX_PORT);
  const processEvidence = listenerPid ? deps.inspectListenerProcess(listenerPid) : null;
  validateOwnedSessionService({ state, processEvidence, token, candidate, sessionId: options.sessionId });
  if (state.source.revision !== candidate.knowgrph.headSha ||
      state.agenticCanvasOs.revision !== candidate.agenticCanvasOs.headSha) {
    throw new Error("Session Vite revisions no longer match canonical main.");
  }
  const httpStatus = await deps.readHttpStatus(`http://${LOCAL_RUNTIME_HOST}:${APEX_PORT}/`);
  if (httpStatus !== 200) throw new Error("Session Vite HTTP readiness is unavailable.");
  return projectSessionState({ ...state, verifiedAt: deps.now().toISOString() });
}

async function stopSessionRuntimeState(state, candidate, options, locations, deps) {
  const token = deps.readPrivateFile(locations.sessionTokenPath).trim();
  validateSessionStateIdentity({ state, token, sessionId: options.sessionId });
  const listenerPid = deps.readListenerPid(APEX_PORT);
  if (listenerPid) {
    const processEvidence = deps.inspectListenerProcess(listenerPid);
    validateOwnedSessionService({ state, processEvidence, token, candidate, sessionId: options.sessionId });
    deps.stopProcessGroup(state.service.supervisorPid);
    await deps.waitForPortRelease(APEX_PORT, 10_000);
  }
  return projectSessionState(state);
}

async function stopOwnedSessionRuntimeLocked(candidate, options, locations, deps) {
  const state = readJson(locations.sessionStatePath);
  if (!state) return { status: "not-required", stoppedSessionRuntime: false };
  if (!options.sessionId) {
    throw new Error("A matching --session or AGENTIC_SESSION_ID is required to hand off the session Vite runtime.");
  }
  await stopSessionRuntimeState(state, candidate, options, locations, deps);
  deps.removeFile(locations.sessionStatePath);
  deps.removeFile(locations.sessionTokenPath);
  return {
    status: "session-runtime-stopped",
    stoppedSessionRuntime: true,
    sessionId: options.sessionId,
    sourceRevision: state.source.revision,
  };
}

async function startRuntime(candidate, options, locations, deps) {
  deps.mkdir(locations.runtimeRoot);
  const token = randomUUID();
  deps.writePrivateFile(locations.tokenPath, `${token}\n`);
  const tokenDigest = sha256(token);
  const environment = {
    ...process.env,
    AGENTIC_LOCAL_RUNTIME_TOKEN: token,
    AGENTICGRAPH_SOURCE_REVISION: candidate.knowgrph.headSha,
    AGENTICGRAPH_AGENTIC_CANVAS_OS_DOCS_ROOT: path.join(candidate.agenticCanvasOsRoot, "docs"),
    AGENTICGRAPH_AGENTIC_CANVAS_OS_DOCS_REVISION: candidate.agenticCanvasOs.headSha,
    VITE_WORKSPACE_INITIALIZATION_AGENTIC_CANVAS_OS_DOCS_ABS_ROOT: path.join(candidate.agenticCanvasOsRoot, "docs"),
  };
  const started = [];
  try {
    const storage = await launchService({
      name: "storage",
      port: STORAGE_PORT,
      commandMarker: "workerd",
      command: ["npm", [
        "run", "storage:worker:dev", "--", "--local", "--var",
        STORAGE_LOCAL_RUNTIME_WRANGLER_VAR, "--ip", LOCAL_RUNTIME_HOST,
        "--port", String(STORAGE_PORT),
      ]],
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
      agenticCanvasOs: {
        repository: "huijoohwee/agentic-canvas-os",
        revision: candidate.agenticCanvasOs.headSha,
        revisionBinding: candidate.agenticCanvasOs.revisionBinding ?? "fetched-tip",
      },
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
    const processEvidence = deps.inspectListenerProcess(listenerPid);
    return {
      name: spec.name,
      port: spec.port,
      supervisorPid: child.pid,
      listenerPid,
      commandMarker: spec.commandMarker,
      logPath: spec.logPath,
      healthUrl: spec.healthUrl,
      httpStatus,
      processStartedAt: processEvidence.processStartedAt,
      listenerCwd: processEvidence.cwd,
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
  const { workspaceRoot, agenticCanvasOsRoot, knowgrphRoot } = resolveCanonicalRuntimeRoots(options, deps);
  const repositories = [
    inspectRepository("agentic-canvas-os", agenticCanvasOsRoot, deps, verifyProtected),
    inspectRepository("knowgrph", knowgrphRoot, deps, verifyProtected),
  ];
  const packageJson = JSON.parse(readFileSync(path.join(knowgrphRoot, "package.json"), "utf8"));
  const protectedChecks = Object.fromEntries(repositories.map(repository => [repository.id, repository.checks]));
  const evidence = validateCanonicalRuntimeCandidate({
    agenticCanvasOs: withConsumerPinEvidence(repositories[0], knowgrphRoot, deps),
    knowgrph: {
      ...repositories[1],
      hasDevApexScript: typeof packageJson.scripts?.["dev:apex"] === "string",
      hasStorageWorkerScript: typeof packageJson.scripts?.["storage:worker:dev"] === "string",
    },
  });
  return { workspaceRoot, agenticCanvasOsRoot, knowgrph: { ...evidence.knowgrph, root: knowgrphRoot }, agenticCanvasOs: evidence.agenticCanvasOs, protectedChecks };
}

function resolveCanonicalCandidate(options, deps, settings) {
  return typeof deps.inspectCanonicalCandidate === "function"
    ? deps.inspectCanonicalCandidate(options, settings)
    : inspectCanonicalCandidate(options, deps, settings);
}

function resolveOwnershipCandidate(options, deps) {
  return typeof deps.inspectOwnershipCandidate === "function"
    ? deps.inspectOwnershipCandidate(options)
    : inspectOwnershipCandidate(options, deps);
}

function inspectOwnershipCandidate(options, deps) {
  const { workspaceRoot, agenticCanvasOsRoot, knowgrphRoot } = resolveCanonicalRuntimeRoots(options, deps);
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

function resolveCanonicalRuntimeRoots(options, deps) {
  const invokingRoot = realpathSync(options.agenticCanvasOsRoot);
  const workspaceRoot = resolveWorkspaceRootFromGitCommonDir(resolveGitCommonDir(invokingRoot, deps));
  const agenticCanvasOsRoot = realpathSync(resolveCanonicalMainWorktree(
    deps.gitText(invokingRoot, ["worktree", "list", "--porcelain", "-z"]),
  ));
  const requestedKnowgrphRoot = realpathSync(options.repository || path.join(workspaceRoot, "knowgrph"));
  const knowgrphRoot = realpathSync(resolveCanonicalMainWorktree(
    deps.gitText(requestedKnowgrphRoot, ["worktree", "list", "--porcelain", "-z"]),
  ));
  return { workspaceRoot, agenticCanvasOsRoot, knowgrphRoot };
}

function inspectRepository(id, root, deps, verifyProtected) {
  deps.gitText(root, ["fetch", "--quiet", "--prune", "origin", "main"]);
  const headSha = deps.gitText(root, ["rev-parse", "HEAD"]).trim();
  const remoteSha = deps.gitText(root, ["rev-parse", "origin/main"]).trim();
  const treeSha = deps.gitText(root, ["rev-parse", "HEAD^{tree}"]).trim();
  const statusPorcelain = deps.gitText(root, ["status", "--porcelain", "--untracked-files=all"]).trimEnd();
  const residue = classifyCanonicalRuntimeResidue({ repositoryId: id, statusPorcelain });
  const checks = verifyProtected ? deps.verifyProtectedChecks(id, root, headSha, REQUIRED_CHECKS[id]) : ["cached-status-check"];
  return {
    id,
    root,
    gitCommonDir: resolveGitCommonDir(root, deps),
    branch: deps.gitText(root, ["branch", "--show-current"]).trim(),
    clean: residue.clean,
    headSha,
    remoteSha,
    treeSha,
    residue,
    protectedChecksVerified: checks.length > 0,
    checks,
  };
}

export function classifyCanonicalRuntimeResidue({
  repositoryId,
  statusPorcelain = "",
} = {}) {
  const entries = parseGitStatusPorcelain(statusPorcelain);
  const blocking = [];
  const foreign = [];
  for (const entry of entries) {
    const classified = classifyCanonicalRuntimeResidueEntry(repositoryId, entry);
    if (classified.blocking) {
      blocking.push(classified);
    } else {
      foreign.push(classified);
    }
  }
  return Object.freeze({
    clean: entries.length === 0,
    runtimeSafe: blocking.length === 0,
    blocking,
    foreign,
    blockingDigest: blocking.length ? sha256(JSON.stringify(blocking)) : null,
    foreignDigest: foreign.length ? sha256(JSON.stringify(foreign)) : null,
  });
}

function normalizeCanonicalRuntimeResidue(repository) {
  if (repository?.residue) return repository.residue;
  if (repository?.clean === true) {
    return {
      clean: true,
      runtimeSafe: true,
      blocking: [],
      foreign: [],
      blockingDigest: null,
      foreignDigest: null,
    };
  }
  return {
    clean: Boolean(repository?.clean),
    runtimeSafe: Boolean(repository?.clean),
    blocking: repository?.clean ? [] : [{ path: "*", reason: "legacy-uncategorized-residue" }],
    foreign: [],
    blockingDigest: null,
    foreignDigest: null,
  };
}

function classifyCanonicalRuntimeResidueEntry(repositoryId, entry) {
  const pathName = entry.toPath || entry.path;
  if (entry.code !== "??") {
    return Object.freeze({
      ...entry,
      path: pathName,
      blocking: true,
      reason: "tracked-residue",
    });
  }
  if (matchesBlockingRuntimeAuthority(repositoryId, pathName)) {
    return Object.freeze({
      ...entry,
      path: pathName,
      blocking: true,
      reason: "untracked-runtime-authority",
    });
  }
  return Object.freeze({
    ...entry,
    path: pathName,
    blocking: false,
    reason: "foreign-parallel-residue",
  });
}

function parseGitStatusPorcelain(statusPorcelain) {
  return String(statusPorcelain || "")
    .split(/\r?\n/u)
    .map(line => line.trimEnd())
    .filter(Boolean)
    .map(line => {
      const code = line.slice(0, 2);
      const payload = line.slice(3);
      const [fromPath, toPath] = payload.split(" -> ");
      return Object.freeze({
        code,
        path: fromPath,
        ...(toPath ? { toPath } : {}),
      });
    });
}

function matchesBlockingRuntimeAuthority(repositoryId, pathName) {
  const normalizedPath = String(pathName || "").replace(/\\/gu, "/");
  const baseName = normalizedPath.split("/").at(-1) || normalizedPath;
  if (BLOCKING_CONFIG_FILES.some(pattern => pattern.test(baseName))) return true;
  return (BLOCKING_AUTHORITY_ROOTS[repositoryId] || []).some(root => (
    normalizedPath === root || normalizedPath.startsWith(`${root}/`)
  ));
}

function summarizeCanonicalRuntimeResidue(entries) {
  if (!entries.length) return "unknown residue";
  const preview = entries
    .slice(0, 3)
    .map(entry => `${entry.path} (${entry.reason})`)
    .join(", ");
  return entries.length > 3 ? `${preview}, +${entries.length - 3} more` : preview;
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
    assertPortUnclaimed(port, deps);
  }
}

function assertPortUnclaimed(port, deps) {
  const pids = deps.readListenerPids(port);
  if (pids.length) throw new Error(`Port ${port} is owned by unmanaged PID ${pids.join(", ")}; refusing takeover.`);
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
    reviewCandidatePath: path.join(runtimeRoot, "review-candidate.json"),
    tokenPath: path.join(runtimeRoot, "owner.token"),
    lockPath: path.join(runtimeRoot, "supervisor.lock"),
    apexLogPath: path.join(runtimeRoot, "apex.log"),
    storageLogPath: path.join(runtimeRoot, "storage.log"),
    sessionStatePath: path.join(runtimeRoot, "session-runtime.json"),
    sessionTokenPath: path.join(runtimeRoot, "session-owner.token"),
    sessionApexLogPath: path.join(runtimeRoot, "session-apex.log"),
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

function projectSessionState(state) {
  return {
    schema: state.schema,
    status: state.status,
    ready: false,
    sessionId: state.sessionId,
    source: state.source,
    agenticCanvasOs: state.agenticCanvasOs,
    host: state.host,
    ports: state.ports,
    service: state.service,
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

function stoppedSessionProjection(candidate, sessionId) {
  return {
    schema: SESSION_RUNTIME_SCHEMA,
    status: "session-stopped",
    ready: false,
    sessionId,
    source: { repository: "huijoohwee/knowgrph", revision: candidate.knowgrph.headSha },
    agenticCanvasOs: { repository: "huijoohwee/agentic-canvas-os", revision: candidate.agenticCanvasOs.headSha },
    host: LOCAL_RUNTIME_HOST,
    ports: { apex: APEX_PORT },
  };
}

function normalizeOptions(options, { requireSession = false } = {}) {
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000) throw new Error("--timeout-ms must be from 1000 to 300000.");
  const sessionId = String(options.sessionId || "").trim();
  if (requireSession && !sessionId) throw new Error("A stable --session or AGENTIC_SESSION_ID is required.");
  if (sessionId && (!/^[A-Za-z0-9._:-]+$/.test(sessionId) || sessionId.length > 200)) {
    throw new Error("Session id must use 1-200 safe identifier characters.");
  }
  return {
    repository: String(options.repository || "").trim() ? path.resolve(options.repository) : "",
    agenticCanvasOsRoot: path.resolve(options.agenticCanvasOsRoot || process.cwd()),
    timeoutMs,
    sessionId,
  };
}

function resolveGitCommonDir(repository, deps) {
  return path.resolve(repository, deps.gitText(repository, ["rev-parse", "--git-common-dir"]).trim());
}

export function resolveCanonicalMainWorktree(porcelain) {
  const matches = parseWorktreeRecords(porcelain)
    .filter(record => record.branch === "refs/heads/main" && !record.bare && !record.prunable && !record.locked);
  if (matches.length !== 1) {
    throw new Error(`Canonical runtime requires exactly one registered main worktree; found ${matches.length}.`);
  }
  return path.resolve(matches[0].path);
}

export function resolveWorkspaceRootFromGitCommonDir(commonDir) {
  const resolved = path.resolve(String(commonDir || ""));
  if (!String(commonDir || "").trim()) throw new Error("Canonical runtime requires the Git common directory.");
  return path.dirname(path.dirname(resolved));
}

export function parseLifecycleCommandResult(result) {
  if (result?.error) throw result.error;
  const status = Number(result?.status);
  if (![0, 1].includes(status)) {
    throw new Error(`Worktree lifecycle command failed with exit ${Number.isFinite(status) ? status : "unknown"}: ${String(result?.stderr || "").trim()}`);
  }
  let report;
  try {
    report = JSON.parse(String(result?.stdout || ""));
  } catch {
    throw new Error("Worktree lifecycle command returned invalid JSON.");
  }
  if (report?.schema !== "agentic-worktree-lifecycle-report/v1" ||
      !["ready", "attention-required"].includes(report.status)) {
    throw new Error("Worktree lifecycle command returned an unsupported report.");
  }
  return report;
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
    runLifecycle: root => parseLifecycleCommandResult(spawnSync(
      process.execPath,
      ["./scripts/worktree-lifecycle.mjs", "check", `--repository=${root}`],
      { cwd: root, encoding: "utf8" },
    )),
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
