import assert from "node:assert/strict";
import test from "node:test";

import { createPr825TerminalizerPlan } from "../scripts/pr825-terminalizer-controller.mjs";
import {
  PR825_LIVE_SUCCESSOR_TRANSITION_INPUT_SCHEMA,
  createPr825LiveSuccessorTransitionInput,
} from "../scripts/pr825-live-successor-transition-input.mjs";
import { readPr825TerminalizerSeed } from "../scripts/pr825-terminalizer-seed.mjs";

const OBSERVED_AT = "2026-09-03T14:00:00.000Z";
const EXPIRES_AT = "2026-09-03T14:15:00.000Z";

test("builds live PR825 successor transition payload bytes from the replacement authority", async () => {
  const seed = await readPr825TerminalizerSeed();
  const plan = createPr825TerminalizerPlan(seed);
  const record = await createPr825LiveSuccessorTransitionInput({
    authorization: plan.exactAuthorization,
    observedAt: OBSERVED_AT,
    expiresAt: EXPIRES_AT,
    authorityIssuedAt: OBSERVED_AT,
    authorityExpiresAt: EXPIRES_AT,
  });

  assert.equal(record.schema, PR825_LIVE_SUCCESSOR_TRANSITION_INPUT_SCHEMA);
  assert.equal(record.seedDigest, seed.seedDigest);
  assert.equal(record.planDigest, plan.planDigest);
  assert.equal(record.payloadReady, true);
  assert.equal(record.predecessorAuthority.authorityKind,
    "append-only-replacement-transition-authority");
  assert.equal(record.predecessorAuthority.authorityRef, "refs/heads/main");
  assert.equal(record.predecessorAuthority.issuedAt, OBSERVED_AT);
  assert.equal(record.predecessorAuthority.expiresAt, EXPIRES_AT);
  assert.equal(record.operationInput.predecessorIssuance, null);
  assert.equal(
    record.operationInput.predecessorAuthority.reviewLocator,
    "https://github.com/huijoohwee/agentic-canvas-os/pull/825",
  );
  assert.equal(record.operationInput.integrationMode, "retrospective-recovery");
  assert.equal(record.dispatch.inputs.operation_payload, record.operationPayload);
  assert.equal(record.dispatch.inputs.operation_input_digest, record.operationInputDigest);
  assert.match(record.operationPayload, /"predecessorAuthority"/u);
  assert.match(record.operationInputDigest, /^[0-9a-f]{64}$/u);
  assert.match(record.recordDigest, /^[0-9a-f]{64}$/u);
});

test("live successor transition payload fails closed without the exact authorization line", async () => {
  const seed = await readPr825TerminalizerSeed();
  const plan = createPr825TerminalizerPlan(seed);
  await assert.rejects(
    () => createPr825LiveSuccessorTransitionInput({
      authorization: `${plan.exactAuthorization} drift`,
      observedAt: OBSERVED_AT,
      expiresAt: EXPIRES_AT,
      authorityIssuedAt: OBSERVED_AT,
      authorityExpiresAt: EXPIRES_AT,
    }),
    /Exact authorization required:/,
  );
});
