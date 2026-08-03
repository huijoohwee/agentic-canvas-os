import { updateWriterLeasePullRequestBody } from "./writer-lease-lib.mjs";
import {
  requireOwnershipPullRequestDraft,
  waitForOwnershipPullRequestHead,
} from "./device-pull-request-state.mjs";
import { verifyCloudDeliveryAuthority } from "./cloud-collaboration-delivery-verifier.mjs";
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
  authorizeCloudDelivery = authorizeDeliveryAdmissionCloudAuthority,
  log = console.log,
}) {
  requireSession(sessionId);
  requireRepositorySafety({ invocationPath, repo, gitText });
  requireClean({ gitText });
  const branch = gitText(["branch", "--show-current"]).trim();
  if (!branch || branch === "main") throw new Error("Publish from an agent/<device>/<scope> branch, never main.");
  if (!branch.startsWith("agent/")) throw new Error(`Refusing unexpected device branch: ${branch}`);
  const lease = leaseStore.verify({ sessionId, branch });
  assertLeaseWorktree(lease, repo);
  if (!lease.pullRequestUrl || !lease.fenceSha) {
    throw new Error("Publish requires the draft ownership pull request and fencing SHA created by device:start.");
  }
  const cloud = requireCloudReviewAdmission(lease);
  if (!cloud) {
    throw new Error("Publish requires one admitted cloud claim; local-only delivery authority is forbidden.");
  }
  requireOwnershipPullRequestDraft({ url: lease.pullRequestUrl, branch, ghText, expectedDraft: true });
  run("git", ["merge-base", "--is-ancestor", lease.fenceSha, "HEAD"]);
  requireNoCompetingPullRequest({ branch, ghText });
  run("npm", ["run", "check"]);
  run("git", ["push", "--set-upstream", "origin", branch]);

  const url = ghOptional(["pr", "view", "--json", "url", "--jq", ".url"]);
  if (!url || url.trim() !== lease.pullRequestUrl) {
    throw new Error(`Active pull request does not match the writer lease ${lease.pullRequestUrl}.`);
  }
  const deliveryHeadSha = gitText(["rev-parse", "HEAD"]).trim();
  requirePullRequestHead({
    pullRequest: requireOwnershipPullRequestDraft({
      url,
      branch,
      ghText,
      expectedDraft: true,
    }),
    expectedHeadSha: deliveryHeadSha,
  });
  const pullNumber = pullRequestNumber(url);
  const reviewed = reviewReadyCloudAuthority({
    authority: lease.cloudAuthority,
    manifest: cloud.manifest,
    branch,
    headSha: deliveryHeadSha,
    pullRequestNumber: pullNumber,
    deviceId: lease.device,
    sessionId,
  });
  const title = gitText(["log", "-1", "--pretty=%s"]).trim();
  run("gh", ["pr", "edit", url, "--title", title]);
  run("gh", ["pr", "ready", url]);
  requireOwnershipPullRequestDraft({ url, branch, ghText, expectedDraft: false });
  const authorized = authorizeCloudDelivery({
    authority: reviewed.authority,
    manifest: cloud.manifest,
    branch,
    headSha: deliveryHeadSha,
    pullRequestNumber: pullNumber,
    deviceId: lease.device,
    sessionId,
  });
  verifyCloudAuthority({
    pullRequestUrl: url,
    branch,
    headSha: deliveryHeadSha,
    canonicalBaseSha: lease.cloudAuthority?.canonicalBaseSha || "",
    cloudAuthority: authorized.authority,
  });
  run("gh", ["pr", "edit", url, "--add-label", "automerge"]);
  run("gh", ["pr", "merge", "--auto", "--squash", url]);
  leaseStore.annotate({
    sessionId,
    branch,
    values: { deliveryHeadSha, cloudAuthority: authorized.authority },
  });
  const deliveredLease = leaseStore.release({ sessionId, branch, status: "delivery" });
  run("gh", ["pr", "edit", url, "--body", updateWriterLeasePullRequestBody(
    readRemotePullRequestBody({ url, ghText }),
    deliveredLease,
  )]);
  const trimmedUrl = url.trim();
  log(`Published ${trimmedUrl} with exact delivery authorization and protected auto-merge enabled.`);
  return trimmedUrl;
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
