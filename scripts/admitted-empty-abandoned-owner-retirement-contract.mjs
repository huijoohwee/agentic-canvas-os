// Responsibility: Seal one expired, planned, fence-only owner retirement without deleting bytes.
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";

export const PLAN_SCHEMA = "agentic-admitted-empty-abandoned-owner-retirement-plan/v1";
export const STATE_SCHEMA = "agentic-admitted-empty-abandoned-owner-retirement-state/v1";
export const RECEIPT_SCHEMA = "agentic-admitted-empty-abandoned-owner-retirement-receipt/v1";
export const RESUME_PLAN_SCHEMA = "agentic-admitted-empty-abandoned-owner-retirement-resume-plan/v1";
export const RESUME_STATE_SCHEMA = "agentic-admitted-empty-abandoned-owner-retirement-resume-state/v1";
export const RESUME_RECEIPT_SCHEMA = "agentic-admitted-empty-abandoned-owner-retirement-resume-receipt/v1";
export const PHASES = Object.freeze([
  "planned", "authorized", "claim-retired", "pull-request-closed", "owner-released", "complete",
]);
export const RESUME_PHASES = Object.freeze(["planned", "authorized", "owner-released", "complete"]);
const EFFECTS = Object.freeze(["retire-cloud-claim", "close-pull-request", "release-local-lease"]);
const PRESERVATION = Object.freeze({
  subjectWorktree: "preserved", subjectBranch: "preserved", subjectRef: "preserved",
  subjectTree: "preserved", authoredLane: "preserved", remoteBranch: "preserved",
  deployment: "not-performed",
});
const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;

export function buildPlan(input) {
  const subject = normalizeSubject(input.subject);
  const authoredLane = normalizeLane(input.authoredLane, "authored lane");
  const controller = normalizeController(input.controller);
  const cloud = normalizeCloud(input.cloud);
  const observedAt = instant(input.observedAt, "observation instant");
  if (Date.parse(subject.lease.expiresAt) > Date.parse(observedAt)
    || Date.parse(subject.claim.expiresAt) > Date.parse(observedAt)) {
    throw new Error("Retirement requires an expired planned owner and cloud claim.");
  }
  if (subject.path === authoredLane.path || subject.branch === authoredLane.branch) {
    throw new Error("Fence-only subject and authored lane must remain distinct.");
  }
  const core = { schema: PLAN_SCHEMA, action: "retire-admitted-empty-abandoned-owner",
    observedAt, subject, authoredLane, controller, cloud, effects: EFFECTS,
    preservation: PRESERVATION };
  const planDigest = digestValue(core);
  return freeze({ ...core, planDigest,
    exactAuthorization: `authorize admitted-empty-abandoned-owner-retirement ${planDigest}` });
}

export function normalizePlan(value) {
  const rebuilt = buildPlan(value);
  if (value?.planDigest !== rebuilt.planDigest
    || value?.exactAuthorization !== rebuilt.exactAuthorization
    || canonicalJson(value) !== canonicalJson(rebuilt)) throw new Error("Retirement plan is invalid or drifted.");
  return rebuilt;
}

export function authorizePlan(plan, authorization) {
  const normalized = normalizePlan(plan);
  if (authorization !== normalized.exactAuthorization) {
    throw new Error(`Exact authorization required: ${normalized.exactAuthorization}`);
  }
  return normalized;
}

export function buildResumePlan(input) {
  const sourceState = normalizeState(input.sourceState);
  if (sourceState.phase !== "pull-request-closed") {
    throw new Error("Retirement resume requires an exact pull-request-closed source journal.");
  }
  assertSourceReceiptsForResume(sourceState);
  const observedAt = instant(input.observedAt, "resume observation instant");
  const controller = normalizeController(input.controller);
  const cloud = normalizeCloud(input.cloud);
  const recovery = normalizeResumeRecovery(input.recovery, sourceState, controller);
  const core = {
    schema: RESUME_PLAN_SCHEMA,
    action: "resume-admitted-empty-abandoned-owner-retirement",
    observedAt,
    sourceState,
    controller,
    cloud,
    recovery,
    remainingEffects: Object.freeze(["release-local-lease"]),
    preservation: PRESERVATION,
  };
  const planDigest = digestValue(core);
  return freeze({ ...core, planDigest,
    exactAuthorization: `authorize admitted-empty-abandoned-owner-retirement-resume ${planDigest}` });
}

export function normalizeResumePlan(value) {
  const rebuilt = buildResumePlan(value);
  if (value?.planDigest !== rebuilt.planDigest
    || value?.exactAuthorization !== rebuilt.exactAuthorization
    || canonicalJson(value) !== canonicalJson(rebuilt)) {
    throw new Error("Retirement resume plan is invalid or drifted.");
  }
  return rebuilt;
}

export function authorizeResumePlan(plan, authorization) {
  const normalized = normalizeResumePlan(plan);
  if (authorization !== normalized.exactAuthorization) {
    throw new Error(`Exact authorization required: ${normalized.exactAuthorization}`);
  }
  return normalized;
}

export function createState(plan) {
  return sealState({ schema: STATE_SCHEMA, phase: "planned", plan: normalizePlan(plan), receipts: {} });
}

export function createResumeState(plan) {
  return sealResumeState({ schema: RESUME_STATE_SCHEMA, phase: "planned",
    plan: normalizeResumePlan(plan), receipts: {} });
}

export function normalizeState(value) {
  object(value, "retirement state");
  const phase = phaseName(value.phase);
  const plan = normalizePlan(value.plan);
  const receipts = normalizeReceipts(value.receipts, phase);
  return assertSealed(value, { schema: STATE_SCHEMA, phase, plan, receipts });
}

export function normalizeResumeState(value) {
  object(value, "retirement resume state");
  const phase = resumePhaseName(value.phase);
  const plan = normalizeResumePlan(value.plan);
  const receipts = normalizeOrderedReceipts(value.receipts, phase, RESUME_PHASES, RESUME_RECEIPT_SCHEMA);
  return assertSealedResume(value, { schema: RESUME_STATE_SCHEMA, phase, plan, receipts });
}

export function advanceState(state, phase, receipt) {
  const current = normalizeState(state);
  const nextPhase = phaseName(phase);
  const currentIndex = PHASES.indexOf(current.phase), nextIndex = PHASES.indexOf(nextPhase);
  if (nextIndex !== currentIndex + 1) throw new Error(`Retirement cannot advance from ${current.phase} to ${nextPhase}.`);
  const receipts = { ...current.receipts };
  receipts[nextPhase] = normalizePhaseReceipt(receipt, nextPhase, RECEIPT_SCHEMA);
  return sealState({ schema: STATE_SCHEMA, phase: nextPhase, plan: current.plan, receipts });
}

export function advanceResumeState(state, phase, receipt) {
  const current = normalizeResumeState(state);
  const nextPhase = resumePhaseName(phase);
  const currentIndex = RESUME_PHASES.indexOf(current.phase), nextIndex = RESUME_PHASES.indexOf(nextPhase);
  if (nextIndex !== currentIndex + 1) {
    throw new Error(`Retirement resume cannot advance from ${current.phase} to ${nextPhase}.`);
  }
  return sealResumeState({ schema: RESUME_STATE_SCHEMA, phase: nextPhase, plan: current.plan,
    receipts: { ...current.receipts,
      [nextPhase]: normalizePhaseReceipt(receipt, nextPhase, RESUME_RECEIPT_SCHEMA) } });
}

export function buildReceipt(state, terminalEvidenceDigest) {
  const current = normalizeState(state);
  if (current.phase !== "owner-released") throw new Error("Terminal receipt requires released local ownership.");
  const core = { schema: RECEIPT_SCHEMA, status: "complete", planDigest: current.plan.planDigest,
    authorizationDigest: digest(current.receipts.authorized.authorizationDigest, "authorization digest"),
    claimId: current.plan.subject.claim.claimId,
    pullRequestNumber: current.plan.subject.pullRequest.number,
    claimRetirementReceiptDigest: current.receipts["claim-retired"].receiptDigest,
    pullRequestCloseReceiptDigest: current.receipts["pull-request-closed"].receiptDigest,
    ownerReleaseReceiptDigest: current.receipts["owner-released"].receiptDigest,
    terminalEvidenceDigest: digest(terminalEvidenceDigest, "terminal evidence digest"),
    preservation: PRESERVATION };
  return freeze({ ...core, receiptDigest: digestValue(core) });
}

export function buildResumeReceipt(state, terminalEvidenceDigest) {
  const current = normalizeResumeState(state);
  if (current.phase !== "owner-released") {
    throw new Error("Terminal resume receipt requires released local ownership.");
  }
  const core = { schema: RESUME_RECEIPT_SCHEMA, status: "complete",
    planDigest: current.plan.planDigest,
    sourcePlanDigest: current.plan.sourceState.plan.planDigest,
    sourceStateDigest: current.plan.sourceState.stateDigest,
    authorizationDigest: digest(current.receipts.authorized.authorizationDigest, "resume authorization digest"),
    ownerReleaseReceiptDigest: current.receipts["owner-released"].receiptDigest,
    terminalEvidenceDigest: digest(terminalEvidenceDigest, "terminal resume evidence digest"),
    preservation: PRESERVATION };
  return freeze({ ...core, receiptDigest: digestValue(core) });
}

function assertSourceReceiptsForResume(state) {
  const plan = state.plan, retired = state.receipts["claim-retired"], closed = state.receipts["pull-request-closed"];
  if (retired.claimId !== plan.subject.claim.claimId || retired.cloudMutation !== true
    || retired.subjectStateDigest !== plan.subject.stateDigest
    || closed.pullRequestNumber !== plan.subject.pullRequest.number || closed.providerMutation !== true
    || closed.remoteBranchPreserved !== true) {
    throw new Error("Retirement source journal does not seal the completed remote effects.");
  }
}

function normalizeResumeRecovery(value, sourceState, controller) {
  const source = object(value, "retirement resume recovery evidence"), plan = sourceState.plan;
  const authoredLaneDisposition = source.authoredLaneDisposition ?? "source-exact";
  if (!["source-exact", "protected-main-descendant"].includes(authoredLaneDisposition)) {
    throw new Error("Retirement resume authored lane disposition is invalid.");
  }
  const result = {
    sourceStateDigest: digest(source.sourceStateDigest, "resume source state digest"),
    sourcePlanDigest: digest(source.sourcePlanDigest, "resume source plan digest"),
    claimAbsent: source.claimAbsent === true,
    retirementEntryDigest: digest(source.retirementEntryDigest, "retirement entry digest"),
    pullRequestState: text(source.pullRequestState, "resume pull request state"),
    pullRequestClosedAt: instant(source.pullRequestClosedAt, "resume pull request close instant"),
    leaseStatus: text(source.leaseStatus, "resume lease status"),
    leaseDigest: digest(source.leaseDigest, "resume lease digest"),
    taskAuthorityBindingDigest: digest(source.taskAuthorityBindingDigest, "resume task authority binding digest"),
    subjectStateDigest: digest(source.subjectStateDigest, "resume subject state digest"),
    authoredLaneDisposition,
    authoredLaneStateDigest: digest(source.authoredLaneStateDigest, "resume authored lane state digest"),
    authoredLaneHeadSha: sha(source.authoredLaneHeadSha ?? plan.authoredLane.headSha,
      "resume authored lane head"),
    authoredLaneTreeSha: sha(source.authoredLaneTreeSha ?? plan.authoredLane.treeSha,
      "resume authored lane tree"),
    remoteHeadSha: sha(source.remoteHeadSha, "resume remote head"),
  };
  const sourceExact = result.authoredLaneDisposition === "source-exact"
    && result.authoredLaneStateDigest === plan.authoredLane.stateDigest
    && result.authoredLaneHeadSha === plan.authoredLane.headSha
    && result.authoredLaneTreeSha === plan.authoredLane.treeSha;
  const protectedMainDescendant = result.authoredLaneDisposition === "protected-main-descendant"
    && plan.authoredLane.branch === "main"
    && plan.authoredLane.headSha === plan.controller.headSha
    && plan.authoredLane.treeSha === plan.controller.treeSha
    && result.authoredLaneHeadSha === controller.headSha
    && result.authoredLaneTreeSha === controller.treeSha;
  if (result.sourceStateDigest !== sourceState.stateDigest
    || result.sourcePlanDigest !== plan.planDigest || !result.claimAbsent
    || result.pullRequestState !== "CLOSED" || result.leaseStatus !== "active"
    || result.pullRequestClosedAt !== sourceState.receipts["pull-request-closed"].closedAt
    || result.leaseDigest !== plan.subject.lease.digest
    || result.subjectStateDigest !== plan.subject.stateDigest
    || (!sourceExact && !protectedMainDescendant)
    || result.remoteHeadSha !== plan.subject.remoteHeadSha) {
    throw new Error("Retirement resume evidence does not match the partial source journal.");
  }
  return freeze(result);
}

function normalizeSubject(value) {
  const source = object(value, "subject");
  const lease = object(source.lease, "subject lease");
  const claim = object(source.claim, "subject claim");
  const pull = object(source.pullRequest, "subject pull request");
  const result = {
    repository: repository(source.repository, "subject repository"),
    path: text(source.path, "subject path"), branch: text(source.branch, "subject branch"),
    headSha: sha(source.headSha, "subject head"), headTreeSha: sha(source.headTreeSha, "subject tree"),
    baseSha: sha(source.baseSha, "subject base"), baseTreeSha: sha(source.baseTreeSha, "subject base tree"),
    parentShas: array(source.parentShas, "subject parents").map((item, index) => sha(item, `subject parent ${index}`)),
    changedPaths: array(source.changedPaths, "subject changed paths").map(item => text(item, "changed path")),
    clean: source.clean === true, registered: source.registered === true,
    remoteHeadSha: sha(source.remoteHeadSha, "subject remote head"),
    stateDigest: digest(source.stateDigest, "subject state digest"),
    lease: { status: text(lease.status, "lease status"), sessionId: text(lease.sessionId, "lease session"),
      branch: text(lease.branch, "lease branch"), worktreePath: text(lease.worktreePath, "lease worktree"),
      baseSha: sha(lease.baseSha, "lease base"), fenceSha: sha(lease.fenceSha, "lease fence"),
      expiresAt: instant(lease.expiresAt, "lease expiry"), admissionStatus: text(lease.admissionStatus, "lease admission"),
      claimId: digest(lease.claimId, "lease claim"), digest: digest(lease.digest, "lease digest") },
    claim: { claimId: digest(claim.claimId, "claim ID"), claimDigest: digest(claim.claimDigest, "claim digest"),
      state: text(claim.state, "claim state"), writeAuthority: claim.writeAuthority === true,
      scopeReserved: claim.scopeReserved === true, laneRevision: sha(claim.laneRevision, "claim lane"),
      canonicalBaseRevision: sha(claim.canonicalBaseRevision, "claim base"),
      transitionCounter: positive(claim.transitionCounter, "claim transition counter"),
      reviewRequestId: claim.reviewRequestId == null ? null : text(claim.reviewRequestId, "claim review request"),
      expiresAt: instant(claim.expiresAt, "claim expiry") },
    pullRequest: { number: positive(pull.number, "pull request number"), nodeId: text(pull.nodeId, "pull request node"),
      url: text(pull.url, "pull request URL"), state: text(pull.state, "pull request state"),
      isDraft: pull.isDraft === true, mergedAt: pull.mergedAt ?? null,
      headBranch: text(pull.headBranch, "pull request head branch"),
      headSha: sha(pull.headSha, "pull request head"), baseBranch: text(pull.baseBranch, "pull request base branch"),
      baseSha: sha(pull.baseSha, "pull request base") },
  };
  const legacyClaimProjection = result.claim.laneRevision === result.baseSha
    && result.claim.reviewRequestId === null;
  const pullRequestBoundFenceProjection = result.claim.laneRevision === result.headSha
    && result.claim.laneRevision === result.lease.fenceSha
    && result.claim.reviewRequestId === `github-pull-request:${result.pullRequest.nodeId}`;
  if (!result.clean || !result.registered || result.parentShas.length !== 1 || result.changedPaths.length !== 0
    || result.headTreeSha !== result.baseTreeSha || result.parentShas[0] !== result.baseSha
    || result.headSha !== result.remoteHeadSha || result.lease.status !== "active"
    || result.lease.admissionStatus !== "planned" || result.lease.branch !== result.branch
    || result.lease.worktreePath !== result.path || result.lease.baseSha !== result.baseSha
    || result.lease.fenceSha !== result.headSha || result.lease.claimId !== result.claim.claimId
    || result.claim.state !== "dormant-preserved" || result.claim.writeAuthority
    || !result.claim.scopeReserved || result.claim.canonicalBaseRevision !== result.baseSha
    || (!legacyClaimProjection && !pullRequestBoundFenceProjection)
    || result.pullRequest.state !== "OPEN" || !result.pullRequest.isDraft || result.pullRequest.mergedAt !== null
    || result.pullRequest.headBranch !== result.branch || result.pullRequest.headSha !== result.headSha
    || result.pullRequest.baseBranch !== "main" || result.pullRequest.baseSha !== result.baseSha) {
    throw new Error("Subject is not one exact expired planned fence-only owner.");
  }
  return freeze(result);
}

function normalizeLane(value, label) {
  const source = object(value, label);
  const result = { path: text(source.path, `${label} path`), branch: text(source.branch, `${label} branch`),
    headSha: sha(source.headSha, `${label} head`), treeSha: sha(source.treeSha, `${label} tree`),
    clean: source.clean === true, registered: source.registered === true,
    statusDigest: digest(source.statusDigest, `${label} status`), stateDigest: digest(source.stateDigest, `${label} state`) };
  if (!result.clean || !result.registered) throw new Error(`${label} must be clean and registered.`);
  return freeze(result);
}
function normalizeController(value) { const source = object(value, "controller");
  const result = { headSha: sha(source.headSha, "controller HEAD"), originMainSha: sha(source.originMainSha, "controller origin/main"),
    treeSha: sha(source.treeSha, "controller tree"), runtimeDigest: digest(source.runtimeDigest, "controller runtime"),
    clean: source.clean === true, protected: source.protected === true };
  if (!result.clean || !result.protected || result.headSha !== result.originMainSha) throw new Error("Controller must be clean protected main."); return freeze(result); }
function normalizeCloud(value) { const source = object(value, "cloud"); return freeze({
  ledgerRepository: repository(source.ledgerRepository, "ledger repository"), ledgerRevision: sha(source.ledgerRevision, "ledger revision"),
  ledgerDigest: digest(source.ledgerDigest, "ledger digest"), sequence: positive(source.sequence, "ledger sequence") }); }
function normalizeReceipts(value, phase) {
  return normalizeOrderedReceipts(value, phase, PHASES, RECEIPT_SCHEMA);
}
function normalizeOrderedReceipts(value, phase, phases, terminalSchema) {
  const source = object(value, "phase receipts"), result = {};
  for (let index = 1; index <= phases.indexOf(phase); index += 1) { const name = phases[index];
    result[name] = normalizePhaseReceipt(source[name], name, terminalSchema); }
  if (Object.keys(source).some(key => !Object.hasOwn(result, key))) throw new Error("Retirement receipts are out of order."); return freeze(result); }
function normalizePhaseReceipt(value, phase, terminalSchema) { const source = object(value, `${phase} receipt`); const core = { ...source }; delete core.receiptDigest;
  if (source.phase !== phase || source.receiptDigest !== digestValue(core)) throw new Error(`${phase} receipt is invalid.`);
  if (phase === "complete") { const receipt = object(source.receipt, "terminal receipt"), receiptCore = { ...receipt }; delete receiptCore.receiptDigest;
    if (receipt.schema !== terminalSchema || receipt.status !== "complete"
      || receipt.receiptDigest !== digestValue(receiptCore)) throw new Error("Terminal receipt is invalid."); }
  return freeze({ ...core, receiptDigest: source.receiptDigest }); }
function sealState(core) { const frozen = freeze(core); return freeze({ ...frozen, stateDigest: digestValue(frozen) }); }
function assertSealed(value, core) { if (value.schema !== STATE_SCHEMA || value.stateDigest !== digestValue(core)
  || canonicalJson(value) !== canonicalJson({ ...core, stateDigest: value.stateDigest })) throw new Error("Retirement state is invalid or drifted."); return freeze({ ...core, stateDigest: value.stateDigest }); }
function sealResumeState(core) { const frozen = freeze(core); return freeze({ ...frozen, stateDigest: digestValue(frozen) }); }
function assertSealedResume(value, core) { if (value.schema !== RESUME_STATE_SCHEMA || value.stateDigest !== digestValue(core)
  || canonicalJson(value) !== canonicalJson({ ...core, stateDigest: value.stateDigest })) throw new Error("Retirement resume state is invalid or drifted."); return freeze({ ...core, stateDigest: value.stateDigest }); }
export function phaseReceipt(phase, values) { const core = { phase: phaseName(phase), ...structuredClone(values) };
  return freeze({ ...core, receiptDigest: digestValue(core) }); }
function phaseName(value) { if (!PHASES.includes(value)) throw new Error("Retirement phase is invalid."); return value; }
function resumePhaseName(value) { if (!RESUME_PHASES.includes(value)) throw new Error("Retirement resume phase is invalid."); return value; }
function object(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid.`); return value; }
function array(value, label) { if (!Array.isArray(value)) throw new Error(`${label} is invalid.`); return value; }
function text(value, label) { if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is invalid.`); return value; }
function repository(value, label) { const result = text(value, label); if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(result)) throw new Error(`${label} is invalid.`); return result; }
function sha(value, label) { if (!SHA.test(String(value || ""))) throw new Error(`${label} is invalid.`); return value; }
function digest(value, label) { if (!DIGEST.test(String(value || ""))) throw new Error(`${label} is invalid.`); return value; }
function positive(value, label) { if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} is invalid.`); return value; }
function instant(value, label) { if (typeof value !== "string" || new Date(value).toISOString() !== value) throw new Error(`${label} is invalid.`); return value; }
function freeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) freeze(child); return value; }
