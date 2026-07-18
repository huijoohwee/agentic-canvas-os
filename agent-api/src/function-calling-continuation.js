import { createHash } from "node:crypto";

import { normalizeJson, serializedJsonLength } from "./json-contract.js";
import { assertIdentifier, FunctionCallingBlock, normalizeCostLog } from "./function-calling-runtime-support.js";

const CONTINUATION_SCHEMA = "function-calling-continuation/v1";
const MAX_CONTINUATION_CHARS = 450_000;

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function nonNegativeInteger(value, field) {
  if (!Number.isInteger(value) || value < 0) throw new TypeError(`${field} must be a non-negative integer.`);
  return value;
}

function uniqueIdentifiers(value, field) {
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array.`);
  const identifiers = value.map((entry, index) => assertIdentifier(entry, `${field}[${index}]`));
  if (new Set(identifiers).size !== identifiers.length) throw new TypeError(`${field} must be unique.`);
  return Object.freeze(identifiers);
}

function serializableTool(tool) {
  return {
    type: tool.type,
    name: tool.name,
    revision: tool.revision,
    description: tool.description,
    parameters: tool.parameters,
    strict: tool.strict,
    outputSchema: tool.outputSchema,
    allowedCallers: tool.allowedCallers,
    riskClass: tool.riskClass,
    idempotent: tool.idempotent,
    approvalRequired: tool.approvalRequired,
  };
}

export function functionToolFingerprint(tools) {
  return createHash("sha256").update(JSON.stringify(tools.map(serializableTool))).digest("hex");
}

export function createFunctionContinuationState(value) {
  const state = normalizeJson({ schema: CONTINUATION_SCHEMA, ...value }, "continuationState");
  if (serializedJsonLength(state) > MAX_CONTINUATION_CHARS) {
    throw new FunctionCallingBlock("continuation_state_limit", "Function-calling continuation state is too large.");
  }
  return Object.freeze(state);
}

export function restoreFunctionContinuationState(value, { tools, maxModelTurns, maxToolCalls }) {
  const state = normalizeJson(value, "continuationState");
  const fields = [
    "schema", "runId", "toolFingerprint", "capabilities", "toolChoice", "parallelToolCalls",
    "previousResponseId", "reasoningItems", "pendingCall", "usedCallIds", "usedResponseIds",
    "usedToolNames", "modelCosts", "gatewayCosts", "providerAttempts", "gatewayAttempts",
    "runToolCalls", "executedRequiredCall", "nextTurn",
  ];
  if (!exactKeys(state, fields) || state.schema !== CONTINUATION_SCHEMA) {
    throw new FunctionCallingBlock("continuation_state_invalid", "Function-calling continuation state is invalid.");
  }
  if (serializedJsonLength(state) > MAX_CONTINUATION_CHARS) {
    throw new FunctionCallingBlock("continuation_state_limit", "Function-calling continuation state is too large.");
  }
  if (state.toolFingerprint !== functionToolFingerprint(tools)) {
    throw new FunctionCallingBlock("continuation_tool_drift", "Function definitions changed while the run was paused.");
  }
  if (typeof state.parallelToolCalls !== "boolean" || typeof state.executedRequiredCall !== "boolean") {
    throw new FunctionCallingBlock("continuation_state_invalid", "Function-calling continuation flags are invalid.");
  }
  if (!Array.isArray(state.reasoningItems) || !Array.isArray(state.modelCosts) || !Array.isArray(state.gatewayCosts)) {
    throw new FunctionCallingBlock("continuation_state_invalid", "Function-calling continuation arrays are invalid.");
  }
  const pending = state.pendingCall;
  if (!exactKeys(pending, ["callId", "name", "arguments", "reviewState"])) {
    throw new FunctionCallingBlock("continuation_state_invalid", "Pending function call state is invalid.");
  }
  const pendingCall = Object.freeze({
    callId: assertIdentifier(pending.callId, "continuationState.pendingCall.callId"),
    name: assertIdentifier(pending.name, "continuationState.pendingCall.name"),
    arguments: normalizeJson(pending.arguments, "continuationState.pendingCall.arguments"),
    reviewState: normalizeJson(pending.reviewState, "continuationState.pendingCall.reviewState"),
  });
  if (!pendingCall.arguments || typeof pendingCall.arguments !== "object" || Array.isArray(pendingCall.arguments)
    || !pendingCall.reviewState || typeof pendingCall.reviewState !== "object" || Array.isArray(pendingCall.reviewState)) {
    throw new FunctionCallingBlock("continuation_state_invalid", "Pending function arguments or review state are invalid.");
  }
  const tool = tools.find((candidate) => candidate.name === pendingCall.name);
  if (!tool || !tool.approvalRequired || !tool.idempotent) {
    throw new FunctionCallingBlock("continuation_tool_unavailable", "Pending function is not resumable under current policy.");
  }
  const usedCallIds = uniqueIdentifiers(state.usedCallIds, "continuationState.usedCallIds");
  const usedResponseIds = uniqueIdentifiers(state.usedResponseIds, "continuationState.usedResponseIds");
  const usedToolNames = uniqueIdentifiers(state.usedToolNames, "continuationState.usedToolNames");
  const previousResponseId = assertIdentifier(state.previousResponseId, "continuationState.previousResponseId");
  if (!usedCallIds.includes(pendingCall.callId) || !usedResponseIds.includes(previousResponseId)) {
    throw new FunctionCallingBlock("continuation_identity_mismatch", "Pending call and response identities are inconsistent.");
  }
  const providerAttempts = nonNegativeInteger(state.providerAttempts, "continuationState.providerAttempts");
  const gatewayAttempts = nonNegativeInteger(state.gatewayAttempts, "continuationState.gatewayAttempts");
  const runToolCalls = nonNegativeInteger(state.runToolCalls, "continuationState.runToolCalls");
  if (runToolCalls < 1 || runToolCalls > maxToolCalls || providerAttempts !== state.modelCosts.length
    || gatewayAttempts !== state.gatewayCosts.length) {
    throw new FunctionCallingBlock("continuation_evidence_mismatch", "Continuation attempt evidence is inconsistent.");
  }
  if (!Number.isInteger(state.nextTurn) || state.nextTurn < 2 || state.nextTurn > maxModelTurns + 1) {
    throw new FunctionCallingBlock("continuation_state_invalid", "Continuation turn is outside configured bounds.");
  }
  return Object.freeze({
    runId: assertIdentifier(state.runId, "continuationState.runId"),
    toolFingerprint: state.toolFingerprint,
    capabilities: normalizeJson(state.capabilities, "continuationState.capabilities"),
    toolChoice: normalizeJson(state.toolChoice, "continuationState.toolChoice"),
    parallelToolCalls: state.parallelToolCalls,
    previousResponseId,
    reasoningItems: Object.freeze(state.reasoningItems.map((item, index) => normalizeJson(item, `continuationState.reasoningItems[${index}]`))),
    pendingCall,
    usedCallIds,
    usedResponseIds,
    usedToolNames,
    modelCosts: Object.freeze(state.modelCosts.map((cost) => normalizeCostLog(cost, "model"))),
    gatewayCosts: Object.freeze(state.gatewayCosts.map((cost) => normalizeCostLog(cost, "gateway"))),
    providerAttempts,
    gatewayAttempts,
    runToolCalls,
    executedRequiredCall: state.executedRequiredCall,
    nextTurn: state.nextTurn,
  });
}

export const FUNCTION_CONTINUATION_DEFAULTS = Object.freeze({ maxContinuationChars: MAX_CONTINUATION_CHARS });
