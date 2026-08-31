// Responsibility: Seal one exact historical-base derivative without granting new authority.
import {
  canonicalJson,
  digestValue,
  normalizeWriteSet,
  writeSetsOverlap,
} from "./cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "./github-cloud-collaboration-mapping.mjs";

export const ACTIVE_PUBLISH_HISTORICAL_DERIVATIVE_RECOVERY_EVIDENCE_SCHEMA = "agentic-active-publish-historical-derivative-recovery-evidence/v1";

const INTENT_SCHEMA = "agentic-active-publish-successor-intent/v1";
const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;

export function buildActivePublishHistoricalDerivativeRecoveryEvidence(input = {}) {
  const core = normalizeCore(input);
  assertJoins(core);
  return deepFreeze({ ...core, evidenceDigest: digestValue(core) });
}

export function normalizeActivePublishHistoricalDerivativeRecoveryEvidence(value) {
  object(value, "recovery evidence");
  const core = normalizeCore(value);
  assertJoins(core);
  if (value.evidenceDigest !== digestValue(core)) {
    throw new Error("Historical derivative recovery evidence digest drifted.");
  }
  return deepFreeze({ ...core, evidenceDigest: value.evidenceDigest });
}

export function activePublishHistoricalDerivativeRecoveryDecisionSubject(value) {
  const evidence = value?.schema === ACTIVE_PUBLISH_HISTORICAL_DERIVATIVE_RECOVERY_EVIDENCE_SCHEMA
    ? normalizeActivePublishHistoricalDerivativeRecoveryEvidence(value)
    : buildActivePublishHistoricalDerivativeRecoveryEvidence(value);
  const { observedAt: _observedAt, evidenceDigest: _evidenceDigest, ...subject } = evidence;
  return deepFreeze({
    schema: "agentic-active-publish-historical-derivative-recovery-decision-subject/v1",
    ...subject,
  });
}

export function projectActivePublishHistoricalDerivativeCloudEvidence(value) {
  object(value, "cloud evidence");
  const competingClaimIds = uniqueDigests(value.competingClaimIds, "competing claim");
  const downstreamClaimIds = uniqueDigests(value.downstreamClaimIds, "downstream claim");
  return deepFreeze({
    ledgerRepository: repository(value.ledgerRepository, "cloud ledger repository"),
    targetRepository: repository(value.targetRepository, "cloud target repository"),
    ledgerRevision: sha(value.ledgerRevision, "cloud ledger revision"),
    ledgerDigest: digest(value.ledgerDigest, "cloud ledger digest"),
    ledgerSequence: positive(value.ledgerSequence, "cloud ledger sequence"),
    inventoryDigest: digest(value.inventoryDigest, "cloud inventory digest"),
    verificationReceiptDigest: digest(
      value.verificationReceiptDigest,
      "cloud verification receipt digest",
    ),
    authenticatedOwner: normalizeOwner(value.authenticatedOwner),
    sourceClaimMatches: exactInteger(value.sourceClaimMatches, 0, "source claim matches"),
    derivativeMatches: exactInteger(value.derivativeMatches, 1, "derivative matches"),
    competingClaimIds,
    downstreamClaimIds,
    claim: normalizeClaim(value.claim),
  });
}

export function assertActivePublishHistoricalDerivativeClaimState(value) {
  const recorded = value?.recordedState ?? "current";
  const current = value?.state === "current" && value.writeAuthority === true;
  const dormant = value?.state === "dormant-preserved" && value.writeAuthority === false;
  if ((!current && !dormant) || recorded !== "current" || value.scopeReserved !== true
    || value.integrationReceiptDigest != null || value.integration != null) {
    invalid("derivative claim state");
  }
  return value;
}

export function assertActivePublishHistoricalDerivativeStableClaim(
  current,
  source,
  allowTransition = false,
) {
  assertActivePublishHistoricalDerivativeClaimState(current);
  assertActivePublishHistoricalDerivativeClaimState(source);
  const stable = ["claimId", "actorId", "deviceId", "sessionId", "repositoryId", "workItemId",
    "entrySchema", "claimIdentitySchema", "canonicalBaseRevision", "laneRevision",
    "writeSetDigest", "leaseEpoch", "predecessorClaimId", "reviewRequestId"];
  if (stable.some(key => current?.[key] !== source?.[key])
    || canonicalJson(normalizeWriteSet(current?.declaredWriteScope))
      !== canonicalJson(normalizeWriteSet(source?.declaredWriteScope))
    || (!allowTransition && !sameTransition(current, source))) {
    invalid("stable derivative claim drift");
  }
  return current;
}

export function classifyActivePublishHistoricalDerivativeTransition(currentClaim, sealedClaim) {
  assertActivePublishHistoricalDerivativeStableClaim(currentClaim, sealedClaim, true);
  if (currentClaim.state === "dormant-preserved" && sameTransition(currentClaim, sealedClaim))
    return "recover-dormant";
  if (sealedClaim.state === "current" && currentClaim.state === "current"
    && sameTransition(currentClaim, sealedClaim)) return "adopt-current";
  if (currentClaim.state === "current"
    && currentClaim.transitionCounter === sealedClaim.transitionCounter + 1) {
    return "replay-recovery";
  }
  invalid("derivative cloud transition");
}

export function classifyActivePublishHistoricalDerivativeReviewMarker({
  sourceBodyDigest,
  targetBodyDigest,
  observedBodyDigest,
}) {
  const source = digest(sourceBodyDigest, "source review body digest");
  const target = digest(targetBodyDigest, "target review body digest");
  const observed = digest(observedBodyDigest, "observed review body digest");
  if (source === target) invalid("distinct review marker projection");
  if (observed === source) return deepFreeze({ disposition: "project-source", providerMutation: true });
  if (observed === target) return deepFreeze({ disposition: "adopt-target", providerMutation: true });
  return invalid("review marker projection state");
}

export function projectActivePublishHistoricalDerivativeConflicts(claims, claim) {
  if (!Array.isArray(claims)) invalid("cloud claim inventory");
  const others = claims.filter(item => item?.claimId !== claim.claimId);
  const competingClaimIds = others
    .filter(item => item.scopeReserved === true && Array.isArray(item.declaredWriteScope)
      && writeSetsOverlap(item.declaredWriteScope, claim.declaredWriteScope))
    .map(item => item.claimId).sort();
  const downstreamClaimIds = others
    .filter(item => item.predecessorClaimId === claim.claimId
      || (item.actorId === claim.actorId && item.repositoryId === claim.repositoryId
        && item.workItemId === claim.workItemId && item.leaseEpoch > claim.leaseEpoch))
    .map(item => item.claimId).sort();
  return deepFreeze({ competingClaimIds, downstreamClaimIds });
}

export function assertActivePublishHistoricalDerivativeRecoveryPhase(plan, recovery) {
  const { resultDigest, ...core } = recovery || {};
  assertActivePublishHistoricalDerivativeClaimState(recovery?.claim);
  const authority = recovery?.authority;
  const verification = recovery?.verification;
  const intent = plan.evidence.intent;
  if (resultDigest !== digestValue(core) || recovery.claimId !== plan.evidence.cloud.claim.claimId
    || recovery.claim?.claimId !== recovery.claimId || authority?.claimId !== recovery.claimId
    || recovery.claim.fenceRevision !== authority.claimDigest || recovery.claim.canonicalBaseRevision !== authority.canonicalBaseSha
    || recovery.claim.laneRevision !== authority.laneRevision || recovery.claim.leaseEpoch !== authority.leaseEpoch || recovery.claim.transitionCounter !== authority.transitionCounter
    || recovery.claim.writeSetDigest !== authority.writeSetDigest || recovery.claim.reviewRequestId !== authority.reviewRequestId || recovery.claim.operationReceiptDigest !== recovery.operationReceiptDigest
    || canonicalJson(recovery.claim.declaredWriteScope) !== canonicalJson(authority.cloudDeclaredWriteScope)
    || authority.canonicalBaseSha !== intent.targetCanonicalBaseSha
    || authority.laneRevision !== intent.targetHeadSha || authority.leaseEpoch !== intent.targetLeaseEpoch
    || authority.writeSetDigest !== intent.writeSetDigest
    || authority.reviewRequestId !== intent.sourceReviewRequestId
    || authority.operationReceiptDigest !== recovery.operationReceiptDigest
    || verification?.claimId !== recovery.claimId || verification.claimDigest !== authority.claimDigest
    || verification.receiptDigest !== recovery.verificationReceiptDigest) {
    throw new Error("Historical derivative recovery phase drifted before registry projection.");
  }
  return recovery;
}

export function assertActivePublishHistoricalDerivativeTaskReceipt(plan, receipt) {
  const core = { authoritySubjectId: receipt?.authoritySubjectId, bindingDigest: receipt?.bindingDigest,
    proofDigest: receipt?.proofDigest, operation: receipt?.operation, verifiedAt: receipt?.verifiedAt };
  if (receipt?.schema !== "agentic-task-authority-verification-receipt/v1" || receipt.status !== "verified"
    || receipt.bindingDigest !== plan.evidence.sourceLease.taskAuthorityBindingDigest
    || receipt.operation !== `active-publish-historical-derivative-recovery:${plan.planDigest}`
    || receipt.receiptDigest !== digestValue(core)) throw new Error("Historical derivative task-authority phase drifted before registry projection.");
  return receipt;
}

export function assertActivePublishHistoricalDerivativeRecoveryReadback(returned, observed) {
  assertActivePublishHistoricalDerivativeStableClaim(observed, returned, false);
  if (["state", "recordedState", "writeAuthority", "scopeReserved", "expiresAt", "heartbeatCounter", "integrationReceiptDigest", "integration"].some(key => canonicalJson(observed?.[key]) !== canonicalJson(returned?.[key]))) invalid("exact recovery readback");
  return observed;
}

function normalizeCore(value) {
  if (value.schema !== undefined
    && value.schema !== ACTIVE_PUBLISH_HISTORICAL_DERIVATIVE_RECOVERY_EVIDENCE_SCHEMA) {
    invalid("evidence schema");
  }
  return {
    schema: ACTIVE_PUBLISH_HISTORICAL_DERIVATIVE_RECOVERY_EVIDENCE_SCHEMA,
    observedAt: instant(value.observedAt, "observed instant"),
    controller: normalizeController(value.controller),
    canonicalAdvance: normalizeCanonicalAdvance(value.canonicalAdvance),
    lane: normalizeLane(value.lane),
    sourceLease: normalizeSourceLease(value.sourceLease),
    intent: normalizePreparedIntent(value.intent),
    review: normalizeReview(value.review),
    cloud: projectActivePublishHistoricalDerivativeCloudEvidence(value.cloud),
  };
}

function normalizeController(value) {
  object(value, "protected controller");
  return deepFreeze({
    repository: repository(value.repository, "controller repository"),
    headSha: sha(value.headSha, "controller HEAD"),
    treeSha: sha(value.treeSha, "controller tree"),
    originMainSha: sha(value.originMainSha, "controller origin/main"),
    remoteMainSha: sha(value.remoteMainSha, "controller remote main"),
    clean: exactTrue(value.clean, "controller cleanliness"),
    implementationDigest: digest(value.implementationDigest, "controller implementation digest"),
  });
}

function normalizeCanonicalAdvance(value) {
  object(value, "canonical advance");
  const mergeBases = uniqueShas(value.mergeBases, "merge base");
  const authoredPaths = uniquePaths(value.authoredPaths, "authored path");
  const protectedChangedPaths = uniquePaths(value.protectedChangedPaths, "protected changed path");
  if (value.authoredPathsDigest !== digestValue(authoredPaths)
    || value.protectedChangedPathsDigest !== digestValue(protectedChangedPaths)) {
    invalid("canonical changed-path digest");
  }
  return deepFreeze({
    historicalBaseSha: sha(value.historicalBaseSha, "historical base"),
    protectedMainSha: sha(value.protectedMainSha, "protected main"),
    mergeBases,
    protectedMainDescendant: exactTrue(
      value.protectedMainDescendant,
      "protected-main ancestry",
    ),
    authoredPaths,
    authoredPathsDigest: value.authoredPathsDigest,
    protectedChangedPaths,
    protectedChangedPathsDigest: value.protectedChangedPathsDigest,
    noWriteSetOverlap: exactTrue(value.noWriteSetOverlap, "protected path disjointness"),
  });
}

function normalizeLane(value) {
  object(value, "target lane");
  const admittedPaths = uniquePaths(value.admittedPaths, "admitted path");
  if (value.admittedPathsDigest !== digestValue(admittedPaths)) invalid("admitted paths digest");
  return deepFreeze({
    repository: repository(value.repository, "lane repository"),
    worktreePath: text(value.worktreePath, "lane worktree path"),
    branch: text(value.branch, "lane branch"),
    headSha: sha(value.headSha, "lane HEAD"),
    treeSha: sha(value.treeSha, "lane tree"),
    remoteHeadSha: sha(value.remoteHeadSha, "lane remote HEAD"),
    statusDigest: digest(value.statusDigest, "lane status digest"),
    registered: exactTrue(value.registered, "lane registration"),
    clean: exactTrue(value.clean, "lane cleanliness"),
    admittedPaths,
    admittedPathsDigest: value.admittedPathsDigest,
  });
}

function normalizeSourceLease(value) {
  object(value, "source lease evidence");
  const lease = immutableJson(value.lease, "source writer lease");
  const declaredWriteSet = Object.freeze(normalizeWriteSet(value.declaredWriteSet));
  return deepFreeze({
    lease,
    leaseDigest: digest(value.leaseDigest, "source lease digest"),
    preIntentLeaseDigest: digest(value.preIntentLeaseDigest, "pre-intent lease digest"),
    status: value.status === "active" ? "active" : invalid("source lease status"),
    admissionStatus: value.admissionStatus === "admitted"
      ? "admitted" : invalid("source admission status"),
    sessionId: text(value.sessionId, "source session"),
    device: text(value.device, "source device"),
    scope: text(value.scope, "source scope"),
    branch: text(value.branch, "source branch"),
    epoch: positive(value.epoch, "source epoch"),
    baseSha: sha(value.baseSha, "source base"),
    fenceSha: sha(value.fenceSha, "source fence"),
    pullRequestUrl: text(value.pullRequestUrl, "source review URL"),
    manifestDigest: digest(value.manifestDigest, "source manifest digest"),
    writeSetDigest: digest(value.writeSetDigest, "source write-set digest"),
    declaredWriteSet,
    taskAuthorityBindingDigest: digest(
      value.taskAuthorityBindingDigest,
      "source task-authority binding digest",
    ),
    cloudAuthorityDigest: digest(value.cloudAuthorityDigest, "source cloud-authority digest"),
    sourceClaimId: digest(value.sourceClaimId, "source claim ID"),
    sourceClaimDigest: digest(value.sourceClaimDigest, "source claim digest"),
    sourceTransitionCounter: positive(
      value.sourceTransitionCounter,
      "source transition counter",
    ),
    sourceOperationReceiptDigest: digest(
      value.sourceOperationReceiptDigest,
      "source operation receipt digest",
    ),
  });
}

function normalizePreparedIntent(value) {
  const intent = immutableJson(value, "prepared active-publish intent");
  const keys = [
    "schema", "status", "branch", "sourceLeaseDigest", "sourceStableLeaseDigest",
    "sourceClaimId", "sourceClaimDigest", "sourceClaimLedgerRevision",
    "sourceCanonicalBaseSha", "sourceLaneRevision", "sourceLeaseEpoch",
    "sourceTransitionCounter", "sourceReviewRequestId", "sourceActorId",
    "sourceRepositoryId", "sourceWorkItemId", "sourceEntrySchema",
    "sourceClaimIdentitySchema", "sourceDeviceId", "sourceSessionId",
    "targetCanonicalBaseSha", "targetHeadSha", "targetPullRequestId",
    "targetPullRequestUrl", "targetPullRequestNumber", "targetRepository",
    "targetLeaseEpoch", "admissionSchema", "semanticScope", "manifestDigest",
    "writeSetDigest", "admittedReportDigest", "createdAt", "successorClaimId",
    "successorClaimDigest", "successorVerificationReceiptDigest", "completedAt",
    "intentDigest",
  ];
  exactKeys(intent, keys, "prepared intent");
  const { intentDigest, ...core } = intent;
  if (intent.schema !== INTENT_SCHEMA || intent.status !== "prepared"
    || intent.successorClaimId !== null || intent.successorClaimDigest !== null
    || intent.successorVerificationReceiptDigest !== null || intent.completedAt !== null
    || digest(intentDigest, "intent digest") !== digestValue(core)) invalid("prepared intent");
  for (const key of ["sourceClaimId", "sourceClaimDigest", "sourceClaimLedgerRevision",
    "sourceLeaseDigest", "sourceStableLeaseDigest", "manifestDigest", "writeSetDigest",
    "admittedReportDigest"]) digest(intent[key], `intent ${key}`);
  for (const key of ["sourceCanonicalBaseSha", "sourceLaneRevision",
    "targetCanonicalBaseSha", "targetHeadSha"]) sha(intent[key], `intent ${key}`);
  for (const key of ["sourceLeaseEpoch", "sourceTransitionCounter", "targetPullRequestNumber",
    "targetLeaseEpoch"]) positive(intent[key], `intent ${key}`);
  instant(intent.createdAt, "intent creation instant");
  return intent;
}

function normalizeReview(value) {
  object(value, "provider review");
  const marker = immutableJson(value.marker, "provider writer marker");
  return deepFreeze({
    adapterId: text(value.adapterId, "review adapter ID"),
    id: text(value.id, "review ID"),
    number: positive(value.number, "review number"),
    url: text(value.url, "review URL"),
    state: value.state === "open" ? "open" : invalid("review state"),
    draft: exactTrue(value.draft, "review draft state"),
    autoDeliveryAbsent: exactTrue(value.autoDeliveryAbsent, "review auto-delivery state"),
    headRepository: repository(value.headRepository, "review head repository"),
    headBranch: text(value.headBranch, "review head branch"),
    headSha: sha(value.headSha, "review head SHA"),
    baseBranch: value.baseBranch === "main" ? "main" : invalid("review base branch"),
    baseSha: sha(value.baseSha, "review base SHA"),
    marker,
    markerDigest: digest(value.markerDigest, "review marker digest"),
    bodyDigest: digest(value.bodyDigest, "review body digest"),
    visibleBodyDigest: digest(value.visibleBodyDigest, "visible review body digest"),
  });
}

function normalizeOwner(value) {
  object(value, "authenticated owner");
  const id = positive(value.id, "authenticated owner ID");
  return deepFreeze({
    id,
    login: text(value.login, "authenticated owner login"),
    actorId: value.actorId === `github-user:${id}`
      ? value.actorId : invalid("authenticated actor ID"),
  });
}

function normalizeClaim(value) {
  object(value, "historical derivative claim");
  assertActivePublishHistoricalDerivativeClaimState(value);
  const state = value.state;
  return deepFreeze({
    claimId: digest(value.claimId, "derivative claim ID"),
    fenceRevision: digest(value.fenceRevision, "derivative fence revision"),
    transitionDigest: digest(value.transitionDigest, "derivative transition digest"),
    operationReceiptDigest: digest(
      value.operationReceiptDigest,
      "derivative operation receipt digest",
    ),
    actorId: text(value.actorId, "derivative actor ID"),
    deviceId: text(value.deviceId, "derivative device ID"),
    sessionId: text(value.sessionId, "derivative session ID"),
    repositoryId: text(value.repositoryId, "derivative repository ID"),
    workItemId: text(value.workItemId, "derivative work-item ID"),
    entrySchema: text(value.entrySchema, "derivative entry schema"),
    claimIdentitySchema: text(value.claimIdentitySchema, "derivative identity schema"),
    canonicalBaseRevision: sha(value.canonicalBaseRevision, "derivative base"),
    laneRevision: sha(value.laneRevision, "derivative lane revision"),
    declaredWriteScope: Object.freeze(normalizeWriteSet(value.declaredWriteScope)),
    writeSetDigest: digest(value.writeSetDigest, "derivative write-set digest"),
    leaseEpoch: positive(value.leaseEpoch, "derivative lease epoch"),
    transitionCounter: positive(value.transitionCounter, "derivative transition counter"),
    heartbeatCounter: nonnegative(value.heartbeatCounter, "derivative heartbeat counter"),
    predecessorClaimId: digest(value.predecessorClaimId, "derivative predecessor claim"),
    reviewRequestId: text(value.reviewRequestId, "derivative review request"),
    state,
    recordedState: "current",
    writeAuthority: value.writeAuthority,
    scopeReserved: true,
    expiresAt: instant(value.expiresAt, "derivative expiry"),
    integrationReceiptDigest: null,
    integration: null,
  });
}

function assertJoins(value) {
  const { controller, canonicalAdvance: canonical, lane, sourceLease: source,
    intent, review, cloud } = value;
  const lease = source.lease;
  const claim = cloud.claim;
  const preIntent = { ...lease };
  delete preIntent.activePublishSuccessorIntent;
  const marker = review.marker;
  const markerCloud = marker.cloudAuthority;
  const markerTask = marker.taskAuthority;
  const admitted = lane.admittedPaths;
  const authoredAdmitted = canonical.authoredPaths.every(changed => admitted.some(scope =>
    changed === scope || changed.startsWith(`${scope}/`)));
  const timeStateExact = claim.state === "current"
    ? Date.parse(value.observedAt) < Date.parse(claim.expiresAt)
    : Date.parse(value.observedAt) >= Date.parse(claim.expiresAt);
  const currentStable = stableLeaseDigest(lease);
  const markerStable = markerCloud ? stableLeaseDigest({
    ...lease,
    cloudAuthority: {
      ...lease.cloudAuthority,
      ledgerRevision: markerCloud.ledgerRevision,
      ledgerDigest: markerCloud.ledgerDigest,
    },
  }) : null;
  if (controller.headSha !== controller.originMainSha
    || controller.headSha !== controller.remoteMainSha
    || lane.repository !== controller.repository || lane.headSha !== lane.remoteHeadSha
    || review.headRepository !== lane.repository || review.headBranch !== lane.branch
    || review.headSha !== lane.headSha || review.baseSha !== intent.targetCanonicalBaseSha
    || review.url !== source.pullRequestUrl || review.number !== intent.targetPullRequestNumber
    || review.id !== intent.targetPullRequestId || review.url !== intent.targetPullRequestUrl
    || digestValue(marker) !== review.markerDigest
    || marker?.branch !== source.branch || marker?.baseSha !== source.baseSha
    || marker?.fenceSha !== source.fenceSha || markerCloud?.claimId !== source.sourceClaimId
    || markerTask?.bindingDigest !== source.taskAuthorityBindingDigest
    || digestValue(lease) !== source.leaseDigest
    || digestValue(preIntent) !== source.preIntentLeaseDigest
    || source.preIntentLeaseDigest !== intent.sourceLeaseDigest
    || ![currentStable, markerStable].includes(intent.sourceStableLeaseDigest)
    || lease.activePublishSuccessorIntent?.intentDigest !== intent.intentDigest
    || lease.status !== source.status || lease.admission?.status !== source.admissionStatus
    || lease.sessionId !== source.sessionId || lease.device !== source.device
    || lease.scope !== source.scope || lease.branch !== source.branch || lease.epoch !== source.epoch
    || lease.baseSha !== source.baseSha || lease.fenceSha !== source.fenceSha
    || lease.pullRequestUrl !== source.pullRequestUrl
    || lease.admission?.manifestDigest !== source.manifestDigest
    || lease.admission?.writeSetDigest !== source.writeSetDigest
    || lease.taskAuthority?.bindingDigest !== source.taskAuthorityBindingDigest
    || digestValue(lease.cloudAuthority) !== source.cloudAuthorityDigest
    || lease.cloudAuthority?.claimId !== source.sourceClaimId
    || lease.cloudAuthority?.claimDigest !== source.sourceClaimDigest
    || lease.cloudAuthority?.transitionCounter !== source.sourceTransitionCounter
    || lease.cloudAuthority?.operationReceiptDigest !== source.sourceOperationReceiptDigest
    || canonical.historicalBaseSha !== intent.targetCanonicalBaseSha
    || canonical.protectedMainSha !== controller.headSha
    || canonical.mergeBases.length !== 1
    || canonical.mergeBases[0] !== canonical.historicalBaseSha
    || !authoredAdmitted
    || writeSetsOverlap(
      canonical.protectedChangedPaths.map(item => `path:${item}`),
      source.declaredWriteSet,
    )
    || canonicalJson(source.declaredWriteSet)
      !== canonicalJson(normalizeWriteSet(lease.admission?.declaredWriteSet))
    || source.writeSetDigest !== digestValue(source.declaredWriteSet)
    || intent.branch !== source.branch || intent.sourceClaimId !== source.sourceClaimId
    || intent.sourceClaimDigest !== source.sourceClaimDigest
    || intent.sourceCanonicalBaseSha !== source.baseSha
    || intent.sourceLaneRevision !== source.fenceSha
    || intent.sourceLeaseEpoch !== lease.cloudAuthority?.leaseEpoch
    || intent.sourceTransitionCounter !== source.sourceTransitionCounter
    || intent.sourceReviewRequestId !== lease.cloudAuthority?.reviewRequestId
    || intent.sourceDeviceId !== source.device || intent.sourceSessionId !== source.sessionId
    || intent.targetHeadSha !== lane.headSha || intent.targetLeaseEpoch !== claim.leaseEpoch
    || intent.targetRepository !== cloud.targetRepository
    || intent.admissionSchema !== lease.admission?.schema
    || intent.semanticScope !== source.scope || intent.manifestDigest !== source.manifestDigest
    || intent.writeSetDigest !== source.writeSetDigest
    || intent.admittedReportDigest !== lease.admission?.admittedReportDigest
    || cloud.authenticatedOwner.actorId !== intent.sourceActorId
    || claim.actorId !== intent.sourceActorId
    || claim.deviceId !== cloudOwner("device", intent.sourceDeviceId)
    || claim.sessionId !== cloudOwner("session", intent.sourceSessionId)
    || claim.repositoryId !== intent.sourceRepositoryId
    || claim.workItemId !== intent.sourceWorkItemId
    || claim.entrySchema !== intent.sourceEntrySchema
    || claim.claimIdentitySchema !== intent.sourceClaimIdentitySchema
    || claim.canonicalBaseRevision !== intent.targetCanonicalBaseSha
    || claim.laneRevision !== intent.targetHeadSha
    || claim.predecessorClaimId !== intent.sourceClaimId
    || claim.reviewRequestId !== intent.sourceReviewRequestId
    || claim.writeSetDigest !== intent.writeSetDigest
    || canonicalJson(claim.declaredWriteScope) !== canonicalJson(source.declaredWriteSet)
    || claim.expiresAt <= intent.createdAt
    || !timeStateExact
    || cloud.sourceClaimMatches !== 0 || cloud.derivativeMatches !== 1
    || cloud.competingClaimIds.length !== 0 || cloud.downstreamClaimIds.length !== 0) {
    throw new Error("Historical derivative recovery evidence changed its exact admitted subject.");
  }
}

function sameTransition(left, right) {
  return left.claimId === right.claimId && left.fenceRevision === right.fenceRevision
    && left.transitionDigest === right.transitionDigest
    && left.operationReceiptDigest === right.operationReceiptDigest
    && left.transitionCounter === right.transitionCounter;
}

function stableLeaseDigest(lease) {
  const { activePublishSuccessorIntent: _intent, heartbeatAt: _heartbeat,
    expiresAt: _expiry, status: _status, ...rest } = lease;
  const cloudAuthority = { ...(rest.cloudAuthority || {}) };
  delete cloudAuthority.ledgerRevision;
  delete cloudAuthority.ledgerDigest;
  return digestValue({ ...rest, cloudAuthority, status: "active" });
}

function cloudOwner(namespace, value) {
  const prefix = `${namespace}:`;
  return String(value).startsWith(prefix) && DIGEST.test(String(value).slice(prefix.length))
    ? value : pseudonymousIdentifier(namespace, value);
}

function uniquePaths(value, label) {
  if (!Array.isArray(value)) invalid(label);
  const result = [...value].map((item, index) => text(item, `${label} ${index}`)).sort();
  if (new Set(result).size !== result.length) invalid(label);
  return Object.freeze(result);
}
function uniqueDigests(value, label) {
  if (!Array.isArray(value)) invalid(label);
  const result = [...value].map((item, index) => digest(item, `${label} ${index}`)).sort();
  if (new Set(result).size !== result.length) invalid(label);
  return Object.freeze(result);
}
function uniqueShas(value, label) {
  if (!Array.isArray(value)) invalid(label);
  const result = [...value].map((item, index) => sha(item, `${label} ${index}`)).sort();
  if (new Set(result).size !== result.length) invalid(label);
  return Object.freeze(result);
}
function immutableJson(value, label) {
  object(value, label);
  try { return deepFreeze(JSON.parse(canonicalJson(value))); } catch { return invalid(label); }
}
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  return value;
}
function exactKeys(value, keys, label) {
  object(value, label);
  if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) invalid(label);
}
function repository(value, label) {
  const result = text(value, label);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(result)) invalid(label);
  return result;
}
function text(value, label) {
  if (typeof value !== "string" || !value.trim()) invalid(label);
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
function positive(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) invalid(label);
  return value;
}
function nonnegative(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) invalid(label);
  return value;
}
function exactInteger(value, expected, label) {
  if (value !== expected) invalid(label);
  return value;
}
function instant(value, label) {
  if (!value || new Date(value).toISOString() !== value) invalid(label);
  return value;
}
function exactTrue(value, label) {
  if (value !== true) invalid(label);
  return true;
}
function invalid(label) {
  throw new Error(`Active-publish historical derivative recovery has invalid ${label}.`);
}
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
