import { createFunctionExecutionReceiptRuntime } from "./function-execution-receipts.js";
import {
  createKnowgrphGuardrailEvaluator,
  KNOWGRPH_FUNCTION_TOOL_NAMES,
  KNOWGRPH_TOOL_RECORDS,
  parseKnowgrphFunctionToolAllowlist,
} from "./knowgrph-function-tools.js";

export {
  createKnowgrphGuardrailEvaluator,
  KNOWGRPH_FUNCTION_TOOL_NAMES,
  parseKnowgrphFunctionToolAllowlist,
};

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
  toolRecords = KNOWGRPH_TOOL_RECORDS,
} = {}) {
  const sourceRecords = toolRecords && typeof toolRecords === "object" && !Array.isArray(toolRecords)
    ? toolRecords
    : KNOWGRPH_TOOL_RECORDS;
  const allowed = new Set(allowedToolNames.filter((name) => Object.hasOwn(sourceRecords, name)));
  const reviewRequired = new Set([
    ...[...allowed].filter((name) => sourceRecords[name].approvalRequired === true),
    ...reviewRequiredToolNames.filter((name) => allowed.has(name)),
  ]);
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
