import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  inspectOwnershipCandidate,
  resolveCanonicalCandidate,
  resolveOwnershipCandidate,
  sha256,
} from "./local-runtime-candidate-lib.mjs";
import { stopOwnedSessionRuntimeLocked } from "./local-runtime-session-lib.mjs";
import {
  APEX_PORT,
  assertPortsUnclaimed,
  createDependencies,
  launchService,
  LOCAL_RUNTIME_HOST,
  LOCAL_RUNTIME_SCHEMA,
  normalizeOptions,
  readJson,
  runtimeLocations,
  STORAGE_PORT,
  stopRecordedServices,
  validateOwnedService,
  writeJsonAtomic,
} from "./local-runtime-supervisor-lib.mjs";
import { createLocalReviewCandidate } from "./production-release-authorization-contract.mjs";

const STORAGE_EXPORT_PATH = "/api/storage/export/kgws%3Acanonical-docs";
const STORAGE_LOCAL_RUNTIME_WRANGLER_VAR = "AGENTICGRAPH_STORAGE_LOCAL_RUNTIME:true";

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
    return { ...runtime, action: "turn-end", handoff, reviewCandidate };
  } finally {
    releaseLock();
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

async function probeRuntime(deps) {
  return {
    apex: await deps.readHttpStatus(`http://${LOCAL_RUNTIME_HOST}:${APEX_PORT}/`),
    storage: await deps.readHttpStatus(`http://${LOCAL_RUNTIME_HOST}:${STORAGE_PORT}${STORAGE_EXPORT_PATH}`),
    storageProxy: await deps.readHttpStatus(`http://${LOCAL_RUNTIME_HOST}:${APEX_PORT}${STORAGE_EXPORT_PATH}`),
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
