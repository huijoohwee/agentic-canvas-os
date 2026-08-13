import { normalizeJson, serializedJsonLength } from "./json-contract.js";
import {
  failSoftBranchFailure,
  failSoftFanOut,
  MAX_FAN_OUT_TIMEOUT_MS,
} from "../../src/fail-soft-fan-out.js";

const DEFAULT_MAX_MODEL_TURNS = 8;
const DEFAULT_MAX_TOOL_CALLS = 32;
const DEFAULT_MAX_PARALLEL_CALLS = 8;
const DEFAULT_MAX_PROGRAM_CHARS = 100_000;
const DEFAULT_MAX_TOOL_RESULT_CHARS = 200_000;
const DEFAULT_TIMEOUT_MS = 60_000;

const ALLOWED_CALLERS = new Set(["direct", "programmatic"]);
const CONTINUATION_MODES = new Set(["stored", "stateless"]);
const CLIENT_TOOL_TYPE = "function";
const READ_ONLY_RISK = "read-only";
const TOOL_FAILURE_SCHEMA = "programmatic-tool-call-failure/v1";
const TOOL_SETTLEMENT_SCHEMA = "programmatic-tool-settlement/v1";
const TOOL_AUTHORIZATION_SCHEMA = "programmatic-tool-authorization/v1";
const TOOL_INTEGRITY_BLOCK = Symbol("programmatic-tool-integrity-block");
const TOOL_INTEGRITY_REASON_CODES = new Set([
  "tool_approval_required",
  "tool_authorization_revoked",
  "tool_integrity_failed",
  "tool_policy_changed",
]);
const TOOL_FAILURE_REASON_CODES = Object.freeze([
  "tool_canceled",
  "tool_deadline_exceeded",
  "tool_failed",
  "tool_output_invalid",
  "tool_result_limit",
]);
const TOOL_FAILURE_OUTPUT_SCHEMA = normalizeJson({
  type: "object",
  additionalProperties: false,
  required: ["schema", "status", "reasonCode", "retryable"],
  properties: {
    schema: { enum: [TOOL_FAILURE_SCHEMA] },
    status: { enum: ["failed"] },
    reasonCode: { enum: TOOL_FAILURE_REASON_CODES },
    retryable: { enum: [false] },
  },
}, "toolFailureOutputSchema");

class RuntimeBlock extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = "RuntimeBlock";
    this.reasonCode = reasonCode;
  }
}

/**
 * Signal that an execution-time authorization or integrity fence failed.
 * This fixed-taxonomy block stops the whole batch; raw adapter text is never
 * accepted or projected into the run result.
 */
export function programmaticToolIntegrityBlock(reasonCode = "tool_integrity_failed") {
  return Object.freeze({
    [TOOL_INTEGRITY_BLOCK]: true,
    reasonCode: TOOL_INTEGRITY_REASON_CODES.has(reasonCode) ? reasonCode : "tool_integrity_failed",
  });
}

function toolIntegrityReason(error) {
  try {
    if (error?.[TOOL_INTEGRITY_BLOCK] === true) {
      return TOOL_INTEGRITY_REASON_CODES.has(error.reasonCode)
        ? error.reasonCode
        : "tool_integrity_failed";
    }
  } catch {
    // Hostile adapter values remain ordinary sanitized execution failures.
  }
  return null;
}

function assertPositiveInteger(value, field) {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${field} must be a positive integer.`);
  return value;
}

function assertTimeout(value) {
  assertPositiveInteger(value, "timeoutMs");
  if (value > MAX_FAN_OUT_TIMEOUT_MS) {
    throw new RangeError(`timeoutMs must be no greater than ${MAX_FAN_OUT_TIMEOUT_MS}.`);
  }
  return value;
}

function normalizeAbortSignal(signal) {
  if (signal === undefined) return undefined;
  try {
    if (
      signal
      && typeof signal === "object"
      && typeof signal.aborted === "boolean"
      && typeof signal.addEventListener === "function"
      && typeof signal.removeEventListener === "function"
    ) return signal;
  } catch {
    // A hostile signal-like object is rejected at the input boundary.
  }
  throw new TypeError("signal must be an AbortSignal when provided.");
}

function signalIsAborted(signal) {
  try {
    return signal?.aborted === true;
  } catch {
    throw new RuntimeBlock("signal_invalid", "Programmatic tool run signal could not be observed.");
  }
}

function assertIdentifier(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} must be a non-empty string.`);
  const normalized = value.trim();
  if (normalized.length > 512) throw new RangeError(`${field} exceeds 512 characters.`);
  return normalized;
}

function normalizeCapabilities(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("capabilities must be an object.");
  }
  const required = ["hostedSandbox", "previousResponseContinuation", "statelessReplay", "callerLineage"];
  for (const field of required) {
    if (typeof value[field] !== "boolean") throw new TypeError(`capabilities.${field} must be boolean.`);
  }
  return Object.freeze(Object.fromEntries(required.map((field) => [field, value[field]])));
}

function normalizeAllowedCallers(value, field) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${field} must be a non-empty array.`);
  const modes = [...new Set(value)];
  for (const mode of modes) {
    if (!ALLOWED_CALLERS.has(mode)) throw new TypeError(`${field} contains unsupported caller ${String(mode)}.`);
  }
  return Object.freeze(modes);
}

function normalizeContinuationMode(value) {
  if (!CONTINUATION_MODES.has(value)) {
    throw new TypeError("continuationMode must be stored or stateless.");
  }
  return value;
}

function normalizeObjectSchema(value, field) {
  const schema = normalizeJson(value, field);
  if (!schema || typeof schema !== "object" || Array.isArray(schema) || schema.type !== "object") {
    throw new TypeError(`${field} must be an object schema.`);
  }
  return schema;
}

function normalizeToolDefinitions(value) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError("tools must be a non-empty array.");
  const names = new Set();
  const tools = value.map((tool, index) => {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
      throw new TypeError(`tools[${index}] must be an object.`);
    }
    const name = assertIdentifier(tool.name, `tools[${index}].name`);
    if (names.has(name)) throw new TypeError(`Duplicate tool name: ${name}.`);
    names.add(name);
    if (tool.type !== CLIENT_TOOL_TYPE) {
      throw new TypeError(`tools[${index}].type must be ${CLIENT_TOOL_TYPE}.`);
    }
    const description = assertIdentifier(tool.description, `tools[${index}].description`);
    const allowedCallers = normalizeAllowedCallers(tool.allowedCallers, `tools[${index}].allowedCallers`);
    const riskClass = assertIdentifier(tool.riskClass, `tools[${index}].riskClass`);
    if (typeof tool.idempotent !== "boolean") throw new TypeError(`tools[${index}].idempotent must be boolean.`);
    if (typeof tool.approvalRequired !== "boolean") {
      throw new TypeError(`tools[${index}].approvalRequired must be boolean.`);
    }
    if (typeof tool.validateArguments !== "function" || typeof tool.validateOutput !== "function") {
      throw new TypeError(`tools[${index}] must provide argument and output validators.`);
    }
    return Object.freeze({
      name,
      type: CLIENT_TOOL_TYPE,
      description,
      allowedCallers,
      riskClass,
      idempotent: tool.idempotent,
      approvalRequired: tool.approvalRequired,
      inputSchema: normalizeObjectSchema(tool.inputSchema, `tools[${index}].inputSchema`),
      outputSchema: normalizeObjectSchema(tool.outputSchema, `tools[${index}].outputSchema`),
      validateArguments: tool.validateArguments,
      validateOutput: tool.validateOutput,
    });
  });
  return Object.freeze(tools);
}

function publicToolDeclarations(tools) {
  return Object.freeze(tools.map((tool) => Object.freeze({
    name: tool.name,
    type: tool.type,
    description: tool.description,
    allowedCallers: tool.allowedCallers,
    riskClass: tool.riskClass,
    idempotent: tool.idempotent,
    approvalRequired: tool.approvalRequired,
    inputSchema: tool.inputSchema,
    outputSchema: normalizeJson({
      type: "object",
      anyOf: [tool.outputSchema, TOOL_FAILURE_OUTPUT_SCHEMA],
    }, `tools.${tool.name}.publicOutputSchema`),
  })));
}

function normalizeCostLog(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RuntimeBlock("cost_log_missing", "Every hosted model turn must return a cost log.");
  }
  const model = assertIdentifier(value.model, "costLog.model");
  const integerFields = ["prompt_tokens", "completion_tokens", "cache_hits"];
  const result = { model };
  for (const field of integerFields) {
    if (!Number.isInteger(value[field]) || value[field] < 0) {
      throw new RuntimeBlock("cost_log_invalid", `costLog.${field} must be a non-negative integer.`);
    }
    result[field] = value[field];
  }
  if (!Number.isFinite(value.estimated_cost_usd) || value.estimated_cost_usd < 0) {
    throw new RuntimeBlock("cost_log_invalid", "costLog.estimated_cost_usd must be non-negative.");
  }
  result.estimated_cost_usd = value.estimated_cost_usd;
  return Object.freeze(result);
}

function aggregateCostLogs(logs, providerAttempts = logs.length) {
  const models = [...new Set(logs.map((log) => log.model))];
  return Object.freeze({
    model: models.length === 1 ? models[0] : "multiple",
    prompt_tokens: logs.reduce((sum, log) => sum + log.prompt_tokens, 0),
    completion_tokens: logs.reduce((sum, log) => sum + log.completion_tokens, 0),
    cache_hits: logs.reduce((sum, log) => sum + log.cache_hits, 0),
    estimated_cost_usd: logs.reduce((sum, log) => sum + log.estimated_cost_usd, 0),
    status: logs.length === providerAttempts ? "reported" : "partially-reported",
    reportedAttempts: logs.length,
    unreportedAttempts: providerAttempts - logs.length,
  });
}

function assertHostedAttestation(value) {
  const valid = value
    && value.executionOwner === "hosted-sandbox"
    && value.isolation === "fresh"
    && value.intermediateResultVisibility === "sandbox-only"
    && value.localCodeExecution === false;
  if (!valid) {
    throw new RuntimeBlock(
      "hosted_sandbox_unverified",
      "The downstream adapter did not attest fresh hosted execution and sandbox-only intermediate results.",
    );
  }
}

function normalizeResponse(response) {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new RuntimeBlock("provider_response_invalid", "Hosted program response must be an object.");
  }
  const responseId = assertIdentifier(response.responseId, "response.responseId");
  if (response.status !== "completed") {
    throw new RuntimeBlock("provider_response_incomplete", `Hosted program response ended with ${String(response.status)}.`);
  }
  if (!Array.isArray(response.items)) {
    throw new RuntimeBlock("provider_response_invalid", "Hosted program response items must be an array.");
  }
  assertHostedAttestation(response.runtimeAttestation);
  return Object.freeze({
    responseId,
    items: response.items,
    costLog: normalizeCostLog(response.costLog),
  });
}

function normalizeProgramCaller(value, field, programCallIds) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RuntimeBlock("caller_lineage_invalid", "Programmatic function call is missing program lineage.");
  }
  const caller = normalizeJson(value, field);
  if (caller.type !== "program" || typeof caller.callerId !== "string" || !programCallIds.has(caller.callerId)) {
    throw new RuntimeBlock("caller_lineage_invalid", "Programmatic function call has unknown program lineage.");
  }
  return caller;
}

function inspectItems(items, programCallIds, maxProgramChars) {
  const functionCalls = [];
  const replayItems = [];
  let message;
  let programCount = 0;
  let programChars = 0;
  for (const [index, item] of items.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new RuntimeBlock("provider_item_invalid", `response.items[${index}] must be an object.`);
    }
    const replayItem = normalizeJson(item, `response.items[${index}]`);
    replayItems.push(replayItem);
    if (item.type === "program") {
      const callId = assertIdentifier(item.callId, `response.items[${index}].callId`);
      if (typeof item.code !== "string" || !item.code.trim()) {
        throw new RuntimeBlock("program_invalid", "Hosted program code must be non-empty text.");
      }
      if (typeof item.fingerprint !== "string" || !item.fingerprint.trim()) {
        throw new RuntimeBlock("program_invalid", "Hosted program fingerprint must be non-empty text.");
      }
      programChars += item.code.length;
      if (programChars > maxProgramChars) {
        throw new RuntimeBlock("program_limit", `Hosted program exceeds ${maxProgramChars} characters.`);
      }
      programCallIds.add(callId);
      programCount += 1;
      continue;
    }
    if (item.type === "reasoning") continue;
    if (item.type === "function_call") {
      const caller = normalizeProgramCaller(item.caller, `response.items[${index}].caller`, programCallIds);
      functionCalls.push(Object.freeze({
        callId: assertIdentifier(item.callId, `response.items[${index}].callId`),
        name: assertIdentifier(item.name, `response.items[${index}].name`),
        arguments: normalizeJson(item.arguments, `response.items[${index}].arguments`),
        caller,
      }));
      continue;
    }
    if (item.type === "program_output") {
      const callId = assertIdentifier(item.callId, `response.items[${index}].callId`);
      if (!programCallIds.has(callId)) {
        throw new RuntimeBlock("caller_lineage_invalid", "Program output references an unknown hosted program.");
      }
      if (item.status !== "completed") {
        throw new RuntimeBlock("program_incomplete", "Hosted program output is incomplete.");
      }
      continue;
    }
    if (item.type === "message") {
      if (message !== undefined) throw new RuntimeBlock("provider_item_invalid", "Hosted response contains multiple final messages.");
      message = normalizeJson(item.output, `response.items[${index}].output`);
      continue;
    }
    throw new RuntimeBlock("provider_item_invalid", `Unsupported hosted response item: ${String(item.type)}.`);
  }
  return Object.freeze({
    functionCalls: Object.freeze(functionCalls),
    replayItems: Object.freeze(replayItems),
    message,
    programCount,
    programChars,
  });
}

function zeroCostLog() {
  return Object.freeze({
    model: "not-run",
    prompt_tokens: 0,
    completion_tokens: 0,
    cache_hits: 0,
    estimated_cost_usd: 0,
    status: "not-run",
    reportedAttempts: 0,
    unreportedAttempts: 0,
  });
}

function unreportedCostLog(providerAttempts) {
  return Object.freeze({
    model: "unreported",
    prompt_tokens: null,
    completion_tokens: null,
    cache_hits: null,
    estimated_cost_usd: null,
    status: "unreported",
    reportedAttempts: 0,
    unreportedAttempts: providerAttempts,
  });
}

function costEvidence(logs, providerAttempts) {
  if (providerAttempts === 0) return zeroCostLog();
  if (logs.length === 0) return unreportedCostLog(providerAttempts);
  return aggregateCostLogs(logs, providerAttempts);
}

function blockedResult(runId, stage, reasonCode, message, costLog = zeroCostLog(), evidence) {
  return Object.freeze({
    runId,
    status: "blocked",
    stage,
    reasonCode,
    message,
    ...(evidence ? { evidence } : {}),
    costLog,
  });
}

function createToolSettlement() {
  return {
    schema: TOOL_SETTLEMENT_SCHEMA,
    failurePolicy: "fail-soft",
    attempted: 0,
    dispatched: 0,
    canceledBeforeDispatch: 0,
    succeeded: 0,
    failed: 0,
    deadlineExceeded: 0,
    canceled: 0,
    batches: 0,
    partialBatches: 0,
    exhaustedBatches: 0,
    auditTrail: [],
  };
}

function publicToolSettlement(value) {
  return Object.freeze({
    schema: value.schema,
    failurePolicy: value.failurePolicy,
    attempted: value.attempted,
    dispatched: value.dispatched,
    canceledBeforeDispatch: value.canceledBeforeDispatch,
    succeeded: value.succeeded,
    failed: value.failed,
    deadlineExceeded: value.deadlineExceeded,
    canceled: value.canceled,
    batches: value.batches,
    partialBatches: value.partialBatches,
    exhaustedBatches: value.exhaustedBatches,
    auditTrail: Object.freeze(value.auditTrail.map((entry) => Object.freeze({ ...entry }))),
  });
}

function toolFailureReason(reasonCode) {
  if (reasonCode === "branch_timed_out") return "tool_deadline_exceeded";
  if (reasonCode === "branch_output_invalid") return "tool_output_invalid";
  if (reasonCode === "branch_result_limit") return "tool_result_limit";
  if (reasonCode === "branch_canceled") return "tool_canceled";
  return "tool_failed";
}

function failureOutput(call, reasonCode) {
  return Object.freeze({
    type: "function_call_output",
    callId: call.callId,
    caller: call.caller,
    output: Object.freeze({
      schema: TOOL_FAILURE_SCHEMA,
      status: "failed",
      reasonCode,
      retryable: false,
    }),
  });
}

function runWithDeadline(operation, signal, timeoutMs, controller) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const cleanup = () => {
      try {
        if (timer !== undefined) clearTimeout(timer);
      } catch {
        // Timer cleanup cannot suppress the typed settlement.
      }
      try {
        signal?.removeEventListener("abort", onAbort);
      } catch {
        // A hostile signal cannot leave the run pending after settlement.
      }
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onAbort = () => {
      controller.abort();
      finish(reject, new RuntimeBlock("aborted", "Programmatic tool run was aborted."));
    };
    if (signalIsAborted(signal)) {
      onAbort();
      return;
    }
    timer = setTimeout(() => {
      controller.abort();
      finish(reject, new RuntimeBlock("timeout", `Programmatic tool run exceeded ${timeoutMs} milliseconds.`));
    }, timeoutMs);
    try {
      signal?.addEventListener("abort", onAbort, { once: true });
    } catch {
      finish(reject, new RuntimeBlock("signal_invalid", "Programmatic tool run signal could not be observed."));
      return;
    }
    Promise.resolve().then(() => {
      // Close the call-to-microtask race: cancellation that wins before the
      // actual adapter boundary must not still spend or execute afterward.
      if (settled) return undefined;
      if (signalIsAborted(signal)) {
        onAbort();
        return undefined;
      }
      return operation();
    }).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
  });
}

export function createProgrammaticToolCallingRuntime({
  advanceHostedProgram,
  authorizeToolCalls,
  callTool,
  maxModelTurns = DEFAULT_MAX_MODEL_TURNS,
  maxToolCalls = DEFAULT_MAX_TOOL_CALLS,
  maxParallelCalls = DEFAULT_MAX_PARALLEL_CALLS,
  maxProgramChars = DEFAULT_MAX_PROGRAM_CHARS,
  maxToolResultChars = DEFAULT_MAX_TOOL_RESULT_CHARS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  for (const [field, value] of Object.entries({
    maxModelTurns,
    maxToolCalls,
    maxParallelCalls,
    maxProgramChars,
    maxToolResultChars,
  })) assertPositiveInteger(value, field);
  assertTimeout(timeoutMs);

  const adapterConfigured = typeof advanceHostedProgram === "function";
  const toolAuthorizerConfigured = typeof authorizeToolCalls === "function";
  const toolExecutorConfigured = typeof callTool === "function";
  const toolGatewayConfigured = toolAuthorizerConfigured && toolExecutorConfigured;
  const activeRuns = new Set();
  let completedRuns = 0;
  let blockedRuns = 0;
  let modelTurns = 0;
  let toolCalls = 0;
  let toolCallsDispatched = 0;
  let toolCallsCanceledBeforeDispatch = 0;
  let toolCallsSucceeded = 0;
  let toolCallsFailed = 0;
  let toolDeadlineExceeded = 0;
  let toolCallsCanceled = 0;
  let toolBatches = 0;
  let partialToolBatches = 0;
  let exhaustedToolBatches = 0;
  let hostedPrograms = 0;

  async function prepareFunctionCalls(calls, toolsByName, runId, signal, controller) {
    const locallyValidated = Object.freeze(calls.map((call) => {
      const tool = toolsByName.get(call.name);
      if (!tool || !tool.allowedCallers.includes("programmatic")) {
        throw new RuntimeBlock("tool_not_allowed", `Tool ${call.name} is not enabled for programmatic calls.`);
      }
      if (tool.riskClass !== READ_ONLY_RISK || !tool.idempotent || tool.approvalRequired) {
        throw new RuntimeBlock("direct_call_required", `Tool ${call.name} requires the direct-call path.`);
      }
      let argumentsValid = false;
      try {
        argumentsValid = tool.validateArguments(call.arguments) === true;
      } catch {
        argumentsValid = false;
      }
      if (!argumentsValid) {
        throw new RuntimeBlock("tool_arguments_invalid", `Tool ${call.name} rejected its arguments.`);
      }
      return Object.freeze({ call, tool });
    }));
    let authorizationResult;
    try {
      authorizationResult = await runWithDeadline(
        () => authorizeToolCalls(Object.freeze({
          runId,
          calls: Object.freeze(locallyValidated.map(({ call, tool }) => Object.freeze({
            callId: call.callId,
            name: call.name,
            arguments: call.arguments,
            caller: call.caller,
            policy: Object.freeze({
              allowedCallers: tool.allowedCallers,
              riskClass: tool.riskClass,
              idempotent: tool.idempotent,
              approvalRequired: tool.approvalRequired,
            }),
          }))),
          signal: controller.signal,
        })),
        signal,
        timeoutMs,
        controller,
      );
    } catch (error) {
      if (error instanceof RuntimeBlock) throw error;
      throw new RuntimeBlock(
        "tool_authorization_failed",
        "Programmatic tool authorization could not be completed.",
      );
    }
    try {
      if (
        !authorizationResult
        || typeof authorizationResult !== "object"
        || Array.isArray(authorizationResult)
        || !Array.isArray(authorizationResult.decisions)
        || authorizationResult.decisions.length !== locallyValidated.length
      ) {
        throw new RuntimeBlock(
          "tool_authorization_invalid",
          "Programmatic tool authorization returned an invalid whole-turn decision set.",
        );
      }
      let denied = false;
      for (const [index, decision] of authorizationResult.decisions.entries()) {
        const { call } = locallyValidated[index];
        if (
          !decision
          || typeof decision !== "object"
          || Array.isArray(decision)
          || decision.callId !== call.callId
        ) {
          throw new RuntimeBlock(
            "tool_authorization_invalid",
            "Programmatic tool authorization returned an invalid whole-turn decision set.",
          );
        }
        if (decision.status === "denied") denied = true;
        else if (decision.status !== "authorized") {
          throw new RuntimeBlock(
            "tool_authorization_invalid",
            "Programmatic tool authorization returned an invalid whole-turn decision set.",
          );
        }
      }
      if (denied) {
        throw new RuntimeBlock(
          "tool_authorization_denied",
          "At least one programmatic tool call was not authorized for execution.",
        );
      }
      const prepared = [];
      for (const [index, decision] of authorizationResult.decisions.entries()) {
        const { call, tool } = locallyValidated[index];
        const policy = Object.freeze({
          allowedCallers: tool.allowedCallers,
          riskClass: tool.riskClass,
          idempotent: tool.idempotent,
          approvalRequired: tool.approvalRequired,
        });
        const authorization = normalizeJson(
          decision.authorization,
          `authorization.decisions[${index}].authorization`,
        );
        if (!authorization || typeof authorization !== "object" || Array.isArray(authorization)) {
          throw new RuntimeBlock(
            "tool_authorization_invalid",
            "Programmatic tool authorization returned an invalid whole-turn decision set.",
          );
        }
        const expectedAuthorization = normalizeJson({
          schema: TOOL_AUTHORIZATION_SCHEMA,
          authorizationId: assertIdentifier(
            authorization.authorizationId,
            `authorization.decisions[${index}].authorization.authorizationId`,
          ),
          policyRevision: assertIdentifier(
            authorization.policyRevision,
            `authorization.decisions[${index}].authorization.policyRevision`,
          ),
          runId,
          callId: call.callId,
          toolName: call.name,
          arguments: call.arguments,
          caller: call.caller,
          policy,
        }, `authorization.decisions[${index}].expectedAuthorization`);
        if (JSON.stringify(authorization) !== JSON.stringify(expectedAuthorization)) {
          throw new RuntimeBlock(
            "tool_authorization_invalid",
            "Programmatic tool authorization returned an invalid whole-turn decision set.",
          );
        }
        prepared.push(Object.freeze({ call, tool, authorization }));
      }
      return Object.freeze(prepared);
    } catch (error) {
      if (error instanceof RuntimeBlock) throw error;
      throw new RuntimeBlock(
        "tool_authorization_invalid",
        "Programmatic tool authorization returned an invalid whole-turn decision set.",
      );
    }
  }

  function recordToolBatch(settlement, result, offset, ordinalBase) {
    settlement.attempted += result.attempted;
    settlement.dispatched += result.dispatched;
    settlement.canceledBeforeDispatch += result.canceledBeforeDispatch;
    settlement.succeeded += result.succeeded;
    settlement.failed += result.failed;
    settlement.deadlineExceeded += result.timedOut;
    settlement.canceled += result.canceled;
    settlement.batches += 1;
    settlement.partialBatches += Number(result.succeeded > 0 && result.failed > 0);
    settlement.exhaustedBatches += Number(result.attempted > 0 && result.succeeded === 0);
    toolCalls += result.attempted;
    toolCallsDispatched += result.dispatched;
    toolCallsCanceledBeforeDispatch += result.canceledBeforeDispatch;
    toolCallsSucceeded += result.succeeded;
    toolCallsFailed += result.failed;
    toolDeadlineExceeded += result.timedOut;
    toolCallsCanceled += result.canceled;
    toolBatches += 1;
    partialToolBatches += Number(result.succeeded > 0 && result.failed > 0);
    exhaustedToolBatches += Number(result.attempted > 0 && result.succeeded === 0);
    settlement.auditTrail.push(...result.auditTrail.map((entry, index) => {
      const branchId = `tool-call-${ordinalBase + offset + index + 1}`;
      if (entry.status === "succeeded") return { branchId, status: "succeeded" };
      return {
        branchId,
        status: "failed",
        reasonCode: toolFailureReason(entry.reasonCode),
        retryable: false,
      };
    }));
  }

  async function executeFunctionCalls({
    calls,
    toolsByName,
    runId,
    signal,
    controller,
    settlement,
    ordinalBase,
  }) {
    const prepared = await prepareFunctionCalls(calls, toolsByName, runId, signal, controller);
    const outputs = [];
    for (let offset = 0; offset < prepared.length; offset += maxParallelCalls) {
      const batch = prepared.slice(offset, offset + maxParallelCalls);
      const batchController = new AbortController();
      const cancelBatch = () => batchController.abort();
      if (signalIsAborted(signal)) cancelBatch();
      else {
        try {
          signal?.addEventListener("abort", cancelBatch, { once: true });
        } catch {
          throw new RuntimeBlock("signal_invalid", "Programmatic tool run signal could not be observed.");
        }
      }
      let integrityBlock = null;
      const result = await failSoftFanOut(batch, async ({ call, tool, authorization }, index, branchSignal) => {
        let rawOutput;
        try {
          rawOutput = await callTool({
            runId,
            callId: call.callId,
            name: call.name,
            arguments: call.arguments,
            caller: call.caller,
            authorization,
            signal: branchSignal,
          });
        } catch (error) {
          const reasonCode = toolIntegrityReason(error);
          if (reasonCode) {
            integrityBlock ||= new RuntimeBlock(
              reasonCode,
              "A programmatic tool execution integrity fence rejected the batch.",
            );
            cancelBatch();
            throw failSoftBranchFailure("branch_canceled");
          }
          throw failSoftBranchFailure("branch_unavailable");
        }
        const returnedIntegrityReason = toolIntegrityReason(rawOutput);
        if (returnedIntegrityReason) {
          integrityBlock ||= new RuntimeBlock(
            returnedIntegrityReason,
            "A programmatic tool execution integrity fence rejected the batch.",
          );
          cancelBatch();
          throw failSoftBranchFailure("branch_canceled");
        }
        let normalized;
        try {
          normalized = normalizeJson(rawOutput, `tool.${call.name}.output`);
        } catch {
          throw failSoftBranchFailure("branch_output_invalid");
        }
        let outputValid = false;
        try {
          outputValid = tool.validateOutput(normalized) === true;
        } catch {
          outputValid = false;
        }
        if (!outputValid) throw failSoftBranchFailure("branch_output_invalid");
        if (serializedJsonLength(normalized) > maxToolResultChars) {
          throw failSoftBranchFailure("branch_result_limit");
        }
        return Object.freeze({
          type: "function_call_output",
          callId: call.callId,
          caller: call.caller,
          output: normalized,
        });
      }, { signal: batchController.signal, timeoutMs });
      try {
        signal?.removeEventListener("abort", cancelBatch);
      } catch {
        // Listener cleanup cannot suppress the already-settled branch ledger.
      }
      recordToolBatch(settlement, result, offset, ordinalBase);
      if (integrityBlock) throw integrityBlock;
      if (signalIsAborted(signal)) {
        throw new RuntimeBlock("aborted", "Programmatic tool run was aborted.");
      }
      outputs.push(...result.outcomes.map((outcome, index) => {
        if (outcome.status === "succeeded") return outcome.value;
        return failureOutput(batch[index].call, toolFailureReason(outcome.reasonCode));
      }));
    }
    return Object.freeze(outputs);
  }

  async function run({ runId, input, tools, capabilities, continuationMode = "stored", signal } = {}) {
    const safeRunId = assertIdentifier(runId, "runId");
    const safeInput = normalizeJson(input, "input");
    const safeTools = normalizeToolDefinitions(tools);
    const safeCapabilities = normalizeCapabilities(capabilities);
    const safeContinuationMode = normalizeContinuationMode(continuationMode);
    const safeSignal = normalizeAbortSignal(signal);
    if (!adapterConfigured || !toolGatewayConfigured) {
      blockedRuns += 1;
      return blockedResult(safeRunId, "configure", "runtime_unconfigured", "Hosted program and tool gateway adapters are required.");
    }
    const continuationSupported = safeContinuationMode === "stored"
      ? safeCapabilities.previousResponseContinuation
      : safeCapabilities.statelessReplay;
    if (!safeCapabilities.hostedSandbox || !safeCapabilities.callerLineage || !continuationSupported) {
      blockedRuns += 1;
      return blockedResult(
        safeRunId,
        "capability",
        "capability_unsupported",
        `Hosted sandbox, caller lineage, and ${safeContinuationMode} continuation are required.`,
      );
    }
    if (activeRuns.has(safeRunId)) {
      blockedRuns += 1;
      return blockedResult(safeRunId, "serialize", "run_active", "A programmatic tool run with this id is already active.");
    }

    activeRuns.add(safeRunId);
    const controller = new AbortController();
    const toolsByName = new Map(safeTools.map((tool) => [tool.name, tool]));
    const declarations = publicToolDeclarations(safeTools);
    const programCallIds = new Set();
    const usedToolNames = new Set();
    const costLogs = [];
    const requestItem = Object.freeze({ type: "request", payload: safeInput });
    const transcript = [requestItem];
    let previousResponseId;
    let nextInput = Object.freeze([...transcript]);
    let runToolCalls = 0;
    let runPrograms = 0;
    let runProgramChars = 0;
    let providerAttempts = 0;
    const completedCallIds = new Set();
    const toolSettlement = createToolSettlement();

    try {
      for (let turn = 1; turn <= maxModelTurns; turn += 1) {
        let rawResponse;
        try {
          if (signalIsAborted(safeSignal)) {
            throw new RuntimeBlock("aborted", "Programmatic tool run was aborted.");
          }
          const adapterRequest = {
            runId: safeRunId,
            input: nextInput,
            continuationMode: safeContinuationMode,
            tools: declarations,
            signal: controller.signal,
          };
          if (safeContinuationMode === "stored" && previousResponseId) {
            adapterRequest.previousResponseId = previousResponseId;
          }
          rawResponse = await runWithDeadline(
            () => {
              providerAttempts += 1;
              return advanceHostedProgram(adapterRequest);
            },
            safeSignal,
            timeoutMs,
            controller,
          );
        } catch (error) {
          if (error instanceof RuntimeBlock) throw error;
          throw new RuntimeBlock("provider_failed", "Hosted program adapter failed.");
        }
        const response = normalizeResponse(rawResponse);
        costLogs.push(response.costLog);
        const inspected = inspectItems(response.items, programCallIds, maxProgramChars - runProgramChars);
        modelTurns += 1;
        runPrograms += inspected.programCount;
        runProgramChars += inspected.programChars;
        hostedPrograms += inspected.programCount;
        if (safeContinuationMode === "stored") previousResponseId = response.responseId;
        else transcript.push(...inspected.replayItems);

        if (inspected.functionCalls.length > 0) {
          runToolCalls += inspected.functionCalls.length;
          if (runToolCalls > maxToolCalls) {
            throw new RuntimeBlock("tool_call_limit", `Programmatic run exceeds ${maxToolCalls} tool calls.`);
          }
          for (const call of inspected.functionCalls) {
            if (completedCallIds.has(call.callId)) {
              throw new RuntimeBlock("duplicate_tool_call", `Tool call ${call.callId} was already completed.`);
            }
            completedCallIds.add(call.callId);
            usedToolNames.add(call.name);
          }
          const outputs = await executeFunctionCalls({
            calls: inspected.functionCalls,
            toolsByName,
            runId: safeRunId,
            signal: safeSignal,
            controller,
            settlement: toolSettlement,
            ordinalBase: runToolCalls - inspected.functionCalls.length,
          });
          if (safeContinuationMode === "stateless") {
            transcript.push(...outputs);
            nextInput = Object.freeze([...transcript]);
          } else {
            nextInput = outputs;
          }
          continue;
        }

        if (inspected.message !== undefined) {
          completedRuns += 1;
          return Object.freeze({
            runId: safeRunId,
            status: "completed",
            stage: "final",
            output: inspected.message,
            evidence: Object.freeze({
              modelTurns: turn,
              toolCalls: runToolCalls,
              toolNames: Object.freeze([...usedToolNames].sort()),
              hostedPrograms: runPrograms,
              continuationMode: safeContinuationMode,
              hostedSandbox: "provider-attested",
              localJavaScriptExecution: "forbidden",
              intermediateResultsReturned: false,
              contextIsolation: "provider-attested",
              toolSettlement: publicToolSettlement(toolSettlement),
            }),
            costLog: costEvidence(costLogs, providerAttempts),
          });
        }
        nextInput = safeContinuationMode === "stateless"
          ? Object.freeze([...transcript])
          : Object.freeze([]);
      }
      throw new RuntimeBlock("model_turn_limit", `Programmatic run exceeds ${maxModelTurns} model turns.`);
    } catch (error) {
      blockedRuns += 1;
      const costLog = costEvidence(costLogs, providerAttempts);
      const evidence = toolSettlement.attempted > 0
        ? Object.freeze({ toolSettlement: publicToolSettlement(toolSettlement) })
        : undefined;
      if (error instanceof RuntimeBlock) {
        return blockedResult(safeRunId, "execute", error.reasonCode, error.message, costLog, evidence);
      }
      return blockedResult(
        safeRunId,
        "execute",
        "runtime_failed",
        "Programmatic tool runtime failed.",
        costLog,
        evidence,
      );
    } finally {
      controller.abort();
      activeRuns.delete(safeRunId);
    }
  }

  function stats() {
    return Object.freeze({
      adapterConfigured,
      toolAuthorizerConfigured,
      toolExecutorConfigured,
      toolGatewayConfigured,
      activeRuns: activeRuns.size,
      completedRuns,
      blockedRuns,
      modelTurns,
      toolCalls,
      toolCallsAttempted: toolCalls,
      toolCallsDispatched,
      toolCallsCanceledBeforeDispatch,
      toolCallsSucceeded,
      toolCallsFailed,
      toolCallsDeadlineExceeded: toolDeadlineExceeded,
      toolCallsCanceled,
      toolBatches,
      partialToolBatches,
      exhaustedToolBatches,
      hostedPrograms,
      maxModelTurns,
      maxToolCalls,
      maxParallelCalls,
      maxProgramChars,
      maxToolResultChars,
      timeoutMs,
    });
  }

  return Object.freeze({ run, stats });
}

export const PROGRAMMATIC_TOOL_CALLING_DEFAULTS = Object.freeze({
  maxModelTurns: DEFAULT_MAX_MODEL_TURNS,
  maxToolCalls: DEFAULT_MAX_TOOL_CALLS,
  maxParallelCalls: DEFAULT_MAX_PARALLEL_CALLS,
  maxProgramChars: DEFAULT_MAX_PROGRAM_CHARS,
  maxToolResultChars: DEFAULT_MAX_TOOL_RESULT_CHARS,
  timeoutMs: DEFAULT_TIMEOUT_MS,
});
