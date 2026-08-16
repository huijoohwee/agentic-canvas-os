import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createProgrammaticToolCallingRuntime } from "../agent-api/src/programmatic-tool-calling.js";
import { selectProgrammaticToolRoute } from "../agent-api/src/programmatic-tool-routing.js";

const CAPABILITIES = Object.freeze({
  hostedSandbox: true,
  previousResponseContinuation: true,
  statelessReplay: true,
  callerLineage: true,
});

const ATTESTATION = Object.freeze({
  executionOwner: "hosted-sandbox",
  isolation: "fresh",
  intermediateResultVisibility: "sandbox-only",
  localCodeExecution: false,
});

const COST = Object.freeze({
  model: "local-dry-run",
  prompt_tokens: 0,
  completion_tokens: 0,
  cache_hits: 0,
  estimated_cost_usd: 0,
});

function tool(name, overrides = {}) {
  return {
    type: "function",
    name,
    description: `Read ${name} data.`,
    allowedCallers: ["programmatic"],
    riskClass: "read-only",
    idempotent: true,
    approvalRequired: false,
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    validateArguments: () => true,
    validateOutput: () => true,
    ...overrides,
  };
}

function response(responseId, items, overrides = {}) {
  return {
    responseId,
    status: "completed",
    runtimeAttestation: ATTESTATION,
    costLog: COST,
    items,
    ...overrides,
  };
}

function request(overrides = {}) {
  return {
    runId: "run-a",
    input: { task: "Aggregate the bounded read results." },
    tools: [tool("read_alpha"), tool("read_beta")],
    capabilities: CAPABILITIES,
    ...overrides,
  };
}

test("orchestrates hosted programs and returns only final output plus compact evidence", async () => {
  const adapterCalls = [];
  const toolCalls = [];
  const responses = [
    response("response-1", [
      { type: "program", callId: "program-1", code: "opaque generated source", fingerprint: "opaque-fingerprint-1" },
      { type: "function_call", callId: "call-a", name: "read_alpha", arguments: { key: "a" }, caller: { type: "program", callerId: "program-1", resumeToken: "opaque-caller-state" } },
      { type: "function_call", callId: "call-b", name: "read_beta", arguments: { key: "b" }, caller: { type: "program", callerId: "program-1" } },
    ]),
    response("response-2", [
      { type: "program_output", callId: "program-1", status: "completed", result: { total: 3 } },
      { type: "message", output: { total: 3, evidenceCount: 2 } },
    ]),
  ];
  const runtime = createProgrammaticToolCallingRuntime({
    advanceHostedProgram: async (call) => {
      adapterCalls.push(call);
      return responses.shift();
    },
    callTool: async (call) => {
      toolCalls.push(call);
      return { value: call.name === "read_alpha" ? 1 : 2 };
    },
  });

  const result = await runtime.run(request());

  assert.equal(result.status, "completed");
  assert.deepEqual(result.output, { evidenceCount: 2, total: 3 });
  assert.deepEqual(result.evidence.toolNames, ["read_alpha", "read_beta"]);
  assert.equal(result.evidence.hostedPrograms, 1);
  assert.equal(result.evidence.intermediateResultsReturned, false);
  assert.equal(result.evidence.localJavaScriptExecution, "forbidden");
  assert.equal(result.evidence.continuationMode, "stored");
  assert.equal(adapterCalls[1].previousResponseId, "response-1");
  assert.equal(adapterCalls[0].tools[0].allowedCallers[0], "programmatic");
  assert.equal(adapterCalls[1].input[0].type, "function_call_output");
  assert.deepEqual(adapterCalls[1].input[0].caller, { type: "program", callerId: "program-1", resumeToken: "opaque-caller-state" });
  assert.deepEqual(adapterCalls[1].input.map((item) => item.callId), ["call-a", "call-b"]);
  assert.deepEqual(toolCalls[0].caller, { type: "program", callerId: "program-1", resumeToken: "opaque-caller-state" });
  assert.equal(toolCalls.every((call) => !("code" in call)), true);
  assert.equal(JSON.stringify(result).includes("opaque generated source"), false);
  assert.deepEqual(
    {
      toolCalls: runtime.stats().toolCalls,
      succeeded: runtime.stats().toolCallsSucceeded,
      failed: runtime.stats().toolCallsFailed,
      batches: runtime.stats().toolBatches,
      partialBatches: runtime.stats().partialToolBatches,
      exhaustedBatches: runtime.stats().exhaustedToolBatches,
    },
    { toolCalls: 2, succeeded: 2, failed: 0, batches: 1, partialBatches: 0, exhaustedBatches: 0 },
  );
});

test("replays every opaque response item and caller-linked output for stateless continuation", async () => {
  const adapterCalls = [];
  const responses = [
    response("response-1", [
      { type: "program", callId: "program-1", code: "transient source", fingerprint: "opaque-fingerprint-1" },
      { type: "reasoning", encryptedContent: "opaque-reasoning" },
      { type: "function_call", callId: "call-a", name: "read_alpha", arguments: { key: "a" }, caller: { type: "program", callerId: "program-1" } },
    ]),
    response("response-2", [
      { type: "program_output", callId: "program-1", status: "completed", result: { value: 1 } },
      { type: "message", output: { value: 1 } },
    ]),
  ];
  const runtime = createProgrammaticToolCallingRuntime({
    advanceHostedProgram: async (call) => {
      adapterCalls.push(call);
      return responses.shift();
    },
    callTool: async () => ({ value: 1 }),
  });

  const result = await runtime.run(request({ continuationMode: "stateless" }));

  assert.equal(result.status, "completed");
  assert.equal(result.evidence.continuationMode, "stateless");
  assert.equal("previousResponseId" in adapterCalls[1], false);
  assert.deepEqual(
    adapterCalls[1].input.map((item) => item.type),
    ["request", "program", "reasoning", "function_call", "function_call_output"],
  );
  assert.equal(adapterCalls[1].input[1].fingerprint, "opaque-fingerprint-1");
  assert.equal(adapterCalls[1].input[2].encryptedContent, "opaque-reasoning");
  assert.deepEqual(adapterCalls[1].input[4].caller, { type: "program", callerId: "program-1" });
  assert.equal(JSON.stringify(result).includes("transient source"), false);
  assert.equal(JSON.stringify(result).includes("opaque-reasoning"), false);
});

test("selects programmatic execution only for predictable structured reductions", () => {
  const bounded = {
    toolCallCount: 3,
    predictableControlFlow: true,
    compactStructuredReduction: true,
    requiresSemanticJudgment: false,
    requiresApproval: false,
    performsMutation: false,
    requiresCitationPreservation: false,
    requiresNativeArtifactValidation: false,
  };

  assert.equal(selectProgrammaticToolRoute(bounded).route, "programmatic");
  assert.equal(selectProgrammaticToolRoute({ ...bounded, toolCallCount: 1 }).reasonCode, "single_call_sufficient");
  assert.equal(selectProgrammaticToolRoute({ ...bounded, requiresSemanticJudgment: true }).reasonCode, "semantic_judgment_required");
  assert.equal(selectProgrammaticToolRoute({ ...bounded, requiresApproval: true }).reasonCode, "authorization_boundary");
  assert.equal(selectProgrammaticToolRoute({ ...bounded, requiresCitationPreservation: true }).reasonCode, "native_evidence_required");
});

test("contains no local dynamic-code execution fallback", async () => {
  const source = await readFile(new URL("../agent-api/src/programmatic-tool-calling.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\beval\s*\(/);
  assert.doesNotMatch(source, /new\s+Function\b/);
  assert.doesNotMatch(source, /node:vm|child_process/);
});

test("blocks before provider execution when required capabilities are absent", async () => {
  let adapterCalls = 0;
  const runtime = createProgrammaticToolCallingRuntime({
    advanceHostedProgram: async () => { adapterCalls += 1; },
    callTool: async () => ({}),
  });
  const result = await runtime.run(request({
    capabilities: { ...CAPABILITIES, hostedSandbox: false },
  }));

  assert.equal(result.reasonCode, "capability_unsupported");
  assert.equal(result.costLog.model, "not-run");
  assert.equal(adapterCalls, 0);

  const stateless = await runtime.run(request({
    runId: "run-stateless",
    continuationMode: "stateless",
    capabilities: { ...CAPABILITIES, statelessReplay: false },
  }));
  assert.equal(stateless.reasonCode, "capability_unsupported");
  assert.equal(adapterCalls, 0);
});

test("keeps an unconfigured app boundary fail-closed", async () => {
  const runtime = createProgrammaticToolCallingRuntime();
  const result = await runtime.run(request());

  assert.equal(result.reasonCode, "runtime_unconfigured");
  assert.equal(runtime.stats().adapterConfigured, false);
  assert.equal(runtime.stats().toolGatewayConfigured, false);
});

test("requires direct routing for mutation, non-idempotency, or approval", async () => {
  let gatewayCalls = 0;
  const runtime = createProgrammaticToolCallingRuntime({
    advanceHostedProgram: async () => response("response-1", [
      { type: "program", callId: "program-1", code: "opaque", fingerprint: "opaque-fingerprint-1" },
      { type: "function_call", callId: "call-a", name: "write_record", arguments: {}, caller: { type: "program", callerId: "program-1" } },
    ]),
    callTool: async () => { gatewayCalls += 1; return {}; },
  });
  const result = await runtime.run(request({
    tools: [tool("write_record", { riskClass: "mutation", idempotent: false })],
  }));

  assert.equal(result.reasonCode, "direct_call_required");
  assert.equal(gatewayCalls, 0);

  const approvalRuntime = createProgrammaticToolCallingRuntime({
    advanceHostedProgram: async () => response("response-approval", [
      { type: "program", callId: "program-approval", code: "opaque", fingerprint: "opaque-fingerprint-approval" },
      { type: "function_call", callId: "call-approval", name: "read_alpha", arguments: {}, caller: { type: "program", callerId: "program-approval" } },
    ]),
    callTool: async () => { gatewayCalls += 1; return {}; },
  });
  const approvalResult = await approvalRuntime.run(request({
    runId: "run-approval",
    tools: [tool("read_alpha", { approvalRequired: true })],
  }));
  assert.equal(approvalResult.reasonCode, "direct_call_required");
  assert.equal(gatewayCalls, 0);
});

test("rejects missing hosted-sandbox attestation and invalid caller lineage", async () => {
  const unattested = createProgrammaticToolCallingRuntime({
    advanceHostedProgram: async () => response("response-1", [], { runtimeAttestation: {} }),
    callTool: async () => ({}),
  });
  assert.equal((await unattested.run(request())).reasonCode, "hosted_sandbox_unverified");

  const unlinked = createProgrammaticToolCallingRuntime({
    advanceHostedProgram: async () => response("response-1", [
      { type: "function_call", callId: "call-a", name: "read_alpha", arguments: {}, caller: { type: "program", callerId: "unknown" } },
    ]),
    callTool: async () => ({}),
  });
  assert.equal((await unlinked.run(request())).reasonCode, "caller_lineage_invalid");

  const missingFingerprint = createProgrammaticToolCallingRuntime({
    advanceHostedProgram: async () => response("response-fingerprint", [
      { type: "program", callId: "program-fingerprint", code: "opaque" },
    ]),
    callTool: async () => ({}),
  });
  assert.equal((await missingFingerprint.run(request({ runId: "run-fingerprint" }))).reasonCode, "program_invalid");
});

test("enforces program, tool-call, and result bounds", async () => {
  const oversizedProgram = createProgrammaticToolCallingRuntime({
    maxProgramChars: 4,
    advanceHostedProgram: async () => response("response-1", [
      { type: "program", callId: "program-1", code: "12345", fingerprint: "opaque-fingerprint-1" },
    ]),
    callTool: async () => ({}),
  });
  assert.equal((await oversizedProgram.run(request())).reasonCode, "program_limit");

  const tooManyCalls = createProgrammaticToolCallingRuntime({
    maxToolCalls: 1,
    advanceHostedProgram: async () => response("response-1", [
      { type: "program", callId: "program-1", code: "opaque", fingerprint: "opaque-fingerprint-1" },
      { type: "function_call", callId: "call-a", name: "read_alpha", arguments: {}, caller: { type: "program", callerId: "program-1" } },
      { type: "function_call", callId: "call-b", name: "read_beta", arguments: {}, caller: { type: "program", callerId: "program-1" } },
    ]),
    callTool: async () => ({}),
  });
  assert.equal((await tooManyCalls.run(request())).reasonCode, "tool_call_limit");

  const oversizedAdapterCalls = [];
  const oversizedResponses = [
    response("response-1", [
      { type: "program", callId: "program-1", code: "opaque", fingerprint: "opaque-fingerprint-1" },
      { type: "function_call", callId: "call-a", name: "read_alpha", arguments: {}, caller: { type: "program", callerId: "program-1" } },
    ]),
    response("response-2", [{ type: "message", output: { available: false } }]),
  ];
  const oversizedResult = createProgrammaticToolCallingRuntime({
    maxToolResultChars: 5,
    advanceHostedProgram: async (call) => {
      oversizedAdapterCalls.push(call);
      return oversizedResponses.shift();
    },
    callTool: async () => ({ value: "too-large" }),
  });
  const oversized = await oversizedResult.run(request());
  assert.equal(oversized.status, "completed");
  assert.deepEqual(oversizedAdapterCalls[1].input[0].output, {
    schema: "programmatic-tool-call-failure/v1",
    status: "failed",
    reasonCode: "tool_result_limit",
    retryable: false,
  });
  assert.deepEqual(
    {
      attempted: oversized.evidence.toolSettlement.attempted,
      failed: oversized.evidence.toolSettlement.failed,
      exhaustedBatches: oversized.evidence.toolSettlement.exhaustedBatches,
    },
    { attempted: 1, failed: 1, exhaustedBatches: 1 },
  );
});

test("validates tool arguments and outputs at the application gateway", async () => {
  const runtime = createProgrammaticToolCallingRuntime({
    advanceHostedProgram: async () => response("response-1", [
      { type: "program", callId: "program-1", code: "opaque", fingerprint: "opaque-fingerprint-1" },
      { type: "function_call", callId: "call-a", name: "read_alpha", arguments: { invalid: true }, caller: { type: "program", callerId: "program-1" } },
    ]),
    callTool: async () => ({}),
  });
  const result = await runtime.run(request({
    tools: [tool("read_alpha", { validateArguments: () => false })],
  }));

  assert.equal(result.reasonCode, "tool_arguments_invalid");

  const invalidOutputAdapterCalls = [];
  const invalidOutputResponses = [
    response("response-output", [
      { type: "program", callId: "program-output", code: "opaque", fingerprint: "opaque-fingerprint-output" },
      { type: "function_call", callId: "call-output", name: "read_alpha", arguments: {}, caller: { type: "program", callerId: "program-output" } },
    ]),
    response("response-output-final", [{ type: "message", output: { available: false } }]),
  ];
  const invalidOutput = createProgrammaticToolCallingRuntime({
    advanceHostedProgram: async (call) => {
      invalidOutputAdapterCalls.push(call);
      return invalidOutputResponses.shift();
    },
    callTool: async () => ({ unexpected: true }),
  });
  const outputResult = await invalidOutput.run(request({
    runId: "run-output",
    tools: [tool("read_alpha", { validateOutput: () => false })],
  }));
  assert.equal(outputResult.status, "completed");
  assert.equal(invalidOutputAdapterCalls[1].input[0].output.reasonCode, "tool_output_invalid");
  assert.equal(outputResult.evidence.toolSettlement.failed, 1);
  assert.equal(outputResult.evidence.toolSettlement.exhaustedBatches, 1);
  assert.equal(invalidOutput.stats().toolCallsFailed, 1);
  assert.equal(invalidOutput.stats().exhaustedToolBatches, 1);

  await assert.rejects(
    () => runtime.run(request({
      runId: "run-schema",
      tools: [tool("read_alpha", { outputSchema: undefined })],
    })),
    /outputSchema/,
  );
});

test("continues a mixed tool batch with successful values and typed failure evidence", async () => {
  const adapterCalls = [];
  const responses = [
    response("response-mixed", [
      { type: "program", callId: "program-mixed", code: "opaque", fingerprint: "opaque-fingerprint-mixed" },
      { type: "function_call", callId: "call-a", name: "read_alpha", arguments: {}, caller: { type: "program", callerId: "program-mixed" } },
      { type: "function_call", callId: "call-b", name: "read_beta", arguments: {}, caller: { type: "program", callerId: "program-mixed" } },
    ]),
    response("response-mixed-final", [{ type: "message", output: { available: 1 } }]),
  ];
  const runtime = createProgrammaticToolCallingRuntime({
    advanceHostedProgram: async (call) => {
      adapterCalls.push(call);
      return responses.shift();
    },
    callTool: async ({ name }) => {
      if (name === "read_beta") throw new Error("private adapter failure");
      return { value: 1 };
    },
  });

  const result = await runtime.run(request({ runId: "run-mixed" }));

  assert.equal(result.status, "completed");
  assert.deepEqual(adapterCalls[1].input[0].output, { value: 1 });
  assert.deepEqual(adapterCalls[1].input[1].output, {
    schema: "programmatic-tool-call-failure/v1",
    status: "failed",
    reasonCode: "tool_failed",
    retryable: false,
  });
  assert.deepEqual(
    {
      attempted: result.evidence.toolSettlement.attempted,
      succeeded: result.evidence.toolSettlement.succeeded,
      failed: result.evidence.toolSettlement.failed,
      partialBatches: result.evidence.toolSettlement.partialBatches,
    },
    { attempted: 2, succeeded: 1, failed: 1, partialBatches: 1 },
  );
  assert.equal(runtime.stats().partialToolBatches, 1);
});

test("serializes duplicate run ids while allowing a later completion", async () => {
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const runtime = createProgrammaticToolCallingRuntime({
    advanceHostedProgram: async () => {
      await wait;
      return response("response-1", [{ type: "message", output: "done" }]);
    },
    callTool: async () => ({}),
  });

  const first = runtime.run(request());
  await Promise.resolve();
  const duplicate = await runtime.run(request());
  assert.equal(duplicate.reasonCode, "run_active");
  release();
  assert.equal((await first).status, "completed");
  assert.equal(runtime.stats().activeRuns, 0);
});

test("uses a bounded timeout and reports actual cost before later failure", async () => {
  const runtime = createProgrammaticToolCallingRuntime({
    timeoutMs: 10,
    advanceHostedProgram: async () => new Promise(() => {}),
    callTool: async () => ({}),
  });
  const timedOut = await runtime.run(request());
  assert.equal(timedOut.reasonCode, "timeout");
  assert.equal(timedOut.costLog.status, "unreported");
  assert.equal(timedOut.costLog.estimated_cost_usd, null);

  const costed = createProgrammaticToolCallingRuntime({
    maxModelTurns: 1,
    advanceHostedProgram: async () => response("response-1", [], {
      costLog: { ...COST, model: "provider-model", prompt_tokens: 11, completion_tokens: 2, estimated_cost_usd: 0.01 },
    }),
    callTool: async () => ({}),
  });
  const limited = await costed.run(request());
  assert.equal(limited.reasonCode, "model_turn_limit");
  assert.equal(limited.costLog.prompt_tokens, 11);
  assert.equal(limited.costLog.estimated_cost_usd, 0.01);
});

test("preserves reported cost when a later provider attempt has no usage", async () => {
  let attempts = 0;
  const runtime = createProgrammaticToolCallingRuntime({
    advanceHostedProgram: async () => {
      attempts += 1;
      if (attempts === 1) {
        return response("response-costed", [], {
          costLog: {
            ...COST,
            model: "provider-model",
            prompt_tokens: 11,
            completion_tokens: 2,
            cache_hits: 1,
            estimated_cost_usd: 0.01,
          },
        });
      }
      throw new Error("provider unavailable");
    },
    callTool: async () => ({}),
  });

  const result = await runtime.run(request({ runId: "run-partial-cost" }));

  assert.equal(result.reasonCode, "provider_failed");
  assert.deepEqual(result.costLog, {
    model: "provider-model",
    prompt_tokens: 11,
    completion_tokens: 2,
    cache_hits: 1,
    estimated_cost_usd: 0.01,
    status: "partial",
    reportedTurns: 1,
    unreportedTurns: 1,
  });
});
