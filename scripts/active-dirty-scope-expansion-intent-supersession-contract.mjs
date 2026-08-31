// Responsibility: Seal exact evidence for clearing one provably no-effect stale scope-expansion intent.
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { normalizeActiveOwnedDirtEvidence }
  from "./active-owned-dirt-recovery-evidence.mjs";
import { normalizeDeclaredWriteScopeManifest }
  from "./scoped-lane-admission-lib.mjs";
import { normalizeActiveDirtyScopeExpansionPlan }
  from "./active-dirty-scope-expansion-contract.mjs";
import { SCOPE_EXPANSION_INTENT_SCHEMA }
  from "./writer-lease-registry-cas.mjs";
import {
  buildGithubCloudCollaborationLedgerRefBarrierRequest,
  normalizeGithubCloudCollaborationLedgerRefBarrierReceipt,
}
  from "./github-cloud-collaboration-ledger-ref-barrier.mjs";

export const OPERATION = "active-dirty-scope-expansion-intent-supersession";
export const PLAN_SCHEMA =
  "agentic-active-dirty-scope-expansion-intent-supersession-plan/v1";
export const AUTHORIZATION_SCHEMA =
  "agentic-active-dirty-scope-expansion-intent-supersession-authorization/v1";
export const RECEIPT_SCHEMA =
  "agentic-active-dirty-scope-expansion-intent-supersession-receipt/v1";
export const RECEIPT_MAP = "scopeExpansionIntentSupersessionReceipts";

const DIGEST = /^[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40}$/u;
const NO_EFFECT_FIELDS = Object.freeze([
  "targetClaimId",
  "targetClaimDigest",
  "targetReviewRequestId",
  "completedReceiptDigest",
  "waiting",
  "waitingReceiptDigest",
  "sourceRetirementReceiptDigest",
  "promoted",
  "promotedReceiptDigest",
  "boundAuthority",
  "boundReceiptDigest",
  "localProjection",
  "localProjectionReceiptDigest",
  "pullRequestProjection",
  "pullRequestProjectionReceiptDigest",
  "finalReceiptDigest",
]);
const INITIAL_INTENT_FIELDS = Object.freeze([
  "schema",
  "status",
  "branch",
  "sourceLeaseDigest",
  "sourceClaimId",
  "sourceFenceSha",
  "targetWriteSetDigest",
  "targetManifestDigest",
  "planDigest",
  "targetClaimId",
  "targetClaimDigest",
  "targetLeaseEpoch",
  "targetCanonicalBaseSha",
  "targetReviewRequestId",
  "completedReceiptDigest",
  "planSnapshot",
]);
const ALLOWED_INTENT_FIELDS = new Set([...INITIAL_INTENT_FIELDS, ...NO_EFFECT_FIELDS]);

export function assertNoEffectScopeExpansionIntent(value, { branch = null } = {}) {
  object(value, "scope-expansion intent");
  const fields = Object.keys(value);
  if (value.schema !== SCOPE_EXPANSION_INTENT_SCHEMA
    || value.status !== "intent"
    || (branch !== null && value.branch !== branch)
    || !text(value.branch, "intent branch")
    || !DIGEST.test(String(value.sourceLeaseDigest || ""))
    || !DIGEST.test(String(value.sourceClaimId || ""))
    || !SHA.test(String(value.sourceFenceSha || ""))
    || !DIGEST.test(String(value.targetWriteSetDigest || ""))
    || !DIGEST.test(String(value.targetManifestDigest || ""))
    || !DIGEST.test(String(value.planDigest || ""))
    || INITIAL_INTENT_FIELDS.some(field => !Object.hasOwn(value, field))
    || fields.some(field => !ALLOWED_INTENT_FIELDS.has(field))
    || value.targetLeaseEpoch !== 1
    || !SHA.test(String(value.targetCanonicalBaseSha || ""))) {
    throw new Error("Intent supersession requires one exact intent-phase scope-expansion record.");
  }
  for (const field of NO_EFFECT_FIELDS) {
    if (value[field] !== null && value[field] !== undefined) {
      throw new Error(`Intent supersession rejects effect evidence in ${field}.`);
    }
  }
  object(value.planSnapshot, "scope-expansion plan snapshot");
  const normalizedPlan = normalizeActiveDirtyScopeExpansionPlan(value.planSnapshot);
  if (normalizedPlan.planDigest !== value.planDigest
    || normalizedPlan.sourceBranch !== value.branch
    || normalizedPlan.sourceFenceSha !== value.sourceFenceSha
    || normalizedPlan.sourceLeaseDigest !== value.sourceLeaseDigest
    || normalizedPlan.sourceClaimId !== value.sourceClaimId
    || normalizedPlan.targetManifestDigest !== value.targetManifestDigest
    || normalizedPlan.targetWriteSetDigest !== value.targetWriteSetDigest
    || normalizedPlan.targetCanonicalBaseSha !== value.targetCanonicalBaseSha) {
    throw new Error("Intent supersession requires the exact sealed source plan snapshot.");
  }
  return deepFreeze(value);
}

export function buildActiveDirtyScopeExpansionIntentSupersessionPlan({ evidence }) {
  const normalized = normalizeEvidence(evidence);
  const core = {
    schema: PLAN_SCHEMA,
    operation: OPERATION,
    disposition: normalized.lease.disposition,
    mutation: "archive-and-clear-only",
    recoveryRoute: normalized.lease.disposition === "current"
      ? "renew-then-plan-fresh-scope-expansion"
      : "expired-active-dirty-recovery-then-plan-fresh-scope-expansion",
    evidence: normalized,
  };
  return deepFreeze({ ...core, planDigest: digestValue(core) });
}

export function normalizeActiveDirtyScopeExpansionIntentSupersessionPlan(value) {
  object(value, "supersession plan");
  const expected = buildActiveDirtyScopeExpansionIntentSupersessionPlan({
    evidence: value.evidence,
  });
  if (value.schema !== expected.schema
    || value.operation !== expected.operation
    || value.disposition !== expected.disposition
    || value.mutation !== expected.mutation
    || value.recoveryRoute !== expected.recoveryRoute
    || digest(value.planDigest, "plan digest") !== expected.planDigest) {
    throw new Error("Scope-expansion intent supersession plan drifted.");
  }
  return expected;
}

export function authorizeActiveDirtyScopeExpansionIntentSupersession({
  plan,
  authorization,
}) {
  const normalized = normalizeActiveDirtyScopeExpansionIntentSupersessionPlan(plan);
  const expected = `authorize ${OPERATION} ${normalized.planDigest}`;
  if (String(authorization || "").trim() !== expected) {
    throw new Error(`Intent supersession requires exact authorization: ${expected}`);
  }
  const core = {
    schema: AUTHORIZATION_SCHEMA,
    planDigest: normalized.planDigest,
    authorization: expected,
  };
  return Object.freeze({ ...core, authorizationDigest: digestValue(core) });
}

export function buildActiveDirtyScopeExpansionIntentSupersessionReceipt({
  plan,
  authorizationDigest,
  taskAuthorityReceiptDigest,
  barrierReceipt,
  registryRevisionBefore,
  registryRevisionAfter,
}) {
  const normalized = normalizeActiveDirtyScopeExpansionIntentSupersessionPlan(plan);
  const before = nonNegative(registryRevisionBefore, "registry revision before");
  const after = nonNegative(registryRevisionAfter, "registry revision after");
  if (after !== before + 1) {
    throw new Error("Intent supersession registry revision is not an exact one-CAS transition.");
  }
  const barrier = normalizeGithubCloudCollaborationLedgerRefBarrierReceipt(barrierReceipt);
  const expectedBarrierRequest = buildGithubCloudCollaborationLedgerRefBarrierRequest({
    operation: OPERATION,
    operationDigest: normalized.planDigest,
    repository: normalized.evidence.cloud.ledgerRepository,
    ref: "refs/heads/agentic/collaboration-ledger",
    sourceRevision: normalized.evidence.cloud.revision,
    sourceTreeSha: normalized.evidence.cloud.treeSha,
    ledgerBlobSha: normalized.evidence.cloud.blobSha,
    rawDigest: normalized.evidence.cloud.rawDigest,
    ledgerDigest: normalized.evidence.cloud.ledgerDigest,
    sequence: normalized.evidence.cloud.sequence,
  });
  if (barrier.operation !== OPERATION
    || barrier.operationDigest !== normalized.planDigest
    || barrier.repository !== normalized.evidence.cloud.ledgerRepository
    || barrier.ref !== "refs/heads/agentic/collaboration-ledger"
    || barrier.sourceRevision !== normalized.evidence.cloud.revision
    || barrier.sourceTreeSha !== normalized.evidence.cloud.treeSha
    || barrier.ledgerBlobSha !== normalized.evidence.cloud.blobSha
    || barrier.rawDigest !== normalized.evidence.cloud.rawDigest
    || barrier.ledgerDigest !== normalized.evidence.cloud.ledgerDigest
    || barrier.sequence !== normalized.evidence.cloud.sequence
    || barrier.metadataDigest !== expectedBarrierRequest.metadataDigest
    || barrier.messageDigest !== expectedBarrierRequest.messageDigest) {
    throw new Error("Intent supersession requires the exact sealed ledger-ref barrier receipt.");
  }
  const core = {
    schema: RECEIPT_SCHEMA,
    status: "cleared",
    planDigest: normalized.planDigest,
    branch: normalized.evidence.branch,
    sourceIntentDigest: normalized.evidence.sourceIntentDigest,
    sourcePlanDigest: normalized.evidence.sourceIntent.planDigest,
    sourceLeaseDigest: normalized.evidence.lease.leaseDigest,
    sourceClaimId: normalized.evidence.lease.claimId,
    disposition: normalized.disposition,
    recoveryRoute: normalized.recoveryRoute,
    authorizationDigest: digest(authorizationDigest, "authorization digest"),
    taskAuthorityReceiptDigest: digest(
      taskAuthorityReceiptDigest,
      "task-authority receipt digest",
    ),
    targetManifestDigest: normalized.evidence.targetManifest.manifestDigest,
    targetWriteSetDigest: normalized.evidence.targetManifest.writeSetDigest,
    freshExpansionPlanDigest: normalized.evidence.freshExpansionPlan.planDigest,
    dirtEvidenceDigest: normalized.evidence.dirt.evidenceDigest,
    cloudAbsenceDigest: normalized.evidence.cloud.absenceDigest,
    ledgerRefBarrierReceiptDigest: barrier.receiptDigest,
    ledgerRefBarrier: barrier,
    registryRevisionBefore: before,
    registryRevisionAfter: after,
    sourceIntentSnapshot: normalized.evidence.sourceIntent,
    planSnapshot: normalized,
    completionEffects: {
      sourceBytesChanged: false,
      indexChanged: false,
      sourceGitRefsChanged: false,
      sourceCommitCreated: false,
      sourcePushed: false,
      pullRequestChanged: false,
      coordinationLedgerBarrierObserved: true,
      coordinationCommitCreationAcknowledged: barrier.commitCreationAcknowledged,
      coordinationRefUpdateAcknowledged: barrier.refUpdateAcknowledged,
      coordinationLedgerMutationDisposition: barrier.disposition,
      coordinationLedgerPayloadChanged: false,
      registryCasApplied: true,
      claimChanged: false,
      leaseChanged: false,
      replacementIntentInstalled: false,
      merged: false,
      cleanedUp: false,
      deployed: false,
    },
  };
  const receiptDigest = digestValue(core);
  return projectActiveDirtyScopeExpansionIntentSupersessionResult({
    receipt: { ...core, receiptDigest },
    replayed: false,
  });
}

export function storedSupersessionReceipt(receipt) {
  object(receipt, "stored supersession receipt");
  const { attemptEffects: _attempt, replayed: _replayed, resultDigest: _result, ...stored }
    = receipt;
  if (stored.schema !== RECEIPT_SCHEMA || stored.status !== "cleared") {
    throw new Error("Stored intent-supersession receipt is invalid.");
  }
  const { receiptDigest, ...core } = stored;
  if (digest(receiptDigest, "stored receipt digest") !== digestValue(core)) {
    throw new Error("Stored intent-supersession receipt digest drifted.");
  }
  return deepFreeze(stored);
}

export function projectActiveDirtyScopeExpansionIntentSupersessionResult({
  receipt,
  replayed,
}) {
  if (typeof replayed !== "boolean") fail("result replay flag");
  const stored = storedSupersessionReceipt(receipt);
  const attemptEffects = replayed
    ? {
        sourceBytesChanged: false,
        indexChanged: false,
        sourceGitRefsChanged: false,
        sourceCommitCreated: false,
        sourcePushed: false,
        pullRequestChanged: false,
        coordinationLedgerBarrierObserved: false,
        coordinationCommitCreationAcknowledged: false,
        coordinationRefUpdateAcknowledged: false,
        coordinationLedgerMutationDisposition: "not-attempted-stored-replay",
        coordinationLedgerPayloadChanged: false,
        registryCasApplied: false,
        claimChanged: false,
        leaseChanged: false,
        replacementIntentInstalled: false,
        merged: false,
        cleanedUp: false,
        deployed: false,
      }
    : { ...stored.completionEffects };
  const resultCore = {
    receiptDigest: stored.receiptDigest,
    replayed,
    attemptEffects,
  };
  return deepFreeze({
    ...stored,
    attemptEffects,
    replayed,
    resultDigest: digestValue(resultCore),
  });
}

function normalizeEvidence(value) {
  object(value, "supersession evidence");
  const { evidenceDigest: suppliedDigest, ...inputCore } = value;
  const targetRepository = repository(value.repository, "repository");
  const sourceIntent = assertNoEffectScopeExpansionIntent(
    value.sourceIntent,
    { branch: value.branch },
  );
  const dirt = normalizeActiveOwnedDirtEvidence(value.dirt);
  if (dirt.untrackedPathCount !== 0) {
    throw new Error("Intent supersession rejects untracked source bytes.");
  }
  const targetManifest = normalizeDeclaredWriteScopeManifest(
    value.targetManifest,
    { expectedScope: text(value.scope, "scope") },
  );
  const controller = normalizeController(value.controller);
  const lease = normalizeLease(value.lease);
  const pullRequest = normalizePullRequest(value.pullRequest);
  const cloud = normalizeCloud(value.cloud);
  const protectedMainAdvance = normalizeProtectedMainAdvance(value.protectedMainAdvance);
  const freshExpansionPlan = normalizeActiveDirtyScopeExpansionPlan(
    value.freshExpansionPlan,
  );
  const canonicalDescendantProof = freshExpansionPlan.canonicalDescendantProof;
  if (sourceIntent.targetManifestDigest !== targetManifest.manifestDigest
    || sourceIntent.targetWriteSetDigest !== targetManifest.writeSetDigest
    || sourceIntent.sourceLeaseDigest !== lease.leaseDigest
    || sourceIntent.sourceClaimId !== lease.claimId
    || value.sourceIntentDigest !== digestValue(sourceIntent)
    || freshExpansionPlan.targetManifestDigest !== targetManifest.manifestDigest
    || freshExpansionPlan.targetWriteSetDigest !== targetManifest.writeSetDigest
    || freshExpansionPlan.sourceBranch !== value.branch
    || freshExpansionPlan.sourceFenceSha !== value.lane.headSha
    || freshExpansionPlan.sourceLeaseDigest !== lease.leaseDigest
    || freshExpansionPlan.sourceClaimId !== lease.claimId
    || freshExpansionPlan.sourceDirtyDigest !== dirt.evidenceDigest
    || freshExpansionPlan.planDigest === sourceIntent.planDigest
    || canonicalDescendantProof?.targetBaseSha !== controller.remoteMainSha
    || protectedMainAdvance.baseSha !== freshExpansionPlan.targetCanonicalBaseSha
    || protectedMainAdvance.pullRequestBaseSha !== pullRequest.baseRefOid
    || protectedMainAdvance.protectedMainSha !== controller.remoteMainSha
    || protectedMainAdvance.protectedMainTreeSha !== controller.treeSha
    || protectedMainAdvance.declaredWriteSetDigest
      !== digestValue(targetManifest.declaredWriteSet)
    || canonicalDescendantProof?.sourceBaseSha !== protectedMainAdvance.baseSha
    || sourceIntent.planSnapshot.canonicalDescendantProof?.sourceBaseSha
      !== protectedMainAdvance.baseSha
    || canonicalDescendantProof?.protectedMainSha
      !== protectedMainAdvance.protectedMainSha
    || canonicalDescendantProof?.canonicalChangedPaths.length
      !== protectedMainAdvance.changedPathCount
    || canonicalDescendantProof?.canonicalChangedPathsDigest
      !== protectedMainAdvance.changedPathsDigest
    || cloud.sourceClaimId !== lease.claimId
    || cloud.sourceClaimDigest !== sourceIntent.planSnapshot.sourceClaimDigest
    || cloud.sourceTransitionCounter
      !== sourceIntent.planSnapshot.sourceClaimTransitionCounter
    || cloud.effectiveState !== lease.disposition
    || cloud.revision !== cloud.rereadRevision
    || cloud.blobSha !== cloud.rereadBlobSha
    || cloud.rawDigest !== cloud.rereadRawDigest
    || cloud.prohibitedEntryCount !== 0
    || cloud.exactOperationAbsent !== true
    || cloud.foreignDerivativeAbsent !== true
    || pullRequest.number !== value.pullRequestNumber
    || pullRequest.headRepository !== targetRepository
    || pullRequest.headRefName !== value.branch
    || pullRequest.headRefOid !== value.lane.headSha
    || pullRequest.reviewRequestId !== lease.reviewRequestId
    || pullRequest.reviewRequestId !== sourceIntent.planSnapshot.sourceReviewRequestId
    || pullRequest.reviewRequestId !== `github-pull-request:${pullRequest.nodeId}`
    || pullRequest.url !== `https://github.com/${targetRepository}/pull/${pullRequest.number}`
    || value.lane.headSha !== sourceIntent.sourceFenceSha
    || dirt.headSha !== value.lane.headSha) {
    throw new Error("Scope-expansion intent supersession evidence does not join exactly.");
  }
  const core = {
    repository: targetRepository,
    controller,
    scope: value.scope,
    branch: text(value.branch, "branch"),
    sessionId: text(value.sessionId, "session ID"),
    pullRequestNumber: positive(value.pullRequestNumber, "pull request number"),
    lane: deepFreeze(value.lane),
    lease,
    pullRequest,
    sourceIntent,
    sourceIntentDigest: digest(value.sourceIntentDigest, "source intent digest"),
    targetManifest,
    dirt,
    protectedMainAdvance,
    freshExpansionPlan,
    cloud,
    zeroEffectPreconditions: normalizeZeroEffectPreconditions(
      value.zeroEffectPreconditions,
    ),
  };
  const expectedDigest = digestValue(core);
  if (digest(suppliedDigest, "evidence digest") !== expectedDigest
    || digestValue(inputCore) !== expectedDigest) {
    throw new Error("Scope-expansion intent supersession evidence digest drifted.");
  }
  return deepFreeze({ ...core, evidenceDigest: expectedDigest });
}

function normalizeProtectedMainAdvance(value) {
  object(value, "protected-main advance evidence");
  exactKeys(value, ["schema", "baseSha", "pullRequestBaseSha", "protectedMainSha",
    "protectedMainTreeSha", "declaredWriteSetDigest", "changedPathCount",
    "changedPathsDigest"], "protected-main advance evidence");
  if (value.schema !== "agentic-active-owned-dirt-protected-main-advance/v1") {
    fail("protected-main advance schema");
  }
  return Object.freeze({
    schema: value.schema,
    baseSha: sha(value.baseSha, "protected-main source base"),
    pullRequestBaseSha: sha(value.pullRequestBaseSha, "protected-main pull-request base"),
    protectedMainSha: sha(value.protectedMainSha, "protected-main revision"),
    protectedMainTreeSha: sha(value.protectedMainTreeSha, "protected-main tree"),
    declaredWriteSetDigest: digest(
      value.declaredWriteSetDigest,
      "protected-main declared write-set digest",
    ),
    changedPathCount: nonNegative(
      value.changedPathCount,
      "protected-main changed-path count",
    ),
    changedPathsDigest: digest(
      value.changedPathsDigest,
      "protected-main changed-path digest",
    ),
  });
}

function normalizeController(value) {
  object(value, "protected controller");
  const normalized = {
    path: text(value.path, "controller path"),
    headSha: sha(value.headSha, "controller HEAD"),
    treeSha: sha(value.treeSha, "controller tree"),
    originMainSha: sha(value.originMainSha, "controller origin/main"),
    remoteMainSha: sha(value.remoteMainSha, "controller remote main"),
    clean: value.clean === true,
    implementationDigest: digest(value.implementationDigest, "implementation digest"),
  };
  if (!normalized.clean || normalized.headSha !== normalized.originMainSha
    || normalized.headSha !== normalized.remoteMainSha) {
    throw new Error("Intent supersession requires a clean exact protected controller main.");
  }
  return Object.freeze(normalized);
}

function normalizeLease(value) {
  object(value, "source lease evidence");
  const disposition = ["current", "dormant-preserved"].includes(value.disposition)
    ? value.disposition : fail("lease disposition");
  return Object.freeze({
    leaseDigest: digest(value.leaseDigest, "lease digest"),
    claimId: digest(value.claimId, "claim ID"),
    reviewRequestId: text(value.reviewRequestId, "lease review-request ID"),
    taskAuthorityBindingDigest: digest(
      value.taskAuthorityBindingDigest,
      "task-authority binding digest",
    ),
    registryRevision: nonNegative(value.registryRevision, "registry revision"),
    registryDigest: digest(value.registryDigest, "registry digest"),
    expiresAt: instant(value.expiresAt, "lease expiry"),
    disposition,
  });
}

function normalizePullRequest(value) {
  object(value, "pull request evidence");
  if (value.state !== "OPEN" || value.isDraft !== true
    || value.autoMergeRequest !== null) {
    throw new Error("Intent supersession requires the exact open draft source pull request.");
  }
  return deepFreeze({
    number: positive(value.number, "pull request number"),
    nodeId: text(value.nodeId, "pull request node ID"),
    url: text(value.url, "pull request URL"),
    state: value.state,
    isDraft: value.isDraft,
    autoMergeRequest: null,
    headRepository: repository(value.headRepository, "pull request head repository"),
    headRefName: text(value.headRefName, "pull request branch"),
    headRefOid: sha(value.headRefOid, "pull request head"),
    baseRefName: value.baseRefName === "main" ? "main" : fail("pull request base branch"),
    baseRefOid: sha(value.baseRefOid, "pull request base"),
    reviewRequestId: text(value.reviewRequestId, "pull request review-request ID"),
    markerDigest: digest(value.markerDigest, "pull request marker digest"),
    bodyDigest: digest(value.bodyDigest, "pull request body digest"),
  });
}

function normalizeCloud(value) {
  object(value, "cloud absence evidence");
  return deepFreeze({
    ledgerRepository: repository(value.ledgerRepository, "ledger repository"),
    revision: sha(value.revision, "ledger revision"),
    treeSha: sha(value.treeSha, "ledger tree"),
    blobSha: sha(value.blobSha, "ledger blob"),
    rawDigest: digest(value.rawDigest, "raw ledger digest"),
    ledgerDigest: digest(value.ledgerDigest, "ledger head digest"),
    sequence: positive(value.sequence, "ledger sequence"),
    rereadRevision: sha(value.rereadRevision, "reread ledger revision"),
    rereadBlobSha: sha(value.rereadBlobSha, "reread ledger blob"),
    rereadRawDigest: digest(value.rereadRawDigest, "reread raw ledger digest"),
    sourceClaimId: digest(value.sourceClaimId, "cloud source claim ID"),
    sourceClaimDigest: digest(value.sourceClaimDigest, "cloud source claim digest"),
    sourceTransitionDigest: digest(
      value.sourceTransitionDigest,
      "cloud source transition digest",
    ),
    sourceTransitionCounter: positive(
      value.sourceTransitionCounter,
      "cloud source transition counter",
    ),
    sourceExpiresAt: instant(value.sourceExpiresAt, "cloud source expiry"),
    recordedState: value.recordedState === "current" ? "current" : fail("recorded claim state"),
    effectiveState: ["current", "dormant-preserved"].includes(value.effectiveState)
      ? value.effectiveState : fail("effective claim state"),
    operationKeyDigest: digest(value.operationKeyDigest, "old operation key digest"),
    exactOperationAbsent: value.exactOperationAbsent === true,
    foreignDerivativeAbsent: value.foreignDerivativeAbsent === true,
    prohibitedEntryCount: value.prohibitedEntryCount,
    absenceDigest: digest(value.absenceDigest, "cloud absence digest"),
  });
}

function normalizeZeroEffectPreconditions(value) {
  object(value, "zero-effect preconditions");
  const keys = ["intentPhaseOnly", "noCloudReceipt", "noSuccessorClaim",
    "noRetirement", "noLocalProjection", "noPullRequestProjection"];
  if (keys.some(key => value[key] !== true)) {
    throw new Error("Intent supersession zero-effect preconditions are incomplete.");
  }
  return Object.freeze(Object.fromEntries(keys.map(key => [key, true])));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
function object(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) fail(label); }
function text(value, label) { if (typeof value !== "string" || !value.trim()) fail(label); return value.trim(); }
function repository(value, label) { const result = text(value, label); if (!/^[^/\s]+\/[^/\s]+$/u.test(result)) fail(label); return result; }
function digest(value, label) { if (!DIGEST.test(String(value || ""))) fail(label); return value; }
function sha(value, label) { if (!SHA.test(String(value || ""))) fail(label); return value; }
function instant(value, label) { if (!Number.isFinite(Date.parse(value))) fail(label); return new Date(value).toISOString(); }
function positive(value, label) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) fail(label); return number; }
function nonNegative(value, label) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 0) fail(label); return number; }
function exactKeys(value, expected, label) { const actual = Object.keys(value).sort(); const sealed = [...expected].sort(); if (actual.length !== sealed.length || actual.some((entry, index) => entry !== sealed[index])) fail(`${label} fields`); }
function fail(label) { throw new Error(`Active-dirty scope-expansion intent supersession has invalid ${label}.`); }
