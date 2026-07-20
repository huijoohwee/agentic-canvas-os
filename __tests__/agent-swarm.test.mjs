import assert from "node:assert/strict";
import test from "node:test";

import { createAgentSwarmMemoryStore, createAgentSwarmRuntime } from "../agent-api/src/agent-swarm.js";

const COST = Object.freeze({ model: "offline-swarm-model", prompt_tokens: 3, completion_tokens: 2, cache_hits: 1, estimated_cost_usd: 0 });

const REQUEST = Object.freeze({
  runId: "swarm-run",
  conversationId: "swarm-conversation",
  agent: Object.freeze({ agentId: "base-agent", revision: "base-agent-v1" }),
  goal: "Investigate the goal and return one verified answer.",
  input: Object.freeze({ source: "offline-fixture" }),
  maxParallel: 2,
});

function task(taskId, dependencies = [], context = null) {
  return { taskId, objective: `Complete ${taskId}.`, dependencies, context };
}

function createHarness({
  tasks = [task("alpha"), task("beta"), task("final", ["alpha", "beta"])],
  executeTask,
  synthesize,
  verifyReceipt,
  resolveAgent,
  stateStore,
  now,
  ...limits
} = {}) {
  const plannerCalls = [];
  const workerCalls = [];
  const synthesisCalls = [];
  const runtime = createAgentSwarmRuntime({
    resolveAgent: resolveAgent || (async ({ agent }) => ({ status: "ready", ...agent })),
    planTasks: async (call) => {
      plannerCalls.push(call);
      return { status: "completed", planId: "dynamic-plan-v1", tasks, costLog: COST };
    },
    executeTask: executeTask || (async (call) => {
      workerCalls.push(call);
      return { status: "completed", output: `${call.input.task.taskId}-result`, effect: "read-only", costLog: COST };
    }),
    synthesize: synthesize || (async (call) => {
      synthesisCalls.push(call);
      return { status: "completed", output: "one public answer", costLog: COST };
    }),
    verifyReceipt: verifyReceipt || (async ({ receipt }) => ({ verified: true, ...receipt })),
    authorize: async () => ({ allowed: true, approvalId: "offline-swarm-approval" }),
    ...(stateStore ? { stateStore } : {}),
    ...(now ? { now } : {}),
    ...limits,
  });
  return { runtime, plannerCalls, workerCalls, synthesisCalls };
}

test("dynamically plans dependency work and records genuine bounded parallel overlap", async () => {
  let active = 0;
  let observedPeak = 0;
  const calls = [];
  const { runtime, plannerCalls, synthesisCalls } = createHarness({
    executeTask: async (call) => {
      calls.push(call);
      active += 1;
      observedPeak = Math.max(observedPeak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return { status: "completed", output: `${call.input.task.taskId}-private`, effect: "read-only", costLog: COST };
    },
  });

  const result = await runtime.run(REQUEST);

  assert.equal(result.status, "completed");
  assert.equal(result.output, "one public answer");
  assert.equal(observedPeak, 2);
  assert.equal(result.metrics.peakClaimedWorkers, 2);
  assert.equal(result.evidence.peakClaimedWorkers, 2);
  assert.equal(result.evidence.sequentialFallback, false);
  assert.equal(result.evidence.dynamicPlan, true);
  assert.equal(result.evidence.callerSuppliedRoles, false);
  assert.equal(result.evidence.callerSuppliedWorkflow, false);
  assert.equal(result.evidence.recursiveFanOut, false);
  assert.equal(result.cost.status, "reported");
  assert.equal(result.cost.reportedSteps, 5);
  assert.deepEqual(calls.map((call) => call.input.task.taskId).sort(), ["alpha", "beta", "final"]);
  assert.equal(calls.find((call) => call.input.task.taskId === "final").input.dependencies.length, 2);
  assert.deepEqual(plannerCalls[0].bounds, { maxTasks: 32, maxParallel: 2, maxWaves: 12, maxAttempts: 2 });
  assert.equal("roles" in plannerCalls[0], false);
  assert.equal("workflow" in plannerCalls[0], false);
  assert.equal(calls.some((call) => "role" in call || "workflow" in call), false);
  for (const independent of calls.filter((call) => ["alpha", "beta"].includes(call.input.task.taskId))) {
    assert.deepEqual(independent.input.dependencies, []);
    assert.equal("tasks" in independent.input, false);
    assert.equal(JSON.stringify(independent).includes("-private"), false);
  }
  assert.deepEqual(synthesisCalls[0].tasks.map(({ taskId }) => taskId), ["alpha", "beta", "final"]);
  assert.equal(result.tasks.some((item) => Object.hasOwn(item, "output")), false);
  assert.equal(result.evidence.receipts.length, 3);
  assert.equal(result.finalAnswerOwner.agentId, "base-agent");
});

test("falls back to one worker for a small task without changing the public owner", async () => {
  const { runtime } = createHarness({ tasks: [task("only-task")] });
  const result = await runtime.run({ ...REQUEST, runId: "single-run", maxParallel: 2 });
  assert.equal(result.status, "completed");
  assert.equal(result.metrics.peakClaimedWorkers, 1);
  assert.equal(result.evidence.sequentialFallback, true);
  assert.deepEqual(result.finalAnswerOwner, REQUEST.agent);
});

test("rejects caller-supplied roles, workflows, and planner-authored role fields", async () => {
  const { runtime } = createHarness();
  await assert.rejects(
    () => runtime.start({ ...REQUEST, runId: "caller-role-run", roles: ["researcher"] }),
    /unsupported fields: roles/,
  );
  await assert.rejects(
    () => runtime.start({ ...REQUEST, runId: "caller-workflow-run", workflow: { steps: [] } }),
    /unsupported fields: workflow/,
  );
  await assert.rejects(
    () => runtime.work({
      runId: "fake-signal-run",
      workerId: "fake-signal-worker",
      operationId: "fake-signal-op",
      signal: { aborted: false },
    }),
    /must be an AbortSignal/,
  );
  const invalid = createHarness({ tasks: [{ ...task("role-task"), role: "researcher" }] });
  const blocked = await invalid.runtime.start({ ...REQUEST, runId: "planner-role-run" });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.reasonCode, "planning_failed");
  const stale = createHarness({
    resolveAgent: async () => ({ status: "ready", agentId: "base-agent", revision: "stale-revision" }),
  });
  const unresolved = await stale.runtime.start({ ...REQUEST, runId: "stale-agent-run" });
  assert.equal(unresolved.reasonCode, "agent_revision_mismatch");

  await runtime.start({ ...REQUEST, runId: "principal-owned-run" }, { principalId: "session-owner" });
  assert.equal((await runtime.status("principal-owned-run", { principalId: "session-other" })).reasonCode, "run_forbidden");
  assert.equal((await runtime.work({
    runId: "principal-owned-run",
    workerId: "foreign-worker",
    operationId: "foreign-work",
  }, { principalId: "session-other" })).reasonCode, "run_forbidden");
  assert.equal((await runtime.cancel({
    runId: "principal-owned-run",
    operationId: "foreign-cancel",
  }, { principalId: "session-other" })).reasonCode, "run_forbidden");
  assert.equal((await runtime.status("principal-owned-run", { principalId: "session-owner" })).status, "running");
});

test("reserves a run identity before dynamic planning spend", async () => {
  let releasePlanner;
  let plannerStarted;
  let plannerCalls = 0;
  const started = new Promise((resolve) => { plannerStarted = resolve; });
  const released = new Promise((resolve) => { releasePlanner = resolve; });
  const runtime = createAgentSwarmRuntime({
    resolveAgent: async ({ agent }) => ({ status: "ready", ...agent }),
    authorize: async () => ({ allowed: true, approvalId: "start-reservation-approval" }),
    planTasks: async () => {
      plannerCalls += 1;
      plannerStarted();
      await released;
      return { status: "completed", planId: "reserved-plan", tasks: [task("reserved")], costLog: COST };
    },
    executeTask: async () => ({ status: "completed", output: "unused", effect: "read-only", costLog: COST }),
    synthesize: async () => ({ status: "completed", output: "unused", costLog: COST }),
    verifyReceipt: async ({ receipt }) => ({ verified: true, ...receipt }),
  });

  const first = runtime.start({ ...REQUEST, runId: "reserved-run" });
  await started;
  const replay = await runtime.start({ ...REQUEST, runId: "reserved-run" });
  assert.equal(replay.reasonCode, "run_reused");
  assert.equal(plannerCalls, 1);
  releasePlanner();
  assert.equal((await first).status, "running");
});

test("fails closed on cyclic dynamic plans and over-capacity parallel requests", async () => {
  const cyclic = createHarness({ tasks: [task("a", ["b"]), task("b", ["a"])] });
  const blocked = await cyclic.runtime.start({ ...REQUEST, runId: "cycle-run" });
  assert.equal(blocked.reasonCode, "planning_failed");
  await assert.rejects(
    () => cyclic.runtime.start({ ...REQUEST, runId: "wide-run", maxParallel: 9 }),
    /exceeds 8/,
  );

  let deadlineClock = 1_000;
  let deadlineWorkerCalls = 0;
  let deadlineSynthesisCalls = 0;
  const deadlineStore = createAgentSwarmMemoryStore({ now: () => deadlineClock });
  const deadlineHarness = createHarness({
    tasks: [task("deadline-task")],
    stateStore: deadlineStore,
    now: () => deadlineClock,
    runTtlMs: 300,
    taskTimeoutMs: 50,
    taskLeaseMs: 100,
    storeClaimTtlMs: 10,
    executeTask: async () => {
      deadlineWorkerCalls += 1;
      return { status: "completed", output: "too-late", effect: "read-only", costLog: COST };
    },
    synthesize: async () => {
      deadlineSynthesisCalls += 1;
      return { status: "completed", output: "too-late", costLog: COST };
    },
  });
  const shortPrincipal = await deadlineHarness.runtime.start(
    { ...REQUEST, runId: "short-principal-run", maxParallel: 1 },
    { principalId: "short-principal", principalExpiresAt: deadlineClock + 299 },
  );
  assert.equal(shortPrincipal.reasonCode, "session_too_short");
  assert.equal(deadlineHarness.plannerCalls.length, 0);

  await deadlineHarness.runtime.start({ ...REQUEST, runId: "deadline-worker-run", maxParallel: 1 });
  deadlineClock = 1_201;
  const deadlineWork = await deadlineHarness.runtime.work({
    runId: "deadline-worker-run",
    workerId: "deadline-worker",
    operationId: "deadline-work",
  });
  assert.equal(deadlineWork.reasonCode, "run_deadline_capacity");
  assert.equal(deadlineWorkerCalls, 0);

  deadlineClock = 2_000;
  await deadlineHarness.runtime.start({ ...REQUEST, runId: "deadline-synthesis-run", maxParallel: 1 });
  assert.equal((await deadlineHarness.runtime.work({
    runId: "deadline-synthesis-run",
    workerId: "early-worker",
    operationId: "early-work",
  })).status, "completed");
  deadlineClock = 2_201;
  const deadlineSettle = await deadlineHarness.runtime.settle({
    runId: "deadline-synthesis-run",
    operationId: "deadline-settle",
  });
  assert.equal(deadlineSettle.reasonCode, "run_deadline_capacity");
  assert.equal(deadlineSynthesisCalls, 0);

  let latencyClock = 3_000;
  let latencyWorkerCalls = 0;
  const latencyBase = createAgentSwarmMemoryStore({ now: () => latencyClock });
  const latencyStore = {
    ...latencyBase,
    async replace(runId, claimId, replacement) {
      if (replacement.tasks?.some((item) => item.status === "running")) latencyClock += 2;
      return latencyBase.replace(runId, claimId, replacement);
    },
  };
  const latencyRuntime = createHarness({
    tasks: [task("latency-fenced")],
    stateStore: latencyStore,
    now: () => latencyClock,
    runTtlMs: 200,
    taskTimeoutMs: 50,
    taskLeaseMs: 61,
    storeClaimTtlMs: 10,
    executeTask: async () => {
      latencyWorkerCalls += 1;
      return { status: "completed", output: "late", effect: "read-only", costLog: COST };
    },
  }).runtime;
  await latencyRuntime.start({ ...REQUEST, runId: "store-latency-run", maxParallel: 1 });
  const latencyResult = await latencyRuntime.work({
    runId: "store-latency-run",
    workerId: "latency-worker",
    operationId: "latency-work",
  });
  assert.equal(latencyResult.reasonCode, "task_launch_deadline");
  assert.equal(latencyWorkerCalls, 0);
});

test("shares atomic task claims across runtimes and fences a stale worker after lease recovery", async () => {
  let clock = 1_000;
  let releaseFirst;
  let firstStarted;
  let firstExecution;
  let recoveredExecution;
  const started = new Promise((resolve) => { firstStarted = resolve; });
  const firstOutput = new Promise((resolve) => { releaseFirst = resolve; });
  const store = createAgentSwarmMemoryStore({ now: () => clock });
  const first = createHarness({
    tasks: [task("recoverable")],
    stateStore: store,
    now: () => clock,
    taskTimeoutMs: 50,
    taskLeaseMs: 100,
    storeClaimTtlMs: 10,
    executeTask: async (call) => {
      firstExecution = call.execution;
      firstStarted();
      await firstOutput;
      return { status: "completed", output: "stale-result", effect: "read-only", costLog: COST };
    },
  }).runtime;
  const second = createHarness({
    tasks: [task("recoverable")],
    stateStore: store,
    now: () => clock,
    taskTimeoutMs: 50,
    taskLeaseMs: 100,
    storeClaimTtlMs: 10,
    executeTask: async (call) => {
      recoveredExecution = call.execution;
      return { status: "completed", output: "recovered-result", effect: "read-only", costLog: COST };
    },
  }).runtime;

  await first.start({ ...REQUEST, runId: "recovery-run", maxParallel: 1 });
  const staleWork = first.work({ runId: "recovery-run", workerId: "lost-worker", operationId: "lost-work" });
  await started;
  clock += 101;
  const recovered = await second.work({ runId: "recovery-run", workerId: "replacement-worker", operationId: "replacement-work" });
  releaseFirst();
  const stale = await staleWork;
  const completed = await second.settle({ runId: "recovery-run", operationId: "recovery-settle" });

  assert.equal(recovered.status, "completed");
  assert.equal(stale.status, "stale");
  assert.equal(completed.status, "completed");
  assert.equal(completed.metrics.retries, 1);
  assert.equal(completed.evidence.receipts[0].attempts, 2);
  assert.notEqual(firstExecution.id, recoveredExecution.id);
  assert.equal(firstExecution.idempotencyKey, recoveredExecution.idempotencyKey);

  let leaseClock = 5_000;
  let leaseAttempts = 0;
  const leaseRuntime = createHarness({
    tasks: [task("lease-fenced")],
    stateStore: createAgentSwarmMemoryStore({ now: () => leaseClock }),
    now: () => leaseClock,
    taskTimeoutMs: 50,
    taskLeaseMs: 100,
    storeClaimTtlMs: 10,
    executeTask: async () => {
      leaseAttempts += 1;
      if (leaseAttempts === 1) leaseClock += 101;
      return { status: "completed", output: `lease-attempt-${leaseAttempts}`, effect: "read-only", costLog: COST };
    },
  }).runtime;
  await leaseRuntime.start({ ...REQUEST, runId: "lease-fence-run", maxParallel: 1 });
  const expired = await leaseRuntime.work({ runId: "lease-fence-run", workerId: "late-worker", operationId: "late-work" });
  const retried = await leaseRuntime.work({ runId: "lease-fence-run", workerId: "fresh-worker", operationId: "fresh-work" });
  assert.equal(expired.status, "stale");
  assert.equal(retried.status, "completed");
  assert.equal(leaseAttempts, 2);

  const abandonedStore = createAgentSwarmMemoryStore({ now: () => clock });
  await abandonedStore.put({ runId: "abandoned-claim", expiresAt: clock + 1_000, state: "preserved" });
  await abandonedStore.claim("abandoned-claim", "abandoned-coordinator", clock + 10);
  clock += 11;
  assert.equal(await abandonedStore.put({ runId: "abandoned-claim", expiresAt: clock + 1_000, state: "overwritten" }), false);
  assert.equal((await abandonedStore.get("abandoned-claim")).state, "preserved");

  let abaClock = 10_000;
  const abaStore = createAgentSwarmMemoryStore({ now: () => abaClock });
  await abaStore.put({ runId: "aba-reservation", reservationId: "first", expiresAt: abaClock + 10 });
  await abaStore.claim("aba-reservation", "first-discard", abaClock + 5);
  abaClock += 11;
  assert.equal(await abaStore.put({ runId: "aba-reservation", reservationId: "second", expiresAt: abaClock + 100 }), true);
  assert.equal(await abaStore.commit("aba-reservation", "first-discard"), false);
  assert.equal((await abaStore.get("aba-reservation")).reservationId, "second");

  let transientAttempts = 0;
  const transient = createHarness({
    tasks: [task("transient")],
    executeTask: async () => {
      transientAttempts += 1;
      if (transientAttempts === 1) throw new Error("transient private failure");
      return { status: "completed", output: "recovered", effect: "read-only", costLog: COST };
    },
  }).runtime;
  const transientResult = await transient.run({ ...REQUEST, runId: "transient-retry-run", maxParallel: 1 });
  assert.equal(transientResult.status, "completed");
  assert.equal(Object.hasOwn(transientResult.tasks[0], "reasonCode"), false);
  assert.equal(transientResult.events.some((event) => event.type === "task_retry_scheduled"), true);

  const postCommitBase = createAgentSwarmMemoryStore();
  let guardedGet = false;
  let guardedGetAttempts = 0;
  const postCommitStore = {
    ...postCommitBase,
    async get(runId) {
      if (guardedGet) {
        guardedGetAttempts += 1;
        throw new Error("transient post-commit read failure");
      }
      return postCommitBase.get(runId);
    },
    async replace(runId, claimId, replacement) {
      const replaced = await postCommitBase.replace(runId, claimId, replacement);
      if (replaced && (replacement.tasks?.some((item) => item.status === "completed")
        || ["completed", "blocked"].includes(replacement.status))) guardedGet = true;
      return replaced;
    },
  };
  const postCommit = createHarness({
    tasks: [task("post-commit")],
    stateStore: postCommitStore,
  }).runtime;
  await postCommit.start({ ...REQUEST, runId: "post-commit-run", maxParallel: 1 });
  const committedWork = await postCommit.work({
    runId: "post-commit-run",
    workerId: "post-commit-worker",
    operationId: "post-commit-work",
  });
  assert.equal(committedWork.status, "completed");
  assert.equal(guardedGetAttempts, 0);
  guardedGet = false;
  const committedSynthesis = await postCommit.settle({
    runId: "post-commit-run",
    operationId: "post-commit-settle",
  });
  assert.equal(committedSynthesis.status, "completed");
  assert.equal(guardedGetAttempts, 0);
  guardedGet = false;
  const failedOnly = createHarness({
    tasks: [task("failed-only")],
    stateStore: postCommitStore,
    maxAttempts: 1,
    executeTask: async () => { throw new Error("expected private failure"); },
  }).runtime;
  await failedOnly.start({ ...REQUEST, runId: "terminal-claim-run", maxParallel: 1 });
  assert.equal((await failedOnly.work({
    runId: "terminal-claim-run",
    workerId: "terminal-worker",
    operationId: "terminal-work",
  })).status, "failed");
  const terminalClaim = await failedOnly.settle({
    runId: "terminal-claim-run",
    operationId: "terminal-settle",
  });
  assert.equal(terminalClaim.reasonCode, "no_completed_tasks");
  assert.equal(guardedGetAttempts, 0);
});

test("requires matching execution receipts for idempotent effects", async () => {
  const missing = createHarness({
    tasks: [task("mutation")],
    executeTask: async () => ({ status: "completed", output: "changed", effect: "idempotent", costLog: COST }),
  });
  const blocked = await missing.runtime.run({ ...REQUEST, runId: "missing-receipt-run", maxParallel: 1 });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.reasonCode, "no_completed_tasks");

  const valid = createHarness({
    tasks: [task("mutation")],
    executeTask: async (call) => ({
      status: "completed",
      output: "changed-once",
      effect: "idempotent",
      receipt: { receiptId: "receipt-1", idempotencyKey: call.execution.idempotencyKey },
      costLog: COST,
    }),
  });
  const completed = await valid.runtime.run({ ...REQUEST, runId: "receipt-run", maxParallel: 1 });
  assert.equal(completed.status, "completed");
  assert.equal(completed.evidence.receipts[0].receiptId, "receipt-1");

  const unverified = createHarness({
    tasks: [task("unverified-mutation")],
    executeTask: async (call) => ({
      status: "completed",
      output: "untrusted-change",
      effect: "idempotent",
      receipt: { receiptId: "untrusted-receipt", idempotencyKey: call.execution.idempotencyKey },
      costLog: COST,
    }),
    verifyReceipt: async ({ receipt }) => ({ verified: false, ...receipt }),
  });
  const rejected = await unverified.runtime.run({ ...REQUEST, runId: "unverified-receipt-run", maxParallel: 1 });
  assert.equal(rejected.status, "blocked");
  assert.equal(rejected.counts.failed, 1);
  assert.equal(rejected.evidence.receipts.length, 0);

  let verifierStarted = false;
  const oneDeadline = createHarness({
    tasks: [task("one-deadline")],
    maxAttempts: 1,
    taskTimeoutMs: 100,
    taskLeaseMs: 150,
    storeClaimTtlMs: 10,
    executeTask: async (call) => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return {
        status: "completed",
        output: "changed-once",
        effect: "idempotent",
        receipt: { receiptId: "deadline-receipt", idempotencyKey: call.execution.idempotencyKey },
        costLog: COST,
      };
    },
    verifyReceipt: async ({ receipt, signal }) => {
      verifierStarted = true;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 60);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("verification deadline reached"));
        }, { once: true });
      });
      return { verified: true, ...receipt };
    },
  });
  const deadlineResult = await oneDeadline.runtime.run({ ...REQUEST, runId: "one-deadline-run", maxParallel: 1 });
  assert.equal(verifierStarted, true);
  assert.equal(deadlineResult.status, "blocked");
  assert.equal(deadlineResult.counts.failed, 1);
});

test("cancels active local work, preserves terminal state, and suppresses stale output", async () => {
  let started;
  const running = new Promise((resolve) => { started = resolve; });
  const { runtime } = createHarness({
    tasks: [task("long-task")],
    executeTask: async ({ signal }) => {
      started();
      await new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    },
  });
  await runtime.start({ ...REQUEST, runId: "cancel-run", maxParallel: 1 });
  const work = runtime.work({ runId: "cancel-run", workerId: "cancel-worker", operationId: "cancel-work" });
  await running;
  const canceled = await runtime.cancel({ runId: "cancel-run", operationId: "cancel-op", reason: "operator_cancelled" });
  const worker = await work;
  assert.equal(canceled.status, "canceled");
  assert.equal(canceled.tasks[0].status, "canceled");
  assert.equal(worker.status, "stale");
  assert.equal((await runtime.status("cancel-run")).status, "canceled");

  let synthesisStarted;
  let synthesisSignal;
  const synthesizing = new Promise((resolve) => { synthesisStarted = resolve; });
  const synthesisHarness = createHarness({
    tasks: [task("synthesis-source")],
    synthesize: async ({ signal }) => {
      synthesisSignal = signal;
      synthesisStarted();
      await new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("synthesis aborted")), { once: true });
      });
    },
  }).runtime;
  await synthesisHarness.start({ ...REQUEST, runId: "cancel-synthesis-run", maxParallel: 1 });
  await synthesisHarness.work({
    runId: "cancel-synthesis-run",
    workerId: "synthesis-source-worker",
    operationId: "synthesis-source-work",
  });
  const settling = synthesisHarness.settle({ runId: "cancel-synthesis-run", operationId: "cancelable-settle" });
  await synthesizing;
  const synthesisCanceled = await synthesisHarness.cancel({
    runId: "cancel-synthesis-run",
    operationId: "cancel-synthesis-op",
    reason: "operator_cancelled",
  });
  assert.equal(synthesisCanceled.status, "canceled");
  assert.equal((await settling).status, "canceled");
  assert.equal(synthesisSignal.aborted, true);
});

test("synthesizes useful partial results after bounded worker failure", async () => {
  const { runtime, synthesisCalls } = createHarness({
    tasks: [task("good"), task("bad")],
    executeTask: async (call) => {
      if (call.input.task.taskId === "bad") throw new Error("private provider failure");
      return { status: "completed", output: "usable", effect: "read-only", costLog: COST };
    },
    synthesize: async (call) => {
      synthesisCalls.push(call);
      return { status: "completed", output: "partial public answer", costLog: COST };
    },
  });
  const result = await runtime.run({ ...REQUEST, runId: "partial-run" });
  assert.equal(result.status, "completed");
  assert.equal(result.output, "partial public answer");
  assert.equal(result.counts.completed, 1);
  assert.equal(result.counts.failed, 1);
  assert.equal(result.cost.status, "partial");
  assert.equal(JSON.stringify(result).includes("private provider failure"), false);
  assert.equal(synthesisCalls[0].tasks.find(({ taskId }) => taskId === "bad").reasonCode, "worker_failed");
});

test("default runtime is contract-present but fails closed without execution owners", async () => {
  const runtime = createAgentSwarmRuntime();
  const result = await runtime.start({ ...REQUEST, runId: "unconfigured-run" });
  assert.equal(result.status, "blocked");
  assert.equal(result.reasonCode, "runtime_unconfigured");
  assert.equal(runtime.stats().configured, false);
  assert.equal(runtime.stats().stateStore.persistence, "isolate-memory");
});
