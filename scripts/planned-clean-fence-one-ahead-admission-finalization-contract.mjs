// Responsibility: Seal one clean fence-only planned admission whose cloud heartbeat is exactly one transition ahead.
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import { projectPlannedDirtyHeartbeatProjection }
  from "./planned-dirty-admission-recovery-evidence.mjs";
import { projectWriterLeasePullRequestMarker } from "./writer-lease-lib.mjs";

export const PLAN_SCHEMA =
  "agentic-planned-clean-fence-one-ahead-admission-finalization-plan/v1";
export const RESULT_SCHEMA =
  "agentic-planned-clean-fence-one-ahead-admission-finalization-result/v1";
export const OPERATION =
  "planned-clean-fence-one-ahead-heartbeat-admission-finalization";

const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;

export function buildPlannedCleanFenceAdmissionFinalizationPlan(input = {}) {
  const evidence = normalizeEvidence(input);
  const core = {
    schema: PLAN_SCHEMA,
    operation: OPERATION,
    effects: [
      "task-authority-verification",
      "local-lease-heartbeat-and-admission-cas",
      "pull-request-hidden-marker-projection",
      "terminal-verification",
    ],
    evidence,
  };
  return deepFreeze({ ...core, planDigest: digestValue(core) });
}

export function normalizePlannedCleanFenceAdmissionFinalizationPlan(value) {
  if (value?.schema !== PLAN_SCHEMA || value?.operation !== OPERATION) {
    throw new Error("Planned-clean fence admission-finalization plan schema is invalid.");
  }
  const rebuilt = buildPlannedCleanFenceAdmissionFinalizationPlan(value.evidence);
  if (canonicalJson(value) !== canonicalJson(rebuilt)) {
    throw new Error("Planned-clean fence admission-finalization plan digest is invalid.");
  }
  return rebuilt;
}

export function requirePlannedCleanFenceAdmissionFinalizationAuthorization(planValue, token) {
  const plan = normalizePlannedCleanFenceAdmissionFinalizationPlan(planValue);
  const expected = `authorize ${OPERATION} ${plan.planDigest}`;
  if (token !== expected) throw new Error(`Exact authorization required: ${expected}`);
  return deepFreeze({
    schema: "agentic-planned-clean-fence-one-ahead-admission-finalization-authorization/v1",
    planDigest: plan.planDigest,
    authorizationDigest: digestValue({ expected }),
  });
}

export function buildPlannedCleanFenceAdmissionFinalizationResult({
  plan: planValue,
  authorization,
  taskAuthorityReceiptDigest,
  leaseDigest,
  markerDigest,
  bodyDigest,
  admissionReportDigest,
  preservationReceiptDigest,
  mutationAuthorityReceiptDigest,
  registryRevision,
  disposition,
} = {}) {
  const plan = normalizePlannedCleanFenceAdmissionFinalizationPlan(planValue);
  const core = {
    schema: RESULT_SCHEMA,
    ok: true,
    status: "admitted",
    disposition: ["projected", "adopted"].includes(disposition)
      ? disposition : invalid("result disposition"),
    planDigest: plan.planDigest,
    authorizationDigest: digest(authorization?.authorizationDigest, "authorization digest"),
    taskAuthorityReceiptDigest: digest(taskAuthorityReceiptDigest, "task-authority receipt"),
    leaseDigest: digest(leaseDigest, "lease digest"),
    markerDigest: digest(markerDigest, "marker digest"),
    bodyDigest: digest(bodyDigest, "body digest"),
    admissionReportDigest: digest(admissionReportDigest, "admission report digest"),
    preservationReceiptDigest: digest(preservationReceiptDigest, "preservation receipt digest"),
    mutationAuthorityReceiptDigest: digest(mutationAuthorityReceiptDigest,
      "mutation-authority receipt digest"),
    registryRevision: positive(registryRevision, "registry revision"),
    sourceCommitChanged: false,
    sourceTreeChanged: false,
    sourceIndexChanged: false,
    cloudChanged: false,
    pullRequestStateChanged: false,
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

export function buildPlannedCleanFencePlanRecoveryReceipt({ sourceAdmission, report,
  rootSourceBootstrapAuthorization }) {
  const core = {
    schema: "agentic-lane-admission-plan-recovery/v2",
    status: "accepted",
    recoveryMode: "root-source-bootstrap-one-ahead-finalization",
    reason: "operator-authorized-clean-fence-heartbeat-replan",
    previousPlanReportDigest: digest(sourceAdmission?.planReceiptDigest,
      "previous plan report digest"),
    previousAdmissionReceiptDigest: digest(sourceAdmission?.admissionReceiptDigest,
      "previous admission receipt digest"),
    previousExistingLaneStateDigest: digest(sourceAdmission?.existingLaneStateDigest,
      "previous lane-state digest"),
    recoveredPlanReportDigest: digest(report?.reportDigest, "recovered plan report digest"),
    recoveredAdmissionReceiptDigest: digest(report?.admissionReceipt?.receiptDigest,
      "recovered admission receipt digest"),
    recoveredExistingLaneStateDigest: digest(report?.existingLaneStateDigest,
      "recovered lane-state digest"),
    rootSourceBootstrapAuthorizationDigest: digest(
      rootSourceBootstrapAuthorization?.authorizationDigest,
      "root-source bootstrap authorization digest",
    ),
    maintenanceSourcePath: text(rootSourceBootstrapAuthorization?.maintenanceSourcePath,
      "maintenance source path"),
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

export function buildPlannedCleanFenceFinalizationRecord({ plan, authorization,
  taskReceipt, preview, targetAuthority, heartbeatProjection }) {
  const core = {
    schema: "agentic-planned-clean-fence-one-ahead-admission-finalization-record/v1",
    planDigest: digest(plan?.planDigest, "plan digest"),
    sourceLeaseDigest: digest(plan?.evidence?.sourceLeaseDigest, "source lease digest"),
    authorizationDigest: digest(authorization?.authorizationDigest, "authorization digest"),
    taskAuthorityReceiptDigest: digest(taskReceipt?.receiptDigest,
      "task-authority receipt digest"),
    taskProofDigest: digest(taskReceipt?.proofDigest, "task proof digest"),
    rootSourceBootstrapAuthorizationDigest: digest(
      plan?.evidence?.rootSourceBootstrapAuthorizationDigest,
      "root-source bootstrap authorization digest",
    ),
    targetCloudAuthorityDigest: digestValue(targetAuthority),
    heartbeatProjectionDigest: digest(heartbeatProjection?.projectionDigest,
      "heartbeat projection digest"),
    planRecoveryReceiptDigest: digest(preview?.planRecoveryReceipt?.receiptDigest,
      "plan-recovery receipt digest"),
    admissionReportDigest: digest(preview?.admittedReport?.reportDigest,
      "admission report digest"),
    preservationReceiptDigest: digest(preview?.preservationReceipt?.receiptDigest,
      "preservation receipt digest"),
    mutationAuthorityReceiptDigest: digest(
      preview?.admittedReport?.mutationAuthorityReceipt?.receiptDigest,
      "mutation-authority receipt digest",
    ),
    finalizedAt: text(preview?.admittedReport?.evaluatedAt, "finalized time"),
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function normalizeEvidence(input) {
  const sourceLease = record(input.sourceLease, "source lease");
  const admission = record(sourceLease.admission, "source admission");
  const cloudAuthority = record(sourceLease.cloudAuthority, "source cloud authority");
  const taskAuthority = record(sourceLease.taskAuthority, "source task authority");
  const manifest = record(input.manifest, "manifest");
  const sourceGit = record(input.sourceGit, "source Git frame");
  const review = record(input.review, "review frame");
  const targetCloudAuthority = record(input.targetCloudAuthority, "target cloud authority");
  const rootAuthorization = record(input.rootSourceBootstrapAuthorization,
    "root-source bootstrap authorization");
  const preview = record(input.preview, "finalization preview");
  const protectedController = normalizeProtectedController(input.protectedController);
  const rawIndexFrame = normalizeRawIndexFrame(input.rawIndexFrame);
  if (sourceLease.schema !== "agentic-writer-lease/v2" || sourceLease.status !== "active"
    || admission.schema !== "agentic-lane-admission-lease/v1" || admission.status !== "planned"
    || cloudAuthority.schema !== "agentic-lane-cloud-authority/v1"
    || taskAuthority.schema !== "agentic-task-authority-binding/v1") {
    invalid("active task-bound planned source lease");
  }
  const sourceLeaseDigest = digest(input.sourceLeaseDigest, "source lease digest");
  if (sourceLeaseDigest !== digestValue(sourceLease)) invalid("source lease digest join");
  if (manifest.manifestDigest !== admission.manifestDigest
    || manifest.writeSetDigest !== admission.writeSetDigest
    || canonicalJson(manifest.declaredWriteSet) !== canonicalJson(admission.declaredWriteSet)
    || manifest.semanticScope !== sourceLease.scope) invalid("manifest join");
  const branch = text(sourceLease.branch, "source branch");
  const fenceSha = sha(sourceLease.fenceSha, "source fence");
  if (sourceGit.branch !== branch || sourceGit.headSha !== fenceSha
    || sourceGit.localRefSha !== fenceSha || sourceGit.remoteRefSha !== fenceSha
    || sourceGit.parentSha !== sourceLease.baseSha
    || !Array.isArray(sourceGit.parentShas) || sourceGit.parentShas.length !== 1
    || sourceGit.parentShas[0] !== sourceLease.baseSha
    || sourceGit.treeSha !== sourceGit.baseTreeSha
    || sourceGit.clean !== true || sourceGit.changedPaths.length !== 0
    || !DIGEST.test(sourceGit.indexSha256) || !DIGEST.test(sourceGit.statusDigest)) {
    invalid("clean empty coordination fence");
  }
  if (review.state !== "OPEN" || review.draft !== true || review.autoMergeRequest !== null
    || review.branch !== branch || review.headSha !== fenceSha
    || !SHA.test(String(review.baseSha || ""))
    || review.url !== sourceLease.pullRequestUrl
    || typeof review.body !== "string" || review.bodyDigest !== digestValue(review.body)
    || review.markerDigest !== digestValue(projectWriterLeasePullRequestMarker(sourceLease))) {
    invalid("open draft review at exact source fence");
  }
  const heartbeatProjection = projectPlannedDirtyHeartbeatProjection({
    sourceLease,
    targetCloudAuthority,
    observedAt: text(input.observedAt, "observation time"),
  });
  if (heartbeatProjection.disposition !== "one-ahead"
    || input.heartbeatProjectionDigest !== heartbeatProjection.projectionDigest
    || input.targetCloudAuthorityDigest !== digestValue(targetCloudAuthority)) {
    invalid("one-ahead heartbeat projection");
  }
  if (targetCloudAuthority.claimId !== cloudAuthority.claimId
    || targetCloudAuthority.laneRevision !== fenceSha
    || targetCloudAuthority.canonicalBaseSha !== sourceLease.baseSha
    || targetCloudAuthority.writeSetDigest !== admission.writeSetDigest) {
    invalid("target cloud subject join");
  }
  if (rootAuthorization.authorizationDigest
      !== digest(input.rootSourceBootstrapAuthorizationDigest,
        "root-source bootstrap authorization digest")) {
    invalid("root-source bootstrap authorization join");
  }
  const sourceRegistry = record(input.sourceRegistry, "source registry");
  positive(sourceRegistry.revision, "source registry revision");
  digest(sourceRegistry.registryDigest, "source registry digest");
  for (const field of ["peerLaneStateDigest", "protectedMainAdvanceDigest",
    "candidateCreateRegisterResultDigest", "recoveredPlanReportDigest",
    "recoveredAdmissionReceiptDigest", "recoveredExistingLaneStateDigest",
    "preservationReceiptDigest", "admittedReportDigest", "planRecoveryReceiptDigest"]) {
    digest(preview[field], `preview ${field}`);
  }
  const stable = {
    observedAt: text(input.observedAt, "observation time"),
    repository: record(input.repository, "repository frame"),
    sourceLease,
    sourceLeaseDigest,
    sourceRegistry,
    manifest,
    sourceGit,
    review,
    targetCloudAuthority,
    targetCloudAuthorityDigest: input.targetCloudAuthorityDigest,
    heartbeatProjection,
    heartbeatProjectionDigest: heartbeatProjection.projectionDigest,
    protectedController,
    rawIndexFrame,
    rootSourceBootstrapAuthorization: rootAuthorization,
    rootSourceBootstrapAuthorizationDigest: rootAuthorization.authorizationDigest,
    previousAdmissionDigest: digestValue(admission),
    preview,
  };
  return deepFreeze(stable);
}

function normalizeProtectedController(value) {
  const source = record(value, "protected controller");
  const result = { schema: source.schema, branch: source.branch,
    headSha: sha(source.headSha, "controller head"),
    treeSha: sha(source.treeSha, "controller tree"),
    localMainSha: sha(source.localMainSha, "controller local main"),
    originMainSha: sha(source.originMainSha, "controller origin main"),
    remoteMainSha: sha(source.remoteMainSha, "controller remote main"),
    clean: source.clean, statusDigest: digest(source.statusDigest, "controller status"),
    implementationDigest: digest(source.implementationDigest, "controller implementation") };
  if (result.schema !== "agentic-planned-clean-fence-protected-controller/v1"
    || result.branch !== "main" || result.clean !== true
    || result.statusDigest !== digestValue("")
    || result.headSha !== result.localMainSha || result.headSha !== result.originMainSha
    || result.headSha !== result.remoteMainSha) invalid("integrated protected controller main");
  return result;
}

function normalizeRawIndexFrame(value) {
  const source = record(value, "raw index frame");
  const result = { schema: source.schema,
    laneCount: positive(source.laneCount, "raw index lane count"),
    candidateIndexSha256: digest(source.candidateIndexSha256, "candidate raw index"),
    indexFrameDigest: digest(source.indexFrameDigest, "raw index frame") };
  if (result.schema !== "agentic-registered-raw-index-frame/v1") {
    invalid("raw index frame schema");
  }
  return result;
}

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  return structuredClone(value);
}
function text(value, label) {
  if (typeof value !== "string" || !value.trim()) invalid(label);
  return value;
}
function sha(value, label) {
  if (!SHA.test(String(value || ""))) invalid(label);
  return value;
}
function digest(value, label) {
  if (!DIGEST.test(String(value || ""))) invalid(label);
  return value;
}
function positive(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) invalid(label);
  return value;
}
function invalid(label) {
  throw new Error(`Planned-clean fence admission finalization has invalid ${label}.`);
}
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
