import os from "node:os";
import path from "node:path";
import {
  assertNoCompetingPullRequests,
  assertNoUnmergedPaths,
  assertRegisteredWorktree,
} from "./repository-guards.mjs";
import {
  parseDeviceBranch,
  parseWriterLeasePullRequestBody,
  updateWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";
import { sanitizeDevice } from "./device-branch-identity.mjs";
import {
  readOwnershipPullRequest,
  requireOwnershipPullRequestDraft,
  waitForOwnershipPullRequestHead,
} from "./device-pull-request-state.mjs";
import {
  park,
  requireParkedStashObject,
  restoreParkedStashObject,
} from "./device-park-lib.mjs";
import {
  captureOwnedDirtEvidence,
  normalizeOwnedDirtRecovery,
  requireOwnedDirtInvocation,
  requireSameOwnedDirtEvidence,
  resolveOwnedDirtRecovery,
} from "./owned-dirt-resume-lib.mjs";
import {
  normalizePreClaimIntegrationContinuation,
  resolveExpiredCommittedContinuation,
  resolveSameSessionDeliveryContinuation,
} from "./expired-committed-continuation-lib.mjs";
import {
  protectedMainRefreshHeads,
  verifyProtectedMainRefreshChain,
} from "./protected-main-refresh-lib.mjs";

export { sanitize, sanitizeDevice, sanitizeScope } from "./device-branch-identity.mjs";
export { park, createParkMessage, formatParkTimestamp } from "./device-park-lib.mjs";
export { completeSession } from "./device-complete-lib.mjs";
const PARK_STASH_FIELDS = [
  "parkHeadSha", "parkBranchHeadSha", "parkSourceEpoch", "parkSourceFenceSha",
  "parkStashRef", "parkStashSha", "parkStashMessage", "parkStashStatus",
];
export { start } from "./device-start-lib.mjs";
export function heartbeat({
  invocationPath,
  repo,
  gitText,
  gitOptional,
  ghText,
  leaseStore,
  sessionId,
  leaseTtlMs,
  repairPullRequestProjection = false,
  run,
  log = console.log,
  now = () => new Date(),
}) {
  requireSession(sessionId);
  requireRepositorySafety({ invocationPath, repo, gitText });
  const branch = gitText(["branch", "--show-current"]).trim();
  let current = leaseStore.verify({ sessionId, branch });
  assertLeaseWorktree(current, repo);
  if (!repairPullRequestProjection) {
    requireRemoteFence({ branch, lease: current, gitOptional });
  }
  if (!current.pullRequestUrl || !current.fenceSha) {
    throw new Error("Writer lease is missing its draft pull request or fencing SHA.");
  }
  if (repairPullRequestProjection) {
    current = repairOwnershipPullRequestProjection({
      branch,
      lease: current,
      leaseStore,
      sessionId,
      gitText,
      gitOptional,
      ghText,
      run,
      now,
    });
  }
  const pullRequest = requireOwnershipPullRequestDraft({
    url: current.pullRequestUrl, branch, ghText, expectedDraft: true,
  });
  const lease = leaseStore.heartbeat({ sessionId, branch, ttlMs: leaseTtlMs });
  run("gh", ["pr", "edit", lease.pullRequestUrl, "--body", updateWriterLeasePullRequestBody(
    pullRequest.body,
    lease,
  )]);
  requireOwnershipPullRequestDraft({ url: lease.pullRequestUrl, branch, ghText, expectedDraft: true });
  log(`Renewed ${lease.scope} lease ${lease.epoch} until ${lease.expiresAt}.`);
  return lease;
}

export function repairOwnershipPullRequestProjection({
  branch,
  lease,
  leaseStore,
  sessionId,
  gitText,
  gitOptional,
  ghText,
  run,
  now = () => new Date(),
}) {
  const expectedHeadSha = gitText(["rev-parse", "HEAD"]).trim();
  requireProjectionRepairHead({ lease, expectedHeadSha, gitText });
  requireExactRemoteHead({ branch, expectedHeadSha, gitOptional });
  requireNoCompetingPullRequest({ branch, ghText });
  const dirtEvidence = gitText(["status", "--porcelain"]).trim()
    ? captureOwnedDirtEvidence({ gitText, gitOptional })
    : null;
  const existing = normalizePullRequestProjectionRepair(lease.pullRequestProjectionRepair);
  const sourceUrl = existing?.sourcePullRequestUrl || lease.pullRequestUrl;
  let source = readOwnershipPullRequest({
    url: sourceUrl,
    branch,
    ghText,
    requireOpen: false,
  });
  let repair = existing;
  if (!repair) {
    if (source.state !== "OPEN" || source.isDraft !== true) {
      throw new Error("Pull-request projection repair requires the exact open draft ownership pull request.");
    }
    if (source.headRefOid === expectedHeadSha) {
      throw new Error("Pull-request projection already matches the active writer fence.");
    }
    gitText(["merge-base", "--is-ancestor", source.headRefOid, expectedHeadSha]);
    repair = createPullRequestProjectionRepair({
      lease,
      sourceUrl,
      staleHeadSha: source.headRefOid,
      expectedHeadSha,
      dirtEvidence,
      now,
    });
    lease = leaseStore.annotate({
      sessionId,
      branch,
      values: { pullRequestProjectionRepair: repair },
    });
    run("gh", ["pr", "close", sourceUrl]);
    run("gh", ["pr", "reopen", sourceUrl]);
    source = readOwnershipPullRequest({
      url: sourceUrl,
      branch,
      ghText,
      requireOpen: false,
    });
  } else {
    requireMatchingPullRequestProjectionRepair({
      repair,
      lease,
      expectedHeadSha,
      dirtEvidence,
    });
  }

  let target = source;
  let targetUrl = sourceUrl;
  let outcome = "reopened";
  if (source.state !== "OPEN" || source.headRefOid !== expectedHeadSha) {
    if (source.state === "OPEN") run("gh", ["pr", "close", sourceUrl]);
    const candidates = JSON.parse(ghText([
      "pr", "list", "--state", "open", "--base", "main", "--head", branch,
      "--limit", "10", "--json", "url,headRefName,headRefOid,isDraft",
    ]));
    if (candidates.length > 1) {
      throw new Error("Pull-request projection repair found multiple replacement candidates.");
    }
    if (candidates.length === 1) {
      targetUrl = candidates[0].url;
    } else {
      targetUrl = String(ghText([
        "pr", "create", "--draft", "--base", "main", "--head", branch,
        "--title", gitText(["log", "-1", "--pretty=%s"]).trim(),
        "--body", updateWriterLeasePullRequestBody("", lease),
      ])).trim().split(/\r?\n/).filter(Boolean).at(-1) || "";
    }
    if (!targetUrl || targetUrl === sourceUrl) {
      throw new Error("Pull-request projection repair did not create a distinct replacement pull request.");
    }
    target = requireOwnershipPullRequestDraft({
      url: targetUrl,
      branch,
      ghText,
      expectedDraft: true,
    });
    outcome = "replaced";
  }
  if (target.state !== "OPEN" || target.isDraft !== true || target.headRefOid !== expectedHeadSha) {
    throw new Error("Pull-request projection repair could not prove an exact open draft replacement.");
  }
  verifyPullRequestRepositoryIdentity({ pullRequest: target, url: targetUrl });
  requireSameRepairDirt({ repair, dirtEvidence });
  const completedRepair = finalizePullRequestProjectionRepair({
    repair,
    targetPullRequestUrl: targetUrl,
    outcome,
    now,
  });
  const repairedLease = leaseStore.annotate({
    sessionId,
    branch,
    values: {
      pullRequestUrl: targetUrl,
      pullRequestProjectionRepair: completedRepair,
    },
  });
  run("gh", ["pr", "edit", targetUrl, "--body", updateWriterLeasePullRequestBody(
    target.body,
    repairedLease,
  )]);
  const verified = requireOwnershipPullRequestDraft({
    url: targetUrl,
    branch,
    ghText,
    expectedDraft: true,
  });
  if (verified.headRefOid !== expectedHeadSha) {
    throw new Error("Pull-request projection changed after its repaired lease marker was published.");
  }
  requireSameRepairDirt({ repair: completedRepair, dirtEvidence: gitText(["status", "--porcelain"]).trim()
    ? captureOwnedDirtEvidence({ gitText, gitOptional })
    : null });
  return repairedLease;
}
export function resume({
  branchName,
  invocationPath,
  repo,
  gitText,
  gitOptional,
  ghText,
  leaseStore,
  sessionId,
  leaseTtlMs,
  recoverOwnedDirt = false,
  run,
  log = console.log,
  now = () => new Date(),
}) {
  requireSession(sessionId);
  const identity = parseDeviceBranch(branchName);
  if (!identity) throw new Error("Resume requires the exact agent/<device>/<semantic-scope> handoff branch.");
  requireRepositorySafety({ invocationPath, repo, gitText });
  const currentBranch = gitText(["branch", "--show-current"]).trim();
  const localAtInvocation = leaseStore.read?.(branchName) || null;
  const dirty = Boolean(gitText(["status", "--porcelain"]).trim());
  const dirtyRestoreReplay = currentBranch === branchName && localAtInvocation?.status === "active" &&
    localAtInvocation.sessionId === sessionId && ["pending", "restored"].includes(localAtInvocation.parkStashStatus);
  if (recoverOwnedDirt && !dirty) {
    throw new Error("--recover-owned-dirt requires an existing dirty worktree.");
  }
  const ownedDirtEvidence = recoverOwnedDirt
    ? captureOwnedDirtEvidence({ gitText, gitOptional })
    : null;
  if (ownedDirtEvidence) {
    requireOwnedDirtInvocation({
      branch: branchName,
      currentBranch,
      evidence: ownedDirtEvidence,
      localLease: localAtInvocation,
      repo,
      sessionId,
    });
  }
  if (dirty && !dirtyRestoreReplay && !ownedDirtEvidence) requireClean({ gitText });
  run("git", ["fetch", "origin", "main", branchName]);

  const pulls = JSON.parse(ghText([
    "pr",
    "list",
    "--state",
    "open",
    "--base",
    "main",
    "--limit",
    "100",
    "--json",
    "number,headRefName,url,body",
  ]));
  const owner = assertNoCompetingPullRequests(pulls, branchName);
  if (!owner?.url) throw new Error(`No draft ownership pull request exists for ${branchName}.`);
  const pullRequest = readOwnershipPullRequest({ url: owner.url, branch: branchName, ghText });
  const remoteLease = parseWriterLeasePullRequestBody(pullRequest.body);
  if (!remoteLease || remoteLease.branch !== branchName) {
    throw new Error(`Pull request ${owner.url} has no matching writer-lease metadata.`);
  }
  const remoteRef = `origin/${branchName}`;
  const remoteSha = gitText(["rev-parse", remoteRef]).trim();
  const ownedDirtRecovery = ownedDirtEvidence
    ? resolveOwnedDirtRecovery({
      branch: branchName,
      evidence: ownedDirtEvidence,
      localHeadSha: gitText(["rev-parse", "HEAD"]).trim(),
      localLease: localAtInvocation,
      ownerUrl: owner.url,
      pullRequestHeadSha: pullRequest.headRefOid,
      remoteLease,
      remoteSha,
      repo,
      sessionId,
    })
    : null;
  const verifyOwnedDirt = () => {
    if (!ownedDirtRecovery) return;
    requireSameOwnedDirtEvidence(
      ownedDirtRecovery,
      captureOwnedDirtEvidence({ gitText, gitOptional }),
    );
  };
  const sameSessionDelivery = remoteLease.status === "delivery" &&
    remoteLease.sessionId === sessionId;
  if (
    sameSessionDelivery &&
    !/^[0-9a-f]{40}$/.test(String(remoteLease.deliveryHeadSha || ""))
  ) {
    throw new Error("Delivery revision requires an exact deliveryHeadSha.");
  }
  const deliveryHandoffHead = sameSessionDelivery
    ? resolveSameSessionDeliveryHandoff({
      remoteLease,
      remoteSha,
      remoteRef,
      gitText,
      localHeadSha: currentBranch === branchName
        ? gitText(["rev-parse", "HEAD"]).trim()
        : null,
      run: currentBranch === branchName ? run : null,
    })
    : null;
  const deliveryContinuation = sameSessionDelivery
    ? resolveSameSessionDeliveryContinuation({
      branch: branchName,
      currentBranch,
      identity,
      localLease: localAtInvocation,
      remoteLease,
      remoteSha,
      deliveryHandoffHead,
      pullRequestHeadSha: pullRequest.headRefOid,
      ownerUrl: owner.url,
      repo,
      sessionId,
      gitText,
      now,
    })
    : null;
  const committedContinuation = resolveExpiredCommittedContinuation({
    branch: branchName,
    currentBranch,
    identity,
    localLease: localAtInvocation,
    remoteLease,
    remoteSha,
    pullRequestHeadSha: pullRequest.headRefOid,
    ownerUrl: owner.url,
    repo,
    sessionId,
    gitText,
    now,
  });
  if (deliveryContinuation && committedContinuation) {
    throw new Error("Resume found competing delivery and expired committed continuations.");
  }
  const integrationContinuation =
    deliveryContinuation || committedContinuation;
  const replay = reconcileResumeReplay({
    branch: branchName, identity, currentBranch, repo, sessionId, remoteLease, remoteSha, owner,
    pullRequest, leaseStore, leaseTtlMs, gitText, gitOptional, ghText, run, log, now, verifyOwnedDirt,
    integrationContinuation, ownedDirtRecovery,
  });
  if (replay) {
    verifyOwnedDirt();
    return replay;
  }
  const expired = Date.parse(remoteLease.expiresAt) <= now().getTime();
  const reviewHandoff = remoteLease.status === "review_ready";
  if (reviewHandoff && !/^[0-9a-f]{40}$/.test(String(remoteLease.reviewHeadSha || ""))) throw new Error("Reviewed handoff requires an exact reviewHeadSha.");
  if (remoteLease.status !== "parked" && !(remoteLease.status === "active" && expired) && !sameSessionDelivery && !reviewHandoff) {
    throw new Error(
      `Semantic scope ${identity.scope} remains ${remoteLease.status} under another session until ${remoteLease.expiresAt}.`,
    );
  }
  const parkedStashValues = remoteLease.status === "parked"
    ? requireExactParkedStashHandoff({ remoteLease, localLease: localAtInvocation, owner, repo, sessionId, gitText, gitOptional })
    : null;
  const parkedResumeHead = remoteLease.status === "parked" ? requireParkedResumeHead(remoteLease) : null;

  if (remoteLease.fenceSha) run("git", ["merge-base", "--is-ancestor", remoteLease.fenceSha, remoteRef]);
  let claimBaseSha = remoteSha;
  if (currentBranch) {
    if (currentBranch !== branchName || (!reviewHandoff && !sameSessionDelivery && !integrationContinuation)) {
      throw new Error("Attached resume is allowed only for the exact reviewed handoff or same-session delivery revision.");
    }
    const localSha = gitText(["rev-parse", "HEAD"]).trim();
    if (integrationContinuation) {
      if (localSha !== integrationContinuation.headSha) {
        throw new Error("Interrupted integration continuation changed after its exact recovery proof.");
      }
      claimBaseSha = localSha;
    } else {
      const handoffHead = reviewHandoff ? remoteLease.reviewHeadSha : deliveryHandoffHead;
      if (localSha !== remoteSha || localSha !== handoffHead) {
        throw new Error("Attached handoff HEAD does not match its exact remote handoff evidence.");
      }
    }
  } else if (gitOptional(["show-ref", "--verify", `refs/heads/${branchName}`])) {
    run("git", ["switch", branchName]);
    run("git", ["merge", "--ff-only", remoteRef]);
    const localSha = gitText(["rev-parse", "HEAD"]).trim();
    if (localSha !== remoteSha) {
      const localLease = leaseStore.read(branchName);
      const localParkedContinuation = remoteLease.status === "parked" && remoteLease.sessionId === sessionId &&
        localLease?.status === "parked" && localLease.sessionId === sessionId && localLease.branch === branchName &&
        localLease.epoch === remoteLease.epoch && localLease.fenceSha === remoteLease.fenceSha &&
        localLease.baseSha === remoteLease.baseSha && localLease.pullRequestUrl === owner.url &&
        localLease.parkBranchHeadSha === remoteLease.parkBranchHeadSha && localSha === remoteLease.parkBranchHeadSha &&
        localLease.worktreePath && path.resolve(localLease.worktreePath) === path.resolve(repo);
      if (!localParkedContinuation) throw new Error(`Local ${branchName} is not the exact same-session parked continuation of ${remoteSha.slice(0, 12)}.`);
      run("git", ["merge-base", "--is-ancestor", remoteRef, "HEAD"]);
      run("git", ["merge-base", "--is-ancestor", remoteLease.fenceSha, "HEAD"]);
      claimBaseSha = localSha;
    }
  } else {
    run("git", ["switch", "--create", branchName, "--track", remoteRef]);
  }
  if (remoteLease.status === "parked" && claimBaseSha !== parkedResumeHead) {
    throw new Error("Parked resume HEAD does not match its exact pre-claim branch head.");
  }

  if (!pullRequest.isDraft) {
    if (!reviewHandoff && !sameSessionDelivery && !integrationContinuation) {
      throw new Error(`Ownership pull request ${owner.url} must be draft before resume.`);
    }
    run("gh", ["pr", "ready", "--undo", owner.url]);
  }
  const draftPullRequest = requireOwnershipPullRequestDraft({
    url: owner.url, branch: branchName, ghText, expectedDraft: true,
  });

  const device = sanitizeDevice(gitOptional(["config", "--get", "agentic.device"]) || os.hostname());
  const claimed = leaseStore.claim({
    sessionId,
    device,
    scope: identity.scope,
    branch: branchName,
    worktreePath: repo,
    baseSha: claimBaseSha,
    autoDelivery: remoteLease.autoDelivery === true && remoteLease.runtimeRequired === true,
    ...(ownedDirtRecovery ? { ownedDirtRecovery } : {}),
    ...(integrationContinuation ? {
      integration: integrationContinuation.integration,
      preClaimIntegrationContinuation:
        integrationContinuation.preClaimIntegrationContinuation,
    } : {}),
    previousEpoch: remoteLease.epoch,
    ttlMs: leaseTtlMs,
  });
  run("git", [
    "commit",
    "--allow-empty",
    ...(ownedDirtRecovery ? ["--only"] : []),
    "-m",
    resumeClaimSubject(identity.scope, claimed.epoch),
  ]);
  const fenceSha = gitText(["rev-parse", "HEAD"]).trim();
  if (ownedDirtRecovery) {
    requireResumeClaimCommit({ lease: claimed, headSha: fenceSha, gitText });
    verifyOwnedDirt();
  }
  const lease = leaseStore.annotate({
    sessionId,
    branch: branchName,
    values: {
      fenceSha,
      pullRequestUrl: owner.url,
      ...(integrationContinuation ? { integration: integrationContinuation.integration } : {}),
      ...(integrationContinuation ? {
        preClaimIntegrationContinuation:
          integrationContinuation.preClaimIntegrationContinuation,
      } : {}),
      ...(parkedStashValues || {}),
    },
  });
  verifyOwnedDirt();
  try {
    pushResumeClaim({ branch: branchName, ownedDirtRecovery, run });
  } catch (error) {
    gitOptional(["ls-remote", "--heads", "origin", `refs/heads/${branchName}`]);
    throw error;
  }
  verifyOwnedDirt();
  run("gh", ["pr", "edit", owner.url, "--body", updateWriterLeasePullRequestBody(draftPullRequest.body, lease)]);
  requireOwnershipPullRequestDraft({ url: owner.url, branch: branchName, ghText, expectedDraft: true });
  const restoredLease = completeParkedStashRestore({
    branch: branchName, lease, owner, leaseStore, sessionId, gitText, gitOptional, ghText, run,
  });
  verifyOwnedDirt();
  log(
    `Resumed ${branchName} at epoch ${restoredLease.epoch} with fence ${fenceSha.slice(0, 12)}; prior writers are fenced by the fast-forward remote head.`,
  );
  return restoredLease;
}

export function resolveSameSessionDeliveryHandoff({
  remoteLease,
  remoteSha,
  remoteRef,
  gitText,
  localHeadSha = null,
  run = null,
}) {
  const deliveryHeadSha = String(remoteLease?.deliveryHeadSha || "");
  const refresh = remoteSha === deliveryHeadSha
    ? null
    : verifyProtectedMainRefreshChain({
      expectedHeadSha: deliveryHeadSha,
      observedHeadSha: remoteSha,
      gitText,
    });
  if (localHeadSha !== null) {
    const exactHeads = refresh
      ? protectedMainRefreshHeads(refresh)
      : [deliveryHeadSha];
    if (!exactHeads.includes(localHeadSha)) {
      throw new Error(
        "Delivered branch local HEAD is not an exact member of its protected-main refresh chain.",
      );
    }
    if (localHeadSha !== remoteSha) {
      if (!run) {
        throw new Error("Delivered branch refresh catch-up requires its repository runner.");
      }
      run("git", ["merge", "--ff-only", remoteRef]);
      if (
        gitText(["rev-parse", "HEAD"]).trim() !== remoteSha ||
        gitText(["status", "--porcelain"]).trim()
      ) {
        throw new Error(
          "Delivered branch refresh catch-up did not leave the exact clean remote handoff.",
        );
      }
    }
  }
  return remoteSha;
}

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
    requireReviewReplay({ branch, lease: existing, gitText, gitOptional, ghText, ghOptional, run });
    log(`Review is already ready at ${existing.pullRequestUrl}.`);
    return existing.pullRequestUrl;
  }
  const lease = leaseStore.verify({ sessionId, branch });
  assertLeaseWorktree(lease, repo);
  if (!lease.pullRequestUrl || !lease.fenceSha) {
    throw new Error("Review requires the draft ownership pull request and fencing SHA created by device:start.");
  }
  run("git", ["merge-base", "--is-ancestor", lease.fenceSha, "HEAD"]);
  requireNoCompetingPullRequest({ branch, ghText });
  run("npm", ["run", "check"]);
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
  if (pullRequest.isDraft) run("gh", ["pr", "ready", url]);
  const readyPullRequest = requireOwnershipPullRequestDraft({ url, branch, ghText, expectedDraft: false });
  requirePullRequestHead({ pullRequest: readyPullRequest, expectedHeadSha: reviewHeadSha });
  const title = gitText(["log", "-1", "--pretty=%s"]).trim();
  leaseStore.annotate({ sessionId, branch, values: { reviewHeadSha } });
  const readyLease = leaseStore.release({ sessionId, branch, status: "review_ready" });
  run("gh", ["pr", "edit", url, "--title", title, "--body", updateWriterLeasePullRequestBody(
    readyPullRequest.body,
    readyLease,
  )]);
  requireOwnershipPullRequestDraft({ url, branch, ghText, expectedDraft: false });
  if (readyLease.autoDelivery === true && readyLease.runtimeRequired === true) {
    run("gh", ["pr", "edit", url, "--add-label", "agentic/auto-delivery"]);
    log(`Marked ${url} ready for review; the authorized auto-delivery controller may enable protected merge for this exact reviewed SHA.`);
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
  const title = gitText(["log", "-1", "--pretty=%s"]).trim();
  run("gh", ["pr", "edit", url, "--title", title, "--add-label", "automerge"]);
  run("gh", ["pr", "ready", url]);
  requireOwnershipPullRequestDraft({ url, branch, ghText, expectedDraft: false });
  run("gh", ["pr", "merge", "--auto", "--squash", url]);
  leaseStore.annotate({ sessionId, branch, values: { deliveryHeadSha } });
  const deliveredLease = leaseStore.release({ sessionId, branch, status: "delivery" });
  run("gh", ["pr", "edit", url, "--body", updateWriterLeasePullRequestBody(
    readRemotePullRequestBody({ url, ghText }),
    deliveredLease,
  )]);
  const trimmedUrl = url.trim();
  log(`Published ${trimmedUrl} with protected auto-merge enabled.`);
  return trimmedUrl;
}

function reconcileResumeReplay({
  branch, identity, currentBranch, repo, sessionId, remoteLease, remoteSha, owner,
  pullRequest, leaseStore, leaseTtlMs, gitText, gitOptional, ghText, run, log, now,
  verifyOwnedDirt = () => {},
  integrationContinuation = null,
  ownedDirtRecovery = null,
}) {
  let local = leaseStore.read?.(branch) || null;
  if (!local || local.status !== "active" || local.sessionId !== sessionId || currentBranch !== branch ||
      local.branch !== branch || local.device !== identity.device || local.scope !== identity.scope ||
      !local.worktreePath || path.resolve(local.worktreePath) !== path.resolve(repo)) return null;
  const markerFields = ["schema", "status", "epoch", "sessionId", "device", "scope", "branch", "baseSha", "fenceSha", "heartbeatAt", "expiresAt"];
  const activeReplay = remoteLease.status === "active" &&
    markerFields.every(field => remoteLease[field] === local[field]) &&
    sameRemoteContinuationEvidence(remoteLease, local);
  const pendingStashRestoreReplay = activeReplay && local.parkStashStatus === "pending" &&
    PARK_STASH_FIELDS.every(field => remoteLease[field] === local[field]);
  const expiredActiveHandoff = remoteLease.status === "active" && Date.parse(remoteLease.expiresAt) <= now().getTime();
  const handoffHead = remoteLease.status === "review_ready" ? remoteLease.reviewHeadSha :
    remoteLease.status === "delivery" && remoteLease.sessionId === sessionId ? remoteLease.deliveryHeadSha :
    remoteLease.status === "parked" ? requireParkedResumeHead(remoteLease) :
    expiredActiveHandoff ? remoteLease.fenceSha : null;
  const recordedOwnedDirt = ownedDirtRecovery
    ? normalizeOwnedDirtRecovery(local.ownedDirtRecovery)
    : null;
  const ownedDirtPendingHandoff = recordedOwnedDirt &&
    sameOwnedDirtRecovery(recordedOwnedDirt, ownedDirtRecovery) &&
    remoteLease.status === "review_ready" &&
    recordedOwnedDirt.sourceEpoch === remoteLease.epoch &&
    recordedOwnedDirt.sourceSessionId === remoteLease.sessionId &&
    recordedOwnedDirt.sourceSessionId === local.sessionId &&
    recordedOwnedDirt.reviewHeadSha === remoteLease.reviewHeadSha &&
    local.epoch > recordedOwnedDirt.sourceEpoch;
  const ordinaryPendingHandoff = /^[0-9a-f]{40}$/.test(String(handoffHead || "")) &&
    local.baseSha === handoffHead &&
    (ownedDirtRecovery
      ? ownedDirtPendingHandoff
      : local.epoch === remoteLease.epoch + 1);
  const continuationSource =
    integrationContinuation?.preClaimIntegrationContinuation || null;
  const recordedContinuation = continuationSource
    ? normalizePreClaimIntegrationContinuation(
      local.preClaimIntegrationContinuation,
    )
    : null;
  const committedPendingHandoff = integrationContinuation?.pendingClaim === true &&
    samePreClaimContinuation(recordedContinuation, continuationSource) &&
    local.baseSha === integrationContinuation.headSha &&
    local.integration?.commitSha === continuationSource.integrationCommitSha &&
    local.integration?.treeSha === continuationSource.integrationTreeSha &&
    continuationSource?.sourceEpoch === remoteLease.epoch &&
    continuationSource?.sourceSessionId === remoteLease.sessionId &&
    continuationSource?.sourceSessionId === local.sessionId &&
    local.epoch > continuationSource.sourceEpoch;
  const pendingHandoff = ordinaryPendingHandoff || committedPendingHandoff;
  if (!activeReplay && !pendingHandoff) return null;
  const expired = Date.parse(local.expiresAt) <= now().getTime();
  if (expired && !pendingHandoff && !pendingStashRestoreReplay) return null;
  if (!pullRequest.isDraft) throw new Error(`Ownership pull request ${owner.url} must be draft before active resume replay.`);
  const parkedStashValues = remoteLease.status === "parked"
    ? requireReplayParkedStash({ remoteLease, local, owner, repo, sessionId, gitText, gitOptional })
    : null;
  let headSha = gitText(["rev-parse", "HEAD"]).trim();
  if (activeReplay && (local.pullRequestUrl !== owner.url || local.fenceSha !== remoteSha || headSha !== remoteSha)) return null;
  if (pendingHandoff) {
    const pushBase = remoteLease.status === "parked"
      ? remoteLease.parkSourceFenceSha
      : committedPendingHandoff
        ? continuationSourceRemoteHead(
          integrationContinuation.preClaimIntegrationContinuation,
        )
        : handoffHead;
    const preClaimHead = committedPendingHandoff ? integrationContinuation.headSha : handoffHead;
    const atHandoffHead = headSha === preClaimHead;
    if (atHandoffHead) {
      if (local.fenceSha || local.pullRequestUrl || hasCarriedParkedStash(local)) {
        throw new Error("Uncommitted resume claim has unexpected fence, pull-request, or parked-stash evidence.");
      }
    } else {
      requireResumeClaimCommit({ lease: local, headSha, gitText });
      requirePendingClaimAnnotation({ local, headSha, owner, parkedStashValues });
    }
    if (expired) {
      const recoverableRemote = remoteSha === pushBase ||
        (/^[0-9a-f]{40}$/.test(String(local.fenceSha || "")) && remoteSha === local.fenceSha);
      if (!recoverableRemote) {
        throw new Error("Expired resume claim lost its exact remote handoff or fence.");
      }
      local = leaseStore.heartbeat({ sessionId, branch, ttlMs: leaseTtlMs });
      if (local.fenceSha) requireCarriedParkedStash({ local, expected: parkedStashValues });
    }
    if (atHandoffHead) {
      run("git", [
        "commit",
        "--allow-empty",
        ...(local.ownedDirtRecovery ? ["--only"] : []),
        "-m",
        resumeClaimSubject(identity.scope, local.epoch),
      ]);
      headSha = gitText(["rev-parse", "HEAD"]).trim();
      verifyOwnedDirt();
    }
    requireResumeClaimCommit({ lease: local, headSha, gitText });
    if (!local.fenceSha && local.pullRequestUrl) {
      throw new Error("Resume claim has partial pull-request annotation without its exact fence.");
    }
    if (!local.fenceSha) {
      local = leaseStore.annotate({
        sessionId, branch, values: { fenceSha: headSha, pullRequestUrl: owner.url, ...(parkedStashValues || {}) },
      });
    } else if (local.fenceSha !== headSha || local.pullRequestUrl !== owner.url) {
      throw new Error("Resume claim annotation does not match its exact local claim commit and pull request.");
    }
    requireCarriedParkedStash({ local, expected: parkedStashValues });
    if (remoteSha === pushBase) {
      if (remoteLease.status === "parked") run("git", ["merge-base", "--is-ancestor", pushBase, handoffHead]);
      verifyOwnedDirt();
      pushResumeClaim({ branch, ownedDirtRecovery: local.ownedDirtRecovery, run });
      verifyOwnedDirt();
    }
    else if (remoteSha !== headSha) throw new Error("Resume claim remote is neither the handed-off head nor the exact claim commit.");
    const observedRemote = gitOptional(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]).split(/\s+/)[0] || "";
    if (observedRemote !== headSha) throw new Error("Resume claim push did not establish its exact remote fence.");
  }
  if (expired && pendingStashRestoreReplay) {
    local = leaseStore.heartbeat({ sessionId, branch, ttlMs: leaseTtlMs });
  }
  run("git", ["merge-base", "--is-ancestor", local.baseSha, local.fenceSha]);
  run("git", ["merge-base", "--is-ancestor", remoteLease.fenceSha, local.fenceSha]);
  const verified = leaseStore.verify({ sessionId, branch });
  assertLeaseWorktree(verified, repo);
  if (pendingHandoff) {
    run("gh", ["pr", "edit", owner.url, "--body", updateWriterLeasePullRequestBody(pullRequest.body, verified)]);
    requireOwnershipPullRequestDraft({ url: owner.url, branch, ghText, expectedDraft: true });
  }
  const restored = completeParkedStashRestore({
    branch, lease: verified, owner, leaseStore, sessionId, gitText, gitOptional, ghText, run,
  });
  log(`Resume is already active for ${branch} at fence ${local.fenceSha.slice(0, 12)}.`);
  return restored;
}

function continuationSourceRemoteHead(continuation) {
  return continuation.sourceStatus === "delivery"
    ? continuation.headSha
    : continuation.sourceFenceSha;
}

function sameRemoteContinuationEvidence(remoteLease, localLease) {
  const remote = normalizePreClaimIntegrationContinuation(
    remoteLease.preClaimIntegrationContinuation,
  );
  const local = normalizePreClaimIntegrationContinuation(
    localLease.preClaimIntegrationContinuation,
  );
  if (!remote && !local) return true;
  if (!remote || !local || !samePreClaimContinuation(remote, local)) return false;
  return JSON.stringify(remoteLease.integration) ===
    JSON.stringify(localLease.integration);
}

function sameOwnedDirtRecovery(left, right) {
  return left.schema === right.schema &&
    left.sourceEpoch === right.sourceEpoch &&
    left.sourceSessionId === right.sourceSessionId &&
    left.reviewHeadSha === right.reviewHeadSha &&
    left.evidenceDigest === right.evidenceDigest &&
    left.pathCount === right.pathCount;
}

function samePreClaimContinuation(left, right) {
  if (!left || !right) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

function requireParkedResumeHead(lease) {
  if (!/^[0-9a-f]{40}$/.test(String(lease.parkBranchHeadSha || "")) ||
      lease.parkSourceEpoch !== lease.epoch || lease.parkSourceFenceSha !== lease.fenceSha) {
    throw new Error("Parked resume lacks its exact pre-claim head, source epoch, or source fence.");
  }
  return lease.parkBranchHeadSha;
}

function requireExactParkedStashHandoff({ remoteLease, localLease, owner, repo, sessionId, gitText, gitOptional }) {
  const anyEvidence = PARK_STASH_FIELDS.slice(4).some(field => remoteLease[field] !== null && remoteLease[field] !== undefined);
  if (!anyEvidence) return null;
  if (remoteLease.sessionId !== sessionId || localLease?.status !== "parked" || localLease.sessionId !== sessionId ||
      localLease.pullRequestUrl !== owner.url || !localLease.worktreePath ||
      path.resolve(localLease.worktreePath) !== path.resolve(repo)) {
    throw new Error("A dirty parked handoff can resume only in its exact same-session worktree and pull request.");
  }
  for (const field of ["schema", "status", "epoch", "sessionId", "device", "scope", "branch", "baseSha", "fenceSha", ...PARK_STASH_FIELDS]) {
    if (localLease[field] !== remoteLease[field]) throw new Error(`Dirty parked handoff disagrees on ${field}.`);
  }
  requireParkedStashObject({ lease: remoteLease, gitText, gitOptional });
  return carriedParkedStash(remoteLease);
}

function requireReplayParkedStash({ remoteLease, local, owner, repo, sessionId, gitText, gitOptional }) {
  const expected = requireExactParkedStashHandoff({
    remoteLease,
    localLease: { ...remoteLease, pullRequestUrl: owner.url, worktreePath: repo },
    owner, repo, sessionId, gitText, gitOptional,
  });
  if (!expected) return null;
  if (local.sessionId !== sessionId || !local.worktreePath || path.resolve(local.worktreePath) !== path.resolve(repo)) {
    throw new Error("Partial dirty-park resume belongs to another session or worktree.");
  }
  return expected;
}

function carriedParkedStash(lease) {
  return Object.fromEntries(PARK_STASH_FIELDS.map(field => [field, lease[field] ?? null]));
}

function requireCarriedParkedStash({ local, expected }) {
  if (!expected) {
    if (hasCarriedParkedStash(local)) throw new Error("Resume claim carries parked-stash evidence absent from its handoff.");
    return;
  }
  for (const field of PARK_STASH_FIELDS) {
    if (local[field] !== expected[field]) throw new Error(`Partial resume lost parked stash evidence ${field}.`);
  }
}

function hasCarriedParkedStash(lease) {
  return PARK_STASH_FIELDS.some(field => lease?.[field] !== null && lease?.[field] !== undefined);
}

function requirePendingClaimAnnotation({ local, headSha, owner, parkedStashValues }) {
  if (!local.fenceSha) {
    if (local.pullRequestUrl || hasCarriedParkedStash(local)) {
      throw new Error("Resume claim has partial annotation before its exact fence.");
    }
    return;
  }
  if (local.fenceSha !== headSha || local.pullRequestUrl !== owner.url) {
    throw new Error("Resume claim annotation does not match its exact local claim commit and pull request.");
  }
  requireCarriedParkedStash({ local, expected: parkedStashValues });
}

function completeParkedStashRestore({ branch, lease, owner, leaseStore, sessionId, gitText, gitOptional, ghText, run }) {
  if (!lease.parkStashSha) return lease;
  if (!["pending", "restored"].includes(lease.parkStashStatus)) {
    throw new Error("Active parked-stash restoration has no exact pending or restored status.");
  }
  restoreParkedStashObject({ lease, repo: lease.worktreePath, gitText, gitOptional, run });
  let restored = lease;
  if (lease.parkStashStatus === "pending") {
    restored = leaseStore.annotate({ sessionId, branch, values: { parkStashStatus: "restored" } });
  }
  const pullRequest = requireOwnershipPullRequestDraft({ url: owner.url, branch, ghText, expectedDraft: true });
  const marker = parseWriterLeasePullRequestBody(pullRequest.body);
  const synchronized = marker?.status === restored.status && marker.epoch === restored.epoch &&
    PARK_STASH_FIELDS.every(field => marker[field] === restored[field]);
  if (!synchronized) {
    run("gh", ["pr", "edit", owner.url, "--body", updateWriterLeasePullRequestBody(pullRequest.body, restored)]);
  }
  requireOwnershipPullRequestDraft({ url: owner.url, branch, ghText, expectedDraft: true });
  return restored;
}

function requireResumeClaimCommit({ lease, headSha, gitText }) {
  const parents = gitText(["rev-list", "--parents", "-n", "1", "HEAD"]).trim().split(/\s+/);
  if (parents.length !== 2 || parents[0] !== headSha || parents[1] !== lease.baseSha) {
    throw new Error("Resume recovery requires the exact single-parent claim commit.");
  }
  if (gitText(["log", "-1", "--pretty=%s"]).trim() !== resumeClaimSubject(lease.scope, lease.epoch)) {
    throw new Error("Resume recovery claim subject does not match its lease epoch.");
  }
  if (gitText(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]).trim()) {
    throw new Error("Resume recovery claim commit must not change the source tree.");
  }
}

function resumeClaimSubject(scope, epoch) {
  return `chore(coordination): claim ${scope} lease ${epoch}`;
}

function pushResumeClaim({ branch, ownedDirtRecovery, run }) {
  run("git", [
    "push",
    ...(ownedDirtRecovery ? ["--no-verify"] : []),
    "origin",
    branch,
  ]);
}

function requireRepositorySafety({ invocationPath, repo, gitText }) {
  if (path.resolve(invocationPath) !== path.resolve(repo)) {
    throw new Error(`Repository commands must start at the registered worktree root ${repo}; received ${invocationPath}`);
  }
  const worktree = assertRegisteredWorktree({
    cwd: repo,
    porcelain: gitText(["worktree", "list", "--porcelain", "-z"]),
  });
  assertNoUnmergedPaths({
    conflictPaths: gitText(["diff", "--name-only", "--diff-filter=U"]),
    indexEntries: gitText(["ls-files", "-u"]),
  });
  return worktree;
}

function assertLeaseWorktree(lease, repo) {
  if (path.resolve(lease.worktreePath) !== path.resolve(repo)) {
    throw new Error(`Writer lease owns worktree ${lease.worktreePath}, not ${repo}.`);
  }
}

function requireRemoteFence({ branch, lease, gitOptional }) {
  const remoteLine = gitOptional(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]);
  const remoteSha = remoteLine.split(/\s+/)[0] || "";
  if (!lease.fenceSha || remoteSha !== lease.fenceSha) throw new Error(
    `Remote fence for ${branch} is ${remoteSha || "missing"}, not ${lease.fenceSha || "unclaimed"}; this session is stale.`,
  );
}

function requireExactRemoteHead({ branch, expectedHeadSha, gitOptional }) {
  const remoteLine = gitOptional(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]);
  const remoteSha = remoteLine.split(/\s+/)[0] || "";
  if (!SHA_PATTERN.test(String(expectedHeadSha || "")) || remoteSha !== expectedHeadSha) {
    throw new Error(
      `Remote head for ${branch} is ${remoteSha || "missing"}, not ${expectedHeadSha || "unknown"}.`,
    );
  }
}

function requireProjectionRepairHead({ lease, expectedHeadSha, gitText }) {
  if (expectedHeadSha === lease.fenceSha) return;
  const integrationHead = lease.integration?.commitSha;
  if (!SHA_PATTERN.test(String(integrationHead || ""))) {
    throw new Error("Pull-request projection repair requires the active fence or recorded integration head.");
  }
  gitText(["merge-base", "--is-ancestor", lease.fenceSha, integrationHead]);
  if (expectedHeadSha === integrationHead) return;
  verifyProtectedMainRefreshChain({
    expectedHeadSha: integrationHead,
    observedHeadSha: expectedHeadSha,
    gitText,
  });
}

function requireNoCompetingPullRequest({ branch, ghText }) {
  const pulls = JSON.parse(ghText(["pr", "list", "--state", "open", "--base", "main", "--limit", "100", "--json", "number,headRefName,url"]));
  assertNoCompetingPullRequests(pulls, branch);
}

function requireTaskBranch(branch, action) {
  if (!branch || branch === "main") throw new Error(`${action} from an agent/<device>/<scope> branch, never main.`);
  if (!branch.startsWith("agent/")) throw new Error(`Refusing unexpected device branch: ${branch}`);
  return branch;
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

const PULL_REQUEST_PROJECTION_REPAIR_SCHEMA = "agentic-pull-request-projection-repair/v1";
const SHA_PATTERN = /^[0-9a-f]{40}$/;

function createPullRequestProjectionRepair({
  lease,
  sourceUrl,
  staleHeadSha,
  expectedHeadSha,
  dirtEvidence,
  now,
}) {
  if (!SHA_PATTERN.test(String(staleHeadSha || "")) ||
      !SHA_PATTERN.test(String(expectedHeadSha || ""))) {
    throw new Error("Pull-request projection repair requires exact stale and expected head SHAs.");
  }
  return {
    schema: PULL_REQUEST_PROJECTION_REPAIR_SCHEMA,
    status: "repairing",
    sourceEpoch: lease.epoch,
    sourcePullRequestUrl: sourceUrl,
    staleHeadSha,
    expectedHeadSha,
    dirtEvidenceDigest: dirtEvidence?.digest || null,
    dirtPathCount: dirtEvidence?.pathCount || 0,
    targetPullRequestUrl: null,
    outcome: null,
    startedAt: now().toISOString(),
    completedAt: null,
  };
}

function normalizePullRequestProjectionRepair(value) {
  if (value === null || value === undefined) return null;
  if (
    value?.schema !== PULL_REQUEST_PROJECTION_REPAIR_SCHEMA ||
    !["repairing", "completed"].includes(value.status) ||
    !Number.isInteger(value.sourceEpoch) ||
    value.sourceEpoch < 1 ||
    !String(value.sourcePullRequestUrl || "").includes("/pull/") ||
    !SHA_PATTERN.test(String(value.staleHeadSha || "")) ||
    !SHA_PATTERN.test(String(value.expectedHeadSha || "")) ||
    !Number.isInteger(value.dirtPathCount) ||
    value.dirtPathCount < 0 ||
    (value.dirtPathCount === 0) !== (value.dirtEvidenceDigest === null) ||
    (value.dirtEvidenceDigest !== null &&
      !/^[0-9a-f]{64}$/.test(String(value.dirtEvidenceDigest || ""))) ||
    !String(value.startedAt || "").trim()
  ) {
    throw new Error("Pull-request projection repair receipt is malformed.");
  }
  if (value.status === "completed" && (
    !String(value.targetPullRequestUrl || "").includes("/pull/") ||
    !["reopened", "replaced"].includes(value.outcome) ||
    !String(value.completedAt || "").trim()
  )) {
    throw new Error("Completed pull-request projection repair receipt is incomplete.");
  }
  return {
    schema: PULL_REQUEST_PROJECTION_REPAIR_SCHEMA,
    status: value.status,
    sourceEpoch: value.sourceEpoch,
    sourcePullRequestUrl: value.sourcePullRequestUrl,
    staleHeadSha: value.staleHeadSha,
    expectedHeadSha: value.expectedHeadSha,
    dirtEvidenceDigest: value.dirtEvidenceDigest,
    dirtPathCount: value.dirtPathCount,
    targetPullRequestUrl: value.targetPullRequestUrl || null,
    outcome: value.outcome || null,
    startedAt: value.startedAt,
    completedAt: value.completedAt || null,
  };
}

function requireMatchingPullRequestProjectionRepair({
  repair,
  lease,
  expectedHeadSha,
  dirtEvidence,
}) {
  if (
    repair.sourceEpoch !== lease.epoch ||
    repair.expectedHeadSha !== expectedHeadSha
  ) {
    throw new Error("Pull-request projection repair replay does not match the active lease fence.");
  }
  requireSameRepairDirt({ repair, dirtEvidence });
}

function requireSameRepairDirt({ repair, dirtEvidence }) {
  const digest = dirtEvidence?.digest || null;
  const pathCount = dirtEvidence?.pathCount || 0;
  if (repair.dirtEvidenceDigest !== digest || repair.dirtPathCount !== pathCount) {
    throw new Error("Pull-request projection repair dirt changed from its preserved evidence.");
  }
}

function finalizePullRequestProjectionRepair({
  repair,
  targetPullRequestUrl,
  outcome,
  now,
}) {
  return normalizePullRequestProjectionRepair({
    ...repair,
    status: "completed",
    targetPullRequestUrl,
    outcome,
    completedAt: now().toISOString(),
  });
}

function verifyPullRequestRepositoryIdentity({ pullRequest, url }) {
  const match = String(url || "").match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/\d+(?:[/?#]|$)/);
  const expected = match?.[1] || "";
  const observed = pullRequest.headRepository?.nameWithOwner || "";
  if (!expected || observed !== expected) {
    throw new Error("Pull-request projection repair crossed repository ownership.");
  }
}

function requireClean({ gitText }) {
  if (gitText(["status", "--porcelain"]).trim()) {
    throw new Error("Working tree is not clean. Commit intentionally before switching or publishing.");
  }
}

function requireSession(sessionId) {
  if (!String(sessionId || "").trim()) {
    throw new Error("A stable session id is required through --session=<id> or AGENTIC_SESSION_ID.");
  }
}
