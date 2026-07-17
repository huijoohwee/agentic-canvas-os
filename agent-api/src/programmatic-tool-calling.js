import { normalizeJson, serializedJsonLength } from "./json-contract.js";

const DEFAULT_MAX_MODEL_TURNS = 8;
const DEFAULT_MAX_TOOL_CALLS = 32;
const DEFAULT_MAX_PARALLEL_CALLS = 8;
const DEFAULT_MAX_PROGRAM_CHARS = 100_000;
const DEFAULT_MAX_TOOL_RESULT_CHARS = 200_000;
const DEFAULT_TIMEOUT_MS = 60_000;

const CALLER_MODES = new Set(["direct", "programmatic"]);
const READ_ONLY_RISK = "read-only";

class RuntimeBlock extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = "RuntimeBlock";
    this.reasonCode = reasonCode;
  }
}

function assertPositiveInteger(value, field) {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${field} must be a positive integer.`);
  return value;
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
  const required = ["hostedSandbox", "previousResponseContinuation", "callerLineage"];
  for (const field of required) {
    if (typeof value[field] !== "boolean") throw new TypeError(`capabilities.${field} must be boolean.`);
  }
  return Object.freeze(Object.fromEntries(required.map((field) => [field, value[field]])));
}

function normalizeCallerModes(value, field) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${field} must be a non-empty array.`);
  const modes = [...new Set(value)];
  for (const mode of modes) {
    if (!CALLER_MODES.has(mode)) throw new TypeError(`${field} contains unsupported mode ${String(mode)}.`);
  }
  return Object.freeze(modes);
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
    const callerModes = normalizeCallerModes(tool.callerModes, `tools[${index}].callerModes`);
    const riskClass = assertIdentifier(tool.riskClass, `tools[${index}].riskClass`);
    if (typeof tool.idempotent !== "boolean") throw new TypeError(`tools[${index}].idempotent must be boolean.`);
    if (typeof tool.validateArguments !== "function" || typeof tool.validateOutput !== "function") {
      throw new TypeError(`tools[${index}] must provide argument and output validators.`);
    }
    return Object.freeze({
      name,
      callerModes,
      riskClass,
      idempotent: tool.idempotent,
      inputSchema: normalizeJson(tool.inputSchema || {}, `tools[${index}].inputSchema`),
      outputSchema: normalizeJson(tool.outputSchema || {}, `tools[${index}].outputSchema`),
      validateArguments: tool.validateArguments,
      validateOutput: tool.validateOutput,
    });
  });
  return Object.freeze(tools);
}

function publicToolDeclarations(tools) {
  return Object.freeze(tools.map((tool) => Object.freeze({
    name: tool.name,
    callerModes: tool.callerModes,
    riskClass: tool.riskClass,
    idempotent: tool.idempotent,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
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

function aggregateCostLogs(logs) {
  const models = [...new Set(logs.map((log) => log.model))];
  return Object.freeze({
    model: models.length === 1 ? models[0] : "multiple",
    prompt_tokens: logs.reduce((sum, log) => sum + log.prompt_tokens, 0),
    completion_tokens: logs.reduce((sum, log) => sum + log.completion_tokens, 0),
    cache_hits: logs.reduce((sum, log) => sum + log.cache_hits, 0),
    estimated_cost_usd: logs.reduce((sum, log) => sum + log.estimated_cost_usd, 0),
    status: "reported",
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

function inspectItems(items, programCallIds, maxProgramChars) {
  const toolCalls = [];
  let message;
  let programCount = 0;
  let programChars = 0;
  for (const [index, item] of items.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new RuntimeBlock("provider_item_invalid", `response.items[${index}] must be an object.`);
    }
    if (item.type === "program") {
      const callId = assertIdentifier(item.callId, `response.items[${index}].callId`);
      if (typeof item.code !== "string" || !item.code.trim()) {
        throw new RuntimeBlock("program_invalid", "Hosted program code must be non-empty text.");
      }
      programChars += item.code.length;
      if (programChars > maxProgramChars) {
        throw new RuntimeBlock("program_limit", `Hosted program exceeds ${maxProgramChars} characters.`);
      }
      programCallIds.add(callId);
      programCount += 1;
      continue;
    }
    if (item.type === "tool_call") {
      const caller = item.caller;
      if (!caller || caller.type !== "program" || !programCallIds.has(caller.callId)) {
        throw new RuntimeBlock("caller_lineage_invalid", "Programmatic tool call has missing or unknown program lineage.");
      }
      toolCalls.push(Object.freeze({
        callId: assertIdentifier(item.callId, `response.items[${index}].callId`),
        name: assertIdentifier(item.name, `response.items[${index}].name`),
        arguments: normalizeJson(item.arguments, `response.items[${index}].arguments`),
        caller: Object.freeze({ type: "program", callId: caller.callId }),
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
  return Object.freeze({ toolCalls: Object.freeze(toolCalls), message, programCount, programChars });
}

function zeroCostLog() {
  return Object.freeze({
    model: "not-run",
    prompt_tokens: 0,
    completion_tokens: 0,
    cache_hits: 0,
    estimated_cost_usd: 0,
    status: "not-run",
  });
}

function unreportedCostLog() {
  return Object.freeze({
    model: "unreported",
    prompt_tokens: null,
    completion_tokens: null,
    cache_hits: null,
    estimated_cost_usd: null,
    status: "unreported",
  });
}

function blockedResult(runId, stage, reasonCode, message, costLog = zeroCostLog()) {
  return Object.freeze({ runId, status: "blocked", stage, reasonCode, message, costLog });
}

function runWithDeadline(operation, signal, timeoutMs, controller) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      controller.abort();
      reject(new RuntimeBlock("aborted", "Programmatic tool run was aborted."));
      return;
    }
    const timer = setTimeout(() => {
      controller.abort();
      reject(new RuntimeBlock("timeout", `Programmatic tool run exceeded ${timeoutMs} milliseconds.`));
    }, timeoutMs);
    const onAbort = () => {
      controller.abort();
      reject(new RuntimeBlock("aborted", "Programmatic tool run was aborted."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    Promise.resolve().then(operation).then(resolve, reject).finally(() => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    });
  });
}

export function createProgrammaticToolCallingRuntime({
  advanceHostedProgram,
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
    timeoutMs,
  })) assertPositiveInteger(value, field);

  const adapterConfigured = typeof advanceHostedProgram === "function";
  const toolGatewayConfigured = typeof callTool === "function";
  const activeRuns = new Set();
  let completedRuns = 0;
  let blockedRuns = 0;
  let modelTurns = 0;
  let toolCalls = 0;
  let hostedPrograms = 0;

  async function executeToolCalls({ calls, toolsByName, runId, signal, controller }) {
    const outputs = [];
    for (let offset = 0; offset < calls.length; offset += maxParallelCalls) {
      const batch = calls.slice(offset, offset + maxParallelCalls);
      const resolved = await Promise.all(batch.map(async (call) => {
        const tool = toolsByName.get(call.name);
        if (!tool || !tool.callerModes.includes("programmatic")) {
          throw new RuntimeBlock("tool_not_allowed", `Tool ${call.name} is not enabled for programmatic calls.`);
        }
        if (tool.riskClass !== READ_ONLY_RISK || !tool.idempotent) {
          throw new RuntimeBlock("direct_call_required", `Tool ${call.name} requires the direct-call path.`);
        }
        if (tool.validateArguments(call.arguments) !== true) {
          throw new RuntimeBlock("tool_arguments_invalid", `Tool ${call.name} rejected its arguments.`);
        }
        let output;
        try {
          output = await runWithDeadline(
            () => callTool({ runId, callId: call.callId, name: call.name, arguments: call.arguments, signal: controller.signal }),
            signal,
            timeoutMs,
            controller,
          );
        } catch (error) {
          if (error instanceof RuntimeBlock) throw error;
          throw new RuntimeBlock("tool_failed", `Tool ${call.name} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        const normalized = normalizeJson(output, `tool.${call.name}.output`);
        if (tool.validateOutput(normalized) !== true) {
          throw new RuntimeBlock("tool_output_invalid", `Tool ${call.name} returned an invalid output.`);
        }
        if (serializedJsonLength(normalized) > maxToolResultChars) {
          throw new RuntimeBlock("tool_result_limit", `Tool ${call.name} output exceeds ${maxToolResultChars} characters.`);
        }
        return Object.freeze({
          type: "tool_result",
          callId: call.callId,
          caller: call.caller,
          output: normalized,
        });
      }));
      outputs.push(...resolved);
    }
    return Object.freeze(outputs);
  }

  async function run({ runId, input, tools, capabilities, signal } = {}) {
    const safeRunId = assertIdentifier(runId, "runId");
    const safeInput = normalizeJson(input, "input");
    const safeTools = normalizeToolDefinitions(tools);
    const safeCapabilities = normalizeCapabilities(capabilities);
    if (!adapterConfigured || !toolGatewayConfigured) {
      blockedRuns += 1;
      return blockedResult(safeRunId, "configure", "runtime_unconfigured", "Hosted program and tool gateway adapters are required.");
    }
    if (!safeCapabilities.hostedSandbox || !safeCapabilities.previousResponseContinuation || !safeCapabilities.callerLineage) {
      blockedRuns += 1;
      return blockedResult(safeRunId, "capability", "capability_unsupported", "Hosted sandbox, response continuation, and caller lineage are required.");
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
    let previousResponseId;
    let nextInput = Object.freeze([Object.freeze({ type: "request", payload: safeInput })]);
    let runToolCalls = 0;
    let runPrograms = 0;
    let runProgramChars = 0;
    let providerAttempted = false;
    const completedCallIds = new Set();

    try {
      for (let turn = 1; turn <= maxModelTurns; turn += 1) {
        let rawResponse;
        try {
          providerAttempted = true;
          rawResponse = await runWithDeadline(
            () => advanceHostedProgram({
              runId: safeRunId,
              input: nextInput,
              previousResponseId,
              tools: declarations,
              signal: controller.signal,
            }),
            signal,
            timeoutMs,
            controller,
          );
        } catch (error) {
          if (error instanceof RuntimeBlock) throw error;
          throw new RuntimeBlock("provider_failed", `Hosted program adapter failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        const response = normalizeResponse(rawResponse);
        const inspected = inspectItems(response.items, programCallIds, maxProgramChars - runProgramChars);
        costLogs.push(response.costLog);
        modelTurns += 1;
        runPrograms += inspected.programCount;
        runProgramChars += inspected.programChars;
        hostedPrograms += inspected.programCount;
        previousResponseId = response.responseId;

        if (inspected.toolCalls.length > 0) {
          runToolCalls += inspected.toolCalls.length;
          if (runToolCalls > maxToolCalls) {
            throw new RuntimeBlock("tool_call_limit", `Programmatic run exceeds ${maxToolCalls} tool calls.`);
          }
          for (const call of inspected.toolCalls) {
            if (completedCallIds.has(call.callId)) {
              throw new RuntimeBlock("duplicate_tool_call", `Tool call ${call.callId} was already completed.`);
            }
            completedCallIds.add(call.callId);
            usedToolNames.add(call.name);
          }
          nextInput = await executeToolCalls({
            calls: inspected.toolCalls,
            toolsByName,
            runId: safeRunId,
            signal,
            controller,
          });
          toolCalls += inspected.toolCalls.length;
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
              hostedSandbox: "provider-attested",
              localJavaScriptExecution: "forbidden",
              intermediateResultsReturned: false,
              contextIsolation: "provider-attested",
            }),
            costLog: aggregateCostLogs(costLogs),
          });
        }
        nextInput = Object.freeze([]);
      }
      throw new RuntimeBlock("model_turn_limit", `Programmatic run exceeds ${maxModelTurns} model turns.`);
    } catch (error) {
      blockedRuns += 1;
      const costLog = costLogs.length > 0
        ? aggregateCostLogs(costLogs)
        : providerAttempted
          ? unreportedCostLog()
          : zeroCostLog();
      if (error instanceof RuntimeBlock) {
        return blockedResult(safeRunId, "execute", error.reasonCode, error.message, costLog);
      }
      return blockedResult(
        safeRunId,
        "execute",
        "runtime_failed",
        error instanceof Error ? error.message : String(error),
        costLog,
      );
    } finally {
      controller.abort();
      activeRuns.delete(safeRunId);
    }
  }

  function stats() {
    return Object.freeze({
      adapterConfigured,
      toolGatewayConfigured,
      activeRuns: activeRuns.size,
      completedRuns,
      blockedRuns,
      modelTurns,
      toolCalls,
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
