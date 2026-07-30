import { createHash } from "node:crypto";
import path from "node:path";

export const OWNED_DIRT_RECOVERY_SCHEMA = "agentic-owned-dirt-resume/v1";
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const REVIEW_HANDOFF_FIELDS = [
  "schema",
  "status",
  "epoch",
  "sessionId",
  "device",
  "scope",
  "branch",
  "baseSha",
  "fenceSha",
  "autoDelivery",
  "runtimeRequired",
  "heartbeatAt",
  "expiresAt",
  "reviewHeadSha",
];

export function captureOwnedDirtEvidence({ gitText, gitOptional }) {
  const status = gitText(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (!status) throw new Error("--recover-owned-dirt requires an existing dirty worktree.");
  const trackedPaths = splitNul(gitText(["diff", "--name-only", "-z", "HEAD", "--"]));
  const untrackedPaths = splitNul(gitText(["ls-files", "--others", "--exclude-standard", "-z"]));
  const paths = [...new Set([...trackedPaths, ...untrackedPaths])].sort();
  const evidence = {
    status,
    index: gitText(["ls-files", "--stage", "-z"]),
    unstagedDiff: gitText(["diff", "--binary", "--no-ext-diff", "--no-textconv", "--"]),
    stagedDiff: gitText(["diff", "--cached", "--binary", "--no-ext-diff", "--no-textconv", "--"]),
    worktreeObjects: paths.map(relativePath => ({
      path: relativePath,
      objectId: gitOptional(["hash-object", "--no-filters", "--", relativePath]).trim() || null,
    })),
  };
  return {
    digest: createHash("sha256").update(JSON.stringify(evidence)).digest("hex"),
    pathCount: paths.length,
  };
}

export function createOwnedDirtRecovery({ lease, evidence }) {
  return normalizeOwnedDirtRecovery({
    schema: OWNED_DIRT_RECOVERY_SCHEMA,
    sourceEpoch: lease.epoch,
    sourceSessionId: lease.sessionId,
    reviewHeadSha: lease.reviewHeadSha,
    evidenceDigest: evidence.digest,
    pathCount: evidence.pathCount,
  });
}

export function normalizeOwnedDirtRecovery(value) {
  if (value === null || value === undefined) return null;
  if (
    value?.schema !== OWNED_DIRT_RECOVERY_SCHEMA ||
    !Number.isInteger(value.sourceEpoch) ||
    value.sourceEpoch < 1 ||
    !String(value.sourceSessionId || "").trim() ||
    !SHA_PATTERN.test(String(value.reviewHeadSha || "")) ||
    !DIGEST_PATTERN.test(String(value.evidenceDigest || "")) ||
    !Number.isInteger(value.pathCount) ||
    value.pathCount < 1
  ) {
    throw new Error("Owned-dirt recovery evidence is malformed.");
  }
  return {
    schema: OWNED_DIRT_RECOVERY_SCHEMA,
    sourceEpoch: value.sourceEpoch,
    sourceSessionId: value.sourceSessionId,
    reviewHeadSha: value.reviewHeadSha,
    evidenceDigest: value.evidenceDigest,
    pathCount: value.pathCount,
  };
}

export function requireOwnedDirtInvocation({
  branch,
  currentBranch,
  evidence,
  localLease,
  repo,
  sessionId,
}) {
  if (currentBranch !== branch) {
    throw new Error("Owned-dirt recovery requires the exact attached handoff branch.");
  }
  if (!localLease || !["review_ready", "active"].includes(localLease.status) ||
      localLease.sessionId !== sessionId || localLease.branch !== branch ||
      !localLease.worktreePath || path.resolve(localLease.worktreePath) !== path.resolve(repo)) {
    throw new Error("Owned-dirt recovery belongs only to its exact session, branch, and worktree.");
  }
  if (localLease.status === "active") {
    const recovery = normalizeOwnedDirtRecovery(localLease.ownedDirtRecovery);
    requireSameEvidence(recovery, evidence);
  }
}

export function resolveOwnedDirtRecovery({
  branch,
  evidence,
  localHeadSha,
  localLease,
  ownerUrl,
  pullRequestHeadSha,
  remoteLease,
  remoteSha,
  repo,
  sessionId,
}) {
  requireOwnedDirtInvocation({
    branch,
    currentBranch: branch,
    evidence,
    localLease,
    repo,
    sessionId,
  });
  if (pullRequestHeadSha !== remoteSha) {
    throw new Error("Owned-dirt recovery pull-request head does not match the fetched remote branch.");
  }
  if ((localLease.status === "review_ready" && localLease.pullRequestUrl !== ownerUrl) ||
      (localLease.status === "active" && localLease.pullRequestUrl &&
        localLease.pullRequestUrl !== ownerUrl)) {
    throw new Error("Owned-dirt recovery local lease does not match its ownership pull request.");
  }

  if (localLease.status === "review_ready") {
    if (remoteLease?.status !== "review_ready") {
      throw new Error("Owned-dirt recovery requires matching local and remote review-ready evidence.");
    }
    for (const field of REVIEW_HANDOFF_FIELDS) {
      const localValue = ["autoDelivery", "runtimeRequired"].includes(field)
        ? localLease[field] === true
        : localLease[field];
      const remoteValue = ["autoDelivery", "runtimeRequired"].includes(field)
        ? remoteLease[field] === true
        : remoteLease[field];
      if (localValue !== remoteValue) {
        throw new Error(`Owned-dirt review handoff disagrees on ${field}.`);
      }
    }
    if (remoteLease.sessionId !== sessionId || localHeadSha !== remoteSha ||
        remoteSha !== remoteLease.reviewHeadSha) {
      throw new Error("Owned-dirt recovery requires the exact same-session reviewed local and remote head.");
    }
    return createOwnedDirtRecovery({ lease: remoteLease, evidence });
  }

  const recovery = normalizeOwnedDirtRecovery(localLease.ownedDirtRecovery);
  requireSameEvidence(recovery, evidence);
  if (recovery.sourceSessionId !== sessionId) {
    throw new Error("Owned-dirt recovery replay belongs to another source session.");
  }
  if (remoteLease?.status === "review_ready") {
    if (recovery.sourceEpoch !== remoteLease.epoch ||
        recovery.sourceSessionId !== remoteLease.sessionId ||
        remoteLease.device !== localLease.device ||
        remoteLease.scope !== localLease.scope ||
        remoteLease.branch !== localLease.branch ||
        recovery.reviewHeadSha !== remoteLease.reviewHeadSha ||
        localLease.baseSha !== remoteLease.reviewHeadSha ||
        localLease.epoch <= recovery.sourceEpoch) {
      throw new Error("Owned-dirt recovery replay does not match its exact review-ready source epoch.");
    }
  } else if (remoteLease?.status === "active") {
    const remoteRecovery = normalizeOwnedDirtRecovery(remoteLease.ownedDirtRecovery);
    if (JSON.stringify(remoteRecovery) !== JSON.stringify(recovery)) {
      throw new Error("Owned-dirt recovery replay disagrees with its remote recovery evidence.");
    }
  } else {
    throw new Error("Owned-dirt recovery replay requires review-ready or active remote evidence.");
  }
  return recovery;
}

export function requireSameOwnedDirtEvidence(recovery, evidence) {
  requireSameEvidence(normalizeOwnedDirtRecovery(recovery), evidence);
}

function requireSameEvidence(recovery, evidence) {
  if (!recovery || recovery.evidenceDigest !== evidence.digest ||
      recovery.pathCount !== evidence.pathCount) {
    throw new Error("Owned-dirt recovery bytes changed from their exact preserved evidence.");
  }
}

function splitNul(value) {
  return String(value || "").split("\0").filter(Boolean);
}
