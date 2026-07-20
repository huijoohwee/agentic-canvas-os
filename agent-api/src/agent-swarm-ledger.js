import { createHash } from "node:crypto";

import {
  AGENT_SWARM_RUN_SCHEMA,
  AgentSwarmBlock,
  assertLedgerSize,
  isTerminalTask,
} from "./agent-swarm-contract.js";
import { aggregateCosts } from "./running-agent-contract.js";

function iso(at) {
  return new Date(at).toISOString();
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function taskExecutionId(runId, taskId, attempt) {
  return `swarm-task-${digest([runId, taskId, attempt]).slice(0, 48)}`;
}

function taskIdempotencyKey(runId, taskId) {
  return `swarm-effect-${digest([runId, taskId]).slice(0, 48)}`;
}

function appendEvent(ledger, limits, at, type, fields = {}) {
  if (ledger.events.length >= limits.maxEvents) {
    ledger.traceTruncated = true;
    return;
  }
  ledger.events.push({ sequence: ledger.events.length + 1, at: iso(at), type, ...fields });
}

function touch(ledger, limits, at) {
  ledger.updatedAt = iso(at);
  ledger.expiresAt = ledger.deadlineAt;
  return assertLedgerSize(ledger, limits);
}

function clearExecution(task) {
  delete task.workerId;
  delete task.executionId;
  delete task.leaseExpiresAt;
  delete task.startedAt;
}

function taskCounts(tasks) {
  return tasks.reduce((counts, task) => {
    counts[task.status] = (counts[task.status] || 0) + 1;
    return counts;
  }, {});
}

function skipBlockedDependencies(ledger, limits, at) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of ledger.tasks) {
      if (task.status !== "pending") continue;
      const dependency = task.dependencies
        .map((dependencyId) => ledger.tasks.find((candidate) => candidate.taskId === dependencyId))
        .find((candidate) => candidate && isTerminalTask(candidate) && candidate.status !== "completed");
      if (!dependency) continue;
      task.status = "skipped";
      task.reasonCode = "dependency_incomplete";
      task.completedAt = iso(at);
      appendEvent(ledger, limits, at, "task_skipped", { taskId: task.taskId, dependencyTaskId: dependency.taskId });
      changed = true;
    }
  }
}

export function recoverSwarmLedger(ledger, limits, at) {
  if (ledger.status === "synthesizing" && ledger.synthesis?.leaseExpiresAt <= at) {
    if (ledger.synthesis.attempts < limits.maxAttempts) {
      ledger.status = "running";
      ledger.synthesis.status = "pending";
      delete ledger.synthesis.executionId;
      delete ledger.synthesis.leaseExpiresAt;
      ledger.metrics.retries += 1;
      appendEvent(ledger, limits, at, "synthesis_recovered");
    } else {
      ledger.status = "blocked";
      ledger.reasonCode = "synthesis_attempts_exhausted";
      appendEvent(ledger, limits, at, "run_blocked", { reasonCode: ledger.reasonCode });
    }
  }
  for (const task of ledger.tasks) {
    if (task.status !== "running" || task.leaseExpiresAt > at) continue;
    if (task.attempts < limits.maxAttempts) {
      task.status = "pending";
      clearExecution(task);
      ledger.metrics.retries += 1;
      appendEvent(ledger, limits, at, "task_recovered", { taskId: task.taskId, attempt: task.attempts });
    } else {
      task.status = "failed";
      task.reasonCode = "task_attempts_exhausted";
      task.completedAt = iso(at);
      clearExecution(task);
      appendEvent(ledger, limits, at, "task_failed", { taskId: task.taskId, reasonCode: task.reasonCode });
    }
  }
  skipBlockedDependencies(ledger, limits, at);
  ledger.metrics.activeClaims = ledger.tasks.filter((task) => task.status === "running").length;
  return touch(ledger, limits, at);
}

export function createSwarmLedger({ request, plan, authorization, principalId, limits, admittedAt, at }) {
  const ledger = {
    schema: AGENT_SWARM_RUN_SCHEMA,
    runId: request.runId,
    conversationId: request.conversationId,
    agent: request.agent,
    goal: request.goal,
    input: request.input,
    maxParallel: request.maxParallel,
    status: "running",
    authorization,
    ownerPrincipalId: principalId,
    planId: plan.planId,
    createdAt: iso(admittedAt),
    updatedAt: iso(at),
    deadlineAt: admittedAt + limits.runTtlMs,
    expiresAt: admittedAt + limits.runTtlMs,
    tasks: plan.tasks.map((task) => ({
      taskId: task.taskId,
      objective: task.objective,
      dependencies: task.dependencies,
      context: task.context,
      order: task.order,
      wave: task.wave,
      status: "pending",
      attempts: 0,
      idempotencyKey: taskIdempotencyKey(request.runId, task.taskId),
    })),
    synthesis: { status: "pending", attempts: 0 },
    costLogs: [plan.costLog],
    attemptedCalls: 1,
    metrics: {
      claimedTasks: 0,
      workerCalls: 0,
      synthesisCalls: 0,
      activeClaims: 0,
      peakClaimedWorkers: 0,
      retries: 0,
    },
    events: [],
    traceTruncated: false,
  };
  appendEvent(ledger, limits, at, "run_planned", {
    taskCount: ledger.tasks.length,
    waveCount: Math.max(...ledger.tasks.map((task) => task.wave)),
  });
  return touch(ledger, limits, at);
}

export function claimSwarmTask(ledger, { workerId, limits, at }) {
  recoverSwarmLedger(ledger, limits, at);
  if (ledger.status !== "running") return null;
  if (at + limits.taskLeaseMs >= ledger.deadlineAt) {
    if (ledger.metrics.activeClaims === 0 && ledger.tasks.some((task) => task.status === "pending")) {
      blockSwarmLedger(ledger, "run_deadline_capacity", limits, at);
    }
    return null;
  }
  if (ledger.metrics.activeClaims >= ledger.maxParallel) return null;
  const task = ledger.tasks.find((candidate) => (
    candidate.status === "pending"
    && candidate.dependencies.every((dependencyId) => (
      ledger.tasks.find((dependency) => dependency.taskId === dependencyId)?.status === "completed"
    ))
  ));
  if (!task) return null;
  if (task.reasonCode) {
    task.lastReasonCode = task.reasonCode;
    delete task.reasonCode;
  }
  task.status = "running";
  task.attempts += 1;
  task.workerId = workerId;
  task.executionId = taskExecutionId(ledger.runId, task.taskId, task.attempts);
  task.leaseExpiresAt = at + limits.taskLeaseMs;
  task.startedAt = iso(at);
  ledger.attemptedCalls += 1;
  ledger.metrics.claimedTasks += 1;
  ledger.metrics.workerCalls += 1;
  ledger.metrics.activeClaims += 1;
  ledger.metrics.peakClaimedWorkers = Math.max(ledger.metrics.peakClaimedWorkers, ledger.metrics.activeClaims);
  appendEvent(ledger, limits, at, "task_claimed", {
    taskId: task.taskId,
    workerId,
    attempt: task.attempts,
    executionId: task.executionId,
  });
  touch(ledger, limits, at);
  const dependencyResults = task.dependencies.map((dependencyId) => {
    const dependency = ledger.tasks.find((candidate) => candidate.taskId === dependencyId);
    return { taskId: dependency.taskId, output: dependency.output, resultDigest: dependency.resultDigest };
  });
  return {
    task: {
      taskId: task.taskId,
      objective: task.objective,
      context: task.context,
      wave: task.wave,
      attempt: task.attempts,
      executionId: task.executionId,
      idempotencyKey: task.idempotencyKey,
      leaseExpiresAt: task.leaseExpiresAt,
      dependencyResults,
    },
    execution: {
      runId: ledger.runId,
      conversationId: ledger.conversationId,
      agent: ledger.agent,
      goal: ledger.goal,
      deadlineAt: ledger.deadlineAt,
    },
  };
}

export function completeSwarmTask(ledger, executionId, outcome, limits, at) {
  const task = ledger.tasks.find((candidate) => candidate.executionId === executionId && candidate.status === "running");
  if (!task || ledger.status !== "running") return null;
  if (task.leaseExpiresAt <= at + limits.storeClaimTtlMs) {
    task.leaseExpiresAt = at;
    recoverSwarmLedger(ledger, limits, at);
    return null;
  }
  task.status = "completed";
  delete task.reasonCode;
  task.output = outcome.output;
  task.resultDigest = digest(outcome.output);
  task.effect = outcome.effect;
  if (outcome.receipt) task.receipt = outcome.receipt;
  task.completedByWorkerId = task.workerId;
  task.completedAt = iso(at);
  task.costLog = outcome.costLog;
  ledger.costLogs.push(outcome.costLog);
  clearExecution(task);
  ledger.metrics.activeClaims = Math.max(0, ledger.metrics.activeClaims - 1);
  appendEvent(ledger, limits, at, "task_completed", { taskId: task.taskId, resultDigest: task.resultDigest });
  touch(ledger, limits, at);
  return task.resultDigest;
}

export function failSwarmTask(ledger, executionId, reasonCode, limits, at) {
  const task = ledger.tasks.find((candidate) => candidate.executionId === executionId && candidate.status === "running");
  if (!task || ledger.status !== "running") return { accepted: false, retryable: false };
  if (task.leaseExpiresAt <= at + limits.storeClaimTtlMs) {
    task.leaseExpiresAt = at;
    recoverSwarmLedger(ledger, limits, at);
    return { accepted: false, retryable: false };
  }
  const retryable = task.attempts < limits.maxAttempts;
  task.lastWorkerId = task.workerId;
  task.status = retryable ? "pending" : "failed";
  task.reasonCode = reasonCode;
  if (!retryable) task.completedAt = iso(at);
  clearExecution(task);
  ledger.metrics.activeClaims = Math.max(0, ledger.metrics.activeClaims - 1);
  if (retryable) ledger.metrics.retries += 1;
  appendEvent(ledger, limits, at, retryable ? "task_retry_scheduled" : "task_failed", {
    taskId: task.taskId,
    reasonCode,
    attempt: task.attempts,
  });
  skipBlockedDependencies(ledger, limits, at);
  touch(ledger, limits, at);
  return { accepted: true, retryable };
}

export function claimSwarmSynthesis(ledger, limits, at) {
  recoverSwarmLedger(ledger, limits, at);
  if (["completed", "blocked", "canceled"].includes(ledger.status)) return { terminal: true };
  if (ledger.tasks.some((task) => !isTerminalTask(task))) return { pending: true };
  const completed = ledger.tasks.filter((task) => task.status === "completed");
  if (completed.length === 0) {
    ledger.status = "blocked";
    ledger.reasonCode = "no_completed_tasks";
    appendEvent(ledger, limits, at, "run_blocked", { reasonCode: ledger.reasonCode });
    touch(ledger, limits, at);
    return { terminal: true };
  }
  if (ledger.status === "synthesizing") return { pending: true };
  if (at + limits.taskLeaseMs >= ledger.deadlineAt) {
    blockSwarmLedger(ledger, "run_deadline_capacity", limits, at);
    return { terminal: true };
  }
  ledger.status = "synthesizing";
  ledger.synthesis.status = "running";
  ledger.synthesis.attempts += 1;
  ledger.synthesis.executionId = `${ledger.runId}:synthesis:attempt-${ledger.synthesis.attempts}`;
  ledger.synthesis.leaseExpiresAt = at + limits.taskLeaseMs;
  ledger.attemptedCalls += 1;
  ledger.metrics.synthesisCalls += 1;
  appendEvent(ledger, limits, at, "synthesis_claimed", { attempt: ledger.synthesis.attempts });
  touch(ledger, limits, at);
  return {
    executionId: ledger.synthesis.executionId,
    leaseExpiresAt: ledger.synthesis.leaseExpiresAt,
    deadlineAt: ledger.deadlineAt,
    payload: {
      runId: ledger.runId,
      conversationId: ledger.conversationId,
      agent: ledger.agent,
      goal: ledger.goal,
      input: ledger.input,
      tasks: ledger.tasks.map((task) => ({
        taskId: task.taskId,
        objective: task.objective,
        dependencies: task.dependencies,
        wave: task.wave,
        status: task.status,
        ...(task.status === "completed"
          ? { output: task.output, resultDigest: task.resultDigest, effect: task.effect, ...(task.receipt ? { receipt: task.receipt } : {}) }
          : { reasonCode: task.reasonCode || "incomplete" }),
      })),
    },
  };
}

export function completeSwarmSynthesis(ledger, executionId, outcome, limits, at) {
  if (ledger.status !== "synthesizing" || ledger.synthesis.executionId !== executionId) return false;
  if (ledger.synthesis.leaseExpiresAt <= at + limits.storeClaimTtlMs) {
    ledger.synthesis.leaseExpiresAt = at;
    recoverSwarmLedger(ledger, limits, at);
    return false;
  }
  ledger.status = "completed";
  ledger.synthesis.status = "completed";
  ledger.synthesis.output = outcome.output;
  ledger.synthesis.resultDigest = digest(outcome.output);
  ledger.synthesis.costLog = outcome.costLog;
  delete ledger.synthesis.executionId;
  delete ledger.synthesis.leaseExpiresAt;
  ledger.costLogs.push(outcome.costLog);
  appendEvent(ledger, limits, at, "run_completed", { resultDigest: ledger.synthesis.resultDigest });
  touch(ledger, limits, at);
  return true;
}

export function failSwarmSynthesis(ledger, executionId, reasonCode, limits, at) {
  if (ledger.status !== "synthesizing" || ledger.synthesis.executionId !== executionId) return false;
  if (ledger.synthesis.leaseExpiresAt <= at + limits.storeClaimTtlMs) {
    ledger.synthesis.leaseExpiresAt = at;
    recoverSwarmLedger(ledger, limits, at);
    return false;
  }
  if (ledger.synthesis.attempts < limits.maxAttempts) {
    ledger.status = "running";
    ledger.synthesis.status = "pending";
    ledger.metrics.retries += 1;
    appendEvent(ledger, limits, at, "synthesis_retry_scheduled", { reasonCode });
  } else {
    ledger.status = "blocked";
    ledger.reasonCode = reasonCode;
    ledger.synthesis.status = "failed";
    appendEvent(ledger, limits, at, "run_blocked", { reasonCode });
  }
  delete ledger.synthesis.executionId;
  delete ledger.synthesis.leaseExpiresAt;
  touch(ledger, limits, at);
  return true;
}

export function cancelSwarmLedger(ledger, reason, limits, at) {
  if (["completed", "blocked", "canceled"].includes(ledger.status)) return ledger;
  ledger.status = "canceled";
  ledger.reasonCode = reason;
  for (const task of ledger.tasks) {
    if (task.status !== "pending" && task.status !== "running") continue;
    task.status = "canceled";
    task.reasonCode = reason;
    task.completedAt = iso(at);
    clearExecution(task);
  }
  ledger.metrics.activeClaims = 0;
  appendEvent(ledger, limits, at, "run_canceled", { reasonCode: reason });
  return touch(ledger, limits, at);
}

export function blockSwarmLedger(ledger, reason, limits, at) {
  if (["completed", "blocked", "canceled"].includes(ledger.status)) return ledger;
  ledger.status = "blocked";
  ledger.reasonCode = reason;
  for (const task of ledger.tasks) {
    if (task.status !== "pending" && task.status !== "running") continue;
    task.status = "canceled";
    task.reasonCode = reason;
    task.completedAt = iso(at);
    clearExecution(task);
  }
  if (ledger.synthesis.status === "running") {
    ledger.synthesis.status = "failed";
    delete ledger.synthesis.executionId;
    delete ledger.synthesis.leaseExpiresAt;
  }
  ledger.metrics.activeClaims = 0;
  appendEvent(ledger, limits, at, "run_blocked", { reasonCode: reason });
  return touch(ledger, limits, at);
}

export function projectSwarmLedger(ledger, stateStoreStats = {}) {
  const counts = taskCounts(ledger.tasks);
  const receipts = ledger.tasks
    .filter((task) => task.status === "completed")
    .map((task) => ({
      taskId: task.taskId,
      resultDigest: task.resultDigest,
      effect: task.effect,
      attempts: task.attempts,
      workerId: task.completedByWorkerId,
      ...(task.receipt ? { receiptId: task.receipt.receiptId, idempotencyKey: task.receipt.idempotencyKey } : {}),
    }));
  return Object.freeze({
    status: ledger.status,
    stage: "agent-swarm",
    runId: ledger.runId,
    conversationId: ledger.conversationId,
    agent: ledger.agent,
    finalAnswerOwner: ledger.agent,
    plan: Object.freeze({
      planId: ledger.planId,
      taskCount: ledger.tasks.length,
      waveCount: Math.max(...ledger.tasks.map((task) => task.wave)),
      maxParallel: ledger.maxParallel,
    }),
    tasks: Object.freeze(ledger.tasks.map((task) => Object.freeze({
      taskId: task.taskId,
      objective: task.objective,
      dependencies: task.dependencies,
      wave: task.wave,
      status: task.status,
      attempts: task.attempts,
      ...(task.workerId || task.completedByWorkerId || task.lastWorkerId
        ? { workerId: task.workerId || task.completedByWorkerId || task.lastWorkerId }
        : {}),
      ...(task.reasonCode ? { reasonCode: task.reasonCode } : {}),
    }))),
    counts: Object.freeze(counts),
    metrics: Object.freeze({ ...ledger.metrics }),
    cost: aggregateCosts(ledger.costLogs, ledger.attemptedCalls),
    events: Object.freeze(ledger.events.map((event) => Object.freeze({ ...event }))),
    traceTruncated: ledger.traceTruncated,
    ...(ledger.reasonCode ? { reasonCode: ledger.reasonCode } : {}),
    ...(ledger.status === "completed" ? { output: ledger.synthesis.output } : {}),
    evidence: Object.freeze({
      dynamicPlan: true,
      callerSuppliedRoles: false,
      callerSuppliedWorkflow: false,
      recursiveFanOut: false,
      intermediateWorkerOutputReturned: false,
      peakClaimedWorkers: ledger.metrics.peakClaimedWorkers,
      sequentialFallback: ledger.metrics.peakClaimedWorkers <= 1,
      persistence: stateStoreStats.persistence || "unknown",
      horizontalRecovery: stateStoreStats.horizontalRecovery === true,
      receipts: Object.freeze(receipts),
    }),
  });
}

export function blockedSwarmResult(runId, reasonCode, message, costLogs = [], attemptedCalls = 0) {
  return Object.freeze({
    status: "blocked",
    stage: "agent-swarm",
    runId,
    reasonCode,
    message,
    cost: aggregateCosts(costLogs, attemptedCalls),
  });
}

export function requireLedger(value, runId) {
  if (!value) throw new AgentSwarmBlock("run_missing", `Agent Swarm run ${runId} is unavailable.`);
  if (value.schema !== AGENT_SWARM_RUN_SCHEMA || value.runId !== runId) {
    throw new AgentSwarmBlock("ledger_invalid", "Agent Swarm durable ledger identity is invalid.");
  }
  return value;
}

export function requireLedgerOwner(ledger, principalId) {
  if (ledger.ownerPrincipalId !== principalId) {
    throw new AgentSwarmBlock("run_forbidden", "Agent Swarm run belongs to another authenticated principal.");
  }
  return ledger;
}
