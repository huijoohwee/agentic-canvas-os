// Responsibility: Join raw cloud provenance to one local lease CAS and hidden-marker edit.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  canonicalJson, digestValue, normalizeWriteSet, validateLedger, writeSetsOverlap,
} from "./cloud-collaboration-primitives.mjs";
import {
  buildExpiredPublishedBindAheadCleanDescendantRecoveryEvidence,
  visiblePullRequestBodyDigest,
} from "./expired-published-bind-ahead-clean-descendant-recovery-evidence.mjs";
import {
  buildExpiredPublishedBindAheadCleanDescendantRecoveryBindAdoption,
  normalizeExpiredPublishedBindAheadCleanDescendantRecoveryIntent,
  normalizeExpiredPublishedBindAheadCleanDescendantRecoveryPlan,
} from "./expired-published-bind-ahead-clean-descendant-recovery-contract.mjs";
import { continueExpiredCommittedHeartbeatCloudAuthority }
  from "./expired-committed-heartbeat-cloud-authority.mjs";
import { captureExpiredCommittedHeartbeatSnapshot }
  from "./expired-committed-heartbeat-evidence.mjs";
import { verifyAdmissionCloudAuthority, invokeRepositoryCloudAction }
  from "./scoped-lane-cloud-authority.mjs";
import { assertAdmissionMutationAuthority }
  from "./scoped-lane-admission-state.mjs";
import { normalizeBoundAuthority }
  from "./scoped-lane-cloud-reconciliation.mjs";
import { authorizeTaskBoundLeaseMutation }
  from "./task-bound-lane-authority-store.mjs";
import {
  createWriterLeaseStore, parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker, updateWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";
import { mutateWriterLeaseRegistry, writerLeaseDigest }
  from "./writer-lease-registry-cas.mjs";

const JOURNAL_SCHEMA =
  "agentic-expired-published-bind-ahead-clean-descendant-recovery-journal/v1";
const LOCK_SCHEMA =
  "agentic-expired-published-bind-ahead-clean-descendant-recovery-lock/v1";
const MAX_LOCK_BYTES = 4_096;
const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const BRANCH_FENCE_SCHEMA =
  "agentic-expired-published-bind-ahead-clean-descendant-recovery-fence/v1";
const CLOUD_SIDECAR_SCHEMA =
  "agentic-expired-published-bind-ahead-clean-descendant-cloud-sidecar/v1";
const CLOUD_GENERATION_SCHEMA =
  "agentic-expired-published-bind-ahead-clean-descendant-cloud-generation/v1";
const MINIMUM_PROJECTION_HORIZON_MS = 120_000;
const MAX_CLOUD_GENERATIONS = 64;
const BRANCH_CONTROLLER_FENCE_FIELDS = Object.freeze([
  "scopeExpansionIntents",
  "activeOwnedDirtRecoveryIntents",
  "expiredCommittedScopeExpansionIntents",
  "reviewedLaneRevisionIntents",
  "reviewedLaneEntrypointFences",
]);

export function projectExpiredPublishedBindAheadCleanDescendantLease({
  sourceLease, publishedFenceSha, cloudAuthority, verifiedAt,
} = {}) {
  requiredSha(publishedFenceSha, "published fence");
  if (!sourceLease?.taskAuthority || cloudAuthority?.claimId
      !== sourceLease?.cloudAuthority?.claimId
    || cloudAuthority?.laneRevision !== publishedFenceSha
    || cloudAuthority?.state !== "active") {
    invalid("target lease authority");
  }
  return Object.freeze({
    ...sourceLease,
    fenceSha: publishedFenceSha,
    cloudAuthority,
    heartbeatAt: instant(verifiedAt, "cloud verification time"),
    expiresAt: instant(cloudAuthority.expiresAt, "cloud expiry"),
    taskAuthority: sourceLease.taskAuthority,
  });
}

export function assertExpiredPublishedBindAheadCleanDescendantGitFrame({
  expected,
  observed,
} = {}) {
  if (observed?.headSha !== expected?.localHeadSha
    || observed?.treeSha !== expected?.localTreeSha
    || observed?.localBranchSha !== expected?.localHeadSha
    || observed?.remoteBranchSha !== expected?.publishedHeadSha
    || observed?.attachedBranch !== expected?.branch
    || observed?.symbolicBranch !== expected?.branch
    || observed?.status !== "") {
    invalid("preserved R/H Git frame");
  }
  return true;
}

export function reverifyExpiredPublishedBindAheadCleanDescendantMutationAuthority({
  plan: planValue,
  lease,
  currentAuthority,
  environment = process.env,
  verifyCloud = verifyAdmissionCloudAuthority,
  assertMutationAuthority = assertAdmissionMutationAuthority,
} = {}) {
  const plan = normalizeExpiredPublishedBindAheadCleanDescendantRecoveryPlan(
    planValue,
  );
  const refreshed = verifyCloud({
    authority: Object.freeze({ ...currentAuthority, state: "active" }),
    manifest: manifestFromPlan(plan),
    canonicalBaseSha: plan.evidence.committed.sourceLease.baseSha,
    environment,
  });
  if (!refreshed?.authority || !refreshed?.verification
    || canonicalJson(stableCloudAuthority(refreshed.authority))
      !== canonicalJson(stableCloudAuthority(currentAuthority))) {
    invalid("fresh terminal cloud verification");
  }
  const runtimeLease = Object.freeze({
    ...lease,
    cloudAuthority: refreshed.authority,
    expiresAt: refreshed.authority.expiresAt,
  });
  const receipt = assertMutationAuthority({
    lease: runtimeLease,
    cloudAuthority: refreshed.authority,
    remoteAuthorityVerification: refreshed.verification,
    evaluatedAt: refreshed.verification.verifiedAt,
  });
  return Object.freeze({
    authority: refreshed.authority,
    verification: refreshed.verification,
    receipt,
  });
}

export function normalizeExpiredPublishedBindAheadCloudSidecar({
  plan: planValue,
  sidecar,
} = {}) {
  const plan = normalizeExpiredPublishedBindAheadCleanDescendantRecoveryPlan(
    planValue,
  );
  return normalizeCloudSidecar(plan, sidecar);
}

export function createRepositoryExpiredPublishedBindAheadCleanDescendantRecoveryAdapter(
  options = {},
  dependencies = {},
) {
  const resolveRealpath = dependencies.realpath || realpathSync;
  const repository = resolveRealpath(path.resolve(required(options.repository, "repository")));
  const sessionId = required(options.sessionId, "session ID");
  const pullRequestNumber = positive(options.pullRequestNumber, "pull-request number");
  const ttlSeconds = bounded(options.ttlSeconds || 1800, "TTL seconds", 300, 3600);
  const environment = dependencies.environment || process.env;
  const now = dependencies.now || (() => new Date());
  const execute = dependencies.execute || ((command, argumentsList) => execFileSync(
    command, argumentsList, { cwd: repository, encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
  ));
  const git = dependencies.git || (args => String(execute("git", args)).trim());
  const gitOptional = dependencies.gitOptional || (args => {
    const result = spawnSync("git", args, { cwd: repository, encoding: "utf8" });
    return result.status === 0 ? result.stdout.trim() : "";
  });
  const gh = dependencies.gh || (args => String(execute("gh", args)).trim());
  const inspectCloud = dependencies.inspectCloud || invokeRepositoryCloudAction;
  const recoverCloud = dependencies.recoverCloud
    || continueExpiredCommittedHeartbeatCloudAuthority;
  const verifyCloud = dependencies.verifyCloud || verifyAdmissionCloudAuthority;
  const isProcessAlive = dependencies.isProcessAlive || processIsAlive;
  const uuid = dependencies.uuid || randomUUID;
  const authorizeTaskMutation = dependencies.authorizeTaskMutation
    || authorizeTaskBoundLeaseMutation;
  const mutateRegistry = dependencies.mutateRegistry || mutateWriterLeaseRegistry;
  const captureSnapshot = dependencies.captureSnapshot
    || captureExpiredCommittedHeartbeatSnapshot;
  const branch = required(git(["branch", "--show-current"]), "attached branch");
  const commonDirectory = resolveRealpath(path.resolve(
    repository, git(["rev-parse", "--git-common-dir"]),
  ));
  const taskAuthorityFile = options.taskAuthorityFile
    ? resolveRealpath(path.resolve(options.taskAuthorityFile)) : null;
  if (taskAuthorityFile && inside(repository, taskAuthorityFile)) {
    throw new Error("Task authority must remain outside the repository worktree.");
  }
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({
    gitCommonDir: commonDirectory,
    taskAuthorityPolicy: "projected",
  });
  const operationId = digestValue({ repository, branch, pullRequestNumber });
  const journalPath = path.resolve(dependencies.journalPath || path.join(
    commonDirectory, "agentic-canvas-os",
    "expired-published-bind-ahead-clean-descendant-recovery", `${operationId}.json`,
  ));
  if (!inside(commonDirectory, journalPath)) invalid("private journal path");
  const lockPath = `${journalPath}.lock`;
  const readLedgerSnapshot = dependencies.readLedgerSnapshot || (({
    ledgerRepository, revision,
  }) => JSON.parse(gh([
    "api", "--method", "GET",
    `repos/${ledgerRepository}/contents/.agentic/collaboration-ledger.json`,
    "-f", `ref=${revision}`,
    "-H", "Accept: application/vnd.github.raw+json",
  ])));
  const editBody = dependencies.editBody || ((url, body) => {
    gh(["pr", "edit", url, "--body", body]);
  });
  let runtimeCloud = null;

  function readPlanEvidence() {
    const observedAt = now().toISOString();
    assertBranchControllerFieldsClear(leaseStore.readRegistry(), branch);
    const committedSnapshot = captureSnapshot({
      repo: repository, branch, gitText: git, gitOptional, ghText: gh,
      leaseStore, sessionId, now,
    });
    const lease = committedSnapshot.lease;
    const pullRequest = readReview();
    const status = readStatus(lease.cloudAuthority);
    const liveClaim = exactClaim(status, lease.cloudAuthority.claimId);
    const sourceLedger = readLedgerSnapshot({
      ledgerRepository: lease.cloudAuthority.ledgerRepository,
      revision: lease.cloudAuthority.ledgerRevision,
    });
    const currentLedger = readLedgerSnapshot({
      ledgerRepository: lease.cloudAuthority.ledgerRepository,
      revision: status.ledgerRevision,
    });
    const competitors = overlappingClaims(status.claims, liveClaim);
    return buildExpiredPublishedBindAheadCleanDescendantRecoveryEvidence({
      observedAt,
      repository: lease.cloudAuthority.targetRepository,
      committedSnapshot,
      pullRequest,
      cloud: {
        evaluationTime: status.evaluationTime || observedAt,
        status: { ledgerRevision: status.ledgerRevision,
          ledgerDigest: status.ledgerDigest, sequence: status.sequence },
        sourceLedgerSnapshot: { revision: lease.cloudAuthority.ledgerRevision,
          ledger: sourceLedger },
        currentLedgerSnapshot: { revision: status.ledgerRevision, ledger: currentLedger },
        liveClaim,
        inventoryDigest: status.inventoryDigest || digestValue(status.claims),
        verificationReceiptDigest: status.verificationReceiptDigest
          || status.receiptDigest || digestValue({ ledgerRevision: status.ledgerRevision,
            ledgerDigest: status.ledgerDigest, sequence: status.sequence,
            claims: status.claims }),
        noOverlappingCompetitor: competitors.length === 0,
        competitorCount: competitors.length,
      },
    });
  }

  function readPlanTtlSeconds() {
    return ttlSeconds;
  }

  function assertRuntimeSubject(value) {
    const plan = normalizeExpiredPublishedBindAheadCleanDescendantRecoveryPlan(value);
    const evidence = plan.evidence;
    if (evidence.committed.sourceLease.worktreePath !== repository
      || evidence.committed.branch !== branch
      || evidence.committed.sourceLease.sessionId !== sessionId
      || evidence.pullRequest.number !== pullRequestNumber
      || plan.ttlSeconds !== ttlSeconds) {
      invalid("runtime subject");
    }
    return plan;
  }

  function authorizeTask(planValue, { intent = null } = {}) {
    const plan = assertRuntimeSubject(planValue);
    const frame = captureFrame(plan);
    requireStates(frame, { local: "source", marker: "source" });
    if (classifyBranchControllerFence(
      frame.registry,
      branch,
      branchControllerFence(plan, intent, branch),
    ) !== "absent") invalid("pre-authority branch-controller fence");
    if (!taskAuthorityFile) throw new Error("Recovery run requires --task-authority.");
    const receipt = authorizeTaskMutation({
      lease: plan.evidence.committed.sourceLease,
      capabilityPath: taskAuthorityFile,
      operation: plan.taskAuthorityOperation,
      now: now(),
    });
    if (receipt.bindingDigest !== plan.evidence.committed.taskAuthorityBindingDigest) {
      invalid("retained task-authority binding");
    }
    return Object.freeze({
      taskAuthorityReceiptDigest: receipt.receiptDigest,
      bindingDigest: receipt.bindingDigest,
      taskProofDigest: receipt.proofDigest,
    });
  }

  function acquireBranchFence(planValue, { intent } = {}) {
    const plan = assertRuntimeSubject(planValue);
    const fence = branchControllerFence(plan, intent, branch);
    const result = mutateRegistry({
      leaseStore,
      branch,
      expectedLeaseDigest: plan.evidence.committed.sourceLeaseDigest,
      expectedClaimId: plan.evidence.cloud.liveClaim.claimId,
      action: ({ registry, lease }) => {
        const state = classifyBranchControllerFence(registry, branch, fence);
        if (state === "owned") {
          return { registry, lease, changed: false,
            intent: { disposition: "adopted-response-loss", fence } };
        }
        return {
          registry: withBranchFence(registry, branch, fence),
          lease,
          changed: true,
          intent: { disposition: "acquired", fence },
        };
      },
    });
    return branchFenceReceipt({
      plan,
      result,
      fence,
      disposition: result.intent.disposition,
    });
  }

  function releaseBranchFence(planValue, { intent } = {}) {
    const plan = assertRuntimeSubject(planValue);
    const normalizedIntent =
      normalizeExpiredPublishedBindAheadCleanDescendantRecoveryIntent(intent);
    if (normalizedIntent.status !== "complete") {
      throw new Error("Branch-controller fence releases only after durable completion.");
    }
    const fence = branchControllerFence(plan, normalizedIntent, branch);
    const targetLeaseDigest =
      normalizedIntent.phases.verified.values.targetLeaseDigest;
    const observedRegistry = leaseStore.readRegistry();
    const observedFenceState = classifyBranchControllerFence(
      observedRegistry,
      branch,
      fence,
    );
    if (observedFenceState === "absent") {
      const observedLease = observedRegistry?.leases?.[branch];
      if (!observedLease
        || observedLease.fenceSha !== plan.evidence.committed.publishedHeadSha
        || observedLease.cloudAuthority?.claimId
          !== plan.evidence.cloud.liveClaim.claimId
        || canonicalJson(observedLease.taskAuthority)
          !== canonicalJson(plan.evidence.committed.sourceLease.taskAuthority)) {
        invalid("released branch-controller fence adoption");
      }
      return fenceReleaseReceipt({
        plan,
        fence,
        disposition: "adopted-release",
        registryRevision: observedRegistry.revision,
      });
    }
    const result = mutateRegistry({
      leaseStore,
      branch,
      expectedLeaseDigest: targetLeaseDigest,
      expectedClaimId: plan.evidence.cloud.liveClaim.claimId,
      action: ({ registry, lease }) => {
        const state = classifyBranchControllerFence(registry, branch, fence);
        if (state === "absent") {
          return { registry, lease, changed: false,
            intent: { disposition: "adopted-release" } };
        }
        return {
          registry: withoutBranchFence(registry, branch),
          lease,
          changed: true,
          intent: { disposition: "released" },
        };
      },
    });
    return fenceReleaseReceipt({
      plan,
      fence,
      disposition: result.intent.disposition,
      registryRevision: result.registryRevision,
    });
  }

  function revalidate(planValue, phase, { intent = null } = {}) {
    const plan = assertRuntimeSubject(planValue);
    const frame = captureFrame(plan);
    const fence = branchControllerFence(plan, intent, branch);
    const fenceState = classifyBranchControllerFence(frame.registry, branch, fence);
    if (phase === "before-task-authority") {
      requireStates(frame, { local: "source", marker: "source" });
      if (fenceState !== "absent") invalid("pre-authority branch-controller fence");
      return Object.freeze({ revalidationDigest: frame.digest });
    }
    if (phase === "before-branch-fence") {
      requireStates(frame, { local: "source", marker: "source" });
      return Object.freeze({
        revalidationDigest: frame.digest,
        sourceClaimId: plan.evidence.cloud.liveClaim.claimId,
        sourceLeaseDigest: plan.evidence.committed.sourceLeaseDigest,
      });
    }
    if (phase === "adopt-branch-fence") {
      if (fenceState !== "owned") return Object.freeze({ branchFenced: false });
      return Object.freeze({
        branchFenced: true,
        values: branchFenceReceipt({
          plan,
          result: { registryRevision: frame.registry.revision },
          fence,
          disposition: "adopted-response-loss",
        }),
      });
    }
    if (fenceState !== "owned") invalid("durable branch-controller fence");
    if (phase === "adopt-bind") {
      return buildExpiredPublishedBindAheadCleanDescendantRecoveryBindAdoption(
        plan,
        frame.digest,
      );
    }
    if (phase === "before-cloud") {
      requireStates(frame, { local: "source", marker: "source" });
      return cloudAttempt(frame, plan);
    }
    if (phase === "adopt-cloud") {
      if (new Set(["dormant-bind", "dormant-recovered"]).has(frame.cloud.state)) {
        return Object.freeze({ cloudReconciled: false });
      }
      const values = reconcileCurrentCloud(plan, frame.cloud, {
        disposition: frame.cloud.state === "recovered"
          ? "adopted-recovery-response-loss" : "adopted-current-bind",
        cloudLedgerMutation: false,
        recoveryTransitionRecorded: frame.cloud.state === "recovered",
        responseLossAdopted: frame.cloud.state === "recovered",
      });
      return Object.freeze({ cloudReconciled: true, values });
    }
    if (phase === "before-local") {
      requireCloudReceipt(plan, intent);
      requireStates(frame, { marker: "source" });
      return Object.freeze({
        cloudAuthorityDigest: cloudValues(intent).authorityDigest,
        publishedFenceSha: plan.evidence.committed.publishedHeadSha,
        preservedHeadSha: plan.evidence.committed.localHeadSha,
        revalidationDigest: frame.digest,
        sourceLeaseDigest: plan.evidence.committed.sourceLeaseDigest,
      });
    }
    if (phase === "adopt-local") {
      if (frame.localState !== "target") return Object.freeze({ localProjected: false });
      return Object.freeze({ localProjected: true, values: localReceipt(
        plan, frame.lease, frame.registry.revision, true, "adopted-response-loss",
      ) });
    }
    if (phase === "before-marker") {
      requireStates(frame, { local: "target" });
      return Object.freeze({
        markerState: frame.markerState,
        sourceBodyDigest: plan.evidence.pullRequest.sourceBodyDigest,
        sourceMarkerDigest: plan.evidence.pullRequest.sourceMarkerDigest,
        targetLeaseDigest: writerLeaseDigest(frame.lease),
        revalidationDigest: frame.digest,
      });
    }
    if (phase === "adopt-marker") {
      if (frame.markerState !== "target") return Object.freeze({ markerProjected: false });
      return Object.freeze({ markerProjected: true, values: markerReceipt(
        plan, frame.lease, frame.review.body, frame.registry.revision,
        false, "adopted-response-loss",
      ) });
    }
    if (phase === "before-terminal") return frame;
    throw new Error(`Unsupported bind-ahead recovery revalidation phase: ${phase}`);
  }

  function recoverDormantClaim(planValue, { intent = null } = {}) {
    const plan = assertRuntimeSubject(planValue);
    const frame = captureFrame(plan);
    if (classifyBranchControllerFence(
      frame.registry,
      branch,
      branchControllerFence(plan, intent, branch),
    ) !== "owned") invalid("cloud-effect branch-controller fence");
    if (!new Set(["dormant-bind", "dormant-recovered"]).has(frame.cloud.state)) {
      invalid("recoverable dormant cloud authority");
    }
    requireStates(frame, { local: "source", marker: "source" });
    const manifest = manifestOf(plan);
    const result = recoverCloud({
      authority: frame.cloud.bindAuthority,
      manifest,
      recoveryEvidenceDigest: recoveryDigest(plan),
      deviceId: plan.evidence.committed.sourceLease.cloudAuthority.deviceId,
      sessionId,
      ttlSeconds: plan.ttlSeconds,
      environment,
    });
    const values = cacheCloud(plan, result, {
      disposition: "recovered-dormant",
      cloudLedgerMutation: true,
      recoveryTransitionRecorded: true,
      responseLossAdopted: false,
    }, { append: false });
    return values;
  }

  function projectLocalLease(planValue, { intent } = {}) {
    const plan = assertRuntimeSubject(planValue);
    ensureFreshCloud(plan, intent);
    const cloud = requireCloudReceipt(plan, intent);
    const target = projectExpiredPublishedBindAheadCleanDescendantLease({
      sourceLease: plan.evidence.committed.sourceLease,
      publishedFenceSha: plan.evidence.committed.publishedHeadSha,
      cloudAuthority: cloud.authority,
      verifiedAt: cloud.verification.verifiedAt,
    });
    const currentLease = leaseStore.readRegistry()?.leases?.[branch];
    if (!currentLease) invalid("local-effect writer lease");
    const currentState = captureLocalState(plan, currentLease);
    if (!new Set(["source", "stale-target"]).has(currentState)) {
      invalid("local-effect source-or-stale-target lease");
    }
    const result = mutateRegistry({
      leaseStore, branch,
      expectedLeaseDigest: writerLeaseDigest(currentLease),
      expectedClaimId: plan.evidence.cloud.liveClaim.claimId,
      action: ({ registry, lease }) => {
        if (classifyBranchControllerFence(
          registry,
          branch,
          branchControllerFence(plan, intent, branch),
        ) !== "owned") invalid("local-effect branch-controller fence");
        if (!new Set(["source", "stale-target"]).has(captureLocalState(plan, lease))) {
          invalid("source-or-stale-target lease CAS");
        }
        return { registry: { ...registry, leases: { ...registry.leases, [branch]: target } },
          lease: target, changed: true };
      },
    });
    return localReceipt(plan, result.lease, result.registryRevision, true, "projected");
  }

  function projectProviderMarker(planValue, { intent } = {}) {
    const plan = assertRuntimeSubject(planValue);
    ensureFreshCloud(plan, intent);
    const cloud = requireCloudReceipt(plan, intent);
    const latestLease = projectExpiredPublishedBindAheadCleanDescendantLease({
      sourceLease: plan.evidence.committed.sourceLease,
      publishedFenceSha: plan.evidence.committed.publishedHeadSha,
      cloudAuthority: cloud.authority,
      verifiedAt: cloud.verification.verifiedAt,
    });
    const observedLease = leaseStore.readRegistry()?.leases?.[branch];
    if (!observedLease) invalid("marker-effect writer lease");
    if (captureLocalState(plan, observedLease) === "stale-target") {
      mutateRegistry({
        leaseStore,
        branch,
        expectedLeaseDigest: writerLeaseDigest(observedLease),
        expectedClaimId: plan.evidence.cloud.liveClaim.claimId,
        action: ({ registry, lease }) => {
          if (classifyBranchControllerFence(
            registry,
            branch,
            branchControllerFence(plan, intent, branch),
          ) !== "owned") invalid("marker-refresh branch-controller fence");
          if (captureLocalState(plan, lease) !== "stale-target") {
            invalid("marker-refresh stale lease CAS");
          }
          return {
            registry: { ...registry, leases: { ...registry.leases, [branch]: latestLease } },
            lease: latestLease,
            changed: true,
          };
        },
      });
    }
    if (typeof leaseStore.withRegistryLock !== "function") {
      throw new Error("Provider marker projection requires the writer-registry lock.");
    }
    return leaseStore.withRegistryLock(registry => {
      if (classifyBranchControllerFence(
        registry,
        branch,
        branchControllerFence(plan, intent, branch),
      ) !== "owned") invalid("marker-effect branch-controller fence");
      const lease = registry.leases?.[branch];
      if (!lease || captureLocalState(plan, lease) !== "target") invalid("marker lease fence");
      assertGitPreserved(plan);
      let review = readReview();
      assertReviewIdentity(plan, review);
      if (!new Set(["source", "stale-target"]).has(
        captureMarkerState(plan, lease, review.body),
      )) {
        invalid("source-or-stale marker fence");
      }
      const targetBody = targetBodyFor(plan, lease);
      editBody(plan.evidence.pullRequest.url, targetBody);
      assertGitPreserved(plan);
      review = readReview();
      assertReviewIdentity(plan, review);
      if (captureMarkerState(plan, lease, review.body) !== "target") {
        invalid("target marker readback");
      }
      return markerReceipt(
        plan,
        lease,
        review.body,
        registry.revision,
        true,
        "projected",
      );
    });
  }

  function convergeTerminalProjection(plan, intent) {
    ensureFreshCloud(plan, intent);
    const cloud = requireCloudReceipt(plan, intent);
    const latestLease = projectExpiredPublishedBindAheadCleanDescendantLease({
      sourceLease: plan.evidence.committed.sourceLease,
      publishedFenceSha: plan.evidence.committed.publishedHeadSha,
      cloudAuthority: cloud.authority,
      verifiedAt: cloud.verification.verifiedAt,
    });
    const observedLease = leaseStore.readRegistry()?.leases?.[branch];
    if (!observedLease) invalid("terminal writer lease");
    const observedState = captureLocalState(plan, observedLease);
    if (observedState === "stale-target") {
      mutateRegistry({
        leaseStore,
        branch,
        expectedLeaseDigest: writerLeaseDigest(observedLease),
        expectedClaimId: plan.evidence.cloud.liveClaim.claimId,
        action: ({ registry, lease }) => {
          if (classifyBranchControllerFence(
            registry,
            branch,
            branchControllerFence(plan, intent, branch),
          ) !== "owned") invalid("terminal-refresh branch-controller fence");
          if (captureLocalState(plan, lease) !== "stale-target") {
            invalid("terminal-refresh stale lease CAS");
          }
          return {
            registry: {
              ...registry,
              leases: { ...registry.leases, [branch]: latestLease },
            },
            lease: latestLease,
            changed: true,
          };
        },
      });
    } else if (observedState !== "target") {
      invalid("terminal source-or-target lease");
    }
    if (typeof leaseStore.withRegistryLock !== "function") {
      throw new Error("Terminal projection requires the writer-registry lock.");
    }
    return leaseStore.withRegistryLock(registry => {
      if (classifyBranchControllerFence(
        registry,
        branch,
        branchControllerFence(plan, intent, branch),
      ) !== "owned") invalid("terminal marker branch-controller fence");
      const lease = registry.leases?.[branch];
      if (!lease || captureLocalState(plan, lease) !== "target") {
        invalid("terminal marker lease fence");
      }
      assertGitPreserved(plan);
      let review = readReview();
      assertReviewIdentity(plan, review);
      const markerState = captureMarkerState(plan, lease, review.body);
      let providerMutation = false;
      if (new Set(["source", "stale-target"]).has(markerState)) {
        let writeError = null;
        try {
          editBody(plan.evidence.pullRequest.url, targetBodyFor(plan, lease));
          providerMutation = true;
        } catch (error) {
          writeError = error;
        }
        assertGitPreserved(plan);
        review = readReview();
        assertReviewIdentity(plan, review);
        if (captureMarkerState(plan, lease, review.body) !== "target") {
          if (writeError) throw writeError;
          invalid("terminal target marker readback");
        }
      } else if (markerState !== "target") {
        invalid("terminal stale-or-target marker");
      }
      if (captureMarkerState(plan, lease, review.body) !== "target") {
        invalid("terminal target marker readback");
      }
      return markerReceipt(
        plan,
        lease,
        review.body,
        registry.revision,
        providerMutation,
        providerMutation ? "projected" : "adopted-response-loss",
      );
    });
  }

  function finalizeTerminalProjection(planValue, { intent } = {}) {
    const plan = assertRuntimeSubject(planValue);
    const normalizedIntent =
      normalizeExpiredPublishedBindAheadCleanDescendantRecoveryIntent(intent);
    if (normalizedIntent.status !== "marker-attempted") {
      invalid("terminal projection source phase");
    }
    const markerValues = convergeTerminalProjection(plan, normalizedIntent);
    const verifiedValues = verifyTerminal(plan, {
      intent: normalizedIntent,
      projectionConverged: true,
    });
    if (verifiedValues.targetLeaseDigest !== markerValues.targetLeaseDigest
      || verifiedValues.bodyDigest !== markerValues.bodyDigest
      || verifiedValues.markerDigest !== markerValues.markerDigest
      || verifiedValues.sidecarHeadDigest !== markerValues.sidecarHeadDigest
      || verifiedValues.registryRevision !== markerValues.registryRevision) {
      invalid("atomic terminal marker and verification join");
    }
    return Object.freeze({ markerValues, verifiedValues });
  }

  function verifyTerminal(planValue, { intent, projectionConverged = false } = {}) {
    const plan = assertRuntimeSubject(planValue);
    const normalizedIntent =
      normalizeExpiredPublishedBindAheadCleanDescendantRecoveryIntent(intent);
    if (!projectionConverged && normalizedIntent.status === "marker-projected") {
      convergeTerminalProjection(plan, normalizedIntent);
    }
    const sidecar = requireCloudSidecar(plan);
    const cloud = requireCloudReceipt(plan, normalizedIntent);
    const frame = captureFrame(plan);
    const projectedRegistryRevision =
      normalizedIntent.phases?.verified?.values?.registryRevision
      || frame.registry.revision;
    const fenceState = classifyBranchControllerFence(
      frame.registry,
      branch,
      branchControllerFence(plan, normalizedIntent, branch),
    );
    if (fenceState !== "owned"
      && !(normalizedIntent.status === "complete" && fenceState === "absent")) {
      invalid("terminal branch-controller fence");
    }
    const runtimeAuthority =
      reverifyExpiredPublishedBindAheadCleanDescendantMutationAuthority({
        plan,
        lease: frame.lease,
        currentAuthority: frame.cloud.authority,
        environment,
        verifyCloud,
      });
    const sealedMutationAuthorityReceiptDigest =
      normalizedIntent.phases?.verified?.values?.mutationAuthorityReceiptDigest
      || runtimeAuthority.receipt.receiptDigest;
    requireStates(frame, { local: "target", marker: "target", cloud: "recovered-or-current" });
    if (digestValue(cloud.authority) !== cloud.reconciliation.authorityDigest
      || frame.cloud.claim.fenceRevision !== cloud.authority.claimDigest
      || frame.cloud.claim.transitionDigest !== cloud.authority.claimLedgerRevision
      || frame.cloud.claim.transitionCounter !== cloud.authority.transitionCounter
      || canonicalJson(frame.lease.taskAuthority)
        !== canonicalJson(plan.evidence.committed.sourceLease.taskAuthority)
      || !Number.isSafeInteger(projectedRegistryRevision)
      || projectedRegistryRevision < 1
      || frame.registry.revision < projectedRegistryRevision) {
      invalid("terminal authority or task binding");
    }
    const core = {
      ...cloudSidecarSummary(plan, sidecar),
      claimId: cloud.authority.claimId,
      claimDigest: cloud.authority.claimDigest,
      transitionDigest: cloud.authority.claimLedgerRevision,
      transitionCounter: cloud.authority.transitionCounter,
      operationReceiptDigest: cloud.authority.operationReceiptDigest,
      cloudAuthorityDigest: digestValue(cloud.authority),
      cloudVerificationReceiptDigest: cloud.verification.receiptDigest,
      targetLeaseDigest: writerLeaseDigest(frame.lease),
      bodyDigest: sha256(frame.review.body),
      markerDigest: digestValue(parseWriterLeasePullRequestBody(frame.review.body)),
      visibleBodyDigest: visiblePullRequestBodyDigest(frame.review.body),
      sourceFenceSha: plan.evidence.committed.sourceFenceSha,
      publishedFenceSha: plan.evidence.committed.publishedHeadSha,
      remoteHeadSha: plan.evidence.committed.publishedHeadSha,
      pullRequestHeadSha: plan.evidence.committed.publishedHeadSha,
      preservedHeadSha: plan.evidence.committed.localHeadSha,
      taskAuthorityBindingDigest: plan.evidence.committed.taskAuthorityBindingDigest,
      registryRevision: projectedRegistryRevision,
      mutationAuthorityReceiptDigest: sealedMutationAuthorityReceiptDigest,
      sidecarHeadDigest: sidecar.headGenerationDigest,
    };
    return Object.freeze({ ...core, verificationDigest: digestValue(core) });
  }

  function captureFrame(plan) {
    assertGitPreserved(plan);
    const registry = leaseStore.readRegistry();
    const lease = registry.leases?.[branch];
    if (!lease) invalid("writer lease presence");
    const review = readReview();
    assertReviewIdentity(plan, review);
    const localState = captureLocalState(plan, lease);
    const markerState = captureMarkerState(plan, lease, review.body);
    const cloud = observeCloud(plan);
    const core = { registryRevision: registry.revision, leaseDigest: writerLeaseDigest(lease),
      localState, markerState, cloudState: cloud.state, bodyDigest: sha256(review.body) };
    return Object.freeze({ registry, lease, review, localState, markerState, cloud,
      digest: digestValue(core) });
  }

  function observeCloud(plan) {
    const source = plan.evidence.committed.sourceLease.cloudAuthority;
    const status = readStatus(source);
    const claim = exactClaim(status, source.claimId);
    const ledger = readLedgerSnapshot({ ledgerRepository: source.ledgerRepository,
      revision: status.ledgerRevision });
    const state = validateCurrentLedger(plan, status, ledger, claim);
    const normalizedAuthority = normalizeBoundAuthority({
      result: { ...status, action: "continue", claim, claimDigest: claim.fenceRevision },
      authority: source, manifest: manifestOf(plan),
      deviceId: source.deviceId, sessionId: source.sessionId,
    });
    const authority = Object.freeze({
      ...normalizedAuthority,
      heartbeatCounter: nonnegativeCounter(
        claim.heartbeatCounter,
        "cloud heartbeat counter",
      ),
    });
    const bindAuthority = Object.freeze({ ...authority, state: "active" });
    return Object.freeze({ state, status, claim, authority, bindAuthority });
  }

  function reconcileCurrentCloud(plan, observed, flags) {
    if (!new Set(["current-bind", "recovered"]).has(observed.state)) {
      invalid("current cloud adoption");
    }
    const verified = verifyCloud({ authority: Object.freeze({ ...observed.authority,
      state: "active" }), manifest: manifestOf(plan),
      canonicalBaseSha: plan.evidence.committed.sourceLease.baseSha, environment });
    return cacheCloud(plan, verified, flags);
  }

  function cacheCloud(plan, result, flags, { append = false } = {}) {
    const authority = result?.authority;
    const verification = result?.verification;
    if (!authority || !verification || authority.claimId !== plan.evidence.cloud.liveClaim.claimId
      || authority.laneRevision !== plan.evidence.committed.publishedHeadSha
      || authority.state !== "active") invalid("verified cloud recovery");
    const reconciliation = Object.freeze({
      disposition: flags.disposition,
      claimId: authority.claimId,
      claimDigest: authority.claimDigest,
      transitionDigest: authority.claimLedgerRevision,
      transitionCounter: authority.transitionCounter,
      operationReceiptDigest: authority.operationReceiptDigest,
      authorityDigest: digestValue(authority),
      verificationReceiptDigest: verification.receiptDigest,
      verifiedAt: verification.verifiedAt,
      recoveryEvidenceDigest: recoveryDigest(plan),
      cloudLedgerMutation: flags.cloudLedgerMutation,
      recoveryTransitionRecorded: flags.recoveryTransitionRecorded,
      responseLossAdopted: flags.responseLossAdopted,
    });
    const prior = append ? requireCloudSidecar(plan) : null;
    const previousGenerationDigest = prior?.headGenerationDigest || null;
    const generationCore = {
      schema: CLOUD_GENERATION_SCHEMA,
      planDigest: plan.planDigest,
      ordinal: (prior?.generations.length || 0) + 1,
      previousGenerationDigest,
      authority,
      verification: durableCloudVerification(verification),
      reconciliation,
    };
    const generation = Object.freeze({
      ...generationCore,
      generationDigest: digestValue(generationCore),
    });
    const generations = Object.freeze([...(prior?.generations || []), generation]);
    const sidecarCore = {
      schema: CLOUD_SIDECAR_SCHEMA,
      planDigest: plan.planDigest,
      generations,
      headGenerationDigest: generation.generationDigest,
    };
    runtimeCloud = Object.freeze({
      ...sidecarCore,
      sidecarDigest: digestValue(sidecarCore),
    });
    persistCloudSidecar(runtimeCloud);
    return Object.freeze({
      ...reconciliation,
      sidecarHeadDigest: generation.generationDigest,
    });
  }

  function requireCloudReceipt(plan, intent) {
    const values = cloudValues(intent);
    const sidecar = requireCloudSidecar(plan);
    const root = sidecar.generations[0];
    if (root.generationDigest !== values.sidecarHeadDigest
      || canonicalJson(root.reconciliation)
        !== canonicalJson(withoutSidecarHead(values))) {
      invalid("cloud-reconciled sidecar root");
    }
    runtimeCloud = sidecar;
    return cloudSidecarHead(sidecar);
  }

  function requireCloudSidecar(plan) {
    const source = runtimeCloud?.planDigest === plan.planDigest
      ? runtimeCloud : readJournal()?.cloud;
    const sidecar = normalizeCloudSidecar(plan, source);
    runtimeCloud = sidecar;
    return sidecar;
  }

  function ensureFreshCloud(plan, intent) {
    const sidecar = requireCloudSidecar(plan);
    const head = cloudSidecarHead(sidecar);
    const frame = captureFrame(plan);
    const observed = frame.cloud;
    const sameHead = observed.claim.fenceRevision === head.authority.claimDigest
      && observed.claim.transitionDigest === head.authority.claimLedgerRevision
      && observed.claim.transitionCounter === head.authority.transitionCounter;
    const active = new Set(["current-bind", "recovered"]).has(observed.state);
    const remainingMs = Date.parse(observed.claim.expiresAt) - now().getTime();
    if (sameHead && active && remainingMs >= MINIMUM_PROJECTION_HORIZON_MS) {
      const refreshed = verifyCloud({
        authority: Object.freeze({ ...observed.authority, state: "active" }),
        manifest: manifestOf(plan),
        canonicalBaseSha: plan.evidence.committed.sourceLease.baseSha,
        environment,
      });
      if (!refreshed?.verification
        || canonicalJson(stableCloudAuthority(refreshed.authority))
          !== canonicalJson(stableCloudAuthority(observed.authority))) {
        invalid("fresh projection cloud verification");
      }
      return head;
    }
    if (observed.claim.transitionCounter < head.authority.transitionCounter
      || (observed.claim.transitionCounter === head.authority.transitionCounter && !sameHead)) {
      invalid("projection cloud sidecar/live join");
    }
    const dormant = new Set(["dormant-bind", "dormant-recovered"]).has(observed.state);
    if (!dormant && !(active && remainingMs < MINIMUM_PROJECTION_HORIZON_MS)
      && observed.claim.transitionCounter === head.authority.transitionCounter) {
      invalid("projection cloud authority horizon");
    }
    const result = recoverCloud({
      authority: head.authority,
      manifest: manifestOf(plan),
      recoveryEvidenceDigest: recoveryDigest(plan),
      deviceId: plan.evidence.committed.sourceLease.cloudAuthority.deviceId,
      sessionId,
      ttlSeconds: plan.ttlSeconds,
      environment,
    });
    const after = captureFrame(plan).cloud;
    const resultAuthority = result?.authority;
    const transitionAdvance = resultAuthority?.transitionCounter
      - head.authority.transitionCounter;
    const heartbeatAdvance = resultAuthority?.heartbeatCounter
      - head.authority.heartbeatCounter;
    if (!Number.isSafeInteger(transitionAdvance) || transitionAdvance < 1
      || !Number.isSafeInteger(heartbeatAdvance) || heartbeatAdvance < 0
      || heartbeatAdvance > transitionAdvance
      || !new Set(["current-bind", "recovered"]).has(after.state)
      || canonicalJson(stableCloudAuthority(after.authority))
        !== canonicalJson(stableCloudAuthority(resultAuthority))) {
      invalid("ledger-proven projection cloud continuation");
    }
    const recoveryTransitionRecorded = heartbeatAdvance < transitionAdvance;
    const responseLossAdopted = observed.claim.transitionCounter
      > head.authority.transitionCounter;
    const resultAlreadyObserved =
      observed.claim.transitionCounter === resultAuthority.transitionCounter
      && observed.claim.fenceRevision === resultAuthority.claimDigest
      && observed.claim.transitionDigest === resultAuthority.claimLedgerRevision;
    const cloudLedgerMutation = !resultAlreadyObserved;
    const disposition = recoveryTransitionRecorded
      ? (cloudLedgerMutation
        ? "projection-recovered-dormant"
        : "projection-adopted-recovery-response-loss")
      : (cloudLedgerMutation
        ? "projection-renewed-current"
        : "projection-adopted-renewal-response-loss");
    cacheCloud(plan, result, {
      disposition,
      cloudLedgerMutation,
      recoveryTransitionRecorded,
      responseLossAdopted,
    }, { append: true });
    return cloudSidecarHead(requireCloudSidecar(plan));
  }

  function cloudValues(intent) {
    const values = intent?.phases?.["cloud-reconciled"]?.values;
    if (!values) invalid("cloud-reconciled intent receipt");
    return values;
  }

  function localReceipt(plan, lease, registryRevision, mutation, disposition) {
    const sidecar = requireCloudSidecar(plan);
    const cloud = cloudSidecarHead(sidecar);
    return Object.freeze({ disposition,
      sourceLeaseDigest: plan.evidence.committed.sourceLeaseDigest,
      targetLeaseDigest: writerLeaseDigest(lease),
      cloudAuthorityDigest: digestValue(cloud.authority),
      sidecarHeadDigest: sidecar.headGenerationDigest,
      taskAuthorityBindingDigest: plan.evidence.committed.taskAuthorityBindingDigest,
      registryRevision, writerRegistryMutation: mutation });
  }

  function markerReceipt(plan, lease, body, registryRevision, mutation, disposition) {
    const sidecar = requireCloudSidecar(plan);
    const cloud = cloudSidecarHead(sidecar);
    return Object.freeze({
      ...cloudSidecarSummary(plan, sidecar),
      disposition, targetLeaseDigest: writerLeaseDigest(lease),
      bodyDigest: sha256(body), markerDigest: digestValue(parseWriterLeasePullRequestBody(body)),
      visibleBodyDigest: visiblePullRequestBodyDigest(body), providerMutation: mutation,
      cloudAuthorityDigest: digestValue(cloud.authority),
      sidecarHeadDigest: sidecar.headGenerationDigest,
      registryRevision });
  }

  function captureLocalState(plan, lease) {
    if (writerLeaseDigest(lease) === plan.evidence.committed.sourceLeaseDigest
      && canonicalJson(lease) === canonicalJson(plan.evidence.committed.sourceLease)) return "source";
    const cloudValue = runtimeCloud || readJournal()?.cloud;
    if (cloudValue) {
      const sidecar = normalizeCloudSidecar(plan, cloudValue);
      const targets = sidecar.generations.map(generation =>
        projectExpiredPublishedBindAheadCleanDescendantLease({
        sourceLease: plan.evidence.committed.sourceLease,
        publishedFenceSha: plan.evidence.committed.publishedHeadSha,
        cloudAuthority: generation.authority,
        verifiedAt: generation.verification.verifiedAt,
      }));
      const targetIndex = targets.findIndex(
        target => canonicalJson(lease) === canonicalJson(target),
      );
      if (targetIndex === targets.length - 1) return "target";
      if (targetIndex >= 0) return "stale-target";
    }
    invalid("source-or-target local lease");
  }

  function captureMarkerState(plan, lease, body) {
    const markerDigest = digestValue(parseWriterLeasePullRequestBody(body));
    if (sha256(body) === plan.evidence.pullRequest.sourceBodyDigest
      && markerDigest === plan.evidence.pullRequest.sourceMarkerDigest) return "source";
    if (captureLocalState(plan, lease) === "target"
      && body === targetBodyFor(plan, lease)
      && markerDigest === digestValue(projectWriterLeasePullRequestMarker(lease))) return "target";
    const cloudValue = runtimeCloud || readJournal()?.cloud;
    if (cloudValue) {
      const sidecar = normalizeCloudSidecar(plan, cloudValue);
      for (const generation of sidecar.generations.slice(0, -1)) {
        const historicalLease = projectExpiredPublishedBindAheadCleanDescendantLease({
          sourceLease: plan.evidence.committed.sourceLease,
          publishedFenceSha: plan.evidence.committed.publishedHeadSha,
          cloudAuthority: generation.authority,
          verifiedAt: generation.verification.verifiedAt,
        });
        if (body === targetBodyFor(plan, historicalLease)
          && markerDigest
            === digestValue(projectWriterLeasePullRequestMarker(historicalLease))) {
          return "stale-target";
        }
      }
    }
    invalid("source-or-target hidden marker");
  }

  function targetBodyFor(plan, lease) {
    const body = updateWriterLeasePullRequestBody(plan.evidence.pullRequest.sourceBody, lease);
    if (visiblePullRequestBodyDigest(body) !== plan.evidence.pullRequest.visibleBodyDigest) {
      invalid("visible pull-request body preservation");
    }
    return body;
  }

  function validateCurrentLedger(plan, status, ledger, claim) {
    return classifyExpiredPublishedBindAheadCloudLineage({
      plan,
      status,
      ledger,
      claim,
    });
  }

  function assertGitPreserved(plan) {
    const committed = plan.evidence.committed;
    assertExpiredPublishedBindAheadCleanDescendantGitFrame({
      expected: committed,
      observed: {
        headSha: git(["rev-parse", "HEAD"]),
        treeSha: git(["rev-parse", "HEAD^{tree}"]),
        localBranchSha: git(["rev-parse", `refs/heads/${branch}`]),
        remoteBranchSha: gitOptional(["ls-remote", "--heads", "origin",
          `refs/heads/${branch}`]).split(/\s+/u)[0],
        attachedBranch: git(["branch", "--show-current"]),
        symbolicBranch: gitOptional(["symbolic-ref", "--quiet", "--short", "HEAD"]),
        status: git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
      },
    });
  }

  function readReview() {
    return JSON.parse(gh(["pr", "view", String(pullRequestNumber), "--json",
      "id,number,url,title,state,isDraft,autoMergeRequest,headRefName,headRefOid,headRepository,"
        + "baseRefName,baseRefOid,body"]));
  }

  function assertReviewIdentity(plan, review) {
    const expected = plan.evidence.pullRequest;
    const actual = { id: review.id, number: review.number, url: review.url,
      title: review.title,
      state: review.state, isDraft: review.isDraft,
      autoMergeRequest: review.autoMergeRequest, headRepositoryId: review.headRepository?.id,
      headRepository: review.headRepository?.nameWithOwner, headBranch: review.headRefName,
      headSha: review.headRefOid, baseBranch: review.baseRefName, baseSha: review.baseRefOid };
    for (const key of Object.keys(actual)) {
      if (canonicalJson(actual[key]) !== canonicalJson(expected[key])) invalid(`review ${key}`);
    }
  }

  function readStatus(authority) {
    const result = inspectCloud({ action: "status", ledgerRepository: authority.ledgerRepository,
      request: { targetRepository: authority.targetRepository }, environment });
    if (result?.schema !== "agentic-cloud-collaboration-result/v1" || result.ok !== true
      || result.action !== "status" || result.status !== "ready"
      || !Array.isArray(result.claims) || !SHA.test(result.ledgerRevision || "")
      || !DIGEST.test(result.ledgerDigest || "") || !Number.isSafeInteger(result.sequence)) {
      invalid("cloud status");
    }
    return result;
  }

  function exactClaim(status, claimId) {
    const matches = status.claims.filter(claim => claim.claimId === claimId);
    if (matches.length !== 1) invalid("claim cardinality");
    return matches[0];
  }

  function overlappingClaims(claims, source) {
    return claims.filter(claim => claim.claimId !== source.claimId && claim.scopeReserved === true
      && (claim.reviewRequestId === source.reviewRequestId
        || writeSetsOverlap(claim.declaredWriteScope, source.declaredWriteScope)));
  }

  function manifestOf(plan) {
    return manifestFromPlan(plan);
  }

  function recoveryDigest(plan) {
    return plan.recoveryEvidenceDigest;
  }

  function requireStates(frame, expected) {
    const actual = { local: frame.localState, marker: frame.markerState, cloud: frame.cloud.state };
    for (const [key, value] of Object.entries(expected)) {
      const accepted = value === "recovered-or-current"
        ? new Set(["current-bind", "recovered"]).has(actual[key]) : actual[key] === value;
      if (!accepted) throw new Error(`Bind-ahead recovery ${key} state is ${actual[key]}, not ${value}.`);
    }
  }

  function cloudAttempt(frame, plan) {
    return Object.freeze({ claimState: frame.cloud.state,
      recoveryEvidenceDigest: recoveryDigest(plan), revalidationDigest: frame.digest });
  }

  function readIntent(planValue = null) {
    const journal = readJournal();
    if (!journal) return null;
    if (planValue) {
      const plan = assertRuntimeSubject(planValue);
      if (journal.intent.planDigest !== plan.planDigest) invalid("journal plan");
    }
    runtimeCloud = journal.cloud;
    return journal.intent;
  }

  function writeIntent({ plan, expected, value }) {
    assertRuntimeSubject(plan);
    const current = readJournal();
    const currentIntent = current?.intent || null;
    if (canonicalJson(currentIntent) !== canonicalJson(expected)) invalid("intent CAS");
    const intent = normalizeExpiredPublishedBindAheadCleanDescendantRecoveryIntent(value);
    writeJournal({ intent, cloud: runtimeCloud || current?.cloud || null });
    return intent;
  }

  async function withOperationLock(action) {
    if (typeof action !== "function") invalid("operation callback");
    ensureDirectory(path.dirname(journalPath));
    const release = acquireOperationLock({
      lockPath,
      operationId,
      uuid,
      isProcessAlive,
    });
    try { return await action(); }
    finally { release(); }
  }

  function readJournal() {
    if (!existsSync(journalPath)) return null;
    privateFile(journalPath, "journal");
    const value = JSON.parse(readFileSync(journalPath, "utf8"));
    const intent = normalizeExpiredPublishedBindAheadCleanDescendantRecoveryIntent(value.intent);
    if (value.schema !== JOURNAL_SCHEMA || value.operationId !== operationId
      || value.intentDigest !== intent.intentDigest) invalid("journal projection");
    return Object.freeze({ ...value, intent, cloud: value.cloud || null });
  }

  function writeJournal({ intent, cloud }) {
    ensureDirectory(path.dirname(journalPath));
    const value = { schema: JOURNAL_SCHEMA, operationId, repository, branch,
      pullRequestNumber, intent, intentDigest: intent.intentDigest, cloud };
    const temporary = `${journalPath}.${process.pid}.${randomUUID()}.tmp`;
    const descriptor = openSync(temporary, "wx", 0o600);
    try { writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`); fsyncSync(descriptor); }
    finally { closeSync(descriptor); }
    renameSync(temporary, journalPath);
    const directory = openSync(path.dirname(journalPath), "r");
    try { fsyncSync(directory); } finally { closeSync(directory); }
  }

  function persistCloudSidecar(cloud) {
    const journal = readJournal();
    if (!journal) invalid("cloud sidecar journal");
    writeJournal({ intent: journal.intent, cloud });
  }

  return Object.freeze({
    readPlanEvidence, readPlanTtlSeconds, withOperationLock, assertRuntimeSubject,
    readIntent, writeIntent,
    authorizeTask, acquireBranchFence, releaseBranchFence, revalidate,
    recoverDormantClaim, projectLocalLease,
    projectProviderMarker, finalizeTerminalProjection, verifyTerminal,
    branch, gitCommonDir: commonDirectory, journalPath,
  });
}

export function classifyExpiredPublishedBindAheadCloudLineage({
  plan: planValue,
  status,
  ledger,
  claim,
} = {}) {
  const plan = normalizeExpiredPublishedBindAheadCleanDescendantRecoveryPlan(
    planValue,
  );
  const failures = validateLedger(ledger);
  if (failures.length || ledger.sequence !== status?.sequence
    || ledger.headDigest !== status?.ledgerDigest
    || digestValue(ledger.entries.slice(0, plan.evidence.cloud.source.sequence))
      !== plan.evidence.cloud.source.entriesDigest) invalid("current raw ledger prefix");
  const target = plan.evidence.cloud.targetEntry;
  const targetMatches = ledger.entries.filter(entry => entry.digest === target.digest
    && entry.claimId === target.claimId);
  if (targetMatches.length !== 1 || canonicalJson(targetMatches[0]) !== canonicalJson(target)) {
    invalid("sealed bind entry");
  }
  const later = ledger.entries.filter(entry => entry.claimId === target.claimId
    && entry.sequence > target.sequence);
  if (later.length === 0) {
    if (claim?.transitionDigest !== target.digest || claim.fenceRevision !== target.claimDigest
      || !["current", "dormant-preserved"].includes(claim.state)) invalid("live bind claim");
    return claim.state === "current" ? "current-bind" : "dormant-bind";
  }
  let previous = target;
  for (const entry of later) {
    const priorCore = previous.claimCore;
    const core = entry.claimCore;
    const renewal = core?.heartbeatCounter === priorCore.heartbeatCounter + 1
      && core?.recovery?.evidenceDigest === priorCore.recovery?.evidenceDigest;
    const recovery = core?.heartbeatCounter === priorCore.heartbeatCounter
      && core?.recovery?.evidenceDigest === plan.recoveryEvidenceDigest;
    const expectedIdempotencyKey = renewal
      ? digestValue([
        "device-heartbeat", target.claimId,
        priorCore.transitionCounter, previous.claimDigest,
      ].join(":"))
      : digestValue([
        "device-expired-committed-recovery", target.claimId,
        priorCore.transitionCounter, previous.claimDigest, plan.recoveryEvidenceDigest,
      ].join(":"));
    if (entry.action !== "continue"
      || core?.transitionCounter !== priorCore.transitionCounter + 1
      || core?.laneRevision !== plan.evidence.committed.publishedHeadSha
      || (!renewal && !recovery)
      || entry.idempotencyKey !== expectedIdempotencyKey
      || canonicalJson(stableClaimCore(core))
        !== canonicalJson(stableClaimCore(target.claimCore))) {
      invalid("controller-owned same-claim continuation chain");
    }
    previous = entry;
  }
  if (!new Set(["current", "dormant-preserved"]).has(claim?.state)
    || claim.transitionDigest !== previous.digest
    || claim.fenceRevision !== previous.claimDigest
    || claim.transitionCounter !== previous.claimCore.transitionCounter
    || claim.heartbeatCounter !== previous.claimCore.heartbeatCounter
    || claim.expiresAt !== previous.claimCore.expiresAt) {
    invalid("controller-owned continuation claim projection");
  }
  return claim.state === "current" ? "recovered" : "dormant-recovered";
}

function branchControllerFence(plan, intentValue, branch) {
  const intent = normalizeExpiredPublishedBindAheadCleanDescendantRecoveryIntent(
    intentValue,
  );
  if (intent.planDigest !== plan.planDigest) invalid("branch-controller fence plan");
  const core = {
    schema: BRANCH_FENCE_SCHEMA,
    branch,
    planDigest: plan.planDigest,
    authorizationDigest: intent.authorizationDigest,
    sourceLeaseDigest: plan.evidence.committed.sourceLeaseDigest,
    sourceClaimId: plan.evidence.cloud.liveClaim.claimId,
    sourceFenceSha: plan.evidence.committed.sourceFenceSha,
    publishedFenceSha: plan.evidence.committed.publishedHeadSha,
    preservedHeadSha: plan.evidence.committed.localHeadSha,
  };
  return Object.freeze({ ...core, fenceDigest: digestValue(core) });
}

function classifyBranchControllerFence(registry, branch, expectedFence) {
  let ownedCount = 0;
  let absentCount = 0;
  for (const field of BRANCH_CONTROLLER_FENCE_FIELDS) {
    const values = registry?.[field];
    if (values !== null && values !== undefined
      && (!values || typeof values !== "object" || Array.isArray(values))) {
      throw new Error(`Writer registry ${field} is malformed.`);
    }
    const value = values?.[branch];
    if (value === null || value === undefined) {
      absentCount += 1;
      continue;
    }
    if (canonicalJson(value) === canonicalJson(expectedFence)) {
      ownedCount += 1;
      continue;
    }
    throw new Error(
      `Bind-ahead recovery found a competing branch controller intent or fence: ${field}.`,
    );
  }
  if (absentCount === BRANCH_CONTROLLER_FENCE_FIELDS.length) return "absent";
  if (ownedCount === BRANCH_CONTROLLER_FENCE_FIELDS.length) return "owned";
  throw new Error(
    "Bind-ahead recovery found a partial branch-controller fence projection.",
  );
}

export function classifyExpiredPublishedBindAheadBranchControllerFence({
  registry,
  branch,
  expectedFence,
} = {}) {
  return classifyBranchControllerFence(registry, branch, expectedFence);
}

function assertBranchControllerFieldsClear(registry, branch) {
  for (const field of BRANCH_CONTROLLER_FENCE_FIELDS) {
    const values = registry?.[field];
    if (values !== null && values !== undefined
      && (!values || typeof values !== "object" || Array.isArray(values))) {
      throw new Error(`Writer registry ${field} is malformed.`);
    }
    if (values?.[branch] !== null && values?.[branch] !== undefined) {
      throw new Error(
        `Bind-ahead recovery found a competing branch controller intent or fence: ${field}.`,
      );
    }
  }
}

function withBranchFence(registry, branch, fence) {
  return BRANCH_CONTROLLER_FENCE_FIELDS.reduce((projection, field) => ({
    ...projection,
    [field]: {
      ...(projection[field] || {}),
      [branch]: fence,
    },
  }), { ...registry });
}

function withoutBranchFence(registry, branch) {
  return BRANCH_CONTROLLER_FENCE_FIELDS.reduce((projection, field) => {
    const values = { ...(projection[field] || {}) };
    delete values[branch];
    return { ...projection, [field]: values };
  }, { ...registry });
}

function acquireOperationLock({ lockPath, operationId, uuid, isProcessAlive }) {
  const token = uuid();
  try { return createOwnedOperationLock({ lockPath, operationId, token }); }
  catch (error) { if (error?.code !== "EEXIST") throw error; }
  const owner = readOperationLock(lockPath);
  if (!owner || owner.operationId !== operationId) {
    throw new Error("Bind-ahead recovery operation lock is malformed or foreign.");
  }
  if (isProcessAlive(owner.pid)) {
    throw new Error("Bind-ahead recovery is already in progress.");
  }
  const confirmed = readOperationLock(lockPath);
  if (!confirmed || confirmed.token !== owner.token
    || confirmed.operationId !== operationId) {
    throw new Error("Bind-ahead recovery lock changed during dead-owner recovery.");
  }
  const stalePath = `${lockPath}.stale.${token}`;
  renameSync(lockPath, stalePath);
  syncDirectory(path.dirname(lockPath));
  const moved = readOperationLock(stalePath);
  if (!moved || moved.token !== owner.token || moved.operationId !== operationId) {
    if (!existsSync(lockPath)) renameSync(stalePath, lockPath);
    throw new Error("Bind-ahead recovery dead-owner lock capture changed identity.");
  }
  let release;
  try {
    release = createOwnedOperationLock({ lockPath, operationId, token });
  } catch (error) {
    if (!existsSync(lockPath)) renameSync(stalePath, lockPath);
    else unlinkSync(stalePath);
    syncDirectory(path.dirname(lockPath));
    throw error;
  }
  unlinkSync(stalePath);
  syncDirectory(path.dirname(lockPath));
  return release;
}

function createOwnedOperationLock({ lockPath, operationId, token }) {
  const descriptor = openSync(lockPath, "wx", 0o600);
  const owner = { schema: LOCK_SCHEMA, operationId, pid: process.pid, token };
  try {
    writeFileSync(descriptor, `${JSON.stringify(owner)}\n`);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  syncDirectory(path.dirname(lockPath));
  return () => {
    const current = readOperationLock(lockPath);
    if (!current || current.operationId !== operationId
      || current.token !== token || current.pid !== process.pid) {
      throw new Error("Bind-ahead recovery operation lock ownership changed.");
    }
    unlinkSync(lockPath);
    syncDirectory(path.dirname(lockPath));
  };
}

function readOperationLock(target) {
  if (!existsSync(target)) return null;
  let source;
  try { source = readSecureLockFile(target); }
  catch { return null; }
  let value;
  try { value = JSON.parse(source); }
  catch { return null; }
  const keys = ["operationId", "pid", "schema", "token"];
  if (!value || typeof value !== "object" || Array.isArray(value)
    || canonicalJson(Object.keys(value).sort()) !== canonicalJson(keys)
    || value.schema !== LOCK_SCHEMA || !DIGEST.test(String(value.operationId || ""))
    || !Number.isSafeInteger(value.pid) || value.pid < 1
    || typeof value.token !== "string" || !value.token) return null;
  return value;
}

function readSecureLockFile(target) {
  const metadata = lstatSync(target);
  if (!metadata.isFile() || metadata.isSymbolicLink()
    || (metadata.mode & 0o777) !== 0o600
    || metadata.size < 1 || metadata.size > MAX_LOCK_BYTES) {
    throw new Error("Bind-ahead recovery operation lock is not a bounded 0600 file.");
  }
  const descriptor = openSync(target, "r");
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== metadata.dev || opened.ino !== metadata.ino
      || opened.size !== metadata.size || (opened.mode & 0o777) !== 0o600) {
      throw new Error("Bind-ahead recovery operation lock changed during secure open.");
    }
    return readFileSync(descriptor, "utf8");
  } finally {
    closeSync(descriptor);
  }
}

function processIsAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

function syncDirectory(directory) {
  const descriptor = openSync(directory, "r");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function branchFenceReceipt({ plan, result, fence, disposition }) {
  return Object.freeze({
    disposition,
    fenceDigest: fence.fenceDigest,
    registryRevision: result.registryRevision,
    sourceClaimId: plan.evidence.cloud.liveClaim.claimId,
    sourceLeaseDigest: plan.evidence.committed.sourceLeaseDigest,
    writerRegistryMutation: disposition === "acquired",
  });
}

function fenceReleaseReceipt({ plan, fence, disposition, registryRevision }) {
  const core = {
    planDigest: plan.planDigest,
    fenceDigest: fence.fenceDigest,
    disposition,
    registryRevision,
  };
  return Object.freeze({
    schema:
      "agentic-expired-published-bind-ahead-clean-descendant-fence-release/v1",
    ...core,
    receiptDigest: digestValue(core),
  });
}

function manifestFromPlan(plan) {
  const admission = plan.evidence.committed.sourceLease.admission;
  return Object.freeze({ manifestDigest: admission.manifestDigest,
    declaredWriteSet: normalizeWriteSet(admission.declaredWriteSet),
    writeSetDigest: admission.writeSetDigest });
}

function stableCloudAuthority(authority) {
  const { ledgerRevision: _ledgerRevision, ledgerDigest: _ledgerDigest, ...stable } =
    authority || {};
  return stable;
}

function stableClaimCore(value) {
  const {
    expiresAt: _expiresAt,
    heartbeatCounter: _heartbeatCounter,
    recovery: _recovery,
    transitionCounter: _transitionCounter,
    ...stable
  } = value || {};
  return stable;
}

function withoutSidecarHead(values) {
  const { sidecarHeadDigest: _sidecarHeadDigest, ...reconciliation } = values || {};
  return reconciliation;
}

function durableCloudVerification(value) {
  let durable;
  try { durable = JSON.parse(JSON.stringify(value)); }
  catch { invalid("serializable cloud verification"); }
  if (!durable || typeof durable !== "object" || Array.isArray(durable)
    || !DIGEST.test(String(durable.receiptDigest || ""))
    || typeof durable.verifiedAt !== "string"
    || !Number.isFinite(Date.parse(durable.verifiedAt))) {
    invalid("durable cloud verification");
  }
  return Object.freeze(durable);
}

function cloudSidecarHead(sidecar) {
  const generation = sidecar?.generations?.at(-1);
  if (!generation) invalid("cloud sidecar head");
  return generation;
}

function cloudSidecarSummary(plan, sidecar) {
  const head = cloudSidecarHead(sidecar);
  const bind = plan.evidence.cloud.targetEntry.claimCore;
  const cloudContinuationCount =
    head.authority.transitionCounter - bind.transitionCounter;
  const cloudRenewalCount =
    head.authority.heartbeatCounter - bind.heartbeatCounter;
  const cloudRecoveryCount = cloudContinuationCount - cloudRenewalCount;
  if (!Number.isSafeInteger(cloudContinuationCount) || cloudContinuationCount < 0
    || !Number.isSafeInteger(cloudRenewalCount) || cloudRenewalCount < 0
    || !Number.isSafeInteger(cloudRecoveryCount) || cloudRecoveryCount < 0) {
    invalid("cloud sidecar aggregate continuation counts");
  }
  return Object.freeze({
    cloudDisposition: head.reconciliation.disposition,
    cloudGenerationCount: sidecar.generations.length,
    cloudContinuationCount,
    cloudRenewalCount,
    cloudRecoveryCount,
    cloudLedgerMutation: cloudContinuationCount > 0,
    cloudResponseLossAdopted: sidecar.generations.some(
      generation => generation.reconciliation.responseLossAdopted,
    ),
  });
}

function normalizeCloudSidecar(plan, value) {
  if (!value || value.schema !== CLOUD_SIDECAR_SCHEMA
    || value.planDigest !== plan.planDigest
    || !Array.isArray(value.generations) || value.generations.length < 1
    || value.generations.length > MAX_CLOUD_GENERATIONS) {
    invalid("cloud sidecar");
  }
  const generations = [];
  let previousGenerationDigest = null;
  let previousAuthority = null;
  for (const [index, candidate] of value.generations.entries()) {
    const verification = durableCloudVerification(candidate?.verification);
    const authority = candidate?.authority;
    const reconciliation = normalizeSidecarReconciliation(
      plan,
      candidate?.reconciliation,
    );
    if (!authority || typeof authority !== "object" || Array.isArray(authority)
      || !reconciliation || typeof reconciliation !== "object"
      || Array.isArray(reconciliation)
      || authority.claimId !== plan.evidence.cloud.liveClaim.claimId
      || authority.laneRevision !== plan.evidence.committed.publishedHeadSha
      || authority.canonicalBaseSha !== plan.evidence.committed.sourceLease.baseSha
      || authority.state !== "active"
      || reconciliation.authorityDigest !== digestValue(authority)
      || reconciliation.verificationReceiptDigest !== verification.receiptDigest
      || reconciliation.verifiedAt !== verification.verifiedAt
      || reconciliation.claimId !== authority.claimId
      || reconciliation.claimDigest !== authority.claimDigest
      || reconciliation.transitionDigest !== authority.claimLedgerRevision
      || reconciliation.transitionCounter !== authority.transitionCounter
      || reconciliation.operationReceiptDigest !== authority.operationReceiptDigest
      || reconciliation.recoveryEvidenceDigest !== plan.recoveryEvidenceDigest) {
      invalid("cloud sidecar generation subject");
    }
    const lineageSource = previousAuthority || {
      transitionCounter: plan.evidence.cloud.targetEntry.claimCore.transitionCounter,
      heartbeatCounter: plan.evidence.cloud.targetEntry.claimCore.heartbeatCounter,
      expiresAt: plan.evidence.cloud.targetEntry.claimCore.expiresAt,
    };
    const transitionAdvance = authority.transitionCounter
      - lineageSource.transitionCounter;
    const heartbeatAdvance = authority.heartbeatCounter
      - lineageSource.heartbeatCounter;
    if (!Number.isSafeInteger(transitionAdvance)
      || transitionAdvance < (previousAuthority ? 1 : 0)
      || !Number.isSafeInteger(heartbeatAdvance) || heartbeatAdvance < 0
      || heartbeatAdvance > transitionAdvance
      || reconciliation.recoveryTransitionRecorded
        !== (heartbeatAdvance < transitionAdvance)) {
      invalid("cloud sidecar continuation lineage");
    }
    if (previousAuthority) {
      const previousStable = stableCloudAuthority(previousAuthority);
      const currentStable = stableCloudAuthority(authority);
      for (const dynamic of [
        "claimDigest", "claimLedgerRevision", "operationReceiptDigest",
        "transitionCounter", "heartbeatCounter", "expiresAt",
      ]) {
        delete previousStable[dynamic];
        delete currentStable[dynamic];
      }
      if (canonicalJson(previousStable) !== canonicalJson(currentStable)
        || authority.transitionCounter <= previousAuthority.transitionCounter
        || Date.parse(authority.expiresAt) <= Date.parse(previousAuthority.expiresAt)) {
        invalid("cloud sidecar generation lineage");
      }
    }
    const core = {
      schema: CLOUD_GENERATION_SCHEMA,
      planDigest: plan.planDigest,
      ordinal: index + 1,
      previousGenerationDigest,
      authority,
      verification,
      reconciliation,
    };
    const generation = Object.freeze({
      ...core,
      generationDigest: digestValue(core),
    });
    if (canonicalJson(candidate) !== canonicalJson(generation)) {
      invalid("cloud sidecar generation projection");
    }
    generations.push(generation);
    previousGenerationDigest = generation.generationDigest;
    previousAuthority = authority;
  }
  const sidecarCore = {
    schema: CLOUD_SIDECAR_SCHEMA,
    planDigest: plan.planDigest,
    generations: Object.freeze(generations),
    headGenerationDigest: previousGenerationDigest,
  };
  const rebuilt = Object.freeze({
    ...sidecarCore,
    sidecarDigest: digestValue(sidecarCore),
  });
  if (value.headGenerationDigest !== previousGenerationDigest
    || canonicalJson(value) !== canonicalJson(rebuilt)) {
    invalid("cloud sidecar projection");
  }
  return rebuilt;
}

function normalizeSidecarReconciliation(plan, value) {
  const keys = [
    "authorityDigest", "claimDigest", "claimId", "cloudLedgerMutation",
    "disposition", "operationReceiptDigest", "recoveryEvidenceDigest",
    "recoveryTransitionRecorded", "responseLossAdopted", "transitionCounter",
    "transitionDigest", "verificationReceiptDigest", "verifiedAt",
  ];
  if (!value || typeof value !== "object" || Array.isArray(value)
    || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())
    || !new Set([
      "adopted-current-bind", "recovered-dormant",
      "adopted-recovery-response-loss", "projection-recovered-dormant",
      "projection-renewed-current",
      "projection-adopted-recovery-response-loss",
      "projection-adopted-renewal-response-loss",
    ]).has(value.disposition)
    || value.claimId !== plan.evidence.cloud.liveClaim.claimId
    || value.recoveryEvidenceDigest !== plan.recoveryEvidenceDigest
    || !Number.isSafeInteger(value.transitionCounter) || value.transitionCounter < 1
    || typeof value.verifiedAt !== "string"
    || !Number.isFinite(Date.parse(value.verifiedAt))) {
    invalid("cloud sidecar reconciliation");
  }
  for (const key of [
    "authorityDigest", "claimDigest", "claimId", "operationReceiptDigest",
    "recoveryEvidenceDigest", "transitionDigest", "verificationReceiptDigest",
  ]) {
    if (!DIGEST.test(String(value[key] || ""))) {
      invalid("cloud sidecar reconciliation digest");
    }
  }
  for (const key of [
    "cloudLedgerMutation", "recoveryTransitionRecorded", "responseLossAdopted",
  ]) {
    if (typeof value[key] !== "boolean") {
      invalid("cloud sidecar reconciliation boolean");
    }
  }
  const directMutation = new Set([
    "recovered-dormant",
    "projection-recovered-dormant",
    "projection-renewed-current",
  ]).has(value.disposition);
  const recoveryRecorded = new Set([
    "recovered-dormant",
    "adopted-recovery-response-loss",
    "projection-recovered-dormant",
    "projection-adopted-recovery-response-loss",
  ]).has(value.disposition);
  const responseLossDisposition = new Set([
    "adopted-recovery-response-loss",
    "projection-adopted-recovery-response-loss",
    "projection-adopted-renewal-response-loss",
  ]).has(value.disposition);
  if (value.cloudLedgerMutation !== directMutation
    || value.recoveryTransitionRecorded !== recoveryRecorded
    || (responseLossDisposition && value.responseLossAdopted !== true)) {
    invalid("cloud sidecar reconciliation disposition");
  }
  return Object.freeze({ ...value });
}

function ensureDirectory(directory) {
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true, mode: 0o700 });
  const metadata = lstatSync(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o077)) {
    invalid("private journal directory");
  }
}
function privateFile(file, label) {
  const metadata = lstatSync(file);
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077)) invalid(label);
}
function inside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function required(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim()) invalid(label);
  return value;
}
function requiredSha(value, label) { if (!SHA.test(String(value || ""))) invalid(label); return value; }
function instant(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) invalid(label);
  return new Date(value).toISOString();
}
function positive(value, label) {
  const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) invalid(label);
  return number;
}
function nonnegativeCounter(value, label) {
  const number = Number(value); if (!Number.isSafeInteger(number) || number < 0) invalid(label);
  return number;
}
function bounded(value, label, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) invalid(label);
  return number;
}
function invalid(label) {
  throw new Error(`Expired published bind-ahead clean-descendant adapter has invalid ${label}.`);
}
