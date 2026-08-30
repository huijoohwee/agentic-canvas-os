// Proves that a lane's own unrecorded advance is told apart from a takeover, so
// inequality alone never strands authored work behind an unopenable gate.
import test from "node:test";
import assert from "node:assert/strict";

import {
  PROJECTION_ABSENT,
  PROJECTION_CONTENDED,
  PROJECTION_CURRENT,
  PROJECTION_DIVERGENT,
  PROJECTION_OWN_ADVANCE,
  classifyObservedHead,
  isReconcilable,
  projectionDivergenceError,
} from "../scripts/lane-projection-reconciliation.mjs";

const RECORDED = "0".repeat(39) + "a";
const AHEAD = "0".repeat(39) + "b";
const UNRELATED = "0".repeat(39) + "c";
const INTEGRATED = "0".repeat(39) + "d";

// The oracle answers only for the one true descendant, so any accidental
// broadening of the ancestry question shows up as a failure.
const ancestry = (ancestor, descendant) => ancestor === RECORDED && descendant === AHEAD;

const classify = (overrides = {}) => classifyObservedHead({
  recordedSha: RECORDED,
  observedSha: AHEAD,
  isDescendant: ancestry,
  ...overrides,
});

test("an observed head equal to the projection is current", () => {
  const result = classify({ observedSha: RECORDED });
  assert.equal(result.state, PROJECTION_CURRENT);
  assert.equal(isReconcilable(result), true);
});

test("a recorded integration head is also current", () => {
  const result = classify({ observedSha: INTEGRATED, integrationSha: INTEGRATED });
  assert.equal(result.state, PROJECTION_CURRENT);
});

test("a descendant advance on an uncontested lane is reconcilable", () => {
  const result = classify();
  assert.equal(result.state, PROJECTION_OWN_ADVANCE);
  assert.equal(result.reconcilable, true);
  assert.match(result.reason, /descends from the projection/);
});

test("a non-descendant head is divergent and never reconciled", () => {
  const result = classify({ observedSha: UNRELATED });
  assert.equal(result.state, PROJECTION_DIVERGENT);
  assert.equal(isReconcilable(result), false);
});

test("contention outranks ancestry", () => {
  // A descendant advance is still not this run's to reconcile while another live
  // claim covers the lane.
  const result = classify({ competingClaims: ["agent/other/scope"] });
  assert.equal(result.state, PROJECTION_CONTENDED);
  assert.equal(isReconcilable(result), false);
  assert.match(result.reason, /1 competing claim/);
});

test("a missing or unreadable head is absent, not divergent", () => {
  for (const observedSha of ["", null, undefined, "not-a-sha"]) {
    const result = classify({ observedSha });
    assert.equal(result.state, PROJECTION_ABSENT, `${observedSha} must be absent`);
    assert.equal(isReconcilable(result), false);
  }
});

test("an unrecorded projection cannot be reconciled against anything", () => {
  const result = classify({ recordedSha: null });
  assert.equal(result.state, PROJECTION_ABSENT);
});

test("ancestry is required and never assumed", () => {
  assert.throws(() => classifyObservedHead({
    recordedSha: RECORDED, observedSha: AHEAD,
  }), /requires an ancestry oracle/);
});

test("the ancestry oracle is asked in one direction only", () => {
  const asked = [];
  const result = classifyObservedHead({
    recordedSha: RECORDED,
    observedSha: AHEAD,
    isDescendant: (ancestor, descendant) => {
      asked.push([ancestor, descendant]);
      return ancestry(ancestor, descendant);
    },
  });
  assert.equal(result.state, PROJECTION_OWN_ADVANCE);
  assert.deepEqual(asked, [[RECORDED, AHEAD]],
    "the recorded revision must be the ancestor argument, never the reverse");
});

test("the divergence error names the reason and the owning remedy", () => {
  const result = classify({ observedSha: UNRELATED });
  const error = projectionDivergenceError({
    branch: "agent/device/scope",
    classification: result,
    recordedSha: RECORDED,
    observedSha: UNRELATED,
  });
  assert.match(error.message, /agent\/device\/scope/);
  assert.match(error.message, /does not descend/);
  assert.match(error.message, /reconcile at the owning claim or hand off/);
});
