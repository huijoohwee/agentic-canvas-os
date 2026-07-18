import { normalizeJson, serializedJsonLength } from "./json-contract.js";
import { normalizeCostLog } from "./running-agent-contract.js";

export const ORCHESTRATION_MODES = Object.freeze(["delegate", "handoff"]);
const MODE_SET = new Set(ORCHESTRATION_MODES);

export const AGENT_ORCHESTRATION_DEFAULTS = Object.freeze({
  maxWorkflows: 64,
  maxAgents: 32,
  maxBranches: 128,
  maxConversations: 512,
  maxInputChars: 200_000,
  maxOutputChars: 200_000,
  timeoutMs: 60_000,
});

export class AgentOrchestrationBlock extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = "AgentOrchestrationBlock";
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
  if (normalized.length > 256) throw new RangeError(`${field} exceeds 256 characters.`);
  return normalized;
}

export function assertExactKeys(value, keys, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${field} must be an object.`);
  const unknown = Object.keys(value).filter((key) => !keys.includes(key));
  if (unknown.length) throw new TypeError(`${field} contains unsupported fields: ${unknown.join(", ")}.`);
}

export function normalizeBoundedJson(value, field, maxChars) {
  const normalized = normalizeJson(value, field);
  if (serializedJsonLength(normalized) > maxChars) throw new RangeError(`${field} exceeds ${maxChars} characters.`);
  return normalized;
}

function normalizeAgentReference(value, field) {
  assertExactKeys(value, ["agentId", "revision"], field);
  return Object.freeze({
    agentId: assertIdentifier(value.agentId, `${field}.agentId`),
    revision: assertIdentifier(value.revision, `${field}.revision`),
  });
}

function normalizeSpecialist(value, index) {
  const field = `workflow.specialists[${index}]`;
  assertExactKeys(value, ["agentId", "revision", "responsibility"], field);
  return Object.freeze({
    ...normalizeAgentReference({ agentId: value.agentId, revision: value.revision }, field),
    responsibility: assertIdentifier(value.responsibility, `${field}.responsibility`),
  });
}

function normalizeBranch(value, index, participants, managerAgentId) {
  const field = `workflow.branches[${index}]`;
  assertExactKeys(value, [
    "branchId",
    "sourceAgentId",
    "targetAgentId",
    "mode",
    "conversationOwnerAgentId",
    "finalAnswerAgentId",
  ], field);
  const branch = {
    branchId: assertIdentifier(value.branchId, `${field}.branchId`),
    sourceAgentId: assertIdentifier(value.sourceAgentId, `${field}.sourceAgentId`),
    targetAgentId: assertIdentifier(value.targetAgentId, `${field}.targetAgentId`),
    mode: assertIdentifier(value.mode, `${field}.mode`),
    conversationOwnerAgentId: assertIdentifier(value.conversationOwnerAgentId, `${field}.conversationOwnerAgentId`),
    finalAnswerAgentId: assertIdentifier(value.finalAnswerAgentId, `${field}.finalAnswerAgentId`),
  };
  if (!MODE_SET.has(branch.mode)) throw new TypeError(`${field}.mode is unsupported.`);
  if (!participants.has(branch.sourceAgentId) || !participants.has(branch.targetAgentId)) {
    throw new TypeError(`${field} references an unknown agent.`);
  }
  if (branch.sourceAgentId === branch.targetAgentId) throw new TypeError(`${field} must cross agent ownership.`);
  if (branch.mode === "delegate" && branch.targetAgentId === managerAgentId) {
    throw new TypeError(`${field} cannot use the root manager as a behind-manager specialist.`);
  }
  const expectedOwner = branch.mode === "delegate" ? branch.sourceAgentId : branch.targetAgentId;
  if (branch.conversationOwnerAgentId !== expectedOwner || branch.finalAnswerAgentId !== expectedOwner) {
    throw new TypeError(`${field} ownership contradicts its ${branch.mode} mode.`);
  }
  return Object.freeze(branch);
}

export function normalizeWorkflow(value, limits) {
  assertExactKeys(value, ["workflowId", "revision", "manager", "specialists", "branches"], "workflow");
  const manager = normalizeAgentReference(value.manager, "workflow.manager");
  if (!Array.isArray(value.specialists) || value.specialists.length === 0 || value.specialists.length >= limits.maxAgents) {
    throw new RangeError(`workflow.specialists must contain 1 to ${limits.maxAgents - 1} entries.`);
  }
  const specialists = value.specialists.map(normalizeSpecialist);
  const participants = new Map([[manager.agentId, manager]]);
  for (const specialist of specialists) {
    if (participants.has(specialist.agentId)) throw new TypeError(`Duplicate workflow agent: ${specialist.agentId}.`);
    participants.set(specialist.agentId, specialist);
  }
  if (!Array.isArray(value.branches) || value.branches.length === 0 || value.branches.length > limits.maxBranches) {
    throw new RangeError(`workflow.branches must contain 1 to ${limits.maxBranches} entries.`);
  }
  const branches = value.branches.map((branch, index) => normalizeBranch(branch, index, participants, manager.agentId));
  if (new Set(branches.map((branch) => branch.branchId)).size !== branches.length) {
    throw new TypeError("workflow.branches contains a duplicate branchId.");
  }
  const reachable = new Set([manager.agentId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const branch of branches) {
      if (reachable.has(branch.sourceAgentId) && !reachable.has(branch.targetAgentId)) {
        reachable.add(branch.targetAgentId);
        changed = true;
      }
    }
  }
  const orphan = specialists.find((specialist) => !reachable.has(specialist.agentId));
  if (orphan) throw new TypeError(`Specialist ${orphan.agentId} is unreachable from the manager.`);
  return Object.freeze({
    workflowId: assertIdentifier(value.workflowId, "workflow.workflowId"),
    revision: assertIdentifier(value.revision, "workflow.revision"),
    manager,
    specialists: Object.freeze(specialists),
    branches: Object.freeze(branches),
    participants,
  });
}

export function normalizeRunRequest(value, maxInputChars) {
  assertExactKeys(value, [
    "runId",
    "conversationId",
    "workflowId",
    "workflowRevision",
    "branchId",
    "input",
    "signal",
  ], "request");
  if (value.signal !== undefined && typeof value.signal?.aborted !== "boolean") {
    throw new TypeError("request.signal must be an AbortSignal when provided.");
  }
  return Object.freeze({
    runId: assertIdentifier(value.runId, "request.runId"),
    conversationId: assertIdentifier(value.conversationId, "request.conversationId"),
    workflowId: assertIdentifier(value.workflowId, "request.workflowId"),
    workflowRevision: assertIdentifier(value.workflowRevision, "request.workflowRevision"),
    branchId: assertIdentifier(value.branchId, "request.branchId"),
    input: normalizeBoundedJson(value.input, "request.input", maxInputChars),
    signal: value.signal,
  });
}

export function normalizeAuthorization(value) {
  assertExactKeys(value, ["allowed", "approvalId", "reasonCode"], "authorization");
  if (value.allowed !== true) {
    throw new AgentOrchestrationBlock(
      value.reasonCode === undefined ? "orchestration_denied" : assertIdentifier(value.reasonCode, "authorization.reasonCode"),
      "Application policy denied the orchestration branch.",
    );
  }
  return Object.freeze({ approvalId: assertIdentifier(value.approvalId, "authorization.approvalId") });
}

export function normalizeResolvedAgent(value, expected) {
  assertExactKeys(value, ["status", "agentId", "revision"], "resolved agent");
  if (value.status !== "ready" || value.agentId !== expected.agentId || value.revision !== expected.revision) {
    throw new AgentOrchestrationBlock("agent_resolution_mismatch", "Resolved agent identity does not match the workflow.");
  }
  return Object.freeze({ agentId: expected.agentId, revision: expected.revision });
}

export function normalizeAgentOutcome(value, maxOutputChars) {
  assertExactKeys(value, ["status", "output", "costLog"], "agent outcome");
  if (value.status !== "completed") {
    throw new AgentOrchestrationBlock("agent_outcome_incomplete", "An orchestration agent did not complete its assigned stage.");
  }
  return Object.freeze({
    output: normalizeBoundedJson(value.output, "agent outcome.output", maxOutputChars),
    costLog: normalizeCostLog(value.costLog),
  });
}
