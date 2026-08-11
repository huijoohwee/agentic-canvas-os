import { digestValue, normalizeWriteSet } from "./cloud-collaboration-primitives.mjs";
import { normalizeReviewedCiFailureEvidence } from "./reviewed-ci-revision-evidence.mjs";
import { parseWriterLeasePullRequestBody, projectWriterLeasePullRequestMarker, updateWriterLeasePullRequestBody } from "./writer-lease-lib.mjs";
export const REVIEWED_CI_REVISION_PLAN_SCHEMA = "agentic-reviewed-ci-revision-recovery-plan/v1", REVIEWED_CI_REVISION_INTENT_SCHEMA = "agentic-reviewed-ci-revision-recovery-intent/v1";
export const REVIEWED_CI_REVISION_RECEIPT_SCHEMA = "agentic-reviewed-ci-revision-recovery-receipt/v1", REVIEWED_CI_REVISION_MARKER_SCHEMA = "agentic-reviewed-ci-revision-recovery/v1";
const SHA_PATTERN = /^[0-9a-f]{40}$/u, DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const PHASES = Object.freeze(["intent", "source-marker", "successor-waiting", "source-retired", "source-pr-closed", "replacement-pr-created", "successor-promoted", "successor-bound", "remote-active", "local-active"]);
const PHASE_OPERATIONS = Object.freeze({ "source-marker": "intent-marker", "successor-waiting": "claim", "source-retired": "retire-source", "source-pr-closed": "close-source-pr", "replacement-pr-created": "create-replacement-pr", "successor-promoted": "promote-successor", "successor-bound": "bind-successor", "remote-active": "active-pr-marker", "local-active": "activate-local" });
export function buildReviewedCiRevisionPlan({ source, ttlSeconds = 1_800 } = {}) {
  const evidence = normalizeReviewedCiFailureEvidence(source?.failureEvidence);
  const lease = requireLease(source?.lease);
  const authority = requireReviewAuthority(source?.authority);
  const claim = requireLiveClaim(source?.claim);
  const claimLedgerRevision = claim.transitionDigest || claim.ledgerRevision;
  const writeSet = normalizeWriteSet(lease.admission.declaredWriteSet);
  const protectedMainAdvance = normalizeProtectedMainAdvance(source?.protectedMainAdvance, authority.canonicalBaseSha, source?.remoteMainSha);
  const verifiedAt = requiredInstant(source?.verification?.verifiedAt, "server verification time");
  const minimumMarginSeconds = boundedMargin(source?.minimumMarginSeconds ?? 300);
  const marginMilliseconds = Date.parse(authority.expiresAt) - Date.parse(verifiedAt);
  const marginSeconds = Math.floor(marginMilliseconds / 1_000);
  if (marginSeconds < minimumMarginSeconds) {
    throw new Error("Reviewed source lacks the required server-time execution margin.");
  }
  if (authority.state !== "review_ready" || claim.state !== "reviewed") {
    throw new Error("Reviewed CI recovery rejects dormant or non-reviewed cloud authority.");
  }
  if (lease.status !== "review_ready"
    || lease.sessionId !== authority.sessionId
    || lease.device !== authority.deviceId
    || authority.claimId !== claim.claimId
    || authority.claimDigest !== claim.fenceRevision
    || authority.claimLedgerRevision !== claimLedgerRevision
    || authority.transitionCounter !== claim.transitionCounter
    || authority.expiresAt !== claim.expiresAt
    || authority.operationReceiptDigest !== claim.operationReceiptDigest
    || claim.deviceId !== source.privateDeviceId
    || claim.sessionId !== source.privateSessionId
    || authority.entrySchema !== "agentic-cloud-collaboration-entry/v2"
    || claim.entrySchema !== authority.entrySchema
    || claim.claimIdentitySchema !== authority.claimIdentitySchema
    || authority.laneRevision !== evidence.headSha
    || authority.reviewRequestId !== claim.reviewRequestId
    || authority.reviewRequestId !== `github-pull-request:${source.pullRequest.nodeId}`
    || lease.pullRequestUrl !== source.pullRequest.url
    || source.pullRequest.url !== `https://github.com/${evidence.repository}/pull/${source.pullRequest.number}`
    || source.pullRequest.number !== evidence.pullRequestNumber
    || source.headSha !== evidence.headSha
    || source.remoteHeadSha !== evidence.headSha
    || source.pullRequest.headSha !== evidence.headSha
    || source.pullRequest.baseSha !== evidence.baseSha
    || source.pullRequest.branch !== lease.branch
    || source.pullRequest.baseRef !== "main"
    || source.pullRequest.nodeId !== evidence.pullRequestNodeId
    || source.pullRequest.repository !== evidence.repository
    || source.pullRequest.authorLogin !== evidence.actorLogin
    || source.repository !== evidence.repository
    || source.originRepository !== evidence.repository
    || claim.actorId !== `github-user:${evidence.actorId}`
    || source.pullRequest.isDraft !== false
    || source.pullRequest.state !== "OPEN"
    || source.clean !== true
    || lease.reviewHeadSha !== evidence.headSha
    || lease.cloudAuthority?.claimId !== authority.claimId
    || lease.cloudAuthority?.claimDigest !== authority.claimDigest
    || lease.cloudAuthority?.claimLedgerRevision !== authority.claimLedgerRevision
    || lease.cloudAuthority?.transitionCounter !== authority.transitionCounter
    || lease.cloudAuthority?.sessionId !== authority.sessionId
    || lease.cloudAuthority?.deviceId !== authority.deviceId
    || lease.cloudAuthority?.state !== authority.state
    || lease.cloudAuthority?.expiresAt !== authority.expiresAt
    || lease.cloudAuthority?.manifestDigest !== lease.admission.manifestDigest
    || lease.cloudAuthority?.writeSetDigest !== lease.admission.writeSetDigest
    || JSON.stringify(normalizeWriteSet(lease.cloudAuthority?.cloudDeclaredWriteScope)) !== JSON.stringify(writeSet)
    || claim.repositoryId !== `github-repository:${evidence.repositoryNodeId}`
    || claim.laneRevision !== evidence.headSha
    || claim.canonicalBaseRevision !== authority.canonicalBaseSha
    || claim.leaseEpoch !== authority.leaseEpoch
    || claim.writeSetDigest !== lease.admission.writeSetDigest
    || JSON.stringify(normalizeWriteSet(claim.declaredWriteScope)) !== JSON.stringify(writeSet)
    || lease.baseSha !== authority.canonicalBaseSha
    || authority.canonicalBaseSha !== evidence.baseSha
    || lease.admission.writeSetDigest !== digestValue(writeSet)) {
    throw new Error("Reviewed source identity drifted before plan construction.");
  }
  const core = {
    schema: REVIEWED_CI_REVISION_PLAN_SCHEMA, repository: requiredText(source.repository, "repository"), sourceOriginRepository: requiredText(source.originRepository, "source origin repository"), sourceSessionId: requiredText(lease.sessionId, "source session"), sourceDeviceId: requiredText(lease.device, "source device"), sourceScope: requiredText(lease.scope, "source scope"), sourceBranch: requiredText(lease.branch, "source branch"), sourceWorktreeIdentityDigest: requiredDigest(source.worktreeIdentityDigest, "worktree identity digest"), sourceLeaseDigest: requiredDigest(source.leaseDigest, "source lease digest"), sourceLocalEpoch: positiveInteger(lease.epoch, "source local epoch"), sourceBaseSha: requiredSha(lease.baseSha, "source base SHA"), sourceFenceSha: requiredSha(lease.fenceSha, "source fence SHA"), sourceHeadSha: evidence.headSha, sourceTreeSha: requiredSha(source.treeSha, "source tree SHA"), sourceRemoteMainSha: requiredSha(source.remoteMainSha, "remote main SHA"), observedProtectedMainSha: requiredSha(source.remoteMainSha, "observed protected main SHA"), protectedMainAdvance, protectedMainAdvanceDigest: protectedMainAdvance.receiptDigest, sourceClaimId: requiredDigest(authority.claimId, "source claim ID"), sourceClaimDigest: requiredDigest(authority.claimDigest, "source claim digest"), sourceClaimLedgerRevision: requiredDigest(authority.claimLedgerRevision, "source claim ledger revision"), sourceLedgerRevision: requiredSha(authority.ledgerRevision, "source ledger revision"), sourceLedgerDigest: requiredDigest(authority.ledgerDigest, "source ledger digest"), sourceCloudLeaseEpoch: positiveInteger(authority.leaseEpoch, "source cloud lease epoch"), sourceTransitionCounter: positiveInteger(authority.transitionCounter, "source transition counter"), sourceReviewRequestId: requiredText(authority.reviewRequestId, "source review request ID"), sourceFocusedEvidenceDigest: requiredDigest(authority.focusedEvidenceDigest, "source review evidence digest"), sourceActorId: requiredText(claim.actorId, "source actor ID"), sourcePrivateDeviceId: requiredText(source.privateDeviceId, "private source device"), sourcePrivateSessionId: requiredText(source.privateSessionId, "private source session"), sourceRepositoryId: requiredText(claim.repositoryId, "source repository ID"), sourceWorkItemId: requiredText(claim.workItemId, "source work-item ID"), sourceExpiresAt: requiredInstant(claim.expiresAt, "source expiry"), sourceVerifiedAt: verifiedAt, sourceMarginMilliseconds: marginMilliseconds, sourceMarginSeconds: marginSeconds, minimumMarginSeconds, pullRequestUrl: requiredText(lease.pullRequestUrl, "pull-request URL"), pullRequestNumber: positiveInteger(source.pullRequest.number, "pull-request number"), pullRequestNodeId: requiredText(source.pullRequest.nodeId, "pull-request node ID"), pullRequestAuthorLogin: requiredText(source.pullRequest.authorLogin, "pull-request author"), pullRequestBody: boundedBody(source.pullRequest.body), pullRequestBodyDigest: requiredDigest(source.pullRequestBodyDigest, "pull-request body digest"), sourceWriterMarkerDigest: requiredDigest(source.writerMarkerDigest, "writer marker digest"), sourcePullRequestTitle: requiredText(source.pullRequest.title, "source pull-request title"), strategy: "close-reviewed-source-and-create-draft-successor", manifestDigest: requiredDigest(lease.admission.manifestDigest, "manifest digest"), writeSetDigest: requiredDigest(lease.admission.writeSetDigest, "write-set digest"), declaredWriteSet: writeSet, successorCanonicalBaseSha: authority.canonicalBaseSha, successorCloudLeaseEpoch: positiveInteger(authority.leaseEpoch + 1, "successor cloud lease epoch"), failureEvidence: evidence, failureEvidenceDigest: evidence.evidenceDigest, ttlSeconds: boundedTtl(ttlSeconds), };
  if (core.pullRequestBodyDigest !== digestValue(core.pullRequestBody)) {
    throw new Error("Pull-request body snapshot drifted before plan construction.");
  }
  core.replacementNonce = digestValue({ strategy: core.strategy, sourceClaimId: core.sourceClaimId, pullRequestNodeId: core.pullRequestNodeId, headSha: core.sourceHeadSha, evidence: core.failureEvidenceDigest });
  return deepFreeze({ ...core, planDigest: digestValue(core) }); }
export function normalizeReviewedCiRevisionPlan(value) {
  if (!value || value.schema !== REVIEWED_CI_REVISION_PLAN_SCHEMA) {
    throw new Error("Reviewed CI revision plan is malformed.");
  }
  const evidence = normalizeReviewedCiFailureEvidence(value.failureEvidence);
  const writeSet = normalizeWriteSet(value.declaredWriteSet);
  const protectedMainAdvance = normalizeProtectedMainAdvance(value.protectedMainAdvance, value.successorCanonicalBaseSha, value.observedProtectedMainSha);
  const core = {
    schema: REVIEWED_CI_REVISION_PLAN_SCHEMA, repository: requiredText(value.repository, "repository"), sourceOriginRepository: requiredText(value.sourceOriginRepository, "source origin repository"), sourceSessionId: requiredText(value.sourceSessionId, "source session"), sourceDeviceId: requiredText(value.sourceDeviceId, "source device"), sourceScope: requiredText(value.sourceScope, "source scope"), sourceBranch: requiredText(value.sourceBranch, "source branch"), sourceWorktreeIdentityDigest: requiredDigest(value.sourceWorktreeIdentityDigest, "worktree identity digest"), sourceLeaseDigest: requiredDigest(value.sourceLeaseDigest, "source lease digest"), sourceLocalEpoch: positiveInteger(value.sourceLocalEpoch, "source local epoch"), sourceBaseSha: requiredSha(value.sourceBaseSha, "source base SHA"), sourceFenceSha: requiredSha(value.sourceFenceSha, "source fence SHA"), sourceHeadSha: requiredSha(value.sourceHeadSha, "source head SHA"), sourceTreeSha: requiredSha(value.sourceTreeSha, "source tree SHA"), sourceRemoteMainSha: requiredSha(value.sourceRemoteMainSha, "remote main SHA"), observedProtectedMainSha: requiredSha(value.observedProtectedMainSha, "observed protected main SHA"), protectedMainAdvance, protectedMainAdvanceDigest: requiredDigest(value.protectedMainAdvanceDigest, "protected-main advance digest"), sourceClaimId: requiredDigest(value.sourceClaimId, "source claim ID"), sourceClaimDigest: requiredDigest(value.sourceClaimDigest, "source claim digest"), sourceClaimLedgerRevision: requiredDigest(value.sourceClaimLedgerRevision, "source claim ledger revision"), sourceLedgerRevision: requiredSha(value.sourceLedgerRevision, "source ledger revision"), sourceLedgerDigest: requiredDigest(value.sourceLedgerDigest, "source ledger digest"), sourceCloudLeaseEpoch: positiveInteger(value.sourceCloudLeaseEpoch, "source cloud lease epoch"), sourceTransitionCounter: positiveInteger(value.sourceTransitionCounter, "source transition counter"), sourceReviewRequestId: requiredText(value.sourceReviewRequestId, "source review request ID"), sourceFocusedEvidenceDigest: requiredDigest(value.sourceFocusedEvidenceDigest, "source review evidence digest"), sourceActorId: requiredText(value.sourceActorId, "source actor ID"), sourcePrivateDeviceId: requiredText(value.sourcePrivateDeviceId, "private source device"), sourcePrivateSessionId: requiredText(value.sourcePrivateSessionId, "private source session"), sourceRepositoryId: requiredText(value.sourceRepositoryId, "source repository ID"), sourceWorkItemId: requiredText(value.sourceWorkItemId, "source work-item ID"), sourceExpiresAt: requiredInstant(value.sourceExpiresAt, "source expiry"), sourceVerifiedAt: requiredInstant(value.sourceVerifiedAt, "source verification"), sourceMarginMilliseconds: positiveInteger(value.sourceMarginMilliseconds, "source margin milliseconds"), sourceMarginSeconds: positiveInteger(value.sourceMarginSeconds, "source margin"), minimumMarginSeconds: boundedMargin(value.minimumMarginSeconds), pullRequestUrl: requiredText(value.pullRequestUrl, "pull-request URL"), pullRequestNumber: positiveInteger(value.pullRequestNumber, "pull-request number"), pullRequestNodeId: requiredText(value.pullRequestNodeId, "pull-request node ID"), pullRequestAuthorLogin: requiredText(value.pullRequestAuthorLogin, "pull-request author"), pullRequestBody: boundedBody(value.pullRequestBody), pullRequestBodyDigest: requiredDigest(value.pullRequestBodyDigest, "pull-request body digest"), sourceWriterMarkerDigest: requiredDigest(value.sourceWriterMarkerDigest, "writer marker digest"), sourcePullRequestTitle: requiredText(value.sourcePullRequestTitle, "source pull-request title"), strategy: value.strategy === "close-reviewed-source-and-create-draft-successor"
      ? value.strategy : invalidPlan("replacement strategy"), manifestDigest: requiredDigest(value.manifestDigest, "manifest digest"), writeSetDigest: requiredDigest(value.writeSetDigest, "write-set digest"), declaredWriteSet: writeSet, successorCanonicalBaseSha: requiredSha(value.successorCanonicalBaseSha, "successor canonical base SHA"), successorCloudLeaseEpoch: positiveInteger(value.successorCloudLeaseEpoch, "successor cloud lease epoch"), failureEvidence: evidence, failureEvidenceDigest: requiredDigest(value.failureEvidenceDigest, "failure evidence digest"), ttlSeconds: boundedTtl(value.ttlSeconds), replacementNonce: requiredDigest(value.replacementNonce, "replacement nonce"), };
  if (core.failureEvidenceDigest !== evidence.evidenceDigest
    || core.writeSetDigest !== digestValue(writeSet)
    || core.pullRequestBodyDigest !== digestValue(core.pullRequestBody)
    || core.sourceHeadSha !== evidence.headSha
    || core.pullRequestNumber !== evidence.pullRequestNumber
    || core.pullRequestNodeId !== evidence.pullRequestNodeId
    || core.pullRequestAuthorLogin !== evidence.actorLogin
    || core.repository !== evidence.repository
    || core.sourceActorId !== `github-user:${evidence.actorId}`
    || core.replacementNonce !== digestValue({ strategy: core.strategy, sourceClaimId: core.sourceClaimId, pullRequestNodeId: core.pullRequestNodeId, headSha: core.sourceHeadSha, evidence: core.failureEvidenceDigest })
    || core.successorCloudLeaseEpoch !== core.sourceCloudLeaseEpoch + 1
    || core.protectedMainAdvanceDigest !== protectedMainAdvance.receiptDigest
    || core.observedProtectedMainSha !== core.sourceRemoteMainSha
    || core.successorCanonicalBaseSha !== core.sourceBaseSha
    || core.successorCanonicalBaseSha !== evidence.baseSha
    || core.sourceMarginSeconds < core.minimumMarginSeconds
    || Date.parse(core.sourceExpiresAt) - Date.parse(core.sourceVerifiedAt)
      !== core.sourceMarginMilliseconds
    || Math.floor(core.sourceMarginMilliseconds / 1_000) !== core.sourceMarginSeconds
    || value.planDigest !== digestValue(core)) {
    throw new Error("Reviewed CI revision plan digest or identity is invalid.");
  }
  return deepFreeze({ ...core, planDigest: value.planDigest }); }
export function authorizeReviewedCiRevision({ plan, authorization } = {}) {
  const normalized = normalizeReviewedCiRevisionPlan(plan);
  const exact = `authorize reviewed-ci-revision-recovery ${normalized.planDigest}`;
  if (String(authorization || "").trim() !== exact) {
    throw new Error(`Reviewed CI revision recovery requires exact authorization: ${exact}`);
  }
  return deepFreeze({
    schema: "agentic-reviewed-ci-revision-recovery-authorization/v1", planDigest: normalized.planDigest, authorizationDigest: digestValue({ authorization: exact, planDigest: normalized.planDigest }), }); }
export function createReviewedCiRevisionIntent(plan, authorizationReceipt) {
  const normalized = normalizeReviewedCiRevisionPlan(plan);
  const authorization = normalizeAuthorizationReceipt(authorizationReceipt, normalized);
  return normalizeReviewedCiRevisionIntent({
    schema: REVIEWED_CI_REVISION_INTENT_SCHEMA, status: "intent", planDigest: normalized.planDigest, planSnapshot: normalized, authorization, successor: null, sourceProjection: null, sourceRetirement: null, sourcePullRequestClosure: null, replacementPullRequest: null, promotion: null, binding: null, localProjection: null, pullRequestProjectionCandidate: null, pullRequestProjection: null, abortCleanup: null, finalReceiptDigest: null, }); }
export function advanceReviewedCiRevisionIntent(intent, { status, values = {} } = {}) {
  const current = normalizeReviewedCiRevisionIntent(intent);
  const nextIndex = PHASES.indexOf(status);
  const currentIndex = PHASES.indexOf(current.status);
  if (nextIndex < currentIndex || nextIndex > currentIndex + 1) {
    throw new Error("Reviewed CI revision intent phase is non-monotonic.");
  }
  const next = normalizeReviewedCiRevisionIntent({ ...current, ...values, status });
  if (current.abortCleanup && (nextIndex !== currentIndex
    || digestValue(next.abortCleanup) !== digestValue(current.abortCleanup))) {
    throw new Error("Prepared abort cleanup is immutable and terminal for normal phase advancement.");
  }
  return next; }
export function normalizeReviewedCiRevisionIntent(value) {
  if (!value || value.schema !== REVIEWED_CI_REVISION_INTENT_SCHEMA
    || !PHASES.includes(value.status)) {
    throw new Error("Reviewed CI revision intent is malformed.");
  }
  const plan = normalizeReviewedCiRevisionPlan(value.planSnapshot);
  const intent = {
    schema: REVIEWED_CI_REVISION_INTENT_SCHEMA, status: value.status, planDigest: requiredDigest(value.planDigest, "intent plan digest"), planSnapshot: plan, authorization: normalizeAuthorizationReceipt(value.authorization, plan), successor: normalizePhaseSnapshot(value.successor, "successor-waiting", plan), sourceProjection: normalizePhaseSnapshot(value.sourceProjection, "source-marker", plan), sourceRetirement: normalizePhaseSnapshot(value.sourceRetirement, "source-retired", plan), sourcePullRequestClosure: normalizePhaseSnapshot(value.sourcePullRequestClosure, "source-pr-closed", plan), replacementPullRequest: normalizePhaseSnapshot(value.replacementPullRequest, "replacement-pr-created", plan), promotion: normalizePhaseSnapshot(value.promotion, "successor-promoted", plan), binding: normalizePhaseSnapshot(value.binding, "successor-bound", plan), localProjection: normalizePhaseSnapshot(value.localProjection, "local-active", plan), pullRequestProjectionCandidate: normalizePhaseSnapshot(value.pullRequestProjectionCandidate, "remote-active", plan), pullRequestProjection: normalizePhaseSnapshot(value.pullRequestProjection, "remote-active", plan), abortCleanup: normalizeAbortCleanup(value.abortCleanup, plan), finalReceiptDigest: value.finalReceiptDigest === null || value.finalReceiptDigest === undefined
      ? null : requiredDigest(value.finalReceiptDigest, "final receipt digest"), };
  if (intent.planDigest !== plan.planDigest) throw new Error("Intent plan snapshot drifted.");
  const requiredSnapshots = [
    ["source-marker", "sourceProjection"], ["successor-waiting", "successor"], ["source-retired", "sourceRetirement"], ["source-pr-closed", "sourcePullRequestClosure"], ["replacement-pr-created", "replacementPullRequest"], ["successor-promoted", "promotion"], ["successor-bound", "binding"], ["remote-active", "pullRequestProjection"], ["local-active", "localProjection"], ];
  const phase = PHASES.indexOf(intent.status);
  for (const [requiredPhase, field] of requiredSnapshots) {
    if (phase >= PHASES.indexOf(requiredPhase) && !intent[field]) {
      throw new Error(`Intent phase ${intent.status} requires ${field}.`);
    }
  }
  if (intent.status === "local-active" && !intent.finalReceiptDigest) {
    throw new Error("Terminal local-active intent requires its final receipt digest.");
  }
  if (intent.pullRequestProjectionCandidate
    && phase < PHASES.indexOf("successor-bound")) throw new Error(
    "Remote projection candidate predates bound successor authority.");
  assertIntentSemantics(plan, intent);
  return exactShape(value, intent, "recovery intent"); }
export function buildReviewedCiRevisionReceipt({ phase, plan, values = {} } = {}) {
  const normalized = normalizeReviewedCiRevisionPlan(plan);
  if (!PHASES.includes(phase) && !["preflight", "complete"].includes(phase)) throw new Error("Receipt phase is invalid.");
  const core = {
    schema: REVIEWED_CI_REVISION_RECEIPT_SCHEMA, phase, planDigest: normalized.planDigest, sourceClaimId: normalized.sourceClaimId, sourceHeadSha: normalized.sourceHeadSha, failureEvidenceDigest: normalized.failureEvidenceDigest, values: boundedSnapshot(values, "receipt values") || {}, };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) }); }
export function buildReviewedCiRevisionFinalReceipt(plan, intent, localProjection) {
  return buildReviewedCiRevisionReceipt({ phase: "complete", plan, values: {
    successorClaimId: intent.binding.values.claimId, successorAuthorityDigest: intent.binding.values.authorityDigest, sourceRetirementReceiptDigest: intent.sourceRetirement.values.receiptDigest, sourcePullRequestClosureDigest: intent.sourcePullRequestClosure.snapshotDigest, replacementPullRequestDigest: intent.replacementPullRequest.snapshotDigest, promotionReceiptDigest: intent.promotion.values.receiptDigest, bindingReceiptDigest: intent.binding.values.receiptDigest, terminalVerificationDigest: localProjection.values.terminalVerification.verificationDigest, remoteProjectionProofDigest: buildReviewedCiRevisionRemoteProofDigest(plan, intent, localProjection), localProjectionDigest: localProjection.snapshotDigest, } }); }
export function buildReviewedCiRevisionRemoteProofDigest(plan, intent, localProjection) {
  return digestValue({ schema: "agentic-reviewed-ci-revision-remote-proof/v1", planDigest: plan.planDigest, pullRequestNodeId: intent.replacementPullRequest.values.pullRequestNodeId, localProjectionDigest: localProjection.snapshotDigest, epoch: localProjection.values.epoch, authorityDigest: localProjection.values.authorityDigest, writerMarkerDigest: localProjection.values.writerMarkerDigest, terminalVerificationDigest: localProjection.values.terminalVerification.verificationDigest }); }
export function assertReviewedCiRevisionPhaseReceipts(plan, intent, phase, live) {
  const index = reviewedCiRevisionPhaseOrder(phase);
  if (index >= reviewedCiRevisionPhaseOrder("remote-active")) {
    const values = intent.pullRequestProjection.values;
    if (digestValue(values.writerMarker) !== digestValue(parseWriterLeasePullRequestBody(live.pullBody))
      || digestValue(values.recoveryMarker) !== digestValue(live.liveMarker)
      || values.finalReceipt.receiptDigest !== values.recoveryMarker.finalReceiptDigest) {
      throw new Error("Remote active projection receipt drifted.");
    }
  }
  if (index >= reviewedCiRevisionPhaseOrder("local-active")) {
    const writer = projectWriterLeasePullRequestMarker(live.lease);
    if (live.lease.status !== "active"
      || intent.finalReceiptDigest !== intent.pullRequestProjection.values.finalReceipt.receiptDigest
      || digestValue(writer) !== intent.localProjection.values.writerMarkerDigest
      || digestValue(live.lease.cloudAuthority) !== intent.localProjection.values.authorityDigest
      || digestValue(live.lease) !== intent.localProjection.values.leaseDigest) {
      throw new Error("Terminal local projection receipt drifted.");
    }
  } }
export function projectReviewedCiActiveLease({ lease, authority, recovery, activatedAt, fenceSha }) {
  return {
    ...lease, status: "active", cloudAuthority: authority, fenceSha, reviewHeadSha: null, deliveryHeadSha: null, acquiredAt: activatedAt, heartbeatAt: activatedAt, expiresAt: authority.expiresAt, ...(recovery ? { reviewedCiRevisionRecovery: recovery } : {}), }; }
export function reviewedCiRevisionPhaseOrder(value) {
  const index = PHASES.indexOf(value);
  if (index < 0) throw new Error("Recovery phase is invalid.");
  return index; }
export function buildReviewedCiRevisionPhaseSnapshot({ phase, plan, values = {} } = {}) {
  const normalized = normalizeReviewedCiRevisionPlan(plan);
  if (!PHASES.includes(phase) || phase === "intent" || phase === "complete") {
    throw new Error("Phase snapshot phase is invalid.");
  }
  const core = {
    schema: "agentic-reviewed-ci-revision-phase-snapshot/v1", phase, planDigest: normalized.planDigest, values: normalizePhaseValues(phase, normalized, values), };
  return deepFreeze({ ...core, snapshotDigest: digestValue(core) }); }
export function upsertReviewedCiRevisionMarker(body, marker) {
  const normalized = normalizeMarker(marker);
  const source = String(body || "").trimEnd();
  const rendered = `<!-- ${REVIEWED_CI_REVISION_MARKER_SCHEMA} ${JSON.stringify(normalized)} -->`;
  const pattern = new RegExp(`<!--\\s*${escapeRegExp(REVIEWED_CI_REVISION_MARKER_SCHEMA)}\\s+\\{.*?\\}\\s*-->`, "su");
  return pattern.test(source) ? source.replace(pattern, rendered) : `${source}\n\n${rendered}`.trim(); }
export function parseReviewedCiRevisionMarker(body) {
  const pattern = new RegExp(`<!--\\s*${escapeRegExp(REVIEWED_CI_REVISION_MARKER_SCHEMA)}\\s+(\\{.*?\\})\\s*-->`, "su");
  const match = String(body || "").match(pattern);
  return match ? normalizeMarker(JSON.parse(match[1])) : null; }
export function assertReviewedCiMarkerCardinality(body, recovery = "present", writer = 1) {
  const source = String(body || "");
  const writerCount = [...source.matchAll(/<!--\s*agentic-writer-lease\/v2\b/gu)].length;
  const recoveryCount = [...source.matchAll(/<!--\s*agentic-reviewed-ci-revision-recovery\/v1\b/gu)].length;
  const recoveryValid = recovery === "optional" ? recoveryCount <= 1
    : recovery === "absent" ? recoveryCount === 0 : recoveryCount === 1;
  if (writerCount !== writer || !recoveryValid) throw new Error("Pull-request marker cardinality is ambiguous.");
  return { writerCount, recoveryCount }; }
export function createReviewedCiRevisionMarker({ plan, intent, localLeaseDigest, finalReceiptDigest }) {
  const normalizedPlan = normalizeReviewedCiRevisionPlan(plan);
  const normalizedIntent = normalizeReviewedCiRevisionIntent(intent);
  const marker = {
    schema: REVIEWED_CI_REVISION_MARKER_SCHEMA, status: "active", planDigest: normalizedPlan.planDigest, failureEvidenceDigest: normalizedPlan.failureEvidenceDigest, sourceClaimId: normalizedPlan.sourceClaimId, successorClaimId: requiredDigest(normalizedIntent.promotion?.values?.claimId, "successor claim ID"), successorClaimDigest: requiredDigest(normalizedIntent.promotion?.values?.claimDigest, "successor claim digest"), successorTransitionCounter: positiveInteger(normalizedIntent.promotion?.values?.transitionCounter, "successor counter"), sourceRetirementReceiptDigest: requiredDigest(normalizedIntent.sourceRetirement?.values?.receiptDigest, "retirement receipt"), promotionReceiptDigest: requiredDigest(normalizedIntent.promotion?.values?.receiptDigest, "promotion receipt"), bindingReceiptDigest: requiredDigest(normalizedIntent.binding?.values?.receiptDigest, "binding receipt"), localProjectionDigest: requiredDigest(localLeaseDigest, "local projection digest"), finalReceiptDigest: requiredDigest(finalReceiptDigest, "final receipt digest"), };
  return normalizeMarker(marker); }
export function createReviewedCiRevisionIntentMarker(plan) {
  const normalized = normalizeReviewedCiRevisionPlan(plan);
  return normalizeMarker({
    schema: REVIEWED_CI_REVISION_MARKER_SCHEMA, status: "recovering", planDigest: normalized.planDigest, failureEvidenceDigest: normalized.failureEvidenceDigest, sourceClaimId: normalized.sourceClaimId, sourceHeadSha: normalized.sourceHeadSha, }); }
export function createReviewedCiRevisionPullRequestBootstrap(plan) {
  const normalized = normalizeReviewedCiRevisionPlan(plan);
  const withoutWriter = normalized.pullRequestBody.replace(
    /<!--\s*agentic-writer-lease\/v2\s+\{.*?\}\s*-->/su, "").trim();
  const title = `Revision: ${normalized.sourcePullRequestTitle}`.slice(0, 240);
  const linked = [withoutWriter, `Supersedes preserved failed review: ${normalized.pullRequestUrl}`, `Recovery nonce: ${normalized.replacementNonce}`].filter(Boolean).join("\n\n");
  const body = boundedBody(upsertReviewedCiRevisionMarker(linked, createReviewedCiRevisionIntentMarker(normalized)));
  return deepFreeze({ title, body, bodyDigest: digestValue(body) }); }
function normalizeMarker(value) {
  if (!value || value.schema !== REVIEWED_CI_REVISION_MARKER_SCHEMA) throw new Error("Recovery marker is malformed.");
  if (value.status === "recovering") {
    return deepFreeze({
      schema: REVIEWED_CI_REVISION_MARKER_SCHEMA, status: "recovering", planDigest: requiredDigest(value.planDigest, "marker plan digest"), failureEvidenceDigest: requiredDigest(value.failureEvidenceDigest, "marker failure digest"), sourceClaimId: requiredDigest(value.sourceClaimId, "marker source claim"), sourceHeadSha: requiredSha(value.sourceHeadSha, "marker source head"), });
  }
  if (value.status !== "active") throw new Error("Recovery marker status is invalid.");
  return deepFreeze({
    schema: REVIEWED_CI_REVISION_MARKER_SCHEMA, status: "active", planDigest: requiredDigest(value.planDigest, "marker plan digest"), failureEvidenceDigest: requiredDigest(value.failureEvidenceDigest, "marker failure digest"), sourceClaimId: requiredDigest(value.sourceClaimId, "marker source claim"), successorClaimId: requiredDigest(value.successorClaimId, "marker successor claim"), successorClaimDigest: requiredDigest(value.successorClaimDigest, "marker successor fence"), successorTransitionCounter: positiveInteger(value.successorTransitionCounter, "marker successor counter"), sourceRetirementReceiptDigest: requiredDigest(value.sourceRetirementReceiptDigest, "marker retirement receipt"), promotionReceiptDigest: requiredDigest(value.promotionReceiptDigest, "marker promotion receipt"), bindingReceiptDigest: requiredDigest(value.bindingReceiptDigest, "marker binding receipt"), localProjectionDigest: requiredDigest(value.localProjectionDigest, "marker local projection digest"), finalReceiptDigest: requiredDigest(value.finalReceiptDigest, "marker final receipt"), }); }
function requireLease(value) {
  if (!value || value.schema !== "agentic-writer-lease/v2"
    || value.admission?.schema !== "agentic-lane-admission-lease/v1"
    || value.admission.status !== "admitted") throw new Error("Source writer lease is invalid.");
  return value; }
function requireReviewAuthority(value) {
  if (!value || value.schema !== "agentic-lane-cloud-authority/v1"
    || !value.reviewRequestId || !value.focusedEvidenceDigest) throw new Error("Source review authority is invalid.");
  return value; }
function requireLiveClaim(value) {
  if (!value || value.state === "dormant-preserved" || value.state === "parked") {
    throw new Error("Dormant reviewed authority requires protected same-owner reclaim before revision recovery.");
  }
  return value; }
export function reviewedCiRevisionOperationKey(plan, operation) {
  const normalized = normalizeReviewedCiRevisionPlan(plan), allowed = new Set([...Object.values(PHASE_OPERATIONS), "abort-derivative"]);
  if (!allowed.has(operation)) throw new Error("Reviewed CI revision operation is invalid.");
  return `reviewed-ci-revision:${normalized.planDigest}:${operation}`; }
export function reviewedCiRevisionProviderBoundaryDigest(plan) {
  const normalized = normalizeReviewedCiRevisionPlan(plan);
  return digestValue({ sourceLeaseDigest: normalized.sourceLeaseDigest, worktreeIdentityDigest: normalized.sourceWorktreeIdentityDigest, headSha: normalized.sourceHeadSha, failureEvidenceDigest: normalized.failureEvidenceDigest, protectedMainAdvanceDigest: normalized.protectedMainAdvanceDigest }); }
export function reviewedCiRevisionSourceProjectionBodyDigest(plan) {
  const normalized = normalizeReviewedCiRevisionPlan(plan);
  return digestValue(upsertReviewedCiRevisionMarker(
    normalized.pullRequestBody, createReviewedCiRevisionIntentMarker(normalized))); }
function normalizePhaseValues(phase, plan, value) {
  const input = boundedSnapshot(value, `${phase} values`) || {};
  const operationKey = exact(input.operationKey, reviewedCiRevisionOperationKey(plan, PHASE_OPERATIONS[phase]), `${phase} operation`);
  let core;
  if (phase === "source-marker") core = { operationKey, pullRequestNodeId: exact(input.pullRequestNodeId, plan.pullRequestNodeId, "source marker PR"), markerDigest: exact(input.markerDigest, digestValue(createReviewedCiRevisionIntentMarker(plan)), "source marker"), writerMarkerDigest: exact(input.writerMarkerDigest, plan.sourceWriterMarkerDigest, "source writer marker"), bodyDigest: exact(input.bodyDigest, reviewedCiRevisionSourceProjectionBodyDigest(plan), "source body digest") };
  else if (phase === "successor-waiting") core = { operationKey, ...normalizeClaimValues(input, plan, "waiting-successor") };
  else if (phase === "source-retired") core = { operationKey, sourceClaimId: exact(input.sourceClaimId, plan.sourceClaimId, "retired source"), successorClaimId: requiredDigest(input.successorClaimId, "retirement successor"), receiptDigest: requiredDigest(input.receiptDigest, "retirement receipt"), operationReceiptDigest: requiredDigest(input.operationReceiptDigest, "retirement operation receipt"), ledgerDigest: requiredDigest(input.ledgerDigest, "retirement ledger"), state: exact(input.state, "retired", "retirement state") };
  else if (phase === "source-pr-closed") core = normalizeClosureValues(operationKey, input, plan);
  else if (phase === "replacement-pr-created") core = normalizeReplacementValues(operationKey, input, plan);
  else if (phase === "successor-promoted") core = { operationKey, ...normalizeClaimValues(input, plan, "current"), authority: normalizeRecoveryAuthority(input.authority, plan, false), authorityDigest: requiredDigest(input.authorityDigest, "promotion authority") };
  else if (phase === "successor-bound") core = normalizeBindingValues(operationKey, input, plan);
  else if (phase === "local-active") core = normalizeLocalValues(operationKey, input, plan);
  else if (phase === "remote-active") core = normalizeRemoteValues(operationKey, input, plan);
  else throw new Error("Phase values are invalid.");
  return exactShape(input, core, `${phase} values`); }
function normalizeClaimValues(value, plan, state) {
  return { claimId: requiredDigest(value.claimId, "successor claim"), claimDigest: requiredDigest(value.claimDigest, "successor fence"), transitionCounter: positiveInteger(value.transitionCounter, "successor counter"), operationReceiptDigest: requiredDigest(value.operationReceiptDigest, "successor operation receipt"), requestDigest: requiredDigest(value.requestDigest, "successor request"), receiptDigest: requiredDigest(value.receiptDigest, "successor receipt"), ledgerDigest: requiredDigest(value.ledgerDigest, "successor ledger"), state: exact(value.state, state, "successor state"), canonicalBaseSha: exact(value.canonicalBaseSha, plan.successorCanonicalBaseSha, "successor base"), laneRevision: exact(value.laneRevision, plan.sourceHeadSha, "successor revision"), leaseEpoch: exact(value.leaseEpoch, plan.successorCloudLeaseEpoch, "successor cloud epoch") }; }
function normalizeClosureValues(operationKey, value, plan) {
  const disposition = ["recovery-projection", "original-reviewed"].includes(value.bodyDisposition) ? value.bodyDisposition : invalidPlan("source body disposition");
  const provider = ["closed", "reconciled-response-loss", "adopted-existing"].includes(value.providerDisposition)
    ? value.providerDisposition : invalidPlan("source close disposition");
  return { operationKey, pullRequestNumber: exact(value.pullRequestNumber, plan.pullRequestNumber, "closed PR number"), pullRequestNodeId: exact(value.pullRequestNodeId, plan.pullRequestNodeId, "closed PR node"), url: exact(value.url, plan.pullRequestUrl, "closed PR URL"), state: exact(value.state, "CLOSED", "closed PR state"), closedAt: requiredInstant(value.closedAt, "source close time"), mergedAt: value.mergedAt === null ? null : invalidPlan("source merged state"), headSha: exact(value.headSha, plan.sourceHeadSha, "closed PR head"), baseSha: exact(value.baseSha, plan.successorCanonicalBaseSha, "closed PR base"), bodyDigest: requiredDigest(value.bodyDigest, "closed body"), bodyDisposition: disposition, providerDisposition: provider, providerBoundaryDigest: exact(value.providerBoundaryDigest, reviewedCiRevisionProviderBoundaryDigest(plan), "close boundary") }; }
function normalizeReplacementValues(operationKey, value, plan) {
  const bootstrap = createReviewedCiRevisionPullRequestBootstrap(plan), number = positiveInteger(value.pullRequestNumber, "replacement PR number");
  const node = requiredText(value.pullRequestNodeId, "replacement PR node"), url = `https://github.com/${plan.repository}/pull/${number}`;
  const disposition = ["created", "reconciled-response-loss", "adopted-existing"].includes(value.providerDisposition)
    ? value.providerDisposition : invalidPlan("replacement disposition");
  return { operationKey, pullRequestNumber: number, pullRequestNodeId: node, url: exact(value.url, url, "replacement PR URL"), state: exact(value.state, "OPEN", "replacement state"), isDraft: exact(value.isDraft, true, "replacement draft"), title: exact(value.title, bootstrap.title, "replacement title"), bodyDigest: exact(value.bodyDigest, bootstrap.bodyDigest, "replacement body"), providerDisposition: disposition, providerBoundaryDigest: exact(value.providerBoundaryDigest, reviewedCiRevisionProviderBoundaryDigest(plan), "replacement boundary"), headSha: exact(value.headSha, plan.sourceHeadSha, "replacement head"), baseSha: exact(value.baseSha, plan.observedProtectedMainSha, "replacement base"), authorLogin: exact(value.authorLogin, plan.pullRequestAuthorLogin, "replacement author") }; }
function normalizeRecoveryAuthority(value, plan, bound) {
  const authority = boundedSnapshot(value, "successor authority");
  const review = bound ? requiredText(authority?.reviewRequestId, "bound review") : authority?.reviewRequestId;
  if (authority?.schema !== "agentic-lane-cloud-authority/v1" || authority.claimId === plan.sourceClaimId
    || authority.canonicalBaseSha !== plan.successorCanonicalBaseSha || authority.laneRevision !== plan.sourceHeadSha
    || authority.writeSetDigest !== plan.writeSetDigest || authority.deviceId !== plan.sourceDeviceId
    || authority.sessionId !== plan.sourceSessionId || authority.state !== "active"
    || (!bound && review !== null) || (bound && review === plan.sourceReviewRequestId)
    || authority.focusedEvidenceDigest !== null) {
    throw new Error("Successor authority is not the exact recovery authority.");
  }
  return authority; }
function normalizeBindingValues(operationKey, value, plan) {
  const authority = normalizeRecoveryAuthority(value.authority, plan, true);
  if (value.receiptDigest !== value.operationReceiptDigest) throw new Error("Binding receipt differs from its operation receipt.");
  return { operationKey, authority, authorityDigest: requiredDigest(value.authorityDigest, "bound authority"), claimId: requiredDigest(value.claimId, "bound claim"), claimDigest: requiredDigest(value.claimDigest, "bound fence"), transitionCounter: positiveInteger(value.transitionCounter, "bound counter"), operationReceiptDigest: requiredDigest(value.operationReceiptDigest, "bind operation receipt"), receiptDigest: requiredDigest(value.receiptDigest, "bind receipt"), verificationReceiptDigest: requiredDigest(value.verificationReceiptDigest, "bind verification"), verifiedAt: requiredInstant(value.verifiedAt, "bind verification time") }; }
function normalizeLocalValues(operationKey, value, plan) {
  const epoch = positiveInteger(value.epoch, "terminal local epoch");
  if (epoch <= plan.sourceLocalEpoch) throw new Error("Terminal local epoch must exceed every source epoch.");
  return { operationKey, status: exact(value.status, "active", "local status"), epoch, fenceSha: exact(value.fenceSha, plan.sourceHeadSha, "local fence"), pullRequestUrl: requiredText(value.pullRequestUrl, "local PR URL"), authorityDigest: requiredDigest(value.authorityDigest, "local authority"), leaseDigest: requiredDigest(value.leaseDigest, "local lease"), writerMarkerDigest: requiredDigest(value.writerMarkerDigest, "local writer marker"), terminalVerification: normalizeReviewedCiTerminalVerification(value.terminalVerification), expiresAt: requiredInstant(value.expiresAt, "local expiry") }; }
function normalizeRemoteValues(operationKey, value, plan) {
  const local = normalizePhaseSnapshot(value.localProjection, "local-active", plan), activeLease = boundedSnapshot(value.activeLease, "terminal active lease");
  const finalReceipt = normalizeFinalReceipt(value.finalReceipt, plan), writerMarker = boundedSnapshot(value.writerMarker, "remote writer marker");
  const recoveryMarker = normalizeMarker(value.recoveryMarker), node = requiredText(value.pullRequestNodeId, "remote PR node");
  const proof = remoteProofDigest(plan, node, local);
  const body = upsertReviewedCiRevisionMarker(updateWriterLeasePullRequestBody(
    createReviewedCiRevisionPullRequestBootstrap(plan).body, activeLease), recoveryMarker);
  if (value.remoteProofDigest !== proof || finalReceipt.values.remoteProjectionProofDigest !== proof
    || activeLease?.schema !== "agentic-writer-lease/v2" || digestValue(activeLease) !== local.values.leaseDigest
    || value.bodyDigest !== digestValue(body) || digestValue(writerMarker) !== local.values.writerMarkerDigest
    || recoveryMarker.finalReceiptDigest !== finalReceipt.receiptDigest) {
    throw new Error("Remote terminal projection is not reconstructible.");
  }
  return { operationKey, pullRequestNodeId: node, bodyDigest: value.bodyDigest, remoteProofDigest: proof, writerMarker, recoveryMarker, localProjection: local, activeLease, finalReceipt }; }
function normalizeFinalReceipt(value, plan) {
  if (value?.schema !== REVIEWED_CI_REVISION_RECEIPT_SCHEMA || value.phase !== "complete" || value.planDigest !== plan.planDigest
    || value.sourceClaimId !== plan.sourceClaimId || value.sourceHeadSha !== plan.sourceHeadSha
    || value.failureEvidenceDigest !== plan.failureEvidenceDigest) throw new Error("Final receipt identity drifted.");
  const fields = ["successorClaimId", "successorAuthorityDigest", "sourceRetirementReceiptDigest", "sourcePullRequestClosureDigest", "replacementPullRequestDigest", "promotionReceiptDigest", "bindingReceiptDigest", "terminalVerificationDigest", "remoteProjectionProofDigest", "localProjectionDigest"];
  const values = exactShape(value.values, Object.fromEntries(fields.map(key => [key, requiredDigest(value.values?.[key], `final ${key}`)])), "final receipt values");
  const core = { schema: value.schema, phase: value.phase, planDigest: plan.planDigest, sourceClaimId: plan.sourceClaimId, sourceHeadSha: plan.sourceHeadSha, failureEvidenceDigest: plan.failureEvidenceDigest, values };
  if (value.receiptDigest !== digestValue(core)) throw new Error("Final receipt digest drifted.");
  return deepFreeze({ ...core, receiptDigest: value.receiptDigest }); }
function remoteProofDigest(plan, node, local) { return digestValue({ schema: "agentic-reviewed-ci-revision-remote-proof/v1", planDigest: plan.planDigest, pullRequestNodeId: node, localProjectionDigest: local.snapshotDigest, epoch: local.values.epoch, authorityDigest: local.values.authorityDigest, writerMarkerDigest: local.values.writerMarkerDigest, terminalVerificationDigest: local.values.terminalVerification.verificationDigest }); }
export function normalizeReviewedCiTerminalVerification(value) {
  const core = { schema: "agentic-reviewed-ci-revision-terminal-verification/v1", authorityDigest: requiredDigest(value?.authorityDigest, "terminal verification authority"), receiptDigest: requiredDigest(value?.receiptDigest, "terminal verification receipt"), verifiedAt: requiredInstant(value?.verifiedAt, "terminal verification time"), expiresAt: requiredInstant(value?.expiresAt, "terminal verification expiry") };
  if (value?.schema !== core.schema || value.verificationDigest !== digestValue(core)) throw new Error("Terminal authority verification drifted.");
  return exactShape(value, { ...core, verificationDigest: value.verificationDigest }, "terminal verification"); }
export function buildReviewedCiTerminalVerification(value) {
  const core = { schema: "agentic-reviewed-ci-revision-terminal-verification/v1", authorityDigest: requiredDigest(value?.authorityDigest, "terminal verification authority"), receiptDigest: requiredDigest(value?.receiptDigest, "terminal verification receipt"), verifiedAt: requiredInstant(value?.verifiedAt, "terminal verification time"), expiresAt: requiredInstant(value?.expiresAt, "terminal verification expiry") };
  return normalizeReviewedCiTerminalVerification({ ...core, verificationDigest: digestValue(core) }); }
function exactShape(input, core, label) {
  if (JSON.stringify(Object.keys(input || {}).sort()) !== JSON.stringify(Object.keys(core).sort())) throw new Error(`${label} has arbitrary or missing fields.`);
  return deepFreeze(core); }
function exact(value, expected, label) { if (value !== expected) throw new Error(`${label} drifted.`); return value; }
function assertIntentSemantics(plan, intent) {
  const successor = intent.successor?.values, retirement = intent.sourceRetirement?.values;
  const promotion = intent.promotion?.values, replacement = intent.replacementPullRequest?.values;
  const binding = intent.binding?.values, remote = intent.pullRequestProjection?.values;
  const candidate = intent.pullRequestProjectionCandidate?.values;
  if (retirement && retirement.successorClaimId !== successor?.claimId) throw new Error("Retirement lost successor lineage.");
  if (intent.sourcePullRequestClosure) { const closed = intent.sourcePullRequestClosure.values;
    const expectedBody = closed.bodyDisposition === "original-reviewed" ? plan.pullRequestBodyDigest : intent.sourceProjection?.values.bodyDigest;
    if (closed.bodyDigest !== expectedBody) throw new Error("Closed source body proof drifted."); }
  if (replacement && (replacement.pullRequestNumber === plan.pullRequestNumber || replacement.pullRequestNodeId === plan.pullRequestNodeId)) {
    throw new Error("Replacement pull request reused the failed source identity."); }
  if (promotion && (promotion.claimId !== successor?.claimId || promotion.transitionCounter !== successor.transitionCounter + 1
    || promotion.authorityDigest !== digestValue(promotion.authority) || promotion.authority.claimId !== promotion.claimId
    || promotion.authority.claimDigest !== promotion.claimDigest || promotion.authority.transitionCounter !== promotion.transitionCounter
    || promotion.authority.operationReceiptDigest !== promotion.operationReceiptDigest)) throw new Error("Promotion lineage drifted.");
  if (binding) { const review = `github-pull-request:${replacement?.pullRequestNodeId}`;
    if (binding.claimId !== promotion?.claimId || binding.transitionCounter !== promotion.transitionCounter + 1
      || binding.authorityDigest !== digestValue(binding.authority) || binding.authority.claimId !== binding.claimId
      || binding.authority.claimDigest !== binding.claimDigest || binding.authority.transitionCounter !== binding.transitionCounter
      || binding.authority.operationReceiptDigest !== binding.operationReceiptDigest || binding.authority.reviewRequestId !== review) {
      throw new Error("Bound successor lineage drifted."); } }
  for (const projection of [candidate, remote].filter(Boolean)) { const local = projection.localProjection, marker = projection.recoveryMarker;
    const expectedFinal = buildReviewedCiRevisionFinalReceipt(plan, intent, local);
    const verification = local.values.terminalVerification;
    if (projection.pullRequestNodeId !== replacement?.pullRequestNodeId || local.values.pullRequestUrl !== replacement.url
      || local.values.authorityDigest !== binding?.authorityDigest || verification.authorityDigest !== binding.authorityDigest
      || verification.expiresAt !== binding.authority.expiresAt
      || Date.parse(verification.expiresAt) - Date.parse(verification.verifiedAt) < plan.minimumMarginSeconds * 1_000
      || projection.finalReceipt.receiptDigest !== expectedFinal.receiptDigest
      || marker.planDigest !== plan.planDigest || marker.successorClaimId !== promotion.claimId
      || marker.successorClaimDigest !== promotion.claimDigest || marker.successorTransitionCounter !== promotion.transitionCounter
      || marker.sourceRetirementReceiptDigest !== retirement.receiptDigest || marker.promotionReceiptDigest !== promotion.receiptDigest
      || marker.bindingReceiptDigest !== binding.receiptDigest || marker.localProjectionDigest !== local.snapshotDigest) {
      throw new Error("Remote projection lineage drifted."); } }
  if (intent.localProjection && (intent.localProjection.snapshotDigest !== remote?.localProjection.snapshotDigest
    || intent.pullRequestProjectionCandidate?.snapshotDigest !== intent.pullRequestProjection?.snapshotDigest
    || intent.finalReceiptDigest !== remote.finalReceipt.receiptDigest)) throw new Error("Local terminal proof drifted.");
  if (intent.abortCleanup) { const cleanup = intent.abortCleanup;
    if (reviewedCiRevisionPhaseOrder(intent.status) >= reviewedCiRevisionPhaseOrder("source-retired")
      || (successor && cleanup.evidence.derivative?.claimId !== successor.claimId)) throw new Error("Abort cleanup lineage drifted."); } }
export function normalizeReviewedCiDeliveryEvidence(plan, intent, value) {
  const normalized = normalizeReviewedCiRevisionPlan(plan);
  if (!value || value.schema !== "agentic-reviewed-ci-revision-delivery-won/v1") throw new Error("Delivery-won evidence is malformed.");
  const derivative = normalizeDeliveryDerivative(normalized, intent, value.derivative ?? null);
  const core = { schema: value.schema, sourceClaimId: exact(value.sourceClaimId, normalized.sourceClaimId, "delivery source claim"), sourceState: exact(value.sourceState, "integrated-preserved", "delivery source state"), sourcePullRequestNodeId: exact(value.sourcePullRequestNodeId, normalized.pullRequestNodeId, "delivery source PR"), sourcePullRequestState: exact(value.sourcePullRequestState, "OPEN", "delivery source PR state"), sourceMergedAt: value.sourceMergedAt === null ? null : invalidPlan("delivery source merged state"), deliveryReceiptDigest: requiredDigest(value.deliveryReceiptDigest, "delivery receipt"), derivative };
  if (value.evidenceDigest !== digestValue(core)) throw new Error("Delivery-won evidence digest drifted.");
  return deepFreeze({ ...core, evidenceDigest: value.evidenceDigest }); }
function normalizeDeliveryDerivative(plan, intent, value) {
  if (value === null && intent?.successor) throw new Error("Delivery cleanup lost its durable derivative.");
  if (value === null) return null;
  const pairs = [["predecessorClaimId", "sourceClaimId"], ["actorId", "sourceActorId"], ["repositoryId", "sourceRepositoryId"], ["workItemId", "sourceWorkItemId"], ["deviceId", "sourceDeviceId"], ["sessionId", "sourceSessionId"], ["canonicalBaseSha", "successorCanonicalBaseSha"], ["laneRevision", "sourceHeadSha"], ["writeSetDigest", "writeSetDigest"]];
  const core = { claimId: requiredDigest(value.claimId, "derivative claim"), claimDigest: requiredDigest(value.claimDigest, "derivative fence"), transitionCounter: positiveInteger(value.transitionCounter, "derivative counter"), operationReceiptDigest: requiredDigest(value.operationReceiptDigest, "derivative operation receipt"), state: ["waiting-successor", "current"].includes(value.state) ? value.state : invalidPlan("derivative state"), ...Object.fromEntries(pairs.map(([key, planKey]) => [key, exact(value[key], plan[planKey], `derivative ${key}`)])), leaseEpoch: exact(value.leaseEpoch, plan.successorCloudLeaseEpoch, "derivative epoch") };
  if (intent?.successor && core.claimId !== intent.successor.values.claimId) throw new Error("Delivery derivative differs from durable successor.");
  return exactShape(value, core, "delivery derivative"); }
export function createReviewedCiRevisionAbortCleanup(plan, intent, evidence) {
  const normalized = normalizeReviewedCiRevisionPlan(plan), proof = normalizeReviewedCiDeliveryEvidence(normalized, intent, evidence);
  const core = { schema: "agentic-reviewed-ci-revision-abort-cleanup/v1", status: "prepared", planDigest: normalized.planDigest, operationKey: reviewedCiRevisionOperationKey(normalized, "abort-derivative"), evidence: proof, evidenceDigest: proof.evidenceDigest };
  return deepFreeze({ ...core, cleanupIntentDigest: digestValue(core) }); }
function normalizeAbortCleanup(value, plan) {
  if (value === null || value === undefined) return null;
  const evidence = normalizeReviewedCiDeliveryEvidence(plan, null, value.evidence), core = {
    schema: "agentic-reviewed-ci-revision-abort-cleanup/v1", status: "prepared", planDigest: plan.planDigest, operationKey: reviewedCiRevisionOperationKey(plan, "abort-derivative"), evidence, evidenceDigest: evidence.evidenceDigest };
  if (value.schema !== core.schema || value.status !== core.status || value.planDigest !== core.planDigest
    || value.operationKey !== core.operationKey || value.evidenceDigest !== core.evidenceDigest
    || value.cleanupIntentDigest !== digestValue(core)) throw new Error("Prepared abort cleanup drifted.");
  return deepFreeze({ ...core, cleanupIntentDigest: value.cleanupIntentDigest }); }
export function buildReviewedCiRevisionArchiveRecord({ plan, intent, status, result } = {}) {
  const normalized = normalizeReviewedCiRevisionPlan(plan), journal = normalizeReviewedCiRevisionIntent(intent);
  const recovered = status === "recovered", aborted = status === "aborted-delivery-won";
  if (!recovered && !aborted) throw new Error("Recovery archive status is invalid.");
  const receiptDigests = recovered && Array.isArray(result?.receipts)
    ? result.receipts.map(receipt => requiredDigest(receipt?.receiptDigest, "archive phase receipt")) : null;
  const core = { schema: "agentic-reviewed-ci-revision-archive/v1", status, intentSnapshot: journal, repository: normalized.repository, branch: normalized.sourceBranch, planDigest: normalized.planDigest, sourceClaimId: normalized.sourceClaimId, sourceLeaseDigest: normalized.sourceLeaseDigest, pullRequestNumber: normalized.pullRequestNumber, checkRunId: normalized.failureEvidence.checkRunId, authorizationDigest: journal.authorization.authorizationDigest, terminalLeaseDigest: recovered ? journal.localProjection?.values.leaseDigest : normalized.sourceLeaseDigest, successorClaimId: recovered ? journal.binding?.values.claimId : null, replacementPullRequestUrl: recovered ? journal.replacementPullRequest?.values.url : null, finalReceiptDigest: recovered ? requiredDigest(result?.finalReceiptDigest, "archive final receipt") : null, receiptDigests, deliveryReceiptDigest: aborted ? requiredDigest(result?.deliveryReceiptDigest, "archive delivery receipt") : null, cleanupReceiptDigest: aborted ? requiredDigest(result?.cleanupReceiptDigest, "archive cleanup receipt") : null, abortReceiptDigest: aborted ? requiredDigest(result?.abortReceiptDigest, "archive abort receipt") : null };
  if ((recovered && (journal.status !== "local-active" || core.finalReceiptDigest !== journal.finalReceiptDigest))
    || (recovered && JSON.stringify(receiptDigests) !== JSON.stringify(successReceiptDigests(normalized, journal)))
    || (aborted && !journal.abortCleanup)) throw new Error("Recovery archive is not reconstructible from its journal.");
  return deepFreeze({ ...core, archiveReceiptDigest: digestValue(core) }); }
export function normalizeReviewedCiRevisionArchiveRecord(value) {
  if (!value || value.schema !== "agentic-reviewed-ci-revision-archive/v1"
    || !["recovered", "aborted-delivery-won"].includes(value.status)) throw new Error("Recovery archive is malformed.");
  const recovered = value.status === "recovered", journal = normalizeReviewedCiRevisionIntent(value.intentSnapshot);
  const plan = journal.planSnapshot;
  const receiptDigests = recovered && Array.isArray(value.receiptDigests)
    ? value.receiptDigests.map(digest => requiredDigest(digest, "archive phase receipt"))
    : exact(value.receiptDigests, null, "archive phase receipts");
  const core = { schema: value.schema, status: value.status, intentSnapshot: journal, repository: exact(value.repository, plan.repository, "archive repository"), branch: exact(value.branch, plan.sourceBranch, "archive branch"), planDigest: exact(value.planDigest, plan.planDigest, "archive plan"), sourceClaimId: exact(value.sourceClaimId, plan.sourceClaimId, "archive source claim"), sourceLeaseDigest: exact(value.sourceLeaseDigest, plan.sourceLeaseDigest, "archive source lease"), pullRequestNumber: exact(value.pullRequestNumber, plan.pullRequestNumber, "archive PR"), checkRunId: exact(value.checkRunId, plan.failureEvidence.checkRunId, "archive check"), authorizationDigest: exact(value.authorizationDigest, journal.authorization.authorizationDigest, "archive authorization"), terminalLeaseDigest: recovered ? exact(value.terminalLeaseDigest, journal.localProjection?.values.leaseDigest, "archive terminal lease") : exact(value.terminalLeaseDigest, plan.sourceLeaseDigest, "archive terminal lease"), successorClaimId: recovered ? exact(value.successorClaimId, journal.binding?.values.claimId, "archive successor") : exact(value.successorClaimId, null, "archive successor"), replacementPullRequestUrl: recovered ? exact(value.replacementPullRequestUrl, journal.replacementPullRequest?.values.url, "archive replacement PR") : exact(value.replacementPullRequestUrl, null, "archive replacement PR"), finalReceiptDigest: recovered ? exact(value.finalReceiptDigest, journal.finalReceiptDigest, "archive final receipt") : exact(value.finalReceiptDigest, null, "archive final receipt"), receiptDigests, deliveryReceiptDigest: recovered ? exact(value.deliveryReceiptDigest, null, "archive delivery") : exact(value.deliveryReceiptDigest, journal.abortCleanup?.evidence.deliveryReceiptDigest, "archive delivery"), cleanupReceiptDigest: recovered ? exact(value.cleanupReceiptDigest, null, "archive cleanup") : requiredDigest(value.cleanupReceiptDigest, "archive cleanup"), abortReceiptDigest: recovered ? exact(value.abortReceiptDigest, null, "archive abort") : requiredDigest(value.abortReceiptDigest, "archive abort") };
  if ((recovered && (journal.status !== "local-active"
      || JSON.stringify(receiptDigests) !== JSON.stringify(successReceiptDigests(plan, journal))))
    || (!recovered && !journal.abortCleanup)) {
    throw new Error("Recovery archive phase receipts drifted from its final proof.");
  }
  if (value.archiveReceiptDigest !== digestValue(core)) throw new Error("Recovery archive digest drifted.");
  return exactShape(value, { ...core, archiveReceiptDigest: value.archiveReceiptDigest }, "recovery archive"); }
function successReceiptDigests(plan, intent) {
  const fields = [["preflight", null], ["source-marker", "sourceProjection"], ["successor-waiting", "successor"], ["source-retired", "sourceRetirement"], ["source-pr-closed", "sourcePullRequestClosure"], ["replacement-pr-created", "replacementPullRequest"], ["successor-promoted", "promotion"], ["successor-bound", "binding"], ["remote-active", "pullRequestProjection"], ["local-active", "localProjection"]];
  return [...fields.map(([phase, field]) => buildReviewedCiRevisionReceipt({ phase, plan, values: field ? intent[field].values : {} }).receiptDigest), intent.finalReceiptDigest]; }
function boundedSnapshot(value, label) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const serialized = JSON.stringify(value);
  if (serialized.length > 65_536) throw new Error(`${label} exceeds its bound.`);
  return deepFreeze(JSON.parse(serialized)); }
function boundedBody(value) {
  const body = String(value ?? "");
  if (body.length > 65_536) throw new Error("Pull-request body exceeds its bound.");
  return body; }
function normalizeAuthorizationReceipt(value, plan) {
  if (!value || value.schema !== "agentic-reviewed-ci-revision-recovery-authorization/v1") {
    throw new Error("Reviewed CI revision authorization receipt is missing.");
  }
  const receipt = {
    schema: value.schema, planDigest: requiredDigest(value.planDigest, "authorization plan digest"), authorizationDigest: requiredDigest(value.authorizationDigest, "authorization digest"), };
  if (receipt.planDigest !== plan.planDigest
    || receipt.authorizationDigest !== digestValue({
      authorization: `authorize reviewed-ci-revision-recovery ${plan.planDigest}`, planDigest: plan.planDigest, })) {
    throw new Error("Reviewed CI revision authorization receipt drifted.");
  }
  return deepFreeze(receipt); }
function normalizePhaseSnapshot(value, phase, plan) {
  if (value === null || value === undefined) return null;
  if (value.schema !== "agentic-reviewed-ci-revision-phase-snapshot/v1"
    || value.phase !== phase || value.planDigest !== plan.planDigest) {
    throw new Error(`${phase} snapshot identity drifted.`);
  }
  const core = {
    schema: value.schema, phase, planDigest: plan.planDigest, values: normalizePhaseValues(phase, plan, value.values), };
  if (value.snapshotDigest !== digestValue(core)) {
    throw new Error(`${phase} snapshot digest drifted.`);
  }
  return deepFreeze({ ...core, snapshotDigest: value.snapshotDigest }); }
function normalizeProtectedMainAdvance(value, canonicalBaseSha, observedMainSha) {
  if (!value || value.schema !== "agentic-reviewed-ci-protected-main-advance/v1"
    || !Array.isArray(value.ancestryPath)) throw new Error("Protected-main advance receipt is malformed.");
  const core = { schema: value.schema, canonicalBaseSha: requiredSha(canonicalBaseSha, "protected-main canonical base"), observedMainSha: requiredSha(observedMainSha, "protected-main observed head"), ancestryPath: value.ancestryPath.map((sha, index) => requiredSha(sha, `protected-main ancestry ${index}`)) };
  const path = core.ancestryPath;
  if (path.length > 32 || new Set(path).size !== path.length || path.includes(core.canonicalBaseSha)
    || (core.canonicalBaseSha === core.observedMainSha ? path.length !== 0 : path.at(-1) !== core.observedMainSha)
    || value.receiptDigest !== digestValue(core)) throw new Error("Protected-main advance receipt drifted.");
  return deepFreeze({ ...core, receiptDigest: value.receiptDigest }); }
function boundedTtl(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 300 || number > 86_400) throw new Error("TTL must be 300..86400 seconds.");
  return number; }
function boundedMargin(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 120 || number > 3_600) throw new Error("Source margin must be 120..3600 seconds.");
  return number; }
function positiveInteger(value, label) {
  const number = Number(value); if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${label} must be positive.`); return number; }
function requiredText(value, label) {
  const text = String(value || "").normalize("NFC").trim();
  if (!text || text.length > 2_048) throw new Error(`${label} is invalid.`);
  return text; }
function invalidPlan(label) { throw new Error(`Reviewed CI revision ${label} is invalid.`); }
function requiredSha(value, label) {
  const text = String(value || "");
  if (!SHA_PATTERN.test(text)) throw new Error(`${label} must be a SHA.`);
  return text; }
function requiredDigest(value, label) {
  const text = String(value || ""); if (!DIGEST_PATTERN.test(text)) throw new Error(`${label} must be a SHA-256 digest.`); return text; }
function requiredInstant(value, label) {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) throw new Error(`${label} is invalid.`);
  return value; }
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"); }
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value; }
