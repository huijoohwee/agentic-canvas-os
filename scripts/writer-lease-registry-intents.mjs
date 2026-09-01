// Responsibility: Normalize and project bounded writer-registry operation intents.
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  assertCanonicalUntrackedRelocationPlan,
  assertCanonicalUntrackedRelocationReceipt,
  canonicalUntrackedRelocationSubject,
} from "./canonical-untracked-relocation-contract.mjs";
import { validateCompletedActiveOwnedDirtRecoveryIntent }
  from "./active-owned-dirt-recovery-contract.mjs";
export const SCOPE_EXPANSION_INTENT_SCHEMA =
  "agentic-active-dirty-scope-expansion-intent/v1";
export const HEARTBEAT_MUTATION_INTENT_SCHEMA =
  "agentic-writer-lease-heartbeat-mutation-intent/v1";
export const CANONICAL_UNTRACKED_RELOCATION_REGISTRY_INTENT_SCHEMA =
  "agentic-canonical-untracked-relocation-registry-intent/v1";
export const SCOPE_EXPANSION_TOMBSTONE_SCHEMA =
  "agentic-active-dirty-scope-expansion-tombstone/v1";
const DIGEST = /^[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40}$/u;
const HEARTBEAT_MUTABLE_AUTHORITY_FIELDS = new Set([
  "claimDigest", "claimLedgerRevision", "expiresAt", "heartbeatCounter",
  "ledgerDigest", "ledgerRevision", "operationReceiptDigest", "transitionCounter",
]);
export function normalizeScopeExpansionIntent(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.schema !== SCOPE_EXPANSION_INTENT_SCHEMA
    || !["intent", "waiting-successor", "source-retired", "promoted", "successor-bound",
      "local-cas", "pr-marker", "complete"].includes(value.status)
    || typeof value.branch !== "string" || !value.branch
    || !DIGEST.test(String(value.sourceLeaseDigest || ""))
    || !DIGEST.test(String(value.sourceClaimId || ""))
    || !SHA.test(String(value.sourceFenceSha || ""))
    || !DIGEST.test(String(value.targetWriteSetDigest || ""))
    || !DIGEST.test(String(value.targetManifestDigest || ""))
    || !DIGEST.test(String(value.planDigest || ""))
    || !Number.isInteger(value.targetLeaseEpoch) || value.targetLeaseEpoch !== 1
    || !SHA.test(String(value.targetCanonicalBaseSha || ""))) {
    throw new Error("Scope-expansion intent is malformed.");
  }
  for (const key of [
    "targetClaimId", "targetClaimDigest", "completedReceiptDigest", "waitingReceiptDigest",
    "sourceRetirementReceiptDigest", "promotedReceiptDigest", "boundReceiptDigest",
    "localProjectionReceiptDigest", "pullRequestProjectionReceiptDigest", "finalReceiptDigest",
  ]) {
    nullableDigest(value[key], `scope-expansion intent ${key}`);
  }
  if (value.targetReviewRequestId !== null && value.targetReviewRequestId !== undefined
    && (typeof value.targetReviewRequestId !== "string" || !value.targetReviewRequestId)) {
    throw new Error("Scope-expansion intent review request is malformed.");
  }
  const planSnapshot = snapshotScopeExpansionPlan(value.planSnapshot);
  if (planSnapshot.planDigest !== value.planDigest) {
    throw new Error("Scope-expansion intent plan snapshot is inconsistent.");
  }
  return Object.freeze({
    schema: SCOPE_EXPANSION_INTENT_SCHEMA, status: value.status, branch: value.branch,
    sourceLeaseDigest: value.sourceLeaseDigest, sourceClaimId: value.sourceClaimId,
    sourceFenceSha: value.sourceFenceSha, targetWriteSetDigest: value.targetWriteSetDigest,
    targetManifestDigest: value.targetManifestDigest, planDigest: value.planDigest,
    targetClaimId: value.targetClaimId || null,
    targetClaimDigest: value.targetClaimDigest || null,
    targetLeaseEpoch: value.targetLeaseEpoch,
    targetCanonicalBaseSha: value.targetCanonicalBaseSha,
    targetReviewRequestId: value.targetReviewRequestId || null,
    completedReceiptDigest: value.completedReceiptDigest || null,
    waiting: boundedSnapshot(value.waiting, "scope-expansion waiting successor", true),
    waitingReceiptDigest: value.waitingReceiptDigest || null,
    sourceRetirementReceiptDigest: value.sourceRetirementReceiptDigest || null,
    promoted: boundedSnapshot(value.promoted, "scope-expansion promoted successor", true),
    promotedReceiptDigest: value.promotedReceiptDigest || null,
    boundAuthority: boundedSnapshot(value.boundAuthority, "scope-expansion bound authority", true),
    boundReceiptDigest: value.boundReceiptDigest || null,
    localProjection: boundedSnapshot(value.localProjection, "scope-expansion local projection", true),
    localProjectionReceiptDigest: value.localProjectionReceiptDigest || null,
    pullRequestProjection: boundedSnapshot(
      value.pullRequestProjection, "scope-expansion pull-request projection", true),
    pullRequestProjectionReceiptDigest: value.pullRequestProjectionReceiptDigest || null,
    finalReceiptDigest: value.finalReceiptDigest || null, planSnapshot,
  });
}
export function normalizeScopeExpansionPlan(value) {
  if (!value || typeof value !== "object") throw new Error("Scope-expansion plan is required.");
  return Object.freeze({
    planDigest: requiredDigest(value.planDigest, "plan digest"),
    targetWriteSetDigest: requiredDigest(value.targetWriteSetDigest, "target write-set digest"),
    targetManifestDigest: requiredDigest(value.targetManifestDigest, "target manifest digest"),
    targetCanonicalBaseSha: requiredSha(value.targetCanonicalBaseSha, "target canonical base SHA"),
  });
}
export function snapshotScopeExpansionPlan(value) {
  if (!value || typeof value !== "object") {
    throw new Error("Scope-expansion intent plan snapshot is required.");
  }
  const { planDigest, ...core } = value;
  if (!DIGEST.test(String(planDigest || "")) || digestValue(core) !== planDigest) {
    throw new Error("Scope-expansion intent plan snapshot digest is invalid.");
  }
  return boundedSnapshot({ ...core, planDigest }, "scope-expansion plan", false, 262_144);
}
export function withScopeExpansionIntent(registry, branch, intent) {
  return { ...registry, scopeExpansionIntents: {
    ...(registry.scopeExpansionIntents || {}), [branch]: normalizeScopeExpansionIntent(intent),
  } };
}
export function createScopeExpansionTombstone(intent) {
  const completed = requireCompletedScopeExpansionIntent(intent);
  const core = Object.freeze({
    schema: SCOPE_EXPANSION_TOMBSTONE_SCHEMA,
    branch: completed.branch,
    planDigest: completed.planDigest,
    targetManifestDigest: completed.targetManifestDigest,
    targetWriteSetDigest: completed.targetWriteSetDigest,
    targetClaimId: completed.targetClaimId,
    finalReceiptDigest: completed.finalReceiptDigest,
    completedIntentDigest: digestValue(completed),
  });
  return Object.freeze({ ...core, tombstoneDigest: digestValue(core) });
}
export function normalizeScopeExpansionTombstone(value) {
  object(value, "scope-expansion tombstone");
  const core = Object.freeze({
    schema: value.schema,
    branch: requiredText(value.branch, "scope-expansion tombstone branch"),
    planDigest: requiredDigest(value.planDigest, "scope-expansion tombstone plan digest"),
    targetManifestDigest: requiredDigest(
      value.targetManifestDigest, "scope-expansion tombstone manifest digest"),
    targetWriteSetDigest: requiredDigest(
      value.targetWriteSetDigest, "scope-expansion tombstone write-set digest"),
    targetClaimId: requiredDigest(value.targetClaimId, "scope-expansion tombstone claim ID"),
    finalReceiptDigest: requiredDigest(
      value.finalReceiptDigest, "scope-expansion tombstone final receipt digest"),
    completedIntentDigest: requiredDigest(
      value.completedIntentDigest, "scope-expansion tombstone intent digest"),
  });
  if (core.schema !== SCOPE_EXPANSION_TOMBSTONE_SCHEMA
    || value.tombstoneDigest !== digestValue(core)) {
    throw new Error("Scope-expansion tombstone is malformed.");
  }
  exactKeys(value, [...Object.keys(core), "tombstoneDigest"], "scope-expansion tombstone");
  return Object.freeze({ ...core, tombstoneDigest: value.tombstoneDigest });
}
export function requireCompletedScopeExpansionIntent(value) {
  const intent = normalizeScopeExpansionIntent(value);
  const required = [
    intent?.targetClaimId, intent?.targetClaimDigest, intent?.targetReviewRequestId,
    intent?.waiting, intent?.waitingReceiptDigest, intent?.sourceRetirementReceiptDigest,
    intent?.promoted, intent?.promotedReceiptDigest, intent?.boundAuthority,
    intent?.boundReceiptDigest, intent?.localProjection, intent?.localProjectionReceiptDigest,
    intent?.pullRequestProjection, intent?.pullRequestProjectionReceiptDigest,
    intent?.finalReceiptDigest,
  ];
  if (!intent || intent.status !== "complete" || required.some(item => item === null)) {
    throw new Error("Scope-expansion rollover requires a fully completed durable intent.");
  }
  return intent;
}
export function assertCompletedScopeExpansionProjection({ intent: value, lease,
  expectedLeaseDigest, expectedClaimId }) {
  const intent = requireCompletedScopeExpansionIntent(value);
  const targetLease = requireLeaseSnapshot(lease, "scope-expansion target lease");
  const leaseDigest = requiredDigest(expectedLeaseDigest, "scope-expansion target lease digest");
  const claimId = requiredDigest(expectedClaimId, "scope-expansion target claim ID");
  const bound = normalizeCloudAuthority(intent.boundAuthority, "scope-expansion bound authority");
  const current = normalizeCloudAuthority(
    targetLease.cloudAuthority, "scope-expansion current authority");
  const reconstructedC2 = { ...targetLease, cloudAuthority: bound,
    heartbeatAt: bound.expiresAt, expiresAt: bound.expiresAt };
  const ownerIdentityDigest = digestValue({ deviceId: targetLease.device,
    sessionId: targetLease.sessionId, provider: bound.provider,
    targetRepository: bound.targetRepository, ledgerRepository: bound.ledgerRepository });
  if (digestValue(targetLease) !== leaseDigest
    || targetLease.branch !== intent.branch
    || digestValue(reconstructedC2) !== intent.localProjection?.leaseDigest
    || intent.localProjection?.claimId !== claimId
    || intent.localProjection?.receiptDigest !== intent.localProjectionReceiptDigest
    || intent.targetClaimId !== claimId
    || bound.claimId !== claimId || bound.claimDigest !== intent.targetClaimDigest
    || current.claimId !== claimId
    || intent.localProjection?.ownerIdentityDigest !== ownerIdentityDigest
    || targetLease.taskAuthority?.bindingDigest
      !== intent.localProjection?.targetTaskAuthorityBindingDigest
    || targetLease.admission?.manifestDigest !== intent.targetManifestDigest
    || targetLease.admission?.writeSetDigest !== intent.targetWriteSetDigest) {
    throw new Error("Completed scope-expansion intent does not match its exact live C2 projection.");
  }
  assertHeartbeatAuthorityLineage(bound, current);
  return intent;
}
export function completedScopeExpansionHeartbeatBridgeDigest({ heartbeatIntent: heartbeatValue,
  scopeExpansionIntent: expansionValue, lease, expectedLeaseDigest, expectedClaimId }) {
  const heartbeat = normalizeHeartbeatMutationIntent(heartbeatValue);
  const expansion = assertCompletedScopeExpansionProjection({ intent: expansionValue, lease,
    expectedLeaseDigest, expectedClaimId });
  if (heartbeat?.status !== "complete"
    || heartbeat.targetLeaseDigest !== expansion.sourceLeaseDigest
    || heartbeat.targetClaimId !== expansion.sourceClaimId) {
    throw new Error("Completed scope expansion does not bridge the prior heartbeat authority.");
  }
  return digestValue({
    schema: "agentic-heartbeat-scope-expansion-predecessor-bridge/v1",
    heartbeatIntentDigest: heartbeat.intentDigest,
    scopeExpansionPlanDigest: expansion.planDigest,
    scopeExpansionFinalReceiptDigest: expansion.finalReceiptDigest,
    sourceLeaseDigest: expansion.sourceLeaseDigest,
    targetLeaseDigest: expansion.localProjection.leaseDigest,
  });
}
export function assertExpectedWriterLease({ lease: value, expectedLeaseDigest, expectedClaimId }) {
  const lease = requireLeaseSnapshot(value, "writer lease");
  if (digestValue(lease) !== requiredDigest(expectedLeaseDigest, "expected lease digest")) {
    throw new Error("Writer lease changed before scope-expansion CAS or active-owned-dirt recovery CAS.");
  }
  const claimId = expectedClaimId === null ? null
    : requiredDigest(expectedClaimId, "expected claim ID");
  const claimMatches = claimId === null
    ? lease.cloudAuthority === null || lease.cloudAuthority === undefined
    : lease.cloudAuthority?.claimId === claimId;
  if (!claimMatches) {
    throw new Error("Writer lease claim changed before scope-expansion CAS or active-owned-dirt recovery CAS.");
  }
  return lease;
}
export function boundedWriterLeaseExpiry({ now, ttlMs, expiresAtCap }) {
  const instant = now instanceof Date ? now : new Date(now);
  const ttl = Number(ttlMs);
  if (!Number.isFinite(instant.getTime()) || !Number.isFinite(ttl)
    || ttl < 60_000 || ttl > 86_400_000) {
    throw new Error("Writer-lease heartbeat projection has an invalid TTL.");
  }
  const cap = expiresAtCap === null || expiresAtCap === undefined ? null : Date.parse(expiresAtCap);
  if (cap !== null && (!Number.isFinite(cap) || cap - instant.getTime() < 60_000)) {
    throw new Error("Writer-lease heartbeat projection cloud expiry cap is invalid.");
  }
  return new Date(Math.min(instant.getTime() + Math.floor(ttl), cap ?? Infinity)).toISOString();
}
export function createHeartbeatMutationIntent({ branch, sourceLeaseDigest, sourceClaimId,
  sourceAuthoritySnapshot, predecessorIntentDigest = null, predecessorBridgeDigest = null }) {
  const authority = normalizeCloudAuthority(sourceAuthoritySnapshot, "source heartbeat authority");
  const core = Object.freeze({
    schema: HEARTBEAT_MUTATION_INTENT_SCHEMA, status: "active",
    branch: requiredText(branch, "heartbeat branch"),
    sourceLeaseDigest: requiredDigest(sourceLeaseDigest, "heartbeat source lease digest"),
    sourceClaimId: requiredDigest(sourceClaimId, "heartbeat source claim ID"),
    sourceAuthoritySnapshot: authority,
    sourceAuthorityDigest: digestValue(authority),
    predecessorIntentDigest: nullableDigest(
      predecessorIntentDigest, "heartbeat predecessor intent digest"),
    predecessorBridgeDigest: nullableDigest(
      predecessorBridgeDigest, "heartbeat predecessor bridge digest"),
    targetLeaseDigest: null, targetClaimId: null,
    targetAuthoritySnapshot: null, targetAuthorityDigest: null,
    completionReceiptDigest: null,
  });
  if (authority.claimId !== core.sourceClaimId) {
    throw new Error("Heartbeat intent source authority changed its claim ID.");
  }
  return Object.freeze({ ...core, intentDigest: digestValue(core) });
}
export function completeHeartbeatMutationIntent({ intent, targetLease }) {
  const source = normalizeHeartbeatMutationIntent(intent);
  if (source.status !== "active") throw new Error("Heartbeat mutation intent is not active.");
  const lease = requireLeaseSnapshot(targetLease, "heartbeat target lease");
  const authority = normalizeCloudAuthority(lease.cloudAuthority, "target heartbeat authority");
  assertExactHeartbeatSuccessor(source.sourceAuthoritySnapshot, authority);
  const completion = Object.freeze({
    schema: "agentic-writer-lease-heartbeat-mutation-completion/v1",
    activeIntentDigest: source.intentDigest,
    targetLeaseDigest: digestValue(lease),
    targetClaimId: authority.claimId,
    targetAuthorityDigest: digestValue(authority),
  });
  const { intentDigest: _intentDigest, ...activeCore } = source;
  const core = Object.freeze({
    ...activeCore, status: "complete",
    targetLeaseDigest: completion.targetLeaseDigest,
    targetClaimId: completion.targetClaimId,
    targetAuthoritySnapshot: authority,
    targetAuthorityDigest: completion.targetAuthorityDigest,
    completionReceiptDigest: digestValue(completion),
  });
  return Object.freeze({ ...core, intentDigest: digestValue(core) });
}
export function normalizeHeartbeatMutationIntent(value) {
  if (value === null || value === undefined) return null;
  object(value, "heartbeat mutation intent");
  exactKeys(value, [
    "schema", "status", "branch", "sourceLeaseDigest", "sourceClaimId",
    "sourceAuthoritySnapshot", "sourceAuthorityDigest", "predecessorIntentDigest",
    "predecessorBridgeDigest",
    "targetLeaseDigest", "targetClaimId",
    "targetAuthoritySnapshot", "targetAuthorityDigest", "completionReceiptDigest", "intentDigest",
  ], "heartbeat mutation intent");
  const active = createHeartbeatMutationIntent({
    branch: value.branch, sourceLeaseDigest: value.sourceLeaseDigest,
    sourceClaimId: value.sourceClaimId, sourceAuthoritySnapshot: value.sourceAuthoritySnapshot,
    predecessorIntentDigest: value.predecessorIntentDigest,
    predecessorBridgeDigest: value.predecessorBridgeDigest,
  });
  if (value.schema !== active.schema || !["active", "complete"].includes(value.status)
    || value.sourceAuthorityDigest !== active.sourceAuthorityDigest) {
    throw new Error("Heartbeat mutation intent is malformed.");
  }
  if (value.status === "active") {
    if ([value.targetLeaseDigest, value.targetClaimId, value.targetAuthoritySnapshot,
      value.targetAuthorityDigest, value.completionReceiptDigest].some(item => item !== null)
      || value.intentDigest !== active.intentDigest) {
      throw new Error("Active heartbeat mutation intent carries terminal evidence.");
    }
    return active;
  }
  const targetAuthority = normalizeCloudAuthority(value.targetAuthoritySnapshot,
    "completed heartbeat authority");
  assertExactHeartbeatSuccessor(active.sourceAuthoritySnapshot, targetAuthority);
  const completion = Object.freeze({
    schema: "agentic-writer-lease-heartbeat-mutation-completion/v1",
    activeIntentDigest: active.intentDigest,
    targetLeaseDigest: requiredDigest(value.targetLeaseDigest, "heartbeat target lease digest"),
    targetClaimId: requiredDigest(value.targetClaimId, "heartbeat target claim ID"),
    targetAuthorityDigest: requiredDigest(
      value.targetAuthorityDigest, "heartbeat target authority digest"),
  });
  if (completion.targetClaimId !== targetAuthority.claimId
    || completion.targetAuthorityDigest !== digestValue(targetAuthority)
    || value.completionReceiptDigest !== digestValue(completion)) {
    throw new Error("Completed heartbeat mutation evidence is inconsistent.");
  }
  const { intentDigest: _intentDigest, ...activeCore } = active;
  const core = Object.freeze({
    ...activeCore, status: "complete", targetLeaseDigest: completion.targetLeaseDigest,
    targetClaimId: completion.targetClaimId, targetAuthoritySnapshot: targetAuthority,
    targetAuthorityDigest: completion.targetAuthorityDigest,
    completionReceiptDigest: value.completionReceiptDigest,
  });
  if (value.intentDigest !== digestValue(core)) {
    throw new Error("Completed heartbeat mutation intent digest is invalid.");
  }
  return Object.freeze({ ...core, intentDigest: value.intentDigest });
}
export function assertHeartbeatTerminalCurrent({ intent: value, lease: leaseValue }) {
  const intent = normalizeHeartbeatMutationIntent(value);
  const lease = requireLeaseSnapshot(leaseValue, "heartbeat successor lease");
  if (intent?.status !== "complete" || intent.branch !== lease.branch
    || intent.targetClaimId !== lease.cloudAuthority?.claimId
    || intent.targetAuthorityDigest !== digestValue(lease.cloudAuthority)) {
    throw new Error("Completed heartbeat tombstone is not the current cloud authority.");
  }
  return intent;
}
export function withHeartbeatMutationIntent(registry, branch, intent) {
  return { ...registry, heartbeatMutationIntents: {
    ...(registry.heartbeatMutationIntents || {}),
    [branch]: normalizeHeartbeatMutationIntent(intent),
  } };
}
export function createCanonicalUntrackedRelocationRegistryIntent({ status = "active", branch,
  sourceLeaseDigest, sourceClaimId, sourceFenceSha, sourceAuthoritySnapshot, planSnapshot,
  effectIntentDigest = null, targetLeaseDigest = null, targetClaimId = null,
  targetAuthoritySnapshot = null, receiptSnapshot = null, abortReceiptSnapshot = null }) {
  const plan = assertCanonicalUntrackedRelocationPlan(planSnapshot);
  const subject = canonicalUntrackedRelocationSubject(plan);
  const authority = normalizeCloudAuthority(sourceAuthoritySnapshot, "relocation source authority");
  const core = {
    schema: CANONICAL_UNTRACKED_RELOCATION_REGISTRY_INTENT_SCHEMA,
    status: requiredChoice(status, ["active", "complete", "aborted"], "relocation intent status"),
    branch: requiredText(branch, "relocation branch"),
    sourceLeaseDigest: requiredDigest(sourceLeaseDigest, "relocation source lease digest"),
    sourceClaimId: requiredDigest(sourceClaimId, "relocation source claim ID"),
    sourceFenceSha: requiredSha(sourceFenceSha, "relocation source fence SHA"),
    sourceAuthoritySnapshot: authority, sourceAuthorityDigest: digestValue(authority),
    planSnapshot: plan, planDigest: plan.planDigest, subjectDigest: subject.subjectDigest,
    effectIntentDigest: nullableDigest(effectIntentDigest, "relocation effect-intent digest"),
    targetLeaseDigest: nullableDigest(targetLeaseDigest, "relocation target lease digest"),
    targetClaimId: nullableDigest(targetClaimId, "relocation target claim ID"),
    targetAuthoritySnapshot: targetAuthoritySnapshot === null ? null
      : normalizeCloudAuthority(targetAuthoritySnapshot, "relocation target authority"),
    targetAuthorityDigest: targetAuthoritySnapshot === null ? null
      : digestValue(normalizeCloudAuthority(targetAuthoritySnapshot, "relocation target authority")),
    receiptSnapshot: receiptSnapshot === null ? null
      : assertCanonicalUntrackedRelocationReceipt(receiptSnapshot, plan),
    receiptDigest: receiptSnapshot === null ? null
      : assertCanonicalUntrackedRelocationReceipt(receiptSnapshot, plan).receiptDigest,
    abortReceiptSnapshot: abortReceiptSnapshot === null ? null
      : normalizeRelocationAbortReceipt(abortReceiptSnapshot, plan),
    abortReceiptDigest: abortReceiptSnapshot === null ? null
      : normalizeRelocationAbortReceipt(abortReceiptSnapshot, plan).abortReceiptDigest,
  };
  if (core.branch !== plan.evidence.target.branch
    || core.sourceLeaseDigest !== plan.evidence.target.leaseDigest
    || core.sourceClaimId !== plan.evidence.target.cloudClaimId
    || core.sourceFenceSha !== plan.evidence.target.fenceSha
    || authority.claimId !== core.sourceClaimId
    || authority.claimDigest !== plan.evidence.target.cloudClaimDigest) {
    throw new Error("Relocation registry intent changed its exact target authority subject.");
  }
  assertRelocationPhase(core);
  const frozen = Object.freeze(core);
  return Object.freeze({ ...frozen, intentDigest: digestValue(frozen) });
}
export function normalizeCanonicalUntrackedRelocationRegistryIntent(value) {
  if (value === null || value === undefined) return null;
  object(value, "canonical-untracked relocation registry intent");
  exactKeys(value, [
    "schema", "status", "branch", "sourceLeaseDigest", "sourceClaimId", "sourceFenceSha",
    "sourceAuthoritySnapshot", "sourceAuthorityDigest", "planSnapshot", "planDigest",
    "subjectDigest", "effectIntentDigest", "targetLeaseDigest", "targetClaimId",
    "targetAuthoritySnapshot", "targetAuthorityDigest", "receiptSnapshot", "receiptDigest",
    "abortReceiptSnapshot", "abortReceiptDigest", "intentDigest",
  ], "canonical-untracked relocation registry intent");
  const normalized = createCanonicalUntrackedRelocationRegistryIntent(value);
  if (value.schema !== normalized.schema || value.planDigest !== normalized.planDigest
    || value.subjectDigest !== normalized.subjectDigest
    || value.sourceAuthorityDigest !== normalized.sourceAuthorityDigest
    || value.targetAuthorityDigest !== normalized.targetAuthorityDigest
    || value.receiptDigest !== normalized.receiptDigest
    || value.abortReceiptDigest !== normalized.abortReceiptDigest
    || value.intentDigest !== normalized.intentDigest) {
    throw new Error("Canonical-untracked relocation registry intent is malformed.");
  }
  return normalized;
}
export function withCanonicalUntrackedRelocationRegistryIntent(registry, branch, intent) {
  return { ...registry, canonicalUntrackedRelocationIntents: {
    ...(registry.canonicalUntrackedRelocationIntents || {}),
    [branch]: normalizeCanonicalUntrackedRelocationRegistryIntent(intent),
  } };
}
export function assertWriterLeaseMutationIntentAvailability({ registry, branch, operation }) {
  object(registry, "writer-lease registry");
  const heartbeat = normalizeHeartbeatMutationIntent(
    registry.heartbeatMutationIntents?.[branch] ?? null);
  const relocation = normalizeCanonicalUntrackedRelocationRegistryIntent(
    registry.canonicalUntrackedRelocationIntents?.[branch] ?? null);
  const expansion = normalizeScopeExpansionIntent(
    registry.scopeExpansionIntents?.[branch] ?? null);
  const recovery = normalizeRecoveryFence(
    registry.activeOwnedDirtRecoveryIntents?.[branch] ?? null);
  if (operation === "heartbeat" && relocation?.status === "active") {
    throw new Error("Active canonical-untracked relocation intent fences this heartbeat.");
  }
  if (operation === "canonical-untracked-relocation" && heartbeat?.status === "active") {
    throw new Error("Active heartbeat mutation intent fences canonical-untracked relocation.");
  }
  if (operation === "scope-expansion" && heartbeat?.status === "active") {
    throw new Error("Active heartbeat mutation intent fences scope expansion.");
  }
  if (operation === "scope-expansion" && relocation?.status === "active") {
    throw new Error("Active canonical-untracked relocation intent fences scope expansion.");
  }
  if (operation === "scope-expansion" && recovery) {
    throw new Error("Active-owned-dirt recovery intent fences scope expansion.");
  }
  if (operation === "canonical-untracked-relocation"
    && (expansion && expansion.status !== "complete" || recovery)) {
    throw new Error("Another active registry intent fences canonical-untracked relocation.");
  }
  requiredChoice(operation,
    ["heartbeat", "canonical-untracked-relocation", "scope-expansion"], "mutation operation");
  return Object.freeze({ heartbeat, relocation, expansion, recovery });
}
export function assertExactHeartbeatSuccessor(sourceValue, targetValue) {
  let lineage;
  try { lineage = heartbeatAuthorityLineage(sourceValue, targetValue); }
  catch { throw new Error("Heartbeat C2 is not one exact authority renewal ahead of C1."); }
  const { source, target, transitionDelta, heartbeatDelta } = lineage;
  const sourceHeartbeat = source.heartbeatCounter ?? 0;
  const targetHeartbeat = target.heartbeatCounter ?? (target.reviewRequestId ? null : 0);
  const heartbeatAdvanced = target.reviewRequestId
    ? (source.heartbeatCounter === undefined && target.heartbeatCounter === undefined)
      || targetHeartbeat === sourceHeartbeat + 1
    : targetHeartbeat === sourceHeartbeat + 1;
  if (transitionDelta !== 1 || (heartbeatDelta !== null && heartbeatDelta !== 1)
    || !heartbeatAdvanced
    || Date.parse(target.expiresAt) <= Date.parse(source.expiresAt)
    || target.claimDigest === source.claimDigest
    || target.claimLedgerRevision === source.claimLedgerRevision
    || target.operationReceiptDigest === source.operationReceiptDigest) {
    throw new Error("Heartbeat C2 is not one exact authority renewal ahead of C1.");
  }
  return target;
}
export function assertHeartbeatAuthorityLineage(sourceValue, targetValue) {
  const lineage = heartbeatAuthorityLineage(sourceValue, targetValue);
  if (lineage.transitionDelta === 0
    && digestValue(lineage.source) !== digestValue(lineage.target)) {
    throw new Error("Heartbeat authority changed without advancing its transition.");
  }
  return lineage.target;
}
function heartbeatAuthorityLineage(sourceValue, targetValue) {
  const source = normalizeCloudAuthority(sourceValue, "source heartbeat authority");
  const target = normalizeCloudAuthority(targetValue, "target heartbeat authority");
  const transitionDelta = target.transitionCounter - source.transitionCounter;
  const heartbeatDelta = source.heartbeatCounter === undefined
    && target.heartbeatCounter === undefined ? null
    : (target.heartbeatCounter ?? 0) - (source.heartbeatCounter ?? 0);
  if (digestValue(withoutKeys(source, HEARTBEAT_MUTABLE_AUTHORITY_FIELDS))
      !== digestValue(withoutKeys(target, HEARTBEAT_MUTABLE_AUTHORITY_FIELDS))
    || transitionDelta < 0 || (heartbeatDelta !== null && heartbeatDelta !== transitionDelta)
    || Date.parse(target.expiresAt) < Date.parse(source.expiresAt)) {
    throw new Error("Heartbeat authority is not a monotonic descendant of its exact subject.");
  }
  return Object.freeze({ source, target, transitionDelta, heartbeatDelta });
}
function assertRelocationPhase(value) {
  const terminal = [value.targetLeaseDigest, value.targetClaimId, value.targetAuthoritySnapshot,
    value.targetAuthorityDigest, value.receiptSnapshot, value.receiptDigest];
  if (value.status === "active" && (terminal.some(item => item !== null)
    || value.abortReceiptSnapshot !== null || value.abortReceiptDigest !== null)) {
    throw new Error("Active relocation intent carries terminal evidence.");
  }
  if (value.status === "aborted" && (value.effectIntentDigest !== null
    || terminal.some(item => item !== null) || value.abortReceiptSnapshot === null
    || value.abortReceiptDigest === null)) {
    throw new Error("Relocation intent may abort only before a durable effect attempt.");
  }
  if (value.status === "complete") {
    if (value.effectIntentDigest === null || terminal.some(item => item === null)
      || value.abortReceiptSnapshot !== null || value.abortReceiptDigest !== null
      || value.targetLeaseDigest !== value.sourceLeaseDigest
      || value.targetClaimId !== value.sourceClaimId
      || value.targetAuthorityDigest !== value.sourceAuthorityDigest) {
      throw new Error("Completed relocation intent changed its fenced target authority.");
    }
  }
}
function normalizeRelocationAbortReceipt(value, plan) {
  object(value, "canonical relocation no-effect abort proof");
  const core = Object.freeze({
    schema: value.schema, status: value.status, planDigest: value.planDigest,
    sourceLeaseDigest: value.sourceLeaseDigest, sourceClaimId: value.sourceClaimId,
    sourceState: value.sourceState, targetState: value.targetState,
    quarantineState: value.quarantineState, effectIntentDigest: value.effectIntentDigest,
  });
  const target = plan.evidence.target;
  if (core.schema !== "agentic-canonical-untracked-relocation-no-effect-abort/v1"
    || core.status !== "no-effect" || core.planDigest !== plan.planDigest
    || core.sourceLeaseDigest !== target.leaseDigest || core.sourceClaimId !== target.cloudClaimId
    || core.sourceState !== "exact" || core.targetState !== "absent"
    || core.quarantineState !== "absent" || core.effectIntentDigest !== null
    || value.abortReceiptDigest !== digestValue(core)) {
    throw new Error("Canonical relocation no-effect abort proof is invalid.");
  }
  exactKeys(value, [...Object.keys(core), "abortReceiptDigest"],
    "canonical relocation no-effect abort proof");
  return Object.freeze({ ...core, abortReceiptDigest: value.abortReceiptDigest });
}
function normalizeCloudAuthority(value, label) {
  const snapshot = boundedSnapshot(value, label, false, 131_072);
  if (snapshot.schema !== "agentic-lane-cloud-authority/v1"
    || !DIGEST.test(String(snapshot.claimId || ""))
    || !DIGEST.test(String(snapshot.claimDigest || ""))
    || !DIGEST.test(String(snapshot.claimLedgerRevision || ""))
    || !DIGEST.test(String(snapshot.operationReceiptDigest || ""))
    || !Number.isSafeInteger(snapshot.transitionCounter) || snapshot.transitionCounter < 0
    || (snapshot.heartbeatCounter !== undefined
      && (!Number.isSafeInteger(snapshot.heartbeatCounter) || snapshot.heartbeatCounter < 0))
    || !Number.isFinite(Date.parse(snapshot.expiresAt))) {
    throw new Error(`${label} is malformed.`);
  }
  return snapshot;
}
function normalizeRecoveryFence(value) {
  if (value === null || value === undefined) return null;
  if (value.status === "complete") {
    validateCompletedActiveOwnedDirtRecoveryIntent(value);
    return null;
  }
  if (value.schema !== "agentic-active-owned-dirt-recovery-intent/v1"
    || !DIGEST.test(String(value.planDigest || ""))) {
    throw new Error("Active-owned-dirt recovery intent is malformed.");
  }
  return value;
}
function requireLeaseSnapshot(value, label) {
  const lease = boundedSnapshot(value, label, false, 262_144);
  if (lease.schema !== "agentic-writer-lease/v2" || typeof lease.branch !== "string") {
    throw new Error(`${label} is malformed.`);
  }
  return lease;
}
function boundedSnapshot(value, label, nullable = false, maxBytes = 65_536) {
  if (nullable && (value === null || value === undefined)) return null;
  object(value, label);
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) throw new Error(`${label} is too large.`);
  return deepFreeze(JSON.parse(serialized));
}
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
function withoutKeys(value, keys) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.has(key)));
}
function exactKeys(value, keys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} fields are malformed.`);
  }
}
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}
function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value;
}
function requiredChoice(value, choices, label) {
  if (!choices.includes(value)) throw new Error(`${label} is invalid.`);
  return value;
}
function requiredDigest(value, label) {
  if (!DIGEST.test(String(value || ""))) throw new Error(`${label} must be a SHA-256 digest.`);
  return String(value);
}
function nullableDigest(value, label) {
  if (value === null || value === undefined) return null;
  return requiredDigest(value, label);
}
function requiredSha(value, label) {
  if (!SHA.test(String(value || ""))) throw new Error(`${label} must be a SHA.`);
  return String(value);
}
