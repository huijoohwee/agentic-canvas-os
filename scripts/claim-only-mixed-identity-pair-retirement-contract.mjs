// Responsibility: Seal one typed, ordered, pair-bounded claim-only retirement transaction.
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  normalizeMixedIdentityPairRetirementEvidence,
} from "./claim-only-mixed-identity-pair-retirement-evidence.mjs";
import {
  effectValuesDigest, mixedIdentityPairOperationKey,
  mixedIdentityPairRetirementRequestDigest,
} from "./claim-only-mixed-identity-pair-retirement-store.mjs";

export const MIXED_IDENTITY_PAIR_RETIREMENT_OPERATION =
  "claim-only-mixed-identity-pair-retirement";
export const MIXED_IDENTITY_PAIR_RETIREMENT_PHASES = Object.freeze([
  "authorized", "prepared", "waiting-successor-retired", "source-retired", "verified",
  "complete",
]);
export const MIXED_IDENTITY_PAIR_RETIREMENT_PLAN_SCHEMA =
  "agentic-claim-only-mixed-identity-pair-retirement-plan/v1";
export const MIXED_IDENTITY_PAIR_RETIREMENT_JOURNAL_SCHEMA =
  "agentic-claim-only-mixed-identity-pair-retirement-journal/v1";
export const MIXED_IDENTITY_PAIR_RETIREMENT_RECEIPT_SCHEMA =
  "agentic-claim-only-mixed-identity-pair-retirement-receipt/v1";

const DIGEST = /^[0-9a-f]{64}$/u;
const EFFECTS = Object.freeze([
  "retire-waiting-successor-cloud-claim",
  "retire-source-cloud-claim",
]);
const FORBIDDEN_EFFECTS = Object.freeze([
  "source-bytes", "git-object", "git-ref", "branch", "worktree", "writer-lease",
  "pull-request", "new-claim", "integration", "release", "deployment", "production",
]);

export function buildMixedIdentityPairRetirementPlan(value) {
  const evidence = normalizeMixedIdentityPairRetirementEvidence(value);
  const core = {
    schema: MIXED_IDENTITY_PAIR_RETIREMENT_PLAN_SCHEMA,
    operation: MIXED_IDENTITY_PAIR_RETIREMENT_OPERATION,
    sourceClaimId: evidence.source.claimId,
    waitingSuccessorClaimId: evidence.waitingSuccessor.claimId,
    evidence,
    orderedEffects: EFFECTS,
    forbiddenEffects: FORBIDDEN_EFFECTS,
    phases: MIXED_IDENTITY_PAIR_RETIREMENT_PHASES,
  };
  const planDigest = digestValue(core);
  return deepFreeze({
    ...core,
    planDigest,
    exactAuthorization: `authorize ${MIXED_IDENTITY_PAIR_RETIREMENT_OPERATION} ${planDigest}`,
  });
}

export function normalizeMixedIdentityPairRetirementPlan(value) {
  object(value, "retirement plan");
  const rebuilt = buildMixedIdentityPairRetirementPlan(value.evidence);
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("plan seal");
  return rebuilt;
}

export function authorizeMixedIdentityPairRetirement(plan, authorization) {
  const normalized = normalizeMixedIdentityPairRetirementPlan(plan);
  if (authorization !== normalized.exactAuthorization) {
    throw new Error(`Exact authorization required: ${normalized.exactAuthorization}`);
  }
  return digestValue({
    schema: "agentic-claim-only-mixed-identity-pair-retirement-authorization/v1",
    planDigest: normalized.planDigest,
    authorization,
  });
}

export function createMixedIdentityPairRetirementJournal(plan) {
  const normalized = normalizeMixedIdentityPairRetirementPlan(plan);
  return sealJournal({
    schema: MIXED_IDENTITY_PAIR_RETIREMENT_JOURNAL_SCHEMA,
    plan: normalized,
    state: null,
  });
}

export function startMixedIdentityPairRetirementJournal(journal, authorization) {
  const current = normalizeMixedIdentityPairRetirementJournal(journal);
  if (current.state !== null) throw new Error("Retirement journal is already authorized.");
  return sealJournal({
    schema: MIXED_IDENTITY_PAIR_RETIREMENT_JOURNAL_SCHEMA,
    plan: current.plan,
    state: {
      phase: "authorized",
      receipts: {
        authorized: phaseReceipt(current.plan, "authorized", {
          authorizationDigest: authorizeMixedIdentityPairRetirement(
            current.plan, authorization,
          ),
        }),
      },
    },
  });
}

export function advanceMixedIdentityPairRetirementJournal(journal, phase, values) {
  const current = normalizeMixedIdentityPairRetirementJournal(journal);
  if (!current.state) throw new Error("Retirement journal is not authorized.");
  const currentIndex = MIXED_IDENTITY_PAIR_RETIREMENT_PHASES.indexOf(current.state.phase);
  const nextIndex = MIXED_IDENTITY_PAIR_RETIREMENT_PHASES.indexOf(phase);
  if (nextIndex !== currentIndex + 1) {
    throw new Error(`Retirement cannot advance from ${current.state.phase} to ${phase}.`);
  }
  return sealJournal({
    schema: MIXED_IDENTITY_PAIR_RETIREMENT_JOURNAL_SCHEMA,
    plan: current.plan,
    state: {
      phase,
      receipts: {
        ...current.state.receipts,
        [phase]: phaseReceipt(current.plan, phase, values, current.state.receipts),
      },
    },
  });
}

export function normalizeMixedIdentityPairRetirementJournal(value) {
  object(value, "retirement journal");
  const plan = normalizeMixedIdentityPairRetirementPlan(value.plan);
  let state = null;
  if (value.state !== null) {
    object(value.state, "retirement state");
    const phaseIndex = MIXED_IDENTITY_PAIR_RETIREMENT_PHASES.indexOf(value.state.phase);
    if (phaseIndex < 0) invalid("journal phase");
    object(value.state.receipts, "journal receipts");
    const receipts = {};
    for (let index = 0; index <= phaseIndex; index += 1) {
      const phase = MIXED_IDENTITY_PAIR_RETIREMENT_PHASES[index];
      receipts[phase] = normalizePhaseReceipt(
        plan, phase, value.state.receipts[phase], receipts,
      );
    }
    if (Object.keys(receipts).length !== Object.keys(value.state.receipts).length) {
      invalid("journal phase order");
    }
    state = deepFreeze({ phase: value.state.phase, receipts });
  }
  const core = {
    schema: MIXED_IDENTITY_PAIR_RETIREMENT_JOURNAL_SCHEMA,
    plan,
    state,
  };
  if (value.schema !== core.schema || value.journalDigest !== digestValue(core)
    || canonicalJson(value) !== canonicalJson({ ...core, journalDigest: value.journalDigest })) {
    invalid("journal seal");
  }
  return deepFreeze({ ...core, journalDigest: value.journalDigest });
}

export function mixedIdentityPairRetirementOperationKey(plan, phase) {
  const normalized = normalizeMixedIdentityPairRetirementPlan(plan);
  if (!MIXED_IDENTITY_PAIR_RETIREMENT_PHASES.includes(phase) || phase === "authorized") {
    invalid("operation phase");
  }
  return mixedIdentityPairOperationKey(normalized.planDigest, phase);
}

export function buildMixedIdentityPairRetirementReceipt(journal) {
  const current = normalizeMixedIdentityPairRetirementJournal(journal);
  if (!current.state || !["verified", "complete"].includes(current.state.phase)) {
    throw new Error("Completion requires the exact verified retirement journal.");
  }
  return buildCompletionReceipt(current.plan, current.state.receipts);
}

function buildCompletionReceipt(plan, receipts) {
  const waiting = receipts["waiting-successor-retired"];
  const source = receipts["source-retired"];
  const verified = receipts.verified;
  const core = {
    schema: MIXED_IDENTITY_PAIR_RETIREMENT_RECEIPT_SCHEMA,
    status: "complete",
    operation: MIXED_IDENTITY_PAIR_RETIREMENT_OPERATION,
    planDigest: plan.planDigest,
    authorizationDigest: receipts.authorized.authorizationDigest,
    sourceClaimId: plan.sourceClaimId,
    waitingSuccessorClaimId: plan.waitingSuccessorClaimId,
    sourceScope: plan.evidence.scopeComparison.source,
    waitingSuccessorScope: plan.evidence.scopeComparison.waitingSuccessor,
    affectedScope: plan.evidence.scopeComparison.union,
    scopeComparisonDigest: plan.evidence.scopeComparison.comparisonDigest,
    waitingSuccessorEffect: effectProjection(waiting),
    sourceEffect: effectProjection(source),
    effectReceiptDigest: verified.effectReceiptDigest,
    terminalRelevantDigest: verified.terminalRelevantDigest,
    disjointMovementDigest: verified.disjointMovementDigest,
    disjointMovementClassification: "keep",
    orderedEffects: EFFECTS,
    forbiddenEffects: FORBIDDEN_EFFECTS,
    preservation: {
      sourceBytes: "unchanged",
      git: "unchanged",
      refs: "unchanged",
      worktrees: "unchanged",
      writerLeases: "unchanged",
      pullRequests: "unchanged",
      deployment: "not-performed",
    },
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

export function normalizeMixedIdentityPairRetirementReceipt(value) {
  object(value, "completion receipt");
  const core = { ...value };
  delete core.receiptDigest;
  if (value.schema !== MIXED_IDENTITY_PAIR_RETIREMENT_RECEIPT_SCHEMA
    || value.status !== "complete" || value.operation !== MIXED_IDENTITY_PAIR_RETIREMENT_OPERATION
    || value.receiptDigest !== digestValue(core)
    || canonicalJson(value.orderedEffects) !== canonicalJson(EFFECTS)
    || canonicalJson(value.forbiddenEffects) !== canonicalJson(FORBIDDEN_EFFECTS)) {
    invalid("completion receipt");
  }
  return deepFreeze({ ...core, receiptDigest: value.receiptDigest });
}

function sealJournal(core) {
  return normalizeMixedIdentityPairRetirementJournal({
    ...core,
    journalDigest: digestValue(core),
  });
}

function phaseReceipt(plan, phase, values, priorReceipts = {}) {
  const normalized = normalizePhaseValues(plan, phase, values, priorReceipts);
  const core = { phase, ...normalized };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function normalizePhaseReceipt(plan, phase, value, priorReceipts) {
  object(value, `${phase} receipt`);
  const { phase: receivedPhase, receiptDigest, ...values } = value;
  const rebuilt = phaseReceipt(plan, phase, values, priorReceipts);
  if (receivedPhase !== phase || receiptDigest !== rebuilt.receiptDigest
    || canonicalJson(value) !== canonicalJson(rebuilt)) invalid(`${phase} receipt seal`);
  return rebuilt;
}

function normalizePhaseValues(plan, phase, value, priorReceipts) {
  object(value, `${phase} values`);
  if (phase === "authorized") {
    return exactKeys({ authorizationDigest: digest(value.authorizationDigest,
      "authorization digest") }, value, phase);
  }
  const operationKey = digest(value.operationKey, `${phase} operation key`);
  if (operationKey !== mixedIdentityPairOperationKey(plan.planDigest, phase)) {
    invalid(`${phase} operation key`);
  }
  if (phase === "prepared") {
    return exactKeys({
      operationKey,
      relevantFrameDigest: digest(value.relevantFrameDigest, "prepared relevant frame"),
      disjointMovementDigest: digest(value.disjointMovementDigest,
        "prepared disjoint movement"),
      disjointMovementClassification: exact(value.disjointMovementClassification, "keep",
        "prepared disjoint classification"),
    }, value, phase);
  }
  if (["waiting-successor-retired", "source-retired"].includes(phase)) {
    const claim = phase === "waiting-successor-retired"
      ? plan.evidence.waitingSuccessor : plan.evidence.source;
    const expectedRequestDigest = mixedIdentityPairRetirementRequestDigest({
      plan, claim, phase,
    });
    return exactKeys({
      operationKey,
      claimId: exact(value.claimId, claim.claimId, `${phase} claim`),
      requestDigest: exact(value.requestDigest, expectedRequestDigest,
        `${phase} request digest`),
      operationReceiptDigest: digest(value.operationReceiptDigest,
        `${phase} operation receipt`),
      terminalEntryDigest: digest(value.terminalEntryDigest, `${phase} terminal entry`),
      terminalClaimDigest: digest(value.terminalClaimDigest, `${phase} terminal claim`),
      transportReceiptDigest: value.transportReceiptDigest === null ? null
        : digest(value.transportReceiptDigest, `${phase} transport receipt`),
      disposition: enumeration(value.disposition, ["projected", "adopted"],
        `${phase} disposition`),
      cloudMutation: exact(value.cloudMutation, true, `${phase} cloud mutation`),
    }, value, phase);
  }
  if (phase === "verified") {
    return exactKeys({
      operationKey,
      effectReceiptDigest: digest(value.effectReceiptDigest, "verified effects"),
      terminalRelevantDigest: digest(value.terminalRelevantDigest,
        "verified relevant terminal"),
      disjointMovementDigest: digest(value.disjointMovementDigest,
        "verified disjoint movement"),
      disjointMovementClassification: exact(value.disjointMovementClassification, "keep",
        "verified disjoint classification"),
    }, value, phase);
  }
  if (phase === "complete") {
    const receipt = normalizeMixedIdentityPairRetirementReceipt(value.receipt);
    const expected = buildCompletionReceipt(plan, priorReceipts);
    if (canonicalJson(receipt) !== canonicalJson(expected)) {
      invalid("completion receipt journal join");
    }
    return exactKeys({ operationKey, receipt }, value, phase);
  }
  invalid("phase values");
}

function effectProjection(receipt) {
  return deepFreeze({
    claimId: receipt.claimId,
    requestDigest: receipt.requestDigest,
    operationReceiptDigest: receipt.operationReceiptDigest,
    terminalEntryDigest: receipt.terminalEntryDigest,
    terminalClaimDigest: receipt.terminalClaimDigest,
    transportReceiptDigest: receipt.transportReceiptDigest,
    disposition: receipt.disposition,
  });
}

export function mixedIdentityPairEffectReceiptDigest(receipts) {
  return digestValue({
    waitingSuccessor: effectValuesDigest(receipts["waiting-successor-retired"]),
    source: effectValuesDigest(receipts["source-retired"]),
  });
}

function exactKeys(normalized, source, label) {
  if (canonicalJson(Object.keys(normalized).sort())
    !== canonicalJson(Object.keys(source).sort())) invalid(`${label} fields`);
  return deepFreeze(normalized);
}
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  return value;
}
function digest(value, label) {
  if (!DIGEST.test(String(value || ""))) invalid(label);
  return value;
}
function exact(value, expected, label) {
  if (value !== expected) invalid(label);
  return value;
}
function enumeration(value, allowed, label) {
  if (!allowed.includes(value)) invalid(label);
  return value;
}
function invalid(label) {
  throw new Error(`Mixed-identity pair ${label} is invalid.`);
}
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const member of Object.values(value)) deepFreeze(member);
  return value;
}
