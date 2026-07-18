import { normalizeJson, serializedJsonLength } from "./json-contract.js";

const MAX_RECORD_CHARS = 500_000;
const INTERNAL_URL = "https://agent-state.internal/operation";

function identifier(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} must be a non-empty string.`);
  const normalized = value.trim();
  if (normalized.length > 512) throw new RangeError(`${field} exceeds 512 characters.`);
  return normalized;
}

function requireNamespace(namespace) {
  if (!namespace || typeof namespace.idFromName !== "function" || typeof namespace.get !== "function") {
    throw new TypeError("A Durable Object namespace is required.");
  }
  return namespace;
}

function boundedRecord(value, field, maxRecordChars) {
  const record = normalizeJson(value, field);
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new TypeError(`${field} must be an object.`);
  if (!Number.isFinite(record.expiresAt)) throw new TypeError(`${field}.expiresAt must be finite.`);
  if (serializedJsonLength(record) > maxRecordChars) throw new RangeError(`${field} exceeds ${maxRecordChars} characters.`);
  return record;
}

async function operate(namespace, scope, operation, value) {
  const id = namespace.idFromName(identifier(scope, "scope"));
  const stub = namespace.get(id);
  if (!stub || typeof stub.fetch !== "function") throw new TypeError("Durable Object stub is unavailable.");
  const response = await stub.fetch(INTERNAL_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation, value }),
  });
  if (!response || response.ok !== true) throw new TypeError(`Durable state operation ${operation} failed.`);
  const result = await response.json();
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new TypeError(`Durable state operation ${operation} returned invalid evidence.`);
  }
  return result;
}

export function createDurableObjectHumanReviewStore({ namespace, maxRecordChars = MAX_RECORD_CHARS } = {}) {
  const owner = requireNamespace(namespace);
  return Object.freeze({
    async put(value) {
      const record = boundedRecord(value, "reviewRecord", maxRecordChars);
      const result = await operate(owner, `review:${identifier(record.reviewId, "reviewRecord.reviewId")}`, "put", { record });
      return result.stored === true;
    },
    async take(reviewId) {
      const result = await operate(owner, `review:${identifier(reviewId, "reviewId")}`, "take", {});
      return result.record ?? null;
    },
    stats: () => Object.freeze({
      persistence: "durable-object",
      atomicConsume: true,
      pendingReviews: null,
    }),
  });
}

export function createDurableObjectPausedTurnStore({ namespace, maxRecordChars = MAX_RECORD_CHARS } = {}) {
  const owner = requireNamespace(namespace);
  const scope = (conversationId) => `paused-turn:${identifier(conversationId, "conversationId")}`;
  return Object.freeze({
    async put(value) {
      const record = boundedRecord(value, "pausedTurn", maxRecordChars);
      const result = await operate(owner, scope(record.conversationId), "put", { record });
      return result.stored === true;
    },
    async get(conversationId) {
      const result = await operate(owner, scope(conversationId), "get", {});
      return result.record ?? null;
    },
    async claim(conversationId, claimId, claimExpiresAt) {
      const result = await operate(owner, scope(conversationId), "claim", {
        claimId: identifier(claimId, "claimId"),
        claimExpiresAt,
      });
      return result.record ?? null;
    },
    async commit(conversationId, claimId) {
      const result = await operate(owner, scope(conversationId), "commit", { claimId: identifier(claimId, "claimId") });
      return result.committed === true;
    },
    async release(conversationId, claimId) {
      const result = await operate(owner, scope(conversationId), "release", { claimId: identifier(claimId, "claimId") });
      return result.released === true;
    },
    async replace(conversationId, claimId, value) {
      const record = boundedRecord(value, "pausedTurn", maxRecordChars);
      const result = await operate(owner, scope(conversationId), "replace", {
        claimId: identifier(claimId, "claimId"),
        record,
      });
      return result.replaced === true;
    },
    async delete(conversationId) {
      const result = await operate(owner, scope(conversationId), "delete", {});
      return result.deleted === true;
    },
    stats: () => Object.freeze({
      persistence: "durable-object",
      atomicClaims: true,
      recovery: "cross-isolate",
    }),
  });
}

export function createDurableObjectFunctionContinuationStore({
  namespace,
  maxRecordChars = MAX_RECORD_CHARS,
} = {}) {
  const owner = requireNamespace(namespace);
  const scope = (runId) => `function-continuation:${identifier(runId, "runId")}`;
  return Object.freeze({
    async put(value) {
      const record = boundedRecord(value, "functionContinuation", maxRecordChars);
      const result = await operate(owner, scope(record.runId), "put", { record });
      return result.stored === true;
    },
    async get(runId) {
      const result = await operate(owner, scope(runId), "get", {});
      return result.record ?? null;
    },
    async claim(runId, claimId, claimExpiresAt) {
      const result = await operate(owner, scope(runId), "claim", {
        claimId: identifier(claimId, "claimId"),
        claimExpiresAt,
      });
      return result.record ?? null;
    },
    async commit(runId, claimId) {
      const result = await operate(owner, scope(runId), "commit", { claimId: identifier(claimId, "claimId") });
      return result.committed === true;
    },
    async release(runId, claimId) {
      const result = await operate(owner, scope(runId), "release", { claimId: identifier(claimId, "claimId") });
      return result.released === true;
    },
    async replace(runId, claimId, value) {
      const record = boundedRecord(value, "functionContinuation", maxRecordChars);
      const result = await operate(owner, scope(runId), "replace", {
        claimId: identifier(claimId, "claimId"), record,
      });
      return result.replaced === true;
    },
    async delete(runId) {
      const result = await operate(owner, scope(runId), "delete", {});
      return result.deleted === true;
    },
    stats: () => Object.freeze({
      persistence: "durable-object",
      atomicClaims: true,
      recovery: "cross-isolate",
      owner: "function-calling-manager",
    }),
  });
}

export const DURABLE_OBJECT_STATE_DEFAULTS = Object.freeze({ maxRecordChars: MAX_RECORD_CHARS });
