import test from "node:test";
import assert from "node:assert/strict";
import { createReasoningContinuityRegistry } from "agentic-os/context/continuity";
import { createAgentApiApp } from "../agent-api/src/app.js";

test("Canvas consumes upstream continuity with opaque response IDs and sanitized readiness", () => {
  const reasoningContinuity = createReasoningContinuityRegistry();
  const app = createAgentApiApp({ reasoningContinuity });
  assert.equal(app.reasoningContinuity, reasoningContinuity);
  const turn = app.reasoningContinuity.begin({ threadId: "caller/session", goals: ["Deliver MVP"],
    priorities: ["Correctness"], capabilities: { previousResponseId: true, reasoningContexts: [] } });
  app.reasoningContinuity.complete({ threadId: "caller/session", turnToken: turn.turnToken, responseId: "opaque-id" });
  assert.equal(app.readiness().reasoningContinuity.providerEffectiveContext, "unverified");
  assert.doesNotMatch(JSON.stringify(app.readiness().reasoningContinuity), /opaque-id/);
  assert.equal(createAgentApiApp().reasoningContinuity.stats().threads, 0);
});
