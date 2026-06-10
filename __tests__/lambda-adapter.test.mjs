// Tests for the AWS Lambda adapter (agentic-canvas-os FALLBACK host). Covers
// API Gateway v1/v2 routing + request adaptation without network: auth/session
// (mint, no upstream call), unauthorized run (401 before any forward), unknown
// path (404), non-POST (405), and base64 body decoding. The happy-path forward
// is covered network-free at the app level (agent-api-app.test.mjs).

import test from "node:test";
import assert from "node:assert/strict";

// The adapter reads process.env at first handler call; set it before importing.
process.env.AGENT_API_JWT_SECRET = "server-side-secret";
process.env.KNOWGRPH_MCP_ENDPOINT = "https://airvio.co/knowgrph/mcp";

const { handler } = await import("../agent-api/src/lambda.js");

function v2(method, path, { headers = {}, body, isBase64Encoded = false } = {}) {
  return {
    requestContext: { http: { method, path } },
    headers,
    body: typeof body === "string" ? body : body === undefined ? undefined : JSON.stringify(body),
    isBase64Encoded,
  };
}

function v1(method, path, opts) {
  const e = v2(method, path, opts);
  return { httpMethod: method, path, headers: e.headers, body: e.body, isBase64Encoded: e.isBase64Encoded };
}

test("POST /auth/session mints a token (v2 event, no network)", async () => {
  const res = await handler(v2("POST", "/auth/session", { body: {} }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(typeof body.token, "string");
});

test("the /api prefix is tolerated (matches Vercel route shape)", async () => {
  const res = await handler(v2("POST", "/api/auth/session", { body: {} }));
  assert.equal(res.statusCode, 200);
});

test("POST /run without auth is 401 before any forward (v1 event)", async () => {
  const res = await handler(
    v1("POST", "/run", { body: { referenceUrl: "https://x", brief: "b", budgetUsd: 1 } }),
  );
  assert.equal(res.statusCode, 401);
});

test("an unknown path is 404", async () => {
  const res = await handler(v2("POST", "/nope", {}));
  assert.equal(res.statusCode, 404);
});

test("a non-POST method is 405", async () => {
  const res = await handler(v2("GET", "/run", {}));
  assert.equal(res.statusCode, 405);
});

test("a base64-encoded body is decoded", async () => {
  const token = JSON.parse((await handler(v2("POST", "/auth/session", { body: {} }))).body).token;
  const payload = Buffer.from(JSON.stringify({ referenceUrl: "ftp://bad", brief: "", budgetUsd: 0 })).toString("base64");
  const res = await handler(
    v2("POST", "/run", { headers: { authorization: `Bearer ${token}` }, body: payload, isBase64Encoded: true }),
  );
  // Decoded → validation runs → 400 with named fields (no forward, no network).
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.body);
  assert.ok(Array.isArray(body.fields) && body.fields.length > 0);
});
