import { digestValue, normalizeWriteSet } from "./cloud-collaboration-primitives.mjs";

export const REVIEW_AHEAD_PLAN_SCHEMA = "agentic-review-ahead-projection-recovery-plan/v1";
export const REVIEW_AHEAD_RESULT_SCHEMA = "agentic-review-ahead-projection-recovery-result/v1";
export const REVIEW_AHEAD_AUTHORIZATION_PREFIX = "authorize review-ahead-projection-recovery";

const DIGEST = /^[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40}$/u;

export function createReviewAheadPlan(evidence, { now = new Date() } = {}) {
  const normalized = normalizeEvidence(evidence);
  const findings = [];
  if (!normalized.clean) findings.push("worktree-not-clean");
  if (!["active", "review_ready"].includes(normalized.leaseStatus)) {
    findings.push("local-lease-not-recoverable");
  }
  if (normalized.localAuthorityState !== "review_ready") findings.push("local-authority-not-reviewed");
  const integratedReplay = normalized.remoteClaimState === "integrated-preserved";
  const dormantReplay = normalized.remoteClaimState === "dormant-preserved";
  const protectedRefreshReplay = (integratedReplay || dormantReplay)
    && normalized.localHeadSha !== normalized.reviewHeadSha
    && normalized.localDescendantReceiptDigest !== null
    && normalized.localHeadSha === normalized.pullRequestHeadSha
    && normalized.localHeadSha === normalized.remoteHeadSha;
  if (!integratedReplay && !dormantReplay) {
    findings.push("cloud-claim-not-recoverable");
  }
  if (normalized.pullRequestState !== "OPEN" || normalized.pullRequestDraft) {
    findings.push("pull-request-not-open-reviewed");
  }
  if (normalized.pullRequestAutoMergeArmed) findings.push("pull-request-auto-merge-armed");
  if (normalized.reviewHeadSha !== normalized.authorityLaneRevision) {
    findings.push("review-head-authority-drift");
  }
  if (!protectedRefreshReplay && (normalized.reviewHeadSha !== normalized.pullRequestHeadSha
      || normalized.reviewHeadSha !== normalized.remoteHeadSha)) {
    findings.push("review-head-provider-drift");
  }
  if (normalized.localHeadSha !== normalized.reviewHeadSha
      && normalized.localDescendantReceiptDigest === null) {
    findings.push("local-head-is-not-reviewed-or-bounded-descendant");
  }
  if (normalized.claimId !== normalized.remoteClaimId
      || normalized.reviewRequestId !== normalized.remoteReviewRequestId
      || normalized.writeSetDigest !== normalized.remoteWriteSetDigest
      || normalized.authorityLaneRevision !== normalized.remoteLaneRevision
      || normalized.repositoryId !== normalized.remoteRepositoryId
      || normalized.leaseEpoch !== normalized.remoteLeaseEpoch
      || JSON.stringify(normalized.declaredWriteScope)
        !== JSON.stringify(normalized.remoteDeclaredWriteScope)) {
    findings.push("cloud-identity-drift");
  }
  if (normalized.actorLogin !== normalized.pullRequestAuthorLogin) {
    findings.push("authenticated-owner-drift");
  }
  if (!integratedReplay && (Date.parse(normalized.localExpiresAt) > now.getTime()
      || Date.parse(normalized.remoteExpiresAt) > now.getTime())) {
    findings.push("authority-not-expired");
  }
  const core = {
    schema: REVIEW_AHEAD_PLAN_SCHEMA,
    operation: "repair-review-ahead-projection-and-reclaim",
    evidence: normalized,
    evidenceDigest: digestValue(normalized),
    findings: Object.freeze([...new Set(findings)].sort()),
    allowedMutations: Object.freeze([
      "local-committed-descendants-preserved",
      "local-review-ready-projection",
      "ownership-pull-request-marker",
      integratedReplay ? "cloud-integrated-replay-receipt" : "cloud-successor-reclaim",
    ]),
    forbiddenMutations: Object.freeze([
      "cleanup", "deployment", "source-edit", "scope-release", "protected-integration",
    ]),
  };
  const planDigest = digestValue(core);
  return Object.freeze({
    ...core,
    planDigest,
    authorization: `${REVIEW_AHEAD_AUTHORIZATION_PREFIX} ${planDigest}`,
    status: findings.length === 0 ? "planned" : "blocked",
  });
}

export function assertReviewAheadAuthorization(plan, authorization) {
  if (plan?.status !== "planned") throw new Error("Review-ahead recovery plan is blocked.");
  const expected = `${REVIEW_AHEAD_AUTHORIZATION_PREFIX} ${requiredDigest(plan.planDigest, "plan digest")}`;
  if (authorization !== expected) throw new Error(`Exact authorization required: ${expected}`);
  return plan;
}

function normalizeEvidence(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("Review-ahead recovery evidence must be an object.");
  }
  return Object.freeze({
    repository: requiredText(source.repository, "repository"),
    repositoryId: requiredText(source.repositoryId, "repositoryId"),
    branch: requiredText(source.branch, "branch"),
    deviceId: requiredText(source.deviceId, "deviceId"),
    sessionId: requiredText(source.sessionId, "sessionId"),
    actorLogin: requiredText(source.actorLogin, "actor login"),
    clean: source.clean === true,
    localHeadSha: requiredSha(source.localHeadSha, "local head"),
    refreshedHeadSha: optionalSha(source.refreshedHeadSha, "refreshed head"),
    localDescendantReceiptDigest: optionalDigest(
      source.localDescendantReceiptDigest,
      "local descendant receipt digest",
    ),
    remoteHeadSha: requiredSha(source.remoteHeadSha, "remote head"),
    reviewHeadSha: requiredSha(source.reviewHeadSha, "review head"),
    pullRequestHeadSha: requiredSha(source.pullRequestHeadSha, "pull request head"),
    pullRequestUrl: requiredText(source.pullRequestUrl, "pull request URL"),
    pullRequestAuthorLogin: requiredText(source.pullRequestAuthorLogin, "pull request author"),
    pullRequestState: requiredText(source.pullRequestState, "pull request state"),
    pullRequestDraft: source.pullRequestDraft === true,
    pullRequestAutoMergeArmed: source.pullRequestAutoMergeArmed === true,
    leaseStatus: requiredText(source.leaseStatus, "lease status"),
    localExpiresAt: requiredDate(source.localExpiresAt, "local expiry"),
    localAuthorityState: requiredText(source.localAuthorityState, "local authority state"),
    claimId: requiredDigest(source.claimId, "claimId"),
    authorityLaneRevision: requiredSha(source.authorityLaneRevision, "authority lane revision"),
    reviewRequestId: requiredText(source.reviewRequestId, "review request"),
    writeSetDigest: requiredDigest(source.writeSetDigest, "write-set digest"),
    declaredWriteScope: normalizeWriteSet(source.declaredWriteScope),
    leaseEpoch: positiveInteger(source.leaseEpoch, "lease epoch"),
    remoteClaimId: requiredDigest(source.remoteClaimId, "remote claimId"),
    remoteClaimState: normalizeRemoteState(source.remoteClaimState),
    remoteRepositoryId: requiredText(source.remoteRepositoryId, "remote repositoryId"),
    remoteLaneRevision: requiredSha(source.remoteLaneRevision, "remote lane revision"),
    remoteReviewRequestId: requiredText(source.remoteReviewRequestId, "remote review request"),
    remoteWriteSetDigest: requiredDigest(source.remoteWriteSetDigest, "remote write-set digest"),
    remoteDeclaredWriteScope: normalizeWriteSet(source.remoteDeclaredWriteScope),
    remoteLeaseEpoch: positiveInteger(source.remoteLeaseEpoch, "remote lease epoch"),
    remoteExpiresAt: requiredDate(source.remoteExpiresAt, "remote expiry"),
  });
}

function normalizeRemoteState(value) {
  return requiredText(value, "remote claim state").replaceAll("_", "-");
}
function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}
function requiredSha(value, label) {
  const text = requiredText(value, label);
  if (!SHA.test(text)) throw new Error(`${label} must be a SHA.`);
  return text;
}
function optionalSha(value, label) {
  return value == null ? null : requiredSha(value, label);
}
function requiredDigest(value, label) {
  const text = requiredText(value, label);
  if (!DIGEST.test(text)) throw new Error(`${label} must be a digest.`);
  return text;
}
function optionalDigest(value, label) {
  return value == null ? null : requiredDigest(value, label);
}
function requiredDate(value, label) {
  const text = requiredText(value, label);
  if (!Number.isFinite(Date.parse(text))) throw new Error(`${label} must be an ISO date.`);
  return text;
}
function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be positive.`);
  return value;
}
