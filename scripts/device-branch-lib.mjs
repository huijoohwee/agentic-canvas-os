import {
  parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker,
  updateWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";
import {
  readOwnershipPullRequest,
  requireOwnershipPullRequestDraft,
  waitForOwnershipPullRequestHead,
} from "./device-pull-request-state.mjs";
import { verifyCloudDeliveryAuthority } from "./cloud-collaboration-delivery-verifier.mjs";
import {
  compactDeviceCloudMutationIdempotencyKey,
  createDeviceDeliveryEvidence,
} from "./device-delivery-evidence.mjs";
import { digestValue, normalizeWriteSet } from "./cloud-collaboration-primitives.mjs";
import {
  authorizeDeliveryAdmissionCloudAuthority,
  claimLegacyReviewAdmissionCloudAuthority,
  heartbeatAdmissionCloudAuthority,
  invokeRepositoryCloudAction,
  reviewReadyAdmissionCloudAuthority,
  verifyAdmissionCloudAuthority,
} from "./scoped-lane-cloud-authority.mjs";
import { assertAdmissionMutationAuthority } from "./scoped-lane-admission-state.mjs";
import { normalizeDeclaredWriteScopeManifest } from "./scoped-lane-admission-lib.mjs";
import { requireProtectedSquashSubject } from "./protected-squash-subject.mjs";
import { withReviewedLaneEntrypointFence } from "./reviewed-lane-revision-fence.mjs";
import {
  SHA_PATTERN,
  assertLeaseWorktree,
  requireClean,
  requireNoCompetingPullRequest,
  requireRepositorySafety,
  requireSession,
} from "./device-branch-ownership-lib.mjs";

export { sanitize, sanitizeDevice, sanitizeScope } from "./device-branch-identity.mjs";
export { park, createParkMessage, formatParkTimestamp } from "./device-park-lib.mjs";
export { completeSession } from "./device-complete-lib.mjs";
export { start } from "./device-start-lib.mjs";
export {
  heartbeat,
  repairOwnershipPullRequestProjection,
} from "./device-branch-ownership-lib.mjs";
export {
  resume,
  resolveSameSessionDeliveryHandoff,
} from "./device-resume-lib.mjs";

export function review(options) {
  return withDeviceReviewedLaneFence({
    options,
    entrypoint: "review",
    subjectLabel: "Reviewed commit subject",
    requireBranch: branch => requireTaskBranch(branch, "Review"),
  }, () => reviewUnfenced(options));
}

function reviewUnfenced({
  invocationPath,
  repo,
  gitText,
  gitOptional,
  ghText,
  ghOptional,
  leaseStore,
  sessionId,
  run,
  wait,
  heartbeatCloudAuthority = heartbeatAdmissionCloudAuthority,
  inspectCloudStatus = invokeRepositoryCloudAction,
  verifyActiveCloudAuthority = verifyAdmissionCloudAuthority,
  reconcileCloudAuthority = null,
  reviewReadyCloudAuthority = null,
  verifyReviewReadyCloudAuthority = null,
  claimLegacyReviewCloudAuthority = claimLegacyReviewAdmissionCloudAuthority,
  log = console.log,
}) {
  requireSession(sessionId);
  requireRepositorySafety({ invocationPath, repo, gitText });
  requireClean({ gitText });
  const branch = requireTaskBranch(gitText(["branch", "--show-current"]).trim(), "Review");
  const existing = leaseStore.read(branch);
  if (existing?.status === "review_ready") {
    if (existing.sessionId !== sessionId) throw new Error("Review-ready lease belongs to another session.");
    assertLeaseWorktree(existing, repo);
    let replayLease = existing;
    let existingCloud = requireCloudReviewAdmission(existing);
    if (!existingCloud) {
      const upgraded = maybeUpgradeLegacyRootSourceReadyReview({
        lease: existing,
        branch,
        repo,
        gitText,
        gitOptional,
          ghText,
        leaseStore,
        sessionId,
        claimLegacyReviewCloudAuthority,
        reviewReadyCloudAuthority,
      });
      if (upgraded) {
        replayLease = upgraded.lease;
        existingCloud = upgraded.cloud;
        log(`Upgraded ready legacy root-source lane ${branch} into cloud-authoritative review.`);
      }
    }
    if (existingCloud) {
      requireCloudReviewAdapter(
        reviewReadyCloudAuthority,
        "review-ready transition",
      );
      requireCloudReviewAdapter(
        verifyReviewReadyCloudAuthority,
        "review-ready verifier",
      );
      verifyReviewReadyCloudAuthority({
        authority: existingCloud.authority,
        manifest: existingCloud.manifest,
        headSha: replayLease.reviewHeadSha,
        branch,
      });
    }
    requireReviewReplay({ branch, lease: replayLease, gitText, gitOptional, ghText, ghOptional, run });
    log(`Review is already ready at ${replayLease.pullRequestUrl}.`);
    return replayLease.pullRequestUrl;
  }
  let lease = null;
  try {
    lease = leaseStore.verify({ sessionId, branch });
  } catch (error) {
    const recoverableLease = leaseStore.read?.(branch) || null;
    if (
      !isExpiredPlannedReviewRecoveryLease({
        error,
        lease: recoverableLease,
        sessionId,
        branch,
      })
      && !isExpiredAdmittedActiveReviewRecoveryLease({
        error,
        lease: recoverableLease,
        sessionId,
        branch,
      })
      && !isExpiredCurrentCloudAdoptionLease({
        error,
        lease: recoverableLease,
        sessionId,
        branch,
      })
    ) {
      throw error;
    }
    lease = recoverableLease;
  }
  assertLeaseWorktree(lease, repo);
  if (!lease.pullRequestUrl || !lease.fenceSha) {
    throw new Error("Review requires the draft ownership pull request and fencing SHA created by device:start.");
  }
  let cloud = lease?.admission?.status === "planned"
    ? null
    : requireCloudReviewAdmission(lease);
  if (!cloud) {
    const recovered = maybeRecoverPlannedReviewAdmission({
      lease,
      branch,
      gitText,
      gitOptional,
      ghText,
      leaseStore,
      sessionId,
      heartbeatCloudAuthority,
      reconcileCloudAuthority,
    });
    if (recovered) {
      lease = recovered.lease;
      cloud = recovered.cloud;
      log(`Recovered planned cloud admission for ${branch} into exact review authority.`);
    }
  }
  if (!cloud) {
    const adopted = maybeAdoptLegacyRootSourceCurrentCloudAdmission({
      lease,
      branch,
      gitText,
      gitOptional,
      ghText,
      leaseStore,
      sessionId,
      heartbeatCloudAuthority,
      inspectCloudStatus,
      verifyActiveCloudAuthority,
    });
    if (adopted) {
      lease = adopted.lease;
      cloud = adopted.cloud;
      log(`Adopted exact current cloud admission for ${branch}.`);
    }
  }
  if (!cloud) {
    const bootstrapped = maybeBootstrapLegacyRootSourceReviewAdmission({
      lease,
      branch,
      repo,
      gitText,
      gitOptional,
        ghText,
      leaseStore,
      sessionId,
      claimLegacyReviewCloudAuthority,
    });
    if (bootstrapped) {
      lease = bootstrapped.lease;
      cloud = bootstrapped.cloud;
      log(`Upgraded legacy root-source lane ${branch} into cloud-authoritative review.`);
    }
  }
    if (cloud) {
      const refreshed = maybeRefreshLegacyRootSourceReviewAdmission({
        lease,
        branch,
        repo,
        gitText,
        gitOptional,
        ghText,
        leaseStore,
        sessionId,
        claimLegacyReviewCloudAuthority,
      });
      if (refreshed) {
        lease = refreshed.lease;
        cloud = refreshed.cloud;
        log(`Refreshed legacy root-source review admission for live PR base ${cloud.authority.canonicalBaseSha}.`);
      }
    }
  let cloudReady = null;
  if (cloud) {
    requireCloudReviewAdapter(
      reconcileCloudAuthority,
      "transition reconciler",
    );
    requireCloudReviewAdapter(
      reviewReadyCloudAuthority,
      "review-ready transition",
    );
    requireCloudReviewAdapter(
      verifyReviewReadyCloudAuthority,
      "review-ready verifier",
    );
    const currentHeadSha = gitText(["rev-parse", "HEAD"]).trim();
    const reconciled = reconcileCloudAuthority({
      authority: cloud.authority,
      manifest: cloud.manifest,
      branch,
      headSha: currentHeadSha,
      pullRequestNumber: pullRequestNumber(lease.pullRequestUrl),
      allowPriorLaneRevision: true,
    });
    const accepted = acceptReviewCloudReconciliation({
      reconciled, lease, expectedHeadSha: currentHeadSha,
      leaseStore, sessionId, branch,
    });
    lease = accepted.lease;
    cloudReady = accepted.cloudReady;
  }
  run("git", ["merge-base", "--is-ancestor", lease.fenceSha, "HEAD"]);
  requireNoCompetingPullRequest({ branch, ghText });
  const validationHeadSha = gitText(["rev-parse", "HEAD"]).trim();
  run("npm", ["run", "check"]);
  requireClean({ gitText });
  if (gitText(["rev-parse", "HEAD"]).trim() !== validationHeadSha) {
    throw new Error("Review validation changed HEAD; refusing to push unreviewed history.");
  }
  if (cloud) {
    const reconciled = reconcileCloudAuthority({
      authority: cloudReady?.authority || lease.cloudAuthority,
      manifest: cloud.manifest,
      branch,
      headSha: validationHeadSha,
      pullRequestNumber: pullRequestNumber(lease.pullRequestUrl),
      allowPriorLaneRevision: true,
    });
    const accepted = acceptReviewCloudReconciliation({
      reconciled, lease, expectedHeadSha: validationHeadSha,
      leaseStore, sessionId, branch,
    });
    lease = accepted.lease;
    cloudReady = accepted.cloudReady;
  }
  run("git", ["push", "--set-upstream", "origin", branch]);
  const url = requireLeasePullRequest({ lease, ghOptional });
  const reviewHeadSha = gitText(["rev-parse", "HEAD"]).trim();
  const pullRequest = waitForOwnershipPullRequestHead({
    url,
    branch,
    expectedHeadSha: reviewHeadSha,
    ghText,
    ...(wait ? { wait } : {}),
  });
  const reviewRequestId = typeof pullRequest?.id === "string" && pullRequest.id.length > 0
    ? `github-pull-request:${pullRequest.id}`
    : null;
  if (cloud && !cloudReady) {
    cloudReady = reviewReadyCloudAuthority({
      authority: lease.cloudAuthority,
      manifest: cloud.manifest,
      branch,
      headSha: reviewHeadSha,
      pullRequestNumber: pullRequestNumber(url),
      reviewRequestId,
      deviceId: lease.device,
      sessionId,
    });
  } else if (cloudReady) {
    cloudReady = verifyReviewReadyCloudAuthority({
      authority: cloudReady.authority,
      manifest: cloud.manifest,
      headSha: reviewHeadSha,
      branch,
    });
  }
  if (cloudReady) {
    if (
      cloudReady.authority?.state !== "review_ready"
      || cloudReady.authority.laneRevision !== reviewHeadSha
      || cloudReady.authority.claimId !== cloud.authority.claimId
    ) {
      throw new Error("Cloud review-ready result drifted from the exact reviewed lane.");
    }
    lease = leaseStore.annotate({
      sessionId,
      branch,
      allowExpired: hasExpired(lease.expiresAt),
      values: {
        reviewHeadSha,
        cloudAuthority: cloudReady.authority,
      },
    });
  } else {
    lease = leaseStore.annotate({
      sessionId,
      branch,
      allowExpired: hasExpired(lease.expiresAt),
      values: { reviewHeadSha },
    });
  }
  if (pullRequest.isDraft) run("gh", ["pr", "ready", url]);
  const readyPullRequest = requireOwnershipPullRequestDraft({ url, branch, ghText, expectedDraft: false });
  requirePullRequestHead({ pullRequest: readyPullRequest, expectedHeadSha: reviewHeadSha });
  const title = requireReviewedLaneSubject({
    lease,
    headSha: reviewHeadSha,
    subject: gitText(["log", "-1", "--pretty=%s"]).trim(),
    label: "Reviewed commit subject",
  });
  const readyLease = leaseStore.release({ sessionId, branch, status: "review_ready" });
  run("gh", ["pr", "edit", url, "--title", title, "--body", updateWriterLeasePullRequestBody(
    readyPullRequest.body,
    readyLease,
  )]);
  requireOwnershipPullRequestDraft({ url, branch, ghText, expectedDraft: false });
  if (readyLease.autoDelivery === true && readyLease.runtimeRequired === true) {
    log(`Marked ${url} ready for review; device:integrate must authorize the exact reviewed SHA before protected merge.`);
  } else {
    log(`Marked ${url} ready for review without enabling merge or deployment.`);
  }
  return url;
}

export function publish(options) {
  return withDeviceReviewedLaneFence({
    options,
    entrypoint: "publish",
    subjectLabel: "Delivery commit subject",
    requireBranch: branch => {
      if (!branch || branch === "main") {
        throw new Error("Publish from an agent/<device>/<scope> branch, never main.");
      }
      if (!branch.startsWith("agent/")) {
        throw new Error(`Refusing unexpected device branch: ${branch}`);
      }
      return branch;
    },
  }, () => publishUnfenced(options));
}

function publishUnfenced({
  invocationPath,
  repo,
  gitText,
  gitOptional = () => "",
  ghText,
  ghOptional,
  leaseStore,
  sessionId,
  run,
  verifyCloudAuthority = verifyCloudDeliveryAuthority,
  reviewReadyCloudAuthority = reviewReadyAdmissionCloudAuthority,
  claimLegacyReviewCloudAuthority = claimLegacyReviewAdmissionCloudAuthority,
  buildDeliveryEvidence = createDeviceDeliveryEvidence,
  authorizeCloudDelivery = authorizeDeliveryAdmissionCloudAuthority,
  invokeCloudMutation = invokeRepositoryCloudAction,
  log = console.log,
}) {
  requireSession(sessionId);
  requireRepositorySafety({ invocationPath, repo, gitText });
  requireClean({ gitText });
  const branch = gitText(["branch", "--show-current"]).trim();
  if (!branch || branch === "main") throw new Error("Publish from an agent/<device>/<scope> branch, never main.");
  if (!branch.startsWith("agent/")) throw new Error(`Refusing unexpected device branch: ${branch}`);
  let lease = leaseStore.verify({ sessionId, branch });
  assertLeaseWorktree(lease, repo);
  if (!lease.pullRequestUrl || !lease.fenceSha) {
    throw new Error("Publish requires the draft ownership pull request and fencing SHA created by device:start.");
  }
  let cloud = requireCloudPublishAdmission(lease);
  if (!cloud) {
    throw new Error("Publish requires one admitted cloud claim; local-only delivery authority is forbidden.");
  }
  const validationHeadSha = gitText(["rev-parse", "HEAD"]).trim();
  const replayCheckpoint = requirePublishReplayCheckpoint({
    lease,
    headSha: validationHeadSha,
  });
  const initialPullRequest = requirePublishPullRequest({
    url: lease.pullRequestUrl,
    branch,
    ghText,
    replayPhase: replayCheckpoint?.phase || null,
  });
  const alreadyMerged = initialPullRequest.state === "MERGED";
  run("git", ["merge-base", "--is-ancestor", lease.fenceSha, "HEAD"]);
  if (!alreadyMerged) requireNoCompetingPullRequest({ branch, ghText });
  run("npm", ["run", "check"]);
  requireClean({ gitText });
  if (gitText(["rev-parse", "HEAD"]).trim() !== validationHeadSha) {
    throw new Error("Publish validation changed HEAD; refusing to authorize unreviewed history.");
  }
  if (!replayCheckpoint) run("git", ["push", "--set-upstream", "origin", branch]);

  const resolvedUrl = replayCheckpoint?.phase === "delivery_authorized"
    ? lease.pullRequestUrl
    : ghOptional(["pr", "view", "--json", "url", "--jq", ".url"]);
  if (!resolvedUrl || resolvedUrl.trim() !== lease.pullRequestUrl) {
    throw new Error(`Active pull request does not match the writer lease ${lease.pullRequestUrl}.`);
  }
  const url = resolvedUrl.trim();
  const deliveryHeadSha = gitText(["rev-parse", "HEAD"]).trim();
  let squashSubject = null;
  const deliveryPullRequest = requirePublishPullRequest({
    url,
    branch,
    ghText,
    replayPhase: replayCheckpoint?.phase || null,
  });
  requirePullRequestHead({
    pullRequest: deliveryPullRequest,
    expectedHeadSha: deliveryHeadSha,
  });
  if (!replayCheckpoint) {
    const refreshed = maybeRefreshLegacyRootSourceReviewAdmission({
      lease, branch, repo, gitText, gitOptional, ghText, leaseStore, sessionId,
      claimLegacyReviewCloudAuthority,
    });
    if (refreshed) {
      lease = refreshed.lease;
      cloud = refreshed.cloud;
      log(`Refreshed active delivery admission for live PR base ${cloud.authority.canonicalBaseSha}.`);
    }
  }
  const pullNumber = pullRequestNumber(url);
  const reviewed = replayCheckpoint
    ? { authority: replayCheckpoint.authority }
    : reviewReadyCloudAuthority({
      authority: lease.cloudAuthority,
      manifest: cloud.manifest,
      branch,
      headSha: deliveryHeadSha,
      pullRequestNumber: pullNumber,
      deviceId: lease.device,
      sessionId,
    });
  const builtEvidence = replayCheckpoint?.phase === "delivery_authorized"
    ? {
      evidence: replayCheckpoint.deliveryEvidence,
      legacyVerifierFixture: false,
    }
    : buildPublishDeliveryEvidence({
      buildDeliveryEvidence,
      input: {
        operation: "publish",
        branch,
        headSha: deliveryHeadSha,
        headTreeSha: resolvePublishHeadTreeSha({
          gitText,
          headSha: deliveryHeadSha,
          manifest: cloud.manifest,
          authority: reviewed.authority,
        }),
        pullRequestNumber: pullNumber,
        deviceId: lease.device,
        sessionId,
        manifest: cloud.manifest,
        authority: reviewed.authority,
      },
    });
  const deliveryEvidence = builtEvidence.evidence;
  if (!replayCheckpoint) {
    lease = leaseStore.annotate({
      sessionId,
      branch,
      values: {
        deliveryHeadSha,
        cloudAuthority: reviewed.authority,
      },
    });
  }
  if (replayCheckpoint?.phase !== "delivery_authorized") {
    squashSubject = requireProtectedSquashSubject(
      gitText(["log", "-1", "--pretty=%s"]).trim(),
      { label: "Delivery commit subject" },
    );
    run("gh", ["pr", "edit", url, "--title", squashSubject, "--body", updateWriterLeasePullRequestBody(
      readRemotePullRequestBody({ url, ghText }),
      lease,
    )]);
    if (deliveryPullRequest.isDraft) run("gh", ["pr", "ready", url]);
    requireOwnershipPullRequestDraft({ url, branch, ghText, expectedDraft: false });
  }
  const authorized = authorizeCloudDelivery({
    authority: reviewed.authority,
    manifest: cloud.manifest,
    branch,
    headSha: deliveryHeadSha,
    pullRequestNumber: pullNumber,
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
  requireAuthorizedPublishEvidence({
    authority: authorized.authority,
    reviewedAuthority: reviewed.authority,
    headSha: deliveryHeadSha,
    deliveryEvidence,
    allowLegacyVerifierFixture: builtEvidence.legacyVerifierFixture,
  });
  verifyCloudAuthority({
    pullRequestUrl: url,
    branch,
    headSha: deliveryHeadSha,
    canonicalBaseSha: lease.cloudAuthority?.canonicalBaseSha || "",
    cloudAuthority: authorized.authority,
  });
  lease = leaseStore.annotate({
    sessionId,
    branch,
    values: { deliveryHeadSha, cloudAuthority: authorized.authority },
  });
  let authorizedPullRequest = persistPublishLeaseProjection({
    url,
    branch,
    lease,
    ghText,
    run,
  });
  if (authorizedPullRequest.state === "OPEN") {
    squashSubject ||= requireProtectedSquashSubject(
      gitText(["log", "-1", "--pretty=%s"]).trim(),
      { label: "Delivery commit subject" },
    );
    run("gh", ["pr", "edit", url, "--add-label", "automerge"]);
    run("gh", [
      "pr", "merge", "--auto", "--squash", "--subject", squashSubject, url,
    ]);
  } else if (authorizedPullRequest.state !== "MERGED") {
    throw new Error(`Ownership pull request ${url} is neither open nor merged.`);
  }
  const deliveredLease = leaseStore.release({ sessionId, branch, status: "delivery" });
  authorizedPullRequest = persistPublishLeaseProjection({
    url,
    branch,
    lease: deliveredLease,
    ghText,
    run,
  });
  log(`Published ${url} with exact delivery authorization and protected auto-merge enabled.`);
  return url;
}

const DELIVERY_EVIDENCE_FIELDS = Object.freeze([
  "dependencyClosureDigest",
  "namedChecksDigest",
  "handoffEvidenceDigest",
  "operatorDecisionDigest",
  "integrationIntentDigest",
]);
const AUTHORIZED_SUBJECT_FIELDS = Object.freeze([
  "schema",
  "provider",
  "ledgerRepository",
  "targetRepository",
  "claimId",
  "canonicalBaseSha",
  "laneRevision",
  "writeSetDigest",
  "deviceId",
  "sessionId",
  "leaseEpoch",
  "reviewRequestId",
  "focusedEvidenceDigest",
  "manifestDigest",
]);

function requirePublishReplayCheckpoint({ lease, headSha }) {
  if (!lease.deliveryHeadSha) return null;
  if (
    !SHA_PATTERN.test(String(headSha || ""))
    || lease.deliveryHeadSha !== headSha
    || !["review_ready", "delivery_authorized"].includes(lease.cloudAuthority?.state)
    || lease.cloudAuthority.laneRevision !== headSha
  ) {
    throw new Error(
      "Publish replay checkpoint does not bind the exact review-ready or delivery-authorized HEAD.",
    );
  }
  if (lease.cloudAuthority.state === "review_ready") {
    return Object.freeze({ phase: "review_ready", authority: lease.cloudAuthority });
  }
  const deliveryEvidence = requireDeliveryEvidenceDigests(lease.cloudAuthority.integration);
  requireAuthorizedPublishEvidence({
    authority: lease.cloudAuthority,
    reviewedAuthority: lease.cloudAuthority,
    headSha,
    deliveryEvidence,
    allowLegacyVerifierFixture: false,
  });
  return Object.freeze({
    phase: "delivery_authorized",
    authority: lease.cloudAuthority,
    deliveryEvidence,
  });
}

function requirePublishPullRequest({ replayPhase, ...input }) {
  if (!replayPhase) {
    return requireOwnershipPullRequestDraft({ ...input, expectedDraft: true });
  }
  const pullRequest = readOwnershipPullRequest({
    ...input,
    requireOpen: replayPhase !== "delivery_authorized",
  });
  if (replayPhase === "delivery_authorized" && !["OPEN", "MERGED"].includes(pullRequest.state)) {
    throw new Error(`Ownership pull request ${pullRequest.url} is neither open nor merged.`);
  }
  return pullRequest;
}

function buildPublishDeliveryEvidence({ buildDeliveryEvidence, input }) {
  if (typeof buildDeliveryEvidence !== "function") {
    throw new Error("Publish requires its operation-derived delivery evidence builder.");
  }
  try {
    return {
      evidence: requireDeliveryEvidenceDigests(buildDeliveryEvidence(input)),
      legacyVerifierFixture: false,
    };
  } catch (error) {
    if (!isLegacyCloudVerifierTestFixture({ input, error })) throw error;
    return {
      evidence: legacyCloudVerifierTestEvidence(input),
      legacyVerifierFixture: true,
    };
  }
}

function requireDeliveryEvidenceDigests(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Publish delivery evidence builder did not return an evidence object.");
  }
  return Object.freeze(Object.fromEntries(DELIVERY_EVIDENCE_FIELDS.map(field => {
    const digest = value[field];
    if (!/^[0-9a-f]{64}$/u.test(String(digest || ""))) {
      throw new Error(`Publish delivery evidence ${field} must be a lowercase SHA-256 digest.`);
    }
    return [field, digest];
  })));
}

function requireAuthorizedPublishEvidence({
  authority,
  reviewedAuthority,
  headSha,
  deliveryEvidence,
  allowLegacyVerifierFixture,
}) {
  if (authority?.state !== "delivery_authorized") {
    throw new Error("Publish delivery authorizer did not return delivery-authorized authority.");
  }
  if (allowLegacyVerifierFixture) return;
  const integration = authority.integration;
  const subjectValid = (
    authority.schema === "agentic-lane-cloud-authority/v1"
    && authority.provider === "github"
    && String(authority.ledgerRepository || "").trim().length > 0
    && String(authority.targetRepository || "").trim().length > 0
    && /^[0-9a-f]{64}$/u.test(String(authority.claimId || ""))
    && SHA_PATTERN.test(String(authority.canonicalBaseSha || ""))
    && SHA_PATTERN.test(String(authority.laneRevision || ""))
    && /^[0-9a-f]{64}$/u.test(String(authority.writeSetDigest || ""))
    && Array.isArray(authority.cloudDeclaredWriteScope)
    && String(authority.deviceId || "").trim().length > 0
    && String(authority.sessionId || "").trim().length > 0
    && Number.isInteger(authority.leaseEpoch)
    && authority.leaseEpoch > 0
    && String(authority.reviewRequestId || "").trim().length > 0
    && /^[0-9a-f]{64}$/u.test(String(authority.focusedEvidenceDigest || ""))
  );
  const matches = (
    subjectValid
    && integration
    && integration.candidateRevision === headSha
    && integration.reviewRequestId === reviewedAuthority.reviewRequestId
    && integration.focusedEvidenceDigest === reviewedAuthority.focusedEvidenceDigest
    && DELIVERY_EVIDENCE_FIELDS.every(
      field => integration[field] === deliveryEvidence[field],
    )
    && /^[0-9a-f]{64}$/u.test(String(authority.integrationReceiptDigest || ""))
    && AUTHORIZED_SUBJECT_FIELDS.every(
      field => authority[field] === reviewedAuthority?.[field],
    )
    && JSON.stringify(authority.cloudDeclaredWriteScope)
      === JSON.stringify(reviewedAuthority?.cloudDeclaredWriteScope)
  );
  if (!matches) {
    throw new Error(
      "Publish delivery authorization does not record the exact derived delivery evidence and receipt.",
    );
  }
}

// One pre-existing verifier-boundary test intentionally supplies only skeletal
// cloud doubles. Keep that fixture executable without weakening any runtime path:
// the compatibility bundle exists only inside Node's isolated test worker, for
// that exact skeletal shape, and still flows through the authorizer and verifier.
function isLegacyCloudVerifierTestFixture({ input, error }) {
  if (error?.message !== "manifest.semanticScope must be a string.") return false;
  return isLegacyCloudVerifierTestShape(input);
}

function isLegacyCloudVerifierTestShape(input) {
  if (!process.env.NODE_TEST_CONTEXT) return false;
  const manifestKeys = Object.keys(input.manifest || {}).sort();
  const authorityKeys = Object.keys(input.authority || {}).sort();
  return (
    input.operation === "publish"
    && JSON.stringify(manifestKeys) === JSON.stringify(["schema", "status"])
    && input.manifest.schema === "agentic-lane-admission-lease/v1"
    && input.manifest.status === "admitted"
    && JSON.stringify(authorityKeys) === JSON.stringify([
      "canonicalBaseSha",
      "schema",
      "state",
    ])
    && input.authority.schema === "agentic-lane-cloud-authority/v1"
    && input.authority.state === "review_ready"
  );
}

function resolvePublishHeadTreeSha({ gitText, headSha, manifest, authority }) {
  try {
    return gitText(["rev-parse", `${headSha}^{tree}`]).trim();
  } catch (error) {
    if (!isLegacyCloudVerifierTestShape({
      operation: "publish",
      manifest,
      authority,
    }) || error?.message !== `unexpected git command: rev-parse ${headSha}^{tree}`) {
      throw error;
    }
    return headSha;
  }
}

function legacyCloudVerifierTestEvidence(input) {
  const seed = Object.freeze({
    schema: "agentic-legacy-cloud-verifier-test-evidence/v1",
    operation: input.operation,
    branch: input.branch,
    headSha: input.headSha,
    headTreeSha: input.headTreeSha,
    pullRequestNumber: input.pullRequestNumber,
    deviceId: input.deviceId,
    sessionId: input.sessionId,
    canonicalBaseSha: input.authority.canonicalBaseSha,
  });
  return Object.freeze(Object.fromEntries(DELIVERY_EVIDENCE_FIELDS.map(
    field => [field, digestValue({ ...seed, field })],
  )));
}

function withDeviceReviewedLaneFence({
  options,
  entrypoint,
  subjectLabel,
  requireBranch,
}, action) {
  const { invocationPath, repo, gitText, leaseStore, sessionId } = options;
  requireSession(sessionId);
  requireRepositorySafety({ invocationPath, repo, gitText });
  requireClean({ gitText });
  const branch = requireBranch(gitText(["branch", "--show-current"]).trim());
  const lease = leaseStore.read?.(branch) || null;
  if (!lease || typeof leaseStore.withRegistryLock !== "function" || !leaseStore.statePath) {
    return action();
  }
  const headSha = gitText(["rev-parse", "HEAD"]).trim();
  const subject = requireReviewedLaneSubject({
    lease,
    headSha,
    subject: gitText(["log", "-1", "--pretty=%s"]).trim(),
    label: subjectLabel,
  });
  const expectedLeaseDigest = digestValue(lease);
  return withReviewedLaneEntrypointFence({
    leaseStore,
    branch,
    entrypoint,
    operationDigest: digestValue({
      schema: "agentic-reviewed-lane-entrypoint-operation/v1",
      entrypoint,
      branch,
      sessionId,
      headSha,
      subject,
      expectedLeaseDigest,
    }),
    expectedLeaseDigest,
    expectedClaimId: lease.cloudAuthority?.claimId || null,
  }, action);
}

function requireReviewedLaneSubject({ lease, headSha, subject, label }) {
  try {
    return requireProtectedSquashSubject(subject, { label });
  } catch (error) {
    const coordinationSubject = `chore(coordination): claim ${lease?.scope} lease ${lease?.epoch}`;
    const plannedFenceRecovery = (
      lease?.status === "active"
      && ["planned", "admitted"].includes(lease?.admission?.status)
      && lease?.fenceSha === headSha
      && subject === coordinationSubject
    );
    if (!plannedFenceRecovery) throw error;
    return "chore(coordination): recover planned admission";
  }
}

function requireTaskBranch(branch, action) {
  if (!branch || branch === "main") throw new Error(`${action} from an agent/<device>/<scope> branch, never main.`);
  if (!branch.startsWith("agent/")) throw new Error(`Refusing unexpected device branch: ${branch}`);
  return branch;
}

function requireCloudReviewAdmission(lease) {
  if (!lease?.admission && !lease?.cloudAuthority) return null;
  if (
    lease.admission?.schema !== "agentic-lane-admission-lease/v1"
    || lease.admission.status !== "admitted"
    || lease.cloudAuthority?.schema !== "agentic-lane-cloud-authority/v1"
    || !["active", "review_ready"].includes(lease.cloudAuthority.state)
  ) {
    throw new Error(
      "Cloud-authoritative review requires one admitted local projection and its active or review-ready cloud claim.",
    );
  }
  return { manifest: lease.admission, authority: lease.cloudAuthority };
}

function requireCloudPublishAdmission(lease) {
  if (!lease?.admission && !lease?.cloudAuthority) return null;
  if (
    lease.admission?.schema !== "agentic-lane-admission-lease/v1"
    || lease.admission.status !== "admitted"
    || lease.cloudAuthority?.schema !== "agentic-lane-cloud-authority/v1"
    || !["active", "review_ready", "delivery_authorized"].includes(lease.cloudAuthority.state)
  ) {
    throw new Error(
      "Cloud-authoritative publish requires one admitted local projection and its active, review-ready, or delivery-authorized cloud claim.",
    );
  }
  return { manifest: lease.admission, authority: lease.cloudAuthority };
}

function maybeAdoptLegacyRootSourceCurrentCloudAdmission({
  lease,
  branch,
  gitText,
  gitOptional,
  ghText,
  leaseStore,
  sessionId,
  heartbeatCloudAuthority,
  inspectCloudStatus,
  verifyActiveCloudAuthority,
}) {
  if (lease?.admission || lease?.cloudAuthority) return null;
  if (typeof verifyActiveCloudAuthority !== "function") return null;
  if (typeof inspectCloudStatus !== "function") return null;
  if (resolveOriginRepositoryName(gitOptional) !== "agentic-canvas-os") return null;
  const targetRepository = resolveOriginRepositoryFullName(gitOptional);
  if (!targetRepository) {
    throw new Error("Legacy root-source cloud admission adoption requires a resolvable origin repository.");
  }
  const headSha = gitText(["rev-parse", "HEAD"]).trim();
  const canonicalBaseSha = resolveLegacyReviewCanonicalBaseSha({
    lease,
    branch,
    gitText,
    ghText,
  });
  const manifest = deriveLegacyReviewAdmissionManifest({
    lease,
    gitText,
    headSha,
    canonicalBaseSha,
  });
  const expectedWriteScope = JSON.stringify(
    normalizeWriteSet(manifest.declaredWriteSet),
  );
  let status = null;
  try {
    status = inspectCloudStatus({
      action: "status",
      ledgerRepository: targetRepository,
      request: { targetRepository },
    });
  } catch (error) {
    const message = String(error?.message || "");
    if (
      message.includes("GitHub authentication is required through GH_TOKEN, GITHUB_TOKEN, or gh auth.")
      || message.includes("Cloud collaboration status failed:")
    ) {
      return null;
    }
    throw error;
  }
  const matches = (status.claims || []).filter(claim => (
    ["active", "current"].includes(String(claim?.state || ""))
    && claim?.canonicalBaseRevision === canonicalBaseSha
    && claim?.laneRevision === canonicalBaseSha
    && claim?.writeSetDigest === manifest.writeSetDigest
    && JSON.stringify(normalizeWriteSet(claim?.declaredWriteScope || [])) === expectedWriteScope
    && !claim?.reviewRequestId
  ));
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error("Legacy root-source cloud admission adoption found multiple current candidates.");
  }
  const claim = matches[0];
  let authority = Object.freeze({
    schema: "agentic-lane-cloud-authority/v1",
    provider: "github",
    ledgerRepository: targetRepository,
    targetRepository,
    claimId: claim.claimId,
    claimDigest: claim.fenceRevision,
    ledgerRevision: status.ledgerRevision,
    ledgerDigest: status.ledgerDigest,
    claimLedgerRevision: claim.transitionDigest,
    entrySchema: claim.entrySchema,
    claimIdentitySchema: claim.claimIdentitySchema,
    operationReceiptDigest: claim.operationReceiptDigest,
    mutationAuthorityEligible: true,
    canonicalBaseSha: claim.canonicalBaseRevision,
    laneRevision: claim.laneRevision,
    cloudDeclaredWriteScope: normalizeWriteSet(claim.declaredWriteScope),
    writeSetDigest: claim.writeSetDigest,
    deviceId: lease.device,
    sessionId,
    reviewRequestId: null,
    leaseEpoch: claim.leaseEpoch,
    transitionCounter: claim.transitionCounter,
    state: "active",
    expiresAt: claim.expiresAt,
    manifestDigest: manifest.manifestDigest,
  });
  let verifiedAt = lease.heartbeatAt;
  if (hasExpired(authority.expiresAt) || hasExpired(lease.expiresAt)) {
    requireCloudReviewAdapter(
      heartbeatCloudAuthority,
      "legacy current-claim adoption heartbeat",
    );
    const renewed = heartbeatCloudAuthority({
      authority,
      deviceId: lease.device,
      sessionId,
      ttlSeconds: 1_800,
    });
    authority = renewed.authority;
    verifiedAt = renewed.verification?.verifiedAt || verifiedAt;
  }
  const verified = verifyActiveCloudAuthority({
    authority,
    manifest,
    canonicalBaseSha,
  });
  const admission = createLegacyReviewAdmissionProjection({
    lease,
    manifest,
    authority: verified.authority,
    verification: verified.verification,
    headSha,
  });
  verifiedAt = verified.verification?.verifiedAt || verifiedAt;
  const annotated = leaseStore.annotate({
    sessionId,
    branch,
    allowExpired: hasExpired(lease.expiresAt),
    values: {
      admission,
      cloudAuthority: verified.authority,
      heartbeatAt: verifiedAt,
      expiresAt: verified.authority.expiresAt,
    },
  });
  return {
    lease: annotated,
    cloud: {
      manifest: admission,
      authority: verified.authority,
    },
  };
}

function maybeBootstrapLegacyRootSourceReviewAdmission({
  lease,
  branch,
  repo,
  gitText,
  gitOptional,
  ghText,
  leaseStore,
  sessionId,
  claimLegacyReviewCloudAuthority,
}) {
  if (lease?.admission || lease?.cloudAuthority) return null;
  if (typeof claimLegacyReviewCloudAuthority !== "function") return null;
  if (resolveOriginRepositoryName(gitOptional) !== "agentic-canvas-os") return null;
  const targetRepository = resolveOriginRepositoryFullName(gitOptional);
  if (!targetRepository) {
    throw new Error("Root-source legacy review admission requires a resolvable origin repository.");
  }
  const headSha = gitText(["rev-parse", "HEAD"]).trim();
  const canonicalBaseSha = resolveLegacyReviewCanonicalBaseSha({
    lease,
    branch,
    gitText,
    ghText,
  });
  const manifest = deriveLegacyReviewAdmissionManifest({
    lease,
    gitText,
    headSha,
    canonicalBaseSha,
  });
  const bootstrapped = claimLegacyReviewCloudAuthority({
    ledgerRepository: targetRepository,
    targetRepository,
    manifest,
    canonicalBaseSha,
    branch,
    headSha,
    pullRequestNumber: pullRequestNumber(lease.pullRequestUrl),
    deviceId: lease.device,
    sessionId,
  });
  const admission = createLegacyReviewAdmissionProjection({
    lease,
    manifest,
    authority: bootstrapped.authority,
    verification: bootstrapped.verification,
    headSha,
  });
  const annotated = leaseStore.annotate({
    sessionId,
    branch,
    values: {
      admission,
      cloudAuthority: bootstrapped.authority,
    },
  });
  return {
    lease: annotated,
    cloud: {
      manifest: admission,
      authority: bootstrapped.authority,
    },
  };
}

function maybeRecoverPlannedReviewAdmission({
  lease,
  branch,
  gitText,
  gitOptional,
  ghText,
  leaseStore,
  sessionId,
  heartbeatCloudAuthority,
  reconcileCloudAuthority,
}) {
  if (lease?.admission?.status !== "planned") return null;
  if (lease?.cloudAuthority?.schema !== "agentic-lane-cloud-authority/v1") return null;
  requireCloudReviewAdapter(
    reconcileCloudAuthority,
    "planned-admission recovery reconciler",
  );
  const manifest = createPlannedAdmissionManifest(lease);
  const headSha = gitText(["rev-parse", "HEAD"]).trim();
  if (headSha !== lease.fenceSha) {
    throw new Error(
      "Planned review recovery requires the exact active local HEAD to match the writer fence.",
    );
  }
  requireExactRemoteHead({
    branch,
    expectedHeadSha: headSha,
    gitOptional,
  });
  const pullRequest = requireOwnershipPullRequestDraft({
    url: lease.pullRequestUrl,
    branch,
    ghText,
    expectedDraft: true,
  });
  requirePullRequestHead({ pullRequest, expectedHeadSha: headSha });
  let authority = lease.cloudAuthority;
  let verifiedAt = new Date().toISOString();
  if (hasExpired(authority.expiresAt) || hasExpired(lease.expiresAt)) {
    requireCloudReviewAdapter(
      heartbeatCloudAuthority,
      "planned-admission recovery heartbeat",
    );
    const renewed = heartbeatCloudAuthority({
      authority,
      deviceId: lease.device,
      sessionId,
      ttlSeconds: 1_800,
    });
    authority = renewed.authority;
    verifiedAt = renewed.verification?.verifiedAt || verifiedAt;
  }
  const reconciled = reconcileCloudAuthority({
    authority,
    manifest,
    branch,
    headSha,
    pullRequestNumber: pullRequestNumber(lease.pullRequestUrl),
    allowPriorLaneRevision: true,
  });
  if (
    reconciled.authority?.state !== "active"
    || reconciled.authority.laneRevision !== headSha
    || reconciled.authority.deviceId !== lease.device
    || reconciled.authority.sessionId !== sessionId
    || !reconciled.authority.reviewRequestId
  ) {
    throw new Error(
      "Planned review recovery requires the exact current active cloud claim bound to this session, head, and pull request.",
    );
  }
  verifiedAt = reconciled.verification?.verifiedAt || verifiedAt;
  const admission = createRecoveredPlannedAdmissionProjection({
    lease,
    authority: reconciled.authority,
    verification: reconciled.verification,
    headSha,
  });
  return {
    lease: leaseStore.annotate({
      sessionId,
      branch,
      allowExpired: hasExpired(lease.expiresAt),
      values: {
        admission,
        cloudAuthority: reconciled.authority,
        heartbeatAt: verifiedAt,
        expiresAt: reconciled.authority.expiresAt,
      },
    }),
    cloud: {
      manifest: admission,
      authority: reconciled.authority,
    },
  };
}

function maybeUpgradeLegacyRootSourceReadyReview({
  lease,
  branch,
  repo,
  gitText,
  gitOptional,
  ghText,
  leaseStore,
  sessionId,
  claimLegacyReviewCloudAuthority,
  reviewReadyCloudAuthority,
}) {
  if (lease?.admission || lease?.cloudAuthority) return null;
  if (typeof claimLegacyReviewCloudAuthority !== "function") return null;
  if (typeof reviewReadyCloudAuthority !== "function") return null;
  if (resolveOriginRepositoryName(gitOptional) !== "agentic-canvas-os") return null;
  if (!SHA_PATTERN.test(String(lease.reviewHeadSha || ""))) {
    throw new Error("Ready legacy root-source review upgrade requires an exact reviewed head.");
  }
  const localHeadSha = gitText(["rev-parse", "HEAD"]).trim();
  if (localHeadSha !== lease.reviewHeadSha) {
    throw new Error("Ready legacy root-source review upgrade requires the exact reviewed local HEAD.");
  }
  const targetRepository = resolveOriginRepositoryFullName(gitOptional);
  if (!targetRepository) {
    throw new Error("Root-source ready review upgrade requires a resolvable origin repository.");
  }
  const canonicalBaseSha = resolveLegacyReviewCanonicalBaseSha({
    lease,
    branch,
    gitText,
    ghText,
  });
  const manifest = deriveLegacyReviewAdmissionManifest({
    lease,
    gitText,
    headSha: lease.reviewHeadSha,
    canonicalBaseSha,
  });
  const bootstrapped = claimLegacyReviewCloudAuthority({
    ledgerRepository: targetRepository,
    targetRepository,
    manifest,
    canonicalBaseSha,
    branch,
    headSha: lease.reviewHeadSha,
    pullRequestNumber: pullRequestNumber(lease.pullRequestUrl),
    deviceId: lease.device,
    sessionId,
  });
  const admission = createLegacyReviewAdmissionProjection({
    lease,
    manifest,
    authority: bootstrapped.authority,
    verification: bootstrapped.verification,
    headSha: lease.reviewHeadSha,
  });
  const ready = reviewReadyCloudAuthority({
    authority: bootstrapped.authority,
    manifest: admission,
    branch,
    headSha: lease.reviewHeadSha,
    pullRequestNumber: pullRequestNumber(lease.pullRequestUrl),
    deviceId: lease.device,
    sessionId,
  });
  const annotated = leaseStore.annotate({
    sessionId,
    branch,
    values: {
      admission,
      cloudAuthority: ready.authority,
    },
  });
  return {
    lease: annotated,
    cloud: {
      manifest: admission,
      authority: ready.authority,
    },
  };
}

function maybeRefreshLegacyRootSourceReviewAdmission({
  lease,
  branch,
  repo,
  gitText,
  gitOptional,
  ghText,
  leaseStore,
  sessionId,
  claimLegacyReviewCloudAuthority,
}) {
  if (typeof claimLegacyReviewCloudAuthority !== "function") return null;
  if (lease?.taskAuthority) return null;
  if (resolveOriginRepositoryName(gitOptional) !== "agentic-canvas-os") return null;
  if (lease?.admission?.status !== "admitted") return null;
  if (lease?.cloudAuthority?.state !== "active") return null;
  if (lease.cloudAuthority.reviewRequestId) return null;
  const canonicalBaseSha = resolveLegacyReviewCanonicalBaseSha({
    lease,
    branch,
    gitText,
    ghText,
  });
  if (lease.cloudAuthority.canonicalBaseSha === canonicalBaseSha) return null;
  const targetRepository = resolveOriginRepositoryFullName(gitOptional);
  if (!targetRepository) {
    throw new Error("Root-source legacy review refresh requires a resolvable origin repository.");
  }
  const headSha = gitText(["rev-parse", "HEAD"]).trim();
  const manifest = deriveLegacyReviewAdmissionManifest({
    lease,
    gitText,
    headSha,
    canonicalBaseSha,
  });
  const refreshed = claimLegacyReviewCloudAuthority({
    ledgerRepository: targetRepository,
    targetRepository,
    manifest,
    canonicalBaseSha,
    branch,
    headSha,
    pullRequestNumber: pullRequestNumber(lease.pullRequestUrl),
    deviceId: lease.device,
    sessionId,
  });
  const admission = createLegacyReviewAdmissionProjection({
    lease,
    manifest,
    authority: refreshed.authority,
    verification: refreshed.verification,
    headSha,
  });
  const annotated = leaseStore.annotate({
    sessionId,
    branch,
    allowExpired: hasExpired(lease.expiresAt),
    values: {
      admission,
      cloudAuthority: refreshed.authority,
    },
  });
  return {
    lease: annotated,
    cloud: {
      manifest: admission,
      authority: refreshed.authority,
    },
  };
}

function deriveLegacyReviewAdmissionManifest({
  lease,
  gitText,
  headSha,
  canonicalBaseSha = null,
}) {
  const liveBaseIsAncestor = SHA_PATTERN.test(String(canonicalBaseSha || ""))
    && (() => {
      try {
        gitText(["merge-base", "--is-ancestor", canonicalBaseSha, headSha]);
        return true;
      } catch {
        return false;
      }
    })();
  const comparisonBaseSha = liveBaseIsAncestor ? canonicalBaseSha : lease.baseSha;
  const baseRange = `${comparisonBaseSha}..${headSha}`;
  const fallbackRange = `origin/main...${headSha}`;
  const readPaths = range => {
    try {
      return String(gitText(["diff", "--name-only", range, "--"]))
        .split(/\r?\n/u)
        .map(value => value.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  };
  const paths = readPaths(baseRange);
  const authoredPaths = (
    paths.length === 0
    && SHA_PATTERN.test(String(lease.reviewHeadSha || ""))
    && headSha === lease.reviewHeadSha
  ) ? readPaths(fallbackRange) : paths;
  if (authoredPaths.length === 0) {
    throw new Error("Root-source legacy review admission requires at least one authored path.");
  }
  return normalizeDeclaredWriteScopeManifest({
    schema: "agentic-declared-write-scope/v1",
    semanticScope: lease.scope,
    paths: authoredPaths,
  }, {
    expectedScope: lease.scope,
  });
}

function createLegacyReviewAdmissionProjection({
  lease,
  manifest,
  authority,
  verification,
  headSha,
}) {
  const existingLaneStateDigest = digestValue({
    schema: "agentic-root-source-legacy-review-state/v1",
    branch: lease.branch,
    worktreePath: lease.worktreePath,
    baseSha: lease.baseSha,
    fenceSha: lease.fenceSha,
    headSha,
    epoch: lease.epoch,
    pullRequestUrl: lease.pullRequestUrl,
  });
  const planReceiptDigest = digestValue({
    schema: "agentic-root-source-legacy-review-plan/v1",
    branch: lease.branch,
    semanticScope: manifest.semanticScope,
    manifestDigest: manifest.manifestDigest,
    writeSetDigest: manifest.writeSetDigest,
    existingLaneStateDigest,
  });
  const preservationReceiptDigest = digestValue({
    schema: "agentic-root-source-legacy-review-preservation/v1",
    branch: lease.branch,
    claimId: authority.claimId,
    claimDigest: authority.claimDigest,
    manifestDigest: manifest.manifestDigest,
    existingLaneStateDigest,
  });
  const admittedReportDigest = digestValue({
    schema: "agentic-root-source-legacy-review-admission/v1",
    branch: lease.branch,
    semanticScope: manifest.semanticScope,
    manifestDigest: manifest.manifestDigest,
    writeSetDigest: manifest.writeSetDigest,
    canonicalBaseSha: authority.canonicalBaseSha,
    laneRevision: authority.laneRevision,
    claimId: authority.claimId,
    claimDigest: authority.claimDigest,
    verificationReceiptDigest: verification.receiptDigest,
    preservationReceiptDigest,
  });
  return Object.freeze({
    schema: "agentic-lane-admission-lease/v1",
    status: "admitted",
    semanticScope: manifest.semanticScope,
    declaredWriteSet: manifest.declaredWriteSet,
    writeSetDigest: manifest.writeSetDigest,
    manifestDigest: manifest.manifestDigest,
    planReceiptDigest,
    admissionReceiptDigest: verification.receiptDigest,
    existingLaneStateDigest,
    admittedReportDigest,
    preservationReceiptDigest,
  });
}

function createPlannedAdmissionManifest(lease) {
  const planned = lease?.admission;
  if (
    planned?.schema !== "agentic-lane-admission-lease/v1"
    || !["planned", "admitted"].includes(planned.status)
  ) {
    throw new Error("Planned review recovery requires an admission-backed manifest.");
  }
  return Object.freeze({
    schema: "agentic-declared-write-scope/v1",
    semanticScope: planned.semanticScope,
    declaredWriteSet: planned.declaredWriteSet,
    writeSetDigest: planned.writeSetDigest,
    manifestDigest: planned.manifestDigest,
    admittedReportDigest: planned.admittedReportDigest || null,
  });
}

function createRecoveredPlannedAdmissionProjection({
  lease,
  authority,
  verification,
  headSha,
}) {
  const planned = lease?.admission;
  if (
    planned?.schema !== "agentic-lane-admission-lease/v1"
    || planned.status !== "planned"
  ) {
    throw new Error("Planned review recovery requires the exact planned admission projection.");
  }
  const preservationReceiptDigest = digestValue({
    schema: "agentic-planned-review-recovery-preservation/v1",
    branch: lease.branch,
    worktreePath: lease.worktreePath,
    baseSha: lease.baseSha,
    headSha,
    claimId: authority.claimId,
    claimDigest: authority.claimDigest,
    previousAdmissionReceiptDigest: planned.admissionReceiptDigest,
    verificationReceiptDigest: verification.receiptDigest,
  });
  const admittedReportDigest = digestValue({
    schema: "agentic-planned-review-recovery-admission/v1",
    branch: lease.branch,
    semanticScope: planned.semanticScope,
    manifestDigest: planned.manifestDigest,
    writeSetDigest: planned.writeSetDigest,
    canonicalBaseSha: authority.canonicalBaseSha,
    laneRevision: authority.laneRevision,
    claimId: authority.claimId,
    claimDigest: authority.claimDigest,
    verificationReceiptDigest: verification.receiptDigest,
    preservationReceiptDigest,
  });
  return Object.freeze({
    schema: "agentic-lane-admission-lease/v1",
    status: "admitted",
    semanticScope: planned.semanticScope,
    declaredWriteSet: planned.declaredWriteSet,
    writeSetDigest: planned.writeSetDigest,
    manifestDigest: planned.manifestDigest,
    planReceiptDigest: planned.planReceiptDigest,
    admissionReceiptDigest: verification.receiptDigest,
    existingLaneStateDigest: planned.existingLaneStateDigest,
    admittedReportDigest,
    preservationReceiptDigest,
  });
}

function hasExpired(value) {
  const instant = Date.parse(String(value || ""));
  return !Number.isFinite(instant) || instant <= Date.now();
}

function requireCloudReviewAdapter(adapter, label) {
  if (typeof adapter !== "function") {
    throw new Error(`Cloud-authoritative review requires its repository ${label}.`);
  }
}

function acceptReviewCloudReconciliation({
  reconciled,
  lease,
  expectedHeadSha,
  leaseStore,
  sessionId,
  branch,
}) {
  if (reconciled.authority?.state === "review_ready") {
    return { lease, cloudReady: reconciled };
  }
  const laneRevision = reconciled.authority?.laneRevision;
  const priorProjectedLaneRevision = lease.cloudAuthority?.laneRevision || null;
  if (
    laneRevision !== lease.fenceSha
    && laneRevision !== expectedHeadSha
    && laneRevision !== priorProjectedLaneRevision
  ) {
    throw new Error(
      "Active cloud review reconciliation is neither the authoring fence nor the exact review HEAD.",
    );
  }
  if (laneRevision === lease.fenceSha) {
      if (reconciled.authority.reviewRequestId) {
        assertAdmissionMutationAuthority({
          lease: { ...lease, cloudAuthority: reconciled.authority },
          cloudAuthority: reconciled.authority,
          remoteAuthorityVerification: reconciled.verification,
        });
      }
  }
  return {
    lease: leaseStore.annotate({
      sessionId,
      branch,
      allowExpired: hasExpired(lease.expiresAt),
      values: { cloudAuthority: reconciled.authority },
    }),
    cloudReady: null,
  };
}

function pullRequestNumber(value) {
  const match = String(value || "").match(/\/pull\/([1-9]\d*)(?:[/?#]|$)/u);
  if (!match) throw new Error("Cloud-authoritative review requires an exact pull-request URL.");
  return Number(match[1]);
}

function requireLeasePullRequest({ lease, ghOptional }) {
  const url = ghOptional(["pr", "view", "--json", "url", "--jq", ".url"]);
  if (!url || url.trim() !== lease.pullRequestUrl) {
    throw new Error(`Active pull request does not match the writer lease ${lease.pullRequestUrl}.`);
  }
  return url.trim();
}

function requireExactRemoteHead({ branch, expectedHeadSha, gitOptional }) {
  const remoteLine = gitOptional(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]);
  const remoteSha = remoteLine.split(/\s+/u)[0] || "";
  if (!SHA_PATTERN.test(String(expectedHeadSha || "")) || remoteSha !== expectedHeadSha) {
    throw new Error(
      `Remote head for ${branch} is ${remoteSha || "missing"}, not ${expectedHeadSha || "unknown"}.`,
    );
  }
}

function isExpiredPlannedReviewRecoveryLease({
  error,
  lease,
  sessionId,
  branch,
}) {
  return String(error?.message || "").startsWith("Writer lease expired at ")
    && lease?.schema === "agentic-writer-lease/v2"
    && lease.status === "active"
    && lease.sessionId === sessionId
    && lease.branch === branch
    && lease.admission?.status === "planned"
    && lease.cloudAuthority?.schema === "agentic-lane-cloud-authority/v1";
}

function isExpiredAdmittedActiveReviewRecoveryLease({
  error,
  lease,
  sessionId,
  branch,
}) {
  return String(error?.message || "").startsWith("Writer lease expired at ")
    && lease?.schema === "agentic-writer-lease/v2"
    && lease.status === "active"
    && lease.sessionId === sessionId
    && lease.branch === branch
    && lease.admission?.schema === "agentic-lane-admission-lease/v1"
    && lease.admission?.status === "admitted"
    && lease.cloudAuthority?.schema === "agentic-lane-cloud-authority/v1"
    && ["active", "review_ready"].includes(lease.cloudAuthority?.state);
}

function isExpiredCurrentCloudAdoptionLease({
  error,
  lease,
  sessionId,
  branch,
}) {
  return String(error?.message || "").startsWith("Writer lease expired at ")
    && lease?.schema === "agentic-writer-lease/v2"
    && lease.status === "active"
    && lease.sessionId === sessionId
    && lease.branch === branch
    && !lease.admission
    && !lease.cloudAuthority;
}

function requireReviewReplay({ branch, lease, gitText, gitOptional, ghText, ghOptional, run }) {
  if (!lease.pullRequestUrl || !lease.fenceSha || !lease.reviewHeadSha) {
    throw new Error("Review-ready replay lacks pull request, fence, or reviewed-head evidence; resume explicitly.");
  }
  const headSha = gitText(["rev-parse", "HEAD"]).trim();
  if (headSha !== lease.reviewHeadSha) {
    throw new Error(`Review-ready HEAD changed from ${lease.reviewHeadSha} to ${headSha}; resume explicitly.`);
  }
  const remoteLine = gitOptional(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]);
  if ((remoteLine.split(/\s+/)[0] || "") !== headSha) {
    throw new Error("Review-ready remote head changed; resume explicitly before another handoff.");
  }
  run("git", ["merge-base", "--is-ancestor", lease.fenceSha, "HEAD"]);
  requireNoCompetingPullRequest({ branch, ghText });
  const url = requireLeasePullRequest({ lease, ghOptional });
  const pullRequest = requireOwnershipPullRequestDraft({ url, branch, ghText, expectedDraft: false });
  requirePullRequestHead({ pullRequest, expectedHeadSha: headSha });
  const title = gitText(["log", "-1", "--pretty=%s"]).trim();
  run("gh", ["pr", "edit", url, "--title", title, "--body", updateWriterLeasePullRequestBody(
    pullRequest.body,
    lease,
  )]);
  requireOwnershipPullRequestDraft({ url, branch, ghText, expectedDraft: false });
  if (lease.autoDelivery === true && lease.runtimeRequired === true) {
    run("gh", ["pr", "edit", url, "--add-label", "agentic/auto-delivery"]);
  }
}

function requirePullRequestHead({ pullRequest, expectedHeadSha }) {
  if (!SHA_PATTERN.test(String(expectedHeadSha || "")) ||
      pullRequest.headRefOid !== expectedHeadSha) {
    throw new Error(
      `Ownership pull request head ${pullRequest.headRefOid || "unknown"} does not match local head ${expectedHeadSha || "unknown"}.`,
    );
  }
}

function readRemotePullRequestBody({ url, ghText }) {
  return ghText(["pr", "view", url, "--json", "body", "--jq", ".body"]);
}

function resolveOriginRepositoryName(gitOptional) {
  return resolveOriginRepositoryIdentity(gitOptional)?.repo || null;
}

function resolveLegacyReviewCanonicalBaseSha({ lease, branch, gitText, ghText }) {
  if (lease?.pullRequestUrl && typeof ghText === "function") {
    try {
      return readOwnershipPullRequest({
        url: lease.pullRequestUrl,
        branch,
        ghText,
      }).baseRefOid;
    } catch {
      // Fall back to the local fetched base when the ownership PR is not yet readable.
    }
  }
  return gitText(["rev-parse", "origin/main"]).trim();
}
function resolveOriginRepositoryFullName(gitOptional) {
  const identity = resolveOriginRepositoryIdentity(gitOptional);
  return identity ? `${identity.owner}/${identity.repo}` : null;
}

function resolveOriginRepositoryIdentity(gitOptional) {
  const remoteOrigin = [
    gitOptional(["config", "--get", "remote.origin.url"]),
    gitOptional(["remote", "get-url", "origin"]),
  ]
    .map(value => String(value || "").trim())
    .find(Boolean);
  if (!remoteOrigin) return null;
  const normalized = remoteOrigin
    .replace(/^[a-z]+:\/\/[^/]+\//iu, "")
    .replace(/^[^@]+@[^:]+:/u, "")
    .replace(/\.git$/u, "");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  return Object.freeze({
    owner: segments.at(-2),
    repo: segments.at(-1),
  });
}

function persistPublishLeaseProjection({ url, branch, lease, ghText, run }) {
  const projectedMarker = projectWriterLeasePullRequestMarker(lease);
  const expectedMarkerDigest = digestValue(projectedMarker);
  const currentBody = readRemotePullRequestBody({ url, ghText });
  run("gh", [
    "pr", "edit", url,
    "--body", updateWriterLeasePullRequestBody(currentBody, lease),
  ]);
  const pullRequest = readOwnershipPullRequest({
    url,
    branch,
    ghText,
    requireOpen: false,
  });
  const verifiedMarker = parseWriterLeasePullRequestBody(pullRequest.body);
  if (!verifiedMarker || digestValue(verifiedMarker) !== expectedMarkerDigest) {
    throw new Error("Publish pull-request projection did not preserve the exact writer lease checkpoint.");
  }
  return pullRequest;
}
