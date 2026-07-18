import {
  ADAPTER_EVENT_TYPES,
  CONTINUATION_STRATEGIES,
  RUNNING_AGENT_DEFAULTS,
  RunningAgentBlock,
  aggregateCosts,
  assertIdentifier,
  assertPositiveInteger,
  continuationMatches,
  createEventChannel,
  defaultResumeToken,
  normalizeAdapterResponse,
  normalizeBoundedJson,
  normalizeCostLog,
  normalizeContinuation,
  withDeadline,
} from "./running-agent-contract.js";

const DEFAULT_PAUSED_TURN_TTL_MS = 86_400_000;
const DEFAULT_PAUSED_TURN_CLAIM_TTL_MS = 60_000;
const DEFAULT_MAX_PAUSED_TURN_CHARS = 450_000;
const PAUSED_TURN_SCHEMA = "running-agent-paused-turn/v1";

function assertOwner(value, methods, field) {
  if (value === undefined) return;
  if (!value || typeof value !== "object") throw new TypeError(`${field} must be an object when provided.`);
  for (const method of methods) {
    if (typeof value[method] !== "function") throw new TypeError(`${field}.${method} must be a function.`);
  }
}

function assertNonNegativeInteger(value, field) {
  if (!Number.isInteger(value) || value < 0) throw new TypeError(`${field} must be a non-negative integer.`);
  return value;
}

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

export function createRunningAgentRuntime({
  advanceAgent,
  createResumeToken = defaultResumeToken,
  createClaimId = defaultResumeToken,
  pausedTurnStore,
  now = Date.now,
  pausedTurnTtlMs = DEFAULT_PAUSED_TURN_TTL_MS,
  pausedTurnClaimTtlMs = DEFAULT_PAUSED_TURN_CLAIM_TTL_MS,
  maxPausedTurnChars = DEFAULT_MAX_PAUSED_TURN_CHARS,
  maxSteps = RUNNING_AGENT_DEFAULTS.maxSteps,
  maxHistoryItems = RUNNING_AGENT_DEFAULTS.maxHistoryItems,
  maxInputChars = RUNNING_AGENT_DEFAULTS.maxInputChars,
  maxStateChars = RUNNING_AGENT_DEFAULTS.maxStateChars,
  maxOutputChars = RUNNING_AGENT_DEFAULTS.maxOutputChars,
  maxEventChars = RUNNING_AGENT_DEFAULTS.maxEventChars,
  maxEvents = RUNNING_AGENT_DEFAULTS.maxEvents,
  maxConversations = RUNNING_AGENT_DEFAULTS.maxConversations,
  timeoutMs = RUNNING_AGENT_DEFAULTS.timeoutMs,
} = {}) {
  const limits = {
    maxSteps,
    maxHistoryItems,
    maxInputChars,
    maxStateChars,
    maxOutputChars,
    maxEventChars,
    maxEvents,
    maxConversations,
    timeoutMs,
    pausedTurnTtlMs,
    pausedTurnClaimTtlMs,
    maxPausedTurnChars,
  };
  for (const [field, value] of Object.entries(limits)) assertPositiveInteger(value, field);
  if (typeof createResumeToken !== "function") throw new TypeError("createResumeToken must be a function.");
  if (typeof createClaimId !== "function") throw new TypeError("createClaimId must be a function.");
  if (typeof now !== "function") throw new TypeError("now must be a function.");
  assertOwner(pausedTurnStore, ["put", "get", "claim", "commit", "release", "replace", "delete"], "pausedTurnStore");

  const adapterConfigured = typeof advanceAgent === "function";
  const conversations = new Map();
  const activeRunIds = new Set();
  const recentRunIds = new Map();
  let completedTurns = 0;
  let pausedTurns = 0;
  let blockedTurns = 0;
  let resumedTurns = 0;
  let adapterSteps = 0;
  let loopEvents = 0;

  function pausedTurnSnapshot(context, paused) {
    const createdAt = now();
    if (!Number.isFinite(createdAt)) throw new RunningAgentBlock("paused_state_invalid", "Paused-turn clock is invalid.");
    return normalizeBoundedJson({
      schema: PAUSED_TURN_SCHEMA,
      runId: context.runId,
      conversationId: context.conversationId,
      resumeToken: paused.resumeToken,
      resumeState: paused.resumeState,
      interruptions: paused.interruptions,
      expiresAt: createdAt + pausedTurnTtlMs,
      context: {
        agent: context.agent,
        input: context.input,
        continuation: context.continuation,
        turn: context.turn,
        step: context.step,
        attemptedSteps: context.attemptedSteps,
        emittedEvents: context.emittedEvents,
        transitions: context.transitions,
        agents: [...context.agents],
        costLogs: context.costLogs,
      },
    }, "pausedTurn", maxPausedTurnChars);
  }

  function restorePausedTurn(value) {
    const paused = normalizeBoundedJson(value, "pausedTurn", maxPausedTurnChars);
    if (!exactKeys(paused, ["schema", "runId", "conversationId", "resumeToken", "resumeState", "interruptions", "expiresAt", "context"])
      || paused.schema !== PAUSED_TURN_SCHEMA) {
      throw new RunningAgentBlock("paused_state_invalid", "Paused-turn state schema is invalid.");
    }
    const currentTime = now();
    if (!Number.isFinite(currentTime) || !Number.isFinite(paused.expiresAt) || paused.expiresAt <= currentTime) {
      throw new RunningAgentBlock("paused_state_expired", "Paused-turn state has expired.");
    }
    const context = paused.context;
    if (!exactKeys(context, ["agent", "input", "continuation", "turn", "step", "attemptedSteps", "emittedEvents", "transitions", "agents", "costLogs"])) {
      throw new RunningAgentBlock("paused_state_invalid", "Paused-turn execution context is invalid.");
    }
    if (!exactKeys(context.transitions, ["model", "tool", "handoff"])) {
      throw new RunningAgentBlock("paused_state_invalid", "Paused-turn transition evidence is invalid.");
    }
    const agents = Array.isArray(context.agents)
      ? context.agents.map((agent, index) => assertIdentifier(agent, `pausedTurn.context.agents[${index}]`))
      : null;
    if (!agents || agents.length === 0 || !Array.isArray(context.costLogs)) {
      throw new RunningAgentBlock("paused_state_invalid", "Paused-turn evidence is invalid.");
    }
    return {
      runId: assertIdentifier(paused.runId, "pausedTurn.runId"),
      conversationId: assertIdentifier(paused.conversationId, "pausedTurn.conversationId"),
      resumeToken: assertIdentifier(paused.resumeToken, "pausedTurn.resumeToken"),
      resumeState: paused.resumeState,
      interruptions: paused.interruptions,
      expiresAt: paused.expiresAt,
      context: {
        runId: paused.runId,
        conversationId: paused.conversationId,
        agent: assertIdentifier(context.agent, "pausedTurn.context.agent"),
        input: normalizeBoundedJson(context.input, "pausedTurn.context.input", maxInputChars),
        continuation: normalizeContinuation(context.continuation, maxHistoryItems, maxStateChars),
        turn: assertPositiveInteger(context.turn, "pausedTurn.context.turn"),
        step: assertPositiveInteger(context.step, "pausedTurn.context.step"),
        attemptedSteps: assertPositiveInteger(context.attemptedSteps, "pausedTurn.context.attemptedSteps"),
        emittedEvents: assertNonNegativeInteger(context.emittedEvents, "pausedTurn.context.emittedEvents"),
        transitions: {
          model: assertNonNegativeInteger(context.transitions.model, "pausedTurn.context.transitions.model"),
          tool: assertNonNegativeInteger(context.transitions.tool, "pausedTurn.context.transitions.tool"),
          handoff: assertNonNegativeInteger(context.transitions.handoff, "pausedTurn.context.transitions.handoff"),
        },
        agents: new Set(agents),
        costLogs: context.costLogs.map((costLog) => normalizeCostLog(costLog)),
        isResume: true,
        resume: undefined,
        acceptingEvents: false,
      },
    };
  }

  function touchConversation(conversationId, record) {
    conversations.delete(conversationId);
    conversations.set(conversationId, record);
  }

  function reserveConversationSlot() {
    while (conversations.size >= maxConversations) {
      const evictable = [...conversations.entries()].find(([, record]) => record.status === "idle");
      if (!evictable) throw new RunningAgentBlock("conversation_capacity", "No inactive conversation slot is available.");
      conversations.delete(evictable[0]);
    }
  }

  function rememberRunId(runId) {
    recentRunIds.delete(runId);
    recentRunIds.set(runId, true);
    while (recentRunIds.size > maxConversations * 4) recentRunIds.delete(recentRunIds.keys().next().value);
  }

  function createEmitter(context, channel) {
    const emit = (type, payload, adapterOwned = false) => {
      // An adapter may ignore abort; settlement seals evidence against late callbacks.
      if (!context.acceptingEvents) return;
      if (adapterOwned && !ADAPTER_EVENT_TYPES.includes(type)) {
        throw new RunningAgentBlock("stream_event_invalid", `Adapter event type ${String(type)} is unsupported.`);
      }
      if (context.emittedEvents >= maxEvents) {
        throw new RunningAgentBlock("stream_event_limit", `Agent turn exceeds ${maxEvents} events.`);
      }
      context.emittedEvents += 1;
      let safePayload;
      try {
        safePayload = normalizeBoundedJson(payload, `event.${type}`, maxEventChars);
      } catch (error) {
        throw new RunningAgentBlock(
          error instanceof RangeError ? "stream_event_limit" : "stream_event_invalid",
          `Adapter event payload is invalid: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const event = Object.freeze({
        type,
        sequence: context.emittedEvents,
        runId: context.runId,
        conversationId: context.conversationId,
        turn: context.turn,
        step: context.step,
        payload: safePayload,
      });
      loopEvents += 1;
      channel?.publish(event);
    };
    return Object.freeze({
      runtime: (type, payload) => emit(type, payload, false),
      adapter: (event) => {
        if (!event || typeof event !== "object" || Array.isArray(event)) {
          throw new RunningAgentBlock("stream_event_invalid", "Adapter events must be objects.");
        }
        emit(event.type, event.payload ?? {}, true);
      },
    });
  }

  function evidence(context) {
    return Object.freeze({
      steps: context.attemptedSteps,
      modelTransitions: context.transitions.model,
      toolTransitions: context.transitions.tool,
      handoffs: context.transitions.handoff,
      agents: Object.freeze([...context.agents]),
      events: context.emittedEvents,
    });
  }

  function resultBase(context) {
    return {
      runId: context.runId,
      conversationId: context.conversationId,
      turn: context.turn,
      agent: context.agent,
      continuation: context.continuation,
      costLog: aggregateCosts(context.costLogs, context.attemptedSteps),
      evidence: evidence(context),
    };
  }

  function blockedResult(context, stage, reasonCode, message) {
    return Object.freeze({
      ...resultBase(context),
      status: "blocked",
      stage,
      reasonCode,
      message,
    });
  }

  async function drive(context, record, signal, channel, durableClaim) {
    const controller = new AbortController();
    const emitter = createEmitter(context, channel);
    activeRunIds.add(context.runId);
    record.status = "active";
    context.acceptingEvents = true;
    let durableClaimSettled = false;
    touchConversation(context.conversationId, record);
    emitter.runtime(context.isResume ? "turn_resumed" : "turn_started", {
      agent: context.agent,
      continuationStrategy: context.continuation.strategy,
    });

    try {
      while (context.step <= maxSteps) {
        context.attemptedSteps += 1;
        adapterSteps += 1;
        let rawResponse;
        try {
          rawResponse = await withDeadline(
            () => advanceAgent({
              runId: context.runId,
              conversationId: context.conversationId,
              turn: context.turn,
              step: context.step,
              agent: context.agent,
              input: context.input,
              continuation: context.continuation,
              ...(context.resume === undefined ? {} : { resume: context.resume }),
              signal: controller.signal,
              emit: emitter.adapter,
            }),
            signal,
            timeoutMs,
            controller,
          );
        } catch (error) {
          if (error instanceof RunningAgentBlock) throw error;
          throw new RunningAgentBlock("adapter_failed", `Agent adapter failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        context.resume = undefined;
        let response;
        try {
          response = normalizeAdapterResponse(rawResponse, context, limits);
        } catch (error) {
          if (error instanceof RunningAgentBlock) throw error;
          throw new RunningAgentBlock(
            "adapter_response_invalid",
            `Agent adapter returned an invalid response: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        context.costLogs.push(response.costLog);
        context.continuation = response.continuation;
        record.continuation = response.continuation;

        if (response.status === "completed") {
          if (durableClaim && await pausedTurnStore.commit(context.conversationId, durableClaim.claimId) !== true) {
            throw new RunningAgentBlock("paused_state_commit_failed", "Paused-turn recovery could not be committed.");
          }
          durableClaimSettled = Boolean(durableClaim);
          record.status = "idle";
          record.turn = context.turn;
          record.paused = null;
          completedTurns += 1;
          emitter.runtime("turn_completed", { agent: context.agent, status: "completed" });
          return Object.freeze({ ...resultBase(context), status: "completed", output: response.output });
        }
        if (response.status === "paused") {
          let resumeToken;
          try {
            resumeToken = assertIdentifier(createResumeToken(), "resumeToken");
          } catch (error) {
            if (error instanceof RunningAgentBlock) throw error;
            throw new RunningAgentBlock(
              "resume_token_invalid",
              `Resume-token generation failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          const paused = {
            runId: context.runId,
            resumeToken,
            resumeState: response.resumeState,
            interruptions: response.interruptions,
            context,
          };
          if (context.emittedEvents >= maxEvents) {
            throw new RunningAgentBlock("stream_event_limit", `Agent turn exceeds ${maxEvents} events.`);
          }
          if (pausedTurnStore) {
            const snapshot = pausedTurnSnapshot(context, paused);
            const stored = durableClaim
              ? await pausedTurnStore.replace(context.conversationId, durableClaim.claimId, snapshot)
              : await pausedTurnStore.put(snapshot);
            if (stored !== true) {
              throw new RunningAgentBlock("paused_state_conflict", "Paused-turn state could not be stored atomically.");
            }
            durableClaimSettled = Boolean(durableClaim);
          }
          record.status = "paused";
          record.turn = context.turn;
          record.paused = paused;
          pausedTurns += 1;
          emitter.runtime("turn_paused", { interruptionCount: response.interruptions.length });
          return Object.freeze({
            ...resultBase(context),
            status: "paused",
            resumeToken,
            interruptions: response.interruptions,
          });
        }

        context.transitions[response.transition] += 1;
        context.input = response.nextInput;
        context.agent = response.agent;
        context.agents.add(response.agent);
        emitter.runtime("step_completed", { transition: response.transition, agent: response.agent });
        context.step += 1;
      }
      throw new RunningAgentBlock("step_limit", `Agent turn exceeds ${maxSteps} steps.`);
    } catch (error) {
      if (durableClaim && !durableClaimSettled) {
        try {
          await pausedTurnStore.release(context.conversationId, durableClaim.claimId);
        } catch {
          // Preserve the original bounded failure; the claim expires independently.
        }
      }
      const reasonCode = error instanceof RunningAgentBlock ? error.reasonCode : "runtime_failed";
      const message = error instanceof Error ? error.message : String(error);
      record.status = "blocked";
      record.turn = context.turn;
      record.paused = null;
      blockedTurns += 1;
      try {
        emitter.runtime("turn_blocked", { reasonCode });
      } catch {
        // Preserve the first bounded failure when the event channel itself caused it.
      }
      return blockedResult(context, "agent-loop", reasonCode, message);
    } finally {
      activeRunIds.delete(context.runId);
      context.acceptingEvents = false;
      controller.abort();
      touchConversation(context.conversationId, record);
    }
  }

  function normalizeRunRequest(request = {}) {
    const runId = assertIdentifier(request.runId, "runId");
    const conversationId = assertIdentifier(request.conversationId, "conversationId");
    return Object.freeze({
      runId,
      conversationId,
      agent: assertIdentifier(request.agent, "agent"),
      input: normalizeBoundedJson(request.input, "input", maxInputChars),
      continuation: normalizeContinuation(request.continuation, maxHistoryItems, maxStateChars),
      signal: request.signal,
    });
  }

  async function start(request, channel) {
    const safe = normalizeRunRequest(request);
    const emptyContext = {
      ...safe,
      turn: 0,
      step: 1,
      attemptedSteps: 0,
      emittedEvents: 0,
      transitions: { model: 0, tool: 0, handoff: 0 },
      agents: new Set([safe.agent]),
      costLogs: [],
      isResume: false,
      resume: undefined,
      acceptingEvents: false,
    };
    if (!adapterConfigured) {
      blockedTurns += 1;
      return blockedResult(emptyContext, "configure", "runtime_unconfigured", "An agent-step adapter is required.");
    }
    if (activeRunIds.has(safe.runId)) {
      blockedTurns += 1;
      return blockedResult(emptyContext, "serialize", "run_active", "A run with this id is already active.");
    }
    if (recentRunIds.has(safe.runId)) {
      blockedTurns += 1;
      return blockedResult(emptyContext, "identity", "run_reused", "A recent run already used this id.");
    }

    let record = conversations.get(safe.conversationId);
    if (record?.status === "active") {
      blockedTurns += 1;
      return blockedResult(emptyContext, "serialize", "conversation_active", "This conversation already has an active turn.");
    }
    if (record?.status === "paused") {
      blockedTurns += 1;
      return blockedResult(emptyContext, "resume", "conversation_paused", "Resume or clear the paused turn before starting another.");
    }
    if (record?.status === "blocked") {
      blockedTurns += 1;
      return blockedResult(emptyContext, "recover", "conversation_blocked", "Clear the blocked conversation before starting another turn.");
    }
    if (!record && pausedTurnStore) {
      try {
        if (await pausedTurnStore.get(safe.conversationId)) {
          blockedTurns += 1;
          return blockedResult(emptyContext, "resume", "conversation_paused", "Resume or clear the paused turn before starting another.");
        }
      } catch {
        blockedTurns += 1;
        return blockedResult(emptyContext, "resume", "paused_state_unavailable", "Paused-turn state could not be checked.");
      }
    }
    if (record && !continuationMatches(record.continuation, safe.continuation)) {
      blockedTurns += 1;
      return blockedResult(emptyContext, "continuation", "continuation_mismatch", "Continuation strategy or state changed for this conversation.");
    }
    if (!record) {
      try {
        reserveConversationSlot();
      } catch (error) {
        if (!(error instanceof RunningAgentBlock)) throw error;
        blockedTurns += 1;
        return blockedResult(emptyContext, "capacity", error.reasonCode, error.message);
      }
      record = { status: "idle", turn: 0, continuation: safe.continuation, paused: null };
      conversations.set(safe.conversationId, record);
    }
    rememberRunId(safe.runId);
    emptyContext.turn = record.turn + 1;
    return drive(emptyContext, record, safe.signal, channel);
  }

  async function resume(request = {}, channel) {
    const runId = assertIdentifier(request.runId, "runId");
    const conversationId = assertIdentifier(request.conversationId, "conversationId");
    const resumeToken = assertIdentifier(request.resumeToken, "resumeToken");
    const resolution = normalizeBoundedJson(request.resolution, "resolution", maxStateChars);
    let record = conversations.get(conversationId);
    let paused = record?.status === "paused" ? record.paused : null;
    let durableClaim;
    if (pausedTurnStore) {
      if (record?.status === "active") throw new TypeError("The paused turn is already being resumed.");
      const claimId = assertIdentifier(createClaimId(), "claimId");
      const claimedAt = now();
      if (!Number.isFinite(claimedAt)) throw new TypeError("now must return a finite timestamp.");
      const stored = await pausedTurnStore.claim(conversationId, claimId, claimedAt + pausedTurnClaimTtlMs);
      if (!stored) throw new TypeError("The conversation has no resumable paused turn.");
      try {
        paused = restorePausedTurn(stored);
        if (paused.runId !== runId || paused.resumeToken !== resumeToken || paused.conversationId !== conversationId) {
          throw new TypeError("Resume identity or token does not match the paused turn.");
        }
      } catch (error) {
        await pausedTurnStore.release(conversationId, claimId);
        throw error;
      }
      durableClaim = { claimId };
      record = {
        status: "paused",
        turn: paused.context.turn,
        continuation: paused.context.continuation,
        paused,
      };
      conversations.set(conversationId, record);
    }
    if (!paused || !record || record.status !== "paused") {
      throw new TypeError("The conversation has no paused turn to resume.");
    }
    if (paused.runId !== runId || paused.resumeToken !== resumeToken) {
      throw new TypeError("Resume identity or token does not match the paused turn.");
    }
    const context = paused.context;
    context.isResume = true;
    context.resume = Object.freeze({ state: paused.resumeState, resolution });
    context.step += 1;
    record.paused = null;
    resumedTurns += 1;
    return drive(context, record, request.signal, channel, durableClaim);
  }

  function streamOperation(operation, request) {
    const channel = createEventChannel();
    const streamController = new AbortController();
    const onAbort = () => streamController.abort();
    if (request?.signal?.aborted) streamController.abort();
    else request?.signal?.addEventListener("abort", onAbort, { once: true });
    const completed = operation({ ...request, signal: streamController.signal }, channel).finally(() => {
      request?.signal?.removeEventListener("abort", onAbort);
      channel.close();
    });
    return Object.freeze({
      events: channel.events,
      completed,
      cancel: () => streamController.abort(),
    });
  }

  return Object.freeze({
    run: (request) => start(request),
    resume: (request) => resume(request),
    stream: (request) => streamOperation(start, request),
    resumeStream: (request) => streamOperation(resume, request),
    async clearConversation(conversationId) {
      const safeConversationId = assertIdentifier(conversationId, "conversationId");
      const record = conversations.get(safeConversationId);
      if (record?.status === "active") throw new TypeError("An active conversation cannot be cleared.");
      const deletedLocal = conversations.delete(safeConversationId);
      const deletedDurable = pausedTurnStore ? await pausedTurnStore.delete(safeConversationId) : false;
      return deletedLocal || deletedDurable;
    },
    stats: () => Object.freeze({
      adapterConfigured,
      pausedTurnStoreConfigured: Boolean(pausedTurnStore),
      continuationStrategies: Object.freeze([...CONTINUATION_STRATEGIES]),
      activeRuns: activeRunIds.size,
      conversations: conversations.size,
      pausedConversations: [...conversations.values()].filter((record) => record.status === "paused").length,
      blockedConversations: [...conversations.values()].filter((record) => record.status === "blocked").length,
      completedTurns,
      pausedTurns,
      resumedTurns,
      blockedTurns,
      adapterSteps,
      loopEvents,
      ...limits,
      ...(typeof pausedTurnStore?.stats === "function" ? pausedTurnStore.stats() : { persistence: "isolate-memory" }),
    }),
  });
}
