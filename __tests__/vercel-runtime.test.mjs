// Tests for the Vercel serverless runtime adapter (agentic-canvas-os PRIMARY
// host). Covers req/res adaptation without network: auth/session (mint),
// unauthorized run (401 before any forward), and non-POST (405). The happy-path
// forward is covered network-free at the app level (agent-api-app.test.mjs).

import test from "node:test";
import assert from "node:assert/strict";

// The adapter builds the app from process.env at first call; set it before import.
process.env.AGENT_API_JWT_SECRET = "server-side-secret";
process.env.KNOWGRPH_MCP_ENDPOINT = "https://airvio.co/knowgrph/mcp";

const { handleAuthSession, handleRun } = await import("../web/api/_runtime.js");

function mockReq({ method = "POST", headers = {}, body } = {}) {
  return { method, headers, body };
}

function mockRes() {
  return {
    statusCode: 200,
    _headers: {},
    _body: "",
    setHeader(k, v) {
      this._headers[k.toLowerCase()] = v;
    },
    end(payload) {
      this._body = payload;
      this.ended = true;
    },
    json() {
      return JSON.parse(this._body || "{}");
    },
  };
}

test("handleAuthSession mints a token through a Vercel req/res", async () => {
  const res = mockRes();
  await handleAuthSession(mockReq({ body: { subject: "s1" } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(typeof res.json().token, "string");
});

test("handleRun without auth is 401 (before any MCP forward)", async () => {
  const res = mockRes();
  await handleRun(mockReq({ body: { referenceUrl: "https://x", brief: "b", budgetUsd: 1 } }), res);
  assert.equal(res.statusCode, 401);
});

test("a non-POST method is 405 on both routes", async () => {
  const a = mockRes();
  await handleAuthSession(mockReq({ method: "GET" }), a);
  assert.equal(a.statusCode, 405);
  const r = mockRes();
  await handleRun(mockReq({ method: "GET" }), r);
  assert.equal(r.statusCode, 405);
});

test("a string JSON body is parsed", async () => {
  const res = mockRes();
  await handleAuthSession(mockReq({ body: JSON.stringify({ subject: "fromString" }) }), res);
  assert.equal(res.statusCode, 200);
});
