import { digestValue } from "./cloud-collaboration-primitives.mjs";

export const INTEGRATED_PRESERVED_DRAFT_RECOVERY_PLAN_SCHEMA =
  "agentic-integrated-preserved-draft-recovery-plan/v1";
export const INTEGRATED_PRESERVED_DRAFT_RECOVERY_RESULT_SCHEMA =
  "agentic-integrated-preserved-draft-recovery-result/v1";
export const INTEGRATED_PRESERVED_DRAFT_RECOVERY_TERMINAL_RECEIPT_SCHEMA =
  "agentic-integrated-preserved-draft-recovery-terminal-receipt/v1";
export const INTEGRATED_PRESERVED_DRAFT_RECOVERY_AUTHORIZATION_PREFIX =
  "authorize integrated-preserved-draft-recovery";

const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const BRANCH_PATTERN = /^agent\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u;

export function createIntegratedPreservedDraftRecoveryPlan(source) {
  const evidence = normalizeEvidence(source);
  const findings = [];

  if (!evidence.clean) findings.push("worktree-not-clean");
  if (!BRANCH_PATTERN.test(evidence.branch)) findings.push("branch-identity-invalid");
  if (evidence.leaseStatus !== "review_ready") findings.push("local-lease-not-review-ready");
  if (evidence.leaseSessionId !== evidence.sessionId) findings.push("source-session-drift");
  if (evidence.localAuthorityState !== "review-ready") {
    findings.push("local-authority-not-review-ready");
  }
  if (evidence.remoteClaimState !== "integrated-preserved") {
    findings.push("cloud-claim-not-integrated-preserved");
  }
  if (evidence.remoteClaimWriteAuthority || !evidence.remoteClaimScopeReserved) {
    findings.push("cloud-terminal-authority-drift");
  }
  if (evidence.pullRequestState !== "OPEN") findings.push("pull-request-not-open");
  if (evidence.pullRequestAutoMergeArmed) findings.push("pull-request-auto-merge-armed");
  if (evidence.pullRequestHeadBranch !== evidence.branch
      || evidence.pullRequestBaseBranch !== "main") {
    findings.push("pull-request-branch-drift");
  }
  if (evidence.actorLogin !== evidence.pullRequestAuthorLogin
      || evidence.actorLogin !== evidence.pullRequestHeadOwnerLogin) {
    findings.push("authenticated-owner-drift");
  }
  if (evidence.repositoryId !== evidence.remoteClaimRepositoryId
      || evidence.targetRepository !== evidence.pullRequestHeadRepository) {
    findings.push("repository-identity-drift");
  }
  if (evidence.baseSha !== evidence.pullRequestBaseSha
      || evidence.baseSha !== evidence.remoteClaimCanonicalBaseSha) {
    findings.push("base-identity-drift");
  }
  if (evidence.localHeadSha !== evidence.reviewHeadSha
      || evidence.localHeadSha !== evidence.remoteHeadSha
      || evidence.localHeadSha !== evidence.pullRequestHeadSha
      || evidence.localHeadSha !== evidence.localAuthorityLaneRevision
      || evidence.localHeadSha !== evidence.remoteClaimLaneRevision) {
    findings.push("review-head-drift");
  }
  if (evidence.localAuthorityClaimId !== evidence.remoteClaimId
      || evidence.localAuthorityReviewRequestId !== evidence.remoteClaimReviewRequestId
      || evidence.localAuthorityWriteSetDigest !== evidence.remoteClaimWriteSetDigest
      || evidence.localAuthorityLeaseEpoch !== evidence.remoteClaimLeaseEpoch) {
    findings.push("cloud-identity-drift");
  }
  if (evidence.localAuthorityReviewRequestId
      !== `github-pull-request:${evidence.pullRequestId}`) {
    findings.push("pull-request-node-identity-drift");
  }

  const identity = projectionInvariantIdentity(evidence);
  const core = Object.freeze({
    schema: INTEGRATED_PRESERVED_DRAFT_RECOVERY_PLAN_SCHEMA,
    operation: "project-exact-integrated-preserved-pull-request-ready",
    identity,
    identityDigest: digestValue(identity),
    findings: Object.freeze([...new Set(findings)].sort()),
    allowedMutations: Object.freeze([
      "writer-entrypoint-fence",
      "pull-request-draft-to-ready",
    ]),
    forbiddenMutations: Object.freeze([
      "branch-ref-mutation",
      "cleanup",
      "cloud-claim-mutation",
      "deployment",
      "local-lease-projection",
      "merge",
      "source-edit",
    ]),
  });
  const planDigest = digestValue(core);
  return Object.freeze({
    ...core,
    observation: Object.freeze({ pullRequestDraft: evidence.pullRequestDraft }),
    planDigest,
    authorization: `${INTEGRATED_PRESERVED_DRAFT_RECOVERY_AUTHORIZATION_PREFIX} ${planDigest}`,
    status: findings.length === 0 ? "planned" : "blocked",
  });
}

export function assertIntegratedPreservedDraftRecoveryAuthorization(plan, authorization) {
  if (plan?.status !== "planned") {
    throw new Error("Integrated-preserved draft recovery plan is blocked.");
  }
  const planDigest = requiredDigest(plan.planDigest, "plan digest");
  const expectedCore = {
    schema: plan.schema,
    operation: plan.operation,
    identity: plan.identity,
    identityDigest: plan.identityDigest,
    findings: plan.findings,
    allowedMutations: plan.allowedMutations,
    forbiddenMutations: plan.forbiddenMutations,
  };
  if (digestValue(expectedCore) !== planDigest
      || digestValue(plan.identity) !== plan.identityDigest) {
    throw new Error("Integrated-preserved draft recovery plan digest is invalid.");
  }
  const expected = `${INTEGRATED_PRESERVED_DRAFT_RECOVERY_AUTHORIZATION_PREFIX} ${planDigest}`;
  if (authorization !== expected) throw new Error(`Exact authorization required: ${expected}`);
  return plan;
}

export function assertIntegratedPreservedReadyProjection({ before, after }) {
  const sourcePlan = createIntegratedPreservedDraftRecoveryPlan(before);
  const terminalPlan = createIntegratedPreservedDraftRecoveryPlan(after);
  if (sourcePlan.status !== "planned" || terminalPlan.status !== "planned"
      || sourcePlan.planDigest !== terminalPlan.planDigest
      || terminalPlan.observation.pullRequestDraft) {
    throw new Error(
      "Pull-request ready projection changed state outside the sealed exact identity.",
    );
  }
  return Object.freeze({
    planDigest: sourcePlan.planDigest,
    beforeDraft: sourcePlan.observation.pullRequestDraft,
    afterDraft: terminalPlan.observation.pullRequestDraft,
    identityDigest: terminalPlan.identityDigest,
  });
}

export function createIntegratedPreservedReadyTerminalReceipt({ plan, evidence }) {
  assertIntegratedPreservedDraftRecoveryAuthorization(plan, plan.authorization);
  const terminalPlan = createIntegratedPreservedDraftRecoveryPlan(evidence);
  if (terminalPlan.status !== "planned" || terminalPlan.planDigest !== plan.planDigest
      || terminalPlan.observation.pullRequestDraft) {
    throw new Error("Terminal ready receipt does not match the sealed exact identity.");
  }
  const core = Object.freeze({
    schema: INTEGRATED_PRESERVED_DRAFT_RECOVERY_TERMINAL_RECEIPT_SCHEMA,
    status: "pull-request-ready",
    planDigest: plan.planDigest,
    identityDigest: terminalPlan.identityDigest,
    pullRequestId: terminalPlan.identity.pullRequestId,
    pullRequestNumber: terminalPlan.identity.pullRequestNumber,
    pullRequestUrl: terminalPlan.identity.pullRequestUrl,
    pullRequestState: terminalPlan.identity.pullRequestState,
    pullRequestDraft: false,
  });
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}

function projectionInvariantIdentity(evidence) {
  const { pullRequestDraft: _pullRequestDraft, ...identity } = evidence;
  return Object.freeze(identity);
}

function normalizeEvidence(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("Integrated-preserved draft recovery evidence must be an object.");
  }
  return Object.freeze({
    repository: requiredText(source.repository, "repository"),
    repositoryId: requiredText(source.repositoryId, "repositoryId"),
    targetRepository: requiredText(source.targetRepository, "targetRepository"),
    branch: requiredText(source.branch, "branch"),
    sessionId: requiredText(source.sessionId, "sessionId"),
    deviceId: requiredText(source.deviceId, "deviceId"),
    actorLogin: requiredText(source.actorLogin, "actor login"),
    clean: requiredBoolean(source.clean, "clean"),
    baseSha: requiredSha(source.baseSha, "base SHA"),
    localHeadSha: requiredSha(source.localHeadSha, "local head SHA"),
    remoteHeadSha: requiredSha(source.remoteHeadSha, "remote head SHA"),
    reviewHeadSha: requiredSha(source.reviewHeadSha, "review head SHA"),
    leaseStatus: requiredText(source.leaseStatus, "lease status"),
    leaseSessionId: requiredText(source.leaseSessionId, "lease session"),
    leaseEpoch: positiveInteger(source.leaseEpoch, "lease epoch"),
    localLeaseDigest: requiredDigest(source.localLeaseDigest, "local lease digest"),
    taskAuthorityBindingDigest: requiredDigest(
      source.taskAuthorityBindingDigest,
      "task-authority binding digest",
    ),
    localAuthorityState: normalizeState(source.localAuthorityState, "local authority state"),
    localAuthorityClaimId: requiredDigest(source.localAuthorityClaimId, "local claim ID"),
    localAuthorityLaneRevision: requiredSha(
      source.localAuthorityLaneRevision,
      "local authority lane revision",
    ),
    localAuthorityReviewRequestId: requiredText(
      source.localAuthorityReviewRequestId,
      "local review request ID",
    ),
    localAuthorityWriteSetDigest: requiredDigest(
      source.localAuthorityWriteSetDigest,
      "local write-set digest",
    ),
    localAuthorityLeaseEpoch: positiveInteger(
      source.localAuthorityLeaseEpoch,
      "local authority lease epoch",
    ),
    localAuthorityDigest: requiredDigest(
      source.localAuthorityDigest,
      "local authority digest",
    ),
    remoteClaimId: requiredDigest(source.remoteClaimId, "remote claim ID"),
    remoteClaimState: normalizeState(source.remoteClaimState, "remote claim state"),
    remoteClaimWriteAuthority: requiredBoolean(
      source.remoteClaimWriteAuthority,
      "remote write authority",
    ),
    remoteClaimScopeReserved: requiredBoolean(
      source.remoteClaimScopeReserved,
      "remote scope reservation",
    ),
    remoteClaimRepositoryId: requiredText(
      source.remoteClaimRepositoryId,
      "remote repository ID",
    ),
    remoteClaimCanonicalBaseSha: requiredSha(
      source.remoteClaimCanonicalBaseSha,
      "remote canonical base SHA",
    ),
    remoteClaimLaneRevision: requiredSha(
      source.remoteClaimLaneRevision,
      "remote lane revision",
    ),
    remoteClaimReviewRequestId: requiredText(
      source.remoteClaimReviewRequestId,
      "remote review request ID",
    ),
    remoteClaimWriteSetDigest: requiredDigest(
      source.remoteClaimWriteSetDigest,
      "remote write-set digest",
    ),
    remoteClaimLeaseEpoch: positiveInteger(
      source.remoteClaimLeaseEpoch,
      "remote claim lease epoch",
    ),
    remoteClaimTransitionCounter: positiveInteger(
      source.remoteClaimTransitionCounter,
      "remote transition counter",
    ),
    remoteClaimOperationReceiptDigest: requiredDigest(
      source.remoteClaimOperationReceiptDigest,
      "remote operation receipt digest",
    ),
    remoteClaimIntegrationReceiptDigest: requiredDigest(
      source.remoteClaimIntegrationReceiptDigest,
      "remote integration receipt digest",
    ),
    remoteClaimIntegrationDigest: requiredDigest(
      source.remoteClaimIntegrationDigest,
      "remote integration digest",
    ),
    remoteClaimDigest: requiredDigest(source.remoteClaimDigest, "remote claim digest"),
    continuationSubjectDigest: requiredDigest(
      source.continuationSubjectDigest,
      "continuation subject digest",
    ),
    pullRequestId: requiredText(source.pullRequestId, "pull-request ID"),
    pullRequestNumber: positiveInteger(source.pullRequestNumber, "pull-request number"),
    pullRequestUrl: requiredText(source.pullRequestUrl, "pull-request URL"),
    pullRequestState: requiredText(source.pullRequestState, "pull-request state"),
    pullRequestDraft: requiredBoolean(source.pullRequestDraft, "pull-request draft state"),
    pullRequestAutoMergeArmed: requiredBoolean(
      source.pullRequestAutoMergeArmed,
      "pull-request auto-merge state",
    ),
    pullRequestAuthorLogin: requiredText(
      source.pullRequestAuthorLogin,
      "pull-request author",
    ),
    pullRequestHeadRepository: requiredText(
      source.pullRequestHeadRepository,
      "pull-request head repository",
    ),
    pullRequestHeadOwnerLogin: requiredText(
      source.pullRequestHeadOwnerLogin,
      "pull-request head owner",
    ),
    pullRequestHeadBranch: requiredText(
      source.pullRequestHeadBranch,
      "pull-request head branch",
    ),
    pullRequestHeadSha: requiredSha(source.pullRequestHeadSha, "pull-request head SHA"),
    pullRequestBaseBranch: requiredText(
      source.pullRequestBaseBranch,
      "pull-request base branch",
    ),
    pullRequestBaseSha: requiredSha(source.pullRequestBaseSha, "pull-request base SHA"),
    pullRequestBodyDigest: requiredDigest(
      source.pullRequestBodyDigest,
      "pull-request body digest",
    ),
    pullRequestProviderIdentityDigest: requiredDigest(
      source.pullRequestProviderIdentityDigest,
      "pull-request provider identity digest",
    ),
    remoteLeaseDigest: requiredDigest(source.remoteLeaseDigest, "remote lease digest"),
  });
}

function normalizeState(value, label) {
  return requiredText(value, label).replaceAll("_", "-");
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function requiredSha(value, label) {
  const text = requiredText(value, label);
  if (!SHA_PATTERN.test(text)) throw new Error(`${label} must be a SHA.`);
  return text;
}

function requiredDigest(value, label) {
  const text = requiredText(value, label);
  if (!DIGEST_PATTERN.test(text)) throw new Error(`${label} must be a digest.`);
  return text;
}

function requiredBoolean(value, label) {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean.`);
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be positive.`);
  return value;
}
