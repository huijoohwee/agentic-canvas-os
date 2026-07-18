import { normalizeJson, serializedJsonLength } from "./json-contract.js";

export const RUNNING_AGENT_DEFAULTS = Object.freeze({
  maxSteps: 12,
  maxHistoryItems: 128,
  maxInputChars: 200_000,
  maxStateChars: 200_000,
  maxOutputChars: 200_000,
  maxEventChars: 32_000,
  maxEvents: 1_024,
  maxConversations: 256,
  timeoutMs: 60_000,
});

export const CONTINUATION_STRATEGIES = Object.freeze([
  "application-history",
  "session",
  "conversation",
  "previous-response",
]);
const CONTINUATION_STRATEGY_SET = new Set(CONTINUATION_STRATEGIES);
export const ADAPTER_EVENT_TYPES = Object.freeze([
  "model_delta",
  "tool_started",
  "tool_completed",
  "handoff_started",
  "handoff_completed",
  "approval_required",
]);
const TRANSITIONS = new Set(["model", "tool", "handoff"]);

export class RunningAgentBlock extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = "RunningAgentBlock";
    this.reasonCode = reasonCode;
  }
}

export function assertPositiveInteger(value, field) {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${field} must be a positive integer.`);
  return value;
}

export function assertIdentifier(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} must be a non-empty string.`);
  const normalized = value.trim();
  if (normalized.length > 512) throw new RangeError(`${field} exceeds 512 characters.`);
  return normalized;
}

export function normalizeBoundedJson(value, field, maxChars) {
  const normalized = normalizeJson(value, field);
  if (serializedJsonLength(normalized) > maxChars) {
    throw new RangeError(`${field} exceeds ${maxChars} serialized characters.`);
  }
  return normalized;
}

function normalizeHistory(value, maxHistoryItems, maxStateChars) {
  if (!Array.isArray(value)) throw new TypeError("continuation.history must be an array.");
  if (value.length > maxHistoryItems) {
    throw new RangeError(`continuation.history exceeds ${maxHistoryItems} items.`);
  }
  return normalizeBoundedJson(value, "continuation.history", maxStateChars);
}

function rejectConflictingContinuationFields(value, allowedFields) {
  const knownFields = ["history", "sessionId", "providerConversationId", "previousResponseId"];
  for (const field of knownFields) {
    if (!allowedFields.has(field) && value[field] !== undefined) {
      throw new TypeError(`continuation.${field} conflicts with continuation.strategy.`);
    }
  }
}

export function normalizeContinuation(value, maxHistoryItems, maxStateChars) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("continuation must be an object.");
  }
  if (!CONTINUATION_STRATEGY_SET.has(value.strategy)) {
    throw new TypeError("continuation.strategy is unsupported.");
  }
  if (value.strategy === "application-history") {
    rejectConflictingContinuationFields(value, new Set(["history"]));
    return Object.freeze({
      strategy: value.strategy,
      history: normalizeHistory(value.history === undefined ? [] : value.history, maxHistoryItems, maxStateChars),
    });
  }
  if (value.strategy === "session") {
    rejectConflictingContinuationFields(value, new Set(["sessionId"]));
    return Object.freeze({ strategy: value.strategy, sessionId: assertIdentifier(value.sessionId, "continuation.sessionId") });
  }
  if (value.strategy === "conversation") {
    rejectConflictingContinuationFields(value, new Set(["providerConversationId"]));
    return Object.freeze({
      strategy: value.strategy,
      providerConversationId: assertIdentifier(value.providerConversationId, "continuation.providerConversationId"),
    });
  }
  rejectConflictingContinuationFields(value, new Set(["previousResponseId"]));
  return Object.freeze({
    strategy: value.strategy,
    ...(value.previousResponseId === undefined
      ? {}
      : { previousResponseId: assertIdentifier(value.previousResponseId, "continuation.previousResponseId") }),
  });
}

export function continuationMatches(expected, received) {
  if (expected.strategy !== received.strategy) return false;
  if (expected.strategy === "application-history") {
    return JSON.stringify(expected.history) === JSON.stringify(received.history);
  }
  if (expected.strategy === "session") return expected.sessionId === received.sessionId;
  if (expected.strategy === "conversation") {
    return expected.providerConversationId === received.providerConversationId;
  }
  return expected.previousResponseId === received.previousResponseId;
}

function nextContinuation(response, current, maxHistoryItems, maxStateChars) {
  if (current.strategy === "application-history") {
    if (!Array.isArray(response.history)) {
      throw new RunningAgentBlock("continuation_missing", "The adapter must return application history after every step.");
    }
    return Object.freeze({
      strategy: current.strategy,
      history: normalizeHistory(response.history, maxHistoryItems, maxStateChars),
    });
  }
  if (current.strategy === "previous-response") {
    return Object.freeze({
      strategy: current.strategy,
      previousResponseId: assertIdentifier(response.responseId, "response.responseId"),
    });
  }
  return current;
}

function normalizeCostLog(value) {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RunningAgentBlock("cost_log_invalid", "costLog must be an object when reported.");
  }
  const result = { model: assertIdentifier(value.model, "costLog.model") };
  for (const field of ["prompt_tokens", "completion_tokens", "cache_hits"]) {
    if (!Number.isInteger(value[field]) || value[field] < 0) {
      throw new RunningAgentBlock("cost_log_invalid", `costLog.${field} must be a non-negative integer.`);
    }
    result[field] = value[field];
  }
  if (!Number.isFinite(value.estimated_cost_usd) || value.estimated_cost_usd < 0) {
    throw new RunningAgentBlock("cost_log_invalid", "costLog.estimated_cost_usd must be non-negative.");
  }
  result.estimated_cost_usd = value.estimated_cost_usd;
  return Object.freeze(result);
}

export function aggregateCosts(logs, attemptedSteps) {
  const reported = logs.filter(Boolean);
  if (attemptedSteps === 0) {
    return Object.freeze({
      status: "not-run",
      model: "not-run",
      prompt_tokens: 0,
      completion_tokens: 0,
      cache_hits: 0,
      estimated_cost_usd: 0,
      reportedSteps: 0,
      unreportedSteps: 0,
    });
  }
  const unreportedSteps = attemptedSteps - reported.length;
  const models = [...new Set(reported.map((log) => log.model))];
  return Object.freeze({
    status: reported.length === 0 ? "unreported" : unreportedSteps === 0 ? "reported" : "partial",
    model: reported.length === 0 ? "unreported" : models.length === 1 ? models[0] : "multiple",
    prompt_tokens: reported.length === 0 ? null : reported.reduce((sum, log) => sum + log.prompt_tokens, 0),
    completion_tokens: reported.length === 0 ? null : reported.reduce((sum, log) => sum + log.completion_tokens, 0),
    cache_hits: reported.length === 0 ? null : reported.reduce((sum, log) => sum + log.cache_hits, 0),
    estimated_cost_usd: reported.length === 0
      ? null
      : reported.reduce((sum, log) => sum + log.estimated_cost_usd, 0),
    reportedSteps: reported.length,
    unreportedSteps,
  });
}

function normalizeInterruptions(value, maxStateChars) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new RunningAgentBlock("pause_invalid", "A paused step must return at least one interruption.");
  }
  const ids = new Set();
  const interruptions = value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new RunningAgentBlock("pause_invalid", `interruptions[${index}] must be an object.`);
    }
    const id = assertIdentifier(item.id, `interruptions[${index}].id`);
    if (ids.has(id)) throw new RunningAgentBlock("pause_invalid", `Duplicate interruption id: ${id}.`);
    ids.add(id);
    return Object.freeze({
      id,
      kind: assertIdentifier(item.kind, `interruptions[${index}].kind`),
      message: assertIdentifier(item.message, `interruptions[${index}].message`),
      ...(item.metadata === undefined
        ? {}
        : { metadata: normalizeBoundedJson(item.metadata, `interruptions[${index}].metadata`, maxStateChars) }),
    });
  });
  return normalizeBoundedJson(interruptions, "interruptions", maxStateChars);
}

export function normalizeAdapterResponse(value, context, limits) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RunningAgentBlock("adapter_response_invalid", "Agent adapter response must be an object.");
  }
  const costLog = normalizeCostLog(value.costLog);
  const continuation = nextContinuation(
    value,
    context.continuation,
    limits.maxHistoryItems,
    limits.maxStateChars,
  );
  if (value.status === "completed") {
    return Object.freeze({
      status: value.status,
      output: normalizeBoundedJson(value.output, "response.output", limits.maxOutputChars),
      continuation,
      costLog,
    });
  }
  if (value.status === "paused") {
    if (value.resumeState === undefined) {
      throw new RunningAgentBlock("pause_invalid", "A paused step must return opaque resume state.");
    }
    return Object.freeze({
      status: value.status,
      interruptions: normalizeInterruptions(value.interruptions, limits.maxStateChars),
      resumeState: normalizeBoundedJson(value.resumeState, "response.resumeState", limits.maxStateChars),
      continuation,
      costLog,
    });
  }
  if (value.status !== "continue" || !TRANSITIONS.has(value.transition)) {
    throw new RunningAgentBlock("adapter_response_invalid", "Agent adapter must complete, pause, or return a known continuation transition.");
  }
  return Object.freeze({
    status: value.status,
    transition: value.transition,
    agent: value.transition === "handoff"
      ? assertIdentifier(value.agent, "response.agent")
      : context.agent,
    nextInput: normalizeBoundedJson(value.nextInput, "response.nextInput", limits.maxInputChars),
    continuation,
    costLog,
  });
}

export function createEventChannel() {
  const queued = [];
  const waiters = [];
  let closed = false;
  return Object.freeze({
    publish(event) {
      if (closed) return;
      const waiter = waiters.shift();
      if (waiter) waiter({ value: event, done: false });
      else queued.push(event);
    },
    close() {
      closed = true;
      while (waiters.length > 0) waiters.shift()({ value: undefined, done: true });
    },
    events: Object.freeze({
      [Symbol.asyncIterator]() { return this; },
      next() {
        if (queued.length > 0) return Promise.resolve({ value: queued.shift(), done: false });
        if (closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => waiters.push(resolve));
      },
    }),
  });
}

export function withDeadline(operation, externalSignal, timeoutMs, controller) {
  return new Promise((resolve, reject) => {
    if (externalSignal?.aborted) {
      controller.abort();
      reject(new RunningAgentBlock("aborted", "Agent turn was aborted."));
      return;
    }
    const timer = setTimeout(() => {
      controller.abort();
      reject(new RunningAgentBlock("timeout", `Agent step exceeded ${timeoutMs} milliseconds.`));
    }, timeoutMs);
    const onAbort = () => {
      controller.abort();
      reject(new RunningAgentBlock("aborted", "Agent turn was aborted."));
    };
    externalSignal?.addEventListener("abort", onAbort, { once: true });
    Promise.resolve().then(operation).then(resolve, reject).finally(() => {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onAbort);
    });
  });
}

export function defaultResumeToken() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  throw new RunningAgentBlock("resume_token_unavailable", "A secure resume-token generator is required.");
}
