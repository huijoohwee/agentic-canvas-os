import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { digestValue } from "../../scripts/cloud-collaboration-primitives.mjs";
import {
  authorizePlannedDirtyAdmissionRecovery,
  buildPlannedDirtyAdmissionRecoveryPlan,
  createRecoveryIntent,
  OPERATION,
} from "../../scripts/planned-dirty-admission-recovery-contract.mjs";
import { buildPlannedDirtyAdmissionRecoveryEvidence }
  from "../../scripts/planned-dirty-admission-recovery-evidence.mjs";
import { createPlannedDirtyAdmissionRecoveryRepositoryAdapter }
  from "../../scripts/planned-dirty-admission-recovery-repository-adapter.mjs";
import { PROVISIONED_START_CLOUD_AUTHORITY_SUBJECT_SCHEMA }
  from "../../scripts/provisioned-start-cloud-authority-subject.mjs";
import { normalizeDeclaredWriteScopeManifest }
  from "../../scripts/scoped-lane-admission-lib.mjs";
import { createTaskAuthorityBinding, createTaskAuthorityCapability }
  from "../../scripts/task-bound-lane-authority-contract.mjs";
import { projectWriterLeasePullRequestMarker, updateWriterLeasePullRequestBody }
  from "../../scripts/writer-lease-lib.mjs";
import { writerLeaseDigest } from "../../scripts/writer-lease-registry-cas.mjs";

const BASE = "a".repeat(40);
export const FENCE = "b".repeat(40);
export const PROTECTED = "c".repeat(40);
export const OBSERVED = "2026-08-26T00:00:00.000Z";
const EXPIRES = "2026-08-27T00:00:00.000Z";
export const D = value => digestValue({ value });

export function planFixture(options = {}) {
  return buildPlannedDirtyAdmissionRecoveryPlan({ evidence: evidenceFixture(options) });
}

export function evidenceFixture({ kind = "staged", clean = false,
  dirtPath = "docs/a.md", dirtHead = FENCE, admissionStatus = "planned",
  cloudState = "active", overlap = null, oneAhead = false,
  targetAuthorityChanges = {}, bodyPrefix = "" } = {}) {
  const manifest = normalizeDeclaredWriteScopeManifest({
    schema: "agentic-declared-write-scope/v1", semanticScope: "repair",
    paths: ["docs/a.md"],
  });
  const claimId = digestValue({ actorId: "actor", canonicalBaseRevision: BASE,
    leaseEpoch: 1, repositoryId: "repository", workItemId: "work-item",
    writeSetDigest: manifest.writeSetDigest });
  const cloudAuthority = {
    schema: "agentic-lane-cloud-authority/v1", provider: "github",
    ledgerRepository: "owner/controller", targetRepository: "owner/repository",
    claimId, claimDigest: D("claim fence"), ledgerRevision: PROTECTED,
    ledgerDigest: D("ledger"), claimLedgerRevision: D("claim transition"),
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    operationReceiptDigest: D("cloud operation"), mutationAuthorityEligible: true,
    canonicalBaseSha: BASE, laneRevision: FENCE,
    cloudDeclaredWriteScope: manifest.declaredWriteSet,
    writeSetDigest: manifest.writeSetDigest, deviceId: "device", sessionId: "session",
    reviewRequestId: "github-pull-request:PR_1", leaseEpoch: 1,
    transitionCounter: 2, state: "active",
    expiresAt: oneAhead ? "2026-08-25T23:30:00.000Z" : EXPIRES,
    integrationReceiptDigest: null, integration: null,
    manifestDigest: manifest.manifestDigest,
  };
  const admission = {
    schema: "agentic-lane-admission-lease/v1", status: admissionStatus,
    semanticScope: "repair", declaredWriteSet: manifest.declaredWriteSet,
    writeSetDigest: manifest.writeSetDigest, manifestDigest: manifest.manifestDigest,
    planReceiptDigest: D("plan receipt"), admissionReceiptDigest: D("admission receipt"),
    existingLaneStateDigest: D("existing lanes"),
  };
  const leaseFrame = {
    schema: "agentic-writer-lease/v2", status: "active", sessionId: "session",
    device: "device", scope: "repair", branch: "agent/device/repair",
    worktreePath: "/task/worktree", epoch: 2, baseSha: BASE, fenceSha: FENCE,
    pullRequestUrl: "https://github.com/owner/repository/pull/1", autoDelivery: true,
    runtimeRequired: true, admission, cloudAuthority,
    heartbeatAt: oneAhead ? "2026-08-25T23:00:00.000Z" : OBSERVED,
    expiresAt: cloudAuthority.expiresAt,
  };
  const capability = createTaskAuthorityCapability({ generation: 1, issuedAt: OBSERVED });
  const lease = { ...leaseFrame, taskAuthority: createTaskAuthorityBinding({
    capability, lease: leaseFrame, boundAt: OBSERVED,
  }) };
  const body = `${bodyPrefix}${updateWriterLeasePullRequestBody("owner", lease)}`;
  const marker = projectWriterLeasePullRequestMarker(lease);
  const ownedDirt = dirtEvidence({ kind, path: dirtPath, headSha: dirtHead, clean });
  const targetCloudAuthority = { ...cloudAuthority,
    ...(oneAhead ? { claimDigest: D("renewed claim fence"),
      ledgerRevision: "d".repeat(40), ledgerDigest: D("renewed ledger"),
      claimLedgerRevision: D("renewed transition"),
      operationReceiptDigest: D("renewed operation"), transitionCounter: 3,
      heartbeatCounter: 1, expiresAt: EXPIRES } : { heartbeatCounter: 0 }),
    ...targetAuthorityChanges };
  const cloudSubject = {
    schema: PROVISIONED_START_CLOUD_AUTHORITY_SUBJECT_SCHEMA,
    verificationSchema: "agentic-lane-cloud-verification/v1", provider: "github",
    ledgerRepository: targetCloudAuthority.ledgerRepository,
    targetRepository: targetCloudAuthority.targetRepository,
    claim: { claimId: targetCloudAuthority.claimId,
      claimDigest: targetCloudAuthority.claimDigest,
      claimLedgerRevision: targetCloudAuthority.claimLedgerRevision,
      entrySchema: targetCloudAuthority.entrySchema,
      claimIdentitySchema: targetCloudAuthority.claimIdentitySchema,
      operationReceiptDigest: targetCloudAuthority.operationReceiptDigest,
      state: cloudState, transitionCounter: targetCloudAuthority.transitionCounter,
      heartbeatCounter: targetCloudAuthority.heartbeatCounter,
      leaseEpoch: targetCloudAuthority.leaseEpoch,
      expiresAt: targetCloudAuthority.expiresAt, mutationAuthorityEligible: true,
      writeAuthority: cloudState === "active", scopeReserved: true },
    owner: { actorId: "actor", repositoryId: "repository", workItemId: "work-item",
      deviceId: "device", sessionId: "session" },
    lane: { branch: lease.branch,
      canonicalBaseSha: targetCloudAuthority.canonicalBaseSha,
      laneRevision: targetCloudAuthority.laneRevision,
      fenceSha: FENCE, reviewRequestId: targetCloudAuthority.reviewRequestId },
    scope: { semanticScope: "repair", declaredWriteSet: manifest.declaredWriteSet,
      writeSetDigest: manifest.writeSetDigest, manifestDigest: manifest.manifestDigest },
  };
  const sourceRegistry = { schema: "agentic-writer-lease-registry/v2", revision: 1,
    leases: { [lease.branch]: lease } };
  const registry = { schema: sourceRegistry.schema, revision: sourceRegistry.revision,
    registryDigest: digestValue(sourceRegistry), leaseDigest: writerLeaseDigest(lease) };
  const review = { id: "PR_1", reviewRequestId: "github-pull-request:PR_1",
    number: 1, url: lease.pullRequestUrl, state: "OPEN", isDraft: true,
    autoMergeRequest: null, branch: lease.branch, headRepository: "owner/repository",
    headSha: FENCE, remoteHeadSha: FENCE, baseBranch: "main", baseSha: BASE,
    body, bodyDigest: digestValue(body), marker, markerDigest: digestValue(marker) };
  const controller = { repositoryPathDigest: D("controller path"), branch: "main",
    headSha: PROTECTED, treeSha: D("tree").slice(0, 40), originMainSha: PROTECTED,
    remoteMainSha: PROTECTED, statusDigest: D("clean"), clean: true,
    protected: true, implementationDigest: D("implementation") };
  const advance = { schema: "agentic-active-owned-dirt-protected-main-advance/v1",
    baseSha: BASE, pullRequestBaseSha: BASE, protectedMainSha: PROTECTED,
    protectedMainTreeSha: D("protected tree").slice(0, 40),
    declaredWriteSetDigest: manifest.writeSetDigest, changedPathCount: 0,
    changedPathsDigest: digestValue([]) };
  return buildPlannedDirtyAdmissionRecoveryEvidence({ observedAt: OBSERVED,
    repositoryPathDigest: digestValue(lease.worktreePath),
    targetRepository: "owner/repository", ledgerRepository: "owner/controller",
    branch: lease.branch, sessionId: lease.sessionId, leaseObservations: [lease, lease],
    registryObservations: [registry, registry], dirtObservations: [ownedDirt, ownedDirt],
    manifest, pullRequestObservations: [review, review],
    cloudSubjects: [cloudSubject, cloudSubject],
    targetCloudAuthorityObservations: [targetCloudAuthority, targetCloudAuthority],
    controllerObservations: [controller, controller],
    protectedMainObservations: [advance, advance],
    overlappingClaimIds: overlap ? [overlap] : [],
    taskAuthorityBindingDigest: lease.taskAuthority.bindingDigest });
}

function dirtEvidence({ kind, path: entryPath, headSha, clean }) {
  const states = { staged: [true, false, false], unstaged: [false, true, false],
    untracked: [false, false, true], mixed: [true, true, false] }[kind];
  const [staged, unstaged, untracked] = states;
  const entries = clean ? [] : [{ path: entryPath, staged, unstaged, untracked,
    headMode: untracked ? null : "100644", headBlob: untracked ? null : "1".repeat(40),
    indexMode: untracked ? null : "100644",
    indexBlob: untracked ? null : (staged ? "2" : "1").repeat(40),
    worktreeType: "file", worktreeMode: "100644",
    worktreeBlob: untracked ? "3".repeat(40)
      : (unstaged ? "3" : (staged ? "2" : "1")).repeat(40) }];
  const core = { schema: "agentic-active-owned-dirt-evidence/v1", headSha, entries,
    pathCount: entries.length, stagedPathCount: entries.filter(item => item.staged).length,
    unstagedPathCount: entries.filter(item => item.unstaged).length,
    untrackedPathCount: entries.filter(item => item.untracked).length };
  return { ...core, evidenceDigest: digestValue(core) };
}

export function fenceAdapter(options = {}) {
  const plan = planFixture();
  const lease = plan.evidence.sourceLease;
  return createPlannedDirtyAdmissionRecoveryRepositoryAdapter({
    repository: lease.worktreePath, sessionId: lease.sessionId,
  }, {
    realpath: value => path.resolve(value), controllerRoot: "/controller",
    git: repositoryGit(lease, options),
    leaseStore: { readRegistry: () => ({
      schema: "agentic-writer-lease-registry/v2", revision: 1,
      leases: { [lease.branch]: lease },
    }) },
    captureDirt: () => plan.evidence.ownedDirt,
    now: () => new Date(OBSERVED),
  });
}

export function terminalAdapterFixture({ registryRevision = 2, thirdStateLease = false,
  originRepository = null, pullRequestUrl = null, registrySource = false,
  markerResponseLoss = false, oneAhead = false, mutableRegistry = false,
  registryResponseLoss = false, secondHeartbeat = false,
  exactTargetOverflow = false } = {}) {
  let plan = planFixture({ oneAhead });
  if (exactTargetOverflow) {
    const source = plan.evidence.sourceLease;
    const placeholder = { ...source, admission: { ...source.admission, status: "admitted",
      admittedReportDigest: D("placeholder admitted"),
      preservationReceiptDigest: D("placeholder preservation") } };
    const placeholderSize = Buffer.byteLength(updateWriterLeasePullRequestBody(
      plan.evidence.pullRequest.body, placeholder,
    ));
    plan = planFixture({ oneAhead,
      bodyPrefix: "x".repeat(65_536 - placeholderSize) });
  }
  const source = plan.evidence.sourceLease;
  const authorization = authorizePlannedDirtyAdmissionRecovery(
    plan, `authorize ${OPERATION} ${plan.planDigest}`,
  );
  const intent = createRecoveryIntent({ plan, authorization, taskAuthority: {
    receiptDigest: D("terminal task receipt"), proofDigest: D("terminal task proof"),
  } });
  const projectedPlanned = { ...source,
    cloudAuthority: plan.evidence.targetCloudAuthority,
    heartbeatAt: plan.evidence.heartbeatProjection.heartbeatAt,
    expiresAt: plan.evidence.heartbeatProjection.expiresAt };
  const plannedReceipt = mutationReceipt(projectedPlanned, "planned mutation", OBSERVED);
  const recoveryCore = {
    schema: "agentic-planned-dirty-admission-preservation/v2",
    planDigest: plan.planDigest, sourceLeaseDigest: plan.evidence.sourceLeaseDigest,
    sourceAdmissionDigest: digestValue(source.admission),
    dirtEvidenceDigest: plan.evidence.dirtDigest,
    authorizationDigest: intent.phases.authorized.values.authorizationDigest,
    taskAuthorityReceiptDigest:
      intent.phases.authorized.values.taskAuthorityReceiptDigest,
    taskProofDigest: intent.phases.authorized.values.taskProofDigest,
    plannedMutationAuthorityReceipt: plannedReceipt,
    targetCloudAuthorityDigest: plan.evidence.targetCloudAuthorityDigest,
    heartbeatProjectionDigest: plan.evidence.heartbeatProjection.projectionDigest,
    projectedAt: plannedReceipt.evaluatedAt,
  };
  const recovery = { ...recoveryCore, receiptDigest: digestValue(recoveryCore) };
  const target = { ...source,
    cloudAuthority: plan.evidence.targetCloudAuthority,
    heartbeatAt: plan.evidence.heartbeatProjection.heartbeatAt,
    expiresAt: plan.evidence.heartbeatProjection.expiresAt,
    admission: { ...source.admission, status: "admitted",
    admittedReportDigest: recovery.receiptDigest,
    preservationReceiptDigest: recovery.receiptDigest },
  plannedDirtyAdmissionRecovery: recovery };
  const operationKey = digestValue({ operation: OPERATION, planDigest: plan.planDigest });
  const registryReceiptCore = {
    schema: "agentic-planned-dirty-admission-recovery-registry-receipt/v2",
    operationKey, planDigest: plan.planDigest,
    sourceLeaseDigest: plan.evidence.sourceLeaseDigest,
    targetLeaseDigest: writerLeaseDigest(target), claimId: target.cloudAuthority.claimId,
    targetCloudAuthorityDigest: plan.evidence.targetCloudAuthorityDigest,
    heartbeatProjectionDigest: plan.evidence.heartbeatProjection.projectionDigest,
    dirtDigest: plan.evidence.dirtDigest, registryRevision: 2,
  };
  const registryReceipt = { ...registryReceiptCore,
    receiptDigest: digestValue(registryReceiptCore) };
  const registryLease = registrySource ? source : (thirdStateLease
    ? { ...target, heartbeatAt: "2026-08-26T00:05:00.000Z" } : target);
  let registry = { schema: "agentic-writer-lease-registry/v2",
    revision: registrySource ? 1 : registryRevision,
    leases: { [target.branch]: registryLease },
    ...(registrySource ? {} : {
      plannedDirtyAdmissionRecoveryReceipts: { [operationKey]: registryReceipt },
    }) };
  const targetBody = updateWriterLeasePullRequestBody(
    plan.evidence.pullRequest.body, target,
  );
  let currentBody = markerResponseLoss || registrySource
    ? plan.evidence.pullRequest.body : targetBody;
  let registryCasCalls = 0;
  let markerMutations = 0;
  let loseMarkerResponse = markerResponseLoss;
  const admittedReceipt = mutationReceipt(target, "fresh admitted", OBSERVED);
  const admittedReceiptDigest = admittedReceipt.receiptDigest;
  const mutationAdmissionStatuses = [];
  const mutationAuthorityCalls = [];
  const subject = plan.evidence.cloudAuthoritySubject;
  const secondHeartbeatAuthority = secondHeartbeat ? {
    ...plan.evidence.targetCloudAuthority,
    claimDigest: D("second heartbeat claim fence"),
    ledgerRevision: "e".repeat(40),
    ledgerDigest: D("second heartbeat ledger"),
    claimLedgerRevision: D("second heartbeat transition"),
    operationReceiptDigest: D("second heartbeat operation"),
    transitionCounter: plan.evidence.targetCloudAuthority.transitionCounter + 1,
    heartbeatCounter: plan.evidence.targetCloudAuthority.heartbeatCounter + 1,
    expiresAt: "2026-08-28T00:00:00.000Z",
  } : null;
  const registryRoot = mkdtempSync(path.join(os.tmpdir(), "planned-dirty-registry-"));
  const registryPath = path.join(registryRoot, "writer-leases.json");
  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
  const leaseStore = {
    statePath: mutableRegistry ? registryPath : null,
    readRegistry: () => mutableRegistry
      ? JSON.parse(readFileSync(registryPath, "utf8"))
      : registry,
    ...(mutableRegistry ? { withRegistryLock: action => {
      registryCasCalls += 1;
      const result = action(JSON.parse(readFileSync(registryPath, "utf8")));
      registry = JSON.parse(readFileSync(registryPath, "utf8"));
      if (registryResponseLoss) {
        registryResponseLoss = false;
        throw new Error("simulated registry response loss");
      }
      return result;
    } } : {}),
  };
  const adapter = createPlannedDirtyAdmissionRecoveryRepositoryAdapter({
    repository: target.worktreePath, sessionId: target.sessionId,
  }, {
    realpath: value => path.resolve(value), controllerRoot: "/controller",
    git: repositoryGit(target, { originRepository }), leaseStore,
    captureDirt: () => plan.evidence.ownedDirt,
    captureController: () => ({ controller: plan.evidence.protectedController,
      protectedMainAdvance: plan.evidence.protectedMainAdvance }),
    gh: argumentsList => {
      if (argumentsList[1] === "edit") {
        markerMutations += 1;
        currentBody = argumentsList[argumentsList.indexOf("--body") + 1];
        if (loseMarkerResponse) { loseMarkerResponse = false;
          throw new Error("simulated marker response loss"); }
        return "";
      }
      assert.equal(argumentsList[1], "view");
      return JSON.stringify({ id: plan.evidence.pullRequest.id,
        number: plan.evidence.pullRequest.number,
        url: pullRequestUrl || target.pullRequestUrl,
        state: "OPEN", isDraft: true, autoMergeRequest: null,
        headRefName: target.branch, headRefOid: target.fenceSha,
        headRepository: { nameWithOwner: target.cloudAuthority.targetRepository },
        baseRefName: "main", baseRefOid: plan.evidence.pullRequest.baseSha,
        body: currentBody });
    },
    ...(oneAhead ? { inspectCloudStatus: () => cloudStatus(
      secondHeartbeatAuthority || plan.evidence.targetCloudAuthority,
      subject,
    ) } : {}),
    verifyCloud: ({ authority }) => ({ authority,
      verification: cloudVerification(subject, authority) }),
    assertMutationAuthority: ({ lease, allowPlanned = false }) => {
      mutationAdmissionStatuses.push(lease.admission.status);
      mutationAuthorityCalls.push(`${lease.admission.status}:${allowPlanned}`);
      return lease.admission.status === "planned" ? plannedReceipt : admittedReceipt;
    },
    now: () => new Date(OBSERVED),
  });
  return { adapter, plan, intent,
    plannedReceiptDigest: plannedReceipt.receiptDigest,
    admittedReceiptDigest, mutationAdmissionStatuses, mutationAuthorityCalls,
    registry: () => leaseStore.readRegistry(),
    registryCasCalls: () => registryCasCalls,
    markerMutations: () => markerMutations };
}

function repositoryGit(lease, options = {}) {
  const tree = "d".repeat(40);
  return argumentsList => {
    const command = argumentsList.join(" ");
    if (command === "branch --show-current") return lease.branch;
    if (command === "rev-parse --git-common-dir") return "/task/common";
    if (command === "worktree list --porcelain -z") return `worktree ${lease.worktreePath}\0HEAD ${lease.fenceSha}\0branch refs/heads/${lease.branch}\0`;
    if (command === "rev-parse HEAD") return lease.fenceSha;
    if (command === `rev-parse ${lease.fenceSha}^{tree}`) {
      return options.fenceTree || tree;
    }
    if (command === `rev-parse ${lease.baseSha}^{tree}`) return tree;
    if (command === `show -s --format=%P ${lease.fenceSha}`) {
      return options.fenceParent || lease.baseSha;
    }
    if (command === `diff --name-only --no-renames -z ${lease.baseSha} ${lease.fenceSha} --`) {
      return options.fencePaths || "";
    }
    if (command === `ls-remote --heads origin refs/heads/${lease.branch}`) {
      return `${lease.fenceSha}\trefs/heads/${lease.branch}`;
    }
    if (command === "remote get-url origin") {
      return `https://github.com/${options.originRepository
        || lease.cloudAuthority.targetRepository}.git`;
    }
    throw new Error(`Unexpected git call: ${command}`);
  };
}

function mutationReceipt(lease, label, evaluatedAt) {
  const authority = lease.cloudAuthority;
  const core = { schema: "agentic-admission-mutation-authority/v1", status: "ready",
    claimId: authority.claimId, claimDigest: authority.claimDigest,
    ledgerRevision: authority.ledgerRevision, localLeaseEpoch: lease.epoch,
    localFenceSha: lease.fenceSha, remoteLeaseEpoch: authority.leaseEpoch,
    cloudVerificationReceiptDigest: D(`${label} verification`),
    evaluatedAt, expiresAt: EXPIRES };
  return { ...core, receiptDigest: digestValue(core) };
}

function cloudVerification(subject, authority = null) {
  const claim = subject.claim;
  const current = authority || {
    claimDigest: claim.claimDigest,
    claimLedgerRevision: claim.claimLedgerRevision,
    operationReceiptDigest: claim.operationReceiptDigest,
    transitionCounter: claim.transitionCounter,
    heartbeatCounter: claim.heartbeatCounter,
    expiresAt: claim.expiresAt,
  };
  return { schema: subject.verificationSchema,
    receiptDigest: D("terminal cloud verification"), verifiedAt: OBSERVED,
    inventory: { claims: [{ claimId: claim.claimId,
      fenceRevision: current.claimDigest,
      transitionDigest: current.claimLedgerRevision,
      operationReceiptDigest: current.operationReceiptDigest,
      state: claim.state, transitionCounter: current.transitionCounter,
      heartbeatCounter: current.heartbeatCounter ?? claim.heartbeatCounter,
      leaseEpoch: claim.leaseEpoch,
      expiresAt: current.expiresAt, writeAuthority: claim.writeAuthority,
      scopeReserved: claim.scopeReserved, actorId: subject.owner.actorId,
      repositoryId: subject.owner.repositoryId, workItemId: subject.owner.workItemId,
      entrySchema: claim.entrySchema,
      claimIdentitySchema: claim.claimIdentitySchema,
      canonicalBaseRevision: subject.lane.canonicalBaseSha,
      laneRevision: subject.lane.laneRevision,
      reviewRequestId: subject.lane.reviewRequestId,
      writeSetDigest: subject.scope.writeSetDigest,
      declaredWriteScope: subject.scope.declaredWriteSet }] } };
}

function cloudStatus(authority, subject) {
  const claim = cloudVerification(subject, authority).inventory.claims[0];
  return { schema: "agentic-cloud-collaboration-result/v1", ok: true,
    action: "status", status: "ready", ledgerRevision: authority.ledgerRevision,
    ledgerDigest: authority.ledgerDigest, claims: [{ ...claim, state: "current",
      integrationReceiptDigest: authority.integrationReceiptDigest ?? null,
      integration: authority.integration ?? null }] };
}

export function controllerState(options = {}) {
  return { intent: null, calls: [], registryCalls: 0, registryMutations: 0,
    target: false, loseRegistryResponse: options.loseRegistryResponse === true,
    sourceError: options.sourceError || null };
}

export function fakeAdapter(state, plan) {
  return {
    readEvidence: async () => { throw new Error("not used"); },
    withOperationLock: async (_plan, action) => action(),
    readIntent: async () => state.intent,
    writeIntent: async ({ expected, next }) => {
      assert.equal(expected?.intentDigest ?? null, state.intent?.intentDigest ?? null);
      state.intent = next;
    },
    assertSource: async (_plan, stage) => {
      state.calls.push(`source:${stage}`);
      if (state.sourceError) throw new Error(state.sourceError);
      return true;
    },
    authorizeTask: async () => called(state, "task", {
      receiptDigest: D("task receipt"), proofDigest: D("task proof") }),
    projectRegistry: async () => {
      state.calls.push("registry"); state.registryCalls += 1;
      if (!state.target) { state.target = true; state.registryMutations += 1;
        if (state.loseRegistryResponse) { state.loseRegistryResponse = false;
          throw new Error("simulated response loss"); } }
      return { leaseDigest: D("target lease"), preservationReceiptDigest: D("preservation"),
        plannedMutationAuthorityReceiptDigest: D("planned mutation authority"),
        targetCloudAuthorityDigest: plan.evidence.targetCloudAuthorityDigest,
        heartbeatProjectionDigest: plan.evidence.heartbeatProjection.projectionDigest,
        adopted: state.registryCalls > 1 };
    },
    projectPullRequestMarker: async () => called(state, "marker", {
      markerDigest: D("marker"), bodyDigest: D("body"), receiptDigest: D("marker receipt"),
      adopted: false }),
    verifyTerminal: async ({ replay }) => called(state, replay ? "terminal-replay" : "terminal", {
      mutationAuthorityReceiptDigest: D("admitted mutation authority"),
      terminalEvidenceDigest: D("terminal evidence"), leaseDigest: D("target lease"),
      markerDigest: D("marker"), bodyDigest: D("body"),
      dirtDigest: plan.evidence.dirtDigest,
      cloudAuthoritySubjectDigest: plan.evidence.cloudAuthoritySubjectDigest,
      cloudVerificationReceiptDigest: D(replay ? "fresh replay" : "fresh first") }),
  };
}

function called(state, name, value) { state.calls.push(name); return value; }
