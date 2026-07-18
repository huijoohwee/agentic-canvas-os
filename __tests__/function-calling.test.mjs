import test from "node:test";
import assert from "node:assert/strict";

import { createFunctionCallingRuntime } from "../agent-api/src/function-calling.js";

const CAPABILITIES = Object.freeze({
  functionCalling: true,
  strictSchemas: true,
  parallelFunctionCalls: true,
  previousResponseContinuation: true,
  reasoningItemReplay: true,
});

const COST = Object.freeze({
  model: "offline-contract-adapter",
  prompt_tokens: 0,
  completion_tokens: 0,
  cache_hits: 0,
  cached_tokens: 0,
  cache_write_tokens: 0,
  provider_cache_status: "unreported",
  estimated_cost_usd: 0,
});

const OBJECT_SCHEMA = Object.freeze({
  type: "object",
  properties: { value: { type: ["string", "null"] } },
  required: ["value"],
  additionalProperties: false,
});

function tool(name, overrides = {}) {
  return {
    type: "function",
    name,
    description: `Access ${name} data.`,
    parameters: OBJECT_SCHEMA,
    strict: true,
    outputSchema: OBJECT_SCHEMA,
    allowedCallers: ["direct"],
    riskClass: "read-only",
    idempotent: true,
    approvalRequired: false,
    validateArguments: () => true,
    validateOutput: () => true,
    ...overrides,
  };
}

function response(responseId, items, overrides = {}) {
  return { responseId, status: "completed", items, costLog: COST, ...overrides };
}

function request(overrides = {}) {
  return {
    runId: "function-run-a",
    input: { task: "Use available functions when helpful." },
    tools: [tool("read_record")],
    capabilities: CAPABILITIES,
    ...overrides,
  };
}

function completedGateway(output = { value: "record" }, overrides = {}) {
  return { status: "completed", output, costLog: { ...COST, model: "offline-tool-gateway" }, ...overrides };
}

test("continues by response id, replays reasoning, and preserves function call identity", async () => {
  const adapterCalls = [];
  const gatewayCalls = [];
  const responses = [
    response("response-1", [
      { type: "reasoning", encryptedContent: "opaque-active-turn-item" },
      { type: "function_call", callId: "call-1", name: "read_record", arguments: { value: "a" } },
    ]),
    response("response-2", [{ type: "message", output: { answer: "record" } }]),
  ];
  const runtime = createFunctionCallingRuntime({
    advanceModel: async (call) => { adapterCalls.push(call); return responses.shift(); },
    callTool: async (call) => { gatewayCalls.push(call); return completedGateway(); },
  });

  const result = await runtime.run(request());

  assert.equal(result.status, "completed");
  assert.deepEqual(result.output, { answer: "record" });
  assert.equal(adapterCalls[1].previousResponseId, "response-1");
  assert.deepEqual(adapterCalls[1].input.map((item) => item.type), ["reasoning", "function_call_output"]);
  assert.equal(adapterCalls[1].input[0].encryptedContent, "opaque-active-turn-item");
  assert.equal(adapterCalls[1].input[1].callId, "call-1");
  assert.deepEqual(gatewayCalls[0].caller, { type: "direct" });
  assert.equal(gatewayCalls[0].callId, "call-1");
  assert.equal(JSON.stringify(result).includes("opaque-active-turn-item"), false);
  assert.equal(result.evidence.callIdentity, "preserved");
  assert.equal(result.costLog.status, "reported");
  assert.equal(result.gatewayCostLog.status, "reported");
});

test("exposes only provider function fields and forwards application policy to the gateway", async () => {
  const adapterCalls = [];
  const gatewayCalls = [];
  const runtime = createFunctionCallingRuntime({
    advanceModel: async (call) => {
      adapterCalls.push(call);
      return adapterCalls.length === 1
        ? response("response-1", [{ type: "function_call", callId: "call-1", name: "write_record", arguments: { value: "x" } }])
        : response("response-2", [{ type: "message", output: "done" }]);
    },
    callTool: async (call) => { gatewayCalls.push(call); return completedGateway(); },
  });
  const result = await runtime.run(request({
    approvals: [{ gate: "record-write", decision: "approved" }],
    tools: [tool("write_record", { riskClass: "mutation", idempotent: false, approvalRequired: true })],
  }));

  assert.equal(result.status, "completed");
  assert.deepEqual(Object.keys(adapterCalls[0].tools[0]).sort(), ["description", "name", "parameters", "strict", "type"]);
  assert.deepEqual(adapterCalls[0].approvals, [{ decision: "approved", gate: "record-write" }]);
  assert.deepEqual(gatewayCalls[0].policy, { riskClass: "mutation", idempotent: false, approvalRequired: true });
  assert.deepEqual(gatewayCalls[0].approvals, [{ decision: "approved", gate: "record-write" }]);
});

test("executes bounded parallel calls and blocks parallel output when disabled", async () => {
  const calls = [];
  const parallel = createFunctionCallingRuntime({
    maxParallelCalls: 2,
    advanceModel: async ({ previousResponseId }) => previousResponseId
      ? response("response-2", [{ type: "message", output: "done" }])
      : response("response-1", [
        { type: "function_call", callId: "call-a", name: "read_a", arguments: { value: "a" } },
        { type: "function_call", callId: "call-b", name: "read_b", arguments: { value: "b" } },
      ]),
    callTool: async (call) => { calls.push(call.name); return completedGateway({ value: call.name }); },
  });
  const tools = [tool("read_a"), tool("read_b")];
  const completed = await parallel.run(request({ tools }));
  assert.equal(completed.status, "completed");
  assert.deepEqual(calls.sort(), ["read_a", "read_b"]);

  const serial = createFunctionCallingRuntime({
    advanceModel: async () => response("response-1", [
      { type: "function_call", callId: "call-a", name: "read_a", arguments: { value: "a" } },
      { type: "function_call", callId: "call-b", name: "read_b", arguments: { value: "b" } },
    ]),
    callTool: async () => completedGateway(),
  });
  const blocked = await serial.run(request({ tools, parallelToolCalls: false }));
  assert.equal(blocked.reasonCode, "parallel_calls_forbidden");
  assert.equal(blocked.gatewayCostLog.status, "not-run");
});

test("enforces none, required, forced, and allowed tool choices", async () => {
  const finalOnly = () => createFunctionCallingRuntime({
    advanceModel: async () => response("response-1", [{ type: "message", output: "final" }]),
    callTool: async () => completedGateway(),
  });
  assert.equal((await finalOnly().run(request({ toolChoice: { mode: "required" } }))).reasonCode, "tool_choice_violation");
  assert.equal((await finalOnly().run(request({ toolChoice: { mode: "forced", name: "read_record" } }))).reasonCode, "tool_choice_violation");

  const calling = (name) => createFunctionCallingRuntime({
    advanceModel: async () => response("response-1", [
      { type: "function_call", callId: "call-1", name, arguments: { value: "x" } },
    ]),
    callTool: async () => completedGateway(),
  });
  assert.equal((await calling("read_record").run(request({ toolChoice: { mode: "none" } }))).reasonCode, "tool_choice_violation");
  assert.equal((await calling("read_record").run(request({
    tools: [tool("read_record"), tool("read_other")],
    toolChoice: { mode: "allowed", names: ["read_other"] },
  }))).reasonCode, "tool_choice_violation");
  assert.equal((await calling("read_other").run(request({
    tools: [tool("read_record"), tool("read_other")],
    toolChoice: { mode: "forced", name: "read_record" },
  }))).reasonCode, "tool_choice_violation");

  let forcedTurns = 0;
  const repeatedForced = createFunctionCallingRuntime({
    advanceModel: async () => response(`response-${forcedTurns += 1}`, [
      { type: "function_call", callId: `call-${forcedTurns}`, name: "read_record", arguments: { value: "x" } },
    ]),
    callTool: async () => completedGateway(),
  });
  assert.equal((await repeatedForced.run(request({
    runId: "repeated-forced",
    toolChoice: { mode: "forced", name: "read_record" },
  }))).reasonCode, "tool_choice_violation");
});

test("rejects lax schemas before model or gateway execution", async () => {
  let adapterCalls = 0;
  const runtime = createFunctionCallingRuntime({
    advanceModel: async () => { adapterCalls += 1; return response("x", []); },
    callTool: async () => completedGateway(),
  });
  await assert.rejects(
    () => runtime.run(request({ tools: [tool("read_record", {
      parameters: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
    })] })),
    /additionalProperties/,
  );
  await assert.rejects(
    () => runtime.run(request({ runId: "schema-run-2", tools: [tool("read_record", {
      parameters: { type: "object", properties: { value: { type: "string" } }, required: [], additionalProperties: false },
    })] })),
    /required/,
  );
  assert.equal(adapterCalls, 0);
});

test("blocks unavailable tools, duplicate call ids, and ambiguous final items", async () => {
  const runtimeFor = (items) => createFunctionCallingRuntime({
    advanceModel: async () => response("response-1", items),
    callTool: async () => completedGateway(),
  });
  assert.equal((await runtimeFor([
    { type: "function_call", callId: "call-1", name: "missing", arguments: {} },
  ]).run(request())).reasonCode, "tool_not_allowed");
  assert.equal((await runtimeFor([
    { type: "function_call", callId: "call-1", name: "read_record", arguments: {} },
    { type: "function_call", callId: "call-1", name: "read_record", arguments: {} },
  ]).run(request())).reasonCode, "function_call_replayed");
  assert.equal((await runtimeFor([
    { type: "function_call", callId: "call-1", name: "read_record", arguments: {} },
    { type: "message", output: "too early" },
  ]).run(request())).reasonCode, "provider_item_invalid");

  let responseTurns = 0;
  const repeatedResponse = createFunctionCallingRuntime({
    advanceModel: async () => response("same-response", responseTurns++ === 0
      ? [{ type: "function_call", callId: "call-1", name: "read_record", arguments: {} }]
      : [{ type: "message", output: "replayed" }]),
    callTool: async () => completedGateway(),
  });
  assert.equal((await repeatedResponse.run(request({ runId: "repeated-response" }))).reasonCode, "provider_response_replayed");
});

test("keeps approval and policy blocks typed with returned gateway cost", async () => {
  const runtime = createFunctionCallingRuntime({
    advanceModel: async () => response("response-1", [
      { type: "function_call", callId: "call-1", name: "write_record", arguments: { value: "x" } },
    ]),
    callTool: async () => completedGateway(undefined, {
      status: "blocked",
      reasonCode: "approval_required",
      message: "Operator approval is required.",
    }),
  });
  const result = await runtime.run(request({
    tools: [tool("write_record", { riskClass: "mutation", approvalRequired: true })],
  }));
  assert.equal(result.reasonCode, "approval_required");
  assert.equal(result.gatewayCostLog.status, "reported");
  assert.equal(result.costLog.status, "reported");
});

test("validates arguments, outputs, and result size at the application boundary", async () => {
  const adapter = async () => response("response-1", [
    { type: "function_call", callId: "call-1", name: "read_record", arguments: { value: "x" } },
  ]);
  const invalidArguments = createFunctionCallingRuntime({ advanceModel: adapter, callTool: async () => completedGateway() });
  assert.equal((await invalidArguments.run(request({
    tools: [tool("read_record", { validateArguments: () => false })],
  }))).reasonCode, "tool_arguments_invalid");

  const invalidOutput = createFunctionCallingRuntime({ advanceModel: adapter, callTool: async () => completedGateway() });
  assert.equal((await invalidOutput.run(request({
    runId: "invalid-output",
    tools: [tool("read_record", { validateOutput: () => false })],
  }))).reasonCode, "tool_output_invalid");

  const oversized = createFunctionCallingRuntime({
    maxToolResultChars: 5,
    advanceModel: adapter,
    callTool: async () => completedGateway({ value: "too-large" }),
  });
  assert.equal((await oversized.run(request({ runId: "oversized-output" }))).reasonCode, "tool_result_limit");
});

test("blocks unsupported capabilities and unconfigured execution before spend", async () => {
  let adapterCalls = 0;
  const runtime = createFunctionCallingRuntime({
    advanceModel: async () => { adapterCalls += 1; return response("response-1", []); },
    callTool: async () => completedGateway(),
  });
  const unsupported = await runtime.run(request({
    capabilities: { ...CAPABILITIES, reasoningItemReplay: false },
  }));
  assert.equal(unsupported.reasonCode, "capability_unsupported");
  assert.equal(unsupported.costLog.status, "not-run");
  assert.equal(adapterCalls, 0);

  const noParallel = await runtime.run(request({
    runId: "no-parallel-capability",
    capabilities: { ...CAPABILITIES, parallelFunctionCalls: false },
  }));
  assert.equal(noParallel.reasonCode, "capability_unsupported");
  assert.equal(adapterCalls, 0);

  const unconfigured = await createFunctionCallingRuntime().run(request());
  assert.equal(unconfigured.reasonCode, "runtime_unconfigured");
});

test("serializes duplicate run ids and releases the owner after completion", async () => {
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const runtime = createFunctionCallingRuntime({
    advanceModel: async () => { await wait; return response("response-1", [{ type: "message", output: "done" }]); },
    callTool: async () => completedGateway(),
  });
  const first = runtime.run(request());
  await Promise.resolve();
  const duplicate = await runtime.run(request());
  assert.equal(duplicate.reasonCode, "run_active");
  release();
  assert.equal((await first).status, "completed");
  assert.equal(runtime.stats().activeRuns, 0);
});

test("bounds calls and turns while preserving honest attempted-cost states", async () => {
  const tooManyCalls = createFunctionCallingRuntime({
    maxToolCalls: 1,
    advanceModel: async () => response("response-1", [
      { type: "function_call", callId: "call-a", name: "read_a", arguments: {} },
      { type: "function_call", callId: "call-b", name: "read_b", arguments: {} },
    ]),
    callTool: async () => completedGateway(),
  });
  assert.equal((await tooManyCalls.run(request({ tools: [tool("read_a"), tool("read_b")] }))).reasonCode, "tool_call_limit");

  const noFinal = createFunctionCallingRuntime({
    maxModelTurns: 1,
    advanceModel: async () => response("response-1", [{ type: "reasoning", opaque: "active" }]),
    callTool: async () => completedGateway(),
  });
  const limited = await noFinal.run(request({ runId: "turn-limit" }));
  assert.equal(limited.reasonCode, "model_turn_limit");
  assert.equal(limited.costLog.status, "reported");

  const timedOut = createFunctionCallingRuntime({
    timeoutMs: 10,
    advanceModel: async () => new Promise(() => {}),
    callTool: async () => completedGateway(),
  });
  const timeout = await timedOut.run(request({ runId: "timeout" }));
  assert.equal(timeout.reasonCode, "timeout");
  assert.equal(timeout.costLog.status, "unreported");
  assert.equal(timeout.costLog.estimated_cost_usd, null);

  let modelTurns = 0;
  const partialModelCost = createFunctionCallingRuntime({
    advanceModel: async () => modelTurns++ === 0
      ? response("response-1", [{ type: "function_call", callId: "call-1", name: "read_record", arguments: {} }])
      : { responseId: "response-2", status: "completed", items: [{ type: "message", output: "done" }] },
    callTool: async () => completedGateway(),
  });
  const missingLaterModelCost = await partialModelCost.run(request({ runId: "partial-model-cost" }));
  assert.equal(missingLaterModelCost.reasonCode, "model_cost_log_missing");
  assert.equal(missingLaterModelCost.costLog.status, "unreported");

  const partialGatewayCost = createFunctionCallingRuntime({
    advanceModel: async () => response("response-1", [
      { type: "function_call", callId: "call-a", name: "read_a", arguments: {} },
      { type: "function_call", callId: "call-b", name: "read_b", arguments: {} },
    ]),
    callTool: async ({ name }) => name === "read_a" ? completedGateway() : { status: "completed", output: { value: "b" } },
  });
  const missingPartialGatewayCost = await partialGatewayCost.run(request({
    runId: "partial-gateway-cost",
    tools: [tool("read_a"), tool("read_b")],
  }));
  assert.equal(missingPartialGatewayCost.reasonCode, "gateway_cost_log_missing");
  assert.equal(missingPartialGatewayCost.gatewayCostLog.status, "unreported");
});
