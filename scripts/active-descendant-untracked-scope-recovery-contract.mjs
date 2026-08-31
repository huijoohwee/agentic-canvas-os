// Responsibility: Bind one untracked-owner incident to the integrated scope-expansion controller.
import { canonicalJson, digestValue }
  from "./cloud-collaboration-primitives.mjs";
import { normalizeActiveDirtyScopeExpansionPlan }
  from "./active-dirty-scope-expansion-contract.mjs";
import {
  activeDescendantUntrackedStableIncidentDigest,
  normalizeActiveDescendantUntrackedIncident,
} from "./active-descendant-untracked-scope-recovery-evidence.mjs";

export const OPERATION = "active-descendant-untracked-scope-recovery";
export const PLAN_SCHEMA = `agentic-${OPERATION}-plan/v2`;
export const AUTHORIZATION_SCHEMA = `agentic-${OPERATION}-authorization/v2`;
export const COMPLETION_SCHEMA = `agentic-${OPERATION}-completion/v2`;

const DIGEST = /^[0-9a-f]{64}$/u;

export function buildActiveDescendantUntrackedScopeRecoveryPlan({
  incident,
  innerPlan,
} = {}) {
  const normalizedIncident = normalizeActiveDescendantUntrackedIncident(incident);
  const normalizedInner = normalizeActiveDirtyScopeExpansionPlan(innerPlan);
  requireInnerJoin(normalizedIncident, normalizedInner);
  const core = {
    schema: PLAN_SCHEMA,
    operation: OPERATION,
    incident: normalizedIncident,
    incidentDigest: normalizedIncident.incidentDigest,
    stableIncidentDigest:
      activeDescendantUntrackedStableIncidentDigest(normalizedIncident),
    innerPlan: normalizedInner,
    innerPlanDigest: normalizedInner.planDigest,
    sourceClaimId: normalizedIncident.sourceClaimId,
    sourceLeaseDigest: normalizedIncident.sourceLeaseDigest,
    sourceFenceSha: normalizedIncident.sourceFenceSha,
    sourceHeadSha: normalizedIncident.sourceHeadSha,
    sourceDirtEvidenceDigest: normalizedIncident.dirt.evidenceDigest,
    ownerStopReceiptDigest: normalizedIncident.ownerStop.receiptDigest,
    targetManifestDigest: normalizedIncident.targetManifestDigest,
    targetWriteSetDigest: normalizedIncident.targetWriteSetDigest,
    allowedMutations: [
      "scope-expansion-registry-intent",
      "task-authority-successor-continuation",
      "cloud-waiting-successor",
      "cloud-source-retirement",
      "cloud-successor-promotion",
      "cloud-successor-review-binding",
      "writer-registry-cas",
      "pull-request-marker-replacement",
    ],
    forbiddenMutations: [
      "source-bytes",
      "index",
      "head",
      "local-ref",
      "remote-ref",
      "commit",
      "push",
      "pull-request-visible-body",
      "pull-request-state",
      "review",
      "integration",
      "merge",
      "deployment",
      "cleanup",
    ],
  };
  const planDigest = digestValue(core);
  return deepFreeze({
    ...core,
    planDigest,
    exactAuthorization: `authorize ${OPERATION} ${planDigest}`,
  });
}

export function normalizeActiveDescendantUntrackedScopeRecoveryPlan(value) {
  if (value?.schema !== PLAN_SCHEMA || value.operation !== OPERATION) {
    invalid("plan schema");
  }
  const rebuilt = buildActiveDescendantUntrackedScopeRecoveryPlan({
    incident: value.incident,
    innerPlan: value.innerPlan,
  });
  if (canonicalJson(value) !== canonicalJson(rebuilt)) {
    invalid("canonical plan projection");
  }
  return rebuilt;
}

export function authorizeActiveDescendantUntrackedScopeRecovery(
  plan,
  authorization,
) {
  const normalized = normalizeActiveDescendantUntrackedScopeRecoveryPlan(plan);
  if (authorization !== normalized.exactAuthorization) {
    throw new Error(
      `Recovery requires exact authorization: ${normalized.exactAuthorization}`,
    );
  }
  const core = {
    schema: AUTHORIZATION_SCHEMA,
    status: "authorized",
    planDigest: normalized.planDigest,
    statement: authorization,
  };
  return deepFreeze({ ...core, authorizationDigest: digestValue(core) });
}

export function buildActiveDescendantUntrackedScopeRecoveryReceipt({
  plan,
  authorizationReceipt,
  innerResult,
  terminal,
} = {}) {
  const normalized = normalizeActiveDescendantUntrackedScopeRecoveryPlan(plan);
  const authorization = normalizeAuthorization(authorizationReceipt, normalized);
  const expansion = normalizeInnerResult(innerResult, normalized);
  const final = normalizeTerminal(terminal, normalized, expansion);
  const core = {
    schema: COMPLETION_SCHEMA,
    status: "authoring-authority-restored",
    planDigest: normalized.planDigest,
    authorizationDigest: authorization.authorizationDigest,
    innerPlanDigest: normalized.innerPlanDigest,
    innerCompletionReceiptDigest: expansion.receiptDigest,
    innerIntentDigest: expansion.intentDigest,
    sourceClaimId: normalized.sourceClaimId,
    successorClaimId: final.successorClaimId,
    targetLeaseDigest: final.targetLeaseDigest,
    targetMarkerDigest: final.targetMarkerDigest,
    sourceHeadSha: normalized.sourceHeadSha,
    sourceDirtEvidenceDigest: normalized.sourceDirtEvidenceDigest,
    ownerStopReceiptDigest: normalized.ownerStopReceiptDigest,
    stableIncidentDigest: normalized.stableIncidentDigest,
    terminalEvidenceDigest: final.terminalEvidenceDigest,
    mutationAuthorityGranted: true,
    authoringAuthority: true,
    reviewAuthority: false,
    integrationAuthority: false,
    deploymentAuthority: false,
    cleanupAuthority: false,
    sourceMutation: false,
    indexMutation: false,
    headMutation: false,
    localRefMutation: false,
    remoteRefMutation: false,
    commitMutation: false,
    pushMutation: false,
    pullRequestVisibleBodyMutation: false,
    pullRequestMarkerMutation: true,
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function requireInnerJoin(incident, inner) {
  if (inner.sourceBranch !== incident.sourceBranch
    || inner.sourceFenceSha !== incident.sourceFenceSha
    || inner.sourceLeaseDigest !== incident.sourceLeaseDigest
    || inner.sourceClaimId !== incident.sourceClaimId
    || inner.sourceClaimDigest !== incident.sourceClaimDigest
    || inner.sourceClaimTransitionCounter !== incident.sourceTransitionCounter
    || inner.sourceWriteSetDigest !== incident.sourceWriteSetDigest
    || inner.sourceManifestDigest !== incident.sourceManifestDigest
    || inner.sourceDirtyDigest !== incident.dirt.evidenceDigest
    || canonicalJson(inner.sourceChangedPaths)
      !== canonicalJson(incident.trackedDirtyPaths)
    || inner.targetCanonicalBaseSha !== incident.sourceBaseSha
    || inner.targetManifestDigest !== incident.targetManifestDigest
    || inner.targetWriteSetDigest !== incident.targetWriteSetDigest
    || canonicalJson(inner.targetDeclaredWriteSet)
      !== canonicalJson(incident.targetDeclaredWriteSet)) {
    invalid("integrated scope-expansion plan join");
  }
}

function normalizeAuthorization(value, plan) {
  const core = {
    schema: value?.schema,
    status: value?.status,
    planDigest: digest(value?.planDigest, "authorization plan"),
    statement: String(value?.statement || ""),
  };
  const authorizationDigest = digest(
    value?.authorizationDigest,
    "authorization digest",
  );
  if (core.schema !== AUTHORIZATION_SCHEMA || core.status !== "authorized"
    || core.planDigest !== plan.planDigest
    || core.statement !== plan.exactAuthorization
    || authorizationDigest !== digestValue(core)) invalid("authorization receipt");
  return { ...core, authorizationDigest };
}

function normalizeInnerResult(value, plan) {
  if (value?.schema !== "agentic-active-dirty-scope-expansion-result/v1"
    || value.status !== "complete"
    || value.plan?.planDigest !== plan.innerPlanDigest
    || value.intent?.status !== "complete"
    || value.intent?.planDigest !== plan.innerPlanDigest
    || !DIGEST.test(String(value.intent?.intentDigest || ""))
    || !DIGEST.test(String(value.receiptDigest || ""))) {
    invalid("integrated scope-expansion completion");
  }
  return {
    receiptDigest: value.receiptDigest,
    intentDigest: value.intent.intentDigest,
  };
}

function normalizeTerminal(value, plan, expansion) {
  const core = {
    stableIncidentDigest: digest(
      value?.stableIncidentDigest,
      "terminal incident",
    ),
    sourceHeadSha: String(value?.sourceHeadSha || ""),
    sourceDirtEvidenceDigest: digest(
      value?.sourceDirtEvidenceDigest,
      "terminal dirt",
    ),
    successorClaimId: digest(value?.successorClaimId, "terminal successor"),
    targetLeaseDigest: digest(value?.targetLeaseDigest, "terminal lease"),
    targetMarkerDigest: digest(value?.targetMarkerDigest, "terminal marker"),
    innerCompletionReceiptDigest: digest(
      value?.innerCompletionReceiptDigest,
      "terminal inner completion",
    ),
    mutationAuthorityReceiptDigest: digest(
      value?.mutationAuthorityReceiptDigest,
      "terminal mutation authority",
    ),
    cloudVerificationReceiptDigest: digest(
      value?.cloudVerificationReceiptDigest,
      "terminal cloud verification",
    ),
    verifiedAt: instant(value?.verifiedAt, "terminal verification instant"),
  };
  if (core.stableIncidentDigest !== plan.stableIncidentDigest
    || core.sourceHeadSha !== plan.sourceHeadSha
    || core.sourceDirtEvidenceDigest !== plan.sourceDirtEvidenceDigest
    || core.innerCompletionReceiptDigest !== expansion.receiptDigest) {
    invalid("terminal joins");
  }
  const stable = { ...core };
  delete stable.verifiedAt;
  return {
    ...core,
    terminalEvidenceDigest: digestValue(stable),
  };
}

function digest(value, label) {
  if (!DIGEST.test(String(value || ""))) invalid(label);
  return value;
}
function instant(value, label) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) invalid(label);
  return value;
}
function invalid(label) {
  throw new Error(`Active descendant/untracked recovery has invalid ${label}.`);
}
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
