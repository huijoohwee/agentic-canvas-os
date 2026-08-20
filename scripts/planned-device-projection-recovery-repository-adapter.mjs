// Responsibility: Join exact Git, review, cloud, task proof, and lease CAS recovery ports.
import { execFileSync } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

import { canonicalJson, digestValue, normalizeWriteSet }
  from "./cloud-collaboration-primitives.mjs";
import { buildPlannedDeviceProjectionRecoveryEvidence }
  from "./planned-device-projection-recovery-evidence.mjs";
import { createPlannedDeviceProjectionRecoveryCloudAdapter }
  from "./planned-device-projection-recovery-cloud-adapter.mjs";
import { normalizePlannedDeviceProjectionRecoveryPlan }
  from "./planned-device-projection-recovery-contract.mjs";
import { authorizeTaskBoundLeaseMutation }
  from "./task-bound-lane-authority-store.mjs";
import {
  createWriterLeaseStore,
  parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker,
  updateWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";
import { casWriterLeaseProjection, writerLeaseDigest }
  from "./writer-lease-registry-cas.mjs";
import { visibleReviewBodyDigest }
  from "./planned-fence-only-admission-recovery-repository-adapter.mjs";

export function createPlannedDeviceProjectionRecoveryRepositoryAdapter(
  options = {},
  dependencies = {},
) {
  const repository = canonicalPath(options.repository, "canonical repository");
  const worktreePath = canonicalPath(options.worktreePath, "target worktree");
  const branch = text(options.branch, "branch");
  const sessionId = text(options.sessionId, "session");
  const taskAuthorityFile = options.taskAuthorityFile
    ? privateExternalFile(options.taskAuthorityFile, [repository, worktreePath], "task authority")
    : null;
  const execute = dependencies.execute || defaultExecute;
  const git = dependencies.git
    || ((cwd, argumentsList) => execute("git", ["-C", cwd, ...argumentsList], repository).trim());
  const gh = dependencies.gh || (argumentsList => execute("gh", argumentsList, repository).trim());
  const now = dependencies.now || (() => new Date());
  const commonDirectory = realpathSync(path.resolve(
    repository,
    git(repository, ["rev-parse", "--git-common-dir"]),
  ));
  const leaseStore = dependencies.leaseStore
    || createWriterLeaseStore({ gitCommonDir: commonDirectory });
  const cloud = dependencies.cloudAdapter
    || createPlannedDeviceProjectionRecoveryCloudAdapter({
      environment: dependencies.environment || process.env,
      inspect: dependencies.inspectCloud,
      invoke: dependencies.invokeCloud,
      verify: dependencies.verifyCloud,
    });

  function readPlanEvidence() {
    const lease = requireSourceLease(leaseStore.read(branch));
    const manifest = manifestFromLease(lease);
    const frame = readFrame(lease);
    const cloudEvidence = cloud.inspectDormant({
      sourceAuthority: lease.cloudAuthority,
      sourceLease: lease,
      manifest,
    });
    return buildPlannedDeviceProjectionRecoveryEvidence({
      observedAt: now().toISOString(),
      sourceLease: lease,
      manifest,
      repository: frame.repository,
      review: frame.review,
      claim: cloudEvidence.claim,
      inventoryDigest: cloudEvidence.inventoryDigest,
    });
  }

  function authorizeTask(plan) {
    const sealed = normalizePlannedDeviceProjectionRecoveryPlan(plan);
    const lease = requireSourceOrProjectedLease(leaseStore.read(branch), sealed);
    if (!taskAuthorityFile) throw new Error("Recovery run requires --task-authority.");
    const receipt = authorizeTaskBoundLeaseMutation({
      lease,
      capabilityPath: taskAuthorityFile,
      operation: sealed.taskAuthorityOperation,
      now: now(),
    });
    return receipt.receiptDigest;
  }

  function recoverCloud(plan) {
    assertStableFrame(plan, "before cloud recovery");
    return cloud.recover(plan);
  }

  function projectLease(plan, recovery) {
    const sealed = normalizePlannedDeviceProjectionRecoveryPlan(plan);
    const expected = targetLease(sealed, recovery);
    const current = leaseStore.read(branch);
    if (writerLeaseDigest(current) === writerLeaseDigest(expected)) {
      return Object.freeze({ lease: current, disposition: "adopted" });
    }
    requireSourceLease(current, sealed);
    const projected = casWriterLeaseProjection({
      leaseStore,
      branch,
      expectedLeaseDigest: sealed.evidence.sourceLeaseDigest,
      expectedClaimId: sealed.evidence.sourceLease.cloudAuthority.claimId,
      requireNoActiveIntent: true,
      values: {
        cloudAuthority: recovery.authority,
        heartbeatAt: recovery.recoveredAt,
        expiresAt: recovery.authority.expiresAt,
      },
    }).lease;
    if (writerLeaseDigest(projected) !== writerLeaseDigest(expected)) {
      throw new Error("Device-projection recovery lease CAS did not converge.");
    }
    return Object.freeze({ lease: projected, disposition: "projected" });
  }

  function projectReview(plan, lease) {
    const sealed = normalizePlannedDeviceProjectionRecoveryPlan(plan);
    const source = sealed.evidence.review;
    const targetBody = updateWriterLeasePullRequestBody(source.body, lease);
    if (visibleReviewBodyDigest(targetBody) !== visibleReviewBodyDigest(source.body)) {
      throw new Error("Device-projection recovery changed visible review content.");
    }
    let review = readReview(lease.pullRequestUrl);
    assertReviewIdentity(review, source);
    let disposition = "adopted";
    if (review.body === source.body) {
      gh(["pr", "edit", review.url, "--body", targetBody]);
      disposition = "projected";
      review = readReview(lease.pullRequestUrl);
    }
    assertReviewIdentity(review, source);
    if (review.body !== targetBody
      || digestValue(parseWriterLeasePullRequestBody(review.body))
        !== digestValue(projectWriterLeasePullRequestMarker(lease))) {
      throw new Error("Device-projection recovery review marker did not converge.");
    }
    return Object.freeze({
      disposition,
      bodyDigest: digestValue(review.body),
    });
  }

  function verifyTerminal(plan, recovery, taskAuthorityReceiptDigest, dispositions) {
    const sealed = normalizePlannedDeviceProjectionRecoveryPlan(plan);
    const expected = targetLease(sealed, recovery);
    const lease = leaseStore.read(branch);
    if (writerLeaseDigest(lease) !== writerLeaseDigest(expected)) {
      throw new Error("Terminal writer lease differs from its authorized target.");
    }
    const frame = readFrame(lease);
    const targetBody = updateWriterLeasePullRequestBody(sealed.evidence.review.body, lease);
    if (frame.review.body !== targetBody
      || frame.review.markerDigest !== digestValue(projectWriterLeasePullRequestMarker(lease))) {
      throw new Error("Terminal draft review marker differs from the recovered writer lease.");
    }
    const verified = cloud.verifyRecovered(sealed, recovery.authority);
    return Object.freeze({
      taskAuthorityReceiptDigest,
      recoveredAuthority: verified.authority,
      sourceLeaseDigest: sealed.evidence.sourceLeaseDigest,
      targetLeaseDigest: writerLeaseDigest(lease),
      sourceBodyDigest: sealed.evidence.review.bodyDigest,
      targetBodyDigest: digestValue(targetBody),
      cloudVerificationReceiptDigest: verified.verificationReceiptDigest,
      disposition: [recovery.disposition, ...dispositions].includes("projected")
        ? "projected" : "adopted",
      completedAt: now().toISOString(),
    });
  }

  function assertStableFrame(plan, stage) {
    const sealed = normalizePlannedDeviceProjectionRecoveryPlan(plan);
    const current = requireSourceOrProjectedLease(leaseStore.read(branch), sealed);
    const frame = readFrame(current);
    if (canonicalJson(frame.repository) !== canonicalJson(sealed.evidence.repository)) {
      throw new Error(`Device-projection recovery Git identity drifted ${stage}.`);
    }
    assertReviewIdentity(readReview(current.pullRequestUrl), sealed.evidence.review);
  }

  function readFrame(lease) {
    const canonicalHeadSha = git(repository, ["rev-parse", "HEAD"]);
    const canonicalRemoteSha = remoteHead("refs/heads/main");
    const headSha = git(worktreePath, ["rev-parse", "HEAD"]);
    const remoteHeadSha = remoteHead(`refs/heads/${branch}`);
    const reviewValue = readReview(lease.pullRequestUrl);
    const marker = parseWriterLeasePullRequestBody(reviewValue.body);
    return {
      repository: {
        canonicalPath: repository,
        worktreePath,
        targetRepository: lease.cloudAuthority.targetRepository,
        branch,
        baseSha: lease.baseSha,
        fenceSha: lease.fenceSha,
        fenceTreeSha: git(worktreePath, ["rev-parse", `${lease.fenceSha}^{tree}`]),
        baseTreeSha: git(repository, ["rev-parse", `${lease.baseSha}^{tree}`]),
        headSha,
        remoteHeadSha,
        clean: git(worktreePath, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]) === "",
        canonicalHeadSha,
        canonicalRemoteSha,
        canonicalClean: git(repository, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]) === "",
      },
      review: {
        id: reviewValue.id,
        number: reviewValue.number,
        url: reviewValue.url,
        state: reviewValue.state,
        isDraft: reviewValue.isDraft,
        autoMergeAbsent: reviewValue.autoMergeRequest === null,
        headRepository: reviewValue.headRepository?.nameWithOwner,
        headBranch: reviewValue.headRefName,
        headSha: reviewValue.headRefOid,
        baseBranch: reviewValue.baseRefName,
        body: reviewValue.body,
        bodyDigest: digestValue(reviewValue.body),
        markerDigest: digestValue(marker),
      },
    };
  }

  function readReview(reference) {
    return JSON.parse(gh(["pr", "view", reference, "--json",
      "id,number,url,state,isDraft,autoMergeRequest,headRepository,headRefName,headRefOid,baseRefName,body"]));
  }
  function remoteHead(reference) {
    const rows = git(repository, ["ls-remote", "--heads", "origin", reference])
      .split(/\r?\n/u).filter(Boolean);
    if (rows.length !== 1) throw new Error(`Remote ref ${reference} is ambiguous.`);
    return rows[0].split(/\s+/u)[0];
  }

  return Object.freeze({
    readPlanEvidence,
    authorizeTask,
    recoverCloud,
    projectLease,
    projectReview,
    verifyTerminal,
  });

  function requireSourceLease(value, plan = null) {
    if (!value || value.schema !== "agentic-writer-lease/v2" || value.status !== "active"
      || value.admission?.status !== "planned" || value.branch !== branch
      || value.worktreePath !== worktreePath || value.sessionId !== sessionId
      || Date.parse(value.expiresAt) > now().getTime()) {
      throw new Error("Recovery requires the exact expired active planned source lease.");
    }
    if (plan && writerLeaseDigest(value) !== plan.evidence.sourceLeaseDigest) {
      throw new Error("Recovery source lease changed from the authorized plan.");
    }
    return value;
  }
}

function requireSourceOrProjectedLease(value, plan) {
  const source = plan.evidence.sourceLease;
  if (writerLeaseDigest(value) === plan.evidence.sourceLeaseDigest) return value;
  const authority = value?.cloudAuthority;
  if (!value || value.branch !== source.branch || value.sessionId !== source.sessionId
    || value.fenceSha !== source.fenceSha || value.taskAuthority?.bindingDigest
      !== source.taskAuthority.bindingDigest
    || authority?.claimId !== source.cloudAuthority.claimId
    || authority?.transitionCounter !== plan.evidence.cloud.claim.transitionCounter + 1
    || authority?.deviceId !== plan.evidence.cloud.expectedDeviceId
    || authority?.sessionId !== plan.evidence.cloud.expectedSessionId) {
    throw new Error("Recovery lease is outside its authorized source and target projections.");
  }
  return value;
}

function targetLease(plan, recovery) {
  return Object.freeze({
    ...plan.evidence.sourceLease,
    cloudAuthority: recovery.authority,
    heartbeatAt: recovery.recoveredAt,
    expiresAt: recovery.authority.expiresAt,
  });
}

function manifestFromLease(lease) {
  return Object.freeze({
    declaredWriteSet: normalizeWriteSet(lease.admission.declaredWriteSet),
    writeSetDigest: lease.admission.writeSetDigest,
    manifestDigest: lease.admission.manifestDigest,
  });
}

function assertReviewIdentity(review, expected) {
  const projection = {
    id: review.id,
    number: review.number,
    url: review.url,
    state: review.state,
    isDraft: review.isDraft,
    autoMergeAbsent: review.autoMergeRequest === null,
    headRepository: review.headRepository?.nameWithOwner,
    headBranch: review.headRefName,
    headSha: review.headRefOid,
    baseBranch: review.baseRefName,
  };
  const sealed = {
    id: expected.id,
    number: expected.number,
    url: expected.url,
    state: expected.state,
    isDraft: expected.isDraft,
    autoMergeAbsent: expected.autoMergeAbsent,
    headRepository: expected.headRepository,
    headBranch: expected.headBranch,
    headSha: expected.headSha,
    baseBranch: expected.baseBranch,
  };
  if (canonicalJson(projection) !== canonicalJson(sealed)) {
    throw new Error("Device-projection recovery draft review identity drifted.");
  }
}

function defaultExecute(command, argumentsList, cwd) {
  return execFileSync(command, argumentsList, {
    cwd,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
function privateExternalFile(value, roots, label) {
  const candidate = canonicalPath(value, label);
  if (roots.some(root => candidate === root || candidate.startsWith(`${root}${path.sep}`))) {
    throw new Error(`${label} must remain outside repository worktrees.`);
  }
  const metadata = lstatSync(candidate);
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
    throw new Error(`${label} must be a private regular file.`);
  }
  return candidate;
}
function canonicalPath(value, label) {
  if (!path.isAbsolute(String(value || ""))) throw new Error(`${label} must be absolute.`);
  return realpathSync(path.resolve(value));
}
function text(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value;
}
