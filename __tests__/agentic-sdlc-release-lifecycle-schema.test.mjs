import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  consumeHumanAuthorizationReceipt, createAuthorizationInteractionReceipt,
  createCandidateManifest, createDeploymentReceipt,
  createHumanAuthorizationReceipt, createIntegrationReceipt,
  createLiveVerificationReceipt, createLiveVerificationReceiptV2,
  createOverlapDispositionReceipt, createOverlapPreservationReceipt,
  createPublicationReceipt, createPublicationReceiptV2,
  createRollbackReceipt, createRuntimeReviewReceipt,
  createStateReconciliationReceipt, AUTHORIZATION_INTERACTION_RECEIPT_SCHEMA,
  CANDIDATE_MANIFEST_SCHEMA, DEPLOYMENT_RECEIPT_SCHEMA,
  HUMAN_AUTHORIZATION_RECEIPT_SCHEMA, INTEGRATION_RECEIPT_SCHEMA,
  LIVE_VERIFICATION_RECEIPT_SCHEMA, LIVE_VERIFICATION_RECEIPT_V2_SCHEMA,
  OVERLAP_DISPOSITION_RECEIPT_SCHEMA, OVERLAP_PRESERVATION_RECEIPT_SCHEMA,
  PUBLICATION_RECEIPT_SCHEMA, PUBLICATION_RECEIPT_V2_SCHEMA,
  ROLLBACK_RECEIPT_SCHEMA, RUNTIME_REVIEW_RECEIPT_SCHEMA,
  STATE_RECONCILIATION_RECEIPT_SCHEMA,
} from "../scripts/collaborative-release-lifecycle-contract.mjs";
import {
  assertCanonicalRunSchema, COLLABORATIVE_RELEASE_LIFECYCLE_JSON_SCHEMA,
  COLLABORATIVE_RELEASE_LIFECYCLE_V1_JSON_SCHEMA,
  COLLABORATIVE_RELEASE_LIFECYCLE_V2_JSON_SCHEMA, normalizeCanonicalRun,
} from "../scripts/agentic-sdlc/index.mjs";
import { canonicalRun } from "./fixtures/agentic-sdlc-canonical-run.mjs";

const runSchema = JSON.parse(readFileSync(new URL(
  "../docs/schemas/agentic-sdlc-run.v1.schema.json", import.meta.url), "utf8"));
const runtimeDoc = readFileSync(
  new URL("../docs/AGENTIC-SDLC-RUNTIME.md", import.meta.url),
  "utf8",
);
const digest = (character) => character.repeat(64);
const expectedOrder = [
  [OVERLAP_PRESERVATION_RECEIPT_SCHEMA, "preserved"],
  [OVERLAP_DISPOSITION_RECEIPT_SCHEMA, "accounted"],
  [INTEGRATION_RECEIPT_SCHEMA, "integrated"],
  [RUNTIME_REVIEW_RECEIPT_SCHEMA, "reviewed"],
  [CANDIDATE_MANIFEST_SCHEMA, "awaiting-human-authorization"],
  [AUTHORIZATION_INTERACTION_RECEIPT_SCHEMA, "observed"],
  [HUMAN_AUTHORIZATION_RECEIPT_SCHEMA, "authorized"],
  [HUMAN_AUTHORIZATION_RECEIPT_SCHEMA, "consumed"],
  [LIVE_VERIFICATION_RECEIPT_SCHEMA, "verified"],
  [PUBLICATION_RECEIPT_SCHEMA, "published"],
];
const expectedProductionOrder = [
  ...expectedOrder.slice(0, 8),
  [DEPLOYMENT_RECEIPT_SCHEMA, "deployed"],
  [STATE_RECONCILIATION_RECEIPT_SCHEMA, "reconciled"],
  [LIVE_VERIFICATION_RECEIPT_V2_SCHEMA, "verified"],
  [PUBLICATION_RECEIPT_V2_SCHEMA, "published"],
];
const expectedReceiptFields = {
  overlapPreservationReceipt: [
    "schema", "status", "convergenceBaseDigest", "protectedTipDigest",
    "captureAdapterId", "entries", "capturedAt", "receiptDigest",
  ],
  overlapDispositionReceipt: [
    "schema", "status", "preservationReceiptDigest",
    "convergenceBaseDigest", "protectedTipDigest", "observations",
    "observedAt", "receiptDigest",
  ],
  integrationReceipt: [
    "schema", "status", "preservationReceiptDigest",
    "overlapDispositionReceiptDigest", "sourceRevision", "sourceDigest",
    "dependencyClosureDigest", "checksDigest", "evaluatorId",
    "collaboration", "integrationTargetDigest", "integratedAt",
    "receiptDigest",
  ],
  runtimeReviewReceipt: [
    "schema", "status", "integrationReceiptDigest", "sourceDigest",
    "dependencyClosureDigest", "reviewSurfaceDigest", "policyDigest",
    "probesDigest", "reviewerId", "issuedAt", "expiresAt",
    "receiptDigest",
  ],
  candidateManifest: [
    "schema", "status", "runtimeReviewReceiptDigest", "sourceDigest",
    "dependencyClosureDigest", "policyDigest", "targetDigest",
    "artifactDigest", "manifestDigest", "rollbackTargetDigest", "builtAt",
    "receiptDigest",
  ],
  authorizationInteractionReceipt: [
    "schema", "status", "candidateDigest", "targetDigest", "humanActorId",
    "interactionAdapterId", "transportClass", "browserRequired",
    "challengeDigest", "responseDigest", "recordedAt", "receiptDigest",
  ],
  issuedHumanAuthorizationReceipt: [
    "schema", "status", "candidateDigest", "targetDigest", "releaseKey",
    "decisionKind", "humanActorId", "decisionRef", "authorityAdapterId",
    "interactionReceiptDigest", "issuedAt", "expiresAt", "consumedAt",
    "receiptDigest",
  ],
  consumedHumanAuthorizationReceipt: [
    "schema", "status", "candidateDigest", "targetDigest", "releaseKey",
    "decisionKind", "humanActorId", "decisionRef", "authorityAdapterId",
    "interactionReceiptDigest", "issuedAt", "expiresAt", "consumedAt",
    "controllerId", "authorizationReceiptDigest", "receiptDigest",
  ],
  liveVerificationReceipt: [
    "schema", "status", "authorizationReceiptDigest", "candidateDigest",
    "targetDigest", "controllerId", "deployedArtifactDigest",
    "observedRuntimeDigest", "probesDigest", "rollbackTargetDigest",
    "verifiedAt", "receiptDigest",
  ],
  publicationReceipt: [
    "schema", "status", "liveVerificationReceiptDigest",
    "candidateDigest", "targetDigest", "publicationIdentitiesDigest",
    "publishedAt", "receiptDigest",
  ],
};
function completeLifecycle({ targetCharacter = "b", reviewExpiresAt = "2026-07-29T01:03:00.000Z" } = {}) {
  const collaboration = {
    actorId: "actor:release",
    deviceId: "device:one",
    sessionId: "session:one",
    worktreeId: "worktree:one",
    branchId: "branch:one",
    scopeId: "scope:one",
    leaseEpoch: 1,
    fenceRevision: "fence:one",
  };
  const preservation = createOverlapPreservationReceipt({
    convergenceBaseDigest: digest("0"),
    protectedTipDigest: digest("1"),
    captureAdapterId: "adapter:capture",
    entries: [{
      collaboration,
      writeSetDigest: digest("2"),
      stateDigest: digest("3"),
      recoveryHandle: "recovery:one",
      preservationMode: "active-lane",
      overlapClass: "overlapping",
    }],
    capturedAt: "2026-07-29T00:00:00.000Z",
  });
  const disposition = createOverlapDispositionReceipt(preservation, {
    preservationReceiptDigest: preservation.receiptDigest,
    convergenceBaseDigest: preservation.convergenceBaseDigest,
    protectedTipDigest: preservation.protectedTipDigest,
    observations: [{
      collaboration,
      stateDigest: digest("3"),
      recoveryHandle: "recovery:one",
      disposition: "retained",
    }],
    observedAt: "2026-07-29T00:01:00.000Z",
  });
  const integration = createIntegrationReceipt(preservation, disposition, {
    sourceRevision: "source:one",
    sourceDigest: digest("4"),
    dependencyClosureDigest: digest("5"),
    checksDigest: digest("6"),
    evaluatorId: "evaluator:one",
    collaboration,
    integrationTargetDigest: digest("7"),
    integratedAt: "2026-07-29T00:02:00.000Z",
  });
  const review = createRuntimeReviewReceipt(integration, {
    reviewSurfaceDigest: digest("8"),
    policyDigest: digest("9"),
    probesDigest: digest("a"),
    reviewerId: "reviewer:one",
    issuedAt: "2026-07-29T00:03:00.000Z",
    expiresAt: reviewExpiresAt,
  });
  const candidate = createCandidateManifest(review, {
    targetDigest: digest(targetCharacter),
    artifactDigest: digest("c"),
    manifestDigest: digest("d"),
    rollbackTargetDigest: digest("e"),
    builtAt: "2026-07-29T00:04:00.000Z",
  });
  const interaction = createAuthorizationInteractionReceipt(candidate, {
    humanActorId: "human:one",
    interactionAdapterId: "interaction:one",
    transportClass: "interactive-reference-transport",
    browserRequired: false,
    challengeDigest: digest("f"),
    responseDigest: digest("0"),
    recordedAt: "2026-07-29T00:05:00.000Z",
  });
  const authorization = createHumanAuthorizationReceipt(
    candidate,
    interaction,
    {
      decisionKind: "human",
      humanActorId: "human:one",
      decisionRef: "decision:one",
      authorityAdapterId: "authority:one",
      issuedAt: "2026-07-29T00:06:00.000Z",
      expiresAt: "2026-07-29T00:36:00.000Z",
    },
  );
  const consumed = consumeHumanAuthorizationReceipt(authorization, {
    consumedAt: "2026-07-29T00:07:00.000Z",
    controllerId: "controller:one",
  });
  const live = createLiveVerificationReceipt(consumed, {
    deployedArtifactDigest: candidate.artifactDigest,
    observedRuntimeDigest: digest("1"),
    probesDigest: digest("0"),
    rollbackTargetDigest: candidate.rollbackTargetDigest,
    verifiedAt: "2026-07-29T00:08:00.000Z",
  });
  const publication = createPublicationReceipt(live, {
    publicationIdentitiesDigest: digest("1"),
    publishedAt: "2026-07-29T00:09:00.000Z",
  });
  return {
    receipts: [
      preservation,
      disposition,
      integration,
      review,
      candidate,
      interaction,
      authorization,
      consumed,
      live,
      publication,
    ],
  };
}

function productionLifecycle({ rollback = false, failedStage = "deployment",
  rolledBackAt = "2026-07-29T00:11:00.000Z", reviewExpiresAt,
  targetCharacter = "b" } = {}) {
  const earlyReceipts = completeLifecycle({ reviewExpiresAt, targetCharacter })
    .receipts.slice(0, 8);
  const candidate = earlyReceipts.find((receipt) =>
    receipt.schema === CANDIDATE_MANIFEST_SCHEMA);
  const consumed = earlyReceipts.find((receipt) =>
    receipt.schema === HUMAN_AUTHORIZATION_RECEIPT_SCHEMA
    && receipt.status === "consumed");
  const deployment = createDeploymentReceipt(candidate, consumed, {
    deploymentAdapterId: "deployment:one",
    deployedArtifactDigest: candidate.artifactDigest,
    immutableDeploymentId: `deployment:${targetCharacter}`,
    immutableDeploymentOrigin: `https://${targetCharacter}.example.test`,
    rollbackTargetDigest: candidate.rollbackTargetDigest,
    deployedAt: "2026-07-29T00:08:00.000Z",
  });
  const state = createStateReconciliationReceipt(deployment, {
    stateContractDigest: digest("2"),
    operationsDigest: digest("3"),
    operationCount: 2,
    operationLimit: 10,
    readbackAdapterId: "readback:one",
    readbackKind: "direct-authoritative",
    readbackDigest: digest("4"),
    expectedCounts: { documentCount: 2, chunkCount: 3, graphCount: 1 },
    observedCounts: { documentCount: 2, chunkCount: 3, graphCount: 1 },
    pathHashParity: true,
    contentParity: true,
    reconciledAt: "2026-07-29T00:09:00.000Z",
  });
  const live = createLiveVerificationReceiptV2(deployment, state, {
    observedRuntimeDigest: digest("5"),
    immutableOriginProbesDigest: digest("6"),
    publicRouteProbesDigest: digest("7"),
    browserFidelityDigest: digest("8"),
    clientCacheConvergenceDigest: digest("9"),
    markerParityDigest: digest("a"),
    markerBytesParity: true,
    verifiedAt: "2026-07-29T00:10:00.000Z",
  });
  if (rollback) {
    const rollbackReceipt = createRollbackReceipt(deployment, {
      failedStage,
      failureDigest: digest("2"),
      lastKnownGoodIdentityDigest: candidate.rollbackTargetDigest,
      restoredDeploymentIdentityDigest: candidate.rollbackTargetDigest,
      stateDisposition: "retained-compatible",
      stateDispositionDigest: digest("3"),
      restoredProbesDigest: digest("4"),
      mirrorDisposition: "unchanged-last-known-good",
      lastKnownGoodMirrorIdentityDigest: digest("5"),
      observedMirrorIdentityDigest: digest("5"),
      terminalResult: "restored-last-known-good",
      rolledBackAt,
    });
    const prefix = failedStage === "live-verification" ? [state]
      : ["publication", "receipt-persistence"].includes(failedStage) ? [state, live] : [];
    return {
      schema: "agentic-collaborative-release-lifecycle/v2",
      completion: "rolled-back",
      receipts: [...earlyReceipts, deployment, ...prefix, rollbackReceipt],
    };
  }
  const publication = createPublicationReceiptV2(live, {
    publicationIdentitiesDigest: digest("b"),
    publishedAt: "2026-07-29T00:11:00.000Z",
  });
  return {
    schema: "agentic-collaborative-release-lifecycle/v2",
    completion: "production-complete",
    receipts: [...earlyReceipts, deployment, state, live, publication],
  };
}

function runWithLifecycle(lifecycle = completeLifecycle()) {
  return { ...canonicalRun(), releaseLifecycle: structuredClone(lifecycle) };
}

function discriminator(receipt) {
  return [receipt.schema, receipt.status];
}

test("a constructor-produced complete receipt chain is admitted and preserved", () => {
  const lifecycle = completeLifecycle();
  const run = runWithLifecycle({
    receipts: [...lifecycle.receipts].reverse(),
  });
  const before = structuredClone(run);

  assert.equal(assertCanonicalRunSchema(run), run);
  const normalized = normalizeCanonicalRun(run);
  assert.deepEqual(
    normalized.releaseLifecycle.receipts.map(discriminator),
    expectedOrder,
  );
  assert.deepEqual(normalized.releaseLifecycle.receipts, lifecycle.receipts);
  assert.deepEqual(run, before);
  assert.notStrictEqual(
    normalized.releaseLifecycle.receipts[0],
    run.releaseLifecycle.receipts.at(-1),
  );
});

test("the v2 carrier admits and preserves a joined production receipt chain", () => {
  const lifecycle = productionLifecycle();
  const run = runWithLifecycle({
    ...lifecycle,
    receipts: [...lifecycle.receipts].reverse(),
  });

  assert.equal(assertCanonicalRunSchema(run), run);
  const normalized = normalizeCanonicalRun(run).releaseLifecycle;
  assert.equal(normalized.schema, lifecycle.schema);
  assert.equal(normalized.completion, "production-complete");
  assert.deepEqual(normalized.receipts.map(discriminator), expectedProductionOrder);
  assert.deepEqual(normalized.receipts, lifecycle.receipts);
});

test("the v2 carrier admits a terminal rollback branch", () => {
  const lifecycle = productionLifecycle({ rollback: true });
  const run = runWithLifecycle({
    ...lifecycle,
    receipts: [...lifecycle.receipts].reverse(),
  });

  assert.equal(assertCanonicalRunSchema(run), run);
  const normalized = normalizeCanonicalRun(run).releaseLifecycle;
  assert.equal(normalized.completion, "rolled-back");
  assert.deepEqual(normalized.receipts.map(discriminator), [
    ...expectedOrder.slice(0, 8),
    [DEPLOYMENT_RECEIPT_SCHEMA, "deployed"],
    [ROLLBACK_RECEIPT_SCHEMA, "rolled-back"],
  ]);
});

test("omitted, empty, and partial in-progress lifecycles remain observable", () => {
  const withoutLifecycle = normalizeCanonicalRun(canonicalRun());
  assert.equal(Object.hasOwn(withoutLifecycle, "releaseLifecycle"), false);

  const empty = runWithLifecycle({ receipts: [] });
  assert.equal(assertCanonicalRunSchema(empty), empty);
  assert.deepEqual(normalizeCanonicalRun(empty).releaseLifecycle, {
    receipts: [],
  });

  const candidate = completeLifecycle().receipts.find((receipt) =>
    receipt.schema === CANDIDATE_MANIFEST_SCHEMA);
  const partial = runWithLifecycle({ receipts: [candidate] });
  assert.equal(assertCanonicalRunSchema(partial), partial);
  assert.deepEqual(
    normalizeCanonicalRun(partial).releaseLifecycle.receipts
      .map(discriminator),
    [[CANDIDATE_MANIFEST_SCHEMA, "awaiting-human-authorization"]],
  );
});

test("release lifecycle normalization is deterministic across carrier and key order", () => {
  const lifecycle = completeLifecycle();
  const left = runWithLifecycle({
    receipts: [
      ...lifecycle.receipts.slice(3),
      ...lifecycle.receipts.slice(0, 3),
    ],
  });
  const right = runWithLifecycle({
    receipts: lifecycle.receipts.map((receipt) =>
      Object.fromEntries(Object.entries(receipt).reverse())),
  });

  assert.deepEqual(
    normalizeCanonicalRun(left).releaseLifecycle,
    normalizeCanonicalRun(right).releaseLifecycle,
  );
  for (const receipt of normalizeCanonicalRun(left).releaseLifecycle.receipts) {
    assert.deepEqual(
      Object.keys(receipt),
      [...Object.keys(receipt)].sort(),
    );
  }
});

test("the external schema rejects identical duplicates, malformed receipts, and widening", () => {
  const cases = [
    ["unknown carrier field", (run) => { run.releaseLifecycle.extra = true; }],
    ["identical duplicate", (run) => {
      const candidate = run.releaseLifecycle.receipts.find((receipt) =>
        receipt.schema === CANDIDATE_MANIFEST_SCHEMA);
      run.releaseLifecycle.receipts = [candidate, structuredClone(candidate)];
    }],
    ["unknown receipt field", (run) => {
      run.releaseLifecycle.receipts[0].extra = true;
    }],
    ["invalid digest", (run) => {
      run.releaseLifecycle.receipts[0].receiptDigest = "A".repeat(64);
    }],
    ["invalid instant", (run) => {
      run.releaseLifecycle.receipts[0].capturedAt = "not-an-instant";
    }],
    ["non-boolean interaction capability", (run) => {
      const interaction = run.releaseLifecycle.receipts.find((receipt) =>
        receipt.schema === AUTHORIZATION_INTERACTION_RECEIPT_SCHEMA);
      interaction.browserRequired = "false";
    }],
    ["unsafe lease epoch", (run) => {
      run.releaseLifecycle.receipts[0].entries[0].collaboration.leaseEpoch =
        Number.MAX_SAFE_INTEGER + 1;
    }],
    ["machine authorization", (run) => {
      const issued = run.releaseLifecycle.receipts.find((receipt) =>
        receipt.schema === HUMAN_AUTHORIZATION_RECEIPT_SCHEMA
        && receipt.status === "authorized");
      issued.decisionKind = "machine";
    }],
  ];

  for (const [label, mutate] of cases) {
    const run = runWithLifecycle();
    mutate(run);
    assert.throws(
      () => assertCanonicalRunSchema(run),
      /agentic-sdlc-run\/v1 schema validation failed/u,
      label,
    );
  }
});

test("v1 observations and v2 terminal authority cannot substitute for each other", () => {
  const legacyAsProduction = runWithLifecycle({
    schema: "agentic-collaborative-release-lifecycle/v2",
    completion: "production-complete",
    receipts: completeLifecycle().receipts,
  });
  const productionAsLegacy = runWithLifecycle({
    receipts: productionLifecycle().receipts,
  });
  assert.throws(() => assertCanonicalRunSchema(legacyAsProduction));
  assert.throws(() => assertCanonicalRunSchema(productionAsLegacy));
});

test("v2 completion states reject incomplete or contradictory terminal evidence", () => {
  const missingPublication = runWithLifecycle(productionLifecycle());
  missingPublication.releaseLifecycle.receipts.pop();
  const publicationAsRollback = runWithLifecycle(productionLifecycle());
  publicationAsRollback.releaseLifecycle.completion = "rolled-back";
  const rollbackAsProduction = runWithLifecycle(
    productionLifecycle({ rollback: true }),
  );
  rollbackAsProduction.releaseLifecycle.completion = "production-complete";

  for (const run of [missingPublication, publicationAsRollback, rollbackAsProduction]) {
    assert.throws(
      () => assertCanonicalRunSchema(run),
      /agentic-sdlc-run\/v1 schema validation failed/u,
    );
  }
});

test("v2 semantic validation rejects foreign, tampered, or missing predecessors", () => {
  const lifecycle = productionLifecycle();
  const other = productionLifecycle({ targetCharacter: "c" });
  const foreignState = other.receipts.find((receipt) =>
    receipt.schema === STATE_RECONCILIATION_RECEIPT_SCHEMA);
  lifecycle.receipts = lifecycle.receipts.map((receipt) => receipt.schema
    === STATE_RECONCILIATION_RECEIPT_SCHEMA ? foreignState : receipt);
  const tampered = runWithLifecycle(productionLifecycle());
  tampered.releaseLifecycle.receipts.find((receipt) =>
    receipt.schema === INTEGRATION_RECEIPT_SCHEMA).receiptDigest = digest("f");
  const truncated = runWithLifecycle(productionLifecycle());
  truncated.releaseLifecycle.receipts = truncated.releaseLifecycle.receipts
    .filter((_receipt, index) => index === 4 || index >= 7);
  const expired = runWithLifecycle(productionLifecycle({ reviewExpiresAt: "2026-07-29T00:04:30.000Z" }));
  const impossible = runWithLifecycle(productionLifecycle({
    rollback: true, failedStage: "publication", rolledBackAt: "2026-07-29T00:08:30.000Z",
  }));
  const missingPrefix = structuredClone(impossible);
  missingPrefix.releaseLifecycle.receipts = missingPrefix.releaseLifecycle.receipts.filter((receipt) => receipt.schema !== LIVE_VERIFICATION_RECEIPT_V2_SCHEMA);

  for (const [run, pattern] of [
    [runWithLifecycle(lifecycle), /State reconciliation is unjoined/u],
    [tampered, /digest does not match/u],
    [truncated, /schema validation failed/u],
    [expired, /Authorization interaction is outside/u],
    [impossible, /Rollback predates/u],
    [missingPrefix, /schema validation failed/u],
  ]) assert.throws(() => assertCanonicalRunSchema(run), pattern);
});

test("schema registration mirrors the existing receipt discriminators without authority", () => {
  const schema = COLLABORATIVE_RELEASE_LIFECYCLE_JSON_SCHEMA;
  assert.equal(schema, COLLABORATIVE_RELEASE_LIFECYCLE_V1_JSON_SCHEMA);
  assert.equal(
    schema.$id,
    "https://agentic-canvas-os.dev/schemas/collaborative-release-lifecycle/v1",
  );
  assert.deepEqual(
    runSchema.properties.releaseLifecycle.oneOf.map((entry) => entry.$ref),
    [schema.$id, COLLABORATIVE_RELEASE_LIFECYCLE_V2_JSON_SCHEMA.$id],
  );
  assert.equal(runSchema.required.includes("releaseLifecycle"), false);
  assert.deepEqual(schema.required, ["receipts"]);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.receipts.minItems, 0);
  assert.equal(schema.properties.receipts.maxItems, 200);
  assert.equal(schema.properties.receipts.uniqueItems, true);
  assert.equal(Object.hasOwn(schema.properties.receipts, "allOf"), false);

  const definitionNames = Object.keys(expectedReceiptFields);
  const definitions = definitionNames.map((name) => schema.$defs[name]);
  assert.deepEqual(
    definitions.map((definition) => [
      definition.properties.schema.const,
      definition.properties.status.const,
    ]),
    expectedOrder,
  );
  assert.ok(definitions.every((definition) =>
    definition.additionalProperties === false
    && definition.required.includes("receiptDigest")));
  for (const [name, fields] of Object.entries(expectedReceiptFields)) {
    assert.deepEqual(
      [...schema.$defs[name].required].sort(),
      [...fields].sort(),
      `${name} must mirror the existing exact receipt fields`,
    );
  }
  assert.deepEqual(schema.$defs.collaboration.required, [
    "actorId",
    "deviceId",
    "sessionId",
    "worktreeId",
    "branchId",
    "scopeId",
    "leaseEpoch",
    "fenceRevision",
  ]);
  assert.deepEqual(schema.$defs.preservationEntry.required, [
    "collaboration",
    "writeSetDigest",
    "stateDigest",
    "recoveryHandle",
    "preservationMode",
    "overlapClass",
  ]);
  assert.deepEqual(schema.$defs.dispositionObservation.required, [
    "collaboration",
    "stateDigest",
    "recoveryHandle",
    "disposition",
  ]);
  assert.equal(
    schema.$defs.issuedHumanAuthorizationReceipt
      .properties.decisionKind.const,
    "human",
  );
  assert.deepEqual(
    schema.$defs.issuedHumanAuthorizationReceipt.properties.consumedAt,
    { type: "null" },
  );
  assert.match(schema.description, /grants no release or deployment authority/u);
  assert.match(runtimeDoc, /existing collaborative release-lifecycle constructors and controller remain the owners/u);
});
test("the v2 schema declares a closed authoritative completion carrier", () => {
  const schema = COLLABORATIVE_RELEASE_LIFECYCLE_V2_JSON_SCHEMA;
  assert.equal(schema.$id, "https://agentic-canvas-os.dev/schemas/collaborative-release-lifecycle/v2");
  assert.deepEqual(schema.required, ["schema", "completion", "receipts"]);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.$defs.fullPreDeploymentChain.allOf.length, 8);
  assert.deepEqual(schema.properties.completion.enum,
    ["in-progress", "production-complete", "rolled-back"]);
  assert.match(schema.description, /strict Deployment/u);
});
