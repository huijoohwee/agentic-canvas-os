import assert from "node:assert/strict";
import test from "node:test";
import {
  PROVIDER_NEUTRAL_PRODUCTION_AUTHORIZATION_AUTHORITY_SCHEMA,
  PROVIDER_NEUTRAL_PRODUCTION_AUTHORIZATION_READINESS_SCHEMA,
  PROVIDER_NEUTRAL_PRODUCTION_AUTHORIZATION_PROMPT_SCHEMA,
  PRODUCTION_AUTHORIZATION_LOCAL_FORMATTER_PATH,
  PRODUCTION_RELEASE_AUTHORIZATION_SCHEMA,
  createProviderNeutralProductionAuthorizationPrompt,
  createProductionAuthorizationPrompt,
  createLocalReviewCandidate,
  createProductionReleaseCandidate,
  formatProviderNeutralProductionAuthorizationPrompt,
  formatProductionAuthorizationPrompt,
  validateProviderNeutralProductionAuthorizationPrompt,
  validateProductionAuthorizationPrompt,
  validateProductionReleaseAuthorization,
} from "../scripts/production-release-authorization-contract.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  createAuthorizationInteractionReceipt,
  createCandidateManifest,
  createIntegrationReceipt,
  createOverlapDispositionReceipt,
  createOverlapPreservationReceipt,
  createRuntimeReviewReceipt,
} from "../scripts/collaborative-release-lifecycle-contract.mjs";
const sourceRevision = "a".repeat(40);
const sourceTree = "b".repeat(40);
const docsRevision = "c".repeat(40);
const docsTree = "d".repeat(40);
const runtime = {
  status: "runtime-ready",
  ready: true,
  source: { repository: "huijoohwee/knowgrph", revision: sourceRevision },
  agenticCanvasOs: { repository: "huijoohwee/agentic-canvas-os", revision: docsRevision },
  catalogRevision: docsRevision,
  probes: { apex: 200, storage: 200, storageProxy: 200 },
  protectedChecks: { knowgrph: ["Integration Gate"], "agentic-canvas-os": ["test"] },
  ownershipTokenDigest: "e".repeat(64),
  host: "127.0.0.1",
  ports: { apex: 5173, storage: 8787 },
};
const trees = {
  source: { repository: "huijoohwee/knowgrph", revision: sourceRevision, tree: sourceTree },
  agenticCanvasOs: { repository: "huijoohwee/agentic-canvas-os", revision: docsRevision, tree: docsTree },
};
const readiness = {
  schema: "agenticgraph-production-runtime-readiness/v2",
  status: "verified-build",
  source: { repository: "huijoohwee/knowgrph", revision: sourceRevision, tree: sourceTree },
  agenticCanvasOs: { repository: "huijoohwee/agentic-canvas-os", revision: docsRevision },
  catalogRevision: docsRevision,
  artifact: { algorithm: "sha256", digest: "f".repeat(64) },
  immutableManifest: { algorithm: "sha256", digest: "1".repeat(64) },
  mirror: { repository: "huijoohwee/huijoohwee" },
  surfaces: ["/", "/agenticgraph"],
};
const gameXrRevision = "803e3a2a20dfcd1401673690a3b5d82500322f67";
const neutralReviewSurface = {
  locator: "https://1f6b2f09.joohwee.pages.dev/gamexr/",
};
const neutralProbes = {
  "camera-motion": "passed",
  "offline-shell": "passed",
  "service-worker-integrity": "passed",
};
const neutralClock = {
  preserved: "2026-08-08T00:00:00.000Z",
  dispositioned: "2026-08-08T00:01:00.000Z",
  integrated: "2026-08-08T00:02:00.000Z",
  reviewed: "2026-08-08T00:03:00.000Z",
  built: "2026-08-08T00:04:00.000Z",
  observed: "2026-08-08T00:05:00.000Z",
  authority: "2026-08-08T00:05:30.000Z",
  prompted: "2026-08-08T00:06:00.000Z",
  expires: "2026-08-08T01:00:00.000Z",
};
const testDigest = character => character.repeat(64);
function buildNeutralChain() {
  const preservation = createOverlapPreservationReceipt({
    convergenceBaseDigest: testDigest("1"),
    protectedTipDigest: testDigest("2"),
    captureAdapterId: "adapter:test",
    entries: [],
    capturedAt: neutralClock.preserved,
  });
  const disposition = createOverlapDispositionReceipt(preservation, {
    preservationReceiptDigest: preservation.receiptDigest,
    convergenceBaseDigest: preservation.convergenceBaseDigest,
    protectedTipDigest: preservation.protectedTipDigest,
    observations: [],
    observedAt: neutralClock.dispositioned,
  });
  const integration = createIntegrationReceipt(preservation, disposition, {
    sourceRevision: gameXrRevision,
    sourceDigest: testDigest("3"),
    dependencyClosureDigest: testDigest("4"),
    checksDigest: testDigest("5"),
    evaluatorId: "evaluator:test",
    collaboration: {
      actorId: "actor:test",
      deviceId: "device:test",
      sessionId: "session:test",
      worktreeId: "worktree:test",
      branchId: "branch:test",
      scopeId: "scope:test",
      leaseEpoch: 1,
      fenceRevision: "fence:test",
    },
    integrationTargetDigest: testDigest("6"),
    integratedAt: neutralClock.integrated,
  });
  const review = createRuntimeReviewReceipt(integration, {
    reviewSurfaceDigest: digestValue(neutralReviewSurface),
    policyDigest: testDigest("8"),
    probesDigest: digestValue(neutralProbes),
    reviewerId: "reviewer:test",
    issuedAt: neutralClock.reviewed,
    expiresAt: neutralClock.expires,
  });
  const candidate = createCandidateManifest(review, {
    targetDigest: testDigest("a"),
    artifactDigest: testDigest("b"),
    manifestDigest: testDigest("c"),
    rollbackTargetDigest: testDigest("d"),
    builtAt: neutralClock.built,
  });
  return { preservation, disposition, integration, review, candidate };
}
function neutralReadiness(chain, overrides = {}, authority = neutralAuthority(chain)) {
  return {
    schema: PROVIDER_NEUTRAL_PRODUCTION_AUTHORIZATION_READINESS_SCHEMA,
    status: "runtime-ready",
    ready: true,
    canonicalSourceRevision: authority.canonicalSourceRevision,
    releaseOwnerSourceRevision: authority.releaseOwnerSourceRevision,
    lifecycleAuthorityDigest: authority.authorityDigest,
    lifecycleSnapshotDigest: authority.lifecycleSnapshotDigest,
    candidateDigest: authority.candidateDigest,
    competingCandidateDigest: authority.competingCandidateDigest,
    authorizationState: authority.authorizationState,
    authorizationInteractionReceiptDigest: authority.authorizationInteractionReceiptDigest,
    humanAuthorizationReceiptDigest: authority.humanAuthorizationReceiptDigest,
    integrationReceiptDigest: chain.integration.receiptDigest,
    runtimeReviewReceiptDigest: chain.review.receiptDigest,
    sourceDigest: chain.integration.sourceDigest,
    dependencyClosureDigest: chain.integration.dependencyClosureDigest,
    checksDigest: chain.integration.checksDigest,
    integrationTargetDigest: chain.integration.integrationTargetDigest,
    policyDigest: chain.review.policyDigest,
    targetDigest: chain.candidate.targetDigest,
    artifactDigest: chain.candidate.artifactDigest,
    manifestDigest: chain.candidate.manifestDigest,
    rollbackTargetDigest: chain.candidate.rollbackTargetDigest,
    reviewSurfaceDigest: chain.review.reviewSurfaceDigest,
    probesDigest: chain.review.probesDigest,
    reviewSurface: neutralReviewSurface,
    probes: neutralProbes,
    observedAt: neutralClock.observed,
    ...overrides,
  };
}
function neutralCarrier(chain, receipts = Object.values(chain)) {
  return { receipts };
}
function neutralAuthority(chain, carrier = neutralCarrier(chain), overrides = {}) {
  const evidence = {
    schema: PROVIDER_NEUTRAL_PRODUCTION_AUTHORIZATION_AUTHORITY_SCHEMA,
    status: "current",
    lifecycleSnapshotDigest: neutralLifecycleSnapshotDigest(carrier),
    candidateDigest: chain.candidate.receiptDigest,
    competingCandidateDigest: null,
    authorizationState: "uninitiated",
    authorizationInteractionReceiptDigest: null,
    humanAuthorizationReceiptDigest: null,
    canonicalSourceRevision: gameXrRevision,
    releaseOwnerSourceRevision: gameXrRevision,
    observedAt: neutralClock.authority,
    ...overrides,
  };
  return { ...evidence, authorityDigest: digestValue(evidence) };
}
function neutralLifecycleSnapshotDigest(carrier) {
  return digestValue({
    receipts: [...carrier.receipts].sort((left, right) => left.receiptDigest.localeCompare(right.receiptDigest, "en")),
  });
}
function neutralPromptInput(chain, overrides = {}) {
  return {
    candidateDigest: chain.candidate.receiptDigest,
    runRef: "run:gamexr-20260808",
    ...overrides,
  };
}
function authorized(candidate) {
  return {
    schema: PRODUCTION_RELEASE_AUTHORIZATION_SCHEMA,
    status: "authorized",
    environment: "production",
    reviewer: "operator@example.test",
    authorizedAt: "2026-07-29T00:00:00.000Z",
    candidateDigest: candidate.candidateDigest,
  };
}
test("localhost review and production candidate bind exact source, trees, artifact, and manifest", () => {
  const localReview = createLocalReviewCandidate(runtime, trees);
  const candidate = createProductionReleaseCandidate(localReview, readiness);
  assert.equal(candidate.source.revision, sourceRevision);
  assert.equal(candidate.agenticCanvasOs.tree, docsTree);
  assert.equal(candidate.artifact.digest, readiness.artifact.digest);
  assert.equal(candidate.immutableManifest.digest, readiness.immutableManifest.digest);
  assert.equal(
    validateProductionReleaseAuthorization(candidate, authorized(candidate), {
      localReview,
      readiness,
      originMainSha: sourceRevision,
      localMainSha: sourceRevision,
      agenticCanvasOsSha: docsRevision,
    }),
    true,
  );
});
test("shared canonical hashing preserves the existing Knowgrph digest contract", () => {
  const localReview = createLocalReviewCandidate(runtime, trees);
  const candidate = createProductionReleaseCandidate(localReview, readiness);
  const prompt = createProductionAuthorizationPrompt(runtime, localReview, candidate, {
    runRef: "run:30426035584",
  });
  assert.equal(localReview.candidateDigest, "ce697b1b3f7b6221e2d18d0c0e07df78faae28a663ad8c14d3bbb56bd0d5988d");
  assert.equal(candidate.candidateDigest, "a4eedb8d801733fa0c16520673750dd2892d22a178c75c920d421f2e031393dd");
  assert.equal(prompt.promptDigest, "d49e0948e38545aa664559aad27e28800519a40f04a7aeb45968042fe20bf670");
});
for (const [name, mutate] of [
  ["origin/main drift", current => { current.originMainSha = "2".repeat(40); }],
  ["local main drift", current => { current.localMainSha = "2".repeat(40); }],
  ["Agentic Canvas OS drift", current => { current.agenticCanvasOsSha = "2".repeat(40); }],
  ["artifact rebuild", current => { current.readiness = { ...current.readiness, artifact: { algorithm: "sha256", digest: "2".repeat(64) } }; }],
  ["manifest rebuild", current => { current.readiness = { ...current.readiness, immutableManifest: { algorithm: "sha256", digest: "2".repeat(64) } }; }],
]) {
  test(`production authorization fails closed on ${name}`, () => {
    const localReview = createLocalReviewCandidate(runtime, trees);
    const candidate = createProductionReleaseCandidate(localReview, readiness);
    const current = {
      localReview,
      readiness,
      originMainSha: sourceRevision,
      localMainSha: sourceRevision,
      agenticCanvasOsSha: docsRevision,
    };
    mutate(current);
    assert.throws(
      () => validateProductionReleaseAuthorization(candidate, authorized(candidate), current),
      /drifted/,
    );
  });
}
test("authorization cannot be reused for another candidate", () => {
  const localReview = createLocalReviewCandidate(runtime, trees);
  const candidate = createProductionReleaseCandidate(localReview, readiness);
  assert.throws(
    () => validateProductionReleaseAuthorization(candidate, {
      ...authorized(candidate),
      candidateDigest: "3".repeat(64),
    }, {
      localReview,
      readiness,
      originMainSha: sourceRevision,
      localMainSha: sourceRevision,
      agenticCanvasOsSha: docsRevision,
    }),
    /another candidate/,
  );
});
test("authorization rejects unknown fields", () => {
  const localReview = createLocalReviewCandidate(runtime, trees);
  const candidate = createProductionReleaseCandidate(localReview, readiness);
  assert.throws(
    () => validateProductionReleaseAuthorization(candidate, {
      ...authorized(candidate),
      inferredFromMerge: true,
    }, {
      localReview,
      readiness,
      originMainSha: sourceRevision,
      localMainSha: sourceRevision,
      agenticCanvasOsSha: docsRevision,
    }),
    /malformed/,
  );
});
test("runtime-ready localhost review emits the exact future human authorization template", () => {
  const localReview = createLocalReviewCandidate(runtime, trees);
  const candidate = createProductionReleaseCandidate(localReview, readiness);
  const prompt = createProductionAuthorizationPrompt(runtime, localReview, candidate, {
    runRef: "run:30426035584",
  });
  assert.equal(validateProductionAuthorizationPrompt(prompt), prompt);
  assert.equal(
    formatProductionAuthorizationPrompt(prompt),
    [
      "The release is verified and awaiting fresh human authorization.",
      "",
      `Candidate: \`${candidate.candidateDigest}\``,
      `Source: \`${sourceRevision}\``,
      "Run: `run:30426035584`",
      "localhost: `http://127.0.0.1:5173/`",
      `Local formatter source: \`${PRODUCTION_AUTHORIZATION_LOCAL_FORMATTER_PATH}\``,
      "",
      "Template: `agentic-canvas-os/scripts/production-release-authorization-contract.mjs`",
      "",
      "Reply exactly:",
      "",
      `\`authorize ${candidate.candidateDigest}\``,
    ].join("\n"),
  );
});
test("authorization prompt accepts a redacted runtime ownership token when the reviewed identity still matches", () => {
  const localReview = createLocalReviewCandidate(runtime, trees);
  const candidate = createProductionReleaseCandidate(localReview, readiness);
  const prompt = createProductionAuthorizationPrompt({
    ...runtime,
    ownershipTokenDigest: "[redacted]",
  }, localReview, candidate, {
    runRef: "run:30426035584",
  });
  assert.equal(prompt.candidateDigest, candidate.candidateDigest);
});
test("authorization prompt fails closed without current runtime readiness or a bound loopback review surface", () => {
  const localReview = createLocalReviewCandidate(runtime, trees);
  const candidate = createProductionReleaseCandidate(localReview, readiness);
  for (const drift of [
    { status: "blocked", ready: false },
    { host: "review.example.test" },
    { ports: { ...runtime.ports, apex: 0 } },
    { probes: { ...runtime.probes, apex: 503 } },
  ]) {
    assert.throws(
      () => createProductionAuthorizationPrompt(
        { ...runtime, ...drift },
        localReview,
        candidate,
        { runRef: "run:30426035584" },
      ),
      /runtime-ready|loopback|probes|drifted/,
    );
  }
});
test("authorization prompt rejects candidate, source, run-reference, and rendered-evidence drift", () => {
  const localReview = createLocalReviewCandidate(runtime, trees);
  const candidate = createProductionReleaseCandidate(localReview, readiness);
  assert.throws(
    () => createProductionAuthorizationPrompt(runtime, localReview, {
      ...candidate,
      localReviewCandidateDigest: "2".repeat(64),
    }, { runRef: "run:30426035584" }),
    /digest|drifted/,
  );
  assert.throws(
    () => createProductionAuthorizationPrompt(runtime, localReview, candidate, {
      runRef: "run with whitespace",
    }),
    /bounded run reference/,
  );
  const prompt = createProductionAuthorizationPrompt(runtime, localReview, candidate, {
    runRef: "run:30426035584",
  });
  assert.throws(
    () => validateProductionAuthorizationPrompt({
      ...prompt,
      localhostReviewUrl: "https://review.example.test/",
    }),
    /localhost|malformed/,
  );
});
test("GameXR lifecycle evidence emits one deterministic provider-neutral authorization prompt", t => {
  t.mock.method(Date, "now", () => Date.parse(neutralClock.prompted));
  const chain = buildNeutralChain();
  const prompt = createProviderNeutralProductionAuthorizationPrompt(
    neutralCarrier(chain),
    neutralAuthority(chain),
    neutralReadiness(chain),
    neutralPromptInput(chain),
  );
  assert.equal(prompt.schema, PROVIDER_NEUTRAL_PRODUCTION_AUTHORIZATION_PROMPT_SCHEMA);
  assert.equal(validateProviderNeutralProductionAuthorizationPrompt(prompt), prompt);
  assert.equal(prompt.targetDigest, chain.candidate.targetDigest);
  assert.equal(prompt.sourceRevision, gameXrRevision);
  assert.equal(formatProviderNeutralProductionAuthorizationPrompt(prompt), [
    "The release is verified and awaiting fresh human authorization.",
    "",
    `Candidate: \`${chain.candidate.receiptDigest}\``,
    `Target: \`${chain.candidate.targetDigest}\``,
    `Source: \`${gameXrRevision}\``,
    "Run: `run:gamexr-20260808`",
    "Review surface: `https://1f6b2f09.joohwee.pages.dev/gamexr/`",
    "",
    "Template: `agentic-canvas-os/scripts/production-release-authorization-contract.mjs`",
    "",
    "Reply exactly:",
    "",
    `\`authorize ${chain.candidate.receiptDigest}\``,
  ].join("\n"));
});
test("provider-neutral prompt selection is independent of receipt order", t => {
  t.mock.method(Date, "now", () => Date.parse(neutralClock.prompted));
  const chain = buildNeutralChain();
  const input = neutralPromptInput(chain);
  const forward = createProviderNeutralProductionAuthorizationPrompt(
    neutralCarrier(chain),
    neutralAuthority(chain),
    neutralReadiness(chain),
    input,
  );
  const reversed = createProviderNeutralProductionAuthorizationPrompt(
    neutralCarrier(chain, Object.values(chain).reverse()),
    neutralAuthority(chain),
    neutralReadiness(chain),
    input,
  );
  assert.deepEqual(reversed, forward);
});
test("provider-neutral prompt rejects malformed, unjoined, forged, or replayed lifecycle evidence", t => {
  t.mock.method(Date, "now", () => Date.parse(neutralClock.prompted));
  const chain = buildNeutralChain();
  const input = neutralPromptInput(chain);
  const malformed = structuredClone(neutralCarrier(chain));
  malformed.extra = true;
  const forged = structuredClone(neutralCarrier(chain));
  forged.receipts.find(receipt => receipt.schema === chain.integration.schema).sourceDigest = testDigest("f");
  const unjoined = neutralCarrier(chain, Object.values(chain).filter(receipt => receipt !== chain.review));
  const interaction = createAuthorizationInteractionReceipt(chain.candidate, {
    humanActorId: "actor:authorizer",
    interactionAdapterId: "adapter:test",
    transportClass: "interactive",
    browserRequired: false,
    challengeDigest: testDigest("e"),
    responseDigest: testDigest("f"),
    recordedAt: "2026-08-08T00:06:00.000Z",
  });
  for (const [carrier, pattern] of [
    [malformed, /carrier is malformed/],
    [forged, /forged|canonical/],
    [unjoined, /one exact runtime review/],
    [neutralCarrier(chain, [...Object.values(chain), interaction]), /interaction/],
  ]) {
    assert.throws(
      () => createProviderNeutralProductionAuthorizationPrompt(
        carrier, neutralAuthority(chain), neutralReadiness(chain), input,
      ),
      pattern,
    );
  }
});
test("provider-neutral prompt rejects readiness, locator, probe, time, and run drift", t => {
  t.mock.method(Date, "now", () => Date.parse(neutralClock.prompted));
  const chain = buildNeutralChain();
  const carrier = neutralCarrier(chain);
  const input = neutralPromptInput(chain);
  for (const [review, candidateInput, pattern] of [
    [neutralReadiness(chain, { canonicalSourceRevision: "drifted-source" }), input, /canonicalSourceRevision drifted/],
    [neutralReadiness(chain, { reviewSurface: { locator: "https://review.example.test/" } }), input, /surface drifted/],
    [neutralReadiness(chain, { reviewSurface: { locator: "http://review.example.test/" } }), input, /HTTPS|loopback/],
    [neutralReadiness(chain, { probes: { ...neutralProbes, "camera-motion": "failed" } }), input, /readiness evidence/],
    [neutralReadiness(chain, { lifecycleAuthorityDigest: "not-a-digest" }), input, /drifted/],
    [neutralReadiness(chain, { observedAt: "2026-08-07T23:59:00.000Z" }), input, /review window/],
    [neutralReadiness(chain, { observedAt: "2026-08-08T01:01:00.000Z" }), input, /review window/],
    [neutralReadiness(chain), { ...input, runRef: "run with whitespace" }, /printable reference/],
  ]) {
    assert.throws(
      () => createProviderNeutralProductionAuthorizationPrompt(
        carrier, neutralAuthority(chain), review, candidateInput,
      ),
      pattern,
    );
  }
});
test("provider-neutral readiness binds the full current Release Frontier identity", t => {
  t.mock.method(Date, "now", () => Date.parse(neutralClock.prompted));
  const chain = buildNeutralChain();
  const carrier = neutralCarrier(chain);
  const input = neutralPromptInput(chain);
  const digestFields = [
    "lifecycleAuthorityDigest", "lifecycleSnapshotDigest", "candidateDigest", "integrationReceiptDigest",
    "runtimeReviewReceiptDigest", "sourceDigest", "dependencyClosureDigest", "checksDigest",
    "integrationTargetDigest", "policyDigest", "targetDigest", "artifactDigest", "manifestDigest",
    "rollbackTargetDigest", "reviewSurfaceDigest", "probesDigest",
  ];
  const mutations = [
    ...digestFields.map(field => ({ [field]: testDigest("0") })),
    { canonicalSourceRevision: "drifted-source" },
    { releaseOwnerSourceRevision: "drifted-source" },
    { competingCandidateDigest: testDigest("0") },
    { authorizationState: "challenged" },
    { authorizationInteractionReceiptDigest: testDigest("0") },
    { humanAuthorizationReceiptDigest: testDigest("0") },
  ];
  for (const mutation of mutations) {
    assert.throws(
      () => createProviderNeutralProductionAuthorizationPrompt(
        carrier,
        neutralAuthority(chain),
        neutralReadiness(chain, mutation),
        input,
      ),
      /drifted/,
    );
  }
});
test("provider-neutral readiness must match the controller-current authority receipt", t => {
  t.mock.method(Date, "now", () => Date.parse(neutralClock.prompted));
  const chain = buildNeutralChain();
  const carrier = neutralCarrier(chain);
  const input = neutralPromptInput(chain);
  const current = neutralAuthority(chain);
  const cases = [
    [{ ...current, authorityDigest: testDigest("f") }, /authority digest/],
    [neutralAuthority(chain, carrier, { canonicalSourceRevision: "drifted-source" }), /authority canonicalSourceRevision drifted/],
    [neutralAuthority(chain, carrier, { lifecycleSnapshotDigest: testDigest("0") }), /authority lifecycleSnapshotDigest drifted/],
    [neutralAuthority(chain, carrier, { competingCandidateDigest: testDigest("0") }), /authority competingCandidateDigest drifted/],
    [neutralAuthority(chain, carrier, { authorizationState: "challenged" }), /authority authorizationState drifted/],
  ];
  for (const [authority, pattern] of cases) {
    assert.throws(
      () => createProviderNeutralProductionAuthorizationPrompt(
        carrier, authority, neutralReadiness(chain, {}, authority), input,
      ),
      pattern,
    );
  }
});
test("provider-neutral prompt uses the controller clock and rejects an expired review", t => {
  t.mock.method(Date, "now", () => Date.parse("2026-08-08T01:01:00.000Z"));
  const chain = buildNeutralChain();
  assert.throws(
    () => createProviderNeutralProductionAuthorizationPrompt(
      neutralCarrier(chain),
      neutralAuthority(chain),
      neutralReadiness(chain),
      neutralPromptInput(chain),
    ),
    /review window/,
  );
});
test("provider-neutral rendered references reject terminal control bytes", t => {
  t.mock.method(Date, "now", () => Date.parse(neutralClock.prompted));
  const chain = buildNeutralChain();
  assert.throws(
    () => createProviderNeutralProductionAuthorizationPrompt(
      neutralCarrier(chain),
      neutralAuthority(chain),
      neutralReadiness(chain),
      neutralPromptInput(chain, { runRef: "run:\u001b[2J" }),
    ),
    /printable reference/,
  );
});
test("provider-neutral prompt validation rejects every rendered identity mutation", t => {
  t.mock.method(Date, "now", () => Date.parse(neutralClock.prompted));
  const chain = buildNeutralChain();
  const prompt = createProviderNeutralProductionAuthorizationPrompt(
    neutralCarrier(chain),
    neutralAuthority(chain),
    neutralReadiness(chain),
    neutralPromptInput(chain),
  );
  for (const mutation of [
    { candidateDigest: testDigest("f") },
    { targetDigest: testDigest("f") },
    { sourceRevision: "other-source" },
    { reviewSurfaceLocator: "https://review.example.test/" },
    { readinessDigest: testDigest("f") },
    { promptedAt: "2026-08-08T01:01:00.000Z" },
    { authorizationReply: `authorize ${testDigest("f")}` },
    { promptDigest: testDigest("f") },
    { extra: true },
  ]) {
    assert.throws(
      () => validateProviderNeutralProductionAuthorizationPrompt({ ...prompt, ...mutation }),
      /malformed|digest/,
    );
  }
});
