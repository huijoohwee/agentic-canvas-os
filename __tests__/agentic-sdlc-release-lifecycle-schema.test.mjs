import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  AUTHORIZATION_INTERACTION_RECEIPT_SCHEMA,
  CANDIDATE_MANIFEST_SCHEMA,
  HUMAN_AUTHORIZATION_RECEIPT_SCHEMA,
  INTEGRATION_RECEIPT_SCHEMA,
  LIVE_VERIFICATION_RECEIPT_SCHEMA,
  OVERLAP_DISPOSITION_RECEIPT_SCHEMA,
  OVERLAP_PRESERVATION_RECEIPT_SCHEMA,
  PUBLICATION_RECEIPT_SCHEMA,
  RUNTIME_REVIEW_RECEIPT_SCHEMA,
} from "../scripts/collaborative-release-lifecycle-contract.mjs";
import {
  assertCanonicalRunSchema,
  COLLABORATIVE_RELEASE_LIFECYCLE_JSON_SCHEMA,
  normalizeCanonicalRun,
} from "../scripts/agentic-sdlc/index.mjs";
import { canonicalRun } from "./fixtures/agentic-sdlc-canonical-run.mjs";

const runSchema = JSON.parse(readFileSync(
  new URL("../docs/schemas/agentic-sdlc-run.v1.schema.json", import.meta.url),
  "utf8",
));
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

function completeLifecycle() {
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
    expiresAt: "2026-07-29T01:03:00.000Z",
  });
  const candidate = createCandidateManifest(review, {
    targetDigest: digest("b"),
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

test("schema registration mirrors the existing receipt discriminators without authority", () => {
  const schema = COLLABORATIVE_RELEASE_LIFECYCLE_JSON_SCHEMA;
  assert.equal(
    schema.$id,
    "https://agentic-canvas-os.dev/schemas/collaborative-release-lifecycle/v1",
  );
  assert.equal(runSchema.properties.releaseLifecycle.$ref, schema.$id);
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
