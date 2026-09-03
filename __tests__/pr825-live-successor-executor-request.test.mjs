import assert from "node:assert/strict";
import test from "node:test";

import { createPr825TerminalizerPlan } from "../scripts/pr825-terminalizer-controller.mjs";
import {
  PR825_LIVE_SUCCESSOR_EXECUTOR_REQUEST_SCHEMA,
  createPr825LiveSuccessorExecutorRequest,
} from "../scripts/pr825-live-successor-executor-request.mjs";
import { readPr825TerminalizerSeed } from "../scripts/pr825-terminalizer-seed.mjs";

const OBSERVED_AT = "2026-09-03T14:00:00.000Z";
const EXPIRES_AT = "2026-09-03T14:15:00.000Z";

test("builds a dispatch-ready PR825 successor executor request", async () => {
  const seed = await readPr825TerminalizerSeed();
  const plan = createPr825TerminalizerPlan(seed);
  const request = await createPr825LiveSuccessorExecutorRequest({
    authorization: plan.exactAuthorization,
    observedAt: OBSERVED_AT,
    expiresAt: EXPIRES_AT,
    authorityIssuedAt: OBSERVED_AT,
    authorityExpiresAt: EXPIRES_AT,
  });

  assert.equal(request.schema, PR825_LIVE_SUCCESSOR_EXECUTOR_REQUEST_SCHEMA);
  assert.equal(request.seedDigest, seed.seedDigest);
  assert.equal(request.planDigest, plan.planDigest);
  assert.equal(request.dispatch.payloadReady, true);
  assert.equal(request.dispatch.ref, "main");
  assert.equal(request.dispatch.event, "workflow_dispatch");
  assert.match(request.dispatch.inputs.operation_payload, /"predecessorAuthority"/u);
  assert.match(request.dispatch.inputs.operation_input_digest, /^[0-9a-f]{64}$/u);
  assert.equal(request.executorBlockedBy, null);
  assert.match(request.authorizationDigest, /^[0-9a-f]{64}$/u);
  assert.match(request.evidenceDigest, /^[0-9a-f]{64}$/u);
  assert.match(request.replacementAuthorityDigest, /^[0-9a-f]{64}$/u);
  assert.match(request.cleanupProofDigest, /^[0-9a-f]{64}$/u);
  assert.match(request.liveTransitionInputDigest, /^[0-9a-f]{64}$/u);
  assert.match(request.requestDigest, /^[0-9a-f]{64}$/u);
});

test("rebuilds the published PR825 live successor executor request dispatch inputs", async () => {
  const seed = await readPr825TerminalizerSeed();
  const plan = createPr825TerminalizerPlan(seed);
  const request = await createPr825LiveSuccessorExecutorRequest({
    authorization: plan.exactAuthorization,
    observedAt: "2026-09-03T08:26:35.861Z",
    expiresAt: "2026-09-03T08:41:35.861Z",
    authorityIssuedAt: "2026-09-03T08:26:35.861Z",
    authorityExpiresAt: "2026-09-03T08:41:35.861Z",
  });

  assert.equal(
    request.dispatch.inputs.operation_input_digest,
    "241a0e1dba3d7c0e314229b4f953ca31c5dd01af57169edd89091c90274b2080",
  );
});

test("dispatch-ready executor request fails closed without the exact authorization line", async () => {
  const seed = await readPr825TerminalizerSeed();
  const plan = createPr825TerminalizerPlan(seed);
  await assert.rejects(
    () => createPr825LiveSuccessorExecutorRequest({
      authorization: `${plan.exactAuthorization} drift`,
      observedAt: OBSERVED_AT,
      expiresAt: EXPIRES_AT,
      authorityIssuedAt: OBSERVED_AT,
      authorityExpiresAt: EXPIRES_AT,
    }),
    /Exact authorization required:/,
  );
});
