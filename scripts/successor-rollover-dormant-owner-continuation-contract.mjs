// Responsibility: Seal one exact same-owner continuation after waiting-bridge promotion.
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";

export const OPERATION = "successor-rollover-dormant-owner-continuation";
export const PLAN_SCHEMA = `agentic-${OPERATION}-plan/v1`;
export const AUTHORIZATION_SCHEMA = `agentic-${OPERATION}-authorization/v1`;
export const JOURNAL_SCHEMA = `agentic-${OPERATION}-journal/v1`;
export const RESULT_SCHEMA = `agentic-${OPERATION}-result/v1`;
export const PHASES = Object.freeze([
  "authorized", "task-authority-verified", "cloud-recovered",
  "local-cas", "pr-marker", "verified", "complete",
]);

const DIGEST = /^[0-9a-f]{64}$/u;

export function buildDormantOwnerContinuationPlan({ evidence, ttlSeconds = 1_800 } = {}) {
  const sealedEvidence = evidenceObject(evidence);
  const ttl = integer(ttlSeconds, "TTL seconds");
  if (ttl < 60 || ttl > 86_400) invalid("TTL bounds");
  const core = {
    schema: PLAN_SCHEMA,
    operation: OPERATION,
    branch: text(sealedEvidence.source.branch, "source branch"),
    sessionId: text(sealedEvidence.source.sessionId, "source session"),
    claimId: digest(sealedEvidence.source.claimId, "source claim ID"),
    sourceLeaseDigest: digest(sealedEvidence.source.leaseDigest, "source lease digest"),
    sourceClaimDigest: digest(sealedEvidence.source.claimDigest, "source claim digest"),
    sourceTransitionCounter: integer(
      sealedEvidence.source.transitionCounter,
      "source transition counter",
    ),
    sourceFenceSha: sha(sealedEvidence.source.fenceSha, "source fence"),
    sourceBaseSha: sha(sealedEvidence.source.baseSha, "source base"),
    writeSetDigest: digest(sealedEvidence.source.writeSetDigest, "write-set digest"),
    manifestDigest: digest(sealedEvidence.source.manifestDigest, "manifest digest"),
    reviewRequestId: text(sealedEvidence.source.reviewRequestId, "review request"),
    evidenceDigest: sealedEvidence.evidenceDigest,
    evidenceSnapshot: sealedEvidence,
    ttlSeconds: ttl,
    allowedEffects: [
      "same-claim-dormant-recovery",
      "atomic-local-lease-continuation",
      "exact-pull-request-marker-replacement",
      "private-external-journal",
    ],
    forbiddenEffects: [
      "new-claim", "claim-retirement", "claim-promotion", "source-change",
      "git-ref-change", "commit", "push", "merge", "deployment", "cleanup",
      "rollover-tombstone-change", "pull-request-state-change",
    ],
  };
  const planDigest = digestValue(core);
  return deepFreeze({
    ...core,
    planDigest,
    exactAuthorization: `authorize ${OPERATION} ${planDigest}`,
  });
}

export function normalizeDormantOwnerContinuationPlan(value) {
  if (value?.schema !== PLAN_SCHEMA || value.operation !== OPERATION) invalid("plan schema");
  const rebuilt = buildDormantOwnerContinuationPlan({
    evidence: value.evidenceSnapshot,
    ttlSeconds: value.ttlSeconds,
  });
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("plan projection");
  return rebuilt;
}

export function authorizeDormantOwnerContinuation({ plan, authorization } = {}) {
  const sealed = normalizeDormantOwnerContinuationPlan(plan);
  if (authorization !== sealed.exactAuthorization) {
    throw new Error(`Dormant-owner continuation requires exact authorization: ${sealed.exactAuthorization}`);
  }
  const core = {
    schema: AUTHORIZATION_SCHEMA,
    operation: OPERATION,
    planDigest: sealed.planDigest,
    statement: authorization,
  };
  return deepFreeze({ ...core, authorizationDigest: digestValue(core) });
}

export function createDormantOwnerContinuationJournal(plan, authorization) {
  const sealed = normalizeDormantOwnerContinuationPlan(plan);
  const authorized = authorizeDormantOwnerContinuation({ plan: sealed, authorization });
  return sealJournal({
    schema: JOURNAL_SCHEMA,
    plan: sealed,
    phase: "authorized",
    receipts: {
      authorized: phaseReceipt(sealed, "authorized", {
        authorizationDigest: authorized.authorizationDigest,
      }),
    },
  });
}

export function advanceDormantOwnerContinuationJournal(journal, phase, values) {
  const current = normalizeDormantOwnerContinuationJournal(journal);
  if (PHASES.indexOf(phase) !== PHASES.indexOf(current.phase) + 1) {
    throw new Error(`Dormant-owner continuation cannot advance from ${current.phase} to ${phase}.`);
  }
  return sealJournal({
    schema: JOURNAL_SCHEMA,
    plan: current.plan,
    phase,
    receipts: {
      ...current.receipts,
      [phase]: phaseReceipt(current.plan, phase, values, current.receipts[current.phase]),
    },
  });
}

export function normalizeDormantOwnerContinuationJournal(value) {
  if (value?.schema !== JOURNAL_SCHEMA || !PHASES.includes(value.phase)) invalid("journal schema");
  const plan = normalizeDormantOwnerContinuationPlan(value.plan);
  const receipts = {};
  const last = PHASES.indexOf(value.phase);
  for (let index = 0; index <= last; index += 1) {
    const phase = PHASES[index];
    receipts[phase] = normalizePhaseReceipt(
      plan,
      phase,
      value.receipts?.[phase],
      index ? receipts[PHASES[index - 1]] : null,
    );
  }
  if (Object.keys(value.receipts || {}).length !== Object.keys(receipts).length) {
    invalid("journal receipt ordering");
  }
  return sealJournal({ schema: JOURNAL_SCHEMA, plan, phase: value.phase, receipts }, value);
}

export function buildDormantOwnerContinuationResult(journal) {
  const current = normalizeDormantOwnerContinuationJournal(journal);
  if (current.phase !== "complete") invalid("terminal journal");
  const verified = current.receipts.verified.values;
  const core = {
    schema: RESULT_SCHEMA,
    status: "authoring-authority-restored",
    operation: OPERATION,
    planDigest: current.plan.planDigest,
    claimId: current.plan.claimId,
    leaseDigest: digest(verified.leaseDigest, "verified lease digest"),
    claimDigest: digest(verified.claimDigest, "verified claim digest"),
    pullRequestMarkerDigest: digest(
      verified.pullRequestMarkerDigest,
      "verified pull-request marker digest",
    ),
    tombstoneDigest: current.plan.evidenceSnapshot.rollover.tombstoneDigest,
    journalDigest: current.journalDigest,
    forbiddenEffects: current.plan.forbiddenEffects,
  };
  return deepFreeze({ ...core, resultDigest: digestValue(core) });
}

function phaseReceipt(plan, phase, values, prior = null) {
  const core = {
    schema: `agentic-${OPERATION}-phase/v1`,
    phase,
    planDigest: plan.planDigest,
    priorReceiptDigest: prior?.receiptDigest ?? null,
    values: exactValues(phase, values),
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function normalizePhaseReceipt(plan, phase, value, prior) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${phase} receipt`);
  const rebuilt = phaseReceipt(plan, phase, value.values, prior);
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid(`${phase} receipt seal`);
  return rebuilt;
}

function exactValues(phase, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${phase} values`);
  const keys = {
    authorized: ["authorizationDigest"],
    "task-authority-verified": ["taskAuthorityReceiptDigest"],
    "cloud-recovered": ["claimDigest", "cloudReceiptDigest", "expiresAt"],
    "local-cas": ["leaseDigest", "registryRevision", "taskAuthorityBindingDigest"],
    "pr-marker": ["bodyDigest", "pullRequestMarkerDigest"],
    verified: ["claimDigest", "leaseDigest", "pullRequestMarkerDigest", "verificationDigest"],
    complete: ["completionDigest"],
  }[phase];
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) {
    invalid(`${phase} values fields`);
  }
  for (const [key, member] of Object.entries(value)) {
    if (key.endsWith("Digest")) digest(member, `${phase} ${key}`);
  }
  if (phase === "cloud-recovered") text(value.expiresAt, "cloud expiry");
  if (phase === "local-cas") integer(value.registryRevision, "registry revision");
  return deepFreeze(structuredClone(value));
}

function sealJournal(core, expected = null) {
  const journalDigest = digestValue(core);
  const sealed = deepFreeze({ ...core, journalDigest });
  if (expected && canonicalJson(expected) !== canonicalJson(sealed)) invalid("journal seal");
  return sealed;
}

function evidenceObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.schema !== `agentic-${OPERATION}-evidence/v1`
    || value.evidenceDigest !== digestValue(Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== "evidenceDigest"),
    ))) invalid("evidence seal");
  return deepFreeze(structuredClone(value));
}

function text(value, label) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) invalid(label);
  return value;
}
function digest(value, label) { if (!DIGEST.test(String(value || ""))) invalid(label); return value; }
function sha(value, label) { if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) invalid(label); return value; }
function integer(value, label) { if (!Number.isSafeInteger(value) || value < 1) invalid(label); return value; }
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze); Object.freeze(value);
  }
  return value;
}
function invalid(label) { throw new Error(`Invalid dormant-owner continuation ${label}.`); }
