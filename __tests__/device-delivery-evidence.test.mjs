import assert from "node:assert/strict";
import test from "node:test";

import {
  compactDeviceCloudMutationIdempotencyKey,
  createDeviceDeliveryEvidence,
  DEVICE_DELIVERY_EVIDENCE_SCHEMA,
} from "../scripts/device-delivery-evidence.mjs";
import {
  CLOUD_COLLABORATION_BOUNDS,
  digestValue,
  normalizeWriteSet,
} from "../scripts/cloud-collaboration-primitives.mjs";
import { authorizeDeliveryAdmissionCloudAuthority } from "../scripts/scoped-lane-cloud-authority.mjs";

const BASE_SHA = "1".repeat(40);
const HEAD_SHA = "2".repeat(40);
const TREE_SHA = "3".repeat(40);
const LEDGER_SHA = "4".repeat(40);
const BRANCH = "agent/device-a/delivery-evidence";
const DEVICE_ID = "device-a";
const SESSION_ID = "session-a";
const SEMANTIC_SCOPE = "delivery-evidence";
const DECLARED_WRITE_SET = normalizeWriteSet([
  `semantic:${SEMANTIC_SCOPE}`,
  "path:scripts/device-delivery-evidence.mjs",
  "path:__tests__/device-delivery-evidence.test.mjs",
]);
const SOURCE_MANIFEST = Object.freeze({
  schema: "agentic-declared-write-scope/v1",
  semanticScope: SEMANTIC_SCOPE,
  paths: DECLARED_WRITE_SET
    .filter(item => item.startsWith("path:"))
    .map(item => item.slice("path:".length)),
});
const MANIFEST = Object.freeze({
  schema: "agentic-lane-admission-lease/v1",
  status: "admitted",
  semanticScope: SEMANTIC_SCOPE,
  declaredWriteSet: DECLARED_WRITE_SET,
  writeSetDigest: digestValue(DECLARED_WRITE_SET),
  manifestDigest: digestValue(SOURCE_MANIFEST),
  planReceiptDigest: "5".repeat(64),
  admissionReceiptDigest: "6".repeat(64),
  admittedReportDigest: "7".repeat(64),
  preservationReceiptDigest: "8".repeat(64),
  existingLaneStateDigest: "9".repeat(64),
});
const AUTHORITY = Object.freeze({
  schema: "agentic-lane-cloud-authority/v1",
  provider: "github",
  ledgerRepository: "owner/ledger",
  targetRepository: "owner/target",
  claimId: "a".repeat(64),
  claimDigest: "b".repeat(64),
  ledgerRevision: LEDGER_SHA,
  claimLedgerRevision: "c".repeat(64),
  canonicalBaseSha: BASE_SHA,
  laneRevision: HEAD_SHA,
  cloudDeclaredWriteScope: DECLARED_WRITE_SET,
  writeSetDigest: MANIFEST.writeSetDigest,
  deviceId: DEVICE_ID,
  sessionId: SESSION_ID,
  reviewRequestId: "github-pull-request:PR_42",
  leaseEpoch: 3,
  transitionCounter: 5,
  state: "review_ready",
  focusedEvidenceDigest: "d".repeat(64),
  manifestDigest: MANIFEST.manifestDigest,
});

const DIGEST_FIELDS = Object.freeze([
  "dependencyClosureDigest",
  "namedChecksDigest",
  "handoffEvidenceDigest",
  "operatorDecisionDigest",
  "integrationIntentDigest",
]);

function input(overrides = {}) {
  return {
    operation: "integrate",
    branch: BRANCH,
    headSha: HEAD_SHA,
    headTreeSha: TREE_SHA,
    pullRequestNumber: 42,
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    manifest: structuredClone(MANIFEST),
    authority: structuredClone(AUTHORITY),
    ...overrides,
  };
}
function verificationResult({
  claim,
  claims,
  ledgerRevision,
  ledgerDigest,
  evaluationTime,
  contractReceiptDigest,
} = {}) {
  const currentClaimInventoryCore = {
    schema: "agentic-cloud-collaboration-current-claim-inventory/v1",
    ledgerRevision,
    ledgerDigest,
    evaluationTime,
    claims,
  };
  const currentClaimInventory = {
    ...currentClaimInventoryCore,
    claimInventoryDigest: digestValue(currentClaimInventoryCore),
  };
  const receiptCore = {
    schema: "agentic-cloud-collaboration-github-verification/v1",
    ok: true,
    ledgerRevision,
    ledgerDigest,
    claimId: claim.claimId,
    claimDigest: claim.fenceRevision,
    contractReceiptDigest,
    claimInventoryDigest: currentClaimInventory.claimInventoryDigest,
    evaluationTime,
    findings: [],
  };
  return {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "verify",
    status: "ready",
    ledgerRevision,
    claimDigest: claim.fenceRevision,
    claim,
    currentClaimInventory,
    findings: [],
    receipt: { ...receiptCore, receiptDigest: digestValue(receiptCore) },
  };
}

function changedDigests(left, right) {
  return DIGEST_FIELDS.filter(field => left[field] !== right[field]);
}

test("derives a deterministic immutable five-digest evidence bundle from the reviewed operation", () => {
  const first = createDeviceDeliveryEvidence(input());
  const second = createDeviceDeliveryEvidence(input());

  assert.deepEqual(first, second);
  assert.equal(first.schema, DEVICE_DELIVERY_EVIDENCE_SCHEMA);
  assert.equal(first.operation, "integrate");
  assert.deepEqual(Object.keys(first.preimages), [
    "dependencyClosure",
    "namedChecks",
    "handoffEvidence",
    "operatorDecision",
    "integrationIntent",
  ]);
  for (const field of DIGEST_FIELDS) assert.match(first[field], /^[0-9a-f]{64}$/u);
  assert.equal(
    first.dependencyClosureDigest,
    digestValue(first.preimages.dependencyClosure),
  );
  assert.equal(first.namedChecksDigest, digestValue(first.preimages.namedChecks));
  assert.equal(
    first.handoffEvidenceDigest,
    digestValue(first.preimages.handoffEvidence),
  );
  assert.equal(
    first.operatorDecisionDigest,
    digestValue(first.preimages.operatorDecision),
  );
  assert.equal(
    first.integrationIntentDigest,
    digestValue(first.preimages.integrationIntent),
  );
  assert.equal(
    first.preimages.handoffEvidence.dependencyClosureDigest,
    first.dependencyClosureDigest,
  );
  assert.equal(
    first.preimages.handoffEvidence.namedChecksDigest,
    first.namedChecksDigest,
  );
  assert.equal(
    first.preimages.operatorDecision.handoffEvidenceDigest,
    first.handoffEvidenceDigest,
  );
  assert.equal(
    first.preimages.integrationIntent.operatorDecisionDigest,
    first.operatorDecisionDigest,
  );
  assert.equal(first.preimages.operatorDecision.invocation, "device:integrate");
  assert.equal(first.preimages.namedChecks.checks[0].command, "npm run check");
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.preimages));
  assert.ok(Object.isFrozen(first.preimages.namedChecks.checks));
  assert.ok(Object.isFrozen(first.preimages.namedChecks.checks[0]));
});

test("binds each immutable subject category into the expected digest chain", () => {
  const baseline = createDeviceDeliveryEvidence(input());
  const cases = [
    {
      name: "invocation",
      mutate: value => { value.operation = "publish"; },
      expected: ["operatorDecisionDigest", "integrationIntentDigest"],
    },
    {
      name: "candidate tree",
      mutate: value => { value.headTreeSha = "e".repeat(40); },
      expected: DIGEST_FIELDS,
    },
    {
      name: "review checks",
      mutate: value => { value.authority.focusedEvidenceDigest = "e".repeat(64); },
      expected: [
        "namedChecksDigest",
        "handoffEvidenceDigest",
        "operatorDecisionDigest",
        "integrationIntentDigest",
      ],
    },
    {
      name: "admission closure",
      mutate: value => { value.manifest.planReceiptDigest = "e".repeat(64); },
      expected: [
        "dependencyClosureDigest",
        "handoffEvidenceDigest",
        "operatorDecisionDigest",
        "integrationIntentDigest",
      ],
    },
    {
      name: "review fence",
      mutate: value => { value.authority.claimDigest = "e".repeat(64); },
      expected: [
        "handoffEvidenceDigest",
        "operatorDecisionDigest",
        "integrationIntentDigest",
      ],
    },
    {
      name: "pull request",
      mutate: value => { value.pullRequestNumber = 43; },
      expected: [
        "handoffEvidenceDigest",
        "operatorDecisionDigest",
        "integrationIntentDigest",
      ],
    },
    {
      name: "target repository",
      mutate: value => { value.authority.targetRepository = "owner/other"; },
      expected: DIGEST_FIELDS,
    },
    {
      name: "canonical base",
      mutate: value => { value.authority.canonicalBaseSha = "e".repeat(40); },
      expected: [
        "dependencyClosureDigest",
        "handoffEvidenceDigest",
        "operatorDecisionDigest",
        "integrationIntentDigest",
      ],
    },
  ];

  for (const scenario of cases) {
    const changedInput = input();
    scenario.mutate(changedInput);
    const changed = createDeviceDeliveryEvidence(changedInput);
    assert.deepEqual(
      changedDigests(baseline, changed),
      scenario.expected,
      scenario.name,
    );
  }
});

test("rejects caller-injected digests and preimages", () => {
  for (const field of DIGEST_FIELDS) {
    assert.throws(
      () => createDeviceDeliveryEvidence(input({ [field]: "f".repeat(64) })),
      new RegExp(`${field} is operation-derived`, "u"),
    );
  }
  assert.throws(
    () => createDeviceDeliveryEvidence(input({ preimages: {} })),
    /preimages are operation-derived/u,
  );
});

test("rejects malformed or non-joined immutable delivery subjects", () => {
  const invalidCases = [
    ["unsupported operation", value => { value.operation = "review"; }, /integrate or publish/u],
    ["invalid tree", value => { value.headTreeSha = "tree"; }, /headTreeSha must be/u],
    ["invalid pull request", value => { value.pullRequestNumber = 0; }, /positive integer/u],
    ["planned admission", value => { value.manifest.status = "planned"; }, /admitted lane/u],
    ["write-set digest", value => { value.manifest.writeSetDigest = "f".repeat(64); }, /does not bind/u],
    ["manifest digest", value => { value.manifest.manifestDigest = "f".repeat(64); }, /does not bind/u],
    ["authority scope", value => { value.authority.writeSetDigest = "f".repeat(64); }, /does not join/u],
    ["authority state", value => { value.authority.state = "delivery_authorized"; }, /review-ready/u],
    ["reviewed head", value => { value.headSha = "f".repeat(40); }, /reviewed lane revision/u],
    ["device identity", value => { value.deviceId = "device-b"; }, /branch must exactly join/u],
    ["session identity", value => { value.sessionId = "session-b"; }, /device and session/u],
    ["branch scope", value => { value.branch = "agent/device-a/other"; }, /branch must exactly join/u],
    ["review request", value => { value.authority.reviewRequestId = ""; }, /must not be empty/u],
    ["focused evidence", value => { value.authority.focusedEvidenceDigest = "digest"; }, /SHA-256/u],
  ];

  for (const [name, mutate, pattern] of invalidCases) {
    const invalid = input();
    mutate(invalid);
    assert.throws(
      () => createDeviceDeliveryEvidence(invalid),
      pattern,
      name,
    );
  }
});

test("compacts only oversized cloud mutation replay keys deterministically", () => {
  const realAuthorizationKey = [
    "device-delivery-authorize",
    "a".repeat(64),
    5,
    "b".repeat(64),
    "c".repeat(40),
    ...DIGEST_FIELDS.map((_, index) => String(index + 1).repeat(64)),
  ].join(":");
  assert.ok(realAuthorizationKey.length > CLOUD_COLLABORATION_BOUNDS.textCharacters);
  const inputValue = {
    action: "integrate",
    request: {
      targetRepository: "owner/target",
      idempotencyKey: realAuthorizationKey,
    },
  };

  const first = compactDeviceCloudMutationIdempotencyKey(inputValue);
  const replay = compactDeviceCloudMutationIdempotencyKey(structuredClone(inputValue));
  const changed = compactDeviceCloudMutationIdempotencyKey({
    ...inputValue,
    request: { ...inputValue.request, idempotencyKey: `${realAuthorizationKey}x` },
  });
  const boundary = {
    request: {
      idempotencyKey: "k".repeat(CLOUD_COLLABORATION_BOUNDS.textCharacters),
    },
  };

  assert.match(first.request.idempotencyKey, /^device-cloud-mutation:[0-9a-f]{64}$/u);
  assert.ok(first.request.idempotencyKey.length <= CLOUD_COLLABORATION_BOUNDS.textCharacters);
  assert.equal(first.request.idempotencyKey, replay.request.idempotencyKey);
  assert.notEqual(first.request.idempotencyKey, changed.request.idempotencyKey);
  assert.equal(first.request.targetRepository, inputValue.request.targetRepository);
  assert.equal(inputValue.request.idempotencyKey, realAuthorizationKey);
  assert.equal(compactDeviceCloudMutationIdempotencyKey(boundary), boundary);
});

test("real delivery authorization compacts its replay key before cloud transport", () => {
  const integrationEvidence = Object.fromEntries(
    DIGEST_FIELDS.map((field, index) => [field, String(index + 1).repeat(64)]),
  );
  const actorId = "github-user:7";
  const repositoryId = "github-repository:R_target";
  const workItemId = `work-item:${SEMANTIC_SCOPE}`;
  const claimId = digestValue({
    actorId,
    canonicalBaseRevision: BASE_SHA,
    leaseEpoch: AUTHORITY.leaseEpoch,
    repositoryId,
    workItemId,
    writeSetDigest: MANIFEST.writeSetDigest,
  });
  const expiresAt = "2099-08-05T08:00:00.000Z";
  const reviewedClaim = {
    claimId,
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    state: "reviewed",
    writeAuthority: false,
    scopeReserved: true,
    actorId,
    repositoryId,
    workItemId,
    canonicalBaseRevision: BASE_SHA,
    laneRevision: HEAD_SHA,
    declaredWriteScope: DECLARED_WRITE_SET,
    writeSetDigest: MANIFEST.writeSetDigest,
    leaseEpoch: AUTHORITY.leaseEpoch,
    transitionCounter: AUTHORITY.transitionCounter,
    heartbeatCounter: 0,
    reviewRequestId: AUTHORITY.reviewRequestId,
    predecessorClaimId: null,
    expiresAt,
    fenceRevision: "e".repeat(64),
    transitionDigest: "f".repeat(64),
    operationReceiptDigest: "1".repeat(64),
    integrationReceiptDigest: null,
    integration: null,
  };
  const authority = {
    ...structuredClone(AUTHORITY),
    claimId,
    claimDigest: reviewedClaim.fenceRevision,
    ledgerDigest: "7".repeat(64),
    claimLedgerRevision: reviewedClaim.transitionDigest,
    entrySchema: reviewedClaim.entrySchema,
    claimIdentitySchema: reviewedClaim.claimIdentitySchema,
    operationReceiptDigest: reviewedClaim.operationReceiptDigest,
    mutationAuthorityEligible: true,
    expiresAt,
  };
  const ledgerRevision = "6".repeat(40);
  const ledgerDigest = "7".repeat(64);
  const evaluatedAt = "2026-08-05T07:00:00.000Z";
  let currentClaim = reviewedClaim;
  let generatedMutation = null;
  let transportedMutation = null;
  const status = () => ({
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "status",
    status: "ready",
    ledgerRevision,
    ledgerDigest,
    claims: [currentClaim],
  });
    const verify = () => verificationResult({
      claim: currentClaim,
      claims: [currentClaim],
    ledgerRevision,
      ledgerDigest,
      evaluationTime: evaluatedAt,
      contractReceiptDigest: "8".repeat(64),
  });
  const transport = inputValue => {
    transportedMutation = inputValue;
    const { request } = inputValue;
    currentClaim = {
      ...currentClaim,
      state: "integrated-preserved",
      transitionCounter: currentClaim.transitionCounter + 1,
      fenceRevision: digestValue({ inputValue, kind: "fence" }),
      transitionDigest: digestValue({ inputValue, kind: "transition" }),
      operationReceiptDigest: "9".repeat(64),
      integrationReceiptDigest: "a".repeat(64),
      integration: {
        candidateRevision: request.headSha,
        reviewRequestId: AUTHORITY.reviewRequestId,
        focusedEvidenceDigest: request.focusedEvidenceDigest,
        ...integrationEvidence,
        integratedAt: evaluatedAt,
      },
    };
    return {
      schema: "agentic-cloud-collaboration-result/v1",
      ok: true,
      action: "integrate",
      status: currentClaim.state,
      ledgerRevision,
      ledgerDigest,
      claimDigest: currentClaim.fenceRevision,
      claim: currentClaim,
      findings: [],
      receipt: { receiptDigest: "b".repeat(64) },
    };
  };

  const result = authorizeDeliveryAdmissionCloudAuthority({
    authority,
    manifest: structuredClone(MANIFEST),
    branch: BRANCH,
    headSha: HEAD_SHA,
    pullRequestNumber: 42,
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    ...integrationEvidence,
    inspect: status,
    verify,
    invoke: inputValue => {
      generatedMutation = inputValue;
      return transport(compactDeviceCloudMutationIdempotencyKey(inputValue));
    },
  });

  assert.ok(
    generatedMutation.request.idempotencyKey.length
      > CLOUD_COLLABORATION_BOUNDS.textCharacters,
  );
  assert.match(
    transportedMutation.request.idempotencyKey,
    /^device-cloud-mutation:[0-9a-f]{64}$/u,
  );
  assert.ok(
    transportedMutation.request.idempotencyKey.length
      <= CLOUD_COLLABORATION_BOUNDS.textCharacters,
  );
  assert.equal(result.authority.state, "delivery_authorized");
});
