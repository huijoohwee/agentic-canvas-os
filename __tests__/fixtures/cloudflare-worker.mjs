import { createHash } from "node:crypto";

const ENV = Object.freeze({
  AGENT_API_JWT_SECRET: "server-side-secret",
  AGENTIC_OS_MCP_ENDPOINT: "https://airvio.co/agentic-os/control-plane/mcp",
  AGENT_MODEL_PROVIDER: "workspace-provider",
  AGENT_MODEL_PROVIDER_REVISION: "workspace-provider-v1",
  AGENT_MODEL_ADAPTER: "workspace-adapter",
  AGENT_MODEL_ENDPOINT: "https://models.example/v1",
  AGENT_MODEL_ID: "workspace-model",
  AGENT_MODEL_API_KEY_ENV: "WORKSPACE_MODEL_KEY",
  AGENT_MODEL_TRANSPORT: "stream-channel",
  AGENT_MODEL_TRANSPORT_DELIVERY: "incremental",
  AGENT_MODEL_TRANSPORT_CONNECTION: "reusable",
  AGENT_MODEL_FEATURES: "tool-calling,structured-output",
  WORKSPACE_MODEL_KEY: "server-side-model-key",
});

const UPSTREAM_RUNTIME_SOURCE = JSON.stringify({
  name: "Operator Runtime Agent",
  instructions: [{ name: "purpose", content: "Return one bounded answer for the authenticated caller." }],
});
const UPSTREAM_RUNTIME_SOURCE_DIGEST = createHash("sha256").update(UPSTREAM_RUNTIME_SOURCE).digest("hex");

const UPSTREAM_RUNTIME_ENV = Object.freeze({
  AGENT_API_JWT_SECRET: "server-side-secret",
  AGENTIC_OS_MCP_ENDPOINT: "https://airvio.co/agentic-os/control-plane/mcp",
  AGENTIC_OS_FUNCTION_TOOL_ALLOWLIST: "update_agent_run_note",
  AGENTIC_OS_FUNCTION_REVIEW_REQUIRED: "update_agent_run_note",
  OPENAI_FUNCTION_CALLING_ENDPOINT: "https://api.openai.com/v1/responses",
  OPENAI_FUNCTION_CALLING_API_KEY_ENV: "OPENAI_API_KEY",
  OPENAI_FUNCTION_CALLING_MODEL: "gpt-5.6-luna",
  OPENAI_FUNCTION_CALLING_INPUT_USD_PER_MILLION: "1",
  OPENAI_FUNCTION_CALLING_CACHED_INPUT_USD_PER_MILLION: "0.1",
  OPENAI_FUNCTION_CALLING_CACHE_WRITE_USD_PER_MILLION: "1.25",
  OPENAI_FUNCTION_CALLING_OUTPUT_USD_PER_MILLION: "2",
  OPENAI_FUNCTION_CALLING_REASONING_EFFORT: "low",
  OPENAI_FUNCTION_CALLING_MAX_OUTPUT_TOKENS: "256",
  AGENT_MODEL_PROVIDER: "openai",
  AGENT_MODEL_PROVIDER_REVISION: "openai-agent-v1",
  AGENT_MODEL_ADAPTER: "openai-responses-agent",
  AGENT_MODEL_ENDPOINT: "https://api.openai.com/v1/responses",
  AGENT_MODEL_ID: "gpt-5.6-sol",
  AGENT_MODEL_API_KEY_ENV: "OPENAI_API_KEY",
  AGENT_MODEL_TRANSPORT: "responses-http",
  AGENT_MODEL_TRANSPORT_DELIVERY: "complete",
  AGENT_MODEL_TRANSPORT_CONNECTION: "per-run",
  AGENT_MODEL_FEATURES: "tool-calling,structured-output",
  OPENAI_API_KEY: "server-side-openai-key",
  OPENAI_AGENT_MODEL: "gpt-5.6-sol",
  OPENAI_AGENT_ENDPOINT: "https://api.openai.com/v1/responses",
  OPENAI_AGENT_INPUT_USD_PER_MILLION: "5",
  OPENAI_AGENT_CACHED_INPUT_USD_PER_MILLION: "0.5",
  OPENAI_AGENT_OUTPUT_USD_PER_MILLION: "30",
  OPENAI_AGENT_MAX_OUTPUT_TOKENS: "128",
  AGENT_RUNTIME_ENABLED: "true",
  AGENT_RUNTIME_SPEND_APPROVED: "true",
  AGENT_RUNTIME_AGENT_ID: "operator-runtime-agent",
  AGENT_RUNTIME_AGENT_REVISION: "operator-runtime-agent-v1",
  AGENT_RUNTIME_AGENT_SOURCE_URI: "operator-source:/agent/runtime.json",
  AGENT_RUNTIME_AGENT_SOURCE_SHA256: UPSTREAM_RUNTIME_SOURCE_DIGEST,
  AGENT_RUNTIME_AGENT_SOURCE: UPSTREAM_RUNTIME_SOURCE,
  AGENT_RUNTIME_MAX_PROVIDER_CALLS: "4",
});

const DURABLE_ENV = Object.freeze({
  ...ENV,
  AGENT_REVIEW_JWT_SECRET: "review-signing-secret",
  AGENT_STATE: Object.freeze({
    idFromName: (name) => name,
    get: () => Object.freeze({ fetch: async () => new Response("{}", { status: 200 }) }),
  }),
});

const TOOLKIT_PROFILE = Object.freeze({
  evaluator: Object.freeze({ id: "worker-evaluator", revision: "eval-v1", digest: "3".repeat(64) }),
  dataset: Object.freeze({ id: "worker-dataset", revision: "dataset-v1", digest: "4".repeat(64) }),
  metric: Object.freeze({
    id: "worker-quality",
    revision: "metric-v1",
    digest: "5".repeat(64),
    direction: "maximize",
  }),
});

function toolkitStartRequest(runId, cohortId = "worker-toolkit-cohort") {
  return {
    runId,
    cohortId,
    target: { kind: "team", id: "worker-team", revision: "team-v1", digest: "1".repeat(64) },
    candidate: { id: "worker-policy", revision: "policy-v1", digest: "a".repeat(64) },
    adapter: { id: "worker-adapter", revision: "adapter-v1", digest: "2".repeat(64) },
    operation: "worker-observe",
    profile: TOOLKIT_PROFILE,
  };
}

function request(path, { method = "GET", headers = {}, body } = {}) {
  return new Request(`https://agentic-canvas-os.example${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function json(res) {
  return JSON.parse(await res.text());
}

async function withMockedFetch(mockFetch, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

export { ENV, UPSTREAM_RUNTIME_SOURCE, UPSTREAM_RUNTIME_ENV, DURABLE_ENV, toolkitStartRequest, request, json, withMockedFetch };
