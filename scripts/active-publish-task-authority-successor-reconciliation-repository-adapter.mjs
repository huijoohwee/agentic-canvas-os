// Responsibility: Join Git, provider, cloud, capability, and writer-registry facts for one PR successor.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { continueActivePublishTaskAuthoritySuccessor } from "./active-publish-task-authority-successor.mjs";
import { authorizeTaskBoundLeaseMutation } from "./task-bound-lane-authority-store.mjs";
import { createWriterLeaseStore } from "./writer-lease-lib.mjs";
import { writerLeaseDigest } from "./writer-lease-registry-cas.mjs";
import { buildReconciliationEvidence } from "./active-publish-task-authority-successor-reconciliation-evidence.mjs";
import { inspectExactSuccessor } from "./active-publish-task-authority-successor-reconciliation-cloud-adapter.mjs";
import { createReconciliationStore, journalOperationId } from "./active-publish-task-authority-successor-reconciliation-store.mjs";

export function createActivePublishTaskAuthoritySuccessorReconciliationRepositoryAdapter(options, dependencies = {}) {
  const repository = (dependencies.realpath || realpathSync)(path.resolve(required(options.repository, "repository")));
  const pullRequestNumber = positive(options.pullRequestNumber, "pull request");
  const taskAuthorityFile = options.taskAuthorityFile ? path.resolve(options.taskAuthorityFile) : null;
  const execute = dependencies.execute || ((command, args) => execFileSync(command, args, { cwd: repository, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }));
  const git = dependencies.git || (args => String(execute("git", args)).trim());
  const gh = dependencies.gh || (args => String(execute("gh", args)).trim());
  const now = dependencies.now || (() => new Date());
  const branch = required(git(["branch", "--show-current"]), "attached branch");
  const gitCommonDir = (dependencies.realpath || realpathSync)(path.resolve(repository, git(["rev-parse", "--git-common-dir"])));
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({ gitCommonDir, taskAuthorityPolicy: "projected" });
  const journal = dependencies.journal || createReconciliationStore({ gitCommonDir, leaseStore, branch, operationId: journalOperationId({ branch, pullRequestNumber }) });
  const inspectCloud = dependencies.inspectCloud || inspectExactSuccessor;
  const authorize = dependencies.authorize || authorizeTaskBoundLeaseMutation;

  function currentLease() {
    const lease = leaseStore.read(branch);
    if (!lease || lease.status !== "active" || lease.admission?.status !== "admitted" || lease.branch !== branch || lease.sessionId !== options.sessionId || path.resolve(lease.worktreePath || "") !== repository || lease.pullRequestUrl?.split("/").at(-1) !== String(pullRequestNumber) || !lease.taskAuthority || !lease.cloudAuthority || lease.activePublishTaskAuthoritySuccessor) throw new Error("Exact unreconciled active-publish successor lease is unavailable.");
    return lease;
  }
  function provider() { return JSON.parse(gh(["pr", "view", String(pullRequestNumber), "--json", "number,id,url,state,isDraft,autoMergeRequest,headRefName,headRefOid,baseRefName"])); }
  function assertFrame() {
    const lease = currentLease();
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
    const changedPaths = git(["diff", "--name-only", `${sourceBaseSha}..${protectedRevision}`]).split("\n").filter(Boolean).sort();
    const ownedPaths = new Set(lease.admission.declaredWriteSet.filter(item => item.startsWith("path:")).map(item => item.slice(5)));
    if (changedPaths.some(changed => [...ownedPaths].some(owned => changed === owned || changed.startsWith(`${owned}/`) || owned.startsWith(`${changed}/`)))) throw new Error("Protected-main advance overlaps the successor write authority.");
    const sourceLease = { ...lease, baseSha: sourceBaseSha, fenceSha: recovery.sourceFenceSha, cloudAuthority: { ...lease.cloudAuthority, claimId: recovery.sourceClaimId, canonicalBaseSha: sourceBaseSha, laneRevision: recovery.sourceFenceSha, leaseEpoch: lease.cloudAuthority.leaseEpoch - 1 }, activePublishTaskAuthoritySuccessor: undefined };
    const cloud = inspectCloud({ authority: lease.cloudAuthority, sourceClaimId: recovery.sourceClaimId });
    return { lease, sourceLease, review, sourceBaseSha, protectedRevision, changedPaths, cloud };
  }
  function captureEvidence() {
    const frame = assertFrame();
    const value = buildReconciliationEvidence({ observedAt: now().toISOString(), repository, branch, sessionId: frame.lease.sessionId, pullRequest: frame.review, canonical: { protectedRevision: frame.protectedRevision, sourceBaseSha: frame.sourceBaseSha, changedPaths: frame.changedPaths, changedPathsDigest: digestValue(frame.changedPaths) }, source: { claimId: frame.sourceLease.cloudAuthority.claimId, baseSha: frame.sourceBaseSha, fenceSha: frame.sourceLease.fenceSha, bindingDigest: frame.sourceLease.taskAuthority.bindingDigest, laneBindingDigest: frame.sourceLease.taskAuthority.laneBindingDigest, leaseEpoch: frame.sourceLease.cloudAuthority.leaseEpoch }, target: { claimId: frame.lease.cloudAuthority.claimId, baseSha: frame.lease.baseSha, fenceSha: frame.lease.fenceSha, operationReceiptDigest: frame.lease.cloudAuthority.operationReceiptDigest, verificationReceiptDigest: frame.lease.admission.admissionReceiptDigest, leaseEpoch: frame.lease.cloudAuthority.leaseEpoch, predecessorClaimId: frame.sourceLease.cloudAuthority.claimId, cloudState: frame.cloud.state }, leaseDigest: writerLeaseDigest(frame.lease) });
    const second = assertFrame();
    if (writerLeaseDigest(second.lease) !== value.leaseDigest || second.protectedRevision !== value.canonical.protectedRevision || second.review.headRefOid !== value.pullRequest.headRefOid) throw new Error("Reconciliation evidence changed during capture.");
    return value;
  }
  function requirePlan(plan) { const current = captureEvidence(); if (current.evidenceDigest !== plan.evidence.evidenceDigest) throw new Error("Sealed reconciliation evidence changed."); return assertFrame(); }
  function authorizeTask(plan, operation) { const frame = requirePlan(plan); if (!taskAuthorityFile) throw new Error("Task capability is required for run."); return authorize({ lease: frame.sourceLease, capabilityPath: taskAuthorityFile, operation, now: now() }); }
  function prepareProjection(plan) { const frame = requirePlan(plan); const projected = continueActivePublishTaskAuthoritySuccessor({ sourceLease: frame.sourceLease, targetLease: frame.lease, cloudOperationReceiptDigest: frame.lease.cloudAuthority.operationReceiptDigest, cloudVerificationReceiptDigest: frame.lease.admission.admissionReceiptDigest, boundAt: now().toISOString() }); return Object.freeze({ sourceLeaseDigest: writerLeaseDigest(frame.sourceLease), expectedLeaseDigest: writerLeaseDigest(frame.lease), expectedClaimId: frame.lease.cloudAuthority.claimId, binding: projected.binding, receipt: projected.receipt }); }
  function projectRegistry(plan, projection) { const frame = requirePlan(plan); authorize({ lease: frame.sourceLease, capabilityPath: taskAuthorityFile, operation: `active-publish-task-authority-successor-reconciliation:${plan.planDigest}:registry`, now: now() }); const result = journal.project({ expectedLeaseDigest: projection.expectedLeaseDigest, expectedClaimId: projection.expectedClaimId, binding: projection.binding, receipt: projection.receipt }); return Object.freeze({ ...projection, targetBindingDigest: result.lease.taskAuthority.bindingDigest, successorReceiptDigest: result.lease.activePublishTaskAuthoritySuccessor.receiptDigest, targetLeaseDigest: writerLeaseDigest(result.lease), registryRevision: result.registryRevision }); }
  function verifyTerminal(plan, projection) { const lease = leaseStore.read(branch); if (!lease || lease.taskAuthority?.bindingDigest !== projection.targetBindingDigest || lease.activePublishTaskAuthoritySuccessor?.receiptDigest !== projection.successorReceiptDigest) throw new Error("Terminal successor binding projection is absent."); const review = provider(); if (review.state !== "OPEN" || review.isDraft !== true || review.headRefOid !== lease.fenceSha) throw new Error("Terminal pull-request frame changed."); return Object.freeze({ targetBindingDigest: projection.targetBindingDigest, successorReceiptDigest: projection.successorReceiptDigest, targetLeaseDigest: writerLeaseDigest(lease), registryRevision: projection.registryRevision, verifiedAt: now().toISOString() }); }
  return Object.freeze({ captureEvidence, authorizeTask, prepareProjection, projectRegistry, verifyTerminal, readJournal: journal.read, writeJournal: journal.write, withOperationLock: journal.withLock });
}

function required(value, label) { if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`); return value; }
function positive(value, label) { const result = Number(value); if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label} is invalid.`); return result; }
