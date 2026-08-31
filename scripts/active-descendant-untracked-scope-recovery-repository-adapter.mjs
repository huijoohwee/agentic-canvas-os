// Responsibility: Join one stopped descendant worktree to exact successor cloud and local CAS effects.
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { captureActiveOwnedDirtEvidence, requireSameActiveOwnedDirtEvidence } from "./active-owned-dirt-recovery-evidence.mjs";
import { canonicalJson, digestValue, normalizeWriteSet, writeSetsOverlap } from "./cloud-collaboration-primitives.mjs";
import { invokeRepositoryCloudVerifier } from "./cloud-collaboration-delivery-verifier.mjs";
import { withPrivateOperationLock } from "./private-operation-lock.mjs";
import { assertRegisteredWorktree } from "./repository-guards.mjs";
import { assertAdmissionMutationAuthority } from "./scoped-lane-admission-state.mjs";
import { bindAdmissionCloudAuthority, invokeRepositoryCloudAction, verifyAdmissionCloudAuthority } from "./scoped-lane-cloud-authority.mjs";
import { normalizeBoundAuthority } from "./scoped-lane-cloud-reconciliation.mjs";
import { normalizeDeclaredWriteScopeManifest } from "./scoped-lane-admission-lib.mjs";
import { authorizeTaskBoundLeaseMutation, continueTaskAuthorityCloudSuccessorBinding } from "./task-bound-lane-authority-store.mjs";
import { createWriterLeaseStore, parseWriterLeasePullRequestBody } from "./writer-lease-lib.mjs";
import { mutateWriterLeaseRegistry, writerLeaseDigest } from "./writer-lease-registry-cas.mjs";
import { activeDescendantUntrackedPullRequestIdentityDigest, normalizeActiveDescendantUntrackedScopeRecoveryIntent,
  stableActiveDescendantUntrackedTerminalDigest } from "./active-descendant-untracked-scope-recovery-contract.mjs";
import { buildActiveDescendantUntrackedScopeRecoveryEvidence } from "./active-descendant-untracked-scope-recovery-evidence.mjs";
const CONTROLLER_ROOT = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
const OPERATION = "active-descendant-untracked-scope-recovery";
const OWNER_STOP_SCHEMA = "agentic-active-descendant-untracked-owner-stop/v1";
const JOURNAL_SCHEMA = `agentic-${OPERATION}-journal/v1`;
const IMPLEMENTATION_FILES = Object.freeze([
  "scripts/active-descendant-untracked-scope-recovery-contract.mjs", "scripts/active-descendant-untracked-scope-recovery-controller.mjs",
  "scripts/active-descendant-untracked-scope-recovery-evidence.mjs", "scripts/active-descendant-untracked-scope-recovery-repository-adapter.mjs",
  "scripts/active-descendant-untracked-scope-recovery.mjs"]);

export function normalizeActiveDescendantUntrackedOwnerStopReceipt(value) {
  const keys = ["receiptDigest", "schema", "sourceBranch", "sourceFenceSha", "sourceHeadSha", "sourceSessionId", "stoppedAt", "untrackedPaths"];
  if (!value || typeof value !== "object" || Array.isArray(value)
    || canonicalJson(Object.keys(value).sort()) !== canonicalJson(keys.sort())
    || value.schema !== OWNER_STOP_SCHEMA) invalid("owner-stop receipt schema");
  const untrackedPaths = [...new Set((value.untrackedPaths || []).map(safePath))].sort();
  if (!untrackedPaths.length || untrackedPaths.length !== value.untrackedPaths.length) invalid("owner-stop untracked paths");
  const core = { schema: OWNER_STOP_SCHEMA, sourceSessionId: text(value.sourceSessionId, "owner-stop source session"),
    sourceBranch: text(value.sourceBranch, "owner-stop source branch"), sourceHeadSha: sha(value.sourceHeadSha, "owner-stop source HEAD"),
    sourceFenceSha: sha(value.sourceFenceSha, "owner-stop source fence"), untrackedPaths,
    stoppedAt: instant(value.stoppedAt, "owner-stop timestamp") };
  if (value.receiptDigest !== digestValue(core)) invalid("owner-stop receipt digest");
  return deepFreeze({ ...core, receiptDigest: value.receiptDigest });
}

export function createActiveDescendantUntrackedScopeRecoveryRepositoryAdapter(options = {}, dependencies = {}) {
  const repository = realpathSync(path.resolve(text(options.repository, "source repository")));
  const sourceSessionId = text(options.sourceSessionId, "source session");
  const controllerRoot = realpathSync(path.resolve(options.controllerRoot || CONTROLLER_ROOT));
  if (controllerRoot !== CONTROLLER_ROOT) invalid("installed controller root");
  const externalRoots = [repository, controllerRoot];
  const targetManifestFile = externalFile(options.targetManifestFile, "target manifest", externalRoots);
  const ownerStopReceiptFile = externalFile(options.ownerStopReceiptFile, "owner-stop receipt", externalRoots);
  const taskAuthorityFile = options.taskAuthorityFile ? externalFile(options.taskAuthorityFile, "task authority", externalRoots) : null;
  const ttlSeconds = integer(options.ttlSeconds ?? 1_800, "TTL seconds", 60, 86_400);
  const environment = options.environment || process.env;
  const now = dependencies.now || (() => new Date());
  const execute = dependencies.execute || ((command, argumentsList, cwd = repository) => execFileSync(command, argumentsList,
    { cwd, encoding: "utf8", env: environment, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 }));
  const git = dependencies.git || ((argumentsList, cwd = repository) => String(execute("git", argumentsList, cwd)).trim());
  const gitRaw = dependencies.gitRaw || ((argumentsList, cwd = repository) => String(execute("git", argumentsList, cwd)));
  const gh = dependencies.gh || (argumentsList => String(execute("gh", argumentsList)).trim());
  const invoke = dependencies.invoke || invokeRepositoryCloudAction;
  const verify = dependencies.verify || invokeRepositoryCloudVerifier;
  const captureDirt = dependencies.captureDirt || (() => captureActiveOwnedDirtEvidence({ repository }));
  const branch = text(git(["branch", "--show-current"]), "attached source branch");
  const commonDirectory = realpathSync(path.resolve(repository, git(["rev-parse", "--git-common-dir"])));
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({ gitCommonDir: commonDirectory, taskAuthorityPolicy: "projected" });

  function sourceLease() {
    const lease = leaseStore.read(branch);
    if (lease?.schema !== "agentic-writer-lease/v2" || lease.status !== "active"
      || lease.branch !== branch || lease.sessionId !== sourceSessionId
      || realpathSync(lease.worktreePath) !== repository
      || lease.admission?.status !== "admitted" || !lease.cloudAuthority
      || !lease.taskAuthority) invalid("active admitted task-bound source lease");
    return lease;
  }
  function manifest(scope = sourceLease().scope) { return normalizeDeclaredWriteScopeManifest(
    readExternalJson(targetManifestFile, "target manifest"), { expectedScope: scope }); }

  function ownerStop() {
    const receipt = normalizeActiveDescendantUntrackedOwnerStopReceipt(readExternalJson(ownerStopReceiptFile, "owner-stop receipt"));
    if (receipt.sourceSessionId !== sourceSessionId || receipt.sourceBranch !== branch) invalid("owner-stop source identity");
    return receipt;
  }

  function sourceLane(lease) {
    const record = assertRegisteredWorktree({ cwd: repository, porcelain: gitRaw(["worktree", "list", "--porcelain", "-z"]) });
    if (realpathSync(record.path) !== repository || record.branch !== `refs/heads/${branch}`) invalid("registered source worktree");
    const headSha = sha(git(["rev-parse", "HEAD"]), "source HEAD");
    const remoteHeadSha = firstSha(git(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]));
    if (headSha === lease.fenceSha || remoteHeadSha !== lease.fenceSha
      || gitExit(["merge-base", "--is-ancestor", lease.fenceSha, headSha]) !== 0) {
      invalid("unpublished strict descendant");
    }
    const firstParent = lines(git(["rev-list", "--reverse", "--first-parent", `${lease.fenceSha}..${headSha}`]));
    const all = lines(git(["rev-list", "--reverse", `${lease.fenceSha}..${headSha}`]));
    if (!firstParent.length || canonicalJson(firstParent) !== canonicalJson(all)) invalid("linear descendant commits");
    const committedPaths = nul(gitRaw(["diff", "--name-only", "--no-renames", "-z", lease.fenceSha, headSha, "--"])).sort();
    if (committedPaths.some(item => !covered(lease.admission.declaredWriteSet, item))) invalid("descendant commit path scope");
    return Object.freeze({ schema: "agentic-clean-unpublished-descendant/v1",
      status: "clean-unpublished-descendant", branch, scope: lease.scope,
      sessionId: lease.sessionId, device: lease.device,
      worktreeIdentityDigest: digestValue({ path: repository, branch: record.branch }),
      baseSha: lease.baseSha, remoteFenceSha: remoteHeadSha, headSha,
      headTreeSha: sha(git(["rev-parse", `${headSha}^{tree}`]), "source HEAD tree"),
      linearDescendant: true, headPublished: false, commitCount: firstParent.length,
      commitInventoryDigest: digestValue(firstParent),
      rangeDiffDigest: digestValue(gitRaw(["diff", "--binary", "--full-index", lease.fenceSha, headSha, "--"])), changedPaths: committedPaths });
  }

  function pullRequest(lease, observedAt = now().toISOString(), requireMarker = false) {
    const value = JSON.parse(gh(["pr", "view", lease.pullRequestUrl, "--json",
      "id,number,url,state,isDraft,autoMergeRequest,headRefName,headRefOid,baseRefName,baseRefOid,body"]));
    const body = String(value.body || ""), marker = requireMarker ? parseWriterLeasePullRequestBody(body) : null;
    if (value.url !== lease.pullRequestUrl || value.state !== "OPEN" || value.isDraft !== true || value.autoMergeRequest !== null
      || value.headRefName !== branch || value.headRefOid !== lease.fenceSha || value.baseRefName !== "main"
      || (requireMarker && !marker)) invalid("unchanged open draft pull request");
    return Object.freeze({ schema: "agentic-draft-review-subject/v1", adapterId: "github",
      repository: lease.cloudAuthority.targetRepository, id: lease.cloudAuthority.reviewRequestId, nodeId: text(value.id, "pull-request ID"),
      number: positive(value.number, "pull-request number"), url: value.url,
      state: "open", draft: value.isDraft, autoDelivery: null,
      branch: value.headRefName, headSha: value.headRefOid, baseSha: sha(value.baseRefOid, "pull-request base"), body,
      bodyDigest: digestValue(body), bodyRemainderDigest: digestValue(bodyRemainder(body)),
      markerDigest: digestValue(marker), observedAt });
  }

  function cloudStatus(plan = null) {
    const authority = plan?.evidence?.lease?.cloudAuthority || sourceLease().cloudAuthority;
    const result = invoke({ action: "status", ledgerRepository: authority.ledgerRepository,
      request: { targetRepository: authority.targetRepository }, environment });
    if (result?.schema !== "agentic-cloud-collaboration-result/v1" || result.ok !== true
      || !Array.isArray(result.claims)) invalid("cloud status");
    return result;
  }

  function exactSourceClaim(lease, status, target = null) {
    const matches = status.claims.filter(item => item.claimId === lease.cloudAuthority.claimId);
    if (matches.length !== 1) invalid("source cloud claim cardinality");
    const claim = matches[0];
    if (claim.state !== "current" || claim.writeAuthority !== true || claim.scopeReserved !== true
      || claim.canonicalBaseRevision !== lease.baseSha || claim.laneRevision !== lease.fenceSha
      || claim.writeSetDigest !== lease.admission.writeSetDigest
      || claim.reviewRequestId !== lease.cloudAuthority.reviewRequestId
      || canonicalJson(normalizeWriteSet(claim.declaredWriteScope))
        !== canonicalJson(lease.admission.declaredWriteSet)) invalid("source cloud claim");
    if (target) {
      const overlaps = status.claims.filter(item => item.claimId !== claim.claimId
        && (item.writeAuthority === true || item.scopeReserved === true)
        && writeSetsOverlap(item.declaredWriteScope, target.declaredWriteSet));
      if (overlaps.length) invalid("foreign target-scope overlap");
    }
    return claim;
  }

  function controllerWitness() {
    if (dependencies.controllerWitness) return dependencies.controllerWitness();
    const controllerBranch = text(git(["branch", "--show-current"], controllerRoot), "controller branch");
    const headSha = sha(git(["rev-parse", "HEAD"], controllerRoot), "controller HEAD");
    const remoteHeadSha = firstSha(git(["ls-remote", "--heads", "origin", `refs/heads/${controllerBranch}`], controllerRoot));
    const controllerCommon = realpathSync(path.resolve(controllerRoot, git(["rev-parse", "--git-common-dir"], controllerRoot)));
    const controllerStore = createWriterLeaseStore({ gitCommonDir: controllerCommon, taskAuthorityPolicy: "projected" });
    const lease = controllerStore.read(controllerBranch);
    const controllerStatus = lease && invoke({ action: "status", ledgerRepository: lease.cloudAuthority?.ledgerRepository,
      request: { targetRepository: lease.cloudAuthority?.targetRepository }, environment });
    const claims = controllerStatus?.claims?.filter(item => item.claimId === lease?.cloudAuthority?.claimId) || [];
    const claim = claims[0];
    const active = lease?.status === "active" && claim?.state === "current" && claim.writeAuthority === true;
    const reviewed = lease?.status === "review_ready" && lease.reviewHeadSha === headSha && claim?.state === "reviewed" && claim.writeAuthority === false;
    const review = reviewed ? JSON.parse(gh(["pr", "view", lease.pullRequestUrl, "--json", "state,isDraft,headRefName,headRefOid"])) : null;
    if (headSha !== remoteHeadSha
      || gitRaw(["status", "--porcelain=v1", "-z", "--untracked-files=all"], controllerRoot)
      || (!active && !reviewed) || lease.admission?.status !== "admitted"
      || realpathSync(lease.worktreePath) !== controllerRoot || (active && lease.fenceSha !== headSha)
      || !lease.taskAuthority || controllerStatus?.ok !== true || claims.length !== 1
      || claim.scopeReserved !== true || claim.laneRevision !== headSha
      || claim.writeSetDigest !== lease.admission.writeSetDigest
      || (reviewed && (review.state !== "OPEN" || review.isDraft !== false
        || review.headRefName !== controllerBranch || review.headRefOid !== headSha))
      || IMPLEMENTATION_FILES.some(file => !covered(lease.admission.declaredWriteSet, file))) {
      invalid("clean published admitted controller");
    }
    return Object.freeze({ repository: lease.cloudAuthority.targetRepository,
      branch: controllerBranch, baseSha: lease.baseSha, headSha, remoteHeadSha,
      treeSha: sha(git(["rev-parse", "HEAD^{tree}"], controllerRoot), "controller tree"),
      clean: true, published: true, leaseDigest: writerLeaseDigest(lease),
      claimId: claim.claimId, claimDigest: claim.fenceRevision,
      transitionCounter: claim.transitionCounter, writeSetDigest: claim.writeSetDigest,
      taskAuthorityBindingDigest: lease.taskAuthority.bindingDigest,
      implementationDigest: digestValue(IMPLEMENTATION_FILES.map(file =>
        ({ file, digest: digestValue(readFileSync(path.join(controllerRoot, file))) }))) });
  }

  function capture(observedAt = now().toISOString()) {
    const lease = sourceLease(), target = manifest(lease.scope), stop = ownerStop();
    const lane = sourceLane(lease), dirt = captureDirt();
    requireIncidentShape({ lease, lane, dirt, stop, target });
    const registry = leaseStore.readRegistry(), status = cloudStatus();
    const claim = exactSourceClaim(lease, status, target), pull = pullRequest(lease, observedAt, true);
    const targetAvailability = targetAvailabilityEvidence({ lease, target, stop, status, observedAt });
    return buildActiveDescendantUntrackedScopeRecoveryEvidence({
      repository: lease.cloudAuthority.targetRepository,
      authorityRepository: lease.cloudAuthority.ledgerRepository, observedAt, lane, lease,
      registry: { snapshot: registry, revision: registry.revision, leaseDigest: writerLeaseDigest(lease), registryDigest: digestValue(registry) },
      claim: claimEvidence(claim, status), pullRequest: withoutBody(pull), dirt,
      ownerStop: stop, targetManifest: target, targetAvailability,
      controller: controllerWitness(), mutationBoundary: {
        privateJournal: true, taskAuthorityProof: true, cloudSuccessorClaim: true,
        cloudSourceRetirement: true, cloudSuccessorPromotion: true,
        cloudReviewBinding: true, writerRegistryCas: true,
        sourceBytes: false, index: false, head: false, localRef: false, remoteRef: false,
        commit: false, push: false, pullRequestBody: false, pullRequestMarker: false,
        pullRequestState: false, reviewAuthority: false,
        integration: false, deployment: false, cleanup: false },
    });
  }

  function targetAvailabilityEvidence({ lease, target, stop, status, observedAt }) {
    const source = normalizeWriteSet(lease.admission.declaredWriteSet);
    const additions = target.declaredWriteSet.filter(item => !source.includes(item)).map(item =>
      item.startsWith("path:") ? item.slice(5) : invalid("target addition"));
    const absentPaths = additions.filter(item => !stop.untrackedPaths.includes(item)).sort();
    for (const item of absentPaths) {
      if (gitExit(["cat-file", "-e", `HEAD:${item}`]) === 0 || gitExit(["ls-files", "--error-unmatch", "--", item]) === 0
        || pathExists(path.join(repository, item))) invalid("future target path absence");
    }
    const claimIds = status.claims.map(item => item.claimId).sort();
    const core = { schema: "agentic-active-descendant-untracked-target-availability/v1",
      sourceClaimId: lease.cloudAuthority.claimId, targetWriteSetDigest: target.writeSetDigest,
      absentPaths, headAbsent: true, indexAbsent: true, worktreeAbsent: true,
      competingClaimIds: [], inventoryDigest: digestValue(status.claims),
      verificationReceiptDigest: digestValue({ ledgerRevision: status.ledgerRevision, ledgerDigest: status.ledgerDigest, claimIds }), observedAt };
    return Object.freeze({ ...core, receiptDigest: digestValue(core) });
  }

  function assertStatic(plan, { targetLease = false, sealPullRequest = false } = {}) {
    requireExternalInputs(plan);
    const lease = leaseStore.read(branch);
    if (!lease || lease.sessionId !== sourceSessionId || lease.branch !== branch
      || realpathSync(lease.worktreePath) !== repository) invalid("live local owner");
    const lane = sourceLane({ ...lease, fenceSha: plan.sourceFenceSha, admission: plan.evidence.lease.admission });
    if (digestValue(lane) !== digestValue(plan.evidence.lane)) invalid("sealed descendant lane");
    requireSameActiveOwnedDirtEvidence(plan.evidence.dirt, captureDirt());
    const pull = pullRequest({ ...lease, fenceSha: plan.sourceFenceSha,
      pullRequestUrl: plan.evidence.lease.pullRequestUrl }, now().toISOString(), sealPullRequest);
    if (sealPullRequest && (pull.bodyDigest !== plan.evidence.pullRequest.bodyDigest
      || pull.bodyRemainderDigest !== plan.evidence.pullRequest.bodyRemainderDigest
      || pull.markerDigest !== plan.evidence.pullRequest.markerDigest)) invalid("sealed source pull-request");
    if (!targetLease && writerLeaseDigest(lease) !== plan.sourceLeaseDigest) invalid("sealed source lease");
    if (targetLease && (lease.cloudAuthority?.claimId === plan.sourceClaimId || lease.fenceSha !== plan.sourceFenceSha
      || lease.admission?.writeSetDigest !== plan.targetWriteSetDigest)) invalid("projected successor lease");
    return { lease, lane, pull };
  }

  function successor(plan, status, states, laneRevisions) {
    const matches = status.claims.filter(item => item.predecessorClaimId === plan.sourceClaimId
      && item.writeSetDigest === plan.targetWriteSetDigest);
    if (matches.length !== 1 || !states.includes(matches[0].state)) return null;
    const claim = matches[0];
    if (claim.canonicalBaseRevision !== plan.evidence.lease.baseSha
      || !laneRevisions.includes(claim.laneRevision)
      || claim.leaseEpoch !== plan.targetCloudLeaseEpoch
      || canonicalJson(normalizeWriteSet(claim.declaredWriteScope))
        !== canonicalJson(plan.evidence.targetManifest.declaredWriteSet)) invalid("successor identity");
    return claim;
  }

  const adapter = {
    async readEvidence() {
      const first = capture(), second = capture(first.observedAt);
      if (first.evidenceDigest !== second.evidenceDigest) invalid("double-read evidence drift");
      return second;
    },
    withOperationLock(plan, action) {
      const file = `${journalPath(plan)}.operation.lock`;
      return withPrivateOperationLock({ file, context: { operation: OPERATION, planDigest: plan.planDigest,
        sourceClaimId: plan.sourceClaimId }, action });
    },
    readIntent(plan) { return readJournal(journalPath(plan)); },
    writeIntent({ plan, expected, next }) { return writeJournal(journalPath(plan), expected,
      normalizeActiveDescendantUntrackedScopeRecoveryIntent(next)); },
    async assertState({ plan, intent, before }) {
      const status = cloudStatus(plan);
      const waitingOrCurrent = successor(plan, status, ["waiting-successor", "current"], [plan.sourceFenceSha]);
      const currentLease = leaseStore.read(branch);
      const targetLease = before === "verified" || (before === "local-cas" && currentLease?.cloudAuthority?.claimId
        && currentLease.cloudAuthority.claimId !== plan.sourceClaimId);
      const sealed = ["authorized", "task-authority-verified"].includes(before)
        || (before === "successor-waiting" && !waitingOrCurrent);
      assertStatic(plan, { targetLease, sealPullRequest: sealed });
      if (targetLease && currentLease.cloudAuthority.claimId !== waitingOrCurrent?.claimId) invalid("projected successor lease identity");
      if (["authorized", "task-authority-verified"].includes(before))
        exactSourceClaim(plan.evidence.lease, status, plan.evidence.targetManifest);
      else if (before === "successor-waiting")
        exactSourceClaim(plan.evidence.lease, status, waitingOrCurrent ? null : plan.evidence.targetManifest);
      else if (before === "source-retired") {
        if (!successor(plan, status, ["waiting-successor"], [plan.sourceFenceSha])) invalid("waiting successor");
        const source = status.claims.find(item => item.claimId === plan.sourceClaimId && item.state === "current");
        if (source) exactSourceClaim(plan.evidence.lease, status); else assertSourceRetiredOrAbsent(plan, status);
      } else if (before === "successor-current") {
        if (!waitingOrCurrent) invalid("retired-source successor");
      } else if (before === "successor-bound") {
        if (!successor(plan, status, ["current"], [plan.sourceFenceSha])) invalid("promoted successor");
      } else if (["local-cas", "verified"].includes(before)) {
        if (!successor(plan, status, ["current"], [plan.sourceFenceSha])) invalid("bound successor");
      } else invalid(`unsupported state phase ${before}`);
      return { stateDigest: digestValue({ before, intentDigest: intent?.intentDigest || null }) };
    },
    authorizeTask({ plan }) {
      if (!taskAuthorityFile) invalid("external task-authority capability");
      const { lease } = assertStatic(plan, { sealPullRequest: true });
      const receipt = authorizeTaskBoundLeaseMutation({ lease, capabilityPath: taskAuthorityFile,
        operation: `${OPERATION}:${plan.planDigest}`, now: now() });
      return { taskAuthorityReceiptDigest: receipt.receiptDigest,
        taskAuthorityProofDigest: receipt.proofDigest,
        sourceTaskAuthorityBindingDigest: receipt.bindingDigest };
    },
    createWaitingSuccessor({ plan }) {
      assertStatic(plan); let status = cloudStatus(plan);
      let claim = successor(plan, status, ["waiting-successor"], [plan.sourceFenceSha]);
      let result = null;
      if (!claim) {
        assertStatic(plan, { sealPullRequest: true });
        result = invoke({ action: "claim", ledgerRepository: plan.evidence.lease.cloudAuthority.ledgerRepository,
          request: { targetRepository: plan.evidence.repository,
            workItemId: plan.evidence.lease.scope,
            canonicalBaseSha: plan.evidence.lease.baseSha, headSha: plan.sourceFenceSha,
            declaredWriteSet: plan.evidence.targetManifest.declaredWriteSet,
            predecessorClaimId: plan.sourceClaimId, leaseEpoch: plan.targetCloudLeaseEpoch,
            ttlSeconds: plan.ttlSeconds, deviceId: plan.evidence.lease.device,
            sessionId: sourceSessionId,
            idempotencyKey: `${OPERATION}:successor-waiting:${plan.planDigest}` }, environment });
        status = cloudStatus(plan); claim = successor(plan, status, ["waiting-successor"], [plan.sourceFenceSha]);
      }
      if (!claim) invalid("waiting-successor result");
      return successorValues(claim, result);
    },
    retireSource({ plan, intent }) {
      assertStatic(plan); const status = cloudStatus(plan);
      const waiting = phase(intent, "successor-waiting");
      if (!successor(plan, status, ["waiting-successor"], [plan.sourceFenceSha])) invalid("waiting successor before retirement");
      const result = invoke({ action: "retire", ledgerRepository: plan.evidence.lease.cloudAuthority.ledgerRepository,
        request: { targetRepository: plan.evidence.repository, claimId: plan.sourceClaimId,
          expectedFenceRevision: plan.sourceClaimDigest,
          expectedTransitionCounter: plan.sourceTransitionCounter, reason: "superseded",
          finalRevision: plan.sourceFenceSha, reviewRequestId: plan.evidence.claim.reviewRequestId,
          bytesDigest: plan.evidence.dirt.evidenceDigest,
          namedChecksDigest: digestValue({ planDigest: plan.planDigest, kind: "checks" }),
          handoffEvidenceDigest: digestValue({ planDigest: plan.planDigest,
            ownerStopReceiptDigest: plan.evidence.ownerStop.receiptDigest,
            successorClaimId: waiting.claimId }), deviceId: plan.evidence.lease.device,
          sessionId: sourceSessionId,
          idempotencyKey: `${OPERATION}:source-retired:${plan.planDigest}` }, environment });
      return retirementValues(plan, result);
    },
    promoteSuccessor({ plan, intent }) {
      assertStatic(plan); const waiting = phase(intent, "successor-waiting");
      let status = cloudStatus(plan), claim = successor(plan, status, ["current"], [plan.sourceFenceSha]), result = null;
      if (!claim) {
        const live = successor(plan, status, ["waiting-successor"], [plan.sourceFenceSha]);
        if (!live || live.claimId !== waiting.claimId) invalid("successor before promotion");
        result = invoke({ action: "continue", ledgerRepository: plan.evidence.lease.cloudAuthority.ledgerRepository,
          request: { targetRepository: plan.evidence.repository, claimId: waiting.claimId,
            expectedFenceRevision: live.fenceRevision,
            expectedTransitionCounter: live.transitionCounter, mode: "promote",
            ttlSeconds: plan.ttlSeconds, deviceId: plan.evidence.lease.device,
            sessionId: sourceSessionId,
            idempotencyKey: `${OPERATION}:successor-current:${plan.planDigest}` }, environment });
        status = cloudStatus(plan); claim = successor(plan, status, ["current"], [plan.sourceFenceSha]);
      }
      if (!claim || claim.claimId !== waiting.claimId) invalid("promoted-successor result");
      return successorValues(claim, result);
    },
    bindSuccessor({ plan, intent }) {
      assertStatic(plan); let status = cloudStatus(plan), claim = successor(plan, status, ["current"],
        [plan.sourceFenceSha]);
      if (!claim) invalid("current successor before bind");
      let authority = boundAuthority(plan, status, claim);
      let verificationReceiptDigest = authority?.operationReceiptDigest;
      if (!isBound(plan, claim)) {
        const seed = authorityFrom(plan, status, claim);
        const bound = bindAdmissionCloudAuthority({ authority: seed,
          manifest: plan.evidence.targetManifest, branch, headSha: plan.sourceFenceSha,
          reviewRequestId: plan.evidence.claim.reviewRequestId,
          deviceId: plan.evidence.lease.device, sessionId: sourceSessionId,
          idempotencyKey: `${OPERATION}:successor-bound:${plan.planDigest}`,
          returnVerification: true, environment, invoke, inspect: invoke, verify });
        authority = bound.authority; verificationReceiptDigest = bound.verification.receiptDigest;
        status = cloudStatus(plan); claim = successor(plan, status, ["current"], [plan.sourceFenceSha]);
      }
      if (!authority || !claim || !isBound(plan, claim)) invalid("bound-successor result");
      const core = { authority, claimId: authority.claimId, claimDigest: authority.claimDigest,
        transitionCounter: authority.transitionCounter, state: claim.state,
        laneRevision: authority.laneRevision, reviewRequestId: authority.reviewRequestId,
        operationReceiptDigest: authority.operationReceiptDigest, verificationReceiptDigest };
      return Object.freeze({ ...core, receiptDigest: digestValue(core) });
    },
    projectLocal({ plan, intent }) {
      if (!taskAuthorityFile) invalid("external task-authority capability");
      const authority = phase(intent, "successor-bound").authority;
      let current = leaseStore.read(branch), adopted = current?.cloudAuthority?.claimId === authority.claimId;
      if (!adopted) {
        const source = assertStatic(plan).lease;
        const verified = verifyAdmissionCloudAuthority({ authority,
          manifest: plan.evidence.targetManifest, canonicalBaseSha: source.baseSha,
          environment, inspect: invoke, invoke: verify });
        const admission = successorAdmission(source.admission, plan, verified.authority);
        const projectedAt = verified.verification.verifiedAt || now().toISOString();
        const nextCore = { ...source, fenceSha: plan.sourceFenceSha, admission,
          cloudAuthority: verified.authority, heartbeatAt: projectedAt,
          expiresAt: verified.authority.expiresAt };
        const next = { ...nextCore,
          taskAuthority: continueTaskAuthorityCloudSuccessorBinding({ sourceLease: source,
            nextLease: nextCore, capabilityPath: taskAuthorityFile, boundAt: projectedAt }) };
        const mutation = assertAdmissionMutationAuthority({ lease: next,
          cloudAuthority: verified.authority,
          remoteAuthorityVerification: verified.verification });
        const result = mutateWriterLeaseRegistry({ leaseStore, branch,
          expectedLeaseDigest: plan.sourceLeaseDigest, expectedClaimId: plan.sourceClaimId,
          action: ({ registry }) => ({ registry: { ...registry,
            leases: { ...registry.leases, [branch]: next } }, lease: next, changed: true }) });
        current = result.lease; adopted = false;
      }
      const target = assertStatic(plan, { targetLease: true }).lease;
      const mutation = assertAdmissionMutationAuthority({ lease: target,
        cloudAuthority: target.cloudAuthority,
        remoteAuthorityVerification: verifyAdmissionCloudAuthority({ authority: target.cloudAuthority,
          manifest: plan.evidence.targetManifest, canonicalBaseSha: target.baseSha,
          environment, inspect: invoke, invoke: verify }).verification });
      const registry = leaseStore.readRegistry();
      const core = { leaseDigest: writerLeaseDigest(current), registryRevision: registry.revision,
        taskAuthorityBindingDigest: current.taskAuthority.bindingDigest,
        mutationAuthorityReceiptDigest: mutation.receiptDigest, adopted };
      return Object.freeze({ ...core, receiptDigest: digestValue(core) });
    },
    verifyTerminal({ plan, intent }) {
      const local = assertStatic(plan, { targetLease: true });
      const status = cloudStatus(plan), claim = successor(plan, status, ["current"], [plan.sourceFenceSha]);
      if (!claim || !isBound(plan, claim)) invalid("terminal successor");
      const verified = verifyAdmissionCloudAuthority({ authority: local.lease.cloudAuthority,
        manifest: plan.evidence.targetManifest, canonicalBaseSha: local.lease.baseSha,
        environment, inspect: invoke, invoke: verify });
      const mutation = assertAdmissionMutationAuthority({ lease: local.lease,
        cloudAuthority: verified.authority,
        remoteAuthorityVerification: verified.verification });
      const registry = leaseStore.readRegistry(), task = phase(intent, "task-authority-verified");
      const terminalEvidence = { sourceHeadSha: plan.sourceHeadSha,
        sourceIndexEvidenceDigest: indexDigest(plan.evidence.dirt),
        sourceDirtEvidenceDigest: plan.evidence.dirt.evidenceDigest,
        successorClaimId: claim.claimId, successorClaimDigest: claim.fenceRevision,
        successorTransitionCounter: claim.transitionCounter,
        successorLaneRevision: claim.laneRevision,
        targetWriteSetDigest: plan.targetWriteSetDigest,
        targetManifestDigest: plan.targetManifestDigest,
        sourceLeaseDigest: plan.sourceLeaseDigest, targetLeaseDigest: writerLeaseDigest(local.lease), registryRevision: registry.revision,
        registryDigest: digestValue(registry), pullRequestIdentityDigest: activeDescendantUntrackedPullRequestIdentityDigest(local.pull),
        taskAuthorityReceiptDigest: task.taskAuthorityReceiptDigest,
        mutationAuthorityReceiptDigest: mutation.receiptDigest,
        cloudVerificationReceiptDigest: verified.verification.receiptDigest,
        verifiedAt: now().toISOString(), sourceMutation: false, indexMutation: false,
        headMutation: false, localRefMutation: false, remoteRefMutation: false,
        commitMutation: false, pushMutation: false, authoringAuthority: true,
        reviewAuthority: false, integrationAuthority: false, deploymentAuthority: false,
        cleanupAuthority: false, pullRequestMutation: false, providerProjection: "deferred",
        crossDeviceResumeAuthority: false };
      const terminalEvidenceDigest = stableActiveDescendantUntrackedTerminalDigest(terminalEvidence);
      const core = { terminalEvidence, terminalEvidenceDigest,
        mutationAuthorityReceiptDigest: mutation.receiptDigest,
        cloudVerificationReceiptDigest: verified.verification.receiptDigest };
      return Object.freeze({ ...core, receiptDigest: digestValue(core) });
    },
  };
  return Object.freeze(adapter);

  function gitExit(args) { try { git(args); return 0; } catch { return 1; } }
  function requireExternalInputs(plan) {
    const target = manifest(plan.evidence.lease.scope), stop = ownerStop();
    if (target.manifestDigest !== plan.targetManifestDigest
      || stop.receiptDigest !== plan.evidence.ownerStop.receiptDigest) invalid("external evidence drift");
  }
  function journalPath(plan) {
    const root = path.join(commonDirectory, "agentic-canvas-os", OPERATION);
    mkdirSync(root, { recursive: true, mode: 0o700 });
    return path.join(root, `${digestText(plan.sourceClaimId)}.${digestText(plan.planDigest)}.json`);
  }
}

export function assertActiveDescendantUntrackedIncidentShape({ lease, lane, dirt, stop, target }) {
  if (stop.sourceHeadSha !== lane.headSha || stop.sourceFenceSha !== lane.remoteFenceSha) invalid("owner-stop revision identity");
  const untracked = dirt.entries.filter(item => item.untracked).map(item => item.path).sort();
  if (canonicalJson(untracked) !== canonicalJson(stop.untrackedPaths)
    || dirt.entries.filter(item => !item.untracked).some(item => !covered(lease.admission.declaredWriteSet, item.path))
    || untracked.some(item => covered(lease.admission.declaredWriteSet, item))
    || untracked.some(item => !covered(target.declaredWriteSet, item))) invalid("tracked/untracked scope partition");
  const source = normalizeWriteSet(lease.admission.declaredWriteSet);
  const future = normalizeWriteSet(target.declaredWriteSet);
  if (!(future.length > source.length && source.every(item => future.includes(item)))) invalid("strict-superset target manifest");
}
const requireIncidentShape = assertActiveDescendantUntrackedIncidentShape;
function claimEvidence(claim, status) { const claimIds = status.claims.map(item => item.claimId).sort();
  return Object.freeze({ ...claim, schema: "agentic-current-cloud-claim-evidence/v1",
    claimDigest: claim.fenceRevision, claimLedgerRevision: claim.transitionDigest,
    ledgerRevision: status.ledgerRevision, ledgerDigest: status.ledgerDigest,
    inventoryDigest: digestValue(status.claims), verificationReceiptDigest: digestValue({
      ledgerRevision: status.ledgerRevision, ledgerDigest: status.ledgerDigest, claimIds }) }); }
function assertSourceRetiredOrAbsent(plan, status) {
  const matches = status.claims.filter(item => item.claimId === plan.sourceClaimId);
  if (matches.length > 1 || (matches[0] && (!["retired", "released"].includes(matches[0].state)
    || matches[0].writeAuthority === true || matches[0].scopeReserved === true))) invalid("retired source claim");
}
function successorAdmission(source, plan, authority) { const core = {
  schema: "agentic-lane-admission-lease/v1", status: "admitted",
  semanticScope: source.semanticScope,
  declaredWriteSet: plan.evidence.targetManifest.declaredWriteSet,
  writeSetDigest: plan.targetWriteSetDigest, manifestDigest: plan.targetManifestDigest,
  planReceiptDigest: plan.planDigest, admissionReceiptDigest: authority.operationReceiptDigest,
  existingLaneStateDigest: source.existingLaneStateDigest,
  admittedReportDigest: digestValue({ operation: OPERATION, planDigest: plan.planDigest,
    claimId: authority.claimId }), preservationReceiptDigest: digestValue({ operation: OPERATION,
    sourceAdmissionDigest: digestValue(source), planDigest: plan.planDigest }) };
  return Object.freeze(core); }
function authorityFrom(plan, status, claim) { return normalizeBoundAuthority({ result: {
  schema: "agentic-cloud-collaboration-result/v1", ok: true, action: "continue",
  ledgerRevision: status.ledgerRevision, ledgerDigest: status.ledgerDigest,
  claimDigest: claim.fenceRevision, claim }, authority: { ...plan.evidence.lease.cloudAuthority,
  canonicalBaseSha: plan.evidence.lease.baseSha, laneRevision: claim.laneRevision,
  cloudDeclaredWriteScope: plan.evidence.targetManifest.declaredWriteSet,
  writeSetDigest: plan.targetWriteSetDigest, leaseEpoch: plan.targetCloudLeaseEpoch,
  reviewRequestId: claim.reviewRequestId, state: "active",
  manifestDigest: plan.targetManifestDigest }, manifest: plan.evidence.targetManifest,
  deviceId: plan.evidence.lease.device, sessionId: plan.evidence.lease.sessionId }); }
function boundAuthority(plan, status, claim) { return isBound(plan, claim) ? authorityFrom(plan, status, claim) : null; }
function isBound(plan, claim) { return claim?.state === "current"
  && claim.laneRevision === plan.sourceFenceSha
  && claim.reviewRequestId === plan.evidence.claim.reviewRequestId; }
function successorValues(claim, result) { const core = { claimId: claim.claimId,
  claimDigest: claim.fenceRevision, transitionCounter: claim.transitionCounter,
  state: claim.state, predecessorClaimId: claim.predecessorClaimId,
  writeSetDigest: claim.writeSetDigest, laneRevision: claim.laneRevision,
  operationReceiptDigest: claim.operationReceiptDigest,
  receiptDigest: result?.receipt?.receiptDigest || claim.operationReceiptDigest };
  return Object.freeze(core); }
function retirementValues(plan, result) { const claim = result?.claim;
  if (claim?.claimId !== plan.sourceClaimId || !["retired", "released"].includes(claim.state)) invalid("source retirement result");
  const core = { sourceClaimId: claim.claimId,
    sourceClaimDigest: claim.fenceRevision, transitionCounter: claim.transitionCounter,
    state: claim.state, operationReceiptDigest: result.receipt?.receiptDigest
      || claim.operationReceiptDigest, receiptDigest: result.receipt?.receiptDigest
      || claim.operationReceiptDigest };
  return Object.freeze(core); }
function phase(intent, name) { const values = intent?.phases?.[name]?.values;
  if (!values) invalid(`${name} phase receipt`); return values; }
function readJournal(file) { if (!existsSync(file)) return null;
  const value = JSON.parse(readFileSync(file, "utf8"));
  if (value?.schema !== JOURNAL_SCHEMA || value.intentDigest !== digestValue(value.intent)) invalid("recovery journal");
  return normalizeActiveDescendantUntrackedScopeRecoveryIntent(value.intent); }
function writeJournal(file, expected, next) { const current = readJournal(file);
  if (digestValue(current) !== digestValue(expected)) invalid("recovery journal CAS");
  const envelope = { schema: JOURNAL_SCHEMA, intent: next, intentDigest: digestValue(next) };
  const temporary = `${file}.${process.pid}.${process.hrtime.bigint()}.tmp`;
  let descriptor; try { descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(envelope, null, 2)}\n`); fsyncSync(descriptor);
    closeSync(descriptor); descriptor = null; renameSync(temporary, file);
  } finally { if (descriptor) closeSync(descriptor); if (existsSync(temporary)) unlinkSync(temporary); }
  return next; }
function externalFile(value, label, roots) { if (!path.isAbsolute(String(value || ""))) invalid(`${label} absolute path`);
  const target = realpathSync(path.resolve(value)), stat = lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()
    || roots.some(root => target === root || target.startsWith(`${root}${path.sep}`))) invalid(`${label} external file`);
  return target; }
function pathExists(value) { try { lstatSync(value); return true; }
  catch (error) { if (error?.code === "ENOENT") return false; throw error; } }
function readExternalJson(file, label) { try { return JSON.parse(readFileSync(file, "utf8")); }
  catch (error) { throw new Error(`${label} JSON is invalid: ${error.message}`); } }
function bodyRemainder(value) { return String(value).replace(/<!--\s*agentic-writer-lease\/v2\s+\{.*?\}\s*-->/gsu, ""); }
function withoutBody(value) { const { body: _body, ...rest } = value; return rest; }
function indexDigest(dirt) { return digestValue(dirt.entries.map(item => ({ path: item.path,
  indexMode: item.indexMode, indexBlob: item.indexBlob, staged: item.staged }))); }
function covered(writeSet, candidate) { return normalizeWriteSet(writeSet).some(item => item.startsWith("path:")
  && (item.slice(5) === "." || candidate === item.slice(5) || candidate.startsWith(`${item.slice(5)}/`))); }
function nul(value) { return String(value).split("\0").filter(Boolean); }
function lines(value) { return String(value).split(/\r?\n/u).filter(Boolean); }
function firstSha(value) { return sha(String(value).trim().split(/\s+/u)[0], "remote SHA"); }
function safePath(value) { const result = text(value, "repository-relative path").replaceAll("\\", "/");
  if (path.posix.isAbsolute(result) || result.split("/").some(part => !part || part === ".." || part === ".")) invalid("repository-relative path"); return result; }
function sha(value, label) { const result = text(value, label); if (!/^[0-9a-f]{40}$/u.test(result)) invalid(label); return result; }
function digestText(value) { const result = text(value, "digest"); if (!/^[0-9a-f]{64}$/u.test(result)) invalid("digest"); return result; }
function text(value, label) { const result = String(value ?? "").trim(); if (!result) invalid(label); return result; }
function instant(value, label) { const result = text(value, label), time = Date.parse(result);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== result) invalid(label); return result; }
function positive(value, label) { if (!Number.isSafeInteger(value) || value < 1) invalid(label); return value; }
function integer(value, label, minimum, maximum) { if (!Number.isSafeInteger(value)
  || value < minimum || value > maximum) invalid(label); return value; }
function deepFreeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) {
  Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; }
function invalid(label) { throw new Error(`Active descendant/untracked recovery has invalid ${label}.`); }
