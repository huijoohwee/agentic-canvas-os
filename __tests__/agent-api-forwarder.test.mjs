// Tests for the thin keyless Agent-API forwarder + session auth
// (agentic-canvas-os). ZERO network — the knowgrph MCP client is injected as a
// stub. Covers session minting/verification, request validation, the
// auth-gated forward, fail-closed config, and the auth≠approval boundary.

import test from "node:test";
import assert from "node:assert/strict";

import {
  mintReviewerToken,
  mintSessionToken,
  verifyReviewerToken,
  verifySessionToken,
} from "../agent-api/src/auth.js";
import {
  createAuthSessionHandler,
  createInvokeHandler,
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

test("review tokens are purpose-separated and exact-scoped to one paused action", () => {
  const expected = {
    reviewId: "review-1",
    runId: "run-1",
    conversationId: "conversation-1",
    actionDigest: "digest-1",
  };
  const token = mintReviewerToken({
    secret: SECRET,
    subject: "operator-1",
    ...expected,
    now: 1_000,
  });
  const review = verifyReviewerToken(token, SECRET, expected, { now: 2_000 });
  assert.equal(review.valid, true);
  assert.equal(review.claims.sub, "operator-1");
  assert.equal(typeof review.claims.jti, "string");
  assert.equal(verifySessionToken(token, SECRET, { now: 2_000 }).reason, "wrong_purpose");
  assert.equal(verifyReviewerToken(token, SECRET, { ...expected, runId: "run-2" }, { now: 2_000 }).reason, "scope_mismatch");

  const session = mintSessionToken({ secret: SECRET, now: 1_000 });
  assert.equal(verifyReviewerToken(session, SECRET, expected, { now: 2_000 }).reason, "wrong_purpose");
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
    invokeDocsGrammar: async (input, opts) => {
      if (onCall) onCall(input, opts);
      return {
        ok: true,
        catalog: [{ token: input.query, kind: "command", summary: "Resolved from knowgrph MCP." }],
      };
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

// --- invoke handler (forward grammar queries to knowgrph MCP) ---------------

test("a valid authed invoke request forwards the query to knowgrph MCP", async () => {
  let forwarded;
  let forwardedOpts;
  const handler = createInvokeHandler({
    secret: SECRET,
    mcpClient: stubMcpClient((input, opts) => {
      forwarded = input;
      forwardedOpts = opts;
    }),
  });
  const token = await tokenFor();
  const res = await handler({
    headers: { authorization: `Bearer ${token}` },
    body: { query: "/soul.load" },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.catalog[0].token, "/soul.load");
  assert.deepEqual(forwarded, { query: "/soul.load" });
  assert.equal(forwardedOpts.bearer, token);
});

test("an invalid invoke body is 400 and no forward occurs", async () => {
  let called = false;
  const handler = createInvokeHandler({
    secret: SECRET,
    mcpClient: stubMcpClient(() => {
      called = true;
    }),
  });
  const token = await tokenFor();
  const res = await handler({
    headers: { authorization: `Bearer ${token}` },
    body: {},
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "invalid request");
  assert.equal(called, false);
});
