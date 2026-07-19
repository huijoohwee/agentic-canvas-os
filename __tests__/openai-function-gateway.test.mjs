import test from "node:test";
import assert from "node:assert/strict";

import { createAgentApiApp } from "../agent-api/src/app.js";
import { mintReviewerToken, verifyReviewerToken } from "../agent-api/src/auth.js";
import { createGuardrailsHumanReviewRuntime } from "../agent-api/src/guardrails-human-review.js";
import {
  createKnowgrphFunctionGateway,
  createKnowgrphGuardrailEvaluator,
  KNOWGRPH_FUNCTION_TOOL_NAMES,
  parseKnowgrphFunctionToolAllowlist,
} from "../agent-api/src/knowgrph-function-gateway.js";
import {
  createOpenAiResponsesFunctionAdapter,
  resolveOpenAiResponsesFunctionConfig,
} from "../agent-api/src/openai-responses-function-adapter.js";

const PRICING = Object.freeze({
  inputUsdPerMillion: 1,
  cachedInputUsdPerMillion: 0.1,
  cacheWriteUsdPerMillion: 1.25,
  outputUsdPerMillion: 2,
});

function reply(body, status = 200, headers = {}) {
  return {
    status,
    headers: { get: (name) => headers[name.toLowerCase()] || "" },
    text: async () => JSON.stringify(body),
  };
}

function openAiTurn(id, output, usage = {
  input_tokens: 10,
  output_tokens: 5,
  input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
}) {
  return {
    id,
    status: "completed",
    model: "gpt-test-snapshot",
    output,
    usage,
  };
}

test("OpenAI adapter preserves strict selection, reasoning replay, response identity, and reported usage", async () => {
  const requests = [];
  const responses = [
    openAiTurn("resp-1", [
      { type: "reasoning", id: "reason-1", summary: [], encrypted_content: "sealed" },
      { type: "function_call", call_id: "call-1", name: "read_record", arguments: "{\"value\":\"a\"}" },
    ], {
      input_tokens: 100,
      output_tokens: 20,
      input_tokens_details: { cached_tokens: 25, cache_write_tokens: 10 },
    }),
    openAiTurn("resp-2", [
      { type: "message", content: [{ type: "output_text", text: "Record loaded." }] },
    ]),
  ];
  const adapter = createOpenAiResponsesFunctionAdapter({
    apiKey: "server-secret",
    model: "gpt-test",
    pricing: PRICING,
    fetchImpl: async (request) => {
      requests.push(request);
      return reply(responses.shift());
    },
  });
  const tools = [{
    type: "function",
    name: "read_record",
    description: "Read one record.",
    parameters: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false },
    strict: true,
  }];
  const first = await adapter.advanceModel({
    input: [{ type: "request", value: { prompt: "Read record a." } }],
    tools,
    toolChoice: { mode: "forced", name: "read_record" },
    parallelToolCalls: false,
  });
  const second = await adapter.advanceModel({
    input: [first.items[0], { type: "function_call_output", callId: "call-1", output: { value: "record" } }],
    tools,
    toolChoice: { mode: "allowed", names: ["read_record"], requirement: "auto" },
    parallelToolCalls: false,
    previousResponseId: first.responseId,
  });

  assert.equal(first.items[1].callId, "call-1");
  assert.equal(first.costLog.cached_tokens, 25);
  assert.equal(first.costLog.provider_cache_status, "hit");
  assert.equal(first.costLog.estimated_cost_usd, 0.00012);
  assert.equal(first.costLog.cache_write_tokens, 10);
  assert.equal(second.items[0].output, "Record loaded.");
  assert.deepEqual(requests[0].body.tool_choice, { type: "function", name: "read_record" });
  assert.equal(requests[0].body.store, true);
  assert.deepEqual(requests[0].body.include, ["reasoning.encrypted_content"]);
  assert.equal(requests[1].body.previous_response_id, "resp-1");
  assert.equal(requests[1].body.input[0].encrypted_content, "sealed");
  assert.equal(requests[1].body.input[1].call_id, "call-1");
  assert.deepEqual(requests[1].body.tool_choice, {
    type: "allowed_tools",
    mode: "auto",
    tools: [{ type: "function", name: "read_record" }],
  });
  assert.equal(JSON.stringify(requests).includes("server-secret"), true);
  assert.equal(JSON.stringify(first).includes("server-secret"), false);
});

test("OpenAI adapter redacts provider bodies and configuration fails closed without model pricing", async () => {
  const config = resolveOpenAiResponsesFunctionConfig({ OPENAI_API_KEY: "secret" });
  assert.equal(config.ready, false);
  assert.equal(config.apiKeyPresent, true);
  const adapter = createOpenAiResponsesFunctionAdapter({
    apiKey: "server-secret",
    model: "gpt-test",
    pricing: PRICING,
    fetchImpl: async () => reply({ error: { message: "provider-secret-detail" } }, 429),
  });
  await assert.rejects(
    adapter.advanceModel({
      input: [{ type: "request", value: { prompt: "Use a tool." } }],
      tools: [],
      toolChoice: { mode: "none" },
      parallelToolCalls: false,
    }),
    (error) => error.code === "provider_http_error" && !error.message.includes("provider-secret-detail"),
  );

  const missingCacheWriteUsage = createOpenAiResponsesFunctionAdapter({
    apiKey: "server-secret",
    model: "gpt-test",
    pricing: PRICING,
    fetchImpl: async () => reply(openAiTurn("resp-usage", [
      { type: "message", content: [{ type: "output_text", text: "Done." }] },
    ], { input_tokens: 5, output_tokens: 1, input_tokens_details: { cached_tokens: 0 } })),
  });
  await assert.rejects(
    missingCacheWriteUsage.advanceModel({
      input: [{ type: "request", value: { prompt: "Answer directly." } }],
      tools: [],
      toolChoice: { mode: "none" },
      parallelToolCalls: false,
    }),
    (error) => error.code === "usage_invalid" && error.message.includes("cache_write_tokens"),
  );
});

test("Knowgrph gateway enforces its allowlist and immutable policy before MCP", async () => {
  let calls = 0;
  const guardrailsHumanReview = createGuardrailsHumanReviewRuntime({
    evaluateGuardrail: createKnowgrphGuardrailEvaluator(),
  });
  const gateway = createKnowgrphFunctionGateway({
    allowedToolNames: [KNOWGRPH_FUNCTION_TOOL_NAMES.status],
    mcpClient: {
      callTool: async () => {
        calls += 1;
        return {
          ok: true,
          view: "capabilities",
          entries: [{ toolId: "knowgrph.os.status" }],
          unavailableSources: [],
          cost_log: {
            model: "none",
            prompt_tokens: 0,
            completion_tokens: 0,
            cache_hits: 0,
            estimated_cost_usd: 0,
          },
        };
      },
    },
    guardrailsHumanReview,
  });
  const base = {
    runId: "run-a",
    callId: "call-a",
    name: KNOWGRPH_FUNCTION_TOOL_NAMES.status,
    arguments: { view: "capabilities" },
    caller: { type: "direct" },
    policy: {
      revision: "knowgrph-status-function/v1", riskClass: "read-only", idempotent: true, approvalRequired: false,
    },
  };
  const mismatch = await gateway.callTool({ ...base, policy: { ...base.policy, riskClass: "mutation" } });
  assert.equal(mismatch.status, "blocked");
  assert.equal(mismatch.reasonCode, "tool_policy_mismatch");
  assert.equal(calls, 0);

  const completed = await gateway.callTool(base);
  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.output.entry_ids, ["knowgrph.os.status"]);
  assert.equal(completed.costLog.estimated_cost_usd, 0);
  assert.equal(calls, 1);
  assert.equal(gateway.stats().inputGuardrailChecks, 1);
  assert.equal(gateway.stats().outputGuardrailChecks, 1);

  const nonzeroGateway = createKnowgrphFunctionGateway({
    allowedToolNames: [KNOWGRPH_FUNCTION_TOOL_NAMES.status],
    mcpClient: {
      callTool: async () => ({
        ok: true,
        view: "capabilities",
        entries: [],
        unavailableSources: [],
        cost_log: {
          model: "unexpected-model",
          prompt_tokens: 1,
          completion_tokens: 0,
          cache_hits: 0,
          estimated_cost_usd: 0.001,
        },
      }),
    },
    guardrailsHumanReview,
  });
  const rejectedCost = await nonzeroGateway.callTool(base);
  assert.equal(rejectedCost.status, "blocked");
  assert.equal(rejectedCost.reasonCode, "tool_output_invalid");
});

test("Knowgrph gateway resumes a review-required status call with exact signed reviewer evidence", async () => {
  const reviewSecret = "review-secret";
  let mcpCalls = 0;
  const guardrailsHumanReview = createGuardrailsHumanReviewRuntime({
    evaluateGuardrail: createKnowgrphGuardrailEvaluator(),
    createReviewId: () => "status-review-1",
    authenticateReviewer: async ({ state, evidence }) => {
      const verdict = verifyReviewerToken(evidence?.token, reviewSecret, state);
      return verdict.valid
        ? {
          authenticated: true,
          subjectId: verdict.claims.sub,
          evidenceId: verdict.claims.jti,
          assurance: "signed-review-token",
        }
        : { authenticated: false };
    },
  });
  const gateway = createKnowgrphFunctionGateway({
    allowedToolNames: [KNOWGRPH_FUNCTION_TOOL_NAMES.status],
    reviewRequiredToolNames: [KNOWGRPH_FUNCTION_TOOL_NAMES.status],
    guardrailsHumanReview,
    mcpClient: {
      callTool: async () => {
        mcpCalls += 1;
        return {
          ok: true,
          view: "capabilities",
          entries: [{ toolId: "knowgrph.os.status" }],
          unavailableSources: [],
          cost_log: {
            model: "none",
            prompt_tokens: 0,
            completion_tokens: 0,
            cache_hits: 0,
            estimated_cost_usd: 0,
          },
        };
      },
    },
  });
  const call = {
    runId: "reviewed-run",
    conversationId: "reviewed-conversation",
    callId: "reviewed-call",
    name: KNOWGRPH_FUNCTION_TOOL_NAMES.status,
    arguments: { view: "capabilities" },
    caller: { type: "direct" },
    policy: {
      revision: "knowgrph-status-function/v1", riskClass: "read-only", idempotent: true, approvalRequired: true,
    },
  };

  const paused = await gateway.callTool(call);
  assert.equal(paused.status, "paused");
  assert.equal(mcpCalls, 0);
  const reviewerToken = mintReviewerToken({
    secret: reviewSecret,
    subject: "operator-1",
    ...paused.resumeState,
  });
  const completed = await gateway.callTool({
    ...call,
    review: {
      state: paused.resumeState,
      resolution: {
        reviewId: paused.resumeState.reviewId,
        decision: "approve",
        reviewerEvidence: { token: reviewerToken },
      },
    },
  });
  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.output.entry_ids, ["knowgrph.os.status"]);
  assert.equal(mcpCalls, 1);
  assert.deepEqual(gateway.stats().reviewRequiredToolNames, [KNOWGRPH_FUNCTION_TOOL_NAMES.status]);
  assert.equal(gateway.stats().reviewPauses, 1);
  assert.equal(gateway.stats().reviewResolutions, 1);
});

test("built-in run-note mutation cannot bypass review and requires native receipt evidence", async () => {
  assert.deepEqual(
    parseKnowgrphFunctionToolAllowlist(`unknown,${KNOWGRPH_FUNCTION_TOOL_NAMES.runNote}`),
    [KNOWGRPH_FUNCTION_TOOL_NAMES.runNote],
  );
  const reviewSecret = "run-note-review-secret";
  let mcpCall;
  const guardrailsHumanReview = createGuardrailsHumanReviewRuntime({
    evaluateGuardrail: createKnowgrphGuardrailEvaluator(),
    createReviewId: () => "run-note-review-1",
    authenticateReviewer: async ({ state, evidence }) => {
      const verdict = verifyReviewerToken(evidence?.token, reviewSecret, state);
      return verdict.valid
        ? { authenticated: true, subjectId: verdict.claims.sub, evidenceId: verdict.claims.jti, assurance: "signed-review-token" }
        : { authenticated: false };
    },
  });
  const gateway = createKnowgrphFunctionGateway({
    allowedToolNames: [KNOWGRPH_FUNCTION_TOOL_NAMES.runNote],
    guardrailsHumanReview,
    mcpClient: {
      callTool: async (name, argumentsValue, options) => {
        mcpCall = { name, argumentsValue, options };
        return {
          ok: true,
          run_id: argumentsValue.run_id,
          note: argumentsValue.note,
          revision: 1,
          execution_receipt: {
            schema: "knowgrph-tool-execution-receipt/v1",
            idempotencyKey: options.execution.idempotencyKey,
            requestDigest: options.execution.requestDigest,
            status: "applied",
          },
        };
      },
    },
  });
  const call = {
    runId: "reviewed-run-note",
    conversationId: "reviewed-run-note-conversation",
    callId: "reviewed-run-note-call",
    name: KNOWGRPH_FUNCTION_TOOL_NAMES.runNote,
    arguments: { run_id: "target-run", note: "Operator reviewed this run." },
    caller: { type: "direct" },
    policy: {
      revision: "knowgrph-run-note-function/v1",
      riskClass: "mutation",
      idempotent: true,
      approvalRequired: true,
    },
  };

  assert.equal(gateway.tools[0].approvalRequired, true);
  assert.deepEqual(gateway.stats().reviewRequiredToolNames, [KNOWGRPH_FUNCTION_TOOL_NAMES.runNote]);
  const bypass = await gateway.callTool({
    ...call,
    policy: { ...call.policy, approvalRequired: false },
  });
  assert.equal(bypass.reasonCode, "tool_policy_mismatch");
  assert.equal(mcpCall, undefined);

  const paused = await gateway.callTool(call);
  assert.equal(paused.status, "paused");
  assert.equal(paused.executionReceipt.phase, "reserved");
  const reviewerToken = mintReviewerToken({
    secret: reviewSecret,
    subject: "operator-1",
    ...paused.resumeState,
  });
  const completed = await gateway.callTool({
    ...call,
    review: {
      state: paused.resumeState,
      resolution: {
        reviewId: paused.resumeState.reviewId,
        decision: "approve",
        reviewerEvidence: { token: reviewerToken },
      },
    },
  });

  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.output, {
    ok: true,
    run_id: "target-run",
    note: "Operator reviewed this run.",
    revision: 1,
  });
  assert.equal(mcpCall.name, "knowgrph.run_manifest.note.update");
  assert.equal(mcpCall.options.execution.schema, "function-execution-receipt/v1");
});

test("Agent API completes one authenticated OpenAI and Knowgrph function loop without exposing keys", async () => {
  const openAiBodies = [];
  const mcpCalls = [];
  let openAiTurnIndex = 0;
  const env = {
    AGENT_API_JWT_SECRET: "jwt-secret",
    KNOWGRPH_MCP_ENDPOINT: "https://knowgrph.example/mcp",
    KNOWGRPH_FUNCTION_TOOL_ALLOWLIST: KNOWGRPH_FUNCTION_TOOL_NAMES.status,
    OPENAI_API_KEY: "openai-secret",
    OPENAI_FUNCTION_CALLING_MODEL: "gpt-test",
    OPENAI_FUNCTION_CALLING_INPUT_USD_PER_MILLION: "1",
    OPENAI_FUNCTION_CALLING_CACHED_INPUT_USD_PER_MILLION: "0.1",
    OPENAI_FUNCTION_CALLING_CACHE_WRITE_USD_PER_MILLION: "1.25",
    OPENAI_FUNCTION_CALLING_OUTPUT_USD_PER_MILLION: "2",
  };
  const app = createAgentApiApp({
    env,
    fetchImpl: async (request) => {
      const requestUrl = new URL(request.url);
      if (requestUrl.origin === "https://api.openai.com" && requestUrl.pathname === "/v1/responses") {
        openAiBodies.push(request.body);
        openAiTurnIndex += 1;
        return reply(openAiTurnIndex === 1
          ? openAiTurn("resp-a", [
            { type: "reasoning", id: "reason-a", summary: [], encrypted_content: "sealed-a" },
            {
              type: "function_call",
              call_id: "call-a",
              name: KNOWGRPH_FUNCTION_TOOL_NAMES.status,
              arguments: "{\"view\":\"capabilities\"}",
            },
          ])
          : openAiTurn("resp-b", [
            { type: "message", content: [{ type: "output_text", text: "Knowgrph capabilities loaded." }] },
          ]));
      }
      if (request.body.method === "initialize") {
        return reply({}, 200, { "mcp-session-id": "mcp-session" });
      }
      mcpCalls.push(request.body);
      return reply({
        jsonrpc: "2.0",
        id: request.body.id,
        result: {
          structuredContent: {
            ok: true,
            view: "capabilities",
            entries: [{ toolId: "knowgrph.os.status" }, { toolId: "knowgrph.agent.run" }],
            unavailableSources: [],
            cost_log: {
              model: "none",
              prompt_tokens: 0,
              completion_tokens: 0,
              cache_hits: 0,
              estimated_cost_usd: 0,
            },
          },
        },
      }, 200, { "content-type": "application/json" });
    },
  });
  const ready = app.readiness().functionCalling;
  assert.equal(ready.configured, true);
  assert.equal(ready.adapter.provider, "openai");
  assert.equal(ready.adapter.apiKeyPresent, true);
  assert.deepEqual(ready.gateway.allowedToolNames, [KNOWGRPH_FUNCTION_TOOL_NAMES.status]);
  assert.equal(JSON.stringify(ready).includes("openai-secret"), false);

  const session = await app.authSession({ body: {} });
  const result = await app.functionCall({
    headers: { authorization: `Bearer ${session.body.token}` },
    body: {
      runId: "live-proof-shape",
      prompt: "Read the Knowgrph capability status, then summarize it.",
      toolChoice: { mode: "forced", name: KNOWGRPH_FUNCTION_TOOL_NAMES.status },
      parallelToolCalls: false,
    },
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.status, "completed");
  assert.equal(result.body.output, "Knowgrph capabilities loaded.");
  assert.equal(result.body.evidence.toolCalls, 1);
  assert.equal(result.body.evidence.callIdentity, "preserved");
  assert.deepEqual(result.body.evidence.providerResponseIds, ["resp-a", "resp-b"]);
  assert.equal(mcpCalls[0].params.name, "knowgrph.os.status");
  assert.equal(openAiBodies[1].previous_response_id, "resp-a");
  assert.equal(openAiBodies[1].input[1].call_id, "call-a");
  assert.equal(openAiBodies[1].tool_choice, "auto");
  assert.equal(JSON.stringify(result.body).includes("sealed-a"), false);
  assert.equal(JSON.stringify(result.body).includes("openai-secret"), false);

  const spoofedApproval = await app.functionCall({
    headers: { authorization: `Bearer ${session.body.token}` },
    body: {
      runId: "spoofed-approval",
      prompt: "Read status.",
      approvals: [{ decision: "approve" }],
    },
  });
  assert.equal(spoofedApproval.statusCode, 400);
  assert.deepEqual(spoofedApproval.body.fields[0], { field: "approvals", reason: "unsupported field" });
});

test("function endpoint rejects unauthenticated and unconfigured calls before transport", async () => {
  let called = false;
  const app = createAgentApiApp({
    env: { AGENT_API_JWT_SECRET: "jwt-secret" },
    fetchImpl: async () => {
      called = true;
      throw new Error("unexpected transport");
    },
  });
  const unauthorized = await app.functionCall({ body: { runId: "x", prompt: "x" } });
  assert.equal(unauthorized.statusCode, 401);
  const session = await app.authSession({ body: {} });
  const unconfigured = await app.functionCall({
    headers: { authorization: `Bearer ${session.body.token}` },
    body: { runId: "x", prompt: "x" },
  });
  assert.equal(unconfigured.statusCode, 501);
  assert.equal(called, false);
});
