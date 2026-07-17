import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createProgrammaticToolCallingRuntime } from "../agent-api/src/programmatic-tool-calling.js";

const CAPABILITIES = Object.freeze({
  hostedSandbox: true,
  previousResponseContinuation: true,
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
    name,
    callerModes: ["programmatic"],
    riskClass: "read-only",
    idempotent: true,
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
      { type: "program", callId: "program-1", code: "opaque generated source" },
      { type: "tool_call", callId: "call-a", name: "read_alpha", arguments: { key: "a" }, caller: { type: "program", callId: "program-1" } },
      { type: "tool_call", callId: "call-b", name: "read_beta", arguments: { key: "b" }, caller: { type: "program", callId: "program-1" } },
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
  assert.equal(adapterCalls[1].previousResponseId, "response-1");
  assert.deepEqual(adapterCalls[1].input.map((item) => item.callId), ["call-a", "call-b"]);
  assert.equal(toolCalls.every((call) => !("code" in call)), true);
  assert.equal(JSON.stringify(result).includes("opaque generated source"), false);
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
});

test("keeps an unconfigured app boundary fail-closed", async () => {
  const runtime = createProgrammaticToolCallingRuntime();
  const result = await runtime.run(request());

  assert.equal(result.reasonCode, "runtime_unconfigured");
  assert.equal(runtime.stats().adapterConfigured, false);
  assert.equal(runtime.stats().toolGatewayConfigured, false);
});

test("requires direct routing for mutating or non-idempotent tools", async () => {
  let gatewayCalls = 0;
  const runtime = createProgrammaticToolCallingRuntime({
    advanceHostedProgram: async () => response("response-1", [
      { type: "program", callId: "program-1", code: "opaque" },
      { type: "tool_call", callId: "call-a", name: "write_record", arguments: {}, caller: { type: "program", callId: "program-1" } },
    ]),
    callTool: async () => { gatewayCalls += 1; return {}; },
  });
  const result = await runtime.run(request({
    tools: [tool("write_record", { riskClass: "mutation", idempotent: false })],
  }));

  assert.equal(result.reasonCode, "direct_call_required");
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
      { type: "tool_call", callId: "call-a", name: "read_alpha", arguments: {}, caller: { type: "program", callId: "unknown" } },
    ]),
    callTool: async () => ({}),
  });
  assert.equal((await unlinked.run(request())).reasonCode, "caller_lineage_invalid");
});

test("enforces program, tool-call, and result bounds", async () => {
  const oversizedProgram = createProgrammaticToolCallingRuntime({
    maxProgramChars: 4,
    advanceHostedProgram: async () => response("response-1", [
      { type: "program", callId: "program-1", code: "12345" },
    ]),
    callTool: async () => ({}),
  });
  assert.equal((await oversizedProgram.run(request())).reasonCode, "program_limit");

  const tooManyCalls = createProgrammaticToolCallingRuntime({
    maxToolCalls: 1,
    advanceHostedProgram: async () => response("response-1", [
      { type: "program", callId: "program-1", code: "opaque" },
      { type: "tool_call", callId: "call-a", name: "read_alpha", arguments: {}, caller: { type: "program", callId: "program-1" } },
      { type: "tool_call", callId: "call-b", name: "read_beta", arguments: {}, caller: { type: "program", callId: "program-1" } },
    ]),
    callTool: async () => ({}),
  });
  assert.equal((await tooManyCalls.run(request())).reasonCode, "tool_call_limit");

  const oversizedResult = createProgrammaticToolCallingRuntime({
    maxToolResultChars: 5,
    advanceHostedProgram: async () => response("response-1", [
      { type: "program", callId: "program-1", code: "opaque" },
      { type: "tool_call", callId: "call-a", name: "read_alpha", arguments: {}, caller: { type: "program", callId: "program-1" } },
    ]),
    callTool: async () => ({ value: "too-large" }),
  });
  assert.equal((await oversizedResult.run(request())).reasonCode, "tool_result_limit");
});

test("validates tool arguments and outputs at the application gateway", async () => {
  const runtime = createProgrammaticToolCallingRuntime({
    advanceHostedProgram: async () => response("response-1", [
      { type: "program", callId: "program-1", code: "opaque" },
      { type: "tool_call", callId: "call-a", name: "read_alpha", arguments: { invalid: true }, caller: { type: "program", callId: "program-1" } },
    ]),
    callTool: async () => ({}),
  });
  const result = await runtime.run(request({
    tools: [tool("read_alpha", { validateArguments: () => false })],
  }));

  assert.equal(result.reasonCode, "tool_arguments_invalid");
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
