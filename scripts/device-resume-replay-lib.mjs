import path from "node:path";
import {
  parseWriterLeasePullRequestBody,
  updateWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";
import { requireOwnershipPullRequestDraft } from "./device-pull-request-state.mjs";
import {
  requireParkedStashObject,
  restoreParkedStashObject,
} from "./device-park-lib.mjs";
import { normalizeOwnedDirtRecovery } from "./owned-dirt-resume-lib.mjs";
import { normalizePreClaimIntegrationContinuation } from "./expired-committed-continuation-lib.mjs";
import { assertLeaseWorktree } from "./device-branch-ownership-lib.mjs";

const PARK_STASH_FIELDS = [
  "parkHeadSha", "parkBranchHeadSha", "parkSourceEpoch", "parkSourceFenceSha",
  "parkStashRef", "parkStashSha", "parkStashMessage", "parkStashStatus",
];

export function reconcileResumeReplay({
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

export function requireParkedResumeHead(lease) {
  if (!/^[0-9a-f]{40}$/.test(String(lease.parkBranchHeadSha || "")) ||
      lease.parkSourceEpoch !== lease.epoch || lease.parkSourceFenceSha !== lease.fenceSha) {
    throw new Error("Parked resume lacks its exact pre-claim head, source epoch, or source fence.");
  }
  return lease.parkBranchHeadSha;
}

export function requireExactParkedStashHandoff({ remoteLease, localLease, owner, repo, sessionId, gitText, gitOptional }) {
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

export function completeParkedStashRestore({ branch, lease, owner, leaseStore, sessionId, gitText, gitOptional, ghText, run }) {
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

export function requireResumeClaimCommit({ lease, headSha, gitText }) {
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

export function resumeClaimSubject(scope, epoch) {
  return `chore(coordination): claim ${scope} lease ${epoch}`;
}

export function pushResumeClaim({ branch, ownedDirtRecovery, run }) {
  run("git", [
    "push",
    ...(ownedDirtRecovery ? ["--no-verify"] : []),
    "origin",
    branch,
  ]);
}
