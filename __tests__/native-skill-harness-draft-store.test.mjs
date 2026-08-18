import assert from "node:assert/strict";
import test from "node:test";

import {
  SKILL_DRAFT_STORE_DEFAULTS,
  createDurableObjectSkillDraftStore,
} from "../agent-api/src/durable-object-state-store.js";
import { AgentState } from "../worker/agent-state.js";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

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

  async getAlarm() {
    return null;
  }

  async setAlarm() {}

  async deleteAlarm() {}
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

function createDraft(overrides = {}) {
  return {
    schema: "acos-skill-draft/v1",
    draft_id: "gap-001:1786950000000",
    status: "proposed",
    adapter_id: "knowgrph",
    gap_signal_id: "gap-001",
    agent_definition: {
      id: "draft-gap-agent",
      revision: "draft-gap-v1",
      name: "Gap Draft Agent",
      source: { uri: "workspace:/agents/gap-draft.json", digest: "b".repeat(64) },
      model: { providerId: "scripted-provider", modelId: "scripted-model" },
      instructions: [{ name: "purpose", content: "Cover the observed capability gap." }],
    },
    rationale: "Derived from the observed tool-search denial.",
    confidence: 0.72,
    proposing_mechanism: { module: "agent-api/src/skill-proposer.js", identity: "acos-skill-proposer" },
    tool_names: ["update_agent_run_note"],
    created_at_ms: Date.now(),
    expires_at_ms: Date.now() + THIRTY_DAYS_MS,
    consumed: false,
    ...overrides,
  };
}

test("the draft store writes and peeks one record per draft id", async () => {
  const store = createDurableObjectSkillDraftStore({ namespace: createAgentStateNamespace() });
  const draft = createDraft();
  assert.equal(await store.put(draft), true);
  const peeked = await store.peek(draft.draft_id);
  assert.equal(peeked.draft_id, draft.draft_id);
  assert.equal(peeked.status, "proposed");
  assert.equal(peeked.consumed, false);
  assert.equal(await store.peek("missing-draft"), null);
});

test("an already-expired draft fails closed at write and a missing draft reads absent", async () => {
  const store = createDurableObjectSkillDraftStore({ namespace: createAgentStateNamespace() });
  // The Durable Object refuses any record whose expiresAt is not in the
  // future, so a stale draft can never enter the store.
  await assert.rejects(() => store.put(createDraft({ expires_at_ms: Date.now() - 1 })), TypeError);
  assert.equal(await store.peek("missing-draft"), null);
  await assert.rejects(() => store.markConsumed("missing-draft"), TypeError);
});

test("markConsumed is the only mutation the gate needs and is single-shot", async () => {
  const store = createDurableObjectSkillDraftStore({ namespace: createAgentStateNamespace() });
  const draft = createDraft();
  await store.put(draft);
  assert.equal(await store.markConsumed(draft.draft_id), true);
  assert.equal((await store.peek(draft.draft_id)).consumed, true);
  await assert.rejects(() => store.markConsumed(draft.draft_id), TypeError);
});

test("the adapter index appends uniquely and rejects beyond 64 entries", async () => {
  const namespace = createAgentStateNamespace();
  const store = createDurableObjectSkillDraftStore({ namespace });
  for (let index = 0; index < SKILL_DRAFT_STORE_DEFAULTS.maxDraftsPerAdapter; index += 1) {
    assert.equal(await store.indexAppend("knowgrph", `draft-${index}`), true);
  }
  assert.deepEqual(await store.indexList("knowgrph"), Array.from(
    { length: SKILL_DRAFT_STORE_DEFAULTS.maxDraftsPerAdapter },
    (_, index) => `draft-${index}`,
  ));
  await assert.rejects(
    () => store.indexAppend("knowgrph", "draft-64"),
    (error) => error instanceof RangeError,
  );
  // A second adapter keeps its own bounded index.
  assert.equal(await store.indexAppend("second-adapter", "other-draft"), true);
  assert.deepEqual(await store.indexList("second-adapter"), ["other-draft"]);
});

test("the draft TTL ceiling matches the Durable Object 30-day cap and reports zero bindings added", () => {
  assert.equal(SKILL_DRAFT_STORE_DEFAULTS.maxIndexTtlMs, THIRTY_DAYS_MS);
  const stats = createDurableObjectSkillDraftStore({ namespace: createAgentStateNamespace() }).stats();
  assert.equal(stats.keyNamespace, "skill-draft:");
  assert.equal(stats.bindingsAdded, 0);
  assert.equal(stats.owner, "native-skill-harness");
});

test("a draft record must arrive with status proposed and consumed false", async () => {
  const store = createDurableObjectSkillDraftStore({ namespace: createAgentStateNamespace() });
  await assert.rejects(() => store.put(createDraft({ status: "active" })), TypeError);
  await assert.rejects(() => store.put(createDraft({ consumed: true })), TypeError);
});
