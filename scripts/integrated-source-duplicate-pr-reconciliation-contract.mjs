// Responsibility: Seal one exact integrated-source duplicate-PR terminal reconciliation.
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import { projectWriterLeasePullRequestMarker } from "./writer-lease-lib.mjs";

export const OPERATION = "integrated-source-duplicate-pr-reconciliation";
export const EVIDENCE_SCHEMA = `agentic-${OPERATION}-evidence/v1`;
export const PLAN_SCHEMA = `agentic-${OPERATION}-plan/v1`;
export const AUTHORIZATION_SCHEMA = `agentic-${OPERATION}-authorization/v1`;
export const INTENT_SCHEMA = `agentic-${OPERATION}-intent/v1`;
export const PHASE_RECEIPT_SCHEMA = `agentic-${OPERATION}-phase-receipt/v1`;
export const TERMINAL_EVIDENCE_SCHEMA = `agentic-${OPERATION}-terminal-evidence/v1`;
export const RECEIPT_SCHEMA = `agentic-${OPERATION}-receipt/v1`;
export const LOCAL_LEASE_RELEASE_PLAN_SCHEMA = `agentic-${OPERATION}-local-lease-release-plan/v1`;
export const PHASES = Object.freeze(["authorized", "task-authority-verified", "close-intent",
  "pull-request-closed", "release-intent", "lease-released", "complete"]);
export const FIXED_SUBJECT = freeze({ sourcePullRequestNumber: 736, integratedPullRequestNumber: 735,
  sourceHeadSha: "d6e0b51ee517d270ab1e5f08fc7dc4c905244b0f",
  sourceTreeSha: "21d141c40bfa23bed22a98ce945b9eed688d46dd",
  integratedSquashSha: "f9cea12ecf8af5949a6ab54e8b96494d8850c441",
  claimId: "2523a888a28f3e01b318c512c80ef5b4207357abe823782c4ec5a520fd8cc2af" });
export const PRESERVATION = freeze({ sourceCommit: "byte-exact", sourceTree: "byte-exact",
  sourceBranch: "preserved", remoteBranch: "preserved", sourceWorktree: "preserved",
  sourcePullRequestBody: "preserved", legacyCheckpoint: "preserved", taskAuthority: "preserved",
  cloudLedger: "read-only", protectedMain: "not-pushed", cleanup: "not-performed",
  deployment: "not-performed" });
export const EFFECTS = freeze({ providerPullRequest: "close-source-unmerged",
  localWriterLease: "release-preserved", pullRequestBodyEdit: false, cloudMutation: false,
  gitMutation: false, sourceMutation: false, integration: false, productionRelease: false,
  deployment: false, cleanup: false });

const SHA = /^[0-9a-f]{40}$/u, DIGEST = /^[0-9a-f]{64}$/u;
const CHECKPOINT_SCHEMA = "agentic-legacy-clean-committed-lane-bootstrap-checkpoint/v1";

export function buildPlan(input = {}) {
  const evidence = normalizeEvidence(Object.hasOwn(input, "evidence") ? input.evidence : input);
  const core = { schema: PLAN_SCHEMA, operation: OPERATION, evidence,
    evidenceDigest: evidence.evidenceDigest, preservation: PRESERVATION, effects: EFFECTS };
  return freeze({ ...core, planDigest: digestValue(core) });
}
export function normalizePlan(value) {
  keys(value, ["schema", "operation", "evidence", "evidenceDigest", "preservation", "effects",
    "planDigest"], "plan");
  const result = buildPlan(value.evidence);
  if (canonicalJson(value) !== canonicalJson(result)) bad("plan projection");
  return result;
}
export function authorizationForPlan(planOrDigest) {
  const planDigest = typeof planOrDigest === "string" ? dg(planOrDigest, "plan digest")
    : normalizePlan(planOrDigest).planDigest;
  return `authorize ${OPERATION} ${planDigest}`;
}
export function authorizePlan(plan, authorization) {
  const sealed = normalizePlan(plan), exactAuthorization = authorizationForPlan(sealed);
  if (authorization !== exactAuthorization) throw new Error(`Exact authorization required: ${exactAuthorization}`);
  const core = { schema: AUTHORIZATION_SCHEMA, operation: OPERATION,
    planDigest: sealed.planDigest, exactAuthorization };
  return freeze({ ...core, authorizationDigest: digestValue(core) });
}
export function createAuthorizationIntent({ plan, authorization } = {}) {
  const sealed = normalizePlan(plan), authorized = authorizePlan(sealed, authorization);
  const first = phaseReceipt({ plan: sealed, phase: "authorized",
    values: { authorizationDigest: authorized.authorizationDigest } });
  return sealIntent(sealed, "authorized", { authorized: first });
}
export function normalizeIntent(value) {
  keys(value, ["schema", "phase", "planDigest", "planSnapshot", "receipts", "intentDigest"], "intent");
  if (value.schema !== INTENT_SCHEMA || !PHASES.includes(value.phase)) bad("intent phase");
  const plan = normalizePlan(value.planSnapshot), names = PHASES.slice(0, PHASES.indexOf(value.phase) + 1);
  if (value.planDigest !== plan.planDigest) bad("intent plan join");
  keys(value.receipts, names, "intent receipts");
  const receipts = Object.fromEntries(names.map(name =>
    [name, normalizePhaseReceipt(value.receipts[name], plan, name)]));
  lineage(plan, receipts);
  const result = sealIntent(plan, value.phase, receipts);
  if (canonicalJson(value) !== canonicalJson(result)) bad("intent projection");
  return result;
}
export function phaseReceipt({ plan, phase, values } = {}) {
  const sealed = normalizePlan(plan), name = phaseName(phase), normalized = phaseValues(name, values, sealed);
  const core = { schema: PHASE_RECEIPT_SCHEMA, phase: name, planDigest: sealed.planDigest,
    operationKey: operationForPlan(sealed, name), values: normalized, valuesDigest: digestValue(normalized) };
  return freeze({ ...core, receiptDigest: digestValue(core) });
}
export function advanceIntent({ intent, phase, receipt } = {}) {
  const current = normalizeIntent(intent), name = phaseName(phase);
  if (PHASES.indexOf(name) !== PHASES.indexOf(current.phase) + 1) bad("phase transition");
  const receipts = { ...current.receipts,
    [name]: normalizePhaseReceipt(receipt, current.planSnapshot, name) };
  lineage(current.planSnapshot, receipts);
  return sealIntent(current.planSnapshot, name, receipts);
}
export function operationForPlan(planOrDigest, phase) {
  const planDigest = typeof planOrDigest === "string" ? dg(planOrDigest, "operation plan")
    : normalizePlan(planOrDigest).planDigest, name = tx(phase, "operation phase");
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(name)) bad("operation phase");
  return `${OPERATION}:${planDigest}:${name}`;
}
export function buildTerminalReceipt({ intent, terminalEvidence } = {}) {
  const current = normalizeIntent(intent);
  if (!["lease-released", "complete"].includes(current.phase)) bad("terminal receipt phase");
  const supplied = terminalEvidence ?? current.receipts.complete?.values.terminalEvidence;
  return makeTerminalReceipt(current, normalizeTerminalEvidence(supplied, current.planSnapshot));
}

export function normalizeEvidence(value) {
  keys(value, ["observedAt", "repository", "controller", "source", "sourcePullRequest",
    "mergedPullRequest", "claim", "lease", "checkpoint", "preservation", "effects"],
  "evidence", ["schema", "evidenceDigest"]);
  const core = { schema: EVIDENCE_SCHEMA, observedAt: ins(value.observedAt, "observedAt"),
    repository: repository(value.repository), controller: controller(value.controller),
    source: source(value.source), sourcePullRequest: sourcePr(value.sourcePullRequest),
    mergedPullRequest: mergedPr(value.mergedPullRequest), claim: claim(value.claim),
    lease: lease(value.lease), checkpoint: checkpoint(value.checkpoint),
    preservation: constant(value.preservation, PRESERVATION, "preservation"),
    effects: constant(value.effects, EFFECTS, "effects") };
  evidenceJoins(core);
  const evidenceDigest = digestValue(core);
  if (value.schema !== undefined && value.schema !== EVIDENCE_SCHEMA) bad("evidence schema");
  if (value.evidenceDigest !== undefined && value.evidenceDigest !== evidenceDigest) bad("evidence digest");
  return freeze({ ...core, evidenceDigest });
}
export function normalizeTerminalEvidence(value, planValue) {
  const plan = normalizePlan(planValue);
  keys(value, ["schema", "planDigest", "source", "sourcePullRequest", "mergedPullRequest",
    "claim", "lease", "checkpoint", "preservation", "effects", "terminalEvidenceDigest"],
  "terminal evidence");
  const core = { schema: TERMINAL_EVIDENCE_SCHEMA, planDigest: dg(value.planDigest, "terminal plan"),
    source: terminalSource(value.source), sourcePullRequest: terminalSourcePr(value.sourcePullRequest),
    mergedPullRequest: terminalMergedPr(value.mergedPullRequest), claim: terminalClaim(value.claim),
    lease: terminalLease(value.lease), checkpoint: terminalCheckpoint(value.checkpoint),
    preservation: constant(value.preservation, PRESERVATION, "terminal preservation"),
    effects: constant(value.effects, EFFECTS, "terminal effects") };
  if (value.schema !== TERMINAL_EVIDENCE_SCHEMA || core.planDigest !== plan.planDigest
    || value.terminalEvidenceDigest !== digestValue(core)) bad("terminal evidence seal");
  terminalJoins(core, plan);
  return freeze({ ...core, terminalEvidenceDigest: value.terminalEvidenceDigest });
}

function repository(value) {
  const result = shape(value, { root: abs, nameWithOwner: tx }, "repository");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(result.nameWithOwner)) bad("repository name");
  return result;
}
function controller(value) {
  const result = shape(value, { root: abs, headSha: sh, originMainSha: sh, treeSha: sh,
    runtimeDigest: dg, clean: yes, protected: yes }, "controller");
  if (!result.clean || !result.protected || result.headSha !== result.originMainSha) bad("protected controller");
  return result;
}
function source(value) {
  const result = shape(value, { worktreePath: abs, branch: br, headSha: sh, treeSha: sh,
    baseSha: sh, localBranchSha: sh, remoteBranchSha: sh, parentShas: shaArray,
    changedPaths: paths, changedPathsDigest: dg, statusDigest: dg, clean: yes, registered: yes }, "source");
  if (!result.clean || !result.registered || result.parentShas.length !== 1
    || result.parentShas[0] !== result.baseSha || result.changedPaths.length < 1
    || result.changedPathsDigest !== digestValue(result.changedPaths)
    || result.localBranchSha !== result.headSha || result.remoteBranchSha !== result.headSha) bad("source projection");
  return result;
}
function sourcePr(value) {
  const result = shape(value, { number: pos, nodeId: tx, url: tx, state: tx, isDraft: yes,
    mergedAt: nullInstant, closedAt: nullInstant, autoMergeRequest: nullableRecord,
    headRepository: tx, headBranch: br, headSha: sh, baseRepository: tx, baseBranch: br,
    baseSha: sh, bodyDigest: dg, markerDigest: dg, markerMode: tx }, "source PR");
  if (result.state !== "OPEN" || !result.isDraft || result.mergedAt !== null || result.closedAt !== null
    || result.autoMergeRequest !== null || result.baseBranch !== "main"
    || result.markerMode !== "pre-task-authority-migration") bad("open duplicate PR");
  return result;
}
function mergedPr(value) {
  const result = shape(value, { number: pos, nodeId: tx, url: tx, state: tx, isDraft: yes,
    mergedAt: ins, headRepository: tx, headBranch: br, headSha: sh, headTreeSha: sh,
    baseRepository: tx, baseBranch: br, baseSha: sh, mergeCommitSha: sh, mergeCommitTreeSha: sh,
    mergeCommitParentShas: shaArray, changedPaths: paths, changedPathsDigest: dg,
    protectedMainSha: sh, protectedMainContainsMerge: yes }, "merged PR");
  if (result.state !== "MERGED" || result.isDraft || result.baseBranch !== "main"
    || result.mergeCommitParentShas.length !== 1 || result.mergeCommitParentShas[0] !== result.baseSha
    || result.changedPathsDigest !== digestValue(result.changedPaths) || !result.protectedMainContainsMerge) bad("merged PR");
  return result;
}
function claim(value) {
  const result = shape(value, { claimId: dg, state: tx, retirementReason: tx, canonicalBaseSha: sh,
    laneRevision: sh, candidateRevision: sh, finalRevision: sh, reviewRequestId: tx,
    integrationEntryDigest: dg, retirementEntryDigest: dg, integrationReceiptDigest: dg,
    declaredWriteScope: paths, writeSetDigest: dg, lineageDigest: dg, changedPathsCovered: yes }, "claim");
  if (result.state !== "retired" || result.retirementReason !== "integrated"
    || result.writeSetDigest !== digestValue(result.declaredWriteScope) || !result.changedPathsCovered) bad("retired claim");
  return result;
}
function lease(value) {
  const result = shape(value, { digest: dg, snapshot: json, status: tx, expired: yes, branch: br,
    sessionId: tx, epoch: pos, worktreePath: abs, baseSha: sh, fenceSha: sh, pullRequestUrl: tx,
    taskAuthorityBindingDigest: dg, taskAuthorityTransitionPlanDigest: dg,
    markerWithoutTaskAuthorityDigest: dg, currentMarkerDigest: dg }, "lease");
  const withoutTask = structuredClone(result.snapshot); delete withoutTask.taskAuthority;
  let current, previous;
  try { current = projectWriterLeasePullRequestMarker(result.snapshot);
    previous = projectWriterLeasePullRequestMarker(withoutTask); } catch { bad("lease marker projection"); }
  ins(result.snapshot.expiresAt, "lease expiry");
  if (result.digest !== digestValue(result.snapshot) || result.status !== "active" || !result.expired
    || result.snapshot.status !== result.status || result.snapshot.branch !== result.branch
    || result.snapshot.sessionId !== result.sessionId || result.snapshot.epoch !== result.epoch
    || result.snapshot.worktreePath !== result.worktreePath || result.snapshot.baseSha !== result.baseSha
    || result.snapshot.fenceSha !== result.fenceSha || result.snapshot.pullRequestUrl !== result.pullRequestUrl
    || result.snapshot.cloudAuthority != null || result.snapshot.admission != null
    || result.snapshot.taskAuthority?.bindingDigest !== result.taskAuthorityBindingDigest
    || result.snapshot.taskAuthority?.transitionPlanDigest !== result.taskAuthorityTransitionPlanDigest
    || digestValue(current) !== result.currentMarkerDigest
    || digestValue(previous) !== result.markerWithoutTaskAuthorityDigest
    || result.currentMarkerDigest === result.markerWithoutTaskAuthorityDigest) bad("task-bound lease");
  return result;
}
function checkpoint(value) {
  const result = shape(value, { path: abs, schema: tx, status: tx, rawDigest: dg, identityDigest: dg,
    branch: br, headSha: sh, treeSha: sh, sourcePullRequestNumber: pos, claimId: dg }, "checkpoint");
  if (result.schema !== CHECKPOINT_SCHEMA || result.status !== "pullRequest") bad("checkpoint phase");
  return result;
}
function evidenceJoins(v) {
  const { repository: repo, controller: ctl, source: src, sourcePullRequest: pull,
    mergedPullRequest: merged, claim: cl, lease: owner, checkpoint: cp } = v;
  if (pull.number !== FIXED_SUBJECT.sourcePullRequestNumber
    || merged.number !== FIXED_SUBJECT.integratedPullRequestNumber
    || src.headSha !== FIXED_SUBJECT.sourceHeadSha || src.treeSha !== FIXED_SUBJECT.sourceTreeSha
    || merged.mergeCommitSha !== FIXED_SUBJECT.integratedSquashSha || cl.claimId !== FIXED_SUBJECT.claimId
    || ctl.root === src.worktreePath || [pull.headRepository, pull.baseRepository,
      merged.headRepository, merged.baseRepository].some(name => name !== repo.nameWithOwner)
    || pull.headBranch !== src.branch || pull.headSha !== src.headSha || pull.baseSha !== src.baseSha
    || pull.url !== owner.pullRequestUrl || pull.markerDigest !== owner.markerWithoutTaskAuthorityDigest
    || merged.nodeId === pull.nodeId || merged.headSha !== src.headSha || merged.headTreeSha !== src.treeSha
    || merged.baseSha !== src.baseSha || merged.mergeCommitTreeSha !== src.treeSha
    || canonicalJson(merged.changedPaths) !== canonicalJson(src.changedPaths)
    || merged.changedPathsDigest !== src.changedPathsDigest || cl.canonicalBaseSha !== src.baseSha
    || [cl.laneRevision, cl.candidateRevision, cl.finalRevision].some(sha => sha !== src.headSha)
    || cl.reviewRequestId !== `github-pull-request:${merged.nodeId}` || owner.branch !== src.branch
    || owner.worktreePath !== src.worktreePath || owner.baseSha !== src.baseSha || owner.fenceSha !== src.headSha
    || cp.branch !== src.branch || cp.headSha !== src.headSha || cp.treeSha !== src.treeSha
    || cp.sourcePullRequestNumber !== pull.number || cp.claimId !== cl.claimId
    || Date.parse(owner.snapshot.expiresAt) > Date.parse(v.observedAt)) bad("evidence join");
}

function phaseValues(phase, raw, plan) {
  const value = mutableRecord(raw, `${phase} values`);
  if (phase === "authorized") {
    keys(value, ["authorizationDigest"], "authorization values");
    const expected = authorizePlan(plan, authorizationForPlan(plan)).authorizationDigest;
    if (value.authorizationDigest !== expected) bad("authorization digest");
  } else if (phase === "task-authority-verified") {
    keys(value, ["taskAuthorityReceipt", "taskAuthorityReceiptDigest"], "task values");
    value.taskAuthorityReceipt = taskReceipt(value.taskAuthorityReceipt, plan);
    if (value.taskAuthorityReceiptDigest !== taskDigest(value.taskAuthorityReceipt)) bad("task receipt join");
  } else if (phase === "close-intent") {
    keys(value, ["operationKey", "taskAuthorityReceiptDigest"], "close intent");
    if (value.operationKey !== operationForPlan(plan, "pull-request-close")) bad("close operation");
    dg(value.taskAuthorityReceiptDigest, "close task receipt");
  } else if (phase === "pull-request-closed") closeValues(value, plan);
  else if (phase === "release-intent") {
    keys(value, ["operationKey", "taskAuthorityReceipt", "taskAuthorityReceiptDigest",
      "pullRequestReceiptDigest", "releaseProjection"], "release intent");
    if (value.operationKey !== operationForPlan(plan, "local-lease-release")) bad("release operation");
    value.taskAuthorityReceipt = taskReceipt(value.taskAuthorityReceipt, plan);
    if (value.taskAuthorityReceiptDigest !== taskDigest(value.taskAuthorityReceipt)) bad("release task receipt");
    dg(value.pullRequestReceiptDigest, "pull receipt");
    value.releaseProjection = releaseProjection(value.releaseProjection, plan);
  } else if (phase === "lease-released") releaseValues(value, plan);
  else if (phase === "complete") {
    keys(value, ["receipt", "terminalEvidence"], "complete values");
    value.terminalEvidence = normalizeTerminalEvidence(value.terminalEvidence, plan);
    value.receipt = terminalReceipt(value.receipt, plan);
  }
  return freeze(value);
}
function taskReceipt(value, plan) {
  const result = json(value, "task receipt"), binding = result.bindingDigest ?? result.taskAuthorityBindingDigest;
  dg(taskDigest(result), "task receipt digest");
  if (binding !== plan.evidence.lease.taskAuthorityBindingDigest) bad("task binding");
  return result;
}
function taskDigest(value) { return value.receiptDigest ?? value.taskAuthorityReceiptDigest; }
function closeValues(v, plan) {
  keys(v, ["pullRequestNumber", "nodeId", "state", "headSha", "bodyDigest", "markerDigest",
    "closedAt", "providerReceiptDigest"], "close values");
  const p = plan.evidence.sourcePullRequest;
  if (v.pullRequestNumber !== p.number || v.nodeId !== p.nodeId || v.state !== "CLOSED"
    || v.headSha !== p.headSha || v.bodyDigest !== p.bodyDigest || v.markerDigest !== p.markerDigest) bad("closed PR");
  ins(v.closedAt, "closedAt"); dg(v.providerReceiptDigest, "provider receipt");
}
function releaseProjection(v, plan) {
  keys(v, ["schema", "status", "planDigest", "branch", "sourceLeaseDigest", "sourceLeaseEpoch",
    "headSha", "treeSha", "releasePlanDigest"], "release projection");
  const core = { schema: LOCAL_LEASE_RELEASE_PLAN_SCHEMA, status: "prepared", planDigest: plan.planDigest,
    branch: plan.evidence.source.branch, sourceLeaseDigest: plan.evidence.lease.digest,
    sourceLeaseEpoch: plan.evidence.lease.epoch, headSha: plan.evidence.source.headSha,
    treeSha: plan.evidence.source.treeSha }, observed = { ...v };
  delete observed.releasePlanDigest;
  if (canonicalJson(observed) !== canonicalJson(core) || v.releasePlanDigest !== digestValue(core)) bad("release projection");
  return freeze({ ...core, releasePlanDigest: v.releasePlanDigest });
}
function releaseValues(v, plan) {
  keys(v, ["branch", "status", "sourceLeaseDigest", "releasedLeaseDigest", "releasePlanDigest",
    "releaseReceiptDigest", "sourcePreserved"], "release values");
  if (v.branch !== plan.evidence.source.branch || v.status !== "released"
    || v.sourceLeaseDigest !== plan.evidence.lease.digest || v.sourcePreserved !== true) bad("released lease");
  ["releasedLeaseDigest", "releasePlanDigest", "releaseReceiptDigest"].forEach(key => dg(v[key], key));
}
function lineage(plan, receipts) {
  const task = receipts["task-authority-verified"]?.values, close = receipts["close-intent"]?.values;
  const closed = receipts["pull-request-closed"], intent = receipts["release-intent"]?.values;
  const released = receipts["lease-released"]?.values;
  if (close && close.taskAuthorityReceiptDigest !== task.taskAuthorityReceiptDigest) bad("close lineage");
  if (intent && intent.pullRequestReceiptDigest !== closed.receiptDigest) bad("release lineage");
  if (released && released.releasePlanDigest !== intent.releaseProjection.releasePlanDigest) bad("release plan lineage");
  if (receipts.complete) {
    const prior = sealIntent(plan, "lease-released",
      Object.fromEntries(Object.entries(receipts).filter(([name]) => name !== "complete")));
    const expected = makeTerminalReceipt(prior, receipts.complete.values.terminalEvidence);
    if (canonicalJson(expected) !== canonicalJson(receipts.complete.values.receipt)) bad("complete lineage");
  }
}
function makeTerminalReceipt(intent, terminal) {
  const plan = intent.planSnapshot, pull = intent.receipts["pull-request-closed"].values;
  const releaseIntent = intent.receipts["release-intent"].values, released = intent.receipts["lease-released"].values;
  if (terminal.sourcePullRequest.closedAt !== pull.closedAt || terminal.sourcePullRequest.state !== pull.state
    || terminal.sourcePullRequest.bodyDigest !== pull.bodyDigest || terminal.sourcePullRequest.markerDigest !== pull.markerDigest
    || terminal.lease.releasedLeaseDigest !== released.releasedLeaseDigest
    || terminal.lease.releasePlanDigest !== released.releasePlanDigest
    || terminal.lease.releasePlanDigest !== releaseIntent.releaseProjection.releasePlanDigest
    || terminal.lease.releaseReceiptDigest !== released.releaseReceiptDigest) bad("terminal effect lineage");
  const core = { schema: RECEIPT_SCHEMA, status: "reconciled", operation: OPERATION,
    planDigest: plan.planDigest, sourcePullRequestNumber: plan.evidence.sourcePullRequest.number,
    integratedPullRequestNumber: plan.evidence.mergedPullRequest.number, claimId: plan.evidence.claim.claimId,
    sourceHeadSha: plan.evidence.source.headSha, sourceTreeSha: plan.evidence.source.treeSha,
    integratedSquashSha: plan.evidence.mergedPullRequest.mergeCommitSha,
    authorizationDigest: intent.receipts.authorized.values.authorizationDigest,
    taskAuthorityReceiptDigest: intent.receipts["task-authority-verified"].values.taskAuthorityReceiptDigest,
    releaseTaskAuthorityReceiptDigest: releaseIntent.taskAuthorityReceiptDigest,
    closeIntentReceiptDigest: intent.receipts["close-intent"].receiptDigest,
    pullRequestCloseReceiptDigest: intent.receipts["pull-request-closed"].receiptDigest,
    releaseIntentReceiptDigest: intent.receipts["release-intent"].receiptDigest,
    leaseReleaseReceiptDigest: intent.receipts["lease-released"].receiptDigest,
    terminalEvidenceDigest: terminal.terminalEvidenceDigest, preservation: PRESERVATION, effects: EFFECTS };
  return freeze({ ...core, receiptDigest: digestValue(core) });
}
function terminalReceipt(v, plan) {
  keys(v, ["schema", "status", "operation", "planDigest", "sourcePullRequestNumber",
    "integratedPullRequestNumber", "claimId", "sourceHeadSha", "sourceTreeSha", "integratedSquashSha",
    "authorizationDigest", "taskAuthorityReceiptDigest", "closeIntentReceiptDigest",
    "releaseTaskAuthorityReceiptDigest", "pullRequestCloseReceiptDigest", "releaseIntentReceiptDigest", "leaseReleaseReceiptDigest",
    "terminalEvidenceDigest", "preservation", "effects", "receiptDigest"], "terminal receipt");
  const core = structuredClone(v); delete core.receiptDigest;
  if (v.schema !== RECEIPT_SCHEMA || v.status !== "reconciled" || v.operation !== OPERATION
    || v.planDigest !== plan.planDigest || v.sourcePullRequestNumber !== plan.evidence.sourcePullRequest.number
    || v.integratedPullRequestNumber !== plan.evidence.mergedPullRequest.number || v.claimId !== plan.evidence.claim.claimId
    || v.sourceHeadSha !== plan.evidence.source.headSha || v.sourceTreeSha !== plan.evidence.source.treeSha
    || v.integratedSquashSha !== plan.evidence.mergedPullRequest.mergeCommitSha
    || canonicalJson(v.preservation) !== canonicalJson(PRESERVATION) || canonicalJson(v.effects) !== canonicalJson(EFFECTS)
    || v.receiptDigest !== digestValue(core)) bad("terminal receipt");
  return freeze(v);
}

function terminalSource(v) { return shape(v, { worktreePath: abs, branch: br, headSha: sh, treeSha: sh,
  localBranchSha: sh, remoteBranchSha: sh, statusDigest: dg, clean: yes, registered: yes }, "terminal source"); }
function terminalSourcePr(v) { return shape(v, { number: pos, nodeId: tx, state: tx, isDraft: yes,
  mergedAt: nullInstant, closedAt: ins, headBranch: br, headSha: sh, bodyDigest: dg,
  markerDigest: dg }, "terminal source PR"); }
function terminalMergedPr(v) { return shape(v, { number: pos, nodeId: tx, state: tx, mergedAt: ins,
  headSha: sh, headTreeSha: sh, mergeCommitSha: sh, mergeCommitTreeSha: sh }, "terminal merged PR"); }
function terminalClaim(v) { return shape(v, { claimId: dg, state: tx, retirementReason: tx,
  integrationEntryDigest: dg, retirementEntryDigest: dg, integrationReceiptDigest: dg }, "terminal claim"); }
function terminalLease(v) { return shape(v, { branch: br, status: tx, sourceLeaseDigest: dg,
  releasedLeaseDigest: dg, releasePlanDigest: dg, releaseReceiptDigest: dg,
  sourcePreserved: yes }, "terminal lease"); }
function terminalCheckpoint(v) { return shape(v, { path: abs, status: tx, rawDigest: dg,
  identityDigest: dg }, "terminal checkpoint"); }
function terminalJoins(v, plan) {
  const s = plan.evidence.source, p = plan.evidence.sourcePullRequest,
    m = plan.evidence.mergedPullRequest, c = plan.evidence.claim, cp = plan.evidence.checkpoint;
  if (!v.source.clean || !v.source.registered || v.source.worktreePath !== s.worktreePath
    || v.source.branch !== s.branch || v.source.headSha !== s.headSha || v.source.treeSha !== s.treeSha
    || v.source.localBranchSha !== s.localBranchSha || v.source.remoteBranchSha !== s.remoteBranchSha
    || v.source.statusDigest !== s.statusDigest || v.sourcePullRequest.number !== p.number
    || v.sourcePullRequest.nodeId !== p.nodeId || v.sourcePullRequest.state !== "CLOSED"
    || !v.sourcePullRequest.isDraft || v.sourcePullRequest.mergedAt !== null
    || v.sourcePullRequest.headBranch !== p.headBranch || v.sourcePullRequest.headSha !== p.headSha
    || v.sourcePullRequest.bodyDigest !== p.bodyDigest || v.sourcePullRequest.markerDigest !== p.markerDigest
    || v.mergedPullRequest.number !== m.number || v.mergedPullRequest.nodeId !== m.nodeId
    || v.mergedPullRequest.state !== "MERGED" || v.mergedPullRequest.mergedAt !== m.mergedAt
    || v.mergedPullRequest.headSha !== m.headSha || v.mergedPullRequest.headTreeSha !== m.headTreeSha
    || v.mergedPullRequest.mergeCommitSha !== m.mergeCommitSha
    || v.mergedPullRequest.mergeCommitTreeSha !== m.mergeCommitTreeSha || v.claim.claimId !== c.claimId
    || v.claim.state !== c.state || v.claim.retirementReason !== c.retirementReason
    || v.claim.integrationEntryDigest !== c.integrationEntryDigest
    || v.claim.retirementEntryDigest !== c.retirementEntryDigest
    || v.claim.integrationReceiptDigest !== c.integrationReceiptDigest || v.lease.branch !== s.branch
    || v.lease.status !== "released" || v.lease.sourceLeaseDigest !== plan.evidence.lease.digest
    || !v.lease.sourcePreserved || v.checkpoint.path !== cp.path || v.checkpoint.status !== cp.status
    || v.checkpoint.rawDigest !== cp.rawDigest || v.checkpoint.identityDigest !== cp.identityDigest) bad("terminal join");
}

function normalizePhaseReceipt(value, plan, phase) {
  keys(value, ["schema", "phase", "planDigest", "operationKey", "values", "valuesDigest",
    "receiptDigest"], `${phase} receipt`);
  const result = phaseReceipt({ plan, phase, values: value.values });
  if (canonicalJson(value) !== canonicalJson(result)) bad(`${phase} receipt`);
  return result;
}
function sealIntent(plan, phase, receipts) {
  const core = { schema: INTENT_SCHEMA, phase, planDigest: plan.planDigest,
    planSnapshot: plan, receipts: freeze({ ...receipts }) };
  return freeze({ ...core, intentDigest: digestValue(core) });
}
function shape(value, spec, label) {
  keys(value, Object.keys(spec), label);
  return freeze(Object.fromEntries(Object.entries(spec).map(([key, validator]) =>
    [key, validator(value[key], `${label}.${key}`)])));
}
function keys(value, required, label, optional = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) bad(label);
  const expected = [...required, ...optional.filter(key => Object.hasOwn(value, key))].sort();
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson(expected)) bad(`${label} fields`);
}
function mutableRecord(value, label) { keys(value, Object.keys(value || {}), label); let copy;
  try { copy = structuredClone(value); canonicalJson(copy); } catch { bad(label); } return copy; }
function json(value, label) { return freeze(mutableRecord(value, label)); }
function nullableRecord(value, label) { return value === null ? null : json(value, label); }
function constant(value, expected, label) {
  if (canonicalJson(value) !== canonicalJson(expected)) bad(label); return expected;
}
function paths(value, label) { if (!Array.isArray(value)) bad(label); const result = value.map(item => tx(item, label));
  if (canonicalJson(result) !== canonicalJson([...new Set(result)].sort())) bad(label); return freeze(result); }
function shaArray(value, label) { if (!Array.isArray(value)) bad(label); return freeze(value.map(item => sh(item, label))); }
function phaseName(value) { if (!PHASES.includes(value)) bad("phase"); return value; }
function tx(value, label) { if (typeof value !== "string" || !value.trim()
  || value !== value.normalize("NFC")) bad(label); return value; }
function abs(value, label) { const result = tx(value, label); if (!result.startsWith("/") || result.includes("\0")) bad(label); return result; }
function br(value, label) { const result = tx(value, label); if (result.startsWith("-") || result.startsWith("/")
  || result.endsWith("/") || result.includes("..") || result.includes("//") || /[~^:?*[\]\\\s]/u.test(result)) bad(label); return result; }
function sh(value, label) { if (!SHA.test(String(value || ""))) bad(label); return value; }
function dg(value, label) { if (!DIGEST.test(String(value || ""))) bad(label); return value; }
function pos(value, label) { if (!Number.isSafeInteger(value) || value < 1) bad(label); return value; }
function yes(value, label) { if (typeof value !== "boolean") bad(label); return value; }
function ins(value, label) { const time = Date.parse(value); if (typeof value !== "string"
  || !Number.isFinite(time) || new Date(time).toISOString() !== value) bad(label); return value; }
function nullInstant(value, label) { return value === null ? null : ins(value, label); }
function bad(label) { throw new Error(`Integrated-source duplicate-PR reconciliation has invalid ${label}.`); }
function freeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value); for (const child of Object.values(value)) freeze(child); return value; }
