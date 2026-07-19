// Cloudflare Worker entrypoint for agentic-canvas-os.
//
// One Worker owns the product tier: static assets, auth/session, run forwarding,
// and model-provider readiness. It delegates static files to Workers Static Assets and
// keeps all secrets in Cloudflare env bindings.

import { createAgentApiApp } from "../agent-api/src/app.js";
import { createAgentDefinitionRegistry } from "../agent-api/src/agent-definitions.js";
import { createCacheContextRegistry } from "../agent-api/src/cache-context.js";
import {
  createDurableObjectFunctionExecutionReceiptStore,
  createDurableObjectFunctionContinuationStore,
  createDurableObjectHumanReviewStore,
  createDurableObjectPausedTurnStore,
} from "../agent-api/src/durable-object-state-store.js";
import { createModelProviderRuntime } from "../agent-api/src/model-providers.js";
import { createProgrammaticToolCallingRuntime } from "../agent-api/src/programmatic-tool-calling.js";
import { createReasoningContinuityRegistry } from "../agent-api/src/reasoning-continuity.js";
import { createRunningAgentRuntime } from "../agent-api/src/running-agents.js";
import { createSandboxAgentRuntime } from "../agent-api/src/sandbox-agents.js";
import { createToolSearchRuntime } from "../agent-api/src/tool-search.js";
import { CanvasRoom } from "./canvas-room.js";
import { AgentState } from "./agent-state.js";

export { AgentState, CanvasRoom };

const JSON_HEADERS = Object.freeze({ "content-type": "application/json" });
const APP_BY_ENV = new WeakMap();
const AGENT_DEFINITIONS_BY_ENV = new WeakMap();
const CACHE_CONTEXT_BY_ENV = new WeakMap();
const MODEL_PROVIDERS_BY_ENV = new WeakMap();
const REASONING_CONTINUITY_BY_ENV = new WeakMap();
const PROGRAMMATIC_TOOL_CALLING_BY_ENV = new WeakMap();
const RUNNING_AGENTS_BY_ENV = new WeakMap();
const SANDBOX_AGENTS_BY_ENV = new WeakMap();
const TOOL_SEARCH_BY_ENV = new WeakMap();

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

async function readJsonBody(request) {
  const text = await request.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function toResponse(result) {
  return json(result.statusCode || 200, result.body);
}

function createWorkerApp(env) {
  if (env && typeof env === "object" && APP_BY_ENV.has(env)) return APP_BY_ENV.get(env);
  let agentDefinitions;
  let cacheContext;
  let modelProviders;
  let reasoningContinuity;
  let programmaticToolCalling;
  let runningAgents;
  let sandboxAgents;
  let toolSearch;
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
  if (env && typeof env === "object") {
    agentDefinitions = AGENT_DEFINITIONS_BY_ENV.get(env);
    if (!agentDefinitions) {
      agentDefinitions = createAgentDefinitionRegistry();
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
      toolSearch = createToolSearchRuntime();
      TOOL_SEARCH_BY_ENV.set(env, toolSearch);
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
    sandboxAgents,
    toolSearch,
    fetchImpl: (req) => fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: req.signal,
    }),
  });
  if (env && typeof env === "object") APP_BY_ENV.set(env, app);
  return app;
}

export async function handleCloudflareRequest(request, env = {}) {
  const url = new URL(request.url);
  const app = createWorkerApp(env);

  if (url.pathname === "/api/ready" || url.pathname === "/ready") {
    if (request.method !== "GET") return json(405, { error: "method not allowed" });
    return json(200, app.readiness());
  }

  if (url.pathname === "/api/auth/session" || url.pathname === "/auth/session") {
    if (request.method !== "POST") return json(405, { error: "method not allowed" });
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

  if (url.pathname === "/api/canvas/room" || url.pathname === "/canvas/room") {
    // WebSocket upgrade to the room's Durable Object. The room uses the
    // WebSocket Hibernation API; account quota and billing remain deployment
    // concerns rather than source-code guarantees.
    if (!env || !env.CANVAS_ROOM || typeof env.CANVAS_ROOM.idFromName !== "function") {
      return json(501, { error: "canvas collaboration not configured" });
    }
    const roomId = url.searchParams.get("room") || "";
    if (!roomId) return json(400, { error: "missing room" });
    const id = env.CANVAS_ROOM.idFromName(roomId);
    const stub = env.CANVAS_ROOM.get(id);
    return stub.fetch(request);
  }

  if (env && env.ASSETS && typeof env.ASSETS.fetch === "function") {
    return env.ASSETS.fetch(request);
  }

  return json(404, { error: "not found" });
}

export default {
  fetch(request, env) {
    return handleCloudflareRequest(request, env);
  },
};
