import { execFileSync, spawnSync } from "node:child_process";
import {
  closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync,
  readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import path from "node:path";

import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { assertLeaseWorktree } from "./device-branch-ownership-lib.mjs";
import { assertAdmissionMutationAuthority } from "./scoped-lane-admission-state.mjs";
import {
  continueExpiredCommittedHeartbeatCloudAuthority,
  expiredCommittedCloudRecoveryEvidenceDigest,
  preserveSourceManifestProjection,
} from "./expired-committed-heartbeat-cloud-authority.mjs";
import {
  partitionChangedPathsByScope,
  readPullRequestProjection,
  remoteBranchHead,
  requireCloudAdmission,
  requireChangedPathsWithinScope,
} from "./expired-committed-heartbeat-evidence.mjs";
import {
  assertPullRequestBodyWithinGitHubLimit,
  assertSameCloudSubject,
  reconcileHeartbeatManifestProjection,
} from "./expired-committed-heartbeat-contract.mjs";
import {
  invokeRepositoryCloudAction,
  verifyAdmissionCloudAuthority,
} from "./scoped-lane-cloud-authority.mjs";
import { authorizeTaskBoundLeaseMutation } from "./task-bound-lane-authority-store.mjs";
import {
  normalizeProtectedMainPathEquivalenceEvidence,
  normalizeProtectedMainSharedAncestorPathEquivalenceEvidence,
  readTreeBlobEntry,
} from "./protected-main-path-equivalence-lib.mjs";
import {
  createWriterLeaseStore,
  parseWriterLeasePullRequestBody,
  projectExpiredCommittedHeartbeatLease,
  projectWriterLeasePullRequestMarker,
  updateWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";
import {
  authorizeRepeatedRecovery,
  buildRepeatedRecoveryCompletion,
  buildRepeatedRecoveryPlan,
  INTENT_SCHEMA,
  OPERATION,
} from "./repeated-expired-committed-heartbeat-recovery-contract.mjs";

const RESULT_SCHEMA = "agentic-repeated-expired-committed-heartbeat-recovery-result/v1";
const DIGEST = /^[0-9a-f]{64}$/u;

export function createRepositoryRepeatedRecoveryAdapter(options = {}, dependencies = {}) {
  const repository = realpathSync(path.resolve(required(options.repository, "repository")));
  const sessionId = required(options.sessionId, "session");
  const pullRequestNumber = positive(options.pullRequestNumber, "pull request");
  const taskAuthorityFile = options.taskAuthorityFile || null;
  const ttlSeconds = positive(options.ttlSeconds || 1800, "TTL seconds");
  const now = dependencies.now || (() => new Date());
  const execute = dependencies.execute || ((command, argumentsList, settings = {}) => execFileSync(
    command, argumentsList, { cwd: repository, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"], ...settings },
  ));
  const git = dependencies.git || (argumentsList => String(execute("git", argumentsList)).trim());
  const gitOptional = dependencies.gitOptional || (argumentsList => {
    const result = spawnSync("git", argumentsList, { cwd: repository, encoding: "utf8" });
    return result.status === 0 ? result.stdout.trim() : "";
  });
  const gh = dependencies.gh || (argumentsList => String(execute("gh", argumentsList)).trim());
  const run = dependencies.run || ((command, argumentsList) => execute(command, argumentsList));
  const cloud = dependencies.cloud || continueExpiredCommittedHeartbeatCloudAuthority;
  const verifyCloud = dependencies.verifyCloud || verifyAdmissionCloudAuthority;
  const commonDirectory = realpathSync(path.resolve(repository, git(["rev-parse", "--git-common-dir"])));
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({
    gitCommonDir: commonDirectory,
    taskAuthorityFile,
    taskAuthorityPolicy: "required",
  });
  const journalDirectory = path.join(commonDirectory, "agentic-canvas-os", OPERATION);

  function branch() {
    return required(git(["branch", "--show-current"]), "target branch");
  }

  function capture() {
    assertCanonicalTrackingCurrent();
    const targetBranch = branch();
    const lease = leaseStore.read(targetBranch);
    const previousRecovery = lease?.expiredCommittedHeartbeatRecovery;
    if (!previousRecovery || previousRecovery.status !== "recovered") {
      fail("one exact completed predecessor recovery");
    }
    const snapshot = captureRepeatedSnapshot({ lease, previousRecovery, targetBranch });
    const pull = JSON.parse(gh([
      "pr", "view", String(pullRequestNumber), "--json",
      "number,state,isDraft,headRefName,headRefOid,baseRefName,url",
    ]));
    if (pull.number !== pullRequestNumber || pull.state !== "OPEN" || pull.isDraft !== true
      || pull.headRefName !== targetBranch || pull.headRefOid !== snapshot.remoteHeadSha
      || pull.url !== snapshot.lease.pullRequestUrl || pull.baseRefName !== "main") {
      fail("pull-request subject");
    }
    const repo = JSON.parse(gh(["repo", "view", "--json", "id,nameWithOwner"]));
    return { snapshot, previousRecovery, pull, repo };
  }

  function captureRepeatedSnapshot({ lease, previousRecovery, targetBranch }) {
    const instant = now();
    if (!lease || lease.status !== "active" || lease.sessionId !== sessionId
      || lease.branch !== targetBranch || Date.parse(lease.expiresAt) > instant.getTime()) {
      fail("exact expired active source lease");
    }
    assertLeaseWorktree(lease, repository);
    requireCloudAdmission({ lease, instant, requireLive: false });
    if (git(["status", "--porcelain=v1", "-z", "--untracked-files=all"])) fail("clean target");
    if (previousRecovery.renewedClaimDigest !== lease.cloudAuthority.claimDigest
      || previousRecovery.renewedCloudTransitionCounter !== lease.cloudAuthority.transitionCounter
      || previousRecovery.sourceClaimId !== lease.cloudAuthority.claimId
      || previousRecovery.sourceEpoch !== lease.epoch) {
      fail("unchanged predecessor recovery projection");
    }

    const headSha = git(["rev-parse", "HEAD"]);
    const headTreeSha = git(["rev-parse", `${headSha}^{tree}`]);
    const remoteHeadSha = remoteBranchHead({ branch: targetBranch, gitOptional });
    if (remoteHeadSha !== headSha) fail("published repeated-recovery head");
    const projection = readPullRequestProjection({
      lease,
      branch: targetBranch,
      ghText: gh,
      expectedHeadSha: remoteHeadSha,
    });
    const parents = git(["rev-list", "--parents", "-n", "1", headSha]).split(/\s+/u);
    if (parents.length !== 3 || parents[0] !== headSha
      || parents[1] !== previousRecovery.headSha) {
      fail("one exact post-recovery protected-refresh merge");
    }
    const protectedParentSha = parents[2];
    if (!isAncestor(protectedParentSha, "refs/remotes/origin/main")) {
      fail("historical protected parent ancestry");
    }
    const protectedParentTreeSha = git(["rev-parse", `${protectedParentSha}^{tree}`]);
    const authoredPaths = nulPaths(git(["diff", "--name-only", "-z",
      `${protectedParentSha}..${headSha}`]));
    requireChangedPathsWithinScope({
      changedPaths: authoredPaths,
      declaredWriteSet: lease.admission.declaredWriteSet,
    });
    const changedPaths = nulPaths(git(["diff", "--name-only", "-z",
      `${lease.baseSha}..${headSha}`]));
    const partition = partitionChangedPathsByScope({
      changedPaths,
      declaredWriteSet: lease.admission.declaredWriteSet,
    });
    const protectedEntries = partition.protectedEquivalentPaths.map(relativePath => {
      const head = readTreeBlobEntry({ gitText: git, treeish: headSha,
        relativePath, label: "repeated-recovery head" });
      const protectedParent = readTreeBlobEntry({ gitText: git, treeish: protectedParentSha,
        relativePath, label: "historical protected parent" });
      if (head.mode !== protectedParent.mode || head.blobSha !== protectedParent.blobSha) {
        fail(`historical protected byte equivalence for ${relativePath}`);
      }
      return { path: relativePath, headMode: head.mode, headBlobSha: head.blobSha,
        protectedMode: protectedParent.mode, protectedBlobSha: protectedParent.blobSha };
    });
    const protectedMainEquivalence = normalizeProtectedMainPathEquivalenceEvidence({
      schema: "agentic-protected-main-path-equivalence/v1",
      baseSha: lease.baseSha,
      headSha,
      headTreeSha,
      protectedMainRef: "refs/remotes/origin/main",
      protectedMainSha: protectedParentSha,
      protectedMainTreeSha: protectedParentTreeSha,
      exemptPathCount: protectedEntries.length,
      exemptPathsDigest: digestValue(protectedEntries.map(entry => entry.path)),
      entries: protectedEntries,
    });
    const sharedEntries = protectedEntries.map(entry => ({
      path: entry.path,
      headMode: entry.headMode,
      headBlobSha: entry.headBlobSha,
      sharedAncestorMode: entry.protectedMode,
      sharedAncestorBlobSha: entry.protectedBlobSha,
    }));
    const sharedAncestorEquivalence =
      normalizeProtectedMainSharedAncestorPathEquivalenceEvidence({
        schema: "agentic-protected-main-shared-ancestor-path-equivalence/v1",
        baseSha: lease.baseSha,
        headSha,
        headTreeSha,
        protectedMainRef: "refs/remotes/origin/main",
        protectedMainSha: protectedParentSha,
        protectedMainTreeSha: protectedParentTreeSha,
        sharedAncestorSha: protectedParentSha,
        sharedAncestorTreeSha: protectedParentTreeSha,
        exemptPathCount: sharedEntries.length,
        exemptPathsDigest: digestValue(sharedEntries.map(entry => entry.path)),
        entries: sharedEntries,
      });
    const rangeDiffDigest = digestValue({
      schema: "agentic-repeated-expired-committed-heartbeat-range/v1",
      predecessorRecoveryDigest: digestValue(previousRecovery),
      predecessorHeadSha: previousRecovery.headSha,
      protectedParentSha,
      headSha,
      headTreeSha,
      authoredPaths,
      changedPaths,
    });
    const recoveryEvidence = {
      sourceEpoch: lease.epoch,
      sourceSessionId: lease.sessionId,
      sourceDevice: lease.device,
      sourceScope: lease.scope,
      sourceBranch: lease.branch,
      sourceBaseSha: lease.baseSha,
      sourceFenceSha: lease.fenceSha,
      sourceRemoteHeadSha: remoteHeadSha,
      sourceRemoteTreeSha: headTreeSha,
      sourceRemoteChangedPathCount: changedPaths.length,
      sourceRemoteChangedPathsDigest: digestValue(changedPaths),
      sourceRemoteDeclaredChangedPathCount: partition.declaredChangedPaths.length,
      sourceRemoteDeclaredChangedPathsDigest: digestValue(partition.declaredChangedPaths),
      sourceRemoteProtectedEquivalentPathCount: partition.protectedEquivalentPaths.length,
      sourceRemoteProtectedEquivalentPathsDigest: digestValue(partition.protectedEquivalentPaths),
      sourceRemoteSharedAncestorEquivalence: sharedAncestorEquivalence,
      sourceRemoteSharedAncestorEquivalenceDigest: digestValue(sharedAncestorEquivalence),
      sourceRemoteRangeDiffDigest: rangeDiffDigest,
      sourcePullRequestUrl: lease.pullRequestUrl,
      sourceClaimId: lease.cloudAuthority.claimId,
      sourceClaimDigest: lease.cloudAuthority.claimDigest,
      sourceLedgerRevision: lease.cloudAuthority.ledgerRevision,
      sourceClaimLedgerRevision: lease.cloudAuthority.claimLedgerRevision,
      sourceCloudTransitionCounter: lease.cloudAuthority.transitionCounter,
      headSha,
      treeSha: headTreeSha,
      changedPathCount: changedPaths.length,
      changedPathsDigest: digestValue(changedPaths),
      declaredChangedPathCount: partition.declaredChangedPaths.length,
      declaredChangedPathsDigest: digestValue(partition.declaredChangedPaths),
      protectedEquivalentPathCount: partition.protectedEquivalentPaths.length,
      protectedEquivalentPathsDigest: digestValue(partition.protectedEquivalentPaths),
      protectedMainEquivalence,
      protectedMainEquivalenceDigest: digestValue(protectedMainEquivalence),
      sourceMarkerDigest: projection.markerDigest,
      pullRequestBodyDigest: projection.bodyDigest,
      rangeDiffDigest,
    };
    const snapshot = {
      schema: "agentic-repeated-expired-committed-heartbeat-snapshot/v1",
      branch: targetBranch,
      sourceLeaseDigest: digestValue(lease),
      previousRecoveryDigest: digestValue(previousRecovery),
      sourceMarkerDigest: projection.markerDigest,
      pullRequestBodyDigest: projection.bodyDigest,
      remoteHeadSha,
      pullRequestHeadSha: projection.pullRequest.headRefOid,
      protectedParentSha,
      headSha,
      treeSha: headTreeSha,
      changedPaths,
      authoredPaths,
      declaredChangedPaths: partition.declaredChangedPaths,
      protectedEquivalentPaths: partition.protectedEquivalentPaths,
      protectedMainEquivalence,
      rangeDiffDigest,
    };
    return Object.freeze({
      ...snapshot,
      snapshotDigest: digestValue(snapshot),
      lease,
      recoveryEvidence: Object.freeze(recoveryEvidence),
    });
  }

  function evidence(source) {
    const { snapshot, previousRecovery, pull, repo } = source;
    return {
      repositoryId: repo.id,
      branch: snapshot.branch,
      sessionId,
      pullRequestNumber: pull.number,
      baseSha: snapshot.lease.baseSha,
      fenceSha: snapshot.lease.fenceSha,
      headSha: snapshot.headSha,
      remoteHeadSha: snapshot.remoteHeadSha,
      claimId: snapshot.lease.cloudAuthority.claimId,
      claimDigest: snapshot.lease.cloudAuthority.claimDigest,
      cloudTransitionCounter: snapshot.lease.cloudAuthority.transitionCounter,
      leaseEpoch: snapshot.lease.epoch,
      leaseDigest: digestValue(snapshot.lease),
      taskBindingDigest: snapshot.lease.taskAuthority?.bindingDigest,
      previousRecoveryDigest: digestValue(previousRecovery),
      sourceMarkerDigest: snapshot.sourceMarkerDigest,
      pullRequestBodyDigest: snapshot.pullRequestBodyDigest,
      snapshotDigest: snapshot.snapshotDigest,
      writeSetDigest: snapshot.lease.admission.writeSetDigest,
      expiresAt: snapshot.lease.expiresAt,
    };
  }

  async function inspect() {
    return evidence(capture());
  }

  async function executeRecovery({ plan, authorization, intent: suppliedIntent }) {
    authorizeRepeatedRecovery({ plan, authorization });
    let intent = suppliedIntent || readJournal(plan.planDigest);
    if (intent?.status === "complete") return completedResult(intent);

    if (!intent) {
      const source = capture();
      const currentPlan = buildRepeatedRecoveryPlan({ evidence: evidence(source) });
      if (currentPlan.planDigest !== plan.planDigest) fail("source drift after planning");
      authorizeSourceLease(source.snapshot.lease);
      intent = writeJournal(null, {
        schema: INTENT_SCHEMA,
        status: "prepared",
        planDigest: plan.planDigest,
        planSnapshot: plan,
        authorization,
        previousRecovery: source.previousRecovery,
        recoveryEvidence: source.snapshot.recoveryEvidence,
        sourceLease: source.snapshot.lease,
        updatedAt: now().toISOString(),
      });
    }

    if (intent.status === "prepared") {
      authorizeSourceLease(intent.sourceLease);
      const source = capture();
      if (source.snapshot.snapshotDigest !== plan.evidence.snapshotDigest
        || digestValue(source.previousRecovery) !== plan.evidence.previousRecoveryDigest) {
        fail("prepared source drift");
      }
      const heartbeat = cloud({
        authority: source.snapshot.lease.cloudAuthority,
        manifest: manifest(source.snapshot.lease),
        recoveryEvidenceDigest: expiredCommittedCloudRecoveryEvidenceDigest({
          snapshotDigest: source.snapshot.snapshotDigest,
          recoveryEvidence: source.snapshot.recoveryEvidence,
        }),
        deviceId: source.snapshot.lease.device,
        sessionId,
        ttlSeconds,
      });
      const renewedProjection = reconcileHeartbeatManifestProjection({
        renewed: heartbeat.authority,
        admittedManifestDigest: source.snapshot.lease.admission.manifestDigest,
      });
      assertSameCloudSubject({
        source: source.snapshot.lease.cloudAuthority,
        renewed: renewedProjection,
        lease: source.snapshot.lease,
        now: now(),
      });
      const renewedAuthority = preserveSourceManifestProjection(
        source.snapshot.lease.cloudAuthority,
        renewedProjection,
      );
      const recoveredAt = now().toISOString();
      const projectedLease = projectExpiredCommittedHeartbeatLease({
        sourceLease: source.snapshot.lease,
        renewedCloudAuthority: renewedAuthority,
        recoveryEvidence: source.snapshot.recoveryEvidence,
        ttlMs: ttlSeconds * 1000,
        recoveredAt,
      });
      assertAdmissionMutationAuthority({
        lease: projectedLease,
        cloudAuthority: renewedAuthority,
        remoteAuthorityVerification: heartbeat.verification,
        evaluatedAt: recoveredAt,
      });
      intent = writeJournal(intent, {
        ...intent,
        status: "cloud-renewed",
        renewedAuthority,
        recoveredAt,
        targetLeaseDigest: digestValue(projectedLease),
        updatedAt: now().toISOString(),
      });
    }

    if (intent.status === "cloud-renewed") {
      const projectedLease = deriveProjectedLease(intent);
      const current = leaseStore.read(plan.evidence.branch);
      let lease;
      if (digestValue(current) === plan.evidence.leaseDigest) {
        lease = leaseStore.recoverExpiredCommittedHeartbeat({
          sessionId,
          branch: plan.evidence.branch,
          expectedLease: current,
          renewedCloudAuthority: intent.renewedAuthority,
          recoveryEvidence: intent.recoveryEvidence,
          ttlMs: ttlSeconds * 1000,
          recoveredAt: intent.recoveredAt,
        });
      } else if (digestValue(current) === intent.targetLeaseDigest) {
        lease = current;
      } else {
        fail("writer-lease CAS subject");
      }
      if (digestValue(lease) !== digestValue(projectedLease)) fail("projected writer lease");
      const verified = verifyCloud({
        authority: lease.cloudAuthority,
        manifest: manifest(lease),
        canonicalBaseSha: lease.baseSha,
      });
      assertAdmissionMutationAuthority({
        lease,
        cloudAuthority: lease.cloudAuthority,
        remoteAuthorityVerification: verified.verification,
      });
      intent = writeJournal(intent, {
        ...intent,
        status: "lease-projected",
        updatedAt: now().toISOString(),
      });
    }

    if (intent.status === "lease-projected") {
      const lease = exactTargetLease(intent);
      const projection = readPullRequestProjection({
        lease,
        branch: plan.evidence.branch,
        ghText: gh,
        expectedHeadSha: plan.evidence.remoteHeadSha,
      });
      const targetMarkerDigest = digestValue(projectWriterLeasePullRequestMarker(lease));
      if (projection.markerDigest === plan.evidence.sourceMarkerDigest) {
        const body = updateWriterLeasePullRequestBody(projection.pullRequest.body, lease);
        assertPullRequestBodyWithinGitHubLimit(body);
        run("gh", ["pr", "edit", lease.pullRequestUrl, "--body", body]);
      } else if (projection.markerDigest !== targetMarkerDigest) {
        fail("pull-request marker CAS subject");
      }
      const confirmed = readPullRequestProjection({
        lease,
        branch: plan.evidence.branch,
        ghText: gh,
        expectedHeadSha: plan.evidence.remoteHeadSha,
      });
      if (confirmed.markerDigest !== targetMarkerDigest) fail("projected pull-request marker");
      verifyTerminal({ lease, targetMarkerDigest });
      intent = writeJournal(intent, {
        ...intent,
        status: "marker-projected",
        targetMarkerDigest,
        updatedAt: now().toISOString(),
      });
    }

    if (intent.status === "marker-projected") {
      const lease = exactTargetLease(intent);
      verifyTerminal({ lease, targetMarkerDigest: intent.targetMarkerDigest });
      const completion = buildRepeatedRecoveryCompletion({
        plan,
        intent,
        finalEvidence: {
          renewedClaimDigest: lease.cloudAuthority.claimDigest,
          renewedTransitionCounter: lease.cloudAuthority.transitionCounter,
          targetLeaseDigest: digestValue(lease),
          targetMarkerDigest: intent.targetMarkerDigest,
          completedAt: now().toISOString(),
        },
      });
      intent = writeJournal(intent, {
        ...intent,
        status: "complete",
        completion,
        updatedAt: now().toISOString(),
      });
    }
    return completedResult(intent);
  }

  function authorizeSourceLease(lease) {
    if (!taskAuthorityFile) fail("--task-authority");
    return authorizeTaskBoundLeaseMutation({
      lease,
      capabilityPath: taskAuthorityFile,
      operation: OPERATION,
      now: now(),
    });
  }

  function deriveProjectedLease(intent) {
    return projectExpiredCommittedHeartbeatLease({
      sourceLease: intent.sourceLease,
      renewedCloudAuthority: intent.renewedAuthority,
      recoveryEvidence: intent.recoveryEvidence,
      ttlMs: ttlSeconds * 1000,
      recoveredAt: intent.recoveredAt,
    });
  }

  function exactTargetLease(intent) {
    const lease = leaseStore.read(intent.planSnapshot.evidence.branch);
    if (digestValue(lease) !== intent.targetLeaseDigest) fail("target writer lease");
    return lease;
  }

  function verifyTerminal({ lease, targetMarkerDigest }) {
    if (git(["status", "--porcelain=v1", "-z", "--untracked-files=all"])) fail("clean target");
    if (git(["rev-parse", "HEAD"]) !== lease.integration?.commitSha
      && git(["rev-parse", "HEAD"]) !== planHead(lease)) fail("target head");
    if (remoteBranchHead({ branch: lease.branch, gitOptional }) !== planRemote(lease)) fail("remote head");
    const projection = readPullRequestProjection({
      lease,
      branch: lease.branch,
      ghText: gh,
      expectedHeadSha: planRemote(lease),
    });
    if (projection.markerDigest !== targetMarkerDigest) fail("terminal marker");
  }

  function planHead(lease) {
    const intent = readActiveOrCompleteIntent();
    return intent?.planSnapshot?.evidence.headSha || lease.integration?.commitSha;
  }

  function planRemote(lease) {
    const intent = readActiveOrCompleteIntent();
    return intent?.planSnapshot?.evidence.remoteHeadSha || lease.fenceSha;
  }

  function assertCanonicalTrackingCurrent() {
    const local = git(["rev-parse", "refs/remotes/origin/main"]);
    const remote = gitOptional(["ls-remote", "--heads", "origin", "refs/heads/main"]).split(/\s/u)[0];
    if (!remote || local !== remote) fail("current protected-main observation");
  }

  function isAncestor(ancestor, descendant) {
    try {
      git(["merge-base", "--is-ancestor", ancestor, descendant]);
      return true;
    } catch {
      return false;
    }
  }

  function readActiveIntent() {
    const matches = journalFiles().map(readJson).filter(value => (
      value?.schema === INTENT_SCHEMA
      && value.planSnapshot?.evidence?.branch === branch()
      && value.planSnapshot?.evidence?.sessionId === sessionId
      && value.status !== "complete"
    ));
    if (matches.length > 1) fail("single active recovery intent");
    return matches[0] || null;
  }

  function readActiveOrCompleteIntent() {
    const matches = journalFiles().map(readJson).filter(value => (
      value?.schema === INTENT_SCHEMA
      && value.planSnapshot?.evidence?.branch === branch()
      && value.planSnapshot?.evidence?.sessionId === sessionId
    ));
    return matches.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))[0] || null;
  }

  function readIntentForAuthorization(authorization) {
    const match = String(authorization || "").match(new RegExp(`^authorize ${OPERATION} ([0-9a-f]{64})$`, "u"));
    return match ? readJournal(match[1]) : null;
  }

  function journalPath(planDigest) {
    if (!DIGEST.test(String(planDigest || ""))) fail("journal plan digest");
    return path.join(journalDirectory, `${planDigest}.json`);
  }

  function readJournal(planDigest) {
    const file = journalPath(planDigest);
    return existsSync(file) ? readJson(file) : null;
  }

  function writeJournal(expected, value) {
    mkdirSync(journalDirectory, { recursive: true, mode: 0o700 });
    const file = journalPath(value.planDigest);
    const current = existsSync(file) ? readJson(file) : null;
    if (JSON.stringify(current) !== JSON.stringify(expected)) fail("journal CAS");
    const temporary = `${file}.${process.pid}.tmp`;
    const descriptor = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, file);
    return value;
  }

  function journalFiles() {
    if (!existsSync(journalDirectory)) return [];
    const metadata = lstatSync(journalDirectory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) fail("journal directory");
    return readdirSync(journalDirectory)
      .filter(name => /^[0-9a-f]{64}\.json$/u.test(name))
      .map(name => path.join(journalDirectory, name));
  }

  function completedResult(intent) {
    return Object.freeze({
      schema: RESULT_SCHEMA,
      status: "complete",
      planDigest: intent.planDigest,
      branch: intent.planSnapshot.evidence.branch,
      claimId: intent.planSnapshot.evidence.claimId,
      completion: intent.completion,
    });
  }

  return Object.freeze({
    inspect,
    execute: executeRecovery,
    readActiveIntent,
    readIntentForAuthorization,
  });
}

function manifest(lease) {
  return {
    manifestDigest: lease.admission.manifestDigest,
    declaredWriteSet: lease.admission.declaredWriteSet,
    writeSetDigest: lease.admission.writeSetDigest,
  };
}

function nulPaths(value) {
  return [...new Set(String(value || "").split("\0").filter(Boolean))].sort();
}

function readJson(file) {
  const metadata = lstatSync(file);
  if (!metadata.isFile() || metadata.isSymbolicLink()) fail("journal file");
  return JSON.parse(readFileSync(file, "utf8"));
}

function required(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) fail(label);
  return normalized;
}

function positive(value, label) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) fail(label);
  return normalized;
}

function fail(label) {
  throw new Error(`Repeated expired committed heartbeat recovery requires ${label}.`);
}
