import assert from "node:assert/strict";
import test from "node:test";

import { readPr825IntegrateTransitionInput } from "../scripts/pr825-integrate-input.mjs";
import { createPr825ReplacementTransitionAuthority } from "../scripts/pr825-replacement-transition-authority.mjs";
import { createPr825TerminalizerPlan } from "../scripts/pr825-terminalizer-controller.mjs";
import {
  PR825_RETAINED_AUTHORITY,
  readPr825RetainedAuthorityRecord,
} from "../scripts/pr825-retained-authority-record.mjs";
import { readPr825TerminalizerSeed } from "../scripts/pr825-terminalizer-seed.mjs";

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

test("builds the published PR825 successor-bound integrate input from live provider proof bytes", async () => {
  const seed = await readPr825TerminalizerSeed();
  const plan = createPr825TerminalizerPlan(seed);
  const replacementAuthority = await createPr825ReplacementTransitionAuthority({
    authorization: plan.exactAuthorization,
  });
  const predecessorAuthority = {
    schema: "agentic-os/github-successor-predecessor/v1",
    authorityKind: replacementAuthority.replacementAuthority.authorityKind,
    authorityRef: "refs/heads/main",
    reviewLocator: replacementAuthority.replacementAuthority.reviewLocator,
    sourceBranch: replacementAuthority.replacementAuthority.exactJoin.sourceBranch,
    immutableRevision: replacementAuthority.replacementAuthority.immutableRevision,
    reviewedSourceHead: replacementAuthority.replacementAuthority.reviewedSourceHead,
    reviewedSourceTree: replacementAuthority.replacementAuthority.reviewedSourceTree,
    protectedBase: replacementAuthority.replacementAuthority.protectedBase,
    predecessorIssuanceDigest: replacementAuthority.replacementAuthority.predecessorIssuanceDigest,
    predecessorTransitionReceiptDigest:
      replacementAuthority.predecessorAuthority.transitionReceiptDigest,
    adoptedTerminalClaimId: replacementAuthority.replacementAuthority.adoptedTerminalClaimId,
    adoptedLineageDigest: replacementAuthority.replacementAuthority.adoptedLineageDigest,
    integrationReceiptDigest: replacementAuthority.replacementAuthority.integrationReceiptDigest,
    reviewRequestId: replacementAuthority.replacementAuthority.reviewRequestId,
    retirementReason: replacementAuthority.replacementAuthority.retirementReason,
    adoptionDisposition: replacementAuthority.replacementAuthority.adoptionDisposition,
    cloudMutation: replacementAuthority.replacementAuthority.cloudMutation,
    issuedAt: "2026-09-03T08:26:35.861Z",
    expiresAt: "2026-09-03T08:41:35.861Z",
  };
  const result = await readPr825IntegrateTransitionInput({
    observedAt: "2026-09-03T08:26:35.861Z",
    expiresAt: "2026-09-03T08:41:35.861Z",
    predecessorAuthority,
  });

  assert.equal(result.validationError, null);
  assert.equal(result.providerProofDigest, "9ab7c7755abb0f078c89a9a9e209a52d5b5ac512200c82156b7572a645773a96");
  assert.equal(result.plan.parametersDigest, result.providerProofDigest);
  assert.equal(result.planByteDigest, "c1c36b4f3a17fcfa70316e9c2c396a2417dd0465702227a23ce368f4f8f8d152");
  assert.equal(result.operationInputDigest, "241a0e1dba3d7c0e314229b4f953ca31c5dd01af57169edd89091c90274b2080");
  assert.equal(result.transitionWorkflowRevision, "5c96826499ef3a8608d0a9554e32bc224bebb58b");
  assert.equal(result.operationInput.predecessorIssuance, null);
  assert.equal(
    result.operationInput.predecessorAuthority.predecessorTransitionReceiptDigest,
    replacementAuthority.predecessorAuthority.transitionReceiptDigest,
  );
});
