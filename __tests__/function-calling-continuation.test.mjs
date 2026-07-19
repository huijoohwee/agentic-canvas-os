import assert from "node:assert/strict";
import test from "node:test";

import { mintReviewerToken, mintSessionToken, verifyReviewerToken } from "../agent-api/src/auth.js";
import {
  createDurableObjectFunctionContinuationStore,
  createDurableObjectFunctionExecutionReceiptStore,
} from "../agent-api/src/durable-object-state-store.js";
import {
  createFunctionCallingHandler,
  createFunctionCallingRecoveryHandler,
  createFunctionCallingResumeHandler,
} from "../agent-api/src/function-calling-handler.js";
import { createFunctionCallingManager } from "../agent-api/src/function-calling-manager.js";
import { createFunctionCallingRuntime } from "../agent-api/src/function-calling.js";
import { createGuardrailsHumanReviewRuntime } from "../agent-api/src/guardrails-human-review.js";
import {
  createKnowgrphFunctionGateway,
  createKnowgrphGuardrailEvaluator,
  KNOWGRPH_FUNCTION_TOOL_NAMES,
} from "../agent-api/src/knowgrph-function-gateway.js";
import { AgentState } from "../worker/agent-state.js";

const CAPABILITIES = Object.freeze({
  functionCalling: true,
  strictSchemas: true,
  parallelFunctionCalls: true,
  previousResponseContinuation: true,
  reasoningItemReplay: true,
});

const COST = Object.freeze({
  model: "offline-continuation-adapter",
  prompt_tokens: 0,
  completion_tokens: 0,
  cache_hits: 0,
  cached_tokens: 0,
  cache_write_tokens: 0,
  provider_cache_status: "unreported",
  estimated_cost_usd: 0,
});

class MemoryStorage {
  constructor() {
    this.records = new Map();
    this.transactionTail = Promise.resolve();
  }

  async transaction(operation) {
    const result = this.transactionTail.then(() => operation(this));
    this.transactionTail = result.catch(() => {});
    return result;
  }

  async get(key) { return this.records.get(key); }
  async put(key, value) { this.records.set(key, value); }
  async delete(key) { return this.records.delete(key); }
}

function agentStateNamespace() {
  const instances = new Map();
  return Object.freeze({
    idFromName: (name) => name,
    get(id) {
      if (!instances.has(id)) instances.set(id, new AgentState({ storage: new MemoryStorage() }));
      return Object.freeze({
        fetch: (input, init) => instances.get(id).fetch(input instanceof Request ? input : new Request(input, init)),
      });
    },
  });
}

function response(responseId, items) {
  return { responseId, status: "completed", items, costLog: COST };
}

function statusPayload() {
  return {
    ok: true,
    view: "capabilities",
    entries: [{ toolId: "knowgrph.os.status" }],
    unavailableSources: [],
    cost_log: {
      model: "none", prompt_tokens: 0, completion_tokens: 0,
      cache_hits: 0, estimated_cost_usd: 0,
    },
  };
}

function reviewRuntime(reviewSecret, captured) {
  return createGuardrailsHumanReviewRuntime({
    evaluateGuardrail: createKnowgrphGuardrailEvaluator(),
    createReviewId: () => "review-durable-1",
    reviewStore: {
      put(record) {
        captured.record = record;
        if (captured.consumed) return false;
        captured.pending = record;
        return true;
      },
      take(reviewId) {
        if (captured.pending?.reviewId !== reviewId) return null;
        const record = captured.pending;
        captured.pending = null;
        captured.consumed = true;
        return record;
      },
    },
    authenticateReviewer: async ({ state, evidence }) => {
      const verdict = verifyReviewerToken(evidence?.token, reviewSecret, state);
      return verdict.valid
        ? { authenticated: true, subjectId: verdict.claims.sub, evidenceId: verdict.claims.jti, assurance: "signed-review-token" }
        : { authenticated: false };
    },
  });
}

function reviewedGateway(guardrailsHumanReview, onMcpCall, executionReceiptStore) {
  return createKnowgrphFunctionGateway({
    allowedToolNames: [KNOWGRPH_FUNCTION_TOOL_NAMES.status],
    reviewRequiredToolNames: [KNOWGRPH_FUNCTION_TOOL_NAMES.status],
    guardrailsHumanReview,
    executionReceiptStore,
    mcpClient: { callTool: async () => { onMcpCall(); return statusPayload(); } },
  });
}

test("resumes an exact provider chain through a fresh durable manager after signed review", async () => {
  const namespace = agentStateNamespace();
  const reviewSecret = "durable-review-secret";
  const captured = {};
  const executionReceiptStore = createDurableObjectFunctionExecutionReceiptStore({ namespace });
  let mcpCalls = 0;
  let initialModelCalls = 0;
  const firstGateway = reviewedGateway(
    reviewRuntime(reviewSecret, captured),
    () => { mcpCalls += 1; },
    executionReceiptStore,
  );
  const firstManager = createFunctionCallingManager({
    continuationStore: createDurableObjectFunctionContinuationStore({ namespace }),
    functionCalling: createFunctionCallingRuntime({
      advanceModel: async () => {
        initialModelCalls += 1;
        return response("response-before-review", [
          { type: "reasoning", encryptedContent: "opaque-reasoning" },
          {
            type: "function_call",
            callId: "call-before-review",
            name: KNOWGRPH_FUNCTION_TOOL_NAMES.status,
            arguments: { view: "capabilities" },
          },
        ]);
      },
      callTool: firstGateway.callTool,
    }),
    tools: firstGateway.tools,
    capabilities: CAPABILITIES,
    createId: (() => { let id = 0; return () => `first-id-${id += 1}`; })(),
  });
  const paused = await firstManager.run({
    runId: "durable-function-run",
    input: { prompt: "Read capabilities." },
    toolChoice: { mode: "forced", name: KNOWGRPH_FUNCTION_TOOL_NAMES.status },
    parallelToolCalls: false,
  });
  assert.equal(paused.status, "paused");
  assert.equal(initialModelCalls, 1);
  assert.equal(mcpCalls, 0);
  assert.equal(JSON.stringify(paused).includes("opaque-reasoning"), false);
  assert.equal(JSON.stringify(paused).includes("response-before-review"), false);

  const resumedModelCalls = [];
  const secondGateway = reviewedGateway(
    reviewRuntime(reviewSecret, captured),
    () => { mcpCalls += 1; },
    executionReceiptStore,
  );
  const secondStore = createDurableObjectFunctionContinuationStore({ namespace });
  const secondManager = createFunctionCallingManager({
    continuationStore: secondStore,
    functionCalling: createFunctionCallingRuntime({
      advanceModel: async (request) => {
        resumedModelCalls.push(request);
        return response("response-after-review", [{ type: "message", output: "Capabilities loaded." }]);
      },
      callTool: secondGateway.callTool,
    }),
    tools: secondGateway.tools,
    capabilities: CAPABILITIES,
    createId: (() => { let id = 0; return () => `second-id-${id += 1}`; })(),
  });
  const invalid = await secondManager.resume({
    runId: paused.runId,
    resumeToken: paused.resumeToken,
    decision: "approve",
    reviewerEvidence: { token: "invalid-reviewer-token" },
  });
  assert.equal(invalid.status, "blocked");
  assert.equal(invalid.retryable, true);
  assert.equal(mcpCalls, 0);
  assert.equal(resumedModelCalls.length, 0);

  const recovered = await secondManager.recover({ runId: paused.runId });
  assert.equal(recovered.status, "paused");
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.resumeToken, paused.resumeToken);
  assert.deepEqual(recovered.interruptions, paused.interruptions);
  assert.equal(JSON.stringify(recovered).includes("opaque-reasoning"), false);

  const stored = captured.record;
  const reviewerToken = mintReviewerToken({
    secret: reviewSecret,
    subject: "operator-1",
    schema: "agentic-human-review-state/v1",
    reviewId: stored.reviewId,
    runId: stored.runId,
    conversationId: stored.conversationId,
    actionDigest: stored.actionDigest,
  });
  const resumeRequest = {
    runId: paused.runId,
    resumeToken: paused.resumeToken,
    decision: "approve",
    reviewerEvidence: { token: reviewerToken },
  };
  const competingResults = await Promise.all([
    secondManager.resume(resumeRequest),
    secondManager.resume(resumeRequest),
  ]);
  const completed = competingResults.find((result) => result.status === "completed");
  const competing = competingResults.find((result) => result.status === "blocked");
  assert.ok(completed);
  assert.equal(competing.reasonCode, "continuation_missing_or_active");
  assert.equal(completed.status, "completed");
  assert.equal(completed.output, "Capabilities loaded.");
  assert.deepEqual(completed.evidence.providerResponseIds, ["response-before-review", "response-after-review"]);
  assert.equal(completed.evidence.executionReceipts[0].receipt.phase, "completed");
  assert.equal(mcpCalls, 1);
  assert.equal(initialModelCalls, 1);
  assert.equal(resumedModelCalls.length, 1);
  assert.equal(resumedModelCalls[0].previousResponseId, "response-before-review");
  assert.deepEqual(resumedModelCalls[0].input.map((item) => item.type), ["reasoning", "function_call_output"]);
  assert.equal(resumedModelCalls[0].input[1].callId, "call-before-review");
  assert.equal(await secondStore.get(paused.runId), null);
});

test("fails closed when current function definitions drift before resume", async () => {
  const gatewayCost = { ...COST, model: "offline-gateway" };
  const resumableTool = {
    type: "function",
    name: "reviewed_read",
    revision: "reviewed-read/v1",
    description: "Read reviewed data.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    strict: true,
    outputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
    allowedCallers: ["direct"], riskClass: "read-only", idempotent: true, approvalRequired: true,
    validateArguments: () => true, validateOutput: () => true,
  };
  const runtime = createFunctionCallingRuntime({
    advanceModel: async () => response("drift-response", [
      { type: "function_call", callId: "drift-call", name: "reviewed_read", arguments: {} },
    ]),
    callTool: async () => ({
      status: "paused",
      interruptions: [{ id: "drift-review", kind: "approval", message: "Review." }],
      resumeState: {
        schema: "agentic-human-review-state/v1", reviewId: "drift-review", runId: "drift-run",
        conversationId: "drift-run", actionDigest: "drift-digest",
      },
      costLog: gatewayCost,
    }),
  });
  const paused = await runtime.run({
    runId: "drift-run", input: { prompt: "Read." }, tools: [resumableTool],
    capabilities: CAPABILITIES, parallelToolCalls: false,
  });
  await assert.rejects(
    runtime.resume({
      continuationState: paused.continuationState,
      resolution: { reviewId: "drift-review", decision: "approve", reviewerEvidence: { token: "x" } },
      tools: [{ ...resumableTool, description: "Changed definition." }],
    }),
    (error) => error.reasonCode === "continuation_tool_drift",
  );
});

test("keeps the HTTP resume boundary authenticated and forbids caller-authored approval state", async () => {
  const secret = "session-secret";
  const token = mintSessionToken({ secret, subject: "session-1" });
  let resumeRequest;
  const manager = {
    stats: () => ({ configured: true }),
    run: async ({ runId }) => ({
      runId, status: "paused", stage: "review", resumeToken: "opaque-resume",
      expiresAt: Date.now() + 60_000,
      interruptions: [{ id: "review-1", kind: "approval", message: "Review." }],
      costLog: COST, gatewayCostLog: COST,
    }),
    resume: async (request) => {
      resumeRequest = request;
      return { runId: request.runId, status: "completed", stage: "final", output: "done" };
    },
    recover: async ({ runId }) => ({
      runId, status: "paused", stage: "review", resumeToken: "opaque-resume",
      expiresAt: Date.now() + 60_000,
      interruptions: [{ id: "review-1", kind: "approval", message: "Review." }],
      recovered: true,
    }),
  };
  const tools = [{ name: "reviewed_read" }];
  const start = createFunctionCallingHandler({ secret, functionCallingManager: manager, tools });
  const recover = createFunctionCallingRecoveryHandler({ secret, functionCallingManager: manager });
  const resume = createFunctionCallingResumeHandler({ secret, functionCallingManager: manager });
  const authorization = { authorization: `Bearer ${token}` };
  const paused = await start({
    headers: authorization,
    body: { runId: "http-review-run", prompt: "Read.", parallelToolCalls: false },
  });
  assert.equal(paused.statusCode, 202);
  assert.equal(paused.body.resumeToken, "opaque-resume");

  const recovered = await recover({ headers: authorization, body: { runId: "http-review-run" } });
  assert.equal(recovered.statusCode, 200);
  assert.equal(recovered.body.resumeToken, "opaque-resume");

  const rawApproval = await resume({
    headers: authorization,
    body: {
      runId: "http-review-run", resumeToken: "opaque-resume", decision: "approve",
      reviewerToken: "reviewer-token", approvals: [{ approved: true }],
    },
  });
  assert.equal(rawApproval.statusCode, 400);
  assert.deepEqual(rawApproval.body.fields[0], { field: "approvals", reason: "unsupported field" });

  const completed = await resume({
    headers: authorization,
    body: {
      runId: "http-review-run", resumeToken: "opaque-resume",
      decision: "approve", reviewerToken: "reviewer-token",
    },
  });
  assert.equal(completed.statusCode, 200);
  assert.deepEqual(resumeRequest, {
    runId: "http-review-run",
    resumeToken: "opaque-resume",
    decision: "approve",
    reviewerEvidence: { token: "reviewer-token" },
  });
});
