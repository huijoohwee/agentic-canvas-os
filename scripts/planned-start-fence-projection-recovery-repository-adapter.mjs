// Responsibility: Project one verified cloud fence into its exact planned local lease.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";

import { canonicalJson, digestValue, writeSetsOverlap }
  from "./cloud-collaboration-primitives.mjs";
import {
  plannedStartFenceProjectionRecoveryOperationKey,
  advancePlannedStartFenceProjectionRecoveryIntent,
  createPlannedStartFenceProjectionRecoveryIntent,
  normalizePlannedStartFenceProjectionRecoveryIntent,
  normalizePlannedStartFenceProjectionRecoveryPlan,
} from "./planned-start-fence-projection-recovery-contract.mjs";
import { buildPlannedStartFenceProjectionRecoveryEvidence }
  from "./planned-start-fence-projection-recovery-evidence.mjs";
import { assertRegisteredWorktree }
  from "./repository-guards.mjs";
import { invokeRepositoryCloudAction, verifyAdmissionCloudAuthority }
  from "./scoped-lane-cloud-authority.mjs";
import { authorizeTaskBoundLeaseMutation }
  from "./task-bound-lane-authority-store.mjs";
import { createWriterLeaseStore, parseWriterLeasePullRequestBody }
  from "./writer-lease-lib.mjs";
import { mutateWriterLeaseRegistry, writerLeaseDigest }
  from "./writer-lease-registry-cas.mjs";

const RECEIPTS_FIELD = "plannedStartFenceProjectionRecoveryReceipts";

export function createRepositoryPlannedStartFenceProjectionRecoveryAdapter(
  options = {}, dependencies = {},
) {
  const resolveRealpath = dependencies.realpath || realpathSync;
  const repository = resolveRealpath(path.resolve(required(options.repository, "repository")));
  const sessionId = required(options.sessionId, "session ID");
  const taskAuthorityFile = options.taskAuthorityFile
    ? resolveRealpath(path.resolve(options.taskAuthorityFile)) : null;
  const execute = dependencies.execute || ((command, argumentsList) => execFileSync(
    command, argumentsList, { cwd: repository, encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
  ));
  const git = dependencies.git || (argumentsList => String(execute("git", argumentsList)).trim());
  const gh = dependencies.gh || (argumentsList => String(execute("gh", argumentsList)).trim());
  const now = dependencies.now || (() => new Date());
  const inspectCloud = dependencies.inspectCloud || invokeRepositoryCloudAction;
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
      || lease.admission?.status !== "planned" || lease.integration != null
      || !lease.cloudAuthority || !lease.taskAuthority) invalid("exact planned source lease");
    return lease;
  }

  function manifestFromLease(lease) {
    return Object.freeze({ manifestDigest: lease.admission.manifestDigest,
      declaredWriteSet: Object.freeze([...lease.admission.declaredWriteSet]),
      writeSetDigest: lease.admission.writeSetDigest });
  }

  function gitObservation(lease) {
    const registered = assertRegisteredWorktree({ cwd: repository,
      porcelain: git(["worktree", "list", "--porcelain", "-z"]),
      resolvePath: resolveRealpath });
    const headSha = sha(git(["rev-parse", "HEAD"]), "HEAD");
    const treeSha = sha(git(["rev-parse", "HEAD^{tree}"]), "HEAD tree");
    const status = git(["status", "--porcelain=v1", "--untracked-files=all"]);
    if (registered.branch !== `refs/heads/${branch}` || registered.head !== headSha
      || status !== "" || git(["merge-base", lease.fenceSha, headSha]) !== lease.fenceSha
      || git(["rev-list", "--count", `${lease.fenceSha}..${headSha}`]) === "0") {
      invalid("clean authored descendant worktree");
    }
    const changedPaths = git(["diff", "--name-only", lease.fenceSha, headSha])
      .split(/\r?\n/u).filter(Boolean).map(candidate => `path:${candidate}`).sort();
    return Object.freeze({ branch, worktreePath: repository, registered: true, clean: true,
      fenceSha: lease.fenceSha, localHeadSha: headSha, localTreeSha: treeSha,
      remoteHeadSha: lease.fenceSha, indexTreeSha: treeSha, statusDigest: digestValue(status),
      authoredDescendantDigest: digestValue({ changedPaths,
        patch: git(["diff", "--binary", "--full-index", lease.fenceSha, headSha]) }),
      changedPaths: Object.freeze(changedPaths) });
  }

  function pullRequestObservation(lease) {
    const value = JSON.parse(gh(["pr", "view", lease.pullRequestUrl, "--json",
      "id,number,url,state,isDraft,autoMergeRequest,headRefName,headRefOid,baseRefName,baseRefOid,body"]));
    if (value.url !== lease.pullRequestUrl || value.headRefName !== branch
      || value.headRefOid !== lease.fenceSha || value.state !== "OPEN"
      || value.isDraft !== true || value.autoMergeRequest !== null) {
      invalid("draft pull-request fence");
    }
    const body = value.body || "";
    return Object.freeze({ id: required(value.id, "pull-request id"), number: integer(value.number,
      "pull-request number"), url: value.url, branch: value.headRefName, state: value.state,
      isDraft: value.isDraft, autoMergeRequest: value.autoMergeRequest,
      reviewRequestId: `github-pull-request:${value.id}`,
      headSha: value.headRefOid, baseSha: value.baseRefOid, bodyDigest: digestValue(body),
      markerDigest: digestValue(parseWriterLeasePullRequestBody(body)) });
  }

  function cloudObservation(lease, pullRequest) {
    const manifest = manifestFromLease(lease);
    const environment = dependencies.environment || process.env;
    const status = inspectCloud({ action: "status",
      ledgerRepository: lease.cloudAuthority.ledgerRepository,
      request: { targetRepository: lease.cloudAuthority.targetRepository }, environment });
    const matches = status?.schema === "agentic-cloud-collaboration-result/v1"
      && status.ok === true && status.action === "status" && status.status === "ready"
      && Array.isArray(status.claims)
      ? status.claims.filter(claim => claim.claimId === lease.cloudAuthority.claimId) : [];
    if (matches.length !== 1) invalid("current cloud status claim");
    const projectedAuthority = projectCurrentAuthority(lease.cloudAuthority, status, matches[0]);
    const result = verifyCloud({ authority: projectedAuthority, manifest,
      canonicalBaseSha: lease.baseSha, environment });
    const claims = result?.verification?.inventory?.claims;
    const verifiedMatches = Array.isArray(claims)
      ? claims.filter(claim => claim.claimId === lease.cloudAuthority.claimId) : [];
    if (result?.verification?.status !== "ready" || verifiedMatches.length !== 1) {
      invalid("verified current cloud claim");
    }
    const claim = verifiedMatches[0];
    const overlappingClaimIds = claims.filter(candidate => candidate.claimId !== claim.claimId
      && (candidate.writeAuthority === true || candidate.scopeReserved === true)
      && writeSetsOverlap(candidate.declaredWriteScope, claim.declaredWriteScope))
      .map(candidate => candidate.claimId).sort();
    requireRecoverableTransition({ source: lease.cloudAuthority, target: result.authority,
      claim, lease, pullRequest, overlappingClaimIds });
    return Object.freeze({ status: "ready", evaluatedAt: result.verification.verifiedAt, claim,
      ledgerRevision: result.verification.ledgerRevision,
      ledgerDigest: result.verification.ledgerDigest,
      inventoryDigest: digestValue({ schema: "agentic-stable-cloud-claim-inventory/v1",
        observedLedgerHeadRevision: result.verification.inventory.observedLedgerHeadRevision,
        ledgerDigest: result.verification.inventory.ledgerDigest,
        claims: result.verification.inventory.claims }),
      verificationReceiptDigest: result.verification.receiptDigest,
      overlappingClaimIds: Object.freeze(overlappingClaimIds) });
  }

  function captureSnapshot(lease = sourceLease()) {
    const pullRequest = pullRequestObservation(lease);
    return Object.freeze({ lease, git: gitObservation(lease), pullRequest,
      cloud: cloudObservation(lease, pullRequest) });
  }

  function captureEvidence() {
    const first = captureSnapshot();
    const second = captureSnapshot(first.lease);
    return buildPlannedStartFenceProjectionRecoveryEvidence({
      repository: first.lease.cloudAuthority.targetRepository || "repository",
      observedAt: now().toISOString(),
      leaseObservations: [first.lease, second.lease],
      cloudObservations: [first.cloud, second.cloud],
      gitObservations: [first.git, second.git],
      pullRequestObservations: [first.pullRequest, second.pullRequest],
      taskCapabilityDigest: first.lease.taskAuthority.bindingDigest,
    });
  }

  return Object.freeze({
    gitCommonDir: commonDirectory,
    branch,
    readPlanEvidence: captureEvidence,
    async withOperationLock(callback) {
      if (typeof callback !== "function") invalid("operation callback");
      return callback();
    },
    readIntent(plan) {
      const sealed = requirePlan(plan);
      if (volatileIntent) return volatileIntent;
      const state = projectionState(sealed, { requireSourceOrTarget: true });
      if (state.disposition !== "target") return null;
      volatileIntent = hydrateReceipt(sealed, state.receipt);
      return volatileIntent;
    },
    writeIntent({ expected, value, plan }) {
      requirePlan(plan);
      if (digestValue(volatileIntent) !== digestValue(expected)) invalid("volatile intent CAS");
      volatileIntent = normalizePlannedStartFenceProjectionRecoveryIntent(value);
    },
    authorizeTask(plan) {
      const sealed = requirePlan(plan);
      assertStable(sealed, { allowTarget: false });
      if (!taskAuthorityFile) throw new Error("Fence projection run requires --task-authority.");
      const receipt = authorizeTaskMutation({ lease: sourceFromPlan(sealed),
        capabilityPath: taskAuthorityFile, operation: sealed.taskAuthorityOperation, now: now() });
      authorityValues = Object.freeze({ taskAuthorityReceiptDigest: receipt.receiptDigest,
        taskAuthorityBindingDigest: sealed.evidence.taskCapabilityDigest });
      return authorityValues;
    },
    revalidate(plan, stage) {
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
      attemptedValues = Object.freeze({ idempotencyKey: digestValue({ planDigest: sealed.planDigest,
        phase: "local-attempted" }), sourceLeaseDigest: sealed.evidence.sourceLeaseDigest,
      targetLeaseDigest: targetProjection(sealed).leaseDigest });
      return attemptedValues;
    },
    projectLocal(plan) {
      const sealed = requirePlan(plan);
      const before = assertStable(sealed, { allowTarget: true });
      if (before.disposition === "target") {
        return projectedValues(sealed, before, "adopted-response-loss");
      }
      if (!authorityValues || !attemptedValues) invalid("durable phase receipt inputs");
      const target = targetProjection(sealed);
      try {
        const result = mutateWriterLeaseRegistry({ leaseStore, branch,
          expectedLeaseDigest: sealed.evidence.sourceLeaseDigest,
          expectedClaimId: sourceCloudAuthority(sealed).claimId,
          action: ({ registry }) => {
            const registryRevision = registry.revision + 1;
            const receipt = projectionReceipt(sealed, target.lease, registryRevision,
              { authorityVerified: authorityValues, localAttempted: attemptedValues });
            return { registry: { ...registry,
              leases: { ...registry.leases, [branch]: target.lease },
              [RECEIPTS_FIELD]: { ...(registry[RECEIPTS_FIELD] || {}),
                [target.operationKey]: receipt } }, lease: target.lease, changed: true };
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
      return Object.freeze({ targetLeaseDigest: writerLeaseDigest(state.lease),
        recoveryReceiptDigest: state.receipt.receiptDigest,
        registryRevision: state.registryRevision,
        verificationDigest: digestValue({ planDigest: sealed.planDigest,
          targetLeaseDigest: writerLeaseDigest(state.lease),
          recoveryReceiptDigest: state.receipt.receiptDigest,
          registryRevision: state.registryRevision }) });
    },
  });

  function projectionState(plan, { requireSourceOrTarget }) {
    const registry = leaseStore.readRegistry();
    const lease = registry.leases?.[branch];
    const target = targetProjection(plan);
    const leaseDigest = writerLeaseDigest(lease);
    const disposition = leaseDigest === plan.evidence.sourceLeaseDigest ? "source"
      : leaseDigest === target.leaseDigest ? "target" : null;
    if (!disposition && requireSourceOrTarget) invalid("source-or-target lease");
    const receipt = registry[RECEIPTS_FIELD]?.[target.operationKey] || null;
    if ((disposition === "target") !== Boolean(receipt)
      || (receipt && canonicalJson(receipt) !== canonicalJson(projectionReceipt(
        plan, target.lease, registry.revision, receipt.phaseValues,
      )))) invalid("append-only fence-projection receipt");
    return Object.freeze({ disposition, registryRevision: registry.revision, lease, receipt });
  }

  function assertStable(plan, { allowTarget }) {
    const state = projectionState(plan, { requireSourceOrTarget: true });
    if (state.disposition === "target" && !allowTarget) invalid("premature target lease");
    const observedLease = state.disposition === "target" ? sourceFromPlan(plan) : state.lease;
    const first = captureSnapshot(observedLease);
    const second = captureSnapshot(observedLease);
    requireObservation(plan.evidence.gitObservations[0], first.git, "Git");
    requireObservation(first.git, second.git, "Git double-read");
    requireObservation(plan.evidence.pullRequestObservations[0], first.pullRequest, "pull request");
    requireObservation(first.pullRequest, second.pullRequest, "pull-request double-read");
    requireObservation(stableCloud(targetCloudObservation(plan)), stableCloud(first.cloud),
      "cloud target");
    requireObservation(stableCloud(first.cloud), stableCloud(second.cloud), "cloud double-read");
    return Object.freeze({ ...state, cloud: first.cloud, git: first.git,
      pullRequest: first.pullRequest });
  }
}

function projectCurrentAuthority(source, status, claim) {
  const target = { ...source, claimDigest: claim.fenceRevision,
    ledgerRevision: status.ledgerRevision, ledgerDigest: status.ledgerDigest,
    claimLedgerRevision: claim.transitionDigest, laneRevision: claim.laneRevision,
    reviewRequestId: claim.reviewRequestId || null, transitionCounter: claim.transitionCounter,
    state: "active", expiresAt: claim.expiresAt };
  for (const key of ["entrySchema", "claimIdentitySchema", "operationReceiptDigest"]) {
    if (claim[key] !== undefined) target[key] = claim[key];
  }
  return Object.freeze(target);
}

function sourceFromPlan(plan) {
  return plan.evidence.sourceLease || plan.evidence.leaseObservations[0];
}
function sourceCloudAuthority(plan) {
  return plan.evidence.sourceCloudAuthority || sourceFromPlan(plan).cloudAuthority;
}
function targetCloudObservation(plan) {
  return plan.evidence.targetCloudObservation || plan.evidence.cloudObservations[0];
}
function stableCloud(value) {
  const { evaluatedAt: _evaluatedAt,
    verificationReceiptDigest: _verificationReceiptDigest, ...stable } = value;
  return stable;
}
function targetCloudAuthority(plan) {
  if (plan.evidence.targetCloudAuthority) return plan.evidence.targetCloudAuthority;
  const source = sourceCloudAuthority(plan);
  const observation = targetCloudObservation(plan);
  const claim = observation.claim;
  return Object.freeze({ ...source, claimDigest: claim.fenceRevision,
    ledgerRevision: observation.ledgerRevision, ledgerDigest: observation.ledgerDigest,
    claimLedgerRevision: claim.transitionDigest, entrySchema: claim.entrySchema,
    claimIdentitySchema: claim.claimIdentitySchema,
    operationReceiptDigest: claim.operationReceiptDigest,
    mutationAuthorityEligible: claim.mutationAuthorityEligible,
    laneRevision: claim.laneRevision, cloudDeclaredWriteScope: claim.declaredWriteScope,
    writeSetDigest: claim.writeSetDigest, reviewRequestId: claim.reviewRequestId,
    transitionCounter: claim.transitionCounter, state: claim.state, expiresAt: claim.expiresAt,
    integrationReceiptDigest: claim.integrationReceiptDigest || null,
    integration: claim.integration || null });
}
function targetProjection(plan) {
  const lease = Object.freeze({ ...sourceFromPlan(plan),
    cloudAuthority: targetCloudAuthority(plan) });
  return Object.freeze({ lease, leaseDigest: writerLeaseDigest(lease),
    operationKey: plannedStartFenceProjectionRecoveryOperationKey(plan, "local-attempted") });
}
function projectionReceipt(plan, lease, registryRevision, phaseValues) {
  const target = targetProjection(plan);
  const core = { schema: "agentic-planned-start-fence-projection-recovery-registry-receipt/v1",
    operationKey: target.operationKey, planDigest: plan.planDigest,
    sourceLeaseDigest: plan.evidence.sourceLeaseDigest,
    targetLeaseDigest: writerLeaseDigest(lease), claimId: sourceCloudAuthority(plan).claimId,
    sourceTransitionCounter: sourceCloudAuthority(plan).transitionCounter,
    targetTransitionCounter: targetCloudAuthority(plan).transitionCounter,
    registryRevision, phaseValues, writerRegistryMutation: true, cloudMutation: false,
    providerMutation: false, gitMutation: false, sourceMutation: false };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}
function hydrateReceipt(plan, receipt) {
  let intent = createPlannedStartFenceProjectionRecoveryIntent(plan);
  intent = advancePlannedStartFenceProjectionRecoveryIntent(intent,
    { status: "authority-verified", values: receipt?.phaseValues?.authorityVerified });
  return advancePlannedStartFenceProjectionRecoveryIntent(intent,
    { status: "local-attempted", values: receipt?.phaseValues?.localAttempted });
}
function projectedValues(plan, state, disposition) {
  return Object.freeze({ disposition, writerRegistryMutation: true,
    sourceLeaseDigest: plan.evidence.sourceLeaseDigest,
    targetLeaseDigest: writerLeaseDigest(state.lease), registryRevision: state.registryRevision,
    recoveryReceiptDigest: state.receipt.receiptDigest,
    mutationAuthorityReceiptDigest:
      state.receipt.phaseValues.authorityVerified.taskAuthorityReceiptDigest });
}
function requireRecoverableTransition({ source, target, claim, lease, pullRequest,
  overlappingClaimIds }) {
  if (source.claimId !== target.claimId || source.transitionCounter + 1 !== target.transitionCounter
    || source.canonicalBaseSha !== target.canonicalBaseSha
    || source.canonicalBaseSha !== lease.baseSha || source.laneRevision !== lease.baseSha
    || target.laneRevision !== lease.fenceSha || target.state !== "active"
    || source.leaseEpoch !== target.leaseEpoch || source.writeSetDigest !== target.writeSetDigest
    || canonicalJson(source.cloudDeclaredWriteScope) !== canonicalJson(target.cloudDeclaredWriteScope)
    || target.reviewRequestId !== pullRequest.reviewRequestId
    || claim.claimId !== target.claimId
    || overlappingClaimIds.length > 0) invalid("same-claim next fence transition");
}
function requireObservation(expected, actual, label) {
  if (canonicalJson(expected) !== canonicalJson(actual)) invalid(`${label} observation`);
}
function requirePlan(value) { return normalizePlannedStartFenceProjectionRecoveryPlan(value); }
function required(value, label) {
  if (typeof value !== "string" || !value.trim()) invalid(label);
  return value;
}
function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) invalid(label);
  return value;
}
function sha(value, label) {
  if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) invalid(label);
  return value;
}
function invalid(label) {
  throw new Error(`Planned-start fence projection has invalid ${label}.`);
}
