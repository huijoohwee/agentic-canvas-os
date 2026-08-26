// Responsibility: Join exact dirt, cloud, review, task proof, registry CAS, and marker projection.

import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { captureActiveOwnedDirtEvidence, requireSameActiveOwnedDirtEvidence }
  from "./active-owned-dirt-recovery-evidence.mjs";
import { canonicalJson, digestValue, writeSetsOverlap }
  from "./cloud-collaboration-primitives.mjs";
import { captureProtectedMainAdvance } from "./device-branch-ownership-lib.mjs";
import {
  buildPlannedDirtyAdmissionRecoveryEvidence,
  normalizePlannedDirtyAdmissionRecoveryEvidence,
} from "./planned-dirty-admission-recovery-evidence.mjs";
import { normalizePlannedDirtyAdmissionRecoveryPlan, OPERATION }
  from "./planned-dirty-admission-recovery-contract.mjs";
import {
  createPlannedDirtyAdmissionRecoveryStore,
  resolvePlannedDirtyAdmissionRecoveryJournalPath,
} from "./planned-dirty-admission-recovery-store.mjs";
import {
  attestProvisionedStartCloudAuthoritySubject,
  projectProvisionedStartCloudAuthoritySubject,
  requireProvisionedStartCloudAuthorityAttestation,
} from "./provisioned-start-cloud-authority-subject.mjs";
import { assertRegisteredWorktree } from "./repository-guards.mjs";
import { assertAdmissionMutationAuthority } from "./scoped-lane-admission-state.mjs";
import { verifyAdmissionCloudAuthority } from "./scoped-lane-cloud-authority.mjs";
import { normalizeDeclaredWriteScopeManifest } from "./scoped-lane-admission-lib.mjs";
import { authorizeTaskBoundLeaseMutation } from "./task-bound-lane-authority-store.mjs";
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

const CONTROLLER_ROOT = fileURLToPath(new URL("..", import.meta.url));
const RECEIPTS_FIELD = "plannedDirtyAdmissionRecoveryReceipts";
const GITHUB_PULL_REQUEST_BODY_LIMIT_BYTES = 65_536;
const IMPLEMENTATION_FILES = Object.freeze([
  "scripts/planned-dirty-admission-recovery-contract.mjs",
  "scripts/planned-dirty-admission-recovery-controller.mjs",
  "scripts/planned-dirty-admission-recovery-evidence.mjs",
  "scripts/planned-dirty-admission-recovery-repository-adapter.mjs",
  "scripts/planned-dirty-admission-recovery-store.mjs",
  "scripts/planned-dirty-admission-recovery.mjs",
]);

export function createPlannedDirtyAdmissionRecoveryRepositoryAdapter(
  options = {}, dependencies = {},
) {
  const resolveRealpath = dependencies.realpath || options.realpath || realpathSync;
  const repository = resolveRealpath(path.resolve(required(options.repository, "repository")));
  const sessionId = required(options.sessionId, "session ID");
  const capabilityPath = options.taskAuthorityFile
    ? resolveRealpath(path.resolve(options.taskAuthorityFile)) : null;
  if (capabilityPath && inside(repository, capabilityPath)) invalid("external task authority");
  const controllerRoot = resolveRealpath(path.resolve(options.controllerRepository
    || dependencies.controllerRoot || CONTROLLER_ROOT));
  const environment = dependencies.environment || options.environment || process.env;
  const execute = dependencies.execute || options.execute || ((command, args, cwd = repository,
    commandOptions = {}) => execFileSync(command, args, { cwd,
    encoding: commandOptions.input === undefined ? "utf8" : undefined,
    maxBuffer: 64 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"],
    env: environment, ...commandOptions }));
  const injectedGit = dependencies.git || options.git;
  const git = (args, cwd = repository) => String(injectedGit
    ? injectedGit(args, cwd) : execute("git", args, cwd)).trim();
  const ghRunner = dependencies.gh || options.gh;
  const gh = args => String(ghRunner ? ghRunner(args) : execute("gh", args)).trim();
  const now = dependencies.now || options.clock || options.now || (() => new Date());
  const verifyCloud = dependencies.verifyCloud || options.verifyCloud
    || verifyAdmissionCloudAuthority;
  const assertMutation = dependencies.assertMutationAuthority || options.assertMutationAuthority
    || assertAdmissionMutationAuthority;
  const authorizeTaskMutation = dependencies.authorizeTaskMutation
    || options.authorizeTaskMutation || authorizeTaskBoundLeaseMutation;
  const captureDirt = dependencies.captureDirt || options.captureDirt
    || (() => captureActiveOwnedDirtEvidence({ repository }));
  const customController = dependencies.captureController || options.captureController || null;
  const branch = required(git(["branch", "--show-current"]), "attached branch");
  const commonDirectory = resolveRealpath(path.resolve(
    repository, git(["rev-parse", "--git-common-dir"]),
  ));
  const leaseStore = dependencies.leaseStore || options.leaseStore || createWriterLeaseStore({
    gitCommonDir: commonDirectory, taskAuthorityPolicy: "projected", now,
  });

  function replayStore(plan) {
    return createPlannedDirtyAdmissionRecoveryStore({ statePath:
      resolvePlannedDirtyAdmissionRecoveryJournalPath({ commonDirectory,
        branch, planDigest: plan.planDigest }) });
  }

  function manifestFromLease(lease) {
    const admission = lease?.admission;
    const manifest = normalizeDeclaredWriteScopeManifest({
      schema: "agentic-declared-write-scope/v1",
      semanticScope: admission?.semanticScope,
      paths: (admission?.declaredWriteSet || []).filter(item => item.startsWith("path:"))
        .map(item => item.slice("path:".length)),
    }, { expectedScope: lease?.scope });
    if (manifest.manifestDigest !== admission?.manifestDigest
      || manifest.writeSetDigest !== admission?.writeSetDigest
      || canonicalJson(manifest.declaredWriteSet)
        !== canonicalJson(admission?.declaredWriteSet)) invalid("existing manifest");
    return manifest;
  }

  function registryState() {
    const registry = leaseStore.readRegistry();
    const lease = registry?.leases?.[branch] || null;
    return { registry, lease, witness: Object.freeze({ schema: registry?.schema,
      revision: registry?.revision, registryDigest: digestValue(registry),
      leaseDigest: lease ? writerLeaseDigest(lease) : digestValue(null) }) };
  }

  function exactSourceLease(value) {
    const lease = value || registryState().lease;
    if (lease?.schema !== "agentic-writer-lease/v2" || lease.status !== "active"
      || lease.branch !== branch || lease.sessionId !== sessionId
      || path.resolve(lease.worktreePath || "") !== repository
      || lease.admission?.status !== "planned" || lease.integration != null
      || !lease.cloudAuthority || !lease.taskAuthority
      || Date.parse(lease.expiresAt) <= now().getTime()) {
      invalid("exact registered task-bound active unexpired planned lease");
    }
    manifestFromLease(lease);
    return lease;
  }

  function repositoryFrame(lease) {
    const record = assertRegisteredWorktree({ cwd: repository,
      porcelain: git(["worktree", "list", "--porcelain", "-z"]),
      resolvePath: resolveRealpath });
    const headSha = sha(git(["rev-parse", "HEAD"]), "candidate HEAD");
    const fenceTreeSha = sha(git(["rev-parse", `${lease.fenceSha}^{tree}`]),
      "coordination fence tree");
    const baseTreeSha = sha(git(["rev-parse", `${lease.baseSha}^{tree}`]),
      "coordination base tree");
    const fenceParents = git(["show", "-s", "--format=%P", lease.fenceSha]);
    const fencePaths = git(["diff", "--name-only", "--no-renames", "-z",
      lease.baseSha, lease.fenceSha, "--"]);
    if (record.branch !== `refs/heads/${branch}` || record.head !== headSha
      || headSha !== lease.fenceSha || fenceParents !== lease.baseSha
      || fenceTreeSha !== baseTreeSha || fencePaths !== "") {
      invalid("registered worktree at exact empty one-parent coordination fence");
    }
    const dirt = captureDirt({ repository, lease });
    if (dirt.headSha !== lease.fenceSha) invalid("owned dirt fence");
    return Object.freeze({ headSha, dirt });
  }

  function remoteHead() {
    return firstSha(git(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]));
  }

  function pullRequestFrame(lease) {
    const value = JSON.parse(gh(["pr", "view", lease.pullRequestUrl, "--json",
      "id,number,url,state,isDraft,autoMergeRequest,headRefName,headRefOid,headRepository,baseRefName,baseRefOid,body"]));
    const number = positive(value.number, "pull-request number");
    const targetRepository = required(lease.cloudAuthority.targetRepository,
      "target repository");
    const headRepository = value.headRepository?.nameWithOwner || value.headRepository;
    const body = value.body || "";
    const marker = parseWriterLeasePullRequestBody(body);
    const remoteHeadSha = remoteHead();
    const originRepository = githubRepositoryFromRemoteUrl(
      git(["remote", "get-url", "origin"]),
    );
    const expectedUrl = `https://github.com/${targetRepository}/pull/${number}`;
    if (!marker || value.url !== lease.pullRequestUrl || value.state !== "OPEN"
      || value.isDraft !== true || value.autoMergeRequest !== null
      || value.headRefName !== branch || value.headRefOid !== lease.fenceSha
      || remoteHeadSha !== lease.fenceSha || value.baseRefName !== "main"
      || value.url !== expectedUrl || originRepository !== targetRepository
      || headRepository !== targetRepository) {
      invalid("same-repository open draft pull request at remote fence");
    }
    assertProjectedAdmissionMarkerBodyCapacity({ body, lease });
    return Object.freeze({ id: required(value.id, "pull-request ID"),
      reviewRequestId: reviewRequestId(value.id), number, url: value.url,
      state: value.state, isDraft: true,
      autoMergeRequest: null, branch, headRepository, headSha: value.headRefOid,
      remoteHeadSha, baseBranch: "main", baseSha: sha(value.baseRefOid,
        "pull-request base"), body, bodyDigest: digestValue(body), marker,
      markerDigest: digestValue(marker) });
  }

  function controllerFrame(lease, pullRequest, manifest) {
    if (customController) return customController({ lease, pullRequest, manifest,
      repository, controllerRoot, git });
    const headSha = sha(git(["rev-parse", "HEAD"], controllerRoot), "controller HEAD");
    const originMainSha = sha(git(["rev-parse", "origin/main"], controllerRoot),
      "controller origin/main");
    const remoteMainSha = firstSha(git(["ls-remote", "--heads", "origin",
      "refs/heads/main"], controllerRoot));
    const status = git(["status", "--porcelain=v1", "--untracked-files=all"], controllerRoot);
    const controller = Object.freeze({ repositoryPathDigest: digestValue(controllerRoot),
      branch: git(["branch", "--show-current"], controllerRoot), headSha,
      treeSha: sha(git(["rev-parse", "HEAD^{tree}"], controllerRoot), "controller tree"),
      originMainSha, remoteMainSha, statusDigest: digestValue(status),
      clean: status === "", protected: headSha === originMainSha && headSha === remoteMainSha,
      implementationDigest: digestValue(IMPLEMENTATION_FILES.map(file => ({ file,
        digest: digestValue(readFileSync(path.join(controllerRoot, file))) }))) });
    const protectedMainAdvance = captureProtectedMainAdvance({ baseSha: lease.baseSha,
      pullRequestBaseSha: pullRequest.baseSha, protectedMainSha: headSha,
      declaredWriteSet: manifest.declaredWriteSet,
      gitText: args => git(args, controllerRoot) });
    return Object.freeze({ controller, protectedMainAdvance });
  }

  function cloudFrame(lease, manifest) {
    const verified = verifyCloud({ authority: lease.cloudAuthority, manifest,
      canonicalBaseSha: lease.baseSha, environment });
    const subject = projectProvisionedStartCloudAuthoritySubject({ verified, lease, manifest });
    const attestation = attestProvisionedStartCloudAuthoritySubject({ verified, subject });
    requireProvisionedStartCloudAuthorityAttestation(attestation, digestValue(subject));
    const mutation = assertMutation({ lease, cloudAuthority: verified.authority,
      remoteAuthorityVerification: verified.verification,
      allowPlanned: lease.admission?.status === "planned" });
    const claims = verified.verification?.inventory?.claims;
    if (!Array.isArray(claims)) invalid("cloud claim inventory");
    const overlaps = claims.filter(claim => claim.claimId !== subject.claim.claimId
      && (claim.writeAuthority === true || claim.scopeReserved === true)
      && writeSetsOverlap(claim.declaredWriteScope, manifest.declaredWriteSet))
      .map(claim => claim.claimId).sort();
    if (overlaps.length) invalid("non-overlapping peer inventory");
    return Object.freeze({ subject, attestation, mutation, overlaps });
  }

  function capturePlanFrame() {
    const state = registryState();
    const lease = exactSourceLease(state.lease);
    const manifest = manifestFromLease(lease);
    const repositoryState = repositoryFrame(lease);
    const pullRequest = pullRequestFrame(lease);
    const cloud = cloudFrame(lease, manifest);
    const protectedState = controllerFrame(lease, pullRequest, manifest);
    return Object.freeze({ registry: state.witness, lease, manifest,
      dirt: repositoryState.dirt, pullRequest, cloud,
      controller: protectedState.controller,
      protectedMainAdvance: protectedState.protectedMainAdvance });
  }

  function readEvidence() {
    const first = capturePlanFrame();
    const second = capturePlanFrame();
    return buildPlannedDirtyAdmissionRecoveryEvidence({ observedAt: now().toISOString(),
      repositoryPathDigest: digestValue(repository),
      targetRepository: first.lease.cloudAuthority.targetRepository,
      ledgerRepository: first.lease.cloudAuthority.ledgerRepository,
      branch, sessionId, leaseObservations: [first.lease, second.lease],
      registryObservations: [first.registry, second.registry],
      dirtObservations: [first.dirt, second.dirt], manifest: first.manifest,
      pullRequestObservations: [first.pullRequest, second.pullRequest],
      cloudSubjects: [first.cloud.subject, second.cloud.subject],
      controllerObservations: [first.controller, second.controller],
      protectedMainObservations: [first.protectedMainAdvance,
        second.protectedMainAdvance], overlappingClaimIds: first.cloud.overlaps,
      taskAuthorityBindingDigest: first.lease.taskAuthority.bindingDigest });
  }

  function requirePlan(value) { return normalizePlannedDirtyAdmissionRecoveryPlan(value); }
  function authorizedValues(intent) {
    const values = intent?.phases?.authorized?.values || intent?.authorized || null;
    if (!values || !digestPattern(values.taskAuthorityReceiptDigest)
      || !digestPattern(values.taskProofDigest)) invalid("authorized task proof phase");
    return values;
  }

  function recoveryRecord(plan, intent, mutationReceipt, projectedAt) {
    const authorized = authorizedValues(intent);
    const authorityReceipt = normalizeMutationReceipt(plan, mutationReceipt);
    const core = { schema: "agentic-planned-dirty-admission-preservation/v1",
      planDigest: plan.planDigest, sourceLeaseDigest: plan.evidence.sourceLeaseDigest,
      sourceAdmissionDigest: digestValue(plan.evidence.sourceLease.admission),
      dirtEvidenceDigest: plan.evidence.dirtDigest,
      authorizationDigest: authorized.authorizationDigest || null,
      taskAuthorityReceiptDigest: authorized.taskAuthorityReceiptDigest,
      taskProofDigest: authorized.taskProofDigest,
      plannedMutationAuthorityReceipt: authorityReceipt, projectedAt };
    return Object.freeze({ ...core, receiptDigest: digestValue(core) });
  }

  function projectTargetLease(plan, intent, mutationReceipt, projectedAt) {
    const source = plan.evidence.sourceLease;
    const preservation = recoveryRecord(plan, intent, mutationReceipt, projectedAt);
    const admission = Object.freeze({ ...source.admission, status: "admitted",
      admittedReportDigest: preservation.receiptDigest,
      preservationReceiptDigest: preservation.receiptDigest });
    return Object.freeze({ ...source, admission,
      plannedDirtyAdmissionRecovery: preservation });
  }

  function validTargetLease(plan, intent, lease) {
    const record = lease?.plannedDirtyAdmissionRecovery;
    if (!record || record.planDigest !== plan.planDigest
      || record.sourceLeaseDigest !== plan.evidence.sourceLeaseDigest
      || !record.plannedMutationAuthorityReceipt?.receiptDigest) return false;
    const { receiptDigest, ...core } = record;
    if (receiptDigest !== digestValue(core)) return false;
    const projected = projectTargetLease(plan, intent,
      record.plannedMutationAuthorityReceipt,
      record.projectedAt);
    return canonicalJson(projected) === canonicalJson(lease);
  }

  function normalizeMutationReceipt(plan, value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      invalid("mutation-authority receipt");
    }
    const receipt = structuredClone(value);
    const { receiptDigest, ...core } = receipt;
    const authority = plan.evidence.sourceLease.cloudAuthority;
    if (receipt.schema !== "agentic-admission-mutation-authority/v1"
      || receipt.status !== "ready" || !digestPattern(receiptDigest)
      || receiptDigest !== digestValue(core) || receipt.claimId !== authority.claimId
      || receipt.claimDigest !== authority.claimDigest
      || receipt.ledgerRevision !== authority.ledgerRevision
      || receipt.localLeaseEpoch !== plan.evidence.sourceLease.epoch
      || receipt.localFenceSha !== plan.evidence.sourceLease.fenceSha
      || receipt.remoteLeaseEpoch !== authority.leaseEpoch
      || !digestPattern(receipt.cloudVerificationReceiptDigest)
      || !Number.isFinite(Date.parse(receipt.evaluatedAt))
      || !Number.isFinite(Date.parse(receipt.expiresAt))
      || Date.parse(receipt.evaluatedAt) >= Date.parse(receipt.expiresAt)) {
      invalid("joined mutation-authority receipt");
    }
    return Object.freeze(receipt);
  }

  function registryDisposition(plan, intent) {
    const state = registryState();
    const digest = state.lease ? writerLeaseDigest(state.lease) : null;
    const source = digest === plan.evidence.sourceLeaseDigest;
    const target = !source && validTargetLease(plan, intent, state.lease);
    if (!source && !target) invalid("source-or-target writer registry");
    const operationKey = digestValue({ operation: OPERATION, planDigest: plan.planDigest });
    const receipt = state.registry?.[RECEIPTS_FIELD]?.[operationKey] || null;
    if (source && receipt) invalid("source registry recovery receipt");
    if (target) {
      const { receiptDigest, ...receiptCore } = receipt || {};
      if (!receipt || receipt.planDigest !== plan.planDigest
        || receipt.operationKey !== operationKey
        || receipt.sourceLeaseDigest !== plan.evidence.sourceLeaseDigest
        || receipt.targetLeaseDigest !== digest
        || receipt.claimId !== plan.evidence.sourceLease.cloudAuthority.claimId
        || receipt.dirtDigest !== plan.evidence.dirtDigest
        || receipt.registryRevision > state.registry.revision
        || receipt.registryRevision !== plan.evidence.sourceRegistry.revision + 1
        || receiptDigest !== digestValue(receiptCore)) invalid("target registry recovery receipt");
    } else if (canonicalJson(state.witness) !== canonicalJson(plan.evidence.sourceRegistry)) {
      invalid("sealed source writer registry");
    }
    return Object.freeze({ ...state, disposition: source ? "source" : "target",
      operationKey, receipt });
  }

  function markerDisposition(plan, registryDispositionValue, lease, pullRequest) {
    const sourceMarker = projectWriterLeasePullRequestMarker(plan.evidence.sourceLease);
    const targetMarker = projectWriterLeasePullRequestMarker(lease);
    const targetBody = updateWriterLeasePullRequestBody(plan.evidence.pullRequest.body, lease);
    const source = canonicalJson(pullRequest.marker) === canonicalJson(sourceMarker)
      && pullRequest.bodyDigest === plan.evidence.pullRequest.bodyDigest;
    const target = canonicalJson(pullRequest.marker) === canonicalJson(targetMarker)
      && pullRequest.bodyDigest === digestValue(targetBody);
    if (registryDispositionValue === "source") {
      if (!source) invalid("deterministic source pull-request marker");
      return Object.freeze({ disposition: "source", targetBody: null,
        targetBodyDigest: null, targetMarker: null, targetMarkerDigest: null });
    }
    if (!source && !target) invalid("deterministic source-or-target pull-request marker");
    return Object.freeze({ disposition: target ? "target" : "source", targetBody,
      targetBodyDigest: digestValue(targetBody), targetMarker,
      targetMarkerDigest: digestValue(targetMarker) });
  }

  function executionFrame(plan, intent) {
    const registry = registryDisposition(plan, intent);
    const lease = registry.lease;
    const manifest = manifestFromLease(lease);
    const repositoryState = repositoryFrame(lease);
    const pullRequest = pullRequestFrame(lease);
    const marker = markerDisposition(plan, registry.disposition, lease, pullRequest);
    const cloud = cloudFrame(lease, manifest);
    const protectedState = controllerFrame(lease, pullRequest, manifest);
    return Object.freeze({ registry, lease, manifest, dirt: repositoryState.dirt,
      pullRequest, marker, cloud, controller: protectedState.controller,
      protectedMainAdvance: protectedState.protectedMainAdvance });
  }

  function stableExecutionFrame(frame) {
    return { leaseDigest: writerLeaseDigest(frame.lease),
      registryRevision: frame.registry.registry?.revision,
      registryDisposition: frame.registry.disposition,
      dirtDigest: frame.dirt.evidenceDigest, pullRequest: frame.pullRequest,
      markerDisposition: frame.marker.disposition,
      cloudSubject: frame.cloud.subject, controller: frame.controller,
      protectedMainAdvance: frame.protectedMainAdvance };
  }

  function assertSource(planValue, stage, intent = null) {
    const plan = requirePlan(planValue);
    const currentIntent = intent || replayStore(plan).read();
    const first = executionFrame(plan, currentIntent);
    const second = executionFrame(plan, currentIntent);
    if (canonicalJson(stableExecutionFrame(first))
      !== canonicalJson(stableExecutionFrame(second))) invalid("execution double-read drift");
    requireSameActiveOwnedDirtEvidence(plan.evidence.ownedDirt, second.dirt);
    if (canonicalJson(second.manifest) !== canonicalJson(plan.evidence.manifest)
      || digestValue(second.cloud.subject) !== plan.evidence.cloudAuthoritySubjectDigest
      || second.cloud.overlaps.length
      || canonicalJson(second.controller) !== canonicalJson(plan.evidence.protectedController)
      || canonicalJson(second.protectedMainAdvance)
        !== canonicalJson(plan.evidence.protectedMainAdvance)) invalid("sealed stable subject drift");
    const { body: _body, bodyDigest: _bodyDigest, marker: _marker,
      markerDigest: _markerDigest, ...pr } = second.pullRequest;
    const { body: _expectedBody, bodyDigest: _expectedBodyDigest,
      marker: _expectedMarker, markerDigest: _expectedMarkerDigest,
      ...expectedPr } = plan.evidence.pullRequest;
    if (canonicalJson(pr) !== canonicalJson(expectedPr)) invalid("sealed pull-request frame");
    const sourceRequired = stage === "before-task-authorization";
    const targetRequired = new Set(["before-pr-marker-projection",
      "before-terminal-verification", "before-terminal-replay"]).has(stage);
    const markerTargetRequired = new Set(["before-terminal-verification",
      "before-terminal-replay"]).has(stage);
    if ((sourceRequired && second.registry.disposition !== "source")
      || (targetRequired && second.registry.disposition !== "target")
      || (sourceRequired && second.marker.disposition !== "source")
      || (markerTargetRequired && second.marker.disposition !== "target")) {
      invalid(`stage ${stage}`);
    }
    return second;
  }

  function projectedRegistryValues(plan, state, adopted) {
    const record = state.lease.plannedDirtyAdmissionRecovery;
    return Object.freeze({ leaseDigest: writerLeaseDigest(state.lease),
      preservationReceiptDigest: record.receiptDigest,
      plannedMutationAuthorityReceiptDigest:
        record.plannedMutationAuthorityReceipt.receiptDigest,
      registryRevision: state.registry.revision, adopted });
  }

  return Object.freeze({
    gitCommonDir: commonDirectory,
    branch,
    readEvidence,
    readPlanEvidence: readEvidence,
    withOperationLock(planValue, action) {
      const plan = requirePlan(planValue);
      if (typeof action !== "function") invalid("operation callback");
      return replayStore(plan).withLock(action);
    },
    readIntent(planValue) { const plan = requirePlan(planValue); return replayStore(plan).read(); },
    writeIntent({ expected, next, value, plan: planValue }) {
      const plan = requirePlan(planValue);
      return replayStore(plan).write({ expected, next: next ?? value });
    },
    assertSource(planValue, stage, intent = null) {
      return assertSource(planValue, stage, intent);
    },
    authorizeTask(planValue) {
      const plan = requirePlan(planValue);
      assertSource(plan, "before-task-authorization");
      if (!capabilityPath) invalid("external task-authority capability");
      const receipt = authorizeTaskMutation({ lease: plan.evidence.sourceLease,
        capabilityPath, operation: `${OPERATION}:${plan.planDigest}`, now: now() });
      return Object.freeze({ receiptDigest: receipt.receiptDigest,
        proofDigest: receipt.proofDigest,
        taskAuthorityReceiptDigest: receipt.receiptDigest,
        taskProofDigest: receipt.proofDigest,
        taskAuthorityBindingDigest: receipt.bindingDigest });
    },
    projectRegistry({ plan: planValue, intent }) {
      const plan = requirePlan(planValue);
      let before = assertSource(plan, "before-registry-projection", intent);
      if (before.registry.disposition === "target") {
        return projectedRegistryValues(plan, before.registry, true);
      }
      const mutation = before.cloud.mutation;
      const target = projectTargetLease(plan, intent, mutation, mutation.evaluatedAt);
      const operationKey = before.registry.operationKey;
      const targetDigest = writerLeaseDigest(target);
      const result = mutateWriterLeaseRegistry({ leaseStore, branch,
        expectedLeaseDigest: plan.evidence.sourceLeaseDigest,
        expectedClaimId: plan.evidence.sourceLease.cloudAuthority.claimId,
        action: ({ registry }) => {
          const receiptCore = { schema:
            "agentic-planned-dirty-admission-recovery-registry-receipt/v1",
          operationKey, planDigest: plan.planDigest,
          sourceLeaseDigest: plan.evidence.sourceLeaseDigest,
          targetLeaseDigest: targetDigest, claimId: target.cloudAuthority.claimId,
          dirtDigest: plan.evidence.dirtDigest, registryRevision: registry.revision + 1 };
          const receipt = { ...receiptCore, receiptDigest: digestValue(receiptCore) };
          return { registry: { ...registry, leases: { ...registry.leases, [branch]: target },
            [RECEIPTS_FIELD]: { ...(registry[RECEIPTS_FIELD] || {}),
              [operationKey]: receipt } }, lease: target, changed: true };
        } });
      before = assertSource(plan, "before-pr-marker-projection", intent);
      if (result.registryRevision > before.registry.registry.revision) {
        invalid("post-CAS registry revision");
      }
      return projectedRegistryValues(plan, before.registry, false);
    },
    projectPullRequestMarker({ plan: planValue, intent }) {
      const plan = requirePlan(planValue);
      let frame = assertSource(plan, "before-pr-marker-projection", intent);
      let adopted = frame.marker.disposition === "target";
      if (!adopted) {
        withHeartbeatProjectionFence({ leaseStore, branch,
          expectedLeaseDigest: writerLeaseDigest(frame.lease),
          expectedClaimId: frame.lease.cloudAuthority.claimId,
          action: () => {
            const immediate = pullRequestFrame(frame.lease);
            const disposition = markerDisposition(plan, "target", frame.lease, immediate);
            if (disposition.disposition === "source") {
              gh(["pr", "edit", frame.pullRequest.url,
                "--body", disposition.targetBody]);
            } else {
              adopted = true;
            }
          } });
        frame = assertSource(plan, "before-terminal-verification", intent);
      }
      if (frame.marker.disposition !== "target") invalid("target pull-request marker");
      const receiptCore = { schema:
        "agentic-planned-dirty-admission-recovery-marker-receipt/v1",
      planDigest: plan.planDigest, pullRequestUrl: frame.pullRequest.url,
      bodyDigest: frame.marker.targetBodyDigest,
      markerDigest: frame.marker.targetMarkerDigest };
      return Object.freeze({ bodyDigest: frame.marker.targetBodyDigest,
        markerDigest: frame.marker.targetMarkerDigest,
        receiptDigest: digestValue(receiptCore), adopted });
    },
    verifyTerminal({ plan: planValue, intent, replay = false }) {
      const plan = requirePlan(planValue);
      const frame = assertSource(plan, replay ? "before-terminal-replay"
        : "before-terminal-verification", intent);
      const core = { planDigest: plan.planDigest,
        leaseDigest: writerLeaseDigest(frame.lease),
        bodyDigest: frame.pullRequest.bodyDigest,
        markerDigest: frame.pullRequest.markerDigest,
        dirtDigest: frame.dirt.evidenceDigest,
        cloudAuthoritySubjectDigest: digestValue(frame.cloud.subject),
        protectedControllerDigest: digestValue(frame.controller),
        protectedMainAdvanceDigest: digestValue(frame.protectedMainAdvance) };
      return Object.freeze({ ...core,
        cloudVerificationReceiptDigest: frame.cloud.attestation.sourceReceiptDigest,
        cloudVerificationAttestationReceiptDigest: frame.cloud.attestation.receiptDigest,
        mutationAuthorityReceiptDigest: frame.cloud.mutation.receiptDigest,
        terminalEvidenceDigest: digestValue(core), sourceBytesChanged: false,
        indexChanged: false, headChanged: false, refsChanged: false,
        cloudChanged: false, pullRequestStateChanged: false });
    },
  });
}

export const createRepositoryPlannedDirtyAdmissionRecoveryAdapter =
  createPlannedDirtyAdmissionRecoveryRepositoryAdapter;

function reviewRequestId(value) { const id = required(value, "review identity");
  return id.startsWith("github-pull-request:") ? id : `github-pull-request:${id}`; }
function assertProjectedAdmissionMarkerBodyCapacity({ body, lease }) {
  if (lease.admission?.status !== "planned") return;
  const placeholder = "0".repeat(64);
  const projected = { ...lease, admission: { ...lease.admission, status: "admitted",
    admittedReportDigest: placeholder, preservationReceiptDigest: placeholder } };
  const targetBody = updateWriterLeasePullRequestBody(body, projected);
  if (Buffer.byteLength(targetBody) > GITHUB_PULL_REQUEST_BODY_LIMIT_BYTES) {
    invalid("bounded target pull-request marker body");
  }
}
function githubRepositoryFromRemoteUrl(value) {
  const source = required(value, "origin remote URL");
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/u.exec(source);
  if (!match) invalid("GitHub origin repository");
  return match[1];
}
function firstSha(value) { return sha(String(value || "").trim().split(/\s+/u)[0], "remote SHA"); }
function inside(root, candidate) { const relative = path.relative(root, candidate);
  return !relative || (!relative.startsWith("..") && !path.isAbsolute(relative)); }
function required(value, label) { if (typeof value !== "string" || !value.trim()) invalid(label); return value.trim(); }
function sha(value, label) { if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) invalid(label); return value; }
function positive(value, label) { if (!Number.isSafeInteger(value) || value < 1) invalid(label); return value; }
function digestPattern(value) { return /^[0-9a-f]{64}$/u.test(String(value || "")); }
function invalid(label) { throw new Error(`Planned-dirty admission recovery has invalid ${label}.`); }
