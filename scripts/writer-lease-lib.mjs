// Responsibility: Own writer-lease registry storage, lifecycle transitions, and PR marker projections.
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { normalizeOwnedDirtRecovery } from "./owned-dirt-resume-lib.mjs";
import { normalizeActiveOwnedDirtLeaseRecovery,
  validateCompletedActiveOwnedDirtRecoveryIntent } from "./active-owned-dirt-recovery-contract.mjs";
import { normalizePreClaimIntegrationContinuation } from "./expired-committed-continuation-lib.mjs";
import {
  normalizeProtectedMainPathEquivalenceEvidence,
  normalizeProtectedMainSharedAncestorPathEquivalenceEvidence,
  RECOVERY_PATH_EVIDENCE_MAX_PATHS,
} from "./protected-main-path-equivalence-lib.mjs";
import {
  assertTaskAuthorityTransition,
  authorizeTaskBoundLeaseMutation,
  createTaskAuthorityLeaseBinding,
} from "./task-bound-lane-authority-store.mjs";
import { normalizeTaskAuthorityBinding }
  from "./task-bound-lane-authority-contract.mjs";

export const WRITER_LEASE_SCHEMA = "agentic-writer-lease/v2";
export const WRITER_LEASE_REGISTRY_SCHEMA = "agentic-writer-lease-registry/v2";
export const LEGACY_EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_SCHEMA =
  "agentic-expired-committed-heartbeat-recovery/v1";
export const PRE_PUSHED_PREFIX_EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_SCHEMA =
  "agentic-expired-committed-heartbeat-recovery/v2";
export const EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_SCHEMA =
  "agentic-expired-committed-heartbeat-recovery/v3";
export const DEFAULT_WRITER_LEASE_TTL_MS = 30 * 60 * 1000;
export const DEFAULT_PULL_REQUEST_ACTION = "/change";
export const DEVICE_BRANCH_PATTERN =
  /^agent\/([a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const EMPTY_PATHS_DIGEST = digestValue([]);
const LEGACY_EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_KEYS = Object.freeze([
  "changedPathCount",
  "changedPathsDigest",
  "headSha",
  "pullRequestBodyDigest",
  "rangeDiffDigest",
  "recoveredAt",
  "renewedClaimDigest",
  "renewedClaimLedgerRevision",
  "renewedCloudTransitionCounter",
  "renewedLedgerRevision",
  "schema",
  "sourceBaseSha",
  "sourceBranch",
  "sourceClaimDigest",
  "sourceClaimId",
  "sourceClaimLedgerRevision",
  "sourceCloudTransitionCounter",
  "sourceDevice",
  "sourceEpoch",
  "sourceFenceSha",
  "sourceLedgerRevision",
  "sourceMarkerDigest",
  "sourcePullRequestUrl",
  "sourceScope",
  "sourceSessionId",
  "status",
  "treeSha",
]);
const PRE_PUSHED_PREFIX_EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_KEYS =
  Object.freeze([
    ...LEGACY_EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_KEYS,
    "declaredChangedPathCount",
    "declaredChangedPathsDigest",
    "protectedEquivalentPathCount",
    "protectedEquivalentPathsDigest",
    "protectedMainEquivalence",
    "protectedMainEquivalenceDigest",
  ].sort());
const EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_KEYS = Object.freeze([
  ...PRE_PUSHED_PREFIX_EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_KEYS,
  "sourceRemoteChangedPathCount",
  "sourceRemoteChangedPathsDigest",
  "sourceRemoteDeclaredChangedPathCount",
  "sourceRemoteDeclaredChangedPathsDigest",
  "sourceRemoteHeadSha",
  "sourceRemoteProtectedEquivalentPathCount",
  "sourceRemoteProtectedEquivalentPathsDigest",
  "sourceRemoteSharedAncestorEquivalence",
  "sourceRemoteSharedAncestorEquivalenceDigest",
  "sourceRemoteRangeDiffDigest",
  "sourceRemoteTreeSha",
].sort());

export function parseDeviceBranch(branch) {
  const match = String(branch || "").match(DEVICE_BRANCH_PATTERN);
  return match ? { branch, device: match[1], scope: match[2] } : null;
}

export function assertUniquePullRequestScopes(pulls) {
  const owners = new Map();
  for (const pull of Array.isArray(pulls) ? pulls : []) {
    const identity = parseDeviceBranch(pull.headRefName);
    if (!identity) continue;
    const existing = owners.get(identity.scope);
    if (existing && existing.headRefName !== pull.headRefName) {
      throw new Error(
        `Semantic scope ${identity.scope} has multiple active pull requests: #${existing.number}:${existing.headRefName}, #${pull.number}:${pull.headRefName}`,
      );
    }
    owners.set(identity.scope, pull);
  }
  return owners;
}

export function assertNoCompetingScopePullRequests(pulls, activeBranch) {
  const active = parseDeviceBranch(activeBranch);
  if (!active) throw new Error(`Expected an agent/<device>/<semantic-scope> branch; received ${activeBranch}`);
  const owners = assertUniquePullRequestScopes(pulls);
  const owner = owners.get(active.scope);
  if (owner && owner.headRefName !== activeBranch) {
    throw new Error(
      `Semantic scope ${active.scope} is already owned by #${owner.number}:${owner.headRefName}; wait for an exact-SHA handoff.`,
    );
  }
  return owner || null;
}

export function createWriterLeaseStore({
  gitCommonDir,
  now = () => new Date(),
  taskAuthorityFile = process.env.AGENTIC_TASK_AUTHORITY_FILE || null,
  taskAuthorityPolicy = "projected",
}) {
  if (!["projected", "required"].includes(taskAuthorityPolicy)) {
    throw new Error("Writer lease task authority policy is invalid.");
  }
  const commonRoot = path.resolve(gitCommonDir);
  requireRealDirectory(commonRoot, "Git common directory");
  const root = path.resolve(commonRoot, "agentic-canvas-os");
  const statePath = path.join(root, "writer-leases.json");
  const lockPath = path.join(root, "writer-leases.lock");

  function readRegistry() {
    requireRegistryStoragePath(root, statePath);
    if (!existsSync(statePath)) {
      return { schema: WRITER_LEASE_REGISTRY_SCHEMA, revision: 0, leases: {} };
    }
    const value = JSON.parse(readFileSync(statePath, "utf8"));
    if (value.schema !== WRITER_LEASE_REGISTRY_SCHEMA || !value.leases || typeof value.leases !== "object"
      || Array.isArray(value.leases)
      || !validRegistryRevision(value.revision)
      || Object.values(value.leases).some(candidate => !validStoredLease(candidate))) {
      throw new Error(
        `Unsupported writer lease registry schema; writer registry revision or lease is invalid at ${statePath}`,
      );
    }
    return value;
  }

  function read(branch) {
    const registry = readRegistry();
    if (!branch) return registry;
    return registry.leases[branch] || null;
  }

  function claim({
    sessionId,
    device,
    scope,
    branch,
    worktreePath,
    baseSha,
    autoDelivery = false,
    ownedDirtRecovery = null,
    integration = null,
    preClaimIntegrationContinuation = null,
    admission = null,
    cloudAuthority = null,
    previousEpoch = 0,
    ttlMs = DEFAULT_WRITER_LEASE_TTL_MS,
    expiresAtCap = null,
  }) {
    requireIdentity({ sessionId, device, scope, branch, worktreePath, baseSha });
    const normalizedOwnedDirtRecovery = normalizeOwnedDirtRecovery(ownedDirtRecovery);
    const normalizedPreClaimIntegrationContinuation =
      normalizePreClaimIntegrationContinuation(preClaimIntegrationContinuation);
    const scopedAdmission = normalizeScopedAdmission({
      admission,
      cloudAuthority,
      scope,
      baseSha,
    });
    if (normalizedPreClaimIntegrationContinuation && (
      integration?.schema !== "agentic-integration-commit/v1" ||
      integration.commitSha !== normalizedPreClaimIntegrationContinuation.integrationCommitSha ||
      integration.treeSha !== normalizedPreClaimIntegrationContinuation.integrationTreeSha
    )) {
      throw new Error("Pre-claim continuation requires its exact integration commit and tree.");
    }
    return withLock(() => {
      const registry = readRegistry();
      const current = registry.leases[branch] || null;
      if (current) requireMutableLeaseEpoch(current, branch);
      const instant = now();
      const normalizedWorktreePath = path.resolve(worktreePath);
      if (current?.status === "completing") {
        throw new Error(`Branch ${branch} is completing merged cleanup and cannot be reclaimed.`);
      }
      for (const candidate of Object.values(registry.leases)) {
        if (candidate?.status === "completing" && candidate.branch !== branch &&
            path.resolve(candidate.worktreePath) === normalizedWorktreePath) {
          throw new Error(`Worktree ${normalizedWorktreePath} is completing merged cleanup for ${candidate.scope}.`);
        }
        if (!isActive(candidate, instant) || candidate.branch === branch) continue;
        if (path.resolve(candidate.worktreePath) === normalizedWorktreePath) {
          throw new Error(
            `Worktree ${normalizedWorktreePath} is leased to another session for ${candidate.scope} until ${candidate.expiresAt}.`,
          );
        }
      }
      if (isActive(current, instant) && current.sessionId !== sessionId) {
        throw new Error(
          `Branch ${branch} is leased to another session in ${current.worktreePath} until ${current.expiresAt}.`,
        );
      }
      if (isActive(current, instant) && current.sessionId === sessionId) {
        if (path.resolve(current.worktreePath) !== normalizedWorktreePath) {
          throw new Error(`Session ${sessionId} already owns ${branch} in ${current.worktreePath}.`);
        }
        return current;
      }
      if (current && taskAuthorityPolicy === "required" && !current.taskAuthority) {
        throw new Error("Existing writer lease requires explicit task-bound authority migration.");
      }
      const timestamp = instant.toISOString();
      const maximumEpoch = Object.values(registry.leases)
        .reduce((highest, lease) => Math.max(highest, Number(lease?.epoch || 0)), 0);
      const leaseCore = {
        schema: WRITER_LEASE_SCHEMA,
        status: "active",
        epoch: Math.max(maximumEpoch, Number(previousEpoch || 0)) + 1,
        sessionId,
        device,
        scope,
        branch,
        worktreePath: normalizedWorktreePath,
        baseSha,
        fenceSha: null,
        pullRequestUrl: null,
        autoDelivery: Boolean(autoDelivery),
        runtimeRequired: Boolean(autoDelivery),
        ...(normalizedOwnedDirtRecovery ? { ownedDirtRecovery: normalizedOwnedDirtRecovery } : {}),
        ...(normalizedPreClaimIntegrationContinuation ? {
          integration,
          preClaimIntegrationContinuation: normalizedPreClaimIntegrationContinuation,
        } : {}),
        ...(scopedAdmission || {}),
        acquiredAt: timestamp,
        heartbeatAt: timestamp,
        expiresAt: boundedExpiry({ instant, ttlMs, expiresAtCap }),
      };
      if (taskAuthorityPolicy === "required" && !taskAuthorityFile) {
        throw new Error("A task authority capability file is required for a new writer lease.");
      }
      const lease = taskAuthorityFile ? {
        ...leaseCore,
        taskAuthority: createTaskAuthorityLeaseBinding({
          lease: leaseCore,
          capabilityPath: taskAuthorityFile,
          bindingMode: current?.taskAuthority ? "continuation" : "claim",
          boundAt: timestamp,
          priorBindingDigest: current?.taskAuthority?.bindingDigest || null,
        }),
      } : leaseCore;
      writeRegistry({
        ...registry,
        revision: Number(registry.revision || 0) + 1,
        leases: { ...registry.leases, [branch]: lease },
      });
      return lease;
    });
  }

  function verify({ sessionId, branch, allowExpired = false }) {
    if (!branch) throw new Error("Writer lease verification requires a branch.");
    const lease = read(branch);
    if (!lease || lease.status !== "active") throw new Error(`No active writer lease owns ${branch}.`);
    requireMutableLeaseEpoch(lease, branch);
    if (sessionId && lease.sessionId !== sessionId) {
      throw new Error("Writer lease belongs to another session.");
    }
    if (branch && lease.branch !== branch) {
      throw new Error(`Writer lease owns ${lease.branch}, not ${branch}.`);
    }
    if (!allowExpired && !isActive(lease, now())) {
      throw new Error(`Writer lease expired at ${lease.expiresAt}; renew or hand off before mutation.`);
    }
    requireProjectedTaskAuthority({ lease, operation: "writer-lease-verify" });
    return lease;
  }

  function assertTaskAuthority({ branch, operation }) {
    if (!branch) throw new Error("Task authority verification requires a branch.");
    const lease = read(branch);
    if (!lease) throw new Error(`No writer lease owns ${branch}.`);
    requireProjectedTaskAuthority({ lease, operation });
    return lease;
  }

  function bindTaskAuthority({
    sessionId,
    branch,
    targetCapabilityFile,
    planDigest,
    boundAt,
  }) {
    return withLock(() => {
      const registry = readRegistry();
      const current = registry.leases[branch] || null;
      if (!current || current.status !== "active" || current.sessionId !== sessionId) {
        throw new Error("Task authority migration requires its exact active writer lease.");
      }
      if (current.taskAuthority) throw new Error("Writer lease already has task-bound authority.");
      const taskAuthority = assertTaskAuthorityTransition({
        operation: "migration",
        lease: current,
        targetCapabilityPath: targetCapabilityFile,
        planDigest,
        boundAt,
      });
      const lease = { ...current, taskAuthority };
      writeRegistry({
        ...registry,
        revision: Number(registry.revision || 0) + 1,
        leases: { ...registry.leases, [branch]: lease },
      }, { transitionBranch: branch, transitionKind: "migration" });
      return lease;
    });
  }

  // Re-anchors one bound subject onto its own lane after the lane's volatile
  // operands moved. It changes no authority and no content, so it is the exit
  // from a drifted binding rather than a fresh grant.
  function rebindTaskAuthority({
    sessionId,
    branch,
    targetCapabilityFile,
    planDigest,
    boundAt,
  }) {
    return withLock(() => {
      const registry = readRegistry();
      const current = registry.leases[branch] || null;
      if (!current || current.status !== "active" || current.sessionId !== sessionId) {
        throw new Error("Task authority rebind requires its exact active writer lease.");
      }
      if (!current.taskAuthority) throw new Error("Writer lease has no task-bound authority to rebind.");
      const taskAuthority = assertTaskAuthorityTransition({
        operation: "rebind",
        lease: current,
        targetCapabilityPath: targetCapabilityFile,
        planDigest,
        boundAt,
      });
      const lease = { ...current, taskAuthority };
      writeRegistry({
        ...registry,
        revision: Number(registry.revision || 0) + 1,
        leases: { ...registry.leases, [branch]: lease },
      }, { transitionBranch: branch, transitionKind: "rebind" });
      return lease;
    });
  }

  function handoffTaskAuthority({
    sessionId,
    branch,
    sourceCapabilityFile,
    targetCapabilityFile,
    planDigest,
    boundAt,
  }) {
    return withLock(() => {
      const registry = readRegistry();
      const current = registry.leases[branch] || null;
      if (!current || current.status !== "active" || current.sessionId !== sessionId) {
        throw new Error("Task authority handoff requires its exact active writer lease.");
      }
      const taskAuthority = assertTaskAuthorityTransition({
        operation: "handoff",
        lease: current,
        sourceCapabilityPath: sourceCapabilityFile,
        targetCapabilityPath: targetCapabilityFile,
        planDigest,
        boundAt,
      });
      const lease = { ...current, taskAuthority };
      writeRegistry({
        ...registry,
        revision: Number(registry.revision || 0) + 1,
        leases: { ...registry.leases, [branch]: lease },
      }, { transitionBranch: branch, transitionKind: "handoff" });
      return lease;
    });
  }

  function heartbeat({
    sessionId,
    branch,
    ttlMs = DEFAULT_WRITER_LEASE_TTL_MS,
    expiresAtCap = null,
  }) {
    return withLock(() => {
      const registry = readRegistry();
      const recoveryIntent = registry.activeOwnedDirtRecoveryIntents?.[branch] ?? null;
      const completedRecovery = recoveryIntent?.status === "complete"
        ? Boolean(validateCompletedActiveOwnedDirtRecoveryIntent(recoveryIntent)) : false;
      if (recoveryIntent && !completedRecovery) {
        throw new Error("Active-owned-dirt recovery intent fences this writer-lease heartbeat.");
      }
      const current = verify({ sessionId, branch, allowExpired: true });
      const instant = now();
      const lease = {
        ...current,
        heartbeatAt: instant.toISOString(),
        expiresAt: boundedExpiry({ instant, ttlMs, expiresAtCap }),
      };
      writeRegistry({
        ...registry,
        revision: Number(registry.revision || 0) + 1,
        leases: { ...registry.leases, [branch]: lease },
      });
      return lease;
    });
  }

  function recoverExpiredCommittedHeartbeat({
    sessionId,
    branch,
    expectedLease,
    renewedCloudAuthority,
    recoveryEvidence,
    ttlMs = DEFAULT_WRITER_LEASE_TTL_MS,
    recoveredAt,
  }) {
    return withLock(() => {
      const registry = readRegistry();
      const current = registry.leases[branch] || null;
      const instant = now();
      if (!current || JSON.stringify(current) !== JSON.stringify(expectedLease)) {
        throw new Error(`Writer lease for ${branch} changed before expired committed recovery.`);
      }
      requireMutableLeaseEpoch(current, branch);
      if (
        current.schema !== WRITER_LEASE_SCHEMA ||
        current.status !== "active" ||
        current.sessionId !== sessionId ||
        current.branch !== branch
      ) {
        throw new Error("Expired committed recovery lost its exact active writer lease identity.");
      }
      const sourceExpiry = Date.parse(current.expiresAt);
      if (!Number.isFinite(sourceExpiry) || sourceExpiry > instant.getTime()) {
        throw new Error("Expired committed recovery requires an expired local writer lease.");
      }
      const lease = projectExpiredCommittedHeartbeatLease({
        sourceLease: current,
        renewedCloudAuthority,
        recoveryEvidence,
        ttlMs,
        recoveredAt,
      });
      if (
        Date.parse(lease.heartbeatAt) > instant.getTime() ||
        Date.parse(lease.expiresAt) <= instant.getTime()
      ) {
        throw new Error(
          "Expired committed recovery projection is not live at the local registry CAS.",
        );
      }
      writeRegistry({
        ...registry,
        revision: Number(registry.revision || 0) + 1,
        leases: { ...registry.leases, [branch]: lease },
      });
      return lease;
    });
  }

  function annotate({ sessionId, branch, allowExpired = false, values }) {
    return withLock(() => {
      const registry = readRegistry();
      const current = verify({ sessionId, branch, allowExpired });
      const lease = { ...current, ...values, schema: WRITER_LEASE_SCHEMA };
      writeRegistry({
        ...registry,
        revision: Number(registry.revision || 0) + 1,
        leases: { ...registry.leases, [branch]: lease },
      });
      return lease;
    });
  }

  function beginCompletion({ branch, pullRequestUrl, mergeCommitSha, mainSha }) {
    requireSha(mergeCommitSha, "mergeCommitSha");
    requireSha(mainSha, "mainSha");
    return withLock(() => {
      const registry = readRegistry();
      const current = registry.leases[branch] || null;
      if (current) requireMutableLeaseEpoch(current, branch);
      if (["completing", "completed"].includes(current?.status)) {
        if (current.pullRequestUrl === pullRequestUrl && current.completion?.mergeCommitSha === mergeCommitSha &&
            /^[0-9a-f]{40}$/.test(String(current.completion?.mainSha || ""))) return current;
        throw new Error(`Completion intent for ${branch} does not match the requested merge evidence.`);
      }
      if (!current || !["active", "delivery", "review_ready"].includes(current.status)) {
        throw new Error(`No completable writer lease owns ${branch}.`);
      }
      if (current.pullRequestUrl && current.pullRequestUrl !== pullRequestUrl) {
        throw new Error(`Writer lease pull request ${current.pullRequestUrl} does not match ${pullRequestUrl}.`);
      }
      const timestamp = now().toISOString();
      const lease = {
        ...current,
        status: "completing",
        pullRequestUrl,
        completion: { mergeCommitSha, mainSha },
        heartbeatAt: timestamp,
        expiresAt: timestamp,
      };
      writeRegistry({
        ...registry,
        revision: Number(registry.revision || 0) + 1,
        leases: { ...registry.leases, [branch]: lease },
      });
      return lease;
    });
  }

  function recoverFromPullRequestMarker({ branch, worktreePath, pullRequestUrl, pullRequestBody }) {
    if (!branch) throw new Error("Recovery requires an exact agent branch.");
    if (!pullRequestUrl) throw new Error("Recovery requires the merged pull request URL.");
    return withLock(() => {
      const registry = readRegistry();
      const current = registry.leases[branch] || null;
      if (current) {
        requireMutableLeaseEpoch(current, branch);
        return current;
      }
      const hasMarker = String(pullRequestBody || "").includes(WRITER_LEASE_SCHEMA);
      const recovered = parseWriterLeasePullRequestBody(pullRequestBody);
      if (!recovered || recovered.branch !== branch) {
        if (hasMarker) {
          throw new Error(`Writer lease marker for ${branch} is present but invalid.`);
        }
        throw new Error(`No recoverable writer lease marker records ${branch}.`);
      }
      if (!["active", "delivery", "review_ready", "completing", "completed"].includes(recovered.status)) {
        throw new Error(`Writer lease marker for ${branch} is ${recovered.status}, not completable.`);
      }
      const lease = {
        ...recovered,
        schema: WRITER_LEASE_SCHEMA,
        worktreePath: path.resolve(worktreePath),
        pullRequestUrl,
      };
      writeRegistry({
        ...registry,
        revision: Number(registry.revision || 0) + 1,
        leases: { ...registry.leases, [branch]: lease },
      });
      return lease;
    });
  }

  function recoverMergedPullRequestCompletion({
    branch,
    worktreePath,
    pullRequestUrl,
    mergeCommitSha,
    mainSha,
    headSha,
  }) {
    if (!branch) throw new Error("Merged pull request recovery requires an exact agent branch.");
    if (!pullRequestUrl) throw new Error("Merged pull request recovery requires the merged pull request URL.");
    requireSha(mergeCommitSha, "mergeCommitSha");
    requireSha(mainSha, "mainSha");
    requireSha(headSha, "headSha");
    const identity = parseDeviceBranch(branch);
    if (!identity) {
      throw new Error(`Merged pull request recovery requires an agent/<device>/<scope> branch; received ${branch}.`);
    }
    return withLock(() => {
      const registry = readRegistry();
      const current = registry.leases[branch] || null;
      if (current) {
        requireMutableLeaseEpoch(current, branch);
        return current;
      }
      const timestamp = now().toISOString();
      const maximumEpoch = Object.values(registry.leases)
        .reduce((highest, lease) => Math.max(highest, Number(lease?.epoch || 0)), 0);
      const lease = {
        schema: WRITER_LEASE_SCHEMA,
        status: "completed",
        epoch: maximumEpoch + 1,
        sessionId: `recovered-merged-pr:${branch}`,
        device: identity.device,
        scope: identity.scope,
        branch,
        worktreePath: path.resolve(worktreePath),
        baseSha: mainSha,
        fenceSha: headSha,
        pullRequestUrl,
        autoDelivery: false,
        runtimeRequired: false,
        reviewHeadSha: headSha,
        acquiredAt: timestamp,
        heartbeatAt: timestamp,
        expiresAt: timestamp,
        completion: {
          mergeCommitSha,
          mainSha,
        },
      };
      writeRegistry({
        ...registry,
        revision: Number(registry.revision || 0) + 1,
        leases: { ...registry.leases, [branch]: lease },
      });
      return lease;
    });
  }

  function complete({ branch, pullRequestUrl, mergeCommitSha, mainSha }) {
    requireSha(mergeCommitSha, "mergeCommitSha");
    requireSha(mainSha, "mainSha");
    return withLock(() => {
      const registry = readRegistry();
      const current = registry.leases[branch] || null;
      if (current) requireMutableLeaseEpoch(current, branch);
      if (current?.status === "completed") {
        if (current.pullRequestUrl === pullRequestUrl && current.completion?.mergeCommitSha === mergeCommitSha &&
            current.completion?.mainSha === mainSha) return current;
        throw new Error(`Completed writer lease for ${branch} does not match the requested merge evidence.`);
      }
      if (!current || current.status !== "completing") {
        throw new Error(`No completing writer lease owns ${branch}.`);
      }
      if (current.pullRequestUrl !== pullRequestUrl || current.completion?.mergeCommitSha !== mergeCommitSha ||
          !/^[0-9a-f]{40}$/.test(String(current.completion?.mainSha || ""))) {
        throw new Error(`Completion intent for ${branch} does not match the requested merge evidence.`);
      }
      const timestamp = now().toISOString();
      const lease = {
        ...current,
        status: "completed",
        completion: { mergeCommitSha, mainSha },
        heartbeatAt: timestamp,
        expiresAt: timestamp,
      };
      writeRegistry({
        ...registry,
        revision: Number(registry.revision || 0) + 1,
        leases: { ...registry.leases, [branch]: lease },
      });
      return lease;
    });
  }

  function release({ sessionId, branch, status = "released", expectedLease = null, timestamp = null, values = {} }) {
    return withLock(() => {
      const registry = readRegistry();
      const current = registry.leases[branch] || null;
      if (current) requireMutableLeaseEpoch(current, branch);
      if (!current || !["active", "delivery", "review_ready"].includes(current.status)) {
        throw new Error(`No releasable writer lease owns ${branch}.`);
      }
      if (sessionId && current.sessionId !== sessionId) {
        throw new Error("Writer lease belongs to another session.");
      }
      if (branch && current.branch !== branch) {
        throw new Error(`Writer lease owns ${current.branch}, not ${branch}.`);
      }
      if (expectedLease && JSON.stringify(current) !== JSON.stringify(expectedLease)) {
        throw new Error(`Writer lease for ${branch} changed before ${status}.`);
      }
      const instant = timestamp ? new Date(timestamp) : now();
      const exactTimestamp = instant.toISOString();
      if (timestamp && exactTimestamp !== timestamp) throw new Error("Release timestamp must be canonical ISO UTC.");
      const lease = { ...current, ...values, schema: WRITER_LEASE_SCHEMA, status, heartbeatAt: exactTimestamp, expiresAt: exactTimestamp };
      writeRegistry({
        ...registry,
        revision: Number(registry.revision || 0) + 1,
        leases: { ...registry.leases, [branch]: lease },
      });
      return lease;
    });
  }

  function rollbackClaim({ sessionId, branch, epoch, fenceSha, previousLease = null }) {
    return withLock(() => {
      const registry = readRegistry();
      const current = registry.leases[branch] || null;
      if (current) requireMutableLeaseEpoch(current, branch);
      if (!current || current.status !== "active" || current.sessionId !== sessionId ||
          current.branch !== branch || current.epoch !== epoch || current.fenceSha !== fenceSha) {
        throw new Error(`Writer lease claim for ${branch} changed before rollback.`);
      }
      if (previousLease && (previousLease.schema !== WRITER_LEASE_SCHEMA || previousLease.branch !== branch)) {
        throw new Error(`Previous writer lease for ${branch} is invalid.`);
      }
      const leases = { ...registry.leases };
      if (previousLease) leases[branch] = previousLease;
      else delete leases[branch];
      writeRegistry({ ...registry, revision: Number(registry.revision || 0) + 1, leases });
      return previousLease;
    });
  }

  function writeRegistry(value, { transitionBranch = null, transitionKind = null } = {}) {
    if (value?.schema !== WRITER_LEASE_REGISTRY_SCHEMA || !value.leases
      || !validRegistryRevision(value.revision)
      || typeof value.leases !== "object" || Array.isArray(value.leases)
      || Object.values(value.leases).some(candidate => !validStoredLease(candidate))) {
      throw new Error("Writer lease registry mutation would exceed its safe revision or epoch bounds.");
    }
    const persisted = readRegistry();
    authorizeChangedTaskAuthorities({
      persisted,
      candidate: value,
      transitionBranch,
      transitionKind,
    });
    for (const [branch, candidate] of Object.entries(persisted.leases)) {
      if (candidate.epoch !== undefined) continue;
      if (!Object.hasOwn(value.leases, branch)
          || digestValue(value.leases[branch]) !== digestValue(candidate)) {
        throw new Error(
          `Writer lease registry cannot mutate legacy epoch-less peer ${branch}; recover it first.`,
        );
      }
    }
    for (const [branch, candidate] of Object.entries(value.leases)) {
      if (candidate.epoch !== undefined) continue;
      const previous = persisted.leases[branch];
      if (!previous || previous.epoch !== undefined
          || digestValue(previous) !== digestValue(candidate)) {
        throw new Error(
          `Writer lease registry cannot introduce legacy epoch-less peer ${branch}.`,
        );
      }
    }
    mkdirSync(root, { recursive: true });
    requireRegistryStoragePath(root, statePath);
    const temporaryPath = `${statePath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporaryPath, statePath);
  }

  function withLock(action) {
    mkdirSync(root, { recursive: true });
    const lock = acquireLock(lockPath);
    try {
      return action();
    } finally {
      closeSync(lock.descriptor);
      releaseLock(lockPath, lock.token);
    }
  }

  function withRegistryLock(action) {
    if (typeof action !== "function") throw new Error("Writer lease registry lock requires an action.");
    return withLock(() => action(readRegistry()));
  }

  return { annotate, assertTaskAuthority, beginCompletion, bindTaskAuthority, claim, complete,
    handoffTaskAuthority, rebindTaskAuthority, heartbeat, read,
    recoverExpiredCommittedHeartbeat,
    recoverMergedPullRequestCompletion,
    recoverFromPullRequestMarker,
    readRegistry, release, rollbackClaim, statePath, verify, withRegistryLock };

  function authorizeChangedTaskAuthorities({
    persisted,
    candidate,
    transitionBranch,
    transitionKind,
  }) {
    const branches = new Set([
      ...Object.keys(persisted.leases),
      ...Object.keys(candidate.leases),
    ]);
    for (const branch of branches) {
      const previous = persisted.leases[branch] || null;
      const next = candidate.leases[branch] || null;
      if (digestValue(previous) === digestValue(next)) continue;
      if (branch === transitionBranch && transitionKind) {
        if (!next?.taskAuthority) throw new Error("Task authority transition lost its binding.");
        continue;
      }
      const authorityLease = previous?.taskAuthority ? previous : next;
      if (!authorityLease?.taskAuthority) {
        if (taskAuthorityPolicy === "required") {
          throw new Error("Writer lease mutation requires explicit task-bound authority migration.");
        }
        continue;
      }
      if (
        previous?.taskAuthority
        && next?.taskAuthority
        && previous.taskAuthority.bindingDigest !== next.taskAuthority.bindingDigest
      ) {
        if (!isTaskAuthorityContinuation(previous.taskAuthority, next.taskAuthority)) {
          throw new Error("Ordinary writer lease mutation cannot replace task authority.");
        }
        authorizeTaskBoundLeaseMutation({
          lease: previous,
          capabilityPath: taskAuthorityFile,
          operation: "writer-lease-successor-claim",
          now: now(),
        });
        continue;
      }
      authorizeTaskBoundLeaseMutation({
        lease: authorityLease,
        capabilityPath: taskAuthorityFile,
        operation: "writer-lease-registry-mutation",
        now: now(),
      });
    }
  }

  function requireProjectedTaskAuthority({ lease, operation }) {
    if (!lease.taskAuthority && taskAuthorityPolicy !== "required") return;
    if (!lease.taskAuthority) {
      throw new Error("Writer lease requires explicit task-bound authority migration.");
    }
    authorizeTaskBoundLeaseMutation({
      lease,
      capabilityPath: taskAuthorityFile,
      operation,
      now: now(),
    });
  }

  function isTaskAuthorityContinuation(previousValue, nextValue) {
    const previous = normalizeTaskAuthorityBinding(previousValue);
    const next = normalizeTaskAuthorityBinding(nextValue);
    return next.bindingMode === "continuation"
      && next.priorBindingDigest === previous.bindingDigest
      && next.authoritySubjectId === previous.authoritySubjectId
      && next.proofAdapterId === previous.proofAdapterId
      && next.generation === previous.generation
      && next.publicKey === previous.publicKey
      && next.publicKeyDigest === previous.publicKeyDigest;
  }
}

function requireRealDirectory(candidate, label) {
  const stat = lstatSync(candidate);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a real non-symlink directory.`);
  }
}

function requireRegistryStoragePath(root, statePath) {
  if (existsSync(root)) requireRealDirectory(root, "Writer-lease registry directory");
  if (!existsSync(statePath)) return;
  const stat = lstatSync(statePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Writer-lease registry must be a regular non-symlink file.");
  }
}

function validRegistryRevision(value) {
  return Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER;
}

function validLeaseEpoch(value) {
  return Number.isSafeInteger(value) && value >= 1 && value < Number.MAX_SAFE_INTEGER;
}

function validStoredLease(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && (value.epoch === undefined || validLeaseEpoch(value.epoch));
}

function requireMutableLeaseEpoch(lease, branch) {
  if (!validLeaseEpoch(lease?.epoch)) {
    throw new Error(`Writer lease ${branch} has no valid fencing epoch and cannot be mutated.`);
  }
}

export function projectExpiredCommittedHeartbeatLease({
  sourceLease,
  renewedCloudAuthority,
  recoveryEvidence,
  ttlMs = DEFAULT_WRITER_LEASE_TTL_MS,
  recoveredAt,
}) {
  const instant = new Date(recoveredAt);
  if (
    !Number.isFinite(instant.getTime()) ||
    instant.toISOString() !== recoveredAt ||
    Date.parse(sourceLease?.expiresAt) > instant.getTime()
  ) {
    throw new Error(
      "Expired committed recovery projection requires one exact expired source instant.",
    );
  }
  requireSameRecoveryCloudSubject({
    source: sourceLease?.cloudAuthority,
    renewed: renewedCloudAuthority,
    lease: sourceLease,
    instant,
  });
  const recovery = normalizeExpiredCommittedHeartbeatRecovery({
    ...recoveryEvidence,
    schema: EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_SCHEMA,
    status: "recovered",
    renewedClaimDigest: renewedCloudAuthority.claimDigest,
    renewedLedgerRevision: renewedCloudAuthority.ledgerRevision,
    renewedClaimLedgerRevision: renewedCloudAuthority.claimLedgerRevision,
    renewedCloudTransitionCounter: renewedCloudAuthority.transitionCounter,
    recoveredAt,
  });
  requireRecoveryEvidenceMatchesLease({ recovery, lease: sourceLease });
  return {
    ...sourceLease,
    cloudAuthority: renewedCloudAuthority,
    expiredCommittedHeartbeatRecovery: recovery,
    heartbeatAt: recoveredAt,
    expiresAt: boundedExpiry({
      instant,
      ttlMs,
      expiresAtCap: renewedCloudAuthority.expiresAt,
    }),
  };
}

export function renderWriterLeasePullRequestBody(lease) {
  return [
    "---",
    `action: ${DEFAULT_PULL_REQUEST_ACTION}`,
    `scope: "#${lease.scope}"`,
    `actor: "@${lease.device}"`,
    `base_sha: "${lease.baseSha}"`,
    "---",
    "",
    "Device branch claimed for protected, scope-aware delivery.",
    "",
    renderWriterLeaseMarker(lease),
  ].join("\n");
}

export function updateWriterLeasePullRequestBody(body, lease) {
  const source = String(body || "").trimEnd();
  const marker = renderWriterLeaseMarker(lease);
  const pattern = new RegExp(`<!--\\s*${escapeRegExp(WRITER_LEASE_SCHEMA)}\\s+\\{.*?\\}\\s*-->`, "s");
  if (pattern.test(source)) return source.replace(pattern, marker);
  return source ? `${source}\n\n${marker}` : renderWriterLeasePullRequestBody(lease);
}

export function projectWriterLeasePullRequestMarker(lease) {
  return {
    schema: lease.schema,
    status: lease.status,
    epoch: lease.epoch,
    sessionId: lease.sessionId,
    device: lease.device,
    scope: lease.scope,
    branch: lease.branch,
    baseSha: lease.baseSha,
    fenceSha: lease.fenceSha,
    autoDelivery: lease.autoDelivery === true,
    runtimeRequired: lease.runtimeRequired === true,
    heartbeatAt: lease.heartbeatAt,
    expiresAt: lease.expiresAt,
    ...(lease.reviewHeadSha ? { reviewHeadSha: lease.reviewHeadSha } : {}),
    ...(lease.deliveryHeadSha ? { deliveryHeadSha: lease.deliveryHeadSha } : {}),
    ...(lease.ownedDirtRecovery ? {
      ownedDirtRecovery: normalizeOwnedDirtRecovery(lease.ownedDirtRecovery),
    } : {}),
    ...(lease.activeOwnedDirtRecovery ? {
      activeOwnedDirtRecovery:
        normalizeActiveOwnedDirtLeaseRecovery(lease.activeOwnedDirtRecovery),
    } : {}),
    ...(lease.expiredCommittedHeartbeatRecovery ? {
      expiredCommittedHeartbeatRecovery:
        normalizeExpiredCommittedHeartbeatRecovery(
          lease.expiredCommittedHeartbeatRecovery,
        ),
    } : {}),
    ...(lease.pullRequestProjectionRepair ? {
      pullRequestProjectionRepair: lease.pullRequestProjectionRepair,
    } : {}),
    ...(lease.preClaimIntegrationContinuation ? {
      integration: lease.integration,
      preClaimIntegrationContinuation:
        normalizePreClaimIntegrationContinuation(
          lease.preClaimIntegrationContinuation,
        ),
    } : {}),
    ...(lease.admission ? {
      admission: lease.admission,
      cloudAuthority: lease.cloudAuthority,
    } : {}),
    ...(lease.taskAuthority ? {
      taskAuthority: normalizeTaskAuthorityBinding(lease.taskAuthority),
    } : {}),
    ...(lease.parkHeadSha ? {
      parkHeadSha: lease.parkHeadSha,
      parkBranchHeadSha: lease.parkBranchHeadSha,
      parkSourceEpoch: lease.parkSourceEpoch,
      parkSourceFenceSha: lease.parkSourceFenceSha,
      parkStashRef: lease.parkStashRef ?? null,
      parkStashSha: lease.parkStashSha ?? null,
      parkStashMessage: lease.parkStashMessage ?? null,
      parkStashStatus: lease.parkStashStatus ?? null,
    } : {}),
    ...(lease.completion || {}),
  };
}

function renderWriterLeaseMarker(lease) {
  const payload = JSON.stringify(projectWriterLeasePullRequestMarker(lease));
  return `<!-- ${WRITER_LEASE_SCHEMA} ${payload} -->`;
}

function requireSha(value, label) {
  if (!SHA_PATTERN.test(String(value || ""))) {
    throw new Error(`${label} must be an exact lowercase 40-character Git commit SHA.`);
  }
}

export function parseWriterLeasePullRequestBody(body) {
  const escapedSchema = escapeRegExp(WRITER_LEASE_SCHEMA);
  const match = String(body || "").match(new RegExp(`<!--\\s*${escapedSchema}\\s+(\\{.*\\})\\s*-->`));
  if (!match) return null;
  const value = JSON.parse(match[1]);
  if (
    value.schema !== WRITER_LEASE_SCHEMA ||
    !Number.isInteger(value.epoch) ||
    value.epoch < 1 ||
    !parseDeviceBranch(value.branch) ||
    !/^[0-9a-f]{40}$/.test(String(value.baseSha || "")) ||
    !/^[0-9a-f]{40}$/.test(String(value.fenceSha || "")) ||
    !Number.isFinite(Date.parse(value.expiresAt))
  ) return null;
  if (value.autoDelivery !== undefined && typeof value.autoDelivery !== "boolean") return null;
  if (value.runtimeRequired !== undefined && typeof value.runtimeRequired !== "boolean") return null;
  if ((value.admission || value.cloudAuthority) && !normalizeScopedAdmission({
    admission: value.admission,
    cloudAuthority: value.cloudAuthority,
    scope: value.scope,
    baseSha: value.baseSha,
    strict: false,
  })) return null;
  let taskAuthority;
  try {
    taskAuthority = normalizeTaskAuthorityBinding(value.taskAuthority);
  } catch {
    return null;
  }
  if (value.pullRequestProjectionRepair !== undefined && (
    value.pullRequestProjectionRepair?.schema !== "agentic-pull-request-projection-repair/v1" ||
    !["repairing", "completed"].includes(value.pullRequestProjectionRepair?.status)
  )) return null;
  let ownedDirtRecovery;
  let activeOwnedDirtRecovery;
  let expiredCommittedHeartbeatRecovery;
  try {
    ownedDirtRecovery = normalizeOwnedDirtRecovery(value.ownedDirtRecovery);
    activeOwnedDirtRecovery =
      normalizeActiveOwnedDirtLeaseRecovery(value.activeOwnedDirtRecovery);
    expiredCommittedHeartbeatRecovery =
      normalizeExpiredCommittedHeartbeatRecovery(
        value.expiredCommittedHeartbeatRecovery,
      );
  } catch {
    return null;
  }
  return {
    ...value,
    ...(taskAuthority ? { taskAuthority } : {}),
    ...(ownedDirtRecovery ? { ownedDirtRecovery } : {}),
    ...(activeOwnedDirtRecovery ? { activeOwnedDirtRecovery } : {}),
    ...(expiredCommittedHeartbeatRecovery
      ? { expiredCommittedHeartbeatRecovery }
      : {}),
  };
}

export function normalizeExpiredCommittedHeartbeatRecovery(value) {
  if (value === undefined || value === null) return null;
  const legacy = value?.schema ===
    LEGACY_EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_SCHEMA;
  const prePushedPrefix = value?.schema ===
    PRE_PUSHED_PREFIX_EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_SCHEMA;
  const current = value?.schema ===
    EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_SCHEMA;
  const bindsProtectedMain = prePushedPrefix || current;
  const expectedKeys = legacy
    ? LEGACY_EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_KEYS
    : prePushedPrefix
      ? PRE_PUSHED_PREFIX_EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_KEYS
      : current
        ? EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_KEYS
        : null;
  let protectedMainEquivalence = null;
  let sourceRemoteSharedAncestorEquivalence = null;
  if (bindsProtectedMain) {
    try {
      protectedMainEquivalence =
        normalizeProtectedMainPathEquivalenceEvidence(
          value.protectedMainEquivalence,
        );
    } catch {
      protectedMainEquivalence = null;
    }
  }
  if (current) {
    try {
      sourceRemoteSharedAncestorEquivalence =
        normalizeProtectedMainSharedAncestorPathEquivalenceEvidence(
          value.sourceRemoteSharedAncestorEquivalence,
        );
    } catch {
      sourceRemoteSharedAncestorEquivalence = null;
    }
  }
  const invalid = (
    !expectedKeys ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify(expectedKeys) ||
    value.status !== "recovered" ||
    !Number.isInteger(value.sourceEpoch) ||
    value.sourceEpoch < 1 ||
    !requiredRecoveryText(value.sourceSessionId) ||
    !requiredRecoveryText(value.sourceDevice) ||
    !requiredRecoveryText(value.sourceScope) ||
    !parseDeviceBranch(value.sourceBranch) ||
    !requiredRecoveryText(value.sourcePullRequestUrl) ||
    !SHA_PATTERN.test(String(value.sourceBaseSha || "")) ||
    !SHA_PATTERN.test(String(value.sourceFenceSha || "")) ||
    (current && !SHA_PATTERN.test(
      String(value.sourceRemoteHeadSha || ""),
    )) ||
    (current && (
      !SHA_PATTERN.test(String(value.sourceRemoteTreeSha || "")) ||
      !Number.isSafeInteger(value.sourceRemoteChangedPathCount) ||
      value.sourceRemoteChangedPathCount < 0 ||
      value.sourceRemoteChangedPathCount > RECOVERY_PATH_EVIDENCE_MAX_PATHS ||
      !DIGEST_PATTERN.test(
        String(value.sourceRemoteChangedPathsDigest || ""),
      ) ||
      !Number.isSafeInteger(value.sourceRemoteDeclaredChangedPathCount) ||
      value.sourceRemoteDeclaredChangedPathCount < 0 ||
      value.sourceRemoteDeclaredChangedPathCount >
        RECOVERY_PATH_EVIDENCE_MAX_PATHS ||
      !DIGEST_PATTERN.test(
        String(value.sourceRemoteDeclaredChangedPathsDigest || ""),
      ) ||
      !Number.isSafeInteger(
        value.sourceRemoteProtectedEquivalentPathCount,
      ) ||
      value.sourceRemoteProtectedEquivalentPathCount < 0 ||
      value.sourceRemoteProtectedEquivalentPathCount >
        RECOVERY_PATH_EVIDENCE_MAX_PATHS ||
      value.sourceRemoteDeclaredChangedPathCount +
        value.sourceRemoteProtectedEquivalentPathCount !==
        value.sourceRemoteChangedPathCount ||
      !DIGEST_PATTERN.test(String(
        value.sourceRemoteProtectedEquivalentPathsDigest || "",
      )) ||
      !DIGEST_PATTERN.test(String(
        value.sourceRemoteSharedAncestorEquivalenceDigest || "",
      )) ||
      !DIGEST_PATTERN.test(
        String(value.sourceRemoteRangeDiffDigest || ""),
      ) ||
      !sourceRemoteSharedAncestorEquivalence ||
      sourceRemoteSharedAncestorEquivalence.baseSha !==
        value.sourceBaseSha ||
      sourceRemoteSharedAncestorEquivalence.headSha !==
        value.sourceRemoteHeadSha ||
      sourceRemoteSharedAncestorEquivalence.headTreeSha !==
        value.sourceRemoteTreeSha ||
      sourceRemoteSharedAncestorEquivalence.exemptPathCount !==
        value.sourceRemoteProtectedEquivalentPathCount ||
      sourceRemoteSharedAncestorEquivalence.exemptPathsDigest !==
        value.sourceRemoteProtectedEquivalentPathsDigest ||
      sourceRemoteSharedAncestorEquivalence.protectedMainRef !==
        protectedMainEquivalence?.protectedMainRef ||
      sourceRemoteSharedAncestorEquivalence.protectedMainSha !==
        protectedMainEquivalence?.protectedMainSha ||
      sourceRemoteSharedAncestorEquivalence.protectedMainTreeSha !==
        protectedMainEquivalence?.protectedMainTreeSha ||
      (value.sourceRemoteProtectedEquivalentPathCount === 0 && (
        value.sourceRemoteProtectedEquivalentPathsDigest !==
          EMPTY_PATHS_DIGEST ||
        value.sourceRemoteChangedPathsDigest !==
          value.sourceRemoteDeclaredChangedPathsDigest
      )) ||
      (value.sourceRemoteDeclaredChangedPathCount === 0 && (
        value.sourceRemoteDeclaredChangedPathsDigest !==
          EMPTY_PATHS_DIGEST ||
        value.sourceRemoteChangedPathsDigest !==
          value.sourceRemoteProtectedEquivalentPathsDigest
      )) ||
      digestValue(sourceRemoteSharedAncestorEquivalence) !==
        value.sourceRemoteSharedAncestorEquivalenceDigest
    )) ||
    !SHA_PATTERN.test(String(value.headSha || "")) ||
    value.headSha === value.sourceFenceSha ||
    !SHA_PATTERN.test(String(value.treeSha || "")) ||
    !DIGEST_PATTERN.test(String(value.sourceClaimId || "")) ||
    !DIGEST_PATTERN.test(String(value.sourceClaimDigest || "")) ||
    !SHA_PATTERN.test(String(value.sourceLedgerRevision || "")) ||
    !DIGEST_PATTERN.test(String(value.sourceClaimLedgerRevision || "")) ||
    !Number.isInteger(value.sourceCloudTransitionCounter) ||
    value.sourceCloudTransitionCounter < 1 ||
    !DIGEST_PATTERN.test(String(value.renewedClaimDigest || "")) ||
    !SHA_PATTERN.test(String(value.renewedLedgerRevision || "")) ||
    !DIGEST_PATTERN.test(String(value.renewedClaimLedgerRevision || "")) ||
    !Number.isInteger(value.renewedCloudTransitionCounter) ||
    value.renewedCloudTransitionCounter <= value.sourceCloudTransitionCounter ||
    !DIGEST_PATTERN.test(String(value.sourceMarkerDigest || "")) ||
    !DIGEST_PATTERN.test(String(value.pullRequestBodyDigest || "")) ||
    !DIGEST_PATTERN.test(String(value.rangeDiffDigest || "")) ||
    !Number.isInteger(value.changedPathCount) ||
    value.changedPathCount < 1 ||
    !DIGEST_PATTERN.test(String(value.changedPathsDigest || "")) ||
    !Number.isFinite(Date.parse(value.recoveredAt)) ||
    (bindsProtectedMain && (
      !Number.isSafeInteger(value.changedPathCount) ||
      value.changedPathCount > RECOVERY_PATH_EVIDENCE_MAX_PATHS ||
      !Number.isSafeInteger(value.declaredChangedPathCount) ||
      value.declaredChangedPathCount < 0 ||
      value.declaredChangedPathCount > RECOVERY_PATH_EVIDENCE_MAX_PATHS ||
      !DIGEST_PATTERN.test(String(value.declaredChangedPathsDigest || "")) ||
      !Number.isSafeInteger(value.protectedEquivalentPathCount) ||
      value.protectedEquivalentPathCount < 0 ||
      value.protectedEquivalentPathCount > RECOVERY_PATH_EVIDENCE_MAX_PATHS ||
      value.declaredChangedPathCount + value.protectedEquivalentPathCount !==
        value.changedPathCount ||
      !DIGEST_PATTERN.test(
        String(value.protectedEquivalentPathsDigest || ""),
      ) ||
      !DIGEST_PATTERN.test(
        String(value.protectedMainEquivalenceDigest || ""),
      ) ||
      !protectedMainEquivalence ||
      protectedMainEquivalence.baseSha !== value.sourceBaseSha ||
      protectedMainEquivalence.headSha !== value.headSha ||
      protectedMainEquivalence.headTreeSha !== value.treeSha ||
      protectedMainEquivalence.exemptPathCount !==
        value.protectedEquivalentPathCount ||
      protectedMainEquivalence.exemptPathsDigest !==
        value.protectedEquivalentPathsDigest ||
      (value.protectedEquivalentPathCount === 0 && (
        value.protectedEquivalentPathsDigest !== EMPTY_PATHS_DIGEST ||
        value.changedPathsDigest !== value.declaredChangedPathsDigest
      )) ||
      (value.declaredChangedPathCount === 0 && (
        value.declaredChangedPathsDigest !== EMPTY_PATHS_DIGEST ||
        value.changedPathsDigest !== value.protectedEquivalentPathsDigest
      )) ||
      digestValue(protectedMainEquivalence) !==
        value.protectedMainEquivalenceDigest
    ))
  );
  if (invalid) {
    throw new Error("Expired committed heartbeat recovery evidence is malformed.");
  }
  return Object.freeze({
    schema: value.schema,
    status: value.status,
    sourceEpoch: value.sourceEpoch,
    sourceSessionId: value.sourceSessionId,
    sourceDevice: value.sourceDevice,
    sourceScope: value.sourceScope,
    sourceBranch: value.sourceBranch,
    sourceBaseSha: value.sourceBaseSha,
    sourceFenceSha: value.sourceFenceSha,
    ...(current ? {
      sourceRemoteHeadSha: value.sourceRemoteHeadSha,
      sourceRemoteTreeSha: value.sourceRemoteTreeSha,
      sourceRemoteChangedPathCount: value.sourceRemoteChangedPathCount,
      sourceRemoteChangedPathsDigest:
        value.sourceRemoteChangedPathsDigest,
      sourceRemoteDeclaredChangedPathCount:
        value.sourceRemoteDeclaredChangedPathCount,
      sourceRemoteDeclaredChangedPathsDigest:
        value.sourceRemoteDeclaredChangedPathsDigest,
      sourceRemoteProtectedEquivalentPathCount:
        value.sourceRemoteProtectedEquivalentPathCount,
      sourceRemoteProtectedEquivalentPathsDigest:
        value.sourceRemoteProtectedEquivalentPathsDigest,
      sourceRemoteSharedAncestorEquivalence,
      sourceRemoteSharedAncestorEquivalenceDigest:
        value.sourceRemoteSharedAncestorEquivalenceDigest,
      sourceRemoteRangeDiffDigest: value.sourceRemoteRangeDiffDigest,
    } : {}),
    sourcePullRequestUrl: value.sourcePullRequestUrl,
    sourceClaimId: value.sourceClaimId,
    sourceClaimDigest: value.sourceClaimDigest,
    sourceLedgerRevision: value.sourceLedgerRevision,
    sourceClaimLedgerRevision: value.sourceClaimLedgerRevision,
    sourceCloudTransitionCounter: value.sourceCloudTransitionCounter,
    renewedClaimDigest: value.renewedClaimDigest,
    renewedLedgerRevision: value.renewedLedgerRevision,
    renewedClaimLedgerRevision: value.renewedClaimLedgerRevision,
    renewedCloudTransitionCounter: value.renewedCloudTransitionCounter,
    headSha: value.headSha,
    treeSha: value.treeSha,
    changedPathCount: value.changedPathCount,
    changedPathsDigest: value.changedPathsDigest,
    ...(bindsProtectedMain ? {
      declaredChangedPathCount: value.declaredChangedPathCount,
      declaredChangedPathsDigest: value.declaredChangedPathsDigest,
      protectedEquivalentPathCount: value.protectedEquivalentPathCount,
      protectedEquivalentPathsDigest: value.protectedEquivalentPathsDigest,
      protectedMainEquivalence,
      protectedMainEquivalenceDigest:
        value.protectedMainEquivalenceDigest,
    } : {}),
    sourceMarkerDigest: value.sourceMarkerDigest,
    pullRequestBodyDigest: value.pullRequestBodyDigest,
    rangeDiffDigest: value.rangeDiffDigest,
    recoveredAt: new Date(value.recoveredAt).toISOString(),
  });
}

function requireSameRecoveryCloudSubject({ source, renewed, lease, instant }) {
  const immutableFields = [
    "schema",
    "provider",
    "ledgerRepository",
    "targetRepository",
    "claimId",
    "canonicalBaseSha",
    "laneRevision",
    "writeSetDigest",
    "deviceId",
    "sessionId",
    "reviewRequestId",
    "leaseEpoch",
    "state",
    "manifestDigest",
  ];
  if (
    !source ||
    !renewed ||
    immutableFields.some(field => source[field] !== renewed[field]) ||
    JSON.stringify(source.cloudDeclaredWriteScope) !==
      JSON.stringify(renewed.cloudDeclaredWriteScope) ||
    renewed.state !== "active" ||
    renewed.canonicalBaseSha !== lease.baseSha ||
    renewed.laneRevision !== lease.fenceSha ||
    renewed.deviceId !== lease.device ||
    renewed.sessionId !== lease.sessionId ||
    renewed.transitionCounter <= source.transitionCounter ||
    Date.parse(renewed.expiresAt) <= instant.getTime()
  ) {
    throw new Error("Cloud heartbeat changed the expired lease claim subject.");
  }
}

function requireRecoveryEvidenceMatchesLease({ recovery, lease }) {
  const cloud = lease.cloudAuthority;
  if (
    recovery.sourceEpoch !== lease.epoch ||
    recovery.sourceSessionId !== lease.sessionId ||
    recovery.sourceDevice !== lease.device ||
    recovery.sourceScope !== lease.scope ||
    recovery.sourceBranch !== lease.branch ||
    recovery.sourceBaseSha !== lease.baseSha ||
    recovery.sourceFenceSha !== lease.fenceSha ||
    recovery.sourcePullRequestUrl !== lease.pullRequestUrl ||
    recovery.sourceClaimId !== cloud?.claimId ||
    recovery.sourceClaimDigest !== cloud?.claimDigest ||
    recovery.sourceLedgerRevision !== cloud?.ledgerRevision ||
    recovery.sourceClaimLedgerRevision !== cloud?.claimLedgerRevision ||
    recovery.sourceCloudTransitionCounter !== cloud?.transitionCounter
  ) {
    throw new Error("Expired committed recovery evidence changed from its source lease.");
  }
}

function requiredRecoveryText(value) {
  return typeof value === "string" && value.trim() === value && value.length > 0;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function acquireLock(lockPath) {
  const token = `${process.pid}:${Date.now()}:${process.hrtime.bigint()}`;
  try {
    return createLock(lockPath, token);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    throw new Error(
      "Another writer-lease operation is in progress; an abandoned lock requires explicit owner-led recovery.",
    );
  }
}
function createLock(lockPath, token) {
  const descriptor = openSync(lockPath, "wx", 0o600);
  writeFileSync(descriptor, JSON.stringify({ pid: process.pid, token }));
  return { descriptor, token };
}
function readLockOwner(lockPath) {
  try {
    const value = JSON.parse(readFileSync(lockPath, "utf8"));
    return Number.isSafeInteger(value.pid) && typeof value.token === "string"
      ? value : null;
  } catch {
    return null;
  }
}
function releaseLock(lockPath, token) {
  const owner = existsSync(lockPath) ? readLockOwner(lockPath) : null;
  if (owner?.token === token) unlinkSync(lockPath);
}
function isActive(lease, instant) {
  return lease?.status === "active" && Date.parse(lease.expiresAt) > instant.getTime();
}

function normalizeTtl(ttlMs) {
  const value = Number(ttlMs);
  if (!Number.isFinite(value) || value < 60_000 || value > 24 * 60 * 60 * 1000) {
    throw new Error("Writer lease TTL must be between 60 seconds and 24 hours.");
  }
  return Math.floor(value);
}

function boundedExpiry({ instant, ttlMs, expiresAtCap }) {
  const requested = instant.getTime() + normalizeTtl(ttlMs);
  if (expiresAtCap === null) return new Date(requested).toISOString();
  const cap = Date.parse(expiresAtCap);
  if (!Number.isFinite(cap) || cap - instant.getTime() < 60_000) {
    throw new Error("Writer lease cloud expiry cap must remain at least 60 seconds in the future.");
  }
  return new Date(Math.min(requested, cap)).toISOString();
}

function requireIdentity(values) {
  for (const [key, value] of Object.entries(values)) {
    if (!String(value || "").trim()) throw new Error(`Writer lease requires ${key}.`);
  }
  const identity = parseDeviceBranch(values.branch);
  if (!identity) throw new Error(`Writer lease branch does not satisfy the device branch contract: ${values.branch}`);
  if (identity.device !== values.device || identity.scope !== values.scope) {
    throw new Error("Writer lease device and scope must match its branch identity.");
  }
}

function normalizeScopedAdmission({ admission, cloudAuthority, scope, baseSha, strict = true }) {
  if (!admission && !cloudAuthority) return null;
  const invalid = (
    admission?.schema !== "agentic-lane-admission-lease/v1"
    || !["planned", "admitted"].includes(admission.status)
    || cloudAuthority?.schema !== "agentic-lane-cloud-authority/v1"
    || admission.semanticScope !== scope
    || cloudAuthority.canonicalBaseSha !== baseSha
    || cloudAuthority.writeSetDigest !== admission.writeSetDigest
    || !Array.isArray(admission.declaredWriteSet)
    || admission.declaredWriteSet.length < 2
    || !admission.declaredWriteSet.includes(`semantic:${scope}`)
    || JSON.stringify(cloudAuthority.cloudDeclaredWriteScope)
      !== JSON.stringify(admission.declaredWriteSet)
    || !/^[0-9a-f]{64}$/.test(String(admission.writeSetDigest || ""))
    || !/^[0-9a-f]{64}$/.test(String(admission.manifestDigest || ""))
    || !/^[0-9a-f]{64}$/.test(String(admission.planReceiptDigest || ""))
    || !/^[0-9a-f]{64}$/.test(String(admission.admissionReceiptDigest || ""))
    || !/^[0-9a-f]{64}$/.test(String(admission.existingLaneStateDigest || ""))
    || (
      admission.status === "admitted"
      && (
        !/^[0-9a-f]{64}$/.test(String(admission.admittedReportDigest || ""))
        || !/^[0-9a-f]{64}$/.test(String(admission.preservationReceiptDigest || ""))
      )
    )
    || !/^[0-9a-f]{64}$/.test(String(cloudAuthority.claimId || ""))
    || !/^[0-9a-f]{64}$/.test(String(cloudAuthority.claimDigest || ""))
    || !/^[0-9a-f]{40}$/.test(String(cloudAuthority.ledgerRevision || ""))
    || !/^[0-9a-f]{64}$/.test(String(cloudAuthority.claimLedgerRevision || ""))
    || !Number.isInteger(cloudAuthority.leaseEpoch)
    || cloudAuthority.leaseEpoch < 1
  ); if (invalid) {
    if (!strict) return null;
    throw new Error("Scoped lane admission and cloud authority are missing, inconsistent, or invalid.");
  }
  return { admission, cloudAuthority };
}
