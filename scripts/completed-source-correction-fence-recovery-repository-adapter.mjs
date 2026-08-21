// Responsibility: Join exact Git, GitHub, cloud, task-capability, and lease-CAS effects for fence recovery.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { buildCompletedSourceCorrectionFenceRecoveryEvidence } from "./completed-source-correction-fence-recovery-evidence.mjs";
import { normalizeCompletedSourceCorrectionFenceRecoveryIntent } from "./completed-source-correction-fence-recovery-contract.mjs";
import { createCompletedSourceCorrectionFenceRecoveryController } from "./completed-source-correction-fence-recovery-controller.mjs";
import { recoverPlannedAdmissionCloudAuthority } from "./planned-clean-committed-recovery-lib.mjs";
import { assertRegisteredWorktree } from "./repository-guards.mjs";
import { assertAdmissionMutationAuthority } from "./scoped-lane-admission-state.mjs";
import { invokeRepositoryCloudAction, verifyAdmissionCloudAuthority } from "./scoped-lane-cloud-authority.mjs";
import { authorizeTaskBoundLeaseMutation } from "./task-bound-lane-authority-store.mjs";
import { currentSuccessorRepair } from "./source-correction-successor-task-binding-reconciliation-repository-adapter.mjs";
import { createWriterLeaseStore, parseWriterLeasePullRequestBody, projectWriterLeasePullRequestMarker, updateWriterLeasePullRequestBody } from "./writer-lease-lib.mjs";
import { casWriterLeaseProjection, writerLeaseDigest } from "./writer-lease-registry-cas.mjs";

export function createCompletedSourceCorrectionFenceRecoveryRepositoryController(options = {}, dependencies = {}) {
  const runtime = createRuntime(options, dependencies);
  return createCompletedSourceCorrectionFenceRecoveryController(runtime);
}

function createRuntime(options, dependencies) {
  const repository = realpathSync(path.resolve(text(options.repository, "repository")));
  const sourceSessionId = text(options.sourceSessionId, "source session");
  const operatorSessionId = text(options.operatorSessionId, "operator session");
  const pullRequestNumber = integer(options.pullRequestNumber, "pull request number");
  const taskAuthorityFile = options.taskAuthorityFile ? realpathSync(path.resolve(options.taskAuthorityFile)) : null;
  const ttlSeconds = Number(options.ttlSeconds || 7_200);
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 300 || ttlSeconds > 86_400) invalid("TTL");
  const execute = dependencies.execute || ((command, args) => execFileSync(command, args, { cwd: repository, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }));
  const git = dependencies.git || (args => execute("git", args).trim());
  const gh = dependencies.gh || (args => execute("gh", args).trim());
  const now = dependencies.now || (() => new Date());
  const branch = text(git(["branch", "--show-current"]), "branch");
  const registered = assertRegisteredWorktree({ cwd: repository, porcelain: git(["worktree", "list", "--porcelain", "-z"]) });
  if (registered.branch !== `refs/heads/${branch}`) invalid("registered branch");
  const commonDirectory = path.resolve(repository, git(["rev-parse", "--git-common-dir"]));
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({ gitCommonDir: commonDirectory, taskAuthorityFile });
  const key = createHash("sha256").update(branch).digest("hex");
  const correctionPath = path.join(commonDirectory, "agentic-canvas-os", "reviewed-lane-source-correction", `${key}.json`);
  const journalDirectory = path.join(commonDirectory, "agentic-canvas-os", "completed-source-correction-fence-recovery");
  const statePath = path.join(journalDirectory, `${key}.json`);
  const lockPath = `${statePath}.lock`;
  let cachedTaskReceipt = null; let cachedCloud = null; let cachedTerminal = null;

  function lease() {
    const value = leaseStore.read(branch);
    if (!value || value.schema !== "agentic-writer-lease/v2" || value.status !== "active"
      || value.sessionId !== sourceSessionId || value.branch !== branch
      || realpathSync(value.worktreePath) !== repository || value.admission?.status !== "admitted"
      || !value.pullRequestUrl?.endsWith(`/pull/${pullRequestNumber}`) || !value.taskAuthority) invalid("source lease");
    return value;
  }
  function manifest(value) { return { manifestDigest: value.admission.manifestDigest, declaredWriteSet: value.admission.declaredWriteSet, writeSetDigest: value.admission.writeSetDigest }; }
  function provider() {
    const value = JSON.parse(gh(["pr", "view", String(pullRequestNumber), "--json", "number,state,isDraft,headRefOid,body,autoMergeRequest,url"]));
    if (value.number !== pullRequestNumber) invalid("provider pull request");
    return value;
  }
  function remoteHead() { return sha(git(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]).split(/\s+/u)[0], "remote head"); }
  function cloudStatus(authority) {
    const result = dependencies.cloudStatus
      ? dependencies.cloudStatus(authority)
      : invokeRepositoryCloudAction({ action: "status", ledgerRepository: authority.ledgerRepository, request: { targetRepository: authority.targetRepository } });
    if (result?.ok !== true || !Array.isArray(result.claims)) invalid("cloud status");
    return result;
  }
  function correction() {
    if (!existsSync(correctionPath)) invalid("completed source-correction journal");
    const value = JSON.parse(readFileSync(correctionPath, "utf8"));
    if (value.status !== "complete" || value.completion?.status !== "authoring-restored") invalid("completed source-correction receipt");
    return value;
  }
  async function readEvidence() {
    const current = lease(); const completed = correction(); const pull = provider(); const remote = remoteHead();
    const claim = cloudStatus(current.cloudAuthority).claims.filter(item => item.claimId === completed.completion.successorClaimId);
    if (claim.length !== 1) invalid("successor claim cardinality");
    const withoutTask = { ...current }; delete withoutTask.taskAuthority;
    const successorTaskBindingRepair = currentSuccessorRepair(current);
    const changed = git(["diff", "--name-only", `${remote}..HEAD`]).split(/\r?\n/u).filter(Boolean);
    const marker = parseWriterLeasePullRequestBody(pull.body);
    return buildCompletedSourceCorrectionFenceRecoveryEvidence({
      repository: JSON.parse(gh(["repo", "view", "--json", "nameWithOwner"])).nameWithOwner,
      source: { branch, sessionId: sourceSessionId, localHeadSha: git(["rev-parse", "HEAD"]), remoteHeadSha: remote, protectedMainSha: git(["rev-parse", "origin/main"]), clean: git(["status", "--porcelain=v1", "--untracked-files=all"]) === "", changedPaths: changed },
      lease: {
        epoch: current.epoch,
        leaseDigest: writerLeaseDigest(current),
        leaseWithoutTaskAuthorityDigest: writerLeaseDigest(withoutTask),
        successorTaskBindingSourceLeaseDigest: successorTaskBindingRepair?.sourceLeaseDigest || null,
        fenceSha: current.fenceSha,
        declaredWriteSet: current.admission.declaredWriteSet,
        writeSetDigest: current.admission.writeSetDigest,
        taskAuthorityBindingDigest: current.taskAuthority.bindingDigest,
      },
      correction: { journalDigest: digestValue(completed), planDigest: completed.planDigest, completionReceiptDigest: completed.completion.receiptDigest, completionLeaseDigest: completed.completion.leaseDigest, sourceHeadSha: completed.completion.sourceHeadSha, successorClaimId: completed.completion.successorClaimId, successorClaimDigest: completed.completion.successorClaimDigest },
      pullRequest: { number: pull.number, state: pull.state, isDraft: pull.isDraft, headSha: pull.headRefOid, autoMergeAbsent: pull.autoMergeRequest === null, markerDigest: digestValue(marker) },
      claim: claim[0],
    });
  }
  function readIntent() { return existsSync(statePath) ? normalizeCompletedSourceCorrectionFenceRecoveryIntent(JSON.parse(readFileSync(statePath, "utf8"))) : null; }
  function writeIntent({ expected, value }) {
    const current = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : null;
    if (JSON.stringify(current) !== JSON.stringify(expected)) invalid("journal CAS");
    mkdirSync(journalDirectory, { recursive: true, mode: 0o700 }); const temporary = `${statePath}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); renameSync(temporary, statePath);
  }
  async function withFence(callback) {
    mkdirSync(journalDirectory, { recursive: true, mode: 0o700 });
    try { writeFileSync(lockPath, String(process.pid), { flag: "wx", mode: 0o600 }); return await callback(); }
    finally { try { if (existsSync(lockPath)) unlinkSync(lockPath); } catch {} }
  }
  async function verifyTaskAuthority({ plan }) {
    if (!taskAuthorityFile) throw new Error("Fence recovery run requires --task-authority.");
    cachedTaskReceipt = authorizeTaskBoundLeaseMutation({ lease: lease(), capabilityPath: taskAuthorityFile, operation: "completed-source-correction-fence-recovery", now: now() });
    return { taskAuthorityReceiptDigest: cachedTaskReceipt.receiptDigest, bindingDigest: plan.evidence.lease.taskAuthorityBindingDigest };
  }
  async function recoverCloud({ plan }) {
    const current = lease();
    cachedCloud = recoverPlannedAdmissionCloudAuthority({ authority: current.cloudAuthority, manifest: manifest(current), branch, recoveryEvidenceDigest: plan.evidence.evidenceDigest, ttlSeconds, deviceId: current.device, sessionId: current.sessionId });
    return { cloudAuthorityDigest: digestValue(cachedCloud.authority), verificationReceiptDigest: cachedCloud.verification.receiptDigest };
  }
  async function projectLocal({ plan }) {
    const current = lease(); if (!cachedCloud) invalid("recovered cloud authority");
    if (current.fenceSha === plan.targetFenceSha && current.cloudAuthority.claimDigest === cachedCloud.authority.claimDigest) return { leaseDigest: writerLeaseDigest(current) };
    if (current.fenceSha !== plan.sourceFenceSha || writerLeaseDigest(current) !== plan.evidence.lease.leaseDigest) invalid("local lease drift");
    const timestamp = now().toISOString();
    const projected = casWriterLeaseProjection({ leaseStore, branch, expectedLeaseDigest: writerLeaseDigest(current), expectedClaimId: plan.claimId, requireNoActiveIntent: true, values: { fenceSha: plan.targetFenceSha, cloudAuthority: cachedCloud.authority, heartbeatAt: timestamp, expiresAt: cachedCloud.authority.expiresAt } }).lease;
    return { leaseDigest: writerLeaseDigest(projected) };
  }
  async function projectPullRequestMarker({ plan }) {
    const current = lease(); if (current.fenceSha !== plan.targetFenceSha) invalid("projected lease fence");
    const pull = provider(); const body = updateWriterLeasePullRequestBody(pull.body, current);
    if (body !== pull.body) execute("gh", ["pr", "edit", current.pullRequestUrl, "--body", body]);
    return { pullRequestMarkerDigest: digestValue(projectWriterLeasePullRequestMarker(current)) };
  }
  async function verifyTerminal({ plan, intent }) {
    const current = lease(); const pull = provider(); const remote = remoteHead();
    if (git(["status", "--porcelain=v1", "--untracked-files=all"]) !== "" || current.fenceSha !== plan.targetFenceSha
      || remote !== plan.targetFenceSha || pull.headRefOid !== plan.targetFenceSha || !pull.isDraft || pull.autoMergeRequest !== null
      || digestValue(parseWriterLeasePullRequestBody(pull.body)) !== digestValue(projectWriterLeasePullRequestMarker(current))) invalid("terminal projection");
    const verified = verifyAdmissionCloudAuthority({ authority: current.cloudAuthority, manifest: manifest(current), canonicalBaseSha: current.baseSha });
    const authority = assertAdmissionMutationAuthority({ lease: current, cloudAuthority: verified.authority, remoteAuthorityVerification: verified.verification });
    cachedTerminal = { taskAuthorityReceiptDigest: intent.phases.task_authority_verified.values.taskAuthorityReceiptDigest, cloudAuthorityDigest: digestValue(verified.authority), leaseDigest: writerLeaseDigest(current), pullRequestMarkerDigest: digestValue(projectWriterLeasePullRequestMarker(current)), verificationDigest: digestValue({ head: git(["rev-parse", "HEAD"]), remote, pull: pull.headRefOid, authority }), mutationAuthority: authority };
    return cachedTerminal;
  }
  async function reconcilePhase({ phase, plan, intent }) {
    if (phase === "task_authority_verified") return intent.phases.task_authority_verified?.values || null;
    if (phase === "cloud_recovered") { const current = lease(); return current.cloudAuthority.transitionCounter > plan.evidence.claim.transitionCounter ? { cloudAuthorityDigest: digestValue(current.cloudAuthority), verificationReceiptDigest: current.cloudAuthority.operationReceiptDigest } : null; }
    if (phase === "local_projected") { const current = lease(); return current.fenceSha === plan.targetFenceSha ? { leaseDigest: writerLeaseDigest(current) } : null; }
    if (phase === "pr_marker_projected") { const current = lease(); const pull = provider(); return digestValue(parseWriterLeasePullRequestBody(pull.body)) === digestValue(projectWriterLeasePullRequestMarker(current)) ? { pullRequestMarkerDigest: digestValue(projectWriterLeasePullRequestMarker(current)) } : null; }
    if (phase === "verified") { try { return await verifyTerminal({ plan, intent }); } catch { return null; } }
    return null;
  }
  return { withFence, readEvidence, readIntent, writeIntent, reconcilePhase, verifyTaskAuthority, recoverCloud, projectLocal, projectPullRequestMarker, verifyTerminal };
}

function text(value, label) { if (typeof value !== "string" || !value || value !== value.trim()) invalid(label); return value; }
function integer(value, label) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) invalid(label); return number; }
function sha(value, label) { if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) invalid(label); return value; }
function invalid(label) { throw new Error(`Completed source-correction fence recovery has invalid ${label}.`); }
