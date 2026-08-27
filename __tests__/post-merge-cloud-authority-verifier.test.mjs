import assert from "node:assert/strict";
import test from "node:test";

import {
  createPostMergeCloudAuthorityVerifier,
  POST_MERGE_CLOUD_AUTHORITY_VERIFICATION_SCHEMA,
  verifyIntegratedRetirementEvidence,
} from "../scripts/post-merge-cloud-authority-verifier.mjs";

const D = value => value.repeat(64);
const S = value => value.repeat(40);

function authority() {
  return {
    state: "delivery_authorized",
    ledgerRepository: "owner/ledger",
    targetRepository: "owner/source",
    claimId: D("1"),
    claimDigest: D("2"),
    claimLedgerRevision: D("3"),
    integrationReceiptDigest: D("4"),
    canonicalBaseSha: S("b"),
    laneRevision: S("a"),
    writeSetDigest: D("5"),
    cloudDeclaredWriteScope: ["path:scripts/source.mjs", "semantic:source"],
    leaseEpoch: 1,
    transitionCounter: 7,
    reviewRequestId: "github-pull-request:PR_node_42",
    focusedEvidenceDigest: D("6"),
    integration: { candidateRevision: S("a") },
  };
}

function options() {
  return {
    cloudAuthority: authority(),
    pullRequestUrl: "https://github.com/owner/source/pull/42",
    branch: "agent/device/source",
    headSha: S("a"),
    canonicalBaseSha: S("b"),
  };
}

function openPullRequest() {
  return {
    number: 42,
    id: "PR_node_42",
    url: "https://github.com/owner/source/pull/42",
    state: "OPEN",
    isCrossRepository: false,
    headRefName: "agent/device/source",
    headRefOid: S("a"),
    baseRefName: "main",
    baseRefOid: S("b"),
  };
}

test("exports the stable post-merge verification contract", () => {
  assert.equal(
    POST_MERGE_CLOUD_AUTHORITY_VERIFICATION_SCHEMA,
    "agentic-post-merge-cloud-authority-verification/v1",
  );
  assert.equal(typeof verifyIntegratedRetirementEvidence, "function");
});

test("unconfigured verification remains provider-read-free", () => {
  let reads = 0;
  const expected = { configured: false, status: "not-configured" };
  const verifier = createPostMergeCloudAuthorityVerifier({
    verifyLive: () => expected,
    readPullRequest: () => { reads += 1; },
    readLedger: () => { reads += 1; },
    retireClaim: () => { reads += 1; },
  });
  assert.equal(verifier({}), expected);
  assert.equal(reads, 0);
});

test("open delivery remains the original live read-only path", () => {
  let mutations = 0;
  const expected = { configured: true, status: "ready" };
  const verifier = createPostMergeCloudAuthorityVerifier({
    verifyLive: () => expected,
    readPullRequest: () => openPullRequest(),
    readLedger: () => assert.fail("open delivery ledger read"),
    retireClaim: () => { mutations += 1; },
  });
  assert.equal(verifier(options()), expected);
  assert.equal(mutations, 0);
});

test("open delivery preserves the original live failure object", () => {
  const original = new Error("live authority unavailable");
  const verifier = createPostMergeCloudAuthorityVerifier({
    verifyLive: () => { throw original; },
    readPullRequest: () => openPullRequest(),
    readLedger: () => assert.fail("open delivery ledger read"),
    retireClaim: () => assert.fail("open delivery mutation"),
  });
  assert.throws(() => verifier(options()), error => error === original);
});

test("merged delivery enters the terminal controller and fails closed on invalid ledger", () => {
  let mutations = 0;
  const merged = {
    ...openPullRequest(),
    state: "MERGED",
    mergeCommit: { oid: S("c") },
    mergedAt: "2026-08-26T01:00:00.000Z",
  };
  const verifier = createPostMergeCloudAuthorityVerifier({
    verifyLive: () => ({ configured: true, status: "ready" }),
    readPullRequest: () => merged,
    readLedger: () => ({ ledger: { headDigest: D("9"), entries: [] }, ledgerRevision: S("d") }),
    retireClaim: () => { mutations += 1; },
    validate: () => [],
  });
  assert.throws(() => verifier(options()), /no exact integration entry/u);
  assert.equal(mutations, 0);
});
