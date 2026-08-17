// Responsibility: Join read-only repository/cloud witnesses to one local writer-registry CAS.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";

import { captureActiveOwnedDirtEvidence, requireSameActiveOwnedDirtEvidence }
  from "./active-owned-dirt-recovery-evidence.mjs";
import { canonicalJson, digestValue, writeSetsOverlap }
  from "./cloud-collaboration-primitives.mjs";
import {
  buildCurrentCloudExpiredLocalOwnedDirtContinuationEvidence,
} from "./current-cloud-expired-local-owned-dirt-continuation-evidence.mjs";
import {
  currentCloudExpiredLocalOwnedDirtContinuationOperationKey,
  advanceCurrentCloudExpiredLocalOwnedDirtContinuationIntent,
  createCurrentCloudExpiredLocalOwnedDirtContinuationIntent,
  normalizeCurrentCloudExpiredLocalOwnedDirtContinuationIntent,
  normalizeCurrentCloudExpiredLocalOwnedDirtContinuationPlan,
} from "./current-cloud-expired-local-owned-dirt-continuation-contract.mjs";
import { assertRegisteredWorktree } from "./repository-guards.mjs";
import { verifyAdmissionCloudAuthority } from "./scoped-lane-cloud-authority.mjs";
import { authorizeTaskBoundLeaseMutation }
  from "./task-bound-lane-authority-store.mjs";
import { createWriterLeaseStore } from "./writer-lease-lib.mjs";
import { mutateWriterLeaseRegistry, writerLeaseDigest }
  from "./writer-lease-registry-cas.mjs";

const RECEIPTS_FIELD = "currentCloudExpiredLocalOwnedDirtContinuationReceipts";

export function createRepositoryCurrentCloudExpiredLocalOwnedDirtContinuationAdapter(
  options = {}, dependencies = {},
) {
  const resolveRealpath = dependencies.realpath || realpathSync;
  const repository = resolveRealpath(path.resolve(required(options.repository, "repository")));
  const sessionId = required(options.sessionId, "session ID");
  const taskAuthorityFile = options.taskAuthorityFile
    ? resolveRealpath(path.resolve(options.taskAuthorityFile)) : null;
  const execute = dependencies.execute || ((command, argumentsList, options = {}) => execFileSync(
    command, argumentsList, { cwd: repository,
      encoding: options.input === undefined ? "utf8" : undefined,
      maxBuffer: 64 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"], ...options },
  ));
  const rawGit = dependencies.git
    || ((argumentsList, options = {}) => execute("git", argumentsList, options));
  const git = argumentsList => String(rawGit(argumentsList)).trim();
  const dirtGit = (argumentsList, options = {}) => rawGit(argumentsList, options);
  dirtGit.optional = (argumentsList, options = {}) => {
    try { return dirtGit(argumentsList, options); } catch (error) {
      if (error?.status === 1) return "";
      throw error;
    }
  };
  const now = dependencies.now || (() => new Date());
  const verifyCloud = dependencies.verifyCloud || verifyAdmissionCloudAuthority;
  const authorizeTaskMutation = dependencies.authorizeTaskMutation
    || authorizeTaskBoundLeaseMutation;
  const branch = required(git(["branch", "--show-current"]), "attached branch");
  const commonDirectory = resolveRealpath(path.resolve(
    repository, git(["rev-parse", "--git-common-dir"]),
  ));
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({
    gitCommonDir: commonDirectory, taskAuthorityPolicy: "projected",
  });
  let volatileIntent = null;
  let authorityValues = null;
  let attemptedValues = null;

  function sourceLease() {
    const lease = leaseStore.read(branch);
    if (!lease || lease.schema !== "agentic-writer-lease/v2" || lease.status !== "active"
      || lease.branch !== branch || lease.sessionId !== sessionId
      || path.resolve(lease.worktreePath || "") !== repository
      || lease.admission?.status !== "admitted" || !lease.cloudAuthority || !lease.taskAuthority) {
      invalid("exact admitted task-bound source lease");
    }
    return lease;
  }

  function repositoryWitness(lease) {
    const registered = assertRegisteredWorktree({ cwd: repository,
      porcelain: git(["worktree", "list", "--porcelain", "-z"]), resolvePath: resolveRealpath });
    const headSha = sha(git(["rev-parse", "HEAD"]), "HEAD");
    if (registered.branch !== `refs/heads/${branch}` || registered.head !== headSha
      || headSha !== lease.fenceSha) invalid("registered worktree fence");
    return captureActiveOwnedDirtEvidence({ repository, git: dirtGit });
  }

  function cloudWitness(lease) {
    const manifest = { manifestDigest: lease.admission.manifestDigest,
      declaredWriteSet: lease.admission.declaredWriteSet,
      writeSetDigest: lease.admission.writeSetDigest };
    const result = verifyCloud({ authority: lease.cloudAuthority, manifest,
      canonicalBaseSha: lease.baseSha });
    const verification = result?.verification;
    const claims = verification?.inventory?.claims;
    if (verification?.status !== "ready" || !Array.isArray(claims)) invalid("cloud verification");
    const matches = claims.filter(claim => claim.claimId === lease.cloudAuthority.claimId);
    if (matches.length !== 1) invalid("current cloud claim cardinality");
    const claim = matches[0];
    const overlappingClaimIds = claims.filter(candidate => candidate.claimId !== claim.claimId
      && (candidate.writeAuthority === true || candidate.scopeReserved === true)
      && writeSetsOverlap(candidate.declaredWriteScope, claim.declaredWriteScope))
      .map(candidate => candidate.claimId).sort();
    return Object.freeze({ claim, verification, overlappingClaimIds });
  }

  function capture() {
    const lease = sourceLease();
    const cloud = cloudWitness(lease);
    const observedAt = cloud.verification.verifiedAt || now().toISOString();
    return buildCurrentCloudExpiredLocalOwnedDirtContinuationEvidence({
      repository: lease.cloudAuthority.targetRepository || "repository",
      observedAt,
      lease,
      cloudClaim: cloud.claim,
      cloudObservation: {
        status: "ready", evaluatedAt: observedAt,
        ledgerRevision: cloud.verification.ledgerRevision,
        ledgerDigest: cloud.verification.ledgerDigest,
        inventoryDigest: cloud.verification.remoteClaimInventoryDigest,
        verificationReceiptDigest: cloud.verification.receiptDigest,
        overlappingClaimIds: cloud.overlappingClaimIds,
      },
      ownedDirt: repositoryWitness(lease),
      taskCapabilityDigest: lease.taskAuthority.bindingDigest,
    });
  }

  return Object.freeze({
    readPlanEvidence: capture,
    async withOperationLock(callback) {
      if (typeof callback !== "function") invalid("operation callback");
      return callback();
    },
    readIntent(plan) {
      const sealed = requirePlan(plan);
      if (volatileIntent) return volatileIntent;
      const registry = leaseStore.readRegistry();
      const target = targetProjection(sealed);
      const receipt = registry[RECEIPTS_FIELD]?.[target.operationKey];
      if (!receipt || writerLeaseDigest(registry.leases?.[branch]) !== target.leaseDigest) return null;
      volatileIntent = hydrateRegistryReceipt(sealed, receipt);
      return volatileIntent;
    },
    writeIntent({ expected, value, plan }) {
      requirePlan(plan);
      if (digestValue(volatileIntent) !== digestValue(expected)) invalid("volatile intent CAS");
      volatileIntent = normalizeCurrentCloudExpiredLocalOwnedDirtContinuationIntent(value);
    },
    authorizeTask(plan) {
      const sealed = requirePlan(plan);
      assertStable(sealed, { allowTarget: false });
      if (!taskAuthorityFile) throw new Error("Local continuation run requires --task-authority.");
      const receipt = authorizeTaskMutation({ lease: sealed.evidence.lease,
        capabilityPath: taskAuthorityFile,
        operation: sealed.taskAuthorityOperation,
        now: now() });
      authorityValues = Object.freeze({ taskAuthorityReceiptDigest: receipt.receiptDigest,
        taskAuthorityBindingDigest: sealed.evidence.lease.taskAuthority.bindingDigest });
      return authorityValues;
    },
    revalidateCloud(plan, stage) {
      const sealed = requirePlan(plan);
      if (!new Set(["before-authority", "before-local", "after-local-error"]).has(stage)) {
        invalid("revalidation stage");
      }
      const state = assertStable(sealed, { allowTarget: stage === "after-local-error" });
      if (stage === "after-local-error") {
        if (state.disposition !== "target") invalid("lost local response target");
        return Object.freeze({ localProjected: true,
          values: projectedValues(sealed, state, "adopted-response-loss") });
      }
      if (state.disposition !== "source") invalid("source lease before local attempt");
      attemptedValues = Object.freeze({
        idempotencyKey: digestValue({ planDigest: sealed.planDigest, phase: "local-attempted" }),
        sourceLeaseDigest: sealed.evidence.leaseDigest,
        targetLeaseDigest: targetProjection(sealed).leaseDigest,
      });
      return attemptedValues;
    },
    projectLocal(plan) {
      const sealed = requirePlan(plan);
      const before = assertStable(sealed, { allowTarget: true });
      if (before.disposition === "target") {
        return projectedValues(sealed, before, "adopted-response-loss");
      }
      const projection = targetProjection(sealed);
      if (!authorityValues || !attemptedValues) invalid("durable phase receipt inputs");
      try {
        const result = mutateWriterLeaseRegistry({ leaseStore, branch,
          expectedLeaseDigest: sealed.evidence.leaseDigest,
          expectedClaimId: sealed.evidence.cloudClaim.claimId,
          action: ({ registry }) => {
            const registryRevision = registry.revision + 1;
            const receipt = projectionReceipt(sealed, projection.lease, registryRevision,
              { authorityVerified: authorityValues, localAttempted: attemptedValues });
            return { registry: { ...registry,
              leases: { ...registry.leases, [branch]: projection.lease },
              [RECEIPTS_FIELD]: { ...(registry[RECEIPTS_FIELD] || {}),
                [projection.operationKey]: receipt } },
            lease: projection.lease, changed: true };
          } });
        const state = assertStable(sealed, { allowTarget: true });
        if (state.disposition !== "target" || result.registryRevision !== state.registryRevision) {
          invalid("post-CAS target");
        }
        return projectedValues(sealed, state, "projected");
      } catch (error) {
        const state = assertStable(sealed, { allowTarget: true });
        if (state.disposition === "target") {
          return projectedValues(sealed, state, "adopted-response-loss");
        }
        throw error;
      }
    },
    verifyTerminal(plan) {
      const sealed = requirePlan(plan);
      const state = assertStable(sealed, { allowTarget: true });
      if (state.disposition !== "target") invalid("terminal target projection");
      const authority = mutationAuthorityReceipt(sealed, state.lease, state.cloud.verification);
      return Object.freeze({ mutationAuthorityReceiptDigest: authority.receiptDigest,
        targetLeaseDigest: writerLeaseDigest(state.lease),
        verificationDigest: digestValue({ planDigest: sealed.planDigest,
          targetLeaseDigest: writerLeaseDigest(state.lease), receiptDigest: state.receipt.receiptDigest,
          registryRevision: state.registryRevision }) });
    },
  });

  function assertStable(plan, { allowTarget }) {
    const registry = leaseStore.readRegistry();
    const lease = registry.leases?.[branch];
    const sourceDigest = plan.evidence.leaseDigest;
    const target = targetProjection(plan);
    const leaseDigest = writerLeaseDigest(lease);
    const disposition = leaseDigest === sourceDigest ? "source"
      : leaseDigest === target.leaseDigest ? "target" : invalid("source-or-target lease");
    if (disposition === "target" && !allowTarget) invalid("premature target lease");
    const receipt = registry[RECEIPTS_FIELD]?.[target.operationKey] || null;
    if ((disposition === "target") !== Boolean(receipt)
      || (receipt && canonicalJson(receipt)
        !== canonicalJson(projectionReceipt(plan, target.lease, registry.revision,
          receipt?.phaseValues)))) {
      invalid("append-only continuation receipt");
    }
    if (receipt) hydrateRegistryReceipt(plan, receipt);
    const cloud = cloudWitness(plan.evidence.lease);
    if (canonicalJson(cloud.claim) !== canonicalJson(plan.evidence.cloudClaim)
      || cloud.overlappingClaimIds.length) invalid("sealed current cloud claim");
    const ownedDirt = repositoryWitness(plan.evidence.lease);
    requireSameActiveOwnedDirtEvidence(plan.evidence.ownedDirt, ownedDirt);
    return Object.freeze({ disposition, registryRevision: registry.revision, lease,
      receipt, cloud, ownedDirt });
  }

}

function targetProjection(plan) {
  const heartbeatAt = plan.evidence.cloudClaim.heartbeatAt || plan.evidence.observedAt;
  const lease = Object.freeze({ ...plan.evidence.lease, heartbeatAt,
    expiresAt: plan.evidence.cloudClaim.expiresAt });
  return Object.freeze({ lease, leaseDigest: writerLeaseDigest(lease),
    operationKey: currentCloudExpiredLocalOwnedDirtContinuationOperationKey(plan, "local-attempted") });
}
function projectionReceipt(plan, lease, registryRevision, phaseValues) {
  const target = targetProjection(plan);
  const core = { schema: "agentic-current-cloud-expired-local-owned-dirt-continuation-registry-receipt/v1",
    operationKey: target.operationKey, planDigest: plan.planDigest,
    sourceLeaseDigest: plan.evidence.leaseDigest, targetLeaseDigest: writerLeaseDigest(lease),
    claimId: plan.evidence.cloudClaim.claimId, registryRevision, phaseValues,
    writerRegistryMutation: true };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}
function hydrateRegistryReceipt(plan, receipt) {
  let intent = createCurrentCloudExpiredLocalOwnedDirtContinuationIntent(plan);
  intent = advanceCurrentCloudExpiredLocalOwnedDirtContinuationIntent(intent,
    { status: "authority-verified", values: receipt?.phaseValues?.authorityVerified });
  return advanceCurrentCloudExpiredLocalOwnedDirtContinuationIntent(intent,
    { status: "local-attempted", values: receipt?.phaseValues?.localAttempted });
}
function projectedValues(plan, state, disposition) {
  return Object.freeze({ disposition, writerRegistryMutation: true,
    targetLeaseDigest: writerLeaseDigest(state.lease),
    mutationAuthorityReceipt: mutationAuthorityReceipt(plan, state.lease, state.cloud.verification) });
}
function mutationAuthorityReceipt(plan, lease, _verification) {
  const core = { schema: "agentic-admission-mutation-authority/v1", status: "ready",
    claimId: plan.evidence.cloudClaim.claimId,
    claimDigest: plan.evidence.cloudClaim.fenceRevision,
    ledgerRevision: plan.evidence.cloudObservation.ledgerRevision,
    localLeaseEpoch: lease.epoch, localFenceSha: lease.fenceSha,
    remoteLeaseEpoch: plan.evidence.cloudClaim.leaseEpoch,
    cloudVerificationReceiptDigest: plan.evidence.cloudObservation.verificationReceiptDigest,
    evaluatedAt: plan.evidence.observedAt,
    expiresAt: lease.expiresAt };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}
function requirePlan(value) {
  return normalizeCurrentCloudExpiredLocalOwnedDirtContinuationPlan(value);
}
function required(value, label) {
  if (typeof value !== "string" || !value.trim()) invalid(label);
  return value;
}
function sha(value, label) {
  if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) invalid(label);
  return value;
}
function invalid(label) {
  throw new Error(`Current-cloud expired-local continuation has invalid ${label}.`);
}
