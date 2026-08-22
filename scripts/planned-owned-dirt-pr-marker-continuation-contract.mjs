// Responsibility: Seal one exact local-projected planned-owned-dirt continuation decision.
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";

export const OPERATION = "planned-owned-dirt-pr-marker-continuation";
export const PLAN_SCHEMA = "agentic-planned-owned-dirt-pr-marker-continuation-plan/v1";

export function buildPlan(values) {
  const source = object(values, "continuation evidence");
  const core = {
    schema: PLAN_SCHEMA,
    operation: OPERATION,
    originalPlanDigest: digest(source.originalPlanDigest, "original plan digest"),
    originalIntentDigest: digest(source.originalIntentDigest, "original intent digest"),
    repositoryPathDigest: digest(source.repositoryPathDigest, "repository path digest"),
    branch: text(source.branch, "branch"),
    sourceSessionId: text(source.sourceSessionId, "source session"),
    pullRequestUrl: text(source.pullRequestUrl, "pull request URL"),
    pullRequestNumber: integer(source.pullRequestNumber, "pull request number"),
    headSha: sha(source.headSha, "head SHA"),
    remoteHeadSha: sha(source.remoteHeadSha, "remote head SHA"),
    dirtDigest: digest(source.dirtDigest, "dirt digest"),
    successorClaimId: digest(source.successorClaimId, "successor claim ID"),
    successorClaimDigest: digest(source.successorClaimDigest, "successor claim digest"),
    targetLeaseDigest: digest(source.targetLeaseDigest, "target lease digest"),
    targetTaskAuthorityBindingDigest: digest(source.targetTaskAuthorityBindingDigest,
      "target task-authority binding digest"),
    sourceMarkerDigest: digest(source.sourceMarkerDigest, "source marker digest"),
    sourceBodyDigest: digest(source.sourceBodyDigest, "source body digest"),
    targetMarkerDigest: digest(source.targetMarkerDigest, "target marker digest"),
    cloudVerificationReceiptDigest: digest(source.cloudVerificationReceiptDigest,
      "cloud verification receipt digest"),
    mutationAuthorityReceiptDigest: digest(source.mutationAuthorityReceiptDigest,
      "mutation-authority receipt digest"),
    observedAt: instant(source.observedAt, "observedAt"),
    allowedMutations: ["pull-request-marker", "private-replay-journal"],
    forbiddenMutations: ["git", "index", "ref", "cloud-ledger", "writer-registry",
      "pull-request-state", "merge", "deployment", "cleanup"],
  };
  return Object.freeze({ ...core, planDigest: digestValue(core) });
}

export function normalizePlan(value) {
  if (value?.schema !== PLAN_SCHEMA || value.operation !== OPERATION) invalid("plan schema");
  const rebuilt = buildPlan(value);
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("canonical plan");
  return rebuilt;
}

export function authorize(plan, value) {
  const sealed = normalizePlan(plan);
  const exactAuthorization = `authorize ${OPERATION} ${sealed.planDigest}`;
  if (String(value || "").trim() !== exactAuthorization) {
    throw new Error(`Continuation requires: ${exactAuthorization}`);
  }
  return exactAuthorization;
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  return value;
}
function text(value, label) {
  if (typeof value !== "string" || !value.trim()) invalid(label);
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
function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) invalid(label);
  return value;
}
function instant(value, label) {
  if (!value || new Date(value).toISOString() !== value) invalid(label);
  return value;
}
function invalid(label) {
  throw new Error(`Planned-owned-dirt PR-marker continuation has invalid ${label}.`);
}
