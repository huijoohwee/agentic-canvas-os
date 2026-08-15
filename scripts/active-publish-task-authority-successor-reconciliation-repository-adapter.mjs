// Responsibility: Join Git, provider, cloud, capability, and writer-registry facts for one PR successor.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import { continueActivePublishTaskAuthoritySuccessor } from "./active-publish-task-authority-successor.mjs";
import { authorizeTaskBoundLeaseMutation } from "./task-bound-lane-authority-store.mjs";
import { createWriterLeaseStore } from "./writer-lease-lib.mjs";
import { writerLeaseDigest } from "./writer-lease-registry-cas.mjs";
import {
  buildReconciliationEvidence,
  reconciliationEvidenceReplaySubjectDigest,
} from "./active-publish-task-authority-successor-reconciliation-evidence.mjs";
import { inspectExactSuccessor } from "./active-publish-task-authority-successor-reconciliation-cloud-adapter.mjs";
import { createReconciliationStore, journalOperationId } from "./active-publish-task-authority-successor-reconciliation-store.mjs";

export function createActivePublishTaskAuthoritySuccessorReconciliationRepositoryAdapter(options, dependencies = {}) {
  const repository = (dependencies.realpath || realpathSync)(path.resolve(required(options.repository, "repository")));
  const pullRequestNumber = positive(options.pullRequestNumber, "pull request");
  const taskAuthorityFile = options.taskAuthorityFile ? path.resolve(options.taskAuthorityFile) : null;
  const execute = dependencies.execute || ((command, args) => execFileSync(command, args, { cwd: repository, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }));
  const git = dependencies.git || (args => String(execute("git", args)).trim());
  const gitRaw = dependencies.gitRaw || (args => String(execute("git", args)));
  const gh = dependencies.gh || (args => String(execute("gh", args)).trim());
  const now = dependencies.now || (() => new Date());
  const branch = required(git(["branch", "--show-current"]), "attached branch");
  const gitCommonDir = (dependencies.realpath || realpathSync)(path.resolve(repository, git(["rev-parse", "--git-common-dir"])));
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({ gitCommonDir, taskAuthorityPolicy: "projected" });
  const journal = dependencies.journal || createReconciliationStore({ gitCommonDir, leaseStore, branch, operationId: journalOperationId({ branch, pullRequestNumber }) });
  const inspectCloud = dependencies.inspectCloud || inspectExactSuccessor;
  const authorize = dependencies.authorize || authorizeTaskBoundLeaseMutation;

  function requireOwnedLease(lease, projected = false) {
    const hasSuccessor = Object.hasOwn(lease || {}, "activePublishTaskAuthoritySuccessor");
    if (!lease || lease.status !== "active" || lease.admission?.status !== "admitted" || lease.branch !== branch || lease.sessionId !== options.sessionId || path.resolve(lease.worktreePath || "") !== repository || lease.pullRequestUrl?.split("/").at(-1) !== String(pullRequestNumber) || !lease.taskAuthority || !lease.cloudAuthority || (projected ? !lease.activePublishTaskAuthoritySuccessor : hasSuccessor)) throw new Error(`Exact ${projected ? "projected" : "unreconciled"} active-publish successor lease is unavailable.`);
    return lease;
  }
  function currentLease() { return requireOwnedLease(leaseStore.read(branch)); }
  function provider() { return JSON.parse(gh(["pr", "view", String(pullRequestNumber), "--json", "number,id,url,state,isDraft,autoMergeRequest,headRefName,headRefOid,baseRefName"])); }
  function observeFrame(lease) {
    if (git(["status", "--porcelain=v2", "--untracked-files=all"])) throw new Error("Successor worktree must be clean.");
    const head = git(["rev-parse", "HEAD"]);
    const remote = git(["rev-parse", `refs/remotes/origin/${branch}`]);
    const review = provider();
    if (head !== lease.fenceSha || remote !== head || review.headRefOid !== head || review.headRefName !== branch || review.url !== lease.pullRequestUrl || review.state !== "OPEN" || review.isDraft !== true || review.autoMergeRequest !== null) throw new Error("Successor Git or draft pull-request frame changed.");
    const recovery = lease.activeOwnedDirtRecovery;
    if (!recovery || recovery.status !== "recovered" || recovery.sourceClaimId === lease.cloudAuthority.claimId || recovery.sourceFenceSha === lease.fenceSha) throw new Error("Exact predecessor recovery evidence is unavailable.");
    const sourceBaseSha = git(["rev-parse", `${recovery.sourceFenceSha}^`]);
    if (git(["rev-parse", `${sourceBaseSha}^{tree}`]) !== git(["rev-parse", `${recovery.sourceFenceSha}^{tree}`])) throw new Error("Predecessor fence is not an empty exact projection.");
    const protectedRevision = git(["rev-parse", "refs/remotes/origin/main"]);
    git(["merge-base", "--is-ancestor", sourceBaseSha, protectedRevision]);
    const changedPaths = nulPaths(gitRaw(["--no-replace-objects", "diff", "--no-ext-diff", "--no-renames", "--name-only", "-z", sourceBaseSha, protectedRevision, "--"]));
    const ownedPaths = new Set(lease.admission.declaredWriteSet.filter(item => item.startsWith("path:")).map(item => item.slice(5)));
    if (changedPaths.some(changed => [...ownedPaths].some(owned => owned === "." || changed === owned || changed.startsWith(`${owned}/`) || owned.startsWith(`${changed}/`)))) throw new Error("Protected-main advance overlaps the successor write authority.");
    const cloud = inspectCloud({ authority: lease.cloudAuthority, sourceClaimId: recovery.sourceClaimId });
    return { lease, review, recovery, sourceBaseSha, protectedRevision, changedPaths, cloud };
  }
  function assertFrame() {
    const frame = observeFrame(currentLease());
    const sourceLease = { ...frame.lease, baseSha: frame.sourceBaseSha, fenceSha: frame.recovery.sourceFenceSha, cloudAuthority: { ...frame.lease.cloudAuthority, claimId: frame.recovery.sourceClaimId, canonicalBaseSha: frame.sourceBaseSha, laneRevision: frame.recovery.sourceFenceSha, leaseEpoch: frame.lease.cloudAuthority.leaseEpoch - 1 } };
    delete sourceLease.activePublishTaskAuthoritySuccessor;
    return { ...frame, sourceLease };
  }
  function evidenceFromFrame(frame) {
    return buildReconciliationEvidence({ observedAt: now().toISOString(), repository, branch, sessionId: frame.lease.sessionId, pullRequest: frame.review, canonical: { protectedRevision: frame.protectedRevision, sourceBaseSha: frame.sourceBaseSha, changedPaths: frame.changedPaths, changedPathsDigest: digestValue(frame.changedPaths) }, source: { claimId: frame.sourceLease.cloudAuthority.claimId, baseSha: frame.sourceBaseSha, fenceSha: frame.sourceLease.fenceSha, bindingDigest: frame.sourceLease.taskAuthority.bindingDigest, laneBindingDigest: frame.sourceLease.taskAuthority.laneBindingDigest, leaseEpoch: frame.sourceLease.cloudAuthority.leaseEpoch }, target: { claimId: frame.lease.cloudAuthority.claimId, baseSha: frame.lease.baseSha, fenceSha: frame.lease.fenceSha, operationReceiptDigest: frame.lease.cloudAuthority.operationReceiptDigest, verificationReceiptDigest: frame.lease.admission.admissionReceiptDigest, leaseEpoch: frame.lease.cloudAuthority.leaseEpoch, predecessorClaimId: frame.sourceLease.cloudAuthority.claimId, cloudState: frame.cloud.state }, leaseDigest: writerLeaseDigest(frame.lease) });
  }
  function capturePair() {
    const first = evidenceFromFrame(assertFrame());
    const frame = assertFrame();
    const second = evidenceFromFrame(frame);
    if (reconciliationEvidenceReplaySubjectDigest(first) !== reconciliationEvidenceReplaySubjectDigest(second)) throw new Error("Reconciliation evidence changed during capture.");
    return { evidence: second, frame };
  }
  function captureEvidence() { return capturePair().evidence; }
  function requirePlan(plan) { const current = capturePair(); if (reconciliationEvidenceReplaySubjectDigest(current.evidence) !== reconciliationEvidenceReplaySubjectDigest(plan.evidence)) throw new Error("Sealed reconciliation evidence changed."); return current.frame; }
  function authorizeTask(plan, operation) { const frame = requirePlan(plan); if (!taskAuthorityFile) throw new Error("Task capability is required for run."); return authorize({ lease: frame.sourceLease, capabilityPath: taskAuthorityFile, operation, now: now() }); }
  function projectionFromFrame(frame, boundAt) { const projected = continueActivePublishTaskAuthoritySuccessor({ sourceLease: frame.sourceLease, targetLease: frame.lease, cloudOperationReceiptDigest: frame.lease.cloudAuthority.operationReceiptDigest, cloudVerificationReceiptDigest: frame.lease.admission.admissionReceiptDigest, boundAt }); return Object.freeze({ sourceLeaseDigest: writerLeaseDigest(frame.sourceLease), expectedLeaseDigest: writerLeaseDigest(frame.lease), expectedClaimId: frame.lease.cloudAuthority.claimId, priorTaskAuthority: frame.sourceLease.taskAuthority, binding: projected.binding, receipt: projected.receipt }); }
  function prepareProjection(plan) { return projectionFromFrame(requirePlan(plan), now().toISOString()); }
  function requirePreparedProjection(plan, projection, frame) {
    if (projection.expectedLeaseDigest !== plan.evidence.leaseDigest || projection.expectedClaimId !== plan.evidence.target.claimId) throw new Error("Prepared successor projection changed its sealed plan subject.");
    if (reconciliationEvidenceReplaySubjectDigest(evidenceFromFrame(frame)) !== reconciliationEvidenceReplaySubjectDigest(plan.evidence)) throw new Error("Sealed reconciliation evidence changed.");
    const expected = projectionFromFrame(frame, projection.binding?.boundAt);
    if (canonicalJson(expected) !== canonicalJson(preparedProjection(projection, frame.sourceLease.taskAuthority))) throw new Error("Prepared successor projection changed before registry CAS.");
  }
  function projectRegistry(plan, projection) {
    const adopted = adoptProjected(plan, projection);
    if (adopted) return adopted;
    let frame = requirePlan(plan);
    requirePreparedProjection(plan, projection, frame);
    authorize({ lease: frame.sourceLease, capabilityPath: taskAuthorityFile, operation: `active-publish-task-authority-successor-reconciliation:${plan.planDigest}:registry`, now: now() });
    frame = requirePlan(plan);
    requirePreparedProjection(plan, projection, frame);
    const result = journal.project({ expectedLeaseDigest: projection.expectedLeaseDigest, expectedClaimId: projection.expectedClaimId, binding: projection.binding, receipt: projection.receipt });
    return projectedResult(projection, result.lease, result.registryRevision);
  }
  function adoptProjected(plan, projection) {
    if (projection.expectedLeaseDigest !== plan.evidence.leaseDigest || projection.expectedClaimId !== plan.evidence.target.claimId) throw new Error("Prepared successor projection changed its sealed plan subject.");
    if (typeof leaseStore.withRegistryLock !== "function") throw new Error("Response-loss adoption requires the writer-registry lock.");
    const first = lockedProjectedSnapshot();
    if (!first) return null;
    if (!projection.priorTaskAuthority) throw new Error("Legacy v1 registry response loss cannot reconstruct its exact predecessor binding.");
    const restored = restorePriorLease(first.lease, projection);
    const firstFrame = frameFromLease(restored);
    requirePreparedProjection(plan, projection, firstFrame);
    const secondFrame = frameFromLease(restored);
    requirePreparedProjection(plan, projection, secondFrame);
    const second = lockedProjectedSnapshot(true);
    if (canonicalJson(second.lease) !== canonicalJson(first.lease)) throw new Error("Projected successor branch changed during response-loss adoption.");
    return projectedResult(projection, second.lease, second.registryRevision);
  }
  function lockedProjectedSnapshot(required = false) {
    return leaseStore.withRegistryLock(registry => {
      if (registry?.schema !== "agentic-writer-lease-registry/v2" || !Number.isSafeInteger(registry.revision) || registry.revision < 0 || !registry.leases || typeof registry.leases !== "object") throw new Error("Writer-lease registry is invalid during response-loss adoption.");
      const lease = registry.leases[branch] || null;
      if (!lease?.activePublishTaskAuthoritySuccessor) { if (required) throw new Error("Terminal successor binding projection is absent."); return null; }
      requireOwnedLease(lease, true);
      return { lease: structuredClone(lease), registryRevision: registry.revision };
    });
  }
  function restorePriorLease(lease, projection) { const restored = { ...lease, taskAuthority: projection.priorTaskAuthority }; delete restored.activePublishTaskAuthoritySuccessor; if (writerLeaseDigest(restored) !== projection.expectedLeaseDigest) throw new Error("Projected successor cannot reconstruct its exact pre-CAS lease."); const target = { ...restored, taskAuthority: projection.binding, activePublishTaskAuthoritySuccessor: projection.receipt }; if (canonicalJson(target) !== canonicalJson(lease)) throw new Error("Projected successor response-loss subject changed."); return restored; }
  function frameFromLease(lease) { requireOwnedLease(lease); const frame = observeFrame(lease); const sourceLease = { ...lease, baseSha: frame.sourceBaseSha, fenceSha: frame.recovery.sourceFenceSha, cloudAuthority: { ...lease.cloudAuthority, claimId: frame.recovery.sourceClaimId, canonicalBaseSha: frame.sourceBaseSha, laneRevision: frame.recovery.sourceFenceSha, leaseEpoch: lease.cloudAuthority.leaseEpoch - 1 } }; return { ...frame, sourceLease }; }
  function preparedProjection(projection, fallbackPrior = null) { return Object.freeze({ sourceLeaseDigest: projection.sourceLeaseDigest, expectedLeaseDigest: projection.expectedLeaseDigest, expectedClaimId: projection.expectedClaimId, priorTaskAuthority: projection.priorTaskAuthority || fallbackPrior, binding: projection.binding, receipt: projection.receipt }); }
  function projectedResult(projection, lease, registryRevision) { return Object.freeze({ ...projection, targetBindingDigest: lease.taskAuthority.bindingDigest, successorReceiptDigest: lease.activePublishTaskAuthoritySuccessor.receiptDigest, targetLeaseDigest: writerLeaseDigest(lease), registryRevision }); }
  function verifyTerminal(plan, projection) { const adopted = projection.priorTaskAuthority ? adoptProjected(plan, projection) : verifyLegacyProjected(plan, projection); if (!adopted || adopted.targetBindingDigest !== projection.targetBindingDigest || adopted.successorReceiptDigest !== projection.successorReceiptDigest || adopted.targetLeaseDigest !== projection.targetLeaseDigest) throw new Error("Terminal successor binding projection is absent."); return Object.freeze({ targetBindingDigest: projection.targetBindingDigest, successorReceiptDigest: projection.successorReceiptDigest, targetLeaseDigest: projection.targetLeaseDigest, registryRevision: projection.registryRevision, verifiedAt: now().toISOString() }); }
  function verifyLegacyProjected(plan, projection) {
    const first = lockedProjectedSnapshot(true);
    assertLegacyProjected(plan, projection, first.lease, observeFrame(first.lease));
    assertLegacyProjected(plan, projection, first.lease, observeFrame(first.lease));
    const second = lockedProjectedSnapshot(true);
    if (canonicalJson(second.lease) !== canonicalJson(first.lease)) throw new Error("Projected successor branch changed during legacy terminal verification.");
    return projectedResult(projection, second.lease, second.registryRevision);
  }
  function assertLegacyProjected(plan, projection, lease, frame) {
    const receipt = lease.activePublishTaskAuthoritySuccessor;
    const exact = projection.expectedLeaseDigest === plan.evidence.leaseDigest && projection.expectedClaimId === plan.evidence.target.claimId && canonicalJson(lease.taskAuthority) === canonicalJson(projection.binding) && canonicalJson(receipt) === canonicalJson(projection.receipt) && projection.binding.priorBindingDigest === plan.evidence.source.bindingDigest && receipt.sourceBindingDigest === plan.evidence.source.bindingDigest && receipt.sourceBaseSha === plan.evidence.source.baseSha && receipt.sourceFenceSha === plan.evidence.source.fenceSha && receipt.sourceClaimId === plan.evidence.source.claimId && receipt.targetBaseSha === plan.evidence.target.baseSha && receipt.targetFenceSha === plan.evidence.target.fenceSha && receipt.targetClaimId === plan.evidence.target.claimId && receipt.cloudOperationReceiptDigest === plan.evidence.target.operationReceiptDigest && receipt.cloudVerificationReceiptDigest === plan.evidence.target.verificationReceiptDigest && lease.baseSha === plan.evidence.target.baseSha && lease.fenceSha === plan.evidence.target.fenceSha && lease.cloudAuthority.claimId === plan.evidence.target.claimId && lease.cloudAuthority.leaseEpoch === plan.evidence.target.leaseEpoch && frame.protectedRevision === plan.evidence.canonical.protectedRevision && frame.sourceBaseSha === plan.evidence.canonical.sourceBaseSha && digestValue(frame.changedPaths) === plan.evidence.canonical.changedPathsDigest && canonicalJson(frame.review) === canonicalJson(plan.evidence.pullRequest) && frame.cloud.state === plan.evidence.target.cloudState;
    if (!exact) throw new Error("Legacy projected successor terminal subject changed.");
  }
  return Object.freeze({ captureEvidence, authorizeTask, prepareProjection, projectRegistry, verifyTerminal, readJournal: journal.read, writeJournal: journal.write, withOperationLock: journal.withLock });
}

function nulPaths(value) { const paths = String(value).split("\0"); if (paths.at(-1) === "") paths.pop(); if (paths.some(item => !item)) throw new Error("Protected changed-path output is invalid."); return paths.sort(); }
function required(value, label) { if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`); return value; }
function positive(value, label) { const result = Number(value); if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label} is invalid.`); return result; }
