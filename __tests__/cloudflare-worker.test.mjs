// Tests for the Cloudflare Worker runtime adapter. ZERO network: the knowgrph
// MCP transport and static assets binding are injected.

import test from "node:test";
import assert from "node:assert/strict";

import { verifySessionToken } from "../agent-api/src/auth.js";
import { handleCloudflareRequest } from "../worker/index.js";

const ENV = Object.freeze({
  AGENT_API_JWT_SECRET: "server-side-secret",
  KNOWGRPH_MCP_ENDPOINT: "https://airvio.co/knowgrph/control-plane/mcp",
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

async function withMockedFetch(mockFetch, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("GET /api/ready reports SEA-LION runtime readiness without leaking the key", async () => {
  const res = await handleCloudflareRequest(request("/api/ready"), ENV);
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.configured, true);
  assert.equal(body.model.provider, "sealion");
  assert.equal(body.model.endpoint, "https://api.sea-lion.ai/v1/chat/completions");
  assert.equal(body.model.apiKeyPresent, true);
  assert.equal(body.cacheContext.stablePrefixOrder, "static-first-dynamic-last");
  assert.equal(body.cacheContext.providerCacheStatus, "unverified");
  assert.equal(body.reasoningContinuity.invariantPolicy, "goals-assumptions-priorities");
  assert.equal(body.reasoningContinuity.driftMode, "current_turn");
  assert.equal(body.reasoningContinuity.providerEffectiveContext, "unverified");
  assert.equal(JSON.stringify(body).includes("server-side-sealion-key"), false);
});

test("POST /api/auth/session mints a session token", async () => {
  const res = await handleCloudflareRequest(request("/api/auth/session", { method: "POST", body: {} }), ENV);
  assert.equal(res.status, 200);
  assert.equal(typeof (await json(res)).token, "string");
});

test("POST /api/auth/session rejects caller identity and guessable room scope", async () => {
  const rejected = await handleCloudflareRequest(request("/api/auth/session", {
    method: "POST",
    body: { subject: "spoofed-admin", roomIds: ["victim-room"] },
  }), ENV);
  assert.equal(rejected.status, 400);

  const roomId = "a".repeat(32);
  const accepted = await handleCloudflareRequest(request("/api/auth/session", {
    method: "POST",
    body: { subject: "spoofed-admin", roomIds: [roomId] },
  }), ENV);
  assert.equal(accepted.status, 200);
  const verdict = verifySessionToken((await json(accepted)).token, ENV.AGENT_API_JWT_SECRET);
  assert.equal(verdict.valid, true);
  assert.notEqual(verdict.claims.sub, "spoofed-admin");
  assert.deepEqual(verdict.claims.roomIds, [roomId]);
});

test("POST /api/run without auth is 401 before any control-plane forward", async () => {
  const res = await handleCloudflareRequest(
    request("/api/run", { method: "POST", body: { referenceUrl: "https://x", brief: "b", budgetUsd: 1 } }),
    ENV,
  );
  assert.equal(res.status, 401);
});

test("POST /api/invoke forwards an authed grammar query through the worker", async () => {
  await withMockedFetch(async (_url, init) => {
    const rpc = JSON.parse(String(init.body || "{}"));
    if (rpc.method === "initialize") {
      return new Response("", {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "mcp-session-id": "test-session-id",
        },
      });
    }
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: rpc.id,
        result: {
          structuredContent: {
            ok: true,
            catalog: [{ token: rpc.params.arguments.query, kind: "command" }],
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }, async () => {
    const session = await handleCloudflareRequest(request("/api/auth/session", { method: "POST", body: {} }), ENV);
    const token = (await json(session)).token;
    const res = await handleCloudflareRequest(
      request("/api/invoke", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: { query: "/soul.load" },
      }),
      ENV,
    );

    assert.equal(res.status, 200);
    const body = await json(res);
    assert.equal(body.ok, true);
    assert.equal(body.catalog[0].token, "/soul.load");
  });
});

test("POST /api/invoke without auth is 401 before any control-plane forward", async () => {
  let called = false;
  await withMockedFetch(async () => {
    called = true;
    throw new Error("should not forward without auth");
  }, async () => {
    const res = await handleCloudflareRequest(
      request("/api/invoke", { method: "POST", body: { query: "/soul.load" } }),
      ENV,
    );
    assert.equal(res.status, 401);
    assert.equal(called, false);
  });
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
