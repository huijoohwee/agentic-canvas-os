import { createHash } from "node:crypto";

import { verifySessionToken } from "./auth.js";
import { normalizeBoundedJson } from "./running-agent-contract.js";

const MAX_INPUT_CHARS = 200_000;

function json(statusCode, body) {
  return { statusCode, headers: { "content-type": "application/json" }, body };
}

function bearer(headers) {
  const source = headers && typeof headers === "object" ? headers : {};
  const match = /^Bearer\s+(.+)$/i.exec(String(source.authorization || source.Authorization || ""));
  return match ? match[1].trim() : "";
}

function identifier(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} must be a non-empty string.`);
  const normalized = value.trim();
  if (normalized.length > 256) throw new RangeError(`${field} exceeds 256 characters.`);
  return normalized;
}

function normalizeRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("request must be an object.");
  const unknown = Object.keys(value).filter((key) => !["runId", "conversationId", "input"].includes(key));
  if (unknown.length) throw new TypeError(`request contains unsupported fields: ${unknown.join(", ")}.`);
  return Object.freeze({
    runId: identifier(value.runId, "request.runId"),
    conversationId: identifier(value.conversationId, "request.conversationId"),
    input: normalizeBoundedJson(value.input, "request.input", MAX_INPUT_CHARS),
  });
}

function scopedId(kind, principalId, externalId) {
  const digest = createHash("sha256").update(JSON.stringify([principalId, externalId])).digest("hex");
  return `${kind}-${digest}`;
}

export function createAgentRuntimeHandler({ secret, agentRuntimeComposition, agentReference, now } = {}) {
  const configured = Boolean(
    agentReference
    && agentRuntimeComposition?.stats?.().configured
    && typeof agentRuntimeComposition.runAgent === "function",
  );
  return async function agentRuntimeHandler(request = {}) {
    if (!secret) return json(501, { error: "auth not configured" });
    const verdict = verifySessionToken(bearer(request.headers), secret, { now });
    if (!verdict.valid) return json(401, { error: "unauthorized" });
    if (!configured) return json(501, { error: "agent runtime not configured", code: "runtime_unconfigured" });
    try {
      const body = normalizeRequest(request.body || {});
      const result = await agentRuntimeComposition.runAgent({
        runId: scopedId("agent-run", verdict.claims.sub, body.runId),
        conversationId: scopedId("agent-conversation", verdict.claims.sub, body.conversationId),
        agent: agentReference,
        role: "user-facing-owner",
        input: body.input,
        signal: request.signal,
      });
      if (result.status === "completed") return json(200, result);
      return json(409, { ...result, reasonCode: "agent_run_blocked" });
    } catch (error) {
      if (error instanceof TypeError || error instanceof RangeError) {
        return json(400, { error: "invalid request", reason: error.message });
      }
      return json(409, { error: "agent run failed", code: "agent_run_failed" });
    }
  };
}
