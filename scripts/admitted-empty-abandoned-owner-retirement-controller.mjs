// Responsibility: Retire one exact empty admitted owner after provider closure.
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { projectRootState } from "./cloud-collaboration-state-projection.mjs";
import {
  ADMITTED_EMPTY_ABANDONED_OWNER_RETIREMENT_RESULT_SCHEMA,
  buildAdmittedEmptyAbandonedOwnerRetirementReceipt,
  isRetiredAdmittedEmptyAbandonedOwnerLane,
  normalizeAdmittedEmptyAbandonedOwnerRetirementReceipt,
  normalizeAdmittedEmptyAbandonedOwnerRetirementRequest,
  normalizeAdmittedEmptyAbandonedOwnerSnapshot,
  normalizeDormantAdmittedOwnerClaim,
} from "./admitted-empty-abandoned-owner-retirement-contract.mjs";
import {
  projectWriterLeasePullRequestMarker,
  updateWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";

export function retireAdmittedEmptyAbandonedOwner(requestValue, adapterValue) {
  const request = normalizeAdmittedEmptyAbandonedOwnerRetirementRequest(requestValue);
  const adapter = requireAdapter(adapterValue);
  const first = adapter.capture();
  const second = adapter.capture();
  if (digestValue(first) !== digestValue(second)) {
    throw new Error("Lane, lease, remote branch, or pull request changed during inspection.");
  }
  if (second.lease?.status === "released") return replayReleased({ request, snapshot: second, adapter });

  const source = normalizeAdmittedEmptyAbandonedOwnerSnapshot(second, request);
  const cloud = adapter.inspectCloudClaim({ source, request, allowMissing: true });
  const claim = cloud.claim
    ? normalizeDormantAdmittedOwnerClaim(cloud.claim, {
      headSha: source.lane.head,
      canonicalBaseSha: source.lease.baseSha,
      writeSetDigest: source.lease.admission.writeSetDigest,
      reviewRequestId: `github-pull-request:${source.pullRequest.nodeId}`,
    })
    : null;
  const retiredAt = adapter.now();
  const projectedLease = {
    ...source.lease,
    status: "released",
    heartbeatAt: retiredAt,
    expiresAt: retiredAt,
    admission: null,
    cloudAuthority: null,
    taskAuthority: null,
  };
  const body = updateWriterLeasePullRequestBody(source.pullRequest.body, projectedLease);
  const retirementEvidence = {
    schema: "agentic-admitted-empty-abandoned-owner-retirement-evidence/v1",
    branch: source.branch,
    claimId: claim?.claimId || source.lease.cloudAuthority.claimId,
    canonicalBaseSha: source.lease.baseSha,
    headSha: source.lane.head,
    treeSha: source.lane.treeSha,
    remoteHeadSha: source.remoteHeadSha,
    stateDigest: source.lane.stateDigest,
    originalLeaseDigest: digestValue(source.lease),
    releasedWriterMarkerDigest: digestValue(projectWriterLeasePullRequestMarker(projectedLease)),
    pullRequestUrl: source.pullRequest.url,
    reviewRequestId: claim?.reviewRequestId || source.lease.cloudAuthority.reviewRequestId,
  };
  const closed = claim === null
    ? adapter.requireMissingClaimClosure({ expected: source.pullRequest })
    : source.pullRequest.state === "CLOSED"
      ? adapter.requireClosedPullRequest({ expected: source.pullRequest, body })
      : adapter.closePullRequest({
        expected: source.pullRequest,
        expectedLease: source.lease,
        body,
      });
  const retired = claim === null
    ? {
      ledgerRevision: cloud.verification.ledgerRevision,
      ledgerDigest: cloud.verification.ledgerDigest,
      claimPresentAfter: false,
      retirementReceiptDigest: cloud.verification.receiptDigest,
      sourceClaimState: "dormant-preserved",
    }
    : adapter.retireClaim({
      request,
      source,
      claim,
      evidence: retirementEvidence,
    });
  if (retired.claimPresentAfter) {
    throw new Error("Cloud retirement left the admitted owner claim active.");
  }
  const receipt = buildAdmittedEmptyAbandonedOwnerRetirementReceipt({
    source: {
      path: source.lane.path,
      branch: source.branch,
      head: source.lane.head,
      treeSha: source.lane.treeSha,
      stateDigest: source.lane.stateDigest,
      remoteHeadSha: source.remoteHeadSha,
      pullRequestUrl: source.pullRequest.url,
      lease: source.lease,
    },
    cloud: {
      ledgerRepository: request.ledgerRepository,
      ledgerRevision: retired.ledgerRevision,
      ledgerDigest: retired.ledgerDigest,
      verificationReceiptDigest: cloud.verification.receiptDigest,
      sourceClaimId: claim?.claimId || source.lease.cloudAuthority.claimId,
      sourceClaimState: retired.sourceClaimState || "dormant-preserved",
      reviewRequestId: claim?.reviewRequestId || source.lease.cloudAuthority.reviewRequestId,
      sourceClaimAbsent: true,
      retirementReceiptDigest: retired.retirementReceiptDigest,
    },
    provider: {
      url: closed.url,
      number: closed.number,
      state: closed.state,
      draft: closed.draft,
      mergedAt: null,
      closedAt: closed.closedAt,
      headBranch: closed.headBranch,
      headSha: closed.headSha,
      baseBranch: closed.baseBranch,
      baseSha: closed.baseSha,
      bodyDigest: digestValue(closed.body),
    },
    retiredAt,
  });
  const releasedLease = adapter.releaseLease({
    sessionId: source.lease.sessionId,
    branch: source.branch,
    expectedLease: source.lease,
    timestamp: retiredAt,
    values: {
      admission: null,
      cloudAuthority: null,
      admissionOwnerRetirement: receipt,
    },
  });
  const finalSnapshot = adapter.capture();
  if (
    digestValue(finalSnapshot.lease) !== digestValue(releasedLease)
    || !isRetiredAdmittedEmptyAbandonedOwnerLane({ lane: finalSnapshot.lane })
  ) {
    throw new Error("Released lane did not satisfy admitted empty-owner retired-preserved invariants.");
  }
  return Object.freeze({
    schema: ADMITTED_EMPTY_ABANDONED_OWNER_RETIREMENT_RESULT_SCHEMA,
    ok: true,
    status: "retired-preserved",
    replayed: false,
    sourceHead: source.lane.head,
    sourceBranch: source.branch,
    receiptDigest: receipt.receiptDigest,
    cleanupEligible: false,
  });
}

function replayReleased({ request, snapshot, adapter }) {
  const receipt = normalizeAdmittedEmptyAbandonedOwnerRetirementReceipt(
    snapshot.lease.admissionOwnerRetirement,
  );
  if (
    receipt.source.worktreePath !== request.repository
    || receipt.source.branch !== request.branch
    || receipt.source.headSha !== request.expectedHead
    || receipt.source.pullRequestUrl !== request.expectedPullRequestUrl
  ) {
    throw new Error("Released admitted owner does not match the requested source.");
  }
  if (!isRetiredAdmittedEmptyAbandonedOwnerLane({ lane: snapshot.lane, lease: snapshot.lease })) {
    throw new Error("Released admitted owner has invalid retired-preserved evidence.");
  }
  const after = adapter.inspectCloudClaim({ source: snapshot, request, allowMissing: true });
  if (after.claim !== null) {
    throw new Error("Released admitted owner still has live cloud authority.");
  }
  if (
    snapshot.pullRequest.state !== "CLOSED"
    || snapshot.pullRequest.merged
    || digestValue(snapshot.pullRequest.body) !== receipt.provider.bodyDigest
  ) {
    throw new Error("Released admitted owner pull request drifted from its retirement receipt.");
  }
  return Object.freeze({
    schema: ADMITTED_EMPTY_ABANDONED_OWNER_RETIREMENT_RESULT_SCHEMA,
    ok: true,
    status: "retired-preserved",
    replayed: true,
    sourceHead: receipt.source.headSha,
    sourceBranch: receipt.source.branch,
    receiptDigest: receipt.receiptDigest,
    cleanupEligible: false,
  });
}

function requireAdapter(value) {
  if (!value || typeof value !== "object") {
    throw new Error("Retirement adapter is required.");
  }
  for (const name of [
    "capture",
    "inspectCloudClaim",
    "now",
    "closePullRequest",
    "requireClosedPullRequest",
    "requireMissingClaimClosure",
    "retireClaim",
    "releaseLease",
  ]) {
    if (typeof value[name] !== "function") throw new Error(`Retirement adapter requires ${name}().`);
  }
  return value;
}
