import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { DELIVERY_BASE_RECOVERY_EVIDENCE_SCHEMA } from "./delivery-authorized-base-recovery-contract.mjs";
import { verifyProtectedMainRefreshChain } from "./protected-main-refresh-lib.mjs";
import { parseWriterLeasePullRequestBody } from "./writer-lease-lib.mjs";
import { writerLeaseDigest } from "./writer-lease-registry-cas.mjs";

const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;

export function collectDeliveryAuthorizedBaseRecoveryEvidence({
  branch,
  execute,
  fetchExactRefs,
  git,
  identity,
  lease,
  manifest,
  provider,
  sessionId,
  cloudStatus,
}) {
  fetchExactRefs();
  const authority = lease.cloudAuthority;
  if (!authority) invalid("cloud authority");
  const matches = cloudStatus.claims.filter(item => item?.claimId === authority.claimId);
  if (matches.length !== 1) invalid("one live predecessor claim");
  const claim = matches[0];
  const localHeadSha = sha(git(["rev-parse", "HEAD"]), "local head");
  const remoteHeadSha = sha(
    git(["rev-parse", `refs/remotes/origin/${branch}`]),
    "remote head",
  );
  const protectedMainSha = sha(
    git(["rev-parse", "refs/remotes/origin/main"]),
    "protected main",
  );
  const deliveryBaseSha = sha(provider.pull.baseRefOid, "delivery base");
  const deliveredHeadSha = sha(lease.deliveryHeadSha, "delivery head");
  const protectedRefresh = verifyProtectedMainRefreshChain({
    expectedHeadSha: deliveredHeadSha,
    observedHeadSha: localHeadSha,
    gitText: git,
    mainRef: "refs/remotes/origin/main",
  });
  const protectedRefreshSteps = protectedRefresh
    ? (protectedRefresh.refreshes || [protectedRefresh])
    : [];
  const protectedRefreshBaseSha = protectedRefreshSteps.at(-1)?.mainParentSha || null;
  const declaredPaths = new Set(manifest.declaredWriteSet
    .filter(item => item.startsWith("path:"))
    .map(item => item.slice(5)));
  const deliveryChangedPaths = changedPaths(git, deliveryBaseSha, localHeadSha);
  const protectedMainChangedPaths = changedPaths(
    git,
    deliveryBaseSha,
    protectedMainSha,
  );
  const protectedMainOverlapPaths = protectedMainChangedPaths
    .filter(item => declaredPaths.has(item));
  const outsideScopeRecords = deliveryChangedPaths
    .filter(item => !declaredPaths.has(item))
    .map(item => ({
      path: item,
      delivery: treeEntry(git, deliveryBaseSha, item),
      head: treeEntry(git, localHeadSha, item),
    }));
  const originalAuthoredPaths = deliveryChangedPaths;
  const marker = parseWriterLeasePullRequestBody(provider.pull.body);
  return Object.freeze({
    schema: DELIVERY_BASE_RECOVERY_EVIDENCE_SCHEMA,
    repository: text(provider.repository.nameWithOwner, "repository identity"),
    repositoryId: text(provider.repository.id, "repository ID"),
    actorLogin: text(provider.actor.login, "actor login"),
    actorId: positiveInteger(provider.actor.id, "actor ID"),
    pullRequestAuthorLogin: text(provider.pull.author?.login, "pull request author"),
    branch,
    sessionId,
    deviceId: identity.device,
    semanticScope: identity.scope,
    headSha: localHeadSha,
    treeSha: sha(git(["rev-parse", `${localHeadSha}^{tree}`]), "head tree"),
    remoteHeadSha,
    protectedMainSha,
    protectedMainTreeSha: sha(
      git(["rev-parse", `${protectedMainSha}^{tree}`]),
      "protected main tree",
    ),
    originalBaseSha: sha(lease.baseSha, "original base"),
    deliveryBaseSha,
    fenceSha: sha(lease.fenceSha, "fence"),
    deliveryHeadSha: deliveredHeadSha,
    protectedRefreshReceiptDigest: protectedRefresh
      ? digestValue(protectedRefresh)
      : null,
    protectedRefreshBaseSha,
    protectedRefreshCount: protectedRefreshSteps.length,
    leaseStatus: text(lease.status, "lease status"),
    leaseEpoch: positiveInteger(lease.epoch, "lease epoch"),
    leaseDigest: writerLeaseDigest(lease),
    pullRequestNumber: positiveInteger(provider.pull.number, "pull request number"),
    pullRequestNodeId: text(provider.pull.id, "pull request node ID"),
    pullRequestState: text(provider.pull.state, "pull request state"),
    pullRequestIsDraft: Boolean(provider.pull.isDraft),
    pullRequestHeadSha: sha(provider.pull.headRefOid, "pull request head"),
    pullRequestBaseSha: sha(provider.pull.baseRefOid, "pull request base"),
    pullRequestAutoMergeRequest: provider.pull.autoMergeRequest || null,
    pullRequestBodyDigest: digestValue(String(provider.pull.body || "")),
    pullRequestMarkerDigest: marker ? digestValue(marker) : null,
    claimId: digest(claim.claimId, "claim ID"),
    claimDigest: digest(claim.fenceRevision, "claim digest"),
    claimLedgerRevision: digest(claim.transitionDigest, "claim ledger revision"),
    ledgerRevision: sha(cloudStatus.ledgerRevision, "ledger revision"),
    ledgerDigest: digest(cloudStatus.ledgerDigest, "ledger digest"),
    claimInventoryDigest: digestValue(cloudStatus.claims),
    claimState: text(claim.state, "claim state"),
    projectedAuthorityState: text(authority.state, "projected authority state"),
    projectedAuthorityDigest: digestValue(authority),
    claimActorId: text(claim.actorId, "claim actor ID"),
    claimRepositoryId: text(claim.repositoryId, "claim repository ID"),
    claimWriteAuthority: Boolean(claim.writeAuthority),
    claimScopeReserved: Boolean(claim.scopeReserved),
    claimLeaseEpoch: positiveInteger(claim.leaseEpoch, "claim lease epoch"),
    claimTransitionCounter: positiveInteger(claim.transitionCounter, "claim transition"),
    claimCanonicalBaseSha: sha(claim.canonicalBaseRevision, "claim base"),
    claimLaneRevision: sha(claim.laneRevision, "claim lane revision"),
    claimReviewRequestId: text(claim.reviewRequestId, "claim review request"),
    claimWorkItemId: text(claim.workItemId, "claim work item"),
    operationReceiptDigest: digest(claim.operationReceiptDigest, "operation receipt"),
    integrationReceiptDigest: digest(claim.integrationReceiptDigest, "integration receipt"),
    manifestDigest: manifest.manifestDigest,
    writeSetDigest: manifest.writeSetDigest,
    declaredWriteSet: manifest.declaredWriteSet,
    deliveryChangedPaths,
    protectedMainChangedPaths,
    protectedMainOverlapPaths,
    originalAuthoredPaths,
    outsideScopeEquivalenceDigest: digestValue(outsideScopeRecords),
    clean: git(["status", "--porcelain=v1", "--untracked-files=all"]) === "",
    originalBaseAncestor: isAncestor(execute, lease.baseSha, localHeadSha),
    deliveryBaseAncestor: isAncestor(execute, deliveryBaseSha, localHeadSha),
    deliveryBaseAncestorOfProtectedMain: isAncestor(
      execute,
      deliveryBaseSha,
      protectedMainSha,
    ),
    fenceAncestor: isAncestor(execute, lease.fenceSha, localHeadSha),
  });
}

function changedPaths(git, baseSha, headSha) {
  return Object.freeze(git(["diff", "--name-only", `${baseSha}..${headSha}`, "--"])
    .split(/\r?\n/u).filter(Boolean).sort());
}
function treeEntry(git, revision, filePath) {
  return git(["ls-tree", revision, "--", filePath]);
}
function isAncestor(execute, ancestor, descendant) {
  try {
    execute("git", ["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}
function text(value, label) {
  const result = String(value ?? "").trim();
  if (!result || result.includes("\0")) invalid(label);
  return result;
}
function sha(value, label) {
  const result = text(value, label);
  if (!SHA.test(result)) invalid(label);
  return result;
}
function digest(value, label) {
  const result = text(value, label);
  if (!DIGEST.test(result)) invalid(label);
  return result;
}
function positiveInteger(value, label) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) invalid(label);
  return result;
}
function invalid(label) {
  throw new Error(`Delivery-authorized base recovery ${label} is invalid.`);
}
