import assert from "node:assert/strict";
import test from "node:test";

import {
  PR825_TERMINALIZER_OPERATION,
  readPr825TerminalizerSeed,
} from "../scripts/pr825-terminalizer-seed.mjs";

test("builds a sealed successor seed from the retained authority and blocked integrate proof", async () => {
  const seed = await readPr825TerminalizerSeed();

  assert.equal(seed.schema, "agentic-canvas-os/pr825-terminalizer-seed/v1");
  assert.deepEqual(seed.operation, PR825_TERMINALIZER_OPERATION);
  assert.equal(seed.reviewLocator, "https://github.com/huijoohwee/agentic-canvas-os/pull/825");
  assert.equal(
    seed.sourceBranch,
    "agent/katrinas-macbook-pro.local/active-dirt-marker-replay-order",
  );
  assert.equal(seed.protectedMergeSha, "ed7461e5b272da1cba4cd31c079e12259965eaf1");
  assert.equal(
    seed.blockedIntegrate.validationError,
    "integrate does not bind the exact predecessor GitHub authority issuance",
  );
  assert.equal(seed.successorConstraints.requireAppendOnlyEvidence, true);
  assert.equal(seed.successorConstraints.forbidFreshClaimCoordinateReuse, true);
  assert.equal(seed.successorConstraints.forbidExpiredPredecessorReuse, true);
  assert.deepEqual(seed.successorOutputs, [
    "append-only-recovery-evidence",
    "replacement-transition-authority",
    "cleanup-joinable-retirement-proof",
  ]);
  for (const key of [
    "storedDigest",
    "publicationReceiptDigest",
    "transitionReceiptDigest",
    "issuanceDigest",
  ]) {
    assert.match(seed.retainedAuthority[key], /^[0-9a-f]{64}$/u, key);
  }
  for (const key of [
    "requestDigest",
    "planDigest",
    "planByteDigest",
    "seedDigest",
  ]) {
    assert.match(seed.blockedIntegrate[key] ?? seed[key], /^[0-9a-f]{64}$/u, key);
  }
});
