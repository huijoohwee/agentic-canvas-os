// Cloudflare Worker entrypoint for agentic-canvas-os.
//
// One Worker owns the product tier: static assets, auth/session, run forwarding,
// and SEA-LION readiness. It delegates static files to Workers Static Assets and
// keeps all secrets in Cloudflare env bindings.

import { createAgentApiApp } from "../agent-api/src/app.js";
import { createCacheContextRegistry } from "../agent-api/src/cache-context.js";
import { createProgrammaticToolCallingRuntime } from "../agent-api/src/programmatic-tool-calling.js";
import { createReasoningContinuityRegistry } from "../agent-api/src/reasoning-continuity.js";
import { createRunningAgentRuntime } from "../agent-api/src/running-agents.js";
import { createToolSearchRuntime } from "../agent-api/src/tool-search.js";
import { CanvasRoom } from "./canvas-room.js";

export { CanvasRoom };

const JSON_HEADERS = Object.freeze({ "content-type": "application/json" });
const APP_BY_ENV = new WeakMap();
const CACHE_CONTEXT_BY_ENV = new WeakMap();
const REASONING_CONTINUITY_BY_ENV = new WeakMap();
const PROGRAMMATIC_TOOL_CALLING_BY_ENV = new WeakMap();
const RUNNING_AGENTS_BY_ENV = new WeakMap();
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
  let cacheContext;
  let reasoningContinuity;
  let programmaticToolCalling;
  let runningAgents;
  let toolSearch;
  if (env && typeof env === "object") {
    cacheContext = CACHE_CONTEXT_BY_ENV.get(env);
    if (!cacheContext) {
      cacheContext = createCacheContextRegistry();
      CACHE_CONTEXT_BY_ENV.set(env, cacheContext);
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
      runningAgents = createRunningAgentRuntime();
      RUNNING_AGENTS_BY_ENV.set(env, runningAgents);
    }
    toolSearch = TOOL_SEARCH_BY_ENV.get(env);
    if (!toolSearch) {
      toolSearch = createToolSearchRuntime();
      TOOL_SEARCH_BY_ENV.set(env, toolSearch);
    }
  }
  const app = createAgentApiApp({
    env,
    cacheContext,
    reasoningContinuity,
    programmaticToolCalling,
    runningAgents,
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
