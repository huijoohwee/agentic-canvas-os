// Responsibility: Seal the exact evidence, authorization, and receipt for one stale prepared-intent supersession.
import { digestValue } from "./cloud-collaboration-primitives.mjs";

export const EVIDENCE_SCHEMA =
  "agentic-task-authority-loss-incident-recovery-revision-intent-supersession-evidence/v1";
export const PLAN_SCHEMA =
  "agentic-task-authority-loss-incident-recovery-revision-intent-supersession-plan/v1";
export const RECEIPT_SCHEMA =
  "agentic-task-authority-loss-incident-recovery-revision-intent-supersession-completion/v1";
export const OPERATION =
  "task-authority-loss-incident-recovery-revision-intent-supersession";
export const ZERO_EFFECTS = Object.freeze({
  sourceByteMutation: false,
  gitRefMutation: false,
  commitEffect: false,
  pushEffect: false,
  pullRequestEffect: false,
  cloudClaimEffect: false,
  mergeEffect: false,
  cleanupEffect: false,
  deploymentEffect: false,
});

export function buildRevisionIntentSupersessionEvidence(value = {}) {
  const pullRequest = object(value.pullRequest, "pull request");
  const git = object(value.git, "Git evidence");
  const lease = object(value.lease, "lease evidence");
  const revisionIntent = object(value.revisionIntent, "revision intent");
  const recovery = object(value.recovery, "recovery evidence");
  const runtime = object(value.runtime, "runtime evidence");
  const evidence = {
    schema: EVIDENCE_SCHEMA,
    repository: text(value.repository, "repository"),
    branch: text(value.branch, "branch"),
    sessionId: text(value.sessionId, "session"),
    pullRequest: {
      number: positive(pullRequest.number, "pull request number"),
      url: text(pullRequest.url, "pull request URL"),
      headSha: sha(pullRequest.headSha, "pull request head"),
      isDraft: pullRequest.isDraft === true,
    },
    git: {
      protectedMainSha: sha(git.protectedMainSha, "protected main"),
      remoteHeadSha: sha(git.remoteHeadSha, "remote head"),
      localHeadSha: sha(git.localHeadSha, "local head"),
      parentSha: sha(git.parentSha, "local parent"),
      remoteTreeSha: sha(git.remoteTreeSha, "remote tree"),
      localTreeSha: sha(git.localTreeSha, "local tree"),
      worktreeStateDigest: digest(git.worktreeStateDigest, "worktree state"),
    },
    lease: {
      leaseDigest: digest(lease.leaseDigest, "lease"),
      claimId: digest(lease.claimId, "current claim"),
      taskAuthorityBindingDigest: digest(
        lease.taskAuthorityBindingDigest,
        "task authority binding",
      ),
      manifestDigest: digest(lease.manifestDigest, "admission manifest"),
      writeSetDigest: digest(lease.writeSetDigest, "write set"),
    },
    revisionIntent: {
      intentDigest: digest(revisionIntent.intentDigest, "revision intent"),
      planDigest: digest(revisionIntent.planDigest, "revision plan"),
      sourceClaimId: digest(revisionIntent.sourceClaimId, "revision source claim"),
      sourceHeadSha: sha(revisionIntent.sourceHeadSha, "revision source head"),
    },
    recovery: {
      sourceCorrectionJournalDigest: digest(
        recovery.sourceCorrectionJournalDigest,
        "source-correction journal",
      ),
      sourceCorrectionReceiptDigest: digest(
        recovery.sourceCorrectionReceiptDigest,
        "source-correction receipt",
      ),
      fenceRecoveryJournalDigest: digest(
        recovery.fenceRecoveryJournalDigest,
        "fence-recovery journal",
      ),
      fenceRecoveryReceiptDigest: digest(
        recovery.fenceRecoveryReceiptDigest,
        "fence-recovery receipt",
      ),
      taskBindingReconciliationReceiptDigest: digest(
        recovery.taskBindingReconciliationReceiptDigest,
        "task-binding reconciliation receipt",
      ),
      predecessorClaimId: digest(recovery.predecessorClaimId, "predecessor claim"),
      successorClaimId: digest(recovery.successorClaimId, "successor claim"),
    },
    runtime: {
      digest: digest(runtime.digest, "controller runtime"),
      paths: paths(runtime.paths),
    },
  };
  if (!evidence.pullRequest.isDraft
    || evidence.pullRequest.headSha !== evidence.git.remoteHeadSha
    || evidence.git.parentSha !== evidence.git.remoteHeadSha
    || evidence.git.remoteTreeSha !== evidence.git.localTreeSha
    || evidence.revisionIntent.sourceHeadSha !== evidence.git.remoteHeadSha
    || evidence.revisionIntent.sourceClaimId !== evidence.recovery.predecessorClaimId
    || evidence.lease.claimId !== evidence.recovery.successorClaimId) {
    invalid("joined recovery chain");
  }
  return freeze({ ...evidence, evidenceDigest: digestValue(evidence) });
}

export function normalizeRevisionIntentSupersessionEvidence(value) {
  const rebuilt = buildRevisionIntentSupersessionEvidence(value);
  if (JSON.stringify(value) !== JSON.stringify(rebuilt)) invalid("evidence projection");
  return rebuilt;
}

export function buildRevisionIntentSupersessionPlan({ evidence } = {}) {
  const normalized = normalizeOrBuildEvidence(evidence);
  const core = {
    schema: PLAN_SCHEMA,
    operation: OPERATION,
    evidence: normalized,
    forbiddenEffects: Object.keys(ZERO_EFFECTS),
  };
  const planDigest = digestValue(core);
  return freeze({
    ...core,
    planDigest,
    exactAuthorization: `authorize ${OPERATION} ${planDigest}`,
  });
}

export function normalizeRevisionIntentSupersessionPlan(value) {
  if (value?.schema !== PLAN_SCHEMA || value.operation !== OPERATION) invalid("plan schema");
  const rebuilt = buildRevisionIntentSupersessionPlan({ evidence: value.evidence });
  if (JSON.stringify(value) !== JSON.stringify(rebuilt)) invalid("plan projection");
  return rebuilt;
}

export function authorizeRevisionIntentSupersession({ plan, authorization } = {}) {
  const normalized = normalizeRevisionIntentSupersessionPlan(plan);
  if (authorization !== normalized.exactAuthorization) {
    throw new Error(`Revision-intent supersession requires exact authorization: ${normalized.exactAuthorization}`);
  }
  const core = {
    schema: "agentic-task-authority-loss-incident-recovery-revision-intent-supersession-authorization/v1",
    planDigest: normalized.planDigest,
    statement: authorization,
  };
  return freeze({ ...core, authorizationDigest: digestValue(core) });
}

export function buildRevisionIntentSupersessionReceipt({
  plan,
  authorization,
  taskAuthorityReceiptDigest,
  supersededIntentDigest,
  currentLeaseDigest,
  completedAt,
} = {}) {
  const normalized = normalizeRevisionIntentSupersessionPlan(plan);
  const authority = authorizeRevisionIntentSupersession({ plan: normalized, authorization });
  const core = {
    schema: RECEIPT_SCHEMA,
    status: "superseded",
    planDigest: normalized.planDigest,
    planSnapshot: normalized,
    authorizationDigest: authority.authorizationDigest,
    taskAuthorityReceiptDigest: digest(taskAuthorityReceiptDigest, "task authority receipt"),
    supersededIntentDigest: digest(supersededIntentDigest, "superseded intent"),
    currentLeaseDigest: digest(currentLeaseDigest, "current lease"),
    predecessorClaimId: normalized.evidence.recovery.predecessorClaimId,
    successorClaimId: normalized.evidence.recovery.successorClaimId,
    sourceCorrectionReceiptDigest: normalized.evidence.recovery.sourceCorrectionReceiptDigest,
    fenceRecoveryReceiptDigest: normalized.evidence.recovery.fenceRecoveryReceiptDigest,
    taskBindingReconciliationReceiptDigest:
      normalized.evidence.recovery.taskBindingReconciliationReceiptDigest,
    remoteHeadSha: normalized.evidence.git.remoteHeadSha,
    localForwardChildSha: normalized.evidence.git.localHeadSha,
    controllerRuntimeDigest: normalized.evidence.runtime.digest,
    protectedMainSha: normalized.evidence.git.protectedMainSha,
    completedAt: timestamp(completedAt, "completion time"),
    ...ZERO_EFFECTS,
  };
  return freeze({ ...core, receiptDigest: digestValue(core) });
}

export function normalizeRevisionIntentSupersessionReceipt(value) {
  if (value?.schema !== RECEIPT_SCHEMA || value.status !== "superseded") invalid("receipt schema");
  const rebuilt = buildRevisionIntentSupersessionReceipt({
    plan: value.planSnapshot,
    authorization: value.planSnapshot?.exactAuthorization,
    taskAuthorityReceiptDigest: value.taskAuthorityReceiptDigest,
    supersededIntentDigest: value.supersededIntentDigest,
    currentLeaseDigest: value.currentLeaseDigest,
    completedAt: value.completedAt,
  });
  if (JSON.stringify(value) !== JSON.stringify(rebuilt)) invalid("receipt projection");
  return rebuilt;
}

function normalizeOrBuildEvidence(value) {
  return value?.evidenceDigest
    ? normalizeRevisionIntentSupersessionEvidence(value)
    : buildRevisionIntentSupersessionEvidence(value);
}
function object(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label); return value; }
function text(value, label) { if (typeof value !== "string" || !value || value !== value.trim()) invalid(label); return value; }
function positive(value, label) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) invalid(label); return number; }
function sha(value, label) { if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) invalid(label); return value; }
function digest(value, label) { if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) invalid(label); return value; }
function timestamp(value, label) { const normalized = text(value, label); if (!Number.isFinite(Date.parse(normalized))) invalid(label); return normalized; }
function paths(value) { if (!Array.isArray(value) || value.length === 0 || value.some(item => typeof item !== "string" || !item.startsWith("scripts/task-authority-loss-incident-recovery-"))) invalid("runtime paths"); return freeze([...value].sort()); }
function freeze(value) { return Object.freeze(value); }
function invalid(label) { throw new Error(`Task-authority-loss revision-intent supersession has invalid ${label}.`); }
