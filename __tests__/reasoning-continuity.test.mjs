import test from "node:test";
import assert from "node:assert/strict";

import { createReasoningContinuityRegistry } from "../agent-api/src/reasoning-continuity.js";

const INVARIANTS = Object.freeze({
  goals: ["Ship the bounded runtime."],
  assumptions: ["The downstream adapter owns the model call."],
  priorities: ["Correctness", "Token efficiency"],
});
const CAPABILITIES = Object.freeze({
  previousResponseId: true,
  reasoningContexts: ["current_turn", "all_turns"],
});

function begin(registry, overrides = {}) {
  return registry.begin({
    threadId: "thread-a",
    ...INVARIANTS,
    capabilities: CAPABILITIES,
    ...overrides,
  });
}

test("starts without a previous response and requests only current-turn reasoning", () => {
  const registry = createReasoningContinuityRegistry();
  const first = begin(registry);

  assert.equal(first.status, "first_turn");
  assert.equal(first.stable, false);
  assert.equal(first.previousResponseIdUsed, false);
  assert.deepEqual(first.requestPatch, { reasoning: { context: "current_turn" } });
  assert.equal(first.providerEffectiveContext, "unverified");
});

test("preserves compatible reasoning only after a completed stable turn", () => {
  const registry = createReasoningContinuityRegistry();
  const first = begin(registry);
  registry.complete({
    threadId: "thread-a",
    turnToken: first.turnToken,
    responseId: "response-1",
    effectiveContext: "current_turn",
  });

  const second = begin(registry);
  assert.equal(second.status, "preserved");
  assert.equal(second.stable, true);
  assert.deepEqual(second.requestPatch, {
    previous_response_id: "response-1",
    reasoning: { context: "all_turns" },
  });
  assert.equal(second.providerEffectiveContext, "unverified");
});

test("invariant drift keeps conversation chaining but resets rendered reasoning", () => {
  const registry = createReasoningContinuityRegistry();
  const first = begin(registry);
  registry.complete({ threadId: "thread-a", turnToken: first.turnToken, responseId: "response-1" });

  const changed = begin(registry, { priorities: ["Safety", "Correctness"] });
  assert.equal(changed.status, "reset");
  assert.equal(changed.stable, false);
  assert.deepEqual(changed.requestPatch, {
    previous_response_id: "response-1",
    reasoning: { context: "current_turn" },
  });
  registry.complete({ threadId: "thread-a", turnToken: changed.turnToken, responseId: "response-2" });

  const stableAgain = begin(registry, { priorities: ["Safety", "Correctness"] });
  assert.equal(stableAgain.status, "preserved");
  assert.equal(stableAgain.requestPatch.previous_response_id, "response-2");
});

test("capability gates omit unsupported reasoning context without claiming preservation", () => {
  const registry = createReasoningContinuityRegistry();
  const first = begin(registry);
  registry.complete({ threadId: "thread-a", turnToken: first.turnToken, responseId: "response-1" });

  const unsupported = begin(registry, {
    capabilities: { previousResponseId: true, reasoningContexts: [] },
  });
  assert.equal(unsupported.status, "unsupported");
  assert.deepEqual(unsupported.requestPatch, { previous_response_id: "response-1" });
});

test("provider continuity is confirmed only from the effective response context", () => {
  const registry = createReasoningContinuityRegistry();
  const first = begin(registry);
  registry.complete({ threadId: "thread-a", turnToken: first.turnToken, responseId: "response-1" });
  const second = begin(registry);

  const completed = registry.complete({
    threadId: "thread-a",
    turnToken: second.turnToken,
    responseId: "response-2",
    effectiveContext: "all_turns",
  });
  assert.equal(completed.providerContinuityConfirmed, true);
  assert.equal(registry.stats().preservedRequests, 1);
  assert.equal(registry.stats().confirmedAllTurns, 1);
});

test("rejects mismatched provider confirmation", () => {
  const registry = createReasoningContinuityRegistry();
  const first = begin(registry);
  assert.throws(
    () => registry.complete({
      threadId: "thread-a",
      turnToken: first.turnToken,
      responseId: "response-1",
      effectiveContext: "all_turns",
    }),
    /does not match the requested reasoning context/,
  );
});

test("serializes active turns and supports an explicit abort", () => {
  const registry = createReasoningContinuityRegistry();
  const active = begin(registry);
  assert.throws(() => begin(registry), /already active/);
  assert.equal(registry.abort({ threadId: "thread-a", turnToken: active.turnToken }), true);
  assert.equal(registry.stats().threads, 0);
});

test("bounds thread retention and per-thread continuation", () => {
  const registry = createReasoningContinuityRegistry({ maxThreads: 1, maxTurnsPerThread: 1 });
  const first = begin(registry);
  registry.complete({ threadId: "thread-a", turnToken: first.turnToken, responseId: "response-1" });
  assert.throws(() => begin(registry), /turn limit reached/);

  const replacement = begin(registry, { threadId: "thread-b" });
  assert.equal(replacement.status, "first_turn");
  assert.equal(registry.stats().evictionCount, 1);
});
