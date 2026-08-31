// Responsibility: Seal the exact active owner, unpublished descendant, dirt, and target scope.
import path from "node:path";

import {
  canonicalJson,
  digestValue,
  normalizeWriteSet,
} from "./cloud-collaboration-primitives.mjs";
import { normalizeActiveOwnedDirtEvidence }
  from "./active-owned-dirt-recovery-evidence.mjs";
import { normalizeDeclaredWriteScopeManifest }
  from "./scoped-lane-admission-lib.mjs";
import { assertTaskAuthorityBinding }
  from "./task-bound-lane-authority-contract.mjs";
import { writerLeaseDigest }
  from "./writer-lease-registry-cas.mjs";

export const EVIDENCE_SCHEMA =
  "agentic-active-descendant-untracked-scope-recovery-evidence/v1";
export const OWNER_STOP_SCHEMA =
  "agentic-active-descendant-untracked-owner-stop/v1";
export const TARGET_AVAILABILITY_SCHEMA =
  "agentic-active-descendant-untracked-target-availability/v1";

const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;

export function buildActiveDescendantUntrackedScopeRecoveryEvidence(input = {}) {
  const core = normalizeCore({ ...input, schema: EVIDENCE_SCHEMA });
  return deepFreeze({ ...core, evidenceDigest: digestValue(core) });
}

export function normalizeActiveDescendantUntrackedScopeRecoveryEvidence(value) {
  record(value, "recovery evidence");
  const core = normalizeCore(value);
  const normalized = { ...core,
    evidenceDigest: digest(value.evidenceDigest, "evidence digest") };
  if (normalized.evidenceDigest !== digestValue(core)
    || canonicalJson(normalized) !== canonicalJson(value)) {
    invalid("canonical evidence or digest");
  }
  return deepFreeze(normalized);
}

export function buildActiveDescendantUntrackedOwnerStopEvidence({
  sourceSessionId,
  sourceBranch,
  sourceHeadSha,
  sourceFenceSha,
  untrackedPaths,
  stoppedAt,
} = {}) {
  const core = normalizeOwnerStop({
    schema: OWNER_STOP_SCHEMA,
    sourceSessionId,
    sourceBranch,
    sourceHeadSha,
    sourceFenceSha,
    untrackedPaths,
    stoppedAt,
  });
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

export function buildActiveDescendantUntrackedTargetAvailabilityEvidence({
  sourceClaimId,
  targetWriteSetDigest,
  absentPaths,
  inventoryDigest,
  verificationReceiptDigest,
  observedAt,
} = {}) {
  const core = normalizeTargetAvailability({
    schema: TARGET_AVAILABILITY_SCHEMA,
    sourceClaimId,
    targetWriteSetDigest,
    absentPaths,
    headAbsent: true,
    indexAbsent: true,
    worktreeAbsent: true,
    competingClaimIds: [],
    inventoryDigest,
    verificationReceiptDigest,
    observedAt,
  });
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

export function stableActiveDescendantUntrackedEvidenceDigest(value) {
  return normalizeActiveDescendantUntrackedScopeRecoveryEvidence(value).evidenceDigest;
}

function normalizeCore(value) {
  if (value.schema !== EVIDENCE_SCHEMA) invalid("evidence schema");
  const lease = normalizeLease(value.lease);
  const lane = normalizeLane(value.lane);
  const registry = normalizeRegistry(value.registry, lease);
  const claim = normalizeClaim(value.claim);
  const pullRequest = normalizePullRequest(value.pullRequest);
  const dirt = normalizeActiveOwnedDirtEvidence(value.dirt);
  const ownerStop = normalizeOwnerStopReceipt(value.ownerStop);
  const targetManifest = normalizeDeclaredWriteScopeManifest(value.targetManifest, {
    expectedScope: lease.scope,
  });
  const targetAvailability = normalizeTargetAvailabilityReceipt(value.targetAvailability);
  const controller = normalizeController(value.controller);
  const mutationBoundary = normalizeMutationBoundary(value.mutationBoundary);
  const core = {
    schema: EVIDENCE_SCHEMA,
    repository: text(value.repository, "repository"),
    authorityRepository: text(value.authorityRepository, "authority repository"),
    observedAt: instant(value.observedAt, "observed instant"),
    lane,
    lease,
    leaseDigest: writerLeaseDigest(lease),
    taskAuthorityBindingDigest: assertTaskAuthorityBinding({
      binding: lease.taskAuthority,
      lease,
    }).bindingDigest,
    registry,
    claim,
    pullRequest,
    dirt,
    ownerStop,
    targetManifest,
    targetAvailability,
    controller,
    mutationBoundary,
  };
  assertJoins(core);
  return deepFreeze(core);
}

function normalizeLane(value) {
  const source = record(value, "lane descendant");
  const changedPaths = paths(source.changedPaths, "descendant changed paths");
  const result = {
    schema: text(source.schema, "lane schema"),
    status: text(source.status, "lane status"),
    branch: text(source.branch, "lane branch"),
    scope: text(source.scope, "lane scope"),
    sessionId: text(source.sessionId, "lane session"),
    device: text(source.device, "lane device"),
    worktreeIdentityDigest: digest(source.worktreeIdentityDigest,
      "worktree identity digest"),
    baseSha: sha(source.baseSha, "lane base"),
    remoteFenceSha: sha(source.remoteFenceSha, "remote fence"),
    headSha: sha(source.headSha, "descendant HEAD"),
    headTreeSha: sha(source.headTreeSha, "descendant tree"),
    linearDescendant: source.linearDescendant === true,
    headPublished: source.headPublished === false ? false : invalid("unpublished HEAD"),
    commitCount: positive(source.commitCount, "descendant commit count"),
    commitInventoryDigest: digest(source.commitInventoryDigest,
      "descendant commit inventory"),
    rangeDiffDigest: digest(source.rangeDiffDigest, "descendant range diff"),
    changedPaths,
  };
  if (result.schema !== "agentic-clean-unpublished-descendant/v1"
    || result.status !== "clean-unpublished-descendant"
    || !result.linearDescendant || result.headSha === result.remoteFenceSha
    || changedPaths.length === 0) invalid("clean unpublished descendant");
  return deepFreeze(result);
}

function normalizeLease(value) {
  const source = structuredClone(record(value, "writer lease"));
  const admission = record(source.admission, "source admission");
  const declaredWriteSet = normalizeWriteSet(admission.declaredWriteSet);
  if (source.schema !== "agentic-writer-lease/v2" || source.status !== "active"
    || !source.taskAuthority || !source.cloudAuthority
    || admission.schema !== "agentic-lane-admission-lease/v1"
    || admission.status !== "admitted") invalid("active admitted writer lease");
  source.epoch = positive(source.epoch, "lease epoch");
  source.sessionId = text(source.sessionId, "lease session");
  source.device = text(source.device, "lease device");
  source.scope = text(source.scope, "lease scope");
  source.branch = text(source.branch, "lease branch");
  source.baseSha = sha(source.baseSha, "lease base");
  source.fenceSha = sha(source.fenceSha, "lease fence");
  source.pullRequestUrl = text(source.pullRequestUrl, "lease pull-request URL");
  source.admission = { ...admission, semanticScope: text(admission.semanticScope,
    "admission scope"), declaredWriteSet,
  writeSetDigest: digest(admission.writeSetDigest, "admission write-set digest"),
  manifestDigest: digest(admission.manifestDigest, "admission manifest digest") };
  if (source.admission.semanticScope !== source.scope
    || source.admission.writeSetDigest !== digestValue(declaredWriteSet)
    || !declaredWriteSet.includes(`semantic:${source.scope}`)) {
    invalid("source admission projection");
  }
  assertTaskAuthorityBinding({ binding: source.taskAuthority, lease: source });
  return deepFreeze(source);
}

function normalizeRegistry(value, lease) {
  const envelope = record(value, "writer registry");
  const source = structuredClone(envelope.snapshot);
  if (!source || source.schema !== "agentic-writer-lease-registry/v2"
    || !Number.isSafeInteger(source.revision) || source.revision < 0
    || !source.leases || typeof source.leases !== "object" || Array.isArray(source.leases)
    || canonicalJson(source.leases[lease.branch]) !== canonicalJson(lease)) {
    invalid("writer registry lease join");
  }
  const result = { snapshot: source, revision: source.revision,
    registryDigest: digestValue(source), leaseDigest: writerLeaseDigest(lease) };
  if (envelope.revision !== result.revision
    || envelope.registryDigest !== result.registryDigest
    || envelope.leaseDigest !== result.leaseDigest) invalid("writer registry projection");
  return deepFreeze(result);
}

function normalizeClaim(value) {
  const source = record(value, "cloud claim");
  const declaredWriteScope = normalizeWriteSet(source.declaredWriteScope);
  const result = {
    schema: text(source.schema, "claim schema"),
    state: source.state,
    writeAuthority: source.writeAuthority === true,
    scopeReserved: source.scopeReserved === true,
    claimId: digest(source.claimId, "claim ID"),
    claimDigest: digest(source.fenceRevision ?? source.claimDigest, "claim digest"),
    claimLedgerRevision: digest(source.transitionDigest ?? source.claimLedgerRevision,
      "claim ledger revision"),
    operationReceiptDigest: digest(source.operationReceiptDigest,
      "claim operation receipt"),
    actorId: text(source.actorId, "claim actor"),
    repositoryId: text(source.repositoryId, "claim repository"),
    workItemId: text(source.workItemId, "claim work item"),
    predecessorClaimId: optionalDigest(source.predecessorClaimId,
      "predecessor claim ID"),
    canonicalBaseRevision: sha(source.canonicalBaseRevision, "claim base"),
    laneRevision: sha(source.laneRevision, "claim lane revision"),
    declaredWriteScope,
    writeSetDigest: digest(source.writeSetDigest, "claim write-set digest"),
    leaseEpoch: positive(source.leaseEpoch, "claim lease epoch"),
    transitionCounter: positive(source.transitionCounter, "claim transition counter"),
    heartbeatCounter: nonnegative(source.heartbeatCounter ?? 0, "claim heartbeat counter"),
    reviewRequestId: text(source.reviewRequestId, "claim review request"),
    expiresAt: instant(source.expiresAt, "claim expiry"),
    ledgerRevision: sha(source.ledgerRevision, "ledger revision"),
    ledgerDigest: digest(source.ledgerDigest, "ledger digest"),
    inventoryDigest: digest(source.inventoryDigest, "claim inventory digest"),
    verificationReceiptDigest: digest(source.verificationReceiptDigest,
      "claim verification receipt"),
  };
  if (result.schema !== "agentic-current-cloud-claim-evidence/v1"
    || result.state !== "current" || !result.writeAuthority || !result.scopeReserved
    || result.writeSetDigest !== digestValue(declaredWriteScope)) {
    invalid("current cloud claim");
  }
  return deepFreeze(result);
}

function normalizePullRequest(value) {
  const source = record(value, "pull request");
  const result = {
    schema: text(source.schema, "pull-request schema"),
    adapterId: text(source.adapterId, "review adapter"),
    repository: text(source.repository, "review repository"),
    id: text(source.id, "pull-request ID"),
    nodeId: text(source.nodeId, "pull-request node ID"),
    number: positive(source.number, "pull-request number"),
    url: text(source.url, "pull-request URL"),
    state: source.state,
    draft: source.draft === true,
    autoDelivery: source.autoDelivery ?? null,
    branch: text(source.branch, "pull-request branch"),
    headSha: sha(source.headSha, "pull-request head"),
    baseSha: sha(source.baseSha, "pull-request base"),
    bodyDigest: digest(source.bodyDigest, "pull-request body digest"),
    bodyRemainderDigest: digest(source.bodyRemainderDigest,
      "pull-request body remainder digest"),
    markerDigest: digest(source.markerDigest, "pull-request marker digest"),
    observedAt: instant(source.observedAt, "pull-request observed instant"),
  };
  if (result.schema !== "agentic-draft-review-subject/v1" || result.state !== "open"
    || !result.draft || result.autoDelivery !== null) {
    invalid("open draft review subject");
  }
  return deepFreeze(result);
}

function normalizeOwnerStopReceipt(value) {
  const core = normalizeOwnerStop(value);
  if (digest(value.receiptDigest, "owner-stop receipt") !== digestValue(core)) {
    invalid("owner-stop receipt digest");
  }
  return deepFreeze({ ...core, receiptDigest: value.receiptDigest });
}

function normalizeOwnerStop(value) {
  const source = record(value, "owner-stop evidence");
  const result = {
    schema: source.schema,
    sourceSessionId: text(source.sourceSessionId, "owner-stop session"),
    sourceBranch: text(source.sourceBranch, "owner-stop branch"),
    sourceHeadSha: sha(source.sourceHeadSha, "owner-stop HEAD"),
    sourceFenceSha: sha(source.sourceFenceSha, "owner-stop fence"),
    untrackedPaths: paths(source.untrackedPaths, "owner-stopped paths"),
    stoppedAt: instant(source.stoppedAt, "owner-stop instant"),
  };
  if (result.schema !== OWNER_STOP_SCHEMA || result.untrackedPaths.length === 0) {
    invalid("explicit owner stop");
  }
  return deepFreeze(result);
}

function normalizeTargetAvailabilityReceipt(value) {
  const core = normalizeTargetAvailability(value);
  if (digest(value.receiptDigest, "target availability receipt") !== digestValue(core)) {
    invalid("target availability receipt digest");
  }
  return deepFreeze({ ...core, receiptDigest: value.receiptDigest });
}

function normalizeTargetAvailability(value) {
  const source = record(value, "target availability");
  const result = {
    schema: source.schema,
    sourceClaimId: digest(source.sourceClaimId, "availability source claim"),
    targetWriteSetDigest: digest(source.targetWriteSetDigest,
      "availability target write set"),
    absentPaths: paths(source.absentPaths, "future absent paths", true),
    headAbsent: source.headAbsent,
    indexAbsent: source.indexAbsent,
    worktreeAbsent: source.worktreeAbsent,
    competingClaimIds: digests(source.competingClaimIds, "competing claim IDs", true),
    inventoryDigest: digest(source.inventoryDigest, "availability inventory"),
    verificationReceiptDigest: digest(source.verificationReceiptDigest,
      "availability verification receipt"),
    observedAt: instant(source.observedAt, "availability observed instant"),
  };
  if (result.schema !== TARGET_AVAILABILITY_SCHEMA || result.headAbsent !== true
    || result.indexAbsent !== true || result.worktreeAbsent !== true
    || result.competingClaimIds.length !== 0) invalid("absent competitor-free target");
  return deepFreeze(result);
}

function normalizeController(value) {
  const source = record(value, "controller evidence");
  const result = {
    repository: text(source.repository, "controller repository"),
    branch: text(source.branch, "controller branch"),
    baseSha: sha(source.baseSha, "controller base"),
    headSha: sha(source.headSha, "controller HEAD"),
    remoteHeadSha: sha(source.remoteHeadSha, "controller remote head"),
    treeSha: sha(source.treeSha, "controller tree"),
    clean: source.clean === true,
    published: source.published === true,
    leaseDigest: digest(source.leaseDigest, "controller lease digest"),
    claimId: digest(source.claimId, "controller claim ID"),
    claimDigest: digest(source.claimDigest, "controller claim digest"),
    transitionCounter: positive(source.transitionCounter, "controller transition"),
    writeSetDigest: digest(source.writeSetDigest, "controller write-set digest"),
    taskAuthorityBindingDigest: digest(source.taskAuthorityBindingDigest,
      "controller task-authority binding"),
    implementationDigest: digest(source.implementationDigest,
      "controller implementation digest"),
  };
  if (!result.clean || !result.published || result.headSha !== result.remoteHeadSha
    || result.headSha === result.baseSha) invalid("clean admitted published controller");
  return deepFreeze(result);
}

function normalizeMutationBoundary(value) {
  const source = record(value, "mutation boundary");
  const allowed = ["privateJournal", "taskAuthorityProof", "cloudSuccessorClaim",
    "cloudSourceRetirement", "cloudSuccessorPromotion", "cloudReviewBinding",
    "writerRegistryCas"];
  const forbidden = ["sourceBytes", "index", "head", "localRef", "remoteRef",
    "commit", "push", "pullRequestBody", "pullRequestMarker", "pullRequestState",
    "reviewAuthority", "integration", "deployment", "cleanup"];
  if (allowed.some(key => source[key] !== true)
    || forbidden.some(key => source[key] !== false)) invalid("mutation boundary");
  return deepFreeze(Object.fromEntries([...allowed, ...forbidden]
    .map(key => [key, source[key]])));
}

function assertJoins(value) {
  const { lane, lease, registry, claim, pullRequest, dirt, ownerStop,
    targetManifest, targetAvailability } = value;
  const sourceWriteSet = lease.admission.declaredWriteSet;
  const targetWriteSet = targetManifest.declaredWriteSet;
  const additions = targetWriteSet.filter(item => !sourceWriteSet.includes(item));
  const additionPaths = additions.map(item => item.startsWith("path:")
    ? item.slice(5) : invalid("target path-only additions"));
  const tracked = dirt.entries.filter(entry => !entry.untracked);
  const untracked = dirt.entries.filter(entry => entry.untracked);
  const untrackedPaths = untracked.map(entry => entry.path).sort();
  const absentPaths = additionPaths.filter(item => !untrackedPaths.includes(item)).sort();
  if (lane.branch !== lease.branch || lane.scope !== lease.scope
    || lane.sessionId !== lease.sessionId || lane.device !== lease.device
    || lane.baseSha !== lease.baseSha || lane.remoteFenceSha !== lease.fenceSha
    || lane.headSha !== dirt.headSha || registry.leaseDigest !== value.leaseDigest
    || claim.claimId !== lease.cloudAuthority.claimId
    || claim.claimDigest !== lease.cloudAuthority.claimDigest
    || claim.transitionCounter !== lease.cloudAuthority.transitionCounter
    || claim.canonicalBaseRevision !== lease.baseSha
    || claim.laneRevision !== lane.remoteFenceSha
    || claim.writeSetDigest !== lease.admission.writeSetDigest
    || canonicalJson(claim.declaredWriteScope) !== canonicalJson(sourceWriteSet)
    || claim.reviewRequestId !== pullRequest.id
    || pullRequest.url !== lease.pullRequestUrl || pullRequest.branch !== lease.branch
    || pullRequest.headSha !== lane.remoteFenceSha
    || pullRequest.repository !== value.repository
    || ownerStop.sourceSessionId !== lease.sessionId
    || ownerStop.sourceBranch !== lane.branch
    || ownerStop.sourceHeadSha !== lane.headSha
    || ownerStop.sourceFenceSha !== lane.remoteFenceSha
    || canonicalJson(ownerStop.untrackedPaths) !== canonicalJson(untrackedPaths)
    || targetAvailability.sourceClaimId !== claim.claimId
    || targetAvailability.targetWriteSetDigest !== targetManifest.writeSetDigest
    || canonicalJson(targetAvailability.absentPaths) !== canonicalJson(absentPaths)
    || tracked.length === 0 || untracked.length === 0
    || !(sourceWriteSet.length < targetWriteSet.length
      && sourceWriteSet.every(item => targetWriteSet.includes(item)))
    || additions.length === 0 || additions.length !== additionPaths.length
    || !lane.changedPaths.every(item => covers(sourceWriteSet, item))
    || !tracked.every(entry => covers(sourceWriteSet, entry.path))
    || untracked.some(entry => covers(sourceWriteSet, entry.path))
    || !untracked.every(entry => additionPaths.includes(entry.path))) {
    invalid("source, dirt, owner-stop, and strict-superset joins");
  }
}

function covers(writeSet, candidate) {
  return writeSet.some(item => item.startsWith("path:")
    && (item.slice(5) === "." || candidate === item.slice(5)
      || candidate.startsWith(`${item.slice(5)}/`)));
}

function paths(value, label, allowEmpty = false) {
  if (!Array.isArray(value)) invalid(label);
  const result = [...new Set(value.map(item => repositoryPath(item, label)))].sort();
  if (!allowEmpty && result.length === 0) invalid(label);
  return result;
}
function repositoryPath(value, label) {
  const result = text(value, label);
  if (path.isAbsolute(result) || result.split("/").includes("..")) invalid(label);
  return result;
}
function strings(value, label) {
  if (!Array.isArray(value)) invalid(label);
  const result = [...new Set(value.map(item => text(item, label)))].sort();
  if (result.length === 0) invalid(label);
  return result;
}
function digests(value, label, allowEmpty = false) {
  if (!Array.isArray(value)) invalid(label);
  const result = [...new Set(value.map(item => digest(item, label)))].sort();
  if (!allowEmpty && result.length === 0) invalid(label);
  return result;
}
function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  return value;
}
function text(value, label) {
  if (typeof value !== "string" || !value.trim()) invalid(label);
  return value.trim();
}
function sha(value, label) { if (!SHA.test(String(value || ""))) invalid(label); return value; }
function digest(value, label) {
  if (!DIGEST.test(String(value || ""))) invalid(label);
  return value;
}
function optionalDigest(value, label) {
  return value === null || value === undefined ? null : digest(value, label);
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
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) invalid(label);
  return value;
}
function invalid(label) {
  throw new Error(`Active-descendant untracked scope evidence has invalid ${label}.`);
}
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
