import assert from "node:assert/strict";
import test from "node:test";

import {
  createGuardrailsHumanReviewRuntime,
  createMemoryHumanReviewStore,
} from "../agent-api/src/guardrails-human-review.js";
import { createRunningAgentRuntime } from "../agent-api/src/running-agents.js";

const AGENT = Object.freeze({ agentId: "support-agent", revision: "support-agent-v1" });
const COST = Object.freeze({
  model: "offline-fixture",
  prompt_tokens: 0,
  completion_tokens: 0,
  cache_hits: 0,
  estimated_cost_usd: 0,
});

function validation(overrides = {}) {
  return {
    runId: "run-1",
    conversationId: "conversation-1",
    agent: AGENT,
    stage: "input",
    guardrails: [{ name: "request-policy", stage: "input" }],
    value: { prompt: "safe" },
    ...overrides,
  };
}

function review(overrides = {}) {
  return {
    runId: "run-1",
    conversationId: "conversation-1",
    agent: AGENT,
    action: {
      actionId: "call-1",
      kind: "function-tool",
      name: "cancel-order",
      riskClass: "mutation",
      payload: { orderId: 123 },
    },
    message: "Review the order cancellation.",
    ...overrides,
  };
}

test("runs ordered automatic checks and preserves only the validated value", async () => {
  const calls = [];
  const runtime = createGuardrailsHumanReviewRuntime({
    evaluateGuardrail: async (request) => {
      calls.push(request);
      if (request.guardrail.name === "redact-secret") {
        return { passed: true, value: { prompt: "[redacted]" }, evidence: { redactions: 1 } };
      }
      return { passed: request.value.prompt === "[redacted]" };
    },
  });

  const result = await runtime.validate(validation({
    stage: "output",
    guardrails: [
      { name: "redact-secret", stage: "output" },
      { name: "final-policy", stage: "output" },
    ],
    value: { prompt: "private" },
  }));

  assert.equal(result.status, "passed");
  assert.deepEqual(result.value, { prompt: "[redacted]" });
  assert.deepEqual(result.checks, [
    { name: "redact-secret", passed: true, transformed: true },
    { name: "final-policy", passed: true, transformed: false },
  ]);
  assert.equal(calls[1].value.prompt, "[redacted]");
  assert.equal(runtime.stats().guardrailCalls, 2);
});

test("fails closed for rejected, missing, malformed, and tool-adjacent guardrails", async () => {
  const rejected = createGuardrailsHumanReviewRuntime({
    evaluateGuardrail: async () => ({
      passed: false,
      reasonCode: "tool_arguments_denied",
      message: "Tool arguments violate application policy.",
    }),
  });
  const result = await rejected.validate(validation({
    stage: "tool-input",
    guardrails: [{ name: "tool-policy", stage: "tool-input" }],
    tool: { callId: "call-1", name: "cancel-order", riskClass: "mutation" },
    value: { orderId: 123 },
  }));
  assert.equal(result.status, "blocked");
  assert.equal(result.reasonCode, "tool_arguments_denied");
  assert.equal(JSON.stringify(result).includes("orderId"), false);

  const missing = await createGuardrailsHumanReviewRuntime().validate(validation());
  assert.equal(missing.reasonCode, "guardrail_evaluator_unconfigured");
  await assert.rejects(
    () => rejected.validate(validation({ guardrails: [{ name: "wrong-stage", stage: "output" }] })),
    /must equal input/,
  );
  await assert.rejects(
    () => rejected.validate(validation({ tool: { callId: "call-1", name: "tool", riskClass: "read-only" } })),
    /tool is valid only/,
  );
});

test("pauses sensitive actions and consumes an approval exactly once", async () => {
  const runtime = createGuardrailsHumanReviewRuntime({ createReviewId: () => "review-1", now: () => 100 });
  const paused = await runtime.requestReview(review());

  assert.equal(paused.status, "paused");
  assert.equal(paused.interruptions[0].id, "review-1");
  assert.deepEqual(paused.interruptions[0].metadata.action.payload, { orderId: 123 });
  assert.equal(JSON.stringify(paused.resumeState).includes("orderId"), false);

  const approved = await runtime.resolveReview({
    state: paused.resumeState,
    resolution: {
      reviewId: "review-1",
      decision: "approve",
      reviewerId: "operator-1",
      reason: "Confirmed with the customer.",
    },
  });
  assert.equal(approved.status, "approved");
  assert.equal(approved.edited, false);
  assert.deepEqual(approved.action.payload, { orderId: 123 });
  assert.equal(approved.audit.decision, "approve");

  const replay = await runtime.resolveReview({
    state: paused.resumeState,
    resolution: { reviewId: "review-1", decision: "approve", reviewerId: "operator-1" },
  });
  assert.equal(replay.reasonCode, "review_missing_or_consumed");
  assert.equal(runtime.stats().approvedReviews, 1);
  assert.equal(runtime.stats().blockedReviews, 1);
});

test("supports reject, edit with revalidation, expiry, and bounded store capacity", async () => {
  let sequence = 0;
  let currentTime = 100;
  const runtime = createGuardrailsHumanReviewRuntime({
    createReviewId: () => `review-${++sequence}`,
    now: () => currentTime,
    reviewTtlMs: 10,
  });
  const rejectedPause = await runtime.requestReview(review());
  const rejected = await runtime.resolveReview({
    state: rejectedPause.resumeState,
    resolution: { reviewId: "review-1", decision: "reject", reviewerId: "operator-1" },
  });
  assert.equal(rejected.status, "rejected");

  const editedPause = await runtime.requestReview(review());
  const edited = await runtime.resolveReview({
    state: editedPause.resumeState,
    resolution: {
      reviewId: "review-2",
      decision: "edit",
      reviewerId: "operator-1",
      editedPayload: { orderId: 456 },
    },
  });
  assert.equal(edited.status, "approved");
  assert.equal(edited.requiresValidation, true);
  assert.deepEqual(edited.action.payload, { orderId: 456 });

  const expiredPause = await runtime.requestReview(review());
  currentTime = 111;
  const expired = await runtime.resolveReview({
    state: expiredPause.resumeState,
    resolution: { reviewId: "review-3", decision: "approve", reviewerId: "operator-1" },
  });
  assert.equal(expired.reasonCode, "review_expired");

  const capacityStore = createMemoryHumanReviewStore({ maxPendingReviews: 1 });
  const bounded = createGuardrailsHumanReviewRuntime({
    reviewStore: capacityStore,
    createReviewId: () => `bounded-${++sequence}`,
  });
  await bounded.requestReview(review());
  await assert.rejects(() => bounded.requestReview(review()), /capacity is exhausted/);
});

test("uses the Running Agents interruption to resume the same streamed or ordinary turn", async () => {
  const reviews = createGuardrailsHumanReviewRuntime({ createReviewId: () => "review-running" });
  const adapterCalls = [];
  const runningAgents = createRunningAgentRuntime({
    createResumeToken: () => "resume-running",
    advanceAgent: async (request) => {
      adapterCalls.push(request);
      if (!request.resume) {
        return {
          ...(await reviews.requestReview(review({ runId: request.runId, conversationId: request.conversationId }))),
          responseId: "paused-response",
          costLog: COST,
        };
      }
      const resolution = await reviews.resolveReview(request.resume);
      if (resolution.status !== "approved") return { status: "completed", output: { executed: false }, costLog: COST };
      return {
        status: "completed",
        output: { executed: true, orderId: resolution.action.payload.orderId },
        responseId: "completed-response",
        costLog: COST,
      };
    },
  });

  const paused = await runningAgents.run({
    runId: "agent-run",
    conversationId: "agent-conversation",
    agent: "support-agent",
    input: { request: "cancel" },
    continuation: { strategy: "previous-response" },
  });
  assert.equal(paused.status, "paused");
  const completed = await runningAgents.resume({
    runId: "agent-run",
    conversationId: "agent-conversation",
    resumeToken: paused.resumeToken,
    resolution: {
      reviewId: "review-running",
      decision: "approve",
      reviewerId: "operator-1",
    },
  });
  assert.equal(completed.status, "completed");
  assert.equal(completed.turn, 1);
  assert.deepEqual(completed.output, { executed: true, orderId: 123 });
  assert.equal(adapterCalls.length, 2);
});
