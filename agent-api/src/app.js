// Platform-neutral Agent-API app wiring for agentic-canvas-os.
//
// Builds request handlers and readiness from Cloudflare environment bindings,
// keeping every provider and control-plane credential server-side.
//
// Env (server-side only; never shipped to the client):
//   AGENT_API_JWT_SECRET   — HS256 signing secret (required to mint/verify)
//   KNOWGRPH_MCP_ENDPOINT  — knowgrph control-plane MCP Streamable HTTP endpoint
//   KNOWGRPH_FUNCTION_TOOL_ALLOWLIST — explicit application function names
//   KNOWGRPH_FUNCTION_REVIEW_REQUIRED — enabled functions that require signed human review
//   OPENAI_FUNCTION_CALLING_* — Responses adapter model, pricing, and key route
//   AGENT_MODEL_*          — explicit provider, model, transport, and secret route
//   AGENT_API_AUTH_EXPIRY  — optional session expiry seconds [300, 86400]

import { verifyReviewerToken } from "./auth.js";
import { createAuthSessionHandler, createRunHandler, createInvokeHandler } from "./handler.js";
import { createAgentDefinitionRegistry } from "./agent-definitions.js";
import { createAgentOrchestrationRuntime } from "./agent-orchestration.js";
import { createAgentRuntimeComposition } from "./agent-runtime-composition.js";
import { createCacheContextRegistry } from "./cache-context.js";
import { createFunctionCallingHandler } from "./function-calling-handler.js";
import { createFunctionCallingRuntime } from "./function-calling.js";
import { createGuardrailsHumanReviewRuntime } from "./guardrails-human-review.js";
import {
  createKnowgrphFunctionGateway,
  createKnowgrphGuardrailEvaluator,
  parseKnowgrphFunctionToolAllowlist,
} from "./knowgrph-function-gateway.js";
import { resolveModelProviderEnvironment } from "./model-config.js";
import { createModelProviderRuntime } from "./model-providers.js";
import {
  createOpenAiResponsesFunctionAdapter,
  OPENAI_FUNCTION_CALLING_CAPABILITIES,
  resolveOpenAiResponsesFunctionConfig,
} from "./openai-responses-function-adapter.js";
import { createProgrammaticToolCallingRuntime } from "./programmatic-tool-calling.js";
import { createProgressiveAgentsRuntime } from "./progressive-agents.js";
import { createReasoningContinuityRegistry } from "./reasoning-continuity.js";
import { createRunningAgentRuntime } from "./running-agents.js";
import { createSandboxAgentRuntime } from "./sandbox-agents.js";
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
 * @param {ReturnType<createAgentDefinitionRegistry>} [opts.agentDefinitions] isolate-scoped agent definition registry
 * @param {ReturnType<createAgentOrchestrationRuntime>} [opts.agentOrchestration] multi-agent ownership controller
 * @param {ReturnType<createAgentRuntimeComposition>} [opts.agentRuntimeComposition] definition-to-execution adapter
 * @param {ReturnType<createCacheContextRegistry>} [opts.cacheContext] isolate-scoped stable-prefix registry
 * @param {ReturnType<createReasoningContinuityRegistry>} [opts.reasoningContinuity] isolate-scoped turn-continuity registry
 * @param {ReturnType<createFunctionCallingRuntime>} [opts.functionCalling] direct function-call controller
 * @param {ReturnType<createGuardrailsHumanReviewRuntime>} [opts.guardrailsHumanReview] automatic validation and review controller
 * @param {object} [opts.reviewStore] optional atomic review-state store
 * @param {object} [opts.pausedTurnStore] optional durable paused-turn store
 * @param {ReturnType<createProgrammaticToolCallingRuntime>} [opts.programmaticToolCalling] hosted-program controller
 * @param {ReturnType<createProgressiveAgentsRuntime>} [opts.progressiveAgents] progressive single-agent and specialist facade
 * @param {ReturnType<createRunningAgentRuntime>} [opts.runningAgents] application-turn lifecycle controller
 * @param {ReturnType<createSandboxAgentRuntime>} [opts.sandboxAgents] container-workspace control plane
 * @param {ReturnType<createToolSearchRuntime>} [opts.toolSearch] deferred-definition controller
 * @param {ReturnType<createModelProviderRuntime>} [opts.modelProviders] model and transport selection controller
 * @returns {{ authSession: Function, run: Function, configured: boolean }}
 */
export function createAgentApiApp({
  env,
  fetchImpl,
  agentDefinitions: providedAgentDefinitions,
  agentOrchestration: providedAgentOrchestration,
  agentRuntimeComposition: providedAgentRuntimeComposition,
  cacheContext: providedCacheContext,
  reasoningContinuity: providedReasoningContinuity,
  functionCalling: providedFunctionCalling,
  guardrailsHumanReview: providedGuardrailsHumanReview,
  reviewStore,
  pausedTurnStore,
  programmaticToolCalling: providedProgrammaticToolCalling,
  progressiveAgents: providedProgressiveAgents,
  runningAgents: providedRunningAgents,
  sandboxAgents: providedSandboxAgents,
  toolSearch: providedToolSearch,
  modelProviders: providedModelProviders,
} = {}) {
  const e = env || (typeof process !== "undefined" ? process.env : {}) || {};
  const secret = typeof e.AGENT_API_JWT_SECRET === "string" ? e.AGENT_API_JWT_SECRET : "";
  const endpoint = typeof e.KNOWGRPH_MCP_ENDPOINT === "string" ? e.KNOWGRPH_MCP_ENDPOINT.trim() : "";
  const expiry = Number(e.AGENT_API_AUTH_EXPIRY);
  const modelProviderEnvironment = resolveModelProviderEnvironment(e);
  const openAiFunctionConfig = resolveOpenAiResponsesFunctionConfig(e);
  const configuredReviewSecret = typeof e.AGENT_REVIEW_JWT_SECRET === "string" ? e.AGENT_REVIEW_JWT_SECRET : "";
  const reviewSecret = configuredReviewSecret && configuredReviewSecret !== secret ? configuredReviewSecret : "";
  const agentDefinitions = providedAgentDefinitions || createAgentDefinitionRegistry();
  const cacheContext = providedCacheContext || createCacheContextRegistry();
  const reasoningContinuity = providedReasoningContinuity || createReasoningContinuityRegistry();
  const authenticateReviewer = reviewSecret
    ? async ({ state, evidence }) => {
      const token = evidence && typeof evidence === "object" && !Array.isArray(evidence)
        && Object.keys(evidence).length === 1 && typeof evidence.token === "string"
        ? evidence.token
        : "";
      const verdict = verifyReviewerToken(token, reviewSecret, state);
      if (!verdict.valid) return { authenticated: false };
      return {
        authenticated: true,
        subjectId: verdict.claims.sub,
        evidenceId: verdict.claims.jti,
        assurance: "signed-review-token",
      };
    }
    : undefined;
  const guardrailsHumanReview = providedGuardrailsHumanReview || createGuardrailsHumanReviewRuntime({
    evaluateGuardrail: createKnowgrphGuardrailEvaluator(),
    authenticateReviewer,
    ...(reviewStore ? { reviewStore } : {}),
  });
  const programmaticToolCalling = providedProgrammaticToolCalling || createProgrammaticToolCallingRuntime();
  const runningAgents = providedRunningAgents || createRunningAgentRuntime({
    ...(pausedTurnStore ? { pausedTurnStore } : {}),
  });
  const sandboxAgents = providedSandboxAgents || createSandboxAgentRuntime();
  const toolSearch = providedToolSearch || createToolSearchRuntime();
  const modelProviders = providedModelProviders || createModelProviderRuntime();
  if (modelProviderEnvironment.ready) {
    modelProviders.registerProvider(modelProviderEnvironment.providerDefinition);
    modelProviders.configureProcessDefault(modelProviderEnvironment.processDefault);
  }
  const agentRuntimeComposition = providedAgentRuntimeComposition || createAgentRuntimeComposition({
    agentDefinitions,
    guardrailsHumanReview,
    modelProviders,
  });
  const agentOrchestration = providedAgentOrchestration || createAgentOrchestrationRuntime({
    resolveAgent: agentRuntimeComposition.resolveAgent,
    runAgent: agentRuntimeComposition.runAgent,
  });
  const progressiveAgents = providedProgressiveAgents || createProgressiveAgentsRuntime({
    agentDefinitions,
    agentRuntimeComposition,
    agentOrchestration,
  });

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
    reviewRequiredToolNames: parseKnowgrphFunctionToolAllowlist(e.KNOWGRPH_FUNCTION_REVIEW_REQUIRED),
    guardrailsHumanReview,
  });
  const openAiFunctionAdapter = openAiFunctionConfig.ready
    ? createOpenAiResponsesFunctionAdapter({ ...openAiFunctionConfig, fetchImpl })
    : null;
  const functionCalling = providedFunctionCalling || createFunctionCallingRuntime({
    advanceModel: openAiFunctionAdapter?.advanceModel,
    callTool: functionGateway.configured ? functionGateway.callTool : undefined,
  });

  return {
    configured: Boolean(secret && endpoint && modelProviderEnvironment.ready && modelProviderEnvironment.apiKeyPresent),
    modelProviderEnvironment,
    modelProviders,
    agentDefinitions,
    agentOrchestration,
    agentRuntimeComposition,
    cacheContext,
    reasoningContinuity,
    functionCalling,
    functionGateway,
    guardrailsHumanReview,
    openAiFunctionAdapter,
    programmaticToolCalling,
    progressiveAgents,
    runningAgents,
    sandboxAgents,
    toolSearch,
    readiness: () => {
      const agentDefinitionStats = agentDefinitions.stats();
      const agentOrchestrationStats = agentOrchestration.stats();
      const agentRuntimeCompositionStats = agentRuntimeComposition.stats();
      const programmaticStats = programmaticToolCalling.stats();
      const progressiveAgentStats = progressiveAgents.stats();
      const functionCallingStats = functionCalling.stats();
      const functionGatewayStats = functionGateway.stats();
      const guardrailsHumanReviewStats = guardrailsHumanReview.stats();
      const openAiFunctionStats = openAiFunctionAdapter?.stats();
      const runningAgentStats = runningAgents.stats();
      const sandboxAgentStats = sandboxAgents.stats();
      const toolSearchStats = toolSearch.stats();
      const modelProviderStats = modelProviders.stats();
      return {
        configured: Boolean(
          secret
          && endpoint
          && modelProviderEnvironment.ready
          && modelProviderEnvironment.apiKeyPresent
          && modelProviderStats.providers > 0
          && modelProviderStats.processDefaultConfigured
        ),
        auth: { configured: Boolean(secret) },
        controlPlane: { configured: Boolean(endpoint), endpoint },
        modelProviders: {
          configured: modelProviderEnvironment.ready
            && modelProviderEnvironment.apiKeyPresent
            && modelProviderStats.providers > 0
            && modelProviderStats.processDefaultConfigured,
          contractReady: true,
          selectionPrecedence: ["agent", "run-default", "process-default", "provider-default"],
          providerPolicy: "application-registered-revision-bound",
          transportPolicy: "feature-delivery-connection-matched",
          executionOwner: "running-agents-adapter",
          providerExecutionStatus: "unverified",
          environment: {
            configured: modelProviderEnvironment.ready,
            providerId: modelProviderEnvironment.providerId,
            providerRevision: modelProviderEnvironment.providerRevision,
            adapterId: modelProviderEnvironment.adapterId,
            endpoint: modelProviderEnvironment.endpoint,
            modelId: modelProviderEnvironment.modelId,
            apiKeyEnv: modelProviderEnvironment.apiKeyEnv,
            apiKeyPresent: modelProviderEnvironment.apiKeyPresent,
            transportId: modelProviderEnvironment.transportId,
            delivery: modelProviderEnvironment.delivery,
            connection: modelProviderEnvironment.connection,
            features: modelProviderEnvironment.features,
            issues: modelProviderEnvironment.issues,
          },
          ...modelProviderStats,
        },
        agentDefinitions: {
          configured: agentDefinitionStats.agents > 0,
          contractReady: true,
          definitionOwner: "application-agent-registry",
          requiredCore: ["source", "model", "instructions"],
          sourcePolicy: "application-verified-uri-and-sha256",
          optionalBehavior: ["tools", "guardrails", "mcp-servers", "handoffs", "structured-output"],
          capabilityPolicy: "reference-only-with-application-authorization",
          executionOwner: "running-agents-adapter",
          providerExecutionStatus: "unverified",
          ...agentDefinitionStats,
        },
        guardrailsHumanReview: {
          configured: guardrailsHumanReviewStats.guardrailEvaluatorConfigured
            && guardrailsHumanReviewStats.reviewerAuthenticatorConfigured,
          contractReady: true,
          automaticValidationOwner: "application-guardrail-evaluator",
          toolBoundaryOwner: "function-tool-gateway",
          humanReviewOwner: "application-review-gate",
          interruptionOwner: "running-agents-same-turn-state",
          reviewStatePolicy: "atomic-single-consume-bounded-expiry",
          reviewerEvidencePolicy: "purpose-scoped-signed-token",
          providerExecutionStatus: "unverified",
          ...guardrailsHumanReviewStats,
        },
        agentOrchestration: {
          configured: agentOrchestrationStats.configured,
          contractReady: true,
          topologyOwner: "application-orchestration-registry",
          definitionOwner: "agent-definitions",
          executionOwner: "running-agents-adapter",
          conversationOwnership: "branch-explicit",
          finalAnswerOwnership: "branch-explicit",
          providerExecutionStatus: "unverified",
          ...agentOrchestrationStats,
        },
        agentRuntimeComposition: {
          configured: agentRuntimeCompositionStats.configured,
          contractReady: true,
          sourceOwner: "agent-definitions",
          selectionOwner: "models-and-providers",
          lifecycleOwner: "running-agents",
          orchestrationInterfaces: ["resolve-agent", "run-agent"],
          outputValidationOwner: "agent-definitions",
          providerExecutionStatus: "unverified",
          ...agentRuntimeCompositionStats,
        },
        progressiveAgents: {
          configured: progressiveAgentStats.configured,
          contractReady: true,
          progressionPolicy: "single-agent-then-tools-then-specialists",
          definitionOwner: "agent-definitions",
          toolExecutionOwner: "function-calling-through-application-adapter",
          specialistOwner: "agent-orchestration",
          lifecycleOwner: "agent-runtime-composition",
          externalSdkDependency: false,
          providerExecutionStatus: "unverified",
          ...progressiveAgentStats,
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
        runningAgents: {
          configured: runningAgentStats.adapterConfigured,
          contractReady: true,
          loopOwner: "application-turn-controller",
          streamingOwner: "same-loop-event-channel",
          pauseSemantics: "resume-same-turn",
          recoveryPolicy: "atomic-claim-resume-commit",
          continuationPolicy: "one-strategy-per-conversation",
          providerExecutionStatus: "unverified",
          ...runningAgentStats,
        },
        sandboxAgents: {
          configured: sandboxAgentStats.configured,
          contractReady: true,
          controlPlaneOwner: "agentic-canvas-os",
          executionOwner: "injected-container-provider",
          operationPolicy: "application-authorized-and-capability-bounded",
          stateSurfaces: ["active-session", "resume-checkpoint", "workspace-snapshot"],
          secretPolicy: "host-bindings-only",
          containerExecutionStatus: sandboxAgentStats.containerExecutionStatus,
          independentContainmentProof: sandboxAgentStats.independentContainmentProof,
          ...sandboxAgentStats,
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
