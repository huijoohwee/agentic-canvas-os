// Responsibility: Adopt one historical cloud derivative through metadata-only, exact-CAS ports.
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { canonicalJson, digestValue, normalizeRootIntent, normalizeWriteSet, writeSetsOverlap } from "./cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "./github-cloud-collaboration-mapping.mjs";
import { assertActivePublishPathsAdmitted } from "./active-publish-write-scope.mjs";
import { continueActivePublishTaskAuthoritySuccessor } from "./active-publish-task-authority-successor.mjs";
import { invokeRepositoryCloudAction, verifyAdmissionCloudAuthority } from "./scoped-lane-cloud-authority.mjs";
import { normalizeBoundAuthority } from "./scoped-lane-cloud-reconciliation.mjs";
import { normalizeDeclaredWriteScopeManifest } from "./scoped-lane-admission-lib.mjs";
import { authorizeTaskBoundLeaseMutation } from "./task-bound-lane-authority-store.mjs";
import { WRITER_LEASE_SCHEMA, createWriterLeaseStore, parseWriterLeasePullRequestBody, projectWriterLeasePullRequestMarker, updateWriterLeasePullRequestBody } from "./writer-lease-lib.mjs";
import { mutateWriterLeaseRegistry, withHeartbeatProjectionFence, writerLeaseDigest } from "./writer-lease-registry-cas.mjs";
import { ACTIVE_PUBLISH_HISTORICAL_DERIVATIVE_RECOVERY_TERMINAL_SCHEMA, normalizeActivePublishHistoricalDerivativeRecoveryPlan } from "./active-publish-historical-derivative-recovery-contract.mjs";
import { activePublishHistoricalDerivativeRecoveryDecisionSubject, assertActivePublishHistoricalDerivativeClaimState, assertActivePublishHistoricalDerivativeRecoveryPhase,
  assertActivePublishHistoricalDerivativeRecoveryReadback, assertActivePublishHistoricalDerivativeStableClaim as assertStableDerivative, assertActivePublishHistoricalDerivativeTaskReceipt,
  buildActivePublishHistoricalDerivativeRecoveryEvidence, classifyActivePublishHistoricalDerivativeReviewMarker, classifyActivePublishHistoricalDerivativeTransition, projectActivePublishHistoricalDerivativeConflicts } from "./active-publish-historical-derivative-recovery-evidence.mjs";
const REVIEW_ADAPTER_ID = "github-cli-hidden-writer-marker/v1";
const CLOUD_REQUEST_SCHEMA = "agentic-active-publish-historical-derivative-cloud-request/v1";
const RECOVERY_RECEIPT_SCHEMA = "agentic-active-publish-historical-derivative-registry-recovery/v1", REGISTRY_RECEIPT_SCHEMA = "agentic-active-publish-historical-derivative-registry-projection/v1";
export const ACTIVE_PUBLISH_HISTORICAL_DERIVATIVE_RECOVERY_IMPLEMENTATION_PATHS = Object.freeze(["scripts/active-publish-historical-derivative-recovery-contract.mjs", "scripts/active-publish-historical-derivative-recovery-controller.mjs", "scripts/active-publish-historical-derivative-recovery-evidence.mjs",
  "scripts/active-publish-historical-derivative-recovery-repository-adapter.mjs", "scripts/active-publish-historical-derivative-recovery-store.mjs", "scripts/active-publish-historical-derivative-recovery.mjs"]);
export function createActivePublishHistoricalDerivativeRecoveryRepositoryAdapter(options = {}, dependencies = {}) {
  const controllerRoot = canonical(options.repository, "controller repository");
  const worktreePath = canonical(options.worktreePath, "target worktree");
  const branch = required(options.branch, "target branch");
  const sessionId = required(options.sessionId, "operator session");
  const pullRequestNumber = positive(options.pullRequestNumber, "pull request");
  const manifestFile = externalFile(options.manifestFile, [controllerRoot, worktreePath], "manifest");
  const taskAuthorityFile = options.taskAuthorityFile ? externalFile(options.taskAuthorityFile, [controllerRoot, worktreePath], "task authority") : null;
  const execute = dependencies.execute || defaultExecute;
  const git = dependencies.git || ((cwd, args) => execute("git", ["-C", cwd, ...args], controllerRoot).trim());
  const gitRaw = dependencies.gitRaw || ((cwd, args) => execute("git", ["-C", cwd, ...args], controllerRoot));
  const gh = dependencies.gh || ((args) => execute("gh", args, controllerRoot).trim());
  const now = dependencies.now || (() => new Date());
  const invokeCloud = dependencies.invokeCloud || invokeRepositoryCloudAction;
  const verifyCloud = dependencies.verifyCloud || verifyAdmissionCloudAuthority;
  const environment = fencedEnvironment(dependencies.environment || process.env);
  const commonDirectory = realpathSync(path.resolve(controllerRoot, git(controllerRoot, ["rev-parse", "--git-common-dir"])));
  const leaseStore = dependencies.leaseStore ||
    createWriterLeaseStore({
      gitCommonDir: commonDirectory, taskAuthorityPolicy: "projected", });
  const manifest = normalizeDeclaredWriteScopeManifest(JSON.parse(readFileSync(manifestFile, "utf8")));
  function readPlanEvidence() {
    return capturePair().evidence;
  }
  function assertSource(rawPlan, stage = "source-verification") {
    const plan = normalizeActivePublishHistoricalDerivativeRecoveryPlan(rawPlan);
    const current = capturePair();
    if (["before-cloud-recovery", "before-registry-projection-prepare", "before-registry-projection"].includes(stage)) {
      assertActivePublishHistoricalDerivativeLocalSubject(current.evidence, plan.evidence, stage);
      assertStableDerivative(current.evidence.cloud.claim, plan.evidence.cloud.claim, true);
      return current.evidence;
    }
    if (canonicalJson(activePublishHistoricalDerivativeRecoveryDecisionSubject(current.evidence)) !== canonicalJson(activePublishHistoricalDerivativeRecoveryDecisionSubject(plan.evidence))) {
      throw new Error(`Historical derivative recovery source drifted at ${stage}.`);
    }
    return current.evidence;
  }
  function authorizeTask(rawPlan) {
    const plan = normalizeActivePublishHistoricalDerivativeRecoveryPlan(rawPlan);
    assertSource(plan, "task-authority-verification");
    if (!taskAuthorityFile) throw new Error("Recovery run requires --task-authority.");
    return authorizeTaskBoundLeaseMutation({
      lease: requireSourceLease(leaseStore.read(branch), plan), capabilityPath: taskAuthorityFile, operation: `active-publish-historical-derivative-recovery:${plan.planDigest}`, now: now(), });
  }
  function sealCloudRequest(rawPlan) {
    const plan = normalizeActivePublishHistoricalDerivativeRecoveryPlan(rawPlan);
    const claim = plan.evidence.cloud.claim;
    const request = {
      targetRepository: plan.evidence.cloud.targetRepository, claimId: claim.claimId, expectedFenceRevision: claim.fenceRevision, expectedLedgerRevision: plan.evidence.cloud.ledgerRevision,
      expectedLedgerDigest: plan.evidence.cloud.ledgerDigest, expectedTransitionCounter: claim.transitionCounter, mode: "recovery", ttlSeconds: plan.ttlSeconds, recoveryEvidenceDigest: digestValue({
        schema: "agentic-active-publish-historical-derivative-cloud-evidence/v1", planDigest: plan.planDigest, evidenceDigest: plan.evidenceDigest, }), deviceId: plan.evidence.sourceLease.device,
      sessionId: plan.evidence.sourceLease.sessionId, idempotencyKey: digestValue(`active-publish-historical-derivative-recovery:${plan.planDigest}`), };
    const core = {
      schema: CLOUD_REQUEST_SCHEMA, planDigest: plan.planDigest, evidenceDigest: plan.evidenceDigest, ledgerRepository: plan.evidence.cloud.ledgerRepository, sourceState: claim.state, request, };
    return Object.freeze({ ...core, requestDigest: digestValue(core) });
  }
  function recoverCloud(rawPlan, { sealedRequest }) {
    const plan = normalizeActivePublishHistoricalDerivativeRecoveryPlan(rawPlan);
    const expected = sealCloudRequest(plan);
    if (canonicalJson(expected) !== canonicalJson(sealedRequest)) {
      throw new Error("Historical derivative cloud request changed after sealing.");
    }
    let status = readStableCloudStatus(plan.evidence.cloud);
    let claim = claimProjection(exactClaim(status.claims, plan.evidence.cloud.claim.claimId));
    const source = plan.evidence.cloud.claim;
    const transition = classifyActivePublishHistoricalDerivativeTransition(claim, source);
    let result = null;
    let cloudMutation = false;
    if (transition !== "adopt-current") {
      const frame = assertSource(plan, "before-cloud-recovery");
      assertActivePublishHistoricalDerivativeRecoveryReadback(claim, frame.cloud.claim);
      result = invokeCloud({
        action: "continue", ledgerRepository: expected.ledgerRepository, request: expected.request, environment, });
      const returnedClaim = assertActivePublishHistoricalDerivativeRecoveryResult(result, plan, expected, { replayCandidate: transition === "replay-recovery" });
      status = readStableCloudStatus(plan.evidence.cloud);
      claim = claimProjection(exactClaim(status.claims, source.claimId));
      assertActivePublishHistoricalDerivativeRecoveryReadback(returnedClaim, claim);
      assertActivePublishHistoricalDerivativeRecoveryLedgerReadback(result, status);
      cloudMutation = true;
    }
    const projectedAuthority = derivativeAuthority({ plan, status, claim });
    const verified = verifyCloud({
      authority: projectedAuthority, manifest: sourceManifest(plan), canonicalBaseSha: claim.canonicalBaseRevision, environment, });
    const { authority, verification } = requireCloudVerification(verified, projectedAuthority, claim);
    const core = {
      claimId: claim.claimId, authority, claim, operationReceiptDigest: claim.operationReceiptDigest, verification, verificationReceiptDigest: verification.receiptDigest,
      recoveredAt: result?.operationReceipt?.evaluationTime || now().toISOString(), expiresAt: claim.expiresAt, disposition: result ? (result.replayed ? "adopted-recovery" : "recovered") : "adopted-current", cloudMutation, };
    return Object.freeze({ ...core, resultDigest: digestValue(core) });
  }
  function prepareRegistryProjection(rawPlan, { intent }) {
    const plan = normalizeActivePublishHistoricalDerivativeRecoveryPlan(rawPlan);
    const taskReceipt = intent.phases.task_authority_verified.values;
    const recovery = intent.phases.cloud_recovered.values;
    return buildRegistryProjection(plan, recovery, taskReceipt, now().toISOString());
  }
  function projectRegistry(rawPlan, { intent, projection }) {
    const plan = normalizeActivePublishHistoricalDerivativeRecoveryPlan(rawPlan);
    const recovery = intent.phases.cloud_recovered.values;
    const taskReceipt = intent.phases.task_authority_verified.values;
    const expected = buildActivePublishHistoricalDerivativeRegistryProjection({
      plan, recovery, taskReceipt, sourceLease: plan.evidence.sourceLease.lease,
      boundAt: projection.targetLease.taskAuthority.boundAt, });
    if (canonicalJson(expected) !== canonicalJson(projection)) {
      throw new Error("Prepared historical derivative registry projection drifted.");
    }
    const current = leaseStore.read(branch);
    if (current && writerLeaseDigest(current) === projection.targetLeaseDigest) {
      verifyProjectedCloud(plan, recovery);
      return projectedRegistryValues(projection, leaseStore.readRegistry().revision, false);
    }
    requireSourceLease(current, plan);
    if (!taskAuthorityFile) throw new Error("Recovery run requires --task-authority.");
    authorizeTaskBoundLeaseMutation({
      lease: current, capabilityPath: taskAuthorityFile, operation: `active-publish-historical-derivative-recovery:${plan.planDigest}:registry`, now: now(), });
    verifyProjectedCloud(plan, recovery);
    const frame = assertSource(plan, "before-registry-projection");
    assertActivePublishHistoricalDerivativeRecoveryReadback(recovery.claim, frame.cloud.claim);
    const result = mutateWriterLeaseRegistry({
      leaseStore, branch, expectedLeaseDigest: plan.evidence.sourceLease.leaseDigest, expectedClaimId: plan.evidence.sourceLease.sourceClaimId, action: ({ registry, lease }) => {
        requireSourceLease(lease, plan);
        return {
          registry: {
            ...registry, leases: { ...registry.leases, [branch]: projection.targetLease }, }, lease: projection.targetLease, changed: true, }; }, });
    if (writerLeaseDigest(result.lease) !== projection.targetLeaseDigest) {
      throw new Error("Historical derivative registry CAS returned unexpected bytes.");
    }
    return projectedRegistryValues(projection, result.registryRevision, true);
  }
  function projectReviewMarker(rawPlan, { intent }) {
    const plan = normalizeActivePublishHistoricalDerivativeRecoveryPlan(rawPlan);
    const projected = intent.phases.registry_projected.values;
    const targetLease = requireTargetLease(leaseStore.read(branch), projected.targetLeaseDigest);
    return withHeartbeatProjectionFence({
      leaseStore, branch, expectedLeaseDigest: projected.targetLeaseDigest, expectedClaimId: plan.evidence.cloud.claim.claimId,
      action: () => { verifyProjectedCloud(plan, intent.phases.cloud_recovered.values); assertUnchangedRepository(plan); return projectReviewMarkerLocked(plan, targetLease); }, });
  }
  function projectReviewMarkerLocked(plan, targetLease) {
    if (Number(JSON.parse(gh(["api", "user"])).id) !== plan.evidence.cloud.authenticatedOwner.id) throw new Error("Historical derivative provider owner drifted.");
    let review = readReview();
    assertReviewIdentity(review, plan.evidence.review);
    const targetBody = updateWriterLeasePullRequestBody(review.body, targetLease);
    if (visibleBodyDigest(targetBody) !== plan.evidence.review.visibleBodyDigest) {
      throw new Error("Historical derivative marker projection changed visible review content.");
    }
    const targetMarkerDigest = digestValue(projectWriterLeasePullRequestMarker(targetLease));
    const targetBodyDigest = digestValue(targetBody);
    const markerDisposition = classifyActivePublishHistoricalDerivativeReviewMarker({
      sourceBodyDigest: plan.evidence.review.bodyDigest, targetBodyDigest,
      observedBodyDigest: digestValue(review.body), });
    if (markerDisposition.disposition === "project-source") {
      try {
        gh(["pr", "edit", review.url, "--body", targetBody]);
      } catch {}
      review = readReview();
    }
    if (review.body !== targetBody || digestValue(parseWriterLeasePullRequestBody(review.body)) !== targetMarkerDigest) {
      throw new Error("Historical derivative hidden review marker did not converge.");
    }
    const core = {
      schema: "agentic-active-publish-historical-derivative-review-marker/v1", planDigest: plan.planDigest, reviewId: plan.evidence.review.id, sourceBodyDigest: plan.evidence.review.bodyDigest,
      targetBodyDigest, visibleBodyDigest: plan.evidence.review.visibleBodyDigest, targetMarkerDigest, projectedAt: now().toISOString(), providerMutation: markerDisposition.providerMutation, reviewMarkerProjected: true, };
    return Object.freeze({ ...core, receiptDigest: digestValue(core) });
  }
  function verifyTerminal(rawPlan, { intent }) {
    const plan = normalizeActivePublishHistoricalDerivativeRecoveryPlan(rawPlan);
    const registry = intent.phases.registry_projected.values;
    const marker = intent.phases.review_marker_projected.values;
    const cloud = intent.phases.cloud_recovered.values;
    const current = requireTargetLease(leaseStore.read(branch), registry.targetLeaseDigest);
    assertActivePublishHistoricalDerivativeTerminalReceiptJoins(plan, intent, current);
    assertUnchangedRepository(plan);
    const review = readReview();
    assertReviewIdentity(review, plan.evidence.review);
    if (digestValue(review.body) !== marker.targetBodyDigest || visibleBodyDigest(review.body) !== marker.visibleBodyDigest
      || digestValue(parseWriterLeasePullRequestBody(review.body)) !== marker.targetMarkerDigest) {
      throw new Error("Terminal historical derivative review marker drifted.");
    }
    verifyProjectedCloud(plan, cloud);
    const core = {
      schema: ACTIVE_PUBLISH_HISTORICAL_DERIVATIVE_RECOVERY_TERMINAL_SCHEMA, planDigest: plan.planDigest, evidenceDigest: plan.evidenceDigest, claimId: cloud.claimId, sourceLeaseDigest: plan.evidence.sourceLease.leaseDigest,
      targetLeaseDigest: writerLeaseDigest(current), taskAuthorityReceiptDigest: registry.taskAuthorityReceiptDigest, successorReceiptDigest: registry.successorReceiptDigest,
      registryProjectionReceiptDigest: registry.registryProjectionReceiptDigest, reviewMarkerReceiptDigest: marker.receiptDigest, cloudOperationReceiptDigest: cloud.operationReceiptDigest,
      cloudVerificationReceiptDigest: cloud.verificationReceiptDigest, visibleBodyDigest: marker.visibleBodyDigest, verifiedAt: marker.projectedAt, cloudMutation: cloud.cloudMutation, providerMutation: marker.providerMutation,
      writerRegistryMutation: registry.writerRegistryMutation, taskAuthorityProjected: registry.taskAuthorityProjected, reviewMarkerProjected: marker.reviewMarkerProjected,
      activePublishSuccessorIntentCleared: registry.activePublishSuccessorIntentCleared, gitMutation: false, sourceMutation: false, branchMutation: false, worktreeMutation: false, refMutation: false, integrationMutation: false,
      mergeMutation: false, releaseMutation: false, retirementMutation: false, deploymentMutation: false, cleanupMutation: false, newClaim: false, newPullRequest: false, };
    return Object.freeze({ ...core, verificationDigest: digestValue(core) });
  }
  function capturePair() {
    const first = captureFrame();
    const second = captureFrame();
    if (canonicalJson(activePublishHistoricalDerivativeRecoveryDecisionSubject(first.evidence)) !== canonicalJson(activePublishHistoricalDerivativeRecoveryDecisionSubject(second.evidence))) {
      throw new Error("Historical derivative evidence changed during double capture.");
    }
    return second;
  }
  function captureFrame() {
    const lease = requireSourceLease(leaseStore.read(branch));
    const records = parseWorktrees(gitRaw(controllerRoot, ["worktree", "list", "--porcelain", "-z"]));
    const matches = records.filter((record) => path.resolve(record.path) === worktreePath);
    const laneStatus = gitRaw(worktreePath, ["status", "--porcelain=v2", "-z", "--untracked-files=all"]);
    const controllerStatus = gitRaw(controllerRoot, ["status", "--porcelain=v2", "-z", "--untracked-files=all"]);
    const laneHead = git(worktreePath, ["rev-parse", "HEAD"]);
    const controllerHead = git(controllerRoot, ["rev-parse", "HEAD"]);
    const originMain = git(controllerRoot, ["rev-parse", "origin/main"]);
    const remoteMain = remoteHead("main");
    const remoteLane = remoteHead(branch);
    if (matches.length !== 1 || matches[0].branch !== `refs/heads/${branch}` || git(worktreePath, ["branch", "--show-current"]) !== branch || git(controllerRoot, ["branch", "--show-current"]) !== "main" || laneStatus || controllerStatus || laneHead !== remoteLane || controllerHead !== originMain || controllerHead !== remoteMain) {
      throw new Error("Historical derivative Git/controller frame is not clean and exact.");
    }
    const intent = lease.activePublishSuccessorIntent;
    const historicalBase = required(intent?.targetCanonicalBaseSha, "historical base");
    git(controllerRoot, ["merge-base", "--is-ancestor", historicalBase, controllerHead]);
    const mergeBases = git(controllerRoot, ["merge-base", "--all", controllerHead, laneHead]).split(/\s+/u).filter(Boolean).sort();
    if (mergeBases.length !== 1 || mergeBases[0] !== historicalBase) {
      throw new Error("Historical derivative lacks its unique historical merge base.");
    }
    const authoredPaths = nulPaths(gitRaw(worktreePath, ["--no-replace-objects", "diff", "--no-ext-diff", "--no-renames", "--name-only", "-z", historicalBase, laneHead, "--"]));
    const protectedChangedPaths = nulPaths(gitRaw(controllerRoot, ["--no-replace-objects", "diff", "--no-ext-diff", "--no-renames", "--name-only", "-z", historicalBase, controllerHead, "--"]));
    const admitted = assertActivePublishPathsAdmitted({
      paths: authoredPaths, admission: lease.admission, });
    if ( writeSetsOverlap( protectedChangedPaths.map((item) => `path:${item}`), lease.admission.declaredWriteSet, ) ) {
      throw new Error("Protected-main advance overlaps the historical derivative scope.");
    }
    const reviewValue = readReview();
    const review = reviewEvidence(reviewValue);
    const ownerValue = JSON.parse(gh(["api", "user"]));
    const status = readCloudStatus(lease.cloudAuthority);
    const cloud = historicalCloudEvidence({
      status, lease, intent, ownerValue, });
    const preIntent = { ...lease };
    delete preIntent.activePublishSuccessorIntent;
    const evidence = buildActivePublishHistoricalDerivativeRecoveryEvidence({
      observedAt: now().toISOString(), controller: {
        repository: repositoryId(), headSha: controllerHead, treeSha: git(controllerRoot, ["rev-parse", "HEAD^{tree}"]), originMainSha: originMain, remoteMainSha: remoteMain, clean: true,
        implementationDigest: implementationDigest(controllerHead), }, canonicalAdvance: {
        historicalBaseSha: historicalBase, protectedMainSha: controllerHead, mergeBases, protectedMainDescendant: true, authoredPaths, authoredPathsDigest: digestValue(authoredPaths), protectedChangedPaths,
        protectedChangedPathsDigest: digestValue(protectedChangedPaths), noWriteSetOverlap: true, }, lane: {
        repository: repositoryId(), worktreePath, branch, headSha: laneHead, treeSha: git(worktreePath, ["rev-parse", "HEAD^{tree}"]), remoteHeadSha: remoteLane, statusDigest: digestValue(laneStatus), registered: true,
        clean: true, admittedPaths: admitted.admittedPaths, admittedPathsDigest: digestValue(admitted.admittedPaths), }, sourceLease: leaseEvidence(lease, writerLeaseDigest(preIntent)), intent, review, cloud, });
    return Object.freeze({ evidence, lease, status });
  }
  function buildRegistryProjection(plan, recovery, taskReceipt, boundAt) {
    return buildActivePublishHistoricalDerivativeRegistryProjection({
      plan, recovery, taskReceipt, sourceLease: requireSourceLease(leaseStore.read(branch), plan), boundAt, });
  }
  function verifyProjectedCloud(plan, recovery) {
    const status = readStableCloudStatus(plan.evidence.cloud);
    const claim = exactClaim(status.claims, recovery.claimId);
    const conflicts = projectActivePublishHistoricalDerivativeConflicts(status.claims, claim);
    assertStableDerivative(claimProjection(claim), plan.evidence.cloud.claim, true);
    if (conflicts.competingClaimIds.length || conflicts.downstreamClaimIds.length || claim.state !== "current" || claim.fenceRevision !== recovery.authority.claimDigest || claim.transitionCounter !== recovery.authority.transitionCounter || claim.operationReceiptDigest !== recovery.operationReceiptDigest || Date.parse(claim.expiresAt) <= now().getTime()) {
      throw new Error("Recovered historical derivative cloud authority drifted.");
    }
    return claim;
  }
  function requireSourceLease(value, plan = null) {
    const intent = value?.activePublishSuccessorIntent;
    const admission = value?.admission;
    const manifestExact = admission?.semanticScope === manifest.semanticScope
      && admission.manifestDigest === manifest.manifestDigest && admission.writeSetDigest === manifest.writeSetDigest
      && canonicalJson(normalizeWriteSet(admission.declaredWriteSet)) === canonicalJson(manifest.declaredWriteSet);
    if (!value || value.schema !== WRITER_LEASE_SCHEMA || value.status !== "active" || admission?.status !== "admitted" || !manifestExact || value.branch !== branch || value.sessionId !== sessionId || path.resolve(value.worktreePath || "") !== worktreePath || value.pullRequestUrl?.split("/").at(-1) !== String(pullRequestNumber) || !value.taskAuthority || !value.cloudAuthority || intent?.schema !== "agentic-active-publish-successor-intent/v1" || intent.status !== "prepared" || value.activePublishTaskAuthoritySuccessor || value.activePublishHistoricalDerivativeRecovery) {
      throw new Error("Recovery requires the exact prepared historical source lease.");
    }
    if (plan && writerLeaseDigest(value) !== plan.evidence.sourceLease.leaseDigest) {
      throw new Error("Historical derivative source lease changed from the plan.");
    }
    return value;
  }
  function assertUnchangedRepository(plan) {
    const controllerHead = git(controllerRoot, ["rev-parse", "HEAD"]);
    const registered = parseWorktrees(gitRaw(controllerRoot, ["worktree", "list", "--porcelain", "-z"]))
      .filter(record => path.resolve(record.path) === worktreePath);
    if (registered.length !== 1 || registered[0].branch !== `refs/heads/${branch}` || git(worktreePath, ["branch", "--show-current"]) !== branch || git(controllerRoot, ["branch", "--show-current"]) !== "main" || gitRaw(worktreePath, ["status", "--porcelain=v2", "-z", "--untracked-files=all"]) || gitRaw(controllerRoot, ["status", "--porcelain=v2", "-z", "--untracked-files=all"]) || git(worktreePath, ["rev-parse", "HEAD"]) !== plan.evidence.lane.headSha || remoteHead(branch) !== plan.evidence.lane.remoteHeadSha || controllerHead !== plan.evidence.controller.headSha || git(controllerRoot, ["rev-parse", "origin/main"]) !== controllerHead || remoteHead("main") !== controllerHead || implementationDigest(controllerHead) !== plan.evidence.controller.implementationDigest) {
      throw new Error("Terminal historical derivative repository frame drifted.");
    }
  }
  function readReview() {
    return JSON.parse(gh(["pr", "view", String(pullRequestNumber), "--repo", repositoryId(), "--json", "id,number,url,state,isDraft,autoMergeRequest,headRepository,headRefName,headRefOid,baseRefName,baseRefOid,body"]));
  }
  function reviewEvidence(value) {
    const marker = parseWriterLeasePullRequestBody(value.body);
    return {
      adapterId: REVIEW_ADAPTER_ID, id: value.id, number: value.number, url: value.url, state: String(value.state).toLowerCase(), draft: value.isDraft, autoDeliveryAbsent: value.autoMergeRequest === null,
      headRepository: value.headRepository?.nameWithOwner, headBranch: value.headRefName, headSha: value.headRefOid, baseBranch: value.baseRefName, baseSha: value.baseRefOid, marker, markerDigest: digestValue(marker),
      bodyDigest: digestValue(value.body), visibleBodyDigest: visibleBodyDigest(value.body), };
  }
  function assertReviewIdentity(value, evidence) {
    const projected = reviewEvidence(value);
    for (const key of ["adapterId", "id", "number", "url", "state", "draft", "autoDeliveryAbsent", "headRepository", "headBranch", "headSha", "baseBranch", "baseSha", "visibleBodyDigest"]) {
      if (projected[key] !== evidence[key]) throw new Error("Historical derivative review identity drifted.");
    }
  }
  function readCloudStatus(authority) {
    return readStableCloudStatus({
      ledgerRepository: authority.ledgerRepository, targetRepository: authority.targetRepository, });
  }
  function readStableCloudStatus(location) {
    const read = () =>
      invokeCloud({
        action: "status", ledgerRepository: location.ledgerRepository, request: { targetRepository: location.targetRepository }, environment, });
    const first = requireStatus(read());
    const second = requireStatus(read());
    if (canonicalJson(statusSubject(first)) !== canonicalJson(statusSubject(second))) {
      throw new Error("Historical derivative cloud ledger changed across live readback.");
    }
    return second;
  }
  function historicalCloudEvidence({ status, lease, intent, ownerValue }) {
    const claims = status.claims;
    const sourceMatches = claims.filter((item) => item?.claimId === intent.sourceClaimId);
    const candidates = claims.filter((item) => exactHistoricalDerivative(item, lease, intent));
    if (sourceMatches.length !== 0 || candidates.length !== 1) {
      throw new Error("Cloud inventory lacks one exact source-retired historical derivative.");
    }
    const claim = claimProjection(candidates[0]);
    const { competingClaimIds, downstreamClaimIds } =
      projectActivePublishHistoricalDerivativeConflicts(claims, claim);
    return {
      ledgerRepository: lease.cloudAuthority.ledgerRepository, targetRepository: lease.cloudAuthority.targetRepository, ledgerRevision: status.ledgerRevision, ledgerDigest: status.ledgerDigest, ledgerSequence: status.sequence,
      inventoryDigest: status.inventoryDigest ?? digestValue(status.claims), verificationReceiptDigest: status.verificationReceiptDigest ?? status.receiptDigest ?? digestValue(statusSubject(status)), authenticatedOwner: {
        id: Number(ownerValue.id), login: ownerValue.login, actorId: `github-user:${Number(ownerValue.id)}`, }, sourceClaimMatches: 0, derivativeMatches: 1, competingClaimIds, downstreamClaimIds, claim, };
  }
  function repositoryId() {
    return required(gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]), "repository identity");
  }
  function remoteHead(name) {
    const reference = `refs/heads/${name}`;
    const fields = git(controllerRoot, ["ls-remote", "--heads", "origin", reference]).split(/\s+/u);
    if (fields.length !== 2 || fields[1] !== reference) throw new Error(`Remote ${name} is ambiguous.`);
    return fields[0];
  }
  function implementationDigest(head) {
    return digestValue(ACTIVE_PUBLISH_HISTORICAL_DERIVATIVE_RECOVERY_IMPLEMENTATION_PATHS
      .map(file => ({ file, blob: git(controllerRoot, ["rev-parse", `${head}:${file}`]) })));
  }
  return Object.freeze({
    readPlanEvidence, assertSource, authorizeTask, sealCloudRequest, recoverCloud, prepareRegistryProjection, projectRegistry, projectReviewMarker, verifyTerminal, branch, gitCommonDir: commonDirectory, });
}
export function buildActivePublishHistoricalDerivativeRegistryProjection({
  plan: rawPlan, recovery, taskReceipt, sourceLease, boundAt, }) {
  const plan = normalizeActivePublishHistoricalDerivativeRecoveryPlan(rawPlan);
  if (writerLeaseDigest(sourceLease) !== plan.evidence.sourceLease.leaseDigest) {
    throw new Error("Historical derivative projection source lease drifted.");
  }
  assertActivePublishHistoricalDerivativeRecoveryPhase(plan, recovery);
  assertActivePublishHistoricalDerivativeTaskReceipt(plan, taskReceipt);
  const admission = successorAdmission({ plan, authority: recovery.authority, verification: recovery.verification });
  const targetBeforeBinding = {
    ...sourceLease, status: "active", baseSha: plan.evidence.intent.targetCanonicalBaseSha, fenceSha: plan.evidence.intent.targetHeadSha, heartbeatAt: boundAt,
    expiresAt: recovery.authority.expiresAt, admission, cloudAuthority: recovery.authority, activePublishSuccessorIntent: null, };
  const successor = continueActivePublishTaskAuthoritySuccessor({
    sourceLease, targetLease: targetBeforeBinding, cloudOperationReceiptDigest: recovery.operationReceiptDigest, cloudVerificationReceiptDigest: recovery.verificationReceiptDigest, boundAt, });
  const recoveryCore = {
    schema: RECOVERY_RECEIPT_SCHEMA, planDigest: plan.planDigest, evidenceDigest: plan.evidenceDigest, intentDigest: plan.evidence.intent.intentDigest,
    sourceClaimId: plan.evidence.sourceLease.sourceClaimId, targetClaimId: recovery.claimId, sourceBaseSha: sourceLease.baseSha, sourceFenceSha: sourceLease.fenceSha,
    targetBaseSha: targetBeforeBinding.baseSha, targetFenceSha: targetBeforeBinding.fenceSha, cloudOperationReceiptDigest: recovery.operationReceiptDigest,
    cloudVerificationReceiptDigest: recovery.verificationReceiptDigest, recoveredAt: boundAt, };
  const recoveryReceipt = Object.freeze({ ...recoveryCore, receiptDigest: digestValue(recoveryCore) });
  const targetLease = Object.freeze({
    ...targetBeforeBinding, taskAuthority: successor.binding, activePublishTaskAuthoritySuccessor: successor.receipt, activePublishHistoricalDerivativeRecovery: recoveryReceipt, });
  const registryCore = {
    schema: REGISTRY_RECEIPT_SCHEMA, planDigest: plan.planDigest, sourceLeaseDigest: plan.evidence.sourceLease.leaseDigest, targetLeaseDigest: writerLeaseDigest(targetLease), targetClaimId: recovery.claimId,
    targetBindingDigest: successor.binding.bindingDigest, successorReceiptDigest: successor.receipt.receiptDigest, recoveryReceiptDigest: recoveryReceipt.receiptDigest, };
  const receipt = Object.freeze({ ...registryCore, receiptDigest: digestValue(registryCore) });
  return Object.freeze({
    sourceLeaseDigest: registryCore.sourceLeaseDigest, expectedSourceClaimId: plan.evidence.sourceLease.sourceClaimId, targetLease, targetLeaseDigest: registryCore.targetLeaseDigest,
    taskAuthorityReceiptDigest: taskReceipt.receiptDigest, successorReceiptDigest: successor.receipt.receiptDigest, registryProjectionReceipt: receipt, registryProjectionReceiptDigest: receipt.receiptDigest, });
}
export { classifyActivePublishHistoricalDerivativeReviewMarker,
  classifyActivePublishHistoricalDerivativeTransition };
export function visibleBodyDigest(body) {
  const expression = new RegExp(`<!--\\s*${WRITER_LEASE_SCHEMA.replace("/", "\\/")}\\s+\\{.*?\\}\\s*-->`, "gs");
  const matches = String(body).match(expression) || [];
  if (matches.length !== 1) throw new Error("Review body must contain one hidden writer marker.");
  return digestValue(String(body).replace(expression, `<!-- ${WRITER_LEASE_SCHEMA} [hidden] -->`));
}
function leaseEvidence(lease, preIntentLeaseDigest) {
  return { lease, leaseDigest: writerLeaseDigest(lease), preIntentLeaseDigest, status: lease.status, admissionStatus: lease.admission.status, sessionId: lease.sessionId,
    device: lease.device, scope: lease.scope, branch: lease.branch, epoch: lease.epoch, baseSha: lease.baseSha, fenceSha: lease.fenceSha, pullRequestUrl: lease.pullRequestUrl,
    manifestDigest: lease.admission.manifestDigest, writeSetDigest: lease.admission.writeSetDigest, declaredWriteSet: lease.admission.declaredWriteSet, taskAuthorityBindingDigest: lease.taskAuthority.bindingDigest,
    cloudAuthorityDigest: digestValue(lease.cloudAuthority), sourceClaimId: lease.cloudAuthority.claimId, sourceClaimDigest: lease.cloudAuthority.claimDigest, sourceTransitionCounter: lease.cloudAuthority.transitionCounter,
    sourceOperationReceiptDigest: lease.cloudAuthority.operationReceiptDigest };
}
function exactHistoricalDerivative(claim, lease, intent) {
  const state = claimState(claim);
  return claim?.claimId !== intent.sourceClaimId && claim?.predecessorClaimId === intent.sourceClaimId
    && new Set(["current", "dormant-preserved"]).has(state) && claim.actorId === intent.sourceActorId
    && claim.deviceId === cloudOwner("device", intent.sourceDeviceId)
    && claim.sessionId === cloudOwner("session", intent.sourceSessionId)
    && claim.repositoryId === intent.sourceRepositoryId && claim.workItemId === intent.sourceWorkItemId
    && claim.entrySchema === intent.sourceEntrySchema
    && claim.claimIdentitySchema === intent.sourceClaimIdentitySchema
    && claim.canonicalBaseRevision === intent.targetCanonicalBaseSha
    && claim.laneRevision === intent.targetHeadSha && claim.leaseEpoch === intent.targetLeaseEpoch
    && claim.writeSetDigest === intent.writeSetDigest
    && canonicalJson(normalizeWriteSet(claim.declaredWriteScope))
      === canonicalJson(normalizeWriteSet(lease.admission.declaredWriteSet))
    && claim.reviewRequestId === intent.sourceReviewRequestId && claim.scopeReserved === true
    && (state === "current" ? claim.writeAuthority === true : claim.writeAuthority === false)
    && !claim.integration && !claim.integrationReceiptDigest;
}
function claimProjection(value) {
  const state = claimState(value);
  const projected = { claimId: value.claimId, fenceRevision: value.fenceRevision, transitionDigest: value.transitionDigest, operationReceiptDigest: value.operationReceiptDigest,
    actorId: value.actorId, deviceId: value.deviceId, sessionId: value.sessionId, repositoryId: value.repositoryId, workItemId: value.workItemId, entrySchema: value.entrySchema, claimIdentitySchema: value.claimIdentitySchema,
    canonicalBaseRevision: value.canonicalBaseRevision, laneRevision: value.laneRevision, declaredWriteScope: normalizeWriteSet(value.declaredWriteScope), writeSetDigest: value.writeSetDigest,
    leaseEpoch: value.leaseEpoch, transitionCounter: value.transitionCounter, heartbeatCounter: value.heartbeatCounter, predecessorClaimId: value.predecessorClaimId,
    reviewRequestId: value.reviewRequestId, state, recordedState: value.recordedState ?? "current", writeAuthority: value.writeAuthority, scopeReserved: value.scopeReserved,
    expiresAt: value.expiresAt, integrationReceiptDigest: value.integrationReceiptDigest ?? null, integration: value.integration ?? null };
  return assertActivePublishHistoricalDerivativeClaimState(projected);
}
function derivativeAuthority({ plan, status, claim }) {
  return normalizeBoundAuthority({ result: { schema: "agentic-cloud-collaboration-result/v1", ok: true, action: "continue", ledgerRevision: status.ledgerRevision,
    ledgerDigest: status.ledgerDigest, claimDigest: claim.fenceRevision, claim }, authority: { ...plan.evidence.sourceLease.lease.cloudAuthority, canonicalBaseSha: claim.canonicalBaseRevision, laneRevision: claim.laneRevision,
    cloudDeclaredWriteScope: claim.declaredWriteScope, writeSetDigest: claim.writeSetDigest, leaseEpoch: claim.leaseEpoch, transitionCounter: claim.transitionCounter,
    reviewRequestId: claim.reviewRequestId, state: "active", expiresAt: claim.expiresAt, manifestDigest: plan.evidence.sourceLease.manifestDigest }, manifest: sourceManifest(plan),
  deviceId: plan.evidence.sourceLease.device, sessionId: plan.evidence.sourceLease.sessionId });
}
function successorAdmission({ plan, authority, verification }) {
  const lease = plan.evidence.sourceLease.lease;
  const admission = lease.admission;
  const manifest = sourceManifest(plan);
  const existingLaneStateDigest = digestValue({ schema: "agentic-active-publish-successor-state/v1", branch: lease.branch, worktreePath: lease.worktreePath, sourceBaseSha: lease.baseSha,
    sourceFenceSha: lease.fenceSha, sourceClaimId: plan.evidence.intent.sourceClaimId, canonicalBaseSha: authority.canonicalBaseSha, headSha: authority.laneRevision, sourceAdmittedReportDigest: admission.admittedReportDigest });
  const planReceiptDigest = digestValue({ schema: "agentic-active-publish-successor-plan/v1", sourcePlanReceiptDigest: admission.planReceiptDigest, sourceAdmissionReceiptDigest: admission.admissionReceiptDigest,
    sourceAdmittedReportDigest: admission.admittedReportDigest, manifestDigest: manifest.manifestDigest, writeSetDigest: manifest.writeSetDigest, existingLaneStateDigest });
  const preservationReceiptDigest = digestValue({
    schema: "agentic-active-publish-successor-preservation/v1", predecessorClaimId: plan.evidence.intent.sourceClaimId, successorClaimId: authority.claimId,
    claimDigest: authority.claimDigest, manifestDigest: manifest.manifestDigest, sourceAdmittedReportDigest: admission.admittedReportDigest, existingLaneStateDigest });
  const admittedReportDigest = digestValue({ schema: "agentic-active-publish-successor-admission/v1", branch: lease.branch, semanticScope: manifest.semanticScope, manifestDigest: manifest.manifestDigest,
    writeSetDigest: manifest.writeSetDigest, canonicalBaseSha: authority.canonicalBaseSha, laneRevision: authority.laneRevision, claimId: authority.claimId, claimDigest: authority.claimDigest,
    verificationReceiptDigest: verification.receiptDigest, preservationReceiptDigest });
  return Object.freeze({ schema: "agentic-lane-admission-lease/v1", status: "admitted", semanticScope: manifest.semanticScope, declaredWriteSet: manifest.declaredWriteSet,
    writeSetDigest: manifest.writeSetDigest, manifestDigest: manifest.manifestDigest, planReceiptDigest, admissionReceiptDigest: verification.receiptDigest,
    existingLaneStateDigest, admittedReportDigest, preservationReceiptDigest });
}
function sourceManifest(plan) {
  return { semanticScope: plan.evidence.intent.semanticScope, declaredWriteSet: plan.evidence.sourceLease.declaredWriteSet, writeSetDigest: plan.evidence.sourceLease.writeSetDigest,
    manifestDigest: plan.evidence.sourceLease.manifestDigest };
}
function requireCloudVerification(value, authority, claim) {
  const bound = value?.authority;
  const verification = value?.verification;
  const stable = ["claimId", "canonicalBaseSha", "laneRevision", "writeSetDigest", "leaseEpoch",
    "transitionCounter", "reviewRequestId", "operationReceiptDigest", "manifestDigest", "ledgerRepository", "targetRepository", "deviceId", "sessionId"];
  if (!bound || stable.some(key => bound[key] !== authority[key])
    || canonicalJson(bound.cloudDeclaredWriteScope) !== canonicalJson(authority.cloudDeclaredWriteScope)
    || bound.claimDigest !== claim.fenceRevision || verification?.status !== "ready"
    || verification.claimId !== claim.claimId || verification.claimDigest !== bound.claimDigest
    || !verification.receiptDigest) {
    throw new Error("Historical derivative cloud verification did not join its authority.");
  }
  return { authority: bound, verification };
}
export function assertActivePublishHistoricalDerivativeRecoveryResult(result, plan, sealed, { replayCandidate }) {
  const source = plan.evidence.cloud.claim;
  const claim = result?.claim;
  const operation = result?.operationReceipt;
  const { receiptDigest: operationDigest, ...operationCore } = operation || {};
  const provider = result?.receipt;
  const { receiptDigest: providerDigest, ...providerCore } = provider || {};
  const normalizedRequest = normalizeRootIntent("continue", { ...sealed.request, expiresAt: claim?.expiresAt },
    { actorId: claim?.actorId, deviceId: claim?.deviceId, sessionId: claim?.sessionId }, claim?.repositoryId);
  const { expectedLedgerDigest: _transportCas, ...semanticIntent } = normalizedRequest;
  const expectedRequestDigest = digestValue({ action: "continue", intent: semanticIntent });
  if (result?.schema !== "agentic-cloud-collaboration-result/v1" || result.ok !== true
    || result.action !== "continue" || result.status !== "current" || ![true, false].includes(result.replayed)
    || claim?.claimId !== source.claimId || result.claimDigest !== claim.fenceRevision
    || claim.transitionCounter !== source.transitionCounter + 1 || claim.fenceRevision === source.fenceRevision
    || claim.predecessorClaimId !== source.predecessorClaimId || operation?.schema !== "agentic-collaboration-continuation-receipt/v1"
    || operation.operation !== "continue" || operation.status !== "current" || operation.repositoryId !== claim.repositoryId
    || operation.claimId !== source.claimId || operation.claimDigest !== claim.fenceRevision || operation.fenceRevision !== claim.fenceRevision
    || operation.ledgerRevision !== claim.transitionDigest || operation.idempotencyKey !== digestValue(sealed.request.idempotencyKey)
    || operation.requestDigest !== expectedRequestDigest || operationDigest !== digestValue(operationCore)
    || operationDigest !== claim.operationReceiptDigest || Date.parse(claim.expiresAt) !== Date.parse(operation.evaluationTime) + sealed.request.ttlSeconds * 1_000
    || provider?.schema !== "agentic-cloud-collaboration-github-receipt/v1" || provider.action !== "continue" || provider.claimId !== claim.claimId
    || provider.claimDigest !== claim.fenceRevision || provider.ledgerRevision !== result.ledgerRevision || provider.contractReceiptDigest !== operationDigest
    || !Number.isSafeInteger(operation.ledgerSequence) || operation.ledgerSequence < 1 || !Number.isSafeInteger(provider.sequence) || provider.sequence < operation.ledgerSequence || provider.evaluationTime !== operation.evaluationTime || !/^[0-9a-f]{64}$/u.test(String(provider.ledgerDigest || ""))
    || providerDigest !== digestValue(providerCore) || replayCandidate && result.replayed !== true) {
    throw new Error("Historical derivative same-claim recovery returned no exact receipt.");
  }
  const projected = claimProjection(claim);
  assertStableDerivative(projected, source, true);
  return projected;
}
export function assertActivePublishHistoricalDerivativeRecoveryLedgerReadback(result, status) {
  if (result?.ledgerRevision !== status?.ledgerRevision || result?.receipt?.ledgerDigest !== status?.ledgerDigest) throw new Error("Historical derivative recovery ledger readback drifted.");
  return status; }
export function assertActivePublishHistoricalDerivativeTerminalReceiptJoins(plan, intent, lease) {
  const cloud = intent.phases.cloud_recovered.values, task = intent.phases.task_authority_verified.values, registry = intent.phases.registry_projected.values, marker = intent.phases.review_marker_projected.values;
  const projected = registry.registryProjectionReceipt, recovery = lease.activePublishHistoricalDerivativeRecovery, successor = lease.activePublishTaskAuthoritySuccessor;
  assertActivePublishHistoricalDerivativeRecoveryPhase(plan, cloud); assertActivePublishHistoricalDerivativeTaskReceipt(plan, task);
  if (marker.schema !== "agentic-active-publish-historical-derivative-review-marker/v1" || marker.planDigest !== plan.planDigest || marker.reviewId !== plan.evidence.review.id || marker.sourceBodyDigest !== plan.evidence.review.bodyDigest || marker.visibleBodyDigest !== plan.evidence.review.visibleBodyDigest || sealedReceipt(marker, "review marker") !== marker.receiptDigest
    || projected.schema !== REGISTRY_RECEIPT_SCHEMA || projected.planDigest !== plan.planDigest || sealedReceipt(projected, "registry projection") !== registry.registryProjectionReceiptDigest
    || recovery.schema !== RECOVERY_RECEIPT_SCHEMA || recovery.planDigest !== plan.planDigest || sealedReceipt(recovery, "recovery") !== projected.recoveryReceiptDigest
    || marker.targetMarkerDigest !== digestValue(projectWriterLeasePullRequestMarker(lease)) || sealedReceipt(successor, "task successor") !== registry.successorReceiptDigest || projected.successorReceiptDigest !== registry.successorReceiptDigest || registry.taskAuthorityReceiptDigest !== task.receiptDigest || projected.targetLeaseDigest !== registry.targetLeaseDigest || projected.targetLeaseDigest !== writerLeaseDigest(lease) || projected.targetClaimId !== cloud.claimId
    || projected.targetBindingDigest !== lease.taskAuthority.bindingDigest || recovery.targetClaimId !== cloud.claimId || recovery.cloudOperationReceiptDigest !== cloud.operationReceiptDigest
    || recovery.cloudVerificationReceiptDigest !== cloud.verificationReceiptDigest || successor.cloudOperationReceiptDigest !== cloud.operationReceiptDigest || successor.cloudVerificationReceiptDigest !== cloud.verificationReceiptDigest) throw new Error("Terminal historical derivative embedded receipts drifted.");
}
function sealedReceipt(value, label) { const { receiptDigest, ...core } = value || {};
  if (!receiptDigest || receiptDigest !== digestValue(core)) throw new Error(`Historical derivative ${label} receipt drifted.`); return receiptDigest; }
export function assertActivePublishHistoricalDerivativeLocalSubject(current, planned, stage) {
  const select = value => ({ controller: value.controller, canonicalAdvance: value.canonicalAdvance, lane: value.lane, sourceLease: value.sourceLease, intent: value.intent, review: value.review });
  if (canonicalJson(select(current)) !== canonicalJson(select(planned))) {
    throw new Error(`Historical derivative local source drifted at ${stage}.`);
  }
}
function claimState(value) { return value?.state === "active" ? "current" : value?.state; }
function cloudOwner(namespace, value) { return String(value).startsWith(`${namespace}:`) ? value : pseudonymousIdentifier(namespace, value); }
function requireStatus(value) {
  if (value?.schema !== "agentic-cloud-collaboration-result/v1" || value.ok !== true
    || value.action !== "status" || value.status !== "ready" || !Array.isArray(value.claims)) {
    throw new Error("Cloud status returned no complete inventory.");
  }
  return value;
}
function statusSubject(value) { return { ledgerRevision: value.ledgerRevision,
  ledgerDigest: value.ledgerDigest, sequence: value.sequence, claims: value.claims }; }
function exactClaim(claims, claimId) {
  const matches = claims.filter(item => item?.claimId === claimId);
  if (matches.length !== 1) throw new Error("Cloud inventory lacks one exact historical derivative.");
  return matches[0]; }
function projectedRegistryValues(projection, registryRevision) { return Object.freeze({
  ...projection, registryRevision, writerRegistryMutation: true,
  taskAuthorityProjected: true, activePublishSuccessorIntentCleared: true });
}
function requireTargetLease(value, digest) {
  if (!value || writerLeaseDigest(value) !== digest || value.activePublishSuccessorIntent !== null
    || !value.activePublishTaskAuthoritySuccessor || !value.activePublishHistoricalDerivativeRecovery) {
    throw new Error("Historical derivative target lease drifted.");
  }
  return value;
}
function parseWorktrees(value) {
  const fields = String(value).split("\0");
  if (fields.at(-1) === "") fields.pop();
  const records = [];
  let current = null;
  for (const field of fields) {
    if (field.startsWith("worktree ")) {
      current = { path: field.slice(9), branch: null };
      records.push(current);
    } else if (current && field.startsWith("branch ")) current.branch = field.slice(7);
  }
  return records;
}
function nulPaths(value) {
  const values = String(value).split("\0");
  if (values.at(-1) === "") values.pop();
  if (values.some(item => !item)) throw new Error("Changed-path output is invalid.");
  return values.sort(); }
function externalFile(value, roots, label) {
  const file = canonical(value, label);
  if (roots.some(root => file === root || file.startsWith(`${root}${path.sep}`)))
    throw new Error(`${label} must remain outside repository worktrees.`);
  const metadata = lstatSync(file);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`${label} is invalid.`);
  return file; }
function canonical(value, label) { if (!path.isAbsolute(String(value || "")))
  throw new Error(`${label} must be absolute.`); return realpathSync(path.resolve(value)); }
function required(value, label) { if (typeof value !== "string" || !value.trim())
  throw new Error(`${label} is required.`); return value; }
function positive(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${label} is invalid.`);
  return number; }
function fencedEnvironment(source) {
  const result = { ...source };
  for (const key of Object.keys(result)) if (key.startsWith("AGENTIC_CLOUD_")) delete result[key];
  for (const key of ["AGENTIC_TARGET_REPOSITORY", "AGENTIC_DEVICE_ID", "AGENTIC_SESSION_ID"])
    delete result[key];
  return result; }
function defaultExecute(command, args, cwd) { return execFileSync(command, args, {
  cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }); }
