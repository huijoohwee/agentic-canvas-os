import { normalizeJson, serializedJsonLength } from "./json-contract.js";

const DEFAULT_MAX_MODEL_TURNS = 8;
const DEFAULT_MAX_TOOL_CALLS = 32;
const DEFAULT_MAX_PARALLEL_CALLS = 8;
const DEFAULT_MAX_TOOLS = 128;
const DEFAULT_MAX_SCHEMA_CHARS = 100_000;
const DEFAULT_MAX_TOOL_RESULT_CHARS = 200_000;
const DEFAULT_TIMEOUT_MS = 60_000;

const CACHE_STATUSES = new Set(["hit", "write", "miss", "unreported"]);
const TOOL_CHOICE_MODES = new Set(["auto", "required", "none", "forced", "allowed"]);
const ALLOWED_REQUIREMENTS = new Set(["auto", "required"]);

class FunctionCallingBlock extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = "FunctionCallingBlock";
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
  const fields = ["functionCalling", "strictSchemas", "parallelFunctionCalls",
    "previousResponseContinuation", "reasoningItemReplay"];
  for (const field of fields) {
    if (typeof value[field] !== "boolean") throw new TypeError(`capabilities.${field} must be boolean.`);
  }
  return Object.freeze(Object.fromEntries(fields.map((field) => [field, value[field]])));
}

function schemaIncludesType(schema, type) {
  return schema.type === type || (Array.isArray(schema.type) && schema.type.includes(type));
}

function assertStrictSchemaNode(schema, field) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new TypeError(`${field} must be a schema object.`);
  }
  if (schemaIncludesType(schema, "object") || schema.properties !== undefined) {
    if (schema.additionalProperties !== false) {
      throw new TypeError(`${field}.additionalProperties must be false in strict mode.`);
    }
    const properties = schema.properties || {};
    if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
      throw new TypeError(`${field}.properties must be an object.`);
    }
    if (!Array.isArray(schema.required)) throw new TypeError(`${field}.required must list every property.`);
    const propertyNames = Object.keys(properties).sort();
    const requiredNames = [...new Set(schema.required)].sort();
    if (requiredNames.length !== schema.required.length || propertyNames.join("\0") !== requiredNames.join("\0")) {
      throw new TypeError(`${field}.required must contain every property exactly once.`);
    }
    for (const [name, child] of Object.entries(properties)) {
      assertStrictSchemaNode(child, `${field}.properties.${name}`);
    }
  }
  if (schemaIncludesType(schema, "array") && schema.items !== undefined) {
    assertStrictSchemaNode(schema.items, `${field}.items`);
  }
  for (const keyword of ["allOf", "anyOf", "oneOf"]) {
    if (schema[keyword] === undefined) continue;
    if (!Array.isArray(schema[keyword])) throw new TypeError(`${field}.${keyword} must be an array.`);
    schema[keyword].forEach((child, index) => assertStrictSchemaNode(child, `${field}.${keyword}[${index}]`));
  }
  for (const keyword of ["$defs", "definitions"]) {
    if (schema[keyword] === undefined) continue;
    if (!schema[keyword] || typeof schema[keyword] !== "object" || Array.isArray(schema[keyword])) {
      throw new TypeError(`${field}.${keyword} must be an object.`);
    }
    for (const [name, child] of Object.entries(schema[keyword])) {
      assertStrictSchemaNode(child, `${field}.${keyword}.${name}`);
    }
  }
}

function normalizeStrictObjectSchema(value, field) {
  const schema = normalizeJson(value, field);
  if (!schemaIncludesType(schema, "object")) throw new TypeError(`${field} must be an object schema.`);
  assertStrictSchemaNode(schema, field);
  return schema;
}

function normalizeAllowedCallers(value, field) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${field} must be a non-empty array.`);
  const callers = [...new Set(value)];
  if (callers.some((caller) => caller !== "direct" && caller !== "programmatic")) {
    throw new TypeError(`${field} contains an unsupported caller.`);
  }
  return Object.freeze(callers);
}

function normalizeTools(value, { maxTools, maxSchemaChars }) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError("tools must be a non-empty array.");
  if (value.length > maxTools) throw new RangeError(`tools must contain at most ${maxTools} entries.`);
  const names = new Set();
  let schemaChars = 0;
  const tools = value.map((tool, index) => {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
      throw new TypeError(`tools[${index}] must be an object.`);
    }
    if (tool.type !== "function") throw new TypeError(`tools[${index}].type must be function.`);
    const name = assertIdentifier(tool.name, `tools[${index}].name`);
    if (names.has(name)) throw new TypeError(`Duplicate tool name: ${name}.`);
    names.add(name);
    if (tool.strict !== true) throw new TypeError(`tools[${index}].strict must be true.`);
    const parameters = normalizeStrictObjectSchema(tool.parameters, `tools[${index}].parameters`);
    const outputSchema = normalizeStrictObjectSchema(tool.outputSchema, `tools[${index}].outputSchema`);
    schemaChars += serializedJsonLength(parameters) + serializedJsonLength(outputSchema);
    if (schemaChars > maxSchemaChars) throw new RangeError(`Tool schemas exceed ${maxSchemaChars} characters.`);
    if (typeof tool.idempotent !== "boolean") throw new TypeError(`tools[${index}].idempotent must be boolean.`);
    if (typeof tool.approvalRequired !== "boolean") {
      throw new TypeError(`tools[${index}].approvalRequired must be boolean.`);
    }
    if (typeof tool.validateArguments !== "function" || typeof tool.validateOutput !== "function") {
      throw new TypeError(`tools[${index}] must provide argument and output validators.`);
    }
    return Object.freeze({
      type: "function",
      name,
      description: assertIdentifier(tool.description, `tools[${index}].description`),
      parameters,
      strict: true,
      outputSchema,
      allowedCallers: normalizeAllowedCallers(tool.allowedCallers, `tools[${index}].allowedCallers`),
      riskClass: assertIdentifier(tool.riskClass, `tools[${index}].riskClass`),
      idempotent: tool.idempotent,
      approvalRequired: tool.approvalRequired,
      validateArguments: tool.validateArguments,
      validateOutput: tool.validateOutput,
    });
  });
  return Object.freeze(tools);
}

function publicToolDeclarations(tools) {
  return Object.freeze(tools.map(({ type, name, description, parameters, strict }) => Object.freeze({
    type, name, description, parameters, strict,
  })));
}

function normalizeToolChoice(value, toolNames) {
  const choice = value === undefined ? { mode: "auto" } : value;
  if (!choice || typeof choice !== "object" || Array.isArray(choice) || !TOOL_CHOICE_MODES.has(choice.mode)) {
    throw new TypeError("toolChoice.mode must be auto, required, none, forced, or allowed.");
  }
  if (choice.mode === "forced") {
    const name = assertIdentifier(choice.name, "toolChoice.name");
    if (!toolNames.has(name)) throw new TypeError(`toolChoice names an unknown tool: ${name}.`);
    return Object.freeze({ mode: "forced", name });
  }
  if (choice.mode === "allowed") {
    if (!Array.isArray(choice.names) || choice.names.length === 0) {
      throw new TypeError("toolChoice.names must be a non-empty array.");
    }
    const names = choice.names.map((name, index) => assertIdentifier(name, `toolChoice.names[${index}]`));
    if (new Set(names).size !== names.length) throw new TypeError("toolChoice.names must be unique.");
    for (const name of names) if (!toolNames.has(name)) throw new TypeError(`toolChoice names an unknown tool: ${name}.`);
    const requirement = choice.requirement === undefined ? "auto" : choice.requirement;
    if (!ALLOWED_REQUIREMENTS.has(requirement)) {
      throw new TypeError("toolChoice.requirement must be auto or required.");
    }
    return Object.freeze({ mode: "allowed", names: Object.freeze(names), requirement });
  }
  return Object.freeze({ mode: choice.mode });
}

function normalizeCostLog(value, owner) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FunctionCallingBlock(`${owner}_cost_log_missing`, `${owner} execution must return a cost log.`);
  }
  const result = { model: assertIdentifier(value.model, `${owner}CostLog.model`) };
  for (const field of ["prompt_tokens", "completion_tokens", "cache_hits", "cached_tokens", "cache_write_tokens"]) {
    if (!Number.isInteger(value[field]) || value[field] < 0) {
      throw new FunctionCallingBlock(`${owner}_cost_log_invalid`, `${owner}CostLog.${field} must be non-negative.`);
    }
    result[field] = value[field];
  }
  if (!CACHE_STATUSES.has(value.provider_cache_status)) {
    throw new FunctionCallingBlock(`${owner}_cost_log_invalid`, `${owner}CostLog.provider_cache_status is invalid.`);
  }
  if (!Number.isFinite(value.estimated_cost_usd) || value.estimated_cost_usd < 0) {
    throw new FunctionCallingBlock(`${owner}_cost_log_invalid`, `${owner}CostLog.estimated_cost_usd must be non-negative.`);
  }
  result.provider_cache_status = value.provider_cache_status;
  result.estimated_cost_usd = value.estimated_cost_usd;
  return Object.freeze(result);
}

function aggregateCostLogs(logs) {
  const models = [...new Set(logs.map((log) => log.model))];
  const statuses = [...new Set(logs.map((log) => log.provider_cache_status))];
  return Object.freeze({
    model: models.length === 1 ? models[0] : "multiple",
    prompt_tokens: logs.reduce((sum, log) => sum + log.prompt_tokens, 0),
    completion_tokens: logs.reduce((sum, log) => sum + log.completion_tokens, 0),
    cache_hits: logs.reduce((sum, log) => sum + log.cache_hits, 0),
    cached_tokens: logs.reduce((sum, log) => sum + log.cached_tokens, 0),
    cache_write_tokens: logs.reduce((sum, log) => sum + log.cache_write_tokens, 0),
    provider_cache_status: statuses.length === 1 ? statuses[0] : "unreported",
    estimated_cost_usd: logs.reduce((sum, log) => sum + log.estimated_cost_usd, 0),
    status: "reported",
  });
}

function emptyCostLog(status) {
  return Object.freeze({
    model: status === "not-run" ? "not-run" : "unreported",
    prompt_tokens: status === "not-run" ? 0 : null,
    completion_tokens: status === "not-run" ? 0 : null,
    cache_hits: status === "not-run" ? 0 : null,
    cached_tokens: status === "not-run" ? 0 : null,
    cache_write_tokens: status === "not-run" ? 0 : null,
    provider_cache_status: "unreported",
    estimated_cost_usd: status === "not-run" ? 0 : null,
    status,
  });
}

function normalizeResponse(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FunctionCallingBlock("provider_response_invalid", "Model adapter response must be an object.");
  }
  if (value.status !== "completed") {
    throw new FunctionCallingBlock("provider_response_incomplete", `Model response ended with ${String(value.status)}.`);
  }
  if (!Array.isArray(value.items)) {
    throw new FunctionCallingBlock("provider_response_invalid", "Model response items must be an array.");
  }
  return Object.freeze({
    responseId: assertIdentifier(value.responseId, "response.responseId"),
    items: value.items,
    costLog: normalizeCostLog(value.costLog, "model"),
  });
}

function inspectItems(items, usedCallIds) {
  const reasoningItems = [];
  const functionCalls = [];
  let message;
  for (const [index, item] of items.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new FunctionCallingBlock("provider_item_invalid", `response.items[${index}] must be an object.`);
    }
    if (item.type === "reasoning") {
      reasoningItems.push(normalizeJson(item, `response.items[${index}]`));
      continue;
    }
    if (item.type === "function_call") {
      const callId = assertIdentifier(item.callId, `response.items[${index}].callId`);
      if (usedCallIds.has(callId)) throw new FunctionCallingBlock("function_call_replayed", `Function call ${callId} was repeated.`);
      usedCallIds.add(callId);
      const argumentsValue = normalizeJson(item.arguments, `response.items[${index}].arguments`);
      if (!argumentsValue || typeof argumentsValue !== "object" || Array.isArray(argumentsValue)) {
        throw new FunctionCallingBlock("tool_arguments_invalid", "Function-call arguments must be an object.");
      }
      functionCalls.push(Object.freeze({
        callId,
        name: assertIdentifier(item.name, `response.items[${index}].name`),
        arguments: argumentsValue,
      }));
      continue;
    }
    if (item.type === "message") {
      if (message !== undefined) throw new FunctionCallingBlock("provider_item_invalid", "Model response contains multiple messages.");
      message = normalizeJson(item.output, `response.items[${index}].output`);
      continue;
    }
    throw new FunctionCallingBlock("provider_item_invalid", `Unsupported model response item: ${String(item.type)}.`);
  }
  if (message !== undefined && functionCalls.length > 0) {
    throw new FunctionCallingBlock("provider_item_invalid", "A final message cannot accompany pending function calls.");
  }
  return Object.freeze({
    reasoningItems: Object.freeze(reasoningItems),
    functionCalls: Object.freeze(functionCalls),
    message,
  });
}

function choiceRequiresCall(choice) {
  return choice.mode === "required" || choice.mode === "forced"
    || (choice.mode === "allowed" && choice.requirement === "required");
}

function providerChoiceForTurn(choice, requiredCallCompleted) {
  if (!requiredCallCompleted || !choiceRequiresCall(choice)) return choice;
  return Object.freeze({ mode: "auto" });
}

function validateCallsAgainstChoice(calls, choice) {
  if (choice.mode === "none" && calls.length > 0) {
    throw new FunctionCallingBlock("tool_choice_violation", "Tool choice none forbids function calls.");
  }
  if (choice.mode === "forced" && calls.length > 0) {
    if (calls.length !== 1 || calls[0].name !== choice.name) {
      throw new FunctionCallingBlock("tool_choice_violation", `Forced tool choice requires exactly one ${choice.name} call.`);
    }
  }
  if (choice.mode === "allowed") {
    const names = new Set(choice.names);
    if (calls.some((call) => !names.has(call.name))) {
      throw new FunctionCallingBlock("tool_choice_violation", "Function call is outside the allowed tool subset.");
    }
  }
}

function blockedResult(runId, stage, reasonCode, message, costLog, gatewayCostLog) {
  return Object.freeze({ runId, status: "blocked", stage, reasonCode, message, costLog, gatewayCostLog });
}

function callWithTimeout(callback, input, timeoutMs, externalSignal, runController, label) {
  return new Promise((resolve, reject) => {
    if (externalSignal?.aborted) {
      runController.abort();
      reject(new FunctionCallingBlock("aborted", "Function-calling run was aborted."));
      return;
    }
    const timer = setTimeout(() => {
      runController.abort();
      reject(new FunctionCallingBlock("timeout", `${label} exceeded ${timeoutMs} milliseconds.`));
    }, timeoutMs);
    const onAbort = () => {
      runController.abort();
      reject(new FunctionCallingBlock("aborted", "Function-calling run was aborted."));
    };
    externalSignal?.addEventListener("abort", onAbort, { once: true });
    Promise.resolve().then(() => callback(Object.freeze({ ...input, signal: runController.signal })))
      .then(resolve, reject)
      .finally(() => {
        clearTimeout(timer);
        externalSignal?.removeEventListener("abort", onAbort);
      });
  });
}

export function createFunctionCallingRuntime({ advanceModel, callTool,
  maxModelTurns = DEFAULT_MAX_MODEL_TURNS, maxToolCalls = DEFAULT_MAX_TOOL_CALLS,
  maxParallelCalls = DEFAULT_MAX_PARALLEL_CALLS, maxTools = DEFAULT_MAX_TOOLS,
  maxSchemaChars = DEFAULT_MAX_SCHEMA_CHARS, maxToolResultChars = DEFAULT_MAX_TOOL_RESULT_CHARS,
  timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  for (const [field, value] of Object.entries({
    maxModelTurns, maxToolCalls, maxParallelCalls, maxTools, maxSchemaChars, maxToolResultChars, timeoutMs,
  })) assertPositiveInteger(value, field);

  const adapterConfigured = typeof advanceModel === "function";
  const toolGatewayConfigured = typeof callTool === "function";
  const activeRuns = new Set();
  let completedRuns = 0;
  let blockedRuns = 0;
  let modelTurns = 0;
  let toolCalls = 0;

  async function run({ runId, input, tools, capabilities, toolChoice,
    parallelToolCalls = true, approvals = [], signal } = {}) {
    const safeRunId = assertIdentifier(runId, "runId");
    const safeInput = normalizeJson(input, "input");
    const safeTools = normalizeTools(tools, { maxTools, maxSchemaChars });
    const toolsByName = new Map(safeTools.map((tool) => [tool.name, tool]));
    const publicTools = publicToolDeclarations(safeTools);
    const safeChoice = normalizeToolChoice(toolChoice, new Set(toolsByName.keys()));
    const supported = normalizeCapabilities(capabilities);
    const safeApprovals = normalizeJson(approvals, "approvals");
    if (!Array.isArray(safeApprovals)) throw new TypeError("approvals must be an array.");
    if (typeof parallelToolCalls !== "boolean") throw new TypeError("parallelToolCalls must be boolean.");

    const notRun = emptyCostLog("not-run");
    if (activeRuns.has(safeRunId)) {
      return blockedResult(safeRunId, "preflight", "run_active", "A run with this id is already active.", notRun, notRun);
    }
    if (!adapterConfigured || !toolGatewayConfigured) {
      return blockedResult(safeRunId, "preflight", "runtime_unconfigured", "Function calling requires model and tool-gateway adapters.", notRun, notRun);
    }
    if (!supported.functionCalling || !supported.strictSchemas || !supported.previousResponseContinuation || !supported.reasoningItemReplay) {
      return blockedResult(safeRunId, "preflight", "capability_unsupported", "Declared capabilities do not support strict continued function calling.", notRun, notRun);
    }
    if (parallelToolCalls && !supported.parallelFunctionCalls) {
      return blockedResult(safeRunId, "preflight", "capability_unsupported", "Parallel function calls were requested but are unsupported.", notRun, notRun);
    }

    activeRuns.add(safeRunId);
    const controller = new AbortController();
    const modelCosts = [];
    const gatewayCosts = [];
    const usedCallIds = new Set();
    const usedResponseIds = new Set();
    const usedToolNames = new Set();
    let providerAttempts = 0;
    let gatewayAttempts = 0;
    let runToolCalls = 0;
    let priorResponseId;
    let nextInput = Object.freeze([{ type: "request", value: safeInput }]);
    let executedRequiredCall = false;

    try {
      for (let turn = 1; turn <= maxModelTurns; turn += 1) {
        providerAttempts += 1;
        const providerToolChoice = providerChoiceForTurn(safeChoice, executedRequiredCall);
        const response = normalizeResponse(await callWithTimeout(advanceModel, {
          runId: safeRunId,
          input: nextInput,
          tools: publicTools,
          toolChoice: providerToolChoice,
          parallelToolCalls,
          approvals: safeApprovals,
          ...(priorResponseId ? { previousResponseId: priorResponseId } : {}),
        }, timeoutMs, signal, controller, "Model function-calling turn"));
        if (usedResponseIds.has(response.responseId)) {
          throw new FunctionCallingBlock("provider_response_replayed", `Model response ${response.responseId} was repeated.`);
        }
        usedResponseIds.add(response.responseId);
        modelCosts.push(response.costLog);
        modelTurns += 1;
        const inspected = inspectItems(response.items, usedCallIds);
        validateCallsAgainstChoice(inspected.functionCalls, safeChoice);
        if (!parallelToolCalls && inspected.functionCalls.length > 1) {
          throw new FunctionCallingBlock("parallel_calls_forbidden", "The model returned parallel calls while parallel execution is disabled.");
        }
        runToolCalls += inspected.functionCalls.length;
        if (safeChoice.mode === "forced" && runToolCalls > 1) {
          throw new FunctionCallingBlock("tool_choice_violation", "Forced tool choice permits exactly one call in the run.");
        }
        if (runToolCalls > maxToolCalls) {
          throw new FunctionCallingBlock("tool_call_limit", `Function-calling run exceeds ${maxToolCalls} calls.`);
        }
        if (inspected.functionCalls.length > 0) {
          if (choiceRequiresCall(safeChoice)) executedRequiredCall = true;
          const outputs = [];
          for (let offset = 0; offset < inspected.functionCalls.length; offset += maxParallelCalls) {
            const batch = inspected.functionCalls.slice(offset, offset + maxParallelCalls);
            const batchOutputs = await Promise.all(batch.map(async (call) => {
              const tool = toolsByName.get(call.name);
              if (!tool || !tool.allowedCallers.includes("direct")) {
                throw new FunctionCallingBlock("tool_not_allowed", `Tool ${call.name} is not available for direct calls.`);
              }
              if (!tool.validateArguments(call.arguments)) {
                throw new FunctionCallingBlock("tool_arguments_invalid", `Tool ${call.name} rejected its arguments.`);
              }
              gatewayAttempts += 1;
              toolCalls += 1;
              const gatewayResult = await callWithTimeout(callTool, {
                runId: safeRunId,
                callId: call.callId,
                name: call.name,
                arguments: call.arguments,
                caller: Object.freeze({ type: "direct" }),
                approvals: safeApprovals,
                policy: Object.freeze({
                  riskClass: tool.riskClass,
                  idempotent: tool.idempotent,
                  approvalRequired: tool.approvalRequired,
                }),
              }, timeoutMs, signal, controller, `Tool ${call.name}`);
              if (!gatewayResult || typeof gatewayResult !== "object" || Array.isArray(gatewayResult)) {
                throw new FunctionCallingBlock("tool_gateway_invalid", `Tool ${call.name} returned an invalid gateway result.`);
              }
              gatewayCosts.push(normalizeCostLog(gatewayResult.costLog, "gateway"));
              if (gatewayResult.status !== "completed") {
                const reasonCode = typeof gatewayResult.reasonCode === "string" ? gatewayResult.reasonCode : "tool_gateway_blocked";
                const message = typeof gatewayResult.message === "string" ? gatewayResult.message : `Tool ${call.name} was blocked.`;
                throw new FunctionCallingBlock(reasonCode, message);
              }
              const output = normalizeJson(gatewayResult.output, `tool.${call.name}.output`);
              if (!output || typeof output !== "object" || Array.isArray(output)) {
                throw new FunctionCallingBlock("tool_output_invalid", `Tool ${call.name} output must be an object.`);
              }
              if (!tool.validateOutput(output)) {
                throw new FunctionCallingBlock("tool_output_invalid", `Tool ${call.name} returned invalid output.`);
              }
              if (serializedJsonLength(output) > maxToolResultChars) {
                throw new FunctionCallingBlock("tool_result_limit", `Tool ${call.name} output exceeds ${maxToolResultChars} characters.`);
              }
              usedToolNames.add(call.name);
              return Object.freeze({ type: "function_call_output", callId: call.callId, output });
            }));
            outputs.push(...batchOutputs);
          }
          priorResponseId = response.responseId;
          nextInput = Object.freeze([...inspected.reasoningItems, ...outputs]);
          continue;
        }

        if (inspected.message !== undefined) {
          if (choiceRequiresCall(safeChoice) && !executedRequiredCall) {
            throw new FunctionCallingBlock("tool_choice_violation", "A required function call was not made before final output.");
          }
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
              toolChoice: safeChoice,
              parallelToolCalls,
              callIdentity: "preserved",
              reasoningItemsReturned: false,
              providerExecutionStatus: "adapter-reported",
            }),
            costLog: aggregateCostLogs(modelCosts),
            gatewayCostLog: gatewayCosts.length > 0 ? aggregateCostLogs(gatewayCosts) : emptyCostLog("not-run"),
          });
        }
        priorResponseId = response.responseId;
        nextInput = inspected.reasoningItems;
      }
      throw new FunctionCallingBlock("model_turn_limit", `Function-calling run exceeds ${maxModelTurns} model turns.`);
    } catch (error) {
      blockedRuns += 1;
      const modelCost = providerAttempts === 0
        ? emptyCostLog("not-run")
        : modelCosts.length === providerAttempts
          ? aggregateCostLogs(modelCosts)
          : emptyCostLog("unreported");
      const gatewayCost = gatewayAttempts === 0
        ? emptyCostLog("not-run")
        : gatewayCosts.length === gatewayAttempts
          ? aggregateCostLogs(gatewayCosts)
          : emptyCostLog("unreported");
      if (error instanceof FunctionCallingBlock) {
        return blockedResult(safeRunId, "execute", error.reasonCode, error.message, modelCost, gatewayCost);
      }
      return blockedResult(
        safeRunId,
        "execute",
        "runtime_failed",
        error instanceof Error ? error.message : String(error),
        modelCost,
        gatewayCost,
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
      maxModelTurns,
      maxToolCalls,
      maxParallelCalls,
      maxTools,
      maxSchemaChars,
      maxToolResultChars,
      timeoutMs,
    });
  }

  return Object.freeze({ run, stats });
}

export const FUNCTION_CALLING_DEFAULTS = Object.freeze({
  maxModelTurns: DEFAULT_MAX_MODEL_TURNS, maxToolCalls: DEFAULT_MAX_TOOL_CALLS,
  maxParallelCalls: DEFAULT_MAX_PARALLEL_CALLS, maxTools: DEFAULT_MAX_TOOLS,
  maxSchemaChars: DEFAULT_MAX_SCHEMA_CHARS, maxToolResultChars: DEFAULT_MAX_TOOL_RESULT_CHARS,
  timeoutMs: DEFAULT_TIMEOUT_MS,
});
