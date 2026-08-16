// Responsibility: Seal the exact reviewed-successor response-loss subject and its projection-only receipt.
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import { assertTaskAuthorityBinding } from "./task-bound-lane-authority-contract.mjs";

export const PLAN_SCHEMA = "agentic-reviewed-successor-projection-response-loss-plan/v1";
export const RECEIPT_SCHEMA = "agentic-reviewed-successor-projection-response-loss-receipt/v1";
export const AUTHORIZATION_PREFIX = "authorize reviewed-successor-projection-response-loss";
export const PHASES = Object.freeze([
  "prepared", "task-authority-verified", "projection-attempted", "projected", "verified", "complete",
]);
export const MUTATION_POLICY = Object.freeze({
  allowed: Object.freeze(["writer-lease-task-binding-cloud-authority-projection", "pull-request-authority-marker-projection"]),
  sourceMutation: false,
  cloudMutation: false,
  gitRefMutation: false,
  mergeMutation: false,
  integrationMutation: false,
  deployMutation: false,
  authoringAuthorityGranted: false,
});
export const PARTIAL_LOCAL_MUTATION_POLICY = Object.freeze({
  allowed: Object.freeze(["writer-lease-task-binding-continuation-repair"]),
  sourceMutation: false, cloudMutation: false, pullRequestMutation: false,
  gitRefMutation: false, mergeMutation: false, integrationMutation: false,
  deployMutation: false, authoringAuthorityGranted: false,
});

const DIGEST = /^[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40}$/u;

export function buildReviewedSuccessorProjectionResponseLossPlan(evidence) {
  const normalizedEvidence = normalizeReviewedSuccessorProjectionResponseLossEvidence(evidence);
  const mutationPolicy = normalizedEvidence.mode === "partial-local-successor" ? PARTIAL_LOCAL_MUTATION_POLICY : MUTATION_POLICY;
  const core = { schema: PLAN_SCHEMA, evidence: normalizedEvidence, mutationPolicy };
  return Object.freeze({ ...core, planDigest: digestValue(core) });
}

export function normalizeReviewedSuccessorProjectionResponseLossPlan(value) {
  exactKeys(value, ["schema", "evidence", "mutationPolicy", "planDigest"], "plan");
  const plan = buildReviewedSuccessorProjectionResponseLossPlan(value.evidence);
  if (value.schema !== PLAN_SCHEMA || digestValue(value.mutationPolicy) !== digestValue(plan.mutationPolicy)) invalid("plan policy");
  if (plan.planDigest !== digest(value.planDigest, "plan digest")) invalid("plan digest");
  return plan;
}

export function reviewedSuccessorProjectionResponseLossOperation(plan) {
  return `reviewed-successor-projection-response-loss:${normalizeReviewedSuccessorProjectionResponseLossPlan(plan).planDigest}`;
}

export function reviewedSuccessorProjectionResponseLossReplayDigest(value) {
  const evidence = normalizeReviewedSuccessorProjectionResponseLossEvidence(value);
  const { observedAt: _observedAt, evidenceDigest: _evidenceDigest, ...subject } = evidence;
  return digestValue(subject);
}

export function isExactPartialLocalTerminalAdoption(planEvidence, liveEvidence) {
  const planned = normalizeReviewedSuccessorProjectionResponseLossEvidence(planEvidence);
  const live = normalizeReviewedSuccessorProjectionResponseLossEvidence(liveEvidence);
  if (planned.mode !== "partial-local-successor" || live.mode !== "partial-local-successor" || live.partialLocal.projectionState !== "repaired") return false;
  const stable = evidence => {
    const { observedAt: _observedAt, evidenceDigest: _evidenceDigest, partialLocal, local, ...rest } = evidence;
    const { taskBindingDigest: _taskBindingDigest, leaseDigest: _leaseDigest, ...stableLocal } = local;
    return { ...rest, local: stableLocal, partialLocal: { stableLeaseDigest: partialLocal.stableLeaseDigest, sourceBindingDigest: partialLocal.sourceBindingDigest } };
  };
  return digestValue(stable(planned)) === digestValue(stable(live))
    && live.partialLocal.repair.predecessorClaimId === planned.predecessor.claimId
    && live.partialLocal.repair.successorClaimId === planned.successor.claimId
    && live.partialLocal.repair.sourceBindingDigest === planned.partialLocal.sourceBindingDigest;
}

export function buildReviewedSuccessorProjectionResponseLossReceipt({ plan, taskAuthorityReceipt, projection, terminal }) {
  const normalized = normalizeReviewedSuccessorProjectionResponseLossPlan(plan);
  const verified = normalizeTerminal(terminal);
  const projected = normalizeProjectedProjection(projection);
  if (verified.targetLeaseDigest !== projected.targetLeaseDigest || verified.targetMarkerDigest !== projected.targetMarkerDigest || verified.registryRevision !== projected.registryRevision) invalid("terminal projection");
  const partialLocalRepairReceiptDigest = normalized.evidence.mode === "partial-local-successor"
    ? normalizePartialRepair(projected.successorReceipt).receiptDigest : null;
  const core = {
    schema: RECEIPT_SCHEMA,
    planDigest: normalized.planDigest,
    predecessorClaimId: normalized.evidence.predecessor.claimId,
    successorClaimId: normalized.evidence.successor.claimId,
    taskAuthorityReceiptDigest: digest(taskAuthorityReceipt?.receiptDigest, "task authority receipt digest"),
    targetBindingDigest: projected.targetBindingDigest,
    successorReceiptDigest: projected.successorReceiptDigest,
    partialLocalRepairReceiptDigest,
    targetLeaseDigest: projected.targetLeaseDigest,
    targetMarkerDigest: projected.targetMarkerDigest,
    registryRevision: projected.registryRevision,
    verifiedAt: verified.verifiedAt,
    mutationPolicy: normalized.mutationPolicy,
  };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}

export function normalizeReviewedSuccessorProjectionResponseLossEvidence(value) {
  exactKeys(value, ["mode", "observedAt", "repository", "actorId", "workItemId", "branch", "sessionId", "local", "remoteHeadSha", "pullRequest", "predecessor", "successor", "partialLocal", "evidenceDigest"], "evidence");
  if (!new Set(["absent-predecessor", "partial-local-successor"]).has(value.mode)) invalid("mode");
  const core = {
    mode: value.mode,
    observedAt: instant(value.observedAt, "observed at"),
    repository: text(value.repository, "repository"),
    actorId: text(value.actorId, "actor"),
    workItemId: text(value.workItemId, "work item"),
    branch: text(value.branch, "branch"),
    sessionId: text(value.sessionId, "session"),
    local: normalizeLocal(value.local, value.mode),
    remoteHeadSha: sha(value.remoteHeadSha, "remote head"),
    pullRequest: normalizePullRequest(value.pullRequest),
    predecessor: normalizePredecessor(value.predecessor),
    successor: normalizeSuccessor(value.successor),
    partialLocal: normalizePartialLocal(value.partialLocal, value.mode),
  };
  assertExactSubject(core);
  const evidenceDigest = digestValue(core);
  if (value.evidenceDigest !== undefined && value.evidenceDigest !== evidenceDigest) invalid("evidence digest");
  return Object.freeze({ ...core, evidenceDigest });
}

export function normalizePreparedProjection(value) {
  exactKeys(value, ["expectedLeaseDigest", "expectedMarkerDigest", "expectedSuccessorClaimId", "binding", "successorReceipt", "targetCloudAuthority"], "prepared projection");
  return Object.freeze({
    expectedLeaseDigest: digest(value.expectedLeaseDigest, "expected lease digest"),
    expectedMarkerDigest: digest(value.expectedMarkerDigest, "expected marker digest"),
    expectedSuccessorClaimId: digest(value.expectedSuccessorClaimId, "expected successor claim"),
    binding: record(value.binding, "task binding"),
    successorReceipt: record(value.successorReceipt, "successor receipt"),
    targetCloudAuthority: record(value.targetCloudAuthority, "target cloud authority"),
  });
}

export function normalizeProjectedProjection(value) {
  const prepared = normalizePreparedProjection(pick(value, ["expectedLeaseDigest", "expectedMarkerDigest", "expectedSuccessorClaimId", "binding", "successorReceipt", "targetCloudAuthority"]));
  exactKeys(value, [...Object.keys(prepared), "taskAuthorityReceiptDigest", "targetBindingDigest", "successorReceiptDigest", "targetLeaseDigest", "targetMarkerDigest", "registryRevision"], "projected projection");
  return Object.freeze({ ...prepared, taskAuthorityReceiptDigest: digest(value.taskAuthorityReceiptDigest, "task authority receipt digest"), targetBindingDigest: digest(value.targetBindingDigest, "target binding digest"), successorReceiptDigest: digest(value.successorReceiptDigest, "successor receipt digest"), targetLeaseDigest: digest(value.targetLeaseDigest, "target lease digest"), targetMarkerDigest: digest(value.targetMarkerDigest, "target marker digest"), registryRevision: positive(value.registryRevision, "registry revision") });
}

export function normalizeTerminal(value) {
  exactKeys(value, ["targetLeaseDigest", "targetMarkerDigest", "registryRevision", "verifiedAt"], "terminal");
  return Object.freeze({ targetLeaseDigest: digest(value.targetLeaseDigest, "terminal lease digest"), targetMarkerDigest: digest(value.targetMarkerDigest, "terminal marker digest"), registryRevision: positive(value.registryRevision, "terminal registry revision"), verifiedAt: instant(value.verifiedAt, "terminal verified at") });
}

function normalizeLocal(value, mode) {
  exactKeys(value, ["status", "admissionStatus", "clean", "baseSha", "headSha", "writeSetDigest", "reviewRequestId", "leaseEpoch", "claimId", "taskBindingDigest", "leaseDigest", "markerDigest"], "local lease");
  const allowedStatuses = mode === "partial-local-successor"
    ? new Set(["active", "review_ready"])
    : new Set(["review_ready"]);
  if (!allowedStatuses.has(value.status) || value.admissionStatus !== "admitted" || value.clean !== true) invalid("clean local lease state");
  return Object.freeze({ status: value.status, admissionStatus: value.admissionStatus, clean: true, baseSha: sha(value.baseSha, "local base"), headSha: sha(value.headSha, "local head"), writeSetDigest: digest(value.writeSetDigest, "local write set"), reviewRequestId: text(value.reviewRequestId, "local review request"), leaseEpoch: positive(value.leaseEpoch, "local lease epoch"), claimId: digest(value.claimId, "local claim"), taskBindingDigest: digest(value.taskBindingDigest, "local task binding"), leaseDigest: digest(value.leaseDigest, "local lease digest"), markerDigest: digest(value.markerDigest, "local marker digest") });
}

function normalizePullRequest(value) {
  exactKeys(value, ["number", "id", "url", "state", "isDraft", "autoMergeRequest", "headRefName", "headRefOid", "baseRefName", "markerClaimId", "markerLeaseEpoch", "markerDigest"], "pull request");
  if (value.state !== "OPEN" || value.autoMergeRequest !== null) invalid("pull request state");
  return Object.freeze({ number: positive(value.number, "pull request number"), id: text(value.id, "pull request id"), url: text(value.url, "pull request URL"), state: "OPEN", isDraft: Boolean(value.isDraft), autoMergeRequest: null, headRefName: text(value.headRefName, "pull request head branch"), headRefOid: sha(value.headRefOid, "pull request head"), baseRefName: text(value.baseRefName, "pull request base branch"), markerClaimId: digest(value.markerClaimId, "marker claim"), markerLeaseEpoch: positive(value.markerLeaseEpoch, "marker lease epoch"), markerDigest: digest(value.markerDigest, "pull request marker digest") });
}

function normalizePredecessor(value) {
  exactKeys(value, ["claimId", "cloudInventoryMatches", "leaseEpoch"], "predecessor");
  if (value.cloudInventoryMatches !== 0) invalid("absent predecessor cloud claim");
  return Object.freeze({ claimId: digest(value.claimId, "predecessor claim"), cloudInventoryMatches: 0, leaseEpoch: positive(value.leaseEpoch, "predecessor lease epoch") });
}

function normalizeSuccessor(value) {
  exactKeys(value, ["cloudInventoryMatches", "claimId", "predecessorClaimId", "state", "actorId", "repository", "workItemId", "canonicalBaseSha", "laneRevision", "writeSetDigest", "reviewRequestId", "leaseEpoch", "integrationState", "operationReceiptDigest", "verificationReceiptDigest", "authorityDigest"], "successor");
  if (value.cloudInventoryMatches !== 1 || !new Set(["active", "reviewed", "dormant-preserved"]).has(value.state) || value.integrationState !== "not-integrated") invalid("unique reviewed successor cloud claim");
  return Object.freeze({ cloudInventoryMatches: 1, claimId: digest(value.claimId, "successor claim"), predecessorClaimId: digest(value.predecessorClaimId, "successor predecessor"), state: value.state, actorId: text(value.actorId, "successor actor"), repository: text(value.repository, "successor repository"), workItemId: text(value.workItemId, "successor work item"), canonicalBaseSha: sha(value.canonicalBaseSha, "successor base"), laneRevision: sha(value.laneRevision, "successor head"), writeSetDigest: digest(value.writeSetDigest, "successor write set"), reviewRequestId: text(value.reviewRequestId, "successor review request"), leaseEpoch: positive(value.leaseEpoch, "successor lease epoch"), integrationState: value.integrationState, operationReceiptDigest: digest(value.operationReceiptDigest, "successor operation receipt"), verificationReceiptDigest: digest(value.verificationReceiptDigest, "successor verification receipt"), authorityDigest: digest(value.authorityDigest, "successor authority digest") });
}

function normalizePartialLocal(value, mode) {
  if (mode === "absent-predecessor") {
    if (value !== null) invalid("absent-predecessor partial-local projection");
    return null;
  }
  exactKeys(value, ["projectionState", "stableLeaseDigest", "actualLease", "bindingSourceLease", "sourceBindingDigest", "repair"], "partial-local projection");
  if (!new Set(["pending", "repaired"]).has(value.projectionState)) invalid("partial-local projection state");
  const actualLease = record(value.actualLease, "actual successor lease");
  const stableLeaseDigest = digest(value.stableLeaseDigest, "stable lease digest");
  if (stableLeaseDigest !== stableLeaseSubjectDigest(actualLease)) invalid("stable lease digest");
  const sourceBindingDigest = digest(value.sourceBindingDigest, "source binding digest");
  if (value.projectionState === "pending") {
    const bindingSourceLease = record(value.bindingSourceLease, "binding source lease");
    if (value.repair !== null || actualLease.reviewedSuccessorPartialLocalProjectionRepair !== undefined) invalid("pending repair state");
    const expected = { ...actualLease, cloudAuthority: { ...actualLease.cloudAuthority, claimId: null } };
    const actualSource = { ...bindingSourceLease, cloudAuthority: { ...bindingSourceLease.cloudAuthority, claimId: null } };
    if (canonicalJson(expected) !== canonicalJson(actualSource)) invalid("binding source reconstruction");
    if (bindingSourceLease.taskAuthority?.bindingDigest !== sourceBindingDigest) invalid("retained task binding digest");
    assertTaskAuthorityBinding({ binding: bindingSourceLease.taskAuthority, lease: bindingSourceLease });
    return Object.freeze({ projectionState: "pending", stableLeaseDigest, actualLease: Object.freeze(actualLease), bindingSourceLease: Object.freeze(bindingSourceLease), sourceBindingDigest, repair: null });
  }
  if (value.bindingSourceLease !== null) invalid("terminal binding source lease");
  const repair = normalizePartialRepair(value.repair);
  if (actualLease.reviewedSuccessorPartialLocalProjectionRepair?.receiptDigest !== repair.receiptDigest || repair.sourceBindingDigest !== sourceBindingDigest || actualLease.taskAuthority?.bindingDigest !== repair.targetBindingDigest || actualLease.taskAuthority?.priorBindingDigest !== sourceBindingDigest) invalid("terminal repair projection");
  return Object.freeze({ projectionState: "repaired", stableLeaseDigest, actualLease: Object.freeze(actualLease), bindingSourceLease: null, sourceBindingDigest, repair });
}

function normalizePartialRepair(value) {
  const keys = ["schema", "status", "evidenceDigest", "branch", "predecessorClaimId", "successorClaimId", "sourceBindingDigest", "targetBindingDigest", "boundAt", "cloudEffect", "pullRequestEffect", "gitEffect", "sourceEffect", "integrationEffect", "deploymentEffect", "receiptDigest"];
  exactKeys(value, keys, "partial-local repair receipt");
  if (value.schema !== "agentic-reviewed-successor-partial-local-projection-repair/v1" || value.status !== "repaired") invalid("partial-local repair receipt");
  for (const key of ["cloudEffect", "pullRequestEffect", "gitEffect", "sourceEffect", "integrationEffect", "deploymentEffect"]) if (value[key] !== false) invalid("partial-local repair effects");
  const core = { schema: value.schema, status: value.status, evidenceDigest: digest(value.evidenceDigest, "repair evidence digest"), branch: text(value.branch, "repair branch"), predecessorClaimId: digest(value.predecessorClaimId, "repair predecessor"), successorClaimId: digest(value.successorClaimId, "repair successor"), sourceBindingDigest: digest(value.sourceBindingDigest, "repair source binding"), targetBindingDigest: digest(value.targetBindingDigest, "repair target binding"), boundAt: instant(value.boundAt, "repair bound at"), cloudEffect: false, pullRequestEffect: false, gitEffect: false, sourceEffect: false, integrationEffect: false, deploymentEffect: false };
  if (digestValue(core) !== digest(value.receiptDigest, "repair receipt digest")) invalid("repair receipt digest");
  return Object.freeze({ ...core, receiptDigest: value.receiptDigest });
}

function assertExactSubject(value) {
  const { local, pullRequest, predecessor, successor, partialLocal } = value;
  if (value.mode === "absent-predecessor" && (local.claimId !== predecessor.claimId || pullRequest.markerClaimId !== predecessor.claimId || pullRequest.markerLeaseEpoch !== predecessor.leaseEpoch || local.leaseEpoch !== predecessor.leaseEpoch)) invalid("predecessor projection");
  if (successor.predecessorClaimId !== predecessor.claimId || successor.leaseEpoch !== predecessor.leaseEpoch + 1) invalid("successor lineage");
  if (value.mode === "partial-local-successor") {
    if (local.claimId !== successor.claimId || local.leaseEpoch !== successor.leaseEpoch || pullRequest.markerClaimId !== successor.claimId || pullRequest.markerLeaseEpoch !== successor.leaseEpoch || partialLocal.actualLease.cloudAuthority?.claimId !== successor.claimId) invalid("partial-local successor projection");
    if (partialLocal.projectionState === "pending" && partialLocal.bindingSourceLease.cloudAuthority?.claimId !== predecessor.claimId) invalid("binding source predecessor");
    if (partialLocal.projectionState === "repaired" && (partialLocal.repair.predecessorClaimId !== predecessor.claimId || partialLocal.repair.successorClaimId !== successor.claimId || partialLocal.repair.branch !== value.branch)) invalid("terminal repair lineage");
  }
  for (const [actual, expected] of [[successor.actorId, value.actorId], [successor.repository, value.repository], [successor.workItemId, value.workItemId], [successor.canonicalBaseSha, local.baseSha], [successor.laneRevision, local.headSha], [successor.writeSetDigest, local.writeSetDigest], [successor.reviewRequestId, local.reviewRequestId]]) if (actual !== expected) invalid("successor subject");
  if (value.remoteHeadSha !== local.headSha || pullRequest.headRefOid !== local.headSha || pullRequest.headRefName !== value.branch || pullRequest.markerDigest !== local.markerDigest) invalid("head or marker fence");
}

function stableLeaseSubjectDigest(lease) { const { taskAuthority: _taskAuthority, reviewedSuccessorPartialLocalProjectionRepair: _repair, ...stable } = lease; return digestValue(stable); }

function pick(value, keys) { return Object.fromEntries(keys.map(key => [key, value?.[key]])); }
function exactKeys(value, keys, label) { record(value, label); if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) invalid(label); }
function record(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label); digestValue(value); return value; }
function text(value, label) { if (typeof value !== "string" || !value.trim()) invalid(label); return value; }
function digest(value, label) { if (!DIGEST.test(String(value || ""))) invalid(label); return value; }
function sha(value, label) { if (!SHA.test(String(value || ""))) invalid(label); return value; }
function positive(value, label) { if (!Number.isSafeInteger(value) || value < 1) invalid(label); return value; }
function instant(value, label) { if (!value || new Date(value).toISOString() !== value) invalid(label); return value; }
function invalid(label) { throw new Error(`Reviewed-successor projection response-loss has invalid ${label}.`); }
