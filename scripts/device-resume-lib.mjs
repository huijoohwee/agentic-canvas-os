import os from "node:os";
import path from "node:path";
import { assertNoCompetingPullRequests } from "./repository-guards.mjs";
import {
  parseDeviceBranch,
  parseWriterLeasePullRequestBody,
  updateWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";
import { sanitizeDevice } from "./device-branch-identity.mjs";
import {
  readOwnershipPullRequest,
  requireOwnershipPullRequestDraft,
} from "./device-pull-request-state.mjs";
import {
  captureOwnedDirtEvidence,
  requireOwnedDirtInvocation,
  requireSameOwnedDirtEvidence,
  resolveOwnedDirtRecovery,
} from "./owned-dirt-resume-lib.mjs";
import {
  resolveExpiredCommittedContinuation,
  resolveSameSessionDeliveryContinuation,
} from "./expired-committed-continuation-lib.mjs";
import {
  protectedMainRefreshHeads,
  verifyProtectedMainRefreshChain,
} from "./protected-main-refresh-lib.mjs";
import {
  requireClean,
  requireRepositorySafety,
  requireSession,
} from "./device-branch-ownership-lib.mjs";
import {
  completeParkedStashRestore,
  pushResumeClaim,
  reconcileResumeReplay,
  requireExactParkedStashHandoff,
  requireParkedResumeHead,
  requireResumeClaimCommit,
  resumeClaimSubject,
} from "./device-resume-replay-lib.mjs";

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
  requireLegacyResumeAuthority(localAtInvocation);
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
  requireLegacyResumeAuthority(remoteLease);
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

function requireLegacyResumeAuthority(lease) {
  if (!lease?.admission && !lease?.cloudAuthority) return;
  throw new Error(
    "Cloud-admitted lane resume requires the repository cloud handoff/reclaim protocol; refusing a local-only successor lease.",
  );
}
