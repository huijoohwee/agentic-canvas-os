// Responsibility: normalize and join immutable provider, cloud-claim, and local-source evidence.
import { digestValue, normalizeWriteSet } from "./cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "./github-cloud-collaboration-mapping.mjs";
import {
  normalizeMergedDormantClaimReconciliationLocalEvidence as normalizeLocal,
} from "./merged-dormant-claim-reconciliation-local-source.mjs";

export {
  buildMergedDormantClaimReconciliationPhaseObservation,
  classifyMergedDormantClaimReconciliationPhase,
} from "./merged-dormant-claim-reconciliation-phase-evidence.mjs";

export const MERGED_DORMANT_CLAIM_RECONCILIATION_SOURCE_EVIDENCE_SCHEMA =
  "agentic-merged-dormant-claim-reconciliation-source-evidence/v1";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

export function buildMergedDormantClaimReconciliationSourceEvidence({ claim, provider, local }) {
  return assembleSourceEvidence({
    claim: normalizeClaim(claim),
    provider: normalizeProvider(provider),
    local: normalizeLocal(local),
  });
}

export function normalizeMergedDormantClaimReconciliationSourceEvidence(value) {
  requireObject(value, "Source evidence");
  if (value.schema !== MERGED_DORMANT_CLAIM_RECONCILIATION_SOURCE_EVIDENCE_SCHEMA) {
    throw new Error("Unsupported merged dormant reconciliation source evidence.");
  }
  const normalized = assembleSourceEvidence({
    claim: normalizeClaim(value.claim),
    provider: normalizeProvider(value.provider),
    local: normalizeLocal(value.local),
  });
  for (const field of [
    "bytesDigest",
    "refreshTopologyDigest",
    "namedChecksDigest",
    "handoffEvidenceDigest",
    "sourceEvidenceDigest",
  ]) {
    if (value[field] !== normalized[field]) {
      throw new Error(`Merged dormant reconciliation ${field} is invalid.`);
    }
  }
  return normalized;
}

export function assertMergedDormantClaimReconciliationSourceEvidence(value) {
  return normalizeMergedDormantClaimReconciliationSourceEvidence(value);
}

function assembleSourceEvidence({ claim, provider, local }) {
  assertSourceJoins({ claim, provider, local });
  const bytesDigest = digestValue({
    claimHead: provider.claimHead,
    pullRequestHeadSha: provider.pullRequest.headSha,
    pullRequestHeadTreeSha: provider.pullRequest.headTreeSha,
    mergeCommitSha: provider.pullRequest.mergeCommitSha,
    mergeCommitTreeSha: provider.pullRequest.mergeCommitTreeSha,
    protectedMain: provider.protectedMain,
  });
  const namedChecksDigest = digestValue({
    requiredChecks: provider.requiredChecks,
    checkRuns: provider.checkRuns,
  });
  const refreshTopologyDigest = digestValue({
    claimHead: provider.claimHead,
    refreshChain: provider.refreshChain,
    mergeCommitParents: provider.mergeCommitParents,
    mergeChangedPaths: provider.mergeChangedPaths,
  });
  const preservation = Object.freeze(local.mode === "completed-absent" ? {
    localBranch: "retained-ref",
    localWorktree: "absent-proven",
    sourceBytes: "retained-ref",
    remoteBranch: "already-absent",
    ledgerMutation: "repository-adapter-only",
  } : {
    localBranch: "preserved",
    localWorktree: "preserved",
    sourceBytes: "read-only",
    remoteBranch: "already-absent",
    ledgerMutation: "repository-adapter-only",
  });
  const handoffEvidenceDigest = digestValue({
    claimId: claim.claimId,
    claimTransitionDigest: claim.transitionDigest,
    local,
    preservation,
  });
  const core = {
    schema: MERGED_DORMANT_CLAIM_RECONCILIATION_SOURCE_EVIDENCE_SCHEMA,
    claim,
    provider,
    local,
    preservation,
    bytesDigest,
    refreshTopologyDigest,
    namedChecksDigest,
    handoffEvidenceDigest,
  };
  return deepFreeze({ ...core, sourceEvidenceDigest: digestValue(core) });
}

function normalizeClaim(value) {
  requireObject(value, "Dormant claim");
  const declaredWriteScope = normalizeWriteSet(value.declaredWriteScope);
  const claim = {
    claimId: requiredDigest(value.claimId, "claim ID"),
    claimDigest: requiredDigest(value.claimDigest, "claim digest"),
    transitionDigest: requiredDigest(value.transitionDigest, "claim transition digest"),
    operationReceiptDigest: requiredDigest(value.operationReceiptDigest, "claim operation receipt digest"),
    ledgerRevision: requiredSha(value.ledgerRevision, "claim ledger revision"),
    ledgerDigest: requiredDigest(value.ledgerDigest, "claim ledger digest"),
    state: requiredText(value.state, "claim state"),
    recordedState: requiredText(value.recordedState, "claim recorded state"),
    writeAuthority: value.writeAuthority,
    scopeReserved: value.scopeReserved,
    actorId: requiredText(value.actorId, "claim actor ID"),
    deviceId: requiredText(value.deviceId, "claim cloud device ID"),
    sessionId: requiredText(value.sessionId, "claim cloud session ID"),
    repositoryId: requiredText(value.repositoryId, "claim repository ID"),
    workItemId: requiredText(value.workItemId, "claim work-item ID"),
    canonicalBaseRevision: requiredSha(value.canonicalBaseRevision, "claim canonical base"),
    laneRevision: requiredSha(value.laneRevision, "claim lane revision"),
    declaredWriteScope: Object.freeze(declaredWriteScope),
    writeSetDigest: requiredDigest(value.writeSetDigest, "claim write-set digest"),
    leaseEpoch: positiveInteger(value.leaseEpoch, "claim lease epoch"),
    transitionCounter: positiveInteger(value.transitionCounter, "claim transition counter"),
    reviewRequestId: requiredText(value.reviewRequestId, "claim review request ID"),
    evidenceDigest: requiredDigest(value.evidenceDigest, "claim review evidence digest"),
    integration: requiredNull(value.integration, "claim integration"),
    integrationReceiptDigest: requiredNull(value.integrationReceiptDigest, "claim integration receipt digest"),
  };
  if (claim.state !== "dormant-preserved" || claim.recordedState !== "reviewed"
    || claim.writeAuthority !== false || claim.scopeReserved !== true) {
    throw new Error("Reconciliation requires one dormant-preserved reviewed claim without write authority.");
  }
  if (claim.writeSetDigest !== digestValue(declaredWriteScope)) {
    throw new Error("Dormant claim write-set digest is invalid.");
  }
  if (claim.claimId !== digestValue({
    actorId: claim.actorId,
    canonicalBaseRevision: claim.canonicalBaseRevision,
    leaseEpoch: claim.leaseEpoch,
    repositoryId: claim.repositoryId,
    workItemId: claim.workItemId,
    writeSetDigest: claim.writeSetDigest,
  })) {
    throw new Error("Dormant claim identity digest is invalid.");
  }
  return deepFreeze(claim);
}

function normalizeProvider(value) {
  requireObject(value, "Provider evidence");
  const pullRequest = normalizePullRequest(value.pullRequest);
  const claimHead = normalizeRevision(value.claimHead, "provider claim head");
  const requiredChecks = normalizeRequiredChecks(value.requiredChecks);
  const checkRuns = normalizeCheckRuns(value.checkRuns);
  const completion = value.completion == null ? null : normalizeProviderCompletion(value.completion);
  const provider = {
    provider: requiredText(value.provider, "provider"),
    repository: requiredRepository(value.repository, "provider repository"),
    repositoryId: requiredText(value.repositoryId, "provider repository ID"),
    pullRequest,
    claimHead,
    protectedMain: normalizeProtectedMain(value.protectedMain),
    ancestry: normalizeAncestry(value.ancestry),
    refreshChain: normalizeRefreshChain(value.refreshChain, pullRequest, claimHead),
    mergeCommitParents: normalizeSingleParent(value.mergeCommitParents, "merge commit parents"),
    mergeChangedPaths: Object.freeze(normalizePaths(value.mergeChangedPaths, "merge changed paths")),
    requiredChecks: Object.freeze(requiredChecks),
    checkRuns: Object.freeze(checkRuns),
    ...(completion ? { completion } : {}),
  };
  if (provider.provider !== "github") {
    throw new Error("Merged dormant reconciliation currently requires GitHub provider evidence.");
  }
  const checkedRevisions = [
    provider.claimHead.sha,
    provider.refreshChain.at(-1)?.sha ?? provider.claimHead.sha,
    pullRequest.mergeCommitSha,
  ];
  for (const sha of [...new Set(checkedRevisions)]) {
    for (const required of requiredChecks) {
      if (!checkRuns.some(run => run.name === required.context
        && (required.appId === null || run.appId === required.appId)
        && run.headSha === sha && run.status === "COMPLETED" && run.conclusion === "SUCCESS")) {
        throw new Error(`Required check ${required.context} lacks success on ${sha}.`);
      }
    }
  }
  return deepFreeze(provider);
}

function normalizeProviderCompletion(value) {
  requireObject(value, "Provider completion evidence");
  const completion = {
    mainSha: requiredSha(value.mainSha, "completion main SHA"),
    treeSha: requiredSha(value.treeSha, "completion main tree"),
    mergeCommitIsAncestor: value.mergeCommitIsAncestor,
    mainIsAncestorOfProtectedMain: value.mainIsAncestorOfProtectedMain,
  };
  if (completion.mergeCommitIsAncestor !== true || completion.mainIsAncestorOfProtectedMain !== true) {
    throw new Error("Provider completion evidence does not prove protected-main containment.");
  }
  return Object.freeze(completion);
}

function normalizePullRequest(value) {
  requireObject(value, "Provider pull request");
  const pullRequest = {
    number: positiveInteger(value.number, "pull request number"),
    nodeId: requiredText(value.nodeId, "pull request node ID"),
    url: requiredText(value.url, "pull request URL"),
    state: requiredText(value.state, "pull request state").toUpperCase(),
    draft: value.draft,
    merged: value.merged,
    headRepository: requiredRepository(value.headRepository, "pull request head repository"),
    headBranch: requiredText(value.headBranch, "pull request head branch"),
    headSha: requiredSha(value.headSha, "pull request head SHA"),
    headTreeSha: requiredSha(value.headTreeSha, "pull request head tree"),
    baseRepository: requiredRepository(value.baseRepository, "pull request base repository"),
    baseBranch: requiredText(value.baseBranch, "pull request base branch"),
    mergeCommitSha: requiredSha(value.mergeCommitSha, "pull request merge commit"),
    mergeCommitTreeSha: requiredSha(value.mergeCommitTreeSha, "pull request merge tree"),
  };
  if (pullRequest.state !== "CLOSED" || pullRequest.draft !== false || pullRequest.merged !== true
    || pullRequest.baseBranch !== "main" || pullRequest.headTreeSha !== pullRequest.mergeCommitTreeSha) {
    throw new Error("Provider evidence must prove a closed merged same-tree pull request into main.");
  }
  return Object.freeze(pullRequest);
}

function normalizeProtectedMain(value) {
  requireObject(value, "Protected main evidence");
  const result = {
    branch: requiredText(value.branch, "protected branch"),
    sha: requiredSha(value.sha, "protected main SHA"),
    treeSha: requiredSha(value.treeSha, "protected main tree"),
  };
  if (result.branch !== "main") throw new Error("Provider evidence must bind protected main.");
  return Object.freeze(result);
}

function normalizeAncestry(value) {
  requireObject(value, "Provider ancestry evidence");
  if (value.claimHeadIsAncestorOfPullRequestHead !== true
    || value.mergeCommitIsAncestorOfProtectedMain !== true) {
    throw new Error("Provider evidence does not prove required protected ancestry.");
  }
  return Object.freeze({
    claimHeadIsAncestorOfPullRequestHead: true,
    mergeCommitIsAncestorOfProtectedMain: true,
  });
}

function normalizeRefreshChain(values, pullRequest, claimHead) {
  if (!Array.isArray(values)) throw new Error("Provider refresh chain must be an array.");
  if (values.length === 0) {
    if (claimHead.sha !== pullRequest.headSha || claimHead.treeSha !== pullRequest.headTreeSha) {
      throw new Error("A direct merge requires the reviewed claim head to equal the pull-request head.");
    }
    return Object.freeze([]);
  }
  const chain = values.map((value, index) => {
    requireObject(value, `Refresh chain item ${index}`);
    if (value.secondParentIsAncestorOfProtectedMain !== true) {
      throw new Error("Refresh-chain second parents must be protected-main ancestors.");
    }
    return Object.freeze({
      sha: requiredSha(value.sha, `refresh chain SHA ${index}`),
      treeSha: requiredSha(value.treeSha, `refresh chain tree ${index}`),
      scopeTreeDigest: requiredDigest(value.scopeTreeDigest, `refresh chain scope tree ${index}`),
      parents: normalizeParents(value.parents, `refresh chain parents ${index}`),
      secondParentIsAncestorOfProtectedMain: true,
    });
  });
  if (chain.at(-1).sha !== pullRequest.headSha || chain.at(-1).treeSha !== pullRequest.headTreeSha) {
    throw new Error("Refresh chain does not terminate at the reviewed pull-request head.");
  }
  return Object.freeze(chain);
}

function normalizeParents(values, label) {
  if (!Array.isArray(values) || values.length !== 2) throw new Error(`${label} must contain two SHAs.`);
  return Object.freeze(values.map((value, index) => requiredSha(value, `${label}[${index}]`)));
}

function normalizeSingleParent(values, label) {
  if (!Array.isArray(values) || values.length !== 1) throw new Error(`${label} must contain one SHA.`);
  return Object.freeze([requiredSha(values[0], `${label}[0]`)]);
}

function normalizePaths(values, label) {
  if (!Array.isArray(values) || values.length === 0) throw new Error(`${label} must not be empty.`);
  const paths = values.map(value => requiredText(value, label)).sort();
  rejectDuplicates(paths, label);
  return paths;
}

function normalizeRequiredChecks(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("Provider evidence requires at least one protected required check.");
  }
  const normalized = values.map(value => {
    requireObject(value, "Required check");
    return Object.freeze({
      context: requiredText(value.context, "required check context"),
      appId: optionalPositiveInteger(value.appId, "required check app ID"),
    });
  }).sort(compareChecks);
  rejectDuplicates(normalized.map(check => `${check.context}\0${check.appId}`), "required checks");
  return normalized;
}

function normalizeCheckRuns(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("Provider evidence requires successful check runs.");
  }
  const normalized = values.map(value => {
    requireObject(value, "Check run");
    return Object.freeze({
      name: requiredText(value.name, "check run name"),
      appId: optionalPositiveInteger(value.appId, "check run app ID"),
      headSha: requiredSha(value.headSha, "check run head SHA"),
      status: requiredText(value.status, "check run status").toUpperCase(),
      conclusion: requiredText(value.conclusion, "check run conclusion").toUpperCase(),
    });
  }).sort((left, right) => compareChecks(
    { context: left.name, appId: left.appId },
    { context: right.name, appId: right.appId },
  ));
  rejectDuplicates(normalized.map(run => `${run.name}\0${run.appId}\0${run.headSha}`), "check runs");
  return normalized;
}

function assertSourceJoins({ claim, provider, local }) {
  const authority = local.lease.cloudAuthority;
  if (provider.repositoryId !== claim.repositoryId
    || provider.repository.toLowerCase() !== provider.pullRequest.headRepository.toLowerCase()
    || provider.repository.toLowerCase() !== provider.pullRequest.baseRepository.toLowerCase()
    || provider.claimHead.sha !== claim.laneRevision
    || provider.claimHead.sha !== local.headSha
    || provider.claimHead.treeSha !== local.treeSha
    || local.branch !== provider.pullRequest.headBranch
    || local.lease.branch !== local.branch
    || local.lease.reviewHeadSha !== local.headSha
    || local.lease.baseSha !== claim.canonicalBaseRevision
    || local.lease.pullRequestUrl !== provider.pullRequest.url
    || claim.reviewRequestId !== `github-pull-request:${provider.pullRequest.nodeId}`) {
    throw new Error("Provider, claim, and preserved local revision identities do not join.");
  }
  const { fence, reviewedHead } = local.lineage;
  if (fence.sha !== local.lease.fenceSha || fence.parentSha !== claim.canonicalBaseRevision
    || fence.treeSha !== fence.parentTreeSha || reviewedHead.sha !== local.headSha
    || reviewedHead.treeSha !== local.treeSha || reviewedHead.parentSha !== fence.sha
    || reviewedHead.changedPaths.some(path => !writeSetCoversPath(claim.declaredWriteScope, path))) {
    throw new Error("Local fence and reviewed-head lineage is not the exact scope-covered chain.");
  }
  let previous = provider.claimHead.sha;
  for (const refresh of provider.refreshChain) {
    if (refresh.parents[0] !== previous) {
      throw new Error("Provider refresh chain is not an exact first-parent sequence.");
    }
    if (refresh.scopeTreeDigest !== provider.claimHead.scopeTreeDigest) {
      throw new Error("Provider refresh chain changes the reviewed scope bytes.");
    }
    previous = refresh.sha;
  }
  const lastMainParent = provider.refreshChain.at(-1)?.parents[1] ?? claim.canonicalBaseRevision;
  if (provider.mergeCommitParents[0] !== lastMainParent
    || provider.mergeChangedPaths.some(path => !writeSetCoversPath(claim.declaredWriteScope, path))) {
    throw new Error("Provider merge topology or changed paths escape the reviewed claim.");
  }
  const pairs = [
    [authority.claimId, claim.claimId],
    [authority.claimDigest, claim.claimDigest],
    [authority.claimLedgerRevision, claim.transitionDigest],
    [authority.operationReceiptDigest, claim.operationReceiptDigest],
    [authority.canonicalBaseSha, claim.canonicalBaseRevision],
    [authority.laneRevision, claim.laneRevision],
    [authority.writeSetDigest, claim.writeSetDigest],
    [authority.reviewRequestId, claim.reviewRequestId],
    [authority.focusedEvidenceDigest, claim.evidenceDigest],
    [authority.leaseEpoch, claim.leaseEpoch],
    [authority.transitionCounter, claim.transitionCounter],
  ];
  if (pairs.some(([left, right]) => left !== right)) {
    throw new Error("Local cloud authority does not exactly project the dormant claim.");
  }
  if (authority.deviceId !== local.lease.device || authority.sessionId !== local.lease.sessionId
    || pseudonymousIdentifier("device", authority.deviceId) !== claim.deviceId
    || pseudonymousIdentifier("session", authority.sessionId) !== claim.sessionId) {
    throw new Error("Local owner inputs do not map to the cloud claim owner identity.");
  }
  if ((local.mode === "completed-absent") !== Boolean(provider.completion)) {
    throw new Error("Provider completion evidence must exactly match the local evidence mode.");
  }
  if (local.mode === "completed-absent" && (
    local.absence.localBranchPresent !== true
    || local.canonicalAnchor.sha !== provider.protectedMain.sha
    || local.canonicalAnchor.treeSha !== provider.protectedMain.treeSha
    || local.lease.worktreePath !== local.worktreePath
    || local.lease.completion.mergeCommitSha !== provider.pullRequest.mergeCommitSha
    || local.lease.completion.mainSha !== provider.completion.mainSha
    || provider.completion.mergeCommitIsAncestor !== true
    || provider.completion.mainIsAncestorOfProtectedMain !== true
  )) {
    throw new Error("Completed local lease does not join the immutable merged provider proof.");
  }
}

function normalizeRevision(value, label) {
  requireObject(value, label);
  return Object.freeze({
    sha: requiredSha(value.sha, `${label} SHA`),
    treeSha: requiredSha(value.treeSha, `${label} tree`),
    scopeTreeDigest: requiredDigest(value.scopeTreeDigest, `${label} scope tree digest`),
  });
}

function compareChecks(left, right) {
  return left.context.localeCompare(right.context) || String(left.appId).localeCompare(String(right.appId));
}

function rejectDuplicates(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique.`);
}

function writeSetCoversPath(writeSet, changedPath) {
  return writeSet.some(scope => {
    if (!scope.startsWith("path:")) return false;
    const ownedPath = scope.slice("path:".length);
    return ownedPath === "." || changedPath === ownedPath || changedPath.startsWith(`${ownedPath}/`);
  });
}

function requiredRepository(value, label) {
  const repository = requiredText(value, label);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
    throw new Error(`${label} must use owner/repository form.`);
  }
  return repository;
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.normalize("NFC").trim();
}

function requiredSha(value, label) {
  const sha = requiredText(value, label);
  if (!SHA_PATTERN.test(sha)) throw new Error(`${label} must be a lowercase SHA.`);
  return sha;
}

function requiredDigest(value, label) {
  const digest = requiredText(value, label);
  if (!DIGEST_PATTERN.test(digest)) throw new Error(`${label} must be a SHA-256 digest.`);
  return digest;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}

function optionalPositiveInteger(value, label) {
  return value === null ? null : positiveInteger(value, label);
}

function requiredNull(value, label) {
  if (value !== null) throw new Error(`${label} must be null.`);
  return null;
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
