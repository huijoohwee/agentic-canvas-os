// Responsibility: Decide provider-neutral early recovery eligibility from fenced operation evidence.
import { digestValue } from "./cloud-collaboration-primitives.mjs";

export const ADAPTIVE_RECOVERY_EVIDENCE_SCHEMA =
  "agentic-adaptive-claim-recovery-evidence/v1";
export const ADAPTIVE_RECOVERY_DECISION_SCHEMA =
  "agentic-adaptive-claim-recovery-decision/v1";

const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const CLAIM_STATES = new Set(["integrated-preserved", "dormant-preserved"]);
const OPERATION_STATES = new Set(["running", "terminal", "revoked", "unknown"]);
const OPERATION_CONCLUSIONS = new Set(["failed", "cancelled", "superseded", "succeeded"]);
const RECOVERABLE_CONCLUSIONS = new Set(["failed", "cancelled", "superseded"]);

export function buildAdaptiveClaimRecoveryDecision(input = {}) {
  const evidence = normalizeEvidence({
    schema: ADAPTIVE_RECOVERY_EVIDENCE_SCHEMA,
    subject: input.subject,
    claim: input.claim,
    operation: input.operation,
    observation: input.observation,
  });
  return decide(evidence);
}

export function normalizeAdaptiveClaimRecoveryDecision(value) {
  if (value?.schema !== ADAPTIVE_RECOVERY_DECISION_SCHEMA) invalid("decision schema");
  const rebuilt = decide(normalizeEvidence(value.evidence));
  exact(value, Object.keys(rebuilt), "decision");
  if (JSON.stringify(value) !== JSON.stringify(rebuilt)) invalid("decision projection");
  return rebuilt;
}

function normalizeEvidence(value) {
  if (value?.schema !== ADAPTIVE_RECOVERY_EVIDENCE_SCHEMA) invalid("evidence schema");
  exact(value, ["schema", "subject", "claim", "operation", "observation"], "evidence");
  return freeze({
    schema: ADAPTIVE_RECOVERY_EVIDENCE_SCHEMA,
    subject: subject(value.subject),
    claim: claim(value.claim),
    operation: operation(value.operation),
    observation: observation(value.observation),
  });
}

function subject(value) {
  const result = {
    repositoryId: text(value?.repositoryId, "subject repository"),
    workItemId: text(value?.workItemId, "subject work item"),
    candidateHeadSha: sha(value?.candidateHeadSha, "subject candidate"),
    protectedMainSha: sha(value?.protectedMainSha, "subject protected main"),
  };
  exact(value, Object.keys(result), "subject");
  return freeze(result);
}

function claim(value) {
  const result = {
    claimId: digest(value?.claimId, "claim ID"),
    state: CLAIM_STATES.has(value?.state) ? value.state : invalid("claim state"),
    writeAuthority: boolean(value?.writeAuthority, "claim write authority"),
    scopeReserved: boolean(value?.scopeReserved, "claim scope reservation"),
    fenceRevision: digest(value?.fenceRevision, "claim fence"),
    transitionCounter: integer(value?.transitionCounter, "claim transition"),
    heartbeatCounter: nonnegativeInteger(value?.heartbeatCounter, "claim heartbeat counter"),
    heartbeatAt: nullableInstant(value?.heartbeatAt, "claim heartbeat"),
    expiresAt: instant(value?.expiresAt, "claim expiry"),
  };
  exact(value, Object.keys(result), "claim");
  return freeze(result);
}

function operation(value) {
  const state = OPERATION_STATES.has(value?.state) ? value.state : invalid("operation state");
  const conclusion = value?.conclusion === null ? null
    : OPERATION_CONCLUSIONS.has(value?.conclusion) ? value.conclusion
      : invalid("operation conclusion");
  const result = {
    operationId: text(value?.operationId, "operation ID"),
    state,
    conclusion,
    immutable: boolean(value?.immutable, "operation immutability"),
    candidateHeadSha: sha(value?.candidateHeadSha, "operation candidate"),
    protectedMainSha: sha(value?.protectedMainSha, "operation protected main"),
    fenceRevision: digest(value?.fenceRevision, "operation fence"),
    generation: integer(value?.generation, "operation generation"),
    heartbeatAt: nullableInstant(value?.heartbeatAt, "operation heartbeat"),
    terminalAt: nullableInstant(value?.terminalAt, "operation terminal instant"),
    terminalReceiptDigest: nullableDigest(
      value?.terminalReceiptDigest,
      "operation terminal receipt",
    ),
    revokedAt: nullableInstant(value?.revokedAt, "operation revocation instant"),
    revocationReceiptDigest: nullableDigest(
      value?.revocationReceiptDigest,
      "operation revocation receipt",
    ),
    evidenceDigest: digest(value?.evidenceDigest, "operation evidence"),
  };
  exact(value, Object.keys(result), "operation");
  if (state === "terminal") {
    if (!conclusion || !result.terminalAt || !result.terminalReceiptDigest
      || result.revokedAt || result.revocationReceiptDigest) invalid("terminal operation proof");
  } else if (state === "revoked") {
    if (conclusion || !result.revokedAt || !result.revocationReceiptDigest
      || result.terminalAt || result.terminalReceiptDigest) invalid("revoked operation proof");
  } else if (conclusion || result.terminalAt || result.terminalReceiptDigest
    || result.revokedAt || result.revocationReceiptDigest) invalid("nonterminal operation proof");
  return freeze(result);
}

function observation(value) {
  const result = {
    observedAt: instant(value?.observedAt, "observation instant"),
    latestFenceRevision: digest(value?.latestFenceRevision, "observed fence"),
    latestTransitionCounter: integer(value?.latestTransitionCounter, "observed transition"),
    latestHeartbeatCounter: nonnegativeInteger(
      value?.latestHeartbeatCounter,
      "observed heartbeat counter",
    ),
    expectedHeartbeatSeconds: boundedInteger(
      value?.expectedHeartbeatSeconds,
      5,
      3_600,
      "expected heartbeat",
    ),
    missedHeartbeatTolerance: boundedInteger(
      value?.missedHeartbeatTolerance,
      1,
      10,
      "missed heartbeat tolerance",
    ),
  };
  exact(value, Object.keys(result), "observation");
  return freeze(result);
}

function decide(evidence) {
  const { subject: current, claim: owner, operation: prior, observation: observed } = evidence;
  const boundary = prior.state === "terminal" ? prior.terminalAt
    : prior.state === "revoked" ? prior.revokedAt : null;
  const facts = freeze({
    candidateIdentityUnchanged: prior.candidateHeadSha === current.candidateHeadSha,
    protectedMainIdentityUnchanged: prior.protectedMainSha === current.protectedMainSha,
    latestFenceMatches: observed.latestFenceRevision === owner.fenceRevision,
    latestGenerationMatches: observed.latestTransitionCounter === owner.transitionCounter,
    latestHeartbeatMatches: observed.latestHeartbeatCounter === owner.heartbeatCounter,
    fenceAdvanced: prior.fenceRevision !== owner.fenceRevision,
    generationAdvanced: owner.transitionCounter > prior.generation,
    noWriteAuthority: owner.writeAuthority === false,
    scopeReserved: owner.scopeReserved === true,
    noHeartbeatAfterTerminal: !boundary || [prior.heartbeatAt, owner.heartbeatAt]
      .filter(Boolean).every(value => Date.parse(value) <= Date.parse(boundary)),
    leaseExpired: Date.parse(observed.observedAt) >= Date.parse(owner.expiresAt),
  });
  const blocked = !facts.candidateIdentityUnchanged || !facts.protectedMainIdentityUnchanged
    || !facts.latestFenceMatches || !facts.latestGenerationMatches || !facts.latestHeartbeatMatches
    || !facts.noWriteAuthority || !facts.scopeReserved || !facts.noHeartbeatAfterTerminal;
  const terminal = prior.state === "terminal" && RECOVERABLE_CONCLUSIONS.has(prior.conclusion);
  const revoked = prior.state === "revoked";
  const fencedProof = prior.immutable && facts.fenceAdvanced && facts.generationAdvanced;
  let status = "wait";
  let reason = "operation-not-deterministically-terminal";
  if (blocked) {
    status = "blocked";
    reason = "identity-or-fence-drift";
  } else if (fencedProof && terminal) {
    status = "recoverable-now";
    reason = "terminal-operation-fenced";
  } else if (fencedProof && revoked) {
    status = "recoverable-now";
    reason = "revoked-operation-fenced";
  } else if (owner.state === "dormant-preserved" && facts.leaseExpired) {
    status = "recoverable-now";
    reason = "lease-expiry-fallback";
  } else if ((terminal || revoked) && !fencedProof) {
    reason = "terminal-operation-not-fenced";
  }
  const core = {
    schema: ADAPTIVE_RECOVERY_DECISION_SCHEMA,
    evidence,
    evidenceDigest: digestValue(evidence),
    status,
    reason,
    facts,
    recoveryGeneration: owner.transitionCounter,
    nextEvaluationAt: status === "wait" ? nextEvaluationAt(evidence) : null,
    mutationAuthority: false,
  };
  return freeze({ ...core, decisionDigest: digestValue(core) });
}

function nextEvaluationAt({ claim: owner, operation: prior, observation: observed }) {
  if (!prior.heartbeatAt) return owner.expiresAt;
  const livenessDeadline = Date.parse(prior.heartbeatAt)
    + observed.expectedHeartbeatSeconds * observed.missedHeartbeatTolerance * 1_000;
  const bounded = Math.min(Date.parse(owner.expiresAt), Math.max(
    Date.parse(observed.observedAt),
    livenessDeadline,
  ));
  return new Date(bounded).toISOString();
}

function exact(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) invalid(label);
}
function text(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim() || value.includes("\0")) {
    invalid(label);
  }
  return value;
}
function boolean(value, label) {
  if (typeof value !== "boolean") invalid(label);
  return value;
}
function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) invalid(label);
  return value;
}
function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) invalid(label);
  return value;
}
function boundedInteger(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) invalid(label);
  return value;
}
function sha(value, label) {
  if (typeof value !== "string" || !SHA.test(value)) invalid(label);
  return value;
}
function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) invalid(label);
  return value;
}
function nullableDigest(value, label) { return value === null ? null : digest(value, label); }
function instant(value, label) {
  if (typeof value !== "string" || new Date(value).toISOString() !== value) invalid(label);
  return value;
}
function nullableInstant(value, label) { return value === null ? null : instant(value, label); }
function freeze(value) {
  if (value && typeof value === "object") {
    for (const childValue of Object.values(value)) freeze(childValue);
    Object.freeze(value);
  }
  return value;
}
function invalid(label) { throw new Error(`Adaptive claim recovery ${label} is invalid.`); }
