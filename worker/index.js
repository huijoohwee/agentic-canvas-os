// Cloudflare Worker entrypoint for agentic-canvas-os.
//
// One Worker owns the product tier: static assets, auth/session, run forwarding,
// and SEA-LION readiness. It delegates static files to Workers Static Assets and
// keeps all secrets in Cloudflare env bindings.

import { createAgentApiApp } from "../agent-api/src/app.js";

const JSON_HEADERS = Object.freeze({ "content-type": "application/json" });

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
  return createAgentApiApp({
    env,
    fetchImpl: (req) => fetch(req.url, { method: req.method, headers: req.headers, body: JSON.stringify(req.body) }),
  });
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

