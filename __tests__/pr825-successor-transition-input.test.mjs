import assert from "node:assert/strict";
import test from "node:test";

import { createPr825TerminalizerPlan } from "../scripts/pr825-terminalizer-controller.mjs";
import {
  PR825_SUCCESSOR_TRANSITION_INPUT_SCHEMA,
  createPr825SuccessorTransitionInputRecord,
} from "../scripts/pr825-successor-transition-input.mjs";
import { readPr825TerminalizerSeed } from "../scripts/pr825-terminalizer-seed.mjs";

test("seals the blocked PR825 successor transition-input contract without inventing payload bytes", async () => {
  const seed = await readPr825TerminalizerSeed();
  const plan = createPr825TerminalizerPlan(seed);
  const record = await createPr825SuccessorTransitionInputRecord({
    authorization: plan.exactAuthorization,
  });

  assert.equal(record.schema, PR825_SUCCESSOR_TRANSITION_INPUT_SCHEMA);
  assert.equal(record.seedDigest, seed.seedDigest);
  assert.equal(record.planDigest, plan.planDigest);
  assert.equal(record.successorIntegrateTarget.requestedTransition, "integrate");
  assert.equal(
    record.successorIntegrateTarget.reviewLocator,
    "https://github.com/huijoohwee/agentic-canvas-os/pull/825",
  );
  assert.equal(
    record.successorIntegrateTarget.immutableRevision,
    "ed7461e5b272da1cba4cd31c079e12259965eaf1",
  );
  assert.equal(record.transitionWorkflow.workflowPath, ".github/workflows/adlc-transition.yml");
  assert.equal(record.transitionWorkflow.payloadReady, false);
  assert.equal(record.transitionWorkflow.inputs.operation_payload, null);
  assert.equal(record.transitionWorkflow.inputs.operation_input_digest, null);
  assert.deepEqual(record.currentSchemaConstraint.requiredOperationFields, [
    "schema",
    "request",
    "plan",
    "planByteDigest",
    "predecessorIssuance",
  ]);
  assert.equal(
    record.currentSchemaConstraint.blockedBy,
    "current-transition-schema-requires-predecessor-issuance",
  );
  assert.equal(
    record.currentSchemaConstraint.validationError,
    "integrate does not bind the exact predecessor GitHub authority issuance",
  );
  assert.equal(
    record.currentSchemaConstraint.requiredAdapterKind,
    "replacement-transition-authority-predecessor",
  );
  assert.deepEqual(record.currentSchemaConstraint.blockedSurfaceIds, [
    "transition-input-predecessor-shape",
    "authority-issuance-publication-replay",
    "authority-read-provider-live-proof",
    "transition-authority-source-window",
    "transition-authority-policy-anchor",
  ]);
  assert.match(record.authorizationDigest, /^[0-9a-f]{64}$/u);
  assert.match(record.evidenceDigest, /^[0-9a-f]{64}$/u);
  assert.match(record.replacementAuthorityDigest, /^[0-9a-f]{64}$/u);
  assert.match(record.cleanupProofDigest, /^[0-9a-f]{64}$/u);
  assert.match(record.executorRequestDigest, /^[0-9a-f]{64}$/u);
  assert.match(record.currentSchemaConstraint.pendingDynamicBindingsDigest, /^[0-9a-f]{64}$/u);
  assert.match(record.currentSchemaConstraint.schemaGapProofDigest, /^[0-9a-f]{64}$/u);
  assert.match(record.recordDigest, /^[0-9a-f]{64}$/u);
});

test("successor transition-input contract fails closed without the exact authorization line", async () => {
  const seed = await readPr825TerminalizerSeed();
  const plan = createPr825TerminalizerPlan(seed);
  await assert.rejects(
    () => createPr825SuccessorTransitionInputRecord({
      authorization: `${plan.exactAuthorization} drift`,
    }),
    /Exact authorization required:/,
  );
});
