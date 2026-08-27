import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-contract.mjs";
import { createPostMergeCloudAuthorityController }
  from "../scripts/post-merge-cloud-authority-controller.mjs";

const D = value => value.repeat(64);
const S = value => value.repeat(40);
const branch = "agent/device/source";
const baseSha = S("b");
const headSha = S("a");
const reviewRequestId = "github-pull-request:PR_node_42";
const deliveryEvidence = Object.freeze({
  dependencyClosureDigest: D("6"),
  namedChecksDigest: D("7"),
  handoffEvidenceDigest: D("8"),
  operatorDecisionDigest: D("9"),
  integrationIntentDigest: D("a"),
});

function fixture({ retired = false } = {}) {
  const integration = {
    candidateRevision: headSha,
    reviewRequestId,
    focusedEvidenceDigest: D("b"),
    ...deliveryEvidence,
    integratedAt: "2026-08-26T01:00:00.000Z",
  };
  const integrated = {
    schema: "agentic-cloud-collaboration-entry/v2",
    sequence: 20,
    action: "integrate",
    repositoryId: "github-repository:R_repo",
    claimId: D("1"),
    idempotencyKey: D("2"),
    requestDigest: D("3"),
    evaluationTime: "2026-08-26T01:00:00.000Z",
    claimDigest: D("4"),
    digest: D("5"),
    claimCore: {
      claimId: D("1"),
      actorId: "github-user:1",
      deviceId: "device:one",
      sessionId: "session:one",
      repositoryId: "github-repository:R_repo",
      workItemId: "work-item:one",
      canonicalBaseRevision: baseSha,
      laneRevision: headSha,
      declaredWriteScope: ["path:scripts/source.mjs", "semantic:source"],
      writeSetDigest: D("c"),
      leaseEpoch: 1,
      transitionCounter: 7,
      heartbeatCounter: 0,
      state: "integrated-preserved",
      expiresAt: "2026-08-26T03:00:00.000Z",
      evidenceDigest: D("b"),
      reviewRequestId,
      integration,
    },
  };
  const integrationReceiptDigest = receiptDigest(integrated);
  const authority = {
    state: "delivery_authorized",
    ledgerRepository: "owner/ledger",
    targetRepository: "owner/source",
    claimId: D("1"),
    claimDigest: integrated.claimDigest,
    claimLedgerRevision: integrated.digest,
    integrationReceiptDigest,
    canonicalBaseSha: baseSha,
    laneRevision: headSha,
    writeSetDigest: D("c"),
    cloudDeclaredWriteScope: integrated.claimCore.declaredWriteScope,
    leaseEpoch: 1,
    transitionCounter: 7,
    reviewRequestId,
    focusedEvidenceDigest: D("b"),
    integration,
  };
  const ledger = { headDigest: integrated.digest, entries: [integrated] };
  const pullRequest = {
    number: 42,
    id: "PR_node_42",
    url: "https://github.com/owner/source/pull/42",
    state: "MERGED",
    isCrossRepository: false,
    headRefName: branch,
    headRefOid: headSha,
    baseRefName: "main",
    baseRefOid: baseSha,
    mergeCommit: { oid: S("c") },
    mergedAt: "2026-08-26T01:05:00.000Z",
  };
  if (retired) appendRetirement(ledger, {
    bytesDigest: protectedPushBytes(),
    idempotencyKey: digestValue(`push-integrated-retire:${S("c")}:${authority.claimId}`),
    integrationReceiptDigest,
  });
  return { authority, integrationReceiptDigest, ledger, pullRequest };
}

function appendRetirement(ledger, { bytesDigest, idempotencyKey,
  integrationReceiptDigest }) {
  const integrated = ledger.entries[0];
  const retirement = {
    ...integrated,
    sequence: 21,
    action: "retire",
    idempotencyKey,
    requestDigest: D("e"),
    evaluationTime: "2026-08-26T01:10:00.000Z",
    claimDigest: D("f"),
    digest: D("0"),
    claimCore: {
      ...integrated.claimCore,
      transitionCounter: 8,
      state: "retired",
      retirement: {
        reason: "integrated",
        finalRevision: headSha,
        reviewRequestId,
        bytesDigest,
        namedChecksDigest: deliveryEvidence.namedChecksDigest,
        handoffEvidenceDigest: deliveryEvidence.handoffEvidenceDigest,
        integrationReceiptDigest,
        retiredAt: "2026-08-26T01:10:00.000Z",
      },
    },
  };
  ledger.entries.push(retirement);
  ledger.headDigest = retirement.digest;
  return retirement;
}

function options(value) {
  return {
    cloudAuthority: value.authority,
    pullRequestUrl: value.pullRequest.url,
    branch,
    headSha,
    canonicalBaseSha: baseSha,
  };
}

function harness(value, { loseResponse = false, liveError = null } = {}) {
  let ledger = structuredClone(value.ledger);
  let mutationCalls = 0;
  let ledgerReads = 0;
  let pullReads = 0;
  const controller = createPostMergeCloudAuthorityController({
    verifyLive: () => {
      if (liveError) throw liveError;
      return { schema: "agentic-cloud-delivery-verification/v1", configured: true, status: "ready" };
    },
    readPullRequest: () => {
      pullReads += 1;
      return structuredClone(value.pullRequest);
    },
    readLedger: () => {
      ledgerReads += 1;
      return { ledger: structuredClone(ledger), ledgerRevision: S(String(ledgerReads)) };
    },
    retireClaim: ({ request }) => {
      mutationCalls += 1;
      appendRetirement(ledger, {
        bytesDigest: request.bytesDigest,
        idempotencyKey: digestValue(request.idempotencyKey),
        integrationReceiptDigest: request.integrationReceiptDigest,
      });
      if (loseResponse) throw new Error("transport response was lost");
      return {
        schema: "agentic-cloud-collaboration-result/v1",
        ok: true,
        action: "retire",
        status: "retired",
        claim: {
          claimId: value.authority.claimId,
          state: "retired",
          integrationReceiptDigest: request.integrationReceiptDigest,
        },
        operationReceipt: {
          schema: "agentic-collaboration-retirement-receipt/v1",
          operation: "retire",
          status: "retired",
          claimId: value.authority.claimId,
          idempotencyKey: digestValue(request.idempotencyKey),
          receiptDigest: D("9"),
        },
      };
    },
    validate: () => [],
  });
  return {
    controller,
    counts: () => ({ ledgerReads, mutationCalls, pullReads }),
  };
}

test("open pull requests use live verification without ledger reads or mutation", () => {
  const value = fixture();
  value.pullRequest.state = "OPEN";
  delete value.pullRequest.mergeCommit;
  delete value.pullRequest.mergedAt;
  const run = harness(value);
  const result = run.controller(options(value));
  assert.equal(result.status, "ready");
  assert.deepEqual(run.counts(), { ledgerReads: 0, mutationCalls: 0, pullReads: 1 });
});

test("open pull requests preserve the original live verification error", () => {
  const value = fixture();
  value.pullRequest.state = "OPEN";
  const original = new Error("live authority unavailable");
  const run = harness(value, { liveError: original });
  assert.throws(() => run.controller(options(value)), error => error === original);
  assert.equal(run.counts().mutationCalls, 0);
});

test("merged pull requests retire once and require two terminal readbacks", () => {
  const value = fixture();
  const run = harness(value);
  const result = run.controller(options(value));
  assert.equal(result.status, "integrated-retired");
  assert.equal(result.disposition, "retired");
  assert.equal(result.terminalReadbacks.readbacks.length, 2);
  assert.deepEqual(run.counts(), { ledgerReads: 3, mutationCalls: 1, pullReads: 3 });
  assert.equal(result.controllerReceipt.claimId, value.authority.claimId);
  assert.equal(result.controllerReceipt.integrationReceiptDigest, value.integrationReceiptDigest);
});

test("recovers a lost mutation response only from two exact readbacks", () => {
  const value = fixture();
  const run = harness(value, { loseResponse: true });
  const result = run.controller(options(value));
  assert.equal(result.disposition, "response-loss-recovered");
  assert.equal(result.responseLossRecovered, true);
  assert.equal(result.controllerReceipt.mutationOperationReceiptDigest, null);
  assert.deepEqual(run.counts(), { ledgerReads: 3, mutationCalls: 1, pullReads: 3 });
});

test("does not recover response loss while the claim remains integrated-preserved", () => {
  const value = fixture();
  let ledgerReads = 0;
  const controller = createPostMergeCloudAuthorityController({
    verifyLive: () => ({ configured: true, status: "ready" }),
    readPullRequest: () => structuredClone(value.pullRequest),
    readLedger: () => ({
      ledger: structuredClone(value.ledger),
      ledgerRevision: S(String(++ledgerReads)),
    }),
    retireClaim: () => { throw new Error("transport response was lost"); },
    validate: () => [],
  });
  assert.throws(
    () => controller(options(value)),
    /transport response was lost/u,
  );
  assert.equal(ledgerReads, 3);
});

test("already-retired replay is read-only and double-checked", () => {
  const value = fixture({ retired: true });
  const run = harness(value);
  const result = run.controller(options(value));
  assert.equal(result.disposition, "already-retired");
  assert.equal(result.mutationAttempted, false);
  assert.deepEqual(run.counts(), { ledgerReads: 2, mutationCalls: 0, pullReads: 2 });
});

test("invalid authoritative ledger fails before mutation", () => {
  const value = fixture();
  let mutationCalls = 0;
  const controller = createPostMergeCloudAuthorityController({
    verifyLive: () => ({ configured: true, status: "ready" }),
    readPullRequest: () => value.pullRequest,
    readLedger: () => ({ ledger: value.ledger, ledgerRevision: S("1") }),
    retireClaim: () => { mutationCalls += 1; },
    validate: () => ["broken chain"],
  });
  assert.throws(() => controller(options(value)), /ledger is invalid/u);
  assert.equal(mutationCalls, 0);
});

test("unconfigured live verification does not query provider state", () => {
  let reads = 0;
  const expected = { configured: false, status: "not-configured" };
  const controller = createPostMergeCloudAuthorityController({
    verifyLive: () => expected,
    readPullRequest: () => { reads += 1; },
    readLedger: () => { reads += 1; },
    retireClaim: () => { reads += 1; },
  });
  assert.equal(controller({}), expected);
  assert.equal(reads, 0);
});

function receiptDigest(entry) {
  return digestValue({
    schema: "agentic-collaboration-integration-receipt/v1",
    operation: "integrate",
    status: "integrated-preserved",
    repositoryId: entry.repositoryId,
    claimId: entry.claimId,
    claimDigest: entry.claimDigest,
    fenceRevision: entry.claimDigest,
    ledgerRevision: entry.digest,
    ledgerSequence: entry.sequence,
    idempotencyKey: entry.idempotencyKey,
    requestDigest: entry.requestDigest,
    evaluationTime: entry.evaluationTime,
  });
}

function protectedPushBytes() {
  return digestValue({
    schema: "agentic-cloud-integration-evidence/v1",
    repository: "owner/source",
    pullRequestNumber: 42,
    reviewRequestId,
    laneRevision: headSha,
    mergeCommitSha: S("c"),
  });
}
