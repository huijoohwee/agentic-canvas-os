import assert from "node:assert/strict";
import test from "node:test";

import { runLiveAgentProviderProof } from "../agent-api/src/live-agent-provider-proof.js";
import {
  createOpenAiResponsesAgentAdapter,
  resolveOpenAiResponsesAgentConfig,
} from "../agent-api/src/openai-responses-agent-adapter.js";

const MODEL = "gpt-live-test";
const PRICING = Object.freeze({
  inputUsdPerMillion: 5,
  cachedInputUsdPerMillion: 0.5,
  outputUsdPerMillion: 30,
});

function config(overrides = {}) {
  return Object.freeze({
    ready: true,
    provider: "openai",
    protocol: "responses",
    endpoint: "https://api.openai.com/v1/responses",
    model: MODEL,
    apiKeyEnv: "OPENAI_API_KEY",
    apiKeyPresent: true,
    apiKey: "test-secret",
    pricing: PRICING,
    pricingReady: true,
    reasoningEffort: "low",
    maxOutputTokens: 96,
    ...overrides,
  });
}

function payload({ id, output, context, inputTokens = 40, outputTokens = 8, cachedTokens = 0 }) {
  return {
    id,
    status: "completed",
    model: MODEL,
    output_text: output,
    output: [],
    reasoning: { effort: "low", context },
    usage: {
      input_tokens: inputTokens,
      input_tokens_details: { cached_tokens: cachedTokens },
      output_tokens: outputTokens,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: inputTokens + outputTokens,
    },
  };
}

function response(value) {
  return { status: 200, text: async () => JSON.stringify(value) };
}

function adapterCall(overrides = {}) {
  return {
    agent: "specialist",
    role: "behind-manager",
    workflow: { workflowId: "proof", revision: "v1" },
    branch: { branchId: "delegate", mode: "delegate" },
    preparedAgent: {
      instructions: [{ name: "purpose", content: "Return one bounded result." }],
    },
    modelProvider: { model: { id: MODEL } },
    input: { request: "Verify." },
    continuation: { strategy: "previous-response" },
    ...overrides,
  };
}

test("requires explicit model, key, pricing, and a safe endpoint", () => {
  const ready = resolveOpenAiResponsesAgentConfig({
    OPENAI_API_KEY: "secret",
    OPENAI_AGENT_MODEL: MODEL,
    OPENAI_AGENT_INPUT_USD_PER_MILLION: "5",
    OPENAI_AGENT_CACHED_INPUT_USD_PER_MILLION: "0.5",
    OPENAI_AGENT_OUTPUT_USD_PER_MILLION: "30",
    OPENAI_AGENT_MAX_OUTPUT_TOKENS: "96",
  });
  assert.equal(ready.ready, true);
  assert.equal(ready.maxOutputTokens, 96);
  assert.deepEqual(ready.pricing, PRICING);
  const missingPricing = resolveOpenAiResponsesAgentConfig({
    OPENAI_API_KEY: "secret",
    OPENAI_AGENT_MODEL: MODEL,
  });
  assert.equal(missingPricing.ready, false);
  const unsafe = resolveOpenAiResponsesAgentConfig({
    OPENAI_API_KEY: "secret",
    OPENAI_AGENT_MODEL: MODEL,
    OPENAI_AGENT_ENDPOINT: "http://example.com/v1/responses",
    OPENAI_AGENT_INPUT_USD_PER_MILLION: "5",
    OPENAI_AGENT_CACHED_INPUT_USD_PER_MILLION: "0.5",
    OPENAI_AGENT_OUTPUT_USD_PER_MILLION: "30",
  });
  assert.equal(unsafe.ready, false);
});

test("sends stable instructions before dynamic input and confirms stored continuation", async () => {
  const requests = [];
  const replies = [
    payload({ id: "resp-1", output: "SPECIALIST_NOTE: first", context: "current_turn" }),
    payload({ id: "resp-2", output: "SPECIALIST_FINAL: second", context: "all_turns", cachedTokens: 12 }),
  ];
  const adapter = createOpenAiResponsesAgentAdapter({
    ...config(),
    fetchImpl: async (request) => {
      requests.push(request);
      return response(replies.shift());
    },
  });
  const first = await adapter.advanceAgent(adapterCall());
  const second = await adapter.advanceAgent(adapterCall({
    role: "user-facing-owner",
    continuation: { strategy: "previous-response", previousResponseId: first.responseId },
  }));
  assert.equal(first.status, "completed");
  assert.equal(second.output.startsWith("SPECIALIST_FINAL:"), true);
  assert.equal(requests[0].body.instructions, "[purpose]\nReturn one bounded result.");
  assert.equal(requests[0].body.store, true);
  assert.equal(requests[0].body.reasoning.context, "current_turn");
  assert.equal("previous_response_id" in requests[0].body, false);
  assert.equal(requests[1].body.previous_response_id, "resp-1");
  assert.equal(requests[1].body.reasoning.context, "all_turns");
  assert.equal(requests[1].body.max_output_tokens, 96);
  assert.equal(second.costLog.cache_hits, 1);
  assert.equal(adapter.evidence()[1].previousResponseIdDigest, adapter.evidence()[0].responseIdDigest);
  assert.equal(JSON.stringify(adapter.evidence()).includes("resp-1"), false);
  assert.equal(JSON.stringify(adapter.stats()).includes("test-secret"), false);
});

test("runs one delegation then one handoff with exactly three provider calls", async () => {
  const requests = [];
  const replies = [
    payload({ id: "resp-specialist-1", output: "SPECIALIST_NOTE: delegated", context: "current_turn" }),
    payload({ id: "resp-manager-1", output: "MANAGER_FINAL: delegated result synthesized", context: "current_turn" }),
    payload({ id: "resp-specialist-2", output: "SPECIALIST_FINAL: handoff owned", context: "all_turns" }),
  ];
  const proof = await runLiveAgentProviderProof({
    config: config(),
    approvalId: "offline-test-approval",
    fetchImpl: async (request) => {
      requests.push(request);
      return response(replies.shift());
    },
  });
  assert.equal(proof.status, "passed");
  assert.equal(proof.bounds.providerCalls, 3);
  assert.equal(proof.execution.delegation.finalAnswerOwner, "live-proof-manager");
  assert.equal(proof.execution.handoff.finalAnswerOwner, "live-proof-specialist");
  assert.equal(proof.execution.continuation.responseLinkVerified, true);
  assert.equal(proof.execution.continuation.effectiveReasoningContext, "all_turns");
  assert.equal(requests.length, 3);
  assert.equal(requests[2].body.previous_response_id, "resp-specialist-1");
  assert.equal(proof.usage.promptTokens, 120);
  assert.equal(proof.usage.completionTokens, 24);
  assert.equal(JSON.stringify(proof).includes("resp-specialist-1"), false);
  assert.equal(JSON.stringify(proof).includes("test-secret"), false);
});

test("fails closed when the provider omits effective reasoning context or usage", async () => {
  const missingContext = createOpenAiResponsesAgentAdapter({
    ...config(),
    fetchImpl: async () => response({
      ...payload({ id: "resp-1", output: "SPECIALIST_NOTE: result", context: "current_turn" }),
      reasoning: { effort: "low" },
    }),
  });
  await assert.rejects(() => missingContext.advanceAgent(adapterCall()), /did not confirm/);
  const missingUsage = createOpenAiResponsesAgentAdapter({
    ...config(),
    fetchImpl: async () => response({
      ...payload({ id: "resp-1", output: "SPECIALIST_NOTE: result", context: "current_turn" }),
      usage: undefined,
    }),
  });
  await assert.rejects(() => missingUsage.advanceAgent(adapterCall()), /did not include usage/);
});

test("enforces the provider turn ceiling and exposes only redacted partial evidence", async () => {
  const adapter = createOpenAiResponsesAgentAdapter({
    ...config(),
    maxTurns: 1,
    fetchImpl: async () => response(payload({
      id: "resp-sensitive",
      output: "SPECIALIST_NOTE: bounded",
      context: "current_turn",
    })),
  });
  await adapter.advanceAgent(adapterCall());
  await assert.rejects(() => adapter.advanceAgent(adapterCall()), /turn limit of 1/);
  assert.equal(adapter.stats().attemptedTurns, 1);
  assert.equal(adapter.stats().completedTurns, 1);
  assert.equal(JSON.stringify(adapter.evidence()).includes("resp-sensitive"), false);
});
