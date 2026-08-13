// Responsibility: Prove hydrated optional claim fields preserve sealed null semantics.
import assert from "node:assert/strict";
import test from "node:test";

import {
  sameSourceClaim,
} from "../scripts/reviewed-lane-source-correction-repository-adapter.mjs";

const expected = Object.freeze({
  claimId: "claim",
  state: "integrated-preserved",
  recordedState: "integrated-preserved",
  declaredWriteScope: ["path:scripts/source.mjs", "semantic:source"],
  integration: null,
  recovery: null,
});

test("hydrated claims treat omitted optional recovery as sealed null", () => {
  const live = { ...expected };
  delete live.recovery;

  assert.equal(sameSourceClaim(live, expected), true);
});

test("hydrated claims still reject material optional recovery drift", () => {
  const live = {
    ...expected,
    recovery: { recoveredAt: "2026-08-13T00:00:00.000Z" },
  };

  assert.equal(sameSourceClaim(live, expected), false);
});
