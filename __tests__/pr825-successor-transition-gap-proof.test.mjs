import assert from "node:assert/strict";
import test from "node:test";

import { createPr825TerminalizerPlan } from "../scripts/pr825-terminalizer-controller.mjs";
import {
  PR825_SUCCESSOR_TRANSITION_GAP_PROOF_SCHEMA,
  createPr825SuccessorTransitionGapProof,
} from "../scripts/pr825-successor-transition-gap-proof.mjs";
import { readPr825TerminalizerSeed } from "../scripts/pr825-terminalizer-seed.mjs";

test("seals the exact PR825 successor transition schema gap", async () => {
  const seed = await readPr825TerminalizerSeed();
  const plan = createPr825TerminalizerPlan(seed);
  const proof = await createPr825SuccessorTransitionGapProof({
    authorization: plan.exactAuthorization,
  });

  assert.equal(proof.schema, PR825_SUCCESSOR_TRANSITION_GAP_PROOF_SCHEMA);
  assert.equal(proof.seedDigest, seed.seedDigest);
  assert.equal(proof.planDigest, plan.planDigest);
  assert.equal(proof.payloadReady, false);
  assert.equal(
    proof.blockedBy,
    "current-transition-schema-requires-published-predecessor-issuance",
  );
  assert.equal(proof.blockedAttempt.requestedTransition, "integrate");
  assert.equal(
    proof.blockedAttempt.validationError,
    "integrate does not bind the exact predecessor GitHub authority issuance",
  );
  assert.equal(proof.replacementAuthoritySubject.authorityKind,
    "append-only-replacement-transition-authority");
  assert.equal(
    proof.requiredSurfaceExtension.adapterKind,
    "replacement-transition-authority-predecessor",
  );
  assert.deepEqual(
    proof.blockedSurfaces.map((surface) => surface.id),
    [
      "transition-input-predecessor-shape",
      "authority-issuance-publication-replay",
      "authority-read-provider-live-proof",
      "transition-authority-source-window",
      "transition-authority-policy-anchor",
    ],
  );
  assert.deepEqual(proof.requiredSurfaceExtension.requiredBindings, [
    "reviewLocator",
    "immutableRevision",
    "reviewedSourceHead",
    "reviewedSourceTree",
    "protectedBase",
    "predecessorIssuanceDigest",
    "adoptedTerminalClaimId",
    "adoptedLineageDigest",
    "integrationReceiptDigest",
    "reviewRequestId",
    "retirementReason",
    "adoptionDisposition",
    "cloudMutation",
  ]);
  assert.equal(
    proof.requiredSurfaceExtension.liveProofExpectation.publicationReplayRequired,
    false,
  );
  assert.match(proof.authorizationDigest, /^[0-9a-f]{64}$/u);
  assert.match(proof.evidenceDigest, /^[0-9a-f]{64}$/u);
  assert.match(proof.replacementAuthorityDigest, /^[0-9a-f]{64}$/u);
  assert.match(proof.cleanupProofDigest, /^[0-9a-f]{64}$/u);
  assert.match(proof.proofDigest, /^[0-9a-f]{64}$/u);
});

test("successor transition gap proof fails closed without the exact authorization line", async () => {
  const seed = await readPr825TerminalizerSeed();
  const plan = createPr825TerminalizerPlan(seed);
  await assert.rejects(
    () => createPr825SuccessorTransitionGapProof({
      authorization: `${plan.exactAuthorization} drift`,
    }),
    /Exact authorization required:/,
  );
});
