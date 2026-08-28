// Responsibility: Seal one exact, absent-owner authored-lane retirement plan and journal.
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import { normalizeOrphanedAbsentAuthoredLaneEvidence }
  from "./orphaned-absent-authored-lane-retirement-evidence.mjs";
import { retirementRequestDigest }
  from "./orphaned-absent-authored-lane-retirement-store.mjs";

export const PLAN_SCHEMA = "agentic-orphaned-absent-authored-lane-retirement-plan/v1";
export const STATE_SCHEMA = "agentic-orphaned-absent-authored-lane-retirement-state/v1";
export const RECEIPT_SCHEMA = "agentic-orphaned-absent-authored-lane-retirement-receipt/v1";
export const PHASES = Object.freeze([
  "planned", "authorized", "pull-request-closed", "claim-retired", "verified", "complete",
]);
export const PRESERVATION = Object.freeze({
  remoteBranch: "preserved",
  remoteRef: "preserved",
  authoredCommits: "preserved",
  localBranch: "absent",
  localWorktree: "absent",
  sourceCleanup: "not-performed",
  merge: "not-performed",
  deployment: "not-performed",
});

export function buildPlan(input) {
  const evidence = normalizeOrphanedAbsentAuthoredLaneEvidence(input);
  const core = Object.freeze({
    schema: PLAN_SCHEMA,
    action: "orphaned-absent-authored-lane-retirement",
    evidence,
    effects: Object.freeze(["close-exact-draft-pull-request", "retire-exact-dormant-cloud-claim"]),
    preservation: PRESERVATION,
  });
  const planDigest = digestValue(core);
  return deepFreeze({
    ...core,
    planDigest,
    exactAuthorization: `authorize orphaned-absent-authored-lane-retirement ${planDigest}`,
  });
}

export function normalizePlan(value) {
  let rebuilt;
  try { rebuilt = buildPlan(value?.evidence); }
  catch (error) {
    throw new Error(`Orphaned absent-authored retirement plan is invalid or drifted: ${error.message}`);
  }
  if (canonicalJson(value) !== canonicalJson(rebuilt)) {
    throw new Error("Orphaned absent-authored retirement plan is invalid or drifted.");
  }
  return rebuilt;
}

export function authorizePlan(plan, authorization) {
  const normalized = normalizePlan(plan);
  if (authorization !== normalized.exactAuthorization) {
    throw new Error(`Exact authorization required: ${normalized.exactAuthorization}`);
  }
  return normalized;
}

export function createState(plan) {
  return sealState({ phase: "planned", plan: normalizePlan(plan), receipts: {} });
}

export function normalizeState(value) {
  if (!value || value.schema !== STATE_SCHEMA || !PHASES.includes(value.phase)) {
    throw new Error("Orphaned absent-authored retirement state is invalid.");
  }
  const plan = normalizePlan(value.plan);
  const expected = PHASES.slice(1, PHASES.indexOf(value.phase) + 1);
  const names = Object.keys(value.receipts || {});
  if (canonicalJson(names) !== canonicalJson(expected)) {
    throw new Error("Orphaned absent-authored retirement receipts are out of order.");
  }
  const receipts = {};
  for (const receiptPhase of expected) {
    receipts[receiptPhase] = normalizePhaseReceipt(value.receipts[receiptPhase], receiptPhase,
      plan, receipts);
  }
  return assertSealed(value, sealState({ phase: value.phase, plan, receipts }));
}

export function advanceState(state, phase, values) {
  const current = normalizeState(state);
  const nextIndex = PHASES.indexOf(phase);
  if (nextIndex !== PHASES.indexOf(current.phase) + 1) {
    throw new Error(`Retirement cannot advance from ${current.phase} to ${phase}.`);
  }
  return sealState({
    phase,
    plan: current.plan,
    receipts: { ...current.receipts, [phase]: phaseReceipt(phase, values, current.plan, current.receipts) },
  });
}

export function phaseReceipt(phase, values = {}, plan, receipts = {}) {
  if (!PHASES.slice(1).includes(phase) || !plainObject(values)) {
    throw new Error("Retirement phase receipt is invalid.");
  }
  const core = { schema: RECEIPT_SCHEMA, phase, ...normalizePhaseValues(phase, values, plan, receipts) };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

export function buildCompletionReceipt(state) {
  const current = normalizeState(state);
  if (current.phase !== "verified") {
    throw new Error("Completion receipt requires terminal verification.");
  }
  return deriveCompletionReceipt(current.plan, current.receipts);
}

export function retirementJournalOperationKey(plan, phase) {
  if (!["pull-request-closed", "claim-retired"].includes(phase)) {
    throw new Error("Retirement journal operation phase is invalid.");
  }
  return digestValue({ planDigest: digest(plan?.planDigest, "plan digest"), phase });
}

export function retirementTerminalEvidenceDigest(plan, claimRetirement) {
  const normalized = normalizePlan(plan);
  if (!plainObject(claimRetirement)) {
    throw new Error("Retirement terminal claim receipt is invalid.");
  }
  return deriveTerminalEvidenceDigest(normalized, claimRetirement);
}

function deriveCompletionReceipt(plan, receipts) {
  const core = {
    schema: RECEIPT_SCHEMA,
    phase: "complete",
    status: "complete",
    planDigest: plan.planDigest,
    claimId: plan.evidence.claim.claimId,
    pullRequestNumber: plan.evidence.pullRequest.number,
    pullRequestCloseReceiptDigest: receipts["pull-request-closed"].receiptDigest,
    claimRetirementReceiptDigest: receipts["claim-retired"].receiptDigest,
    terminalEvidenceDigest: receipts.verified.terminalEvidenceDigest,
    preservation: PRESERVATION,
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function sealState({ phase, plan, receipts }) {
  const core = { schema: STATE_SCHEMA, phase, plan, receipts };
  return deepFreeze({ ...core, stateDigest: digestValue(core) });
}

function normalizePhaseReceipt(value, phase, plan, receipts) {
  if (!plainObject(value) || value.schema !== RECEIPT_SCHEMA || value.phase !== phase) {
    throw new Error(`Retirement ${phase} receipt is invalid.`);
  }
  const { receiptDigest, schema: _schema, phase: _phase, ...values } = value;
  let normalizedValues;
  try { normalizedValues = normalizePhaseValues(phase, values, plan, receipts); }
  catch (error) { throw new Error(`Retirement ${phase} receipt is invalid: ${error.message}`); }
  const core = { schema: RECEIPT_SCHEMA, phase, ...normalizedValues };
  if (receiptDigest !== digestValue(core)) {
    throw new Error(`Retirement ${phase} receipt digest is invalid.`);
  }
  return deepFreeze({ ...core, receiptDigest });
}

function normalizePhaseValues(phase, value, plan, receipts) {
  if (!plan) throw new Error(`${phase} receipt requires its plan.`);
  if (phase === "authorized") {
    exactKeys(value, ["authorizationDigest"], phase);
    const expected = digestValue({ planDigest: plan.planDigest, authorization: plan.exactAuthorization });
    if (value.authorizationDigest !== expected) throw new Error("authorization join drifted.");
    return { authorizationDigest: digest(value.authorizationDigest, "authorization digest") };
  }
  if (phase === "pull-request-closed") {
    exactKeys(value, ["operationKey", "pullRequestNumber", "pullRequestNodeId", "closedAt",
      "disposition", "providerMutation"], phase);
    if (value.operationKey !== retirementJournalOperationKey(plan, phase)
      || value.pullRequestNumber !== plan.evidence.pullRequest.number
      || value.pullRequestNodeId !== plan.evidence.pullRequest.nodeId
      || value.providerMutation !== true
      || !["projected", "adopted-response-loss", "closed-or-reconciled", "closed",
        "reconciled-response-loss", "adopted-existing"].includes(value.disposition)) {
      throw new Error("provider closure join drifted.");
    }
    return { operationKey: digest(value.operationKey, "provider operation key"),
      pullRequestNumber: value.pullRequestNumber, pullRequestNodeId: value.pullRequestNodeId,
      closedAt: instant(value.closedAt, "pull-request close instant"),
      disposition: value.disposition, providerMutation: true };
  }
  if (phase === "claim-retired") {
    exactKeys(value, ["operationKey", "claimId", "requestDigest", "operationReceiptDigest",
      "terminalEntryDigest", "disposition", "cloudMutation"], phase);
    if (value.operationKey !== retirementJournalOperationKey(plan, phase)
      || value.claimId !== plan.evidence.claim.claimId
      || value.requestDigest !== retirementRequestDigest(plan) || value.cloudMutation !== true
      || !["projected", "adopted-response-loss", "retired-or-reconciled", "adopted-existing"]
        .includes(value.disposition)) {
      throw new Error("cloud retirement join drifted.");
    }
    return { operationKey: digest(value.operationKey, "cloud operation key"), claimId: value.claimId,
      requestDigest: digest(value.requestDigest, "cloud request digest"),
      operationReceiptDigest: digest(value.operationReceiptDigest, "cloud operation receipt digest"),
      terminalEntryDigest: digest(value.terminalEntryDigest, "terminal entry digest"),
      disposition: value.disposition, cloudMutation: true };
  }
  if (phase === "verified") {
    exactKeys(value, ["terminalEvidenceDigest"], phase);
    const expected = deriveTerminalEvidenceDigest(plan, receipts["claim-retired"]);
    if (value.terminalEvidenceDigest !== expected) {
      throw new Error("terminal evidence join drifted.");
    }
    return { terminalEvidenceDigest: digest(value.terminalEvidenceDigest, "terminal evidence digest") };
  }
  if (phase === "complete") {
    exactKeys(value, ["receipt"], phase);
    const expected = deriveCompletionReceipt(plan, receipts);
    if (canonicalJson(value.receipt) !== canonicalJson(expected)) {
      throw new Error("complete receipt drifted from its exact effects.");
    }
    return { receipt: expected };
  }
  throw new Error("unsupported phase.");
}

function deriveTerminalEvidenceDigest(plan, claimRetirement) {
  return digestValue({
    planDigest: plan.planDigest,
    pullRequestNodeId: plan.evidence.pullRequest.nodeId,
    pullRequestState: "CLOSED",
    claimId: plan.evidence.claim.claimId,
    retirementEntryDigest: digest(claimRetirement?.terminalEntryDigest,
      "terminal retirement entry digest"),
    retirementOperationReceiptDigest: digest(claimRetirement?.operationReceiptDigest,
      "terminal retirement operation receipt digest"),
    remote: plan.evidence.remote,
    rangeDigest: plan.evidence.authoredRange.rangeDigest,
    absence: { worktrees: [], localBranchPresent: false, leases: [], privateArtifacts: [] },
  });
}

function exactKeys(value, expected, label) {
  if (!plainObject(value) || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...expected].sort())) {
    throw new Error(`${label} receipt fields are invalid.`);
  }
}

function digest(value, label) {
  if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) throw new Error(`${label} is invalid.`);
  return value;
}

function instant(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`${label} is invalid.`);
  return new Date(value).toISOString();
}

function assertSealed(value, expected) {
  if (canonicalJson(value) !== canonicalJson(expected)) {
    throw new Error("Orphaned absent-authored retirement state seal is invalid.");
  }
  return expected;
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
