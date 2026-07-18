// Platform-neutral Agent-API app wiring for agentic-canvas-os.
//
// Builds request handlers and readiness from Cloudflare environment bindings,
// keeping every provider and control-plane credential server-side.
//
// Env (server-side only; never shipped to the client):
//   AGENT_API_JWT_SECRET   — HS256 signing secret (required to mint/verify)
//   KNOWGRPH_MCP_ENDPOINT  — knowgrph control-plane MCP Streamable HTTP endpoint
//   KNOWGRPH_FUNCTION_TOOL_ALLOWLIST — explicit application function names
//   OPENAI_FUNCTION_CALLING_* — Responses adapter model, pricing, and key route
//   AGENT_MODEL_*          — optional Hermes-like model route overrides
//   AGENT_API_AUTH_EXPIRY  — optional session expiry seconds [300, 86400]

import { createAuthSessionHandler, createRunHandler, createInvokeHandler } from "./handler.js";
import { createCacheContextRegistry } from "./cache-context.js";
import { createFunctionCallingHandler } from "./function-calling-handler.js";
import { createFunctionCallingRuntime } from "./function-calling.js";
import {
  createKnowgrphFunctionGateway,
  parseKnowgrphFunctionToolAllowlist,
} from "./knowgrph-function-gateway.js";
import { agentModelConfigReady, resolveAgentModelConfig } from "./model-config.js";
import {
  createOpenAiResponsesFunctionAdapter,
  OPENAI_FUNCTION_CALLING_CAPABILITIES,
  resolveOpenAiResponsesFunctionConfig,
} from "./openai-responses-function-adapter.js";
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
 * @param {ReturnType<createFunctionCallingRuntime>} [opts.functionCalling] direct function-call controller
 * @param {ReturnType<createProgrammaticToolCallingRuntime>} [opts.programmaticToolCalling] hosted-program controller
 * @param {ReturnType<createToolSearchRuntime>} [opts.toolSearch] deferred-definition controller
 * @returns {{ authSession: Function, run: Function, configured: boolean }}
 */
export function createAgentApiApp({
  env,
  fetchImpl,
  cacheContext: providedCacheContext,
  reasoningContinuity: providedReasoningContinuity,
  functionCalling: providedFunctionCalling,
  programmaticToolCalling: providedProgrammaticToolCalling,
  toolSearch: providedToolSearch,
} = {}) {
  const e = env || (typeof process !== "undefined" ? process.env : {}) || {};
  const secret = typeof e.AGENT_API_JWT_SECRET === "string" ? e.AGENT_API_JWT_SECRET : "";
  const endpoint = typeof e.KNOWGRPH_MCP_ENDPOINT === "string" ? e.KNOWGRPH_MCP_ENDPOINT.trim() : "";
  const expiry = Number(e.AGENT_API_AUTH_EXPIRY);
  const agentModelConfig = resolveAgentModelConfig(e);
  const openAiFunctionConfig = resolveOpenAiResponsesFunctionConfig(e);
  const cacheContext = providedCacheContext || createCacheContextRegistry();
  const reasoningContinuity = providedReasoningContinuity || createReasoningContinuityRegistry();
  const programmaticToolCalling = providedProgrammaticToolCalling || createProgrammaticToolCallingRuntime();
  const toolSearch = providedToolSearch || createToolSearchRuntime();
  const modelKeyPresent = typeof e[agentModelConfig.apiKeyEnv] === "string" && Boolean(e[agentModelConfig.apiKeyEnv].trim());

  let mcpClient = null;
  if (endpoint) {
    mcpClient = createKnowgrphMcpClient({
      endpoint,
      fetchImpl,
      authToken: typeof e.KNOWGRPH_MCP_FUNCTION_BEARER_TOKEN === "string"
        ? e.KNOWGRPH_MCP_FUNCTION_BEARER_TOKEN.trim()
        : "",
    });
  }
  const functionGateway = createKnowgrphFunctionGateway({
    mcpClient,
    allowedToolNames: parseKnowgrphFunctionToolAllowlist(e.KNOWGRPH_FUNCTION_TOOL_ALLOWLIST),
  });
  const openAiFunctionAdapter = openAiFunctionConfig.ready
    ? createOpenAiResponsesFunctionAdapter({ ...openAiFunctionConfig, fetchImpl })
    : null;
  const functionCalling = providedFunctionCalling || createFunctionCallingRuntime({
    advanceModel: openAiFunctionAdapter?.advanceModel,
    callTool: functionGateway.configured ? functionGateway.callTool : undefined,
  });

  return {
    configured: Boolean(secret && endpoint),
    agentModelConfig,
    cacheContext,
    reasoningContinuity,
    functionCalling,
    functionGateway,
    openAiFunctionAdapter,
    programmaticToolCalling,
    toolSearch,
    readiness: () => {
      const programmaticStats = programmaticToolCalling.stats();
      const functionCallingStats = functionCalling.stats();
      const functionGatewayStats = functionGateway.stats();
      const openAiFunctionStats = openAiFunctionAdapter?.stats();
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
        functionCalling: {
          configured: functionCallingStats.adapterConfigured && functionCallingStats.toolGatewayConfigured
            && functionGatewayStats.configured,
          contractReady: true,
          executionOwner: "application-tool-gateway",
          schemaMode: "explicit-strict",
          selectionModes: ["auto", "required", "none", "forced", "allowed"],
          parallelPolicy: "capability-and-request-bounded",
          continuation: "previous-response-with-reasoning-items",
          callIdentity: "function-call-output-preserves-call-id",
          providerExecutionStatus: "unverified",
          adapter: {
            configured: openAiFunctionConfig.ready,
            provider: openAiFunctionConfig.provider,
            protocol: openAiFunctionConfig.protocol,
            endpoint: openAiFunctionConfig.endpoint,
            model: openAiFunctionConfig.model,
            apiKeyEnv: openAiFunctionConfig.apiKeyEnv,
            apiKeyPresent: openAiFunctionConfig.apiKeyPresent,
            pricingReady: openAiFunctionConfig.pricingReady,
            reasoningEffort: openAiFunctionConfig.reasoningEffort,
            maxOutputTokens: openAiFunctionConfig.maxOutputTokens,
            ...(openAiFunctionStats || {}),
          },
          gateway: functionGatewayStats,
          ...functionCallingStats,
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
    functionCall: createFunctionCallingHandler({
      secret,
      functionCalling,
      tools: functionGateway.tools,
      capabilities: openAiFunctionAdapter?.capabilities || OPENAI_FUNCTION_CALLING_CAPABILITIES,
    }),
  };
}
