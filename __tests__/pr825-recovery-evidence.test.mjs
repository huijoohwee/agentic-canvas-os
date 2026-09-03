import assert from "node:assert/strict";
import test from "node:test";

import { createPr825TerminalizerPlan } from "../scripts/pr825-terminalizer-controller.mjs";
import {
  PR825_RECOVERY_EVIDENCE_SCHEMA,
  PR825_RECOVERY_EVIDENCE_FIXED,
  createPr825AppendOnlyRecoveryEvidence,
} from "../scripts/pr825-recovery-evidence.mjs";
import { readPr825TerminalizerSeed } from "../scripts/pr825-terminalizer-seed.mjs";

test("captures sealed append-only recovery evidence for PR825 step 1", async () => {
  const seed = await readPr825TerminalizerSeed();
  const plan = createPr825TerminalizerPlan(seed);
  const evidence = await createPr825AppendOnlyRecoveryEvidence({
    authorization: plan.exactAuthorization,
  });

  assert.equal(evidence.schema, PR825_RECOVERY_EVIDENCE_SCHEMA);
  assert.equal(evidence.planDigest, plan.planDigest);
  assert.equal(evidence.seedDigest, seed.seedDigest);
  assert.equal(evidence.stepId, "capture-append-only-recovery-evidence");
  assert.equal(evidence.stepOutput, "append-only-recovery-evidence");
  assert.equal(evidence.pullRequest, 825);
  assert.equal(evidence.authority, PR825_RECOVERY_EVIDENCE_FIXED.authority);
  assert.equal(evidence.runtimeScope, PR825_RECOVERY_EVIDENCE_FIXED.runtimeScope);
  assert.equal(
    evidence.protectedSubject.reviewLocator,
    "https://github.com/huijoohwee/agentic-canvas-os/pull/825",
  );
  assert.equal(
    evidence.protectedSubject.reviewedRunId,
    PR825_RECOVERY_EVIDENCE_FIXED.reviewedRunId,
  );
  assert.equal(
    evidence.protectedSubject.postMergeRunId,
    PR825_RECOVERY_EVIDENCE_FIXED.postMergeRunId,
  );
  assert.equal(
    evidence.blockedIntegrate.validationError,
    "integrate does not bind the exact predecessor GitHub authority issuance",
  );
  assert.equal(evidence.successorBoundary.requireAppendOnlyEvidence, true);
  assert.equal(evidence.successorBoundary.forbidExpiredPredecessorReuse, true);
  assert.equal(evidence.mutation, false);
  assert.match(evidence.authorizationDigest, /^[0-9a-f]{64}$/u);
  assert.match(evidence.planDigest, /^[0-9a-f]{64}$/u);
  assert.match(evidence.evidenceDigest, /^[0-9a-f]{64}$/u);
  assert.match(evidence.retainedAuthority.storedDigest, /^[0-9a-f]{64}$/u);
  assert.match(evidence.retainedAuthority.publicationReceiptDigest, /^[0-9a-f]{64}$/u);
  assert.match(evidence.retainedAuthority.transitionReceiptDigest, /^[0-9a-f]{64}$/u);
  assert.match(evidence.retainedAuthority.issuanceDigest, /^[0-9a-f]{64}$/u);
  assert.match(evidence.blockedIntegrate.requestDigest, /^[0-9a-f]{64}$/u);
  assert.match(evidence.blockedIntegrate.planDigest, /^[0-9a-f]{64}$/u);
  assert.match(evidence.blockedIntegrate.planByteDigest, /^[0-9a-f]{64}$/u);
});

test("recovery evidence fails closed without the exact authorization line", async () => {
  const seed = await readPr825TerminalizerSeed();
  const plan = createPr825TerminalizerPlan(seed);
  await assert.rejects(
    () => createPr825AppendOnlyRecoveryEvidence({
      authorization: `${plan.exactAuthorization} drift`,
    }),
    /Exact authorization required:/,
  );
});
