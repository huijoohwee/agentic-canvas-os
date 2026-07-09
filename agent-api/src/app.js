// Platform-neutral Agent-API app wiring for agentic-canvas-os.
//
// Builds the request handlers (`authSession`, `run`, readiness metadata) from
// Cloudflare environment bindings, wired to a keyless knowgrph MCP client.
//
// Env (server-side only; never shipped to the client):
//   AGENT_API_JWT_SECRET   — HS256 signing secret (required to mint/verify)
//   KNOWGRPH_MCP_ENDPOINT  — knowgrph control-plane MCP Streamable HTTP endpoint
//   AGENT_MODEL_*          — optional Hermes-like model route overrides
//   AGENT_API_AUTH_EXPIRY  — optional session expiry seconds [300, 86400]

import { createAuthSessionHandler, createRunHandler } from "./handler.js";
import { agentModelConfigReady, resolveAgentModelConfig } from "./model-config.js";
import { createKnowgrphMcpClient } from "../../src/knowgrph-mcp-client.js";

/**
 * Build the configured Agent-API handlers from an env bag (defaults to
 * `process.env`). The MCP client is created only when an endpoint is set;
 * otherwise the run handler fails closed (501) — never a silent direct model
 * call. Tests inject `{ env, fetchImpl }` for full offline control.
 *
 * @param {object} [opts]
 * @param {object} [opts.env] environment bag (default process.env)
 * @param {Function} [opts.fetchImpl] injectable MCP transport (tests)
 * @returns {{ authSession: Function, run: Function, configured: boolean }}
 */
export function createAgentApiApp({ env, fetchImpl } = {}) {
  const e = env || (typeof process !== "undefined" ? process.env : {}) || {};
  const secret = typeof e.AGENT_API_JWT_SECRET === "string" ? e.AGENT_API_JWT_SECRET : "";
  const endpoint = typeof e.KNOWGRPH_MCP_ENDPOINT === "string" ? e.KNOWGRPH_MCP_ENDPOINT.trim() : "";
  const expiry = Number(e.AGENT_API_AUTH_EXPIRY);
  const agentModelConfig = resolveAgentModelConfig(e);
  const modelKeyPresent = typeof e[agentModelConfig.apiKeyEnv] === "string" && Boolean(e[agentModelConfig.apiKeyEnv].trim());

  let mcpClient = null;
  if (endpoint) {
    mcpClient = createKnowgrphMcpClient({ endpoint, fetchImpl });
  }

  return {
    configured: Boolean(secret && endpoint),
    agentModelConfig,
    readiness: () => ({
      configured: Boolean(secret && endpoint && agentModelConfigReady(agentModelConfig) && modelKeyPresent),
      auth: { configured: Boolean(secret) },
      controlPlane: { configured: Boolean(endpoint), endpoint },
      model: {
        configured: agentModelConfigReady(agentModelConfig),
        provider: agentModelConfig.provider,
        protocol: agentModelConfig.protocol,
        endpoint: agentModelConfig.endpoint,
        model: agentModelConfig.model,
        apiKeyEnv: agentModelConfig.apiKeyEnv,
        apiKeyPresent: modelKeyPresent,
      },
    }),
    authSession: createAuthSessionHandler({
      secret,
      ...(Number.isFinite(expiry) ? { defaultExpirySeconds: expiry } : {}),
    }),
    run: createRunHandler({ secret, mcpClient }),
  };
}
