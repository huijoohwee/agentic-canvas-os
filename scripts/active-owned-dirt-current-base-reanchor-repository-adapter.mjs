// Responsibility: Bind active-owned-dirt current-base reanchoring to Git, GitHub, cloud, and task authority.
import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertActiveOwnedDirtWithinWriteSet,
  captureActiveOwnedDirtEvidence,
  createActiveOwnedDirtSnapshot,
  requireSameActiveOwnedDirtEvidence,
  verifyActiveOwnedDirtSnapshot,
} from "./active-owned-dirt-recovery-evidence.mjs";
import { withPrivateOperationLock } from "./private-operation-lock.mjs";
import { continueActivePublishTaskAuthoritySuccessor }
  from "./active-publish-task-authority-successor.mjs";
import { proveIgnoredStateRetention } from "./canonical-main-recovery-evidence.mjs";
import {
  canonicalJson,
  digestValue,
  normalizeWriteSet,
  validateLedger,
  writeSetsOverlap,
} from "./cloud-collaboration-primitives.mjs";
import { invokeRepositoryCloudVerifier }
  from "./cloud-collaboration-delivery-verifier.mjs";
import { pseudonymousIdentifier }
  from "./github-cloud-collaboration-mapping.mjs";
import {
  readOwnershipPullRequest,
  waitForOwnershipPullRequestHead,
} from "./device-pull-request-state.mjs";
import { writerLeaseBodyRemainder }
  from "./orphaned-task-authority-recovery-evidence.mjs";
import {
  bindAdmissionCloudAuthority,
  invokeRepositoryCloudAction,
  verifyAdmissionCloudAuthority,
} from "./scoped-lane-cloud-authority.mjs";
import { normalizeBoundAuthority } from "./scoped-lane-cloud-reconciliation.mjs";
import { assertAdmissionMutationAuthority }
  from "./scoped-lane-admission-state.mjs";
import {
  assertCapabilityMatchesBinding,
  assertTaskAuthorityBinding,
  createTaskAuthorityProof,
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
  assertRetiredAbandonedOwnedDirtRepositoryIdentity,
  convergeRetiredAbandonedOwnedDirtLocalReanchor,
  materializeProjectedReanchorObjects,
  projectRetiredAbandonedOwnedDirtCurrentBaseReanchor,
  verifyMaterializedReanchorObjects,
} from "./retired-abandoned-owned-dirt-successor-recovery-repository-adapter.mjs";
import {
  EVIDENCE_SCHEMA,
  OPERATION,
  effectReceipt,
  normalizeReanchorIntent,
  normalizeReanchorPlan,
  operationKey as reanchorOperationKey,
} from "./active-owned-dirt-current-base-reanchor-contract.mjs";

const CONTROLLER_ROOT = fileURLToPath(new URL("..", import.meta.url));
const TERMINAL_CLAIM_STATES = new Set([
  "retired", "released", "revoked", "abandoned", "integrated-preserved",
]);
const SHA = /^[0-9a-f]{40,64}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const PULL_REQUEST_BODY_LIMIT = 65_536;
const TARGET_MARKER_GROWTH_RESERVE = 16_384;

export function createActiveOwnedDirtCurrentBaseReanchorRepositoryAdapter(
  options = {},
  dependencies = {},
) {
  const repository = realpathSync(path.resolve(required(options.repository, "repository")));
  const sessionId = required(options.sessionId, "session ID");
  const requestedTaskAuthorityFile = required(options.taskAuthorityFile, "task-authority file");
  const environment = options.environment || process.env;
  const now = dependencies.now || (() => new Date());
  const fixedOperationAt = dependencies.operationAt || null;
  const execute = dependencies.execute || ((command, args, commandOptions = {}) => execFileSync(
    command,
    args,
    {
      cwd: repository,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
      ...commandOptions,
      env: { ...process.env, ...(commandOptions.env || {}) },
    },
  ));
  const gitRaw = dependencies.gitRaw || ((args, commandOptions = {}) =>
    String(execute("git", args, commandOptions)));
  const git = dependencies.git || (args => gitRaw(args).trim());
  const gh = dependencies.gh || (args => String(execute("gh", args)).trim());
  const ghJson = dependencies.ghJson || (args => JSON.parse(gh(args)));
  const readConditionalPull = dependencies.readConditionalPull || (input =>
    readConditionalPullState({ execute, ...input }));
  const patchConditionalPull = dependencies.patchConditionalPull || (input =>
    patchConditionalPullBody({ execute, ...input }));
  const readLedger = dependencies.readLedger || (({ ledgerRepository, revision }) => JSON.parse(
    gh([
      "api", "--method", "GET",
      "-H", "Accept: application/vnd.github.raw+json",
      `repos/${ledgerRepository}/contents/.agentic/collaboration-ledger.json`,
      "-f", `ref=${revision}`,
    ]),
  ));
  const captureEpochProof = dependencies.captureEpochProof || authenticatedEpochProof;
  const invoke = dependencies.invoke || invokeRepositoryCloudAction;
  const verify = dependencies.verify || invokeRepositoryCloudVerifier;
  const branch = required(git(["branch", "--show-current"]), "attached branch");
  if (options.branch && options.branch !== branch) invalid("requested branch");
  const commonDirectory = realpathSync(path.resolve(
    repository,
    git(["rev-parse", "--path-format=absolute", "--git-common-dir"]),
  ));
  const taskAuthorityFile = externalPrivateInputPath({
    value: requestedTaskAuthorityFile,
    repository,
    commonDirectory,
    git,
    label: "task-authority capability",
  });
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({
    gitCommonDir: commonDirectory,
    taskAuthorityPolicy: "projected",
  });
  const journal = externalJournalPath({
    value: options.journalFile,
    repository,
    commonDirectory,
    git,
  });
  const controllerRevision = dependencies.controllerRevision
    || captureProtectedControllerRevision({ root: CONTROLLER_ROOT, environment });
  let lockHeld = false;

  function readLease() {
    const lease = leaseStore.read(branch);
    if (!lease || lease.schema !== "agentic-writer-lease/v2" || lease.branch !== branch
      || lease.sessionId !== sessionId
      || realpathSync(path.resolve(lease.worktreePath || "")) !== repository) {
      invalid("exact writer lease");
    }
    return lease;
  }

  function sourceLease() {
    const lease = readLease();
    if (lease.status !== "active" || lease.admission?.status !== "admitted"
      || lease.cloudAuthority?.state !== "active") invalid("active admitted writer lease");
    assertTaskAuthorityBinding({ binding: lease.taskAuthority, lease });
    const capability = readTaskAuthorityCapability(taskAuthorityFile);
    assertCapabilityMatchesBinding(capability, lease.taskAuthority);
    return lease;
  }

  function status(lease = readLease()) {
    const result = invoke({
      action: "status",
      ledgerRepository: lease.cloudAuthority.ledgerRepository,
      request: { targetRepository: lease.cloudAuthority.targetRepository },
      environment,
    });
    if (result?.schema !== "agentic-cloud-collaboration-result/v1"
      || result.ok !== true || result.action !== "status" || result.status !== "ready"
      || !Array.isArray(result.claims) || !Number.isSafeInteger(result.sequence)
      || result.sequence < 1 || !SHA.test(String(result.ledgerRevision || ""))
      || !DIGEST.test(String(result.ledgerDigest || ""))) invalid("complete cloud status");
    return result;
  }

  function authenticatedLedger(lease, cloud) {
    const ledger = readLedger({
      ledgerRepository: lease.cloudAuthority.ledgerRepository,
      revision: cloud.ledgerRevision,
    });
    const failures = validateLedger(ledger);
    if (failures.length !== 0 || ledger.sequence !== cloud.sequence
      || ledger.headDigest !== cloud.ledgerDigest || !Array.isArray(ledger.entries)) {
      invalid("authenticated cloud epoch ledger");
    }
    return ledger;
  }

  function authenticatedEpochProof(lease, cloud) {
    const ledger = authenticatedLedger(lease, cloud);
    const latest = new Map();
    for (const entry of ledger.entries) latest.set(entry.claimId, entry);
    const source = sourceClaim(lease, cloud);
    const matchingClaims = [...latest.values()].filter(entry => {
      const claim = entry?.claimCore;
      return claim?.repositoryId === source.repositoryId
        && claim.workItemId === source.workItemId
        && claim.writeSetDigest === lease.admission.writeSetDigest;
    }).map(entry => ({
      claimId: digest(entry.claimId, "historical claim ID"),
      leaseEpoch: positive(entry.claimCore.leaseEpoch, "historical claim epoch"),
      transitionCounter: positive(
        entry.claimCore.transitionCounter,
        "historical claim transition counter",
      ),
      transitionDigest: digest(entry.digest, "historical claim transition digest"),
      state: required(entry.claimCore.state, "historical claim state"),
    })).sort((left, right) => left.claimId.localeCompare(right.claimId));
    const maximumHistoricalLeaseEpoch = matchingClaims.reduce(
      (maximum, claim) => Math.max(maximum, claim.leaseEpoch),
      0,
    );
    if (maximumHistoricalLeaseEpoch >= Number.MAX_SAFE_INTEGER) {
      invalid("target cloud lease epoch");
    }
    const core = {
      schema: `agentic-${OPERATION}-target-epoch-proof/v1`,
      ledgerRevision: cloud.ledgerRevision,
      ledgerDigest: cloud.ledgerDigest,
      ledgerSequence: cloud.sequence,
      ledgerEntriesDigest: digestValue(ledger.entries),
      repositoryId: source.repositoryId,
      workItemId: source.workItemId,
      writeSetDigest: lease.admission.writeSetDigest,
      matchingClaims,
      matchingClaimsDigest: digestValue(matchingClaims),
      maximumHistoricalLeaseEpoch,
      targetCloudLeaseEpoch: maximumHistoricalLeaseEpoch + 1,
    };
    return Object.freeze({ ...core, proofDigest: digestValue(core) });
  }

  function sourceClaim(lease, cloud = status(lease)) {
    const matches = cloud.claims.filter(item => item?.claimId === lease.cloudAuthority.claimId);
    if (matches.length !== 1) invalid("unique source cloud claim");
    const claim = matches[0];
    if (!new Set(["active", "current"]).has(claim.state) || claim.writeAuthority !== true
      || claim.fenceRevision !== lease.cloudAuthority.claimDigest
      || claim.transitionCounter !== lease.cloudAuthority.transitionCounter
      || claim.canonicalBaseRevision !== lease.baseSha
      || claim.laneRevision !== lease.fenceSha
      || claim.deviceId !== pseudonymousIdentifier("device", lease.device)
      || claim.sessionId !== pseudonymousIdentifier("session", lease.sessionId)
      || claim.workItemId !== pseudonymousIdentifier("work-item", lease.scope)
      || !/^github-user:\d+$/u.test(String(claim.actorId || ""))
      || canonicalJson(normalizeWriteSet(claim.declaredWriteScope))
        !== canonicalJson(lease.admission.declaredWriteSet)
      || claim.writeSetDigest !== lease.admission.writeSetDigest
      || claim.leaseEpoch !== lease.cloudAuthority.leaseEpoch
      || claim.reviewRequestId !== lease.cloudAuthority.reviewRequestId
      || (claim.predecessorClaimId ?? null) !== null) invalid("exact source cloud authority");
    return claim;
  }

  function remoteHead() {
    return firstSha(git(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]), "remote head");
  }

  function remoteMain() {
    return firstSha(git(["ls-remote", "--heads", "origin", "refs/heads/main"]), "remote main");
  }

  function readPull(lease = readLease()) {
    const pull = readOwnershipPullRequest({
      url: lease.pullRequestUrl,
      branch,
      ghText: gh,
    });
    const delivery = ghJson(["pr", "view", pull.url, "--json", "autoMergeRequest"]);
    const targetRepository = lease.cloudAuthority.targetRepository;
    if (pull.headRepository?.nameWithOwner !== targetRepository
      || delivery?.autoMergeRequest !== null) invalid("same-repository draft pull request");
    return Object.freeze({ ...pull, autoMergeRequest: null });
  }

  function captureSourceFence(lease) {
    const headSha = objectId(git(["rev-parse", "HEAD"]), "source HEAD");
    const parents = git(["show", "-s", "--format=%P", headSha]).split(/\s+/u).filter(Boolean);
    if (parents.length !== 1) invalid("single-parent source fence");
    const parentSha = objectId(parents[0], "source fence parent");
    const treeSha = objectId(git(["show", "-s", "--format=%T", headSha]), "source fence tree");
    const baseTreeSha = objectId(git(["show", "-s", "--format=%T", lease.baseSha]), "source base tree");
    if (headSha !== lease.fenceSha || parentSha !== lease.baseSha || treeSha !== baseTreeSha) {
      invalid("empty coordination fence");
    }
    return Object.freeze({ headSha, parentSha, treeSha, baseTreeSha });
  }

  function captureTargetProtectedMain(lease, dirt, pull) {
    const protectedMainSha = objectId(git(["rev-parse", "refs/heads/main"]), "local main");
    const localOriginMainSha = objectId(git(["rev-parse", "refs/remotes/origin/main"]), "origin/main");
    const remoteMainSha = remoteMain();
    if (protectedMainSha !== localOriginMainSha || protectedMainSha !== remoteMainSha
      || pull.baseRefOid !== lease.baseSha || protectedMainSha === lease.baseSha) {
      invalid("exact strict protected-main advance");
    }
    git(["merge-base", "--is-ancestor", lease.baseSha, protectedMainSha]);
    const mergeBaseSha = objectId(git(["merge-base", lease.baseSha, protectedMainSha]), "merge base");
    if (mergeBaseSha !== lease.baseSha) invalid("protected-main ancestry");
    const changedPaths = nulPaths(gitRaw([
      "diff", "--name-only", "--no-renames", "-z", lease.baseSha, protectedMainSha, "--",
    ]));
    if (changedPaths.length === 0) invalid("nonempty protected-main advance");
    const scopes = lease.admission.declaredWriteSet;
    const overlap = changedPaths.filter(item => writeSetsOverlap([`path:${item}`], scopes));
    if (overlap.length !== 0) invalid("protected-main admitted-write-set overlap");
    const dirtyPaths = new Set(dirt.entries.map(item => item.path));
    const dirtyOverlapPaths = changedPaths.filter(item => dirtyPaths.has(item));
    const treeSha = objectId(git(["show", "-s", "--format=%T", protectedMainSha]), "protected tree");
    return Object.freeze({
      sourceBaseSha: lease.baseSha,
      protectedMainSha,
      treeSha,
      mergeBaseSha,
      ancestryVerified: true,
      localMainSha: protectedMainSha,
      localOriginMainSha,
      remoteMainSha,
      changedPaths,
      changedPathsDigest: digestValue(changedPaths),
      dirtyOverlapPaths,
      dirtyOverlapPathsDigest: digestValue(dirtyOverlapPaths),
      admittedWriteSetDigest: digestValue(normalizeWriteSet(scopes)),
    });
  }

  function captureEvidence() {
    assertRegisteredWorktree({ repository, branch, gitRaw });
    const lease = sourceLease();
    const fetchUrl = git(["remote", "get-url", "origin"]);
    const pushUrl = git(["remote", "get-url", "--push", "origin"]);
    const operationAt = fixedOperationAt || instant(
      lease.heartbeatAt || lease.acquiredAt,
      "source authority operation time",
    );
    const head = objectId(git(["rev-parse", `refs/heads/${branch}`]), "local branch");
    const remote = remoteHead();
    if (head !== lease.fenceSha || remote !== lease.fenceSha) invalid("source local/remote fence");
    const pull = readPull(lease);
    const repositoryIdentity = assertRetiredAbandonedOwnedDirtRepositoryIdentity({
      targetRepository: lease.cloudAuthority.targetRepository,
      originFetchUrl: fetchUrl,
      originPushUrl: pushUrl,
      pullRequest: pull,
      branch,
    });
    const marker = parseWriterLeasePullRequestBody(pull.body);
    const pullBodyByteLength = Buffer.byteLength(pull.body || "");
    if (pullBodyByteLength + TARGET_MARKER_GROWTH_RESERVE > PULL_REQUEST_BODY_LIMIT) {
      invalid("target pull-request body capacity");
    }
    if (pull.isDraft !== true || pull.state !== "OPEN" || pull.headRefOid !== lease.fenceSha
      || pull.baseRefOid !== lease.baseSha
      || digestValue(marker) !== digestValue(projectWriterLeasePullRequestMarker(lease))) {
      invalid("source pull-request projection");
    }
    const cloud = status(lease);
    const claim = sourceClaim(lease, cloud);
    const targetEpochProof = captureEpochProof(lease, cloud);
    if (claim.reviewRequestId !== `github-pull-request:${pull.id}`) {
      invalid("source claim pull-request identity");
    }
    const overlapClaimIds = cloud.claims.filter(item =>
      item?.claimId !== claim.claimId
      && (item.scopeReserved === true || item.writeAuthority === true
        || item.state === "waiting-successor")
      && !TERMINAL_CLAIM_STATES.has(item.state)
      && writeSetsOverlap(item.declaredWriteScope || [], lease.admission.declaredWriteSet))
      .map(item => item.claimId).sort();
    if (overlapClaimIds.length !== 0) invalid("overlapping live or waiting claims");
    const dirt = assertActiveOwnedDirtWithinWriteSet({
      evidence: captureActiveOwnedDirtEvidence({ repository }),
      declaredWriteSet: lease.admission.declaredWriteSet,
    });
    const sourceFence = captureSourceFence(lease);
    const targetProtectedMain = captureTargetProtectedMain(lease, dirt, pull);
    const ignoredRetention = proveIgnoredStateRetention({
      localHead: lease.baseSha,
      originHead: targetProtectedMain.protectedMainSha,
      gitText: git,
      gitOptional: args => {
        try { return git(args); } catch { return null; }
      },
    });
    const reanchor = projectRetiredAbandonedOwnedDirtCurrentBaseReanchor({
      repository,
      dirt,
      sourceFence,
      targetProtectedMain,
      sourceClaim: { claimId: claim.claimId, retiredAt: operationAt },
      ignoredRetention,
    });
    requireSameActiveOwnedDirtEvidence(dirt, captureActiveOwnedDirtEvidence({ repository }));
    const stableCloud = status(lease);
    if (stableCloud.ledgerRevision !== cloud.ledgerRevision
      || stableCloud.ledgerDigest !== cloud.ledgerDigest
      || stableCloud.sequence !== cloud.sequence
      || sourceClaim(lease, stableCloud).fenceRevision !== claim.fenceRevision
      || git(["rev-parse", "HEAD"]) !== lease.fenceSha
      || git(["rev-parse", `refs/heads/${branch}`]) !== lease.fenceSha
      || remoteHead() !== lease.fenceSha || remoteMain() !== targetProtectedMain.protectedMainSha) {
      invalid("stable read-only evidence capture");
    }
    const core = {
      schema: EVIDENCE_SCHEMA,
      operationAt,
      lease,
      leaseDigest: writerLeaseDigest(lease),
      sourceClaim: claim,
      targetEpochProof,
      sourceFence,
      targetProtectedMain,
      pullRequest: {
        id: required(pull.id, "pull-request ID"),
        url: pull.url,
        number: pullNumber(pull.url),
        state: pull.state,
        isDraft: pull.isDraft,
        headSha: pull.headRefOid,
        baseSha: pull.baseRefOid,
        autoMerge: null,
        bodyDigest: digestValue(pull.body || ""),
        bodyRemainderDigest: digestValue(writerLeaseBodyRemainder(pull.body)),
        bodyByteLength: pullBodyByteLength,
        targetMarkerGrowthReserveBytes: TARGET_MARKER_GROWTH_RESERVE,
        targetBodyLimitBytes: PULL_REQUEST_BODY_LIMIT,
        headRepository: pull.headRepository.nameWithOwner,
      },
      repositoryIdentity,
      dirt,
      ignoredRetention,
      reanchor,
      overlapClaimIds,
      controllerRevision,
    };
    return Object.freeze({ ...core, evidenceDigest: digestValue(core) });
  }

  function assertPlanLive(plan) {
    if (now().getTime() >= Date.parse(plan.planExpiresAt)) {
      throw new Error("Authorized reanchor plan expired before its next effect.");
    }
  }

  function requireSealedSourceAuthority(plan, { requirePlan = false } = {}) {
    if (requirePlan) assertPlanLive(plan);
    const lease = sourceLease();
    if (writerLeaseDigest(lease) !== plan.sourceLeaseDigest
      || lease.cloudAuthority.claimId !== plan.sourceClaimId
      || lease.baseSha !== plan.sourceBaseSha || lease.fenceSha !== plan.sourceFenceSha) {
      invalid("sealed source lease");
    }
    sourceClaim(lease);
    return lease;
  }

  function requireSource(plan) {
    const lease = requireSealedSourceAuthority(plan, { requirePlan: true });
    const current = captureEvidence();
    if (current.evidenceDigest !== plan.evidenceDigest) invalid("sealed source evidence");
    return lease;
  }

  function authorizeSource({ plan }) {
    const lease = requireSource(plan);
    const capability = readTaskAuthorityCapability(taskAuthorityFile);
    assertCapabilityMatchesBinding(capability, lease.taskAuthority);
    const proofTime = now();
    const operation = `${OPERATION}:${plan.planDigest}:source-authorized`;
    const proof = createTaskAuthorityProof({
      capability,
      binding: lease.taskAuthority,
      lease,
      operation,
      issuedAt: proofTime.toISOString(),
    });
    const verified = verifyTaskAuthorityProof({
      proof,
      binding: lease.taskAuthority,
      lease,
      operation,
      now: proofTime,
    });
    return effectReceipt("source-authorized", {
      authoritySubjectId: lease.taskAuthority.authoritySubjectId,
      generation: lease.taskAuthority.generation,
      bindingDigest: lease.taskAuthority.bindingDigest,
      proofDigest: verified.proofDigest,
      verifiedAt: proofTime.toISOString(),
    });
  }

  function snapshot({ plan }) {
    requireSource(plan);
    const value = createActiveOwnedDirtSnapshot({
      repository,
      evidence: plan.evidence.dirt,
      claimId: plan.sourceClaimId,
      planDigest: plan.planDigest,
      timestamp: plan.operationAt,
    });
    requireSource(plan);
    return effectReceipt("snapshotted", {
      snapshotRef: value.snapshotRef,
      snapshotCommitSha: value.commitSha,
      snapshotIndexCommitSha: value.indexCommitSha,
      snapshotReceiptDigest: value.snapshotReceiptDigest,
      indexTreeSha: value.indexTreeSha,
      worktreeTreeSha: value.worktreeTreeSha,
    });
  }

  function snapshotFromIntent(plan, intent) {
    const values = phaseValues(intent, "snapshotted");
    return verifyActiveOwnedDirtSnapshot({
      repository,
      snapshot: {
        ...plan.evidence.dirt,
        schema: "agentic-active-owned-dirt-snapshot/v1",
        planDigest: plan.planDigest,
        claimId: plan.sourceClaimId,
        headSha: plan.sourceFenceSha,
        indexTreeSha: values.indexTreeSha,
        indexCommitSha: values.snapshotIndexCommitSha,
        worktreeTreeSha: values.worktreeTreeSha,
        evidence: plan.evidence.dirt,
        snapshotReceiptDigest: values.snapshotReceiptDigest,
        snapshotRef: values.snapshotRef,
        commitSha: values.snapshotCommitSha,
      },
    });
  }

  function prepareReanchor({ plan, intent }) {
    requireSource(plan);
    snapshotFromIntent(plan, intent);
    const materialized = materializeProjectedReanchorObjects({ repository, plan });
    requireSource(plan);
    return effectReceipt("reanchor-prepared", materialized);
  }

  function observeLocal(plan) {
    try {
      if (git(["rev-parse", "HEAD"]) !== plan.targetLaneRevision
        || git(["rev-parse", `refs/heads/${branch}`]) !== plan.targetLaneRevision
        || git(["write-tree"]) !== plan.targetIndexTreeSha) return null;
      const dirt = captureActiveOwnedDirtEvidence({ repository });
      requireSameActiveOwnedDirtEvidence(plan.evidence.reanchor.targetDirt, dirt);
      return effectReceipt("local-reanchored", {
        sourceFenceSha: plan.sourceFenceSha,
        targetLaneRevision: plan.targetLaneRevision,
        targetIndexTreeSha: plan.targetIndexTreeSha,
        targetWorktreeTreeSha: plan.targetWorktreeTreeSha,
        targetDirtEvidenceDigest: dirt.evidenceDigest,
        authoredBytesPreserved: true,
      });
    } catch { return null; }
  }

  function recoveryEvidence(plan, claim) {
    return digestValue({
      schema: `agentic-${OPERATION}-successor-recovery/v1`,
      planDigest: plan.planDigest,
      claimId: claim.claimId,
      sourceTransitionCounter: claim.transitionCounter,
    });
  }

  function successorRecoveryOperationKey(plan, claim) {
    return `${OPERATION}:successor-recovery:${plan.planDigest}:${claim.transitionCounter}`;
  }

  function authenticateRecoveryLineage(plan, cloud, claim) {
    const ledger = authenticatedLedger(plan.evidence.lease, cloud);
    const history = ledger.entries.filter(entry => entry.claimId === claim.claimId);
    const latest = history.at(-1);
    const previous = history.at(-2);
    if (!latest || !previous || latest.action !== "continue"
      || latest.digest !== claim.transitionDigest
      || latest.claimDigest !== claim.fenceRevision
      || latest.claimCore?.transitionCounter !== claim.transitionCounter
      || latest.claimCore?.recovery?.evidenceDigest
        !== recoveryEvidence(plan, previous.claimCore)
      || latest.idempotencyKey
        !== digestValue(successorRecoveryOperationKey(plan, previous.claimCore))) {
      invalid("authenticated successor recovery lineage");
    }
    return latest;
  }

  function requireSuccessorLineage(
    plan,
    intent,
    cloud,
    claim,
    { allowBound = false } = {},
  ) {
    const sealed = phaseValues(intent, "successor-current");
    const expectedReview = allowBound
      ? new Set([null, plan.evidence.sourceClaim.reviewRequestId]) : new Set([null]);
    if (!claim || claim.claimId !== sealed.claimId || !expectedReview.has(claim.reviewRequestId)
      || claim.transitionCounter < sealed.transitionCounter) {
      invalid("sealed current successor lineage");
    }
    if (claim.transitionCounter === sealed.transitionCounter) {
      if (claim.fenceRevision !== sealed.claimDigest
        || claim.transitionDigest !== sealed.transitionDigest
        || claim.operationReceiptDigest !== sealed.operationReceiptDigest
        || claim.expiresAt !== sealed.expiresAt) {
        invalid("sealed promoted successor transition");
      }
      return claim;
    }
    if (allowBound
      && claim.reviewRequestId === plan.evidence.sourceClaim.reviewRequestId) {
      const bindingEntry = authenticateBoundSuccessor(
        plan,
        cloud,
        claim,
        reanchorOperationKey(plan, "successor-bound"),
      );
      authenticateSuccessorContinuationSuffix({
        plan,
        cloud,
        claim,
        originDigest: bindingEntry.digest,
        expectedReviewRequestId: plan.evidence.sourceClaim.reviewRequestId,
      });
      return claim;
    }
    authenticateSuccessorContinuationSuffix({
      plan,
      cloud,
      claim,
      originDigest: sealed.transitionDigest,
      expectedReviewRequestId: null,
    });
    return claim;
  }

  function ensureCurrentSuccessor({ plan, intent, allowBound = false }) {
    const lease = readLease();
    const before = status(lease);
    let claim = successor(
      plan,
      new Set(["current", "active", "dormant-preserved"]),
      before,
    );
    requireSuccessorLineage(plan, intent, before, claim, { allowBound });
    if (["current", "active"].includes(claim.state)
      && now().getTime() < Date.parse(claim.expiresAt)) {
      return Object.freeze({ cloud: before, claim, recovery: null });
    }
    if (claim.state !== "dormant-preserved" || claim.recordedState !== "current") {
      invalid("recoverable dormant current successor");
    }
    const operationKey = successorRecoveryOperationKey(plan, claim);
    const evidenceDigest = recoveryEvidence(plan, claim);
    const result = invoke({
      action: "continue",
      ledgerRepository: lease.cloudAuthority.ledgerRepository,
      request: {
        targetRepository: lease.cloudAuthority.targetRepository,
        claimId: claim.claimId,
        expectedFenceRevision: claim.fenceRevision,
        expectedLedgerRevision: before.ledgerRevision,
        expectedLedgerDigest: before.ledgerDigest,
        expectedTransitionCounter: claim.transitionCounter,
        mode: "recovery",
        ttlSeconds: plan.ttlSeconds,
        recoveryEvidenceDigest: evidenceDigest,
        deviceId: lease.device,
        sessionId: lease.sessionId,
        idempotencyKey: operationKey,
      },
      environment,
    });
    const after = status(lease);
    const recovered = successor(plan, new Set(["current", "active"]), after);
    if (!recovered || recovered.transitionCounter !== claim.transitionCounter + 1
      || recovered.recovery?.evidenceDigest !== evidenceDigest) {
      invalid("same-claim current successor recovery");
    }
    requireSuccessorOperationResult({
      result,
      action: "continue",
      operationKey,
      plan,
      states: new Set(["current", "active"]),
      observed: recovered,
    });
    requireSuccessorLineage(plan, intent, after, recovered, { allowBound });
    return Object.freeze({
      cloud: after,
      claim: recovered,
      recovery: Object.freeze({
        evidenceDigest,
        operationReceiptDigest: recovered.operationReceiptDigest,
        transitionCounter: recovered.transitionCounter,
      }),
    });
  }

  function reanchorLocal({ plan, intent }) {
    const adopted = observeLocal(plan);
    if (adopted) return adopted;
    ensureCurrentSuccessor({ plan, intent });
    const head = git(["rev-parse", "HEAD"]);
    const localRef = git(["rev-parse", `refs/heads/${branch}`]);
    if (!new Set([plan.sourceFenceSha, plan.targetLaneRevision]).has(head)
      || !new Set([plan.sourceFenceSha, plan.targetLaneRevision]).has(localRef)) {
      invalid("recognized local reanchor state");
    }
    snapshotFromIntent(plan, intent);
    verifyMaterializedReanchorObjects({ repository, plan });
    if (head === plan.targetLaneRevision && localRef === plan.targetLaneRevision) {
      recoverInterruptedLocalReanchor({ plan, intent });
      const recovered = observeLocal(plan);
      if (!recovered) invalid("interrupted local reanchor recovery");
      return recovered;
    }
    ensureCurrentSuccessor({ plan, intent });
    convergeRetiredAbandonedOwnedDirtLocalReanchor({ repository, branch, plan });
    const observed = observeLocal(plan);
    if (!observed || remoteHead() !== plan.sourceFenceSha) invalid("local-only reanchor");
    return observed;
  }

  function recoverInterruptedLocalReanchor({ plan, intent }) {
    const actual = captureActiveOwnedDirtEvidence({ repository });
    const dispositions = new Map(plan.evidence.reanchor.dispositions.map(item => [item.path, item]));
    for (const entry of actual.entries) {
      if (!dispositions.has(entry.path)) invalid("recognized interrupted local reanchor path");
    }
    const actualEntries = new Map(actual.entries.map(entry => [entry.path, entry]));
    for (const disposition of dispositions.values()) {
      const entry = actualEntries.get(disposition.path);
      const actualIndex = entry
        ? { mode: entry.indexMode, blob: entry.indexBlob }
        : { mode: disposition.protected?.mode ?? null, blob: disposition.protected?.blob ?? null };
      const actualWorktree = entry
        ? { mode: entry.worktreeMode, blob: entry.worktreeBlob, type: entry.worktreeType }
        : {
          mode: disposition.protected?.mode ?? null,
          blob: disposition.protected?.blob ?? null,
          type: disposition.protected?.type
            ?? worktreeTypeForMode(disposition.protected?.mode ?? null),
        };
      if (!matchesOnePair(actualIndex, [disposition.sourceIndex, disposition.targetIndex])
        || !matchesOnePair(
          actualWorktree,
          [disposition.sourceWorktree, disposition.targetWorktree],
        )) invalid("recognized interrupted local reanchor overlay");
    }
    snapshotFromIntent(plan, intent);
    verifyMaterializedReanchorObjects({ repository, plan });
    const ignored = proveIgnoredStateRetention({
      localHead: plan.sourceBaseSha,
      originHead: plan.targetCanonicalBaseSha,
      gitText: git,
      gitOptional: args => {
        try { return git(args); } catch { return null; }
      },
    });
    if (digestValue(ignored) !== digestValue(plan.evidence.reanchor.ignoredRetention)) {
      invalid("interrupted local reanchor ignored-state retention");
    }
    ensureCurrentSuccessor({ plan, intent });
    git(["read-tree", "--reset", "-u", plan.targetWorktreeTreeSha]);
    git(["read-tree", plan.targetIndexTreeSha]);
  }

  function matchesOnePair(actual, candidates) {
    return candidates.some(candidate => (candidate?.mode ?? null) === (actual.mode ?? null)
      && (candidate?.blob ?? null) === (actual.blob ?? null)
      && (candidate?.type === undefined || candidate?.type === (actual.type ?? null)));
  }

  function worktreeTypeForMode(mode) {
    if (mode === null) return "deleted";
    if (mode === "120000") return "symlink";
    if (["100644", "100755"].includes(mode)) return "file";
    return null;
  }

  function observeRemote(plan) {
    const local = observeLocal(plan);
    if (!local || remoteHead() !== plan.targetLaneRevision) return null;
    const lease = readLease();
    const pull = readPull(lease);
    const marker = parseWriterLeasePullRequestBody(pull.body);
    const sourceMarkerDigest = digestValue(projectWriterLeasePullRequestMarker(plan.evidence.lease));
    const markerDigest = digestValue(marker);
    const targetLease = lease.baseSha === plan.targetCanonicalBaseSha
      && lease.fenceSha === plan.targetLaneRevision;
    const targetMarkerDigest = targetLease
      ? digestValue(projectWriterLeasePullRequestMarker(lease)) : null;
    if (pull.id !== plan.pullRequestId || pull.url !== plan.pullRequestUrl
      || pull.state !== "OPEN" || pull.isDraft !== true
      || pull.headRefOid !== plan.targetLaneRevision
      || pull.baseRefOid !== plan.targetCanonicalBaseSha
      || digestValue(writerLeaseBodyRemainder(pull.body))
        !== plan.pullRequestBodyRemainderDigest
      || (markerDigest !== sourceMarkerDigest && markerDigest !== targetMarkerDigest)) {
      return null;
    }
    return effectReceipt("remote-reanchored", {
      branch,
      sourceFenceSha: plan.sourceFenceSha,
      targetLaneRevision: plan.targetLaneRevision,
      remoteHeadSha: plan.targetLaneRevision,
      forceWithLease: true,
    });
  }

  function reanchorRemote({ plan, intent }) {
    const adopted = observeRemote(plan);
    if (adopted) return adopted;
    ensureCurrentSuccessor({ plan, intent });
    if (!observeLocal(plan)) invalid("local reanchor before remote CAS");
    const before = remoteHead();
    if (before === plan.sourceFenceSha) {
      const fetchUrl = git(["remote", "get-url", "origin"]);
      const pushUrl = git(["remote", "get-url", "--push", "origin"]);
      const identity = assertRetiredAbandonedOwnedDirtRepositoryIdentity({
        targetRepository: plan.evidence.lease.cloudAuthority.targetRepository,
        originFetchUrl: fetchUrl,
        originPushUrl: pushUrl,
        pullRequest: readPull(readLease()),
        branch,
      });
      if (canonicalJson(identity) !== canonicalJson(plan.evidence.repositoryIdentity)) {
        invalid("sealed repository identity witness");
      }
      ensureCurrentSuccessor({ plan, intent });
      git([
        "push",
        `--force-with-lease=refs/heads/${branch}:${plan.sourceFenceSha}`,
        pushUrl,
        `${plan.targetLaneRevision}:refs/heads/${branch}`,
      ]);
    } else if (before !== plan.targetLaneRevision) invalid("remote branch CAS precondition");
    waitForOwnershipPullRequestHead({
      url: plan.pullRequestUrl,
      branch,
      expectedHeadSha: plan.targetLaneRevision,
      ghText: gh,
    });
    const observed = observeRemote(plan);
    if (!observed) invalid("remote reanchor convergence");
    return observed;
  }

  function isExactSuccessor(plan, states, item) {
    const source = plan.evidence.sourceClaim;
    return Boolean(states.has(item?.state)
      && item.predecessorClaimId === plan.sourceClaimId
      && item.actorId === source.actorId && item.repositoryId === source.repositoryId
      && item.workItemId === source.workItemId
      && item.deviceId === source.deviceId
      && item.sessionId === source.sessionId
      && item.canonicalBaseRevision === plan.targetCanonicalBaseSha
      && item.laneRevision === plan.targetLaneRevision
      && item.writeSetDigest === plan.targetWriteSetDigest
      && canonicalJson(normalizeWriteSet(item.declaredWriteScope))
        === canonicalJson(plan.targetDeclaredWriteSet)
      && item.leaseEpoch === plan.targetCloudLeaseEpoch);
  }

  function successor(plan, states, cloud = status(plan.evidence.lease)) {
    const matches = cloud.claims.filter(item => isExactSuccessor(plan, states, item));
    if (matches.length > 1) invalid("unique exact cloud successor");
    return matches[0] || null;
  }

  function claimValues(kind, claim, receiptDigest = null) {
    return effectReceipt(kind, {
      claimId: digest(claim.claimId, "successor claim ID"),
      claimDigest: digest(claim.fenceRevision, "successor claim digest"),
      transitionCounter: positive(claim.transitionCounter, "successor transition counter"),
      transitionDigest: digest(claim.transitionDigest, "successor transition digest"),
      operationReceiptDigest: digest(claim.operationReceiptDigest, "successor operation receipt"),
      expiresAt: instant(claim.expiresAt, "successor expiry"),
      state: claim.state,
      cloudReceiptDigest: receiptDigest === null ? null
        : digest(receiptDigest, "successor cloud receipt"),
    });
  }

  function requireAuthenticatedCloudOperation({ result, action, operationKey, claim }) {
    const receipt = result?.operationReceipt;
    if (result?.schema !== "agentic-cloud-collaboration-result/v1"
      || result.ok !== true || result.action !== action
      || result.claimDigest !== claim.fenceRevision
      || !DIGEST.test(String(result.receipt?.receiptDigest || ""))
      || receipt?.operation !== action
      || receipt.claimId !== claim.claimId
      || receipt.claimDigest !== claim.fenceRevision
      || receipt.fenceRevision !== claim.fenceRevision
      || receipt.idempotencyKey !== digestValue(operationKey)
      || !DIGEST.test(String(receipt.requestDigest || ""))
      || !DIGEST.test(String(receipt.receiptDigest || ""))
      || receipt.receiptDigest !== claim.operationReceiptDigest) {
      invalid(`authenticated ${action} cloud operation`);
    }
    return receipt;
  }

  function requireSuccessorOperationResult({ result, action, operationKey, plan, states, observed }) {
    const claim = result?.claim;
    if (!isExactSuccessor(plan, states, claim)) invalid(`exact ${action} successor result`);
    const operationReceipt = requireAuthenticatedCloudOperation({
      result, action, operationKey, claim,
    });
    for (const field of [
      "claimId", "fenceRevision", "transitionCounter", "transitionDigest",
      "operationReceiptDigest", "expiresAt", "state", "reviewRequestId",
      "deviceId", "sessionId",
    ]) {
      if ((claim[field] ?? null) !== (observed[field] ?? null)) {
        invalid(`${action} successor operation/status join`);
      }
    }
    claimValues(`${action}-validated`, claim, result.receipt.receiptDigest);
    return operationReceipt;
  }

  function waitingClaimRequest({ plan, lease, operationKey }) {
    return Object.freeze({
      targetRepository: lease.cloudAuthority.targetRepository,
      workItemId: lease.scope,
      canonicalBaseSha: plan.targetCanonicalBaseSha,
      headSha: plan.targetLaneRevision,
      declaredWriteSet: plan.targetDeclaredWriteSet,
      predecessorClaimId: plan.sourceClaimId,
      leaseEpoch: plan.targetCloudLeaseEpoch,
      ttlSeconds: plan.ttlSeconds,
      deviceId: lease.device,
      sessionId: lease.sessionId,
      idempotencyKey: operationKey,
      actorId: githubActorId(plan.evidence.sourceClaim.actorId),
    });
  }

  function claimWaitingSuccessor({ plan, operationKey }) {
    requireSource(plan);
    const lease = readLease();
    const before = status(lease);
    if (!sourceClaimPresent(plan, before)) invalid("current source before successor claim");
    const result = invoke({
      action: "claim",
      ledgerRepository: lease.cloudAuthority.ledgerRepository,
      request: waitingClaimRequest({ plan, lease, operationKey }),
      environment,
    });
    const cloud = status(lease);
    const waiting = successor(plan, new Set(["waiting-successor"]), cloud);
    if (!waiting) invalid("waiting successor claim");
    requireSuccessorOperationResult({
      result,
      action: "claim",
      operationKey,
      plan,
      states: new Set(["waiting-successor"]),
      observed: waiting,
    });
    return claimValues("successor-waiting", waiting, result.receipt.receiptDigest);
  }

  function sourceClaimPresent(plan, cloud) {
    return cloud.claims.some(item => item?.claimId === plan.sourceClaimId
      && item.fenceRevision === plan.sourceClaimDigest
      && item.transitionCounter === plan.sourceClaimTransitionCounter);
  }

  function retireSource({ plan, intent, operationKey }) {
    const lease = readLease();
    const before = status(lease);
    const waiting = successor(plan, new Set(["waiting-successor"]), before);
    if (!waiting || waiting.claimId !== phaseValues(intent, "successor-waiting").claimId
      || !sourceClaimPresent(plan, before)) invalid("source retirement subject");
    const handoff = retirementHandoff(plan, waiting.claimId);
    const result = invoke({
      action: "retire",
      ledgerRepository: lease.cloudAuthority.ledgerRepository,
      request: retirementRequest({ plan, lease, operationKey, handoff }),
      environment,
    });
    const receipt = requireRetirementResult({ result, plan, operationKey });
    const after = status(lease);
    if (after.claims.some(item => item.claimId === plan.sourceClaimId)
      || !successor(plan, new Set(["waiting-successor"]), after)) {
      invalid("source retirement convergence");
    }
    return retirementEffect({ plan, waiting, handoff, receipt });
  }

  function retirementHandoff(plan, successorClaimId) {
    return Object.freeze({
      planDigest: plan.planDigest,
      sourceFenceSha: plan.sourceFenceSha,
      targetLaneRevision: plan.targetLaneRevision,
      successorClaimId,
      targetDirtEvidenceDigest: plan.targetDirtEvidenceDigest,
    });
  }

  function retirementRequest({ plan, lease, operationKey, handoff }) {
    return Object.freeze({
        targetRepository: lease.cloudAuthority.targetRepository,
        claimId: plan.sourceClaimId,
        expectedFenceRevision: plan.sourceClaimDigest,
        expectedTransitionCounter: plan.sourceClaimTransitionCounter,
        reason: "superseded",
        finalRevision: plan.sourceFenceSha,
        reviewRequestId: plan.evidence.sourceClaim.reviewRequestId,
        bytesDigest: digestValue({ ...handoff, kind: "bytes" }),
        namedChecksDigest: digestValue({ ...handoff, kind: "checks" }),
        handoffEvidenceDigest: digestValue({ ...handoff, kind: "handoff" }),
        deviceId: lease.device,
        sessionId: lease.sessionId,
        idempotencyKey: operationKey,
    });
  }

  function requireRetirementResult({ result, plan, operationKey }) {
    const claim = result?.claim;
    if (result?.schema !== "agentic-cloud-collaboration-result/v1"
      || result.ok !== true || result.action !== "retire"
      || claim?.claimId !== plan.sourceClaimId
      || claim.actorId !== plan.evidence.sourceClaim.actorId
      || claim.repositoryId !== plan.evidence.sourceClaim.repositoryId
      || claim.workItemId !== plan.evidence.sourceClaim.workItemId
      || claim.deviceId !== plan.evidence.sourceClaim.deviceId
      || claim.sessionId !== plan.evidence.sourceClaim.sessionId
      || claim.canonicalBaseRevision !== plan.sourceBaseSha
      || claim.laneRevision !== plan.sourceFenceSha
      || !new Set(["retired", "released"]).has(claim.state)
      || !DIGEST.test(String(result.receipt?.receiptDigest || ""))
      || !DIGEST.test(String(claim.operationReceiptDigest || ""))
      || !Number.isSafeInteger(claim.transitionCounter)
      || claim.transitionCounter <= plan.sourceClaimTransitionCounter) {
      invalid("exact source retirement result");
    }
    const operationReceipt = requireAuthenticatedCloudOperation({
      result, action: "retire", operationKey, claim,
    });
    return Object.freeze({
      receiptDigest: result.receipt.receiptDigest,
      claimDigest: digest(claim.fenceRevision, "retired claim digest"),
      transitionCounter: claim.transitionCounter,
      transitionDigest: digest(claim.transitionDigest, "retired transition digest"),
      operationReceiptDigest: claim.operationReceiptDigest,
      requestDigest: operationReceipt.requestDigest,
      idempotencyKeyDigest: operationReceipt.idempotencyKey,
      state: claim.state,
    });
  }

  function retirementEffect({ plan, waiting, handoff, receipt }) {
    return effectReceipt("source-retired", {
      sourceClaimId: plan.sourceClaimId,
      successorClaimId: waiting.claimId,
      handoffEvidenceDigest: digestValue(handoff),
      retirementReceiptDigest: receipt.receiptDigest,
      retiredClaimDigest: receipt.claimDigest,
      retiredTransitionCounter: receipt.transitionCounter,
      retiredTransitionDigest: receipt.transitionDigest,
      retiredOperationReceiptDigest: receipt.operationReceiptDigest,
      retirementRequestDigest: receipt.requestDigest,
      retirementIdempotencyKeyDigest: receipt.idempotencyKeyDigest,
      retiredState: receipt.state,
    });
  }

  function promoteSuccessor({ plan, intent, operationKey }) {
    const lease = readLease();
    const before = status(lease);
    if (before.claims.some(item => item.claimId === plan.sourceClaimId)) {
      invalid("source retirement before successor promotion");
    }
    const waiting = successor(plan, new Set(["waiting-successor"]), before);
    if (!waiting || waiting.claimId !== phaseValues(intent, "successor-waiting").claimId) {
      invalid("sealed waiting successor");
    }
    return promoteSuccessorOperation({ plan, lease, operationKey, waiting });
  }

  function promoteSuccessorOperation({ plan, lease, operationKey, waiting }) {
    const result = invoke({
      action: "continue",
      ledgerRepository: lease.cloudAuthority.ledgerRepository,
      request: promotionRequest({ plan, lease, operationKey, waiting }),
      environment,
    });
    const cloud = status(lease);
    const observed = successor(
      plan,
      new Set(["current", "active", "dormant-preserved"]),
      cloud,
    );
    const promoted = result?.claim;
    if (!isExactSuccessor(plan, new Set(["current", "active"]), promoted)
      || promoted.reviewRequestId !== null || !observed
      || observed.reviewRequestId !== null
      || (observed.state === "dormant-preserved" && observed.recordedState !== "current")) {
      invalid("promoted current successor");
    }
    requireAuthenticatedCloudOperation({
      result, action: "continue", operationKey, claim: promoted,
    });
    for (const field of [
      "claimId", "fenceRevision", "transitionCounter", "transitionDigest",
      "operationReceiptDigest", "expiresAt", "reviewRequestId", "deviceId", "sessionId",
    ]) {
      if ((promoted[field] ?? null) !== (observed[field] ?? null)) {
        invalid("promotion operation/status join");
      }
    }
    if (![promoted.state, "dormant-preserved"].includes(observed.state)) {
      invalid("promotion operation/status state join");
    }
    claimValues("promotion-validated", promoted, result.receipt.receiptDigest);
    return claimValues("successor-current", promoted, result.receipt.receiptDigest);
  }

  function promotionRequest({ plan, lease, operationKey, waiting }) {
    return Object.freeze({
      targetRepository: lease.cloudAuthority.targetRepository,
      claimId: waiting.claimId,
      expectedFenceRevision: waiting.claimDigest || waiting.fenceRevision,
      expectedTransitionCounter: waiting.transitionCounter,
      mode: "promote",
      ttlSeconds: plan.ttlSeconds,
      deviceId: lease.device,
      sessionId: lease.sessionId,
      idempotencyKey: operationKey,
    });
  }

  function authorityFromClaim(plan, cloud, claim) {
    return normalizeBoundAuthority({
      result: {
        schema: "agentic-cloud-collaboration-result/v1",
        ok: true,
        action: "status",
        ledgerRevision: cloud.ledgerRevision,
        ledgerDigest: cloud.ledgerDigest,
        claimDigest: claim.fenceRevision,
        claim,
      },
      authority: {
        ...plan.evidence.lease.cloudAuthority,
        canonicalBaseSha: plan.targetCanonicalBaseSha,
        laneRevision: plan.targetLaneRevision,
        cloudDeclaredWriteScope: plan.targetDeclaredWriteSet,
        writeSetDigest: plan.targetWriteSetDigest,
        leaseEpoch: plan.targetCloudLeaseEpoch,
        reviewRequestId: claim.reviewRequestId,
        state: claim.state === "current" ? "active" : claim.state,
        manifestDigest: plan.targetManifestDigest,
      },
      manifest: plan.evidence.lease.admission,
      deviceId: plan.device,
      sessionId: plan.sessionId,
    });
  }

  function authenticateBoundSuccessor(plan, cloud, claim, operationKey) {
    const ledger = authenticatedLedger(plan.evidence.lease, cloud);
    const history = ledger.entries.filter(entry => entry.claimId === claim.claimId);
    let priorReviewRequestId = null;
    let bindingEntry = null;
    for (const entry of history) {
      const reviewRequestId = entry.claimCore?.reviewRequestId ?? null;
      if (reviewRequestId === plan.evidence.sourceClaim.reviewRequestId
        && priorReviewRequestId === null && bindingEntry === null) {
        bindingEntry = entry;
      }
      priorReviewRequestId = reviewRequestId;
    }
    if (!bindingEntry || bindingEntry.action !== "continue"
      || bindingEntry.idempotencyKey !== digestValue(operationKey)
      || bindingEntry.claimCore?.canonicalBaseRevision !== plan.targetCanonicalBaseSha
      || bindingEntry.claimCore?.laneRevision !== plan.targetLaneRevision
      || bindingEntry.claimCore?.state !== "current"
      || bindingEntry.claimCore?.reviewRequestId
        !== plan.evidence.sourceClaim.reviewRequestId
      || history.slice(history.indexOf(bindingEntry)).some(entry =>
        entry.claimCore?.reviewRequestId !== plan.evidence.sourceClaim.reviewRequestId)) {
      invalid("authenticated successor bind lineage");
    }
    return bindingEntry;
  }

  function authenticateSuccessorContinuationSuffix({
    plan,
    cloud,
    claim,
    originDigest,
    expectedReviewRequestId,
  }) {
    const ledger = authenticatedLedger(plan.evidence.lease, cloud);
    const history = ledger.entries.filter(entry => entry.claimId === claim.claimId);
    const start = history.findIndex(entry => entry.digest === originDigest);
    if (start < 0) invalid("successor continuation suffix origin");
    for (let index = start + 1; index < history.length; index += 1) {
      const previous = history[index - 1].claimCore;
      const entry = history[index];
      const current = entry.claimCore;
      if (entry.action !== "continue"
        || !isExactSuccessor(plan, new Set(["current", "active"]), current)
        || current.reviewRequestId !== expectedReviewRequestId
        || current.transitionCounter !== previous.transitionCounter + 1) {
        invalid("authenticated successor continuation suffix");
      }
      const recoveryChanged = canonicalJson(current.recovery ?? null)
        !== canonicalJson(previous.recovery ?? null);
      if (recoveryChanged) {
        if (!current.recovery
          || current.recovery.evidenceDigest !== recoveryEvidence(plan, previous)
          || entry.idempotencyKey
            !== digestValue(successorRecoveryOperationKey(plan, previous))) {
          invalid("authenticated successor recovery suffix");
        }
      } else if (current.heartbeatCounter !== previous.heartbeatCounter + 1
        || Date.parse(current.expiresAt) <= Date.parse(previous.expiresAt)
        || current.canonicalBaseRevision !== previous.canonicalBaseRevision
        || current.laneRevision !== previous.laneRevision
        || current.writeSetDigest !== previous.writeSetDigest
        || canonicalJson(current.declaredWriteScope)
          !== canonicalJson(previous.declaredWriteScope)
        || current.deviceId !== previous.deviceId || current.sessionId !== previous.sessionId
        || current.predecessorClaimId !== previous.predecessorClaimId) {
        invalid("authenticated successor renewal suffix");
      }
    }
    const latest = history.at(-1);
    if (!latest || latest.digest !== claim.transitionDigest
      || latest.claimDigest !== claim.fenceRevision
      || latest.claimCore?.transitionCounter !== claim.transitionCounter) {
      invalid("authenticated successor latest transition");
    }
    return latest;
  }

  function bindSuccessor({ plan, intent, operationKey }) {
    const lease = readLease();
    const live = ensureCurrentSuccessor({ plan, intent, allowBound: true });
    const cloud = live.cloud;
    const current = live.claim;
    if (![null, plan.evidence.sourceClaim.reviewRequestId].includes(current.reviewRequestId)) {
      invalid("unbound current successor");
    }
    const pull = readPull(lease);
    if (pull.headRefOid !== plan.targetLaneRevision) invalid("successor pull-request head");
    if (current.reviewRequestId === plan.evidence.sourceClaim.reviewRequestId) {
      const bindingEntry = authenticateBoundSuccessor(plan, cloud, current, operationKey);
      const verified = verifyAdmissionCloudAuthority({
        authority: authorityFromClaim(plan, cloud, current),
        manifest: plan.evidence.lease.admission,
        canonicalBaseSha: plan.targetCanonicalBaseSha,
        environment,
        inspect: invoke,
        invoke: verify,
      });
      return effectReceipt("successor-bound", {
        authority: verified.authority,
        verification: verified.verification,
        verificationReceiptDigest: verified.verification.receiptDigest,
        verifiedAt: verified.verification.verifiedAt,
        boundAt: instant(bindingEntry.evaluationTime, "successor bind time"),
        bindRequestDigest: bindingEntry.requestDigest,
        bindIdempotencyKeyDigest: bindingEntry.idempotencyKey,
        bindLedgerEntryDigest: bindingEntry.digest,
      });
    }
    let operationResult = null;
    const exactBindInvoke = input => {
      const result = invoke(input);
      if (input?.action === "continue"
        && input.request?.mode === "projection"
        && input.request.idempotencyKey === operationKey) {
        operationResult = result;
      }
      return result;
    };
    const bound = bindAdmissionCloudAuthority({
      authority: authorityFromClaim(plan, cloud, current),
      manifest: plan.evidence.lease.admission,
      branch,
      headSha: plan.targetLaneRevision,
      pullRequestNumber: plan.pullRequestNumber,
      reviewRequestId: plan.evidence.sourceClaim.reviewRequestId,
      deviceId: plan.device,
      sessionId: plan.sessionId,
      idempotencyKey: operationKey,
      returnVerification: true,
      environment,
      invoke: exactBindInvoke,
      inspect: invoke,
      verify,
    });
    const boundClaim = operationResult?.claim;
    if (!isExactSuccessor(plan, new Set(["current", "active"]), boundClaim)
      || boundClaim.reviewRequestId !== plan.evidence.sourceClaim.reviewRequestId) {
      invalid("exact bound successor operation result");
    }
    requireAuthenticatedCloudOperation({
      result: operationResult,
      action: "continue",
      operationKey,
      claim: boundClaim,
    });
    const alreadyBound = current.reviewRequestId === plan.evidence.sourceClaim.reviewRequestId;
    if (bound.authority.claimId !== current.claimId
      || bound.authority.reviewRequestId !== plan.evidence.sourceClaim.reviewRequestId
      || bound.authority.canonicalBaseSha !== plan.targetCanonicalBaseSha
      || bound.authority.laneRevision !== plan.targetLaneRevision
      || bound.authority.state !== "active"
      || bound.authority.operationReceiptDigest !== boundClaim.operationReceiptDigest
      || (!alreadyBound && boundClaim.operationReceiptDigest === current.operationReceiptDigest)
      || (alreadyBound && boundClaim.operationReceiptDigest !== current.operationReceiptDigest)) {
      invalid("operation-derived bound successor");
    }
    const boundCloud = status(lease);
    const observedBound = successor(plan, new Set(["current", "active"]), boundCloud);
    if (!observedBound || observedBound.reviewRequestId
      !== plan.evidence.sourceClaim.reviewRequestId) {
      invalid("bound successor status projection");
    }
    const bindingEntry = authenticateBoundSuccessor(
      plan,
      boundCloud,
      observedBound,
      operationKey,
    );
    return effectReceipt("successor-bound", {
      authority: bound.authority,
      verification: bound.verification,
      verificationReceiptDigest: bound.verification.receiptDigest,
      verifiedAt: bound.verification.verifiedAt,
      boundAt: instant(bindingEntry.evaluationTime, "successor bind time"),
      bindRequestDigest: bindingEntry.requestDigest,
      bindIdempotencyKeyDigest: bindingEntry.idempotencyKey,
      bindLedgerEntryDigest: bindingEntry.digest,
    });
  }

  function targetAdmission(plan, authority, verification) {
    const source = plan.evidence.lease.admission;
    return Object.freeze({
      ...source,
      planReceiptDigest: plan.planDigest,
      admissionReceiptDigest: verification.receiptDigest,
      admittedReportDigest: digestValue({
        schema: `agentic-${OPERATION}-admitted-report/v1`,
        planDigest: plan.planDigest,
        claimId: authority.claimId,
      }),
      preservationReceiptDigest: digestValue({
        schema: `agentic-${OPERATION}-preservation/v1`,
        planDigest: plan.planDigest,
        sourceAdmissionDigest: digestValue(source),
        sourceFenceSha: plan.sourceFenceSha,
        targetLaneRevision: plan.targetLaneRevision,
        targetDirtEvidenceDigest: plan.targetDirtEvidenceDigest,
      }),
    });
  }

  function deterministicTarget(plan, intent, boundOverride = null) {
    const source = plan.evidence.lease;
    const bound = boundOverride || phaseValues(intent, "successor-bound");
    const current = phaseValues(intent, "successor-current");
    const authority = bound.authority;
    const verification = bound.verification;
    if (authority.claimId !== current.claimId
      || authority.canonicalBaseSha !== plan.targetCanonicalBaseSha
      || authority.laneRevision !== plan.targetLaneRevision
      || authority.leaseEpoch !== plan.targetCloudLeaseEpoch
      || authority.reviewRequestId !== plan.evidence.sourceClaim.reviewRequestId
      || authority.writeSetDigest !== plan.targetWriteSetDigest
      || authority.state !== "active"
      || authority.transitionCounter < current.transitionCounter
      || now().getTime() >= Date.parse(authority.expiresAt)
      || verification.claimId !== authority.claimId
      || verification.receiptDigest !== bound.verificationReceiptDigest) {
      invalid("sealed bound successor authority");
    }
    const admission = targetAdmission(plan, authority, verification);
    const targetCore = {
      ...source,
      baseSha: plan.targetCanonicalBaseSha,
      fenceSha: plan.targetLaneRevision,
      admission,
      cloudAuthority: authority,
      heartbeatAt: bound.verifiedAt,
      expiresAt: authority.expiresAt,
    };
    const continuation = continueActivePublishTaskAuthoritySuccessor({
      sourceLease: source,
      targetLease: targetCore,
      cloudOperationReceiptDigest: authority.operationReceiptDigest,
      cloudVerificationReceiptDigest: admission.admissionReceiptDigest,
      boundAt: bound.boundAt,
    });
    const annotation = Object.freeze({
      schema: `agentic-${OPERATION}-lease/v1`,
      status: "reanchored",
      planDigest: plan.planDigest,
      sourceClaimId: plan.sourceClaimId,
      successorClaimId: authority.claimId,
      sourceBaseSha: plan.sourceBaseSha,
      sourceFenceSha: plan.sourceFenceSha,
      targetCanonicalBaseSha: plan.targetCanonicalBaseSha,
      targetLaneRevision: plan.targetLaneRevision,
      targetDirtEvidenceDigest: plan.targetDirtEvidenceDigest,
      taskContinuationReceiptDigest: continuation.receipt.receiptDigest,
    });
    const lease = Object.freeze({
      ...targetCore,
      taskAuthority: continuation.binding,
      activePublishTaskAuthoritySuccessor: continuation.receipt,
      activeOwnedDirtCurrentBaseReanchor: annotation,
    });
    assertTaskAuthorityBinding({ binding: lease.taskAuthority, lease });
    const capability = readTaskAuthorityCapability(taskAuthorityFile);
    assertCapabilityMatchesBinding(capability, lease.taskAuthority);
    return Object.freeze({ lease, continuation, capability });
  }

  function targetProjection(plan, intent) {
    try {
      const observed = readLease();
      requireTargetLeaseShape(plan, observed, phaseValues(intent, "successor-current").claimId);
      const capability = readTaskAuthorityCapability(taskAuthorityFile);
      assertCapabilityMatchesBinding(capability, observed.taskAuthority);
      return {
        expected: Object.freeze({
          lease: observed,
          capability,
          continuation: Object.freeze({
            binding: observed.taskAuthority,
            receipt: observed.activePublishTaskAuthoritySuccessor,
          }),
        }),
        observed,
        leaseDigest: writerLeaseDigest(observed),
      };
    } catch { return null; }
  }

  function requireTargetLeaseShape(plan, lease, successorClaimId) {
    const source = plan.evidence.lease;
    if (lease?.schema !== "agentic-writer-lease/v2" || lease.status !== "active"
      || lease.branch !== source.branch || lease.scope !== source.scope
      || lease.device !== source.device || lease.sessionId !== source.sessionId
      || lease.epoch !== source.epoch || lease.worktreePath !== source.worktreePath
      || lease.pullRequestUrl !== source.pullRequestUrl
      || lease.baseSha !== plan.targetCanonicalBaseSha
      || lease.fenceSha !== plan.targetLaneRevision
      || lease.admission?.status !== "admitted"
      || lease.admission.manifestDigest !== source.admission.manifestDigest
      || lease.admission.writeSetDigest !== source.admission.writeSetDigest
      || canonicalJson(lease.admission.declaredWriteSet)
        !== canonicalJson(source.admission.declaredWriteSet)
      || lease.cloudAuthority?.claimId !== successorClaimId
      || lease.cloudAuthority.canonicalBaseSha !== plan.targetCanonicalBaseSha
      || lease.cloudAuthority.laneRevision !== plan.targetLaneRevision
      || lease.cloudAuthority.leaseEpoch !== plan.targetCloudLeaseEpoch
      || lease.cloudAuthority.reviewRequestId !== plan.evidence.sourceClaim.reviewRequestId
      || lease.cloudAuthority.writeSetDigest !== plan.targetWriteSetDigest
      || lease.activeOwnedDirtCurrentBaseReanchor?.planDigest !== plan.planDigest
      || lease.activePublishTaskAuthoritySuccessor?.sourceClaimId !== plan.sourceClaimId
      || lease.activePublishTaskAuthoritySuccessor?.targetClaimId !== successorClaimId) {
      invalid("recognized target writer lease");
    }
    assertTaskAuthorityBinding({ binding: lease.taskAuthority, lease });
    return lease;
  }

  function proveTarget(plan, target, suffix) {
    if (now().getTime() >= Date.parse(target.lease.expiresAt)) invalid("live successor authority");
    const remote = verifyAdmissionCloudAuthority({
      authority: target.lease.cloudAuthority,
      manifest: target.lease.admission,
      canonicalBaseSha: plan.targetCanonicalBaseSha,
      environment,
      inspect: invoke,
      invoke: verify,
    });
    const proofTime = now();
    const operation = `${OPERATION}:${plan.planDigest}:${suffix}`;
    const proof = createTaskAuthorityProof({
      capability: target.capability,
      binding: target.lease.taskAuthority,
      lease: target.lease,
      operation,
      issuedAt: proofTime.toISOString(),
    });
    const verifiedProof = verifyTaskAuthorityProof({
      proof,
      binding: target.lease.taskAuthority,
      lease: target.lease,
      operation,
      now: proofTime,
    });
    const mutation = assertAdmissionMutationAuthority({
      lease: target.lease,
      cloudAuthority: remote.authority,
      remoteAuthorityVerification: remote.verification,
    });
    return Object.freeze({
      remote,
      taskProofDigest: verifiedProof.proofDigest,
      mutationAuthorityReceiptDigest: mutation.receiptDigest,
    });
  }

  function projectLocal({ plan, intent }) {
    if (!observeRemote(plan)) invalid("remote reanchor before local authority CAS");
    const liveBound = bindSuccessor({
      plan,
      intent,
      operationKey: reanchorOperationKey(plan, "successor-bound"),
    });
    const existing = targetProjection(plan, intent);
    const target = existing
      ? refreshedTarget(plan, existing.expected, liveBound)
      : deterministicTarget(plan, intent, liveBound);
    const possession = proveTarget(plan, target, "target-possession");
    const expectedLeaseDigest = existing?.leaseDigest || plan.sourceLeaseDigest;
    const expectedClaimId = existing?.observed.cloudAuthority.claimId || plan.sourceClaimId;
    const result = mutateWriterLeaseRegistry({
      leaseStore,
      branch,
      expectedLeaseDigest,
      expectedClaimId,
      action: ({ registry, lease }) => {
        if (writerLeaseDigest(lease) !== expectedLeaseDigest) invalid("writer lease CAS");
        return {
          registry: { ...registry, leases: { ...registry.leases, [branch]: target.lease } },
          lease: target.lease,
          changed: canonicalJson(lease) !== canonicalJson(target.lease),
        };
      },
    });
    syncFileAndParent(leaseStore.statePath);
    return effectReceipt("local-cas", {
      leaseDigest: writerLeaseDigest(result.lease),
      claimId: result.lease.cloudAuthority.claimId,
      taskBindingDigest: result.lease.taskAuthority.bindingDigest,
      taskContinuationReceiptDigest: target.continuation.receipt.receiptDigest,
      taskProofDigest: possession.taskProofDigest,
      mutationAuthorityReceiptDigest: possession.mutationAuthorityReceiptDigest,
    });
  }

  function refreshedTarget(plan, existing, liveBound) {
    const authority = liveBound.authority;
    const lease = Object.freeze({
      ...existing.lease,
      cloudAuthority: authority,
      heartbeatAt: liveBound.verifiedAt,
      expiresAt: authority.expiresAt,
    });
    requireTargetLeaseShape(plan, lease, authority.claimId);
    assertTaskAuthorityBinding({ binding: lease.taskAuthority, lease });
    const capability = readTaskAuthorityCapability(taskAuthorityFile);
    assertCapabilityMatchesBinding(capability, lease.taskAuthority);
    return Object.freeze({
      lease,
      capability,
      continuation: existing.continuation,
    });
  }

  function observePullProjection(plan, intent) {
    const projection = targetProjection(plan, intent);
    if (!projection) return null;
    const pull = readPull(projection.observed);
    const marker = parseWriterLeasePullRequestBody(pull.body);
    if (pull.state !== "OPEN" || pull.isDraft !== true
      || pull.headRefOid !== plan.targetLaneRevision
      || pull.baseRefOid !== plan.targetCanonicalBaseSha
      || digestValue(writerLeaseBodyRemainder(pull.body)) !== plan.pullRequestBodyRemainderDigest
      || digestValue(marker) !== digestValue(projectWriterLeasePullRequestMarker(projection.observed))) {
      return null;
    }
    return effectReceipt("pr-projected", {
      pullRequestId: pull.id,
      headSha: pull.headRefOid,
      baseSha: pull.baseRefOid,
      markerDigest: digestValue(marker),
      bodyRemainderDigest: digestValue(writerLeaseBodyRemainder(pull.body)),
    });
  }

  function recognizedTargetMarker(plan, intent, marker) {
    return Boolean(marker?.schema === "agentic-writer-lease/v2"
      && marker.status === "active"
      && marker.branch === plan.branch && marker.scope === plan.scope
      && marker.device === plan.device && marker.sessionId === plan.sessionId
      && marker.baseSha === plan.targetCanonicalBaseSha
      && marker.fenceSha === plan.targetLaneRevision
      && marker.admission?.manifestDigest === plan.targetManifestDigest
      && marker.admission?.writeSetDigest === plan.targetWriteSetDigest
      && marker.cloudAuthority?.claimId
        === phaseValues(intent, "successor-current").claimId
      && marker.cloudAuthority?.canonicalBaseSha === plan.targetCanonicalBaseSha
      && marker.cloudAuthority?.laneRevision === plan.targetLaneRevision
      && marker.cloudAuthority?.leaseEpoch === plan.targetCloudLeaseEpoch
      && marker.cloudAuthority?.reviewRequestId
        === plan.evidence.sourceClaim.reviewRequestId
      && marker.cloudAuthority?.writeSetDigest === plan.targetWriteSetDigest
      && marker.taskAuthority?.authoritySubjectId
        === plan.evidence.lease.taskAuthority.authoritySubjectId);
  }

  function projectPullRequest({ plan, intent }) {
    projectLocal({ plan, intent });
    const projection = targetProjection(plan, intent);
    if (!projection) invalid("local target before pull-request marker");
    const expectedMarker = projectWriterLeasePullRequestMarker(projection.observed);
    withHeartbeatProjectionFence({
      leaseStore,
      branch,
      expectedLeaseDigest: projection.leaseDigest,
      expectedClaimId: projection.observed.cloudAuthority.claimId,
      action: () => {
        const stable = targetProjection(plan, intent);
        if (!stable) invalid("stable target before pull-request projection");
        proveTarget(plan, stable.expected, "pull-request-projection");
        const pull = readPull(stable.observed);
        if (pull.id !== plan.pullRequestId || pull.url !== plan.pullRequestUrl
          || pull.headRefOid !== plan.targetLaneRevision
          || pull.baseRefOid !== plan.targetCanonicalBaseSha
          || digestValue(writerLeaseBodyRemainder(pull.body))
            !== plan.pullRequestBodyRemainderDigest) {
          invalid("exact target pull-request subject");
        }
        const marker = parseWriterLeasePullRequestBody(pull.body);
        const markerDigest = digestValue(marker);
        const sourceMarkerDigest = digestValue(
          projectWriterLeasePullRequestMarker(plan.evidence.lease),
        );
        const targetMarkerDigest = digestValue(expectedMarker);
        if (markerDigest !== sourceMarkerDigest && markerDigest !== targetMarkerDigest
          && !recognizedTargetMarker(plan, intent, marker)) {
          invalid("recognized source/target pull-request marker");
        }
        if (markerDigest !== targetMarkerDigest) {
          const targetRepository = stable.observed.cloudAuthority.targetRepository;
          const body = updateWriterLeasePullRequestBody(pull.body, stable.observed);
          if (Buffer.byteLength(body) > 65_536) invalid("pull-request body limit");
          updateReanchorPullRequestBodyConditionally({
            read: () => readConditionalPull({
              targetRepository,
              pullRequestNumber: plan.pullRequestNumber,
            }),
            patch: input => patchConditionalPull({
              targetRepository,
              pullRequestNumber: plan.pullRequestNumber,
              ...input,
            }),
            expected: {
              id: plan.pullRequestId,
              number: plan.pullRequestNumber,
              url: plan.pullRequestUrl,
              state: "OPEN",
              isDraft: true,
              headBranch: plan.branch,
              headSha: pull.headRefOid,
              headRepository: targetRepository,
              baseSha: pull.baseRefOid,
              body: pull.body,
            },
            body,
          });
        }
        if (!targetProjection(plan, intent)) invalid("target lease changed during PR projection");
      },
    });
    const observed = observePullProjection(plan, intent);
    if (!observed) invalid("pull-request target projection");
    return observed;
  }

  function verifyTerminal({ plan, intent }) {
    projectPullRequest({ plan, intent });
    const projection = targetProjection(plan, intent);
    if (!projection || !observeRemote(plan)) invalid("terminal local/remote target");
    const pullProjection = observePullProjection(plan, intent);
    if (!pullProjection) invalid("terminal pull-request projection");
    requireSameActiveOwnedDirtEvidence(
      plan.evidence.reanchor.targetDirt,
      captureActiveOwnedDirtEvidence({ repository }),
    );
    verifyMaterializedReanchorObjects({ repository, plan });
    const possession = proveTarget(plan, projection.expected, "terminal");
    return effectReceipt("verified", {
      claimId: projection.observed.cloudAuthority.claimId,
      leaseDigest: projection.leaseDigest,
      markerDigest: pullProjection.markerDigest,
      targetDirtEvidenceDigest: plan.targetDirtEvidenceDigest,
      taskBindingDigest: projection.observed.taskAuthority.bindingDigest,
      taskProofDigest: possession.taskProofDigest,
      mutationAuthorityReceiptDigest: possession.mutationAuthorityReceiptDigest,
    });
  }

  function reconcile({ plan, intent, phase, operationKey }) {
    try {
      if (phase === "source-authorized") return null;
      if (phase === "snapshotted") return null;
      if (phase === "reanchor-prepared") {
        verifyMaterializedReanchorObjects({ repository, plan });
        return effectReceipt("reanchor-prepared", {
          coordinationCommitSha: plan.coordinationCommitSha,
          coordinationTreeSha: plan.coordinationTreeSha,
          sourceIndexTreeSha: plan.sourceIndexTreeSha,
          sourceWorktreeTreeSha: plan.sourceWorktreeTreeSha,
          targetIndexTreeSha: plan.targetIndexTreeSha,
          targetWorktreeTreeSha: plan.targetWorktreeTreeSha,
          dispositionsDigest: plan.dispositionsDigest,
        });
      }
      if (phase === "successor-waiting") {
        const lease = readLease();
        const claim = successor(plan, new Set(["waiting-successor"]));
        if (!claim) return null;
        const result = invoke({
          action: "claim",
          ledgerRepository: lease.cloudAuthority.ledgerRepository,
          request: waitingClaimRequest({ plan, lease, operationKey }),
          environment,
        });
        requireSuccessorOperationResult({
          result,
          action: "claim",
          operationKey,
          plan,
          states: new Set(["waiting-successor"]),
          observed: claim,
        });
        return claimValues("successor-waiting", claim, result.receipt.receiptDigest);
      }
      if (phase === "local-reanchored") {
        return observeLocal(plan);
      }
      if (phase === "remote-reanchored") {
        return observeRemote(plan);
      }
      if (phase === "source-retired") {
        const cloud = status(plan.evidence.lease);
        const waiting = successor(plan, new Set(["waiting-successor"]), cloud);
        if (!waiting || cloud.claims.some(item => item.claimId === plan.sourceClaimId)) return null;
        const handoff = retirementHandoff(plan, waiting.claimId);
        const result = invoke({
          action: "retire",
          ledgerRepository: plan.evidence.lease.cloudAuthority.ledgerRepository,
          request: retirementRequest({
            plan,
            lease: plan.evidence.lease,
            operationKey,
            handoff,
          }),
          environment,
        });
        const receipt = requireRetirementResult({ result, plan, operationKey });
        return retirementEffect({ plan, waiting, handoff, receipt });
      }
      if (phase === "successor-current") {
        const lease = readLease();
        const claim = successor(
          plan,
          new Set(["current", "active", "dormant-preserved"]),
        );
        if (!claim || claim.reviewRequestId !== null
          || (claim.state === "dormant-preserved" && claim.recordedState !== "current")) {
          return null;
        }
        const waiting = phaseValues(intent, "successor-waiting");
        return promoteSuccessorOperation({ plan, lease, operationKey, waiting });
      }
      if (phase === "successor-bound") {
        return bindSuccessor({ plan, intent, operationKey });
      }
      if (phase === "local-cas") {
        const projection = targetProjection(plan, intent);
        if (!projection) return null;
        const possession = proveTarget(plan, projection.expected, "target-reconcile");
        return effectReceipt("local-cas", {
          leaseDigest: projection.leaseDigest,
          claimId: projection.observed.cloudAuthority.claimId,
          taskBindingDigest: projection.observed.taskAuthority.bindingDigest,
          taskContinuationReceiptDigest: projection.expected.continuation.receipt.receiptDigest,
          taskProofDigest: possession.taskProofDigest,
          mutationAuthorityReceiptDigest: possession.mutationAuthorityReceiptDigest,
        });
      }
      if (phase === "pr-projected") return observePullProjection(plan, intent);
      if (phase === "verified") return verifyTerminal({ plan, intent, operationKey });
    } catch { return null; }
    return null;
  }

  return Object.freeze({
    captureEvidence,
    async withFence(action) {
      return withPrivateOperationLock({
        file: `${journal}.lock`,
        context: { operation: OPERATION, branch, sessionId, journal },
        now,
        action: async () => {
          if (lockHeld) invalid("single execution fence");
          lockHeld = true;
          try { return await action(); }
          finally { lockHeld = false; }
        },
      });
    },
    readIntent() { return readJournal(journal); },
    writeIntent({ expected, value }) {
      if (!lockHeld) invalid("fenced journal write");
      return writeJournal(journal, expected, value);
    },
    reconcile,
    authorizeSource,
    snapshot,
    prepareReanchor,
    reanchorLocal,
    reanchorRemote,
    claimWaitingSuccessor,
    retireSource,
    promoteSuccessor,
    bindSuccessor,
    projectLocal,
    projectPullRequest,
    verifyTerminal,
  });
}

function phaseValues(intent, phase) {
  const values = intent?.receipts?.[phase]?.values;
  if (!values) invalid(`${phase} journal values`);
  return values;
}

function readJournal(file) {
  if (!existsSync(file)) return null;
  assertPrivateFile(file, "reanchor journal");
  return normalizeReanchorIntent(JSON.parse(readFileSync(file, "utf8")));
}

function writeJournal(file, expected, value) {
  const current = readJournal(file);
  if (canonicalJson(current) !== canonicalJson(expected)) invalid("journal CAS");
  const normalized = normalizeReanchorIntent(value);
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  const descriptor = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(normalized, null, 2)}\n`);
    fsyncSync(descriptor);
  } finally { closeSync(descriptor); }
  renameSync(temporary, file);
  const directory = openSync(path.dirname(file), "r");
  try { fsyncSync(directory); } finally { closeSync(directory); }
  return normalized;
}

function externalJournalPath({ value, repository, commonDirectory, git }) {
  const target = path.resolve(required(value, "external journal file"));
  const parent = realpathSync(path.dirname(target));
  const metadata = lstatSync(parent);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0
    || (typeof process.getuid === "function" && metadata.uid !== process.getuid())) {
    invalid("owner-only journal parent");
  }
  const canonical = path.join(parent, path.basename(target));
  const roots = [repository, commonDirectory, ...registeredRoots(git)];
  if (roots.some(root => inside(root, canonical))) invalid("external journal containment");
  if (existsSync(canonical)) assertPrivateFile(canonical, "reanchor journal");
  return canonical;
}

function externalPrivateInputPath({ value, repository, commonDirectory, git, label }) {
  const target = realpathSync(path.resolve(required(value, label)));
  assertPrivateFile(target, label);
  const roots = [repository, commonDirectory, ...registeredRoots(git)];
  if (roots.some(root => inside(root, target))) invalid(`${label} containment`);
  return target;
}

function syncFileAndParent(file) {
  const descriptor = openSync(file, "r");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
  const directory = openSync(path.dirname(file), "r");
  try { fsyncSync(directory); } finally { closeSync(directory); }
}

function readConditionalPullState({ execute, targetRepository, pullRequestNumber }) {
  const response = String(execute("gh", [
    "api", "--include", "--method", "GET",
    "-H", "Accept: application/vnd.github+json",
    `repos/${targetRepository}/pulls/${pullRequestNumber}`,
  ]));
  const split = response.search(/\r?\n\r?\n\s*\{/u);
  if (split < 0) invalid("conditional pull-request response");
  const etag = response.slice(0, split).match(/^etag:\s*(.+)$/imu)?.[1]?.trim();
  let raw;
  try { raw = JSON.parse(response.slice(response.indexOf("{", split))); }
  catch { invalid("conditional pull-request JSON"); }
  if (!etag || !raw) invalid("conditional pull-request ETag");
  return Object.freeze({
    etag,
    id: raw.node_id,
    number: raw.number,
    url: raw.html_url,
    state: String(raw.state || "").toUpperCase(),
    isDraft: raw.draft === true,
    headBranch: raw.head?.ref,
    headSha: raw.head?.sha,
    headRepository: raw.head?.repo?.full_name,
    baseSha: raw.base?.sha,
    body: String(raw.body || ""),
  });
}

function patchConditionalPullBody({
  execute,
  targetRepository,
  pullRequestNumber,
  expectedEtag,
  body,
}) {
  return execute("gh", [
    "api", "--method", "PATCH",
    "-H", "Accept: application/vnd.github+json",
    "-H", `If-Match: ${expectedEtag}`,
    `repos/${targetRepository}/pulls/${pullRequestNumber}`,
    "-f", `body=${body}`,
  ]);
}

export function updateReanchorPullRequestBodyConditionally({
  read,
  patch,
  expected,
  body,
}) {
  if (typeof read !== "function" || typeof patch !== "function" || !expected) {
    invalid("conditional pull-request adapter");
  }
  const before = read();
  requireConditionalPullSnapshot(expected, before);
  if (before.body !== expected.body) invalid("conditional pull-request body drift");
  patch({ expectedEtag: before.etag, body });
  const after = read();
  requireConditionalPullSnapshot({ ...expected, body }, after);
  if (after.body !== body) invalid("conditional pull-request body readback");
  return Object.freeze({
    beforeEtag: before.etag,
    afterEtag: after.etag,
    bodyDigest: digestValue(body),
  });
}

function requireConditionalPullSnapshot(expected, actual) {
  if (!actual || typeof actual.etag !== "string" || !actual.etag.trim()) {
    invalid("conditional pull-request ETag");
  }
  for (const field of [
    "id", "number", "url", "state", "isDraft", "headBranch", "headSha",
    "headRepository", "baseSha",
  ]) {
    if (actual[field] !== expected[field]) invalid(`conditional pull-request ${field}`);
  }
  return actual;
}

function assertPrivateFile(file, label) {
  const metadata = lstatSync(file);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || (metadata.mode & 0o777) !== 0o600
    || (typeof process.getuid === "function" && metadata.uid !== process.getuid())) {
    invalid(`${label} privacy`);
  }
}

function registeredRoots(git) {
  return git(["worktree", "list", "--porcelain", "-z"]).split("\0")
    .filter(item => item.startsWith("worktree "))
    .map(item => realpathSync(item.slice("worktree ".length)));
}

function assertRegisteredWorktree({ repository, branch, gitRaw }) {
  const records = gitRaw(["worktree", "list", "--porcelain", "-z"])
    .split("\0\0").map(record => record.split("\0"));
  const matches = records.filter(record =>
    record.includes(`branch refs/heads/${branch}`)
    && record.some(item => item === `worktree ${repository}`));
  if (matches.length !== 1) invalid("registered attached worktree");
}

function captureProtectedControllerRevision({ root, environment }) {
  const controller = realpathSync(path.resolve(root));
  const run = args => String(execFileSync("git", args, {
    cwd: controller,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...environment },
  })).trim();
  const head = objectId(run(["rev-parse", "HEAD"]), "controller HEAD");
  if (run(["branch", "--show-current"]) !== "main"
    || run(["status", "--porcelain=v1", "--untracked-files=all"])
    || run(["rev-parse", "refs/heads/main"]) !== head
    || run(["rev-parse", "refs/remotes/origin/main"]) !== head
    || firstSha(run(["ls-remote", "--heads", "origin", "refs/heads/main"]), "controller remote") !== head) {
    invalid("clean exact protected controller checkout");
  }
  return head;
}

function nulPaths(value) {
  const paths = String(value).split("\0").filter(Boolean);
  for (const item of paths) {
    if (!item || item.startsWith("/") || item.includes("\\")
      || item.split("/").some(part => !part || part === "." || part === "..")) {
      invalid("canonical protected change path");
    }
  }
  const sorted = [...new Set(paths)].sort();
  if (sorted.length !== paths.length || sorted.length > 100_000) invalid("bounded unique changed paths");
  return sorted;
}

function pullNumber(url) {
  const match = String(url).match(/\/pull\/(\d+)(?:[/?#]|$)/u);
  const value = Number(match?.[1]);
  if (!Number.isSafeInteger(value) || value < 1) invalid("pull-request number");
  return value;
}

function githubActorId(value) {
  const match = String(value || "").match(/^github-user:(\d+)$/u);
  const actorId = Number(match?.[1]);
  if (!Number.isSafeInteger(actorId) || actorId < 1) invalid("source GitHub actor ID");
  return actorId;
}

function firstSha(value, label) {
  const match = String(value).trim().match(/^([0-9a-f]{40,64})(?:\s|$)/u);
  if (!match) invalid(label);
  return match[1];
}

function objectId(value, label) {
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

function instant(value, label) {
  if (!value || new Date(value).toISOString() !== value) invalid(label);
  return value;
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function required(value, label) {
  if (typeof value !== "string" || !value.trim()) invalid(label);
  return value.trim();
}

function invalid(label) {
  throw new Error(`Active-owned-dirt current-base reanchor ${label} is invalid.`);
}
