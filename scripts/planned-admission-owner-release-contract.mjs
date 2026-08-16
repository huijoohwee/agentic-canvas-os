// Responsibility: Seal one abandoned planned owner and its preserved successor evidence.
import { digestValue } from "./cloud-collaboration-primitives.mjs";

export const PLAN_SCHEMA = "agentic-planned-admission-owner-release-plan/v1";
export const RECEIPT_SCHEMA = "agentic-planned-admission-owner-release-receipt/v1";

export function buildPlan(input) {
  const core = {
    schema: PLAN_SCHEMA,
    ledgerRepository: text(input.ledgerRepository, "ledger repository"),
    targetRepository: text(input.targetRepository, "target repository"),
    claim: claim(input.claim),
    ledgerRevision: sha(input.ledgerRevision, "ledger revision"),
    ledgerDigest: digest(input.ledgerDigest, "ledger digest"),
    pullRequest: pullRequest(input.pullRequest),
    remoteBranchHead: sha(input.remoteBranchHead, "remote branch head"),
    staleLease: object(input.staleLease, "stale lease"),
    staleLeaseDigest: digest(input.staleLeaseDigest, "stale lease digest"),
    leaseRegistryDigest: digest(input.leaseRegistryDigest, "lease registry digest"),
    sourceProjection: absentProjection(input.sourceProjection),
    preservedLane: preservedLane(input.preservedLane),
  };
  if (core.claim.laneRevision !== core.pullRequest.headSha
    || core.pullRequest.headSha !== core.remoteBranchHead) {
    throw new Error("Claim, pull request, and remote branch must preserve one exact head.");
  }
  if (core.claim.reviewRequestId !== `github-pull-request:${core.pullRequest.nodeId}`) {
    throw new Error("Claim review identity must match the exact pull request.");
  }
  if (core.staleLeaseDigest !== digestValue(core.staleLease)) {
    throw new Error("Stale lease digest is invalid.");
  }
  const planDigest = digestValue(core);
  return Object.freeze({ ...core, planDigest,
    exactAuthorization: `authorize planned-admission-owner-release ${planDigest}` });
}

export function normalizePlan(value) {
  const normalized = buildPlan(value);
  if (value?.planDigest !== normalized.planDigest
    || value?.exactAuthorization !== normalized.exactAuthorization) {
    throw new Error("Plan digest is invalid.");
  }
  return normalized;
}

export function authorizePlan(plan, authorization) {
  const normalized = normalizePlan(plan);
  if (authorization !== normalized.exactAuthorization) {
    throw new Error("Exact planned-admission owner-release authorization is required.");
  }
  return normalized;
}

export function buildReceipt({ plan, cloud, provider, releasedLease, completedAt }) {
  const normalized = normalizePlan(plan);
  const core = {
    schema: RECEIPT_SCHEMA,
    status: "completed",
    planDigest: normalized.planDigest,
    claimId: normalized.claim.claimId,
    cloudRetirementReceiptDigest: digest(cloud?.receiptDigest, "cloud retirement receipt"),
    provider: {
      pullRequestUrl: normalized.pullRequest.url,
      pullRequestNumber: normalized.pullRequest.number,
      disposition: provider?.disposition === "closed-unmerged" ? provider.disposition : invalidDisposition(),
      closedAt: instant(provider?.closedAt, "provider closedAt"),
      remoteBranchPreserved: provider?.remoteBranchPreserved === true,
    },
    releasedLeaseDigest: digestValue(releasedLease),
    preservedLaneStateDigest: normalized.preservedLane.stateDigest,
    preservation: {
      remoteBranch: true,
      originalLeaseProjection: true,
      authoredLaneBytes: true,
      authoredLaneRegistration: true,
    },
    deployment: false,
    completedAt: instant(completedAt, "completedAt"),
  };
  if (!core.provider.remoteBranchPreserved) throw new Error("Remote branch preservation is required.");
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}

function claim(value) {
  const source = object(value, "claim");
  const result = {
    claimId: digest(source.claimId, "claim ID"),
    state: text(source.state, "claim state"),
    writeAuthority: source.writeAuthority === true,
    scopeReserved: source.scopeReserved === true,
    laneRevision: sha(source.laneRevision, "claim lane revision"),
    fenceRevision: digest(source.fenceRevision, "claim fence"),
    transitionCounter: positive(source.transitionCounter, "claim transition counter"),
    reviewRequestId: text(source.reviewRequestId, "claim review request ID"),
  };
  if (result.state !== "dormant-preserved" || result.writeAuthority || !result.scopeReserved) {
    throw new Error("Claim is not one dormant planned owner.");
  }
  return result;
}
function pullRequest(value) {
  const source = object(value, "pull request");
  const result = { url: text(source.url, "pull-request URL"), number: positive(source.number, "pull-request number"),
    nodeId: text(source.nodeId, "pull-request node ID"), state: text(source.state, "pull-request state"),
    isDraft: source.isDraft === true, mergedAt: source.mergedAt ?? null,
    branch: text(source.branch, "pull-request branch"), headSha: sha(source.headSha, "pull-request head"),
    baseBranch: text(source.baseBranch, "pull-request base branch"), baseSha: sha(source.baseSha, "pull-request base") };
  if (result.state !== "OPEN" || !result.isDraft || result.mergedAt !== null) {
    throw new Error("Pull request must be one open unmerged draft.");
  }
  return result;
}
function absentProjection(value) {
  const source = object(value, "source projection");
  if (source.worktreePresent !== false || source.localBranchPresent !== false) {
    throw new Error("Abandoned source worktree and local branch must both be absent.");
  }
  return { worktreePath: text(source.worktreePath, "source worktree path"),
    branch: text(source.branch, "source branch"), worktreePresent: false, localBranchPresent: false };
}
function preservedLane(value) {
  const source = object(value, "preserved lane");
  const result = { path: text(source.path, "preserved lane path"), branch: text(source.branch, "preserved lane branch"),
    headSha: sha(source.headSha, "preserved lane head"), treeSha: sha(source.treeSha, "preserved lane tree"),
    dirty: source.dirty === true, changedPaths: [...(source.changedPaths || [])].map(item => text(item, "changed path")).sort(),
    workingTreeDigest: digest(source.workingTreeDigest, "preserved working-tree digest"),
    stateDigest: digest(source.stateDigest, "preserved lane state digest"), pullRequest: source.pullRequest ?? null };
  if (!result.dirty || result.changedPaths.length === 0 || result.pullRequest !== null) {
    throw new Error("Preserved successor must be one dirty pull-request-free lane.");
  }
  return result;
}
function object(value, label) { if (!value || Array.isArray(value) || typeof value !== "object") throw new Error(`${label} is required.`); return structuredClone(value); }
function text(value, label) { if (typeof value !== "string" || !value) throw new Error(`${label} is required.`); return value; }
function sha(value, label) { if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) throw new Error(`${label} is invalid.`); return value; }
function digest(value, label) { if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) throw new Error(`${label} is invalid.`); return value; }
function positive(value, label) { if (!Number.isInteger(value) || value < 1) throw new Error(`${label} is invalid.`); return value; }
function instant(value, label) { const date = new Date(value); if (!value || date.toISOString() !== value) throw new Error(`${label} is invalid.`); return value; }
function invalidDisposition() { throw new Error("Provider disposition must be closed-unmerged."); }
