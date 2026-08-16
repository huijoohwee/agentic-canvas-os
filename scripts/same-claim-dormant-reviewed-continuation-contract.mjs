// Responsibility: Seal one same-claim dormant reviewed recovery and its zero-PR-effect receipt.
import { digestValue } from "./cloud-collaboration-primitives.mjs";

export const PLAN_SCHEMA = "agentic-same-claim-dormant-reviewed-continuation-plan/v1";
export const RECEIPT_SCHEMA = "agentic-same-claim-dormant-reviewed-continuation-receipt/v1";
export const LOCAL_REPAIR_SCHEMA = "agentic-same-claim-dormant-reviewed-continuation-local-repair/v1";
export const AUTHORIZATION_PREFIX = "authorize same-claim-dormant-reviewed-continuation";
export const POLICY = Object.freeze({ cloudRecovery: "same-claim-only", localLeaseCas: true, pullRequestMutation: false, sourceMutation: false, gitRefMutation: false, mergeMutation: false, integrationMutation: false, deployMutation: false, authoringAuthorityGranted: false });
const DIGEST = /^[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40}$/u;

export function buildSameClaimDormantReviewedPlan(evidence) {
  const normalized = normalizeSameClaimDormantReviewedEvidence(evidence);
  const core = { schema: PLAN_SCHEMA, evidence: normalized, policy: POLICY };
  return Object.freeze({ ...core, planDigest: digestValue(core) });
}

export function normalizeSameClaimDormantReviewedPlan(value) {
  exact(value, ["schema", "evidence", "policy", "planDigest"], "plan");
  const plan = buildSameClaimDormantReviewedPlan(value.evidence);
  if (value.schema !== PLAN_SCHEMA || digestValue(value.policy) !== digestValue(POLICY) || value.planDigest !== plan.planDigest) invalid("plan");
  return plan;
}

export function sameClaimDormantReviewedOperation(plan) { return `same-claim-dormant-reviewed-continuation:${normalizeSameClaimDormantReviewedPlan(plan).planDigest}`; }

export function evidenceReplayDigest(value) {
  const evidence = normalizeSameClaimDormantReviewedEvidence(value);
  const { observedAt: _observedAt, evidenceDigest: _evidenceDigest, cloud, ...stable } = evidence;
  return digestValue({ ...stable, cloud: { claimId: cloud.claimId, leaseEpoch: cloud.leaseEpoch, canonicalBaseSha: cloud.canonicalBaseSha, laneRevision: cloud.laneRevision, writeSetDigest: cloud.writeSetDigest, reviewRequestId: cloud.reviewRequestId, scopeReserved: cloud.scopeReserved, integrationState: cloud.integrationState } });
}

export function normalizeSameClaimDormantReviewedEvidence(value) {
  exact(value, ["observedAt", "repository", "branch", "targetSessionId", "operatorAuthority", "local", "pullRequest", "marker", "cloud", "projectionState", "localRepair", "evidenceDigest"], "evidence");
  const core = {
    observedAt: instant(value.observedAt, "observed at"), repository: text(value.repository, "repository"), branch: text(value.branch, "branch"), targetSessionId: text(value.targetSessionId, "target session"),
    operatorAuthority: normalizeOperator(value.operatorAuthority), local: normalizeLocal(value.local), pullRequest: normalizePullRequest(value.pullRequest), marker: normalizeMarker(value.marker), cloud: normalizeCloud(value.cloud), projectionState: value.projectionState, localRepair: value.localRepair === null ? null : normalizeLocalRepair(value.localRepair),
  };
  if (!new Set(["pending", "complete"]).has(core.projectionState)) invalid("projection state");
  assertSubject(core);
  const evidenceDigest = digestValue(core);
  if (value.evidenceDigest !== undefined && value.evidenceDigest !== evidenceDigest) invalid("evidence digest");
  return Object.freeze({ ...core, evidenceDigest });
}

export function normalizeCloudRecovery(value) {
  exact(value, ["claimId", "authority", "verificationReceiptDigest", "cloudOperationReceiptDigest", "recoveredAt", "recoveryDigest"], "cloud recovery");
  const core = { claimId: digest(value.claimId, "recovered claim"), authority: record(value.authority, "recovered authority"), verificationReceiptDigest: digest(value.verificationReceiptDigest, "cloud verification"), cloudOperationReceiptDigest: digest(value.cloudOperationReceiptDigest, "cloud operation receipt"), recoveredAt: instant(value.recoveredAt, "cloud recovered at") };
  if (digestValue(core) !== digest(value.recoveryDigest, "cloud recovery digest")) invalid("cloud recovery digest");
  return Object.freeze({ ...core, recoveryDigest: value.recoveryDigest });
}

export function normalizeLocalProjection(value) {
  exact(value, ["taskAuthorityReceiptDigest", "cloudRecoveryDigest", "localRepair", "targetLeaseDigest", "registryRevision"], "local projection");
  return Object.freeze({ taskAuthorityReceiptDigest: digest(value.taskAuthorityReceiptDigest, "task receipt"), cloudRecoveryDigest: digest(value.cloudRecoveryDigest, "cloud recovery"), localRepair: normalizeLocalRepair(value.localRepair), targetLeaseDigest: digest(value.targetLeaseDigest, "target lease"), registryRevision: positive(value.registryRevision, "registry revision") });
}

export function normalizeTerminal(value) {
  exact(value, ["claimId", "headSha", "pullRequestBodyDigest", "pullRequestStateDigest", "localRepairReceiptDigest", "targetLeaseDigest", "registryRevision", "verifiedAt"], "terminal");
  return Object.freeze({ claimId: digest(value.claimId, "terminal claim"), headSha: sha(value.headSha, "terminal head"), pullRequestBodyDigest: digest(value.pullRequestBodyDigest, "terminal body"), pullRequestStateDigest: digest(value.pullRequestStateDigest, "terminal PR state"), localRepairReceiptDigest: digest(value.localRepairReceiptDigest, "terminal repair"), targetLeaseDigest: digest(value.targetLeaseDigest, "terminal lease"), registryRevision: positive(value.registryRevision, "terminal registry revision"), verifiedAt: instant(value.verifiedAt, "verified at") });
}

export function buildSameClaimDormantReviewedReceipt({ plan, taskAuthorityReceipt, cloudRecovery, projection, terminal }) {
  const sealed = normalizeSameClaimDormantReviewedPlan(plan); const cloud = normalizeCloudRecovery(cloudRecovery); const local = normalizeLocalProjection(projection); const verified = normalizeTerminal(terminal);
  if (local.localRepair.planDigest !== sealed.planDigest || cloud.claimId !== sealed.evidence.cloud.claimId || local.cloudRecoveryDigest !== cloud.recoveryDigest || verified.claimId !== cloud.claimId || verified.localRepairReceiptDigest !== local.localRepair.receiptDigest || verified.targetLeaseDigest !== local.targetLeaseDigest || verified.registryRevision !== local.registryRevision || verified.headSha !== sealed.evidence.local.headSha || verified.pullRequestBodyDigest !== sealed.evidence.pullRequest.bodyDigest || verified.pullRequestStateDigest !== sealed.evidence.pullRequest.stateDigest) invalid("terminal subject");
  const core = { schema: RECEIPT_SCHEMA, planDigest: sealed.planDigest, claimId: cloud.claimId, taskAuthorityReceiptDigest: digest(taskAuthorityReceipt?.receiptDigest, "task authority receipt"), cloudRecoveryDigest: cloud.recoveryDigest, localRepairReceiptDigest: local.localRepair.receiptDigest, targetLeaseDigest: local.targetLeaseDigest, registryRevision: local.registryRevision, verifiedAt: verified.verifiedAt, policy: POLICY };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}

function normalizeOperator(value) { exact(value, ["repository", "branch", "sessionId", "leaseDigest", "claimId", "bindingDigest"], "operator authority"); return Object.freeze({ repository: text(value.repository, "operator repository"), branch: text(value.branch, "operator branch"), sessionId: text(value.sessionId, "operator session"), leaseDigest: digest(value.leaseDigest, "operator lease"), claimId: digest(value.claimId, "operator claim"), bindingDigest: digest(value.bindingDigest, "operator binding") }); }
function normalizeLocal(value) { exact(value, ["leaseDigest", "status", "admissionStatus", "clean", "claimId", "leaseEpoch", "baseSha", "headSha", "writeSetDigest", "reviewRequestId", "taskBindingDigest", "priorTaskBindingDigest", "repairReceiptDigest"], "local"); if (value.status !== "review_ready" || value.admissionStatus !== "admitted" || value.clean !== true) invalid("clean reviewed local lease"); return Object.freeze({ leaseDigest: digest(value.leaseDigest, "local lease"), status: value.status, admissionStatus: value.admissionStatus, clean: true, claimId: digest(value.claimId, "local claim"), leaseEpoch: positive(value.leaseEpoch, "local lease epoch"), baseSha: sha(value.baseSha, "local base"), headSha: sha(value.headSha, "local head"), writeSetDigest: digest(value.writeSetDigest, "local write set"), reviewRequestId: text(value.reviewRequestId, "local review request"), taskBindingDigest: digest(value.taskBindingDigest, "local task binding"), priorTaskBindingDigest: digest(value.priorTaskBindingDigest, "prior task binding"), repairReceiptDigest: digest(value.repairReceiptDigest, "binding repair receipt") }); }
function normalizePullRequest(value) { exact(value, ["number", "id", "url", "state", "isDraft", "autoMergeRequest", "headRefName", "headRefOid", "baseRefName", "bodyDigest", "stateDigest"], "pull request"); if (value.state !== "OPEN" || value.isDraft !== false || value.autoMergeRequest !== null) invalid("reviewed pull request state"); const core = { number: positive(value.number, "pull request number"), id: text(value.id, "pull request ID"), url: text(value.url, "pull request URL"), state: "OPEN", isDraft: false, autoMergeRequest: null, headRefName: text(value.headRefName, "pull request head branch"), headRefOid: sha(value.headRefOid, "pull request head"), baseRefName: text(value.baseRefName, "pull request base"), bodyDigest: digest(value.bodyDigest, "pull request body"), stateDigest: digest(value.stateDigest, "pull request state digest") }; return Object.freeze(core); }
function normalizeMarker(value) { exact(value, ["status", "claimId", "leaseEpoch", "reviewHeadSha", "taskBindingDigest", "markerDigest"], "marker"); if (value.status !== "review_ready") invalid("reviewed marker"); return Object.freeze({ status: value.status, claimId: digest(value.claimId, "marker claim"), leaseEpoch: positive(value.leaseEpoch, "marker lease epoch"), reviewHeadSha: sha(value.reviewHeadSha, "marker review head"), taskBindingDigest: digest(value.taskBindingDigest, "marker task binding"), markerDigest: digest(value.markerDigest, "marker digest") }); }
function normalizeCloud(value) { exact(value, ["claimId", "matches", "state", "writeAuthority", "scopeReserved", "leaseEpoch", "canonicalBaseSha", "laneRevision", "writeSetDigest", "reviewRequestId", "integrationState", "claimDigest", "transitionCounter", "operationReceiptDigest"], "cloud"); const nonAuthoring = new Set(["dormant-preserved", "reviewed"]).has(value.state); if (value.matches !== 1 || !new Set(["dormant-preserved", "current", "reviewed"]).has(value.state) || value.scopeReserved !== true || (nonAuthoring ? value.writeAuthority !== false : value.writeAuthority !== true) || value.integrationState !== "not-integrated") invalid("same-claim cloud state"); return Object.freeze({ claimId: digest(value.claimId, "cloud claim"), matches: 1, state: value.state, writeAuthority: value.writeAuthority, scopeReserved: true, leaseEpoch: positive(value.leaseEpoch, "cloud lease epoch"), canonicalBaseSha: sha(value.canonicalBaseSha, "cloud base"), laneRevision: sha(value.laneRevision, "cloud lane revision"), writeSetDigest: digest(value.writeSetDigest, "cloud write set"), reviewRequestId: text(value.reviewRequestId, "cloud review request"), integrationState: value.integrationState, claimDigest: digest(value.claimDigest, "cloud claim digest"), transitionCounter: positive(value.transitionCounter, "cloud transition"), operationReceiptDigest: digest(value.operationReceiptDigest, "cloud operation receipt") }); }
function normalizeLocalRepair(value) { exact(value, ["schema", "status", "planDigest", "claimId", "sourceLeaseDigest", "targetLeaseSubjectDigest", "taskAuthorityReceiptDigest", "cloudRecoveryDigest", "cloudRecovery", "recoveredAt", "cloudEffect", "pullRequestEffect", "sourceEffect", "gitEffect", "mergeEffect", "integrationEffect", "deploymentEffect", "receiptDigest"], "local repair"); if (value.schema !== LOCAL_REPAIR_SCHEMA || value.status !== "recovered") invalid("local repair schema"); for (const key of ["pullRequestEffect", "sourceEffect", "gitEffect", "mergeEffect", "integrationEffect", "deploymentEffect"]) if (value[key] !== false) invalid("local repair external effect"); if (value.cloudEffect !== false) invalid("local repair cloud effect"); const cloudRecovery = normalizeCloudRecovery(value.cloudRecovery); const core = { schema: value.schema, status: value.status, planDigest: digest(value.planDigest, "repair plan"), claimId: digest(value.claimId, "repair claim"), sourceLeaseDigest: digest(value.sourceLeaseDigest, "repair source lease"), targetLeaseSubjectDigest: digest(value.targetLeaseSubjectDigest, "repair target lease subject"), taskAuthorityReceiptDigest: digest(value.taskAuthorityReceiptDigest, "repair task receipt"), cloudRecoveryDigest: digest(value.cloudRecoveryDigest, "repair cloud recovery"), cloudRecovery, recoveredAt: instant(value.recoveredAt, "repair time"), cloudEffect: false, pullRequestEffect: false, sourceEffect: false, gitEffect: false, mergeEffect: false, integrationEffect: false, deploymentEffect: false }; if (core.cloudRecoveryDigest !== cloudRecovery.recoveryDigest || digestValue(core) !== digest(value.receiptDigest, "repair receipt")) invalid("repair receipt"); return Object.freeze({ ...core, receiptDigest: value.receiptDigest }); }
function assertSubject(value) { const { local, marker, cloud, pullRequest, projectionState, localRepair } = value; if (local.claimId !== cloud.claimId || marker.claimId !== cloud.claimId || local.leaseEpoch !== cloud.leaseEpoch || marker.leaseEpoch !== cloud.leaseEpoch || local.baseSha !== cloud.canonicalBaseSha || local.headSha !== cloud.laneRevision || local.headSha !== marker.reviewHeadSha || local.headSha !== pullRequest.headRefOid || pullRequest.headRefName !== value.branch || local.writeSetDigest !== cloud.writeSetDigest || local.reviewRequestId !== cloud.reviewRequestId || marker.taskBindingDigest !== local.priorTaskBindingDigest || marker.taskBindingDigest === local.taskBindingDigest) invalid("same-claim reviewed subject"); if ((projectionState === "pending") !== (localRepair === null)) invalid("projection state receipt"); if (localRepair && localRepair.claimId !== cloud.claimId) invalid("terminal local repair"); }
function exact(value, keys, label) { record(value, label); if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) invalid(label); }
function record(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label); digestValue(value); return value; }
function text(value, label) { if (typeof value !== "string" || !value.trim()) invalid(label); return value; }
function digest(value, label) { if (!DIGEST.test(String(value || ""))) invalid(label); return value; }
function sha(value, label) { if (!SHA.test(String(value || ""))) invalid(label); return value; }
function positive(value, label) { if (!Number.isSafeInteger(value) || value < 1) invalid(label); return value; }
function instant(value, label) { if (!value || new Date(value).toISOString() !== value) invalid(label); return value; }
function invalid(label) { throw new Error(`Same-claim dormant reviewed continuation has invalid ${label}.`); }
