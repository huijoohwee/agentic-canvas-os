// Responsibility: Persist a distinct monotonic recovery journal and its provider-deferred terminal.
import { buildActiveDirtyScopeExpansionSuccessorAdmission }
  from "./active-dirty-scope-expansion-successor-projection.mjs";
import { canonicalJson, digestValue }
  from "./cloud-collaboration-primitives.mjs";
import { normalizeExpiredDescendantUntrackedScopeRecoveryPlan }
  from "./expired-descendant-untracked-scope-recovery-contract.mjs";
import {
  bindAdmissionCloudAuthority,
  verifyAdmissionCloudAuthority,
} from "./scoped-lane-cloud-authority.mjs";
import { normalizeBoundAuthority }
  from "./scoped-lane-cloud-reconciliation.mjs";
import { assertTaskAuthorityBinding }
  from "./task-bound-lane-authority-contract.mjs";
import { continueTaskAuthorityCloudSuccessorBinding }
  from "./task-bound-lane-authority-store.mjs";
import { mutateWriterLeaseRegistry, writerLeaseDigest }
  from "./writer-lease-registry-cas.mjs";

const OPERATION = "expired-descendant-untracked-scope-recovery";
const INTENT_SCHEMA = `agentic-${OPERATION}-intent/v1`;
const HEARTBEAT_FENCE_SCHEMA = "agentic-active-owned-dirt-recovery-intent/v1";
const PHASES = Object.freeze([
  "intent", "waiting-successor", "source-retired", "promoted",
  "successor-bound",
]);

export function readExpiredDescendantIntent({ leaseStore, branch }) {
  const value = leaseStore.readRegistry()
    .expiredDescendantUntrackedRecoveryIntents?.[branch] || null;
  return value ? normalizeIntent(value) : null;
}

export function expiredDescendantHeartbeatFence(plan) {
  const sealed = normalizeExpiredDescendantUntrackedScopeRecoveryPlan(plan);
  return Object.freeze({ schema: HEARTBEAT_FENCE_SCHEMA, status: "intent",
    planDigest: sealed.planDigest });
}

export function expiredDescendantIntentAtLeast(current, expected) {
  return phaseIndex(current) >= phaseIndex(expected);
}

export function retireExpiredDescendantSource({ invoke, lease, plan, waiting,
  environment }) {
  const sealed = normalizeExpiredDescendantUntrackedScopeRecoveryPlan(plan);
  const inner = sealed.evidence.innerPlan;
  const evidence = Object.freeze({
    schema: `agentic-${OPERATION}-cloud-retirement-evidence/v1`,
    planDigest: sealed.planDigest, innerPlanDigest: sealed.innerPlanDigest,
    sourceClaimId: sealed.sourceClaimId, successorClaimId: waiting.claimId,
    sourceFenceSha: inner.sourceFenceSha,
    targetWriteSetDigest: inner.targetWriteSetDigest,
  });
  const result = invoke({ action: "retire",
    ledgerRepository: lease.cloudAuthority.ledgerRepository,
    request: { targetRepository: lease.cloudAuthority.targetRepository,
      claimId: sealed.sourceClaimId,
      expectedFenceRevision: sealed.sourceClaimDigest,
      expectedTransitionCounter: inner.sourceClaimTransitionCounter,
      reason: "superseded", finalRevision: inner.sourceFenceSha,
      reviewRequestId: inner.sourceReviewRequestId,
      bytesDigest: digestValue({ ...evidence, kind: "bytes" }),
      namedChecksDigest: digestValue({ ...evidence, kind: "checks" }),
      handoffEvidenceDigest: digestValue({ ...evidence, kind: "handoff" }),
      deviceId: lease.device, sessionId: lease.sessionId,
      idempotencyKey: `${OPERATION}:retire:${sealed.planDigest}:${waiting.claimId}` },
    environment });
  if (result?.schema !== "agentic-cloud-collaboration-result/v1"
    || result.ok !== true || result.action !== "retire"
    || result.claim?.claimId !== sealed.sourceClaimId
    || !["retired", "released"].includes(String(result.claim?.state))
    || !/^[0-9a-f]{64}$/u.test(String(result.receipt?.receiptDigest || ""))) {
    invalid("exact superseded predecessor retirement");
  }
  return Object.freeze({ receiptDigest: result.receipt.receiptDigest });
}

export function bindExpiredDescendantSuccessor({
  plan, lease, promoted, status, manifest, environment, invoke, inspect, verify,
  bindAuthority = bindAdmissionCloudAuthority,
  verifyAuthority = verifyAdmissionCloudAuthority,
}) {
  const sealed = normalizeExpiredDescendantUntrackedScopeRecoveryPlan(plan);
  const inner = sealed.evidence.innerPlan;
  const matches = (status?.claims || []).filter(item => item?.claimId === promoted?.claimId);
  if (matches.length !== 1) invalid("successor bind cardinality");
  const claim = matches[0], source = sealed.evidence.sourceClaim;
  const common = claim.entrySchema === source.entrySchema
    && claim.claimIdentitySchema === source.claimIdentitySchema
    && claim.actorId === source.actorId && claim.deviceId === source.deviceId
    && claim.sessionId === source.sessionId && claim.repositoryId === source.repositoryId
    && claim.workItemId === source.workItemId
    && claim.predecessorClaimId === sealed.sourceClaimId
    && claim.canonicalBaseRevision === inner.targetCanonicalBaseSha
    && claim.laneRevision === inner.sourceFenceSha
    && claim.writeSetDigest === inner.targetWriteSetDigest
    && canonicalJson(claim.declaredWriteScope) === canonicalJson(inner.targetDeclaredWriteSet)
    && claim.leaseEpoch === inner.targetCloudLeaseEpoch
    && claim.state === "current" && claim.writeAuthority === true
    && claim.scopeReserved === true && claim.integrationReceiptDigest === null
    && claim.integration === null;
  const effectPending = common
    && claim.transitionCounter === promoted.transitionCounter
    && claim.fenceRevision === promoted.claimDigest && claim.reviewRequestId === null;
  const responseAhead = common
    && claim.transitionCounter === promoted.transitionCounter + 1
    && claim.reviewRequestId === inner.sourceReviewRequestId;
  if (!effectPending && !responseAhead) invalid("exact bind pre-effect or response-ahead state");
  const seed = normalizeBoundAuthority({
    result: { schema: status.schema, ok: true, action: "status",
      ledgerRevision: status.ledgerRevision, ledgerDigest: status.ledgerDigest,
      claimDigest: claim.fenceRevision, claim },
    authority: { ...lease.cloudAuthority,
      canonicalBaseSha: inner.targetCanonicalBaseSha,
      laneRevision: inner.sourceFenceSha,
      cloudDeclaredWriteScope: inner.targetDeclaredWriteSet,
      writeSetDigest: inner.targetWriteSetDigest, leaseEpoch: inner.targetCloudLeaseEpoch,
      reviewRequestId: claim.reviewRequestId, state: "active",
      manifestDigest: inner.targetManifestDigest },
    manifest, deviceId: lease.device, sessionId: lease.sessionId,
  });
  const verified = responseAhead ? verifyAuthority({ authority: seed, manifest,
    canonicalBaseSha: inner.targetCanonicalBaseSha, environment, inspect,
    invoke: verify }) : bindAuthority({ authority: seed, manifest,
    branch: inner.sourceBranch, headSha: inner.sourceFenceSha,
    reviewRequestId: inner.sourceReviewRequestId,
    deviceId: lease.device, sessionId: lease.sessionId,
    idempotencyKey: `${OPERATION}:bind:${sealed.planDigest}:${claim.claimId}`,
    returnVerification: true, environment, invoke, inspect, verify });
  const receiptDigest = verified?.verification?.receiptDigest;
  if (!verified?.authority || !/^[0-9a-f]{64}$/u.test(String(receiptDigest || ""))) {
    invalid("successor bind verification");
  }
  return Object.freeze({ ...verified, receiptDigest,
    transition: responseAhead ? "response-ahead-adopted" : "effect-or-reconciled" });
}

export function beginExpiredDescendantIntent({ leaseStore, plan }) {
  const sealed = normalizeExpiredDescendantUntrackedScopeRecoveryPlan(plan);
  const branch = sealed.evidence.incident.sourceBranch;
  const result = mutateWriterLeaseRegistry({ leaseStore, branch,
    expectedLeaseDigest: sealed.sourceLeaseDigest,
    expectedClaimId: sealed.sourceClaimId,
    action: ({ registry, lease }) => {
      const existing = registry.expiredDescendantUntrackedRecoveryIntents?.[branch];
      const fence = expiredDescendantHeartbeatFence(sealed);
      const liveFence = registry.activeOwnedDirtRecoveryIntents?.[branch] || null;
      if (existing) {
        if (canonicalJson(liveFence) !== canonicalJson(fence)) {
          invalid("global heartbeat fence replay");
        }
        return { registry, lease, intent: requirePlan(existing, sealed), changed: false };
      }
      if (liveFence) invalid("occupied global recovery fence");
      const intent = sealIntent({ schema: INTENT_SCHEMA, status: "intent", branch,
        planDigest: sealed.planDigest, innerPlanDigest: sealed.innerPlanDigest,
        planSnapshot: sealed, sourceLeaseDigest: sealed.sourceLeaseDigest,
        sourceClaimId: sealed.sourceClaimId, sourceClaimDigest: sealed.sourceClaimDigest,
        targetWriteSetDigest: sealed.targetWriteSetDigest,
        targetManifestDigest: sealed.targetManifestDigest,
        targetClaimId: null, targetClaimDigest: null });
      return { registry: { ...registry,
        activeOwnedDirtRecoveryIntents: {
          ...(registry.activeOwnedDirtRecoveryIntents || {}), [branch]: fence,
        },
        expiredDescendantUntrackedRecoveryIntents: {
          ...(registry.expiredDescendantUntrackedRecoveryIntents || {}),
          [branch]: intent,
        } }, lease, intent, changed: true };
    } });
  return normalizeIntent(result.intent);
}

export function advanceExpiredDescendantIntent({
  leaseStore, plan, status, values = {}, expectedLeaseDigest, expectedClaimId,
}) {
  const sealed = normalizeExpiredDescendantUntrackedScopeRecoveryPlan(plan);
  const branch = sealed.evidence.incident.sourceBranch;
  const result = mutateWriterLeaseRegistry({ leaseStore, branch,
    expectedLeaseDigest, expectedClaimId,
    action: ({ registry, lease }) => {
      const current = requirePlan(
        registry.expiredDescendantUntrackedRecoveryIntents?.[branch], sealed,
      );
      requireHeartbeatFence(registry, branch, sealed);
      const currentIndex = phaseIndex(current.status), targetIndex = phaseIndex(status);
      if (targetIndex < currentIndex || targetIndex > currentIndex + 1) {
        invalid("monotonic recovery phase");
      }
      const next = targetIndex === currentIndex
        ? requireReplay(current, values) : sealIntent({ ...withoutDigest(current),
          ...values, status });
      return { registry: { ...registry,
        expiredDescendantUntrackedRecoveryIntents: {
          ...(registry.expiredDescendantUntrackedRecoveryIntents || {}),
          [branch]: next,
        } }, lease, intent: next,
      changed: canonicalJson(current) !== canonicalJson(next) };
    } });
  return normalizeIntent(result.intent);
}

export function projectExpiredDescendantSuccessor({
  leaseStore, plan, authority, taskAuthorityFile, validateLease, terminalValues,
  now = () => new Date(),
}) {
  const sealed = normalizeExpiredDescendantUntrackedScopeRecoveryPlan(plan);
  const inner = sealed.evidence.innerPlan, branch = inner.sourceBranch;
  const observed = leaseStore.read(branch);
  const result = mutateWriterLeaseRegistry({ leaseStore, branch,
    expectedLeaseDigest: writerLeaseDigest(observed),
    expectedClaimId: observed?.cloudAuthority?.claimId,
    action: ({ registry, lease }) => {
      const intent = requirePlan(
        registry.expiredDescendantUntrackedRecoveryIntents?.[branch], sealed,
      );
      requireHeartbeatFence(registry, branch, sealed);
      if (intent.status !== "successor-bound"
        || writerLeaseDigest(lease) !== sealed.sourceLeaseDigest
        || lease.cloudAuthority?.claimId !== sealed.sourceClaimId
        || authority?.claimId !== intent.targetClaimId
        || authority?.claimDigest !== intent.targetClaimDigest) {
        invalid("successor projection source and journal");
      }
      assertTaskAuthorityBinding({ binding: lease.taskAuthority, lease });
      const targetAdmission = buildActiveDirtyScopeExpansionSuccessorAdmission({
        sourceAdmission: lease.admission, plan: inner, authority,
      });
      const nextCore = { ...lease, baseSha: inner.targetCanonicalBaseSha,
        admission: targetAdmission, cloudAuthority: authority,
        heartbeatAt: authority.expiresAt, expiresAt: authority.expiresAt };
      const nextLease = { ...nextCore,
        taskAuthority: continueTaskAuthorityCloudSuccessorBinding({
          sourceLease: lease, nextLease: nextCore, capabilityPath: taskAuthorityFile,
          boundAt: now().toISOString(),
        }) };
      const validation = validateLease(nextLease);
      if (!/^[0-9a-f]{64}$/u.test(String(validation?.receiptDigest || ""))) {
        invalid("successor mutation authority receipt");
      }
      const projection = Object.freeze({ claimId: authority.claimId,
        claimDigest: authority.claimDigest, leaseDigest: writerLeaseDigest(nextLease),
        receiptDigest: validation.receiptDigest,
        sourceTaskAuthorityBindingDigest: lease.taskAuthority.bindingDigest,
        targetTaskAuthorityBindingDigest: nextLease.taskAuthority.bindingDigest });
      if (!/^[0-9a-f]{64}$/u.test(String(terminalValues?.preservedPullRequestDigest || ""))
        || new Date(terminalValues?.completedAt).toISOString()
          !== terminalValues.completedAt) invalid("terminal projection values");
      const terminalCore = Object.freeze({
        schema: `agentic-${OPERATION}-terminal/v1`,
        planDigest: sealed.planDigest, innerPlanDigest: sealed.innerPlanDigest,
        successorClaimId: authority.claimId, successorClaimDigest: authority.claimDigest,
        targetLeaseDigest: projection.leaseDigest,
        localProjectionReceiptDigest: projection.receiptDigest,
        mutationAuthorityReceiptDigest: validation.receiptDigest,
        preservedPullRequestDigest: terminalValues.preservedPullRequestDigest,
        heartbeatFenceDigest: digestValue(expiredDescendantHeartbeatFence(sealed)),
        providerProjection: "deferred", pullRequestMutation: false,
        completedAt: terminalValues.completedAt,
      });
      const terminal = Object.freeze({ ...terminalCore,
        receiptDigest: digestValue(terminalCore) });
      const intents = { ...(registry.expiredDescendantUntrackedRecoveryIntents || {}) };
      const heartbeatFences = { ...(registry.activeOwnedDirtRecoveryIntents || {}) };
      delete intents[branch];
      delete heartbeatFences[branch];
      const branchReceipts = registry.expiredDescendantUntrackedRecoveryReceipts?.[branch]
        || {};
      return { registry: { ...registry, leases: { ...registry.leases,
        [branch]: nextLease }, activeOwnedDirtRecoveryIntents: heartbeatFences,
        expiredDescendantUntrackedRecoveryIntents: intents,
        expiredDescendantUntrackedRecoveryReceipts: {
          ...(registry.expiredDescendantUntrackedRecoveryReceipts || {}),
          [branch]: { ...branchReceipts, [sealed.planDigest]: terminal },
        } }, lease: nextLease, intent: terminal, changed: true };
    } });
  return Object.freeze({ lease: result.lease, terminal: Object.freeze(result.intent) });
}

export function exactExpiredDescendantTargetProjection({ current, intent, terminal, plan }) {
  if (current.cloudAuthority?.claimId === plan.sourceClaimId
    || current.admission?.writeSetDigest !== plan.targetWriteSetDigest
    || current.admission?.manifestDigest !== plan.targetManifestDigest) return false;
  try {
    if (intent) return false;
    return Boolean(terminal && terminal.successorClaimId === current.cloudAuthority.claimId
      && terminal.successorClaimDigest === current.cloudAuthority.claimDigest
      && terminal.targetLeaseDigest === writerLeaseDigest(current));
  } catch { return false; }
}

export function readExpiredDescendantTerminal({ leaseStore, plan }) {
  const sealed = normalizeExpiredDescendantUntrackedScopeRecoveryPlan(plan);
  const registry = leaseStore.readRegistry(), branch = sealed.evidence.incident.sourceBranch;
  const value = expiredDescendantTerminalReceiptForPlan(
    registry, branch, sealed.planDigest,
  );
  if (!value) return null;
  const { receiptDigest, ...core } = value;
  const lease = leaseStore.read(branch);
  const liveIntent = registry.expiredDescendantUntrackedRecoveryIntents?.[branch];
  const liveFence = registry.activeOwnedDirtRecoveryIntents?.[branch];
  if (value.schema !== `agentic-${OPERATION}-terminal/v1`
    || value.planDigest !== sealed.planDigest || value.innerPlanDigest !== sealed.innerPlanDigest
    || value.providerProjection !== "deferred" || value.pullRequestMutation !== false
    || value.heartbeatFenceDigest
      !== digestValue(expiredDescendantHeartbeatFence(sealed))
    || receiptDigest !== digestValue(core)
    || liveIntent?.planDigest === sealed.planDigest
    || liveFence?.planDigest === sealed.planDigest
    || !lease || value.successorClaimId !== lease.cloudAuthority?.claimId
    || value.successorClaimDigest !== lease.cloudAuthority?.claimDigest
    || value.targetLeaseDigest !== writerLeaseDigest(lease)) invalid("durable terminal receipt");
  return Object.freeze(value);
}

export function expiredDescendantTerminalReceiptForPlan(registry, branch, planDigest) {
  if (typeof branch !== "string" || !branch
    || !/^[0-9a-f]{64}$/u.test(String(planDigest || ""))) {
    invalid("terminal receipt key");
  }
  return registry?.expiredDescendantUntrackedRecoveryReceipts
    ?.[branch]?.[planDigest] || null;
}

export function stableExpiredDescendantTerminalDigest(value) {
  const copy = { ...value }; delete copy.completedAt; delete copy.receiptDigest;
  return digestValue(copy);
}

export function buildExpiredDescendantInnerResult(terminal) {
  const core = { schema: `agentic-${OPERATION}-inner/v1`, status: "complete",
    planDigest: terminal.innerPlanDigest, successorClaimId: terminal.successorClaimId,
    successorClaimDigest: terminal.successorClaimDigest,
    targetLeaseDigest: terminal.targetLeaseDigest,
    terminalReceiptDigest: terminal.receiptDigest, providerProjection: "deferred",
    pullRequestMutation: false };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}

function requirePlan(value, plan) {
  const intent = normalizeIntent(value);
  if (intent.branch !== plan.evidence.incident.sourceBranch
    || intent.planDigest !== plan.planDigest || intent.innerPlanDigest !== plan.innerPlanDigest
    || intent.sourceLeaseDigest !== plan.sourceLeaseDigest
    || intent.sourceClaimId !== plan.sourceClaimId
    || intent.targetWriteSetDigest !== plan.targetWriteSetDigest
    || intent.targetManifestDigest !== plan.targetManifestDigest
    || canonicalJson(intent.planSnapshot) !== canonicalJson(plan)) invalid("recovery plan journal");
  return intent;
}
function requireHeartbeatFence(registry, branch, plan) {
  if (canonicalJson(registry.activeOwnedDirtRecoveryIntents?.[branch] || null)
    !== canonicalJson(expiredDescendantHeartbeatFence(plan))) {
    invalid("global heartbeat fence");
  }
}
function requireReplay(current, values) {
  const candidate = sealIntent({ ...withoutDigest(current), ...values });
  if (canonicalJson(candidate) !== canonicalJson(current)) invalid("same-phase replay");
  return current;
}
function normalizeIntent(value) {
  if (value?.schema !== INTENT_SCHEMA || !PHASES.includes(value.status)
    || value.intentDigest !== digestValue(withoutDigest(value))) invalid("recovery intent");
  return Object.freeze(value);
}
function sealIntent(value) {
  const core = withoutDigest(value);
  return Object.freeze({ ...core, intentDigest: digestValue(core) });
}
function withoutDigest(value) { const copy = { ...value }; delete copy.intentDigest; return copy; }
function phaseIndex(value) {
  const index = PHASES.indexOf(value); if (index < 0) invalid("phase"); return index;
}
function invalid(label) {
  throw new Error(`Expired descendant/untracked recovery has invalid ${label}.`);
}
