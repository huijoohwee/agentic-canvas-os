import assert from "node:assert/strict";
import test from "node:test";

import {
  PR825_TERMINALIZER_PLAN_SCHEMA,
  createPr825TerminalizerController,
  createPr825TerminalizerPlan,
} from "../scripts/pr825-terminalizer-controller.mjs";
import { readPr825TerminalizerSeed } from "../scripts/pr825-terminalizer-seed.mjs";

test("seals a deterministic PR825 terminalizer plan from the successor seed", async () => {
  const seed = await readPr825TerminalizerSeed();
  const plan = createPr825TerminalizerPlan(seed);

  assert.equal(plan.schema, PR825_TERMINALIZER_PLAN_SCHEMA);
  assert.equal(plan.seedDigest, seed.seedDigest);
  assert.equal(plan.reviewLocator, seed.reviewLocator);
  assert.equal(plan.sourceBranch, seed.sourceBranch);
  assert.equal(plan.protectedMergeSha, seed.protectedMergeSha);
  assert.equal(
    plan.blockedIntegrateValidationError,
    "integrate does not bind the exact predecessor GitHub authority issuance",
  );
  assert.deepEqual(
    plan.steps.map((step) => step.stepId),
    [
      "capture-append-only-recovery-evidence",
      "construct-replacement-transition-authority",
      "bind-cleanup-joinable-retirement-proof",
    ],
  );
  assert.deepEqual(
    plan.steps.map((step) => step.output),
    seed.successorOutputs,
  );
  assert.match(plan.planDigest, /^[0-9a-f]{64}$/u);
  assert.equal(
    plan.exactAuthorization,
    `authorize pr825-expired-retrospective-terminalizer ${plan.planDigest}`,
  );
  assert.equal(plan.mutation, false);
  assert.ok(Object.isFrozen(plan));
});

test("controller plan stays deterministic across repeated calls", async () => {
  const controller = createPr825TerminalizerController();
  const first = await controller.plan();
  const second = await controller.plan();

  assert.equal(first.planDigest, second.planDigest);
  assert.equal(first.exactAuthorization, second.exactAuthorization);
  assert.deepEqual(first.steps, second.steps);
});
