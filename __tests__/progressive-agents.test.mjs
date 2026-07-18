import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createAgentDefinitionRegistry } from "../agent-api/src/agent-definitions.js";
import { createAgentOrchestrationRuntime } from "../agent-api/src/agent-orchestration.js";
import { createAgentRuntimeComposition } from "../agent-api/src/agent-runtime-composition.js";
import { createFunctionCallingRuntime } from "../agent-api/src/function-calling.js";
import { createModelProviderRuntime } from "../agent-api/src/model-providers.js";
import { createProgressiveAgentsRuntime } from "../agent-api/src/progressive-agents.js";

const COST = Object.freeze({
  model: "offline-model",
  prompt_tokens: 0,
  completion_tokens: 0,
  cache_hits: 0,
  estimated_cost_usd: 0,
});
const FUNCTION_COST = Object.freeze({
  ...COST,
  cached_tokens: 0,
  cache_write_tokens: 0,
  provider_cache_status: "unreported",
});
const CAPABILITIES = Object.freeze({
  functionCalling: true,
  strictSchemas: true,
  parallelFunctionCalls: true,
  previousResponseContinuation: true,
  reasoningItemReplay: true,
});
const OBJECT_SCHEMA = Object.freeze({
  type: "object",
  properties: { value: { type: "string" } },
  required: ["value"],
  additionalProperties: false,
});

function definition(id, overrides = {}) {
  return {
    id,
    revision: `${id}-v1`,
    name: `${id} agent`,
    source: {
      uri: `workspace:/agents/${id}.json`,
      digest: createHash("sha256").update(id).digest("hex"),
    },
    model: { providerId: "offline-provider", modelId: "offline-model" },
    instructions: [{ name: "purpose", content: `Own the ${id} task.` }],
    output: { mode: "text" },
    ...overrides,
  };
}

function functionTool() {
  return {
    type: "function",
    name: "lookup_record",
    revision: "lookup-record/v1",
    description: "Read one approved record.",
    parameters: OBJECT_SCHEMA,
    strict: true,
    outputSchema: OBJECT_SCHEMA,
    allowedCallers: ["direct"],
    riskClass: "read-only",
    idempotent: true,
    approvalRequired: false,
    validateArguments: () => true,
    validateOutput: () => true,
  };
}

function createHarness() {
  const adapterCalls = [];
  const toolCalls = [];
  const definitions = createAgentDefinitionRegistry({
    verifyDefinitionSource: async ({ source }) => ({
      verified: true,
      uri: source.uri,
      digest: source.digest,
      verificationId: "offline-source-proof",
    }),
    authorizeCapability: async () => true,
  });
  const providers = createModelProviderRuntime();
  providers.registerProvider({
    id: "offline-provider",
    revision: "offline-provider-v1",
    adapterId: "offline-adapter",
    models: [{ id: "offline-model", features: ["tools"] }],
    transports: [{ id: "offline-transport", delivery: "complete", connection: "per-run" }],
    defaultModelId: "offline-model",
    defaultTransportId: "offline-transport",
  });
  let functionTurn = 0;
  const functionCalling = createFunctionCallingRuntime({
    advanceModel: async () => functionTurn++ === 0
      ? {
        responseId: "function-response-1",
        status: "completed",
        items: [{ type: "function_call", callId: "function-call-1", name: "lookup_record", arguments: { value: "42" } }],
        costLog: FUNCTION_COST,
      }
      : {
        responseId: "function-response-2",
        status: "completed",
        items: [{ type: "message", output: "tool-backed answer" }],
        costLog: FUNCTION_COST,
      },
    callTool: async (call) => {
      toolCalls.push(call);
      return {
        status: "completed",
        output: { value: "approved-record" },
        costLog: { ...FUNCTION_COST, model: "offline-tool-gateway" },
      };
    },
  });
  const composition = createAgentRuntimeComposition({
    agentDefinitions: definitions,
    modelProviders: providers,
    continuationStrategy: "session",
    executeAgentStep: async (call) => {
      adapterCalls.push(call);
      if (call.preparedAgent.behavior.tools.length === 0) {
        return { status: "completed", output: `${call.agent} answer`, costLog: COST };
      }
      const result = await functionCalling.run({
        runId: `${call.internalRunId}-functions`,
        input: call.input,
        tools: [functionTool()],
        capabilities: CAPABILITIES,
      });
      return { status: result.status, output: result.output, costLog: COST };
    },
  });
  const orchestration = createAgentOrchestrationRuntime({
    resolveAgent: composition.resolveAgent,
    runAgent: composition.runAgent,
    authorize: async () => ({ allowed: true, approvalId: "offline-workflow-approval" }),
  });
  const runtime = createProgressiveAgentsRuntime({
    agentDefinitions: definitions,
    agentRuntimeComposition: composition,
    agentOrchestration: orchestration,
  });
  return { runtime, adapterCalls, toolCalls };
}

test("starts with one source-backed agent and one bounded run", async () => {
  const { runtime, adapterCalls } = createHarness();
  assert.equal(runtime.stats().configured, false);
  runtime.registerAgent(definition("guide"));
  assert.equal(runtime.stats().configured, true);

  const result = await runtime.executeAgent({
    runId: "single-run",
    conversationId: "single-conversation",
    agentId: "guide",
    revision: "guide-v1",
    input: { request: "Answer once." },
  });

  assert.equal(result.status, "completed");
  assert.equal(result.output, "guide answer");
  assert.deepEqual(result.finalAnswerOwner, { agentId: "guide", revision: "guide-v1" });
  assert.equal(adapterCalls[0].role, "user-facing-owner");
  assert.equal(runtime.stats().completedSingleAgentRuns, 1);
});

test("adds a tool through the existing definition and Function Calling owners", async () => {
  const { runtime, adapterCalls, toolCalls } = createHarness();
  runtime.registerAgent(definition("analyst", {
    tools: [{ name: "lookup_record", loading: "direct" }],
  }));

  const result = await runtime.executeAgent({
    runId: "tool-run",
    conversationId: "tool-conversation",
    agentId: "analyst",
    revision: "analyst-v1",
    input: { request: "Use the approved record." },
  });

  assert.equal(result.output, "tool-backed answer");
  assert.deepEqual(adapterCalls[0].preparedAgent.behavior.tools, [{ name: "lookup_record", loading: "direct" }]);
  assert.equal(toolCalls.length, 1);
  assert.equal(toolCalls[0].name, "lookup_record");
  assert.equal(runtime.stats().toolEnabledAgentAvailable, true);
});

test("adds specialists only through the explicit orchestration owner", async () => {
  const { runtime, adapterCalls } = createHarness();
  runtime.registerAgent(definition("manager"));
  runtime.registerAgent(definition("specialist"));
  runtime.registerWorkflow({
    workflowId: "progressive-workflow",
    revision: "progressive-v1",
    manager: { agentId: "manager", revision: "manager-v1" },
    specialists: [{ agentId: "specialist", revision: "specialist-v1", responsibility: "Return bounded specialist evidence." }],
    branches: [{
      branchId: "delegate-specialist",
      sourceAgentId: "manager",
      targetAgentId: "specialist",
      mode: "delegate",
      conversationOwnerAgentId: "manager",
      finalAnswerAgentId: "manager",
    }],
  });

  const result = await runtime.executeWorkflow({
    runId: "workflow-run",
    conversationId: "workflow-conversation",
    workflowId: "progressive-workflow",
    workflowRevision: "progressive-v1",
    branchId: "delegate-specialist",
    input: { request: "Delegate then answer." },
  });

  assert.equal(result.status, "completed");
  assert.equal(result.output, "manager answer");
  assert.equal(result.finalAnswerOwner.agentId, "manager");
  assert.deepEqual(adapterCalls.map(({ agent, role }) => [agent, role]), [
    ["specialist", "behind-manager"],
    ["manager", "user-facing-manager"],
  ]);
  assert.equal(runtime.stats().specialistWorkflowAvailable, true);
});

test("fails closed when runtime owners or exact request fields are missing", async () => {
  const runtime = createProgressiveAgentsRuntime();
  const blocked = await runtime.executeAgent({
    runId: "blocked-run",
    conversationId: "blocked-conversation",
    agentId: "missing",
    revision: "missing-v1",
    input: "blocked",
  });
  assert.equal(blocked.reasonCode, "agent_execution_blocked");
  assert.equal(blocked.stage, "single-agent");
  assert.equal(runtime.stats().configured, false);
  assert.throws(() => runtime.registerAgent(definition("missing")), /Agent Definitions/);
  await assert.rejects(
    () => runtime.executeAgent({
      runId: "bad-run",
      conversationId: "bad-conversation",
      agentId: "bad",
      revision: "bad-v1",
      input: "bad",
      instructions: "not accepted",
    }),
    /unsupported fields/,
  );
});
