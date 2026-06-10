// Vercel serverless runtime adapter for the agentic-canvas-os Agent-API
// (PRIMARY host). Files prefixed with `_` are not routed by Vercel; this is the
// shared wiring imported by the `api/auth/session.js` and `api/run.js` routes.
//
// It adapts a Vercel `(req, res)` to the platform-neutral handler contract
// (`{ headers, body } -> { statusCode, headers, body }`) from
// `agent-api/src/app.js`, so the auth + MCP-forward logic is identical to the
// AWS fallback. Holds no model keys; reads the server-side secret + knowgrph MCP
// endpoint from Vercel env vars.

import { createAgentApiApp } from "../../agent-api/src/app.js";

// One app instance per warm function (env is stable for the deploy).
let appInstance = null;
function app() {
  if (!appInstance) appInstance = createAgentApiApp();
  return appInstance;
}

/** Read + JSON-parse a Vercel request body (already-parsed object passes through). */
export async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  // Fallback: read the stream (Vercel usually pre-parses, this is belt-and-braces).
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

/** Lowercased header bag from a Vercel request (handler reads `authorization`). */
function headerBag(req) {
  const out = {};
  const h = req.headers || {};
  for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : v;
  return out;
}

/** Send a platform-neutral handler result through a Vercel response. */
function send(res, result) {
  res.statusCode = result.statusCode || 200;
  const headers = result.headers || { "content-type": "application/json" };
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(result.body ?? {}));
}

/** Run the platform-neutral `authSession` handler over a Vercel req/res. */
export async function handleAuthSession(req, res) {
  if (req.method && req.method !== "POST") return send(res, { statusCode: 405, body: { error: "method not allowed" } });
  const body = await readJsonBody(req);
  send(res, await app().authSession({ headers: headerBag(req), body }));
}

/** Run the platform-neutral `run` handler over a Vercel req/res. */
export async function handleRun(req, res) {
  if (req.method && req.method !== "POST") return send(res, { statusCode: 405, body: { error: "method not allowed" } });
  const body = await readJsonBody(req);
  send(res, await app().run({ headers: headerBag(req), body }));
}
