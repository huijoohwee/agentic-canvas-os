// Responsibility: Normalize the sealed plan, journal, and terminal receipt for one retrospective binding repair.
import { digestValue } from "./cloud-collaboration-primitives.mjs";

export const PLAN_SCHEMA = "agentic-active-publish-task-authority-successor-reconciliation-plan/v1";
export const RECEIPT_SCHEMA = "agentic-active-publish-task-authority-successor-reconciliation-receipt/v1";
export const PHASES = Object.freeze([
  "prepared", "task-authority-verified", "registry-attempted",
  "registry-projected", "verified", "complete",
]);
const DIGEST = /^[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40}$/u;

export function buildReconciliationPlan(evidence) {
  const normalizedEvidence = normalizeEvidence(evidence);
  const core = { schema: PLAN_SCHEMA, evidence: normalizedEvidence };
  return Object.freeze({ ...core, planDigest: digestValue(core) });
}

export function normalizeReconciliationPlan(value) {
  exactKeys(value, ["schema", "evidence", "planDigest"], "plan");
  if (value.schema !== PLAN_SCHEMA) invalid("plan schema");
  const plan = buildReconciliationPlan(value.evidence);
  if (plan.planDigest !== digest(value.planDigest, "plan digest")) invalid("plan digest");
  return plan;
}

export function operationForPlan(plan) {
  return `active-publish-task-authority-successor-reconciliation:${normalizeReconciliationPlan(plan).planDigest}`;
}

export function buildCompletion({ plan, taskAuthorityReceipt, projection, verifiedAt }) {
  const normalized = normalizeReconciliationPlan(plan);
  const core = {
    schema: RECEIPT_SCHEMA,
    planDigest: normalized.planDigest,
    sourceBindingDigest: normalized.evidence.source.bindingDigest,
    targetBindingDigest: digest(projection.targetBindingDigest, "target binding digest"),
    successorReceiptDigest: digest(projection.successorReceiptDigest, "successor receipt digest"),
    taskAuthorityReceiptDigest: digest(taskAuthorityReceipt.receiptDigest, "task authority receipt digest"),
    targetLeaseDigest: digest(projection.targetLeaseDigest, "target lease digest"),
    registryRevision: positive(projection.registryRevision, "registry revision"),
    verifiedAt: instant(verifiedAt, "verified at"),
    mutationSet: ["writer-lease-task-authority-continuation"],
    cloudMutation: false,
    providerMutation: false,
    gitMutation: false,
    sourceMutation: false,
    authoringAuthorityGranted: false,
  };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}

export function normalizeEvidence(value) {
  exactKeys(value, ["observedAt", "repository", "branch", "sessionId", "pullRequest", "canonical", "source", "target", "leaseDigest", "evidenceDigest"], "evidence");
  const core = {
    observedAt: instant(value.observedAt, "observed at"),
    repository: text(value.repository, "repository"),
    branch: text(value.branch, "branch"),
    sessionId: text(value.sessionId, "session"),
    pullRequest: normalizePullRequest(value.pullRequest),
    canonical: normalizeCanonical(value.canonical),
    source: normalizeSource(value.source),
    target: normalizeTarget(value.target),
    leaseDigest: digest(value.leaseDigest, "lease digest"),
  };
  const evidenceDigest = digestValue(core);
  if (value.evidenceDigest !== undefined && value.evidenceDigest !== evidenceDigest) invalid("evidence digest");
  return Object.freeze({ ...core, evidenceDigest });
}

function normalizePullRequest(value) {
  exactKeys(value, ["number", "id", "url", "state", "isDraft", "autoMergeRequest", "headRefName", "headRefOid", "baseRefName"], "pull request");
  if (value.state !== "OPEN" || value.isDraft !== true || value.autoMergeRequest !== null) invalid("draft pull request state");
  return Object.freeze({ number: positive(value.number, "pull request number"), id: text(value.id, "pull request id"), url: text(value.url, "pull request URL"), state: "OPEN", isDraft: true, autoMergeRequest: null, headRefName: text(value.headRefName, "head branch"), headRefOid: sha(value.headRefOid, "head SHA"), baseRefName: text(value.baseRefName, "base branch") });
}

function normalizeCanonical(value) {
  exactKeys(value, ["protectedRevision", "sourceBaseSha", "changedPaths", "changedPathsDigest"], "canonical advance");
  const changedPaths = sortedStrings(value.changedPaths, "changed paths");
  if (digestValue(changedPaths) !== value.changedPathsDigest) invalid("changed paths digest");
  return Object.freeze({ protectedRevision: sha(value.protectedRevision, "protected revision"), sourceBaseSha: sha(value.sourceBaseSha, "source base SHA"), changedPaths, changedPathsDigest: value.changedPathsDigest });
}

function normalizeSource(value) {
  exactKeys(value, ["claimId", "baseSha", "fenceSha", "bindingDigest", "laneBindingDigest", "leaseEpoch"], "source");
  return Object.freeze({ claimId: digest(value.claimId, "source claim"), baseSha: sha(value.baseSha, "source base"), fenceSha: sha(value.fenceSha, "source fence"), bindingDigest: digest(value.bindingDigest, "source binding"), laneBindingDigest: digest(value.laneBindingDigest, "source lane binding"), leaseEpoch: positive(value.leaseEpoch, "source lease epoch") });
}

function normalizeTarget(value) {
  exactKeys(value, ["claimId", "baseSha", "fenceSha", "operationReceiptDigest", "verificationReceiptDigest", "leaseEpoch", "predecessorClaimId", "cloudState"], "target");
  if (!new Set(["current", "dormant-preserved"]).has(value.cloudState)) invalid("target cloud state");
  return Object.freeze({ claimId: digest(value.claimId, "target claim"), baseSha: sha(value.baseSha, "target base"), fenceSha: sha(value.fenceSha, "target fence"), operationReceiptDigest: digest(value.operationReceiptDigest, "target operation receipt"), verificationReceiptDigest: digest(value.verificationReceiptDigest, "target verification receipt"), leaseEpoch: positive(value.leaseEpoch, "target lease epoch"), predecessorClaimId: digest(value.predecessorClaimId, "predecessor claim"), cloudState: value.cloudState });
}

function exactKeys(value, keys, label) { if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) invalid(label); }
function sortedStrings(value, label) { if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item)) invalid(label); const result = [...new Set(value)].sort(); if (result.length !== value.length || result.some((item, index) => item !== value[index])) invalid(label); return Object.freeze(result); }
function text(value, label) { if (typeof value !== "string" || !value.trim()) invalid(label); return value; }
function digest(value, label) { if (!DIGEST.test(String(value || ""))) invalid(label); return value; }
function sha(value, label) { if (!SHA.test(String(value || ""))) invalid(label); return value; }
function positive(value, label) { if (!Number.isSafeInteger(value) || value < 1) invalid(label); return value; }
function instant(value, label) { if (!value || new Date(value).toISOString() !== value) invalid(label); return value; }
function invalid(label) { throw new Error(`Active-publish task-authority successor reconciliation has invalid ${label}.`); }
