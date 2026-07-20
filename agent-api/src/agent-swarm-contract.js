import { normalizeJson, serializedJsonLength } from "./json-contract.js";
import { normalizeCostLog } from "./running-agent-contract.js";

export const AGENT_SWARM_RUN_SCHEMA = "agent-swarm-run/v1";

export const AGENT_SWARM_DEFAULTS = Object.freeze({
  maxTasks: 32,
  maxParallel: 8,
  maxAttempts: 2,
  maxWaves: 12,
  maxGoalChars: 40_000,
  maxInputChars: 100_000,
  maxTaskChars: 40_000,
  maxOutputChars: 160_000,
  maxLedgerChars: 500_000,
  maxEvents: 512,
  taskTimeoutMs: 60_000,
  taskLeaseMs: 90_000,
  runTtlMs: 30 * 60_000,
  storeClaimTtlMs: 10_000,
  storeClaimAttempts: 8,
  storeClaimRetryMs: 5,
});

const TERMINAL_TASK_STATUSES = new Set(["completed", "failed", "skipped", "canceled"]);
const EFFECTS = new Set(["read-only", "idempotent"]);

export class AgentSwarmBlock extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = "AgentSwarmBlock";
    this.reasonCode = reasonCode;
  }
}

export function assertPositiveInteger(value, field) {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${field} must be a positive integer.`);
  return value;
}

export function assertIdentifier(value, field, maxChars = 256) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} must be a non-empty string.`);
  const normalized = value.trim();
  if (normalized.length > maxChars) throw new RangeError(`${field} exceeds ${maxChars} characters.`);
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

function normalizeAgent(value, field = "agent") {
  assertExactKeys(value, ["agentId", "revision"], field);
  return Object.freeze({
    agentId: assertIdentifier(value.agentId, `${field}.agentId`),
    revision: assertIdentifier(value.revision, `${field}.revision`),
  });
}

function normalizeSignal(value, field) {
  if (value !== undefined && (
    typeof value?.aborted !== "boolean"
    || typeof value?.addEventListener !== "function"
    || typeof value?.removeEventListener !== "function"
  )) {
    throw new TypeError(`${field} must be an AbortSignal when provided.`);
  }
  return value;
}

export function normalizeAccessContext(value = {}) {
  assertExactKeys(value, ["principalId", "principalExpiresAt"], "access context");
  if (value.principalExpiresAt !== undefined && !Number.isFinite(value.principalExpiresAt)) {
    throw new TypeError("access context.principalExpiresAt must be a finite timestamp when provided.");
  }
  return Object.freeze({
    principalId: assertIdentifier(value.principalId ?? "application-local", "access context.principalId"),
    ...(value.principalExpiresAt === undefined ? {} : { principalExpiresAt: value.principalExpiresAt }),
  });
}

export function normalizeStartRequest(value, limits) {
  assertExactKeys(value, [
    "runId",
    "conversationId",
    "agent",
    "goal",
    "input",
    "maxParallel",
    "signal",
  ], "request");
  const goal = assertIdentifier(value.goal, "request.goal", limits.maxGoalChars);
  const maxParallel = value.maxParallel === undefined ? limits.maxParallel : value.maxParallel;
  assertPositiveInteger(maxParallel, "request.maxParallel");
  if (maxParallel > limits.maxParallel) {
    throw new RangeError(`request.maxParallel exceeds ${limits.maxParallel}.`);
  }
  return Object.freeze({
    runId: assertIdentifier(value.runId, "request.runId"),
    conversationId: assertIdentifier(value.conversationId, "request.conversationId"),
    agent: normalizeAgent(value.agent, "request.agent"),
    goal,
    input: normalizeBoundedJson(value.input ?? null, "request.input", limits.maxInputChars),
    maxParallel,
    signal: normalizeSignal(value.signal, "request.signal"),
  });
}

export function normalizeWorkRequest(value) {
  assertExactKeys(value, ["runId", "workerId", "operationId", "signal"], "request");
  return Object.freeze({
    runId: assertIdentifier(value.runId, "request.runId"),
    workerId: assertIdentifier(value.workerId, "request.workerId"),
    operationId: assertIdentifier(value.operationId, "request.operationId"),
    signal: normalizeSignal(value.signal, "request.signal"),
  });
}

export function normalizeRunOperation(value, { reason = false, signal = false } = {}) {
  const keys = ["runId", "operationId", ...(reason ? ["reason"] : []), ...(signal ? ["signal"] : [])];
  assertExactKeys(value, keys, "request");
  return Object.freeze({
    runId: assertIdentifier(value.runId, "request.runId"),
    operationId: assertIdentifier(value.operationId, "request.operationId"),
    ...(reason ? { reason: assertIdentifier(value.reason ?? "operator_cancelled", "request.reason", 512) } : {}),
    ...(signal ? { signal: normalizeSignal(value.signal, "request.signal") } : {}),
  });
}

export function normalizeAuthorization(value) {
  assertExactKeys(value, ["allowed", "approvalId", "reasonCode"], "authorization");
  if (value.allowed !== true) {
    throw new AgentSwarmBlock(
      value.reasonCode === undefined ? "swarm_denied" : assertIdentifier(value.reasonCode, "authorization.reasonCode"),
      "Application policy denied the Agent Swarm run.",
    );
  }
  return Object.freeze({ approvalId: assertIdentifier(value.approvalId, "authorization.approvalId") });
}

export function normalizeAgentResolution(value, expectedAgent) {
  assertExactKeys(value, ["status", "agentId", "revision"], "agent resolution");
  if (value.status !== "ready") {
    throw new AgentSwarmBlock("agent_unavailable", "The base agent could not be verified.");
  }
  const agentId = assertIdentifier(value.agentId, "agent resolution.agentId");
  const revision = assertIdentifier(value.revision, "agent resolution.revision");
  if (agentId !== expectedAgent.agentId || revision !== expectedAgent.revision) {
    throw new AgentSwarmBlock("agent_revision_mismatch", "The verified base agent identity changed.");
  }
  return Object.freeze({ agentId, revision });
}

function normalizeTask(value, index, limits) {
  const field = `plan.tasks[${index}]`;
  assertExactKeys(value, ["taskId", "objective", "dependencies", "context"], field);
  if (!Array.isArray(value.dependencies)) throw new TypeError(`${field}.dependencies must be an array.`);
  return {
    taskId: assertIdentifier(value.taskId, `${field}.taskId`),
    objective: assertIdentifier(value.objective, `${field}.objective`, limits.maxTaskChars),
    dependencies: [...new Set(value.dependencies.map((dependency, dependencyIndex) => (
      assertIdentifier(dependency, `${field}.dependencies[${dependencyIndex}]`)
    )))],
    context: normalizeBoundedJson(value.context ?? null, `${field}.context`, limits.maxTaskChars),
    order: index,
  };
}

function assignWaves(tasks, limits) {
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  for (const task of tasks) {
    for (const dependency of task.dependencies) {
      if (!byId.has(dependency)) throw new TypeError(`Task ${task.taskId} depends on unknown task ${dependency}.`);
      if (dependency === task.taskId) throw new TypeError(`Task ${task.taskId} cannot depend on itself.`);
    }
  }
  const unresolved = new Set(tasks.map((task) => task.taskId));
  const waves = new Map();
  while (unresolved.size > 0) {
    let changed = false;
    for (const task of tasks) {
      if (!unresolved.has(task.taskId) || task.dependencies.some((dependency) => !waves.has(dependency))) continue;
      const wave = task.dependencies.length === 0
        ? 1
        : Math.max(...task.dependencies.map((dependency) => waves.get(dependency))) + 1;
      if (wave > limits.maxWaves) throw new RangeError(`Dynamic plan exceeds ${limits.maxWaves} dependency waves.`);
      waves.set(task.taskId, wave);
      unresolved.delete(task.taskId);
      changed = true;
    }
    if (!changed) throw new TypeError("Dynamic plan contains a dependency cycle.");
  }
  return tasks.map((task) => Object.freeze({ ...task, wave: waves.get(task.taskId) }));
}

export function normalizePlanOutcome(value, limits) {
  assertExactKeys(value, ["status", "planId", "tasks", "costLog"], "plan");
  if (value.status !== "completed") {
    throw new AgentSwarmBlock("planning_incomplete", "The dynamic planner did not complete.");
  }
  if (!Array.isArray(value.tasks) || value.tasks.length === 0 || value.tasks.length > limits.maxTasks) {
    throw new RangeError(`plan.tasks must contain 1 to ${limits.maxTasks} tasks.`);
  }
  const tasks = value.tasks.map((task, index) => normalizeTask(task, index, limits));
  if (new Set(tasks.map((task) => task.taskId)).size !== tasks.length) {
    throw new TypeError("plan.tasks contains a duplicate taskId.");
  }
  return Object.freeze({
    planId: assertIdentifier(value.planId, "plan.planId"),
    tasks: Object.freeze(assignWaves(tasks, limits)),
    costLog: normalizeCostLog(value.costLog),
  });
}

function normalizeReceipt(value, expectedIdempotencyKey) {
  assertExactKeys(value, ["receiptId", "idempotencyKey"], "worker outcome.receipt");
  const receipt = Object.freeze({
    receiptId: assertIdentifier(value.receiptId, "worker outcome.receipt.receiptId"),
    idempotencyKey: assertIdentifier(value.idempotencyKey, "worker outcome.receipt.idempotencyKey"),
  });
  if (receipt.idempotencyKey !== expectedIdempotencyKey) {
    throw new AgentSwarmBlock("receipt_mismatch", "Worker receipt does not match the stable task idempotency key.");
  }
  return receipt;
}

export function normalizeReceiptVerification(value, expectedReceipt) {
  assertExactKeys(value, ["verified", "receiptId", "idempotencyKey"], "receipt verification");
  if (value.verified !== true) {
    throw new AgentSwarmBlock("receipt_unverified", "The mutation receipt was not verified by its durable owner.");
  }
  const receiptId = assertIdentifier(value.receiptId, "receipt verification.receiptId");
  const idempotencyKey = assertIdentifier(value.idempotencyKey, "receipt verification.idempotencyKey");
  if (receiptId !== expectedReceipt.receiptId || idempotencyKey !== expectedReceipt.idempotencyKey) {
    throw new AgentSwarmBlock("receipt_mismatch", "The durable receipt verification does not match the worker claim.");
  }
  return Object.freeze({ receiptId, idempotencyKey });
}

export function normalizeWorkerOutcome(value, limits, expectedIdempotencyKey) {
  assertExactKeys(value, ["status", "output", "costLog", "effect", "receipt"], "worker outcome");
  if (value.status !== "completed") {
    throw new AgentSwarmBlock("worker_incomplete", "The claimed task did not complete.");
  }
  if (!EFFECTS.has(value.effect)) throw new TypeError("worker outcome.effect is unsupported.");
  if (value.effect === "idempotent" && value.receipt === undefined) {
    throw new AgentSwarmBlock("receipt_missing", "Idempotent worker effects require an execution receipt.");
  }
  if (value.effect === "read-only" && value.receipt !== undefined) {
    throw new TypeError("Read-only worker outcomes cannot attach a mutation receipt.");
  }
  return Object.freeze({
    output: normalizeBoundedJson(value.output, "worker outcome.output", limits.maxOutputChars),
    effect: value.effect,
    ...(value.receipt === undefined ? {} : { receipt: normalizeReceipt(value.receipt, expectedIdempotencyKey) }),
    costLog: normalizeCostLog(value.costLog),
  });
}

export function normalizeSynthesisOutcome(value, limits) {
  assertExactKeys(value, ["status", "output", "costLog"], "synthesis outcome");
  if (value.status !== "completed") {
    throw new AgentSwarmBlock("synthesis_incomplete", "The base agent did not complete synthesis.");
  }
  return Object.freeze({
    output: normalizeBoundedJson(value.output, "synthesis outcome.output", limits.maxOutputChars),
    costLog: normalizeCostLog(value.costLog),
  });
}

export function assertLedgerSize(value, limits) {
  if (serializedJsonLength(value) > limits.maxLedgerChars) {
    throw new AgentSwarmBlock("ledger_capacity", `Agent Swarm ledger exceeds ${limits.maxLedgerChars} characters.`);
  }
  return value;
}

export function isTerminalTask(task) {
  return TERMINAL_TASK_STATUSES.has(task.status);
}
