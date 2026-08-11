// Responsibility: Bind exact expired active-dirty lane evidence to replay-safe recovery phases.
import path from "node:path";

import { canonicalJson, digestValue, normalizeWriteSet, writeSetsOverlap } from "./cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "./github-cloud-collaboration-mapping.mjs";
import { writerLeaseDigest } from "./writer-lease-registry-cas.mjs";

export const EXPIRED_ACTIVE_DIRTY_SCOPE_EXPANSION_RECOVERY_SOURCE_EVIDENCE_SCHEMA =
  "agentic-expired-active-dirty-scope-expansion-recovery-source-evidence/v1";
export const EXPIRED_ACTIVE_DIRTY_SCOPE_EXPANSION_RECOVERY_PHASE_OBSERVATION_SCHEMA =
  "agentic-expired-active-dirty-scope-expansion-recovery-phase-observation/v1";

const OPERATION_KEY_SCHEMA = "agentic-expired-active-dirty-scope-expansion-recovery-operation-key/v1";
const PHASE_EVIDENCE_SCHEMA = "agentic-expired-active-dirty-scope-expansion-recovery-phase-evidence/v1";
const PHASES = Object.freeze(["cloud-recovered", "local-rebound", "pr-projected", "complete"]);
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const SOURCE_FIELDS = Object.freeze("schema controller lane lease leaseDigest cloud pullRequest dirt scopeExpansionIntent sourceEvidenceDigest".split(" "));
const PEER_RECORD_FIELDS = Object.freeze(("claimId claimDigest entrySchema claimIdentitySchema state recordedState writeAuthority scopeReserved actorId deviceId sessionId repositoryId workItemId canonicalBaseRevision laneRevision declaredWriteScope writeSetDigest leaseEpoch transitionCounter heartbeatCounter evidenceDigest reviewRequestId predecessorClaimId eligibleSince handoff release expiresAt fenceRevision ledgerRevision ledgerSequence transitionDigest operationReceiptDigest integrationReceiptDigest recovery integration handoffEvidenceDigest promotedAt deliveryAuthorization retirement").split(" "));
export function buildExpiredActiveDirtyScopeExpansionRecoverySourceEvidence(input) {
  const source = normalizeSourceInput(input);
  assertSourceJoins(source);
  const core = { schema: EXPIRED_ACTIVE_DIRTY_SCOPE_EXPANSION_RECOVERY_SOURCE_EVIDENCE_SCHEMA, ...source };
  return deepFreeze({ ...core, sourceEvidenceDigest: digestValue(core) });
}
export function normalizeExpiredActiveDirtyScopeExpansionRecoverySourceEvidence(value) {
  object(value, "Recovery source evidence");
  exactFields(value, SOURCE_FIELDS, "Recovery source evidence");
  if (value.schema !== EXPIRED_ACTIVE_DIRTY_SCOPE_EXPANSION_RECOVERY_SOURCE_EVIDENCE_SCHEMA) {
    throw new Error("Unsupported expired active-dirty recovery source evidence.");
  }
  const normalized = buildExpiredActiveDirtyScopeExpansionRecoverySourceEvidence(value);
  if (value.sourceEvidenceDigest !== normalized.sourceEvidenceDigest) {
    throw new Error("Expired active-dirty recovery source evidence digest drifted.");
  }
  return normalized;
}
export function assertExpiredActiveDirtyScopeExpansionRecoverySourceEvidence(value) {
  return normalizeExpiredActiveDirtyScopeExpansionRecoverySourceEvidence(value);
}
export function buildExpiredActiveDirtyScopeExpansionRecoveryPhaseObservation({ plan, intent, phase, operationKey, live } = {}) {
  const context = phaseContext({ plan, intent, phase, operationKey });
  const projected = normalizeLive(live);
  const state = phaseState(context, projected);
  if (state === "pending") return Object.freeze({ state });
  const phaseProjection = projectPhaseLive(context.phase, projected);
  const liveStateDigest = digestValue(phaseProjection);
  const evidenceDigest = digestValue({ schema: PHASE_EVIDENCE_SCHEMA,
    planDigest: context.planDigest, phase: context.phase,
    operationKey: context.operationKey, liveStateDigest });
  const core = {
    schema: EXPIRED_ACTIVE_DIRTY_SCOPE_EXPANSION_RECOVERY_PHASE_OBSERVATION_SCHEMA,
    state: "complete", phase: context.phase, planDigest: context.planDigest,
    operationKey: context.operationKey,
    sourceEvidenceDigest: context.source.sourceEvidenceDigest,
    values: phaseValues({ context, evidenceDigest, live: projected, liveStateDigest }),
  };
  return deepFreeze({ ...core, observationDigest: digestValue(core) });
}
export function normalizeExpiredActiveDirtyScopeExpansionRecoveryPhaseObservation(
  value,
  { planDigest, phase, operationKey } = {},
) {
  object(value, "Recovery phase observation");
  exactFields(value, "schema state phase planDigest operationKey sourceEvidenceDigest values observationDigest".split(" "), "Recovery phase observation");
  const normalizedPhase = requiredPhase(phase);
  const normalizedPlanDigest = digest(planDigest, "observation plan digest");
  const normalizedOperationKey = digest(operationKey, "observation operation key");
  const values = normalizePhaseValues(value.values);
  const core = {
    schema: value.schema, state: value.state, phase: value.phase,
    planDigest: value.planDigest, operationKey: value.operationKey,
    sourceEvidenceDigest: digest(value.sourceEvidenceDigest, "observation source evidence"),
    values,
  };
  if (core.schema !== EXPIRED_ACTIVE_DIRTY_SCOPE_EXPANSION_RECOVERY_PHASE_OBSERVATION_SCHEMA
    || core.state !== "complete" || core.phase !== normalizedPhase
    || core.planDigest !== normalizedPlanDigest || core.operationKey !== normalizedOperationKey
    || values.operationKey !== normalizedOperationKey
    || value.observationDigest !== digestValue(core)) {
    throw new Error(`Expired active-dirty ${normalizedPhase} observation drifted.`);
  }
  return deepFreeze({ ...core, observationDigest: value.observationDigest });
}
export function classifyExpiredActiveDirtyScopeExpansionRecoveryPhase(value, expected = {}) {
  if (value == null || value?.state === "pending") {
    return Object.freeze({ state: "pending", observation: null });
  }
  const observation = normalizeExpiredActiveDirtyScopeExpansionRecoveryPhaseObservation(value, expected);
  return deepFreeze({ state: "complete", observation });
}
export function expiredActiveDirtyScopeExpansionRecoveryOperationKey(
  plan,
  authorizationDigest,
  phase,
) {
  const normalizedPhase = requiredPhase(phase);
  const planDigest = digest(plan?.planDigest, "recovery plan digest");
  return operationKeyFor(planDigest, digest(authorizationDigest, "authorization digest"), normalizedPhase);
}
function normalizeSourceInput(value) {
  object(value, "Recovery source input");
  const lease = normalizeLease(value.lease);
  return {
    controller: normalizeController(value.controller),
    lane: normalizeLane(value.lane),
    lease,
    leaseDigest: requiredMatchingDigest(value.leaseDigest ?? writerLeaseDigest(lease),
      writerLeaseDigest(lease), "source lease digest"),
    cloud: normalizeCloud(value.cloud),
    pullRequest: normalizePullRequest(value.pullRequest),
    dirt: normalizeDirt(value.dirt),
    scopeExpansionIntent: requiredNull(value.scopeExpansionIntent, "scope-expansion intent"),
  };
}
function normalizeController(value) {
  object(value, "Protected controller");
  const controller = {
    path: absolute(value.path, "protected controller path"), origin: text(value.origin, "protected controller origin"),
    targetRepository: repository(value.targetRepository, "protected target repository"),
    headSha: sha(value.headSha, "protected controller HEAD"), originMainSha: sha(value.originMainSha, "protected origin/main"),
    remoteMainSha: sha(value.remoteMainSha, "protected remote main"),
    treeSha: sha(value.treeSha, "protected controller tree"), clean: value.clean,
    implementationDigest: digest(value.implementationDigest, "protected implementation digest"),
  };
  if (githubRepository(controller.origin).toLowerCase() !== controller.targetRepository.toLowerCase()) {
    throw new Error("Protected controller origin does not match the target repository.");
  }
  if (controller.clean !== true
    || controller.headSha !== controller.originMainSha
    || controller.headSha !== controller.remoteMainSha) {
    throw new Error("Recovery requires one clean exact protected controller main.");
  }
  return deepFreeze(controller);
}
function normalizeLane(value) {
  object(value, "Expired active-dirty lane");
  const lane = {
    path: absolute(value.path, "lane path"), branch: text(value.branch, "lane branch"),
    headSha: sha(value.headSha, "lane HEAD"), treeSha: sha(value.treeSha, "lane tree"),
    parentSha: sha(value.parentSha, "lane parent"), parentTreeSha: sha(value.parentTreeSha, "lane parent tree"),
    parentCount: integer(value.parentCount, "lane parent count", 1),
    remoteHeadSha: sha(value.remoteHeadSha, "remote lane HEAD"),
    detached: value.detached, dirty: value.dirty, invalid: value.invalid,
    indexDigest: digest(value.indexDigest, "lane index digest"),
    workingTreeDigest: digest(value.workingTreeDigest, "lane working-tree digest"),
    stateDigest: digest(value.stateDigest, "lane state digest"),
  };
  if (lane.detached !== false || lane.dirty !== true || lane.invalid !== false
    || lane.parentCount !== 1 || lane.headSha !== lane.remoteHeadSha
    || lane.treeSha !== lane.parentTreeSha) {
    throw new Error("Recovery requires one attached dirty same-tree fence child.");
  }
  return deepFreeze(lane);
}
function normalizeLease(value) {
  object(value, "Expired writer lease");
  writerLeaseDigest(value);
  return deepFreeze(JSON.parse(JSON.stringify(value)));
}
function normalizeCloud(value) {
  object(value, "Cloud recovery snapshot");
  const claim = normalizeClaim(value.claim);
  const peers = array(value.peers, "cloud peers").map(normalizePeer)
    .sort((left, right) => left.claimId.localeCompare(right.claimId));
  unique(peers.map(item => item.claimId), "cloud peer claim IDs");
  if (peers.some(peer => peer.claimId === claim.claimId)) {
    throw new Error("Cloud target claim must not be duplicated among peers.");
  }
  const cloud = {
    ledgerRepository: repository(value.ledgerRepository, "cloud ledger repository"), ledgerRevision: sha(value.ledgerRevision, "cloud ledger revision"), ledgerDigest: digest(value.ledgerDigest, "cloud ledger digest"),
    sequence: integer(value.sequence, "cloud ledger sequence", 1),
    authenticatedActor: normalizeAuthenticatedActor(value.authenticatedActor),
    claim, peers: deepFreeze(peers), peerSetDigest: digestValue(peers),
  };
  if (value.peerSetDigest && value.peerSetDigest !== cloud.peerSetDigest) {
    throw new Error("Cloud peer-set digest drifted.");
  }
  return deepFreeze(cloud);
}
function normalizeClaim(value) {
  object(value, "Cloud recovery claim");
  const declaredWriteScope = normalizeWriteSet(value.declaredWriteScope);
  const claim = {
    claimId: digest(value.claimId, "claim ID"), claimDigest: digest(value.claimDigest ?? value.fenceRevision, "claim digest"),
    state: text(value.state, "claim state"), recordedState: text(value.recordedState, "claim recorded state"),
    writeAuthority: value.writeAuthority, scopeReserved: value.scopeReserved,
    actorId: text(value.actorId, "claim actor ID"), deviceId: text(value.deviceId, "claim device ID"),
    sessionId: text(value.sessionId, "claim session ID"), repositoryId: text(value.repositoryId, "claim repository ID"),
    workItemId: text(value.workItemId, "claim work-item ID"),
    canonicalBaseRevision: sha(value.canonicalBaseRevision, "claim canonical base"), laneRevision: sha(value.laneRevision, "claim lane revision"),
    declaredWriteScope: deepFreeze(declaredWriteScope),
    writeSetDigest: digest(value.writeSetDigest, "claim write-set digest"),
    leaseEpoch: integer(value.leaseEpoch, "claim lease epoch", 1), transitionCounter: integer(value.transitionCounter, "claim transition counter", 1),
    heartbeatCounter: integer(value.heartbeatCounter, "claim heartbeat counter", 0),
    reviewRequestId: text(value.reviewRequestId, "claim review request ID"),
    expiresAt: instant(value.expiresAt, "claim expiry"), transitionDigest: digest(value.transitionDigest, "claim transition digest"),
    operationReceiptDigest: digest(value.operationReceiptDigest, "claim operation receipt digest"),
    recovery: normalizeRecovery(value.recovery),
  };
  if (claim.writeSetDigest !== digestValue(declaredWriteScope)) {
    throw new Error("Cloud claim write-set digest is invalid.");
  }
  return deepFreeze(claim);
}
function normalizePeer(value) {
  object(value, "Cloud peer");
  const { recordDigest: suppliedDigest, ...rawRecord } = value;
  if (PEER_RECORD_FIELDS.some(field => !Object.hasOwn(rawRecord, field))) {
    throw new Error("Cloud peer record is incomplete.");
  }
  const declaredWriteScope = normalizeWriteSet(value.declaredWriteScope);
  const core = {
    ...JSON.parse(canonicalJson(rawRecord)),
    claimId: digest(value.claimId, "peer claim ID"), claimDigest: digest(value.claimDigest, "peer claim digest"),
    state: text(value.state, "peer state"),
    recordedState: text(value.recordedState, "peer recorded state"), scopeReserved: value.scopeReserved,
    repositoryId: text(value.repositoryId, "peer repository ID"),
    declaredWriteScope: deepFreeze(declaredWriteScope),
    writeSetDigest: digest(value.writeSetDigest, "peer write-set digest"),
    transitionCounter: integer(value.transitionCounter, "peer transition counter", 1), transitionDigest: digest(value.transitionDigest, "peer transition digest"),
  };
  if (core.writeSetDigest !== digestValue(declaredWriteScope)) {
    throw new Error("Cloud peer write-set digest is invalid.");
  }
  const recordDigest = digestValue(core);
  if (digest(suppliedDigest, "peer record digest") !== recordDigest) {
    throw new Error("Cloud peer record digest drifted.");
  }
  return deepFreeze({ ...core, recordDigest });
}
function normalizePullRequest(value) {
  object(value, "Ownership pull request");
  const pullRequest = {
    number: integer(value.number, "pull-request number", 1), nodeId: text(value.nodeId, "pull-request node ID"),
    url: text(value.url, "pull-request URL"), state: text(value.state, "pull-request state"), isDraft: value.isDraft,
    baseRepository: repository(value.baseRepository, "pull-request base repository"),
    baseRefName: text(value.baseRefName, "pull-request base"), baseRefOid: sha(value.baseRefOid, "pull-request base HEAD"),
    headRefName: text(value.headRefName, "pull-request branch"), headRefOid: sha(value.headRefOid, "pull-request HEAD"),
    headRepository: repository(value.headRepository, "pull-request head repository"),
    markerLeaseDigest: digest(value.markerLeaseDigest, "pull-request marker lease digest"),
    bodyFrameDigest: digest(value.bodyFrameDigest, "pull-request body-frame digest"),
  };
  const canonicalUrl = `https://github.com/${pullRequest.headRepository}/pull/${pullRequest.number}`;
  if (pullRequest.state !== "OPEN" || pullRequest.isDraft !== true
    || pullRequest.baseRefName !== "main" || pullRequest.url !== canonicalUrl) {
    throw new Error("Recovery requires the exact open draft ownership pull request.");
  }
  return deepFreeze(pullRequest);
}
function normalizeDirt(value) {
  object(value, "Owned dirt evidence");
  const core = {
    statusDigest: digest(value.statusDigest, "dirty status digest"), indexDigest: digest(value.indexDigest, "dirty index digest"),
    unstagedDiffDigest: digest(value.unstagedDiffDigest, "unstaged diff digest"),
    stagedDiffDigest: digest(value.stagedDiffDigest, "staged diff digest"),
    worktreeObjectsDigest: digest(value.worktreeObjectsDigest, "worktree objects digest"),
    ownedDirtDigest: digest(value.ownedDirtDigest ?? value.digest, "owned-dirt evidence digest"), pathCount: integer(value.pathCount, "owned-dirt path count", 1),
    changedPaths: sortedPaths(value.changedPaths, "changed paths"),
    untrackedPaths: sortedPaths(value.untrackedPaths ?? [], "untracked paths", true),
  };
  if (core.changedPaths.length === 0 || core.untrackedPaths.length > 0
    || core.pathCount !== core.changedPaths.length) {
    throw new Error("Scope-expansion recovery requires tracked dirty bytes and no untracked files.");
  }
  const dirtDigest = digestValue(core);
  if (value.dirtDigest && value.dirtDigest !== dirtDigest) {
    throw new Error("Owned dirt digest drifted.");
  }
  return deepFreeze({ ...core, dirtDigest });
}
function assertSourceJoins(source) {
  const { cloud, controller, dirt, lane, lease, leaseDigest, pullRequest } = source;
  const authority = lease.cloudAuthority;
  const admission = lease.admission;
  if (lease.status !== "active" || admission?.status !== "admitted"
    || lease.branch !== lane.branch || path.resolve(lease.worktreePath) !== lane.path
    || lease.fenceSha !== lane.headSha || lease.baseSha !== lane.parentSha
    || lease.pullRequestUrl !== pullRequest.url || pullRequest.headRefName !== lane.branch
    || pullRequest.headRefOid !== lane.headSha || pullRequest.headRepository !== controller.targetRepository
    || pullRequest.baseRepository !== controller.targetRepository || pullRequest.baseRefOid !== controller.headSha
    || pullRequest.markerLeaseDigest !== leaseDigest || authority?.claimId !== cloud.claim.claimId
    || authority.claimDigest !== cloud.claim.claimDigest || authority.ledgerRepository !== cloud.ledgerRepository
    || authority.transitionCounter !== cloud.claim.transitionCounter
    || authority.laneRevision !== lane.headSha || authority.canonicalBaseSha !== lease.baseSha
    || authority.deviceId !== lease.device || authority.sessionId !== lease.sessionId
    || cloud.authenticatedActor.actorId !== cloud.claim.actorId
    || cloud.claim.deviceId !== pseudonymousIdentifier("device", lease.device)
    || cloud.claim.sessionId !== pseudonymousIdentifier("session", lease.sessionId)
    || cloud.claim.canonicalBaseRevision !== lease.baseSha
    || cloud.claim.laneRevision !== lane.headSha
    || cloud.claim.writeSetDigest !== admission.writeSetDigest || cloud.claim.reviewRequestId !== authority.reviewRequestId
    || cloud.claim.reviewRequestId !== `github-pull-request:${pullRequest.nodeId}`
    || cloud.claim.state !== "dormant-preserved" || cloud.claim.recordedState !== "current"
    || cloud.claim.writeAuthority !== false || cloud.claim.scopeReserved !== true) {
    throw new Error("Expired active-dirty recovery source identities do not join.");
  }
  const writeSet = normalizeWriteSet(admission.declaredWriteSet);
  if (admission.writeSetDigest !== digestValue(writeSet)
    || JSON.stringify(writeSet) !== JSON.stringify(cloud.claim.declaredWriteScope)
    || !dirt.changedPaths.every(changed => writeSetCoversPath(writeSet, changed))) {
    throw new Error("Expired active-dirty bytes exceed their current admitted scope.");
  }
  const overlap = cloud.peers.find(peer => peer.repositoryId === cloud.claim.repositoryId
    && peer.scopeReserved && writeSetsOverlap(peer.declaredWriteScope, writeSet));
  if (overlap) throw new Error(`Cloud claim ${overlap.claimId} still reserves overlapping recovery scope.`);
}
function normalizeLive(value) {
  object(value, "Live recovery evidence");
  const lease = normalizeLease(value.lease);
  return deepFreeze({
    lane: normalizeLane(value.lane), lease,
    leaseDigest: requiredMatchingDigest(value.leaseDigest ?? writerLeaseDigest(lease),
      writerLeaseDigest(lease), "live lease digest"),
    cloud: normalizeCloud(value.cloud), pullRequest: normalizePullRequest(value.pullRequest),
    dirt: normalizeDirt(value.dirt),
    scopeExpansionIntent: requiredNull(value.scopeExpansionIntent, "live scope-expansion intent"),
    mutationAuthority: normalizeMutationAuthority(value.mutationAuthority),
  });
}
function normalizeMutationAuthority(value) {
  if (value == null) return null;
  object(value, "Mutation-authority receipt");
  const core = {
    schema: text(value.schema, "mutation-authority schema"), status: text(value.status, "mutation-authority status"),
    claimId: digest(value.claimId, "mutation-authority claim ID"), claimDigest: digest(value.claimDigest, "mutation-authority claim digest"),
    ledgerRevision: sha(value.ledgerRevision, "mutation-authority ledger revision"),
    localLeaseEpoch: integer(value.localLeaseEpoch, "mutation-authority local epoch", 1),
    localFenceSha: sha(value.localFenceSha, "mutation-authority fence"), remoteLeaseEpoch: integer(value.remoteLeaseEpoch, "mutation-authority remote epoch", 1),
    expiresAt: instant(value.expiresAt, "mutation-authority expiry"),
  };
  if (core.schema !== "agentic-admission-mutation-authority/v1" || core.status !== "ready") {
    throw new Error("Recovery mutation-authority receipt is not ready.");
  }
  return deepFreeze({ ...core, projectionDigest: digestValue(core) });
}
function phaseContext({ plan, intent, phase, operationKey }) {
  object(plan, "Recovery plan");
  const normalizedPhase = requiredPhase(phase);
  const planDigest = digest(plan.planDigest, "recovery plan digest");
  const source = normalizeExpiredActiveDirtyScopeExpansionRecoverySourceEvidence(plan.sourceEvidence);
  if (plan.sourceEvidenceDigest !== source.sourceEvidenceDigest) {
    throw new Error("Recovery plan source evidence drifted.");
  }
  const authorizationDigest = digest(intent?.authorizationDigest, "intent authorization digest");
  const expectedKey = operationKeyFor(planDigest, authorizationDigest, normalizedPhase);
  if (operationKey !== expectedKey || intent?.planDigest !== planDigest) {
    throw new Error(`Expired active-dirty ${normalizedPhase} operation identity drifted.`);
  }
  return { plan, planDigest, authorizationDigest, source, phase: normalizedPhase, operationKey: expectedKey };
}
function phaseState(context, live) {
  assertPreservedBytes(context.source, live);
  const cloudRecovered = assertCloudProgress(context, live);
  const localRebound = cloudRecovered && assertLocalProgress(context, live);
  const prProjected = localRebound && assertPullRequestProgress(context, live);
  const complete = prProjected && assertCompleteProgress(context, live);
  const states = { "cloud-recovered": cloudRecovered, "local-rebound": localRebound,
    "pr-projected": prProjected, complete };
  return states[context.phase] ? "complete" : "pending";
}
function assertPreservedBytes(source, live) {
  if (live.lane.path !== source.lane.path || live.lane.branch !== source.lane.branch
    || live.lane.headSha !== source.lane.headSha || live.lane.treeSha !== source.lane.treeSha
    || live.lane.parentSha !== source.lane.parentSha
    || live.lane.indexDigest !== source.lane.indexDigest
    || live.lane.workingTreeDigest !== source.lane.workingTreeDigest
    || live.dirt.dirtDigest !== source.dirt.dirtDigest
    || digestValue(pullRequestIdentity(live.pullRequest)) !== digestValue(pullRequestIdentity(source.pullRequest))) {
    throw new Error("Expired active-dirty recovery changed source bytes, fence, or pull request.");
  }
}
function assertCloudProgress(context, live) {
  const source = context.source.cloud;
  const claim = live.cloud.claim;
  assertPeerSet(source, live.cloud);
  if (claim.state === "dormant-preserved") {
    if (digestValue(claim) !== digestValue(source.claim)
      || live.cloud.ledgerRevision !== source.ledgerRevision
      || live.cloud.ledgerDigest !== source.ledgerDigest) {
      throw new Error("Pending dormant cloud claim drifted.");
    }
    return false;
  }
  const original = source.claim;
  if (claim.state !== "current" || claim.recordedState !== "current"
    || claim.writeAuthority !== true || claim.scopeReserved !== true
    || claim.claimId !== original.claimId || claim.actorId !== original.actorId
    || claim.deviceId !== original.deviceId || claim.sessionId !== original.sessionId
    || claim.repositoryId !== original.repositoryId || claim.workItemId !== original.workItemId
    || claim.canonicalBaseRevision !== original.canonicalBaseRevision
    || claim.laneRevision !== original.laneRevision
    || claim.writeSetDigest !== original.writeSetDigest
    || claim.leaseEpoch !== original.leaseEpoch
    || claim.transitionCounter !== original.transitionCounter + 1
    || claim.heartbeatCounter !== original.heartbeatCounter
    || claim.reviewRequestId !== original.reviewRequestId
    || claim.recovery?.evidenceDigest !== operationKeyFor(
      context.planDigest, context.authorizationDigest, "cloud-recovered")
    || Date.parse(claim.expiresAt) <= Date.parse(original.expiresAt)) {
    throw new Error("Recovered cloud claim changed its same-owner source identity.");
  }
  return true;
}
function assertLocalProgress(context, live) {
  const source = context.source;
  const claim = live.cloud.claim;
  if (live.leaseDigest === source.leaseDigest) return false;
  const lease = live.lease;
  if (digestValue(leaseIdentity(lease)) !== digestValue(leaseIdentity(source.lease))
    || lease.cloudAuthority?.claimId !== claim.claimId
    || lease.cloudAuthority?.claimDigest !== claim.claimDigest
    || lease.cloudAuthority?.transitionCounter !== claim.transitionCounter
    || lease.cloudAuthority?.state !== "active"
    || lease.cloudAuthority?.expiresAt !== claim.expiresAt
    || lease.expiresAt !== claim.expiresAt || Date.parse(lease.heartbeatAt) <= Date.parse(source.lease.heartbeatAt)) {
    throw new Error("Recovered local lease does not rebind the exact cloud claim.");
  }
  return true;
}
function assertPullRequestProgress(context, live) {
  if (live.pullRequest.markerLeaseDigest === context.source.pullRequest.markerLeaseDigest) return false;
  if (live.pullRequest.markerLeaseDigest !== live.leaseDigest) {
    throw new Error("Recovered pull-request marker does not match the rebound lease.");
  }
  return true;
}
function assertCompleteProgress(context, live) {
  const receipt = live.mutationAuthority;
  if (!receipt) return false;
  if (receipt.claimId !== live.cloud.claim.claimId
    || receipt.claimDigest !== live.cloud.claim.claimDigest
    || receipt.ledgerRevision !== live.cloud.ledgerRevision
    || receipt.localLeaseEpoch !== live.lease.epoch
    || receipt.localFenceSha !== live.lane.headSha
    || receipt.remoteLeaseEpoch !== live.cloud.claim.leaseEpoch) {
    throw new Error("Recovered mutation-authority receipt does not join live state.");
  }
  return true;
}
function phaseValues({ context, evidenceDigest, live, liveStateDigest }) {
  const sourceMarker = context.source.pullRequest.markerLeaseDigest;
  return deepFreeze({
    operationKey: context.operationKey, evidenceDigest, liveStateDigest,
    claimDigest: live.cloud.claim.claimDigest,
    leaseDigest: context.phase === "cloud-recovered"
      ? context.source.leaseDigest : live.leaseDigest,
    pullRequestMarkerLeaseDigest: ["pr-projected", "complete"].includes(context.phase)
      ? live.pullRequest.markerLeaseDigest : sourceMarker,
    mutationAuthorityProjectionDigest: context.phase === "complete"
      ? live.mutationAuthority?.projectionDigest ?? null : null,
  });
}
function normalizePhaseValues(value) {
  object(value, "Recovery phase values");
  exactFields(value, "operationKey evidenceDigest liveStateDigest claimDigest leaseDigest pullRequestMarkerLeaseDigest mutationAuthorityProjectionDigest".split(" "), "Recovery phase values");
  return deepFreeze({
    operationKey: digest(value.operationKey, "phase operation key"), evidenceDigest: digest(value.evidenceDigest, "phase evidence digest"),
    liveStateDigest: digest(value.liveStateDigest, "phase live-state digest"), claimDigest: digest(value.claimDigest, "phase claim digest"),
    leaseDigest: digest(value.leaseDigest, "phase lease digest"), pullRequestMarkerLeaseDigest: digest(value.pullRequestMarkerLeaseDigest, "phase pull-request marker lease digest"),
    mutationAuthorityProjectionDigest: value.mutationAuthorityProjectionDigest == null
      ? null
      : digest(value.mutationAuthorityProjectionDigest, "phase mutation authority"),
  });
}
function projectPhaseLive(phase, live) {
  const projection = {
    cloud: live.cloud, dirtDigest: live.dirt.dirtDigest,
    laneHeadSha: live.lane.headSha, laneIndexDigest: live.lane.indexDigest,
    laneWorkingTreeDigest: live.lane.workingTreeDigest,
  };
  if (["local-rebound", "pr-projected", "complete"].includes(phase)) projection.leaseDigest = live.leaseDigest;
  if (["pr-projected", "complete"].includes(phase)) projection.pullRequestMarkerLeaseDigest = live.pullRequest.markerLeaseDigest;
  if (phase === "complete") projection.mutationAuthority = live.mutationAuthority;
  return deepFreeze(projection);
}
function assertPeerSet(source, live) {
  if (JSON.stringify(live.authenticatedActor) !== JSON.stringify(source.authenticatedActor)
    || live.ledgerRepository !== source.ledgerRepository
    || live.peerSetDigest !== source.peerSetDigest
    || JSON.stringify(live.peers) !== JSON.stringify(source.peers)) {
    throw new Error("Non-target cloud claim inventory changed during recovery.");
  }
}
function leaseIdentity(lease) {
  const identity = JSON.parse(canonicalJson(lease));
  delete identity.cloudAuthority;
  delete identity.heartbeatAt;
  delete identity.expiresAt;
  return identity;
}
function pullRequestIdentity(value) { const identity = { ...value }; delete identity.markerLeaseDigest; return identity; }
function normalizeRecovery(value) {
  if (value == null) return null;
  object(value, "Cloud recovery evidence");
  return deepFreeze({ evidenceDigest: digest(value.evidenceDigest, "cloud recovery evidence digest"),
    recoveredAt: instant(value.recoveredAt, "cloud recovered-at instant") });
}
function operationKeyFor(planDigest, authorizationDigest, phase) {
  return digestValue({ schema: OPERATION_KEY_SCHEMA, planDigest, authorizationDigest, phase });
}
function normalizeAuthenticatedActor(value) {
  object(value, "Authenticated cloud actor");
  return deepFreeze({ actorId: text(value.actorId, "authenticated actor ID"),
    login: text(value.login, "authenticated actor login") });
}
function requiredPhase(value) {
  const phase = text(value, "recovery phase");
  if (!PHASES.includes(phase)) throw new Error(`Unsupported recovery phase: ${phase}`);
  return phase;
}
function writeSetCoversPath(writeSet, changedPath) {
  return writeSet.some((item) => {
    if (!item.startsWith("path:")) return false;
    const owned = item.slice(5);
    return owned === "." || changedPath === owned || changedPath.startsWith(`${owned}/`);
  });
}
function sortedPaths(value, label, allowEmpty = false) {
  const paths = array(value, label).map((item, index) => {
    const result = text(item, `${label} ${index}`);
    if (path.isAbsolute(result) || result.split("/").includes("..")) {
      throw new Error(`${label} must be repository-relative.`);
    }
    return result;
  });
  unique(paths, label);
  paths.sort();
  if (!allowEmpty && paths.length === 0) throw new Error(`${label} must not be empty.`);
  return deepFreeze(paths);
}
function requiredMatchingDigest(value, expected, label) {
  const result = digest(value, label);
  if (result !== expected) throw new Error(`${label} does not match exact bytes.`);
  return result;
}
function repository(value, label) {
  const result = text(value, label);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(result)) throw new Error(`${label} must be owner/repository.`);
  return result;
}
function githubRepository(value) {
  const match = value.match(/^(?:git@github\.com:|https:\/\/github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/u);
  if (!match) throw new Error("Protected controller origin must be canonical GitHub SSH or HTTPS.");
  return repository(match[1], "protected controller origin repository");
}
function absolute(value, label) {
  const result = path.resolve(text(value, label));
  if (!path.isAbsolute(result)) throw new Error(`${label} must be absolute.`);
  return result;
}
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}
function array(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}
function text(value, label) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) throw new Error(`${label} must be canonical non-empty text.`);
  return value;
}
function sha(value, label) {
  if (!SHA_PATTERN.test(String(value || ""))) throw new Error(`${label} must be a SHA.`);
  return value;
}
function digest(value, label) {
  if (!DIGEST_PATTERN.test(String(value || ""))) throw new Error(`${label} must be a digest.`);
  return value;
}
function integer(value, label, minimum) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${label} must be an integer.`);
  return value;
}
function instant(value, label) {
  const result = text(value, label);
  if (!Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) {
    throw new Error(`${label} must be a canonical instant.`);
  }
  return result;
}
function requiredNull(value, label) {
  if (value !== null && value !== undefined) throw new Error(`${label} must be absent.`);
  return null;
}
function unique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique.`);
}
function exactFields(value, fields, label) {
  const keys = Object.keys(value);
  if (keys.length !== fields.length || keys.some(key => !fields.includes(key))) throw new Error(`${label} fields are not exact.`);
}
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
