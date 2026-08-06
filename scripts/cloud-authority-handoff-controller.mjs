#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";

import { readOwnershipPullRequest } from "./device-pull-request-state.mjs";
import { invokeRepositoryCloudVerifier } from "./cloud-collaboration-delivery-verifier.mjs";
import { pseudonymousIdentifier } from "./github-cloud-collaboration-mapping.mjs";
import {
  continueClaimedReviewSuccessorCloudAuthority,
  invokeRepositoryCloudAction,
  reviewReadyAdmissionCloudAuthority,
} from "./scoped-lane-cloud-authority.mjs";
import { digestValue, normalizeWriteSet, writeSetsOverlap } from "./cloud-collaboration-primitives.mjs";
import { verifyProtectedMainRefreshChain } from "./protected-main-refresh-lib.mjs";
import { normalizeBoundAuthority } from "./scoped-lane-cloud-reconciliation.mjs";
import {
  createWriterLeaseStore,
  parseDeviceBranch,
  parseWriterLeasePullRequestBody,
  updateWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";

export const CLOUD_AUTHORITY_HANDOFF_CONTROLLER_RESULT_SCHEMA = "agentic-cloud-authority-handoff-controller-result/v1";
export const CLOUD_AUTHORITY_HANDOFF_RECEIPT_SCHEMA = "agentic-cloud-authority-handoff-receipt/v1";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const TRANSITIONS = new Set(["retain", "reclaim", "handoff"]);
export function createCloudAuthorityHandoffControllerAdapter(methods = {}) {
  const adapter = Object.freeze({
    readPreservedReviewLane: methods.readPreservedReviewLane,
    readAuthenticatedOwner: methods.readAuthenticatedOwner,
    readCloudStatus: methods.readCloudStatus,
    claimSuccessor: methods.claimSuccessor,
    bindAndReviewReady: methods.bindAndReviewReady,
    persistReviewProjection: methods.persistReviewProjection,
  });
  for (const key of Object.keys(adapter)) {
    if (typeof adapter[key] !== "function") {
      throw new Error(`Controller adapter method ${key} must be a function.`);
    }
  }
  return adapter;
}
export async function continueExpiredReviewLaneAuthority(input, { adapter } = {}) {
  const request = normalizeRequest(input);
  const lane = await adapter.readPreservedReviewLane({ branch: request.branch });
  const actor = await adapter.readAuthenticatedOwner();
  const status = await adapter.readCloudStatus({
    ledgerRepository: lane.authority.ledgerRepository,
    targetRepository: lane.authority.targetRepository,
  });
  const successor = classifyResumableSuccessor({ request, lane, actor, status });
  const findings = validateContinuation({ request, lane, actor, status, successor });
  const preflightReceipt = buildReceipt("preflight", {
    branch: lane.branch,
    transition: request.transition,
    repository: lane.repository,
    baseSha: lane.baseSha,
    headSha: lane.headSha,
    reviewRequestId: lane.authority.reviewRequestId,
    predecessorClaimId: lane.authority.claimId,
    predecessorLeaseEpoch: lane.authority.leaseEpoch,
    successorDeviceId: request.successorDeviceId,
    successorSessionId: request.successorSessionId,
    resumableSuccessorClaimId: successor.claim?.claimId || null,
    actorLogin: actor.login,
    blockingFindingDigest: digestValue(findings),
  });
  if (findings.length > 0) {
    return finalizeResult({
      request,
      lane,
      outcome: "blocked",
      actor,
      blockingFindings: findings,
      receipts: [preflightReceipt],
    });
  }
  if (request.transition === "retain") {
    return finalizeResult({
      request,
      lane,
      outcome: "retained-legacy",
      actor,
      receipts: [preflightReceipt],
    });
  }

  const claimResult = await adapter.claimSuccessor({ request, lane });
  assertResumableSuccessorReplay({ claimResult, resumableSuccessor: successor.claim, lane });
  const claimAuthority = projectSuccessorClaimAuthority({
    result: claimResult,
    lane,
    successorDeviceId: request.successorDeviceId,
    successorSessionId: request.successorSessionId,
  });
  const ready = await adapter.bindAndReviewReady({
    request,
    lane,
    authority: claimAuthority,
    claimResult,
    resumableSuccessor: successor.claim,
  });
  const projectLocal = (
    request.transition === "reclaim"
    && request.successorDeviceId === lane.lease.device
    && request.successorSessionId === lane.lease.sessionId
  );
  const projectionReceipt = projectLocal
    ? await adapter.persistReviewProjection({
      request,
      lane,
      authority: ready.authority,
    })
    : null;
  const continuationReceipt = buildReceipt("continuation", {
    branch: lane.branch,
    transition: request.transition,
    predecessorClaimId: lane.authority.claimId,
    predecessorLeaseEpoch: lane.authority.leaseEpoch,
    successorClaimId: ready.authority.claimId,
    successorLeaseEpoch: ready.authority.leaseEpoch,
    reviewRequestId: ready.authority.reviewRequestId,
    projectionUpdated: projectLocal,
    claimReceiptDigest: requiredDigest(
      claimResult.receipt?.receiptDigest,
      "claim receipt digest",
    ),
    reviewReadyReceiptDigest: requiredDigest(
      ready.verification.receiptDigest,
      "review-ready receipt digest",
    ),
    projectionReceiptDigest: projectionReceipt?.receiptDigest || null,
  });

  return finalizeResult({
    request,
    lane,
    actor,
    outcome: request.transition === "reclaim" ? "reclaimed-live" : "handed-off-live",
    authority: ready.authority,
    receipts: [preflightReceipt, continuationReceipt, ...(projectionReceipt ? [projectionReceipt] : [])],
    projectionUpdated: projectLocal,
  });
}
export function createRepositoryCloudAuthorityHandoffControllerAdapter({
  repository,
  sessionId,
  environment = process.env,
  gitText = args => execFileSync("git", args, { cwd: repository, encoding: "utf8" }),
  ghText = args => execFileSync("gh", args, { cwd: repository, encoding: "utf8" }),
  run = (command, args) => execFileSync(command, args, { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
  leaseStore = createWriterLeaseStore({
    gitCommonDir: path.resolve(repository, gitText(["rev-parse", "--git-common-dir"]).trim()),
  }),
} = {}) {
  const repoRoot = path.resolve(requiredText(repository, "repository"));

  return createCloudAuthorityHandoffControllerAdapter({
    readPreservedReviewLane({ branch }) {
      run("git", ["fetch", "origin", "main", branch]);
      const currentBranch = requiredText(gitText(["branch", "--show-current"]).trim(), "current branch");
      if (branch !== currentBranch) {
        throw new Error(`Controller requires ${branch} checked out; received ${currentBranch}.`);
      }
      const lease = leaseStore.read(branch);
      if (!lease) throw new Error(`No writer lease records ${branch}.`);
      const pullRequest = readOwnershipPullRequest({
        url: requiredText(lease.pullRequestUrl, "pullRequestUrl"),
        branch,
        ghText: args => ghText(args),
      });
      const pullWithAuthor = JSON.parse(ghText([
        "pr",
        "view",
        pullRequest.url,
        "--json",
        "author,url,state,isDraft,headRefName,headRefOid,baseRefName,body",
      ]));
      const remoteLease = parseWriterLeasePullRequestBody(pullWithAuthor.body);
      const admission = normalizeManifestFromLease(lease.admission);
      const authority = normalizePreservedAuthority(lease.cloudAuthority, admission);
      const reviewHeadSha = requiredSha(lease.reviewHeadSha, "lease reviewHeadSha");
      const localHeadSha = requiredSha(gitText(["rev-parse", "HEAD"]).trim(), "local HEAD");
      const remoteHeadSha = requiredSha(gitText(["rev-parse", `origin/${branch}`]).trim(), "remote HEAD");
      const pullRequestHeadSha = requiredSha(pullWithAuthor.headRefOid, "pull request head");
      const protectedMainRefresh = detectProtectedMainRefresh({
        reviewedHeadSha: reviewHeadSha,
        localHeadSha,
        remoteHeadSha,
        pullRequestHeadSha,
        gitText,
      });
      return Object.freeze({
        repository: repoRoot,
        branch,
        headSha: reviewHeadSha,
        refreshedHeadSha: protectedMainRefresh ? localHeadSha : null,
        remoteHeadSha,
        clean: gitText(["status", "--porcelain"]).trim() === "",
        baseSha: requiredSha(lease.baseSha, "lease baseSha"),
        lease,
        manifest: admission,
        authority,
        protectedMainRefresh,
        pullRequest: Object.freeze({
          url: pullWithAuthor.url,
          state: pullWithAuthor.state,
          isDraft: pullWithAuthor.isDraft,
          headRefName: pullWithAuthor.headRefName,
          headRefOid: pullRequestHeadSha,
          baseRefName: pullWithAuthor.baseRefName,
          body: pullWithAuthor.body,
          authorLogin: requiredText(pullWithAuthor.author?.login, "pull request author"),
        }),
        remoteLease,
      });
    },

    readAuthenticatedOwner() {
      const user = JSON.parse(ghText(["api", "user"]));
      return Object.freeze({
        id: Number(user.id),
        login: requiredText(user.login, "authenticated login"),
      });
    },

    readCloudStatus({ ledgerRepository, targetRepository }) {
      return invokeRepositoryCloudAction({
        action: "status",
        ledgerRepository,
        request: { targetRepository },
        environment,
      });
    },

    claimSuccessor({ request, lane }) {
      return invokeRepositoryCloudAction({
        action: "claim",
        ledgerRepository: lane.authority.ledgerRepository,
        request: {
          targetRepository: lane.authority.targetRepository,
          workItemId: lane.lease.scope,
          canonicalBaseSha: lane.baseSha,
          headSha: lane.headSha,
          declaredWriteSet: lane.manifest.declaredWriteSet,
          predecessorClaimId: lane.authority.claimId,
          leaseEpoch: lane.authority.leaseEpoch + 1,
          ttlSeconds: request.ttlSeconds,
          deviceId: request.successorDeviceId,
          sessionId: request.successorSessionId,
          idempotencyKey: [
            "cloud-authority-continuation",
            request.transition,
            lane.authority.claimId,
            lane.headSha,
            lane.authority.reviewRequestId,
            request.successorDeviceId,
            request.successorSessionId,
          ].join(":"),
        },
        environment,
      });
    },

    bindAndReviewReady({ request, lane, authority, claimResult, resumableSuccessor }) {
      const pullRequestNumberValue = lane.protectedMainRefresh
        ? null
        : pullRequestNumber(lane.pullRequest.url);
      const continued = continueClaimedReviewSuccessorCloudAuthority({
        authority,
        claimResult,
        observedClaim: resumableSuccessor || claimResult.claim,
        manifest: lane.manifest,
        branch: lane.branch,
        headSha: lane.headSha,
        pullRequestNumber: pullRequestNumberValue,
        reviewRequestId: lane.authority.reviewRequestId,
        focusedEvidenceDigest: lane.authority.focusedEvidenceDigest,
        ttlSeconds: request.ttlSeconds,
        deviceId: request.successorDeviceId,
        sessionId: request.successorSessionId,
        environment,
        invoke: invokeRepositoryCloudAction,
        inspect: invokeRepositoryCloudAction,
        verify: invokeRepositoryCloudVerifier,
      });
      const currentAuthority = continued.authority;
      if (lane.protectedMainRefresh) {
        return reviewReadyAdmissionCloudAuthority({
          authority: currentAuthority,
          manifest: lane.manifest,
          branch: lane.branch,
          headSha: lane.headSha,
          reviewRequestId: lane.authority.reviewRequestId,
          focusedEvidenceDigest: lane.authority.focusedEvidenceDigest,
          deviceId: request.successorDeviceId,
          sessionId: request.successorSessionId,
          environment,
          invoke: invokeRepositoryCloudAction,
          inspect: invokeRepositoryCloudAction,
          verify: invokeRepositoryCloudVerifier,
        });
      }
      return reviewReadyAdmissionCloudAuthority({
        authority: currentAuthority,
        manifest: lane.manifest,
        branch: lane.branch,
        headSha: lane.headSha,
        pullRequestNumber: pullRequestNumber(lane.pullRequest.url),
        deviceId: request.successorDeviceId,
        sessionId: request.successorSessionId,
        environment,
        invoke: invokeRepositoryCloudAction,
        inspect: invokeRepositoryCloudAction,
        verify: invokeRepositoryCloudVerifier,
      });
    },

    persistReviewProjection({ lane, authority }) {
      const updatedLease = leaseStore.release({
        sessionId,
        branch: lane.branch,
        status: "review_ready",
        timestamp: authority.expiresAt,
        values: {
          reviewHeadSha: lane.headSha,
          cloudAuthority: authority,
        },
      });
      if (updatedLease.status !== "review_ready"
        || updatedLease.heartbeatAt !== authority.expiresAt || updatedLease.expiresAt !== authority.expiresAt
        || updatedLease.cloudAuthority?.claimId !== authority.claimId) {
        throw new Error("Local review-ready projection did not preserve exact cloud expiry and authority.");
      }
      run("gh", [
        "pr", "edit", lane.pullRequest.url,
        "--body", updateWriterLeasePullRequestBody(lane.pullRequest.body, updatedLease),
      ]);
      const verifiedPull = readOwnershipPullRequest({
        url: lane.pullRequest.url,
        branch: lane.branch,
        ghText: args => ghText(args),
      });
      const verifiedLease = parseWriterLeasePullRequestBody(verifiedPull.body);
      if (
        !verifiedLease
        || verifiedLease.reviewHeadSha !== lane.headSha
        || verifiedLease.cloudAuthority?.claimId !== authority.claimId
      ) {
        throw new Error("Updated pull request body did not preserve the exact review-ready projection.");
      }
      return buildReceipt("projection", {
        branch: lane.branch,
        pullRequestUrl: lane.pullRequest.url,
        reviewHeadSha: lane.headSha,
        successorClaimId: authority.claimId,
        successorLeaseEpoch: authority.leaseEpoch,
        reviewRequestId: authority.reviewRequestId,
      });
    },
  });
}
function classifyResumableSuccessor({ request, lane, actor, status }) {
  if (
    request.transition === "retain"
    || status?.schema !== "agentic-cloud-collaboration-result/v1"
    || status.ok !== true
    || status.action !== "status"
    || status.status !== "ready"
    || !Array.isArray(status.claims)
  ) {
    return Object.freeze({ claim: null, ambiguousClaimIds: Object.freeze([]) });
  }
  const actorId = Number.isSafeInteger(Number(actor.id)) && Number(actor.id) > 0
    ? `github-user:${Number(actor.id)}`
    : null;
  const expectedWorkItemId = pseudonymousIdentifier("work-item", lane.lease.scope);
  const expectedWriteSet = normalizeWriteSet(lane.manifest.declaredWriteSet);
  const matches = status.claims.filter(claim => {
    try {
      const state = resumableSuccessorState(claim.state);
      const reviewRequestId = claim.reviewRequestId || null;
      const reviewIdentityMatches = state === "review_ready"
        ? reviewRequestId === lane.authority.reviewRequestId
        : reviewRequestId === null || reviewRequestId === lane.authority.reviewRequestId;
      return Boolean(
        actorId
        && DIGEST_PATTERN.test(String(claim.claimId || ""))
        && claim.claimId !== lane.authority.claimId
        && claim.actorId === actorId
        && claim.workItemId === expectedWorkItemId
        && claim.predecessorClaimId === lane.authority.claimId
        && claim.canonicalBaseRevision === lane.baseSha
        && claim.laneRevision === lane.headSha
        && claim.writeSetDigest === lane.manifest.writeSetDigest
        && JSON.stringify(normalizeWriteSet(claim.declaredWriteScope)) === JSON.stringify(expectedWriteSet)
        && claim.leaseEpoch === lane.authority.leaseEpoch + 1
        && state
        && reviewIdentityMatches
      );
    } catch {
      return false;
    }
  }).sort((left, right) => left.claimId.localeCompare(right.claimId));
  if (matches.length === 1) {
    return Object.freeze({ claim: matches[0], ambiguousClaimIds: Object.freeze([]) });
  }
  return Object.freeze({
    claim: null,
    ambiguousClaimIds: Object.freeze(matches.map(claim => claim.claimId)),
  });
}
function resumableSuccessorState(value) {
  const state = String(value || "").trim().replaceAll("_", "-");
  if (state === "waiting-successor") return "waiting_successor";
  if (["current", "active"].includes(state)) return "active";
  if (["reviewed", "review-ready"].includes(state)) return "review_ready";
  return null;
}
function assertResumableSuccessorReplay({ claimResult, resumableSuccessor, lane }) {
  if (!resumableSuccessor) return;
  const claim = claimResult?.claim;
  let writeSetMatches = false;
  try {
    writeSetMatches = JSON.stringify(normalizeWriteSet(claim?.declaredWriteScope))
      === JSON.stringify(normalizeWriteSet(resumableSuccessor.declaredWriteScope));
  } catch {
    writeSetMatches = false;
  }
  if (
    claimResult?.schema !== "agentic-cloud-collaboration-result/v1"
    || claimResult.ok !== true
    || claimResult.action !== "claim"
    || claimResult.replayed !== true
    || claim?.claimId !== resumableSuccessor.claimId
    || claim?.actorId !== resumableSuccessor.actorId
    || claim?.repositoryId !== resumableSuccessor.repositoryId
    || claim?.workItemId !== resumableSuccessor.workItemId
    || claim?.predecessorClaimId !== lane.authority.claimId
    || claim?.canonicalBaseRevision !== lane.baseSha
    || claim?.laneRevision !== lane.headSha
    || claim?.writeSetDigest !== lane.manifest.writeSetDigest
    || claim?.leaseEpoch !== lane.authority.leaseEpoch + 1
    || !writeSetMatches
  ) {
    throw new Error("Cloud claim replay did not preserve the exact resumable successor identity.");
  }
}
function validateContinuation({ request, lane, actor, status, successor }) {
  const findings = [];
  const identity = parseDeviceBranch(lane.branch);
  if (!identity) findings.push(finding("invalid-branch-identity"));
  if (!lane.clean) findings.push(finding("dirty-preserved-lane"));
  if (lane.lease.status !== "review_ready") findings.push(finding("lane-not-review-ready"));
  if (lane.pullRequest.state !== "OPEN" || lane.pullRequest.isDraft) {
    findings.push(finding("review-projection-not-ready"));
  }
  if (lane.pullRequest.baseRefName !== "main") findings.push(finding("pull-request-base-drift"));
  const expectedHead = requiredSha(lane.lease.reviewHeadSha, "lease reviewHeadSha");
  const exactHeadParity = (
    lane.headSha === expectedHead
    && lane.remoteHeadSha === expectedHead
    && lane.pullRequest.headRefOid === expectedHead
    && lane.authority.laneRevision === expectedHead
  );
  const protectedRefreshParity = (
    lane.headSha === expectedHead
    && lane.authority.laneRevision === expectedHead
    && lane.protectedMainRefresh
    && lane.refreshedHeadSha === lane.remoteHeadSha
    && lane.refreshedHeadSha === lane.pullRequest.headRefOid
  );
  if (
    !exactHeadParity
    && !protectedRefreshParity
  ) {
    findings.push(finding("exact-head-drift"));
  }
  if (!lane.remoteLease) findings.push(finding("missing-authoritative-owner-marker"));
  if (lane.remoteLease && (
    lane.remoteLease.branch !== lane.lease.branch
    || lane.remoteLease.baseSha !== lane.lease.baseSha
    || lane.remoteLease.scope !== lane.lease.scope
    || lane.remoteLease.reviewHeadSha !== lane.lease.reviewHeadSha
    || lane.remoteLease.cloudAuthority?.claimId !== lane.authority.claimId
  )) {
    findings.push(finding("owner-marker-drift"));
  }
  if (lane.authority.state !== "review_ready") findings.push(finding("legacy-authority-not-review-ready"));
  if (Date.parse(lane.authority.expiresAt) > Date.now()) findings.push(finding("legacy-authority-still-live"));
  if (lane.pullRequest.authorLogin !== actor.login) findings.push(finding("authenticated-owner-mismatch"));
  if (request.transition === "handoff" && request.successorSessionId === lane.lease.sessionId && request.successorDeviceId === lane.lease.device) {
    findings.push(finding("handoff-recipient-not-distinct"));
  }
  if (
    !status
    || status.schema !== "agentic-cloud-collaboration-result/v1"
    || status.ok !== true
    || status.action !== "status"
    || status.status !== "ready"
    || !Array.isArray(status.claims)
  ) {
    findings.push(finding("cloud-status-unavailable"));
    return findings.sort(compareFindings);
  }
  if (successor.ambiguousClaimIds.length > 0) {
    findings.push(finding("ambiguous-successor-continuation", {
      competingClaimIds: successor.ambiguousClaimIds,
    }));
  }
  const excludedClaimIds = new Set([
    lane.authority.claimId,
    ...(successor.claim ? [successor.claim.claimId] : []),
  ]);
  const otherClaims = status.claims.filter(
    claim => !excludedClaimIds.has(claim.claimId),
  );
  const overlaps = otherClaims.filter(claim => {
    try {
      return writeSetsOverlap(claim.declaredWriteScope, lane.manifest.declaredWriteSet);
    } catch {
      return true;
    }
  });
  if (overlaps.length > 0) {
    findings.push(finding("competing-live-claim", {
      competingClaimIds: overlaps.map(claim => claim.claimId).sort(),
    }));
  }
  if (otherClaims.some(claim => claim.reviewRequestId === lane.authority.reviewRequestId)) {
    findings.push(finding("review-request-already-live"));
  }
  return findings.sort(compareFindings);
}
function normalizeRequest(input = {}) {
  const transition = requiredTransition(input.transition || input.action || "reclaim");
  const branch = requiredText(input.branch, "branch");
  const sessionId = requiredText(input.sessionId, "sessionId");
  const ttlSeconds = positiveInteger(input.ttlSeconds ?? 1800, "ttlSeconds");
  const successorSessionId = requiredText(
    input.successorSessionId || sessionId,
    "successorSessionId",
  );
  const successorDeviceId = requiredText(
    input.successorDeviceId || input.deviceId,
    "successorDeviceId",
  );
  return Object.freeze({
    transition,
    branch,
    sessionId,
    ttlSeconds,
    successorSessionId,
    successorDeviceId,
  });
}
function normalizeManifestFromLease(admission) {
  if (!admission || admission.status !== "admitted") {
    throw new Error("Controller requires an admitted lane manifest.");
  }
  const declaredWriteSet = normalizeWriteSet(admission.declaredWriteSet);
  return Object.freeze({
    declaredWriteSet,
    writeSetDigest: requiredDigest(admission.writeSetDigest, "admission writeSetDigest"),
    admittedReportDigest: requiredDigest(admission.admittedReportDigest, "admittedReportDigest"),
    manifestDigest: requiredDigest(admission.manifestDigest, "manifestDigest"),
  });
}
function detectProtectedMainRefresh({
  reviewedHeadSha,
  localHeadSha,
  remoteHeadSha,
  pullRequestHeadSha,
  gitText,
}) {
  if (
    localHeadSha === reviewedHeadSha
    || localHeadSha !== remoteHeadSha
    || localHeadSha !== pullRequestHeadSha
  ) {
    return null;
  }
  try {
    return verifyProtectedMainRefreshChain({
      expectedHeadSha: reviewedHeadSha,
      observedHeadSha: localHeadSha,
      gitText,
    });
  } catch {
    return null;
  }
}
function normalizePreservedAuthority(authority, manifest) {
  if (!authority || authority.state !== "review_ready") {
    throw new Error("Controller requires an expired review-ready cloud authority.");
  }
  if (requiredDigest(authority.writeSetDigest, "authority writeSetDigest") !== manifest.writeSetDigest) {
    throw new Error("Authority write-set digest drifted from its admitted manifest.");
  }
  return Object.freeze({
    ...authority,
    claimId: requiredDigest(authority.claimId, "claimId"),
    claimDigest: requiredDigest(authority.claimDigest, "claimDigest"),
    claimLedgerRevision: requiredDigest(authority.claimLedgerRevision, "claimLedgerRevision"),
    ledgerRevision: requiredSha(authority.ledgerRevision, "ledgerRevision"),
    canonicalBaseSha: requiredSha(authority.canonicalBaseSha, "canonicalBaseSha"),
    laneRevision: requiredSha(authority.laneRevision, "laneRevision"),
    leaseEpoch: positiveInteger(authority.leaseEpoch, "leaseEpoch"),
    transitionCounter: positiveInteger(authority.transitionCounter, "transitionCounter"),
    reviewRequestId: requiredText(authority.reviewRequestId, "reviewRequestId"),
    expiresAt: requiredText(authority.expiresAt, "expiresAt"),
    focusedEvidenceDigest: requiredDigest(authority.focusedEvidenceDigest, "focusedEvidenceDigest"),
    cloudDeclaredWriteScope: normalizeWriteSet(authority.cloudDeclaredWriteScope),
  });
}
function projectSuccessorClaimAuthority({
  result,
  lane,
  successorDeviceId,
  successorSessionId,
}) {
  if (
    !result
    || result.schema !== "agentic-cloud-collaboration-result/v1"
    || result.ok !== true
    || result.action !== "claim"
  ) {
    throw new Error("Successor continuation requires a successful cloud claim result.");
  }
  return normalizeBoundAuthority({
    result: {
      ...result,
      ledgerDigest: requiredDigest(
        result.ledgerDigest || result.receipt?.ledgerDigest,
        "claim ledger digest",
      ),
    },
    authority: {
      ledgerRepository: lane.authority.ledgerRepository,
      targetRepository: lane.authority.targetRepository,
      deviceId: requiredText(successorDeviceId, "successorDeviceId"),
      sessionId: requiredText(successorSessionId, "successorSessionId"),
      focusedEvidenceDigest: lane.authority.focusedEvidenceDigest,
    },
    manifest: lane.manifest,
    deviceId: successorDeviceId,
    sessionId: successorSessionId,
    focusedEvidenceDigest: lane.authority.focusedEvidenceDigest,
  });
}
function finalizeResult({
  request,
  lane,
  actor,
  outcome,
  authority = null,
  receipts,
  blockingFindings = [],
  projectionUpdated = false,
}) {
  const result = {
    schema: CLOUD_AUTHORITY_HANDOFF_CONTROLLER_RESULT_SCHEMA,
    outcome,
    transition: request.transition,
    branch: lane.branch,
    pullRequestUrl: lane.pullRequest.url,
    canonicalBaseSha: lane.baseSha,
    reviewedHeadSha: lane.headSha,
    predecessorClaimId: lane.authority.claimId,
    predecessorLeaseEpoch: lane.authority.leaseEpoch,
    successorClaimId: authority?.claimId || null,
    successorLeaseEpoch: authority?.leaseEpoch || null,
    reviewRequestId: authority?.reviewRequestId || lane.authority.reviewRequestId,
    projectionUpdated,
    actorLogin: actor.login,
    blockingFindings,
    receipts,
  };
  return Object.freeze({
    ...result,
    resultDigest: digestValue(result),
  });
}
function buildReceipt(kind, payload) {
  const receipt = {
    schema: CLOUD_AUTHORITY_HANDOFF_RECEIPT_SCHEMA,
    kind,
    payload,
  };
  return Object.freeze({
    ...receipt,
    receiptDigest: digestValue(receipt),
  });
}
function finding(type, detail = {}) {
  return Object.freeze({ type, detail });
}
function compareFindings(left, right) {
  return digestValue(left).localeCompare(digestValue(right));
}
function requiredTransition(value) {
  const transition = requiredText(value, "transition");
  if (!TRANSITIONS.has(transition)) throw new Error(`Unsupported transition ${transition}.`);
  return transition;
}
function requiredText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}
function requiredSha(value, label) {
  const sha = requiredText(value, label);
  if (!SHA_PATTERN.test(sha)) throw new Error(`${label} must be a 40-character SHA.`);
  return sha;
}
function requiredDigest(value, label) {
  const digest = requiredText(value, label);
  if (!DIGEST_PATTERN.test(digest)) throw new Error(`${label} must be a SHA-256 digest.`);
  return digest;
}
function positiveInteger(value, label) {
  const integer = Number(value);
  if (!Number.isSafeInteger(integer) || integer < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return integer;
}
function pullRequestNumber(url) {
  const match = String(url || "").match(/\/pull\/(\d+)$/u);
  if (!match) throw new Error(`Pull request URL ${url} has no numeric identifier.`);
  return Number(match[1]);
}
function option(argumentsList, name) {
  const prefix = `--${name}=`;
  const inline = argumentsList.find(value => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = argumentsList.indexOf(`--${name}`);
  return index >= 0 ? argumentsList[index + 1] : "";
}
function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
function publicMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(?:ghp|github_pat)_[A-Za-z0-9_]+/gu, "[redacted]")
    .replace(/\/(?:Users|home)\/[^\s"']+/gu, "[local-path]");
}
async function main() {
  const [transition = "reclaim", ...argumentsList] = process.argv.slice(2);
  const json = argumentsList.includes("--json");
  try {
    const repository = path.resolve(
      option(argumentsList, "repository")
        || execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim(),
    );
    const branch = option(argumentsList, "branch")
      || execFileSync("git", ["branch", "--show-current"], { cwd: repository, encoding: "utf8" }).trim();
    const sessionId = option(argumentsList, "session");
    if (!sessionId) throw new Error("--session is required.");
    const adapter = createRepositoryCloudAuthorityHandoffControllerAdapter({
      repository,
      sessionId,
      environment: process.env,
    });
    const result = await continueExpiredReviewLaneAuthority({
      transition,
      branch,
      sessionId,
      successorSessionId: option(argumentsList, "successor-session") || sessionId,
      successorDeviceId: option(argumentsList, "successor-device")
        || option(argumentsList, "device-id")
        || parseDeviceBranch(branch)?.device,
      ttlSeconds: option(argumentsList, "ttl-seconds") || 1800,
    }, { adapter });
    emit(result);
    if (result.outcome === "blocked") process.exitCode = 1;
  } catch (error) {
    const result = {
      schema: CLOUD_AUTHORITY_HANDOFF_CONTROLLER_RESULT_SCHEMA,
      outcome: "blocked",
      transition: transition || null,
      error: { message: publicMessage(error) },
    };
    if (!json) throw error;
    emit(result);
    process.exitCode = 1;
  }
}
if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
