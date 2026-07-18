import { normalizeJson, serializedJsonLength } from "./json-contract.js";
import {
  createFunctionContinuationState,
  functionToolFingerprint,
  restoreFunctionContinuationState,
} from "./function-calling-continuation.js";
import {
  normalizeCapabilities,
  normalizeToolChoice,
  normalizeTools,
  publicToolDeclarations,
} from "./function-calling-contract.js";
import {
  aggregateCostLogs,
  assertIdentifier,
  blockedResult,
  callWithTimeout,
  emptyCostLog,
  FunctionCallingBlock,
  normalizeCostLog,
} from "./function-calling-runtime-support.js";

const DEFAULT_MAX_MODEL_TURNS = 8;
const DEFAULT_MAX_TOOL_CALLS = 32;
const DEFAULT_MAX_PARALLEL_CALLS = 8;
const DEFAULT_MAX_TOOLS = 128;
const DEFAULT_MAX_SCHEMA_CHARS = 100_000;
const DEFAULT_MAX_TOOL_RESULT_CHARS = 200_000;
const DEFAULT_TIMEOUT_MS = 60_000;

function assertPositiveInteger(value, field) {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${field} must be a positive integer.`);
  return value;
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
  let pausedRuns = 0;
  let resumedRuns = 0;
  let modelTurns = 0;
  let toolCalls = 0;

  function prepare({ runId, tools, capabilities, toolChoice, parallelToolCalls = true }) {
    const safeRunId = assertIdentifier(runId, "runId");
    const safeTools = normalizeTools(tools, { maxTools, maxSchemaChars });
    const toolsByName = new Map(safeTools.map((tool) => [tool.name, tool]));
    const publicTools = publicToolDeclarations(safeTools);
    const safeChoice = normalizeToolChoice(toolChoice, new Set(toolsByName.keys()));
    const supported = normalizeCapabilities(capabilities);
    if (typeof parallelToolCalls !== "boolean") throw new TypeError("parallelToolCalls must be boolean.");

    return { safeRunId, safeTools, toolsByName, publicTools, safeChoice, supported, parallelToolCalls };
  }

  function preflight(context) {
    const notRun = emptyCostLog("not-run");
    if (activeRuns.has(context.safeRunId)) {
      return blockedResult(context.safeRunId, "preflight", "run_active", "A run with this id is already active.", notRun, notRun);
    }
    if (!adapterConfigured || !toolGatewayConfigured) {
      return blockedResult(context.safeRunId, "preflight", "runtime_unconfigured", "Function calling requires model and tool-gateway adapters.", notRun, notRun);
    }
    const capabilities = context.supported;
    if (!capabilities.functionCalling || !capabilities.strictSchemas
      || !capabilities.previousResponseContinuation || !capabilities.reasoningItemReplay) {
      return blockedResult(context.safeRunId, "preflight", "capability_unsupported", "Declared capabilities do not support strict continued function calling.", notRun, notRun);
    }
    if (context.parallelToolCalls && !capabilities.parallelFunctionCalls) {
      return blockedResult(context.safeRunId, "preflight", "capability_unsupported", "Parallel function calls were requested but are unsupported.", notRun, notRun);
    }
    return null;
  }

  function continuation(context, state, responseId, reasoningItems, pendingCall, reviewState, nextTurn) {
    return createFunctionContinuationState({
      runId: context.safeRunId,
      toolFingerprint: functionToolFingerprint(context.safeTools),
      capabilities: context.supported,
      toolChoice: context.safeChoice,
      parallelToolCalls: context.parallelToolCalls,
      previousResponseId: responseId,
      reasoningItems,
      pendingCall: { ...pendingCall, reviewState },
      usedCallIds: [...state.usedCallIds],
      usedResponseIds: [...state.usedResponseIds],
      usedToolNames: [...state.usedToolNames],
      modelCosts: state.modelCosts,
      gatewayCosts: state.gatewayCosts,
      providerAttempts: state.providerAttempts,
      gatewayAttempts: state.gatewayAttempts,
      runToolCalls: state.runToolCalls,
      executedRequiredCall: state.executedRequiredCall,
      nextTurn,
    });
  }

  function executionCosts(state) {
    const model = state.providerAttempts === 0
      ? emptyCostLog("not-run")
      : state.modelCosts.length === state.providerAttempts
        ? aggregateCostLogs(state.modelCosts)
        : emptyCostLog("unreported");
    const gateway = state.gatewayAttempts === 0
      ? emptyCostLog("not-run")
      : state.gatewayCosts.length === state.gatewayAttempts
        ? aggregateCostLogs(state.gatewayCosts)
        : emptyCostLog("unreported");
    return { model, gateway };
  }

  async function invokeGateway(context, state, call, signal, controller, review) {
    const tool = context.toolsByName.get(call.name);
    state.gatewayAttempts += 1;
    toolCalls += 1;
    const result = await callWithTimeout(callTool, {
      runId: context.safeRunId,
      conversationId: context.safeRunId,
      callId: call.callId,
      name: call.name,
      arguments: call.arguments,
      caller: Object.freeze({ type: "direct" }),
      policy: Object.freeze({
        revision: tool.revision,
        riskClass: tool.riskClass,
        idempotent: tool.idempotent,
        approvalRequired: tool.approvalRequired,
      }),
      ...(review ? { review } : {}),
    }, timeoutMs, signal, controller, `Tool ${call.name}`);
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new FunctionCallingBlock("tool_gateway_invalid", `Tool ${call.name} returned an invalid gateway result.`);
    }
    state.gatewayCosts.push(normalizeCostLog(result.costLog, "gateway"));
    return result;
  }

  function validateCall(context, call) {
    const tool = context.toolsByName.get(call.name);
    if (!tool || !tool.allowedCallers.includes("direct")) {
      throw new FunctionCallingBlock("tool_not_allowed", `Tool ${call.name} is not available for direct calls.`);
    }
    if (!tool.validateArguments(call.arguments)) {
      throw new FunctionCallingBlock("tool_arguments_invalid", `Tool ${call.name} rejected its arguments.`);
    }
    return tool;
  }

  function validateGatewayOutput(tool, call, gatewayResult) {
    const output = normalizeJson(gatewayResult.output, `tool.${call.name}.output`);
    if (!output || typeof output !== "object" || Array.isArray(output) || !tool.validateOutput(output)) {
      throw new FunctionCallingBlock("tool_output_invalid", `Tool ${call.name} returned invalid output.`);
    }
    if (serializedJsonLength(output) > maxToolResultChars) {
      throw new FunctionCallingBlock("tool_result_limit", `Tool ${call.name} output exceeds ${maxToolResultChars} characters.`);
    }
    return Object.freeze({ type: "function_call_output", callId: call.callId, output });
  }

  async function execute(context, state, signal, controller) {
    let priorResponseId = state.priorResponseId;
    let nextInput = state.nextInput;
    for (let turn = state.nextTurn; turn <= maxModelTurns; turn += 1) {
      state.providerAttempts += 1;
      const providerToolChoice = providerChoiceForTurn(context.safeChoice, state.executedRequiredCall);
        const response = normalizeResponse(await callWithTimeout(advanceModel, {
          runId: context.safeRunId,
          input: nextInput,
          tools: context.publicTools,
          toolChoice: providerToolChoice,
          parallelToolCalls: context.parallelToolCalls,
          ...(priorResponseId ? { previousResponseId: priorResponseId } : {}),
        }, timeoutMs, signal, controller, "Model function-calling turn"));
        if (state.usedResponseIds.has(response.responseId)) {
          throw new FunctionCallingBlock("provider_response_replayed", `Model response ${response.responseId} was repeated.`);
        }
        state.usedResponseIds.add(response.responseId);
        state.modelCosts.push(response.costLog);
        modelTurns += 1;
        const inspected = inspectItems(response.items, state.usedCallIds);
        validateCallsAgainstChoice(inspected.functionCalls, context.safeChoice);
        if (!context.parallelToolCalls && inspected.functionCalls.length > 1) {
          throw new FunctionCallingBlock("parallel_calls_forbidden", "The model returned parallel calls while parallel execution is disabled.");
        }
        state.runToolCalls += inspected.functionCalls.length;
        if (context.safeChoice.mode === "forced" && state.runToolCalls > 1) {
          throw new FunctionCallingBlock("tool_choice_violation", "Forced tool choice permits exactly one call in the run.");
        }
        if (state.runToolCalls > maxToolCalls) {
          throw new FunctionCallingBlock("tool_call_limit", `Function-calling run exceeds ${maxToolCalls} calls.`);
        }
        if (inspected.functionCalls.length > 0) {
          const selectedTools = inspected.functionCalls.map((call) => validateCall(context, call));
          if (selectedTools.some((tool) => tool.approvalRequired) && inspected.functionCalls.length !== 1) {
            throw new FunctionCallingBlock("review_parallel_forbidden", "A review-required function must be the only call in its model turn.");
          }
          if (choiceRequiresCall(context.safeChoice)) state.executedRequiredCall = true;
          const outputs = [];
          for (let offset = 0; offset < inspected.functionCalls.length; offset += maxParallelCalls) {
            const batch = inspected.functionCalls.slice(offset, offset + maxParallelCalls);
            const batchOutputs = await Promise.all(batch.map(async (call) => {
              const tool = context.toolsByName.get(call.name);
              const gatewayResult = await invokeGateway(context, state, call, signal, controller);
              if (gatewayResult.status === "paused") {
                if (!tool.approvalRequired || !tool.idempotent) {
                  throw new FunctionCallingBlock("review_continuation_unsafe", `Tool ${call.name} cannot be resumed safely.`);
                }
                const interruptions = normalizeJson(gatewayResult.interruptions, "gateway.interruptions");
                if (!Array.isArray(interruptions) || interruptions.length !== 1) {
                  throw new FunctionCallingBlock("tool_gateway_invalid", "A reviewed function must return one interruption.");
                }
                const reviewState = normalizeJson(gatewayResult.resumeState, "gateway.resumeState");
                const continuationState = continuation(
                  context, state, response.responseId, inspected.reasoningItems, call, reviewState, turn + 1,
                );
                throw new FunctionCallingBlock("review_required", `Tool ${call.name} requires human review.`, {
                  continuationState: Object.freeze({ continuationState, interruptions }),
                });
              }
              if (gatewayResult.status !== "completed") {
                const reasonCode = typeof gatewayResult.reasonCode === "string" ? gatewayResult.reasonCode : "tool_gateway_blocked";
                const message = typeof gatewayResult.message === "string" ? gatewayResult.message : `Tool ${call.name} was blocked.`;
                throw new FunctionCallingBlock(reasonCode, message);
              }
              state.usedToolNames.add(call.name);
              return validateGatewayOutput(tool, call, gatewayResult);
            }));
            outputs.push(...batchOutputs);
          }
          priorResponseId = response.responseId;
          nextInput = Object.freeze([...inspected.reasoningItems, ...outputs]);
          continue;
        }

        if (inspected.message !== undefined) {
          if (choiceRequiresCall(context.safeChoice) && !state.executedRequiredCall) {
            throw new FunctionCallingBlock("tool_choice_violation", "A required function call was not made before final output.");
          }
          completedRuns += 1;
          return Object.freeze({
            runId: context.safeRunId,
            status: "completed",
            stage: "final",
            output: inspected.message,
            evidence: Object.freeze({
              modelTurns: turn,
              toolCalls: state.runToolCalls,
              toolNames: Object.freeze([...state.usedToolNames].sort()),
              toolChoice: context.safeChoice,
              parallelToolCalls: context.parallelToolCalls,
              callIdentity: "preserved",
              reasoningItemsReturned: false,
              providerExecutionStatus: "adapter-reported",
            }),
            costLog: aggregateCostLogs(state.modelCosts),
            gatewayCostLog: state.gatewayCosts.length > 0 ? aggregateCostLogs(state.gatewayCosts) : emptyCostLog("not-run"),
          });
        }
        priorResponseId = response.responseId;
        nextInput = inspected.reasoningItems;
      }
      throw new FunctionCallingBlock("model_turn_limit", `Function-calling run exceeds ${maxModelTurns} model turns.`);
  }

  async function resumePending(context, state, resolution, signal, controller) {
    const call = state.pendingCall;
    const tool = validateCall(context, call);
    const gatewayResult = await invokeGateway(context, state, call, signal, controller, {
      state: call.reviewState,
      resolution,
    });
    if (gatewayResult.status !== "completed") {
      const reasonCode = typeof gatewayResult.reasonCode === "string" ? gatewayResult.reasonCode : "tool_gateway_blocked";
      const message = typeof gatewayResult.message === "string" ? gatewayResult.message : `Tool ${call.name} was blocked.`;
      const retryable = gatewayResult.reviewStateConsumed === false;
      const continuationState = retryable
        ? continuation(context, state, state.priorResponseId, state.nextInput, call, call.reviewState, state.nextTurn)
        : undefined;
      throw new FunctionCallingBlock(reasonCode, message, { retryable, continuationState });
    }
    state.usedToolNames.add(call.name);
    const output = validateGatewayOutput(tool, call, gatewayResult);
    return execute(context, { ...state, nextInput: Object.freeze([...state.nextInput, output]) }, signal, controller);
  }

  async function runExecution(context, state, signal, resumeResolution) {
    const blocked = preflight(context);
    if (blocked) return blocked;
    activeRuns.add(context.safeRunId);
    const controller = new AbortController();
    try {
      return resumeResolution
        ? await resumePending(context, state, resumeResolution, signal, controller)
        : await execute(context, state, signal, controller);
    } catch (error) {
      const costs = executionCosts(state);
      if (error instanceof FunctionCallingBlock) {
        if (error.reasonCode === "review_required" && error.continuationState) {
          pausedRuns += 1;
          return Object.freeze({
            runId: context.safeRunId,
            status: "paused",
            stage: "review",
            interruptions: error.continuationState.interruptions,
            continuationState: error.continuationState.continuationState,
            costLog: costs.model,
            gatewayCostLog: costs.gateway,
          });
        }
        blockedRuns += 1;
        return blockedResult(context.safeRunId, "execute", error.reasonCode, error.message, costs.model, costs.gateway, {
          retryable: error.retryable,
          continuationState: error.continuationState,
        });
      }
      blockedRuns += 1;
      return blockedResult(
        context.safeRunId,
        "execute",
        "runtime_failed",
        error instanceof Error ? error.message : String(error),
        costs.model,
        costs.gateway,
      );
    } finally {
      controller.abort();
      activeRuns.delete(context.safeRunId);
    }
  }

  async function run({ runId, input, tools, capabilities, toolChoice,
    parallelToolCalls = true, signal } = {}) {
    const safeInput = normalizeJson(input, "input");
    const context = prepare({ runId, tools, capabilities, toolChoice, parallelToolCalls });
    const state = {
      priorResponseId: undefined,
      nextInput: Object.freeze([{ type: "request", value: safeInput }]),
      nextTurn: 1,
      modelCosts: [], gatewayCosts: [], usedCallIds: new Set(), usedResponseIds: new Set(), usedToolNames: new Set(),
      providerAttempts: 0, gatewayAttempts: 0, runToolCalls: 0, executedRequiredCall: false,
    };
    return runExecution(context, state, signal);
  }

  async function resume({ continuationState, resolution, tools, signal } = {}) {
    const provisionalTools = normalizeTools(tools, { maxTools, maxSchemaChars });
    const restored = restoreFunctionContinuationState(continuationState, {
      tools: provisionalTools, maxModelTurns, maxToolCalls,
    });
    const context = prepare({
      runId: restored.runId,
      tools,
      capabilities: restored.capabilities,
      toolChoice: restored.toolChoice,
      parallelToolCalls: restored.parallelToolCalls,
    });
    resumedRuns += 1;
    const state = {
      priorResponseId: restored.previousResponseId,
      nextInput: restored.reasoningItems,
      nextTurn: restored.nextTurn,
      pendingCall: restored.pendingCall,
      modelCosts: [...restored.modelCosts], gatewayCosts: [...restored.gatewayCosts],
      usedCallIds: new Set(restored.usedCallIds), usedResponseIds: new Set(restored.usedResponseIds),
      usedToolNames: new Set(restored.usedToolNames), providerAttempts: restored.providerAttempts,
      gatewayAttempts: restored.gatewayAttempts, runToolCalls: restored.runToolCalls,
      executedRequiredCall: restored.executedRequiredCall,
    };
    return runExecution(context, state, signal, normalizeJson(resolution, "resolution"));
  }

  function stats() {
    return Object.freeze({
      adapterConfigured,
      toolGatewayConfigured,
      activeRuns: activeRuns.size,
      completedRuns,
      blockedRuns,
      pausedRuns,
      resumedRuns,
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

  return Object.freeze({ run, resume, stats });
}

export const FUNCTION_CALLING_DEFAULTS = Object.freeze({
  maxModelTurns: DEFAULT_MAX_MODEL_TURNS, maxToolCalls: DEFAULT_MAX_TOOL_CALLS,
  maxParallelCalls: DEFAULT_MAX_PARALLEL_CALLS, maxTools: DEFAULT_MAX_TOOLS,
  maxSchemaChars: DEFAULT_MAX_SCHEMA_CHARS, maxToolResultChars: DEFAULT_MAX_TOOL_RESULT_CHARS,
  timeoutMs: DEFAULT_TIMEOUT_MS,
});
