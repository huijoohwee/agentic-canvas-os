import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createAgentDefinitionRegistry } from "../agent-api/src/agent-definitions.js";
import { createGuardrailsHumanReviewRuntime } from "../agent-api/src/guardrails-human-review.js";
import { createAgentOrchestrationRuntime } from "../agent-api/src/agent-orchestration.js";
import { createAgentRuntimeComposition } from "../agent-api/src/agent-runtime-composition.js";
import { createModelProviderRuntime } from "../agent-api/src/model-providers.js";

const COST = Object.freeze({
  model: "offline-model",
  prompt_tokens: 12,
  completion_tokens: 4,
  cache_hits: 2,
  estimated_cost_usd: 0,
});

function source(agentId, digest = "a".repeat(64)) {
  return Object.freeze({ uri: `workspace:/agents/${agentId}.json`, digest });
}

function definition(agentId, overrides = {}) {
  return {
    id: agentId,
    revision: `${agentId}-v1`,
    name: `${agentId} agent`,
    source: source(agentId),
    model: { providerId: "offline-provider", modelId: "offline-model" },
    instructions: [{ name: "purpose", content: `Own the ${agentId} responsibility.` }],
    output: { mode: "text" },
    ...overrides,
  };
}

function workflow() {
  return {
    workflowId: "source-backed-workflow",
    revision: "workflow-v1",
    manager: { agentId: "manager", revision: "manager-v1" },
    specialists: [
      { agentId: "researcher", revision: "researcher-v1", responsibility: "Return bounded research." },
    ],
    branches: [
      {
        branchId: "delegate-research",
        sourceAgentId: "manager",
        targetAgentId: "researcher",
        mode: "delegate",
        conversationOwnerAgentId: "manager",
        finalAnswerAgentId: "manager",
      },
      {
        branchId: "handoff-research",
        sourceAgentId: "manager",
        targetAgentId: "researcher",
        mode: "handoff",
        conversationOwnerAgentId: "researcher",
        finalAnswerAgentId: "researcher",
      },
    ],
  };
}

function orchestrationRequest(overrides = {}) {
  return {
    runId: "orchestration-run-1",
    conversationId: "orchestration-conversation-1",
    workflowId: "source-backed-workflow",
    workflowRevision: "workflow-v1",
    branchId: "delegate-research",
    input: { request: "Compose a bounded answer." },
    ...overrides,
  };
}

function createHarness({
  executeAgentStep,
  guardrailsHumanReview,
  managerOverrides = {},
  sourceState = { valid: true },
  structured = false,
} = {}) {
  const executions = [];
  const definitions = createAgentDefinitionRegistry({
    verifyDefinitionSource: async ({ source: reference }) => ({
      verified: sourceState.valid,
      uri: reference.uri,
      digest: sourceState.valid ? reference.digest : "b".repeat(64),
      verificationId: "source-proof-1",
    }),
    authorizeCapability: async () => true,
    validateStructuredOutput: async ({ output }) => ({
      valid: output?.approved === true,
      issues: output?.approved === true ? [] : ["approved must be true"],
    }),
  });
  definitions.register(definition("manager", {
    ...(structured ? { output: { mode: "structured", schemaId: "manager-result-v1" } } : {}),
    ...managerOverrides,
  }));
  definitions.register(definition("researcher", {
    tools: [{ name: "source_lookup", loading: "deferred" }],
  }));

  const providers = createModelProviderRuntime();
  providers.registerProvider({
    id: "offline-provider",
    revision: "offline-provider-v1",
    adapterId: "offline-adapter",
    models: [{ id: "offline-model", features: ["tools", "structured-output"] }],
    transports: [{ id: "offline-complete", delivery: "complete", connection: "per-run" }],
    defaultModelId: "offline-model",
    defaultTransportId: "offline-complete",
  });

  const composition = createAgentRuntimeComposition({
    agentDefinitions: definitions,
    guardrailsHumanReview,
    modelProviders: providers,
    executeAgentStep: async (call) => {
      executions.push(call);
      if (executeAgentStep) return executeAgentStep(call, executions.length);
      const output = call.role === "behind-manager"
        ? "source-backed specialist result"
        : structured
          ? { approved: true, answer: `${call.agent} final` }
          : `${call.agent} final`;
      return { status: "completed", output, responseId: `offline-response-${executions.length}`, costLog: COST };
    },
  });
  const orchestration = createAgentOrchestrationRuntime({
    resolveAgent: composition.resolveAgent,
    runAgent: composition.runAgent,
    authorize: async () => ({ allowed: true, approvalId: "offline-approval-1" }),
  });
  orchestration.register(workflow());
  return { composition, definitions, providers, orchestration, executions };
}

test("loads and verifies one repository source-backed Agent Definition", async () => {
  const sourceUrl = new URL("./fixtures/source-backed-agent.json", import.meta.url);
  const sourceText = await readFile(sourceUrl, "utf8");
  const sourceDigest = createHash("sha256").update(sourceText).digest("hex");
  const sourceUri = "workspace:/__tests__/fixtures/source-backed-agent.json";
  const definitions = createAgentDefinitionRegistry({
    verifyDefinitionSource: async ({ source: reference }) => {
      const currentText = await readFile(sourceUrl, "utf8");
      return {
        verified: true,
        uri: sourceUri,
        digest: createHash("sha256").update(currentText).digest("hex"),
        verificationId: "repository-source-proof",
      };
    },
    authorizeCapability: async () => true,
  });
  definitions.register({ ...JSON.parse(sourceText), source: { uri: sourceUri, digest: sourceDigest } });
  const providers = createModelProviderRuntime();
  providers.registerProvider({
    id: "offline-provider",
    revision: "offline-provider-v1",
    adapterId: "offline-adapter",
    models: [{ id: "offline-model", features: ["tools"] }],
    transports: [{ id: "offline-complete", delivery: "complete", connection: "per-run" }],
    defaultModelId: "offline-model",
    defaultTransportId: "offline-complete",
  });
  let packet;
  const composition = createAgentRuntimeComposition({
    agentDefinitions: definitions,
    modelProviders: providers,
    executeAgentStep: async (call) => {
      packet = call;
      return { status: "completed", output: "source-backed final", responseId: "source-response-1", costLog: COST };
    },
  });

  const result = await composition.runAgent({
    runId: "source-run-1",
    conversationId: "source-conversation-1",
    agent: { agentId: "source-specialist", revision: "source-specialist-v1" },
    role: "user-facing-owner",
    input: "Use the registered source.",
  });
  assert.equal(result.output, "source-backed final");
  assert.deepEqual(packet.preparedAgent.source, { uri: sourceUri, digest: sourceDigest });
  assert.equal(packet.preparationEvidence.sourceVerificationId, "repository-source-proof");
  assert.equal(packet.preparedAgent.instructions[0].content, JSON.parse(sourceText).instructions[0].content);
});

test("composes verified source, exact definition, model selection, and Running Agents lifecycle", async () => {
  const { composition, executions } = createHarness();
  const result = await composition.runAgent({
    runId: "direct-run-1",
    conversationId: "direct-conversation-1",
    workflow: { workflowId: "source-backed-workflow", revision: "workflow-v1" },
    branch: { branchId: "handoff-research", mode: "handoff" },
    agent: { agentId: "researcher", revision: "researcher-v1" },
    role: "user-facing-owner",
    input: { request: "Research." },
  });

  assert.equal(result.status, "completed");
  assert.equal(result.output, "researcher final");
  assert.equal(executions[0].preparedAgent.source.uri, "workspace:/agents/researcher.json");
  assert.equal(executions[0].preparationEvidence.sourceVerified, true);
  assert.equal(executions[0].modelProvider.provider.id, "offline-provider");
  assert.equal(executions[0].modelProvider.model.id, "offline-model");
  assert.equal(executions[0].modelProvider.transport.id, "offline-complete");
  assert.deepEqual(executions[0].modelProvider.evidence.requiredFeatures, ["tools"]);
  assert.equal(composition.stats().runningAgents.completedTurns, 1);
  assert.equal(composition.stats().outputValidationCount, 1);
});

test("delegation keeps specialist output behind the source-backed manager", async () => {
  const { orchestration, executions } = createHarness();
  const result = await orchestration.run(orchestrationRequest());

  assert.equal(result.status, "completed");
  assert.equal(result.output, "manager final");
  assert.equal(result.finalAnswerOwner.agentId, "manager");
  assert.equal(result.evidence.specialistStayedBehindManager, true);
  assert.equal(JSON.stringify(result).includes("source-backed specialist result"), false);
  assert.deepEqual(executions.map(({ agent, role }) => [agent, role]), [
    ["researcher", "behind-manager"],
    ["manager", "user-facing-manager"],
  ]);
  assert.equal(executions[1].input.specialist.output, "source-backed specialist result");
  assert.equal(result.cost.status, "reported");
});

test("handoff gives final-answer ownership to the source-backed specialist", async () => {
  const { orchestration, executions } = createHarness();
  const result = await orchestration.run(orchestrationRequest({ branchId: "handoff-research" }));

  assert.equal(result.status, "completed");
  assert.equal(result.output, "researcher final");
  assert.deepEqual(result.finalAnswerOwner, { agentId: "researcher", revision: "researcher-v1" });
  assert.deepEqual(executions.map(({ role }) => role), ["user-facing-owner"]);
});

test("preserves exact previous-response continuation across agent turns", async () => {
  const { composition, executions } = createHarness();
  const request = {
    conversationId: "continued-conversation",
    workflow: { workflowId: "source-backed-workflow", revision: "workflow-v1" },
    branch: { branchId: "handoff-research", mode: "handoff" },
    agent: { agentId: "researcher", revision: "researcher-v1" },
    role: "user-facing-owner",
    input: "continue",
  };
  assert.equal((await composition.runAgent({ ...request, runId: "continued-run-1" })).status, "completed");
  assert.equal((await composition.runAgent({ ...request, runId: "continued-run-2" })).status, "completed");
  assert.deepEqual(executions[0].continuation, { strategy: "previous-response" });
  assert.deepEqual(executions[1].continuation, {
    strategy: "previous-response",
    previousResponseId: "offline-response-1",
  });
});

test("applies registered input and output guardrails around the composed agent", async () => {
  const guardrailCalls = [];
  const guardrailsHumanReview = createGuardrailsHumanReviewRuntime({
    evaluateGuardrail: async (request) => {
      guardrailCalls.push(request);
      if (request.stage === "input") return { passed: true, value: { request: "validated" } };
      return { passed: true, value: "public answer" };
    },
  });
  const { composition, executions } = createHarness({
    guardrailsHumanReview,
    managerOverrides: {
      guardrails: [
        { name: "request-policy", stage: "input" },
        { name: "response-policy", stage: "output" },
      ],
    },
    executeAgentStep: async () => ({
      status: "completed",
      output: "private answer",
      responseId: "guarded-response",
      costLog: COST,
    }),
  });
  const result = await composition.runAgent({
    runId: "guarded-run",
    conversationId: "guarded-conversation",
    agent: { agentId: "manager", revision: "manager-v1" },
    role: "user-facing-owner",
    input: { request: "raw" },
  });

  assert.equal(result.status, "completed");
  assert.equal(result.output, "public answer");
  assert.deepEqual(executions[0].input, { request: "validated" });
  assert.deepEqual(guardrailCalls.map(({ stage }) => stage), ["input", "output"]);
  assert.equal(composition.stats().automaticGuardrailChecks, 2);
  assert.deepEqual(composition.stats().guardrailStageChecks, { input: 1, output: 1 });
});

test("blocks referenced guardrails before execution when their runtime owner is missing", async () => {
  const { composition, executions } = createHarness({
    managerOverrides: { guardrails: [{ name: "request-policy", stage: "input" }] },
  });
  const result = await composition.runAgent({
    runId: "unguarded-run",
    conversationId: "unguarded-conversation",
    agent: { agentId: "manager", revision: "manager-v1" },
    role: "user-facing-owner",
    input: { request: "must not execute" },
  });
  assert.equal(result.status, "blocked");
  assert.equal(executions.length, 0);
  assert.equal(composition.stats().blockedGuardrailRuns, 1);
});

test("blocks stale source evidence and missing model features before execution", async () => {
  const sourceState = { valid: false };
  const sourceHarness = createHarness({ sourceState });
  assert.equal((await sourceHarness.composition.resolveAgent({
    agent: { agentId: "manager", revision: "manager-v1" },
  })).status, "blocked");
  assert.equal(sourceHarness.executions.length, 0);

  sourceState.valid = true;
  sourceHarness.providers.registerProvider({
    id: "offline-provider",
    revision: "offline-provider-v2",
    adapterId: "offline-adapter",
    models: [{ id: "offline-model", features: [] }],
    transports: [{ id: "offline-complete", delivery: "complete", connection: "per-run" }],
    defaultModelId: "offline-model",
    defaultTransportId: "offline-complete",
  });
  assert.equal((await sourceHarness.composition.resolveAgent({
    agent: { agentId: "researcher", revision: "researcher-v1" },
  })).status, "blocked");
  assert.equal(sourceHarness.executions.length, 0);
});

test("validates structured final output after execution and discards invalid continuation", async () => {
  const { composition, executions } = createHarness({
    structured: true,
    executeAgentStep: async (_call, index) => ({
      status: "completed",
      output: index === 1 ? { approved: false } : { approved: true },
      responseId: `structured-response-${index}`,
      costLog: COST,
    }),
  });
  const request = {
    conversationId: "structured-conversation",
    workflow: { workflowId: "source-backed-workflow", revision: "workflow-v1" },
    branch: { branchId: "delegate-research", mode: "delegate" },
    agent: { agentId: "manager", revision: "manager-v1" },
    role: "user-facing-manager",
    input: "validate",
  };
  assert.equal((await composition.runAgent({ ...request, runId: "structured-run-1" })).status, "blocked");
  assert.equal((await composition.runAgent({ ...request, runId: "structured-run-2" })).status, "completed");
  assert.deepEqual(executions[1].continuation, { strategy: "previous-response" });
});

test("keeps unreported provider cost unreported through orchestration", async () => {
  const { orchestration } = createHarness({
    executeAgentStep: async (call, index) => ({
      status: "completed",
      output: call.role === "behind-manager" ? "offline facts" : `${call.agent} final`,
      responseId: `unreported-response-${index}`,
    }),
  });
  const result = await orchestration.run(orchestrationRequest());
  assert.equal(result.status, "completed");
  assert.equal(result.cost.status, "unreported");
  assert.equal(result.cost.reportedSteps, 0);
  assert.equal(result.cost.unreportedSteps, 2);
});

test("blocks an adapter-owned identity change instead of reusing the original definition", async () => {
  let calls = 0;
  const { composition } = createHarness({
    executeAgentStep: async () => {
      calls += 1;
      return {
        status: "continue",
        transition: "handoff",
        agent: "manager",
        nextInput: "unexpected internal handoff",
        responseId: `identity-change-${calls}`,
        costLog: COST,
      };
    },
  });
  const result = await composition.runAgent({
    runId: "identity-change-run",
    conversationId: "identity-change-conversation",
    agent: { agentId: "researcher", revision: "researcher-v1" },
    role: "user-facing-owner",
    input: "stay bound",
  });
  assert.equal(result.status, "blocked");
  assert.equal(calls, 1);
});

test("reports contract readiness without an execution adapter or source content", () => {
  const composition = createAgentRuntimeComposition();
  assert.deepEqual(composition.stats().configured, false);
  assert.equal(composition.stats().executionAdapterConfigured, false);
  assert.equal(composition.stats().runningAgents.adapterConfigured, false);
  assert.equal(JSON.stringify(composition.stats()).includes("Own the"), false);
});
