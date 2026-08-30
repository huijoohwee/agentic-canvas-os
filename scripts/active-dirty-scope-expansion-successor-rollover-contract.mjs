// Responsibility: seal two independently authorized phases for replacing one stale C2 successor.
import { canonicalJson, digestValue, normalizeWriteSet } from "./cloud-collaboration-primitives.mjs";
export const OPERATION = "active-dirty-scope-expansion-successor-rollover";
export const RETIRE_OPERATION = `${OPERATION}-retire`;
export const REPLACE_OPERATION = `${OPERATION}-replace`;
export const RETIREMENT_PLAN_SCHEMA = `agentic-${RETIRE_OPERATION}-plan/v1`;
export const REPLACEMENT_PLAN_SCHEMA = `agentic-${REPLACE_OPERATION}-plan/v1`;
export const JOURNAL_SCHEMA = `agentic-${OPERATION}-journal/v1`;
export const RETIREMENT_PHASES = Object.freeze(["authorized", "stale-successor-retired"]);
export const REPLACEMENT_PHASES = Object.freeze(["authorized", "replacement-claimed",
  "replacement-promoted", "replacement-bound", "local-cas", "pr-marker", "verified", "complete"]);
const DIGEST = /^[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40}$/u;
const RETIREMENT_OBSERVATION_SCHEMA = `agentic-${OPERATION}-retirement-observation/v1`;
const REPLACEMENT_OBSERVATION_SCHEMA = `agentic-${OPERATION}-replacement-observation/v1`;
export function buildSuccessorRolloverRetirementPlan({ observation, operatorSessionId } = {}) {
  const source = normalizeRetirementObservation(observation);
  const operator = text(operatorSessionId, "operator session");
  if (operator === source.sourceSessionId) invalid("retirement requires a distinct operator session");
  const core = {
    schema: RETIREMENT_PLAN_SCHEMA,
    operation: RETIRE_OPERATION,
    observation: source,
    observationDigest: source.observationDigest,
    operatorSessionId: operator,
    branch: source.branch,
    sourceClaimId: source.sourceClaimId,
    staleSuccessorClaimId: source.staleSuccessorClaimId,
    allowedEffects: ["retire-exact-stale-waiting-successor", "private-external-journal"],
    forbiddenEffects: ["source-change", "local-lease-change", "pull-request-change", "git-ref-change", "commit", "push", "merge", "deployment", "cleanup"],
  };
  return sealPlan(core, RETIRE_OPERATION);
}
export function normalizeSuccessorRolloverRetirementPlan(value) {
  if (value?.schema !== RETIREMENT_PLAN_SCHEMA || value.operation !== RETIRE_OPERATION) {
    invalid("retirement plan schema");
  }
  const rebuilt = buildSuccessorRolloverRetirementPlan(value);
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("retirement plan projection");
  return rebuilt;
}
export function authorizeSuccessorRolloverRetirement({ plan, authorization } = {}) {
  return authorize(normalizeSuccessorRolloverRetirementPlan(plan), authorization, RETIRE_OPERATION);
}
export function buildSuccessorRolloverReplacementPlan({ observation, targetManifest,
  operatorSessionId, retirementJournal } = {}) {
  const journal = normalizeSuccessorRolloverJournal(retirementJournal);
  if (journal.retirement.status !== "stale-successor-retired" || journal.replacement)
    invalid("replacement requires terminal retirement and no prior replacement");
  const retirementPlan = journal.retirement.planSnapshot;
  const source = retirementPlan.observation;
  const live = normalizeReplacementObservation(observation, source, journal.retirement);
  const operator = text(operatorSessionId, "operator session");
  if (operator === source.sourceSessionId) invalid("replacement requires a distinct operator session");
  const target = normalizeManifest(targetManifest, source.semanticScope);
  if (!strictSubset(source.sourceDeclaredWriteSet, target.declaredWriteSet))
    invalid("replacement write set must strictly expand the original C1 write set");
  if (!strictSubset(target.declaredWriteSet, source.staleTargetDeclaredWriteSet))
    invalid("replacement write set must be a strict subset of the retired stale C2 write set");
  if (!source.sourceChangedPaths.every(item => covers(target.declaredWriteSet, item)))
    invalid("replacement write set does not cover the preserved authored bytes");
  if (live.protectedMainChangedPaths.some(item => covers(target.declaredWriteSet, item)))
    invalid("replacement write set overlaps the protected-main advance");
  const retirementValues = journal.retirement.phases["stale-successor-retired"].values;
  const core = {
    schema: REPLACEMENT_PLAN_SCHEMA,
    operation: REPLACE_OPERATION,
    observation: live,
    observationDigest: live.observationDigest,
    retirementPlanDigest: retirementPlan.planDigest,
    retirementIntentDigest: journal.retirement.intentDigest,
    retirementReceiptDigest: retirementValues.receiptDigest,
    retirementPlanSnapshot: retirementPlan,
    retirementValues,
    operatorSessionId: operator,
    branch: source.branch,
    sourceClaimIdentity: source.sourceClaimIdentity,
    sourceFenceSha: source.sourceFenceSha,
    sourceReviewRequestId: source.sourceReviewRequestId,
    sourceClaimId: source.sourceClaimId,
    retiredStaleSuccessorClaimId: source.staleSuccessorClaimId,
    targetCanonicalBaseSha: live.protectedMainSha,
    protectedMainSha: live.protectedMainSha,
    protectedMainDisjointProof: buildProtectedMainDisjointProof(source, live),
    replacementPredecessorClaimId: null,
    target,
    targetCloudLeaseEpoch: 1,
    allowedEffects: ["claim-corrected-successor", "promote-corrected-successor-if-waiting",
      "bind-review-request", "atomic-local-lease-intent-supersession",
      "exact-pull-request-marker-replacement", "private-external-journal"],
    forbiddenEffects: ["source-change", "git-ref-change", "commit", "push", "merge", "deployment", "cleanup"],
  };
  return sealPlan(core, REPLACE_OPERATION);
}
export function normalizeSuccessorRolloverReplacementPlan(value) {
  if (value?.schema !== REPLACEMENT_PLAN_SCHEMA || value.operation !== REPLACE_OPERATION)
    invalid("replacement plan schema");
  const retirementJournal = journalForReplacementPlan(value);
  const rebuilt = buildSuccessorRolloverReplacementPlan({ observation: value.observation,
    targetManifest: value.target, operatorSessionId: value.operatorSessionId, retirementJournal });
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("replacement plan projection");
  return rebuilt;
}
export function authorizeSuccessorRolloverReplacement({ plan, authorization } = {}) {
  return authorize(normalizeSuccessorRolloverReplacementPlan(plan), authorization, REPLACE_OPERATION);
}
export function createSuccessorRolloverJournal(plan, authorization) {
  const normalized = normalizeSuccessorRolloverRetirementPlan(plan);
  const authority = authorizeSuccessorRolloverRetirement({ plan: normalized, authorization });
  return sealJournal({
    retirement: sealIntent({
      kind: "retirement", status: "authorized", plan: normalized, authorization: authority,
      phases: { authorized: phaseReceipt(normalized, "authorized", null,
        { authorizationDigest: authority.authorizationDigest }) },
    }),
    replacement: null,
  });
}
export function beginSuccessorRolloverReplacement(journalValue, plan, authorization) {
  const journal = normalizeSuccessorRolloverJournal(journalValue);
  if (journal.retirement.status !== "stale-successor-retired") invalid("replacement before retirement");
  const normalized = normalizeSuccessorRolloverReplacementPlan(plan);
  if (normalized.retirementIntentDigest !== journal.retirement.intentDigest)
    invalid("replacement plan retirement join");
  const authority = authorizeSuccessorRolloverReplacement({ plan: normalized, authorization });
  if (journal.replacement) {
    if (journal.replacement.planDigest !== normalized.planDigest
      || journal.replacement.authorizationDigest !== authority.authorizationDigest)
      invalid("replacement authorization replay");
    return journal;
  }
  return sealJournal({
    retirement: journal.retirement,
    replacement: sealIntent({
      kind: "replacement", status: "authorized", plan: normalized, authorization: authority,
      phases: { authorized: phaseReceipt(normalized, "authorized", null,
        { authorizationDigest: authority.authorizationDigest }) },
    }),
  });
}
export function advanceSuccessorRolloverRetirement(journalValue, values) {
  const journal = normalizeSuccessorRolloverJournal(journalValue);
  const retirement = advanceIntent(journal.retirement, "stale-successor-retired", values);
  return sealJournal({ retirement, replacement: journal.replacement });
}
export function advanceSuccessorRolloverReplacement(journalValue, phase, values) {
  const journal = normalizeSuccessorRolloverJournal(journalValue);
  if (!journal.replacement) invalid("missing replacement intent");
  const replacement = advanceIntent(journal.replacement, phase, values);
  return sealJournal({ retirement: journal.retirement, replacement });
}
export function normalizeSuccessorRolloverJournal(value) {
  if (value?.schema !== JOURNAL_SCHEMA) invalid("journal schema");
  const retirement = normalizeIntent(value.retirement, "retirement");
  const replacement = value.replacement === null ? null : normalizeIntent(value.replacement, "replacement");
  const rebuilt = sealJournal({ retirement, replacement });
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("journal projection");
  return rebuilt;
}
export function successorRolloverOperationKey(planValue, phase) {
  const plan = planValue?.operation === RETIRE_OPERATION
    ? normalizeSuccessorRolloverRetirementPlan(planValue)
    : normalizeSuccessorRolloverReplacementPlan(planValue);
  const phases = plan.operation === RETIRE_OPERATION ? RETIREMENT_PHASES : REPLACEMENT_PHASES;
  if (!phases.includes(phase)) invalid("operation phase");
  return `${plan.operation}:${phase}:${digestValue({ planDigest: plan.planDigest, phase })}`;
}
export function successorRolloverTaskOperation(planValue, phase) {
  const plan = planValue?.operation === RETIRE_OPERATION
    ? normalizeSuccessorRolloverRetirementPlan(planValue)
    : normalizeSuccessorRolloverReplacementPlan(planValue);
  successorRolloverOperationKey(plan, phase);
  return `${plan.operation}:${phase}`;
}
export function buildSuccessorRolloverCompletion(journalValue) {
  const journal = normalizeSuccessorRolloverJournal(journalValue);
  const intent = journal.replacement;
  if (!intent || intent.status !== "verified") invalid("completion requires verified replacement");
  const plan = intent.planSnapshot;
  const claimed = intent.phases["replacement-claimed"].values;
  const bound = intent.phases["replacement-bound"].values;
  const local = intent.phases["local-cas"].values;
  const marker = intent.phases["pr-marker"].values;
  const verified = intent.phases.verified.values;
  return buildCompletionCore({ plan, claimed, bound, local, marker, verified });
}
function normalizeRetirementObservation(value) {
  exactObject(value, "retirement observation", [
    "schema", "sourceClaimIdentity", "controllerDigest", "protectedMainSha", "protectedMainTreeSha",
    "protectedMainAdvanceDigest", "protectedMainChangedPaths", "branch", "sourceSessionId",
    "semanticScope", "sourceFenceSha", "sourceLeaseDigest", "sourceClaimId", "sourceClaimDigest",
    "sourceReviewRequestId", "sourceWriteSetDigest", "sourceManifestDigest", "sourceDeclaredWriteSet",
    "sourceDirtDigest", "sourceChangedPaths", "sourceIntentDigest", "sourceIntentPlanDigest",
    "sourceIntentStatus", "sourceRetirementReceiptDigest", "staleSuccessorClaimId",
    "staleSuccessorClaimDigest", "staleSuccessorTransitionDigest", "staleSuccessorTransitionCounter",
    "staleSuccessorState", "staleSuccessorPredecessorClaimId", "staleTargetCanonicalBaseSha",
    "staleTargetWriteSetDigest", "staleTargetManifestDigest", "staleTargetDeclaredWriteSet",
    "staleExpiresAt", "pullRequestNumber", "pullRequestNodeId", "pullRequestMarkerDigest",
    "pullRequestBodyDigest", "observedLedgerRevision", "observedLedgerDigest",
    "observedLedgerSequence", "observationDigest",
  ]);
  const sourceWriteSet = normalizeWriteSet(value.sourceDeclaredWriteSet);
  const staleWriteSet = normalizeWriteSet(value.staleTargetDeclaredWriteSet);
  const core = {
    schema: text(value.schema, "retirement observation schema"),
    sourceClaimIdentity: normalizeSourceClaimIdentity(value.sourceClaimIdentity),
    controllerDigest: digest(value.controllerDigest, "controller digest"),
    protectedMainSha: sha(value.protectedMainSha, "protected main SHA"),
    protectedMainTreeSha: sha(value.protectedMainTreeSha, "protected main tree SHA"),
    protectedMainAdvanceDigest: digest(value.protectedMainAdvanceDigest, "protected main advance"),
    protectedMainChangedPaths: paths(value.protectedMainChangedPaths, "protected-main changed paths"),
    branch: text(value.branch, "branch"), sourceSessionId: text(value.sourceSessionId, "source session"),
    semanticScope: text(value.semanticScope, "semantic scope"),
    sourceFenceSha: sha(value.sourceFenceSha, "source fence SHA"),
    sourceLeaseDigest: digest(value.sourceLeaseDigest, "source lease"),
    sourceClaimId: digest(value.sourceClaimId, "source claim"),
    sourceClaimDigest: digest(value.sourceClaimDigest, "source claim digest"),
    sourceReviewRequestId: text(value.sourceReviewRequestId, "source review request"),
    sourceWriteSetDigest: digest(value.sourceWriteSetDigest, "source write set"),
    sourceManifestDigest: digest(value.sourceManifestDigest, "source manifest"),
    sourceDeclaredWriteSet: sourceWriteSet,
    sourceDirtDigest: digest(value.sourceDirtDigest, "source dirt"),
    sourceChangedPaths: paths(value.sourceChangedPaths, "source changed paths"),
    sourceIntentDigest: digest(value.sourceIntentDigest, "source intent"),
    sourceIntentPlanDigest: digest(value.sourceIntentPlanDigest, "source intent plan"),
    sourceIntentStatus: text(value.sourceIntentStatus, "source intent status"),
    sourceRetirementReceiptDigest: digest(value.sourceRetirementReceiptDigest, "source retirement receipt"),
    staleSuccessorClaimId: digest(value.staleSuccessorClaimId, "stale successor claim"),
    staleSuccessorClaimDigest: digest(value.staleSuccessorClaimDigest, "stale successor claim digest"),
    staleSuccessorTransitionDigest: digest(value.staleSuccessorTransitionDigest, "stale successor transition"),
    staleSuccessorTransitionCounter: positive(value.staleSuccessorTransitionCounter, "stale successor transition counter"),
    staleSuccessorState: text(value.staleSuccessorState, "stale successor state"),
    staleSuccessorPredecessorClaimId: digest(value.staleSuccessorPredecessorClaimId, "stale predecessor"),
    staleTargetCanonicalBaseSha: sha(value.staleTargetCanonicalBaseSha, "stale target base"),
    staleTargetWriteSetDigest: digest(value.staleTargetWriteSetDigest, "stale target write set"),
    staleTargetManifestDigest: digest(value.staleTargetManifestDigest, "stale target manifest"),
    staleTargetDeclaredWriteSet: staleWriteSet,
    staleExpiresAt: instant(value.staleExpiresAt, "stale successor expiry"),
    pullRequestNumber: positive(value.pullRequestNumber, "pull request"),
    pullRequestNodeId: text(value.pullRequestNodeId, "pull request node ID"),
    pullRequestMarkerDigest: digest(value.pullRequestMarkerDigest, "pull request marker"),
    pullRequestBodyDigest: digest(value.pullRequestBodyDigest, "pull request body"),
    observedLedgerRevision: sha(value.observedLedgerRevision, "ledger revision"),
    observedLedgerDigest: digest(value.observedLedgerDigest, "ledger digest"),
    observedLedgerSequence: positive(value.observedLedgerSequence, "ledger sequence"),
  };
  if (core.schema !== RETIREMENT_OBSERVATION_SCHEMA || core.sourceIntentStatus !== "source-retired"
    || core.staleSuccessorState !== "waiting-successor"
    || core.staleSuccessorPredecessorClaimId !== core.sourceClaimId
    || core.protectedMainSha === core.staleTargetCanonicalBaseSha
    || core.sourceWriteSetDigest !== digestValue(sourceWriteSet)
    || core.staleTargetWriteSetDigest !== digestValue(staleWriteSet)
    || !strictSubset(sourceWriteSet, staleWriteSet)
    || !core.sourceChangedPaths.every(item => covers(sourceWriteSet, item))
    || !core.protectedMainChangedPaths.some(item => covers(staleWriteSet, item))
    || value.observationDigest !== digestValue(core)) invalid("retirement observation semantics");
  return deepFreeze({ ...core, observationDigest: value.observationDigest });
}
function normalizeReplacementObservation(value, source, retirement) {
  exactObject(value, "replacement observation", [
    "schema", "sourceClaimIdentity", "controllerDigest", "protectedMainSha", "protectedMainTreeSha",
    "protectedMainAdvanceDigest", "protectedMainChangedPaths", "branch", "sourceLeaseDigest",
    "sourceDirtDigest", "sourceIntentDigest",
    "pullRequestMarkerDigest", "pullRequestBodyDigest", "staleSuccessorClaimId",
    "staleRetirementClaimDigest", "staleRetirementTransitionDigest",
    "staleRetirementTransitionCounter", "staleRetirementReceiptDigest",
    "observedLedgerRevision", "observedLedgerDigest", "observedLedgerSequence", "observationDigest",
  ]);
  const terminal = retirement.phases["stale-successor-retired"].values;
  const core = {
    schema: text(value.schema, "replacement observation schema"),
    sourceClaimIdentity: normalizeSourceClaimIdentity(value.sourceClaimIdentity),
    controllerDigest: digest(value.controllerDigest, "controller digest"),
    protectedMainSha: sha(value.protectedMainSha, "protected main SHA"),
    protectedMainTreeSha: sha(value.protectedMainTreeSha, "protected main tree SHA"),
    protectedMainAdvanceDigest: digest(value.protectedMainAdvanceDigest, "protected main advance"),
    protectedMainChangedPaths: paths(value.protectedMainChangedPaths, "protected-main changed paths"),
    branch: text(value.branch, "branch"),
    sourceLeaseDigest: digest(value.sourceLeaseDigest, "source lease"),
    sourceDirtDigest: digest(value.sourceDirtDigest, "source dirt"),
    sourceIntentDigest: digest(value.sourceIntentDigest, "source intent"),
    pullRequestMarkerDigest: digest(value.pullRequestMarkerDigest, "pull request marker"),
    pullRequestBodyDigest: digest(value.pullRequestBodyDigest, "pull request body"),
    staleSuccessorClaimId: digest(value.staleSuccessorClaimId, "stale successor"),
    staleRetirementClaimDigest: digest(value.staleRetirementClaimDigest, "stale retirement claim"),
    staleRetirementTransitionDigest: digest(value.staleRetirementTransitionDigest, "stale retirement transition"),
    staleRetirementTransitionCounter: positive(value.staleRetirementTransitionCounter, "stale retirement counter"),
    staleRetirementReceiptDigest: digest(value.staleRetirementReceiptDigest, "stale retirement receipt"),
    observedLedgerRevision: sha(value.observedLedgerRevision, "ledger revision"),
    observedLedgerDigest: digest(value.observedLedgerDigest, "ledger digest"),
    observedLedgerSequence: positive(value.observedLedgerSequence, "ledger sequence"),
  };
  if (core.schema !== REPLACEMENT_OBSERVATION_SCHEMA
    || core.sourceClaimIdentity.identityDigest !== source.sourceClaimIdentity.identityDigest
    || core.protectedMainSha === source.staleTargetCanonicalBaseSha
    || core.branch !== source.branch || core.sourceLeaseDigest !== source.sourceLeaseDigest
    || core.sourceDirtDigest !== source.sourceDirtDigest || core.sourceIntentDigest !== source.sourceIntentDigest
    || core.pullRequestMarkerDigest !== source.pullRequestMarkerDigest
    || core.pullRequestBodyDigest !== source.pullRequestBodyDigest
    || core.staleSuccessorClaimId !== source.staleSuccessorClaimId
    || core.staleRetirementClaimDigest !== terminal.retiredClaimDigest
    || core.staleRetirementTransitionDigest !== terminal.retirementTransitionDigest
    || core.staleRetirementTransitionCounter !== terminal.transitionCounter
    || core.staleRetirementReceiptDigest !== terminal.receiptDigest
    || value.observationDigest !== digestValue(core)) invalid("replacement observation semantics");
  return deepFreeze({ ...core, observationDigest: value.observationDigest });
}
function normalizeManifest(value, semanticScope) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("target manifest");
  const scope = text(value.semanticScope, "target semantic scope");
  const declaredWriteSet = normalizeWriteSet(value.declaredWriteSet);
  const core = {
    schema: "agentic-declared-write-scope/v1", semanticScope: scope, declaredWriteSet,
    writeSetDigest: digest(value.writeSetDigest, "target write set"),
    manifestDigest: digest(value.manifestDigest, "target manifest"),
  };
  if (scope !== semanticScope || !declaredWriteSet.includes(`semantic:${scope}`)
    || core.writeSetDigest !== digestValue(declaredWriteSet)) invalid("target manifest semantics");
  return deepFreeze(core);
}
function normalizeSourceClaimIdentity(value) {
  exactObject(value, "source claim identity", ["repositoryId", "actorId", "deviceId",
    "sessionId", "workItemId", "identityDigest"]);
  const core = { repositoryId: text(value.repositoryId, "source repository ID"),
    actorId: text(value.actorId, "source actor ID"), deviceId: text(value.deviceId, "source device ID"),
    sessionId: text(value.sessionId, "source cloud session ID"),
    workItemId: text(value.workItemId, "source work-item ID") };
  if (value.identityDigest !== digestValue(core)) invalid("source claim identity digest");
  return deepFreeze({ ...core, identityDigest: value.identityDigest });
}
function buildProtectedMainDisjointProof(source, live) {
  const core = {
    schema: `agentic-${OPERATION}-protected-main-disjoint-proof/v1`,
    sourceBaseSha: source.staleTargetCanonicalBaseSha,
    targetBaseSha: live.protectedMainSha,
    protectedMainSha: live.protectedMainSha,
    canonicalChangedPaths: live.protectedMainChangedPaths,
    canonicalChangedPathsDigest: digestValue(live.protectedMainChangedPaths),
    preservedChangedPaths: source.sourceChangedPaths,
    preservedChangedPathsDigest: digestValue(source.sourceChangedPaths),
    ancestry: "source-base-to-current-protected-main",
    overlap: "none",
  };
  return deepFreeze({ ...core, evidenceDigest: digestValue(core) });
}
function normalizeIntent(value, kind) {
  const phases = kind === "retirement" ? RETIREMENT_PHASES : REPLACEMENT_PHASES;
  const plan = kind === "retirement"
    ? normalizeSuccessorRolloverRetirementPlan(value?.planSnapshot)
    : normalizeSuccessorRolloverReplacementPlan(value?.planSnapshot);
  if (!phases.includes(value?.status)) invalid(`${kind} intent status`);
  const authority = authorize(plan, value.authorization?.statement, plan.operation);
  const expectedNames = phases.slice(0, phases.indexOf(value.status) + 1);
  if (canonicalJson(Object.keys(value.phases || {})) !== canonicalJson(expectedNames)) {
    invalid(`${kind} intent phases`);
  }
  let prior = null;
  const rebuiltPhases = {};
  for (const phase of expectedNames) {
    rebuiltPhases[phase] = phaseReceipt(plan, phase, prior, value.phases[phase]?.values);
    prior = sealIntentCore({ kind, status: phase, plan, authorization: authority, phases: { ...rebuiltPhases } }).intentDigest;
  }
  if (kind === "replacement") assertReplacementPhaseJoins(rebuiltPhases, plan);
  const rebuilt = sealIntent({ kind, status: value.status, plan, authorization: authority, phases: rebuiltPhases });
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid(`${kind} intent projection`);
  return rebuilt;
}
function advanceIntent(intentValue, phase, values) {
  const kind = intentValue.kind;
  const current = normalizeIntent(intentValue, kind);
  const phases = kind === "retirement" ? RETIREMENT_PHASES : REPLACEMENT_PHASES;
  const from = phases.indexOf(current.status), to = phases.indexOf(phase);
  if (to < from || to > from + 1) invalid(`${kind} phase progression`);
  if (to === from) {
    if (canonicalJson(current.phases[phase].values) !== canonicalJson(normalizePhaseValues(current.planSnapshot, phase, values))) {
      invalid(`${kind} phase replay`);
    }
    return current;
  }
  const nextPhases = { ...current.phases,
    [phase]: phaseReceipt(current.planSnapshot, phase, current.intentDigest, values) };
  return sealIntent({ kind, status: phase, plan: current.planSnapshot,
    authorization: current.authorization, phases: nextPhases });
}
function phaseReceipt(plan, phase, priorIntentDigest, values) {
  const normalized = normalizePhaseValues(plan, phase, values);
  const core = { schema: `agentic-${OPERATION}-phase/v1`, phase, planDigest: plan.planDigest,
    operationKey: successorRolloverOperationKey(plan, phase), priorIntentDigest,
    values: normalized, valuesDigest: digestValue(normalized) };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}
function normalizePhaseValues(plan, phase, value) {
  const source = cloneObject(value, `${phase} values`);
  if (phase === "authorized") {
    exactObject(source, phase, ["authorizationDigest"]); digest(source.authorizationDigest, "authorization");
  } else if (phase === "stale-successor-retired") {
    exactObject(source, phase, ["schema", "staleSuccessorClaimId", "priorClaimDigest", "retiredClaimDigest",
      "retirementTransitionDigest", "transitionCounter", "state", "reason", "receiptDigest",
    ]);
    if (source.schema !== `agentic-${OPERATION}-retirement/v1`
      || source.staleSuccessorClaimId !== plan.staleSuccessorClaimId
      || digest(source.priorClaimDigest, "prior claim") !== plan.observation.staleSuccessorClaimDigest
      || !digest(source.retiredClaimDigest, "retired claim")
      || !digest(source.retirementTransitionDigest, "retirement transition")
      || positive(source.transitionCounter, "retirement counter") !== plan.observation.staleSuccessorTransitionCounter + 1
      || source.state !== "retired" || source.reason !== "successor-rollover"
      || !digest(source.receiptDigest, "retirement receipt")) invalid("retirement phase values");
  } else if (phase === "replacement-claimed" || phase === "replacement-promoted") {
    const fields = phase === "replacement-claimed" ? ["claim", "receiptDigest"] : ["claim", "promoted", "receiptDigest"];
    exactObject(source, phase, fields);
    source.claim = normalizeReplacementClaim(source.claim, plan, phase);
    if (phase === "replacement-promoted") {
      if (typeof source.promoted !== "boolean" || source.claim.state !== "current") invalid("promotion result");
    }
    digest(source.receiptDigest, `${phase} receipt`);
  } else if (phase === "replacement-bound") {
    exactObject(source, phase, ["authority", "receiptDigest"]);
    source.authority = normalizeBoundAuthority(source.authority, plan);
    digest(source.receiptDigest, "binding receipt");
  } else if (phase === "local-cas") {
    exactObject(source, phase, ["leaseDigest", "sourceIntentDigest", "replacementIntentDigest", "taskAuthorityBindingDigest", "receiptDigest"]);
    ["leaseDigest", "sourceIntentDigest", "replacementIntentDigest", "taskAuthorityBindingDigest", "receiptDigest"]
      .forEach(key => digest(source[key], `local ${key}`));
    if (source.sourceIntentDigest !== plan.observation.sourceIntentDigest
      || source.leaseDigest === plan.observation.sourceLeaseDigest
      || source.replacementIntentDigest === source.sourceIntentDigest) invalid("atomic local supersession");
  } else if (phase === "pr-marker") {
    exactObject(source, phase, ["markerDigest", "bodyDigest", "receiptDigest"]);
    ["markerDigest", "bodyDigest", "receiptDigest"].forEach(key => digest(source[key], `PR ${key}`));
    if (source.markerDigest === plan.observation.pullRequestMarkerDigest) invalid("PR marker supersession");
  } else if (phase === "verified") {
    exactObject(source, phase, ["leaseDigest", "replacementIntentDigest", "cloudAuthorityDigest",
      "taskAuthorityBindingDigest", "markerDigest", "bodyDigest", "dirtDigest", "verificationDigest"]);
    Object.keys(source).forEach(key => digest(source[key], `verification ${key}`));
    const stable = { ...source }; delete stable.verificationDigest; if (source.verificationDigest !== digestValue(stable)) invalid("terminal verification digest");
  } else if (phase === "complete") {
    exactObject(source, phase, ["receipt"]);
    const expected = buildSuccessorRolloverCompletionFromIntent(plan, source.receipt);
    if (canonicalJson(source.receipt) !== canonicalJson(expected)) invalid("completion receipt");
    source.receipt = expected;
  } else invalid("phase values");
  return deepFreeze(source);
}
function normalizeReplacementClaim(value, plan, phase) {
  exactObject(value, "replacement claim", ["claimId", "claimDigest", "ledgerRevision",
    "claimLedgerRevision", "transitionCounter", "state", "predecessorClaimId",
    "canonicalBaseSha", "laneRevision", "writeSetDigest", "leaseEpoch", "expiresAt"]);
  const claim = {
    claimId: digest(value.claimId, "replacement claim"), claimDigest: digest(value.claimDigest, "replacement claim digest"),
    ledgerRevision: sha(value.ledgerRevision, "replacement ledger revision"),
    claimLedgerRevision: digest(value.claimLedgerRevision, "replacement transition"),
    transitionCounter: positive(value.transitionCounter, "replacement counter"),
    state: text(value.state, "replacement state"),
    predecessorClaimId: value.predecessorClaimId === null
      ? null : digest(value.predecessorClaimId, "replacement predecessor"),
    canonicalBaseSha: sha(value.canonicalBaseSha, "replacement base"),
    laneRevision: sha(value.laneRevision, "replacement lane revision"),
    writeSetDigest: digest(value.writeSetDigest, "replacement write set"),
    leaseEpoch: positive(value.leaseEpoch, "replacement lease epoch"),
    expiresAt: instant(value.expiresAt, "replacement expiry"),
  };
  const allowed = phase === "replacement-claimed" ? ["current", "waiting-successor"] : ["current"];
  if (!allowed.includes(claim.state) || claim.predecessorClaimId !== plan.replacementPredecessorClaimId
    || claim.canonicalBaseSha !== plan.targetCanonicalBaseSha
    || claim.laneRevision !== plan.sourceFenceSha
    || claim.writeSetDigest !== plan.target.writeSetDigest
    || claim.leaseEpoch !== plan.targetCloudLeaseEpoch) invalid("replacement claim semantics");
  return deepFreeze(claim);
}
function normalizeBoundAuthority(value, plan) {
  exactObject(value, "bound authority", ["claimId", "claimDigest", "claimLedgerRevision",
    "transitionCounter", "canonicalBaseSha", "laneRevision", "writeSetDigest", "manifestDigest",
    "leaseEpoch", "reviewRequestId", "expiresAt", "authorityDigest"]);
  const authority = {
    claimId: digest(value.claimId, "bound claim"), claimDigest: digest(value.claimDigest, "bound claim digest"),
    claimLedgerRevision: digest(value.claimLedgerRevision, "bound transition"),
    transitionCounter: positive(value.transitionCounter, "bound counter"),
    canonicalBaseSha: sha(value.canonicalBaseSha, "bound base"), laneRevision: sha(value.laneRevision, "bound lane"),
    writeSetDigest: digest(value.writeSetDigest, "bound write set"), manifestDigest: digest(value.manifestDigest, "bound manifest"),
    leaseEpoch: positive(value.leaseEpoch, "bound epoch"), reviewRequestId: text(value.reviewRequestId, "bound review request"),
    expiresAt: instant(value.expiresAt, "bound expiry"), authorityDigest: digest(value.authorityDigest, "bound authority"),
  };
  if (authority.canonicalBaseSha !== plan.targetCanonicalBaseSha
    || authority.writeSetDigest !== plan.target.writeSetDigest
    || authority.manifestDigest !== plan.target.manifestDigest
    || authority.leaseEpoch !== plan.targetCloudLeaseEpoch
    || authority.laneRevision !== plan.sourceFenceSha
    || authority.reviewRequestId !== plan.sourceReviewRequestId) invalid("bound authority semantics");
  return deepFreeze(authority);
}

function assertReplacementPhaseJoins(phases, plan) {
  const claimed = phases["replacement-claimed"]?.values;
  const promoted = phases["replacement-promoted"]?.values;
  const bound = phases["replacement-bound"]?.values;
  const local = phases["local-cas"]?.values;
  const marker = phases["pr-marker"]?.values;
  const verified = phases.verified?.values;
  const complete = phases.complete?.values?.receipt;
  if (promoted && (promoted.claim.claimId !== claimed?.claim.claimId
    || (claimed.claim.state === "current"
      ? promoted.promoted !== false || promoted.claim.transitionCounter !== claimed.claim.transitionCounter
      : promoted.promoted !== true || promoted.claim.transitionCounter !== claimed.claim.transitionCounter + 1))) {
    invalid("claim to promotion join");
  }
  if (bound && (bound.authority.claimId !== promoted?.claim.claimId
    || bound.authority.transitionCounter !== promoted.claim.transitionCounter + 1)) {
    invalid("promotion to binding join");
  }
  if (verified && (verified.leaseDigest !== local?.leaseDigest
    || verified.replacementIntentDigest !== local?.replacementIntentDigest
    || verified.taskAuthorityBindingDigest !== local?.taskAuthorityBindingDigest
    || verified.markerDigest !== marker?.markerDigest || verified.bodyDigest !== marker?.bodyDigest
    || verified.dirtDigest !== plan.observation.sourceDirtDigest
    || verified.cloudAuthorityDigest !== bound?.authority.authorityDigest)) {
    invalid("terminal projection join");
  }
  if (complete) {
    const expected = buildCompletionCore({ plan, claimed, bound, local, marker, verified });
    if (canonicalJson(complete) !== canonicalJson(expected)) invalid("completion join");
  }
}
function buildCompletionCore({ plan, claimed, bound, local, marker, verified }) {
  const core = {
    schema: `agentic-${OPERATION}-completion/v1`, status: "successor-replaced",
    planDigest: plan.planDigest, retirementPlanDigest: plan.retirementPlanDigest,
    retirementReceiptDigest: plan.retirementReceiptDigest, sourceClaimId: plan.sourceClaimId,
    retiredStaleSuccessorClaimId: plan.retiredStaleSuccessorClaimId,
    replacementClaimId: claimed.claim.claimId, replacementClaimDigest: bound.authority.claimDigest,
    targetWriteSetDigest: plan.target.writeSetDigest, targetManifestDigest: plan.target.manifestDigest,
    targetLeaseDigest: local.leaseDigest, replacementIntentDigest: local.replacementIntentDigest,
    taskAuthorityBindingDigest: local.taskAuthorityBindingDigest,
    pullRequestMarkerDigest: marker.markerDigest,
    terminalVerificationDigest: verified.verificationDigest,
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function buildSuccessorRolloverCompletionFromIntent(plan, supplied) {
  if (supplied?.schema !== `agentic-${OPERATION}-completion/v1`
    || supplied.planDigest !== plan.planDigest || !DIGEST.test(String(supplied.receiptDigest || ""))) {
    invalid("completion receipt shape");
  }
  return deepFreeze(supplied);
}

function journalForReplacementPlan(plan) {
  const retirementPlan = normalizeSuccessorRolloverRetirementPlan(plan?.retirementPlanSnapshot);
  const retirementValues = plan?.retirementValues;
  if (!retirementValues) invalid("replacement plan retirement snapshot");
  let journal = createSuccessorRolloverJournal(retirementPlan, retirementPlan.exactAuthorization);
  journal = advanceSuccessorRolloverRetirement(journal, retirementValues);
  return journal;
}

function sealPlan(core, operation) {
  const planDigest = digestValue(core);
  return deepFreeze({ ...core, planDigest, exactAuthorization: `authorize ${operation} ${planDigest}` });
}

function authorize(plan, authorization, operation) {
  if (authorization !== plan.exactAuthorization) {
    throw new Error(`Successor rollover requires exact authorization: ${plan.exactAuthorization}`);
  }
  const core = { schema: `agentic-${operation}-authorization/v1`, planDigest: plan.planDigest,
    statement: authorization };
  return deepFreeze({ ...core, authorizationDigest: digestValue(core) });
}

function sealIntent({ kind, status, plan, authorization, phases }) {
  return deepFreeze(sealIntentCore({ kind, status, plan, authorization, phases }));
}
function sealIntentCore({ kind, status, plan, authorization, phases }) {
  const core = { schema: `agentic-${OPERATION}-${kind}-intent/v1`, kind, status,
    planDigest: plan.planDigest, planSnapshot: plan, authorization,
    authorizationDigest: authorization.authorizationDigest, phases };
  return { ...core, intentDigest: digestValue(core) };
}
function sealJournal({ retirement, replacement }) {
  const core = { schema: JOURNAL_SCHEMA, retirement, replacement };
  return deepFreeze({ ...core, journalDigest: digestValue(core) });
}
function strictSubset(left, right) { return left.length < right.length && left.every(item => right.includes(item)); }
function covers(writeSet, item) { return writeSet.some(entry => entry.startsWith("path:")
  && (entry.slice(5) === "." || item === entry.slice(5) || item.startsWith(`${entry.slice(5)}/`))); }
function exactObject(value, label, keys) { if (!value || typeof value !== "object" || Array.isArray(value)
  || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) invalid(label); }
function cloneObject(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label); return structuredClone(value); }
function paths(value, label) { if (!Array.isArray(value) || value.length === 0) invalid(label); return Object.freeze([...new Set(value.map(item => text(item, label)))].sort()); }
function text(value, label) { if (typeof value !== "string" || !value.trim() || value !== value.trim()) invalid(label); return value; }
function digest(value, label) { if (!DIGEST.test(String(value || ""))) invalid(label); return value; }
function sha(value, label) { if (!SHA.test(String(value || ""))) invalid(label); return value; }
function positive(value, label) { if (!Number.isSafeInteger(value) || value < 1) invalid(label); return value; }
function instant(value, label) { if (!Number.isFinite(Date.parse(value)) || new Date(Date.parse(value)).toISOString() !== value) invalid(label); return value; }
function freeze(value) { return Object.freeze(value); }
function deepFreeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; }
function invalid(label) { throw new Error(`Active dirty scope-expansion successor rollover has invalid ${label}.`); }
