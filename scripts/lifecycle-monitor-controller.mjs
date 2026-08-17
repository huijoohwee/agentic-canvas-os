// Responsibility: Run sequential read-only lifecycle observations until a typed terminal checkpoint.
import { setTimeout as waitForTimeout } from "node:timers/promises";

import {
  advanceLifecycleMonitor,
  blockLifecycleMonitor,
  createLifecycleMonitorCheckpoint,
  digestValue,
  normalizeLifecycleMonitorCheckpoint,
  normalizeLifecycleMonitorRequest,
  stopLifecycleMonitor,
  stopLifecycleMonitorIfBudgetExhausted,
} from "./lifecycle-monitor-contract.mjs";

export const LIFECYCLE_MONITOR_RESULT_SCHEMA = "agentic-lifecycle-monitor-result/v1";

const TERMINAL_STATUSES = new Set(["ready", "blocked", "stopped"]);

export async function monitorLifecycle({
  request,
  readObservation,
  checkpoint = null,
  now = () => new Date(),
  wait = defaultWait,
  signal = null,
  onCheckpoint = null,
} = {}) {
  const policy = normalizeLifecycleMonitorRequest(request);
  requireFunction(readObservation, "readObservation");
  requireFunction(now, "now");
  requireFunction(wait, "wait");
  if (onCheckpoint !== null) requireFunction(onCheckpoint, "onCheckpoint");
  if (signal !== null && !(signal instanceof AbortSignal)) {
    throw new Error("Lifecycle monitor signal must be an AbortSignal.");
  }
  let current = checkpoint
    ? normalizeLifecycleMonitorCheckpoint(checkpoint, { request: policy })
    : createLifecycleMonitorCheckpoint({ request: policy, evaluatedAt: currentInstant(now) });
  while (!TERMINAL_STATUSES.has(current.status)) {
    if (signal?.aborted) {
      current = stopLifecycleMonitor({
        request: policy,
        priorCheckpoint: current,
        evaluatedAt: nonregressingInstant(now, current),
        classification: "cancelled",
      });
      break;
    }
    current = stopLifecycleMonitorIfBudgetExhausted({
      request: policy,
      priorCheckpoint: current,
      evaluatedAt: nonregressingInstant(now, current),
    });
    if (TERMINAL_STATUSES.has(current.status)) break;
    const delayMs = Math.max(
      0,
      Date.parse(current.nextObservationAt) - Date.parse(currentInstant(now)),
    );
    if (delayMs > 0) {
      try {
        await wait(delayMs, { signal });
      } catch (error) {
        if (signal?.aborted || error?.name === "AbortError") {
          current = stopLifecycleMonitor({
            request: policy,
            priorCheckpoint: current,
            evaluatedAt: nonregressingInstant(now, current),
            classification: "cancelled",
          });
          break;
        }
        current = blockLifecycleMonitor({
          request: policy,
          priorCheckpoint: current,
          evaluatedAt: nonregressingInstant(now, current),
          classification: "scheduler-failed",
        });
        break;
      }
    }
    if (signal?.aborted) continue;
    current = stopLifecycleMonitorIfBudgetExhausted({
      request: policy,
      priorCheckpoint: current,
      evaluatedAt: nonregressingInstant(now, current),
    });
    if (TERMINAL_STATUSES.has(current.status)) break;
    let observation;
    const remainingBudgetMs = policy.budget.maximumElapsedMs
      - (Date.parse(nonregressingInstant(now, current)) - Date.parse(current.startedAt));
    if (remainingBudgetMs <= 0) continue;
    const readBudget = budgetSignal(signal, remainingBudgetMs);
    if (readBudget.signal.aborted) {
      readBudget.dispose();
      current = stopLifecycleMonitor({
        request: policy,
        priorCheckpoint: current,
        evaluatedAt: nonregressingInstant(now, current),
        classification: signal?.aborted ? "cancelled" : "budget-exhausted",
      });
      break;
    }
    try {
      observation = await readObservation({
        request: policy,
        checkpoint: current,
        signal: readBudget.signal,
      });
    } catch (error) {
      if (signal?.aborted) {
        current = stopLifecycleMonitor({
          request: policy,
          priorCheckpoint: current,
          evaluatedAt: nonregressingInstant(now, current),
          classification: "cancelled",
        });
      } else if (readBudget.signal.aborted) {
        current = stopLifecycleMonitor({
          request: policy,
          priorCheckpoint: current,
          evaluatedAt: nonregressingInstant(now, current),
          classification: "budget-exhausted",
        });
      } else {
        current = blockLifecycleMonitor({
          request: policy,
          priorCheckpoint: current,
          evaluatedAt: nonregressingInstant(now, current),
          classification: "observer-failed",
        });
      }
      break;
    } finally {
      readBudget.dispose();
    }
    const observationEvaluatedAt = nonregressingInstant(now, current);
    if (signal?.aborted || readBudget.signal.aborted) {
      current = stopLifecycleMonitor({
        request: policy,
        priorCheckpoint: current,
        evaluatedAt: observationEvaluatedAt,
        classification: signal?.aborted ? "cancelled" : "budget-exhausted",
      });
      break;
    }
    current = advanceLifecycleMonitor({
      request: policy,
      priorCheckpoint: current,
      observation,
      evaluatedAt: observationEvaluatedAt,
    });
    if (onCheckpoint) await onCheckpoint(current);
  }
  return result(current);
}

function result(checkpoint) {
  const core = {
    schema: LIFECYCLE_MONITOR_RESULT_SCHEMA,
    status: checkpoint.status,
    classification: checkpoint.classification,
    monitorId: checkpoint.monitorId,
    requestDigest: checkpoint.requestDigest,
    checkpoint,
    checkpointDigest: checkpoint.checkpointDigest,
    resumeSignal: checkpoint.resumeSignal,
    mutationAuthority: false,
  };
  return deepFreeze({ ...core, resultDigest: digestValue(core) });
}

async function defaultWait(milliseconds, { signal } = {}) {
  await waitForTimeout(milliseconds, undefined, { signal: signal || undefined });
}

function currentInstant(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Lifecycle monitor clock is invalid.");
  return date.toISOString();
}

function nonregressingInstant(now, checkpoint) {
  const observed = currentInstant(now);
  return Date.parse(observed) < Date.parse(checkpoint.evaluatedAt)
    ? checkpoint.evaluatedAt : observed;
}

function requireFunction(value, label) {
  if (typeof value !== "function") throw new Error(`Lifecycle monitor ${label} must be a function.`);
}

function budgetSignal(parentSignal, milliseconds) {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  if (parentSignal) {
    parentSignal.addEventListener("abort", abortFromParent, { once: true });
    if (parentSignal.aborted) abortFromParent();
  }
  const timer = setTimeout(() => controller.abort(new Error("elapsed budget exhausted")), milliseconds);
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      if (parentSignal) parentSignal.removeEventListener("abort", abortFromParent);
    },
  };
}

function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
