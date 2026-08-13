import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  createProgrammaticToolCallingRuntime as createRawProgrammaticToolCallingRuntime,
  programmaticToolIntegrityBlock,
} from "../agent-api/src/programmatic-tool-calling.js";
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

async function authorizeAllToolCalls({ runId, calls }) {
  return {
    decisions: calls.map((call) => ({
      callId: call.callId,
      status: "authorized",
      authorization: {
        schema: "programmatic-tool-authorization/v1",
        authorizationId: `authorization-${call.callId}`,
        policyRevision: "policy-revision-1",
        runId,
        callId: call.callId,
        toolName: call.name,
        arguments: call.arguments,
        caller: call.caller,
        policy: call.policy,
      },
    })),
  };
}

function createProgrammaticToolCallingRuntime(options = {}) {
  return createRawProgrammaticToolCallingRuntime({
    authorizeToolCalls: authorizeAllToolCalls,
    ...options,
  });
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
  assert.equal(adapterCalls[0].tools[0].outputSchema.type, "object");
  assert.equal(adapterCalls[0].tools[0].outputSchema.anyOf.length, 2);
  assert.deepEqual(
    adapterCalls[0].tools[0].outputSchema.anyOf[1].properties.reasonCode.enum,
    ["tool_canceled", "tool_deadline_exceeded", "tool_failed", "tool_output_invalid", "tool_result_limit"],
  );
  assert.equal(adapterCalls[1].input[0].type, "function_call_output");
  assert.deepEqual(adapterCalls[1].input[0].caller, { type: "program", callerId: "program-1", resumeToken: "opaque-caller-state" });
  assert.deepEqual(adapterCalls[1].input.map((item) => item.callId), ["call-a", "call-b"]);
  assert.deepEqual(toolCalls[0].caller, { type: "program", callerId: "program-1", resumeToken: "opaque-caller-state" });
  assert.equal(toolCalls[0].authorization.authorizationId, "authorization-call-a");
  assert.equal(toolCalls[0].authorization.policyRevision, "policy-revision-1");
  assert.equal(toolCalls[0].authorization.runId, "run-a");
  assert.equal(toolCalls[0].authorization.callId, "call-a");
  assert.equal(toolCalls[0].authorization.toolName, "read_alpha");
  assert.equal(toolCalls.every((call) => !("code" in call)), true);
  assert.deepEqual(
    {
      attempted: result.evidence.toolSettlement.attempted,
      dispatched: result.evidence.toolSettlement.dispatched,
      succeeded: result.evidence.toolSettlement.succeeded,
      failed: result.evidence.toolSettlement.failed,
    },
    { attempted: 2, dispatched: 2, succeeded: 2, failed: 0 },
  );
  assert.equal(JSON.stringify(result).includes("opaque generated source"), false);
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
  const runtime = createRawProgrammaticToolCallingRuntime();
  const result = await runtime.run(request());

  assert.equal(result.reasonCode, "runtime_unconfigured");
  assert.equal(runtime.stats().adapterConfigured, false);
  assert.equal(runtime.stats().toolAuthorizerConfigured, false);
  assert.equal(runtime.stats().toolExecutorConfigured, false);
  assert.equal(runtime.stats().toolGatewayConfigured, false);

  let adapterCalls = 0;
  const missingAuthorizer = createRawProgrammaticToolCallingRuntime({
    advanceHostedProgram: async () => { adapterCalls += 1; },
    callTool: async () => ({}),
  });
  assert.equal((await missingAuthorizer.run(request({ runId: "run-no-authorizer" }))).reasonCode, "runtime_unconfigured");
  assert.equal(missingAuthorizer.stats().toolAuthorizerConfigured, false);
  assert.equal(missingAuthorizer.stats().toolExecutorConfigured, true);
  assert.equal(adapterCalls, 0);
});

test("requires direct routing for mutation, non-idempotency, or approval", async () => {
  let gatewayCalls = 0;
  const runtime = createProgrammaticToolCallingRuntime({
    advanceHostedProgram: async () => response("response-1", [
      { type: "program", callId: "program-1", code: "opaque", fingerprint: "opaque-fingerprint-1" },
      { type: "function_call", callId: "call-safe", name: "read_alpha", arguments: {}, caller: { type: "program", callerId: "program-1" } },
      { type: "function_call", callId: "call-a", name: "write_record", arguments: {}, caller: { type: "program", callerId: "program-1" } },
    ]),
    callTool: async () => { gatewayCalls += 1; return {}; },
  });
  const result = await runtime.run(request({
    tools: [tool("read_alpha"), tool("write_record", { riskClass: "mutation", idempotent: false })],
  }));

  assert.equal(result.reasonCode, "direct_call_required");
  assert.equal(gatewayCalls, 0);

  const approvalRuntime = createProgrammaticToolCallingRuntime({
    advanceHostedProgram: async () => response("response-approval", [
      { type: "program", callId: "program-approval", code: "opaque", fingerprint: "opaque-fingerprint-approval" },
      { type: "function_call", callId: "call-safe", name: "read_beta", arguments: {}, caller: { type: "program", callerId: "program-approval" } },
      { type: "function_call", callId: "call-approval", name: "read_alpha", arguments: {}, caller: { type: "program", callerId: "program-approval" } },
    ]),
    callTool: async () => { gatewayCalls += 1; return {}; },
  });
  const approvalResult = await approvalRuntime.run(request({
    runId: "run-approval",
    tools: [tool("read_beta"), tool("read_alpha", { approvalRequired: true })],
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

  const oversizedResponses = [
    response("response-result", [
      { type: "program", callId: "program-result", code: "opaque", fingerprint: "opaque-fingerprint-result" },
      { type: "function_call", callId: "call-result", name: "read_alpha", arguments: {}, caller: { type: "program", callerId: "program-result" } },
    ]),
    response("response-result-final", [{ type: "message", output: { degraded: true } }]),
  ];
  const oversizedAdapterCalls = [];
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
  assert.equal(oversizedAdapterCalls[1].input[0].output.reasonCode, "tool_result_limit");
  assert.equal(oversized.evidence.toolSettlement.exhaustedBatches, 1);
});

test("validates tool arguments and outputs at the application gateway", async () => {
  let gatewayCalls = 0;
  const runtime = createProgrammaticToolCallingRuntime({
    advanceHostedProgram: async () => response("response-1", [
      { type: "program", callId: "program-1", code: "opaque", fingerprint: "opaque-fingerprint-1" },
      { type: "function_call", callId: "call-a", name: "read_alpha", arguments: {}, caller: { type: "program", callerId: "program-1" } },
      { type: "function_call", callId: "call-b", name: "read_beta", arguments: { invalid: true }, caller: { type: "program", callerId: "program-1" } },
    ]),
    callTool: async () => { gatewayCalls += 1; return {}; },
  });
  const result = await runtime.run(request({
    tools: [tool("read_alpha"), tool("read_beta", { validateArguments: () => false })],
  }));

  assert.equal(result.reasonCode, "tool_arguments_invalid");
  assert.equal(gatewayCalls, 0);

  const invalidOutputResponses = [
    response("response-output", [
      { type: "program", callId: "program-output", code: "opaque", fingerprint: "opaque-fingerprint-output" },
      { type: "function_call", callId: "call-output", name: "read_alpha", arguments: {}, caller: { type: "program", callerId: "program-output" } },
    ]),
    response("response-output-final", [{ type: "message", output: { degraded: true } }]),
  ];
  const outputAdapterCalls = [];
  const invalidOutput = createProgrammaticToolCallingRuntime({
    advanceHostedProgram: async (call) => {
      outputAdapterCalls.push(call);
      return invalidOutputResponses.shift();
    },
    callTool: async () => ({ unexpected: true }),
  });
  const outputResult = await invalidOutput.run(request({
    runId: "run-output",
    tools: [tool("read_alpha", { validateOutput: () => false })],
  }));
  assert.equal(outputResult.status, "completed");
  assert.equal(outputAdapterCalls[1].input[0].output.reasonCode, "tool_output_invalid");
  assert.equal(outputResult.evidence.toolSettlement.failed, 1);

  await assert.rejects(
    () => runtime.run(request({
      runId: "run-schema",
      tools: [tool("read_alpha", { outputSchema: undefined })],
    })),
    /outputSchema/,
  );
});

test("settles mixed and exhausted execution batches without exposing gateway errors", async () => {
  const secret = "raw-provider-secret";
  const adapterCalls = [];
  const responses = [
    response("response-mixed", [
      { type: "program", callId: "program-mixed", code: "opaque", fingerprint: "opaque-fingerprint-mixed" },
      { type: "function_call", callId: "call-a", name: "read_alpha", arguments: {}, caller: { type: "program", callerId: "program-mixed" } },
      { type: "function_call", callId: "call-b", name: "read_beta", arguments: {}, caller: { type: "program", callerId: "program-mixed" } },
    ]),
    response("response-mixed-final", [{ type: "message", output: { partial: true } }]),
  ];
  const runtime = createProgrammaticToolCallingRuntime({
    advanceHostedProgram: async (call) => {
      adapterCalls.push(call);
      return responses.shift();
    },
    callTool: async ({ name }) => {
      if (name === "read_beta") throw new Error(secret);
      return { value: 1 };
    },
  });

  const result = await runtime.run(request());
  const settlement = result.evidence.toolSettlement;
  assert.equal(result.status, "completed");
  assert.deepEqual(adapterCalls[1].input.map((item) => item.callId), ["call-a", "call-b"]);
  assert.deepEqual(adapterCalls[1].input[0].output, { value: 1 });
  assert.deepEqual(adapterCalls[1].input[1].output, {
    schema: "programmatic-tool-call-failure/v1",
    status: "failed",
    reasonCode: "tool_failed",
    retryable: false,
  });
  assert.deepEqual(
    { attempted: settlement.attempted, dispatched: settlement.dispatched, succeeded: settlement.succeeded, failed: settlement.failed, partial: settlement.partialBatches },
    { attempted: 2, dispatched: 2, succeeded: 1, failed: 1, partial: 1 },
  );
  assert.equal(JSON.stringify({ adapterCalls, result, stats: runtime.stats() }).includes(secret), false);

  const exhaustedCalls = [];
  const exhaustedResponses = [
    response("response-exhausted", [
      { type: "program", callId: "program-exhausted", code: "opaque", fingerprint: "opaque-fingerprint-exhausted" },
      { type: "function_call", callId: "call-a", name: "read_alpha", arguments: {}, caller: { type: "program", callerId: "program-exhausted" } },
      { type: "function_call", callId: "call-b", name: "read_beta", arguments: {}, caller: { type: "program", callerId: "program-exhausted" } },
    ]),
    response("response-exhausted-final", [{ type: "message", output: { available: false } }]),
  ];
  const exhaustedRuntime = createProgrammaticToolCallingRuntime({
    advanceHostedProgram: async (call) => {
      exhaustedCalls.push(call);
      return exhaustedResponses.shift();
    },
    callTool: async () => { throw new Error("private upstream detail"); },
  });
  const exhausted = await exhaustedRuntime.run(request({ runId: "run-exhausted" }));
  assert.equal(exhausted.status, "completed");
  assert.equal(exhausted.evidence.toolSettlement.exhaustedBatches, 1);
  assert.equal(exhaustedCalls[1].input.every((item) => item.output.status === "failed"), true);
});

test("whole-turn authorization denial blocks every gateway execution", async () => {
  let gatewayCalls = 0;
  const runtime = createProgrammaticToolCallingRuntime({
    authorizeToolCalls: async ({ runId, calls }) => {
      const authorized = await authorizeAllToolCalls({ runId, calls });
      return {
        decisions: authorized.decisions.map((decision, index) => (
          index === 0 ? decision : { callId: decision.callId, status: "denied" }
        )),
      };
    },
    advanceHostedProgram: async () => response("response-denied", [
      { type: "program", callId: "program-denied", code: "opaque", fingerprint: "opaque-fingerprint-denied" },
      { type: "function_call", callId: "call-a", name: "read_alpha", arguments: {}, caller: { type: "program", callerId: "program-denied" } },
      { type: "function_call", callId: "call-b", name: "read_beta", arguments: {}, caller: { type: "program", callerId: "program-denied" } },
    ]),
    callTool: async () => { gatewayCalls += 1; return {}; },
  });

  const result = await runtime.run(request({ runId: "run-denied" }));
  assert.equal(result.reasonCode, "tool_authorization_denied");
  assert.equal(gatewayCalls, 0);
  assert.equal(runtime.stats().toolCallsDispatched, 0);
  assert.equal(result.costLog.status, "reported");

  let stalledGatewayCalls = 0;
  const stalled = createProgrammaticToolCallingRuntime({
    timeoutMs: 10,
    authorizeToolCalls: async () => new Promise(() => {}),
    advanceHostedProgram: async () => response("response-stalled-authorization", [
      { type: "program", callId: "program-stalled", code: "opaque", fingerprint: "opaque-fingerprint-stalled" },
      { type: "function_call", callId: "call-stalled", name: "read_alpha", arguments: {}, caller: { type: "program", callerId: "program-stalled" } },
    ]),
    callTool: async () => { stalledGatewayCalls += 1; return {}; },
  });
  const stalledResult = await stalled.run(request({ runId: "run-stalled-authorization" }));
  assert.equal(stalledResult.reasonCode, "timeout");
  assert.equal(stalledGatewayCalls, 0);
  assert.equal(stalledResult.costLog.status, "reported");
});

test("execution-time authorization revocation blocks the batch instead of degrading", async () => {
  const providerCalls = [];
  const started = [];
  const runtime = createProgrammaticToolCallingRuntime({
    advanceHostedProgram: async (call) => {
      providerCalls.push(call);
      return response("response-revoked", [
        { type: "program", callId: "program-revoked", code: "opaque", fingerprint: "opaque-fingerprint-revoked" },
        { type: "function_call", callId: "call-a", name: "read_alpha", arguments: {}, caller: { type: "program", callerId: "program-revoked" } },
        { type: "function_call", callId: "call-b", name: "read_beta", arguments: {}, caller: { type: "program", callerId: "program-revoked" } },
      ]);
    },
    callTool: async ({ name, signal }) => {
      started.push(name);
      if (name === "read_alpha") {
        return programmaticToolIntegrityBlock("tool_authorization_revoked");
      }
      return new Promise((resolve) => signal.addEventListener("abort", () => resolve({ value: 2 }), { once: true }));
    },
  });

  const result = await runtime.run(request({ runId: "run-revoked" }));

  assert.equal(result.status, "blocked");
  assert.equal(result.reasonCode, "tool_authorization_revoked");
  assert.equal(providerCalls.length, 1, "integrity failure never reaches hosted continuation");
  assert.deepEqual(started.sort(), ["read_alpha", "read_beta"]);
  assert.equal(result.evidence.toolSettlement.failed, 2);
  assert.equal(JSON.stringify(result).includes("programmatic-tool-call-failure"), false);
});

test("authorization receipts must bind the exact run, call, tool, arguments, and policy revision", async () => {
  let gatewayCalls = 0;
  const runtime = createProgrammaticToolCallingRuntime({
    authorizeToolCalls: async ({ runId, calls }) => {
      const authorized = await authorizeAllToolCalls({ runId, calls });
      return {
        decisions: authorized.decisions.map((decision, index) => index === 0
          ? { ...decision, authorization: { ...decision.authorization, toolName: "read_beta" } }
          : decision),
      };
    },
    advanceHostedProgram: async () => response("response-drifted-authorization", [
      { type: "program", callId: "program-drifted-authorization", code: "opaque", fingerprint: "opaque-fingerprint-drifted-authorization" },
      { type: "function_call", callId: "call-a", name: "read_alpha", arguments: {}, caller: { type: "program", callerId: "program-drifted-authorization" } },
    ]),
    callTool: async () => { gatewayCalls += 1; return {}; },
  });

  const result = await runtime.run(request({ runId: "run-drifted-authorization" }));

  assert.equal(result.reasonCode, "tool_authorization_invalid");
  assert.equal(gatewayCalls, 0);
});

test("tool deadlines are per-branch and external cancellation remains top-level", async () => {
  let timedOutSignal;
  const adapterCalls = [];
  const responses = [
    response("response-timeout", [
      { type: "program", callId: "program-timeout", code: "opaque", fingerprint: "opaque-fingerprint-timeout" },
      { type: "function_call", callId: "call-a", name: "read_alpha", arguments: {}, caller: { type: "program", callerId: "program-timeout" } },
      { type: "function_call", callId: "call-b", name: "read_beta", arguments: {}, caller: { type: "program", callerId: "program-timeout" } },
    ]),
    response("response-timeout-final", [{ type: "message", output: { partial: true } }]),
  ];
  const runtime = createProgrammaticToolCallingRuntime({
    timeoutMs: 10,
    advanceHostedProgram: async (call) => {
      adapterCalls.push(call);
      return responses.shift();
    },
    callTool: async ({ name, signal }) => {
      if (name === "read_beta") return { value: 2 };
      timedOutSignal = signal;
      return new Promise(() => {});
    },
  });
  const result = await runtime.run(request({ runId: "run-branch-timeout" }));
  assert.equal(result.status, "completed");
  assert.equal(timedOutSignal.aborted, true);
  assert.equal(adapterCalls[1].input[0].output.reasonCode, "tool_deadline_exceeded");
  assert.equal(adapterCalls[1].input[0].output.retryable, false);
  assert.deepEqual(
    { deadlines: result.evidence.toolSettlement.deadlineExceeded, succeeded: result.evidence.toolSettlement.succeeded },
    { deadlines: 1, succeeded: 1 },
  );

  const external = new AbortController();
  let started = 0;
  let markStarted;
  const bothStarted = new Promise((resolve) => { markStarted = resolve; });
  const canceledRuntime = createProgrammaticToolCallingRuntime({
    advanceHostedProgram: async () => response("response-cancel", [
      { type: "program", callId: "program-cancel", code: "opaque", fingerprint: "opaque-fingerprint-cancel" },
      { type: "function_call", callId: "call-a", name: "read_alpha", arguments: {}, caller: { type: "program", callerId: "program-cancel" } },
      { type: "function_call", callId: "call-b", name: "read_beta", arguments: {}, caller: { type: "program", callerId: "program-cancel" } },
    ]),
    callTool: async () => {
      started += 1;
      if (started === 2) markStarted();
      return new Promise(() => {});
    },
  });
  const pending = canceledRuntime.run(request({ runId: "run-cancel", signal: external.signal }));
  await bothStarted;
  external.abort();
  const canceled = await pending;
  assert.equal(canceled.reasonCode, "aborted");
  assert.equal(canceled.evidence.toolSettlement.attempted, 2);
  assert.equal(canceled.evidence.toolSettlement.canceled, 2);
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
  assert.throws(
    () => createProgrammaticToolCallingRuntime({ timeoutMs: 2_147_483_648 }),
    /no greater than 2147483647/,
  );
  const runtime = createProgrammaticToolCallingRuntime({
    timeoutMs: 10,
    advanceHostedProgram: async () => new Promise(() => {}),
    callTool: async () => ({}),
  });
  const timedOut = await runtime.run(request());
  assert.equal(timedOut.reasonCode, "timeout");
  assert.equal(timedOut.costLog.status, "unreported");
  assert.equal(timedOut.costLog.estimated_cost_usd, null);

  const canceledBeforeDispatch = new AbortController();
  let providerDispatches = 0;
  const canceledBeforeDispatchRuntime = createProgrammaticToolCallingRuntime({
    advanceHostedProgram: async () => {
      providerDispatches += 1;
      return response("response-must-not-run", [{ type: "message", output: "unexpected" }]);
    },
    callTool: async () => ({}),
  });
  const canceledBeforeDispatchResult = canceledBeforeDispatchRuntime.run(request({
    runId: "run-canceled-before-provider-dispatch",
    signal: canceledBeforeDispatch.signal,
  }));
  canceledBeforeDispatch.abort();
  const canceledBeforeProvider = await canceledBeforeDispatchResult;
  assert.equal(canceledBeforeProvider.reasonCode, "aborted");
  assert.equal(canceledBeforeProvider.costLog.status, "not-run");
  assert.equal(providerDispatches, 0);

  const hostileSignal = {
    aborted: false,
    addEventListener() {},
    removeEventListener() { throw new Error("listener cleanup must not escape"); },
  };
  const hostileSignalRuntime = createProgrammaticToolCallingRuntime({
    advanceHostedProgram: async () => response("response-hostile-signal", [{ type: "message", output: "done" }]),
    callTool: async () => ({}),
  });
  const hostileSignalResult = await hostileSignalRuntime.run(request({
    runId: "run-hostile-signal",
    signal: hostileSignal,
  }));
  assert.equal(hostileSignalResult.status, "completed");

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

  const partialResponses = [
    response("response-cost-known", [
      { type: "program", callId: "program-cost", code: "opaque", fingerprint: "opaque-fingerprint-cost" },
      { type: "function_call", callId: "call-cost", name: "read_alpha", arguments: {}, caller: { type: "program", callerId: "program-cost" } },
    ], {
      costLog: { ...COST, model: "provider-model", prompt_tokens: 7, completion_tokens: 1, estimated_cost_usd: 0.02 },
    }),
  ];
  const partial = createProgrammaticToolCallingRuntime({
    advanceHostedProgram: async () => {
      if (partialResponses.length > 0) return partialResponses.shift();
      throw new Error("provider disappeared");
    },
    callTool: async () => ({ value: 1 }),
  });
  const partialResult = await partial.run(request({ runId: "run-partial-cost" }));
  assert.equal(partialResult.reasonCode, "provider_failed");
  assert.equal(partialResult.message, "Hosted program adapter failed.");
  assert.equal(JSON.stringify(partialResult).includes("provider disappeared"), false);
  assert.equal(partialResult.costLog.status, "partially-reported");
  assert.equal(partialResult.costLog.prompt_tokens, 7);
  assert.equal(partialResult.costLog.reportedAttempts, 1);
  assert.equal(partialResult.costLog.unreportedAttempts, 1);

  const stats = partial.stats();
  assert.deepEqual(
    {
      attempted: stats.toolCallsAttempted,
      dispatched: stats.toolCallsDispatched,
      canceledBeforeDispatch: stats.toolCallsCanceledBeforeDispatch,
      succeeded: stats.toolCallsSucceeded,
      failed: stats.toolCallsFailed,
      deadlines: stats.toolCallsDeadlineExceeded,
      canceled: stats.toolCallsCanceled,
      batches: stats.toolBatches,
      partialBatches: stats.partialToolBatches,
      exhaustedBatches: stats.exhaustedToolBatches,
    },
    {
      attempted: 1,
      dispatched: 1,
      canceledBeforeDispatch: 0,
      succeeded: 1,
      failed: 0,
      deadlines: 0,
      canceled: 0,
      batches: 1,
      partialBatches: 0,
      exhaustedBatches: 0,
    },
  );
});
