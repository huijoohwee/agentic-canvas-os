import assert from "node:assert/strict";
import test from "node:test";

import {
  createDeviceDeliveryEvidence,
  DEVICE_DELIVERY_EVIDENCE_SCHEMA,
} from "../scripts/device-delivery-evidence.mjs";
import {
  digestValue,
  normalizeWriteSet,
} from "../scripts/cloud-collaboration-primitives.mjs";

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
