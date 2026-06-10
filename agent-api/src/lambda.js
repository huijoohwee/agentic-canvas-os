// AWS Lambda adapter for the agentic-canvas-os Agent-API (FALLBACK host).
//
// Vercel serverless functions are the PRIMARY/default host (see `web/api/*`);
// this AWS API Gateway proxy adapter is the FALLBACK the frontend fails over to
// when the primary is unreachable. It adapts an API Gateway (v1/v2) proxy event
// to the SAME platform-neutral app core (`agent-api/src/app.js`), so the auth +
// MCP-forward behavior is identical on either host. Holds no model keys.

import { createAgentApiApp } from "./app.js";

let appInstance = null;
function app() {
  if (!appInstance) appInstance = createAgentApiApp();
  return appInstance;
}

/** Lowercased header bag from an API Gateway event. */
function headerBag(event) {
  const out = {};
  const h = (event && event.headers) || {};
  for (const [k, v] of Object.entries(h)) out[String(k).toLowerCase()] = v;
  return out;
}

/** Parse the (possibly base64) JSON body from an API Gateway event. */
function parseBody(event) {
  let raw = event && event.body;
  if (!raw) return {};
  if (event.isBase64Encoded) {
    try {
      raw = Buffer.from(raw, "base64").toString("utf8");
    } catch {
      return {};
    }
  }
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Resolve the request method + path across API Gateway v1 and v2 event shapes. */
function resolveRoute(event) {
  const method =
    (event.requestContext && event.requestContext.http && event.requestContext.http.method) ||
    event.httpMethod ||
    "POST";
  const path =
    (event.requestContext && event.requestContext.http && event.requestContext.http.path) ||
    event.rawPath ||
    event.path ||
    "";
  return { method: String(method).toUpperCase(), path: String(path) };
}

function toApiGatewayResult(result) {
  return {
    statusCode: result.statusCode || 200,
    headers: result.headers || { "content-type": "application/json" },
    body: JSON.stringify(result.body ?? {}),
  };
}

/**
 * API Gateway proxy handler. Routes `POST /auth/session` and `POST /run`
 * (trailing path segments tolerated) to the shared app; anything else → 404.
 */
export async function handler(event = {}) {
  const { method, path } = resolveRoute(event);
  const request = { headers: headerBag(event), body: parseBody(event) };

  if (method !== "POST") return toApiGatewayResult({ statusCode: 405, body: { error: "method not allowed" } });

  if (/\/auth\/session\/?$/.test(path)) {
    return toApiGatewayResult(await app().authSession(request));
  }
  if (/\/run\/?$/.test(path)) {
    return toApiGatewayResult(await app().run(request));
  }
  return toApiGatewayResult({ statusCode: 404, body: { error: "not found" } });
}

export default handler;
