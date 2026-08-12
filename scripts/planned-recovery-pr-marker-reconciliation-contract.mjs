// Responsibility: Seal exact authority and receipts for terminal planned-marker reconciliation.
import { digestValue } from "./cloud-collaboration-primitives.mjs";

export const PLAN_SCHEMA = "agentic-planned-recovery-pr-marker-reconciliation-plan/v1";
export const RECEIPT_SCHEMA = "agentic-planned-recovery-pr-marker-reconciliation-receipt/v1";

export function buildPlan(input) {
  const core = {
    schema: PLAN_SCHEMA,
    repository: text(input.repository, "repository"),
    sourceWorktree: text(input.sourceWorktree, "source worktree"),
    branch: text(input.branch, "branch"),
    headSha: sha(input.headSha, "head SHA"),
    treeSha: sha(input.treeSha, "tree SHA"),
    remoteHeadSha: sha(input.remoteHeadSha, "remote head SHA"),
    sourceLeaseDigest: digest(input.sourceLeaseDigest, "source lease digest"),
    sourceMarkerDigest: digest(input.sourceMarkerDigest, "source marker digest"),
    sourceBodyDigest: digest(input.sourceBodyDigest, "source body digest"),
    pullRequestUrl: text(input.pullRequestUrl, "pull-request URL"),
    pullRequestNumber: integer(input.pullRequestNumber, "pull-request number"),
    pullRequestNodeId: text(input.pullRequestNodeId, "pull-request node ID"),
    ledgerRepository: text(input.ledgerRepository, "ledger repository"),
    targetRepository: text(input.targetRepository, "target repository"),
    claimId: digest(input.claimId, "claim ID"),
    claimDigest: digest(input.claimDigest, "claim digest"),
    claimTransitionCounter: integer(input.claimTransitionCounter, "claim transition counter"),
    sessionId: text(input.sessionId, "session ID"),
    operatorDecisionDigest: digest(input.operatorDecisionDigest, "operator decision digest"),
  };
  if (core.headSha !== core.remoteHeadSha) throw new Error("Source and remote heads must match.");
  const planDigest = digestValue(core);
  return Object.freeze({ ...core, planDigest,
    exactAuthorization: `authorize planned-recovery-pr-marker-reconciliation ${planDigest}` });
}

export function normalizePlan(value) {
  const rebuilt = buildPlan(value);
  if (value?.planDigest !== rebuilt.planDigest
    || value?.exactAuthorization !== rebuilt.exactAuthorization) throw new Error("Plan digest is invalid.");
  return rebuilt;
}

export function authorizePlan(plan, authorization) {
  const normalized = normalizePlan(plan);
  if (authorization !== normalized.exactAuthorization) throw new Error("Exact reconciliation authorization is required.");
  return normalized;
}

export function buildReceipt({ plan, provider, releasedLeaseDigest, targetMarkerDigest, completedAt }) {
  const normalized = normalizePlan(plan);
  const core = {
    schema: RECEIPT_SCHEMA,
    status: "completed",
    planDigest: normalized.planDigest,
    sourceLeaseDigest: normalized.sourceLeaseDigest,
    sourceMarkerDigest: normalized.sourceMarkerDigest,
    claimId: normalized.claimId,
    claimDigest: normalized.claimDigest,
    provider: {
      pullRequestUrl: normalized.pullRequestUrl,
      pullRequestNumber: normalized.pullRequestNumber,
      pullRequestNodeId: normalized.pullRequestNodeId,
      disposition: provider?.disposition === "closed-unmerged" ? "closed-unmerged" : invalidDisposition(),
      closedAt: instant(provider?.closedAt, "provider closedAt"),
    },
    releasedLeaseDigest: digest(releasedLeaseDigest, "released lease digest"),
    targetMarkerDigest: digest(targetMarkerDigest, "target marker digest"),
    preservation: { worktree: true, branch: true, remoteBranch: true, authoredBytes: true },
    deployment: false,
    completedAt: instant(completedAt, "completedAt"),
  };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}

function text(value, label) { if (typeof value !== "string" || !value) throw new Error(`${label} is required.`); return value; }
function sha(value, label) { if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) throw new Error(`${label} is invalid.`); return value; }
function digest(value, label) { if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) throw new Error(`${label} is invalid.`); return value; }
function integer(value, label) { if (!Number.isInteger(value) || value < 1) throw new Error(`${label} is invalid.`); return value; }
function instant(value, label) { const date = new Date(value); if (!value || date.toISOString() !== value) throw new Error(`${label} is invalid.`); return value; }
function invalidDisposition() { throw new Error("Provider disposition must be closed-unmerged."); }
