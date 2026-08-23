// Responsibility: seal provider-neutral evidence and authority for one recoverable clean-lane removal.
import path from "node:path";
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  normalizeRecoverableLaneCleanupEvidence,
  RECOVERABLE_LANE_CLEANUP_EVIDENCE_SCHEMA,
} from "./recoverable-lane-cleanup-evidence.mjs";
export { normalizeRecoverableLaneCleanupEvidence, RECOVERABLE_LANE_CLEANUP_EVIDENCE_SCHEMA };
export const RECOVERABLE_LANE_CLEANUP_PLAN_SCHEMA = "agentic-recoverable-lane-cleanup-plan/v2";
const LEGACY_PLAN_SCHEMA = "agentic-recoverable-lane-cleanup-plan/v1";
export const RECOVERABLE_LANE_CLEANUP_AUTHORIZATION_SCHEMA = "agentic-recoverable-lane-cleanup-authorization/v1";
export const RECOVERABLE_LANE_CLEANUP_INTENT_SCHEMA = "agentic-recoverable-lane-cleanup-intent/v2";
const LEGACY_INTENT_SCHEMA = "agentic-recoverable-lane-cleanup-intent/v1";
export const RECOVERABLE_LANE_CLEANUP_RECEIPT_SCHEMA = "agentic-recoverable-lane-cleanup-receipt/v1";
const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const PHASES = Object.freeze([
  "prepared", "bundle_verified", "worktree_quarantined", "worktree_removed",
  "reservation_released", "complete",
]);
const ABORT_PHASES = Object.freeze(["drift_aborting", "drift_aborted"]);
const EFFECTS = Object.freeze({
  worktree: "quarantine-then-remove-non-force",
  worktreeSnapshot: "preserve",
  gitDirectorySnapshot: "preserve",
  localBranch: "preserve",
  remoteRefs: "preserve",
  providerObjects: "preserve",
  objectPruning: "forbid",
  globalWorktreePrune: "forbid",
});
export function buildRecoverableLaneCleanupReservationMarker(
  plan, authorizationDigest, priorLeaseDigest,
) {
  const core = { schema: "agentic-recoverable-lane-cleanup-reservation/v1",
    planDigest: plan.planDigest, subjectKey: plan.subjectKey,
    authorizationDigest, priorLeaseDigest };
  return Object.freeze({ ...core, reservationDigest: digestValue(core) });
}
export function projectRecoverableLaneCleanupReservation(lease) {
  return Object.freeze({ schema: "agentic-recoverable-lane-cleanup-reservation/v1",
    branch: lease.branch, epoch: lease.epoch, sessionId: lease.sessionId,
    reservationDigest: lease.cleanupReservation.reservationDigest });
}
export function buildRecoverableLaneCleanupReservationRelease(plan) {
  const core = { schema: "agentic-recoverable-lane-cleanup-reservation-release/v1",
    planDigest: plan.planDigest, priorLeaseDigest: plan.evidence.authority.priorLeaseDigest };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}
export function buildRecoverableLaneCleanupDriftAbort(
  plan, reservation, restoredStateDigest,
) {
  const core = { schema: "agentic-recoverable-lane-cleanup-drift-abort/v1",
    planDigest: plan.planDigest, reservationDigest: reservation.reservationDigest,
    restoredStateDigest };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}
export function buildRecoverableLaneCleanupPlan({
  evidence, recoveryDirectory, sessionId, operatorDecisionDigest,
  supersededPreservationDigests = [],
}) {
  return buildPlan({ evidence, recoveryDirectory, sessionId, operatorDecisionDigest,
    supersededPreservationDigests });
}
function buildPlan({
  evidence, recoveryDirectory, sessionId, operatorDecisionDigest,
  supersededPreservationDigests = [],
}, { allowLegacy = false, schema = RECOVERABLE_LANE_CLEANUP_PLAN_SCHEMA } = {}) {
  const normalizedEvidence = normalizeRecoverableLaneCleanupEvidence(evidence);
  if (!allowLegacy) assertCurrentEvidence(normalizedEvidence);
  const legacy = schema === LEGACY_PLAN_SCHEMA;
  if (![LEGACY_PLAN_SCHEMA, RECOVERABLE_LANE_CLEANUP_PLAN_SCHEMA].includes(schema)
    || legacy !== (normalizedEvidence.schema !== RECOVERABLE_LANE_CLEANUP_EVIDENCE_SCHEMA)) {
    throw new Error("Cleanup plan and evidence versions are incompatible.");
  }
  const recovery = normalizeRecovery(recoveryDirectory);
  assertRecoveryIsolation(normalizedEvidence, recovery);
  const superseded = normalizeDigests(
    supersededPreservationDigests, "superseded preservation receipt",
  );
  if (canonicalJson(superseded)
    !== canonicalJson(normalizedEvidence.authority.preservationReceiptDigests)) {
    throw new Error("Cleanup plan must supersede the exact observed preservation receipts.");
  }
  const subjectKey = digestValue({
    schema: "agentic-recoverable-lane-cleanup-subject/v1",
    repositoryIdentityDigest: normalizedEvidence.repository.identityDigest,
    worktreePath: normalizedEvidence.target.worktreePath,
    branch: normalizedEvidence.target.branch,
  });
  const core = {
    schema,
    subjectKey,
    evidence: normalizedEvidence,
    evidenceDigest: normalizedEvidence.evidenceDigest,
    recovery,
    sessionId: requiredText(sessionId, "cleanup session"),
    operatorDecisionDigest: requiredDigest(operatorDecisionDigest, "operator decision digest"),
    disposition: "drop-with-durable-recovery",
    supersededPreservationDigests: superseded,
    effects: EFFECTS,
    phases: legacy ? PHASES : [...PHASES, ...ABORT_PHASES],
  };
  const planDigest = digestValue(core);
  return deepFreeze({
    ...core,
    exactAuthorization: `authorize recoverable-lane-cleanup ${planDigest}`,
    planDigest,
  });
}
export function normalizeRecoverableLaneCleanupPlan(value) {
  exactObject(value, "Cleanup plan", [
    "schema", "subjectKey", "evidence", "evidenceDigest", "recovery",
    "sessionId", "operatorDecisionDigest", "disposition",
    "supersededPreservationDigests", "effects", "phases",
    "exactAuthorization", "planDigest",
  ]);
  const rebuilt = buildPlan({
    evidence: value.evidence,
    recoveryDirectory: value.recovery?.directory,
    sessionId: value.sessionId,
    operatorDecisionDigest: value.operatorDecisionDigest,
    supersededPreservationDigests: value.supersededPreservationDigests,
  }, { allowLegacy: true, schema: value.schema });
  if (canonicalJson(value) !== canonicalJson(rebuilt)) {
    throw new Error("Cleanup plan is malformed, incomplete, or drifted.");
  }
  return rebuilt;
}
export function authorizeRecoverableLaneCleanup({ plan, authorization }) {
  const normalized = normalizeRecoverableLaneCleanupPlan(plan);
  assertCurrentEvidence(normalized.evidence);
  if (authorization !== normalized.exactAuthorization) {
    throw new Error(`Cleanup requires exact authorization: ${normalized.exactAuthorization}`);
  }
  const core = {
    schema: RECOVERABLE_LANE_CLEANUP_AUTHORIZATION_SCHEMA,
    planDigest: normalized.planDigest,
    subjectKey: normalized.subjectKey,
    sessionId: normalized.sessionId,
    operatorDecisionDigest: normalized.operatorDecisionDigest,
    authorizationDigest: digestValue({
      schema: RECOVERABLE_LANE_CLEANUP_AUTHORIZATION_SCHEMA,
      planDigest: normalized.planDigest,
      authorization,
    }),
  };
  return deepFreeze(core);
}
export function createRecoverableLaneCleanupIntent({ plan, authorization }) {
  const normalized = normalizeRecoverableLaneCleanupPlan(plan);
  assertCurrentEvidence(normalized.evidence);
  const authorized = normalizeAuthorization(authorization, normalized);
  return sealIntent({
    schema: RECOVERABLE_LANE_CLEANUP_INTENT_SCHEMA,
    status: "prepared",
    plan: normalized,
    planDigest: normalized.planDigest,
    subjectKey: normalized.subjectKey,
    authorizationDigest: authorized.authorizationDigest,
    phases: { prepared: { operationKey: operationKey(normalized, "prepared") } },
  });
}
export function advanceRecoverableLaneCleanupIntent(intentValue, { status, evidence }) {
  const intent = normalizeRecoverableLaneCleanupIntent(intentValue);
  const ordinary = PHASES[PHASES.indexOf(intent.status) + 1] === status;
  const abort = (intent.status === "bundle_verified" && status === "drift_aborting")
    || (intent.status === "drift_aborting" && status === "drift_aborted");
  if (!ordinary && !abort) {
    throw new Error(`Cleanup intent cannot advance from ${intent.status} to ${status}.`);
  }
  const entry = normalizePhase(status, {
    operationKey: operationKey(intent.plan, status),
    ...requiredObject(evidence, `${status} evidence`),
  }, intent.plan);
  if (status === "worktree_removed") assertSameSnapshots(
    entry, intent.phases.worktree_quarantined,
  );
  return sealIntent({
    schema: intent.schema,
    status,
    plan: intent.plan,
    planDigest: intent.planDigest,
    subjectKey: intent.subjectKey,
    authorizationDigest: intent.authorizationDigest,
    phases: { ...intent.phases, [status]: entry },
  });
}
export function normalizeRecoverableLaneCleanupIntent(value) {
  exactObject(value, "Cleanup intent", [
    "schema", "status", "plan", "planDigest", "subjectKey",
    "authorizationDigest", "phases", "intentDigest",
  ]);
  const plan = normalizeRecoverableLaneCleanupPlan(value.plan);
  const status = requiredText(value.status, "intent status");
  const schema = requiredText(value.schema, "intent schema");
  const index = PHASES.indexOf(status);
  const abortIndex = ABORT_PHASES.indexOf(status);
  if (index < 0 && abortIndex < 0) throw new Error(`Unsupported cleanup intent status: ${status}.`);
  const legacy = plan.schema === LEGACY_PLAN_SCHEMA;
  if ((legacy && (schema !== LEGACY_INTENT_SCHEMA || status !== "complete"))
    || (!legacy && schema !== RECOVERABLE_LANE_CLEANUP_INTENT_SCHEMA)) {
    throw new Error("Legacy cleanup intent is complete-observation-only and versions must match.");
  }
  const expected = abortIndex < 0 ? PHASES.slice(0, index + 1)
    : [...PHASES.slice(0, 2), ...ABORT_PHASES.slice(0, abortIndex + 1)];
  if (canonicalJson(Object.keys(requiredObject(value.phases, "intent phases")))
    !== canonicalJson(expected)) {
    throw new Error("Cleanup intent phases are incomplete or out of order.");
  }
  const core = {
    schema,
    status,
    plan,
    planDigest: requiredDigest(value.planDigest, "intent plan digest"),
    subjectKey: requiredDigest(value.subjectKey, "intent subject key"),
    authorizationDigest: requiredDigest(value.authorizationDigest, "intent authorization digest"),
    phases: Object.fromEntries(expected.map(phase => [
      phase, normalizePhase(phase, value.phases[phase], plan),
    ])),
  };
  if (![LEGACY_INTENT_SCHEMA, RECOVERABLE_LANE_CLEANUP_INTENT_SCHEMA].includes(core.schema)
    || core.planDigest !== plan.planDigest || core.subjectKey !== plan.subjectKey
    || value.intentDigest !== digestValue(core)) {
    throw new Error("Cleanup intent schema, binding, or digest is invalid.");
  }
  return deepFreeze({ ...core, intentDigest: value.intentDigest });
}
export function buildRecoverableLaneCleanupReceipt({ intent, bundle, finalObservation }) {
  const normalized = normalizeRecoverableLaneCleanupIntent(intent);
  if (normalized.status !== "reservation_released") {
    throw new Error("Cleanup receipt requires a released cleanup reservation.");
  }
  const final = normalizeFinalObservation(finalObservation, normalized.plan,
    normalized.phases.worktree_removed);
  const core = {
    schema: RECOVERABLE_LANE_CLEANUP_RECEIPT_SCHEMA,
    status: "complete",
    planDigest: normalized.planDigest,
    subjectKey: normalized.subjectKey,
    authorizationDigest: normalized.authorizationDigest,
    intentDigest: normalized.intentDigest,
    bundle: normalizeBundle(bundle),
    finalObservation: final,
    reservationRelease: normalizeRelease(normalized.phases.reservation_released.release),
    effects: EFFECTS,
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}
export function normalizeRecoverableLaneCleanupReceipt(value) {
  exactObject(value, "Cleanup receipt", [
    "schema", "status", "planDigest", "subjectKey", "authorizationDigest",
    "intentDigest", "bundle", "finalObservation", "reservationRelease",
    "effects", "receiptDigest",
  ]);
  if (value.schema !== RECOVERABLE_LANE_CLEANUP_RECEIPT_SCHEMA
    || value.status !== "complete" || canonicalJson(value.effects) !== canonicalJson(EFFECTS)) {
    throw new Error("Cleanup receipt schema, status, or effects are invalid.");
  }
  const core = {
    schema: value.schema,
    status: value.status,
    planDigest: requiredDigest(value.planDigest, "receipt plan digest"),
    subjectKey: requiredDigest(value.subjectKey, "receipt subject key"),
    authorizationDigest: requiredDigest(value.authorizationDigest, "receipt authorization digest"),
    intentDigest: requiredDigest(value.intentDigest, "receipt intent digest"),
    bundle: normalizeBundle(value.bundle),
    finalObservation: normalizeFinalObservation(value.finalObservation),
    reservationRelease: normalizeRelease(value.reservationRelease),
    effects: EFFECTS,
  };
  if (value.receiptDigest !== digestValue(core)) throw new Error("Cleanup receipt digest is invalid.");
  return deepFreeze({ ...core, receiptDigest: value.receiptDigest });
}
export function recoverableLaneCleanupEffects() { return EFFECTS; }
function assertCurrentEvidence(evidence) {
  if (evidence.schema !== RECOVERABLE_LANE_CLEANUP_EVIDENCE_SCHEMA) {
    throw new Error("New cleanup planning and execution require generated-residue evidence v2.");
  }
}
function normalizeRecovery(directory) {
  const value = absolutePath(directory, "recovery directory");
  return {
    directory: value,
    bundlePath: path.join(value, "lane.bundle"),
    quarantinePath: path.join(value, "worktree-staging"),
    snapshotPath: path.join(value, "worktree-snapshot"),
    gitDirSnapshotPath: path.join(value, "worktree-gitdir-snapshot"),
    disposableGitDirStagingPath: path.join(value, "worktree-gitdir-disposable"),
    intentPath: path.join(value, "cleanup-intent.json"),
    receiptPath: path.join(value, "cleanup-receipt.json"),
  };
}
function normalizeBundle(value) {
  exactObject(value, "Recovery bundle", [
    "path", "sha256", "sizeBytes", "headSha", "treeSha", "headRef", "complete",
  ]);
  if (value.complete !== true) throw new Error("Recovery bundle must contain complete history.");
  return {
    path: absolutePath(value.path, "bundle path"), sha256: requiredDigest(value.sha256, "bundle digest"),
    sizeBytes: positiveInteger(value.sizeBytes, "bundle size"),
    headSha: requiredSha(value.headSha, "bundle head"), treeSha: requiredSha(value.treeSha, "bundle tree"),
    headRef: value.headRef === "HEAD" ? "HEAD" : requiredBranch(value.headRef), complete: true,
  };
}
function normalizePhase(phase, value, plan) {
  const operation = operationKey(plan, phase);
  if (phase === "prepared") {
    exactObject(value, "prepared phase", ["operationKey"]);
    if (value.operationKey !== operation) throw new Error("Cleanup prepared operation key is invalid.");
    return { operationKey: operation };
  }
  if (phase === "bundle_verified") {
    exactObject(value, "bundle-verified phase", ["operationKey", "bundle", "reservation", "quarantineStateDigest"]);
    return phaseOperation(value, operation, {
      bundle: normalizeBundle(value.bundle), reservation: normalizeReservation(value.reservation),
      quarantineStateDigest: requiredDigest(value.quarantineStateDigest, "quarantine state digest"),
    });
  }
  if (phase === "worktree_quarantined") {
    exactObject(value, "worktree-quarantined phase", [
      "operationKey", ...artifactKeys(), "disposableGitDirDigest",
      "disposableGitDirGenerationDigest", "removalStateDigest",
    ]);
    const artifact = normalizeArtifact(value, "quarantined", true);
    if (artifact.targetRegistered || artifact.targetExists || !artifact.stagingRegistered
      || artifact.stagingExists || !artifact.disposableGitDirExists) {
      throw new Error("Cleanup worktree-quarantined phase is invalid.");
    }
    return phaseOperation(value, operation, {
      ...artifact,
      disposableGitDirDigest: requiredDigest(value.disposableGitDirDigest, "disposable Git-directory digest"),
      disposableGitDirGenerationDigest: requiredDigest(value.disposableGitDirGenerationDigest, "disposable Git-directory generation"),
      removalStateDigest: requiredDigest(value.removalStateDigest, "removal state digest"),
    });
  }
  if (phase === "worktree_removed") {
    exactObject(value, "worktree-removed phase", [
      "operationKey", ...artifactKeys(), "replayedAbsentRegistration",
    ]);
    const artifact = normalizeArtifact(value, "removed", false);
    if (artifact.targetRegistered || artifact.targetExists || artifact.stagingRegistered
      || artifact.stagingExists || artifact.disposableGitDirExists) {
      throw new Error("Cleanup worktree-removed phase is invalid.");
    }
    return phaseOperation(value, operation, {
      ...artifact,
      replayedAbsentRegistration: requiredBoolean(value.replayedAbsentRegistration, "removal replay flag"),
    });
  }
  if (phase === "reservation_released") {
    exactObject(value, "reservation-released phase", ["operationKey", "release"]);
    return phaseOperation(value, operation, { release: normalizeRelease(value.release) });
  }
  if (phase === "drift_aborting") {
    exactObject(value, "drift-aborting phase", ["operationKey", "restoredStateDigest"]);
    return phaseOperation(value, operation, {
      restoredStateDigest: requiredDigest(value.restoredStateDigest, "restored state digest"),
    });
  }
  if (phase === "drift_aborted") {
    exactObject(value, "drift-aborted phase", ["operationKey", "release"]);
    return phaseOperation(value, operation, { release: normalizeAbortRelease(value.release) });
  }
  if (phase === "complete") {
    exactObject(value, "complete phase", ["operationKey", "receiptDigest"]);
    return phaseOperation(value, operation, { receiptDigest: requiredDigest(value.receiptDigest, "receipt digest") });
  }
  throw new Error(`Unsupported cleanup intent phase: ${phase}.`);
}
function normalizeReservation(value) {
  exactObject(value, "Cleanup reservation", ["schema", "branch", "epoch", "sessionId", "reservationDigest"]);
  if (value.schema !== "agentic-recoverable-lane-cleanup-reservation/v1") throw new Error("Cleanup reservation schema is invalid.");
  return {
    schema: value.schema, branch: requiredText(value.branch, "reservation branch"),
    epoch: positiveInteger(value.epoch, "reservation epoch"),
    sessionId: requiredText(value.sessionId, "reservation session"),
    reservationDigest: requiredDigest(value.reservationDigest, "reservation digest"),
  };
}
function normalizeRelease(value) {
  exactObject(value, "Reservation release", ["schema", "planDigest", "priorLeaseDigest", "receiptDigest"]);
  const core = {
    schema: requiredText(value.schema, "release schema"),
    planDigest: requiredDigest(value.planDigest, "release plan digest"),
    priorLeaseDigest: value.priorLeaseDigest === null ? null : requiredDigest(value.priorLeaseDigest, "release prior lease digest"),
  };
  if (core.schema !== "agentic-recoverable-lane-cleanup-reservation-release/v1"
    || value.receiptDigest !== digestValue(core)) throw new Error("Reservation release receipt is invalid.");
  return { ...core, receiptDigest: value.receiptDigest };
}
function normalizeAbortRelease(value) {
  exactObject(value, "Drift abort release", [
    "schema", "planDigest", "reservationDigest", "restoredStateDigest", "receiptDigest",
  ]);
  const core = { schema: requiredText(value.schema, "abort release schema"),
    planDigest: requiredDigest(value.planDigest, "abort release plan digest"),
    reservationDigest: requiredDigest(value.reservationDigest, "abort reservation digest"),
    restoredStateDigest: requiredDigest(value.restoredStateDigest, "abort restored state digest") };
  if (core.schema !== "agentic-recoverable-lane-cleanup-drift-abort/v1"
    || value.receiptDigest !== digestValue(core)) throw new Error("Drift abort receipt is invalid.");
  return { ...core, receiptDigest: value.receiptDigest };
}
function normalizeArtifact(value, label, disposable) {
  const artifact = {
    targetRegistered: requiredBoolean(value.targetRegistered, `${label} target registration`),
    targetExists: requiredBoolean(value.targetExists, `${label} target existence`),
    stagingRegistered: requiredBoolean(value.stagingRegistered, `${label} staging registration`),
    stagingExists: requiredBoolean(value.stagingExists, `${label} staging existence`),
    snapshotExists: requiredBoolean(value.snapshotExists, `${label} snapshot existence`),
    snapshotDigest: requiredDigest(value.snapshotDigest, `${label} snapshot digest`),
    snapshotGenerationDigest: requiredDigest(value.snapshotGenerationDigest, `${label} snapshot generation`),
    gitDirSnapshotExists: requiredBoolean(value.gitDirSnapshotExists, `${label} Git snapshot existence`),
    gitDirSnapshotDigest: requiredDigest(value.gitDirSnapshotDigest, `${label} Git snapshot digest`),
    gitDirSnapshotGenerationDigest: requiredDigest(value.gitDirSnapshotGenerationDigest, `${label} Git snapshot generation`),
    disposableGitDirExists: requiredBoolean(value.disposableGitDirExists, `${label} disposable Git directory`),
  };
  if (!artifact.snapshotExists || !artifact.gitDirSnapshotExists
    || artifact.disposableGitDirExists !== disposable) {
    throw new Error(`Cleanup ${label} recovery artifacts are invalid.`);
  }
  return artifact;
}
function artifactKeys() {
  return [
    "targetRegistered", "targetExists", "stagingRegistered", "stagingExists",
    "snapshotExists", "snapshotDigest", "snapshotGenerationDigest",
    "gitDirSnapshotExists", "gitDirSnapshotDigest", "gitDirSnapshotGenerationDigest",
    "disposableGitDirExists",
  ];
}
function normalizeFinalObservation(value, plan = null, expected = null) {
  exactObject(value, "Final observation", [
    ...artifactKeys(), "priorLeaseRestored", "canonicalHeadSha", "branchHeadSha", "remoteBranchSha",
  ]);
  const normalized = {
    ...normalizeArtifact(value, "final", false),
    priorLeaseRestored: requiredBoolean(value.priorLeaseRestored, "prior lease restoration"),
    canonicalHeadSha: requiredSha(value.canonicalHeadSha, "final canonical HEAD"),
    branchHeadSha: value.branchHeadSha === null
      ? null : requiredSha(value.branchHeadSha, "final branch HEAD"),
    remoteBranchSha: value.remoteBranchSha === null ? null : requiredSha(value.remoteBranchSha, "final remote branch"),
  };
  if (normalized.targetRegistered || normalized.targetExists || normalized.stagingRegistered
    || normalized.stagingExists || !normalized.priorLeaseRestored) {
    throw new Error("Final cleanup observation is incomplete.");
  }
  if (plan && (normalized.canonicalHeadSha !== plan.evidence.canonical.headSha
    || normalized.branchHeadSha !== plan.evidence.target.branchHeadSha
    || normalized.remoteBranchSha !== plan.evidence.remoteBranch.sha)) {
    throw new Error("Canonical or branch identity drifted during cleanup.");
  }
  if (expected) assertSameSnapshots(normalized, expected);
  return normalized;
}
function assertSameSnapshots(left, right) {
  for (const field of [
    "snapshotDigest", "snapshotGenerationDigest", "gitDirSnapshotDigest",
    "gitDirSnapshotGenerationDigest",
  ]) if (left[field] !== right[field]) throw new Error("Cleanup recovery snapshots changed between phases.");
}
function phaseOperation(value, operation, fields) {
  if (value.operationKey !== operation) throw new Error("Cleanup phase operation key is invalid.");
  return { operationKey: operation, ...fields };
}
function normalizeAuthorization(value, plan) {
  exactObject(value, "Cleanup authorization", [
    "schema", "planDigest", "subjectKey", "sessionId", "operatorDecisionDigest", "authorizationDigest",
  ]);
  const expected = authorizeRecoverableLaneCleanup({ plan, authorization: plan.exactAuthorization });
  if (canonicalJson(value) !== canonicalJson(expected)) throw new Error("Cleanup authorization is invalid.");
  return expected;
}
function sealIntent(core) { return deepFreeze({ ...core, intentDigest: digestValue(core) }); }
function operationKey(plan, phase) {
  return digestValue({ schema: "agentic-recoverable-lane-cleanup-operation/v1",
    planDigest: plan.planDigest, subjectKey: plan.subjectKey, phase });
}
function assertRecoveryIsolation(evidence, recovery) {
  for (const forbidden of [evidence.repository.root, evidence.repository.gitCommonDir, evidence.target.worktreePath]) {
    if (sameOrContains(forbidden, recovery.directory) || sameOrContains(recovery.directory, forbidden)) {
      throw new Error("Recovery directory must be isolated from repository and worktree paths.");
    }
  }
}
function sameOrContains(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
function requiredBranch(value) {
  const text = requiredText(value, "branch ref");
  if (!text.startsWith("refs/heads/") || text === "refs/heads/main") throw new Error("Cleanup requires an exact non-main branch ref.");
  return text;
}
function requiredSha(value, label) { const text = requiredText(value, label);
  if (!SHA.test(text)) throw new Error(`${label} must be an exact Git SHA.`); return text; }
function requiredDigest(value, label) { const text = requiredText(value, label);
  if (!DIGEST.test(text)) throw new Error(`${label} must be a SHA-256 digest.`); return text; }
function normalizeDigests(values, label) {
  if (!Array.isArray(values)) throw new Error(`${label} values must be an array.`);
  const normalized = values.map(value => requiredDigest(value, label)).sort();
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} values must be unique.`);
  return normalized;
}
function normalizeTextList(values, label) {
  if (!Array.isArray(values)) throw new Error(`${label} values must be an array.`);
  const normalized = values.map(value => requiredText(value, label)).sort();
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} values must be unique.`);
  return normalized;
}
function absolutePath(value, label) {
  const text = requiredText(value, label);
  if (!path.isAbsolute(text) || path.normalize(text) !== text) throw new Error(`${label} must be a normalized absolute path.`);
  return text;
}
function positiveInteger(value, label) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer.`);
  return value;
}
function nonNegativeInteger(value, label) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value;
}
function requiredBoolean(value, label) { if (typeof value !== "boolean") throw new Error(`${label} must be a boolean.`); return value; }
function requiredText(value, label) { const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(`${label} is required.`); return text; }
function requiredObject(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is required.`); return value; }
function exactObject(value, label, keys) {
  requiredObject(value, label);
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) throw new Error(`${label} fields are malformed or incomplete.`);
}
function deepFreeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); return value; }
