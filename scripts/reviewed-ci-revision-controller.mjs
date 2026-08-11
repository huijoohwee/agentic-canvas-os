import { renameSync, writeFileSync } from "node:fs";
import { advanceReviewedCiRevisionIntent, assertReviewedCiMarkerCardinality, authorizeReviewedCiRevision, buildReviewedCiRevisionArchiveRecord, buildReviewedCiRevisionFinalReceipt, buildReviewedCiRevisionPhaseSnapshot, buildReviewedCiRevisionPlan, buildReviewedCiRevisionReceipt, createReviewedCiRevisionAbortCleanup, createReviewedCiRevisionIntent, createReviewedCiRevisionIntentMarker, createReviewedCiRevisionMarker, createReviewedCiRevisionPullRequestBootstrap, normalizeReviewedCiDeliveryEvidence, normalizeReviewedCiRevisionArchiveRecord, normalizeReviewedCiRevisionIntent, normalizeReviewedCiTerminalVerification, parseReviewedCiRevisionMarker, projectReviewedCiActiveLease, reviewedCiRevisionPhaseOrder, reviewedCiRevisionOperationKey, upsertReviewedCiRevisionMarker } from "./reviewed-ci-revision-contract.mjs";
import { digestValue, writeSetsOverlap } from "./cloud-collaboration-primitives.mjs";
import { buildReviewedCiFailureEvidence } from "./reviewed-ci-revision-evidence.mjs";
import { parseWriterLeasePullRequestBody, projectWriterLeasePullRequestMarker, updateWriterLeasePullRequestBody } from "./writer-lease-lib.mjs";
import { writerLeaseDigest } from "./writer-lease-registry-cas.mjs";
const PHASES = Object.freeze([
  "intent", "source-marker", "successor-waiting", "source-retired", "source-pr-closed", "replacement-pr-created", "successor-promoted", "successor-bound", "remote-active", "local-active",
]);
const TRANSITIONS = Object.freeze([
  ["source-marker", "projectRecoveryIntent", "sourceProjection", "intent-marker"], ["successor-waiting", "claimSuccessor", "successor", "claim"], ["source-retired", "retireSource", "sourceRetirement", "retire-source"], ["source-pr-closed", "closeSourcePullRequest", "sourcePullRequestClosure", "close-source-pr"], ["replacement-pr-created", "createRevisionPullRequest", "replacementPullRequest", "create-replacement-pr"], ["successor-promoted", "promoteSuccessor", "promotion", "promote-successor"], ["successor-bound", "bindSuccessor", "binding", "bind-successor"], ["remote-active", "projectPullRequest", "pullRequestProjection", "active-pr-marker"],
]);
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_EPOCH_REPROJECTIONS = 3;
const MAX_TERMINAL_VERIFICATION_AGE_MILLISECONDS = 30_000;
export { reviewedCiRevisionOperationKey };
export const REVIEWED_CI_REVISION_EPOCH_DRIFT = "REVIEWED_CI_REVISION_EPOCH_DRIFT";
export class ReviewedCiRevisionEpochDriftError extends Error {
  constructor(message = "Writer epoch changed before terminal recovery CAS; unique global-epoch projection required.") {
    super(message);
    this.name = "ReviewedCiRevisionEpochDriftError";
    this.code = REVIEWED_CI_REVISION_EPOCH_DRIFT;
  }
}
export function createReviewedCiRevisionControllerAdapter(methods = {}) {
  const required = [
    "assertExecutionFence", "readState", "beginIntent", "advanceIntent", "reconcilePhase", "reconcileTransition", "projectRecoveryIntent", "claimSuccessor", "retireSource", "closeSourcePullRequest", "createRevisionPullRequest", "promoteSuccessor", "bindSuccessor", "projectPullRequest", "activateLocal", "abortDeliveryWon", "finalize", ];
  const adapter = Object.freeze({ ...Object.fromEntries(required.map(name => [name, methods[name]])), archiveRecovery: methods.archiveRecovery, preparePullRequestProjection: methods.preparePullRequestProjection });
  for (const name of required) if (typeof adapter[name] !== "function") throw new Error(
    `Reviewed CI revision adapter requires ${name}().`);
  return adapter;
}
export async function planReviewedCiRevisionRecovery({}, { adapter } = {}) {
  requireAdapter(adapter);
  const state = await adapter.readState();
  if (state.archive) return normalizeReviewedCiRevisionArchiveRecord(state.archive).intentSnapshot.planSnapshot;
  if (state.intent) return normalizeReviewedCiRevisionIntent(state.intent).planSnapshot;
  return buildReviewedCiRevisionPlan({ source: state.source, ttlSeconds: state.ttlSeconds });
}
export async function runReviewedCiRevisionRecovery({ authorization } = {}, { adapter } = {}) {
  requireAdapter(adapter);
  await adapter.assertExecutionFence();
  const state = await adapter.readState();
  if (state.archive) return replayReviewedCiRevisionArchive(state.archive, authorization);
  if (typeof adapter.archiveRecovery !== "function"
    || typeof adapter.preparePullRequestProjection !== "function") throw new Error(
    "Reviewed CI revision adapter requires archiveRecovery() and preparePullRequestProjection() before mutation.");
  let intent = state.intent ? normalizeReviewedCiRevisionIntent(state.intent) : null;
  const plan = intent?.planSnapshot
    || buildReviewedCiRevisionPlan({ source: state.source, ttlSeconds: state.ttlSeconds });
  const authorizationReceipt = authorizeReviewedCiRevision({ plan, authorization });
  if (intent && intent.authorization.authorizationDigest !== authorizationReceipt.authorizationDigest) {
    throw new Error("Stored recovery replay authorization drifted.");
  }
  const receipts = [buildReviewedCiRevisionReceipt({ phase: "preflight", plan })];
  if (!intent) {
    intent = normalizeReviewedCiRevisionIntent(await adapter.beginIntent({
      plan, intent: createReviewedCiRevisionIntent(plan, authorizationReceipt), }));
  }
  for (const [phase, method, field, operation] of TRANSITIONS) {
    const candidatePending = phase === "remote-active" && intent.pullRequestProjectionCandidate
      && intent.pullRequestProjectionCandidate.snapshotDigest !== intent.pullRequestProjection?.snapshotDigest;
    if (!atLeast(intent.status, phase) || candidatePending) {
      if (phase === "remote-active" && !candidatePending) intent = await prepareRemoteProjection({
        adapter, plan, intent, });
      const transition = await executeReviewedCiTransition({
        adapter, plan, intent, phase, method, operation, });
      if (transition.abort) return transition.abort;
      const values = transition.values;
      const snapshot = buildReviewedCiRevisionPhaseSnapshot({ phase, plan, values });
      if (phase === "remote-active"
        && snapshot.snapshotDigest !== intent.pullRequestProjectionCandidate?.snapshotDigest) {
        throw new Error("Remote mutation result differs from its durable pre-write candidate.");
      }
      const next = advanceReviewedCiRevisionIntent(intent, {
        status: phase, values: { [field]: snapshot }, });
      intent = normalizeReviewedCiRevisionIntent(await adapter.advanceIntent({ intent, next }));
      await adapter.reconcilePhase({ plan, intent, phase });
    } else if (intent.status === phase) {
      await adapter.reconcilePhase({ plan, intent, phase });
    }
    receipts.push(buildReviewedCiRevisionReceipt({
      phase, plan, values: intent[field]?.values || {}, }));
  }
  if (!atLeast(intent.status, "local-active")) ({ intent } = await activateReviewedCiLocal({
    adapter, plan, intent, receipts, }));
  await adapter.reconcilePhase({ plan, intent, phase: "local-active" });
  receipts.push(buildReviewedCiRevisionReceipt({
    phase: "local-active", plan, values: intent.localProjection?.values || {}, }));
  const final = await adapter.finalize({ plan, intent });
  if (intent.finalReceiptDigest !== final.receiptDigest) {
    throw new Error("Completed recovery live verification drifted.");
  }
  receipts.push(final);
  const result = Object.freeze({
    schema: "agentic-reviewed-ci-revision-recovery-result/v1", status: "recovered", planDigest: plan.planDigest, sourceClaimId: plan.sourceClaimId, successorClaimId: intent.binding.values.claimId, finalReceiptDigest: intent.finalReceiptDigest, receipts, });
  return archiveReviewedCiRevision({ adapter, plan, intent, result });
}
async function executeReviewedCiTransition({ adapter, plan, intent, phase, method, operation }) {
  const operationKey = reviewedCiRevisionOperationKey(plan, operation);
  const context = { plan, intent, phase, method, operationKey };
  let resolution = normalizeTransitionResolution(await adapter.reconcileTransition(context), operationKey);
  if (resolution.kind === "delivery-won") return { abort: await abortReviewedCiDelivery(
    { adapter, plan, intent, evidence: resolution.evidence }) };
  if (resolution.kind === "response-ahead") return { values: resolution.values };
  try {
    return { values: requireTransitionValues(await adapter[method]({ plan, intent }), operationKey) };
  } catch (error) {
    resolution = normalizeTransitionResolution(await adapter.reconcileTransition(context), operationKey);
    if (resolution.kind === "pending") throw error;
    if (resolution.kind === "delivery-won") return { abort: await abortReviewedCiDelivery(
      { adapter, plan, intent, evidence: resolution.evidence }) };
    return { values: resolution.values };
  }
}
async function abortReviewedCiDelivery({ adapter, plan, intent, evidence }) {
  if (atLeast(intent.status, "source-retired")) throw new Error(
    "Delivery-won classification conflicts with durable source retirement.");
  const observed = normalizeReviewedCiDeliveryEvidence(plan, intent.abortCleanup ? null : intent, evidence);
  if (!intent.abortCleanup) {
    const abortCleanup = createReviewedCiRevisionAbortCleanup(plan, intent, observed);
    const next = advanceReviewedCiRevisionIntent(intent, {
      status: intent.status, values: { abortCleanup }, });
    intent = normalizeReviewedCiRevisionIntent(await adapter.advanceIntent({ intent, next }));
  } else assertAbortReplayObservation(intent.abortCleanup.evidence, observed);
  const durableEvidence = intent.abortCleanup.evidence;
  const cleanup = normalizeDeliveryAbort(plan, intent, durableEvidence, await adapter.abortDeliveryWon({ plan, intent, evidence: durableEvidence }));
  const result = Object.freeze({ schema: "agentic-reviewed-ci-revision-recovery-result/v1", status: "aborted-delivery-won", planDigest: plan.planDigest, sourceClaimId: plan.sourceClaimId, deliveryReceiptDigest: durableEvidence.deliveryReceiptDigest, cleanupReceiptDigest: cleanup.cleanupReceiptDigest, abortReceiptDigest: cleanup.receiptDigest, });
  return archiveReviewedCiRevision({ adapter, plan, intent, result });
}
async function activateReviewedCiLocal({ adapter, plan, intent, receipts }) {
  for (let reprojected = 0; ; reprojected += 1) {
    await adapter.reconcilePhase({ plan, intent, phase: "remote-active" });
    try {
      const activated = normalizeReviewedCiRevisionIntent(await adapter.activateLocal({ plan, intent }));
      if (activated.status !== "local-active" || !activated.finalReceiptDigest) throw new Error(
        "Local activation did not durably complete the recovery intent.");
      return { intent: activated };
    } catch (error) {
      if (!isEpochDrift(error) || reprojected >= MAX_EPOCH_REPROJECTIONS) throw error;
      intent = await prepareRemoteProjection({ adapter, plan, intent, force: true });
      const operationKey = reviewedCiRevisionOperationKey(plan, "active-pr-marker");
      const values = requireTransitionValues(await adapter.projectPullRequest({ plan, intent }), operationKey);
      const snapshot = buildReviewedCiRevisionPhaseSnapshot({ phase: "remote-active", plan, values });
      const next = advanceReviewedCiRevisionIntent(intent, {
        status: "remote-active", values: { pullRequestProjection: snapshot }, });
      intent = normalizeReviewedCiRevisionIntent(await adapter.advanceIntent({ intent, next }));
      receipts[receipts.length - 1] = buildReviewedCiRevisionReceipt({
        phase: "remote-active", plan, values: snapshot.values, });
    }
  }
}
async function prepareRemoteProjection({ adapter, plan, intent, force = false }) {
  if (!force && intent.pullRequestProjectionCandidate) return intent;
  const operationKey = reviewedCiRevisionOperationKey(plan, "active-pr-marker");
  const values = requireTransitionValues(
    await adapter.preparePullRequestProjection({ plan, intent }), operationKey);
  const candidate = buildReviewedCiRevisionPhaseSnapshot({ phase: "remote-active", plan, values });
  const next = advanceReviewedCiRevisionIntent(intent, { status: intent.status, values: { pullRequestProjectionCandidate: candidate } });
  return normalizeReviewedCiRevisionIntent(await adapter.advanceIntent({ intent, next }));
}
function normalizeTransitionResolution(value, operationKey) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !["pending", "response-ahead", "delivery-won"].includes(value.kind)) {
    throw new Error("Transition reconciliation returned an invalid classification.");
  }
  if (value.kind === "pending") return Object.freeze({ kind: "pending" });
  if (value.kind === "response-ahead") return Object.freeze({ kind: value.kind, operationKey: requireExact(value.operationKey, operationKey, "response-ahead operation key"), values: requireTransitionValues(value.values, operationKey) });
  return Object.freeze({ kind: value.kind, evidence: value.evidence });
}
function requireTransitionValues(values, operationKey) {
  if (!values || typeof values !== "object" || Array.isArray(values)
    || values.operationKey !== operationKey) {
    throw new Error("Transition result is not bound to its exact operation key.");
  }
  return values;
}
function normalizeDeliveryAbort(plan, intent, evidence, value) {
  const derivative = evidence.derivative;
  const exact = { sourceClaimId: plan.sourceClaimId, sourceState: evidence.sourceState, sourceLeaseDigest: plan.sourceLeaseDigest, deliveryReceiptDigest: evidence.deliveryReceiptDigest, derivativeClaimId: derivative?.claimId ?? null, derivativeInitialState: derivative?.state ?? null, derivativeFinalState: derivative ? "retired" : null, retirementReason: derivative ? "abandoned" : null, sourcePullRequestNodeId: plan.pullRequestNodeId, sourcePullRequestState: "OPEN", journalState: "cleanup-complete", cleanupIntentDigest: intent.abortCleanup.cleanupIntentDigest };
  const core = { schema: "agentic-reviewed-ci-revision-delivery-abort/v1", ...Object.fromEntries(Object.entries(exact).map(([key, expected]) =>
      [key, requireExact(value?.[key], expected, `abort ${key}`)])), cleanupReceiptDigest: requiredDigest(value?.cleanupReceiptDigest, "abort cleanup receipt"), sourceMergedAt: value?.sourceMergedAt === null ? null : invalid("Abort changed source PR merge state."), };
  if (value?.schema !== core.schema || value.receiptDigest !== digestValue(core)) throw new Error(
    "Delivery abort receipt drifted.");
  return Object.freeze({ ...core, receiptDigest: value.receiptDigest });
}
function assertAbortReplayObservation(stored, observed) {
  for (const key of ["sourceClaimId", "sourceState", "sourcePullRequestNodeId", "sourcePullRequestState", "sourceMergedAt", "deliveryReceiptDigest"]) {
    requireExact(observed[key], stored[key], `abort replay ${key}`);
  }
  if (observed.derivative && digestValue(observed.derivative) !== digestValue(stored.derivative)) {
    throw new Error("Abort replay observed a different live derivative.");
  }
}
async function archiveReviewedCiRevision({ adapter, plan, intent, result }) {
  const archive = buildReviewedCiRevisionArchiveRecord({
    plan, intent, status: result.status, result, });
  const stored = normalizeReviewedCiRevisionArchiveRecord(
    await adapter.archiveRecovery({ plan, intent, archive }));
  if (stored.archiveReceiptDigest !== archive.archiveReceiptDigest) {
    throw new Error("Recovery archive CAS returned a different terminal record.");
  }
  return Object.freeze({ ...result, archiveReceiptDigest: stored.archiveReceiptDigest });
}
function replayReviewedCiRevisionArchive(value, authorization) {
  const archive = normalizeReviewedCiRevisionArchiveRecord(value);
  const exactAuthorization = `authorize reviewed-ci-revision-recovery ${archive.planDigest}`;
  const authorizationDigest = digestValue({ authorization: exactAuthorization, planDigest: archive.planDigest });
  if (String(authorization || "").trim() !== exactAuthorization
    || archive.authorizationDigest !== authorizationDigest) {
    throw new Error("Archived recovery replay requires its exact plan authorization.");
  }
  const common = { schema: "agentic-reviewed-ci-revision-recovery-result/v1", status: archive.status, planDigest: archive.planDigest, sourceClaimId: archive.sourceClaimId };
  if (archive.status === "recovered") return Object.freeze({ ...common, successorClaimId: archive.successorClaimId, finalReceiptDigest: archive.finalReceiptDigest, receipts: archive.receiptDigests.map(receiptDigest => Object.freeze({ receiptDigest })), archiveReceiptDigest: archive.archiveReceiptDigest });
  return Object.freeze({ ...common, deliveryReceiptDigest: archive.deliveryReceiptDigest, cleanupReceiptDigest: archive.cleanupReceiptDigest, abortReceiptDigest: archive.abortReceiptDigest, archiveReceiptDigest: archive.archiveReceiptDigest });
}
function isEpochDrift(error) {
  return error instanceof ReviewedCiRevisionEpochDriftError
    || error?.code === REVIEWED_CI_REVISION_EPOCH_DRIFT;
}
export function assertReviewedCiProviderSubject(plan, provider, { expectedDraft = false, expectedState = "OPEN" } = {}) {
  const pull = provider?.pullRequest;
  const evidence = buildReviewedCiFailureEvidence({
    ...provider?.evidenceInput, expectedDraft, expectedState });
  if (provider?.repository?.full_name !== plan.repository || pull?.number !== plan.pullRequestNumber
    || pull.nodeId !== plan.pullRequestNodeId || pull.url !== plan.pullRequestUrl
    || pull.branch !== plan.sourceBranch || pull.headSha !== plan.sourceHeadSha
    || pull.baseSha !== plan.successorCanonicalBaseSha || pull.baseRef !== "main"
    || pull.state !== expectedState || pull.isDraft !== expectedDraft
    || evidence.evidenceDigest !== plan.failureEvidenceDigest) {
    throw new Error("GitHub pull/check subject drifted from the authorized plan.");
  }
  return evidence;
}
export function assertReviewedCiLocalSubject(plan, local) {
  if (local?.branch !== plan.sourceBranch || local.headSha !== plan.sourceHeadSha
    || local.treeSha !== plan.sourceTreeSha || local.remoteHeadSha !== plan.sourceHeadSha
    || local.remoteMainSha !== plan.observedProtectedMainSha || !local.clean
    || local.originRepository !== plan.sourceOriginRepository
    || local.identityDigest !== plan.sourceWorktreeIdentityDigest) {
    throw new Error("Registered local/remote Git subject drifted from the plan.");
  }
  return local;
}
export function normalizeGitHubOriginRepository(value) {
  const match = String(value || "").trim().match(/^(?:git@github\.com:|https:\/\/github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/u);
  if (!match) throw new Error("Git origin is not an exact uncredentialed GitHub repository.");
  return match[1];
}
export function assertReviewedCiCloudPhase(plan, intent, phase, cloud) {
  const index = reviewedCiRevisionPhaseOrder(phase);
  const source = cloud.claims.filter(claim => claim.claimId === plan.sourceClaimId);
  const privateSource = cloud.privateClaims.filter(claim => claim.claimId === plan.sourceClaimId);
  const successorId = intent.successor?.values?.claimId;
  const successor = successorId ? cloud.claims.filter(claim => claim.claimId === successorId) : [];
  const privateSuccessor = successorId
    ? cloud.privateClaims.filter(claim => claim.claimId === successorId) : [];
  const responseAhead = !successorId
    ? findReviewedCiSuccessor({ claims: cloud.privateClaims }, plan, "waiting-successor") : null;
  if (responseAhead && (responseAhead.deviceId !== plan.sourcePrivateDeviceId
    || responseAhead.sessionId !== plan.sourcePrivateSessionId)) throw new Error("Response-ahead successor is foreign.");
  const allowedIds = new Set([plan.sourceClaimId, successorId, responseAhead?.claimId].filter(Boolean));
  if (cloud.privateClaims.some(claim => !allowedIds.has(claim.claimId)
    && claim.repositoryId === plan.sourceRepositoryId
    && writeSetsOverlap(claim.declaredWriteScope, plan.declaredWriteSet))) {
    throw new Error("Private cloud inventory contains a foreign overlapping reservation.");
  }
  const waitingIndex = reviewedCiRevisionPhaseOrder("successor-waiting");
  const sourceAllowed = index < waitingIndex ? source.length === 1
    : index === waitingIndex ? source.length <= 1 : source.length === 0;
  if (!sourceAllowed) throw new Error("Reviewed source claim drifted.");
  const privateSourceAllowed = index < waitingIndex ? privateSource.length === 1
    : index === waitingIndex ? privateSource.length <= 1 : privateSource.length === 0;
  if (!privateSourceAllowed || privateSource.some(claim => claim.deviceId !== plan.sourcePrivateDeviceId
    || claim.sessionId !== plan.sourcePrivateSessionId)) throw new Error("Private source owner drifted.");
  if (index >= waitingIndex && successor.length !== 1) throw new Error("Successor claim is missing.");
  if (index >= waitingIndex && (privateSuccessor.length !== 1
    || privateSuccessor[0].deviceId !== plan.sourcePrivateDeviceId
    || privateSuccessor[0].sessionId !== plan.sourcePrivateSessionId)) {
    throw new Error("Private successor owner drifted.");
  }
  const createdIndex = reviewedCiRevisionPhaseOrder("replacement-pr-created");
  const promotedIndex = reviewedCiRevisionPhaseOrder("successor-promoted");
  const allowedStates = index < createdIndex ? ["waiting-successor"]
    : index < promotedIndex ? ["waiting-successor", "current"] : ["current"];
  if (successor.length && !allowedStates.includes(successor[0].state)) {
    throw new Error("Successor cloud state drifted.");
  }
  if (successor.length && (successor[0].actorId !== plan.sourceActorId
    || successor[0].repositoryId !== plan.sourceRepositoryId
    || successor[0].workItemId !== plan.sourceWorkItemId
    || successor[0].laneRevision !== plan.sourceHeadSha
    || successor[0].canonicalBaseRevision !== plan.successorCanonicalBaseSha)) {
    throw new Error("Successor cloud identity drifted.");
  }
  const expected = index >= reviewedCiRevisionPhaseOrder("successor-bound") ? intent.binding.values
    : index >= promotedIndex ? intent.promotion.values
    : successor[0]?.state === "waiting-successor" ? intent.successor?.values : null;
  if (successor.length && expected && (successor[0].claimId !== expected.claimId
    || successor[0].fenceRevision !== expected.claimDigest
    || successor[0].transitionCounter !== expected.transitionCounter
    || successor[0].operationReceiptDigest !== expected.operationReceiptDigest)) {
    throw new Error("Successor receipt drifted from live cloud authority.");
  }
  if (intent.binding && digestValue(intent.binding.values.authority)
    !== intent.binding.values.authorityDigest) throw new Error("Bound authority digest drifted.");
}
export function requireReviewedCiClaimPreOrPost(status, plan) {
  const waiter = findReviewedCiSuccessor(status, plan, "waiting-successor");
  if (!waiter) return requireOnlyReviewedSource(status, plan);
  if (status.claims.filter(claim => claim.claimId === plan.sourceClaimId).length !== 1) {
    throw new Error("Claim replay lost its exact reviewed predecessor.");
  }
  return waiter;
}
export function requireReviewedCiRetirePreOrPost(status, plan, successor) {
  const source = status.claims.filter(claim => claim.claimId === plan.sourceClaimId);
  const live = exactReviewedCiClaim(status, successor.claimId);
  if (source.length === 1) return requireSourceAndSuccessor(status, plan, successor);
  if (source.length !== 0 || live.state !== "waiting-successor"
    || live.operationReceiptDigest !== successor.operationReceiptDigest) {
    throw new Error("Retirement replay state is not exact.");
  }
  return live;
}
export function exactReviewedCiClaim(status, claimId) {
  const matches = status?.claims?.filter(claim => claim.claimId === claimId) || [];
  if (matches.length !== 1) throw new Error("Cloud inventory lacks one exact claim.");
  return matches[0];
}
export function findReviewedCiSuccessor(status, plan, state) {
  const matches = status?.claims?.filter(claim => claim.predecessorClaimId === plan.sourceClaimId
    && claim.actorId === plan.sourceActorId && claim.repositoryId === plan.sourceRepositoryId
    && claim.workItemId === plan.sourceWorkItemId && claim.state === state
    && claim.canonicalBaseRevision === plan.successorCanonicalBaseSha
    && claim.laneRevision === plan.sourceHeadSha && claim.writeSetDigest === plan.writeSetDigest
    && claim.leaseEpoch === plan.successorCloudLeaseEpoch) || [];
  if (matches.length > 1) throw new Error("Cloud inventory has ambiguous same-owner successors.");
  return matches[0] || null;
}
function requireOnlyReviewedSource(status, plan) {
  const source = exactReviewedCiClaim(status, plan.sourceClaimId);
  if (source.state !== "reviewed" || status.claims.some(claim => claim.claimId !== source.claimId
    && claim.repositoryId === plan.sourceRepositoryId && claim.workItemId === plan.sourceWorkItemId)) {
    throw new Error("Cloud source is not one exclusive live reviewed owner.");
  }
  return source;
}
function requireSourceAndSuccessor(status, plan, successor) {
  requireOnlyReviewedSource(status, plan);
  const live = exactReviewedCiClaim(status, successor.claimId);
  if (live.state !== "waiting-successor" || live.predecessorClaimId !== plan.sourceClaimId
    || live.operationReceiptDigest !== successor.operationReceiptDigest) {
    throw new Error("Waiting successor drifted before source retirement.");
  }
  return live;
}
function requireAdapter(adapter) {
  if (!adapter) throw new Error("Reviewed CI revision adapter is required.");
}
function atLeast(current, expected) {
  return PHASES.indexOf(current) >= PHASES.indexOf(expected);
}
export function projectReviewedCiSourceMarker(plan, lease) {
  const marker = createReviewedCiRevisionIntentMarker(plan);
  const writerMarker = projectWriterLeasePullRequestMarker(lease);
  const body = upsertReviewedCiRevisionMarker(
    updateWriterLeasePullRequestBody(plan.pullRequestBody, lease), marker, );
  return Object.freeze({ body, bodyDigest: digestValue(body), marker, writerMarker });
}
export function projectReviewedCiRemoteActive({ plan, intent, lease, epoch, terminalVerification }) {
  const authority = intent.binding.values.authority;
  const replacement = intent.replacementPullRequest.values;
  const verification = normalizeReviewedCiTerminalVerification(terminalVerification
    ?? intent.localProjection?.values?.terminalVerification
    ?? intent.pullRequestProjection?.values?.localProjection?.values?.terminalVerification);
  const intendedLease = projectReviewedCiActiveLease({
    lease: { ...lease, pullRequestUrl: replacement.url, epoch }, authority, recovery: null, activatedAt: verification.verifiedAt, fenceSha: plan.sourceHeadSha, });
  const writerMarker = projectWriterLeasePullRequestMarker(intendedLease);
  const localProjection = buildReviewedCiRevisionPhaseSnapshot({
    phase: "local-active", plan, values: {
      operationKey: reviewedCiRevisionOperationKey(plan, "activate-local"), status: "active", epoch: intendedLease.epoch, fenceSha: intendedLease.fenceSha, pullRequestUrl: replacement.url, authorityDigest: digestValue(authority), leaseDigest: digestValue(intendedLease), writerMarkerDigest: digestValue(writerMarker), terminalVerification: verification, expiresAt: authority.expiresAt, }, });
  const finalReceipt = buildReviewedCiRevisionFinalReceipt(plan, intent, localProjection);
  const recoveryMarker = createReviewedCiRevisionMarker({
    plan, intent, localLeaseDigest: localProjection.snapshotDigest, finalReceiptDigest: finalReceipt.receiptDigest, });
  const bootstrap = createReviewedCiRevisionPullRequestBootstrap(plan);
  const body = upsertReviewedCiRevisionMarker(
    updateWriterLeasePullRequestBody(bootstrap.body, intendedLease), recoveryMarker, );
  return Object.freeze({ body, bodyDigest: digestValue(body), intendedLease, writerMarker, recoveryMarker, localProjection, finalReceipt, remoteProofDigest: finalReceipt.values.remoteProjectionProofDigest });
}
export function assertReviewedCiSourcePull(plan, pull, state) {
  assertPullIdentity(plan, pull);
  if (pull.number !== plan.pullRequestNumber || pull.nodeId !== plan.pullRequestNodeId
    || pull.url !== plan.pullRequestUrl || pull.title !== plan.sourcePullRequestTitle
    || pull.state !== state || pull.mergedAt !== null
    || pull.restAutoMergeRequest !== null || pull.isInMergeQueue !== false
    || pull.autoMergeRequest !== null || pull.mergeQueueEntry !== null
    || (state === "OPEN" && pull.isDraft !== false)) {
    throw new Error("Preserved source pull request drifted from the authorized lifecycle.");
  }
  return pull;
}
export function assertReviewedCiReplacementPull(plan, intent, pull, expectedBody) {
  assertPullIdentity(plan, pull, true);
  const expected = intent?.replacementPullRequest?.values || null;
  const bootstrap = createReviewedCiRevisionPullRequestBootstrap(plan);
  if (pull.number === plan.pullRequestNumber || pull.nodeId === plan.pullRequestNodeId
    || pull.state !== "OPEN" || pull.isDraft !== true || pull.mergedAt !== null
    || pull.restAutoMergeRequest !== null || pull.isInMergeQueue !== false
    || pull.autoMergeRequest !== null || pull.mergeQueueEntry !== null
    || pull.reviewDecision !== null || pull.reviewsTotalCount !== 0
    || !Array.isArray(pull.labels) || pull.labels.length !== 0
    || pull.title !== bootstrap.title || pull.body !== (expectedBody ?? bootstrap.body)
    || (expected && (pull.number !== expected.pullRequestNumber
      || pull.nodeId !== expected.pullRequestNodeId || pull.url !== expected.url))) {
    throw new Error("Replacement pull request drifted from the exact draft provider fence.");
  }
  return pull;
}
function assertPullIdentity(plan, pull, replacement = false) {
  const evidence = plan.failureEvidence;
  const expectedBaseSha = replacement ? plan.observedProtectedMainSha : plan.successorCanonicalBaseSha;
  const repositoryMatches = value => value?.fullName === plan.repository
    && value?.id === evidence.repositoryId && value?.nodeId === evidence.repositoryNodeId;
  if (pull.branch !== plan.sourceBranch || pull.headSha !== plan.sourceHeadSha
    || pull.baseRef !== "main" || pull.baseSha !== expectedBaseSha
    || pull.authorLogin !== plan.pullRequestAuthorLogin
    || !repositoryMatches(pull.headRepository) || !repositoryMatches(pull.baseRepository)) {
    throw new Error("Pull request repository, branch, or immutable Git subject drifted.");
  }
}
export function assertReviewedCiRecoveryPullBody({ plan, intent, phase, body, lease }) {
  const digest = digestValue(body), index = reviewedCiRevisionPhaseOrder(phase);
  const recovering = projectReviewedCiSourceMarker(plan, lease);
  if (phase === "intent" && digest === plan.pullRequestBodyDigest) {
    assertReviewedCiMarkerCardinality(body, "absent");
    if (digestValue(parseWriterLeasePullRequestBody(body)) !== plan.sourceWriterMarkerDigest) {
      throw new Error("Source writer marker drifted before recovery projection.");
    }
    return null;
  }
  const replacement = index >= reviewedCiRevisionPhaseOrder("replacement-pr-created");
  const expected = replacement ? digestValue(expectedReviewedCiReplacementBody(plan, intent, phase, lease))
    : recovering.bodyDigest;
  const writerCount = index >= reviewedCiRevisionPhaseOrder("remote-active") ? 1 : replacement ? 0 : 1;
  assertReviewedCiMarkerCardinality(body, "present", writerCount);
  if (digest !== expected) throw new Error("Pull-request body drifted from the exact recovery projection.");
  return parseReviewedCiRevisionMarker(body);
}
export function expectedReviewedCiReplacementBody(plan, intent, phase, lease) {
  if (reviewedCiRevisionPhaseOrder(phase) < reviewedCiRevisionPhaseOrder("remote-active")) {
    return createReviewedCiRevisionPullRequestBootstrap(plan).body;
  }
  const epoch = intent.localProjection?.values?.epoch
    || intent.pullRequestProjection.values.localProjection.values.epoch;
  const terminalVerification = intent.localProjection?.values?.terminalVerification
    || intent.pullRequestProjection.values.localProjection.values.terminalVerification;
  return projectReviewedCiRemoteActive({ plan, intent, lease, epoch, terminalVerification }).body;
}
export function readRecoveryIntent(leaseStore, branch) {
  const value = leaseStore?.readRegistry?.()?.reviewedCiRevisionRecoveries?.[branch] ?? null;
  return value ? normalizeReviewedCiRevisionIntent(value) : null;
}
export function archiveReviewedCiRevisionRegistry({ leaseStore, expectedLease, expectedIntent, archive }) {
  if (!leaseStore?.statePath || typeof leaseStore.withRegistryLock !== "function") throw new Error(
    "Recovery archive requires the repository writer-registry CAS capability.");
  const normalized = normalizeReviewedCiRevisionArchiveRecord(archive);
  return leaseStore.withRegistryLock(registry => {
    const current = registry?.leases?.[normalized.branch];
    const stored = registry?.reviewedCiRevisionRecoveries?.[normalized.branch] ?? null;
    const prior = registry?.reviewedCiRevisionRecoveryArchives?.[normalized.planDigest] ?? null;
    const expectedDigest = normalized.status === "recovered"
      ? normalized.terminalLeaseDigest : normalized.sourceLeaseDigest;
    if (stored === null && prior) {
      const replay = normalizeReviewedCiRevisionArchiveRecord(prior);
      if (replay.archiveReceiptDigest !== normalized.archiveReceiptDigest
        || writerLeaseDigest(current) !== expectedDigest) throw new Error("Recovery archive replay drifted.");
      return replay;
    }
    if (registry?.schema !== "agentic-writer-lease-registry/v2"
      || writerLeaseDigest(current) !== writerLeaseDigest(expectedLease)
      || writerLeaseDigest(current) !== expectedDigest || prior
      || digestValue(stored) !== digestValue(normalizeReviewedCiRevisionIntent(expectedIntent))) {
      throw new Error("Recovery archive registry CAS drifted.");
    }
    const recoveries = { ...(registry.reviewedCiRevisionRecoveries || {}) }; delete recoveries[normalized.branch];
    const next = { ...registry, revision: Number(registry.revision || 0) + 1,
      reviewedCiRevisionRecoveries: recoveries, reviewedCiRevisionRecoveryArchives: {
        ...(registry.reviewedCiRevisionRecoveryArchives || {}), [normalized.planDigest]: normalized } };
    const temporary = `${leaseStore.statePath}.${process.pid}.${Date.now()}.reviewed-ci-archive.tmp`;
    writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 }); renameSync(temporary, leaseStore.statePath);
    return normalized;
  });
}
export function nextWriterEpoch(leaseStore, branch) {
  if (typeof leaseStore?.withRegistryLock !== "function") {
    throw new Error("Recovery requires the repository writer-registry lock.");
  }
  return leaseStore.withRegistryLock(registry => {
    if (!registry?.leases?.[branch]) throw new Error("Recovery source lease disappeared.");
    return Math.max(0, ...Object.values(registry.leases).map(value => Number(value?.epoch || 0))) + 1;
  });
}
export function mutateRecoveryRegistry({ leaseStore, expectedLease, expectedIntent, nextIntent, activeLease = null, now = () => new Date() }) {
  if (!leaseStore?.statePath || typeof leaseStore.withRegistryLock !== "function") {
    throw new Error("Recovery requires the repository writer-registry CAS capability.");
  }
  return leaseStore.withRegistryLock(registry => {
    const normalizedIntent = normalizeReviewedCiRevisionIntent(nextIntent);
    const normalizedExpected = expectedIntent
      ? normalizeReviewedCiRevisionIntent(expectedIntent) : null;
    const current = registry?.leases?.[expectedLease.branch];
    const stored = registry?.reviewedCiRevisionRecoveries?.[expectedLease.branch] ?? null;
    if (registry?.schema !== "agentic-writer-lease-registry/v2"
      || writerLeaseDigest(current) !== writerLeaseDigest(expectedLease)
      || writerLeaseDigest(current) !== normalizedIntent.planSnapshot.sourceLeaseDigest
      || current.cloudAuthority?.claimId !== expectedLease.cloudAuthority.claimId
      || digestValue(stored) !== digestValue(expectedIntent)) {
      throw new Error("Writer registry changed before recovery CAS.");
    }
    const phaseDelta = normalizedExpected
      ? reviewedCiRevisionPhaseOrder(normalizedIntent.status)
        - reviewedCiRevisionPhaseOrder(normalizedExpected.status) : 0;
    if ((!normalizedExpected && normalizedIntent.status !== "intent")
      || (normalizedExpected && (phaseDelta < 0 || phaseDelta > 1))) {
      throw new Error("Recovery journal CAS transition is non-monotonic.");
    }
    const scopeExpansionIntent = registry.scopeExpansionIntents?.[current.branch];
    if (scopeExpansionIntent && scopeExpansionIntent.status !== "complete") {
      throw new Error("Another branch-level writer lifecycle intent is active.");
    }
    let leases = registry.leases;
    if (activeLease) {
      assertTerminalLease({ current, activeLease, intent: normalizedIntent, registry, nowMilliseconds: new Date(now()).getTime() });
      leases = { ...leases, [current.branch]: activeLease };
    } else if (normalizedIntent.status === "local-active" || current.status !== "review_ready") {
      throw new Error("Only terminal CAS may replace the unchanged review-ready source lease.");
    }
    const next = { ...registry, revision: Number(registry.revision || 0) + 1, leases, reviewedCiRevisionRecoveries: { ...(registry.reviewedCiRevisionRecoveries || {}), [current.branch]: normalizedIntent } };
    const temporary = `${leaseStore.statePath}.${process.pid}.${Date.now()}.reviewed-ci.tmp`;
    writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, leaseStore.statePath);
    return normalizedIntent;
  });
}
function assertTerminalLease({ current, activeLease, intent, registry, nowMilliseconds }) {
  const plan = intent.planSnapshot, local = intent.localProjection?.values;
  const maximumPriorEpoch = Math.max(0, ...Object.values(registry.leases)
    .map(value => Number(value?.epoch || 0)));
  const authority = intent.binding?.values?.authority;
  const verification = local?.terminalVerification;
  const expected = projectReviewedCiActiveLease({
    lease: { ...current, epoch: local?.epoch, pullRequestUrl: intent.replacementPullRequest?.values?.url }, authority, recovery: null, activatedAt: verification?.verifiedAt, fenceSha: plan.sourceHeadSha, });
  const verifiedAt = Date.parse(verification?.verifiedAt);
  const expiresAt = Date.parse(authority?.expiresAt);
  if (intent.status !== "local-active" || activeLease?.schema !== "agentic-writer-lease/v2"
    || activeLease.status !== "active") throw new Error(
    "Terminal active lease is not the exact unique global-epoch projection.");
  if (activeLease.epoch !== maximumPriorEpoch + 1) throw new ReviewedCiRevisionEpochDriftError();
  if (Number.isFinite(nowMilliseconds) && Number.isFinite(verifiedAt) && Number.isFinite(expiresAt)
    && (nowMilliseconds - verifiedAt > MAX_TERMINAL_VERIFICATION_AGE_MILLISECONDS
      || expiresAt - nowMilliseconds < plan.minimumMarginSeconds * 1_000)) {
    throw new ReviewedCiRevisionEpochDriftError("Terminal authority verification must be reprojected.");
  }
  if (writerLeaseDigest(current) !== plan.sourceLeaseDigest
    || digestValue(activeLease) !== digestValue(expected)
    || digestValue(activeLease) !== local?.leaseDigest
    || digestValue(projectWriterLeasePullRequestMarker(activeLease)) !== local?.writerMarkerDigest
    || digestValue(authority) !== local?.authorityDigest
    || verification?.authorityDigest !== local?.authorityDigest
    || verification?.expiresAt !== authority?.expiresAt
    || !Number.isFinite(nowMilliseconds) || !Number.isFinite(verifiedAt) || !Number.isFinite(expiresAt)
    || verifiedAt > nowMilliseconds
    || expiresAt - verifiedAt < plan.minimumMarginSeconds * 1_000
    || Object.hasOwn(current, "reviewedCiRevisionRecovery")) {
    throw new Error("Terminal active lease is not the exact unique global-epoch projection.");
  }
}
function requiredDigest(value, label) {
  if (!DIGEST_PATTERN.test(String(value || ""))) throw new Error(`${label} is invalid.`);
  return value;
}
function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} is invalid.`);
  return value;
}
function requireExact(value, expected, label) {
  if (value !== expected) throw new Error(`${label} drifted.`);
  return value;
}
function invalid(message) { throw new Error(message); }
