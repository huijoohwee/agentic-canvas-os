const STATUS_TOOL_NAME = "read_agentic_os_status";
const RUN_NOTE_TOOL_NAME = "update_agent_run_note";
const STATUS_INPUT_GUARDRAIL = "knowgrph-status-tool-input";
const STATUS_OUTPUT_GUARDRAIL = "knowgrph-status-tool-output";
const RUN_NOTE_INPUT_GUARDRAIL = "knowgrph-run-note-tool-input";
const RUN_NOTE_OUTPUT_GUARDRAIL = "knowgrph-run-note-tool-output";

const STATUS_VIEWS = Object.freeze([
  "process_list",
  "capabilities",
  "cost_summary",
  "gate_catalog",
  "circuit_breakers",
]);

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function validStatusArguments(value) {
  return exactKeys(value, ["view"]) && STATUS_VIEWS.includes(value.view);
}

function validStatusOutput(value) {
  return exactKeys(value, ["ok", "view", "entry_ids", "unavailable_source_count", "estimated_cost_usd"])
    && typeof value.ok === "boolean"
    && STATUS_VIEWS.includes(value.view)
    && Array.isArray(value.entry_ids)
    && value.entry_ids.every((entry) => typeof entry === "string")
    && Number.isInteger(value.unavailable_source_count)
    && value.unavailable_source_count >= 0
    && Number.isFinite(value.estimated_cost_usd)
    && value.estimated_cost_usd >= 0;
}

function validRunNoteArguments(value) {
  return exactKeys(value, ["run_id", "note"])
    && typeof value.run_id === "string"
    && value.run_id === value.run_id.trim()
    && value.run_id.length >= 1
    && value.run_id.length <= 128
    && typeof value.note === "string"
    && value.note === value.note.trim()
    && value.note.length >= 1
    && value.note.length <= 2000;
}

function validRunNoteOutput(value) {
  return exactKeys(value, ["ok", "run_id", "note", "revision"])
    && value.ok === true
    && typeof value.run_id === "string"
    && typeof value.note === "string"
    && Number.isInteger(value.revision)
    && value.revision >= 1;
}

const GUARDRAIL_CHECKS = Object.freeze({
  [`${STATUS_INPUT_GUARDRAIL}:tool-input`]: Object.freeze([validStatusArguments, "tool_arguments_invalid", "Knowgrph status arguments failed the application guardrail."]),
  [`${STATUS_OUTPUT_GUARDRAIL}:tool-output`]: Object.freeze([validStatusOutput, "tool_output_invalid", "Knowgrph status output failed the application guardrail."]),
  [`${RUN_NOTE_INPUT_GUARDRAIL}:tool-input`]: Object.freeze([validRunNoteArguments, "tool_arguments_invalid", "Knowgrph run-note arguments failed the application guardrail."]),
  [`${RUN_NOTE_OUTPUT_GUARDRAIL}:tool-output`]: Object.freeze([validRunNoteOutput, "tool_output_invalid", "Knowgrph run-note output failed the application guardrail."]),
});

function entryId(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "";
  return cleanText(entry.toolId || entry.gateId || entry.harness || entry.sourceRef);
}

function statusOutput(payload, expectedView) {
  const entries = [
    ...(Array.isArray(payload.entries) ? payload.entries : []),
    ...(Array.isArray(payload.gates) ? payload.gates : []),
    ...(Array.isArray(payload.breakers) ? payload.breakers : []),
  ];
  const upstreamView = cleanText(payload.view);
  const upstreamCost = payload.cost_log;
  const tokenFields = ["prompt_tokens", "completion_tokens", "cache_hits"];
  if (upstreamView !== expectedView
    || !upstreamCost || typeof upstreamCost !== "object" || Array.isArray(upstreamCost)
    || upstreamCost.model !== "none" || upstreamCost.estimated_cost_usd !== 0
    || tokenFields.some((field) => upstreamCost[field] !== 0)) return null;
  return {
    ok: payload.ok === true,
    view: upstreamView,
    entry_ids: [...new Set(entries.map(entryId).filter(Boolean))].sort(),
    unavailable_source_count: Array.isArray(payload.unavailableSources) ? payload.unavailableSources.length : 0,
    estimated_cost_usd: 0,
  };
}

function runNoteOutput(payload, expectedArguments) {
  const exactPayload = exactKeys(payload, ["ok", "run_id", "note", "revision"])
    || exactKeys(payload, ["ok", "run_id", "note", "revision", "execution_receipt"]);
  if (!exactPayload || payload.ok !== true
    || payload.run_id !== expectedArguments.run_id
    || payload.note !== expectedArguments.note
    || !Number.isInteger(payload.revision)
    || payload.revision < 1) return null;
  return {
    ok: true,
    run_id: payload.run_id,
    note: payload.note,
    revision: payload.revision,
  };
}

const statusParameters = Object.freeze({
  type: "object",
  properties: { view: { type: "string", enum: STATUS_VIEWS } },
  required: ["view"],
  additionalProperties: false,
});

const statusOutputSchema = Object.freeze({
  type: "object",
  properties: {
    ok: { type: "boolean" },
    view: { type: "string", enum: STATUS_VIEWS },
    entry_ids: { type: "array", items: { type: "string" } },
    unavailable_source_count: { type: "integer" },
    estimated_cost_usd: { type: "number" },
  },
  required: ["ok", "view", "entry_ids", "unavailable_source_count", "estimated_cost_usd"],
  additionalProperties: false,
});

const runNoteParameters = Object.freeze({
  type: "object",
  properties: {
    run_id: { type: "string", minLength: 1, maxLength: 128 },
    note: { type: "string", minLength: 1, maxLength: 2000 },
  },
  required: ["run_id", "note"],
  additionalProperties: false,
});

const runNoteOutputSchema = Object.freeze({
  type: "object",
  properties: {
    ok: { type: "boolean", const: true },
    run_id: { type: "string" },
    note: { type: "string" },
    revision: { type: "integer", minimum: 1 },
  },
  required: ["ok", "run_id", "note", "revision"],
  additionalProperties: false,
});

export const KNOWGRPH_TOOL_RECORDS = Object.freeze({
  [STATUS_TOOL_NAME]: Object.freeze({
    type: "function",
    name: STATUS_TOOL_NAME,
    revision: "knowgrph-status-function/v1",
    description: "Read one existing Knowgrph Agentic OS status view without mutating state or invoking a model-bearing tool.",
    parameters: statusParameters,
    strict: true,
    outputSchema: statusOutputSchema,
    allowedCallers: Object.freeze(["direct"]),
    riskClass: "read-only",
    idempotent: true,
    approvalRequired: false,
    validateArguments: validStatusArguments,
    validateOutput: validStatusOutput,
    mapOutput: (payload, argumentsValue) => statusOutput(payload, argumentsValue.view),
    inputGuardrails: Object.freeze([{ name: STATUS_INPUT_GUARDRAIL, stage: "tool-input" }]),
    outputGuardrails: Object.freeze([{ name: STATUS_OUTPUT_GUARDRAIL, stage: "tool-output" }]),
    mcpToolName: "knowgrph.os.status",
  }),
  [RUN_NOTE_TOOL_NAME]: Object.freeze({
    type: "function",
    name: RUN_NOTE_TOOL_NAME,
    revision: "knowgrph-run-note-function/v1",
    description: "Replace the operator note on one persisted Knowgrph run after human review.",
    parameters: runNoteParameters,
    strict: true,
    outputSchema: runNoteOutputSchema,
    allowedCallers: Object.freeze(["direct"]),
    riskClass: "mutation",
    idempotent: true,
    approvalRequired: true,
    validateArguments: validRunNoteArguments,
    validateOutput: validRunNoteOutput,
    mapOutput: runNoteOutput,
    inputGuardrails: Object.freeze([{ name: RUN_NOTE_INPUT_GUARDRAIL, stage: "tool-input" }]),
    outputGuardrails: Object.freeze([{ name: RUN_NOTE_OUTPUT_GUARDRAIL, stage: "tool-output" }]),
    mcpToolName: "knowgrph.run_manifest.note.update",
  }),
});

export function parseKnowgrphFunctionToolAllowlist(value) {
  const names = [...new Set(cleanText(value).split(",").map(cleanText).filter(Boolean))];
  return Object.freeze(names.filter((name) => Object.hasOwn(KNOWGRPH_TOOL_RECORDS, name)));
}

export function createKnowgrphGuardrailEvaluator() {
  return async function evaluate({ guardrail, stage, value }) {
    const check = GUARDRAIL_CHECKS[`${guardrail?.name}:${stage}`];
    if (!check) return Object.freeze({
      passed: false,
      reasonCode: "guardrail_unknown",
      message: "The application guardrail is not registered.",
    });
    return Object.freeze({ passed: check[0](value), reasonCode: check[1], message: check[2] });
  };
}

export const KNOWGRPH_FUNCTION_TOOL_NAMES = Object.freeze({
  status: STATUS_TOOL_NAME,
  runNote: RUN_NOTE_TOOL_NAME,
});
