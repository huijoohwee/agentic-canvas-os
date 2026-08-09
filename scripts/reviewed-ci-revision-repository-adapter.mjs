import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { digestValue, normalizeWriteSet, writeSetsOverlap } from "./cloud-collaboration-primitives.mjs";
import { createGitHubCloudCollaborationAdapter } from "./github-cloud-collaboration-adapter.mjs";
import { pseudonymousIdentifier } from "./github-cloud-collaboration-mapping.mjs";
import { normalizeBoundAuthority } from "./scoped-lane-cloud-reconciliation.mjs";
import { invokeRepositoryCloudAction, verifyAdmissionCloudAuthority, verifyReviewReadyAdmissionCloudAuthority } from "./scoped-lane-cloud-authority.mjs";
import { assertRegisteredWorktree } from "./repository-guards.mjs";
import { createWriterLeaseStore, parseDeviceBranch, parseWriterLeasePullRequestBody, projectWriterLeasePullRequestMarker } from "./writer-lease-lib.mjs";
import { writerLeaseDigest } from "./writer-lease-registry-cas.mjs";
import { assertGitHubPullQueueFence, assertGitHubPullRequestBounds, buildReviewedCiFailureEvidence,
  closeGitHubPullWithReconciliation, createGitHubPullWithReconciliation, readGitHubOpenPullSubjects, readGitHubPullLifecycleSubject, readGitHubReviewedCiFailureSubject } from "./reviewed-ci-revision-evidence.mjs";
import { advanceReviewedCiRevisionIntent, assertReviewedCiMarkerCardinality, assertReviewedCiRevisionPhaseReceipts,
  buildReviewedCiRevisionFinalReceipt, buildReviewedCiRevisionPlan, buildReviewedCiTerminalVerification, createReviewedCiRevisionPullRequestBootstrap,
  normalizeReviewedCiRevisionArchiveRecord, normalizeReviewedCiRevisionIntent, parseReviewedCiRevisionMarker, reviewedCiRevisionOperationKey, reviewedCiRevisionPhaseOrder } from "./reviewed-ci-revision-contract.mjs";
import { assertReviewedCiCloudPhase, assertReviewedCiLocalSubject, assertReviewedCiProviderSubject,
  assertReviewedCiReplacementPull, assertReviewedCiSourcePull, assertReviewedCiRecoveryPullBody as requireRecoveryPullBody, archiveReviewedCiRevisionRegistry,
  createReviewedCiRevisionControllerAdapter, expectedReviewedCiReplacementBody as expectedReplacementBody, exactReviewedCiClaim,
  findReviewedCiSuccessor, mutateRecoveryRegistry, nextWriterEpoch, normalizeGitHubOriginRepository, projectReviewedCiRemoteActive, projectReviewedCiSourceMarker,
  readRecoveryIntent, requireReviewedCiClaimPreOrPost, requireReviewedCiRetirePreOrPost } from "./reviewed-ci-revision-controller.mjs";
const RECOVERING = "review_ready";
export function createReviewedCiRevisionRepositoryAdapter(options = {}, dependencies = {}) {
  const repository = realpathSync(path.resolve(required(options.repository, "repository")));
  const sessionId = required(options.sessionId, "session ID");
  const pullRequestNumber = positive(options.pullRequestNumber, "pull-request number"), checkRunId = positive(options.checkRunId, "check-run ID");
  const ttlSeconds = Number(options.ttlSeconds || 1_800), minimumMarginSeconds = Number(options.minimumMarginSeconds || 300);
  const runtime = dependencies.runtime || createRepositoryRuntime({ repository, environment: options.environment || process.env }, dependencies);
  function readLease() { const local = runtime.readLocal();
    const lease = runtime.leaseStore.read(local.branch);
    if (!lease) throw new Error("Reviewed CI recovery has no writer lease.");
    if (lease.sessionId !== sessionId || lease.device !== local.identity.device
      || lease.branch !== local.branch || realpathSync(lease.worktreePath) !== repository) {
      throw new Error("Writer lease is not the exact registered session/device/worktree owner."); }
    return { local, lease }; }
  async function readState() { const { local, lease } = readLease();
    const stored = readRecoveryIntent(runtime.leaseStore, lease.branch);
    const archives = Object.values(runtime.leaseStore.readRegistry()?.reviewedCiRevisionRecoveryArchives || {}).map(
      normalizeReviewedCiRevisionArchiveRecord).filter(archive => archive.branch === lease.branch && archive.pullRequestNumber === pullRequestNumber && archive.checkRunId === checkRunId);
    if (archives.length > 1 || archives.length && stored) throw new Error("Recovery journal/archive identity is ambiguous.");
    if (archives.length === 1) { const archive = archives[0];
      if (writerLeaseDigest(lease) !== archive.terminalLeaseDigest) throw new Error("Archived recovery no longer owns its exact terminal lease.");
      return { archive, ttlSeconds }; }
    if (stored) { if (lease.status !== (stored.status === "local-active" ? "active" : RECOVERING)) {
        throw new Error("Recovery journal and writer-lease status disagree."); }
      if (stored.status !== "local-active" && writerLeaseDigest(lease) !== stored.planSnapshot.sourceLeaseDigest) {
        throw new Error("Review-ready source lease changed after recovery authorization."); }
      const intent = normalizeReviewedCiRevisionIntent(stored);
      requireProtectedMainAdvance(runtime, lease, local, intent.planSnapshot.protectedMainAdvanceDigest);
      assertGitHubPullRequestBounds(createReviewedCiRevisionPullRequestBootstrap(intent.planSnapshot));
      return { intent, ttlSeconds }; }
    if (lease.status !== "review_ready") { throw new Error("Reviewed CI recovery requires a live review-ready source lease."); }
    const provider = runtime.readProvider({ pullRequestNumber, checkRunId });
    if (local.originRepository !== provider.repository.full_name) throw new Error("Git origin repository drifted from GitHub evidence.");
    assertReviewedCiMarkerCardinality(provider.pullRequest.body, "absent");
    const markerLease = parseWriterLeasePullRequestBody(provider.pullRequest.body);
    requireExactWriterMarker(markerLease, lease);
    const manifest = manifestFromLease(lease);
    const verified = runtime.verifyReview({ authority: lease.cloudAuthority, manifest, headSha: local.headSha, branch: local.branch, focusedEvidenceDigest: lease.cloudAuthority.focusedEvidenceDigest, });
    const cloud = runtime.readCloud(lease.cloudAuthority);
    const privateClaims = await runtime.listPrivateClaims(lease.cloudAuthority);
    const claim = exactReviewedCiClaim({ claims: privateClaims }, lease.cloudAuthority.claimId);
    if (privateClaims.some(candidate => candidate.claimId !== claim.claimId && candidate.repositoryId === claim.repositoryId
      && writeSetsOverlap(candidate.declaredWriteScope, lease.admission.declaredWriteSet))) {
      throw new Error("A foreign private claim overlaps the reviewed source before intent CAS."); }
    const failureEvidence = buildReviewedCiFailureEvidence(provider.evidenceInput);
    const source = { repository: provider.repository.full_name, lease, authority: verified.authority, claim,
      verification: { verifiedAt: verified.verification.verifiedAt }, failureEvidence, minimumMarginSeconds, clean: local.clean,
      headSha: local.headSha, treeSha: local.treeSha, remoteHeadSha: local.remoteHeadSha, remoteMainSha: local.remoteMainSha,
      leaseDigest: writerLeaseDigest(lease), worktreeIdentityDigest: local.identityDigest,
      pullRequest: { ...provider.pullRequest, repository: provider.repository.full_name },
      pullRequestBodyDigest: digestValue(provider.pullRequest.body), writerMarkerDigest: digestValue(projectWriterLeasePullRequestMarker(lease)),
      privateDeviceId: pseudonymousIdentifier("device", lease.device), privateSessionId: pseudonymousIdentifier("session", lease.sessionId),
      originRepository: local.originRepository, protectedMainAdvance: requireProtectedMainAdvance(runtime, lease, local), };
    const plan = buildReviewedCiRevisionPlan({ source, ttlSeconds });
    assertGitHubPullRequestBounds(createReviewedCiRevisionPullRequestBootstrap(plan));
    assertGitHubPullRequestBounds({ title: plan.sourcePullRequestTitle, body: projectReviewedCiSourceMarker(plan, lease).body });
    return { source, intent: null, ttlSeconds }; }
  function casIntent(expectedLease, expectedIntent, nextIntent, activeLease = null) { return mutateRecoveryRegistry({ leaseStore: runtime.leaseStore, expectedLease, expectedIntent, nextIntent, activeLease }); }
  function assertExecutionFence() { if (typeof runtime.requireSharedEntrypointFence !== "function") throw new Error("Reviewed CI revision execution lacks its protected shared-entrypoint fence.");
    return runtime.requireSharedEntrypointFence(); }
  async function beginIntent({ plan, intent }) { assertExecutionFence();
    const { lease } = readLease();
    const existing = readRecoveryIntent(runtime.leaseStore, lease.branch);
    if (existing) { const prior = normalizeReviewedCiRevisionIntent(existing);
      if (prior.planDigest !== plan.planDigest) throw new Error("Another recovery intent owns the lane.");
      return prior; }
    if (lease.status !== "review_ready" || writerLeaseDigest(lease) !== plan.sourceLeaseDigest
      || lease.cloudAuthority.claimId !== plan.sourceClaimId) { throw new Error("Reviewed source changed before intent CAS."); }
    return casIntent(lease, null, intent); }
  async function advanceIntent({ intent, next }) { assertExecutionFence(); const { lease } = readLease();
    requireStoredIntent(runtime.leaseStore, lease.branch, intent);
    if (lease.status !== RECOVERING) throw new Error("Only the fenced recovery lease may advance intent.");
    return casIntent(lease, intent, next); }
  function requireProviderMutationBoundary(plan, intent) { assertExecutionFence(); const { local, lease } = readLease();
    requireStoredIntent(runtime.leaseStore, lease.branch, intent);
    assertReviewedCiLocalSubject(plan, local);
    const advance = requireProtectedMainAdvance(runtime, lease, local, plan.protectedMainAdvanceDigest);
    if (lease.status !== RECOVERING || writerLeaseDigest(lease) !== plan.sourceLeaseDigest) {
      throw new Error("Provider boundary lost the byte-exact reviewed source lease."); }
    return digestValue({ sourceLeaseDigest: plan.sourceLeaseDigest, worktreeIdentityDigest: local.identityDigest, headSha: local.headSha,
      failureEvidenceDigest: plan.failureEvidenceDigest, protectedMainAdvanceDigest: advance.receiptDigest }); }
  async function reconcilePhase({ plan, intent, phase }) { const { local, lease } = readLease();
    requireStoredIntent(runtime.leaseStore, lease.branch, intent);
    assertReviewedCiLocalSubject(plan, local);
    requireProtectedMainAdvance(runtime, lease, local, plan.protectedMainAdvanceDigest);
    if (intent.status !== "local-active" && writerLeaseDigest(lease) !== plan.sourceLeaseDigest) {
      throw new Error("Review-ready source lease changed during recovery."); }
    const phaseIndex = reviewedCiRevisionPhaseOrder(phase);
    const cloud = { ...runtime.readCloud(lease.cloudAuthority), privateClaims: await runtime.listPrivateClaims(lease.cloudAuthority), };
    assertReviewedCiCloudPhase(plan, intent, phase, cloud);
    if (phaseIndex >= reviewedCiRevisionPhaseOrder("remote-active")) { await requireLiveBoundMargin(plan, intent); }
    const oldPull = runtime.readPull(plan.pullRequestNumber);
    const oldClosed = oldPull.state === "CLOSED" && oldPull.mergedAt === null;
    let pullBody = "", liveMarker = null;
    if (phaseIndex < reviewedCiRevisionPhaseOrder("source-retired") || !oldClosed) {
      if (phaseIndex >= reviewedCiRevisionPhaseOrder("source-pr-closed")) {
        throw new Error("Preserved source pull request is not exactly closed and unmerged."); }
      const provider = runtime.readProvider({ pullRequestNumber, checkRunId });
      requireProviderSubject(plan, provider);
      pullBody = provider.pullRequest.body;
      if (phase === "source-retired" && sourceBodyDisposition(plan, intent, provider.pullRequest)) {
        liveMarker = digestValue(pullBody) === plan.pullRequestBodyDigest ? null : parseReviewedCiRevisionMarker(pullBody);
      } else liveMarker = requireRecoveryPullBody({ plan, intent, phase, body: pullBody, lease }); } else if (phase === "source-retired") {
      requireClosableSourceLifecycle(plan, intent, oldPull, "CLOSED"); } else requireSourceLifecycle(plan, intent, oldPull, "CLOSED");
    if (phaseIndex >= reviewedCiRevisionPhaseOrder("replacement-pr-created")) {
      const replacement = runtime.readPull(intent.replacementPullRequest.values.pullRequestNumber);
      assertReviewedCiReplacementPull(plan, intent, replacement, expectedReplacementBody(plan, intent, phase, lease));
      pullBody = replacement.body;
      liveMarker = requireRecoveryPullBody({ plan, intent, phase, body: pullBody, lease }); }
    assertReviewedCiRevisionPhaseReceipts(plan, intent, phase, { pullBody, lease, liveMarker, cloud, });
    return true; }
  async function reconcileTransition({ plan, intent, method, operationKey: exactKey }) {
    assertExecutionFence();
    if (reviewedCiRevisionPhaseOrder(intent.status) < reviewedCiRevisionPhaseOrder("source-retired")) {
      const evidence = await readDeliveryWonEvidence(plan, intent);
      if (evidence) return { kind: "delivery-won", evidence }; }
    const lease = runtime.leaseStore.read(plan.sourceBranch), authority = lease.cloudAuthority;
    if (method === "projectRecoveryIntent") {
      const pull = runtime.readPull(plan.pullRequestNumber), projection = projectReviewedCiSourceMarker(plan, lease);
      if (pull.body === projection.body) return responseAhead(exactKey, await projectRecoveryIntent({ plan, intent })); }
    if (method === "claimSuccessor") { if (findReviewedCiSuccessor(runtime.readCloud(authority), plan, "waiting-successor")) {
        return responseAhead(exactKey, await claimSuccessor({ plan, intent })); } }
    if (method === "retireSource") { const cloud = runtime.readCloud(authority);
      if (!cloud.claims.some(claim => claim.claimId === plan.sourceClaimId) && findReviewedCiSuccessor(cloud, plan, "waiting-successor")) {
        return responseAhead(exactKey, await retireSource({ plan, intent })); } }
    if (method === "closeSourcePullRequest" && runtime.readPull(plan.pullRequestNumber).state === "CLOSED") {
      return responseAhead(exactKey, await closeSourcePullRequest({ plan, intent })); }
    if (method === "createRevisionPullRequest" && runtime.listOpenPulls(plan.sourceBranch).length > 0) {
      return responseAhead(exactKey, await createRevisionPullRequest({ plan, intent })); }
    if (method === "promoteSuccessor" && findReviewedCiSuccessor(runtime.readCloud(authority), plan, "current")) {
      return responseAhead(exactKey, await promoteSuccessor({ plan, intent })); }
    if (method === "bindSuccessor") { const current = findReviewedCiSuccessor(runtime.readCloud(authority), plan, "current");
      const reviewId = `github-pull-request:${intent.replacementPullRequest.values.pullRequestNodeId}`;
      if (current?.reviewRequestId === reviewId) return responseAhead(exactKey, await bindSuccessor({ plan, intent })); }
    if (method === "projectPullRequest") { const pull = runtime.readPull(intent.replacementPullRequest.values.pullRequestNumber);
      const projection = reconstructRemoteCandidate(plan, intent, lease);
      if (pull.body === projection.body) { assertReviewedCiReplacementPull(plan, intent, pull, projection.body);
        return responseAhead(exactKey, intent.pullRequestProjectionCandidate.values); } }
    return { kind: "pending" }; }
  async function readDeliveryWonEvidence(plan, intent) { const authority = runtime.leaseStore.read(plan.sourceBranch).cloudAuthority;
    const cloud = runtime.readCloud(authority), privateClaims = await runtime.listPrivateClaims(authority);
    const sources = privateClaims.filter(claim => claim.claimId === plan.sourceClaimId);
    if (sources.length === 0) return null;
    if (sources.length !== 1) throw new Error("Delivery-won source identity is ambiguous.");
    const [source] = sources;
    if (source.state !== "integrated-preserved") return null;
    const publicSource = exactReviewedCiClaim(cloud, plan.sourceClaimId);
    if (publicSource.state !== source.state || publicSource.integrationReceiptDigest !== source.integrationReceiptDigest
      || source.deviceId !== plan.sourcePrivateDeviceId || source.sessionId !== plan.sourcePrivateSessionId) {
      throw new Error("Integrated source public/private evidence drifted."); }
    const derivatives = ["waiting-successor", "current"].map(state =>
      findReviewedCiSuccessor({ claims: privateClaims }, plan, state)).filter(Boolean);
    if (derivatives.length > 1) throw new Error("Delivery-won derivative is ambiguous.");
    const derivative = derivatives[0] || null, allowed = new Set([source.claimId, derivative?.claimId].filter(Boolean));
    if (privateClaims.some(claim => !allowed.has(claim.claimId) && claim.repositoryId === plan.sourceRepositoryId
      && writeSetsOverlap(claim.declaredWriteScope, plan.declaredWriteSet))) {
      throw new Error("Delivery-won inventory contains a foreign overlapping reservation."); }
    if (derivative && (derivative.deviceId !== plan.sourcePrivateDeviceId
      || derivative.sessionId !== plan.sourcePrivateSessionId
      || derivative.reviewRequestId !== null)) throw new Error("Delivery derivative owner or review binding drifted.");
    const pull = requireClosableSourceLifecycle(plan, intent,
      runtime.readPull(plan.pullRequestNumber), "OPEN", runtime.leaseStore.read(plan.sourceBranch));
    const projectedDerivative = derivative ? { claimId: derivative.claimId, claimDigest: derivative.fenceRevision,
      transitionCounter: derivative.transitionCounter, operationReceiptDigest: derivative.operationReceiptDigest,
      state: derivative.state, predecessorClaimId: derivative.predecessorClaimId,
      actorId: derivative.actorId, repositoryId: derivative.repositoryId, workItemId: derivative.workItemId,
      deviceId: plan.sourceDeviceId, sessionId: plan.sourceSessionId,
      canonicalBaseSha: derivative.canonicalBaseRevision, laneRevision: derivative.laneRevision,
      writeSetDigest: derivative.writeSetDigest, leaseEpoch: derivative.leaseEpoch, } : null;
    const core = { schema: "agentic-reviewed-ci-revision-delivery-won/v1", sourceClaimId: plan.sourceClaimId, sourceState: source.state,
      sourcePullRequestNodeId: pull.nodeId, sourcePullRequestState: pull.state, sourceMergedAt: pull.mergedAt, deliveryReceiptDigest: required(
        source.integrationReceiptDigest, "delivery receipt"), derivative: projectedDerivative };
    return { ...core, evidenceDigest: digestValue(core) }; }
  async function abortDeliveryWon({ plan, intent, evidence }) { requireProviderMutationBoundary(plan, intent);
    if (intent.abortCleanup?.evidenceDigest !== evidence.evidenceDigest) throw new Error(
      "Delivery cleanup differs from its durable prepared intent.");
    const observed = await readDeliveryWonEvidence(plan, intent);
    if (!observed || observed.sourceClaimId !== evidence.sourceClaimId || observed.deliveryReceiptDigest !== evidence.deliveryReceiptDigest
      || observed.derivative && digestValue(observed.derivative) !== digestValue(evidence.derivative)) {
      throw new Error("Delivery-won evidence changed before exact abort."); }
    const source = runtime.leaseStore.read(plan.sourceBranch).cloudAuthority;
    let derivativeRetirementReceiptDigest = null;
    if (evidence.derivative) { const before = runtime.readCloud(source), derivative = evidence.derivative;
      const request = { targetRepository: source.targetRepository,
        deviceId: plan.sourceDeviceId, sessionId: plan.sourceSessionId, claimId: derivative.claimId,
        expectedFenceRevision: derivative.claimDigest, expectedTransitionCounter: derivative.transitionCounter,
        expectedLedgerDigest: before.ledgerDigest, reason: "abandoned", finalRevision: plan.sourceHeadSha,
        reviewRequestId: null, bytesDigest: digestValue({ treeSha: plan.sourceTreeSha, headSha: plan.sourceHeadSha }),
        namedChecksDigest: plan.failureEvidenceDigest, handoffEvidenceDigest: evidence.evidenceDigest,
        idempotencyKey: reviewedCiRevisionOperationKey(plan, "abort-derivative") };
      const result = replayCloud(runtime, "retire", source, request, status => ( status.claims.some(claim => claim.claimId === plan.sourceClaimId
          && claim.state === "integrated-preserved") && !status.claims.some(claim => claim.claimId === derivative.claimId)));
      if (result.operationReceipt?.idempotencyKey !== digestValue(request.idempotencyKey)
        || result.operationReceipt?.operation !== "retire") throw new Error( "Derivative abandonment did not return its exact operation receipt.");
      derivativeRetirementReceiptDigest = required(result.operationReceipt.receiptDigest, "derivative retirement receipt"); }
    const after = await readDeliveryWonEvidence(plan, intent);
    if (!after || after.derivative !== null || after.deliveryReceiptDigest !== evidence.deliveryReceiptDigest) {
      throw new Error("Delivery derivative remains live after abandonment replay."); }
    const cleanupReceiptDigest = digestValue({ schema: "agentic-reviewed-ci-revision-delivery-cleanup/v1",
      planDigest: plan.planDigest, evidenceDigest: evidence.evidenceDigest, derivativeRetirementReceiptDigest });
    const { lease } = readLease();
    if (lease.status !== RECOVERING || writerLeaseDigest(lease) !== plan.sourceLeaseDigest
      || digestValue(readRecoveryIntent(runtime.leaseStore, plan.sourceBranch)) !== digestValue(intent)) throw new Error(
      "Delivery cleanup changed the source lease or durable journal.");
    const pull = requireClosableSourceLifecycle(plan, intent, runtime.readPull(plan.pullRequestNumber), "OPEN", lease);
    const derivative = evidence.derivative;
    const core = { schema: "agentic-reviewed-ci-revision-delivery-abort/v1", sourceClaimId: plan.sourceClaimId, sourceState: "integrated-preserved",
      sourceLeaseDigest: plan.sourceLeaseDigest,
      deliveryReceiptDigest: evidence.deliveryReceiptDigest,
      derivativeClaimId: derivative?.claimId ?? null, derivativeInitialState: derivative?.state ?? null,
      derivativeFinalState: derivative ? "retired" : null, retirementReason: derivative ? "abandoned" : null,
      cleanupReceiptDigest, sourcePullRequestNodeId: pull.nodeId,
      sourcePullRequestState: pull.state, sourceMergedAt: pull.mergedAt,
      journalState: "cleanup-complete", cleanupIntentDigest: intent.abortCleanup.cleanupIntentDigest };
    return { ...core, receiptDigest: digestValue(core) }; }
  async function projectRecoveryIntent({ plan }) { assertExecutionFence();
    const provider = runtime.readProvider({ pullRequestNumber, checkRunId });
    requireProviderSubject(plan, provider);
    const lease = runtime.leaseStore.read(plan.sourceBranch);
    const stored = readRecoveryIntent(runtime.leaseStore, plan.sourceBranch);
    const projection = projectReviewedCiSourceMarker(plan, lease);
    assertGitHubPullRequestBounds({ title: plan.sourcePullRequestTitle, body: projection.body });
    requireRecoveryPullBody({ plan, intent: stored, phase: "intent", body: provider.pullRequest.body, lease });
    if (provider.pullRequest.body !== projection.body) {
      try { runtime.editPullBody(provider.pullRequest.url, projection.body); } catch { /* exact reread decides */ } }
    const verified = runtime.readProvider({ pullRequestNumber, checkRunId });
    if (digestValue(verified.pullRequest.body) !== projection.bodyDigest
      || digestValue(parseReviewedCiRevisionMarker(verified.pullRequest.body)) !== digestValue(projection.marker)
      || digestValue(parseWriterLeasePullRequestBody(verified.pullRequest.body)) !== digestValue(projection.writerMarker)) {
      throw new Error("Recovering intent marker projection was not observed."); }
    return { operationKey: reviewedCiRevisionOperationKey(plan, "intent-marker"), pullRequestNodeId: verified.pullRequest.nodeId,
      markerDigest: digestValue(projection.marker), writerMarkerDigest: digestValue(projection.writerMarker),
      bodyDigest: digestValue(verified.pullRequest.body), }; }
  async function closeSourcePullRequest({ plan, intent }) { let boundaryDigest = requireProviderMutationBoundary(plan, intent);
    const result = closeGitHubPullWithReconciliation({ readPull: () => runtime.readPull(plan.pullRequestNumber), readFreshEvidence: pull => {
        boundaryDigest = requireProviderMutationBoundary(plan, intent);
        const provider = runtime.readProvider({ pullRequestNumber, checkRunId, expectedState: pull.state });
        requireProviderSubject(plan, provider, { requireDraft: false, requireState: pull.state });
        return requireClosableSourceLifecycle(plan, intent, provider.pullRequest, pull.state); }, closePull: () => runtime.closePull(plan.pullRequestUrl),
      validateOpen: pull => requireClosableSourceLifecycle(plan, intent, pull, "OPEN"),
      validateClosed: pull => requireClosableSourceLifecycle(plan, intent, pull, "CLOSED"), });
    return sourceClosureValues(plan, intent, result.pull, result.disposition, boundaryDigest); }
  async function createRevisionPullRequest({ plan, intent }) { requireProviderMutationBoundary(plan, intent);
    requireSourceLifecycle(plan, intent, runtime.readPull(plan.pullRequestNumber), "CLOSED");
    const bootstrap = createReviewedCiRevisionPullRequestBootstrap(plan);
    assertGitHubPullRequestBounds(bootstrap);
    const result = createGitHubPullWithReconciliation({ listPulls: () => runtime.listOpenPulls(plan.sourceBranch),
      createPull: () => { requireProviderMutationBoundary(plan, intent); return runtime.createPull({
        branch: plan.sourceBranch, title: bootstrap.title, body: bootstrap.body }); },
      validatePull: pull => requireReplacementLifecycle(plan, pull, bootstrap, intent), });
    const pull = result.pull;
    requireReplacementLifecycle(plan, runtime.readPull(pull.number), bootstrap, intent);
    const boundaryDigest = requireProviderMutationBoundary(plan, intent);
    requireSourceLifecycle(plan, intent, runtime.readPull(plan.pullRequestNumber), "CLOSED");
    return { operationKey: reviewedCiRevisionOperationKey(plan, "create-replacement-pr"), pullRequestNumber: pull.number,
      pullRequestNodeId: pull.nodeId, url: pull.url, state: pull.state, isDraft: pull.isDraft,
      title: pull.title, bodyDigest: bootstrap.bodyDigest, providerDisposition: result.disposition, providerBoundaryDigest: boundaryDigest,
      headSha: pull.headSha, baseSha: pull.baseSha, authorLogin: pull.authorLogin }; }
  async function claimSuccessor({ plan }) { assertExecutionFence(); await requireLiveReviewedMargin(plan);
    const provider = runtime.readProvider({ pullRequestNumber, checkRunId });
    requireProviderSubject(plan, provider, { requireDraft: false });
    assertReviewedCiMarkerCardinality(provider.pullRequest.body, "present");
    const source = runtime.leaseStore.read(plan.sourceBranch).cloudAuthority;
    const before = runtime.readCloud(source);
    requireReviewedCiClaimPreOrPost(before, plan);
    const request = { targetRepository: source.targetRepository, branch: plan.sourceBranch, deviceId: plan.sourceDeviceId,
      sessionId: plan.sourceSessionId, workItemId: plan.sourceWorkItemId, canonicalBaseSha: plan.successorCanonicalBaseSha,
      headSha: plan.sourceHeadSha, declaredWriteSet: plan.declaredWriteSet, leaseEpoch: plan.successorCloudLeaseEpoch,
      predecessorClaimId: plan.sourceClaimId, ttlSeconds: plan.ttlSeconds, expectedLedgerDigest: before.ledgerDigest,
      idempotencyKey: reviewedCiRevisionOperationKey(plan, "claim"), };
    const result = replayCloud(runtime, "claim", source, request, status => ( findReviewedCiSuccessor(status, plan, "waiting-successor") ));
    const claim = requireMutationClaim(result, plan, "waiting-successor", request.idempotencyKey);
    return { operationKey: request.idempotencyKey, ...claimValues(result, claim) }; }
  async function retireSource({ plan, intent }) { assertExecutionFence();
    const provider = runtime.readProvider({ pullRequestNumber, checkRunId });
    requireProviderSubject(plan, provider, { requireDraft: false });
    assertReviewedCiLocalSubject(plan, readLease().local);
    const source = runtime.leaseStore.read(plan.sourceBranch).cloudAuthority;
    const before = runtime.readCloud(source);
    if (before.claims.some(claim => claim.claimId === plan.sourceClaimId)) { await requireLiveReviewedMargin(plan); }
    requireReviewedCiRetirePreOrPost(before, plan, intent.successor.values);
    const request = { targetRepository: source.targetRepository, deviceId: plan.sourceDeviceId, sessionId: plan.sourceSessionId,
      claimId: plan.sourceClaimId, expectedFenceRevision: plan.sourceClaimDigest, expectedTransitionCounter: plan.sourceTransitionCounter,
      expectedLedgerDigest: before.ledgerDigest, reason: "superseded", finalRevision: plan.sourceHeadSha, reviewRequestId: plan.sourceReviewRequestId,
      bytesDigest: digestValue({ treeSha: plan.sourceTreeSha, headSha: plan.sourceHeadSha }), namedChecksDigest: plan.failureEvidenceDigest,
      handoffEvidenceDigest: intent.successor.snapshotDigest, idempotencyKey: reviewedCiRevisionOperationKey(plan, "retire-source"), };
    const result = replayCloud(runtime, "retire", source, request, status => ( !status.claims.some(claim => claim.claimId === plan.sourceClaimId)
      && findReviewedCiSuccessor(status, plan, "waiting-successor") ));
    return { operationKey: request.idempotencyKey, sourceClaimId: plan.sourceClaimId, successorClaimId: intent.successor.values.claimId,
      receiptDigest: required(result.receipt?.receiptDigest, "retirement receipt"),
      operationReceiptDigest: required(result.operationReceipt?.receiptDigest, "retirement operation receipt"),
      ledgerDigest: required(result.receipt?.ledgerDigest, "retirement ledger digest"), state: "retired", }; }
  async function promoteSuccessor({ plan, intent }) { assertExecutionFence();
    const source = runtime.leaseStore.read(plan.sourceBranch).cloudAuthority;
    const before = runtime.readCloud(source);
    if (before.claims.some(claim => claim.claimId === plan.sourceClaimId)) { throw new Error("Source claim remains live before successor promotion.");
    }
    const waiting = findReviewedCiSuccessor(before, plan, "waiting-successor") || findReviewedCiSuccessor(before, plan, "current");
    if (!waiting || waiting.claimId !== intent.successor.values.claimId) { throw new Error("Successor identity drifted before promotion replay."); }
    const request = { targetRepository: source.targetRepository, branch: plan.sourceBranch, deviceId: plan.sourceDeviceId,
      sessionId: plan.sourceSessionId, claimId: waiting.claimId, expectedFenceRevision: intent.successor.values.claimDigest,
      expectedTransitionCounter: intent.successor.values.transitionCounter, expectedLedgerDigest: before.ledgerDigest, mode: "promote",
      headSha: plan.sourceHeadSha, ttlSeconds: plan.ttlSeconds, idempotencyKey: reviewedCiRevisionOperationKey(plan, "promote-successor"), };
    const result = replayCloud(runtime, "continue", source, request, status => ( findReviewedCiSuccessor(status, plan, "current") ));
    const claim = requireMutationClaim(result, plan, "current", request.idempotencyKey);
    const authority = Object.freeze({ ...normalizeBoundAuthority({ result: withLedgerDigest(result), authority: source,
      manifest: manifestFromLease(runtime.leaseStore.read(plan.sourceBranch)),
      deviceId: plan.sourceDeviceId, sessionId: plan.sourceSessionId, focusedEvidenceDigest: null }),
      reviewRequestId: null, focusedEvidenceDigest: null });
    return { operationKey: request.idempotencyKey, ...claimValues(result, claim), authority, authorityDigest: digestValue(authority) }; }
  async function bindSuccessor({ plan, intent }) { assertExecutionFence();
    const source = runtime.leaseStore.read(plan.sourceBranch).cloudAuthority;
    const before = runtime.readCloud(source);
    const current = findReviewedCiSuccessor(before, plan, "current");
    if (!current || current.claimId !== intent.promotion.values.claimId) { throw new Error("Promoted successor drifted before new-PR binding."); }
    const authority = intent.promotion.values.authority, replacement = intent.replacementPullRequest.values;
    requireReplacementLifecycle(plan, runtime.readPull(replacement.pullRequestNumber), createReviewedCiRevisionPullRequestBootstrap(plan), intent);
    if (authority.reviewRequestId !== null || authority.focusedEvidenceDigest !== null) {
      throw new Error("Promotion authority is already review-bound before exact bind replay."); }
    const request = { targetRepository: source.targetRepository, branch: plan.sourceBranch,
      canonicalBaseSha: authority.canonicalBaseSha, headSha: plan.sourceHeadSha,
      deviceId: plan.sourceDeviceId, sessionId: plan.sourceSessionId, claimId: authority.claimId,
      expectedFenceRevision: authority.claimDigest, expectedTransitionCounter: authority.transitionCounter,
      reviewRequestId: `github-pull-request:${replacement.pullRequestNodeId}`,
      idempotencyKey: reviewedCiRevisionOperationKey(plan, "bind-successor"), mode: "projection" };
    const result = replayCloud(runtime, "continue", source, request, status => { const claim = findReviewedCiSuccessor(status, plan, "current");
      return claim?.claimId === authority.claimId && claim.reviewRequestId === request.reviewRequestId; });
    const claim = requireMutationClaim(result, plan, "current", request.idempotencyKey);
    if (claim.reviewRequestId !== request.reviewRequestId) throw new Error("Bind returned a foreign review identity.");
    const boundAuthority = Object.freeze({ ...normalizeBoundAuthority({ result: withLedgerDigest(result), authority,
      manifest: manifestFromLease(runtime.leaseStore.read(plan.sourceBranch)),
      deviceId: plan.sourceDeviceId, sessionId: plan.sourceSessionId, focusedEvidenceDigest: null }),
      reviewRequestId: request.reviewRequestId, focusedEvidenceDigest: null });
    const bound = runtime.verifyActive({ authority: boundAuthority, manifest: manifestFromLease(runtime.leaseStore.read(plan.sourceBranch)),
      canonicalBaseSha: plan.successorCanonicalBaseSha });
    return { operationKey: request.idempotencyKey, authority: bound.authority, claimId: bound.authority.claimId,
      claimDigest: bound.authority.claimDigest, transitionCounter: bound.authority.transitionCounter,
      operationReceiptDigest: bound.authority.operationReceiptDigest, authorityDigest: digestValue(bound.authority),
      receiptDigest: bound.authority.operationReceiptDigest, verificationReceiptDigest: bound.verification.receiptDigest,
      verifiedAt: bound.verification.verifiedAt, }; }
  function remoteValues(plan, intent, projection) { return {
    operationKey: reviewedCiRevisionOperationKey(plan, "active-pr-marker"),
    pullRequestNodeId: intent.replacementPullRequest.values.pullRequestNodeId,
    bodyDigest: projection.bodyDigest, remoteProofDigest: projection.remoteProofDigest,
    writerMarker: projection.writerMarker, recoveryMarker: projection.recoveryMarker,
    localProjection: projection.localProjection, activeLease: projection.intendedLease,
    finalReceipt: projection.finalReceipt }; }
  function reconstructRemoteCandidate(plan, intent, lease) {
    const candidate = intent.pullRequestProjectionCandidate?.values;
    if (!candidate) throw new Error("Remote projection lacks its durable pre-write candidate.");
    const local = candidate.localProjection.values;
    const projection = projectReviewedCiRemoteActive({ plan, intent, lease, epoch: local.epoch,
      terminalVerification: local.terminalVerification });
    if (digestValue(remoteValues(plan, intent, projection)) !== digestValue(candidate)) throw new Error(
      "Durable remote candidate is not exactly reconstructible.");
    return projection;
  }
  async function preparePullRequestProjection({ plan, intent }) { requireProviderMutationBoundary(plan, intent);
    const lease = runtime.leaseStore.read(plan.sourceBranch);
    const pull = runtime.readPull(intent.replacementPullRequest.values.pullRequestNumber);
    const bootstrap = createReviewedCiRevisionPullRequestBootstrap(plan);
    const expectedBody = intent.pullRequestProjection
      ? expectedReplacementBody(plan, intent, "remote-active", lease) : bootstrap.body;
    assertReviewedCiReplacementPull(plan, intent, pull, expectedBody); assertGitHubPullQueueFence(pull);
    const verified = await requireLiveBoundMargin(plan, intent);
    const terminalVerification = buildReviewedCiTerminalVerification({
      authorityDigest: intent.binding.values.authorityDigest,
      receiptDigest: verified.verification.receiptDigest,
      verifiedAt: verified.verification.verifiedAt, expiresAt: verified.authority.expiresAt });
    const projection = projectReviewedCiRemoteActive({ plan, intent, lease,
      epoch: nextWriterEpoch(runtime.leaseStore, plan.sourceBranch), terminalVerification });
    assertGitHubPullRequestBounds({ title: bootstrap.title, body: projection.body });
    return remoteValues(plan, intent, projection);
  }
  async function projectPullRequest({ plan, intent }) { requireProviderMutationBoundary(plan, intent);
    const number = intent.replacementPullRequest.values.pullRequestNumber;
    const provider = runtime.readPull(number);
    const lease = runtime.leaseStore.read(plan.sourceBranch);
    const projection = reconstructRemoteCandidate(plan, intent, lease);
    assertGitHubPullRequestBounds({ title: createReviewedCiRevisionPullRequestBootstrap(plan).title, body: projection.body });
    if (provider.body === projection.body) { assertReviewedCiReplacementPull(plan, intent, provider, projection.body); } else {
      const bootstrap = createReviewedCiRevisionPullRequestBootstrap(plan);
      assertReviewedCiReplacementPull(plan, intent, provider, provider.body);
      requireRecoveryPullBody({ plan, intent,
        phase: provider.body === bootstrap.body ? "successor-bound" : "remote-active", body: provider.body, lease });
      try { runtime.editPullBody(provider.url, projection.body); } catch { /* exact reread decides */ } }
    const verified = runtime.readPull(number);
    assertReviewedCiReplacementPull(plan, intent, verified, projection.body);
    if (digestValue(verified.body) !== projection.bodyDigest
      || digestValue(parseWriterLeasePullRequestBody(verified.body)) !== digestValue(projection.writerMarker)
      || digestValue(parseReviewedCiRevisionMarker(verified.body)) !== digestValue(projection.recoveryMarker)) {
      throw new Error("Active remote projections were not observed exactly."); }
    if (verified.nodeId !== intent.replacementPullRequest.values.pullRequestNodeId) throw new Error(
      "Remote projection returned a foreign pull-request node.");
    return intent.pullRequestProjectionCandidate.values; }
  async function activateLocal({ plan, intent }) { assertExecutionFence();
    await reconcilePhase({ plan, intent, phase: "remote-active" });
    const projection = intent.pullRequestProjection.values;
    const localProjection = projection.localProjection;
    const finalReceipt = projection.finalReceipt;
    const next = advanceReviewedCiRevisionIntent(intent, { status: "local-active",
      values: { localProjection, finalReceiptDigest: finalReceipt.receiptDigest }, });
    const { lease } = readLease();
    const activeLease = projection.activeLease;
    if (digestValue(activeLease) !== localProjection.values.leaseDigest) {
      throw new Error("Terminal active lease differs from its remote projection proof."); }
    return casIntent(lease, intent, next, activeLease); }
  async function archiveRecovery({ plan, intent, archive }) { assertExecutionFence();
    const { lease } = readLease();
    if (archive.planDigest !== plan.planDigest) throw new Error("Recovery archive plan drifted.");
    return archiveReviewedCiRevisionRegistry({ leaseStore: runtime.leaseStore,
      expectedLease: lease, expectedIntent: intent, archive }); }
  async function finalize({ plan, intent }) { await reconcilePhase({ plan, intent, phase: "local-active" });
    const expected = buildReviewedCiRevisionFinalReceipt(plan, intent, intent.localProjection);
    if (expected.receiptDigest !== intent.finalReceiptDigest) {
      throw new Error("Final live proof does not match the pre-authorized terminal receipt."); }
    return expected; }
  async function requireLiveReviewedMargin(plan) { const lease = runtime.leaseStore.read(plan.sourceBranch);
    const verified = runtime.verifyReview({ authority: lease.cloudAuthority, manifest: manifestFromLease(lease),
      headSha: plan.sourceHeadSha, branch: plan.sourceBranch, focusedEvidenceDigest: plan.sourceFocusedEvidenceDigest, });
    const margin = Date.parse(verified.authority.expiresAt)
      - Date.parse(verified.verification.verifiedAt);
    const privateClaim = exactReviewedCiClaim({ claims: await runtime.listPrivateClaims(lease.cloudAuthority), }, plan.sourceClaimId);
    if (verified.authority.claimId !== plan.sourceClaimId || verified.authority.deviceId !== plan.sourceDeviceId
      || verified.authority.sessionId !== plan.sourceSessionId || privateClaim.deviceId !== plan.sourcePrivateDeviceId
      || privateClaim.sessionId !== plan.sourcePrivateSessionId || margin < plan.minimumMarginSeconds * 1_000) {
      throw new Error("Live reviewed source lacks exact same-session server-time margin."); }
    return verified; }
  async function requireLiveBoundMargin(plan, intent) { const authority = intent.binding.values.authority;
    const verified = runtime.verifyActive({ authority, manifest: manifestFromLease(runtime.leaseStore.read(plan.sourceBranch)),
      canonicalBaseSha: plan.successorCanonicalBaseSha });
    const privateClaim = exactReviewedCiClaim({ claims: await runtime.listPrivateClaims(authority) }, authority.claimId);
    const expectedReview = `github-pull-request:${intent.replacementPullRequest.values.pullRequestNodeId}`;
    const margin = Date.parse(verified.authority.expiresAt) - Date.parse(verified.verification.verifiedAt);
    if (digestValue(verified.authority) !== intent.binding.values.authorityDigest
      || verified.authority.deviceId !== plan.sourceDeviceId || verified.authority.sessionId !== plan.sourceSessionId
      || verified.authority.reviewRequestId !== expectedReview || verified.authority.focusedEvidenceDigest !== null
      || privateClaim.deviceId !== plan.sourcePrivateDeviceId || privateClaim.sessionId !== plan.sourcePrivateSessionId
      || margin < plan.minimumMarginSeconds * 1_000) throw new Error( "Bound successor lacks exact same-session server-time margin.");
    return verified; }
  return createReviewedCiRevisionControllerAdapter({ assertExecutionFence, readState, beginIntent, advanceIntent, reconcilePhase, reconcileTransition,
    projectRecoveryIntent, claimSuccessor, retireSource, closeSourcePullRequest,
    createRevisionPullRequest, promoteSuccessor, bindSuccessor, preparePullRequestProjection,
    projectPullRequest, activateLocal, abortDeliveryWon, archiveRecovery, finalize, }); }
export function createRepositoryRuntime({ repository, environment }, dependencies = {}) {
  const command = dependencies.command || ((file, args) => execFileSync(file, args, {
    cwd: repository, encoding: "utf8", timeout: 60_000, maxBuffer: 2 * 1024 * 1024, env: environment, }));
  const git = args => safeCommand(command, "git", args);
  const gh = args => safeCommand(command, "gh", args);
  const providerRepository = normalizeGitHubOriginRepository(git(["remote", "get-url", "origin"]));
  const common = git(["rev-parse", "--git-common-dir"]).trim();
  const gitCommonDir = path.resolve(repository, common);
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({ gitCommonDir });
  const privateClaims = dependencies.privateClaims || (authority => createGitHubCloudCollaborationAdapter({
    ledgerRepository: authority.ledgerRepository, token: environment.GH_TOKEN || environment.GITHUB_TOKEN || "",
    request: dependencies.request || null, }).listClaims({ targetRepository: authority.targetRepository }));
  return { leaseStore, requireSharedEntrypointFence() {
      throw new Error("Reviewed CI revision execution requires protected device:review replay fencing before source retirement."); }, readLocal() {
      const root = realpathSync(git(["rev-parse", "--show-toplevel"]).trim());
      if (root !== repository) throw new Error("Invocation path is not the configured worktree.");
      const porcelain = git(["worktree", "list", "--porcelain", "-z"]);
      const record = assertRegisteredWorktree({ cwd: root, porcelain });
      const branch = git(["branch", "--show-current"]).trim();
      const identity = parseDeviceBranch(branch);
      if (!identity || record.branch !== `refs/heads/${branch}`) { throw new Error("Registered branch is not one unique agent device lane."); }
      const headSha = sha(git(["rev-parse", "HEAD"]));
      const originRepository = normalizeGitHubOriginRepository(git(["remote", "get-url", "origin"]));
      const treeSha = sha(git(["rev-parse", "HEAD^{tree}"]));
      const clean = git(["status", "--porcelain=v1", "-z"]) === "";
      if (!clean) throw new Error("Reviewed source worktree/index is not clean.");
      const remoteHeadSha = remoteSha(git, `refs/heads/${branch}`);
      git(["fetch", "--prune", "origin", "+refs/heads/main:refs/remotes/origin/main"]);
      const remoteMainSha = remoteSha(git, "refs/heads/main");
      if (sha(git(["rev-parse", "refs/remotes/origin/main"])) !== remoteMainSha) {
        throw new Error("Fetched origin/main drifted from the observed protected head."); }
      const identityDigest = digestValue({ root, branch, registeredHead: record.head, originRepository });
      return { root, branch, identity, identityDigest, originRepository, headSha, treeSha, clean, remoteHeadSha, remoteMainSha }; },
    readProtectedMainAdvance({ canonicalBaseSha, observedMainSha }) { const canonical = sha(canonicalBaseSha), observed = sha(observedMainSha);
      let ancestryPath = [];
      if (canonical !== observed) { git(["merge-base", "--is-ancestor", canonical, observed]);
        ancestryPath = git(["rev-list", "--reverse", "--ancestry-path", `${canonical}..${observed}`]) .trim().split(/\s+/u).filter(Boolean).map(sha);
      }
      if (ancestryPath.length > 32 || canonical !== observed && (ancestryPath.length < 1
        || ancestryPath.at(-1) !== observed) || new Set(ancestryPath).size !== ancestryPath.length) {
        throw new Error("Protected main ancestry is not one bounded forward path."); }
      const core = { schema: "agentic-reviewed-ci-protected-main-advance/v1", canonicalBaseSha: canonical, observedMainSha: observed, ancestryPath };
      return { ...core, receiptDigest: digestValue(core) }; }, readProvider({ pullRequestNumber: number, checkRunId: checkId,
      expectedState = "OPEN" }) { return readGitHubReviewedCiFailureSubject({ gh,
        pullRequestNumber: number, checkRunId: checkId, expectedState }); },
    readPull(number) { return readGitHubPullLifecycleSubject({ gh, pullRequestNumber: positive(number, "pull-request number") }).pullRequest; },
    listOpenPulls(branch) { return readGitHubOpenPullSubjects({ gh, branch }); }, createPull({ branch, title, body }) {
      return gh(["pr", "create", "--repo", providerRepository, "--draft", "--base", "main", "--head", branch,
        "--title", title, "--body", body]).trim(); }, closePull(url) { gh(["pr", "close", "--repo", providerRepository, url]); },
    readCloud(authority) { return invokeRepositoryCloudAction({ action: "status", ledgerRepository: authority.ledgerRepository,
        request: { targetRepository: authority.targetRepository }, environment, }); }, listPrivateClaims(authority) { return privateClaims(authority);
    }, verifyReview: input => verifyReviewReadyAdmissionCloudAuthority({ ...input, environment }),
    verifyActive: input => verifyAdmissionCloudAuthority({ ...input, environment }), cloud(action, authority, request) {
      return invokeRepositoryCloudAction({ action, ledgerRepository: authority.ledgerRepository, request, environment, }); },
    editPullBody(url, body) { gh(["pr", "edit", "--repo", providerRepository, url, "--body", body]); }, }; }
function requireProviderSubject(plan, provider, { requireDraft = null, requireState = "OPEN" } = {}) {
  return assertReviewedCiProviderSubject(plan, provider, {
    expectedDraft: requireDraft === null ? provider.pullRequest.isDraft : requireDraft, expectedState: requireState }); }
function requireSourceLifecycle(plan, intent, pull, expectedState = pull?.state) {
  if (!["OPEN", "CLOSED"].includes(expectedState)) throw new Error("Source PR lifecycle is not recoverable.");
  assertReviewedCiSourcePull(plan, pull, expectedState);
  assertGitHubPullQueueFence(pull);
  const expectedBodyDigest = intent?.sourcePullRequestClosure?.values?.bodyDigest || intent?.sourceProjection?.values?.bodyDigest;
  if (pull.isDraft !== false || !Array.isArray(pull.labels) || !expectedBodyDigest || digestValue(pull.body) !== expectedBodyDigest
    || (expectedState === "OPEN" ? pull.closedAt !== null : !pull.closedAt)) {
    throw new Error("Source PR body, draft, labels, or closure timestamp drifted."); }
  return pull; }
function requireClosableSourceLifecycle(plan, intent, pull, expectedState, lease = null) { assertReviewedCiSourcePull(plan, pull, expectedState);
  assertGitHubPullQueueFence(pull);
  sourceBodyDisposition(plan, intent, pull, lease);
  if (pull.isDraft !== false || !Array.isArray(pull.labels) || (expectedState === "OPEN" ? pull.closedAt !== null : !pull.closedAt)) {
    throw new Error("Closable source PR lifecycle drifted."); }
  return pull; }
function sourceBodyDisposition(plan, intent, pull, lease = null) { const bodyDigest = digestValue(pull.body);
  const projectedDigest = intent?.sourceProjection?.values?.bodyDigest || (lease ? projectReviewedCiSourceMarker(plan, lease).bodyDigest : null);
  if (bodyDigest === projectedDigest) return "recovery-projection";
  if (bodyDigest !== plan.pullRequestBodyDigest) throw new Error("Source PR body is neither authorized close state.");
  assertReviewedCiMarkerCardinality(pull.body, "absent");
  if (digestValue(parseWriterLeasePullRequestBody(pull.body)) !== plan.sourceWriterMarkerDigest) {
    throw new Error("Original reviewed body lost its exact writer marker."); }
  return "original-reviewed"; }
function requireReplacementLifecycle(plan, pull, bootstrap, intent = null) { const expected = intent || { replacementPullRequest: { values: {
    ...pull, bodyDigest: bootstrap.bodyDigest } } };
  assertReviewedCiReplacementPull(plan, expected, pull, bootstrap.body);
  assertGitHubPullQueueFence(pull);
  if (pull.closedAt !== null) throw new Error("Replacement draft already has a closure timestamp.");
  return pull; }
function sourceClosureValues(plan, intent, pull, providerDisposition, providerBoundaryDigest) {
  return { operationKey: reviewedCiRevisionOperationKey(plan, "close-source-pr"), pullRequestNumber: pull.number,
    pullRequestNodeId: pull.nodeId, url: pull.url, state: pull.state, closedAt: pull.closedAt,
    mergedAt: pull.mergedAt, headSha: pull.headSha, baseSha: pull.baseSha,
    bodyDigest: digestValue(pull.body), bodyDisposition: sourceBodyDisposition(plan, intent, pull), providerDisposition, providerBoundaryDigest }; }
function requireProtectedMainAdvance(runtime, lease, local, expectedDigest = null) {
  const receipt = runtime.readProtectedMainAdvance({ canonicalBaseSha: lease.cloudAuthority.canonicalBaseSha, observedMainSha: local.remoteMainSha });
  if (expectedDigest && receipt.receiptDigest !== expectedDigest) throw new Error("Protected-main ancestry receipt drifted.");
  return receipt; }
function replayCloud(runtime, action, authority, request, reconciler) { try { return runtime.cloud(action, authority, request); } catch (error) {
    const status = runtime.readCloud(authority);
    if (!reconciler(status)) throw error;
    return runtime.cloud(action, authority, request); } }
function responseAhead(operationKeyValue, values) {
  if (values?.operationKey !== operationKeyValue) throw new Error("Response-ahead operation key drifted.");
  return { kind: "response-ahead", operationKey: operationKeyValue, values }; }
function requireMutationClaim(result, plan, state, operationKeyValue) { const claim = result?.claim;
  const operationReceipt = result?.operationReceipt;
  if (!claim || claim.state !== state || claim.actorId !== plan.sourceActorId
    || claim.repositoryId !== plan.sourceRepositoryId || claim.workItemId !== plan.sourceWorkItemId
    || claim.canonicalBaseRevision !== plan.successorCanonicalBaseSha
    || claim.laneRevision !== plan.sourceHeadSha || claim.leaseEpoch !== plan.successorCloudLeaseEpoch
    || claim.predecessorClaimId !== plan.sourceClaimId
    || !operationReceipt?.requestDigest || operationReceipt.idempotencyKey !== digestValue(operationKeyValue)
    || claim.operationReceiptDigest !== operationReceipt.receiptDigest) { throw new Error("Cloud mutation returned a foreign successor."); }
  return claim; }
function claimValues(result, claim) { return { claimId: claim.claimId, claimDigest: result.claimDigest || claim.fenceRevision,
    transitionCounter: claim.transitionCounter, operationReceiptDigest: claim.operationReceiptDigest,
    requestDigest: result.operationReceipt.requestDigest, receiptDigest: required(result.receipt?.receiptDigest, "cloud receipt"),
    ledgerDigest: required(result.receipt?.ledgerDigest, "cloud ledger digest"), state: claim.state, canonicalBaseSha: claim.canonicalBaseRevision,
    laneRevision: claim.laneRevision, leaseEpoch: claim.leaseEpoch, }; }
function requireStoredIntent(leaseStore, branch, intent) { const stored = readRecoveryIntent(leaseStore, branch);
  if (digestValue(stored) !== digestValue(normalizeReviewedCiRevisionIntent(intent))) { throw new Error("Stored recovery intent changed before CAS.");
  } }
function requireExactWriterMarker(marker, lease) { if (digestValue(marker) !== digestValue(projectWriterLeasePullRequestMarker(lease))) {
    throw new Error("Pull-request writer marker drifted from the exact local lease."); } }
function manifestFromLease(lease) { const admission = lease?.admission;
  const declaredWriteSet = normalizeWriteSet(admission?.declaredWriteSet);
  if (admission?.status !== "admitted" || admission.writeSetDigest !== digestValue(declaredWriteSet)) {
    throw new Error("Writer admission manifest is invalid."); }
  return { ...admission, declaredWriteSet }; }
function remoteSha(git, ref) { return sha(git(["ls-remote", "--heads", "origin", ref]).trim().split(/\s+/u)[0]); }
function withLedgerDigest(result) { return { ...result, ledgerDigest: result.ledgerDigest || result.receipt?.ledgerDigest }; }
function safeCommand(command, file, args) { try { return command(file, args); } catch { throw new Error(`${file} command failed without exposing child-process output.`); } }
function sha(value) { const text = String(value || "").trim(); if (!/^[0-9a-f]{40}$/u.test(text)) throw new Error("Git identity is not an exact SHA."); return text; }
function required(value, label) { const text = String(value ?? "").normalize("NFC").trim(); if (!text || text.length > 2_048) throw new Error(`${label} is invalid.`); return text; }
function positive(value, label) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${label} must be positive.`); return number; }
