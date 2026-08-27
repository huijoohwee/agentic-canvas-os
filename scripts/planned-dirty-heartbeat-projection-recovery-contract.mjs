// Responsibility: Bind exact authorization and completion to one sealed heartbeat projection.
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import { normalizePlannedDirtyHeartbeatProjectionRecoveryEvidence }
  from "./planned-dirty-heartbeat-projection-recovery-evidence.mjs";

export const OPERATION = "planned-dirty-heartbeat-projection-recovery";
export const PLAN_SCHEMA =
  "agentic-planned-dirty-heartbeat-projection-recovery-plan/v1";
export const COMPLETION_SCHEMA =
  "agentic-planned-dirty-heartbeat-projection-recovery-completion/v1";
export const MUTATION_POLICY = Object.freeze({
  allowed: Object.freeze([
    "exact-branch-writer-registry-heartbeat-projection",
    "deterministic-pull-request-writer-marker-projection",
  ]),
  sourceBytes: false,
  index: false,
  head: false,
  localRef: false,
  remoteRef: false,
  cloudLedger: false,
  pullRequestState: false,
  admissionStatus: false,
  integration: false,
  merge: false,
  deployment: false,
  cleanup: false,
  authoringAuthorityGranted: false,
});

const DIGEST = /^[0-9a-f]{64}$/u;

export function buildPlannedDirtyHeartbeatProjectionRecoveryPlan(evidence) {
  const normalized = normalizePlannedDirtyHeartbeatProjectionRecoveryEvidence(evidence);
  const core = {
    schema: PLAN_SCHEMA,
    operation: OPERATION,
    evidence: normalized,
    mutationPolicy: MUTATION_POLICY,
  };
  return Object.freeze({ ...core, planDigest: digestValue(core) });
}

export function normalizePlannedDirtyHeartbeatProjectionRecoveryPlan(value) {
  const source = record(value, "recovery plan");
  const normalized = buildPlannedDirtyHeartbeatProjectionRecoveryPlan(source.evidence);
  if (source.schema !== PLAN_SCHEMA || source.operation !== OPERATION
    || source.planDigest !== normalized.planDigest
    || canonicalJson(source.mutationPolicy) !== canonicalJson(MUTATION_POLICY)
    || canonicalJson(source) !== canonicalJson(normalized)) invalid("canonical plan");
  return normalized;
}

export function exactAuthorization(plan) {
  return `authorize ${OPERATION} ${normalizePlannedDirtyHeartbeatProjectionRecoveryPlan(plan).planDigest}`;
}

export function authorizePlannedDirtyHeartbeatProjectionRecovery(plan, authorization) {
  const expected = exactAuthorization(plan);
  if (String(authorization || "").trim() !== expected) {
    throw new Error(`Exact authorization required: ${expected}`);
  }
  return expected;
}

export function buildPlannedDirtyHeartbeatProjectionRecoveryCompletion({ plan, terminal }) {
  const sealed = normalizePlannedDirtyHeartbeatProjectionRecoveryPlan(plan);
  const value = normalizeTerminal(terminal);
  const evidence = sealed.evidence;
  if (value.targetLeaseDigest !== evidence.targetLeaseDigest
    || value.targetBodyDigest !== evidence.targetBodyDigest
    || value.targetMarkerDigest !== evidence.targetMarkerDigest
    || value.targetCloudAuthorityDigest !== evidence.targetCloudAuthorityDigest
    || value.recoveryReceiptDigest !== evidence.recoveryReceipt.receiptDigest
    || value.dirtDigest !== evidence.dirtDigest) invalid("terminal projection");
  const core = {
    schema: COMPLETION_SCHEMA,
    status: "complete",
    planDigest: sealed.planDigest,
    claimId: evidence.sourceLease.cloudAuthority.claimId,
    sourceLeaseDigest: evidence.sourceLeaseDigest,
    targetLeaseDigest: value.targetLeaseDigest,
    sourceCloudAuthorityDigest: evidence.projection.sourceAuthorityDigest,
    targetCloudAuthorityDigest: value.targetCloudAuthorityDigest,
    heartbeatProjectionDigest: evidence.projection.projectionDigest,
    recoveryReceiptDigest: value.recoveryReceiptDigest,
    dirtDigest: value.dirtDigest,
    targetMarkerDigest: value.targetMarkerDigest,
    targetBodyDigest: value.targetBodyDigest,
    registryProjected: true,
    markerProjected: true,
    adoptedRegistryProjection: value.adoptedRegistryProjection,
    adoptedMarkerProjection: value.adoptedMarkerProjection,
    mutationPolicy: MUTATION_POLICY,
  };
  return Object.freeze({ ...core, completionDigest: digestValue(core) });
}

export function normalizeTerminal(value) {
  const source = record(value, "terminal evidence");
  return Object.freeze({
    targetLeaseDigest: digest(source.targetLeaseDigest, "terminal target lease"),
    targetCloudAuthorityDigest: digest(source.targetCloudAuthorityDigest,
      "terminal cloud authority"),
    recoveryReceiptDigest: digest(source.recoveryReceiptDigest,
      "terminal recovery receipt"),
    dirtDigest: digest(source.dirtDigest, "terminal dirt"),
    targetMarkerDigest: digest(source.targetMarkerDigest, "terminal marker"),
    targetBodyDigest: digest(source.targetBodyDigest, "terminal body"),
    adoptedRegistryProjection: Boolean(source.adoptedRegistryProjection),
    adoptedMarkerProjection: Boolean(source.adoptedMarkerProjection),
  });
}

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  return value;
}
function digest(value, label) {
  if (!DIGEST.test(String(value || ""))) invalid(label);
  return value;
}
function invalid(label) {
  throw new Error(`Planned-dirty heartbeat projection recovery has invalid ${label}.`);
}
