// Responsibility: Join exact Git, cloud, root-bootstrap, task-capability, lease-CAS, and review-marker ports.
import path from "node:path";
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import { captureProtectedMainAdvance } from "./device-branch-ownership-lib.mjs";
import { projectPlannedDirtyHeartbeatProjection }
  from "./planned-dirty-admission-recovery-evidence.mjs";
import { assertExactTargetMarkerBodyCapacity }
  from "./planned-dirty-admission-recovery-repository-support.mjs";
import {
  OPERATION,
  buildPlannedCleanFenceFinalizationRecord,
  buildPlannedCleanFenceAdmissionFinalizationResult,
  buildPlannedCleanFencePlanRecoveryReceipt,
  normalizePlannedCleanFenceAdmissionFinalizationPlan,
} from "./planned-clean-fence-one-ahead-admission-finalization-contract.mjs";
import { collectScopedLaneState, attachAdmissionReceipt, finalizeScopedLaneAdmission,
  verifyPreservedLaneState } from "./scoped-lane-admission-state.mjs";
import { evaluateScopedLaneAdmission, createAdmissionLeaseProjection,
  normalizeDeclaredWriteScopeManifest } from "./scoped-lane-admission-lib.mjs";
import { assertRootSourceBootstrapCurrent }
  from "./scoped-lane-bootstrap-authorization.mjs";
import { invokeRepositoryCloudAction, verifyAdmissionCloudAuthority }
  from "./scoped-lane-cloud-authority.mjs";
import { reconcileCloudAuthorityProjection }
  from "./scoped-lane-cloud-reconciliation.mjs";
import { FINALIZATION_RECEIPTS_FIELD, assertFinalizationBodyCapacity,
  assertFinalizationRegistryTarget, assertNoCompetingFinalizationIntent,
  assertRegisteredRawIndexFrame,
  capturePlannedCleanFenceProtectedController, captureRegisteredRawIndexFrame,
  projectFinalizationPreviewEvidence, projectStatusVerifiedCloudAuthority,
  rawIndexSha256, readExactWriterMarker,
  recoverProtectedDescendantCandidateRegistration, replacePlannedCleanFenceWriterMarker }
  from "./planned-clean-fence-one-ahead-admission-finalization-evidence.mjs";
import { authorizeTaskBoundLeaseMutation } from "./task-bound-lane-authority-store.mjs";
import { absolute, defaultGh, defaultGit, inside, readJson, required }
  from "./planned-clean-fence-one-ahead-admission-finalization-ports.mjs";
import { createWriterLeaseStore, projectWriterLeasePullRequestMarker }
  from "./writer-lease-lib.mjs";
import { mutateWriterLeaseRegistry, withHeartbeatProjectionFence, writerLeaseDigest }
  from "./writer-lease-registry-cas.mjs";
const RECORD_SCHEMA = "agentic-planned-clean-fence-one-ahead-admission-finalization-record/v1";
const REGISTRY_RECEIPT_SCHEMA =
  "agentic-planned-clean-fence-one-ahead-admission-finalization-registry-receipt/v1";

export function createPlannedCleanFenceAdmissionFinalizationRepositoryAdapter(
  options = {}, dependencies = {},
) {
  const canonicalRepository = absolute(options.canonicalRepository, "canonical repository");
  const repository = absolute(options.repository, "candidate repository");
  const branch = required(options.branch, "branch");
  const sessionId = required(options.sessionId, "session");
  const manifestFile = absolute(options.manifestFile, "manifest file");
  const rootAuthorizationFile = absolute(options.rootAuthorizationFile,
    "root-source bootstrap authorization file");
  const taskAuthorityFile = absolute(options.taskAuthorityFile, "task authority file");
  for (const candidate of [manifestFile, rootAuthorizationFile, taskAuthorityFile]) {
    if (inside(canonicalRepository, candidate) || inside(repository, candidate)) {
      throw new Error("Admission-finalization authority inputs must remain outside repositories.");
    }
  }
  const environment = dependencies.environment || process.env;
  const git = dependencies.git || defaultGit(environment);
  const gh = dependencies.gh || defaultGh(environment);
  const clock = dependencies.clock || (() => new Date());
  const inspectCloud = dependencies.inspectCloud || invokeRepositoryCloudAction;
  const verifyCloud = dependencies.verifyCloud || verifyAdmissionCloudAuthority;
  const commonDirectory = path.resolve(canonicalRepository,
    git(canonicalRepository, ["rev-parse", "--git-common-dir"]));
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({
    gitCommonDir: commonDirectory,
    taskAuthorityFile,
    taskAuthorityPolicy: "required",
    now: clock,
  });
  const ports = {
    captureController: dependencies.captureController || (() =>
      capturePlannedCleanFenceProtectedController({ canonicalRepository, git })),
    captureIndexes: dependencies.captureIndexes || (() =>
      captureRegisteredRawIndexFrame({ canonicalRepository, repository, git })),
    recapture: dependencies.recapture || recapture,
    authorize: dependencies.authorize || authorizeTaskBoundLeaseMutation,
    mutateRegistry: dependencies.mutateRegistry || mutateWriterLeaseRegistry,
    projectMarker: dependencies.projectMarker || projectMarker,
    verifyTerminal: dependencies.verifyTerminal || verifyTerminal,
  };
  function readPlanEvidence() {
    const rawIndexFrame = ports.captureIndexes();
    const protectedController = ports.captureController();
    const sourceLease = requireSourceLease(leaseStore.read(branch));
    const observedAt = clock().toISOString();
    const manifest = readManifest(sourceLease);
    const review = readReview(sourceLease);
    const sourceGit = readSourceGit(sourceLease);
    const cloud = readTargetCloud({ sourceLease, manifest, observedAt });
    const rootSourceBootstrapAuthorization = readJson(rootAuthorizationFile,
      "root-source bootstrap authorization");
    const preview = buildFinalizationPreview({
      sourceLease,
      manifest,
      review,
      cloud,
      rootSourceBootstrapAuthorization,
    });
    assertRegisteredRawIndexFrame(rawIndexFrame, ports.captureIndexes());
    if (sourceGit.indexSha256 !== rawIndexFrame.candidateIndexSha256) {
      throw new Error("Admission-finalization candidate index evidence disagrees.");
    }
    const registry = leaseStore.readRegistry();
    assertNoCompetingFinalizationIntent({ registry, branch });
    return Object.freeze({
      observedAt,
      repository: {
        canonicalPath: canonicalRepository,
        candidatePath: repository,
        protectedMainAdvance: preview.protectedMainAdvance,
        peerLaneStateDigest: preview.peerLaneStateDigest,
        candidateCreateRegisterResultDigest: preview.candidateCreateRegisterResult.resultDigest,
        recoveredExistingLaneStateDigest: preview.report.existingLaneStateDigest,
      },
      sourceLease,
      sourceLeaseDigest: writerLeaseDigest(sourceLease),
      sourceRegistry: {
        revision: registry.revision,
        registryDigest: digestValue(registry),
      },
      manifest,
      sourceGit,
      review,
      targetCloudAuthority: cloud.targetAuthority,
      targetCloudAuthorityDigest: digestValue(cloud.targetAuthority),
      heartbeatProjectionDigest: cloud.heartbeatProjection.projectionDigest,
      protectedController,
      rawIndexFrame,
      rootSourceBootstrapAuthorization,
      rootSourceBootstrapAuthorizationDigest:
        rootSourceBootstrapAuthorization.authorizationDigest,
      preview: projectFinalizationPreviewEvidence(preview),
    });
  }
  function execute({ plan: planValue, authorization }) {
    const plan = normalizePlannedCleanFenceAdmissionFinalizationPlan(planValue);
    const indexes = ports.captureIndexes();
    assertRegisteredRawIndexFrame(plan.evidence.rawIndexFrame, indexes);
    if (canonicalJson(ports.captureController())
      !== canonicalJson(plan.evidence.protectedController)) {
      throw new Error("Admission-finalization protected controller drifted after planning.");
    }
    try { return executeCore({ plan, authorization }); }
    finally { assertRegisteredRawIndexFrame(indexes, ports.captureIndexes()); }
  }
  function executeCore({ plan, authorization }) {
    const source = plan.evidence.sourceLease;
    const current = leaseStore.read(branch);
    const existingRecord = current?.plannedCleanFenceAdmissionFinalization;
    let disposition = "adopted";
    let targetLease = current;
    let registryRevision = leaseStore.readRegistry().revision;
    let taskReceiptDigest = existingRecord?.taskAuthorityReceiptDigest || null;
    if (writerLeaseDigestSafe(current) === plan.evidence.sourceLeaseDigest) {
      const stable = ports.recapture(plan);
      targetBody(plan, projectTargetLease({ current, stable, plan, authorization,
        taskReceipt: { receiptDigest: "0".repeat(64), proofDigest: "0".repeat(64) } }));
      const taskReceipt = ports.authorize({
        lease: current,
        capabilityPath: taskAuthorityFile,
        operation: `${OPERATION}:${plan.planDigest}`,
        now: clock(),
      });
      taskReceiptDigest = taskReceipt.receiptDigest;
      const projected = projectTargetLease({ current, stable, plan, authorization, taskReceipt });
      targetBody(plan, projected);
      const finalizationRecord = projected.plannedCleanFenceAdmissionFinalization;
      const targetLeaseDigest = writerLeaseDigest(projected);
      const result = ports.mutateRegistry({
        leaseStore,
        branch,
        expectedLeaseDigest: plan.evidence.sourceLeaseDigest,
        expectedClaimId: source.cloudAuthority.claimId,
        action: ({ registry }) => {
          assertNoCompetingFinalizationIntent({ registry, branch });
          const receiptCore = {
            schema: REGISTRY_RECEIPT_SCHEMA,
            planDigest: plan.planDigest,
            sourceLeaseDigest: plan.evidence.sourceLeaseDigest,
            targetLeaseDigest,
            claimId: source.cloudAuthority.claimId,
            recordDigest: finalizationRecord.receiptDigest,
            registryRevision: registry.revision + 1,
          };
          const receipt = { ...receiptCore, receiptDigest: digestValue(receiptCore) };
          return {
            registry: {
              ...registry,
              leases: { ...registry.leases, [branch]: projected },
              [FINALIZATION_RECEIPTS_FIELD]: {
                ...(registry[FINALIZATION_RECEIPTS_FIELD] || {}),
                [plan.planDigest]: receipt,
              },
            },
            lease: projected,
            changed: true,
          };
        },
      });
      targetLease = result.lease;
      registryRevision = result.registryRevision;
      disposition = "projected";
    } else {
      targetLease = requireAdoptableTarget({ plan, lease: current, authorization });
      taskReceiptDigest = targetLease.plannedCleanFenceAdmissionFinalization
        .taskAuthorityReceiptDigest;
    }
    targetBody(plan, targetLease);
    const marker = ports.projectMarker({ plan, lease: targetLease });
    const terminal = ports.verifyTerminal({ plan, lease: targetLease,
      bodyDigest: marker.bodyDigest });
    return buildPlannedCleanFenceAdmissionFinalizationResult({
      plan,
      authorization,
      taskAuthorityReceiptDigest: taskReceiptDigest,
      leaseDigest: writerLeaseDigest(targetLease),
      markerDigest: terminal.markerDigest,
      bodyDigest: terminal.bodyDigest,
      admissionReportDigest: targetLease.admission.admittedReportDigest,
      preservationReceiptDigest: targetLease.admission.preservationReceiptDigest,
      mutationAuthorityReceiptDigest: targetLease.plannedCleanFenceAdmissionFinalization
        .mutationAuthorityReceiptDigest,
      registryRevision,
      disposition,
    });
  }
  function projectTargetLease({ current, stable, plan, authorization, taskReceipt }) {
    const record = buildPlannedCleanFenceFinalizationRecord({ plan, authorization, taskReceipt,
      preview: stable.preview, targetAuthority: stable.cloud.targetAuthority,
      heartbeatProjection: stable.cloud.heartbeatProjection });
    return { ...current, cloudAuthority: stable.cloud.targetAuthority,
      heartbeatAt: stable.cloud.heartbeatProjection.heartbeatAt,
      expiresAt: stable.cloud.heartbeatProjection.expiresAt,
      admission: createAdmissionLeaseProjection(stable.preview.admittedReport),
      plannedCleanFenceAdmissionFinalization: record };
  }
  function targetBody(plan, lease) {
    assertExactTargetMarkerBodyCapacity({ sourceBody: plan.evidence.review.body,
      targetLease: lease });
    return assertFinalizationBodyCapacity(
      replacePlannedCleanFenceWriterMarker(plan.evidence.review.body, lease));
  }
  function recapture(plan) {
    const rawIndexFrame = ports.captureIndexes();
    const protectedController = ports.captureController();
    const lease = requireSourceLease(leaseStore.read(branch));
    if (writerLeaseDigest(lease) !== plan.evidence.sourceLeaseDigest) {
      throw new Error("Admission-finalization source lease drifted from the authorized plan.");
    }
    const manifest = readManifest(lease);
    const review = readReview(lease);
    const sourceGit = readSourceGit(lease);
    const cloud = readTargetCloud({ sourceLease: lease, manifest,
      observedAt: plan.evidence.observedAt });
    const rootSourceBootstrapAuthorization = readJson(rootAuthorizationFile,
      "root-source bootstrap authorization");
    const preview = buildFinalizationPreview({ sourceLease: lease, manifest, review, cloud,
      rootSourceBootstrapAuthorization });
    const stable = {
      manifest,
      sourceGit,
      review,
      targetCloudAuthority: cloud.targetAuthority,
      targetCloudAuthorityDigest: digestValue(cloud.targetAuthority),
      heartbeatProjectionDigest: cloud.heartbeatProjection.projectionDigest,
      protectedController,
      rawIndexFrame,
      rootSourceBootstrapAuthorization,
      rootSourceBootstrapAuthorizationDigest: rootSourceBootstrapAuthorization.authorizationDigest,
      preview: projectFinalizationPreviewEvidence(preview),
    };
    const expected = {
      manifest: plan.evidence.manifest,
      sourceGit: plan.evidence.sourceGit,
      review: plan.evidence.review,
      targetCloudAuthority: plan.evidence.targetCloudAuthority,
      targetCloudAuthorityDigest: plan.evidence.targetCloudAuthorityDigest,
      heartbeatProjectionDigest: plan.evidence.heartbeatProjectionDigest,
      protectedController: plan.evidence.protectedController,
      rawIndexFrame: plan.evidence.rawIndexFrame,
      rootSourceBootstrapAuthorization: plan.evidence.rootSourceBootstrapAuthorization,
      rootSourceBootstrapAuthorizationDigest:
        plan.evidence.rootSourceBootstrapAuthorizationDigest,
      preview: plan.evidence.preview,
    };
    if (canonicalJson(stable) !== canonicalJson(expected)
      || sourceGit.indexSha256 !== rawIndexFrame.candidateIndexSha256) {
      throw new Error("Admission-finalization source, cloud, peer, or index evidence drifted.");
    }
    assertRegisteredRawIndexFrame(rawIndexFrame, ports.captureIndexes());
    return { cloud, preview };
  }
  function readTargetCloud({ sourceLease, manifest, observedAt }) {
    const statusResult = inspectCloud({
      action: "status",
      ledgerRepository: sourceLease.cloudAuthority.ledgerRepository,
      request: {
        targetRepository: sourceLease.cloudAuthority.targetRepository,
        claimId: sourceLease.cloudAuthority.claimId,
      },
      environment,
    });
    const claim = statusResult.claims?.filter(item =>
      item.claimId === sourceLease.cloudAuthority.claimId);
    if (claim?.length !== 1) throw new Error("Admission finalization requires one exact live claim.");
    const reconciled = reconcileCloudAuthorityProjection({
      authority: sourceLease.cloudAuthority,
      manifest,
      statusResult,
      branch,
      headSha: sourceLease.fenceSha,
      now: new Date(observedAt),
    });
    const verified = verifyCloud({ authority: reconciled.authority, manifest,
      canonicalBaseSha: sourceLease.baseSha, environment });
    const targetAuthority = projectStatusVerifiedCloudAuthority({ statusClaim: claim[0],
      verification: verified.verification, authority: verified.authority });
    const heartbeatProjection = projectPlannedDirtyHeartbeatProjection({
      sourceLease,
      targetCloudAuthority: targetAuthority,
      observedAt,
    });
    if (heartbeatProjection.disposition !== "one-ahead") {
      throw new Error("Admission finalization requires exactly one lost cloud heartbeat.");
    }
    return { targetAuthority, verification: verified.verification, heartbeatProjection };
  }
  function buildFinalizationPreview({ sourceLease, manifest, review, cloud,
    rootSourceBootstrapAuthorization }) {
    const snapshot = collectScopedLaneState({ repository: canonicalRepository, git });
    const candidateLanes = snapshot.lanes.filter(item =>
      path.resolve(item.path) === repository);
    if (candidateLanes.length !== 1) {
      throw new Error("Admission finalization requires one exact registered candidate lane.");
    }
    const protectedMainSha = git(canonicalRepository, ["rev-parse", "HEAD"]);
    const protectedMainAdvance = captureProtectedMainAdvance({
      baseSha: sourceLease.baseSha,
      pullRequestBaseSha: review.baseSha,
      protectedMainSha,
      declaredWriteSet: manifest.declaredWriteSet,
      gitText: args => git(canonicalRepository, args),
    });
    const candidateCreateRegisterResult = recoverProtectedDescendantCandidateRegistration({
      canonicalRepository,
      repository,
      lease: sourceLease,
      branch,
      git,
    });
    const peers = snapshot.lanes.filter(item => path.resolve(item.path) !== repository);
    let report = evaluateScopedLaneAdmission({
      repository: canonicalRepository,
      canonicalPath: canonicalRepository,
      canonicalBaseSha: sourceLease.baseSha,
      canonicalSourceDisposition: protectedMainSha === sourceLease.baseSha
        ? "exact" : "preserved-behind",
      targetPath: repository,
      branch,
      semanticScope: sourceLease.scope,
      targetSafe: true,
      manifest,
      lanes: peers,
      cloudAuthority: cloud.targetAuthority,
      remoteAuthorityRequired: true,
      remoteAuthorityVerification: cloud.verification,
      rootSourceBootstrapAuthorization,
      mode: "check",
      evaluatedAt: cloud.verification.verifiedAt,
    });
    if (report.authoringAdmission.status !== "planned") {
      throw new Error(`Admission finalization peer revalidation blocked: ${JSON.stringify(
        report.authoringAdmission.findings)}`);
    }
    report = attachAdmissionReceipt({
      report,
      targetObservationDigest: candidateCreateRegisterResult.expectedTargetObservationDigest,
      remoteAuthorityVerification: cloud.verification,
    });
    assertRootSourceBootstrapCurrent({ report,
      remoteAuthorityVerification: cloud.verification });
    const projectedPlannedLease = {
      ...sourceLease,
      cloudAuthority: cloud.targetAuthority,
      heartbeatAt: cloud.heartbeatProjection.heartbeatAt,
      expiresAt: cloud.heartbeatProjection.expiresAt,
      admission: createAdmissionLeaseProjection(report),
    };
    const preservationReceipt = verifyPreservedLaneState(
      report,
      collectScopedLaneState({ repository: canonicalRepository, git }).lanes,
      {
        lease: projectedPlannedLease,
        candidateCreateRegisterResult,
        remoteAuthorityVerification: cloud.verification,
      },
    );
    const admittedReport = finalizeScopedLaneAdmission({
      report,
      lease: projectedPlannedLease,
      preservationReceipt,
      cloudAuthority: cloud.targetAuthority,
      remoteAuthorityVerification: cloud.verification,
    });
    const planRecoveryReceipt = buildPlannedCleanFencePlanRecoveryReceipt({
      sourceAdmission: sourceLease.admission,
      report,
      rootSourceBootstrapAuthorization,
    });
    return {
      report,
      admittedReport,
      preservationReceipt,
      planRecoveryReceipt,
      protectedMainAdvance,
      candidateCreateRegisterResult,
      peerLaneStateDigest: snapshot.laneStateDigest,
    };
  }
  function projectMarker({ plan, lease }) {
    const target = targetBody(plan, lease);
    const targetBodyDigest = digestValue(target);
    return withHeartbeatProjectionFence({
      leaseStore,
      branch,
      expectedLeaseDigest: writerLeaseDigest(lease),
      expectedClaimId: lease.cloudAuthority.claimId,
      action: () => {
        let review = readReview(lease, { allowSourceMarker: true });
        assertSealedReview(plan, review, target, true);
        const adopted = review.body === target;
        if (!adopted) {
          gh(["pr", "edit", review.url, "--body", target]);
          review = readReview(lease, { allowSourceMarker: true });
          assertSealedReview(plan, review, target, false);
        }
        if (review.body !== target
          || review.markerDigest !== digestValue(projectWriterLeasePullRequestMarker(lease))) {
          throw new Error("Admission-finalization hidden marker did not reach its exact target.");
        }
        return { bodyDigest: targetBodyDigest, markerDigest: review.markerDigest, adopted };
      },
    });
  }
  function verifyTerminal({ plan, lease, bodyDigest }) {
    requireAdoptableTarget({ plan, lease,
      authorization: { authorizationDigest:
        lease.plannedCleanFenceAdmissionFinalization.authorizationDigest } });
    const before = ports.captureIndexes();
    const sourceGit = readSourceGit(lease);
    const review = readReview(lease);
    const cloud = readTargetCloud({ sourceLease: plan.evidence.sourceLease,
      manifest: plan.evidence.manifest, observedAt: plan.evidence.observedAt });
    const target = targetBody(plan, lease);
    assertSealedReview(plan, review, target, false);
    if (canonicalJson(sourceGit) !== canonicalJson(plan.evidence.sourceGit)
      || digestValue(cloud.targetAuthority) !== plan.evidence.targetCloudAuthorityDigest
      || review.body !== target || review.bodyDigest !== bodyDigest
      || review.markerDigest !== digestValue(projectWriterLeasePullRequestMarker(lease))
      || canonicalJson(ports.captureController())
        !== canonicalJson(plan.evidence.protectedController)) {
      throw new Error("Admission-finalization terminal source, cloud, marker, or index drifted.");
    }
    assertRegisteredRawIndexFrame(before, ports.captureIndexes());
    requireAdoptableTarget({ plan, lease,
      authorization: { authorizationDigest:
        lease.plannedCleanFenceAdmissionFinalization.authorizationDigest } });
    return review;
  }
  function assertSealedReview(plan, review, target, allowSource) {
    const sealed = plan.evidence.review;
    for (const field of ["id", "number", "url", "state", "draft", "autoMergeRequest",
      "branch", "headSha", "baseSha"]) {
      if (canonicalJson(review[field]) !== canonicalJson(sealed[field])) {
        throw new Error("Admission-finalization review identity drifted from the sealed plan.");
      }
    }
    if (review.body !== target && (!allowSource || review.body !== sealed.body)) {
      throw new Error("Admission-finalization review body left its exact source/target states.");
    }
  }
  function requireSourceLease(lease) {
    if (!lease || lease.schema !== "agentic-writer-lease/v2" || lease.status !== "active"
      || lease.branch !== branch || lease.sessionId !== sessionId
      || path.resolve(lease.worktreePath || "") !== repository
      || lease.admission?.status !== "planned" || lease.integration != null
      || !lease.cloudAuthority || !lease.taskAuthority) {
      throw new Error("Admission finalization requires the exact task-bound active planned lease.");
    }
    return lease;
  }
  function requireAdoptableTarget({ plan, lease, authorization }) {
    const record = lease?.plannedCleanFenceAdmissionFinalization;
    if (!lease || lease.admission?.status !== "admitted" || record?.schema !== RECORD_SCHEMA
      || record.planDigest !== plan.planDigest
      || record.sourceLeaseDigest !== plan.evidence.sourceLeaseDigest
      || record.authorizationDigest !== authorization.authorizationDigest
      || record.rootSourceBootstrapAuthorizationDigest
        !== plan.evidence.rootSourceBootstrapAuthorizationDigest
      || record.targetCloudAuthorityDigest !== plan.evidence.targetCloudAuthorityDigest
      || record.heartbeatProjectionDigest !== plan.evidence.heartbeatProjectionDigest) {
      throw new Error("Admission-finalization target lease is not an exact replay target.");
    }
    const { receiptDigest, ...core } = record;
    if (receiptDigest !== digestValue(core)) {
      throw new Error("Admission-finalization target record digest is invalid.");
    }
    if (typeof leaseStore.withRegistryLock !== "function") {
      throw new Error("Admission finalization requires the writer-registry lock.");
    }
    leaseStore.withRegistryLock(registry => assertFinalizationRegistryTarget({ registry,
      branch, plan, record, targetLeaseDigest: writerLeaseDigest(lease) }));
    return lease;
  }
  function readManifest(lease) {
    const source = readJson(manifestFile, "manifest");
    const manifest = normalizeDeclaredWriteScopeManifest(source,
      { expectedScope: lease.scope });
    if (manifest.manifestDigest !== lease.admission.manifestDigest
      || manifest.writeSetDigest !== lease.admission.writeSetDigest
      || canonicalJson(manifest.declaredWriteSet)
        !== canonicalJson(lease.admission.declaredWriteSet)) {
      throw new Error("Admission-finalization manifest drifted from the source lease.");
    }
    return manifest;
  }
  function readSourceGit(lease) {
    const headSha = git(repository, ["rev-parse", "HEAD"]);
    const treeSha = git(repository, ["rev-parse", "HEAD^{tree}"]);
    const status = git(repository,
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
    const changedPaths = git(canonicalRepository,
      ["diff", "--name-only", "--no-renames", "-z", lease.baseSha, lease.fenceSha, "--"])
      .split("\0").filter(Boolean);
    const localRefSha = git(canonicalRepository, ["rev-parse", `refs/heads/${branch}`]);
    const remote = git(canonicalRepository,
      ["ls-remote", "--heads", "origin", `refs/heads/${branch}`]).split(/\s+/u);
    const parentShas = git(repository, ["show", "-s", "--format=%P", "HEAD"])
      .split(/\s+/u).filter(Boolean);
    const parentSha = parentShas.length === 1 ? parentShas[0] : null;
    const baseTreeSha = git(canonicalRepository, ["rev-parse", `${lease.baseSha}^{tree}`]);
    const frame = {
      branch,
      headSha,
      treeSha,
      localRefSha,
      remoteRefSha: remote[0] || null,
      parentSha,
      parentShas,
      baseTreeSha,
      clean: status === "",
      statusDigest: digestValue(status),
      changedPaths,
      indexSha256: rawIndexSha256(repository, git),
    };
    if (headSha !== lease.fenceSha || treeSha !== baseTreeSha || localRefSha !== headSha
      || frame.remoteRefSha !== headSha || parentShas.length !== 1
      || parentSha !== lease.baseSha || status
      || changedPaths.length !== 0) {
      throw new Error("Admission finalization requires the exact clean empty coordination fence.");
    }
    return Object.freeze(frame);
  }
  function readReview(lease, { allowSourceMarker = false } = {}) {
    const value = JSON.parse(gh(["pr", "view", lease.pullRequestUrl, "--json",
      "id,number,url,state,isDraft,autoMergeRequest,headRefName,headRefOid,baseRefName,baseRefOid,body"]));
    const body = value.body || "";
    const marker = readExactWriterMarker(body).value;
    const markerDigest = digestValue(marker);
    const targetMarkerDigest = digestValue(projectWriterLeasePullRequestMarker(lease));
    if (!marker || value.url !== lease.pullRequestUrl || value.state !== "OPEN"
      || value.isDraft !== true || value.autoMergeRequest !== null
      || value.headRefName !== branch || value.headRefOid !== lease.fenceSha
      || value.baseRefName !== "main" || !/^[0-9a-f]{40}$/u.test(value.baseRefOid)
      || (!allowSourceMarker && markerDigest !== targetMarkerDigest)) {
      throw new Error("Admission finalization requires the exact open draft review at the fence.");
    }
    return Object.freeze({ id: value.id, number: value.number, url: value.url,
      state: value.state, draft: true, autoMergeRequest: null, branch: value.headRefName,
      headSha: value.headRefOid, baseSha: value.baseRefOid, body,
      bodyDigest: digestValue(body), markerDigest });
  }
  return Object.freeze({
    readPlanEvidence,
    execute,
    branch,
    gitCommonDir: commonDirectory,
  });
}
function writerLeaseDigestSafe(value) {
  try { return writerLeaseDigest(value); } catch { return null; }
}
