// Responsibility: Seal the exact clean admitted successor that may be recovered from dormancy.
import {
  canonicalJson,
  digestValue,
  normalizeWriteSet,
  writeSetsOverlap,
} from "./cloud-collaboration-primitives.mjs";

export const ACTIVE_PUBLISH_SUCCESSOR_DORMANT_RECOVERY_EVIDENCE_SCHEMA =
  "agentic-active-publish-successor-dormant-recovery-evidence/v1";

const SUCCESSOR_RECEIPT_SCHEMA =
  "agentic-active-publish-task-authority-successor-reconciliation-receipt/v1";
const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;

export function buildActivePublishSuccessorDormantRecoveryEvidence(input = {}) {
  const core = normalizeCore(input);
  assertJoins(core);
  return deepFreeze({ ...core, evidenceDigest: digestValue(core) });
}

export function normalizeActivePublishSuccessorDormantRecoveryEvidence(value) {
  object(value, "recovery evidence");
  const core = normalizeCore(value);
  assertJoins(core);
  if (value.evidenceDigest !== digestValue(core)) {
    throw new Error("Active-publish successor dormant recovery evidence digest drifted.");
  }
  return deepFreeze({ ...core, evidenceDigest: value.evidenceDigest });
}

export function activePublishSuccessorDormantRecoveryDecisionSubject(value) {
  const evidence = value?.schema === ACTIVE_PUBLISH_SUCCESSOR_DORMANT_RECOVERY_EVIDENCE_SCHEMA
    ? normalizeActivePublishSuccessorDormantRecoveryEvidence(value)
    : buildActivePublishSuccessorDormantRecoveryEvidence(value);
  return deepFreeze({
    schema: "agentic-active-publish-successor-dormant-recovery-decision-subject/v1",
    controller: evidence.controller,
    canonicalAdvance: evidence.canonicalAdvance,
    lane: evidence.lane,
    lease: evidence.lease,
    review: evidence.review,
    successorReceipt: evidence.successorReceipt,
    cloud: evidence.cloud,
  });
}

export function projectActivePublishSuccessorDormantCloudEvidence(value, options = {}) {
  object(value, "cloud evidence");
  const claim = normalizeClaim(value.claim, options.requiredState ?? "dormant-preserved");
  const overlapProof = normalizeOverlapProof(value.overlapProof, claim);
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
    claim,
    overlapProof,
  });
}

function normalizeCore(value) {
  if (value.schema !== undefined
    && value.schema !== ACTIVE_PUBLISH_SUCCESSOR_DORMANT_RECOVERY_EVIDENCE_SCHEMA) {
    throw new Error("Unsupported active-publish successor dormant recovery evidence.");
  }
  return {
    schema: ACTIVE_PUBLISH_SUCCESSOR_DORMANT_RECOVERY_EVIDENCE_SCHEMA,
    observedAt: instant(value.observedAt, "observed instant"),
    controller: normalizeController(value.controller),
    canonicalAdvance: normalizeCanonicalAdvance(value.canonicalAdvance),
    lane: normalizeLane(value.lane),
    lease: normalizeLease(value.lease),
    review: normalizeReview(value.review),
    successorReceipt: normalizeSuccessorReceipt(value.successorReceipt),
    cloud: projectActivePublishSuccessorDormantCloudEvidence(value.cloud),
  };
}

function normalizeCanonicalAdvance(value) {
  object(value, "protected refresh chain");
  const refreshes = array(value.refreshes, "protected refresh chain")
    .map((item, index) => normalizeRefreshStep(item, index));
  const changedPaths = array(value.changedPaths, "protected changed paths")
    .map((item, index) => text(item, `protected changed path ${index}`)).sort();
  if (refreshes.length < 1 || new Set(changedPaths).size !== changedPaths.length
    || value.changedPathsDigest !== digestValue(changedPaths)
    || value.noWriteSetOverlap !== true || value.protectedMainDescendant !== true) {
    throw new Error("Protected refresh chain is not exact and disjoint.");
  }
  for (let index = 1; index < refreshes.length; index += 1) {
    if (refreshes[index].previousHeadSha !== refreshes[index - 1].refreshedHeadSha) {
      throw new Error("Protected refresh steps do not form one exact chain.");
    }
  }
  const refreshCore = refreshes.length === 1 ? {
    schema: "agentic-protected-main-refresh/v1",
    deliveredHeadSha: value.deliveredHeadSha,
    refreshedHeadSha: value.refreshedFenceSha,
    mainParentSha: refreshes[0].mainParentSha,
  } : {
    schema: "agentic-protected-main-refresh-chain/v1",
    deliveredHeadSha: value.deliveredHeadSha,
    refreshedHeadSha: value.refreshedFenceSha,
    refreshCount: refreshes.length,
    refreshes,
  };
  if (value.protectedRefreshReceiptDigest !== digestValue(refreshCore)) {
    throw new Error("Protected refresh receipt digest drifted.");
  }
  return deepFreeze({
    protectedBaseSha: sha(value.protectedBaseSha, "refresh protected base"),
    deliveredHeadSha: sha(value.deliveredHeadSha, "delivered head"),
    refreshedFenceSha: sha(value.refreshedFenceSha, "refreshed fence"),
    protectedMainSha: sha(value.protectedMainSha, "refresh protected main"),
    refreshes: Object.freeze(refreshes),
    protectedRefreshReceiptDigest: value.protectedRefreshReceiptDigest,
    protectedMainDescendant: true,
    changedPaths: Object.freeze(changedPaths),
    changedPathsDigest: value.changedPathsDigest,
    noWriteSetOverlap: true,
  });
}

function normalizeRefreshStep(value, index) {
  object(value, `protected refresh step ${index}`);
  return deepFreeze({
    previousHeadSha: sha(value.previousHeadSha, `refresh step ${index} previous head`),
    refreshedHeadSha: sha(value.refreshedHeadSha, `refresh step ${index} refreshed head`),
    mainParentSha: sha(value.mainParentSha, `refresh step ${index} main parent`),
  });
}

function normalizeController(value) {
  object(value, "protected controller");
  return deepFreeze({
    repository: repository(value.repository, "controller repository"),
    headSha: sha(value.headSha, "controller HEAD"),
    treeSha: sha(value.treeSha, "controller tree"),
    originMainSha: sha(value.originMainSha, "controller origin/main"),
    remoteMainSha: sha(value.remoteMainSha, "controller remote main"),
    clean: value.clean === true,
    implementationDigest: digest(value.implementationDigest, "controller implementation digest"),
  });
}

function normalizeLane(value) {
  object(value, "successor lane");
  return deepFreeze({
    repository: repository(value.repository, "lane repository"),
    worktreePath: text(value.worktreePath, "lane worktree path"),
    branch: text(value.branch, "lane branch"),
    headSha: sha(value.headSha, "lane HEAD"),
    treeSha: sha(value.treeSha, "lane tree"),
    remoteHeadSha: sha(value.remoteHeadSha, "lane remote HEAD"),
    statusDigest: digest(value.statusDigest, "lane status digest"),
    registered: value.registered === true,
    clean: value.clean === true,
  });
}

function normalizeLease(value) {
  object(value, "successor lease");
  const declaredWriteSet = Object.freeze(normalizeWriteSet(value.declaredWriteSet));
  const sourceLease = immutableJson(value.sourceLease, "source writer lease");
  return deepFreeze({
    sourceLease,
    leaseDigest: digest(value.leaseDigest, "lease digest"),
    status: value.status === "active" ? "active" : invalid("lease status"),
    admissionStatus: value.admissionStatus === "admitted"
      ? "admitted" : invalid("lease admission status"),
    sessionId: text(value.sessionId, "lease session"),
    device: text(value.device, "lease device"),
    scope: text(value.scope, "lease scope"),
    branch: text(value.branch, "lease branch"),
    epoch: positive(value.epoch, "lease epoch"),
    baseSha: sha(value.baseSha, "lease base"),
    fenceSha: sha(value.fenceSha, "lease fence"),
    integrationCommitSha: sha(value.integrationCommitSha, "lease integration commit"),
    pullRequestUrl: text(value.pullRequestUrl, "lease review URL"),
    manifestDigest: digest(value.manifestDigest, "lease manifest digest"),
    writeSetDigest: digest(value.writeSetDigest, "lease write-set digest"),
    declaredWriteSet,
    taskAuthorityBindingDigest: digest(
      value.taskAuthorityBindingDigest,
      "lease task-authority binding digest",
    ),
    cloudAuthorityDigest: digest(value.cloudAuthorityDigest, "lease cloud-authority digest"),
    cloudClaimId: digest(value.cloudClaimId, "lease cloud claim ID"),
    cloudClaimDigest: digest(value.cloudClaimDigest, "lease cloud claim digest"),
    cloudTransitionCounter: positive(
      value.cloudTransitionCounter,
      "lease cloud transition counter",
    ),
    cloudOperationReceiptDigest: digest(
      value.cloudOperationReceiptDigest,
      "lease cloud operation receipt digest",
    ),
    activePublishTaskAuthoritySuccessor: normalizeActivePublishSuccessor(
      value.activePublishTaskAuthoritySuccessor,
    ),
  });
}

function normalizeReview(value) {
  object(value, "provider review");
  return deepFreeze({
    adapterId: text(value.adapterId, "review adapter ID"),
    id: text(value.id, "review ID"),
    url: text(value.url, "review URL"),
    state: value.state === "open" ? "open" : invalid("review state"),
    draft: value.draft === true,
    autoDeliveryAbsent: value.autoDeliveryAbsent === true,
    headRepository: repository(value.headRepository, "review head repository"),
    headBranch: text(value.headBranch, "review head branch"),
    headSha: sha(value.headSha, "review head SHA"),
    baseBranch: text(value.baseBranch, "review base branch"),
    baseSha: sha(value.baseSha, "review base SHA"),
    markerDigest: digest(value.markerDigest, "review marker digest"),
    bodyDigest: digest(value.bodyDigest, "review body digest"),
    visibleBodyDigest: digest(value.visibleBodyDigest, "review visible body digest"),
  });
}

function normalizeActivePublishSuccessor(value) {
  object(value, "active-publish task-authority successor receipt");
  const core = {
    schema: value.schema,
    branch: text(value.branch, "successor branch"),
    epoch: positive(value.epoch, "successor epoch"),
    sourceBaseSha: sha(value.sourceBaseSha, "successor source base"),
    sourceFenceSha: sha(value.sourceFenceSha, "successor source fence"),
    sourceClaimId: digest(value.sourceClaimId, "successor source claim"),
    sourceBindingDigest: digest(value.sourceBindingDigest, "successor source binding"),
    targetBaseSha: sha(value.targetBaseSha, "successor target base"),
    targetFenceSha: sha(value.targetFenceSha, "successor target fence"),
    targetClaimId: digest(value.targetClaimId, "successor target claim"),
    targetBindingDigest: digest(value.targetBindingDigest, "successor target binding"),
    cloudOperationReceiptDigest: digest(
      value.cloudOperationReceiptDigest,
      "successor cloud operation receipt",
    ),
    cloudVerificationReceiptDigest: digest(
      value.cloudVerificationReceiptDigest,
      "successor cloud verification receipt",
    ),
    boundAt: instant(value.boundAt, "successor bound instant"),
  };
  if (core.schema !== "agentic-active-publish-task-authority-successor-receipt/v1"
    || value.receiptDigest !== digestValue(core)) {
    throw new Error("Active-publish successor lineage receipt is invalid.");
  }
  return deepFreeze({ ...core, receiptDigest: value.receiptDigest });
}

function normalizeSuccessorReceipt(value) {
  object(value, "successor reconciliation receipt");
  const core = {
    schema: value.schema,
    planDigest: digest(value.planDigest, "successor plan digest"),
    sourceBindingDigest: digest(value.sourceBindingDigest, "source binding digest"),
    targetBindingDigest: digest(value.targetBindingDigest, "target binding digest"),
    successorReceiptDigest: digest(value.successorReceiptDigest, "successor receipt digest"),
    taskAuthorityReceiptDigest: digest(
      value.taskAuthorityReceiptDigest,
      "task-authority receipt digest",
    ),
    targetLeaseDigest: digest(value.targetLeaseDigest, "target lease digest"),
    registryRevision: positive(value.registryRevision, "registry revision"),
    verifiedAt: instant(value.verifiedAt, "successor verification instant"),
    mutationSet: Array.isArray(value.mutationSet) ? Object.freeze([...value.mutationSet]) : [],
    cloudMutation: value.cloudMutation,
    providerMutation: value.providerMutation,
    gitMutation: value.gitMutation,
    sourceMutation: value.sourceMutation,
    authoringAuthorityGranted: value.authoringAuthorityGranted,
  };
  if (core.schema !== SUCCESSOR_RECEIPT_SCHEMA
    || canonicalJson(core.mutationSet) !== canonicalJson([
      "writer-lease-task-authority-continuation",
    ])
    || [core.cloudMutation, core.providerMutation, core.gitMutation,
      core.sourceMutation, core.authoringAuthorityGranted].some(Boolean)
    || value.receiptDigest !== digestValue(core)) {
    throw new Error("PR500 successor reconciliation receipt is not exact-terminal.");
  }
  return deepFreeze({ ...core, receiptDigest: value.receiptDigest });
}

function normalizeClaim(value, requiredState) {
  object(value, "dormant successor claim");
  const declaredWriteSet = Object.freeze(normalizeWriteSet(value.declaredWriteScope));
  const claim = {
    claimId: digest(value.claimId, "claim ID"),
    fenceRevision: digest(value.fenceRevision, "claim fence revision"),
    transitionDigest: digest(value.transitionDigest, "claim transition digest"),
    operationReceiptDigest: digest(value.operationReceiptDigest, "claim operation receipt"),
    actorId: text(value.actorId, "claim actor ID"),
    deviceId: text(value.deviceId, "claim device ID"),
    sessionId: text(value.sessionId, "claim session ID"),
    repositoryId: text(value.repositoryId, "claim repository ID"),
    workItemId: text(value.workItemId, "claim work-item ID"),
    canonicalBaseRevision: sha(value.canonicalBaseRevision, "claim canonical base"),
    laneRevision: sha(value.laneRevision, "claim lane revision"),
    declaredWriteScope: declaredWriteSet,
    writeSetDigest: digest(value.writeSetDigest, "claim write-set digest"),
    leaseEpoch: positive(value.leaseEpoch, "claim lease epoch"),
    transitionCounter: positive(value.transitionCounter, "claim transition counter"),
    heartbeatCounter: nonnegative(value.heartbeatCounter, "claim heartbeat counter"),
    predecessorClaimId: optionalDigest(value.predecessorClaimId, "predecessor claim ID"),
    reviewRequestId: text(value.reviewRequestId, "claim review request ID"),
    state: value.state,
    recordedState: value.recordedState,
    writeAuthority: value.writeAuthority,
    scopeReserved: value.scopeReserved,
    expiresAt: instant(value.expiresAt, "claim expiry"),
  };
  const dormant = requiredState === "dormant-preserved"
    && claim.state === "dormant-preserved" && claim.writeAuthority === false;
  const recovered = requiredState === "current"
    && claim.state === "current" && claim.writeAuthority === true;
  if (claim.writeSetDigest !== digestValue(declaredWriteSet)
    || claim.recordedState !== "current"
    || (!dormant && !recovered) || claim.scopeReserved !== true) {
    throw new Error("Recovery cloud claim is not in its required exact state.");
  }
  return deepFreeze(claim);
}

function normalizeOverlapProof(value, claim) {
  object(value, "overlap proof");
  const competingClaimIds = Array.isArray(value.competingClaimIds)
    ? [...value.competingClaimIds].map((item, index) => digest(item, `competitor ${index}`)).sort()
    : invalid("overlap competitors");
  if (new Set(competingClaimIds).size !== competingClaimIds.length
    || competingClaimIds.length !== 0 || value.noOverlappingCompetitor !== true
    || value.subjectClaimId !== claim.claimId
    || value.subjectWriteSetDigest !== claim.writeSetDigest) {
    throw new Error("Dormant successor write authority is not disjoint.");
  }
  const core = {
    subjectClaimId: claim.claimId,
    subjectWriteSetDigest: claim.writeSetDigest,
    competingClaimIds: Object.freeze(competingClaimIds),
    noOverlappingCompetitor: true,
  };
  if (value.overlapProofDigest !== digestValue(core)) invalid("overlap proof digest");
  return deepFreeze({ ...core, overlapProofDigest: value.overlapProofDigest });
}

function assertJoins(value) {
  const { controller, canonicalAdvance, lane, lease, review, successorReceipt, cloud } = value;
  const successor = lease.activePublishTaskAuthoritySuccessor;
  if (digestValue(lease.sourceLease) !== lease.leaseDigest
    || lease.sourceLease.activePublishTaskAuthoritySuccessor?.receiptDigest
      !== successor.receiptDigest
    || !controller.clean || controller.headSha !== controller.originMainSha
    || controller.headSha !== controller.remoteMainSha
    || canonicalAdvance.protectedBaseSha !== successor.targetBaseSha
    || canonicalAdvance.deliveredHeadSha !== lease.integrationCommitSha
    || canonicalAdvance.refreshedFenceSha !== lease.fenceSha
    || canonicalAdvance.protectedMainSha !== controller.headSha
    || canonicalAdvance.refreshes[0].previousHeadSha !== canonicalAdvance.deliveredHeadSha
    || canonicalAdvance.refreshes.at(-1).refreshedHeadSha !== canonicalAdvance.refreshedFenceSha
    || canonicalAdvance.refreshes.at(-1).mainParentSha !== canonicalAdvance.protectedBaseSha
    || canonicalAdvance.changedPaths.some(changed =>
      writeSetsOverlap(lease.declaredWriteSet, [`path:${changed}`]))
    || !lane.registered || !lane.clean || lane.headSha !== lane.remoteHeadSha
    || lane.repository !== controller.repository || lane.branch !== lease.branch
    || lane.headSha !== lease.fenceSha || lease.baseSha !== review.baseSha
    || review.url !== lease.pullRequestUrl || !review.draft || !review.autoDeliveryAbsent
    || review.headRepository !== lane.repository || review.headBranch !== lane.branch
    || review.headSha !== lane.headSha || review.baseBranch !== "main"
    || successorReceipt.targetLeaseDigest !== lease.leaseDigest
    || successorReceipt.targetBindingDigest !== lease.taskAuthorityBindingDigest
    || successorReceipt.successorReceiptDigest !== successor.receiptDigest
    || successorReceipt.sourceBindingDigest !== successor.sourceBindingDigest
    || successor.branch !== lease.branch || successor.epoch !== lease.epoch
    || successor.targetBaseSha !== lease.baseSha || successor.targetFenceSha !== lease.fenceSha
    || successor.targetClaimId !== lease.cloudClaimId
    || successor.sourceClaimId !== cloud.claim.predecessorClaimId
    || successor.targetBindingDigest !== lease.taskAuthorityBindingDigest
    || successor.cloudOperationReceiptDigest !== lease.cloudOperationReceiptDigest
    || cloud.claim.claimId !== lease.cloudClaimId
    || cloud.claim.fenceRevision !== lease.cloudClaimDigest
    || cloud.claim.transitionCounter !== lease.cloudTransitionCounter
    || cloud.claim.operationReceiptDigest !== lease.cloudOperationReceiptDigest
    || cloud.claim.canonicalBaseRevision !== lease.baseSha
    || cloud.claim.laneRevision !== lease.fenceSha
    || cloud.claim.leaseEpoch !== lease.epoch
    || cloud.claim.writeSetDigest !== lease.writeSetDigest
    || canonicalJson(cloud.claim.declaredWriteScope) !== canonicalJson(lease.declaredWriteSet)) {
    throw new Error("Active-publish successor recovery evidence changed its exact admitted fence.");
  }
  if (Date.parse(value.observedAt) < Date.parse(cloud.claim.expiresAt)) {
    throw new Error("Dormant recovery refuses an unexpired claim and ordinary renewal.");
  }
  if (cloud.overlapProof.noOverlappingCompetitor !== true) {
    throw new Error("Active-publish successor overlap proof is invalid.");
  }
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  return value;
}
function array(value, label) {
  if (!Array.isArray(value)) invalid(label);
  return [...value];
}
function immutableJson(value, label) {
  object(value, label);
  try { return deepFreeze(JSON.parse(canonicalJson(value))); }
  catch { return invalid(label); }
}
function text(value, label) {
  if (typeof value !== "string" || !value.trim()) invalid(label);
  return value;
}
function repository(value, label) {
  const result = text(value, label);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(result)) invalid(label);
  return result;
}
function sha(value, label) {
  if (!SHA.test(String(value || ""))) invalid(label);
  return value;
}
function digest(value, label) {
  if (!DIGEST.test(String(value || ""))) invalid(label);
  return value;
}
function optionalDigest(value, label) { return value == null ? null : digest(value, label); }
function positive(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) invalid(label);
  return value;
}
function nonnegative(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) invalid(label);
  return value;
}
function instant(value, label) {
  if (!value || new Date(value).toISOString() !== value) invalid(label);
  return value;
}
function invalid(label) { throw new Error(`Active-publish successor recovery has invalid ${label}.`); }
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
