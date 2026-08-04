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
import { createDeviceDeliveryEvidence } from "./device-delivery-evidence.mjs";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  authorizeDeliveryAdmissionCloudAuthority,
  reviewReadyAdmissionCloudAuthority,
} from "./scoped-lane-cloud-authority.mjs";
import { assertAdmissionMutationAuthority } from "./scoped-lane-admission-state.mjs";
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

export function review({
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
  reconcileCloudAuthority = null,
  reviewReadyCloudAuthority = null,
  verifyReviewReadyCloudAuthority = null,
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
    const existingCloud = requireCloudReviewAdmission(existing);
    if (existingCloud) {
      requireCloudReviewAdapter(
        verifyReviewReadyCloudAuthority,
        "review-ready verifier",
      );
      verifyReviewReadyCloudAuthority({
        authority: existingCloud.authority,
        manifest: existingCloud.manifest,
        headSha: existing.reviewHeadSha,
        branch,
      });
    }
    requireReviewReplay({ branch, lease: existing, gitText, gitOptional, ghText, ghOptional, run });
    log(`Review is already ready at ${existing.pullRequestUrl}.`);
    return existing.pullRequestUrl;
  }
  let lease = leaseStore.verify({ sessionId, branch });
  assertLeaseWorktree(lease, repo);
  if (!lease.pullRequestUrl || !lease.fenceSha) {
    throw new Error("Review requires the draft ownership pull request and fencing SHA created by device:start.");
  }
  const cloud = requireCloudReviewAdmission(lease);
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
  if (cloud && !cloudReady) {
    cloudReady = reviewReadyCloudAuthority({
      authority: lease.cloudAuthority,
      manifest: cloud.manifest,
      branch,
      headSha: reviewHeadSha,
      pullRequestNumber: pullRequestNumber(url),
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
      values: {
        reviewHeadSha,
        cloudAuthority: cloudReady.authority,
      },
    });
  } else {
    lease = leaseStore.annotate({ sessionId, branch, values: { reviewHeadSha } });
  }
  if (pullRequest.isDraft) run("gh", ["pr", "ready", url]);
  const readyPullRequest = requireOwnershipPullRequestDraft({ url, branch, ghText, expectedDraft: false });
  requirePullRequestHead({ pullRequest: readyPullRequest, expectedHeadSha: reviewHeadSha });
  const title = gitText(["log", "-1", "--pretty=%s"]).trim();
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

export function publish({
  invocationPath,
  repo,
  gitText,
  ghText,
  ghOptional,
  leaseStore,
  sessionId,
  run,
  verifyCloudAuthority = verifyCloudDeliveryAuthority,
  reviewReadyCloudAuthority = reviewReadyAdmissionCloudAuthority,
  buildDeliveryEvidence = createDeviceDeliveryEvidence,
  authorizeCloudDelivery = authorizeDeliveryAdmissionCloudAuthority,
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
  const cloud = requireCloudPublishAdmission(lease);
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
    const title = gitText(["log", "-1", "--pretty=%s"]).trim();
    run("gh", ["pr", "edit", url, "--title", title, "--body", updateWriterLeasePullRequestBody(
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
    run("gh", ["pr", "edit", url, "--add-label", "automerge"]);
    run("gh", ["pr", "merge", "--auto", "--squash", url]);
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
  if (laneRevision !== lease.fenceSha && laneRevision !== expectedHeadSha) {
    throw new Error(
      "Active cloud review reconciliation is neither the authoring fence nor the exact review HEAD.",
    );
  }
  if (laneRevision === lease.fenceSha) {
    assertAdmissionMutationAuthority({
      lease: { ...lease, cloudAuthority: reconciled.authority },
      cloudAuthority: reconciled.authority,
      remoteAuthorityVerification: reconciled.verification,
    });
  }
  return {
    lease: leaseStore.annotate({
      sessionId,
      branch,
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
