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

import { createAuthSessionHandler, createRunHandler, createInvokeHandler } from "./handler.js";
import { createCacheContextRegistry } from "./cache-context.js";
import { agentModelConfigReady, resolveAgentModelConfig } from "./model-config.js";
import { createProgrammaticToolCallingRuntime } from "./programmatic-tool-calling.js";
import { createReasoningContinuityRegistry } from "./reasoning-continuity.js";
import { createToolSearchRuntime } from "./tool-search.js";
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
 * @param {ReturnType<createCacheContextRegistry>} [opts.cacheContext] isolate-scoped stable-prefix registry
 * @param {ReturnType<createReasoningContinuityRegistry>} [opts.reasoningContinuity] isolate-scoped turn-continuity registry
 * @param {ReturnType<createProgrammaticToolCallingRuntime>} [opts.programmaticToolCalling] hosted-program controller
 * @param {ReturnType<createToolSearchRuntime>} [opts.toolSearch] deferred-definition controller
 * @returns {{ authSession: Function, run: Function, configured: boolean }}
 */
export function createAgentApiApp({
  env,
  fetchImpl,
  cacheContext: providedCacheContext,
  reasoningContinuity: providedReasoningContinuity,
  programmaticToolCalling: providedProgrammaticToolCalling,
  toolSearch: providedToolSearch,
} = {}) {
  const e = env || (typeof process !== "undefined" ? process.env : {}) || {};
  const secret = typeof e.AGENT_API_JWT_SECRET === "string" ? e.AGENT_API_JWT_SECRET : "";
  const endpoint = typeof e.KNOWGRPH_MCP_ENDPOINT === "string" ? e.KNOWGRPH_MCP_ENDPOINT.trim() : "";
  const expiry = Number(e.AGENT_API_AUTH_EXPIRY);
  const agentModelConfig = resolveAgentModelConfig(e);
  const cacheContext = providedCacheContext || createCacheContextRegistry();
  const reasoningContinuity = providedReasoningContinuity || createReasoningContinuityRegistry();
  const programmaticToolCalling = providedProgrammaticToolCalling || createProgrammaticToolCallingRuntime();
  const toolSearch = providedToolSearch || createToolSearchRuntime();
  const modelKeyPresent = typeof e[agentModelConfig.apiKeyEnv] === "string" && Boolean(e[agentModelConfig.apiKeyEnv].trim());

  let mcpClient = null;
  if (endpoint) {
    mcpClient = createKnowgrphMcpClient({ endpoint, fetchImpl });
  }

  return {
    configured: Boolean(secret && endpoint),
    agentModelConfig,
    cacheContext,
    reasoningContinuity,
    programmaticToolCalling,
    toolSearch,
    readiness: () => {
      const programmaticStats = programmaticToolCalling.stats();
      const toolSearchStats = toolSearch.stats();
      return {
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
        cacheContext: {
          configured: true,
          stablePrefixOrder: "static-first-dynamic-last",
          invalidation: "revision-or-bounded-eviction",
          providerCacheStatus: "unverified",
          ...cacheContext.stats(),
        },
        reasoningContinuity: {
          configured: true,
          invariantPolicy: "goals-assumptions-priorities",
          stableMode: "all_turns-with-previous-response",
          driftMode: "current_turn",
          providerEffectiveContext: "unverified",
          ...reasoningContinuity.stats(),
        },
        programmaticToolCalling: {
          configured: programmaticStats.adapterConfigured && programmaticStats.toolGatewayConfigured,
          contractReady: true,
          executionOwner: "downstream-hosted-sandbox",
          programRouting: "bounded-read-only-stages",
          directRouting: "writes-approvals-semantic-judgment",
          continuationModes: ["stored", "stateless-replay"],
          callerContract: "function-call-output-preserves-caller",
          localJavaScriptExecution: "forbidden",
          providerContextIsolation: "unverified",
          ...programmaticStats,
        },
        toolSearch: {
          configured: toolSearchStats.clientSearchConfigured,
          contractReady: true,
          catalogScope: "active-session-grants",
          initialExposure: "direct-definitions-and-deferred-metadata",
          loadedDefinitionPlacement: "append-only-search-output",
          programSearchPolicy: "top-level-before-hosted-program",
          providerContextReduction: "unverified",
          ...toolSearchStats,
        },
      };
    },
    authSession: createAuthSessionHandler({
      secret,
      ...(Number.isFinite(expiry) ? { defaultExpirySeconds: expiry } : {}),
    }),
    run: createRunHandler({ secret, mcpClient }),
    invoke: createInvokeHandler({ secret, mcpClient }),
  };
}
