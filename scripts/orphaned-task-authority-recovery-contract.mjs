// Responsibility: Define one exact, replay-safe replacement of irrecoverable task authority.
import { digestValue } from "./cloud-collaboration-primitives.mjs";

export const ORPHANED_TASK_AUTHORITY_SOURCE_SCHEMA =
  "agentic-orphaned-task-authority-source/v1";
export const ORPHANED_TASK_AUTHORITY_PLAN_SCHEMA =
  "agentic-orphaned-task-authority-recovery-plan/v1";
export const ORPHANED_TASK_AUTHORITY_INTENT_SCHEMA =
  "agentic-orphaned-task-authority-recovery-intent/v1";
export const ORPHANED_TASK_AUTHORITY_RESULT_SCHEMA =
  "agentic-orphaned-task-authority-recovery-result/v1";

const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const SUBJECT_PATTERN = /^urn:agentic-task:[0-9a-f]{64}$/u;
const BRANCH_PATTERN = /^agent\/[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9-]*$/u;
const PHASES = Object.freeze([
  "prepared", "snapshotted", "local-cas", "pr-attempted",
  "pr-projected", "verified", "complete",
]);

export function createOrphanedTaskAuthorityRecoveryPlan({
  source,
  targetCapability,
  incidentReference,
  lossAttestationDigest,
  plannedAt = new Date().toISOString(),
} = {}) {
  const normalizedSource = normalizeOrphanedTaskAuthoritySource(source);
  const target = normalizeTargetCapabilityProjection(targetCapability);
  const reference = requiredText(incidentReference, "incident reference");
  if (reference.length < 16 || reference.length > 160) {
    throw new Error("Incident reference must contain 16 to 160 characters.");
  }
  const lossDigest = requiredDigest(lossAttestationDigest, "loss attestation digest");
  const instant = requiredInstant(plannedAt, "plannedAt");
  if (target.authoritySubjectId === normalizedSource.taskAuthority.authoritySubjectId) {
    throw new Error("Replacement task authority requires a distinct subject.");
  }
  if (target.generation !== normalizedSource.taskAuthority.generation + 1) {
    throw new Error("Replacement task authority generation must advance exactly once.");
  }
  const core = {
    schema: ORPHANED_TASK_AUTHORITY_PLAN_SCHEMA,
    operation: "orphaned-task-authority-recovery",
    source: normalizedSource,
    targetCapability: target,
    incidentReference: reference,
    lossAttestationDigest: lossDigest,
    plannedAt: instant,
    allowedEffects: [
      "external-journal", "dirty-snapshot", "writer-lease-task-authority-cas",
      "pull-request-marker-projection",
    ],
    forbiddenEffects: [
      "source-byte-change", "index-change", "commit", "ref-change", "cloud-mutation",
      "merge", "deployment", "runtime",
    ],
  };
  const planDigest = digestValue(core);
  return Object.freeze({
    ...core,
    planDigest,
    exactAuthorization: `authorize orphaned-task-authority-recovery ${planDigest}`,
  });
}

export function normalizeOrphanedTaskAuthorityRecoveryPlan(value) {
  const source = requireObject(value, "recovery plan");
  if (source.schema !== ORPHANED_TASK_AUTHORITY_PLAN_SCHEMA
    || source.operation !== "orphaned-task-authority-recovery") {
    throw new Error("Unsupported orphaned task-authority recovery plan.");
  }
  const normalized = createOrphanedTaskAuthorityRecoveryPlan({
    source: source.source,
    targetCapability: source.targetCapability,
    incidentReference: source.incidentReference,
    lossAttestationDigest: source.lossAttestationDigest,
    plannedAt: source.plannedAt,
  });
  if (source.planDigest !== normalized.planDigest
    || source.exactAuthorization !== normalized.exactAuthorization
    || JSON.stringify(source.allowedEffects) !== JSON.stringify(normalized.allowedEffects)
    || JSON.stringify(source.forbiddenEffects) !== JSON.stringify(normalized.forbiddenEffects)) {
    throw new Error("Orphaned task-authority recovery plan digest drifted.");
  }
  return normalized;
}

export function authorizeOrphanedTaskAuthorityRecovery(plan, authorization) {
  const normalized = normalizeOrphanedTaskAuthorityRecoveryPlan(plan);
  if (authorization !== normalized.exactAuthorization) {
    throw new Error("Orphaned task-authority recovery requires its exact authorization.");
  }
  return Object.freeze({
    schema: "agentic-orphaned-task-authority-authorization/v1",
    status: "authorized",
    planDigest: normalized.planDigest,
    authorizationDigest: digestValue(authorization),
  });
}

export function createOrphanedTaskAuthorityRecoveryIntent({ plan, authorization }) {
  const normalizedPlan = normalizeOrphanedTaskAuthorityRecoveryPlan(plan);
  const decision = authorizeOrphanedTaskAuthorityRecovery(normalizedPlan, authorization);
  const core = {
    schema: ORPHANED_TASK_AUTHORITY_INTENT_SCHEMA,
    status: "in-progress",
    phase: "prepared",
    planDigest: normalizedPlan.planDigest,
    authorizationDigest: decision.authorizationDigest,
    sourceLeaseDigest: normalizedPlan.source.leaseDigest,
    sourceBindingDigest: normalizedPlan.source.taskAuthority.bindingDigest,
    targetSubjectId: normalizedPlan.targetCapability.authoritySubjectId,
    planSnapshot: normalizedPlan,
    exactAuthorization: authorization,
    targetBindingDigest: null,
    receipts: {},
    completion: null,
  };
  return Object.freeze({ ...core, intentDigest: digestValue(core) });
}

export function advanceOrphanedTaskAuthorityRecoveryIntent(intent, {
  phase,
  receipt,
  targetBindingDigest = intent?.targetBindingDigest ?? null,
  completion = null,
} = {}) {
  const current = normalizeOrphanedTaskAuthorityRecoveryIntent(intent);
  const currentIndex = PHASES.indexOf(current.phase);
  const nextIndex = PHASES.indexOf(phase);
  if (nextIndex < 0 || nextIndex !== currentIndex + 1) {
    throw new Error("Recovery intent phase must advance exactly once.");
  }
  const normalizedReceipt = normalizeReceipt(receipt, `${phase} receipt`);
  if (phase === "local-cas") requiredDigest(targetBindingDigest, "target binding digest");
  if (phase === "complete" && !completion) {
    throw new Error("Complete recovery intent requires its terminal result.");
  }
  const normalizedCompletion = phase === "complete"
    ? normalizeOrphanedTaskAuthorityRecoveryResult(completion, current)
    : null;
  const core = {
    ...withoutIntentDigest(current),
    status: phase === "complete" ? "complete" : "in-progress",
    phase,
    targetBindingDigest,
    receipts: { ...current.receipts, [phase]: normalizedReceipt },
    completion: normalizedCompletion,
  };
  return Object.freeze({ ...core, intentDigest: digestValue(core) });
}

export function normalizeOrphanedTaskAuthorityRecoveryIntent(value) {
  const source = requireObject(value, "recovery intent");
  if (source.schema !== ORPHANED_TASK_AUTHORITY_INTENT_SCHEMA
    || !PHASES.includes(source.phase)
    || !["in-progress", "complete"].includes(source.status)) {
    throw new Error("Unsupported orphaned task-authority recovery intent.");
  }
  requiredDigest(source.planDigest, "intent plan digest");
  requiredDigest(source.authorizationDigest, "intent authorization digest");
  requiredDigest(source.sourceLeaseDigest, "intent source lease digest");
  requiredDigest(source.sourceBindingDigest, "intent source binding digest");
  if (!SUBJECT_PATTERN.test(source.targetSubjectId || "")) {
    throw new Error("Intent target subject is invalid.");
  }
  if (source.targetBindingDigest !== null) {
    requiredDigest(source.targetBindingDigest, "intent target binding digest");
  }
  const planSnapshot = normalizeOrphanedTaskAuthorityRecoveryPlan(source.planSnapshot);
  authorizeOrphanedTaskAuthorityRecovery(planSnapshot, source.exactAuthorization);
  if (planSnapshot.planDigest !== source.planDigest
    || digestValue(source.exactAuthorization) !== source.authorizationDigest) {
    throw new Error("Recovery intent plan or authorization drifted.");
  }
  const receipts = requireObject(source.receipts, "intent receipts");
  const index = PHASES.indexOf(source.phase);
  for (const [receiptPhase, receipt] of Object.entries(receipts)) {
    if (!PHASES.includes(receiptPhase) || PHASES.indexOf(receiptPhase) > index) {
      throw new Error("Recovery intent contains an out-of-order receipt.");
    }
    normalizeReceipt(receipt, `${receiptPhase} receipt`);
  }
  if ((source.phase === "complete") !== (source.status === "complete")) {
    throw new Error("Recovery intent completion state drifted.");
  }
  if (source.phase === "complete") {
    normalizeOrphanedTaskAuthorityRecoveryResult(source.completion, source);
  } else if (source.completion !== null) {
    throw new Error("Incomplete recovery intent cannot carry a completion result.");
  }
  const core = withoutIntentDigest(source);
  if (source.intentDigest !== digestValue(core)) {
    throw new Error("Recovery intent digest drifted.");
  }
  return Object.freeze({ ...core, intentDigest: source.intentDigest });
}

export function normalizeOrphanedTaskAuthoritySource(value) {
  const source = requireObject(value, "recovery source");
  if (source.schema !== ORPHANED_TASK_AUTHORITY_SOURCE_SCHEMA) {
    throw new Error("Unsupported orphaned task-authority source evidence.");
  }
  const repository = requireObject(source.repository, "source repository");
  const pullRequest = requireObject(source.pullRequest, "source pull request");
  const taskAuthority = requireObject(source.taskAuthority, "source task authority");
  const git = requireObject(source.git, "source Git evidence");
  if (!BRANCH_PATTERN.test(source.branch || "")) throw new Error("Source branch is invalid.");
  requiredSha(source.headSha, "source HEAD");
  requiredSha(source.treeSha, "source tree");
  requiredDigest(source.worktreeIdentityDigest, "worktree identity digest");
  requiredDigest(source.leaseDigest, "source lease digest");
  requiredDigest(source.claimId, "source claim ID");
  requiredDigest(source.cloudClaimDigest, "source cloud-claim digest");
  if (!SUBJECT_PATTERN.test(taskAuthority.authoritySubjectId || "")) {
    throw new Error("Source task authority subject is invalid.");
  }
  requireGeneration(taskAuthority.generation);
  requiredDigest(taskAuthority.bindingDigest, "source binding digest");
  requiredDigest(taskAuthority.publicKeyDigest, "source public-key digest");
  requiredDigest(pullRequest.bodyDigest, "pull-request body digest");
  requiredDigest(pullRequest.bodyRemainderDigest, "pull-request body remainder digest");
  requiredDigest(pullRequest.markerDigest, "pull-request marker digest");
  if (pullRequest.state !== "OPEN" || typeof pullRequest.isDraft !== "boolean") {
    throw new Error("Source pull request must be open with explicit draft state.");
  }
  if (!new Set(["clean", "dirty"]).has(git.kind)) throw new Error("Git evidence kind is invalid.");
  requiredDigest(git.evidenceDigest, "Git evidence digest");
  return Object.freeze(structuredClone(source));
}

function normalizeTargetCapabilityProjection(value) {
  const source = requireObject(value, "target capability projection");
  if (!SUBJECT_PATTERN.test(source.authoritySubjectId || "")) {
    throw new Error("Target capability subject is invalid.");
  }
  if (source.proofAdapterId !== "urn:agentic-proof:ed25519-file:v1") {
    throw new Error("Target capability proof adapter is invalid.");
  }
  requireGeneration(source.generation);
  requiredText(source.publicKey, "target public key");
  requiredDigest(source.publicKeyDigest, "target public-key digest");
  return Object.freeze({
    authoritySubjectId: source.authoritySubjectId,
    proofAdapterId: source.proofAdapterId,
    generation: source.generation,
    publicKey: source.publicKey,
    publicKeyDigest: source.publicKeyDigest,
  });
}

function normalizeReceipt(value, label) {
  const receipt = requireObject(value, label);
  requiredDigest(receipt.receiptDigest, `${label} digest`);
  const core = { ...receipt };
  delete core.receiptDigest;
  if (receipt.receiptDigest !== digestValue(core)) {
    throw new Error(`${label} digest drifted.`);
  }
  return Object.freeze(structuredClone(receipt));
}

function normalizeOrphanedTaskAuthorityRecoveryResult(value, intent) {
  const source = requireObject(value, "recovery result");
  if (source.schema !== ORPHANED_TASK_AUTHORITY_RESULT_SCHEMA
    || source.status !== "complete"
    || source.planDigest !== intent.planDigest
    || source.sourceBindingDigest !== intent.sourceBindingDigest
    || source.targetBindingDigest !== intent.targetBindingDigest
    || source.sourceBytesChanged !== false
    || source.cloudMutated !== false
    || source.merged !== false
    || source.deployed !== false) {
    throw new Error("Recovery completion result changed its exact subject or effect boundary.");
  }
  const phaseReceiptDigests = requireObject(
    source.phaseReceiptDigests,
    "completion phase receipt digests",
  );
  const expected = Object.fromEntries(Object.entries(intent.receipts)
    .filter(([phase]) => phase !== "complete")
    .map(([phase, receipt]) => [phase, receipt.receiptDigest]));
  if (JSON.stringify(phaseReceiptDigests) !== JSON.stringify(expected)) {
    throw new Error("Recovery completion result does not bind its phase receipts.");
  }
  const core = { ...source };
  delete core.resultDigest;
  if (source.resultDigest !== digestValue(core)) {
    throw new Error("Recovery completion result digest drifted.");
  }
  return Object.freeze(structuredClone(source));
}

function withoutIntentDigest(value) {
  const copy = { ...value };
  delete copy.intentDigest;
  return copy;
}

function requireObject(value, label) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}
function requiredText(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}
function requiredDigest(value, label) {
  if (!DIGEST_PATTERN.test(String(value || ""))) throw new Error(`${label} must be a SHA-256 digest.`);
  return value;
}
function requiredSha(value, label) {
  if (!SHA_PATTERN.test(String(value || ""))) throw new Error(`${label} must be a Git SHA.`);
  return value;
}
function requiredInstant(value, label) {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) throw new Error(`${label} must be an ISO instant.`);
  return new Date(time).toISOString();
}
function requireGeneration(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Task authority generation is invalid.");
}
