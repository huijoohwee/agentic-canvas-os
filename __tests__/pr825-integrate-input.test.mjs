import assert from "node:assert/strict";
import test from "node:test";

import { readPr825IntegrateTransitionInput } from "../scripts/pr825-integrate-input.mjs";
import {
  PR825_RETAINED_AUTHORITY,
  readPr825RetainedAuthorityRecord,
} from "../scripts/pr825-retained-authority-record.mjs";

test("builds a canonical PR825 integrate input whose request window is already closed", async () => {
  const retained = await readPr825RetainedAuthorityRecord({
    now: () => new Date("2026-09-03T05:02:33.000Z"),
  });
  const result = await readPr825IntegrateTransitionInput();

  assert.equal(result.schema, "agentic-canvas-os/pr825-integrate-input-record/v1");
  assert.equal(result.request.requestedTransition, "integrate");
  assert.equal(result.request.reviewLocator, PR825_RETAINED_AUTHORITY.reviewLocator);
  assert.equal(result.request.immutableRevision, PR825_RETAINED_AUTHORITY.mergeSha);
  assert.equal(result.request.claimId, retained.claimId);
  assert.equal(result.request.leaseEpoch, retained.leaseEpoch);
  assert.equal(
    result.request.fenceRevision,
    result.predecessorIssuance.transitionReceipt.resultFenceRevision,
  );
  assert.deepEqual(result.request.dependentWork, [`effect-plan:sha256:${result.planByteDigest}`]);
  assert.equal(result.plan.target.resource, PR825_RETAINED_AUTHORITY.reviewLocator);
  assert.equal(result.plan.target.immutableRevision, PR825_RETAINED_AUTHORITY.mergeSha);
  assert.equal(result.plan.effectClass, "protected-integration-record");
  assert.deepEqual(result.plan.allowedEffects, [
    "record-integration",
    "verify-exact-integration",
  ]);
  assert.deepEqual(result.plan.forbiddenEffects, [
    "cleanup",
    "delete-branch",
    "delete-object",
    "delete-ref",
    "delete-reflog",
    "deploy",
    "force-push",
    "merge",
    "prune-peer-registration",
    "remove-directory-bytes",
  ]);
  assert.equal(result.predecessorExpiresAt, retained.predecessorExpiresAt);
  assert.equal(result.predecessorWindowOpen, false);
  assert.match(result.planByteDigest, /^[0-9a-f]{64}$/u);
  assert.equal(result.operationInput, null);
  assert.equal(result.operationInputDigest, null);
  assert.equal(
    result.validationError,
    "integrate does not bind the exact predecessor GitHub authority issuance",
  );
});
