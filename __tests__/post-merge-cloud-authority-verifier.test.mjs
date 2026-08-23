import assert from "node:assert/strict";
import test from "node:test";

import {
  createPostMergeCloudAuthorityVerifier,
  POST_MERGE_CLOUD_AUTHORITY_VERIFICATION_SCHEMA,
} from "../scripts/post-merge-cloud-authority-verifier.mjs";

const sha = value => value.repeat(40);
const digest = value => value.repeat(64);
const headSha = sha("a");
const baseSha = sha("b");
const mergeSha = sha("c");
const refreshedHeadSha = sha("d");
const refreshedMainSha = sha("e");
const integratedExpiry = "2026-08-23T02:24:06.000Z";
const deliveryEvidence = Object.freeze({
  dependencyClosureDigest: digest("6"),
  namedChecksDigest: digest("7"),
  handoffEvidenceDigest: digest("8"),
  operatorDecisionDigest: digest("9"),
  integrationIntentDigest: digest("a"),
});

function authority() {
  return {
    state: "delivery_authorized",
    ledgerRepository: "owner/ledger",
    targetRepository: "owner/source",
    claimId: digest("1"),
    claimDigest: digest("2"),
    claimLedgerRevision: digest("3"),
    integrationReceiptDigest: digest("4"),
    canonicalBaseSha: baseSha,
    laneRevision: headSha,
    writeSetDigest: digest("5"),
    cloudDeclaredWriteScope: ["path:scripts/source.mjs", "semantic:source"],
    leaseEpoch: 1,
    transitionCounter: 7,
    reviewRequestId: "github-pull-request:node",
    focusedEvidenceDigest: digest("b"),
    integration: {
      candidateRevision: headSha,
      reviewRequestId: "github-pull-request:node",
      focusedEvidenceDigest: digest("b"),
      ...deliveryEvidence,
    },
  };
}

function reviewReadyAuthority(source = authority()) {
  return {
    ...source,
    state: "review_ready",
    transitionCounter: source.transitionCounter - 1,
    claimDigest: digest("c"),
    claimLedgerRevision: digest("d"),
    integrationReceiptDigest: null,
    integration: null,
  };
}

function pullRequest(state = "MERGED", pullRequestHeadSha = headSha) {
  return {
    number: 42,
    state,
    headRefName: "agent/device/source",
    headRefOid: pullRequestHeadSha,
    mergeCommit: { oid: mergeSha },
  };
}

function protectedMainRefresh(overrides = {}) {
  return {
    schema: "agentic-protected-main-refresh/v1",
    deliveredHeadSha: headSha,
    refreshedHeadSha,
    mainParentSha: refreshedMainSha,
    ...overrides,
  };
}

function ledger(source = authority()) {
  const common = {
    schema: "agentic-cloud-collaboration-entry/v2",
    claimId: source.claimId,
  };
  const integratedCore = {
    claimId: source.claimId,
    canonicalBaseRevision: source.canonicalBaseSha,
    laneRevision: source.laneRevision,
    declaredWriteScope: source.cloudDeclaredWriteScope,
    writeSetDigest: source.writeSetDigest,
    leaseEpoch: source.leaseEpoch,
    transitionCounter: source.transitionCounter,
    heartbeatCounter: 0,
    state: "integrated-preserved",
    expiresAt: integratedExpiry,
    evidenceDigest: source.focusedEvidenceDigest,
    reviewRequestId: source.reviewRequestId,
    integration: source.integration,
  };
  return {
    headDigest: digest("8"),
    entries: [
      {
        ...common,
        sequence: 10,
        action: "integrate",
        evaluationTime: "2026-08-23T02:06:19.000Z",
        claimCore: integratedCore,
        claimDigest: source.claimDigest,
        digest: source.claimLedgerRevision,
      },
      {
        ...common,
        sequence: 11,
        action: "retire",
        evaluationTime: "2026-08-23T02:20:00.000Z",
        claimCore: {
          ...integratedCore,
          transitionCounter: source.transitionCounter + 1,
          state: "retired",
          retirement: {
            reason: "integrated",
            finalRevision: source.laneRevision,
            reviewRequestId: source.reviewRequestId,
            integrationReceiptDigest: source.integrationReceiptDigest,
            namedChecksDigest: source.integration.namedChecksDigest,
            handoffEvidenceDigest: source.integration.handoffEvidenceDigest,
          },
        },
        digest: digest("9"),
      },
    ],
  };
}

function insertExpiredIntegratedRenewal(value, overrides = {}) {
  const integration = value.entries[0];
  const retirement = value.entries[1];
  const evaluationTime = "2026-08-23T02:41:18.000Z";
  const renewal = {
    ...integration,
    sequence: integration.sequence + 1,
    action: "continue",
    evaluationTime,
    claimDigest: digest("e"),
    digest: digest("f"),
    claimCore: {
      ...integration.claimCore,
      transitionCounter: integration.claimCore.transitionCounter + 1,
      expiresAt: "2026-08-23T03:11:18.000Z",
      recovery: {
        evidenceDigest: digest("d"),
        recoveredAt: evaluationTime,
      },
      ...overrides,
    },
  };
  retirement.sequence += 1;
  retirement.claimCore.transitionCounter += 1;
  retirement.claimCore.expiresAt = renewal.claimCore.expiresAt;
  retirement.claimCore.recovery = renewal.claimCore.recovery;
  value.entries.splice(1, 0, renewal);
  return renewal;
}

function options(source = authority()) {
  return {
    cloudAuthority: source,
    pullRequestUrl: "https://github.com/owner/source/pull/42",
    branch: "agent/device/source",
    headSha,
    canonicalBaseSha: baseSha,
  };
}

test("live delivery verification remains the primary path", () => {
  const expected = { status: "ready" };
  const verifier = createPostMergeCloudAuthorityVerifier({
    verifyLive: () => expected,
    readPullRequest: () => assert.fail("fallback pull request read"),
    readLedger: () => assert.fail("fallback ledger read"),
  });
  assert.equal(verifier(options()), expected);
});

test("merged replay accepts one exact integrated retirement", () => {
  const source = authority();
  const verifier = createPostMergeCloudAuthorityVerifier({
    verifyLive: () => { throw new Error("verification was blocked"); },
    readPullRequest: () => pullRequest(),
    readLedger: () => ledger(source),
    validate: () => {},
  });
  const result = verifier(options(source));
  assert.equal(result.schema, POST_MERGE_CLOUD_AUTHORITY_VERIFICATION_SCHEMA);
  assert.equal(result.status, "integrated-retired");
  assert.equal(result.claimId, source.claimId);
  assert.equal(result.mergeCommitSha, mergeSha);
});

test("merged replay accepts an exact expired integrated-preserved renewal before retirement", () => {
  const source = authority();
  const renewed = ledger(source);
  insertExpiredIntegratedRenewal(renewed);
  const verifier = createPostMergeCloudAuthorityVerifier({
    verifyLive: () => { throw new Error("verification was blocked"); },
    readPullRequest: () => pullRequest(),
    readLedger: () => renewed,
    validate: () => {},
  });
  assert.equal(verifier(options(source)).status, "integrated-retired");
});

test("merged replay rejects identity drift in an integrated-preserved renewal", () => {
  const source = authority();
  const changed = ledger(source);
  insertExpiredIntegratedRenewal(changed, { laneRevision: sha("f") });
  const verifier = createPostMergeCloudAuthorityVerifier({
    verifyLive: () => { throw new Error("verification was blocked"); },
    readPullRequest: () => pullRequest(),
    readLedger: () => changed,
    validate: () => {},
  });
  assert.throws(
    () => verifier(options(source)),
    /invalid renewal transition/u,
  );
});

test("merged replay rejects a non-continuation between integration and retirement", () => {
  const source = authority();
  const changed = ledger(source);
  const renewal = insertExpiredIntegratedRenewal(changed);
  renewal.action = "review";
  const verifier = createPostMergeCloudAuthorityVerifier({
    verifyLive: () => { throw new Error("verification was blocked"); },
    readPullRequest: () => pullRequest(),
    readLedger: () => changed,
    validate: () => {},
  });
  assert.throws(
    () => verifier(options(source)),
    /invalid renewal transition/u,
  );
});

test("merged replay accepts exact review-ready response loss with derived delivery evidence", () => {
  const integrated = authority();
  const reviewed = reviewReadyAuthority(integrated);
  const verifier = createPostMergeCloudAuthorityVerifier({
    verifyLive: () => { throw new Error("verification was blocked"); },
    readPullRequest: () => pullRequest(),
    readLedger: () => ledger(integrated),
    validate: () => {},
  });
  const result = verifier({
    ...options(reviewed),
    deliveryEvidence,
  });
  assert.equal(result.status, "integrated-retired");
  assert.equal(result.integrationEntryDigest, integrated.claimLedgerRevision);
});

test("merged replay rejects review-ready response loss without exact derived evidence", () => {
  const integrated = authority();
  const reviewed = reviewReadyAuthority(integrated);
  const verifier = createPostMergeCloudAuthorityVerifier({
    verifyLive: () => { throw new Error("verification was blocked"); },
    readPullRequest: () => pullRequest(),
    readLedger: () => ledger(integrated),
    validate: () => {},
  });
  assert.throws(
    () => verifier({
      ...options(reviewed),
      deliveryEvidence: {
        ...deliveryEvidence,
        integrationIntentDigest: digest("f"),
      },
    }),
    /does not match local review-ready delivery evidence/u,
  );
});

test("merged replay rejects a noncontiguous review-ready terminal history", () => {
  const integrated = authority();
  const reviewed = reviewReadyAuthority(integrated);
  const changed = ledger(integrated);
  changed.entries[0].claimCore.transitionCounter += 1;
  changed.entries[1].claimCore.transitionCounter += 1;
  const verifier = createPostMergeCloudAuthorityVerifier({
    verifyLive: () => { throw new Error("verification was blocked"); },
    readPullRequest: () => pullRequest(),
    readLedger: () => changed,
    validate: () => {},
  });
  assert.throws(
    () => verifier({
      ...options(reviewed),
      deliveryEvidence,
    }),
    /Historical integration entry does not match local delivery authority/u,
  );
});

test("merged replay accepts the exact controller-proven protected refresh head", () => {
  const source = authority();
  const verifier = createPostMergeCloudAuthorityVerifier({
    verifyLive: () => { throw new Error("verification was blocked"); },
    readPullRequest: () => pullRequest("MERGED", refreshedHeadSha),
    readLedger: () => ledger(source),
    validate: () => {},
  });
  const result = verifier({
    ...options(source),
    protectedMainRefresh: protectedMainRefresh(),
  });
  assert.equal(result.status, "integrated-retired");
  assert.equal(result.headSha, headSha);
});

test("merged replay rejects a refreshed head without its exact receipt chain", () => {
  const source = authority();
  const verifier = createPostMergeCloudAuthorityVerifier({
    verifyLive: () => { throw new Error("verification was blocked"); },
    readPullRequest: () => pullRequest("MERGED", refreshedHeadSha),
    readLedger: () => ledger(source),
    validate: () => {},
  });
  assert.throws(
    () => verifier({
      ...options(source),
      protectedMainRefresh: protectedMainRefresh({ deliveredHeadSha: sha("f") }),
    }),
    /lacks its exact protected-main refresh receipt/u,
  );
});

test("open pull requests retain the original live-verification failure", () => {
  const original = new Error("live authority unavailable");
  const verifier = createPostMergeCloudAuthorityVerifier({
    verifyLive: () => { throw original; },
    readPullRequest: () => pullRequest("OPEN"),
  });
  assert.throws(() => verifier(options()), error => error === original);
});

test("merged replay rejects retirement receipt drift", () => {
  const source = authority();
  const changed = ledger(source);
  changed.entries[1].claimCore.retirement.integrationReceiptDigest = digest("f");
  const verifier = createPostMergeCloudAuthorityVerifier({
    verifyLive: () => { throw new Error("verification was blocked"); },
    readPullRequest: () => pullRequest(),
    readLedger: () => changed,
    validate: () => {},
  });
  assert.throws(
    () => verifier(options(source)),
    /Terminal claim entry is not the exact integrated retirement/u,
  );
});
