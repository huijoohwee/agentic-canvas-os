import assert from "node:assert/strict";
import test from "node:test";

import { createAgentOrchestrationRuntime } from "../agent-api/src/agent-orchestration.js";

const COST = Object.freeze({
  model: "offline-agent",
  prompt_tokens: 10,
  completion_tokens: 4,
  cache_hits: 0,
  estimated_cost_usd: 0,
});

function workflow(overrides = {}) {
  return {
    workflowId: "support-flow",
    revision: "support-v1",
    manager: { agentId: "triage", revision: "triage-v1" },
    specialists: [
      { agentId: "research", revision: "research-v1", responsibility: "Find source-backed facts." },
      { agentId: "billing", revision: "billing-v1", responsibility: "Own billing conversations." },
    ],
    branches: [
      {
        branchId: "delegate-research",
        sourceAgentId: "triage",
        targetAgentId: "research",
        mode: "delegate",
        conversationOwnerAgentId: "triage",
        finalAnswerAgentId: "triage",
      },
      {
        branchId: "handoff-billing",
        sourceAgentId: "triage",
        targetAgentId: "billing",
        mode: "handoff",
        conversationOwnerAgentId: "billing",
        finalAnswerAgentId: "billing",
      },
      {
        branchId: "billing-delegates-research",
        sourceAgentId: "billing",
        targetAgentId: "research",
        mode: "delegate",
        conversationOwnerAgentId: "billing",
        finalAnswerAgentId: "billing",
      },
      {
        branchId: "billing-hands-back",
        sourceAgentId: "billing",
        targetAgentId: "triage",
        mode: "handoff",
        conversationOwnerAgentId: "triage",
        finalAnswerAgentId: "triage",
      },
    ],
    ...overrides,
  };
}

function request(overrides = {}) {
  return {
    runId: "run-1",
    conversationId: "conversation-1",
    workflowId: "support-flow",
    workflowRevision: "support-v1",
    branchId: "delegate-research",
    input: { question: "What changed?" },
    ...overrides,
  };
}

function createHarness(overrides = {}) {
  const calls = [];
  const runtime = createAgentOrchestrationRuntime({
    resolveAgent: async ({ agent }) => ({
      status: "ready",
      agentId: agent.agentId,
      revision: agent.revision,
    }),
    authorize: async () => ({ allowed: true, approvalId: "approval-1" }),
    runAgent: async (call) => {
      calls.push(call);
      if (call.role === "behind-manager") {
        return { status: "completed", output: { facts: ["bounded fact"] }, costLog: COST };
      }
      return {
        status: "completed",
        output: { answer: `${call.agent.agentId} final` },
        costLog: COST,
      };
    },
    ...overrides,
  });
  runtime.register(workflow());
  return { runtime, calls };
}

test("registers revision-fenced workflows with explicit branch ownership", () => {
  const { runtime } = createHarness();
  assert.equal(runtime.stats().configured, true);
  assert.equal(runtime.stats().workflows, 1);
  assert.deepEqual(runtime.stats().modes, ["delegate", "handoff"]);
  assert.deepEqual(runtime.owner("missing"), null);
  assert.throws(() => runtime.register(workflow({
    revision: "bad-owner-v1",
    branches: [{
      branchId: "bad",
      sourceAgentId: "triage",
      targetAgentId: "research",
      mode: "delegate",
      conversationOwnerAgentId: "research",
      finalAnswerAgentId: "research",
    }],
  })), /ownership contradicts/);
  assert.throws(() => runtime.register(workflow({
    revision: "orphan-v1",
    branches: [{
      branchId: "billing-only",
      sourceAgentId: "triage",
      targetAgentId: "billing",
      mode: "handoff",
      conversationOwnerAgentId: "billing",
      finalAnswerAgentId: "billing",
    }],
  })), /research is unreachable/);
});

test("delegation keeps the specialist behind the manager and returns only manager output", async () => {
  const { runtime, calls } = createHarness();
  const result = await runtime.run(request());
  assert.equal(result.status, "completed");
  assert.equal(result.branch.mode, "delegate");
  assert.deepEqual(result.output, { answer: "triage final" });
  assert.deepEqual(result.conversationOwner, { agentId: "triage", revision: "triage-v1" });
  assert.deepEqual(result.finalAnswerOwner, result.conversationOwner);
  assert.deepEqual(calls.map((call) => [call.agent.agentId, call.role]), [
    ["research", "behind-manager"],
    ["triage", "user-facing-manager"],
  ]);
  assert.deepEqual(calls[1].input.specialist.output, { facts: ["bounded fact"] });
  assert.equal(result.evidence.intermediateSpecialistOutputReturned, false);
  assert.equal(JSON.stringify(result).includes("bounded fact"), false);
  assert.equal(result.cost.status, "reported");
  assert.equal(result.cost.reportedSteps, 2);
});

test("handoff transfers conversation and final-answer ownership to the specialist", async () => {
  const { runtime, calls } = createHarness();
  const result = await runtime.run(request({ branchId: "handoff-billing" }));
  assert.equal(result.status, "completed");
  assert.deepEqual(result.output, { answer: "billing final" });
  assert.deepEqual(result.conversationOwner, { agentId: "billing", revision: "billing-v1" });
  assert.deepEqual(runtime.owner("conversation-1"), result.conversationOwner);
  assert.equal(result.evidence.conversationTransferred, true);
  assert.deepEqual(calls.map((call) => [call.agent.agentId, call.role]), [["billing", "user-facing-owner"]]);
});

test("only the active conversation owner can choose the next branch or hand back", async () => {
  const { runtime } = createHarness();
  await runtime.run(request({ branchId: "handoff-billing" }));
  const rejected = await runtime.run(request({ runId: "run-2", branchId: "delegate-research" }));
  assert.equal(rejected.status, "blocked");
  assert.equal(rejected.reasonCode, "conversation_owner_mismatch");
  const delegated = await runtime.run(request({ runId: "run-3", branchId: "billing-delegates-research" }));
  assert.equal(delegated.finalAnswerOwner.agentId, "billing");
  const returned = await runtime.run(request({ runId: "run-4", branchId: "billing-hands-back" }));
  assert.equal(returned.finalAnswerOwner.agentId, "triage");
  assert.equal(runtime.owner("conversation-1").agentId, "triage");
});

test("application denial blocks before agent resolution or execution", async () => {
  let resolutions = 0;
  let executions = 0;
  const runtime = createAgentOrchestrationRuntime({
    resolveAgent: async () => { resolutions += 1; },
    runAgent: async () => { executions += 1; },
    authorize: async () => ({ allowed: false, reasonCode: "route_denied" }),
  });
  runtime.register(workflow());
  const result = await runtime.run(request());
  assert.equal(result.status, "blocked");
  assert.equal(result.reasonCode, "route_denied");
  assert.equal(result.cost.status, "not-run");
  assert.equal(resolutions, 0);
  assert.equal(executions, 0);
});

test("exact workflow, branch, and agent revisions fail closed", async () => {
  const { runtime } = createHarness({
    resolveAgent: async ({ agent }) => ({ status: "ready", agentId: agent.agentId, revision: "stale-v1" }),
  });
  assert.equal((await runtime.run(request({ workflowRevision: "stale-workflow" }))).reasonCode, "workflow_missing");
  assert.equal((await runtime.run(request({ runId: "run-2", branchId: "missing" }))).reasonCode, "branch_missing");
  const mismatch = await runtime.run(request({ runId: "run-3" }));
  assert.equal(mismatch.status, "blocked");
  assert.equal(mismatch.reasonCode, "agent_resolution_mismatch");
});

test("serializes active conversations and rejects recent run replay", async () => {
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const { runtime } = createHarness({
    runAgent: async () => {
      await waiting;
      return { status: "completed", output: "done", costLog: COST };
    },
  });
  const first = runtime.run(request({ branchId: "handoff-billing" }));
  await new Promise((resolve) => setImmediate(resolve));
  const concurrent = await runtime.run(request({ runId: "run-2", branchId: "handoff-billing" }));
  assert.equal(concurrent.reasonCode, "conversation_active");
  release();
  assert.equal((await first).status, "completed");
  const replay = await runtime.run(request({ branchId: "billing-hands-back" }));
  assert.equal(replay.reasonCode, "run_reused");
});

test("reports partial cost and redacts unexpected adapter failures", async () => {
  let calls = 0;
  const { runtime } = createHarness({
    runAgent: async () => {
      calls += 1;
      if (calls === 1) return { status: "completed", output: { internal: true }, costLog: COST };
      throw new Error("secret provider body");
    },
  });
  const result = await runtime.run(request());
  assert.equal(result.status, "blocked");
  assert.equal(result.reasonCode, "agent_run_failed");
  assert.equal(result.message.includes("secret provider body"), false);
  assert.equal(result.cost.status, "partial");
  assert.equal(result.cost.reportedSteps, 1);
  assert.equal(result.cost.unreportedSteps, 1);
});
