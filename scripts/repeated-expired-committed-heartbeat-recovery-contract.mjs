import { digestValue } from "./cloud-collaboration-primitives.mjs";

export const OPERATION = "repeated-expired-committed-heartbeat-recovery";
export const PLAN_SCHEMA = `agentic-${OPERATION}-plan/v1`;
export const INTENT_SCHEMA = `agentic-${OPERATION}-intent/v1`;
export const COMPLETION_SCHEMA = `agentic-${OPERATION}-completion/v1`;

const DIGEST = /^[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40}$/u;

export function buildRepeatedRecoveryPlan({ evidence } = {}) {
  const normalizedEvidence = normalizeEvidence(evidence);
  const core = Object.freeze({
    schema: PLAN_SCHEMA,
    operation: OPERATION,
    evidence: normalizedEvidence,
    mutationPolicy: Object.freeze({
      allowed: Object.freeze([
        "same-claim-cloud-continuation",
        "writer-lease-recovery-cas",
        "pull-request-hidden-marker-replacement",
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
  const rebuilt = buildRepeatedRecoveryPlan({ evidence: value.evidence });
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
    renewedClaimDigest: digest(finalEvidence?.renewedClaimDigest, "renewed claim"),
    renewedTransitionCounter: positive(finalEvidence?.renewedTransitionCounter, "renewed transition"),
    targetLeaseDigest: digest(finalEvidence?.targetLeaseDigest, "target lease"),
    targetMarkerDigest: digest(finalEvidence?.targetMarkerDigest, "target marker"),
    previousRecoveryDigest: normalized.evidence.previousRecoveryDigest,
    completedAt: instant(finalEvidence?.completedAt, "completedAt"),
    effects: Object.freeze({
      cloudContinuation: true,
      writerLeaseCas: true,
      pullRequestMarkerReplacement: true,
      source: false,
      gitRefs: false,
      commits: false,
      merge: false,
      deployment: false,
      cleanup: false,
    }),
  });
  return Object.freeze({
    ...completionCore,
    receiptDigest: digestValue(completionCore),
  });
}

function normalizeEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("evidence");
  return Object.freeze({
    repositoryId: text(value.repositoryId, "repository ID"),
    branch: text(value.branch, "branch"),
    sessionId: text(value.sessionId, "session"),
    pullRequestNumber: positive(value.pullRequestNumber, "pull request"),
    baseSha: sha(value.baseSha, "base SHA"),
    fenceSha: sha(value.fenceSha, "fence SHA"),
    headSha: sha(value.headSha, "head SHA"),
    remoteHeadSha: sha(value.remoteHeadSha, "remote head SHA"),
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
    writeSetDigest: digest(value.writeSetDigest, "write set"),
    expiresAt: instant(value.expiresAt, "expiry"),
  });
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
