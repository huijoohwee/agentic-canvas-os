import { execFileSync, spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { createWriterLeaseStore } from "./writer-lease-lib.mjs";

export const REVIEWED_RUNTIME_SCHEMA = "agentic-reviewed-runtime/v1";
export const DEFAULT_REVIEWED_RUNTIME_HOST = "127.0.0.1";
export const DEFAULT_REVIEWED_RUNTIME_PORT = 5176;
export const DEFAULT_REVIEWED_RUNTIME_TIMEOUT_MS = 90_000;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const CANONICAL_DEV_PORT = 5173;

export async function serveReviewedRuntime(options, dependencies = {}) {
  const deps = createDependencies(dependencies);
  const normalized = normalizeOptions(options);
  const candidate = inspectReviewedRuntimeCandidate(normalized, deps);
  const statePath = runtimeStatePath(candidate.gitCommonDir, normalized.port);
  const existing = readRuntimeState(statePath);
  if (existing) {
    const status = await inspectReviewedRuntimeState(existing, candidate, deps);
    if (status.ready) return status;
    if (status.listenerPid) {
      throw new Error(`Port ${normalized.port} is still owned by reviewed runtime PID ${status.listenerPid}, but its source proof drifted: ${status.reason}`);
    }
  }

  const occupiedPid = deps.readListenerPid(normalized.port);
  if (occupiedPid) {
    throw new Error(`Port ${normalized.port} is already owned by PID ${occupiedPid}; stop it explicitly or choose another review port.`);
  }

  const runtimeDirectory = path.dirname(statePath);
  deps.mkdir(runtimeDirectory);
  const logPath = path.join(runtimeDirectory, `${normalized.port}.log`);
  const logFd = deps.openLog(logPath);
  let child;
  try {
    child = deps.spawnRuntime({
      cwd: candidate.repository,
      env: {
        ...process.env,
        VITE_WORKSPACE_INITIALIZATION_DOCS_ABS_ROOT: path.join(candidate.canonicalRepository, "docs"),
        VITE_WORKSPACE_INITIALIZATION_AGENTIC_CANVAS_OS_DOCS_ABS_ROOT: path.join(candidate.agenticCanvasOsRoot, "docs"),
      },
      host: normalized.host,
      port: normalized.port,
      logFd,
    });
  } finally {
    deps.closeLog(logFd);
  }
  if (!Number.isInteger(child.pid) || child.pid <= 0) throw new Error("Reviewed runtime did not return a valid supervisor PID.");
  child.unref?.();

  const url = `http://${normalized.host}:${normalized.port}/`;
  try {
    const httpStatus = await deps.waitForHttp(url, normalized.timeoutMs);
    const listenerPid = deps.readListenerPid(normalized.port);
    if (!listenerPid) throw new Error(`Reviewed runtime responded at ${url} without an observable listener PID.`);
    const state = {
      schema: REVIEWED_RUNTIME_SCHEMA,
      status: "ready",
      repository: candidate.repository,
      branch: candidate.branch,
      reviewHeadSha: candidate.reviewHeadSha,
      agenticCanvasOsRevision: candidate.agenticCanvasOsRevision,
      pullRequestUrl: candidate.pullRequestUrl,
      host: normalized.host,
      port: normalized.port,
      url,
      supervisorPid: child.pid,
      listenerPid,
      logPath,
      httpStatus,
      startedAt: deps.now().toISOString(),
    };
    writeRuntimeState(statePath, state, deps);
    return projectReadyState(state, candidate);
  } catch (error) {
    deps.stopProcessGroup(child.pid);
    throw error;
  }
}

export async function readReviewedRuntimeStatus(options, dependencies = {}) {
  const deps = createDependencies(dependencies);
  const normalized = normalizeOptions(options);
  const repository = realpathSync(normalized.repository);
  const gitCommonDir = resolveGitCommonDir(repository, deps);
  const state = readRuntimeState(runtimeStatePath(gitCommonDir, normalized.port));
  if (!state) return { schema: REVIEWED_RUNTIME_SCHEMA, status: "stopped", ready: false, repository, port: normalized.port };
  let candidate;
  try {
    candidate = inspectReviewedRuntimeCandidate(normalized, deps);
  } catch (error) {
    const listenerPid = deps.readListenerPid(normalized.port);
    return {
      ...projectState(state),
      status: "drifted",
      ready: false,
      listenerPid,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  return inspectReviewedRuntimeState(state, candidate, deps);
}

export async function stopReviewedRuntime(options, dependencies = {}) {
  const deps = createDependencies(dependencies);
  const normalized = normalizeOptions(options);
  const repository = realpathSync(normalized.repository);
  const gitCommonDir = resolveGitCommonDir(repository, deps);
  const statePath = runtimeStatePath(gitCommonDir, normalized.port);
  const state = readRuntimeState(statePath);
  if (!state) return { schema: REVIEWED_RUNTIME_SCHEMA, status: "stopped", ready: false, repository, port: normalized.port };
  const listenerPid = deps.readListenerPid(normalized.port);
  validateRuntimeStopOwnership(state, listenerPid);
  if (listenerPid) {
    deps.stopProcessGroup(state.supervisorPid);
    await deps.waitForPortRelease(normalized.port, 10_000);
  }
  deps.removeFile(statePath);
  return { ...projectState(state), status: "stopped", ready: false };
}

export function validateReviewedRuntimeCandidate(evidence) {
  if (!evidence.repositoryClean) throw new Error("Reviewed runtime requires a clean task worktree.");
  if (!evidence.branch?.startsWith("agent/")) throw new Error("Reviewed runtime requires an agent task branch.");
  if (!SHA_PATTERN.test(String(evidence.headSha || ""))) throw new Error("Reviewed runtime requires an exact 40-character HEAD SHA.");
  if (evidence.lease?.status !== "review_ready") throw new Error("Reviewed runtime requires writer lease status review_ready.");
  if (path.resolve(evidence.lease.worktreePath || "") !== path.resolve(evidence.repository || "")) {
    throw new Error("Reviewed runtime worktree does not match the review-ready lease.");
  }
  if (evidence.lease.branch !== evidence.branch) throw new Error("Reviewed runtime branch does not match the review-ready lease.");
  if (evidence.lease.reviewHeadSha !== evidence.headSha) throw new Error("Reviewed runtime HEAD does not equal reviewHeadSha.");
  if (evidence.remoteHeadSha !== evidence.headSha) throw new Error("Reviewed runtime remote head does not equal reviewHeadSha.");
  if (evidence.pullRequest?.state !== "OPEN" || evidence.pullRequest.isDraft !== false) {
    throw new Error("Reviewed runtime requires the exact open ready-for-review pull request.");
  }
  if (evidence.pullRequest.headRefOid !== evidence.headSha) throw new Error("Reviewed runtime pull-request head does not equal reviewHeadSha.");
  if (!evidence.hasDevApexScript) throw new Error("Reviewed runtime target does not expose the repository-owned dev:apex script.");
  if (!evidence.agenticCanvasOsClean || evidence.agenticCanvasOsBranch !== "main") {
    throw new Error("Reviewed runtime requires a clean canonical Agentic Canvas OS main checkout.");
  }
  if (!SHA_PATTERN.test(String(evidence.agenticCanvasOsRevision || "")) ||
      evidence.agenticCanvasOsRevision !== evidence.agenticCanvasOsRemoteRevision) {
    throw new Error("Reviewed runtime Agentic Canvas OS main checkout must equal fetched origin/main.");
  }
  return evidence;
}

export function validateRuntimeStopOwnership(state, listenerPid) {
  if (state?.schema !== REVIEWED_RUNTIME_SCHEMA) throw new Error("Reviewed runtime state has an unsupported schema.");
  if (listenerPid && listenerPid !== state.listenerPid) {
    throw new Error(`Port ${state.port} now belongs to unrelated PID ${listenerPid}; refusing to stop it.`);
  }
  if (!Number.isInteger(state.supervisorPid) || state.supervisorPid <= 0) {
    throw new Error("Reviewed runtime state has no valid supervisor PID.");
  }
  return true;
}

function inspectReviewedRuntimeCandidate(options, deps) {
  const repository = realpathSync(options.repository);
  const gitCommonDir = resolveGitCommonDir(repository, deps);
  const branch = deps.gitText(repository, ["branch", "--show-current"]).trim();
  const headSha = deps.gitText(repository, ["rev-parse", "HEAD"]).trim();
  const lease = createWriterLeaseStore({ gitCommonDir }).read(branch);
  const remoteLine = deps.gitText(repository, ["ls-remote", "--heads", "origin", `refs/heads/${branch}`]).trim();
  const remoteHeadSha = remoteLine.split(/\s+/)[0] || "";
  const pullRequest = JSON.parse(deps.ghText(repository, [
    "pr", "view", lease?.pullRequestUrl || "", "--json", "state,isDraft,headRefOid",
  ]));
  const packageJson = JSON.parse(readFileSync(path.join(repository, "package.json"), "utf8"));
  const canonicalRepository = path.dirname(gitCommonDir);
  const agenticCanvasOsRoot = realpathSync(path.join(path.dirname(canonicalRepository), "agentic-canvas-os"));
  deps.gitText(agenticCanvasOsRoot, ["fetch", "--prune", "origin"]);
  const agenticCanvasOsRevision = deps.gitText(agenticCanvasOsRoot, ["rev-parse", "HEAD"]).trim();
  const evidence = validateReviewedRuntimeCandidate({
    repository,
    repositoryClean: deps.gitText(repository, ["status", "--porcelain"]).trim() === "",
    branch,
    headSha,
    lease,
    remoteHeadSha,
    pullRequest,
    hasDevApexScript: typeof packageJson.scripts?.["dev:apex"] === "string",
    agenticCanvasOsRoot,
    agenticCanvasOsClean: deps.gitText(agenticCanvasOsRoot, ["status", "--porcelain"]).trim() === "",
    agenticCanvasOsBranch: deps.gitText(agenticCanvasOsRoot, ["branch", "--show-current"]).trim(),
    agenticCanvasOsRevision,
    agenticCanvasOsRemoteRevision: deps.gitText(agenticCanvasOsRoot, ["rev-parse", "origin/main"]).trim(),
  });
  return {
    repository,
    canonicalRepository,
    gitCommonDir,
    branch,
    reviewHeadSha: headSha,
    pullRequestUrl: lease.pullRequestUrl,
    agenticCanvasOsRoot,
    agenticCanvasOsRevision,
    evidence,
  };
}

async function inspectReviewedRuntimeState(state, candidate, deps) {
  if (state.schema !== REVIEWED_RUNTIME_SCHEMA) throw new Error("Reviewed runtime state has an unsupported schema.");
  const listenerPid = deps.readListenerPid(state.port);
  const sourceMatches = state.repository === candidate.repository &&
    state.branch === candidate.branch &&
    state.reviewHeadSha === candidate.reviewHeadSha &&
    state.agenticCanvasOsRevision === candidate.agenticCanvasOsRevision;
  if (!sourceMatches || listenerPid !== state.listenerPid) {
    return {
      ...projectState(state),
      status: "drifted",
      ready: false,
      listenerPid,
      reason: !sourceMatches ? "Recorded reviewed source identity no longer matches the exact candidate." : "Recorded listener PID no longer owns the review port.",
    };
  }
  const httpStatus = await deps.readHttpStatus(state.url);
  if (httpStatus !== 200) {
    return { ...projectState(state), status: "unavailable", ready: false, listenerPid, httpStatus, reason: `HTTP readiness returned ${httpStatus || "no response"}.` };
  }
  return projectReadyState({ ...state, httpStatus }, candidate);
}

function normalizeOptions(options = {}) {
  const repository = String(options.repository || "").trim();
  if (!repository) throw new Error("--repository is required.");
  const host = String(options.host || DEFAULT_REVIEWED_RUNTIME_HOST).trim();
  if (host !== DEFAULT_REVIEWED_RUNTIME_HOST) throw new Error("Reviewed runtime host is fixed to 127.0.0.1.");
  const port = Number(options.port || DEFAULT_REVIEWED_RUNTIME_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) throw new Error("--port must be an integer from 1024 to 65535.");
  if (port === CANONICAL_DEV_PORT && options.allowCanonicalPort !== true) {
    throw new Error("Port 5173 is the canonical Dev port; pass --allow-canonical-port for an explicit reviewed-runtime takeover.");
  }
  const timeoutMs = Number(options.timeoutMs || DEFAULT_REVIEWED_RUNTIME_TIMEOUT_MS);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000) throw new Error("--timeout-ms must be from 1000 to 300000.");
  return { repository: path.resolve(repository), host, port, timeoutMs, allowCanonicalPort: options.allowCanonicalPort === true };
}

function resolveGitCommonDir(repository, deps) {
  return path.resolve(repository, deps.gitText(repository, ["rev-parse", "--git-common-dir"]).trim());
}

function runtimeStatePath(gitCommonDir, port) {
  return path.join(gitCommonDir, "agentic-canvas-os", "reviewed-runtime", `${port}.json`);
}

function readRuntimeState(statePath) {
  if (!existsSync(statePath)) return null;
  return JSON.parse(readFileSync(statePath, "utf8"));
}

function writeRuntimeState(statePath, state, deps) {
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  deps.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`);
  deps.renameFile(temporaryPath, statePath);
}

function projectState(state) {
  return {
    schema: REVIEWED_RUNTIME_SCHEMA,
    status: state.status,
    ready: state.status === "ready",
    repository: state.repository,
    branch: state.branch,
    reviewHeadSha: state.reviewHeadSha,
    agenticCanvasOsRevision: state.agenticCanvasOsRevision,
    pullRequestUrl: state.pullRequestUrl,
    host: state.host,
    port: state.port,
    url: state.url,
    supervisorPid: state.supervisorPid,
    listenerPid: state.listenerPid,
    logPath: state.logPath,
    httpStatus: state.httpStatus,
    startedAt: state.startedAt,
  };
}

function projectReadyState(state, candidate) {
  return {
    ...projectState({ ...state, status: "ready" }),
    ready: true,
    proof: {
      worktreeClean: true,
      reviewHeadMatches: state.reviewHeadSha === candidate.reviewHeadSha,
      remoteHeadMatches: candidate.evidence.remoteHeadSha === candidate.reviewHeadSha,
      pullRequestReady: candidate.evidence.pullRequest.state === "OPEN" && candidate.evidence.pullRequest.isDraft === false,
      listenerPidMatches: true,
      httpReady: state.httpStatus === 200,
      agenticCanvasOsMainMatches: candidate.evidence.agenticCanvasOsRevision === candidate.evidence.agenticCanvasOsRemoteRevision,
    },
  };
}

function createDependencies(overrides) {
  return {
    gitText: (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8" }),
    ghText: (cwd, args) => execFileSync("gh", args, { cwd, encoding: "utf8" }),
    mkdir: directory => mkdirSync(directory, { recursive: true }),
    openLog: logPath => openSync(logPath, "a"),
    closeLog: closeSync,
    writeFile: (filePath, text) => writeFileSync(filePath, text, "utf8"),
    renameFile: renameSync,
    removeFile: filePath => { if (existsSync(filePath)) unlinkSync(filePath); },
    spawnRuntime: ({ cwd, env, host, port, logFd }) => spawn("npm", [
      "run", "dev:apex", "--", "--host", host, "--port", String(port), "--strictPort",
    ], { cwd, env, detached: true, stdio: ["ignore", logFd, logFd] }),
    readListenerPid: port => readListenerPid(port),
    waitForHttp,
    readHttpStatus,
    stopProcessGroup: pid => { try { process.kill(-pid, "SIGTERM"); } catch (error) { if (error?.code !== "ESRCH") throw error; } },
    waitForPortRelease,
    now: () => new Date(),
    ...overrides,
  };
}

function readListenerPid(port) {
  try {
    const output = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" }).trim();
    const pids = output.split(/\s+/).filter(Boolean).map(Number).filter(Number.isInteger);
    if (pids.length > 1) throw new Error(`Port ${port} has multiple listener PIDs: ${pids.join(", ")}`);
    return pids[0] || null;
  } catch (error) {
    if (error?.status === 1) return null;
    throw error;
  }
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await readHttpStatus(url);
    if (status === 200) return status;
    await delay(250);
  }
  throw new Error(`Reviewed runtime did not become HTTP-ready within ${timeoutMs} ms at ${url}.`);
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
  throw new Error(`Reviewed runtime port ${port} did not stop within ${timeoutMs} ms.`);
}
