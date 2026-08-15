// Responsibility: Seal plans, phase journals, and receipts for one fence-only recovery.
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import { normalizePlannedFenceOnlyAdmissionRecoveryEvidence }
  from "./planned-fence-only-admission-recovery-evidence.mjs";

export const PLANNED_FENCE_ONLY_ADMISSION_RECOVERY_OPERATION =
  "planned-fence-only-admission-recovery";
export const PLANNED_FENCE_ONLY_ADMISSION_RECOVERY_PLAN_SCHEMA =
  "agentic-planned-fence-only-admission-recovery-plan/v2";
export const PLANNED_FENCE_ONLY_ADMISSION_RECOVERY_INTENT_SCHEMA =
  "agentic-planned-fence-only-admission-recovery-intent/v2";
export const PLANNED_FENCE_ONLY_ADMISSION_RECOVERY_PHASES = Object.freeze([
  "authorized",
  "task_authority_verified",
  "local_projection_prepared",
  "local_projection_restored",
  "cloud_request_sealed",
  "cloud_recovered",
  "lease_projected",
  "review_marker_projected",
  "verified",
  "complete",
]);

const ROLLBACK_BOUNDARY = "before-cloud-request-sealed";
const PHASE_VALUE_KEYS = Object.freeze({
  authorized: ["authorizationDigest"],
  task_authority_verified: ["bindingDigest", "taskAuthorityReceiptDigest"],
  local_projection_prepared: [
    "branch", "headSha", "mode", "mutationSet", "protectedMainAdvanceDigest",
    "rollbackBoundary", "sourceProjectionDigest", "targetPath",
  ],
  local_projection_restored: [
    "branch", "branchProjectionDigest", "headSha", "mode", "mutationSet",
    "restoredProjectionDigest", "rollbackBoundary", "targetPath",
    "worktreeProjectionDigest",
  ],
  cloud_request_sealed: [
    "expectedFenceRevision", "expectedTransitionCounter", "idempotencyKey",
    "recoveryEvidenceDigest", "sealedTransportDigest", "ttlSeconds",
  ],
  cloud_recovered: [
    "authority", "authorityDigest", "disposition", "expiresAt", "idempotencyKey",
    "inventoryDigest", "operationReceiptDigest", "providerReceiptDigest", "recoveredAt",
    "sealedTransportDigest", "semanticOperationDigest", "targetClaimDigest",
    "transitionCounter", "verificationReceiptDigest",
  ],
  lease_projected: [
    "disposition", "expiresAt", "heartbeatAt", "leaseDigest", "recoveryReceiptDigest",
  ],
  review_marker_projected: [
    "bodyDigest", "disposition", "markerDigest", "providerMutation", "visibleBodyDigest",
  ],
  verified: [
    "bodyDigest", "cloudVerificationReceiptDigest", "inventoryDigest", "leaseDigest",
    "localProjectionDigest", "markerDigest", "overlappingClaimIdsDigest",
    "targetClaimDigest", "terminalTargetDigest",
  ],
  complete: [],
});

const BASE_ALLOWED_EFFECTS = Object.freeze([
  "same-claim-dormant-recovery",
  "writer-lease-projection",
  "hidden-review-marker-projection",
  "private-journal",
]);
const FORBIDDEN_EFFECTS = Object.freeze([
  "new-claim", "new-logical-branch", "new-commit", "new-review", "source-change",
  "existing-local-ref-move", "remote-ref-change", "push", "merge", "cleanup",
  "authoring-authority", "integration-authority", "deployment",
]);

export function buildPlannedFenceOnlyAdmissionRecoveryPlan({ evidence, ttlSeconds = 3_600 } = {}) {
  const normalizedEvidence = normalizePlannedFenceOnlyAdmissionRecoveryEvidence(evidence);
  const normalizedTtl = integer(ttlSeconds, "recovery TTL", 300, 86_400);
  const localMutationSet = normalizedEvidence.localProjection.mutationSet;
  const core = {
    schema: PLANNED_FENCE_ONLY_ADMISSION_RECOVERY_PLAN_SCHEMA,
    operation: PLANNED_FENCE_ONLY_ADMISSION_RECOVERY_OPERATION,
    evidence: normalizedEvidence,
    ttlSeconds: normalizedTtl,
    localMutationSet,
    allowedEffects: Object.freeze([...localMutationSet, ...BASE_ALLOWED_EFFECTS]),
    forbiddenEffects: FORBIDDEN_EFFECTS,
    terminalStatus: "recovered-planned-fence-only",
  };
  const planDigest = digestValue(core);
  return deepFreeze({
    ...core,
    planDigest,
    exactAuthorization: `authorize ${PLANNED_FENCE_ONLY_ADMISSION_RECOVERY_OPERATION} ${planDigest}`,
    taskAuthorityOperation: `${PLANNED_FENCE_ONLY_ADMISSION_RECOVERY_OPERATION}:${planDigest}`,
  });
}

export function normalizePlannedFenceOnlyAdmissionRecoveryPlan(value) {
  if (value?.schema !== PLANNED_FENCE_ONLY_ADMISSION_RECOVERY_PLAN_SCHEMA) invalid("plan schema");
  const rebuilt = buildPlannedFenceOnlyAdmissionRecoveryPlan(value);
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("plan projection");
  return rebuilt;
}

export function authorizePlannedFenceOnlyAdmissionRecovery({ plan, authorization } = {}) {
  const normalizedPlan = normalizePlannedFenceOnlyAdmissionRecoveryPlan(plan);
  if (authorization !== normalizedPlan.exactAuthorization) {
    throw new Error(`Exact authorization required: ${normalizedPlan.exactAuthorization}`);
  }
  const core = {
    schema: "agentic-planned-fence-only-admission-recovery-authorization/v1",
    planDigest: normalizedPlan.planDigest,
    statement: authorization,
  };
  return deepFreeze({ ...core, authorizationDigest: digestValue(core) });
}

export function createPlannedFenceOnlyAdmissionRecoveryIntent(plan, authorization) {
  const normalizedPlan = normalizePlannedFenceOnlyAdmissionRecoveryPlan(plan);
  const authority = authorizePlannedFenceOnlyAdmissionRecovery({
    plan: normalizedPlan,
    authorization,
  });
  const first = phaseReceipt({
    plan: normalizedPlan,
    phase: "authorized",
    previousReceiptDigest: null,
    values: { authorizationDigest: authority.authorizationDigest },
  });
  return sealIntent({
    status: "authorized",
    plan: normalizedPlan,
    authorization: authority,
    phases: { authorized: first },
    completion: null,
  });
}

export function advancePlannedFenceOnlyAdmissionRecoveryIntent(value, { status, values = {} } = {}) {
  const current = normalizePlannedFenceOnlyAdmissionRecoveryIntent(value);
  const sourceIndex = PLANNED_FENCE_ONLY_ADMISSION_RECOVERY_PHASES.indexOf(current.status);
  const targetIndex = PLANNED_FENCE_ONLY_ADMISSION_RECOVERY_PHASES.indexOf(status);
  if (targetIndex !== sourceIndex + 1) invalid("phase transition");
  const receipt = phaseReceipt({
    plan: current.planSnapshot,
    phase: status,
    previousReceiptDigest: current.phases[current.status].receiptDigest,
    values,
  });
  const phases = { ...current.phases, [status]: receipt };
  assertPhaseLineage(current.planSnapshot, phases);
  const completion = status === "complete"
    ? buildCompletion({ plan: current.planSnapshot, phases }) : null;
  return sealIntent({
    status,
    plan: current.planSnapshot,
    authorization: current.authorization,
    phases,
    completion,
  });
}

export function normalizePlannedFenceOnlyAdmissionRecoveryIntent(value) {
  if (value?.schema !== PLANNED_FENCE_ONLY_ADMISSION_RECOVERY_INTENT_SCHEMA
    || !PLANNED_FENCE_ONLY_ADMISSION_RECOVERY_PHASES.includes(value.status)) invalid("intent");
  const plan = normalizePlannedFenceOnlyAdmissionRecoveryPlan(value.planSnapshot);
  const authority = authorizePlannedFenceOnlyAdmissionRecovery({
    plan,
    authorization: value.authorization?.statement,
  });
  const names = PLANNED_FENCE_ONLY_ADMISSION_RECOVERY_PHASES.slice(
    0,
    PLANNED_FENCE_ONLY_ADMISSION_RECOVERY_PHASES.indexOf(value.status) + 1,
  );
  if (canonicalJson(Object.keys(value.phases || {})) !== canonicalJson(names)) invalid("intent phases");
  const phases = {};
  let previousReceiptDigest = null;
  for (const phase of names) {
    const receipt = phaseReceipt({
      plan,
      phase,
      previousReceiptDigest,
      values: value.phases?.[phase]?.values,
    });
    phases[phase] = receipt;
    previousReceiptDigest = receipt.receiptDigest;
  }
  assertPhaseLineage(plan, phases);
  const completion = value.status === "complete" ? buildCompletion({ plan, phases }) : null;
  const rebuilt = sealIntent({ status: value.status, plan, authorization: authority, phases, completion });
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("intent projection");
  return rebuilt;
}

export function normalizePlannedFenceOnlyTerminalVerification({ plan, intent, values } = {}) {
  const normalizedPlan = normalizePlannedFenceOnlyAdmissionRecoveryPlan(plan);
  const normalizedIntent = normalizePlannedFenceOnlyAdmissionRecoveryIntent(intent);
  if (normalizedIntent.planDigest !== normalizedPlan.planDigest
    || normalizedIntent.status !== "verified") invalid("terminal verification intent");
  const normalizedValues = normalizePhaseValues("verified", values);
  assertVerifiedLineage(normalizedPlan, normalizedIntent.phases, normalizedValues);
  return normalizedValues;
}

export function buildPlannedFenceOnlyLeaseRecoveryReceipt({
  plan,
  taskAuthorityReceiptDigest,
  sealedTransportDigest,
  semanticOperationDigest,
  recoveredAuthority,
  recoveredAt,
  operationReceiptDigest,
  providerReceiptDigest,
  idempotencyKey,
} = {}) {
  const normalizedPlan = normalizePlannedFenceOnlyAdmissionRecoveryPlan(plan);
  const source = normalizedPlan.evidence.sourceLease;
  const target = record(recoveredAuthority, "recovered cloud authority");
  const core = {
    schema: "agentic-planned-fence-only-admission-recovery-lease-receipt/v2",
    status: "recovered-planned",
    planDigest: normalizedPlan.planDigest,
    evidenceDigest: normalizedPlan.evidence.evidenceDigest,
    sourceLeaseDigest: normalizedPlan.evidence.sourceLeaseDigest,
    claimId: digest(target.claimId, "recovered claim identity"),
    sourceClaimDigest: digest(source.cloudAuthority.claimDigest, "source claim digest"),
    recoveredClaimDigest: digest(target.claimDigest, "recovered claim digest"),
    sourceTransitionCounter: positive(source.cloudAuthority.transitionCounter, "source transition"),
    recoveredTransitionCounter: positive(target.transitionCounter, "recovered transition"),
    sealedTransportDigest: digest(sealedTransportDigest, "sealed cloud transport digest"),
    semanticOperationDigest: digest(semanticOperationDigest, "semantic cloud operation digest"),
    operationReceiptDigest: digest(operationReceiptDigest, "cloud operation receipt"),
    providerReceiptDigest: digest(providerReceiptDigest, "cloud provider receipt"),
    idempotencyKey: digest(idempotencyKey, "cloud idempotency key"),
    taskAuthorityReceiptDigest: digest(taskAuthorityReceiptDigest, "task authority receipt"),
    taskAuthorityBindingDigest: digest(source.taskAuthority.bindingDigest, "task binding digest"),
    admissionDigest: digestValue(source.admission),
    localProjectionDigest: normalizedPlan.evidence.localProjectionDigest,
    protectedMainAdvanceDigest: normalizedPlan.evidence.protectedMainAdvance.advanceDigest,
    recoveredAt: instant(recoveredAt, "recovery time"),
    authoringAuthority: false,
    mutationAuthorityGranted: false,
  };
  if (target.claimId !== source.cloudAuthority.claimId
    || target.transitionCounter !== source.cloudAuthority.transitionCounter + 1
    || target.operationReceiptDigest !== operationReceiptDigest
    || core.sealedTransportDigest === core.semanticOperationDigest) {
    invalid("same-claim recovery receipt");
  }
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

export function buildPlannedFenceOnlyAdmissionRecoveryCompletion(value) {
  const intent = normalizePlannedFenceOnlyAdmissionRecoveryIntent(value);
  if (intent.status !== "complete") invalid("completion phase");
  return intent.completion;
}

function phaseReceipt({ plan, phase, previousReceiptDigest, values }) {
  if (!PLANNED_FENCE_ONLY_ADMISSION_RECOVERY_PHASES.includes(phase)) invalid("phase");
  const normalizedValues = normalizePhaseValues(phase, values);
  if (phase === "task_authority_verified"
    && normalizedValues.bindingDigest !== plan.evidence.sourceLease.taskAuthority.bindingDigest) {
    invalid("task authority binding join");
  }
  if (phase === "cloud_request_sealed" && (
    normalizedValues.expectedFenceRevision !== plan.evidence.cloud.claim.fenceRevision
    || normalizedValues.expectedTransitionCounter !== plan.evidence.cloud.claim.transitionCounter
    || normalizedValues.ttlSeconds !== plan.ttlSeconds
    || normalizedValues.recoveryEvidenceDigest !== plan.evidence.evidenceDigest
  )) invalid("sealed cloud request join");
  const core = {
    schema: "agentic-planned-fence-only-admission-recovery-phase-receipt/v2",
    phase,
    planDigest: plan.planDigest,
    operationKey: `${PLANNED_FENCE_ONLY_ADMISSION_RECOVERY_OPERATION}:${phase}:${digestValue({ planDigest: plan.planDigest, phase })}`,
    previousReceiptDigest,
    values: normalizedValues,
    valuesDigest: digestValue(normalizedValues),
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function normalizePhaseValues(phase, values) {
  const source = cloneRecord(values, `${phase} values`);
  exactKeys(source, PHASE_VALUE_KEYS[phase], `${phase} values`);
  if (phase === "authorized") digest(source.authorizationDigest, "authorization digest");
  else if (phase === "task_authority_verified") {
    digest(source.taskAuthorityReceiptDigest, "task authority receipt");
    digest(source.bindingDigest, "task binding digest");
  } else if (phase === "local_projection_prepared") {
    normalizeLocalPhaseIdentity(source);
    digest(source.sourceProjectionDigest, "source local projection digest");
    digest(source.protectedMainAdvanceDigest, "protected-main advance digest");
    requireRollbackBoundary(source.rollbackBoundary);
  } else if (phase === "local_projection_restored") {
    normalizeLocalPhaseIdentity(source);
    digest(source.branchProjectionDigest, "restored branch projection digest");
    digest(source.worktreeProjectionDigest, "restored worktree projection digest");
    digest(source.restoredProjectionDigest, "restored local projection digest");
    requireRollbackBoundary(source.rollbackBoundary);
  } else if (phase === "cloud_request_sealed") {
    digest(source.sealedTransportDigest, "sealed cloud transport digest");
    digest(source.idempotencyKey, "cloud idempotency key");
    digest(source.expectedFenceRevision, "expected cloud fence");
    positive(source.expectedTransitionCounter, "expected transition");
    integer(source.ttlSeconds, "sealed TTL", 300, 86_400);
    digest(source.recoveryEvidenceDigest, "recovery evidence digest");
  } else if (phase === "cloud_recovered") {
    record(source.authority, "recovered authority");
    digest(source.authorityDigest, "recovered authority digest");
    if (source.authorityDigest !== digestValue(source.authority)) invalid("recovered authority projection");
    for (const [field, label] of [
      ["verificationReceiptDigest", "cloud verification receipt"],
      ["inventoryDigest", "cloud inventory digest"],
      ["operationReceiptDigest", "cloud operation receipt"],
      ["providerReceiptDigest", "cloud provider receipt"],
      ["idempotencyKey", "cloud idempotency key"],
      ["sealedTransportDigest", "sealed cloud transport digest"],
      ["semanticOperationDigest", "semantic cloud operation digest"],
      ["targetClaimDigest", "recovered target claim"],
    ]) digest(source[field], label);
    positive(source.transitionCounter, "recovered transition");
    instant(source.expiresAt, "recovered expiry");
    instant(source.recoveredAt, "recovered time");
    if (source.transitionCounter !== source.authority.transitionCounter
      || source.expiresAt !== source.authority.expiresAt
      || source.operationReceiptDigest !== source.authority.operationReceiptDigest
      || source.sealedTransportDigest === source.semanticOperationDigest) {
      invalid("recovered authority semantic join");
    }
    if (!["projected", "replayed"].includes(source.disposition)) invalid("cloud disposition");
  } else if (phase === "lease_projected") {
    digest(source.leaseDigest, "projected lease digest");
    digest(source.recoveryReceiptDigest, "lease recovery receipt digest");
    instant(source.heartbeatAt, "projected heartbeat");
    instant(source.expiresAt, "projected expiry");
    if (!["projected", "adopted"].includes(source.disposition)) invalid("lease disposition");
  } else if (phase === "review_marker_projected") {
    digest(source.bodyDigest, "review body digest");
    digest(source.visibleBodyDigest, "visible review body digest");
    digest(source.markerDigest, "review marker digest");
    if (!["projected", "adopted"].includes(source.disposition)) invalid("review disposition");
    if (source.providerMutation !== (source.disposition === "projected")) invalid("review mutation receipt");
  } else if (phase === "verified") {
    for (const [field, label] of [
      ["bodyDigest", "terminal review body"],
      ["cloudVerificationReceiptDigest", "terminal cloud receipt"],
      ["inventoryDigest", "terminal inventory"],
      ["leaseDigest", "terminal lease"],
      ["localProjectionDigest", "terminal local projection"],
      ["markerDigest", "terminal marker"],
      ["overlappingClaimIdsDigest", "terminal overlapping claims"],
      ["targetClaimDigest", "terminal target claim"],
      ["terminalTargetDigest", "terminal target"],
    ]) digest(source[field], label);
  } else if (phase !== "complete") invalid("phase values");
  return deepFreeze(source);
}

function assertPhaseLineage(plan, phases) {
  const prepared = phases.local_projection_prepared?.values;
  const restored = phases.local_projection_restored?.values;
  const request = phases.cloud_request_sealed?.values;
  const cloud = phases.cloud_recovered?.values;
  const lease = phases.lease_projected?.values;
  const marker = phases.review_marker_projected?.values;
  const verified = phases.verified?.values;
  if (prepared) assertPreparedProjectionJoin(plan, prepared);
  if (restored) assertRestoredProjectionJoin(plan, prepared, restored);
  if (cloud && (
    cloud.idempotencyKey !== request.idempotencyKey
    || cloud.sealedTransportDigest !== request.sealedTransportDigest
    || cloud.transitionCounter !== plan.evidence.sourceLease.cloudAuthority.transitionCounter + 1
  )) invalid("cloud recovery lineage");
  if (lease && (
    lease.expiresAt !== cloud.expiresAt || lease.heartbeatAt !== cloud.recoveredAt
  )) invalid("lease recovery timing join");
  if (verified) assertVerifiedLineage(plan, phases, verified);
  if (marker && marker.visibleBodyDigest !== plan.evidence.review.visibleBodyDigest) {
    invalid("review visible body lineage");
  }
}

function assertPreparedProjectionJoin(plan, values) {
  const local = plan.evidence.localProjection;
  if (values.mode !== local.mode
    || canonicalJson(values.mutationSet) !== canonicalJson(plan.localMutationSet)
    || values.branch !== local.branch || values.targetPath !== local.targetPath
    || values.headSha !== local.headSha
    || values.sourceProjectionDigest !== plan.evidence.localProjectionDigest
    || values.protectedMainAdvanceDigest !== plan.evidence.protectedMainAdvance.advanceDigest
    || values.rollbackBoundary !== ROLLBACK_BOUNDARY) invalid("prepared local projection join");
}

function assertRestoredProjectionJoin(plan, prepared, values) {
  if (!prepared
    || values.mode !== prepared.mode
    || canonicalJson(values.mutationSet) !== canonicalJson(prepared.mutationSet)
    || values.branch !== prepared.branch || values.targetPath !== prepared.targetPath
    || values.headSha !== prepared.headSha || values.rollbackBoundary !== prepared.rollbackBoundary) {
    invalid("restored local projection join");
  }
  const stable = {
    schema: "agentic-planned-fence-only-local-projection-restored/v1",
    planDigest: plan.planDigest,
    mode: values.mode,
    mutationSet: values.mutationSet,
    branch: values.branch,
    targetPath: values.targetPath,
    headSha: values.headSha,
    branchProjectionDigest: values.branchProjectionDigest,
    worktreeProjectionDigest: values.worktreeProjectionDigest,
  };
  if (values.restoredProjectionDigest !== digestValue(stable)) invalid("restored local projection digest");
}

function assertVerifiedLineage(plan, phases, values) {
  const restored = phases.local_projection_restored?.values;
  const cloud = phases.cloud_recovered?.values;
  const lease = phases.lease_projected?.values;
  const marker = phases.review_marker_projected?.values;
  if (!restored || !cloud || !lease || !marker
    || values.localProjectionDigest !== restored.restoredProjectionDigest
    || values.targetClaimDigest !== cloud.targetClaimDigest
    || values.leaseDigest !== lease.leaseDigest
    || values.markerDigest !== marker.markerDigest
    || values.bodyDigest !== marker.bodyDigest
    || values.overlappingClaimIdsDigest !== digestValue([])) invalid("terminal target lineage");
  const target = {
    schema: "agentic-planned-fence-only-terminal-target/v1",
    planDigest: plan.planDigest,
    bodyDigest: values.bodyDigest,
    leaseDigest: values.leaseDigest,
    localProjectionDigest: values.localProjectionDigest,
    markerDigest: values.markerDigest,
    overlappingClaimIdsDigest: values.overlappingClaimIdsDigest,
    targetClaimDigest: values.targetClaimDigest,
  };
  if (values.terminalTargetDigest !== digestValue(target)) invalid("terminal target digest");
}

function buildCompletion({ plan, phases }) {
  const task = phases.task_authority_verified;
  const prepared = phases.local_projection_prepared;
  const restored = phases.local_projection_restored;
  const request = phases.cloud_request_sealed;
  const cloud = phases.cloud_recovered;
  const lease = phases.lease_projected;
  const marker = phases.review_marker_projected;
  const verified = phases.verified;
  if (![task, prepared, restored, request, cloud, lease, marker, verified].every(Boolean)) {
    invalid("completion receipts");
  }
  const source = plan.evidence.sourceLease;
  const restoredLocalState = plan.evidence.localProjection.mode === "externally-lost";
  const core = {
    schema: "agentic-planned-fence-only-admission-recovery-completion/v2",
    status: "recovered-planned-fence-only",
    planDigest: plan.planDigest,
    evidenceDigest: plan.evidence.evidenceDigest,
    claimId: source.cloudAuthority.claimId,
    branch: source.branch,
    sessionId: source.sessionId,
    fenceSha: source.fenceSha,
    localLeaseEpoch: source.epoch,
    cloudLeaseEpoch: source.cloudAuthority.leaseEpoch,
    sourceTransitionCounter: source.cloudAuthority.transitionCounter,
    recoveredTransitionCounter: cloud.values.transitionCounter,
    admissionStatus: "planned",
    manifestDigest: source.admission.manifestDigest,
    writeSetDigest: source.admission.writeSetDigest,
    protectedMainAdvanceDigest: plan.evidence.protectedMainAdvance.advanceDigest,
    localProjectionMode: prepared.values.mode,
    localMutationSet: prepared.values.mutationSet,
    restoredLocalProjectionDigest: restored.values.restoredProjectionDigest,
    taskAuthorityBindingDigest: source.taskAuthority.bindingDigest,
    taskAuthorityReceiptDigest: task.values.taskAuthorityReceiptDigest,
    sealedCloudTransportDigest: request.values.sealedTransportDigest,
    semanticCloudOperationDigest: cloud.values.semanticOperationDigest,
    cloudOperationReceiptDigest: cloud.values.operationReceiptDigest,
    cloudProviderReceiptDigest: cloud.values.providerReceiptDigest,
    cloudIdempotencyKey: cloud.values.idempotencyKey,
    recoveredCloudAuthorityDigest: cloud.values.authorityDigest,
    projectedLeaseDigest: lease.values.leaseDigest,
    leaseRecoveryReceiptDigest: lease.values.recoveryReceiptDigest,
    reviewMarkerDigest: marker.values.markerDigest,
    terminalTargetDigest: verified.values.terminalTargetDigest,
    phaseReceiptDigests: PLANNED_FENCE_ONLY_ADMISSION_RECOVERY_PHASES
      .filter(name => name !== "complete").map(name => phases[name].receiptDigest),
    cloudMutation: true,
    writerRegistryMutation: true,
    hiddenReviewMarkerMutation: marker.values.providerMutation,
    journalMutation: true,
    sourceMutation: false,
    gitMutation: restoredLocalState,
    localRefProjectionMutation: restoredLocalState,
    worktreeRegistrationMutation: restoredLocalState,
    remoteRefMutation: false,
    newClaim: false,
    newBranch: false,
    newCommit: false,
    newReview: false,
    authoringAuthority: false,
    mutationAuthorityGranted: false,
    integrationAuthority: false,
    deploymentAuthority: false,
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function sealIntent({ status, plan, authorization, phases, completion }) {
  const core = {
    schema: PLANNED_FENCE_ONLY_ADMISSION_RECOVERY_INTENT_SCHEMA,
    status,
    planDigest: plan.planDigest,
    planSnapshot: plan,
    authorization,
    phases,
    completion,
  };
  return deepFreeze({ ...core, intentDigest: digestValue(core) });
}

function normalizeLocalPhaseIdentity(value) {
  if (!["attached", "externally-lost"].includes(value.mode)) invalid("local projection phase mode");
  if (!Array.isArray(value.mutationSet)) invalid("local projection phase mutation set");
  const expected = value.mode === "attached" ? [] : ["local-branch", "registered-worktree"];
  if (canonicalJson(value.mutationSet) !== canonicalJson(expected)) invalid("local projection phase mutation set");
  text(value.branch, "local projection phase branch");
  absolute(value.targetPath, "local projection phase target");
  sha(value.headSha, "local projection phase head");
}
function requireRollbackBoundary(value) { if (value !== ROLLBACK_BOUNDARY) invalid("local rollback boundary"); }
function cloneRecord(value, label) { return structuredClone(record(value, label)); }
function exactKeys(value, expected, label) {
  if (!expected || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...expected].sort())) {
    invalid(label);
  }
}
function record(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label); return value; }
function text(value, label) { if (typeof value !== "string" || !value || value !== value.trim()) invalid(label); return value; }
function absolute(value, label) { const candidate = text(value, label); if (!candidate.startsWith("/")) invalid(label); return candidate; }
function sha(value, label) { if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) invalid(label); return value; }
function digest(value, label) { if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) invalid(label); return value; }
function positive(value, label) { if (!Number.isSafeInteger(value) || value < 1) invalid(label); return value; }
function integer(value, label, minimum, maximum) { if (!Number.isSafeInteger(value) || value < minimum || value > maximum) invalid(label); return value; }
function instant(value, label) { const parsed = new Date(value); if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) invalid(label); return value; }
function deepFreeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const item of Object.values(value)) deepFreeze(item); } return value; }
function invalid(label) { throw new Error(`Planned fence-only admission recovery has invalid ${label}.`); }
