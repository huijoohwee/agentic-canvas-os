// Responsibility: Seal the exact current-cloud/expired-local work continuation subject.
import {
  canonicalJson,
  digestValue,
  normalizeWriteSet,
} from "./cloud-collaboration-primitives.mjs";
import {
  assertActiveOwnedDirtWithinWriteSet,
  normalizeActiveOwnedDirtEvidence,
} from "./active-owned-dirt-recovery-evidence.mjs";
import { writerLeaseDigest } from "./writer-lease-registry-cas.mjs";

export const CURRENT_CLOUD_EXPIRED_LOCAL_WORK_CONTINUATION_EVIDENCE_SCHEMA =
  "agentic-current-cloud-expired-local-work-continuation-evidence/v1";
export const CURRENT_CLOUD_EXPIRED_LOCAL_WORK_CONTINUATION_MODES = Object.freeze([
  "admitted-committed-descendant-dirty", "planned-fence-dirty",
]);

export function buildCurrentCloudExpiredLocalWorkContinuationEvidence(input = {}) {
  const core = normalizeCore({
    schema: CURRENT_CLOUD_EXPIRED_LOCAL_WORK_CONTINUATION_EVIDENCE_SCHEMA,
    repository: input.repository,
    mode: input.mode,
    controller: input.controller,
    remoteHeadSha: input.remoteHeadSha,
    pullRequest: input.pullRequest,
    observedAt: input.observedAt,
    lease: input.lease,
    leaseDigest: input.leaseDigest ?? writerLeaseDigest(input.lease),
    cloudClaim: input.cloudClaim,
    claimOwner: input.claimOwner,
    cloudObservation: input.cloudObservation,
    ownedWork: input.ownedWork,
    taskCapabilityDigest: input.taskCapabilityDigest,
    mutationBoundary: input.mutationBoundary ?? defaultMutationBoundary(),
  });
  return deepFreeze({ ...core, evidenceDigest: digestValue(core) });
}

export function normalizeCurrentCloudExpiredLocalWorkContinuationEvidence(value) {
  const source = record(value, "evidence");
  const core = normalizeCore(source);
  const rebuilt = deepFreeze({ ...core, evidenceDigest: source.evidenceDigest });
  if (digest(source.evidenceDigest, "evidence digest") !== digestValue(core)
    || canonicalJson(source) !== canonicalJson(rebuilt)) invalid("canonical evidence");
  return rebuilt;
}

function normalizeCore(value) {
  if (value.schema !== CURRENT_CLOUD_EXPIRED_LOCAL_WORK_CONTINUATION_EVIDENCE_SCHEMA) {
    invalid("schema");
  }
  const observedAt = instant(value.observedAt, "observedAt");
  const mode = text(value.mode, "continuation mode");
  if (!CURRENT_CLOUD_EXPIRED_LOCAL_WORK_CONTINUATION_MODES.includes(mode)) invalid("mode");
  const lease = normalizeLease(value.lease);
  const controller = normalizeController(value.controller);
  const remoteHeadSha = sha(value.remoteHeadSha, "remote head");
  const pullRequest = normalizePullRequest(value.pullRequest);
  const leaseDigest = digest(value.leaseDigest, "lease digest");
  const cloudClaim = normalizeCloudClaim(value.cloudClaim);
  const claimOwner = normalizeClaimOwner(value.claimOwner);
  const cloudObservation = normalizeCloudObservation(value.cloudObservation);
  const ownedWork = normalizeOwnedWork(value.ownedWork, lease.admission.declaredWriteSet);
  const core = {
    schema: value.schema,
    mode,
    controller,
    remoteHeadSha,
    pullRequest,
    repository: text(value.repository, "repository"),
    observedAt,
    lease,
    leaseDigest,
    cloudClaim,
    claimOwner,
    cloudObservation,
    ownedWork,
    taskCapabilityDigest: digest(value.taskCapabilityDigest, "task capability digest"),
    mutationBoundary: normalizeMutationBoundary(value.mutationBoundary),
  };
  assertJoinedSubject(core);
  return deepFreeze(core);
}

function normalizeLease(value) {
  const source = structuredClone(record(value, "writer lease"));
  const admission = record(source.admission, "lease admission");
  const authority = record(source.cloudAuthority, "lease cloud authority");
  const declaredWriteSet = normalizeWriteSet(admission.declaredWriteSet);
  if (source.status !== "active" || !["admitted", "planned"].includes(admission.status)) {
    invalid("active admitted-or-planned lease");
  }
  text(source.branch, "lease branch");
  text(source.sessionId, "lease session");
  text(source.device, "lease device");
  sha(source.baseSha, "lease base SHA");
  sha(source.fenceSha, "lease fence SHA");
  positiveInteger(source.epoch, "lease epoch");
  instant(source.heartbeatAt, "lease heartbeat");
  instant(source.expiresAt, "lease expiry");
  digest(admission.manifestDigest, "manifest digest");
  digest(admission.writeSetDigest, "write-set digest");
  digest(authority.claimId, "lease claim ID");
  digest(authority.claimDigest, "lease claim digest");
  text(authority.targetRepository, "lease target repository");
  text(authority.sessionId, "lease cloud session");
  text(authority.deviceId, "lease cloud device");
  positiveInteger(authority.leaseEpoch, "cloud lease epoch");
  nonnegativeInteger(authority.transitionCounter, "cloud transition counter");
  nonnegativeInteger(authority.heartbeatCounter ?? 0, "cloud heartbeat counter");
  if (admission.writeSetDigest !== digestValue(declaredWriteSet)) invalid("lease write set");
  source.admission = { ...admission, declaredWriteSet };
  return deepFreeze(source);
}

function normalizeCloudClaim(value) {
  const source = structuredClone(record(value, "current cloud claim"));
  if (source.entrySchema !== "agentic-cloud-collaboration-entry/v2"
    || source.claimIdentitySchema !== "agentic-cloud-collaboration-entry/v2"
    || source.state !== "current" || source.writeAuthority !== true
    || source.scopeReserved !== true) invalid("current cloud authority");
  digest(source.claimId, "cloud claim ID");
  digest(source.fenceRevision, "cloud claim digest");
  digest(source.transitionDigest, "cloud transition digest");
  digest(source.operationReceiptDigest, "cloud operation receipt digest");
  sha(source.canonicalBaseRevision, "cloud base SHA");
  sha(source.laneRevision, "cloud lane SHA");
  positiveInteger(source.leaseEpoch, "cloud lease epoch");
  nonnegativeInteger(source.transitionCounter, "cloud transition counter");
  nonnegativeInteger(source.heartbeatCounter ?? 0, "cloud heartbeat counter");
  instant(source.expiresAt, "cloud expiry");
  for (const key of ["actorId", "repositoryId", "workItemId", "sessionId", "deviceId"]) {
    text(source[key], `cloud ${key}`);
  }
  source.declaredWriteScope = normalizeWriteSet(source.declaredWriteScope);
  if (source.writeSetDigest !== digestValue(source.declaredWriteScope)) invalid("cloud write set");
  return deepFreeze(source);
}

function normalizeCloudObservation(value) {
  const source = record(value, "cloud observation");
  const core = {
    status: source.status === "ready" ? "ready" : invalid("cloud observation status"),
    evaluatedAt: instant(source.evaluatedAt, "cloud evaluatedAt"),
    ledgerRevision: sha(source.ledgerRevision, "cloud ledger revision"),
    ledgerDigest: digest(source.ledgerDigest, "cloud ledger digest"),
    inventoryDigest: digest(source.inventoryDigest, "cloud inventory digest"),
    verificationReceiptDigest: digest(
      source.verificationReceiptDigest,
      "cloud verification receipt digest",
    ),
    overlappingClaimIds: array(source.overlappingClaimIds, "overlapping claim IDs")
      .map((item) => digest(item, "overlapping claim ID")).sort(),
  };
  if (core.overlappingClaimIds.length > 0) invalid("overlapping cloud claim");
  return deepFreeze(core);
}

function normalizeClaimOwner(value) {
  const source = record(value, "claim owner");
  const owner = {};
  for (const key of ["actorId", "repositoryId", "workItemId", "sessionId", "deviceId"]) {
    owner[key] = text(source[key], `claim owner ${key}`);
  }
  return deepFreeze(owner);
}

function assertJoinedSubject(subject) {
  const { lease, leaseDigest, cloudClaim: claim, claimOwner, cloudObservation: cloud,
    ownedWork, mode } = subject;
  const authority = lease.cloudAuthority;
  if (writerLeaseDigest(lease) !== leaseDigest
    || Date.parse(lease.expiresAt) > Date.parse(subject.observedAt)
    || Date.parse(claim.expiresAt) <= Date.parse(subject.observedAt)
    || cloud.evaluatedAt !== subject.observedAt
    || claim.claimId !== authority.claimId
    || claim.actorId !== claimOwner.actorId
    || subject.repository !== authority.targetRepository
    || authority.sessionId !== lease.sessionId
    || authority.deviceId !== lease.device
    || claim.sessionId !== claimOwner.sessionId
    || claim.deviceId !== claimOwner.deviceId
    || claim.workItemId !== claimOwner.workItemId
    || claim.repositoryId !== claimOwner.repositoryId
    || claim.fenceRevision !== authority.claimDigest
    || claim.canonicalBaseRevision !== lease.baseSha
    || claim.laneRevision !== lease.fenceSha
    || claim.leaseEpoch !== authority.leaseEpoch
    || claim.transitionCounter !== authority.transitionCounter
    || (claim.heartbeatCounter ?? 0) !== (authority.heartbeatCounter ?? 0)
    || claim.writeSetDigest !== lease.admission.writeSetDigest
    || subject.taskCapabilityDigest !== lease.taskAuthority?.bindingDigest
    || canonicalJson(claim.declaredWriteScope)
      !== canonicalJson(lease.admission.declaredWriteSet)) {
    invalid("cloud, lease, or owned-dirt join");
  }
  if (subject.controller.clean !== true || subject.controller.protected !== true
    || subject.controller.headSha !== subject.controller.originMainSha
    || subject.remoteHeadSha !== lease.fenceSha
    || subject.pullRequest.state !== "OPEN" || subject.pullRequest.isDraft !== true
    || subject.pullRequest.headSha !== lease.fenceSha
    || subject.pullRequest.headBranch !== lease.branch
    || subject.pullRequest.url !== lease.pullRequestUrl
    || subject.pullRequest.baseBranch !== "main"
    || subject.pullRequest.autoMergeRequest !== null) invalid("controller, remote, or review join");
  if (mode === "planned-fence-dirty") {
    if (lease.admission.status !== "planned" || ownedWork.headSha !== lease.fenceSha
      || ownedWork.commits.length !== 0 || ownedWork.entries.length === 0) invalid("planned fence mode");
    return;
  }
  if (lease.admission.status !== "admitted" || ownedWork.commits.length === 0
    || ownedWork.entries.length === 0
    || ownedWork.commits.at(-1).sha !== ownedWork.headSha
    || ownedWork.commits[0].parentSha !== lease.fenceSha) invalid("admitted descendant mode");
  for (let index = 1; index < ownedWork.commits.length; index += 1) {
    if (ownedWork.commits[index].parentSha !== ownedWork.commits[index - 1].sha) {
      invalid("nonlinear admitted descendant");
    }
  }
}

function normalizeController(value) {
  const source = record(value, "controller evidence");
  return deepFreeze({ rootDigest: digest(source.rootDigest, "controller root"),
    headSha: sha(source.headSha, "controller head"),
    originMainSha: sha(source.originMainSha, "controller origin main"),
    treeSha: sha(source.treeSha, "controller tree"),
    runtimeDigest: digest(source.runtimeDigest, "controller runtime"),
    clean: source.clean === true, protected: source.protected === true });
}

function normalizePullRequest(value) {
  const source = record(value, "pull request");
  return deepFreeze({ url: text(source.url, "pull request URL"),
    nodeId: text(source.nodeId, "pull request node ID"),
    state: text(source.state, "pull request state"), isDraft: source.isDraft === true,
    headBranch: text(source.headBranch, "pull request head branch"),
    headSha: sha(source.headSha, "pull request head"),
    baseBranch: text(source.baseBranch, "pull request base branch"),
    autoMergeRequest: source.autoMergeRequest ?? null });
}

function normalizeOwnedWork(value, declaredWriteSet) {
  const source = record(value, "owned work");
  const dirt = assertActiveOwnedDirtWithinWriteSet({
    evidence: normalizeActiveOwnedDirtEvidence(source), declaredWriteSet,
  });
  const writeSet = normalizeWriteSet(declaredWriteSet);
  const commits = array(source.commits, "owned commits").map((value, index) => {
    const commit = record(value, `owned commit ${index}`);
    const changedPaths = array(commit.changedPaths, "commit paths").map(path => text(path, "commit path"));
    if (changedPaths.length === 0 || changedPaths.some(candidate =>
      !writeSet.some(scope => coversPath(scope, candidate)))) invalid("commit path scope");
    return deepFreeze({ sha: sha(commit.sha, "commit SHA"),
      parentSha: sha(commit.parentSha, "commit parent"), changedPaths: [...new Set(changedPaths)].sort() });
  });
  const core = { ...dirt, commits };
  if (digest(source.ownedWorkDigest, "owned work digest") !== digestValue(core)) {
    invalid("owned work digest");
  }
  return deepFreeze({ ...core, ownedWorkDigest: source.ownedWorkDigest });
}

function coversPath(scope, candidate) {
  if (!scope.startsWith("path:")) return false;
  const owned = scope.slice(5).replace(/\/$/u, "");
  return owned === "." || candidate === owned || candidate.startsWith(`${owned}/`);
}

function defaultMutationBoundary() {
  return {
    allowedMutations: ["writer-lease-registry-cas"],
    forbiddenEffects: [
      "cloud-mutation", "source-mutation", "git-mutation", "remote-ref-mutation",
      "index-mutation", "provider-mutation", "pull-request-mutation",
      "pull-request-state-mutation", "new-claim", "new-worktree", "merge",
      "deployment", "cleanup",
    ],
  };
}

function normalizeMutationBoundary(value) {
  const source = record(value, "mutation boundary");
  const allowedMutations = array(source.allowedMutations, "allowed mutations");
  const forbiddenEffects = array(source.forbiddenEffects, "forbidden effects");
  if (canonicalJson(allowedMutations) !== canonicalJson(defaultMutationBoundary().allowedMutations)
    || canonicalJson(forbiddenEffects) !== canonicalJson(defaultMutationBoundary().forbiddenEffects)) {
    invalid("mutation boundary");
  }
  return deepFreeze({ allowedMutations: [...allowedMutations], forbiddenEffects: [...forbiddenEffects] });
}

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  return value;
}
function array(value, label) { if (!Array.isArray(value)) invalid(label); return value; }
function text(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim()) invalid(label);
  return value;
}
function digest(value, label) {
  if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) invalid(label);
  return value;
}
function sha(value, label) {
  if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) invalid(label);
  return value;
}
function instant(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) invalid(label);
  return value;
}
function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) invalid(label);
  return value;
}
function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) invalid(label);
  return value;
}
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const item of Object.values(value)) deepFreeze(item);
  return value;
}
function invalid(label) {
  throw new Error(`Current-cloud expired-local owned-dirt evidence has invalid ${label}.`);
}
