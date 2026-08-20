// Responsibility: Canonicalize complete dormant-preservation admission evidence and reject identity drift.
import path from "node:path";
import {
  canonicalJson,
  digestValue,
  normalizeWriteSet,
  writeSetsOverlap,
} from "./cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "./github-cloud-collaboration-mapping.mjs";
import { isOperationDerivedDormantPreservation, isReadyRemoteInventory } from "./scoped-lane-authority-state.mjs";
import { parseDeviceBranch } from "./writer-lease-lib.mjs";
export const DORMANT_PRESERVATION_ADMISSION_SELECTION_SCHEMA = "agentic-dormant-preservation-admission-selection/v1";
export const DORMANT_PRESERVATION_ADMISSION_SOURCE_EVIDENCE_SCHEMA = "agentic-dormant-preservation-admission-source-evidence/v2";
export const DORMANT_PRESERVATION_ADMISSION_EXECUTION_EVIDENCE_SCHEMA = "agentic-dormant-preservation-admission-execution-evidence/v1";
const CLOUD_INVENTORY_SCHEMA = "agentic-dormant-preservation-admission-cloud-inventory/v1";
const CLOUD_DECISION_SCHEMA = "agentic-dormant-preservation-admission-cloud-decision/v2";
const PRESERVATION_PROJECTION_SCHEMA = "agentic-dormant-preservation-admission-preservation-projection/v2";
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
export function normalizeDormantPreservationAdmissionSelection(value) {
  requireObject(value, "Dormant-preservation selection");
  if (value.schema !== DORMANT_PRESERVATION_ADMISSION_SELECTION_SCHEMA
    || !Array.isArray(value.lanes) || value.lanes.length < 1 || value.lanes.length > 128) {
    throw new Error("Dormant-preservation selection must contain 1 to 128 lanes.");
  }
  const lanes = value.lanes.map((lane, index) => {
    requireObject(lane, `Selection lane ${index}`);
    exactKeys(lane, ["pullRequest", "worktreePath"], `Selection lane ${index}`);
    return Object.freeze({
      worktreePath: absolutePath(lane.worktreePath, `Selection lane ${index} path`),
      pullRequest: pullRequestReference(lane.pullRequest, `Selection lane ${index} pull request`),
    });
  }).sort((left, right) => selectionKey(left).localeCompare(selectionKey(right)));
  unique(lanes.map(selectionKey), "Dormant-preservation selection");
  return deepFreeze({ schema: DORMANT_PRESERVATION_ADMISSION_SELECTION_SCHEMA, lanes });
}
export function projectDormantPreservationAdmissionCloudInventory(value) {
  requireObject(value, "Cloud inventory");
  const source = value.inventory || value;
  requireObject(source, "Cloud inventory source");
  const rawClaims = source.claims;
  if (!Array.isArray(rawClaims) || rawClaims.length > 128) {
    throw new Error("Cloud inventory must contain one complete bounded claim set.");
  }
  const claims = rawClaims.map((claim, index) => normalizeCloudClaim(claim, index))
    .sort((left, right) => left.claimId.localeCompare(right.claimId));
  unique(claims.map(claim => claim.claimId), "Cloud claim identity");
  const core = {
    schema: CLOUD_INVENTORY_SCHEMA,
    ledgerRevision: sha(source.observedLedgerHeadRevision ?? value.ledgerRevision, "Cloud inventory ledger revision"),
    ledgerDigest: digest(source.ledgerDigest ?? value.ledgerDigest, "Cloud inventory ledger digest"),
    claims,
  };
  return deepFreeze({ ...core, inventoryStateDigest: digestValue(core) });
}
export function projectDormantPreservationAdmissionCloudDecision(
  value,
  candidate,
  preservation,
) {
  const inventory = projectDormantPreservationAdmissionCloudInventory(value);
  const normalizedCandidate = normalizeCandidate(candidate);
  const normalizedPreservation = normalizePreservation(preservation);
  const candidateClaim = inventory.claims.find(
    claim => claim.claimId === normalizedCandidate.candidateClaim.claimId,
  );
  if (!candidateClaim) {
    throw new Error("Cloud decision is missing its candidate claim.");
  }
  const candidateWriteSet = normalizeWriteSet(candidateClaim.declaredWriteScope);
  const selectedAuthority = selectedAuthorityIdentity(normalizedPreservation);
  const selectedClaims = inventory.claims.filter(
    claim => claim.claimId !== candidateClaim.claimId
      && claimMatchesSelectedAuthority(claim, selectedAuthority),
  );
  const relevantClaims = inventory.claims.filter(claim => (
    claim.claimId === candidateClaim.claimId
    || claimMatchesCandidateLineage(claim, candidateClaim)
    || selectedClaims.some(selected => selected.claimId === claim.claimId)
    || writeSetsOverlap(candidateWriteSet, normalizeWriteSet(claim.declaredWriteScope))
  )).sort((left, right) => left.claimId.localeCompare(right.claimId));
  const core = {
    schema: CLOUD_DECISION_SCHEMA,
    candidateClaimId: candidateClaim.claimId,
    candidateWriteSetDigest: candidateClaim.writeSetDigest,
    selectedClaimIds: selectedClaims.map(claim => claim.claimId).sort(),
    claims: relevantClaims,
  };
  return deepFreeze({ ...core, decisionStateDigest: digestValue(core) });
}
export function projectDormantPreservationAdmissionReceipt(receipt) {
  requireObject(receipt, "Dormant-preservation receipt");
  normalizeReceiptCloudObservation(receipt.cloudInventory);
  const { receiptDigest: ignoredDigest, verifiedAt: ignoredInstant,
    operatorDecisionDigest: ignoredDecision, cloudInventory: ignoredInventory,
    ...withoutObservation } = receipt;
  const projected = canonicalClone(withoutObservation);
  if (projected.schema !== "agentic-dormant-preservation-receipt/v1"
    || projected.status !== "dormant-preserved"
    || projected.authorityState !== "dormant-preserved") {
    throw new Error("Dormant-preservation receipt is not preservation authority.");
  }
  requireObject(projected.authenticatedActor, "Dormant authenticated actor");
  requireObject(projected.repository, "Dormant repository");
  projected.authenticatedActor.actorId = text(projected.authenticatedActor.actorId, "Dormant actor ID");
  projected.authenticatedActor.login = text(projected.authenticatedActor.login, "Dormant actor login");
  projected.repository.id = text(projected.repository.id, "Dormant repository ID");
  projected.repository.nameWithOwner = repository(projected.repository.nameWithOwner, "Dormant repository");
  projected.repository.ownerLogin = text(projected.repository.ownerLogin, "Dormant owner login");
  projected.repository.path = absolutePath(projected.repository.path, "Dormant repository path");
  projected.sessionId = text(projected.sessionId, "Dormant session ID");
  projected.worktrees = boundedArray(projected.worktrees, "Dormant worktrees")
    .map((worktree, index) => normalizeWorktree(worktree, index))
    .sort((left, right) => left.path.localeCompare(right.path));
  projected.pullRequests = boundedArray(projected.pullRequests, "Dormant pull requests", true)
    .map((pullRequest, index) => normalizePullRequest(pullRequest, index))
    .sort((left, right) => left.number - right.number);
  unique(projected.worktrees.map(worktree => worktree.path), "Dormant worktree path");
  unique(projected.pullRequests.map(pullRequest => String(pullRequest.number)), "Dormant pull request");
  const core = { schema: PRESERVATION_PROJECTION_SCHEMA, receipt: projected };
  return deepFreeze({ ...core, projectionDigest: digestValue(core) });
}
export function buildDormantPreservationAdmissionSourceEvidence({
  controller, canonical, candidate, remoteInventory, dormantReceipt, selection,
}) {
  if (!isOperationDerivedDormantPreservation(dormantReceipt)) {
    throw new Error("Source evidence requires an operation-derived dormant-preservation receipt.");
  }
  if (!isReadyRemoteInventory(remoteInventory)) {
    throw new Error("Source evidence requires an operation-derived complete cloud inventory.");
  }
  const normalizedSelection = normalizeDormantPreservationAdmissionSelection(selection);
  const cloudInventory = projectDormantPreservationAdmissionCloudInventory(remoteInventory);
  assertReceiptInventoryJoin(dormantReceipt, remoteInventory, cloudInventory);
  const receiptProjection = projectDormantPreservationAdmissionReceipt(dormantReceipt);
  const preservation = buildPreservation(receiptProjection, normalizedSelection);
  const normalizedCandidate = normalizeCandidate(candidate);
  const cloudDecision = projectDormantPreservationAdmissionCloudDecision(
    cloudInventory,
    normalizedCandidate,
    preservation,
  );
  const core = normalizeSourceCore({ schema: DORMANT_PRESERVATION_ADMISSION_SOURCE_EVIDENCE_SCHEMA,
    controller, canonical, candidate: normalizedCandidate, cloudDecision, preservation });
  assertSourceJoins(core);
  return deepFreeze({ ...core, sourceEvidenceDigest: digestValue(core) });
}
export function normalizeDormantPreservationAdmissionSourceEvidence(value) {
  requireObject(value, "Dormant-preservation source evidence");
  const core = normalizeSourceCore(value);
  assertSourceJoins(core);
  if (value.sourceEvidenceDigest !== digestValue(core)) {
    throw new Error("Dormant-preservation source evidence digest drifted.");
  }
  return deepFreeze({ ...core, sourceEvidenceDigest: value.sourceEvidenceDigest });
}
export function assertDormantPreservationAdmissionSourceEvidence(expected, observed) {
  const left = normalizeDormantPreservationAdmissionSourceEvidence(expected);
  const right = normalizeDormantPreservationAdmissionSourceEvidence(observed);
  if (canonicalJson(left) !== canonicalJson(right)) {
    throw new Error("Dormant-preservation admission source evidence drifted.");
  }
  return right;
}
export function assertDormantPreservationAdmissionPlannedContinuation(plan, input) {
  requireObject(plan, "Dormant-preservation admission plan"); const source = normalizeDormantPreservationAdmissionSourceEvidence(plan.sourceEvidence);
  if (digest(plan.planDigest, "Planned continuation plan digest") !== plan.planDigest
    || source.sourceEvidenceDigest !== plan.sourceEvidenceDigest
    || canonicalJson(normalizeController(input.controller)) !== canonicalJson(source.controller)
    || canonicalJson(normalizeCanonical(input.canonical)) !== canonicalJson(source.canonical)) {
    throw new Error("Planned continuation controller or canonical source drifted.");
  }
  requireObject(input.candidateLease, "Planned candidate lease");
  const lease = input.candidateLease, lineage = input.candidateLineage, candidateLane = input.postLaneState?.lanes?.find(
    lane => path.resolve(lane.path) === source.candidate.targetPath,
  );
  const candidate = { path: source.candidate.targetPath, branch: source.candidate.branch,
    sessionId: source.candidate.sessionId, headSha: candidateLane?.head, treeSha: candidateLane?.treeSha, stateDigest: candidateLane?.stateDigest };
  const lanes = assertPostLaneState(input.postLaneState, source, candidate);
  const files = input.files || {}, admission = lease.admission, authority = lease.cloudAuthority;
  if (path.resolve(lease.worktreePath || "") !== candidate.path || lease.branch !== candidate.branch
    || lease.sessionId !== candidate.sessionId || lease.scope !== source.candidate.semanticScope
    || lease.baseSha !== source.canonical.headSha || lease.fenceSha !== candidate.headSha
    || lineage?.headSha !== candidate.headSha || lineage.treeSha !== candidate.treeSha
    || lineage.parentSha !== source.canonical.headSha || lineage.parentCount !== 1
    || candidate.treeSha !== source.canonical.treeSha
    || admission?.status !== "planned" || admission.semanticScope !== source.candidate.semanticScope
    || admission.manifestDigest !== source.candidate.manifest.manifestDigest
    || admission.writeSetDigest !== source.candidate.manifest.writeSetDigest
    || authority?.claimId !== source.candidate.candidateClaim.claimId
    || canonicalJson(input.manifest) !== canonicalJson(source.candidate.manifest)
    || files.selectionFileDigest !== source.candidate.selectionFileDigest
    || files.manifestFileDigest !== source.candidate.manifestFileDigest
    || files.cloudAuthorityFileDigest !== source.candidate.cloudAuthorityFileDigest) {
    throw new Error("Planned candidate lease, manifest, or source files drifted.");
  }
  const cloud = assertPostCloudInventory(input.postCloudInventory, source);
  const dormant = assertPostDormantReceipt(input.dormantPreservationReceipt,
    input.postCloudInventory, cloud.inventory, source, plan.planDigest);
  return deepFreeze({ ...lanes, peerSetDigest: cloud.evidence.peerSetDigest, dormantPreservationReceiptDigest: dormant.projectionDigest });
}
export function buildDormantPreservationAdmissionExecutionEvidence(input) {
  requireObject(input.plan, "Dormant-preservation admission plan");
  const plan = input.plan;
  const source = normalizeDormantPreservationAdmissionSourceEvidence(plan.sourceEvidence);
  if (plan.sourceEvidenceDigest !== source.sourceEvidenceDigest) {
    throw new Error("Execution plan source evidence drifted.");
  }
  const candidate = normalizeExecutionCandidate(input.candidate);
  const lanes = assertPostLaneState(input.postLaneState, source, candidate);
  const finalCloud = assertPostCloudInventory(input.postCloudInventory, source);
  const dormantReceipt = assertPostDormantReceipt(input.dormantPreservationReceipt,
    input.postCloudInventory, finalCloud.inventory, source, plan.planDigest);
  if (candidate.path !== source.candidate.targetPath
    || candidate.branch !== source.candidate.branch
    || candidate.sessionId !== source.candidate.sessionId
    || candidate.pullRequestHeadSha !== candidate.headSha || candidate.parentCount !== 1
    || candidate.parentSha !== source.canonical.headSha || candidate.treeSha !== source.canonical.treeSha
    || candidate.pullRequestUrl !== `https://github.com/${source.canonical.targetRepository}/pull/${candidate.pullRequestNumber}`) {
    throw new Error("Execution evidence changed the planned candidate identity.");
  }
  const core = normalizeExecutionCore({
    schema: DORMANT_PRESERVATION_ADMISSION_EXECUTION_EVIDENCE_SCHEMA,
    status: "admitted",
    planDigest: plan.planDigest,
    operationKey: input.operationKey,
    sourceEvidenceDigest: source.sourceEvidenceDigest,
    deviceStartArgvDigest: plan.deviceStartArgvDigest,
    canonicalStateDigest: lanes.canonicalStateDigest,
    preexistingLaneSetDigest: lanes.preexistingLaneSetDigest,
    postLaneSetDigest: lanes.postLaneSetDigest,
    dormantPreservationReceiptDigest: dormantReceipt.projectionDigest,
    admissionReportDigest: input.admissionReportDigest,
    admissionReceiptDigest: input.admissionReceiptDigest,
    preservationReceiptDigest: input.preservationReceiptDigest,
    mutationAuthorityReceiptDigest: mutationAuthorityProjectionDigest(input.mutationAuthorityReceipt,
      candidate, finalCloud),
    candidate,
    finalCloud: finalCloud.evidence,
  });
  return deepFreeze({ ...core, evidenceDigest: digestValue(core) });
}
export function normalizeDormantPreservationAdmissionExecutionEvidence(value) {
  requireObject(value, "Dormant-preservation execution evidence");
  const core = normalizeExecutionCore(value);
  if (value.evidenceDigest !== digestValue(core)) {
    throw new Error("Dormant-preservation execution evidence digest drifted.");
  }
  return deepFreeze({ ...core, evidenceDigest: value.evidenceDigest });
}
export function classifyDormantPreservationAdmissionExecution(value) {
  if (value == null || value.state === "pending") {
    return Object.freeze({ state: "pending", evidence: null });
  }
  return Object.freeze({ state: "complete",
    evidence: normalizeDormantPreservationAdmissionExecutionEvidence(value.evidence || value) });
}
function normalizeSourceCore(value) {
  const core = {
    schema: text(value.schema, "Source evidence schema"), controller: normalizeController(value.controller),
    canonical: normalizeCanonical(value.canonical), candidate: normalizeCandidate(value.candidate),
    cloudDecision: normalizeCloudDecision(value.cloudDecision), preservation: normalizePreservation(value.preservation),
  };
  if (core.schema !== DORMANT_PRESERVATION_ADMISSION_SOURCE_EVIDENCE_SCHEMA) {
    throw new Error("Dormant-preservation source evidence schema is unsupported.");
  }
  return deepFreeze(core);
}
function normalizeController(value) {
  requireObject(value, "Protected controller");
  const result = {
    path: absolutePath(value.path, "Controller path"), origin: text(value.origin, "Controller origin"),
    headSha: sha(value.headSha, "Controller HEAD"), originMainSha: sha(value.originMainSha, "Controller origin/main"),
    remoteMainSha: sha(value.remoteMainSha, "Controller remote main"), treeSha: sha(value.treeSha, "Controller tree"),
    clean: value.clean, deviceBranchScriptDigest: digest(value.deviceBranchScriptDigest, "device:branch script digest"),
  };
  if (result.clean !== true || result.headSha !== result.originMainSha
    || result.headSha !== result.remoteMainSha) {
    throw new Error("Protected controller must be clean and current at protected main.");
  }
  return Object.freeze(result);
}
function normalizeCanonical(value) {
  requireObject(value, "Canonical repository evidence");
  const result = {
    repositoryPath: absolutePath(value.repositoryPath, "Canonical repository path"),
    canonicalPath: absolutePath(value.canonicalPath, "Canonical path"), origin: text(value.origin, "Canonical origin"),
    targetRepository: repository(value.targetRepository, "Target repository"), headSha: sha(value.headSha, "Canonical HEAD"),
    originMainSha: sha(value.originMainSha, "Canonical origin/main"), remoteMainSha: sha(value.remoteMainSha, "Canonical remote main"),
    treeSha: sha(value.treeSha, "Canonical tree"), clean: value.clean,
    canonicalSourceDisposition: text(value.canonicalSourceDisposition, "Canonical source disposition"), canonicalLaneStateDigest: digest(value.canonicalLaneStateDigest, "Canonical state digest"),
    registryDigest: digest(value.registryDigest, "Registry digest"), laneSetDigest: digest(value.laneSetDigest, "Lane-set digest"),
    existingLanes: boundedArray(value.existingLanes, "Existing lanes", true).map((lane, index) => {
      requireObject(lane, `Existing lane ${index}`);
      return Object.freeze({ path: absolutePath(lane.path, `Existing lane ${index} path`), stateDigest: digest(lane.stateDigest, `Existing lane ${index} state digest`) });
    }).sort((left, right) => left.path.localeCompare(right.path)),
  };
  unique(result.existingLanes.map(lane => lane.path), "Existing lane path");
  if (result.repositoryPath !== result.canonicalPath || result.headSha !== result.originMainSha
    || result.headSha !== result.remoteMainSha || result.clean !== true
    || result.canonicalSourceDisposition !== "exact" || githubRepositoryFromOrigin(result.origin) !== result.targetRepository.toLowerCase()) {
    throw new Error("Canonical repository must be its clean current protected-main checkout.");
  }
  return Object.freeze(result);
}
function normalizeCandidate(value) {
  requireObject(value, "Candidate evidence");
  const manifest = canonicalObject(value.manifest, "Candidate manifest");
  const cloudAuthority = stableCandidateCloudAuthority(value.cloudAuthority);
  const candidateClaim = normalizeCloudClaim(value.candidateClaim, "candidate");
  const result = {
    semanticScope: text(value.semanticScope, "Candidate semantic scope"), deviceId: text(value.deviceId, "Candidate device ID"),
    branch: text(value.branch, "Candidate branch"), sessionId: text(value.sessionId, "Candidate session ID"),
    targetPath: absolutePath(value.targetPath, "Candidate target path"), targetObservationDigest: digest(value.targetObservationDigest, "Candidate target observation digest"),
    ttlSeconds: positiveInteger(value.ttlSeconds, "Candidate TTL"), selectionPath: absolutePath(value.selectionPath, "Selection path"),
    selectionFileDigest: digest(value.selectionFileDigest, "Selection file digest"), manifestPath: absolutePath(value.manifestPath, "Manifest path"),
    manifestFileDigest: digest(value.manifestFileDigest, "Manifest file digest"), manifest,
    cloudAuthorityPath: absolutePath(value.cloudAuthorityPath, "Cloud authority path"), cloudAuthorityFileDigest: digest(value.cloudAuthorityFileDigest, "Cloud authority file digest"),
    cloudAuthority, candidateClaim, candidateClaimRecordDigest: digest(value.candidateClaimRecordDigest, "Candidate claim record digest"),
  };
  if (candidateClaim.recordDigest !== result.candidateClaimRecordDigest
    || result.branch !== `agent/${result.deviceId}/${result.semanticScope}`
    || (manifest.semanticScope && manifest.semanticScope !== result.semanticScope)
    || (cloudAuthority.claimId && cloudAuthority.claimId !== candidateClaim.claimId)
    || !ownerIdentifierMatches("device", candidateClaim.deviceId, result.deviceId)
    || !ownerIdentifierMatches("session", candidateClaim.sessionId, result.sessionId)
    || !ownerIdentifierMatches("device", cloudAuthority.deviceId, result.deviceId)
    || !ownerIdentifierMatches("session", cloudAuthority.sessionId, result.sessionId)
    || (candidateClaim.deviceId && cloudAuthority.deviceId
      && cloudAuthority.deviceId !== candidateClaim.deviceId)
    || (candidateClaim.sessionId && cloudAuthority.sessionId
      && cloudAuthority.sessionId !== candidateClaim.sessionId)
    || (manifest.writeSetDigest && manifest.writeSetDigest !== candidateClaim.writeSetDigest)
    || (cloudAuthority.writeSetDigest && cloudAuthority.writeSetDigest !== candidateClaim.writeSetDigest)
    || (cloudAuthority.claimDigest && cloudAuthority.claimDigest !== candidateClaim.fenceRevision)
    || (cloudAuthority.claimLedgerRevision
      && cloudAuthority.claimLedgerRevision !== candidateClaim.transitionDigest)
    || (cloudAuthority.canonicalBaseSha
      && cloudAuthority.canonicalBaseSha !== candidateClaim.canonicalBaseRevision)
    || (cloudAuthority.laneRevision && cloudAuthority.laneRevision !== candidateClaim.laneRevision)
    || (cloudAuthority.leaseEpoch && cloudAuthority.leaseEpoch !== candidateClaim.leaseEpoch)
    || (cloudAuthority.transitionCounter
      && cloudAuthority.transitionCounter !== candidateClaim.transitionCounter)
    || (cloudAuthority.expiresAt && cloudAuthority.expiresAt !== candidateClaim.expiresAt)
    || (Object.hasOwn(cloudAuthority, "reviewRequestId")
      && (cloudAuthority.reviewRequestId ?? null) !== (candidateClaim.reviewRequestId ?? null))) {
    throw new Error("Candidate files and claim do not describe one exact admission candidate.");
  }
  return deepFreeze(result);
}
function canonicalOwnerIdentifier(namespace, value) {
  const source = text(value, `Candidate ${namespace} identity`);
  const prefix = `${namespace}:`;
  return source.startsWith(prefix) && DIGEST_PATTERN.test(source.slice(prefix.length))
    ? source : pseudonymousIdentifier(namespace, source);
}
function ownerIdentifierMatches(namespace, projected, raw) {
  if (!projected) return true;
  const value = text(projected, `Candidate ${namespace} projection`);
  return value.startsWith(`${namespace}:`)
    ? value === canonicalOwnerIdentifier(namespace, raw)
    : value === raw;
}
function buildPreservation(projection, selection) {
  const receipt = projection.receipt;
  const selectedLanes = selection.lanes.map((lane) => {
    const worktree = receipt.worktrees.find(item => item.path === lane.worktreePath);
    if (!worktree) throw new Error(`Selected dormant lane is absent from preservation receipt: ${lane.worktreePath}`);
    const pullRequest = lane.pullRequest == null ? null : receipt.pullRequests.find(item => (
      item.number === lane.pullRequest || item.url === lane.pullRequest
    ));
    if (lane.pullRequest != null && (!pullRequest || worktree.detached || pullRequest.headSha !== worktree.headSha
      || pullRequest.branch !== worktree.branch.replace(/^refs\/heads\//u, "")
      || pullRequest.headRepository !== receipt.repository.nameWithOwner)) {
      throw new Error(`Selected dormant pull request is absent or mismatched: ${lane.pullRequest}`); }
    const core = { path: lane.worktreePath, stateDigest: worktree.stateDigest, worktree, pullRequest };
    return deepFreeze({ ...core, selectionDigest: digestValue(core) });
  });
  const selectedPullRequests = selectedLanes
    .map(lane => lane.pullRequest?.number).filter(value => value != null).sort((left, right) => left - right);
  if (canonicalJson(selectedLanes.map(lane => lane.path).sort())
      !== canonicalJson(receipt.worktrees.map(worktree => worktree.path).sort())
    || canonicalJson(selectedPullRequests)
      !== canonicalJson(receipt.pullRequests.map(pullRequest => pullRequest.number).sort((left, right) => left - right))) {
    throw new Error("Dormant-preservation selection does not exactly cover its receipt.");
  }
  const core = {
    authenticatedActor: receipt.authenticatedActor, repository: receipt.repository,
    sessionId: receipt.sessionId, selectedLanes,
    selectionDigest: preservationSelectionDigest(selectedLanes),
    projectionDigest: projection.projectionDigest,
  };
  return deepFreeze(core);
}
function assertReceiptInventoryJoin(receipt, remoteInventory, projectedInventory) {
  normalizeReceiptCloudObservation(receipt.cloudInventory);
  const source = remoteInventory.inventory || remoteInventory;
  if (receipt.cloudInventory.ledgerRevision !== projectedInventory.ledgerRevision
    || receipt.cloudInventory.ledgerDigest !== projectedInventory.ledgerDigest
    || receipt.cloudInventory.inventoryDigest !== digestValue(source.claims)) {
    throw new Error("Dormant-preservation receipt changed its complete cloud inventory.");
  }
}
function normalizePreservation(value) {
  requireObject(value, "Preservation evidence");
  const result = canonicalObject(value, "Preservation evidence");
  requireObject(result.authenticatedActor, "Preservation actor");
  requireObject(result.repository, "Preservation repository");
  result.authenticatedActor.actorId = text(result.authenticatedActor.actorId, "Preservation actor ID");
  result.authenticatedActor.login = text(result.authenticatedActor.login, "Preservation actor login");
  result.repository.nameWithOwner = repository(result.repository.nameWithOwner, "Preservation repository");
  result.repository.path = absolutePath(result.repository.path, "Preservation repository path");
  result.sessionId = text(result.sessionId, "Preservation session ID");
  result.selectionDigest = digest(result.selectionDigest, "Preservation selection digest");
  result.projectionDigest = digest(result.projectionDigest, "Preservation projection digest");
  result.selectedLanes = boundedArray(result.selectedLanes, "Selected dormant lanes")
    .map((lane, index) => {
      requireObject(lane, `Selected dormant lane ${index}`);
      const core = { path: absolutePath(lane.path, `Selected dormant lane ${index} path`), stateDigest: digest(lane.stateDigest, `Selected dormant lane ${index} state digest`), worktree: normalizeWorktree(lane.worktree, index), pullRequest: lane.pullRequest == null ? null : normalizePullRequest(lane.pullRequest, index) };
      if (core.path !== core.worktree.path || lane.selectionDigest !== digestValue(core)
        || core.pullRequest && (core.worktree.detached || core.pullRequest.headSha !== core.worktree.headSha
          || core.pullRequest.branch !== core.worktree.branch.replace(/^refs\/heads\//u, "")
          || core.pullRequest.headRepository !== result.repository.nameWithOwner
          || core.pullRequest.url !== `https://github.com/${result.repository.nameWithOwner}/pull/${core.pullRequest.number}`)) {
        throw new Error(`Selected dormant lane ${index} drifted.`);
      }
      return deepFreeze({ ...core, selectionDigest: lane.selectionDigest });
    }).sort((left, right) => left.path.localeCompare(right.path));
  unique(result.selectedLanes.map(lane => lane.path), "Selected dormant lane path");
  if (result.selectionDigest !== preservationSelectionDigest(result.selectedLanes)) {
    throw new Error("Selected dormant lane aggregate drifted.");
  }
  return deepFreeze(result);
}
function assertSourceJoins(source) {
  const candidate = source.candidate;
  const matches = source.cloudDecision.claims.filter(claim => claim.claimId === candidate.candidateClaim.claimId);
  if (matches.length !== 1 || matches[0].recordDigest !== candidate.candidateClaimRecordDigest
    || source.cloudDecision.candidateClaimId !== candidate.candidateClaim.claimId
    || source.cloudDecision.candidateWriteSetDigest !== candidate.candidateClaim.writeSetDigest
    || source.canonical.targetRepository !== source.preservation.repository.nameWithOwner
    || source.canonical.repositoryPath !== source.preservation.repository.path
    || source.candidate.sessionId !== source.preservation.sessionId) {
    throw new Error("Dormant-preservation source identities do not join exactly.");
  }
  const existing = new Map(source.canonical.existingLanes.map(lane => [lane.path, lane.stateDigest]));
  if (existing.get(source.canonical.canonicalPath) !== source.canonical.canonicalLaneStateDigest
    || source.canonical.laneSetDigest !== digestValue(source.canonical.existingLanes)) {
    throw new Error("Canonical lane state is absent or drifted.");
  }
  for (const selected of source.preservation.selectedLanes) {
    if (existing.get(selected.path) !== selected.stateDigest) {
      throw new Error(`Selected dormant lane state is absent or drifted: ${selected.path}`);
    }
  }
}
function normalizeCloudDecision(value) {
  requireObject(value, "Cloud decision");
  const core = {
    schema: text(value.schema, "Cloud decision schema"),
    candidateClaimId: digest(value.candidateClaimId, "Cloud decision candidate claim ID"),
    candidateWriteSetDigest: digest(
      value.candidateWriteSetDigest,
      "Cloud decision candidate write-set digest",
    ),
    selectedClaimIds: boundedArray(
      value.selectedClaimIds,
      "Cloud decision selected claim IDs",
      true,
    ).map((claimId, index) => digest(claimId, `Cloud decision selected claim ${index}`))
      .sort(),
    claims: boundedArray(value.claims, "Cloud decision claims")
      .map((claim, index) => normalizeCloudClaim(claim, index))
      .sort((left, right) => left.claimId.localeCompare(right.claimId)),
  };
  unique(core.selectedClaimIds, "Cloud decision selected claim ID");
  unique(core.claims.map(claim => claim.claimId), "Cloud decision claim identity");
  const candidate = core.claims.filter(claim => claim.claimId === core.candidateClaimId);
  if (core.schema !== CLOUD_DECISION_SCHEMA
    || candidate.length !== 1
    || candidate[0].writeSetDigest !== core.candidateWriteSetDigest
    || core.selectedClaimIds.some(claimId => !core.claims.some(claim => claim.claimId === claimId))
    || value.decisionStateDigest !== digestValue(core)) {
    throw new Error("Cloud decision drifted from its relevant claim records.");
  }
  return deepFreeze({ ...core, decisionStateDigest: value.decisionStateDigest });
}
function stableCandidateCloudAuthority(value) {
  const authority = canonicalObject(value, "Candidate cloud authority");
  delete authority.ledgerRevision;
  delete authority.ledgerDigest;
  return deepFreeze(authority);
}
function normalizeReceiptCloudObservation(value) {
  requireObject(value, "Dormant receipt cloud inventory");
  const observation = {
    ledgerRevision: sha(value.ledgerRevision, "Dormant ledger revision"),
    ledgerDigest: digest(value.ledgerDigest, "Dormant ledger digest"),
    inventoryDigest: digest(value.inventoryDigest, "Dormant inventory digest"),
    verificationReceiptDigest: digest(
      value.verificationReceiptDigest,
      "Dormant verification receipt digest",
    ),
  };
  if (canonicalJson(value) !== canonicalJson(observation)) {
    throw new Error("Dormant receipt cloud inventory has unexpected fields.");
  }
  return Object.freeze(observation);
}
function selectedAuthorityIdentity(preservation) {
  const claimIds = new Set();
  const reviewRequestIds = new Set();
  const workItemIds = new Set();
  for (const selected of preservation.selectedLanes) {
    if (selected.worktree.projectedClaimId) {
      claimIds.add(selected.worktree.projectedClaimId);
    }
    if (selected.pullRequest?.reviewRequestId) {
      reviewRequestIds.add(selected.pullRequest.reviewRequestId);
    }
    for (const branchValue of [selected.worktree.branch, selected.pullRequest?.branch]) {
      if (!branchValue) continue;
      const branch = branchValue.replace(/^refs\/heads\//u, "");
      workItemIds.add(pseudonymousIdentifier("work-item", branch));
      const identity = parseDeviceBranch(branch);
      if (identity?.scope) {
        workItemIds.add(pseudonymousIdentifier("work-item", identity.scope));
      }
    }
  }
  return Object.freeze({
    repositoryId: `github-repository:${preservation.repository.id}`,
    claimIds,
    reviewRequestIds,
    workItemIds,
  });
}
function claimMatchesSelectedAuthority(claim, identity) {
  return claim.repositoryId === identity.repositoryId && (
    identity.claimIds.has(claim.claimId)
    || identity.reviewRequestIds.has(claim.reviewRequestId)
    || identity.workItemIds.has(claim.workItemId)
  );
}
function claimMatchesCandidateLineage(claim, candidate) {
  return claim.repositoryId === candidate.repositoryId && (
    claim.workItemId === candidate.workItemId
    || (candidate.reviewRequestId != null
      && claim.reviewRequestId === candidate.reviewRequestId)
  );
}
function candidateIdentity(claim) {
  const identity = {
    claimId: claim.claimId,
    actorId: claim.actorId,
    repositoryId: claim.repositoryId,
    workItemId: claim.workItemId,
    canonicalBaseRevision: claim.canonicalBaseRevision,
    declaredWriteScope: normalizeWriteSet(claim.declaredWriteScope),
    writeSetDigest: claim.writeSetDigest,
    leaseEpoch: claim.leaseEpoch,
  };
  if (claim.entrySchema !== undefined) identity.entrySchema = claim.entrySchema;
  if (claim.claimIdentitySchema !== undefined) {
    identity.claimIdentitySchema = claim.claimIdentitySchema;
  }
  return deepFreeze(identity);
}
function normalizeProjectedInventory(value) {
  requireObject(value, "Projected cloud inventory");
  const core = {
    schema: text(value.schema, "Projected cloud inventory schema"),
    ledgerRevision: sha(value.ledgerRevision, "Projected cloud ledger revision"),
    ledgerDigest: digest(value.ledgerDigest, "Projected cloud ledger digest"),
    claims: boundedArray(value.claims, "Projected cloud claims", true)
      .map((claim, index) => normalizeCloudClaim(claim, index))
      .sort((left, right) => left.claimId.localeCompare(right.claimId)),
  };
  unique(core.claims.map(claim => claim.claimId), "Projected cloud claim identity");
  if (core.schema !== CLOUD_INVENTORY_SCHEMA || value.inventoryStateDigest !== digestValue(core)) {
    throw new Error("Projected cloud inventory drifted.");
  }
  return deepFreeze({ ...core, inventoryStateDigest: value.inventoryStateDigest });
}
function normalizeCloudClaim(value, index) {
  const claim = canonicalObject(value, `Cloud claim ${index}`);
  claim.claimId = digest(claim.claimId, `Cloud claim ${index} ID`);
  claim.recordDigest = digest(claim.recordDigest, `Cloud claim ${index} record digest`);
  claim.state = text(claim.state, `Cloud claim ${index} state`);
  if (claim.operationReceiptDigest != null) {
    claim.operationReceiptDigest = digest(claim.operationReceiptDigest, `Cloud claim ${index} operation receipt`);
  }
  const { recordDigest, ...recordCore } = claim;
  if (recordDigest !== digestValue(recordCore)) {
    throw new Error(`Cloud claim ${index} record digest drifted.`);
  }
  return deepFreeze(claim);
}
function normalizeWorktree(value, index) {
  const result = canonicalObject(value, `Dormant worktree ${index}`);
  result.path = absolutePath(result.path, `Dormant worktree ${index} path`); if (result.branch === null ? result.detached !== true : result.detached === true || result.detached != null && result.detached !== false) throw new Error(`Dormant worktree ${index} branch and detached state are inconsistent.`); result.branch = result.branch === null ? null : text(result.branch, `Dormant worktree ${index} branch`);
  result.headSha = sha(result.headSha, `Dormant worktree ${index} HEAD`); result.treeSha = sha(result.treeSha, `Dormant worktree ${index} tree`);
  result.stateDigest = digest(result.stateDigest, `Dormant worktree ${index} state digest`);
  return deepFreeze(result);
}
function normalizePullRequest(value, index) {
  const result = canonicalObject(value, `Dormant pull request ${index}`);
  result.number = positiveInteger(result.number, `Dormant pull request ${index} number`); result.url = pullRequestUrl(result.url, result.number, `Dormant pull request ${index} URL`);
  result.headSha = sha(result.headSha, `Dormant pull request ${index} head`); result.branch = text(result.branch, `Dormant pull request ${index} branch`);
  result.headRepository = repository(result.headRepository, `Dormant pull request ${index} head repository`);
  return deepFreeze(result);
}
function assertPostLaneState(value, source, candidate) {
  requireObject(value, "Post-admission lane state");
  if (!Array.isArray(value.lanes) || value.lanes.length > 129
    || value.canonicalBaseSha !== source.canonical.headSha
    || value.canonicalSourceDisposition !== "exact") {
    throw new Error("Post-admission canonical lane state is not exact-current.");
  }
  const lanes = value.lanes.map((lane, index) => {
    requireObject(lane, `Post-admission lane ${index}`);
    return { path: absolutePath(lane.path, `Post-admission lane ${index} path`),
      stateDigest: digest(lane.stateDigest, `Post-admission lane ${index} state digest`), raw: lane };
  }).sort((left, right) => left.path.localeCompare(right.path));
  unique(lanes.map(lane => lane.path), "Post-admission lane path");
  const projected = lanes.map(({ path: lanePath, stateDigest }) => ({ path: lanePath, stateDigest }));
  if (value.laneStateDigest !== digestValue(projected)) throw new Error("Post-admission lane-set digest drifted.");
  const expected = source.canonical.existingLanes;
  const preexisting = projected.filter(lane => lane.path !== candidate.path);
  const liveCandidate = lanes.find(lane => lane.path === candidate.path)?.raw;
  if (canonicalJson(preexisting) !== canonicalJson(expected)
    || lanes.length !== expected.length + 1 || !liveCandidate
    || liveCandidate.stateDigest !== candidate.stateDigest || liveCandidate.head !== candidate.headSha
    || liveCandidate.treeSha !== candidate.treeSha || liveCandidate.branch !== `refs/heads/${candidate.branch}`
    || liveCandidate.dirty || liveCandidate.invalid) {
    throw new Error("Post-admission lanes are not one candidate-only exact delta.");
  }
  const canonical = preexisting.find(lane => lane.path === source.canonical.canonicalPath);
  if (canonical?.stateDigest !== source.canonical.canonicalLaneStateDigest
    || digestValue(preexisting) !== source.canonical.laneSetDigest) {
    throw new Error("Canonical or preexisting lane state changed during admission.");
  }
  return { canonicalStateDigest: canonical.stateDigest,
    preexistingLaneSetDigest: digestValue(preexisting), postLaneSetDigest: digestValue(projected) };
}
function assertPostCloudInventory(value, source) {
  if (!isReadyRemoteInventory(value)) throw new Error("Post-admission cloud inventory is not operation-derived.");
  const inventory = projectDormantPreservationAdmissionCloudInventory(value);
  const claimId = source.candidate.candidateClaim.claimId;
  const candidate = inventory.claims.find(claim => claim.claimId === claimId);
  const decision = projectDormantPreservationAdmissionCloudDecision(
    inventory,
    source.candidate,
    source.preservation,
  );
  const peers = decision.claims.filter(claim => claim.claimId !== claimId)
    .map(claim => ({ claimId: claim.claimId, recordDigest: claim.recordDigest }));
  const expectedPeers = source.cloudDecision.claims.filter(claim => claim.claimId !== claimId)
    .map(claim => ({ claimId: claim.claimId, recordDigest: claim.recordDigest }));
  if (!candidate
    || canonicalJson(candidateIdentity(candidate))
      !== canonicalJson(candidateIdentity(source.candidate.candidateClaim))
    || canonicalJson(decision.selectedClaimIds)
      !== canonicalJson(source.cloudDecision.selectedClaimIds)
    || canonicalJson(peers) !== canonicalJson(expectedPeers)) {
    throw new Error("Post-admission relevant cloud records changed.");
  }
  return { inventory, evidence: normalizeFinalCloud({
    claimId, claimDigest: candidate.fenceRevision,
    claimTransitionDigest: candidate.transitionDigest, claimRecordDigest: candidate.recordDigest,
    ledgerRevision: inventory.ledgerRevision, ledgerDigest: inventory.ledgerDigest,
    inventoryStateDigest: inventory.inventoryStateDigest, peerSetDigest: digestValue(peers),
  }) };
}
function assertPostDormantReceipt(value, remoteInventory, inventory, source, planDigest) {
  if (!isOperationDerivedDormantPreservation(value)) {
    throw new Error("Post-admission dormant receipt is not operation-derived.");
  }
  if (value.operatorDecisionDigest !== planDigest) {
    throw new Error("Post-admission dormant receipt changed its plan decision.");
  }
  assertReceiptInventoryJoin(value, remoteInventory, inventory);
  const projection = projectDormantPreservationAdmissionReceipt(value), receipt = projection.receipt;
  const expectedWorktrees = source.preservation.selectedLanes.map(lane => lane.worktree);
  const expectedPullRequests = source.preservation.selectedLanes
    .map(lane => lane.pullRequest).filter(Boolean).sort((left, right) => left.number - right.number);
  if (canonicalJson(receipt.authenticatedActor) !== canonicalJson(source.preservation.authenticatedActor)
    || canonicalJson(receipt.repository) !== canonicalJson(source.preservation.repository)
    || receipt.sessionId !== source.preservation.sessionId
    || canonicalJson(receipt.worktrees) !== canonicalJson(expectedWorktrees)
    || canonicalJson(receipt.pullRequests) !== canonicalJson(expectedPullRequests)) {
    throw new Error("Post-admission dormant selection or pull request changed.");
  }
  return projection;
}
function mutationAuthorityProjectionDigest(value, candidate, finalCloud) {
  const receipt = canonicalObject(value, "Mutation authority receipt");
  exactKeys(receipt, ["claimDigest", "claimId", "cloudVerificationReceiptDigest", "evaluatedAt", "expiresAt", "ledgerRevision", "localFenceSha", "localLeaseEpoch", "receiptDigest", "remoteLeaseEpoch", "schema", "status"], "Mutation authority receipt");
  const receiptDigest = digest(receipt.receiptDigest, "Mutation authority receipt digest"); delete receipt.receiptDigest;
  if (receipt.schema !== "agentic-admission-mutation-authority/v1" || receipt.status !== "ready"
    || receiptDigest !== digestValue(receipt) || digest(receipt.claimId, "Mutation claim ID") !== finalCloud.evidence.claimId
    || digest(receipt.claimDigest, "Mutation claim digest") !== finalCloud.evidence.claimDigest
    || sha(receipt.ledgerRevision, "Mutation ledger revision") !== finalCloud.evidence.ledgerRevision
    || sha(receipt.localFenceSha, "Mutation local fence") !== candidate.headSha
    || positiveInteger(receipt.localLeaseEpoch, "Mutation local lease epoch") !== candidate.leaseEpoch
    || positiveInteger(receipt.remoteLeaseEpoch, "Mutation remote lease epoch") !== finalCloud.inventory.claims.find(claim => claim.claimId === receipt.claimId)?.leaseEpoch) {
    throw new Error("Mutation authority receipt is unsealed or changed the admitted candidate authority.");
  }
  digest(receipt.cloudVerificationReceiptDigest, "Mutation cloud verification receipt");
  text(receipt.evaluatedAt, "Mutation evaluated instant"); text(receipt.expiresAt, "Mutation expiry instant");
  const { evaluatedAt: ignoredInstant, cloudVerificationReceiptDigest: ignoredObservation, ...stable } = receipt;
  return digestValue(stable);
}
function normalizeExecutionCore(value) {
  const core = {
    schema: text(value.schema, "Execution evidence schema"), status: text(value.status, "Execution status"),
    planDigest: digest(value.planDigest, "Execution plan digest"), operationKey: digest(value.operationKey, "Execution operation key"),
    sourceEvidenceDigest: digest(value.sourceEvidenceDigest, "Execution source evidence digest"), deviceStartArgvDigest: digest(value.deviceStartArgvDigest, "Execution argv digest"),
    canonicalStateDigest: digest(value.canonicalStateDigest, "Execution canonical state digest"), preexistingLaneSetDigest: digest(value.preexistingLaneSetDigest, "Execution lane-set digest"),
    postLaneSetDigest: digest(value.postLaneSetDigest, "Execution post lane-set digest"),
    dormantPreservationReceiptDigest: digest(value.dormantPreservationReceiptDigest, "Dormant receipt digest"), admissionReportDigest: digest(value.admissionReportDigest, "Admission report digest"),
    admissionReceiptDigest: digest(value.admissionReceiptDigest, "Admission receipt digest"), preservationReceiptDigest: digest(value.preservationReceiptDigest, "Preservation receipt digest"),
    mutationAuthorityReceiptDigest: digest(value.mutationAuthorityReceiptDigest, "Mutation authority receipt digest"),
    candidate: normalizeExecutionCandidate(value.candidate), finalCloud: normalizeFinalCloud(value.finalCloud),
  };
  if (core.schema !== DORMANT_PRESERVATION_ADMISSION_EXECUTION_EVIDENCE_SCHEMA
    || core.status !== "admitted") throw new Error("Execution evidence is not an admitted result.");
  return deepFreeze(core);
}
function normalizeExecutionCandidate(value) {
  requireObject(value, "Executed candidate");
  return deepFreeze({
    path: absolutePath(value.path, "Executed candidate path"), branch: text(value.branch, "Executed candidate branch"),
    headSha: sha(value.headSha, "Executed candidate HEAD"), treeSha: sha(value.treeSha, "Executed candidate tree"), parentSha: sha(value.parentSha, "Executed candidate parent"), parentCount: positiveInteger(value.parentCount, "Executed candidate parent count"), stateDigest: digest(value.stateDigest, "Executed candidate state digest"),
    leaseDigest: digest(value.leaseDigest, "Executed candidate lease digest"), leaseEpoch: positiveInteger(value.leaseEpoch, "Executed candidate lease epoch"),
    sessionId: text(value.sessionId, "Executed candidate session ID"), pullRequestNumber: positiveInteger(value.pullRequestNumber, "Executed candidate pull request number"),
    pullRequestNodeId: text(value.pullRequestNodeId, "Executed candidate pull request node ID"), pullRequestUrl: pullRequestUrl(value.pullRequestUrl, value.pullRequestNumber, "Executed candidate pull request URL"),
    pullRequestHeadSha: sha(value.pullRequestHeadSha, "Executed candidate pull request head"),
  });
}
function normalizeFinalCloud(value) {
  requireObject(value, "Final cloud evidence");
  return deepFreeze({
    claimId: digest(value.claimId, "Final claim ID"), claimDigest: digest(value.claimDigest, "Final claim digest"),
    claimTransitionDigest: digest(value.claimTransitionDigest, "Final claim transition digest"), claimRecordDigest: digest(value.claimRecordDigest, "Final claim record digest"),
    ledgerRevision: sha(value.ledgerRevision, "Final ledger revision"), ledgerDigest: digest(value.ledgerDigest, "Final ledger digest"),
    inventoryStateDigest: digest(value.inventoryStateDigest, "Final inventory-state digest"), peerSetDigest: digest(value.peerSetDigest, "Final peer-set digest"),
  });
}
function boundedArray(value, label, allowEmpty = false) {
  if (!Array.isArray(value) || value.length > 128 || (!allowEmpty && value.length === 0)) throw new Error(`${label} must contain ${allowEmpty ? "0 to" : "1 to"} 128 items.`);
  return value;
}
function canonicalObject(value, label) { requireObject(value, label); return canonicalClone(value); }
function canonicalClone(value) { return JSON.parse(canonicalJson(value)); }
function preservationSelectionDigest(lanes) {
  return digestValue({ schema: DORMANT_PRESERVATION_ADMISSION_SELECTION_SCHEMA,
    lanes: lanes.map(lane => ({
      path: lane.path, stateDigest: lane.stateDigest,
      pullRequestNumber: lane.pullRequest?.number ?? null, selectionDigest: lane.selectionDigest,
    })),
  });
}
function selectionKey(value) { return `${value.worktreePath}\u0000${value.pullRequest ?? ""}`; }
function pullRequestReference(value, label) {
  if (value == null) return null; if (Number.isSafeInteger(value)) return positiveInteger(value, label);
  const reference = text(value, label); if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/u.test(reference)) throw new Error(`${label} must be a positive integer or canonical GitHub pull-request URL.`);
  return reference; }
function pullRequestUrl(value, number, label) {
  const normalized = text(value, label), match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/([1-9][0-9]*)$/u.exec(normalized);
  if (!match || Number(match[2]) !== number) throw new Error(`${label} must be the canonical URL for pull request ${number}.`);
  return normalized; }
function absolutePath(value, label) { const normalized = text(value, label);
  if (!path.isAbsolute(normalized) || path.normalize(normalized) !== normalized) throw new Error(`${label} must be an absolute normalized path.`);
  return normalized; }
function repository(value, label) { const normalized = text(value, label);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(normalized)) throw new Error(`${label} must use owner/repository form.`);
  return normalized; }
function githubRepositoryFromOrigin(value) {
  const match = /^(?:git@github\.com:|https:\/\/github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/u.exec(text(value, "Canonical origin"));
  if (!match) throw new Error("Canonical origin must be one canonical GitHub SSH or HTTPS repository URL.");
  return `${match[1]}/${match[2]}`.toLowerCase();
}
function sha(value, label) { const normalized = text(value, label);
  if (!SHA_PATTERN.test(normalized)) throw new Error(`${label} must be a lowercase SHA.`); return normalized; }
function digest(value, label) { const normalized = text(value, label);
  if (!DIGEST_PATTERN.test(normalized)) throw new Error(`${label} must be a SHA-256 digest.`); return normalized; }
function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`); return value; }
function text(value, label) {
  if (typeof value !== "string" || value !== value.normalize("NFC") || !value.trim() || value !== value.trim()) throw new Error(`${label} must be canonical non-empty text.`);
  return value;
}
function unique(values, label) { if (new Set(values).size !== values.length) throw new Error(`${label} values must be unique.`); }
function exactKeys(value, keys, label) {
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) throw new Error(`${label} has unexpected or missing fields.`);
}
function requireObject(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`); }
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child); return Object.freeze(value); }
