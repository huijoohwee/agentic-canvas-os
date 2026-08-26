// Responsibility: Seal exact authority and a monotonic replay journal for abandoned-owner recovery.
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import { normalizeRetiredAbandonedOwnedDirtSuccessorRecoveryEvidence }
  from "./retired-abandoned-owned-dirt-successor-recovery-evidence.mjs";

export const OPERATION = "retired-abandoned-owned-dirt-successor-recovery";
export const PLAN_SCHEMA = `agentic-${OPERATION}-plan/v1`;
export const AUTHORIZATION_SCHEMA = `agentic-${OPERATION}-authorization/v1`;
export const INTENT_SCHEMA = `agentic-${OPERATION}-intent/v1`;
export const PHASES = Object.freeze([
  "authorized",
  "source-authorized",
  "snapshotted",
  "reanchor-prepared",
  "local-reanchored",
  "remote-reanchored",
  "pr-reopened",
  "recovery-claimed",
  "recovery-bound",
  "local-cas",
  "pr-marker",
  "verified",
  "complete",
]);

export function buildRecoveryPlan({ evidence, operatorSessionId, ttlSeconds = 1800 } = {}) {
  const source = normalizeRetiredAbandonedOwnedDirtSuccessorRecoveryEvidence(evidence);
  const operator = text(operatorSessionId, "operator session");
  const ttl = boundedTtl(ttlSeconds);
  if (operator === source.lease.sessionId) {
    throw new Error("Recovery requires a distinct successor operator session.");
  }
  const core = {
    schema: PLAN_SCHEMA,
    operation: OPERATION,
    evidence: source,
    evidenceDigest: source.evidenceDigest,
    operatorSessionId: operator,
    ttlSeconds: ttl,
    sourceClaimId: source.sourceClaim.claimId,
    sourceLeaseDigest: source.leaseDigest,
    sourceBaseSha: source.lease.baseSha,
    sourceFenceSha: source.headSha,
    targetLaneRevision: source.reanchor.coordination.commitSha,
    targetCanonicalBaseSha: source.targetProtectedMain.protectedMainSha,
    targetCloudCanonicalBaseSha: source.targetProtectedMain.protectedMainSha,
    targetLocalBaseSha: source.targetProtectedMain.protectedMainSha,
    targetProtectedMainDigest: digestValue(source.targetProtectedMain),
    targetEpochProofDigest: source.targetEpochProof.proofDigest,
    protectedChangedPathsDigest: source.targetProtectedMain.changedPathsDigest,
    dirtyOverlapPathsDigest: source.targetProtectedMain.dirtyOverlapPathsDigest,
    dirtyOverlapPathCount: source.targetProtectedMain.dirtyOverlapPaths.length,
    reanchorProjectionDigest: digestValue(source.reanchor),
    coordinationCommitSha: source.reanchor.coordination.commitSha,
    coordinationTreeSha: source.reanchor.coordination.treeSha,
    coordinationParents: source.reanchor.coordination.parents,
    coordinationMessageDigest: source.reanchor.coordination.messageDigest,
    sourceIndexTreeSha: source.reanchor.sourceIndexTreeSha,
    sourceWorktreeTreeSha: source.reanchor.sourceWorktreeTreeSha,
    targetIndexTreeSha: source.reanchor.targetIndexTreeSha,
    targetWorktreeTreeSha: source.reanchor.targetWorktreeTreeSha,
    dispositionCount: source.reanchor.dispositionCount,
    dispositionsDigest: source.reanchor.dispositionsDigest,
    sourceIndexAuthoredPathCount: source.reanchor.sourceIndexAuthoredPathCount,
    sourceIndexAuthoredPathsDigest: source.reanchor.sourceIndexAuthoredPathsDigest,
    sourceWorktreeAuthoredPathCount: source.reanchor.sourceWorktreeAuthoredPathCount,
    sourceWorktreeAuthoredPathsDigest: source.reanchor.sourceWorktreeAuthoredPathsDigest,
    protectedIndexIntegratedPathCount: source.reanchor.protectedIndexIntegratedPathCount,
    protectedIndexIntegratedPathsDigest: source.reanchor.protectedIndexIntegratedPathsDigest,
    protectedWorktreeIntegratedPathCount: source.reanchor.protectedWorktreeIntegratedPathCount,
    protectedWorktreeIntegratedPathsDigest:
      source.reanchor.protectedWorktreeIntegratedPathsDigest,
    targetDirtEvidenceDigest: source.reanchor.targetDirtEvidenceDigest,
    targetDirtyPathCount: source.reanchor.targetDirtyPathCount,
    ignoredPathCount: source.reanchor.ignoredRetention.pathCount,
    ignoredPathsDigest: source.reanchor.ignoredRetention.pathsDigest,
    predecessorClaimId: null,
    writerLeaseEpoch: source.lease.epoch,
    targetCloudLeaseEpoch: source.targetCloudLeaseEpoch,
    targetManifestDigest: source.targetManifest.manifestDigest,
    targetWriteSetDigest: source.targetManifest.writeSetDigest,
    targetDeclaredWriteSet: source.targetManifest.declaredWriteSet,
    targetCapabilityDigest: source.targetCapabilityDigest,
    allowedEffects: [
      "private-replay-journal",
      "source-task-authority-proof",
      "owned-dirt-snapshot-ref",
      "deterministic-coordination-commit",
      "source-preserving-index-worktree-overlay",
      "local-head-index-worktree-branch-reanchor",
      "exact-remote-force-with-lease-reanchor",
      "pull-request-reopen-and-base-projection",
      "cloud-fresh-current-protected-base-claim",
      "cloud-review-binding",
      "writer-lease-admission-cloud-task-cas",
      "pull-request-marker-projection",
    ],
    forbiddenEffects: [
      "authored-byte-mode-or-deletion-change",
      "authored-commit",
      "non-coordination-commit",
      "non-projected-index-worktree-change",
      "non-exact-local-ref-change",
      "non-exact-remote-ref-change",
      "non-force-with-lease-push",
      "cloud-predecessor-link",
      "pull-request-merge",
      "deployment",
      "cleanup",
    ],
  };
  const planDigest = digestValue(core);
  return deepFreeze({
    ...core,
    planDigest,
    exactAuthorization: `authorize ${OPERATION} ${planDigest}`,
  });
}

export function normalizeRecoveryPlan(value) {
  if (value?.schema !== PLAN_SCHEMA || value.operation !== OPERATION) invalid("plan schema");
  const rebuilt = buildRecoveryPlan({
    evidence: value.evidence,
    operatorSessionId: value.operatorSessionId,
    ttlSeconds: value.ttlSeconds,
  });
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("plan projection");
  return rebuilt;
}

export function authorizeRecovery({ plan, authorization } = {}) {
  const source = normalizeRecoveryPlan(plan);
  if (authorization !== source.exactAuthorization) {
    throw new Error(`Recovery requires exact authorization: ${source.exactAuthorization}`);
  }
  const core = {
    schema: AUTHORIZATION_SCHEMA,
    status: "authorized",
    planDigest: source.planDigest,
    statement: authorization,
  };
  return deepFreeze({ ...core, authorizationDigest: digestValue(core) });
}

export function createRecoveryIntent(plan, authorization) {
  const source = normalizeRecoveryPlan(plan);
  const authority = authorizeRecovery({ plan: source, authorization });
  return sealIntent({
    phase: "authorized",
    plan: source,
    authority,
    receipts: {
      authorized: phaseReceipt(source, "authorized", null, {
        authorizationDigest: authority.authorizationDigest,
      }),
    },
    completion: null,
  });
}

export function advanceRecoveryIntent(value, { phase, values } = {}) {
  const current = normalizeRecoveryIntent(value);
  const from = PHASES.indexOf(current.phase);
  const to = PHASES.indexOf(phase);
  if (to !== from + 1) {
    throw new Error("Recovery cannot skip or regress a protected phase.");
  }
  const receipts = {
    ...current.receipts,
    [phase]: phaseReceipt(current.planSnapshot, phase, current.intentDigest, values),
  };
  return sealIntent({
    phase,
    plan: current.planSnapshot,
    authority: current.authorization,
    receipts,
    completion: phase === "complete" ? values : null,
  });
}

export function normalizeRecoveryIntent(value) {
  if (value?.schema !== INTENT_SCHEMA || !PHASES.includes(value.phase)) {
    invalid("intent schema");
  }
  const plan = normalizeRecoveryPlan(value.planSnapshot);
  const authority = authorizeRecovery({
    plan,
    authorization: value.authorization?.statement,
  });
  const names = PHASES.slice(0, PHASES.indexOf(value.phase) + 1);
  if (canonicalJson(Object.keys(value.receipts || {})) !== canonicalJson(names)) {
    invalid("intent phases");
  }
  const receipts = {};
  let priorIntentDigest = null;
  for (const name of names) {
    receipts[name] = phaseReceipt(plan, name, priorIntentDigest, value.receipts[name]?.values);
    priorIntentDigest = sealIntentCore({
      phase: name,
      plan,
      authority,
      receipts: { ...receipts },
      completion: name === "complete" ? value.completion : null,
    }).intentDigest;
  }
  const rebuilt = sealIntent({
    phase: value.phase,
    plan,
    authority,
    receipts,
    completion: value.phase === "complete" ? value.completion : null,
  });
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("intent projection");
  return rebuilt;
}

export function operationKey(plan, phase) {
  const source = normalizeRecoveryPlan(plan);
  if (!PHASES.includes(phase)) invalid("operation phase");
  return `${OPERATION}:${phase}:${digestValue({ planDigest: source.planDigest, phase })}`;
}

function phaseReceipt(plan, phase, priorIntentDigest, values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    invalid(`${phase} values`);
  }
  const normalized = deepFreeze(structuredClone(values));
  const core = {
    schema: `agentic-${OPERATION}-phase/v1`,
    phase,
    planDigest: plan.planDigest,
    operationKey: operationKey(plan, phase),
    priorIntentDigest,
    values: normalized,
    valuesDigest: digestValue(normalized),
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function sealIntent(args) {
  return deepFreeze(sealIntentCore(args));
}

function sealIntentCore({ phase, plan, authority, receipts, completion }) {
  const core = {
    schema: INTENT_SCHEMA,
    phase,
    planDigest: plan.planDigest,
    planSnapshot: plan,
    authorization: authority,
    authorizationDigest: authority.authorizationDigest,
    receipts,
    completion,
  };
  return { ...core, intentDigest: digestValue(core) };
}

function boundedTtl(value) {
  if (!Number.isSafeInteger(value) || value < 60 || value > 86_400) {
    invalid("TTL seconds");
  }
  return value;
}
function text(value, label) {
  const result = String(value || "").trim();
  if (!result) invalid(label);
  return result;
}
function invalid(label) {
  throw new Error(`Retired-abandoned owned-dirt recovery has invalid ${label}.`);
}
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
