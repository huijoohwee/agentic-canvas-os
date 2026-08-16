// Responsibility: Join PR, lease, task authority, and cloud evidence; mutate only cloud and the exact local lease.
import { execFileSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { continueExpiredCommittedHeartbeatCloudAuthority, expiredCommittedCloudRecoveryEvidenceDigest, preserveSourceManifestProjection } from "./expired-committed-heartbeat-cloud-authority.mjs";
import { invokeRepositoryCloudAction } from "./scoped-lane-cloud-authority.mjs";
import { normalizeBoundAuthority } from "./scoped-lane-cloud-reconciliation.mjs";
import { authorizeTaskBoundLeaseMutation } from "./task-bound-lane-authority-store.mjs";
import { createWriterLeaseStore, parseWriterLeasePullRequestBody, projectWriterLeasePullRequestMarker } from "./writer-lease-lib.mjs";
import { mutateWriterLeaseRegistry, writerLeaseDigest } from "./writer-lease-registry-cas.mjs";
import { LOCAL_REPAIR_SCHEMA, normalizeCloudRecovery, normalizeLocalProjection, normalizeTerminal } from "./same-claim-dormant-reviewed-continuation-contract.mjs";

const LANDED_REVIEWED_TRANSITION_STATES = new Set(["reviewed", "dormant-preserved"]);

export function createRepositorySameClaimDormantReviewedContinuationAdapter(options = {}, dependencies = {}) {
  const targetRepository = real(options.repository, "target repository");
  const authorityRepository = real(options.authorityRepository, "authority repository");
  const pullRequestNumber = positive(options.pullRequestNumber, "pull request number");
  const authoritySessionId = text(options.authoritySessionId, "authority session");
  const ttlSeconds = Number.isSafeInteger(options.ttlSeconds) ? options.ttlSeconds : 1800;
  if (ttlSeconds < 60 || ttlSeconds > 86400) fail("TTL");
  const execute = dependencies.execute || ((cwd, command, args) => execFileSync(command, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }));
  const git = dependencies.git || ((cwd, args) => String(execute(cwd, "git", args)).trim());
  const gh = dependencies.gh || (args => String(execute(targetRepository, "gh", args)).trim());
  const now = dependencies.now || (() => new Date());
  const cloudAction = dependencies.cloudAction || invokeRepositoryCloudAction;
  const targetCommon = path.resolve(targetRepository, git(targetRepository, ["rev-parse", "--git-common-dir"]));
  const authorityCommon = path.resolve(authorityRepository, git(authorityRepository, ["rev-parse", "--git-common-dir"]));
  const targetLeaseStore = dependencies.targetLeaseStore || createWriterLeaseStore({ gitCommonDir: targetCommon, taskAuthorityPolicy: "projected" });
  const authorityLeaseStore = dependencies.authorityLeaseStore || createWriterLeaseStore({ gitCommonDir: authorityCommon, taskAuthorityPolicy: "projected" });
  const targetBranch = text(git(targetRepository, ["branch", "--show-current"]), "target branch");
  const authorityBranch = text(git(authorityRepository, ["branch", "--show-current"]), "authority branch");
  const journalPath = dependencies.journalPath || path.join(authorityCommon, "agentic-canvas-os", "recoveries", `same-claim-dormant-reviewed-${digestValue({ targetRepository, targetBranch, pullRequestNumber })}.json`);

  function inspectFrame() {
    const lease = targetLeaseStore.read(targetBranch);
    const operatorLease = authorityLeaseStore.read(authorityBranch);
    if (!lease || lease.status !== "review_ready" || lease.admission?.status !== "admitted" || !lease.taskAuthority?.priorBindingDigest || !lease.reviewedSuccessorPartialLocalProjectionRepair) fail("target reviewed lease");
    if (!operatorLease || operatorLease.status !== "active" || operatorLease.sessionId !== authoritySessionId || operatorLease.worktreePath !== authorityRepository) fail("operator authority lease");
    const headSha = git(targetRepository, ["rev-parse", "HEAD"]); const remoteLine = git(targetRepository, ["ls-remote", "--heads", "origin", `refs/heads/${targetBranch}`]); const remoteHeadSha = remoteLine.split(/\s+/u)[0];
    if (git(targetRepository, ["status", "--porcelain"]) !== "" || headSha !== lease.reviewHeadSha || remoteHeadSha !== headSha) fail("clean exact target head");
    const review = JSON.parse(gh(["pr", "view", String(pullRequestNumber), "--json", "id,url,state,isDraft,autoMergeRequest,headRefName,headRefOid,baseRefName,body"]));
    if (review.state !== "OPEN" || review.isDraft !== false || review.autoMergeRequest !== null || review.headRefName !== targetBranch || review.headRefOid !== headSha || Number(review.url.split("/").at(-1)) !== pullRequestNumber) fail("non-draft reviewed pull request");
    const marker = parseWriterLeasePullRequestBody(review.body); const markerDigest = digestValue(projectWriterLeasePullRequestMarker(marker));
    if (!marker || marker.status !== "review_ready" || marker.reviewHeadSha !== headSha || marker.cloudAuthority?.claimId !== lease.cloudAuthority?.claimId || marker.cloudAuthority?.leaseEpoch !== lease.cloudAuthority?.leaseEpoch || marker.taskAuthority?.bindingDigest !== lease.taskAuthority.priorBindingDigest || marker.taskAuthority.bindingDigest === lease.taskAuthority.bindingDigest) fail("retained prior-binding marker");
    const status = cloudAction({ action: "status", ledgerRepository: lease.cloudAuthority.ledgerRepository, request: { targetRepository: lease.cloudAuthority.targetRepository } });
    const matches = status?.claims?.filter(claim => claim.claimId === lease.cloudAuthority.claimId) || [];
    if (matches.length !== 1) fail("unique same claim"); const claim = matches[0];
    const stateShape = new Set(["dormant-preserved", "reviewed"]).has(claim.state) ? claim.writeAuthority === false && claim.scopeReserved === true : claim.state === "current" && claim.writeAuthority === true && claim.scopeReserved === true;
    if (!stateShape || claim.canonicalBaseRevision !== lease.baseSha || claim.laneRevision !== headSha || claim.writeSetDigest !== lease.admission.writeSetDigest || claim.leaseEpoch !== lease.cloudAuthority.leaseEpoch || claim.reviewRequestId !== lease.cloudAuthority.reviewRequestId || claim.integration || claim.integrationReceiptDigest) fail("same-claim cloud subject");
    const existing = lease.sameClaimDormantReviewedContinuation || null; const projectionState = existing ? "complete" : "pending";
    const prState = { id: review.id, url: review.url, state: review.state, isDraft: review.isDraft, autoMergeRequest: review.autoMergeRequest, headRefName: review.headRefName, headRefOid: review.headRefOid, baseRefName: review.baseRefName };
    const core = { observedAt: now().toISOString(), repository: lease.cloudAuthority.targetRepository, branch: targetBranch, targetSessionId: lease.sessionId, operatorAuthority: { repository: operatorLease.cloudAuthority.targetRepository, branch: authorityBranch, sessionId: authoritySessionId, leaseDigest: writerLeaseDigest(operatorLease), claimId: operatorLease.cloudAuthority.claimId, bindingDigest: operatorLease.taskAuthority.bindingDigest }, local: { leaseDigest: writerLeaseDigest(lease), status: lease.status, admissionStatus: lease.admission.status, clean: true, claimId: lease.cloudAuthority.claimId, leaseEpoch: lease.cloudAuthority.leaseEpoch, baseSha: lease.baseSha, headSha, writeSetDigest: lease.admission.writeSetDigest, reviewRequestId: lease.cloudAuthority.reviewRequestId, taskBindingDigest: lease.taskAuthority.bindingDigest, priorTaskBindingDigest: lease.taskAuthority.priorBindingDigest, repairReceiptDigest: lease.reviewedSuccessorPartialLocalProjectionRepair.receiptDigest }, pullRequest: { number: pullRequestNumber, ...prState, bodyDigest: digestValue(review.body), stateDigest: digestValue(prState) }, marker: { status: marker.status, claimId: marker.cloudAuthority.claimId, leaseEpoch: marker.cloudAuthority.leaseEpoch, reviewHeadSha: marker.reviewHeadSha, taskBindingDigest: marker.taskAuthority.bindingDigest, markerDigest }, cloud: { claimId: claim.claimId, matches: 1, state: claim.state, writeAuthority: claim.writeAuthority, scopeReserved: claim.scopeReserved, leaseEpoch: claim.leaseEpoch, canonicalBaseSha: claim.canonicalBaseRevision, laneRevision: claim.laneRevision, writeSetDigest: claim.writeSetDigest, reviewRequestId: claim.reviewRequestId, integrationState: "not-integrated", claimDigest: claim.fenceRevision, transitionCounter: claim.transitionCounter, operationReceiptDigest: claim.operationReceiptDigest }, projectionState, localRepair: existing };
    const evidence = Object.freeze({ ...core, evidenceDigest: digestValue(core) });
    return { evidence, lease, operatorLease, claim, review, marker, status };
  }

  function inspect() { return inspectFrame().evidence; }
  function authorizeTask({ plan, taskAuthorityFile, operation }) { const frame = inspectFrame(); if (frame.evidence.operatorAuthority.leaseDigest !== plan.evidence.operatorAuthority.leaseDigest) fail("operator authority drift"); return authorizeTaskBoundLeaseMutation({ lease: frame.operatorLease, capabilityPath: taskAuthorityFile, operation, now: now() }); }
  function recoverCloud({ plan }) { const frame = inspectFrame(); if (stableEvidence(frame.evidence) !== stableEvidence(plan.evidence)) fail("cloud recovery evidence drift"); const manifest = { manifestDigest: frame.lease.admission.manifestDigest, declaredWriteSet: frame.lease.admission.declaredWriteSet, writeSetDigest: frame.lease.admission.writeSetDigest }; if (LANDED_REVIEWED_TRANSITION_STATES.has(frame.claim.state) && frame.claim.transitionCounter === plan.evidence.cloud.transitionCounter + 1) return adoptReviewedResponseLossCloudRecovery({ sourceAuthority: frame.lease.cloudAuthority, claim: frame.claim, status: frame.status, manifest, recoveredAt: now().toISOString() }); const sourceAuthority = projectReviewedAuthorityForSameClaimRecovery(frame.lease.cloudAuthority); const result = continueExpiredCommittedHeartbeatCloudAuthority({ authority: sourceAuthority, manifest, recoveryEvidenceDigest: expiredCommittedCloudRecoveryEvidenceDigest({ snapshotDigest: plan.evidence.evidenceDigest, recoveryEvidence: { schema: "agentic-same-claim-dormant-reviewed-continuation-evidence/v1", planDigest: plan.planDigest, claimId: plan.evidence.cloud.claimId, headSha: plan.evidence.local.headSha, pullRequestStateDigest: plan.evidence.pullRequest.stateDigest } }), deviceId: frame.lease.device, sessionId: frame.lease.sessionId, ttlSeconds, inspect: cloudAction, invoke: cloudAction }); const authority = preserveSourceManifestProjection(frame.lease.cloudAuthority, result.authority); const core = { claimId: authority.claimId, authority, verificationReceiptDigest: digestValue(result.verification), cloudOperationReceiptDigest: authority.operationReceiptDigest, recoveredAt: now().toISOString() }; return normalizeCloudRecovery({ ...core, recoveryDigest: digestValue(core) }); }
  function projectLocal({ plan, taskAuthorityReceipt, cloudRecovery }) { const frame = inspectFrame(); if (frame.evidence.projectionState === "complete") return projectionFromLease(frame.lease); if (frame.evidence.local.leaseDigest !== plan.evidence.local.leaseDigest || frame.evidence.pullRequest.bodyDigest !== plan.evidence.pullRequest.bodyDigest || frame.evidence.pullRequest.stateDigest !== plan.evidence.pullRequest.stateDigest) fail("local projection fence"); const authority = cloudRecovery.authority; if (authority.claimId !== frame.lease.cloudAuthority.claimId || authority.laneRevision !== frame.lease.reviewHeadSha) fail("renewed authority subject"); const targetSubject = projectRenewedReviewedLeaseSubject(frame.lease, authority); const repairCore = { schema: LOCAL_REPAIR_SCHEMA, status: "recovered", planDigest: plan.planDigest, claimId: authority.claimId, sourceLeaseDigest: plan.evidence.local.leaseDigest, targetLeaseSubjectDigest: writerLeaseDigest(targetSubject), taskAuthorityReceiptDigest: taskAuthorityReceipt.receiptDigest, cloudRecoveryDigest: cloudRecovery.recoveryDigest, cloudRecovery, recoveredAt: now().toISOString(), cloudEffect: false, pullRequestEffect: false, sourceEffect: false, gitEffect: false, mergeEffect: false, integrationEffect: false, deploymentEffect: false }; const repair = Object.freeze({ ...repairCore, receiptDigest: digestValue(repairCore) }); const targetLease = { ...targetSubject, sameClaimDormantReviewedContinuation: repair }; const projected = mutateWriterLeaseRegistry({ leaseStore: targetLeaseStore, branch: targetBranch, expectedLeaseDigest: plan.evidence.local.leaseDigest, expectedClaimId: authority.claimId, action: ({ registry }) => ({ registry: { ...registry, leases: { ...registry.leases, [targetBranch]: targetLease } }, lease: targetLease, changed: true }) }); return normalizeLocalProjection({ taskAuthorityReceiptDigest: taskAuthorityReceipt.receiptDigest, cloudRecoveryDigest: cloudRecovery.recoveryDigest, localRepair: repair, targetLeaseDigest: writerLeaseDigest(projected.lease), registryRevision: projected.registryRevision }); }
  function verify({ plan }) { const frame = inspectFrame(); if (frame.evidence.projectionState !== "complete" || frame.evidence.pullRequest.bodyDigest !== plan.evidence.pullRequest.bodyDigest || frame.evidence.pullRequest.stateDigest !== plan.evidence.pullRequest.stateDigest || frame.evidence.local.headSha !== plan.evidence.local.headSha) fail("terminal preservation"); const projection = projectionFromLease(frame.lease); const terminal = normalizeTerminal({ claimId: frame.lease.cloudAuthority.claimId, headSha: frame.evidence.local.headSha, pullRequestBodyDigest: frame.evidence.pullRequest.bodyDigest, pullRequestStateDigest: frame.evidence.pullRequest.stateDigest, localRepairReceiptDigest: projection.localRepair.receiptDigest, targetLeaseDigest: projection.targetLeaseDigest, registryRevision: projection.registryRevision, verifiedAt: now().toISOString() }); const journal = readJournal(); if (!journal) return { taskAuthorityReceipt: { receiptDigest: projection.taskAuthorityReceiptDigest }, cloudRecovery: recoveryFromRepair(frame.lease), projection, terminal }; return terminal; }
  function projectionFromLease(lease) { const repair = lease.sameClaimDormantReviewedContinuation; const registry = targetLeaseStore.readRegistry(); return normalizeLocalProjection({ taskAuthorityReceiptDigest: repair.taskAuthorityReceiptDigest, cloudRecoveryDigest: repair.cloudRecoveryDigest, localRepair: repair, targetLeaseDigest: writerLeaseDigest(lease), registryRevision: registry.revision }); }
  function recoveryFromRepair(lease) { return normalizeCloudRecovery(lease.sameClaimDormantReviewedContinuation.cloudRecovery); }
  function readJournal() { try { return JSON.parse(readFileSync(journalPath, "utf8")); } catch (error) { if (error?.code === "ENOENT") return null; throw error; } }
  function writeJournal(value) { mkdirSync(path.dirname(journalPath), { recursive: true }); const temporary = `${journalPath}.${process.pid}.tmp`; writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); renameSync(temporary, journalPath); }
  function withLock(action) { mkdirSync(path.dirname(journalPath), { recursive: true }); const lock = `${journalPath}.lock`; let fd; try { fd = openSync(lock, "wx", 0o600); return action(); } finally { if (fd !== undefined) closeSync(fd); rmSync(lock, { force: true }); } }
  function stableEvidence(evidence) { return digestValue({ repository: evidence.repository, branch: evidence.branch, targetSessionId: evidence.targetSessionId, local: evidence.local, pullRequest: evidence.pullRequest, marker: evidence.marker, claimId: evidence.cloud.claimId, leaseEpoch: evidence.cloud.leaseEpoch }); }
  return Object.freeze({ inspect, authorizeTask, recoverCloud, projectLocal, verify, readJournal, writeJournal, withLock });
}

export function projectReviewedAuthorityForSameClaimRecovery(authority) {
  if (authority?.state !== "review_ready" || !authority.claimId || !authority.reviewRequestId) fail("reviewed source authority");
  return Object.freeze({ ...authority, state: "active" });
}

export function projectRenewedReviewedLeaseSubject(lease, authority) {
  if (lease?.status !== "review_ready" || !new Set(["active", "review_ready"]).has(authority?.state) || lease.cloudAuthority?.claimId !== authority.claimId || lease.cloudAuthority?.reviewRequestId !== authority.reviewRequestId) fail("renewed reviewed lease subject");
  return Object.freeze({ ...lease, cloudAuthority: authority, heartbeatAt: authority.expiresAt, expiresAt: authority.expiresAt });
}

export function adoptReviewedResponseLossCloudRecovery({ sourceAuthority, claim, status, manifest, recoveredAt }) {
  if (!LANDED_REVIEWED_TRANSITION_STATES.has(claim?.state) || claim.writeAuthority !== false || claim.scopeReserved !== true || claim.claimId !== sourceAuthority?.claimId || claim.transitionCounter !== sourceAuthority.transitionCounter + 1 || claim.reviewRequestId !== sourceAuthority.reviewRequestId || claim.laneRevision !== sourceAuthority.laneRevision || claim.writeSetDigest !== sourceAuthority.writeSetDigest) fail("reviewed response-loss subject");
  const landedAuthority = normalizeBoundAuthority({ result: { claim, claimDigest: claim.fenceRevision, ledgerRevision: status?.ledgerRevision, ledgerDigest: status?.ledgerDigest }, authority: sourceAuthority, manifest });
  // A dormant provider view is time-derived from the already-landed reviewed transition.
  const authority = preserveSourceManifestProjection(sourceAuthority, Object.freeze({ ...landedAuthority, state: "review_ready" }));
  const verification = { schema: "agentic-same-claim-reviewed-response-loss-verification/v1", ledgerRevision: status?.ledgerRevision, ledgerDigest: status?.ledgerDigest, claimId: claim.claimId, claimDigest: claim.fenceRevision, transitionCounter: claim.transitionCounter, operationReceiptDigest: claim.operationReceiptDigest };
  const core = { claimId: authority.claimId, authority, verificationReceiptDigest: digestValue(verification), cloudOperationReceiptDigest: authority.operationReceiptDigest, recoveredAt };
  return normalizeCloudRecovery({ ...core, recoveryDigest: digestValue(core) });
}

function real(value, label) { try { return realpathSync(path.resolve(text(value, label))); } catch { fail(label); } }
function text(value, label) { if (typeof value !== "string" || !value.trim()) fail(label); return value; }
function positive(value, label) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) fail(label); return number; }
function fail(label) { throw new Error(`Same-claim dormant reviewed repository adapter has invalid ${label}.`); }
