// Thin, keyless Agent-API for the agentic-canvas-os product tier.
//
// Two responsibilities, NOTHING more (mirrors knowgrph R11/R12/R15):
//   1. `POST /auth/session` → mint a stateless session token (HS256, secret
//      server-side only).
//   2. `POST /run` → verify the session token, validate the request schema, and
//      FORWARD `knowgrph.video_remix.run` to the knowgrph MCP control plane,
//      returning the Run_Manifest. This tier holds NO model keys and calls NO
//      paid model directly; all reasoning/spend happens in knowgrph behind its
//      Approval_Gates.
//
// Pure/deterministic + injectable (MCP client, secret, clock) so it is fully
// testable offline. The Cloudflare Worker adapter wraps these handlers with
// Request/Response parsing; here they take/return plain objects.

import { mintSessionToken, verifySessionToken } from "./auth.js";

// Request schema bounds (mirror knowgrph POST /run, R12.1).
const REFERENCE_URL_MAX = 2048;
const BRIEF_MIN = 1;
const BRIEF_MAX = 10000;
const BUDGET_MIN = 0.01;
const BUDGET_MAX = 999999999.99;
const APPROVALS_MAX = 100;

function fieldError(field, reason) {
  return { field, reason };
}

/** Validate the `POST /run` body. Returns `{ valid, errors[], value }`. */
export function validateRunRequest(body) {
  const errors = [];
  const input = body && typeof body === "object" && !Array.isArray(body) ? body : {};

  const referenceUrl = typeof input.referenceUrl === "string" ? input.referenceUrl.trim() : "";
  if (!referenceUrl) errors.push(fieldError("referenceUrl", "required"));
  else if (referenceUrl.length > REFERENCE_URL_MAX) errors.push(fieldError("referenceUrl", "too long"));
  else if (!/^https?:\/\//i.test(referenceUrl)) errors.push(fieldError("referenceUrl", "must be an absolute http(s) URL"));

  const brief = typeof input.brief === "string" ? input.brief : "";
  if (brief.trim().length < BRIEF_MIN) errors.push(fieldError("brief", "required"));
  else if (brief.length > BRIEF_MAX) errors.push(fieldError("brief", `must be at most ${BRIEF_MAX} chars`));

  const budgetUsd = Number(input.budgetUsd);
  if (!Number.isFinite(budgetUsd) || budgetUsd < BUDGET_MIN || budgetUsd > BUDGET_MAX) {
    errors.push(fieldError("budgetUsd", `must be within [${BUDGET_MIN}, ${BUDGET_MAX}]`));
  }

  let approvals = [];
  if (input.approvals !== undefined) {
    if (!Array.isArray(input.approvals) || input.approvals.length > APPROVALS_MAX) {
      errors.push(fieldError("approvals", `must be an array of at most ${APPROVALS_MAX}`));
    } else {
      approvals = input.approvals;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    value: { referenceUrl, brief: brief.trim(), budgetUsd, approvals },
  };
}

/** Read a Bearer token from a headers object (case-insensitive). */
function readBearer(headers) {
  const h = headers && typeof headers === "object" ? headers : {};
  const raw = h.authorization || h.Authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(String(raw));
  return m ? m[1].trim() : "";
}

/** Non-disclosing JSON response helper. */
function json(statusCode, payload) {
  return { statusCode, headers: { "content-type": "application/json" }, body: payload };
}

/**
 * `POST /auth/session` handler factory.
 * @param {{ secret: string, now?: number, defaultExpirySeconds?: number }} deps
 *   `secret` is the server-side signing secret; `defaultExpirySeconds` is used
 *   when the request body does not supply `expiryWindowSeconds`.
 */
export function createAuthSessionHandler({ secret, now, defaultExpirySeconds } = {}) {
  return async function authSession(request = {}) {
    if (!secret) return json(501, { error: "auth not configured" });
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const expiryWindowSeconds =
      body.expiryWindowSeconds !== undefined ? body.expiryWindowSeconds : defaultExpirySeconds;
    const token = mintSessionToken({
      secret,
      subject: typeof body.subject === "string" ? body.subject : undefined,
      expiryWindowSeconds,
      now,
    });
    return json(200, { token });
  };
}

/**
 * `POST /run` handler factory: verify session → validate → forward to knowgrph
 * MCP. FAIL-CLOSED with 501 when no MCP client/endpoint is wired (never a silent
 * direct model call).
 *
 * @param {object} deps
 * @param {string} deps.secret server-side signing secret (verify Auth_Token)
 * @param {{ runVideoRemix: Function }} deps.mcpClient knowgrph MCP client
 * @param {number} [deps.now] injectable clock
 */
export function createRunHandler({ secret, mcpClient, now } = {}) {
  return async function run(request = {}) {
    if (!secret) return json(501, { error: "auth not configured" });
    if (!mcpClient || typeof mcpClient.runVideoRemix !== "function") {
      return json(501, { error: "knowgrph MCP control plane not configured" });
    }

    // 1. Auth: verify the session token (access gate; never authorizes spend).
    const token = readBearer(request.headers);
    const verdict = verifySessionToken(token, secret, { now });
    if (!verdict.valid) return json(401, { error: "unauthorized" });

    // 2. Validate the request body (4xx naming each invalid field; no forward).
    const { valid, errors, value } = validateRunRequest(request.body);
    if (!valid) return json(400, { error: "invalid request", fields: errors });

    // 3. Forward to the knowgrph control plane over MCP; return the Run_Manifest.
    try {
      const manifest = await mcpClient.runVideoRemix(value, { bearer: token });
      return json(200, manifest);
    } catch (err) {
      const status = Number.isFinite(err && err.status) ? err.status : 502;
      // Non-disclosing: surface a coarse upstream-failure indication only.
      return json(status >= 400 && status < 600 ? status : 502, {
        error: "knowgrph control plane call failed",
        code: (err && err.code) || "mcp_error",
      });
    }
  };
}

/**
 * `POST /invoke` handler factory: verify session → forward to knowgrph
 * MCP command grammar tool.
 */
export function createInvokeHandler({ secret, mcpClient, now } = {}) {
  return async function invoke(request = {}) {
    if (!secret) return json(501, { error: "auth not configured" });
    if (!mcpClient || typeof mcpClient.invokeDocsGrammar !== "function") {
      return json(501, { error: "knowgrph MCP control plane not configured" });
    }

    const token = readBearer(request.headers);
    const verdict = verifySessionToken(token, secret, { now });
    if (!verdict.valid) return json(401, { error: "unauthorized" });

    const body = request.body || {};
    if (!body.query || typeof body.query !== "string") {
      return json(400, { error: "invalid request", fields: [{ field: "query", reason: "required string" }] });
    }

    try {
      const result = await mcpClient.invokeDocsGrammar({ query: body.query }, { bearer: token });
      return json(200, result);
    } catch (err) {
      const status = Number.isFinite(err && err.status) ? err.status : 502;
      return json(status >= 400 && status < 600 ? status : 502, {
        error: "knowgrph control plane call failed",
        code: (err && err.code) || "mcp_error",
      });
    }
  };
}

export const RUN_REQUEST_BOUNDS = Object.freeze({
  REFERENCE_URL_MAX,
  BRIEF_MIN,
  BRIEF_MAX,
  BUDGET_MIN,
  BUDGET_MAX,
  APPROVALS_MAX,
});
