import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMITTED_EMPTY_ABANDONED_OWNER_RETIREMENT_REQUEST_SCHEMA,
  isRetiredAdmittedEmptyAbandonedOwnerLane,
} from "../scripts/admitted-empty-abandoned-owner-retirement-contract.mjs";
import { retireAdmittedEmptyAbandonedOwner } from "../scripts/admitted-empty-abandoned-owner-retirement-controller.mjs";
import { isRetiredPreservedLane } from "../scripts/legacy-review-ready-retirement-lib.mjs";
import {
  projectWriterLeasePullRequestMarker,
  updateWriterLeasePullRequestBody,
  WRITER_LEASE_SCHEMA,
} from "../scripts/writer-lease-lib.mjs";

const HEAD = "a".repeat(40);
const TREE = "b".repeat(40);
const BASE = "c".repeat(40);
const CLAIM_FENCE = "d".repeat(64);
const CLAIM_ID = "e".repeat(64);
const CLAIM_DIGEST = "f".repeat(64);
const LEDGER_DIGEST = "1".repeat(64);
const RECEIPT_DIGEST = "2".repeat(64);
const STATE_DIGEST = "3".repeat(64);
const WRITE_SET_DIGEST = "4".repeat(64);
const RETIRED_AT = "2026-08-14T12:00:00.000Z";
const WORKTREE = "/workspace/admitted-empty-owner";
const BRANCH = "agent/device/admitted-empty-owner";
const TARGET_REPOSITORY = "owner/repository";
const PULL_REQUEST_URL = "https://github.com/owner/repository/pull/481";
const REVIEW_REQUEST_ID = "github-pull-request:PR_node_481";

test("retires one empty admitted owner and classifies the released lane as retired-preserved", () => {
  const fixture = createFixture();
  const result = retireAdmittedEmptyAbandonedOwner(fixture.request, fixture.adapter);

  assert.equal(result.ok, true);
  assert.equal(result.status, "retired-preserved");
  assert.equal(result.replayed, false);
  assert.equal(fixture.state.pullRequest.state, "CLOSED");
  assert.equal(fixture.state.lease.status, "released");
  assert.equal(isRetiredAdmittedEmptyAbandonedOwnerLane({ lane: fixture.state.lane }), true);
  assert.equal(isRetiredPreservedLane({ lane: fixture.state.lane }), true);
});

test("replays an already released empty admitted owner without mutating it", () => {
  const fixture = createFixture();
  retireAdmittedEmptyAbandonedOwner(fixture.request, fixture.adapter);
  const before = structuredClone(fixture.state);

  const result = retireAdmittedEmptyAbandonedOwner(fixture.request, fixture.adapter);

  assert.equal(result.ok, true);
  assert.equal(result.replayed, true);
  assert.deepEqual(fixture.state, before);
});

test("fails closed when the lane still has authored delta beyond its fence", () => {
  const fixture = createFixture();
  fixture.state.lease.fenceSha = "9".repeat(40);
  fixture.state.lane.lease = fixture.state.lease;
  assert.throws(
    () => retireAdmittedEmptyAbandonedOwner(fixture.request, fixture.adapter),
    /exact empty-owner identity/,
  );
});

function createFixture() {
  const request = {
    schema: ADMITTED_EMPTY_ABANDONED_OWNER_RETIREMENT_REQUEST_SCHEMA,
    repository: WORKTREE,
    targetRepository: TARGET_REPOSITORY,
    ledgerRepository: TARGET_REPOSITORY,
    branch: BRANCH,
    sourceSessionId: "source-session",
    expectedHead: HEAD,
    expectedPullRequest: 481,
    expectedPullRequestUrl: PULL_REQUEST_URL,
    evaluatedAt: RETIRED_AT,
  };
  const lease = {
    schema: WRITER_LEASE_SCHEMA,
    status: "active",
    epoch: 7,
    sessionId: "source-session",
    device: "device",
    scope: "admitted-empty-owner",
    branch: BRANCH,
    baseSha: BASE,
    fenceSha: HEAD,
    autoDelivery: false,
    runtimeRequired: false,
    heartbeatAt: "2026-08-14T11:00:00.000Z",
    expiresAt: "2026-08-14T11:30:00.000Z",
    worktreePath: WORKTREE,
    pullRequestUrl: PULL_REQUEST_URL,
    admission: {
      schema: "agentic-lane-admission-lease/v1",
      status: "admitted",
      semanticScope: "admitted-empty-owner",
      writeSetDigest: WRITE_SET_DIGEST,
      manifestDigest: "5".repeat(64),
      planReceiptDigest: "6".repeat(64),
      admissionReceiptDigest: "7".repeat(64),
      existingLaneStateDigest: "8".repeat(64),
      admittedReportDigest: "9".repeat(64),
      preservationReceiptDigest: "0".repeat(64),
    },
    cloudAuthority: {
      schema: "agentic-lane-cloud-authority/v1",
      provider: "github",
      ledgerRepository: TARGET_REPOSITORY,
      targetRepository: TARGET_REPOSITORY,
      claimId: CLAIM_ID,
      claimDigest: CLAIM_DIGEST,
      ledgerRevision: HEAD,
      claimLedgerRevision: CLAIM_DIGEST,
      canonicalBaseSha: BASE,
      laneRevision: HEAD,
      cloudDeclaredWriteScope: ["path:docs/a.md", "semantic:admitted-empty-owner"],
      writeSetDigest: WRITE_SET_DIGEST,
      deviceId: "device",
      sessionId: "source-session",
      reviewRequestId: REVIEW_REQUEST_ID,
      leaseEpoch: 1,
      transitionCounter: 2,
      state: "active",
      manifestDigest: "5".repeat(64),
      expiresAt: "2026-08-14T11:30:00.000Z",
    },
  };
  const lane = {
    path: WORKTREE,
    branch: `refs/heads/${BRANCH}`,
    head: HEAD,
    treeSha: TREE,
    indexDigest: "a1".padEnd(64, "1"),
    workingTreeDigest: "b2".padEnd(64, "2"),
    stateDigest: STATE_DIGEST,
    dirty: false,
    invalid: false,
    detached: false,
    leaseAmbiguous: false,
    lease,
  };
  const pullRequest = {
    url: PULL_REQUEST_URL,
    number: 481,
    nodeId: "PR_node_481",
    providerVersion: '"etag-481"',
    state: "OPEN",
    draft: true,
    merged: false,
    closedAt: null,
    body: updateWriterLeasePullRequestBody("", lease),
    headRepository: TARGET_REPOSITORY,
    headBranch: BRANCH,
    headSha: HEAD,
    baseRepository: TARGET_REPOSITORY,
    baseBranch: "main",
    baseSha: BASE,
  };
  const state = {
    lane: { ...lane, lease },
    lease,
    pullRequest,
    remoteHeadSha: HEAD,
    cloudClaimPresent: true,
  };
  const adapter = {
    capture() {
      state.lane.lease = state.lease;
      return {
        lane: state.lane,
        lease: state.lease,
        pullRequest: state.pullRequest,
        remoteHeadSha: state.remoteHeadSha,
      };
    },
    inspectCloudClaim({ allowMissing = false }) {
      const claim = state.cloudClaimPresent
        ? {
          claimId: CLAIM_ID,
          state: "dormant-preserved",
          writeAuthority: false,
          scopeReserved: true,
          laneRevision: HEAD,
          canonicalBaseRevision: BASE,
          writeSetDigest: WRITE_SET_DIGEST,
          transitionCounter: 3,
          fenceRevision: CLAIM_FENCE,
          reviewRequestId: REVIEW_REQUEST_ID,
        }
        : null;
      if (!allowMissing && !claim) throw new Error("Cloud inventory no longer contains the exact admitted owner claim.");
      return {
        verification: {
          receiptDigest: RECEIPT_DIGEST,
          ledgerRevision: HEAD,
          ledgerDigest: LEDGER_DIGEST,
          inventory: { claims: claim ? [claim] : [] },
        },
        claim,
      };
    },
    now() {
      return RETIRED_AT;
    },
    closePullRequest({ body }) {
      state.pullRequest = {
        ...state.pullRequest,
        state: "CLOSED",
        body,
        closedAt: RETIRED_AT,
      };
      return state.pullRequest;
    },
    requireClosedPullRequest({ body }) {
      assert.equal(state.pullRequest.body, body);
      return state.pullRequest;
    },
    requireMissingClaimClosure() {
      return state.pullRequest;
    },
    retireClaim() {
      state.cloudClaimPresent = false;
      return {
        ledgerRevision: HEAD,
        ledgerDigest: LEDGER_DIGEST,
        claimPresentAfter: false,
        retirementReceiptDigest: RECEIPT_DIGEST,
      };
    },
    releaseLease({ timestamp, values }) {
      state.lease = {
        ...state.lease,
        ...values,
        status: "released",
        heartbeatAt: timestamp,
        expiresAt: timestamp,
      };
      state.lane.lease = state.lease;
      return state.lease;
    },
  };
  return { request, adapter, state };
}
