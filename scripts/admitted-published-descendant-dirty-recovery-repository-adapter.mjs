// Responsibility: Join the exact repository subject to two cloud CAS transitions and local projections.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { captureActiveOwnedDirtEvidence } from "./active-owned-dirt-recovery-evidence.mjs";
import { canonicalJson, digestValue, normalizeWriteSet } from "./cloud-collaboration-primitives.mjs";
import { invokeRepositoryCloudAction } from "./scoped-lane-cloud-authority.mjs";
import { cloudAuthorityFromResult } from "./scoped-lane-cloud-reconciliation.mjs";
import {
  authorizeTaskBoundLeaseMutation,
  createTaskAuthorityLeaseBinding,
} from "./task-bound-lane-authority-store.mjs";
import {
  createWriterLeaseStore,
  parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker,
  updateWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";
import { mutateWriterLeaseRegistry, writerLeaseDigest } from "./writer-lease-registry-cas.mjs";

const INSTALLED_ROOT = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
const EVIDENCE_SCHEMA = "agentic-admitted-published-descendant-dirty-recovery-evidence/v1";

export function createAdmittedPublishedDescendantDirtyRecoveryRepositoryAdapter(options = {}, dependencies = {}) {
  const repository = realpathSync(path.resolve(required(options.repository, "repository")));
  const sessionId = required(options.sessionId, "session");
  const taskAuthorityFile = options.taskAuthorityFile ? realpathSync(path.resolve(options.taskAuthorityFile)) : null;
  const execute = dependencies.execute || ((command, argumentsList, settings = {}) => execFileSync(command,
    argumentsList, { cwd: settings.cwd || repository, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
  const git = (argumentsList, cwd = repository) => String(execute("git", argumentsList, { cwd })).trim();
  const dirtGit = (argumentsList, settings = {}) => execFileSync("git", argumentsList,
    { cwd: repository, ...settings });
  dirtGit.optional = (argumentsList, settings = {}) => {
    const result = spawnSync("git", argumentsList, { cwd: repository, ...settings });
    return result.status === 0 ? result.stdout : "";
  };
  const gh = argumentsList => String(execute("gh", argumentsList)).trim();
  const branch = required(git(["branch", "--show-current"]), "branch");
  const commonDirectory = realpathSync(path.resolve(repository, git(["rev-parse", "--git-common-dir"])));
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({ gitCommonDir: commonDirectory,
    taskAuthorityPolicy: "projected" });
  const cloudAction = dependencies.cloudAction || invokeRepositoryCloudAction;
  const now = dependencies.now || (() => new Date());

  function sourceLease() {
    const lease = leaseStore.read(branch);
    if (!lease || lease.status !== "active" || lease.sessionId !== sessionId || lease.branch !== branch
      || path.resolve(lease.worktreePath || "") !== repository || lease.admission?.status !== "admitted"
      || !lease.cloudAuthority || !lease.taskAuthority || Date.parse(lease.expiresAt) > now().getTime()) {
      invalid("expired admitted task-bound lease");
    }
    return lease;
  }

  function controllerWitness() {
    const headSha = git(["rev-parse", "HEAD"], INSTALLED_ROOT);
    const originMainSha = git(["rev-parse", "origin/main"], INSTALLED_ROOT);
    const status = git(["status", "--porcelain=v1", "--untracked-files=all"], INSTALLED_ROOT);
    if (headSha !== originMainSha || status) invalid("clean protected controller");
    const files = [
      "scripts/admitted-published-descendant-dirty-recovery-contract.mjs",
      "scripts/admitted-published-descendant-dirty-recovery-controller.mjs",
      "scripts/admitted-published-descendant-dirty-recovery-repository-adapter.mjs",
      "scripts/admitted-published-descendant-dirty-recovery.mjs",
    ];
    return { headSha, runtimeDigest: digestValue(files.map(file => ({ file,
      digest: digestValue(readFileSync(path.join(INSTALLED_ROOT, file))) }))) };
  }

  function capture() {
    const lease = sourceLease();
    const headSha = git(["rev-parse", "HEAD"]);
    const remoteHeadSha = git(["rev-parse", `refs/remotes/origin/${branch}`]);
    if (headSha === lease.fenceSha || remoteHeadSha !== headSha) invalid("published strict descendant");
    try { git(["merge-base", "--is-ancestor", lease.fenceSha, headSha]); } catch { invalid("fence ancestry"); }
    const commits = git(["rev-list", "--reverse", "--first-parent", `${lease.fenceSha}..${headSha}`])
      .split("\n").filter(Boolean);
    if (commits.length === 0) invalid("published descendant commits");
    const dirt = captureActiveOwnedDirtEvidence({ repository, git: dirtGit });
    if (dirt.pathCount === 0 || dirt.entries.some(entry => !pathOwned(entry.path,
      lease.admission.declaredWriteSet))) invalid("nonempty in-scope dirt");
    const pullRequest = JSON.parse(gh(["pr", "view", lease.pullRequestUrl, "--json",
      "id,url,state,isDraft,autoMergeRequest,headRefName,headRefOid,baseRefName,body"]));
    if (pullRequest.state !== "OPEN" || !pullRequest.isDraft || pullRequest.autoMergeRequest
      || pullRequest.headRefName !== branch || pullRequest.headRefOid !== headSha) invalid("draft review projection");
    const marker = parseWriterLeasePullRequestBody(pullRequest.body);
    if (canonicalJson(marker) !== canonicalJson(projectWriterLeasePullRequestMarker(lease))) {
      invalid("writer marker projection");
    }
    const status = cloudAction({ action: "status", ledgerRepository: lease.cloudAuthority.ledgerRepository,
      request: { targetRepository: lease.cloudAuthority.targetRepository } });
    const matches = (status?.claims || []).filter(claim => claim.claimId === lease.cloudAuthority.claimId);
    const claim = matches[0];
    if (status?.ok !== true || matches.length !== 1 || claim.state !== "dormant-preserved"
      || claim.writeAuthority !== false || claim.scopeReserved !== true
      || claim.canonicalBaseRevision !== lease.baseSha || claim.laneRevision !== lease.fenceSha
      || claim.writeSetDigest !== lease.admission.writeSetDigest
      || claim.reviewRequestId !== lease.cloudAuthority.reviewRequestId) invalid("dormant source claim");
    const core = {
      schema: EVIDENCE_SCHEMA,
      controller: controllerWitness(),
      repository,
      branch,
      lease,
      sourceLeaseDigest: writerLeaseDigest(lease),
      lane: { headSha, remoteHeadSha, commits },
      pullRequest: { id: pullRequest.id, url: pullRequest.url, bodyDigest: digestValue(pullRequest.body),
        baseBranch: pullRequest.baseRefName },
      cloud: { claimId: claim.claimId, state: claim.state, fenceRevision: claim.fenceRevision,
        transitionCounter: claim.transitionCounter, ledgerRevision: status.ledgerRevision,
        ledgerDigest: status.ledgerDigest, operationReceiptDigest: claim.operationReceiptDigest },
      dirt,
    };
    return Object.freeze({ ...core, evidenceDigest: digestValue(core) });
  }

  function authorize(plan) {
    if (!taskAuthorityFile) invalid("external task capability");
    return authorizeTaskBoundLeaseMutation({ lease: sourceLease(), capabilityPath: taskAuthorityFile,
      operation: `admitted-published-descendant-dirty-recovery:${plan.planDigest}`, now: now() });
  }

  function recover(plan, taskReceipt) {
    const evidence = capture();
    if (evidence.evidenceDigest !== plan.evidence.evidenceDigest) invalid("execution evidence");
    const lease = sourceLease();
    const manifest = { schema: "agentic-declared-write-scope/v1",
      semanticScope: lease.admission.semanticScope,
      paths: normalizeWriteSet(lease.admission.declaredWriteSet).filter(item => item.startsWith("path:"))
        .map(item => item.slice(5)),
      declaredWriteSet: lease.admission.declaredWriteSet,
      manifestDigest: lease.admission.manifestDigest,
      writeSetDigest: lease.admission.writeSetDigest };
    const recoveryResult = cloudAction({ action: "continue",
      ledgerRepository: lease.cloudAuthority.ledgerRepository, request: {
        targetRepository: lease.cloudAuthority.targetRepository, claimId: evidence.cloud.claimId,
        expectedFenceRevision: evidence.cloud.fenceRevision,
        expectedTransitionCounter: evidence.cloud.transitionCounter,
        expectedLedgerDigest: evidence.cloud.ledgerDigest, mode: "recovery",
        ttlSeconds: plan.ttlSeconds, recoveryEvidenceDigest: plan.planDigest,
        deviceId: lease.device, sessionId: lease.sessionId,
        idempotencyKey: `admitted-published-descendant-dirty-recovery:${plan.planDigest}:recover`,
      } });
    if (recoveryResult?.ok !== true || recoveryResult.claim?.state !== "current") invalid("cloud recovery");
    const projectionResult = cloudAction({ action: "continue",
      ledgerRepository: lease.cloudAuthority.ledgerRepository, request: {
        targetRepository: lease.cloudAuthority.targetRepository, claimId: evidence.cloud.claimId,
        expectedFenceRevision: recoveryResult.claim.fenceRevision,
        expectedTransitionCounter: recoveryResult.claim.transitionCounter,
        expectedLedgerDigest: recoveryResult.ledgerDigest || recoveryResult.receipt?.ledgerDigest,
        mode: "projection",
        laneRevision: evidence.lane.headSha,
        reviewRequestId: `github-pull-request:${evidence.pullRequest.id}`,
        idempotencyKey: `admitted-published-descendant-dirty-recovery:${plan.planDigest}:project`,
      } });
    if (projectionResult?.ok !== true || projectionResult.claim?.state !== "current"
      || projectionResult.claim.laneRevision !== evidence.lane.headSha) invalid("cloud projection");
    const cloudAuthority = cloudAuthorityFromResult({
      ledgerRepository: lease.cloudAuthority.ledgerRepository,
      targetRepository: lease.cloudAuthority.targetRepository,
      deviceId: lease.device, sessionId: lease.sessionId, result: projectionResult,
    }, { manifest, canonicalBaseSha: lease.baseSha });
    const reboundAt = now().toISOString();
    const targetCore = { ...lease, epoch: lease.epoch + 1, fenceSha: evidence.lane.headSha,
      heartbeatAt: reboundAt, expiresAt: cloudAuthority.expiresAt, cloudAuthority,
      admittedPublishedDescendantDirtyRecovery: { schema: EVIDENCE_SCHEMA,
        planDigest: plan.planDigest, sourceLeaseDigest: evidence.sourceLeaseDigest,
        dirtyEvidenceDigest: evidence.dirt.evidenceDigest, recoveredAt: reboundAt } };
    const taskAuthority = createTaskAuthorityLeaseBinding({ lease: targetCore,
      capabilityPath: taskAuthorityFile, bindingMode: "continuation", boundAt: reboundAt,
      priorBindingDigest: lease.taskAuthority.bindingDigest });
    const targetLease = Object.freeze({ ...targetCore, taskAuthority });
    mutateWriterLeaseRegistry({ leaseStore, branch, expectedLeaseDigest: evidence.sourceLeaseDigest,
      expectedClaimId: lease.cloudAuthority.claimId, action: ({ registry }) => ({
        registry: { ...registry, leases: { ...registry.leases, [branch]: targetLease } },
        lease: targetLease, changed: true,
      }) });
    const latest = JSON.parse(gh(["pr", "view", lease.pullRequestUrl, "--json", "body,headRefOid,id"]));
    if (latest.headRefOid !== evidence.lane.headSha || latest.id !== evidence.pullRequest.id
      || digestValue(latest.body) !== evidence.pullRequest.bodyDigest) invalid("pre-marker review drift");
    const targetBody = updateWriterLeasePullRequestBody(latest.body, targetLease);
    gh(["pr", "edit", lease.pullRequestUrl, "--body", targetBody]);
    const verified = JSON.parse(gh(["pr", "view", lease.pullRequestUrl, "--json", "body,headRefOid,id"]));
    const marker = parseWriterLeasePullRequestBody(verified.body);
    if (verified.headRefOid !== evidence.lane.headSha || verified.id !== evidence.pullRequest.id
      || canonicalJson(marker) !== canonicalJson(projectWriterLeasePullRequestMarker(targetLease))) {
      invalid("terminal marker projection");
    }
    const finalDirt = captureActiveOwnedDirtEvidence({ repository, git: dirtGit });
    if (finalDirt.evidenceDigest !== evidence.dirt.evidenceDigest
      || git(["rev-parse", "HEAD"]) !== evidence.lane.headSha) invalid("preserved terminal bytes");
    return Object.freeze({
      cloudRecoveryReceiptDigest: recoveryResult.operationReceipt?.receiptDigest,
      cloudProjectionReceiptDigest: projectionResult.operationReceipt?.receiptDigest,
      storedLeaseDigest: writerLeaseDigest(targetLease),
      taskAuthorityReceiptDigest: taskReceipt.receiptDigest,
      markerDigest: digestValue(marker),
    });
  }

  return Object.freeze({ capture, authorize, recover });
}

function pathOwned(candidate, writeSet) {
  return normalizeWriteSet(writeSet).some(item => item.startsWith("path:")
    && (candidate === item.slice(5) || candidate.startsWith(`${item.slice(5).replace(/\/$/u, "")}/`)));
}
function required(value, label) { if (typeof value !== "string" || !value.trim()) invalid(label); return value.trim(); }
function invalid(label) { throw new Error(`Admitted published-descendant dirty recovery rejected ${label}.`); }
