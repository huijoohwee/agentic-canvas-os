import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createAgentApiApp } from "../agent-api/src/app.js";
import { resolveAutonomousRuntimeEnvironment } from "../agent-api/src/autonomous-runtime-config.js";
import { resolveModelProviderEnvironment } from "../agent-api/src/model-config.js";
import { resolveOpenAiResponsesAgentConfig } from "../agent-api/src/openai-responses-agent-adapter.js";
import { handleCloudflareRequest } from "../worker/index.js";

const SOURCE = JSON.stringify({
  name: "Operator Runtime Agent",
  instructions: [{ name: "purpose", content: "Return one bounded answer for the authenticated caller." }],
});
const SOURCE_DIGEST = createHash("sha256").update(SOURCE).digest("hex");

function runtimeEnv(overrides = {}) {
  return {
    AGENT_API_JWT_SECRET: "autonomous-session-secret",
    KNOWGRPH_MCP_ENDPOINT: "https://control.example/mcp",
    AGENT_MODEL_PROVIDER: "openai",
    AGENT_MODEL_PROVIDER_REVISION: "openai-agent-v1",
    AGENT_MODEL_ADAPTER: "openai-responses-agent",
    AGENT_MODEL_ENDPOINT: "https://api.openai.com/v1/responses",
    AGENT_MODEL_ID: "offline-agent-model",
    AGENT_MODEL_API_KEY_ENV: "OPENAI_API_KEY",
    AGENT_MODEL_TRANSPORT: "responses-http",
    AGENT_MODEL_TRANSPORT_DELIVERY: "complete",
    AGENT_MODEL_TRANSPORT_CONNECTION: "per-run",
    OPENAI_API_KEY: "server-side-openai-key",
    OPENAI_AGENT_MODEL: "offline-agent-model",
    OPENAI_AGENT_ENDPOINT: "https://api.openai.com/v1/responses",
    OPENAI_AGENT_INPUT_USD_PER_MILLION: "0",
    OPENAI_AGENT_CACHED_INPUT_USD_PER_MILLION: "0",
    OPENAI_AGENT_OUTPUT_USD_PER_MILLION: "0",
    OPENAI_AGENT_MAX_OUTPUT_TOKENS: "128",
    AGENT_RUNTIME_ENABLED: "true",
    AGENT_RUNTIME_SPEND_APPROVED: "true",
    AGENT_RUNTIME_AGENT_ID: "operator-runtime-agent",
    AGENT_RUNTIME_AGENT_REVISION: "operator-runtime-agent-v1",
    AGENT_RUNTIME_AGENT_SOURCE_URI: "operator-source:/agent/runtime.json",
    AGENT_RUNTIME_AGENT_SOURCE_SHA256: SOURCE_DIGEST,
    AGENT_RUNTIME_AGENT_SOURCE: SOURCE,
    AGENT_RUNTIME_MAX_PROVIDER_CALLS: "4",
    ...overrides,
  };
}

function providerTransport(calls) {
  return async (request) => {
    calls.push(request);
    const sequence = calls.length;
    return {
      status: 200,
      text: async () => JSON.stringify({
        id: `response-${sequence}`,
        status: "completed",
        model: "offline-agent-model",
        output_text: `bounded answer ${sequence}`,
        reasoning: { context: request.body.previous_response_id ? "all_turns" : "current_turn" },
        usage: {
          input_tokens: 8,
          output_tokens: 3,
          input_tokens_details: { cached_tokens: 0 },
        },
      }),
    };
  };
}

async function session(app) {
  const result = await app.authSession({ body: {} });
  return { authorization: `Bearer ${result.body.token}` };
}

test("keeps the autonomous runtime disabled until every operator gate aligns", () => {
  for (const [overrides, issue] of [
    [{ AGENT_RUNTIME_ENABLED: "false" }, "runtime_disabled"],
    [{ AGENT_RUNTIME_SPEND_APPROVED: "false" }, "spend_approval_missing"],
    [{ AGENT_RUNTIME_AGENT_SOURCE_SHA256: "a".repeat(64) }, "agent_source_sha256_mismatch"],
    [{ AGENT_MODEL_ID: "other-model" }, "model_mismatch"],
    [{ AGENT_RUNTIME_MAX_PROVIDER_CALLS: "65" }, "max_provider_calls_invalid"],
    [{ KNOWGRPH_MCP_ENDPOINT: "" }, "control_plane_unconfigured"],
  ]) {
    const env = runtimeEnv(overrides);
    const config = resolveAutonomousRuntimeEnvironment(env, {
      modelProviderEnvironment: resolveModelProviderEnvironment(env),
      openAiAgentConfig: resolveOpenAiResponsesAgentConfig(env),
    });
    assert.equal(config.ready, false);
    assert.ok(config.issues.includes(issue));
    assert.equal(config.definition, null);
  }
});

test("wires one source-verified definition through the authenticated composed agent route", async () => {
  const calls = [];
  const app = createAgentApiApp({ env: runtimeEnv(), fetchImpl: providerTransport(calls) });
  const readiness = app.readiness();
  assert.equal(readiness.autonomousRuntime.configured, true);
  assert.equal(readiness.autonomousRuntime.enabled, true);
  assert.equal(readiness.autonomousRuntime.spendApproved, true);
  assert.equal(readiness.autonomousRuntime.sourceDigestMatches, true);
  assert.equal(readiness.autonomousRuntime.controlPlaneConfigured, true);
  assert.equal(readiness.autonomousRuntime.route, "/api/agent/run");
  assert.equal(readiness.autonomousRuntime.auth, "session-token");
  assert.equal(readiness.autonomousRuntime.maxProviderCalls, 4);
  assert.equal(readiness.autonomousRuntime.maxOutputTokens, 128);
  assert.equal(readiness.agentDefinitions.configured, true);
  assert.equal(readiness.agentRuntimeComposition.configured, true);
  assert.equal(readiness.runningAgents.configured, true);
  assert.equal(readiness.autonomousRuntime.providerExecutionStatus, "unverified");
  assert.equal(JSON.stringify(readiness).includes("server-side-openai-key"), false);
  assert.equal(JSON.stringify(readiness).includes(SOURCE), false);

  const unauthorized = await app.agentRuntimeRun({ body: {} });
  assert.equal(unauthorized.statusCode, 401);
  const firstHeaders = await session(app);
  const secondHeaders = await session(app);
  const baseBody = { conversationId: "public-conversation", input: { task: "Answer safely." } };
  const first = await app.agentRuntimeRun({
    headers: firstHeaders,
    body: { ...baseBody, runId: "public-run-1" },
  });
  const isolated = await app.agentRuntimeRun({
    headers: secondHeaders,
    body: { ...baseBody, runId: "public-run-2" },
  });
  const continued = await app.agentRuntimeRun({
    headers: firstHeaders,
    body: { ...baseBody, runId: "public-run-3" },
  });
  assert.equal(first.statusCode, 200);
  assert.equal(isolated.statusCode, 200);
  assert.equal(continued.statusCode, 200);
  assert.equal(first.body.output, "bounded answer 1");
  assert.equal(Object.hasOwn(first.body, "responseId"), false);
  assert.equal(calls[0].body.previous_response_id, undefined);
  assert.equal(calls[1].body.previous_response_id, undefined);
  assert.equal(calls[2].body.previous_response_id, "response-1");
  assert.equal(calls[0].body.instructions.includes("authenticated caller"), true);
  assert.equal(calls[0].headers.authorization, "Bearer server-side-openai-key");
});

test("returns 501 without spending when the autonomous route is not explicitly approved", async () => {
  const calls = [];
  const app = createAgentApiApp({
    env: runtimeEnv({ AGENT_RUNTIME_SPEND_APPROVED: "false" }),
    fetchImpl: providerTransport(calls),
  });
  const headers = await session(app);
  const result = await app.agentRuntimeRun({
    headers,
    body: { runId: "blocked-run", conversationId: "blocked-conversation", input: "do not spend" },
  });
  assert.equal(result.statusCode, 501);
  assert.equal(result.body.code, "runtime_unconfigured");
  assert.equal(calls.length, 0);
});

test("exposes POST /api/agent/run through the Worker and rejects extra caller-owned controls", async () => {
  const env = runtimeEnv({ AGENT_RUNTIME_MAX_PROVIDER_CALLS: "1" });
  const providerCalls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => providerTransport(providerCalls)({
    url: _url,
    method: init.method,
    headers: init.headers,
    body: JSON.parse(init.body),
    signal: init.signal,
  });
  try {
    const authResponse = await handleCloudflareRequest(new Request("https://runtime.example/api/auth/session", {
      method: "POST",
      body: "{}",
    }), env);
    const token = (await authResponse.json()).token;
    const unauthorized = await handleCloudflareRequest(new Request("https://runtime.example/api/agent/run", {
      method: "POST",
      body: JSON.stringify({ runId: "worker-run", conversationId: "worker-conversation", input: "hello" }),
    }), env);
    assert.equal(unauthorized.status, 401);
    const invalid = await handleCloudflareRequest(new Request("https://runtime.example/api/agent/run", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({
        runId: "worker-run",
        conversationId: "worker-conversation",
        input: "hello",
        agent: { agentId: "caller-controlled" },
      }),
    }), env);
    assert.equal(invalid.status, 400);
    const completed = await handleCloudflareRequest(new Request("https://runtime.example/api/agent/run", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ runId: "worker-run", conversationId: "worker-conversation", input: "hello" }),
    }), env);
    assert.equal(completed.status, 200);
    assert.equal((await completed.json()).output, "bounded answer 1");
    assert.equal(providerCalls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
