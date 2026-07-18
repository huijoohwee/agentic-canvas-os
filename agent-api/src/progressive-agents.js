import { normalizeJson, serializedJsonLength } from "./json-contract.js";

const DEFAULT_MAX_INPUT_CHARS = 200_000;

function assertIdentifier(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${field} must be a non-empty string.`);
  }
  const normalized = value.trim();
  if (normalized.length > 256) throw new RangeError(`${field} exceeds 256 characters.`);
  return normalized;
}

function assertOwner(value, methods, field) {
  if (value === undefined) return;
  if (!value || typeof value !== "object") throw new TypeError(`${field} must be an object when provided.`);
  for (const method of methods) {
    if (typeof value[method] !== "function") throw new TypeError(`${field}.${method} must be a function.`);
  }
}

function assertExactKeys(value, allowedKeys, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object.`);
  }
  const unknown = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unknown.length) throw new TypeError(`${field} contains unsupported fields: ${unknown.join(", ")}.`);
}

function normalizeAgentRun(value, maxInputChars) {
  assertExactKeys(value, ["runId", "conversationId", "agentId", "revision", "input", "signal"], "request");
  if (value.signal !== undefined && typeof value.signal?.aborted !== "boolean") {
    throw new TypeError("request.signal must be an AbortSignal when provided.");
  }
  const input = normalizeJson(value.input, "request.input");
  if (serializedJsonLength(input) > maxInputChars) {
    throw new RangeError(`request.input exceeds ${maxInputChars} serialized characters.`);
  }
  return Object.freeze({
    runId: assertIdentifier(value.runId, "request.runId"),
    conversationId: assertIdentifier(value.conversationId, "request.conversationId"),
    agent: Object.freeze({
      agentId: assertIdentifier(value.agentId, "request.agentId"),
      revision: assertIdentifier(value.revision, "request.revision"),
    }),
    input,
    signal: value.signal,
  });
}

function blockedAgentRun(request) {
  return Object.freeze({
    status: "blocked",
    stage: "single-agent",
    runId: request.runId,
    conversationId: request.conversationId,
    agent: request.agent,
    reasonCode: "agent_execution_blocked",
    message: "The exact agent revision could not complete through the configured runtime owners.",
  });
}

export function createProgressiveAgentsRuntime({
  agentDefinitions,
  agentRuntimeComposition,
  agentOrchestration,
  maxInputChars = DEFAULT_MAX_INPUT_CHARS,
} = {}) {
  assertOwner(agentDefinitions, ["register", "stats"], "agentDefinitions");
  assertOwner(agentRuntimeComposition, ["runAgent", "stats"], "agentRuntimeComposition");
  assertOwner(agentOrchestration, ["register", "run", "stats"], "agentOrchestration");
  if (!Number.isInteger(maxInputChars) || maxInputChars < 1) {
    throw new TypeError("maxInputChars must be a positive integer.");
  }

  let singleAgentRuns = 0;
  let completedSingleAgentRuns = 0;
  let blockedSingleAgentRuns = 0;
  let workflowRuns = 0;

  function registerAgent(definition) {
    if (!agentDefinitions) throw new TypeError("Agent Definitions is required to register an agent.");
    return agentDefinitions.register(definition);
  }

  async function executeAgent(value = {}) {
    const request = normalizeAgentRun(value, maxInputChars);
    singleAgentRuns += 1;
    if (!agentRuntimeComposition) {
      blockedSingleAgentRuns += 1;
      return blockedAgentRun(request);
    }
    const result = await agentRuntimeComposition.runAgent({
      runId: request.runId,
      conversationId: request.conversationId,
      agent: request.agent,
      role: "user-facing-owner",
      input: request.input,
      signal: request.signal,
    });
    if (result.status !== "completed") {
      blockedSingleAgentRuns += 1;
      return blockedAgentRun(request);
    }
    completedSingleAgentRuns += 1;
    return Object.freeze({
      ...result,
      stage: "single-agent",
      runId: request.runId,
      conversationId: request.conversationId,
      agent: request.agent,
      finalAnswerOwner: request.agent,
    });
  }

  function registerWorkflow(workflow) {
    if (!agentOrchestration) throw new TypeError("Agent Orchestration is required to register a specialist workflow.");
    return agentOrchestration.register(workflow);
  }

  async function executeWorkflow(request = {}) {
    workflowRuns += 1;
    if (!agentOrchestration) {
      return Object.freeze({
        status: "blocked",
        stage: "orchestrate",
        reasonCode: "runtime_unconfigured",
        message: "Agent Orchestration is required to run a specialist workflow.",
      });
    }
    return agentOrchestration.run(request);
  }

  function stats() {
    const definitions = agentDefinitions?.stats();
    const composition = agentRuntimeComposition?.stats();
    const orchestration = agentOrchestration?.stats();
    const singleAgentConfigured = Boolean(composition?.configured && definitions?.agents > 0);
    return Object.freeze({
      configured: singleAgentConfigured,
      singleAgentConfigured,
      toolEnabledAgentAvailable: Boolean(
        singleAgentConfigured
        && definitions?.capabilityAuthorizerConfigured
      ),
      specialistWorkflowAvailable: Boolean(orchestration?.configured && orchestration?.workflows > 0),
      definitionRegistryConfigured: Boolean(agentDefinitions),
      compositionConfigured: Boolean(composition?.configured),
      orchestrationConfigured: Boolean(orchestration?.configured),
      growthStages: Object.freeze(["single-agent", "tool-enabled-agent", "specialist-workflow"]),
      singleAgentRuns,
      completedSingleAgentRuns,
      blockedSingleAgentRuns,
      workflowRuns,
      maxInputChars,
    });
  }

  return Object.freeze({
    registerAgent,
    executeAgent,
    registerWorkflow,
    executeWorkflow,
    stats,
  });
}

export const PROGRESSIVE_AGENTS_DEFAULTS = Object.freeze({ maxInputChars: DEFAULT_MAX_INPUT_CHARS });
