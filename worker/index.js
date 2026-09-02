// Cloudflare Worker entrypoint for agentic-canvas-os.
//
// One Worker owns the product tier: static assets, auth/session, run forwarding,
// and model-provider readiness. It delegates static files to Workers Static Assets and
// keeps all secrets in Cloudflare env bindings.

import { createAgentApiApp } from "../agent-api/src/app.js";
import {
  createAutonomousAgentDefinitionRegistry,
  resolveAutonomousRuntimeEnvironment,
} from "../agent-api/src/autonomous-runtime-config.js";
import { isSecureRoomCapability, sessionCanJoinRoom, verifySessionToken } from "../agent-api/src/auth.js";
import { createCacheContextRegistry } from "../agent-api/src/cache-context.js";
import { COMMERCE_ADMISSION_PATH } from "../agent-api/src/commerce-admission-contract.js";
import { resolveCommerceDeploymentIdentity } from "../agent-api/src/commerce-deployment-identity.js";
import {
  COMMERCE_RELEASE_PROOF_PATH,
  createCommerceReleaseProofHandler,
} from "../agent-api/src/commerce-release-proof.js";
import {
  createDurableObjectAgentToolkitStore,
  createDurableObjectCommerceAdmissionStore,
  createDurableObjectFunctionExecutionReceiptStore,
  createDurableObjectFunctionContinuationStore,
  createDurableObjectHumanReviewStore,
  createDurableObjectPausedTurnStore,
  createDurableObjectSkillDraftStore,
  createDurableObjectSwarmRunStore,
} from "../agent-api/src/durable-object-state-store.js";
import {
  createCommerceAdmissionProvider,
  createCommerceInvocationRegister,
  createCommerceOperatorInstructionResolver,
  createCommerceToolAllowlistProjection,
} from "../agent-api/src/commerce-admission-provider.js";
import { resolveModelProviderEnvironment } from "../agent-api/src/model-config.js";
import { createModelProviderRuntime } from "../agent-api/src/model-providers.js";
import { resolveOpenAiResponsesAgentConfig } from "../agent-api/src/openai-responses-agent-adapter.js";
import { resolveOpenAiResponsesFunctionConfig } from "../agent-api/src/openai-responses-function-adapter.js";
import { createProgrammaticToolCallingRuntime } from "../agent-api/src/programmatic-tool-calling.js";
import { createReasoningContinuityRegistry } from "../agent-api/src/reasoning-continuity.js";
import { createRunningAgentRuntime } from "../agent-api/src/running-agents.js";
import { createSandboxAgentRuntime } from "../agent-api/src/sandbox-agents.js";
import { createSkillProposerRuntime } from "../agent-api/src/skill-proposer.js";
import { createSkillRegistryGate } from "../agent-api/src/skill-registry-gate.js";
import { createConfiguredToolSearchRuntime } from "../agent-api/src/tool-search-config.js";
import { createAdapterRegistrationInterface } from "../agent-api/src/adapter-registration.js";
import { isValidRoomId } from "../src/collab-room.js";
import { CanvasRoom } from "./canvas-room.js";
import { AgentState } from "./agent-state.js";

export { AgentState, CanvasRoom };

export function createWorkerFetch(env = {}, publicFetch) {
  const mcpEndpoint = typeof env.KNOWGRPH_MCP_ENDPOINT === "string" ? env.KNOWGRPH_MCP_ENDPOINT : "";
  const mcpOrigin = mcpEndpoint ? new URL(mcpEndpoint).origin : "";
  const mcpService = env.KNOWGRPH_MCP_SERVICE;
  return (req) => {
    const init = {
      method: req.method,
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: req.signal,
    };
    if (mcpOrigin && new URL(req.url).origin === mcpOrigin && typeof mcpService?.fetch === "function") {
      return mcpService.fetch(new Request(req.url, init));
    }
    return (publicFetch || fetch)(req.url, init);
  };
}

const JSON_HEADERS = Object.freeze({ "content-type": "application/json" });
const MAX_JSON_BODY_BYTES = 512 * 1024;
const APP_BY_ENV = new WeakMap();
const AGENT_DEFINITIONS_BY_ENV = new WeakMap();
const CACHE_CONTEXT_BY_ENV = new WeakMap();
const MODEL_PROVIDERS_BY_ENV = new WeakMap();
const REASONING_CONTINUITY_BY_ENV = new WeakMap();
const PROGRAMMATIC_TOOL_CALLING_BY_ENV = new WeakMap();
const RUNNING_AGENTS_BY_ENV = new WeakMap();
const SANDBOX_AGENTS_BY_ENV = new WeakMap();
const TOOL_SEARCH_BY_ENV = new WeakMap();
const SKILL_PROPOSER_BY_ENV = new WeakMap();
const SKILL_REGISTRY_GATE_BY_ENV = new WeakMap();
const ADAPTER_REGISTRATION_BY_ENV = new WeakMap();
const COMMERCE_ADMISSION_BY_ENV = new WeakMap();

function json(statusCode, body) {
  return new Response(JSON.stringify(body ?? {}), {
    status: statusCode,
    headers: JSON_HEADERS,
  });
}

function headerBag(request) {
  const out = {};
  for (const [key, value] of request.headers.entries()) out[key.toLowerCase()] = value;
  return out;
}

function rateLimitKey(request, scope) {
  const actor = request.headers.get("cf-connecting-ip")?.trim() || "unknown";
  return `${scope}:${actor.slice(0, 128)}`;
}

async function rateLimitAllows(binding, request, scope) {
  if (!binding || typeof binding.limit !== "function") return true;
  try {
    const verdict = await binding.limit({ key: rateLimitKey(request, scope) });
    return verdict?.success === true;
  } catch {
    // A configured but unhealthy admission owner fails closed so it cannot
    // become a denial-of-wallet path into Durable Objects or token issuance.
    return false;
  }
}

function rateLimited() {
  return new Response(JSON.stringify({ error: "rate limit exceeded" }), {
    status: 429,
    headers: { ...JSON_HEADERS, "retry-after": "60" },
  });
}

class JsonBodyError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = "JsonBodyError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

async function readJsonBody(request) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    throw new JsonBodyError(413, "request_body_too_large", "JSON request body exceeds the 512 KiB limit.");
  }
  if (!request.body) return {};
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_JSON_BODY_BYTES) {
      await reader.cancel();
      throw new JsonBodyError(413, "request_body_too_large", "JSON request body exceeds the 512 KiB limit.");
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new JsonBodyError(400, "invalid_json", "Request body must be valid JSON.");
  }
}

function toResponse(result) {
  return json(result.statusCode || 200, result.body);
}

function createWorkerApp(env) {
  if (env && typeof env === "object" && APP_BY_ENV.has(env)) return APP_BY_ENV.get(env);
  let cacheContext;
  let agentDefinitions;
  let modelProviders;
  let reasoningContinuity;
  let programmaticToolCalling;
  let runningAgents;
  let sandboxAgents;
  let toolSearch;
  let skillProposer;
  let skillRegistryGate;
  let adapterRegistration;
  const durableStateConfigured = Boolean(
    env?.AGENT_STATE
    && typeof env.AGENT_STATE.idFromName === "function"
    && typeof env.AGENT_STATE.get === "function",
  );
  const reviewStore = durableStateConfigured
    ? createDurableObjectHumanReviewStore({ namespace: env.AGENT_STATE })
    : undefined;
  const pausedTurnStore = durableStateConfigured
    ? createDurableObjectPausedTurnStore({ namespace: env.AGENT_STATE })
    : undefined;
  const functionContinuationStore = durableStateConfigured
    ? createDurableObjectFunctionContinuationStore({ namespace: env.AGENT_STATE })
    : undefined;
  const functionExecutionReceiptStore = durableStateConfigured
    ? createDurableObjectFunctionExecutionReceiptStore({ namespace: env.AGENT_STATE })
    : undefined;
  const swarmRunStore = durableStateConfigured
    ? createDurableObjectSwarmRunStore({ namespace: env.AGENT_STATE })
    : undefined;
  const agentToolkitStore = durableStateConfigured
    ? createDurableObjectAgentToolkitStore({ namespace: env.AGENT_STATE })
    : undefined;
  const skillDraftStore = durableStateConfigured
    ? createDurableObjectSkillDraftStore({ namespace: env.AGENT_STATE })
    : undefined;
  const commerceAdmissionStore = durableStateConfigured
    ? createDurableObjectCommerceAdmissionStore({ namespace: env.AGENT_STATE })
    : undefined;
  const agentToolkitTelemetry = env?.AGENT_TOOLKIT_TELEMETRY_ENABLED === "true"
    ? async (event) => {
      console.log(JSON.stringify(event));
    }
    : undefined;
  if (env && typeof env === "object") {
    const modelProviderEnvironment = resolveModelProviderEnvironment(env);
    const openAiAgentConfig = resolveOpenAiResponsesAgentConfig(env);
    const autonomousRuntimeEnvironment = resolveAutonomousRuntimeEnvironment(env, {
      modelProviderEnvironment,
      openAiAgentConfig,
    });
    agentDefinitions = AGENT_DEFINITIONS_BY_ENV.get(env);
    if (!agentDefinitions) {
      agentDefinitions = createAutonomousAgentDefinitionRegistry(autonomousRuntimeEnvironment);
      AGENT_DEFINITIONS_BY_ENV.set(env, agentDefinitions);
    }
    cacheContext = CACHE_CONTEXT_BY_ENV.get(env);
    if (!cacheContext) {
      cacheContext = createCacheContextRegistry();
      CACHE_CONTEXT_BY_ENV.set(env, cacheContext);
    }
    modelProviders = MODEL_PROVIDERS_BY_ENV.get(env);
    if (!modelProviders) {
      modelProviders = createModelProviderRuntime();
      MODEL_PROVIDERS_BY_ENV.set(env, modelProviders);
    }
    reasoningContinuity = REASONING_CONTINUITY_BY_ENV.get(env);
    if (!reasoningContinuity) {
      reasoningContinuity = createReasoningContinuityRegistry();
      REASONING_CONTINUITY_BY_ENV.set(env, reasoningContinuity);
    }
    programmaticToolCalling = PROGRAMMATIC_TOOL_CALLING_BY_ENV.get(env);
    if (!programmaticToolCalling) {
      programmaticToolCalling = createProgrammaticToolCallingRuntime();
      PROGRAMMATIC_TOOL_CALLING_BY_ENV.set(env, programmaticToolCalling);
    }
    runningAgents = RUNNING_AGENTS_BY_ENV.get(env);
    if (!runningAgents) {
      runningAgents = createRunningAgentRuntime({
        ...(pausedTurnStore ? { pausedTurnStore } : {}),
      });
      RUNNING_AGENTS_BY_ENV.set(env, runningAgents);
    }
    sandboxAgents = SANDBOX_AGENTS_BY_ENV.get(env);
    if (!sandboxAgents) {
      sandboxAgents = createSandboxAgentRuntime();
      SANDBOX_AGENTS_BY_ENV.set(env, sandboxAgents);
    }
    toolSearch = TOOL_SEARCH_BY_ENV.get(env);
    if (!toolSearch) {
      toolSearch = createConfiguredToolSearchRuntime(env, {
        openAiFunctionConfig: resolveOpenAiResponsesFunctionConfig(env),
        autonomousRuntimeEnvironment,
      });
      TOOL_SEARCH_BY_ENV.set(env, toolSearch);
    }
    skillProposer = SKILL_PROPOSER_BY_ENV.get(env);
    if (!skillProposer) {
      skillProposer = createSkillProposerRuntime({
        ...(skillDraftStore ? { draftStore: skillDraftStore } : {}),
      });
      SKILL_PROPOSER_BY_ENV.set(env, skillProposer);
    }
    skillRegistryGate = SKILL_REGISTRY_GATE_BY_ENV.get(env);
    if (!skillRegistryGate) {
      skillRegistryGate = createSkillRegistryGate({
        ...(skillDraftStore ? { draftStore: skillDraftStore } : {}),
        ...(agentDefinitions ? { agentDefinitionRegistry: agentDefinitions } : {}),
      });
      SKILL_REGISTRY_GATE_BY_ENV.set(env, skillRegistryGate);
    }
    adapterRegistration = ADAPTER_REGISTRATION_BY_ENV.get(env);
    if (!adapterRegistration) {
      const operatorResolver = createCommerceOperatorInstructionResolver(
        env.ACOS_ADMISSION_OPERATOR_INSTRUCTION_REF,
      );
      adapterRegistration = createAdapterRegistrationInterface({
        ...(agentDefinitions ? { agentDefinitionRegistry: agentDefinitions } : {}),
        toolAllowlist: createCommerceToolAllowlistProjection(),
        invocationRegister: createCommerceInvocationRegister(),
        ...(operatorResolver.configured
          ? { resolveOperatorInstruction: operatorResolver.resolveOperatorInstruction }
          : {}),
      });
      ADAPTER_REGISTRATION_BY_ENV.set(env, adapterRegistration);
    }
    if (!COMMERCE_ADMISSION_BY_ENV.has(env)) {
      COMMERCE_ADMISSION_BY_ENV.set(env, createCommerceAdmissionProvider({
        store: commerceAdmissionStore,
        registrationInterface: adapterRegistration,
        deploymentIdentity: resolveCommerceDeploymentIdentity(env),
        authSecret: env.ACOS_ADMISSION_AUTH_SECRET,
      }));
    }
  }
  const app = createAgentApiApp({
    env,
    agentDefinitions,
    cacheContext,
    modelProviders,
    reasoningContinuity,
    programmaticToolCalling,
    runningAgents,
    reviewStore,
    pausedTurnStore,
    functionContinuationStore,
    functionExecutionReceiptStore,
    swarmRunStore,
    agentToolkitStore,
    agentToolkitTelemetry,
    sandboxAgents,
    toolSearch,
    skillDraftStore,
    skillProposer,
    skillRegistryGate,
    adapterRegistration,
    fetchImpl: createWorkerFetch(env),
  });
  if (env && typeof env === "object") APP_BY_ENV.set(env, app);
  return app;
}

async function dispatchCloudflareRequest(request, env = {}, ctx = {}) {
  const url = new URL(request.url);

  if (url.hostname === "acos-admission.internal") {
    createWorkerApp(env);
    const provider = COMMERCE_ADMISSION_BY_ENV.get(env);
    return provider ? provider.handle(request) : json(503, { ok: false, code: "runtime_unconfigured" });
  }
  if (url.pathname === COMMERCE_ADMISSION_PATH
    || url.pathname === `${COMMERCE_ADMISSION_PATH}/readyz`) {
    return json(404, { error: "not found" });
  }
  if (url.pathname === COMMERCE_RELEASE_PROOF_PATH) {
    const service = ctx?.exports?.CommerceAdmissionProbe;
    return createCommerceReleaseProofHandler({
      token: env.ACOS_RELEASE_PROBE_TOKEN,
      admissionAuthSecret: env.ACOS_ADMISSION_AUTH_SECRET,
      serviceFetch: typeof service?.fetch === "function"
        ? (input) => service.fetch(input)
        : undefined,
    }).handle(request);
  }

  if (url.pathname === "/api/canvas/room" || url.pathname === "/canvas/room") {
    if (request.method !== "GET") return json(405, { error: "method not allowed" });
    const roomId = url.searchParams.get("room") || "";
    if (!isValidRoomId(roomId) || !isSecureRoomCapability(roomId)) {
      return json(400, { error: "invalid room" });
    }
    if (
      !env?.CANVAS_ROOM
      || typeof env.CANVAS_ROOM.idFromName !== "function"
      || typeof env.CANVAS_ROOM.get !== "function"
    ) {
      return json(501, { error: "canvas collaboration not configured" });
    }
    const secret = typeof env.AGENT_API_JWT_SECRET === "string" ? env.AGENT_API_JWT_SECRET : "";
    if (!secret) return json(501, { error: "canvas authentication not configured" });
    const verdict = verifySessionToken(url.searchParams.get("token") || "", secret);
    if (!verdict.valid || !sessionCanJoinRoom(verdict.claims, roomId)) {
      return json(401, { error: "unauthorized" });
    }
    if (request.headers.get("Upgrade") !== "websocket") {
      return json(426, { error: "expected websocket upgrade" });
    }
    if (!await rateLimitAllows(env.CANVAS_ROOM_RATE_LIMITER, request, "canvas-room")) {
      return rateLimited();
    }
    const id = env.CANVAS_ROOM.idFromName(roomId);
    const stub = env.CANVAS_ROOM.get(id);
    return stub.fetch(request);
  }

  const app = createWorkerApp(env);
  const commerceAdmission = env && typeof env === "object" ? COMMERCE_ADMISSION_BY_ENV.get(env) : null;
  if (commerceAdmission?.stats().configured) {
    try {
      await commerceAdmission.rehydrate();
    } catch {
      return json(503, { error: "commerce admission projection unavailable" });
    }
  }

  if (url.pathname === "/api/ready" || url.pathname === "/ready") {
    if (request.method !== "GET") return json(405, { error: "method not allowed" });
    const deploymentIdentity = resolveCommerceDeploymentIdentity(env);
    return json(200, {
      ...app.readiness(),
      productionReady: deploymentIdentity !== null,
      deploymentIdentity,
    });
  }

  if (url.pathname === "/api/auth/session" || url.pathname === "/auth/session") {
    if (request.method !== "POST") return json(405, { error: "method not allowed" });
    if (!await rateLimitAllows(env.AUTH_SESSION_RATE_LIMITER, request, "auth-session")) {
      return rateLimited();
    }
    const body = await readJsonBody(request);
    return toResponse(await app.authSession({ headers: headerBag(request), body }));
  }

  if (url.pathname === "/api/run" || url.pathname === "/run") {
    if (request.method !== "POST") return json(405, { error: "method not allowed" });
    const body = await readJsonBody(request);
    return toResponse(await app.run({ headers: headerBag(request), body }));
  }

  if (url.pathname === "/api/invoke" || url.pathname === "/invoke") {
    if (request.method !== "POST") return json(405, { error: "method not allowed" });
    const body = await readJsonBody(request);
    return toResponse(await app.invoke({ headers: headerBag(request), body }));
  }

  if (url.pathname === "/api/agent/run" || url.pathname === "/agent/run") {
    if (request.method !== "POST") return json(405, { error: "method not allowed" });
    const body = await readJsonBody(request);
    return toResponse(await app.agentRuntimeRun({ headers: headerBag(request), body, signal: request.signal }));
  }

  if (url.pathname === "/api/function-call" || url.pathname === "/function-call") {
    if (request.method !== "POST") return json(405, { error: "method not allowed" });
    const body = await readJsonBody(request);
    return toResponse(await app.functionCall({ headers: headerBag(request), body }));
  }

  if (url.pathname === "/api/function-call/recover" || url.pathname === "/function-call/recover") {
    if (request.method !== "POST") return json(405, { error: "method not allowed" });
    const body = await readJsonBody(request);
    return toResponse(await app.functionCallRecover({ headers: headerBag(request), body }));
  }

  if (url.pathname === "/api/function-call/resume" || url.pathname === "/function-call/resume") {
    if (request.method !== "POST") return json(405, { error: "method not allowed" });
    const body = await readJsonBody(request);
    return toResponse(await app.functionCallResume({ headers: headerBag(request), body }));
  }

  if (
    url.pathname === "/api/upstream-dependency-admission/evaluate"
    || url.pathname === "/upstream-dependency-admission/evaluate"
  ) {
    if (request.method !== "POST") return json(405, { error: "method not allowed" });
    const body = await readJsonBody(request);
    return toResponse(await app.upstreamDependencyAdmissionEvaluate({
      headers: headerBag(request),
      body,
    }));
  }

  const swarmAction = url.pathname.startsWith("/api/agent-swarm/")
    ? url.pathname.slice("/api/agent-swarm/".length)
    : "";
  if (["start", "work", "settle", "status", "cancel"].includes(swarmAction)) {
    if (request.method !== "POST") return json(405, { error: "method not allowed" });
    const body = await readJsonBody(request);
    const handler = {
      start: app.agentSwarmStart,
      work: app.agentSwarmWork,
      settle: app.agentSwarmSettle,
      status: app.agentSwarmStatus,
      cancel: app.agentSwarmCancel,
    }[swarmAction];
    return toResponse(await handler({ headers: headerBag(request), body, signal: request.signal }));
  }

  const toolkitAction = url.pathname.startsWith("/api/agent-toolkit/")
    ? url.pathname.slice("/api/agent-toolkit/".length)
    : "";
  if ([
    "start", "start-span", "finish-span", "complete", "evaluate", "compare",
    "propose", "status", "profile", "optimize",
  ].includes(toolkitAction)) {
    if (request.method !== "POST") return json(405, { error: "method not allowed" });
    const body = await readJsonBody(request);
    const handler = {
      start: app.agentToolkitStart,
      "start-span": app.agentToolkitStartSpan,
      "finish-span": app.agentToolkitFinishSpan,
      complete: app.agentToolkitComplete,
      evaluate: app.agentToolkitEvaluate,
      compare: app.agentToolkitCompare,
      propose: app.agentToolkitPropose,
      status: app.agentToolkitStatus,
      profile: app.agentToolkitProfile,
      optimize: app.agentToolkitOptimize,
    }[toolkitAction];
    return toResponse(await handler({ headers: headerBag(request), body, signal: request.signal }));
  }

  if (env && env.ASSETS && typeof env.ASSETS.fetch === "function") {
    return env.ASSETS.fetch(request);
  }

  return json(404, { error: "not found" });
}

export async function handleCloudflareRequest(request, env = {}, ctx = {}) {
  try {
    return await dispatchCloudflareRequest(request, env, ctx);
  } catch (error) {
    if (error instanceof JsonBodyError) {
      return json(error.statusCode, { error: error.message, code: error.code });
    }
    throw error;
  }
}

export default {
  fetch(request, env, ctx) {
    return handleCloudflareRequest(request, env, ctx);
  },
};

// Cloudflare exposes this named fetch handler as an authenticated loopback
// Service Binding through ctx.exports. It has no public route of its own.
export const CommerceAdmissionProbe = Object.freeze({
  fetch(request, env) {
    return handleCloudflareRequest(request, env);
  },
});
