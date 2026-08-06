import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { verifyCloudDeliveryAuthority } from "./cloud-collaboration-delivery-verifier.mjs";
import {
  compactDeviceCloudMutationIdempotencyKey,
  createDeviceDeliveryEvidence,
} from "./device-delivery-evidence.mjs";
import {
  authorizeDeliveryAdmissionCloudAuthority,
  invokeRepositoryCloudAction,
} from "./scoped-lane-cloud-authority.mjs";
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

export const CHANGE_MANIFEST_SCHEMA = "agentic-change-manifest/v1";
export const DEVICE_INTEGRATION_RESULT_SCHEMA = "agentic-device-integration-result/v1";
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
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

export function integrateSession({
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
  continueReviewReadyCloudAuthority = continueReviewReadyCloudAuthorityProjection,
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
  const reviewReadyDelivery = isReviewReadyDeliveryLease(lease);
  const autoDeliveryReview = reviewReadyDelivery && lease.autoDelivery === true && lease.runtimeRequired === true;
  if (autoDeliveryReview && runtime !== "canonical") {
    throw new Error("Auto-delivery integration requires canonical runtime readiness; --runtime=none is not permitted.");
  }
  if (lease.status === "active") {
    commitEvidence = prepareIntegrationCommit({
      branch, lease, repo, gitText, leaseStore, sessionId, run,
      commitMessage, pathsManifest, now,
    });
    refreshTaskBranchFromMain({ repo, gitText, run, runText });
    publishTask();
    lease = leaseStore.read(branch);
  } else if (!['delivery', 'completing', 'completed'].includes(lease.status) && !reviewReadyDelivery) {
    throw new Error(
      `Integration requires an active, delivery, completing, or completed lease; ${branch} is ${lease.status}. ` +
      "Resume review-ready work before protected integration.",
    );
  }

  let protectedMainRefresh = null;
  let completion = lease.completion || null;
  if (!['completing', 'completed'].includes(lease.status)) {
    let deliveryCloudAuthority = lease.cloudAuthority || null;
    const deliveryVerifiedBaseSha = deliveryCloudAuthority?.canonicalBaseSha || "";
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
    const deliveryAuthorizedHeadSha = lease.deliveryHeadSha
      || commitEvidence?.commitSha
      || (reviewReadyDelivery ? lease.reviewHeadSha : null);
    const requestedProtectedMainRefreshHeads = new Set();
    verifyCloudAuthority({
      pullRequestUrl: lease.pullRequestUrl,
      branch,
      headSha: deliveryAuthorizedHeadSha,
      canonicalBaseSha: deliveryCloudAuthority?.canonicalBaseSha || deliveryVerifiedBaseSha,
      cloudAuthority: deliveryCloudAuthority,
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
      onOpenPullRequest: reviewReadyDelivery
        ? ({ acceptedHeadSha, pullRequest: openPullRequest }) => {
          dispatchProtectedMainRefresh({
            url: lease.pullRequestUrl,
            pullRequest: openPullRequest,
            acceptedHeadSha,
            requestedHeads: requestedProtectedMainRefreshHeads,
            branch,
            deliveredHeadSha: deliveryAuthorizedHeadSha,
            canonicalBaseSha: deliveryCloudAuthority?.canonicalBaseSha || deliveryVerifiedBaseSha,
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

function isReviewReadyDeliveryLease(lease) {
  return lease?.status === "review_ready" &&
    lease.admission?.schema === "agentic-lane-admission-lease/v1" &&
    lease.cloudAuthority?.schema === "agentic-lane-cloud-authority/v1" &&
    lease.cloudAuthority.state === "review_ready" &&
    SHA_PATTERN.test(String(lease.reviewHeadSha || ""));
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

function refreshTaskBranchFromMain({ repo, gitText, run, runText }) {
  if (gitText(["status", "--porcelain"]).trim()) {
    throw new Error("Integration commit did not leave a clean task worktree.");
  }
  run("git", ["fetch", "origin", "main"]);
  runText("git", ["merge-tree", "--write-tree", "HEAD", "origin/main"], { cwd: repo });
  run("git", ["merge", "--no-edit", "origin/main"]);
  if (gitText(["status", "--porcelain"]).trim()) {
    throw new Error("Protected-main refresh did not leave a clean task worktree.");
  }
}

function prepareIntegrationCommit({
  branch, lease, repo, gitText, leaseStore, sessionId, run,
  commitMessage, pathsManifest, now,
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
    requireCommitMessage(commitMessage);
    run("npm", ["run", "check"]);
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
    run("git", ["commit", "-m", commitMessage]);
    return annotateIntegration({
      branch, leaseStore, sessionId, gitText, now,
      values: {
        commitMessage,
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
    || pullRequest.base?.sha !== canonicalBaseSha
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

function convergeCanonicalSource({ canonicalRoot, mainSha, controllerRoot, runtimeRepository, runText }) {
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
    runtimeRepository,
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
  const integratedRevision = integratedRepository === "agentic-canvas-os"
    ? result.agenticCanvasOs?.revision
    : integratedRepository === "knowgrph"
      ? result.source?.revision
      : null;
  if (result.schema !== "agentic-local-runtime-readiness/v1" || result.ready !== true ||
      result.status !== "runtime-ready" || integratedRevision !== mainSha) {
    throw new Error("Canonical runtime readiness did not match the integrated main SHA.");
  }
  return { integratedSource, readiness: result };
}

function cleanupIntegrationWorktree({ canonicalIntegration, integrationWorktree, runText }) {
  const { integratedSource, repositories } = canonicalIntegration;
  const output = runText("node", [
    path.join(repositories.agenticCanvasOsRoot, "scripts", "worktree-lifecycle.mjs"),
    "cleanup",
    `--repository=${integratedSource.root}`,
    `--worktree=${integrationWorktree}`,
  ], { cwd: repositories.agenticCanvasOsRoot });
  const line = String(output || "").trim().split(/\r?\n/).reverse().find(value => value.trim().startsWith("{"));
  if (!line) throw new Error("Integration worktree cleanup returned no machine-readable result.");
  const result = JSON.parse(line);
  if (result.schema !== "agentic-worktree-lifecycle-report/v1" || result.status !== "cleaned" ||
      path.resolve(result.removedWorktree || "") !== path.resolve(integrationWorktree)) {
    throw new Error("Integration worktree cleanup did not remove the completed task checkout.");
  }
  return result;
}

export function resolveRuntimeRepositories({
  canonicalRoot,
  runtimeRepository,
  readOriginRemote = () => "",
}) {
  const integratedRepository = resolveCanonicalRepositoryIdentity({
    canonicalRoot,
    readOriginRemote,
  });
  const workspaceRoot = path.dirname(canonicalRoot);
  const knowgrphRoot = runtimeRepository
    ? path.resolve(runtimeRepository)
    : integratedRepository === "knowgrph"
      ? canonicalRoot
      : path.join(workspaceRoot, "knowgrph");
  const agenticCanvasOsRoot = integratedRepository === "agentic-canvas-os"
    ? canonicalRoot
    : path.join(workspaceRoot, "agentic-canvas-os");
  for (const [label, candidate] of [["Agentic Canvas OS", agenticCanvasOsRoot], ["Knowgrph", knowgrphRoot]]) {
    try {
      JSON.parse(readFileSync(path.join(candidate, "package.json"), "utf8"));
    } catch {
      throw new Error(`${label} canonical repository is unavailable at ${candidate}.`);
    }
  }
  return { integratedRepository, agenticCanvasOsRoot, knowgrphRoot };
}

function resolveCanonicalRepositoryIdentity({ canonicalRoot, readOriginRemote }) {
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

  const observed = [
    packageName ? `package ${JSON.stringify(packageName)}` : null,
    remoteName ? `origin ${JSON.stringify(remoteName)}` : null,
  ].filter(Boolean).join(" and ") || "no supported package or origin metadata";
  throw new Error(`Unsupported canonical integration repository identity: ${observed}.`);
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
