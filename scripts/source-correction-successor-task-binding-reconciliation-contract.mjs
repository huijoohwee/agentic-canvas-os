// Responsibility: Seal one source-correction successor binding repair and its zero-effect receipt.
import { digestValue } from "./cloud-collaboration-primitives.mjs";

export const PLAN_SCHEMA =
  "agentic-source-correction-successor-task-binding-reconciliation-plan/v1";
export const RECEIPT_SCHEMA =
  "agentic-source-correction-successor-task-binding-reconciliation-receipt/v1";
export const REPAIR_SCHEMA =
  "agentic-source-correction-successor-task-binding-reconciliation-local-repair/v1";
export const AUTHORIZATION_PREFIX =
  "authorize source-correction-successor-task-binding-reconciliation";
export const ZERO_EFFECTS = Object.freeze({
  cloudEffect: false,
  pullRequestEffect: false,
  sourceEffect: false,
  gitEffect: false,
  mergeEffect: false,
  integrationEffect: false,
  deploymentEffect: false,
  authoringAuthorityGranted: false,
});

const DIGEST = /^[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40}$/u;

export function buildPlan(evidence) {
  const normalized = normalizeEvidence(evidence);
  const core = {
    schema: PLAN_SCHEMA,
    operation: "source-correction-successor-task-binding-reconciliation",
    evidence: normalized,
    mutationPolicy: {
      allowed: ["writer-lease-task-binding-continuation-repair"],
      ...ZERO_EFFECTS,
    },
  };
  return Object.freeze({ ...core, planDigest: digestValue(core) });
}

export function normalizePlan(value) {
  exactKeys(value, ["schema", "operation", "evidence", "mutationPolicy", "planDigest"], "plan");
  const planned = buildPlan(value.evidence);
  if (value.schema !== PLAN_SCHEMA || value.operation !== planned.operation
    || digestValue(value.mutationPolicy) !== digestValue(planned.mutationPolicy)
    || value.planDigest !== planned.planDigest) invalid("plan");
  return planned;
}

export function replayDigest(value) {
  const evidence = normalizeEvidence(value);
  const { observedAt: _observedAt, evidenceDigest: _evidenceDigest, ...stable } = evidence;
  return digestValue(stable);
}

export function operation(plan) {
  return `source-correction-successor-task-binding-reconciliation:${normalizePlan(plan).planDigest}`;
}

export function buildReceipt({ plan, repair, terminal }) {
  const sealed = normalizePlan(plan);
  const projected = normalizeRepair(repair);
  const verified = normalizeTerminal(terminal);
  if (projected.planDigest !== sealed.planDigest
    || projected.targetBindingDigest !== verified.targetBindingDigest
    || projected.receiptDigest !== verified.repairReceiptDigest) {
    invalid("terminal receipt join");
  }
  const core = {
    schema: RECEIPT_SCHEMA,
    planDigest: sealed.planDigest,
    branch: sealed.evidence.branch,
    predecessorClaimId: sealed.evidence.predecessorClaimId,
    successorClaimId: sealed.evidence.successorClaimId,
    sourceBindingDigest: sealed.evidence.sourceBindingDigest,
    targetBindingDigest: projected.targetBindingDigest,
    sourceLeaseDigest: sealed.evidence.sourceLeaseDigest,
    targetLeaseDigest: verified.targetLeaseDigest,
    registryRevision: verified.registryRevision,
    repairReceiptDigest: projected.receiptDigest,
    verifiedAt: verified.verifiedAt,
    ...ZERO_EFFECTS,
  };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}

export function normalizeEvidence(value) {
  exactKeys(value, [
    "observedAt", "repository", "branch", "sessionId", "worktreePath",
    "localHeadSha", "remoteHeadSha", "pullRequest", "sourceLeaseDigest",
    "sourceBindingDigest", "predecessorClaimId", "successorClaimId",
    "successorLeaseEpoch", "sourceCorrection", "markerDigest", "terminalRepair",
    "evidenceDigest",
  ], "evidence");
  const core = {
    observedAt: instant(value.observedAt, "observed at"),
    repository: text(value.repository, "repository"),
    branch: text(value.branch, "branch"),
    sessionId: text(value.sessionId, "session"),
    worktreePath: text(value.worktreePath, "worktree path"),
    localHeadSha: sha(value.localHeadSha, "local head"),
    remoteHeadSha: sha(value.remoteHeadSha, "remote head"),
    pullRequest: normalizePullRequest(value.pullRequest),
    sourceLeaseDigest: digest(value.sourceLeaseDigest, "source lease"),
    sourceBindingDigest: digest(value.sourceBindingDigest, "source binding"),
    predecessorClaimId: digest(value.predecessorClaimId, "predecessor claim"),
    successorClaimId: digest(value.successorClaimId, "successor claim"),
    successorLeaseEpoch: positive(value.successorLeaseEpoch, "successor epoch"),
    sourceCorrection: normalizeSourceCorrection(value.sourceCorrection),
    markerDigest: digest(value.markerDigest, "marker digest"),
    terminalRepair: value.terminalRepair === null ? null : normalizeRepair(value.terminalRepair),
  };
  if (core.pullRequest.headSha !== core.remoteHeadSha
    || core.pullRequest.state !== "OPEN" || core.pullRequest.isDraft !== true
    || core.sourceCorrection.sourceClaimId !== core.predecessorClaimId
    || core.sourceCorrection.successorClaimId !== core.successorClaimId
    || core.sourceCorrection.leaseDigest !== core.sourceLeaseDigest) {
    invalid("source-correction subject");
  }
  const evidenceDigest = digestValue(core);
  if (value.evidenceDigest !== undefined && value.evidenceDigest !== evidenceDigest) {
    invalid("evidence digest");
  }
  return Object.freeze({ ...core, evidenceDigest });
}

export function normalizeRepair(value) {
  exactKeys(value, [
    "schema", "status", "planDigest", "branch", "predecessorClaimId",
    "successorClaimId", "sourceBindingDigest", "targetBindingDigest",
    "sourceLeaseDigest", "taskAuthorityReceiptDigest", "reconciledAt",
    ...Object.keys(ZERO_EFFECTS), "receiptDigest",
  ], "repair");
  const core = {
    schema: value.schema,
    status: value.status,
    planDigest: digest(value.planDigest, "repair plan"),
    branch: text(value.branch, "repair branch"),
    predecessorClaimId: digest(value.predecessorClaimId, "repair predecessor"),
    successorClaimId: digest(value.successorClaimId, "repair successor"),
    sourceBindingDigest: digest(value.sourceBindingDigest, "repair source binding"),
    targetBindingDigest: digest(value.targetBindingDigest, "repair target binding"),
    sourceLeaseDigest: digest(value.sourceLeaseDigest, "repair source lease"),
    taskAuthorityReceiptDigest: digest(value.taskAuthorityReceiptDigest, "task authority receipt"),
    reconciledAt: instant(value.reconciledAt, "reconciled at"),
    ...ZERO_EFFECTS,
  };
  if (core.schema !== REPAIR_SCHEMA || core.status !== "reconciled"
    || Object.keys(ZERO_EFFECTS).some(key => value[key] !== false)
    || value.receiptDigest !== digestValue(core)) invalid("repair");
  return Object.freeze({ ...core, receiptDigest: value.receiptDigest });
}

export function normalizeTerminal(value) {
  exactKeys(value, [
    "targetBindingDigest", "targetLeaseDigest", "registryRevision",
    "repairReceiptDigest", "verifiedAt", ...Object.keys(ZERO_EFFECTS),
  ], "terminal");
  if (Object.keys(ZERO_EFFECTS).some(key => value[key] !== false)) invalid("terminal effects");
  return Object.freeze({
    targetBindingDigest: digest(value.targetBindingDigest, "terminal binding"),
    targetLeaseDigest: digest(value.targetLeaseDigest, "terminal lease"),
    registryRevision: positive(value.registryRevision, "terminal revision"),
    repairReceiptDigest: digest(value.repairReceiptDigest, "terminal repair"),
    verifiedAt: instant(value.verifiedAt, "verified at"),
    ...ZERO_EFFECTS,
  });
}

function normalizePullRequest(value) {
  exactKeys(value, ["number", "url", "state", "isDraft", "headBranch", "headSha", "bodyDigest"], "pull request");
  return Object.freeze({
    number: positive(value.number, "pull request number"),
    url: text(value.url, "pull request URL"),
    state: text(value.state, "pull request state"),
    isDraft: value.isDraft === true,
    headBranch: text(value.headBranch, "pull request branch"),
    headSha: sha(value.headSha, "pull request head"),
    bodyDigest: digest(value.bodyDigest, "pull request body"),
  });
}

function normalizeSourceCorrection(value) {
  exactKeys(value, [
    "planDigest", "sourceClaimId", "successorClaimId", "sourceHeadSha",
    "leaseDigest", "receiptDigest",
  ], "source correction");
  return Object.freeze({
    planDigest: digest(value.planDigest, "source-correction plan"),
    sourceClaimId: digest(value.sourceClaimId, "source-correction source claim"),
    successorClaimId: digest(value.successorClaimId, "source-correction successor"),
    sourceHeadSha: sha(value.sourceHeadSha, "source-correction head"),
    leaseDigest: digest(value.leaseDigest, "source-correction lease"),
    receiptDigest: digest(value.receiptDigest, "source-correction receipt"),
  });
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) invalid(label);
}
function text(value, label) { if (typeof value !== "string" || !value.trim()) invalid(label); return value; }
function digest(value, label) { if (!DIGEST.test(String(value || ""))) invalid(label); return value; }
function sha(value, label) { if (!SHA.test(String(value || ""))) invalid(label); return value; }
function positive(value, label) { if (!Number.isSafeInteger(value) || value < 1) invalid(label); return value; }
function instant(value, label) { if (!value || new Date(value).toISOString() !== value) invalid(label); return value; }
function invalid(label) { throw new Error(`Source-correction successor binding reconciliation has invalid ${label}.`); }
