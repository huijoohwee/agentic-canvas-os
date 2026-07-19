import { createHash, randomUUID } from "node:crypto";

import { normalizeJson, serializedJsonLength } from "./json-contract.js";

const RECEIPT_SCHEMA = "function-execution-receipt/v1";
const UPSTREAM_SCHEMA = "knowgrph-tool-execution-receipt/v1";
const DEFAULT_RECEIPT_TTL_MS = 604_800_000;
const DEFAULT_CLAIM_TTL_MS = 60_000;
const DEFAULT_MAX_RECORD_CHARS = 500_000;

function identifier(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} must be a non-empty string.`);
  const normalized = value.trim();
  if (normalized.length > 512) throw new RangeError(`${field} exceeds 512 characters.`);
  return normalized;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function assertStore(value) {
  const methods = ["put", "get", "claim", "replace", "release", "delete"];
  if (!value || typeof value !== "object") throw new TypeError("executionReceiptStore must be an object.");
  for (const method of methods) {
    if (typeof value[method] !== "function") throw new TypeError(`executionReceiptStore.${method} must be a function.`);
  }
}

function blocked(reasonCode, message, retryable = false) {
  return Object.freeze({ status: "blocked", reasonCode, message, ...(retryable ? { retryable: true } : {}) });
}

function normalizeRequest(value) {
  const argumentsValue = normalizeJson(value?.arguments, "executionReceipt.arguments");
  if (!argumentsValue || typeof argumentsValue !== "object" || Array.isArray(argumentsValue)) {
    throw new TypeError("executionReceipt.arguments must be an object.");
  }
  const request = Object.freeze({
    runId: identifier(value?.runId, "executionReceipt.runId"),
    callId: identifier(value?.callId, "executionReceipt.callId"),
    toolName: identifier(value?.toolName, "executionReceipt.toolName"),
    toolRevision: identifier(value?.toolRevision, "executionReceipt.toolRevision"),
    riskClass: identifier(value?.riskClass, "executionReceipt.riskClass"),
    arguments: argumentsValue,
    requiresUpstreamReceipt: value?.requiresUpstreamReceipt === true,
  });
  return Object.freeze({
    ...request,
    receiptKey: `execution-${digest({ runId: request.runId, callId: request.callId })}`,
    requestDigest: digest(request),
  });
}

function validateRecord(value, request, timestamp, maxRecordChars) {
  const record = normalizeJson(value, "executionReceiptRecord");
  if (!record || typeof record !== "object" || Array.isArray(record)
    || record.schema !== RECEIPT_SCHEMA || record.receiptKey !== request.receiptKey
    || record.requestDigest !== request.requestDigest || record.runId !== request.runId
    || record.callId !== request.callId || record.toolName !== request.toolName
    || record.toolRevision !== request.toolRevision || record.riskClass !== request.riskClass
    || record.requiresUpstreamReceipt !== request.requiresUpstreamReceipt
    || !["reserved", "authorized", "completed"].includes(record.phase)
    || !Number.isFinite(record.createdAt) || !Number.isFinite(record.updatedAt)
    || !Number.isFinite(record.expiresAt) || record.expiresAt <= timestamp
    || serializedJsonLength(record) > maxRecordChars) {
    return null;
  }
  return record;
}

function plan(record, request, replayed = record.phase === "completed") {
  const evidence = Object.freeze({
    schema: RECEIPT_SCHEMA,
    receiptId: record.receiptId,
    idempotencyKey: record.idempotencyKey || "",
    requestDigest: record.requestDigest,
    phase: record.phase,
    replayed,
    ...(record.phase === "completed" && record.upstreamReceipt
      ? { upstreamReceipt: normalizeJson(record.upstreamReceipt, "executionReceipt.upstreamReceipt") }
      : {}),
  });
  return Object.freeze({
    status: record.phase,
    receiptKey: record.receiptKey,
    request,
    record,
    evidence,
    ...(record.phase === "authorized" ? { arguments: record.arguments } : {}),
    ...(record.phase === "completed" ? { output: record.output } : {}),
  });
}

function validateUpstreamReceipt(value, record) {
  if (!record.requiresUpstreamReceipt) return null;
  if (!exactKeys(value, ["schema", "idempotencyKey", "requestDigest", "status"])
    || value.schema !== UPSTREAM_SCHEMA
    || value.idempotencyKey !== record.idempotencyKey
    || value.requestDigest !== record.executionDigest
    || !["applied", "replayed"].includes(value.status)) {
    return false;
  }
  return normalizeJson(value, "upstreamExecutionReceipt");
}

export function createMemoryFunctionExecutionReceiptStore({ now = Date.now } = {}) {
  const records = new Map();
  const claims = new Map();
  function recover(receiptKey) {
    const timestamp = now();
    const claim = claims.get(receiptKey);
    if (claim && claim.claimExpiresAt <= timestamp) {
      claims.delete(receiptKey);
      if (claim.record.expiresAt > timestamp) records.set(receiptKey, claim.record);
    }
    if (records.get(receiptKey)?.expiresAt <= timestamp) records.delete(receiptKey);
  }
  return Object.freeze({
    put(record) {
      recover(record.receiptKey);
      if (records.has(record.receiptKey) || claims.has(record.receiptKey)) return false;
      records.set(record.receiptKey, normalizeJson(record, "executionReceiptRecord"));
      return true;
    },
    get(receiptKey) {
      recover(receiptKey);
      return records.get(receiptKey) || claims.get(receiptKey)?.record || null;
    },
    claim(receiptKey, claimId, claimExpiresAt) {
      recover(receiptKey);
      const record = records.get(receiptKey);
      if (!record || claims.has(receiptKey)) return null;
      records.delete(receiptKey);
      claims.set(receiptKey, { claimId, claimExpiresAt, record });
      return record;
    },
    replace(receiptKey, claimId, record) {
      const claim = claims.get(receiptKey);
      if (!claim || claim.claimId !== claimId) return false;
      claims.delete(receiptKey);
      records.set(receiptKey, normalizeJson(record, "executionReceiptRecord"));
      return true;
    },
    release(receiptKey, claimId) {
      const claim = claims.get(receiptKey);
      if (!claim || claim.claimId !== claimId) return false;
      claims.delete(receiptKey);
      records.set(receiptKey, claim.record);
      return true;
    },
    delete(receiptKey) {
      claims.delete(receiptKey);
      return records.delete(receiptKey);
    },
    stats: () => Object.freeze({
      persistence: "isolate-memory", atomicClaims: true, recovery: "same-isolate",
      pendingExecutionReceipts: records.size + claims.size,
    }),
  });
}

export function createFunctionExecutionReceiptRuntime({
  executionReceiptStore = createMemoryFunctionExecutionReceiptStore(),
  createId = randomUUID,
  now = Date.now,
  receiptTtlMs = DEFAULT_RECEIPT_TTL_MS,
  claimTtlMs = DEFAULT_CLAIM_TTL_MS,
  maxRecordChars = DEFAULT_MAX_RECORD_CHARS,
} = {}) {
  assertStore(executionReceiptStore);
  for (const [field, value] of Object.entries({ receiptTtlMs, claimTtlMs, maxRecordChars })) {
    if (!Number.isInteger(value) || value < 1) throw new TypeError(`${field} must be a positive integer.`);
  }
  let reservations = 0;
  let authorizations = 0;
  let executions = 0;
  let completions = 0;
  let replays = 0;
  let blockedAttempts = 0;

  function timestamp() {
    const value = now();
    if (!Number.isFinite(value)) throw new TypeError("now must return a finite timestamp.");
    return value;
  }

  async function prepare(value) {
    const request = normalizeRequest(value);
    const currentTime = timestamp();
    let record = await executionReceiptStore.get(request.receiptKey);
    if (!record) {
      const receiptId = identifier(createId(), "receiptId");
      const created = Object.freeze({
        schema: RECEIPT_SCHEMA, phase: "reserved", receiptKey: request.receiptKey, receiptId,
        runId: request.runId, callId: request.callId, toolName: request.toolName,
        toolRevision: request.toolRevision, riskClass: request.riskClass,
        requiresUpstreamReceipt: request.requiresUpstreamReceipt,
        requestDigest: request.requestDigest, createdAt: currentTime, updatedAt: currentTime,
        expiresAt: currentTime + receiptTtlMs,
      });
      if (await executionReceiptStore.put(created) === true) {
        reservations += 1;
        return plan(created, request);
      }
      record = await executionReceiptStore.get(request.receiptKey);
    }
    const valid = validateRecord(record, request, currentTime, maxRecordChars);
    if (!valid) {
      blockedAttempts += 1;
      return blocked("execution_receipt_mismatch", "Execution receipt identity or policy does not match the call.");
    }
    if (valid.phase === "completed") replays += 1;
    return plan(valid, request);
  }

  async function authorize(prepared, { arguments: argumentsValue, reviewAudit } = {}) {
    if (!prepared || prepared.status !== "reserved") return prepared;
    const claimId = identifier(createId(), "authorizationClaimId");
    const claimed = await executionReceiptStore.claim(
      prepared.receiptKey, claimId, timestamp() + claimTtlMs,
    );
    const valid = validateRecord(claimed, prepared.request, timestamp(), maxRecordChars);
    if (!valid || valid.phase !== "reserved") {
      if (claimed) await executionReceiptStore.release(prepared.receiptKey, claimId);
      blockedAttempts += 1;
      return blocked("execution_receipt_claim_conflict", "Execution receipt could not be authorized.", true);
    }
    const safeArguments = normalizeJson(argumentsValue, "executionReceipt.authorizedArguments");
    const safeAudit = normalizeJson(reviewAudit, "executionReceipt.reviewAudit");
    const executionDigest = digest({
      runId: valid.runId, callId: valid.callId, toolName: valid.toolName,
      toolRevision: valid.toolRevision, arguments: safeArguments,
    });
    const authorized = Object.freeze({
      ...valid, phase: "authorized", arguments: safeArguments, reviewAudit: safeAudit,
      executionDigest, idempotencyKey: digest({ schema: RECEIPT_SCHEMA, executionDigest }),
      updatedAt: timestamp(),
    });
    if (serializedJsonLength(authorized) > maxRecordChars
      || await executionReceiptStore.replace(prepared.receiptKey, claimId, authorized) !== true) {
      await executionReceiptStore.release(prepared.receiptKey, claimId);
      blockedAttempts += 1;
      return blocked("execution_receipt_authorization_failed", "Execution authorization was not persisted.");
    }
    authorizations += 1;
    return plan(authorized, prepared.request);
  }

  async function claim(prepared) {
    if (prepared?.status === "completed") return prepared;
    if (!prepared || prepared.status !== "authorized") {
      blockedAttempts += 1;
      return blocked("execution_receipt_unauthorized", "Execution receipt is not authorized.");
    }
    const claimId = identifier(createId(), "executionClaimId");
    const record = await executionReceiptStore.claim(
      prepared.receiptKey, claimId, timestamp() + claimTtlMs,
    );
    if (!record) {
      const latest = await prepare(prepared.request);
      if (latest.status === "completed") return latest;
      blockedAttempts += 1;
      return blocked("execution_receipt_active", "Another execution owns this receipt.", true);
    }
    const valid = validateRecord(record, prepared.request, timestamp(), maxRecordChars);
    if (!valid || valid.phase !== "authorized") {
      await executionReceiptStore.release(prepared.receiptKey, claimId);
      blockedAttempts += 1;
      return blocked("execution_receipt_invalid", "Execution receipt is not claimable.");
    }
    executions += 1;
    return Object.freeze({
      status: "execute",
      arguments: valid.arguments,
      execution: Object.freeze({
        schema: RECEIPT_SCHEMA, receiptId: valid.receiptId,
        idempotencyKey: valid.idempotencyKey, requestDigest: valid.executionDigest,
      }),
      fence: Object.freeze({ receiptKey: valid.receiptKey, claimId, record: valid }),
    });
  }

  async function complete(fence, { output, upstreamReceipt } = {}) {
    const record = fence?.record;
    if (!record || record.phase !== "authorized") {
      blockedAttempts += 1;
      return blocked("execution_receipt_invalid", "Execution completion fence is invalid.");
    }
    const upstream = validateUpstreamReceipt(upstreamReceipt, record);
    if (upstream === false) {
      blockedAttempts += 1;
      return blocked("upstream_execution_receipt_invalid", "Mutating execution did not return matching idempotency evidence.", true);
    }
    const completed = Object.freeze({
      ...record, phase: "completed", output: normalizeJson(output, "executionReceipt.output"),
      upstreamReceipt: upstream, updatedAt: timestamp(),
    });
    if (serializedJsonLength(completed) > maxRecordChars
      || await executionReceiptStore.replace(fence.receiptKey, fence.claimId, completed) !== true) {
      blockedAttempts += 1;
      return blocked("execution_receipt_completion_failed", "Execution result was not durably committed.", true);
    }
    completions += 1;
    return plan(completed, Object.freeze({
      runId: record.runId, callId: record.callId, toolName: record.toolName,
      toolRevision: record.toolRevision, riskClass: record.riskClass,
      arguments: record.arguments, requiresUpstreamReceipt: record.requiresUpstreamReceipt,
      receiptKey: record.receiptKey, requestDigest: record.requestDigest,
    }), false);
  }

  async function release(fence) {
    return Boolean(fence && await executionReceiptStore.release(fence.receiptKey, fence.claimId));
  }

  async function abandon(prepared) {
    return Boolean(prepared?.receiptKey && await executionReceiptStore.delete(prepared.receiptKey));
  }

  function stats() {
    const store = typeof executionReceiptStore.stats === "function" ? executionReceiptStore.stats() : {};
    return Object.freeze({
      configured: true, receiptTtlMs, claimTtlMs, reservations, authorizations,
      executions, completions, replays, blockedAttempts, ...store,
    });
  }

  return Object.freeze({ prepare, authorize, claim, complete, release, abandon, stats });
}

export const FUNCTION_EXECUTION_RECEIPT_DEFAULTS = Object.freeze({
  receiptTtlMs: DEFAULT_RECEIPT_TTL_MS,
  claimTtlMs: DEFAULT_CLAIM_TTL_MS,
  maxRecordChars: DEFAULT_MAX_RECORD_CHARS,
});
