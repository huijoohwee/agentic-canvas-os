// Platform-neutral Agent-API app wiring for agentic-canvas-os.
//
// Builds request handlers and readiness from Cloudflare environment bindings,
// keeping every provider and control-plane credential server-side.
//
// Env (server-side only; never shipped to the client):
//   AGENT_API_JWT_SECRET   — HS256 signing secret (required to mint/verify)
//   AGENTIC_OS_MCP_ENDPOINT  — agentic-graph control-plane MCP Streamable HTTP endpoint
//   AGENTIC_OS_FUNCTION_TOOL_ALLOWLIST — explicit application function names
//   AGENTIC_OS_FUNCTION_REVIEW_REQUIRED — enabled functions that require signed human review
//   OPENAI_FUNCTION_CALLING_* — Responses adapter model, pricing, and key route
//   OPENAI_AGENT_*        — opt-in Responses agent adapter model, pricing, and bounds
//   AGENT_MODEL_*          — explicit provider, model, transport, and secret route
//   AGENT_RUNTIME_*        — explicit runtime, spend, source, and provider-call gates
//   AGENT_API_AUTH_EXPIRY  — optional session expiry seconds [300, 86400]

import { createAgentApiReadiness } from "./app-readiness.js";
import { verifyReviewerToken } from "./auth.js";
import { createAuthSessionHandler, createRunHandler, createInvokeHandler } from "./handler.js";
import { createAgentRuntimeHandler } from "./agent-runtime-handler.js";
import {
  createAutonomousAgentDefinitionRegistry,
  resolveAutonomousRuntimeEnvironment,
} from "./autonomous-runtime-config.js";
import { createAgentOrchestrationRuntime } from "./agent-orchestration.js";
import { createAgentRuntimeComposition } from "./agent-runtime-composition.js";
import { createAgentSwarmHandlers } from "./agent-swarm-handler.js";
import { createAgentSwarmRuntime } from "./agent-swarm.js";
import { createAgentToolkitHandlers } from "./agent-toolkit-handler.js";
import { createAgentToolkitRuntime } from "./agent-toolkit.js";
import { createCacheContextRegistry } from "./cache-context.js";
import {
  createFunctionCallingHandler,
  createFunctionCallingRecoveryHandler,
  createFunctionCallingResumeHandler,
} from "./function-calling-handler.js";
import { createFunctionCallingManager } from "./function-calling-manager.js";
import { createFunctionCallingRuntime } from "./function-calling.js";
import { createGuardrailsHumanReviewRuntime } from "./guardrails-human-review.js";
import {
  createAgenticGraphFunctionGateway,
  createAgenticGraphGuardrailEvaluator,
  parseAgenticGraphFunctionToolAllowlist,
} from "./agentic-graph-function-gateway.js";
import { createAdapterRegistrationInterface } from "./adapter-registration.js";
import { createDurableObjectSkillDraftStore } from "./durable-object-state-store.js";
import { resolveModelProviderEnvironment } from "./model-config.js";
import { createModelProviderRuntime } from "./model-providers.js";
import {
  createOpenAiResponsesAgentAdapter,
  resolveOpenAiResponsesAgentConfig,
} from "./openai-responses-agent-adapter.js";
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
import { createSkillProposerRuntime } from "./skill-proposer.js";
import { createSkillRegistryGate } from "./skill-registry-gate.js";
import { createConfiguredToolSearchRuntime } from "./tool-search-config.js";
import { createUpstreamDependencyAdmissionHandler } from "./upstream-dependency-admission-handler.js";
import { createAgenticGraphMcpClient } from "../../src/agentic-graph-mcp-client.js";

/**
 * Build the configured Agent-API handlers from an env bag (defaults to
 * `process.env`). The MCP client is created only when an endpoint is set;
 * otherwise the run handler fails closed (501) — never a silent direct model
 * call. Tests inject `{ env, fetchImpl }` for full offline control.
 *
 * @param {object} [opts]
 * @param {object} [opts.env] environment bag (default process.env)
 * @param {Function} [opts.fetchImpl] injectable MCP transport (tests)
 * @param {ReturnType<createAutonomousAgentDefinitionRegistry>} [opts.agentDefinitions] isolate-scoped agent definition registry
 * @param {ReturnType<createAgentOrchestrationRuntime>} [opts.agentOrchestration] multi-agent ownership controller
 * @param {ReturnType<createAgentRuntimeComposition>} [opts.agentRuntimeComposition] definition-to-execution adapter
 * @param {ReturnType<createAgentSwarmRuntime>} [opts.agentSwarm] dynamic horizontal task coordinator
 * @param {object} [opts.swarmRunStore] optional atomic Agent Swarm run ledger store
 * @param {ReturnType<createAgentToolkitRuntime>} [opts.agentToolkit] metadata-only observation and evaluation runtime
 * @param {object} [opts.agentToolkitStore] optional atomic Agent Toolkit run and cohort store
 * @param {Function} [opts.agentToolkitAuthorize] optional application revision authorizer
 * @param {Function} [opts.agentToolkitEvaluate] optional application evaluator
 * @param {Function} [opts.agentToolkitTelemetry] optional metadata-only telemetry exporter
 * @param {ReturnType<createCacheContextRegistry>} [opts.cacheContext] isolate-scoped stable-prefix registry
 * @param {ReturnType<createReasoningContinuityRegistry>} [opts.reasoningContinuity] isolate-scoped turn-continuity registry
 * @param {ReturnType<createFunctionCallingRuntime>} [opts.functionCalling] direct function-call controller
 * @param {ReturnType<createFunctionCallingManager>} [opts.functionCallingManager] durable function-call lifecycle owner
 * @param {object} [opts.functionContinuationStore] optional durable Function Calling continuation store
 * @param {object} [opts.functionExecutionReceiptStore] optional durable reviewed-tool execution receipt store
 * @param {ReturnType<createGuardrailsHumanReviewRuntime>} [opts.guardrailsHumanReview] automatic validation and review controller
 * @param {object} [opts.reviewStore] optional atomic review-state store
 * @param {object} [opts.pausedTurnStore] optional durable paused-turn store
 * @param {ReturnType<createProgrammaticToolCallingRuntime>} [opts.programmaticToolCalling] hosted-program controller
 * @param {ReturnType<createProgressiveAgentsRuntime>} [opts.progressiveAgents] progressive single-agent and specialist facade
 * @param {ReturnType<createRunningAgentRuntime>} [opts.runningAgents] application-turn lifecycle controller
 * @param {ReturnType<createSandboxAgentRuntime>} [opts.sandboxAgents] container-workspace control plane
 * @param {ReturnType<createToolSearchRuntime>} [opts.toolSearch] deferred-definition controller
 * @param {object} [opts.skillDraftStore] optional durable skill draft store
 * @param {ReturnType<createSkillProposerRuntime>} [opts.skillProposer] bounded proposed-definition draft runtime
 * @param {ReturnType<createSkillRegistryGate>} [opts.skillRegistryGate] approval-gated draft promotion runtime
 * @param {ReturnType<createAdapterRegistrationInterface>} [opts.adapterRegistration] stable adapter registration interface
 * @param {ReturnType<createModelProviderRuntime>} [opts.modelProviders] model and transport selection controller
 * @returns {{ authSession: Function, run: Function, configured: boolean }}
 */
export function createAgentApiApp({
  env,
  fetchImpl,
  agentDefinitions: providedAgentDefinitions,
  agentOrchestration: providedAgentOrchestration,
  agentRuntimeComposition: providedAgentRuntimeComposition,
  agentSwarm: providedAgentSwarm,
  swarmRunStore,
  agentToolkit: providedAgentToolkit,
  agentToolkitStore,
  agentToolkitAuthorize,
  agentToolkitEvaluate,
  agentToolkitTelemetry,
  cacheContext: providedCacheContext,
  reasoningContinuity: providedReasoningContinuity,
  functionCalling: providedFunctionCalling,
  functionCallingManager: providedFunctionCallingManager,
  functionContinuationStore,
  functionExecutionReceiptStore,
  guardrailsHumanReview: providedGuardrailsHumanReview,
  reviewStore,
  pausedTurnStore,
  programmaticToolCalling: providedProgrammaticToolCalling,
  progressiveAgents: providedProgressiveAgents,
  runningAgents: providedRunningAgents,
  sandboxAgents: providedSandboxAgents,
  toolSearch: providedToolSearch,
  skillDraftStore: providedSkillDraftStore,
  skillProposer: providedSkillProposer,
  skillRegistryGate: providedSkillRegistryGate,
  adapterRegistration: providedAdapterRegistration,
  modelProviders: providedModelProviders,
} = {}) {
  const e = env || (typeof process !== "undefined" ? process.env : {}) || {};
  const secret = typeof e.AGENT_API_JWT_SECRET === "string" ? e.AGENT_API_JWT_SECRET : "";
  const endpoint = typeof e.AGENTIC_OS_MCP_ENDPOINT === "string" ? e.AGENTIC_OS_MCP_ENDPOINT.trim() : "";
  const expiry = Number(e.AGENT_API_AUTH_EXPIRY);
  const modelProviderEnvironment = resolveModelProviderEnvironment(e);
  const openAiAgentConfig = resolveOpenAiResponsesAgentConfig(e);
  const autonomousRuntimeEnvironment = resolveAutonomousRuntimeEnvironment(e, {
    modelProviderEnvironment,
    openAiAgentConfig,
  });
  const openAiFunctionConfig = resolveOpenAiResponsesFunctionConfig(e);
  const configuredReviewSecret = typeof e.AGENT_REVIEW_JWT_SECRET === "string" ? e.AGENT_REVIEW_JWT_SECRET : "";
  const reviewSecret = configuredReviewSecret && configuredReviewSecret !== secret ? configuredReviewSecret : "";
  const agentDefinitions = providedAgentDefinitions
    || createAutonomousAgentDefinitionRegistry(autonomousRuntimeEnvironment);
  const durableStateConfigured = Boolean(
    e?.AGENT_STATE
    && typeof e.AGENT_STATE.idFromName === "function"
    && typeof e.AGENT_STATE.get === "function"
  );
  const skillDraftStore = providedSkillDraftStore
    || (durableStateConfigured ? createDurableObjectSkillDraftStore({ namespace: e.AGENT_STATE }) : undefined);
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
    evaluateGuardrail: createAgenticGraphGuardrailEvaluator(),
    authenticateReviewer,
    ...(reviewStore ? { reviewStore } : {}),
  });
  const programmaticToolCalling = providedProgrammaticToolCalling || createProgrammaticToolCallingRuntime();
  const runningAgents = providedRunningAgents || createRunningAgentRuntime({
    ...(pausedTurnStore ? { pausedTurnStore } : {}),
  });
  const sandboxAgents = providedSandboxAgents || createSandboxAgentRuntime();
  const toolSearch = providedToolSearch || createConfiguredToolSearchRuntime(e, {
    openAiFunctionConfig,
    autonomousRuntimeEnvironment,
  });
  const skillProposer = providedSkillProposer || createSkillProposerRuntime({
    ...(skillDraftStore ? { draftStore: skillDraftStore } : {}),
  });
  const skillRegistryGate = providedSkillRegistryGate || createSkillRegistryGate({
    ...(skillDraftStore ? { draftStore: skillDraftStore } : {}),
    agentDefinitionRegistry: agentDefinitions,
  });
  const adapterRegistration = providedAdapterRegistration || createAdapterRegistrationInterface({
    agentDefinitionRegistry: agentDefinitions,
  });
  const modelProviders = providedModelProviders || createModelProviderRuntime();
  if (modelProviderEnvironment.ready) {
    modelProviders.registerProvider(modelProviderEnvironment.providerDefinition);
    modelProviders.configureProcessDefault(modelProviderEnvironment.processDefault);
  }
  const openAiAgentAdapter = autonomousRuntimeEnvironment.ready
    ? createOpenAiResponsesAgentAdapter({
      ...openAiAgentConfig,
      maxTurns: autonomousRuntimeEnvironment.maxProviderCalls,
      fetchImpl,
    })
    : null;
  const agentRuntimeComposition = providedAgentRuntimeComposition || createAgentRuntimeComposition({
    agentDefinitions,
    guardrailsHumanReview,
    modelProviders,
    executeAgentStep: openAiAgentAdapter?.advanceAgent,
    ...(pausedTurnStore ? { pausedTurnStore } : {}),
  });
  const agentOrchestration = providedAgentOrchestration || createAgentOrchestrationRuntime({
    resolveAgent: agentRuntimeComposition.resolveAgent,
    runAgent: agentRuntimeComposition.runAgent,
  });
  const agentSwarm = providedAgentSwarm || createAgentSwarmRuntime({
    ...(swarmRunStore ? { stateStore: swarmRunStore } : {}),
  });
  const agentToolkit = providedAgentToolkit || createAgentToolkitRuntime({
    ...(agentToolkitStore ? { stateStore: agentToolkitStore } : {}),
    authorize: agentToolkitAuthorize
      || (async () => ({ allowed: true, authorizationId: "authenticated-session-owner" })),
    ...(agentToolkitEvaluate ? { evaluate: agentToolkitEvaluate } : {}),
    ...(agentToolkitTelemetry ? { telemetry: agentToolkitTelemetry } : {}),
  });
  const progressiveAgents = providedProgressiveAgents || createProgressiveAgentsRuntime({
    agentDefinitions,
    agentRuntimeComposition,
    agentOrchestration,
  });

  let mcpClient = null;
  if (endpoint) {
    mcpClient = createAgenticGraphMcpClient({
      endpoint,
      fetchImpl,
      authToken: typeof e.AGENTIC_OS_MCP_FUNCTION_BEARER_TOKEN === "string"
        ? e.AGENTIC_OS_MCP_FUNCTION_BEARER_TOKEN.trim()
        : "",
    });
  }
  const functionGateway = createAgenticGraphFunctionGateway({
    mcpClient,
    allowedToolNames: parseAgenticGraphFunctionToolAllowlist(e.AGENTIC_OS_FUNCTION_TOOL_ALLOWLIST),
    reviewRequiredToolNames: parseAgenticGraphFunctionToolAllowlist(e.AGENTIC_OS_FUNCTION_REVIEW_REQUIRED),
    guardrailsHumanReview,
    ...(functionExecutionReceiptStore ? { executionReceiptStore: functionExecutionReceiptStore } : {}),
  });
  const openAiFunctionAdapter = openAiFunctionConfig.ready
    ? createOpenAiResponsesFunctionAdapter({ ...openAiFunctionConfig, fetchImpl })
    : null;
  const functionCalling = providedFunctionCalling || createFunctionCallingRuntime({
    advanceModel: openAiFunctionAdapter?.advanceModel,
    callTool: functionGateway.configured ? functionGateway.callTool : undefined,
  });
  const functionCallingManager = providedFunctionCallingManager || createFunctionCallingManager({
    functionCalling,
    tools: functionGateway.tools,
    capabilities: openAiFunctionAdapter?.capabilities || OPENAI_FUNCTION_CALLING_CAPABILITIES,
    ...(functionContinuationStore ? { continuationStore: functionContinuationStore } : {}),
  });
  const agentSwarmHandlers = createAgentSwarmHandlers({ secret, agentSwarm });
  const agentToolkitHandlers = createAgentToolkitHandlers({ secret, agentToolkit });
  const agentRuntimeRun = createAgentRuntimeHandler({
    secret,
    agentRuntimeComposition,
    agentReference: autonomousRuntimeEnvironment.ready
      ? Object.freeze({
        agentId: autonomousRuntimeEnvironment.agentId,
        revision: autonomousRuntimeEnvironment.agentRevision,
      })
      : null,
  });

  return {
    configured: Boolean(secret && endpoint && modelProviderEnvironment.ready && modelProviderEnvironment.apiKeyPresent),
    modelProviderEnvironment,
    modelProviders,
    agentDefinitions,
    agentOrchestration,
    agentRuntimeComposition,
    agentRuntimeRun,
    agentSwarm,
    agentToolkit,
    cacheContext,
    reasoningContinuity,
    functionCalling,
    functionCallingManager,
    functionGateway,
    guardrailsHumanReview,
    openAiFunctionAdapter,
    openAiAgentAdapter,
    programmaticToolCalling,
    progressiveAgents,
    runningAgents,
    sandboxAgents,
    toolSearch,
    skillDraftStore,
    skillProposer,
    skillRegistryGate,
    adapterRegistration,
    upstreamDependencyAdmissionEvaluate: createUpstreamDependencyAdmissionHandler({ secret }),
    agentSwarmStart: agentSwarmHandlers.start,
    agentSwarmWork: agentSwarmHandlers.work,
    agentSwarmSettle: agentSwarmHandlers.settle,
    agentSwarmStatus: agentSwarmHandlers.status,
    agentSwarmCancel: agentSwarmHandlers.cancel,
    agentToolkitStart: agentToolkitHandlers.start,
    agentToolkitStartSpan: agentToolkitHandlers.startSpan,
    agentToolkitFinishSpan: agentToolkitHandlers.finishSpan,
    agentToolkitComplete: agentToolkitHandlers.complete,
    agentToolkitEvaluate: agentToolkitHandlers.evaluate,
    agentToolkitCompare: agentToolkitHandlers.compare,
    agentToolkitPropose: agentToolkitHandlers.propose,
    agentToolkitStatus: agentToolkitHandlers.status,
    agentToolkitProfile: agentToolkitHandlers.profile,
    agentToolkitOptimize: agentToolkitHandlers.optimize,
    readiness: createAgentApiReadiness({
      secret, endpoint, modelProviderEnvironment, modelProviders,
      agentDefinitions, agentOrchestration, agentRuntimeComposition, agentSwarm,
      agentToolkit, programmaticToolCalling, progressiveAgents, functionCalling,
      functionCallingManager, functionGateway, guardrailsHumanReview, openAiFunctionAdapter,
      runningAgents, sandboxAgents, toolSearch, skillProposer,
      skillRegistryGate, adapterRegistration, cacheContext, reasoningContinuity,
      autonomousRuntimeEnvironment, openAiAgentConfig, openAiAgentAdapter, agentToolkitAuthorize,
      openAiFunctionConfig,
    }),
    authSession: createAuthSessionHandler({
      secret,
      ...(Number.isFinite(expiry) ? { defaultExpirySeconds: expiry } : {}),
    }),
    run: createRunHandler({ secret, mcpClient }),
    invoke: createInvokeHandler({ secret, mcpClient }),
    functionCall: createFunctionCallingHandler({
      secret,
      functionCallingManager,
      tools: functionGateway.tools,
    }),
    functionCallRecover: createFunctionCallingRecoveryHandler({
      secret,
      functionCallingManager,
    }),
    functionCallResume: createFunctionCallingResumeHandler({
      secret,
      functionCallingManager,
    }),
  };
}
