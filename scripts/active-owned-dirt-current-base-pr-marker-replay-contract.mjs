// Responsibility: Seal one task-authorized, marker-only replay of a current-base reanchor.
import { canonicalJson, digestValue }
  from "./cloud-collaboration-primitives.mjs";

export const ACTIVE_OWNED_DIRT_CURRENT_BASE_PR_MARKER_REPLAY_OPERATION =
  "active-owned-dirt-current-base-pr-marker-replay";
export const OPERATION = ACTIVE_OWNED_DIRT_CURRENT_BASE_PR_MARKER_REPLAY_OPERATION;
export const EVIDENCE_SCHEMA = `agentic-${OPERATION}-evidence/v1`;
export const PLAN_SCHEMA = `agentic-${OPERATION}-plan/v1`;
export const AUTHORIZATION_SCHEMA = `agentic-${OPERATION}-authorization/v1`;
export const INTENT_SCHEMA = `agentic-${OPERATION}-intent/v1`;
export const PHASE_RECEIPT_SCHEMA = `agentic-${OPERATION}-phase-receipt/v1`;
export const COMPLETION_SCHEMA = `agentic-${OPERATION}-completion/v1`;
export const PHASES = Object.freeze([
  "prepared",
  "authority-verified",
  "provider-attempted",
  "provider-projected",
  "complete",
]);

const ALLOWED_MUTATIONS = Object.freeze([
  "pull-request-writer-marker",
  "external-private-recovery-journal",
]);
const FORBIDDEN_EFFECTS = Object.freeze([
  "cloud-transition",
  "writer-registry-mutation",
  "git-mutation",
  "remote-ref-mutation",
  "source-mutation",
  "pull-request-subject-mutation",
  "pull-request-draft-mutation",
  "pull-request-auto-merge-mutation",
  "authoring-authority",
  "integration-authority",
  "release",
  "deployment",
  "cleanup",
]);
const DIGEST = /^[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40,64}$/u;

export function buildActiveOwnedDirtCurrentBasePrMarkerReplayEvidence(input = {}) {
  const core = normalizeEvidenceCore(input);
  return deepFreeze({ ...core, evidenceDigest: digestValue(core) });
}

export function buildActiveOwnedDirtCurrentBasePrMarkerReplayPlan({
  evidence,
  ttlSeconds = 300,
} = {}) {
  const source = normalizeEvidence(evidence);
  const ttl = boundedTtl(ttlSeconds);
  // The target registry projection may already be time-expired. This controller
  // does not renew it or derive cloud authority; freshness belongs to this
  // marker-only operation and its task proof, not to the historical lease TTL.
  const planExpiresAt = new Date(
    Date.parse(source.observedAt) + ttl * 1_000,
  ).toISOString();
  const core = {
    schema: PLAN_SCHEMA,
    operation: OPERATION,
    evidence: source,
    evidenceDigest: source.evidenceDigest,
    observedAt: source.observedAt,
    planExpiresAt,
    ttlSeconds: ttl,
    reanchorPlanDigest: source.reanchorPlanDigest,
    reanchorIntentDigest: source.reanchorIntentDigest,
    reanchorPrProjectedReceiptDigest: source.reanchorPrProjectedReceiptDigest,
    branch: source.branch,
    sessionId: source.sessionId,
    device: source.device,
    scope: source.scope,
    pullRequestId: source.pullRequestId,
    pullRequestUrl: source.pullRequestUrl,
    pullRequestNumber: source.pullRequestNumber,
    headSha: source.headSha,
    baseSha: source.baseSha,
    bodyRemainderDigest: source.bodyRemainderDigest,
    sourceBodyDigest: source.sourceBodyDigest,
    sourceMarkerDigest: source.sourceMarkerDigest,
    sourceMarkerDisposition: source.sourceMarkerDisposition,
    targetBodyDigest: source.targetBodyDigest,
    targetMarkerDigest: source.targetMarkerDigest,
    targetLeaseDigest: source.targetLeaseDigest,
    targetClaimId: source.targetClaimId,
    targetTaskBindingDigest: source.targetTaskBindingDigest,
    dirtEvidenceDigest: source.dirtEvidenceDigest,
    allowedMutations: ALLOWED_MUTATIONS,
    forbiddenEffects: FORBIDDEN_EFFECTS,
    terminalStatus: "projection-restored",
  };
  const planDigest = digestValue(core);
  return deepFreeze({
    ...core,
    planDigest,
    taskAuthorityOperation: `${OPERATION}:${planDigest}`,
    exactAuthorization: `authorize ${OPERATION} ${planDigest}`,
  });
}

export function normalizeActiveOwnedDirtCurrentBasePrMarkerReplayPlan(value) {
  if (value?.schema !== PLAN_SCHEMA || value.operation !== OPERATION) {
    invalid("plan schema");
  }
  const rebuilt = buildActiveOwnedDirtCurrentBasePrMarkerReplayPlan({
    evidence: value.evidence,
    ttlSeconds: value.ttlSeconds,
  });
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("plan projection");
  return rebuilt;
}

export function authorizeActiveOwnedDirtCurrentBasePrMarkerReplay({
  plan,
  authorization,
} = {}) {
  const source = normalizeActiveOwnedDirtCurrentBasePrMarkerReplayPlan(plan);
  if (authorization !== source.exactAuthorization) {
    throw new Error(`Marker replay requires exact authorization: ${source.exactAuthorization}`);
  }
  const core = {
    schema: AUTHORIZATION_SCHEMA,
    operation: OPERATION,
    status: "authorized",
    planDigest: source.planDigest,
    statement: authorization,
  };
  return deepFreeze({ ...core, authorizationDigest: digestValue(core) });
}

export function createActiveOwnedDirtCurrentBasePrMarkerReplayIntent(
  plan,
  authorization,
) {
  const source = normalizeActiveOwnedDirtCurrentBasePrMarkerReplayPlan(plan);
  const authority = authorizeActiveOwnedDirtCurrentBasePrMarkerReplay({
    plan: source,
    authorization,
  });
  const prepared = phaseReceipt({
    plan: source,
    phase: "prepared",
    priorReceiptDigest: null,
    values: { authorizationDigest: authority.authorizationDigest },
  });
  return sealIntent({
    phase: "prepared",
    plan: source,
    authority,
    receipts: { prepared },
    completion: null,
  });
}

export function advanceActiveOwnedDirtCurrentBasePrMarkerReplayIntent(
  value,
  { phase, values = {} } = {},
) {
  const current = normalizeActiveOwnedDirtCurrentBasePrMarkerReplayIntent(value);
  const sourceIndex = PHASES.indexOf(current.phase);
  const targetIndex = PHASES.indexOf(phase);
  if (targetIndex !== sourceIndex + 1) invalid("phase transition");
  const receipt = phaseReceipt({
    plan: current.planSnapshot,
    phase,
    priorReceiptDigest: current.receipts[current.phase].receiptDigest,
    values,
  });
  const receipts = { ...current.receipts, [phase]: receipt };
  const completion = phase === "complete"
    ? completionReceipt({ plan: current.planSnapshot, receipts })
    : null;
  return sealIntent({
    phase,
    plan: current.planSnapshot,
    authority: current.authorization,
    receipts,
    completion,
  });
}

export function normalizeActiveOwnedDirtCurrentBasePrMarkerReplayIntent(value) {
  if (value?.schema !== INTENT_SCHEMA || !PHASES.includes(value.phase)) {
    invalid("intent schema");
  }
  const plan = normalizeActiveOwnedDirtCurrentBasePrMarkerReplayPlan(value.planSnapshot);
  const authority = authorizeActiveOwnedDirtCurrentBasePrMarkerReplay({
    plan,
    authorization: value.authorization?.statement,
  });
  const names = PHASES.slice(0, PHASES.indexOf(value.phase) + 1);
  if (canonicalJson(Object.keys(value.receipts || {})) !== canonicalJson(names)) {
    invalid("intent phases");
  }
  const receipts = {};
  let priorReceiptDigest = null;
  for (const phase of names) {
    const receipt = phaseReceipt({
      plan,
      phase,
      priorReceiptDigest,
      values: value.receipts?.[phase]?.values,
    });
    receipts[phase] = receipt;
    priorReceiptDigest = receipt.receiptDigest;
  }
  const completion = value.phase === "complete"
    ? completionReceipt({ plan, receipts })
    : null;
  const rebuilt = sealIntent({
    phase: value.phase,
    plan,
    authority,
    receipts,
    completion,
  });
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("intent projection");
  return rebuilt;
}

export function buildActiveOwnedDirtCurrentBasePrMarkerReplayCompletionReceipt(value) {
  const intent = normalizeActiveOwnedDirtCurrentBasePrMarkerReplayIntent(value);
  if (intent.phase !== "complete") invalid("complete intent");
  return intent.completion;
}

export function activeOwnedDirtCurrentBasePrMarkerReplayOperationKey(plan, phase) {
  const source = normalizeActiveOwnedDirtCurrentBasePrMarkerReplayPlan(plan);
  if (!PHASES.includes(phase)) invalid("operation phase");
  return `${OPERATION}:${phase}:${digestValue({ planDigest: source.planDigest, phase })}`;
}

function normalizeEvidence(value) {
  if (value?.schema !== EVIDENCE_SCHEMA) invalid("evidence schema");
  const core = normalizeEvidenceCore(value);
  const evidenceDigest = digestValue(core);
  if (value.evidenceDigest !== evidenceDigest) invalid("evidence digest");
  return deepFreeze({ ...core, evidenceDigest });
}

function normalizeEvidenceCore(value) {
  if (value?.schema !== EVIDENCE_SCHEMA) invalid("evidence schema");
  const core = {
    schema: EVIDENCE_SCHEMA,
    observedAt: instant(value.observedAt, "observed time"),
    repositoryPathDigest: digest(value.repositoryPathDigest, "repository path digest"),
    reanchorPlanDigest: digest(value.reanchorPlanDigest, "reanchor plan digest"),
    reanchorIntentDigest: digest(value.reanchorIntentDigest, "reanchor intent digest"),
    reanchorPrProjectedReceiptDigest: digest(
      value.reanchorPrProjectedReceiptDigest,
      "reanchor PR-projected receipt digest",
    ),
    reanchorJournalPhase: value.reanchorJournalPhase === "pr-projected"
      ? "pr-projected" : invalid("reanchor journal phase"),
    branch: text(value.branch, "branch"),
    sessionId: text(value.sessionId, "session"),
    device: text(value.device, "device"),
    scope: text(value.scope, "scope"),
    pullRequestId: text(value.pullRequestId, "pull-request ID"),
    pullRequestUrl: text(value.pullRequestUrl, "pull-request URL"),
    pullRequestNumber: positive(value.pullRequestNumber, "pull-request number"),
    targetRepository: text(value.targetRepository, "target repository"),
    headSha: sha(value.headSha, "head SHA"),
    baseSha: sha(value.baseSha, "base SHA"),
    bodyRemainderDigest: digest(value.bodyRemainderDigest, "body remainder digest"),
    sourceBodyDigest: digest(value.sourceBodyDigest, "source body digest"),
    sourceMarkerDigest: digest(value.sourceMarkerDigest, "source marker digest"),
    sourceMarkerDisposition: value.sourceMarkerDisposition === "journaled"
      ? "journaled" : invalid("source marker disposition"),
    targetBodyDigest: digest(value.targetBodyDigest, "target body digest"),
    targetMarkerDigest: digest(value.targetMarkerDigest, "target marker digest"),
    targetLeaseDigest: digest(value.targetLeaseDigest, "target lease digest"),
    targetClaimId: digest(value.targetClaimId, "target claim ID"),
    targetClaimDigest: digest(value.targetClaimDigest, "target claim digest"),
    targetTransitionCounter: positive(
      value.targetTransitionCounter,
      "target transition counter",
    ),
    targetLeaseEpoch: positive(value.targetLeaseEpoch, "target lease epoch"),
    targetLeaseExpiresAt: instant(value.targetLeaseExpiresAt, "target lease expiry"),
    targetTaskBindingDigest: digest(
      value.targetTaskBindingDigest,
      "target task binding digest",
    ),
    targetManifestDigest: digest(value.targetManifestDigest, "target manifest digest"),
    targetWriteSetDigest: digest(value.targetWriteSetDigest, "target write-set digest"),
    dirtEvidenceDigest: digest(value.dirtEvidenceDigest, "dirt evidence digest"),
    dirtyPathCount: positive(value.dirtyPathCount, "dirty path count"),
    providerSemantics: value.providerSemantics === "github-cooperative-body-projection/v1"
      ? value.providerSemantics : invalid("provider semantics"),
    mutationBoundary: normalizeBoundary(value.mutationBoundary),
  };
  if (core.sourceBodyDigest === core.targetBodyDigest
    || core.sourceMarkerDigest === core.targetMarkerDigest
    || core.pullRequestUrl
      !== `https://github.com/${core.targetRepository}/pull/${core.pullRequestNumber}`) {
    invalid("marker replay relationship");
  }
  return deepFreeze(core);
}

function normalizeBoundary(value) {
  const boundary = value && typeof value === "object" && !Array.isArray(value)
    ? value : invalid("mutation boundary");
  const normalized = {
    pullRequestWriterMarker: true,
    externalPrivateRecoveryJournal: true,
    cloud: false,
    writerRegistry: false,
    git: false,
    remoteRef: false,
    source: false,
    pullRequestSubject: false,
    pullRequestDraft: false,
    pullRequestAutoMerge: false,
    authoringAuthority: false,
    integrationAuthority: false,
    release: false,
    deployment: false,
    cleanup: false,
  };
  if (canonicalJson(boundary) !== canonicalJson(normalized)) invalid("mutation boundary");
  return deepFreeze(normalized);
}

function phaseReceipt({ plan, phase, priorReceiptDigest, values }) {
  const normalizedValues = normalizePhaseValues(phase, values);
  const core = {
    schema: PHASE_RECEIPT_SCHEMA,
    phase,
    planDigest: plan.planDigest,
    operationKey: activeOwnedDirtCurrentBasePrMarkerReplayOperationKey(plan, phase),
    priorReceiptDigest,
    values: normalizedValues,
    valuesDigest: digestValue(normalizedValues),
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function normalizePhaseValues(phase, values) {
  const source = record(values, `${phase} values`);
  const normalized = structuredClone(source);
  if (phase === "prepared") {
    digest(normalized.authorizationDigest, "authorization digest");
  } else if (phase === "authority-verified") {
    digest(normalized.taskAuthorityReceiptDigest, "task-authority receipt digest");
    digest(normalized.bindingDigest, "task binding digest");
  } else if (phase === "provider-attempted") {
    digest(normalized.revalidationDigest, "provider revalidation digest");
    if (!["journaled", "target"].includes(
      normalized.providerState,
    )) invalid("provider state");
  } else if (phase === "provider-projected") {
    if (!['projected', 'adopted-response-loss', 'already-current'].includes(
      normalized.disposition,
    )) invalid("provider disposition");
    const expectedMutation = normalized.disposition === "projected";
    if (normalized.providerMutation !== expectedMutation) invalid("provider mutation receipt");
    digest(normalized.projectionDigest, "provider projection digest");
  } else if (phase === "complete") {
    digest(normalized.verificationDigest, "terminal verification digest");
  } else {
    invalid("phase values");
  }
  return deepFreeze(normalized);
}

function completionReceipt({ plan, receipts }) {
  const authority = receipts["authority-verified"];
  const projected = receipts["provider-projected"];
  const terminal = receipts.complete;
  if (!authority || !receipts["provider-attempted"] || !projected || !terminal) {
    invalid("completion receipts");
  }
  const core = {
    schema: COMPLETION_SCHEMA,
    operation: OPERATION,
    status: "projection-restored",
    planDigest: plan.planDigest,
    evidenceDigest: plan.evidenceDigest,
    reanchorPlanDigest: plan.reanchorPlanDigest,
    reanchorIntentDigest: plan.reanchorIntentDigest,
    pullRequestId: plan.pullRequestId,
    pullRequestUrl: plan.pullRequestUrl,
    headSha: plan.headSha,
    baseSha: plan.baseSha,
    sourceMarkerDigest: plan.sourceMarkerDigest,
    targetMarkerDigest: plan.targetMarkerDigest,
    targetLeaseDigest: plan.targetLeaseDigest,
    targetClaimId: plan.targetClaimId,
    targetTaskBindingDigest: plan.targetTaskBindingDigest,
    taskAuthorityBindingDigest: authority.values.bindingDigest,
    providerState: "target",
    providerBodyProjected: true,
    providerProjectionDigest: projected.values.projectionDigest,
    terminalVerificationDigest: terminal.values.verificationDigest,
    pullRequestWriterMarkerAtTarget: true,
    externalPrivateRecoveryJournalComplete: true,
    cloudMutation: false,
    writerRegistryMutation: false,
    gitMutation: false,
    remoteRefMutation: false,
    sourceMutation: false,
    pullRequestSubjectMutation: false,
    pullRequestDraftMutation: false,
    pullRequestAutoMergeMutation: false,
    authoringAuthorityGranted: false,
    integrationAuthorityGranted: false,
    released: false,
    deployed: false,
    cleaned: false,
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function sealIntent({ phase, plan, authority, receipts, completion }) {
  const core = {
    schema: INTENT_SCHEMA,
    phase,
    planDigest: plan.planDigest,
    planSnapshot: plan,
    authorization: authority,
    receipts,
    completion,
  };
  return deepFreeze({ ...core, intentDigest: digestValue(core) });
}

function boundedTtl(value) {
  const ttl = Number(value);
  if (!Number.isSafeInteger(ttl) || ttl < 30 || ttl > 900) invalid("TTL");
  return ttl;
}
function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  return value;
}
function positive(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) invalid(label);
  return value;
}
function sha(value, label) {
  if (!SHA.test(String(value || ""))) invalid(label);
  return value;
}
function digest(value, label) {
  if (!DIGEST.test(String(value || ""))) invalid(label);
  return value;
}
function instant(value, label) {
  if (!value || new Date(value).toISOString() !== value) invalid(label);
  return value;
}
function text(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim() || value.includes("\0")) {
    invalid(label);
  }
  return value;
}
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
function invalid(label) {
  throw new Error(`Active-owned-dirt current-base PR-marker replay has invalid ${label}.`);
}
