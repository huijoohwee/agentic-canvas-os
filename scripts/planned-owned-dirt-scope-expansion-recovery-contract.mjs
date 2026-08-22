// Responsibility: Seal one planned-owned-dirt scope-successor decision and its replay journal.
import { canonicalJson, digestValue, normalizeWriteSet }
  from "./cloud-collaboration-primitives.mjs";
import { normalizeActiveOwnedDirtEvidence }
  from "./active-owned-dirt-recovery-evidence.mjs";

export const OPERATION = "planned-owned-dirt-scope-expansion-recovery";
export const PLAN_SCHEMA =
  "agentic-planned-owned-dirt-scope-expansion-recovery-plan/v1";
export const INTENT_SCHEMA =
  "agentic-planned-owned-dirt-scope-expansion-recovery-intent/v1";
export const COMPLETION_SCHEMA =
  "agentic-planned-owned-dirt-scope-expansion-recovery-completion/v1";
export const PHASES = Object.freeze([
  "authorized", "waiting-successor", "source-retired", "successor-promoted",
  "successor-bound", "local-projected", "pr-marker-projected", "complete",
]);

export function buildPlannedOwnedDirtScopeExpansionRecoveryPlan({ evidence, targetManifest }) {
  const source = normalizeEvidence(evidence);
  const target = normalizeManifest(targetManifest, source.scope);
  if (!strictSubset(source.declaredWriteSet, target.declaredWriteSet)) {
    invalid("target write set must be a strict superset");
  }
  const dirtPaths = [...new Set([...source.changedPaths, ...source.untrackedPaths])].sort();
  if (dirtPaths.length === 0 || !dirtPaths.every(item => covers(target.declaredWriteSet, item))) {
    invalid("target write set must cover every sealed dirty path");
  }
  const core = {
    schema: PLAN_SCHEMA,
    operation: OPERATION,
    evidence: source,
    target: {
      semanticScope: target.semanticScope,
      declaredWriteSet: target.declaredWriteSet,
      writeSetDigest: target.writeSetDigest,
      manifestDigest: target.manifestDigest,
      cloudLeaseEpoch: 1,
    },
    allowedMutations: [
      "cloud-successor-claim", "cloud-source-retirement", "cloud-successor-promotion",
      "cloud-review-binding", "writer-lease-registry-cas", "pull-request-marker",
      "private-replay-journal",
    ],
    forbiddenMutations: [
      "git-head", "git-index", "git-worktree", "local-ref", "remote-ref",
      "pull-request-state", "merge", "deployment", "cleanup",
    ],
  };
  return deepFreeze({ ...core, planDigest: digestValue(core) });
}

export function normalizePlannedOwnedDirtScopeExpansionRecoveryPlan(value) {
  if (value?.schema !== PLAN_SCHEMA || value.operation !== OPERATION) invalid("plan schema");
  const rebuilt = buildPlannedOwnedDirtScopeExpansionRecoveryPlan({
    evidence: value.evidence,
    targetManifest: value.target,
  });
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("canonical plan projection");
  return rebuilt;
}

export function authorizePlannedOwnedDirtScopeExpansionRecovery(plan, authorization) {
  const sealed = normalizePlannedOwnedDirtScopeExpansionRecoveryPlan(plan);
  const exactAuthorization = `authorize ${OPERATION} ${sealed.planDigest}`;
  if (String(authorization || "").trim() !== exactAuthorization) {
    throw new Error(`Planned-owned-dirt scope expansion requires: ${exactAuthorization}`);
  }
  const core = { schema: "agentic-planned-owned-dirt-scope-expansion-authorization/v1",
    planDigest: sealed.planDigest, exactAuthorization };
  return deepFreeze({ ...core, authorizationDigest: digestValue(core) });
}

export function createRecoveryIntent({ plan, authorization, taskAuthority }) {
  const sealed = normalizePlannedOwnedDirtScopeExpansionRecoveryPlan(plan);
  const auth = record(authorization, "authorization receipt");
  const task = record(taskAuthority, "task-authority receipt");
  digest(auth.authorizationDigest, "authorization digest");
  digest(task.receiptDigest, "task-authority receipt digest");
  digest(task.proofDigest, "task-authority proof digest");
  const phase = phaseReceipt(sealed, "authorized", null, {
    authorizationDigest: auth.authorizationDigest,
    taskAuthorityReceiptDigest: task.receiptDigest,
    taskProofDigest: task.proofDigest,
  });
  return sealIntent({ plan: sealed, status: "authorized", phases: { authorized: phase } });
}

export function advanceRecoveryIntent(value, { status, values }) {
  const current = normalizeRecoveryIntent(value);
  const sourceIndex = PHASES.indexOf(current.status);
  if (PHASES.indexOf(status) !== sourceIndex + 1) invalid("phase transition");
  const phase = phaseReceipt(current.planSnapshot, status,
    current.phases[current.status].receiptDigest, values);
  return sealIntent({ plan: current.planSnapshot, status,
    phases: { ...current.phases, [status]: phase } });
}

export function normalizeRecoveryIntent(value) {
  if (value?.schema !== INTENT_SCHEMA || !PHASES.includes(value.status)) invalid("intent");
  const plan = normalizePlannedOwnedDirtScopeExpansionRecoveryPlan(value.planSnapshot);
  const phaseNames = PHASES.slice(0, PHASES.indexOf(value.status) + 1);
  if (canonicalJson(Object.keys(value.phases || {})) !== canonicalJson(phaseNames)) {
    invalid("intent phase set");
  }
  const phases = {};
  let previous = null;
  for (const name of phaseNames) {
    phases[name] = phaseReceipt(plan, name, previous, value.phases[name]?.values);
    previous = phases[name].receiptDigest;
  }
  const rebuilt = sealIntent({ plan, status: value.status, phases });
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("canonical intent projection");
  return rebuilt;
}

export function buildCompletionReceipt(value) {
  const intent = normalizeRecoveryIntent(value);
  if (intent.status !== "complete") invalid("completion phase");
  const terminal = intent.phases.complete.values;
  const core = {
    schema: COMPLETION_SCHEMA,
    status: "mutation-authority-restored",
    planDigest: intent.planDigest,
    sourceClaimId: intent.planSnapshot.evidence.claimId,
    successorClaimId: intent.phases["successor-promoted"].values.claimId,
    targetWriteSetDigest: intent.planSnapshot.target.writeSetDigest,
    sealedDirtDigest: intent.planSnapshot.evidence.dirtDigest,
    mutationAuthorityReceiptDigest: terminal.mutationAuthorityReceiptDigest,
    terminalEvidenceDigest: terminal.terminalEvidenceDigest,
    journalDigest: intent.intentDigest,
    cloudMutation: true,
    writerRegistryMutation: true,
    pullRequestMarkerMutation: true,
    privateJournalMutation: true,
    gitMutation: false,
    indexMutation: false,
    sourceMutation: false,
    localRefMutation: false,
    remoteRefMutation: false,
    pullRequestStateMutation: false,
    mergeMutation: false,
    deploymentMutation: false,
    cleanupMutation: false,
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function normalizeEvidence(value) {
  const source = structuredClone(record(value, "source evidence"));
  const declaredWriteSet = normalizeWriteSet(source.declaredWriteSet);
  const ownedDirt = normalizeActiveOwnedDirtEvidence(source.ownedDirt);
  const core = {
    schema: text(source.schema, "evidence schema"),
    repositoryPathDigest: digest(source.repositoryPathDigest, "repository path digest"),
    targetRepository: text(source.targetRepository, "target repository"),
    ledgerRepository: text(source.ledgerRepository, "ledger repository"),
    branch: text(source.branch, "source branch"),
    sessionId: text(source.sessionId, "source session"),
    device: text(source.device, "source device"),
    scope: text(source.scope, "source scope"),
    baseSha: sha(source.baseSha, "source base SHA"),
    fenceSha: sha(source.fenceSha, "source fence SHA"),
    leaseDigest: digest(source.leaseDigest, "source lease digest"),
    claimId: digest(source.claimId, "source claim ID"),
    claimDigest: digest(source.claimDigest, "source claim digest"),
    claimTransitionCounter: positive(source.claimTransitionCounter, "source transition counter"),
    claimState: ["current", "dormant-preserved"].includes(source.claimState)
      ? source.claimState : invalid("source claim state"),
    reviewRequestId: text(source.reviewRequestId, "review request ID"),
    pullRequestUrl: text(source.pullRequestUrl, "pull request URL"),
    declaredWriteSet,
    writeSetDigest: digest(source.writeSetDigest, "source write-set digest"),
    manifestDigest: digest(source.manifestDigest, "source manifest digest"),
    existingLaneStateDigest: digest(source.existingLaneStateDigest, "lane-state digest"),
    ownedDirt,
    dirtDigest: digest(source.dirtDigest, "owned-dirt digest"),
    changedPaths: paths(source.changedPaths, "changed paths"),
    untrackedPaths: paths(source.untrackedPaths, "untracked paths"),
    taskAuthorityBindingDigest: digest(source.taskAuthorityBindingDigest,
      "task-authority binding digest"),
    cloudLedgerRevision: sha(source.cloudLedgerRevision, "cloud ledger revision"),
    cloudLedgerDigest: digest(source.cloudLedgerDigest, "cloud ledger digest"),
    controllerDigest: digest(source.controllerDigest, "controller digest"),
    observedAt: instant(source.observedAt, "observed instant"),
  };
  if (core.writeSetDigest !== digestValue(declaredWriteSet)
    || core.dirtDigest !== ownedDirt.evidenceDigest) invalid("source evidence join");
  const evidenceDigest = digest(source.evidenceDigest, "evidence digest");
  if (evidenceDigest !== digestValue(core)) invalid("source evidence digest");
  return deepFreeze({ ...core, evidenceDigest });
}

function normalizeManifest(value, expectedScope) {
  const source = record(value, "target manifest");
  const declaredWriteSet = normalizeWriteSet(source.declaredWriteSet ||
    (source.paths || []).map(item => `path:${item}`).concat(`semantic:${source.semanticScope}`));
  const core = { semanticScope: text(source.semanticScope, "target semantic scope"),
    declaredWriteSet, writeSetDigest: source.writeSetDigest || digestValue(declaredWriteSet),
    manifestDigest: source.manifestDigest || digestValue({ schema: source.schema,
      semanticScope: source.semanticScope, paths: source.paths }) };
  if (core.semanticScope !== expectedScope
    || !declaredWriteSet.includes(`semantic:${expectedScope}`)) invalid("target semantic scope");
  digest(core.writeSetDigest, "target write-set digest");
  digest(core.manifestDigest, "target manifest digest");
  if (core.writeSetDigest !== digestValue(declaredWriteSet)) invalid("target write-set digest");
  return deepFreeze(core);
}

function phaseReceipt(plan, phase, previousReceiptDigest, values) {
  if (!PHASES.includes(phase)) invalid("phase");
  const normalizedValues = structuredClone(record(values, `${phase} values`));
  const core = { schema: "agentic-planned-owned-dirt-scope-expansion-phase/v1",
    phase, planDigest: plan.planDigest, previousReceiptDigest,
    operationKey: `${OPERATION}:${phase}:${digestValue({ planDigest: plan.planDigest, phase })}`,
    values: normalizedValues, valuesDigest: digestValue(normalizedValues) };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function sealIntent({ plan, status, phases }) {
  const core = { schema: INTENT_SCHEMA, status, planDigest: plan.planDigest,
    planSnapshot: plan, phases };
  return deepFreeze({ ...core, intentDigest: digestValue(core) });
}
function strictSubset(left, right) {
  return left.length < right.length && left.every(item => right.includes(item));
}
function covers(writeSet, item) {
  return writeSet.some(entry => entry.startsWith("path:") &&
    (entry.slice(5) === "." || item === entry.slice(5) || item.startsWith(`${entry.slice(5)}/`)));
}
function paths(value, label) {
  if (!Array.isArray(value)) invalid(label);
  return [...new Set(value.map(item => text(item, label)))].sort();
}
function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  return value;
}
function text(value, label) { if (typeof value !== "string" || !value.trim()) invalid(label); return value.trim(); }
function sha(value, label) { if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) invalid(label); return value; }
function digest(value, label) { if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) invalid(label); return value; }
function positive(value, label) { if (!Number.isSafeInteger(value) || value < 1) invalid(label); return value; }
function instant(value, label) { if (!Number.isFinite(Date.parse(value))) invalid(label); return value; }
function invalid(label) { throw new Error(`Planned-owned-dirt scope expansion has invalid ${label}.`); }
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); return value;
}
