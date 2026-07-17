const DEFAULT_MAX_THREADS = 32;
const DEFAULT_MAX_TURNS_PER_THREAD = 64;
const MAX_INVARIANT_ITEMS = 32;
const MAX_INVARIANT_ITEM_CHARS = 2_000;

const EFFECTIVE_CONTEXTS = new Set(["unreported", "current_turn", "all_turns"]);
const REQUEST_CONTEXTS = new Set(["current_turn", "all_turns"]);

function assertPositiveInteger(value, field) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`${field} must be a positive integer.`);
  }
  return value;
}

function assertIdentifier(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${field} must be a non-empty string.`);
  }
  const normalized = value.trim();
  if (normalized.length > 512) throw new RangeError(`${field} exceeds 512 characters.`);
  return normalized;
}

function normalizeInvariantList(value, field, { required = false } = {}) {
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array.`);
  if (required && value.length === 0) throw new TypeError(`${field} must not be empty.`);
  if (value.length > MAX_INVARIANT_ITEMS) {
    throw new RangeError(`${field} must contain at most ${MAX_INVARIANT_ITEMS} items.`);
  }
  return Object.freeze(value.map((item, index) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new TypeError(`${field}[${index}] must be a non-empty string.`);
    }
    const normalized = item.trim();
    if (normalized.length > MAX_INVARIANT_ITEM_CHARS) {
      throw new RangeError(`${field}[${index}] exceeds ${MAX_INVARIANT_ITEM_CHARS} characters.`);
    }
    return normalized;
  }));
}

function normalizeCapabilities(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("capabilities must be an object.");
  }
  if (typeof value.previousResponseId !== "boolean") {
    throw new TypeError("capabilities.previousResponseId must be boolean.");
  }
  if (!Array.isArray(value.reasoningContexts)) {
    throw new TypeError("capabilities.reasoningContexts must be an array.");
  }
  for (const context of value.reasoningContexts) {
    if (!REQUEST_CONTEXTS.has(context)) {
      throw new TypeError(`Unsupported reasoning context capability: ${String(context)}.`);
    }
  }
  return Object.freeze({
    previousResponseId: value.previousResponseId,
    reasoningContexts: Object.freeze([...new Set(value.reasoningContexts)]),
  });
}

function normalizeInvariants({ goals, assumptions = [], priorities }) {
  const value = Object.freeze({
    goals: normalizeInvariantList(goals, "goals", { required: true }),
    assumptions: normalizeInvariantList(assumptions, "assumptions"),
    priorities: normalizeInvariantList(priorities, "priorities", { required: true }),
  });
  return Object.freeze({ value, fingerprint: JSON.stringify(value) });
}

function publicRequest({ entry, status, stable, requestedContext, previousResponseIdUsed, requestPatch }) {
  return Object.freeze({
    turnToken: entry.pending.turnToken,
    status,
    stable,
    requestedContext,
    previousResponseIdUsed,
    requestPatch: Object.freeze(requestPatch),
    providerEffectiveContext: "unverified",
  });
}

export function createReasoningContinuityRegistry({
  maxThreads = DEFAULT_MAX_THREADS,
  maxTurnsPerThread = DEFAULT_MAX_TURNS_PER_THREAD,
} = {}) {
  assertPositiveInteger(maxThreads, "maxThreads");
  assertPositiveInteger(maxTurnsPerThread, "maxTurnsPerThread");

  const threads = new Map();
  let sequence = 0;
  let startedTurns = 0;
  let completedTurns = 0;
  let preservedRequests = 0;
  let resetRequests = 0;
  let unsupportedRequests = 0;
  let confirmedAllTurns = 0;
  let evictionCount = 0;

  function touch(threadId, entry) {
    threads.delete(threadId);
    threads.set(threadId, entry);
  }

  function ensureCapacity() {
    if (threads.size < maxThreads) return;
    for (const [threadId, entry] of threads) {
      if (entry.pending) continue;
      threads.delete(threadId);
      evictionCount += 1;
      return;
    }
    throw new Error("Reasoning continuity capacity is occupied by active turns; complete or abort one before retrying.");
  }

  function begin({ threadId, goals, assumptions, priorities, capabilities } = {}) {
    const safeThreadId = assertIdentifier(threadId, "threadId");
    const invariantState = normalizeInvariants({ goals, assumptions, priorities });
    const supported = normalizeCapabilities(capabilities);
    let entry = threads.get(safeThreadId);

    if (entry && entry.pending) throw new Error("A reasoning turn is already active for this thread.");
    if (entry && entry.turns >= maxTurnsPerThread) {
      throw new Error("Reasoning continuity turn limit reached; invalidate the thread before continuing.");
    }
    if (!entry) {
      ensureCapacity();
      entry = { turns: 0, fingerprint: "", lastResponseId: "", pending: null };
      threads.set(safeThreadId, entry);
    }

    const hasCompletedTurn = Boolean(entry.lastResponseId);
    const stable = hasCompletedTurn && entry.fingerprint === invariantState.fingerprint;
    const canChain = hasCompletedTurn && supported.previousResponseId;
    const supportsCurrentTurn = supported.reasoningContexts.includes("current_turn");
    const supportsAllTurns = supported.reasoningContexts.includes("all_turns");
    const requestPatch = {};
    if (canChain) requestPatch.previous_response_id = entry.lastResponseId;

    let status = "first_turn";
    let requestedContext = "omitted";
    if (stable && canChain && supportsAllTurns) {
      status = "preserved";
      requestedContext = "all_turns";
      requestPatch.reasoning = Object.freeze({ context: "all_turns" });
      preservedRequests += 1;
    } else if (hasCompletedTurn && (!supported.previousResponseId || (stable && !supportsAllTurns))) {
      status = "unsupported";
      unsupportedRequests += 1;
      if (supportsCurrentTurn) {
        requestedContext = "current_turn";
        requestPatch.reasoning = Object.freeze({ context: "current_turn" });
      }
    } else if (hasCompletedTurn && !stable) {
      status = "reset";
      resetRequests += 1;
      if (supportsCurrentTurn) {
        requestedContext = "current_turn";
        requestPatch.reasoning = Object.freeze({ context: "current_turn" });
      }
    } else if (supportsCurrentTurn) {
      requestedContext = "current_turn";
      requestPatch.reasoning = Object.freeze({ context: "current_turn" });
    }

    sequence += 1;
    entry.pending = {
      turnToken: `reasoning_turn_${sequence}`,
      fingerprint: invariantState.fingerprint,
      requestedContext,
    };
    startedTurns += 1;
    touch(safeThreadId, entry);
    return publicRequest({
      entry,
      status,
      stable,
      requestedContext,
      previousResponseIdUsed: canChain,
      requestPatch,
    });
  }

  function complete({ threadId, turnToken, responseId, effectiveContext = "unreported" } = {}) {
    const safeThreadId = assertIdentifier(threadId, "threadId");
    const safeTurnToken = assertIdentifier(turnToken, "turnToken");
    const safeResponseId = assertIdentifier(responseId, "responseId");
    if (!EFFECTIVE_CONTEXTS.has(effectiveContext)) {
      throw new TypeError("effectiveContext must be unreported, current_turn, or all_turns.");
    }
    const entry = threads.get(safeThreadId);
    if (!entry || !entry.pending || entry.pending.turnToken !== safeTurnToken) {
      throw new Error("Reasoning turn is missing, stale, or already completed.");
    }
    if (effectiveContext === "all_turns" && entry.pending.requestedContext !== "all_turns") {
      throw new Error("Provider all_turns confirmation does not match the requested reasoning context.");
    }

    entry.fingerprint = entry.pending.fingerprint;
    entry.lastResponseId = safeResponseId;
    entry.pending = null;
    entry.turns += 1;
    completedTurns += 1;
    if (effectiveContext === "all_turns") confirmedAllTurns += 1;
    touch(safeThreadId, entry);
    return Object.freeze({
      threadId: safeThreadId,
      turns: entry.turns,
      responseIdStored: true,
      providerEffectiveContext: effectiveContext,
      providerContinuityConfirmed: effectiveContext === "all_turns",
    });
  }

  function abort({ threadId, turnToken } = {}) {
    const safeThreadId = assertIdentifier(threadId, "threadId");
    const safeTurnToken = assertIdentifier(turnToken, "turnToken");
    const entry = threads.get(safeThreadId);
    if (!entry || !entry.pending || entry.pending.turnToken !== safeTurnToken) return false;
    entry.pending = null;
    if (entry.turns === 0) threads.delete(safeThreadId);
    else touch(safeThreadId, entry);
    return true;
  }

  function invalidate({ threadId } = {}) {
    const safeThreadId = assertIdentifier(threadId, "threadId");
    const entry = threads.get(safeThreadId);
    if (!entry) return false;
    if (entry.pending) throw new Error("Abort or complete the active reasoning turn before invalidating its thread.");
    return threads.delete(safeThreadId);
  }

  function stats() {
    return Object.freeze({
      threads: threads.size,
      maxThreads,
      maxTurnsPerThread,
      startedTurns,
      completedTurns,
      preservedRequests,
      resetRequests,
      unsupportedRequests,
      confirmedAllTurns,
      evictionCount,
    });
  }

  return Object.freeze({ begin, complete, abort, invalidate, stats });
}

export const REASONING_CONTINUITY_DEFAULTS = Object.freeze({
  maxThreads: DEFAULT_MAX_THREADS,
  maxTurnsPerThread: DEFAULT_MAX_TURNS_PER_THREAD,
});
