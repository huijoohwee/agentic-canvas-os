import assert from "node:assert/strict";
import test from "node:test";

import { classifySessionStart } from "../scripts/session-start-policy.mjs";

const passedAuthoringGates = {
  fetch: "passed",
  canonical: "passed",
  scopeOwnership: "passed",
  taskWorktree: "passed",
  memory: "passed",
  planning: "passed",
};

test("runtime parity failure does not block ownership-qualified isolated authoring", () => {
  const status = classifySessionStart({ ...passedAuthoringGates, parity: "blocked" });
  assert.equal(status.authoringStatus, "ready");
  assert.equal(status.parityStatus, "blocked");
  assert.equal(status.blockScope, "runtime-proof");
  assert.equal(status.continuation.isolatedAuthoring, true);
  assert.equal(status.continuation.runtimeParityClaim, false);
  assert.equal(status.continuation.reviewOrIntegration, false);
});

test("deferred parity permits source work but not runtime-ready handoff", () => {
  const status = classifySessionStart({ ...passedAuthoringGates, parity: "deferred" });
  assert.equal(status.authoringStatus, "ready");
  assert.equal(status.blockScope, "runtime-proof");
  assert.equal(status.continuation.reviewOrIntegration, false);
});

test("same-scope ownership conflict blocks authoring at the semantic scope", () => {
  const status = classifySessionStart({
    ...passedAuthoringGates,
    scopeOwnership: "blocked",
    parity: "deferred",
  });
  assert.equal(status.authoringStatus, "blocked");
  assert.equal(status.blockScope, "semantic-scope");
  assert.equal(status.continuation.isolatedAuthoring, false);
});

test("global source or structural failure remains fail closed", () => {
  const status = classifySessionStart({
    ...passedAuthoringGates,
    canonical: "blocked",
    parity: "passed",
  });
  assert.equal(status.authoringStatus, "blocked");
  assert.equal(status.blockScope, "global");
  assert.equal(status.continuation.reviewOrIntegration, false);
});
