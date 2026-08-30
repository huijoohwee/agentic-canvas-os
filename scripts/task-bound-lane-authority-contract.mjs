// Responsibility: Define provider-neutral task authority identities, bindings, proofs, and transitions.
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify,
} from "node:crypto";

import { digestValue } from "./cloud-collaboration-primitives.mjs";

export const TASK_AUTHORITY_CAPABILITY_SCHEMA =
  "agentic-task-authority-capability/v1";
export const TASK_AUTHORITY_BINDING_SCHEMA =
  "agentic-task-authority-binding/v1";
export const TASK_AUTHORITY_PROOF_SCHEMA = "agentic-task-authority-proof/v1";
export const TASK_AUTHORITY_TRANSITION_PLAN_SCHEMA =
  "agentic-task-authority-transition-plan/v1";
export const TASK_AUTHORITY_PROOF_ADAPTER =
  "urn:agentic-proof:ed25519-file:v1";

const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const SUBJECT_PATTERN = /^urn:agentic-task:[0-9a-f]{64}$/u;
const BRANCH_PATTERN = /^agent\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u;

// `rebind` re-anchors one unchanged authority subject onto its own lane after the
// lane's volatile operands moved. Every other mode either creates authority or
// replaces the subject; without this mode a drifted binding has no exit, which
// makes an ordinary lane event unrecoverable.
export const TASK_AUTHORITY_BINDING_MODES = Object.freeze([
  "claim", "continuation", "migration", "handoff", "rebind",
]);
const PLANNED_BINDING_MODES = Object.freeze(["migration", "handoff", "rebind"]);
const PRIOR_BOUND_BINDING_MODES = Object.freeze(["continuation", "handoff", "rebind"]);
export const TASK_AUTHORITY_TRANSITION_OPERATIONS = Object.freeze([
  "migration", "handoff", "rebind",
]);

export function createTaskAuthorityCapability({
  authoritySubjectId = `urn:agentic-task:${randomBytes(32).toString("hex")}`,
  generation = 1,
  issuedAt = new Date().toISOString(),
} = {}) {
  requireSubject(authoritySubjectId);
  requireGeneration(generation);
  requireInstant(issuedAt, "capability issuedAt");
  const { privateKey, publicKey } = generateEd25519KeyPair();
  const capability = {
    schema: TASK_AUTHORITY_CAPABILITY_SCHEMA,
    authoritySubjectId,
    proofAdapterId: TASK_AUTHORITY_PROOF_ADAPTER,
    generation,
    publicKey,
    privateKey,
    issuedAt,
  };
  return Object.freeze(normalizeTaskAuthorityCapability(capability));
}

export function normalizeTaskAuthorityCapability(value) {
  const source = requireObject(value, "task authority capability");
  requireExactKeys(source, [
    "authoritySubjectId",
    "generation",
    "issuedAt",
    "privateKey",
    "proofAdapterId",
    "publicKey",
    "schema",
  ], "task authority capability");
  if (source.schema !== TASK_AUTHORITY_CAPABILITY_SCHEMA) {
    throw new Error("Unsupported task authority capability schema.");
  }
  requireSubject(source.authoritySubjectId);
  requireGeneration(source.generation);
  requireInstant(source.issuedAt, "capability issuedAt");
  if (source.proofAdapterId !== TASK_AUTHORITY_PROOF_ADAPTER) {
    throw new Error("Unsupported task authority proof adapter.");
  }
  const privateKey = normalizePrivateKey(source.privateKey);
  const publicKey = normalizePublicKey(source.publicKey);
  const derivedPublicKey = exportPublicKey(createPublicKey(createPrivateKey(privateKey)));
  if (derivedPublicKey !== publicKey) {
    throw new Error("Task authority private key does not match its public key.");
  }
  return {
    schema: TASK_AUTHORITY_CAPABILITY_SCHEMA,
    authoritySubjectId: source.authoritySubjectId,
    proofAdapterId: TASK_AUTHORITY_PROOF_ADAPTER,
    generation: source.generation,
    publicKey,
    privateKey,
    issuedAt: source.issuedAt,
  };
}

export function projectTaskAuthorityCapability(value) {
  const capability = normalizeTaskAuthorityCapability(value);
  return Object.freeze({
    authoritySubjectId: capability.authoritySubjectId,
    proofAdapterId: capability.proofAdapterId,
    generation: capability.generation,
    publicKey: capability.publicKey,
    publicKeyDigest: digestValue(capability.publicKey),
  });
}

export function createTaskAuthorityBinding({
  capability,
  lease,
  bindingMode = "claim",
  boundAt = new Date().toISOString(),
  transitionPlanDigest = null,
  priorBindingDigest = null,
}) {
  const projected = projectTaskAuthorityCapability(capability);
  const lane = normalizeStableLaneIdentity(lease);
  requireInstant(boundAt, "task authority boundAt");
  if (!TASK_AUTHORITY_BINDING_MODES.includes(bindingMode)) {
    throw new Error("Task authority binding mode is invalid.");
  }
  if (bindingMode === "claim" && (transitionPlanDigest || priorBindingDigest)) {
    throw new Error("Claim binding cannot carry transition evidence.");
  }
  if (PLANNED_BINDING_MODES.includes(bindingMode)) {
    requireDigest(transitionPlanDigest, "transition plan digest");
  } else if (transitionPlanDigest !== null) {
    throw new Error("Claim continuation cannot carry a transition plan digest.");
  }
  if (PRIOR_BOUND_BINDING_MODES.includes(bindingMode)) {
    requireDigest(priorBindingDigest, "prior binding digest");
  } else if (priorBindingDigest !== null) {
    throw new Error("Only continuation, handoff, or rebind may carry a prior binding digest.");
  }
  const core = {
    schema: TASK_AUTHORITY_BINDING_SCHEMA,
    ...projected,
    laneBindingDigest: digestValue(lane),
    bindingMode,
    boundAt,
    transitionPlanDigest,
    priorBindingDigest,
  };
  return Object.freeze({ ...core, bindingDigest: digestValue(core) });
}

export function normalizeTaskAuthorityBinding(value) {
  if (value === undefined || value === null) return null;
  const source = requireObject(value, "task authority binding");
  requireExactKeys(source, [
    "authoritySubjectId",
    "bindingDigest",
    "bindingMode",
    "boundAt",
    "generation",
    "laneBindingDigest",
    "priorBindingDigest",
    "proofAdapterId",
    "publicKey",
    "publicKeyDigest",
    "schema",
    "transitionPlanDigest",
  ], "task authority binding");
  if (source.schema !== TASK_AUTHORITY_BINDING_SCHEMA) {
    throw new Error("Unsupported task authority binding schema.");
  }
  requireSubject(source.authoritySubjectId);
  requireGeneration(source.generation);
  requireInstant(source.boundAt, "task authority boundAt");
  if (source.proofAdapterId !== TASK_AUTHORITY_PROOF_ADAPTER) {
    throw new Error("Unsupported task authority proof adapter.");
  }
  const publicKey = normalizePublicKey(source.publicKey);
  requireDigest(source.publicKeyDigest, "public key digest");
  requireDigest(source.laneBindingDigest, "lane binding digest");
  requireDigest(source.bindingDigest, "binding digest");
  if (!TASK_AUTHORITY_BINDING_MODES.includes(source.bindingMode)) {
    throw new Error("Task authority binding mode is invalid.");
  }
  if (source.bindingMode === "claim") {
    if (source.transitionPlanDigest !== null || source.priorBindingDigest !== null) {
      throw new Error("Claim binding cannot carry transition evidence.");
    }
  } else if (PLANNED_BINDING_MODES.includes(source.bindingMode)) {
    requireDigest(source.transitionPlanDigest, "transition plan digest");
  } else if (source.transitionPlanDigest !== null) {
    throw new Error("Claim continuation cannot carry a transition plan digest.");
  }
  if (PRIOR_BOUND_BINDING_MODES.includes(source.bindingMode)) {
    requireDigest(source.priorBindingDigest, "prior binding digest");
  } else if (source.priorBindingDigest !== null) {
    throw new Error("Only continuation, handoff, or rebind may carry a prior binding digest.");
  }
  const normalized = {
    schema: TASK_AUTHORITY_BINDING_SCHEMA,
    authoritySubjectId: source.authoritySubjectId,
    proofAdapterId: TASK_AUTHORITY_PROOF_ADAPTER,
    generation: source.generation,
    publicKey,
    publicKeyDigest: source.publicKeyDigest,
    laneBindingDigest: source.laneBindingDigest,
    bindingMode: source.bindingMode,
    boundAt: source.boundAt,
    transitionPlanDigest: source.transitionPlanDigest,
    priorBindingDigest: source.priorBindingDigest,
  };
  if (digestValue(publicKey) !== normalized.publicKeyDigest) {
    throw new Error("Task authority public key digest drifted.");
  }
  if (digestValue(normalized) !== source.bindingDigest) {
    throw new Error("Task authority binding digest drifted.");
  }
  return { ...normalized, bindingDigest: source.bindingDigest };
}

// Bindings issued before the stable-identity narrowing carry a digest over the
// full lane identity. They stay valid while their lane is unchanged, so no
// already-bound lease is invalidated by this contract; once such a lane moves,
// the binding is legacy-shaped and drifted, and `rebind` is its exit.
export function taskAuthorityLaneBindingShape({ binding, lease }) {
  const normalized = normalizeTaskAuthorityBinding(binding);
  if (!normalized) return "unbound";
  if (normalized.laneBindingDigest === digestValue(normalizeStableLaneIdentity(lease))) {
    return "stable";
  }
  if (normalized.laneBindingDigest === digestValue(normalizeLaneIdentity(lease))) {
    return "legacy";
  }
  return "drifted";
}

export function assertTaskAuthorityBinding({ binding, lease }) {
  const normalized = normalizeTaskAuthorityBinding(binding);
  if (!normalized) throw new Error("Task-bound lane authority is not bound.");
  if (taskAuthorityLaneBindingShape({ binding: normalized, lease }) === "drifted") {
    throw new Error(
      "Task authority binding does not match the writer lease lane; "
      + "plan and run a task-bound-lane-rebind to re-anchor this subject.",
    );
  }
  return normalized;
}

export function createTaskAuthorityProof({
  capability,
  binding,
  lease,
  operation,
  issuedAt = new Date().toISOString(),
  nonce = randomBytes(32).toString("hex"),
}) {
  const privateCapability = normalizeTaskAuthorityCapability(capability);
  const normalizedBinding = assertTaskAuthorityBinding({ binding, lease });
  assertCapabilityMatchesBinding(privateCapability, normalizedBinding);
  const challenge = normalizeProofChallenge({
    operation,
    bindingDigest: normalizedBinding.bindingDigest,
    leaseDigest: digestValue(normalizeLeaseProofSubject(lease)),
    issuedAt,
    nonce,
  });
  const signature = sign(
    null,
    Buffer.from(canonicalJson(challenge)),
    createPrivateKey(privateCapability.privateKey),
  ).toString("base64");
  return Object.freeze({
    schema: TASK_AUTHORITY_PROOF_SCHEMA,
    authoritySubjectId: normalizedBinding.authoritySubjectId,
    proofAdapterId: normalizedBinding.proofAdapterId,
    generation: normalizedBinding.generation,
    challenge,
    signature,
    proofDigest: digestValue({ challenge, signature }),
  });
}

export function verifyTaskAuthorityProof({
  proof,
  binding,
  lease,
  operation,
  now = new Date(),
  maximumAgeMs = 60_000,
  consumedProofDigests = null,
}) {
  const normalizedBinding = assertTaskAuthorityBinding({ binding, lease });
  const source = requireObject(proof, "task authority proof");
  requireExactKeys(source, [
    "authoritySubjectId",
    "challenge",
    "generation",
    "proofAdapterId",
    "proofDigest",
    "schema",
    "signature",
  ], "task authority proof");
  if (source.schema !== TASK_AUTHORITY_PROOF_SCHEMA) {
    throw new Error("Unsupported task authority proof schema.");
  }
  const challenge = normalizeProofChallenge(source.challenge);
  if (
    source.authoritySubjectId !== normalizedBinding.authoritySubjectId
    || source.proofAdapterId !== normalizedBinding.proofAdapterId
    || source.generation !== normalizedBinding.generation
    || challenge.operation !== operation
    || challenge.bindingDigest !== normalizedBinding.bindingDigest
    || challenge.leaseDigest !== digestValue(normalizeLeaseProofSubject(lease))
  ) {
    throw new Error("Task authority proof changed its bound mutation subject.");
  }
  const proofDigest = digestValue({ challenge, signature: source.signature });
  if (source.proofDigest !== proofDigest) throw new Error("Task authority proof digest drifted.");
  const age = now.getTime() - Date.parse(challenge.issuedAt);
  if (!Number.isFinite(age) || age < 0 || age > maximumAgeMs) {
    throw new Error("Task authority proof is outside its freshness window.");
  }
  if (consumedProofDigests?.has(proofDigest)) {
    throw new Error("Task authority proof replay is forbidden.");
  }
  const verified = verify(
    null,
    Buffer.from(canonicalJson(challenge)),
    createPublicKey({ key: Buffer.from(normalizedBinding.publicKey, "base64"), format: "der", type: "spki" }),
    Buffer.from(requiredText(source.signature, "proof signature"), "base64"),
  );
  if (!verified) throw new Error("Task authority proof signature is invalid.");
  consumedProofDigests?.add(proofDigest);
  return Object.freeze({ binding: normalizedBinding, proofDigest, challenge });
}

export function createTaskAuthorityTransitionPlan({
  operation,
  lease,
  headSha,
  worktreeStateDigest,
  targetCapability,
  currentBinding = null,
  plannedAt = new Date().toISOString(),
}) {
  if (!TASK_AUTHORITY_TRANSITION_OPERATIONS.includes(operation)) {
    throw new Error("Task authority transition operation is invalid.");
  }
  requireSha(headSha, "transition head SHA");
  requireDigest(worktreeStateDigest, "worktree state digest");
  requireInstant(plannedAt, "transition plannedAt");
  const target = projectTaskAuthorityCapability(targetCapability);
  const normalizedCurrent = normalizeTaskAuthorityBinding(currentBinding);
  if (operation === "migration" && normalizedCurrent) {
    throw new Error("Migration requires an unbound writer lease.");
  }
  // Rebind re-anchors the same subject, so it must not become a silent handoff:
  // the target has to be the identical authority at the identical generation.
  if (operation === "rebind") {
    if (!normalizedCurrent) throw new Error("Rebind requires current task authority.");
    if (target.authoritySubjectId !== normalizedCurrent.authoritySubjectId) {
      throw new Error("Rebind target must be the same authority subject.");
    }
    if (target.generation !== normalizedCurrent.generation) {
      throw new Error("Rebind target generation must not advance.");
    }
    if (target.publicKeyDigest !== normalizedCurrent.publicKeyDigest) {
      throw new Error("Rebind target must present the bound public key.");
    }
  }
  if (operation === "handoff") {
    if (!normalizedCurrent) throw new Error("Handoff requires current task authority.");
    if (target.generation !== normalizedCurrent.generation + 1) {
      throw new Error("Handoff target generation must advance exactly once.");
    }
    if (target.authoritySubjectId === normalizedCurrent.authoritySubjectId) {
      throw new Error("Handoff target must be a distinct authority subject.");
    }
  }
  const core = {
    schema: TASK_AUTHORITY_TRANSITION_PLAN_SCHEMA,
    operation,
    lane: normalizeLaneIdentity(lease),
    leaseDigest: digestValue(normalizeLeaseProofSubject(lease)),
    headSha,
    worktreeStateDigest,
    currentBindingDigest: normalizedCurrent?.bindingDigest || null,
    target,
    plannedAt,
  };
  const planDigest = digestValue(core);
  return Object.freeze({
    ...core,
    planDigest,
    exactAuthorization: `authorize task-bound-lane-${operation} ${planDigest}`,
  });
}

export function assertCapabilityMatchesBinding(capability, binding) {
  const projected = projectTaskAuthorityCapability(capability);
  const normalized = normalizeTaskAuthorityBinding(binding);
  if (
    projected.authoritySubjectId !== normalized.authoritySubjectId
    || projected.proofAdapterId !== normalized.proofAdapterId
    || projected.generation !== normalized.generation
    || projected.publicKeyDigest !== normalized.publicKeyDigest
    || projected.publicKey !== normalized.publicKey
  ) {
    throw new Error("Capability does not own the task authority binding.");
  }
  return projected;
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function generateEd25519KeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKey: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKey: exportPublicKey(publicKey),
  };
}

function exportPublicKey(key) {
  return key.export({ format: "der", type: "spki" }).toString("base64");
}

function normalizePrivateKey(value) {
  const text = typeof value === "string" ? value : "";
  if (!text.startsWith("-----BEGIN PRIVATE KEY-----")) {
    throw new Error("Task authority private key is invalid.");
  }
  const key = createPrivateKey(text);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("Task authority key must be Ed25519.");
  return key.export({ format: "pem", type: "pkcs8" }).toString();
}

function normalizePublicKey(value) {
  const text = requiredText(value, "public key");
  const key = createPublicKey({ key: Buffer.from(text, "base64"), format: "der", type: "spki" });
  if (key.asymmetricKeyType !== "ed25519") throw new Error("Task authority key must be Ed25519.");
  return exportPublicKey(key);
}

// The durable binding covers only what the lane lifecycle never changes. `epoch`
// advances on renewal, `baseSha` moves when canonical moves, and `cloudClaimId`
// changes whenever a claim is re-minted, so a write-once digest over those three
// is invalidated by ordinary lane progress and strands the lease. They stay
// bound, but per operation: normalizeLeaseProofSubject re-covers the full lane
// identity in every proof challenge, so narrowing here removes no coverage.
export function normalizeStableLaneIdentity(lease) {
  const source = requireObject(lease, "writer lease");
  const lane = {
    branch: requiredText(source.branch, "lease branch"),
    scope: requiredText(source.scope, "lease scope"),
    device: requiredText(source.device, "lease device"),
  };
  if (!BRANCH_PATTERN.test(lane.branch)) throw new Error("Task authority lease branch is invalid.");
  return lane;
}

function normalizeLaneIdentity(lease) {
  const source = requireObject(lease, "writer lease");
  const lane = {
    ...normalizeStableLaneIdentity(lease),
    epoch: requireGeneration(source.epoch),
    baseSha: requireSha(source.baseSha, "lease base SHA"),
    cloudClaimId: source.cloudAuthority?.claimId || null,
  };
  if (lane.cloudClaimId !== null) requireDigest(lane.cloudClaimId, "cloud claim id");
  return lane;
}

function normalizeLeaseProofSubject(lease) {
  const lane = normalizeLaneIdentity(lease);
  return {
    ...lane,
    status: requiredText(lease.status, "lease status"),
    fenceSha: lease.fenceSha === null ? null : requireSha(lease.fenceSha, "lease fence SHA"),
    taskAuthorityBindingDigest: lease.taskAuthority?.bindingDigest || null,
  };
}

function normalizeProofChallenge(value) {
  const source = requireObject(value, "task authority challenge");
  const challenge = {
    operation: requiredText(source.operation, "proof operation"),
    bindingDigest: requireDigest(source.bindingDigest, "proof binding digest"),
    leaseDigest: requireDigest(source.leaseDigest, "proof lease digest"),
    issuedAt: requireInstant(source.issuedAt, "proof issuedAt"),
    nonce: requiredHex(source.nonce, 64, "proof nonce"),
  };
  requireExactKeys(source, Object.keys(challenge), "task authority challenge");
  return challenge;
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function requireExactKeys(value, expected, label) {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error(`${label} fields are invalid.`);
  }
}

function requireText(value, label) {
  const text = String(value || "");
  if (!text || text.trim() !== text) throw new Error(`${label} is required.`);
  return text;
}

function requiredText(value, label) {
  return requireText(value, label);
}

function requireSubject(value) {
  if (!SUBJECT_PATTERN.test(String(value || ""))) {
    throw new Error("Task authority subject must be an opaque task URN.");
  }
  return value;
}

function requireGeneration(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("Task authority generation must be a positive safe integer.");
  }
  return value;
}

function requireDigest(value, label) {
  if (!DIGEST_PATTERN.test(String(value || ""))) throw new Error(`${label} must be a SHA-256 digest.`);
  return value;
}

function requireSha(value, label) {
  if (!SHA_PATTERN.test(String(value || ""))) throw new Error(`${label} must be a Git SHA.`);
  return value;
}

function requireInstant(value, label) {
  if (typeof value !== "string" || new Date(value).toISOString() !== value) {
    throw new Error(`${label} must be canonical ISO UTC.`);
  }
  return value;
}

function requiredHex(value, length, label) {
  if (!new RegExp(`^[0-9a-f]{${length}}$`, "u").test(String(value || ""))) {
    throw new Error(`${label} must be ${length} lowercase hexadecimal characters.`);
  }
  return value;
}
