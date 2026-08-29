import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCloudTransition,
  createEmptyLedger,
  digestValue,
  listCurrentClaims,
} from "../scripts/cloud-collaboration-contract.mjs";
import {
  classifyPredecessor,
  classifyIntegratedReplay,
  emptyResumableSuccessor,
  normalizeContinuationRequest,
  validateContinuation,
} from "../scripts/cloud-authority-handoff-lineage.mjs";
import {
  buildScopeExpansionLineageAdmission,
  buildScopeExpansionLineageMigrationPlan,
} from "../scripts/cloud-authority-scope-expansion-lineage-contract.mjs";
import {
  createScopeExpansionLineageProjectionProof,
} from "../scripts/cloud-authority-scope-expansion-lineage-projection.mjs";

const BASE = "a".repeat(40);
const SOURCE_HEAD = "b".repeat(40);
const REVIEW_HEAD = "c".repeat(40);
const BRANCH = "agent/device.local/invocation-executor-runtime";
const REVIEW_NODE = "PR_scope_expansion";
const REVIEW = `github-pull-request:${REVIEW_NODE}`;
const PLAN_RECEIPT = "d".repeat(64);
const MANIFEST_DIGEST = "e".repeat(64);
const FOCUSED_EVIDENCE = "f".repeat(64);
const SOURCE_WORK_ITEM = `work-item:${"1".repeat(64)}`;
const TARGET_WORK_ITEM = `work-item:${"2".repeat(64)}`;
const SOURCE_SCOPE = ["path:docs/runtime.md", "semantic:runtime"];
const TARGET_SCOPE = [
  "path:docs/runtime.md",
  "path:scripts/runtime.mjs",
  "semantic:runtime",
];
const ACTOR = Object.freeze({
  actorId: "github-user:1",
  deviceId: "device:legacy-device",
  sessionId: "session:legacy-session",
});
const REPOSITORY = Object.freeze({
  repositoryId: "github-repository:example",
  canonicalRevision: BASE,
});
const CLOUD_ACTOR = Object.freeze({ id: 1, login: "owner" });
const WRITER_EXPIRES = "2026-08-09T00:00:00.000Z";
const CLOUD_EXPIRES = "2026-08-09T04:00:00.000Z";
const OBSERVED_AT = "2026-08-09T03:00:00.000Z";

function fixture({ draft = true } = {}) {
  let ledger = createEmptyLedger("github-repository:ledger");
  const source = mutate(ledger, "claim", "2026-08-09T00:00:00.000Z", {
    workItemId: SOURCE_WORK_ITEM,
    canonicalBaseRevision: BASE,
    declaredWriteScope: SOURCE_SCOPE,
    laneRevision: SOURCE_HEAD,
    leaseEpoch: 1,
    expiresAt: CLOUD_EXPIRES,
    idempotencyKey: "source-claim",
  });
  ledger = source.ledger;
  const sourceProjected = mutate(ledger, "continue", "2026-08-09T00:10:00.000Z", {
    claimId: source.claim.claimId,
    expectedFenceRevision: source.claim.fenceRevision,
    expectedTransitionCounter: source.claim.transitionCounter,
    mode: "projection",
    laneRevision: SOURCE_HEAD,
    reviewRequestId: REVIEW,
    idempotencyKey: "source-projection",
  });
  ledger = sourceProjected.ledger;
  const target = mutate(ledger, "claim", "2026-08-09T00:20:00.000Z", {
    workItemId: TARGET_WORK_ITEM,
    canonicalBaseRevision: BASE,
    declaredWriteScope: TARGET_SCOPE,
    laneRevision: SOURCE_HEAD,
    predecessorClaimId: source.claim.claimId,
    leaseEpoch: 1,
    expiresAt: CLOUD_EXPIRES,
    idempotencyKey: "target-waiting",
  });
  ledger = target.ledger;
  const retirementEvidence = {
    schema: "agentic-active-dirty-scope-expansion-cloud-evidence/v1",
    phase: "source-retired",
    planDigest: PLAN_RECEIPT,
    sourceClaimId: source.claim.claimId,
    successorClaimId: target.claim.claimId,
    sourceFenceSha: SOURCE_HEAD,
    targetWriteSetDigest: target.claim.writeSetDigest,
  };
  const retired = mutate(ledger, "retire", "2026-08-09T00:30:00.000Z", {
    claimId: sourceProjected.claim.claimId,
    expectedFenceRevision: sourceProjected.claim.fenceRevision,
    expectedTransitionCounter: sourceProjected.claim.transitionCounter,
    reason: "superseded",
    finalRevision: SOURCE_HEAD,
    reviewRequestId: REVIEW,
    bytesDigest: digestValue({ ...retirementEvidence, kind: "bytes" }),
    namedChecksDigest: digestValue({ ...retirementEvidence, kind: "checks" }),
    handoffEvidenceDigest: digestValue({ ...retirementEvidence, kind: "handoff" }),
    idempotencyKey: "source-retirement",
  });
  ledger = retired.ledger;
  const promoted = mutate(ledger, "continue", "2026-08-09T00:40:00.000Z", {
    claimId: target.claim.claimId,
    expectedFenceRevision: target.claim.fenceRevision,
    expectedTransitionCounter: target.claim.transitionCounter,
    mode: "promote",
    expiresAt: CLOUD_EXPIRES,
    idempotencyKey: "target-promote",
  });
  ledger = promoted.ledger;
  const projected = mutate(ledger, "continue", "2026-08-09T00:50:00.000Z", {
    claimId: promoted.claim.claimId,
    expectedFenceRevision: promoted.claim.fenceRevision,
    expectedTransitionCounter: promoted.claim.transitionCounter,
    mode: "projection",
    laneRevision: REVIEW_HEAD,
    reviewRequestId: REVIEW,
    idempotencyKey: "target-projection",
  });
  ledger = projected.ledger;
  const reviewed = mutate(ledger, "continue", "2026-08-09T01:00:00.000Z", {
    claimId: projected.claim.claimId,
    expectedFenceRevision: projected.claim.fenceRevision,
    expectedTransitionCounter: projected.claim.transitionCounter,
    mode: "review",
    laneRevision: REVIEW_HEAD,
    reviewRequestId: REVIEW,
    focusedEvidenceDigest: FOCUSED_EVIDENCE,
    idempotencyKey: "target-review",
  });
  ledger = reviewed.ledger;
  const state = { ledger, observedAt: OBSERVED_AT };
  refreshStatus(state);
  const reviewedClaim = state.status.claims.find(
    claim => claim.claimId === target.claim.claimId,
  );
  state.lane = legacyLane(reviewedClaim, draft);
  const integrated = mutate(ledger, "integrate", "2026-08-09T01:10:00.000Z", {
    claimId: reviewed.claim.claimId,
    expectedFenceRevision: reviewed.claim.fenceRevision,
    expectedTransitionCounter: reviewed.claim.transitionCounter,
    candidateRevision: REVIEW_HEAD,
    reviewRequestId: REVIEW,
    focusedEvidenceDigest: FOCUSED_EVIDENCE,
    dependencyClosureDigest: digestValue({ integration: "dependencies" }),
    namedChecksDigest: digestValue({ integration: "checks" }),
    handoffEvidenceDigest: digestValue({ integration: "handoff" }),
    operatorDecisionDigest: digestValue({ integration: "operator" }),
    integrationIntentDigest: digestValue({ integration: "intent" }),
    idempotencyKey: "target-integrate",
  });
  state.ledger = integrated.ledger;
  refreshStatus(state);
  return state;
}

function request() {
  return normalizeContinuationRequest({
    transition: "reclaim",
    branch: BRANCH,
    sessionId: "legacy-session",
    successorSessionId: "legacy-session",
    successorDeviceId: "legacy-device",
    ttlSeconds: 1_800,
  });
}

function inspect(state) {
  const continuationRequest = request();
  const proof = createScopeExpansionLineageProjectionProof({
    lane: state.lane,
    actor: CLOUD_ACTOR,
    status: state.status,
    ledger: state.ledger,
    request: continuationRequest,
    now: new Date(OBSERVED_AT),
  });
  const predecessor = classifyPredecessor({
    lane: state.lane,
    actor: CLOUD_ACTOR,
    status: state.status,
    request: continuationRequest,
    lineageProjectionProof: proof,
  });
  const integratedReplay = classifyIntegratedReplay({
    request: continuationRequest,
    lane: state.lane,
    actor: CLOUD_ACTOR,
    status: state.status,
    predecessor,
  });
  const findings = validateContinuation({
    request: continuationRequest,
    lane: state.lane,
    actor: CLOUD_ACTOR,
    status: state.status,
    predecessor,
    successor: emptyResumableSuccessor(),
    integratedReplay,
    lineageProjectionProof: proof,
  });
  return { proof, predecessor, integratedReplay, findings };
}

test("epoch-1 integrated lineage accepts only the draft provider projection", () => {
  const state = fixture();
  assert.throws(() => buildScopeExpansionLineageMigrationPlan({
    lane: state.lane,
    actor: CLOUD_ACTOR,
    status: state.status,
    ledger: state.ledger,
  }), /Legacy lane projection drifted/u);

  const observed = inspect(state);
  assert.equal(observed.predecessor.status, "ready");
  assert.equal(observed.integratedReplay.claim?.state, "integrated-preserved");
  assert.deepEqual(observed.findings.map(item => item.type), ["review-projection-not-ready"]);
});

test("ready recapture preserves stable lineage identity across unrelated ledger advance", () => {
  const state = fixture();
  const draft = inspect(state);
  state.lane = {
    ...state.lane,
    pullRequest: { ...state.lane.pullRequest, isDraft: false },
  };
  const ready = inspect(state);
  assert.equal(ready.proof.lineageIdentityDigest, draft.proof.lineageIdentityDigest);
  assert.deepEqual(ready.findings, []);

  const unrelated = mutate(state.ledger, "claim", "2026-08-09T02:00:00.000Z", {
    workItemId: `work-item:${"9".repeat(64)}`,
    canonicalBaseRevision: BASE,
    declaredWriteScope: ["path:docs/unrelated.md", "semantic:unrelated"],
    laneRevision: BASE,
    leaseEpoch: 1,
    expiresAt: CLOUD_EXPIRES,
    idempotencyKey: "unrelated-claim",
  });
  state.ledger = unrelated.ledger;
  refreshStatus(state);
  const advanced = inspect(state);
  assert.equal(advanced.proof.lineageIdentityDigest, draft.proof.lineageIdentityDigest);
  assert.deepEqual(advanced.findings, []);
});

test("forged proof and live writer lease cannot authorize projection", () => {
  const state = fixture();
  const observed = inspect(state);
  const forged = { ...observed.proof };
  const rejected = classifyPredecessor({
    lane: state.lane,
    actor: CLOUD_ACTOR,
    status: state.status,
    request: request(),
    lineageProjectionProof: forged,
  });
  assert.equal(rejected.status, "mismatched");
  assert.throws(() => buildScopeExpansionLineageAdmission({
    verified: observed.proof,
    authorization: {},
    executionIntent: {},
    lane: state.lane,
    status: state.status,
  }), /freshly verified recoverable ledger proof/u);

  const liveWriter = {
    ...state,
    lane: {
      ...state.lane,
      lease: { ...state.lane.lease, expiresAt: CLOUD_EXPIRES },
    },
  };
  assert.throws(() => inspect(liveWriter), /stale local writer lease/u);
});

function mutate(ledger, action, evaluationTime, transitionRequest) {
  return applyCloudTransition({
    ledger,
    action,
    actor: ACTOR,
    repository: REPOSITORY,
    evaluationTime,
    request: { ...transitionRequest, expectedLedgerDigest: ledger.headDigest },
  });
}

function refreshStatus(state) {
  state.status = {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "status",
    status: "ready",
    repositoryId: REPOSITORY.repositoryId,
    ledgerRevision: revision(`ledger-${state.ledger.sequence}`),
    ledgerDigest: state.ledger.headDigest,
    claims: listCurrentClaims(
      state.ledger,
      state.observedAt,
      { repositoryId: REPOSITORY.repositoryId },
    ).map(claim => ({ ...claim, transitionDigest: claim.transitionDigest || claim.ledgerRevision })),
  };
}

function legacyLane(claim, draft) {
  const authority = authorityFromClaim(claim);
  const admission = {
    schema: "agentic-lane-admission-lease/v1",
    status: "admitted",
    semanticScope: "invocation-executor-runtime",
    declaredWriteSet: claim.declaredWriteScope,
    writeSetDigest: claim.writeSetDigest,
    manifestDigest: MANIFEST_DIGEST,
    planReceiptDigest: PLAN_RECEIPT,
    admissionReceiptDigest: "1".repeat(64),
    existingLaneStateDigest: "2".repeat(64),
    admittedReportDigest: "3".repeat(64),
    preservationReceiptDigest: "4".repeat(64),
  };
  const lease = {
    schema: "agentic-writer-lease/v2",
    status: "review_ready",
    sessionId: "legacy-session",
    device: "legacy-device",
    scope: "invocation-executor-runtime",
    branch: BRANCH,
    baseSha: BASE,
    fenceSha: SOURCE_HEAD,
    reviewHeadSha: REVIEW_HEAD,
    pullRequestUrl: "https://github.com/example/repo/pull/1",
    expiresAt: WRITER_EXPIRES,
    admission,
    cloudAuthority: authority,
  };
  return {
    repository: "/repo",
    branch: BRANCH,
    headSha: REVIEW_HEAD,
    remoteHeadSha: REVIEW_HEAD,
    clean: true,
    baseSha: BASE,
    lease,
    manifest: {
      declaredWriteSet: claim.declaredWriteScope,
      writeSetDigest: claim.writeSetDigest,
      manifestDigest: MANIFEST_DIGEST,
      admittedReportDigest: admission.admittedReportDigest,
    },
    authority,
    pullRequest: {
      id: REVIEW_NODE,
      url: lease.pullRequestUrl,
      state: "OPEN",
      isDraft: draft,
      headRefName: BRANCH,
      headRefOid: REVIEW_HEAD,
      baseRefName: "main",
      body: "<marker>",
      authorLogin: "owner",
    },
    remoteLease: {
      status: "review_ready",
      branch: BRANCH,
      baseSha: BASE,
      scope: "invocation-executor-runtime",
      sessionId: "legacy-session",
      device: "legacy-device",
      reviewHeadSha: REVIEW_HEAD,
      cloudAuthority: authority,
    },
  };
}

function authorityFromClaim(claim) {
  return {
    schema: "agentic-lane-cloud-authority/v1",
    provider: "github",
    ledgerRepository: "example/ledger",
    targetRepository: "example/repo",
    claimId: claim.claimId,
    claimDigest: claim.fenceRevision,
    ledgerRevision: revision(`authority-${claim.transitionCounter}`),
    ledgerDigest: "5".repeat(64),
    claimLedgerRevision: claim.transitionDigest,
    entrySchema: claim.entrySchema,
    claimIdentitySchema: claim.claimIdentitySchema,
    operationReceiptDigest: claim.operationReceiptDigest,
    mutationAuthorityEligible: true,
    canonicalBaseSha: claim.canonicalBaseRevision,
    laneRevision: claim.laneRevision,
    cloudDeclaredWriteScope: claim.declaredWriteScope,
    writeSetDigest: claim.writeSetDigest,
    deviceId: "legacy-device",
    sessionId: "legacy-session",
    reviewRequestId: claim.reviewRequestId,
    leaseEpoch: claim.leaseEpoch,
    transitionCounter: claim.transitionCounter,
    state: "review_ready",
    expiresAt: claim.expiresAt,
    focusedEvidenceDigest: claim.evidenceDigest || FOCUSED_EVIDENCE,
    integrationReceiptDigest: null,
    integration: null,
    manifestDigest: MANIFEST_DIGEST,
  };
}

function revision(label) {
  return digestValue({ label }).slice(0, 40);
}
