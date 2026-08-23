import { execFileSync, spawnSync } from "node:child_process";
import {
  closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync,
  readdirSync, realpathSync, renameSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { digestValue, normalizeWriteSet } from "./cloud-collaboration-primitives.mjs";
import { assertLeaseWorktree } from "./device-branch-ownership-lib.mjs";
import { proveLegacyReviewCanonicalDescendant }
  from "./legacy-clean-committed-lane-bootstrap-adapter-lib.mjs";
import { assertAdmissionMutationAuthority } from "./scoped-lane-admission-state.mjs";
import {
  partitionChangedPathsByScope,
  readPullRequestProjection,
  remoteBranchHead,
  requireCloudAdmission,
  requireChangedPathsWithinScope,
} from "./expired-committed-heartbeat-evidence.mjs";
import { assertPullRequestBodyWithinGitHubLimit }
  from "./expired-committed-heartbeat-contract.mjs";
import {
  bindAdmissionCloudAuthority,
  invokeRepositoryCloudAction,
  verifyAdmissionCloudAuthority,
} from "./scoped-lane-cloud-authority.mjs";
import { continueExpiredCommittedHeartbeatCloudAuthority }
  from "./expired-committed-heartbeat-cloud-authority.mjs";
import { normalizeBoundAuthority } from "./scoped-lane-cloud-reconciliation.mjs";
import {
  authorizeTaskBoundLeaseMutation,
  continueTaskAuthorityCloudSuccessorBinding,
} from "./task-bound-lane-authority-store.mjs";
import {
  normalizeProtectedMainPathEquivalenceEvidence,
  normalizeProtectedMainSharedAncestorPathEquivalenceEvidence,
  readTreeBlobEntry,
} from "./protected-main-path-equivalence-lib.mjs";
import {
  createWriterLeaseStore,
  parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker,
  updateWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";
import { mutateWriterLeaseRegistry, writerLeaseDigest }
  from "./writer-lease-registry-cas.mjs";
import {
  authorizeRepeatedRecovery,
  buildRepeatedRecoveryCompletion,
  buildRepeatedRecoveryPlan,
  INTENT_SCHEMA,
  OPERATION,
} from "./repeated-expired-committed-heartbeat-recovery-contract.mjs";

const RESULT_SCHEMA = "agentic-repeated-expired-committed-heartbeat-recovery-result/v1";
const DIGEST = /^[0-9a-f]{64}$/u;
const CONTROLLER_ROOT = fileURLToPath(new URL("..", import.meta.url));
const IMPLEMENTATION_FILES = Object.freeze([
  "scripts/repeated-expired-committed-heartbeat-recovery-contract.mjs",
  "scripts/repeated-expired-committed-heartbeat-recovery-controller.mjs",
  "scripts/repeated-expired-committed-heartbeat-recovery-repository-adapter.mjs",
  "scripts/repeated-expired-committed-heartbeat-recovery.mjs",
]);

export function classifyRepeatedSuccessorBindState({ claim, promoted, plan } = {}) {
  const common = claim?.claimId === promoted?.claimId
    && claim.canonicalBaseRevision === plan?.evidence?.baseSha
    && claim.writeSetDigest === plan?.target?.writeSetDigest
    && JSON.stringify(normalizeWriteSet(claim.declaredWriteScope))
      === JSON.stringify(plan?.target?.declaredWriteSet);
  if (common && claim.state === "current"
    && claim.fenceRevision === promoted.claimDigest
    && claim.transitionCounter === promoted.transitionCounter
    && claim.laneRevision === plan.evidence.fenceSha
    && claim.reviewRequestId === null) {
    return "bind";
  }
  if (common && claim.state === "active"
    && claim.transitionCounter === promoted.transitionCounter + 1
    && claim.laneRevision === plan.evidence.headSha
    && claim.reviewRequestId === plan.evidence.reviewRequestId) {
    return "adopt";
  }
  if (common && claim.state === "dormant-preserved"
    && claim.transitionCounter === promoted.transitionCounter + 1
    && claim.laneRevision === plan.evidence.headSha
    && claim.reviewRequestId === plan.evidence.reviewRequestId) {
    return "recover-adopt";
  }
  throw new Error("Repeated recovery promoted successor is neither pre-bind nor exact bound response-loss state.");
}

export function createRepositoryRepeatedRecoveryAdapter(options = {}, dependencies = {}) {
  const repository = realpathSync(path.resolve(required(options.repository, "repository")));
  const sessionId = required(options.sessionId, "session");
  const pullRequestNumber = positive(options.pullRequestNumber, "pull request");
  const taskAuthorityFile = options.taskAuthorityFile || null;
  const targetManifestFile = realpathSync(path.resolve(required(
    options.targetManifestFile, "target manifest",
  )));
  const ttlSeconds = positive(options.ttlSeconds || 1800, "TTL seconds");
  const environment = options.environment || process.env;
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
  const invoke = dependencies.invoke || invokeRepositoryCloudAction;
  const verifyCloud = dependencies.verifyCloud || verifyAdmissionCloudAuthority;
  const controllerRoot = dependencies.controllerRoot || CONTROLLER_ROOT;
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

  function readTargetManifest() {
    const metadata = lstatSync(targetManifestFile);
    if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o600) {
      fail("private regular 0600 target manifest");
    }
    return readJson(targetManifestFile);
  }

  function controllerWitness() {
    const controllerGit = argumentsList => String(execFileSync("git", argumentsList, {
      cwd: controllerRoot,
      encoding: "utf8",
    })).trim();
    const headSha = controllerGit(["rev-parse", "HEAD"]);
    const localMainSha = controllerGit(["rev-parse", "refs/remotes/origin/main"]);
    const remoteMainSha = controllerGit([
      "ls-remote", "--heads", "origin", "refs/heads/main",
    ]).split(/\s+/u)[0];
    if (headSha !== localMainSha || headSha !== remoteMainSha
      || controllerGit(["status", "--porcelain=v1", "--untracked-files=all"])) {
      fail("clean protected-main controller");
    }
    return Object.freeze({
      headSha,
      implementationDigest: digestValue(IMPLEMENTATION_FILES.map(file => ({
        file,
        digest: digestValue(readFileSync(path.join(controllerRoot, file))),
      }))),
    });
  }

  function capture() {
    assertCanonicalTrackingCurrent();
    const targetManifest = readTargetManifest();
    const targetBranch = branch();
    const lease = leaseStore.read(targetBranch);
    const previousRecovery = lease?.expiredCommittedHeartbeatRecovery;
    if (!previousRecovery || previousRecovery.status !== "recovered") {
      fail("one exact completed predecessor recovery");
    }
    const snapshot = captureRepeatedSnapshot({
      lease, previousRecovery, targetBranch, targetManifest,
    });
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
    return { snapshot, previousRecovery, pull, repo, targetManifest };
  }

  function captureRepeatedSnapshot({ lease, previousRecovery, targetBranch, targetManifest }) {
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
      declaredWriteSet: targetWriteSet(targetManifest),
    });
    const changedPaths = nulPaths(git(["diff", "--name-only", "-z",
      `${lease.baseSha}..${headSha}`]));
    const partition = partitionChangedPathsByScope({
      changedPaths,
      declaredWriteSet: targetWriteSet(targetManifest),
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
      semanticScope: snapshot.lease.scope,
      pullRequestNumber: pull.number,
      reviewRequestId: snapshot.lease.cloudAuthority.reviewRequestId,
      baseSha: snapshot.lease.baseSha,
      fenceSha: snapshot.lease.fenceSha,
      headSha: snapshot.headSha,
      remoteHeadSha: snapshot.remoteHeadSha,
      protectedParentSha: snapshot.protectedParentSha,
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
      sourceDeclaredWriteSet: snapshot.lease.admission.declaredWriteSet,
      sourceWriteSetDigest: snapshot.lease.admission.writeSetDigest,
      sourceManifestDigest: snapshot.lease.admission.manifestDigest,
      authoredPaths: snapshot.authoredPaths,
      rangeDiffDigest: snapshot.rangeDiffDigest,
      controllerDigest: digestValue(controllerWitness()),
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
      const currentPlan = buildRepeatedRecoveryPlan({
        evidence: evidence(source),
        targetManifest: source.targetManifest,
      });
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
      const source = exactSource(plan);
      authorizeSourceLease(source.snapshot.lease);
      const proof = canonicalDescendantProof(plan);
      const result = invoke({
        action: "claim",
        ledgerRepository: source.snapshot.lease.cloudAuthority.ledgerRepository,
        request: {
          targetRepository: source.snapshot.lease.cloudAuthority.targetRepository,
          workItemId: source.snapshot.lease.scope,
          canonicalBaseSha: plan.evidence.baseSha,
          headSha: plan.evidence.fenceSha,
          declaredWriteSet: plan.target.declaredWriteSet,
          predecessorClaimId: plan.evidence.claimId,
          leaseEpoch: 1,
          ttlSeconds,
          ...(proof ? { canonicalDescendantProof: proof } : {}),
          deviceId: source.snapshot.lease.device,
          sessionId,
          idempotencyKey: `${OPERATION}:waiting:${plan.planDigest}`,
        },
        environment,
      });
      const waiting = claimProjection({
        result,
        action: "claim",
        state: "waiting-successor",
        plan,
        predecessorClaimId: plan.evidence.claimId,
      });
      intent = writeJournal(intent, {
        ...intent,
        status: "waiting-successor",
        waiting,
        updatedAt: now().toISOString(),
      });
    }

    if (intent.status === "waiting-successor") {
      const source = exactSource(plan);
      const result = invoke({
        action: "retire",
        ledgerRepository: source.snapshot.lease.cloudAuthority.ledgerRepository,
        request: {
          targetRepository: source.snapshot.lease.cloudAuthority.targetRepository,
          claimId: plan.evidence.claimId,
          expectedFenceRevision: plan.evidence.claimDigest,
          expectedTransitionCounter: plan.evidence.cloudTransitionCounter,
          reason: "superseded",
          finalRevision: plan.evidence.fenceSha,
          reviewRequestId: plan.evidence.reviewRequestId,
          bytesDigest: plan.evidence.rangeDiffDigest,
          namedChecksDigest: digestValue({
            planDigest: plan.planDigest,
            kind: "protected-refresh-checks",
          }),
          handoffEvidenceDigest: digestValue({
            planDigest: plan.planDigest,
            successorClaimId: intent.waiting.claimId,
          }),
          deviceId: source.snapshot.lease.device,
          sessionId,
          idempotencyKey: `${OPERATION}:retire:${plan.planDigest}`,
        },
        environment,
      });
      if (result?.schema !== "agentic-cloud-collaboration-result/v1"
        || result.ok !== true || result.action !== "retire"
        || result.claim?.claimId !== plan.evidence.claimId
        || !["retired", "released"].includes(result.claim?.state)) fail("source retirement");
      intent = writeJournal(intent, {
        ...intent,
        status: "source-retired",
        sourceRetirementReceiptDigest: requiredDigest(
          result.receipt?.receiptDigest, "source retirement receipt",
        ),
        updatedAt: now().toISOString(),
      });
    }

    if (intent.status === "source-retired") {
      const source = intent.sourceLease;
      const result = invoke({
        action: "continue",
        ledgerRepository: source.cloudAuthority.ledgerRepository,
        request: {
          targetRepository: source.cloudAuthority.targetRepository,
          claimId: intent.waiting.claimId,
          expectedFenceRevision: intent.waiting.claimDigest,
          expectedTransitionCounter: intent.waiting.transitionCounter,
          mode: "promote",
          ttlSeconds,
          deviceId: source.device,
          sessionId,
          idempotencyKey: `${OPERATION}:promote:${plan.planDigest}`,
        },
        environment,
      });
      const promoted = claimProjection({
        result,
        action: "continue",
        state: "current",
        plan,
      });
      if (promoted.claimId !== intent.waiting.claimId
        || promoted.transitionCounter !== intent.waiting.transitionCounter + 1) {
        fail("successor promotion lineage");
      }
      intent = writeJournal(intent, {
        ...intent,
        status: "successor-promoted",
        promoted,
        updatedAt: now().toISOString(),
      });
    }

    if (intent.status === "successor-promoted") {
      const source = intent.sourceLease;
      const status = cloudStatus(source);
      const claim = status.claims.filter(candidate => (
        candidate?.claimId === intent.promoted.claimId
      ));
      if (claim.length !== 1) fail("promoted successor inventory");
      const bindMode = classifyRepeatedSuccessorBindState({
        claim: claim[0], promoted: intent.promoted, plan,
      });
      const target = manifest(plan);
      const seed = normalizeBoundAuthority({
        result: {
          schema: "agentic-cloud-collaboration-result/v1",
          ok: true,
          action: "continue",
          ledgerRevision: status.ledgerRevision,
          ledgerDigest: status.ledgerDigest,
          claimDigest: claim[0].fenceRevision,
          claim: claim[0],
        },
        authority: {
          ...source.cloudAuthority,
          canonicalBaseSha: plan.evidence.baseSha,
          laneRevision: plan.evidence.fenceSha,
          cloudDeclaredWriteScope: plan.target.declaredWriteSet,
          writeSetDigest: plan.target.writeSetDigest,
          leaseEpoch: 1,
          reviewRequestId: null,
          state: "active",
          manifestDigest: plan.target.manifestDigest,
        },
        manifest: target,
        deviceId: source.device,
        sessionId,
      });
      let bound;
      if (bindMode === "bind") {
        bound = bindAdmissionCloudAuthority({
          authority: seed,
          manifest: target,
          branch: plan.evidence.branch,
          headSha: plan.evidence.headSha,
          reviewRequestId: plan.evidence.reviewRequestId,
          deviceId: source.device,
          sessionId,
          idempotencyKey: `${OPERATION}:bind:${plan.planDigest}`,
          returnVerification: true,
          environment,
          invoke,
          inspect: invoke,
        });
      } else if (bindMode === "adopt") {
        bound = verifyCloud({
          authority: seed,
          manifest: target,
          canonicalBaseSha: plan.evidence.baseSha,
          environment,
          inspect: invoke,
        });
      } else {
        const recoveryEvidenceDigest = digestValue({
          schema: "agentic-repeated-expired-committed-heartbeat-bound-recovery-evidence/v1",
          planDigest: plan.planDigest,
          claimId: claim[0].claimId,
          claimDigest: claim[0].fenceRevision,
          transitionCounter: claim[0].transitionCounter,
          reviewRequestId: claim[0].reviewRequestId,
        });
        bound = continueExpiredCommittedHeartbeatCloudAuthority({
          authority: Object.freeze({ ...seed, state: "active" }),
          manifest: target,
          recoveryEvidenceDigest,
          deviceId: source.device,
          sessionId,
          ttlSeconds,
          environment,
          inspect: invoke,
          invoke,
          verify: input => verifyCloud({ ...input, inspect: invoke }),
        });
      }
      intent = writeJournal(intent, {
        ...intent,
        status: "successor-bound",
        boundAuthority: bound.authority,
        boundVerificationReceiptDigest: bound.verification.receiptDigest,
        updatedAt: now().toISOString(),
      });
    }

    if (intent.status === "successor-bound") {
      const observed = leaseStore.read(plan.evidence.branch);
      let lease;
      if (observed?.cloudAuthority?.claimId === intent.boundAuthority.claimId) {
        lease = observed;
      } else {
        if (digestValue(observed) !== plan.evidence.leaseDigest
          || observed?.cloudAuthority?.claimId !== plan.evidence.claimId) {
          fail("writer-lease CAS subject");
        }
        authorizeSourceLease(observed);
        const verified = verifyCloud({
          authority: intent.boundAuthority,
          manifest: manifest(plan),
          canonicalBaseSha: plan.evidence.baseSha,
          environment,
          inspect: invoke,
        });
        const admission = successorAdmission({
          source: observed.admission,
          plan,
          authority: verified.authority,
        });
        const projectedAt = verified.verification.verifiedAt || now().toISOString();
        const nextCore = {
          ...observed,
          admission,
          cloudAuthority: verified.authority,
          heartbeatAt: projectedAt,
          expiresAt: verified.authority.expiresAt,
        };
        const nextLease = {
          ...nextCore,
          taskAuthority: continueTaskAuthorityCloudSuccessorBinding({
            sourceLease: observed,
            nextLease: nextCore,
            capabilityPath: taskAuthorityFile,
            boundAt: projectedAt,
          }),
        };
        assertAdmissionMutationAuthority({
          lease: nextLease,
          cloudAuthority: verified.authority,
          remoteAuthorityVerification: verified.verification,
        });
        const result = mutateWriterLeaseRegistry({
          leaseStore,
          branch: plan.evidence.branch,
          expectedLeaseDigest: plan.evidence.leaseDigest,
          expectedClaimId: plan.evidence.claimId,
          action: ({ registry }) => ({
            registry: {
              ...registry,
              leases: { ...registry.leases, [plan.evidence.branch]: nextLease },
            },
            lease: nextLease,
            changed: true,
          }),
        });
        lease = result.lease;
      }
      requireTargetLease({ lease, plan, authority: intent.boundAuthority });
      intent = writeJournal(intent, {
        ...intent,
        status: "local-projected",
        targetLeaseDigest: writerLeaseDigest(lease),
        targetTaskBindingDigest: lease.taskAuthority.bindingDigest,
        updatedAt: now().toISOString(),
      });
    }

    if (intent.status === "local-projected") {
      const lease = exactTargetLease(intent, plan);
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
      verifyTerminal({ lease, plan, targetMarkerDigest });
      intent = writeJournal(intent, {
        ...intent,
        status: "marker-projected",
        targetMarkerDigest,
        updatedAt: now().toISOString(),
      });
    }

    if (intent.status === "marker-projected") {
      const lease = exactTargetLease(intent, plan);
      verifyTerminal({ lease, plan, targetMarkerDigest: intent.targetMarkerDigest });
      const completion = buildRepeatedRecoveryCompletion({
        plan,
        intent,
        finalEvidence: {
          successorClaimId: lease.cloudAuthority.claimId,
          successorClaimDigest: lease.cloudAuthority.claimDigest,
          successorTransitionCounter: lease.cloudAuthority.transitionCounter,
          targetLeaseDigest: digestValue(lease),
          targetTaskBindingDigest: lease.taskAuthority.bindingDigest,
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

  function exactSource(plan) {
    const source = capture();
    if (source.snapshot.snapshotDigest !== plan.evidence.snapshotDigest
      || digestValue(source.previousRecovery) !== plan.evidence.previousRecoveryDigest
      || digestValue(controllerWitness()) !== plan.evidence.controllerDigest) {
      fail("sealed source drift");
    }
    return source;
  }

  function exactTargetLease(intent, plan) {
    const lease = leaseStore.read(plan.evidence.branch);
    if (digestValue(lease) !== intent.targetLeaseDigest) fail("target writer lease");
    requireTargetLease({ lease, plan, authority: intent.boundAuthority });
    return lease;
  }

  function verifyTerminal({ lease, plan, targetMarkerDigest }) {
    if (git(["status", "--porcelain=v1", "-z", "--untracked-files=all"])) fail("clean target");
    if (git(["rev-parse", "HEAD"]) !== plan.evidence.headSha) fail("target head");
    if (remoteBranchHead({ branch: lease.branch, gitOptional })
      !== plan.evidence.remoteHeadSha) fail("remote head");
    const verified = verifyCloud({
      authority: lease.cloudAuthority,
      manifest: manifest(plan),
      canonicalBaseSha: plan.evidence.baseSha,
      environment,
      inspect: invoke,
    });
    assertAdmissionMutationAuthority({
      lease,
      cloudAuthority: verified.authority,
      remoteAuthorityVerification: verified.verification,
    });
    const projection = readPullRequestProjection({
      lease,
      branch: lease.branch,
      ghText: gh,
      expectedHeadSha: plan.evidence.remoteHeadSha,
    });
    if (projection.markerDigest !== targetMarkerDigest) fail("terminal marker");
  }

  function canonicalDescendantProof(plan) {
    const protectedMainSha = git(["rev-parse", "refs/remotes/origin/main"]);
    if (plan.evidence.baseSha === protectedMainSha) return null;
    if (!isAncestor(plan.evidence.baseSha, protectedMainSha)) {
      fail("source base ancestry to protected main");
    }
    const canonicalChangedPaths = nulPaths(git([
      "diff", "--name-only", "--no-renames", "-z",
      plan.evidence.baseSha, protectedMainSha, "--",
    ]));
    const preservedChangedPaths = plan.target.declaredWriteSet
      .filter(item => item.startsWith("path:"))
      .map(item => item.slice("path:".length));
    return proveLegacyReviewCanonicalDescendant({
      sourceBaseSha: plan.evidence.baseSha,
      targetBaseSha: protectedMainSha,
      protectedMainSha,
      canonicalChangedPaths,
      preservedChangedPaths,
      sourceIsAncestor: true,
      targetIsProtectedAncestor: true,
    });
  }

  function cloudStatus(lease) {
    const result = invoke({
      action: "status",
      ledgerRepository: lease.cloudAuthority.ledgerRepository,
      request: { targetRepository: lease.cloudAuthority.targetRepository },
      environment,
    });
    if (result?.schema !== "agentic-cloud-collaboration-result/v1"
      || result.ok !== true || result.action !== "status"
      || !Array.isArray(result.claims)) fail("cloud status");
    return result;
  }

  function claimProjection({ result, action, state, plan, predecessorClaimId = undefined }) {
    const claim = result?.claim;
    if (result?.schema !== "agentic-cloud-collaboration-result/v1"
      || result.ok !== true || result.action !== action || claim?.state !== state
      || claim.canonicalBaseRevision !== plan.evidence.baseSha
      || claim.laneRevision !== plan.evidence.fenceSha
      || claim.writeSetDigest !== plan.target.writeSetDigest
      || claim.leaseEpoch !== 1
      || JSON.stringify(normalizeWriteSet(claim.declaredWriteScope))
        !== JSON.stringify(plan.target.declaredWriteSet)
      || (predecessorClaimId !== undefined
        && claim.predecessorClaimId !== predecessorClaimId)) {
      fail(`${action} successor result`);
    }
    return Object.freeze({
      claimId: requiredDigest(claim.claimId, "successor claim"),
      claimDigest: requiredDigest(result.claimDigest || claim.fenceRevision,
        "successor claim digest"),
      transitionCounter: positive(claim.transitionCounter, "successor transition"),
      receiptDigest: requiredDigest(result.receipt?.receiptDigest, "successor receipt"),
      expiresAt: required(claim.expiresAt, "successor expiry"),
    });
  }

  function requireTargetLease({ lease, plan, authority }) {
    if (!lease || lease.status !== "active" || lease.branch !== plan.evidence.branch
      || lease.sessionId !== plan.evidence.sessionId
      || lease.baseSha !== plan.evidence.baseSha
      || lease.fenceSha !== plan.evidence.fenceSha
      || lease.admission?.status !== "admitted"
      || lease.admission.manifestDigest !== plan.target.manifestDigest
      || lease.admission.writeSetDigest !== plan.target.writeSetDigest
      || JSON.stringify(lease.admission.declaredWriteSet)
        !== JSON.stringify(plan.target.declaredWriteSet)
      || lease.cloudAuthority?.claimId !== authority.claimId
      || lease.cloudAuthority.claimDigest !== authority.claimDigest
      || lease.cloudAuthority.laneRevision !== plan.evidence.headSha
      || lease.cloudAuthority.reviewRequestId !== plan.evidence.reviewRequestId
      || lease.taskAuthority?.priorBindingDigest !== plan.evidence.taskBindingDigest
      || Date.parse(lease.expiresAt) <= now().getTime()) {
      fail("exact expanded successor lease");
    }
    return lease;
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
    readTargetManifest,
    execute: executeRecovery,
    readActiveIntent,
    readIntentForAuthorization,
  });
}

function manifest(lease) {
  return Object.freeze({
    schema: "agentic-declared-write-scope/v1",
    semanticScope: lease.target?.semanticScope,
    manifestDigest: lease.target?.manifestDigest,
    declaredWriteSet: lease.target?.declaredWriteSet,
    writeSetDigest: lease.target?.writeSetDigest,
  });
}

function targetWriteSet(targetManifest) {
  return normalizeWriteSet(targetManifest.declaredWriteSet
    || (targetManifest.paths || []).map(item => `path:${item}`)
      .concat(`semantic:${targetManifest.semanticScope}`));
}

function successorAdmission({ source, plan, authority }) {
  return Object.freeze({
    schema: "agentic-lane-admission-lease/v1",
    status: "admitted",
    semanticScope: plan.target.semanticScope,
    declaredWriteSet: plan.target.declaredWriteSet,
    writeSetDigest: plan.target.writeSetDigest,
    manifestDigest: plan.target.manifestDigest,
    planReceiptDigest: plan.planDigest,
    admissionReceiptDigest: authority.operationReceiptDigest,
    existingLaneStateDigest: source.existingLaneStateDigest,
    admittedReportDigest: digestValue({
      schema: "agentic-repeated-expired-committed-heartbeat-recovery-admission/v1",
      planDigest: plan.planDigest,
      claimId: authority.claimId,
    }),
    preservationReceiptDigest: digestValue({
      schema: "agentic-repeated-expired-committed-heartbeat-recovery-preservation/v1",
      planDigest: plan.planDigest,
      sourceAdmissionDigest: digestValue(source),
      successorClaimId: authority.claimId,
    }),
  });
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

function requiredDigest(value, label) {
  if (!DIGEST.test(String(value || ""))) fail(label);
  return value;
}

function fail(label) {
  throw new Error(`Repeated expired committed heartbeat recovery requires ${label}.`);
}
