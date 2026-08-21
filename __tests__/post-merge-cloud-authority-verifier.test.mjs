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
    focusedEvidenceDigest: digest("a"),
    integration: {
      candidateRevision: headSha,
      reviewRequestId: "github-pull-request:node",
      focusedEvidenceDigest: digest("a"),
      namedChecksDigest: digest("6"),
      handoffEvidenceDigest: digest("7"),
    },
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
    state: "integrated-preserved",
    reviewRequestId: source.reviewRequestId,
    evidenceDigest: source.focusedEvidenceDigest,
    integration: source.integration,
  };
  return {
    headDigest: digest("8"),
    entries: [
      {
        ...common,
        sequence: 10,
        action: "integrate",
        claimCore: integratedCore,
        claimDigest: source.claimDigest,
        digest: source.claimLedgerRevision,
      },
      {
        ...common,
        sequence: 11,
        action: "retire",
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

function reviewedAuthority() {
  const source = authority();
  return {
    ...source,
    state: "review_ready",
    transitionCounter: source.transitionCounter - 1,
    claimDigest: digest("b"),
    claimLedgerRevision: digest("c"),
    integrationReceiptDigest: null,
    integration: null,
  };
}

function reviewedLedger(source = reviewedAuthority()) {
  const delivery = authority();
  delivery.claimId = source.claimId;
  delivery.canonicalBaseSha = source.canonicalBaseSha;
  delivery.laneRevision = source.laneRevision;
  delivery.writeSetDigest = source.writeSetDigest;
  delivery.cloudDeclaredWriteScope = source.cloudDeclaredWriteScope;
  delivery.leaseEpoch = source.leaseEpoch;
  delivery.transitionCounter = source.transitionCounter + 1;
  delivery.reviewRequestId = source.reviewRequestId;
  delivery.focusedEvidenceDigest = source.focusedEvidenceDigest;
  delivery.integration.focusedEvidenceDigest = source.focusedEvidenceDigest;
  const result = ledger(delivery);
  result.entries.unshift({
    schema: "agentic-cloud-collaboration-entry/v2",
    sequence: 9,
    action: "continue",
    claimId: source.claimId,
    claimDigest: source.claimDigest,
    digest: source.claimLedgerRevision,
    claimCore: {
      claimId: source.claimId,
      canonicalBaseRevision: source.canonicalBaseSha,
      laneRevision: source.laneRevision,
      declaredWriteScope: source.cloudDeclaredWriteScope,
      writeSetDigest: source.writeSetDigest,
      leaseEpoch: source.leaseEpoch,
      transitionCounter: source.transitionCounter,
      state: "reviewed",
      reviewRequestId: source.reviewRequestId,
      evidenceDigest: source.focusedEvidenceDigest,
    },
  });
  return result;
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

test("merged replay recovers an exact reviewed projection from terminal history", () => {
  const source = reviewedAuthority();
  const verifier = createPostMergeCloudAuthorityVerifier({
    verifyLive: () => { throw new Error("verification was blocked"); },
    readPullRequest: () => pullRequest(),
    readLedger: () => reviewedLedger(source),
    validate: () => {},
  });
  const result = verifier(options(source));
  assert.equal(result.status, "integrated-retired");
  assert.equal(result.claimId, source.claimId);
});

test("merged reviewed replay rejects a missing exact reviewed predecessor", () => {
  const source = reviewedAuthority();
  const changed = reviewedLedger(source);
  changed.entries[0].claimDigest = digest("f");
  const verifier = createPostMergeCloudAuthorityVerifier({
    verifyLive: () => { throw new Error("verification was blocked"); },
    readPullRequest: () => pullRequest(),
    readLedger: () => changed,
    validate: () => {},
  });
  assert.throws(
    () => verifier(options(source)),
    /Historical reviewed entry does not match local reviewed authority/u,
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
