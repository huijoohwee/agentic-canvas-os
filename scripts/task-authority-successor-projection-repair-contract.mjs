// Responsibility: Seal one exact, capability-bound repair of a successor lease projection.
import path from "node:path";
import { canonicalJson, digestValue, normalizeWriteSet } from "./cloud-collaboration-primitives.mjs";
import { assertTaskAuthorityBinding, normalizeTaskAuthorityBinding } from "./task-bound-lane-authority-contract.mjs";
import { projectWriterLeasePullRequestMarker } from "./writer-lease-lib.mjs";
export const TASK_AUTHORITY_SUCCESSOR_PROJECTION_REPAIR_PHASES = Object.freeze([
  "prepared", "projection_prepared", "successor_promoted", "successor_bound", "lease_projected",
  "marker_projected", "expansion_finalized", "verified", "complete",
]);
export const EVIDENCE_SCHEMA = "agentic-task-authority-successor-projection-repair-evidence/v2";
export const PLAN_SCHEMA = "agentic-task-authority-successor-projection-repair-plan/v2";
export const AUTHORIZATION_SCHEMA = "agentic-task-authority-successor-projection-repair-authorization/v2";
export const INTENT_SCHEMA = "agentic-task-authority-successor-projection-repair-intent/v2";
export const PHASE_RECEIPT_SCHEMA = "agentic-task-authority-successor-projection-repair-phase-receipt/v1";
export const RECEIPT_SCHEMA = "agentic-task-authority-successor-projection-repair-receipt/v2";
const DIGEST = /^[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40}$/u;
export function sealTaskAuthoritySuccessorProjectionRepairEvidence(value) {
  const { evidenceDigest: _ignored, ...core } = clone(value, "evidence");
  return normalizeTaskAuthoritySuccessorProjectionRepairEvidence({
    ...core,
    evidenceDigest: digestValue(core),
  });
}
export function normalizeTaskAuthoritySuccessorProjectionRepairEvidence(value) {
  const source = object(value, "evidence");
  exact(source, ["schema", "repository", "branch", "sessionId", "source", "expansion",
    "cloud", "pullRequest", "capability", "evidenceDigest"], "evidence");
  if (source.schema !== EVIDENCE_SCHEMA) invalid("evidence schema");
  const core = {
    schema: EVIDENCE_SCHEMA,
    repository: absolute(source.repository, "repository"),
    branch: text(source.branch, "branch"),
    sessionId: text(source.sessionId, "session"),
    source: normalizeSource(source.source),
    expansion: normalizeExpansion(source.expansion),
    cloud: normalizeCloud(source.cloud),
    pullRequest: normalizePullRequest(source.pullRequest),
    capability: normalizeCapability(source.capability),
  };
  assertEvidenceJoins(core);
  if (source.evidenceDigest !== digestValue(core)) invalid("evidence digest");
  return freeze({ ...core, evidenceDigest: source.evidenceDigest });
}
export function buildTaskAuthoritySuccessorProjectionRepairPlan(evidence) {
  const normalized = normalizeTaskAuthoritySuccessorProjectionRepairEvidence(evidence);
  const core = freeze({
    schema: PLAN_SCHEMA,
    operation: "task-authority-successor-projection-repair",
    evidence: normalized,
    evidenceDigest: normalized.evidenceDigest,
  });
  const planDigest = digestValue(core);
  return freeze({ ...core, planDigest,
    exactAuthorization: `authorize task-authority-successor-projection-repair ${planDigest}` });
}
export function normalizeTaskAuthoritySuccessorProjectionRepairPlan(value) {
  exact(value, ["schema", "operation", "evidence", "evidenceDigest", "planDigest",
    "exactAuthorization"], "plan");
  const expected = buildTaskAuthoritySuccessorProjectionRepairPlan(value.evidence);
  if (canonicalJson(value) !== canonicalJson(expected)) invalid("plan");
  return expected;
}
export function authorizeTaskAuthoritySuccessorProjectionRepair(plan, authorization) {
  const normalized = normalizeTaskAuthoritySuccessorProjectionRepairPlan(plan);
  if (authorization !== normalized.exactAuthorization) invalid("authorization");
  const core = { schema: AUTHORIZATION_SCHEMA, planDigest: normalized.planDigest,
    exactAuthorization: normalized.exactAuthorization };
  return freeze({ ...core, authorizationDigest: digestValue(core) });
}
export function createTaskAuthoritySuccessorProjectionRepairIntent(plan, authorization) {
  const normalizedPlan = normalizeTaskAuthoritySuccessorProjectionRepairPlan(plan);
  const authority = normalizeAuthorization(authorization, normalizedPlan);
  return sealIntent({
    schema: INTENT_SCHEMA,
    planDigest: normalizedPlan.planDigest,
    planSnapshot: normalizedPlan,
    authorizationDigest: authority.authorizationDigest,
    operationId: digestValue({ schema: INTENT_SCHEMA, planDigest: normalizedPlan.planDigest }),
    status: "prepared",
    phases: {},
    receipt: null,
  });
}
export function normalizeTaskAuthoritySuccessorProjectionRepairIntent(value) {
  exact(value, ["schema", "planDigest", "planSnapshot", "authorizationDigest", "operationId",
    "status", "phases", "receipt", "intentDigest"], "intent");
  const plan = normalizeTaskAuthoritySuccessorProjectionRepairPlan(value.planSnapshot);
  const reached = phaseIndex(value.status);
  const phases = {};
  for (let index = 1; index <= Math.min(reached, 7); index += 1) {
    const phase = TASK_AUTHORITY_SUCCESSOR_PROJECTION_REPAIR_PHASES[index];
    phases[phase] = normalizeTaskAuthoritySuccessorProjectionRepairPhaseReceipt({
      plan, phase, value: value.phases?.[phase],
    });
  }
  if (Object.keys(phases).length !== Object.keys(value.phases || {}).length) invalid("intent phases");
  const core = {
    schema: INTENT_SCHEMA,
    planDigest: digest(value.planDigest, "intent plan"),
    planSnapshot: plan,
    authorizationDigest: digest(value.authorizationDigest, "authorization digest"),
    operationId: digest(value.operationId, "operation ID"),
    status: value.status,
    phases,
    receipt: value.receipt,
  };
  if (core.planDigest !== plan.planDigest) invalid("intent plan join");
  assertPhaseJoins(plan, phases, reached);
  if (value.status === "complete") {
    core.receipt = normalizeTaskAuthoritySuccessorProjectionRepairReceipt(value.receipt);
    if (core.receipt.planDigest !== plan.planDigest || core.receipt.operationId !== core.operationId
      || canonicalJson(core.receipt.phases) !== canonicalJson(phases)) invalid("receipt join");
  } else if (core.receipt !== null) invalid("premature receipt");
  if (value.intentDigest !== digestValue(core)) invalid("intent digest");
  return freeze({ ...core, intentDigest: value.intentDigest });
}
export function advanceTaskAuthoritySuccessorProjectionRepairIntent(value, phase, receipt) {
  const current = normalizeTaskAuthoritySuccessorProjectionRepairIntent(value);
  const expected = TASK_AUTHORITY_SUCCESSOR_PROJECTION_REPAIR_PHASES[phaseIndex(current.status) + 1];
  if (phase !== expected) invalid("phase order");
  if (phase === "complete") {
    const normalizedReceipt = normalizeTaskAuthoritySuccessorProjectionRepairReceipt(receipt, current);
    return sealIntent({ ...intentCore(current), status: "complete", receipt: normalizedReceipt });
  }
  const normalized = normalizeTaskAuthoritySuccessorProjectionRepairPhaseReceipt({
    plan: current.planSnapshot, phase, value: receipt,
  });
  return sealIntent({ ...intentCore(current), status: phase,
    phases: { ...current.phases, [phase]: normalized } });
}
export function normalizeTaskAuthoritySuccessorProjectionRepairPhaseReceipt({ plan, phase, value }) {
  const normalizedPlan = normalizeTaskAuthoritySuccessorProjectionRepairPlan(plan);
  exact(value, ["schema", "phase", "planDigest", "operationKey", "values", "receiptDigest"],
    `${phase} receipt`);
  if (![...TASK_AUTHORITY_SUCCESSOR_PROJECTION_REPAIR_PHASES.slice(1, -1)].includes(phase)) {
    invalid("receipt phase");
  }
  const core = {
    schema: PHASE_RECEIPT_SCHEMA,
    phase,
    planDigest: normalizedPlan.planDigest,
    operationKey: phaseOperationKey(normalizedPlan, phase),
    values: normalizePhaseValues(normalizedPlan, phase, value.values),
  };
  const inner = { ...core.values };
  const innerDigest = inner.receiptDigest;
  delete inner.receiptDigest;
  if (innerDigest !== digestValue(inner)) invalid(`${phase} values digest`);
  if (canonicalJson(value) !== canonicalJson({ ...core, receiptDigest: digestValue(core) })) {
    invalid(`${phase} receipt`);
  }
  return freeze({ ...core, receiptDigest: digestValue(core) });
}
export function buildTaskAuthoritySuccessorProjectionRepairReceipt({ intent, verified }) {
  const current = normalizeTaskAuthoritySuccessorProjectionRepairIntent(intent);
  if (current.status !== "verified") invalid("completion source");
  const exactVerification = normalizeTaskAuthoritySuccessorProjectionRepairPhaseReceipt({
    plan: current.planSnapshot, phase: "verified", value: verified,
  });
  if (canonicalJson(exactVerification) !== canonicalJson(current.phases.verified)) {
    invalid("completion verification");
  }
  const evidence = current.planSnapshot.evidence;
  const core = {
    schema: RECEIPT_SCHEMA,
    status: "repaired",
    operationId: current.operationId,
    planDigest: current.planDigest,
    branch: evidence.branch,
    sourceLeaseDigest: evidence.source.leaseDigest,
    targetLeaseDigest: current.phases.lease_projected.values.targetLeaseDigest,
    priorBindingDigest: evidence.source.binding.bindingDigest,
    continuationBindingDigest:
      current.phases.lease_projected.values.continuationBinding.bindingDigest,
    successorClaimId: evidence.cloud.successor.claimId,
    expansionPlanDigest: evidence.expansion.intent.planDigest,
    sourceSnapshotDigest: evidence.source.snapshot.snapshotDigest,
    phases: current.phases,
    sourceMutation: false,
    gitMutation: false,
  };
  return freeze({ ...core, receiptDigest: digestValue(core) });
}
export function normalizeTaskAuthoritySuccessorProjectionRepairReceipt(value, intent = null) {
  const source = object(value, "receipt");
  exact(source, ["schema", "status", "operationId", "planDigest", "branch", "sourceLeaseDigest",
    "targetLeaseDigest", "priorBindingDigest", "continuationBindingDigest", "successorClaimId",
    "expansionPlanDigest", "sourceSnapshotDigest", "phases", "sourceMutation", "gitMutation",
    "receiptDigest"], "receipt");
  const { receiptDigest, ...core } = source;
  if (core.schema !== RECEIPT_SCHEMA || core.status !== "repaired"
    || core.sourceMutation !== false || core.gitMutation !== false
    || receiptDigest !== digestValue(core)) invalid("receipt");
  for (const key of ["operationId", "planDigest", "sourceLeaseDigest", "targetLeaseDigest",
    "priorBindingDigest", "continuationBindingDigest", "successorClaimId",
    "expansionPlanDigest", "sourceSnapshotDigest"]) digest(core[key], key);
  if (intent) {
    const current = normalizeTaskAuthoritySuccessorProjectionRepairIntent(intent);
    const rebuilt = buildTaskAuthoritySuccessorProjectionRepairReceipt({
      intent: current, verified: current.phases.verified,
    });
    if (canonicalJson(source) !== canonicalJson(rebuilt)) invalid("receipt reconstruction");
  }
  return freeze({ ...core, receiptDigest });
}
function normalizeSource(value) {
  exact(value, ["lease", "leaseDigest", "binding", "snapshot", "currentDirt",
    "dirtReconciliation"], "source");
  const lease = clone(value.lease, "source lease");
  if (digestValue(lease) !== digest(value.leaseDigest, "source lease digest")) invalid("lease digest");
  const binding = normalizeTaskAuthorityBinding(value.binding);
  assertTaskAuthorityBinding({ binding, lease });
  if (lease.taskAuthority?.bindingDigest !== binding.bindingDigest) invalid("source binding join");
  return freeze({ lease, leaseDigest: value.leaseDigest, binding,
    snapshot: normalizeSnapshot(value.snapshot), currentDirt: normalizeDirt(value.currentDirt),
    dirtReconciliation: normalizeReconciliation(value.dirtReconciliation) });
}
function normalizeSnapshot(value) {
  exact(value, ["headSha", "treeSha", "remoteHeadSha", "indexStateDigest", "snapshotDigest"],
    "snapshot");
  const core = { headSha: sha(value.headSha, "head"), treeSha: sha(value.treeSha, "tree"),
    remoteHeadSha: sha(value.remoteHeadSha, "remote head"),
    indexStateDigest: digest(value.indexStateDigest, "index state") };
  if (value.snapshotDigest !== digestValue(core)) invalid("snapshot digest");
  return freeze({ ...core, snapshotDigest: value.snapshotDigest });
}
function normalizeDirt(value) {
  exact(value, ["changedPaths", "stagedPaths", "unstagedPaths", "untrackedPaths",
    "stagedPatchDigest", "unstagedPatchDigest", "indexEntriesDigest", "dirtyDigest"],
  "current dirt");
  const core = {
    changedPaths: paths(value.changedPaths, "changed paths"),
    stagedPaths: paths(value.stagedPaths, "staged paths"),
    unstagedPaths: paths(value.unstagedPaths, "unstaged paths", true),
    untrackedPaths: paths(value.untrackedPaths, "untracked paths", true),
    stagedPatchDigest: digest(value.stagedPatchDigest, "staged patch"),
    unstagedPatchDigest: digest(value.unstagedPatchDigest, "unstaged patch"),
    indexEntriesDigest: digest(value.indexEntriesDigest, "index entries"),
  };
  if (value.dirtyDigest !== digestValue(core)
    || canonicalJson(core.changedPaths)
      !== canonicalJson([...new Set([...core.stagedPaths, ...core.unstagedPaths,
        ...core.untrackedPaths])].sort())) invalid("current dirt join");
  return freeze({ ...core, dirtyDigest: value.dirtyDigest });
}
function normalizeReconciliation(value) {
  exact(value, ["historicalDirtyDigest", "historicalChangedPaths", "currentDirtyDigest",
    "addedPaths", "removedPaths", "commonPaths", "receiptDigest"], "dirt reconciliation");
  const core = {
    historicalDirtyDigest: digest(value.historicalDirtyDigest, "historical dirt"),
    historicalChangedPaths: paths(value.historicalChangedPaths, "historical paths"),
    currentDirtyDigest: digest(value.currentDirtyDigest, "current dirt"),
    addedPaths: paths(value.addedPaths, "added paths"),
    removedPaths: paths(value.removedPaths, "removed paths", true),
    commonPaths: paths(value.commonPaths, "common paths"),
  };
  if (value.receiptDigest !== digestValue(core)) invalid("reconciliation digest");
  return freeze({ ...core, receiptDigest: value.receiptDigest });
}
function normalizeExpansion(value) {
  exact(value, ["intent", "intentDigest"], "expansion");
  const intent = clone(value.intent, "scope-expansion intent");
  if (intent.schema !== "agentic-active-dirty-scope-expansion-intent/v1"
    || intent.status !== "source-retired" || digestValue(intent) !== value.intentDigest) {
    invalid("source-retired expansion");
  }
  return freeze({ intent, intentDigest: digest(value.intentDigest, "expansion digest") });
}
function normalizeCloud(value) {
  exact(value, ["ledgerRevision", "ledgerDigest", "successor", "inventoryDigest"], "cloud");
  return freeze({ ledgerRevision: sha(value.ledgerRevision, "ledger revision"),
    ledgerDigest: digest(value.ledgerDigest, "ledger digest"),
    successor: normalizeSuccessor(value.successor),
    inventoryDigest: digest(value.inventoryDigest, "inventory digest") });
}
function normalizeSuccessor(value) {
  exact(value, ["claimId", "claimDigest", "state", "writeAuthority", "scopeReserved",
    "canonicalBaseRevision", "laneRevision", "writeSetDigest", "leaseEpoch",
    "transitionCounter", "predecessorClaimId", "reviewRequestId", "expiresAt",
    "operationReceiptDigest", "claimRecordDigest"], "successor");
  const core = { claimId: digest(value.claimId, "claim ID"),
    claimDigest: digest(value.claimDigest, "claim digest"), state: value.state,
    writeAuthority: value.writeAuthority, scopeReserved: value.scopeReserved,
    canonicalBaseRevision: sha(value.canonicalBaseRevision, "claim base"),
    laneRevision: sha(value.laneRevision, "claim lane"),
    writeSetDigest: digest(value.writeSetDigest, "claim write set"),
    leaseEpoch: integer(value.leaseEpoch, "lease epoch", 1),
    transitionCounter: integer(value.transitionCounter, "transition counter", 1),
    predecessorClaimId: digest(value.predecessorClaimId, "predecessor claim"),
    reviewRequestId: value.reviewRequestId,
    expiresAt: instant(value.expiresAt, "claim expiry"),
    operationReceiptDigest: digest(value.operationReceiptDigest, "claim receipt") };
  if (core.state !== "waiting-successor" || core.writeAuthority !== false
    || core.scopeReserved !== false || core.reviewRequestId !== null
    || value.claimRecordDigest !== digestValue(core)) invalid("waiting successor");
  return freeze({ ...core, claimRecordDigest: value.claimRecordDigest });
}
function normalizePullRequest(value) {
  exact(value, ["url", "number", "nodeId", "repository", "author", "state", "isDraft",
    "branch", "headSha", "baseBranch", "markerDigest", "bodyDigest"], "pull request");
  if (value.state !== "OPEN" || value.isDraft !== true || value.baseBranch !== "main") {
    invalid("pull request state");
  }
  return freeze({ url: text(value.url, "pull URL"), number: integer(value.number, "PR", 1),
    nodeId: text(value.nodeId, "PR node"), repository: text(value.repository, "PR repository"),
    author: text(value.author, "PR author"), state: value.state, isDraft: value.isDraft,
    branch: text(value.branch, "PR branch"), headSha: sha(value.headSha, "PR head"),
    baseBranch: value.baseBranch, markerDigest: digest(value.markerDigest, "marker"),
    bodyDigest: digest(value.bodyDigest, "body") });
}
function normalizeCapability(value) {
  exact(value, ["authoritySubjectId", "proofAdapterId", "generation", "publicKeyDigest",
    "bindingDigest"], "capability");
  return freeze({ authoritySubjectId: text(value.authoritySubjectId, "authority subject"),
    proofAdapterId: text(value.proofAdapterId, "proof adapter"),
    generation: integer(value.generation, "generation", 1),
    publicKeyDigest: digest(value.publicKeyDigest, "public key"),
    bindingDigest: digest(value.bindingDigest, "capability binding") });
}
function assertEvidenceJoins(value) {
  const { source, expansion, cloud, pullRequest, capability } = value;
  const intent = expansion.intent;
  const plan = object(intent.planSnapshot, "expansion plan snapshot");
  const current = source.currentDirt;
  const historical = source.dirtReconciliation;
  const added = difference(current.changedPaths, historical.historicalChangedPaths);
  const removed = difference(historical.historicalChangedPaths, current.changedPaths);
  const common = current.changedPaths.filter(item => historical.historicalChangedPaths.includes(item));
  const sourceSet = normalizeWriteSet(source.lease.admission?.declaredWriteSet || []);
  const targetSet = normalizeWriteSet(plan.targetDeclaredWriteSet || []);
  if (source.lease.status !== "active" || source.lease.branch !== value.branch
    || source.lease.sessionId !== value.sessionId || source.snapshot.headSha !== source.snapshot.remoteHeadSha
    || source.lease.fenceSha !== source.snapshot.headSha || source.leaseDigest !== intent.sourceLeaseDigest
    || source.lease.cloudAuthority?.claimId !== intent.sourceClaimId
    || source.lease.admission?.status !== "admitted"
    || source.lease.admission?.writeSetDigest !== plan.sourceWriteSetDigest
    || source.lease.admission?.manifestDigest !== plan.sourceManifestDigest
    || source.binding.bindingDigest !== capability.bindingDigest
    || source.binding.authoritySubjectId !== capability.authoritySubjectId
    || source.binding.proofAdapterId !== capability.proofAdapterId
    || source.binding.generation !== capability.generation
    || source.binding.publicKeyDigest !== capability.publicKeyDigest
    || historical.historicalDirtyDigest !== plan.sourceDirtyDigest
    || canonicalJson(historical.historicalChangedPaths)
      !== canonicalJson([...plan.sourceChangedPaths].sort())
    || historical.currentDirtyDigest !== current.dirtyDigest
    || canonicalJson(historical.addedPaths) !== canonicalJson(added)
    || canonicalJson(historical.removedPaths) !== canonicalJson(removed)
    || canonicalJson(historical.commonPaths) !== canonicalJson(common)
    || removed.length !== 0 || current.untrackedPaths.length !== 0
    || current.changedPaths.some(candidate => !covered(sourceSet, candidate)
      || !covered(targetSet, candidate))
    || intent.targetClaimId !== cloud.successor.claimId
    || intent.targetClaimDigest !== cloud.successor.claimDigest
    || intent.planDigest !== plan.planDigest
    || intent.targetWriteSetDigest !== plan.targetWriteSetDigest
    || intent.targetManifestDigest !== plan.targetManifestDigest
    || intent.targetCanonicalBaseSha !== plan.targetCanonicalBaseSha
    || intent.waiting?.claimId !== cloud.successor.claimId
    || cloud.successor.predecessorClaimId !== intent.sourceClaimId
    || cloud.successor.canonicalBaseRevision !== intent.targetCanonicalBaseSha
    || cloud.successor.laneRevision !== source.snapshot.headSha
    || cloud.successor.writeSetDigest !== intent.targetWriteSetDigest
    || pullRequest.url !== source.lease.pullRequestUrl || pullRequest.branch !== value.branch
    || pullRequest.headSha !== source.snapshot.headSha) invalid("evidence joins");
}
function normalizePhaseValues(plan, phase, value) {
  const source = object(value, `${phase} values`);
  if (phase === "projection_prepared") return preparedValues(plan, source);
  if (phase === "successor_promoted") return promotedValues(plan, source);
  if (phase === "successor_bound") return boundValues(plan, source);
  if (phase === "lease_projected") return leaseValues(plan, source);
  if (phase === "marker_projected") return markerValues(plan, source);
  if (phase === "expansion_finalized") return finalizationValues(plan, source);
  if (phase === "verified") return verifiedValues(plan, source);
  invalid("phase values");
}
function preparedValues(plan, value) {
  exact(value, ["sourceLeaseDigest", "sourceBindingDigest", "prospectiveLane",
    "prospectiveLaneDigest", "continuationBinding", "capabilityVerificationReceipt",
    "projectedAt", "expiresAt", "expansionIntentDigest", "receiptDigest"], "prepared values");
  const lane = clone(value.prospectiveLane, "prospective lane");
  const binding = normalizeTaskAuthorityBinding(value.continuationBinding);
  const evidence = plan.evidence;
  if (value.sourceLeaseDigest !== evidence.source.leaseDigest
    || value.sourceBindingDigest !== evidence.source.binding.bindingDigest
    || value.prospectiveLaneDigest !== digestValue(lane)
    || lane.branch !== evidence.branch || lane.scope !== evidence.source.lease.scope
    || lane.device !== evidence.source.lease.device || lane.epoch !== evidence.source.lease.epoch
    || lane.baseSha !== evidence.expansion.intent.targetCanonicalBaseSha
    || lane.cloudClaimId !== evidence.cloud.successor.claimId
    || binding.bindingMode !== "continuation"
    || binding.priorBindingDigest !== evidence.source.binding.bindingDigest
    || binding.laneBindingDigest !== digestValue(lane)
    || value.expansionIntentDigest !== evidence.expansion.intentDigest
    || Date.parse(value.projectedAt) >= Date.parse(value.expiresAt)) invalid("prepared joins");
  const capabilityReceipt = normalizeCapabilityReceipt(plan,
    value.capabilityVerificationReceipt, value.projectedAt);
  digest(value.receiptDigest, "prepared values digest");
  return freeze({ ...value, prospectiveLane: lane, continuationBinding: binding,
    capabilityVerificationReceipt: capabilityReceipt });
}
function promotedValues(plan, value) {
  exact(value, ["claimId", "claimDigest", "transitionCounter", "state", "writeAuthority",
    "scopeReserved", "operationReceiptDigest", "claimLedgerRevision", "ledgerRevision",
    "expiresAt", "receiptDigest"], "promoted values");
  if (value.claimId !== plan.evidence.cloud.successor.claimId || value.state !== "active"
    || value.writeAuthority !== true || value.scopeReserved !== true
    || value.transitionCounter !== plan.evidence.cloud.successor.transitionCounter + 1) {
    invalid("promotion join");
  }
  for (const key of ["claimDigest", "operationReceiptDigest", "claimLedgerRevision",
    "receiptDigest"]) digest(value[key], key);
  sha(value.ledgerRevision, "promotion ledger"); instant(value.expiresAt, "promotion expiry");
  return freeze({ ...value });
}
function boundValues(plan, value) {
  exact(value, ["authority", "authorityDigest", "reviewRequestId",
    "cloudVerificationReceiptDigest", "receiptDigest"], "bound values");
  const authority = normalizeBoundAuthority(plan, value.authority);
  if (value.authorityDigest !== digestValue(authority)
    || authority.claimId !== plan.evidence.cloud.successor.claimId
    || authority.canonicalBaseSha !== plan.evidence.expansion.intent.targetCanonicalBaseSha
    || authority.laneRevision !== plan.evidence.source.snapshot.headSha
    || authority.writeSetDigest !== plan.evidence.expansion.intent.targetWriteSetDigest
    || authority.reviewRequestId !== value.reviewRequestId || !value.reviewRequestId
    || authority.transitionCounter !== plan.evidence.cloud.successor.transitionCounter + 2
    || !["active", "current"].includes(authority.state)) invalid("bound authority");
  digest(value.cloudVerificationReceiptDigest, "cloud verification");
  digest(value.receiptDigest, "bound values digest");
  return freeze({ ...value, authority });
}
function leaseValues(plan, value) {
  exact(value, ["sourceLeaseDigest", "targetLease", "targetLeaseDigest", "continuationBinding",
    "storeTransitionReceipt", "expansionIntentDigest", "receiptDigest"],
  "lease values");
  const target = clone(value.targetLease, "target lease");
  const binding = normalizeTaskAuthorityBinding(value.continuationBinding);
  assertTaskAuthorityBinding({ binding, lease: target });
  if (value.sourceLeaseDigest !== plan.evidence.source.leaseDigest
    || value.targetLeaseDigest !== digestValue(target)
    || target.taskAuthority?.bindingDigest !== binding.bindingDigest
    || binding.priorBindingDigest !== plan.evidence.source.binding.bindingDigest
    || target.baseSha !== plan.evidence.expansion.intent.targetCanonicalBaseSha
    || target.cloudAuthority?.claimId !== plan.evidence.cloud.successor.claimId
    || target.admission?.writeSetDigest !== plan.evidence.expansion.intent.targetWriteSetDigest
    || value.expansionIntentDigest !== plan.evidence.expansion.intentDigest) invalid("lease joins");
  const transition = normalizeStoreTransition(plan, value.storeTransitionReceipt,
    target, binding);
  digest(value.receiptDigest, "lease values digest");
  return freeze({ ...value, targetLease: target, continuationBinding: binding,
    storeTransitionReceipt: transition });
}
function normalizeCapabilityReceipt(plan, value, projectedAt, binding = plan.evidence.source.binding, operation = `task-authority-successor-projection-repair:prepare:${plan.planDigest}`) {
  exact(value, ["schema", "status", "authoritySubjectId", "proofAdapterId", "generation",
    "bindingDigest", "proofDigest", "operation", "verifiedAt", "receiptDigest"], "capability receipt");
  const capability = plan.evidence.capability;
  if (value.schema !== "agentic-task-authority-verification-receipt/v1"
    || value.status !== "verified" || value.authoritySubjectId !== capability.authoritySubjectId
    || value.proofAdapterId !== capability.proofAdapterId || value.generation !== capability.generation
    || value.bindingDigest !== binding.bindingDigest || value.operation !== operation
    || (projectedAt && value.verifiedAt !== projectedAt)) invalid("capability receipt joins");
  digest(value.proofDigest, "proof"); instant(value.verifiedAt, "proof time");
  const receiptCore = { authoritySubjectId: value.authoritySubjectId, bindingDigest: value.bindingDigest,
    proofDigest: value.proofDigest, operation, verifiedAt: value.verifiedAt };
  if (value.receiptDigest !== digestValue(receiptCore)) invalid("capability receipt digest"); return freeze({ ...value });
}
function normalizeBoundAuthority(plan, value) {
  const source = object(plan.evidence.source.lease.cloudAuthority, "source cloud authority");
  exact(value, ["schema", "provider", "ledgerRepository", "targetRepository", "claimId", "claimDigest", "ledgerRevision", "ledgerDigest", "claimLedgerRevision", "entrySchema", "claimIdentitySchema", "operationReceiptDigest", "mutationAuthorityEligible", "canonicalBaseSha", "laneRevision", "cloudDeclaredWriteScope", "writeSetDigest", "deviceId", "sessionId", "reviewRequestId", "leaseEpoch", "transitionCounter", "state", "expiresAt", "integrationReceiptDigest", "integration", "manifestDigest"], "bound cloud authority");
  const authority = clone(value, "bound authority");
  const stable = ["schema", "provider", "ledgerRepository", "targetRepository", "entrySchema", "claimIdentitySchema", "mutationAuthorityEligible", "deviceId", "sessionId"];
  if (stable.some(key => authority[key] !== source[key])
    || authority.claimId !== plan.evidence.cloud.successor.claimId
    || authority.canonicalBaseSha !== plan.evidence.expansion.intent.targetCanonicalBaseSha
    || authority.laneRevision !== plan.evidence.source.snapshot.headSha
    || canonicalJson(normalizeWriteSet(authority.cloudDeclaredWriteScope))
      !== canonicalJson(normalizeWriteSet(
        plan.evidence.expansion.intent.planSnapshot.targetDeclaredWriteSet))
    || authority.writeSetDigest !== plan.evidence.expansion.intent.targetWriteSetDigest
    || authority.manifestDigest !== plan.evidence.expansion.intent.targetManifestDigest
    || authority.leaseEpoch !== plan.evidence.cloud.successor.leaseEpoch
    || authority.transitionCounter !== plan.evidence.cloud.successor.transitionCounter + 2
    || authority.reviewRequestId !== `github-pull-request:${plan.evidence.pullRequest.nodeId}`
    || authority.state !== "active" || authority.integration !== null
    || authority.integrationReceiptDigest !== null) invalid("bound cloud authority joins");
  sha(authority.ledgerRevision, "bound ledger"); sha(authority.canonicalBaseSha, "bound base"); sha(authority.laneRevision, "bound lane");
  for (const key of ["claimId", "claimDigest", "ledgerDigest", "claimLedgerRevision",
    "writeSetDigest", "operationReceiptDigest", "manifestDigest"]) digest(authority[key], key);
  instant(authority.expiresAt, "bound expiry");
  return freeze(authority);
}
function normalizeStoreTransition(plan, value, target, binding) {
  exact(value, ["schema", "planDigest", "branch", "method", "authorityEnforcement",
    "sourceLeaseDigest", "targetLeaseDigest", "sourceBindingDigest",
    "continuationBindingDigest", "operationDigest", "frozenIncidentOnly", "targetCapabilityVerificationReceipt", "receiptDigest"], "store transition receipt");
  const operation = { schema: "agentic-task-authority-successor-store-transition-operation/v1", planDigest: plan.planDigest, branch: plan.evidence.branch,
    sourceLeaseDigest: plan.evidence.source.leaseDigest, targetLeaseDigest: digestValue(target),
    sourceBindingDigest: plan.evidence.source.binding.bindingDigest,
    continuationBindingDigest: binding.bindingDigest };
  const targetProof = normalizeCapabilityReceipt(plan, value.targetCapabilityVerificationReceipt, null, binding, `task-authority-successor-projection-repair:target-proof:${plan.planDigest}`);
  const core = { schema: "agentic-task-authority-successor-store-transition/v1", planDigest: plan.planDigest, branch: plan.evidence.branch,
    method: "writer-lease-registry-cas.casWriterLeaseProjection",
    authorityEnforcement: "source-barrier+exact-cas+target-proof",
    sourceLeaseDigest: operation.sourceLeaseDigest, targetLeaseDigest: operation.targetLeaseDigest,
    sourceBindingDigest: operation.sourceBindingDigest, continuationBindingDigest: operation.continuationBindingDigest,
    operationDigest: digestValue(operation), frozenIncidentOnly: true,
    targetCapabilityVerificationReceipt: targetProof };
  if (canonicalJson(value) !== canonicalJson({ ...core, receiptDigest: digestValue(core) })) invalid("store transition receipt");
  return freeze({ ...core, receiptDigest: digestValue(core) });
}
function markerValues(plan, value) {
  exact(value, ["pullRequestUrl", "pullRequestNodeId", "leaseDigest", "markerDigest",
    "bodyDigest", "beforeBodyDigest", "receiptDigest"], "marker values");
  if (value.pullRequestUrl !== plan.evidence.pullRequest.url
    || value.pullRequestNodeId !== plan.evidence.pullRequest.nodeId) invalid("marker PR join");
  for (const key of ["leaseDigest", "markerDigest", "bodyDigest", "beforeBodyDigest",
    "receiptDigest"]) digest(value[key], key);
  return freeze({ ...value });
}
function finalizationValues(plan, value) {
  exact(value, ["expansionIntentDigest", "expansionFinalReceiptDigest", "status",
    "mutationAuthorityReceiptDigest", "receiptDigest"], "finalization values");
  if (value.status !== "complete" || value.expansionIntentDigest === plan.evidence.expansion.intentDigest) {
    invalid("finalization join");
  }
  for (const key of ["expansionIntentDigest", "expansionFinalReceiptDigest",
    "mutationAuthorityReceiptDigest", "receiptDigest"]) digest(value[key], key);
  return freeze({ ...value });
}
function verifiedValues(plan, value) {
  exact(value, ["sourceSnapshotDigest", "currentDirtDigest", "leaseDigest", "authorityDigest",
    "markerDigest", "bodyDigest", "expansionIntentDigest", "claimId", "verifiedAt",
    "cloudVerificationReceiptDigest", "receiptDigest"], "verified values");
  if (value.sourceSnapshotDigest !== plan.evidence.source.snapshot.snapshotDigest
    || value.currentDirtDigest !== plan.evidence.source.currentDirt.dirtyDigest
    || value.claimId !== plan.evidence.cloud.successor.claimId) invalid("verification subject");
  for (const key of ["leaseDigest", "authorityDigest", "markerDigest", "bodyDigest",
    "expansionIntentDigest", "cloudVerificationReceiptDigest", "receiptDigest"])
    digest(value[key], key);
  instant(value.verifiedAt, "verification time");
  return freeze({ ...value });
}
function assertPhaseJoins(plan, phases, reached) {
  const at = phase => reached >= phaseIndex(phase);
  if (at("successor_bound") && (phases.successor_bound.values.authority.claimId
    !== phases.successor_promoted.values.claimId
    || phases.successor_bound.values.authority.transitionCounter
    !== phases.successor_promoted.values.transitionCounter + 1)) invalid("bound promotion lineage");
  if (at("lease_projected")) { const lease = phases.lease_projected.values;
    if (lease.continuationBinding.bindingDigest !== phases.projection_prepared.values.continuationBinding.bindingDigest
      || digestValue(lease.targetLease.cloudAuthority) !== phases.successor_bound.values.authorityDigest
      || lease.targetLease.heartbeatAt !== phases.projection_prepared.values.projectedAt
      || lease.targetLease.expiresAt !== phases.successor_bound.values.authority.expiresAt) invalid("lease lineage"); }
  if (at("marker_projected") && (phases.marker_projected.values.leaseDigest
    !== phases.lease_projected.values.targetLeaseDigest || phases.marker_projected.values.markerDigest
    !== digestValue(projectWriterLeasePullRequestMarker(phases.lease_projected.values.targetLease)))) invalid("marker lineage");
  if (at("expansion_finalized")) {
    const finalization = phases.expansion_finalized.values;
    const expectedFinal = digestValue({ schema: "agentic-active-dirty-scope-expansion-complete/v1",
      planDigest: plan.evidence.expansion.intent.planDigest,
      mutationAuthorityReceiptDigest: finalization.mutationAuthorityReceiptDigest,
      pullRequestMarkerDigest: phases.marker_projected.values.markerDigest });
    if (finalization.expansionFinalReceiptDigest !== expectedFinal) invalid("final receipt lineage");
  }
  if (at("verified")) { const verified = phases.verified.values;
    if (verified.leaseDigest !== phases.lease_projected.values.targetLeaseDigest
      || verified.authorityDigest !== phases.successor_bound.values.authorityDigest
      || verified.markerDigest !== phases.marker_projected.values.markerDigest
      || verified.expansionIntentDigest !== phases.expansion_finalized.values.expansionIntentDigest) invalid("terminal lineage"); }
}
function normalizeAuthorization(value, plan) {
  exact(value, ["schema", "planDigest", "exactAuthorization", "authorizationDigest"], "authorization receipt");
  const expected = authorizeTaskAuthoritySuccessorProjectionRepair(plan, plan.exactAuthorization);
  if (canonicalJson(value) !== canonicalJson(expected)) invalid("authorization receipt"); return expected;
}
function sealIntent(value) {
  const core = intentCore(value); return normalizeTaskAuthoritySuccessorProjectionRepairIntent({ ...core, intentDigest: digestValue(core) });
}
function intentCore(value) { return { schema: value.schema, planDigest: value.planDigest, planSnapshot: value.planSnapshot,
  authorizationDigest: value.authorizationDigest, operationId: value.operationId, status: value.status, phases: value.phases, receipt: value.receipt }; }
function phaseOperationKey(plan, phase) { return digestValue({ schema: PHASE_RECEIPT_SCHEMA, planDigest: plan.planDigest, phase }); }
function phaseIndex(value) { const index = TASK_AUTHORITY_SUCCESSOR_PROJECTION_REPAIR_PHASES.indexOf(value);
  if (index < 0) invalid("phase"); return index; }
function covered(writeSet, candidate) { return writeSet.some(item => { if (!item.startsWith("path:")) return false;
  const owned = item.slice(5).replace(/\/$/u, ""); return candidate === owned || candidate.startsWith(`${owned}/`); }); }
function difference(left, right) { return left.filter(item => !right.includes(item)); } function paths(value, label, allowEmpty = false) { if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.some(item => typeof item !== "string" || !item
    || path.isAbsolute(item) || item.split("/").includes("..")) || canonicalJson(value) !== canonicalJson([...new Set(value)].sort())) invalid(label); return [...value]; }
function clone(value, label) { object(value, label); const serialized = JSON.stringify(value); if (serialized.length > 1_500_000) invalid(`${label} size`); return freeze(JSON.parse(serialized)); }
function exact(value, keys, label) { object(value, label); if (canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) invalid(label); }
function object(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label); return value; }
function absolute(value, label) { const result = text(value, label); if (!path.isAbsolute(result) || path.normalize(result) !== result) invalid(label); return result; }
function text(value, label) { if (typeof value !== "string" || !value || value.trim() !== value) invalid(label); return value; }
function digest(value, label) { if (!DIGEST.test(String(value || ""))) invalid(label); return value; }
function sha(value, label) { if (!SHA.test(String(value || ""))) invalid(label); return value; }
function integer(value, label, minimum) { if (!Number.isSafeInteger(value) || value < minimum) invalid(label); return value; }
function instant(value, label) { const time = Date.parse(value); if (!Number.isFinite(time) || new Date(time).toISOString() !== value) invalid(label); return value; }
function invalid(label) { throw new Error(`Task-authority successor projection repair ${label} is invalid.`); } function freeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.values(value).forEach(freeze); return Object.freeze(value); }
