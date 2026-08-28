// Responsibility: Prove a closed-shape dormant claim owns one preserved remote authored lane.
import { canonicalJson, digestValue, normalizeWriteSet }
  from "./cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "./github-cloud-collaboration-mapping.mjs";

const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const MAX_COMMITS = 64;
const MAX_PATHS = 256;

export function normalizeOrphanedAbsentAuthoredLaneEvidence(value) {
  const input = object(value, "retirement evidence");
  const observedAt = instant(input.observedAt, "observation instant");
  const repository = normalizeRepository(input.repository);
  const controller = normalizeController(input.controller);
  const actor = normalizeActor(input.actor);
  const pullRequest = normalizePullRequest(input.pullRequest, repository, actor);
  const marker = normalizeMarker(input.marker);
  const claim = normalizeClaim(input.claim, observedAt);
  const cloud = normalizeCloud(input.cloud);
  const authoredRange = normalizeRange(input.authoredRange, marker, claim);
  const absence = normalizeAbsence(input.absence);
  const remote = normalizeRemote(input.remote);

  assertJoins({ repository, actor, pullRequest, marker, claim, cloud, authoredRange, remote });
  const core = {
    observedAt, repository, controller, actor, pullRequest, marker, claim, cloud,
    authoredRange, absence, remote,
  };
  const stableEvidenceDigest = digestValue(stableProjection(core));
  if (input.stableEvidenceDigest !== stableEvidenceDigest) {
    throw new Error("Retirement stable evidence digest is invalid.");
  }
  return deepFreeze({ ...core, stableEvidenceDigest });
}

export function orphanedAbsentAuthoredStableEvidenceDigest(value) {
  const { stableEvidenceDigest: _digest, ...input } = object(value, "retirement evidence");
  return digestValue(stableProjection(input));
}

function normalizeRepository(value) {
  const input = object(value, "repository evidence");
  return Object.freeze({
    fullName: repositoryName(input.fullName),
    id: positive(input.id, "repository ID"),
    nodeId: text(input.nodeId, "repository node ID"),
    originUrlDigest: digest(input.originUrlDigest, "origin URL digest"),
    gitCommonDirectoryDigest: digest(input.gitCommonDirectoryDigest, "Git common-directory digest"),
  });
}

function normalizeController(value) {
  const input = object(value, "controller evidence");
  const result = {
    branch: text(input.branch, "controller branch"),
    headSha: sha(input.headSha, "controller head"),
    originMainSha: sha(input.originMainSha, "controller origin/main"),
    remoteMainSha: sha(input.remoteMainSha, "controller remote main"),
    clean: input.clean === true,
    protected: input.protected === true,
    protectionDigest: digest(input.protectionDigest, "controller protection digest"),
    runtimeDigest: digest(input.runtimeDigest, "controller runtime digest"),
  };
  if (!result.clean || !result.protected || result.branch !== "main" || result.headSha !== result.originMainSha
    || result.headSha !== result.remoteMainSha) {
    throw new Error("Retirement requires a clean controller at exact protected origin/main.");
  }
  return Object.freeze(result);
}

function normalizeActor(value) {
  const input = object(value, "actor evidence");
  return Object.freeze({ id: positive(input.id, "actor ID"), login: text(input.login, "actor login") });
}

function normalizePullRequest(value, repository, actor) {
  const input = object(value, "pull-request evidence");
  const result = {
    number: positive(input.number, "pull-request number"),
    nodeId: text(input.nodeId, "pull-request node ID"),
    url: text(input.url, "pull-request URL"),
    state: text(input.state, "pull-request state"),
    isDraft: input.isDraft === true,
    mergedAt: input.mergedAt ?? null,
    closedAt: input.closedAt ?? null,
    branch: text(input.branch, "pull-request branch"),
    headSha: sha(input.headSha, "pull-request head"),
    baseRef: text(input.baseRef, "pull-request base"),
    baseSha: sha(input.baseSha, "pull-request base SHA"),
    authorLogin: text(input.authorLogin, "pull-request author"),
    headRepository: repositoryName(input.headRepository),
    baseRepository: repositoryName(input.baseRepository),
    restAutoMergeRequest: input.restAutoMergeRequest ?? null,
    autoMergeRequest: input.autoMergeRequest ?? null,
    isInMergeQueue: input.isInMergeQueue === true,
    mergeQueueEntry: input.mergeQueueEntry ?? null,
    immutableDigest: digest(input.immutableDigest, "pull-request immutable digest"),
    markerDigest: digest(input.markerDigest, "pull-request marker digest"),
  };
  if (result.state !== "OPEN" || !result.isDraft || result.mergedAt !== null || result.closedAt !== null
    || result.baseRef !== "main" || result.authorLogin !== actor.login
    || result.headRepository !== repository.fullName || result.baseRepository !== repository.fullName
    || result.restAutoMergeRequest !== null || result.autoMergeRequest !== null
    || result.isInMergeQueue || result.mergeQueueEntry !== null) {
    throw new Error("Retirement requires one exact open draft, unmerged, unqueued pull request.");
  }
  return Object.freeze(result);
}

function normalizeMarker(value) {
  const input = object(value, "writer marker");
  const admission = object(input.admission, "writer marker admission");
  const authority = object(input.cloudAuthority, "writer marker cloud authority");
  const task = object(input.taskAuthority, "writer marker task authority");
  const result = {
    schema: text(input.schema, "writer marker schema"),
    status: text(input.status, "writer marker status"),
    epoch: positive(input.epoch, "writer marker epoch"),
    sessionId: text(input.sessionId, "writer marker session"),
    device: text(input.device, "writer marker device"),
    scope: text(input.scope, "writer marker scope"),
    branch: text(input.branch, "writer marker branch"),
    baseSha: sha(input.baseSha, "writer marker base"),
    fenceSha: sha(input.fenceSha, "writer marker fence"),
    admission: Object.freeze({
      status: text(admission.status, "admission status"),
      semanticScope: text(admission.semanticScope, "admission scope"),
      declaredWriteSet: normalizeWriteSet(admission.declaredWriteSet),
      writeSetDigest: digest(admission.writeSetDigest, "admission write-set digest"),
      manifestDigest: digest(admission.manifestDigest, "admission manifest digest"),
    }),
    cloudAuthority: Object.freeze({
      ledgerRepository: repositoryName(authority.ledgerRepository),
      targetRepository: repositoryName(authority.targetRepository),
      claimId: digest(authority.claimId, "marker claim ID"),
      claimDigest: digest(authority.claimDigest, "marker claim digest"),
      operationReceiptDigest: digest(authority.operationReceiptDigest, "marker operation receipt digest"),
      canonicalBaseSha: sha(authority.canonicalBaseSha, "marker canonical base"),
      laneRevision: sha(authority.laneRevision, "marker lane revision"),
      writeSetDigest: digest(authority.writeSetDigest, "marker write-set digest"),
      reviewRequestId: text(authority.reviewRequestId, "marker review request"),
      leaseEpoch: positive(authority.leaseEpoch, "marker cloud lease epoch"),
      transitionCounter: positive(authority.transitionCounter, "marker cloud transition counter"),
      state: text(authority.state, "marker cloud state"),
      expiresAt: instant(authority.expiresAt, "marker cloud expiry"),
    }),
    taskAuthority: Object.freeze({
      schema: text(task.schema, "task authority schema"),
      authoritySubjectId: text(task.authoritySubjectId, "task authority subject"),
      proofAdapterId: text(task.proofAdapterId, "task proof adapter"),
      generation: positive(task.generation, "task authority generation"),
      publicKey: text(task.publicKey, "task public key"),
      publicKeyDigest: digest(task.publicKeyDigest, "task public-key digest"),
      laneBindingDigest: digest(task.laneBindingDigest, "task lane-binding digest"),
      bindingDigest: digest(task.bindingDigest, "task binding digest"),
    }),
  };
  if (result.schema !== "agentic-writer-lease/v2" || result.status !== "active"
    || result.admission.status !== "admitted" || result.admission.semanticScope !== result.scope
    || result.admission.writeSetDigest !== digestValue(result.admission.declaredWriteSet)
    || result.taskAuthority.schema !== "agentic-task-authority-binding/v1") {
    throw new Error("Retirement writer marker is incomplete or internally inconsistent.");
  }
  return deepFreeze(result);
}

function normalizeClaim(value, observedAt) {
  const input = object(value, "cloud claim");
  const result = {
    claimId: digest(input.claimId, "claim ID"),
    claimDigest: digest(input.claimDigest, "claim digest"),
    transitionDigest: digest(input.transitionDigest, "claim transition digest"),
    operationReceiptDigest: digest(input.operationReceiptDigest, "claim operation receipt digest"),
    state: text(input.state, "claim state"),
    recordedState: text(input.recordedState, "recorded claim state"),
    writeAuthority: input.writeAuthority === true,
    scopeReserved: input.scopeReserved === true,
    actorId: text(input.actorId, "claim actor ID"),
    repositoryId: text(input.repositoryId, "claim repository ID"),
    workItemId: text(input.workItemId, "claim work item"),
    deviceId: text(input.deviceId, "claim device ID"),
    sessionId: text(input.sessionId, "claim session ID"),
    canonicalBaseRevision: sha(input.canonicalBaseRevision, "claim canonical base"),
    laneRevision: sha(input.laneRevision, "claim lane revision"),
    declaredWriteScope: normalizeWriteSet(input.declaredWriteScope),
    writeSetDigest: digest(input.writeSetDigest, "claim write-set digest"),
    leaseEpoch: positive(input.leaseEpoch, "claim lease epoch"),
    transitionCounter: positive(input.transitionCounter, "claim transition counter"),
    reviewRequestId: text(input.reviewRequestId, "claim review request"),
    expiresAt: instant(input.expiresAt, "claim expiry"),
    integration: input.integration ?? null,
  };
  if (result.state !== "dormant-preserved" || result.recordedState !== "current"
    || result.writeAuthority || !result.scopeReserved || result.integration !== null
    || Date.parse(result.expiresAt) > Date.parse(observedAt)
    || result.writeSetDigest !== digestValue(result.declaredWriteScope)) {
    throw new Error("Retirement requires one expired dormant-preserved, scope-reserving cloud claim.");
  }
  return deepFreeze(result);
}

function normalizeCloud(value) {
  const input = object(value, "cloud frame");
  return Object.freeze({
    ledgerRepository: repositoryName(input.ledgerRepository),
    ledgerRevision: sha(input.ledgerRevision, "ledger revision"),
    ledgerDigest: digest(input.ledgerDigest, "ledger digest"),
    sequence: positive(input.sequence, "ledger sequence"),
  });
}

function normalizeRange(value, marker, claim) {
  const input = object(value, "authored range");
  const commits = [];
  let expectedParent = claim.laneRevision;
  for (const commit of array(input.commits, "authored commits", MAX_COMMITS)) {
    const item = object(commit, "authored commit");
    const result = {
      sha: sha(item.sha, "authored commit SHA"),
      parentSha: sha(item.parentSha, "authored commit parent"),
      treeSha: sha(item.treeSha, "authored commit tree"),
      changedPaths: pathList(item.changedPaths, "authored commit paths"),
      message: text(item.message, "authored commit message"),
    };
    if (result.parentSha !== expectedParent) throw new Error("Authored range is not a strict linear descendant.");
    assertTrailers(result.message, marker.scope, claim.leaseEpoch);
    commits.push(Object.freeze(result));
    expectedParent = result.sha;
  }
  if (commits.length === 0) throw new Error("Retirement requires a strict authored descendant.");
  const changedPaths = pathList(input.changedPaths, "authored range paths");
  const union = [...new Set(commits.flatMap(commit => commit.changedPaths))].sort();
  const result = {
    fenceSha: sha(input.fenceSha, "authored range fence"),
    fenceParentSha: sha(input.fenceParentSha, "fence parent"),
    fenceTreeSha: sha(input.fenceTreeSha, "fence tree"),
    baseTreeSha: sha(input.baseTreeSha, "claim base tree"),
    headSha: sha(input.headSha, "authored range head"),
    headTreeSha: sha(input.headTreeSha, "authored range head tree"),
    commits: Object.freeze(commits),
    changedPaths,
    rangeDigest: digest(input.rangeDigest, "authored range digest"),
  };
  if (result.fenceSha !== claim.laneRevision
    || result.fenceParentSha !== claim.canonicalBaseRevision
    || result.fenceTreeSha !== result.baseTreeSha
    || result.headSha !== commits.at(-1).sha
    || result.headTreeSha !== commits.at(-1).treeSha || canonicalJson(changedPaths) !== canonicalJson(union)
    || result.rangeDigest !== digestValue({ fenceSha: result.fenceSha,
      fenceParentSha: result.fenceParentSha, fenceTreeSha: result.fenceTreeSha,
      baseTreeSha: result.baseTreeSha, headSha: result.headSha,
      headTreeSha: result.headTreeSha, commits, changedPaths })) {
    throw new Error("Authored range evidence is incomplete or drifted.");
  }
  for (const changedPath of changedPaths) {
    if (!marker.admission.declaredWriteSet.includes(`path:${changedPath}`)) {
      throw new Error(`Authored path escaped the exact declared scope: ${changedPath}`);
    }
  }
  return deepFreeze(result);
}

function normalizeAbsence(value) {
  const input = object(value, "local absence evidence");
  const result = {
    registeredWorktreeMatches: stringList(input.registeredWorktreeMatches, "worktree matches"),
    localBranchPresent: input.localBranchPresent === true,
    writerLeaseMatches: stringList(input.writerLeaseMatches, "writer lease matches"),
    privateTaskArtifactMatches: stringList(input.privateTaskArtifactMatches, "private task artifacts"),
    registryDigest: digest(input.registryDigest, "worktree registry digest"),
    localRefsDigest: digest(input.localRefsDigest, "local refs digest"),
    writerLeaseRegistryDigest: digest(input.writerLeaseRegistryDigest, "writer registry digest"),
    privateTaskInventoryDigest: digest(input.privateTaskInventoryDigest, "private task inventory digest"),
  };
  if (result.registeredWorktreeMatches.length || result.localBranchPresent
    || result.writerLeaseMatches.length || result.privateTaskArtifactMatches.length) {
    throw new Error("Retirement requires zero local worktree, branch, writer lease, and private task artifacts.");
  }
  const absenceDigest = digestValue(result);
  if (input.absenceDigest !== absenceDigest) throw new Error("Local absence digest is invalid.");
  return deepFreeze({ ...result, absenceDigest });
}

function normalizeRemote(value) {
  const input = object(value, "remote branch evidence");
  return Object.freeze({
    branch: text(input.branch, "remote branch"),
    headSha: sha(input.headSha, "remote branch head"),
  });
}

function assertJoins({ repository, actor, pullRequest, marker, claim, cloud, authoredRange, remote }) {
  if (pullRequest.url !== `https://github.com/${repository.fullName}/pull/${pullRequest.number}`
    || pullRequest.branch !== marker.branch || pullRequest.headSha !== authoredRange.headSha
    || remote.branch !== marker.branch || remote.headSha !== authoredRange.headSha
    || marker.fenceSha !== claim.laneRevision || marker.baseSha !== claim.canonicalBaseRevision
    || marker.cloudAuthority.targetRepository !== repository.fullName
    || marker.cloudAuthority.ledgerRepository !== cloud.ledgerRepository
    || marker.cloudAuthority.claimId !== claim.claimId
    || marker.cloudAuthority.claimDigest !== claim.claimDigest
    || marker.cloudAuthority.operationReceiptDigest !== claim.operationReceiptDigest
    || marker.cloudAuthority.canonicalBaseSha !== claim.canonicalBaseRevision
    || marker.cloudAuthority.laneRevision !== claim.laneRevision
    || marker.cloudAuthority.writeSetDigest !== claim.writeSetDigest
    || marker.cloudAuthority.reviewRequestId !== claim.reviewRequestId
    || marker.cloudAuthority.leaseEpoch !== claim.leaseEpoch
    || marker.cloudAuthority.transitionCounter !== claim.transitionCounter
    || marker.cloudAuthority.state !== "active"
    || marker.cloudAuthority.expiresAt !== claim.expiresAt
    || marker.admission.writeSetDigest !== claim.writeSetDigest
    || canonicalJson(marker.admission.declaredWriteSet) !== canonicalJson(claim.declaredWriteScope)
    || claim.reviewRequestId !== `github-pull-request:${pullRequest.nodeId}`
    || claim.actorId !== `github-user:${actor.id}`
    || claim.repositoryId !== `github-repository:${repository.nodeId}`
    || claim.workItemId !== pseudonymousIdentifier("work-item", marker.scope)
    || claim.deviceId !== pseudonymousIdentifier("device", marker.device)
    || claim.sessionId !== pseudonymousIdentifier("session", marker.sessionId)
    || pullRequest.markerDigest !== digestValue(marker)) {
    throw new Error("Retirement provider, marker, cloud claim, and authored range do not form one identity.");
  }
}

function stableProjection(value) {
  const { observedAt: _observedAt, cloud, stableEvidenceDigest: _digest, absence, ...rest } = value;
  return { ...rest,
    cloud: { ledgerRepository: cloud.ledgerRepository },
    absence: {
      registeredWorktreeMatches: absence.registeredWorktreeMatches,
      localBranchPresent: absence.localBranchPresent,
      writerLeaseMatches: absence.writerLeaseMatches,
      privateTaskArtifactMatches: absence.privateTaskArtifactMatches,
    },
  };
}

function assertTrailers(message, scope, leaseEpoch) {
  const required = new Map([
    ["Agentic-Task", scope],
    ["Agentic-Scope", scope],
    ["Agentic-Lease-Epoch", String(leaseEpoch)],
    ["Agentic-Mechanism", "Agentic Canvas OS protected integration"],
  ]);
  for (const [name, expected] of required) {
    const matches = [...message.matchAll(new RegExp(`^${name}:\\s*(.+)$`, "gmu"))];
    if (matches.length !== 1 || matches[0][1].trim() !== expected) {
      throw new Error(`Authored commit has an invalid ${name} trailer.`);
    }
  }
}

function pathList(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} is invalid.`);
  const result = value.map(item => {
    if (typeof item !== "string" || item.length === 0 || item.includes("\0")) {
      throw new Error(`${label} contains an invalid path.`);
    }
    return item;
  }).sort();
  if (new Set(result).size !== result.length || result.length > MAX_PATHS
    || result.some(item => item.startsWith("/") || item.split("/").includes(".."))) {
    throw new Error(`${label} is unsafe or exceeds its bound.`);
  }
  return Object.freeze(result);
}
function stringList(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} is invalid.`);
  const result = value.map(item => text(item, label)).sort();
  if (new Set(result).size !== result.length) throw new Error(`${label} contains duplicates.`);
  return Object.freeze(result);
}
function array(value, label, maximum) {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${label} is invalid or exceeds its bound.`);
  return value;
}
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid.`);
  return value;
}
function text(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is invalid.`);
  return value.trim();
}
function repositoryName(value) {
  const result = text(value, "repository identity");
  if (!REPOSITORY.test(result)) throw new Error("Repository identity is invalid.");
  return result;
}
function sha(value, label) {
  if (!SHA.test(String(value || ""))) throw new Error(`${label} is invalid.`);
  return value;
}
function digest(value, label) {
  if (!DIGEST.test(String(value || ""))) throw new Error(`${label} is invalid.`);
  return value;
}
function positive(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} is invalid.`);
  return value;
}
function instant(value, label) {
  const result = text(value, label);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${label} is invalid.`);
  return new Date(result).toISOString();
}
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
