import { createFunctionExecutionReceiptRuntime } from "./function-execution-receipts.js";

const STATUS_TOOL_NAME = "read_agentic_os_status";
const STATUS_MCP_TOOL_NAME = "knowgrph.os.status";
const STATUS_INPUT_GUARDRAIL = "knowgrph-status-tool-input";
const STATUS_OUTPUT_GUARDRAIL = "knowgrph-status-tool-output";
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
    revision: "knowgrph-status-function/v1",
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
    mapOutput: (payload, argumentsValue) => statusOutput(payload, argumentsValue.view),
    inputGuardrails: Object.freeze([{ name: STATUS_INPUT_GUARDRAIL, stage: "tool-input" }]),
    outputGuardrails: Object.freeze([{ name: STATUS_OUTPUT_GUARDRAIL, stage: "tool-output" }]),
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

function blocked(reasonCode, message, details = {}) {
  return {
    status: "blocked",
    reasonCode,
    message,
    costLog: zeroGatewayCost(),
    ...(typeof details.reviewStateConsumed === "boolean"
      ? { reviewStateConsumed: details.reviewStateConsumed }
      : {}),
    ...(details.retryable === true ? { retryable: true } : {}),
    ...(details.executionReceipt ? { executionReceipt: details.executionReceipt } : {}),
  };
}

export function createKnowgrphGuardrailEvaluator() {
  return async function evaluate({ guardrail, stage, value }) {
    if (guardrail?.name === STATUS_INPUT_GUARDRAIL && stage === "tool-input") {
      return Object.freeze({
        passed: validStatusArguments(value),
        reasonCode: "tool_arguments_invalid",
        message: "Knowgrph status arguments failed the application guardrail.",
      });
    }
    if (guardrail?.name === STATUS_OUTPUT_GUARDRAIL && stage === "tool-output") {
      return Object.freeze({
        passed: validStatusOutput(value),
        reasonCode: "tool_output_invalid",
        message: "Knowgrph status output failed the application guardrail.",
      });
    }
    return Object.freeze({
      passed: false,
      reasonCode: "guardrail_unknown",
      message: "The application guardrail is not registered.",
    });
  };
}

function guardrailOwner(value) {
  return value && typeof value.validate === "function"
    && typeof value.requestReview === "function"
    && typeof value.resolveReview === "function";
}

export function createKnowgrphFunctionGateway({
  mcpClient,
  allowedToolNames = [],
  reviewRequiredToolNames = [],
  guardrailsHumanReview,
  executionReceiptStore,
  toolRecords = TOOL_RECORDS,
} = {}) {
  const sourceRecords = toolRecords && typeof toolRecords === "object" && !Array.isArray(toolRecords)
    ? toolRecords
    : TOOL_RECORDS;
  const allowed = new Set(allowedToolNames.filter((name) => Object.hasOwn(sourceRecords, name)));
  const reviewRequired = new Set(
    reviewRequiredToolNames.filter((name) => allowed.has(name) && Object.hasOwn(sourceRecords, name)),
  );
  const records = Object.freeze(Object.fromEntries([...allowed].map((name) => [
    name,
    reviewRequired.has(name)
      ? Object.freeze({ ...sourceRecords[name], approvalRequired: true })
      : sourceRecords[name],
  ])));
  const tools = Object.freeze([...allowed].sort().map((name) => records[name]));
  const executionReceipts = createFunctionExecutionReceiptRuntime({
    ...(executionReceiptStore ? { executionReceiptStore } : {}),
  });
  const configured = Boolean(
    mcpClient
    && typeof mcpClient.callTool === "function"
    && tools.length > 0
    && guardrailOwner(guardrailsHumanReview),
  );
  let attemptedCalls = 0;
  let completedCalls = 0;
  let blockedCalls = 0;
  let inputGuardrailChecks = 0;
  let outputGuardrailChecks = 0;
  let reviewPauses = 0;
  let reviewResolutions = 0;
  let receiptReplays = 0;

  async function validateStage(call, record, stage, value) {
    const guardrails = stage === "tool-input" ? record.inputGuardrails : record.outputGuardrails;
    if (!guardrailOwner(guardrailsHumanReview)) {
      return { status: "blocked", reasonCode: "tool_guardrail_unconfigured", message: "Tool guardrails are not configured." };
    }
    if (stage === "tool-input") inputGuardrailChecks += guardrails.length;
    else outputGuardrailChecks += guardrails.length;
    return guardrailsHumanReview.validate({
      runId: call.runId,
      conversationId: call.conversationId || call.runId,
      agent: call.agent || { agentId: "function-calling-runtime", revision: "function-calling-runtime/v1" },
      stage,
      guardrails,
      value,
      tool: { callId: call.callId, name: call.name, riskClass: record.riskClass },
    });
  }

  async function approvedArguments(call, record, argumentsValue, preparedReceipt) {
    if (!record.approvalRequired) return { status: "approved", arguments: argumentsValue };
    if (preparedReceipt?.status === "authorized") {
      return { status: "approved", arguments: preparedReceipt.arguments, receiptAuthorized: true };
    }
    if (!call.review) {
      reviewPauses += 1;
      const paused = await guardrailsHumanReview.requestReview({
        runId: call.runId,
        conversationId: call.conversationId || call.runId,
        agent: call.agent || { agentId: "function-calling-runtime", revision: "function-calling-runtime/v1" },
        action: {
          actionId: call.callId,
          kind: "function-tool",
          name: call.name,
          riskClass: record.riskClass,
          payload: argumentsValue,
        },
        message: `Review function ${call.name} before execution.`,
      });
      return { ...paused, costLog: zeroGatewayCost() };
    }
    const resolution = await guardrailsHumanReview.resolveReview(call.review);
    reviewResolutions += 1;
    const expectedConversationId = call.conversationId || call.runId;
    if (resolution.audit
      && (resolution.audit.runId !== call.runId || resolution.audit.conversationId !== expectedConversationId)) {
      return blocked("tool_review_run_mismatch", `Function ${call.name} review belongs to another run or conversation.`, {
        reviewStateConsumed: resolution.stateConsumed,
      });
    }
    if (resolution.status === "rejected") {
      return blocked("tool_review_rejected", `Function ${call.name} was rejected by the reviewer.`, {
        reviewStateConsumed: resolution.stateConsumed,
        reviewAudit: resolution.audit,
      });
    }
    if (resolution.status !== "approved") {
      return blocked(resolution.reasonCode || "tool_review_blocked", `Function ${call.name} review did not authorize execution.`, {
        reviewStateConsumed: resolution.stateConsumed,
      });
    }
    if (resolution.action.actionId !== call.callId || resolution.action.name !== call.name) {
      return blocked("tool_review_action_mismatch", `Function ${call.name} review action does not match the call.`, {
        reviewStateConsumed: resolution.stateConsumed,
      });
    }
    if (!resolution.requiresValidation) {
      return { status: "approved", arguments: resolution.action.payload, reviewAudit: resolution.audit };
    }
    const edited = await validateStage(call, record, "tool-input", resolution.action.payload);
    if (edited.status !== "passed") {
      return blocked(edited.reasonCode || "tool_arguments_invalid", edited.message || "Edited arguments failed validation.");
    }
    return { status: "approved", arguments: edited.value, reviewAudit: resolution.audit };
  }

  async function completedOutput(call, record, output, executionReceipt) {
    const guardedOutput = await validateStage(call, record, "tool-output", output);
    if (guardedOutput.status !== "passed") {
      blockedCalls += 1;
      return blocked(
        guardedOutput.reasonCode || "tool_output_invalid",
        guardedOutput.message || `Function ${call.name} output was blocked.`,
        { executionReceipt },
      );
    }
    completedCalls += 1;
    return {
      status: "completed",
      output: guardedOutput.value,
      costLog: zeroGatewayCost(),
      ...(executionReceipt ? { executionReceipt } : {}),
    };
  }

  async function releaseExecution(executionClaim) {
    if (!executionClaim) return false;
    try {
      return await executionReceipts.release(executionClaim.fence);
    } catch {
      return false;
    }
  }

  async function callTool(call) {
    attemptedCalls += 1;
    const record = records[call.name];
    if (!record || !allowed.has(call.name)) {
      blockedCalls += 1;
      return blocked("tool_not_allowlisted", `Function ${call.name} is not enabled by the Knowgrph gateway.`);
    }
    if (call.caller?.type !== "direct"
      || call.policy?.revision !== record.revision
      || call.policy?.riskClass !== record.riskClass
      || call.policy?.idempotent !== record.idempotent
      || call.policy?.approvalRequired !== record.approvalRequired) {
      blockedCalls += 1;
      return blocked("tool_policy_mismatch", `Function ${call.name} policy does not match the gateway registry.`);
    }
    const guardedInput = await validateStage(call, record, "tool-input", call.arguments);
    if (guardedInput.status !== "passed") {
      blockedCalls += 1;
      return blocked(guardedInput.reasonCode || "tool_arguments_invalid", guardedInput.message || `Function ${call.name} input was blocked.`);
    }
    let preparedReceipt;
    if (record.approvalRequired) {
      try {
        preparedReceipt = await executionReceipts.prepare({
          runId: call.runId,
          callId: call.callId,
          toolName: call.name,
          toolRevision: record.revision,
          riskClass: record.riskClass,
          arguments: guardedInput.value,
          requiresUpstreamReceipt: record.riskClass !== "read-only",
        });
      } catch {
        blockedCalls += 1;
        return blocked("execution_receipt_failed", `Function ${call.name} execution receipt could not be prepared.`);
      }
      if (preparedReceipt.status === "blocked") {
        blockedCalls += 1;
        return blocked(preparedReceipt.reasonCode, preparedReceipt.message, {
          retryable: preparedReceipt.retryable,
        });
      }
      if (preparedReceipt.status === "completed") {
        receiptReplays += 1;
        return completedOutput(call, record, preparedReceipt.output, preparedReceipt.evidence);
      }
    }
    let approval;
    try {
      approval = await approvedArguments(call, record, guardedInput.value, preparedReceipt);
    } catch {
      blockedCalls += 1;
      return blocked("tool_review_failed", `Function ${call.name} review state failed at the gateway boundary.`);
    }
    if (approval.status === "paused") return {
      ...approval,
      ...(preparedReceipt ? { executionReceipt: preparedReceipt.evidence } : {}),
    };
    if (approval.status !== "approved") {
      if (approval.reasonCode === "tool_review_rejected" && preparedReceipt) {
        try {
          await executionReceipts.abandon(preparedReceipt);
        } catch {
          blockedCalls += 1;
          return blocked("execution_receipt_cleanup_failed", `Function ${call.name} rejected receipt could not be removed.`);
        }
      }
      blockedCalls += 1;
      return approval;
    }
    if (preparedReceipt?.status === "reserved") {
      try {
        preparedReceipt = await executionReceipts.authorize(preparedReceipt, {
          arguments: approval.arguments,
          reviewAudit: approval.reviewAudit,
        });
      } catch {
        blockedCalls += 1;
        return blocked("execution_receipt_authorization_failed", `Function ${call.name} authorization was not persisted.`);
      }
      if (preparedReceipt.status === "blocked") {
        blockedCalls += 1;
        return blocked(preparedReceipt.reasonCode, preparedReceipt.message, {
          retryable: preparedReceipt.retryable,
        });
      }
    }
    let executionClaim;
    if (preparedReceipt) {
      try {
        executionClaim = await executionReceipts.claim(preparedReceipt);
      } catch {
        blockedCalls += 1;
        return blocked("execution_receipt_claim_failed", `Function ${call.name} execution receipt could not be claimed.`, {
          retryable: true,
          executionReceipt: preparedReceipt.evidence,
        });
      }
      if (executionClaim.status === "completed") {
        receiptReplays += 1;
        return completedOutput(call, record, executionClaim.output, executionClaim.evidence);
      }
      if (executionClaim.status === "blocked") {
        blockedCalls += 1;
        return blocked(executionClaim.reasonCode, executionClaim.message, {
          retryable: executionClaim.retryable,
          executionReceipt: preparedReceipt.evidence,
        });
      }
    }
    const executionArguments = executionClaim?.arguments || approval.arguments;
    try {
      const payload = await mcpClient.callTool(
        record.mcpToolName,
        executionArguments,
        executionClaim ? { execution: executionClaim.execution } : undefined,
      );
      if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.ok !== true) {
        await releaseExecution(executionClaim);
        blockedCalls += 1;
        return blocked("tool_upstream_blocked", `Knowgrph blocked function ${call.name}.`, {
          retryable: Boolean(executionClaim),
          executionReceipt: preparedReceipt?.evidence,
        });
      }
      const output = typeof record.mapOutput === "function"
        ? record.mapOutput(payload, executionArguments)
        : null;
      if (!output) {
        await releaseExecution(executionClaim);
        blockedCalls += 1;
        return blocked("tool_output_invalid", `Function ${call.name} produced an invalid strict output.`, {
          retryable: Boolean(executionClaim),
          executionReceipt: preparedReceipt?.evidence,
        });
      }
      const guardedOutput = await validateStage(call, record, "tool-output", output);
      if (guardedOutput.status !== "passed") {
        await releaseExecution(executionClaim);
        blockedCalls += 1;
        return blocked(
          guardedOutput.reasonCode || "tool_output_invalid",
          guardedOutput.message || `Function ${call.name} output was blocked.`,
          { retryable: Boolean(executionClaim), executionReceipt: preparedReceipt?.evidence },
        );
      }
      let executionReceipt;
      if (executionClaim) {
        const settled = await executionReceipts.complete(executionClaim.fence, {
          output: guardedOutput.value,
          upstreamReceipt: payload.execution_receipt,
        });
        if (settled.status === "blocked") {
          await releaseExecution(executionClaim);
          blockedCalls += 1;
          return blocked(settled.reasonCode, settled.message, {
            retryable: settled.retryable,
            executionReceipt: preparedReceipt.evidence,
          });
        }
        executionReceipt = settled.evidence;
      }
      completedCalls += 1;
      return {
        status: "completed", output: guardedOutput.value, costLog: zeroGatewayCost(),
        ...(executionReceipt ? { executionReceipt } : {}),
      };
    } catch {
      await releaseExecution(executionClaim);
      blockedCalls += 1;
      return blocked("tool_gateway_failed", `Knowgrph function ${call.name} failed at the gateway boundary.`, {
        retryable: Boolean(executionClaim),
        executionReceipt: preparedReceipt?.evidence,
      });
    }
  }

  return Object.freeze({
    configured,
    tools,
    callTool,
    stats: () => Object.freeze({
      configured,
      allowedToolNames: Object.freeze(tools.map((tool) => tool.name)),
      reviewRequiredToolNames: Object.freeze([...reviewRequired].sort()),
      attemptedCalls,
      completedCalls,
      blockedCalls,
      inputGuardrailChecks,
      outputGuardrailChecks,
      reviewPauses,
      reviewResolutions,
      receiptReplays,
      executionReceipts: executionReceipts.stats(),
    }),
  });
}

export const KNOWGRPH_FUNCTION_TOOL_NAMES = Object.freeze({ status: STATUS_TOOL_NAME });
