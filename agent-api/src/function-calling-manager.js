import { randomUUID, timingSafeEqual } from "node:crypto";

import { normalizeJson } from "./json-contract.js";
import { assertIdentifier, emptyCostLog } from "./function-calling-runtime-support.js";

const STATE_SCHEMA = "function-calling-manager-state/v1";
const DEFAULT_CONTINUATION_TTL_MS = 86_400_000;
const DEFAULT_CLAIM_TTL_MS = 3_600_000;

function assertOwner(value, methods, field) {
  if (!value || typeof value !== "object") throw new TypeError(`${field} must be an object.`);
  for (const method of methods) {
    if (typeof value[method] !== "function") throw new TypeError(`${field}.${method} must be a function.`);
  }
}

function blocked(runId, reasonCode, message, details = {}) {
  const notRun = emptyCostLog("not-run");
  return Object.freeze({
    runId,
    status: "blocked",
    stage: details.stage || "continuation",
    reasonCode,
    message,
    costLog: details.costLog || notRun,
    gatewayCostLog: details.gatewayCostLog || notRun,
    ...(details.retryable === true ? { retryable: true } : {}),
  });
}

function publicResult(result) {
  if (!result || typeof result !== "object") return result;
  const { continuationState: _privateState, ...safe } = result;
  return Object.freeze(safe);
}

function sameToken(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function createMemoryFunctionContinuationStore() {
  const records = new Map();
  const claims = new Map();
  function recover(runId, timestamp) {
    const claim = claims.get(runId);
    if (claim && claim.claimExpiresAt <= timestamp) {
      claims.delete(runId);
      if (claim.record.expiresAt > timestamp) records.set(runId, claim.record);
    }
    const record = records.get(runId);
    if (record && record.expiresAt <= timestamp) records.delete(runId);
  }
  return Object.freeze({
    put(record) {
      recover(record.runId, Date.now());
      if (records.has(record.runId) || claims.has(record.runId)) return false;
      records.set(record.runId, normalizeJson(record, "functionContinuation"));
      return true;
    },
    get(runId) {
      recover(runId, Date.now());
      return records.get(runId) || claims.get(runId)?.record || null;
    },
    claim(runId, claimId, claimExpiresAt) {
      recover(runId, Date.now());
      const record = records.get(runId);
      if (!record || claims.has(runId)) return null;
      records.delete(runId);
      claims.set(runId, { claimId, claimExpiresAt, record });
      return record;
    },
    commit(runId, claimId) {
      const claim = claims.get(runId);
      if (!claim || claim.claimId !== claimId) return false;
      claims.delete(runId);
      return true;
    },
    release(runId, claimId) {
      const claim = claims.get(runId);
      if (!claim || claim.claimId !== claimId) return false;
      claims.delete(runId);
      records.set(runId, claim.record);
      return true;
    },
    replace(runId, claimId, record) {
      const claim = claims.get(runId);
      if (!claim || claim.claimId !== claimId) return false;
      claims.delete(runId);
      records.set(runId, normalizeJson(record, "functionContinuation"));
      return true;
    },
    delete(runId) {
      claims.delete(runId);
      return records.delete(runId);
    },
    stats: () => Object.freeze({
      persistence: "isolate-memory", atomicClaims: true, recovery: "same-isolate",
      owner: "function-calling-manager", pendingContinuations: records.size + claims.size,
    }),
  });
}

export function createFunctionCallingManager({
  functionCalling,
  tools = [],
  capabilities,
  continuationStore = createMemoryFunctionContinuationStore(),
  createId = randomUUID,
  now = Date.now,
  continuationTtlMs = DEFAULT_CONTINUATION_TTL_MS,
  claimTtlMs = DEFAULT_CLAIM_TTL_MS,
} = {}) {
  assertOwner(functionCalling, ["run", "resume", "stats"], "functionCalling");
  assertOwner(continuationStore, ["put", "get", "claim", "commit", "release", "replace"], "continuationStore");
  if (!Array.isArray(tools)) throw new TypeError("tools must be an array.");
  if (!Number.isInteger(continuationTtlMs) || continuationTtlMs < 1) throw new TypeError("continuationTtlMs must be positive.");
  if (!Number.isInteger(claimTtlMs) || claimTtlMs < 1) throw new TypeError("claimTtlMs must be positive.");
  let startedRuns = 0;
  let pausedRuns = 0;
  let resumedRuns = 0;
  let completedRuns = 0;
  let blockedRuns = 0;

  function timestamp() {
    const value = now();
    if (!Number.isFinite(value)) throw new TypeError("now must return a finite timestamp.");
    return value;
  }

  function pausedRecord(runId, result, createdAt, resumeToken = assertIdentifier(createId(), "resumeToken")) {
    const expiresAt = timestamp() + continuationTtlMs;
    return Object.freeze({
      schema: STATE_SCHEMA,
      phase: "paused",
      runId,
      resumeToken,
      continuationState: normalizeJson(result.continuationState, "continuationState"),
      interruptions: normalizeJson(result.interruptions, "interruptions"),
      createdAt,
      expiresAt,
    });
  }

  function pausedResult(result, record) {
    return Object.freeze({
      runId: record.runId,
      status: "paused",
      stage: "review",
      resumeToken: record.resumeToken,
      expiresAt: record.expiresAt,
      interruptions: record.interruptions,
      costLog: result.costLog,
      gatewayCostLog: result.gatewayCostLog,
    });
  }

  async function run({ runId, input, toolChoice, parallelToolCalls = false, signal } = {}) {
    const safeRunId = assertIdentifier(runId, "runId");
    const createdAt = timestamp();
    const reservation = Object.freeze({
      schema: STATE_SCHEMA, phase: "starting", runId: safeRunId,
      createdAt, expiresAt: createdAt + claimTtlMs,
    });
    if (await continuationStore.put(reservation) !== true) {
      blockedRuns += 1;
      return blocked(safeRunId, "run_active_or_paused", "The Function Calling run already exists.");
    }
    const claimId = assertIdentifier(createId(), "claimId");
    const claimed = await continuationStore.claim(safeRunId, claimId, timestamp() + claimTtlMs);
    if (!claimed) {
      blockedRuns += 1;
      return blocked(safeRunId, "continuation_claim_conflict", "The Function Calling run could not be claimed.");
    }
    startedRuns += 1;
    let result;
    try {
      result = await functionCalling.run({
        runId: safeRunId, input, tools, capabilities, toolChoice, parallelToolCalls, signal,
      });
    } catch (error) {
      result = blocked(safeRunId, "runtime_failed", error instanceof Error ? error.message : String(error), { stage: "execute" });
    }
    if (result.status === "paused" && result.continuationState) {
      const record = pausedRecord(safeRunId, result, createdAt);
      if (await continuationStore.replace(safeRunId, claimId, record) !== true) {
        return blocked(safeRunId, "continuation_store_failed", "The paused Function Calling state was not committed.");
      }
      pausedRuns += 1;
      return pausedResult(result, record);
    }
    if (await continuationStore.commit(safeRunId, claimId) !== true) {
      blockedRuns += 1;
      return blocked(safeRunId, "continuation_settlement_failed", "The Function Calling run could not be settled.");
    }
    if (result.status === "completed") completedRuns += 1;
    else blockedRuns += 1;
    return publicResult(result);
  }

  async function resume({ runId, resumeToken, decision, reviewerEvidence, reason, editedPayload, signal } = {}) {
    const safeRunId = assertIdentifier(runId, "runId");
    const safeToken = assertIdentifier(resumeToken, "resumeToken");
    const claimId = assertIdentifier(createId(), "claimId");
    const record = await continuationStore.claim(safeRunId, claimId, timestamp() + claimTtlMs);
    if (!record) {
      blockedRuns += 1;
      return blocked(safeRunId, "continuation_missing_or_active", "No claimable Function Calling continuation exists.");
    }
    if (record.schema !== STATE_SCHEMA || record.phase !== "paused" || !sameToken(record.resumeToken || "", safeToken)
      || record.expiresAt <= timestamp()) {
      if (await continuationStore.release(safeRunId, claimId) !== true) {
        blockedRuns += 1;
        return blocked(safeRunId, "continuation_store_failed", "The Function Calling claim could not be released.");
      }
      blockedRuns += 1;
      return blocked(safeRunId, "continuation_auth_failed", "Function Calling continuation evidence is invalid.", { retryable: true });
    }
    const reviewId = record.continuationState?.pendingCall?.reviewState?.reviewId;
    const resolution = {
      reviewId,
      decision,
      reviewerEvidence,
      ...(reason === undefined ? {} : { reason }),
      ...(editedPayload === undefined ? {} : { editedPayload }),
    };
    resumedRuns += 1;
    let result;
    try {
      result = await functionCalling.resume({
        continuationState: record.continuationState, resolution, tools, signal,
      });
    } catch (error) {
      result = blocked(safeRunId, "continuation_invalid", error instanceof Error ? error.message : String(error));
    }
    if (result.status === "paused" && result.continuationState) {
      const next = pausedRecord(safeRunId, result, record.createdAt);
      if (await continuationStore.replace(safeRunId, claimId, next) !== true) {
        blockedRuns += 1;
        return blocked(safeRunId, "continuation_store_failed", "The next Function Calling pause was not committed.");
      }
      pausedRuns += 1;
      return pausedResult(result, next);
    }
    if (result.status === "blocked" && result.retryable === true && result.continuationState) {
      const next = Object.freeze({ ...record, continuationState: result.continuationState });
      if (await continuationStore.replace(safeRunId, claimId, next) !== true) {
        blockedRuns += 1;
        return blocked(safeRunId, "continuation_store_failed", "The retryable Function Calling state was not committed.");
      }
      blockedRuns += 1;
      return publicResult(result);
    }
    if (await continuationStore.commit(safeRunId, claimId) !== true) {
      blockedRuns += 1;
      return blocked(safeRunId, "continuation_settlement_failed", "The Function Calling continuation could not be settled.");
    }
    if (result.status === "completed") completedRuns += 1;
    else blockedRuns += 1;
    return publicResult(result);
  }

  function stats() {
    const runtime = functionCalling.stats();
    const store = typeof continuationStore.stats === "function" ? continuationStore.stats() : {};
    return Object.freeze({
      configured: runtime.adapterConfigured && runtime.toolGatewayConfigured && tools.length > 0 && Boolean(capabilities),
      startedRuns, pausedRuns, resumedRuns, completedRuns, blockedRuns,
      continuationTtlMs, claimTtlMs, ...store,
    });
  }

  return Object.freeze({ run, resume, stats });
}

export const FUNCTION_CALLING_MANAGER_DEFAULTS = Object.freeze({
  continuationTtlMs: DEFAULT_CONTINUATION_TTL_MS,
  claimTtlMs: DEFAULT_CLAIM_TTL_MS,
});
