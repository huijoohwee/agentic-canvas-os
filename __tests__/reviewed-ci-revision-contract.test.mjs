import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  advanceReviewedCiRevisionIntent,
  authorizeReviewedCiRevision,
  buildReviewedCiRevisionArchiveRecord,
  buildReviewedCiRevisionFinalReceipt,
  buildReviewedCiRevisionPhaseSnapshot,
  buildReviewedCiRevisionPlan,
  buildReviewedCiRevisionReceipt,
  buildReviewedCiTerminalVerification,
  createReviewedCiRevisionAbortCleanup,
  createReviewedCiRevisionIntent,
  createReviewedCiRevisionIntentMarker,
  createReviewedCiRevisionMarker,
  createReviewedCiRevisionPullRequestBootstrap,
  normalizeReviewedCiRevisionArchiveRecord,
  normalizeReviewedCiRevisionIntent,
  normalizeReviewedCiRevisionPlan,
  parseReviewedCiRevisionMarker,
  projectReviewedCiActiveLease,
  reviewedCiRevisionOperationKey,
  reviewedCiRevisionProviderBoundaryDigest,
  reviewedCiRevisionSourceProjectionBodyDigest,
  upsertReviewedCiRevisionMarker,
} from "../scripts/reviewed-ci-revision-contract.mjs";
import { buildReviewedCiFailureEvidence } from "../scripts/reviewed-ci-revision-evidence.mjs";
import { assertReviewedCiCloudPhase, mutateRecoveryRegistry,
  nextWriterEpoch, projectReviewedCiRemoteActive,
  readRecoveryIntent } from "../scripts/reviewed-ci-revision-controller.mjs";
import { projectWriterLeasePullRequestMarker,
  updateWriterLeasePullRequestBody } from "../scripts/writer-lease-lib.mjs";
import { evidenceFixture } from "./reviewed-ci-revision-evidence.test.mjs";

const base = "a".repeat(40), head = "b".repeat(40), tree = "e".repeat(40);
const D = value => String(value).repeat(64);

export function sourceFixture() {
  const evidence = buildReviewedCiFailureEvidence(evidenceFixture());
  const declaredWriteSet = ["path:scripts/recovery.mjs", "semantic:reviewed-ci"];
  const writeSetDigest = digestValue(declaredWriteSet);
  const authority = {
    schema: "agentic-lane-cloud-authority/v1", provider: "github",
    ledgerRepository: "owner/ledger", targetRepository: "owner/repository",
    claimId: D(1), claimDigest: D(2), claimLedgerRevision: D(3),
    ledgerRevision: "c".repeat(40), ledgerDigest: D(4),
    canonicalBaseSha: base, laneRevision: head,
    cloudDeclaredWriteScope: declaredWriteSet, writeSetDigest,
    deviceId: "device", sessionId: "session", reviewRequestId: "github-pull-request:PR_node",
    leaseEpoch: 4, transitionCounter: 3, state: "review_ready",
    expiresAt: "2026-08-09T00:10:00.789Z", focusedEvidenceDigest: D(5),
    manifestDigest: D(6), entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    operationReceiptDigest: D(7), integrationReceiptDigest: null, integration: null,
  };
  const admission = {
    schema: "agentic-lane-admission-lease/v1", status: "admitted",
    semanticScope: "reviewed-ci", declaredWriteSet, writeSetDigest,
    manifestDigest: D(6), planReceiptDigest: D(8), admissionReceiptDigest: D(9),
    admittedReportDigest: D("a"), preservationReceiptDigest: D("b"),
    existingLaneStateDigest: D("c"),
  };
  const lease = {
    schema: "agentic-writer-lease/v2", status: "review_ready", epoch: 12,
    sessionId: "session", device: "device", scope: "reviewed-ci",
    branch: "agent/device/reviewed-ci", worktreePath: "/workspace/recovery",
    baseSha: base, fenceSha: head,
    pullRequestUrl: "https://github.com/owner/repository/pull/344",
    acquiredAt: "2026-08-09T00:00:00.000Z", heartbeatAt: authority.expiresAt,
    expiresAt: authority.expiresAt, reviewHeadSha: head,
    admission, cloudAuthority: authority,
  };
  const claim = {
    claimId: authority.claimId, state: "reviewed", actorId: "github-user:2",
    deviceId: "device-private", sessionId: "session-private",
    repositoryId: "github-repository:R_node", workItemId: "work-item:reviewed-ci",
    canonicalBaseRevision: base, laneRevision: head,
    declaredWriteScope: declaredWriteSet, writeSetDigest, leaseEpoch: 4,
    transitionCounter: 3, reviewRequestId: authority.reviewRequestId,
    expiresAt: authority.expiresAt, fenceRevision: authority.claimDigest,
    ledgerRevision: authority.claimLedgerRevision,
    entrySchema: authority.entrySchema, claimIdentitySchema: authority.claimIdentitySchema,
    operationReceiptDigest: authority.operationReceiptDigest,
  };
  const writerMarker = projectWriterLeasePullRequestMarker(lease);
  const pullRequestBody = `Human context\n\n<!-- agentic-writer-lease/v2 ${JSON.stringify(writerMarker)} -->`;
  const protectedMainAdvanceCore = { schema: "agentic-reviewed-ci-protected-main-advance/v1",
    canonicalBaseSha: base, observedMainSha: base, ancestryPath: [] };
  return {
    repository: "owner/repository", originRepository: "owner/repository", lease, authority, claim,
    verification: { verifiedAt: "2026-08-09T00:00:00.123Z" },
    failureEvidence: evidence, minimumMarginSeconds: 300,
    clean: true, headSha: head, treeSha: tree, remoteHeadSha: head, remoteMainSha: base,
    leaseDigest: digestValue(lease), worktreeIdentityDigest: D("e"),
    privateDeviceId: claim.deviceId, privateSessionId: claim.sessionId,
    protectedMainAdvance: { ...protectedMainAdvanceCore,
      receiptDigest: digestValue(protectedMainAdvanceCore) },
    pullRequest: {
      number: 344, nodeId: "PR_node", title: "fix: reviewed CI", authorLogin: "owner",
      url: lease.pullRequestUrl,
      repository: "owner/repository", branch: lease.branch, headSha: head,
      baseRef: "main", baseSha: base, isDraft: false, state: "OPEN",
      body: pullRequestBody,
    },
    pullRequestBodyDigest: digestValue(pullRequestBody), writerMarkerDigest: digestValue(writerMarker),
  };
}

function boundIntentFixture(source = sourceFixture()) {
  const plan = buildReviewedCiRevisionPlan({ source });
  const authorization = authorizeReviewedCiRevision({ plan,
    authorization: `authorize reviewed-ci-revision-recovery ${plan.planDigest}` });
  let intent = createReviewedCiRevisionIntent(plan, authorization);
  const operation = name => reviewedCiRevisionOperationKey(plan, name);
  const advance = (phase, field, values) => {
    const snapshot = buildReviewedCiRevisionPhaseSnapshot({ phase, plan, values });
    intent = advanceReviewedCiRevisionIntent(intent, { status: phase, values: { [field]: snapshot } });
    return snapshot;
  };
  const sourceProjection = advance("source-marker", "sourceProjection", {
    operationKey: operation("intent-marker"), pullRequestNodeId: plan.pullRequestNodeId,
    markerDigest: digestValue(createReviewedCiRevisionIntentMarker(plan)),
    writerMarkerDigest: plan.sourceWriterMarkerDigest,
    bodyDigest: reviewedCiRevisionSourceProjectionBodyDigest(plan),
  });
  const successor = { operationKey: operation("claim"), claimId: D(2), claimDigest: D(3),
    transitionCounter: 4, operationReceiptDigest: D(4), requestDigest: D(5),
    receiptDigest: D(6), ledgerDigest: D(7), state: "waiting-successor",
    canonicalBaseSha: plan.successorCanonicalBaseSha, laneRevision: plan.sourceHeadSha,
    leaseEpoch: plan.successorCloudLeaseEpoch };
  const successorSnapshot = advance("successor-waiting", "successor", successor);
  const successorIntent = intent;
  advance("source-retired", "sourceRetirement", { operationKey: operation("retire-source"),
    sourceClaimId: plan.sourceClaimId, successorClaimId: successor.claimId,
    receiptDigest: D(8), operationReceiptDigest: D(9), ledgerDigest: D("a"), state: "retired" });
  const boundary = reviewedCiRevisionProviderBoundaryDigest(plan);
  advance("source-pr-closed", "sourcePullRequestClosure", {
    operationKey: operation("close-source-pr"), pullRequestNumber: plan.pullRequestNumber,
    pullRequestNodeId: plan.pullRequestNodeId, url: plan.pullRequestUrl, state: "CLOSED",
    closedAt: "2026-08-09T00:00:01.000Z", mergedAt: null, headSha: plan.sourceHeadSha,
    baseSha: plan.successorCanonicalBaseSha, bodyDigest: sourceProjection.values.bodyDigest,
    bodyDisposition: "recovery-projection", providerDisposition: "closed",
    providerBoundaryDigest: boundary,
  });
  const bootstrap = createReviewedCiRevisionPullRequestBootstrap(plan);
  const replacement = { operationKey: operation("create-replacement-pr"), pullRequestNumber: 345,
    pullRequestNodeId: "PR_replacement", url: "https://github.com/owner/repository/pull/345",
    state: "OPEN", isDraft: true, title: bootstrap.title, bodyDigest: bootstrap.bodyDigest,
    providerDisposition: "created", providerBoundaryDigest: boundary,
    headSha: plan.sourceHeadSha, baseSha: plan.observedProtectedMainSha,
    authorLogin: plan.pullRequestAuthorLogin };
  advance("replacement-pr-created", "replacementPullRequest", replacement);
  const promotedAuthority = { ...source.authority, state: "active", claimId: successor.claimId,
    claimDigest: D("b"), transitionCounter: 5, operationReceiptDigest: D("c"),
    reviewRequestId: null, focusedEvidenceDigest: null };
  advance("successor-promoted", "promotion", { ...successor,
    operationKey: operation("promote-successor"), claimDigest: promotedAuthority.claimDigest,
    transitionCounter: promotedAuthority.transitionCounter, operationReceiptDigest: D("c"),
    receiptDigest: D("d"), state: "current", authority: promotedAuthority,
    authorityDigest: digestValue(promotedAuthority) });
  const authority = { ...promotedAuthority, claimDigest: D("e"), transitionCounter: 6,
    operationReceiptDigest: D("f"), reviewRequestId: "github-pull-request:PR_replacement" };
  advance("successor-bound", "binding", { operationKey: operation("bind-successor"), authority,
    authorityDigest: digestValue(authority), claimId: authority.claimId,
    claimDigest: authority.claimDigest, transitionCounter: authority.transitionCounter,
    operationReceiptDigest: authority.operationReceiptDigest,
    receiptDigest: authority.operationReceiptDigest, verificationReceiptDigest: D(1),
    verifiedAt: "2026-08-09T00:00:01.000Z" });
  return { source, plan, authorization, intent, operation, successor, successorSnapshot, successorIntent,
    replacement, authority };
}

function terminalProjection(fixture, epoch) {
  const terminalVerification = buildReviewedCiTerminalVerification({
    authorityDigest: digestValue(fixture.authority), receiptDigest: D(2),
    verifiedAt: "2026-08-09T00:00:02.000Z", expiresAt: fixture.authority.expiresAt });
  const projection = projectReviewedCiRemoteActive({ plan: fixture.plan, intent: fixture.intent,
    lease: fixture.source.lease, epoch, terminalVerification });
  const remote = buildReviewedCiRevisionPhaseSnapshot({ phase: "remote-active", plan: fixture.plan,
    values: { operationKey: fixture.operation("active-pr-marker"),
      pullRequestNodeId: fixture.replacement.pullRequestNodeId, bodyDigest: projection.bodyDigest,
      remoteProofDigest: projection.remoteProofDigest, writerMarker: projection.writerMarker,
      recoveryMarker: projection.recoveryMarker, localProjection: projection.localProjection,
      activeLease: projection.intendedLease, finalReceipt: projection.finalReceipt } });
  return { ...projection, activeLease: projection.intendedLease, remote };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
test("plan round-trips exact millisecond server margin and typed authorization", () => {
  const plan = buildReviewedCiRevisionPlan({ source: sourceFixture() });
  assert.equal(plan.sourceMarginMilliseconds, 600_666);
  assert.deepEqual(normalizeReviewedCiRevisionPlan(plan), plan);
  const authorization = authorizeReviewedCiRevision({
    plan, authorization: `authorize reviewed-ci-revision-recovery ${plan.planDigest}`,
  });
  const intent = createReviewedCiRevisionIntent(plan, authorization);
  const snapshot = buildReviewedCiRevisionPhaseSnapshot({
    phase: "source-marker", plan, values: {
      operationKey: reviewedCiRevisionOperationKey(plan, "intent-marker"),
      pullRequestNodeId: plan.pullRequestNodeId,
      markerDigest: digestValue(createReviewedCiRevisionIntentMarker(plan)),
      writerMarkerDigest: plan.sourceWriterMarkerDigest,
      bodyDigest: reviewedCiRevisionSourceProjectionBodyDigest(plan) },
  });
  assert.equal(advanceReviewedCiRevisionIntent(intent, {
    status: "source-marker", values: { sourceProjection: snapshot },
  }).authorization.authorizationDigest, authorization.authorizationDigest);
});

test("rejects dormant, foreign-session, and canonical-base drift", () => {
  const dormant = sourceFixture();
  dormant.claim.state = "dormant-preserved";
  assert.throws(() => buildReviewedCiRevisionPlan({ source: dormant }), /Dormant|dormant/);
  const foreign = sourceFixture();
  foreign.claim.sessionId = "foreign-private";
  assert.throws(() => buildReviewedCiRevisionPlan({ source: foreign }), /identity drifted/);
  const stale = sourceFixture();
  stale.lease.baseSha = "9".repeat(40);
  assert.throws(() => buildReviewedCiRevisionPlan({ source: stale }), /identity drifted/);
  const wrongUrl = sourceFixture();
  wrongUrl.pullRequest.url = "https://github.com/owner/repository/pull/999";
  assert.throws(() => buildReviewedCiRevisionPlan({ source: wrongUrl }), /identity drifted/);
  const wrongReview = sourceFixture();
  wrongReview.authority.reviewRequestId = "github-pull-request:foreign";
  wrongReview.lease.cloudAuthority.reviewRequestId = wrongReview.authority.reviewRequestId;
  wrongReview.claim.reviewRequestId = wrongReview.authority.reviewRequestId;
  assert.throws(() => buildReviewedCiRevisionPlan({ source: wrongReview }), /identity drifted/);
});

test("preserves reviewed canonical base while binding a newer protected main", () => {
  const source = sourceFixture();
  const observedMainSha = "f".repeat(40);
  source.remoteMainSha = observedMainSha;
  const receipt = { schema: "agentic-reviewed-ci-protected-main-advance/v1",
    canonicalBaseSha: base, observedMainSha, ancestryPath: [observedMainSha] };
  source.protectedMainAdvance = { ...receipt, receiptDigest: digestValue(receipt) };
  const plan = buildReviewedCiRevisionPlan({ source });
  assert.equal(plan.failureEvidence.baseSha, base);
  assert.equal(plan.successorCanonicalBaseSha, base);
  assert.equal(plan.observedProtectedMainSha, observedMainSha);
  assert.deepEqual(normalizeReviewedCiRevisionPlan(plan), plan);
  const tampered = structuredClone(source);
  tampered.protectedMainAdvance.ancestryPath = [];
  assert.throws(() => buildReviewedCiRevisionPlan({ source: tampered }), /advance receipt/);
});

test("recovering marker upsert preserves unrelated body content", () => {
  const plan = buildReviewedCiRevisionPlan({ source: sourceFixture() });
  const body = "human text\n\n<!-- agentic-writer-lease/v2 {\"kept\":true} -->";
  const updated = upsertReviewedCiRevisionMarker(body, createReviewedCiRevisionIntentMarker(plan));
  assert.match(updated, /human text/);
  assert.match(updated, /agentic-writer-lease\/v2/);
  assert.equal(parseReviewedCiRevisionMarker(updated).planDigest, plan.planDigest);
});

test("replacement body is bounded before provider lifecycle mutation", () => {
  const source = sourceFixture();
  source.pullRequest.body = "x".repeat(65_536);
  source.pullRequestBodyDigest = digestValue(source.pullRequest.body);
  const plan = buildReviewedCiRevisionPlan({ source });
  assert.throws(() => createReviewedCiRevisionPullRequestBootstrap(plan), /body exceeds/);
});

test("phase snapshots reject tampering and private inventory rejects foreign overlap", () => {
  const source = sourceFixture();
  const plan = buildReviewedCiRevisionPlan({ source });
  const authorization = authorizeReviewedCiRevision({
    plan, authorization: `authorize reviewed-ci-revision-recovery ${plan.planDigest}`,
  });
  const intent = createReviewedCiRevisionIntent(plan, authorization);
  const snapshot = buildReviewedCiRevisionPhaseSnapshot({
    phase: "source-marker", plan, values: {
      operationKey: reviewedCiRevisionOperationKey(plan, "intent-marker"),
      pullRequestNodeId: plan.pullRequestNodeId,
      markerDigest: digestValue(createReviewedCiRevisionIntentMarker(plan)),
      writerMarkerDigest: plan.sourceWriterMarkerDigest,
      bodyDigest: reviewedCiRevisionSourceProjectionBodyDigest(plan) },
  });
  const tampered = structuredClone(snapshot);
  tampered.values.markerDigest = D(2);
  assert.throws(() => advanceReviewedCiRevisionIntent(intent, {
    status: "source-marker", values: { sourceProjection: tampered },
  }), /source marker|snapshot digest/);
  const foreign = {
    ...source.claim, claimId: D(9), actorId: "github-user:foreign",
    deviceId: "foreign-device", sessionId: "foreign-session",
  };
  assert.throws(() => assertReviewedCiCloudPhase(plan, intent, "intent", {
    claims: [source.claim], privateClaims: [source.claim, foreign],
  }), /foreign overlapping/);
});

test("typed phase semantics reject foreign keys, boundaries, receipts, and arbitrary fields", () => {
  const fixture = boundIntentFixture();
  for (const field of ["sourceProjection", "successor", "sourceRetirement",
    "sourcePullRequestClosure", "replacementPullRequest", "promotion", "binding"]) {
    const forged = structuredClone(fixture.intent), snapshot = forged[field];
    snapshot.values.operationKey += ":foreign";
    snapshot.snapshotDigest = digestValue({ schema: snapshot.schema, phase: snapshot.phase,
      planDigest: snapshot.planDigest, values: snapshot.values });
    assert.throws(() => normalizeReviewedCiRevisionIntent(forged), /operation.*drifted/);
  }
  const boundary = structuredClone(fixture.intent);
  boundary.replacementPullRequest.values.providerBoundaryDigest = D(9);
  boundary.replacementPullRequest.snapshotDigest = digestValue({
    schema: boundary.replacementPullRequest.schema,
    phase: boundary.replacementPullRequest.phase,
    planDigest: boundary.replacementPullRequest.planDigest,
    values: boundary.replacementPullRequest.values });
  assert.throws(() => normalizeReviewedCiRevisionIntent(boundary), /boundary drifted/);
  const receipt = structuredClone(fixture.intent);
  receipt.binding.values.receiptDigest = D(8);
  receipt.binding.snapshotDigest = digestValue({ schema: receipt.binding.schema,
    phase: receipt.binding.phase, planDigest: receipt.binding.planDigest,
    values: receipt.binding.values });
  assert.throws(() => normalizeReviewedCiRevisionIntent(receipt), /Binding receipt/);
  const arbitrary = structuredClone(fixture.intent);
  arbitrary.successor.values.unlistedProof = D(8);
  arbitrary.successor.snapshotDigest = digestValue({ schema: arbitrary.successor.schema,
    phase: arbitrary.successor.phase, planDigest: arbitrary.successor.planDigest,
    values: arbitrary.successor.values });
  assert.throws(() => normalizeReviewedCiRevisionIntent(arbitrary), /arbitrary/);
});

test("prepared abort cleanup survives derivative absence and archives with its normalized intent", () => {
  const fixture = boundIntentFixture(), { plan, successorIntent, successor } = fixture;
  const derivative = { claimId: successor.claimId, claimDigest: successor.claimDigest,
    transitionCounter: successor.transitionCounter,
    operationReceiptDigest: successor.operationReceiptDigest, state: successor.state,
    predecessorClaimId: plan.sourceClaimId, actorId: plan.sourceActorId,
    repositoryId: plan.sourceRepositoryId, workItemId: plan.sourceWorkItemId,
    deviceId: plan.sourceDeviceId, sessionId: plan.sourceSessionId,
    canonicalBaseSha: plan.successorCanonicalBaseSha, laneRevision: plan.sourceHeadSha,
    writeSetDigest: plan.writeSetDigest, leaseEpoch: plan.successorCloudLeaseEpoch };
  const evidenceCore = { schema: "agentic-reviewed-ci-revision-delivery-won/v1",
    sourceClaimId: plan.sourceClaimId, sourceState: "integrated-preserved",
    sourcePullRequestNodeId: plan.pullRequestNodeId, sourcePullRequestState: "OPEN",
    sourceMergedAt: null, deliveryReceiptDigest: D(3), derivative };
  const evidence = { ...evidenceCore, evidenceDigest: digestValue(evidenceCore) };
  const abortCleanup = createReviewedCiRevisionAbortCleanup(plan, successorIntent, evidence);
  const prepared = advanceReviewedCiRevisionIntent(successorIntent, { status: "successor-waiting",
    values: { abortCleanup } });
  assert.throws(() => advanceReviewedCiRevisionIntent(prepared, { status: "source-retired",
    values: { sourceRetirement: fixture.intent.sourceRetirement } }), /abort cleanup/i);
  const result = { deliveryReceiptDigest: evidence.deliveryReceiptDigest,
    cleanupReceiptDigest: D(4), abortReceiptDigest: D(5) };
  const archive = buildReviewedCiRevisionArchiveRecord({ plan, intent: prepared,
    status: "aborted-delivery-won", result });
  assert.deepEqual(normalizeReviewedCiRevisionArchiveRecord(archive), archive);
  const forged = structuredClone(archive);
  forged.sourceClaimId = D(9);
  const core = structuredClone(forged); delete core.archiveReceiptDigest;
  forged.archiveReceiptDigest = digestValue(core);
  assert.throws(() => normalizeReviewedCiRevisionArchiveRecord(forged), /source claim drifted/);
});

test("terminal CAS uses one globally monotonic epoch and rejects a self-consistent forged lease", () => {
  const fixture = boundIntentFixture(), { source, plan } = fixture;
  const directory = mkdtempSync(path.join(os.tmpdir(), "reviewed-ci-cas-"));
  const statePath = path.join(directory, "writer-leases.json");
  let registry = {
    schema: "agentic-writer-lease-registry/v2", revision: 1,
    leases: { [source.lease.branch]: source.lease,
      peer: { ...source.lease, branch: "peer", epoch: 20 } },
    reviewedCiRevisionRecoveries: { [source.lease.branch]: fixture.intent },
  };
  const leaseStore = {
    statePath,
    readRegistry() {
      try { registry = JSON.parse(readFileSync(statePath, "utf8")); } catch {}
      return registry;
    },
    withRegistryLock(action) {
      return action(this.readRegistry());
    },
  };
  try {
    writeFileSync(statePath, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
    assert.equal(readRecoveryIntent(leaseStore, source.lease.branch).status, "successor-bound");
    assert.equal(nextWriterEpoch(leaseStore, source.lease.branch), 21);
    let projection = terminalProjection(fixture, 21);
    let candidateIntent = advanceReviewedCiRevisionIntent(fixture.intent, { status: "successor-bound",
      values: { pullRequestProjectionCandidate: projection.remote } });
    mutateRecoveryRegistry({ leaseStore, expectedLease: source.lease,
      expectedIntent: fixture.intent, nextIntent: candidateIntent });
    let remoteIntent = advanceReviewedCiRevisionIntent(candidateIntent, { status: "remote-active",
      values: { pullRequestProjection: projection.remote } });
    mutateRecoveryRegistry({ leaseStore, expectedLease: source.lease,
      expectedIntent: candidateIntent, nextIntent: remoteIntent });
    registry = leaseStore.readRegistry();
    registry.leases.peer.epoch = 21;
    writeFileSync(statePath, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
    let terminalIntent = advanceReviewedCiRevisionIntent(remoteIntent, { status: "local-active",
      values: { localProjection: projection.localProjection,
        finalReceiptDigest: projection.finalReceipt.receiptDigest } });
    assert.throws(() => mutateRecoveryRegistry({ leaseStore, expectedLease: source.lease,
      expectedIntent: remoteIntent, nextIntent: terminalIntent,
      activeLease: projection.activeLease,
      now: () => "2026-08-09T00:00:02.500Z" }), /unique global-epoch/);
    projection = terminalProjection(fixture, 22);
    candidateIntent = advanceReviewedCiRevisionIntent(remoteIntent, { status: "remote-active",
      values: { pullRequestProjectionCandidate: projection.remote } });
    mutateRecoveryRegistry({ leaseStore, expectedLease: source.lease,
      expectedIntent: remoteIntent, nextIntent: candidateIntent });
    const reprojected = advanceReviewedCiRevisionIntent(candidateIntent, { status: "remote-active",
      values: { pullRequestProjection: projection.remote } });
    mutateRecoveryRegistry({ leaseStore, expectedLease: source.lease,
      expectedIntent: candidateIntent, nextIntent: reprojected });
    const forgedLease = { ...projection.activeLease, unlistedAuthorityBypass: true };
    const forgedLocal = buildReviewedCiRevisionPhaseSnapshot({ phase: "local-active", plan,
      values: { ...projection.localProjection.values, leaseDigest: digestValue(forgedLease),
        writerMarkerDigest: digestValue(projectWriterLeasePullRequestMarker(forgedLease)) } });
    const forgedFinal = buildReviewedCiRevisionFinalReceipt(plan, fixture.intent, forgedLocal);
    const forgedMarker = createReviewedCiRevisionMarker({ plan, intent: fixture.intent,
      localLeaseDigest: forgedLocal.snapshotDigest,
      finalReceiptDigest: forgedFinal.receiptDigest });
    const forgedBody = upsertReviewedCiRevisionMarker(updateWriterLeasePullRequestBody(
      createReviewedCiRevisionPullRequestBootstrap(plan).body, forgedLease), forgedMarker);
    const forgedRemote = buildReviewedCiRevisionPhaseSnapshot({ phase: "remote-active", plan,
      values: { operationKey: fixture.operation("active-pr-marker"),
        pullRequestNodeId: fixture.replacement.pullRequestNodeId,
        bodyDigest: digestValue(forgedBody),
        remoteProofDigest: forgedFinal.values.remoteProjectionProofDigest,
        writerMarker: projectWriterLeasePullRequestMarker(forgedLease),
        recoveryMarker: forgedMarker, localProjection: forgedLocal,
        activeLease: forgedLease, finalReceipt: forgedFinal } });
    const forgedCandidateIntent = advanceReviewedCiRevisionIntent(reprojected, { status: "remote-active",
      values: { pullRequestProjectionCandidate: forgedRemote } });
    mutateRecoveryRegistry({ leaseStore, expectedLease: source.lease,
      expectedIntent: reprojected, nextIntent: forgedCandidateIntent });
    const forgedRemoteIntent = advanceReviewedCiRevisionIntent(forgedCandidateIntent, { status: "remote-active",
      values: { pullRequestProjection: forgedRemote } });
    mutateRecoveryRegistry({ leaseStore, expectedLease: source.lease,
      expectedIntent: forgedCandidateIntent, nextIntent: forgedRemoteIntent });
    const forgedTerminal = advanceReviewedCiRevisionIntent(forgedRemoteIntent, { status: "local-active",
      values: { localProjection: forgedLocal, finalReceiptDigest: forgedFinal.receiptDigest } });
    assert.throws(() => mutateRecoveryRegistry({ leaseStore, expectedLease: source.lease,
      expectedIntent: forgedRemoteIntent, nextIntent: forgedTerminal,
      activeLease: forgedLease,
      now: () => "2026-08-09T00:00:02.500Z" }), /exact unique global-epoch/);
    mutateRecoveryRegistry({ leaseStore, expectedLease: source.lease,
      expectedIntent: forgedRemoteIntent, nextIntent: reprojected });
    terminalIntent = advanceReviewedCiRevisionIntent(reprojected, { status: "local-active",
      values: { localProjection: projection.localProjection,
        finalReceiptDigest: projection.finalReceipt.receiptDigest } });
    mutateRecoveryRegistry({ leaseStore, expectedLease: source.lease,
      expectedIntent: reprojected, nextIntent: terminalIntent, activeLease: projection.activeLease,
      now: () => "2026-08-09T00:00:02.500Z" });
    registry = JSON.parse(readFileSync(statePath, "utf8"));
    const terminal = registry.leases[source.lease.branch];
    assert.equal(terminal.epoch, 22);
    assert.equal(terminal.status, "active");
    assert.equal(projectWriterLeasePullRequestMarker(terminal).fenceSha, head);
    assert.equal(Object.hasOwn(terminal, "reviewedCiRevisionRecovery"), false);
    assert.deepEqual(terminal, projection.activeLease);
    assert.equal(registry.reviewedCiRevisionRecoveries[source.lease.branch].status, "local-active");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
}
