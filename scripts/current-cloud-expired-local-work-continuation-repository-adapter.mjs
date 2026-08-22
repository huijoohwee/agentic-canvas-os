// Responsibility: Join read-only repository/cloud witnesses to one local writer-registry CAS.
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { captureActiveOwnedDirtEvidence, requireSameActiveOwnedDirtEvidence }
  from "./active-owned-dirt-recovery-evidence.mjs";
import { canonicalJson, digestValue, writeSetsOverlap }
  from "./cloud-collaboration-primitives.mjs";
import {
  buildCurrentCloudExpiredLocalWorkContinuationEvidence,
} from "./current-cloud-expired-local-work-continuation-evidence.mjs";
import {
  currentCloudExpiredLocalWorkContinuationOperationKey,
  advanceCurrentCloudExpiredLocalWorkContinuationIntent,
  createCurrentCloudExpiredLocalWorkContinuationIntent,
  normalizeCurrentCloudExpiredLocalWorkContinuationIntent,
  normalizeCurrentCloudExpiredLocalWorkContinuationPlan,
} from "./current-cloud-expired-local-work-continuation-contract.mjs";
import { assertRegisteredWorktree } from "./repository-guards.mjs";
import { contractActor, contractRepository, prepareReadRequest }
  from "./github-cloud-collaboration-mapping.mjs";
import { verifyAdmissionCloudAuthority } from "./scoped-lane-cloud-authority.mjs";
import { authorizeTaskBoundLeaseMutation }
  from "./task-bound-lane-authority-store.mjs";
import { createWriterLeaseStore } from "./writer-lease-lib.mjs";
import { mutateWriterLeaseRegistry, writerLeaseDigest }
  from "./writer-lease-registry-cas.mjs";

const RECEIPTS_FIELD = "currentCloudExpiredLocalWorkContinuationReceipts";
const INSTALLED_ROOT = fileURLToPath(new URL("..", import.meta.url));
const RUNTIME_FILES = Object.freeze([
  "scripts/current-cloud-expired-local-work-continuation-contract.mjs",
  "scripts/current-cloud-expired-local-work-continuation-controller.mjs",
  "scripts/current-cloud-expired-local-work-continuation-evidence.mjs",
  "scripts/current-cloud-expired-local-work-continuation-repository-adapter.mjs",
  "scripts/current-cloud-expired-local-work-continuation.mjs",
]);

export function normalizeCurrentCloudContinuationClaim(claim) {
  return claim?.state === "active" ? Object.freeze({ ...claim, state: "current" }) : claim;
}

export function createRepositoryCurrentCloudExpiredLocalWorkContinuationAdapter(
  options = {}, dependencies = {},
) {
  const resolveRealpath = dependencies.realpath || realpathSync;
  const repository = resolveRealpath(path.resolve(required(options.repository, "repository")));
  const controllerRoot = resolveRealpath(path.resolve(options.controllerRoot || INSTALLED_ROOT));
  if (controllerRoot !== realpathSync(INSTALLED_ROOT)) invalid("installed controller root");
  const mode = required(options.mode, "continuation mode");
  if (!new Set(["admitted-committed-descendant-dirty", "planned-fence-dirty"]).has(mode)) {
    invalid("continuation mode");
  }
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
  const gh = dependencies.gh || (argumentsList => String(execute("gh", argumentsList)).trim());
  const readController = dependencies.readController || controllerWitness;
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
      || lease.admission?.status !== (mode === "planned-fence-dirty" ? "planned" : "admitted")
      || !lease.cloudAuthority || !lease.taskAuthority) {
      invalid("exact mode-specific task-bound source lease");
    }
    return lease;
  }

  function repositoryWitness(lease) {
    const registered = assertRegisteredWorktree({ cwd: repository,
      porcelain: git(["worktree", "list", "--porcelain", "-z"]), resolvePath: resolveRealpath });
    const headSha = sha(git(["rev-parse", "HEAD"]), "HEAD");
    if (registered.branch !== `refs/heads/${branch}` || registered.head !== headSha) {
      invalid("registered worktree identity");
    }
    const commits = committedDescendants(lease, headSha);
    if ((mode === "planned-fence-dirty" && (headSha !== lease.fenceSha || commits.length !== 0))
      || (mode === "admitted-committed-descendant-dirty" && commits.length === 0)) {
      invalid("mode-specific worktree revision");
    }
    const dirt = captureActiveOwnedDirtEvidence({ repository, git: dirtGit });
    const core = { ...dirt, commits };
    return Object.freeze({ ...core, ownedWorkDigest: digestValue(core) });
  }

  function committedDescendants(lease, headSha) {
    if (headSha === lease.fenceSha) return Object.freeze([]);
    git(["merge-base", "--is-ancestor", lease.fenceSha, headSha]);
    const revisions = git(["rev-list", "--reverse", "--first-parent",
      `${lease.fenceSha}..${headSha}`]).split("\n").filter(Boolean);
    return Object.freeze(revisions.map((revision, index) => {
      const parentSha = sha(git(["rev-parse", `${revision}^`]), "commit parent");
      const expectedParent = index === 0 ? lease.fenceSha : revisions[index - 1];
      if (parentSha !== expectedParent) invalid("linear committed descendant");
      const changedPaths = String(dirtGit(["diff-tree", "--no-commit-id", "--name-only",
        "-r", "-z", "--no-renames", parentSha, revision, "--"])).split("\0")
        .filter(Boolean).sort();
      if (changedPaths.length === 0) invalid("empty committed descendant");
      return Object.freeze({ sha: revision, parentSha, changedPaths });
    }));
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
    const claim = normalizeCurrentCloudContinuationClaim(matches[0]);
    const overlappingClaimIds = claims.filter(candidate => candidate.claimId !== claim.claimId
      && (candidate.writeAuthority === true || candidate.scopeReserved === true)
      && writeSetsOverlap(candidate.declaredWriteScope, claim.declaredWriteScope))
      .map(candidate => candidate.claimId).sort();
    return Object.freeze({ claim, verification, overlappingClaimIds });
  }

  function controllerWitness() {
    const run = argumentsList => String(execute("git", argumentsList,
      { cwd: controllerRoot })).trim();
    const headSha = sha(run(["rev-parse", "HEAD"]), "controller HEAD");
    const originMainSha = sha(run(["rev-parse", "origin/main"]), "controller origin/main");
    const treeSha = sha(run(["rev-parse", "HEAD^{tree}"]), "controller tree");
    const clean = String(execute("git", ["status", "--porcelain=v1", "--untracked-files=all"],
      { cwd: controllerRoot })) === "";
    const runtimeDigest = digestValue(RUNTIME_FILES.map(file => ({ file,
      digest: digestValue(readFileSync(path.join(controllerRoot, file))) })));
    return Object.freeze({ rootDigest: digestValue(controllerRoot), headSha, originMainSha,
      treeSha, runtimeDigest, clean, protected: headSha === originMainSha });
  }

  function providerWitness(lease, headSha) {
    const value = JSON.parse(gh(["pr", "view", lease.pullRequestUrl, "--json",
      "id,url,state,isDraft,autoMergeRequest,headRefName,headRefOid,baseRefName"]));
    if (value.headRefOid !== headSha) invalid("pull request head");
    return Object.freeze({ url: value.url, nodeId: value.id, state: value.state,
      isDraft: value.isDraft, headBranch: value.headRefName, headSha: value.headRefOid,
      baseBranch: value.baseRefName, autoMergeRequest: value.autoMergeRequest });
  }

  function claimOwnerWitness(lease) {
    const actor = JSON.parse(gh(["api", "user"]));
    const repositoryIdentity = JSON.parse(gh(["repo", "view",
      lease.cloudAuthority.targetRepository, "--json", "id,nameWithOwner"]));
    if (repositoryIdentity.nameWithOwner !== lease.cloudAuthority.targetRepository) {
      invalid("provider repository identity");
    }
    const owner = contractActor(actor, { sessionId: lease.sessionId, deviceId: lease.device });
    return Object.freeze({ ...owner,
      repositoryId: contractRepository({ nodeId: repositoryIdentity.id }).repositoryId,
      workItemId: prepareReadRequest({ input: { workItemId: lease.scope } }).workItemId });
  }

  function capture() {
    const lease = sourceLease();
    const cloud = cloudWitness(lease);
    const observedAt = cloud.verification.verifiedAt || now().toISOString();
    const ownedWork = repositoryWitness(lease);
    return buildCurrentCloudExpiredLocalWorkContinuationEvidence({
      repository: lease.cloudAuthority.targetRepository || "repository",
      mode,
      controller: readController(),
      remoteHeadSha: sha(git(["rev-parse", `refs/remotes/origin/${branch}`]), "remote head"),
      pullRequest: providerWitness(lease, lease.fenceSha),
      observedAt,
      lease,
      cloudClaim: cloud.claim,
      claimOwner: claimOwnerWitness(lease),
      cloudObservation: {
        status: "ready", evaluatedAt: observedAt,
        ledgerRevision: cloud.verification.ledgerRevision,
        ledgerDigest: cloud.verification.ledgerDigest,
        inventoryDigest: cloud.verification.remoteClaimInventoryDigest,
        verificationReceiptDigest: cloud.verification.receiptDigest,
        overlappingClaimIds: cloud.overlappingClaimIds,
      },
      ownedWork,
      taskCapabilityDigest: lease.taskAuthority.bindingDigest,
    });
  }

  return Object.freeze({
    readPlanEvidence() {
      const first = capture();
      const second = capture();
      if (first.evidenceDigest !== second.evidenceDigest) invalid("double-read evidence drift");
      return second;
    },
    async withOperationLock(callback) {
      if (typeof callback !== "function") invalid("operation callback");
      return callback();
    },
    readIntent(plan) {
      const sealed = requirePlan(plan);
      if (volatileIntent) return volatileIntent;
      const state = registryState(sealed, { allowTarget: true });
      if (state.disposition !== "target") return null;
      volatileIntent = hydrateRegistryReceipt(sealed, state.receipt);
      return volatileIntent;
    },
    writeIntent({ expected, value, plan }) {
      requirePlan(plan);
      if (digestValue(volatileIntent) !== digestValue(expected)) invalid("volatile intent CAS");
      volatileIntent = normalizeCurrentCloudExpiredLocalWorkContinuationIntent(value);
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
        taskAuthorityBindingDigest: sealed.evidence.lease.taskAuthority.bindingDigest,
        taskProofDigest: receipt.proofDigest });
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
        projectedLeaseDigest: sealed.projectedLeaseDigest,
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
            const receipt = projectionReceipt(sealed, registryRevision,
              { authorityVerified: authorityValues, localAttempted: attemptedValues });
            const lease = { ...projection.lease,
              [RECEIPTS_FIELD]: [...(projection.lease[RECEIPTS_FIELD] || []), receipt] };
            return { registry: { ...registry,
              leases: { ...registry.leases, [branch]: lease } },
            lease, changed: true };
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
        projectedLeaseDigest: sealed.projectedLeaseDigest,
        storedLeaseDigest: writerLeaseDigest(state.lease),
        verificationDigest: digestValue({ planDigest: sealed.planDigest,
          projectedLeaseDigest: sealed.projectedLeaseDigest,
          storedLeaseDigest: writerLeaseDigest(state.lease),
          receiptDigest: state.receipt.receiptDigest,
          registryRevision: state.registryRevision }) });
    },
  });

  function assertStable(plan, { allowTarget }) {
    if (canonicalJson(readController()) !== canonicalJson(plan.evidence.controller)) {
      invalid("installed protected controller drift");
    }
    const state = registryState(plan, { allowTarget });
    const { registry, lease, disposition, receipt } = state;
    if (disposition === "target" && !allowTarget) invalid("premature target lease");
    if (receipt) hydrateRegistryReceipt(plan, receipt);
    const cloud = cloudWitness(plan.evidence.lease);
    if (canonicalJson(cloud.claim) !== canonicalJson(plan.evidence.cloudClaim)
      || cloud.overlappingClaimIds.length) invalid("sealed current cloud claim");
    const ownedWork = repositoryWitness(plan.evidence.lease);
    requireSameActiveOwnedDirtEvidence(plan.evidence.ownedWork, ownedWork);
    if (ownedWork.ownedWorkDigest !== plan.evidence.ownedWork.ownedWorkDigest) {
      invalid("owned work descendant or dirt drift");
    }
    const remoteHeadSha = sha(git(["rev-parse", `refs/remotes/origin/${branch}`]), "remote head");
    const pullRequest = providerWitness(plan.evidence.lease, plan.evidence.lease.fenceSha);
    const claimOwner = claimOwnerWitness(plan.evidence.lease);
    if (remoteHeadSha !== plan.evidence.remoteHeadSha
      || canonicalJson(pullRequest) !== canonicalJson(plan.evidence.pullRequest)
      || canonicalJson(claimOwner) !== canonicalJson(plan.evidence.claimOwner)) {
      invalid("remote branch, pull request, or claim owner drift");
    }
    return Object.freeze({ disposition, registryRevision: registry.revision, lease,
      receipt, cloud, ownedWork });
  }

  function registryState(plan) {
    const registry = leaseStore.readRegistry();
    const lease = registry.leases?.[branch];
    if (writerLeaseDigest(lease) === plan.sourceLeaseDigest) {
      const matching = (lease[RECEIPTS_FIELD] || [])
        .filter(receipt => receipt.planDigest === plan.planDigest);
      if (matching.length !== 0) invalid("receipt before local projection");
      return Object.freeze({ registry, lease, receipt: null, disposition: "source" });
    }
    const matching = (lease?.[RECEIPTS_FIELD] || [])
      .filter(receipt => receipt.planDigest === plan.planDigest);
    if (matching.length !== 1) invalid("source-or-target lease");
    const receipt = matching[0];
    const projection = targetProjection(plan);
    const expectedReceipt = projectionReceipt(plan, registry.revision, receipt.phaseValues);
    const expectedLease = { ...projection.lease,
      [RECEIPTS_FIELD]: [...(projection.lease[RECEIPTS_FIELD] || []), expectedReceipt] };
    if (canonicalJson(receipt) !== canonicalJson(expectedReceipt)
      || canonicalJson(lease) !== canonicalJson(expectedLease)) {
      invalid("append-only continuation receipt or target lease");
    }
    return Object.freeze({ registry, lease, receipt, disposition: "target" });
  }

}

function targetProjection(plan) {
  const heartbeatAt = plan.evidence.cloudClaim.heartbeatAt || plan.evidence.observedAt;
  const lease = Object.freeze({ ...plan.evidence.lease, heartbeatAt,
    expiresAt: plan.evidence.cloudClaim.expiresAt });
  return Object.freeze({ lease, leaseDigest: writerLeaseDigest(lease),
    operationKey: currentCloudExpiredLocalWorkContinuationOperationKey(plan, "local-attempted") });
}
function projectionReceipt(plan, registryRevision, phaseValues) {
  const target = targetProjection(plan);
  const core = { schema: "agentic-current-cloud-expired-local-work-continuation-registry-receipt/v1",
    operationKey: target.operationKey, planDigest: plan.planDigest,
    operationDigest: digestValue(target.operationKey), evidenceDigest: plan.evidence.evidenceDigest,
    mode: plan.mode, taskProofDigest: phaseValues?.authorityVerified?.taskProofDigest,
    sourceLeaseDigest: plan.sourceLeaseDigest, projectedLeaseDigest: plan.projectedLeaseDigest,
    projectedHeartbeatAt: target.lease.heartbeatAt, projectedExpiresAt: target.lease.expiresAt,
    claimId: plan.evidence.cloudClaim.claimId, registryRevision, phaseValues,
    writerRegistryMutation: true };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}
function hydrateRegistryReceipt(plan, receipt) {
  let intent = createCurrentCloudExpiredLocalWorkContinuationIntent(plan);
  const authority = receipt?.phaseValues?.authorityVerified;
  intent = advanceCurrentCloudExpiredLocalWorkContinuationIntent(intent,
    { status: "authority-verified", values: { taskAuthorityBindingDigest:
      authority?.taskAuthorityBindingDigest, taskAuthorityReceiptDigest:
      authority?.taskAuthorityReceiptDigest, taskProofDigest: authority?.taskProofDigest } });
  return advanceCurrentCloudExpiredLocalWorkContinuationIntent(intent,
    { status: "local-attempted", values: receipt?.phaseValues?.localAttempted });
}
function projectedValues(plan, state, disposition) {
  return Object.freeze({ disposition, writerRegistryMutation: true,
    projectedLeaseDigest: plan.projectedLeaseDigest,
    storedLeaseDigest: writerLeaseDigest(state.lease),
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
  return normalizeCurrentCloudExpiredLocalWorkContinuationPlan(value);
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
