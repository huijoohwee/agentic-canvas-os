import { verifySessionToken } from "./auth.js";

const PROMPT_MAX = 8_000;
const RUN_ID_MAX = 128;
const APPROVALS_MAX = 32;

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
  const approvals = input.approvals === undefined ? [] : input.approvals;
  const parallelToolCalls = input.parallelToolCalls === undefined ? false : input.parallelToolCalls;
  const names = new Set(tools.map((tool) => tool.name));
  const choice = toolChoice(input.toolChoice, names);
  const fields = [];
  if (!runId || runId.length > RUN_ID_MAX) fields.push({ field: "runId", reason: `required, at most ${RUN_ID_MAX} characters` });
  if (!prompt || prompt.length > PROMPT_MAX) fields.push({ field: "prompt", reason: `required, at most ${PROMPT_MAX} characters` });
  if (!Array.isArray(approvals) || approvals.length > APPROVALS_MAX) {
    fields.push({ field: "approvals", reason: `must contain at most ${APPROVALS_MAX} entries` });
  }
  if (typeof parallelToolCalls !== "boolean") fields.push({ field: "parallelToolCalls", reason: "must be boolean" });
  if (!choice) fields.push({ field: "toolChoice", reason: "must reference only enabled application functions" });
  return {
    valid: fields.length === 0,
    fields,
    value: { runId, prompt, approvals, parallelToolCalls, toolChoice: choice },
  };
}

export function createFunctionCallingHandler({ secret, functionCalling, tools = [], capabilities, now } = {}) {
  const runtimeStats = functionCalling && typeof functionCalling.stats === "function" ? functionCalling.stats() : {};
  const configured = Boolean(functionCalling && typeof functionCalling.run === "function"
    && runtimeStats.adapterConfigured && runtimeStats.toolGatewayConfigured && tools.length > 0 && capabilities);
  return async function functionCall(request = {}) {
    if (!secret) return json(501, { error: "auth not configured" });
    const verdict = verifySessionToken(bearer(request.headers), secret, { now });
    if (!verdict.valid) return json(401, { error: "unauthorized" });
    if (!configured) return json(501, { error: "function calling not configured" });
    const validated = validateBody(request.body, tools);
    if (!validated.valid) return json(400, { error: "invalid request", fields: validated.fields });
    const result = await functionCalling.run({
      runId: validated.value.runId,
      input: { prompt: validated.value.prompt },
      tools,
      capabilities,
      toolChoice: validated.value.toolChoice,
      parallelToolCalls: validated.value.parallelToolCalls,
      approvals: validated.value.approvals,
    });
    return json(result.status === "completed" ? 200 : 409, result);
  };
}

export const FUNCTION_CALLING_REQUEST_BOUNDS = Object.freeze({ PROMPT_MAX, RUN_ID_MAX, APPROVALS_MAX });
