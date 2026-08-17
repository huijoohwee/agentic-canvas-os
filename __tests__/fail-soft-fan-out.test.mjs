import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_FAN_OUT_TIMEOUT_MS,
  FAIL_SOFT_FAN_OUT_SCHEMA,
  MAX_FAN_OUT_TIMEOUT_MS,
  failSoftBranchFailure,
  failSoftFanOut,
  fanOutUnavailableResult,
} from "../src/fail-soft-fan-out.js";

test("settles every branch, preserves successful values, and returns a sanitized audit trail", async () => {
  let releaseSlow;
  const slow = new Promise((resolve) => { releaseSlow = resolve; });
  const attempted = [];
  const run = failSoftFanOut(["slow", "broken", "fast"], async (branch) => {
    attempted.push(branch);
    if (branch === "slow") await slow;
    if (branch === "broken") {
      throw failSoftBranchFailure("branch_unavailable", { retryable: true });
    }
    return `${branch}-value`;
  });

  await Promise.resolve();
  assert.deepEqual(attempted, ["slow", "broken", "fast"], "all branches launch independently");
  releaseSlow();
  const result = await run;

  assert.equal(result.schema, FAIL_SOFT_FAN_OUT_SCHEMA);
  assert.equal(result.failurePolicy, "fail-soft");
  assert.equal(result.settlement, "bounded-all-branches-settled");
  assert.equal(result.status, "partial");
  assert.deepEqual(
    { attempted: result.attempted, succeeded: result.succeeded, failed: result.failed },
    { attempted: 3, succeeded: 2, failed: 1 },
  );
  assert.deepEqual(result.outcomes, [
    { branchId: "branch-1", status: "succeeded", value: "slow-value" },
    { branchId: "branch-2", status: "failed", reasonCode: "branch_unavailable", retryable: true },
    { branchId: "branch-3", status: "succeeded", value: "fast-value" },
  ]);
  assert.deepEqual(result.auditTrail, [
    { branchId: "branch-1", status: "succeeded" },
    { branchId: "branch-2", status: "failed", reasonCode: "branch_unavailable", retryable: true },
    { branchId: "branch-3", status: "succeeded" },
  ]);
});

test("all-branch failure is a settled result rather than an aggregate rejection", async () => {
  const result = await failSoftFanOut([1, 2], () => {
    throw new Error("unavailable");
  });

  assert.equal(result.status, "failed");
  assert.deepEqual(
    { attempted: result.attempted, succeeded: result.succeeded, failed: result.failed },
    { attempted: 2, succeeded: 0, failed: 2 },
  );
  assert.equal(result.auditTrail.every((entry) => entry.reasonCode === "branch_failed"), true);
});

test("audit records use unique ordinals and a fixed reason taxonomy", async () => {
  const result = await failSoftFanOut(["sk_live_4N7x0p", "sk_live_4N7x0p"], (branch, index) => {
    if (index === 0) throw new Error(`raw provider error ${branch}`);
    throw failSoftBranchFailure("sk_live_4N7x0p", { retryable: true });
  });

  assert.deepEqual(result.auditTrail, [
    { branchId: "branch-1", status: "failed", reasonCode: "branch_failed", retryable: false },
    { branchId: "branch-2", status: "failed", reasonCode: "branch_failed", retryable: true },
  ]);
  assert.equal(new Set(result.auditTrail.map((entry) => entry.branchId)).size, 2);
  assert.equal(JSON.stringify(result).includes("sk_live_4N7x0p"), false);
  assert.equal(JSON.stringify(result).includes("raw provider error"), false);
});

test("a never-settling branch times out without erasing a successful sibling", async () => {
  let timedOutSignal;
  const result = await failSoftFanOut(["stalled", "healthy"], (branch, index, signal) => {
    if (branch === "stalled") {
      timedOutSignal = signal;
      return new Promise(() => {});
    }
    return "available";
  }, { timeoutMs: 10 });

  assert.equal(result.status, "partial");
  assert.deepEqual(
    { attempted: result.attempted, succeeded: result.succeeded, failed: result.failed, timedOut: result.timedOut },
    { attempted: 2, succeeded: 1, failed: 1, timedOut: 1 },
  );
  assert.equal(timedOutSignal.aborted, true);
  assert.deepEqual(result.auditTrail, [
    { branchId: "branch-1", status: "failed", reasonCode: "branch_timed_out", retryable: true },
    { branchId: "branch-2", status: "succeeded" },
  ]);
});

test("parent cancellation settles every scheduled branch with typed metrics", async () => {
  const controller = new AbortController();
  controller.abort();
  let dispatches = 0;
  const result = await failSoftFanOut([1, 2], () => {
    dispatches += 1;
  }, { signal: controller.signal });

  assert.equal(dispatches, 0);
  assert.equal(result.dispatched, 0);
  assert.equal(result.canceledBeforeDispatch, 2);
  assert.equal(result.canceled, 2);
  assert.equal(result.failed, 2);
  assert.equal(result.auditTrail.every((entry) => entry.reasonCode === "branch_canceled"), true);
  assert.equal(DEFAULT_FAN_OUT_TIMEOUT_MS, 60_000);
});

test("parent cancellation before the dispatch microtask prevents adapter entry", async () => {
  const controller = new AbortController();
  let dispatches = 0;
  const run = failSoftFanOut([1, 2], () => {
    dispatches += 1;
  }, { signal: controller.signal });

  controller.abort();
  const result = await run;

  assert.equal(dispatches, 0);
  assert.equal(result.dispatched, 0);
  assert.equal(result.canceledBeforeDispatch, 2);
  assert.equal(result.canceled, 2);
  assert.equal(result.failed, 2);
  assert.equal(result.auditTrail.every((entry) => entry.reasonCode === "branch_canceled"), true);
});

test("adapter setup failure is visible without fabricating a recipient attempt", () => {
  const result = fanOutUnavailableResult("recipient_enumeration_failed", { retryable: true });

  assert.equal(result.status, "failed");
  assert.equal(result.attempted, 0);
  assert.equal(result.dispatched, 0);
  assert.equal(result.failed, 0);
  assert.equal(result.timedOut, 0);
  assert.equal(result.canceled, 0);
  assert.equal(result.setupFailures, 1);
  assert.deepEqual(result.auditTrail, [{
    branchId: "fanout-setup",
    status: "failed",
    reasonCode: "recipient_enumeration_failed",
    retryable: true,
  }]);
});

test("rejects timer values that hosts would overflow and clamp", async () => {
  await assert.rejects(
    () => failSoftFanOut([1], () => new Promise(() => {}), { timeoutMs: MAX_FAN_OUT_TIMEOUT_MS + 1 }),
    /no greater than/,
  );
});

test("setup audit rejects token-shaped caller text", () => {
  const result = fanOutUnavailableResult("sk_live_4N7x0p", { retryable: true });
  assert.equal(result.auditTrail[0].reasonCode, "fanout_unavailable");
  assert.equal(JSON.stringify(result).includes("sk_live_4N7x0p"), false);
});
