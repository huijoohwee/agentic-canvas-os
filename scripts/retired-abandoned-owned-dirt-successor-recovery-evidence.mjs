// Responsibility: Seal one abandoned terminal owner, its preserved dirt, and its exact successor inputs.
import { createHash } from "node:crypto";
import { canonicalJson, digestValue, normalizeWriteSet, writeSetsOverlap }
  from "./cloud-collaboration-primitives.mjs";
import { assertActiveOwnedDirtWithinWriteSet, normalizeActiveOwnedDirtEvidence }
  from "./active-owned-dirt-recovery-evidence.mjs";
import { normalizeDeclaredWriteScopeManifest }
  from "./scoped-lane-admission-lib.mjs";
import { assertTaskAuthorityBinding, projectTaskAuthorityCapability }
  from "./task-bound-lane-authority-contract.mjs";
import { writerLeaseDigest } from "./writer-lease-registry-cas.mjs";
import { projectWriterLeasePullRequestMarker } from "./writer-lease-lib.mjs";

export const EVIDENCE_SCHEMA =
  "agentic-retired-abandoned-owned-dirt-successor-recovery-evidence/v1";
export const SOURCE_PROOF_SCHEMA =
  "agentic-retired-abandoned-owned-dirt-cloud-proof/v1";
export const LIVE_INVENTORY_PROOF_SCHEMA =
  "agentic-retired-abandoned-owned-dirt-live-inventory-proof/v1";
export const TARGET_EPOCH_PROOF_SCHEMA =
  "agentic-retired-abandoned-owned-dirt-target-epoch-proof/v1";
export const REANCHOR_PROJECTION_SCHEMA =
  "agentic-retired-abandoned-owned-dirt-reanchor-projection/v1";
export const COORDINATION_COMMIT_SCHEMA =
  "agentic-retired-abandoned-owned-dirt-coordination-commit/v1";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const SUBJECT_PATTERN = /^urn:agentic-task:[0-9a-f]{64}$/u;
const GIT_MODE_PATTERN = /^(?:100644|100755|120000|160000)$/u;

export function buildDeterministicCoordinationCommit({
  sourceFenceSha,
  protectedMainSha,
  protectedMainTreeSha,
  sourceClaimId,
  dirtEvidenceDigest,
  timestamp,
} = {}) {
  const fence = sha(sourceFenceSha, "coordination source fence");
  const protectedMain = sha(protectedMainSha, "coordination protected main");
  const tree = sha(protectedMainTreeSha, "coordination protected-main tree");
  const claimId = digest(sourceClaimId, "coordination source claim ID");
  const dirtDigest = digest(dirtEvidenceDigest, "coordination source-dirt digest");
  const instantValue = instant(timestamp, "coordination commit time");
  const payload = {
    schema: COORDINATION_COMMIT_SCHEMA,
    sourceFenceSha: fence,
    protectedMainSha: protectedMain,
    sourceClaimId: claimId,
    dirtEvidenceDigest: dirtDigest,
  };
  const message = `${COORDINATION_COMMIT_SCHEMA}\n\n${JSON.stringify(payload)}\n`;
  const gitTimestamp = `${Math.floor(Date.parse(instantValue) / 1000)} +0000`;
  const authorName = "Agentic Canvas OS";
  const authorEmail = "agentic-canvas-os@localhost";
  const content = [
    `tree ${tree}`,
    `parent ${fence}`,
    `parent ${protectedMain}`,
    `author ${authorName} <${authorEmail}> ${gitTimestamp}`,
    `committer ${authorName} <${authorEmail}> ${gitTimestamp}`,
    "",
    message,
  ].join("\n");
  const commitSha = createHash("sha1")
    .update(`commit ${Buffer.byteLength(content)}\0`)
    .update(content)
    .digest("hex");
  return deepFreeze({
    schema: COORDINATION_COMMIT_SCHEMA,
    commitSha,
    treeSha: tree,
    parents: [fence, protectedMain],
    authorName,
    authorEmail,
    committerName: authorName,
    committerEmail: authorEmail,
    authoredAt: instantValue,
    committedAt: instantValue,
    gitTimestamp,
    message,
    messageDigest: digestValue(message),
  });
}

export function selectTargetCloudLeaseEpochProof({
  entries,
  sourceProof,
  targetDeclaredWriteSet,
} = {}) {
  if (!Array.isArray(entries)) throw new Error("Full raw collaboration ledger entries are required.");
  const source = normalizeSourceProof(sourceProof);
  const targetWriteSet = normalizeWriteSet(targetDeclaredWriteSet);
  const targetWriteSetDigest = digestValue(targetWriteSet);
  const latestByClaim = new Map();
  for (const entry of entries) {
    const claimId = digest(entry?.claimId, "raw ledger claim ID");
    record(entry.claimCore, "raw ledger claim core");
    latestByClaim.set(claimId, entry);
  }
  const matchingClaims = [...latestByClaim.values()]
    .filter(entry => entry.claimCore.repositoryId === source.repositoryId
      && entry.claimCore.workItemId === source.workItemId
      && entry.claimCore.writeSetDigest === targetWriteSetDigest)
    .map(entry => ({
      claimId: digest(entry.claimId, "historical target claim ID"),
      leaseEpoch: positive(entry.claimCore.leaseEpoch, "historical target cloud lease epoch"),
      transitionCounter: positive(entry.claimCore.transitionCounter,
        "historical target transition counter"),
      transitionDigest: digest(entry.digest, "historical target transition digest"),
      state: text(entry.claimCore.state, "historical target claim state"),
    }))
    .sort((left, right) => left.claimId.localeCompare(right.claimId));
  const maximumHistoricalLeaseEpoch = matchingClaims.reduce(
    (maximum, claim) => Math.max(maximum, claim.leaseEpoch), 0,
  );
  if (maximumHistoricalLeaseEpoch >= Number.MAX_SAFE_INTEGER) {
    throw new Error("Target cloud lease epoch cannot advance safely.");
  }
  const core = {
    schema: TARGET_EPOCH_PROOF_SCHEMA,
    repositoryId: source.repositoryId,
    workItemId: source.workItemId,
    targetWriteSetDigest,
    ledgerEntryCount: entries.length,
    latestClaimCount: latestByClaim.size,
    validatedEntriesDigest: digestValue(entries),
    matchingClaims,
    matchingClaimsDigest: digestValue(matchingClaims),
    maximumHistoricalLeaseEpoch,
    targetCloudLeaseEpoch: maximumHistoricalLeaseEpoch + 1,
  };
  return deepFreeze({ ...core, proofDigest: digestValue(core) });
}

export function selectRetiredAbandonedClaimProof({ entries, lease } = {}) {
  if (!Array.isArray(entries)) throw new Error("Raw collaboration ledger entries are required.");
  const authority = record(lease?.cloudAuthority, "source cloud authority");
  const claimId = digest(authority.claimId, "source claim ID");
  const claimDigest = digest(authority.claimDigest, "source claim digest");
  const history = entries.filter(entry => entry?.claimId === claimId);
  const sources = history.filter(entry => entry?.claimDigest === claimDigest);
  if (sources.length !== 1) {
    throw new Error("Ledger has no unique local source-claim projection.");
  }
  const source = sources[0];
  const sourceIndex = history.indexOf(source);
  const suffix = history.slice(sourceIndex);
  const terminal = suffix.at(-1);
  const sourceCore = record(source.claimCore, "source claim core");
  const terminalCore = record(terminal?.claimCore, "terminal claim core");
  const retirement = record(terminalCore.retirement, "terminal retirement");
  const immutable = [
    "repositoryId", "actorId", "workItemId", "canonicalBaseRevision",
    "laneRevision", "writeSetDigest", "leaseEpoch", "reviewRequestId",
  ];
  const sourceWriteSet = normalizeWriteSet(sourceCore.declaredWriteScope);
  const monotonic = suffix.every((entry, index) => {
    const core = entry?.claimCore;
    const terminalEntry = index === suffix.length - 1;
    return core?.transitionCounter === sourceCore.transitionCounter + index
      && (terminalEntry
        ? core.state === "retired"
        : ["current", "dormant-preserved"].includes(core.state))
      && immutable.every(key => core[key] === sourceCore[key])
      && canonicalJson(normalizeWriteSet(core.declaredWriteScope)) === canonicalJson(sourceWriteSet);
  });
  if (sourceCore.state !== "current"
    || terminalCore.state !== "retired"
    || retirement.reason !== "abandoned"
    || suffix.length < 2
    || terminalCore.transitionCounter <= sourceCore.transitionCounter
    || !monotonic
    || retirement.finalRevision !== lease.fenceSha
    || retirement.reviewRequestId !== authority.reviewRequestId
    || sourceCore.canonicalBaseRevision !== authority.canonicalBaseSha
    || sourceCore.laneRevision !== authority.laneRevision
    || sourceCore.writeSetDigest !== authority.writeSetDigest
    || sourceCore.reviewRequestId !== authority.reviewRequestId
    || sourceCore.leaseEpoch !== authority.leaseEpoch
    || digestValue(sourceWriteSet) !== sourceCore.writeSetDigest) {
    throw new Error("Source claim has no exact terminal abandoned retirement chain.");
  }
  const core = {
    schema: SOURCE_PROOF_SCHEMA,
    claimId,
    claimDigest,
    workItemId: text(sourceCore.workItemId, "source work-item ID"),
    repositoryId: text(sourceCore.repositoryId, "source repository ID"),
    actorId: text(sourceCore.actorId, "source actor ID"),
    canonicalBaseRevision: sha(sourceCore.canonicalBaseRevision, "source canonical base"),
    laneRevision: sha(sourceCore.laneRevision, "source lane revision"),
    declaredWriteScope: sourceWriteSet,
    writeSetDigest: digest(sourceCore.writeSetDigest, "source write-set digest"),
    leaseEpoch: positive(sourceCore.leaseEpoch, "source cloud lease epoch"),
    reviewRequestId: text(sourceCore.reviewRequestId, "source review request ID"),
    sourceTransitionCounter: positive(sourceCore.transitionCounter,
      "source transition counter"),
    sourceTransitionDigest: digest(source.digest, "source transition digest"),
    terminalTransitionCounter: positive(terminalCore.transitionCounter,
      "terminal transition counter"),
    terminalTransitionDigest: digest(terminal.digest, "terminal transition digest"),
    retirementReceiptDigest: terminalRetirementReceiptDigest(terminal),
    retirementReason: "abandoned",
    retiredAt: instant(retirement.retiredAt, "retirement time"),
  };
  return deepFreeze({ ...core, proofDigest: digestValue(core) });
}

export function assertNoLiveRetiredAbandonedOverlap({
  claims,
  sourceProof,
  targetDeclaredWriteSet,
} = {}) {
  if (!Array.isArray(claims)) throw new Error("Authoritative live claim inventory is required.");
  const source = normalizeSourceProof(sourceProof);
  const target = normalizeWriteSet(targetDeclaredWriteSet);
  if (claims.some(claim => claim?.claimId === source.claimId)) {
    throw new Error("Terminal abandoned source claim unexpectedly remains live.");
  }
  const successors = claims.filter(claim => claim?.predecessorClaimId === source.claimId);
  if (successors.length !== 0) {
    throw new Error("A successor claim already exists for the terminal abandoned source.");
  }
  const overlaps = claims.filter(claim => claim?.scopeReserved !== false
    && writeSetsOverlap(claim.declaredWriteScope, target));
  if (overlaps.length !== 0) {
    throw new Error("Another live claim overlaps the strict-superset recovery write set.");
  }
  const core = {
    schema: LIVE_INVENTORY_PROOF_SCHEMA,
    claimCount: claims.length,
    sourceClaimId: source.claimId,
    targetWriteSetDigest: digestValue(target),
    successorClaimIds: [],
    overlappingClaimIds: [],
    inventoryDigest: digestValue(claims),
  };
  return deepFreeze(core);
}

export function buildRetiredAbandonedOwnedDirtSuccessorRecoveryEvidence(input = {}) {
  const lease = deepFreeze(structuredClone(record(input.lease, "source writer lease")));
  const sourceClaim = normalizeSourceProof(input.sourceClaim);
  const controller = normalizeControllerWitness(input.controller);
  const sourceFence = normalizeSourceFence(input.sourceFence);
  const targetManifest = normalizeDeclaredWriteScopeManifest(
    record(input.targetManifest, "target manifest"),
    { expectedScope: text(lease.scope, "source scope") },
  );
  const targetEpochProof = normalizeTargetEpochProof(input.targetEpochProof);
  const targetCapability = normalizeTargetCapabilityProjection(input.targetCapability);
  const pullRequest = normalizePullRequest(input.pullRequest);
  const liveInventory = normalizeLiveInventory(input.liveInventory);
  const leaseDigest = digest(input.leaseDigest, "source lease digest");
  const pullRequestMarkerDigest = digest(input.pullRequestMarkerDigest,
    "pull-request marker digest");
  const sourceWriteSet = normalizeWriteSet(lease.admission?.declaredWriteSet);
  if (!strictSubset(sourceWriteSet, targetManifest.declaredWriteSet)) {
    throw new Error("Recovery target manifest must be a strict superset of the source write set.");
  }
  const dirt = assertActiveOwnedDirtWithinWriteSet({
    evidence: input.dirt,
    declaredWriteSet: targetManifest.declaredWriteSet,
  });
  const targetProtectedMain = normalizeTargetProtectedMain(input.targetProtectedMain, dirt);
  const reanchor = normalizeReanchorProjection(input.reanchor, {
    dirt,
    sourceClaim,
    sourceFence,
    targetProtectedMain,
  });
  const binding = assertTaskAuthorityBinding({ binding: lease.taskAuthority, lease });
  const authority = record(lease.cloudAuthority, "source cloud authority");
  const admission = record(lease.admission, "source admission");
  const branch = text(input.branch, "source branch");
  const headSha = sha(input.headSha, "source HEAD");
  const treeSha = sha(input.treeSha, "source tree");

  if (lease.schema !== "agentic-writer-lease/v2" || lease.status !== "active"
    || !Number.isSafeInteger(lease.epoch) || lease.epoch < 1
    || lease.branch !== branch || lease.fenceSha !== headSha
    || admission.schema !== "agentic-lane-admission-lease/v1"
    || admission.status !== "admitted" || admission.semanticScope !== lease.scope
    || admission.writeSetDigest !== digestValue(sourceWriteSet)
    || !DIGEST_PATTERN.test(String(admission.manifestDigest || ""))
    || authority.schema !== "agentic-lane-cloud-authority/v1"
    || authority.state !== "active"
    || authority.claimId !== sourceClaim.claimId
    || authority.claimDigest !== sourceClaim.claimDigest
    || authority.canonicalBaseSha !== lease.baseSha
    || authority.canonicalBaseSha !== sourceClaim.canonicalBaseRevision
    || authority.laneRevision !== headSha
    || authority.laneRevision !== sourceClaim.laneRevision
    || authority.writeSetDigest !== admission.writeSetDigest
    || authority.writeSetDigest !== sourceClaim.writeSetDigest
    || canonicalJson(normalizeWriteSet(authority.cloudDeclaredWriteScope))
      !== canonicalJson(sourceWriteSet)
    || canonicalJson(sourceClaim.declaredWriteScope) !== canonicalJson(sourceWriteSet)
    || authority.leaseEpoch !== sourceClaim.leaseEpoch
    || authority.reviewRequestId !== sourceClaim.reviewRequestId
    || dirt.headSha !== headSha
    || writerLeaseDigest(lease) !== leaseDigest) {
    throw new Error("Recovery evidence does not bind one exact active admitted local source.");
  }
  if (sourceFence.headSha !== headSha
    || sourceFence.parentSha !== lease.baseSha
    || sourceFence.treeSha !== treeSha
    || sourceFence.baseTreeSha !== treeSha
    || targetProtectedMain.sourceBaseSha !== lease.baseSha) {
    throw new Error("Recovery source is not the sealed empty coordination fence at base B.");
  }
  if (targetCapability.generation !== binding.generation + 1
    || targetCapability.authoritySubjectId === binding.authoritySubjectId) {
    throw new Error("Recovery target capability must be a distinct generation+1 authority.");
  }
  if (pullRequest.state !== "CLOSED" || pullRequest.isDraft !== true
    || pullRequest.headSha !== headSha || pullRequest.baseSha !== lease.baseSha
    || pullRequest.url !== lease.pullRequestUrl
    || sourceClaim.reviewRequestId !== `github-pull-request:${pullRequest.id}`
    || pullRequestMarkerDigest !== digestValue(projectWriterLeasePullRequestMarker(lease))) {
    throw new Error("Recovery requires the exact closed draft pull request and source marker.");
  }
  if (liveInventory.sourceClaimId !== sourceClaim.claimId
    || liveInventory.targetWriteSetDigest !== targetManifest.writeSetDigest
    || targetEpochProof.repositoryId !== sourceClaim.repositoryId
    || targetEpochProof.workItemId !== sourceClaim.workItemId
    || targetEpochProof.targetWriteSetDigest !== targetManifest.writeSetDigest) {
    throw new Error("Recovery live-inventory proof does not join its source and target.");
  }
  const core = {
    schema: EVIDENCE_SCHEMA,
    branch,
    headSha,
    treeSha,
    controller,
    sourceFence,
    targetProtectedMain,
    reanchor,
    lease,
    leaseDigest,
    sourceClaim,
    dirt,
    dirtEvidenceDigest: dirt.evidenceDigest,
    pullRequest,
    pullRequestMarkerDigest,
    liveInventory,
    targetManifest,
    targetEpochProof,
    targetCapability,
    targetCapabilityDigest: digestValue(targetCapability),
    targetCloudLeaseEpoch: targetEpochProof.targetCloudLeaseEpoch,
  };
  return deepFreeze({ ...core, evidenceDigest: digestValue(core) });
}

export function normalizeRetiredAbandonedOwnedDirtSuccessorRecoveryEvidence(value) {
  if (value?.schema !== EVIDENCE_SCHEMA) throw new Error("Recovery evidence schema is invalid.");
  const rebuilt = buildRetiredAbandonedOwnedDirtSuccessorRecoveryEvidence(value);
  if (canonicalJson(value) !== canonicalJson(rebuilt)) {
    throw new Error("Recovery evidence is invalid or drifted.");
  }
  return rebuilt;
}

function normalizeSourceProof(value) {
  const source = record(value, "terminal abandoned source proof");
  if (source.schema !== SOURCE_PROOF_SCHEMA || source.retirementReason !== "abandoned") {
    throw new Error("Terminal abandoned source proof is invalid.");
  }
  const declaredWriteScope = normalizeWriteSet(source.declaredWriteScope);
  const core = {
    schema: SOURCE_PROOF_SCHEMA,
    claimId: digest(source.claimId, "source proof claim ID"),
    claimDigest: digest(source.claimDigest, "source proof claim digest"),
    workItemId: text(source.workItemId, "source proof work-item ID"),
    repositoryId: text(source.repositoryId, "source proof repository ID"),
    actorId: text(source.actorId, "source proof actor ID"),
    canonicalBaseRevision: sha(source.canonicalBaseRevision, "source proof canonical base"),
    laneRevision: sha(source.laneRevision, "source proof lane revision"),
    declaredWriteScope,
    writeSetDigest: digest(source.writeSetDigest, "source proof write-set digest"),
    leaseEpoch: positive(source.leaseEpoch, "source proof cloud lease epoch"),
    reviewRequestId: text(source.reviewRequestId, "source proof review request ID"),
    sourceTransitionCounter: positive(source.sourceTransitionCounter,
      "source proof transition counter"),
    sourceTransitionDigest: digest(source.sourceTransitionDigest,
      "source proof transition digest"),
    terminalTransitionCounter: positive(source.terminalTransitionCounter,
      "terminal proof transition counter"),
    terminalTransitionDigest: digest(source.terminalTransitionDigest,
      "terminal proof transition digest"),
    retirementReceiptDigest: digest(source.retirementReceiptDigest,
      "retirement receipt digest"),
    retirementReason: "abandoned",
    retiredAt: instant(source.retiredAt, "source proof retirement time"),
  };
  const rebuilt = { ...core, proofDigest: digestValue(core) };
  if (source.writeSetDigest !== digestValue(declaredWriteScope)
    || source.terminalTransitionCounter <= source.sourceTransitionCounter
    || canonicalJson(source) !== canonicalJson(rebuilt)) {
    throw new Error("Terminal abandoned source proof digest is invalid.");
  }
  return deepFreeze(rebuilt);
}

function normalizeLiveInventory(value) {
  const source = record(value, "live-inventory proof");
  if (source.schema !== LIVE_INVENTORY_PROOF_SCHEMA
    || !Number.isSafeInteger(source.claimCount) || source.claimCount < 0
    || !Array.isArray(source.successorClaimIds) || source.successorClaimIds.length !== 0
    || !Array.isArray(source.overlappingClaimIds) || source.overlappingClaimIds.length !== 0) {
    throw new Error("Live-inventory proof is invalid.");
  }
  digest(source.sourceClaimId, "live source claim ID");
  digest(source.targetWriteSetDigest, "live target write-set digest");
  digest(source.inventoryDigest, "live inventory digest");
  return deepFreeze({
    schema: LIVE_INVENTORY_PROOF_SCHEMA,
    claimCount: source.claimCount,
    sourceClaimId: source.sourceClaimId,
    targetWriteSetDigest: source.targetWriteSetDigest,
    successorClaimIds: [],
    overlappingClaimIds: [],
    inventoryDigest: source.inventoryDigest,
  });
}

function normalizeControllerWitness(value) {
  const source = record(value, "protected controller witness");
  return deepFreeze({
    headSha: sha(source.headSha, "protected controller HEAD"),
    implementationDigest: digest(source.implementationDigest,
      "protected controller implementation digest"),
  });
}

function normalizeSourceFence(value) {
  const source = record(value, "empty coordination-fence proof");
  const headSha = sha(source.headSha, "coordination-fence HEAD");
  const parentSha = sha(source.parentSha, "coordination-fence parent");
  const treeSha = sha(source.treeSha, "coordination-fence tree");
  const baseTreeSha = sha(source.baseTreeSha, "coordination-fence base tree");
  if (treeSha !== baseTreeSha) {
    throw new Error("Recovery source fence must have the exact source-base tree.");
  }
  return deepFreeze({ headSha, parentSha, treeSha, baseTreeSha });
}

function normalizeTargetProtectedMain(value, dirt) {
  const source = record(value, "target protected-main proof");
  const sourceBaseSha = sha(source.sourceBaseSha, "protected-main source base");
  const protectedMainSha = sha(source.protectedMainSha, "target protected main");
  const treeSha = sha(source.treeSha, "target protected-main tree");
  const mergeBaseSha = sha(source.mergeBaseSha, "protected-main merge base");
  const changedPaths = paths(source.changedPaths, "protected-main changed paths");
  const dirtyOverlapPaths = paths(source.dirtyOverlapPaths,
    "protected-main dirty-overlap paths");
  const dirtyPaths = new Set(dirt.entries.map(entry => entry.path));
  const expectedOverlap = changedPaths.filter(item => dirtyPaths.has(item));
  if (source.ancestryVerified !== true
    || sourceBaseSha === protectedMainSha
    || mergeBaseSha !== sourceBaseSha
    || source.localMainSha !== protectedMainSha
    || source.localOriginMainSha !== protectedMainSha
    || source.remoteMainSha !== protectedMainSha
    || source.changedPathsDigest !== digestValue(changedPaths)
    || source.dirtyOverlapPathsDigest !== digestValue(dirtyOverlapPaths)
    || canonicalJson(dirtyOverlapPaths) !== canonicalJson(expectedOverlap)) {
    throw new Error("Target protected-main ancestry, projection, or dirty-overlap proof is invalid.");
  }
  return deepFreeze({
    sourceBaseSha,
    protectedMainSha,
    treeSha,
    mergeBaseSha,
    ancestryVerified: true,
    localMainSha: protectedMainSha,
    localOriginMainSha: protectedMainSha,
    remoteMainSha: protectedMainSha,
    changedPaths,
    changedPathsDigest: source.changedPathsDigest,
    dirtyOverlapPaths,
    dirtyOverlapPathsDigest: source.dirtyOverlapPathsDigest,
  });
}

function normalizeTargetEpochProof(value) {
  const source = record(value, "target cloud-epoch proof");
  const matchingClaims = Array.isArray(source.matchingClaims)
    ? source.matchingClaims.map(item => ({
      claimId: digest(item?.claimId, "target epoch historical claim ID"),
      leaseEpoch: positive(item?.leaseEpoch, "target epoch historical lease epoch"),
      transitionCounter: positive(item?.transitionCounter,
        "target epoch historical transition counter"),
      transitionDigest: digest(item?.transitionDigest,
        "target epoch historical transition digest"),
      state: text(item?.state, "target epoch historical claim state"),
    })).sort((left, right) => left.claimId.localeCompare(right.claimId))
    : (() => { throw new Error("Target cloud-epoch matching claims are required."); })();
  if (matchingClaims.some((item, index) => item.claimId === matchingClaims[index - 1]?.claimId)) {
    throw new Error("Target cloud-epoch proof repeats a latest claim.");
  }
  const maximumHistoricalLeaseEpoch = matchingClaims.reduce(
    (maximum, claim) => Math.max(maximum, claim.leaseEpoch), 0,
  );
  const core = {
    schema: TARGET_EPOCH_PROOF_SCHEMA,
    repositoryId: text(source.repositoryId, "target epoch repository ID"),
    workItemId: text(source.workItemId, "target epoch work-item ID"),
    targetWriteSetDigest: digest(source.targetWriteSetDigest,
      "target epoch write-set digest"),
    ledgerEntryCount: nonnegative(source.ledgerEntryCount, "target epoch ledger-entry count"),
    latestClaimCount: nonnegative(source.latestClaimCount, "target epoch latest-claim count"),
    validatedEntriesDigest: digest(source.validatedEntriesDigest,
      "target epoch validated-entries digest"),
    matchingClaims,
    matchingClaimsDigest: digest(source.matchingClaimsDigest,
      "target epoch matching-claims digest"),
    maximumHistoricalLeaseEpoch: nonnegative(source.maximumHistoricalLeaseEpoch,
      "target epoch historical maximum"),
    targetCloudLeaseEpoch: positive(source.targetCloudLeaseEpoch,
      "target cloud lease epoch"),
  };
  const rebuilt = { ...core, proofDigest: digestValue(core) };
  if (core.latestClaimCount > core.ledgerEntryCount
    || core.maximumHistoricalLeaseEpoch !== maximumHistoricalLeaseEpoch
    || core.targetCloudLeaseEpoch !== maximumHistoricalLeaseEpoch + 1
    || core.matchingClaimsDigest !== digestValue(matchingClaims)
    || canonicalJson(source) !== canonicalJson(rebuilt)) {
    throw new Error("Target cloud-epoch proof is invalid or drifted.");
  }
  return deepFreeze(rebuilt);
}

function normalizeReanchorProjection(value, {
  dirt,
  sourceClaim,
  sourceFence,
  targetProtectedMain,
}) {
  const source = record(value, "current-base reanchor projection");
  const coordination = normalizeCoordinationCommit(source.coordination, {
    dirt,
    sourceClaim,
    sourceFence,
    targetProtectedMain,
  });
  const dispositions = Array.isArray(source.dispositions)
    ? source.dispositions.map(normalizeDisposition)
      .sort((left, right) => comparePaths(left.path, right.path))
    : (() => { throw new Error("Reanchor path dispositions are required."); })();
  if (dispositions.some((item, index) => item.path === dispositions[index - 1]?.path)) {
    throw new Error("Reanchor path dispositions repeat a path.");
  }
  const dispositionPaths = dispositions.map(item => item.path);
  const unionPaths = [...new Set([
    ...targetProtectedMain.changedPaths,
    ...dirt.entries.map(entry => entry.path),
  ])].sort(comparePaths);
  if (canonicalJson(dispositionPaths) !== canonicalJson(unionPaths)) {
    throw new Error("Reanchor dispositions do not cover the exact protected/dirt path union.");
  }
  const dirtByPath = new Map(dirt.entries.map(entry => [entry.path, entry]));
  const protectedChanged = new Set(targetProtectedMain.changedPaths);
  for (const disposition of dispositions) {
    assertDisposition({ disposition, sourceDirt: dirtByPath.get(disposition.path) || null,
      protectedChanged: protectedChanged.has(disposition.path) });
  }
  const targetDirt = normalizeActiveOwnedDirtEvidence(source.targetDirt);
  const expectedTargetEntries = dispositions.map(targetDirtEntry).filter(Boolean);
  if (targetDirt.headSha !== coordination.commitSha
    || canonicalJson(targetDirt.entries) !== canonicalJson(expectedTargetEntries)) {
    throw new Error("Reanchor target dirt does not match the sealed target overlay.");
  }
  const ignoredRetention = normalizeIgnoredRetention(source.ignoredRetention,
    targetProtectedMain.protectedMainSha);
  const sourceIndexAuthoredPaths = dispositions
    .filter(item => item.indexDisposition === "source").map(item => item.path);
  const sourceWorktreeAuthoredPaths = dispositions
    .filter(item => item.worktreeDisposition === "source").map(item => item.path);
  const protectedIndexIntegratedPaths = dispositions
    .filter(item => item.indexDisposition === "protected"
      && !sameGitEntry(item.base, item.protected)).map(item => item.path);
  const protectedWorktreeIntegratedPaths = dispositions
    .filter(item => item.worktreeDisposition === "protected"
      && !sameGitEntry(item.base, item.protected)).map(item => item.path);
  const core = {
    schema: REANCHOR_PROJECTION_SCHEMA,
    coordination,
    sourceIndexTreeSha: sha(source.sourceIndexTreeSha, "source index tree"),
    sourceWorktreeTreeSha: sha(source.sourceWorktreeTreeSha, "source worktree tree"),
    targetIndexTreeSha: sha(source.targetIndexTreeSha, "target index tree"),
    targetWorktreeTreeSha: sha(source.targetWorktreeTreeSha, "target worktree tree"),
    dispositions,
    dispositionCount: dispositions.length,
    dispositionsDigest: digestValue(dispositions),
    sourceIndexAuthoredPaths,
    sourceIndexAuthoredPathCount: sourceIndexAuthoredPaths.length,
    sourceIndexAuthoredPathsDigest: digestValue(sourceIndexAuthoredPaths),
    sourceWorktreeAuthoredPaths,
    sourceWorktreeAuthoredPathCount: sourceWorktreeAuthoredPaths.length,
    sourceWorktreeAuthoredPathsDigest: digestValue(sourceWorktreeAuthoredPaths),
    protectedIndexIntegratedPaths,
    protectedIndexIntegratedPathCount: protectedIndexIntegratedPaths.length,
    protectedIndexIntegratedPathsDigest: digestValue(protectedIndexIntegratedPaths),
    protectedWorktreeIntegratedPaths,
    protectedWorktreeIntegratedPathCount: protectedWorktreeIntegratedPaths.length,
    protectedWorktreeIntegratedPathsDigest: digestValue(protectedWorktreeIntegratedPaths),
    overlapPaths: targetProtectedMain.dirtyOverlapPaths,
    overlapPathCount: targetProtectedMain.dirtyOverlapPaths.length,
    overlapPathsDigest: targetProtectedMain.dirtyOverlapPathsDigest,
    ignoredRetention,
    targetDirt,
    targetDirtEvidenceDigest: targetDirt.evidenceDigest,
    targetDirtyPathCount: targetDirt.pathCount,
    authoredBytesPreserved: true,
  };
  return deepFreeze(core);
}

function normalizeCoordinationCommit(value, {
  dirt,
  sourceClaim,
  sourceFence,
  targetProtectedMain,
}) {
  const expected = buildDeterministicCoordinationCommit({
    sourceFenceSha: sourceFence.headSha,
    protectedMainSha: targetProtectedMain.protectedMainSha,
    protectedMainTreeSha: targetProtectedMain.treeSha,
    sourceClaimId: sourceClaim.claimId,
    dirtEvidenceDigest: dirt.evidenceDigest,
    timestamp: sourceClaim.retiredAt,
  });
  if (canonicalJson(value) !== canonicalJson(expected)) {
    throw new Error("Deterministic coordination commit projection is invalid or drifted.");
  }
  return expected;
}

function normalizeDisposition(value) {
  const source = record(value, "reanchor path disposition");
  const indexDisposition = source.indexDisposition;
  const worktreeDisposition = source.worktreeDisposition;
  if (!new Set(["source", "protected"]).has(indexDisposition)
    || !new Set(["source", "protected"]).has(worktreeDisposition)) {
    throw new Error("Reanchor path disposition authority is invalid.");
  }
  return deepFreeze({
    path: paths([source.path], "reanchor disposition path")[0],
    base: normalizeGitEntry(source.base, "base entry"),
    protected: normalizeGitEntry(source.protected, "protected entry"),
    sourceIndex: normalizeGitEntry(source.sourceIndex, "source index entry"),
    sourceWorktree: normalizeWorktreeEntry(source.sourceWorktree, "source worktree entry"),
    targetIndex: normalizeGitEntry(source.targetIndex, "target index entry"),
    targetWorktree: normalizeWorktreeEntry(source.targetWorktree, "target worktree entry"),
    indexDisposition,
    worktreeDisposition,
  });
}

function assertDisposition({ disposition, sourceDirt, protectedChanged }) {
  const expectedBase = sourceDirt
    ? { mode: sourceDirt.headMode, blob: sourceDirt.headBlob }
    : disposition.base;
  const expectedSourceIndex = sourceDirt
    ? { mode: sourceDirt.indexMode, blob: sourceDirt.indexBlob }
    : disposition.base;
  const expectedSourceWorktree = sourceDirt
    ? { type: sourceDirt.worktreeType, mode: sourceDirt.worktreeMode,
      blob: sourceDirt.worktreeBlob }
    : worktreeFromGitEntry(disposition.base);
  const indexDisposition = sameGitEntry(expectedSourceIndex, disposition.base)
    ? "protected" : "source";
  const worktreeDisposition = sameGitEntry(expectedSourceWorktree, disposition.base)
    ? "protected" : "source";
  const targetIndex = indexDisposition === "source"
    ? expectedSourceIndex : disposition.protected;
  const targetWorktree = worktreeDisposition === "source"
    ? expectedSourceWorktree : worktreeFromGitEntry(disposition.protected);
  if (!sameGitEntry(disposition.base, expectedBase)
    || !sameGitEntry(disposition.sourceIndex, expectedSourceIndex)
    || !sameWorktreeEntry(disposition.sourceWorktree, expectedSourceWorktree)
    || protectedChanged !== !sameGitEntry(disposition.base, disposition.protected)
    || disposition.indexDisposition !== indexDisposition
    || disposition.worktreeDisposition !== worktreeDisposition
    || !sameGitEntry(disposition.targetIndex, targetIndex)
    || !sameWorktreeEntry(disposition.targetWorktree, targetWorktree)) {
    throw new Error(`Reanchor disposition changed overlay semantics for ${disposition.path}.`);
  }
}

function targetDirtEntry(disposition) {
  const head = disposition.protected;
  const index = disposition.targetIndex;
  const worktree = disposition.targetWorktree;
  const staged = !sameGitEntry(head, index);
  const untracked = !head.mode && !index.mode && worktree.type !== "deleted";
  const unstaged = !untracked && !sameGitEntry(index, worktree);
  if (!staged && !unstaged && !untracked) return null;
  return Object.freeze({
    path: disposition.path,
    staged,
    unstaged,
    untracked,
    headMode: head.mode,
    headBlob: head.blob,
    indexMode: index.mode,
    indexBlob: index.blob,
    worktreeType: worktree.type,
    worktreeMode: worktree.mode,
    worktreeBlob: worktree.blob,
  });
}

function normalizeIgnoredRetention(value, protectedMainSha) {
  const source = record(value, "ignored-state retention proof");
  const disposition = source.disposition;
  const pathCount = nonnegative(source.pathCount, "ignored-state path count");
  const pathsDigest = digest(source.pathsDigest, "ignored-state paths digest");
  const pathComparison = record(source.pathComparison, "ignored-state path comparison");
  if (!new Set(["none", "retained-in-place"]).has(disposition)
    || source.targetHead !== protectedMainSha
    || source.ignoreRulesChanged !== false
    || typeof pathComparison.caseFold !== "boolean"
    || pathComparison.caseFoldStrategy !== (pathComparison.caseFold
      ? "unicode-upper-lower" : "none")
    || pathComparison.unicodeNormalization !== "NFC"
    || (disposition === "none") !== (pathCount === 0)
    || (pathCount === 0 && pathsDigest !== digestValue([]))) {
    throw new Error("Ignored-state retention proof is invalid.");
  }
  return deepFreeze({
    disposition,
    pathCount,
    pathsDigest,
    targetHead: protectedMainSha,
    ignoreRulesChanged: false,
    pathComparison: {
      caseFold: pathComparison.caseFold,
      caseFoldStrategy: pathComparison.caseFoldStrategy,
      unicodeNormalization: "NFC",
    },
  });
}

function normalizeGitEntry(value, label) {
  const source = value === null || value === undefined ? { mode: null, blob: null }
    : record(value, label);
  const mode = source.mode === null || source.mode === undefined ? null : String(source.mode);
  const blob = source.blob === null || source.blob === undefined ? null : String(source.blob);
  if (Boolean(mode) !== Boolean(blob)
    || (mode && !GIT_MODE_PATTERN.test(mode))
    || (blob && !SHA_PATTERN.test(blob))) {
    throw new Error(`Reanchor ${label} is invalid.`);
  }
  return deepFreeze({ mode, blob });
}

function normalizeWorktreeEntry(value, label) {
  const source = record(value, label);
  const entry = {
    type: source.type,
    mode: source.mode === null || source.mode === undefined ? null : String(source.mode),
    blob: source.blob === null || source.blob === undefined ? null : String(source.blob),
  };
  if (!new Set(["file", "symlink", "deleted"]).has(entry.type)
    || (entry.type === "deleted") !== (!entry.mode && !entry.blob)
    || (entry.type === "file" && !new Set(["100644", "100755"]).has(entry.mode))
    || (entry.type === "symlink" && entry.mode !== "120000")
    || (entry.blob && !SHA_PATTERN.test(entry.blob))) {
    throw new Error(`Reanchor ${label} is invalid.`);
  }
  return deepFreeze(entry);
}

function worktreeFromGitEntry(value) {
  if (!value.mode) return { type: "deleted", mode: null, blob: null };
  if (value.mode === "120000") return { type: "symlink", mode: value.mode, blob: value.blob };
  if (!new Set(["100644", "100755"]).has(value.mode)) {
    throw new Error("Protected reanchor worktree contains an unsupported Git entry mode.");
  }
  return { type: "file", mode: value.mode, blob: value.blob };
}

function sameGitEntry(left, right) {
  return (left?.mode || null) === (right?.mode || null)
    && (left?.blob || null) === (right?.blob || null);
}

function sameWorktreeEntry(left, right) {
  return left?.type === right?.type && sameGitEntry(left, right);
}

function normalizeTargetCapabilityProjection(value) {
  const source = record(value, "target capability projection");
  const projected = Object.hasOwn(source, "privateKey")
    ? projectTaskAuthorityCapability(source)
    : source;
  if (!SUBJECT_PATTERN.test(String(projected.authoritySubjectId || ""))
    || projected.proofAdapterId !== "urn:agentic-proof:ed25519-file:v1"
    || !Number.isSafeInteger(projected.generation) || projected.generation < 1
    || typeof projected.publicKey !== "string" || !projected.publicKey.trim()
    || !DIGEST_PATTERN.test(String(projected.publicKeyDigest || ""))
    || projected.publicKeyDigest !== digestValue(projected.publicKey)) {
    throw new Error("Target task capability projection is invalid.");
  }
  return deepFreeze({
    authoritySubjectId: projected.authoritySubjectId,
    proofAdapterId: projected.proofAdapterId,
    generation: projected.generation,
    publicKey: projected.publicKey,
    publicKeyDigest: projected.publicKeyDigest,
  });
}

function normalizePullRequest(value) {
  const source = record(value, "source pull request");
  const state = text(source.state, "pull-request state");
  if (!Number.isSafeInteger(source.number) || source.number < 1
    || typeof source.isDraft !== "boolean") {
    throw new Error("Source pull request is invalid.");
  }
  return deepFreeze({
    id: text(source.id, "pull-request ID"),
    url: text(source.url, "pull-request URL"),
    number: source.number,
    headSha: sha(source.headSha, "pull-request head"),
    baseSha: sha(source.baseSha, "pull-request base"),
    bodyDigest: digest(source.bodyDigest, "pull-request body digest"),
    bodyRemainderDigest: digest(source.bodyRemainderDigest,
      "pull-request body-remainder digest"),
    isDraft: source.isDraft,
    state,
  });
}

function terminalRetirementReceiptDigest(entry) {
  const receipt = {
    schema: "agentic-collaboration-retirement-receipt/v1",
    operation: "retire",
    status: "retired",
    repositoryId: text(entry.repositoryId, "retirement repository ID"),
    claimId: digest(entry.claimId, "retirement claim ID"),
    claimDigest: digest(entry.claimDigest, "retirement claim digest"),
    fenceRevision: digest(entry.claimDigest, "retirement fence"),
    ledgerRevision: digest(entry.digest, "retirement ledger revision"),
    ledgerSequence: positive(entry.sequence, "retirement ledger sequence"),
    idempotencyKey: digest(entry.idempotencyKey, "retirement idempotency key"),
    requestDigest: digest(entry.requestDigest, "retirement request digest"),
    evaluationTime: instant(entry.evaluationTime, "retirement evaluation time"),
  };
  return digestValue(receipt);
}

function strictSubset(left, right) {
  return left.length < right.length && left.every(item => right.includes(item));
}
function comparePaths(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
function paths(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} are required.`);
  return [...new Set(value.map(item => {
    const normalized = normalizeWriteSet([`path:${text(item, label)}`]);
    if (normalized.length !== 1 || !normalized[0].startsWith("path:")) {
      throw new Error(`${label} are invalid.`);
    }
    const result = normalized[0].slice("path:".length);
    if (result === ".") throw new Error(`${label} must identify repository entries.`);
    return result;
  }))].sort(comparePaths);
}
function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is required.`);
  }
  return value;
}
function text(value, label) {
  const result = String(value || "").trim();
  if (!result) throw new Error(`${label} is required.`);
  return result;
}
function sha(value, label) {
  const result = text(value, label);
  if (!SHA_PATTERN.test(result)) throw new Error(`${label} is invalid.`);
  return result;
}
function digest(value, label) {
  const result = text(value, label);
  if (!DIGEST_PATTERN.test(result)) throw new Error(`${label} is invalid.`);
  return result;
}
function positive(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} is invalid.`);
  return value;
}
function nonnegative(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is invalid.`);
  return value;
}
function instant(value, label) {
  const result = text(value, label);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${label} is invalid.`);
  return result;
}
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
