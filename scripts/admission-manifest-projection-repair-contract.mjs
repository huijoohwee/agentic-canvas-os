// Responsibility: Bind one legacy admission-manifest projection repair to exact evidence.
import { digestValue, normalizeWriteSet } from "./cloud-collaboration-primitives.mjs";

export const PLAN_SCHEMA = "agentic-admission-manifest-projection-repair-plan/v1";
export const INTENT_SCHEMA = "agentic-admission-manifest-projection-repair-intent/v1";
export const RECEIPT_SCHEMA = "agentic-admission-manifest-projection-repair-receipt/v1";
const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const STATUSES = ["prepared", "provider-projected", "registry-projected", "complete"];

export function deriveAdmissionManifestProjection({ semanticScope, declaredWriteSet }) {
  const normalizedWriteSet = normalizeWriteSet(declaredWriteSet);
  const paths = normalizedWriteSet
    .filter(item => item.startsWith("path:"))
    .map(item => item.slice("path:".length));
  if (!normalizedWriteSet.includes(`semantic:${semanticScope}`) || paths.length + 1 !== normalizedWriteSet.length) {
    throw new Error("Admission manifest projection repair requires one semantic scope and path-only entries.");
  }
  const canonicalManifest = Object.freeze({
    schema: "agentic-declared-write-scope/v1",
    semanticScope,
    paths,
  });
  const legacyManifest = Object.freeze({
    schema: "agentic-declared-write-scope/v1",
    semanticScope,
    declaredWriteSet: normalizedWriteSet,
  });
  return Object.freeze({
    declaredWriteSet: normalizedWriteSet,
    writeSetDigest: digestValue(normalizedWriteSet),
    canonicalManifestDigest: digestValue(canonicalManifest),
    legacyManifestDigest: digestValue(legacyManifest),
  });
}

export function buildAdmissionManifestProjectionRepairPlan(evidence) {
  const normalizedEvidence = normalizeEvidence(evidence);
  const core = Object.freeze({
    schema: PLAN_SCHEMA,
    operation: "admission-manifest-projection-repair",
    evidence: normalizedEvidence,
  });
  const planDigest = digestValue(core);
  return Object.freeze({
    ...core,
    planDigest,
    exactAuthorization: `authorize admission-manifest-projection-repair ${planDigest}`,
  });
}

export function normalizeAdmissionManifestProjectionRepairPlan(value) {
  exactKeys(value, ["schema", "operation", "evidence", "planDigest", "exactAuthorization"], "plan");
  if (value.schema !== PLAN_SCHEMA || value.operation !== "admission-manifest-projection-repair") invalid("plan identity");
  const expected = buildAdmissionManifestProjectionRepairPlan(value.evidence);
  if (value.planDigest !== expected.planDigest || value.exactAuthorization !== expected.exactAuthorization) invalid("plan digest");
  return expected;
}

export function authorizeAdmissionManifestProjectionRepair(plan, authorization) {
  const normalized = normalizeAdmissionManifestProjectionRepairPlan(plan);
  if (authorization !== normalized.exactAuthorization) invalid("authorization");
  return normalized;
}

export function createAdmissionManifestProjectionRepairIntent(plan) {
  const normalized = normalizeAdmissionManifestProjectionRepairPlan(plan);
  const operationId = digestValue({ schema: INTENT_SCHEMA, planDigest: normalized.planDigest });
  return normalizeIntent({
    schema: INTENT_SCHEMA,
    operationId,
    planDigest: normalized.planDigest,
    plan: normalized,
    status: "prepared",
    attempts: [],
    phases: {},
    receipt: null,
  });
}

export function normalizeAdmissionManifestProjectionRepairIntent(value) { return normalizeIntent(value); }

export function beginAdmissionManifestProjectionRepairEffect(value, phase) {
  const current = normalizeIntent(value);
  if (phase !== STATUSES[STATUSES.indexOf(current.status) + 1] || phase === "complete"
    || current.attempts.some(item => item.phase === phase)) invalid("effect attempt");
  const attempt = Object.freeze({
    phase,
    attemptDigest: digestValue({ schema: INTENT_SCHEMA, operationId: current.operationId, phase }),
  });
  return normalizeIntent({ ...current, attempts: [...current.attempts, attempt] });
}

export function advanceAdmissionManifestProjectionRepairIntent(value, phase, effectReceipt) {
  const current = normalizeIntent(value);
  if (phase !== STATUSES[STATUSES.indexOf(current.status) + 1] || phase === "complete"
    || current.attempts.at(-1)?.phase !== phase) invalid("phase transition");
  return normalizeIntent({
    ...current,
    status: phase,
    phases: { ...current.phases, [phase]: Object.freeze({ ...effectReceipt }) },
  });
}

export function completeAdmissionManifestProjectionRepairIntent(value, receipt) {
  const current = normalizeIntent(value);
  const normalizedReceipt = normalizeAdmissionManifestProjectionRepairReceipt(receipt);
  if (current.status !== "registry-projected" || normalizedReceipt.operationId !== current.operationId
    || normalizedReceipt.planDigest !== current.planDigest) invalid("completion join");
  return normalizeIntent({ ...current, status: "complete", receipt: normalizedReceipt });
}

export function buildAdmissionManifestProjectionRepairReceipt({ intent, providerBodyDigest, registryDigest, leaseDigest }) {
  const current = normalizeIntent(intent);
  if (current.status !== "registry-projected") invalid("receipt phase");
  const evidence = current.plan.evidence;
  const core = Object.freeze({
    schema: RECEIPT_SCHEMA,
    status: "repaired",
    operationId: current.operationId,
    planDigest: current.planDigest,
    repository: evidence.repository,
    pullRequestNumber: evidence.pullRequest.number,
    branch: evidence.pullRequest.branch,
    headSha: evidence.pullRequest.headSha,
    claimId: evidence.claim.claimId,
    oldManifestDigest: evidence.projection.legacyManifestDigest,
    newManifestDigest: evidence.projection.canonicalManifestDigest,
    providerBodyDigest: requireDigest(providerBodyDigest, "provider body digest"),
    registryDigest: requireDigest(registryDigest, "registry digest"),
    leaseDigest: requireDigest(leaseDigest, "lease digest"),
    phases: current.phases,
    mutationSet: Object.freeze(["pull-request-writer-marker", "local-writer-lease-projection"]),
    claimMutation: false,
    refMutation: false,
    sourceMutation: false,
  });
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}

export function normalizeAdmissionManifestProjectionRepairReceipt(value) {
  const { receiptDigest, ...core } = value || {};
  if (core.schema !== RECEIPT_SCHEMA || core.status !== "repaired"
    || receiptDigest !== digestValue(core) || core.claimMutation !== false
    || core.refMutation !== false || core.sourceMutation !== false
    || JSON.stringify(core.mutationSet) !== JSON.stringify(["pull-request-writer-marker", "local-writer-lease-projection"])) {
    invalid("receipt");
  }
  requireDigest(core.operationId, "operation ID");
  requireDigest(core.planDigest, "receipt plan digest");
  requireDigest(core.providerBodyDigest, "provider body digest");
  requireDigest(core.registryDigest, "registry digest");
  requireDigest(core.leaseDigest, "lease digest");
  return Object.freeze({ ...core, receiptDigest });
}

function normalizeEvidence(value) {
  exactKeys(value, ["repository", "canonical", "pullRequest", "lease", "claim", "projection"], "evidence");
  const projection = value.projection;
  const derived = deriveAdmissionManifestProjection({
    semanticScope: projection.semanticScope,
    declaredWriteSet: projection.declaredWriteSet,
  });
  for (const key of ["writeSetDigest", "canonicalManifestDigest", "legacyManifestDigest"]) {
    if (projection[key] !== derived[key]) invalid(`projection ${key}`);
  }
  for (const key of ["oldLeaseDigest", "newLeaseDigest", "oldMarkerDigest", "newMarkerDigest",
    "oldBodyDigest", "newBodyDigest", "registryDigest"]) requireDigest(projection[key], key);
  if (projection.legacyManifestDigest === projection.canonicalManifestDigest) invalid("legacy projection identity");
  if (!SHA.test(value.canonical.headSha) || value.canonical.clean !== true) invalid("canonical state");
  if (!SHA.test(value.pullRequest.headSha) || value.pullRequest.state !== "OPEN"
    || value.pullRequest.isDraft !== false || value.pullRequest.baseBranch !== "main") invalid("pull request state");
  if (value.lease.status !== "review_ready" || value.lease.reviewHeadSha !== value.pullRequest.headSha
    || value.lease.branch !== value.pullRequest.branch || value.lease.claimId !== value.claim.claimId) invalid("lease identity");
  if (value.claim.state !== "reviewed" || value.claim.writeAuthority !== false
    || value.claim.scopeReserved !== true || value.claim.laneRevision !== value.pullRequest.headSha) invalid("claim state");
  return deepFreeze({ ...value, projection: { ...projection, ...derived } });
}

function normalizeIntent(value) {
  if (value?.schema !== INTENT_SCHEMA || !DIGEST.test(String(value.operationId || ""))
    || !DIGEST.test(String(value.planDigest || "")) || !STATUSES.includes(value.status)
    || !Array.isArray(value.attempts) || !value.phases || typeof value.phases !== "object") invalid("intent");
  const plan = normalizeAdmissionManifestProjectionRepairPlan(value.plan);
  if (plan.planDigest !== value.planDigest) invalid("intent plan join");
  if (value.status === "complete") normalizeAdmissionManifestProjectionRepairReceipt(value.receipt);
  else if (value.receipt !== null) invalid("premature receipt");
  return deepFreeze({ ...value, plan });
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) invalid(`${label} keys`);
}
function requireDigest(value, label) { if (!DIGEST.test(String(value || ""))) invalid(label); return value; }
function invalid(label) { throw new Error(`Admission manifest projection repair ${label} is invalid.`); }
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
