import assert from "node:assert/strict";
import test from "node:test";

import { createDurableObjectFunctionExecutionReceiptStore } from "../agent-api/src/durable-object-state-store.js";
import { createFunctionExecutionReceiptRuntime } from "../agent-api/src/function-execution-receipts.js";
import { createGuardrailsHumanReviewRuntime } from "../agent-api/src/guardrails-human-review.js";
import { createKnowgrphFunctionGateway } from "../agent-api/src/knowgrph-function-gateway.js";
import { AgentState } from "../worker/agent-state.js";

class MemoryStorage {
  constructor() {
    this.records = new Map();
    this.transactionTail = Promise.resolve();
  }

  async transaction(operation) {
    const result = this.transactionTail.then(() => operation(this));
    this.transactionTail = result.catch(() => {});
    return result;
  }

  async get(key) { return this.records.get(key); }
  async put(key, value) { this.records.set(key, value); }
  async delete(key) { return this.records.delete(key); }
}

function agentStateNamespace() {
  const instances = new Map();
  return Object.freeze({
    idFromName: (name) => name,
    get(id) {
      if (!instances.has(id)) instances.set(id, new AgentState({ storage: new MemoryStorage() }));
      return Object.freeze({
        fetch: (input, init) => instances.get(id).fetch(input instanceof Request ? input : new Request(input, init)),
      });
    },
  });
}

function ids(prefix) {
  let sequence = 0;
  return () => `${prefix}-${sequence += 1}`;
}

const MUTATION_REQUEST = Object.freeze({
  runId: "mutation-run",
  callId: "mutation-call",
  toolName: "update_record",
  toolRevision: "update-record/v1",
  riskClass: "mutation",
  arguments: Object.freeze({ recordId: "record-1", value: "updated" }),
  requiresUpstreamReceipt: true,
});

function upstreamReceipt(execution, status) {
  return Object.freeze({
    schema: "knowgrph-tool-execution-receipt/v1",
    idempotencyKey: execution.idempotencyKey,
    requestDigest: execution.requestDigest,
    status,
  });
}

test("reuses one durable idempotency key after an uncertain mutating result and replays the completed receipt", async () => {
  const namespace = agentStateNamespace();
  const store = createDurableObjectFunctionExecutionReceiptStore({ namespace });
  const first = createFunctionExecutionReceiptRuntime({ executionReceiptStore: store, createId: ids("first") });
  let prepared = await first.prepare(MUTATION_REQUEST);
  assert.equal(prepared.status, "reserved");
  prepared = await first.authorize(prepared, {
    arguments: MUTATION_REQUEST.arguments,
    reviewAudit: { schema: "test-review/v1", reviewer: "operator-1" },
  });
  const firstClaim = await first.claim(prepared);
  assert.equal(firstClaim.status, "execute");

  const applied = new Map();
  let mutations = 0;
  function mutate(execution) {
    if (applied.has(execution.idempotencyKey)) {
      return { output: applied.get(execution.idempotencyKey), receipt: upstreamReceipt(execution, "replayed") };
    }
    mutations += 1;
    const output = { ok: true, recordId: "record-1", version: 2 };
    applied.set(execution.idempotencyKey, output);
    return { output, receipt: upstreamReceipt(execution, "applied") };
  }

  const uncertain = mutate(firstClaim.execution);
  const missingEvidence = await first.complete(firstClaim.fence, { output: uncertain.output });
  assert.equal(missingEvidence.status, "blocked");
  assert.equal(missingEvidence.reasonCode, "upstream_execution_receipt_invalid");
  assert.equal(await first.release(firstClaim.fence), true);

  const second = createFunctionExecutionReceiptRuntime({ executionReceiptStore: store, createId: ids("second") });
  prepared = await second.prepare(MUTATION_REQUEST);
  assert.equal(prepared.status, "authorized");
  const retryClaim = await second.claim(prepared);
  assert.equal(retryClaim.execution.idempotencyKey, firstClaim.execution.idempotencyKey);
  const replayed = mutate(retryClaim.execution);
  const completed = await second.complete(retryClaim.fence, {
    output: replayed.output,
    upstreamReceipt: replayed.receipt,
  });
  assert.equal(completed.status, "completed");
  assert.equal(completed.evidence.replayed, false);
  assert.equal(mutations, 1);

  const third = createFunctionExecutionReceiptRuntime({ executionReceiptStore: store, createId: ids("third") });
  const terminal = await third.prepare(MUTATION_REQUEST);
  assert.equal(terminal.status, "completed");
  assert.deepEqual(terminal.output, { ok: true, recordId: "record-1", version: 2 });
  assert.equal(mutations, 1);
});

test("allows one execution claimant and rejects call-identity payload drift", async () => {
  const store = createDurableObjectFunctionExecutionReceiptStore({ namespace: agentStateNamespace() });
  const runtime = createFunctionExecutionReceiptRuntime({ executionReceiptStore: store, createId: ids("claim") });
  let prepared = await runtime.prepare(MUTATION_REQUEST);
  prepared = await runtime.authorize(prepared, {
    arguments: MUTATION_REQUEST.arguments,
    reviewAudit: { schema: "test-review/v1", reviewer: "operator-1" },
  });
  const [left, right] = await Promise.all([runtime.claim(prepared), runtime.claim(prepared)]);
  assert.equal([left, right].filter((result) => result.status === "execute").length, 1);
  assert.equal([left, right].filter((result) => result.reasonCode === "execution_receipt_active").length, 1);

  const winner = [left, right].find((result) => result.status === "execute");
  await runtime.release(winner.fence);
  const mismatch = await runtime.prepare({
    ...MUTATION_REQUEST,
    arguments: { ...MUTATION_REQUEST.arguments, value: "different" },
  });
  assert.equal(mismatch.status, "blocked");
  assert.equal(mismatch.reasonCode, "execution_receipt_mismatch");
});

test("gateway persists review authorization before mutation and replays a fresh-isolate completion", async () => {
  const namespace = agentStateNamespace();
  const receiptStore = createDurableObjectFunctionExecutionReceiptStore({ namespace });
  const reviewStore = new Map();
  const mutationRecord = Object.freeze({
    type: "function",
    name: "update_record",
    revision: "update-record/v1",
    description: "Update one test record.",
    parameters: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false },
    strict: true,
    outputSchema: { type: "object", properties: { ok: { type: "boolean" }, value: { type: "string" } }, required: ["ok", "value"], additionalProperties: false },
    allowedCallers: ["direct"],
    riskClass: "mutation",
    idempotent: true,
    approvalRequired: true,
    validateArguments: (value) => value && typeof value.value === "string",
    validateOutput: (value) => value?.ok === true && typeof value.value === "string",
    mapOutput: (payload) => ({ ok: payload.ok, value: payload.value }),
    inputGuardrails: [{ name: "mutation-input", stage: "tool-input" }],
    outputGuardrails: [{ name: "mutation-output", stage: "tool-output" }],
    mcpToolName: "knowgrph.record.update",
  });
  const toolRecords = Object.freeze({ update_record: mutationRecord });
  const reviewRuntime = () => createGuardrailsHumanReviewRuntime({
    createReviewId: () => "mutation-review",
    evaluateGuardrail: async ({ value }) => ({
      passed: true, value, reasonCode: "unused", message: "accepted",
    }),
    authenticateReviewer: async () => ({
      authenticated: true, subjectId: "operator-1", evidenceId: "evidence-1", assurance: "test-signed-token",
    }),
    reviewStore: {
      put(record) {
        if (reviewStore.has(record.reviewId)) return false;
        reviewStore.set(record.reviewId, record);
        return true;
      },
      take(reviewId) {
        const record = reviewStore.get(reviewId) || null;
        reviewStore.delete(reviewId);
        return record;
      },
    },
  });
  const applied = new Map();
  let mutationCalls = 0;
  let mcpCalls = 0;
  let omitReceipt = true;
  const mcpClient = {
    async callTool(_name, argumentsValue, options) {
      mcpCalls += 1;
      const execution = options.execution;
      const prior = applied.get(execution.idempotencyKey);
      if (!prior) {
        mutationCalls += 1;
        applied.set(execution.idempotencyKey, argumentsValue.value);
      }
      return {
        ok: true,
        value: prior || argumentsValue.value,
        ...(omitReceipt
          ? {}
          : { execution_receipt: upstreamReceipt(execution, prior ? "replayed" : "applied") }),
      };
    },
  };
  const createGateway = () => createKnowgrphFunctionGateway({
    allowedToolNames: ["update_record"], reviewRequiredToolNames: ["update_record"],
    toolRecords, mcpClient, guardrailsHumanReview: reviewRuntime(), executionReceiptStore: receiptStore,
  });
  const call = {
    runId: "gateway-mutation-run", callId: "gateway-mutation-call", name: "update_record",
    arguments: { value: "updated" }, caller: { type: "direct" },
    policy: { revision: "update-record/v1", riskClass: "mutation", idempotent: true, approvalRequired: true },
  };
  const firstGateway = createGateway();
  const paused = await firstGateway.callTool(call);
  assert.equal(paused.status, "paused");
  assert.equal(paused.executionReceipt.phase, "reserved");
  assert.equal(mutationCalls, 0);

  const uncertain = await firstGateway.callTool({
    ...call,
    review: {
      state: paused.resumeState,
      resolution: { reviewId: paused.resumeState.reviewId, decision: "approve", reviewerEvidence: { token: "signed" } },
    },
  });
  assert.equal(uncertain.status, "blocked");
  assert.equal(uncertain.reasonCode, "upstream_execution_receipt_invalid");
  assert.equal(uncertain.retryable, true);
  assert.equal(mutationCalls, 1);
  assert.equal(mcpCalls, 1);

  omitReceipt = false;
  const freshGateway = createGateway();
  const completed = await freshGateway.callTool(call);
  assert.equal(completed.status, "completed");
  assert.equal(completed.executionReceipt.phase, "completed");
  assert.equal(mutationCalls, 1);
  assert.equal(mcpCalls, 2);

  const replayed = await createGateway().callTool(call);
  assert.equal(replayed.status, "completed");
  assert.equal(replayed.executionReceipt.replayed, true);
  assert.deepEqual(replayed.output, { ok: true, value: "updated" });
  assert.equal(mutationCalls, 1);
  assert.equal(mcpCalls, 2);
});
