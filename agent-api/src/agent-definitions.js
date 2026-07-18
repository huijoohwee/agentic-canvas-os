import { normalizeJson, serializedJsonLength } from "./json-contract.js";

const DEFAULT_MAX_AGENTS = 64;
const DEFAULT_MAX_INSTRUCTIONS = 16;
const DEFAULT_MAX_REFERENCES = 64;
const DEFAULT_MAX_DEFINITION_CHARS = 200_000;
const DEFAULT_MAX_INSTRUCTION_CHARS = 100_000;
const DEFAULT_MAX_OUTPUT_CHARS = 200_000;
const DEFAULT_MAX_VALIDATION_ISSUE_CHARS = 20_000;

const TOOL_LOADING_MODES = new Set(["direct", "deferred"]);
const GUARDRAIL_STAGES = new Set(["input", "output"]);
const OUTPUT_MODES = new Set(["text", "structured"]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export class AgentDefinitionBlock extends Error {
  constructor(reasonCode, message, details = {}) {
    super(message);
    this.name = "AgentDefinitionBlock";
    this.reasonCode = reasonCode;
    this.details = details;
  }
}

function assertPositiveInteger(value, field) {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${field} must be a positive integer.`);
  return value;
}

function assertIdentifier(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} must be a non-empty string.`);
  const normalized = value.trim();
  if (normalized.length > 256) throw new RangeError(`${field} exceeds 256 characters.`);
  return normalized;
}

function assertExactKeys(value, allowedKeys, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object.`);
  }
  const unknown = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unknown.length) throw new TypeError(`${field} contains unsupported fields: ${unknown.join(", ")}.`);
}

function normalizeModel(value) {
  assertExactKeys(value, ["providerId", "modelId"], "model");
  return Object.freeze({
    providerId: assertIdentifier(value.providerId, "model.providerId"),
    modelId: assertIdentifier(value.modelId, "model.modelId"),
  });
}

function normalizeSource(value) {
  assertExactKeys(value, ["uri", "digest"], "source");
  const uri = assertIdentifier(value.uri, "source.uri");
  if (!uri.includes(":")) throw new TypeError("source.uri must use an explicit source scheme.");
  const digest = assertIdentifier(value.digest, "source.digest");
  if (!SHA256_PATTERN.test(digest)) throw new TypeError("source.digest must be a lowercase SHA-256 digest.");
  return Object.freeze({ uri, digest });
}

function normalizeInstructions(value, { maxInstructions, maxInstructionChars }) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError("instructions must be a non-empty array.");
  if (value.length > maxInstructions) throw new RangeError(`instructions must contain at most ${maxInstructions} entries.`);
  const names = new Set();
  let instructionChars = 0;
  const instructions = value.map((instruction, index) => {
    const field = `instructions[${index}]`;
    assertExactKeys(instruction, ["name", "content"], field);
    const name = assertIdentifier(instruction.name, `${field}.name`);
    if (names.has(name)) throw new TypeError(`Duplicate instruction name: ${name}.`);
    names.add(name);
    if (typeof instruction.content !== "string" || !instruction.content.trim()) {
      throw new TypeError(`${field}.content must be a non-empty string.`);
    }
    instructionChars += instruction.content.length;
    if (instructionChars > maxInstructionChars) {
      throw new RangeError(`instructions exceed ${maxInstructionChars} characters.`);
    }
    return Object.freeze({ name, content: instruction.content });
  });
  return Object.freeze(instructions);
}

function normalizeReferences(value, field, maxReferences, normalizeReference) {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array.`);
  if (value.length > maxReferences) throw new RangeError(`${field} must contain at most ${maxReferences} entries.`);
  const identities = new Set();
  return Object.freeze(value.map((reference, index) => {
    const normalized = normalizeReference(reference, `${field}[${index}]`);
    const identity = JSON.stringify(normalized);
    if (identities.has(identity)) throw new TypeError(`${field} contains a duplicate reference.`);
    identities.add(identity);
    return normalized;
  }));
}

function normalizeTool(reference, field) {
  assertExactKeys(reference, ["name", "loading"], field);
  const loading = reference.loading === undefined ? "direct" : reference.loading;
  if (!TOOL_LOADING_MODES.has(loading)) throw new TypeError(`${field}.loading is unsupported.`);
  return Object.freeze({ name: assertIdentifier(reference.name, `${field}.name`), loading });
}

function normalizeGuardrail(reference, field) {
  assertExactKeys(reference, ["name", "stage"], field);
  if (!GUARDRAIL_STAGES.has(reference.stage)) throw new TypeError(`${field}.stage is unsupported.`);
  return Object.freeze({ name: assertIdentifier(reference.name, `${field}.name`), stage: reference.stage });
}

function normalizeMcpServer(reference, field) {
  assertExactKeys(reference, ["name"], field);
  return Object.freeze({ name: assertIdentifier(reference.name, `${field}.name`) });
}

function normalizeHandoff(reference, field) {
  assertExactKeys(reference, ["targetAgentId", "summary"], field);
  return Object.freeze({
    targetAgentId: assertIdentifier(reference.targetAgentId, `${field}.targetAgentId`),
    summary: assertIdentifier(reference.summary, `${field}.summary`),
  });
}

function normalizeOutput(value) {
  if (value === undefined) return Object.freeze({ mode: "text" });
  assertExactKeys(value, ["mode", "schemaId"], "output");
  if (!OUTPUT_MODES.has(value.mode)) throw new TypeError("output.mode is unsupported.");
  if (value.mode === "text") {
    if (value.schemaId !== undefined) throw new TypeError("output.schemaId is only valid for structured output.");
    return Object.freeze({ mode: "text" });
  }
  return Object.freeze({ mode: "structured", schemaId: assertIdentifier(value.schemaId, "output.schemaId") });
}

function normalizeDefinition(value, limits) {
  assertExactKeys(
    value,
    ["id", "revision", "name", "source", "model", "instructions", "tools", "guardrails", "mcpServers", "handoffs", "output"],
    "definition",
  );
  const id = assertIdentifier(value.id, "definition.id");
  const definition = normalizeJson({
    id,
    revision: assertIdentifier(value.revision, "definition.revision"),
    name: assertIdentifier(value.name, "definition.name"),
    source: normalizeSource(value.source),
    model: normalizeModel(value.model),
    instructions: normalizeInstructions(value.instructions, limits),
    tools: normalizeReferences(value.tools, "tools", limits.maxReferences, normalizeTool),
    guardrails: normalizeReferences(value.guardrails, "guardrails", limits.maxReferences, normalizeGuardrail),
    mcpServers: normalizeReferences(value.mcpServers, "mcpServers", limits.maxReferences, normalizeMcpServer),
    handoffs: normalizeReferences(value.handoffs, "handoffs", limits.maxReferences, normalizeHandoff),
    output: normalizeOutput(value.output),
  }, "definition");
  if (definition.handoffs.some((handoff) => handoff.targetAgentId === id)) {
    throw new TypeError("An agent definition cannot hand off to itself.");
  }
  const handoffTargets = definition.handoffs.map((handoff) => handoff.targetAgentId);
  if (new Set(handoffTargets).size !== handoffTargets.length) {
    throw new TypeError("handoffs contains a duplicate target agent.");
  }
  if (serializedJsonLength(definition) > limits.maxDefinitionChars) {
    throw new RangeError(`definition exceeds ${limits.maxDefinitionChars} characters.`);
  }
  return definition;
}

function blocked(agentId, revision, stage, error) {
  return Object.freeze({
    agentId,
    ...(revision ? { revision } : {}),
    status: "blocked",
    stage,
    reasonCode: error.reasonCode || "agent_definition_invalid",
    message: error.message,
    ...(error.details && Object.keys(error.details).length ? { details: normalizeJson(error.details, "details") } : {}),
  });
}

function requireRecord(definitions, agentId, revision) {
  const safeAgentId = assertIdentifier(agentId, "agentId");
  const record = definitions.get(safeAgentId);
  if (!record) throw new AgentDefinitionBlock("agent_not_registered", `Agent ${safeAgentId} is not registered.`);
  if (revision !== undefined && assertIdentifier(revision, "revision") !== record.revision) {
    throw new AgentDefinitionBlock("agent_revision_stale", `Agent ${safeAgentId} is not at the requested revision.`);
  }
  return record;
}

function capabilityReferences(definition) {
  return Object.freeze([
    ...definition.tools.map((tool) => Object.freeze({ kind: "tool", name: tool.name, loading: tool.loading })),
    ...definition.guardrails.map((guardrail) => Object.freeze({ kind: "guardrail", name: guardrail.name, stage: guardrail.stage })),
    ...definition.mcpServers.map((server) => Object.freeze({ kind: "mcp-server", name: server.name })),
    ...(definition.output.mode === "structured"
      ? [Object.freeze({ kind: "output-schema", name: definition.output.schemaId })]
      : []),
  ]);
}

function assertUniqueReferenceNames(references, field) {
  const names = references.map((reference) => reference.name);
  if (new Set(names).size !== names.length) throw new TypeError(`${field} contains a duplicate name.`);
}

export function createAgentDefinitionRegistry({
  verifyDefinitionSource,
  authorizeCapability,
  validateStructuredOutput,
  maxAgents = DEFAULT_MAX_AGENTS,
  maxInstructions = DEFAULT_MAX_INSTRUCTIONS,
  maxReferences = DEFAULT_MAX_REFERENCES,
  maxDefinitionChars = DEFAULT_MAX_DEFINITION_CHARS,
  maxInstructionChars = DEFAULT_MAX_INSTRUCTION_CHARS,
  maxOutputChars = DEFAULT_MAX_OUTPUT_CHARS,
  maxValidationIssueChars = DEFAULT_MAX_VALIDATION_ISSUE_CHARS,
} = {}) {
  const limits = {
    maxAgents,
    maxInstructions,
    maxReferences,
    maxDefinitionChars,
    maxInstructionChars,
    maxOutputChars,
    maxValidationIssueChars,
  };
  for (const [field, value] of Object.entries(limits)) assertPositiveInteger(value, field);
  if (verifyDefinitionSource !== undefined && typeof verifyDefinitionSource !== "function") {
    throw new TypeError("verifyDefinitionSource must be a function when provided.");
  }
  if (authorizeCapability !== undefined && typeof authorizeCapability !== "function") {
    throw new TypeError("authorizeCapability must be a function when provided.");
  }
  if (validateStructuredOutput !== undefined && typeof validateStructuredOutput !== "function") {
    throw new TypeError("validateStructuredOutput must be a function when provided.");
  }

  const definitions = new Map();
  let registrationCount = 0;
  let replacementCount = 0;
  let preparationCount = 0;
  let blockedPreparationCount = 0;
  let outputValidationCount = 0;
  let blockedOutputCount = 0;

  function register(value) {
    const definition = normalizeDefinition(value, limits);
    assertUniqueReferenceNames(definition.tools, "tools");
    assertUniqueReferenceNames(definition.mcpServers, "mcpServers");
    const existing = definitions.get(definition.id);
    if (existing) {
      if (existing.revision === definition.revision) {
        if (JSON.stringify(existing) !== JSON.stringify(definition)) {
          throw new AgentDefinitionBlock("agent_revision_conflict", `Revision ${definition.revision} is already registered with different content.`);
        }
        return Object.freeze({ id: existing.id, revision: existing.revision, status: "already_registered" });
      }
      replacementCount += 1;
    } else if (definitions.size >= maxAgents) {
      throw new AgentDefinitionBlock("agent_capacity", `Agent registry is limited to ${maxAgents} definitions.`);
    }
    definitions.set(definition.id, definition);
    registrationCount += 1;
    return Object.freeze({ id: definition.id, revision: definition.revision, status: existing ? "replaced" : "registered" });
  }

  async function prepare({ agentId, revision } = {}) {
    let record;
    try {
      record = requireRecord(definitions, agentId, revision);
      if (typeof verifyDefinitionSource !== "function") {
        throw new AgentDefinitionBlock("source_verifier_unconfigured", "Agent definitions require an application source verifier.");
      }
      let sourceVerification;
      try {
        sourceVerification = await verifyDefinitionSource(Object.freeze({
          agentId: record.id,
          revision: record.revision,
          source: record.source,
        }));
      } catch {
        throw new AgentDefinitionBlock("source_verifier_failed", "Agent definition source verification failed.");
      }
      assertExactKeys(sourceVerification, ["verified", "uri", "digest", "verificationId"], "source verification");
      if (
        sourceVerification.verified !== true
        || sourceVerification.uri !== record.source.uri
        || sourceVerification.digest !== record.source.digest
      ) {
        throw new AgentDefinitionBlock("source_mismatch", "Agent definition source evidence does not match the registered source.");
      }
      const verificationId = assertIdentifier(sourceVerification.verificationId, "source verification.verificationId");
      const references = capabilityReferences(record);
      if (references.length && typeof authorizeCapability !== "function") {
        throw new AgentDefinitionBlock("capability_authorizer_unconfigured", "Agent capabilities require an application authorizer.");
      }
      const decisions = await Promise.all(references.map(async (reference) => {
        let allowed;
        try {
          allowed = await authorizeCapability(Object.freeze({
            agentId: record.id,
            revision: record.revision,
            ...reference,
          }));
        } catch (error) {
          throw new AgentDefinitionBlock(
            "capability_authorizer_failed",
            `Capability authorization failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        if (allowed !== true) {
          throw new AgentDefinitionBlock("capability_denied", `Capability ${reference.kind}:${reference.name} is not authorized.`);
        }
        return reference;
      }));
      const handoffs = record.handoffs.map((handoff) => {
        const target = definitions.get(handoff.targetAgentId);
        if (!target) {
          throw new AgentDefinitionBlock("handoff_target_missing", `Handoff target ${handoff.targetAgentId} is not registered.`);
        }
        return Object.freeze({
          targetAgentId: target.id,
          targetRevision: target.revision,
          targetName: target.name,
          summary: handoff.summary,
        });
      });
      preparationCount += 1;
      return Object.freeze({
        status: "ready",
        agent: Object.freeze({
          id: record.id,
          revision: record.revision,
          name: record.name,
          source: record.source,
          model: record.model,
          instructions: record.instructions,
          behavior: Object.freeze({
            tools: record.tools,
            guardrails: record.guardrails,
            mcpServers: record.mcpServers,
            handoffs: Object.freeze(handoffs),
            output: record.output,
          }),
        }),
        evidence: Object.freeze({
          sourceVerified: true,
          sourceVerificationId: verificationId,
          authorizedCapabilities: decisions.length,
          verifiedHandoffTargets: handoffs.length,
          executionOwner: "running-agents-adapter",
          providerExecutionStatus: "unverified",
        }),
      });
    } catch (error) {
      blockedPreparationCount += 1;
      const failure = error instanceof AgentDefinitionBlock
        ? error
        : new AgentDefinitionBlock("agent_definition_invalid", error instanceof Error ? error.message : String(error));
      return blocked(agentId, record?.revision || revision, "prepare", failure);
    }
  }

  async function validateOutput({ agentId, revision, output } = {}) {
    let record;
    try {
      record = requireRecord(definitions, agentId, revision);
      if (record.output.mode === "text") {
        if (typeof output !== "string") throw new AgentDefinitionBlock("text_output_invalid", "Text output must be a string.");
        if (output.length > maxOutputChars) throw new AgentDefinitionBlock("output_limit", `Output exceeds ${maxOutputChars} characters.`);
        outputValidationCount += 1;
        return Object.freeze({ status: "valid", agentId: record.id, revision: record.revision, mode: "text", output });
      }
      if (typeof validateStructuredOutput !== "function") {
        throw new AgentDefinitionBlock("output_validator_unconfigured", "Structured output requires an application validator.");
      }
      const normalizedOutput = normalizeJson(output, "output");
      if (serializedJsonLength(normalizedOutput) > maxOutputChars) {
        throw new AgentDefinitionBlock("output_limit", `Output exceeds ${maxOutputChars} characters.`);
      }
      let verdict;
      try {
        verdict = await validateStructuredOutput(Object.freeze({
          agentId: record.id,
          revision: record.revision,
          schemaId: record.output.schemaId,
          output: normalizedOutput,
        }));
      } catch (error) {
        throw new AgentDefinitionBlock(
          "output_validator_failed",
          `Structured output validation failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const valid = verdict === true || (verdict && typeof verdict === "object" && verdict.valid === true);
      if (!valid) {
        const issues = verdict && typeof verdict === "object" && Array.isArray(verdict.issues)
          ? verdict.issues.map((issue) => String(issue))
          : [];
        if (JSON.stringify(issues).length > maxValidationIssueChars) {
          throw new AgentDefinitionBlock("validation_issue_limit", "Structured output validation issues exceed the configured bound.");
        }
        throw new AgentDefinitionBlock("structured_output_invalid", "Structured output does not satisfy its registered schema.", { issues });
      }
      outputValidationCount += 1;
      return Object.freeze({
        status: "valid",
        agentId: record.id,
        revision: record.revision,
        mode: "structured",
        schemaId: record.output.schemaId,
        output: normalizedOutput,
      });
    } catch (error) {
      blockedOutputCount += 1;
      const failure = error instanceof AgentDefinitionBlock
        ? error
        : new AgentDefinitionBlock("agent_output_invalid", error instanceof Error ? error.message : String(error));
      return blocked(agentId, record?.revision || revision, "output", failure);
    }
  }

  function remove({ agentId, revision } = {}) {
    const record = requireRecord(definitions, agentId, revision);
    return definitions.delete(record.id);
  }

  function stats() {
    return Object.freeze({
      agents: definitions.size,
      registrationCount,
      replacementCount,
      preparationCount,
      blockedPreparationCount,
      outputValidationCount,
      blockedOutputCount,
      sourceVerifierConfigured: typeof verifyDefinitionSource === "function",
      capabilityAuthorizerConfigured: typeof authorizeCapability === "function",
      outputValidatorConfigured: typeof validateStructuredOutput === "function",
      ...limits,
    });
  }

  return Object.freeze({ register, prepare, validateOutput, remove, stats });
}

export const AGENT_DEFINITION_DEFAULTS = Object.freeze({
  maxAgents: DEFAULT_MAX_AGENTS,
  maxInstructions: DEFAULT_MAX_INSTRUCTIONS,
  maxReferences: DEFAULT_MAX_REFERENCES,
  maxDefinitionChars: DEFAULT_MAX_DEFINITION_CHARS,
  maxInstructionChars: DEFAULT_MAX_INSTRUCTION_CHARS,
  maxOutputChars: DEFAULT_MAX_OUTPUT_CHARS,
  maxValidationIssueChars: DEFAULT_MAX_VALIDATION_ISSUE_CHARS,
});
