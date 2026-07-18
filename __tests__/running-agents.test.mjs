import test from "node:test";
import assert from "node:assert/strict";

import { createRunningAgentRuntime } from "../agent-api/src/running-agents.js";

const COST = Object.freeze({
  model: "offline-fixture",
  prompt_tokens: 10,
  completion_tokens: 5,
  cache_hits: 0,
  estimated_cost_usd: 0.001,
});

const PREVIOUS_RESPONSE_REQUEST = Object.freeze({
  runId: "run-1",
  conversationId: "conversation-1",
  agent: "triage",
  input: { prompt: "investigate" },
  continuation: { strategy: "previous-response" },
});

test("runs a bounded tool and handoff loop while advancing previous-response state", async () => {
  const requests = [];
  const runtime = createRunningAgentRuntime({
    advanceAgent: async (request) => {
      requests.push(request);
      if (request.step === 1) {
        request.emit({ type: "tool_started", payload: { name: "lookup" } });
        return {
          status: "continue",
          transition: "tool",
          nextInput: { toolResult: "bounded" },
          responseId: "response-1",
          costLog: COST,
        };
      }
      if (request.step === 2) {
        return {
          status: "continue",
          transition: "handoff",
          agent: "specialist",
          nextInput: { brief: "continue" },
          responseId: "response-2",
          costLog: COST,
        };
      }
      return {
        status: "completed",
        output: { answer: "done" },
        responseId: "response-3",
        costLog: COST,
      };
    },
  });

  const result = await runtime.run(PREVIOUS_RESPONSE_REQUEST);

  assert.equal(result.status, "completed");
  assert.deepEqual(result.output, { answer: "done" });
  assert.deepEqual(result.continuation, {
    strategy: "previous-response",
    previousResponseId: "response-3",
  });
  assert.equal(requests[1].continuation.previousResponseId, "response-1");
  assert.equal(requests[2].agent, "specialist");
  assert.deepEqual(result.evidence.agents, ["triage", "specialist"]);
  assert.equal(result.evidence.toolTransitions, 1);
  assert.equal(result.evidence.handoffs, 1);
  assert.equal(result.costLog.status, "reported");
  assert.equal(result.costLog.prompt_tokens, 30);
  assert.equal(JSON.stringify(result).includes("toolResult"), false);
});

test("requires one exclusive continuation strategy and locks it per conversation", async () => {
  const runtime = createRunningAgentRuntime({
    advanceAgent: async () => ({ status: "completed", output: "ok", costLog: COST }),
  });
  await assert.rejects(
    runtime.run({
      ...PREVIOUS_RESPONSE_REQUEST,
      continuation: { strategy: "session", sessionId: "session-1", previousResponseId: "conflict" },
    }),
    /conflicts with continuation.strategy/,
  );

  const first = await runtime.run({
    ...PREVIOUS_RESPONSE_REQUEST,
    runId: "session-run-1",
    conversationId: "session-conversation",
    continuation: { strategy: "session", sessionId: "session-1" },
  });
  assert.equal(first.status, "completed");

  const mismatch = await runtime.run({
    ...PREVIOUS_RESPONSE_REQUEST,
    runId: "session-run-2",
    conversationId: "session-conversation",
    continuation: { strategy: "conversation", providerConversationId: "provider-conversation-1" },
  });
  assert.equal(mismatch.status, "blocked");
  assert.equal(mismatch.reasonCode, "continuation_mismatch");

  const providerConversation = await runtime.run({
    ...PREVIOUS_RESPONSE_REQUEST,
    runId: "provider-conversation-run",
    conversationId: "provider-conversation-owner",
    continuation: { strategy: "conversation", providerConversationId: "provider-conversation-1" },
  });
  assert.equal(providerConversation.status, "completed");
  assert.equal(providerConversation.continuation.providerConversationId, "provider-conversation-1");
});

test("returns bounded application history for exact replay on the next turn", async () => {
  const runtime = createRunningAgentRuntime({
    maxHistoryItems: 3,
    advanceAgent: async (request) => ({
      status: "completed",
      output: { turn: request.turn },
      history: [...request.continuation.history, { role: "assistant", turn: request.turn }],
    }),
  });
  const first = await runtime.run({
    ...PREVIOUS_RESPONSE_REQUEST,
    runId: "history-run-1",
    conversationId: "history-conversation",
    continuation: { strategy: "application-history", history: [] },
  });
  assert.equal(first.costLog.status, "unreported");
  assert.equal(first.continuation.history.length, 1);

  const second = await runtime.run({
    ...PREVIOUS_RESPONSE_REQUEST,
    runId: "history-run-2",
    conversationId: "history-conversation",
    continuation: first.continuation,
  });
  assert.equal(second.status, "completed");
  assert.equal(second.turn, 2);
  assert.equal(second.continuation.history.length, 2);

  const stale = await runtime.run({
    ...PREVIOUS_RESPONSE_REQUEST,
    runId: "history-run-3",
    conversationId: "history-conversation",
    continuation: { strategy: "application-history", history: [] },
  });
  assert.equal(stale.reasonCode, "continuation_mismatch");
  await assert.rejects(
    runtime.run({
      ...PREVIOUS_RESPONSE_REQUEST,
      runId: "history-overflow-run",
      conversationId: "history-overflow-conversation",
      continuation: { strategy: "application-history", history: [{}, {}, {}, {}] },
    }),
    /exceeds 3 items/,
  );
});

test("streams adapter events incrementally and settles only after terminal loop completion", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const runtime = createRunningAgentRuntime({
    advanceAgent: async (request) => {
      request.emit({ type: "model_delta", payload: { text: "partial" } });
      await gate;
      return { status: "completed", output: "final", responseId: "stream-response", costLog: COST };
    },
  });
  const handle = runtime.stream({ ...PREVIOUS_RESPONSE_REQUEST, runId: "stream-run" });
  const iterator = handle.events[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).value.type, "turn_started");
  assert.equal((await iterator.next()).value.type, "model_delta");

  let settled = false;
  handle.completed.finally(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  release();

  const terminal = await iterator.next();
  assert.equal(terminal.value.type, "turn_completed");
  assert.equal((await iterator.next()).done, true);
  assert.equal((await handle.completed).status, "completed");
  assert.equal(settled, true);
});

test("pauses and resumes opaque state within the same application turn", async () => {
  const requests = [];
  const runtime = createRunningAgentRuntime({
    createResumeToken: () => "resume-token-1",
    advanceAgent: async (request) => {
      requests.push(request);
      if (!request.resume) {
        return {
          status: "paused",
          interruptions: [{ id: "approval-1", kind: "approval", message: "Approve the read." }],
          resumeState: { internalCursor: "never-public" },
          responseId: "paused-response",
          costLog: COST,
        };
      }
      return {
        status: "completed",
        output: { approved: request.resume.resolution.approved },
        responseId: "resumed-response",
        costLog: COST,
      };
    },
  });
  const paused = await runtime.run({ ...PREVIOUS_RESPONSE_REQUEST, runId: "pause-run" });
  assert.equal(paused.status, "paused");
  assert.equal(paused.resumeToken, "resume-token-1");
  assert.equal(JSON.stringify(paused).includes("never-public"), false);

  const competing = await runtime.run({
    ...PREVIOUS_RESPONSE_REQUEST,
    runId: "competing-run",
    continuation: paused.continuation,
  });
  assert.equal(competing.reasonCode, "conversation_paused");

  const completed = await runtime.resume({
    runId: "pause-run",
    conversationId: "conversation-1",
    resumeToken: paused.resumeToken,
    resolution: { approved: true },
  });
  assert.equal(completed.status, "completed");
  assert.equal(completed.turn, 1);
  assert.equal(completed.evidence.steps, 2);
  assert.equal(requests[1].resume.state.internalCursor, "never-public");
  assert.deepEqual(completed.output, { approved: true });
  assert.equal(runtime.stats().resumedTurns, 1);
});

test("serializes active conversations and rejects recent run-id reuse", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const runtime = createRunningAgentRuntime({
    advanceAgent: async () => {
      await gate;
      return { status: "completed", output: "ok", responseId: "serialized-response" };
    },
  });
  const firstPromise = runtime.run({ ...PREVIOUS_RESPONSE_REQUEST, runId: "active-run" });
  const competing = await runtime.run({
    ...PREVIOUS_RESPONSE_REQUEST,
    runId: "other-run",
  });
  assert.equal(competing.reasonCode, "conversation_active");
  release();
  assert.equal((await firstPromise).status, "completed");

  const reused = await runtime.run({
    ...PREVIOUS_RESPONSE_REQUEST,
    runId: "active-run",
    continuation: { strategy: "previous-response", previousResponseId: "serialized-response" },
  });
  assert.equal(reused.reasonCode, "run_reused");
});

test("fails closed on step, stream-event, timeout, and configuration bounds", async () => {
  const stepBounded = createRunningAgentRuntime({
    maxSteps: 1,
    advanceAgent: async () => ({
      status: "continue",
      transition: "model",
      nextInput: {},
      responseId: "repeat-response",
    }),
  });
  assert.equal((await stepBounded.run(PREVIOUS_RESPONSE_REQUEST)).reasonCode, "step_limit");

  const eventBounded = createRunningAgentRuntime({
    maxEvents: 2,
    advanceAgent: async (request) => {
      request.emit({ type: "model_delta", payload: { text: "one" } });
      request.emit({ type: "model_delta", payload: { text: "two" } });
      return { status: "completed", output: "unreachable", responseId: "event-response" };
    },
  });
  assert.equal((await eventBounded.run({ ...PREVIOUS_RESPONSE_REQUEST, runId: "event-run" })).reasonCode, "stream_event_limit");

  const invalidEvent = createRunningAgentRuntime({
    advanceAgent: async (request) => {
      request.emit({ type: "reasoning", payload: { hidden: true } });
      return { status: "completed", output: "unreachable", responseId: "invalid-event-response" };
    },
  });
  assert.equal((await invalidEvent.run({ ...PREVIOUS_RESPONSE_REQUEST, runId: "invalid-event-run" })).reasonCode, "stream_event_invalid");

  const partialCost = createRunningAgentRuntime({
    advanceAgent: async (request) => {
      if (request.step === 1) {
        return {
          status: "continue",
          transition: "model",
          nextInput: {},
          responseId: "partial-cost-response",
          costLog: COST,
        };
      }
      throw new Error("offline adapter failure");
    },
  });
  const partial = await partialCost.run({ ...PREVIOUS_RESPONSE_REQUEST, runId: "partial-cost-run" });
  assert.equal(partial.reasonCode, "adapter_failed");
  assert.equal(partial.costLog.status, "partial");
  assert.equal(partial.costLog.reportedSteps, 1);
  assert.equal(partial.costLog.unreportedSteps, 1);

  let emitAfterTimeout;
  const timedOut = createRunningAgentRuntime({
    timeoutMs: 5,
    advanceAgent: async (request) => {
      emitAfterTimeout = request.emit;
      return new Promise(() => {});
    },
  });
  assert.equal((await timedOut.run({ ...PREVIOUS_RESPONSE_REQUEST, runId: "timeout-run" })).reasonCode, "timeout");
  const settledEventCount = timedOut.stats().loopEvents;
  emitAfterTimeout({ type: "model_delta", payload: { text: "too late" } });
  assert.equal(timedOut.stats().loopEvents, settledEventCount);

  const unconfigured = await createRunningAgentRuntime().run({
    ...PREVIOUS_RESPONSE_REQUEST,
    runId: "unconfigured-run",
  });
  assert.equal(unconfigured.reasonCode, "runtime_unconfigured");
  assert.equal(unconfigured.costLog.status, "not-run");
});
