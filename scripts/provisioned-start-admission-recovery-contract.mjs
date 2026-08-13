// Responsibility: Normalize and content-bind a planned provisioned-start recovery.

import { digestValue, normalizeWriteSet } from "./cloud-collaboration-primitives.mjs";

export const RECOVERY_PLAN_SCHEMA = "agentic-provisioned-start-admission-recovery-plan/v1";
export const RECOVERY_INTENT_SCHEMA = "agentic-provisioned-start-admission-recovery-intent/v1";
export const RECOVERY_RESULT_SCHEMA = "agentic-provisioned-start-admission-recovery-result/v1";
const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;

export function buildProvisionedStartAdmissionRecoveryPlan(evidence) {
  const normalized = normalizeEvidence(evidence);
  const core = {
    schema: RECOVERY_PLAN_SCHEMA,
    action: "recover-provisioned-start-admission",
    effects: ["record-intent", "project-local-admission", "project-pull-request-marker"],
    evidence: normalized,
  };
  return Object.freeze({ ...core, planDigest: digestValue(core) });
}

export function normalizeProvisionedStartAdmissionRecoveryPlan(value) {
  if (value?.schema !== RECOVERY_PLAN_SCHEMA || value?.action !== "recover-provisioned-start-admission") {
    throw new Error("Provisioned-start recovery plan schema or action is invalid.");
  }
  const rebuilt = buildProvisionedStartAdmissionRecoveryPlan(value.evidence);
  if (rebuilt.planDigest !== value.planDigest || digestValue(value) !== digestValue(rebuilt)) {
    throw new Error("Provisioned-start recovery plan digest is invalid.");
  }
  return rebuilt;
}

export function requireProvisionedStartAdmissionAuthorization(plan, authorization) {
  const expected = `authorize provisioned-start-admission-recovery ${plan.planDigest}`;
  if (authorization !== expected) {
    throw new Error(`Exact authorization required: ${expected}`);
  }
  return Object.freeze({
    schema: "agentic-provisioned-start-admission-recovery-authorization/v1",
    planDigest: plan.planDigest,
    authorizationDigest: digestValue({ expected }),
  });
}

export function projectProvisionedStartAdmissionRecovery({ plan, projectedAt, mutationReceiptDigests }) {
  const normalizedPlan = normalizeProvisionedStartAdmissionRecoveryPlan(plan);
  const timestamp = instant(projectedAt, "projectedAt");
  const receiptDigests = mutationReceiptDigests.map((value, index) => digest(value, `mutationReceiptDigests[${index}]`));
  if (receiptDigests.length < 2) throw new Error("Recovery projection requires task-authority mutation receipts.");
  const { lease, descendant } = normalizedPlan.evidence;
  const integration = Object.freeze({
    schema: "agentic-integration-commit/v1",
    commitSha: descendant.headSha,
    treeSha: descendant.treeSha,
    paths: descendant.paths,
    stagedDiffDigest: descendant.rangeDiffDigest,
    manifestDigest: lease.admission.manifestDigest,
    commitMessage: descendant.commits.at(-1).message,
    rangeBaseSha: descendant.fenceSha,
    commitInventoryDigest: digestValue(descendant.commits),
  });
  const preservation = {
    schema: "agentic-provisioned-start-authored-descendant-preservation/v1",
    planDigest: normalizedPlan.planDigest,
    sourceLeaseDigest: lease.leaseDigest,
    integrationDigest: digestValue(integration),
    taskAuthorityMutationReceiptDigests: receiptDigests,
    projectedAt: timestamp,
  };
  const preservationReceiptDigest = digestValue(preservation);
  const admission = Object.freeze({
    ...lease.admission,
    status: "admitted",
    admittedReportDigest: preservationReceiptDigest,
    preservationReceiptDigest,
  });
  return Object.freeze({ integration, admission, preservation: Object.freeze({
    ...preservation, receiptDigest: preservationReceiptDigest,
  }) });
}

export function buildProvisionedStartAdmissionRecoveryResult({ plan, terminalEvidence, phases,
  executionAttestation = null }) {
  const normalizedPlan = normalizeProvisionedStartAdmissionRecoveryPlan(plan);
  const phaseNames = ["intent", "local-projected", "marker-projected"];
  for (const name of phaseNames) if (!phases?.[name]?.receiptDigest) {
    throw new Error(`Recovery terminal result is missing ${name}.`);
  }
  const core = {
    schema: RECOVERY_RESULT_SCHEMA,
    ok: true,
    status: "admitted",
    planDigest: normalizedPlan.planDigest,
    phaseReceiptDigests: phaseNames.map(name => digest(phases[name].receiptDigest, `${name} receipt`)),
    terminalEvidenceDigest: digestValue(terminalEvidence),
    branch: normalizedPlan.evidence.lease.branch,
    commitSha: normalizedPlan.evidence.descendant.headSha,
  };
  const result = { ...core, receiptDigest: digestValue(core) };
  return Object.freeze(executionAttestation
    ? { ...result, executionAttestation: Object.freeze(executionAttestation) }
    : result);
}

export function projectProvisionedStartAdmissionRecoveryStableTerminalEvidence({ plan, terminalEvidence }) {
  const normalizedPlan = normalizeProvisionedStartAdmissionRecoveryPlan(plan);
  const source = object(terminalEvidence, "Terminal evidence");
  const expectedSubjectDigest = normalizedPlan.evidence.cloud.verifier.subjectDigest;
  const observedSubjectDigest = source.cloudAuthoritySubjectDigest === undefined
    ? expectedSubjectDigest
    : digest(source.cloudAuthoritySubjectDigest, "terminal cloud authority subject");
  if (observedSubjectDigest !== expectedSubjectDigest) {
    throw new Error("Terminal cloud authority subject drifted from the sealed plan.");
  }
  return Object.freeze({
    schema: "agentic-provisioned-start-admission-recovery-terminal-subject/v1",
    leaseDigest: digest(source.leaseDigest, "terminal lease"),
    bodyDigest: digest(source.bodyDigest, "terminal pull-request body"),
    cloudAuthoritySubjectDigest: observedSubjectDigest,
    descendantDigest: digest(source.descendantDigest, "terminal descendant"),
  });
}

export function projectProvisionedStartAdmissionRecoveryExecutionAttestation({ plan, terminalEvidence }) {
  const stable = projectProvisionedStartAdmissionRecoveryStableTerminalEvidence({ plan, terminalEvidence });
  const source = object(terminalEvidence, "Terminal evidence");
  return Object.freeze({
    schema: "agentic-provisioned-start-admission-recovery-execution-attestation/v1",
    cloudAuthoritySubjectDigest: stable.cloudAuthoritySubjectDigest,
    cloudVerificationReceiptDigest: digest(source.cloudVerificationReceiptDigest,
      "terminal cloud verification receipt"),
    cloudVerificationAttestationReceiptDigest: digest(source.cloudVerificationAttestationReceiptDigest,
      "terminal cloud verification attestation receipt"),
  });
}

function normalizeEvidence(value) {
  object(value, "Recovery evidence");
  const lease = object(value.lease, "Lease evidence");
  const admission = object(lease.admission, "Admission evidence");
  if (lease.schema !== "agentic-writer-lease/v2" || lease.status !== "active"
    || admission.schema !== "agentic-lane-admission-lease/v1" || admission.status !== "planned") {
    throw new Error("Recovery requires the exact active planned writer lease.");
  }
  const branch = text(lease.branch, "lease.branch");
  const descendant = normalizeDescendant(value.descendant, admission);
  const pullRequest = normalizePullRequest(value.pullRequest, lease, descendant.fenceSha);
  const cloud = normalizeCloud(value.cloud, lease, descendant.fenceSha);
  const normalizedLease = {
    schema: lease.schema,
    status: lease.status,
    sessionId: text(lease.sessionId, "lease.sessionId"),
    device: text(lease.device, "lease.device"),
    scope: text(lease.scope, "lease.scope"),
    branch,
    worktreePath: text(lease.worktreePath, "lease.worktreePath"),
    epoch: positive(lease.epoch, "lease.epoch"),
    fenceSha: sha(lease.fenceSha, "lease.fenceSha"),
    pullRequestUrl: text(lease.pullRequestUrl, "lease.pullRequestUrl"),
    taskAuthorityDigest: lease.taskAuthorityDigest
      ? digest(lease.taskAuthorityDigest, "lease.taskAuthorityDigest")
      : digestValue(object(lease.taskAuthority, "lease.taskAuthority")),
    cloudClaimId: digest(lease.cloudClaimId || lease.cloudAuthority?.claimId, "lease.cloudClaimId"),
    cloudAuthorityDigest: lease.cloudAuthorityDigest
      ? digest(lease.cloudAuthorityDigest, "lease.cloudAuthorityDigest")
      : digestValue(object(lease.cloudAuthority, "lease.cloudAuthority")),
    admission: {
      schema: admission.schema,
      status: admission.status,
      semanticScope: text(admission.semanticScope, "admission.semanticScope"),
      declaredWriteSet: normalizeWriteSet(admission.declaredWriteSet),
      writeSetDigest: digest(admission.writeSetDigest, "admission.writeSetDigest"),
      manifestDigest: digest(admission.manifestDigest, "admission.manifestDigest"),
      planReceiptDigest: digest(admission.planReceiptDigest, "admission.planReceiptDigest"),
      admissionReceiptDigest: digest(admission.admissionReceiptDigest, "admission.admissionReceiptDigest"),
      existingLaneStateDigest: digest(admission.existingLaneStateDigest, "admission.existingLaneStateDigest"),
    },
    leaseDigest: lease.leaseDigest ? digest(lease.leaseDigest, "lease.leaseDigest") : digestValue(lease),
  };
  return Object.freeze({ lease: Object.freeze(normalizedLease), descendant, pullRequest, cloud });
}

function normalizeDescendant(value, admission) {
  object(value, "Descendant evidence");
  const fenceSha = sha(value.fenceSha, "descendant.fenceSha");
  const headSha = sha(value.headSha, "descendant.headSha");
  if (headSha === fenceSha || value.clean !== true || value.linear !== true) {
    throw new Error("Recovery requires one clean linear authored descendant above the fence.");
  }
  const paths = normalizeWriteSet(value.paths).map(item => item.replace(/^path:/u, ""));
  const allowed = new Set(admission.declaredWriteSet.filter(item => item.startsWith("path:")).map(item => item.slice(5)));
  if (!paths.length || paths.some(item => !allowed.has(item))) {
    throw new Error("Authored descendant paths exceed the declared write scope.");
  }
  const commits = value.commits.map((commit, index) => Object.freeze({
    sha: sha(commit.sha, `commits[${index}].sha`),
    treeSha: sha(commit.treeSha, `commits[${index}].treeSha`),
    parentSha: sha(commit.parentSha, `commits[${index}].parentSha`),
    message: text(commit.message, `commits[${index}].message`),
  }));
  if (!commits.length || commits[0].parentSha !== fenceSha || commits.at(-1).sha !== headSha
    || commits.some((commit, index) => index > 0 && commit.parentSha !== commits[index - 1].sha)) {
    throw new Error("Authored descendant commit inventory is not the exact linear range.");
  }
  return Object.freeze({ fenceSha, headSha, treeSha: sha(value.treeSha, "descendant.treeSha"),
    clean: true, linear: true, paths, rangeDiffDigest: digest(value.rangeDiffDigest, "descendant.rangeDiffDigest"), commits });
}

function normalizePullRequest(value, lease, fenceSha) {
  object(value, "Pull request evidence");
  if (value.state !== "OPEN" || value.isDraft !== true || value.autoMergeRequest !== null
    || value.headSha !== fenceSha || value.url !== lease.pullRequestUrl || value.branch !== lease.branch) {
    throw new Error("Recovery requires the exact open draft pull request at the fence.");
  }
  return Object.freeze({ id: text(value.id, "pullRequest.id"), number: positive(value.number, "pullRequest.number"),
    url: value.url, branch: value.branch, headSha: fenceSha, baseSha: sha(value.baseSha, "pullRequest.baseSha"),
    state: value.state, isDraft: true, autoMergeRequest: null, bodyDigest: digest(value.bodyDigest, "pullRequest.bodyDigest") });
}

function normalizeCloud(value, lease, fenceSha) {
  object(value, "Cloud evidence");
  if (value.status !== "ready" || value.state !== "active" || value.writeAuthority !== true
    || value.scopeReserved !== true || value.claimId !== (lease.cloudClaimId || lease.cloudAuthority?.claimId)
    || value.laneRevision !== fenceSha) throw new Error("Recovery requires exact current cloud write authority at the fence.");
  const verifier = object(value.verifier, "cloud.verifier");
  return Object.freeze({ claimId: digest(value.claimId, "cloud.claimId"), claimDigest: digest(value.claimDigest, "cloud.claimDigest"),
    state: value.state, status: value.status, writeAuthority: true, scopeReserved: true,
    laneRevision: fenceSha, transitionCounter: positive(value.transitionCounter, "cloud.transitionCounter"),
    heartbeatCounter: nonnegative(value.heartbeatCounter, "cloud.heartbeatCounter"),
    ledgerRevision: sha(value.ledgerRevision, "cloud.ledgerRevision"), ledgerDigest: digest(value.ledgerDigest, "cloud.ledgerDigest"),
    verifier: Object.freeze({ adapterId: text(verifier.adapterId, "cloud.verifier.adapterId"),
      schema: text(verifier.schema, "cloud.verifier.schema"),
      version: positive(verifier.version, "cloud.verifier.version"),
      subjectDigest: digest(verifier.subjectDigest, "cloud.verifier.subjectDigest") }) });
}

function object(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid.`); return value; }
function text(value, label) { if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is invalid.`); return value; }
function sha(value, label) { if (!SHA.test(String(value || ""))) throw new Error(`${label} is invalid.`); return value; }
function digest(value, label) { if (!DIGEST.test(String(value || ""))) throw new Error(`${label} is invalid.`); return value; }
function positive(value, label) { if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} is invalid.`); return value; }
function nonnegative(value, label) { if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is invalid.`); return value; }
function instant(value, label) { const parsed = new Date(value); if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) throw new Error(`${label} is invalid.`); return value; }
