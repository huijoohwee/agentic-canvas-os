import assert from "node:assert/strict";
import test from "node:test";

import { createPr825TerminalizerPlan } from "../scripts/pr825-terminalizer-controller.mjs";
import {
  PR825_SUCCESSOR_EXECUTOR_REQUEST_SCHEMA,
  createPr825SuccessorExecutorRequest,
} from "../scripts/pr825-successor-executor-request.mjs";
import { readPr825TerminalizerSeed } from "../scripts/pr825-terminalizer-seed.mjs";

test("seals the PR825 successor executor dispatch contract without inventing transition payload bytes", async () => {
  const seed = await readPr825TerminalizerSeed();
  const plan = createPr825TerminalizerPlan(seed);
  const request = await createPr825SuccessorExecutorRequest({
    authorization: plan.exactAuthorization,
  });

  assert.equal(request.schema, PR825_SUCCESSOR_EXECUTOR_REQUEST_SCHEMA);
  assert.equal(request.seedDigest, seed.seedDigest);
  assert.equal(request.planDigest, plan.planDigest);
  assert.equal(request.dispatch.workflowPath, ".github/workflows/adlc-transition.yml");
  assert.equal(request.dispatch.ref, "main");
  assert.equal(request.dispatch.event, "workflow_dispatch");
  assert.equal(request.dispatch.githubApiVersion, "2026-03-10");
  assert.equal(request.dispatch.returnRunDetails, true);
  assert.equal(request.dispatch.retainProviderRun, true);
  assert.equal(request.dispatch.runDiscoveryForbidden, true);
  assert.deepEqual(request.dispatch.requiredInputs, [
    "operation_payload",
    "operation_input_digest",
  ]);
  assert.equal(request.dispatch.payloadReady, false);
  assert.equal(request.dispatch.inputs.operation_payload, null);
  assert.equal(request.dispatch.inputs.operation_input_digest, null);
  assert.equal(
    request.successorPurpose,
    "mint-live-successor-integration-and-retirement-receipts",
  );
  assert.equal(request.executorBlockedBy.reason, "pending-successor-transition-input");
  assert.equal(
    request.executorBlockedBy.blockedCleanupReason,
    "pending-live-successor-receipts",
  );
  for (const [field, value] of Object.entries(request.pendingDynamicBindings)) {
    assert.equal(value, null, field);
  }
  assert.match(request.authorizationDigest, /^[0-9a-f]{64}$/u);
  assert.match(request.evidenceDigest, /^[0-9a-f]{64}$/u);
  assert.match(request.replacementAuthorityDigest, /^[0-9a-f]{64}$/u);
  assert.match(request.cleanupProofDigest, /^[0-9a-f]{64}$/u);
  assert.match(request.pendingFieldsDigest, /^[0-9a-f]{64}$/u);
  assert.match(request.requestDigest, /^[0-9a-f]{64}$/u);
});

test("successor executor request fails closed without the exact authorization line", async () => {
  const seed = await readPr825TerminalizerSeed();
  const plan = createPr825TerminalizerPlan(seed);
  await assert.rejects(
    () => createPr825SuccessorExecutorRequest({
      authorization: `${plan.exactAuthorization} drift`,
    }),
    /Exact authorization required:/,
  );
});
