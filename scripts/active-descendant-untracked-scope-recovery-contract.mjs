// Responsibility: Seal exact authorization, monotonic phases, and authoring-only completion.
import {
  canonicalJson,
  digestValue,
} from "./cloud-collaboration-primitives.mjs";
import { normalizeActiveDescendantUntrackedScopeRecoveryEvidence }
  from "./active-descendant-untracked-scope-recovery-evidence.mjs";

export const OPERATION = "active-descendant-untracked-scope-recovery";
export const PLAN_SCHEMA = `agentic-${OPERATION}-plan/v1`;
export const AUTHORIZATION_SCHEMA = `agentic-${OPERATION}-authorization/v1`;
export const INTENT_SCHEMA = `agentic-${OPERATION}-intent/v1`;
export const COMPLETION_SCHEMA = `agentic-${OPERATION}-completion/v1`;
export const PHASES = Object.freeze([
  "authorized",
  "task-authority-verified",
  "successor-waiting",
  "source-retired",
  "successor-current",
  "successor-bound",
  "local-cas",
  "verified",
  "complete",
]);

const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;

export function buildActiveDescendantUntrackedScopeRecoveryPlan({
  evidence,
  ttlSeconds = 1_800,
} = {}) {
  const source = normalizeActiveDescendantUntrackedScopeRecoveryEvidence(evidence);
  const ttl = boundedTtl(ttlSeconds);
  const core = {
    schema: PLAN_SCHEMA,
    operation: OPERATION,
    evidence: source,
    evidenceDigest: source.evidenceDigest,
    ttlSeconds: ttl,
    sourceClaimId: source.claim.claimId,
    sourceClaimDigest: source.claim.claimDigest,
    sourceTransitionCounter: source.claim.transitionCounter,
    sourceLeaseDigest: source.leaseDigest,
    sourceTaskAuthorityBindingDigest: source.taskAuthorityBindingDigest,
    sourceBaseSha: source.lease.baseSha,
    sourceFenceSha: source.lane.remoteFenceSha,
    sourceHeadSha: source.lane.headSha,
    sourceHeadTreeSha: source.lane.headTreeSha,
    sourceIndexEvidenceDigest: indexEvidenceDigest(source.dirt),
    sourceDirtEvidenceDigest: source.dirt.evidenceDigest,
    sourceReviewRequestId: source.pullRequest.id,
    pullRequestIdentityDigest:
      activeDescendantUntrackedPullRequestIdentityDigest(source.pullRequest),
    targetCloudLeaseEpoch: 1,
    targetManifestDigest: source.targetManifest.manifestDigest,
    targetWriteSetDigest: source.targetManifest.writeSetDigest,
    targetDeclaredWriteSet: source.targetManifest.declaredWriteSet,
    targetAvailabilityReceiptDigest: source.targetAvailability.receiptDigest,
    ownerStopReceiptDigest: source.ownerStop.receiptDigest,
    successorOwner: {
      sessionId: source.lease.sessionId,
      device: source.lease.device,
      branch: source.lane.branch,
      scope: source.lease.scope,
    },
    allowedMutations: [
      "private-replay-journal",
      "task-authority-proof",
      "cloud-waiting-successor",
      "cloud-source-retirement",
      "cloud-successor-promotion",
      "cloud-successor-review-binding",
      "writer-registry-cas",
    ],
    forbiddenMutations: [
      "source-bytes",
      "index",
      "head",
      "local-ref",
      "remote-ref",
      "commit",
      "push",
      "pull-request-body",
      "pull-request-marker",
      "pull-request-state",
      "review",
      "integration",
      "merge",
      "deployment",
      "cleanup",
    ],
  };
  const planDigest = digestValue(core);
  return deepFreeze({ ...core, planDigest,
    exactAuthorization: `authorize ${OPERATION} ${planDigest}` });
}

export function normalizeActiveDescendantUntrackedScopeRecoveryPlan(value) {
  if (value?.schema !== PLAN_SCHEMA || value.operation !== OPERATION) invalid("plan schema");
  const rebuilt = buildActiveDescendantUntrackedScopeRecoveryPlan({
    evidence: value.evidence,
    ttlSeconds: value.ttlSeconds,
  });
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("canonical plan projection");
  return rebuilt;
}

export function authorizeActiveDescendantUntrackedScopeRecovery(plan, authorization) {
  const source = normalizeActiveDescendantUntrackedScopeRecoveryPlan(plan);
  if (authorization !== source.exactAuthorization) {
    throw new Error(`Recovery requires exact authorization: ${source.exactAuthorization}`);
  }
  const core = {
    schema: AUTHORIZATION_SCHEMA,
    status: "authorized",
    planDigest: source.planDigest,
    statement: authorization,
  };
  return deepFreeze({ ...core, authorizationDigest: digestValue(core) });
}

export function createActiveDescendantUntrackedScopeRecoveryIntent({
  plan,
  authorizationReceipt,
} = {}) {
  const source = normalizeActiveDescendantUntrackedScopeRecoveryPlan(plan);
  const authorization = normalizeAuthorization(authorizationReceipt, source);
  const values = { authorizationDigest: authorization.authorizationDigest };
  const phases = { authorized: phaseReceipt(source, "authorized", null, values, {}) };
  return sealIntent({ phase: "authorized", plan: source, authorization, phases,
    completion: null });
}

export function advanceActiveDescendantUntrackedScopeRecoveryIntent(
  value,
  { phase, values } = {},
) {
  const current = normalizeActiveDescendantUntrackedScopeRecoveryIntent(value);
  if (PHASES.indexOf(phase) !== PHASES.indexOf(current.phase) + 1) {
    throw new Error("Recovery cannot skip or regress a protected phase.");
  }
  const previousReceiptDigest = current.phases[current.phase].receiptDigest;
  const receipt = phaseReceipt(current.planSnapshot, phase, previousReceiptDigest,
    values, current.phases);
  const phases = { ...current.phases, [phase]: receipt };
  return sealIntent({ phase, plan: current.planSnapshot,
    authorization: current.authorization, phases,
    completion: phase === "complete" ? receipt.values : null });
}

export function normalizeActiveDescendantUntrackedScopeRecoveryIntent(value) {
  if (value?.schema !== INTENT_SCHEMA || !PHASES.includes(value.phase)) {
    invalid("intent schema");
  }
  const plan = normalizeActiveDescendantUntrackedScopeRecoveryPlan(value.planSnapshot);
  const authorization = normalizeAuthorization(value.authorization, plan);
  const names = PHASES.slice(0, PHASES.indexOf(value.phase) + 1);
  if (canonicalJson(Object.keys(value.phases || {})) !== canonicalJson(names)) {
    invalid("intent phase inventory");
  }
  const phases = {};
  let previousReceiptDigest = null;
  for (const name of names) {
    phases[name] = phaseReceipt(plan, name, previousReceiptDigest,
      value.phases[name]?.values, phases);
    previousReceiptDigest = phases[name].receiptDigest;
  }
  const rebuilt = sealIntent({ phase: value.phase, plan, authorization, phases,
    completion: value.phase === "complete" ? phases.complete.values : null });
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("canonical intent projection");
  return rebuilt;
}

export function activeDescendantUntrackedScopeRecoveryOperationKey(plan, phase) {
  const source = normalizeActiveDescendantUntrackedScopeRecoveryPlan(plan);
  if (!PHASES.includes(phase)) invalid("operation phase");
  return `${OPERATION}:${phase}:${digestValue({ planDigest: source.planDigest, phase })}`;
}

export function stableActiveDescendantUntrackedTerminalDigest(value) {
  const wrapper = record(value, "terminal values");
  const terminal = normalizeTerminalEvidence(wrapper.terminalEvidence ?? wrapper);
  const terminalDigest = stableTerminalDigest(terminal);
  if (wrapper.terminalEvidence) {
    if (digest(wrapper.terminalEvidenceDigest, "terminal evidence digest") !== terminalDigest
      || wrapper.mutationAuthorityReceiptDigest !== terminal.mutationAuthorityReceiptDigest
      || wrapper.cloudVerificationReceiptDigest !== terminal.cloudVerificationReceiptDigest
      || !DIGEST.test(String(wrapper.receiptDigest || ""))) invalid("terminal wrapper");
  }
  return terminalDigest;
}

export function activeDescendantUntrackedPullRequestIdentityDigest(pullRequest) {
  const source = record(pullRequest, "pull-request identity");
  return digestValue({
    repository: text(source.repository, "pull-request repository"),
    id: text(source.id, "pull-request ID"),
    number: positive(source.number, "pull-request number"),
    url: text(source.url, "pull-request URL"),
    state: text(source.state, "pull-request state"),
    draft: boolean(source.draft, "pull-request draft state"),
    autoDelivery: source.autoDelivery ?? null,
    branch: text(source.branch, "pull-request branch"),
    headSha: sha(source.headSha, "pull-request head"),
    baseSha: sha(source.baseSha, "pull-request base"),
  });
}

export function buildActiveDescendantUntrackedScopeRecoveryReceipt(value) {
  const intent = normalizeActiveDescendantUntrackedScopeRecoveryIntent(value);
  if (intent.phase !== "complete") invalid("completion phase");
  const plan = intent.planSnapshot;
  const terminal = intent.phases.verified.values.terminalEvidence;
  const core = {
    schema: COMPLETION_SCHEMA,
    status: "authoring-authority-restored",
    planDigest: plan.planDigest,
    sourceClaimId: plan.sourceClaimId,
    successorClaimId: terminal.successorClaimId,
    successorClaimDigest: terminal.successorClaimDigest,
    successorTransitionCounter: terminal.successorTransitionCounter,
    sourceHeadSha: plan.sourceHeadSha,
    targetWriteSetDigest: plan.targetWriteSetDigest,
    targetManifestDigest: plan.targetManifestDigest,
    sourceDirtEvidenceDigest: plan.sourceDirtEvidenceDigest,
    ownerStopReceiptDigest: plan.ownerStopReceiptDigest,
    targetLeaseDigest: terminal.targetLeaseDigest,
    registryDigest: terminal.registryDigest,
    mutationAuthorityReceiptDigest: terminal.mutationAuthorityReceiptDigest,
    cloudVerificationReceiptDigest: terminal.cloudVerificationReceiptDigest,
    terminalEvidenceDigest: intent.phases.verified.values.terminalEvidenceDigest,
    journalDigest: intent.intentDigest,
    mutationAuthorityGranted: true,
    authoringAuthority: true,
    reviewAuthority: false,
    integrationAuthority: false,
    deploymentAuthority: false,
    cleanupAuthority: false,
    pullRequestMutation: false,
    providerProjection: "deferred",
    crossDeviceResumeAuthority: false,
    sourceMutation: false,
    indexMutation: false,
    headMutation: false,
    localRefMutation: false,
    remoteRefMutation: false,
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function phaseReceipt(plan, phase, previousReceiptDigest, values, priorPhases) {
  const normalizedValues = normalizePhaseValues(plan, phase, values, priorPhases);
  const core = {
    schema: `agentic-${OPERATION}-phase/v1`,
    phase,
    planDigest: plan.planDigest,
    operationKey: activeDescendantUntrackedScopeRecoveryOperationKey(plan, phase),
    previousReceiptDigest,
    values: normalizedValues,
    valuesDigest: digestValue(normalizedValues),
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function normalizePhaseValues(plan, phase, values, prior) {
  const source = record(values, `${phase} values`);
  if (phase === "authorized") {
    exactKeys(source, ["authorizationDigest"], phase);
    return deepFreeze({ authorizationDigest: digest(source.authorizationDigest,
      "authorization digest") });
  }
  if (phase === "task-authority-verified") {
    exactKeys(source, ["taskAuthorityReceiptDigest", "taskAuthorityProofDigest",
      "sourceTaskAuthorityBindingDigest"], phase);
    const result = mapDigests(source, Object.keys(source), phase);
    if (result.sourceTaskAuthorityBindingDigest !== plan.sourceTaskAuthorityBindingDigest) {
      invalid("source task-authority binding");
    }
    return result;
  }
  if (phase === "successor-waiting" || phase === "successor-current") {
    const keys = ["claimId", "claimDigest", "transitionCounter", "state",
      "predecessorClaimId", "writeSetDigest", "laneRevision",
      "operationReceiptDigest", "receiptDigest"];
    exactKeys(source, keys, phase);
    const result = successorValues(source);
    const waiting = prior["successor-waiting"]?.values;
    if (result.predecessorClaimId !== plan.sourceClaimId
      || result.writeSetDigest !== plan.targetWriteSetDigest
      || result.laneRevision !== plan.sourceFenceSha
      || (phase === "successor-waiting"
        && (result.state !== "waiting-successor" || result.transitionCounter !== 1))
      || (phase === "successor-current"
        && (result.state !== "current" || result.claimId !== waiting?.claimId
          || result.transitionCounter !== waiting.transitionCounter + 1))) {
      invalid(`${phase} successor transition`);
    }
    return result;
  }
  if (phase === "source-retired") {
    const keys = ["sourceClaimId", "sourceClaimDigest", "transitionCounter", "state",
      "operationReceiptDigest", "receiptDigest"];
    exactKeys(source, keys, phase);
    const result = { sourceClaimId: digest(source.sourceClaimId, "retired claim ID"),
      sourceClaimDigest: digest(source.sourceClaimDigest, "retired claim digest"),
      transitionCounter: positive(source.transitionCounter, "retired transition"),
      state: text(source.state, "retired state"),
      operationReceiptDigest: digest(source.operationReceiptDigest,
        "retirement operation receipt"),
      receiptDigest: digest(source.receiptDigest, "retirement receipt") };
    if (result.sourceClaimId !== plan.sourceClaimId
      || !["retired", "released"].includes(result.state)
      || result.transitionCounter !== plan.sourceTransitionCounter + 1) {
      invalid("source retirement transition");
    }
    return deepFreeze(result);
  }
  if (phase === "successor-bound") {
    const keys = ["authority", "claimId", "claimDigest", "transitionCounter", "state",
      "laneRevision", "reviewRequestId", "operationReceiptDigest",
      "verificationReceiptDigest", "receiptDigest"];
    exactKeys(source, keys, phase);
    const authority = deepFreeze(structuredClone(record(source.authority, "bound authority")));
    const current = prior["successor-current"]?.values;
    const result = { authority,
      claimId: digest(source.claimId, "bound claim ID"),
      claimDigest: digest(source.claimDigest, "bound claim digest"),
      transitionCounter: positive(source.transitionCounter, "bound transition"),
      state: text(source.state, "bound state"),
      laneRevision: sha(source.laneRevision, "bound lane revision"),
      reviewRequestId: text(source.reviewRequestId, "bound review request"),
      operationReceiptDigest: digest(source.operationReceiptDigest,
        "bound operation receipt"),
      verificationReceiptDigest: digest(source.verificationReceiptDigest,
        "bound verification receipt"),
      receiptDigest: digest(source.receiptDigest, "bound receipt") };
    if (result.claimId !== current?.claimId || result.state !== "current"
      || result.transitionCounter !== current.transitionCounter + 1
      || result.laneRevision !== plan.sourceFenceSha
      || result.reviewRequestId !== plan.sourceReviewRequestId
      || authority.claimId !== result.claimId || authority.claimDigest !== result.claimDigest
      || authority.transitionCounter !== result.transitionCounter
      || authority.laneRevision !== result.laneRevision
      || authority.reviewRequestId !== result.reviewRequestId) invalid("bound successor");
    return deepFreeze(result);
  }
  if (phase === "local-cas") {
    const keys = ["leaseDigest", "registryRevision", "taskAuthorityBindingDigest",
      "mutationAuthorityReceiptDigest", "adopted", "receiptDigest"];
    exactKeys(source, keys, phase);
    return deepFreeze({ leaseDigest: digest(source.leaseDigest, "target lease digest"),
      registryRevision: nonnegative(source.registryRevision, "target registry revision"),
      taskAuthorityBindingDigest: digest(source.taskAuthorityBindingDigest,
        "target task-authority binding"),
      mutationAuthorityReceiptDigest: digest(source.mutationAuthorityReceiptDigest,
        "mutation-authority receipt"), adopted: boolean(source.adopted, "local CAS adoption"),
      receiptDigest: digest(source.receiptDigest, "local CAS receipt") });
  }
  if (phase === "verified") {
    const keys = ["terminalEvidence", "terminalEvidenceDigest",
      "mutationAuthorityReceiptDigest", "cloudVerificationReceiptDigest",
      "receiptDigest"];
    exactKeys(source, keys, phase);
    const terminalEvidence = normalizeTerminalEvidence(source.terminalEvidence);
    const result = { terminalEvidence,
      terminalEvidenceDigest: digest(source.terminalEvidenceDigest,
        "terminal evidence digest"),
      mutationAuthorityReceiptDigest: digest(source.mutationAuthorityReceiptDigest,
        "terminal mutation-authority receipt"),
      cloudVerificationReceiptDigest: digest(source.cloudVerificationReceiptDigest,
        "terminal cloud verification receipt"),
      receiptDigest: digest(source.receiptDigest, "terminal verification receipt") };
    if (result.terminalEvidenceDigest !== stableTerminalDigest(terminalEvidence)
      || result.mutationAuthorityReceiptDigest !== terminalEvidence.mutationAuthorityReceiptDigest
      || result.cloudVerificationReceiptDigest !== terminalEvidence.cloudVerificationReceiptDigest) {
      invalid("terminal evidence wrapper");
    }
    assertTerminalJoins(plan, terminalEvidence, prior);
    return deepFreeze(result);
  }
  if (phase === "complete") {
    exactKeys(source, [], phase);
    if (!prior.verified) invalid("verified completion predecessor");
    return deepFreeze({});
  }
  invalid("phase values");
}

function normalizeTerminalEvidence(value) {
  const source = record(value, "terminal evidence");
  const digestFields = ["sourceIndexEvidenceDigest", "sourceDirtEvidenceDigest",
    "successorClaimId", "successorClaimDigest", "targetWriteSetDigest",
    "targetManifestDigest", "sourceLeaseDigest", "targetLeaseDigest", "registryDigest",
    "pullRequestIdentityDigest", "taskAuthorityReceiptDigest",
    "mutationAuthorityReceiptDigest", "cloudVerificationReceiptDigest"];
  const keys = ["sourceHeadSha", ...digestFields, "successorTransitionCounter",
    "successorLaneRevision", "registryRevision", "verifiedAt", "sourceMutation",
    "indexMutation", "headMutation", "localRefMutation", "remoteRefMutation",
    "commitMutation", "pushMutation", "authoringAuthority", "reviewAuthority",
    "integrationAuthority", "deploymentAuthority", "cleanupAuthority",
    "pullRequestMutation", "providerProjection", "crossDeviceResumeAuthority"];
  exactKeys(source, keys, "terminal evidence");
  const result = { ...mapDigests(source, digestFields, "terminal evidence") };
  Object.assign(result, {
    sourceHeadSha: sha(source.sourceHeadSha, "terminal source HEAD"),
    successorTransitionCounter: positive(source.successorTransitionCounter,
      "terminal successor transition"),
    successorLaneRevision: sha(source.successorLaneRevision,
      "terminal successor lane revision"),
    registryRevision: nonnegative(source.registryRevision, "terminal registry revision"),
    verifiedAt: instant(source.verifiedAt, "terminal verification instant"),
    providerProjection: text(source.providerProjection, "terminal provider projection"),
  });
  for (const key of ["sourceMutation", "indexMutation", "headMutation",
    "localRefMutation", "remoteRefMutation", "commitMutation", "pushMutation",
    "authoringAuthority", "reviewAuthority", "integrationAuthority",
    "deploymentAuthority", "cleanupAuthority", "pullRequestMutation",
    "crossDeviceResumeAuthority"]) {
    result[key] = boolean(source[key], `terminal ${key}`);
  }
  if (["sourceMutation", "indexMutation", "headMutation", "localRefMutation",
    "remoteRefMutation", "commitMutation", "pushMutation", "reviewAuthority",
    "integrationAuthority", "deploymentAuthority", "cleanupAuthority"]
    .some(key => result[key] !== false) || result.authoringAuthority !== true) {
    invalid("authoring-only terminal boundary");
  }
  if (result.providerProjection !== "deferred" || result.pullRequestMutation !== false
    || result.crossDeviceResumeAuthority !== false) {
    invalid("deferred provider terminal boundary");
  }
  return deepFreeze(result);
}

function assertTerminalJoins(plan, terminal, prior) {
  const task = prior["task-authority-verified"].values;
  const bound = prior["successor-bound"].values;
  const local = prior["local-cas"].values;
  if (terminal.sourceHeadSha !== plan.sourceHeadSha
    || terminal.sourceIndexEvidenceDigest !== plan.sourceIndexEvidenceDigest
    || terminal.sourceDirtEvidenceDigest !== plan.sourceDirtEvidenceDigest
    || terminal.successorClaimId !== bound.claimId
    || terminal.successorClaimDigest !== bound.claimDigest
    || terminal.successorTransitionCounter !== bound.transitionCounter
    || terminal.successorLaneRevision !== bound.laneRevision
    || terminal.targetWriteSetDigest !== plan.targetWriteSetDigest
    || terminal.targetManifestDigest !== plan.targetManifestDigest
    || terminal.sourceLeaseDigest !== plan.sourceLeaseDigest
    || terminal.targetLeaseDigest !== local.leaseDigest
    || terminal.registryRevision !== local.registryRevision
    || terminal.pullRequestIdentityDigest !== plan.pullRequestIdentityDigest
    || terminal.taskAuthorityReceiptDigest !== task.taskAuthorityReceiptDigest
    || terminal.mutationAuthorityReceiptDigest !== local.mutationAuthorityReceiptDigest) {
    invalid("terminal plan and phase joins");
  }
}

function stableTerminalDigest(value) {
  const {
    verifiedAt: _verifiedAt,
    cloudVerificationReceiptDigest: _cloudVerificationReceiptDigest,
    mutationAuthorityReceiptDigest: _mutationAuthorityReceiptDigest,
    ...stable
  } = value;
  return digestValue(stable);
}

function normalizeAuthorization(value, plan) {
  const source = record(value, "authorization receipt");
  const core = { schema: source.schema, status: source.status,
    planDigest: digest(source.planDigest, "authorization plan digest"),
    statement: text(source.statement, "authorization statement") };
  if (core.schema !== AUTHORIZATION_SCHEMA || core.status !== "authorized"
    || core.planDigest !== plan.planDigest || core.statement !== plan.exactAuthorization
    || digest(source.authorizationDigest, "authorization digest") !== digestValue(core)) {
    invalid("authorization receipt");
  }
  return deepFreeze({ ...core, authorizationDigest: source.authorizationDigest });
}

function successorValues(source) {
  return deepFreeze({ claimId: digest(source.claimId, "successor claim ID"),
    claimDigest: digest(source.claimDigest, "successor claim digest"),
    transitionCounter: positive(source.transitionCounter, "successor transition"),
    state: text(source.state, "successor state"),
    predecessorClaimId: digest(source.predecessorClaimId, "successor predecessor"),
    writeSetDigest: digest(source.writeSetDigest, "successor write set"),
    laneRevision: sha(source.laneRevision, "successor lane revision"),
    operationReceiptDigest: digest(source.operationReceiptDigest,
      "successor operation receipt"),
    receiptDigest: digest(source.receiptDigest, "successor receipt") });
}

function indexEvidenceDigest(dirt) {
  return digestValue(dirt.entries.map(entry => ({ path: entry.path, staged: entry.staged,
    indexMode: entry.indexMode, indexBlob: entry.indexBlob })));
}

function sealIntent({ phase, plan, authorization, phases, completion }) {
  const core = { schema: INTENT_SCHEMA, phase, planDigest: plan.planDigest,
    planSnapshot: plan, authorization,
    authorizationDigest: authorization.authorizationDigest, phases, completion };
  return deepFreeze({ ...core, intentDigest: digestValue(core) });
}

function mapDigests(source, keys, label) {
  return deepFreeze(Object.fromEntries(keys.map(key => [key,
    digest(source[key], `${label} ${key}`)])));
}
function exactKeys(value, expected, label) {
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson([...expected].sort())) {
    invalid(`${label} fields`);
  }
}
function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  return value;
}
function text(value, label) {
  if (typeof value !== "string" || !value.trim()) invalid(label);
  return value.trim();
}
function sha(value, label) { if (!SHA.test(String(value || ""))) invalid(label); return value; }
function digest(value, label) {
  if (!DIGEST.test(String(value || ""))) invalid(label);
  return value;
}
function positive(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) invalid(label);
  return value;
}
function nonnegative(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) invalid(label);
  return value;
}
function boolean(value, label) {
  if (typeof value !== "boolean") invalid(label);
  return value;
}
function instant(value, label) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) invalid(label);
  return value;
}
function boundedTtl(value) {
  if (!Number.isSafeInteger(value) || value < 60 || value > 86_400) {
    invalid("TTL seconds");
  }
  return value;
}
function invalid(label) {
  throw new Error(`Active-descendant untracked scope recovery has invalid ${label}.`);
}
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
