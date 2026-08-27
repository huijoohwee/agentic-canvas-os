// Responsibility: Inspect and project one lost heartbeat without mutating source, refs, or cloud.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";

import { captureActiveOwnedDirtEvidence }
  from "./active-owned-dirt-recovery-evidence.mjs";
import { reconcileLostCloudHeartbeat }
  from "./active-owned-dirt-recovery-registry.mjs";
import { canonicalJson, digestValue }
  from "./cloud-collaboration-primitives.mjs";
import { assertRegisteredWorktree } from "./repository-guards.mjs";
import { assertAdmissionMutationAuthority }
  from "./scoped-lane-admission-state.mjs";
import { invokeRepositoryCloudAction, verifyAdmissionCloudAuthority }
  from "./scoped-lane-cloud-authority.mjs";
import { authorizeTaskBoundLeaseMutation }
  from "./task-bound-lane-authority-store.mjs";
import {
  createWriterLeaseStore,
  parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker,
  updateWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";
import {
  casWriterLeaseProjection,
  withHeartbeatProjectionFence,
  writerLeaseDigest,
} from "./writer-lease-registry-cas.mjs";
import {
  buildPlannedDirtyHeartbeatProjectionRecoveryEvidence,
  requireSameRecoveryOwnedDirt,
} from "./planned-dirty-heartbeat-projection-recovery-evidence.mjs";
import { normalizePlannedDirtyHeartbeatProjectionRecoveryPlan, OPERATION }
  from "./planned-dirty-heartbeat-projection-recovery-contract.mjs";

const BODY_LIMIT = 65_536;

export function createPlannedDirtyHeartbeatProjectionRecoveryRepositoryAdapter(
  options = {}, dependencies = {},
) {
  const repository = realpathSync(path.resolve(required(options.repository, "repository")));
  const sessionId = required(options.sessionId, "session");
  const environment = dependencies.environment || process.env;
  const execute = dependencies.execute || ((command, argumentsList, cwd = repository) =>
    execFileSync(command, argumentsList, { cwd, encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
      env: environment }));
  const git = dependencies.git || (argumentsList =>
    String(execute("git", argumentsList)).trim());
  const gh = dependencies.gh || (argumentsList =>
    String(execute("gh", argumentsList)).trim());
  const now = dependencies.now || (() => new Date());
  const inspectCloudStatus = dependencies.inspectCloudStatus || (input =>
    invokeRepositoryCloudAction({ ...input, environment }));
  const verifyCloud = dependencies.verifyCloud || (input =>
    verifyAdmissionCloudAuthority({ ...input, environment }));
  const assertMutation = dependencies.assertMutationAuthority
    || assertAdmissionMutationAuthority;
  const authorizeTask = dependencies.authorizeTaskMutation
    || authorizeTaskBoundLeaseMutation;
  const commonDirectory = realpathSync(path.resolve(repository,
    git(["rev-parse", "--git-common-dir"])));
  const branch = required(git(["branch", "--show-current"]), "attached task branch");
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({
    gitCommonDir: commonDirectory,
    taskAuthorityPolicy: "projected",
  });
  if (typeof leaseStore.withRegistryLock !== "function" || !leaseStore.statePath) {
    invalid("real writer-registry CAS capability");
  }

  function assertRegistered() {
    const record = assertRegisteredWorktree({ cwd: repository,
      porcelain: git(["worktree", "list", "--porcelain", "-z"]) });
    if (record.branch !== `refs/heads/${branch}`) invalid("registered attached branch");
  }

  function readRegistryLease() {
    const registry = leaseStore.readRegistry();
    const lease = registry?.leases?.[branch];
    if (!lease || lease.schema !== "agentic-writer-lease/v2"
      || lease.status !== "active" || lease.sessionId !== sessionId
      || lease.branch !== branch
      || path.resolve(lease.worktreePath || "") !== repository
      || lease.admission?.status !== "planned"
      || !lease.cloudAuthority || !lease.taskAuthority
      || (lease.integration !== null && lease.integration !== undefined)) {
      invalid("exact active task-bound planned lease");
    }
    return { registry, lease };
  }

  function repositoryFrame(lease) {
    assertRegistered();
    const headSha = git(["rev-parse", "HEAD"]);
    const localRefSha = git(["rev-parse", `refs/heads/${branch}`]);
    const remoteRefSha = remoteSha(git(["ls-remote", "--heads", "origin",
      `refs/heads/${branch}`]));
    if (![headSha, localRefSha, remoteRefSha].every(value => value === lease.fenceSha)) {
      invalid("unchanged HEAD, local ref, and remote ref fence");
    }
    return Object.freeze({ branch, headSha, localRefSha, remoteRefSha, registered: true });
  }

  function pullRequestFrame(lease) {
    const number = pullRequestNumber(lease.pullRequestUrl);
    const value = JSON.parse(gh(["pr", "view", String(number), "--json",
      "url,number,id,state,isDraft,headRefName,headRefOid,baseRefName,headRepository,body,autoMergeRequest"]));
    return Object.freeze({
      id: value.id,
      number: value.number,
      url: value.url,
      state: value.state,
      isDraft: value.isDraft,
      autoMergeRequest: value.autoMergeRequest,
      headRepository: value.headRepository?.nameWithOwner,
      headRefName: value.headRefName,
      headRefOid: value.headRefOid,
      baseRefName: value.baseRefName,
      body: value.body,
    });
  }

  function verifyOneAhead(lease, observedAt) {
    const result = reconcileLostCloudHeartbeat({
      current: lease,
      branch,
      inspectCloudStatus,
      verifyActiveCloudAuthority: input => verifyCloud(input),
      now: () => new Date(observedAt),
    });
    if (!result) invalid("exact lost heartbeat rather than exact-current no-op");
    const targetCloudAuthority = inventoryBackedAuthority(result);
    const preliminary = buildPreliminaryTargetLease({ lease, targetCloudAuthority, observedAt });
    const mutation = assertMutation({
      lease: preliminary,
      cloudAuthority: targetCloudAuthority,
      remoteAuthorityVerification: result.verification,
      allowPlanned: true,
    });
    return Object.freeze({ targetCloudAuthority,
      inventoryHeartbeatCounter: targetCloudAuthority.heartbeatCounter,
      verification: result.verification, mutation });
  }

  function verifyExactTarget(lease, plan) {
    let oneAhead = null;
    try {
      oneAhead = reconcileLostCloudHeartbeat({
        current: lease,
        branch,
        inspectCloudStatus,
        verifyActiveCloudAuthority: input => verifyCloud(input),
        now,
      });
    } catch (error) {
      throw error;
    }
    if (oneAhead) invalid("second cloud heartbeat after the sealed target");
    const verified = verifyCloud({
      authority: plan.evidence.targetCloudAuthority,
      manifest: lease.admission,
      canonicalBaseSha: lease.baseSha,
    });
    const target = inventoryBackedAuthority(verified);
    if (digestValue(target) !== plan.evidence.targetCloudAuthorityDigest) {
      invalid("sealed target cloud authority");
    }
    assertMutation({ lease, cloudAuthority: target,
      remoteAuthorityVerification: verified.verification, allowPlanned: true });
    return verified;
  }

  function captureSource(observedAt) {
    const { registry, lease } = readRegistryLease();
    if (lease.plannedDirtyHeartbeatProjectionRecovery !== undefined) {
      invalid("unrecovered source lease");
    }
    const repositoryEvidence = repositoryFrame(lease);
    const ownedDirt = captureActiveOwnedDirtEvidence({ repository });
    const pullRequest = pullRequestFrame(lease);
    const cloud = verifyOneAhead(lease, observedAt);
    return buildPlannedDirtyHeartbeatProjectionRecoveryEvidence({
      observedAt,
      repositoryPathDigest: digestValue(repository),
      sourceLease: lease,
      targetCloudAuthority: cloud.targetCloudAuthority,
      ownedDirt,
      registry: { schema: registry.schema, revision: Number(registry.revision || 0),
        registryDigest: digestValue(registry), leaseDigest: writerLeaseDigest(lease) },
      repository: repositoryEvidence,
      pullRequest,
      inventoryHeartbeatCounter: cloud.inventoryHeartbeatCounter,
      cloudVerificationReceiptDigest: cloud.verification.receiptDigest,
      mutationAuthorityReceiptDigest: cloud.mutation.receiptDigest,
    });
  }

  function inspectExecutionFrame(rawPlan) {
    const plan = normalizePlannedDirtyHeartbeatProjectionRecoveryPlan(rawPlan);
    const evidence = plan.evidence;
    const { registry, lease } = readRegistryLease();
    const leaseDigest = writerLeaseDigest(lease);
    const source = leaseDigest === evidence.sourceLeaseDigest;
    const target = leaseDigest === evidence.targetLeaseDigest;
    if (!source && !target) invalid("source-or-target branch lease");
    if (source && (registry.revision !== evidence.registry.revision
      || digestValue(registry) !== evidence.registry.registryDigest)) {
      invalid("sealed source writer registry");
    }
    repositoryFrame(lease);
    requireSameRecoveryOwnedDirt(evidence.ownedDirt,
      captureActiveOwnedDirtEvidence({ repository }));
    const pullRequest = pullRequestFrame(lease);
    const bodyDigest = digestValue(pullRequest.body);
    const sourceBody = bodyDigest === evidence.sourceBodyDigest;
    const targetBody = bodyDigest === evidence.targetBodyDigest;
    const marker = parseWriterLeasePullRequestBody(pullRequest.body);
    const markerDigest = digestValue(marker);
    const sourceMarker = markerDigest === evidence.sourceMarkerDigest;
    const targetMarker = markerDigest === evidence.targetMarkerDigest;
    if ((sourceBody !== sourceMarker) || (targetBody !== targetMarker)
      || (!sourceBody && !targetBody) || (source && targetBody)) {
      invalid("source-or-target deterministic pull-request body and marker");
    }
    assertPullRequestIdentity(pullRequest, evidence);
    if (source) {
      const cloud = verifyOneAhead(lease, evidence.observedAt);
      if (digestValue(cloud.targetCloudAuthority)
        !== evidence.targetCloudAuthorityDigest) invalid("sealed one-ahead cloud target");
    } else {
      verifyExactTarget(lease, plan);
    }
    return Object.freeze({ sourceLease: source, registryProjected: target,
      markerProjected: targetBody, lease, registry, pullRequest });
  }

  return Object.freeze({
    async inspectPlan() {
      const observedAt = now().toISOString();
      const first = captureSource(observedAt);
      const second = captureSource(observedAt);
      const volatile = value => {
        const copy = structuredClone(value);
        delete copy.cloudVerificationReceiptDigest;
        delete copy.mutationAuthorityReceiptDigest;
        delete copy.evidenceDigest;
        return copy;
      };
      if (canonicalJson(volatile(first)) !== canonicalJson(volatile(second))) {
        invalid("stable double-read planning evidence");
      }
      return second;
    },

    async inspectExecution({ plan }) {
      return inspectExecutionFrame(plan);
    },

    async authorizeTask({ plan, taskAuthorityFile }) {
      const sealed = normalizePlannedDirtyHeartbeatProjectionRecoveryPlan(plan);
      const current = inspectExecutionFrame(sealed);
      const capabilityPath = realpathSync(path.resolve(taskAuthorityFile));
      if (inside(repository, capabilityPath)) invalid("external task-authority capability");
      const receipt = authorizeTask({ lease: current.lease, capabilityPath,
        operation: `${OPERATION}:${sealed.planDigest}`, now: now() });
      if (receipt.bindingDigest !== current.lease.taskAuthority.bindingDigest) {
        invalid("task-authority binding");
      }
      return receipt;
    },

    async projectRegistry({ plan }) {
      const sealed = normalizePlannedDirtyHeartbeatProjectionRecoveryPlan(plan);
      let current = inspectExecutionFrame(sealed);
      if (current.registryProjected) return Object.freeze({ adopted: true,
        leaseDigest: writerLeaseDigest(current.lease) });
      if (Buffer.byteLength(sealed.evidence.targetBody) > BODY_LIMIT) {
        invalid("bounded full target marker body before registry CAS");
      }
      const source = sealed.evidence.sourceLease;
      const target = sealed.evidence.targetLease;
      const result = casWriterLeaseProjection({
        leaseStore,
        branch,
        expectedLeaseDigest: sealed.evidence.sourceLeaseDigest,
        expectedClaimId: source.cloudAuthority.claimId,
        requireNoActiveIntent: true,
        values: {
          cloudAuthority: target.cloudAuthority,
          heartbeatAt: target.heartbeatAt,
          expiresAt: target.expiresAt,
          plannedDirtyHeartbeatProjectionRecovery:
            target.plannedDirtyHeartbeatProjectionRecovery,
        },
      });
      if (writerLeaseDigest(result.lease) !== sealed.evidence.targetLeaseDigest) {
        invalid("exact target lease registry CAS");
      }
      current = inspectExecutionFrame(sealed);
      if (!current.registryProjected) invalid("projected target registry lease");
      return Object.freeze({ adopted: false,
        leaseDigest: writerLeaseDigest(current.lease) });
    },

    async projectMarker({ plan }) {
      const sealed = normalizePlannedDirtyHeartbeatProjectionRecoveryPlan(plan);
      let current = inspectExecutionFrame(sealed);
      if (!current.registryProjected) invalid("registry-before-marker order");
      if (current.markerProjected) return Object.freeze({ adopted: true,
        markerDigest: sealed.evidence.targetMarkerDigest });
      withHeartbeatProjectionFence({
        leaseStore,
        branch,
        expectedLeaseDigest: sealed.evidence.targetLeaseDigest,
        expectedClaimId: sealed.evidence.targetLease.cloudAuthority.claimId,
        action: () => execute("gh", ["pr", "edit", current.pullRequest.url,
          "--body", sealed.evidence.targetBody]),
      });
      current = inspectExecutionFrame(sealed);
      if (!current.markerProjected) invalid("deterministic target pull-request marker");
      return Object.freeze({ adopted: false,
        markerDigest: sealed.evidence.targetMarkerDigest });
    },

    async verifyTerminal({ plan }) {
      const sealed = normalizePlannedDirtyHeartbeatProjectionRecoveryPlan(plan);
      const current = inspectExecutionFrame(sealed);
      if (!current.registryProjected || !current.markerProjected) {
        invalid("complete registry and marker projection");
      }
      return Object.freeze({
        targetLeaseDigest: writerLeaseDigest(current.lease),
        targetCloudAuthorityDigest: digestValue(current.lease.cloudAuthority),
        recoveryReceiptDigest:
          current.lease.plannedDirtyHeartbeatProjectionRecovery.receiptDigest,
        dirtDigest: sealed.evidence.dirtDigest,
        targetMarkerDigest: digestValue(parseWriterLeasePullRequestBody(
          current.pullRequest.body)),
        targetBodyDigest: digestValue(current.pullRequest.body),
      });
    },
  });

  function buildPreliminaryTargetLease({ lease, targetCloudAuthority, observedAt }) {
    const ttl = Date.parse(lease.expiresAt) - Date.parse(lease.heartbeatAt);
    const expiresAt = new Date(Math.min(Date.parse(observedAt) + ttl,
      Date.parse(targetCloudAuthority.expiresAt))).toISOString();
    return { ...lease, cloudAuthority: targetCloudAuthority,
      heartbeatAt: observedAt, expiresAt };
  }
}

function inventoryBackedAuthority(result) {
  const claims = result?.verification?.inventory?.claims;
  const matches = Array.isArray(claims)
    ? claims.filter(claim => claim?.claimId === result.authority?.claimId) : [];
  if (matches.length !== 1 || !Number.isSafeInteger(matches[0].heartbeatCounter)
    || matches[0].heartbeatCounter < 0
    || matches[0].transitionCounter !== result.authority.transitionCounter
    || matches[0].fenceRevision !== result.authority.claimDigest
    || matches[0].transitionDigest !== result.authority.claimLedgerRevision
    || matches[0].operationReceiptDigest !== result.authority.operationReceiptDigest
    || matches[0].expiresAt !== result.authority.expiresAt) {
    invalid("explicit verified inventory heartbeat");
  }
  return Object.freeze({ ...result.authority,
    heartbeatCounter: matches[0].heartbeatCounter });
}

function assertPullRequestIdentity(pullRequest, evidence) {
  const source = evidence.pullRequest;
  if (pullRequest.id !== source.id || pullRequest.number !== source.number
    || pullRequest.url !== source.url || pullRequest.state !== "OPEN"
    || pullRequest.isDraft !== true || pullRequest.autoMergeRequest !== null
    || pullRequest.headRepository !== source.headRepository
    || pullRequest.headRefName !== source.headRefName
    || pullRequest.headRefOid !== source.headRefOid
    || pullRequest.baseRefName !== source.baseRefName) {
    invalid("unchanged pull-request identity and state");
  }
}

function pullRequestNumber(url) {
  const match = /\/pull\/(\d+)\/?$/u.exec(String(url || ""));
  const value = Number(match?.[1]);
  if (!Number.isSafeInteger(value) || value < 1) invalid("pull-request URL");
  return value;
}
function remoteSha(value) {
  const result = String(value || "").trim().split(/\s+/u)[0];
  if (!/^[0-9a-f]{40}$/u.test(result)) invalid("remote branch head");
  return result;
}
function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  const parentTraversal = relative === ".." || relative.startsWith(`..${path.sep}`);
  return relative === "" || (!parentTraversal && !path.isAbsolute(relative));
}
function required(value, label) {
  if (typeof value !== "string" || !value.trim()) invalid(label);
  return value;
}
function invalid(label) {
  throw new Error(`Planned-dirty heartbeat projection recovery has invalid ${label}.`);
}
