// Tests for the thin keyless Agent-API forwarder + session auth
// (agentic-canvas-os). ZERO network — the knowgrph MCP client is injected as a
// stub. Covers session minting/verification, request validation, the
// auth-gated forward, fail-closed config, and the auth≠approval boundary.

import test from "node:test";
import assert from "node:assert/strict";

import { mintSessionToken, verifySessionToken } from "../agent-api/src/auth.js";
import {
  createAuthSessionHandler,
  createRunHandler,
  validateRunRequest,
} from "../agent-api/src/handler.js";

const SECRET = "server-side-only-secret";
const VALID_RUN = { referenceUrl: "https://youtu.be/abc", brief: "Make a promo.", budgetUsd: 25 };

// --- auth -------------------------------------------------------------------

test("mint + verify round-trips a valid session token", () => {
  const token = mintSessionToken({ secret: SECRET, subject: "sess-1" });
  const v = verifySessionToken(token, SECRET);
  assert.equal(v.valid, true);
  assert.equal(v.claims.sub, "sess-1");
});

test("a tampered signature is rejected", () => {
  const token = mintSessionToken({ secret: SECRET });
  const v = verifySessionToken(`${token}x`, SECRET);
  assert.equal(v.valid, false);
});

test("a wrong secret is rejected", () => {
  const token = mintSessionToken({ secret: SECRET });
  assert.equal(verifySessionToken(token, "other").valid, false);
});

test("an expired token is rejected (injected clock)", () => {
  const token = mintSessionToken({ secret: SECRET, expiryWindowSeconds: 300, now: 0 });
  const v = verifySessionToken(token, SECRET, { now: 301 * 1000 });
  assert.equal(v.valid, false);
  assert.equal(v.reason, "expired");
});

// --- request validation -----------------------------------------------------

test("validateRunRequest accepts a well-formed body", () => {
  const { valid, value } = validateRunRequest(VALID_RUN);
  assert.equal(valid, true);
  assert.equal(value.referenceUrl, VALID_RUN.referenceUrl);
});

test("validateRunRequest names each invalid field", () => {
  const { valid, errors } = validateRunRequest({ referenceUrl: "ftp://x", brief: "", budgetUsd: 0 });
  assert.equal(valid, false);
  const fields = errors.map((e) => e.field);
  assert.ok(fields.includes("referenceUrl"));
  assert.ok(fields.includes("brief"));
  assert.ok(fields.includes("budgetUsd"));
});

// --- auth/session handler ----------------------------------------------------

test("auth/session mints a token; 501 when unconfigured", async () => {
  const ok = await createAuthSessionHandler({ secret: SECRET })({ body: {} });
  assert.equal(ok.statusCode, 200);
  assert.equal(typeof ok.body.token, "string");
  const unconfigured = await createAuthSessionHandler({})({ body: {} });
  assert.equal(unconfigured.statusCode, 501);
});

// --- run handler (forward to knowgrph MCP) ----------------------------------

function stubMcpClient(onCall) {
  return {
    runVideoRemix: async (input, opts) => {
      if (onCall) onCall(input, opts);
      return { state: "blocked", approvalGates: [1, 2, 3, 4, 5], stages: [] };
    },
  };
}

async function tokenFor() {
  const res = await createAuthSessionHandler({ secret: SECRET })({ body: { subject: "s" } });
  return res.body.token;
}

test("a valid authed request forwards to knowgrph MCP and returns the manifest", async () => {
  let forwarded;
  const handler = createRunHandler({ secret: SECRET, mcpClient: stubMcpClient((input) => (forwarded = input)) });
  const token = await tokenFor();
  const res = await handler({ headers: { authorization: `Bearer ${token}` }, body: VALID_RUN });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.state, "blocked");
  assert.equal(forwarded.referenceUrl, VALID_RUN.referenceUrl);
});

test("an unauthenticated request is rejected with 401 and no forward", async () => {
  let called = false;
  const handler = createRunHandler({ secret: SECRET, mcpClient: stubMcpClient(() => (called = true)) });
  const res = await handler({ headers: {}, body: VALID_RUN });
  assert.equal(res.statusCode, 401);
  assert.equal(called, false);
});

test("an invalid body is 400 with named fields and no forward", async () => {
  let called = false;
  const handler = createRunHandler({ secret: SECRET, mcpClient: stubMcpClient(() => (called = true)) });
  const token = await tokenFor();
  const res = await handler({ headers: { authorization: `Bearer ${token}` }, body: { brief: "" } });
  assert.equal(res.statusCode, 400);
  assert.ok(Array.isArray(res.body.fields) && res.body.fields.length > 0);
  assert.equal(called, false);
});

test("fail-closed 501 when no knowgrph MCP client is configured", async () => {
  const handler = createRunHandler({ secret: SECRET });
  const token = await tokenFor();
  const res = await handler({ headers: { authorization: `Bearer ${token}` }, body: VALID_RUN });
  assert.equal(res.statusCode, 501);
});

test("auth never substitutes for approval: the forward carries empty approvals through", async () => {
  // A valid Auth_Token authorizes ACCESS only; the manifest comes back gated
  // (state blocked, >=5 gates) because no Approval_Token was supplied — the
  // control plane, not this tier, enforces spend.
  const handler = createRunHandler({ secret: SECRET, mcpClient: stubMcpClient() });
  const token = await tokenFor();
  const res = await handler({ headers: { authorization: `Bearer ${token}` }, body: { ...VALID_RUN, approvals: [] } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.state, "blocked");
  assert.ok(res.body.approvalGates.length >= 5);
});
