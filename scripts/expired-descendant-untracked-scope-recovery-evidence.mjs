// Responsibility: Seal dormant public provenance, owner decision, target additions, and raw PR bytes.
import { canonicalJson, digestValue, normalizeWriteSet, writeSetsOverlap }
  from "./cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier }
  from "./github-cloud-collaboration-mapping.mjs";
import { normalizeActiveDirtyScopeExpansionPlan }
  from "./active-dirty-scope-expansion-contract.mjs";
import {
  activeDescendantUntrackedStableIncidentDigest,
  normalizeActiveDescendantUntrackedIncident,
} from "./active-descendant-untracked-scope-recovery-evidence.mjs";

export const EVIDENCE_SCHEMA =
  "agentic-expired-descendant-untracked-scope-recovery-evidence/v2";
export const HISTORICAL_DECISION_SCHEMA =
  "agentic-active-descendant-untracked-owner-stop/v1";
const DIGEST = /^[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40}$/u;

export function buildExpiredDescendantUntrackedScopeRecoveryEvidence({
  incident, innerPlan, sourceClaim, historicalOwnerDecision, targetAdditionProof,
  pullRequestRawBodyDigest, pullRequestStructuralMarkerDigest,
  repositoryIdentity, authorityRepositoryIdentity,
} = {}) {
  const source = normalizeActiveDescendantUntrackedIncident(incident);
  const inner = normalizeActiveDirtyScopeExpansionPlan(innerPlan);
  const claim = dormantClaim(sourceClaim, source.observedAt);
  const decision = historicalDecision(historicalOwnerDecision);
  const additions = additionProof(targetAdditionProof);
  const repository = repositorySubject(repositoryIdentity, "target repository");
  const authorityRepository = repositorySubject(
    authorityRepositoryIdentity, "authority repository",
  );
  requireJoins({ source, inner, claim, decision, additions, repository,
    authorityRepository });
  const core = {
    schema: EVIDENCE_SCHEMA,
    incident: source,
    stableIncidentDigest: activeDescendantUntrackedStableIncidentDigest(source),
    innerPlan: inner,
    innerPlanDigest: inner.planDigest,
    sourceClaim: claim,
    sourceClaimObservationDigest: digestValue(claim),
    relevantClaimSetDigest: digestValue([claim]),
    historicalOwnerDecision: decision,
    historicalOwnerDecisionDigest: decision.receiptDigest,
    targetAdditionProof: additions,
    targetAdditionProofDigest: additions.proofDigest,
    pullRequestRawBodyDigest: digest(pullRequestRawBodyDigest,
      "raw pull-request body"),
    pullRequestStructuralMarkerDigest: digest(
      pullRequestStructuralMarkerDigest, "structural pull-request marker",
    ),
    repositoryIdentity: repository,
    authorityRepositoryIdentity: authorityRepository,
  };
  return deepFreeze({ ...core, evidenceDigest: digestValue(core) });
}

export function normalizeExpiredDescendantUntrackedScopeRecoveryEvidence(value) {
  if (value?.schema !== EVIDENCE_SCHEMA) invalid("evidence schema");
  const rebuilt = buildExpiredDescendantUntrackedScopeRecoveryEvidence({
    incident: value.incident,
    innerPlan: value.innerPlan,
    sourceClaim: value.sourceClaim,
    historicalOwnerDecision: value.historicalOwnerDecision,
    targetAdditionProof: value.targetAdditionProof,
    pullRequestRawBodyDigest: value.pullRequestRawBodyDigest,
    pullRequestStructuralMarkerDigest: value.pullRequestStructuralMarkerDigest,
    repositoryIdentity: value.repositoryIdentity,
    authorityRepositoryIdentity: value.authorityRepositoryIdentity,
  });
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("evidence projection");
  return rebuilt;
}

export function stableWriterMarker(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("writer marker");
  const marker = structuredClone(value);
  if (marker.cloudAuthority && typeof marker.cloudAuthority === "object") {
    delete marker.cloudAuthority.ledgerRevision;
    delete marker.cloudAuthority.ledgerDigest;
  }
  return deepFreeze(marker);
}
export function stableWriterMarkerDigest(value) {
  return digestValue(stableWriterMarker(value));
}
export function normalizeExpiredDescendantRelevantClaim(value, observedAt) {
  return dormantClaim(value, observedAt);
}

export function buildExpiredDescendantTargetAdditionProof({
  targetAdditionPaths, untrackedAdditionPaths, absentAdditionPaths,
  overlappingClaimIds = [],
} = {}) {
  const absent = paths(absentAdditionPaths, "absent additions", true);
  const core = {
    targetAdditionPaths: paths(targetAdditionPaths, "target additions"),
    untrackedAdditionPaths: paths(untrackedAdditionPaths, "untracked additions"),
    absentAdditionPaths: absent,
    absentIndexDigest: digestValue({ kind: "absent-index", paths: absent }),
    absentHeadDigest: digestValue({ kind: "absent-head", paths: absent }),
    absentWorktreeDigest: digestValue({ kind: "absent-worktree", paths: absent }),
    overlappingClaimIds: digests(overlappingClaimIds, "overlapping claims", true),
  };
  return deepFreeze({ ...core, proofDigest: digestValue(core) });
}

export function expiredDescendantRelevantClaims(claims, {
  sourceClaimId, sourceRepositoryId, sourceWorkItemId, targetDeclaredWriteSet,
} = {}) {
  if (!Array.isArray(claims)) invalid("cloud claim inventory");
  const target = normalizeWriteSet(targetDeclaredWriteSet);
  return claims.filter(claim => claim?.claimId === sourceClaimId
    || claim?.predecessorClaimId === sourceClaimId
    || (claim?.repositoryId === sourceRepositoryId
      && claim?.workItemId === sourceWorkItemId)
    || (claim?.repositoryId === sourceRepositoryId
      && writeSetsOverlap(claim?.declaredWriteScope || [], target)))
    .sort((left, right) => String(left.claimId).localeCompare(String(right.claimId)));
}

export function assertExpiredDescendantCloudTopology({
  claims, plan, intent = null, operation = "observe",
} = {}) {
  const evidence = normalizeExpiredDescendantUntrackedScopeRecoveryEvidence(plan?.evidence);
  const source = evidence.sourceClaim;
  const relevant = expiredDescendantRelevantClaims(claims, {
    sourceClaimId: source.claimId,
    sourceRepositoryId: source.repositoryId,
    sourceWorkItemId: source.workItemId,
    targetDeclaredWriteSet: evidence.incident.targetDeclaredWriteSet,
  });
  const sourceMatches = relevant.filter(item => item.claimId === source.claimId);
  const successors = relevant.filter(item => item.claimId !== source.claimId);
  if (sourceMatches.length !== 1 || successors.length > 1) invalid("relevant claim set");
  const sourceLive = sourceMatches[0];
  const phase = intent?.status || "intent";
  const sourceDormant = sourceLive.state === "dormant-preserved";
  const sourceRetired = ["retired", "released"].includes(sourceLive.state)
    && sourceLive.retirement?.reason === "superseded"
    && sourceLive.retirement?.finalRevision === evidence.incident.sourceFenceSha
    && sourceLive.retirement?.reviewRequestId === source.reviewRequestId;
  const retirementWindow = phase === "waiting-successor"
    && (operation.includes("source-retired") || operation.includes("retireSource"));
  const retirementRequired = ["source-retired", "promoted", "successor-bound",
    "local-cas"].includes(phase);
  if ((!retirementWindow && !retirementRequired && !sourceDormant)
    || (retirementWindow && !sourceDormant && !sourceRetired)
    || (retirementRequired && !sourceRetired)
    || (sourceDormant && canonicalJson(dormantClaim(sourceLive,
      evidence.incident.observedAt)) !== canonicalJson(source))) {
    invalid("phase-bound predecessor state");
  }
  const target = successors[0] || null;
  const targetMayPrecedeIntent = phase === "intent"
    && (operation.includes("claim") || operation.includes("waiting-successor"));
  if (!intent?.targetClaimId && target && !targetMayPrecedeIntent) {
    invalid("unjournaled successor");
  }
  if (intent?.targetClaimId && (!target || target.claimId !== intent.targetClaimId)) {
    invalid("journaled successor identity");
  }
  if (target) requireTargetClaim({ target, source, evidence, intent, phase, operation });
  if (sourceRetired && phase === "intent") invalid("retired-before-waiting-successor");
  if (sourceRetired && phase === "waiting-successor"
    && !operation.includes("retireSource") && !operation.includes("source-retired")) {
    invalid("retirement response without exact phase replay");
  }
  return Object.freeze({ source: sourceLive, target, relevantClaimSetDigest:
    digestValue(relevant.map(item => item.claimId)), relevantClaimIds:
    Object.freeze(relevant.map(item => item.claimId)), sourceRetired });
}

function requireTargetClaim({ target, source, evidence, intent, phase, operation }) {
  const inner = evidence.innerPlan;
  const waiting = target.state === "waiting-successor" && target.writeAuthority === false
    && target.predecessorClaimId === source.claimId && target.transitionCounter === 1;
  const current = target.state === "current" && target.writeAuthority === true
    && target.predecessorClaimId === source.claimId;
  const promoteAhead = phase === "source-retired"
    && (operation.includes("promoteSuccessor") || operation.includes(":promoted"));
  const bindAhead = phase === "promoted"
    && (operation.includes("bindSuccessor") || operation.includes(":successor-bound"));
  const expectedCurrent = ["promoted", "successor-bound", "local-cas"].includes(phase);
  const phaseStateValid = expectedCurrent ? current
    : promoteAhead ? (waiting || current) : bindAhead ? current : waiting;
  if (target.entrySchema !== source.entrySchema
    || target.claimIdentitySchema !== source.claimIdentitySchema
    || target.actorId !== source.actorId || target.deviceId !== source.deviceId
    || target.sessionId !== source.sessionId || target.repositoryId !== source.repositoryId
    || target.workItemId !== source.workItemId
    || target.scopeReserved !== (waiting ? false : true)
    || target.canonicalBaseRevision !== inner.targetCanonicalBaseSha
    || target.laneRevision !== inner.sourceFenceSha
    || target.writeSetDigest !== inner.targetWriteSetDigest
    || canonicalJson(normalizeWriteSet(target.declaredWriteScope))
      !== canonicalJson(inner.targetDeclaredWriteSet)
    || target.leaseEpoch !== inner.targetCloudLeaseEpoch
    || !phaseStateValid
    || (phase === "promoted" && !bindAhead && target.transitionCounter !== 2)
    || (["successor-bound", "local-cas"].includes(phase)
      && target.transitionCounter !== 3)
    || (["successor-bound", "local-cas"].includes(phase)
      && target.reviewRequestId !== source.reviewRequestId)
    || (bindAhead && ![2, 3].includes(target.transitionCounter))
    || (bindAhead && target.transitionCounter === 2
      && (target.reviewRequestId !== null
        || target.fenceRevision !== intent?.targetClaimDigest))
    || (bindAhead && target.transitionCounter === 3
      && target.reviewRequestId !== source.reviewRequestId)
    || (intent?.targetClaimDigest && phase === "waiting-successor"
      && target.fenceRevision !== intent.targetClaimDigest)) {
    invalid("exact successor topology");
  }
}

function dormantClaim(value, observedAt) {
  const declaredWriteScope = normalizeWriteSet(value?.declaredWriteScope);
  const result = {
    claimId: digest(value?.claimId, "source claim ID"),
    entrySchema: text(value?.entrySchema, "source entry schema"),
    claimIdentitySchema: text(value?.claimIdentitySchema, "claim identity schema"),
    state: value?.state,
    writeAuthority: value?.writeAuthority,
    scopeReserved: value?.scopeReserved,
    actorId: text(value?.actorId, "source actor"),
    deviceId: text(value?.deviceId, "source device"),
    sessionId: text(value?.sessionId, "source session"),
    repositoryId: text(value?.repositoryId, "source repository ID"),
    workItemId: text(value?.workItemId, "source work item"),
    canonicalBaseRevision: sha(value?.canonicalBaseRevision, "source claim base"),
    laneRevision: sha(value?.laneRevision, "source lane revision"),
    declaredWriteScope,
    writeSetDigest: digest(value?.writeSetDigest, "source write set"),
    leaseEpoch: positive(value?.leaseEpoch, "source lease epoch"),
    transitionCounter: positive(value?.transitionCounter, "source transition"),
    heartbeatCounter: nonnegative(value?.heartbeatCounter, "source heartbeat"),
    reviewRequestId: text(value?.reviewRequestId, "source review request"),
    predecessorClaimId: value?.predecessorClaimId === null ? null
      : digest(value?.predecessorClaimId, "source predecessor"),
    expiresAt: instant(value?.expiresAt, "source expiry"),
    fenceRevision: digest(value?.fenceRevision ?? value?.claimDigest,
      "source claim digest"),
    transitionDigest: digest(value?.transitionDigest, "source transition digest"),
    operationReceiptDigest: digest(value?.operationReceiptDigest,
      "source operation receipt"),
    integrationReceiptDigest: value?.integrationReceiptDigest === null ? null
      : digest(value?.integrationReceiptDigest, "source integration receipt"),
    integration: value?.integration === null ? null : invalid("source integration"),
    recovery: value?.recovery === null ? null : invalid("source recovery"),
  };
  if (result.entrySchema !== "agentic-cloud-collaboration-entry/v2"
    || result.claimIdentitySchema !== result.entrySchema
    || result.state !== "dormant-preserved"
    || result.writeAuthority !== false || result.scopeReserved !== true
    || result.predecessorClaimId !== null
    || result.writeSetDigest !== digestValue(declaredWriteScope)
    || Date.parse(result.expiresAt) > Date.parse(instant(observedAt, "observation"))) {
    invalid("expired dormant-preserved source claim");
  }
  return deepFreeze(result);
}

function historicalDecision(value) {
  const core = {
    schema: value?.schema,
    sourceSessionId: text(value?.sourceSessionId, "historical owner session"),
    sourceBranch: text(value?.sourceBranch, "historical owner branch"),
    sourceHeadSha: sha(value?.sourceHeadSha, "historical owner HEAD"),
    sourceFenceSha: sha(value?.sourceFenceSha, "historical owner fence"),
    untrackedPaths: paths(value?.untrackedPaths, "historical untracked paths"),
    stoppedAt: instant(value?.stoppedAt, "historical stop instant"),
  };
  const receiptDigest = digest(value?.receiptDigest, "historical owner decision");
  if (core.schema !== HISTORICAL_DECISION_SCHEMA
    || receiptDigest !== digestValue(core)) invalid("historical owner decision");
  return deepFreeze({ ...core, receiptDigest });
}

function additionProof(value) {
  const core = {
    targetAdditionPaths: paths(value?.targetAdditionPaths, "target additions"),
    untrackedAdditionPaths: paths(value?.untrackedAdditionPaths,
      "untracked additions"),
    absentAdditionPaths: paths(value?.absentAdditionPaths, "absent additions", true),
    absentIndexDigest: digest(value?.absentIndexDigest, "absent index proof"),
    absentHeadDigest: digest(value?.absentHeadDigest, "absent HEAD proof"),
    absentWorktreeDigest: digest(value?.absentWorktreeDigest,
      "absent worktree proof"),
    overlappingClaimIds: digests(value?.overlappingClaimIds,
      "overlapping claims", true),
  };
  const proofDigest = digest(value?.proofDigest, "target addition proof");
  const exact = [...core.untrackedAdditionPaths, ...core.absentAdditionPaths].sort();
  if (canonicalJson(exact) !== canonicalJson(core.targetAdditionPaths)
    || core.overlappingClaimIds.length !== 0 || proofDigest !== digestValue(core)) {
    invalid("exact clean and unclaimed target additions");
  }
  return deepFreeze({ ...core, proofDigest });
}

function repositorySubject(value, label) {
  const result = {
    nameWithOwner: text(value?.nameWithOwner, `${label} name`),
    nodeId: text(value?.nodeId, `${label} node ID`),
    actorId: text(value?.actorId, `${label} actor ID`),
  };
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(result.nameWithOwner)
    || !/^github-user:[1-9][0-9]*$/u.test(result.actorId)) invalid(label);
  return Object.freeze(result);
}

function requireJoins({ source, inner, claim, decision, additions, repository,
  authorityRepository }) {
  const sourceAdditions = source.targetDeclaredWriteSet
    .filter(item => !source.sourceDeclaredWriteSet.includes(item) && item.startsWith("path:"))
    .map(item => item.slice(5)).sort();
  if (claim.claimId !== source.sourceClaimId
    || claim.fenceRevision !== source.sourceClaimDigest
    || claim.deviceId !== pseudonymousIdentifier("device", source.sourceDevice)
    || claim.sessionId !== pseudonymousIdentifier("session", source.sourceSessionId)
    || claim.workItemId !== pseudonymousIdentifier("work-item", source.sourceScope)
    || claim.repositoryId !== `github-repository:${repository.nodeId}`
    || claim.actorId !== repository.actorId
    || claim.canonicalBaseRevision !== source.sourceBaseSha
    || claim.laneRevision !== source.sourceFenceSha
    || claim.writeSetDigest !== source.sourceWriteSetDigest
    || canonicalJson(claim.declaredWriteScope)
      !== canonicalJson(source.sourceDeclaredWriteSet)
    || claim.transitionCounter !== source.sourceTransitionCounter
    || claim.reviewRequestId !== `github-pull-request:${source.pullRequest.nodeId}`
    || decision.sourceSessionId !== source.sourceSessionId
    || decision.sourceBranch !== source.sourceBranch
    || decision.sourceHeadSha !== source.sourceHeadSha
    || decision.sourceFenceSha !== source.sourceFenceSha
    || canonicalJson(decision.untrackedPaths) !== canonicalJson(source.untrackedPaths)
    || canonicalJson(additions.targetAdditionPaths) !== canonicalJson(sourceAdditions)
    || canonicalJson(additions.untrackedAdditionPaths)
      !== canonicalJson(source.untrackedPaths)
    || inner.sourceClaimId !== claim.claimId
    || inner.sourceClaimDigest !== claim.fenceRevision
    || inner.sourceLeaseDigest !== source.sourceLeaseDigest
    || inner.targetManifestDigest !== source.targetManifestDigest
    || inner.targetWriteSetDigest !== source.targetWriteSetDigest
    || repository.nameWithOwner !== source.repository
    || authorityRepository.nameWithOwner !== source.authorityRepository
    || repository.actorId !== authorityRepository.actorId) {
    invalid("source, provenance, additions, and inner-plan joins");
  }
}

function paths(value, label, allowEmpty = false) {
  if (!Array.isArray(value)) invalid(label);
  const result = [...new Set(value.map(item => text(item, label)))].sort();
  if (result.length !== value.length || (!allowEmpty && !result.length)
    || result.some(item => item.startsWith("/") || item.includes("\\")
      || item.split("/").some(part => !part || part === "." || part === ".."))) {
    invalid(label);
  }
  return Object.freeze(result);
}
function digests(value, label, allowEmpty = false) {
  if (!Array.isArray(value)) invalid(label);
  const result = [...new Set(value.map(item => digest(item, label)))].sort();
  if (result.length !== value.length || (!allowEmpty && !result.length)) invalid(label);
  return Object.freeze(result);
}
function text(value, label) {
  if (typeof value !== "string" || !value.trim()) invalid(label);
  return value.trim();
}
function sha(value, label) {
  if (!SHA.test(String(value || ""))) invalid(label);
  return value;
}
function digest(value, label) {
  if (!DIGEST.test(String(value || ""))) invalid(label);
  return value;
}
function positive(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) invalid(label);
  return value;
}
function nonnegative(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) invalid(label);
  return value;
}
function instant(value, label) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) invalid(label);
  return value;
}
function invalid(label) {
  throw new Error(`Expired descendant/untracked recovery has invalid ${label}.`);
}
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
