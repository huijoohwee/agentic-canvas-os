// Responsibility: seal one exact replacement of authority lost after a merged delivery.
import { digestValue } from "./cloud-collaboration-primitives.mjs";

export const OPERATION = "merged-integrated-preserved-lost-task-authority-recovery";
export const EVIDENCE_SCHEMA = `agentic-${OPERATION}-evidence/v1`;
export const PLAN_SCHEMA = `agentic-${OPERATION}-plan/v1`;
export const JOURNAL_SCHEMA = `agentic-${OPERATION}-journal/v1`;
export const RESULT_SCHEMA = `agentic-${OPERATION}-result/v1`;

const DIGEST = /^[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40}$/u;
const SUBJECT = /^urn:agentic-task:[0-9a-f]{64}$/u;
const PHASES = Object.freeze([
  "prepared", "prechecked", "cas-attempted", "local-cas", "verified", "complete",
]);
const ALLOWED_EFFECTS = Object.freeze([
  "external-journal", "writer-lease-task-authority-cas",
]);
const FORBIDDEN_EFFECTS = Object.freeze([
  "source-byte-change", "index-change", "commit", "git-ref-change",
  "pull-request-change", "cloud-claim-change", "merge", "cleanup",
  "deployment", "runtime",
]);

export function buildMergedIntegratedPreservedLostAuthorityEvidence(value = {}) {
  const source = requireObject(value, "recovery evidence");
  if (source.schema !== EVIDENCE_SCHEMA) throw new Error("Unsupported merged authority evidence.");
  const target = requireObject(source.target, "target evidence");
  const binding = requireObject(source.sourceBinding, "source task authority binding");
  const mergedPullRequest = requireObject(source.mergedPullRequest, "merged pull request");
  const terminal = requireObject(source.integratedTerminal, "integrated terminal evidence");
  const delivery = requireObject(source.deliveryEvidence, "delivery evidence");
  requiredText(target.repository, "target repository");
  requiredText(target.branch, "target branch");
  requiredText(target.worktreePath, "target worktree path");
  requiredSha(target.headSha, "target HEAD");
  requiredSha(target.treeSha, "target tree");
  if (target.clean !== true || target.status !== "review_ready") {
    throw new Error("Recovery requires one clean review-ready target lease.");
  }
  requiredDigest(source.sourceLeaseDigest, "source lease digest");
  requiredDigest(source.claimId, "claim ID");
  requiredSha(source.reviewHeadSha, "review head SHA");
  if (!SUBJECT.test(String(binding.authoritySubjectId || ""))
    || !Number.isSafeInteger(binding.generation) || binding.generation < 1
    || !DIGEST.test(String(binding.bindingDigest || ""))) {
    throw new Error("Source task authority binding is invalid.");
  }
  if (mergedPullRequest.state !== "MERGED"
    || !Number.isSafeInteger(mergedPullRequest.number)
    || mergedPullRequest.number < 1
    || !SHA.test(String(mergedPullRequest.headSha || ""))
    || !SHA.test(String(mergedPullRequest.mergeCommitSha || ""))
    || !requiredInstant(mergedPullRequest.mergedAt, "merged pull request time")) {
    throw new Error("Recovery requires one exact merged pull request.");
  }
  if (terminal.state !== "pending"
    || !DIGEST.test(String(terminal.integrationEntryDigest || ""))
    || !DIGEST.test(String(terminal.integrationReceiptDigest || ""))
    || !DIGEST.test(String(terminal.ledgerDigest || ""))
    || !SHA.test(String(terminal.ledgerRevision || ""))
    || !DIGEST.test(String(terminal.runDigest || ""))) {
    throw new Error("Recovery requires one pending integrated-preserved terminal proof.");
  }
  for (const field of [
    "dependencyClosureDigest", "namedChecksDigest", "handoffEvidenceDigest",
    "operatorDecisionDigest", "integrationIntentDigest",
  ]) requiredDigest(delivery[field], `delivery evidence ${field}`);
  const core = {
    schema: EVIDENCE_SCHEMA,
    target: {
      repository: target.repository,
      branch: target.branch,
      worktreePath: target.worktreePath,
      headSha: target.headSha,
      treeSha: target.treeSha,
      clean: true,
      status: "review_ready",
    },
    sourceLeaseDigest: source.sourceLeaseDigest,
    claimId: source.claimId,
    reviewHeadSha: source.reviewHeadSha,
    sourceBinding: structuredClone(binding),
    mergedPullRequest: {
      state: "MERGED",
      number: mergedPullRequest.number,
      id: requiredText(mergedPullRequest.id, "merged pull request ID"),
      url: requiredText(mergedPullRequest.url, "merged pull request URL"),
      branch: requiredText(mergedPullRequest.branch, "merged pull request branch"),
      headSha: mergedPullRequest.headSha,
      mergeCommitSha: mergedPullRequest.mergeCommitSha,
      mergedAt: requiredInstant(mergedPullRequest.mergedAt, "merged pull request time"),
    },
    protectedMainRefresh: source.protectedMainRefresh === null
      ? null : structuredClone(requireObject(source.protectedMainRefresh, "protected-main refresh")),
    deliveryEvidence: {
      dependencyClosureDigest: delivery.dependencyClosureDigest,
      namedChecksDigest: delivery.namedChecksDigest,
      handoffEvidenceDigest: delivery.handoffEvidenceDigest,
      operatorDecisionDigest: delivery.operatorDecisionDigest,
      integrationIntentDigest: delivery.integrationIntentDigest,
    },
    integratedTerminal: {
      state: "pending",
      integrationEntryDigest: terminal.integrationEntryDigest,
      integrationReceiptDigest: terminal.integrationReceiptDigest,
      ledgerDigest: terminal.ledgerDigest,
      ledgerRevision: terminal.ledgerRevision,
      runDigest: terminal.runDigest,
      currentClaimDigest: requiredDigest(terminal.currentClaimDigest, "current claim digest"),
      transitionCounter: positiveInteger(terminal.transitionCounter, "terminal transition counter"),
      subjectDigest: requiredDigest(terminal.subjectDigest, "merged subject digest"),
    },
  };
  return Object.freeze({ ...core, evidenceDigest: digestValue(core) });
}

export function buildMergedIntegratedPreservedLostAuthorityPlan({
  evidence,
  targetCapability,
  plannedAt = new Date().toISOString(),
} = {}) {
  const source = buildMergedIntegratedPreservedLostAuthorityEvidence(evidence);
  const capability = normalizeCapabilityProjection(targetCapability);
  if (capability.authoritySubjectId === source.sourceBinding.authoritySubjectId) {
    throw new Error("Replacement task authority requires a distinct subject.");
  }
  if (capability.generation !== source.sourceBinding.generation + 1) {
    throw new Error("Replacement task authority must advance exactly one generation.");
  }
  const core = {
    schema: PLAN_SCHEMA,
    operation: OPERATION,
    evidence: source,
    targetCapability: capability,
    plannedAt: requiredInstant(plannedAt, "plannedAt"),
    allowedEffects: [...ALLOWED_EFFECTS],
    forbiddenEffects: [...FORBIDDEN_EFFECTS],
  };
  const planDigest = digestValue(core);
  return Object.freeze({
    ...core,
    planDigest,
    exactAuthorization: `authorize ${OPERATION} ${planDigest}`,
  });
}

export function normalizeMergedIntegratedPreservedLostAuthorityPlan(value) {
  const plan = requireObject(value, "recovery plan");
  if (plan.schema !== PLAN_SCHEMA || plan.operation !== OPERATION) {
    throw new Error("Unsupported merged authority recovery plan.");
  }
  const normalized = buildMergedIntegratedPreservedLostAuthorityPlan({
    evidence: plan.evidence,
    targetCapability: plan.targetCapability,
    plannedAt: plan.plannedAt,
  });
  if (plan.planDigest !== normalized.planDigest
    || plan.exactAuthorization !== normalized.exactAuthorization
    || JSON.stringify(plan.allowedEffects) !== JSON.stringify(normalized.allowedEffects)
    || JSON.stringify(plan.forbiddenEffects) !== JSON.stringify(normalized.forbiddenEffects)) {
    throw new Error("Merged authority recovery plan drifted.");
  }
  return normalized;
}

export function authorizeMergedIntegratedPreservedLostAuthority(plan, authorization) {
  const normalized = normalizeMergedIntegratedPreservedLostAuthorityPlan(plan);
  if (authorization !== normalized.exactAuthorization) {
    throw new Error("Merged authority recovery requires its exact authorization.");
  }
  return Object.freeze({
    schema: `agentic-${OPERATION}-authorization/v1`,
    planDigest: normalized.planDigest,
    authorizationDigest: digestValue(authorization),
  });
}

export function createMergedIntegratedPreservedLostAuthorityJournal({ plan, authorization }) {
  const normalized = normalizeMergedIntegratedPreservedLostAuthorityPlan(plan);
  const decision = authorizeMergedIntegratedPreservedLostAuthority(normalized, authorization);
  const core = {
    schema: JOURNAL_SCHEMA,
    status: "in-progress",
    phase: "prepared",
    planDigest: normalized.planDigest,
    authorizationDigest: decision.authorizationDigest,
    planSnapshot: normalized,
    exactAuthorization: authorization,
    receipts: {},
    targetBindingDigest: null,
    result: null,
  };
  return Object.freeze({ ...core, journalDigest: digestValue(core) });
}

export function advanceMergedIntegratedPreservedLostAuthorityJournal(journal, phase, values = {}) {
  const current = normalizeMergedIntegratedPreservedLostAuthorityJournal(journal);
  const next = PHASES.indexOf(phase);
  if (next < 0 || next !== PHASES.indexOf(current.phase) + 1) {
    throw new Error("Recovery journal phase must advance exactly once.");
  }
  const receipt = normalizeReceipt(values.receipt, `${phase} receipt`);
  const targetBindingDigest = values.targetBindingDigest ?? current.targetBindingDigest;
  if (["local-cas", "verified", "complete"].includes(phase)) {
    requiredDigest(targetBindingDigest, "target binding digest");
  }
  const result = phase === "complete"
    ? normalizeResult(values.result, current, targetBindingDigest)
    : null;
  const core = {
    ...withoutDigest(current),
    status: phase === "complete" ? "complete" : "in-progress",
    phase,
    targetBindingDigest,
    receipts: { ...current.receipts, [phase]: receipt },
    result,
  };
  return Object.freeze({ ...core, journalDigest: digestValue(core) });
}

export function normalizeMergedIntegratedPreservedLostAuthorityJournal(value) {
  const journal = requireObject(value, "recovery journal");
  if (journal.schema !== JOURNAL_SCHEMA || !PHASES.includes(journal.phase)
    || !["in-progress", "complete"].includes(journal.status)) {
    throw new Error("Unsupported merged authority recovery journal.");
  }
  const plan = normalizeMergedIntegratedPreservedLostAuthorityPlan(journal.planSnapshot);
  const decision = authorizeMergedIntegratedPreservedLostAuthority(plan, journal.exactAuthorization);
  if (journal.planDigest !== plan.planDigest || journal.authorizationDigest !== decision.authorizationDigest) {
    throw new Error("Recovery journal authorization drifted.");
  }
  const index = PHASES.indexOf(journal.phase);
  const receipts = requireObject(journal.receipts, "journal receipts");
  for (const [phase, receipt] of Object.entries(receipts)) {
    if (!PHASES.includes(phase) || PHASES.indexOf(phase) > index) {
      throw new Error("Recovery journal receipt phase drifted.");
    }
    normalizeReceipt(receipt, `${phase} receipt`);
  }
  if (journal.targetBindingDigest !== null) requiredDigest(journal.targetBindingDigest, "journal binding digest");
  if ((journal.phase === "complete") !== (journal.status === "complete")) {
    throw new Error("Recovery journal completion state drifted.");
  }
  if (journal.phase === "complete") normalizeResult(journal.result, journal, journal.targetBindingDigest);
  else if (journal.result !== null) throw new Error("Incomplete recovery journal has a result.");
  const core = withoutDigest(journal);
  if (journal.journalDigest !== digestValue(core)) throw new Error("Recovery journal digest drifted.");
  return Object.freeze(structuredClone(journal));
}

export function buildMergedIntegratedPreservedLostAuthorityResult({ plan, journal, terminal }) {
  const normalizedPlan = normalizeMergedIntegratedPreservedLostAuthorityPlan(plan);
  const source = normalizeMergedIntegratedPreservedLostAuthorityJournal(journal);
  const receipt = normalizeReceipt(terminal, "terminal receipt");
  requiredDigest(source.targetBindingDigest, "target binding digest");
  const phaseReceiptDigests = Object.fromEntries(Object.entries(source.receipts)
    .filter(([phase]) => phase !== "complete")
    .map(([phase, item]) => [phase, item.receiptDigest]));
  const core = {
    schema: RESULT_SCHEMA,
    status: "complete",
    planDigest: normalizedPlan.planDigest,
    sourceBindingDigest: normalizedPlan.evidence.sourceBinding.bindingDigest,
    targetBindingDigest: source.targetBindingDigest,
    terminalReceiptDigest: receipt.receiptDigest,
    phaseReceiptDigests,
    sourceBytesChanged: false,
    cloudMutated: false,
    pullRequestChanged: false,
    merged: false,
    cleaned: false,
    deployed: false,
  };
  return Object.freeze({ ...core, resultDigest: digestValue(core) });
}

function normalizeResult(value, journal, targetBindingDigest) {
  const result = requireObject(value, "recovery result");
  if (result.schema !== RESULT_SCHEMA || result.status !== "complete"
    || result.planDigest !== journal.planDigest
    || result.sourceBindingDigest !== journal.planSnapshot.evidence.sourceBinding.bindingDigest
    || result.targetBindingDigest !== targetBindingDigest
    || result.sourceBytesChanged !== false || result.cloudMutated !== false
    || result.pullRequestChanged !== false || result.merged !== false
    || result.cleaned !== false || result.deployed !== false) {
    throw new Error("Recovery result changed its effect boundary.");
  }
  requiredDigest(result.terminalReceiptDigest, "terminal receipt digest");
  const core = { ...result };
  delete core.resultDigest;
  if (result.resultDigest !== digestValue(core)) throw new Error("Recovery result digest drifted.");
  return Object.freeze(structuredClone(result));
}

function normalizeCapabilityProjection(value) {
  const capability = requireObject(value, "target capability");
  if (!SUBJECT.test(String(capability.authoritySubjectId || ""))
    || capability.proofAdapterId !== "urn:agentic-proof:ed25519-file:v1"
    || !Number.isSafeInteger(capability.generation) || capability.generation < 1
    || !requiredText(capability.publicKey, "target public key")
    || !DIGEST.test(String(capability.publicKeyDigest || ""))) {
    throw new Error("Target capability projection is invalid.");
  }
  return Object.freeze({
    authoritySubjectId: capability.authoritySubjectId,
    proofAdapterId: capability.proofAdapterId,
    generation: capability.generation,
    publicKey: capability.publicKey,
    publicKeyDigest: capability.publicKeyDigest,
  });
}

function normalizeReceipt(value, label) {
  const receipt = requireObject(value, label);
  requiredDigest(receipt.receiptDigest, `${label} digest`);
  const core = { ...receipt };
  delete core.receiptDigest;
  if (receipt.receiptDigest !== digestValue(core)) throw new Error(`${label} digest drifted.`);
  return Object.freeze(structuredClone(receipt));
}
function withoutDigest(value) {
  const copy = { ...value };
  delete copy.journalDigest;
  return copy;
}
function requireObject(value, label) {
  if (!value || Array.isArray(value) || typeof value !== "object") throw new Error(`${label} must be an object.`);
  return value;
}
function requiredText(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}
function requiredDigest(value, label) {
  if (!DIGEST.test(String(value || ""))) throw new Error(`${label} must be a digest.`);
  return value;
}
function requiredSha(value, label) {
  if (!SHA.test(String(value || ""))) throw new Error(`${label} must be a SHA.`);
  return value;
}
function requiredInstant(value, label) {
  const time = Date.parse(String(value || ""));
  if (!Number.isFinite(time)) throw new Error(`${label} must be an ISO instant.`);
  return new Date(time).toISOString();
}
function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be positive.`);
  return value;
}
