// Responsibility: Seal one exact queue-preserving wrapper around local reviewed-lane rehydration.
import { digestValue, normalizeWriteSet } from "./cloud-collaboration-primitives.mjs";
import {
  normalizeOpenReviewedLaneRehydrationPlan,
  normalizeOpenReviewedLaneRehydrationReceipt,
} from "./open-reviewed-lane-rehydration-contract.mjs";

export const EVIDENCE_SCHEMA = "agentic-open-reviewed-lane-queue-preservation-evidence/v1";
export const PLAN_SCHEMA = "agentic-open-reviewed-lane-queue-preservation-plan/v1";
export const INTENT_SCHEMA = "agentic-open-reviewed-lane-queue-preservation-intent/v1";
export const RECEIPT_SCHEMA = "agentic-open-reviewed-lane-queue-preservation-receipt/v1";
export const PRESERVED_QUEUE_SCHEMA = "agentic-open-reviewed-lane-preserved-queue/v1";

const OPERATION = "open-reviewed-lane-queue-preservation";
const ORDER = "lease-epoch-then-claim-id";
const STATUSES = Object.freeze(["prepared", "inner-complete", "complete"]);
const MUTATION_SET = Object.freeze(["registered-worktree"]);
const CLAIM_KEYS = Object.freeze([
  "claimId", "entrySchema", "claimIdentitySchema", "state", "writeAuthority",
  "scopeReserved", "actorId", "repositoryId", "workItemId",
  "canonicalBaseRevision", "laneRevision", "declaredWriteScope", "writeSetDigest",
  "leaseEpoch", "transitionCounter", "heartbeatCounter", "reviewRequestId",
  "predecessorClaimId", "expiresAt", "fenceRevision", "transitionDigest",
  "operationReceiptDigest", "integrationReceiptDigest", "integration",
]);
const DIGEST = /^[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40}$/u;
const WORK_ITEM = /^work-item:[0-9a-f]{64}$/u;

export function buildOpenReviewedLaneQueuePreservationPlan({ innerPlan, preservedQueue } = {}) {
  const evidence = buildEvidence(innerPlan, preservedQueue);
  const core = { schema: PLAN_SCHEMA, operation: OPERATION, evidence };
  const planDigest = digestValue(core);
  return freeze({
    ...core,
    planDigest,
    exactAuthorization: `authorize ${OPERATION} ${planDigest}`,
  });
}

export function normalizeOpenReviewedLaneQueuePreservationPlan(value) {
  exact(value, ["schema", "operation", "evidence", "planDigest", "exactAuthorization"], "plan");
  if (value.schema !== PLAN_SCHEMA || value.operation !== OPERATION) invalid("plan identity");
  const evidence = normalizeEvidence(value.evidence);
  const core = { schema: PLAN_SCHEMA, operation: OPERATION, evidence };
  const planDigest = digest(value.planDigest, "plan digest");
  if (planDigest !== digestValue(core)
    || value.exactAuthorization !== `authorize ${OPERATION} ${planDigest}`) invalid("plan digest");
  return freeze({ ...core, planDigest, exactAuthorization: value.exactAuthorization });
}

export function authorizeOpenReviewedLaneQueuePreservation(plan, statement) {
  const normalized = normalizeOpenReviewedLaneQueuePreservationPlan(plan);
  if (statement !== normalized.exactAuthorization) invalid("authorization");
  return normalized;
}

export function createOpenReviewedLaneQueuePreservationIntent(plan) {
  const normalized = normalizeOpenReviewedLaneQueuePreservationPlan(plan);
  return normalizeOpenReviewedLaneQueuePreservationIntent({
    schema: INTENT_SCHEMA,
    operationId: digestValue({ schema: INTENT_SCHEMA, planDigest: normalized.planDigest }),
    planDigest: normalized.planDigest,
    planSnapshot: normalized,
    preservedQueueDigest: normalized.evidence.preservedQueueDigest,
    status: "prepared",
    innerReceipt: null,
    receipt: null,
  });
}

export function normalizeOpenReviewedLaneQueuePreservationIntent(value) {
  exact(value, ["schema", "operationId", "planDigest", "planSnapshot", "preservedQueueDigest",
    "status", "innerReceipt", "receipt"], "intent");
  if (value.schema !== INTENT_SCHEMA || !STATUSES.includes(value.status)) invalid("intent status");
  const planSnapshot = normalizeOpenReviewedLaneQueuePreservationPlan(value.planSnapshot);
  const operationId = digest(value.operationId, "operation ID");
  const expectedOperationId = digestValue({ schema: INTENT_SCHEMA, planDigest: planSnapshot.planDigest });
  const preservedQueueDigest = digest(value.preservedQueueDigest, "intent queue digest");
  if (operationId !== expectedOperationId || value.planDigest !== planSnapshot.planDigest
    || preservedQueueDigest !== planSnapshot.evidence.preservedQueueDigest) invalid("intent identity");
  const innerReceipt = value.innerReceipt === null ? null
    : normalizeInnerReceipt(planSnapshot, value.innerReceipt);
  const receipt = value.receipt === null ? null
    : normalizeOpenReviewedLaneQueuePreservationReceipt(value.receipt);
  if ((value.status === "prepared") !== (innerReceipt === null)
    || (value.status === "complete") !== (receipt !== null)
    || receipt && receipt.innerReceipt.receiptDigest !== innerReceipt.receiptDigest) invalid("intent receipts");
  return freeze({ ...value, operationId, planDigest: planSnapshot.planDigest, planSnapshot,
    preservedQueueDigest, innerReceipt, receipt });
}

export function recordOpenReviewedLaneQueuePreservationInnerReceipt(value, innerReceipt) {
  const current = normalizeOpenReviewedLaneQueuePreservationIntent(value);
  if (current.status !== "prepared") invalid("inner receipt phase");
  return normalizeOpenReviewedLaneQueuePreservationIntent({ ...current, status: "inner-complete",
    innerReceipt: normalizeInnerReceipt(current.planSnapshot, innerReceipt) });
}

export function buildOpenReviewedLaneQueuePreservationReceipt({ intent: source } = {}) {
  const normalized = normalizeOpenReviewedLaneQueuePreservationIntent(source);
  if (normalized.status !== "inner-complete") invalid("receipt phase");
  const plan = normalized.planSnapshot, evidence = plan.evidence, inner = normalized.innerReceipt;
  const core = {
    schema: RECEIPT_SCHEMA,
    status: "attention-required",
    operationId: normalized.operationId,
    planDigest: plan.planDigest,
    innerPlanDigest: evidence.innerPlan.planDigest,
    innerReceipt: inner,
    sourceClaim: evidence.sourceClaim,
    preservedQueueComplete: true,
    preservedQueue: evidence.preservedQueue,
    preservedQueueDigest: evidence.preservedQueueDigest,
    repository: inner.repository,
    branch: inner.branch,
    targetPath: inner.targetPath,
    pullRequest: inner.pullRequest,
    claim: inner.claim,
    mutationSet: MUTATION_SET,
    remoteMutation: false,
    providerMutation: false,
    cloudMutation: false,
    authoringAuthority: false,
    cloudTransitionAuthority: false,
    integrationAuthority: false,
  };
  return freeze({ ...core, receiptDigest: digestValue(core) });
}

export function completeOpenReviewedLaneQueuePreservationIntent(value, receipt) {
  const current = normalizeOpenReviewedLaneQueuePreservationIntent(value);
  if (current.status !== "inner-complete") invalid("completion phase");
  const normalized = normalizeOpenReviewedLaneQueuePreservationReceipt(receipt);
  if (normalized.operationId !== current.operationId || normalized.planDigest !== current.planDigest
    || normalized.innerReceipt.receiptDigest !== current.innerReceipt.receiptDigest) invalid("completion join");
  return normalizeOpenReviewedLaneQueuePreservationIntent({ ...current, status: "complete", receipt: normalized });
}

export function normalizeOpenReviewedLaneQueuePreservationReceipt(value) {
  const { receiptDigest, ...core } = value || {};
  exact(core, ["schema", "status", "operationId", "planDigest", "innerPlanDigest", "innerReceipt",
    "sourceClaim", "preservedQueueComplete", "preservedQueue",
    "preservedQueueDigest", "repository", "branch", "targetPath", "pullRequest", "claim",
    "mutationSet", "remoteMutation", "providerMutation", "cloudMutation", "authoringAuthority",
    "cloudTransitionAuthority", "integrationAuthority"], "receipt");
  if (core.schema !== RECEIPT_SCHEMA || core.status !== "attention-required"
    || digest(receiptDigest, "receipt digest") !== digestValue(core)
    || core.preservedQueueComplete !== true
    || JSON.stringify(core.mutationSet) !== JSON.stringify(MUTATION_SET)
    || [core.remoteMutation, core.providerMutation, core.cloudMutation, core.authoringAuthority,
      core.cloudTransitionAuthority, core.integrationAuthority].some(Boolean)) invalid("receipt boundary");
  const innerReceipt = normalizeOpenReviewedLaneRehydrationReceipt(core.innerReceipt);
  const sourceClaim = normalizeSourceClaim(core.sourceClaim);
  const preservedQueue = normalizePreservedQueue(core.preservedQueue, sourceClaim, innerReceipt.repository.nameWithOwner);
  const preservedQueueDigest = preservedQueue.queueDigest;
  if (preservedQueueDigest !== core.preservedQueueDigest || core.innerPlanDigest !== innerReceipt.planDigest
    || sourceClaim.claimId !== innerReceipt.claim.claimId
    || sourceClaim.workItemId !== innerReceipt.claim.workItemId
    || digestValue(core.repository) !== digestValue(innerReceipt.repository)
    || core.branch !== innerReceipt.branch || core.targetPath !== innerReceipt.targetPath
    || digestValue(core.pullRequest) !== digestValue(innerReceipt.pullRequest)
    || digestValue(core.claim) !== digestValue(innerReceipt.claim)) {
    invalid("receipt join");
  }
  digest(core.operationId, "receipt operation ID"); digest(core.planDigest, "receipt plan digest");
  return freeze({ ...core, innerReceipt, sourceClaim, preservedQueue,
    preservedQueueDigest, receiptDigest });
}

export function normalizeOpenReviewedLaneQueuePreservationInnerReceipt(plan, receipt) {
  return normalizeInnerReceipt(normalizeOpenReviewedLaneQueuePreservationPlan(plan), receipt);
}

function buildEvidence(innerPlan, preservedQueue) {
  const normalizedInner = normalizeOpenReviewedLaneRehydrationPlan(innerPlan);
  requireWorktreeOnly(normalizedInner);
  const source = sourceFromPlan(normalizedInner);
  const queue = normalizePreservedQueue(preservedQueue, source,
    normalizedInner.evidence.repository.nameWithOwner);
  const core = {
    schema: EVIDENCE_SCHEMA,
    innerPlan: normalizedInner,
    sourceClaim: source,
    preservedQueueComplete: true,
    preservedQueue: queue,
    preservedQueueDigest: queue.queueDigest,
    mutationSet: MUTATION_SET,
    terminalStatus: "attention-required",
    authoringAuthority: false,
    cloudTransitionAuthority: false,
    integrationAuthority: false,
  };
  return freeze({ ...core, evidenceDigest: digestValue(core) });
}

function normalizeEvidence(value) {
  exact(value, ["schema", "innerPlan", "sourceClaim", "preservedQueueComplete",
    "preservedQueue", "preservedQueueDigest", "mutationSet", "terminalStatus",
    "authoringAuthority", "cloudTransitionAuthority", "integrationAuthority", "evidenceDigest"], "evidence");
  if (value.schema !== EVIDENCE_SCHEMA || value.preservedQueueComplete !== true
    || value.terminalStatus !== "attention-required"
    || JSON.stringify(value.mutationSet) !== JSON.stringify(MUTATION_SET)
    || [value.authoringAuthority, value.cloudTransitionAuthority, value.integrationAuthority].some(Boolean)) {
    invalid("evidence boundary");
  }
  const innerPlan = normalizeOpenReviewedLaneRehydrationPlan(value.innerPlan);
  requireWorktreeOnly(innerPlan);
  const source = sourceFromPlan(innerPlan);
  const sourceClaim = normalizeSourceClaim(value.sourceClaim);
  if (digestValue(sourceClaim) !== digestValue(source)) invalid("source claim join");
  const preservedQueue = normalizePreservedQueue(value.preservedQueue, sourceClaim,
    innerPlan.evidence.repository.nameWithOwner);
  const preservedQueueDigest = preservedQueue.queueDigest;
  const core = { ...value, innerPlan, sourceClaim, preservedQueue,
    preservedQueueDigest, evidenceDigest: undefined };
  delete core.evidenceDigest;
  if (value.preservedQueueDigest !== preservedQueueDigest || value.evidenceDigest !== digestValue(core)) {
    invalid("evidence digest");
  }
  return freeze({ ...core, evidenceDigest: value.evidenceDigest });
}

function normalizePreservedQueue(value, source, targetRepository) {
  exact(value, ["schema", "sourceClaim", "ledgerRepository", "targetRepository", "ledgerRevision",
    "ledgerDigest", "complete", "order", "entries", "queueDigest"], "preserved queue");
  if (value.schema !== PRESERVED_QUEUE_SCHEMA || value.complete !== true || value.order !== ORDER
    || value.targetRepository !== targetRepository) invalid("preserved queue identity");
  const queueSource = normalizeSourceClaim(value.sourceClaim);
  if (digestValue(queueSource) !== digestValue(source)) invalid("preserved queue source");
  if (!Array.isArray(value.entries) || value.entries.length < 1 || value.entries.length > 128) {
    invalid("preserved queue cardinality");
  }
  const claims = value.entries.map((claim, index) => normalizeWaiter(claim, source, index));
  const sorted = [...claims].sort((left, right) => left.leaseEpoch - right.leaseEpoch
    || left.claimId.localeCompare(right.claimId));
  if (new Set(claims.map(claim => claim.claimId)).size !== claims.length
    || JSON.stringify(claims.map(claim => claim.claimId)) !== JSON.stringify(sorted.map(claim => claim.claimId))) {
    invalid("preserved queue order");
  }
  const core = { schema: PRESERVED_QUEUE_SCHEMA, sourceClaim: queueSource,
    ledgerRepository: text(value.ledgerRepository, "queue ledger repository"),
    targetRepository: text(value.targetRepository, "queue target repository"),
    ledgerRevision: sha(value.ledgerRevision, "queue ledger revision"),
    ledgerDigest: digest(value.ledgerDigest, "queue ledger digest"), complete: true, order: ORDER,
    entries: freeze(claims) };
  const queueDigest = digestValue({ schema: core.schema, sourceClaim: core.sourceClaim,
    ledgerRepository: core.ledgerRepository, targetRepository: core.targetRepository,
    complete: core.complete, order: core.order, entries: core.entries });
  if (value.queueDigest !== queueDigest) invalid("preserved queue digest");
  return freeze({ ...core, queueDigest });
}

function normalizeWaiter(value, source, index) {
  exact(value, CLAIM_KEYS, `preserved queue claim ${index + 1}`);
  if (value.entrySchema !== "agentic-cloud-collaboration-entry/v2"
    || value.claimIdentitySchema !== "agentic-cloud-collaboration-entry/v2"
    || value.state !== "waiting-successor" || value.writeAuthority !== false
    || value.scopeReserved !== false || value.reviewRequestId !== null
    || value.integrationReceiptDigest !== null || value.integration !== null
    || value.predecessorClaimId !== source.claimId || value.actorId !== source.actorId
    || value.repositoryId !== source.repositoryId) {
    invalid(`preserved queue claim ${index + 1} authority`);
  }
  const declaredWriteScope = normalizeWriteSet(value.declaredWriteScope);
  const claim = freeze({ ...value,
    claimId: digest(value.claimId, "waiter claim ID"),
    actorId: text(value.actorId, "waiter actor"),
    repositoryId: text(value.repositoryId, "waiter repository"),
    workItemId: workItem(value.workItemId),
    canonicalBaseRevision: sha(value.canonicalBaseRevision, "waiter base"),
    laneRevision: sha(value.laneRevision, "waiter revision"),
    declaredWriteScope,
    writeSetDigest: digest(value.writeSetDigest, "waiter write-set digest"),
    predecessorClaimId: digest(value.predecessorClaimId, "waiter predecessor"),
    expiresAt: instant(value.expiresAt, "waiter expiry"),
    fenceRevision: digest(value.fenceRevision, "waiter fence"),
    transitionDigest: digest(value.transitionDigest, "waiter transition"),
    operationReceiptDigest: digest(value.operationReceiptDigest, "waiter operation receipt"),
  });
  for (const [name, minimum] of [["leaseEpoch", 1], ["transitionCounter", 1], ["heartbeatCounter", 0]]) {
    if (!Number.isSafeInteger(claim[name]) || claim[name] < minimum) invalid(`waiter ${name}`);
  }
  const expectedClaimId = digestValue({ actorId: claim.actorId,
    canonicalBaseRevision: claim.canonicalBaseRevision, leaseEpoch: claim.leaseEpoch,
    repositoryId: claim.repositoryId, workItemId: claim.workItemId, writeSetDigest: claim.writeSetDigest });
  if (claim.writeSetDigest !== digestValue(declaredWriteScope) || claim.claimId !== expectedClaimId) {
    invalid(`preserved queue claim ${index + 1} identity`);
  }
  return claim;
}

function normalizeInnerReceipt(plan, value) {
  const receipt = normalizeOpenReviewedLaneRehydrationReceipt(value);
  const evidence = plan.evidence.innerPlan.evidence;
  if (receipt.planDigest !== plan.evidence.innerPlan.planDigest
    || JSON.stringify(receipt.mutationSet) !== JSON.stringify(MUTATION_SET)
    || receipt.remoteMutation !== false || receipt.providerMutation !== false || receipt.cloudMutation !== false
    || receipt.repository.nameWithOwner !== evidence.repository.nameWithOwner
    || receipt.branch !== evidence.branch || receipt.targetPath !== evidence.target.path
    || receipt.pullRequest.number !== evidence.pullRequest.number || receipt.claim.claimId !== evidence.claim.claimId) {
    invalid("inner receipt boundary");
  }
  return receipt;
}

function requireWorktreeOnly(plan) {
  if (plan.evidence.localProjection.mode !== "worktree-only") invalid("inner projection mode");
}
function sourceFromPlan(plan) { const claim = plan.evidence.claim; return freeze({ claimId: claim.claimId,
  actorId: claim.actorId, repositoryId: claim.repositoryId, workItemId: claim.workItemId }); }
function normalizeSourceClaim(value) {
  exact(value, ["claimId", "actorId", "repositoryId", "workItemId"], "source claim");
  return freeze({ claimId: digest(value.claimId, "source claim ID"),
    actorId: text(value.actorId, "source actor"), repositoryId: text(value.repositoryId, "source repository"),
    workItemId: workItem(value.workItemId) });
}
function exact(value, keys, label) { if (!value || typeof value !== "object" || Array.isArray(value)
  || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) invalid(label); }
function text(value, label) { if (typeof value !== "string" || !value || value !== value.trim() || value.includes("\0")) invalid(label); return value; }
function digest(value, label) { if (!DIGEST.test(String(value || ""))) invalid(label); return value; }
function sha(value, label) { if (!SHA.test(String(value || ""))) invalid(label); return value; }
function workItem(value) { if (!WORK_ITEM.test(String(value || ""))) invalid("work item"); return value; }
function instant(value, label) { if (typeof value !== "string" || new Date(value).toISOString() !== value) invalid(label); return value; }
function freeze(value) { if (Array.isArray(value)) return Object.freeze(value); return Object.freeze(value); }
function invalid(label) { throw new Error(`Open reviewed lane queue preservation ${label} is invalid.`); }
