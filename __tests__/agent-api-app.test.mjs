// Tests for the platform-neutral Agent-API app core used by the Cloudflare
// Worker runtime. ZERO network — the MCP transport is injected.

import test from "node:test";
import assert from "node:assert/strict";

import { createAgentApiApp } from "../agent-api/src/app.js";

const ENV = Object.freeze({
  AGENT_API_JWT_SECRET: "server-side-secret",
  KNOWGRPH_MCP_ENDPOINT: "https://airvio.co/knowgrph/control-plane/mcp",
});

function mcpStub(structuredContent) {
  return async (req) => {
    if (req.body && req.body.method === "initialize") {
      return { status: 200, headers: { get: (n) => n.toLowerCase() === "mcp-session-id" ? "test-session-id" : "" }, text: async () => "" };
    }
    return {
      status: 200,
      headers: { get: (n) => (n.toLowerCase() === "content-type" ? "application/json" : "") },
      text: async () => JSON.stringify({ jsonrpc: "2.0", id: req.body.id, result: { structuredContent } }),
    };
  };
}

test("createAgentApiApp wires auth + a forwarding run handler", async () => {
  const app = createAgentApiApp({
    env: ENV,
    fetchImpl: mcpStub({ state: "blocked", approvalGates: [1, 2, 3, 4, 5] }),
  });
  assert.equal(app.configured, true);
  assert.equal(app.readiness().cacheContext.configured, true);
  assert.equal(app.readiness().cacheContext.providerCacheStatus, "unverified");
  assert.equal(app.readiness().reasoningContinuity.configured, true);
  assert.equal(app.readiness().reasoningContinuity.stableMode, "all_turns-with-previous-response");
  assert.equal(app.readiness().reasoningContinuity.providerEffectiveContext, "unverified");
  assert.equal(app.readiness().programmaticToolCalling.contractReady, true);
  assert.equal(app.readiness().programmaticToolCalling.configured, false);
  assert.equal(app.readiness().programmaticToolCalling.localJavaScriptExecution, "forbidden");
  assert.equal(app.readiness().programmaticToolCalling.providerContextIsolation, "unverified");
  assert.deepEqual(app.readiness().programmaticToolCalling.continuationModes, ["stored", "stateless-replay"]);
  assert.equal(app.readiness().programmaticToolCalling.callerContract, "function-call-output-preserves-caller");

  const session = await app.authSession({ body: { subject: "s1" } });
  assert.equal(session.statusCode, 200);
  const token = session.body.token;

  const run = await app.run({
    headers: { authorization: `Bearer ${token}` },
    body: { referenceUrl: "https://youtu.be/x", brief: "promo", budgetUsd: 25 },
  });
  assert.equal(run.statusCode, 200);
  assert.equal(run.body.state, "blocked");
  assert.ok(run.body.approvalGates.length >= 5);
});

test("createAgentApiApp wires an invoke handler for grammar queries", async () => {
  const app = createAgentApiApp({
    env: ENV,
    fetchImpl: mcpStub({
      ok: true,
      catalog: [{ token: "/soul.load", kind: "command", summary: "Resolved from knowgrph MCP." }],
    }),
  });
  assert.equal(app.configured, true);

  const session = await app.authSession({ body: { subject: "s1" } });
  const token = session.body.token;

  const invoke = await app.invoke({
    headers: { authorization: `Bearer ${token}` },
    body: { query: "/soul.load" },
  });
  assert.equal(invoke.statusCode, 200);
  assert.equal(invoke.body.ok, true);
  assert.equal(invoke.body.catalog[0].token, "/soul.load");
});

test("run fails closed (501) when no MCP endpoint is configured", async () => {
  const app = createAgentApiApp({ env: { AGENT_API_JWT_SECRET: "s" } });
  assert.equal(app.configured, false);
  const session = await app.authSession({ body: {} });
  const token = session.body.token;
  const run = await app.run({
    headers: { authorization: `Bearer ${token}` },
    body: { referenceUrl: "https://x", brief: "b", budgetUsd: 1 },
  });
  assert.equal(run.statusCode, 501);
});

test("invoke fails closed (501) when no MCP endpoint is configured", async () => {
  const app = createAgentApiApp({ env: { AGENT_API_JWT_SECRET: "s" } });
  const session = await app.authSession({ body: {} });
  const token = session.body.token;
  const invoke = await app.invoke({
    headers: { authorization: `Bearer ${token}` },
    body: { query: "/soul.load" },
  });
  assert.equal(invoke.statusCode, 501);
});

test("auth/session honors an env default expiry", async () => {
  const app = createAgentApiApp({ env: { ...ENV, AGENT_API_AUTH_EXPIRY: "900" }, fetchImpl: mcpStub({}) });
  const session = await app.authSession({ body: {} });
  assert.equal(session.statusCode, 200);
  const [, payloadB64] = session.body.token.split(".");
  const claims = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  assert.equal(claims.exp - claims.iat, 900);
});
