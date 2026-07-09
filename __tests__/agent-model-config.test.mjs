// Tests for the server-side Hermes Agent-like model config.

import test from "node:test";
import assert from "node:assert/strict";

import { agentModelConfigReady, resolveAgentModelConfig } from "../agent-api/src/model-config.js";
import { createAgentApiApp } from "../agent-api/src/app.js";

test("defaults the Hermes-like agent model config to SEA-LION chat completions", () => {
  const config = resolveAgentModelConfig({});

  assert.deepEqual(config, {
    provider: "sealion",
    protocol: "openai-chat-completions",
    baseUrl: "https://api.sea-lion.ai/v1",
    endpoint: "https://api.sea-lion.ai/v1/chat/completions",
    model: "aisingapore/Gemma-SEA-LION-v4-27B-IT",
    apiKeyEnv: "SEA_LION_API_KEY",
  });
  assert.equal(agentModelConfigReady(config), true);
});

test("resolves neutral overrides without serializing a provider key", () => {
  const config = resolveAgentModelConfig({
    AGENT_MODEL_PROVIDER: "sealion",
    AGENT_MODEL_BASE_URL: "https://api.sea-lion.ai/v1/",
    AGENT_MODEL_ID: "aisingapore/Llama-SEA-LION-v3.5-70B-R",
    AGENT_MODEL_API_KEY_ENV: "SERVER_SIDE_SEALION_KEY",
    SEA_LION_API_KEY: "secret-value",
  });

  assert.equal(config.endpoint, "https://api.sea-lion.ai/v1/chat/completions");
  assert.equal(config.model, "aisingapore/Llama-SEA-LION-v3.5-70B-R");
  assert.equal(config.apiKeyEnv, "SERVER_SIDE_SEALION_KEY");
  assert.equal(Object.values(config).includes("secret-value"), false);
});

test("Agent-API app exposes the resolved server-side model route metadata", () => {
  const app = createAgentApiApp({
    env: {
      AGENT_API_JWT_SECRET: "server-side-secret",
      KNOWGRPH_MCP_ENDPOINT: "https://airvio.co/knowgrph/mcp",
      SEA_LION_MODEL: "aisingapore/Gemma-SEA-LION-v4-27B-IT",
    },
    fetchImpl: async () => {
      throw new Error("not called");
    },
  });

  assert.equal(app.agentModelConfig.provider, "sealion");
  assert.equal(app.agentModelConfig.endpoint, "https://api.sea-lion.ai/v1/chat/completions");
  assert.equal(app.agentModelConfig.model, "aisingapore/Gemma-SEA-LION-v4-27B-IT");
});

test("readiness reports SEA-LION key presence without exposing the key", () => {
  const app = createAgentApiApp({
    env: {
      AGENT_API_JWT_SECRET: "server-side-secret",
      KNOWGRPH_MCP_ENDPOINT: "https://airvio.co/knowgrph/mcp",
      SEA_LION_API_KEY: "secret-value",
    },
    fetchImpl: async () => {
      throw new Error("not called");
    },
  });

  const readiness = app.readiness();
  assert.equal(readiness.configured, true);
  assert.equal(readiness.model.provider, "sealion");
  assert.equal(readiness.model.endpoint, "https://api.sea-lion.ai/v1/chat/completions");
  assert.equal(readiness.model.apiKeyEnv, "SEA_LION_API_KEY");
  assert.equal(readiness.model.apiKeyPresent, true);
  assert.equal(JSON.stringify(readiness).includes("secret-value"), false);
});

test("readiness fails closed when the SEA-LION key env var is absent", () => {
  const app = createAgentApiApp({
    env: {
      AGENT_API_JWT_SECRET: "server-side-secret",
      KNOWGRPH_MCP_ENDPOINT: "https://airvio.co/knowgrph/mcp",
    },
  });

  const readiness = app.readiness();
  assert.equal(readiness.configured, false);
  assert.equal(readiness.auth.configured, true);
  assert.equal(readiness.controlPlane.configured, true);
  assert.equal(readiness.model.configured, true);
  assert.equal(readiness.model.apiKeyPresent, false);
});
