// Responsibility: Seal one expired planned-lease PR-marker body repair and its receipts.
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";

export const EXPIRED_PLANNED_COMMITTED_PR_MARKER_RESPONSE_LOSS_OPERATION =
  "expired-planned-committed-pr-marker-response-loss";
export const EXPIRED_PLANNED_COMMITTED_PR_MARKER_RESPONSE_LOSS_PLAN_SCHEMA =
  "agentic-expired-planned-committed-pr-marker-response-loss-plan/v1";
export const EXPIRED_PLANNED_COMMITTED_PR_MARKER_RESPONSE_LOSS_INTENT_SCHEMA =
  "agentic-expired-planned-committed-pr-marker-response-loss-intent/v1";
export const EXPIRED_PLANNED_COMMITTED_PR_MARKER_RESPONSE_LOSS_RECEIPT_SCHEMA =
  "agentic-expired-planned-committed-pr-marker-response-loss-receipt/v1";

const PHASES = Object.freeze([
  "prepared",
  "authority-verified",
  "provider-attempted",
  "provider-projected",
  "complete",
]);
const ALLOWED_MUTATIONS = Object.freeze(["provider-review-body"]);
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

export function buildExpiredPlannedCommittedPrMarkerResponseLossPlan({ evidence } = {}) {
  const normalizedEvidence = normalizeEvidence(evidence);
  const core = {
    schema: EXPIRED_PLANNED_COMMITTED_PR_MARKER_RESPONSE_LOSS_PLAN_SCHEMA,
    operation: EXPIRED_PLANNED_COMMITTED_PR_MARKER_RESPONSE_LOSS_OPERATION,
    evidence: normalizedEvidence,
    allowedMutations: ALLOWED_MUTATIONS,
    terminalStatus: "projection-restored-expired-admitted",
  };
  const planDigest = digestValue(core);
  return deepFreeze({
    ...core,
    planDigest,
    taskAuthorityOperation:
      `${EXPIRED_PLANNED_COMMITTED_PR_MARKER_RESPONSE_LOSS_OPERATION}:${planDigest}`,
  });
}

export function normalizeExpiredPlannedCommittedPrMarkerResponseLossPlan(value) {
  if (value?.schema !== EXPIRED_PLANNED_COMMITTED_PR_MARKER_RESPONSE_LOSS_PLAN_SCHEMA) {
    invalid("plan schema");
  }
  const rebuilt = buildExpiredPlannedCommittedPrMarkerResponseLossPlan(value);
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("plan projection");
  return rebuilt;
}

export function createExpiredPlannedCommittedPrMarkerResponseLossIntent(plan) {
  const normalizedPlan = normalizeExpiredPlannedCommittedPrMarkerResponseLossPlan(plan);
  return sealIntent({
    plan: normalizedPlan,
    status: "prepared",
    phases: {
      prepared: buildPhaseReceipt(normalizedPlan, "prepared", null, {}),
    },
    completion: null,
  });
}

export function advanceExpiredPlannedCommittedPrMarkerResponseLossIntent(
  value,
  { status, values = {} } = {},
) {
  const current = normalizeExpiredPlannedCommittedPrMarkerResponseLossIntent(value);
  if (PHASES.indexOf(status) !== PHASES.indexOf(current.status) + 1) {
    invalid("phase transition");
  }
  const nextReceipt = buildPhaseReceipt(
    current.planSnapshot,
    status,
    current.phases[current.status].receiptDigest,
    values,
  );
  const phases = { ...current.phases, [status]: nextReceipt };
  const completion = status === "complete"
    ? buildCompletionReceipt(current.planSnapshot, phases)
    : null;
  return sealIntent({ plan: current.planSnapshot, status, phases, completion });
}

export function normalizeExpiredPlannedCommittedPrMarkerResponseLossIntent(value) {
  if (value?.schema !== EXPIRED_PLANNED_COMMITTED_PR_MARKER_RESPONSE_LOSS_INTENT_SCHEMA
    || !PHASES.includes(value.status)) invalid("intent");
  const plan = normalizeExpiredPlannedCommittedPrMarkerResponseLossPlan(value.planSnapshot);
  const expectedPhases = PHASES.slice(0, PHASES.indexOf(value.status) + 1);
  if (canonicalJson(Object.keys(value.phases || {})) !== canonicalJson(expectedPhases)) {
    invalid("intent phases");
  }
  let previousReceiptDigest = null;
  const phases = {};
  for (const phase of expectedPhases) {
    const receipt = buildPhaseReceipt(
      plan,
      phase,
      previousReceiptDigest,
      value.phases?.[phase]?.values,
    );
    phases[phase] = receipt;
    previousReceiptDigest = receipt.receiptDigest;
  }
  const completion = value.status === "complete"
    ? buildCompletionReceipt(plan, phases)
    : null;
  const rebuilt = sealIntent({ plan, status: value.status, phases, completion });
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("intent projection");
  return rebuilt;
}

export function buildExpiredPlannedCommittedPrMarkerResponseLossCompletionReceipt(value) {
  const intent = normalizeExpiredPlannedCommittedPrMarkerResponseLossIntent(value);
  if (intent.status !== "complete") invalid("completion phase");
  return intent.completion;
}

function normalizeEvidence(value) {
  const source = record(value, "evidence");
  const worktree = record(source.worktree, "worktree");
  const lease = record(source.lease, "lease");
  const review = record(source.providerReview, "provider review");
  const marker = record(source.providerMarker, "provider marker");
  const cloud = record(source.cloudClaim, "cloud claim");
  const leaseAuthority = normalizeAuthority(lease.cloudAuthority, "lease cloud authority");
  const markerAuthority = normalizeAuthority(marker.cloudAuthority, "marker cloud authority");
  const core = {
    schema: source.schema === "agentic-expired-planned-committed-pr-marker-response-loss-evidence/v1"
      ? source.schema : invalid("evidence schema"),
    repository: text(source.repository, "repository"),
    observedAt: instant(source.observedAt, "observedAt"),
    worktree: {
      identityDigest: digest(worktree.identityDigest, "worktree identity digest"),
      branch: text(worktree.branch, "worktree branch"),
      headSha: sha(worktree.headSha, "worktree head"),
      treeSha: sha(worktree.treeSha, "worktree tree"),
      clean: worktree.clean === true,
      registered: worktree.registered === true,
      fenceAncestorOfHead: worktree.fenceAncestorOfHead === true,
    },
    remoteHeadSha: sha(source.remoteHeadSha, "remote head"),
    lease: {
      leaseDigest: digest(lease.leaseDigest, "lease digest"),
      status: lease.status === "active" ? "active" : invalid("lease status"),
      admissionStatus: lease.admissionStatus === "admitted"
        ? "admitted" : invalid("lease admission status"),
      branch: text(lease.branch, "lease branch"),
      baseSha: sha(lease.baseSha, "lease base"),
      fenceSha: sha(lease.fenceSha, "lease fence"),
      expiresAt: instant(lease.expiresAt, "lease expiry"),
      taskAuthorityBindingDigest: digest(
        lease.taskAuthorityBindingDigest,
        "task authority binding digest",
      ),
      cloudAuthority: leaseAuthority,
    },
    providerReview: {
      id: text(review.id, "provider review ID"),
      url: text(review.url, "provider review URL"),
      state: review.state === "open" ? "open" : invalid("provider review state"),
      draft: review.draft === true,
      headBranch: text(review.headBranch, "provider head branch"),
      headSha: sha(review.headSha, "provider head"),
      sourceBodyDigest: digest(review.sourceBodyDigest, "source body digest"),
      targetBodyDigest: digest(review.targetBodyDigest, "target body digest"),
      sourceMarkerDigest: digest(review.sourceMarkerDigest, "source marker digest"),
      targetMarkerDigest: digest(review.targetMarkerDigest, "target marker digest"),
      providerState: ["source", "target"].includes(review.providerState)
        ? review.providerState : invalid("provider state"),
      currentBodyDigest: digest(review.currentBodyDigest, "current body digest"),
      currentMarkerDigest: digest(review.currentMarkerDigest, "current marker digest"),
      mutationSemantics: review.mutationSemantics === "observable-pre-read-edit-post-read"
        ? review.mutationSemantics : invalid("provider mutation semantics"),
    },
    providerMarker: {
      stableLeaseDigest: digest(marker.stableLeaseDigest, "provider stable lease digest"),
      cloudAuthority: markerAuthority,
    },
    cloudClaim: normalizeCloudClaim(cloud),
  };
  assertRecoveryBoundary(core);
  return deepFreeze({ ...core, evidenceDigest: digestValue(core) });
}

function assertRecoveryBoundary(evidence) {
  const { worktree, lease, providerReview: review, providerMarker: marker, cloudClaim } = evidence;
  const target = lease.cloudAuthority;
  const source = marker.cloudAuthority;
  const expectedBodyDigest = review.providerState === "source"
    ? review.sourceBodyDigest : review.targetBodyDigest;
  const expectedMarkerDigest = review.providerState === "source"
    ? review.sourceMarkerDigest : review.targetMarkerDigest;
  if (!worktree.clean || !worktree.registered || !worktree.fenceAncestorOfHead
    || worktree.headSha === lease.fenceSha
    || worktree.branch !== lease.branch
    || evidence.remoteHeadSha !== lease.fenceSha
    || review.headBranch !== lease.branch || review.headSha !== lease.fenceSha
    || !review.draft
    || review.currentBodyDigest !== expectedBodyDigest
    || review.currentMarkerDigest !== expectedMarkerDigest
    || Date.parse(evidence.observedAt) < Date.parse(lease.expiresAt)
    || source.transitionCounter + 1 !== target.transitionCounter
    || ![0, 1].includes(target.heartbeatCounter - source.heartbeatCounter)
    || stableAuthorityDigest(source) !== stableAuthorityDigest(target)
    || marker.stableLeaseDigest !== stableLeaseDigest(lease)
    || cloudClaim.state !== "dormant-preserved"
    || cloudClaim.writeAuthority || !cloudClaim.scopeReserved
    || cloudClaim.claimId !== target.claimId
    || cloudClaim.transitionCounter !== target.transitionCounter
    || cloudClaim.fenceRevision !== target.claimDigest
    || cloudClaim.transitionDigest !== target.claimLedgerRevision
    || cloudClaim.operationReceiptDigest !== target.operationReceiptDigest) {
    invalid("exact expired planned marker repair boundary");
  }
}

function normalizeAuthority(value, label) {
  const authority = record(value, label);
  return {
    schema: authority.schema === "agentic-lane-cloud-authority/v1"
      ? authority.schema : invalid(`${label} schema`),
    claimId: digest(authority.claimId, `${label} claim ID`),
    claimDigest: digest(authority.claimDigest, `${label} claim digest`),
    claimLedgerRevision: digest(
      authority.claimLedgerRevision,
      `${label} claim ledger revision`,
    ),
    operationReceiptDigest: digest(
      authority.operationReceiptDigest,
      `${label} operation receipt`,
    ),
    laneRevision: sha(authority.laneRevision, `${label} lane revision`),
    writeSetDigest: digest(authority.writeSetDigest, `${label} write-set digest`),
    transitionCounter: positiveInteger(
      authority.transitionCounter,
      `${label} transition counter`,
    ),
    heartbeatCounter: nonnegativeInteger(
      authority.heartbeatCounter ?? 0,
      `${label} heartbeat counter`,
    ),
    expiresAt: instant(authority.expiresAt, `${label} expiry`),
  };
}

function normalizeCloudClaim(value) {
  return {
    state: value.state === "dormant-preserved"
      ? value.state : invalid("cloud claim state"),
    writeAuthority: value.writeAuthority === true,
    scopeReserved: value.scopeReserved === true,
    claimId: digest(value.claimId, "cloud claim ID"),
    fenceRevision: digest(value.fenceRevision, "cloud claim fence"),
    transitionDigest: digest(value.transitionDigest, "cloud claim transition"),
    operationReceiptDigest: digest(value.operationReceiptDigest, "cloud claim receipt"),
    transitionCounter: positiveInteger(value.transitionCounter, "cloud claim transition counter"),
    heartbeatCounter: nonnegativeInteger(
      value.heartbeatCounter ?? 0,
      "cloud claim heartbeat counter",
    ),
  };
}

function stableAuthorityDigest(authority) {
  const { claimDigest, claimLedgerRevision, operationReceiptDigest, transitionCounter,
    heartbeatCounter, expiresAt, ...stable } = authority;
  return digestValue(stable);
}

function stableLeaseDigest(lease) {
  return digestValue({
    status: lease.status,
    admissionStatus: lease.admissionStatus,
    branch: lease.branch,
    baseSha: lease.baseSha,
    fenceSha: lease.fenceSha,
    taskAuthorityBindingDigest: lease.taskAuthorityBindingDigest,
  });
}

function buildPhaseReceipt(plan, phase, previousReceiptDigest, values) {
  const normalizedValues = normalizePhaseValues(plan, phase, values);
  const core = {
    schema: "agentic-expired-planned-committed-pr-marker-response-loss-phase-receipt/v1",
    phase,
    planDigest: plan.planDigest,
    previousReceiptDigest,
    values: normalizedValues,
    valuesDigest: digestValue(normalizedValues),
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function normalizePhaseValues(plan, phase, values) {
  const source = structuredClone(record(values, `${phase} values`));
  if (phase === "prepared") {
    exactKeys(source, [], phase);
  } else if (phase === "authority-verified") {
    exactKeys(source, ["bindingDigest", "taskAuthorityReceiptDigest"], phase);
    digest(source.bindingDigest, "authority binding digest");
    digest(source.taskAuthorityReceiptDigest, "task authority receipt digest");
    if (source.bindingDigest !== plan.evidence.lease.taskAuthorityBindingDigest) {
      invalid("task authority evidence join");
    }
  } else if (phase === "provider-attempted") {
    exactKeys(source, ["providerState", "revalidationDigest"], phase);
    if (!["source", "target"].includes(source.providerState)) invalid("provider replay state");
    digest(source.revalidationDigest, "provider revalidation digest");
  } else if (phase === "provider-projected") {
    const expected = ["disposition", "projectionDigest", "providerMutation"];
    if (Object.hasOwn(source, "providerProjected")) expected.push("providerProjected");
    exactKeys(source, expected, phase);
    if (!["projected", "adopted-response-loss"].includes(source.disposition)
      || source.providerMutation !== (source.disposition === "projected")
      || (Object.hasOwn(source, "providerProjected")
        && (source.providerProjected !== true
          || source.disposition !== "adopted-response-loss"))) {
      invalid("provider projection receipt");
    }
    digest(source.projectionDigest, "provider projection digest");
    if (source.projectionDigest !== plan.evidence.providerReview.targetBodyDigest) {
      invalid("sealed target body");
    }
  } else if (phase === "complete") {
    exactKeys(source, ["verificationDigest"], phase);
    digest(source.verificationDigest, "terminal verification digest");
  } else {
    invalid("phase values");
  }
  return deepFreeze(source);
}

function buildCompletionReceipt(plan, phases) {
  const authority = phases["authority-verified"];
  const attempted = phases["provider-attempted"];
  const projected = phases["provider-projected"];
  const terminal = phases.complete;
  if (!authority || !attempted || !projected || !terminal) invalid("completion receipts");
  if (attempted.values.providerState === "target"
    && projected.values.disposition !== "adopted-response-loss") {
    invalid("target replay disposition");
  }
  const core = {
    schema: EXPIRED_PLANNED_COMMITTED_PR_MARKER_RESPONSE_LOSS_RECEIPT_SCHEMA,
    status: "projection-restored-expired-admitted",
    planDigest: plan.planDigest,
    evidenceDigest: plan.evidence.evidenceDigest,
    taskAuthorityOperation: plan.taskAuthorityOperation,
    taskAuthorityReceiptDigest: authority.values.taskAuthorityReceiptDigest,
    taskAuthorityBindingDigest: authority.values.bindingDigest,
    providerPrevalidationState: attempted.values.providerState,
    providerDisposition: projected.values.disposition,
    providerMutation: projected.values.providerMutation,
    providerProjectionDigest: projected.values.projectionDigest,
    terminalVerificationDigest: terminal.values.verificationDigest,
    mutationSet: ALLOWED_MUTATIONS,
    privateJournalMutation: true,
    cloudMutation: false,
    writerRegistryMutation: false,
    leaseRegistryMutation: false,
    claimRegistryMutation: false,
    gitMutation: false,
    remoteRefMutation: false,
    sourceMutation: false,
    providerReviewMetadataMutation: false,
    authoringAuthorityGranted: false,
    integrationAuthorityGranted: false,
    releaseAuthorityGranted: false,
    deploymentAuthorityGranted: false,
    cleanupAuthorityGranted: false,
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function sealIntent({ plan, status, phases, completion }) {
  const core = {
    schema: EXPIRED_PLANNED_COMMITTED_PR_MARKER_RESPONSE_LOSS_INTENT_SCHEMA,
    status,
    planDigest: plan.planDigest,
    planSnapshot: plan,
    phases,
    completion,
  };
  return deepFreeze({ ...core, intentDigest: digestValue(core) });
}

function exactKeys(value, keys, label) {
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) {
    invalid(`${label} fields`);
  }
}
function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  return value;
}
function text(value, label) {
  if (typeof value !== "string" || !value.trim()) invalid(label);
  return value;
}
function sha(value, label) {
  if (!SHA_PATTERN.test(String(value || ""))) invalid(label);
  return value;
}
function digest(value, label) {
  if (!DIGEST_PATTERN.test(String(value || ""))) invalid(label);
  return value;
}
function instant(value, label) {
  const parsed = new Date(value);
  if (!value || parsed.toISOString() !== value) invalid(label);
  return value;
}
function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) invalid(label);
  return value;
}
function nonnegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) invalid(label);
  return value;
}
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
function invalid(label) {
  throw new Error(
    `Expired planned committed PR marker response-loss contract has invalid ${label}.`,
  );
}
