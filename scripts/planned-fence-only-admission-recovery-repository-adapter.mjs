// Responsibility: Join exact Git, review, cloud, task-capability, and lease-CAS recovery ports.
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { canonicalJson, digestValue, writeSetsOverlap }
  from "./cloud-collaboration-primitives.mjs";
import { normalizeDeclaredWriteScopeManifest } from "./scoped-lane-admission-lib.mjs";
import { assertRegisteredWorktree, assertWorktreeRegistry, parseWorktreeRecords }
  from "./repository-guards.mjs";
import { authorizeTaskBoundLeaseMutation, readTaskAuthorityCapability }
  from "./task-bound-lane-authority-store.mjs";
import { assertCapabilityMatchesBinding, assertTaskAuthorityBinding }
  from "./task-bound-lane-authority-contract.mjs";
import {
  WRITER_LEASE_SCHEMA,
  createWriterLeaseStore,
  parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker,
  updateWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";
import { casWriterLeaseProjection, writerLeaseDigest }
  from "./writer-lease-registry-cas.mjs";
import {
  buildPlannedFenceOnlyLeaseRecoveryReceipt,
  normalizePlannedFenceOnlyAdmissionRecoveryPlan,
} from "./planned-fence-only-admission-recovery-contract.mjs";
import { buildPlannedFenceOnlyAdmissionRecoveryEvidence }
  from "./planned-fence-only-admission-recovery-evidence.mjs";
import { createPlannedFenceOnlyAdmissionRecoveryCloudAdapter }
  from "./planned-fence-only-admission-recovery-cloud-adapter.mjs";

const REVIEW_ADAPTER_ID = "github-cli-hidden-writer-marker/v1";

export function createPlannedFenceOnlyAdmissionRecoveryRepositoryAdapter(options = {}, dependencies = {}) {
  const repository = canonicalPath(options.repository, "repository");
  const worktreePath = absolutePath(options.worktreePath, "worktree");
  const sessionId = requiredText(options.sessionId, "session");
  const manifestPath = externalPrivateFile(options.manifestFile, repository, "manifest");
  const taskAuthorityFile = options.taskAuthorityFile
    ? externalPrivateFile(options.taskAuthorityFile, repository, "task authority capability") : null;
  const execute = dependencies.execute || defaultExecute;
  const git = dependencies.git || ((cwd, args) => execute("git", ["-C", cwd, ...args], repository).trim());
  const gh = dependencies.gh || (args => execute("gh", args, repository).trim());
  const now = dependencies.now || (() => new Date());
  const branch = requiredText(options.branch, "branch");
  const commonDirectory = path.resolve(repository, git(repository, ["rev-parse", "--git-common-dir"]));
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({ gitCommonDir: commonDirectory });
  const manifest = normalizeDeclaredWriteScopeManifest(parseJson(readFileSync(manifestPath, "utf8"), "manifest"));
  const cloud = dependencies.cloudAdapter || createPlannedFenceOnlyAdmissionRecoveryCloudAdapter({
    environment: dependencies.environment || process.env,
    inspect: dependencies.inspectCloud,
    invoke: dependencies.invokeCloud,
    verify: dependencies.verifyCloud,
  });

  function readPlanEvidence() {
    return captureSource().evidence;
  }

  function assertSource(plan, stage) {
    const sealed = normalizePlannedFenceOnlyAdmissionRecoveryPlan(plan);
    const current = captureSource().evidence;
    assertPlannedFenceOnlyRecoveryReplay({
      sealed: sealed.evidence, current, isAncestor: ancestry, stage,
    });
    const expectedLocal = sealed.evidence.localProjection;
    const currentLocal = current.localProjection;
    if (!plannedFenceOnlyLocalProjectionMatches(expectedLocal, currentLocal)) {
      throw new Error(`Planned fence-only local projection drifted at ${stage}.`);
    }
    return current;
  }

  function authorizeTask(plan) {
    const sealed = normalizePlannedFenceOnlyAdmissionRecoveryPlan(plan);
    assertSource(sealed, "task-authority-verification");
    const receipt = taskProof(sealed.evidence.sourceLease, sealed);
    return Object.freeze({
      taskAuthorityReceiptDigest: receipt.receiptDigest,
      bindingDigest: sealed.evidence.sourceLease.taskAuthority.bindingDigest,
    });
  }

  function prepareLocalProjection(plan) {
    const sealed = normalizePlannedFenceOnlyAdmissionRecoveryPlan(plan);
    assertSource(sealed, "local-projection-prepare");
    const local = sealed.evidence.localProjection;
    return localPhaseIdentity(sealed, {
      sourceProjectionDigest: sealed.evidence.localProjectionDigest,
      protectedMainAdvanceDigest: sealed.evidence.protectedMainAdvance.advanceDigest,
    });
  }

  function restoreLocalProjection(plan) {
    const sealed = normalizePlannedFenceOnlyAdmissionRecoveryPlan(plan);
    const local = sealed.evidence.localProjection;
    if (local.mode === "externally-lost") restoreExternallyLostProjection(sealed);
    const frame = readFrame(sealed.evidence.sourceLease, { requireAttached: true });
    const branchProjectionDigest = digestValue({
      branch, headSha: frame.localProjection.localRefSha,
    });
    const worktreeProjectionDigest = digestValue({
      path: worktreePath, headSha: frame.localProjection.worktreeHeadSha,
      treeSha: frame.localProjection.worktreeTreeSha,
      statusDigest: frame.localProjection.statusDigest,
    });
    const stable = {
      schema: "agentic-planned-fence-only-local-projection-restored/v1",
      planDigest: sealed.planDigest,
      mode: local.mode,
      mutationSet: sealed.localMutationSet,
      branch,
      targetPath: worktreePath,
      headSha: local.headSha,
      branchProjectionDigest,
      worktreeProjectionDigest,
    };
    return localPhaseIdentity(sealed, {
      branchProjectionDigest,
      worktreeProjectionDigest,
      restoredProjectionDigest: digestValue(stable),
    });
  }

  function sealCloudRequest(plan) {
    const sealed = normalizePlannedFenceOnlyAdmissionRecoveryPlan(plan);
    requireBoundCapability(requireSourceLease(leaseStore.read(branch), sealed));
    assertSource(sealed, "cloud-request-seal");
    return cloud.sealRequest(sealed);
  }

  function recoverCloud(plan, { sealedRequest }) {
    const sealed = normalizePlannedFenceOnlyAdmissionRecoveryPlan(plan);
    const current = requireSourceLease(leaseStore.read(branch), sealed);
    requireBoundCapability(current);
    const sourceFrame = assertSource(sealed, "before-cloud-recovery");
    assertLocalFrame(sealed, current, "source", sourceFrame);
    return cloud.recover({ plan: sealed, sealedRequest });
  }

  function projectLease(plan, { intent }) {
    const sealed = normalizePlannedFenceOnlyAdmissionRecoveryPlan(plan);
    const cloudValues = intent.phases.cloud_recovered.values;
    const requestValues = intent.phases.cloud_request_sealed.values;
    const taskValues = intent.phases.task_authority_verified.values;
    const recoveryReceipt = buildPlannedFenceOnlyLeaseRecoveryReceipt({
      plan: sealed,
      taskAuthorityReceiptDigest: taskValues.taskAuthorityReceiptDigest,
      sealedTransportDigest: requestValues.sealedTransportDigest,
      semanticOperationDigest: cloudValues.semanticOperationDigest,
      recoveredAuthority: cloudValues.authority,
      recoveredAt: cloudValues.recoveredAt,
      operationReceiptDigest: cloudValues.operationReceiptDigest,
      providerReceiptDigest: cloudValues.providerReceiptDigest,
      idempotencyKey: cloudValues.idempotencyKey,
    });
    const expected = projectPlannedFenceOnlyRecoveryLease({
      sourceLease: sealed.evidence.sourceLease,
      recoveredAuthority: cloudValues.authority,
      recoveryReceipt,
    });
    const current = leaseStore.read(branch);
    requireBoundCapability(current);
    if (writerLeaseDigest(current) === writerLeaseDigest(expected)) {
      return leaseProjectionValues(expected, recoveryReceipt, "adopted");
    }
    requireSourceLease(current, sealed);
    assertLocalFrame(sealed, current, "source");
    cloud.verifyRecovered({ plan: sealed, authority: cloudValues.authority });
    const projected = casWriterLeaseProjection({
      leaseStore,
      branch,
      expectedLeaseDigest: sealed.evidence.sourceLeaseDigest,
      expectedClaimId: sealed.evidence.cloud.claim.claimId,
      requireNoActiveIntent: true,
      values: {
        cloudAuthority: cloudValues.authority,
        heartbeatAt: cloudValues.recoveredAt,
        expiresAt: cloudValues.expiresAt,
        plannedFenceOnlyAdmissionRecovery: recoveryReceipt,
      },
    }).lease;
    if (writerLeaseDigest(projected) !== writerLeaseDigest(expected)) {
      throw new Error("Writer-lease recovery CAS did not project exact target bytes.");
    }
    return leaseProjectionValues(projected, recoveryReceipt, "projected");
  }

  function projectReviewMarker(plan, { intent }) {
    const sealed = normalizePlannedFenceOnlyAdmissionRecoveryPlan(plan);
    const lease = expectedTargetLease(sealed, intent);
    requireTargetLease(leaseStore.read(branch), lease);
    requireBoundCapability(lease);
    assertLocalFrame(sealed, lease, "either");
    let review = readReview(lease);
    const source = sealed.evidence.review;
    assertRawReviewIdentity(review, source);
    const targetBody = updateWriterLeasePullRequestBody(source.body, lease);
    const targetMarker = projectWriterLeasePullRequestMarker(lease);
    const targetMarkerDigest = digestValue(targetMarker);
    let disposition = "adopted";
    let providerMutation = false;
    if (review.body === source.body) {
      if (visibleReviewBodyDigest(targetBody) !== source.visibleBodyDigest) {
        throw new Error("Review marker projection changed visible review content.");
      }
      disposition = "projected";
      providerMutation = true;
      try { gh(["pr", "edit", review.url, "--body", targetBody]); } catch {}
      review = readReview(lease);
    }
    assertRawReviewIdentity(review, source);
    if (review.body !== targetBody
      || digestValue(parseWriterLeasePullRequestBody(review.body)) !== targetMarkerDigest) {
      throw new Error("Review marker projection did not converge to the recovered lease.");
    }
    return Object.freeze({
      bodyDigest: digestValue(review.body),
      visibleBodyDigest: source.visibleBodyDigest,
      markerDigest: targetMarkerDigest,
      disposition,
      providerMutation,
    });
  }

  function verifyTerminal(plan, { intent }) {
    const sealed = normalizePlannedFenceOnlyAdmissionRecoveryPlan(plan);
    const expected = expectedTargetLease(sealed, intent);
    const current = requireTargetLease(leaseStore.read(branch), expected);
    requireBoundCapability(current);
    assertLocalFrame(sealed, current, "target");
    const review = readReview(current);
    assertRawReviewIdentity(review, sealed.evidence.review);
    const targetBody = updateWriterLeasePullRequestBody(sealed.evidence.review.body, current);
    const markerDigest = digestValue(projectWriterLeasePullRequestMarker(current));
    if (review.body !== targetBody
      || digestValue(parseWriterLeasePullRequestBody(review.body)) !== markerDigest) {
      throw new Error("Terminal review marker drifted from the recovered lease.");
    }
    const verified = cloud.verifyRecovered({ plan: sealed, authority: current.cloudAuthority });
    const restored = intent.phases.local_projection_restored.values;
    const overlappingClaimIdsDigest = digestValue([]);
    const bodyDigest = digestValue(targetBody);
    const leaseDigest = writerLeaseDigest(current);
    const terminalTarget = {
      schema: "agentic-planned-fence-only-terminal-target/v1",
      planDigest: sealed.planDigest,
      bodyDigest,
      leaseDigest,
      localProjectionDigest: restored.restoredProjectionDigest,
      markerDigest,
      overlappingClaimIdsDigest,
      targetClaimDigest: verified.targetClaimDigest,
    };
    return Object.freeze({
      bodyDigest,
      cloudVerificationReceiptDigest: verified.verificationReceiptDigest,
      inventoryDigest: verified.inventoryDigest,
      leaseDigest,
      localProjectionDigest: restored.restoredProjectionDigest,
      markerDigest,
      overlappingClaimIdsDigest,
      targetClaimDigest: verified.targetClaimDigest,
      terminalTargetDigest: digestValue(terminalTarget),
    });
  }

  function captureSource() {
    const lease = requireSourceLease(leaseStore.read(branch));
    const frame = readFrame(lease);
    const cloudEvidence = cloud.inspectDormant({ sourceAuthority: lease.cloudAuthority,
      sourceLease: lease, manifest });
    const evidence = buildPlannedFenceOnlyAdmissionRecoveryEvidence({
      observedAt: now().toISOString(),
      repository: frame.repository,
      sourceLease: lease,
      manifest,
      fence: frame.fence,
      localProjection: frame.localProjection,
      canonical: frame.canonical,
      protectedMainAdvance: frame.protectedMainAdvance,
      review: frame.review,
      cloud: cloudEvidence,
    });
    return Object.freeze({ evidence, frame });
  }

  function taskProof(lease, plan) {
    if (!taskAuthorityFile) throw new Error("Recovery run requires --task-authority.");
    return authorizeTaskBoundLeaseMutation({ lease, capabilityPath: taskAuthorityFile,
      operation: plan.taskAuthorityOperation, now: now() });
  }

  function requireBoundCapability(lease) {
    if (!taskAuthorityFile) throw new Error("Recovery run requires --task-authority.");
    const binding = assertTaskAuthorityBinding({ binding: lease.taskAuthority, lease });
    assertCapabilityMatchesBinding(readTaskAuthorityCapability(taskAuthorityFile), binding);
    return binding;
  }

  function requireSourceLease(value, plan = null) {
    const expiresAt = Date.parse(value?.expiresAt);
    if (!value || value.schema !== WRITER_LEASE_SCHEMA || value.status !== "active"
      || value.sessionId !== sessionId || value.branch !== branch
      || value.worktreePath !== worktreePath || value.admission?.status !== "planned"
      || value.plannedFenceOnlyAdmissionRecovery
      || !Number.isFinite(expiresAt) || expiresAt > now().getTime()) {
      throw new Error("Recovery requires the exact expired active planned source lease.");
    }
    if (plan && writerLeaseDigest(value) !== plan.evidence.sourceLeaseDigest) {
      throw new Error("Recovery source lease changed from the sealed plan.");
    }
    return value;
  }

  function readFrame(lease, { requireAttached = false } = {}) {
    const worktreeRaw = git(repository, ["worktree", "list", "--porcelain", "-z"]);
    assertRegisteredWorktree({ cwd: repository, porcelain: worktreeRaw });
    const records = assertWorktreeRegistry({ porcelain: worktreeRaw });
    const canonicalMatches = records.filter(item => item.branch === "refs/heads/main");
    if (canonicalMatches.length !== 1
      || canonicalPath(canonicalMatches[0].path, "canonical worktree") !== repository) {
      throw new Error("Recovery requires the supplied clean canonical main worktree.");
    }
    const remoteFence = remoteHead(repository, `refs/heads/${branch}`);
    const parents = git(repository, ["rev-list", "--parents", "-n", "1", remoteFence]).split(/\s+/u);
    if (parents.length !== 2 || parents[0] !== remoteFence) throw new Error("Recovery fence must have one parent.");
    const changedPaths = git(repository, ["diff", "--name-only", lease.baseSha, remoteFence])
      .split(/\r?\n/u).filter(Boolean).sort();
    const branchReference = `refs/heads/${branch}`;
    const branchOwners = records.filter(item => item.branch === branchReference);
    const targetRecords = records.filter(item => path.resolve(item.path) === worktreePath);
    const localRefSha = optionalLocalRef(branchReference);
    const pathPresent = existsSync(worktreePath);
    const attached = localRefSha === remoteFence && branchOwners.length === 1
      && targetRecords.length === 1 && pathPresent
      && path.resolve(branchOwners[0].path) === worktreePath;
    if (requireAttached && !attached) throw new Error("Restored local projection is not attached.");
    if (!attached && (localRefSha !== null || branchOwners.length !== 0
      || targetRecords.length !== 0 || pathPresent)) {
      throw new Error("Local projection is neither exact attached nor safely externally lost.");
    }
    const status = attached ? git(worktreePath,
      ["status", "--porcelain=v1", "--untracked-files=all"]) : null;
    const worktreeHead = attached ? git(worktreePath, ["rev-parse", "HEAD"]) : null;
    const worktreeTree = attached ? git(worktreePath, ["rev-parse", "HEAD^{tree}"]) : null;
    if (attached && (status !== "" || worktreeHead !== remoteFence)) {
      throw new Error("Attached recovery projection must be clean at the remote fence.");
    }
    const canonicalStatus = git(repository, ["status", "--porcelain=v1", "--untracked-files=all"]);
    const canonicalHead = git(repository, ["rev-parse", "HEAD"]);
    const canonicalRemote = remoteHead(repository, "refs/heads/main");
    const advancePaths = [...new Set(git(repository,
      ["log", "--format=", "--name-only", `${lease.baseSha}..${canonicalHead}`])
      .split(/\r?\n/u).filter(Boolean))].sort();
    const reviewValue = readReview(lease);
    const marker = parseWriterLeasePullRequestBody(reviewValue.body);
    const repositoryId = requiredText(gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]),
      "repository identity");
    return {
      repository: { id: repositoryId, candidatePath: worktreePath, canonicalPath: repository },
      fence: {
        branch,
        headSha: remoteFence,
        treeSha: git(repository, ["rev-parse", `${remoteFence}^{tree}`]),
        parentSha: parents[1],
        baseTreeSha: git(repository, ["rev-parse", `${lease.baseSha}^{tree}`]),
        remoteHeadSha: remoteFence,
        changedPaths,
      },
      localProjection: {
        mode: attached ? "attached" : "externally-lost",
        mutationSet: attached ? [] : ["local-branch", "registered-worktree"],
        branch, targetPath: worktreePath, headSha: remoteFence, localRefSha,
        worktreeRegistered: attached, worktreePathPresent: pathPresent,
        worktreeHeadSha: worktreeHead, worktreeTreeSha: worktreeTree,
        worktreeClean: attached, statusDigest: attached ? digestValue(status) : null,
        branchOwnerCount: branchOwners.length, targetRecordCount: targetRecords.length,
        registrationDigest: digestValue(records.map(record => ({
          path: path.resolve(record.path), branch: record.branch || null, head: record.head || null,
        }))),
        targetObservationDigest: digestValue({ path: worktreePath, present: pathPresent,
          localRefSha, branchOwnerCount: branchOwners.length, targetRecordCount: targetRecords.length }),
      },
      canonical: {
        registered: true,
        clean: canonicalStatus === "",
        branch: "main",
        headSha: canonicalHead,
        treeSha: git(repository, ["rev-parse", "HEAD^{tree}"]),
        remoteHeadSha: canonicalRemote,
        statusDigest: digestValue(canonicalStatus),
      },
      protectedMainAdvance: {
        baseSha: lease.baseSha,
        baseTreeSha: git(repository, ["rev-parse", `${lease.baseSha}^{tree}`]),
        headSha: canonicalHead,
        headTreeSha: git(repository, ["rev-parse", "HEAD^{tree}"]),
        baseIsAncestor: ancestry(lease.baseSha, canonicalHead),
        commitCount: Number(git(repository, ["rev-list", "--count", `${lease.baseSha}..${canonicalHead}`])),
        changedPaths: advancePaths,
        changedWriteSet: advancePaths.map(candidate => `path:${candidate}`),
        disjointFromManifest: advancePaths.length === 0
          || !writeSetsOverlap(advancePaths.map(candidate => `path:${candidate}`),
            manifest.declaredWriteSet),
      },
      review: {
        adapterId: REVIEW_ADAPTER_ID,
        id: reviewValue.id,
        number: reviewValue.number,
        url: reviewValue.url,
        state: reviewValue.state,
        draft: reviewValue.isDraft,
        autoMergeAbsent: reviewValue.autoMergeRequest === null,
        headRepository: reviewValue.headRepository?.nameWithOwner,
        headBranch: reviewValue.headRefName,
        headSha: reviewValue.headRefOid,
        baseBranch: reviewValue.baseRefName,
        baseSha: reviewValue.baseRefOid,
        body: reviewValue.body,
        bodyDigest: digestValue(reviewValue.body),
        visibleBodyDigest: visibleReviewBodyDigest(reviewValue.body),
        markerDigest: digestValue(marker),
      },
    };
  }

  function readReview(lease) {
    return parseJson(gh(["pr", "view", lease.pullRequestUrl, "--json",
      "id,number,url,state,isDraft,autoMergeRequest,headRepository,headRefName,headRefOid,baseRefName,baseRefOid,body"]),
    "review projection");
  }
  function remoteHead(cwd, reference) {
    const output = git(cwd, ["ls-remote", "--heads", "origin", reference]).split(/\s+/u);
    if (output.length !== 2 || output[1] !== reference) throw new Error(`Remote ref ${reference} is ambiguous.`);
    return output[0];
  }
  function optionalLocalRef(reference) {
    try { return git(repository, ["rev-parse", "--verify", reference]); } catch { return null; }
  }
  function ancestry(baseSha, headSha) {
    try {
      git(repository, ["merge-base", "--is-ancestor", baseSha, headSha]);
      return true;
    } catch { return false; }
  }
  function localPhaseIdentity(plan, values) {
    const local = plan.evidence.localProjection;
    return Object.freeze({
      mode: local.mode,
      mutationSet: plan.localMutationSet,
      branch: local.branch,
      targetPath: local.targetPath,
      headSha: local.headSha,
      rollbackBoundary: "before-cloud-request-sealed",
      ...values,
    });
  }
  function restoreExternallyLostProjection(plan) {
    const local = plan.evidence.localProjection;
    const reference = `refs/heads/${branch}`;
    if (optionalLocalRef(reference) !== null || existsSync(worktreePath)) {
      throw new Error("Externally lost projection target is no longer absent.");
    }
    let branchCreated = false;
    try {
      git(repository, ["update-ref", reference, local.headSha, "0000000000000000000000000000000000000000"]);
      branchCreated = true;
      git(repository, ["worktree", "add", worktreePath, branch]);
    } catch (error) {
      if (existsSync(worktreePath)) {
        try { git(repository, ["worktree", "remove", worktreePath]); } catch {}
      }
      if (branchCreated) {
        try { git(repository, ["update-ref", "-d", reference, local.headSha]); } catch {}
      }
      throw error;
    }
  }
  function assertLocalFrame(plan, lease, markerState, sourceFrame = null) {
    const frame = sourceFrame || readFrame(lease, { requireAttached: true });
    const expected = plan.evidence;
    if (!plannedFenceOnlyFrameIdentityMatches(expected, frame)) {
      throw new Error("Recovery Git or review identity drifted from the sealed plan.");
    }
    assertProtectedMainReplay(expected, frame, ancestry, "local-frame-verification");
    if (frame.localProjection.mode !== "attached"
      || frame.localProjection.headSha !== expected.localProjection.headSha) {
      throw new Error("Recovery local projection is not restored at the sealed fence.");
    }
    const targetMarker = digestValue(projectWriterLeasePullRequestMarker(lease));
    const targetBody = updateWriterLeasePullRequestBody(expected.review.body, lease);
    const current = frame.review.markerDigest;
    if ((markerState === "source" && current !== expected.review.markerDigest)
      || (markerState === "target" && current !== targetMarker)
      || (markerState === "either" && ![expected.review.markerDigest, targetMarker].includes(current))) {
      throw new Error("Recovery review marker is outside its sealed source and target states.");
    }
    const allowedBodies = markerState === "source" ? [expected.review.body]
      : markerState === "target" ? [targetBody] : [expected.review.body, targetBody];
    if (!allowedBodies.includes(frame.review.body)) {
      throw new Error("Recovery review body is outside its sealed source and target states.");
    }
  }

  return Object.freeze({
    readPlanEvidence, assertSource, authorizeTask, prepareLocalProjection,
    restoreLocalProjection, sealCloudRequest, recoverCloud,
    projectLease, projectReviewMarker, verifyTerminal, branch, gitCommonDir: commonDirectory,
  });
}

export function projectPlannedFenceOnlyRecoveryLease({ sourceLease, recoveredAuthority,
  recoveryReceipt }) {
  return Object.freeze({
    ...sourceLease,
    cloudAuthority: recoveredAuthority,
    heartbeatAt: recoveryReceipt.recoveredAt,
    expiresAt: recoveredAuthority.expiresAt,
    plannedFenceOnlyAdmissionRecovery: recoveryReceipt,
  });
}

export function visibleReviewBodyDigest(body) {
  const source = String(body || "");
  const expression = new RegExp(`<!--\\s*${WRITER_LEASE_SCHEMA.replace("/", "\\/")}\\s+\\{.*?\\}\\s*-->`, "gs");
  const matches = source.match(expression) || [];
  if (matches.length !== 1) throw new Error("Review body must contain one hidden writer-lease marker.");
  return digestValue(source.replace(expression, `<!-- ${WRITER_LEASE_SCHEMA} [hidden] -->`));
}

function expectedTargetLease(plan, intent) {
  const cloudValues = intent.phases.cloud_recovered.values;
  const receipt = buildPlannedFenceOnlyLeaseRecoveryReceipt({
    plan,
    taskAuthorityReceiptDigest: intent.phases.task_authority_verified.values.taskAuthorityReceiptDigest,
    sealedTransportDigest: intent.phases.cloud_request_sealed.values.sealedTransportDigest,
    semanticOperationDigest: cloudValues.semanticOperationDigest,
    recoveredAuthority: cloudValues.authority,
    recoveredAt: cloudValues.recoveredAt,
    operationReceiptDigest: cloudValues.operationReceiptDigest,
    providerReceiptDigest: cloudValues.providerReceiptDigest,
    idempotencyKey: cloudValues.idempotencyKey,
  });
  return projectPlannedFenceOnlyRecoveryLease({ sourceLease: plan.evidence.sourceLease,
    recoveredAuthority: cloudValues.authority, recoveryReceipt: receipt });
}
function requireTargetLease(current, expected) { if (!current || writerLeaseDigest(current) !== writerLeaseDigest(expected)) throw new Error("Recovered writer lease drifted from its exact target projection."); return current; }
function leaseProjectionValues(lease, receipt, disposition) { return Object.freeze({ leaseDigest: writerLeaseDigest(lease), recoveryReceiptDigest: receipt.receiptDigest, heartbeatAt: lease.heartbeatAt, expiresAt: lease.expiresAt, disposition }); }
export function assertPlannedFenceOnlyRecoveryReplay({ sealed, current, isAncestor, stage }) {
  if (canonicalJson(stableEvidence(current)) !== canonicalJson(stableEvidence(sealed))) {
    throw new Error(`Planned fence-only recovery source drifted at ${stage}.`);
  }
  assertProtectedMainReplay(sealed, current, isAncestor, stage);
}
export function plannedFenceOnlyLocalProjectionMatches(expected, current) {
  if (expected.mode === "externally-lost" && current.mode === "attached"
    && current.headSha === expected.headSha) return true;
  const sealed = structuredClone(expected), observed = structuredClone(current);
  delete sealed.registrationDigest;
  delete observed.registrationDigest;
  return canonicalJson(sealed) === canonicalJson(observed);
}
export function plannedFenceOnlyFrameIdentityMatches(expected, current) {
  return canonicalJson(current.repository) === canonicalJson(expected.repository)
    && canonicalJson(stableFence(current.fence)) === canonicalJson(stableFence(expected.fence))
    && canonicalJson(stableReview(current.review))
      === canonicalJson(stableReview(expected.review));
}
function assertProtectedMainReplay(sealed, current, isAncestor, stage) {
  if (canonicalJson(current.canonical) === canonicalJson(sealed.canonical)
    && canonicalJson(current.protectedMainAdvance)
      === canonicalJson(sealed.protectedMainAdvance)) return;
  const canonical = current.canonical;
  const advance = current.protectedMainAdvance;
  const valid = canonical.registered === sealed.canonical.registered
    && canonical.clean === sealed.canonical.clean && canonical.branch === sealed.canonical.branch
    && canonical.statusDigest === sealed.canonical.statusDigest
    && canonical.headSha !== sealed.canonical.headSha && canonical.remoteHeadSha === canonical.headSha
    && advance.baseSha === sealed.protectedMainAdvance.baseSha
    && advance.baseTreeSha === sealed.protectedMainAdvance.baseTreeSha
    && advance.headSha === canonical.headSha && advance.headTreeSha === canonical.treeSha
    && advance.baseIsAncestor === true
    && advance.commitCount > sealed.protectedMainAdvance.commitCount
    && advance.disjointFromManifest === true
    && !writeSetsOverlap(advance.changedWriteSet, sealed.manifest.declaredWriteSet)
    && isAncestor(sealed.canonical.headSha, canonical.headSha);
  if (!valid) throw new Error(`Planned fence-only protected main drifted at ${stage}.`);
}
function stableEvidence(value) { const copy = structuredClone(value); delete copy.observedAt; delete copy.evidenceDigest; delete copy.localProjection; delete copy.localProjectionDigest; delete copy.canonical; delete copy.protectedMainAdvance; delete copy.cloud.ledgerRevision; delete copy.cloud.ledgerDigest; delete copy.cloud.inventoryDigest; return copy; }
function stableFence(value) { const copy = structuredClone(value); delete copy.changedPathsDigest; return copy; }
function stableReview(value) { const copy = structuredClone(value); delete copy.body; delete copy.bodyDigest; delete copy.markerDigest; return copy; }
function assertRawReviewIdentity(value, expected) { const projection = { adapterId: REVIEW_ADAPTER_ID, id: value.id, number: value.number, url: value.url, state: value.state, draft: value.isDraft, autoMergeAbsent: value.autoMergeRequest === null, headRepository: value.headRepository?.nameWithOwner, headBranch: value.headRefName, headSha: value.headRefOid, baseBranch: value.baseRefName, baseSha: value.baseRefOid, visibleBodyDigest: visibleReviewBodyDigest(value.body) }; if (canonicalJson(projection) !== canonicalJson(stableReview(expected))) throw new Error("Recovery review identity drifted from the sealed plan."); }
function externalPrivateFile(value, repository, label) { const target = canonicalPath(value, label); if (target === repository || target.startsWith(`${repository}${path.sep}`)) throw new Error(`${label} must remain outside the repository.`); const metadata = lstatSync(target); if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o600) throw new Error(`${label} must be a private regular file.`); return target; }
function canonicalPath(value, label) { if (!path.isAbsolute(String(value || ""))) throw new Error(`${label} must be absolute.`); return realpathSync(path.resolve(value)); }
function absolutePath(value, label) { if (!path.isAbsolute(String(value || ""))) throw new Error(`${label} must be absolute.`); return path.resolve(value); }
function parseJson(value, label) { try { return JSON.parse(String(value)); } catch { throw new Error(`${label} is invalid JSON.`); } }
function requiredText(value, label) { if (typeof value !== "string" || !value || value !== value.trim()) throw new Error(`${label} is required.`); return value; }
function defaultExecute(command, args, cwd) { return execFileSync(command, args, { cwd, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }); }
