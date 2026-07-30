import { createHash } from "node:crypto";
import path from "node:path";

export const PRE_CLAIM_INTEGRATION_CONTINUATION_SCHEMA =
  "agentic-pre-claim-integration-continuation/v1";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SOURCE_MARKER_FIELDS = [
  "schema",
  "status",
  "epoch",
  "sessionId",
  "device",
  "scope",
  "branch",
  "baseSha",
  "fenceSha",
  "heartbeatAt",
  "expiresAt",
];

export function resolveExpiredCommittedContinuation({
  branch,
  currentBranch,
  identity,
  localLease,
  remoteLease,
  remoteSha,
  pullRequestHeadSha,
  ownerUrl,
  repo,
  sessionId,
  gitText,
  now,
}) {
  if (
    currentBranch !== branch ||
    remoteLease.status !== "active" ||
    Date.parse(remoteLease.expiresAt) > now().getTime()
  ) return null;

  const headSha = gitText(["rev-parse", "HEAD"]).trim();
  const stored = normalizePreClaimIntegrationContinuation(
    localLease?.preClaimIntegrationContinuation,
  );
  if (stored) {
    return resolvePendingContinuation({
      branch,
      identity,
      localLease,
      remoteLease,
      remoteSha,
      pullRequestHeadSha,
      ownerUrl,
      repo,
      sessionId,
      headSha,
      stored,
      gitText,
    });
  }
  if (headSha === remoteSha) return null;
  if (localLease?.epoch !== remoteLease.epoch) return null;

  requireSourceLease({
    branch,
    identity,
    localLease,
    remoteLease,
    remoteSha,
    pullRequestHeadSha,
    ownerUrl,
    repo,
    sessionId,
  });
  gitText(["merge-base", "--is-ancestor", remoteSha, headSha]);
  const sourceTreeSha = gitText(["rev-parse", `${remoteSha}^{tree}`]).trim();
  const headTreeSha = gitText(["rev-parse", `${headSha}^{tree}`]).trim();
  requireSha(sourceTreeSha, "Committed continuation source tree");
  requireSha(headTreeSha, "Committed continuation tree");
  if (sourceTreeSha === headTreeSha) {
    throw new Error("Committed continuation has no authored tree change beyond the remote fence.");
  }
  const committedPaths = [...new Set(splitNul(gitText([
    "diff", "--name-only", "-z", remoteSha, headSha, "--",
  ])))].sort();
  if (!committedPaths.length) {
    throw new Error("Committed continuation has no changed paths beyond the remote fence.");
  }
  const rangeDiffDigest = sha256(gitText([
    "diff", "--binary", remoteSha, headSha, "--",
  ]));
  const integration = resolveIntegrationEvidence({
    integration: localLease.integration,
    sourceFenceSha: remoteSha,
    headSha,
    headTreeSha,
    gitText,
    now,
    committedPaths,
    rangeDiffDigest,
  });
  return {
    headSha,
    integration,
    preClaimIntegrationContinuation: {
      schema: PRE_CLAIM_INTEGRATION_CONTINUATION_SCHEMA,
      sourceStatus: remoteLease.status,
      sourceEpoch: remoteLease.epoch,
      sourceSessionId: sessionId,
      sourceDevice: remoteLease.device,
      sourceScope: remoteLease.scope,
      sourceBranch: branch,
      sourceBaseSha: remoteLease.baseSha,
      sourceFenceSha: remoteSha,
      sourcePullRequestUrl: ownerUrl,
      headSha,
      treeSha: headTreeSha,
      integrationCommitSha: integration.commitSha,
      integrationTreeSha: integration.treeSha,
    },
    pendingClaim: false,
  };
}

export function normalizePreClaimIntegrationContinuation(value) {
  if (value === undefined || value === null) return null;
  if (
    value?.schema !== PRE_CLAIM_INTEGRATION_CONTINUATION_SCHEMA ||
    !Number.isInteger(value.sourceEpoch) ||
    value.sourceEpoch < 1 ||
    value.sourceStatus !== "active" ||
    !String(value.sourceSessionId || "") ||
    !String(value.sourceDevice || "") ||
    !String(value.sourceScope || "") ||
    !String(value.sourceBranch || "") ||
    !String(value.sourcePullRequestUrl || "")
  ) {
    throw new Error("Pre-claim integration continuation has invalid identity evidence.");
  }
  for (const field of [
    "sourceBaseSha",
    "sourceFenceSha",
    "headSha",
    "treeSha",
    "integrationCommitSha",
    "integrationTreeSha",
  ]) requireSha(value[field], `Pre-claim integration continuation ${field}`);
  return {
    schema: value.schema,
    sourceStatus: value.sourceStatus,
    sourceEpoch: value.sourceEpoch,
    sourceSessionId: value.sourceSessionId,
    sourceDevice: value.sourceDevice,
    sourceScope: value.sourceScope,
    sourceBranch: value.sourceBranch,
    sourceBaseSha: value.sourceBaseSha,
    sourceFenceSha: value.sourceFenceSha,
    sourcePullRequestUrl: value.sourcePullRequestUrl,
    headSha: value.headSha,
    treeSha: value.treeSha,
    integrationCommitSha: value.integrationCommitSha,
    integrationTreeSha: value.integrationTreeSha,
  };
}

function resolvePendingContinuation({
  branch,
  identity,
  localLease,
  remoteLease,
  remoteSha,
  pullRequestHeadSha,
  ownerUrl,
  repo,
  sessionId,
  headSha,
  stored,
  gitText,
}) {
  requireSourceMarker({ remoteLease, stored, branch, sessionId, ownerUrl });
  if (
    localLease.status !== "active" ||
    localLease.sessionId !== sessionId ||
    localLease.device !== identity.device ||
    localLease.scope !== identity.scope ||
    localLease.branch !== branch ||
    localLease.epoch !== stored.sourceEpoch + 1 ||
    localLease.baseSha !== stored.headSha ||
    !localLease.worktreePath ||
    path.resolve(localLease.worktreePath) !== path.resolve(repo)
  ) {
    throw new Error("Pending committed continuation no longer matches its successor lease.");
  }
  const recoverableRemote = remoteSha === stored.sourceFenceSha ||
    (SHA_PATTERN.test(String(localLease.fenceSha || "")) &&
      remoteSha === localLease.fenceSha);
  if (!recoverableRemote || pullRequestHeadSha !== remoteSha) {
    throw new Error("Pending committed continuation lost its exact remote or pull-request fence.");
  }
  if (
    localLease.integration?.commitSha !== stored.integrationCommitSha ||
    localLease.integration?.treeSha !== stored.integrationTreeSha
  ) {
    throw new Error("Pending committed continuation lost its exact integration evidence.");
  }
  requireRecordedTrees({ stored, gitText });
  gitText(["merge-base", "--is-ancestor", stored.sourceFenceSha, stored.headSha]);
  if (headSha !== stored.headSha) {
    gitText(["merge-base", "--is-ancestor", stored.headSha, headSha]);
  }
  return {
    headSha: stored.headSha,
    integration: localLease.integration,
    preClaimIntegrationContinuation: stored,
    pendingClaim: true,
  };
}

function requireSourceLease({
  branch,
  identity,
  localLease,
  remoteLease,
  remoteSha,
  pullRequestHeadSha,
  ownerUrl,
  repo,
  sessionId,
}) {
  if (!localLease || SOURCE_MARKER_FIELDS.some(field => localLease[field] !== remoteLease[field])) {
    throw new Error("Committed continuation does not match the exact local and remote lease evidence.");
  }
  if (
    remoteLease.sessionId !== sessionId ||
    remoteLease.device !== identity.device ||
    remoteLease.scope !== identity.scope ||
    remoteLease.branch !== branch ||
    localLease.pullRequestUrl !== ownerUrl ||
    !localLease.worktreePath ||
    path.resolve(localLease.worktreePath) !== path.resolve(repo)
  ) {
    throw new Error("Committed continuation belongs to another session, worktree, branch, or pull request.");
  }
  if (
    !SHA_PATTERN.test(String(remoteLease.fenceSha || "")) ||
    remoteSha !== remoteLease.fenceSha ||
    pullRequestHeadSha !== remoteSha
  ) {
    throw new Error("Committed continuation lost its exact remote or pull-request fence.");
  }
}

function requireSourceMarker({ remoteLease, stored, branch, sessionId, ownerUrl }) {
  if (
    remoteLease.epoch !== stored.sourceEpoch ||
    remoteLease.status !== stored.sourceStatus ||
    remoteLease.sessionId !== stored.sourceSessionId ||
    remoteLease.sessionId !== sessionId ||
    remoteLease.device !== stored.sourceDevice ||
    remoteLease.scope !== stored.sourceScope ||
    remoteLease.branch !== stored.sourceBranch ||
    remoteLease.branch !== branch ||
    remoteLease.baseSha !== stored.sourceBaseSha ||
    remoteLease.fenceSha !== stored.sourceFenceSha ||
    ownerUrl !== stored.sourcePullRequestUrl
  ) {
    throw new Error("Pending committed continuation no longer matches its source lease.");
  }
}

function resolveIntegrationEvidence({
  integration,
  sourceFenceSha,
  headSha,
  headTreeSha,
  gitText,
  now,
  committedPaths,
  rangeDiffDigest,
}) {
  if (!integration) {
    return {
      schema: "agentic-integration-commit/v1",
      commitSha: headSha,
      treeSha: headTreeSha,
      commitMessage: gitText(["log", "-1", "--pretty=%s", headSha]).trim(),
      manifestDigest: null,
      stagedDiffDigest: null,
      paths: committedPaths,
      rangeDiffDigest,
      validationRequired: true,
      recordedAt: now().toISOString(),
    };
  }
  if (
    integration.schema !== "agentic-integration-commit/v1" ||
    !SHA_PATTERN.test(String(integration.commitSha || "")) ||
    !SHA_PATTERN.test(String(integration.treeSha || ""))
  ) {
    throw new Error("Committed continuation has malformed integration evidence.");
  }
  const integrationTree = gitText(["rev-parse", `${integration.commitSha}^{tree}`]).trim();
  if (integrationTree !== integration.treeSha) {
    throw new Error("Committed continuation integration tree does not match its recorded commit.");
  }
  gitText(["merge-base", "--is-ancestor", sourceFenceSha, integration.commitSha]);
  gitText(["merge-base", "--is-ancestor", integration.commitSha, headSha]);
  return integration;
}

function requireRecordedTrees({ stored, gitText }) {
  if (gitText(["rev-parse", `${stored.headSha}^{tree}`]).trim() !== stored.treeSha) {
    throw new Error("Pre-claim continuation tree changed from its recorded commit.");
  }
  if (
    gitText(["rev-parse", `${stored.integrationCommitSha}^{tree}`]).trim() !==
    stored.integrationTreeSha
  ) {
    throw new Error("Pre-claim integration tree changed from its recorded commit.");
  }
}

function requireSha(value, label) {
  if (!SHA_PATTERN.test(String(value || ""))) {
    throw new Error(`${label} must be an exact lowercase 40-character Git SHA.`);
  }
}

function splitNul(value) {
  return String(value || "").split("\0").map(item => item.trim()).filter(Boolean);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
