// Responsibility: Join one exact dormant successor across Git, cloud, registry, and review ports.
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { canonicalJson, digestValue, writeSetsOverlap } from "./cloud-collaboration-primitives.mjs";
import { verifyProtectedMainRefreshChain } from "./protected-main-refresh-lib.mjs";
import { verifyAdmissionCloudAuthority } from "./scoped-lane-cloud-authority.mjs";
import { assertAdmissionMutationAuthority } from "./scoped-lane-admission-state.mjs";
import { normalizeDeclaredWriteScopeManifest } from "./scoped-lane-admission-lib.mjs";
import { assertCapabilityMatchesBinding, assertTaskAuthorityBinding }
  from "./task-bound-lane-authority-contract.mjs";
import { authorizeTaskBoundLeaseMutation, readTaskAuthorityCapability }
  from "./task-bound-lane-authority-store.mjs";
import { WRITER_LEASE_SCHEMA, createWriterLeaseStore, parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker, updateWriterLeasePullRequestBody } from "./writer-lease-lib.mjs";
import { casWriterLeaseProjection, withHeartbeatProjectionFence, writerLeaseDigest } from "./writer-lease-registry-cas.mjs";
import { ACTIVE_PUBLISH_SUCCESSOR_DORMANT_RECOVERY_TERMINAL_VERIFICATION_SCHEMA,
  buildActivePublishSuccessorDormantRecoveryLeaseRecoveryReceipt,
  normalizeActivePublishSuccessorDormantRecoveryPlan } from "./active-publish-successor-dormant-recovery-contract.mjs";
import { activePublishSuccessorDormantRecoveryDecisionSubject,
  buildActivePublishSuccessorDormantRecoveryEvidence } from "./active-publish-successor-dormant-recovery-evidence.mjs";
import { createActivePublishSuccessorDormantRecoveryCloudAdapter } from "./active-publish-successor-dormant-recovery-cloud-adapter.mjs";
const REVIEW_ADAPTER_ID = "github-cli-hidden-writer-marker/v1";
export function createActivePublishSuccessorDormantRecoveryRepositoryAdapter(
  options = {}, dependencies = {}) {
  const controllerRoot = canonical(options.repository, "controller repository");
  const worktreePath = canonical(options.worktreePath, "source worktree");
  const branch = required(options.branch, "source branch");
  const sessionId = required(options.sessionId, "source session");
  const pullRequestNumber = positive(options.pullRequestNumber, "pull request");
  const manifestFile = externalFile(options.manifestFile, controllerRoot, "manifest");
  const taskAuthorityFile = options.taskAuthorityFile
    ? externalFile(options.taskAuthorityFile, controllerRoot, "task authority") : null;
  const execute = dependencies.execute || defaultExecute;
  const git = dependencies.git || ((cwd, args) => execute(
    "git", ["-C", cwd, ...args], controllerRoot,
  ).trim());
  const gitRaw = dependencies.gitRaw || ((cwd, args) => execute(
    "git", ["-C", cwd, ...args], controllerRoot,
  ));
  const gh = dependencies.gh || (args => execute("gh", args, controllerRoot).trim());
  const now = dependencies.now || (() => new Date());
  const commonDirectory = realpathSync(path.resolve(
    controllerRoot,
    git(controllerRoot, ["rev-parse", "--git-common-dir"]),
  ));
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({
    gitCommonDir: commonDirectory,
    taskAuthorityPolicy: "projected",
  });
  const manifest = normalizeDeclaredWriteScopeManifest(JSON.parse(
    readFileSync(manifestFile, "utf8"),
  ));
  const cloud = dependencies.cloudAdapter
    || createActivePublishSuccessorDormantRecoveryCloudAdapter({
      environment: dependencies.environment || process.env,
      invokeCloudAction: dependencies.invokeCloud,
    });
  const verifyAdmission = dependencies.verifyAdmission || verifyAdmissionCloudAuthority;
  const assertMutationAuthority = dependencies.assertMutationAuthority
    || assertAdmissionMutationAuthority;
  function readPlanEvidence() {
    return captureSource().evidence;
  }
  function assertSource(plan, stage) {
    const sealed = normalizeActivePublishSuccessorDormantRecoveryPlan(plan);
    const current = captureSource().evidence;
    if (canonicalJson(activePublishSuccessorDormantRecoveryDecisionSubject(current))
      !== canonicalJson(activePublishSuccessorDormantRecoveryDecisionSubject(sealed.evidence))) {
      throw new Error(`Dormant successor source drifted at ${stage}.`);
    }
    return current;
  }
  function authorizeTask(plan) {
    const sealed = normalizeActivePublishSuccessorDormantRecoveryPlan(plan);
    const lease = requireSourceLease(leaseStore.read(branch), sealed);
    assertSource(sealed, "task-authority-verification");
    if (!taskAuthorityFile) throw new Error("Recovery run requires --task-authority.");
    return authorizeTaskBoundLeaseMutation({
      lease,
      capabilityPath: taskAuthorityFile,
      operation: `active-publish-successor-dormant-recovery:${sealed.planDigest}`,
      now: now(),
    });
  }
  function sealCloudRequest(plan) {
    const sealed = normalizeActivePublishSuccessorDormantRecoveryPlan(plan);
    requireBoundCapability(requireSourceLease(leaseStore.read(branch), sealed));
    assertSource(sealed, "cloud-request-seal");
    return cloud.sealRequest(sealed);
  }
  function recoverCloud(plan, { sealedRequest }) {
    const sealed = normalizeActivePublishSuccessorDormantRecoveryPlan(plan);
    requireBoundCapability(requireSourceLease(leaseStore.read(branch), sealed));
    assertSource(sealed, "before-cloud-recovery");
    return cloud.recover({ plan: sealed, sealedRequest });
  }
  function projectLease(plan, { intent }) {
    const sealed = normalizeActivePublishSuccessorDormantRecoveryPlan(plan);
    const receipt = buildActivePublishSuccessorDormantRecoveryLeaseRecoveryReceipt(intent);
    const recovery = intent.phases.cloud_recovered.values;
    const authority = recoveredAuthority(sealed, recovery);
    const expected = projectRecoveredLease({
      sourceLease: sealed.evidence.lease.sourceLease,
      authority,
      receipt,
    });
    const current = leaseStore.read(branch);
    if (current && writerLeaseDigest(current) === writerLeaseDigest(expected)) {
      return leaseProjectionValues(expected, receipt, "adopted", false);
    }
    requireSourceLease(current, sealed);
    requireBoundCapability(current);
    authorizeTaskBoundLeaseMutation({
      lease: current,
      capabilityPath: taskAuthorityFile,
      operation: `active-publish-successor-dormant-recovery:${sealed.planDigest}:registry`,
      now: now(),
    });
    requireSourceLease(leaseStore.read(branch), sealed);
    cloud.verifyRecovered({ plan: sealed, authority: recovery });
    const projected = casWriterLeaseProjection({
      leaseStore,
      branch,
      expectedLeaseDigest: sealed.evidence.lease.leaseDigest,
      expectedClaimId: sealed.evidence.cloud.claim.claimId,
      requireNoActiveIntent: true,
      values: {
        cloudAuthority: authority,
        heartbeatAt: receipt.recoveredAt,
        expiresAt: authority.expiresAt,
        activePublishSuccessorDormantRecovery: receipt,
      },
    }).lease;
    if (writerLeaseDigest(projected) !== writerLeaseDigest(expected)) {
      throw new Error("Dormant successor writer-lease CAS produced unexpected bytes.");
    }
    return leaseProjectionValues(projected, receipt, "projected", true);
  }
  function projectReviewMarker(plan, { intent }) {
    const sealed = normalizeActivePublishSuccessorDormantRecoveryPlan(plan);
    const expected = expectedTargetLease(sealed, intent);
    return withHeartbeatProjectionFence({ leaseStore, branch, expectedLeaseDigest:
      writerLeaseDigest(expected), expectedClaimId: expected.cloudAuthority.claimId,
      action: () => projectReviewMarkerLocked(sealed, expected) });
  }
  function projectReviewMarkerLocked(sealed, expected) {
    requireTargetLease(leaseStore.read(branch), expected);
    let review = readReview();
    assertReviewIdentity(review, sealed.evidence.review);
    const targetBody = updateWriterLeasePullRequestBody(review.body, expected);
    const targetMarker = projectWriterLeasePullRequestMarker(expected);
    const targetMarkerDigest = digestValue(targetMarker);
    let disposition = "adopted";
    let providerMutation = false;
    if (digestValue(review.body) === sealed.evidence.review.bodyDigest) {
      if (visibleBodyDigest(targetBody) !== sealed.evidence.review.visibleBodyDigest) {
        throw new Error("Hidden marker projection changed visible review content.");
      }
      disposition = "projected";
      providerMutation = true;
      try { gh(["pr", "edit", review.url, "--body", targetBody]); } catch {}
      review = readReview();
    }
    assertReviewIdentity(review, sealed.evidence.review);
    if (review.body !== targetBody
      || digestValue(parseWriterLeasePullRequestBody(review.body)) !== targetMarkerDigest) {
      throw new Error("Hidden review marker did not converge to the recovered lease.");
    }
    const core = {
      schema: "agentic-active-publish-successor-dormant-recovery-review-marker/v1",
      planDigest: sealed.planDigest,
      reviewId: sealed.evidence.review.id,
      sourceBodyDigest: sealed.evidence.review.bodyDigest,
      targetBodyDigest: digestValue(targetBody),
      visibleBodyDigest: sealed.evidence.review.visibleBodyDigest,
      markerDigest: targetMarkerDigest,
      disposition,
      providerMutation,
    };
    return Object.freeze({ ...core, receiptDigest: digestValue(core) });
  }
  function verifyTerminal(plan, { intent }) {
    const sealed = normalizeActivePublishSuccessorDormantRecoveryPlan(plan);
    const expected = expectedTargetLease(sealed, intent);
    const current = requireTargetLease(leaseStore.read(branch), expected);
    assertUnchangedRepository(sealed, current);
    const review = readReview();
    assertReviewIdentity(review, sealed.evidence.review);
    const targetBody = updateWriterLeasePullRequestBody(review.body, current);
    if (review.body !== targetBody) throw new Error("Terminal hidden marker drifted.");
    const cloudVerification = cloud.verifyRecovered({
      plan: sealed,
      authority: intent.phases.cloud_recovered.values,
    });
    const remoteVerification = verifyAdmission({ authority: current.cloudAuthority,
      manifest, canonicalBaseSha: current.baseSha,
      environment: dependencies.environment || process.env });
    const observedMutationAuthority = assertMutationAuthority({ lease: current,
      cloudAuthority: current.cloudAuthority, remoteAuthorityVerification: remoteVerification,
      evaluatedAt: intent.phases.verified?.values?.mutationAuthority?.evaluatedAt });
    const mutationAuthority = intent.phases.verified?.values?.mutationAuthority
      || observedMutationAuthority;
    if (mutationAuthority.claimId !== observedMutationAuthority.claimId
      || mutationAuthority.claimDigest !== observedMutationAuthority.claimDigest
      || mutationAuthority.localFenceSha !== observedMutationAuthority.localFenceSha
      || mutationAuthority.expiresAt !== observedMutationAuthority.expiresAt) {
      throw new Error("Terminal mutation authority drifted.");
    }
    const leaseValues = intent.phases.lease_projected.values;
    const markerValues = intent.phases.review_marker_projected.values;
    const core = {
      schema: ACTIVE_PUBLISH_SUCCESSOR_DORMANT_RECOVERY_TERMINAL_VERIFICATION_SCHEMA,
      planDigest: sealed.planDigest,
      claimId: sealed.evidence.cloud.claim.claimId,
      sourceLeaseDigest: sealed.evidence.lease.leaseDigest,
      projectedLeaseDigest: writerLeaseDigest(current),
      leaseProjectionReceiptDigest: leaseValues.recoveryReceiptDigest,
      reviewMarkerReceiptDigest: markerValues.receiptDigest,
      cloudVerificationReceiptDigest: cloudVerification.resultDigest,
      mutationAuthority,
      mutationAuthorityReceiptDigest: mutationAuthority.receiptDigest,
      verifiedAt: intent.phases.verified?.values?.verifiedAt || now().toISOString(),
      gitMutation: false,
      sourceMutation: false,
      newClaim: false,
      newPullRequest: false,
    };
    return Object.freeze({ ...core, verificationDigest: digestValue(core) });
  }
  function captureSource() {
    const lease = requireSourceLease(leaseStore.read(branch));
    const frame = readFrame(lease);
    const cloudEvidence = cloud.inspectDormant({
      authority: lease.cloudAuthority,
      sourceLease: lease,
      declaredWriteSet: manifest.declaredWriteSet,
      ledgerRepository: lease.cloudAuthority.ledgerRepository,
      targetRepository: lease.cloudAuthority.targetRepository,
    });
    const evidence = buildActivePublishSuccessorDormantRecoveryEvidence({
      observedAt: now().toISOString(),
      controller: frame.controller,
      canonicalAdvance: frame.canonicalAdvance,
      lane: frame.lane,
      lease: leaseEvidence(lease),
      review: frame.review,
      successorReceipt: reconciliationReceipt(lease),
      cloud: cloudEvidence,
    });
    return Object.freeze({ evidence, lease, frame });
  }
  function readFrame(lease) {
    const records = parseWorktrees(gitRaw(controllerRoot, [
      "worktree", "list", "--porcelain", "-z",
    ]));
    const source = records.filter(record => path.resolve(record.path) === worktreePath);
    if (source.length !== 1 || source[0].branch !== `refs/heads/${branch}`) {
      throw new Error("Dormant successor source worktree is not exact-registered.");
    }
    const status = gitRaw(worktreePath, ["status", "--porcelain=v2", "-z", "--untracked-files=all"]);
    const controllerStatus = gitRaw(controllerRoot, [
      "status", "--porcelain=v2", "-z", "--untracked-files=all",
    ]);
    const headSha = git(worktreePath, ["rev-parse", "HEAD"]);
    const remoteHeadSha = remoteHead(branch);
    const controllerHead = git(controllerRoot, ["rev-parse", "HEAD"]);
    const originMain = git(controllerRoot, ["rev-parse", "origin/main"]);
    const remoteMain = remoteHead("main");
    if (status || controllerStatus || headSha !== lease.fenceSha || remoteHeadSha !== headSha
      || controllerHead !== originMain || controllerHead !== remoteMain
      || git(controllerRoot, ["branch", "--show-current"]) !== "main") {
      throw new Error("Dormant successor Git/controller frame is not clean and exact.");
    }
    const integrationHead = required(lease.integration?.commitSha, "integration commit");
    const refresh = verifyProtectedMainRefreshChain({
      expectedHeadSha: integrationHead,
      observedHeadSha: headSha,
      gitText: args => git(worktreePath, args),
      mainRef: "origin/main",
    });
    const refreshes = refresh?.refreshes || (refresh ? [{ previousHeadSha: refresh.deliveredHeadSha,
      refreshedHeadSha: refresh.refreshedHeadSha, mainParentSha: refresh.mainParentSha }] : []);
    if (!refresh || refreshes.at(-1)?.mainParentSha !== lease.baseSha) {
      throw new Error("Dormant successor fence is not its exact active-publish refresh.");
    }
    git(controllerRoot, ["merge-base", "--is-ancestor", lease.baseSha, controllerHead]);
    const changedPaths = nulPaths(gitRaw(controllerRoot, [
      "--no-replace-objects", "diff", "--no-ext-diff", "--no-renames",
      "--name-only", "-z", lease.baseSha, controllerHead, "--",
    ]));
    if (writeSetsOverlap(changedPaths.map(item => `path:${item}`), manifest.declaredWriteSet)) {
      throw new Error("Protected-main advance overlaps the dormant successor scope.");
    }
    const reviewValue = readReview();
    const review = reviewEvidence(reviewValue);
    assertSourceMarker(reviewValue.body, review, lease);
    return {
      controller: {
        repository: repositoryId(),
        headSha: controllerHead,
        treeSha: git(controllerRoot, ["rev-parse", "HEAD^{tree}"]),
        originMainSha: originMain,
        remoteMainSha: remoteMain,
        clean: true,
        implementationDigest: implementationDigest(controllerHead),
      },
      canonicalAdvance: {
        protectedBaseSha: lease.baseSha,
        deliveredHeadSha: integrationHead,
        refreshedFenceSha: headSha,
        protectedMainSha: controllerHead,
        refreshes,
        protectedRefreshReceiptDigest: digestValue(refresh),
        protectedMainDescendant: true,
        changedPaths,
        changedPathsDigest: digestValue(changedPaths),
        noWriteSetOverlap: true,
      },
      lane: {
        repository: repositoryId(),
        worktreePath,
        branch,
        headSha,
        treeSha: git(worktreePath, ["rev-parse", "HEAD^{tree}"]),
        remoteHeadSha,
        statusDigest: digestValue(status),
        registered: true,
        clean: true,
      },
      review,
    };
  }
  function requireSourceLease(value, plan = null) {
    if (!value || value.schema !== WRITER_LEASE_SCHEMA || value.status !== "active"
      || value.admission?.status !== "admitted" || value.branch !== branch
      || value.sessionId !== sessionId || path.resolve(value.worktreePath || "") !== worktreePath
      || value.pullRequestUrl?.split("/").at(-1) !== String(pullRequestNumber)
      || !value.cloudAuthority || !value.taskAuthority
      || !value.activePublishTaskAuthoritySuccessor
      || value.activePublishSuccessorDormantRecovery
      || Date.parse(value.expiresAt) > now().getTime()) {
      throw new Error("Recovery requires the exact expired admitted active-publish successor lease.");
    }
    if (plan && writerLeaseDigest(value) !== plan.evidence.lease.leaseDigest) {
      throw new Error("Dormant successor source lease changed from the plan.");
    }
    return value;
  }
  function requireBoundCapability(lease) {
    if (!taskAuthorityFile) throw new Error("Recovery run requires --task-authority.");
    const binding = assertTaskAuthorityBinding({ binding: lease.taskAuthority, lease });
    assertCapabilityMatchesBinding(readTaskAuthorityCapability(taskAuthorityFile), binding);
    return binding;
  }
  function readReview() {
    return JSON.parse(gh(["pr", "view", String(pullRequestNumber), "--repo", repositoryId(),
      "--json", "id,number,url,state,isDraft,autoMergeRequest,headRepository,headRefName,headRefOid,baseRefName,baseRefOid,body"]));
  }
  function reviewEvidence(value) {
    return {
      adapterId: REVIEW_ADAPTER_ID,
      id: value.id,
      url: value.url,
      state: String(value.state).toLowerCase(),
      draft: value.isDraft,
      autoDeliveryAbsent: value.autoMergeRequest === null,
      headRepository: value.headRepository?.nameWithOwner,
      headBranch: value.headRefName,
      headSha: value.headRefOid,
      baseBranch: value.baseRefName,
      baseSha: value.baseRefOid,
      markerDigest: digestValue(parseWriterLeasePullRequestBody(value.body)),
      bodyDigest: digestValue(value.body),
      visibleBodyDigest: visibleBodyDigest(value.body),
    };
  }
  function assertReviewIdentity(value, evidence) {
    const projected = reviewEvidence(value);
    for (const key of ["adapterId", "id", "url", "state", "draft", "autoDeliveryAbsent",
      "headRepository", "headBranch", "headSha", "baseBranch", "baseSha",
      "visibleBodyDigest"]) {
      if (projected[key] !== evidence[key]) throw new Error("Dormant successor review identity drifted.");
    }
  }

  function assertSourceMarker(body, review, lease) {
    const marker = parseWriterLeasePullRequestBody(body);
    const successor = lease.activePublishTaskAuthoritySuccessor;
    if (marker.branch !== branch || marker.fenceSha !== successor.sourceFenceSha
      || marker.baseSha !== successor.sourceBaseSha
      || marker.cloudAuthority?.claimId !== successor.sourceClaimId
      || marker.taskAuthority?.bindingDigest !== successor.sourceBindingDigest) {
      throw new Error("Dormant successor source marker does not join its predecessor receipt.");
    }
    if (review.markerDigest !== digestValue(marker)) throw new Error("Source marker digest drifted.");
  }

  function reconciliationReceipt(lease) {
    const directory = path.join(commonDirectory, "agentic-canvas-os",
      "active-publish-task-authority-successor-reconciliation");
    const matches = readdirSync(directory).filter(name => name.endsWith(".json")).map(name => {
      const value = JSON.parse(readFileSync(path.join(directory, name), "utf8"));
      return value.phase === "complete" && value.completion?.targetLeaseDigest === writerLeaseDigest(lease)
        && value.completion?.successorReceiptDigest
          === lease.activePublishTaskAuthoritySuccessor.receiptDigest
        ? value.completion : null;
    }).filter(Boolean);
    if (matches.length !== 1) throw new Error("Exact successor reconciliation receipt is unavailable.");
    return matches[0];
  }

  function leaseEvidence(lease) {
    return {
      sourceLease: lease,
      leaseDigest: writerLeaseDigest(lease),
      status: lease.status,
      admissionStatus: lease.admission.status,
      sessionId: lease.sessionId,
      device: lease.device,
      scope: lease.scope,
      branch: lease.branch,
      epoch: lease.epoch,
      baseSha: lease.baseSha,
      fenceSha: lease.fenceSha,
      integrationCommitSha: lease.integration.commitSha,
      pullRequestUrl: lease.pullRequestUrl,
      manifestDigest: lease.admission.manifestDigest,
      writeSetDigest: lease.admission.writeSetDigest,
      declaredWriteSet: lease.admission.declaredWriteSet,
      taskAuthorityBindingDigest: lease.taskAuthority.bindingDigest,
      cloudAuthorityDigest: digestValue(lease.cloudAuthority),
      cloudClaimId: lease.cloudAuthority.claimId,
      cloudClaimDigest: lease.cloudAuthority.claimDigest,
      cloudTransitionCounter: lease.cloudAuthority.transitionCounter,
      cloudOperationReceiptDigest: lease.cloudAuthority.operationReceiptDigest,
      activePublishTaskAuthoritySuccessor: lease.activePublishTaskAuthoritySuccessor,
    };
  }

  function recoveredAuthority(plan, recovery) {
    if (recovery.authority) return recovery.authority;
    const source = plan.evidence.lease.sourceLease.cloudAuthority;
    const claim = recovery.claim;
    return Object.freeze({
      ...source,
      claimDigest: claim.fenceRevision,
      ledgerRevision: recovery.ledgerRevision,
      ledgerDigest: recovery.ledgerDigest,
      claimLedgerRevision: claim.transitionDigest,
      operationReceiptDigest: recovery.operationReceiptDigest,
      transitionCounter: claim.transitionCounter,
      heartbeatCounter: claim.heartbeatCounter,
      state: "active",
      expiresAt: claim.expiresAt,
    });
  }

  function expectedTargetLease(plan, intent) {
    const receipt = buildActivePublishSuccessorDormantRecoveryLeaseRecoveryReceipt(intent);
    return projectRecoveredLease({
      sourceLease: plan.evidence.lease.sourceLease,
      authority: recoveredAuthority(plan, intent.phases.cloud_recovered.values),
      receipt,
    });
  }

  function assertUnchangedRepository(plan) {
    const sourceStatus = gitRaw(worktreePath, [
      "status", "--porcelain=v2", "-z", "--untracked-files=all",
    ]);
    const controllerStatus = gitRaw(controllerRoot, [
      "status", "--porcelain=v2", "-z", "--untracked-files=all",
    ]);
    const sourceHead = git(worktreePath, ["rev-parse", "HEAD"]);
    const controllerHead = git(controllerRoot, ["rev-parse", "HEAD"]);
    if (sourceStatus || controllerStatus || sourceHead !== plan.evidence.lane.headSha
      || remoteHead(branch) !== sourceHead
      || controllerHead !== plan.evidence.controller.headSha
      || git(controllerRoot, ["rev-parse", "origin/main"]) !== controllerHead
      || remoteHead("main") !== controllerHead
      || implementationDigest(controllerHead) !== plan.evidence.controller.implementationDigest) {
      throw new Error("Terminal repository projection drifted.");
    }
  }

  function repositoryId() {
    return required(gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]),
      "repository identity");
  }
  function remoteHead(name) {
    const reference = `refs/heads/${name}`;
    const fields = git(controllerRoot, ["ls-remote", "--heads", "origin", reference]).split(/\s+/u);
    if (fields.length !== 2 || fields[1] !== reference) throw new Error(`Remote ${name} is ambiguous.`);
    return fields[0];
  }
  function implementationDigest(head) {
    const files = manifest.declaredWriteSet
      .filter(item => item.startsWith("path:")).map(item => item.slice(5));
    return digestValue(files.map(file => ({
      file,
      blob: git(controllerRoot, ["rev-parse", `${head}:${file}`]),
    })));
  }

  return Object.freeze({
    readPlanEvidence,
    assertSource,
    authorizeTask,
    sealCloudRequest,
    recoverCloud,
    projectLease,
    projectReviewMarker,
    verifyTerminal,
    branch,
    gitCommonDir: commonDirectory,
  });
}

export function projectRecoveredLease({ sourceLease, authority, receipt }) {
  return Object.freeze({
    ...sourceLease,
    cloudAuthority: authority,
    heartbeatAt: receipt.recoveredAt,
    expiresAt: authority.expiresAt,
    activePublishSuccessorDormantRecovery: receipt,
  });
}

export function visibleBodyDigest(body) {
  const expression = new RegExp(
    `<!--\\s*${WRITER_LEASE_SCHEMA.replace("/", "\\/")}\\s+\\{.*?\\}\\s*-->`,
    "gs",
  );
  const matches = String(body).match(expression) || [];
  if (matches.length !== 1) throw new Error("Review body must contain one hidden writer marker.");
  return digestValue(String(body).replace(expression, `<!-- ${WRITER_LEASE_SCHEMA} [hidden] -->`));
}

function leaseProjectionValues(lease, receipt, disposition, writerRegistryMutation) {
  return Object.freeze({ projectedLeaseDigest: writerLeaseDigest(lease),
    recoveryReceiptDigest: receipt.receiptDigest, disposition, writerRegistryMutation });
}
function requireTargetLease(current, expected) {
  if (!current || writerLeaseDigest(current) !== writerLeaseDigest(expected)) {
    throw new Error("Recovered writer lease drifted from its deterministic target.");
  }
  return current;
}
function parseWorktrees(value) {
  const fields = String(value).split("\0");
  if (fields.at(-1) === "") fields.pop();
  const records = [];
  let current = null;
  for (const field of fields) {
    if (field.startsWith("worktree ")) {
      current = { path: field.slice(9), branch: null, head: null };
      records.push(current);
    } else if (current && field.startsWith("branch ")) current.branch = field.slice(7);
    else if (current && field.startsWith("HEAD ")) current.head = field.slice(5);
  }
  return records;
}
function nulPaths(value) {
  const values = String(value).split("\0");
  if (values.at(-1) === "") values.pop();
  if (values.some(item => !item)) throw new Error("Changed-path output is invalid.");
  return values.sort();
}
function externalFile(value, repository, label) {
  const file = canonical(value, label);
  if (file === repository || file.startsWith(`${repository}${path.sep}`)) {
    throw new Error(`${label} must remain outside the repository.`);
  }
  const metadata = lstatSync(file);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`${label} is invalid.`);
  return file;
}
function canonical(value, label) {
  if (!path.isAbsolute(String(value || ""))) throw new Error(`${label} must be absolute.`);
  return realpathSync(path.resolve(value));
}
function required(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value;
}
function positive(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${label} is invalid.`);
  return number;
}
function defaultExecute(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
