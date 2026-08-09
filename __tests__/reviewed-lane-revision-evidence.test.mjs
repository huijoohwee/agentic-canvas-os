import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "../scripts/github-cloud-collaboration-mapping.mjs";
import {
  advanceReviewedLaneRevisionIntent,
  authorizeReviewedLaneRevision,
  buildReviewedLaneRevisionPlan,
  createReviewedLaneRevisionIntent,
  normalizeReviewedLaneRevisionIntent,
  normalizeReviewedLaneRevisionPlan,
  reviewedLaneRevisionOperationKey,
} from "../scripts/reviewed-lane-revision-contract.mjs";
import {
  assertReviewedLaneRevisionPullRequest,
  buildReviewedLaneRevisionCommitCandidate,
  buildReviewedLaneRevisionSourceEvidence,
  normalizeReviewedLaneRevisionCommitCandidate,
  normalizeReviewedLaneRevisionSourceEvidence,
} from "../scripts/reviewed-lane-revision-evidence.mjs";
import { updateWriterLeasePullRequestBody } from "../scripts/writer-lease-lib.mjs";

const BASE_SHA = "1".repeat(40);
const FENCE_SHA = "2".repeat(40);
const TREE_SHA = "3".repeat(40);
const PARENT_SHA = "4".repeat(40);
const LEDGER_SHA = "5".repeat(40);
const CLAIM_ID = "6".repeat(64);
const CLAIM_DIGEST = "7".repeat(64);
const CLAIM_LEDGER = "8".repeat(64);
const FOCUSED_EVIDENCE = "9".repeat(64);
const MANIFEST_DIGEST = "a".repeat(64);
const OPERATION_RECEIPT = "b".repeat(64);
const REPOSITORY = "owner/repository";
const REPOSITORY_NODE_ID = "R_repository";
const ACTOR_ID = 8945812;
const ACTOR_LOGIN = "owner";
const DEVICE = "device.local";
const SESSION = "reviewed-session";
const SCOPE = "reviewed-scope";
const BRANCH = `agent/${DEVICE}/${SCOPE}`;
const PULL_REQUEST_NODE_ID = "PR_reviewed";
const REVIEW_REQUEST_ID = `github-pull-request:${PULL_REQUEST_NODE_ID}`;
const SOURCE_SUBJECT =
  "feat(reviewed-ci-revision-recovery): add hard-stopped recovery controller";
const REPLACEMENT_SUBJECT =
  "fix(reviewed-ci-revision-recovery): hard-stop recovery controller";

function hashCommit(rawCommit) {
  const bytes = Buffer.from(rawCommit, "utf8");
  return createHash("sha1")
    .update(Buffer.from(`commit ${bytes.length}\0`, "utf8"))
    .update(bytes)
    .digest("hex");
}

function rawCommit(subject = SOURCE_SUBJECT) {
  return [
    `tree ${TREE_SHA}`,
    `parent ${PARENT_SHA}`,
    "author Owner <owner@example.test> 1786263212 +0800",
    "committer Owner <owner@example.test> 1786263212 +0800",
    "",
    subject,
    "",
    "Preserve this body byte-for-byte.",
    "",
    "Agentic-Task: reviewed-scope",
    "",
  ].join("\n");
}

function fixture() {
  const sourceRawCommit = rawCommit();
  const headSha = hashCommit(sourceRawCommit);
  const declaredWriteSet = ["path:scripts/reviewed.mjs", `semantic:${SCOPE}`];
  const writeSetDigest = digestValue(declaredWriteSet);
  const authority = {
    schema: "agentic-lane-cloud-authority/v1",
    provider: "github",
    ledgerRepository: REPOSITORY,
    targetRepository: REPOSITORY,
    claimId: CLAIM_ID,
    claimDigest: CLAIM_DIGEST,
    ledgerRevision: LEDGER_SHA,
    ledgerDigest: "c".repeat(64),
    claimLedgerRevision: CLAIM_LEDGER,
    canonicalBaseSha: BASE_SHA,
    laneRevision: headSha,
    cloudDeclaredWriteScope: declaredWriteSet,
    writeSetDigest,
    deviceId: DEVICE,
    sessionId: SESSION,
    reviewRequestId: REVIEW_REQUEST_ID,
    leaseEpoch: 3,
    transitionCounter: 7,
    state: "review_ready",
    expiresAt: "2099-08-09T00:00:00.000Z",
    focusedEvidenceDigest: FOCUSED_EVIDENCE,
    manifestDigest: MANIFEST_DIGEST,
  };
  const lease = {
    schema: "agentic-writer-lease/v2",
    status: "review_ready",
    epoch: 22,
    sessionId: SESSION,
    device: DEVICE,
    scope: SCOPE,
    branch: BRANCH,
    worktreePath: "/workspace/reviewed",
    baseSha: BASE_SHA,
    fenceSha: FENCE_SHA,
    pullRequestUrl: `https://github.com/${REPOSITORY}/pull/345`,
    autoDelivery: false,
    runtimeRequired: false,
    acquiredAt: "2026-08-09T00:00:00.000Z",
    heartbeatAt: "2026-08-09T00:01:00.000Z",
    expiresAt: "2099-08-09T00:00:00.000Z",
    reviewHeadSha: headSha,
    admission: {
      schema: "agentic-lane-admission-lease/v1",
      status: "admitted",
      semanticScope: SCOPE,
      declaredWriteSet,
      writeSetDigest,
      manifestDigest: MANIFEST_DIGEST,
      planReceiptDigest: "d".repeat(64),
      admissionReceiptDigest: "e".repeat(64),
      existingLaneStateDigest: "f".repeat(64),
      admittedReportDigest: "0".repeat(64),
      preservationReceiptDigest: "1".repeat(64),
    },
    cloudAuthority: authority,
  };
  const claim = {
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    claimId: CLAIM_ID,
    actorId: `github-user:${ACTOR_ID}`,
    repositoryId: `github-repository:${REPOSITORY_NODE_ID}`,
    workItemId: "work-item:reviewed",
    deviceId: pseudonymousIdentifier("device", DEVICE),
    sessionId: pseudonymousIdentifier("session", SESSION),
    canonicalBaseRevision: BASE_SHA,
    laneRevision: headSha,
    declaredWriteScope: declaredWriteSet,
    writeSetDigest,
    leaseEpoch: authority.leaseEpoch,
    transitionCounter: authority.transitionCounter,
    heartbeatCounter: 0,
    reviewRequestId: REVIEW_REQUEST_ID,
    expiresAt: authority.expiresAt,
    fenceRevision: CLAIM_DIGEST,
    transitionDigest: CLAIM_LEDGER,
    operationReceiptDigest: OPERATION_RECEIPT,
    state: "reviewed",
  };
  const body = updateWriterLeasePullRequestBody("Human context.", lease);
  const pullRequest = {
    url: lease.pullRequestUrl,
    number: 345,
    nodeId: PULL_REQUEST_NODE_ID,
    state: "OPEN",
    isDraft: false,
    title: REPLACEMENT_SUBJECT,
    body,
    headRepository: REPOSITORY,
    baseRepository: REPOSITORY,
    headBranch: BRANCH,
    baseBranch: "main",
    headSha,
    baseSha: BASE_SHA,
    authorLogin: ACTOR_LOGIN,
    autoMergeRequest: null,
    isInMergeQueue: false,
    mergeQueueEntry: null,
    reviewRequestId: REVIEW_REQUEST_ID,
  };
  const source = buildReviewedLaneRevisionSourceEvidence({
    repository: { fullName: REPOSITORY, nodeId: REPOSITORY_NODE_ID },
    actor: { id: ACTOR_ID, login: ACTOR_LOGIN },
    lease,
    authority,
    claim,
    pullRequest,
    rawCommit: sourceRawCommit,
    hashCommit,
    localHeadSha: headSha,
    remoteHeadSha: headSha,
    clean: true,
  });
  const candidate = buildReviewedLaneRevisionCommitCandidate({
    rawCommit: sourceRawCommit,
    replacementSubject: REPLACEMENT_SUBJECT,
    hashCommit,
  });
  return { authority, candidate, claim, headSha, lease, pullRequest, source };
}

test("builds one changed commit with exact tree, parents, authorship, and remaining bytes", () => {
  const { candidate } = fixture();
  assert.notEqual(candidate.source.headSha, candidate.candidate.headSha);
  assert.equal(candidate.source.treeSha, candidate.candidate.treeSha);
  assert.deepEqual(candidate.source.parentShas, candidate.candidate.parentShas);
  assert.equal(candidate.source.authorHeader, candidate.candidate.authorHeader);
  assert.equal(candidate.source.committerHeader, candidate.candidate.committerHeader);
  assert.equal(
    candidate.source.message.slice(candidate.source.subject.length),
    candidate.candidate.message.slice(candidate.candidate.subject.length),
  );
  assert.deepEqual(normalizeReviewedLaneRevisionCommitCandidate(candidate), candidate);
});

test("binds the exact review-ready lease, cloud claim, PR marker, and raw commit", () => {
  const { source } = fixture();
  assert.equal(source.localHeadSha, source.commit.headSha);
  assert.equal(source.remoteHeadSha, source.commit.headSha);
  assert.equal(source.pullRequest.reviewRequestId, REVIEW_REQUEST_ID);
  assert.deepEqual(normalizeReviewedLaneRevisionSourceEvidence(source), source);
});

test("rejects duplicate writer markers, forks, wrong heads, and already-valid sources", () => {
  const value = fixture();
  assert.throws(() => assertReviewedLaneRevisionPullRequest({
    pullRequest: { ...value.pullRequest, body: `${value.pullRequest.body}\n${value.pullRequest.body}` },
    repository: { fullName: REPOSITORY, nodeId: REPOSITORY_NODE_ID },
    actor: { id: ACTOR_ID, login: ACTOR_LOGIN },
    lease: value.lease,
    authority: value.authority,
    expectedHeadSha: value.headSha,
  }), /exactly one writer marker/u);
  assert.throws(() => assertReviewedLaneRevisionPullRequest({
    pullRequest: { ...value.pullRequest, headRepository: "fork/repository" },
    repository: { fullName: REPOSITORY, nodeId: REPOSITORY_NODE_ID },
    actor: { id: ACTOR_ID, login: ACTOR_LOGIN },
    lease: value.lease,
    authority: value.authority,
    expectedHeadSha: value.headSha,
  }), /identity|projection/u);
  assert.throws(() => buildReviewedLaneRevisionSourceEvidence({
    repository: { fullName: REPOSITORY, nodeId: REPOSITORY_NODE_ID },
    actor: { id: ACTOR_ID, login: ACTOR_LOGIN },
    lease: value.lease,
    authority: value.authority,
    claim: value.claim,
    pullRequest: value.pullRequest,
    rawCommit: rawCommit(REPLACEMENT_SUBJECT),
    hashCommit,
    localHeadSha: hashCommit(rawCommit(REPLACEMENT_SUBJECT)),
    remoteHeadSha: hashCommit(rawCommit(REPLACEMENT_SUBJECT)),
    clean: true,
  }), /drifted|already satisfies/u);
});

test("seals an exact authorization and monotonic replay-safe phase journal", () => {
  const { source, candidate } = fixture();
  const plan = buildReviewedLaneRevisionPlan({
    source,
    replacementSubject: REPLACEMENT_SUBJECT,
    candidate,
  });
  assert.deepEqual(normalizeReviewedLaneRevisionPlan(plan), plan);
  assert.throws(() => authorizeReviewedLaneRevision({
    plan,
    authorization: `${plan.exactAuthorization}\n`,
  }), /exact authorization/u);
  const authorization = authorizeReviewedLaneRevision({
    plan,
    authorization: plan.exactAuthorization,
  });
  const prepared = createReviewedLaneRevisionIntent(plan, authorization);
  const values = {
    operationKey: reviewedLaneRevisionOperationKey(plan, "successor_waiting"),
    claimId: "2".repeat(64),
  };
  const waiting = advanceReviewedLaneRevisionIntent(prepared, {
    status: "successor_waiting",
    values,
  });
  assert.equal(waiting.status, "successor_waiting");
  assert.deepEqual(
    advanceReviewedLaneRevisionIntent(waiting, {
      status: "successor_waiting",
      values,
    }),
    waiting,
  );
  assert.deepEqual(normalizeReviewedLaneRevisionIntent(waiting), waiting);
  assert.throws(() => advanceReviewedLaneRevisionIntent(waiting, {
    status: "local_ref_updated",
    values: { operationKey: reviewedLaneRevisionOperationKey(plan, "local_ref_updated") },
  }), /skip|regress/u);
});

test("rejects self-consistent prepared and later receipt ancestry forgeries", () => {
  const { source, candidate } = fixture();
  const plan = buildReviewedLaneRevisionPlan({
    source,
    replacementSubject: REPLACEMENT_SUBJECT,
    candidate,
  });
  const authorization = authorizeReviewedLaneRevision({
    plan,
    authorization: plan.exactAuthorization,
  });
  const prepared = createReviewedLaneRevisionIntent(plan, authorization);
  const forgedPrepared = structuredClone(prepared);
  forgedPrepared.phases.prepared.intentDigest = "3".repeat(64);
  reseal(forgedPrepared.phases.prepared, "receiptDigest");
  reseal(forgedPrepared, "intentDigest");
  assert.throws(
    () => normalizeReviewedLaneRevisionIntent(forgedPrepared),
    /prior-intent ancestry/u,
  );

  const waiting = advanceReviewedLaneRevisionIntent(prepared, {
    status: "successor_waiting",
    values: {
      operationKey: reviewedLaneRevisionOperationKey(plan, "successor_waiting"),
      claimId: "2".repeat(64),
    },
  });
  const forgedWaiting = structuredClone(waiting);
  forgedWaiting.phases.successor_waiting.intentDigest = "4".repeat(64);
  reseal(forgedWaiting.phases.successor_waiting, "receiptDigest");
  reseal(forgedWaiting, "intentDigest");
  assert.throws(
    () => normalizeReviewedLaneRevisionIntent(forgedWaiting),
    /prior-intent ancestry/u,
  );
});

function reseal(value, digestField) {
  const core = structuredClone(value);
  delete core[digestField];
  value[digestField] = digestValue(core);
}
