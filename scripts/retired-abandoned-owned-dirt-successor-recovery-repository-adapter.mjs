// Responsibility: Bind deterministic abandoned-dirt reanchoring to Git, GitHub, cloud, and task authority.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACTIVE_OWNED_DIRT_EVIDENCE_SCHEMA,
  captureActiveOwnedDirtEvidence,
  normalizeActiveOwnedDirtEvidence,
  requireSameActiveOwnedDirtEvidence,
} from "./active-owned-dirt-recovery-evidence.mjs";
import { proveIgnoredStateRetention }
  from "./canonical-main-recovery-evidence.mjs";
import {
  LEGACY_ENTRY_SCHEMA,
  RECEIPT_SCHEMA,
  listCurrentClaims,
  validateLedger,
} from "./cloud-collaboration-contract.mjs";
import {
  canonicalJson,
  digestValue,
  normalizeWriteSet,
} from "./cloud-collaboration-primitives.mjs";
import { invokeRepositoryCloudVerifier }
  from "./cloud-collaboration-delivery-verifier.mjs";
import {
  DEFAULT_LEDGER_PATH,
  DEFAULT_LEDGER_REF,
} from "./github-cloud-collaboration-adapter.mjs";
import {
  readOwnershipPullRequest,
  waitForOwnershipPullRequestHead,
} from "./device-pull-request-state.mjs";
import { writerLeaseBodyRemainder }
  from "./orphaned-task-authority-recovery-evidence.mjs";
import { assertRegisteredWorktree } from "./repository-guards.mjs";
import { assertAdmissionMutationAuthority }
  from "./scoped-lane-admission-state.mjs";
import { normalizeDeclaredWriteScopeManifest }
  from "./scoped-lane-admission-lib.mjs";
import {
  bindAdmissionCloudAuthority,
  invokeRepositoryCloudAction,
  verifyAdmissionCloudAuthority,
} from "./scoped-lane-cloud-authority.mjs";
import { normalizeBoundAuthority }
  from "./scoped-lane-cloud-reconciliation.mjs";
import {
  assertCapabilityMatchesBinding,
  assertTaskAuthorityBinding,
  createTaskAuthorityBinding,
  createTaskAuthorityProof,
  projectTaskAuthorityCapability,
  verifyTaskAuthorityProof,
} from "./task-bound-lane-authority-contract.mjs";
import { readTaskAuthorityCapability }
  from "./task-bound-lane-authority-store.mjs";
import {
  createWriterLeaseStore,
  parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker,
  updateWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";
import {
  mutateWriterLeaseRegistry,
  withHeartbeatProjectionFence,
  writerLeaseDigest,
} from "./writer-lease-registry-cas.mjs";
import {
  OPERATION,
  normalizeRecoveryIntent,
} from "./retired-abandoned-owned-dirt-successor-recovery-contract.mjs";
import {
  REANCHOR_PROJECTION_SCHEMA,
  assertNoLiveRetiredAbandonedOverlap,
  buildDeterministicCoordinationCommit,
  buildRetiredAbandonedOwnedDirtSuccessorRecoveryEvidence,
  selectRetiredAbandonedClaimProof,
  selectTargetCloudLeaseEpochProof,
} from "./retired-abandoned-owned-dirt-successor-recovery-evidence.mjs";

const CONTROLLER_ROOT = fileURLToPath(new URL("..", import.meta.url));
const IMPLEMENTATION_FILES = Object.freeze([
  "scripts/retired-abandoned-owned-dirt-successor-recovery-contract.mjs",
  "scripts/retired-abandoned-owned-dirt-successor-recovery-controller.mjs",
  "scripts/retired-abandoned-owned-dirt-successor-recovery-evidence.mjs",
  "scripts/retired-abandoned-owned-dirt-successor-recovery-repository-adapter.mjs",
  "scripts/retired-abandoned-owned-dirt-successor-recovery.mjs",
]);
const JOURNAL_SCHEMA =
  "agentic-retired-abandoned-owned-dirt-successor-recovery-journal/v1";
export const RETIRED_ABANDONED_SNAPSHOT_SCHEMA =
  "agentic-retired-abandoned-owned-dirt-successor-recovery-snapshot/v2";
export const RETIRED_ABANDONED_INDEX_SNAPSHOT_SCHEMA =
  "agentic-retired-abandoned-owned-dirt-successor-recovery-index-snapshot/v2";
export const RETIRED_ABANDONED_EVIDENCE_SNAPSHOT_SCHEMA =
  "agentic-retired-abandoned-owned-dirt-successor-recovery-evidence-snapshot/v2";
const EFFECT_SCHEMA =
  "agentic-retired-abandoned-owned-dirt-successor-recovery-effect/v1";
const AUTHENTICATED_LEDGER_SNAPSHOT = Symbol("authenticated-ledger-snapshot");

export function createRetiredAbandonedOwnedDirtSuccessorRecoveryRepositoryAdapter(
  options = {},
  dependencies = {},
) {
  const repository = realpathSync(path.resolve(required(options.repository, "repository")));
  const environment = options.environment || process.env;
  const execute = dependencies.execute || ((command, argumentsList, commandOptions = {}) => {
    const commandEnvironment = {
      ...process.env,
      ...(commandOptions.env || {}),
    };
    return execFileSync(command, argumentsList, {
      cwd: repository,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
      ...commandOptions,
      env: commandEnvironment,
    });
  });
  const git = dependencies.git || dependencies.gitText
    || ((argumentsList, commandOptions = {}) =>
      String(execute("git", argumentsList, commandOptions)).trim());
  const gh = dependencies.gh || dependencies.ghText
    || (argumentsList => String(execute("gh", argumentsList)).trim());
  const ghJson = dependencies.ghJson
    || (argumentsList => JSON.parse(gh(argumentsList)));
  const invoke = dependencies.invoke || invokeRepositoryCloudAction;
  const verify = dependencies.verify || invokeRepositoryCloudVerifier;
  const now = dependencies.now || (() => new Date());
  const beforePullRequestMarkerProjectionFence =
    dependencies.beforePullRequestMarkerProjectionFence || (() => {});
  if (typeof beforePullRequestMarkerProjectionFence !== "function") {
    invalid("pull-request marker projection-fence hook");
  }
  const branch = required(git(["branch", "--show-current"]), "attached source branch");
  if (options.branch && options.branch !== branch) invalid("requested source branch");
  const commonDirectory = realpathSync(path.resolve(
    repository,
    git(["rev-parse", "--path-format=absolute", "--git-common-dir"]),
  ));
  const worktreeRoots = registeredWorktreeRoots(git);
  const protectedControllerRoot = dependencies.controllerWitness
    ? null
    : (dependencies.controllerRoot
      || registeredMainWorktreeRoot(createGit(CONTROLLER_ROOT, environment)));
  const sourceCapabilityPath = secureExternalCapabilityPath({
    value: options.sourceTaskAuthorityFile,
    label: "source task-authority capability",
    commonDirectory,
    worktreeRoots,
  });
  const targetCapabilityPath = secureExternalCapabilityPath({
    value: options.targetTaskAuthorityFile,
    label: "target task-authority capability",
    commonDirectory,
    worktreeRoots,
  });
  if (sourceCapabilityPath === targetCapabilityPath) {
    invalid("distinct source and target task-authority capabilities");
  }
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({
    gitCommonDir: commonDirectory,
    taskAuthorityPolicy: "projected",
  });
  const state = statePaths(commonDirectory, branch);
  const witness = dependencies.controllerWitness
    || (() => captureRetiredAbandonedOwnedDirtProtectedControllerWitness({
      controllerRoot: protectedControllerRoot || CONTROLLER_ROOT,
      implementationFiles: dependencies.implementationFiles || IMPLEMENTATION_FILES,
      environment,
    }));

  function readLease() {
    const lease = leaseStore.read(branch);
    if (!lease || lease.branch !== branch) invalid("writer lease");
    return lease;
  }

  function sourceLease() {
    const lease = readLease();
    if (lease.schema !== "agentic-writer-lease/v2"
      || lease.status !== "active"
      || lease.admission?.schema !== "agentic-lane-admission-lease/v1"
      || lease.admission.status !== "admitted"
      || lease.cloudAuthority?.schema !== "agentic-lane-cloud-authority/v1"
      || lease.cloudAuthority.state !== "active"
      || realpathSync(path.resolve(lease.worktreePath || "")) !== repository) {
      invalid("active admitted source lease");
    }
    assertTaskAuthorityBinding({ binding: lease.taskAuthority, lease });
    return lease;
  }

  function readSourceCapability(lease = sourceLease()) {
    const capability = readStableExternalTaskAuthorityCapability({
      value: sourceCapabilityPath,
      label: "source task-authority capability",
      commonDirectory,
      worktreeRoots: registeredWorktreeRoots(git),
    });
    assertCapabilityMatchesBinding(capability, lease.taskAuthority);
    return capability;
  }

  function readTargetCapability() {
    return readStableExternalTaskAuthorityCapability({
      value: targetCapabilityPath,
      label: "target task-authority capability",
      commonDirectory,
      worktreeRoots: registeredWorktreeRoots(git),
    });
  }

  function sourceAuthorityProof(plan, suffix) {
    const lease = sourceLeaseProjectionStable(plan);
    const capability = readSourceCapability(lease);
    const binding = assertTaskAuthorityBinding({
      binding: lease.taskAuthority,
      lease,
    });
    const operation = `${OPERATION}:${plan.planDigest}:${suffix}`;
    const proofTime = now();
    const proof = createTaskAuthorityProof({
      capability,
      binding,
      lease,
      operation,
      issuedAt: proofTime.toISOString(),
    });
    const verified = verifyTaskAuthorityProof({
      proof,
      binding,
      lease,
      operation,
      now: proofTime,
    });
    const verifiedAt = proofTime.toISOString();
    return Object.freeze({
      schema: "agentic-task-authority-verification-receipt/v1",
      status: "verified",
      authoritySubjectId: binding.authoritySubjectId,
      proofAdapterId: binding.proofAdapterId,
      generation: binding.generation,
      bindingDigest: binding.bindingDigest,
      proofDigest: verified.proofDigest,
      operation,
      verifiedAt,
      receiptDigest: digestValue({
        authoritySubjectId: binding.authoritySubjectId,
        bindingDigest: binding.bindingDigest,
        proofDigest: verified.proofDigest,
        operation,
        verifiedAt,
      }),
    });
  }

  function status(lease = readLease(), authenticatedSnapshot = null) {
    const result = invoke({
      action: "status",
      ledgerRepository: lease.cloudAuthority.ledgerRepository,
      request: { targetRepository: lease.cloudAuthority.targetRepository },
      environment,
    });
    const snapshot = authenticatedSnapshot || rawLedger(lease);
    const sourceEntries = snapshot.ledger.entries.filter(entry =>
      entry.claimId === lease.cloudAuthority.claimId);
    const repositoryIds = [...new Set(sourceEntries.map(entry => entry.repositoryId))];
    if (repositoryIds.length !== 1) invalid("source repository ledger identity");
    const authenticated = assertRetiredAbandonedOwnedDirtCloudStatusSnapshot({
      result,
      snapshot,
      repositoryId: repositoryIds[0],
      evaluationTime: now().toISOString(),
    });
    return Object.freeze({
      ...authenticated,
      [AUTHENTICATED_LEDGER_SNAPSHOT]: snapshot,
    });
  }

  function rawLedger(lease) {
    const ledgerRepository = required(
      lease.cloudAuthority?.ledgerRepository,
      "ledger repository",
    );
    const reference = ghJson([
      "api",
      `repos/${ledgerRepository}/git/ref/heads/${encodeURIComponent(DEFAULT_LEDGER_REF)}`,
    ]);
    const revision = sha(reference?.object?.sha, "ledger ref revision");
    const metadata = ghJson([
      "api",
      `repos/${ledgerRepository}/contents/${DEFAULT_LEDGER_PATH}?ref=${revision}`,
    ]);
    const blobSha = sha(metadata?.sha, "ledger blob SHA");
    const blob = ghJson(["api", `repos/${ledgerRepository}/git/blobs/${blobSha}`]);
    if (blob?.encoding !== "base64" || !blob.content) {
      invalid("complete raw collaboration ledger");
    }
    const raw = Buffer.from(
      String(blob.content).replaceAll("\n", ""),
      "base64",
    ).toString("utf8");
    const ledger = JSON.parse(raw);
    const failures = validateLedger(ledger);
    if (failures.length > 0) {
      throw new Error(`Raw collaboration ledger is invalid: ${failures.join("; ")}`);
    }
    return Object.freeze({ ledger, ledgerRevision: revision });
  }

  function remoteBranchHead(remote = "origin") {
    return firstSha(git([
      "ls-remote", "--heads", remote, `refs/heads/${branch}`,
    ]), "source remote branch");
  }

  function repositoryIdentity(lease, pullRequest) {
    const fetchUrls = remoteUrls(git([
      "remote", "get-url", "--all", "origin",
    ]), "origin fetch URL");
    const pushUrls = remoteUrls(git([
      "remote", "get-url", "--push", "--all", "origin",
    ]), "origin push URL");
    if (fetchUrls.length !== 1 || pushUrls.length !== 1) {
      invalid("single target origin fetch and push URL");
    }
    return assertRetiredAbandonedOwnedDirtRepositoryIdentity({
      targetRepository: lease.cloudAuthority?.targetRepository,
      originFetchUrl: fetchUrls[0],
      originPushUrl: pushUrls[0],
      pullRequest,
      branch,
    });
  }

  function assertRegisteredSource() {
    const record = assertRegisteredWorktree({
      cwd: repository,
      porcelain: git(["worktree", "list", "--porcelain", "-z"]),
    });
    if (realpathSync(record.path) !== repository
      || record.branch !== `refs/heads/${branch}`) {
      invalid("registered source worktree ownership");
    }
  }

  function readPull(lease = readLease()) {
    const pull = readOwnershipPullRequest({
      url: required(lease.pullRequestUrl, "pull-request URL"),
      branch,
      ghText: gh,
      requireOpen: false,
    });
    repositoryIdentity(lease, pull);
    return pull;
  }

  function assertNoAutoMerge(url) {
    const result = ghJson(["pr", "view", url, "--json", "autoMergeRequest"]);
    if (result?.autoMergeRequest !== null) invalid("disabled pull-request auto-merge");
  }

  function captureSourceFence(lease) {
    const headSha = sha(git(["rev-parse", "HEAD"]), "source fence");
    const parents = String(git(["show", "-s", "--format=%P", headSha]))
      .trim().split(/\s+/u).filter(Boolean);
    if (parents.length !== 1) invalid("single-parent empty source fence");
    const parentSha = sha(parents[0], "source fence parent");
    const treeSha = sha(
      git(["show", "-s", "--format=%T", headSha]),
      "source fence tree",
    );
    const baseTreeSha = sha(
      git(["show", "-s", "--format=%T", lease.baseSha]),
      "source base tree",
    );
    if (parentSha !== lease.baseSha || treeSha !== baseTreeSha) {
      invalid("empty source coordination fence");
    }
    return Object.freeze({ headSha, parentSha, treeSha, baseTreeSha });
  }

  function captureProtectedMain({ lease, dirt, remote = "origin" }) {
    const sourceBaseSha = sha(lease.baseSha, "source canonical base");
    const localMainSha = sha(
      git(["rev-parse", "refs/heads/main"]),
      "local main",
    );
    const localOriginMainSha = sha(
      git(["rev-parse", "refs/remotes/origin/main"]),
      "local origin/main",
    );
    const remoteMainSha = firstSha(git([
      "ls-remote", "--heads", remote, "refs/heads/main",
    ]), "remote main");
    if (localMainSha !== localOriginMainSha || localMainSha !== remoteMainSha) {
      invalid("exact protected target main");
    }
    const mergeBaseSha = sha(
      git(["merge-base", sourceBaseSha, localMainSha]),
      "source/protected merge base",
    );
    git(["merge-base", "--is-ancestor", sourceBaseSha, localMainSha]);
    if (mergeBaseSha !== sourceBaseSha || localMainSha === sourceBaseSha) {
      invalid("strict protected-main advance from source base");
    }
    const treeSha = sha(
      git(["show", "-s", "--format=%T", localMainSha]),
      "protected-main tree",
    );
    const changedPaths = sortedCorePaths(git([
      "diff", "--name-only", "--no-renames", "-z",
      sourceBaseSha, localMainSha, "--",
    ]));
    const dirtyPaths = new Set(dirt.entries.map(entry => entry.path));
    const dirtyOverlapPaths = changedPaths.filter(item => dirtyPaths.has(item));
    return Object.freeze({
      sourceBaseSha,
      protectedMainSha: localMainSha,
      treeSha,
      mergeBaseSha,
      ancestryVerified: true,
      localMainSha,
      localOriginMainSha,
      remoteMainSha,
      changedPaths,
      changedPathsDigest: digestValue(changedPaths),
      dirtyOverlapPaths,
      dirtyOverlapPathsDigest: digestValue(dirtyOverlapPaths),
    });
  }

  function captureIgnoredRetention(sourceBaseSha, protectedMainSha) {
    return proveIgnoredStateRetention({
      localHead: sourceBaseSha,
      originHead: protectedMainSha,
      gitText: git,
      gitOptional: argumentsList => gitOptional(git, argumentsList),
    });
  }

  function captureEvidence({ targetManifest } = {}) {
    assertRegisteredSource();
    const lease = sourceLease();
    const sourceFence = captureSourceFence(lease);
    const pull = readPull(lease);
    const identity = repositoryIdentity(lease, pull);
    if (lease.fenceSha !== sourceFence.headSha
      || git(["rev-parse", `refs/heads/${branch}`]) !== sourceFence.headSha
      || remoteBranchHead(identity.originFetchUrl) !== sourceFence.headSha) {
      invalid("source local and remote fence");
    }
    const dirt = captureActiveOwnedDirtEvidence({ repository });
    const targetProtectedMain = captureProtectedMain({
      lease,
      dirt,
      remote: identity.originFetchUrl,
    });
    const ignoredRetention = captureIgnoredRetention(
      lease.baseSha,
      targetProtectedMain.protectedMainSha,
    );
    assertNoAutoMerge(pull.url);
    const marker = parseWriterLeasePullRequestBody(pull.body);
    if (!marker
      || digestValue(marker)
        !== digestValue(projectWriterLeasePullRequestMarker(lease))
      || pull.state !== "CLOSED"
      || pull.isDraft !== true
      || pull.headRefOid !== sourceFence.headSha
      || pull.baseRefOid !== lease.baseSha) {
      invalid("exact closed draft source pull request");
    }
    readSourceCapability(lease);
    const targetCapability = projectTaskAuthorityCapability(readTargetCapability());
    const ledgerSnapshot = rawLedger(lease);
    const ledger = ledgerSnapshot.ledger;
    const sourceClaim = selectRetiredAbandonedClaimProof({
      entries: ledger.entries,
      lease,
    });
    const targetWriteSet = normalizeManifestWriteSet(targetManifest);
    const targetEpochProof = selectTargetCloudLeaseEpochProof({
      entries: ledger.entries,
      sourceProof: sourceClaim,
      targetDeclaredWriteSet: targetWriteSet,
    });
    const inventory = status(lease, ledgerSnapshot);
    const liveInventory = assertNoLiveRetiredAbandonedOverlap({
      claims: inventory.claims,
      sourceProof: sourceClaim,
      targetDeclaredWriteSet: targetWriteSet,
    });
    const reanchor = projectRetiredAbandonedOwnedDirtCurrentBaseReanchor({
      repository,
      dirt,
      sourceFence,
      targetProtectedMain,
      sourceClaim,
      ignoredRetention,
      git,
    });
    const observed = captureActiveOwnedDirtEvidence({ repository });
    requireSameActiveOwnedDirtEvidence(dirt, observed);
    if (git(["rev-parse", "HEAD"]) !== sourceFence.headSha
      || git(["rev-parse", `refs/heads/${branch}`]) !== sourceFence.headSha
      || remoteBranchHead(identity.originFetchUrl) !== sourceFence.headSha) {
      invalid("read-only reanchor planning");
    }
    return buildRetiredAbandonedOwnedDirtSuccessorRecoveryEvidence({
      branch,
      headSha: sourceFence.headSha,
      treeSha: sourceFence.treeSha,
      sourceFence,
      targetProtectedMain,
      reanchor,
      lease,
      leaseDigest: writerLeaseDigest(lease),
      sourceClaim,
      dirt,
      pullRequest: {
        id: required(pull.id, "pull-request ID"),
        url: pull.url,
        number: pullRequestNumber(pull.url),
        headSha: pull.headRefOid,
        baseSha: pull.baseRefOid,
        bodyDigest: digestValue(pull.body || ""),
        bodyRemainderDigest: digestValue(writerLeaseBodyRemainder(pull.body)),
        isDraft: pull.isDraft,
        state: pull.state,
      },
      pullRequestMarkerDigest: digestValue(marker),
      liveInventory,
      targetManifest,
      targetEpochProof,
      targetCapability,
      controller: witness(),
    });
  }

  function assertProtectedInputsCurrent(plan, sealedIdentity = null) {
    const identity = sealedIdentity || (() => {
      const pull = readPull(plan.evidence.lease);
      return repositoryIdentity(plan.evidence.lease, pull);
    })();
    const observed = captureProtectedMain({
      lease: plan.evidence.lease,
      dirt: plan.evidence.dirt,
      remote: identity.originFetchUrl,
    });
    if (digestValue(observed)
        !== digestValue(plan.evidence.targetProtectedMain)
      || digestValue(witness()) !== digestValue(plan.evidence.controller)) {
      invalid("sealed protected-main/controller inputs");
    }
    const ignored = captureIgnoredRetention(
      plan.sourceBaseSha,
      plan.targetCanonicalBaseSha,
    );
    if (digestValue(ignored)
      !== digestValue(plan.evidence.reanchor.ignoredRetention)) {
      invalid("sealed ignored-state retention");
    }
  }

  function sourceLeaseProjectionStable(plan) {
    assertRegisteredSource();
    const lease = sourceLease();
    if (writerLeaseDigest(lease) !== plan.sourceLeaseDigest
      || lease.cloudAuthority.claimId !== plan.sourceClaimId
      || lease.baseSha !== plan.sourceBaseSha
      || lease.fenceSha !== plan.sourceFenceSha
      || lease.epoch !== plan.writerLeaseEpoch) {
      invalid("sealed source writer-lease projection");
    }
    readSourceCapability(lease);
    return lease;
  }

  function sourceGitStable(plan) {
    const lease = sourceLeaseProjectionStable(plan);
    const pull = readPull(lease);
    const identity = repositoryIdentity(lease, pull);
    if (git(["rev-parse", "HEAD"]) !== plan.sourceFenceSha
      || git(["rev-parse", `refs/heads/${branch}`]) !== plan.sourceFenceSha
      || remoteBranchHead(identity.originFetchUrl) !== plan.sourceFenceSha) {
      invalid("sealed source Git refs");
    }
    requireSameActiveOwnedDirtEvidence(
      plan.evidence.dirt,
      captureActiveOwnedDirtEvidence({ repository }),
    );
    assertProtectedInputsCurrent(plan, identity);
    return lease;
  }

  function plannedPull(plan, {
    state: expectedState,
    headSha,
    allowedBaseShas,
    markerLease,
    exactBody = true,
  }) {
    const pull = readPull(plan.evidence.lease);
    assertNoAutoMerge(pull.url);
    if (pull.id !== plan.evidence.pullRequest.id
      || pull.url !== plan.evidence.pullRequest.url
      || pull.headRefOid !== headSha
      || !allowedBaseShas.includes(pull.baseRefOid)
      || pull.state !== expectedState
      || pull.isDraft !== true
      || digestValue(writerLeaseBodyRemainder(pull.body))
        !== plan.evidence.pullRequest.bodyRemainderDigest
      || (exactBody
        && digestValue(pull.body || "") !== plan.evidence.pullRequest.bodyDigest)) {
      invalid(`exact ${expectedState.toLowerCase()} recovery pull request`);
    }
    if (markerLease) {
      const marker = parseWriterLeasePullRequestBody(pull.body);
      if (!marker
        || digestValue(marker)
          !== digestValue(projectWriterLeasePullRequestMarker(markerLease))) {
        invalid("recovery pull-request writer marker");
      }
    }
    return pull;
  }

  function sourceClosedPull(plan, lease = sourceLeaseProjectionStable(plan)) {
    return plannedPull(plan, {
      state: "CLOSED",
      headSha: plan.sourceFenceSha,
      allowedBaseShas: [plan.sourceBaseSha],
      markerLease: lease,
    });
  }

  function reanchoredClosedPull(plan, lease = sourceLeaseProjectionStable(plan)) {
    return plannedPull(plan, {
      state: "CLOSED",
      headSha: plan.targetLaneRevision,
      allowedBaseShas: [plan.sourceBaseSha, plan.targetCanonicalBaseSha],
      markerLease: lease,
    });
  }

  function openRecoveryPull(plan, markerLease, exactBody = true) {
    return plannedPull(plan, {
      state: "OPEN",
      headSha: plan.targetLaneRevision,
      allowedBaseShas: [plan.targetCanonicalBaseSha],
      markerLease,
      exactBody,
    });
  }

  function phaseValues(intent, phase) {
    const values = intent.receipts?.[phase]?.values;
    if (!values) invalid(`${phase} journal values`);
    return values;
  }

  function claimedValues(intent) {
    return phaseValues(intent, "recovery-claimed");
  }

  function boundValues(intent) {
    return phaseValues(intent, "recovery-bound");
  }

  function observePrepared(plan) {
    try {
      verifyMaterializedReanchorObjects({ repository, plan, git });
      return effect("reanchor-prepared", {
        coordinationCommitSha: plan.coordinationCommitSha,
        coordinationTreeSha: plan.coordinationTreeSha,
        sourceIndexTreeSha: plan.sourceIndexTreeSha,
        sourceWorktreeTreeSha: plan.sourceWorktreeTreeSha,
        targetIndexTreeSha: plan.targetIndexTreeSha,
        targetWorktreeTreeSha: plan.targetWorktreeTreeSha,
        dispositionsDigest: plan.dispositionsDigest,
      });
    } catch {
      return null;
    }
  }

  function observeLocalReanchor(plan) {
    assertProtectedInputsCurrent(plan);
    if (git(["rev-parse", "HEAD"]) !== plan.targetLaneRevision
      || git(["rev-parse", `refs/heads/${branch}`]) !== plan.targetLaneRevision
      || git(["write-tree"]) !== plan.targetIndexTreeSha) {
      return null;
    }
    const targetDirt = captureActiveOwnedDirtEvidence({ repository });
    if (targetDirt.evidenceDigest !== plan.targetDirtEvidenceDigest) return null;
    requireSameActiveOwnedDirtEvidence(plan.evidence.reanchor.targetDirt, targetDirt);
    const ignored = captureIgnoredRetention(
      plan.sourceBaseSha,
      plan.targetCanonicalBaseSha,
    );
    if (digestValue(ignored)
      !== digestValue(plan.evidence.reanchor.ignoredRetention)) {
      return null;
    }
    return effect("local-reanchor", {
      sourceFenceSha: plan.sourceFenceSha,
      targetLaneRevision: plan.targetLaneRevision,
      targetIndexTreeSha: plan.targetIndexTreeSha,
      targetWorktreeTreeSha: plan.targetWorktreeTreeSha,
      targetDirtEvidenceDigest: targetDirt.evidenceDigest,
      ignoredRetentionDigest: digestValue(ignored),
      authoredBytesPreserved: true,
    });
  }

  function observeRemoteReanchor(plan) {
    const pull = readPull(plan.evidence.lease);
    const identity = repositoryIdentity(plan.evidence.lease, pull);
    if (!observeLocalReanchor(plan)
      || remoteBranchHead(identity.originFetchUrl) !== plan.targetLaneRevision) {
      return null;
    }
    return effect("remote-reanchor", {
      branch,
      sourceFenceSha: plan.sourceFenceSha,
      targetLaneRevision: plan.targetLaneRevision,
      remoteHeadSha: plan.targetLaneRevision,
      forceWithLease: true,
    });
  }

  function observeRecoveryClaim(plan, requiredState, expectedReviewRequestId) {
    const inventory = status(plan.evidence.lease);
    const matches = inventory.claims.filter(claim =>
      claim.state === requiredState
      && claim.workItemId === plan.evidence.sourceClaim.workItemId
      && claim.repositoryId === plan.evidence.sourceClaim.repositoryId
      && claim.actorId === plan.evidence.sourceClaim.actorId
      && claim.canonicalBaseRevision === plan.targetCanonicalBaseSha
      && claim.laneRevision === plan.targetLaneRevision
      && claim.writeSetDigest === plan.targetWriteSetDigest
      && canonicalJson(normalizeWriteSet(claim.declaredWriteScope))
        === canonicalJson(plan.targetDeclaredWriteSet)
      && claim.leaseEpoch === plan.targetCloudLeaseEpoch
      && claim.deviceId === plan.evidence.lease.device
      && claim.sessionId === plan.operatorSessionId
      && (expectedReviewRequestId === undefined
        || claim.reviewRequestId === expectedReviewRequestId)
      && claim.predecessorClaimId === null);
    if (matches.length !== 1) return null;
    return { inventory, claim: matches[0] };
  }

  function recoveryClaimEffect(plan, observed, operationKey) {
    const snapshot = observed.inventory[AUTHENTICATED_LEDGER_SNAPSHOT];
    if (snapshot?.ledgerRevision !== observed.inventory.ledgerRevision) {
      invalid("recovery claim authenticated ledger snapshot");
    }
    const entries = snapshot.ledger.entries.filter(entry =>
      entry.action === "claim"
      && entry.claimId === observed.claim.claimId);
    if (entries.length !== 1) invalid("unique fresh recovery claim ledger entry");
    const entry = entries[0];
    if (entry.digest !== observed.claim.transitionDigest
      || entry.claimCore?.canonicalBaseRevision !== plan.targetCanonicalBaseSha
      || entry.claimCore?.laneRevision !== plan.targetLaneRevision
      || entry.claimCore?.writeSetDigest !== plan.targetWriteSetDigest
      || entry.claimCore?.leaseEpoch !== plan.targetCloudLeaseEpoch
      || entry.idempotencyKey !== digestValue(operationKey)
      || Date.parse(observed.claim.expiresAt)
        !== Date.parse(entry.evaluationTime) + plan.ttlSeconds * 1_000
      || entry.claimCore?.predecessorClaimId !== null) {
      invalid("fresh recovery claim ledger join");
    }
    return claimEffect({ claim: observed.claim, entry });
  }

  function targetManifest(plan) {
    return plan.evidence.targetManifest;
  }

  function authorityFromObserved(plan, observed) {
    return normalizeBoundAuthority({
      result: {
        schema: "agentic-cloud-collaboration-result/v1",
        ok: true,
        action: "status",
        ledgerRevision: observed.inventory.ledgerRevision,
        ledgerDigest: observed.inventory.ledgerDigest,
        claimDigest: observed.claim.fenceRevision,
        claim: observed.claim,
      },
      authority: {
        ...plan.evidence.lease.cloudAuthority,
        canonicalBaseSha: plan.targetCanonicalBaseSha,
        laneRevision: plan.targetLaneRevision,
        cloudDeclaredWriteScope: plan.targetDeclaredWriteSet,
        writeSetDigest: plan.targetWriteSetDigest,
        leaseEpoch: plan.targetCloudLeaseEpoch,
        reviewRequestId: observed.claim.reviewRequestId || null,
        state: observed.claim.state,
        deviceId: plan.evidence.lease.device,
        sessionId: plan.operatorSessionId,
        manifestDigest: plan.targetManifestDigest,
      },
      manifest: targetManifest(plan),
      deviceId: plan.evidence.lease.device,
      sessionId: plan.operatorSessionId,
    });
  }

  function verifyBoundObserved(plan, observed, operationKey, claimed) {
    if (observed.claim.claimId !== claimed?.claimId
      || observed.claim.reviewRequestId
        !== plan.evidence.sourceClaim.reviewRequestId
      || observed.claim.expiresAt !== claimed?.expiresAt
      || observed.claim.transitionCounter !== claimed?.transitionCounter + 1) {
      invalid("recovery review binding");
    }
    const snapshot = observed.inventory[AUTHENTICATED_LEDGER_SNAPSHOT];
    const history = snapshot?.ledger?.entries.filter(entry =>
      entry.claimId === observed.claim.claimId);
    const latest = history?.at(-1);
    if (snapshot?.ledgerRevision !== observed.inventory.ledgerRevision
      || latest?.action !== "continue"
      || latest.digest !== observed.claim.transitionDigest
      || latest.idempotencyKey !== digestValue(operationKey)
      || latest.claimCore?.reviewRequestId
        !== plan.evidence.sourceClaim.reviewRequestId
      || latest.claimCore?.canonicalBaseRevision !== plan.targetCanonicalBaseSha
      || latest.claimCore?.laneRevision !== plan.targetLaneRevision) {
      invalid("exact authenticated recovery bind operation");
    }
    const authority = authorityFromObserved(plan, observed);
    const verified = verifyAdmissionCloudAuthority({
      authority,
      manifest: targetManifest(plan),
      canonicalBaseSha: plan.targetCanonicalBaseSha,
      environment,
      invoke: verify,
    });
    return effect("bind", {
      authority: verified.authority,
      verification: verified.verification,
      verificationReceiptDigest: verified.verification.receiptDigest,
      verifiedAt: verified.verification.verifiedAt,
    });
  }

  function deterministicLocalTarget(plan, intent) {
    const source = plan.evidence.lease;
    if (source.branch !== branch
      || realpathSync(path.resolve(source.worktreePath || "")) !== repository) {
      invalid("sealed source lease for deterministic target projection");
    }
    const capability = readTargetCapability();
    return buildRetiredAbandonedOwnedDirtDeterministicTargetLease({
      plan,
      sourceLease: source,
      bound: boundValues(intent),
      claimed: claimedValues(intent),
      targetCapability: capability,
    });
  }

  function proveLocalTarget(plan, target, suffix) {
    const remote = verifyAdmissionCloudAuthority({
      authority: target.authority,
      manifest: targetManifest(plan),
      canonicalBaseSha: plan.targetCanonicalBaseSha,
      environment,
      invoke: verify,
    });
    if (digestValue(remote.authority) !== digestValue(target.authority)) {
      invalid("exact sealed bound authority freshness proof");
    }
    const proofTime = now();
    const operation = `${OPERATION}:${plan.planDigest}:${suffix}`;
    const proof = createTaskAuthorityProof({
      capability: target.capability,
      binding: target.binding,
      lease: target.lease,
      operation,
      issuedAt: proofTime.toISOString(),
    });
    const verifiedProof = verifyTaskAuthorityProof({
      proof,
      binding: target.binding,
      lease: target.lease,
      operation,
      now: proofTime,
    });
    const mutation = assertAdmissionMutationAuthority({
      lease: target.lease,
      cloudAuthority: target.authority,
      remoteAuthorityVerification: remote.verification,
    });
    return Object.freeze({
      targetProofDigest: verifiedProof.proofDigest,
      mutationAuthorityReceiptDigest: mutation.receiptDigest,
    });
  }

  function createLocalTarget(plan, intent) {
    sourceLeaseProjectionStable(plan);
    const target = deterministicLocalTarget(plan, intent);
    const possession = proveLocalTarget(plan, target, "target-possession");
    return Object.freeze({
      ...target,
      ...possession,
    });
  }

  function exactLocalTargetProjection(plan, intent, {
    requireLocalCasReceipt = false,
    observedLease = readLease(),
  } = {}) {
    const expected = deterministicLocalTarget(plan, intent);
    const expectedLeaseDigest = writerLeaseDigest(expected.lease);
    const observedLeaseDigest = writerLeaseDigest(observedLease);
    const sealedLocal = intent.receipts?.["local-cas"]?.values || null;
    if (requireLocalCasReceipt && !sealedLocal) {
      invalid("sealed local-CAS receipt");
    }
    if (sealedLocal) {
      const receiptCore = { ...sealedLocal };
      const receiptDigest = receiptCore.receiptDigest;
      delete receiptCore.receiptDigest;
      if (sealedLocal.schema !== EFFECT_SCHEMA
        || sealedLocal.kind !== "local-cas"
        || digest(receiptDigest, "local-CAS effect receipt") !== receiptDigest
        || receiptDigest !== digestValue(receiptCore)
        || sealedLocal.targetLeaseDigest !== expectedLeaseDigest
        || sealedLocal.targetBindingDigest !== expected.binding.bindingDigest
        || sealedLocal.cloudAuthorityDigest !== digestValue(expected.authority)
        || digest(sealedLocal.targetProofDigest, "local-CAS task proof")
          !== sealedLocal.targetProofDigest
        || digest(
          sealedLocal.mutationAuthorityReceiptDigest,
          "local-CAS mutation-authority receipt",
        ) !== sealedLocal.mutationAuthorityReceiptDigest
        || (sealedLocal.registryRevision !== undefined
          && (!Number.isSafeInteger(sealedLocal.registryRevision)
            || sealedLocal.registryRevision < 1))) {
        invalid("exact sealed local-CAS receipt");
      }
    }
    if (observedLeaseDigest !== expectedLeaseDigest
      || observedLease.taskAuthority?.bindingDigest !== expected.binding.bindingDigest
      || digestValue(observedLease.taskAuthority) !== digestValue(expected.binding)
      || digestValue(observedLease.cloudAuthority) !== digestValue(expected.authority)
      || digestValue(observedLease.admission)
        !== digestValue(expected.lease.admission)
      || observedLease.baseSha !== plan.targetCanonicalBaseSha
      || observedLease.fenceSha !== plan.targetLaneRevision
      || observedLease.sessionId !== plan.operatorSessionId) {
      invalid("exact deterministic local target lease");
    }
    return Object.freeze({
      expected,
      observedLease,
      expectedLeaseDigest,
    });
  }

  function observeLocalProjection(plan, intent) {
    let exact;
    try {
      exact = exactLocalTargetProjection(plan, intent);
    } catch {
      return null;
    }
    const { expected, observedLease: lease, expectedLeaseDigest: leaseDigest } = exact;
    if (!observeRemoteReanchor(plan)) return null;
    assertTaskAuthorityBinding({ binding: lease.taskAuthority, lease });
    assertCapabilityMatchesBinding(expected.capability, lease.taskAuthority);
    const possession = proveLocalTarget(plan, expected, "target-reconcile");
    exactLocalTargetProjection(plan, intent);
    return effect("local-cas", {
      targetLeaseDigest: leaseDigest,
      targetBindingDigest: expected.binding.bindingDigest,
      targetProofDigest: possession.targetProofDigest,
      cloudAuthorityDigest: digestValue(expected.authority),
      mutationAuthorityReceiptDigest: possession.mutationAuthorityReceiptDigest,
    });
  }

  function observePullRequestMarker(plan, intent) {
    const initial = exactLocalTargetProjection(plan, intent, {
      requireLocalCasReceipt: true,
    });
    const expectedLease = initial.expected.lease;
    const expectedMarker = projectWriterLeasePullRequestMarker(expectedLease);
    const observed = withHeartbeatProjectionFence({
      leaseStore,
      branch,
      expectedLeaseDigest: initial.expectedLeaseDigest,
      expectedClaimId: expectedLease.cloudAuthority.claimId,
      action: () => {
        const fenced = exactLocalTargetProjection(plan, intent, {
          requireLocalCasReceipt: true,
        });
        const pull = openRecoveryPull(plan, fenced.expected.lease, false);
        exactLocalTargetProjection(plan, intent, {
          requireLocalCasReceipt: true,
        });
        const marker = parseWriterLeasePullRequestBody(pull.body);
        if (digestValue(marker) !== digestValue(expectedMarker)) return null;
        exactLocalTargetProjection(plan, intent, {
          requireLocalCasReceipt: true,
        });
        return effect("pr-marker", {
          pullRequestId: pull.id,
          markerDigest: digestValue(marker),
          bodyRemainderDigest: digestValue(writerLeaseBodyRemainder(pull.body)),
          targetLeaseDigest: initial.expectedLeaseDigest,
        });
      },
    });
    exactLocalTargetProjection(plan, intent, { requireLocalCasReceipt: true });
    return observed;
  }

  /*
   * The target lease above is intentionally reconstructed from the sealed bind
   * receipt. Fresh proof establishes possession/current cloud authority, but it
   * never supplies timestamps or other bytes to the persisted lease.
   */

  let activeFence = null;

  async function withFence(action) {
    if (typeof action !== "function") invalid("execution fence callback");
    if (activeFence) invalid("single active execution fence");
    let descriptor = null;
    activeFence = Object.freeze({
      acquire() {
        if (descriptor !== null) return;
        ensureStateDirectory(state.lock);
        try {
          descriptor = openSync(state.lock, "wx", 0o600);
          writeFileSync(descriptor, `${process.pid}\n`);
          fsyncSync(descriptor);
        } catch (error) {
          if (error?.code === "EEXIST") {
            throw new Error("Retired-abandoned owned-dirt recovery is already fenced.");
          }
          throw error;
        }
      },
    });
    try {
      activeFence.acquire();
      return await action();
    } finally {
      activeFence = null;
      if (descriptor !== null) closeSync(descriptor);
      if (descriptor !== null && existsSync(state.lock)) unlinkSync(state.lock);
    }
  }

  const adapter = {
    captureEvidence,
    withFence,
    readIntent() {
      return readJournal(state.journal);
    },
    writeIntent({ expected, value }) {
      if (!activeFence) invalid("fenced journal write");
      activeFence.acquire();
      return writeJournal(state.journal, expected, value);
    },
    authorizeSource({ plan }) {
      const lease = sourceGitStable(plan);
      sourceClosedPull(plan, lease);
      const proof = sourceAuthorityProof(plan, "source-authorized");
      return effect("source-authorized", {
        authoritySubjectId: proof.authoritySubjectId,
        generation: proof.generation,
        bindingDigest: proof.bindingDigest,
        proofDigest: proof.proofDigest,
        sourceAuthorizationReceiptDigest: proof.receiptDigest,
        verifiedAt: proof.verifiedAt,
      });
    },
    snapshot({ plan, intent }) {
      const sourceAuthorization = phaseValues(intent, "source-authorized");
      const lease = sourceGitStable(plan);
      if (sourceAuthorization.bindingDigest !== lease.taskAuthority.bindingDigest
        || sourceAuthorization.authoritySubjectId
          !== lease.taskAuthority.authoritySubjectId
        || sourceAuthorization.generation !== lease.taskAuthority.generation) {
        invalid("source authorization lineage before snapshot");
      }
      const snapshot = createRetiredAbandonedOwnedDirtSnapshotV2({
        repository,
        evidence: plan.evidence.dirt,
        claimId: plan.sourceClaimId,
        planDigest: plan.planDigest,
        timestamp: plan.evidence.sourceClaim.retiredAt,
        expectedIndexTreeSha: plan.sourceIndexTreeSha,
        expectedWorktreeTreeSha: plan.sourceWorktreeTreeSha,
      });
      sourceGitStable(plan);
      return snapshotEffect(snapshot);
    },
    prepareReanchor({ plan }) {
      sourceGitStable(plan);
      requireSnapshot(plan);
      const materialized = materializeProjectedReanchorObjects({
        repository,
        plan,
        git,
      });
      sourceGitStable(plan);
      return effect("reanchor-prepared", materialized);
    },
    reanchorLocal({ plan }) {
      sourceLeaseProjectionStable(plan);
      assertProtectedInputsCurrent(plan);
      requireSnapshot(plan);
      verifyMaterializedReanchorObjects({ repository, plan, git });
      convergeLocalReanchor({ repository, branch, plan, git });
      const observed = observeLocalReanchor(plan);
      if (!observed || remoteBranchHead() !== plan.sourceFenceSha) {
        invalid("exact local-only reanchor");
      }
      return observed;
    },
    reanchorRemote({ plan }) {
      const lease = sourceLeaseProjectionStable(plan);
      const local = observeLocalReanchor(plan);
      if (!local) invalid("local reanchor before remote reanchor");
      const initialPull = readPull(lease);
      const initialIdentity = repositoryIdentity(lease, initialPull);
      const remote = remoteBranchHead(initialIdentity.originFetchUrl);
      if (remote === plan.sourceFenceSha) {
        const pushPull = readPull(lease);
        const pushIdentity = repositoryIdentity(lease, pushPull);
        if (remoteBranchHead(pushIdentity.originFetchUrl) !== plan.sourceFenceSha) {
          invalid("exact remote source fence immediately before reanchor push");
        }
        git([
          "push",
          `--force-with-lease=refs/heads/${branch}:${plan.sourceFenceSha}`,
          pushIdentity.originPushUrl,
          `${plan.targetLaneRevision}:refs/heads/${branch}`,
        ]);
      } else if (remote !== plan.targetLaneRevision) {
        invalid("recognized remote reanchor state");
      }
      const observed = observeRemoteReanchor(plan);
      if (!observed) invalid("exact remote reanchor");
      return observed;
    },
    reopenPullRequest({ plan }) {
      sourceLeaseProjectionStable(plan);
      if (!observeRemoteReanchor(plan)) invalid("remote reanchor before pull-request reopen");
      waitForOwnershipPullRequestHead({
        url: plan.evidence.pullRequest.url,
        branch,
        expectedHeadSha: plan.targetLaneRevision,
        ghText: gh,
        requireOpen: false,
      });
      const before = reanchoredClosedPull(plan);
      gh(["pr", "reopen", before.url]);
      waitForOwnershipPullRequestHead({
        url: before.url,
        branch,
        expectedHeadSha: plan.targetLaneRevision,
        ghText: gh,
      });
      const after = openRecoveryPull(plan, sourceLeaseProjectionStable(plan));
      return effect("pr-reopened", {
        pullRequestId: after.id,
        pullRequestUrl: after.url,
        pullRequestNumber: plan.evidence.pullRequest.number,
        baseSha: after.baseRefOid,
        headSha: after.headRefOid,
        bodyDigest: digestValue(after.body || ""),
        bodyRemainderDigest: digestValue(writerLeaseBodyRemainder(after.body)),
      });
    },
    claimRecovery({ plan, operationKey }) {
      const lease = sourceLeaseProjectionStable(plan);
      if (!observeRemoteReanchor(plan)) invalid("remote reanchor before fresh claim");
      openRecoveryPull(plan, lease);
      const source = plan.evidence.sourceClaim;
      const result = invoke({
        action: "claim",
        ledgerRepository: lease.cloudAuthority.ledgerRepository,
        request: {
          targetRepository: lease.cloudAuthority.targetRepository,
          workItemId: source.workItemId,
          canonicalBaseSha: plan.targetCanonicalBaseSha,
          headSha: plan.targetLaneRevision,
          declaredWriteSet: plan.targetDeclaredWriteSet,
          leaseEpoch: plan.targetCloudLeaseEpoch,
          ttlSeconds: plan.ttlSeconds,
          deviceId: lease.device,
          sessionId: plan.operatorSessionId,
          idempotencyKey: operationKey,
        },
        environment,
      });
      const claim = result?.claim;
      if (result?.schema !== "agentic-cloud-collaboration-result/v1"
        || result.ok !== true
        || result.action !== "claim"
        || claim?.state !== "current"
        || claim.claimId === source.claimId
        || claim.canonicalBaseRevision !== plan.targetCanonicalBaseSha
        || claim.laneRevision !== plan.targetLaneRevision
        || claim.repositoryId !== source.repositoryId
        || claim.workItemId !== source.workItemId
        || claim.actorId !== source.actorId
        || claim.writeSetDigest !== plan.targetWriteSetDigest
        || canonicalJson(normalizeWriteSet(claim.declaredWriteScope))
          !== canonicalJson(plan.targetDeclaredWriteSet)
        || claim.leaseEpoch !== plan.targetCloudLeaseEpoch
        || claim.deviceId !== lease.device
        || claim.sessionId !== plan.operatorSessionId
        || claim.reviewRequestId !== null
        || claim.predecessorClaimId !== null) {
        invalid("fresh current-base recovery claim");
      }
      const observed = observeRecoveryClaim(plan, "current", null);
      if (!observed || observed.claim.claimId !== claim.claimId) {
        invalid("authoritative fresh recovery claim inventory");
      }
      return recoveryClaimEffect(plan, observed, operationKey);
    },
    bindRecovery({ plan, intent, operationKey }) {
      sourceLeaseProjectionStable(plan);
      const claimed = claimedValues(intent);
      const observed = observeRecoveryClaim(plan, "current", null);
      if (!observed
        || observed.claim.claimId !== claimed.claimId
        || observed.claim.fenceRevision !== claimed.claimDigest
        || observed.claim.transitionCounter !== claimed.transitionCounter) {
        invalid("current fresh recovery claim before binding");
      }
      const pull = openRecoveryPull(plan, plan.evidence.lease);
      const seed = authorityFromObserved(plan, observed);
      const bound = bindAdmissionCloudAuthority({
        authority: seed,
        manifest: targetManifest(plan),
        branch,
        headSha: plan.targetLaneRevision,
        pullRequestNumber: plan.evidence.pullRequest.number,
        reviewRequestId: plan.evidence.sourceClaim.reviewRequestId,
        deviceId: plan.evidence.lease.device,
        sessionId: plan.operatorSessionId,
        idempotencyKey: operationKey,
        returnVerification: true,
        environment,
        invoke,
        inspect: invoke,
        verify,
      });
      if (pull.id !== plan.evidence.pullRequest.id
        || bound.authority.reviewRequestId
          !== plan.evidence.sourceClaim.reviewRequestId) {
        invalid("same pull-request recovery binding");
      }
      const confirmed = observeRecoveryClaim(
        plan,
        "active",
        plan.evidence.sourceClaim.reviewRequestId,
      ) || observeRecoveryClaim(
        plan,
        "current",
        plan.evidence.sourceClaim.reviewRequestId,
      );
      if (!confirmed || confirmed.claim.claimId !== claimed.claimId) {
        invalid("authoritative recovery bind inventory");
      }
      const effectValue = verifyBoundObserved(plan, confirmed, operationKey, claimed);
      if (digestValue(effectValue.authority) !== digestValue(bound.authority)) {
        invalid("bound recovery authority/status join");
      }
      return effectValue;
    },
    projectLocal({ plan, intent }) {
      const existing = observeLocalProjection(plan, intent);
      if (existing) return existing;
      const target = createLocalTarget(plan, intent);
      const sourceAuthorization = phaseValues(intent, "source-authorized");
      if (sourceAuthorization.bindingDigest
          !== plan.evidence.lease.taskAuthority.bindingDigest) {
        invalid("source proof before target handoff");
      }
      const result = mutateWriterLeaseRegistry({
        leaseStore,
        branch,
        expectedLeaseDigest: plan.sourceLeaseDigest,
        expectedClaimId: plan.sourceClaimId,
        action: ({ registry, lease }) => {
          if (writerLeaseDigest(lease) !== plan.sourceLeaseDigest
            || lease.epoch !== plan.writerLeaseEpoch
            || lease.branch !== branch
            || realpathSync(path.resolve(lease.worktreePath || "")) !== repository) {
            invalid("source lease full-registry CAS");
          }
          return {
            registry: {
              ...registry,
              leases: { ...registry.leases, [branch]: target.lease },
            },
            lease: target.lease,
            changed: true,
          };
        },
      });
      if (writerLeaseDigest(result.lease) !== writerLeaseDigest(target.lease)) {
        invalid("target lease CAS projection");
      }
      return effect("local-cas", {
        targetLeaseDigest: writerLeaseDigest(result.lease),
        targetBindingDigest: target.binding.bindingDigest,
        targetProofDigest: target.targetProofDigest,
        cloudAuthorityDigest: digestValue(result.lease.cloudAuthority),
        mutationAuthorityReceiptDigest: target.mutationAuthorityReceiptDigest,
        registryRevision: result.registryRevision,
      });
    },
    projectPullRequestMarker({ plan, intent }) {
      const local = observeLocalProjection(plan, intent);
      if (!local) invalid("local target before pull-request marker");
      const initial = exactLocalTargetProjection(plan, intent, {
        requireLocalCasReceipt: true,
      });
      const expectedLease = initial.expected.lease;
      const expectedMarker = projectWriterLeasePullRequestMarker(expectedLease);
      beforePullRequestMarkerProjectionFence({
        plan,
        intent,
        expectedLeaseDigest: initial.expectedLeaseDigest,
        expectedClaimId: expectedLease.cloudAuthority.claimId,
      });
      withHeartbeatProjectionFence({
        leaseStore,
        branch,
        expectedLeaseDigest: initial.expectedLeaseDigest,
        expectedClaimId: expectedLease.cloudAuthority.claimId,
        action: () => {
          exactLocalTargetProjection(plan, intent, {
            requireLocalCasReceipt: true,
          });
          const before = openRecoveryPull(plan, null, false);
          const stable = exactLocalTargetProjection(plan, intent, {
            requireLocalCasReceipt: true,
          });
          const existingMarker = parseWriterLeasePullRequestBody(before.body);
          if (digestValue(existingMarker) !== digestValue(expectedMarker)) {
            const intended = updateWriterLeasePullRequestBody(
              before.body,
              stable.expected.lease,
            );
            exactLocalTargetProjection(plan, intent, {
              requireLocalCasReceipt: true,
            });
            gh(["pr", "edit", before.url, "--body", intended]);
          }
          exactLocalTargetProjection(plan, intent, {
            requireLocalCasReceipt: true,
          });
        },
      });
      const observed = observePullRequestMarker(plan, intent);
      if (!observed) invalid("target pull-request marker projection");
      return observed;
    },
    verifyTerminal({ plan, intent }) {
      const local = observeLocalProjection(plan, intent);
      if (!local) invalid("terminal local target authority");
      const markerProjection = observePullRequestMarker(plan, intent);
      if (!markerProjection) invalid("terminal exact pull-request marker projection");
      requireSnapshot(plan);
      verifyMaterializedReanchorObjects({ repository, plan, git });
      if (!observeRemoteReanchor(plan)) invalid("terminal local and remote reanchor");
      git(["merge-base", "--is-ancestor", plan.targetCanonicalBaseSha,
        plan.targetLaneRevision]);
      const exact = exactLocalTargetProjection(plan, intent, {
        requireLocalCasReceipt: true,
      });
      const lease = exact.expected.lease;
      const pull = openRecoveryPull(plan, lease, false);
      const marker = parseWriterLeasePullRequestBody(pull.body);
      if (digestValue(marker)
          !== digestValue(projectWriterLeasePullRequestMarker(lease))) {
        invalid("terminal pull-request marker");
      }
      const observed = observeRecoveryClaim(
        plan,
        "active",
        plan.evidence.sourceClaim.reviewRequestId,
      ) || observeRecoveryClaim(
        plan,
        "current",
        plan.evidence.sourceClaim.reviewRequestId,
      );
      if (!observed || observed.claim.claimId !== lease.cloudAuthority.claimId
        || observed.claim.reviewRequestId
          !== plan.evidence.sourceClaim.reviewRequestId) {
        invalid("terminal fresh cloud authority");
      }
      const target = deterministicLocalTarget(plan, intent);
      const possession = proveLocalTarget(plan, target, "target-terminal");
      exactLocalTargetProjection(plan, intent, { requireLocalCasReceipt: true });
      const terminalCore = {
        schema: "agentic-retired-abandoned-owned-dirt-successor-recovery-terminal/v1",
        status: "mutation-authority-restored",
        planDigest: plan.planDigest,
        recoveryClaimId: lease.cloudAuthority.claimId,
        leaseDigest: writerLeaseDigest(lease),
        cloudAuthorityDigest: digestValue(lease.cloudAuthority),
        taskAuthorityBindingDigest: lease.taskAuthority.bindingDigest,
        targetDirtEvidenceDigest: plan.targetDirtEvidenceDigest,
        coordinationCommitSha: plan.coordinationCommitSha,
        snapshotRef: retiredAbandonedSnapshotRef({
          claimId: plan.sourceClaimId,
          planDigest: plan.planDigest,
        }),
        markerDigest: digestValue(marker),
        pullRequestId: pull.id,
      };
      return effect("terminal", {
        ...terminalCore,
        terminalEvidenceDigest: digestValue(terminalCore),
        mutationAuthorityReceiptDigest: possession.mutationAuthorityReceiptDigest,
      });
    },
    reconcile({ plan, intent, phase, operationKey }) {
      try {
        if (phase === "source-authorized") return null;
        if (phase === "snapshotted") return snapshotEffect(requireSnapshot(plan));
        if (phase === "reanchor-prepared") return observePrepared(plan);
        if (phase === "local-reanchored") return observeLocalReanchor(plan);
        if (phase === "remote-reanchored") return observeRemoteReanchor(plan);
        if (phase === "pr-reopened") {
          const pull = openRecoveryPull(plan, plan.evidence.lease);
          return effect("pr-reopened", {
            pullRequestId: pull.id,
            pullRequestUrl: pull.url,
            pullRequestNumber: plan.evidence.pullRequest.number,
            baseSha: pull.baseRefOid,
            headSha: pull.headRefOid,
            bodyDigest: digestValue(pull.body || ""),
            bodyRemainderDigest: digestValue(writerLeaseBodyRemainder(pull.body)),
          });
        }
        if (phase === "recovery-claimed") {
          const observed = observeRecoveryClaim(plan, "current", null);
          return observed ? recoveryClaimEffect(plan, observed, operationKey) : null;
        }
        if (phase === "recovery-bound") {
          const claimed = claimedValues(intent);
          const observed = observeRecoveryClaim(
            plan,
            "active",
            plan.evidence.sourceClaim.reviewRequestId,
          ) || observeRecoveryClaim(
            plan,
            "current",
            plan.evidence.sourceClaim.reviewRequestId,
          );
          if (!observed
            || observed.claim.claimId !== claimed.claimId
            || observed.claim.reviewRequestId
            !== plan.evidence.sourceClaim.reviewRequestId) return null;
          return verifyBoundObserved(
            plan,
            observed,
            operationKey,
            claimed,
          );
        }
        if (phase === "local-cas") return observeLocalProjection(plan, intent);
        if (phase === "pr-marker") {
          const local = observeLocalProjection(plan, intent);
          if (!local) return null;
          return observePullRequestMarker(plan, intent);
        }
        if (phase === "verified") return adapter.verifyTerminal({ plan, intent });
      } catch {
        return null;
      }
      return null;
    },
  };

  function requireSnapshot(plan) {
    return verifyRetiredAbandonedOwnedDirtSnapshotV2({
      repository,
      snapshot: {
        snapshotRef: retiredAbandonedSnapshotRef({
          claimId: plan.sourceClaimId,
          planDigest: plan.planDigest,
        }),
        planDigest: plan.planDigest,
        claimId: plan.sourceClaimId,
        headSha: plan.sourceFenceSha,
        evidence: plan.evidence.dirt,
        expectedIndexTreeSha: plan.sourceIndexTreeSha,
        expectedWorktreeTreeSha: plan.sourceWorktreeTreeSha,
        timestamp: plan.evidence.sourceClaim.retiredAt,
      },
    });
  }

  return Object.freeze(adapter);
}

export function assertRetiredAbandonedOwnedDirtRepositoryIdentity({
  targetRepository,
  originFetchUrl,
  originPushUrl = originFetchUrl,
  pullRequest,
  branch,
} = {}) {
  const target = githubRepositoryName(targetRepository, "target repository");
  const fetchUrl = required(originFetchUrl, "origin fetch URL");
  const pushUrl = required(originPushUrl, "origin push URL");
  const fetchRepository = githubRepositoryFromRemote(fetchUrl);
  const pushRepository = githubRepositoryFromRemote(pushUrl);
  const pull = pullRequest && typeof pullRequest === "object"
    ? pullRequest : (() => { invalid("pull-request repository identity"); })();
  const pullUrl = required(pull.url, "pull-request URL");
  const pullRepository = githubRepositoryFromPullRequestUrl(pullUrl);
  const headRepository = githubRepositoryValue(
    pull.headRepository,
    "pull-request head repository",
  );
  const baseRepository = pull.baseRepository === undefined
    ? pullRepository
    : githubRepositoryValue(
      pull.baseRepository,
      "pull-request base repository",
    );
  const headRefName = required(pull.headRefName, "pull-request head branch");
  const baseRefName = required(pull.baseRefName, "pull-request base branch");
  const expectedBranch = required(branch, "source branch");
  if (fetchRepository !== target
    || pushRepository !== target
    || pullRepository !== target
    || headRepository !== target
    || baseRepository !== target
    || headRefName !== expectedBranch
    || baseRefName !== "main") {
    invalid("joined target origin and pull-request repository identity");
  }
  const core = {
    schema:
      "agentic-retired-abandoned-owned-dirt-repository-identity-witness/v1",
    targetRepository: target,
    originFetchUrl: fetchUrl,
    originFetchRepository: fetchRepository,
    originPushUrl: pushUrl,
    originPushRepository: pushRepository,
    pullRequestUrl: pullUrl,
    pullRequestRepository: pullRepository,
    headRepository,
    baseRepository,
    headRefName,
    baseRefName,
  };
  return Object.freeze({ ...core, identityDigest: digestValue(core) });
}

export function buildRetiredAbandonedOwnedDirtDeterministicTargetLease({
  plan,
  sourceLease = plan?.evidence?.lease,
  bound,
  claimed,
  targetCapability,
} = {}) {
  const source = sourceLease;
  const boundAuthority = bound?.authority;
  const sealedVerification = bound?.verification;
  if (writerLeaseDigest(source) !== plan?.sourceLeaseDigest
    || source.cloudAuthority?.claimId !== plan.sourceClaimId
    || source.baseSha !== plan.sourceBaseSha
    || source.fenceSha !== plan.sourceFenceSha
    || source.epoch !== plan.writerLeaseEpoch) {
    invalid("sealed source lease for deterministic target projection");
  }
  assertTaskAuthorityBinding({ binding: source.taskAuthority, lease: source });
  if (!boundAuthority
    || boundAuthority.claimId !== claimed?.claimId
    || boundAuthority.canonicalBaseSha !== plan.targetCanonicalBaseSha
    || boundAuthority.laneRevision !== plan.targetLaneRevision
    || boundAuthority.writeSetDigest !== plan.targetWriteSetDigest
    || canonicalJson(normalizeWriteSet(boundAuthority.cloudDeclaredWriteScope))
      !== canonicalJson(plan.targetDeclaredWriteSet)
    || boundAuthority.leaseEpoch !== plan.targetCloudLeaseEpoch
    || boundAuthority.reviewRequestId !== plan.evidence.sourceClaim.reviewRequestId
    || boundAuthority.expiresAt !== claimed?.expiresAt
    || boundAuthority.transitionCounter !== claimed?.transitionCounter + 1
    || boundAuthority.state !== "active"
    || boundAuthority.deviceId !== source.device
    || boundAuthority.sessionId !== plan.operatorSessionId
    || boundAuthority.manifestDigest !== plan.targetManifestDigest
    || boundAuthority.ledgerRepository !== source.cloudAuthority.ledgerRepository
    || boundAuthority.targetRepository !== source.cloudAuthority.targetRepository
    || digest(boundAuthority.claimDigest, "bound recovery claim digest")
      !== boundAuthority.claimDigest
    || sha(boundAuthority.ledgerRevision, "bound recovery ledger revision")
      !== boundAuthority.ledgerRevision
    || digest(boundAuthority.ledgerDigest, "bound recovery ledger digest")
      !== boundAuthority.ledgerDigest
    || digest(
      boundAuthority.claimLedgerRevision,
      "bound recovery claim ledger revision",
    ) !== boundAuthority.claimLedgerRevision
    || digest(
      boundAuthority.operationReceiptDigest,
      "bound recovery operation receipt",
    ) !== boundAuthority.operationReceiptDigest
    || !Number.isSafeInteger(boundAuthority.transitionCounter)
    || boundAuthority.transitionCounter < 1
    || !Number.isFinite(Date.parse(boundAuthority.expiresAt))
    || sealedVerification?.schema !== "agentic-lane-cloud-verification/v1"
    || sealedVerification.status !== "ready"
    || sealedVerification.claimId !== boundAuthority.claimId
    || sealedVerification.claimDigest !== boundAuthority.claimDigest
    || sealedVerification.ledgerRevision !== boundAuthority.ledgerRevision
    || sealedVerification.ledgerDigest !== boundAuthority.ledgerDigest
    || sealedVerification.canonicalBaseSha !== plan.targetCanonicalBaseSha
    || sealedVerification.laneRevision !== plan.targetLaneRevision
    || sealedVerification.writeSetDigest !== plan.targetWriteSetDigest
    || sealedVerification.reviewRequestId
      !== plan.evidence.sourceClaim.reviewRequestId
    || bound.verificationReceiptDigest !== sealedVerification.receiptDigest
    || bound.verifiedAt !== sealedVerification.verifiedAt
    || digest(
      sealedVerification.receiptDigest,
      "sealed recovery verification receipt",
    ) !== sealedVerification.receiptDigest
    || requiredInstant(
      sealedVerification.verifiedAt,
      "sealed recovery verification time",
    ) !== sealedVerification.verifiedAt) {
    invalid("bound fresh recovery authority");
  }
  const capability = targetCapability;
  const projection = projectTaskAuthorityCapability(capability);
  if (digestValue(projection) !== plan.targetCapabilityDigest) {
    invalid("sealed target task-authority capability");
  }
  const admission = successorAdmission({
    source: source.admission,
    plan,
    authority: boundAuthority,
  });
  const projectedAt = sealedVerification.verifiedAt;
  const targetCore = {
    ...source,
    baseSha: plan.targetCanonicalBaseSha,
    fenceSha: plan.targetLaneRevision,
    sessionId: plan.operatorSessionId,
    admission,
    cloudAuthority: boundAuthority,
    heartbeatAt: projectedAt,
    expiresAt: boundAuthority.expiresAt,
  };
  const binding = createTaskAuthorityBinding({
    capability,
    lease: targetCore,
    bindingMode: "handoff",
    boundAt: projectedAt,
    transitionPlanDigest: plan.planDigest,
    priorBindingDigest: source.taskAuthority.bindingDigest,
  });
  const lease = Object.freeze({ ...targetCore, taskAuthority: binding });
  assertTaskAuthorityBinding({ binding, lease });
  return Object.freeze({
    lease,
    binding,
    authority: boundAuthority,
    sealedVerification,
    capability,
  });
}

export function assertRetiredAbandonedOwnedDirtCloudStatusSnapshot({
  result,
  snapshot,
  repositoryId,
  evaluationTime = new Date().toISOString(),
} = {}) {
  const repository = required(repositoryId, "status repository identity");
  if (!hasExactKeys(result, [
    "action",
    "claims",
    "ledgerDigest",
    "ledgerRevision",
    "ok",
    "schema",
    "sequence",
    "status",
  ])
    || result.schema !== "agentic-cloud-collaboration-result/v1"
    || result.ok !== true
    || result.action !== "status"
    || result.status !== "ready"
    || !Array.isArray(result.claims)
    || result.claims.length > 128
    || !Number.isSafeInteger(result.sequence)
    || result.sequence < 1) {
    invalid("complete cloud claim inventory");
  }
  sha(result.ledgerRevision, "status ledger revision");
  digest(result.ledgerDigest, "status ledger digest");
  const ledger = snapshot?.ledger;
  const failures = validateLedger(ledger);
  if (failures.length > 0
    || sha(snapshot?.ledgerRevision, "authenticated ledger revision")
      !== result.ledgerRevision
    || ledger.headDigest !== result.ledgerDigest
    || ledger.sequence !== result.sequence) {
    invalid("status/authenticated ledger head join");
  }
  const evaluatedAt = requiredInstant(evaluationTime, "status evaluation time");
  const expectedClaimIds = listCurrentClaims(ledger, evaluatedAt, {
    repositoryId: repository,
  }).map(claim => claim.claimId).sort();
  const observedClaimIds = result.claims.map(claim => authenticatedPublicClaim({
    claim,
    ledger,
    repositoryId: repository,
  }).claimId).sort();
  if (new Set(observedClaimIds).size !== observedClaimIds.length
    || canonicalJson(observedClaimIds) !== canonicalJson(expectedClaimIds)) {
    invalid("complete authenticated repository claim inventory");
  }
  return result;
}

function authenticatedPublicClaim({ claim, ledger, repositoryId }) {
  if (!hasExactKeys(claim, [
    "actorId",
    "canonicalBaseRevision",
    "claimId",
    "claimIdentitySchema",
    "declaredWriteScope",
    "deviceId",
    "entrySchema",
    "expiresAt",
    "fenceRevision",
    "heartbeatCounter",
    "integration",
    "integrationReceiptDigest",
    "laneRevision",
    "leaseEpoch",
    "operationReceiptDigest",
    "predecessorClaimId",
    "recovery",
    "repositoryId",
    "reviewRequestId",
    "scopeReserved",
    "sessionId",
    "state",
    "transitionCounter",
    "transitionDigest",
    "workItemId",
    "writeAuthority",
    "writeSetDigest",
  ])
    || digest(claim.claimId, "status claim ID") !== claim.claimId
    || claim.repositoryId !== repositoryId
    || !Array.isArray(claim.declaredWriteScope)
    || canonicalJson(normalizeWriteSet(claim.declaredWriteScope))
      !== canonicalJson(claim.declaredWriteScope)) {
    invalid("authenticated public cloud claim");
  }
  const history = ledger.entries.filter(entry => entry.claimId === claim.claimId);
  const latest = history.at(-1);
  const identity = history.find(entry => entry.action === "claim");
  const core = latest?.claimCore;
  const recordedState = projectedClaimState(core?.state);
  const admissibleStates = new Set([
    recordedState,
    ...(["current", "reviewed", "integrated-preserved"].includes(recordedState)
      ? ["dormant-preserved"] : []),
  ]);
  const writeAuthority = claim.state === "current";
  const scopeReserved = [
    "current",
    "reviewed",
    "integrated-preserved",
    "dormant-preserved",
  ].includes(claim.state);
  const integrationEntry = history.findLast(entry => entry.action === "integrate");
  const integrationReceiptDigest = integrationEntry
    ? operationReceiptForEntry(integrationEntry).receiptDigest
    : null;
  const fields = [
    "actorId",
    "deviceId",
    "sessionId",
    "repositoryId",
    "workItemId",
    "canonicalBaseRevision",
    "laneRevision",
    "writeSetDigest",
    "leaseEpoch",
    "transitionCounter",
    "heartbeatCounter",
    "reviewRequestId",
    "predecessorClaimId",
    "expiresAt",
  ];
  if (!latest || !identity || !core
    || fields.some(field => claim[field] !== core[field])
    || claim.entrySchema !== latest.schema
    || claim.claimIdentitySchema !== identity.schema
    || !admissibleStates.has(claim.state)
    || claim.writeAuthority !== writeAuthority
    || claim.scopeReserved !== scopeReserved
    || claim.fenceRevision !== latest.claimDigest
    || claim.transitionDigest !== latest.digest
    || canonicalJson(claim.declaredWriteScope)
      !== canonicalJson(normalizeWriteSet(core.declaredWriteScope))
    || canonicalJson(claim.integration) !== canonicalJson(core.integration ?? null)
    || canonicalJson(claim.recovery) !== canonicalJson(core.recovery ?? null)
    || claim.integrationReceiptDigest !== integrationReceiptDigest
    || claim.operationReceiptDigest !== operationReceiptForEntry(latest).receiptDigest
    || digest(claim.fenceRevision, "status claim fence") !== claim.fenceRevision
    || digest(claim.transitionDigest, "status claim transition")
      !== claim.transitionDigest
    || digest(claim.operationReceiptDigest, "status claim receipt")
      !== claim.operationReceiptDigest
    || sha(claim.canonicalBaseRevision, "status claim base")
      !== claim.canonicalBaseRevision
    || sha(claim.laneRevision, "status claim lane") !== claim.laneRevision
    || !Number.isSafeInteger(claim.leaseEpoch)
    || claim.leaseEpoch < 1
    || !Number.isSafeInteger(claim.transitionCounter)
    || claim.transitionCounter < 1
    || !Number.isSafeInteger(claim.heartbeatCounter)
    || claim.heartbeatCounter < 0
    || !Number.isFinite(Date.parse(claim.expiresAt))) {
    invalid("public cloud claim/ledger entry join");
  }
  return claim;
}

function operationReceiptForEntry(entry) {
  const legacy = entry.schema === LEGACY_ENTRY_SCHEMA;
  const status = projectedClaimState(entry.claimCore?.state);
  const core = legacy ? {
    schema: RECEIPT_SCHEMA,
    action: entry.action,
    repositoryId: entry.repositoryId,
    claimId: entry.claimId,
    claimDigest: entry.claimDigest,
    fenceRevision: entry.claimDigest,
    ledgerRevision: entry.digest,
    ledgerSequence: entry.sequence,
    idempotencyKey: entry.idempotencyKey,
    requestDigest: entry.requestDigest,
    evaluationTime: entry.evaluationTime,
  } : {
    schema: ({
      claim: "agentic-collaboration-claim-receipt/v1",
      continue: "agentic-collaboration-continuation-receipt/v1",
      integrate: "agentic-collaboration-integration-receipt/v1",
      retire: "agentic-collaboration-retirement-receipt/v1",
    })[entry.action],
    operation: entry.action,
    status,
    repositoryId: entry.repositoryId,
    claimId: entry.claimId,
    claimDigest: entry.claimDigest,
    fenceRevision: entry.claimDigest,
    ledgerRevision: entry.digest,
    ledgerSequence: entry.sequence,
    idempotencyKey: entry.idempotencyKey,
    requestDigest: entry.requestDigest,
    evaluationTime: entry.evaluationTime,
  };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}

function projectedClaimState(value) {
  if (value === "active") return "current";
  if (["review-ready", "delivery-authorized"].includes(value)) return "reviewed";
  if (["parked", "expired"].includes(value)) return "dormant-preserved";
  if (value === "released") return "retired";
  return value;
}

function hasExactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  return actual.length === keys.length
    && actual.every((item, index) => item === keys[index]);
}

export function projectRetiredAbandonedOwnedDirtCurrentBaseReanchor({
  repository,
  dirt,
  sourceFence,
  targetProtectedMain,
  sourceClaim,
  ignoredRetention,
  git = createGit(repository),
} = {}) {
  const root = realpathSync(path.resolve(required(repository, "repository")));
  const source = normalizeActiveOwnedDirtEvidence(dirt);
  const fence = sha(sourceFence?.headSha, "projection source fence");
  const base = sha(sourceFence?.parentSha, "projection source base");
  const protectedMain = sha(
    targetProtectedMain?.protectedMainSha,
    "projection protected main",
  );
  if (source.headSha !== fence
    || sourceFence.treeSha !== sourceFence.baseTreeSha
    || targetProtectedMain.sourceBaseSha !== base) {
    invalid("projection source fence/base join");
  }
  const before = captureActiveOwnedDirtEvidence({ repository: root });
  requireSameActiveOwnedDirtEvidence(source, before);
  const temporary = mkdtempSync(path.join(os.tmpdir(), "agentic-reanchor-plan-"));
  const objectDirectory = path.join(temporary, "objects");
  mkdirSync(objectDirectory, { mode: 0o700 });
  const sourceObjectDirectory = path.resolve(
    root,
    git(["rev-parse", "--path-format=absolute", "--git-path", "objects"]),
  );
  const isolatedEnvironment = {
    GIT_OBJECT_DIRECTORY: objectDirectory,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: sourceObjectDirectory,
  };
  try {
    const baseEntries = readTreeMap(git, base, isolatedEnvironment);
    const protectedEntries = readTreeMap(git, protectedMain, isolatedEnvironment);
    const dirtByPath = new Map(source.entries.map(entry => [entry.path, entry]));
    const paths = [...new Set([
      ...targetProtectedMain.changedPaths,
      ...source.entries.map(entry => entry.path),
    ])].sort(compareCorePaths);
    const dispositions = paths.map(relativePath => {
      const dirtEntry = dirtByPath.get(relativePath) || null;
      const baseEntry = gitEntry(baseEntries.get(relativePath));
      const protectedEntry = gitEntry(protectedEntries.get(relativePath));
      const sourceIndex = dirtEntry
        ? gitEntry({ mode: dirtEntry.indexMode, blob: dirtEntry.indexBlob })
        : baseEntry;
      const sourceWorktree = dirtEntry
        ? worktreeEntry({
          type: dirtEntry.worktreeType,
          mode: dirtEntry.worktreeMode,
          blob: dirtEntry.worktreeBlob,
        })
        : worktreeFromGitEntry(baseEntry);
      if (dirtEntry && !sameGitEntry(baseEntry, {
        mode: dirtEntry.headMode,
        blob: dirtEntry.headBlob,
      })) {
        invalid(`projection dirt HEAD entry for ${relativePath}`);
      }
      const indexDisposition = sameGitEntry(sourceIndex, baseEntry)
        ? "protected" : "source";
      const worktreeDisposition = sameWorktreeEntry(
        sourceWorktree,
        worktreeFromGitEntry(baseEntry),
      ) ? "protected" : "source";
      const targetIndex = indexDisposition === "source"
        ? sourceIndex : protectedEntry;
      const targetWorktree = worktreeDisposition === "source"
        ? sourceWorktree : worktreeFromGitEntry(protectedEntry);
      return Object.freeze({
        path: relativePath,
        base: baseEntry,
        protected: protectedEntry,
        sourceIndex,
        sourceWorktree,
        targetIndex,
        targetWorktree,
        indexDisposition,
        worktreeDisposition,
      });
    });
    assertProjectedFilesystemPathSafety({
      seedEntries: baseEntries,
      entries: source.entries.map(entry => ({
        path: entry.path,
        mode: entry.indexMode,
        blob: entry.indexBlob,
      })),
      pathComparison: ignoredRetention?.pathComparison,
      label: "source index overlay",
    });
    assertProjectedFilesystemPathSafety({
      seedEntries: baseEntries,
      entries: source.entries.map(entry => ({
        path: entry.path,
        mode: entry.worktreeMode,
        blob: entry.worktreeBlob,
      })),
      pathComparison: ignoredRetention?.pathComparison,
      label: "source worktree overlay",
    });
    assertProjectedFilesystemPathSafety({
      seedEntries: protectedEntries,
      entries: dispositions.map(item => ({
        path: item.path,
        mode: item.targetIndex.mode,
        blob: item.targetIndex.blob,
      })),
      pathComparison: ignoredRetention?.pathComparison,
      label: "target index overlay",
    });
    assertProjectedFilesystemPathSafety({
      seedEntries: protectedEntries,
      entries: dispositions.map(item => ({
        path: item.path,
        mode: item.targetWorktree.mode,
        blob: item.targetWorktree.blob,
      })),
      pathComparison: ignoredRetention?.pathComparison,
      label: "target worktree overlay",
    });
    writeEvidenceWorktreeBlobs({
      repository: root,
      evidence: source,
      git,
      environment: isolatedEnvironment,
    });
    const sourceIndexTreeSha = buildTreeFromEntries({
      git,
      temporary,
      name: "source-index",
      seedTree: base,
      entries: source.entries.map(entry => ({
        path: entry.path,
        mode: entry.indexMode,
        blob: entry.indexBlob,
      })),
      environment: isolatedEnvironment,
    });
    const sourceWorktreeTreeSha = buildTreeFromEntries({
      git,
      temporary,
      name: "source-worktree",
      seedTree: base,
      entries: source.entries.map(entry => ({
        path: entry.path,
        mode: entry.worktreeMode,
        blob: entry.worktreeBlob,
      })),
      environment: isolatedEnvironment,
    });
    const targetIndexTreeSha = buildTreeFromEntries({
      git,
      temporary,
      name: "target-index",
      seedTree: protectedMain,
      entries: dispositions.map(item => ({
        path: item.path,
        mode: item.targetIndex.mode,
        blob: item.targetIndex.blob,
      })),
      environment: isolatedEnvironment,
    });
    const targetWorktreeTreeSha = buildTreeFromEntries({
      git,
      temporary,
      name: "target-worktree",
      seedTree: protectedMain,
      entries: dispositions.map(item => ({
        path: item.path,
        mode: item.targetWorktree.mode,
        blob: item.targetWorktree.blob,
      })),
      environment: isolatedEnvironment,
    });
    const coordination = buildDeterministicCoordinationCommit({
      sourceFenceSha: fence,
      protectedMainSha: protectedMain,
      protectedMainTreeSha: targetProtectedMain.treeSha,
      sourceClaimId: sourceClaim?.claimId,
      dirtEvidenceDigest: source.evidenceDigest,
      timestamp: sourceClaim?.retiredAt,
    });
    const commitSha = sha(git([
      "commit-tree", coordination.treeSha,
      "-p", coordination.parents[0],
      "-p", coordination.parents[1],
    ], {
      input: coordination.message,
      env: { ...isolatedEnvironment, ...coordinationCommitEnvironment(coordination) },
    }), "projected coordination commit");
    if (commitSha !== coordination.commitSha) {
      invalid("deterministic coordination commit projection");
    }
    const targetDirt = buildTargetDirtEvidence({
      headSha: coordination.commitSha,
      dispositions,
    });
    assertTreeProjection({
      git,
      baseTree: base,
      projectedTree: sourceIndexTreeSha,
      entries: source.entries.map(entry => ({
        path: entry.path, mode: entry.indexMode, blob: entry.indexBlob,
      })),
      environment: isolatedEnvironment,
    });
    assertTreeProjection({
      git,
      baseTree: base,
      projectedTree: sourceWorktreeTreeSha,
      entries: source.entries.map(entry => ({
        path: entry.path, mode: entry.worktreeMode, blob: entry.worktreeBlob,
      })),
      environment: isolatedEnvironment,
    });
    assertTreeProjection({
      git,
      baseTree: protectedMain,
      projectedTree: targetIndexTreeSha,
      entries: dispositions.map(item => ({
        path: item.path, mode: item.targetIndex.mode, blob: item.targetIndex.blob,
      })),
      environment: isolatedEnvironment,
    });
    assertTreeProjection({
      git,
      baseTree: protectedMain,
      projectedTree: targetWorktreeTreeSha,
      entries: dispositions.map(item => ({
        path: item.path, mode: item.targetWorktree.mode, blob: item.targetWorktree.blob,
      })),
      environment: isolatedEnvironment,
    });
    const after = captureActiveOwnedDirtEvidence({ repository: root });
    requireSameActiveOwnedDirtEvidence(source, after);
    if (git(["rev-parse", "HEAD"]) !== fence
      || git(["rev-parse", "--verify", `refs/heads/${git(["branch", "--show-current"])}`])
        !== fence) {
      invalid("read-only projection ref preservation");
    }
    return Object.freeze({
      schema: REANCHOR_PROJECTION_SCHEMA,
      coordination,
      sourceIndexTreeSha,
      sourceWorktreeTreeSha,
      targetIndexTreeSha,
      targetWorktreeTreeSha,
      dispositions,
      ignoredRetention,
      targetDirt,
    });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function buildTargetDirtEvidence({ headSha, dispositions }) {
  const entries = dispositions.map(item => {
    const staged = !sameGitEntry(item.protected, item.targetIndex);
    const untracked = !item.protected.mode
      && !item.targetIndex.mode
      && item.targetWorktree.type !== "deleted";
    const unstaged = !untracked
      && !sameGitEntry(item.targetIndex, item.targetWorktree);
    if (!staged && !unstaged && !untracked) return null;
    return Object.freeze({
      path: item.path,
      staged,
      unstaged,
      untracked,
      headMode: item.protected.mode,
      headBlob: item.protected.blob,
      indexMode: item.targetIndex.mode,
      indexBlob: item.targetIndex.blob,
      worktreeType: item.targetWorktree.type,
      worktreeMode: item.targetWorktree.mode,
      worktreeBlob: item.targetWorktree.blob,
    });
  }).filter(Boolean).sort((left, right) => compareCorePaths(left.path, right.path));
  const core = {
    schema: ACTIVE_OWNED_DIRT_EVIDENCE_SCHEMA,
    headSha,
    entries,
    pathCount: entries.length,
    stagedPathCount: entries.filter(entry => entry.staged).length,
    unstagedPathCount: entries.filter(entry => entry.unstaged).length,
    untrackedPathCount: entries.filter(entry => entry.untracked).length,
  };
  return normalizeActiveOwnedDirtEvidence({
    ...core,
    evidenceDigest: digestValue(core),
  });
}

export function retiredAbandonedSnapshotRef({ claimId, planDigest } = {}) {
  return `refs/agentic-canvas-os/recovery/retired-abandoned-owned-dirt/${
    digest(claimId, "snapshot claim ID")}/${digest(planDigest, "snapshot plan digest")}`;
}

export function createRetiredAbandonedOwnedDirtSnapshotV2({
  repository,
  evidence,
  claimId,
  planDigest,
  timestamp,
  expectedIndexTreeSha = null,
  expectedWorktreeTreeSha = null,
  git = createGit(repository),
} = {}) {
  const root = realpathSync(path.resolve(required(repository, "snapshot repository")));
  const source = normalizeActiveOwnedDirtEvidence(evidence);
  const claim = digest(claimId, "snapshot claim ID");
  const plan = digest(planDigest, "snapshot plan digest");
  const instant = requiredInstant(timestamp, "snapshot timestamp");
  requireSameActiveOwnedDirtEvidence(
    source,
    captureActiveOwnedDirtEvidence({ repository: root }),
  );
  const temporary = mkdtempSync(path.join(os.tmpdir(), "agentic-dirt-snapshot-v2-"));
  try {
    writeEvidenceWorktreeBlobs({
      repository: root,
      evidence: source,
      git,
      environment: {},
    });
    const indexTreeSha = buildTreeFromEntries({
      git,
      temporary,
      name: "index",
      seedTree: source.headSha,
      entries: source.entries.map(entry => ({
        path: entry.path, mode: entry.indexMode, blob: entry.indexBlob,
      })),
      environment: {},
    });
    const worktreeTreeSha = buildTreeFromEntries({
      git,
      temporary,
      name: "worktree",
      seedTree: source.headSha,
      entries: source.entries.map(entry => ({
        path: entry.path, mode: entry.worktreeMode, blob: entry.worktreeBlob,
      })),
      environment: {},
    });
    if ((expectedIndexTreeSha && indexTreeSha !== expectedIndexTreeSha)
      || (expectedWorktreeTreeSha && worktreeTreeSha !== expectedWorktreeTreeSha)) {
      invalid("snapshot/source projection trees");
    }
    const canonicalEvidence = canonicalJson(source);
    const evidenceSha256 = createHash("sha256")
      .update(canonicalEvidence)
      .digest("hex");
    const evidenceBlobSha = sha(git([
      "hash-object", "-w", "--no-filters", "--stdin",
    ], { input: canonicalEvidence }), "snapshot evidence blob");
    const evidenceTreeSha = buildTreeFromEntries({
      git,
      temporary,
      name: "evidence",
      seedTree: null,
      entries: [{ path: "evidence.json", mode: "100644", blob: evidenceBlobSha }],
      environment: {},
    });
    const commitEnvironment = deterministicCommitEnvironment(instant);
    const evidenceCore = {
      schema: RETIRED_ABANDONED_EVIDENCE_SNAPSHOT_SCHEMA,
      planDigest: plan,
      claimId: claim,
      headSha: source.headSha,
      evidenceDigest: source.evidenceDigest,
      snapshotAt: instant,
      evidenceSha256,
      evidenceBlobSha,
      evidenceTreeSha,
    };
    const evidenceReceipt = sealReceipt(evidenceCore, "evidenceReceiptDigest");
    const evidenceMessage = compactMessage(
      RETIRED_ABANDONED_EVIDENCE_SNAPSHOT_SCHEMA,
      evidenceReceipt,
    );
    const evidenceCommitSha = sha(git([
      "commit-tree", evidenceTreeSha, "-p", source.headSha,
    ], { input: evidenceMessage, env: commitEnvironment }),
    "snapshot evidence commit");
    const indexCore = {
      schema: RETIRED_ABANDONED_INDEX_SNAPSHOT_SCHEMA,
      planDigest: plan,
      claimId: claim,
      headSha: source.headSha,
      indexTreeSha,
      evidenceDigest: source.evidenceDigest,
      snapshotAt: instant,
    };
    const indexReceipt = sealReceipt(indexCore, "indexReceiptDigest");
    const indexMessage = compactMessage(
      RETIRED_ABANDONED_INDEX_SNAPSHOT_SCHEMA,
      indexReceipt,
    );
    const indexCommitSha = sha(git([
      "commit-tree", indexTreeSha, "-p", source.headSha,
    ], { input: indexMessage, env: commitEnvironment }), "snapshot index commit");
    const snapshotCore = {
      schema: RETIRED_ABANDONED_SNAPSHOT_SCHEMA,
      planDigest: plan,
      claimId: claim,
      headSha: source.headSha,
      indexTreeSha,
      indexCommitSha,
      worktreeTreeSha,
      evidenceDigest: source.evidenceDigest,
      snapshotAt: instant,
      evidenceSha256,
      evidenceBlobSha,
      evidenceTreeSha,
      evidenceCommitSha,
    };
    const receipt = sealReceipt(snapshotCore, "snapshotReceiptDigest");
    const message = compactMessage(RETIRED_ABANDONED_SNAPSHOT_SCHEMA, receipt);
    const commitSha = sha(git([
      "commit-tree", worktreeTreeSha,
      "-p", source.headSha,
      "-p", indexCommitSha,
      "-p", evidenceCommitSha,
    ], { input: message, env: commitEnvironment }), "snapshot worktree commit");
    const snapshotRef = retiredAbandonedSnapshotRef({ claimId: claim, planDigest: plan });
    const existing = gitOptional(git, ["rev-parse", "--verify", "--quiet", snapshotRef]);
    if (existing && sha(existing, "existing snapshot ref") !== commitSha) {
      invalid("immutable snapshot ref");
    }
    if (!existing) {
      git(["update-ref", snapshotRef, commitSha, "0".repeat(40)]);
    }
    requireSameActiveOwnedDirtEvidence(
      source,
      captureActiveOwnedDirtEvidence({ repository: root }),
    );
    return verifyRetiredAbandonedOwnedDirtSnapshotV2({
      repository: root,
      snapshot: {
        ...receipt,
        snapshotRef,
        commitSha,
        evidence: source,
        expectedIndexTreeSha,
        expectedWorktreeTreeSha,
        timestamp: instant,
      },
      git,
    });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function verifyRetiredAbandonedOwnedDirtSnapshotV2({
  repository,
  snapshot,
  git = createGit(repository),
} = {}) {
  const root = realpathSync(path.resolve(required(repository, "snapshot repository")));
  const reference = required(snapshot?.snapshotRef, "snapshot ref");
  const commitSha = sha(
    git(["rev-parse", "--verify", reference]),
    "snapshot ref target",
  );
  if (snapshot?.commitSha && snapshot.commitSha !== commitSha) {
    invalid("snapshot commit/ref join");
  }
  const message = git(["show", "-s", "--format=%B", commitSha]);
  const receipt = parseCompactMessage(message, RETIRED_ABANDONED_SNAPSHOT_SCHEMA);
  const snapshotCore = omitDigest(receipt, "snapshotReceiptDigest");
  if (receipt.snapshotReceiptDigest !== digestValue(snapshotCore)
    || receipt.schema !== RETIRED_ABANDONED_SNAPSHOT_SCHEMA) {
    invalid("snapshot receipt digest");
  }
  const expectedClaim = snapshot?.claimId || receipt.claimId;
  const expectedPlan = snapshot?.planDigest || receipt.planDigest;
  const expectedHead = snapshot?.headSha || receipt.headSha;
  if (receipt.claimId !== expectedClaim
    || receipt.planDigest !== expectedPlan
    || receipt.headSha !== expectedHead
    || (snapshot?.timestamp
      && receipt.snapshotAt !== requiredInstant(snapshot.timestamp, "snapshot expected time"))
    || reference !== retiredAbandonedSnapshotRef({
      claimId: receipt.claimId,
      planDigest: receipt.planDigest,
    })) {
    invalid("snapshot subject");
  }
  const worktreeTreeSha = sha(
    git(["show", "-s", "--format=%T", commitSha]),
    "snapshot worktree tree",
  );
  const parents = splitShas(
    git(["show", "-s", "--format=%P", commitSha]),
    "snapshot parents",
  );
  if (worktreeTreeSha !== receipt.worktreeTreeSha
    || parents.length !== 3
    || parents[0] !== receipt.headSha
    || parents[1] !== receipt.indexCommitSha
    || parents[2] !== receipt.evidenceCommitSha) {
    invalid("snapshot worktree commit structure");
  }
  const indexMessage = git([
    "show", "-s", "--format=%B", receipt.indexCommitSha,
  ]);
  const indexReceipt = parseCompactMessage(
    indexMessage,
    RETIRED_ABANDONED_INDEX_SNAPSHOT_SCHEMA,
  );
  const expectedIndexCore = {
    schema: RETIRED_ABANDONED_INDEX_SNAPSHOT_SCHEMA,
    planDigest: receipt.planDigest,
    claimId: receipt.claimId,
    headSha: receipt.headSha,
    indexTreeSha: receipt.indexTreeSha,
    evidenceDigest: receipt.evidenceDigest,
    snapshotAt: receipt.snapshotAt,
  };
  if (canonicalJson(indexReceipt)
    !== canonicalJson(sealReceipt(expectedIndexCore, "indexReceiptDigest"))
    || git(["show", "-s", "--format=%T", receipt.indexCommitSha])
      !== receipt.indexTreeSha
    || git(["show", "-s", "--format=%P", receipt.indexCommitSha])
      !== receipt.headSha) {
    invalid("snapshot index commit structure");
  }
  const evidenceMessage = git([
    "show", "-s", "--format=%B", receipt.evidenceCommitSha,
  ]);
  const evidenceReceipt = parseCompactMessage(
    evidenceMessage,
    RETIRED_ABANDONED_EVIDENCE_SNAPSHOT_SCHEMA,
  );
  const expectedEvidenceCore = {
    schema: RETIRED_ABANDONED_EVIDENCE_SNAPSHOT_SCHEMA,
    planDigest: receipt.planDigest,
    claimId: receipt.claimId,
    headSha: receipt.headSha,
    evidenceDigest: receipt.evidenceDigest,
    snapshotAt: receipt.snapshotAt,
    evidenceSha256: receipt.evidenceSha256,
    evidenceBlobSha: receipt.evidenceBlobSha,
    evidenceTreeSha: receipt.evidenceTreeSha,
  };
  if (canonicalJson(evidenceReceipt)
    !== canonicalJson(sealReceipt(expectedEvidenceCore, "evidenceReceiptDigest"))
    || git(["show", "-s", "--format=%T", receipt.evidenceCommitSha])
      !== receipt.evidenceTreeSha
    || git(["show", "-s", "--format=%P", receipt.evidenceCommitSha])
      !== receipt.headSha) {
    invalid("snapshot evidence commit structure");
  }
  verifySnapshotCommitIdentity({
    git,
    commits: [commitSha, receipt.indexCommitSha, receipt.evidenceCommitSha],
    timestamp: receipt.snapshotAt,
  });
  const evidenceTree = readTreeMap(git, receipt.evidenceTreeSha, {});
  const evidenceEntry = evidenceTree.get("evidence.json");
  if (evidenceTree.size !== 1
    || evidenceEntry?.mode !== "100644"
    || evidenceEntry?.blob !== receipt.evidenceBlobSha) {
    invalid("snapshot evidence tree reachability");
  }
  const evidenceText = String(git(["cat-file", "blob", receipt.evidenceBlobSha]));
  if (createHash("sha256").update(evidenceText).digest("hex")
      !== receipt.evidenceSha256) {
    invalid("snapshot evidence blob SHA-256");
  }
  const evidence = normalizeActiveOwnedDirtEvidence(JSON.parse(evidenceText));
  if (canonicalJson(evidence) !== evidenceText
    || evidence.evidenceDigest !== receipt.evidenceDigest
    || evidence.headSha !== receipt.headSha
    || (snapshot?.evidence
      && canonicalJson(normalizeActiveOwnedDirtEvidence(snapshot.evidence))
        !== canonicalJson(evidence))) {
    invalid("snapshot canonical evidence blob");
  }
  if ((snapshot?.expectedIndexTreeSha
      && receipt.indexTreeSha !== snapshot.expectedIndexTreeSha)
    || (snapshot?.expectedWorktreeTreeSha
      && receipt.worktreeTreeSha !== snapshot.expectedWorktreeTreeSha)) {
    invalid("snapshot expected projection trees");
  }
  assertTreeProjection({
    git,
    baseTree: receipt.headSha,
    projectedTree: receipt.indexTreeSha,
    entries: evidence.entries.map(entry => ({
      path: entry.path, mode: entry.indexMode, blob: entry.indexBlob,
    })),
    environment: {},
  });
  assertTreeProjection({
    git,
    baseTree: receipt.headSha,
    projectedTree: receipt.worktreeTreeSha,
    entries: evidence.entries.map(entry => ({
      path: entry.path, mode: entry.worktreeMode, blob: entry.worktreeBlob,
    })),
    environment: {},
  });
  return Object.freeze({ ...receipt, snapshotRef: reference, commitSha });
}

export function materializeProjectedReanchorObjects({
  repository,
  plan,
  git = createGit(repository),
} = {}) {
  required(repository, "reanchor repository");
  required(plan?.planDigest, "reanchor plan");
  const temporary = mkdtempSync(path.join(os.tmpdir(), "agentic-reanchor-materialize-"));
  try {
    const dispositions = plan.evidence.reanchor.dispositions;
    assertReanchorFilesystemPathSafety({
      baseEntries: readTreeMap(git, plan.sourceBaseSha, {}),
      protectedEntries: readTreeMap(git, plan.targetCanonicalBaseSha, {}),
      dispositions,
      pathComparison: plan.evidence.reanchor.ignoredRetention.pathComparison,
    });
    const sourceIndexTreeSha = buildTreeFromEntries({
      git,
      temporary,
      name: "source-index",
      seedTree: plan.sourceBaseSha,
      entries: dispositions.map(item => ({
        path: item.path, mode: item.sourceIndex.mode, blob: item.sourceIndex.blob,
      })),
      environment: {},
    });
    const sourceWorktreeTreeSha = buildTreeFromEntries({
      git,
      temporary,
      name: "source-worktree",
      seedTree: plan.sourceBaseSha,
      entries: dispositions.map(item => ({
        path: item.path,
        mode: item.sourceWorktree.mode,
        blob: item.sourceWorktree.blob,
      })),
      environment: {},
    });
    const targetIndexTreeSha = buildTreeFromEntries({
      git,
      temporary,
      name: "target-index",
      seedTree: plan.targetCanonicalBaseSha,
      entries: dispositions.map(item => ({
        path: item.path, mode: item.targetIndex.mode, blob: item.targetIndex.blob,
      })),
      environment: {},
    });
    const targetWorktreeTreeSha = buildTreeFromEntries({
      git,
      temporary,
      name: "target-worktree",
      seedTree: plan.targetCanonicalBaseSha,
      entries: dispositions.map(item => ({
        path: item.path,
        mode: item.targetWorktree.mode,
        blob: item.targetWorktree.blob,
      })),
      environment: {},
    });
    const observedTrees = {
      sourceIndexTreeSha,
      sourceWorktreeTreeSha,
      targetIndexTreeSha,
      targetWorktreeTreeSha,
    };
    const expectedTrees = {
      sourceIndexTreeSha: plan.sourceIndexTreeSha,
      sourceWorktreeTreeSha: plan.sourceWorktreeTreeSha,
      targetIndexTreeSha: plan.targetIndexTreeSha,
      targetWorktreeTreeSha: plan.targetWorktreeTreeSha,
    };
    if (canonicalJson(observedTrees) !== canonicalJson(expectedTrees)) {
      invalid("materialized reanchor trees");
    }
    const coordination = plan.evidence.reanchor.coordination;
    const commitSha = sha(git([
      "commit-tree", coordination.treeSha,
      "-p", coordination.parents[0],
      "-p", coordination.parents[1],
    ], {
      input: coordination.message,
      env: coordinationCommitEnvironment(coordination),
    }), "materialized coordination commit");
    if (commitSha !== plan.coordinationCommitSha) {
      invalid("materialized coordination commit SHA");
    }
    verifyMaterializedReanchorObjects({ repository, plan, git });
    return Object.freeze({
      coordinationCommitSha: commitSha,
      coordinationTreeSha: coordination.treeSha,
      ...observedTrees,
      dispositionsDigest: plan.dispositionsDigest,
    });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function verifyMaterializedReanchorObjects({
  repository,
  plan,
  git = createGit(repository),
} = {}) {
  const coordination = plan?.evidence?.reanchor?.coordination;
  if (!coordination || coordination.commitSha !== plan.coordinationCommitSha) {
    invalid("sealed coordination object");
  }
  const commitType = git(["cat-file", "-t", coordination.commitSha]);
  const treeSha = git(["show", "-s", "--format=%T", coordination.commitSha]);
  const parents = splitShas(
    git(["show", "-s", "--format=%P", coordination.commitSha]),
    "coordination parents",
  );
  const message = git(["show", "-s", "--format=%B", coordination.commitSha]);
  const identity = String(git([
    "show", "-s", "--format=%an%x00%ae%x00%cn%x00%ce%x00%at%x00%ct",
    coordination.commitSha,
  ])).split("\0");
  const expectedTimestamp = String(Math.floor(Date.parse(coordination.authoredAt) / 1000));
  if (commitType !== "commit"
    || treeSha !== coordination.treeSha
    || canonicalJson(parents) !== canonicalJson(coordination.parents)
    || String(message).trimEnd() !== coordination.message.trimEnd()
    || canonicalJson(identity) !== canonicalJson([
      coordination.authorName,
      coordination.authorEmail,
      coordination.committerName,
      coordination.committerEmail,
      expectedTimestamp,
      expectedTimestamp,
    ])) {
    invalid("deterministic coordination commit object");
  }
  for (const [label, objectId] of [
    ["source index", plan.sourceIndexTreeSha],
    ["source worktree", plan.sourceWorktreeTreeSha],
    ["target index", plan.targetIndexTreeSha],
    ["target worktree", plan.targetWorktreeTreeSha],
  ]) {
    if (git(["cat-file", "-t", objectId]) !== "tree") {
      invalid(`${label} reanchor tree object`);
    }
  }
  const dispositions = plan.evidence.reanchor.dispositions;
  assertReanchorFilesystemPathSafety({
    baseEntries: readTreeMap(git, plan.sourceBaseSha, {}),
    protectedEntries: readTreeMap(git, plan.targetCanonicalBaseSha, {}),
    dispositions,
    pathComparison: plan.evidence.reanchor.ignoredRetention.pathComparison,
  });
  assertTreeProjection({
    git,
    baseTree: plan.sourceBaseSha,
    projectedTree: plan.sourceIndexTreeSha,
    entries: dispositions.map(item => ({
      path: item.path, mode: item.sourceIndex.mode, blob: item.sourceIndex.blob,
    })),
    environment: {},
  });
  assertTreeProjection({
    git,
    baseTree: plan.sourceBaseSha,
    projectedTree: plan.sourceWorktreeTreeSha,
    entries: dispositions.map(item => ({
      path: item.path,
      mode: item.sourceWorktree.mode,
      blob: item.sourceWorktree.blob,
    })),
    environment: {},
  });
  assertTreeProjection({
    git,
    baseTree: plan.targetCanonicalBaseSha,
    projectedTree: plan.targetIndexTreeSha,
    entries: dispositions.map(item => ({
      path: item.path, mode: item.targetIndex.mode, blob: item.targetIndex.blob,
    })),
    environment: {},
  });
  assertTreeProjection({
    git,
    baseTree: plan.targetCanonicalBaseSha,
    projectedTree: plan.targetWorktreeTreeSha,
    entries: dispositions.map(item => ({
      path: item.path,
      mode: item.targetWorktree.mode,
      blob: item.targetWorktree.blob,
    })),
    environment: {},
  });
  return Object.freeze({
    coordinationCommitSha: coordination.commitSha,
    coordinationTreeSha: coordination.treeSha,
    sourceIndexTreeSha: plan.sourceIndexTreeSha,
    sourceWorktreeTreeSha: plan.sourceWorktreeTreeSha,
    targetIndexTreeSha: plan.targetIndexTreeSha,
    targetWorktreeTreeSha: plan.targetWorktreeTreeSha,
    dispositionsDigest: plan.dispositionsDigest,
  });
}

export function convergeRetiredAbandonedOwnedDirtLocalReanchor({
  repository,
  branch,
  plan,
  git = createGit(repository),
} = {}) {
  return convergeLocalReanchor({ repository, branch, plan, git });
}

function convergeLocalReanchor({ repository, branch, plan, git }) {
  const root = realpathSync(path.resolve(required(repository, "reanchor repository")));
  const sourceFenceSha = plan.sourceFenceSha;
  const targetLaneRevision = plan.targetLaneRevision;
  const head = sha(git(["rev-parse", "HEAD"]), "local reanchor HEAD");
  const localRef = sha(
    git(["rev-parse", `refs/heads/${branch}`]),
    "local reanchor branch",
  );
  if (head !== localRef || ![sourceFenceSha, targetLaneRevision].includes(head)) {
    invalid("recognized local reanchor ref state");
  }
  const ignoredBefore = proveIgnoredStateRetention({
    localHead: plan.sourceBaseSha,
    originHead: plan.targetCanonicalBaseSha,
    gitText: git,
    gitOptional: argumentsList => gitOptional(git, argumentsList),
  });
  if (digestValue(ignoredBefore)
    !== digestValue(plan.evidence.reanchor.ignoredRetention)) {
    invalid("pre-reanchor ignored-state retention");
  }
  let indexTree = sha(git(["write-tree"]), "local reanchor index tree");
  let worktreeTree = capturePhysicalWorktreeTree({
    repository: root,
    headSha: head,
    git,
  });
  const permittedIndexTrees = new Set([
    plan.sourceIndexTreeSha,
    plan.sourceWorktreeTreeSha,
    plan.targetWorktreeTreeSha,
    plan.targetIndexTreeSha,
  ]);
  if (!permittedIndexTrees.has(indexTree)
    || !new Set([plan.sourceWorktreeTreeSha, plan.targetWorktreeTreeSha])
      .has(worktreeTree)) {
    invalid("recognized local reanchor index/worktree state");
  }
  if (head === sourceFenceSha) {
    if (worktreeTree !== plan.sourceWorktreeTreeSha
      || !new Set([plan.sourceIndexTreeSha, plan.sourceWorktreeTreeSha]).has(indexTree)) {
      invalid("source physical state before branch CAS");
    }
    git([
      "update-ref", `refs/heads/${branch}`,
      targetLaneRevision, sourceFenceSha,
    ]);
  }
  if (worktreeTree === plan.sourceWorktreeTreeSha) {
    indexTree = sha(git(["write-tree"]), "pre-overlay index tree");
    if (indexTree === plan.sourceIndexTreeSha) {
      git(["read-tree", plan.sourceWorktreeTreeSha]);
    } else if (indexTree !== plan.sourceWorktreeTreeSha) {
      invalid("pre-overlay source index state");
    }
    git(["read-tree", "--reset", "-u", plan.targetWorktreeTreeSha]);
    worktreeTree = capturePhysicalWorktreeTree({
      repository: root,
      headSha: targetLaneRevision,
      git,
    });
    if (worktreeTree !== plan.targetWorktreeTreeSha
      || git(["write-tree"]) !== plan.targetWorktreeTreeSha) {
      invalid("physical target worktree convergence");
    }
  } else {
    indexTree = sha(git(["write-tree"]), "post-overlay index tree");
    if (!new Set([plan.targetWorktreeTreeSha, plan.targetIndexTreeSha]).has(indexTree)) {
      invalid("recognized post-overlay index state");
    }
  }
  if (git(["write-tree"]) === plan.targetWorktreeTreeSha) {
    git(["read-tree", plan.targetIndexTreeSha]);
  }
  if (git(["rev-parse", "HEAD"]) !== targetLaneRevision
    || git(["rev-parse", `refs/heads/${branch}`]) !== targetLaneRevision
    || git(["write-tree"]) !== plan.targetIndexTreeSha
    || capturePhysicalWorktreeTree({
      repository: root,
      headSha: targetLaneRevision,
      git,
    }) !== plan.targetWorktreeTreeSha) {
    invalid("terminal local reanchor projection");
  }
  requireSameActiveOwnedDirtEvidence(
    plan.evidence.reanchor.targetDirt,
    captureActiveOwnedDirtEvidence({ repository: root }),
  );
  const ignoredAfter = proveIgnoredStateRetention({
    localHead: plan.sourceBaseSha,
    originHead: plan.targetCanonicalBaseSha,
    gitText: git,
    gitOptional: argumentsList => gitOptional(git, argumentsList),
  });
  if (digestValue(ignoredAfter) !== digestValue(ignoredBefore)) {
    invalid("post-reanchor ignored-state retention");
  }
  return Object.freeze({
    sourceFenceSha,
    targetLaneRevision,
    targetIndexTreeSha: plan.targetIndexTreeSha,
    targetWorktreeTreeSha: plan.targetWorktreeTreeSha,
    targetDirtEvidenceDigest: plan.targetDirtEvidenceDigest,
    ignoredRetentionDigest: digestValue(ignoredAfter),
    authoredBytesPreserved: true,
  });
}

function capturePhysicalWorktreeTree({ repository, headSha, git }) {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "agentic-physical-tree-"));
  try {
    const environment = { GIT_INDEX_FILE: path.join(temporary, "index") };
    git(["read-tree", headSha], { env: environment });
    git(["add", "-A", "--", "."], { env: environment });
    return sha(git(["write-tree"], { env: environment }), "physical worktree tree");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function captureRetiredAbandonedOwnedDirtProtectedControllerWitness({
  controllerRoot = CONTROLLER_ROOT,
  implementationFiles = IMPLEMENTATION_FILES,
  environment = process.env,
} = {}) {
  const root = realpathSync(path.resolve(required(controllerRoot, "controller root")));
  const controllerGit = createGit(root, environment);
  if (controllerGit(["branch", "--show-current"]) !== "main"
    || controllerGit(["status", "--porcelain=v1", "--untracked-files=all"])) {
    invalid("clean protected controller checkout");
  }
  const headSha = sha(controllerGit(["rev-parse", "HEAD"]), "controller HEAD");
  const localMainSha = sha(
    controllerGit(["rev-parse", "refs/heads/main"]),
    "controller local main",
  );
  const originMainSha = sha(
    controllerGit(["rev-parse", "refs/remotes/origin/main"]),
    "controller origin/main",
  );
  const remoteMainSha = firstSha(controllerGit([
    "ls-remote", "--heads", "origin", "refs/heads/main",
  ]), "controller remote main");
  if (headSha !== localMainSha
    || headSha !== originMainSha
    || headSha !== remoteMainSha) {
    invalid("exact protected controller main");
  }
  if (!Array.isArray(implementationFiles) || implementationFiles.length === 0) {
    invalid("controller implementation file set");
  }
  const files = [...new Set(implementationFiles.map(item => required(
    item,
    "controller implementation path",
  )))].sort(compareCorePaths).map(relativePath => {
    const absolute = path.resolve(root, relativePath);
    if (!insidePath(root, absolute)) invalid("controller implementation containment");
    const before = lstatSync(absolute, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink()) {
      invalid(`controller implementation regular file ${relativePath}`);
    }
    const expectedBlobSha = sha(
      controllerGit(["rev-parse", `${headSha}:${relativePath}`]),
      `controller implementation HEAD blob ${relativePath}`,
    );
    const beforeBlobSha = sha(
      controllerGit(["hash-object", "--no-filters", "--", relativePath]),
      `controller implementation worktree blob ${relativePath}`,
    );
    const bytes = readFileSync(absolute);
    const after = lstatSync(absolute, { bigint: true });
    const afterBlobSha = sha(
      controllerGit(["hash-object", "--no-filters", "--", relativePath]),
      `controller implementation stable blob ${relativePath}`,
    );
    if (expectedBlobSha !== beforeBlobSha
      || expectedBlobSha !== afterBlobSha
      || statIdentity(before) !== statIdentity(after)) {
      invalid(`controller implementation HEAD/worktree join ${relativePath}`);
    }
    return Object.freeze({
      path: relativePath,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  });
  if (controllerGit(["branch", "--show-current"]) !== "main"
    || controllerGit(["status", "--porcelain=v1", "--untracked-files=all"])
    || controllerGit(["rev-parse", "HEAD"]) !== headSha
    || controllerGit(["rev-parse", "refs/heads/main"]) !== headSha
    || controllerGit(["rev-parse", "refs/remotes/origin/main"]) !== headSha
    || firstSha(controllerGit([
      "ls-remote", "--heads", "origin", "refs/heads/main",
    ]), "stable controller remote main") !== headSha) {
    invalid("stable exact protected controller main");
  }
  return Object.freeze({ headSha, implementationDigest: digestValue(files) });
}

function successorAdmission({ source, plan, authority }) {
  const manifest = plan.evidence.targetManifest;
  const admittedReportDigest = digestValue({
    schema: "agentic-retired-abandoned-owned-dirt-successor-admitted-report/v1",
    planDigest: plan.planDigest,
    claimId: authority.claimId,
  });
  return Object.freeze({
    schema: "agentic-lane-admission-lease/v1",
    status: "admitted",
    semanticScope: manifest.semanticScope,
    declaredWriteSet: manifest.declaredWriteSet,
    writeSetDigest: manifest.writeSetDigest,
    manifestDigest: manifest.manifestDigest,
    planReceiptDigest: plan.planDigest,
    admissionReceiptDigest: authority.operationReceiptDigest,
    existingLaneStateDigest: source.existingLaneStateDigest,
    admittedReportDigest,
    preservationReceiptDigest: digestValue({
      schema: "agentic-retired-abandoned-owned-dirt-successor-preservation/v1",
      planDigest: plan.planDigest,
      sourceAdmissionDigest: digestValue(source),
      successorClaimId: authority.claimId,
      sourceFenceSha: plan.sourceFenceSha,
      targetLaneRevision: plan.targetLaneRevision,
      targetDirtEvidenceDigest: plan.targetDirtEvidenceDigest,
    }),
  });
}

function snapshotEffect(snapshot) {
  return effect("snapshot", {
    snapshotRef: snapshot.snapshotRef,
    snapshotCommitSha: snapshot.commitSha,
    snapshotReceiptDigest: snapshot.snapshotReceiptDigest,
    indexTreeSha: snapshot.indexTreeSha,
    indexCommitSha: snapshot.indexCommitSha,
    worktreeTreeSha: snapshot.worktreeTreeSha,
    evidenceDigest: snapshot.evidenceDigest,
    evidenceSha256: snapshot.evidenceSha256,
    evidenceBlobSha: snapshot.evidenceBlobSha,
    evidenceTreeSha: snapshot.evidenceTreeSha,
    evidenceCommitSha: snapshot.evidenceCommitSha,
  });
}

function claimEffect({ claim, entry }) {
  return effect("claim", {
    claimId: digest(claim?.claimId, "recovery claim ID"),
    claimDigest: digest(
      claim?.fenceRevision,
      "recovery claim digest",
    ),
    transitionCounter: positiveInteger(
      claim?.transitionCounter,
      "recovery claim transition counter",
    ),
    claimLedgerRevision: digest(
      claim?.transitionDigest,
      "recovery claim ledger revision",
    ),
    ledgerSequence: positiveInteger(entry?.sequence, "recovery ledger sequence"),
    expiresAt: requiredInstant(claim?.expiresAt, "recovery claim expiry"),
    evaluationTime: requiredInstant(
      entry?.evaluationTime,
      "recovery claim evaluation time",
    ),
    operationReceiptDigest: digest(
      claim?.operationReceiptDigest,
      "recovery claim operation receipt",
    ),
  });
}

function effect(kind, values = {}) {
  const core = {
    schema: EFFECT_SCHEMA,
    kind: required(kind, "effect kind"),
    ...values,
  };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}

function buildTreeFromEntries({
  git,
  temporary,
  name,
  seedTree,
  entries,
  environment,
}) {
  const indexPath = path.join(temporary, `${name}.index`);
  const env = { ...(environment || {}), GIT_INDEX_FILE: indexPath };
  if (seedTree) git(["read-tree", seedTree], { env });
  else git(["read-tree", "--empty"], { env });
  applyIndexEntries({ git, entries, environment: env });
  return sha(git(["write-tree"], { env }), `${name} tree`);
}

function applyIndexEntries({ git, entries, environment }) {
  if (!Array.isArray(entries)) invalid("tree entry projection");
  const normalized = entries.map(item => ({
    path: safeRelativePath(item.path),
    mode: item.mode === null || item.mode === undefined ? null : gitMode(item.mode),
    blob: item.blob === null || item.blob === undefined ? null
      : sha(item.blob, "tree entry object"),
  })).sort((left, right) => compareCorePaths(left.path, right.path));
  if (normalized.some((item, index) => item.path === normalized[index - 1]?.path)) {
    invalid("unique tree entry projection");
  }
  if (normalized.some(item => Boolean(item.mode) !== Boolean(item.blob))) {
    invalid("tree entry mode/object join");
  }
  if (normalized.length === 0) return;
  const input = normalized.map(item => item.mode
    ? `${item.mode} ${item.blob}\t${item.path}\0`
    : `0 ${"0".repeat(40)}\t${item.path}\0`).join("");
  git(["update-index", "-z", "--index-info"], {
    env: environment,
    input,
  });
}

function readTreeMap(git, treeSha, environment = {}) {
  const output = String(git([
    "ls-tree", "-rz", "--full-tree", treeSha,
  ], { env: environment }));
  const result = new Map();
  for (const record of output.split("\0").filter(Boolean)) {
    const tab = record.indexOf("\t");
    const header = tab < 0 ? "" : record.slice(0, tab);
    const relativePath = tab < 0 ? "" : record.slice(tab + 1);
    const match = header.match(/^(\d{6})\s+(?:blob|commit)\s+([0-9a-f]{40})$/u);
    if (!match || !relativePath || result.has(relativePath)) {
      invalid("recursive Git tree listing");
    }
    result.set(relativePath, Object.freeze({ mode: match[1], blob: match[2] }));
  }
  return result;
}

function assertTreeProjection({ git, baseTree, projectedTree, entries, environment }) {
  const expected = readTreeMap(git, baseTree, environment);
  for (const entry of entries) {
    const relativePath = safeRelativePath(entry.path);
    if (entry.mode && entry.blob) {
      expected.set(relativePath, {
        mode: gitMode(entry.mode),
        blob: sha(entry.blob, "projected tree object"),
      });
    } else if (!entry.mode && !entry.blob) {
      expected.delete(relativePath);
    } else {
      invalid("projected tree entry");
    }
  }
  const observed = readTreeMap(git, projectedTree, environment);
  const project = map => [...map.entries()]
    .sort((left, right) => compareCorePaths(left[0], right[0]))
    .map(([relativePath, value]) => ({ path: relativePath, ...value }));
  if (canonicalJson(project(expected)) !== canonicalJson(project(observed))) {
    invalid("exact projected Git tree");
  }
}

function assertProjectedFilesystemPathSafety({
  seedEntries,
  entries,
  pathComparison,
  label,
}) {
  if (!(seedEntries instanceof Map) || !Array.isArray(entries)
    || typeof pathComparison?.caseFold !== "boolean"
    || pathComparison.caseFoldStrategy !== (pathComparison.caseFold
      ? "unicode-upper-lower" : "none")
    || pathComparison.unicodeNormalization !== "NFC") {
    invalid(`${label} path-comparison proof`);
  }
  const projected = new Map(seedEntries);
  for (const item of entries) {
    const relativePath = safeRelativePath(item.path);
    const entry = gitEntry(item);
    if (entry.mode) projected.set(relativePath, entry);
    else projected.delete(relativePath);
  }
  const comparable = new Map();
  for (const relativePath of projected.keys()) {
    const normalized = normalizeFilesystemComparisonPath(
      safeRelativePath(relativePath),
      pathComparison,
    );
    const existing = comparable.get(normalized);
    if (existing !== undefined && existing !== relativePath) {
      invalid(`${label} normalized path collision (${existing}, ${relativePath})`);
    }
    comparable.set(normalized, relativePath);
  }
  for (const [normalized, relativePath] of comparable) {
    const segments = normalized.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      const ancestor = comparable.get(segments.slice(0, index).join("/"));
      if (ancestor !== undefined) {
        invalid(`${label} file/ancestor collision (${ancestor}, ${relativePath})`);
      }
    }
  }
}

function assertReanchorFilesystemPathSafety({
  baseEntries,
  protectedEntries,
  dispositions,
  pathComparison,
}) {
  for (const [label, seedEntries, field] of [
    ["source index overlay", baseEntries, "sourceIndex"],
    ["source worktree overlay", baseEntries, "sourceWorktree"],
    ["target index overlay", protectedEntries, "targetIndex"],
    ["target worktree overlay", protectedEntries, "targetWorktree"],
  ]) {
    assertProjectedFilesystemPathSafety({
      seedEntries,
      entries: dispositions.map(item => ({
        path: item.path,
        mode: item[field].mode,
        blob: item[field].blob,
      })),
      pathComparison,
      label,
    });
  }
}

function normalizeFilesystemComparisonPath(relativePath, pathComparison) {
  const normalized = relativePath.normalize("NFC");
  return pathComparison.caseFold
    ? normalized.toUpperCase().toLowerCase().normalize("NFC")
    : normalized;
}

function writeEvidenceWorktreeBlobs({ repository, evidence, git, environment }) {
  const observations = [];
  for (const entry of evidence.entries) {
    if (entry.worktreeType === "deleted") {
      const absolute = assertSafeWorktreeAncestors(repository, entry.path);
      if (pathExistsNoFollow(absolute)) {
        invalid(`deleted snapshot path ${entry.path}`);
      }
      continue;
    }
    const observed = readSecureWorktreeBytes(repository, entry.path);
    if (observed.type !== entry.worktreeType
      || observed.mode !== entry.worktreeMode) {
      invalid(`snapshot worktree type/mode ${entry.path}`);
    }
    const predicted = sha(git([
      "hash-object", "--no-filters", "--stdin",
    ], { input: observed.bytes, env: environment }), `predicted snapshot blob ${entry.path}`);
    if (predicted !== entry.worktreeBlob) {
      invalid(`snapshot worktree bytes ${entry.path}`);
    }
    observed.assertUnchanged();
    observations.push({ entry, observed });
  }
  for (const { entry, observed } of observations) {
    observed.assertUnchanged();
    const objectId = sha(git([
      "hash-object", "-w", "--no-filters", "--stdin",
    ], { input: observed.bytes, env: environment }), `snapshot blob ${entry.path}`);
    if (objectId !== entry.worktreeBlob) {
      invalid(`snapshot worktree bytes ${entry.path}`);
    }
    observed.assertUnchanged();
  }
  for (const { observed } of observations) observed.assertUnchanged();
}

function pathExistsNoFollow(value) {
  try {
    lstatSync(value);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function readSecureWorktreeBytes(repository, relativePath) {
  const safePath = safeRelativePath(relativePath);
  const root = realpathSync(path.resolve(repository));
  const absolute = assertSafeWorktreeAncestors(root, safePath);
  const before = lstatSync(absolute, { bigint: true });
  const identity = statIdentity(before);
  if (before.isSymbolicLink()) {
    const bytes = readlinkSync(absolute, { encoding: "buffer" });
    return Object.freeze({
      type: "symlink",
      mode: "120000",
      bytes,
      assertUnchanged() {
        if (statIdentity(lstatSync(absolute, { bigint: true })) !== identity) {
          invalid(`stable snapshot symlink ${safePath}`);
        }
      },
    });
  }
  if (!before.isFile() || !Number.isInteger(constants.O_NOFOLLOW)) {
    invalid(`regular no-follow snapshot path ${safePath}`);
  }
  const descriptor = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    if (statIdentity(opened) !== identity || !opened.isFile()) {
      invalid(`stable opened snapshot path ${safePath}`);
    }
    const bytes = readFileSync(descriptor);
    const mode = Number(opened.mode & 0o111n) ? "100755" : "100644";
    if (statIdentity(fstatSync(descriptor, { bigint: true })) !== identity
      || statIdentity(lstatSync(absolute, { bigint: true })) !== identity) {
      invalid(`stable snapshot file ${safePath}`);
    }
    return Object.freeze({
      type: "file",
      mode,
      bytes,
      assertUnchanged() {
        if (statIdentity(lstatSync(absolute, { bigint: true })) !== identity) {
          invalid(`stable snapshot file ${safePath}`);
        }
      },
    });
  } finally {
    closeSync(descriptor);
  }
}

function assertSafeWorktreeAncestors(repository, relativePath) {
  const safePath = safeRelativePath(relativePath);
  const root = realpathSync(path.resolve(repository));
  const absolute = path.resolve(root, safePath);
  if (!insidePath(root, absolute)) invalid("worktree byte containment");
  let cursor = root;
  for (const segment of path.dirname(safePath).split(path.sep).filter(item => item !== ".")) {
    cursor = path.join(cursor, segment);
    let ancestor;
    try {
      ancestor = lstatSync(cursor);
    } catch (error) {
      if (error?.code === "ENOENT") return absolute;
      throw error;
    }
    if (!ancestor.isDirectory() || ancestor.isSymbolicLink()) {
      invalid(`worktree byte ancestor ${safePath}`);
    }
  }
  return absolute;
}

function statIdentity(stat) {
  return [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs]
    .map(String).join(":");
}

function gitEntry(value) {
  const mode = value?.mode || null;
  const blob = value?.blob || null;
  if (Boolean(mode) !== Boolean(blob)) invalid("Git entry mode/object");
  if (mode) gitMode(mode);
  if (blob) sha(blob, "Git entry object");
  return Object.freeze({ mode, blob });
}

function worktreeEntry(value) {
  const type = value?.type;
  const entry = gitEntry(value);
  if (!new Set(["file", "symlink", "deleted"]).has(type)
    || (type === "deleted") !== !entry.mode
    || (type === "file" && !new Set(["100644", "100755"]).has(entry.mode))
    || (type === "symlink" && entry.mode !== "120000")) {
    invalid("worktree entry");
  }
  return Object.freeze({ type, ...entry });
}

function worktreeFromGitEntry(value) {
  const entry = gitEntry(value);
  if (!entry.mode) return Object.freeze({ type: "deleted", ...entry });
  if (entry.mode === "120000") {
    return Object.freeze({ type: "symlink", ...entry });
  }
  if (!new Set(["100644", "100755"]).has(entry.mode)) {
    invalid("materializable protected worktree entry");
  }
  return Object.freeze({ type: "file", ...entry });
}

function sameGitEntry(left, right) {
  return (left?.mode || null) === (right?.mode || null)
    && (left?.blob || null) === (right?.blob || null);
}

function sameWorktreeEntry(left, right) {
  return left?.type === right?.type && sameGitEntry(left, right);
}

function statePaths(commonDirectory, branch) {
  const root = path.join(
    commonDirectory,
    "agentic-canvas-os",
    "retired-abandoned-owned-dirt-successor-recovery",
  );
  const key = digestValue({ branch });
  return Object.freeze({
    journal: path.join(root, `${key}.json`),
    lock: path.join(root, `${key}.lock`),
  });
}

function readJournal(file) {
  if (!existsSync(file)) return null;
  const stat = lstatSync(file);
  if (!stat.isFile()
    || stat.isSymbolicLink()
    || stat.nlink !== 1
    || (stat.mode & 0o077) !== 0
    || (typeof process.getuid === "function" && stat.uid !== process.getuid())) {
    invalid("owner-only regular recovery journal");
  }
  const envelope = JSON.parse(readFileSync(file, "utf8"));
  if (envelope?.schema !== JOURNAL_SCHEMA
    || envelope.intentDigest !== digestValue(envelope.intent)) {
    invalid("recovery journal envelope");
  }
  return normalizeRecoveryIntent(envelope.intent);
}

function writeJournal(file, expected, value) {
  ensureStateDirectory(file);
  const current = readJournal(file);
  if (digestValue(current) !== digestValue(expected)) {
    invalid("recovery journal CAS");
  }
  const intent = normalizeRecoveryIntent(value);
  const envelope = {
    schema: JOURNAL_SCHEMA,
    intent,
    intentDigest: digestValue(intent),
  };
  const temporary = `${file}.${process.pid}.${process.hrtime.bigint()}.tmp`;
  let descriptor = null;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(envelope, null, 2)}\n`);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporary, file);
    fsyncDirectory(path.dirname(file));
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  return intent;
}

function fsyncDirectory(directory) {
  const descriptor = openSync(directory, constants.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function ensureStateDirectory(file) {
  const directory = path.dirname(file);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directory);
  if (!stat.isDirectory()
    || stat.isSymbolicLink()
    || (stat.mode & 0o077) !== 0
    || (typeof process.getuid === "function" && stat.uid !== process.getuid())) {
    invalid("owner-only recovery state directory");
  }
}

function registeredWorktreeRecords(git) {
  const tokens = String(git(["worktree", "list", "--porcelain", "-z"]))
    .split("\0").filter(Boolean);
  const records = [];
  let current = null;
  for (const token of tokens) {
    if (token.startsWith("worktree ")) {
      if (current) records.push(current);
      current = { path: token.slice("worktree ".length), branch: null };
    } else if (current && token.startsWith("branch ")) {
      current.branch = token.slice("branch ".length);
    }
  }
  if (current) records.push(current);
  if (records.length === 0) invalid("registered worktree inventory");
  return records.map(record => Object.freeze({
    path: realpathSync(record.path),
    branch: record.branch,
  }));
}

function registeredWorktreeRoots(git) {
  return Object.freeze(registeredWorktreeRecords(git).map(record => record.path));
}

function registeredMainWorktreeRoot(git) {
  const matches = registeredWorktreeRecords(git)
    .filter(record => record.branch === "refs/heads/main");
  if (matches.length !== 1) invalid("unique protected main worktree");
  return matches[0].path;
}

function secureExternalCapabilityPath({
  value,
  label,
  commonDirectory,
  worktreeRoots,
}) {
  const supplied = required(value, label);
  if (!path.isAbsolute(supplied)) invalid(`absolute ${label}`);
  const resolved = path.resolve(supplied);
  const suppliedStat = lstatSync(resolved);
  if (!suppliedStat.isFile()
    || suppliedStat.isSymbolicLink()
    || suppliedStat.nlink !== 1
    || (suppliedStat.mode & 0o7777) !== 0o600
    || (typeof process.getuid === "function"
      && suppliedStat.uid !== process.getuid())) {
    invalid(`owner-only regular non-linked ${label}`);
  }
  const canonical = realpathSync(resolved);
  if (canonical !== resolved) invalid(`non-symlink-ancestor ${label}`);
  const forbidden = [commonDirectory, ...worktreeRoots].map(item => realpathSync(item));
  if (forbidden.some(root => insidePath(root, canonical))) {
    invalid(`${label} outside Git common dir and every linked worktree`);
  }
  return canonical;
}

function readStableExternalTaskAuthorityCapability(input) {
  const capabilityPath = secureExternalCapabilityPath(input);
  const before = lstatSync(capabilityPath, { bigint: true });
  const capability = readTaskAuthorityCapability(capabilityPath);
  const after = lstatSync(capabilityPath, { bigint: true });
  const confirmed = secureExternalCapabilityPath(input);
  if (confirmed !== capabilityPath
    || statIdentity(before) !== statIdentity(after)) {
    invalid(`stable ${input.label}`);
  }
  return capability;
}

function normalizeManifestWriteSet(value) {
  return normalizeDeclaredWriteScopeManifest(value).declaredWriteSet;
}

function coordinationCommitEnvironment(coordination) {
  return {
    GIT_AUTHOR_NAME: coordination.authorName,
    GIT_AUTHOR_EMAIL: coordination.authorEmail,
    GIT_AUTHOR_DATE: coordination.gitTimestamp,
    GIT_COMMITTER_NAME: coordination.committerName,
    GIT_COMMITTER_EMAIL: coordination.committerEmail,
    GIT_COMMITTER_DATE: coordination.gitTimestamp,
  };
}

function deterministicCommitEnvironment(timestamp) {
  return {
    GIT_AUTHOR_NAME: "Agentic Canvas OS",
    GIT_AUTHOR_EMAIL: "agentic-canvas-os@localhost",
    GIT_AUTHOR_DATE: timestamp,
    GIT_COMMITTER_NAME: "Agentic Canvas OS",
    GIT_COMMITTER_EMAIL: "agentic-canvas-os@localhost",
    GIT_COMMITTER_DATE: timestamp,
  };
}

function verifySnapshotCommitIdentity({ git, commits, timestamp }) {
  const instant = requiredInstant(timestamp, "snapshot commit time");
  const epoch = String(Math.floor(Date.parse(instant) / 1000));
  for (const commit of commits) {
    const fields = String(git([
      "show", "-s",
      "--format=%an%x00%ae%x00%cn%x00%ce%x00%at%x00%ct%x00%aI%x00%cI",
      commit,
    ])).split("\0");
    if (canonicalJson(fields.slice(0, 6)) !== canonicalJson([
      "Agentic Canvas OS",
      "agentic-canvas-os@localhost",
      "Agentic Canvas OS",
      "agentic-canvas-os@localhost",
      epoch,
      epoch,
    ])
      || Date.parse(fields[6]) !== Date.parse(instant)
      || Date.parse(fields[7]) !== Date.parse(instant)
      || !/(?:Z|\+00:00)$/u.test(fields[6])
      || !/(?:Z|\+00:00)$/u.test(fields[7])) {
      invalid("deterministic snapshot commit identity/time");
    }
  }
}

function compactMessage(schema, receipt) {
  return `${schema}\n\n${JSON.stringify(receipt)}\n`;
}

function parseCompactMessage(message, schema) {
  const source = String(message).trimEnd();
  const separator = source.indexOf("\n\n");
  if (separator < 0 || source.slice(0, separator) !== schema) {
    invalid(`${schema} commit message`);
  }
  return JSON.parse(source.slice(separator + 2));
}

function sealReceipt(core, field) {
  return Object.freeze({ ...core, [field]: digestValue(core) });
}

function omitDigest(value, field) {
  const result = { ...value };
  delete result[field];
  return result;
}

function createGit(repository, baseEnvironment = process.env) {
  const root = path.resolve(required(repository, "Git repository"));
  const invokeGit = (argumentsList, options = {}) => String(execFileSync(
    "git",
    argumentsList,
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 256 * 1024 * 1024,
      ...options,
      env: { ...baseEnvironment, ...(options.env || {}) },
    },
  )).trim();
  invokeGit.optional = (argumentsList, options = {}) => {
    try {
      return invokeGit(argumentsList, options);
    } catch (error) {
      if (new Set([1, 128]).has(error?.status)) return "";
      throw error;
    }
  };
  return invokeGit;
}

function gitOptional(git, argumentsList, options = {}) {
  if (typeof git.optional === "function") return git.optional(argumentsList, options);
  try {
    return git(argumentsList, options);
  } catch (error) {
    if (new Set([1, 128]).has(error?.status)) return "";
    throw error;
  }
}

function splitShas(value, label) {
  const values = String(value || "").trim().split(/\s+/u).filter(Boolean);
  values.forEach(item => sha(item, label));
  return values;
}

function sortedCorePaths(value) {
  return String(value || "").split("\0").filter(Boolean)
    .map(safeRelativePath).sort(compareCorePaths);
}

function compareCorePaths(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function safeRelativePath(value) {
  const candidate = String(value || "");
  if (!candidate
    || path.isAbsolute(candidate)
    || candidate.includes("\0")
    || candidate.includes("\uFFFD")
    || candidate.split("/").some(part => !part || part === ".." || part === ".")) {
    invalid("repository-relative literal path");
  }
  return candidate;
}

function insidePath(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === ""
    || (!path.isAbsolute(relative)
      && relative !== ".."
      && !relative.startsWith(`..${path.sep}`));
}

function remoteUrls(value, label) {
  const entries = String(value || "").split(/\r?\n/u)
    .filter(entry => entry.length > 0);
  if (entries.length === 0 || entries.some(entry => entry.trim() !== entry)) {
    invalid(label);
  }
  return entries;
}

function githubRepositoryName(value, label) {
  const result = required(value, label);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(result)) invalid(label);
  return result;
}

function githubRepositoryValue(value, label) {
  const candidate = typeof value === "string" ? value : value?.nameWithOwner;
  return githubRepositoryName(candidate, label);
}

function githubRepositoryFromRemote(value) {
  const source = required(value, "GitHub remote URL");
  const scp = /^git@github\.com:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/u
    .exec(source);
  if (scp) return githubRepositoryName(scp[1], "GitHub remote repository");
  let parsed;
  try {
    parsed = new URL(source);
  } catch {
    invalid("GitHub remote URL");
  }
  if (!new Set(["https:", "ssh:", "git:"]).has(parsed.protocol)
    || parsed.hostname.toLowerCase() !== "github.com"
    || parsed.port
    || parsed.search
    || parsed.hash) {
    invalid("GitHub remote URL");
  }
  const match = /^\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/u
    .exec(parsed.pathname);
  if (!match) invalid("GitHub remote URL");
  return githubRepositoryName(match[1], "GitHub remote repository");
}

function githubRepositoryFromPullRequestUrl(value) {
  const source = required(value, "pull-request URL");
  let parsed;
  try {
    parsed = new URL(source);
  } catch {
    invalid("GitHub pull-request URL");
  }
  const match = /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9][0-9]*)$/u
    .exec(parsed.pathname);
  if (parsed.protocol !== "https:"
    || parsed.hostname.toLowerCase() !== "github.com"
    || parsed.username
    || parsed.password
    || parsed.port
    || parsed.search
    || parsed.hash
    || !match) {
    invalid("GitHub pull-request URL");
  }
  return githubRepositoryName(`${match[1]}/${match[2]}`,
    "GitHub pull-request repository");
}

function pullRequestNumber(url) {
  return positiveInteger(
    Number(new URL(required(url, "pull-request URL")).pathname.split("/").filter(Boolean).at(-1)),
    "pull-request number",
  );
}

function firstSha(value, label) {
  const lines = String(value || "").trim().split("\n").filter(Boolean);
  if (lines.length !== 1) invalid(`unique ${label}`);
  return sha(lines[0].trim().split(/\s+/u)[0], label);
}

function required(value, label) {
  const result = String(value || "").trim();
  if (!result) invalid(label);
  return result;
}

function requiredInstant(value, label) {
  const result = required(value, label);
  if (!Number.isFinite(Date.parse(result))) invalid(label);
  return result;
}

function sha(value, label) {
  const result = String(value || "").trim();
  if (!/^[0-9a-f]{40}$/u.test(result)) invalid(label);
  return result;
}

function digest(value, label) {
  const result = String(value || "").trim();
  if (!/^[0-9a-f]{64}$/u.test(result)) invalid(label);
  return result;
}

function gitMode(value) {
  const result = String(value || "");
  if (!/^(?:100644|100755|120000|160000)$/u.test(result)) {
    invalid("Git entry mode");
  }
  return result;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) invalid(label);
  return value;
}

function invalid(label) {
  throw new Error(`Retired-abandoned owned-dirt recovery has invalid ${label}.`);
}
