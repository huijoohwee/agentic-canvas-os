// Tests for the Cloudflare Worker runtime adapter. ZERO network: the knowgrph
// MCP transport and static assets binding are injected.

import test from "node:test";
import assert from "node:assert/strict";

import { handleCloudflareRequest } from "../worker/index.js";

const ENV = Object.freeze({
  AGENT_API_JWT_SECRET: "server-side-secret",
  KNOWGRPH_MCP_ENDPOINT: "https://airvio.co/knowgrph/mcp",
  SEA_LION_API_KEY: "server-side-sealion-key",
});

function request(path, { method = "GET", headers = {}, body } = {}) {
  return new Request(`https://agentic-canvas-os.example${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function json(res) {
  return JSON.parse(await res.text());
}

test("GET /api/ready reports SEA-LION runtime readiness without leaking the key", async () => {
  const res = await handleCloudflareRequest(request("/api/ready"), ENV);
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.configured, true);
  assert.equal(body.model.provider, "sealion");
  assert.equal(body.model.endpoint, "https://api.sea-lion.ai/v1/chat/completions");
  assert.equal(body.model.apiKeyPresent, true);
  assert.equal(JSON.stringify(body).includes("server-side-sealion-key"), false);
});

test("POST /api/auth/session mints a session token", async () => {
  const res = await handleCloudflareRequest(request("/api/auth/session", { method: "POST", body: {} }), ENV);
  assert.equal(res.status, 200);
  assert.equal(typeof (await json(res)).token, "string");
});

test("POST /api/run without auth is 401 before any control-plane forward", async () => {
  const res = await handleCloudflareRequest(
    request("/api/run", { method: "POST", body: { referenceUrl: "https://x", brief: "b", budgetUsd: 1 } }),
    ENV,
  );
  assert.equal(res.status, 401);
});

test("non-API requests delegate to the Cloudflare assets binding", async () => {
  const env = {
    ...ENV,
    ASSETS: {
      fetch: async (req) => new Response(`asset:${new URL(req.url).pathname}`, { status: 200 }),
    },
  };
  const res = await handleCloudflareRequest(request("/"), env);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "asset:/");
});

test("API methods fail closed", async () => {
  const ready = await handleCloudflareRequest(request("/api/ready", { method: "POST" }), ENV);
  assert.equal(ready.status, 405);
  const run = await handleCloudflareRequest(request("/api/run", { method: "GET" }), ENV);
  assert.equal(run.status, 405);
});

