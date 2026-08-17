// Responsibility: Seal one exact same-claim dormant-successor recovery and its phase chain.
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  normalizeActivePublishSuccessorDormantRecoveryEvidence,
} from "./active-publish-successor-dormant-recovery-evidence.mjs";

export const ACTIVE_PUBLISH_SUCCESSOR_DORMANT_RECOVERY_PLAN_SCHEMA =
  "agentic-active-publish-successor-dormant-recovery-plan/v1";
export const ACTIVE_PUBLISH_SUCCESSOR_DORMANT_RECOVERY_AUTHORIZATION_SCHEMA =
  "agentic-active-publish-successor-dormant-recovery-authorization/v1";
export const ACTIVE_PUBLISH_SUCCESSOR_DORMANT_RECOVERY_INTENT_SCHEMA =
  "agentic-active-publish-successor-dormant-recovery-intent/v1";
export const ACTIVE_PUBLISH_SUCCESSOR_DORMANT_RECOVERY_PHASE_SCHEMA =
  "agentic-active-publish-successor-dormant-recovery-phase/v1";
export const ACTIVE_PUBLISH_SUCCESSOR_DORMANT_RECOVERY_LEASE_RECEIPT_SCHEMA =
  "agentic-active-publish-successor-dormant-recovery-lease-receipt/v1";
export const ACTIVE_PUBLISH_SUCCESSOR_DORMANT_RECOVERY_TERMINAL_VERIFICATION_SCHEMA =
  "agentic-active-publish-successor-dormant-recovery-terminal-verification/v1";
export const ACTIVE_PUBLISH_SUCCESSOR_DORMANT_RECOVERY_COMPLETION_SCHEMA =
  "agentic-active-publish-successor-dormant-recovery-completion/v1";
export const ACTIVE_PUBLISH_SUCCESSOR_DORMANT_RECOVERY_PHASES = Object.freeze([
  "task_authority_verified",
  "cloud_request_sealed",
  "cloud_recovered",
  "lease_projected",
  "review_marker_projected",
  "verified",
  "complete",
]);

const OPERATION = "active-publish-successor-dormant-recovery";
const OPERATION_KEY_SCHEMA =
  "agentic-active-publish-successor-dormant-recovery-operation-key/v1";
const STATUSES = Object.freeze(["authorized", ...ACTIVE_PUBLISH_SUCCESSOR_DORMANT_RECOVERY_PHASES]);
const DIGEST = /^[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40}$/u;
const MINIMUM_TTL_SECONDS = 60;
const MAXIMUM_TTL_SECONDS = 86_400;

export function buildActivePublishSuccessorDormantRecoveryPlan(input, options = {}) {
  const evidenceInput = input?.evidence || input?.sourceEvidence || input;
  const ttlInput = input?.evidence || input?.sourceEvidence
    ? input.ttlSeconds
    : options.ttlSeconds;
  const evidence = normalizeActivePublishSuccessorDormantRecoveryEvidence(evidenceInput);
  return sealPlan({
    schema: ACTIVE_PUBLISH_SUCCESSOR_DORMANT_RECOVERY_PLAN_SCHEMA,
    operation: OPERATION,
    evidence,
    evidenceDigest: evidence.evidenceDigest,
    ttlSeconds: boundedTtl(ttlInput ?? 1_800),
  });
}

export function normalizeActivePublishSuccessorDormantRecoveryPlan(value) {
  exactKeys(value, [
    "schema", "operation", "evidence", "evidenceDigest", "ttlSeconds",
    "planDigest", "exactAuthorization",
  ], "plan");
  const expected = sealPlan({
    schema: text(value.schema, "plan schema"),
    operation: text(value.operation, "plan operation"),
    evidence: normalizeActivePublishSuccessorDormantRecoveryEvidence(value.evidence),
    evidenceDigest: digest(value.evidenceDigest, "plan evidence digest"),
    ttlSeconds: boundedTtl(value.ttlSeconds),
  });
  if (expected.schema !== ACTIVE_PUBLISH_SUCCESSOR_DORMANT_RECOVERY_PLAN_SCHEMA
    || expected.operation !== OPERATION
    || expected.evidenceDigest !== expected.evidence.evidenceDigest
    || canonicalJson(expected) !== canonicalJson(value)) {
    invalid("plan semantics or digest");
  }
  return expected;
}

export function authorizeActivePublishSuccessorDormantRecoveryPlan(plan, authorization) {
  if (arguments.length === 1 && plan?.plan) {
    authorization = plan.authorization;
    plan = plan.plan;
  }
  const normalized = normalizeActivePublishSuccessorDormantRecoveryPlan(plan);
  if (authorization !== normalized.exactAuthorization) {
    throw new Error(`Exact authorization required: ${normalized.exactAuthorization}`);
  }
  const core = {
    schema: ACTIVE_PUBLISH_SUCCESSOR_DORMANT_RECOVERY_AUTHORIZATION_SCHEMA,
    planDigest: normalized.planDigest,
    evidenceDigest: normalized.evidenceDigest,
    authorization,
  };
  return deepFreeze({ ...core, authorizationDigest: digestValue(core) });
}

export const authorizeActivePublishSuccessorDormantRecovery =
  authorizeActivePublishSuccessorDormantRecoveryPlan;

export function createActivePublishSuccessorDormantRecoveryIntent(
  plan,
  authorizationReceipt,
  startedAt = new Date().toISOString(),
) {
  const normalizedPlan = normalizeActivePublishSuccessorDormantRecoveryPlan(plan);
  const authorization = typeof authorizationReceipt === "string"
    ? authorizeActivePublishSuccessorDormantRecoveryPlan(normalizedPlan, authorizationReceipt)
    : normalizeAuthorization(authorizationReceipt, normalizedPlan);
  return sealIntent({
    schema: ACTIVE_PUBLISH_SUCCESSOR_DORMANT_RECOVERY_INTENT_SCHEMA,
    planDigest: normalizedPlan.planDigest,
    planSnapshot: normalizedPlan,
    authorizationDigest: authorization.authorizationDigest,
    startedAt: instant(startedAt, "intent start"),
    status: "authorized",
    phases: {},
  });
}

export function normalizeActivePublishSuccessorDormantRecoveryIntent(value) {
  exactKeys(value, [
    "schema", "planDigest", "planSnapshot", "authorizationDigest", "startedAt",
    "status", "phases", "intentDigest",
  ], "intent");
  const plan = normalizeActivePublishSuccessorDormantRecoveryPlan(value.planSnapshot);
  const core = {
    schema: text(value.schema, "intent schema"),
    planDigest: digest(value.planDigest, "intent plan digest"),
    planSnapshot: plan,
    authorizationDigest: digest(value.authorizationDigest, "intent authorization digest"),
    startedAt: instant(value.startedAt, "intent start"),
    status: requiredStatus(value.status),
    phases: {},
  };
  if (core.schema !== ACTIVE_PUBLISH_SUCCESSOR_DORMANT_RECOVERY_INTENT_SCHEMA
    || core.planDigest !== plan.planDigest
    || core.authorizationDigest !== authorizationDigestForPlan(plan)) {
    invalid("intent subject");
  }
  const statusIndex = STATUSES.indexOf(core.status);
  for (let index = 1; index <= statusIndex; index += 1) {
    const phase = STATUSES[index];
    const previousIntent = sealIntent({ ...core, status: STATUSES[index - 1] });
    core.phases[phase] = normalizePhaseRecord(
      value.phases?.[phase], plan, core.authorizationDigest, phase, previousIntent.intentDigest,
    );
  }
  if (!value.phases || Object.keys(value.phases).length !== statusIndex
    || Object.keys(value.phases).some(key => !Object.hasOwn(core.phases, key))) {
    invalid("intent phase order");
  }
  const expected = sealIntent(core);
  if (expected.intentDigest !== value.intentDigest) invalid("intent digest");
  return expected;
}

export function advanceActivePublishSuccessorDormantRecoveryIntent(
  intent,
  phase,
  evidence,
  recordedAt = new Date().toISOString(),
) {
  const current = normalizeActivePublishSuccessorDormantRecoveryIntent(intent);
  if (phase && typeof phase === "object") {
    recordedAt = phase.recordedAt ?? recordedAt;
    evidence = phase.values;
    phase = phase.status;
  }
  const next = requiredPhase(phase);
  const currentIndex = STATUSES.indexOf(current.status);
  const nextIndex = STATUSES.indexOf(next);
  if (nextIndex === currentIndex) {
    const normalizedEvidence = immutableJson(evidence, `${next} evidence`);
    if (canonicalJson(current.phases[next].values) !== canonicalJson(normalizedEvidence)) {
      throw new Error(`Recovery ${next} replay drifted.`);
    }
    return current;
  }
  if (nextIndex !== currentIndex + 1) {
    throw new Error(`Recovery cannot advance from ${current.status} to ${next}.`);
  }
  const record = buildPhaseRecord({
    planDigest: current.planDigest,
    authorizationDigest: current.authorizationDigest,
    phase: next,
    previousIntentDigest: current.intentDigest,
    evidence,
    recordedAt,
  });
  return sealIntent({
    schema: current.schema,
    planDigest: current.planDigest,
    planSnapshot: current.planSnapshot,
    authorizationDigest: current.authorizationDigest,
    startedAt: current.startedAt,
    status: next,
    phases: { ...current.phases, [next]: record },
  });
}

export function activePublishSuccessorDormantRecoveryOperationKey(
  planDigest,
  authorizationDigest,
  phase,
) {
  return digestValue({
    schema: OPERATION_KEY_SCHEMA,
    planDigest: digest(planDigest, "operation plan digest"),
    authorizationDigest: digest(authorizationDigest, "operation authorization digest"),
    phase: requiredPhase(phase),
  });
}

export function buildActivePublishSuccessorDormantRecoveryLeaseRecoveryReceipt(intent) {
  const normalized = normalizeActivePublishSuccessorDormantRecoveryIntent(intent);
  if (STATUSES.indexOf(normalized.status) < STATUSES.indexOf("cloud_recovered")) {
    throw new Error("Lease-recovery receipt requires cloud_recovered evidence.");
  }
  const request = normalized.phases.cloud_request_sealed;
  const recovery = normalized.phases.cloud_recovered;
  const taskAuthority = normalized.phases.task_authority_verified;
  const source = normalized.planSnapshot.evidence;
  const recoveredClaim = recovery.values.claim;
  if (!recoveredClaim || recoveredClaim.claimId !== source.cloud.claim.claimId
    || recoveredClaim.transitionCounter !== source.cloud.claim.transitionCounter + 1
    || recoveredClaim.state !== "current" || recoveredClaim.writeAuthority !== true
    || recoveredClaim.scopeReserved !== true) {
    throw new Error("Lease-recovery receipt requires the exact same-claim recovery transition.");
  }
  const core = {
    schema: ACTIVE_PUBLISH_SUCCESSOR_DORMANT_RECOVERY_LEASE_RECEIPT_SCHEMA,
    status: "cloud_recovered",
    planDigest: normalized.planDigest,
    evidenceDigest: normalized.planSnapshot.evidenceDigest,
    authorizationDigest: normalized.authorizationDigest,
    claimId: digest(source.cloud.claim.claimId, "claim ID"),
    sourceLeaseDigest: digest(source.lease.leaseDigest, "source lease digest"),
    taskAuthorityBindingDigest: digest(
      source.lease.taskAuthorityBindingDigest, "task-authority binding digest",
    ),
    taskAuthorityReceiptDigest: digest(
      source.successorReceipt.taskAuthorityReceiptDigest, "task-authority receipt digest",
    ),
    successorReceiptDigest: digest(
      source.successorReceipt.receiptDigest, "successor receipt digest",
    ),
    sourceClaim: source.cloud.claim,
    sourceClaimDigest: digest(source.cloud.claim.fenceRevision, "source claim digest"),
    sourceTransitionDigest: digest(
      source.cloud.claim.transitionDigest, "source transition digest",
    ),
    recoveredClaim,
    recoveredClaimDigest: digest(recoveredClaim.fenceRevision, "recovered claim digest"),
    recoveredTransitionDigest: digest(
      recoveredClaim.transitionDigest, "recovered transition digest",
    ),
    recoveredAuthorityDigest: digestValue(recovery.values),
    recoveredExpiresAt: instant(recoveredClaim.expiresAt, "recovered expiry"),
    recoveredAt: recovery.values.recoveredAt,
    taskAuthorityVerification: taskAuthority.values,
    taskAuthorityVerificationDigest: taskAuthority.valuesDigest,
    sealedCloudRequest: request.values,
    sealedCloudRequestDigest: request.valuesDigest,
    semanticRecoveryEvidenceDigest: digest(
      request.values.request?.recoveryEvidenceDigest,
      "semantic recovery evidence digest",
    ),
    cloudOperationReceiptDigest: digest(
      recovery.values.operationReceiptDigest, "cloud operation receipt digest",
    ),
    cloudProviderReceiptDigest: digest(
      recovery.values.providerReceiptDigest, "cloud provider receipt digest",
    ),
    cloudRequestOperationKey: request.operationKey,
    cloudRequestPhaseDigest: request.phaseDigest,
    cloudRecoveryOperationKey: recovery.operationKey,
    cloudRecoveryPhaseDigest: recovery.phaseDigest,
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

export function normalizeActivePublishSuccessorDormantRecoveryTerminalVerification(
  value,
  expectedPlan = null,
) {
  exactKeys(value, [
    "schema", "planDigest", "claimId", "sourceLeaseDigest", "projectedLeaseDigest",
    "leaseProjectionReceiptDigest", "reviewMarkerReceiptDigest",
    "cloudVerificationReceiptDigest", "mutationAuthority", "mutationAuthorityReceiptDigest",
    "verifiedAt", "gitMutation", "sourceMutation", "newClaim", "newPullRequest",
    "verificationDigest",
  ], "terminal verification");
  const core = {
    schema: text(value.schema, "terminal verification schema"),
    planDigest: digest(value.planDigest, "terminal plan digest"),
    claimId: digest(value.claimId, "terminal claim ID"),
    sourceLeaseDigest: digest(value.sourceLeaseDigest, "source lease digest"),
    projectedLeaseDigest: digest(value.projectedLeaseDigest, "projected lease digest"),
    leaseProjectionReceiptDigest: digest(
      value.leaseProjectionReceiptDigest, "lease projection receipt digest",
    ),
    reviewMarkerReceiptDigest: digest(
      value.reviewMarkerReceiptDigest, "review marker receipt digest",
    ),
    cloudVerificationReceiptDigest: digest(
      value.cloudVerificationReceiptDigest, "cloud verification receipt digest",
    ),
    mutationAuthority: normalizeMutationAuthority(value.mutationAuthority),
    mutationAuthorityReceiptDigest: digest(
      value.mutationAuthorityReceiptDigest, "mutation-authority receipt digest",
    ),
    verifiedAt: instant(value.verifiedAt, "terminal verification time"),
    gitMutation: exactFalse(value.gitMutation, "git mutation"),
    sourceMutation: exactFalse(value.sourceMutation, "source mutation"),
    newClaim: exactFalse(value.newClaim, "new claim"),
    newPullRequest: exactFalse(value.newPullRequest, "new pull request"),
  };
  if (core.schema !== ACTIVE_PUBLISH_SUCCESSOR_DORMANT_RECOVERY_TERMINAL_VERIFICATION_SCHEMA
    || core.mutationAuthorityReceiptDigest !== core.mutationAuthority.receiptDigest
    || value.verificationDigest !== digestValue(core)) {
    invalid("terminal verification digest");
  }
  if (expectedPlan) {
    const plan = expectedPlan.planSnapshot
      ? normalizeActivePublishSuccessorDormantRecoveryIntent(expectedPlan).planSnapshot
      : normalizeActivePublishSuccessorDormantRecoveryPlan(expectedPlan);
    if (core.planDigest !== plan.planDigest
      || core.claimId !== plan.evidence.cloud.claim.claimId
      || core.sourceLeaseDigest !== plan.evidence.lease.leaseDigest) {
      invalid("terminal verification subject");
    }
  }
  return deepFreeze({ ...core, verificationDigest: value.verificationDigest });
}

export function normalizeActivePublishSuccessorDormantTerminalVerification(input) {
  const plan = normalizeActivePublishSuccessorDormantRecoveryPlan(input?.plan);
  const intent = normalizeActivePublishSuccessorDormantRecoveryIntent(input?.intent);
  if (intent.planDigest !== plan.planDigest || intent.status !== "verified") {
    invalid("terminal verification intent");
  }
  const values = immutableJson(input.values, "terminal verification values");
  return deepFreeze({
    values,
    terminalTargetDigest: digestValue({
      schema: "agentic-active-publish-successor-dormant-recovery-terminal-target/v1",
      planDigest: plan.planDigest,
      claimId: plan.evidence.cloud.claim.claimId,
      values,
    }),
  });
}

export function buildActivePublishSuccessorDormantRecoveryCompletion({
  plan = null,
  intent,
  terminalVerification,
} = {}) {
  if (arguments[0]?.schema === ACTIVE_PUBLISH_SUCCESSOR_DORMANT_RECOVERY_INTENT_SCHEMA) {
    intent = arguments[0];
  }
  const normalizedIntent = normalizeActivePublishSuccessorDormantRecoveryIntent(intent);
  if (normalizedIntent.status !== "verified" && normalizedIntent.status !== "complete") {
    throw new Error("Completion requires the exact verified intent.");
  }
  const normalizedPlan = plan
    ? normalizeActivePublishSuccessorDormantRecoveryPlan(plan)
    : normalizedIntent.planSnapshot;
  if (normalizedPlan.planDigest !== normalizedIntent.planDigest) invalid("completion plan");
  const verification = terminalVerification
    ? normalizeActivePublishSuccessorDormantRecoveryTerminalVerification(
      terminalVerification, normalizedPlan,
    )
    : null;
  const phaseDigests = Object.freeze(ACTIVE_PUBLISH_SUCCESSOR_DORMANT_RECOVERY_PHASES
    .filter(phase => phase !== "complete")
    .map(phase => normalizedIntent.phases[phase]?.phaseDigest));
  if (phaseDigests.some(value => !DIGEST.test(String(value || "")))) {
    invalid("completion phases");
  }
  const mutationAuthority = normalizeMutationAuthority(verification?.mutationAuthority
    || normalizedIntent.phases.verified.values.mutationAuthority);
  const core = {
    schema: ACTIVE_PUBLISH_SUCCESSOR_DORMANT_RECOVERY_COMPLETION_SCHEMA,
    status: "recovered",
    planDigest: normalizedPlan.planDigest,
    evidenceDigest: normalizedPlan.evidenceDigest,
    authorizationDigest: normalizedIntent.authorizationDigest,
    verifiedIntentDigest: normalizedIntent.status === "complete"
      ? normalizedIntent.phases.complete.previousIntentDigest
      : normalizedIntent.intentDigest,
    claimId: verification?.claimId || normalizedPlan.evidence.cloud.claim.claimId,
    phaseDigests,
    terminalVerificationDigest: verification?.verificationDigest
      || normalizedIntent.phases.verified.valuesDigest,
    mutationAuthority,
    mutationAuthorityReceiptDigest: mutationAuthority.receiptDigest,
    mutationSet: Object.freeze([
      "cloud-same-claim-recovery",
      "writer-lease-cloud-authority-projection",
      "review-hidden-marker-projection",
    ]),
    cloudMutation: boolean(
      normalizedIntent.phases.cloud_recovered.values.cloudMutation, "cloud mutation",
    ),
    providerMutation: boolean(
      normalizedIntent.phases.review_marker_projected.values.providerMutation,
      "provider mutation",
    ),
    writerRegistryMutation: boolean(
      normalizedIntent.phases.lease_projected.values.writerRegistryMutation,
      "writer-registry mutation",
    ),
    reviewMarkerMutation: boolean(
      normalizedIntent.phases.review_marker_projected.values.providerMutation,
      "review-marker mutation",
    ),
    gitMutation: false,
    sourceMutation: false,
    branchMutation: false,
    worktreeMutation: false,
    mergeMutation: false,
    deploymentMutation: false,
    newClaim: false,
    newPullRequest: false,
    authoringAuthorityRestored: true,
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function sealPlan(core) {
  const planDigest = digestValue(core);
  return deepFreeze({
    ...core,
    planDigest,
    exactAuthorization: `authorize ${OPERATION} ${planDigest}`,
  });
}

function normalizeAuthorization(value, plan) {
  exactKeys(value, [
    "schema", "planDigest", "evidenceDigest", "authorization", "authorizationDigest",
  ], "authorization receipt");
  const expected = authorizeActivePublishSuccessorDormantRecoveryPlan(
    plan, plan.exactAuthorization,
  );
  if (canonicalJson(expected) !== canonicalJson(value)) invalid("authorization receipt");
  return expected;
}

function authorizationDigestForPlan(plan) {
  return authorizeActivePublishSuccessorDormantRecoveryPlan(
    plan, plan.exactAuthorization,
  ).authorizationDigest;
}

function buildPhaseRecord({
  planDigest, authorizationDigest, phase, previousIntentDigest, evidence, recordedAt,
}) {
  const normalizedPhase = requiredPhase(phase);
  const normalizedValues = immutableJson(evidence, `${normalizedPhase} values`);
  const core = {
    schema: ACTIVE_PUBLISH_SUCCESSOR_DORMANT_RECOVERY_PHASE_SCHEMA,
    phase: normalizedPhase,
    operationKey: activePublishSuccessorDormantRecoveryOperationKey(
      planDigest, authorizationDigest, normalizedPhase,
    ),
    previousIntentDigest: digest(previousIntentDigest, "previous intent digest"),
    values: normalizedValues,
    valuesDigest: digestValue(normalizedValues),
    recordedAt: instant(recordedAt, `${normalizedPhase} recorded time`),
  };
  return deepFreeze({ ...core, phaseDigest: digestValue(core) });
}

function normalizePhaseRecord(value, plan, authorizationDigest, phase, previousIntentDigest) {
  exactKeys(value, [
    "schema", "phase", "operationKey", "previousIntentDigest", "values",
    "valuesDigest", "recordedAt", "phaseDigest",
  ], `${phase} phase`);
  const expected = buildPhaseRecord({
    planDigest: plan.planDigest,
    authorizationDigest,
    phase,
    previousIntentDigest,
    evidence: value.values,
    recordedAt: value.recordedAt,
  });
  if (canonicalJson(expected) !== canonicalJson(value)) invalid(`${phase} phase digest`);
  return expected;
}

function sealIntent(core) {
  const normalizedCore = { ...core, phases: deepFreeze({ ...core.phases }) };
  return deepFreeze({ ...normalizedCore, intentDigest: digestValue(normalizedCore) });
}

function immutableJson(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  try {
    const clone = JSON.parse(JSON.stringify(value));
    if (canonicalJson(clone) !== canonicalJson(value)) invalid(label);
    return deepFreeze(clone);
  } catch {
    invalid(label);
  }
}

function requiredStatus(value) {
  if (!STATUSES.includes(value)) invalid("intent status");
  return value;
}

function requiredPhase(value) {
  if (!ACTIVE_PUBLISH_SUCCESSOR_DORMANT_RECOVERY_PHASES.includes(value)) {
    invalid("recovery phase");
  }
  return value;
}

function boundedTtl(value) {
  if (!Number.isSafeInteger(value) || value < MINIMUM_TTL_SECONDS
    || value > MAXIMUM_TTL_SECONDS) invalid("TTL seconds");
  return value;
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) invalid(label);
}

function text(value, label) {
  if (typeof value !== "string" || !value.trim()) invalid(label);
  return value;
}

function digest(value, label) {
  if (!DIGEST.test(String(value || ""))) invalid(label);
  return value;
}

function instant(value, label) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) invalid(label);
  return value;
}

function exactFalse(value, label) {
  if (value !== false) invalid(label);
  return false;
}

function normalizeMutationAuthority(value) {
  exactKeys(value, ["schema", "status", "claimId", "claimDigest", "ledgerRevision",
    "localLeaseEpoch", "localFenceSha", "remoteLeaseEpoch",
    "cloudVerificationReceiptDigest", "evaluatedAt", "expiresAt", "receiptDigest"],
  "mutation authority");
  const core = { schema: value.schema, status: value.status,
    claimId: digest(value.claimId, "mutation-authority claim ID"),
    claimDigest: digest(value.claimDigest, "mutation-authority claim digest"),
    ledgerRevision: sha(value.ledgerRevision, "mutation-authority ledger revision"),
    localLeaseEpoch: positive(value.localLeaseEpoch, "local lease epoch"),
    localFenceSha: sha(value.localFenceSha, "local fence"),
    remoteLeaseEpoch: positive(value.remoteLeaseEpoch, "remote lease epoch"),
    cloudVerificationReceiptDigest: digest(value.cloudVerificationReceiptDigest,
      "mutation-authority cloud verification"),
    evaluatedAt: instant(value.evaluatedAt, "mutation-authority evaluation"),
    expiresAt: instant(value.expiresAt, "mutation-authority expiry") };
  if (core.schema !== "agentic-admission-mutation-authority/v1" || core.status !== "ready"
    || value.receiptDigest !== digestValue(core)) invalid("mutation authority");
  return deepFreeze({ ...core, receiptDigest: value.receiptDigest });
}

function boolean(value, label) {
  if (typeof value !== "boolean") invalid(label);
  return value;
}

function sha(value, label) {
  if (!SHA.test(String(value || ""))) invalid(label);
  return value;
}

function positive(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) invalid(label);
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function invalid(label) {
  throw new Error(`Active-publish successor dormant recovery has invalid ${label}.`);
}
