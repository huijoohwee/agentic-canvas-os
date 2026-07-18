import test from "node:test";
import assert from "node:assert/strict";

import {
  AgentDefinitionBlock,
  createAgentDefinitionRegistry,
} from "../agent-api/src/agent-definitions.js";

function minimalDefinition(overrides = {}) {
  return {
    id: "briefing-agent",
    revision: "briefing-v1",
    name: "Briefing Agent",
    model: {
      providerId: "configured-provider",
      modelId: "configured-model",
    },
    instructions: [
      { name: "purpose", content: "Prepare a concise source-backed briefing." },
      { name: "boundary", content: "Do not perform external mutations." },
    ],
    ...overrides,
  };
}

test("registers and prepares a minimal immutable agent packet", async () => {
  const registry = createAgentDefinitionRegistry();
  assert.deepEqual(registry.register(minimalDefinition()), {
    id: "briefing-agent",
    revision: "briefing-v1",
    status: "registered",
  });
  assert.equal(registry.register(minimalDefinition()).status, "already_registered");

  const prepared = await registry.prepare({ agentId: "briefing-agent", revision: "briefing-v1" });
  assert.equal(prepared.status, "ready");
  assert.equal(prepared.agent.model.modelId, "configured-model");
  assert.deepEqual(prepared.agent.instructions.map((instruction) => instruction.name), ["purpose", "boundary"]);
  assert.deepEqual(prepared.agent.behavior, {
    tools: [],
    guardrails: [],
    mcpServers: [],
    handoffs: [],
    output: { mode: "text" },
  });
  assert.deepEqual(prepared.evidence, {
    authorizedCapabilities: 0,
    verifiedHandoffTargets: 0,
    executionOwner: "running-agents-adapter",
    providerExecutionStatus: "unverified",
  });
  assert.equal(Object.isFrozen(prepared.agent.instructions), true);
  assert.equal(Object.isFrozen(prepared.agent.behavior), true);
});

test("packages authorized tools, guardrails, MCP servers, handoffs, and structured output", async () => {
  const authorizations = [];
  const registry = createAgentDefinitionRegistry({
    authorizeCapability: async (request) => {
      authorizations.push(request);
      return true;
    },
    validateStructuredOutput: ({ schemaId, output }) => ({
      valid: schemaId === "briefing-result-v1" && typeof output.summary === "string",
      issues: ["summary is required"],
    }),
  });
  registry.register(minimalDefinition({
    id: "review-agent",
    revision: "review-v1",
    name: "Review Agent",
  }));
  registry.register(minimalDefinition({
    tools: [
      { name: "source_lookup", loading: "direct" },
      { name: "archive_lookup", loading: "deferred" },
    ],
    guardrails: [
      { name: "input-scope", stage: "input" },
      { name: "citation-check", stage: "output" },
    ],
    mcpServers: [{ name: "workspace-readonly" }],
    handoffs: [{ targetAgentId: "review-agent", summary: "Delegate final evidence review." }],
    output: { mode: "structured", schemaId: "briefing-result-v1" },
  }));

  const prepared = await registry.prepare({ agentId: "briefing-agent" });
  assert.equal(prepared.status, "ready");
  assert.equal(prepared.evidence.authorizedCapabilities, 6);
  assert.deepEqual(authorizations.map(({ kind, name }) => `${kind}:${name}`).sort(), [
    "guardrail:citation-check",
    "guardrail:input-scope",
    "mcp-server:workspace-readonly",
    "output-schema:briefing-result-v1",
    "tool:archive_lookup",
    "tool:source_lookup",
  ]);
  assert.deepEqual(prepared.agent.behavior.handoffs, [{
    targetAgentId: "review-agent",
    targetRevision: "review-v1",
    targetName: "Review Agent",
    summary: "Delegate final evidence review.",
  }]);

  const valid = await registry.validateOutput({
    agentId: "briefing-agent",
    output: { summary: "All checks are local." },
  });
  assert.equal(valid.status, "valid");
  assert.equal(valid.schemaId, "briefing-result-v1");

  const rejected = await registry.validateOutput({ agentId: "briefing-agent", output: { note: "missing" } });
  assert.equal(rejected.status, "blocked");
  assert.equal(rejected.reasonCode, "structured_output_invalid");
  assert.deepEqual(rejected.details.issues, ["summary is required"]);
});

test("capabilities remain references and fail closed without application authorization", async () => {
  const unconfigured = createAgentDefinitionRegistry();
  unconfigured.register(minimalDefinition({ tools: [{ name: "source_lookup", loading: "direct" }] }));
  const missing = await unconfigured.prepare({ agentId: "briefing-agent" });
  assert.equal(missing.status, "blocked");
  assert.equal(missing.reasonCode, "capability_authorizer_unconfigured");

  const denied = createAgentDefinitionRegistry({ authorizeCapability: ({ name }) => name !== "archive_lookup" });
  denied.register(minimalDefinition({
    tools: [
      { name: "source_lookup", loading: "direct" },
      { name: "archive_lookup", loading: "deferred" },
    ],
  }));
  const result = await denied.prepare({ agentId: "briefing-agent" });
  assert.equal(result.status, "blocked");
  assert.equal(result.reasonCode, "capability_denied");
  assert.match(result.message, /archive_lookup/);
});

test("handoffs require a distinct registered target at preparation time", async () => {
  const registry = createAgentDefinitionRegistry();
  assert.throws(
    () => registry.register(minimalDefinition({
      handoffs: [{ targetAgentId: "briefing-agent", summary: "Cycle back." }],
    })),
    /cannot hand off to itself/,
  );
  registry.register(minimalDefinition({
    handoffs: [{ targetAgentId: "missing-agent", summary: "Request another specialist." }],
  }));
  const result = await registry.prepare({ agentId: "briefing-agent" });
  assert.equal(result.status, "blocked");
  assert.equal(result.reasonCode, "handoff_target_missing");
});

test("revision conflicts, stale prepares, unknown fields, and capacity fail closed", async () => {
  const registry = createAgentDefinitionRegistry({ maxAgents: 1 });
  registry.register(minimalDefinition());
  assert.throws(
    () => registry.register(minimalDefinition({ name: "Changed without revision" })),
    (error) => error instanceof AgentDefinitionBlock && error.reasonCode === "agent_revision_conflict",
  );
  assert.throws(
    () => registry.register(minimalDefinition({ id: "second-agent", revision: "second-v1", name: "Second" })),
    (error) => error instanceof AgentDefinitionBlock && error.reasonCode === "agent_capacity",
  );
  assert.throws(
    () => registry.register(minimalDefinition({ revision: "briefing-v2", credential: "forbidden" })),
    /unsupported fields: credential/,
  );
  assert.throws(
    () => registry.register(minimalDefinition({
      revision: "briefing-v2",
      model: {
        providerId: "configured-provider",
        modelId: "configured-model",
        apiKey: "forbidden",
      },
    })),
    /model contains unsupported fields: apiKey/,
  );
  assert.throws(
    () => registry.register(minimalDefinition({
      revision: "briefing-v2",
      mcpServers: [{ name: "workspace-readonly", endpoint: "https:\/\/not-accepted.example" }],
    })),
    /mcpServers\[0\] contains unsupported fields: endpoint/,
  );
  assert.throws(
    () => registry.register(minimalDefinition({
      revision: "briefing-v2",
      tools: [
        { name: "source_lookup", loading: "direct" },
        { name: "source_lookup", loading: "deferred" },
      ],
    })),
    /tools contains a duplicate name/,
  );

  assert.equal(registry.register(minimalDefinition({ revision: "briefing-v2" })).status, "replaced");
  const stale = await registry.prepare({ agentId: "briefing-agent", revision: "briefing-v1" });
  assert.equal(stale.status, "blocked");
  assert.equal(stale.reasonCode, "agent_revision_stale");
  assert.equal((await registry.prepare({ agentId: "briefing-agent", revision: "briefing-v2" })).status, "ready");
});

test("instruction, reference, definition, and output bounds are enforced", async () => {
  const instructionBound = createAgentDefinitionRegistry({ maxInstructionChars: 8 });
  assert.throws(
    () => instructionBound.register(minimalDefinition({ instructions: [{ name: "task", content: "123456789" }] })),
    /instructions exceed 8 characters/,
  );

  const referenceBound = createAgentDefinitionRegistry({ maxReferences: 1 });
  assert.throws(
    () => referenceBound.register(minimalDefinition({
      tools: [
        { name: "one", loading: "direct" },
        { name: "two", loading: "direct" },
      ],
    })),
    /at most 1 entries/,
  );

  const outputBound = createAgentDefinitionRegistry({ maxOutputChars: 5 });
  outputBound.register(minimalDefinition());
  const output = await outputBound.validateOutput({ agentId: "briefing-agent", output: "123456" });
  assert.equal(output.status, "blocked");
  assert.equal(output.reasonCode, "output_limit");
});

test("text and structured output validation report configuration honestly", async () => {
  const textRegistry = createAgentDefinitionRegistry();
  textRegistry.register(minimalDefinition());
  assert.equal((await textRegistry.validateOutput({ agentId: "briefing-agent", output: "done" })).status, "valid");
  assert.equal(
    (await textRegistry.validateOutput({ agentId: "briefing-agent", output: { text: "done" } })).reasonCode,
    "text_output_invalid",
  );

  const structuredRegistry = createAgentDefinitionRegistry({ authorizeCapability: () => true });
  structuredRegistry.register(minimalDefinition({ output: { mode: "structured", schemaId: "result-v1" } }));
  const result = await structuredRegistry.validateOutput({ agentId: "briefing-agent", output: { ok: true } });
  assert.equal(result.status, "blocked");
  assert.equal(result.reasonCode, "output_validator_unconfigured");
  assert.deepEqual(structuredRegistry.stats(), {
    agents: 1,
    registrationCount: 1,
    replacementCount: 0,
    preparationCount: 0,
    blockedPreparationCount: 0,
    outputValidationCount: 0,
    blockedOutputCount: 1,
    capabilityAuthorizerConfigured: true,
    outputValidatorConfigured: false,
    maxAgents: 64,
    maxInstructions: 16,
    maxReferences: 64,
    maxDefinitionChars: 200000,
    maxInstructionChars: 100000,
    maxOutputChars: 200000,
    maxValidationIssueChars: 20000,
  });
});
