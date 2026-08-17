import assert from "node:assert/strict";
import test from "node:test";
import { buildRecoveryArtifactRetirementPlan } from "../scripts/recovery-artifact-retirement-contract.mjs";

test("incomplete cleanup requires its exact drift acknowledgement", () => {
  assert.throws(() => buildRecoveryArtifactRetirementPlan({ evidence: {}, sessionId: "s",
    operatorDecisionDigest: "a".repeat(64) }), /invalid/u);
});
