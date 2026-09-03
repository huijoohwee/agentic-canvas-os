import assert from "node:assert/strict";
import test from "node:test";

import { createPr825TerminalizerPlan } from "../scripts/pr825-terminalizer-controller.mjs";
import {
  PR825_FIXED_TERMINAL_CLOUD,
  PR825_REPLACEMENT_TRANSITION_AUTHORITY_SCHEMA,
  createPr825ReplacementTransitionAuthority,
} from "../scripts/pr825-replacement-transition-authority.mjs";
import { readPr825TerminalizerSeed } from "../scripts/pr825-terminalizer-seed.mjs";

test("builds the PR825 replacement transition authority from sealed recovery evidence", async () => {
  const seed = await readPr825TerminalizerSeed();
  const plan = createPr825TerminalizerPlan(seed);
  const authority = await createPr825ReplacementTransitionAuthority({
    authorization: plan.exactAuthorization,
  });

  assert.equal(authority.schema, PR825_REPLACEMENT_TRANSITION_AUTHORITY_SCHEMA);
  assert.equal(authority.planDigest, plan.planDigest);
  assert.equal(authority.seedDigest, seed.seedDigest);
  assert.equal(authority.stepId, "construct-replacement-transition-authority");
  assert.equal(authority.stepOutput, "replacement-transition-authority");
  assert.equal(
    authority.predecessorAuthority.terminallyBlockedBy,
    "integrate does not bind the exact predecessor GitHub authority issuance",
  );
  assert.equal(
    authority.predecessorAuthority.claimId,
    "b45643809957961b036226db945d3be794e69ae88041ef23a8d3c6dbca06f77d",
  );
  assert.equal(
    authority.adoptedTerminalCloud.claimId,
    PR825_FIXED_TERMINAL_CLOUD.claimId,
  );
  assert.equal(
    authority.adoptedTerminalCloud.retirementReason,
    "integrated",
  );
  assert.equal(
    authority.replacementAuthority.adoptionDisposition,
    "response-loss-adopted",
  );
  assert.equal(authority.replacementAuthority.cloudMutation, false);
  assert.equal(
    authority.replacementAuthority.immutableRevision,
    "ed7461e5b272da1cba4cd31c079e12259965eaf1",
  );
  assert.equal(
    authority.replacementAuthority.exactJoin.terminalCloudClaimId,
    PR825_FIXED_TERMINAL_CLOUD.claimId,
  );
  assert.notEqual(
    authority.predecessorAuthority.claimId,
    authority.adoptedTerminalCloud.claimId,
  );
  assert.match(authority.authorizationDigest, /^[0-9a-f]{64}$/u);
  assert.match(authority.evidenceDigest, /^[0-9a-f]{64}$/u);
  assert.match(authority.replacementAuthorityDigest, /^[0-9a-f]{64}$/u);
  assert.match(authority.adoptedTerminalCloud.lineageDigest, /^[0-9a-f]{64}$/u);
  assert.match(authority.adoptedTerminalCloud.integrateEntryDigest, /^[0-9a-f]{64}$/u);
  assert.match(authority.adoptedTerminalCloud.retireIdempotencyKey, /^[0-9a-f]{64}$/u);
  assert.match(authority.adoptedTerminalCloud.retireRequestDigest, /^[0-9a-f]{64}$/u);
  assert.match(authority.adoptedTerminalCloud.terminalEntryDigest, /^[0-9a-f]{64}$/u);
  assert.match(authority.adoptedTerminalCloud.terminalClaimDigest, /^[0-9a-f]{64}$/u);
});

test("replacement transition authority fails closed without the exact authorization line", async () => {
  const seed = await readPr825TerminalizerSeed();
  const plan = createPr825TerminalizerPlan(seed);
  await assert.rejects(
    () => createPr825ReplacementTransitionAuthority({
      authorization: `${plan.exactAuthorization} drift`,
    }),
    /Exact authorization required:/,
  );
});
