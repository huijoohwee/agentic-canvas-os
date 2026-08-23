import { digestValue, normalizeWriteSet } from "./cloud-collaboration-primitives.mjs";

export const OPERATION = "repeated-expired-committed-heartbeat-recovery";
export const PLAN_SCHEMA = `agentic-${OPERATION}-plan/v1`;
export const INTENT_SCHEMA = `agentic-${OPERATION}-intent/v1`;
export const COMPLETION_SCHEMA = `agentic-${OPERATION}-completion/v1`;

const DIGEST = /^[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40}$/u;

export function buildRepeatedRecoveryPlan({ evidence, targetManifest } = {}) {
  const normalizedEvidence = normalizeEvidence(evidence);
  const target = normalizeManifest(targetManifest, normalizedEvidence.semanticScope);
  if (!strictSubset(normalizedEvidence.sourceDeclaredWriteSet, target.declaredWriteSet)) {
    invalid("target write set must be a strict source superset");
  }
  if (!normalizedEvidence.authoredPaths.every(item => covers(target.declaredWriteSet, item))) {
    invalid("target write set must cover every protected-refresh authored path");
  }
  const core = Object.freeze({
    schema: PLAN_SCHEMA,
    operation: OPERATION,
    evidence: normalizedEvidence,
    target,
    mutationPolicy: Object.freeze({
      allowed: Object.freeze([
        "cloud-successor-claim",
        "cloud-source-retirement",
        "cloud-successor-promotion",
        "cloud-review-binding",
        "writer-lease-recovery-cas",
        "task-authority-successor-binding",
        "pull-request-hidden-marker-replacement",
        "private-replay-journal",
      ]),
      sourceEffect: false,
      gitRefEffect: false,
      commitEffect: false,
      mergeEffect: false,
      deploymentEffect: false,
      cleanupEffect: false,
    }),
  });
  const planDigest = digestValue(core);
  return Object.freeze({
    ...core,
    planDigest,
    exactAuthorization: `authorize ${OPERATION} ${planDigest}`,
  });
}

export function normalizeRepeatedRecoveryPlan(value) {
  if (value?.schema !== PLAN_SCHEMA || value.operation !== OPERATION) invalid("plan schema");
  const rebuilt = buildRepeatedRecoveryPlan({
    evidence: value.evidence,
    targetManifest: value.target,
  });
  if (JSON.stringify(value) !== JSON.stringify(rebuilt)) invalid("plan projection");
  return rebuilt;
}

export function authorizeRepeatedRecovery({ plan, authorization } = {}) {
  const normalized = normalizeRepeatedRecoveryPlan(plan);
  if (authorization !== normalized.exactAuthorization) invalid("exact authorization");
  return Object.freeze({
    schema: `agentic-${OPERATION}-authorization/v1`,
    planDigest: normalized.planDigest,
    statement: authorization,
    authorizationDigest: digestValue(authorization),
  });
}

export function buildRepeatedRecoveryCompletion({ plan, intent, finalEvidence } = {}) {
  const normalized = normalizeRepeatedRecoveryPlan(plan);
  if (intent?.schema !== INTENT_SCHEMA || intent.planDigest !== normalized.planDigest
    || intent.status !== "marker-projected") invalid("terminal intent");
  const completionCore = Object.freeze({
    schema: COMPLETION_SCHEMA,
    operation: OPERATION,
    planDigest: normalized.planDigest,
    sourceClaimId: normalized.evidence.claimId,
    successorClaimId: digest(finalEvidence?.successorClaimId, "successor claim"),
    successorClaimDigest: digest(finalEvidence?.successorClaimDigest, "successor claim digest"),
    successorTransitionCounter: positive(finalEvidence?.successorTransitionCounter,
      "successor transition"),
    targetWriteSetDigest: normalized.target.writeSetDigest,
    targetLeaseDigest: digest(finalEvidence?.targetLeaseDigest, "target lease"),
    targetTaskBindingDigest: digest(finalEvidence?.targetTaskBindingDigest,
      "target task binding"),
    targetMarkerDigest: digest(finalEvidence?.targetMarkerDigest, "target marker"),
    previousRecoveryDigest: normalized.evidence.previousRecoveryDigest,
    completedAt: instant(finalEvidence?.completedAt, "completedAt"),
    effects: Object.freeze({
      cloudSuccessor: true,
      writerLeaseCas: true,
      taskAuthoritySuccessorBinding: true,
      pullRequestMarkerReplacement: true,
      source: false,
      gitRefs: false,
      commits: false,
      merge: false,
      deployment: false,
      cleanup: false,
    }),
  });
  return Object.freeze({ ...completionCore, receiptDigest: digestValue(completionCore) });
}

function normalizeEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("evidence");
  const sourceDeclaredWriteSet = normalizeWriteSet(value.sourceDeclaredWriteSet);
  if (digestValue(sourceDeclaredWriteSet) !== value.sourceWriteSetDigest) {
    invalid("source write-set digest");
  }
  return Object.freeze({
    repositoryId: text(value.repositoryId, "repository ID"),
    branch: text(value.branch, "branch"),
    sessionId: text(value.sessionId, "session"),
    semanticScope: text(value.semanticScope, "semantic scope"),
    pullRequestNumber: positive(value.pullRequestNumber, "pull request"),
    reviewRequestId: text(value.reviewRequestId, "review request"),
    baseSha: sha(value.baseSha, "base SHA"),
    fenceSha: sha(value.fenceSha, "fence SHA"),
    headSha: sha(value.headSha, "head SHA"),
    remoteHeadSha: sha(value.remoteHeadSha, "remote head SHA"),
    protectedParentSha: sha(value.protectedParentSha, "protected parent SHA"),
    claimId: digest(value.claimId, "claim ID"),
    claimDigest: digest(value.claimDigest, "claim digest"),
    cloudTransitionCounter: positive(value.cloudTransitionCounter, "cloud transition"),
    leaseEpoch: positive(value.leaseEpoch, "lease epoch"),
    leaseDigest: digest(value.leaseDigest, "lease digest"),
    taskBindingDigest: digest(value.taskBindingDigest, "task binding"),
    previousRecoveryDigest: digest(value.previousRecoveryDigest, "previous recovery"),
    sourceMarkerDigest: digest(value.sourceMarkerDigest, "source marker"),
    pullRequestBodyDigest: digest(value.pullRequestBodyDigest, "pull request body"),
    snapshotDigest: digest(value.snapshotDigest, "snapshot"),
    sourceDeclaredWriteSet,
    sourceWriteSetDigest: digest(value.sourceWriteSetDigest, "source write set"),
    sourceManifestDigest: digest(value.sourceManifestDigest, "source manifest"),
    authoredPaths: paths(value.authoredPaths, "authored paths"),
    rangeDiffDigest: digest(value.rangeDiffDigest, "range diff"),
    controllerDigest: digest(value.controllerDigest, "protected controller"),
    expiresAt: instant(value.expiresAt, "expiry"),
  });
}

function normalizeManifest(value, expectedScope) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("target manifest");
  const declaredWriteSet = normalizeWriteSet(value.declaredWriteSet
    || (value.paths || []).map(item => `path:${item}`).concat(`semantic:${value.semanticScope}`));
  const semanticScope = text(value.semanticScope, "target semantic scope");
  if (semanticScope !== expectedScope
    || !declaredWriteSet.includes(`semantic:${expectedScope}`)) invalid("target semantic scope");
  const writeSetDigest = value.writeSetDigest || digestValue(declaredWriteSet);
  const manifestDigest = value.manifestDigest || digestValue({
    schema: value.schema,
    semanticScope,
    declaredWriteSet,
  });
  if (writeSetDigest !== digestValue(declaredWriteSet)) invalid("target write-set digest");
  return Object.freeze({
    schema: "agentic-declared-write-scope/v1",
    semanticScope,
    declaredWriteSet,
    writeSetDigest: digest(writeSetDigest, "target write set"),
    manifestDigest: digest(manifestDigest, "target manifest"),
  });
}

function strictSubset(left, right) {
  return left.length < right.length && left.every(item => right.includes(item));
}

function covers(writeSet, item) {
  return writeSet.some(entry => entry.startsWith("path:")
    && (entry.slice(5) === "." || item === entry.slice(5)
      || item.startsWith(`${entry.slice(5)}/`)));
}

function paths(value, label) {
  if (!Array.isArray(value) || value.length === 0) invalid(label);
  return Object.freeze([...new Set(value.map(item => text(item, label)))].sort());
}

function digest(value, label) {
  if (!DIGEST.test(String(value || ""))) invalid(label);
  return value;
}

function sha(value, label) {
  if (!SHA.test(String(value || ""))) invalid(label);
  return value;
}

function text(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) invalid(label);
  return normalized;
}

function positive(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) invalid(label);
  return value;
}

function instant(value, label) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) invalid(label);
  return value;
}

function invalid(label) {
  throw new Error(`Repeated expired committed heartbeat recovery has invalid ${label}.`);
}
