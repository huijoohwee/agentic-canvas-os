import { normalizeJson, serializedJsonLength } from "./json-contract.js";
import {
  failSoftBranchFailure,
  failSoftFanOut,
} from "../../src/fail-soft-fan-out.js";

import {
  DEFAULT_MAX_MODEL_TURNS, DEFAULT_MAX_TOOL_CALLS, DEFAULT_MAX_PARALLEL_CALLS, DEFAULT_MAX_PROGRAM_CHARS,
  DEFAULT_MAX_TOOL_RESULT_CHARS, DEFAULT_TIMEOUT_MS, READ_ONLY_RISK, RuntimeBlock,
  assertPositiveInteger, assertIdentifier, normalizeCapabilities, normalizeContinuationMode,
  normalizeToolDefinitions, publicToolDeclarations, aggregateCostLogs, normalizeResponse,
  inspectItems, aggregateAttemptCostLogs, blockedResult, createToolSettlement,
  publicToolSettlement, toolFailureReason, failureOutput, runWithDeadline,
} from "./programmatic-tool-contract.js";

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
  let toolCallsSucceeded = 0;
  let toolCallsFailed = 0;
  let toolDeadlineExceeded = 0;
  let toolBatches = 0;
  let partialToolBatches = 0;
  let exhaustedToolBatches = 0;
  let hostedPrograms = 0;

  function prepareFunctionCalls(calls, toolsByName) {
    return Object.freeze(calls.map((call) => {
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
  }

  function recordToolBatch(settlement, result, offset, ordinalBase) {
    settlement.attempted += result.attempted;
    settlement.succeeded += result.succeeded;
    settlement.failed += result.failed;
    settlement.deadlineExceeded += result.timedOut;
    settlement.canceled += result.canceled;
    settlement.batches += 1;
    settlement.partialBatches += Number(result.succeeded > 0 && result.failed > 0);
    settlement.exhaustedBatches += Number(result.attempted > 0 && result.succeeded === 0);
    toolCalls += result.attempted;
    toolCallsSucceeded += result.succeeded;
    toolCallsFailed += result.failed;
    toolDeadlineExceeded += result.timedOut;
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
    settlement,
    ordinalBase,
  }) {
    const prepared = prepareFunctionCalls(calls, toolsByName);
    const outputs = [];
    for (let offset = 0; offset < prepared.length; offset += maxParallelCalls) {
      const batch = prepared.slice(offset, offset + maxParallelCalls);
      const result = await failSoftFanOut(batch, async ({ call, tool }, index, branchSignal) => {
        let rawOutput;
        try {
          rawOutput = await callTool({
            runId,
            callId: call.callId,
            name: call.name,
            arguments: call.arguments,
            caller: call.caller,
            signal: branchSignal,
          });
        } catch {
          throw failSoftBranchFailure("branch_unavailable");
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
      }, { signal, timeoutMs });
      recordToolBatch(settlement, result, offset, ordinalBase);
      if (signal?.aborted) {
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
          if (signal?.aborted) {
            throw new RuntimeBlock("aborted", "Programmatic tool run was aborted.");
          }
          providerAttempts += 1;
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
            () => advanceHostedProgram(adapterRequest),
            signal,
            timeoutMs,
            controller,
          );
        } catch (error) {
          if (error instanceof RuntimeBlock) throw error;
          throw new RuntimeBlock("provider_failed", `Hosted program adapter failed: ${error instanceof Error ? error.message : String(error)}`);
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
            signal,
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
            costLog: aggregateCostLogs(costLogs),
          });
        }
        nextInput = safeContinuationMode === "stateless"
          ? Object.freeze([...transcript])
          : Object.freeze([]);
      }
      throw new RuntimeBlock("model_turn_limit", `Programmatic run exceeds ${maxModelTurns} model turns.`);
    } catch (error) {
      blockedRuns += 1;
      const costLog = aggregateAttemptCostLogs(costLogs, providerAttempts);
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
        error instanceof Error ? error.message : String(error),
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
      toolGatewayConfigured,
      activeRuns: activeRuns.size,
      completedRuns,
      blockedRuns,
      modelTurns,
      toolCalls,
      toolCallsSucceeded,
      toolCallsFailed,
      toolDeadlineExceeded,
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
