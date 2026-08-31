// Responsibility: Seal one exact historical-successor recovery and its replay-safe receipts.
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  normalizeActivePublishHistoricalDerivativeRecoveryEvidence,
} from "./active-publish-historical-derivative-recovery-evidence.mjs";

export const ACTIVE_PUBLISH_HISTORICAL_DERIVATIVE_RECOVERY_PLAN_SCHEMA =
  "agentic-active-publish-historical-derivative-recovery-plan/v1";
export const ACTIVE_PUBLISH_HISTORICAL_DERIVATIVE_RECOVERY_AUTHORIZATION_SCHEMA =
  "agentic-active-publish-historical-derivative-recovery-authorization/v1";
export const ACTIVE_PUBLISH_HISTORICAL_DERIVATIVE_RECOVERY_INTENT_SCHEMA =
  "agentic-active-publish-historical-derivative-recovery-intent/v1";
export const ACTIVE_PUBLISH_HISTORICAL_DERIVATIVE_RECOVERY_PHASE_SCHEMA =
  "agentic-active-publish-historical-derivative-recovery-phase/v1";
export const ACTIVE_PUBLISH_HISTORICAL_DERIVATIVE_RECOVERY_TERMINAL_SCHEMA =
  "agentic-active-publish-historical-derivative-recovery-terminal-verification/v1";
export const ACTIVE_PUBLISH_HISTORICAL_DERIVATIVE_RECOVERY_COMPLETION_SCHEMA =
  "agentic-active-publish-historical-derivative-recovery-completion/v1";
export const ACTIVE_PUBLISH_HISTORICAL_DERIVATIVE_RECOVERY_PHASES = Object.freeze([
  "task_authority_verified",
  "cloud_request_sealed",
  "cloud_recovered",
  "registry_projection_prepared",
  "registry_projected",
  "review_marker_projected",
  "verified",
  "complete",
]);
export const ACTIVE_PUBLISH_HISTORICAL_DERIVATIVE_RECOVERY_MUTATION_POLICY = deepFreeze({
  allowed: [
    "cloud-same-claim-recovery-if-dormant",
    "writer-lease-historical-successor-projection",
    "pull-request-hidden-marker-projection",
  ],
  gitMutation: false,
  refMutation: false,
  sourceMutation: false,
  branchMutation: false,
  worktreeMutation: false,
  integrationMutation: false,
  mergeMutation: false,
  releaseMutation: false,
  deploymentMutation: false,
  retirementMutation: false,
  cleanupMutation: false,
  newClaim: false,
  newPullRequest: false,
  authoringAuthorityGranted: false,
});

const OPERATION = "active-publish-historical-derivative-recovery";
const OPERATION_KEY_SCHEMA =
  "agentic-active-publish-historical-derivative-recovery-operation-key/v1";
const STATUSES = Object.freeze([
  "authorized", ...ACTIVE_PUBLISH_HISTORICAL_DERIVATIVE_RECOVERY_PHASES,
]);
const DIGEST = /^[0-9a-f]{64}$/u;
const MINIMUM_TTL_SECONDS = 60;
const MAXIMUM_TTL_SECONDS = 86_400;

export function buildActivePublishHistoricalDerivativeRecoveryPlan(input, options = {}) {
  const evidenceInput = input?.evidence || input?.sourceEvidence || input;
  const ttlInput = input?.evidence || input?.sourceEvidence
    ? input.ttlSeconds
    : options.ttlSeconds;
  const evidence = normalizeActivePublishHistoricalDerivativeRecoveryEvidence(evidenceInput);
  return sealPlan({
    schema: ACTIVE_PUBLISH_HISTORICAL_DERIVATIVE_RECOVERY_PLAN_SCHEMA,
    operation: OPERATION,
    evidence,
    evidenceDigest: evidence.evidenceDigest,
    ttlSeconds: boundedTtl(ttlInput ?? 1_800),
    mutationPolicy: ACTIVE_PUBLISH_HISTORICAL_DERIVATIVE_RECOVERY_MUTATION_POLICY,
  });
}

export function normalizeActivePublishHistoricalDerivativeRecoveryPlan(value) {
  exactKeys(value, [
    "schema", "operation", "evidence", "evidenceDigest", "ttlSeconds",
    "mutationPolicy", "planDigest", "exactAuthorization",
  ], "plan");
  const expected = sealPlan({
    schema: text(value.schema, "plan schema"),
    operation: text(value.operation, "plan operation"),
    evidence: normalizeActivePublishHistoricalDerivativeRecoveryEvidence(value.evidence),
    evidenceDigest: digest(value.evidenceDigest, "plan evidence digest"),
    ttlSeconds: boundedTtl(value.ttlSeconds),
    mutationPolicy: normalizeMutationPolicy(value.mutationPolicy),
  });
  if (expected.schema !== ACTIVE_PUBLISH_HISTORICAL_DERIVATIVE_RECOVERY_PLAN_SCHEMA
    || expected.operation !== OPERATION
    || expected.evidenceDigest !== expected.evidence.evidenceDigest
    || canonicalJson(expected) !== canonicalJson(value)) invalid("plan semantics or digest");
  return expected;
}

export function authorizeActivePublishHistoricalDerivativeRecoveryPlan(plan, authorization) {
  if (arguments.length === 1 && plan?.plan) {
    authorization = plan.authorization;
    plan = plan.plan;
  }
  const normalized = normalizeActivePublishHistoricalDerivativeRecoveryPlan(plan);
  if (authorization !== normalized.exactAuthorization) {
    throw new Error(`Exact authorization required: ${normalized.exactAuthorization}`);
  }
  const core = {
    schema: ACTIVE_PUBLISH_HISTORICAL_DERIVATIVE_RECOVERY_AUTHORIZATION_SCHEMA,
    planDigest: normalized.planDigest,
    evidenceDigest: normalized.evidenceDigest,
    authorization,
  };
  return deepFreeze({ ...core, authorizationDigest: digestValue(core) });
}

export const authorizeActivePublishHistoricalDerivativeRecovery =
  authorizeActivePublishHistoricalDerivativeRecoveryPlan;

export function createActivePublishHistoricalDerivativeRecoveryIntent(
  plan,
  authorizationReceipt,
  startedAt = new Date().toISOString(),
) {
  const normalizedPlan = normalizeActivePublishHistoricalDerivativeRecoveryPlan(plan);
  const authorization = typeof authorizationReceipt === "string"
    ? authorizeActivePublishHistoricalDerivativeRecoveryPlan(normalizedPlan, authorizationReceipt)
    : normalizeAuthorization(authorizationReceipt, normalizedPlan);
  return sealIntent({
    schema: ACTIVE_PUBLISH_HISTORICAL_DERIVATIVE_RECOVERY_INTENT_SCHEMA,
    planDigest: normalizedPlan.planDigest,
    planSnapshot: normalizedPlan,
    authorizationDigest: authorization.authorizationDigest,
    startedAt: instant(startedAt, "intent start"),
    status: "authorized",
    phases: {},
  });
}

export function normalizeActivePublishHistoricalDerivativeRecoveryIntent(value) {
  exactKeys(value, [
    "schema", "planDigest", "planSnapshot", "authorizationDigest", "startedAt",
    "status", "phases", "intentDigest",
  ], "intent");
  const plan = normalizeActivePublishHistoricalDerivativeRecoveryPlan(value.planSnapshot);
  const core = {
    schema: text(value.schema, "intent schema"),
    planDigest: digest(value.planDigest, "intent plan digest"),
    planSnapshot: plan,
    authorizationDigest: digest(value.authorizationDigest, "intent authorization digest"),
    startedAt: instant(value.startedAt, "intent start"),
    status: requiredStatus(value.status),
    phases: {},
  };
  if (core.schema !== ACTIVE_PUBLISH_HISTORICAL_DERIVATIVE_RECOVERY_INTENT_SCHEMA
    || core.planDigest !== plan.planDigest
    || core.authorizationDigest !== authorizationDigestForPlan(plan)) invalid("intent subject");
  const statusIndex = STATUSES.indexOf(core.status);
  for (let index = 1; index <= statusIndex; index += 1) {
    const phase = STATUSES[index];
    const prior = sealIntent({ ...core, status: STATUSES[index - 1] });
    core.phases[phase] = normalizePhaseRecord(
      value.phases?.[phase], plan, core.authorizationDigest, phase, prior.intentDigest,
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

export function advanceActivePublishHistoricalDerivativeRecoveryIntent(
  intent,
  phase,
  evidence,
  recordedAt = new Date().toISOString(),
) {
  const current = normalizeActivePublishHistoricalDerivativeRecoveryIntent(intent);
  if (phase && typeof phase === "object") {
    recordedAt = phase.recordedAt ?? recordedAt;
    evidence = phase.values;
    phase = phase.status;
  }
  const next = requiredPhase(phase);
  const currentIndex = STATUSES.indexOf(current.status);
  const nextIndex = STATUSES.indexOf(next);
  if (nextIndex === currentIndex) {
    const values = immutableJson(evidence, `${next} evidence`);
    if (canonicalJson(current.phases[next].values) !== canonicalJson(values)) {
      throw new Error(`Historical derivative recovery ${next} replay drifted.`);
    }
    return current;
  }
  if (nextIndex !== currentIndex + 1) {
    throw new Error(`Historical derivative recovery cannot advance from ${current.status} to ${next}.`);
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

export function activePublishHistoricalDerivativeRecoveryOperationKey(
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

export function normalizeActivePublishHistoricalDerivativeRecoveryTerminal(
  value,
  expectedPlan = null,
) {
  const effectKeys = [
    "cloudMutation", "providerMutation", "writerRegistryMutation",
    "taskAuthorityProjected", "reviewMarkerProjected",
    "activePublishSuccessorIntentCleared",
  ];
  const deniedKeys = [
    "gitMutation", "refMutation", "sourceMutation", "branchMutation", "worktreeMutation",
    "integrationMutation", "mergeMutation", "releaseMutation", "deploymentMutation",
    "retirementMutation", "cleanupMutation", "newClaim", "newPullRequest",
  ];
  exactKeys(value, [
    "schema", "planDigest", "evidenceDigest", "claimId", "sourceLeaseDigest",
    "targetLeaseDigest", "taskAuthorityReceiptDigest", "successorReceiptDigest",
    "registryProjectionReceiptDigest", "reviewMarkerReceiptDigest",
    "cloudOperationReceiptDigest", "cloudVerificationReceiptDigest", "visibleBodyDigest",
    "verifiedAt", ...effectKeys, ...deniedKeys, "verificationDigest",
  ], "terminal verification");
  const core = {
    schema: text(value.schema, "terminal schema"),
    planDigest: digest(value.planDigest, "terminal plan digest"),
    evidenceDigest: digest(value.evidenceDigest, "terminal evidence digest"),
    claimId: digest(value.claimId, "terminal claim ID"),
    sourceLeaseDigest: digest(value.sourceLeaseDigest, "source lease digest"),
    targetLeaseDigest: digest(value.targetLeaseDigest, "target lease digest"),
    taskAuthorityReceiptDigest: digest(
      value.taskAuthorityReceiptDigest, "task-authority receipt digest",
    ),
    successorReceiptDigest: digest(value.successorReceiptDigest, "successor receipt digest"),
    registryProjectionReceiptDigest: digest(
      value.registryProjectionReceiptDigest, "registry projection receipt digest",
    ),
    reviewMarkerReceiptDigest: digest(
      value.reviewMarkerReceiptDigest, "review marker receipt digest",
    ),
    cloudOperationReceiptDigest: digest(
      value.cloudOperationReceiptDigest, "cloud operation receipt digest",
    ),
    cloudVerificationReceiptDigest: digest(
      value.cloudVerificationReceiptDigest, "cloud verification receipt digest",
    ),
    visibleBodyDigest: digest(value.visibleBodyDigest, "visible review body digest"),
    verifiedAt: instant(value.verifiedAt, "terminal verification time"),
  };
  for (const key of effectKeys) core[key] = boolean(value[key], key);
  for (const key of deniedKeys) core[key] = exactFalse(value[key], key);
  if (core.schema !== ACTIVE_PUBLISH_HISTORICAL_DERIVATIVE_RECOVERY_TERMINAL_SCHEMA
    || value.verificationDigest !== digestValue(core)) invalid("terminal verification digest");
  if (expectedPlan) {
    const plan = expectedPlan.planSnapshot
      ? normalizeActivePublishHistoricalDerivativeRecoveryIntent(expectedPlan).planSnapshot
      : normalizeActivePublishHistoricalDerivativeRecoveryPlan(expectedPlan);
    if (core.planDigest !== plan.planDigest || core.evidenceDigest !== plan.evidenceDigest) {
      invalid("terminal verification subject");
    }
  }
  return deepFreeze({ ...core, verificationDigest: value.verificationDigest });
}

export const normalizeActivePublishHistoricalDerivativeRecoveryTerminalVerification =
  normalizeActivePublishHistoricalDerivativeRecoveryTerminal;

export function buildActivePublishHistoricalDerivativeRecoveryCompletion({
  plan = null,
  intent,
  terminalVerification,
} = {}) {
  if (arguments[0]?.schema === ACTIVE_PUBLISH_HISTORICAL_DERIVATIVE_RECOVERY_INTENT_SCHEMA) {
    intent = arguments[0];
  }
  const normalizedIntent = normalizeActivePublishHistoricalDerivativeRecoveryIntent(intent);
  if (!new Set(["verified", "complete"]).has(normalizedIntent.status)) {
    throw new Error("Completion requires the exact verified recovery intent.");
  }
  const normalizedPlan = plan
    ? normalizeActivePublishHistoricalDerivativeRecoveryPlan(plan)
    : normalizedIntent.planSnapshot;
  if (normalizedPlan.planDigest !== normalizedIntent.planDigest) invalid("completion plan");
  const terminal = normalizeActivePublishHistoricalDerivativeRecoveryTerminal(
    terminalVerification || normalizedIntent.phases.verified.values,
    normalizedPlan,
  );
  assertTerminalPhaseJoins(normalizedPlan, normalizedIntent, terminal);
  const phaseDigests = ACTIVE_PUBLISH_HISTORICAL_DERIVATIVE_RECOVERY_PHASES
    .filter(phase => phase !== "complete")
    .map(phase => normalizedIntent.phases[phase]?.phaseDigest);
  if (phaseDigests.some(value => !DIGEST.test(String(value || "")))) invalid("completion phases");
  const core = {
    schema: ACTIVE_PUBLISH_HISTORICAL_DERIVATIVE_RECOVERY_COMPLETION_SCHEMA,
    status: "recovered",
    planDigest: normalizedPlan.planDigest,
    evidenceDigest: normalizedPlan.evidenceDigest,
    authorizationDigest: normalizedIntent.authorizationDigest,
    verifiedIntentDigest: normalizedIntent.status === "complete"
      ? normalizedIntent.phases.complete.previousIntentDigest
      : normalizedIntent.intentDigest,
    claimId: terminal.claimId,
    phaseDigests: Object.freeze(phaseDigests),
    terminalVerificationDigest: terminal.verificationDigest,
    mutationPolicy: normalizedPlan.mutationPolicy,
    mutationSet: Object.freeze([
      ...(terminal.cloudMutation ? ["cloud-same-claim-recovery"] : []),
      "writer-lease-historical-successor-projection",
      "pull-request-hidden-marker-projection",
    ]),
    cloudMutation: terminal.cloudMutation,
    providerMutation: terminal.providerMutation,
    writerRegistryMutation: terminal.writerRegistryMutation,
    taskAuthorityProjected: terminal.taskAuthorityProjected,
    reviewMarkerProjected: terminal.reviewMarkerProjected,
    activePublishSuccessorIntentCleared: terminal.activePublishSuccessorIntentCleared,
    gitMutation: false,
    refMutation: false,
    sourceMutation: false,
    branchMutation: false,
    worktreeMutation: false,
    integrationMutation: false,
    mergeMutation: false,
    releaseMutation: false,
    deploymentMutation: false,
    retirementMutation: false,
    cleanupMutation: false,
    newClaim: false,
    newPullRequest: false,
    authoringAuthorityGranted: false,
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function assertTerminalPhaseJoins(plan, intent, terminal) {
  const task = intent.phases.task_authority_verified.values;
  const cloud = intent.phases.cloud_recovered.values;
  const prepared = intent.phases.registry_projection_prepared.values;
  const projected = intent.phases.registry_projected.values;
  const marker = intent.phases.review_marker_projected.values;
  const joins = [
    [terminal.claimId, plan.evidence.cloud.claim.claimId],
    [terminal.sourceLeaseDigest, plan.evidence.sourceLease.leaseDigest],
    [terminal.sourceLeaseDigest, prepared.sourceLeaseDigest],
    [terminal.targetLeaseDigest, prepared.targetLeaseDigest],
    [terminal.targetLeaseDigest, projected.targetLeaseDigest],
    [terminal.taskAuthorityReceiptDigest, task.receiptDigest],
    [terminal.taskAuthorityReceiptDigest, prepared.taskAuthorityReceiptDigest],
    [terminal.taskAuthorityReceiptDigest, projected.taskAuthorityReceiptDigest],
    [terminal.successorReceiptDigest, prepared.successorReceiptDigest],
    [terminal.successorReceiptDigest, projected.successorReceiptDigest],
    [terminal.registryProjectionReceiptDigest, prepared.registryProjectionReceiptDigest],
    [terminal.registryProjectionReceiptDigest, projected.registryProjectionReceiptDigest],
    [terminal.reviewMarkerReceiptDigest, marker.receiptDigest],
    [terminal.cloudOperationReceiptDigest, cloud.operationReceiptDigest],
    [terminal.cloudVerificationReceiptDigest, cloud.verificationReceiptDigest],
    [terminal.visibleBodyDigest, marker.visibleBodyDigest],
    [terminal.cloudMutation, cloud.cloudMutation],
    [terminal.providerMutation, marker.providerMutation],
    [terminal.writerRegistryMutation, projected.writerRegistryMutation],
    [terminal.taskAuthorityProjected, projected.taskAuthorityProjected],
    [terminal.reviewMarkerProjected, marker.reviewMarkerProjected],
    [terminal.activePublishSuccessorIntentCleared,
      projected.activePublishSuccessorIntentCleared],
  ];
  if (joins.some(([actual, expected]) => actual !== expected)
    || (plan.evidence.cloud.claim.state === "dormant-preserved"
      && terminal.cloudMutation !== true)
    || (cloud.disposition !== undefined
      && terminal.cloudMutation !== new Set(["recovered", "adopted-recovery"])
        .has(cloud.disposition))
    || terminal.providerMutation !== true
    || terminal.writerRegistryMutation !== true
    || terminal.taskAuthorityProjected !== true
    || terminal.reviewMarkerProjected !== true
    || terminal.activePublishSuccessorIntentCleared !== true) {
    invalid("terminal phase joins");
  }
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
  const expected = authorizeActivePublishHistoricalDerivativeRecoveryPlan(
    plan, plan.exactAuthorization,
  );
  if (canonicalJson(expected) !== canonicalJson(value)) invalid("authorization receipt");
  return expected;
}

function authorizationDigestForPlan(plan) {
  return authorizeActivePublishHistoricalDerivativeRecoveryPlan(
    plan, plan.exactAuthorization,
  ).authorizationDigest;
}

function buildPhaseRecord({
  planDigest, authorizationDigest, phase, previousIntentDigest, evidence, recordedAt,
}) {
  const normalizedPhase = requiredPhase(phase);
  const values = immutableJson(evidence, `${normalizedPhase} values`);
  const core = {
    schema: ACTIVE_PUBLISH_HISTORICAL_DERIVATIVE_RECOVERY_PHASE_SCHEMA,
    phase: normalizedPhase,
    operationKey: activePublishHistoricalDerivativeRecoveryOperationKey(
      planDigest, authorizationDigest, normalizedPhase,
    ),
    previousIntentDigest: digest(previousIntentDigest, "previous intent digest"),
    values,
    valuesDigest: digestValue(values),
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

function normalizeMutationPolicy(value) {
  if (canonicalJson(value) !== canonicalJson(
    ACTIVE_PUBLISH_HISTORICAL_DERIVATIVE_RECOVERY_MUTATION_POLICY,
  )) invalid("mutation policy");
  return ACTIVE_PUBLISH_HISTORICAL_DERIVATIVE_RECOVERY_MUTATION_POLICY;
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
  if (!ACTIVE_PUBLISH_HISTORICAL_DERIVATIVE_RECOVERY_PHASES.includes(value)) {
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
function boolean(value, label) {
  if (typeof value !== "boolean") invalid(label);
  return value;
}
function exactFalse(value, label) {
  if (value !== false) invalid(label);
  return false;
}
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
function invalid(label) {
  throw new Error(`Active-publish historical derivative recovery has invalid ${label}.`);
}
