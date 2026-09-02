// Responsibility: Enforce one fail-closed Agentic Game OS candidate path from clean canonical Dev through gated mirror and delivery outcomes.

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

export const AGENTIC_GAME_OS_PIPELINE_SCHEMA = "agentic-game-os-pipeline/v1";
export const AGENTIC_GAME_OS_PIPELINE_AUDIT_SCHEMA = "agentic-game-os-pipeline-audit/v1";

const SOURCE_REVISION_PATTERN = /^[0-9a-f]{40}$/u;
const ARTIFACT_DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const AUTHORIZATION_MAX_AGE_MS = 60 * 60 * 1000;
const AUTHORIZATION_TIMEOUT_MS = 10 * 1000;
const DEV_TIMEOUT_MS = 120 * 1000;
const DEV_COMMANDS = new Set(["npm run dev:apex", "npm run dev"]);
const SHARED_SUBSTRATE_REPOSITORY = "huijoohwee/knowgrph";
const execFileAsync = promisify(execFile);

const STAGES = Object.freeze({
  DEV: "dev-runtime",
  PROD: "prod-mirror",
  DELIVERY: "delivery-surface",
});

export function createPipelineController({
  candidate,
  adapters,
  devRepositoryPath,
  runGit = defaultRunGit,
  now = () => Date.now(),
  authorizationTimeoutMs = AUTHORIZATION_TIMEOUT_MS,
  devTimeoutMs = DEV_TIMEOUT_MS,
} = {}) {
  const candidateResult = normalizeCandidate(candidate);
  if (!candidateResult.ok) return invalidController(candidateResult.error);

  const adapterResult = normalizeAdapters(adapters);
  if (!adapterResult.ok) return invalidController(adapterResult.error);

  const state = {
    candidate: candidateResult.value,
    stages: {
      [STAGES.DEV]: null,
      [STAGES.PROD]: null,
      [STAGES.DELIVERY]: null,
    },
    consumedAuthorizationIds: new Set(),
    auditEntries: [],
    inFlightOperation: null,
  };
  const authorizationDeadlineMs = limitTimeout(authorizationTimeoutMs, AUTHORIZATION_TIMEOUT_MS);
  const devDeadlineMs = limitTimeout(devTimeoutMs, DEV_TIMEOUT_MS);

  const inspectDevWorktree = createGitDevWorktreeInspector({ repositoryPath: devRepositoryPath, runGit });

  return Object.freeze({
    schema: AGENTIC_GAME_OS_PIPELINE_SCHEMA,
    read: () => snapshot(state),
    runDev: (input) => withPipelineOperation(state, STAGES.DEV, () => runDev({
      state,
      adapters: adapterResult.value,
      inspectDevWorktree,
      input,
      devTimeoutMs: devDeadlineMs,
    })),
    advanceProdMirror: (input) => withPipelineOperation(state, STAGES.PROD, () => advanceProdMirror({
      state, adapters: adapterResult.value, input, now, authorizationTimeoutMs: authorizationDeadlineMs,
    })),
    advanceDeliverySurface: (input) => withPipelineOperation(state, STAGES.DELIVERY, () => advanceDeliverySurface({
      state, adapters: adapterResult.value, input, now, authorizationTimeoutMs: authorizationDeadlineMs,
    })),
  });
}

export function createGitDevWorktreeInspector({ repositoryPath, runGit = defaultRunGit } = {}) {
  const resolvedPath = typeof repositoryPath === "string" ? path.resolve(repositoryPath) : null;
  return async function inspectGitDevWorktree() {
    if (!resolvedPath) throw new Error("Dev repository path is required.");
    const git = (args) => runGit({ repositoryPath: resolvedPath, args });
    const [root, remote, branch, status, headRevision, originMainRevision] = await Promise.all([
      git(["rev-parse", "--show-toplevel"]),
      git(["remote", "get-url", "origin"]),
      git(["symbolic-ref", "--quiet", "--short", "HEAD"]),
      git(["status", "--porcelain=v1", "--untracked-files=all"]),
      git(["rev-parse", "HEAD"]),
      git(["rev-parse", "origin/main"]),
    ]);
    const statusLines = cleanLines(status);
    return freezeCopy({
      repository: repositoryFromRemote(remote),
      repositoryPath: resolvedPath,
      observedRoot: path.resolve(String(root).trim()),
      branch: String(branch).trim(),
      trackedFileModificationCount: statusLines.filter((line) => !line.startsWith("?? ")).length,
      untrackedFileCount: statusLines.filter((line) => line.startsWith("?? ")).length,
      headRevision: String(headRevision).trim(),
      originMainRevision: String(originMainRevision).trim(),
    });
  };
}

async function runDev({ state, adapters, inspectDevWorktree, input = {}, devTimeoutMs }) {
  const existing = state.stages[STAGES.DEV];
  if (existing?.outcome === "completed") return successResult(state, existing);

  const inspection = await callAdapter(inspectDevWorktree);
  const worktree = inspection.ok ? inspection.value : null;
  const worktreeError = validateDevWorktree(worktree, state.candidate);
  if (worktreeError) return failureResult(state, STAGES.DEV, worktreeError);
  if (!DEV_COMMANDS.has(input.command)) {
    return failureResult(state, STAGES.DEV, error("dev-command", "Dev command is not declared.", {
      command: input.command ?? null,
      allowedCommands: [...DEV_COMMANDS],
    }));
  }

  const outcome = await boundedCall(
    () => adapters.startDev(Object.freeze({
      candidate: state.candidate,
      command: input.command,
      worktree,
      deadlineMs: devTimeoutMs,
    })),
    devTimeoutMs,
  );
  if (
    !outcome.ok
    || outcome.value?.reachable !== true
    || outcome.value?.sourceRevision !== state.candidate.sourceRevision
    || path.resolve(String(outcome.value?.repositoryPath ?? "")) !== worktree.repositoryPath
  ) {
    const reason = outcome.timedOut ? "deadline" : "unreachable";
    return failureResult(state, STAGES.DEV, error("dev-runtime-unreachable", "Dev surface was not reachable within the declared bound.", { reason }));
  }

  const stage = freezeCopy({
    stage: STAGES.DEV,
    sourceRevision: state.candidate.sourceRevision,
    artifactDigest: state.candidate.artifactDigest,
    command: input.command,
    outcome: "completed",
  });
  state.stages[STAGES.DEV] = stage;
  appendAudit(state, stage, null);
  return successResult(state, stage);
}

async function advanceProdMirror({ state, adapters, input = {}, now, authorizationTimeoutMs }) {
  const existing = state.stages[STAGES.PROD];
  if (existing?.outcome === "completed") return successResult(state, existing);
  const prerequisite = requireCompletedStage(state, STAGES.DEV);
  if (prerequisite) return rejectGatedStage(state, STAGES.PROD, prerequisite, null);
  if (state.candidate.pinStatus !== "matched") {
    return rejectGatedStage(state, STAGES.PROD, error("pin-mismatch", "A pin-mismatched candidate cannot enter a gated stage.", {
      artifactDigest: state.candidate.artifactDigest,
      dependency: state.candidate.pinMismatch.dependency,
      pinStatus: state.candidate.pinStatus,
    }), null);
  }

  const authorization = await resolveAuthorization({
    state,
    adapters,
    supplied: input.authorization,
    targetStage: STAGES.PROD,
    now,
    authorizationTimeoutMs,
  });
  if (!authorization.ok) return rejectGatedStage(state, STAGES.PROD, authorization.error, null);

  const pending = stageRecord(state, STAGES.PROD, "pending");
  state.stages[STAGES.PROD] = pending;
  state.consumedAuthorizationIds.add(authorization.value.authorizationId);
  const write = await callAdapter(() => adapters.writeProdMirror(Object.freeze({
    candidate: state.candidate,
    authorization: authorization.value,
    recordedCandidate: pending,
  })));
  if (!write.ok || write.value?.completed !== true) {
    return rejectGatedStage(state, STAGES.PROD, error("prod-mirror-rejected", "Prod mirror adapter did not complete."), authorization.value.authorizationId);
  }

  const verification = await callAdapter(() => adapters.verifyProdMirror(Object.freeze({
    candidate: state.candidate,
    authorization: authorization.value,
    recordedCandidate: pending,
  })));
  if (
    !verification.ok
    || verification.value?.sourceRevision !== state.candidate.sourceRevision
    || verification.value?.artifactDigest !== state.candidate.artifactDigest
  ) {
    return rejectGatedStage(state, STAGES.PROD, error("prod-mirror-rejected", "Prod mirror does not prove the exact candidate bytes.", {
      observedRevision: verification.value?.sourceRevision ?? null,
      observedDigest: verification.value?.artifactDigest ?? null,
    }), authorization.value.authorizationId);
  }

  const completed = stageRecord(state, STAGES.PROD, "completed");
  state.stages[STAGES.PROD] = completed;
  appendAudit(state, completed, authorization.value.authorizationId);
  return successResult(state, completed);
}

async function advanceDeliverySurface({ state, adapters, input = {}, now, authorizationTimeoutMs }) {
  const existing = state.stages[STAGES.DELIVERY];
  if (existing?.outcome === "completed") return successResult(state, existing);
  const prerequisite = requireCompletedStage(state, STAGES.PROD);
  if (prerequisite) return rejectGatedStage(state, STAGES.DELIVERY, prerequisite, null);

  const inspection = await callAdapter(() => adapters.inspectDeliveryArtifact(Object.freeze({
    candidate: state.candidate,
    prodMirror: state.stages[STAGES.PROD],
  })));
  const mirrorDigest = state.stages[STAGES.PROD]?.artifactDigest ?? null;
  const observedDigest = inspection.ok && typeof inspection.value?.artifactDigest === "string"
    ? inspection.value.artifactDigest
    : null;
  if (!mirrorDigest || !observedDigest || mirrorDigest !== observedDigest) {
    return rejectGatedStage(state, STAGES.DELIVERY, error("digest-mismatch", "Delivery artifact does not match the recorded Prod mirror artifact.", {
      recordedDigest: mirrorDigest,
      observedDigest,
      absent: [
        ...(!mirrorDigest ? ["recordedDigest"] : []),
        ...(!observedDigest ? ["observedDigest"] : []),
      ],
    }), null);
  }

  const authorization = await resolveAuthorization({
    state,
    adapters,
    supplied: input.authorization,
    targetStage: STAGES.DELIVERY,
    now,
    authorizationTimeoutMs,
  });
  if (!authorization.ok) return rejectGatedStage(state, STAGES.DELIVERY, authorization.error, null);

  const pending = stageRecord(state, STAGES.DELIVERY, "pending");
  state.stages[STAGES.DELIVERY] = pending;
  state.consumedAuthorizationIds.add(authorization.value.authorizationId);
  const deployment = await callAdapter(() => adapters.deployDeliverySurface(Object.freeze({
    candidate: state.candidate,
    authorization: authorization.value,
    prodMirror: state.stages[STAGES.PROD],
    observedArtifactDigest: observedDigest,
  })));
  if (!deployment.ok || deployment.value?.completed !== true) {
    return rejectGatedStage(state, STAGES.DELIVERY, error("delivery-rejected", "Delivery adapter did not complete."), authorization.value.authorizationId);
  }

  const verification = await callAdapter(() => adapters.verifyDeliverySurface(Object.freeze({
    candidate: state.candidate,
    authorization: authorization.value,
  })));
  if (
    !verification.ok
    || verification.value?.reachable !== true
    || verification.value?.sourceRevision !== state.candidate.sourceRevision
    || verification.value?.artifactDigest !== state.candidate.artifactDigest
  ) {
    return rejectGatedStage(state, STAGES.DELIVERY, error("digest-mismatch", "Delivered surface does not prove the exact candidate bytes.", {
      recordedDigest: state.candidate.artifactDigest,
      observedDigest: verification.value?.artifactDigest ?? null,
      observedRevision: verification.value?.sourceRevision ?? null,
    }), authorization.value.authorizationId);
  }

  const completed = stageRecord(state, STAGES.DELIVERY, "completed");
  state.stages[STAGES.DELIVERY] = completed;
  appendAudit(state, completed, authorization.value.authorizationId);
  return successResult(state, completed);
}

async function resolveAuthorization({ state, adapters, supplied, targetStage, now, authorizationTimeoutMs }) {
  const suppliedId = typeof supplied?.authorizationId === "string" ? supplied.authorizationId : null;
  const checked = await boundedCall(
    () => adapters.checkDeployGate(Object.freeze({
      authorization: freezeCopy(supplied ?? null),
      targetStage,
      deadlineMs: authorizationTimeoutMs,
    })),
    authorizationTimeoutMs,
  );
  if (!checked.ok) {
    return { ok: false, authorizationId: suppliedId, error: authorizationError(checked.timedOut ? ["check-timeout"] : ["check-error"]) };
  }

  const authorization = checked.value;
  const failures = validateAuthorization({ authorization, targetStage, candidate: state.candidate, now: now(), consumed: state.consumedAuthorizationIds });
  if (failures.length > 0) {
    return { ok: false, authorizationId: authorization?.authorizationId ?? suppliedId, error: authorizationError(failures) };
  }
  return { ok: true, value: freezeCopy(authorization) };
}

function validateAuthorization({ authorization, targetStage, candidate, now, consumed }) {
  if (!authorization || typeof authorization !== "object" || Array.isArray(authorization)) return ["authorization"];
  const failures = [];
  const requiredText = ["authorizationId", "operatorIdentity", "targetStage", "candidateRevision", "candidateDigest"];
  for (const field of requiredText) {
    if (typeof authorization[field] !== "string" || authorization[field].trim() === "") failures.push(field);
  }
  if (!Number.isFinite(authorization.issuedAtMs)) failures.push("issuedAtMs");
  if (authorization.targetStage !== targetStage) failures.push("targetStage");
  if (authorization.candidateRevision !== candidate.sourceRevision) failures.push("candidateRevision");
  if (authorization.candidateDigest !== candidate.artifactDigest) failures.push("candidateDigest");
  if (Number.isFinite(authorization.issuedAtMs) && (authorization.issuedAtMs > now || now - authorization.issuedAtMs > AUTHORIZATION_MAX_AGE_MS)) failures.push("issuedAtMs");
  if (consumed.has(authorization.authorizationId)) failures.push("authorizationId-consumed");
  return [...new Set(failures)].sort();
}

function validateDevWorktree(worktree, candidate) {
  if (!worktree || typeof worktree !== "object" || Array.isArray(worktree)) {
    return error("unclean-worktree", "Dev worktree evidence is absent.", { conditions: ["worktree-evidence"] });
  }
  const conditions = [];
  if (worktree.repository !== SHARED_SUBSTRATE_REPOSITORY) conditions.push("repository");
  if (worktree.repositoryPath !== worktree.observedRoot) conditions.push("repository-root");
  if (worktree.branch !== "main") conditions.push("branch");
  if (worktree.trackedFileModificationCount !== 0) conditions.push("tracked-file-modifications");
  if (worktree.untrackedFileCount !== 0) conditions.push("untracked-files");
  if (!SOURCE_REVISION_PATTERN.test(worktree.headRevision) || worktree.headRevision !== worktree.originMainRevision) conditions.push("origin-main-parity");
  if (worktree.headRevision !== candidate.sourceRevision) conditions.push("candidate-revision");
  return conditions.length > 0
    ? error("unclean-worktree", "Dev worktree is not clean canonical main.", { conditions })
    : null;
}

function normalizeCandidate(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { ok: false, error: error("candidate-invalid", "Candidate is required.") };
  }
  const sourceRevision = String(candidate.sourceRevision ?? "");
  const artifactDigest = String(candidate.artifactDigest ?? "");
  const pinStatus = candidate.pinStatus;
  const mismatchDependency = typeof candidate.pinMismatch?.dependency === "string"
    ? candidate.pinMismatch.dependency.trim()
    : "";
  if (
    !SOURCE_REVISION_PATTERN.test(sourceRevision)
    || !ARTIFACT_DIGEST_PATTERN.test(artifactDigest)
    || !["matched", "pin-mismatched"].includes(pinStatus)
    || (pinStatus === "pin-mismatched" && mismatchDependency === "")
    || (pinStatus === "matched" && candidate.pinMismatch != null)
  ) {
    return { ok: false, error: error("candidate-invalid", "Candidate requires an exact Git revision and SHA-256 artifact digest.") };
  }
  return {
    ok: true,
    value: freezeCopy({
      sourceRevision,
      artifactDigest,
      pinStatus,
      pinMismatch: pinStatus === "pin-mismatched" ? { dependency: mismatchDependency } : null,
    }),
  };
}

function normalizeAdapters(adapters) {
  const required = [
    "startDev",
    "checkDeployGate",
    "writeProdMirror",
    "verifyProdMirror",
    "inspectDeliveryArtifact",
    "deployDeliverySurface",
    "verifyDeliverySurface",
  ];
  const missing = required.filter((name) => typeof adapters?.[name] !== "function");
  return missing.length > 0
    ? { ok: false, error: error("adapter-missing", "Pipeline adapters are incomplete.", { missing }) }
    : { ok: true, value: adapters };
}

function requireCompletedStage(state, stage) {
  return state.stages[stage]?.outcome === "completed"
    ? null
    : error("stage-order", "The preceding pipeline stage has not completed for this candidate.", { requiredStage: stage });
}

function stageRecord(state, stage, outcome) {
  return freezeCopy({
    stage,
    sourceRevision: state.candidate.sourceRevision,
    artifactDigest: state.candidate.artifactDigest,
    outcome,
  });
}

function rejectGatedStage(state, stage, failure, authorizationId) {
  const rejected = stageRecord(state, stage, "rejected");
  if (state.stages[stage]?.outcome !== "completed") state.stages[stage] = rejected;
  const auditEntry = appendAudit(state, rejected, authorizationId);
  return failureResult(state, stage, failure, auditEntry);
}

async function withPipelineOperation(state, stage, action) {
  if (state.inFlightOperation !== null) {
    const failure = error("pipeline-busy", "Another pipeline operation is already in progress.", {
      requestedStage: stage,
      inFlightStage: state.inFlightOperation,
    });
    return stage === STAGES.DEV
      ? failureResult(state, stage, failure)
      : rejectGatedStage(state, stage, failure, null);
  }
  state.inFlightOperation = stage;
  try {
    return await action();
  } finally {
    state.inFlightOperation = null;
  }
}

function appendAudit(state, stage, authorizationId) {
  const entry = freezeCopy({
    schema: AGENTIC_GAME_OS_PIPELINE_AUDIT_SCHEMA,
    sequence: state.auditEntries.length + 1,
    stage: stage.stage,
    sourceRevision: stage.sourceRevision,
    artifactDigest: stage.artifactDigest,
    consumedAuthorizationId: authorizationId,
    outcome: stage.outcome,
  });
  state.auditEntries.push(entry);
  return entry;
}

function readiness(state) {
  if (state.stages[STAGES.DELIVERY]?.outcome === "completed") return "production-runtime-ready";
  if (state.stages[STAGES.DEV]?.outcome === "completed") return "local-runtime-ready";
  return "not-ready";
}

function successResult(state, stage) {
  return freezeCopy({ ok: true, status: readiness(state), stage, pipeline: snapshot(state) });
}

function failureResult(state, stage, failure, auditEntry = null) {
  return freezeCopy({ ok: false, status: readiness(state), stage, error: failure, auditEntry, pipeline: snapshot(state) });
}

function snapshot(state) {
  return freezeCopy({
    schema: AGENTIC_GAME_OS_PIPELINE_SCHEMA,
    candidate: state.candidate,
    stages: state.stages,
    consumedAuthorizationIds: [...state.consumedAuthorizationIds].sort(),
    auditEntries: state.auditEntries,
    status: readiness(state),
  });
}

function authorizationError(fields) {
  return error("authorization-missing", "Deploy Gate authorization is absent or invalid.", { fields: [...new Set(fields)].sort() });
}

function error(code, message, details = {}) {
  return freezeCopy({ code, message, ...details });
}

async function boundedCall(action, timeoutMs) {
  let timeout;
  try {
    return await Promise.race([
      Promise.resolve().then(action).then((value) => ({ ok: true, value }), (cause) => ({ ok: false, cause })),
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve({ ok: false, timedOut: true }), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function callAdapter(action) {
  try {
    return { ok: true, value: await action() };
  } catch (cause) {
    return { ok: false, cause };
  }
}

function limitTimeout(value, maximumMs) {
  return Number.isFinite(value) && value > 0 ? Math.min(value, maximumMs) : maximumMs;
}

async function defaultRunGit({ repositoryPath, args }) {
  const { stdout } = await execFileAsync("git", ["-C", repositoryPath, ...args], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout;
}

function repositoryFromRemote(value) {
  const normalized = String(value).trim().replace(/\\/gu, "/").replace(/\.git$/u, "");
  const match = normalized.match(/(?:github\.com[:/])([^/]+\/[^/]+)$/u);
  return match?.[1] ?? null;
}

function cleanLines(value) {
  const text = String(value ?? "").trimEnd();
  return text === "" ? [] : text.split("\n");
}

function invalidController(configurationError) {
  const result = freezeCopy({ ok: false, status: "not-ready", stage: null, error: configurationError, auditEntry: null, pipeline: null });
  return Object.freeze({
    schema: AGENTIC_GAME_OS_PIPELINE_SCHEMA,
    read: () => result,
    runDev: async () => result,
    advanceProdMirror: async () => result,
    advanceDeliverySurface: async () => result,
  });
}

function freezeCopy(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freezeCopy));
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, freezeCopy(nested)])));
}
