import assert from "node:assert/strict";
import test from "node:test";

import { createPr825TerminalizerPlan } from "../scripts/pr825-terminalizer-controller.mjs";
import {
  PR825_CLEANUP_JOINABLE_RETIREMENT_PROOF_SCHEMA,
  createPr825CleanupJoinableRetirementProof,
} from "../scripts/pr825-cleanup-joinable-retirement-proof.mjs";
import { readPr825TerminalizerSeed } from "../scripts/pr825-terminalizer-seed.mjs";

test("binds the PR825 cleanup join surface without inventing live successor receipts", async () => {
  const seed = await readPr825TerminalizerSeed();
  const plan = createPr825TerminalizerPlan(seed);
  const proof = await createPr825CleanupJoinableRetirementProof({
    authorization: plan.exactAuthorization,
    canonicalRevision: "99c7acf754d2c1659de684e93a9eaacd77b89ca3",
  });

  assert.equal(proof.schema, PR825_CLEANUP_JOINABLE_RETIREMENT_PROOF_SCHEMA);
  assert.equal(proof.planDigest, plan.planDigest);
  assert.equal(proof.seedDigest, seed.seedDigest);
  assert.equal(proof.stepId, "bind-cleanup-joinable-retirement-proof");
  assert.equal(proof.stepOutput, "cleanup-joinable-retirement-proof");
  assert.equal(proof.cleanupJoin.repository, "github.com/huijoohwee/agentic-canvas-os");
  assert.equal(
    proof.cleanupJoin.targetPath,
    "/Users/katrina/Documents/GitHub/.worktrees/agentic-canvas-os/active-dirt-marker-replay-order",
  );
  assert.equal(
    proof.cleanupJoin.expectedBranch,
    "agent/katrinas-macbook-pro.local/active-dirt-marker-replay-order",
  );
  assert.equal(
    proof.cleanupJoin.expectedHeadRevision,
    "c16dee29507a26cb0c8b2e8e6f9b9d80204e4a57",
  );
  assert.equal(proof.cleanupJoin.expectedCanonicalRef, "refs/heads/main");
  assert.equal(
    proof.cleanupJoin.expectedCanonicalRevision,
    "99c7acf754d2c1659de684e93a9eaacd77b89ca3",
  );
  assert.equal(
    proof.cleanupJoin.integratedResource,
    "https://github.com/huijoohwee/agentic-canvas-os/pull/825",
  );
  assert.equal(
    proof.cleanupJoin.integratedImmutableRevision,
    "ed7461e5b272da1cba4cd31c079e12259965eaf1",
  );
  assert.equal(
    proof.cleanupJoin.integrationPredecessorDigest,
    "8e2c2490b5e4d3f843d26b88ea09cb52483578dcbf1200d17f89c3939dab91cc",
  );
  assert.equal(proof.cleanupReady, false);
  assert.equal(proof.cleanupBlockedBy.reason, "pending-live-successor-receipts");
  assert.equal(
    proof.cleanupBlockedBy.validationError,
    "integrate does not bind the exact predecessor GitHub authority issuance",
  );
  for (const [field, value] of Object.entries(proof.pendingDynamicBindings)) {
    assert.equal(value, null, field);
  }
  assert.match(proof.authorizationDigest, /^[0-9a-f]{64}$/u);
  assert.match(proof.evidenceDigest, /^[0-9a-f]{64}$/u);
  assert.match(proof.replacementAuthorityDigest, /^[0-9a-f]{64}$/u);
  assert.match(proof.pendingFieldsDigest, /^[0-9a-f]{64}$/u);
  assert.match(proof.proofDigest, /^[0-9a-f]{64}$/u);
});

test("cleanup-joinable retirement proof fails closed without the exact authorization line", async () => {
  const seed = await readPr825TerminalizerSeed();
  const plan = createPr825TerminalizerPlan(seed);
  await assert.rejects(
    () => createPr825CleanupJoinableRetirementProof({
      authorization: `${plan.exactAuthorization} drift`,
    }),
    /Exact authorization required:/,
  );
});
