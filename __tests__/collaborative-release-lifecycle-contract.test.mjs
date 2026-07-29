import assert from "node:assert/strict";
import test from "node:test";

import {
  consumeHumanAuthorizationReceipt,
  createAuthorizationInteractionReceipt,
  createCandidateManifest,
  createHumanAuthorizationReceipt,
  createIntegrationReceipt,
  createLiveVerificationReceipt,
  createOverlapDispositionReceipt,
  createOverlapPreservationReceipt,
  createPublicationReceipt,
  createRuntimeReviewReceipt,
  dispatchReleaseController,
  validateAuthorizedDeployment,
} from "../scripts/collaborative-release-lifecycle-contract.mjs";

const digest = character => character.repeat(64);
const clock = {
  integrated: "2026-07-29T00:00:00.000Z",
  preserved: "2026-07-28T23:58:00.000Z",
  dispositioned: "2026-07-28T23:59:00.000Z",
  reviewed: "2026-07-29T00:01:00.000Z",
  reviewExpires: "2026-07-29T01:01:00.000Z",
  built: "2026-07-29T00:02:00.000Z",
  authorized: "2026-07-29T00:03:00.000Z",
  authorizationExpires: "2026-07-29T00:33:00.000Z",
  deploy: "2026-07-29T00:04:00.000Z",
  verified: "2026-07-29T00:05:00.000Z",
  published: "2026-07-29T00:06:00.000Z",
};

function collaboration(overrides = {}) {
  return {
    actorId: "actor:authenticated-user",
    deviceId: "device:workstation-a",
    sessionId: "session:one",
    worktreeId: "worktree:scope-a",
    branchId: "branch:scope-a",
    scopeId: "scope:a",
    leaseEpoch: 7,
    fenceRevision: "immutable-fence-revision",
    ...overrides,
  };
}

function buildChain(overrides = {}) {
  const primaryCollaboration = collaboration(overrides.collaboration);
  const secondaryCollaboration = collaboration({
    actorId: "actor:preserved-concurrent-user",
    deviceId: "device:workstation-c",
    sessionId: "session:preserved",
    worktreeId: "worktree:preserved-scope",
    branchId: "branch:preserved-scope",
    scopeId: "scope:preserved",
    leaseEpoch: 9,
    fenceRevision: "preserved-immutable-fence",
  });
  const preservation = createOverlapPreservationReceipt({
    convergenceBaseDigest: digest("8"),
    protectedTipDigest: digest("9"),
    captureAdapterId: "adapter:replaceable-capture",
    entries: [
      {
        collaboration: primaryCollaboration,
        writeSetDigest: digest("6"),
        stateDigest: digest("7"),
        recoveryHandle: "recovery:active-owned-lane",
        preservationMode: "active-lane",
        overlapClass: "overlapping",
      },
      {
        collaboration: secondaryCollaboration,
        writeSetDigest: digest("0"),
        stateDigest: digest("a"),
        recoveryHandle: "recovery:immutable-object",
        preservationMode: "immutable-recovery-object",
        overlapClass: "disjoint",
      },
    ],
    capturedAt: clock.preserved,
  });
  const disposition = createOverlapDispositionReceipt(preservation, {
    preservationReceiptDigest: preservation.receiptDigest,
    convergenceBaseDigest: preservation.convergenceBaseDigest,
    protectedTipDigest: preservation.protectedTipDigest,
    observations: [
      {
        collaboration: primaryCollaboration,
        stateDigest: digest("7"),
        recoveryHandle: "recovery:active-owned-lane",
        disposition: "retained",
      },
      {
        collaboration: secondaryCollaboration,
        stateDigest: digest("a"),
        recoveryHandle: "recovery:immutable-object",
        disposition: "restored",
      },
    ],
    observedAt: clock.dispositioned,
  });
  const integration = createIntegrationReceipt(preservation, disposition, {
    sourceRevision: "immutable-source-revision",
    sourceDigest: digest("a"),
    dependencyClosureDigest: digest("b"),
    checksDigest: digest("c"),
    evaluatorId: "evaluator:protected-checks",
    collaboration: primaryCollaboration,
    integrationTargetDigest: digest("d"),
    integratedAt: clock.integrated,
  });
  const review = createRuntimeReviewReceipt(integration, {
    reviewSurfaceDigest: digest("e"),
    policyDigest: digest("f"),
    probesDigest: digest("1"),
    reviewerId: "operator:reviewer",
    issuedAt: clock.reviewed,
    expiresAt: clock.reviewExpires,
  });
  const candidate = createCandidateManifest(review, {
    targetDigest: digest("2"),
    artifactDigest: digest("3"),
    manifestDigest: digest("4"),
    rollbackTargetDigest: digest("5"),
    builtAt: clock.built,
  });
  const interaction = createAuthorizationInteractionReceipt(candidate, {
    humanActorId: "operator:release-authorizer",
    interactionAdapterId: "interaction:replaceable-adapter",
    transportClass: "interactive-reference-transport",
    browserRequired: false,
    challengeDigest: digest("6"),
    responseDigest: digest("7"),
    recordedAt: clock.authorized,
  });
  const authorization = createHumanAuthorizationReceipt(candidate, interaction, {
    decisionKind: "human",
    humanActorId: "operator:release-authorizer",
    decisionRef: "decision:immutable-reference",
    authorityAdapterId: "authority:replaceable-adapter",
    issuedAt: clock.authorized,
    expiresAt: clock.authorizationExpires,
  });
  return { preservation, disposition, integration, review, candidate, interaction, authorization };
}

function current(chain) {
  return {
    preservationReceiptDigest: chain.preservation.receiptDigest,
    overlapDispositionReceiptDigest: chain.disposition.receiptDigest,
    integrationReceiptDigest: chain.integration.receiptDigest,
    runtimeReviewReceiptDigest: chain.review.receiptDigest,
    candidateDigest: chain.candidate.receiptDigest,
    authorizationReceiptDigest: chain.authorization.receiptDigest,
    sourceDigest: chain.candidate.sourceDigest,
    dependencyClosureDigest: chain.candidate.dependencyClosureDigest,
    policyDigest: chain.candidate.policyDigest,
    targetDigest: chain.candidate.targetDigest,
    artifactDigest: chain.candidate.artifactDigest,
    manifestDigest: chain.candidate.manifestDigest,
  };
}

test("joined receipts authorize the exact candidate and target", () => {
  const chain = buildChain();
  assert.equal(validateAuthorizedDeployment({
    ...chain,
    current: current(chain),
    now: clock.deploy,
  }), true);
});

test("collaboration identity distinguishes actors, devices, sessions, worktrees, scopes, epochs, and fences", () => {
  const first = buildChain().integration;
  const second = buildChain({
    collaboration: {
      actorId: "actor:another-user",
      deviceId: "device:tablet-b",
      sessionId: "session:two",
      worktreeId: "worktree:scope-b",
      branchId: "branch:scope-b",
      scopeId: "scope:b",
      leaseEpoch: 8,
      fenceRevision: "another-immutable-fence",
    },
  }).integration;
  assert.notEqual(first.receiptDigest, second.receiptDigest);
  const chain = buildChain();
  assert.throws(
    () => createIntegrationReceipt(chain.preservation, chain.disposition, {
      sourceRevision: "revision",
      sourceDigest: digest("a"),
      dependencyClosureDigest: digest("b"),
      checksDigest: digest("c"),
      evaluatorId: "evaluator",
      collaboration: {
        deviceId: "device",
        sessionId: "session",
        worktreeId: "worktree",
        branchId: "branch",
        scopeId: "scope",
        leaseEpoch: 1,
        fenceRevision: "fence",
      },
      integrationTargetDigest: digest("d"),
      integratedAt: clock.integrated,
    }),
    /missing or unknown fields/,
  );
});

for (const field of [
  "preservationReceiptDigest",
  "overlapDispositionReceiptDigest",
  "sourceDigest",
  "dependencyClosureDigest",
  "policyDigest",
  "targetDigest",
  "artifactDigest",
  "manifestDigest",
  "integrationReceiptDigest",
  "runtimeReviewReceiptDigest",
  "candidateDigest",
  "authorizationReceiptDigest",
]) {
  test(`forward deployment fails closed on ${field} drift`, () => {
    const chain = buildChain();
    const observed = current(chain);
    observed[field] = digest(field === "sourceDigest" ? "9" : "8");
    assert.throws(
      () => validateAuthorizedDeployment({ ...chain, current: observed, now: clock.deploy }),
      new RegExp(`${field} drift`),
    );
  });
}

test("overlapping work remains retained while exact disjoint state may be restored", () => {
  const chain = buildChain();
  assert.equal(chain.preservation.entries.length, 2);
  assert.deepEqual(
    new Set(chain.disposition.observations.map(entry => entry.disposition)),
    new Set(["retained", "restored"]),
  );
  const overlapping = chain.preservation.entries.find(entry => entry.overlapClass === "overlapping");
  assert.throws(
    () => createOverlapDispositionReceipt(chain.preservation, {
      preservationReceiptDigest: chain.preservation.receiptDigest,
      convergenceBaseDigest: chain.preservation.convergenceBaseDigest,
      protectedTipDigest: chain.preservation.protectedTipDigest,
      observations: chain.disposition.observations.map(entry => ({
        ...entry,
        disposition: entry.collaboration.scopeId === overlapping.collaboration.scopeId ? "restored" : entry.disposition,
      })),
      observedAt: clock.dispositioned,
    }),
    /must remain retained/,
  );
});

test("overlap disposition fails closed on missing, changed, or unaccounted work", () => {
  const chain = buildChain();
  const observations = chain.disposition.observations;
  assert.throws(
    () => createOverlapDispositionReceipt(chain.preservation, {
      preservationReceiptDigest: chain.preservation.receiptDigest,
      convergenceBaseDigest: chain.preservation.convergenceBaseDigest,
      protectedTipDigest: chain.preservation.protectedTipDigest,
      observations: observations.slice(1),
      observedAt: clock.dispositioned,
    }),
    /account for every preserved entry/,
  );
  assert.throws(
    () => createOverlapDispositionReceipt(chain.preservation, {
      preservationReceiptDigest: chain.preservation.receiptDigest,
      convergenceBaseDigest: chain.preservation.convergenceBaseDigest,
      protectedTipDigest: chain.preservation.protectedTipDigest,
      observations: observations.map((entry, index) => ({
        ...entry,
        stateDigest: index === 0 ? digest("f") : entry.stateDigest,
      })),
      observedAt: clock.dispositioned,
    }),
    /state or recovery identity drifted/,
  );
});

test("authorization interaction is candidate-bound, transport-explicit, and browser-capability explicit", () => {
  const { candidate } = buildChain();
  const interaction = createAuthorizationInteractionReceipt(candidate, {
    humanActorId: "operator",
    interactionAdapterId: "adapter",
    transportClass: "interactive-transport",
    browserRequired: false,
    challengeDigest: digest("1"),
    responseDigest: digest("2"),
    recordedAt: clock.authorized,
  });
  assert.equal(interaction.candidateDigest, candidate.receiptDigest);
  assert.equal(interaction.browserRequired, false);
  assert.throws(
    () => createAuthorizationInteractionReceipt(candidate, {
      humanActorId: "operator",
      interactionAdapterId: "adapter",
      transportClass: "interactive-transport",
      browserRequired: "false",
      challengeDigest: digest("1"),
      responseDigest: digest("2"),
      recordedAt: clock.authorized,
    }),
    /must be a boolean/,
  );
});

test("authorization cannot be synthesized by a machine, detached from interaction, or issued before it", () => {
  const { candidate, interaction } = buildChain();
  assert.throws(
    () => createHumanAuthorizationReceipt(candidate, interaction, {
      decisionKind: "machine",
      humanActorId: "agent",
      decisionRef: "decision",
      authorityAdapterId: "adapter",
      issuedAt: clock.authorized,
      expiresAt: clock.authorizationExpires,
    }),
    /authenticated human decision/,
  );
  assert.throws(
    () => createHumanAuthorizationReceipt(candidate, interaction, {
      decisionKind: "human",
      humanActorId: "operator:release-authorizer",
      decisionRef: "decision",
      authorityAdapterId: "adapter",
      issuedAt: "2026-07-28T23:59:00.000Z",
      expiresAt: clock.authorizationExpires,
    }),
    /cannot predate its interaction evidence/,
  );
  assert.throws(
    () => createHumanAuthorizationReceipt(candidate, interaction, {
      decisionKind: "human",
      humanActorId: "operator:another-human",
      decisionRef: "decision",
      authorityAdapterId: "adapter",
      issuedAt: clock.authorized,
      expiresAt: clock.authorizationExpires,
    }),
    /another candidate, target, or actor/,
  );
});

test("expired and consumed authorization cannot be replayed", () => {
  const chain = buildChain();
  assert.throws(
    () => validateAuthorizedDeployment({
      ...chain,
      current: current(chain),
      now: "2026-07-29T00:34:00.000Z",
    }),
    /expired/,
  );
  const consumed = consumeHumanAuthorizationReceipt(chain.authorization, {
    consumedAt: clock.deploy,
    controllerId: "controller:one",
  });
  assert.equal(consumed.status, "consumed");
  assert.throws(
    () => consumeHumanAuthorizationReceipt(consumed, {
      consumedAt: clock.deploy,
      controllerId: "controller:two",
    }),
    /schema or status|unconsumed|already consumed|missing or unknown fields/,
  );
});

test("one target controller owns deployment while exact duplicates coalesce", () => {
  const { candidate } = buildChain();
  const first = dispatchReleaseController({}, {
    targetDigest: candidate.targetDigest,
    candidateDigest: candidate.receiptDigest,
    controllerId: "controller:one",
  });
  assert.equal(first.status, "claimed");
  const duplicate = dispatchReleaseController(first.ledger, {
    targetDigest: candidate.targetDigest,
    candidateDigest: candidate.receiptDigest,
    controllerId: "controller:two",
  });
  assert.equal(duplicate.status, "coalesced");
  assert.equal(duplicate.ownerControllerId, "controller:one");
  assert.throws(
    () => dispatchReleaseController(first.ledger, {
      targetDigest: candidate.targetDigest,
      candidateDigest: digest("7"),
      controllerId: "controller:two",
    }),
    /competing release candidate/,
  );
});

test("publication is joined to consumed authorization and live verification", () => {
  const chain = buildChain();
  const consumed = consumeHumanAuthorizationReceipt(chain.authorization, {
    consumedAt: clock.deploy,
    controllerId: "controller:one",
  });
  const live = createLiveVerificationReceipt(consumed, {
    deployedArtifactDigest: chain.candidate.artifactDigest,
    observedRuntimeDigest: digest("6"),
    probesDigest: digest("7"),
    rollbackTargetDigest: chain.candidate.rollbackTargetDigest,
    verifiedAt: clock.verified,
  });
  const publication = createPublicationReceipt(live, {
    publicationIdentitiesDigest: digest("8"),
    publishedAt: clock.published,
  });
  assert.equal(publication.liveVerificationReceiptDigest, live.receiptDigest);
  assert.equal(publication.candidateDigest, chain.candidate.receiptDigest);
  assert.equal(publication.targetDigest, chain.candidate.targetDigest);
});

test("receipt chains reject mismatched integration ancestry", () => {
  const first = buildChain();
  const second = buildChain({ collaboration: { sessionId: "session:other" } });
  assert.throws(
    () => validateAuthorizedDeployment({
      integration: second.integration,
      review: first.review,
      candidate: first.candidate,
      authorization: first.authorization,
      current: current(first),
      now: clock.deploy,
    }),
    /unjoined/,
  );
});
