// Responsibility: atomically replace one scope-expansion C1 lease and intent with its task-bound C2 projection.
import { realpathSync } from "node:fs";
import path from "node:path";
import { normalizeActiveDirtyScopeExpansionPlan, verifyBoundSuccessor }
  from "./active-dirty-scope-expansion-contract.mjs";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { assertCapabilityMatchesBinding, assertTaskAuthorityBinding }
  from "./task-bound-lane-authority-contract.mjs";
import { continueTaskAuthorityCloudSuccessorBinding, readTaskAuthorityCapability }
  from "./task-bound-lane-authority-store.mjs";
import { mutateWriterLeaseRegistry, SCOPE_EXPANSION_INTENT_SCHEMA, writerLeaseDigest }
  from "./writer-lease-registry-cas.mjs";
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const RECOVERABLE_SOURCE_PHASES = new Set(sortedFieldNames(
  "source-retired promoted successor-bound",
));
const SUCCESSOR_FIELDS = new Set(sortedFieldNames(
  "status promoted promotedReceiptDigest boundAuthority boundReceiptDigest targetClaimDigest targetReviewRequestId",
));
const INTENT_FIELDS = sortedFieldNames(
  "boundAuthority boundReceiptDigest branch completedReceiptDigest finalReceiptDigest localProjection localProjectionReceiptDigest planDigest planSnapshot promoted promotedReceiptDigest pullRequestProjection pullRequestProjectionReceiptDigest schema sourceClaimId sourceFenceSha sourceLeaseDigest sourceRetirementReceiptDigest status targetCanonicalBaseSha targetClaimDigest targetClaimId targetLeaseEpoch targetManifestDigest targetReviewRequestId targetWriteSetDigest waiting waitingReceiptDigest",
);
const CLAIM_SNAPSHOT_FIELDS = sortedFieldNames(
  "claimDigest claimId claimLedgerRevision expiresAt ledgerRevision transitionCounter",
);
const LOCAL_PROJECTION_FIELDS = sortedFieldNames(
  "claimId leaseDigest ownerIdentityDigest receiptDigest sourceAdmissionDigest sourceExistingLaneStateDigest sourceTaskAuthorityBindingDigest targetTaskAuthorityBindingDigest",
);
const MUTATION_RECEIPT_FIELDS = sortedFieldNames(
  "claimDigest claimId cloudVerificationReceiptDigest evaluatedAt expiresAt ledgerRevision localFenceSha localLeaseEpoch receiptDigest remoteLeaseEpoch schema status",
);
export function projectActiveDirtyScopeExpansionSuccessor({
  leaseStore,
  branch,
  expectedLeaseDigest,
  expectedClaimId,
  plan,
  authority,
  taskAuthorityFile,
  successorIntent = null,
  promotedEvidence = null,
  validateLease,
  now = () => new Date(),
} = {}) {
  const normalizedPlan = normalizeActiveDirtyScopeExpansionPlan(plan);
  const sourceLeaseDigest = requiredDigest(expectedLeaseDigest, "source lease digest");
  const sourceClaimId = requiredDigest(expectedClaimId, "source claim ID");
  const targetBranch = requiredText(branch, "branch");
  requiredText(taskAuthorityFile, "external task-authority capability");
  const targetAuthority = verifyBoundSuccessor({
    plan: normalizedPlan,
    authority,
    reviewRequestId: normalizedPlan.sourceReviewRequestId,
  });
  requireSuccessorAuthority(targetAuthority, normalizedPlan);
  if (typeof validateLease !== "function") {
    throw new Error("Successor projection requires a fresh local mutation-authority validator.");
  }
  if (normalizedPlan.sourceBranch !== targetBranch
    || normalizedPlan.sourceLeaseDigest !== sourceLeaseDigest
    || normalizedPlan.sourceClaimId !== sourceClaimId) {
    throw new Error("Successor projection input changed the exact scope-expansion source.");
  }
  const observed = leaseStore?.read?.(targetBranch);
  if (!observed) throw new Error("Successor projection requires the exact source or target writer lease.");
  const capabilityPath = requiredExternalCapabilityPath(
    taskAuthorityFile,
    observed.worktreePath,
  );
  const observedDigest = writerLeaseDigest(observed);
  const sourceObserved = observedDigest === sourceLeaseDigest
    && observed.cloudAuthority?.claimId === sourceClaimId;
  const targetObserved = observed.cloudAuthority?.claimId === targetAuthority.claimId;
  if (!sourceObserved && !targetObserved) {
    throw new Error("Successor projection found neither the exact C1 source nor its C2 target.");
  }
  let adopted = false;
  let projection = null;
  let receiptDigest = null;
  const result = mutateWriterLeaseRegistry({
    leaseStore,
    branch: targetBranch,
    expectedLeaseDigest: observedDigest,
    expectedClaimId: observed.cloudAuthority.claimId,
    action: ({ registry, lease }) => {
      const currentIntent = requirePlanIntent(
        registry.scopeExpansionIntents?.[targetBranch],
        normalizedPlan,
      );
      if (lease.cloudAuthority?.claimId === targetAuthority.claimId) {
        const existing = requireAdoptableProjection({
          lease,
          intent: currentIntent,
          plan: normalizedPlan,
          authority: targetAuthority,
          capabilityPath,
          validateLease,
        });
        adopted = true;
        projection = existing.projection;
        receiptDigest = existing.receiptDigest;
        return { registry, lease, intent: currentIntent, changed: false };
      }
      if (writerLeaseDigest(lease) !== sourceLeaseDigest
        || lease.cloudAuthority?.claimId !== sourceClaimId) {
        throw new Error("C1 writer lease changed before the successor projection lock.");
      }
      const ownerIdentityDigest = requireSuccessorOwnerContinuity({
        sourceLease: lease,
        authority: targetAuthority,
      });
      const durableSuccessor = requireSuccessorIntent({
        current: currentIntent,
        supplied: successorIntent,
        promotedEvidence,
        plan: normalizedPlan,
        authority: targetAuthority,
      });
      const sourceBinding = assertTaskAuthorityBinding({
        binding: lease.taskAuthority,
        lease,
      });
      const targetAdmission = buildActiveDirtyScopeExpansionSuccessorAdmission({
        sourceAdmission: lease.admission,
        plan: normalizedPlan,
        authority: targetAuthority,
      });
      const nextLeaseCore = {
        ...lease,
        baseSha: normalizedPlan.targetCanonicalBaseSha,
        admission: targetAdmission,
        cloudAuthority: targetAuthority,
        heartbeatAt: targetAuthority.expiresAt,
        expiresAt: targetAuthority.expiresAt,
      };
      const projectedAt = requiredFreshInstant(now());
      const nextLease = {
        ...nextLeaseCore,
        taskAuthority: continueTaskAuthorityCloudSuccessorBinding({
          sourceLease: lease,
          nextLease: nextLeaseCore,
          capabilityPath,
          boundAt: projectedAt,
        }),
      };
      const validation = requireValidationReceipt(validateLease(nextLease), {
        lease: nextLease,
        authority: targetAuthority,
      });
      projection = Object.freeze({
        leaseDigest: writerLeaseDigest(nextLease),
        claimId: targetAuthority.claimId,
        ownerIdentityDigest,
        receiptDigest: validation.receiptDigest,
        sourceAdmissionDigest: digestValue(lease.admission),
        sourceExistingLaneStateDigest: lease.admission.existingLaneStateDigest,
        sourceTaskAuthorityBindingDigest: sourceBinding.bindingDigest,
        targetTaskAuthorityBindingDigest: nextLease.taskAuthority.bindingDigest,
      });
      receiptDigest = validation.receiptDigest;
      const nextIntent = Object.freeze({
        ...durableSuccessor,
        schema: SCOPE_EXPANSION_INTENT_SCHEMA,
        branch: targetBranch,
        status: "local-cas",
        localProjection: projection,
        localProjectionReceiptDigest: receiptDigest,
      });
      return {
        registry: {
          ...registry,
          leases: { ...registry.leases, [targetBranch]: nextLease },
          scopeExpansionIntents: {
            ...(registry.scopeExpansionIntents || {}),
            [targetBranch]: nextIntent,
          },
        },
        lease: nextLease,
        intent: nextIntent,
        changed: true,
      };
    },
  });
  return Object.freeze({
    lease: result.lease,
    intent: result.intent,
    projection,
    receiptDigest,
    registryRevision: result.registryRevision,
    adopted,
  });
}
export function assertActiveDirtyScopeExpansionTaskSuccessorPreflight({
  lease,
  plan,
  requireTaskAuthority = false,
} = {}) {
  const normalizedPlan = normalizeActiveDirtyScopeExpansionPlan(plan);
  if (!requireTaskAuthority && !lease?.taskAuthority) return lease;
  if (!lease
    || writerLeaseDigest(lease) !== normalizedPlan.sourceLeaseDigest
    || lease.branch !== normalizedPlan.sourceBranch
    || lease.cloudAuthority?.claimId !== normalizedPlan.sourceClaimId
    || lease.baseSha !== normalizedPlan.targetCanonicalBaseSha) {
    throw new Error("Scope-expansion task successor cannot preserve the C1 stable lane identity.");
  }
  assertTaskAuthorityBinding({ binding: lease.taskAuthority, lease });
  return lease;
}
export function buildActiveDirtyScopeExpansionSuccessorAdmission({
  sourceAdmission,
  plan,
  authority,
} = {}) {
  const normalizedPlan = normalizeActiveDirtyScopeExpansionPlan(plan);
  requireSuccessorAuthority(authority, normalizedPlan);
  if (!sourceAdmission || sourceAdmission.schema !== "agentic-lane-admission-lease/v1"
    || sourceAdmission.status !== "admitted"
    || sourceAdmission.writeSetDigest !== normalizedPlan.sourceWriteSetDigest
    || sourceAdmission.manifestDigest !== normalizedPlan.sourceManifestDigest
    || digestValue(sourceAdmission.declaredWriteSet) !== normalizedPlan.sourceWriteSetDigest
    || !requiredDigest(sourceAdmission.existingLaneStateDigest, "source lane-state digest")) {
    throw new Error("C1 admission is not the exact source scope-expansion projection.");
  }
  const semanticScope = normalizedPlan.targetDeclaredWriteSet
    .find(item => item.startsWith("semantic:"))?.slice("semantic:".length);
  const admittedReportDigest = digestValue({
    schema: "agentic-active-dirty-scope-expansion-admitted-report/v1",
    planDigest: normalizedPlan.planDigest,
    claimId: authority.claimId,
    claimDigest: authority.claimDigest,
  });
  const preservationReceiptDigest = digestValue({
    schema: "agentic-active-dirty-scope-expansion-preservation/v1",
    planDigest: normalizedPlan.planDigest,
    sourceAdmissionDigest: digestValue(sourceAdmission),
    successorClaimId: authority.claimId,
  });
  return Object.freeze({
    schema: "agentic-lane-admission-lease/v1",
    status: "admitted",
    semanticScope,
    declaredWriteSet: normalizedPlan.targetDeclaredWriteSet,
    writeSetDigest: normalizedPlan.targetWriteSetDigest,
    manifestDigest: normalizedPlan.targetManifestDigest,
    planReceiptDigest: normalizedPlan.planDigest,
    admissionReceiptDigest: requiredDigest(
      authority.operationReceiptDigest,
      "successor operation receipt digest",
    ),
    existingLaneStateDigest: sourceAdmission.existingLaneStateDigest,
    admittedReportDigest,
    preservationReceiptDigest,
  });
}
function requireSuccessorIntent({ current, supplied, promotedEvidence, plan, authority }) {
  if (!RECOVERABLE_SOURCE_PHASES.has(current.status)) {
    throw new Error("C1 successor projection requires a recoverable pre-local intent phase.");
  }
  assertPhaseShape(current, plan, authority, { allowPreBound: true });
  const candidate = supplied ? withoutIntentDigest(supplied) : current;
  requirePlanIntent(candidate, plan);
  if (candidate.status !== "successor-bound") {
    throw new Error("C1 successor projection requires exact durable successor-bound evidence.");
  }
  if (supplied) assertOnlySuccessorFieldsChanged(current, candidate);
  assertPhaseShape(candidate, plan, authority);
  if (supplied && current.status === "source-retired") {
    const sealedPromotion = requireClaimSnapshot(
      promotedEvidence,
      "sealed promoted successor",
    );
    if (digestValue(candidate.promoted) !== digestValue(sealedPromotion)) {
      throw new Error("Recovered promoted C2 changed its sealed transition evidence.");
    }
  }
  return candidate;
}
function requireAdoptableProjection({
  lease,
  intent,
  plan,
  authority,
  capabilityPath,
  validateLease,
}) {
  if (intent.status !== "local-cas") {
    throw new Error("A C2 lease without its atomic local-cas intent cannot be adopted.");
  }
  assertPhaseShape(intent, plan, authority);
  const binding = assertTaskAuthorityBinding({ binding: lease.taskAuthority, lease });
  const capability = readTaskAuthorityCapability(capabilityPath);
  assertCapabilityMatchesBinding(capability, binding);
  const local = intent.localProjection;
  if (!local || JSON.stringify(Object.keys(local).sort())
      !== JSON.stringify(LOCAL_PROJECTION_FIELDS)
    || local.leaseDigest !== writerLeaseDigest(lease)
    || local.claimId !== authority.claimId
    || local.ownerIdentityDigest !== successorOwnerIdentityDigest({
      lease,
      authority,
    })
    || !requiredDigest(local.sourceAdmissionDigest, "source admission digest")
    || !requiredDigest(local.sourceExistingLaneStateDigest, "source lane-state digest")
    || local.targetTaskAuthorityBindingDigest !== binding.bindingDigest
    || local.sourceTaskAuthorityBindingDigest !== binding.priorBindingDigest
    || intent.localProjectionReceiptDigest !== local.receiptDigest) {
    throw new Error("Existing C2 lease and local-cas intent are not one exact projection.");
  }
  requireProjectedLease({ lease, plan, authority, localProjection: local });
  const validation = requireValidationReceipt(validateLease(lease), {
    lease,
    authority,
  });
  return {
    projection: local,
    receiptDigest: local.receiptDigest,
    currentValidationReceiptDigest: validation.receiptDigest,
  };
}
function requireProjectedLease({ lease, plan, authority, localProjection }) {
  const expectedAdmission = {
    schema: "agentic-lane-admission-lease/v1",
    status: "admitted",
    semanticScope: plan.targetDeclaredWriteSet
      .find(item => item.startsWith("semantic:"))?.slice("semantic:".length),
    declaredWriteSet: plan.targetDeclaredWriteSet,
    writeSetDigest: plan.targetWriteSetDigest,
    manifestDigest: plan.targetManifestDigest,
    planReceiptDigest: plan.planDigest,
    admissionReceiptDigest: authority.operationReceiptDigest,
    existingLaneStateDigest: localProjection.sourceExistingLaneStateDigest,
    admittedReportDigest: digestValue({
      schema: "agentic-active-dirty-scope-expansion-admitted-report/v1",
      planDigest: plan.planDigest,
      claimId: authority.claimId,
      claimDigest: authority.claimDigest,
    }),
    preservationReceiptDigest: digestValue({
      schema: "agentic-active-dirty-scope-expansion-preservation/v1",
      planDigest: plan.planDigest,
      sourceAdmissionDigest: localProjection.sourceAdmissionDigest,
      successorClaimId: authority.claimId,
    }),
  };
  if (lease.baseSha !== plan.targetCanonicalBaseSha
    || lease.fenceSha !== plan.sourceFenceSha
    || digestValue(lease.admission) !== digestValue(expectedAdmission)
    || digestValue(lease.cloudAuthority) !== digestValue(authority)
    || lease.heartbeatAt !== authority.expiresAt
    || lease.expiresAt !== authority.expiresAt) {
    throw new Error("Existing C2 writer lease drifted from the exact successor projection.");
  }
}
function requirePlanIntent(value, plan) {
  const intent = withoutIntentDigest(value);
  if (!intent || JSON.stringify(Object.keys(intent).sort()) !== JSON.stringify(INTENT_FIELDS)
    || intent.schema !== SCOPE_EXPANSION_INTENT_SCHEMA
    || intent.branch !== plan.sourceBranch
    || intent.planDigest !== plan.planDigest
    || intent.sourceLeaseDigest !== plan.sourceLeaseDigest
    || intent.sourceClaimId !== plan.sourceClaimId
    || intent.sourceFenceSha !== plan.sourceFenceSha
    || intent.targetWriteSetDigest !== plan.targetWriteSetDigest
    || intent.targetManifestDigest !== plan.targetManifestDigest
    || intent.targetCanonicalBaseSha !== plan.targetCanonicalBaseSha
    || intent.targetLeaseEpoch !== 1
    || digestValue(intent.planSnapshot) !== digestValue(plan)) {
    throw new Error("Scope-expansion intent changed its exact plan subject.");
  }
  return intent;
}
function requireBoundIntent(intent, authority) {
  const waiting = requireClaimSnapshot(intent.waiting, "waiting successor");
  const promoted = requireClaimSnapshot(intent.promoted, "promoted successor");
  if (waiting.claimId !== authority.claimId
    || promoted.claimId !== waiting.claimId
    || promoted.transitionCounter !== waiting.transitionCounter + 1
    || authority.transitionCounter !== promoted.transitionCounter + 1
    || !requiredDigest(intent.waitingReceiptDigest, "waiting receipt digest")
    || !requiredDigest(intent.sourceRetirementReceiptDigest, "source retirement receipt digest")
    || !requiredDigest(intent.promotedReceiptDigest, "promotion receipt digest")
    || digestValue(intent.boundAuthority) !== digestValue(authority)
    || !requiredDigest(intent.boundReceiptDigest, "bound receipt digest")
    || intent.targetClaimId !== authority.claimId
    || intent.targetClaimDigest !== authority.claimDigest
    || intent.targetReviewRequestId !== authority.reviewRequestId) {
    throw new Error("Scope-expansion successor intent changed its bound C2 evidence.");
  }
}
function assertPhaseShape(intent, plan, authority, { allowPreBound = false } = {}) {
  requirePlanIntent(intent, plan);
  if (intent.completedReceiptDigest !== null) {
    throw new Error("Pre-completion scope-expansion intent carries a completion receipt.");
  }
  const waiting = requireClaimSnapshot(intent.waiting, "waiting successor");
  if (waiting.claimId !== authority.claimId
    || intent.targetClaimId !== authority.claimId
    || !requiredDigest(intent.waitingReceiptDigest, "waiting receipt digest")
    || !requiredDigest(intent.sourceRetirementReceiptDigest, "source retirement receipt digest")) {
    throw new Error("Scope-expansion intent changed its waiting C2 or retirement evidence.");
  }
  if (intent.status === "source-retired") {
    if (!allowPreBound || intent.targetClaimDigest !== waiting.claimDigest) {
      throw new Error("Source-retired recovery intent changed its waiting C2 fence.");
    }
    requireEmptyLaterFields(intent, [
      "promoted", "promotedReceiptDigest", "boundAuthority", "boundReceiptDigest",
      "targetReviewRequestId", "localProjection", "localProjectionReceiptDigest",
      "pullRequestProjection", "pullRequestProjectionReceiptDigest", "finalReceiptDigest",
    ]);
    return;
  }
  if (intent.status === "promoted") {
    if (!allowPreBound) throw new Error("Successor projection requires bound C2 evidence.");
    requirePromotedIntent(intent, waiting, authority);
    requireEmptyLaterFields(intent, [
      "boundAuthority", "boundReceiptDigest", "targetReviewRequestId",
      "localProjection", "localProjectionReceiptDigest", "pullRequestProjection",
      "pullRequestProjectionReceiptDigest", "finalReceiptDigest",
    ]);
    return;
  }
  if (!["successor-bound", "local-cas"].includes(intent.status)) {
    throw new Error("Scope-expansion successor intent phase is not projectable.");
  }
  requirePromotedIntent(intent, waiting, authority);
  requireBoundIntent(intent, authority);
  if (intent.status === "successor-bound") {
    requireEmptyLaterFields(intent, [
      "localProjection", "localProjectionReceiptDigest", "pullRequestProjection",
      "pullRequestProjectionReceiptDigest", "finalReceiptDigest",
    ]);
  } else {
    requireEmptyLaterFields(intent, [
      "pullRequestProjection", "pullRequestProjectionReceiptDigest", "finalReceiptDigest",
    ]);
  }
}
function requirePromotedIntent(intent, waiting, authority) {
  const promoted = requireClaimSnapshot(intent.promoted, "promoted successor");
  if (promoted.claimId !== waiting.claimId
    || promoted.transitionCounter !== waiting.transitionCounter + 1
    || authority.transitionCounter !== promoted.transitionCounter + 1
    || !requiredDigest(intent.promotedReceiptDigest, "promotion receipt digest")) {
    throw new Error("Scope-expansion intent changed its promoted C2 evidence.");
  }
}
function requireClaimSnapshot(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(CLAIM_SNAPSHOT_FIELDS)
    || JSON.stringify(value).length > 65_536
    || !requiredDigest(value.claimId, `${label} claim ID`)
    || !requiredDigest(value.claimDigest, `${label} claim digest`)
    || !/^[0-9a-f]{40}$/u.test(String(value.ledgerRevision || ""))
    || !requiredDigest(value.claimLedgerRevision, `${label} ledger digest`)
    || !Number.isSafeInteger(value.transitionCounter) || value.transitionCounter < 1
    || !Number.isFinite(Date.parse(value.expiresAt))) {
    throw new Error(`Scope-expansion intent ${label} is malformed.`);
  }
  return value;
}
function requireEmptyLaterFields(intent, fields) {
  for (const field of fields) {
    if (intent[field] !== null) {
      throw new Error(`Scope-expansion intent phase carries forbidden ${field} evidence.`);
    }
  }
}
function assertOnlySuccessorFieldsChanged(current, candidate) {
  const allowed = new Set(SUCCESSOR_FIELDS);
  if (current.status !== "source-retired") {
    allowed.delete("promoted");
    allowed.delete("promotedReceiptDigest");
  }
  if (current.status === "successor-bound") {
    allowed.clear();
  }
  const keys = new Set([...Object.keys(current), ...Object.keys(candidate)]);
  for (const key of keys) {
    if (allowed.has(key)) continue;
    if (digestValue(current[key] ?? null) !== digestValue(candidate[key] ?? null)) {
      throw new Error(`Successor recovery changed historical intent field ${key}.`);
    }
  }
}
function requireSuccessorAuthority(authority, plan) {
  if (authority.claimId === plan.sourceClaimId
    || authority.claimDigest === plan.sourceClaimDigest
    || authority.manifestDigest !== plan.targetManifestDigest
    || digestValue(authority.cloudDeclaredWriteScope) !== plan.targetWriteSetDigest
    || JSON.stringify(authority.cloudDeclaredWriteScope)
      !== JSON.stringify(plan.targetDeclaredWriteSet)
    || !requiredDigest(authority.operationReceiptDigest, "successor operation receipt digest")
    || !requiredDigest(authority.claimLedgerRevision, "successor claim ledger revision")
    || !/^[0-9a-f]{40}$/u.test(String(authority.ledgerRevision || ""))
    || !Number.isSafeInteger(authority.transitionCounter)
    || authority.transitionCounter < 1
    || !Number.isFinite(Date.parse(authority.expiresAt))) {
    throw new Error("Bound C2 authority is not the exact expanded successor claim.");
  }
}
function requireSuccessorOwnerContinuity({ sourceLease, authority }) {
  const source = sourceLease.cloudAuthority;
  if (!source
    || source.deviceId !== sourceLease.device
    || source.sessionId !== sourceLease.sessionId
    || authority.deviceId !== sourceLease.device
    || authority.sessionId !== sourceLease.sessionId
    || authority.provider !== source.provider
    || authority.targetRepository !== source.targetRepository
    || authority.ledgerRepository !== source.ledgerRepository) {
    throw new Error("C2 authority changed the immutable C1 owner identity.");
  }
  return successorOwnerIdentityDigest({ lease: sourceLease, authority });
}
function successorOwnerIdentityDigest({ lease, authority }) {
  return digestValue({
    deviceId: lease.device,
    sessionId: lease.sessionId,
    provider: authority.provider,
    targetRepository: authority.targetRepository,
    ledgerRepository: authority.ledgerRepository,
  });
}
function requireValidationReceipt(value, { lease, authority }) {
  const core = value && {
    schema: value.schema,
    status: value.status,
    claimId: value.claimId,
    claimDigest: value.claimDigest,
    ledgerRevision: value.ledgerRevision,
    localLeaseEpoch: value.localLeaseEpoch,
    localFenceSha: value.localFenceSha,
    remoteLeaseEpoch: value.remoteLeaseEpoch,
    cloudVerificationReceiptDigest: value.cloudVerificationReceiptDigest,
    evaluatedAt: value.evaluatedAt,
    expiresAt: value.expiresAt,
  };
  if (!core || JSON.stringify(Object.keys(value).sort())
      !== JSON.stringify(MUTATION_RECEIPT_FIELDS)
    || core.schema !== "agentic-admission-mutation-authority/v1"
    || core.status !== "ready"
    || core.claimId !== authority.claimId
    || core.claimDigest !== authority.claimDigest
    || core.ledgerRevision !== authority.ledgerRevision
    || core.localLeaseEpoch !== lease.epoch
    || core.localFenceSha !== lease.fenceSha
    || core.remoteLeaseEpoch !== authority.leaseEpoch
    || !requiredDigest(core.cloudVerificationReceiptDigest, "cloud verification receipt digest")
    || !Number.isFinite(Date.parse(core.evaluatedAt))
    || core.expiresAt !== new Date(Math.min(
      Date.parse(lease.expiresAt),
      Date.parse(authority.expiresAt),
    )).toISOString()
    || Date.parse(core.evaluatedAt) >= Date.parse(core.expiresAt)
    || value.receiptDigest !== digestValue(core)) {
    throw new Error("Successor projection mutation-authority validation returned no receipt.");
  }
  return value;
}
function withoutIntentDigest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { intentDigest, ...intent } = value;
  return intent;
}
function requiredExternalCapabilityPath(value, worktreePath) {
  const candidate = requiredText(value, "external task-authority capability");
  if (!path.isAbsolute(candidate)) {
    throw new Error("Task-authority capability path must be absolute and external.");
  }
  const canonical = realpathSync(candidate);
  const worktree = realpathSync(requiredText(worktreePath, "writer worktree path"));
  const relative = path.relative(worktree, canonical);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error("Task-authority capability must remain outside the writer worktree.");
  }
  return canonical;
}
function requiredFreshInstant(now) {
  const instant = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(instant.getTime()) || Math.abs(Date.now() - instant.getTime()) > 60_000) {
    throw new Error("Successor projection execution time is not fresh.");
  }
  return instant.toISOString();
}
function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}
function requiredDigest(value, label) {
  if (!DIGEST_PATTERN.test(String(value || ""))) throw new Error(`${label} must be a SHA-256 digest.`);
  return String(value);
}
function sortedFieldNames(value) {
  return Object.freeze(value.split(" ").sort());
}
