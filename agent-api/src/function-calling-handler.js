import { verifySessionToken } from "./auth.js";

const PROMPT_MAX = 8_000;
const RUN_ID_MAX = 128;
const REQUEST_FIELDS = Object.freeze(["runId", "prompt", "parallelToolCalls", "toolChoice"]);
const RESUME_FIELDS = Object.freeze(["runId", "resumeToken", "decision", "reviewerToken", "reason", "editedPayload"]);
const REVIEW_DECISIONS = new Set(["approve", "reject", "edit"]);

function json(statusCode, body) {
  return { statusCode, headers: { "content-type": "application/json" }, body };
}

function bearer(headers) {
  const source = headers && typeof headers === "object" ? headers : {};
  const match = /^Bearer\s+(.+)$/i.exec(String(source.authorization || source.Authorization || ""));
  return match ? match[1].trim() : "";
}

function toolChoice(value, names) {
  if (value === undefined) return { mode: "auto" };
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (["auto", "required", "none"].includes(value.mode)) return { mode: value.mode };
  if (value.mode === "forced" && names.has(value.name)) return { mode: "forced", name: value.name };
  if (value.mode === "allowed" && Array.isArray(value.names) && value.names.length > 0
    && value.names.every((name) => names.has(name))
    && new Set(value.names).size === value.names.length
    && [undefined, "auto", "required"].includes(value.requirement)) {
    return { mode: "allowed", names: value.names, requirement: value.requirement || "auto" };
  }
  return null;
}

function validateBody(body, tools) {
  const input = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const runId = typeof input.runId === "string" ? input.runId.trim() : "";
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  const parallelToolCalls = input.parallelToolCalls === undefined ? false : input.parallelToolCalls;
  const names = new Set(tools.map((tool) => tool.name));
  const choice = toolChoice(input.toolChoice, names);
  const fields = [];
  for (const field of Object.keys(input).filter((field) => !REQUEST_FIELDS.includes(field))) {
    fields.push({ field, reason: "unsupported field" });
  }
  if (!runId || runId.length > RUN_ID_MAX) fields.push({ field: "runId", reason: `required, at most ${RUN_ID_MAX} characters` });
  if (!prompt || prompt.length > PROMPT_MAX) fields.push({ field: "prompt", reason: `required, at most ${PROMPT_MAX} characters` });
  if (typeof parallelToolCalls !== "boolean") fields.push({ field: "parallelToolCalls", reason: "must be boolean" });
  if (!choice) fields.push({ field: "toolChoice", reason: "must reference only enabled application functions" });
  return {
    valid: fields.length === 0,
    fields,
    value: { runId, prompt, parallelToolCalls, toolChoice: choice },
  };
}

export function createFunctionCallingHandler({ secret, functionCallingManager, tools = [], now } = {}) {
  const managerStats = functionCallingManager && typeof functionCallingManager.stats === "function"
    ? functionCallingManager.stats()
    : {};
  const configured = Boolean(functionCallingManager && typeof functionCallingManager.run === "function"
    && managerStats.configured && tools.length > 0);
  return async function functionCall(request = {}) {
    if (!secret) return json(501, { error: "auth not configured" });
    const verdict = verifySessionToken(bearer(request.headers), secret, { now });
    if (!verdict.valid) return json(401, { error: "unauthorized" });
    if (!configured) return json(501, { error: "function calling not configured" });
    const validated = validateBody(request.body, tools);
    if (!validated.valid) return json(400, { error: "invalid request", fields: validated.fields });
    const result = await functionCallingManager.run({
      runId: validated.value.runId,
      input: { prompt: validated.value.prompt },
      toolChoice: validated.value.toolChoice,
      parallelToolCalls: validated.value.parallelToolCalls,
    });
    return json(result.status === "completed" ? 200 : result.status === "paused" ? 202 : 409, result);
  };
}

function validateResumeBody(body) {
  const input = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const fields = Object.keys(input)
    .filter((field) => !RESUME_FIELDS.includes(field))
    .map((field) => ({ field, reason: "unsupported field" }));
  const runId = typeof input.runId === "string" ? input.runId.trim() : "";
  const resumeToken = typeof input.resumeToken === "string" ? input.resumeToken.trim() : "";
  const reviewerToken = typeof input.reviewerToken === "string" ? input.reviewerToken.trim() : "";
  if (!runId || runId.length > RUN_ID_MAX) fields.push({ field: "runId", reason: `required, at most ${RUN_ID_MAX} characters` });
  if (!resumeToken || resumeToken.length > 512) fields.push({ field: "resumeToken", reason: "required, at most 512 characters" });
  if (!REVIEW_DECISIONS.has(input.decision)) fields.push({ field: "decision", reason: "must be approve, reject, or edit" });
  if (!reviewerToken || reviewerToken.length > 8_192) fields.push({ field: "reviewerToken", reason: "required, at most 8192 characters" });
  if (input.reason !== undefined && (typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 2_000)) {
    fields.push({ field: "reason", reason: "must be non-empty and at most 2000 characters" });
  }
  if (input.decision === "edit" && input.editedPayload === undefined) {
    fields.push({ field: "editedPayload", reason: "required for edit" });
  }
  if (input.decision !== "edit" && input.editedPayload !== undefined) {
    fields.push({ field: "editedPayload", reason: "valid only for edit" });
  }
  return {
    valid: fields.length === 0,
    fields,
    value: {
      runId, resumeToken, decision: input.decision,
      reviewerEvidence: { token: reviewerToken },
      ...(input.reason === undefined ? {} : { reason: input.reason.trim() }),
      ...(input.editedPayload === undefined ? {} : { editedPayload: input.editedPayload }),
    },
  };
}

export function createFunctionCallingResumeHandler({ secret, functionCallingManager, now } = {}) {
  const configured = Boolean(functionCallingManager && typeof functionCallingManager.resume === "function"
    && functionCallingManager.stats?.().configured);
  return async function resumeFunctionCall(request = {}) {
    if (!secret) return json(501, { error: "auth not configured" });
    const verdict = verifySessionToken(bearer(request.headers), secret, { now });
    if (!verdict.valid) return json(401, { error: "unauthorized" });
    if (!configured) return json(501, { error: "function calling not configured" });
    const validated = validateResumeBody(request.body);
    if (!validated.valid) return json(400, { error: "invalid request", fields: validated.fields });
    const result = await functionCallingManager.resume(validated.value);
    return json(result.status === "completed" ? 200 : result.status === "paused" ? 202 : 409, result);
  };
}

export const FUNCTION_CALLING_REQUEST_BOUNDS = Object.freeze({ PROMPT_MAX, RUN_ID_MAX });
