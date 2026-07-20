import assert from "node:assert/strict";
import test from "node:test";

import {
  createDurableObjectHumanReviewStore,
  createDurableObjectPausedTurnStore,
  createDurableObjectSwarmRunStore,
} from "../agent-api/src/durable-object-state-store.js";
import { createRunningAgentRuntime } from "../agent-api/src/running-agents.js";
import { AgentState } from "../worker/agent-state.js";

const COST = Object.freeze({
  model: "offline-fixture",
  prompt_tokens: 0,
  completion_tokens: 0,
  cache_hits: 0,
  estimated_cost_usd: 0,
});

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

  async get(key) {
    return this.records.get(key);
  }

  async put(key, value) {
    this.records.set(key, value);
  }

  async delete(key) {
    return this.records.delete(key);
  }
}

function createAgentStateNamespace() {
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

test("Durable Object review records store once and consume atomically", async () => {
  const namespace = createAgentStateNamespace();
  const first = createDurableObjectHumanReviewStore({ namespace });
  const second = createDurableObjectHumanReviewStore({ namespace });
  const record = {
    reviewId: "review-1",
    runId: "run-1",
    conversationId: "conversation-1",
    expiresAt: Date.now() + 60_000,
  };

  assert.equal(await first.put(record), true);
  assert.equal(await second.put(record), false);
  const consumed = await Promise.all([first.take(record.reviewId), second.take(record.reviewId)]);
  assert.equal(consumed.filter(Boolean).length, 1);
  assert.deepEqual(consumed.find(Boolean), record);
});

test("Durable Object paused turns enforce claim, release, replace, and commit", async () => {
  const namespace = createAgentStateNamespace();
  const store = createDurableObjectPausedTurnStore({ namespace });
  const base = {
    schema: "test-paused/v1",
    conversationId: "conversation-1",
    value: 1,
    expiresAt: Date.now() + 60_000,
  };

  assert.equal(await store.put(base), true);
  assert.deepEqual(await store.get(base.conversationId), base);
  const [firstClaim, competingClaim] = await Promise.all([
    store.claim(base.conversationId, "claim-1", Date.now() + 30_000),
    store.claim(base.conversationId, "claim-2", Date.now() + 30_000),
  ]);
  assert.equal([firstClaim, competingClaim].filter(Boolean).length, 1);
  const winningClaim = firstClaim ? "claim-1" : "claim-2";
  assert.equal(await store.release(base.conversationId, winningClaim), true);

  assert.ok(await store.claim(base.conversationId, "claim-3", Date.now() + 30_000));
  const replacement = { ...base, value: 2 };
  assert.equal(await store.replace(base.conversationId, "claim-3", replacement), true);
  assert.deepEqual(await store.get(base.conversationId), replacement);
  assert.ok(await store.claim(base.conversationId, "claim-4", Date.now() + 30_000));
  assert.equal(await store.commit(base.conversationId, "claim-4"), true);
  assert.equal(await store.get(base.conversationId), null);
});

test("Agent Swarm ledgers coordinate atomic claims across isolate adapters", async () => {
  const namespace = createAgentStateNamespace();
  const first = createDurableObjectSwarmRunStore({ namespace });
  const second = createDurableObjectSwarmRunStore({ namespace });
  const ledger = {
    schema: "agent-swarm-run/v1",
    runId: "swarm-run-1",
    status: "running",
    revision: 1,
    expiresAt: Date.now() + 60_000,
  };

  assert.equal(await first.put(ledger), true);
  assert.equal(await second.put(ledger), false);
  const [firstClaim, secondClaim] = await Promise.all([
    first.claim(ledger.runId, "worker-a", Date.now() + 30_000),
    second.claim(ledger.runId, "worker-b", Date.now() + 30_000),
  ]);
  assert.equal([firstClaim, secondClaim].filter(Boolean).length, 1);
  const winner = firstClaim ? [first, "worker-a"] : [second, "worker-b"];
  const replacement = { ...ledger, revision: 2 };
  assert.equal(await winner[0].replace(ledger.runId, winner[1], replacement), true);
  assert.deepEqual(await second.get(ledger.runId), replacement);
  assert.ok(await first.claim(ledger.runId, "expiring-coordinator", Date.now() + 5));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(await second.put({ ...ledger, revision: 3 }), false);
  assert.deepEqual(await second.get(ledger.runId), replacement);
  assert.ok(await first.claim(ledger.runId, "conditional-discard", Date.now() + 30_000));
  assert.equal(await second.commit(ledger.runId, "wrong-discard"), false);
  assert.deepEqual(await second.get(ledger.runId), replacement);
  assert.equal(await first.commit(ledger.runId, "conditional-discard"), true);
  assert.equal(await second.get(ledger.runId), null);
  assert.deepEqual(first.stats(), {
    persistence: "durable-object",
    atomicClaims: true,
    horizontalRecovery: true,
    owner: "agent-swarm",
    activeRuns: null,
  });
});

test("Running Agents resumes one durable paused turn after an isolate restart", async () => {
  const namespace = createAgentStateNamespace();
  const firstStore = createDurableObjectPausedTurnStore({ namespace });
  const secondStore = createDurableObjectPausedTurnStore({ namespace });
  const firstRuntime = createRunningAgentRuntime({
    pausedTurnStore: firstStore,
    createResumeToken: () => "resume-durable",
    advanceAgent: async () => ({
      status: "paused",
      interruptions: [{ id: "review-1", kind: "approval", message: "Review the action." }],
      resumeState: { cursor: "durable-cursor" },
      responseId: "paused-response",
      costLog: COST,
    }),
  });
  const request = {
    runId: "run-durable",
    conversationId: "conversation-durable",
    agent: "support-agent",
    input: { prompt: "continue safely" },
    continuation: { strategy: "previous-response" },
  };
  const paused = await firstRuntime.run(request);
  assert.equal(paused.status, "paused");

  const competingRuntime = createRunningAgentRuntime({
    pausedTurnStore: secondStore,
    advanceAgent: async () => ({ status: "completed", output: "unexpected", costLog: COST }),
  });
  const competing = await competingRuntime.run({ ...request, runId: "competing-run" });
  assert.equal(competing.reasonCode, "conversation_paused");

  const resumedRuntime = createRunningAgentRuntime({
    pausedTurnStore: secondStore,
    createClaimId: () => "claim-durable",
    advanceAgent: async ({ resume }) => ({
      status: "completed",
      output: { state: resume.state, resolution: resume.resolution },
      responseId: "resumed-response",
      costLog: COST,
    }),
  });
  const completed = await resumedRuntime.resume({
    runId: request.runId,
    conversationId: request.conversationId,
    resumeToken: paused.resumeToken,
    resolution: { approved: true },
  });
  assert.equal(completed.status, "completed");
  assert.equal(completed.turn, 1);
  assert.deepEqual(completed.output, {
    state: { cursor: "durable-cursor" },
    resolution: { approved: true },
  });
  assert.equal(await secondStore.get(request.conversationId), null);
});
