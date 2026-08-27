// Responsibility: Seal the exact immutable subject of one planned dirty admission repair.

import { canonicalJson, digestValue, normalizeWriteSet }
  from "./cloud-collaboration-primitives.mjs";
import {
  assertActiveOwnedDirtWithinWriteSet,
  normalizeActiveOwnedDirtEvidence,
  requireSameActiveOwnedDirtEvidence,
} from "./active-owned-dirt-recovery-evidence.mjs";
import { PROVISIONED_START_CLOUD_AUTHORITY_SUBJECT_SCHEMA }
  from "./provisioned-start-cloud-authority-subject.mjs";
import { assertTaskAuthorityBinding }
  from "./task-bound-lane-authority-contract.mjs";
import { parseWriterLeasePullRequestBody, projectWriterLeasePullRequestMarker }
  from "./writer-lease-lib.mjs";
import { writerLeaseDigest } from "./writer-lease-registry-cas.mjs";

export const PLANNED_DIRTY_ADMISSION_RECOVERY_EVIDENCE_SCHEMA =
  "agentic-planned-dirty-admission-recovery-evidence/v2";
export const EVIDENCE_SCHEMA = PLANNED_DIRTY_ADMISSION_RECOVERY_EVIDENCE_SCHEMA;
export const PLANNED_DIRTY_HEARTBEAT_PROJECTION_SCHEMA =
  "agentic-planned-dirty-heartbeat-projection/v1";

const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;

export function buildPlannedDirtyAdmissionRecoveryEvidence(input = {}) {
  const observedAt = instant(input.observedAt, "observation time");
  const lease = stablePair(input.leaseObservations, normalizeLease,
    "writer-lease double-read");
  const registry = stablePair(input.registryObservations, normalizeRegistry,
    "writer-registry double-read");
  const ownedDirt = stablePair(input.dirtObservations, normalizeActiveOwnedDirtEvidence,
    "owned-dirt double-read");
  const review = stablePair(input.pullRequestObservations, normalizeReview,
    "pull-request double-read");
  const cloudAuthoritySubject = stablePair(input.cloudSubjects, normalizeCloudSubject,
    "cloud-authority double-read");
  const protectedController = stablePair(input.controllerObservations, normalizeController,
    "protected-controller double-read");
  const protectedMainAdvance = stablePair(input.protectedMainObservations,
    normalizeProtectedMainAdvance, "protected-main double-read");
  const targetCloudAuthority = stablePair(input.targetCloudAuthorityObservations,
    normalizeTargetCloudAuthority, "target cloud-authority double-read");
  const manifest = normalizeManifest(input.manifest);
  const overlappingClaimIds = normalizeDigests(input.overlappingClaimIds,
    "overlapping claim identities");
  const taskAuthorityBindingDigest = digest(input.taskAuthorityBindingDigest,
    "task-authority binding digest");
  const repositoryPathDigest = digest(input.repositoryPathDigest, "repository path digest");
  const mutationBoundary = normalizeMutationBoundary(input.mutationBoundary
    ?? defaultMutationBoundary());
  const subject = {
    observedAt,
    repositoryPathDigest,
    targetRepository: text(input.targetRepository, "target repository"),
    ledgerRepository: text(input.ledgerRepository, "ledger repository"),
    branch: text(input.branch, "branch"),
    sessionId: text(input.sessionId, "session"),
    sourceLease: lease,
    sourceLeaseDigest: writerLeaseDigest(lease),
    sourceRegistry: registry,
    manifest,
    ownedDirt: assertActiveOwnedDirtWithinWriteSet({ evidence: ownedDirt,
      declaredWriteSet: manifest.declaredWriteSet }),
    dirtDigest: ownedDirt.evidenceDigest,
    pullRequest: review,
    cloudAuthoritySubject,
    cloudAuthoritySubjectDigest: digestValue(cloudAuthoritySubject),
    targetCloudAuthority,
    targetCloudAuthorityDigest: digestValue(targetCloudAuthority),
    heartbeatProjection: projectPlannedDirtyHeartbeatProjection({
      sourceLease: lease, targetCloudAuthority, observedAt,
    }),
    protectedController,
    protectedMainAdvance,
    overlappingClaimIds,
    taskAuthorityBindingDigest,
    mutationBoundary,
  };
  assertJoinedSubject(subject);
  const doubleRead = Object.freeze({ passes: 2, subjectDigest: digestValue(subject) });
  const core = { schema: EVIDENCE_SCHEMA, ...subject, doubleRead };
  return deepFreeze({ ...core, evidenceDigest: digestValue(core) });
}

export function normalizePlannedDirtyAdmissionRecoveryEvidence(value) {
  const source = record(value, "evidence");
  if (source.schema !== EVIDENCE_SCHEMA) invalid("schema");
  const subject = {
    observedAt: instant(source.observedAt, "observation time"),
    repositoryPathDigest: digest(source.repositoryPathDigest, "repository path digest"),
    targetRepository: text(source.targetRepository, "target repository"),
    ledgerRepository: text(source.ledgerRepository, "ledger repository"),
    branch: text(source.branch, "branch"),
    sessionId: text(source.sessionId, "session"),
    sourceLease: normalizeLease(source.sourceLease),
    sourceLeaseDigest: digest(source.sourceLeaseDigest, "source lease digest"),
    sourceRegistry: normalizeRegistry(source.sourceRegistry),
    manifest: normalizeManifest(source.manifest),
    ownedDirt: normalizeActiveOwnedDirtEvidence(source.ownedDirt),
    dirtDigest: digest(source.dirtDigest, "dirt digest"),
    pullRequest: normalizeReview(source.pullRequest),
    cloudAuthoritySubject: normalizeCloudSubject(source.cloudAuthoritySubject),
    cloudAuthoritySubjectDigest: digest(source.cloudAuthoritySubjectDigest,
      "cloud subject digest"),
    targetCloudAuthority: normalizeTargetCloudAuthority(source.targetCloudAuthority),
    targetCloudAuthorityDigest: digest(source.targetCloudAuthorityDigest,
      "target cloud-authority digest"),
    heartbeatProjection: normalizeHeartbeatProjection(source.heartbeatProjection),
    protectedController: normalizeController(source.protectedController),
    protectedMainAdvance: normalizeProtectedMainAdvance(source.protectedMainAdvance),
    overlappingClaimIds: normalizeDigests(source.overlappingClaimIds,
      "overlapping claim identities"),
    taskAuthorityBindingDigest: digest(source.taskAuthorityBindingDigest,
      "task-authority binding digest"),
    mutationBoundary: normalizeMutationBoundary(source.mutationBoundary),
  };
  assertActiveOwnedDirtWithinWriteSet({ evidence: subject.ownedDirt,
    declaredWriteSet: subject.manifest.declaredWriteSet });
  assertJoinedSubject(subject);
  const doubleRead = normalizeDoubleRead(source.doubleRead, subject);
  const core = { schema: EVIDENCE_SCHEMA, ...subject, doubleRead };
  const rebuilt = deepFreeze({ ...core,
    evidenceDigest: digest(source.evidenceDigest, "evidence digest") });
  if (rebuilt.evidenceDigest !== digestValue(core)
    || canonicalJson(rebuilt) !== canonicalJson(source)) invalid("canonical projection");
  return rebuilt;
}

export function requireSamePlannedDirtyAdmissionDirt(evidence, observed) {
  return requireSameActiveOwnedDirtEvidence(
    normalizePlannedDirtyAdmissionRecoveryEvidence(evidence).ownedDirt,
    observed,
  );
}

export function projectPlannedDirtyAdmissionRecoveryStableSubject(value) {
  const evidence = normalizePlannedDirtyAdmissionRecoveryEvidence(value);
  return deepFreeze({
    sourceLeaseDigest: evidence.sourceLeaseDigest,
    manifestDigest: evidence.manifest.manifestDigest,
    dirtDigest: evidence.dirtDigest,
    pullRequest: evidence.pullRequest,
    cloudAuthoritySubject: evidence.cloudAuthoritySubject,
    targetCloudAuthority: evidence.targetCloudAuthority,
    heartbeatProjection: evidence.heartbeatProjection,
    protectedController: evidence.protectedController,
    protectedMainAdvance: evidence.protectedMainAdvance,
    overlappingClaimIds: evidence.overlappingClaimIds,
    taskAuthorityBindingDigest: evidence.taskAuthorityBindingDigest,
  });
}

function normalizeLease(value) {
  const lease = structuredClone(record(value, "writer lease"));
  const admission = record(lease.admission, "planned admission");
  if (lease.schema !== "agentic-writer-lease/v2" || lease.status !== "active"
    || admission.schema !== "agentic-lane-admission-lease/v1"
    || admission.status !== "planned" || lease.integration !== null
    && lease.integration !== undefined) invalid("active planned lease without integration");
  for (const [candidate, label] of [[lease.sessionId, "lease session"],
    [lease.device, "lease device"], [lease.scope, "lease scope"],
    [lease.branch, "lease branch"], [lease.worktreePath, "lease worktree"],
    [lease.pullRequestUrl, "lease pull request"]]) text(candidate, label);
  sha(lease.baseSha, "lease base"); sha(lease.fenceSha, "lease fence");
  positive(lease.epoch, "lease epoch");
  instant(lease.heartbeatAt, "lease heartbeat"); instant(lease.expiresAt, "lease expiry");
  const binding = assertTaskAuthorityBinding({ binding: lease.taskAuthority, lease });
  const writeSet = normalizeWriteSet(admission.declaredWriteSet);
  if (admission.semanticScope !== lease.scope || admission.writeSetDigest !== digestValue(writeSet)) {
    invalid("lease admission scope");
  }
  digest(admission.manifestDigest, "lease manifest digest");
  lease.admission = { ...admission, declaredWriteSet: writeSet };
  lease.taskAuthority = binding;
  return deepFreeze(lease);
}

export function projectPlannedDirtyHeartbeatProjection({
  sourceLease, targetCloudAuthority, observedAt,
} = {}) {
  const lease = normalizeLease(sourceLease);
  const source = normalizeTargetCloudAuthority({
    ...lease.cloudAuthority,
    heartbeatCounter: lease.cloudAuthority?.heartbeatCounter ?? 0,
  });
  const target = normalizeTargetCloudAuthority(targetCloudAuthority);
  const sourceHeartbeatCounter = source.heartbeatCounter;
  const targetHeartbeatCounter = target.heartbeatCounter;
  const sourceStable = stableCloudAuthority(source);
  const targetStable = stableCloudAuthority(target);
  if (canonicalJson(sourceStable) !== canonicalJson(targetStable)) {
    invalid("heartbeat immutable cloud subject");
  }
  const same = target.transitionCounter === source.transitionCounter
    && targetHeartbeatCounter === sourceHeartbeatCounter;
  const oneAhead = target.transitionCounter === source.transitionCounter + 1
    && targetHeartbeatCounter === sourceHeartbeatCounter + 1;
  if (!same && !oneAhead) invalid("heartbeat counter successor");
  const claimDigests = ["claimDigest", "claimLedgerRevision", "operationReceiptDigest"];
  const ledgerRevisionChanged = target.ledgerRevision !== source.ledgerRevision;
  const ledgerDigestChanged = target.ledgerDigest !== source.ledgerDigest;
  if (same && (target.expiresAt !== source.expiresAt
    || claimDigests.some(field => target[field] !== source[field])
    || ledgerRevisionChanged !== ledgerDigestChanged)) {
    invalid("unchanged heartbeat projection");
  }
  const changingDigests = [...claimDigests, "ledgerRevision", "ledgerDigest"];
  if (oneAhead && (Date.parse(target.expiresAt) <= Date.parse(source.expiresAt)
    || changingDigests.some(field => target[field] === source[field]))) {
    invalid("one-ahead heartbeat projection");
  }
  const heartbeatAt = oneAhead ? instant(observedAt, "target local heartbeat")
    : lease.heartbeatAt;
  const sourceTtl = Date.parse(lease.expiresAt) - Date.parse(lease.heartbeatAt);
  if (!Number.isSafeInteger(sourceTtl) || sourceTtl < 1) invalid("source local heartbeat TTL");
  const expiresAt = oneAhead
    ? new Date(Math.min(Date.parse(heartbeatAt) + sourceTtl,
      Date.parse(target.expiresAt))).toISOString()
    : lease.expiresAt;
  if (Date.parse(expiresAt) <= Date.parse(heartbeatAt)
    || Date.parse(expiresAt) > Date.parse(target.expiresAt)) {
    invalid("target local heartbeat expiry");
  }
  const core = {
    schema: PLANNED_DIRTY_HEARTBEAT_PROJECTION_SCHEMA,
    disposition: oneAhead ? "one-ahead" : "unchanged",
    sourceAuthorityDigest: digestValue(lease.cloudAuthority),
    targetAuthorityDigest: digestValue(target),
    sourceTransitionCounter: source.transitionCounter,
    targetTransitionCounter: target.transitionCounter,
    sourceHeartbeatCounter,
    targetHeartbeatCounter,
    heartbeatAt,
    expiresAt,
  };
  return deepFreeze({ ...core, projectionDigest: digestValue(core) });
}

function normalizeHeartbeatProjection(value) {
  const source = record(value, "heartbeat projection");
  const result = {
    schema: source.schema,
    disposition: source.disposition,
    sourceAuthorityDigest: digest(source.sourceAuthorityDigest, "source authority digest"),
    targetAuthorityDigest: digest(source.targetAuthorityDigest, "target authority digest"),
    sourceTransitionCounter: positive(source.sourceTransitionCounter, "source transition"),
    targetTransitionCounter: positive(source.targetTransitionCounter, "target transition"),
    sourceHeartbeatCounter: nonnegative(source.sourceHeartbeatCounter, "source heartbeat"),
    targetHeartbeatCounter: nonnegative(source.targetHeartbeatCounter, "target heartbeat"),
    heartbeatAt: instant(source.heartbeatAt, "target local heartbeat"),
    expiresAt: instant(source.expiresAt, "target local expiry"),
  };
  if (result.schema !== PLANNED_DIRTY_HEARTBEAT_PROJECTION_SCHEMA
    || !["unchanged", "one-ahead"].includes(result.disposition)
    || source.projectionDigest !== digestValue(result)) invalid("heartbeat projection");
  return deepFreeze({ ...result, projectionDigest: source.projectionDigest });
}

function normalizeTargetCloudAuthority(value) {
  const source = structuredClone(record(value, "target cloud authority"));
  if (source.schema !== "agentic-lane-cloud-authority/v1" || source.provider !== "github"
    || source.state !== "active" || source.mutationAuthorityEligible !== true) {
    invalid("target active cloud authority");
  }
  for (const [candidate, label] of [[source.ledgerRepository, "ledger repository"],
    [source.targetRepository, "target repository"], [source.deviceId, "authority device"],
    [source.sessionId, "authority session"], [source.reviewRequestId, "authority review"]]) {
    text(candidate, label);
  }
  for (const [candidate, label] of [[source.claimId, "authority claim"],
    [source.claimDigest, "authority fence"], [source.ledgerDigest, "authority ledger digest"],
    [source.claimLedgerRevision, "authority transition"],
    [source.operationReceiptDigest, "authority operation"],
    [source.writeSetDigest, "authority write set"],
    [source.manifestDigest, "authority manifest"]]) digest(candidate, label);
  sha(source.ledgerRevision, "authority ledger revision");
  sha(source.canonicalBaseSha, "authority base"); sha(source.laneRevision, "authority lane");
  positive(source.leaseEpoch, "authority epoch");
  positive(source.transitionCounter, "authority transition counter");
  nonnegative(source.heartbeatCounter, "authority heartbeat counter");
  instant(source.expiresAt, "authority expiry");
  source.cloudDeclaredWriteScope = normalizeWriteSet(source.cloudDeclaredWriteScope);
  if (source.writeSetDigest !== digestValue(source.cloudDeclaredWriteScope)
    || source.entrySchema !== "agentic-cloud-collaboration-entry/v2"
    || source.claimIdentitySchema !== source.entrySchema
    || (source.integrationReceiptDigest !== null
      && source.integrationReceiptDigest !== undefined
      && !DIGEST.test(String(source.integrationReceiptDigest)))) {
    invalid("target cloud authority projection");
  }
  return deepFreeze(source);
}

function stableCloudAuthority(value) {
  const source = structuredClone(value);
  for (const field of ["claimDigest", "ledgerRevision", "ledgerDigest",
    "claimLedgerRevision", "operationReceiptDigest", "transitionCounter",
    "heartbeatCounter", "expiresAt"]) delete source[field];
  return source;
}

function normalizeRegistry(value) {
  const source = record(value, "writer registry");
  const result = { schema: source.schema, revision: nonnegative(source.revision,
    "registry revision"), registryDigest: digest(source.registryDigest, "registry digest"),
  leaseDigest: digest(source.leaseDigest, "registry lease digest") };
  if (result.schema !== "agentic-writer-lease-registry/v2") invalid("registry schema");
  return deepFreeze(result);
}

function normalizeManifest(value) {
  const source = record(value, "manifest");
  const paths = stringArray(source.paths, "manifest paths").sort();
  const semanticScope = text(source.semanticScope, "manifest semantic scope");
  const declaredWriteSet = normalizeWriteSet(source.declaredWriteSet);
  const core = { schema: source.schema, semanticScope, paths };
  if (source.schema !== "agentic-declared-write-scope/v1"
    || declaredWriteSet.length === 0 || !declaredWriteSet.includes(`semantic:${semanticScope}`)
    || source.manifestDigest !== digestValue(core)
    || source.writeSetDigest !== digestValue(declaredWriteSet)) invalid("manifest projection");
  return deepFreeze({ ...core, declaredWriteSet,
    manifestDigest: source.manifestDigest, writeSetDigest: source.writeSetDigest });
}

function normalizeReview(value) {
  const source = record(value, "pull request");
  const body = typeof source.body === "string" && Buffer.byteLength(source.body) <= 65_536
    ? source.body : invalid("pull-request body");
  const marker = structuredClone(record(source.marker, "pull-request marker"));
  const result = { id: text(source.id, "pull-request ID"),
    reviewRequestId: text(source.reviewRequestId, "review request ID"),
    number: positive(source.number, "pull-request number"),
    url: text(source.url, "pull-request URL"), state: source.state,
    isDraft: source.isDraft, autoMergeRequest: source.autoMergeRequest,
    branch: text(source.branch, "pull-request branch"),
    headRepository: text(source.headRepository, "pull-request head repository"),
    headSha: sha(source.headSha, "pull-request head"),
    remoteHeadSha: sha(source.remoteHeadSha, "remote branch head"),
    baseBranch: source.baseBranch, baseSha: sha(source.baseSha, "pull-request base"),
    body, bodyDigest: digest(source.bodyDigest, "pull-request body digest"), marker,
    markerDigest: digest(source.markerDigest, "pull-request marker digest") };
  if (result.state !== "OPEN" || result.isDraft !== true
    || result.autoMergeRequest !== null || result.baseBranch !== "main"
    || result.bodyDigest !== digestValue(body) || result.markerDigest !== digestValue(marker)) {
    invalid("open draft pull request");
  }
  return deepFreeze(result);
}

function normalizeCloudSubject(value) {
  const source = structuredClone(record(value, "cloud authority subject"));
  if (source.schema !== PROVISIONED_START_CLOUD_AUTHORITY_SUBJECT_SCHEMA) invalid("cloud schema");
  const claim = record(source.claim, "cloud claim"); const lane = record(source.lane, "cloud lane");
  const scope = record(source.scope, "cloud scope"); const owner = record(source.owner, "cloud owner");
  if (claim.state !== "active" || claim.writeAuthority !== true || claim.scopeReserved !== true
    || claim.mutationAuthorityEligible !== true) invalid("current cloud write authority");
  digest(claim.claimId, "cloud claim ID"); digest(claim.claimDigest, "cloud claim digest");
  positive(claim.transitionCounter, "cloud transition"); positive(claim.leaseEpoch, "cloud epoch");
  instant(claim.expiresAt, "cloud expiry");
  for (const item of [lane.branch, lane.reviewRequestId, owner.deviceId, owner.sessionId]) {
    text(item, "cloud joined identity");
  }
  sha(lane.canonicalBaseSha, "cloud base"); sha(lane.laneRevision, "cloud lane revision");
  sha(lane.fenceSha, "cloud fence");
  const declaredWriteSet = normalizeWriteSet(scope.declaredWriteSet);
  if (scope.writeSetDigest !== digestValue(declaredWriteSet)) invalid("cloud write set");
  source.scope.declaredWriteSet = declaredWriteSet;
  return deepFreeze(source);
}

function normalizeController(value) {
  const source = record(value, "protected controller");
  const result = { repositoryPathDigest: digest(source.repositoryPathDigest,
    "controller repository path"), branch: source.branch,
  headSha: sha(source.headSha, "controller HEAD"),
  treeSha: sha(source.treeSha, "controller tree"),
  originMainSha: sha(source.originMainSha, "controller origin/main"),
  remoteMainSha: sha(source.remoteMainSha, "controller remote main"),
  statusDigest: digest(source.statusDigest, "controller status"), clean: source.clean,
  protected: source.protected,
  implementationDigest: digest(source.implementationDigest, "controller implementation") };
  if (result.branch !== "main" || result.clean !== true || result.protected !== true
    || result.headSha !== result.originMainSha || result.headSha !== result.remoteMainSha) {
    invalid("exact protected controller main");
  }
  return deepFreeze(result);
}

function normalizeProtectedMainAdvance(value) {
  const source = record(value, "protected-main advance");
  const result = { schema: source.schema, baseSha: sha(source.baseSha, "advance base"),
    pullRequestBaseSha: sha(source.pullRequestBaseSha, "advance pull-request base"),
    protectedMainSha: sha(source.protectedMainSha, "protected main"),
    protectedMainTreeSha: sha(source.protectedMainTreeSha, "protected-main tree"),
    declaredWriteSetDigest: digest(source.declaredWriteSetDigest, "advance write set"),
    changedPathCount: nonnegative(source.changedPathCount, "protected changed path count"),
    changedPathsDigest: digest(source.changedPathsDigest, "protected changed paths") };
  if (result.schema !== "agentic-active-owned-dirt-protected-main-advance/v1") {
    invalid("protected-main advance schema");
  }
  return deepFreeze(result);
}

function assertJoinedSubject(value) {
  const lease = value.sourceLease, admission = lease.admission;
  const authority = lease.cloudAuthority;
  const cloud = value.cloudAuthoritySubject, review = value.pullRequest;
  const target = value.targetCloudAuthority;
  const heartbeat = projectPlannedDirtyHeartbeatProjection({ sourceLease: lease,
    targetCloudAuthority: target, observedAt: value.observedAt });
  const binding = assertTaskAuthorityBinding({ binding: lease.taskAuthority, lease });
  const failed = [
    ["lease digest", value.sourceLeaseDigest === writerLeaseDigest(lease)],
    ["registry lease", value.sourceRegistry.leaseDigest === value.sourceLeaseDigest],
    ["repository", digestValue(lease.worktreePath) === value.repositoryPathDigest],
    ["owner", lease.branch === value.branch && lease.sessionId === value.sessionId],
    ["heartbeat projection", canonicalJson(heartbeat)
      === canonicalJson(value.heartbeatProjection)
      && value.targetCloudAuthorityDigest === digestValue(target)],
    ["usable local projection", Date.parse(heartbeat.expiresAt) > Date.parse(value.observedAt)],
    ["manifest", admission.manifestDigest === value.manifest.manifestDigest
      && admission.writeSetDigest === value.manifest.writeSetDigest
      && canonicalJson(admission.declaredWriteSet) === canonicalJson(value.manifest.declaredWriteSet)],
    ["dirt fence", value.ownedDirt.headSha === lease.fenceSha
      && value.dirtDigest === value.ownedDirt.evidenceDigest],
    ["task", binding.bindingDigest === value.taskAuthorityBindingDigest],
    ["review", review.url === lease.pullRequestUrl && review.branch === lease.branch
      && review.headSha === lease.fenceSha && review.remoteHeadSha === lease.fenceSha
      && review.headRepository === value.targetRepository],
    ["source marker", canonicalJson(review.marker)
      === canonicalJson(projectWriterLeasePullRequestMarker(lease))
      && canonicalJson(parseWriterLeasePullRequestBody(review.body)) === canonicalJson(review.marker)],
    ["cloud repositories", cloud.targetRepository === value.targetRepository
      && cloud.ledgerRepository === value.ledgerRepository
      && authority.targetRepository === value.targetRepository
      && authority.ledgerRepository === value.ledgerRepository],
    ["local cloud authority", authority.schema === "agentic-lane-cloud-authority/v1"
      && authority.state === "active" && authority.canonicalBaseSha === lease.baseSha
      && authority.laneRevision === lease.fenceSha
      && authority.reviewRequestId === review.reviewRequestId
      && authority.writeSetDigest === value.manifest.writeSetDigest
      && canonicalJson(authority.cloudDeclaredWriteScope)
        === canonicalJson(value.manifest.declaredWriteSet)
      && authority.deviceId === lease.device && authority.sessionId === lease.sessionId
      && authority.manifestDigest === value.manifest.manifestDigest],
    ["cloud lane", cloud.lane.branch === lease.branch
      && cloud.lane.canonicalBaseSha === lease.baseSha
      && cloud.lane.laneRevision === lease.fenceSha && cloud.lane.fenceSha === lease.fenceSha
      && cloud.lane.reviewRequestId === review.reviewRequestId],
    ["cloud owner", cloud.owner.deviceId === target.deviceId
      && cloud.owner.sessionId === target.sessionId
      && digestValue({ actorId: cloud.owner.actorId,
        canonicalBaseRevision: cloud.lane.canonicalBaseSha,
        leaseEpoch: cloud.claim.leaseEpoch, repositoryId: cloud.owner.repositoryId,
        workItemId: cloud.owner.workItemId, writeSetDigest: cloud.scope.writeSetDigest })
        === target.claimId],
    ["cloud scope", cloud.scope.semanticScope === lease.scope
      && cloud.scope.manifestDigest === value.manifest.manifestDigest
      && cloud.scope.writeSetDigest === value.manifest.writeSetDigest
      && canonicalJson(cloud.scope.declaredWriteSet) === canonicalJson(value.manifest.declaredWriteSet)],
    ["cloud claim", cloud.claim.claimId === target.claimId
      && cloud.claim.claimDigest === target.claimDigest
      && cloud.claim.claimLedgerRevision === target.claimLedgerRevision
      && cloud.claim.operationReceiptDigest === target.operationReceiptDigest
      && cloud.claim.leaseEpoch === target.leaseEpoch
      && cloud.claim.transitionCounter === target.transitionCounter
      && cloud.claim.heartbeatCounter === target.heartbeatCounter
      && cloud.claim.expiresAt === target.expiresAt
      && Date.parse(cloud.claim.expiresAt) > Date.parse(value.observedAt)],
    ["cloud digest", value.cloudAuthoritySubjectDigest === digestValue(cloud)],
    ["no overlap", value.overlappingClaimIds.length === 0],
    ["protected main", value.protectedMainAdvance.baseSha === lease.baseSha
      && value.protectedMainAdvance.pullRequestBaseSha === review.baseSha
      && value.protectedMainAdvance.declaredWriteSetDigest === value.manifest.writeSetDigest],
  ].filter(([, pass]) => !pass).map(([label]) => label);
  if (failed.length) invalid(`joined recovery subject (${failed.join(", ")})`);
}

function stablePair(value, normalize, label) {
  if (!Array.isArray(value) || value.length !== 2) invalid(label);
  const pair = value.map(normalize);
  if (canonicalJson(pair[0]) !== canonicalJson(pair[1])) invalid(`${label} drift`);
  return pair[0];
}
function normalizeDoubleRead(value, subject) { const source = record(value, "double-read proof");
  if (source.passes !== 2 || source.subjectDigest !== digestValue(subject)) invalid("double-read proof");
  return deepFreeze({ passes: 2, subjectDigest: source.subjectDigest }); }
function defaultMutationBoundary() { return { allowedMutations: ["private-replay-journal",
  "writer-lease-registry-cas", "pull-request-hidden-marker-projection"], forbiddenEffects: [
  "source-bytes", "index", "head", "local-refs", "remote-refs", "cloud",
  "pull-request-state", "integration", "commit", "merge", "deployment", "release", "cleanup"] }; }
function normalizeMutationBoundary(value) { const source = record(value, "mutation boundary");
  const result = { allowedMutations: stringArray(source.allowedMutations, "allowed mutations"),
    forbiddenEffects: stringArray(source.forbiddenEffects, "forbidden effects") };
  if (canonicalJson(result) !== canonicalJson(defaultMutationBoundary())) invalid("mutation boundary");
  return deepFreeze(result); }
function normalizeDigests(value, label) { if (!Array.isArray(value)) invalid(label);
  const result = value.map(item => digest(item, label)).sort();
  if (new Set(result).size !== result.length) invalid(label); return deepFreeze(result); }
function stringArray(value, label) { if (!Array.isArray(value)) invalid(label);
  const result = value.map(item => text(item, label)); if (new Set(result).size !== result.length) invalid(label);
  return result; }
function record(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label); return value; }
function text(value, label) { if (typeof value !== "string" || !value || value !== value.trim() || value.includes("\0")) invalid(label); return value; }
function sha(value, label) { if (!SHA.test(String(value || ""))) invalid(label); return value; }
function digest(value, label) { if (!DIGEST.test(String(value || ""))) invalid(label); return value; }
function instant(value, label) { const parsed = new Date(value); if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) invalid(label); return value; }
function positive(value, label) { if (!Number.isSafeInteger(value) || value < 1) invalid(label); return value; }
function nonnegative(value, label) { if (!Number.isSafeInteger(value) || value < 0) invalid(label); return value; }
function deepFreeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); return value; }
function invalid(label) { throw new Error(`Planned-dirty admission recovery has invalid ${label}.`); }
