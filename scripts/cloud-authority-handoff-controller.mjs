#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";

import { readOwnershipPullRequest } from "./device-pull-request-state.mjs";
import { invokeRepositoryCloudVerifier } from "./cloud-collaboration-delivery-verifier.mjs";
import {
  DEFAULT_LEDGER_PATH,
  createGitHubCloudCollaborationAdapter,
} from "./github-cloud-collaboration-adapter.mjs";
import { validateLedger } from "./cloud-collaboration-contract.mjs";
import { invokeRepositoryCloudAction } from "./scoped-lane-cloud-authority.mjs";
import { digestValue, normalizeWriteSet, writeSetsOverlap } from "./cloud-collaboration-primitives.mjs";
import { verifyProtectedMainRefreshChain } from "./protected-main-refresh-lib.mjs";
import {
  createWriterLeaseStore,
  parseDeviceBranch,
  parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker,
  updateWriterLeasePullRequestBody,
  WRITER_LEASE_SCHEMA,
} from "./writer-lease-lib.mjs";

export const CLOUD_AUTHORITY_HANDOFF_CONTROLLER_RESULT_SCHEMA = "agentic-cloud-authority-handoff-controller-result/v1";
export const CLOUD_AUTHORITY_HANDOFF_RECEIPT_SCHEMA = "agentic-cloud-authority-handoff-receipt/v1";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const TRANSITIONS = new Set(["retain", "reclaim", "handoff"]);
const RECOVERY_JOIN_RETRY_DELAYS_MS = Object.freeze([250, 500, 1_000, 2_000]);
const PUBLIC_CLAIM_JOIN_FIELDS = Object.freeze([
  "claimId",
  "entrySchema",
  "claimIdentitySchema",
  "state",
  "writeAuthority",
  "scopeReserved",
  "actorId",
  "repositoryId",
  "workItemId",
  "canonicalBaseRevision",
  "laneRevision",
  "declaredWriteScope",
  "writeSetDigest",
  "leaseEpoch",
  "transitionCounter",
  "heartbeatCounter",
  "reviewRequestId",
  "predecessorClaimId",
  "expiresAt",
  "fenceRevision",
  "transitionDigest",
  "operationReceiptDigest",
  "integrationReceiptDigest",
  "integration",
]);
export function createCloudAuthorityHandoffControllerAdapter(methods = {}) {
  const adapter = Object.freeze({
    readPreservedReviewLane: methods.readPreservedReviewLane,
    readAuthenticatedOwner: methods.readAuthenticatedOwner,
    readCloudStatus: methods.readCloudStatus,
    recoverAuthority: methods.recoverAuthority,
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
    recoveryAnchor: Object.freeze({
      claimId: lane.authority.claimId,
      claimDigest: lane.authority.claimDigest,
      claimLedgerRevision: lane.authority.claimLedgerRevision,
      transitionCounter: lane.authority.transitionCounter,
    }),
  });
  const completedProjectionClaim = findCompletedProjectionClaim({ request, lane, status });
  let findings = validateContinuation({
    request,
    lane,
    actor,
    status,
    completedProjectionClaim,
  });
  let preflightReceipt = buildPreflightReceipt({ request, lane, actor, findings });
  const unprojectedRecoveryClaim = findings.length === 0
    ? findUnprojectedRecoveryClaim({ request, lane, status })
    : null;
  if (
    unprojectedRecoveryClaim
    && (
      !isExactRecoveryEvidence(
        unprojectedRecoveryClaim.recovery,
        preflightReceipt.receiptDigest,
      )
      || (
        requiresLocalRecoveryEvidence({ lane, predecessor: unprojectedRecoveryClaim })
        && !isExactRecoveryEvidence(
          lane.authority.recovery,
          preflightReceipt.receiptDigest,
        )
      )
      || !hasExactRecoveryLineage({
        status,
        lane,
        predecessor: unprojectedRecoveryClaim,
        request,
        recoveryEvidenceDigest: preflightReceipt.receiptDigest,
      })
    )
  ) {
    findings = [
      ...findings,
      finding("unprojected-recovery-evidence-drift"),
    ].sort(compareFindings);
    preflightReceipt = buildPreflightReceipt({ request, lane, actor, findings });
  }
  if (
    completedProjectionClaim
    && completedProjectionClaim.recovery?.evidenceDigest !== preflightReceipt.receiptDigest
  ) {
    findings = [
      ...findings,
      finding("completed-projection-recovery-evidence-drift"),
    ].sort(compareFindings);
    preflightReceipt = buildPreflightReceipt({ request, lane, actor, findings });
  }
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
  if (completedProjectionClaim) {
    const replayReceipt = buildReceipt("projection-replay", {
      branch: lane.branch,
      transition: request.transition,
      claimId: lane.authority.claimId,
      leaseEpoch: lane.authority.leaseEpoch,
      transitionCounter: lane.authority.transitionCounter,
      reviewRequestId: lane.authority.reviewRequestId,
      recoveryEvidenceDigest: preflightReceipt.receiptDigest,
      recoveryReceiptDigest: requiredDigest(
        completedProjectionClaim.operationReceiptDigest,
        "completed projection recovery receipt digest",
      ),
      projectionAlreadyCurrent: true,
    });
    return finalizeResult({
      request,
      lane,
      actor,
      outcome: "reclaimed-live-replay",
      authority: lane.authority,
      receipts: [preflightReceipt, replayReceipt],
      projectionUpdated: false,
    });
  }

  const predecessor = status.claims.find(
    claim => claim.claimId === lane.authority.claimId,
  );
  const recovered = await adapter.recoverAuthority({
    request,
    lane,
    predecessor,
    status,
    recoveryEvidenceDigest: preflightReceipt.receiptDigest,
  });
  const authority = requireRecoveredAuthority({
    recovered,
    request,
    lane,
    predecessor,
    recoveryEvidenceDigest: preflightReceipt.receiptDigest,
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
      authority,
    })
    : null;
  const continuationReceipt = buildReceipt("continuation", {
    branch: lane.branch,
    transition: request.transition,
    predecessorClaimId: lane.authority.claimId,
    predecessorLeaseEpoch: lane.authority.leaseEpoch,
    successorClaimId: authority.claimId,
    successorLeaseEpoch: authority.leaseEpoch,
    successorTransitionCounter: authority.transitionCounter,
    reviewRequestId: authority.reviewRequestId,
    projectionUpdated: projectLocal,
    recoveryEvidenceDigest: preflightReceipt.receiptDigest,
    recoveryReceiptDigest: requiredDigest(
      recovered.recoveryReceiptDigest,
      "recovery receipt digest",
    ),
    verificationReceiptDigest: requiredDigest(
      recovered.verificationReceiptDigest,
      "recovery verification receipt digest",
    ),
    projectionReceiptDigest: projectionReceipt?.receiptDigest || null,
  });

  return finalizeResult({
    request,
    lane,
    actor,
    outcome: request.transition === "reclaim" ? "reclaimed-live" : "handed-off-live",
    authority,
    receipts: [preflightReceipt, continuationReceipt, ...(projectionReceipt ? [projectionReceipt] : [])],
    projectionUpdated: projectLocal,
  });
}
export function createRepositoryCloudAuthorityHandoffControllerAdapter({
  repository,
  sessionId,
  environment = process.env,
  now = () => new Date(),
  createCloudAdapter = createGitHubCloudCollaborationAdapter,
  invokeCloudAction = invokeRepositoryCloudAction,
  invokeCloudVerifier = invokeRepositoryCloudVerifier,
  gitText = args => execFileSync("git", args, { cwd: repository, encoding: "utf8" }),
  ghText = args => execFileSync("gh", args, {
    cwd: repository,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  }),
  run = (command, args) => execFileSync(command, args, { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
  waitForCloudVisibility = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
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

    async readCloudStatus({ ledgerRepository, targetRepository, recoveryAnchor = null }) {
      const cloud = createCloudAdapter({ ledgerRepository });
      const status = await cloud.execute("status", { targetRepository });
      const claims = await cloud.listClaims({ targetRepository });
      const enrichedClaims = status.claims.map(claim => {
        const matches = claims.filter(candidate => (
          candidate.claimId === claim.claimId
          && candidate.fenceRevision === claim.fenceRevision
          && candidate.ledgerRevision === claim.transitionDigest
        ));
        if (matches.length !== 1) {
          throw new Error("Cloud status changed while resolving exact recovery-owner evidence.");
        }
        return Object.freeze({
          ...claim,
          deviceId: requiredText(matches[0].deviceId, "cloud claim deviceId"),
          sessionId: requiredText(matches[0].sessionId, "cloud claim sessionId"),
          ...(matches[0].recovery ? {
            recovery: Object.freeze({
              evidenceDigest: matches[0].recovery.evidenceDigest,
              recoveredAt: matches[0].recovery.recoveredAt,
            }),
          } : {}),
        });
      });
      const anchoredClaims = recoveryAnchor
        ? enrichedClaims.filter(claim => claim.claimId === recoveryAnchor.claimId)
        : [];
      const recoveryLineage = (
        anchoredClaims.length === 1
        && anchoredClaims[0].transitionCounter > recoveryAnchor.transitionCounter + 1
      ) ? readGitHubRecoveryLineage({
          ghText,
          ledgerRepository,
          ledgerRevision: status.ledgerRevision,
          ledgerDigest: status.ledgerDigest,
          claimId: recoveryAnchor.claimId,
        })
        : null;
      return Object.freeze({
        ...status,
        claims: enrichedClaims,
        ...(recoveryLineage ? { recoveryLineage } : {}),
      });
    },

    async recoverAuthority({ request, lane, predecessor, status, recoveryEvidenceDigest }) {
      const expectedTransitionCounter = recoveredTransitionCounter(predecessor);
      const exactRecoveryEvidenceDigest = requiredDigest(
        recoveryEvidenceDigest,
        "recovery evidence digest",
      );
      const cloud = createCloudAdapter({
        ledgerRepository: lane.authority.ledgerRepository,
      });
      let recoveredClaimDigest = predecessor.fenceRevision;
      let recoveredTransitionDigest = predecessor.transitionDigest;
      let recoveryReceiptDigest = predecessor.operationReceiptDigest || null;
      let recoveredLedgerRevision = requiredSha(
        status.ledgerRevision,
        "status ledger revision",
      );
      const unprojectedRecovery = (
        predecessor.transitionCounter !== lane.authority.transitionCounter
      );
      if (
        unprojectedRecovery
        && (
          !hasSharedRecoveryIdentity({ lane, predecessor })
          || !isUnprojectedRecoveryClaim({ request, lane, predecessor })
          || !hasExactRecoveryLineage({
            status,
            lane,
            predecessor,
            request,
            recoveryEvidenceDigest: exactRecoveryEvidenceDigest,
          })
          || (
            requiresLocalRecoveryEvidence({ lane, predecessor })
            && !isExactRecoveryEvidence(
              lane.authority.recovery,
              exactRecoveryEvidenceDigest,
            )
          )
        )
      ) {
        throw new Error(
          "Unprojected cloud recovery did not match the exact controller continuation lineage.",
        );
      }
      if (predecessor.state === "dormant-preserved") {
        if (
          unprojectedRecovery
          && !isExactRecoveryEvidence(predecessor.recovery, exactRecoveryEvidenceDigest)
        ) {
          throw new Error(
            "Dormant replay recovery did not match the exact unprojected controller continuation.",
          );
        }
        const continuedResult = invokeCloudAction({
          action: "continue",
          ledgerRepository: lane.authority.ledgerRepository,
          request: {
            targetRepository: lane.authority.targetRepository,
            claimId: predecessor.claimId,
            expectedClaimDigest: predecessor.fenceRevision,
            expectedTransitionCounter: predecessor.transitionCounter,
            expectedLedgerDigest: requiredDigest(status.ledgerDigest, "status ledger digest"),
            mode: "recovery",
            ttlSeconds: request.ttlSeconds,
            deviceId: request.successorDeviceId,
            sessionId: request.successorSessionId,
            recoveryEvidenceDigest: exactRecoveryEvidenceDigest,
            idempotencyKey: [
              "cloud-authority-recovery",
              request.transition,
              predecessor.claimId,
              predecessor.fenceRevision,
              predecessor.transitionCounter,
              lane.headSha,
              lane.authority.reviewRequestId,
              request.successorDeviceId,
              request.successorSessionId,
              exactRecoveryEvidenceDigest,
            ].join(":"),
          },
          environment,
        });
        const continued = await joinExactRecoveryClaim({
          result: continuedResult,
          cloud,
          targetRepository: lane.authority.targetRepository,
          waitForCloudVisibility,
        });
        validateRecoveredCloudResult({
          result: continued,
          lane,
          predecessor,
          request,
          expectedAction: "continue",
          expectedTransitionCounter,
          recoveryEvidenceDigest: exactRecoveryEvidenceDigest,
        });
        recoveredClaimDigest = continued.claimDigest;
        recoveredTransitionDigest = continued.claim?.transitionDigest;
        recoveryReceiptDigest = continued.claim?.operationReceiptDigest;
        recoveredLedgerRevision = requiredSha(
          continued.ledgerRevision,
          "continued ledger revision",
        );
      } else {
        requireExactRecoveryEvidence({
          recovery: predecessor.recovery,
          recoveryEvidenceDigest: exactRecoveryEvidenceDigest,
          label: "replayed cloud claim",
        });
      }
      const verificationResult = invokeCloudVerifier({
        ledgerRepository: lane.authority.ledgerRepository,
        request: {
          targetRepository: lane.authority.targetRepository,
          claimId: predecessor.claimId,
          canonicalBaseSha: lane.baseSha,
          headSha: lane.headSha,
          reviewRequestId: lane.authority.reviewRequestId,
          writeSetDigest: lane.manifest.writeSetDigest,
          leaseEpoch: predecessor.leaseEpoch,
          expectedClaimDigest: recoveredClaimDigest,
          expectedLedgerRevision: recoveredLedgerRevision,
          focusedEvidenceDigest: lane.authority.focusedEvidenceDigest,
          requireStatus: "reviewed",
        },
        environment,
      });
      const verification = await joinExactRecoveryClaim({
        result: verificationResult,
        cloud,
        targetRepository: lane.authority.targetRepository,
        waitForCloudVisibility,
      });
      validateRecoveredCloudResult({
        result: verification,
        lane,
        predecessor,
        request,
        expectedAction: "verify",
        expectedTransitionCounter,
        recoveryEvidenceDigest: exactRecoveryEvidenceDigest,
        expectedClaimDigest: recoveredClaimDigest,
        expectedTransitionDigest: recoveredTransitionDigest,
        expectedOperationReceiptDigest: recoveryReceiptDigest,
      });
      return Object.freeze({
        authority: projectRecoveredAuthority({
          result: verification,
          lane,
          request,
          recoveryEvidenceDigest: exactRecoveryEvidenceDigest,
        }),
        recoveryReceiptDigest: requiredDigest(
          recoveryReceiptDigest,
          "cloud recovery receipt digest",
        ),
        verificationReceiptDigest: requiredDigest(
          verification.receipt?.receiptDigest,
          "cloud recovery verification receipt digest",
        ),
      });
    },

    persistReviewProjection({ lane, authority }) {
      const projectionTimestamp = now().toISOString();
      const values = Object.freeze({
        reviewHeadSha: lane.headSha,
        cloudAuthority: authority,
      });
      const expectedLease = Object.freeze({
        ...lane.lease,
        ...values,
        schema: WRITER_LEASE_SCHEMA,
        status: "review_ready",
        heartbeatAt: projectionTimestamp,
        expiresAt: projectionTimestamp,
      });
      const expectedMarker = projectWriterLeasePullRequestMarker(expectedLease);
      const expectedMarkerDigest = digestValue(expectedMarker);
      const currentPull = readOwnershipPullRequest({
        url: lane.pullRequest.url,
        branch: lane.branch,
        ghText: args => ghText(args),
      });
      const currentLease = parseWriterLeasePullRequestBody(currentPull.body);
      const sourceMarkerDigest = digestValue(
        projectWriterLeasePullRequestMarker(lane.remoteLease),
      );
      if (!currentLease || digestValue(currentLease) !== sourceMarkerDigest) {
        throw new Error(
          "Pull-request owner marker changed after recovery preflight; refusing to overwrite concurrent state.",
        );
      }
      run("gh", [
        "pr", "edit", lane.pullRequest.url,
        "--body", updateWriterLeasePullRequestBody(currentPull.body, expectedLease),
      ]);
      const verifiedPull = readOwnershipPullRequest({
        url: lane.pullRequest.url,
        branch: lane.branch,
        ghText: args => ghText(args),
      });
      const verifiedLease = parseWriterLeasePullRequestBody(verifiedPull.body);
      if (
        !verifiedLease
        || digestValue(verifiedLease) !== expectedMarkerDigest
      ) {
        throw new Error("Updated pull request body did not preserve the exact review-ready projection.");
      }
      const updatedLease = leaseStore.release({
        sessionId,
        branch: lane.branch,
        status: "review_ready",
        expectedLease: lane.lease,
        timestamp: projectionTimestamp,
        values,
      });
      if (
        digestValue(projectWriterLeasePullRequestMarker(updatedLease))
        !== expectedMarkerDigest
      ) {
        throw new Error("Local writer lease did not preserve the exact review-ready projection.");
      }
      return buildReceipt("projection", {
        branch: lane.branch,
        pullRequestUrl: lane.pullRequest.url,
        reviewHeadSha: lane.headSha,
        recoveredClaimId: authority.claimId,
        recoveredLeaseEpoch: authority.leaseEpoch,
        reviewRequestId: authority.reviewRequestId,
        leaseMarkerDigest: expectedMarkerDigest,
      });
    },
  });
}

function findCompletedProjectionClaim({ request, lane, status }) {
  if (
    request.transition !== "reclaim"
    || request.successorDeviceId !== lane.lease.device
    || request.successorSessionId !== lane.lease.sessionId
    || lane.authority.state !== "review_ready"
    || !Array.isArray(status?.claims)
    || lane.remoteLease?.cloudAuthority?.claimId !== lane.authority.claimId
    || lane.remoteLease?.cloudAuthority?.claimDigest !== lane.authority.claimDigest
    || lane.remoteLease?.cloudAuthority?.claimLedgerRevision !== lane.authority.claimLedgerRevision
    || lane.remoteLease?.cloudAuthority?.transitionCounter !== lane.authority.transitionCounter
    || lane.remoteLease?.cloudAuthority?.deviceId !== lane.authority.deviceId
    || lane.remoteLease?.cloudAuthority?.sessionId !== lane.authority.sessionId
  ) return null;
  const matches = status.claims.filter(claim => claim.claimId === lane.authority.claimId);
  if (matches.length !== 1) return null;
  const claim = matches[0];
  let declaredWriteScope = null;
  try {
    declaredWriteScope = normalizeWriteSet(claim.declaredWriteScope);
  } catch {
    return null;
  }
  const exact = (
    claim.state === "reviewed"
    && claim.writeAuthority === false
    && claim.scopeReserved === true
    && claim.canonicalBaseRevision === lane.baseSha
    && claim.canonicalBaseRevision === lane.authority.canonicalBaseSha
    && claim.laneRevision === lane.headSha
    && claim.laneRevision === lane.authority.laneRevision
    && claim.writeSetDigest === lane.manifest.writeSetDigest
    && claim.writeSetDigest === lane.authority.writeSetDigest
    && JSON.stringify(declaredWriteScope) === JSON.stringify(lane.manifest.declaredWriteSet)
    && claim.leaseEpoch === lane.authority.leaseEpoch
    && claim.transitionCounter === lane.authority.transitionCounter
    && claim.reviewRequestId === lane.authority.reviewRequestId
    && claim.fenceRevision === lane.authority.claimDigest
    && claim.transitionDigest === lane.authority.claimLedgerRevision
    && DIGEST_PATTERN.test(String(claim.operationReceiptDigest || ""))
    && claim.deviceId === ownerIdentifier("device", lane.authority.deviceId)
    && claim.sessionId === ownerIdentifier("session", lane.authority.sessionId)
    && claim.expiresAt === lane.authority.expiresAt
    && Date.parse(claim.expiresAt) > Date.now()
    && isExactRecoveryEvidence(
      claim.recovery,
      lane.authority.recovery?.evidenceDigest,
    )
    && claim.recovery.recoveredAt === lane.authority.recovery?.recoveredAt
  );
  return exact ? claim : null;
}

function validateContinuation({ request, lane, actor, status, completedProjectionClaim = null }) {
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
  if (
    Date.parse(lane.authority.expiresAt) > Date.now()
    && !completedProjectionClaim
  ) findings.push(finding("legacy-authority-still-live"));
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
    || !DIGEST_PATTERN.test(String(status.ledgerDigest || ""))
    || !Array.isArray(status.claims)
  ) {
    findings.push(finding("cloud-status-unavailable"));
    return findings.sort(compareFindings);
  }
  const predecessors = status.claims.filter(
    claim => claim.claimId === lane.authority.claimId,
  );
  if (predecessors.length !== 1) {
    findings.push(finding("preserved-claim-not-unique", {
      matches: predecessors.length,
    }));
  } else {
    const predecessor = predecessors[0];
    const sharedIdentity = hasSharedRecoveryIdentity({ lane, predecessor });
    const dormantPredecessor = (
      sharedIdentity
      && predecessor.state === "dormant-preserved"
      && predecessor.transitionCounter === lane.authority.transitionCounter
      && predecessor.transitionCounter < Number.MAX_SAFE_INTEGER
      && predecessor.fenceRevision === lane.authority.claimDigest
      && predecessor.transitionDigest === lane.authority.claimLedgerRevision
      && predecessor.expiresAt === lane.authority.expiresAt
      && predecessor.deviceId === ownerIdentifier("device", lane.authority.deviceId)
      && predecessor.sessionId === ownerIdentifier("session", lane.authority.sessionId)
    );
    const unprojectedRecoveryClaim = (
      sharedIdentity
      && isUnprojectedRecoveryClaim({ request, lane, predecessor })
      && hasExactRecoveryLineage({ status, lane, predecessor, request })
    );
    if (
      !dormantPredecessor
      && !unprojectedRecoveryClaim
      && predecessor !== completedProjectionClaim
    ) {
      findings.push(finding("preserved-claim-drift"));
    }
  }
  const otherClaims = status.claims.filter(
    claim => claim.claimId !== lane.authority.claimId,
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
function findUnprojectedRecoveryClaim({ request, lane, status }) {
  if (!Array.isArray(status?.claims)) return null;
  const matches = status.claims.filter(claim => claim.claimId === lane.authority.claimId);
  if (matches.length !== 1) return null;
  const predecessor = matches[0];
  return (
    hasSharedRecoveryIdentity({ lane, predecessor })
    && isUnprojectedRecoveryClaim({ request, lane, predecessor })
    && hasExactRecoveryLineage({ status, lane, predecessor, request })
  ) ? predecessor : null;
}
function hasSharedRecoveryIdentity({ lane, predecessor }) {
  let declaredWriteScope = null;
  try {
    declaredWriteScope = normalizeWriteSet(predecessor.declaredWriteScope);
  } catch {
    return false;
  }
  return (
    predecessor.writeAuthority === false
    && predecessor.scopeReserved === true
    && predecessor.canonicalBaseRevision === lane.authority.canonicalBaseSha
    && predecessor.canonicalBaseRevision === lane.baseSha
    && predecessor.laneRevision === lane.authority.laneRevision
    && predecessor.laneRevision === lane.headSha
    && predecessor.writeSetDigest === lane.authority.writeSetDigest
    && predecessor.writeSetDigest === lane.manifest.writeSetDigest
    && JSON.stringify(declaredWriteScope) === JSON.stringify(lane.manifest.declaredWriteSet)
    && predecessor.leaseEpoch === lane.authority.leaseEpoch
    && predecessor.reviewRequestId === lane.authority.reviewRequestId
  );
}
function isUnprojectedRecoveryClaim({ request, lane, predecessor }) {
  const localExpiresAt = canonicalTimestampMilliseconds(lane.authority.expiresAt);
  const replayRecoveredAt = canonicalTimestampMilliseconds(predecessor.recovery?.recoveredAt);
  const replayExpiresAt = canonicalTimestampMilliseconds(predecessor.expiresAt);
  const replayStateAndClockAgree = (
    (predecessor.state === "reviewed" && replayExpiresAt > Date.now())
    || (predecessor.state === "dormant-preserved" && replayExpiresAt <= Date.now())
  );
  return (
    request.transition !== "retain"
    && ["reviewed", "dormant-preserved"].includes(predecessor.state)
    && Number.isSafeInteger(predecessor.transitionCounter)
    && predecessor.transitionCounter > lane.authority.transitionCounter
    && !(
      predecessor.state === "dormant-preserved"
      && predecessor.transitionCounter === Number.MAX_SAFE_INTEGER
    )
    && DIGEST_PATTERN.test(String(predecessor.fenceRevision || ""))
    && predecessor.fenceRevision !== lane.authority.claimDigest
    && DIGEST_PATTERN.test(String(predecessor.transitionDigest || ""))
    && predecessor.transitionDigest !== lane.authority.claimLedgerRevision
    && DIGEST_PATTERN.test(String(predecessor.operationReceiptDigest || ""))
    && predecessor.deviceId === ownerIdentifier("device", request.successorDeviceId)
    && predecessor.sessionId === ownerIdentifier("session", request.successorSessionId)
    && localExpiresAt !== null
    && replayRecoveredAt !== null
    && replayExpiresAt !== null
    && replayExpiresAt > localExpiresAt
    && replayRecoveredAt >= localExpiresAt
    && replayRecoveredAt < replayExpiresAt
    && replayStateAndClockAgree
  );
}
function requiresLocalRecoveryEvidence({ lane, predecessor }) {
  return (
    predecessor.state === "dormant-preserved"
    || predecessor.transitionCounter > lane.authority.transitionCounter + 1
  );
}
function readGitHubRecoveryLineage({
  ghText,
  ledgerRepository,
  ledgerRevision,
  ledgerDigest,
  claimId,
}) {
  const revision = requiredSha(ledgerRevision, "status ledger revision");
  const expectedLedgerDigest = requiredDigest(ledgerDigest, "status ledger digest");
  const exactClaimId = requiredDigest(claimId, "recovery lineage claimId");
  const ledgerPath = DEFAULT_LEDGER_PATH
    .split("/")
    .map(segment => encodeURIComponent(segment))
    .join("/");
  const endpoint = [
    `repos/${ledgerRepository}/contents/${ledgerPath}`,
    `ref=${encodeURIComponent(revision)}`,
  ].join("?");
  let ledger;
  try {
    ledger = JSON.parse(ghText([
      "api",
      endpoint,
      "-H",
      "Accept: application/vnd.github.raw+json",
    ]));
  } catch (error) {
    throw new Error(`Could not read exact cloud recovery lineage: ${publicMessage(error)}`);
  }
  const findings = validateLedger(ledger);
  if (findings.length > 0 || ledger.headDigest !== expectedLedgerDigest) {
    throw new Error("Exact cloud recovery lineage did not match the validated status ledger.");
  }
  return Object.freeze(ledger.entries
    .filter(entry => entry.claimId === exactClaimId)
    .map(entry => Object.freeze({
      sequence: entry.sequence,
      action: entry.action,
      evaluationTime: entry.evaluationTime,
      claimId: entry.claimId,
      claimDigest: entry.claimDigest,
      digest: entry.digest,
      claimCore: Object.freeze({
        claimId: entry.claimCore.claimId,
        actorId: entry.claimCore.actorId,
        deviceId: entry.claimCore.deviceId,
        sessionId: entry.claimCore.sessionId,
        repositoryId: entry.claimCore.repositoryId,
        workItemId: entry.claimCore.workItemId,
        canonicalBaseRevision: entry.claimCore.canonicalBaseRevision,
        laneRevision: entry.claimCore.laneRevision,
        declaredWriteScope: Object.freeze([...entry.claimCore.declaredWriteScope]),
        writeSetDigest: entry.claimCore.writeSetDigest,
        leaseEpoch: entry.claimCore.leaseEpoch,
        transitionCounter: entry.claimCore.transitionCounter,
        state: entry.claimCore.state,
        expiresAt: entry.claimCore.expiresAt,
        evidenceDigest: entry.claimCore.evidenceDigest,
        reviewRequestId: entry.claimCore.reviewRequestId,
        recovery: entry.claimCore.recovery
          ? Object.freeze({ ...entry.claimCore.recovery })
          : null,
      }),
    })));
}
function hasExactRecoveryLineage({
  status,
  lane,
  predecessor,
  request,
  recoveryEvidenceDigest = null,
}) {
  const localCounter = lane.authority.transitionCounter;
  const remoteCounter = predecessor.transitionCounter;
  if (!Number.isSafeInteger(remoteCounter) || remoteCounter <= localCounter) return false;
  const gap = remoteCounter - localCounter;
  if (gap === 1) return true;
  if (!Array.isArray(status?.recoveryLineage)) return false;
  const entries = status.recoveryLineage.filter(
    entry => entry?.claimId === predecessor.claimId,
  );
  const anchorMatches = entries.filter(entry => (
    entry.claimDigest === lane.authority.claimDigest
    && entry.digest === lane.authority.claimLedgerRevision
    && entry.claimCore?.transitionCounter === localCounter
  ));
  const currentMatches = entries.filter(entry => (
    entry.claimDigest === predecessor.fenceRevision
    && entry.digest === predecessor.transitionDigest
    && entry.claimCore?.transitionCounter === remoteCounter
  ));
  if (anchorMatches.length !== 1 || currentMatches.length !== 1) return false;
  const anchorIndex = entries.indexOf(anchorMatches[0]);
  const currentIndex = entries.indexOf(currentMatches[0]);
  if (anchorIndex < 0 || currentIndex !== entries.length - 1 || currentIndex <= anchorIndex) {
    return false;
  }
  const unseen = entries.slice(anchorIndex + 1);
  if (unseen.length !== gap) return false;
  const exactRecoveryEvidenceDigest = recoveryEvidenceDigest
    || predecessor.recovery?.evidenceDigest;
  let precedingExpiry = canonicalTimestampMilliseconds(lane.authority.expiresAt);
  if (precedingExpiry === null) return false;
  for (const [offset, entry] of unseen.entries()) {
    const core = entry.claimCore;
    let declaredWriteScope = null;
    try {
      declaredWriteScope = normalizeWriteSet(core?.declaredWriteScope);
    } catch {
      return false;
    }
    const recoveredAt = canonicalTimestampMilliseconds(core?.recovery?.recoveredAt);
    const expiresAt = canonicalTimestampMilliseconds(core?.expiresAt);
    if (
      entry.action !== "continue"
      || entry.claimId !== predecessor.claimId
      || !DIGEST_PATTERN.test(String(entry.claimDigest || ""))
      || !DIGEST_PATTERN.test(String(entry.digest || ""))
      || core?.claimId !== predecessor.claimId
      || core?.transitionCounter !== localCounter + offset + 1
      || core?.actorId !== predecessor.actorId
      || core?.repositoryId !== predecessor.repositoryId
      || core?.workItemId !== predecessor.workItemId
      || core?.canonicalBaseRevision !== lane.baseSha
      || core?.laneRevision !== lane.headSha
      || core?.writeSetDigest !== lane.manifest.writeSetDigest
      || JSON.stringify(declaredWriteScope) !== JSON.stringify(lane.manifest.declaredWriteSet)
      || core?.leaseEpoch !== lane.authority.leaseEpoch
      || core?.reviewRequestId !== lane.authority.reviewRequestId
      || core?.evidenceDigest !== lane.authority.focusedEvidenceDigest
      || core?.state !== "reviewed"
      || core?.deviceId !== ownerIdentifier("device", request.successorDeviceId)
      || core?.sessionId !== ownerIdentifier("session", request.successorSessionId)
      || !isExactRecoveryEvidence(core?.recovery, exactRecoveryEvidenceDigest)
      || core.recovery.recoveredAt !== entry.evaluationTime
      || recoveredAt === null
      || expiresAt === null
      || recoveredAt < precedingExpiry
      || expiresAt <= recoveredAt
    ) {
      return false;
    }
    precedingExpiry = expiresAt;
  }
  const current = unseen.at(-1);
  return (
    current.claimDigest === predecessor.fenceRevision
    && current.digest === predecessor.transitionDigest
    && current.claimCore.expiresAt === predecessor.expiresAt
  );
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
async function joinExactRecoveryClaim({
  result,
  cloud,
  targetRepository,
  waitForCloudVisibility,
}) {
  const publicClaim = result?.claim;
  const expectedCounter = publicClaim?.transitionCounter;
  for (let attempt = 0; attempt <= RECOVERY_JOIN_RETRY_DELAYS_MS.length; attempt += 1) {
    const claims = await cloud.listClaims({ targetRepository });
    const sameClaim = claims.filter(candidate => candidate.claimId === publicClaim?.claimId);
    const matches = sameClaim.filter(candidate => (
      candidate.fenceRevision === result?.claimDigest
      && candidate.ledgerRevision === publicClaim?.transitionDigest
    ));
    if (matches.length === 1 && sameClaim.length === 1) {
      const claim = matches[0];
      if (!matchesExactPublicClaimProjection(publicClaim, claim)) {
        throw new Error(
          "Cloud recovery result changed while joining its exact claim projection.",
        );
      }
      return Object.freeze({
        ...result,
        claim: Object.freeze({
          ...publicClaim,
          deviceId: requiredText(claim.deviceId, "recovered cloud claim deviceId"),
          sessionId: requiredText(claim.sessionId, "recovered cloud claim sessionId"),
          recovery: Object.freeze({
            evidenceDigest: claim.recovery?.evidenceDigest,
            recoveredAt: claim.recovery?.recoveredAt,
          }),
        }),
      });
    }
    if (
      !Number.isSafeInteger(expectedCounter)
      || matches.length > 1
      || sameClaim.length > 1
      || (
        sameClaim.length === 1
        && (
          !Number.isSafeInteger(sameClaim[0].transitionCounter)
          || sameClaim[0].transitionCounter >= expectedCounter
        )
      )
      || attempt === RECOVERY_JOIN_RETRY_DELAYS_MS.length
    ) {
      throw new Error(
        "Cloud recovery result changed while joining its exact owner and recovery evidence.",
      );
    }
    await waitForCloudVisibility(RECOVERY_JOIN_RETRY_DELAYS_MS[attempt]);
  }
  throw new Error("Cloud recovery result could not be joined within its bounded visibility window.");
}
function matchesExactPublicClaimProjection(publicClaim, claim) {
  if (!publicClaim || !claim) return false;
  const ownerProjection = {
    ...claim,
    transitionDigest: claim.ledgerRevision,
  };
  return PUBLIC_CLAIM_JOIN_FIELDS.every(field => (
    digestValue({ value: publicClaim[field] ?? null })
    === digestValue({ value: ownerProjection[field] ?? null })
  ));
}
function validateRecoveredCloudResult({
  result,
  lane,
  predecessor,
  request,
  expectedAction,
  expectedTransitionCounter,
  recoveryEvidenceDigest,
  expectedClaimDigest = null,
  expectedTransitionDigest = null,
  expectedOperationReceiptDigest = null,
}) {
  const expectedStatus = expectedAction === "verify" ? "ready" : "reviewed";
  if (
    !result
    || result.schema !== "agentic-cloud-collaboration-result/v1"
    || result.ok !== true
    || result.action !== expectedAction
    || result.status !== expectedStatus
  ) {
    throw new Error(`Cloud authority recovery requires a successful ${expectedAction} result.`);
  }
  const claim = result.claim;
  let declaredWriteScope = null;
  try {
    declaredWriteScope = normalizeWriteSet(claim?.declaredWriteScope);
  } catch {
    declaredWriteScope = null;
  }
  if (
    claim?.claimId !== predecessor.claimId
    || claim?.state !== "reviewed"
    || claim?.writeAuthority !== false
    || claim?.scopeReserved !== true
    || claim?.canonicalBaseRevision !== lane.baseSha
    || claim?.laneRevision !== lane.headSha
    || claim?.writeSetDigest !== lane.manifest.writeSetDigest
    || JSON.stringify(declaredWriteScope) !== JSON.stringify(lane.manifest.declaredWriteSet)
    || claim?.leaseEpoch !== predecessor.leaseEpoch
    || claim?.transitionCounter !== expectedTransitionCounter
    || claim?.reviewRequestId !== lane.authority.reviewRequestId
    || claim?.deviceId !== ownerIdentifier("device", request.successorDeviceId)
    || claim?.sessionId !== ownerIdentifier("session", request.successorSessionId)
    || claim?.fenceRevision !== result.claimDigest
    || result.claimDigest === lane.authority.claimDigest
    || (
      predecessor.state === "dormant-preserved"
      && result.claimDigest === predecessor.fenceRevision
    )
    || !DIGEST_PATTERN.test(String(claim?.transitionDigest || ""))
    || (
      predecessor.state === "dormant-preserved"
      && claim?.transitionDigest === predecessor.transitionDigest
    )
    || !DIGEST_PATTERN.test(String(claim?.operationReceiptDigest || ""))
    || !DIGEST_PATTERN.test(String(result.receipt?.ledgerDigest || ""))
    || !DIGEST_PATTERN.test(String(result.receipt?.receiptDigest || ""))
    || (expectedClaimDigest && result.claimDigest !== expectedClaimDigest)
    || (expectedTransitionDigest && claim?.transitionDigest !== expectedTransitionDigest)
    || (
      expectedOperationReceiptDigest
      && claim?.operationReceiptDigest !== expectedOperationReceiptDigest
    )
    || !SHA_PATTERN.test(String(result.ledgerRevision || ""))
    || !isExactRecoveryEvidence(claim?.recovery, recoveryEvidenceDigest)
    || (
      predecessor.state === "reviewed"
      && (
        claim?.recovery?.evidenceDigest !== predecessor.recovery?.evidenceDigest
        || claim?.recovery?.recoveredAt !== predecessor.recovery?.recoveredAt
      )
    )
    || (
      predecessor.state === "dormant-preserved"
      && Date.parse(claim?.recovery?.recoveredAt) < Date.parse(predecessor.expiresAt)
    )
    || Date.parse(claim?.expiresAt) <= Date.now()
  ) {
    throw new Error("Recovered cloud authority drifted from the exact preserved reviewed claim.");
  }
}
function projectRecoveredAuthority({ result, lane, request, recoveryEvidenceDigest }) {
  return Object.freeze({
    schema: "agentic-lane-cloud-authority/v1",
    provider: "github",
    ledgerRepository: lane.authority.ledgerRepository,
    targetRepository: lane.authority.targetRepository,
    claimId: requiredDigest(result.claim?.claimId, "claimId"),
    claimDigest: requiredDigest(result.claimDigest, "claimDigest"),
    ledgerRevision: requiredSha(result.ledgerRevision, "ledgerRevision"),
    ledgerDigest: requiredDigest(
      result.receipt?.ledgerDigest ?? result.ledgerDigest,
      "ledgerDigest",
    ),
    claimLedgerRevision: requiredDigest(result.claim?.transitionDigest, "claimLedgerRevision"),
    entrySchema: requiredText(result.claim?.entrySchema, "entrySchema"),
    claimIdentitySchema: requiredText(result.claim?.claimIdentitySchema, "claimIdentitySchema"),
    operationReceiptDigest: requiredDigest(
      result.claim?.operationReceiptDigest,
      "operationReceiptDigest",
    ),
    mutationAuthorityEligible: true,
    canonicalBaseSha: requiredSha(result.claim?.canonicalBaseRevision, "canonicalBaseRevision"),
    laneRevision: requiredSha(result.claim?.laneRevision, "laneRevision"),
    cloudDeclaredWriteScope: normalizeWriteSet(result.claim?.declaredWriteScope),
    writeSetDigest: requiredDigest(result.claim?.writeSetDigest, "writeSetDigest"),
    deviceId: requiredText(request.successorDeviceId, "successorDeviceId"),
    sessionId: requiredText(request.successorSessionId, "successorSessionId"),
    reviewRequestId: result.claim?.reviewRequestId ? requiredText(result.claim.reviewRequestId, "reviewRequestId") : null,
    leaseEpoch: positiveInteger(result.claim?.leaseEpoch, "leaseEpoch"),
    transitionCounter: positiveInteger(result.claim?.transitionCounter, "transitionCounter"),
    state: "review_ready",
    expiresAt: requiredText(result.claim?.expiresAt, "claim expiresAt"),
    focusedEvidenceDigest: lane.authority.focusedEvidenceDigest,
    manifestDigest: lane.manifest.manifestDigest,
    recovery: requireExactRecoveryEvidence({
      recovery: result.claim?.recovery,
      recoveryEvidenceDigest,
      label: "verified cloud claim",
    }),
  });
}
function requireRecoveredAuthority({
  recovered,
  request,
  lane,
  predecessor,
  recoveryEvidenceDigest,
}) {
  const authority = recovered?.authority;
  const expectedTransitionCounter = recoveredTransitionCounter(predecessor);
  const predecessorWasDormant = predecessor.state === "dormant-preserved";
  const authorityRecoveredAt = canonicalTimestampMilliseconds(authority?.recovery?.recoveredAt);
  const authorityExpiresAt = canonicalTimestampMilliseconds(authority?.expiresAt);
  const predecessorExpiresAt = canonicalTimestampMilliseconds(predecessor.expiresAt);
  const recoveryReceiptDigest = String(recovered?.recoveryReceiptDigest || "");
  let declaredWriteScope = null;
  try {
    declaredWriteScope = normalizeWriteSet(authority?.cloudDeclaredWriteScope);
  } catch {
    declaredWriteScope = null;
  }
  if (
    authority?.schema !== "agentic-lane-cloud-authority/v1"
    || authority.provider !== "github"
    || authority.ledgerRepository !== lane.authority.ledgerRepository
    || authority.targetRepository !== lane.authority.targetRepository
    || authority.claimId !== predecessor.claimId
    || authority.claimDigest === lane.authority.claimDigest
    || (predecessorWasDormant && authority.claimDigest === predecessor.fenceRevision)
    || (!predecessorWasDormant && authority.claimDigest !== predecessor.fenceRevision)
    || !DIGEST_PATTERN.test(String(authority.claimDigest || ""))
    || !SHA_PATTERN.test(String(authority.ledgerRevision || ""))
    || !DIGEST_PATTERN.test(String(authority.claimLedgerRevision || ""))
    || !DIGEST_PATTERN.test(String(authority.operationReceiptDigest || ""))
    || !DIGEST_PATTERN.test(recoveryReceiptDigest)
    || authority.operationReceiptDigest !== recoveryReceiptDigest
    || (
      !predecessorWasDormant
      && recoveryReceiptDigest !== predecessor.operationReceiptDigest
    )
    || authority.canonicalBaseSha !== lane.baseSha
    || authority.laneRevision !== lane.headSha
    || authority.writeSetDigest !== lane.manifest.writeSetDigest
    || JSON.stringify(declaredWriteScope) !== JSON.stringify(lane.manifest.declaredWriteSet)
    || authority.deviceId !== request.successorDeviceId
    || authority.sessionId !== request.successorSessionId
    || authority.reviewRequestId !== lane.authority.reviewRequestId
    || authority.leaseEpoch !== lane.authority.leaseEpoch
    || authority.transitionCounter !== expectedTransitionCounter
    || (
      predecessorWasDormant
      && authority.claimLedgerRevision === predecessor.transitionDigest
    )
    || (
      !predecessorWasDormant
      && authority.claimLedgerRevision !== predecessor.transitionDigest
    )
    || (
      !predecessorWasDormant
      && (
        authority.expiresAt !== predecessor.expiresAt
        || authority.recovery?.recoveredAt !== predecessor.recovery?.recoveredAt
      )
    )
    || authority.state !== "review_ready"
    || authority.focusedEvidenceDigest !== lane.authority.focusedEvidenceDigest
    || authority.manifestDigest !== lane.manifest.manifestDigest
    || !isExactRecoveryEvidence(authority.recovery, recoveryEvidenceDigest)
    || authorityRecoveredAt === null
    || authorityExpiresAt === null
    || authorityExpiresAt <= authorityRecoveredAt
    || (
      predecessorWasDormant
      && (
        predecessorExpiresAt === null
        || authorityRecoveredAt < predecessorExpiresAt
      )
    )
    || authorityExpiresAt <= Date.now()
  ) {
    throw new Error("Controller adapter returned a recovery outside the exact preserved claim.");
  }
  return authority;
}
function recoveredTransitionCounter(predecessor) {
  if (predecessor.state === "dormant-preserved") {
    const counter = positiveInteger(
      predecessor.transitionCounter,
      "predecessor transitionCounter",
    );
    if (counter === Number.MAX_SAFE_INTEGER) {
      throw new Error("Dormant recovery transition counter cannot advance safely.");
    }
    return counter + 1;
  }
  if (predecessor.state === "reviewed") {
    return positiveInteger(predecessor.transitionCounter, "predecessor transitionCounter");
  }
  throw new Error(`Unsupported recovery predecessor state ${predecessor.state}.`);
}
function requireExactRecoveryEvidence({ recovery, recoveryEvidenceDigest, label }) {
  if (!isExactRecoveryEvidence(recovery, recoveryEvidenceDigest)) {
    throw new Error(`${label} recovery evidence did not match the controller preflight receipt.`);
  }
  return Object.freeze({
    evidenceDigest: recovery.evidenceDigest,
    recoveredAt: recovery.recoveredAt,
  });
}
function isExactRecoveryEvidence(recovery, recoveryEvidenceDigest) {
  const recoveredAt = String(recovery?.recoveredAt || "");
  const recoveredAtMilliseconds = Date.parse(recoveredAt);
  return (
    recovery?.evidenceDigest === recoveryEvidenceDigest
    && DIGEST_PATTERN.test(String(recoveryEvidenceDigest || ""))
    && Number.isFinite(recoveredAtMilliseconds)
    && new Date(recoveredAtMilliseconds).toISOString() === recoveredAt
  );
}
function canonicalTimestampMilliseconds(value) {
  const timestamp = String(value || "");
  const milliseconds = Date.parse(timestamp);
  return (
    Number.isFinite(milliseconds)
    && new Date(milliseconds).toISOString() === timestamp
  ) ? milliseconds : null;
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
    successorTransitionCounter: authority?.transitionCounter || null,
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
function buildPreflightReceipt({ request, lane, actor, findings }) {
  return buildReceipt("preflight", {
    branch: lane.branch,
    transition: request.transition,
    targetRepository: lane.authority.targetRepository,
    baseSha: lane.baseSha,
    headSha: lane.headSha,
    reviewRequestId: lane.authority.reviewRequestId,
    predecessorClaimId: lane.authority.claimId,
    predecessorLeaseEpoch: lane.authority.leaseEpoch,
    successorDeviceId: request.successorDeviceId,
    successorSessionId: request.successorSessionId,
    actorId: positiveInteger(actor.id, "authenticated actor id"),
    blockingFindingDigest: digestValue(findings),
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
function ownerIdentifier(namespace, value) {
  const identity = requiredText(value, `${namespace} owner`);
  const prefix = `${namespace}:`;
  if (identity.startsWith(prefix) && DIGEST_PATTERN.test(identity.slice(prefix.length))) {
    return identity;
  }
  return `${namespace}:${digestValue({ namespace, value: identity })}`;
}
function positiveInteger(value, label) {
  const integer = Number(value);
  if (!Number.isSafeInteger(integer) || integer < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return integer;
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
