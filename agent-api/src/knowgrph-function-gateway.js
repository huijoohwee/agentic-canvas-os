const STATUS_TOOL_NAME = "read_agentic_os_status";
const STATUS_MCP_TOOL_NAME = "knowgrph.os.status";
const STATUS_VIEWS = Object.freeze([
  "process_list",
  "capabilities",
  "cost_summary",
  "gate_catalog",
  "circuit_breakers",
]);

const STATUS_PARAMETERS = Object.freeze({
  type: "object",
  properties: {
    view: { type: "string", enum: STATUS_VIEWS },
  },
  required: ["view"],
  additionalProperties: false,
});

const STATUS_OUTPUT = Object.freeze({
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

const TOOL_RECORDS = Object.freeze({
  [STATUS_TOOL_NAME]: Object.freeze({
    type: "function",
    name: STATUS_TOOL_NAME,
    description: "Read one existing Knowgrph Agentic OS status view without mutating state or invoking a model-bearing tool.",
    parameters: STATUS_PARAMETERS,
    strict: true,
    outputSchema: STATUS_OUTPUT,
    allowedCallers: Object.freeze(["direct"]),
    riskClass: "read-only",
    idempotent: true,
    approvalRequired: false,
    validateArguments: validStatusArguments,
    validateOutput: validStatusOutput,
    mcpToolName: STATUS_MCP_TOOL_NAME,
  }),
});

export function parseKnowgrphFunctionToolAllowlist(value) {
  const names = [...new Set(cleanText(value).split(",").map(cleanText).filter(Boolean))];
  return Object.freeze(names.filter((name) => Object.hasOwn(TOOL_RECORDS, name)));
}

function zeroGatewayCost() {
  return {
    model: "none",
    prompt_tokens: 0,
    completion_tokens: 0,
    cache_hits: 0,
    cached_tokens: 0,
    cache_write_tokens: 0,
    provider_cache_status: "unreported",
    estimated_cost_usd: 0,
  };
}

function approvedForTool(approvals, runId, name) {
  return approvals.some((approval) => approval
    && typeof approval === "object"
    && !Array.isArray(approval)
    && approval.type === "tool-call"
    && approval.runId === runId
    && approval.toolName === name
    && approval.decision === "approved");
}

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
  if (upstreamView !== expectedView) return null;
  const upstreamCost = payload.cost_log;
  const tokenFields = ["prompt_tokens", "completion_tokens", "cache_hits"];
  if (!upstreamCost || typeof upstreamCost !== "object" || Array.isArray(upstreamCost)
    || upstreamCost.model !== "none"
    || upstreamCost.estimated_cost_usd !== 0
    || tokenFields.some((field) => upstreamCost[field] !== 0)) {
    return null;
  }
  return {
    ok: payload.ok === true,
    view: upstreamView,
    entry_ids: [...new Set(entries.map(entryId).filter(Boolean))].sort(),
    unavailable_source_count: Array.isArray(payload.unavailableSources) ? payload.unavailableSources.length : 0,
    estimated_cost_usd: 0,
  };
}

function blocked(reasonCode, message) {
  return { status: "blocked", reasonCode, message, costLog: zeroGatewayCost() };
}

export function createKnowgrphFunctionGateway({ mcpClient, allowedToolNames = [] } = {}) {
  const allowed = new Set(allowedToolNames.filter((name) => Object.hasOwn(TOOL_RECORDS, name)));
  const tools = Object.freeze([...allowed].sort().map((name) => TOOL_RECORDS[name]));
  const configured = Boolean(mcpClient && typeof mcpClient.callTool === "function" && tools.length > 0);
  let attemptedCalls = 0;
  let completedCalls = 0;
  let blockedCalls = 0;

  async function callTool(call) {
    attemptedCalls += 1;
    const record = TOOL_RECORDS[call.name];
    if (!record || !allowed.has(call.name)) {
      blockedCalls += 1;
      return blocked("tool_not_allowlisted", `Function ${call.name} is not enabled by the Knowgrph gateway.`);
    }
    if (call.caller?.type !== "direct"
      || call.policy?.riskClass !== record.riskClass
      || call.policy?.idempotent !== record.idempotent
      || call.policy?.approvalRequired !== record.approvalRequired) {
      blockedCalls += 1;
      return blocked("tool_policy_mismatch", `Function ${call.name} policy does not match the gateway registry.`);
    }
    if (record.approvalRequired && !approvedForTool(call.approvals, call.runId, call.name)) {
      blockedCalls += 1;
      return blocked("tool_approval_required", `Function ${call.name} requires an exact approved grant.`);
    }
    if (!record.validateArguments(call.arguments)) {
      blockedCalls += 1;
      return blocked("tool_arguments_invalid", `Function ${call.name} arguments failed gateway validation.`);
    }
    try {
      const payload = await mcpClient.callTool(record.mcpToolName, call.arguments);
      if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.ok !== true) {
        blockedCalls += 1;
        return blocked("tool_upstream_blocked", `Knowgrph blocked function ${call.name}.`);
      }
      const output = statusOutput(payload, call.arguments.view);
      if (!output || !record.validateOutput(output)) {
        blockedCalls += 1;
        return blocked("tool_output_invalid", `Function ${call.name} produced an invalid strict output.`);
      }
      completedCalls += 1;
      return { status: "completed", output, costLog: zeroGatewayCost() };
    } catch {
      blockedCalls += 1;
      return blocked("tool_gateway_failed", `Knowgrph function ${call.name} failed at the gateway boundary.`);
    }
  }

  return Object.freeze({
    configured,
    tools,
    callTool,
    stats: () => Object.freeze({
      configured,
      allowedToolNames: Object.freeze(tools.map((tool) => tool.name)),
      attemptedCalls,
      completedCalls,
      blockedCalls,
    }),
  });
}

export const KNOWGRPH_FUNCTION_TOOL_NAMES = Object.freeze({ status: STATUS_TOOL_NAME });
