import { createRunningAgentRuntime } from "./running-agents.js";

const DEFAULT_MAX_CONVERSATIONS = 256;
const CONTINUATION_STRATEGIES = new Set([
  "application-history",
  "session",
  "conversation",
  "previous-response",
]);

function assertIdentifier(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} must be a non-empty string.`);
  const normalized = value.trim();
  if (normalized.length > 256) throw new RangeError(`${field} exceeds 256 characters.`);
  return normalized;
}

function assertPositiveInteger(value, field) {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${field} must be a positive integer.`);
  return value;
}

function assertOwner(value, methods, field) {
  if (value === undefined) return;
  if (!value || typeof value !== "object") throw new TypeError(`${field} must be an object when provided.`);
  for (const method of methods) {
    if (typeof value[method] !== "function") throw new TypeError(`${field}.${method} must be a function.`);
  }
}

function normalizeRequirements(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("requirements must be an object.");
  }
  const unknown = Object.keys(value).filter((key) => !["features", "delivery", "connection"].includes(key));
  if (unknown.length) throw new TypeError(`requirements contains unsupported fields: ${unknown.join(", ")}.`);
  if (value.features !== undefined && !Array.isArray(value.features)) {
    throw new TypeError("requirements.features must be an array.");
  }
  const features = (value.features || []).map((feature, index) => assertIdentifier(feature, `requirements.features[${index}]`));
  return Object.freeze({
    features: Object.freeze([...new Set(features)]),
    ...(value.delivery === undefined ? {} : { delivery: value.delivery }),
    ...(value.connection === undefined ? {} : { connection: value.connection }),
  });
}

function requirementsFor(preparedAgent, configured) {
  const features = new Set(configured.features);
  if (
    preparedAgent.behavior.tools.length
    || preparedAgent.behavior.mcpServers.length
    || preparedAgent.behavior.handoffs.length
  ) features.add("tools");
  if (preparedAgent.behavior.output.mode === "structured") features.add("structured-output");
  return Object.freeze({
    features: Object.freeze([...features]),
    ...(configured.delivery === undefined ? {} : { delivery: configured.delivery }),
    ...(configured.connection === undefined ? {} : { connection: configured.connection }),
  });
}

function initialContinuation(strategy, conversationId) {
  if (strategy === "application-history") return Object.freeze({ strategy, history: Object.freeze([]) });
  if (strategy === "session") return Object.freeze({ strategy, sessionId: `agent-session-${conversationId}` });
  if (strategy === "conversation") {
    return Object.freeze({ strategy, providerConversationId: `agent-conversation-${conversationId}` });
  }
  return Object.freeze({ strategy });
}

function reportedCostLog(cost) {
  if (cost?.status !== "reported") return undefined;
  return Object.freeze({
    model: cost.model,
    prompt_tokens: cost.prompt_tokens,
    completion_tokens: cost.completion_tokens,
    cache_hits: cost.cache_hits,
    estimated_cost_usd: cost.estimated_cost_usd,
  });
}

function blockedOutcome() {
  return Object.freeze({ status: "blocked" });
}

export function createAgentRuntimeComposition({
  agentDefinitions,
  modelProviders,
  executeAgentStep,
  runDefault,
  requirements,
  continuationStrategy = "previous-response",
  maxConversations = DEFAULT_MAX_CONVERSATIONS,
  ...runningAgentOptions
} = {}) {
  assertOwner(agentDefinitions, ["prepare", "validateOutput", "stats"], "agentDefinitions");
  assertOwner(modelProviders, ["resolve", "stats"], "modelProviders");
  if (executeAgentStep !== undefined && typeof executeAgentStep !== "function") {
    throw new TypeError("executeAgentStep must be a function when provided.");
  }
  if (!CONTINUATION_STRATEGIES.has(continuationStrategy)) {
    throw new TypeError("continuationStrategy is unsupported.");
  }
  assertPositiveInteger(maxConversations, "maxConversations");
  const configuredRequirements = normalizeRequirements(requirements);
  const configured = Boolean(agentDefinitions && modelProviders && executeAgentStep);
  const conversations = new Map();
  const executionContexts = new Map();
  let identitySequence = 0;
  let resolutionCount = 0;
  let runCount = 0;
  let completedRunCount = 0;
  let blockedRunCount = 0;
  let outputValidationCount = 0;

  function conversationKey(conversationId, agentId) {
    return JSON.stringify([conversationId, agentId]);
  }

  function reserveConversation() {
    if (conversations.size < maxConversations) return true;
    const evictable = [...conversations.entries()].find(([, record]) => !record.active);
    if (!evictable) return false;
    runningAgents.clearConversation(evictable[1].internalConversationId);
    conversations.delete(evictable[0]);
    return true;
  }

  async function prepareAndResolve(reference) {
    const agentId = assertIdentifier(reference?.agentId, "agent.agentId");
    const revision = assertIdentifier(reference?.revision, "agent.revision");
    const prepared = await agentDefinitions.prepare({ agentId, revision });
    if (prepared.status !== "ready") return Object.freeze({ status: "blocked" });
    const selection = modelProviders.resolve({
      agentModel: prepared.agent.model,
      runDefault,
      requirements: requirementsFor(prepared.agent, configuredRequirements),
    });
    if (selection.status !== "ready") return Object.freeze({ status: "blocked" });
    return Object.freeze({ status: "ready", prepared, selection });
  }

  const runningAgents = createRunningAgentRuntime({
    ...runningAgentOptions,
    maxConversations,
    advanceAgent: configured
      ? async (step) => {
        const execution = executionContexts.get(step.conversationId);
        if (!execution) throw new TypeError("Agent execution context is unavailable.");
        if (step.agent !== execution.prepared.agent.id) {
          throw new TypeError("A composed agent stage cannot change definition identity inside Running Agents.");
        }
        return executeAgentStep(Object.freeze({
          runId: execution.externalRunId,
          conversationId: execution.externalConversationId,
          internalRunId: step.runId,
          turn: step.turn,
          step: step.step,
          agent: step.agent,
          role: execution.role,
          workflow: execution.workflow,
          branch: execution.branch,
          preparedAgent: execution.prepared.agent,
          preparationEvidence: execution.prepared.evidence,
          modelProvider: execution.selection,
          input: step.input,
          continuation: step.continuation,
          ...(step.resume === undefined ? {} : { resume: step.resume }),
          signal: step.signal,
          emit: step.emit,
        }));
      }
      : undefined,
  });

  async function resolveAgent({ agent } = {}) {
    resolutionCount += 1;
    if (!configured) return blockedOutcome();
    try {
      const result = await prepareAndResolve(agent);
      if (result.status !== "ready") return blockedOutcome();
      return Object.freeze({ status: "ready", agentId: agent.agentId, revision: agent.revision });
    } catch {
      return blockedOutcome();
    }
  }

  async function runAgent(request = {}) {
    runCount += 1;
    if (!configured) {
      blockedRunCount += 1;
      return blockedOutcome();
    }
    let record;
    let key;
    try {
      const externalRunId = assertIdentifier(request.runId, "runId");
      const externalConversationId = assertIdentifier(request.conversationId, "conversationId");
      const agentId = assertIdentifier(request.agent?.agentId, "agent.agentId");
      const resolved = await prepareAndResolve(request.agent);
      if (resolved.status !== "ready") throw new TypeError("Agent preparation or model selection blocked.");
      key = conversationKey(externalConversationId, agentId);
      record = conversations.get(key);
      if (!record) {
        if (!reserveConversation()) throw new TypeError("Agent runtime composition capacity is exhausted.");
        const internalConversationId = `agent-runtime-${++identitySequence}`;
        record = {
          externalConversationId,
          agentId,
          internalConversationId,
          continuation: initialContinuation(continuationStrategy, internalConversationId),
          active: false,
        };
        conversations.set(key, record);
      }
      if (record.active) throw new TypeError("Agent runtime composition conversation is active.");
      record.active = true;
      const internalRunId = `agent-runtime-run-${++identitySequence}`;
      executionContexts.set(record.internalConversationId, Object.freeze({
        externalRunId,
        externalConversationId,
        role: request.role,
        workflow: request.workflow,
        branch: request.branch,
        prepared: resolved.prepared,
        selection: resolved.selection,
      }));
      const result = await runningAgents.run({
        runId: internalRunId,
        conversationId: record.internalConversationId,
        agent: agentId,
        input: request.input,
        continuation: record.continuation,
        signal: request.signal,
      });
      executionContexts.delete(record.internalConversationId);
      if (result.status !== "completed") {
        runningAgents.clearConversation(record.internalConversationId);
        conversations.delete(key);
        throw new TypeError("Running Agents did not complete the composed stage.");
      }
      record.continuation = result.continuation;
      outputValidationCount += 1;
      const validated = await agentDefinitions.validateOutput({
        agentId,
        revision: request.agent.revision,
        output: result.output,
      });
      if (validated.status !== "valid") {
        runningAgents.clearConversation(record.internalConversationId);
        conversations.delete(key);
        throw new TypeError("Agent output did not satisfy its definition.");
      }
      record.active = false;
      completedRunCount += 1;
      const costLog = reportedCostLog(result.costLog);
      return Object.freeze({
        status: "completed",
        output: validated.output,
        ...(costLog === undefined ? {} : { costLog }),
      });
    } catch {
      if (record) {
        executionContexts.delete(record.internalConversationId);
        record.active = false;
      }
      blockedRunCount += 1;
      return blockedOutcome();
    }
  }

  function clearConversation(conversationId) {
    const safeConversationId = assertIdentifier(conversationId, "conversationId");
    const matches = [...conversations.entries()].filter(([, record]) => record.externalConversationId === safeConversationId);
    if (matches.some(([, record]) => record.active)) throw new TypeError("An active conversation cannot be cleared.");
    for (const [key, record] of matches) {
      runningAgents.clearConversation(record.internalConversationId);
      conversations.delete(key);
    }
    return matches.length;
  }

  return Object.freeze({
    resolveAgent,
    runAgent,
    clearConversation,
    stats: () => Object.freeze({
      configured,
      sourceRegistryConfigured: Boolean(agentDefinitions),
      modelProviderRegistryConfigured: Boolean(modelProviders),
      executionAdapterConfigured: typeof executeAgentStep === "function",
      continuationStrategy,
      conversations: conversations.size,
      activeRuns: [...conversations.values()].filter((record) => record.active).length,
      resolutionCount,
      runCount,
      completedRunCount,
      blockedRunCount,
      outputValidationCount,
      maxConversations,
      runningAgents: runningAgents.stats(),
    }),
  });
}

export const AGENT_RUNTIME_COMPOSITION_DEFAULTS = Object.freeze({
  maxConversations: DEFAULT_MAX_CONVERSATIONS,
  continuationStrategy: "previous-response",
});
