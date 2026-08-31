// Responsibility: Bind exact authorization and provider-deferred completion to one dormant incident.
import { canonicalJson, digestValue }
  from "./cloud-collaboration-primitives.mjs";
import {
  normalizeExpiredDescendantUntrackedScopeRecoveryEvidence,
} from "./expired-descendant-untracked-scope-recovery-evidence.mjs";

export const OPERATION = "expired-descendant-untracked-scope-recovery";
export const PLAN_SCHEMA = `agentic-${OPERATION}-plan/v1`;
export const COMPLETION_SCHEMA = `agentic-${OPERATION}-completion/v1`;
const DIGEST = /^[0-9a-f]{64}$/u;

export function buildExpiredDescendantUntrackedScopeRecoveryPlan(evidence) {
  const source = normalizeExpiredDescendantUntrackedScopeRecoveryEvidence(evidence);
  const core = {
    schema: PLAN_SCHEMA,
    operation: OPERATION,
    evidence: source,
    evidenceDigest: source.evidenceDigest,
    innerPlanDigest: source.innerPlanDigest,
    sourceClaimId: source.sourceClaim.claimId,
    sourceClaimDigest: source.sourceClaim.fenceRevision,
    sourceLeaseDigest: source.incident.sourceLeaseDigest,
    sourceHeadSha: source.incident.sourceHeadSha,
    sourceDirtEvidenceDigest: source.incident.dirt.evidenceDigest,
    ownerStopReceiptDigest: source.incident.ownerStop.receiptDigest,
    targetManifestDigest: source.incident.targetManifestDigest,
    targetWriteSetDigest: source.incident.targetWriteSetDigest,
    allowedMutations: [
      "expired-descendant-recovery-intent", "task-authority-successor-continuation",
      "cloud-waiting-successor", "cloud-source-retirement",
      "cloud-successor-promotion", "cloud-successor-review-binding",
      "writer-registry-cas",
    ],
    forbiddenMutations: [
      "source-bytes", "index", "head", "local-ref", "remote-ref", "commit",
      "push", "pull-request-body", "pull-request-state", "review", "integration",
      "merge", "deployment", "cleanup",
    ],
    providerProjection: "deferred",
    crossDeviceResumeAuthority: false,
  };
  const planDigest = digestValue(core);
  return deepFreeze({ ...core, planDigest,
    exactAuthorization: `authorize ${OPERATION} ${planDigest}` });
}

export function normalizeExpiredDescendantUntrackedScopeRecoveryPlan(value) {
  if (value?.schema !== PLAN_SCHEMA || value.operation !== OPERATION) invalid("plan schema");
  const rebuilt = buildExpiredDescendantUntrackedScopeRecoveryPlan(value.evidence);
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("plan projection");
  return rebuilt;
}

export function authorizeExpiredDescendantUntrackedScopeRecovery(plan, authorization) {
  const source = normalizeExpiredDescendantUntrackedScopeRecoveryPlan(plan);
  if (authorization !== source.exactAuthorization) {
    throw new Error(`Recovery requires exact authorization: ${source.exactAuthorization}`);
  }
  return Object.freeze({ planDigest: source.planDigest, statement: authorization,
    authorizationDigest: digestValue({ planDigest: source.planDigest, authorization }) });
}

export function buildExpiredDescendantUntrackedScopeRecoveryCompletion({
  plan, authorization, innerResult, terminal,
} = {}) {
  const source = normalizeExpiredDescendantUntrackedScopeRecoveryPlan(plan);
  const granted = authorizeExpiredDescendantUntrackedScopeRecovery(
    source, authorization?.statement,
  );
  if (granted.authorizationDigest !== authorization.authorizationDigest
    || innerResult?.schema
      !== "agentic-expired-descendant-untracked-scope-recovery-inner/v1"
    || innerResult.status !== "complete"
    || innerResult.planDigest !== source.innerPlanDigest
    || innerResult.providerProjection !== "deferred"
    || innerResult.pullRequestMutation !== false
    || !DIGEST.test(String(innerResult.successorClaimId || ""))
    || !DIGEST.test(String(innerResult.successorClaimDigest || ""))
    || !DIGEST.test(String(innerResult.targetLeaseDigest || ""))
    || !DIGEST.test(String(innerResult.terminalReceiptDigest || ""))
    || !DIGEST.test(String(innerResult.receiptDigest || ""))) invalid("inner completion");
  const final = terminalVerification(terminal, source, innerResult);
  const core = {
    schema: COMPLETION_SCHEMA,
    status: "same-session-authoring-authority-restored",
    planDigest: source.planDigest,
    authorizationDigest: granted.authorizationDigest,
    sourceClaimId: source.sourceClaimId,
    successorClaimId: final.successorClaimId,
    successorClaimDigest: final.successorClaimDigest,
    targetLeaseDigest: final.targetLeaseDigest,
    innerCompletionReceiptDigest: innerResult.receiptDigest,
    terminalVerificationDigest: final.verificationDigest,
    authoringAuthority: true,
    reviewAuthority: false,
    integrationAuthority: false,
    providerProjection: "deferred",
    crossDeviceResumeAuthority: false,
    sourceBytesChanged: false,
    committed: false,
    pushed: false,
    pullRequestMutation: false,
    merged: false,
    deployed: false,
    cleaned: false,
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function terminalVerification(value, plan, innerResult) {
  const result = {
    stableIncidentDigest: digest(value?.stableIncidentDigest, "terminal incident"),
    sourceHeadSha: String(value?.sourceHeadSha || ""),
    sourceDirtEvidenceDigest: digest(value?.sourceDirtEvidenceDigest, "terminal dirt"),
    successorClaimId: digest(value?.successorClaimId, "successor claim"),
    successorClaimDigest: digest(value?.successorClaimDigest, "successor claim digest"),
    targetLeaseDigest: digest(value?.targetLeaseDigest, "target lease"),
    innerCompletionReceiptDigest: digest(value?.innerCompletionReceiptDigest,
      "inner completion"),
    mutationAuthorityReceiptDigest: digest(value?.mutationAuthorityReceiptDigest,
      "mutation authority"),
    cloudVerificationReceiptDigest: digest(value?.cloudVerificationReceiptDigest,
      "cloud verification"),
    preservedPullRequestDigest: digest(value?.preservedPullRequestDigest,
      "preserved pull request"),
    providerProjection: value?.providerProjection,
    pullRequestMutation: value?.pullRequestMutation,
    verifiedAt: instant(value?.verifiedAt, "terminal instant"),
  };
  if (result.stableIncidentDigest !== plan.evidence.stableIncidentDigest
    || result.sourceHeadSha !== plan.sourceHeadSha
    || result.sourceDirtEvidenceDigest !== plan.sourceDirtEvidenceDigest
    || result.innerCompletionReceiptDigest !== innerResult.receiptDigest
    || result.successorClaimId !== innerResult.successorClaimId
    || result.successorClaimDigest !== innerResult.successorClaimDigest
    || result.targetLeaseDigest !== innerResult.targetLeaseDigest
    || result.providerProjection !== "deferred"
    || result.pullRequestMutation !== false) invalid("terminal joins");
  const stable = { ...result }; delete stable.verifiedAt;
  return { ...result, verificationDigest: digestValue(stable) };
}

function digest(value, label) {
  if (!DIGEST.test(String(value || ""))) invalid(label);
  return value;
}
function instant(value, label) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) invalid(label);
  return value;
}
function invalid(label) {
  throw new Error(`Expired descendant/untracked recovery has invalid ${label}.`);
}
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
