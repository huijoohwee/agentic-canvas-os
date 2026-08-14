// Responsibility: Seal exact authorization, replay phases, and the terminal active projection.
import { digestValue, normalizeRootIntent } from "./cloud-collaboration-primitives.mjs";
import { projectWriterLeasePullRequestMarker } from "./writer-lease-lib.mjs";
import { normalizeDeliveryAuthorizedCiFailureRecoveryEvidence as normalizeEvidence }
  from "./delivery-authorized-ci-failure-recovery-evidence.mjs";
export const PLAN_SCHEMA = "agentic-delivery-authorized-ci-failure-recovery-plan/v1";
export const AUTHORIZATION_SCHEMA = "agentic-delivery-authorized-ci-failure-recovery-authorization/v1";
export const INTENT_SCHEMA = "agentic-delivery-authorized-ci-failure-recovery-intent/v1";
export const PHASE_RECEIPT_SCHEMA = "agentic-delivery-authorized-ci-failure-recovery-phase-receipt/v1";
export const COMPLETION_SCHEMA = "agentic-delivery-authorized-ci-failure-recovery-completion/v1";
export const ARCHIVE_SCHEMA = "agentic-delivery-authorized-ci-failure-recovery-archive/v1";
export const MARKER_SCHEMA = "agentic-delivery-authorized-ci-failure-recovery/v1";
export const PHASES = Object.freeze(["prepared", "auto_merge_disabled", "pull_request_drafted",
  "successor_waiting", "predecessor_retired", "successor_active", "successor_bound",
  "projection_candidate", "lease_projected", "markers_projected", "verified", "complete"]);
const SHA = /^[0-9a-f]{40}$/u, DIGEST = /^[0-9a-f]{64}$/u;
const LEASE_KEYS = Object.freeze(["schema", "status", "epoch", "sessionId", "device", "scope",
  "branch", "worktreePath", "baseSha", "fenceSha", "pullRequestUrl", "autoDelivery",
  "runtimeRequired", "admission", "cloudAuthority", "acquiredAt", "heartbeatAt", "expiresAt"]);
const AUTH_REQUIRED = Object.freeze(["schema", "provider", "ledgerRepository", "targetRepository",
  "claimId", "claimDigest", "ledgerRevision", "ledgerDigest", "claimLedgerRevision",
  "entrySchema", "claimIdentitySchema", "operationReceiptDigest", "mutationAuthorityEligible",
  "canonicalBaseSha", "laneRevision", "cloudDeclaredWriteScope", "writeSetDigest", "deviceId",
  "sessionId", "reviewRequestId", "leaseEpoch", "transitionCounter", "state", "expiresAt",
  "integrationReceiptDigest", "integration", "manifestDigest"]);
const AUTH_OPTIONAL = Object.freeze(["focusedEvidenceDigest", "operatorDecisionDigest",
  "integrationIntentDigest"]);
export function buildDeliveryAuthorizedCiFailureRecoveryPlan({ evidence, ttlSeconds = 3600 } = {}) {
  const observed = normalizeEvidence(evidence), lease = observed.lease.record,
    pull = observed.provider.rest, claim = observed.cloud.publicClaim.record,
    successorCloudLeaseEpoch = claim.leaseEpoch + 1,
    expectedSuccessorClaimId = digestValue({ actorId: claim.actorId,
      canonicalBaseRevision: claim.canonicalBaseRevision, leaseEpoch: successorCloudLeaseEpoch,
      repositoryId: claim.repositoryId, workItemId: claim.workItemId,
      writeSetDigest: claim.writeSetDigest }), ttl = integer(ttlSeconds, "TTL", 300, 86400);
  const core = { schema: PLAN_SCHEMA, operation: "delivery-authorized-ci-failure-recovery",
    status: "planned", evidence: observed, evidenceDigest: observed.evidenceDigest,
    sourceClaimId: observed.cloud.publicClaim.record.claimId,
    sourceLeaseDigest: observed.lease.leaseDigest, sourceHeadSha: observed.source.headSha,
    sourceTreeSha: observed.source.treeSha, sourceBaseSha: lease.baseSha,
    pullRequestNumber: pull.number, pullRequestNodeId: pull.nodeId, pullRequestUrl: pull.url,
    successorCloudLeaseEpoch, expectedSuccessorClaimId, ttlSeconds: ttl,
    allowedEffects: ["disable-exact-squash-auto-merge", "draft-same-pull-request",
      "same-owner-successor-claim", "integrated-predecessor-retirement",
      "successor-promotion-and-review-binding", "separate-recovery-marker-projection",
      "literal-writer-lease-registry-cas"],
    forbiddenEffects: ["source-byte-change", "index-change", "commit", "ref-change", "push",
      "ci-rerun", "pull-request-close", "pull-request-create", "merge", "cleanup", "deployment",
      "task-authority-invention"] };
  const planDigest = digestValue(core);
  return freeze({ ...core, planDigest,
    exactAuthorization: `authorize delivery-authorized-ci-failure-recovery ${planDigest}` });
}
export function normalizeDeliveryAuthorizedCiFailureRecoveryPlan(value) {
  if (value?.schema !== PLAN_SCHEMA) invalid("plan schema");
  const result = buildDeliveryAuthorizedCiFailureRecoveryPlan({ evidence: value.evidence,
    ttlSeconds: value.ttlSeconds });
  same(value, result, "plan"); return result;
}
export function authorizeDeliveryAuthorizedCiFailureRecovery({ plan, authorization } = {}) {
  const snapshot = normalizeDeliveryAuthorizedCiFailureRecoveryPlan(plan);
  if (authorization !== snapshot.exactAuthorization) throw new Error(
    `CI-failure recovery requires exact authorization: ${snapshot.exactAuthorization}`);
  const core = { schema: AUTHORIZATION_SCHEMA, planDigest: snapshot.planDigest,
    statement: authorization };
  return freeze({ ...core, authorizationDigest: digestValue(core) });
}
export function createDeliveryAuthorizedCiFailureRecoveryIntent(plan, authorization) {
  const snapshot = normalizeDeliveryAuthorizedCiFailureRecoveryPlan(plan);
  const granted = authorizeDeliveryAuthorizedCiFailureRecovery({ plan: snapshot, authorization });
  const phases = { prepared: phaseReceipt(snapshot, "prepared", null,
    { authorizationDigest: granted.authorizationDigest }, {}) };
  return seal("prepared", snapshot, granted, phases, null);
}
export function advanceDeliveryAuthorizedCiFailureRecoveryIntent(intent, { status, values = {} } = {}) {
  const current = normalizeDeliveryAuthorizedCiFailureRecoveryIntent(intent), next = phase(status),
    from = PHASES.indexOf(current.status), to = PHASES.indexOf(next);
  if (to < from || to > from + 1) invalid("phase order");
  const normalized = normalizePhaseValues(next, values, current.planSnapshot, current.phases);
  if (to === from) {
    if (current.phases[next].valuesDigest !== digestValue(normalized)) invalid("phase replay");
    return current;
  }
  const phases = { ...current.phases,
    [next]: phaseReceipt(current.planSnapshot, next, current.intentDigest, normalized, current.phases) };
  return seal(next, current.planSnapshot, current.authorization, phases,
    next === "complete" ? normalized.completion : null);
}
export function normalizeDeliveryAuthorizedCiFailureRecoveryIntent(value) {
  if (value?.schema !== INTENT_SCHEMA) invalid("intent schema");
  const status = phase(value.status), plan = normalizeDeliveryAuthorizedCiFailureRecoveryPlan(
    value.planSnapshot), authorization = authorizeDeliveryAuthorizedCiFailureRecovery({ plan,
      authorization: value.authorization?.statement });
  const names = PHASES.slice(0, PHASES.indexOf(status) + 1); exact(value.phases, names, "phases");
  let phases = {}, priorIntent = null;
  for (const name of names) {
    const next = phaseReceipt(plan, name, priorIntent, value.phases[name]?.values, phases);
    same(value.phases[name], next, `${name} receipt`); phases = { ...phases, [name]: next };
    priorIntent = seal(name, plan, authorization, phases,
      name === "complete" ? next.values.completion : null).intentDigest;
  }
  const completion = status === "complete" ? phases.complete.values.completion : value.completion === null ? null : invalid("premature completion");
  const result = seal(status, plan, authorization, phases, completion);
  same(value, result, "intent"); return result;
}
export function deliveryAuthorizedCiFailureRecoveryOperationKey(plan, phaseName,
  priorReceiptDigest = null) {
  const snapshot = normalizeDeliveryAuthorizedCiFailureRecoveryPlan(plan), name = phase(phaseName);
  if (priorReceiptDigest !== null) digest(priorReceiptDigest, "prior receipt");
  return `delivery-authorized-ci-failure-recovery:${name}:${digestValue({ schema:
    "agentic-delivery-authorized-ci-failure-recovery-operation/v1", planDigest: snapshot.planDigest,
  phase: name, priorReceiptDigest })}`;
}
export function buildDeliveryAuthorizedCiFailureRecoveryCloudRequest(plan, phaseName, phases = {},
  expectedLedgerDigest = null, expiresAt = null) {
  const snapshot = normalizeDeliveryAuthorizedCiFailureRecoveryPlan(plan), name = phase(phaseName),
    claim = snapshot.evidence.cloud.publicClaim.record, integration = claim.integration,
    ledgerDigest = digest(expectedLedgerDigest, "cloud expected ledger");
  const common = { schema: "agentic-delivery-authorized-ci-failure-cloud-request/v1",
    operation: name, planDigest: snapshot.planDigest, targetRepositoryId:
      `github-repository:${snapshot.evidence.repository.nodeId}`, actorId: claim.actorId,
    deviceId: snapshot.evidence.cloud.privateClaim.record.deviceId,
    sessionId: snapshot.evidence.cloud.privateClaim.record.sessionId,
    expectedLedgerDigest: ledgerDigest,
    idempotencyKey: deliveryAuthorizedCiFailureRecoveryOperationKey(snapshot, name,
      PHASES.indexOf(name) > 0 ? phases[PHASES[PHASES.indexOf(name) - 1]]?.receiptDigest || null : null) };
  if (name === "successor_waiting") return freeze({ ...common, branch:
    snapshot.evidence.source.branch, workItemId: claim.workItemId,
    canonicalBaseRevision: snapshot.sourceBaseSha, laneRevision: snapshot.sourceHeadSha,
    declaredWriteScope: claim.declaredWriteScope, leaseEpoch: snapshot.successorCloudLeaseEpoch,
    predecessorClaimId: snapshot.sourceClaimId, expiresAt: instant(expiresAt,
      "successor claim expiry") });
  if (name === "predecessor_retired") return freeze({ ...common, claimId: snapshot.sourceClaimId,
    expectedFenceRevision: claim.fenceRevision, expectedTransitionCounter: claim.transitionCounter,
    reason: "integrated", finalRevision: snapshot.sourceHeadSha,
    reviewRequestId: claim.reviewRequestId, integrationReceiptDigest:
      claim.integrationReceiptDigest, namedChecksDigest: integration.namedChecksDigest,
    handoffEvidenceDigest: integration.handoffEvidenceDigest, bytesDigest: digestValue({ schema:
      "agentic-delivery-authorized-ci-failure-integrated-bytes/v1", planDigest: snapshot.planDigest,
      commitSha: snapshot.sourceHeadSha, treeSha: snapshot.sourceTreeSha,
      sourceIntegrationDigest: digestValue(snapshot.evidence.lease.record.integration) }) });
  const source = name === "successor_active" ? phases.successor_waiting?.values : name === "successor_bound" ? phases.successor_active?.values : null;
  if (!source) invalid("cloud request predecessor");
  return freeze({ ...common, claimId: snapshot.expectedSuccessorClaimId,
    expectedFenceRevision: source.claimDigest, expectedTransitionCounter: source.transitionCounter,
    expectedTransitionDigest: source.claimLedgerRevision,
    mode: name === "successor_active" ? "promote" : "projection",
    laneRevision: snapshot.sourceHeadSha,
    reviewRequestId: name === "successor_bound" ? `github-pull-request:${snapshot.pullRequestNodeId}` : null,
    expiresAt: name === "successor_active" ? instant(expiresAt, "successor promotion expiry") : null });
}
export function projectDeliveryAuthorizedCiFailureTerminalLease({ plan, sourceLease,
  successorAuthority, localEpoch, projectedAt } = {}) {
  const snapshot = normalizeDeliveryAuthorizedCiFailureRecoveryPlan(plan);
  if (digestValue(sourceLease) !== snapshot.sourceLeaseDigest || Object.hasOwn(sourceLease || {}, "taskAuthority")) invalid("legacy source lease");
  const authority = normalizeSuccessor(successorAuthority, snapshot), at = instant(projectedAt,
    "projection time"), epoch = integer(localEpoch, "terminal epoch");
  if (epoch <= snapshot.evidence.lease.record.epoch || Date.parse(authority.expiresAt) <= Date.parse(at)) invalid("terminal timing");
  return normalizeDeliveryAuthorizedCiFailureTerminalLease({ schema: "agentic-writer-lease/v2",
    status: "active", epoch, sessionId: sourceLease.sessionId, device: sourceLease.device,
    scope: sourceLease.scope, branch: sourceLease.branch, worktreePath: sourceLease.worktreePath,
    baseSha: snapshot.sourceBaseSha, fenceSha: snapshot.sourceHeadSha,
    pullRequestUrl: snapshot.pullRequestUrl, autoDelivery: true, runtimeRequired: true,
    admission: sourceLease.admission, cloudAuthority: authority, acquiredAt: at, heartbeatAt: at,
    expiresAt: authority.expiresAt }, snapshot);
}
export function normalizeDeliveryAuthorizedCiFailureTerminalLease(value, plan) {
  const snapshot = normalizeDeliveryAuthorizedCiFailureRecoveryPlan(plan); exact(value, LEASE_KEYS,
    "terminal lease");
  const result = freeze({ schema: value.schema === "agentic-writer-lease/v2" ? value.schema : invalid("lease schema"), status: value.status === "active" ? value.status : invalid("lease status"), epoch: integer(value.epoch, "lease epoch"),
    sessionId: text(value.sessionId, "lease session"), device: text(value.device, "lease device"),
    scope: text(value.scope, "lease scope"), branch: text(value.branch, "lease branch"),
    worktreePath: text(value.worktreePath, "lease worktree"), baseSha: sha(value.baseSha,
      "lease base"), fenceSha: sha(value.fenceSha, "lease fence"), pullRequestUrl:
      text(value.pullRequestUrl, "lease PR"), autoDelivery: value.autoDelivery === true ? true : invalid("lease auto delivery"), runtimeRequired: value.runtimeRequired === true ? true : invalid("lease runtime"), admission: object(value.admission, "lease admission"),
    cloudAuthority: normalizeSuccessor(value.cloudAuthority, snapshot),
    acquiredAt: instant(value.acquiredAt, "lease acquired"), heartbeatAt: instant(value.heartbeatAt,
      "lease heartbeat"), expiresAt: instant(value.expiresAt, "lease expiry") });
  const source = snapshot.evidence.lease.record;
  if (result.epoch <= source.epoch || result.sessionId !== source.sessionId || result.device !== source.device || result.scope !== source.scope || result.branch !== source.branch || result.worktreePath !== source.worktreePath || result.baseSha !== source.baseSha || result.fenceSha !== snapshot.sourceHeadSha || result.pullRequestUrl !== source.pullRequestUrl || result.acquiredAt !== result.heartbeatAt || Date.parse(result.acquiredAt) <= Math.max(Date.parse(source.acquiredAt),
      Date.parse(source.heartbeatAt)) || result.expiresAt !== result.cloudAuthority.expiresAt
    || Date.parse(result.expiresAt) <= Date.parse(result.acquiredAt)
    || digestValue(result.admission) !== digestValue(source.admission)) invalid("terminal lease join");
  return result;
}
export function createDeliveryAuthorizedCiFailureRecoveryMarker({ plan, intent, terminalLease } = {}) {
  const snapshot = normalizeDeliveryAuthorizedCiFailureRecoveryPlan(plan);
  const journal = normalizeDeliveryAuthorizedCiFailureRecoveryIntent(intent);
  const lease = normalizeDeliveryAuthorizedCiFailureTerminalLease(terminalLease, snapshot);
  return markerFromPhases(snapshot, journal.phases, lease);
}
function markerFromPhases(snapshot, phases, lease) {
  const retired = phases.predecessor_retired?.values, bound = phases.successor_bound?.values;
  if (!retired || !bound || digestValue(lease.cloudAuthority) !== bound.authorityDigest) invalid("marker authority");
  const core = { schema: MARKER_SCHEMA, status: "active", planDigest: snapshot.planDigest,
    evidenceDigest: snapshot.evidenceDigest, sourceClaimId: snapshot.sourceClaimId,
    successorClaimId: bound.successorClaimId, sourceHeadSha: snapshot.sourceHeadSha,
    failureCheckRunId: snapshot.evidence.provider.failure.check.id,
    sourceRetirementReceiptDigest: retired.operationReceiptDigest,
    successorAuthorityDigest: bound.authorityDigest, terminalLeaseDigest: digestValue(lease),
    projectedAt: lease.acquiredAt };
  return freeze({ ...core, markerDigest: digestValue(core) });
}
export function normalizeDeliveryAuthorizedCiFailureRecoveryMarker(value) {
  const core = { schema: value?.schema === MARKER_SCHEMA ? value.schema : invalid("marker schema"),
    status: value?.status === "active" ? value.status : invalid("marker status"),
    planDigest: digest(value?.planDigest, "marker plan"), evidenceDigest: digest(value?.evidenceDigest,
      "marker evidence"), sourceClaimId: digest(value?.sourceClaimId, "marker source"),
    successorClaimId: digest(value?.successorClaimId, "marker successor"),
    sourceHeadSha: sha(value?.sourceHeadSha, "marker head"), failureCheckRunId:
      integer(value?.failureCheckRunId, "marker check"), sourceRetirementReceiptDigest:
      digest(value?.sourceRetirementReceiptDigest, "marker retirement"), successorAuthorityDigest:
      digest(value?.successorAuthorityDigest, "marker authority"), terminalLeaseDigest:
      digest(value?.terminalLeaseDigest, "marker lease"), projectedAt: instant(value?.projectedAt,
      "marker time") };
  exact(value, [...Object.keys(core), "markerDigest"], "marker");
  if (value.markerDigest !== digestValue(core)) invalid("marker digest");
  return freeze({ ...core, markerDigest: value.markerDigest });
}
export function upsertDeliveryAuthorizedCiFailureRecoveryMarker(body, marker) {
  const value = normalizeDeliveryAuthorizedCiFailureRecoveryMarker(marker),
    source = String(body || "").trimEnd(), rendered = `<!-- ${MARKER_SCHEMA} ${JSON.stringify(value)} -->`,
    pattern = new RegExp(`<!--\\s*${escapeRegExp(MARKER_SCHEMA)}\\s+\\{.*?\\}\\s*-->`, "su");
  return pattern.test(source) ? source.replace(pattern, rendered) : `${source}\n\n${rendered}`.trim();
}
export function parseDeliveryAuthorizedCiFailureRecoveryMarker(body) {
  const pattern = new RegExp(`<!--\\s*${escapeRegExp(MARKER_SCHEMA)}\\s+(\\{.*?\\})\\s*-->`, "gsu"),
    matches = [...String(body || "").matchAll(pattern)];
  if (matches.length === 0) return null; if (matches.length !== 1) invalid("marker cardinality");
  return normalizeDeliveryAuthorizedCiFailureRecoveryMarker(JSON.parse(matches[0][1]));
}
export function buildDeliveryAuthorizedCiFailureRecoveryCompletion(plan, verified) {
  const snapshot = normalizeDeliveryAuthorizedCiFailureRecoveryPlan(plan),
    values = normalizeVerified(verified, snapshot, {}), core = { schema: COMPLETION_SCHEMA,
      status: "authoring-restored", planDigest: snapshot.planDigest,
      evidenceDigest: snapshot.evidenceDigest, sourceClaimId: snapshot.sourceClaimId,
      successorClaimId: values.successorClaimId, successorClaimDigest: values.successorClaimDigest,
      sourceHeadSha: snapshot.sourceHeadSha, leaseDigest: values.leaseDigest,
      pullRequestDigest: values.pullRequestDigest, writerMarkerDigest: values.writerMarkerDigest,
      recoveryMarkerDigest: values.recoveryMarkerDigest,
      sourceInvariantDigest: values.sourceInvariantDigest,
      verificationDigest: values.verificationDigest,
      disposition: "same-pull-request-authoring-restored-task-authority-unbound" };
  return freeze({ ...core, receiptDigest: digestValue(core) });
}
export function normalizeDeliveryAuthorizedCiFailureRecoveryCompletion(value, plan, verified) {
  const result = buildDeliveryAuthorizedCiFailureRecoveryCompletion(plan, verified);
  same(value, result, "completion"); return result;
}
export function buildDeliveryAuthorizedCiFailureRecoveryArchive({ intent, archivedAt } = {}) {
  const terminalIntent = normalizeDeliveryAuthorizedCiFailureRecoveryIntent(intent);
  if (terminalIntent.status !== "complete") invalid("archive intent");
  const core = { schema: ARCHIVE_SCHEMA, status: "complete", terminalIntent,
    terminalIntentDigest: terminalIntent.intentDigest, completion: terminalIntent.completion,
    archivedAt: instant(archivedAt, "archive time") };
  return freeze({ ...core, archiveDigest: digestValue(core) });
}
export function normalizeDeliveryAuthorizedCiFailureRecoveryArchive(value) {
  if (value?.schema !== ARCHIVE_SCHEMA) invalid("archive schema");
  const result = buildDeliveryAuthorizedCiFailureRecoveryArchive({ intent: value.terminalIntent,
    archivedAt: value.archivedAt }); same(value, result, "archive"); return result;
}
function phaseReceipt(plan, name, priorIntentDigest, raw, priorPhases) {
  const values = normalizePhaseValues(name, raw, plan, priorPhases), index = PHASES.indexOf(name),
    priorReceiptDigest = index === 0 ? null : priorPhases[PHASES[index - 1]]?.receiptDigest || null,
    core = { schema: PHASE_RECEIPT_SCHEMA, phase: phase(name), planDigest: plan.planDigest,
      operationKey: deliveryAuthorizedCiFailureRecoveryOperationKey(plan, name, priorReceiptDigest),
      priorIntentDigest, priorReceiptDigest, values, valuesDigest: digestValue(values) };
  return freeze({ ...core, receiptDigest: digestValue(core) });
}
function normalizePhaseValues(name, raw, plan, prior) {
  const value = object(raw, `${name} values`);
  if (name === "prepared") return digestFields(value, ["authorizationDigest"], name);
  if (["auto_merge_disabled", "pull_request_drafted"].includes(name)) {
    exact(value, ["providerRequestDigest", "providerBeforeDigest", "providerAfter",
      "providerAfterDigest", "providerReceipt", "providerReceiptDigest"], name);
    const before = name === "auto_merge_disabled" ? digestValue(plan.evidence.provider.rest) : prior.auto_merge_disabled.values.providerAfterDigest,
      after = normalizeProviderState(value.providerAfter, plan,
        name === "pull_request_drafted"), request = digestValue({ schema:
        "agentic-delivery-authorized-ci-failure-provider-request/v1", operation: name,
        planDigest: plan.planDigest, pullRequestNodeId: plan.pullRequestNodeId,
        expectedHeadSha: plan.sourceHeadSha, providerBeforeDigest: before });
    const providerReceipt = normalizeProviderReceipt(value.providerReceipt, plan, name, request,
      digestValue(after));
    if (digest(value.providerRequestDigest, `${name} request`) !== request || digest(value.providerBeforeDigest, `${name} before`) !== before || digest(value.providerAfterDigest, `${name} after`) !== digestValue(after) || digest(value.providerReceiptDigest, `${name} receipt`) !== digestValue(providerReceipt)) {
      invalid("provider phase");
    }
    return freeze({ ...value, providerAfter: after, providerReceipt });
  }
  if (["successor_waiting", "predecessor_retired", "successor_active"].includes(name)) {
    return normalizeCloudPhase(value, name, plan, prior);
  }
  if (name === "successor_bound") return normalizeBoundPhase(value, plan, prior);
  if (name === "projection_candidate") {
    const result = digestFields(value, ["successorAuthorityDigest", "sourceLeaseDigest",
      "providerBodyBeforeDigest", "markerTemplateDigest"], name),
      bound = prior.successor_bound.values;
    const expected = digestValue({ schema:
      "agentic-delivery-authorized-ci-failure-marker-template/v1", planDigest: plan.planDigest,
      sourceClaimId: plan.sourceClaimId, successorClaimId: bound.successorClaimId,
      successorAuthorityDigest: bound.authorityDigest, sourceHeadSha: plan.sourceHeadSha,
      failureCheckRunId: plan.evidence.provider.failure.check.id,
      sourceRetirementReceiptDigest: prior.predecessor_retired.values.operationReceiptDigest });
    if (result.successorAuthorityDigest !== bound.authorityDigest || result.sourceLeaseDigest !== plan.sourceLeaseDigest || result.providerBodyBeforeDigest !== plan.evidence.provider.rest.bodyDigest || result.markerTemplateDigest !== expected) invalid(name);
    return result;
  }
  if (name === "lease_projected") {
    exact(value, ["terminalLease", "leaseDigest", "registryReceipt"], name);
    const lease = normalizeDeliveryAuthorizedCiFailureTerminalLease(value.terminalLease, plan),
      registryReceipt = normalizeRegistryReceipt(value.registryReceipt, plan, lease);
    if (digest(value.leaseDigest, "projected lease") !== digestValue(lease)) invalid(name);
    return freeze({ ...value, terminalLease: lease, registryReceipt });
  }
  if (name === "markers_projected") {
    exact(value, ["providerRequestDigest", "providerBeforeDigest", "providerAfter",
      "providerAfterDigest", "writerMarker", "writerMarkerDigest", "recoveryMarker",
      "recoveryMarkerDigest", "providerReceipt", "providerReceiptDigest"], name);
    const lease = prior.lease_projected.values.terminalLease,
      writerMarker = projectWriterLeasePullRequestMarker(lease),
      recoveryMarker = markerFromPhases(plan, prior, lease),
      bodyProjectionDigest = digestValue({ schema:
        "agentic-delivery-authorized-ci-failure-body-projection/v1",
        humanBodyDigest: plan.evidence.provider.rest.bodyDigest,
        writerMarkerDigest: digestValue(writerMarker), recoveryMarkerDigest: recoveryMarker.markerDigest }),
      after = normalizeMarkerProviderState(value.providerAfter, plan,
        bodyProjectionDigest, digestValue(writerMarker), recoveryMarker.markerDigest), request = digestValue({ schema:
        "agentic-delivery-authorized-ci-failure-marker-request/v1", planDigest: plan.planDigest,
        pullRequestNodeId: plan.pullRequestNodeId, expectedHeadSha: plan.sourceHeadSha,
        providerBeforeDigest: prior.pull_request_drafted.values.providerAfterDigest,
        terminalLeaseDigest: prior.lease_projected.values.leaseDigest,
        bodyProjectionDigest, writerMarkerDigest: digestValue(writerMarker),
        recoveryMarkerDigest: recoveryMarker.markerDigest });
    const providerReceipt = normalizeProviderReceipt(value.providerReceipt, plan, name, request,
      digestValue(after));
    if (digest(value.providerRequestDigest, "marker request") !== request || digest(value.providerBeforeDigest, "marker before")
        !== prior.pull_request_drafted.values.providerAfterDigest || digest(value.providerAfterDigest, "marker after") !== digestValue(after) || digest(value.writerMarkerDigest, "writer marker") !== digestValue(writerMarker) || digest(value.recoveryMarkerDigest, "recovery marker") !== recoveryMarker.markerDigest || digest(value.providerReceiptDigest, "marker receipt") !== digestValue(providerReceipt)) invalid(name);
    same(value.writerMarker, writerMarker, "writer marker");
    same(value.recoveryMarker, recoveryMarker, "recovery marker");
    return freeze({ ...value, providerAfter: after, writerMarker, recoveryMarker, providerReceipt });
  }
  if (name === "verified") return normalizeVerified(value, plan, prior);
  if (name === "complete") { exact(value, ["completion"], name);
    return freeze({ completion: normalizeDeliveryAuthorizedCiFailureRecoveryCompletion(
      value.completion, plan, prior.verified.values) }); }
  invalid("phase values");
}
function normalizeProviderState(value, plan, draft) {
  const keys = ["number", "nodeId", "url", "state", "isDraft", "merged", "title",
    "bodyDigest", "writerMarkerDigest", "headBranch", "headSha", "baseBranch", "baseSha",
    "authorDigest", "headRepositoryDigest", "baseRepositoryDigest", "isInMergeQueue",
    "mergeQueueEntry", "autoMergeRequest"];
  exact(value, keys, "provider state"); const source = plan.evidence.provider.rest;
  const result = { number: integer(value.number, "provider PR"), nodeId: text(value.nodeId,
    "provider node"), url: text(value.url, "provider URL"), state: value.state === "OPEN" ? "OPEN" : invalid("provider state"), isDraft: value.isDraft === draft ? draft : invalid("provider draft"),
    merged: value.merged === false ? false : invalid("provider merged"), title: text(value.title,
      "provider title"), bodyDigest: digest(value.bodyDigest, "provider body"), writerMarkerDigest:
      digest(value.writerMarkerDigest, "provider writer marker"), headBranch: text(value.headBranch,
      "provider branch"), headSha: sha(value.headSha, "provider head"), baseBranch:
      value.baseBranch === "main" ? "main" : invalid("provider base branch"), baseSha:
      sha(value.baseSha, "provider base"), authorDigest: digest(value.authorDigest,
      "provider author"), headRepositoryDigest: digest(value.headRepositoryDigest,
      "provider head repository"), baseRepositoryDigest: digest(value.baseRepositoryDigest,
      "provider base repository"), isInMergeQueue: value.isInMergeQueue === false ? false : invalid("provider queue"), mergeQueueEntry: value.mergeQueueEntry === null ? null : invalid("provider queue entry"), autoMergeRequest: value.autoMergeRequest === null ? null : invalid("provider auto merge") };
  for (const key of ["number", "nodeId", "url", "title", "bodyDigest", "writerMarkerDigest",
    "headBranch", "headSha", "baseBranch", "baseSha"]) if (result[key] !== source[key]) {
    invalid("provider source join");
  }
  if (result.authorDigest !== digestValue(source.author) || result.headRepositoryDigest !== digestValue(source.headRepository) || result.baseRepositoryDigest !== digestValue(source.baseRepository)) invalid("provider identity");
  return freeze(result);
}
function normalizeMarkerProviderState(value, plan, expectedBodyDigest, writerMarkerDigest,
  recoveryMarkerDigest) {
  const keys = ["number", "nodeId", "url", "state", "isDraft", "merged", "title", "bodyDigest",
    "writerMarkerDigest", "recoveryMarkerDigest", "headBranch", "headSha", "baseBranch",
    "baseSha", "authorDigest", "headRepositoryDigest", "baseRepositoryDigest", "isInMergeQueue",
    "mergeQueueEntry", "autoMergeRequest"];
  exact(value, keys, "marker provider state");
  const { recoveryMarkerDigest: ignored, ...provider } = value, source = plan.evidence.provider.rest,
    bodyDigest = digest(provider.bodyDigest, "provider marker body"),
    projectedWriterDigest = digest(provider.writerMarkerDigest, "provider writer marker"),
    base = normalizeProviderState({ ...provider, bodyDigest: source.bodyDigest,
      writerMarkerDigest: source.writerMarkerDigest }, plan, true);
  if (value.writerMarkerDigest !== writerMarkerDigest || bodyDigest !== expectedBodyDigest || digest(value.recoveryMarkerDigest, "provider recovery marker") !== recoveryMarkerDigest) {
    invalid("marker provider join");
  }
  return freeze({ ...base, bodyDigest, writerMarkerDigest: projectedWriterDigest,
    recoveryMarkerDigest });
}
function normalizeProviderReceipt(value, plan, operation, requestDigest, afterDigest) {
  const core = { schema: value?.schema === "agentic-delivery-authorized-ci-failure-provider-receipt/v1" ? value.schema : invalid("provider receipt schema"), operation: value?.operation === operation ? operation : invalid("provider receipt operation"), clientMutationId:
      digest(value?.clientMutationId, "provider mutation ID"), actorId:
      integer(value?.actorId, "provider actor"), actorLogin: text(value?.actorLogin,
      "provider login"), pullRequestNodeId: text(value?.pullRequestNodeId, "provider PR node"),
    headSha: sha(value?.headSha, "provider receipt head"), afterDigest:
      digest(value?.afterDigest, "provider receipt after") };
  exact(value, Object.keys(core), "provider receipt");
  if (core.clientMutationId !== requestDigest || core.actorId !== plan.evidence.actor.id || core.actorLogin !== plan.evidence.actor.login || core.pullRequestNodeId !== plan.pullRequestNodeId || core.headSha !== plan.sourceHeadSha || core.afterDigest !== afterDigest) invalid("provider receipt join");
  return freeze(core);
}
function normalizeRegistryReceipt(value, plan, lease) {
  const core = { schema: value?.schema === "agentic-delivery-authorized-ci-failure-registry-receipt/v1" ? value.schema : invalid("registry receipt schema"), branch: text(value?.branch,
      "registry branch"), beforeRevision: integer(value?.beforeRevision, "registry before revision"),
    afterRevision: integer(value?.afterRevision, "registry after revision"), beforeDigest:
      digest(value?.beforeDigest, "registry before"), afterDigest: digest(value?.afterDigest,
      "registry after"), maximumPriorEpoch: integer(value?.maximumPriorEpoch, "registry max epoch"),
    selectedEpoch: integer(value?.selectedEpoch, "registry selected epoch"), sourceLeaseDigest:
      digest(value?.sourceLeaseDigest, "registry source lease"), terminalLeaseDigest:
      digest(value?.terminalLeaseDigest, "registry terminal lease"), registryBefore:
      object(value?.registryBefore, "registry before projection"), registryAfter:
      object(value?.registryAfter, "registry after projection"), mutationId:
      digest(value?.mutationId, "registry mutation") };
  exact(value, [...Object.keys(core), "receiptDigest"], "registry receipt");
  const mutationId = digestValue({ schema: "agentic-delivery-authorized-ci-failure-lease-cas/v1",
    planDigest: plan.planDigest, branch: plan.evidence.source.branch,
    sourceLeaseDigest: plan.sourceLeaseDigest, beforeRevision: core.beforeRevision,
    beforeDigest: core.beforeDigest, terminalLeaseDigest: digestValue(lease) }),
    expectedAfter = { ...core.registryBefore, revision: core.beforeRevision + 1,
      leases: { ...core.registryBefore.leases, [core.branch]: lease } };
  if (core.branch !== plan.evidence.source.branch || core.afterRevision !== core.beforeRevision + 1 || core.selectedEpoch !== core.maximumPriorEpoch + 1 || lease.epoch !== core.selectedEpoch || core.sourceLeaseDigest !== plan.sourceLeaseDigest || core.terminalLeaseDigest !== digestValue(lease) || core.mutationId !== mutationId || core.beforeDigest !== digestValue(core.registryBefore) || core.afterDigest !== digestValue(core.registryAfter) || JSON.stringify(core.registryAfter) !== JSON.stringify(expectedAfter) || core.registryBefore.revision !== core.beforeRevision || core.registryAfter.revision !== core.afterRevision || digestValue(core.registryBefore.leases?.[core.branch]) !== plan.sourceLeaseDigest || digestValue(core.registryAfter.leases?.[core.branch]) !== digestValue(lease) || core.maximumPriorEpoch !== Math.max(...Object.values(core.registryBefore.leases || {})
      .map(item => item?.epoch).filter(Number.isSafeInteger)) || digest(value.receiptDigest, "registry receipt digest") !== digestValue(core)) invalid("registry receipt join");
  return freeze({ ...core, receiptDigest: value.receiptDigest });
}
function normalizeCloudPhase(value, name, plan, prior) {
  const keys = ["cloudRequestDigest", "operationReceiptDigest", "claimId", "claimDigest",
    "claimLedgerRevision", "transitionCounter", "state", "ledgerRevision", "ledgerDigest",
    "cloudRequest", "operationReceipt"];
  exact(value, keys, name);
  const expectedClaim = name === "predecessor_retired" ? plan.sourceClaimId : name === "successor_active" ? prior.successor_waiting.values.claimId : plan.expectedSuccessorClaimId,
    expectedState = { successor_waiting: "waiting-successor", predecessor_retired: "retired",
      successor_active: "active" }[name];
  const request = buildDeliveryAuthorizedCiFailureRecoveryCloudRequest(plan, name, prior,
    value.cloudRequest?.expectedLedgerDigest, value.cloudRequest?.expiresAt);
  same(value.cloudRequest, request, `${name} cloud request`);
  const action = name === "successor_waiting" ? "claim" : name === "predecessor_retired" ? "retire" : "continue",
    intent = normalizeRootIntent(action, request, { actorId: request.actorId,
      deviceId: request.deviceId, sessionId: request.sessionId }, request.targetRepositoryId),
    receipt = normalizeCloudReceipt(value.operationReceipt, action, intent, request, value,
      { "waiting-successor": "waiting-successor", retired: "retired", active: "current" }[
        expectedState]);
  if (["successor_waiting", "successor_active"].includes(name)
    && Date.parse(request.expiresAt) !== Date.parse(receipt.evaluationTime) + plan.ttlSeconds * 1000) {
    invalid(`${name} expiry`);
  }
  if (digest(value.cloudRequestDigest, `${name} request`) !== digestValue(request) || digest(value.operationReceiptDigest, `${name} receipt`) !== receipt.receiptDigest) invalid(name);
  digest(value.claimDigest, `${name} claim digest`);
  if (digest(value.claimId, `${name} claim`) !== expectedClaim || !digest(value.claimLedgerRevision, `${name} transition digest`) || integer(value.transitionCounter, `${name} transition`) < 1 || value.state !== expectedState || !sha(value.ledgerRevision, `${name} ledger`) || digest(value.ledgerDigest,
      `${name} ledger digest`) !== value.claimLedgerRevision) invalid(name);
  if (name === "successor_active" && value.transitionCounter <= prior.successor_waiting.values.transitionCounter) invalid(name);
  if ((name === "successor_waiting" && value.transitionCounter !== 1) || (name === "predecessor_retired" && value.transitionCounter
      !== plan.evidence.cloud.publicClaim.record.transitionCounter + 1) || (name === "successor_active" && value.transitionCounter
      !== prior.successor_waiting.values.transitionCounter + 1)) invalid(`${name} counter`);
  return freeze({ ...value, cloudRequest: request, operationReceipt: receipt });
}
function normalizeBoundPhase(value, plan, prior) {
  exact(value, ["cloudRequestDigest", "operationReceiptDigest", "successorClaimId",
    "successorClaimDigest", "claimLedgerRevision", "transitionCounter", "ledgerRevision",
    "ledgerDigest", "cloudRequest", "operationReceipt", "authority",
    "authorityDigest"], "successor_bound");
  const authority = normalizeSuccessor(value.authority, plan), active = prior.successor_active.values;
  const request = buildDeliveryAuthorizedCiFailureRecoveryCloudRequest(plan, "successor_bound",
    prior, value.cloudRequest?.expectedLedgerDigest, value.cloudRequest?.expiresAt), intent = normalizeRootIntent("continue", request,
      { actorId: request.actorId, deviceId: request.deviceId, sessionId: request.sessionId },
      request.targetRepositoryId), receipt = normalizeCloudReceipt(value.operationReceipt,
      "continue", intent, request, { ...value, claimId: value.successorClaimId,
        claimDigest: value.successorClaimDigest }, "current");
  same(value.cloudRequest, request, "bind cloud request");
  if (digest(value.cloudRequestDigest, "bind request") !== digestValue(request) || digest(value.operationReceiptDigest, "bind receipt") !== authority.operationReceiptDigest || receipt.receiptDigest !== authority.operationReceiptDigest || digest(value.successorClaimId, "bound claim") !== active.claimId || digest(value.successorClaimDigest, "bound digest") !== authority.claimDigest || digest(value.claimLedgerRevision, "bound transition digest") !== authority.claimLedgerRevision || integer(value.transitionCounter, "bound transition") !== authority.transitionCounter || authority.transitionCounter <= active.transitionCounter || authority.claimDigest === active.claimDigest || authority.claimLedgerRevision === active.claimLedgerRevision || sha(value.ledgerRevision, "bound ledger") !== authority.ledgerRevision || digest(value.ledgerDigest, "bound ledger digest") !== authority.ledgerDigest || value.ledgerDigest !== value.claimLedgerRevision || digest(value.authorityDigest, "bound authority") !== digestValue(authority)) invalid("bound");
  return freeze({ ...value, cloudRequest: request, operationReceipt: receipt, authority });
}
function normalizeCloudReceipt(value, action, intent, request, result, expectedStatus) {
  const core = { schema: value?.schema === {
    claim: "agentic-collaboration-claim-receipt/v1", continue:
      "agentic-collaboration-continuation-receipt/v1", retire:
      "agentic-collaboration-retirement-receipt/v1" }[action] ? value.schema : invalid("cloud receipt schema"), operation: value?.operation === action ? action : invalid("cloud receipt operation"), status: text(value?.status, "cloud receipt status"),
    repositoryId: text(value?.repositoryId, "cloud receipt repository"), claimId:
      digest(value?.claimId, "cloud receipt claim"), claimDigest: digest(value?.claimDigest,
      "cloud receipt claim digest"), fenceRevision: digest(value?.fenceRevision,
      "cloud receipt fence"), ledgerRevision: digest(value?.ledgerRevision, "cloud receipt ledger"),
    ledgerSequence: integer(value?.ledgerSequence, "cloud receipt sequence"), idempotencyKey:
      text(value?.idempotencyKey, "cloud receipt idempotency"), requestDigest:
      digest(value?.requestDigest, "cloud receipt request"), evaluationTime:
      instant(value?.evaluationTime, "cloud receipt time") };
  exact(value, [...Object.keys(core), "receiptDigest"], "cloud receipt");
  const { expectedLedgerDigest: ignored, ...semanticIntent } = intent;
  if (core.status !== expectedStatus || core.repositoryId !== intent.repositoryId || core.claimId !== result.claimId || core.claimDigest !== result.claimDigest || core.fenceRevision !== result.claimDigest || core.ledgerRevision !== result.claimLedgerRevision || core.ledgerRevision !== result.ledgerDigest || core.idempotencyKey !== digestValue(request.idempotencyKey) || core.requestDigest !== digestValue({ action, intent: semanticIntent }) || digest(value.receiptDigest, "cloud receipt digest") !== digestValue(core)) invalid("cloud receipt join");
  return freeze({ ...core, receiptDigest: value.receiptDigest });
}
function normalizeVerified(value, _plan, prior) {
  exact(value, ["successorClaimId", "successorClaimDigest", "leaseDigest",
    "pullRequestDigest", "writerMarkerDigest", "recoveryMarkerDigest", "sourceInvariantDigest",
    "source", "verificationDigest"], "verified");
  const result = { ...value, successorClaimId: digest(value.successorClaimId, "verified claim"),
    successorClaimDigest: digest(value.successorClaimDigest, "verified claim digest"),
    leaseDigest: digest(value.leaseDigest, "verified lease"), pullRequestDigest:
      digest(value.pullRequestDigest, "verified PR"), writerMarkerDigest:
      digest(value.writerMarkerDigest, "verified writer marker"), recoveryMarkerDigest:
      digest(value.recoveryMarkerDigest, "verified recovery marker"), sourceInvariantDigest:
      digest(value.sourceInvariantDigest, "verified source"), source: object(value.source,
      "verified source"), verificationDigest: digest(value.verificationDigest, "verification") };
  const { verificationDigest: ignored, ...verificationCore } = result;
  if (JSON.stringify(result.source) !== JSON.stringify(_plan.evidence.source) || result.sourceInvariantDigest !== digestValue(result.source) || result.verificationDigest !== digestValue({ schema:
      "agentic-delivery-authorized-ci-failure-terminal-verification/v1",
      planDigest: _plan.planDigest, ...verificationCore })) invalid("source invariant");
  const bound = prior.successor_bound?.values,
    markers = prior.markers_projected?.values, lease = prior.lease_projected?.values;
  if (bound && (result.successorClaimId !== bound.successorClaimId || result.successorClaimDigest !== bound.successorClaimDigest || result.leaseDigest !== lease.leaseDigest || result.pullRequestDigest !== markers.providerAfterDigest || result.writerMarkerDigest !== markers.writerMarkerDigest || result.recoveryMarkerDigest !== markers.recoveryMarkerDigest)) invalid("verified chain");
  return freeze(result);
}
function normalizeSuccessor(value, plan) {
  const raw = object(value, "successor authority"), keys = Object.keys(raw);
  if (AUTH_REQUIRED.some(key => !keys.includes(key)) || keys.some(key => !AUTH_REQUIRED.includes(key) && !AUTH_OPTIONAL.includes(key))) {
    invalid("successor authority keys");
  }
  AUTH_OPTIONAL.filter(key => Object.hasOwn(raw, key)).forEach(key => digest(raw[key], key));
  if (raw.integration !== null || raw.integrationReceiptDigest !== null) invalid("successor integration");
  const normalized = { ...raw, schema: raw.schema === "agentic-lane-cloud-authority/v1" ? raw.schema : invalid("authority schema"), provider: raw.provider === "github" ? raw.provider : invalid("authority provider"), ledgerRepository: text(raw.ledgerRepository,
      "ledger repository"), targetRepository: text(raw.targetRepository, "target repository"),
    claimId: digest(raw.claimId, "authority claim"), claimDigest: digest(raw.claimDigest,
      "authority claim digest"), ledgerRevision: sha(raw.ledgerRevision, "authority ledger"),
    ledgerDigest: digest(raw.ledgerDigest, "authority ledger digest"), claimLedgerRevision:
      digest(raw.claimLedgerRevision, "authority transition"), entrySchema:
      raw.entrySchema === "agentic-cloud-collaboration-entry/v2" ? raw.entrySchema : invalid("authority entry schema"), claimIdentitySchema:
      raw.claimIdentitySchema === "agentic-cloud-collaboration-entry/v2" ? raw.claimIdentitySchema : invalid("authority identity schema"), operationReceiptDigest:
      digest(raw.operationReceiptDigest, "authority receipt"), mutationAuthorityEligible:
      raw.mutationAuthorityEligible === true ? true : invalid("authority mutation"),
    canonicalBaseSha: sha(raw.canonicalBaseSha, "authority base"), laneRevision: sha(raw.laneRevision,
      "authority lane"), cloudDeclaredWriteScope: sortedStrings(raw.cloudDeclaredWriteScope,
      "authority scope"), writeSetDigest: digest(raw.writeSetDigest, "authority write set"),
    deviceId: text(raw.deviceId, "authority device"), sessionId: text(raw.sessionId,
      "authority session"), reviewRequestId: text(raw.reviewRequestId, "authority review"),
    leaseEpoch: integer(raw.leaseEpoch, "authority epoch"), transitionCounter:
      integer(raw.transitionCounter, "authority transition counter"), state:
      raw.state === "active" ? "active" : invalid("authority state"), expiresAt:
      instant(raw.expiresAt, "authority expiry"), integrationReceiptDigest: null,
    integration: null, manifestDigest: digest(raw.manifestDigest, "authority manifest") };
  const result = freeze(normalized), source = plan.evidence.lease.record,
    prior = plan.evidence.authority.record;
  if (result.ledgerRepository !== prior.ledgerRepository || result.targetRepository !== prior.targetRepository || result.claimId !== plan.expectedSuccessorClaimId || result.canonicalBaseSha !== plan.sourceBaseSha || result.laneRevision !== plan.sourceHeadSha || result.writeSetDigest !== source.admission.writeSetDigest || JSON.stringify(result.cloudDeclaredWriteScope) !== JSON.stringify(source.admission.declaredWriteSet) || result.deviceId !== source.device || result.sessionId !== source.sessionId || result.reviewRequestId !== `github-pull-request:${plan.pullRequestNodeId}` || result.leaseEpoch !== plan.successorCloudLeaseEpoch || result.manifestDigest !== source.admission.manifestDigest) invalid("successor authority join");
  return result;
}
function digestFields(value, keys, label) { exact(value, keys, label);
  keys.forEach(key => digest(value[key], `${label} ${key}`)); return freeze(value); }
function seal(status, plan, authorization, phases, completion) { const core = { schema: INTENT_SCHEMA,
  status, planDigest: plan.planDigest, planSnapshot: plan, authorization,
  authorizationDigest: authorization.authorizationDigest, phases, completion };
  return freeze({ ...core, intentDigest: digestValue(core) }); }
function phase(value) { if (!PHASES.includes(value)) invalid("phase"); return value; }
function object(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  const copy = JSON.parse(JSON.stringify(value)); if (JSON.stringify(copy).length > 524288) invalid(label);
  return copy; }
function exact(value, keys, label) { if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) invalid(label); }
function same(left, right, label) { if (JSON.stringify(left) !== JSON.stringify(right)) invalid(label); }
function text(value, label) { if (typeof value !== "string" || !value || value !== value.trim() || value.includes("\0")) invalid(label); return value; }
function sha(value, label) { if (!SHA.test(text(value, label))) invalid(label); return value; }
function digest(value, label) { if (!DIGEST.test(text(value, label))) invalid(label); return value; }
function integer(value, label, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) invalid(label); return value; }
function instant(value, label) { const result = text(value, label), time = Date.parse(result);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== result) invalid(label); return result; }
function sortedStrings(value, label) { if (!Array.isArray(value) || value.length < 1 || value.some(item => typeof item !== "string" || !item) || new Set(value).size !== value.length || JSON.stringify(value) !== JSON.stringify([...value].sort())) invalid(label); return freeze([...value]); }
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"); }
function freeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) {
  Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function invalid(label) { throw new Error(`Delivery-authorized CI-failure recovery ${label} is invalid.`); }
