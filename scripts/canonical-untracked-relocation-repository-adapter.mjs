// Responsibility: Verify authority and atomically relocate one canonical untracked subtree.
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import {
  assertCanonicalUntrackedRelocationAuthorization, assertCanonicalUntrackedRelocationPlan,
  createCanonicalUntrackedRelocationPlan, createCanonicalUntrackedRelocationReceipt,
  deriveCanonicalUntrackedRelocationLayout,
} from "./canonical-untracked-relocation-contract.mjs";
import {
  applyCanonicalUntrackedRelocationTransaction, canonicalRelocationCommonParent,
  canonicalRelocationContentDigest, canonicalRelocationDirectoryState,
  normalizeCanonicalUntrackedRelocationEntries, preflightCanonicalUntrackedRecoveryManifest,
  prepareCanonicalUntrackedRelocationTransaction, readCanonicalUntrackedRelocationEffectIntent,
  readCanonicalUntrackedRelocationReceipt, readCanonicalUntrackedRelocationSourceIntent,
  requireCanonicalRelocationDirectoryExact, requireCanonicalUntrackedRelocationEffectDevices,
  requireCanonicalRelocationSameDevice, withCanonicalUntrackedRelocationLock,
  writeCanonicalUntrackedRelocationEffectIntent, writeCanonicalUntrackedRelocationReceipt,
} from "./canonical-untracked-relocation-transaction.mjs";
import {
  CANONICAL_UNTRACKED_RETENTION_CAPTURE_PROFILE,
  captureSourceEvidence,
  verifyLegacyRecoveryPackage,
} from "./legacy-dirty-lane-adoption-lib.mjs";
import { normalizeDeclaredWriteScopeManifest } from "./scoped-lane-admission-lib.mjs";
import { assertAdmissionMutationAuthority } from "./scoped-lane-admission-state.mjs";
import { verifyAdmissionCloudAuthority } from "./scoped-lane-cloud-authority.mjs";
import { withRecoverableGitMutationFence } from "./collaboration-gate.mjs";
import { authorizeTaskBoundLeaseMutation } from "./task-bound-lane-authority-store.mjs";
import { createWriterLeaseStore } from "./writer-lease-lib.mjs";
import { writerLeaseDigest } from "./writer-lease-registry-cas.mjs";
const MAX_MANIFEST_BYTES = 1024 * 1024;
export function planCanonicalUntrackedRelocation(input, dependencies = {}) { return inspectInitialState(input, dependencies).plan; }
export async function executeCanonicalUntrackedRelocation(input, dependencies = {}) {
  const plan = assertCanonicalUntrackedRelocationAuthorization(
    { plan: input.plan, authorization: input.authorization });
  const withIntent = dependencies.withRelocationMutationIntent;
  if (typeof withIntent !== "function") {
    throw new Error("Canonical-untracked relocation execution requires the two-sided registry mutation-intent owner.");
  }
  return withIntent({ plan, input,
    action: () => executeRelocationWithinIntent({ input, plan, dependencies }) });
}
function executeRelocationWithinIntent({ input, plan, dependencies }) {
  const source = realDirectory(plan.evidence.source.worktree, "source worktree");
  if (commonGitDirectory(source) !== plan.evidence.source.commonDirectory) {
    throw new Error("Canonical-untracked relocation source common directory drifted.");
  }
  return withCanonicalUntrackedRelocationLock({
    plan,
    now: () => now(dependencies),
    action: async () => executeLockedRelocation({ input, plan, dependencies }),
  });
}
function executeLockedRelocation({ input, plan, dependencies }) {
  const replay = inspectReplayState({ ...input, plan }, dependencies);
  const existingReceipt = readCanonicalUntrackedRelocationReceipt(plan);
  if (existingReceipt) {
    requireTerminalState({ plan, entries: replay.entries });
    return existingReceipt;
  }
  const priorEffect = readCanonicalUntrackedRelocationEffectIntent(plan);
  if (isTerminalState({ plan, entries: replay.entries })) {
    if (!priorEffect) throw new Error("Terminal relocation has no durable pre-effect authority intent.");
    if (priorEffect.sourceQuarantineAttempt?.planDigest !== plan.planDigest) {
      throw new Error("Terminal relocation must replay its original exact-authorized plan.");
    }
    requireTerminalState({ plan, entries: replay.entries });
    return publishReceipt({ plan, entries: replay.entries, effectIntent: priorEffect });
  }
  const replayTargetState = canonicalRelocationDirectoryState(
    replay.targetRoot, replay.entries, replay.subtree,
  );
  if (replayTargetState === "exact" && !priorEffect) {
    throw new Error("Partial relocation lacks its pre-effect attempt.");
  }
  if (canonicalRelocationDirectoryState(replay.sourceRoot, replay.entries, replay.subtree) === "absent"
    && priorEffect?.sourceQuarantineAttempt?.planDigest !== plan.planDigest) {
    throw new Error("Post-quarantine recovery must replay its original exact-authorized plan.");
  }
  inspectExecutionState({ ...input, plan }, dependencies);
  prepareCanonicalUntrackedRelocationTransaction({ plan, entries: replay.entries,
    recoveryDirectory: replay.recovery.recoveryDirectory });
  const inspected = inspectExecutionState({ ...input, plan }, dependencies);
  requireCanonicalUntrackedRelocationEffectDevices({ plan, entries: inspected.entries });
  return inspected.target.leaseStore.withRegistryLock(registry => withGitMutationFence(plan, () => {
    const revalidate = () => {
      assertLockedTargetAuthority({ registry, inspected, plan, evaluatedAt: now(dependencies) });
      assertCanonicalUntrackedRelocationLiveRepositoryState({ plan, entries: inspected.entries });
      requireCanonicalUntrackedRelocationEffectDevices({ plan, entries: inspected.entries });
    };
    revalidate();
    const targetInstalled = canonicalRelocationDirectoryState(
      inspected.targetRoot, inspected.entries, inspected.subtree,
    ) === "exact";
    if (targetInstalled && !priorEffect) throw new Error("Partial relocation lacks its pre-effect attempt.");
    let effectIntent = priorEffect;
    if (!targetInstalled) effectIntent = writeCanonicalUntrackedRelocationEffectIntent({
      plan, phase: "target-install",
      taskAuthorityReceiptDigest: inspected.taskAuthorityReceipt.receiptDigest,
      mutationAuthorityReceiptDigest: inspected.mutationAuthorityReceipt.receiptDigest,
      receiptTimestamp: now(dependencies).toISOString(),
      sourceQuarantineAttempt: priorEffect?.sourceQuarantineAttempt || null,
    });
    const applied = applyCanonicalUntrackedRelocationTransaction({ plan, entries: inspected.entries,
      recoveryDirectory: inspected.recovery.recoveryDirectory },
    { beforeSourceQuarantine: () => {
      revalidate();
      effectIntent = writeCanonicalUntrackedRelocationEffectIntent({
        plan, phase: "source-quarantine",
        taskAuthorityReceiptDigest: inspected.taskAuthorityReceipt.receiptDigest,
        mutationAuthorityReceiptDigest: inspected.mutationAuthorityReceipt.receiptDigest,
        receiptTimestamp: now(dependencies).toISOString(),
        targetInstallAttempt: effectIntent.targetInstallAttempt,
      });
    } });
    requireTerminalState({ plan, entries: inspected.entries });
    if (applied.contentDigest !== canonicalRelocationContentDigest(inspected.entries)) {
      throw new Error("Relocation transaction content digest drifted.");
    }
    return publishReceipt({ plan, entries: inspected.entries, effectIntent });
  }));
}

function publishReceipt({ plan, entries, effectIntent }) {
  if (!effectIntent?.targetInstallAttempt || !effectIntent?.sourceQuarantineAttempt) {
    throw new Error("Terminal relocation lacks exact per-effect authority lineage.");
  }
  const receipt = createCanonicalUntrackedRelocationReceipt({
    plan,
    taskAuthorityReceiptDigest: effectIntent.sourceQuarantineAttempt.taskAuthorityReceiptDigest,
    mutationAuthorityReceiptDigest: effectIntent.sourceQuarantineAttempt.mutationAuthorityReceiptDigest,
    targetInstallAttempt: effectIntent.targetInstallAttempt,
    sourceQuarantineAttempt: effectIntent.sourceQuarantineAttempt,
    targetInstalledDigest: canonicalRelocationContentDigest(entries),
    sourceQuarantineDigest: canonicalRelocationContentDigest(entries),
    completedAt: effectIntent.sourceQuarantineAttempt.authorizedAt,
  });
  return writeCanonicalUntrackedRelocationReceipt(plan, receipt);
}

function assertLockedTargetAuthority({ registry, inspected, plan, evaluatedAt }) {
  const lease = registry?.leases?.[plan.evidence.target.branch];
  const instant = evaluatedAt.getTime();
  if (!lease || writerLeaseDigest(lease) !== inspected.target.leaseDigest
    || writerLeaseDigest(lease) !== plan.evidence.target.leaseDigest
    || lease.sessionId !== plan.evidence.target.sessionId
    || lease.device !== plan.evidence.target.device || lease.scope !== plan.evidence.target.scope
    || path.resolve(lease.worktreePath) !== plan.evidence.target.worktree
    || lease.baseSha !== plan.evidence.target.baseSha
    || lease.fenceSha !== plan.evidence.target.fenceSha
    || lease.admission?.manifestDigest !== plan.evidence.target.manifestDigest
    || lease.taskAuthority?.authoritySubjectId !== plan.evidence.target.taskAuthoritySubjectId
    || lease.taskAuthority?.generation !== plan.evidence.target.taskAuthorityGeneration
    || lease.taskAuthority?.bindingDigest !== plan.evidence.target.taskAuthorityBindingDigest
    || Date.parse(lease.expiresAt) <= instant
    || Date.parse(lease.cloudAuthority?.expiresAt) <= instant) {
    throw new Error("Relocation target authority changed before filesystem effects.");
  }
}

export function assertCanonicalUntrackedRelocationLiveRepositoryState({ plan, entries }, dependencies = {}) {
  const normalized = assertCanonicalUntrackedRelocationPlan(plan);
  const { source, target, transaction } = normalized.evidence;
  const readGit = dependencies.gitText || gitText;
  const capture = dependencies.captureSourceEvidence || captureSourceEvidence;
  if (readGit(source.worktree, ["branch", "--show-current"]) !== "main"
    || readGit(source.worktree, ["rev-parse", "HEAD"]) !== source.headSha
    || readGit(source.worktree, ["rev-parse", "HEAD^{tree}"]) !== source.treeSha
    || readGit(source.worktree, ["rev-parse", "refs/remotes/origin/main"]) !== source.headSha
    || readGit(target.worktree, ["branch", "--show-current"]) !== target.branch
    || readGit(target.worktree, ["rev-parse", "HEAD"]) !== target.headSha
    || readGit(target.worktree, ["rev-parse", "HEAD^{tree}"]) !== target.treeSha) {
    throw new Error("Relocation repository refs changed before filesystem effects.");
  }
  const sourceRoot = path.join(source.worktree, source.subtree);
  const targetRoot = path.join(target.worktree, source.subtree);
  const sourceState = canonicalRelocationDirectoryState(sourceRoot, entries, source.subtree);
  const quarantineState = canonicalRelocationDirectoryState(
    transaction.quarantinePath, entries, source.subtree,
  );
  if (sourceState === "exact" && quarantineState === "absent") {
    requireCanonicalRelocationDirectoryExact(sourceRoot, entries, source.subtree, "locked canonical source");
  } else if (sourceState !== "absent" || quarantineState !== "exact") {
    throw new Error("Relocation source and quarantine changed before filesystem effects.");
  }
  const liveSource = capture(source.worktree);
  if (liveSource.branch !== "main" || liveSource.headSha !== source.headSha
    || liveSource.trackedPaths.length !== 0
    || JSON.stringify(liveSource.untrackedPaths) !== JSON.stringify(
      sourceState === "exact" ? entries.map(entry => entry.path) : [],
    ) || (sourceState === "exact" && (
      liveSource.stateDigest !== source.stateDigest
      || liveSource.writeSetDigest !== source.writeSetDigest
    ))) {
    throw new Error("Canonical source changed before filesystem effects.");
  }
  const targetState = canonicalRelocationDirectoryState(targetRoot, entries, source.subtree);
  const expectedTargetPaths = targetState === "absent" ? [] : targetState === "exact"
    ? entries.map(entry => entry.path) : null;
  const liveTarget = capture(target.worktree);
  if (!expectedTargetPaths || liveTarget.branch !== target.branch
    || liveTarget.headSha !== target.headSha || liveTarget.trackedPaths.length !== 0
    || JSON.stringify(liveTarget.untrackedPaths) !== JSON.stringify(expectedTargetPaths)) {
    throw new Error("Relocation target or quarantine changed before filesystem effects.");
  }
}

function inspectInitialState(input, dependencies) {
  const base = inspectSharedState(input, dependencies);
  requireSourceExact(base);
  const targetState = canonicalRelocationDirectoryState(base.targetRoot, base.entries, base.subtree);
  if (targetState !== "absent" && targetState !== "exact") {
    throw new Error("Canonical-untracked relocation target subtree is ambiguous when planned.");
  }
  const targetEvidence = captureSourceEvidence(base.target.worktree);
  const expectedTargetPaths = targetState === "exact" ? base.entries.map(entry => entry.path) : [];
  if (targetEvidence.trackedPaths.length
    || JSON.stringify(targetEvidence.untrackedPaths) !== JSON.stringify(expectedTargetPaths)) {
    throw new Error("Canonical-untracked relocation target contains unrelated dirt when planned.");
  }
  requireCanonicalRelocationSameDevice([
    path.dirname(base.sourceRoot),
    path.dirname(base.targetRoot),
    base.recovery.recoveryDirectory,
  ]);
  const source = Object.freeze({
      worktree: base.source, commonDirectory: base.commonDirectory,
      headSha: base.sourceHead, treeSha: base.sourceTree, branch: "main", subtree: base.subtree,
      stateDigest: base.recovery.stateDigest, writeSetDigest: base.recovery.writeSetDigest,
    });
  const recovery = Object.freeze({
      directory: base.recovery.recoveryDirectory, packageDigest: base.recovery.packageDigest,
      captureProfile: base.recovery.captureProfile,
      paths: base.entries.map(entry => entry.path),
    });
  const target = Object.freeze({
      worktree: base.target.worktree, branch: base.target.lease.branch,
      headSha: base.target.headSha, treeSha: base.target.treeSha,
      baseSha: base.target.lease.baseSha, fenceSha: base.target.lease.fenceSha,
      leaseDigest: base.target.leaseDigest, leaseEpoch: base.target.lease.epoch,
      sessionId: base.target.lease.sessionId,
      device: base.target.lease.device, scope: base.target.lease.scope,
      manifestDigest: base.target.manifest.manifestDigest, writeSetDigest: base.target.manifest.writeSetDigest,
      cloudClaimId: base.target.lease.cloudAuthority.claimId, cloudClaimDigest: base.target.lease.cloudAuthority.claimDigest,
      taskAuthoritySubjectId: base.taskAuthorityReceipt.authoritySubjectId, taskAuthorityGeneration: base.taskAuthorityReceipt.generation,
      taskAuthorityBindingDigest: base.taskAuthorityReceipt.bindingDigest,
    });
  const layout = deriveCanonicalUntrackedRelocationLayout(
    { source, recovery, target, receiptPath: input.receiptPath });
  if (existsSync(layout.receiptPath)) throw new Error("Canonical-untracked relocation receipt already exists.");
  const plan = createCanonicalUntrackedRelocationPlan({
    source,
    recovery,
    target,
    transaction: {
      stagePath: layout.stagePath,
      quarantinePath: layout.quarantinePath,
      receiptPath: layout.receiptPath,
      sameFilesystem: true,
    },
  });
  const quarantineState = canonicalRelocationDirectoryState(
    plan.evidence.transaction.quarantinePath,
    base.entries,
    base.subtree,
  );
  if (quarantineState !== "absent") {
    throw new Error("Canonical-untracked relocation quarantine is not empty while the source remains.");
  }
  if (targetState === "exact") {
    if (!readCanonicalUntrackedRelocationSourceIntent(plan)
      || !readCanonicalUntrackedRelocationEffectIntent(plan)) {
      throw new Error("Installed relocation target lacks its durable partial-transaction intent.");
    }
  }
  return { ...base, plan };
}

function inspectExecutionState(input, dependencies) {
  const plan = assertCanonicalUntrackedRelocationPlan(input.plan);
  const base = inspectSharedState({
    ...input,
    source: plan.evidence.source.worktree,
    target: plan.evidence.target.worktree,
    recovery: plan.evidence.recovery.directory,
    receiptPath: plan.evidence.transaction.receiptPath,
  }, dependencies);
  requirePlanBindings(plan, base);
  const sourceState = canonicalRelocationDirectoryState(base.sourceRoot, base.entries, base.subtree);
  const targetState = canonicalRelocationDirectoryState(base.targetRoot, base.entries, base.subtree);
  const quarantineState = canonicalRelocationDirectoryState(
    plan.evidence.transaction.quarantinePath,
    base.entries,
    base.subtree,
  );
  if (sourceState === "exact") requireSourceExact(base);
  else if (sourceState !== "absent" || !["absent", "exact"].includes(targetState)
    || quarantineState !== "exact") {
    throw new Error("Canonical source drifted without a complete relocation quarantine.");
  }
  return base;
}

function inspectReplayState(input, dependencies) {
  const plan = assertCanonicalUntrackedRelocationPlan(input.plan);
  const base = inspectStaticState({
    ...input,
    source: plan.evidence.source.worktree,
    target: plan.evidence.target.worktree,
    recovery: plan.evidence.recovery.directory,
  }, dependencies);
  requireStaticPlanBindings(plan, base);
  const sourceState = canonicalRelocationDirectoryState(base.sourceRoot, base.entries, base.subtree);
  if (sourceState === "exact") requireSourceExact(base);
  else if (sourceState !== "absent"
    || canonicalRelocationDirectoryState(plan.evidence.transaction.quarantinePath,
      base.entries, base.subtree) !== "exact"
    || !["absent", "exact"].includes(canonicalRelocationDirectoryState(
      base.targetRoot, base.entries, base.subtree,
    ))) {
    throw new Error("Canonical source drifted without a complete relocation quarantine.");
  }
  return base;
}

function inspectSharedState(input, dependencies) {
  const base = inspectStaticState(input, dependencies);
  const targetAuthority = dependencies.inspectTargetAuthority || inspectTargetAuthority;
  const targetResult = targetAuthority({
    target: base.target.worktree,
    commonDirectory: base.commonDirectory,
    sessionId: input.sessionId,
    taskAuthorityFile: input.taskAuthorityFile,
    writeScopeManifestPath: input.writeScopeManifestPath,
    recoveryPaths: base.entries.map(entry => entry.path),
    now: now(dependencies),
  });
  if (targetResult.lease.baseSha !== base.sourceHead || targetResult.treeSha !== base.sourceTree) {
    throw new Error("Admitted target does not preserve the captured canonical base tree.");
  }
  return {
    ...base,
    target: targetResult,
    taskAuthorityReceipt: targetResult.taskAuthorityReceipt,
    mutationAuthorityReceipt: targetResult.mutationAuthorityReceipt,
  };
}

function inspectStaticState(input, dependencies) {
  const source = realDirectory(input.source, "source worktree");
  const target = realDirectory(input.target, "target worktree");
  const recoveryDirectory = realDirectory(input.recovery, "recovery directory");
  preflightCanonicalUntrackedRecoveryManifest(recoveryDirectory);
  const verifyRecovery = dependencies.verifyRecoveryPackage || verifyLegacyRecoveryPackage;
  const recovery = verifyRecovery({ recoveryDirectory });
  if (recovery.captureProfile !== CANONICAL_UNTRACKED_RETENTION_CAPTURE_PROFILE) {
    throw new Error("Relocation requires a canonical-untracked-retention package.");
  }
  if (path.resolve(recovery.sourceWorktree) !== source || recovery.sourceBranch !== "main"
    || recovery.sourceHeadSha !== recovery.protectedTipSha) {
    throw new Error("Canonical recovery source identity is invalid.");
  }
  if (recovery.operatorSessionId !== String(input.sessionId || "")) {
    throw new Error("Canonical recovery operator session changed.");
  }
  if (recovery.tracked.length !== 0 || recovery.untracked.length === 0) {
    throw new Error("Canonical relocation supports only non-empty untracked regular files.");
  }
  const entries = normalizeCanonicalUntrackedRelocationEntries(recovery.untracked, recoveryDirectory);
  const subtree = canonicalRelocationCommonParent(entries.map(entry => entry.path));
  const sourceRoot = path.join(source, subtree);
  const targetRoot = path.join(target, subtree);
  const commonDirectory = commonGitDirectory(source);
  if (commonGitDirectory(target) !== commonDirectory) {
    throw new Error("Canonical source and admitted target must share one Git common directory.");
  }
  requireRegisteredWorktrees({ source, target, commonDirectory });
  const sourceHead = gitText(source, ["rev-parse", "HEAD"]);
  const sourceTree = gitText(source, ["rev-parse", "HEAD^{tree}"]);
  if (gitText(source, ["branch", "--show-current"]) !== "main"
    || sourceHead !== recovery.sourceHeadSha
    || gitText(source, ["rev-parse", "refs/remotes/origin/main"]) !== recovery.protectedTipSha) {
    throw new Error("Canonical main is not exact its captured, fetched protected tip.");
  }
  const targetBranch = gitText(target, ["branch", "--show-current"]);
  const targetHead = gitText(target, ["rev-parse", "HEAD"]);
  const targetTree = gitText(target, ["rev-parse", "HEAD^{tree}"]);
  if (!targetBranch.startsWith("agent/") || targetTree !== sourceTree) {
    throw new Error("Relocation target branch or base tree drifted.");
  }
  requireCanonicalRelocationSameDevice([
    path.dirname(sourceRoot),
    path.dirname(targetRoot),
    recoveryDirectory,
  ]);
  return {
    source, targetRoot, sourceRoot, subtree, entries, recovery, commonDirectory,
    sourceHead, sourceTree,
    target: Object.freeze({
      worktree: target,
      branch: targetBranch,
      headSha: targetHead,
      treeSha: targetTree,
    }),
  };
}

function inspectTargetAuthority({
  target,
  commonDirectory,
  sessionId,
  taskAuthorityFile,
  writeScopeManifestPath,
  recoveryPaths,
  now: evaluatedAt,
}) {
  const branch = gitText(target, ["branch", "--show-current"]);
  if (!branch.startsWith("agent/")) throw new Error("Relocation target must be a semantic task branch.");
  const manifest = normalizeDeclaredWriteScopeManifest(
    readJsonBounded(writeScopeManifestPath, "write-scope manifest"),
    { expectedScope: branch.split("/").at(-1) },
  );
  if (!recoveryPaths.every(relativePath => manifestOwnsPath(manifest, relativePath))) {
    throw new Error("Admitted target manifest does not own every recovery path.");
  }
  const leaseStore = createWriterLeaseStore({ gitCommonDir: commonDirectory });
  const lease = leaseStore.verify({ sessionId, branch });
  const leaseDigest = writerLeaseDigest(lease);
  if (path.resolve(lease.worktreePath) !== target || lease.admission?.status !== "admitted"
    || lease.admission.manifestDigest !== manifest.manifestDigest
    || lease.admission.writeSetDigest !== manifest.writeSetDigest) {
    throw new Error("Relocation target lease is not the exact admitted manifest owner.");
  }
  const headSha = gitText(target, ["rev-parse", "HEAD"]);
  const treeSha = gitText(target, ["rev-parse", "HEAD^{tree}"]);
  if (headSha !== lease.fenceSha || treeSha !== gitText(target, ["rev-parse", `${lease.baseSha}^{tree}`])) {
    throw new Error("Relocation target HEAD or base tree drifted from its lease fence.");
  }
  const taskAuthorityReceipt = authorizeTaskBoundLeaseMutation({
    lease,
    capabilityPath: path.resolve(String(taskAuthorityFile || "")),
    operation: "canonical-untracked-relocation",
    now: evaluatedAt,
  });
  const verified = verifyAdmissionCloudAuthority({
    authority: lease.cloudAuthority,
    manifest,
    canonicalBaseSha: lease.baseSha,
  });
  const mutationAuthorityReceipt = assertAdmissionMutationAuthority({
    lease,
    cloudAuthority: verified.authority,
    remoteAuthorityVerification: verified.verification,
  });
  return Object.freeze({
    worktree: target, branch, lease, leaseDigest, manifest, headSha, treeSha,
    taskAuthorityReceipt, mutationAuthorityReceipt, leaseStore,
  });
}

function requireSourceExact(base) {
  const evidence = captureSourceEvidence(base.source);
  if (evidence.branch !== "main" || evidence.headSha !== base.recovery.sourceHeadSha
    || evidence.stateDigest !== base.recovery.stateDigest
    || evidence.writeSetDigest !== base.recovery.writeSetDigest
    || evidence.trackedPaths.length !== 0
    || JSON.stringify(evidence.untrackedPaths) !== JSON.stringify(base.entries.map(entry => entry.path))) {
    throw new Error("Canonical source bytes drifted from the verified recovery package.");
  }
  requireCanonicalRelocationDirectoryExact(base.sourceRoot, base.entries, base.subtree, "canonical source");
}

function requirePlanBindings(plan, base) {
  requireStaticPlanBindings(plan, base);
  const evidence = plan.evidence;
  if (evidence.target.leaseDigest !== base.target.leaseDigest
    || evidence.target.leaseEpoch !== base.target.lease.epoch
    || evidence.target.sessionId !== base.target.lease.sessionId
    || evidence.target.device !== base.target.lease.device
    || evidence.target.scope !== base.target.lease.scope
    || evidence.target.baseSha !== base.target.lease.baseSha
    || evidence.target.fenceSha !== base.target.lease.fenceSha
    || evidence.target.manifestDigest !== base.target.manifest.manifestDigest
    || evidence.target.writeSetDigest !== base.target.manifest.writeSetDigest
    || evidence.target.cloudClaimId !== base.target.lease.cloudAuthority.claimId
    || evidence.target.cloudClaimDigest !== base.target.lease.cloudAuthority.claimDigest
    || evidence.target.taskAuthoritySubjectId !== base.taskAuthorityReceipt.authoritySubjectId
    || evidence.target.taskAuthorityGeneration !== base.taskAuthorityReceipt.generation
    || evidence.target.taskAuthorityBindingDigest !== base.taskAuthorityReceipt.bindingDigest) {
    throw new Error("Canonical-untracked relocation plan bindings drifted.");
  }
}

function requireStaticPlanBindings(plan, base) {
  const evidence = plan.evidence;
  if (evidence.recovery.directory !== base.recovery.recoveryDirectory
    || evidence.recovery.packageDigest !== base.recovery.packageDigest
    || evidence.recovery.captureProfile !== base.recovery.captureProfile
    || JSON.stringify(evidence.recovery.paths) !== JSON.stringify(base.entries.map(entry => entry.path))
    || evidence.source.worktree !== base.source
    || evidence.source.commonDirectory !== base.commonDirectory
    || evidence.source.headSha !== base.sourceHead
    || evidence.source.treeSha !== base.sourceTree
    || evidence.source.subtree !== base.subtree
    || evidence.source.stateDigest !== base.recovery.stateDigest
    || evidence.source.writeSetDigest !== base.recovery.writeSetDigest
    || evidence.target.worktree !== base.target.worktree
    || evidence.target.branch !== base.target.branch
    || evidence.target.headSha !== base.target.headSha
    || evidence.target.treeSha !== base.target.treeSha) {
    throw new Error("Canonical-untracked relocation static plan bindings drifted.");
  }
}

function requireTerminalState({ plan, entries }) {
  const evidence = plan.evidence;
  const sourceRoot = path.join(evidence.source.worktree, evidence.source.subtree);
  const targetRoot = path.join(evidence.target.worktree, evidence.source.subtree);
  if (existsSync(sourceRoot)) throw new Error("Relocation terminal source subtree is not absent.");
  requireCanonicalRelocationDirectoryExact(targetRoot, entries, evidence.source.subtree, "terminal target");
  requireCanonicalRelocationDirectoryExact(evidence.transaction.quarantinePath, entries, evidence.source.subtree,
    "terminal quarantine");
  if (gitText(evidence.source.worktree, ["rev-parse", "HEAD"]) !== evidence.source.headSha
    || gitText(evidence.target.worktree, ["rev-parse", "HEAD"]) !== evidence.target.headSha) {
    throw new Error("Relocation changed a Git ref or HEAD.");
  }
  const source = captureSourceEvidence(evidence.source.worktree);
  if (source.trackedPaths.length !== 0 || source.untrackedPaths.length !== 0) {
    throw new Error("Canonical source is not clean after relocation.");
  }
  const target = captureSourceEvidence(evidence.target.worktree);
  if (target.trackedPaths.length !== 0
    || JSON.stringify(target.untrackedPaths) !== JSON.stringify(entries.map(entry => entry.path))) {
    throw new Error("Relocation target contains bytes outside the sealed recovery set.");
  }
}

function isTerminalState({ plan, entries }) {
  const evidence = plan.evidence;
  return canonicalRelocationDirectoryState(
    path.join(evidence.source.worktree, evidence.source.subtree),
    entries,
    evidence.source.subtree,
  ) === "absent"
    && canonicalRelocationDirectoryState(
      path.join(evidence.target.worktree, evidence.source.subtree),
      entries,
      evidence.source.subtree,
    ) === "exact"
    && canonicalRelocationDirectoryState(
      evidence.transaction.quarantinePath,
      entries,
      evidence.source.subtree,
    ) === "exact";
}

function manifestOwnsPath(manifest, relativePath) {
  return manifest.declaredWriteSet.some(item => item.startsWith("path:") && (
    relativePath === item.slice(5) || relativePath.startsWith(`${item.slice(5)}/`)
  ));
}

function requireRegisteredWorktrees({ source, target, commonDirectory }) {
  const output = execFileSync("git", ["worktree", "list", "--porcelain", "-z"], {
    cwd: source, encoding: "utf8", maxBuffer: 4 * 1024 * 1024,
  });
  const registered = output.split("\0").filter(line => line.startsWith("worktree "))
    .map(line => path.resolve(line.slice("worktree ".length)));
  if (!registered.includes(source) || !registered.includes(target)
    || commonGitDirectory(source) !== commonDirectory) {
    throw new Error("Canonical source or relocation target is not one registered worktree.");
  }
}

function commonGitDirectory(worktree) { return path.resolve(worktree, gitText(worktree, ["rev-parse", "--git-common-dir"])); }
export function withGitMutationFence(plan, action) { return withRecoverableGitMutationFence({ plan, action }); }
function gitText(worktree, args) {
  return execFileSync("git", args, {
    cwd: worktree, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
  }).trim();
}
function readJsonBounded(file, label) {
  const target = path.resolve(String(file || ""));
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_MANIFEST_BYTES) {
    throw new Error(`${label} must be a bounded regular file.`);
  }
  return JSON.parse(readFileSync(target, "utf8"));
}
function realDirectory(value, label) {
  const target = path.resolve(String(value || ""));
  if (!path.isAbsolute(String(value || "")) || !lstatSync(target).isDirectory()) {
    throw new Error(`${label} must be an absolute directory.`);
  }
  return realpathSync(target);
}

function now(dependencies) { return dependencies.now ? dependencies.now() : new Date(); }
