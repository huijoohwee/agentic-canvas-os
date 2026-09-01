// Responsibility: Seal exact authorization and monotonic receipts for reviewed descendant recovery.
import { canonicalJson, digestValue }
  from "./cloud-collaboration-primitives.mjs";
import {
  normalizeReviewedDormantDescendantScopeRecoveryEvidence,
} from "./reviewed-dormant-descendant-scope-recovery-evidence.mjs";

export const OPERATION = "reviewed-dormant-descendant-scope-recovery";
export const PLAN_SCHEMA = `agentic-${OPERATION}-plan/v1`;
export const INTENT_SCHEMA = `agentic-${OPERATION}-intent/v1`;
export const PHASES = Object.freeze([
  "authorized",
  "task-authority-verified",
  "successor-waiting",
  "source-retired",
  "successor-current",
  "successor-bound",
  "local-cas",
  "pr-drafted",
  "verified",
  "complete",
]);

const AUTHORIZATION_SCHEMA = `agentic-${OPERATION}-authorization/v1`;
const PHASE_SCHEMA = `agentic-${OPERATION}-phase-receipt/v1`;
const COMPLETION_SCHEMA = `agentic-${OPERATION}-completion/v1`;
const DIGEST = /^[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40}$/u;

export function buildReviewedDormantDescendantScopeRecoveryPlan({
  evidence,
  operatorSessionId,
  ttlSeconds = 1800,
} = {}) {
  const source = normalizeReviewedDormantDescendantScopeRecoveryEvidence(evidence);
  const operator = text(operatorSessionId, "operator session");
  if (operator === source.sourceSessionId) {
    throw new Error("Reviewed descendant recovery requires a distinct operator session.");
  }
  const core = {
    schema: PLAN_SCHEMA,
    operation: OPERATION,
    evidence: source,
    evidenceDigest: source.evidenceDigest,
    repository: source.repository.fullName,
    branch: source.branch,
    sourceSessionId: source.sourceSessionId,
    operatorSessionId: operator,
    taskCapabilityDigest: source.taskCapabilityDigest,
    sourceLeaseDigest: source.sourceLeaseDigest,
    sourceClaimId: source.sourceClaim.claimId,
    sourceClaimDigest: source.sourceClaimDigest,
    sourceTransitionCounter: source.sourceClaim.transitionCounter,
    sourceLeaseEpoch: source.sourceClaim.leaseEpoch,
    successorLeaseEpoch: source.sourceClaim.leaseEpoch + 1,
    reviewedHeadSha: source.reviewedHeadSha,
    localHeadSha: source.localHeadSha,
    descendantCommitsDigest: source.descendantCommitsDigest,
    descendantPathsDigest: source.descendantPathsDigest,
    descendantPatchDigest: source.descendantPatchDigest,
    sourceWriteSetDigest: source.sourceManifest.writeSetDigest,
    sourceManifestDigest: source.sourceManifest.manifestDigest,
    targetWriteSetDigest: source.targetManifest.writeSetDigest,
    targetManifestDigest: source.targetManifest.manifestDigest,
    protectedMainSha: source.protectedMainProof.protectedMainSha,
    gitSnapshotDigest: digestValue(source.gitSnapshot),
    ttlSeconds: positiveInteger(ttlSeconds, "TTL seconds"),
    disposition: "same-owner-authoring-restored",
    forbiddenEffects: Object.freeze([
      "source-byte-change", "commit", "push", "local-ref-change", "remote-ref-change",
      "ref-rewrite", "merge", "integration", "deployment", "cleanup",
    ]),
  };
  const planDigest = digestValue(core);
  return deepFreeze({
    ...core,
    planDigest,
    exactAuthorization: `authorize ${OPERATION} ${planDigest}`,
  });
}

export function normalizeReviewedDormantDescendantScopeRecoveryPlan(value) {
  if (value?.schema !== PLAN_SCHEMA || value.operation !== OPERATION) invalid("plan schema");
  const rebuilt = buildReviewedDormantDescendantScopeRecoveryPlan({
    evidence: value.evidence,
    operatorSessionId: value.operatorSessionId,
    ttlSeconds: value.ttlSeconds,
  });
  if (canonicalJson(rebuilt) !== canonicalJson(value)) invalid("plan projection");
  return rebuilt;
}

export function authorizeReviewedDormantDescendantScopeRecovery({
  plan,
  authorization,
} = {}) {
  const source = normalizeReviewedDormantDescendantScopeRecoveryPlan(plan);
  if (authorization !== source.exactAuthorization) {
    throw new Error(`Reviewed descendant recovery requires exact authorization: ${source.exactAuthorization}`);
  }
  const core = {
    schema: AUTHORIZATION_SCHEMA,
    planDigest: source.planDigest,
    statement: authorization,
  };
  return Object.freeze({ ...core, authorizationDigest: digestValue(core) });
}

export function createReviewedDormantDescendantScopeRecoveryIntent(plan, authorization) {
  const source = normalizeReviewedDormantDescendantScopeRecoveryPlan(plan);
  const authority = authorizeReviewedDormantDescendantScopeRecovery({
    plan: source,
    authorization,
  });
  return sealIntent({
    phase: "authorized",
    plan: source,
    authority,
    receipts: {
      authorized: phaseReceipt(source, "authorized", null, {
        authorizationDigest: authority.authorizationDigest,
      }),
    },
    completion: null,
  });
}

export function advanceReviewedDormantDescendantScopeRecoveryIntent(intent, {
  phase,
  values,
} = {}) {
  const current = normalizeReviewedDormantDescendantScopeRecoveryIntent(intent);
  return advanceNormalizedIntent(current, { phase, values });
}

function advanceNormalizedIntent(current, { phase, values }) {
  if (PHASES.indexOf(phase) !== PHASES.indexOf(current.phase) + 1) {
    throw new Error("Reviewed descendant recovery cannot skip or regress a protected phase.");
  }
  const normalizedValues = phase === "complete"
    ? normalizeCompletion(current.planSnapshot, values, current.receipts)
    : normalizePhaseValues(current.planSnapshot, phase, values, current.receipts);
  const receipts = {
    ...current.receipts,
    [phase]: phaseReceipt(
      current.planSnapshot,
      phase,
      current.intentDigest,
      normalizedValues,
    ),
  };
  const completion = phase === "complete" ? normalizedValues : null;
  return sealIntent({
    phase,
    plan: current.planSnapshot,
    authority: current.authorization,
    receipts,
    completion,
  });
}

export function normalizeReviewedDormantDescendantScopeRecoveryIntent(value) {
  if (value?.schema !== INTENT_SCHEMA || !PHASES.includes(value.phase)) {
    invalid("intent schema");
  }
  const plan = normalizeReviewedDormantDescendantScopeRecoveryPlan(value.planSnapshot);
  let rebuilt = createReviewedDormantDescendantScopeRecoveryIntent(
    plan,
    value.authorization?.statement,
  );
  const last = PHASES.indexOf(value.phase);
  for (const phase of PHASES.slice(1, last + 1)) {
    rebuilt = advanceNormalizedIntent(rebuilt, {
      phase,
      values: value.receipts?.[phase]?.values,
    });
  }
  if (canonicalJson(rebuilt) !== canonicalJson(value)) invalid("intent projection");
  return rebuilt;
}

export function reviewedDormantDescendantScopeRecoveryOperationKey(plan, phase) {
  const source = normalizeReviewedDormantDescendantScopeRecoveryPlan(plan);
  if (!PHASES.includes(phase)) invalid("operation phase");
  return `${OPERATION}:${phase}:${digestValue({ planDigest: source.planDigest, phase })}`;
}

export function normalizeReviewedDormantDescendantTerminalVerification(plan, value) {
  const source = normalizeReviewedDormantDescendantScopeRecoveryPlan(plan);
  const result = {
    sourceClaimId: requiredDigest(value?.sourceClaimId, "terminal source claim ID"),
    successorClaimId: requiredDigest(value?.successorClaimId, "terminal successor claim ID"),
    successorClaimDigest: requiredDigest(
      value?.successorClaimDigest,
      "terminal successor claim digest",
    ),
    taskAuthorityReceiptDigest: requiredDigest(
      value?.taskAuthorityReceiptDigest,
      "terminal task-authority receipt",
    ),
    leaseDigest: requiredDigest(value?.leaseDigest, "terminal lease digest"),
    pullRequestDigest: requiredDigest(value?.pullRequestDigest, "terminal pull-request digest"),
    verificationDigest: requiredDigest(value?.verificationDigest, "terminal verification digest"),
    headSha: sha(value?.headSha, "terminal head"),
    indexTreeSha: sha(value?.indexTreeSha, "terminal index tree"),
    localRefSha: sha(value?.localRefSha, "terminal local ref"),
    remoteRefSha: sha(value?.remoteRefSha, "terminal remote ref"),
    authoringAuthorityRestored: exactBoolean(
      value?.authoringAuthorityRestored,
      true,
      "terminal authoring authority",
    ),
    sourceBytesChanged: exactBoolean(value?.sourceBytesChanged, false, "source-byte effect"),
    committed: exactBoolean(value?.committed, false, "commit effect"),
    pushed: exactBoolean(value?.pushed, false, "push effect"),
    refRewritten: exactBoolean(value?.refRewritten, false, "ref-rewrite effect"),
    merged: exactBoolean(value?.merged, false, "merge effect"),
    deployed: exactBoolean(value?.deployed, false, "deployment effect"),
    cleaned: exactBoolean(value?.cleaned, false, "cleanup effect"),
    integrationAuthorityRestored: exactBoolean(
      value?.integrationAuthorityRestored,
      false,
      "integration authority",
    ),
  };
  exactKeys(value, Object.keys(result), "terminal verification");
  if (result.sourceClaimId !== source.sourceClaimId
    || result.headSha !== source.localHeadSha
    || result.indexTreeSha !== source.evidence.localTreeSha
    || result.localRefSha !== source.localHeadSha
    || result.remoteRefSha !== source.reviewedHeadSha) {
    invalid("terminal preservation joins");
  }
  return Object.freeze(result);
}

export function buildReviewedDormantDescendantCompletionReceipt(plan, verification) {
  const source = normalizeReviewedDormantDescendantScopeRecoveryPlan(plan);
  const terminal = normalizeReviewedDormantDescendantTerminalVerification(source, verification);
  const core = {
    schema: COMPLETION_SCHEMA,
    status: "authoring-authority-restored",
    planDigest: source.planDigest,
    sourceClaimId: terminal.sourceClaimId,
    successorClaimId: terminal.successorClaimId,
    successorClaimDigest: terminal.successorClaimDigest,
    taskAuthorityReceiptDigest: terminal.taskAuthorityReceiptDigest,
    leaseDigest: terminal.leaseDigest,
    pullRequestDigest: terminal.pullRequestDigest,
    verificationDigest: terminal.verificationDigest,
    reviewedHeadSha: source.reviewedHeadSha,
    localHeadSha: source.localHeadSha,
    authoringAuthorityRestored: true,
    integrationAuthorityRestored: false,
    sourceBytesChanged: false,
    committed: false,
    pushed: false,
    refRewritten: false,
    merged: false,
    deployed: false,
    cleaned: false,
  };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}

function normalizePhaseValues(plan, phase, values, receipts) {
  const result = plain(values, `${phase} values`);
  if (phase === "task-authority-verified") {
    requiredDigest(result.taskAuthorityReceiptDigest, "task-authority receipt");
  } else if (["successor-waiting", "successor-current"].includes(phase)) {
    successor(result, phase);
    const waiting = receipts["successor-waiting"]?.values;
    if (waiting && result.claimId !== waiting.claimId) invalid(`${phase} successor identity`);
  } else if (phase === "source-retired") {
    if (requiredDigest(result.sourceClaimId, "retired source claim") !== plan.sourceClaimId) {
      invalid("retired source claim");
    }
    requiredDigest(result.sourceRetirementReceiptDigest, "source retirement receipt");
  } else if (phase === "successor-bound") {
    successor(result, phase);
    const current = receipts["successor-current"]?.values;
    const task = receipts["task-authority-verified"]?.values;
    if (result.claimId !== current?.claimId
      || result.transitionCounter !== current?.transitionCounter + 1
      || requiredDigest(result.taskAuthorityReceiptDigest, "bound task-authority receipt")
        !== task?.taskAuthorityReceiptDigest) invalid("bound successor joins");
  } else if (phase === "local-cas") {
    requiredDigest(result.leaseDigest, "local lease digest");
  } else if (phase === "pr-drafted") {
    requiredDigest(result.pullRequestDigest, "draft pull-request digest");
  } else if (phase === "verified") {
    const terminal = normalizeReviewedDormantDescendantTerminalVerification(plan, result);
    requireTerminalJoins(terminal, receipts);
    return terminal;
  }
  return deepFreeze(result);
}

function requireTerminalJoins(terminal, receipts) {
  const bound = receipts["successor-bound"]?.values;
  if (terminal.successorClaimId !== bound?.claimId
    || terminal.successorClaimDigest !== bound?.claimDigest
    || terminal.taskAuthorityReceiptDigest !== bound?.taskAuthorityReceiptDigest
    || terminal.leaseDigest !== receipts["local-cas"]?.values?.leaseDigest
    || terminal.pullRequestDigest !== receipts["pr-drafted"]?.values?.pullRequestDigest) {
    invalid("terminal receipt joins");
  }
}

function successor(value, label) {
  requiredDigest(value.claimId, `${label} claim ID`);
  requiredDigest(value.claimDigest, `${label} claim digest`);
  requiredDigest(value.operationReceiptDigest, `${label} operation receipt`);
  positiveInteger(value.transitionCounter, `${label} transition counter`);
}

function normalizeCompletion(plan, value, receipts) {
  const rebuilt = buildReviewedDormantDescendantCompletionReceipt(plan, {
    sourceClaimId: value?.sourceClaimId,
    successorClaimId: value?.successorClaimId,
    successorClaimDigest: value?.successorClaimDigest,
    taskAuthorityReceiptDigest: value?.taskAuthorityReceiptDigest,
    leaseDigest: value?.leaseDigest,
    pullRequestDigest: value?.pullRequestDigest,
    verificationDigest: value?.verificationDigest,
    headSha: plan.localHeadSha,
    indexTreeSha: plan.evidence.localTreeSha,
    localRefSha: plan.localHeadSha,
    remoteRefSha: plan.reviewedHeadSha,
    authoringAuthorityRestored: value?.authoringAuthorityRestored,
    sourceBytesChanged: value?.sourceBytesChanged,
    committed: value?.committed,
    pushed: value?.pushed,
    refRewritten: value?.refRewritten,
    merged: value?.merged,
    deployed: value?.deployed,
    cleaned: value?.cleaned,
    integrationAuthorityRestored: value?.integrationAuthorityRestored,
  });
  const verified = receipts.verified?.values;
  if (canonicalJson(rebuilt) !== canonicalJson(value)
    || rebuilt.successorClaimId !== verified?.successorClaimId
    || rebuilt.successorClaimDigest !== verified?.successorClaimDigest
    || rebuilt.taskAuthorityReceiptDigest !== verified?.taskAuthorityReceiptDigest
    || rebuilt.leaseDigest !== verified?.leaseDigest
    || rebuilt.pullRequestDigest !== verified?.pullRequestDigest) {
    invalid("completion receipt");
  }
  return rebuilt;
}

function phaseReceipt(plan, phase, priorIntentDigest, values) {
  const normalized = deepFreeze(structuredClone(values));
  const core = {
    schema: PHASE_SCHEMA,
    phase,
    planDigest: plan.planDigest,
    operationKey: reviewedDormantDescendantScopeRecoveryOperationKey(plan, phase),
    priorIntentDigest,
    values: normalized,
    valuesDigest: digestValue(normalized),
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function sealIntent({ phase, plan, authority, receipts, completion }) {
  const core = {
    schema: INTENT_SCHEMA,
    phase,
    planDigest: plan.planDigest,
    planSnapshot: plan,
    authorization: authority,
    authorizationDigest: authority.authorizationDigest,
    receipts,
    completion,
  };
  return deepFreeze({ ...core, intentDigest: digestValue(core) });
}

function plain(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  return structuredClone(value);
}
function text(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim()) invalid(label);
  return value;
}
function requiredDigest(value, label) {
  const result = text(value, label);
  if (!DIGEST.test(result)) invalid(label);
  return result;
}
function sha(value, label) {
  const result = text(value, label);
  if (!SHA.test(result)) invalid(label);
  return result;
}
function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) invalid(label);
  return value;
}
function exactBoolean(value, expected, label) {
  if (value !== expected) invalid(label);
  return expected;
}
function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) invalid(label);
}
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
function invalid(label) {
  throw new Error(`Reviewed dormant descendant recovery has invalid ${label}.`);
}
