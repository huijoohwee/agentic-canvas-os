import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  invokeRepositoryCloudVerifier,
  verifyCloudDeliveryAuthority,
} from "./cloud-collaboration-delivery-verifier.mjs";
import {
  compactDeviceCloudMutationIdempotencyKey,
  createDeviceDeliveryEvidence,
} from "./device-delivery-evidence.mjs";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  authorizeDeliveryAdmissionCloudAuthority,
  bindAdmissionCloudAuthority,
  claimLegacyReviewAdmissionCloudAuthority,
  invokeRepositoryCloudAction,
  recoverIntegratedPreservedCloudAuthority,
  verifyAdmissionCloudAuthority,
} from "./scoped-lane-cloud-authority.mjs";
import {
  normalizeBoundAuthority,
  projectRootState,
} from "./scoped-lane-cloud-reconciliation.mjs";
import { assertActivePublishPathsAdmitted } from "./active-publish-write-scope.mjs";
import { continueActivePublishTaskAuthoritySuccessor }
  from "./active-publish-task-authority-successor.mjs";
import { casWriterLeaseProjection } from "./writer-lease-registry-cas.mjs";
import {
  appendProtectedMainRefresh,
  normalizeProtectedHeadRefreshProjection,
  protectedHeadRefreshOperationId,
  protectedMainRefreshHeads,
  renderProtectedHeadRefreshRearmCommitMessage,
  requireProtectedHeadRefreshPullRequest,
  verifyProtectedMainRefreshChain,
} from "./protected-main-refresh-lib.mjs";
import {
  normalizePreClaimIntegrationContinuation,
} from "./expired-committed-continuation-lib.mjs";
import { requireProtectedSquashSubject } from "./protected-squash-subject.mjs";
import { projectRepeatedProtectedRefreshBase } from
  "./repeated-protected-refresh-base-projection.mjs";
import { withReviewedLaneEntrypointFence } from "./reviewed-lane-revision-fence.mjs";
import {
  createWorktreeCleanupOperationId,
  WORKTREE_CLEANUP_RESULT_SCHEMA,
} from "./worktree-lifecycle-lib.mjs";
import { deriveTaskWorktreeContainers } from "./task-worktree-owned-containers.mjs";

export { WORKTREE_CLEANUP_RESULT_SCHEMA };

export const CHANGE_MANIFEST_SCHEMA = "agentic-change-manifest/v1";
export const DEVICE_INTEGRATION_RESULT_SCHEMA = "agentic-device-integration-result/v1";
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const REPOSITORY_IDENTITY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u;
const MANAGED_COMMIT_SUBJECT_PATTERN =
  /^(feat|fix|docs|test|refactor|chore)\(([a-z0-9][a-z0-9._/-]*)\): (\S.*)$/u;
const DELIVERY_EVIDENCE_FIELDS = Object.freeze([
  "dependencyClosureDigest",
  "namedChecksDigest",
  "handoffEvidenceDigest",
  "operatorDecisionDigest",
  "integrationIntentDigest",
]);
const PROTECTED_HEAD_REFRESH_DISPATCH_FIELDS = Object.freeze([
  "operation",
  "pull_request_number",
  "branch",
  "delivered_head_sha",
  "observed_head_sha",
  "target_main_sha",
  "canonical_base_sha",
  "claim_id",
  "claim_digest",
  "ledger_revision",
  "review_request_id",
  "pull_request_node_id",
  "pull_request_title",
  "auto_merge_method",
  "auto_merge_enabled_by_database_id",
  "auto_merge_enabled_by_node_id",
  "auto_merge_enabled_by_login",
  "auto_merge_enabled_by_type",
  "auto_merge_commit_title",
  "auto_merge_commit_message",
  "candidate_auto_merge_commit_title",
  "candidate_auto_merge_commit_message",
  "integration_receipt_digest",
  "transition_counter",
  "operation_id",
]);

export function integrateSession(options) {
  return withIntegrationEntrypointFence(options, () => integrateSessionUnfenced(options));
}

function integrateSessionUnfenced({
  invocationPath,
  repo,
  gitText,
  ghText,
  leaseStore,
  sessionId,
  run,
  runText,
  publishTask,
  completeTask,
  commitMessage = "",
  pathsManifest = "",
  runtime = "canonical",
  runtimeRepository = "",
  controllerRoot,
  waitSeconds = 900,
  pollSeconds = 5,
  now = () => new Date(),
  sleep = defaultSleep,
  verifyCloudAuthority = verifyCloudDeliveryAuthority,
  buildDeliveryEvidence = createDeviceDeliveryEvidence,
  authorizeCloudDelivery = authorizeDeliveryAdmissionCloudAuthority,
  invokeCloudMutation = invokeRepositoryCloudAction,
  refreshActiveCloudSuccessor = claimLegacyReviewAdmissionCloudAuthority,
  bindActiveCloudSuccessor = bindAdmissionCloudAuthority,
  verifyActiveCloudSuccessor = verifyAdmissionCloudAuthority,
  inspectCloudStatus = invokeRepositoryCloudAction,
  recoverIntegratedCloudAuthority = recoverIntegratedPreservedCloudAuthority,
  invokeCloudSuccessor = invokeRepositoryCloudAction,
  verifyCloudSuccessor = invokeRepositoryCloudVerifier,
  casActiveLeaseProjection = casWriterLeaseProjection,
  continueReviewReadyCloudAuthority = continueReviewReadyCloudAuthorityProjection,
  renewActiveAuthority = null,
  log = console.log,
}) {
  requireRepositoryRoot({ invocationPath, repo });
  requireBounds({ waitSeconds, pollSeconds });
  if (!sessionId) throw new Error("Integration requires --session or AGENTIC_SESSION_ID.");
  if (!['canonical', 'none'].includes(runtime)) throw new Error("--runtime must be canonical or none.");

  let { branch, lease } = resolveIntegrationLease({ repo, gitText, leaseStore });
  if (lease.sessionId !== sessionId) throw new Error("Integration lease belongs to another session.");
  if (path.resolve(lease.worktreePath) !== path.resolve(repo)) {
    throw new Error(`Integration lease belongs to ${lease.worktreePath}, not ${repo}.`);
  }

  const canonicalRoot = resolveCanonicalMainWorktree(gitText(["worktree", "list", "--porcelain", "-z"]));
  let commitEvidence = lease.integration || null;
  const cloudReviewReadyDelivery = isReviewReadyDeliveryLease(lease);
  const legacyLocalOnlyAutoDeliveryReview = isLegacyLocalOnlyAutoDeliveryReviewLease(lease);
  const reviewReadyDelivery = cloudReviewReadyDelivery || legacyLocalOnlyAutoDeliveryReview;
  const autoDeliveryReview = reviewReadyDelivery && lease.autoDelivery === true && lease.runtimeRequired === true;
  if (autoDeliveryReview && runtime !== "canonical") {
    throw new Error("Auto-delivery integration requires canonical runtime readiness; --runtime=none is not permitted.");
  }
  const activePublishIntent = lease.activePublishSuccessorIntent
    ? normalizeActivePublishSuccessorIntent(lease.activePublishSuccessorIntent)
    : null;
  // Keep the lease active so claim() retains ownership. Cooperative device entrypoints must
  // serialize; only integrate resumes a prepared intent, and it cannot publish before final CAS.
  if (lease.status === "active" && activePublishIntent?.status === "prepared") {
    publishActiveWithSuccessorRecovery({
      branch,
      lease,
      leaseStore,
      sessionId,
      gitText,
      ghText,
      publishTask,
      refreshActiveCloudSuccessor,
      bindActiveCloudSuccessor,
      verifyActiveCloudSuccessor,
      inspectCloudStatus,
      invokeCloudSuccessor,
      verifyCloudSuccessor,
      casActiveLeaseProjection,
      waitSeconds,
      pollSeconds,
      now,
      sleep,
    });
    lease = leaseStore.read(branch);
  } else if (lease.status === "active") {
    lease = renewIntegrationAuthority({
      branch, lease, leaseStore, sessionId, gitText, renewActiveAuthority,
      phase: "before-validation", now,
    });
    commitEvidence = prepareIntegrationCommit({
      branch, lease, repo, gitText, leaseStore, sessionId, run,
      commitMessage, pathsManifest, now, renewActiveAuthority,
    });
    lease = renewIntegrationAuthority({
      branch, lease: leaseStore.read(branch), leaseStore, sessionId, gitText,
      renewActiveAuthority, phase: "before-publication", now,
    });
    refreshTaskBranchFromMain({
      repo,
      gitText,
      run,
      runText,
      squashSubject: commitEvidence.commitMessage,
    });
    lease = leaseStore.read(branch);
    publishActiveWithSuccessorRecovery({
      branch,
      lease,
      leaseStore,
      sessionId,
      gitText,
      ghText,
      publishTask,
      refreshActiveCloudSuccessor,
      bindActiveCloudSuccessor,
      verifyActiveCloudSuccessor,
      inspectCloudStatus,
      invokeCloudSuccessor,
      verifyCloudSuccessor,
      casActiveLeaseProjection,
      waitSeconds,
      pollSeconds,
      now,
      sleep,
    });
    lease = leaseStore.read(branch);
  } else if (!['delivery', 'completing', 'completed'].includes(lease.status) && !reviewReadyDelivery) {
    throw new Error(
      `Integration requires an active, delivery, completing, or completed lease; ${branch} is ${lease.status}. ` +
      "Resume review-ready work before protected integration.",
    );
  }

  let protectedMainRefresh = null;
  let completion = lease.completion || null;
  if (legacyLocalOnlyAutoDeliveryReview) {
    const pullRequest = requireMergedLegacyLocalOnlyAutoDeliveryPullRequest({
      lease,
      ghText,
    });
    log(`Legacy local-only pull request merged at ${pullRequest.mergeCommit.oid.slice(0, 12)}.`);
    completion = completeTask();
    lease = leaseStore.read(branch);
  } else if (!['completing', 'completed'].includes(lease.status)) {
    let deliveryCloudAuthority = lease.cloudAuthority || null;
    const deliveryVerifiedBaseSha = deliveryCloudAuthority?.canonicalBaseSha || "";
    let acceptedProtectedRefreshBaseSha = deliveryVerifiedBaseSha;
    let protectedMainAuthorizationRefresh = null;
    let squashSubject = null;
    if (reviewReadyDelivery) {
      const currentPullRequest = JSON.parse(ghText([
        "pr", "view", lease.pullRequestUrl, "--json", "state,baseRefName,url,headRefOid,mergeCommit",
      ]));
      if (currentPullRequest.url !== lease.pullRequestUrl || currentPullRequest.baseRefName !== "main") {
        throw new Error(`Pull request identity for ${lease.pullRequestUrl} changed before integration.`);
      }
      if (lease.baseSha !== deliveryVerifiedBaseSha) {
        throw new Error(
          `Reviewed lease base ${lease.baseSha || "unknown"} does not match cloud-authoritative base ${deliveryVerifiedBaseSha || "unknown"}.`,
        );
      }
      squashSubject = requireProtectedSquashSubject(
        gitText([
          "log", "--first-parent", "--no-merges", "-1", "--format=%s",
          `${deliveryVerifiedBaseSha}..${lease.reviewHeadSha}`,
        ]).replace(/\r?\n$/u, ""),
        { label: "Reviewed authored commit subject" },
      );
      protectedMainAuthorizationRefresh = (
        lease.reviewHeadSha
        && currentPullRequest.headRefOid !== lease.reviewHeadSha
      )
        ? reconcileProtectedMainRefresh({
          url: lease.pullRequestUrl,
          expectedHeadSha: lease.reviewHeadSha,
          observedHeadSha: currentPullRequest.headRefOid,
          gitText,
          run,
        })
        : null;
      if (protectedMainAuthorizationRefresh) {
        protectedMainRefresh = appendProtectedMainRefresh(
          protectedMainRefresh,
          protectedMainAuthorizationRefresh,
        );
        acceptedProtectedRefreshBaseSha = projectRepeatedProtectedRefreshBase({
          acceptedHeadSha: lease.reviewHeadSha,
          refreshReceipt: protectedMainAuthorizationRefresh,
        }).canonicalBaseSha;
      }
    }
    if (reviewReadyDelivery) {
      const authorizeReviewedDelivery = reviewedCloudAuthority => {
        const deliveryEvidence = requireDeliveryEvidenceDigests(buildDeliveryEvidence({
          operation: "integrate",
          branch,
          headSha: lease.reviewHeadSha,
          headTreeSha: gitText(["rev-parse", `${lease.reviewHeadSha}^{tree}`]).trim(),
          pullRequestNumber: pullRequestNumber(lease.pullRequestUrl),
          deviceId: lease.device,
          sessionId,
          manifest: lease.admission,
          authority: reviewedCloudAuthority,
        }));
        const authorized = authorizeCloudDelivery({
          authority: reviewedCloudAuthority,
          manifest: lease.admission,
          branch,
          headSha: lease.reviewHeadSha,
          pullRequestNumber: protectedMainAuthorizationRefresh
            ? null
            : pullRequestNumber(lease.pullRequestUrl),
          reviewRequestId: protectedMainAuthorizationRefresh
            ? reviewedCloudAuthority?.reviewRequestId || null
            : null,
          allowProtectedMainRefresh: Boolean(protectedMainAuthorizationRefresh),
          dependencyClosureDigest: deliveryEvidence.dependencyClosureDigest,
          namedChecksDigest: deliveryEvidence.namedChecksDigest,
          handoffEvidenceDigest: deliveryEvidence.handoffEvidenceDigest,
          operatorDecisionDigest: deliveryEvidence.operatorDecisionDigest,
          integrationIntentDigest: deliveryEvidence.integrationIntentDigest,
          deviceId: lease.device,
          sessionId,
          invoke: input => invokeCloudMutation(
            compactDeviceCloudMutationIdempotencyKey(input),
          ),
        });
        return { authorized, deliveryEvidence };
      };
      let reviewedCloudAuthority = deliveryCloudAuthority;
      let authorized;
      let deliveryEvidence;
      try {
        ({ authorized, deliveryEvidence } = authorizeReviewedDelivery(reviewedCloudAuthority));
      } catch (error) {
        if (!isDormantPreservedCloudReconciliationError(error)) throw error;
        continueReviewReadyCloudAuthority({
          repo,
          branch,
          lease,
          sessionId,
          runText,
          controllerRoot,
        });
        lease = leaseStore.read(branch);
        reviewedCloudAuthority = lease?.cloudAuthority;
        ({ authorized, deliveryEvidence } = authorizeReviewedDelivery(reviewedCloudAuthority));
      }
      requireAuthorizedIntegrationEvidence({
        authority: authorized.authority,
        reviewedAuthority: reviewedCloudAuthority,
        headSha: lease.reviewHeadSha,
        deliveryEvidence,
      });
      deliveryCloudAuthority = authorized.authority;
      const reviewedDeliveryHeadSha = lease.reviewHeadSha;
      const protectedMergeHeadSha = protectedMainAuthorizationRefresh?.refreshedHeadSha
        || reviewedDeliveryHeadSha;
      verifyCloudAuthority({
        pullRequestUrl: lease.pullRequestUrl,
        branch,
        headSha: reviewedDeliveryHeadSha,
        canonicalBaseSha: deliveryCloudAuthority.canonicalBaseSha || "",
        cloudAuthority: deliveryCloudAuthority,
      });
      const autoMergeArgs = [
        "pr", "merge", "--auto", "--squash", "--subject", squashSubject,
        "--match-head-commit", protectedMergeHeadSha, lease.pullRequestUrl,
      ];
      try {
        run("gh", autoMergeArgs);
      } catch (error) {
        const replay = readPullRequestForProtectedRefresh({
          ghText,
          url: lease.pullRequestUrl,
        });
        requireArmedAutoMergeReplay({
          pullRequest: replay,
          url: lease.pullRequestUrl,
          expectedHeadSha: protectedMergeHeadSha,
          originalError: error,
        });
      }
    }
    const allowProtectedMainRefresh = lease.sessionId === sessionId &&
      (lease.status === "delivery" || reviewReadyDelivery);
    const deliveryAuthorizedHeadSha = reviewReadyDelivery
      ? lease.reviewHeadSha
      : lease.deliveryHeadSha || commitEvidence?.commitSha;
    const expiredDeliveryRecovery = recoverExpiredDeliveryCloudAuthority({
      lease, authority: deliveryCloudAuthority, branch,
      headSha: deliveryAuthorizedHeadSha, gitText, ghText, run, inspectCloudStatus,
      recoverIntegratedCloudAuthority, now,
    });
    deliveryCloudAuthority = expiredDeliveryRecovery.authority;
    if (expiredDeliveryRecovery.protectedMainRefresh) {
      protectedMainAuthorizationRefresh = expiredDeliveryRecovery.protectedMainRefresh;
      protectedMainRefresh = appendProtectedMainRefresh(
        protectedMainRefresh,
        protectedMainAuthorizationRefresh,
      );
      acceptedProtectedRefreshBaseSha = projectRepeatedProtectedRefreshBase({
        acceptedHeadSha: deliveryAuthorizedHeadSha,
        refreshReceipt: protectedMainAuthorizationRefresh,
      }).canonicalBaseSha;
    }
    const requestedProtectedMainRefreshHeads = new Set();
    verifyCloudAuthority({
      pullRequestUrl: lease.pullRequestUrl,
      branch,
      headSha: deliveryAuthorizedHeadSha,
      canonicalBaseSha: deliveryCloudAuthority?.canonicalBaseSha || deliveryVerifiedBaseSha,
      cloudAuthority: deliveryCloudAuthority,
      protectedMainRefresh,
    });
    const pullRequest = waitForMergedPullRequest({
      url: lease.pullRequestUrl,
      expectedHeadSha: deliveryAuthorizedHeadSha,
      ghText, waitSeconds, pollSeconds, now, sleep,
      onHeadAdvance: allowProtectedMainRefresh
        ? ({ expectedHeadSha, observedHeadSha }) => {
          const refresh = protectedMainAuthorizationRefresh
            && protectedMainAuthorizationRefresh.deliveredHeadSha === expectedHeadSha
            && protectedMainAuthorizationRefresh.refreshedHeadSha === observedHeadSha
            ? protectedMainAuthorizationRefresh
            : reconcileProtectedMainRefresh({
              url: lease.pullRequestUrl,
              expectedHeadSha,
              observedHeadSha,
              gitText,
              run,
            });
          if (refresh !== protectedMainAuthorizationRefresh) {
            protectedMainRefresh = appendProtectedMainRefresh(
              protectedMainRefresh,
              refresh,
            );
          }
          acceptedProtectedRefreshBaseSha = projectRepeatedProtectedRefreshBase({
            acceptedHeadSha: expectedHeadSha,
            refreshReceipt: refresh,
          }).canonicalBaseSha;
          verifyCloudAuthority({
            pullRequestUrl: lease.pullRequestUrl,
            branch,
            headSha: deliveryAuthorizedHeadSha,
            canonicalBaseSha: deliveryCloudAuthority?.canonicalBaseSha || deliveryVerifiedBaseSha,
            cloudAuthority: deliveryCloudAuthority,
          });
          return refresh.refreshedHeadSha;
        }
        : null,
      onOpenPullRequest: allowProtectedMainRefresh
        ? ({ acceptedHeadSha, pullRequest: openPullRequest }) => {
          dispatchProtectedMainRefresh({
            url: lease.pullRequestUrl,
            pullRequest: openPullRequest,
            acceptedHeadSha,
            requestedHeads: requestedProtectedMainRefreshHeads,
            branch,
            deliveredHeadSha: deliveryAuthorizedHeadSha,
            canonicalBaseSha: deliveryCloudAuthority?.canonicalBaseSha
              || deliveryVerifiedBaseSha,
            pullRequestBaseSha: acceptedProtectedRefreshBaseSha,
            cloudAuthority: deliveryCloudAuthority,
            ghText,
            verifyCloudAuthority: () => verifyCloudAuthority({
              pullRequestUrl: lease.pullRequestUrl,
              branch,
              headSha: deliveryAuthorizedHeadSha,
              canonicalBaseSha: deliveryCloudAuthority?.canonicalBaseSha || deliveryVerifiedBaseSha,
              cloudAuthority: deliveryCloudAuthority,
            }),
            run,
          });
        }
        : null,
    });
    verifyCloudAuthority({
      pullRequestUrl: lease.pullRequestUrl,
      branch,
      headSha: deliveryAuthorizedHeadSha,
      canonicalBaseSha: deliveryCloudAuthority?.canonicalBaseSha || deliveryVerifiedBaseSha,
      cloudAuthority: deliveryCloudAuthority,
      protectedMainRefresh,
    });
    log(`Protected pull request merged at ${pullRequest.mergeCommitSha.slice(0, 12)}.`);
    completion = completeTask();
    lease = leaseStore.read(branch);
  } else if (lease.status === "completing") {
    completion = completeTask();
    lease = leaseStore.read(branch);
  }
  if (lease.status === "completed") completion = lease.completion;
  const mainSha = completion?.mainSha;
  if (!SHA_PATTERN.test(String(mainSha || ""))) {
    throw new Error("Integration completion did not emit an exact canonical main SHA.");
  }

  const canonicalIntegration = convergeCanonicalSource({
    canonicalRoot,
    mainSha,
    controllerRoot,
    runtime,
    runtimeRepository,
    runText,
  });
  const runtimeReadiness = runtime === "canonical"
    ? reconcileCanonicalRuntime({
      canonicalIntegration,
      integrationWorktree: repo,
      mainSha,
      runText,
    })
    : null;
  const finalizedLease = finalizeIntegrationLease({
    leaseStore,
    branch,
    completion,
  });
  lease = finalizedLease;
  const cleanup = cleanupIntegrationWorktree({
    canonicalIntegration,
    integrationBranch: branch,
    integrationWorktree: repo,
    runText,
  });
  const status = runtimeReadiness ? "runtime_ready" : "integrated";
  const result = {
    schema: DEVICE_INTEGRATION_RESULT_SCHEMA,
    ok: true,
    status,
    branch,
    worktreePath: repo,
    pullRequestUrl: lease.pullRequestUrl,
    commit: commitEvidence,
    ...(protectedMainRefresh ? { protectedMainRefresh } : {}),
    mergeCommitSha: completion?.mergeCommitSha || null,
    mainSha,
    canonical: canonicalIntegration.integratedSource,
    cleanup,
    runtime: runtimeReadiness,
  };
  log(
    runtimeReadiness
      ? `Integrated ${branch} and verified canonical runtime ${mainSha.slice(0, 12)}.`
      : `Integrated ${branch} at canonical main ${mainSha.slice(0, 12)}; runtime reconciliation was explicitly disabled.`,
  );
  return result;
}

function requireDeliveryEvidenceDigests(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Integration delivery evidence builder did not return an evidence object.");
  }
  return Object.freeze(Object.fromEntries(DELIVERY_EVIDENCE_FIELDS.map(field => {
    const digest = value[field];
    if (!DIGEST_PATTERN.test(String(digest || ""))) {
      throw new Error(`Integration delivery evidence ${field} must be a lowercase SHA-256 digest.`);
    }
    return [field, digest];
  })));
}

function requireAuthorizedIntegrationEvidence({
  authority,
  reviewedAuthority,
  headSha,
  deliveryEvidence,
}) {
  const integration = authority?.integration;
  const matches = (
    authority?.state === "delivery_authorized"
    && integration
    && integration.candidateRevision === headSha
    && integration.reviewRequestId === reviewedAuthority?.reviewRequestId
    && integration.focusedEvidenceDigest === reviewedAuthority?.focusedEvidenceDigest
    && DELIVERY_EVIDENCE_FIELDS.every(
      field => integration[field] === deliveryEvidence[field],
    )
    && DIGEST_PATTERN.test(String(authority.integrationReceiptDigest || ""))
  );
  if (!matches) {
    throw new Error(
      "Integration delivery authorization does not record the exact derived delivery evidence and receipt.",
    );
  }
}

function finalizeIntegrationLease({ leaseStore, branch, completion }) {
  const current = leaseStore.read(branch);
  if (current?.status === "completed") return current;
  if (current?.status !== "completing") {
    throw new Error("Integration runtime proof cannot finalize a lease that is not completing.");
  }
  return leaseStore.complete({
    branch,
    pullRequestUrl: current.pullRequestUrl,
    mergeCommitSha: completion?.mergeCommitSha,
    mainSha: completion?.mainSha,
  });
}

function withIntegrationEntrypointFence(options, action) {
  const {
    invocationPath,
    repo,
    gitText,
    leaseStore,
    sessionId,
    runtime = "canonical",
    waitSeconds = 900,
    pollSeconds = 5,
  } = options;
  requireRepositoryRoot({ invocationPath, repo });
  requireBounds({ waitSeconds, pollSeconds });
  if (!sessionId) throw new Error("Integration requires --session or AGENTIC_SESSION_ID.");
  if (!["canonical", "none"].includes(runtime)) {
    throw new Error("--runtime must be canonical or none.");
  }
  const { branch, lease } = resolveIntegrationLease({ repo, gitText, leaseStore });
  if (lease.sessionId !== sessionId) throw new Error("Integration lease belongs to another session.");
  if (path.resolve(lease.worktreePath) !== path.resolve(repo)) {
    throw new Error(`Integration lease belongs to ${lease.worktreePath}, not ${repo}.`);
  }
  const reviewReadyDelivery = isReviewReadyIntegrationLease(lease);
  if (reviewReadyDelivery && lease.autoDelivery === true
    && lease.runtimeRequired === true && runtime !== "canonical") {
    throw new Error("Auto-delivery integration requires canonical runtime readiness; --runtime=none is not permitted.");
  }
  // Active integration delegates the single durable subject fence to its nested publish.
  if (!reviewReadyDelivery || typeof leaseStore.withRegistryLock !== "function" || !leaseStore.statePath) {
    return action();
  }
  const protectedSubject = resolveIntegrationEntrypointSubject({
    lease,
    gitText,
  });
  const expectedLeaseDigest = digestValue(lease);
  return withReviewedLaneEntrypointFence({
    leaseStore,
    branch,
    entrypoint: "integrate",
    operationDigest: digestValue({
      schema: "agentic-reviewed-lane-entrypoint-operation/v1",
      entrypoint: "integrate",
      branch,
      sessionId,
      headSha: lease.reviewHeadSha || lease.deliveryHeadSha
        || lease.integration?.commitSha || lease.fenceSha,
      subject: protectedSubject,
      expectedLeaseDigest,
    }),
    expectedLeaseDigest,
    expectedClaimId: lease.cloudAuthority?.claimId || null,
  }, action);
}

function resolveIntegrationEntrypointSubject({ lease, gitText }) {
  if (isReviewReadyIntegrationLease(lease)) {
    const canonicalBaseSha = lease.cloudAuthority?.canonicalBaseSha || lease.baseSha || "";
    if (lease.baseSha !== canonicalBaseSha) return null;
    return requireProtectedSquashSubject(
      gitText([
        "log", "--first-parent", "--no-merges", "-1", "--format=%s",
        `${canonicalBaseSha}..${lease.reviewHeadSha}`,
      ]).replace(/\r?\n$/u, ""),
      { label: "Reviewed authored commit subject" },
    );
  }
  return null;
}

function isReviewReadyDeliveryLease(lease) {
  return lease?.status === "review_ready" &&
    lease.admission?.schema === "agentic-lane-admission-lease/v1" &&
    lease.cloudAuthority?.schema === "agentic-lane-cloud-authority/v1" &&
    lease.cloudAuthority.state === "review_ready" &&
    SHA_PATTERN.test(String(lease.reviewHeadSha || ""));
}

function isLegacyLocalOnlyAutoDeliveryReviewLease(lease) {
  return lease?.status === "review_ready" &&
    lease.autoDelivery === true &&
    lease.runtimeRequired === true &&
    lease.admission == null &&
    lease.cloudAuthority == null &&
    SHA_PATTERN.test(String(lease.reviewHeadSha || ""));
}

function isReviewReadyIntegrationLease(lease) {
  return isReviewReadyDeliveryLease(lease) ||
    isLegacyLocalOnlyAutoDeliveryReviewLease(lease);
}

function requireMergedLegacyLocalOnlyAutoDeliveryPullRequest({ lease, ghText }) {
  const pullRequest = JSON.parse(ghText([
    "pr", "view", lease.pullRequestUrl,
    "--json", "state,baseRefName,url,headRefOid,mergeCommit",
  ]));
  if (
    pullRequest?.url !== lease.pullRequestUrl
    || pullRequest.baseRefName !== "main"
    || pullRequest.state !== "MERGED"
    || pullRequest.headRefOid !== lease.reviewHeadSha
    || !SHA_PATTERN.test(String(pullRequest.mergeCommit?.oid || ""))
  ) {
    throw new Error(
      "Legacy local-only auto-delivery recovery requires the exact already-merged reviewed pull request.",
    );
  }
  return pullRequest;
}

function recoverExpiredDeliveryCloudAuthority({
  lease,
  authority,
  branch,
  headSha,
  gitText,
  ghText,
  run,
  inspectCloudStatus,
  recoverIntegratedCloudAuthority,
  now,
}) {
  const unchanged = () => Object.freeze({ authority, protectedMainRefresh: null });
  if (lease?.status !== "delivery") return unchanged();
  const observedAt = now().getTime();
  const expiresAt = Date.parse(String(authority?.expiresAt || ""));
  if (!Number.isFinite(observedAt)) throw new Error("Delivery replay clock evidence is invalid.");
  // Legacy test doubles and malformed authorities remain subject to the existing verifier;
  // only an exact finite expired authority enters this mutation-capable recovery path.
  if (!Number.isFinite(expiresAt)) return unchanged();
  if (expiresAt > observedAt) return unchanged();

  requireExpiredDeliverySubject({ lease, authority, branch, headSha });
  const preflight = requireExactExpiredDeliveryPullRequest({
    ghText,
    url: lease.pullRequestUrl,
    branch,
    headSha,
    authority,
  });
  let protectedMainRefresh = null;
  if (preflight.headSha === headSha) {
    run("git", ["fetch", "origin", "main"]);
  } else {
    protectedMainRefresh = reconcileProtectedMainRefresh({
      url: lease.pullRequestUrl,
      expectedHeadSha: headSha,
      observedHeadSha: preflight.headSha,
      gitText,
      run,
    });
  }
  if (gitText(["rev-parse", "origin/main"]).trim() !== preflight.liveMainSha) {
    throw new Error("Expired delivery recovery protected-main provider and Git evidence diverged.");
  }
  try {
    gitText(["merge-base", "--is-ancestor", authority.canonicalBaseSha, "origin/main"]);
  } catch {
    throw new Error("Expired delivery recovery protected main diverged from its accepted canonical base.");
  }
  if (protectedMainRefresh && projectRepeatedProtectedRefreshBase({
    acceptedHeadSha: headSha,
    refreshReceipt: protectedMainRefresh,
  }).canonicalBaseSha !== preflight.baseSha) {
    throw new Error("Expired delivery recovery protected-refresh chain drifted from the pull-request base.");
  }
  const status = inspectCloudStatus({
    action: "status",
    ledgerRepository: authority.ledgerRepository,
    request: { targetRepository: authority.targetRepository },
  });
  const integratedClaim = requireExpiredDeliveryClaim({
    status,
    authority,
    admission: lease.admission,
    headSha,
    observedAt,
  });
  const recovered = recoverIntegratedCloudAuthority({
    authority,
    integratedClaim,
    queuedSuccessor: null,
    manifest: lease.admission,
    branch,
    headSha,
    focusedEvidenceDigest: authority.focusedEvidenceDigest,
    deviceId: lease.device,
    sessionId: lease.sessionId,
    inspect: inspectCloudStatus,
  });
  const recoveredAuthority = requireRecoveredExpiredDeliveryAuthority({
    recovered,
    authority,
    integratedClaim,
    admission: lease.admission,
    headSha,
    observedAt: now().getTime(),
  });
  requireExactExpiredDeliveryPullRequest({
    ghText,
    url: lease.pullRequestUrl,
    branch,
    headSha,
    authority,
    expected: preflight,
  });
  return Object.freeze({ authority: recoveredAuthority, protectedMainRefresh });
}

function requireExpiredDeliverySubject({ lease, authority, branch, headSha }) {
  const admission = lease?.admission;
  const integration = authority?.integration;
  const exact = SHA_PATTERN.test(String(headSha || "")) && lease.branch === branch &&
    lease.deliveryHeadSha === headSha && lease.cloudAuthority === authority &&
    admission?.schema === "agentic-lane-admission-lease/v1" && admission.status === "admitted" &&
    DIGEST_PATTERN.test(String(admission.manifestDigest || "")) &&
    DIGEST_PATTERN.test(String(admission.writeSetDigest || "")) &&
    digestValue(admission.declaredWriteSet) === admission.writeSetDigest &&
    authority?.schema === "agentic-lane-cloud-authority/v1" &&
    authority.state === "delivery_authorized" && authority.laneRevision === headSha &&
    authority.writeSetDigest === admission.writeSetDigest &&
    sameValue(authority.cloudDeclaredWriteScope, admission.declaredWriteSet) &&
    authority.manifestDigest === admission.manifestDigest &&
    authority.deviceId === lease.device && authority.sessionId === lease.sessionId &&
    Number.isInteger(authority.leaseEpoch) && authority.leaseEpoch > 0 &&
    typeof authority.reviewRequestId === "string" && authority.reviewRequestId.length > 0 &&
    DIGEST_PATTERN.test(String(authority.focusedEvidenceDigest || "")) &&
    DIGEST_PATTERN.test(String(authority.integrationReceiptDigest || "")) &&
    authority.entrySchema === "agentic-cloud-collaboration-entry/v2" &&
    authority.claimIdentitySchema === "agentic-cloud-collaboration-entry/v2" &&
    DIGEST_PATTERN.test(String(authority.claimId || "")) &&
    DIGEST_PATTERN.test(String(authority.claimDigest || "")) &&
    DIGEST_PATTERN.test(String(authority.claimLedgerRevision || "")) &&
    DIGEST_PATTERN.test(String(authority.operationReceiptDigest || "")) &&
    authority.operationReceiptDigest === authority.integrationReceiptDigest &&
    Number.isSafeInteger(authority.transitionCounter) && authority.transitionCounter > 0 &&
    integration?.candidateRevision === headSha &&
    integration.reviewRequestId === authority.reviewRequestId &&
    integration.focusedEvidenceDigest === authority.focusedEvidenceDigest &&
    DELIVERY_EVIDENCE_FIELDS.every(field => DIGEST_PATTERN.test(String(integration[field] || ""))) &&
    Number.isFinite(Date.parse(String(integration.integratedAt || "")));
  if (!exact) {
    throw new Error("Expired delivery recovery drifted from its exact local reviewed integration subject.");
  }
}

function requireExactExpiredDeliveryPullRequest({
  ghText, url, branch, headSha, authority, expected = null,
}) {
  const subject = parseProtectedMainRefreshUrl(url, { requireGitHubDotCom: true });
  const pullRequest = JSON.parse(ghText([
    "pr", "view", url, "--json",
    "state,baseRefName,baseRefOid,url,headRefOid,mergeCommit,isDraft,isCrossRepository,mergeStateStatus,autoMergeRequest",
  ]));
  const providerPullRequest = readProtectedHeadRefreshPullRequest({ subject, ghText });
  const liveMainSha = readProtectedHeadRefreshTargetMain({ subject, ghText });
  const observedBaseSha = pullRequest?.baseRefOid;
  const observedHeadSha = pullRequest?.headRefOid;
  const common = pullRequest?.url === url && ["OPEN", "MERGED"].includes(pullRequest.state) &&
    pullRequest.baseRefName === "main" && SHA_PATTERN.test(String(observedBaseSha || "")) &&
    SHA_PATTERN.test(String(observedHeadSha || "")) && pullRequest.isDraft === false &&
    pullRequest.isCrossRepository === false && subject.repository === authority.targetRepository &&
    providerPullRequest.html_url === url && providerPullRequest.draft === false &&
    providerPullRequest.base?.ref === "main" && providerPullRequest.base?.sha === observedBaseSha &&
    providerPullRequest.base?.repo?.full_name === authority.targetRepository &&
    providerPullRequest.head?.ref === branch && providerPullRequest.head?.sha === observedHeadSha &&
    providerPullRequest.head?.repo?.full_name === authority.targetRepository &&
    (observedHeadSha !== headSha || observedBaseSha === authority.canonicalBaseSha);
  const open = pullRequest?.state === "OPEN" && pullRequest.mergeCommit === null &&
    providerPullRequest.state === "open" && providerPullRequest.merged === false &&
    pullRequest.autoMergeRequest?.mergeMethod === "SQUASH" &&
    providerPullRequest.auto_merge?.merge_method === "squash";
  const mergeCommitSha = pullRequest?.mergeCommit?.oid;
  const merged = pullRequest?.state === "MERGED" && providerPullRequest.state === "closed" &&
    providerPullRequest.merged === true && SHA_PATTERN.test(String(mergeCommitSha || "")) &&
    providerPullRequest.merge_commit_sha === mergeCommitSha;
  if (!common || (!open && !merged)) {
    throw new Error("Expired delivery recovery pull-request evidence drifted from the exact delivery subject.");
  }
  const projection = Object.freeze({
    state: pullRequest.state,
    url,
    baseSha: observedBaseSha,
    headSha: observedHeadSha,
    liveMainSha,
    mergeCommitSha: merged ? mergeCommitSha : null,
    autoMergeMethod: open ? "SQUASH" : null,
  });
  if (expected && !sameValue(projection, expected)) {
    throw new Error("Expired delivery recovery pull-request evidence changed during cloud convergence.");
  }
  return projection;
}

function requireExpiredDeliveryClaim({ status, authority, admission, headSha, observedAt }) {
  const claim = exactStatusClaim(status, authority.claimId);
  const state = projectRootState(claim?.state);
  const claimExpiry = Date.parse(String(claim?.expiresAt || ""));
  const claimCounterIsValid = Number.isSafeInteger(claim?.transitionCounter) &&
    claim.transitionCounter > 0;
  const recomputedClaimId = claim && digestValue({
    actorId: claim.actorId,
    canonicalBaseRevision: claim.canonicalBaseRevision,
    leaseEpoch: claim.leaseEpoch,
    repositoryId: claim.repositoryId,
    workItemId: claim.workItemId,
    writeSetDigest: claim.writeSetDigest,
  });
  const parkedBaseline = state === "parked" &&
    claimCounterIsValid &&
    claim?.transitionCounter === authority.transitionCounter &&
    claim?.operationReceiptDigest === claim?.integrationReceiptDigest &&
    claim.operationReceiptDigest === authority.operationReceiptDigest;
  const parkedRepeat = state === "parked" &&
    claimCounterIsValid &&
    claim.transitionCounter > authority.transitionCounter &&
    DIGEST_PATTERN.test(String(claim?.operationReceiptDigest || "")) &&
    claim.operationReceiptDigest !== authority.operationReceiptDigest &&
    claim.operationReceiptDigest !== claim.integrationReceiptDigest &&
    Number.isFinite(claimExpiry) &&
    claimExpiry > Date.parse(authority.expiresAt) && claimExpiry <= observedAt &&
    claim.fenceRevision !== authority.claimDigest &&
    claim.transitionDigest !== authority.claimLedgerRevision;
  const transitionIsExact = parkedBaseline || parkedRepeat || (
    state === "delivery_authorized" &&
    claimCounterIsValid &&
    claim?.transitionCounter > authority.transitionCounter && claimExpiry > observedAt
  );
  const exact = claim && ["parked", "delivery_authorized"].includes(state) &&
    claim.entrySchema === "agentic-cloud-collaboration-entry/v2" &&
    claim.claimIdentitySchema === "agentic-cloud-collaboration-entry/v2" &&
    claim.entrySchema === authority.entrySchema &&
    claim.claimIdentitySchema === authority.claimIdentitySchema &&
    claim.claimId === recomputedClaimId && claim.canonicalBaseRevision === authority.canonicalBaseSha &&
    claim.laneRevision === headSha && claim.writeSetDigest === admission.writeSetDigest &&
    sameValue(claim.declaredWriteScope, admission.declaredWriteSet) &&
    claim.leaseEpoch === authority.leaseEpoch && claim.reviewRequestId === authority.reviewRequestId &&
    claim.integrationReceiptDigest === authority.integrationReceiptDigest &&
    sameValue(claim.integration, authority.integration) && transitionIsExact &&
    DIGEST_PATTERN.test(String(claim.fenceRevision || "")) &&
    DIGEST_PATTERN.test(String(claim.transitionDigest || "")) &&
    DIGEST_PATTERN.test(String(claim.operationReceiptDigest || "")) &&
    Number.isFinite(claimExpiry);
  if (!exact) {
    throw new Error("Expired delivery recovery requires one exact integrated-preserved cloud claim.");
  }
  return claim;
}

function requireRecoveredExpiredDeliveryAuthority({
  recovered, authority, integratedClaim, admission, headSha, observedAt,
}) {
  const next = recovered?.authority;
  const evidence = recovered?.convergenceEvidence;
  const verification = recovered?.verification;
  const priorState = projectRootState(integratedClaim?.state);
  const transitionIsExact = priorState === "parked"
    ? next?.transitionCounter > integratedClaim.transitionCounter
    : next?.transitionCounter === integratedClaim.transitionCounter;
  const stableFields = [
    "provider", "ledgerRepository", "targetRepository", "claimId", "entrySchema",
    "claimIdentitySchema", "canonicalBaseSha", "writeSetDigest", "deviceId", "sessionId",
    "reviewRequestId", "leaseEpoch", "focusedEvidenceDigest", "manifestDigest",
    "integrationReceiptDigest",
  ];
  const exact = next?.schema === "agentic-lane-cloud-authority/v1" &&
    stableFields.every(field => sameValue(next[field], authority[field])) &&
    next.state === "delivery_authorized" && next.laneRevision === headSha &&
    sameValue(next.cloudDeclaredWriteScope, admission.declaredWriteSet) &&
    sameValue(next.integration, authority.integration) && transitionIsExact &&
    Number.isFinite(observedAt) && Date.parse(String(next.expiresAt || "")) > observedAt &&
    DIGEST_PATTERN.test(String(next.claimDigest || "")) &&
    DIGEST_PATTERN.test(String(next.claimLedgerRevision || "")) &&
    DIGEST_PATTERN.test(String(next.ledgerDigest || "")) &&
    DIGEST_PATTERN.test(String(next.operationReceiptDigest || "")) &&
    SHA_PATTERN.test(String(next.ledgerRevision || "")) &&
    verification?.schema === "agentic-lane-cloud-verification/v1" &&
    verification.status === "ready" && verification.claimId === next.claimId &&
    verification.claimDigest === next.claimDigest && verification.ledgerRevision === next.ledgerRevision &&
    verification.ledgerDigest === next.ledgerDigest &&
    verification.canonicalBaseSha === next.canonicalBaseSha &&
    verification.laneRevision === headSha && verification.writeSetDigest === admission.writeSetDigest &&
    verification.reviewRequestId === next.reviewRequestId &&
    DIGEST_PATTERN.test(String(verification.receiptDigest || "")) &&
    evidence?.schema === "agentic-integrated-replay-convergence-evidence/v1" &&
    recovered.convergenceEvidenceDigest === digestValue(evidence) &&
    evidence.claimId === next.claimId && evidence.claimDigest === next.claimDigest &&
    evidence.transitionCounter === next.transitionCounter &&
    evidence.currentOperationReceiptDigest === next.operationReceiptDigest &&
    evidence.integrationReceiptDigest === next.integrationReceiptDigest &&
    evidence.canonicalBaseSha === next.canonicalBaseSha &&
    evidence.candidateRevision === headSha && evidence.leaseEpoch === next.leaseEpoch &&
    evidence.reviewRequestId === next.reviewRequestId &&
    evidence.writeSetDigest === admission.writeSetDigest &&
    evidence.focusedEvidenceDigest === next.focusedEvidenceDigest &&
    evidence.manifestDigest === admission.manifestDigest;
  if (!exact) {
    throw new Error("Expired delivery recovery did not return exact verified same-claim convergence evidence.");
  }
  return next;
}

function isDormantPreservedCloudReconciliationError(error) {
  return /Cloud reconciliation cannot recover claim state dormant_preserved\./u
    .test(String(error?.message || ""));
}

function continueReviewReadyCloudAuthorityProjection({
  repo,
  branch,
  lease,
  sessionId,
  runText,
  controllerRoot,
} = {}) {
  const controller = path.resolve(controllerRoot || "");
  if (!controllerRoot || !path.isAbsolute(controllerRoot)) {
    throw new Error("Dormant review recovery requires the absolute Agentic Canvas OS controller root.");
  }
  const output = runText("node", [
    path.join(controller, "scripts", "cloud-authority-handoff-controller.mjs"),
    "reclaim",
    `--repository=${repo}`,
    `--branch=${branch}`,
    `--session=${sessionId}`,
    `--successor-session=${sessionId}`,
    `--successor-device=${lease?.device}`,
    "--json",
  ], { cwd: repo });
  const line = String(output || "").trim().split(/\r?\n/u).reverse()
    .find(value => value.trim().startsWith("{"));
  if (!line) {
    throw new Error("Dormant review recovery returned no machine-readable result.");
  }
  const result = JSON.parse(line);
  if (result?.outcome !== "reclaimed-live" && result?.outcome !== "reclaimed-live-replay") {
    throw new Error(
      `Dormant review recovery did not reclaim the exact review-ready authority: ${result?.error?.message || result?.outcome || "blocked"}.`,
    );
  }
  return result;
}

function pullRequestNumber(value) {
  const match = String(value || "").match(/\/pull\/([1-9]\d*)(?:[/?#]|$)/u);
  if (!match) throw new Error("Delivery authorization requires an exact pull-request URL.");
  return Number(match[1]);
}

function refreshTaskBranchFromMain({ repo, gitText, run, runText, squashSubject }) {
  if (gitText(["status", "--porcelain"]).trim()) {
    throw new Error("Integration commit did not leave a clean task worktree.");
  }
  const refreshSubject = requireProtectedSquashSubject(squashSubject, {
    label: "Integration refresh subject",
  });
  run("git", ["fetch", "origin", "main"]);
  runText("git", ["merge-tree", "--write-tree", "HEAD", "origin/main"], { cwd: repo });
  run("git", ["merge", "-m", refreshSubject, "origin/main"]);
  if (gitText(["status", "--porcelain"]).trim()) {
    throw new Error("Protected-main refresh did not leave a clean task worktree.");
  }
}

function publishActiveWithSuccessorRecovery({
  branch, lease, leaseStore, sessionId, gitText, ghText, publishTask,
  refreshActiveCloudSuccessor, bindActiveCloudSuccessor, verifyActiveCloudSuccessor,
  inspectCloudStatus, invokeCloudSuccessor,
  verifyCloudSuccessor, casActiveLeaseProjection, waitSeconds, pollSeconds, now, sleep,
}) {
  const preparedIntent = lease.activePublishSuccessorIntent
    ? normalizeActivePublishSuccessorIntent(lease.activePublishSuccessorIntent)
    : null;
  if (preparedIntent?.status === "prepared" && !isActivePublishSuccessorCandidate(lease)) {
    throw new Error("Prepared active publish successor recovery lost its admitted cloud authority.");
  }
  if (!isActivePublishSuccessorCandidate(lease)) return publishTask();
  const sourceLeaseDigest = digestValue(lease);
  const headSha = requireSha(gitText(["rev-parse", "HEAD"]).trim(), "active publish HEAD");
  const synchronized = readExactActivePublishSubject({ branch, lease, headSha, gitText, ghText });
  if (preparedIntent?.status === "prepared" && !synchronized) {
    throw new Error(
      "Prepared active publish successor recovery requires exact local, remote, and pull-request heads.",
    );
  }
  if (synchronized) {
    refreshActivePublishSuccessor({
      branch, lease, leaseStore, sessionId, headSha, subject: synchronized, gitText, ghText,
      refreshActiveCloudSuccessor, bindActiveCloudSuccessor, verifyActiveCloudSuccessor,
      inspectCloudStatus, invokeCloudSuccessor,
      verifyCloudSuccessor, casActiveLeaseProjection, sourceLeaseDigest,
      now,
    });
  }
  try {
    publishTask();
    return;
  } catch (error) {
    if (synchronized || !isRecoverableActivePublishError(error)) throw error;
    const subject = waitForExactActivePublishSubject({
      branch, lease, leaseStore, headSha, sourceLeaseDigest, gitText, ghText,
      waitSeconds, pollSeconds, now, sleep, originalError: error,
    });
    refreshActivePublishSuccessor({
      branch, lease, leaseStore, sessionId, headSha, subject, gitText, ghText,
      refreshActiveCloudSuccessor, bindActiveCloudSuccessor, verifyActiveCloudSuccessor,
      inspectCloudStatus, invokeCloudSuccessor,
      verifyCloudSuccessor, casActiveLeaseProjection, sourceLeaseDigest,
      now,
    });
    publishTask();
  }
}

function isActivePublishSuccessorCandidate(lease) {
  return lease?.admission?.schema === "agentic-lane-admission-lease/v1" &&
    lease.admission.status === "admitted" &&
    lease.cloudAuthority?.schema === "agentic-lane-cloud-authority/v1" &&
    lease.cloudAuthority.state === "active" && Boolean(lease.cloudAuthority.reviewRequestId);
}

function readExactActivePublishSubject({ branch, lease, headSha, gitText, ghText }) {
  const pullRequest = JSON.parse(ghText([
    "pr", "view", lease.pullRequestUrl, "--json",
    "id,url,state,isDraft,baseRefName,baseRefOid,headRefName,headRefOid,headRepository",
  ]));
  if (pullRequest.url !== lease.pullRequestUrl || pullRequest.state !== "OPEN" ||
      pullRequest.isDraft !== true || pullRequest.baseRefName !== "main" ||
      pullRequest.headRefName !== branch || !SHA_PATTERN.test(String(pullRequest.baseRefOid || "")) ||
      lease.cloudAuthority.reviewRequestId !== `github-pull-request:${pullRequest.id}` ||
      pullRequest.headRepository?.nameWithOwner !== lease.cloudAuthority.targetRepository) {
    throw new Error("Active publish successor requires the exact open draft ownership pull request.");
  }
  let remote;
  try {
    remote = parseRemoteHeads(gitText([
      "ls-remote", "--heads", "origin", "refs/heads/main", `refs/heads/${branch}`,
    ]));
  } catch (error) {
    if (error?.message?.startsWith("Active publish successor remote-head evidence")) throw error;
    return null;
  }
  const remoteHeadSha = remote.get(`refs/heads/${branch}`) || null;
  const remoteBaseSha = remote.get("refs/heads/main") || null;
  if (!remoteHeadSha || !remoteBaseSha) return null;
  if (remoteBaseSha !== pullRequest.baseRefOid) {
    try {
      gitText(["merge-base", "--is-ancestor", pullRequest.baseRefOid, remoteBaseSha]);
    } catch {
      throw new Error("Active publish successor pull-request base diverged from the fetched canonical head.");
    }
    return null;
  }
  if (remoteHeadSha !== headSha || pullRequest.headRefOid !== headSha) return null;
  requireActivePublishBaseAncestor({ gitText, canonicalBaseSha: remoteBaseSha, headSha });
  return Object.freeze({ pullRequest, canonicalBaseSha: pullRequest.baseRefOid });
}

function waitForExactActivePublishSubject({
  branch, lease, leaseStore, headSha, sourceLeaseDigest, gitText, ghText,
  waitSeconds, pollSeconds, now, sleep, originalError,
}) {
  const deadline = now().getTime() + waitSeconds * 1_000;
  while (true) {
    requireUnchangedActivePublishLease({ leaseStore, branch, sourceLeaseDigest, lease });
    if (gitText(["rev-parse", "HEAD"]).trim() !== headSha) {
      throw new Error("Active publish HEAD changed during bounded successor recovery.");
    }
    const subject = readExactActivePublishSubject({ branch, lease, headSha, gitText, ghText });
    if (subject) return subject;
    if (now().getTime() >= deadline) {
      throw new Error(
        `${originalError.message}; pushed branch and pull-request heads did not converge before bounded recovery expired.`,
        { cause: originalError },
      );
    }
    sleep(pollSeconds * 1_000);
  }
}

function refreshActivePublishSuccessor({
  branch, lease, leaseStore, sessionId, headSha, subject, gitText, ghText,
  refreshActiveCloudSuccessor, bindActiveCloudSuccessor, verifyActiveCloudSuccessor,
  inspectCloudStatus, invokeCloudSuccessor, verifyCloudSuccessor,
  casActiveLeaseProjection, sourceLeaseDigest, now,
}) {
  const source = lease.cloudAuthority;
  const admission = lease.admission;
  const hasPreparedIntent = lease.activePublishSuccessorIntent?.status === "prepared";
  if (source.canonicalBaseSha === subject.canonicalBaseSha && !hasPreparedIntent) return null;
  requireUnchangedActivePublishLease({ leaseStore, branch, sourceLeaseDigest, lease });
  const paths = splitNul(gitText([
    "diff", "--name-only", "-z", `${subject.canonicalBaseSha}..${headSha}`, "--",
  ]));
  assertActivePublishPathsAdmitted({ paths, admission });
  const manifest = Object.freeze({
    semanticScope: admission.semanticScope,
    declaredWriteSet: admission.declaredWriteSet,
    writeSetDigest: admission.writeSetDigest,
    manifestDigest: admission.manifestDigest,
  });
  requireActivePublishBaseAncestor({
    gitText,
    canonicalBaseSha: subject.canonicalBaseSha,
    headSha,
  });
  const status = inspectActivePublishCloudStatus({ source, inspectCloudStatus });
  const recordedIntent = lease.activePublishSuccessorIntent
    ? normalizeActivePublishSuccessorIntent(lease.activePublishSuccessorIntent)
    : null;
  let intent = recordedIntent?.status === "prepared"
    ? requireActivePublishSuccessorIntent({ lease, source, admission, subject, headSha })
    : null;
  if (!intent) {
    const predecessor = requireExactActivePublishClaim({ status, authority: source, admission });
    intent = createActivePublishSuccessorIntent({
      lease, source, admission, predecessor, subject, headSha, now,
    });
    const prepared = casActiveLeaseProjection({
      leaseStore,
      branch,
      expectedLeaseDigest: sourceLeaseDigest,
      expectedClaimId: source.claimId,
      values: { status: "active", activePublishSuccessorIntent: intent },
    });
    lease = prepared.lease;
    requireActivePublishSuccessorIntent({ lease, source, admission, subject, headSha });
  }
  requireActivePublishBaseAncestor({
    gitText,
    canonicalBaseSha: subject.canonicalBaseSha,
    headSha,
  });
  const successor = resolveActivePublishCloudSuccessor({
    status, intent, source, admission, lease, branch, headSha, sessionId,
    refreshActiveCloudSuccessor, bindActiveCloudSuccessor, verifyActiveCloudSuccessor,
    inspectCloudStatus, invokeCloudSuccessor, verifyCloudSuccessor,
  });
  const postStatus = inspectCloudStatus({
    action: "status", ledgerRepository: source.ledgerRepository,
    request: { targetRepository: source.targetRepository },
  });
  const predecessor = { claimId: intent.sourceClaimId, workItemId: intent.sourceWorkItemId };
  requireExactActivePublishSuccessor({
    successor, postStatus, predecessor, source, admission, manifest,
    canonicalBaseSha: subject.canonicalBaseSha, headSha, lease, sessionId,
  });
  if (gitText(["rev-parse", "HEAD"]).trim() !== headSha) {
    throw new Error("Active publish HEAD changed before successor local projection.");
  }
  const revalidatedSubject = readExactActivePublishSubject({ branch, lease, headSha, gitText, ghText });
  if (!revalidatedSubject || revalidatedSubject.canonicalBaseSha !== subject.canonicalBaseSha ||
      revalidatedSubject.pullRequest.id !== subject.pullRequest.id ||
      revalidatedSubject.pullRequest.url !== subject.pullRequest.url) {
    throw new Error("Active publish successor subject drifted before its local projection CAS.");
  }
  const current = leaseStore.read(branch);
  requireActivePublishSuccessorIntent({ lease: current, source, admission, subject, headSha });
  const completedAt = now().toISOString();
  if (Date.parse(successor.authority.expiresAt) <= Date.parse(completedAt)) {
    throw new Error("Active publish successor expired before its local projection CAS.");
  }
  const admissionProjection = projectActivePublishSuccessorAdmission({
    lease, admission, manifest, successor, predecessor, headSha,
  });
  const successorValues = {
    status: "active",
    baseSha: subject.canonicalBaseSha,
    fenceSha: headSha,
    heartbeatAt: completedAt,
    expiresAt: successor.authority.expiresAt,
    admission: admissionProjection,
    cloudAuthority: successor.authority,
    activePublishSuccessorIntent: null,
  };
  const targetLease = { ...current, ...successorValues };
  const taskAuthoritySuccessor = current.taskAuthority
    ? continueActivePublishTaskAuthoritySuccessor({
      sourceLease: current,
      targetLease,
      cloudOperationReceiptDigest: successor.authority.operationReceiptDigest,
      cloudVerificationReceiptDigest: successor.verification.receiptDigest,
      boundAt: completedAt,
    })
    : null;
  return casActiveLeaseProjection({
    leaseStore,
    branch,
    expectedLeaseDigest: digestValue(current),
    expectedClaimId: source.claimId,
    values: {
      ...successorValues,
      ...(taskAuthoritySuccessor ? {
        taskAuthority: taskAuthoritySuccessor.binding,
        activePublishTaskAuthoritySuccessor: taskAuthoritySuccessor.receipt,
      } : {}),
    },
  });
}

function inspectActivePublishCloudStatus({ source, inspectCloudStatus }) {
  return inspectCloudStatus({
    action: "status",
    ledgerRepository: source.ledgerRepository,
    request: { targetRepository: source.targetRepository },
  });
}

function resolveActivePublishCloudSuccessor({
  status, intent, source, admission, lease, branch, headSha, sessionId,
  refreshActiveCloudSuccessor, bindActiveCloudSuccessor, verifyActiveCloudSuccessor,
  inspectCloudStatus, invokeCloudSuccessor, verifyCloudSuccessor,
}) {
  const exactInvoke = fenceActivePublishSuccessorClaimEpoch({
    intent,
    invoke: invokeCloudSuccessor,
  });
  const common = {
    ledgerRepository: source.ledgerRepository,
    targetRepository: source.targetRepository,
    manifest: admission,
    canonicalBaseSha: intent.targetCanonicalBaseSha,
    branch,
    headSha,
    pullRequestNumber: intent.targetPullRequestNumber,
    deviceId: lease.device,
    sessionId,
    workItemId: intent.sourceWorkItemId,
    leaseEpoch: intent.targetLeaseEpoch,
    inspect: inspectCloudStatus,
    invoke: exactInvoke,
    verify: verifyCloudSuccessor,
  };
  const predecessor = exactActivePublishClaim({ status, authority: source, admission });
  if (predecessor) {
    const exactSource = predecessor.actorId === intent.sourceActorId &&
      predecessor.repositoryId === intent.sourceRepositoryId &&
      predecessor.workItemId === intent.sourceWorkItemId &&
      predecessor.entrySchema === intent.sourceEntrySchema &&
      predecessor.claimIdentitySchema === intent.sourceClaimIdentitySchema;
    if (!exactSource) {
      throw new Error("Active publish predecessor drifted from its prepared successor intent.");
    }
    return refreshActiveCloudSuccessor(common);
  }
  const derivative = requireActivePublishDerivative({ status, intent, admission });
  if (derivative.state === "waiting-successor") return refreshActiveCloudSuccessor(common);
  const authority = activePublishDerivativeAuthority({
    status, claim: derivative, source, admission, lease, sessionId,
  });
  if (derivative.laneRevision === intent.targetCanonicalBaseSha) {
    return bindActiveCloudSuccessor({
      authority,
      manifest: admission,
      branch,
      headSha,
      pullRequestNumber: intent.targetPullRequestNumber,
      reviewRequestId: intent.sourceReviewRequestId,
      deviceId: lease.device,
      sessionId,
      returnVerification: true,
      inspect: inspectCloudStatus,
      invoke: exactInvoke,
      verify: verifyCloudSuccessor,
    });
  }
  return verifyActiveCloudSuccessor({
    authority,
    manifest: admission,
    canonicalBaseSha: intent.targetCanonicalBaseSha,
    inspect: inspectCloudStatus,
    invoke: verifyCloudSuccessor,
  });
}

function fenceActivePublishSuccessorClaimEpoch({ intent, invoke }) {
  return input => {
    if (input?.action === "claim" && input?.request?.leaseEpoch !== intent.targetLeaseEpoch) {
      throw new Error("Active publish successor claim epoch drifted from its durable intent.");
    }
    return invoke(input);
  };
}

const ACTIVE_PUBLISH_SUCCESSOR_INTENT_SCHEMA =
  "agentic-active-publish-successor-intent/v1";

function createActivePublishSuccessorIntent({
  lease, source, admission, predecessor, subject, headSha, now,
}) {
  return sealActivePublishSuccessorIntent({
    schema: ACTIVE_PUBLISH_SUCCESSOR_INTENT_SCHEMA,
    status: "prepared",
    branch: lease.branch,
    sourceLeaseDigest: digestValue(lease),
    sourceStableLeaseDigest: activePublishSourceStableDigest(lease),
    sourceClaimId: source.claimId,
    sourceClaimDigest: source.claimDigest,
    sourceClaimLedgerRevision: source.claimLedgerRevision,
    sourceCanonicalBaseSha: source.canonicalBaseSha,
    sourceLaneRevision: source.laneRevision,
    sourceLeaseEpoch: source.leaseEpoch,
    sourceTransitionCounter: source.transitionCounter,
    sourceReviewRequestId: source.reviewRequestId,
    sourceActorId: predecessor.actorId,
    sourceRepositoryId: predecessor.repositoryId,
    sourceWorkItemId: predecessor.workItemId,
    sourceEntrySchema: predecessor.entrySchema,
    sourceClaimIdentitySchema: predecessor.claimIdentitySchema,
    sourceDeviceId: lease.device,
    sourceSessionId: lease.sessionId,
    targetCanonicalBaseSha: subject.canonicalBaseSha,
    targetHeadSha: headSha,
    targetPullRequestId: subject.pullRequest.id,
    targetPullRequestUrl: subject.pullRequest.url,
    targetPullRequestNumber: pullRequestNumber(subject.pullRequest.url),
    targetRepository: source.targetRepository,
    targetLeaseEpoch: source.leaseEpoch + 1,
    admissionSchema: admission.schema,
    semanticScope: admission.semanticScope,
    manifestDigest: admission.manifestDigest,
    writeSetDigest: admission.writeSetDigest,
    admittedReportDigest: admission.admittedReportDigest,
    createdAt: now().toISOString(),
    successorClaimId: null,
    successorClaimDigest: null,
    successorVerificationReceiptDigest: null,
    completedAt: null,
  });
}

function requireActivePublishSuccessorIntent({ lease, source, admission, subject, headSha }) {
  const intent = normalizeActivePublishSuccessorIntent(lease.activePublishSuccessorIntent);
  const exact = intent.status === "prepared" && lease.status === "active" &&
    intent.branch === lease.branch && intent.sourceStableLeaseDigest === activePublishSourceStableDigest(lease) &&
    intent.sourceClaimId === source.claimId && intent.sourceClaimDigest === source.claimDigest &&
    intent.sourceClaimLedgerRevision === source.claimLedgerRevision &&
    intent.sourceCanonicalBaseSha === source.canonicalBaseSha &&
    intent.sourceLaneRevision === source.laneRevision && intent.sourceLeaseEpoch === source.leaseEpoch &&
    intent.sourceTransitionCounter === source.transitionCounter &&
    intent.sourceReviewRequestId === source.reviewRequestId &&
    intent.sourceDeviceId === lease.device && intent.sourceSessionId === lease.sessionId &&
    intent.targetCanonicalBaseSha !== intent.sourceCanonicalBaseSha &&
    intent.targetCanonicalBaseSha === subject.canonicalBaseSha && intent.targetHeadSha === headSha &&
    intent.targetPullRequestId === subject.pullRequest.id &&
    intent.targetPullRequestUrl === subject.pullRequest.url &&
    intent.targetPullRequestNumber === pullRequestNumber(subject.pullRequest.url) &&
    intent.targetRepository === source.targetRepository &&
    intent.targetLeaseEpoch === source.leaseEpoch + 1 &&
    intent.admissionSchema === admission.schema && intent.semanticScope === admission.semanticScope &&
    intent.manifestDigest === admission.manifestDigest && intent.writeSetDigest === admission.writeSetDigest &&
    intent.admittedReportDigest === admission.admittedReportDigest;
  if (!exact) throw new Error("Active publish successor intent drifted from its exact source or target subject.");
  return intent;
}

function normalizeActivePublishSuccessorIntent(value) {
  if (!value || value.schema !== ACTIVE_PUBLISH_SUCCESSOR_INTENT_SCHEMA ||
      !["prepared", "complete"].includes(value.status)) {
    throw new Error("Active publish successor intent is missing or malformed.");
  }
  const core = {
    schema: value.schema,
    status: value.status,
    branch: requiredIntentText(value.branch),
    sourceLeaseDigest: requiredIntentDigest(value.sourceLeaseDigest),
    sourceStableLeaseDigest: requiredIntentDigest(value.sourceStableLeaseDigest),
    sourceClaimId: requiredIntentDigest(value.sourceClaimId),
    sourceClaimDigest: requiredIntentDigest(value.sourceClaimDigest),
    sourceClaimLedgerRevision: requiredIntentDigest(value.sourceClaimLedgerRevision),
    sourceCanonicalBaseSha: requireSha(value.sourceCanonicalBaseSha, "intent source canonical base"),
    sourceLaneRevision: requireSha(value.sourceLaneRevision, "intent source lane revision"),
    sourceLeaseEpoch: requiredPositiveInteger(value.sourceLeaseEpoch),
    sourceTransitionCounter: requiredPositiveInteger(value.sourceTransitionCounter),
    sourceReviewRequestId: requiredIntentText(value.sourceReviewRequestId),
    sourceActorId: requiredIntentText(value.sourceActorId),
    sourceRepositoryId: requiredIntentText(value.sourceRepositoryId),
    sourceWorkItemId: requiredIntentText(value.sourceWorkItemId),
    sourceEntrySchema: requiredIntentText(value.sourceEntrySchema),
    sourceClaimIdentitySchema: requiredIntentText(value.sourceClaimIdentitySchema),
    sourceDeviceId: requiredIntentText(value.sourceDeviceId),
    sourceSessionId: requiredIntentText(value.sourceSessionId),
    targetCanonicalBaseSha: requireSha(value.targetCanonicalBaseSha, "intent target canonical base"),
    targetHeadSha: requireSha(value.targetHeadSha, "intent target head"),
    targetPullRequestId: requiredIntentText(value.targetPullRequestId),
    targetPullRequestUrl: requiredIntentText(value.targetPullRequestUrl),
    targetPullRequestNumber: requiredPositiveInteger(value.targetPullRequestNumber),
    targetRepository: requiredIntentText(value.targetRepository),
    targetLeaseEpoch: requiredPositiveInteger(value.targetLeaseEpoch),
    admissionSchema: requiredIntentText(value.admissionSchema),
    semanticScope: requiredIntentText(value.semanticScope),
    manifestDigest: requiredIntentDigest(value.manifestDigest),
    writeSetDigest: requiredIntentDigest(value.writeSetDigest),
    admittedReportDigest: requiredIntentDigest(value.admittedReportDigest),
    createdAt: requiredIntentInstant(value.createdAt),
    successorClaimId: optionalIntentDigest(value.successorClaimId),
    successorClaimDigest: optionalIntentDigest(value.successorClaimDigest),
    successorVerificationReceiptDigest: optionalIntentDigest(value.successorVerificationReceiptDigest),
    completedAt: value.completedAt ? requiredIntentInstant(value.completedAt) : null,
  };
  const complete = core.status === "complete";
  if (complete !== Boolean(core.successorClaimId && core.successorClaimDigest &&
      core.successorVerificationReceiptDigest && core.completedAt)) {
    throw new Error("Active publish successor intent completion evidence is inconsistent.");
  }
  const intentDigest = requiredIntentDigest(value.intentDigest);
  if (digestValue(core) !== intentDigest) throw new Error("Active publish successor intent digest is invalid.");
  return Object.freeze({ ...core, intentDigest });
}

function sealActivePublishSuccessorIntent(value) {
  const { intentDigest: _ignored, ...core } = value;
  return normalizeActivePublishSuccessorIntent({ ...core, intentDigest: digestValue(core) });
}

function activePublishSourceStableDigest(lease) {
  const {
    activePublishSuccessorIntent: _intent,
    heartbeatAt: _heartbeatAt,
    expiresAt: _expiresAt,
    status: _status,
    ...stable
  } = lease;
  return digestValue({ ...stable, status: "active" });
}

function requireActivePublishDerivative({ status, intent, admission }) {
  if (!isExactActivePublishStatus(status)) {
    throw new Error("Active publish successor status evidence is malformed.");
  }
  const derivatives = Array.isArray(status?.claims) ? status.claims.filter(claim =>
    claim?.claimId !== intent.sourceClaimId && claim?.predecessorClaimId === intent.sourceClaimId) : [];
  const claim = derivatives.length === 1 ? derivatives[0] : null;
  const waiting = claim?.state === "waiting-successor" &&
    claim.laneRevision === intent.targetCanonicalBaseSha && !claim.reviewRequestId;
  const currentAtBase = ["active", "current"].includes(claim?.state) &&
    claim.laneRevision === intent.targetCanonicalBaseSha && !claim.reviewRequestId;
  const currentBound = ["active", "current"].includes(claim?.state) &&
    claim.laneRevision === intent.targetHeadSha && claim.reviewRequestId === intent.sourceReviewRequestId;
  const exact = claim && (waiting || currentAtBase || currentBound) &&
    claim.actorId === intent.sourceActorId && claim.repositoryId === intent.sourceRepositoryId &&
    claim.workItemId === intent.sourceWorkItemId &&
    claim.entrySchema === intent.sourceEntrySchema &&
    claim.claimIdentitySchema === intent.sourceClaimIdentitySchema &&
    claim.canonicalBaseRevision === intent.targetCanonicalBaseSha &&
    claim.leaseEpoch === intent.targetLeaseEpoch &&
    claim.writeSetDigest === intent.writeSetDigest &&
    sameValue(claim.declaredWriteScope, admission.declaredWriteSet) &&
    DIGEST_PATTERN.test(String(claim.claimId || "")) &&
    DIGEST_PATTERN.test(String(claim.fenceRevision || "")) &&
    DIGEST_PATTERN.test(String(claim.transitionDigest || "")) &&
    DIGEST_PATTERN.test(String(claim.operationReceiptDigest || "")) &&
    Number.isInteger(claim.transitionCounter) && claim.transitionCounter > 0;
  if (!exact) throw new Error("Active publish successor intent has no exact resumable derivative claim.");
  return claim;
}

function activePublishDerivativeAuthority({ status, claim, source, admission, lease, sessionId }) {
  return normalizeBoundAuthority({
    result: {
      schema: "agentic-cloud-collaboration-result/v1",
      ok: true,
      action: "continue",
      ledgerRevision: status.ledgerRevision,
      ledgerDigest: status.ledgerDigest,
      claimDigest: claim.fenceRevision,
      claim,
    },
    authority: {
      ...source,
      canonicalBaseSha: claim.canonicalBaseRevision,
      laneRevision: claim.laneRevision,
      cloudDeclaredWriteScope: claim.declaredWriteScope,
      writeSetDigest: claim.writeSetDigest,
      leaseEpoch: claim.leaseEpoch,
      transitionCounter: claim.transitionCounter,
      reviewRequestId: claim.reviewRequestId || null,
      state: "active",
      expiresAt: claim.expiresAt,
      manifestDigest: admission.manifestDigest,
    },
    manifest: admission,
    deviceId: lease.device,
    sessionId,
  });
}

function requiredIntentText(value) {
  const text = String(value || "").trim();
  if (!text) throw new Error("Active publish successor intent text evidence is missing.");
  return text;
}

function requiredIntentDigest(value) {
  if (!DIGEST_PATTERN.test(String(value || ""))) {
    throw new Error("Active publish successor intent digest evidence is malformed.");
  }
  return String(value);
}

function optionalIntentDigest(value) {
  return value === null || value === undefined ? null : requiredIntentDigest(value);
}

function requiredPositiveInteger(value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("Active publish successor intent integer evidence is malformed.");
  }
  return value;
}

function requiredIntentInstant(value) {
  if (!Number.isFinite(Date.parse(String(value || "")))) {
    throw new Error("Active publish successor intent timestamp evidence is malformed.");
  }
  return new Date(value).toISOString();
}

function isRecoverableActivePublishError(error) {
  const message = String(error?.message || "");
  return message === "Cloud collaboration projection targets another canonical base." ||
    message === "Cloud collaboration continue failed: Supplied canonical base does not match the resolved pull request.; " +
      "exact live bind reconciliation failed: Live cloud claim drifted from the recoverable admission subject." ||
    /^Ownership pull request head [0-9a-f]{40} does not match local head [0-9a-f]{40}\.$/u.test(message);
}

function requireUnchangedActivePublishLease({ leaseStore, branch, sourceLeaseDigest, lease }) {
  const current = leaseStore.read(branch);
  if (digestValue(current) !== sourceLeaseDigest ||
      current?.cloudAuthority?.claimId !== lease.cloudAuthority?.claimId) {
    throw new Error("Active publish lease or predecessor claim changed during successor recovery.");
  }
  return current;
}

function requireExactActivePublishClaim({ status, authority, admission }) {
  const claim = exactActivePublishClaim({ status, authority, admission });
  if (!claim) {
    throw new Error("Active publish predecessor drifted from its exact current cloud projection.");
  }
  return claim;
}

function exactActivePublishClaim({ status, authority, admission }) {
  const claim = exactStatusClaim(status, authority.claimId);
  const fallbackManifestDigest = digestValue({
    declaredWriteSet: admission.declaredWriteSet,
    writeSetDigest: admission.writeSetDigest,
  });
  const exact = ["active", "current"].includes(claim?.state) &&
    authority.writeSetDigest === admission.writeSetDigest &&
    sameValue(authority.cloudDeclaredWriteScope, admission.declaredWriteSet) &&
    [admission.manifestDigest, fallbackManifestDigest].includes(authority.manifestDigest) &&
    sameProjection(claim, authority, ACTIVE_CLAIM_AUTHORITY_FIELDS) &&
    sameValue(claim.declaredWriteScope, admission.declaredWriteSet) &&
    typeof claim.workItemId === "string" && claim.workItemId.length > 0;
  return exact ? claim : null;
}

function requireExactActivePublishSuccessor({
  successor, postStatus, predecessor, source, admission, manifest,
  canonicalBaseSha, headSha, lease, sessionId,
}) {
  const authority = successor?.authority;
  const verification = successor?.verification;
  const live = exactStatusClaim(postStatus, authority?.claimId);
  const verified = exactClaim(verification?.inventory?.claims, authority?.claimId);
  const exact = authority?.schema === "agentic-lane-cloud-authority/v1" &&
    authority.state === "active" && authority.claimId !== source.claimId &&
    authority.ledgerRepository === source.ledgerRepository &&
    authority.targetRepository === source.targetRepository &&
    authority.canonicalBaseSha === canonicalBaseSha && authority.laneRevision === headSha &&
    authority.writeSetDigest === manifest.writeSetDigest &&
    JSON.stringify(authority.cloudDeclaredWriteScope) === JSON.stringify(manifest.declaredWriteSet) &&
    authority.deviceId === lease.device && authority.sessionId === sessionId &&
    authority.leaseEpoch === source.leaseEpoch + 1 &&
    authority.reviewRequestId === source.reviewRequestId &&
    verification?.schema === "agentic-lane-cloud-verification/v1" &&
    verification.status === "ready" && verification.claimId === authority.claimId &&
    verification.claimDigest === authority.claimDigest &&
    verification.ledgerRevision === authority.ledgerRevision &&
    verification.ledgerDigest === authority.ledgerDigest &&
    verification.canonicalBaseSha === canonicalBaseSha &&
    verification.laneRevision === headSha && verification.writeSetDigest === admission.writeSetDigest &&
    verification.reviewRequestId === authority.reviewRequestId &&
    verification.remoteClaimInventoryDigest === verification.inventory?.inventoryDigest &&
    hasExactInventoryDigest(verification.inventory) &&
    DIGEST_PATTERN.test(String(verification.receiptDigest || "")) &&
    Number.isFinite(Date.parse(verification.verifiedAt)) &&
    live?.predecessorClaimId === source.claimId && live.workItemId === predecessor.workItemId &&
    ["active", "current"].includes(live.state) &&
    sameProjection(live, authority, ACTIVE_CLAIM_AUTHORITY_FIELDS) &&
    sameValue(live.declaredWriteScope, manifest.declaredWriteSet) &&
    verified?.workItemId === predecessor.workItemId && verified.leaseEpoch === source.leaseEpoch + 1 &&
    verified.state === "active" &&
    sameProjection(verified, live, CURRENT_CLAIM_FIELDS) &&
    sameValue(verified.declaredWriteScope, live.declaredWriteScope);
  if (!exact) {
    throw new Error("Active publish successor lacks exact predecessor, subject, or verification evidence.");
  }
}

function projectActivePublishSuccessorAdmission({
  lease, admission, manifest, successor, predecessor, headSha,
}) {
  const authority = successor.authority;
  const verification = successor.verification;
  const existingLaneStateDigest = digestValue({
    schema: "agentic-active-publish-successor-state/v1",
    branch: lease.branch, worktreePath: lease.worktreePath,
    sourceBaseSha: lease.baseSha, sourceFenceSha: lease.fenceSha,
    sourceClaimId: predecessor.claimId, canonicalBaseSha: authority.canonicalBaseSha, headSha,
    sourceAdmittedReportDigest: admission.admittedReportDigest,
  });
  const planReceiptDigest = digestValue({
    schema: "agentic-active-publish-successor-plan/v1",
    sourcePlanReceiptDigest: admission.planReceiptDigest,
    sourceAdmissionReceiptDigest: admission.admissionReceiptDigest,
    sourceAdmittedReportDigest: admission.admittedReportDigest,
    manifestDigest: manifest.manifestDigest, writeSetDigest: manifest.writeSetDigest,
    existingLaneStateDigest,
  });
  const preservationReceiptDigest = digestValue({
    schema: "agentic-active-publish-successor-preservation/v1",
    predecessorClaimId: predecessor.claimId, successorClaimId: authority.claimId,
    claimDigest: authority.claimDigest, manifestDigest: manifest.manifestDigest,
    sourceAdmittedReportDigest: admission.admittedReportDigest,
    existingLaneStateDigest,
  });
  const admittedReportDigest = digestValue({
    schema: "agentic-active-publish-successor-admission/v1",
    branch: lease.branch, semanticScope: manifest.semanticScope,
    manifestDigest: manifest.manifestDigest, writeSetDigest: manifest.writeSetDigest,
    canonicalBaseSha: authority.canonicalBaseSha, laneRevision: authority.laneRevision,
    claimId: authority.claimId, claimDigest: authority.claimDigest,
    verificationReceiptDigest: verification.receiptDigest, preservationReceiptDigest,
  });
  return Object.freeze({
    schema: "agentic-lane-admission-lease/v1", status: "admitted",
    semanticScope: manifest.semanticScope, declaredWriteSet: manifest.declaredWriteSet,
    writeSetDigest: manifest.writeSetDigest, manifestDigest: manifest.manifestDigest,
    planReceiptDigest, admissionReceiptDigest: verification.receiptDigest,
    existingLaneStateDigest, admittedReportDigest, preservationReceiptDigest,
  });
}

const ACTIVE_CLAIM_AUTHORITY_FIELDS = Object.freeze([
  ["claimId", "claimId"], ["canonicalBaseRevision", "canonicalBaseSha"],
  ["laneRevision", "laneRevision"], ["writeSetDigest", "writeSetDigest"],
  ["leaseEpoch", "leaseEpoch"], ["transitionCounter", "transitionCounter"],
  ["reviewRequestId", "reviewRequestId"], ["expiresAt", "expiresAt"],
  ["fenceRevision", "claimDigest"], ["transitionDigest", "claimLedgerRevision"],
  ["operationReceiptDigest", "operationReceiptDigest"],
  ["integrationReceiptDigest", "integrationReceiptDigest"], ["integration", "integration"],
  ["entrySchema", "entrySchema"], ["claimIdentitySchema", "claimIdentitySchema"],
]);
const CURRENT_CLAIM_FIELDS = Object.freeze([
  "claimId", "entrySchema", "claimIdentitySchema", "operationReceiptDigest",
  "actorId", "repositoryId", "workItemId", "canonicalBaseRevision", "laneRevision",
  "writeSetDigest", "leaseEpoch", "transitionCounter", "reviewRequestId", "expiresAt",
  "fenceRevision", "transitionDigest",
]);

function exactStatusClaim(status, claimId) {
  if (!isExactActivePublishStatus(status)) return null;
  return exactClaim(status.claims, claimId);
}

function isExactActivePublishStatus(status) {
  return status?.schema === "agentic-cloud-collaboration-result/v1" && status.ok === true &&
    status.action === "status" && status.status === "ready" &&
    SHA_PATTERN.test(String(status.ledgerRevision || "")) &&
    DIGEST_PATTERN.test(String(status.ledgerDigest || ""));
}

function exactClaim(claims, claimId) {
  const matches = Array.isArray(claims)
    ? claims.filter(claim => claim?.claimId === claimId) : [];
  return matches.length === 1 ? matches[0] : null;
}

function sameProjection(left, right, fields) {
  return Boolean(left && right) && fields.every(field => {
    const [leftKey, rightKey = leftKey] = Array.isArray(field) ? field : [field, field];
    return sameValue(left[leftKey], right[rightKey]);
  });
}

function sameValue(left, right) {
  return left === right || (left !== undefined && right !== undefined &&
    JSON.stringify(left) === JSON.stringify(right));
}

function hasExactInventoryDigest(inventory) {
  if (!inventory || !DIGEST_PATTERN.test(String(inventory.inventoryDigest || ""))) return false;
  const { inventoryDigest, ...subject } = inventory;
  return digestValue(subject) === inventoryDigest;
}

function parseRemoteHeads(value) {
  const heads = new Map();
  for (const line of String(value || "").trim().split(/\r?\n/u).filter(Boolean)) {
    const [sha, ref, ...extra] = line.trim().split(/\s+/u);
    if (!SHA_PATTERN.test(String(sha || "")) || !ref?.startsWith("refs/heads/") || extra.length) {
      throw new Error("Active publish successor remote-head evidence is malformed.");
    }
    if (heads.has(ref)) throw new Error("Active publish successor remote-head evidence is ambiguous.");
    heads.set(ref, sha);
  }
  return heads;
}

function requireActivePublishBaseAncestor({ gitText, canonicalBaseSha, headSha }) {
  try {
    gitText(["merge-base", "--is-ancestor", canonicalBaseSha, headSha]);
  } catch {
    throw new Error("Active publish successor head does not contain the live canonical base.");
  }
}

function requireSha(value, label) {
  if (!SHA_PATTERN.test(String(value || ""))) throw new Error(`${label} must be an exact commit SHA.`);
  return value;
}

function prepareIntegrationCommit({
  branch, lease, repo, gitText, leaseStore, sessionId, run,
  commitMessage, pathsManifest, now, renewActiveAuthority,
}) {
  run("git", ["merge-base", "--is-ancestor", lease.fenceSha, "HEAD"]);
  const changedBeforeCheck = listChangedPaths(gitText);
  if (lease.integration?.validationRequired === true) {
    if (changedBeforeCheck.length) {
      throw new Error("Recovered committed continuation must remain clean until integration validation.");
    }
    return validateRecoveredCommittedContinuation({
      branch,
      lease,
      gitText,
      leaseStore,
      sessionId,
      run,
      commitMessage,
      pathsManifest,
      now,
    });
  }
  let manifest = null;
  if (changedBeforeCheck.length) {
    manifest = readChangeManifest({ filePath: pathsManifest, repo, branch, lease });
    requireExactPaths({ changed: changedBeforeCheck, approved: manifest.value.paths });
    const managedCommit = renderManagedCommitMessage({ branch, commitMessage, lease });
    run("npm", ["run", "check"]);
    lease = renewIntegrationAuthority({
      branch, lease: leaseStore.read(branch), leaseStore, sessionId, gitText,
      renewActiveAuthority, phase: "before-commit", now,
    });
    const changedAfterCheck = listChangedPaths(gitText);
    requireExactPaths({ changed: changedAfterCheck, approved: manifest.value.paths });
    run("git", ["add", "--", ...manifest.value.paths.map(value => `:(literal)${value}`)]);
    if (splitNul(gitText(["diff", "--name-only", "-z"])).length) {
      throw new Error("Validation left unstaged changes; integration stopped before commit.");
    }
    requireExactPaths({
      changed: splitNul(gitText(["diff", "--cached", "--name-only", "-z"])),
      approved: manifest.value.paths,
    });
    const stagedDiffDigest = sha256(gitText(["diff", "--cached", "--binary"]));
    run("git", [
      "commit",
      "-m", managedCommit.subject,
      "-m", managedCommit.body,
      "-m", managedCommit.trailers.join("\n"),
    ]);
    return annotateIntegration({
      branch, leaseStore, sessionId, gitText, now,
      values: {
        commitMessage: managedCommit.subject,
        manifestDigest: manifest.digest,
        stagedDiffDigest,
        paths: manifest.value.paths,
      },
    });
  }

  const headSha = gitText(["rev-parse", "HEAD"]).trim();
  if (headSha === lease.fenceSha && !lease.integration) {
    throw new Error("No authored or committed task change exists beyond the writer fence.");
  }
  if (lease.integration?.commitSha === headSha) return lease.integration;
  if (SHA_PATTERN.test(String(lease.integration?.commitSha || ""))) {
    run("git", ["merge-base", "--is-ancestor", lease.integration.commitSha, "HEAD"]);
    return lease.integration;
  }
  return annotateIntegration({
    branch, leaseStore, sessionId, gitText, now,
    values: {
      commitMessage: gitText(["log", "-1", "--pretty=%s"]).trim(),
      manifestDigest: null,
      stagedDiffDigest: null,
      paths: [],
    },
  });
}

function renewIntegrationAuthority({
  branch,
  lease,
  leaseStore,
  sessionId,
  gitText,
  renewActiveAuthority,
  phase,
  now,
}) {
  if (typeof renewActiveAuthority !== "function") return lease;
  const headSha = gitText(["rev-parse", "HEAD"]).trim();
  const worktreeState = gitText(["status", "--porcelain"]);
  const renewed = renewActiveAuthority({ branch, lease, phase });
  const projected = leaseStore.read(branch);
  if (renewed !== undefined && digestValue(renewed) !== digestValue(projected)) {
    throw new Error("Integration authority adapter returned a different local projection.");
  }
  const observedAt = now().getTime();
  const expiresAt = Date.parse(String(projected?.expiresAt || ""));
  const cloudExpiresAt = Date.parse(String(projected?.cloudAuthority?.expiresAt || ""));
  const exact = projected?.schema === lease.schema && projected.status === "active" &&
    projected.branch === branch && projected.sessionId === sessionId &&
    projected.device === lease.device && projected.scope === lease.scope &&
    projected.worktreePath === lease.worktreePath &&
    projected.admission?.status === "admitted" &&
    projected.admission?.semanticScope === lease.admission?.semanticScope &&
    projected.admission?.writeSetDigest === lease.admission?.writeSetDigest &&
    projected.cloudAuthority?.claimId === lease.cloudAuthority?.claimId &&
    projected.cloudAuthority?.state === "active" &&
    Number.isFinite(expiresAt) && expiresAt > observedAt &&
    Number.isFinite(cloudExpiresAt) && cloudExpiresAt >= expiresAt;
  if (!exact) {
    throw new Error(`Integration authority refresh at ${phase} did not return the exact current admitted lane.`);
  }
  if (gitText(["rev-parse", "HEAD"]).trim() !== headSha ||
      gitText(["status", "--porcelain"]) !== worktreeState) {
    throw new Error(`Integration authority refresh at ${phase} changed repository bytes.`);
  }
  return projected;
}

function validateRecoveredCommittedContinuation({
  branch,
  lease,
  gitText,
  leaseStore,
  sessionId,
  run,
  commitMessage,
  pathsManifest,
  now,
}) {
  const integration = lease.integration;
  const continuation = normalizePreClaimIntegrationContinuation(
    lease.preClaimIntegrationContinuation,
  );
  if (
    continuation?.schema !== "agentic-pre-claim-integration-continuation/v1" ||
    integration?.schema !== "agentic-integration-commit/v1" ||
    continuation.integrationCommitSha !== integration.commitSha ||
    continuation.integrationTreeSha !== integration.treeSha ||
    (continuation.sourceStatus === "active" &&
      continuation.headSha !== integration.commitSha) ||
    !["active", "delivery"].includes(continuation.sourceStatus) ||
    !SHA_PATTERN.test(String(continuation.sourceFenceSha || "")) ||
    !SHA_PATTERN.test(String(continuation.sourceBaseSha || "")) ||
    !SHA_PATTERN.test(String(continuation.integrationSourceFenceSha || "")) ||
    !SHA_PATTERN.test(String(continuation.integrationSourceBaseSha || "")) ||
    !/^[0-9a-f]{64}$/.test(String(integration.rangeDiffDigest || "")) ||
    !Array.isArray(integration.paths) ||
    integration.paths.length === 0
  ) {
    throw new Error("Recovered committed continuation lacks exact pre-claim integration evidence.");
  }
  requireCommitMessage(commitMessage);
  if (String(commitMessage).trim() !== integration.commitMessage) {
    throw new Error("Recovered committed continuation commit message changed from its recorded intent.");
  }
  const manifest = readChangeManifest({
    filePath: pathsManifest,
    repo: lease.worktreePath,
    branch,
    lease,
    expectedBaseSha: continuation.integrationSourceBaseSha,
    requirement: "Recovered committed continuation",
  });
  const committedPaths = splitNul(gitText([
    "diff", "--name-only", "-z",
    continuation.integrationSourceFenceSha,
    integration.commitSha,
    "--",
  ]));
  requireExactPaths({ changed: committedPaths, approved: integration.paths });
  requireExactPaths({ changed: committedPaths, approved: manifest.value.paths });
  const rangeDiffDigest = sha256(gitText([
    "diff", "--binary",
    continuation.integrationSourceFenceSha,
    integration.commitSha,
    "--",
  ]));
  if (rangeDiffDigest !== integration.rangeDiffDigest) {
    throw new Error("Recovered committed continuation diff changed from its pre-claim evidence.");
  }
  if (gitText(["rev-parse", `${integration.commitSha}^{tree}`]).trim() !== integration.treeSha) {
    throw new Error("Recovered committed continuation tree changed from its recorded commit.");
  }
  if (gitText(["rev-parse", `${continuation.headSha}^{tree}`]).trim() !== continuation.treeSha) {
    throw new Error("Recovered committed continuation handoff tree changed from its receipt.");
  }
  run("git", [
    "merge-base",
    "--is-ancestor",
    continuation.integrationSourceFenceSha,
    integration.commitSha,
  ]);
  run("git", ["merge-base", "--is-ancestor", continuation.sourceFenceSha, continuation.headSha]);
  run("git", ["merge-base", "--is-ancestor", integration.commitSha, continuation.headSha]);
  run("git", ["merge-base", "--is-ancestor", integration.commitSha, "HEAD"]);
  run("npm", ["run", "check"]);
  if (listChangedPaths(gitText).length) {
    throw new Error("Recovered committed continuation validation changed the clean worktree.");
  }
  const validated = {
    ...integration,
    manifestDigest: manifest.digest,
    validationRequired: false,
    validatedAt: now().toISOString(),
  };
  leaseStore.annotate({ sessionId, branch, values: { integration: validated } });
  return validated;
}

function annotateIntegration({ branch, leaseStore, sessionId, gitText, now, values }) {
  const commitSha = gitText(["rev-parse", "HEAD"]).trim();
  const treeSha = gitText(["rev-parse", "HEAD^{tree}"]).trim();
  if (!SHA_PATTERN.test(commitSha) || !SHA_PATTERN.test(treeSha)) {
    throw new Error("Integration commit evidence requires exact commit and tree SHAs.");
  }
  const integration = {
    schema: "agentic-integration-commit/v1",
    commitSha,
    treeSha,
    ...values,
    recordedAt: now().toISOString(),
  };
  leaseStore.annotate({ sessionId, branch, values: { integration } });
  return integration;
}

function waitForMergedPullRequest({
  url,
  expectedHeadSha,
  ghText,
  waitSeconds,
  pollSeconds,
  now,
  sleep,
  onHeadAdvance = null,
  onOpenPullRequest = null,
}) {
  if (!url) throw new Error("Integration requires the lease-owned pull request URL.");
  if (!SHA_PATTERN.test(String(expectedHeadSha || ""))) {
    throw new Error("Integration requires an exact delivered pull-request head SHA.");
  }
  const deadline = now().getTime() + waitSeconds * 1000;
  let acceptedHeadSha = expectedHeadSha;
  for (;;) {
    const pullRequest = readPullRequestForProtectedRefresh({ ghText, url });
    if (pullRequest.url !== url || pullRequest.baseRefName !== "main") {
      throw new Error(`Pull request identity for ${url} changed during integration.`);
    }
    if (pullRequest.headRefOid !== acceptedHeadSha) {
      const resolvedHeadSha = onHeadAdvance?.({
        expectedHeadSha: acceptedHeadSha,
        observedHeadSha: pullRequest.headRefOid,
      });
      if (resolvedHeadSha !== pullRequest.headRefOid) {
        throw new Error(
          `Pull request head ${pullRequest.headRefOid || "unknown"} does not match delivered head ${acceptedHeadSha}.`,
        );
      }
      acceptedHeadSha = resolvedHeadSha;
    }
    if (pullRequest.state === "MERGED") {
      const mergeCommitSha = pullRequest.mergeCommit?.oid;
      if (!SHA_PATTERN.test(String(mergeCommitSha || ""))) {
        throw new Error(`Merged pull request ${url} has no exact merge commit SHA.`);
      }
      return { ...pullRequest, mergeCommitSha };
    }
    if (pullRequest.state !== "OPEN") {
      throw new Error(`Pull request ${url} is ${String(pullRequest.state || "unknown").toLowerCase()}, not merged.`);
    }
    onOpenPullRequest?.({ acceptedHeadSha, pullRequest });
    if (now().getTime() >= deadline) {
      throw new Error(
        `Protected integration remains pending after ${waitSeconds}s at ${url}; the delivery lease is preserved for replay.`,
      );
    }
    sleep(Math.min(pollSeconds * 1000, Math.max(1, deadline - now().getTime())));
  }
}

function dispatchProtectedMainRefresh({
  url,
  pullRequest,
  acceptedHeadSha,
  requestedHeads,
  branch,
  deliveredHeadSha,
  canonicalBaseSha,
  pullRequestBaseSha,
  cloudAuthority,
  ghText,
  verifyCloudAuthority,
  run,
}) {
  if (pullRequest.isDraft !== false) {
    throw new Error("Protected-main refresh requires an exact non-draft pull request.");
  }
  if (pullRequest.isCrossRepository !== false) {
    throw new Error("Protected-main refresh refuses a fork or unknown head repository.");
  }
  const mergeStateStatus = String(pullRequest.mergeStateStatus || "").toUpperCase();
  const knownMergeStates = new Set([
    "BEHIND", "BLOCKED", "CLEAN", "DIRTY", "DRAFT", "HAS_HOOKS", "UNKNOWN", "UNSTABLE",
  ]);
  if (!knownMergeStates.has(mergeStateStatus)) {
    throw new Error(
      `Protected-main refresh requires a known merge state, not ${mergeStateStatus || "unknown"}.`,
    );
  }
  if (mergeStateStatus !== "BEHIND") return false;
  if (pullRequest.autoMergeRequest?.mergeMethod !== "SQUASH") {
    throw new Error(
      "Protected-main refresh requires fresh SQUASH auto-merge authorization.",
    );
  }
  if (requestedHeads.has(acceptedHeadSha)) return false;
  if (!SHA_PATTERN.test(String(acceptedHeadSha || ""))) {
    throw new Error("Protected-main refresh requires an exact accepted pull-request head SHA.");
  }
  const subject = parseProtectedMainRefreshUrl(url, { requireGitHubDotCom: true });
  const dispatch = requireProtectedMainRefreshDispatch({
    subject,
    url,
    ghText,
    branch,
    deliveredHeadSha,
    observedHeadSha: acceptedHeadSha,
    canonicalBaseSha,
    pullRequestBaseSha,
    cloudAuthority,
  });
  verifyCloudAuthority();
  run("gh", [
    "workflow", "run", "auto-delivery.yml",
    "--repo", subject.repository,
    "--ref", "main",
    ...Object.entries(dispatch).flatMap(([name, value]) => ["-f", `${name}=${value}`]),
  ]);
  requestedHeads.add(acceptedHeadSha);
  return true;
}

function readPullRequestForProtectedRefresh({ ghText, url }) {
  return JSON.parse(ghText([
    "pr", "view", url, "--json",
    "state,baseRefName,url,headRefOid,mergeCommit,isDraft,isCrossRepository,mergeStateStatus,autoMergeRequest",
  ]));
}

function requireArmedAutoMergeReplay({
  pullRequest,
  url,
  expectedHeadSha,
  originalError,
}) {
  const exactReplay = pullRequest?.url === url
    && pullRequest?.state === "OPEN"
    && pullRequest?.baseRefName === "main"
    && pullRequest?.headRefOid === expectedHeadSha
    && pullRequest?.isDraft === false
    && pullRequest?.isCrossRepository === false
    && pullRequest?.autoMergeRequest?.mergeMethod === "SQUASH";
  if (!exactReplay) {
    throw new Error(
      `Protected auto-merge failed and no exact armed replay was observed: ${originalError?.message || "command failed"}.`,
    );
  }
  return pullRequest;
}

function requireProtectedMainRefreshDispatch({
  subject,
  url,
  ghText,
  branch,
  deliveredHeadSha,
  observedHeadSha,
  canonicalBaseSha,
  pullRequestBaseSha,
  cloudAuthority,
}) {
  if (cloudAuthority?.state !== "delivery_authorized") {
    throw new Error("Protected-main refresh dispatch requires delivery-authorized cloud authority.");
  }
  const pullRequest = readProtectedHeadRefreshPullRequest({
    subject,
    ghText,
  });
  const targetMainSha = readProtectedHeadRefreshTargetMain({
    subject,
    ghText,
  });
  if (
    !pullRequest.auto_merge
    || !Object.hasOwn(pullRequest.auto_merge, "commit_title")
    || !Object.hasOwn(pullRequest.auto_merge, "commit_message")
  ) {
    throw new Error(
      "Protected-main refresh dispatch requires the exact original auto-merge title and nullable body.",
    );
  }
  const originalAutoMergeTitle = pullRequest.auto_merge.commit_title;
  const originalAutoMergeMessage = JSON.stringify(
    pullRequest.auto_merge.commit_message,
  );
  const candidateAutoMergeMessage = JSON.stringify(
    renderProtectedHeadRefreshRearmCommitMessage({
      pullRequestNumber: subject.pullRequestNumber,
      deliveredHeadSha,
      targetMainSha,
    }),
  );
  const projection = {
    operation: "protected-head-refresh",
    pull_request_number: subject.pullRequestNumber,
    branch,
    delivered_head_sha: deliveredHeadSha,
    observed_head_sha: observedHeadSha,
    target_main_sha: targetMainSha,
    canonical_base_sha: canonicalBaseSha,
    claim_id: cloudAuthority.claimId,
    claim_digest: cloudAuthority.claimDigest,
    ledger_revision: cloudAuthority.ledgerRevision,
    review_request_id: cloudAuthority.reviewRequestId,
    pull_request_node_id: pullRequest.node_id,
    pull_request_title: pullRequest.title,
    auto_merge_method: pullRequest.auto_merge.merge_method,
    auto_merge_enabled_by_database_id: pullRequest.auto_merge.enabled_by?.id,
    auto_merge_enabled_by_node_id: pullRequest.auto_merge.enabled_by?.node_id,
    auto_merge_enabled_by_login: pullRequest.auto_merge.enabled_by?.login,
    auto_merge_enabled_by_type: pullRequest.auto_merge.enabled_by?.type,
    auto_merge_commit_title: originalAutoMergeTitle,
    auto_merge_commit_message: originalAutoMergeMessage,
    candidate_auto_merge_commit_title: originalAutoMergeTitle,
    candidate_auto_merge_commit_message: candidateAutoMergeMessage,
    integration_receipt_digest: cloudAuthority.integrationReceiptDigest,
    transition_counter: cloudAuthority.transitionCounter,
  };
  projection.operation_id = protectedHeadRefreshOperationId({
    repository: subject.repository,
    projection,
  });
  const normalized = normalizeProtectedHeadRefreshProjection({
    repository: subject.repository,
    input: projection,
  });
  if (
    pullRequest.html_url !== url
    || pullRequest.head?.sha !== observedHeadSha
    || pullRequest.base?.sha !== pullRequestBaseSha
  ) {
    throw new Error(
      "Protected-main refresh live pull-request metadata drifted from the accepted head or canonical base.",
    );
  }
  const verifiedPullRequest = requireProtectedHeadRefreshPullRequest({
    pullRequest,
    projection: normalized,
    autoMerge: "armed",
  });
  if (
    verifiedPullRequest.headSha !== observedHeadSha
    || verifiedPullRequest.mergeState !== "behind"
  ) {
    throw new Error(
      "Protected-main refresh live pull-request metadata drifted from the accepted behind head.",
    );
  }
  return Object.freeze(Object.fromEntries(
    PROTECTED_HEAD_REFRESH_DISPATCH_FIELDS.map(field => [field, normalized[field]]),
  ));
}

function readProtectedHeadRefreshPullRequest({ subject, ghText }) {
  const value = JSON.parse(ghText([
    "api", "--method", "GET",
    `repos/${subject.repository}/pulls/${subject.pullRequestNumber}`,
  ]));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Protected-main refresh dispatch received no live pull-request metadata.");
  }
  return value;
}

function readProtectedHeadRefreshTargetMain({ subject, ghText }) {
  const value = JSON.parse(ghText([
    "api", "--method", "GET",
    `repos/${subject.repository}/git/ref/heads/main`,
  ]));
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.ref !== "refs/heads/main"
    || value.object?.type !== "commit"
    || !SHA_PATTERN.test(String(value.object?.sha || ""))
  ) {
    throw new Error("Protected-main refresh dispatch received no exact live protected main SHA.");
  }
  return value.object.sha;
}

function parseProtectedMainRefreshUrl(value, { requireGitHubDotCom = false } = {}) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("Protected-main refresh requires an absolute pull-request URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    throw new Error("Protected-main refresh requires a plain HTTPS pull-request URL.");
  }
  const match = url.pathname.match(
    /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9]\d*)\/?$/u,
  );
  if (!url.hostname || !match) {
    throw new Error("Protected-main refresh requires an owner/repository pull-request URL.");
  }
  if (requireGitHubDotCom && url.hostname.toLowerCase() !== "github.com") {
    throw new Error("Protected-main refresh dispatch requires the github.com provider.");
  }
  return {
    hostname: url.hostname,
    repository: `${match[1]}/${match[2]}`,
    pullRequestNumber: match[3],
  };
}

function reconcileProtectedMainRefresh({
  url, expectedHeadSha, observedHeadSha, gitText, run,
}) {
  if (!SHA_PATTERN.test(String(expectedHeadSha || "")) ||
      !SHA_PATTERN.test(String(observedHeadSha || ""))) {
    throw new Error("Protected-main refresh requires exact delivered and observed head SHAs.");
  }
  const pullRequestNumber = parsePullRequestNumber(url);
  run("git", ["fetch", "origin", "main"]);
  run("git", ["fetch", "origin", `refs/pull/${pullRequestNumber}/head`]);
  const fetchedHeadSha = gitText(["rev-parse", "FETCH_HEAD"]).trim();
  if (fetchedHeadSha !== observedHeadSha) {
    throw new Error("Fetched pull-request head does not match the observed protected refresh.");
  }
  const refresh = verifyProtectedMainRefreshChain({
    expectedHeadSha,
    observedHeadSha,
    gitText,
  });

  const localHeadSha = gitText(["rev-parse", "HEAD"]).trim();
  if (!protectedMainRefreshHeads(refresh).includes(localHeadSha)) {
    throw new Error(
      "Local integration head is not an exact member of the protected-main refresh chain.",
    );
  }
  if (localHeadSha !== observedHeadSha) run("git", ["merge", "--ff-only", "FETCH_HEAD"]);
  if (gitText(["rev-parse", "HEAD"]).trim() !== observedHeadSha ||
      gitText(["status", "--porcelain"]).trim()) {
    throw new Error("Protected-main refresh did not leave the exact clean pull-request head attached.");
  }
  return refresh;
}

function parsePullRequestNumber(url) {
  const match = String(url || "").match(/\/pull\/([1-9]\d*)\/?$/u);
  if (!match) throw new Error("Protected-main refresh requires an exact pull-request URL.");
  return match[1];
}

function convergeCanonicalSource({ canonicalRoot, mainSha, controllerRoot, runtime, runtimeRepository, runText }) {
  const controller = path.resolve(controllerRoot || "");
  if (!controllerRoot || !path.isAbsolute(controllerRoot)) {
    throw new Error("Canonical integration requires the absolute Agentic Canvas OS controller root.");
  }
  runText("node", [path.join(controller, "scripts", "live-sync.mjs")], { cwd: canonicalRoot });
  const integratedSha = String(runText("git", ["rev-parse", "HEAD"], { cwd: canonicalRoot })).trim();
  if (integratedSha !== mainSha) {
    throw new Error(`Canonical source ${canonicalRoot} did not converge to integrated main ${mainSha}.`);
  }

  const { integratedRepository, ...repositories } = resolveRuntimeRepositories({
    canonicalRoot,
    controllerRoot,
    runtimeRepository,
    allowAncillary: true,
    runtimeRequired: runtime === "canonical",
    readOriginRemote: () => runText(
      "git",
      ["remote", "get-url", "origin"],
      { cwd: canonicalRoot },
    ),
  });
  return {
    integratedSource: { repository: integratedRepository, root: canonicalRoot, mainSha },
    repositories,
  };
}

function reconcileCanonicalRuntime({ canonicalIntegration, integrationWorktree, mainSha, runText }) {
  const { repositories, integratedSource } = canonicalIntegration;
  const output = runText("npm", [
    "--prefix", repositories.agenticCanvasOsRoot,
    "run", "turn:end", "--",
    `--repository=${repositories.knowgrphRoot}`,
    "--json",
  ], { cwd: repositories.agenticCanvasOsRoot });
  const line = String(output || "").trim().split(/\r?\n/).reverse().find(value => value.trim().startsWith("{"));
  if (!line) throw new Error("Canonical runtime reconciler returned no machine-readable readiness result.");
  const result = JSON.parse(line);
  const integratedRepository = integratedSource.repository;
  const integratedSourceMatches =
    String(runText("git", ["rev-parse", "HEAD"], { cwd: integratedSource.root })).trim() === mainSha;
  const integratedRevision = integratedRepository === "agentic-canvas-os"
    ? result.agenticCanvasOs?.revision
    : integratedRepository === "knowgrph"
      ? result.source?.revision
      : null;
  const ancillaryRuntimeMatches = integratedRevision === null &&
    String(runText("git", ["rev-parse", "HEAD"], { cwd: repositories.agenticCanvasOsRoot })).trim() ===
      result.agenticCanvasOs?.revision &&
    String(runText("git", ["rev-parse", "HEAD"], { cwd: repositories.knowgrphRoot })).trim() ===
      result.source?.revision;
  if (result.schema !== "agentic-local-runtime-readiness/v1" || result.ready !== true ||
      result.status !== "runtime-ready" || !integratedSourceMatches ||
      (integratedRevision === null ? !ancillaryRuntimeMatches : integratedRevision !== mainSha)) {
    throw new Error("Canonical runtime readiness did not match the integrated main SHA.");
  }
  return { integratedSource, readiness: result };
}

export function cleanupIntegrationWorktree({
  canonicalIntegration,
  integrationBranch,
  integrationWorktree,
  runText,
}) {
  const { integratedSource, repositories } = canonicalIntegration;
  const observedGitCommonDir = String(runText(
    "git",
    ["rev-parse", "--git-common-dir"],
    { cwd: integratedSource.root },
  ) || "").trim();
  if (!observedGitCommonDir) {
    throw new Error("Integration worktree cleanup could not resolve canonical Git ownership.");
  }
  const expectedGitCommonDir = path.resolve(integratedSource.root, observedGitCommonDir);
  const cleanupArgs = [
    path.join(repositories.agenticCanvasOsRoot, "scripts", "worktree-lifecycle.mjs"),
    "cleanup",
    `--repository=${integratedSource.root}`,
    `--worktree=${integrationWorktree}`,
  ];
  let parsedResult = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const output = runText("node", cleanupArgs, { cwd: repositories.agenticCanvasOsRoot });
    const lines = String(output || "").trim().split(/\r?\n/).reverse()
      .map(value => value.trim()).filter(Boolean);
    for (const line of lines) {
      try {
        parsedResult = { value: JSON.parse(line) };
        break;
      } catch {
        // Continue past non-machine-readable child log lines.
      }
    }
    if (parsedResult) break;
  }
  if (!parsedResult) {
    throw new Error(
      "Integration worktree cleanup returned no machine-readable result after one bounded retry.",
    );
  }
  return validateIntegrationCleanupReceipt({
    receipt: parsedResult.value,
    repository: integratedSource.root,
    completionMainSha: integratedSource.mainSha,
    expectedGitCommonDir,
    integrationBranch,
    integrationWorktree,
  });
}

export function validateIntegrationCleanupReceipt({
  receipt,
  repository,
  completionMainSha,
  expectedGitCommonDir,
  integrationBranch,
  integrationWorktree,
}) {
  const normalizedRepository = path.resolve(repository || "");
  const normalizedTarget = path.resolve(integrationWorktree || "");
  const expectedGitCommonDirValue = String(expectedGitCommonDir || "");
  const normalizedGitCommonDir = path.resolve(expectedGitCommonDirValue);
  const target = receipt?.target;
  const cleaned = receipt?.status === "cleaned";
  const alreadyCleaned = receipt?.status === "already-cleaned";
  const exactTarget = target &&
    path.isAbsolute(String(target.path || "")) &&
    target.path === normalizedTarget &&
    target.completionMainSha === completionMainSha &&
    target.registeredAfter === false &&
    target.pathExistsAfter === false;
  const exactRemoval = cleaned && exactTarget &&
    target.registeredBefore === true &&
    target.pathPresentBefore === true &&
    target.head === completionMainSha &&
    target.state === "cleanup-ready" &&
    path.isAbsolute(String(receipt.removedWorktree || "")) &&
    receipt.removedWorktree === normalizedTarget &&
    receipt.replayed === false;
  const exactAbsence = alreadyCleaned && exactTarget &&
    target.registeredBefore === false &&
    target.pathPresentBefore === false &&
    target.head === null &&
    target.state === "already-cleaned" &&
    receipt.removedWorktree === null &&
    receipt.replayed === true;
  if (!path.isAbsolute(expectedGitCommonDirValue) ||
      expectedGitCommonDirValue !== normalizedGitCommonDir ||
      !path.isAbsolute(String(receipt?.gitCommonDir || "")) ||
      receipt.gitCommonDir !== normalizedGitCommonDir) {
    throw new Error("Integration worktree cleanup Git common-directory evidence changed.");
  }
  if (
    receipt?.schema !== WORKTREE_CLEANUP_RESULT_SCHEMA ||
    (!cleaned && !alreadyCleaned) ||
    !path.isAbsolute(String(receipt.repository || "")) ||
    receipt.repository !== normalizedRepository ||
    !SHA_PATTERN.test(String(receipt.canonicalSha || "")) ||
    !SHA_PATTERN.test(String(completionMainSha || "")) ||
    receipt.preservedBranch !== integrationBranch ||
    receipt.registrationPruned !== false ||
    !DIGEST_PATTERN.test(String(receipt.operationId || "")) ||
    (!exactRemoval && !exactAbsence)
  ) {
    throw new Error("Integration worktree cleanup lacks exact target removal or absence evidence.");
  }
  requireSafeContainerCleanupReceipt({
    receipt,
    repository: normalizedRepository,
    gitCommonDir: normalizedGitCommonDir,
    integrationWorktree: normalizedTarget,
  });
  const expectedOperationId = createWorktreeCleanupOperationId({
    repository: normalizedRepository,
    gitCommonDir: normalizedGitCommonDir,
    targetPath: normalizedTarget,
    completionMainSha,
    preservedBranch: integrationBranch,
    managedContainer: receipt.managedContainer,
    sharedContainer: receipt.sharedContainer,
  });
  if (receipt.operationId !== expectedOperationId) {
    throw new Error("Integration worktree cleanup operation identity does not match its receipt.");
  }
  return receipt;
}

function requireSafeContainerCleanupReceipt({
  receipt,
  repository,
  gitCommonDir,
  integrationWorktree,
}) {
  const managedRootValue = String(receipt?.managedContainer?.root || "");
  const sharedRootValue = String(receipt?.sharedContainer?.root || "");
  const managedRoot = path.resolve(managedRootValue);
  const sharedRoot = path.resolve(sharedRootValue);
  const managedDisposition = receipt?.managedContainer?.disposition;
  const sharedDisposition = receipt?.sharedContainer?.disposition;
  const removed = receipt?.removedEmptyDirectories;
  const ownership = deriveTaskWorktreeContainers({
    repoRoot: repository,
    gitCommonDir,
    targetPath: integrationWorktree,
  });
  const rootsAreExact = path.isAbsolute(managedRootValue) && path.isAbsolute(sharedRootValue) &&
    receipt.kind === ownership.kind &&
    managedRootValue === ownership.managedContainer.root &&
    sharedRootValue === ownership.sharedContainer.root;
  if (!rootsAreExact || !Array.isArray(removed)) {
    throw new Error("Integration worktree cleanup lacks safe container dispositions.");
  }

  if (receipt.kind === "external") {
    if (managedDisposition !== "not-managed" || sharedDisposition !== "not-managed" ||
        removed.length !== 0) {
      throw new Error("Integration worktree cleanup lacks safe container dispositions.");
    }
    return;
  }

  const retained = new Set([
    "retained-nonempty",
    "retained-symlink",
    "retained-nondirectory",
    "retained-ambiguous",
  ]);
  const completedAttempt = new Set([
    "removed-empty",
    "absent",
    "retained-nonempty",
    "retained-ambiguous",
  ]);
  const safePair = receipt.kind === "managed" &&
    path.dirname(integrationWorktree) === managedRoot &&
    (
      ((managedDisposition === "removed-empty" || managedDisposition === "absent") &&
        completedAttempt.has(sharedDisposition)) ||
      (managedDisposition === "retained-ambiguous" &&
        sharedDisposition === "retained-ambiguous") ||
      (retained.has(managedDisposition) && sharedDisposition === "not-attempted") ||
      (managedDisposition === "not-attempted" &&
        new Set(["retained-symlink", "retained-nondirectory", "retained-ambiguous"])
          .has(sharedDisposition))
    );
  const expectedRemoved = [
    ...(managedDisposition === "removed-empty" ? [managedRoot] : []),
    ...(sharedDisposition === "removed-empty" ? [sharedRoot] : []),
  ];
  if (!safePair || JSON.stringify(removed) !== JSON.stringify(expectedRemoved)) {
    throw new Error("Integration worktree cleanup lacks safe container dispositions.");
  }
}

export function resolveRuntimeRepositories({
  canonicalRoot,
  controllerRoot = "",
  runtimeRepository,
  readOriginRemote = () => "",
  allowAncillary = false,
  runtimeRequired = true,
}) {
  const integratedRepository = resolveCanonicalRepositoryIdentity({
    canonicalRoot,
    readOriginRemote,
    allowAncillary,
  });
  const ancillaryIntegration = !["agentic-canvas-os", "knowgrph"].includes(integratedRepository);
  if (ancillaryIntegration && (!controllerRoot || !path.isAbsolute(controllerRoot))) {
    throw new Error("Ancillary integration requires an explicit absolute Agentic Canvas OS controller root.");
  }
  if (ancillaryIntegration && runtimeRequired &&
      (!runtimeRepository || !path.isAbsolute(runtimeRepository))) {
    throw new Error("Ancillary canonical runtime requires an explicit absolute Knowgrph repository.");
  }
  const workspaceRoot = path.dirname(canonicalRoot);
  const knowgrphRoot = runtimeRepository
    ? path.resolve(runtimeRepository)
    : integratedRepository === "knowgrph"
      ? canonicalRoot
      : path.join(workspaceRoot, "knowgrph");
  const agenticCanvasOsRoot = integratedRepository === "agentic-canvas-os"
    ? canonicalRoot
    : ancillaryIntegration
      ? path.resolve(controllerRoot)
      : path.join(workspaceRoot, "agentic-canvas-os");
  const requiredRepositories = [
    ["Agentic Canvas OS", agenticCanvasOsRoot],
    ...(runtimeRequired ? [["Knowgrph", knowgrphRoot]] : []),
  ];
  for (const [label, candidate] of requiredRepositories) {
    try {
      JSON.parse(readFileSync(path.join(candidate, "package.json"), "utf8"));
    } catch {
      throw new Error(`${label} canonical repository is unavailable at ${candidate}.`);
    }
  }
  if (allowAncillary && ancillaryIntegration) {
    requireRepositoryPackageIdentity(agenticCanvasOsRoot, "agentic-canvas-os", "Agentic Canvas OS");
    if (runtimeRequired) requireRepositoryPackageIdentity(knowgrphRoot, "knowgrph", "Knowgrph");
  }
  return { integratedRepository, agenticCanvasOsRoot, knowgrphRoot };
}

function resolveCanonicalRepositoryIdentity({ canonicalRoot, readOriginRemote, allowAncillary = false }) {
  const allowed = new Set(["agentic-canvas-os", "knowgrph"]);
  let packageName = "";
  try {
    packageName = String(
      JSON.parse(readFileSync(path.join(canonicalRoot, "package.json"), "utf8"))?.name || "",
    ).trim();
  } catch {
    packageName = "";
  }
  if (allowed.has(packageName)) return packageName;

  let remoteName = "";
  try {
    remoteName = repositoryNameFromRemote(readOriginRemote());
  } catch {
    remoteName = "";
  }
  if (allowed.has(remoteName)) return remoteName;

  if (allowAncillary && packageName &&
      packageName.toLowerCase() === remoteName.toLowerCase() &&
      REPOSITORY_IDENTITY_PATTERN.test(packageName)) {
    return packageName;
  }

  const observed = [
    packageName ? `package ${JSON.stringify(packageName)}` : null,
    remoteName ? `origin ${JSON.stringify(remoteName)}` : null,
  ].filter(Boolean).join(" and ") || "no supported package or origin metadata";
  throw new Error(`Unsupported canonical integration repository identity: ${observed}.`);
}

function requireRepositoryPackageIdentity(root, expectedName, label) {
  let packageName = "";
  try {
    packageName = String(JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))?.name || "").trim();
  } catch {
    packageName = "";
  }
  if (packageName !== expectedName) {
    throw new Error(`${label} canonical repository identity is unavailable at ${root}.`);
  }
}

function repositoryNameFromRemote(value) {
  const normalized = String(value || "").trim().replace(/\/+$/u, "").replace(/\.git$/u, "");
  const separator = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf(":"));
  return separator >= 0 ? normalized.slice(separator + 1) : normalized;
}

function readChangeManifest({
  filePath,
  repo,
  branch,
  lease,
  expectedBaseSha = lease.baseSha,
  requirement = "Dirty integration",
}) {
  if (!filePath) throw new Error(`${requirement} requires --paths-manifest.`);
  const absolutePath = path.resolve(filePath);
  const bytes = readFileSync(absolutePath);
  const value = JSON.parse(bytes.toString("utf8"));
  if (value?.schema !== CHANGE_MANIFEST_SCHEMA || value.branch !== branch || value.baseSha !== expectedBaseSha ||
      !Array.isArray(value.paths) || value.paths.length === 0) {
    throw new Error(`Invalid ${CHANGE_MANIFEST_SCHEMA} at ${absolutePath}.`);
  }
  const normalizedPaths = value.paths.map(normalizeRepoPath);
  if (normalizedPaths.some((normalized, index) => normalized !== value.paths[index])) {
    throw new Error("Change manifest paths must already use normalized repository-relative spelling.");
  }
  const paths = [...new Set(normalizedPaths)].sort();
  if (paths.length !== value.paths.length) throw new Error("Change manifest paths must be unique and normalized.");
  return { value: { ...value, paths }, digest: sha256(bytes) };
}

function normalizeRepoPath(value) {
  const normalized = String(value || "").replaceAll("\\", "/").trim();
  if (!normalized || normalized.startsWith("/") || normalized === ".." || normalized.startsWith("../") ||
      normalized.includes("/../") || normalized.endsWith("/..") || normalized.startsWith("./")) {
    throw new Error(`Unsafe change-manifest path: ${value}`);
  }
  return normalized;
}

function listChangedPaths(gitText) {
  return [...new Set([
    ...splitNul(gitText(["diff", "--name-only", "-z", "HEAD", "--"])),
    ...splitNul(gitText(["ls-files", "--others", "--exclude-standard", "-z"])),
  ])].sort();
}

function requireExactPaths({ changed, approved }) {
  const actual = [...changed].sort();
  const expected = [...approved].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Changed paths do not match the approved manifest; changed=${actual.join(",") || "none"}; ` +
      `approved=${expected.join(",") || "none"}.`,
    );
  }
}

function resolveIntegrationLease({ repo, gitText, leaseStore }) {
  const attachedBranch = gitText(["branch", "--show-current"]).trim();
  if (attachedBranch) {
    const lease = leaseStore.read(attachedBranch);
    if (!lease) throw new Error(`No writer lease records ${attachedBranch}.`);
    return { branch: attachedBranch, lease };
  }
  const registry = leaseStore.read();
  const matches = Object.values(registry?.leases || {}).filter(lease =>
    ['completing', 'completed'].includes(lease?.status) && lease.worktreePath &&
    path.resolve(lease.worktreePath) === path.resolve(repo));
  if (matches.length !== 1) {
    throw new Error("Detached integration replay requires one exact completing or completed lease for this worktree.");
  }
  return { branch: matches[0].branch, lease: matches[0] };
}

function resolveCanonicalMainWorktree(porcelain) {
  const records = String(porcelain || "").split("\0\n").join("\0").split("\0\0").filter(Boolean);
  const matches = [];
  for (const record of records) {
    const fields = record.split("\0").filter(Boolean);
    const worktree = fields.find(field => field.startsWith("worktree "))?.slice(9);
    const branch = fields.find(field => field.startsWith("branch "))?.slice(7);
    if (worktree && branch === "refs/heads/main") matches.push(worktree);
  }
  if (matches.length !== 1) throw new Error("Integration requires exactly one registered canonical main worktree.");
  return path.resolve(matches[0]);
}

function requireCommitMessage(value) {
  const message = String(value || "").trim();
  if (!message || message.length > 200 || /[\r\n]/.test(message)) {
    throw new Error("Dirty integration requires one intentional single-line --commit-message of at most 200 characters.");
  }
}

export function renderManagedCommitMessage({ branch, commitMessage, lease }) {
  requireCommitMessage(commitMessage);
  const rawSubject = String(commitMessage);
  const subject = rawSubject.trim();
  if (rawSubject !== subject) {
    throw new Error("Managed integration commit subject must not contain leading or trailing whitespace.");
  }
  const branchParts = String(branch || "").split("/");
  const branchScope = branchParts[0] === "agent" && branchParts.length >= 3
    ? branchParts.slice(2).join("/")
    : "";
  if (!branchScope || lease?.branch !== branch || lease?.scope !== branchScope) {
    throw new Error("Managed integration commit attribution requires the exact leased task-branch scope.");
  }
  const subjectMatch = subject.match(MANAGED_COMMIT_SUBJECT_PATTERN);
  if (
    !subjectMatch ||
    subjectMatch[2] !== branchScope ||
    [...subject].length > 72 ||
    [...(subjectMatch?.[3] || "")].length > 60
  ) {
    throw new Error(
      "Managed integration commit subject must use <type>(<leased-scope>): <summary> with an allowed type, a summary of at most 60 characters, and at most 72 total characters.",
    );
  }
  const claimEpoch = lease.cloudAuthority ? lease.cloudAuthority.leaseEpoch : lease.epoch;
  if (!Number.isInteger(claimEpoch) || claimEpoch <= 0) {
    throw new Error("Managed integration commit attribution requires a positive claim epoch.");
  }
  return Object.freeze({
    subject,
    body: `Integrate the declared ${branchScope} change through its protected managed task lane so downstream policy can attribute the change to its writer lease.`,
    trailers: Object.freeze([
      `Agentic-Task: ${branchScope}`,
      `Agentic-Scope: ${branchScope}`,
      `Agentic-Lease-Epoch: ${claimEpoch}`,
      "Agentic-Mechanism: Agentic Canvas OS protected integration",
    ]),
  });
}

function requireRepositoryRoot({ invocationPath, repo }) {
  if (path.resolve(invocationPath) !== path.resolve(repo)) {
    throw new Error(`Integration must start at the registered worktree root ${repo}.`);
  }
}

function requireBounds({ waitSeconds, pollSeconds }) {
  if (!Number.isFinite(waitSeconds) || waitSeconds < 1 || waitSeconds > 3600) {
    throw new Error("--wait-seconds must be between 1 and 3600.");
  }
  if (!Number.isFinite(pollSeconds) || pollSeconds < 0.1 || pollSeconds > 60) {
    throw new Error("--poll-seconds must be between 0.1 and 60.");
  }
}

function splitNul(value) {
  return String(value || "").split("\0").map(item => item.trim()).filter(Boolean);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function defaultSleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}
