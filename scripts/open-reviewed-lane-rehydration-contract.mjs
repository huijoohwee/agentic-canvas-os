// Responsibility: Normalize and bind one absent local projection of an open reviewed lane.
import { digestValue, normalizeWriteSet } from "./cloud-collaboration-primitives.mjs";
import path from "node:path";

export const EVIDENCE_SCHEMA = "agentic-open-reviewed-lane-rehydration-evidence/v1";
export const PLAN_SCHEMA = "agentic-open-reviewed-lane-rehydration-plan/v1";
export const INTENT_SCHEMA = "agentic-open-reviewed-lane-rehydration-intent/v1";
export const RECEIPT_SCHEMA = "agentic-open-reviewed-lane-rehydration-receipt/v1";

const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const WORK_ITEM = /^work-item:[0-9a-f]{64}$/u;
const CLAIM_KEYS = [
  "claimId", "entrySchema", "claimIdentitySchema", "state", "writeAuthority",
  "scopeReserved", "actorId", "repositoryId", "workItemId",
  "canonicalBaseRevision", "laneRevision", "declaredWriteScope", "writeSetDigest",
  "leaseEpoch", "transitionCounter", "heartbeatCounter", "reviewRequestId",
  "predecessorClaimId", "expiresAt", "fenceRevision", "transitionDigest",
  "operationReceiptDigest", "integrationReceiptDigest", "integration",
];
const PHASES = ["prepared", "branch-created", "worktree-created", "lease-recovered", "complete"];

export function buildOpenReviewedLaneRehydrationPlan(input) {
  const evidence = normalizeEvidence({ ...input, schema: EVIDENCE_SCHEMA });
  const core = { schema: PLAN_SCHEMA, operation: "open-reviewed-lane-rehydration", evidence };
  const planDigest = digestValue(core);
  return freeze({ ...core, planDigest,
    exactAuthorization: `authorize open-reviewed-lane-rehydration ${planDigest}` });
}

export function normalizeOpenReviewedLaneRehydrationPlan(value) {
  exact(value, ["schema", "operation", "evidence", "planDigest", "exactAuthorization"], "plan");
  if (value.schema !== PLAN_SCHEMA || value.operation !== "open-reviewed-lane-rehydration") invalid("plan identity");
  const evidence = normalizeEvidence(value.evidence);
  const core = { schema: PLAN_SCHEMA, operation: value.operation, evidence };
  const planDigest = digest(value.planDigest, "plan digest");
  if (planDigest !== digestValue(core)
    || value.exactAuthorization !== `authorize open-reviewed-lane-rehydration ${planDigest}`) invalid("plan digest");
  return freeze({ ...core, planDigest, exactAuthorization: value.exactAuthorization });
}

export function authorizeOpenReviewedLaneRehydration(plan, statement) {
  const normalized = normalizeOpenReviewedLaneRehydrationPlan(plan);
  if (statement !== normalized.exactAuthorization) invalid("authorization");
  return normalized;
}

export function createOpenReviewedLaneRehydrationIntent(plan) {
  const normalized = normalizeOpenReviewedLaneRehydrationPlan(plan);
  return intent({
    schema: INTENT_SCHEMA,
    operationId: digestValue({ schema: INTENT_SCHEMA, planDigest: normalized.planDigest }),
    planDigest: normalized.planDigest,
    planSnapshot: normalized,
    status: "prepared",
    attempts: [],
    phases: {},
    receipt: null,
  });
}

export function normalizeOpenReviewedLaneRehydrationIntent(value) { return intent(value); }

export function beginOpenReviewedLaneRehydrationEffect(value, phase) {
  const current = intent(value);
  const expected = PHASES[PHASES.indexOf(current.status) + 1];
  if (phase !== expected || phase === "complete" || current.attempts.some(item => item.phase === phase)) {
    invalid("effect attempt");
  }
  const attempt = freeze({ phase, attemptDigest: digestValue({ schema: INTENT_SCHEMA,
    operationId: current.operationId, planDigest: current.planDigest, phase }) });
  return intent({ ...current, attempts: [...current.attempts, attempt] });
}

export function advanceOpenReviewedLaneRehydrationIntent(value, status, values) {
  const current = intent(value);
  const from = PHASES.indexOf(current.status), to = PHASES.indexOf(status);
  if (to !== from + 1 || status === "complete" || current.attempts.at(-1)?.phase !== status) invalid("intent phase transition");
  const next = { ...current, status, phases: { ...current.phases, [status]: freeze({ ...values }) } };
  return intent(next);
}

export function completeOpenReviewedLaneRehydrationIntent(value, receipt) {
  const current = intent(value);
  if (current.status !== "lease-recovered") invalid("completion phase");
  const normalizedReceipt = normalizeOpenReviewedLaneRehydrationReceipt(receipt);
  if (normalizedReceipt.operationId !== current.operationId
    || normalizedReceipt.planDigest !== current.planDigest) invalid("completion receipt join");
  return intent({ ...current, status: "complete", receipt: normalizedReceipt });
}

export function buildOpenReviewedLaneRehydrationReceipt({ intent: source, leaseDigest, registrationDigest }) {
  const normalized = intent(source);
  if (normalized.status !== "lease-recovered") invalid("receipt phase");
  const evidence = normalized.planSnapshot.evidence;
  const core = {
    schema: RECEIPT_SCHEMA,
    status: "rehydrated",
    operationId: normalized.operationId,
    planDigest: normalized.planDigest,
    repository: evidence.repository,
    branch: evidence.branch,
    targetPath: evidence.target.path,
    remoteHeadSha: evidence.remoteHeadSha,
    currentMainSha: evidence.canonical.currentMainSha,
    pullRequest: freeze({ number: evidence.pullRequest.number, nodeId: evidence.pullRequest.nodeId,
      url: evidence.pullRequest.url }),
    claim: freeze({ claimId: evidence.claim.claimId, workItemId: evidence.claim.workItemId,
      fenceRevision: evidence.claim.fenceRevision, transitionCounter: evidence.claim.transitionCounter,
      leaseEpoch: evidence.claim.leaseEpoch }),
    phases: normalized.phases,
    leaseDigest: digest(leaseDigest, "lease digest"),
    registrationDigest: digest(registrationDigest, "registration digest"),
    mutationSet: freeze(["local-branch", "registered-worktree", "writer-lease-projection"]),
    remoteMutation: false,
    providerMutation: false,
    cloudMutation: false,
  };
  return freeze({ ...core, receiptDigest: digestValue(core) });
}

export function normalizeOpenReviewedLaneRehydrationReceipt(value) {
  const { receiptDigest, ...core } = value || {};
  exact(core, ["schema", "status", "operationId", "planDigest", "repository", "branch",
    "targetPath", "remoteHeadSha", "currentMainSha", "pullRequest", "claim", "phases", "leaseDigest",
    "registrationDigest", "mutationSet", "remoteMutation", "providerMutation", "cloudMutation"], "receipt");
  if (core.schema !== RECEIPT_SCHEMA || core.status !== "rehydrated"
    || digest(receiptDigest, "receipt digest") !== digestValue(core)
    || core.remoteMutation !== false || core.providerMutation !== false || core.cloudMutation !== false
    || JSON.stringify(core.mutationSet) !== JSON.stringify(["local-branch", "registered-worktree", "writer-lease-projection"])) invalid("receipt");
  digest(core.operationId, "operation ID"); digest(core.planDigest, "receipt plan digest");
  digest(core.leaseDigest, "lease digest"); digest(core.registrationDigest, "registration digest");
  sha(core.remoteHeadSha, "receipt head"); sha(core.currentMainSha, "receipt main");
  const phases = normalizePhases(core.phases, "lease-recovered");
  const normalizedRepository = repository(core.repository);
  const normalizedPullRequest = receiptPullRequest(core.pullRequest);
  const normalizedClaim = receiptClaim(core.claim);
  return freeze({ ...core, repository: normalizedRepository, pullRequest: normalizedPullRequest,
    claim: normalizedClaim, phases, receiptDigest });
}

function normalizeEvidence(value) {
  exact(value, ["schema", "repository", "actor", "canonical", "target", "branch", "remoteHeadSha",
    "pullRequest", "marker", "claim", "refresh", "localAbsence", "evidenceDigest"].filter(key => key !== "evidenceDigest" || key in value), "evidence");
  if (value.schema !== EVIDENCE_SCHEMA) invalid("evidence schema");
  const core = {
    schema: EVIDENCE_SCHEMA,
    repository: repository(value.repository),
    actor: actor(value.actor),
    canonical: canonical(value.canonical),
    target: target(value.target),
    branch: text(value.branch, "branch"),
    remoteHeadSha: sha(value.remoteHeadSha, "remote head"),
    pullRequest: pullRequest(value.pullRequest),
    marker: marker(value.marker),
    claim: claim(value.claim),
    refresh: refresh(value.refresh),
    localAbsence: absence(value.localAbsence),
  };
  assertJoins(core);
  const evidenceDigest = digestValue(core);
  if (value.evidenceDigest && value.evidenceDigest !== evidenceDigest) invalid("evidence digest");
  return freeze({ ...core, evidenceDigest });
}

function repository(value) {
  exact(value, ["nameWithOwner", "nodeId", "claimRepositoryId"], "repository");
  return freeze({ nameWithOwner: text(value.nameWithOwner, "repository name"), nodeId: text(value.nodeId, "repository ID"),
    claimRepositoryId: text(value.claimRepositoryId, "claim repository ID") });
}
function actor(value) {
  exact(value, ["id", "login", "claimActorId"], "actor");
  return freeze({ id: text(String(value.id), "actor ID"), login: text(value.login, "actor login"),
    claimActorId: text(value.claimActorId, "claim actor ID") });
}
function canonical(value) {
  exact(value, ["repoRoot", "gitCommonDir", "headSha", "currentMainSha", "currentMainTreeSha", "registrationDigest",
    "leaseProjectionDigest", "clean"], "canonical");
  if (value.clean !== true) invalid("canonical cleanliness");
  return freeze({ repoRoot: absolute(value.repoRoot, "repository root"), gitCommonDir: absolute(value.gitCommonDir, "git common dir"),
    headSha: sha(value.headSha, "canonical head"), currentMainSha: sha(value.currentMainSha, "current main"),
    currentMainTreeSha: sha(value.currentMainTreeSha, "current main tree"), registrationDigest: digest(value.registrationDigest, "registration digest"),
    leaseProjectionDigest: digest(value.leaseProjectionDigest, "lease projection digest"), clean: true });
}
function target(value) {
  exact(value, ["path", "managedRoot", "sharedRoot", "observationDigest"], "target");
  return freeze({ path: absolute(value.path, "target path"), managedRoot: absolute(value.managedRoot, "managed root"),
    sharedRoot: absolute(value.sharedRoot, "shared root"), observationDigest: digest(value.observationDigest, "target observation") });
}
function pullRequest(value) {
  exact(value, ["number", "nodeId", "url", "state", "isDraft", "headBranch", "headSha", "baseBranch", "baseSha",
    "headRepository", "baseRepository", "authorLogin", "reviewRequestId", "autoMergeRequest", "mergeQueueEntry",
    "bodyDigest", "markerDigest"], "pull request");
  if (!Number.isSafeInteger(value.number) || value.number < 1 || value.state !== "OPEN" || value.isDraft !== false
    || value.baseBranch !== "main" || value.autoMergeRequest !== null || value.mergeQueueEntry !== null) invalid("pull request state");
  return freeze({ ...value, nodeId: text(value.nodeId, "pull request ID"), url: text(value.url, "pull request URL"),
    headBranch: text(value.headBranch, "pull request branch"), headSha: sha(value.headSha, "pull request head"),
    baseSha: sha(value.baseSha, "pull request base"), headRepository: text(value.headRepository, "head repository"),
    baseRepository: text(value.baseRepository, "base repository"), authorLogin: text(value.authorLogin, "pull request author"),
    reviewRequestId: text(value.reviewRequestId, "review request ID"),
    bodyDigest: digest(value.bodyDigest, "pull request body"), markerDigest: digest(value.markerDigest, "marker digest") });
}
function marker(value) {
  exact(value, ["status", "epoch", "sessionId", "device", "scope", "branch", "baseSha", "fenceSha", "reviewHeadSha",
    "expiresAt", "admission", "cloudAuthority", "markerDigest"], "marker");
  if (value.status !== "review_ready" || !Number.isSafeInteger(value.epoch) || value.epoch < 1) invalid("marker status");
  const admission = value.admission, authority = value.cloudAuthority;
  if (admission?.status !== "admitted" || authority?.schema !== "agentic-lane-cloud-authority/v1") invalid("marker authority");
  const declaredWriteSet = normalizeWriteSet(admission.declaredWriteSet);
  const cloudWriteSet = normalizeWriteSet(authority.cloudDeclaredWriteScope);
  if (digestValue(declaredWriteSet) !== admission.writeSetDigest
    || digestValue(cloudWriteSet) !== authority.writeSetDigest
    || !DIGEST.test(String(admission.manifestDigest || ""))
    || !DIGEST.test(String(admission.planReceiptDigest || ""))
    || !DIGEST.test(String(admission.admissionReceiptDigest || ""))
    || !DIGEST.test(String(admission.existingLaneStateDigest || ""))
    || !DIGEST.test(String(admission.admittedReportDigest || ""))
    || !DIGEST.test(String(admission.preservationReceiptDigest || ""))
    || !String(authority.provider || "").trim() || authority.state !== "review_ready"
    || authority.entrySchema !== "agentic-cloud-collaboration-entry/v2"
    || authority.claimIdentitySchema !== "agentic-cloud-collaboration-entry/v2"
    || !DIGEST.test(String(authority.operationReceiptDigest || ""))
    || !DIGEST.test(String(authority.focusedEvidenceDigest || ""))
    || !Number.isSafeInteger(authority.transitionCounter) || authority.transitionCounter < 1
    || !Number.isSafeInteger(authority.leaseEpoch) || authority.leaseEpoch < 1
    || typeof authority.expiresAt !== "string" || new Date(authority.expiresAt).toISOString() !== authority.expiresAt
    || !DIGEST.test(String(authority.manifestDigest || ""))
    || authority.manifestDigest !== admission.manifestDigest) invalid("marker projection");
  return freeze({ ...value, sessionId: text(value.sessionId, "marker session"), device: text(value.device, "marker device"),
    scope: text(value.scope, "marker scope"), branch: text(value.branch, "marker branch"), baseSha: sha(value.baseSha, "marker base"),
    fenceSha: sha(value.fenceSha, "marker fence"), reviewHeadSha: sha(value.reviewHeadSha, "review head"),
    expiresAt: instant(value.expiresAt, "marker expiry"),
    admission: freeze({ ...admission, declaredWriteSet }),
    cloudAuthority: freeze({ ...authority, cloudDeclaredWriteScope: cloudWriteSet }),
    markerDigest: digest(value.markerDigest, "marker digest") });
}
function claim(value) {
  exact(value, CLAIM_KEYS, "public claim");
  if (value.entrySchema !== "agentic-cloud-collaboration-entry/v2"
    || value.claimIdentitySchema !== "agentic-cloud-collaboration-entry/v2"
    || value.state !== "dormant-preserved" || value.writeAuthority !== false || value.scopeReserved !== true
    || !WORK_ITEM.test(String(value.workItemId || ""))) invalid("claim state");
  const integration = normalizeIntegration(value.integration);
  const result = { ...value, claimId: digest(value.claimId, "claim ID"), actorId: text(value.actorId, "claim actor"),
    repositoryId: text(value.repositoryId, "claim repository"), canonicalBaseRevision: sha(value.canonicalBaseRevision, "claim base"),
    laneRevision: sha(value.laneRevision, "claim revision"), declaredWriteScope: normalizeWriteSet(value.declaredWriteScope),
    writeSetDigest: digest(value.writeSetDigest, "claim write set"), fenceRevision: digest(value.fenceRevision, "claim fence"),
    transitionDigest: digest(value.transitionDigest, "claim transition"), operationReceiptDigest: digest(value.operationReceiptDigest, "claim receipt"),
    predecessorClaimId: value.predecessorClaimId === null ? null : digest(value.predecessorClaimId, "predecessor claim"),
    reviewRequestId: text(value.reviewRequestId, "claim review request"), integration };
  for (const key of ["leaseEpoch", "transitionCounter", "heartbeatCounter"]) if (!Number.isSafeInteger(result[key]) || result[key] < (key === "heartbeatCounter" ? 0 : 1)) invalid(key);
  result.integrationReceiptDigest = digest(result.integrationReceiptDigest, "integration receipt");
  if (digestValue(result.declaredWriteScope) !== result.writeSetDigest) invalid("claim write set");
  instant(result.expiresAt, "claim expiry");
  return freeze(result);
}
function normalizeIntegration(value) {
  exact(value, ["candidateRevision", "reviewRequestId", "focusedEvidenceDigest", "dependencyClosureDigest",
    "namedChecksDigest", "handoffEvidenceDigest", "operatorDecisionDigest", "integrationIntentDigest", "integratedAt"], "claim integration");
  return freeze({ candidateRevision: sha(value.candidateRevision, "integration candidate"),
    reviewRequestId: text(value.reviewRequestId, "integration review request"),
    focusedEvidenceDigest: digest(value.focusedEvidenceDigest, "integration focused evidence"),
    dependencyClosureDigest: digest(value.dependencyClosureDigest, "integration dependency closure"),
    namedChecksDigest: digest(value.namedChecksDigest, "integration named checks"),
    handoffEvidenceDigest: digest(value.handoffEvidenceDigest, "integration handoff evidence"),
    operatorDecisionDigest: digest(value.operatorDecisionDigest, "integration operator decision"),
    integrationIntentDigest: digest(value.integrationIntentDigest, "integration intent"),
    integratedAt: instant(value.integratedAt, "integration instant") });
}
function absence(value) {
  exact(value, ["targetAbsent", "branchAbsent", "worktreeAbsent", "leaseAbsent"], "local absence");
  if (!Object.values(value).every(item => item === true)) invalid("local absence");
  return freeze({ ...value });
}
function assertJoins(value) {
  const { repository: repo, actor: owner, pullRequest: pull, marker: lease, claim: cloud } = value;
  const authority = lease.cloudAuthority, admission = lease.admission;
  const branchIdentity = lease.branch.match(/^agent\/([^/]+)\/([^/]+)$/u);
  const firstRefreshMain = refreshFirstMain(value.refresh);
  const expectedClaimId = digestValue({ actorId: cloud.actorId, canonicalBaseRevision: cloud.canonicalBaseRevision,
    leaseEpoch: cloud.leaseEpoch, repositoryId: cloud.repositoryId, workItemId: cloud.workItemId,
    writeSetDigest: cloud.writeSetDigest });
  if (value.canonical.headSha !== value.canonical.currentMainSha
    || path.dirname(value.target.path) !== value.target.managedRoot
    || value.branch !== pull.headBranch || value.branch !== lease.branch || value.remoteHeadSha !== pull.headSha
    || pull.headRepository !== repo.nameWithOwner || pull.baseRepository !== repo.nameWithOwner || pull.authorLogin !== owner.login
    || pull.markerDigest !== lease.markerDigest || lease.baseSha !== cloud.canonicalBaseRevision
    || lease.reviewHeadSha !== cloud.laneRevision || lease.scope !== admission.semanticScope
    || branchIdentity?.[1] !== lease.device || branchIdentity?.[2] !== lease.scope
    || authority.claimId !== cloud.claimId || authority.entrySchema !== cloud.entrySchema
    || authority.claimIdentitySchema !== cloud.claimIdentitySchema || authority.canonicalBaseSha !== cloud.canonicalBaseRevision
    || authority.laneRevision !== cloud.laneRevision || authority.writeSetDigest !== cloud.writeSetDigest
    || authority.leaseEpoch !== cloud.leaseEpoch || authority.reviewRequestId !== cloud.reviewRequestId
    || authority.deviceId !== lease.device || authority.sessionId !== lease.sessionId
    || cloud.claimId !== expectedClaimId || cloud.integrationReceiptDigest !== cloud.operationReceiptDigest
    || cloud.expiresAt !== authority.expiresAt || lease.expiresAt !== authority.expiresAt
    || cloud.transitionCounter !== authority.transitionCounter + 1
    || cloud.integration.candidateRevision !== cloud.laneRevision
    || cloud.integration.reviewRequestId !== cloud.reviewRequestId
    || cloud.integration.focusedEvidenceDigest !== authority.focusedEvidenceDigest
    || admission.writeSetDigest !== cloud.writeSetDigest
    || JSON.stringify(admission.declaredWriteSet) !== JSON.stringify(cloud.declaredWriteScope)
    || JSON.stringify(authority.cloudDeclaredWriteScope) !== JSON.stringify(cloud.declaredWriteScope)
    || cloud.actorId !== owner.claimActorId || cloud.repositoryId !== repo.claimRepositoryId
    || cloud.reviewRequestId !== pull.reviewRequestId
    || authority.ledgerRepository !== repo.nameWithOwner || authority.targetRepository !== repo.nameWithOwner
    || (value.refresh === null && pull.headSha !== lease.reviewHeadSha)
    || (value.refresh !== null && (value.refresh.deliveredHeadSha !== lease.reviewHeadSha
      || value.refresh.refreshedHeadSha !== pull.headSha || firstRefreshMain !== pull.baseSha))) invalid("joined subject");
}

function refresh(value) {
  if (value === null) return null;
  if (value?.schema === "agentic-protected-main-refresh/v1") {
    exact(value, ["schema", "deliveredHeadSha", "refreshedHeadSha", "mainParentSha"], "refresh");
    return freeze({ schema: value.schema, deliveredHeadSha: sha(value.deliveredHeadSha, "refresh delivered head"),
      refreshedHeadSha: sha(value.refreshedHeadSha, "refresh head"), mainParentSha: sha(value.mainParentSha, "refresh main") });
  }
  if (value?.schema !== "agentic-protected-main-refresh-chain/v1") invalid("refresh schema");
  exact(value, ["schema", "deliveredHeadSha", "refreshedHeadSha", "refreshCount", "refreshes"], "refresh chain");
  if (!Number.isSafeInteger(value.refreshCount) || value.refreshCount < 2 || value.refreshCount > 8
    || !Array.isArray(value.refreshes) || value.refreshes.length !== value.refreshCount) invalid("refresh bound");
  const steps = value.refreshes.map((step, index) => {
    exact(step, ["previousHeadSha", "refreshedHeadSha", "mainParentSha", "treeSha"], `refresh ${index + 1}`);
    return freeze({ previousHeadSha: sha(step.previousHeadSha, "refresh previous"), refreshedHeadSha: sha(step.refreshedHeadSha, "refresh head"),
      mainParentSha: sha(step.mainParentSha, "refresh main"), treeSha: sha(step.treeSha, "refresh tree") });
  });
  if (steps[0].previousHeadSha !== value.deliveredHeadSha || steps.at(-1).refreshedHeadSha !== value.refreshedHeadSha
    || steps.some((step, index) => index > 0 && step.previousHeadSha !== steps[index - 1].refreshedHeadSha)) invalid("refresh chain join");
  return freeze({ ...value, deliveredHeadSha: sha(value.deliveredHeadSha, "refresh delivered head"),
    refreshedHeadSha: sha(value.refreshedHeadSha, "refresh final head"), refreshes: freeze(steps) });
}
function refreshFirstMain(value) { return value?.schema === "agentic-protected-main-refresh/v1"
  ? value.mainParentSha : value?.refreshes?.[0]?.mainParentSha || null; }

function intent(value) {
  exact(value, ["schema", "operationId", "planDigest", "planSnapshot", "status", "attempts", "phases", "receipt"], "intent");
  if (value.schema !== INTENT_SCHEMA || !PHASES.includes(value.status)) invalid("intent status");
  const planSnapshot = normalizeOpenReviewedLaneRehydrationPlan(value.planSnapshot);
  if (digest(value.planDigest, "intent plan digest") !== planSnapshot.planDigest
    || digest(value.operationId, "operation ID") !== digestValue({ schema: INTENT_SCHEMA, planDigest: value.planDigest })) invalid("intent identity");
  const attempts = normalizeAttempts(value.attempts, value.status, value.operationId, value.planDigest);
  const receipt = value.receipt === null ? null : normalizeOpenReviewedLaneRehydrationReceipt(value.receipt);
  if ((value.status === "complete") !== Boolean(receipt)) invalid("intent receipt");
  const phases = normalizePhases(value.phases, value.status);
  if (receipt && digestValue(receipt.phases) !== digestValue(phases)) invalid("receipt phase chain");
  assertPhasePlanJoins(phases, planSnapshot.evidence);
  if (receipt) assertReceiptPlanJoins(receipt, planSnapshot.evidence);
  return freeze({ ...value, planSnapshot, attempts, phases, receipt });
}
function assertPhasePlanJoins(phases, evidence) {
  const branch = phases["branch-created"], worktree = phases["worktree-created"], lease = phases["lease-recovered"];
  if (branch && (branch.branch !== evidence.branch || branch.headSha !== evidence.remoteHeadSha)
    || worktree && (worktree.targetPath !== evidence.target.path || worktree.headSha !== evidence.remoteHeadSha)
    || lease && (lease.epoch !== evidence.marker.epoch || lease.sessionId !== evidence.marker.sessionId
      )) invalid("phase plan join");
}
function assertReceiptPlanJoins(receipt, evidence) {
  if (receipt.repository.nameWithOwner !== evidence.repository.nameWithOwner
    || receipt.repository.nodeId !== evidence.repository.nodeId
    || receipt.repository.claimRepositoryId !== evidence.repository.claimRepositoryId
    || receipt.branch !== evidence.branch || receipt.targetPath !== evidence.target.path
    || receipt.remoteHeadSha !== evidence.remoteHeadSha || receipt.currentMainSha !== evidence.canonical.currentMainSha
    || receipt.pullRequest.number !== evidence.pullRequest.number || receipt.pullRequest.nodeId !== evidence.pullRequest.nodeId
    || receipt.pullRequest.url !== evidence.pullRequest.url || receipt.claim.claimId !== evidence.claim.claimId
    || receipt.claim.workItemId !== evidence.claim.workItemId || receipt.claim.fenceRevision !== evidence.claim.fenceRevision
    || receipt.claim.transitionCounter !== evidence.claim.transitionCounter || receipt.claim.leaseEpoch !== evidence.claim.leaseEpoch
    || receipt.leaseDigest !== receipt.phases["lease-recovered"].leaseDigest
    || receipt.registrationDigest !== receipt.phases["worktree-created"].registrationDigest) invalid("receipt plan join");
}
function receiptPullRequest(value) {
  exact(value, ["number", "nodeId", "url"], "receipt pull request");
  if (!Number.isSafeInteger(value.number) || value.number < 1) invalid("receipt pull request");
  return freeze({ number: value.number, nodeId: text(value.nodeId, "receipt pull request ID"),
    url: text(value.url, "receipt pull request URL") });
}
function receiptClaim(value) {
  exact(value, ["claimId", "workItemId", "fenceRevision", "transitionCounter", "leaseEpoch"], "receipt claim");
  if (!WORK_ITEM.test(String(value.workItemId || "")) || !Number.isSafeInteger(value.transitionCounter)
    || value.transitionCounter < 1 || !Number.isSafeInteger(value.leaseEpoch) || value.leaseEpoch < 1) invalid("receipt claim");
  return freeze({ claimId: digest(value.claimId, "receipt claim ID"), workItemId: value.workItemId,
    fenceRevision: digest(value.fenceRevision, "receipt claim fence"), transitionCounter: value.transitionCounter,
    leaseEpoch: value.leaseEpoch });
}
function normalizeAttempts(value, status, operationId, planDigest) {
  if (!Array.isArray(value) || value.length > 3) invalid("intent attempts");
  const completedCount = Math.min(PHASES.indexOf(status), 3);
  if (value.length < completedCount || value.length > Math.min(completedCount + 1, 3)) invalid("intent attempts");
  const result = value.map((attempt, index) => {
    exact(attempt, ["phase", "attemptDigest"], `attempt ${index + 1}`);
    const phase = PHASES[index + 1];
    if (attempt.phase !== phase || attempt.attemptDigest !== digestValue({ schema: INTENT_SCHEMA,
      operationId, planDigest, phase })) invalid("attempt identity");
    return freeze({ phase, attemptDigest: digest(attempt.attemptDigest, "attempt digest") });
  });
  return freeze(result);
}
function normalizePhases(value, status) {
  const count = Math.min(PHASES.indexOf(status), 3);
  const keys = PHASES.slice(1, 1 + count);
  exact(value, keys, "intent phases");
  const result = {};
  if (keys.includes("branch-created")) {
    const phase = value["branch-created"];
    exact(phase, ["branch", "headSha", "refDigest"], "branch phase");
    const branch = text(phase.branch, "phase branch"), headSha = sha(phase.headSha, "phase branch head");
    if (phase.refDigest !== digestValue({ branch, head: headSha })) invalid("phase ref");
    result["branch-created"] = freeze({ branch, headSha, refDigest: digest(phase.refDigest, "phase ref") });
  }
  if (keys.includes("worktree-created")) {
    const phase = value["worktree-created"];
    exact(phase, ["targetPath", "headSha", "registrationDigest"], "worktree phase");
    result["worktree-created"] = freeze({ targetPath: absolute(phase.targetPath, "phase target"),
      headSha: sha(phase.headSha, "phase worktree head"), registrationDigest: digest(phase.registrationDigest, "phase registration") });
  }
  if (keys.includes("lease-recovered")) {
    const phase = value["lease-recovered"];
    exact(phase, ["leaseDigest", "epoch", "sessionId", "leaseCasReceiptDigest",
      "leaseRegistryBeforeRevision", "leaseRegistryBeforeDigest",
      "leaseRegistryAfterRevision", "leaseRegistryAfterDigest"], "lease phase");
    if (!Number.isSafeInteger(phase.epoch) || phase.epoch < 1) invalid("phase lease epoch");
    if (!Number.isSafeInteger(phase.leaseRegistryBeforeRevision) || phase.leaseRegistryBeforeRevision < 0
      || phase.leaseRegistryBeforeRevision >= Number.MAX_SAFE_INTEGER
      || phase.leaseRegistryAfterRevision !== phase.leaseRegistryBeforeRevision + 1) invalid("phase lease registry revision");
    result["lease-recovered"] = freeze({ leaseDigest: digest(phase.leaseDigest, "phase lease"),
      epoch: phase.epoch, sessionId: text(phase.sessionId, "phase lease session"),
      leaseCasReceiptDigest: digest(phase.leaseCasReceiptDigest, "phase lease CAS receipt"),
      leaseRegistryBeforeRevision: phase.leaseRegistryBeforeRevision,
      leaseRegistryBeforeDigest: digest(phase.leaseRegistryBeforeDigest, "phase lease registry before"),
      leaseRegistryAfterRevision: phase.leaseRegistryAfterRevision,
      leaseRegistryAfterDigest: digest(phase.leaseRegistryAfterDigest, "phase lease registry after") });
  }
  return freeze(result);
}
function exact(value, keys, label) { if (!value || typeof value !== "object" || Array.isArray(value)
  || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) invalid(label); }
function text(value, label) { if (typeof value !== "string" || !value || value !== value.trim() || value.includes("\0")) invalid(label); return value; }
function absolute(value, label) { text(value, label); if (!value.startsWith("/")) invalid(label); return value; }
function sha(value, label) { if (!SHA.test(String(value || ""))) invalid(label); return value; }
function digest(value, label) { if (!DIGEST.test(String(value || ""))) invalid(label); return value; }
function instant(value, label) { if (typeof value !== "string" || new Date(value).toISOString() !== value) invalid(label); return value; }
function freeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
function invalid(label) { throw new Error(`Open reviewed lane rehydration ${label} is invalid.`); }
