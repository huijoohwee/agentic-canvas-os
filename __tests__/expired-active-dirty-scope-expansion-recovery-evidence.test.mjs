// Responsibility: Prove exact source joins and replay-stable recovery phase evidence.
import assert from "node:assert/strict";
import test from "node:test";

import { digestValue, normalizeWriteSet } from "../scripts/cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "../scripts/github-cloud-collaboration-mapping.mjs";
import {
  buildExpiredActiveDirtyScopeExpansionRecoveryPhaseObservation,
  buildExpiredActiveDirtyScopeExpansionRecoverySourceEvidence,
  classifyExpiredActiveDirtyScopeExpansionRecoveryPhase,
  expiredActiveDirtyScopeExpansionRecoveryOperationKey,
  normalizeExpiredActiveDirtyScopeExpansionRecoveryPhaseObservation,
  normalizeExpiredActiveDirtyScopeExpansionRecoverySourceEvidence,
} from "../scripts/expired-active-dirty-scope-expansion-recovery-evidence.mjs";
import { writerLeaseDigest } from "../scripts/writer-lease-registry-cas.mjs";

const sha = label => digestValue({ label }).slice(0, 40);
const digest = label => digestValue({ label });
const scope = "dormant-preservation-detached-fix";
const branch = `agent/huis-macbook-pro-3.local/${scope}`;
const repositoryPath = "/workspace/dormant-preservation-detached-fix";
const baseSha = sha("base");
const fenceSha = sha("fence");
const treeSha = sha("tree");
const protectedSha = sha("protected");
const claimId = digest("claim");
const sourceClaimDigest = digest("source-claim");
const sourceTransitionDigest = digest("source-transition");
const writeSet = normalizeWriteSet([
  "path:docs/DORMANT-PRESERVATION-DECISION.md",
  "path:scripts/dormant-preservation-decision-evidence.mjs",
  `semantic:${scope}`,
]);
const writeSetDigest = digestValue(writeSet);
const sourceExpiry = "2026-08-09T20:36:19.000Z";

function leaseFixture(cloudAuthority = sourceAuthority()) {
  return {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 225,
    sessionId: "codex-dormant-preservation-detached-fix-20260810",
    device: "huis-macbook-pro-3.local",
    scope,
    branch,
    worktreePath: repositoryPath,
    baseSha,
    fenceSha,
    pullRequestUrl: "https://github.com/huijoohwee/agentic-canvas-os/pull/358",
    autoDelivery: false,
    runtimeRequired: false,
    admission: {
      schema: "agentic-lane-admission-lease/v1",
      status: "admitted",
      semanticScope: scope,
      declaredWriteSet: writeSet,
      writeSetDigest,
      manifestDigest: digest("manifest"),
      planReceiptDigest: digest("admission-plan"),
      admissionReceiptDigest: digest("admission"),
      existingLaneStateDigest: digest("existing-lanes"),
      admittedReportDigest: digest("admitted-report"),
      preservationReceiptDigest: digest("preservation"),
    },
    cloudAuthority,
    acquiredAt: "2026-08-09T20:01:30.553Z",
    heartbeatAt: "2026-08-09T20:06:40.958Z",
    expiresAt: cloudAuthority.expiresAt,
  };
}

function sourceAuthority() {
  return {
    schema: "agentic-lane-cloud-authority/v1",
    provider: "github",
    ledgerRepository: "huijoohwee/agentic-canvas-os",
    targetRepository: "huijoohwee/agentic-canvas-os",
    claimId,
    claimDigest: sourceClaimDigest,
    ledgerRevision: sha("source-ledger"),
    ledgerDigest: digest("source-ledger-digest"),
    claimLedgerRevision: sourceTransitionDigest,
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    operationReceiptDigest: digest("source-operation"),
    mutationAuthorityEligible: true,
    canonicalBaseSha: baseSha,
    laneRevision: fenceSha,
    cloudDeclaredWriteScope: writeSet,
    writeSetDigest,
    deviceId: "huis-macbook-pro-3.local",
    sessionId: "codex-dormant-preservation-detached-fix-20260810",
    reviewRequestId: "github-pull-request:PR_358",
    leaseEpoch: 1,
    transitionCounter: 3,
    state: "active",
    expiresAt: sourceExpiry,
    integrationReceiptDigest: null,
    integration: null,
  };
}

function sourceClaim() {
  const authority = sourceAuthority();
  return {
    claimId,
    claimDigest: authority.claimDigest,
    state: "dormant-preserved",
    recordedState: "current",
    writeAuthority: false,
    scopeReserved: true,
    actorId: "github-user:8945812",
    deviceId: pseudonymousIdentifier("device", authority.deviceId),
    sessionId: pseudonymousIdentifier("session", authority.sessionId),
    repositoryId: "github-repository:R_kgDOSr5-fA",
    workItemId: digest("work-item"),
    canonicalBaseRevision: baseSha,
    laneRevision: fenceSha,
    declaredWriteScope: writeSet,
    writeSetDigest,
    leaseEpoch: 1,
    transitionCounter: 3,
    heartbeatCounter: 2,
    reviewRequestId: authority.reviewRequestId,
    expiresAt: sourceExpiry,
    transitionDigest: sourceTransitionDigest,
    operationReceiptDigest: authority.operationReceiptDigest,
    recovery: null,
  };
}

function peerClaim(overrides = {}) {
  const peerFence = digest("peer-fence");
  const core = {
    ...sourceClaim(),
    claimId: digest("peer"),
    claimDigest: peerFence,
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    evidenceDigest: null,
    predecessorClaimId: null,
    eligibleSince: null,
    handoff: null,
    release: null,
    fenceRevision: peerFence,
    ledgerRevision: digest("peer-ledger"),
    ledgerSequence: 1679,
    integrationReceiptDigest: null,
    recovery: null,
    integration: null,
    handoffEvidenceDigest: null,
    promotedAt: null,
    deliveryAuthorization: null,
    retirement: null,
    ...overrides,
  };
  return { ...core, recordDigest: digestValue(core) };
}

function laneFixture() {
  return {
    path: repositoryPath,
    branch,
    headSha: fenceSha,
    treeSha,
    parentSha: baseSha,
    parentTreeSha: treeSha,
    parentCount: 1,
    remoteHeadSha: fenceSha,
    detached: false,
    dirty: true,
    invalid: false,
    indexDigest: digest("index"),
    workingTreeDigest: digest("working"),
    stateDigest: digest("source-state"),
  };
}

function dirtFixture() {
  return {
    statusDigest: digest("status"),
    indexDigest: digest("dirt-index"),
    unstagedDiffDigest: digest("unstaged"),
    stagedDiffDigest: digest("staged"),
    worktreeObjectsDigest: digest("objects"),
    ownedDirtDigest: digest("owned-dirt"),
    pathCount: 2,
    changedPaths: [
      "docs/DORMANT-PRESERVATION-DECISION.md",
      "scripts/dormant-preservation-decision-evidence.mjs",
    ],
    untrackedPaths: [],
  };
}

function pullRequestFixture(markerLeaseDigest) {
  return {
    number: 358,
    nodeId: "PR_358",
    url: "https://github.com/huijoohwee/agentic-canvas-os/pull/358",
    state: "OPEN",
    isDraft: true,
    baseRepository: "huijoohwee/agentic-canvas-os",
    baseRefName: "main",
    baseRefOid: protectedSha,
    headRefName: branch,
    headRefOid: fenceSha,
    headRepository: "huijoohwee/agentic-canvas-os",
    markerLeaseDigest,
    bodyFrameDigest: digest("body-frame"),
  };
}

function sourceInput(overrides = {}) {
  const lease = overrides.lease ?? leaseFixture();
  return {
    controller: {
      path: "/workspace/agentic-canvas-os",
      origin: "git@github.com:huijoohwee/agentic-canvas-os.git",
      targetRepository: "huijoohwee/agentic-canvas-os",
      headSha: protectedSha,
      originMainSha: protectedSha,
      remoteMainSha: protectedSha,
      treeSha: sha("protected-tree"),
      clean: true,
      implementationDigest: digest("implementation"),
    },
    lane: laneFixture(),
    lease,
    leaseDigest: writerLeaseDigest(lease),
    cloud: {
      ledgerRepository: lease.cloudAuthority.ledgerRepository,
      ledgerRevision: lease.cloudAuthority.ledgerRevision,
      ledgerDigest: lease.cloudAuthority.ledgerDigest,
      sequence: 1680,
      authenticatedActor: { actorId: "github-user:8945812", login: "huijoohwee" },
      claim: sourceClaim(),
      peers: [],
    },
    pullRequest: pullRequestFixture(writerLeaseDigest(lease)),
    dirt: dirtFixture(),
    scopeExpansionIntent: null,
    ...overrides,
  };
}

function recoveredLive({ local = false, projected = false, complete = false } = {}) {
  const authorizationDigest = digest("authorization");
  const planDigest = digest("plan");
  const cloudKey = expiredActiveDirtyScopeExpansionRecoveryOperationKey(
    { planDigest }, authorizationDigest, "cloud-recovered",
  );
  const claim = {
    ...sourceClaim(),
    claimDigest: digest("recovered-claim"),
    state: "current",
    writeAuthority: true,
    transitionCounter: 4,
    expiresAt: "2026-08-10T00:30:00.000Z",
    transitionDigest: digest("recovered-transition"),
    operationReceiptDigest: digest("recovered-operation"),
    recovery: { evidenceDigest: cloudKey, recoveredAt: "2026-08-09T23:30:00.000Z" },
  };
  const authority = {
    ...sourceAuthority(),
    claimDigest: claim.claimDigest,
    ledgerRevision: sha("recovered-ledger"),
    ledgerDigest: digest("recovered-ledger-digest"),
    claimLedgerRevision: claim.transitionDigest,
    operationReceiptDigest: claim.operationReceiptDigest,
    transitionCounter: claim.transitionCounter,
    expiresAt: claim.expiresAt,
  };
  const lease = local ? {
    ...leaseFixture(authority),
    heartbeatAt: "2026-08-09T23:30:00.000Z",
    expiresAt: claim.expiresAt,
  } : leaseFixture();
  const leaseDigest = writerLeaseDigest(lease);
  return {
    planDigest,
    authorizationDigest,
    live: {
      lane: laneFixture(),
      lease,
      leaseDigest,
      cloud: {
        ledgerRepository: authority.ledgerRepository,
        ledgerRevision: authority.ledgerRevision,
        ledgerDigest: authority.ledgerDigest,
        sequence: 1681,
        authenticatedActor: { actorId: "github-user:8945812", login: "huijoohwee" },
        claim,
        peers: [],
      },
      pullRequest: pullRequestFixture(projected ? leaseDigest : writerLeaseDigest(leaseFixture())),
      dirt: dirtFixture(),
      scopeExpansionIntent: null,
      mutationAuthority: complete ? {
        schema: "agentic-admission-mutation-authority/v1",
        status: "ready",
        claimId,
        claimDigest: claim.claimDigest,
        ledgerRevision: authority.ledgerRevision,
        localLeaseEpoch: lease.epoch,
        localFenceSha: fenceSha,
        remoteLeaseEpoch: claim.leaseEpoch,
        expiresAt: claim.expiresAt,
      } : null,
    },
  };
}

test("source evidence binds the expired same-owner claim and exact owned dirt", () => {
  const evidence = buildExpiredActiveDirtyScopeExpansionRecoverySourceEvidence(sourceInput());
  assert.deepEqual(
    normalizeExpiredActiveDirtyScopeExpansionRecoverySourceEvidence(evidence),
    evidence,
  );
  assert.equal(evidence.cloud.claim.state, "dormant-preserved");
  assert.equal(evidence.dirt.pathCount, 2);
  assert.equal(evidence.scopeExpansionIntent, null);
  const https = sourceInput();
  https.controller.origin = "https://github.com/huijoohwee/agentic-canvas-os.git";
  assert.equal(buildExpiredActiveDirtyScopeExpansionRecoverySourceEvidence(https)
    .controller.targetRepository, "huijoohwee/agentic-canvas-os");
});

test("source evidence rejects actor, peer, dirt, and durable-intent drift", () => {
  const actorDrift = sourceInput();
  actorDrift.cloud.authenticatedActor.actorId = "github-user:other";
  assert.throws(
    () => buildExpiredActiveDirtyScopeExpansionRecoverySourceEvidence(actorDrift),
    /identities do not join/u,
  );
  for (const field of ["deviceId", "sessionId"]) {
    const ownerDrift = sourceInput();
    ownerDrift.cloud.claim[field] = field === "deviceId"
      ? ownerDrift.lease.device : ownerDrift.lease.sessionId;
    assert.throws(
      () => buildExpiredActiveDirtyScopeExpansionRecoverySourceEvidence(ownerDrift),
      /identities do not join/u,
    );
  }
  const originDrift = sourceInput();
  originDrift.controller.origin = "git@github.com:another/repository.git";
  assert.throws(
    () => buildExpiredActiveDirtyScopeExpansionRecoverySourceEvidence(originDrift),
    /origin/u,
  );
  const ledgerDrift = sourceInput();
  ledgerDrift.cloud.ledgerRepository = "another/collaboration-ledger";
  assert.throws(
    () => buildExpiredActiveDirtyScopeExpansionRecoverySourceEvidence(ledgerDrift),
    /identities do not join/u,
  );
  const reviewDrift = sourceInput();
  reviewDrift.cloud.claim.reviewRequestId = "github-pull-request:PR_OTHER";
  reviewDrift.lease.cloudAuthority.reviewRequestId = reviewDrift.cloud.claim.reviewRequestId;
  reviewDrift.leaseDigest = writerLeaseDigest(reviewDrift.lease);
  reviewDrift.pullRequest.markerLeaseDigest = reviewDrift.leaseDigest;
  assert.throws(
    () => buildExpiredActiveDirtyScopeExpansionRecoverySourceEvidence(reviewDrift),
    /identities do not join/u,
  );
  const overlap = sourceInput();
  overlap.cloud.peers.push(peerClaim({
    state: "current", recordedState: "current", writeAuthority: true,
    scopeReserved: true, declaredWriteScope: ["path:scripts"],
    writeSetDigest: digestValue(["path:scripts"]),
  }));
  assert.throws(
    () => buildExpiredActiveDirtyScopeExpansionRecoverySourceEvidence(overlap),
    /reserves overlapping/u,
  );
  const incompletePeer = sourceInput();
  const incomplete = peerClaim();
  delete incomplete.actorId;
  incompletePeer.cloud.peers.push(incomplete);
  assert.throws(
    () => buildExpiredActiveDirtyScopeExpansionRecoverySourceEvidence(incompletePeer),
    /record is incomplete/u,
  );
  const peerRecordDrift = sourceInput();
  const driftedPeer = peerClaim();
  driftedPeer.sessionId = "another-session";
  peerRecordDrift.cloud.peers.push(driftedPeer);
  assert.throws(
    () => buildExpiredActiveDirtyScopeExpansionRecoverySourceEvidence(peerRecordDrift),
    /record digest drifted/u,
  );
  assert.throws(
    () => buildExpiredActiveDirtyScopeExpansionRecoverySourceEvidence({
      ...sourceInput(), scopeExpansionIntent: { status: "intent" },
    }),
    /must be absent/u,
  );
  const dirtDrift = sourceInput();
  dirtDrift.dirt.pathCount = 1;
  assert.throws(
    () => buildExpiredActiveDirtyScopeExpansionRecoverySourceEvidence(dirtDrift),
    /tracked dirty bytes/u,
  );
});

test("phase evidence is auth-bound, monotonic, and stable after later phases", () => {
  const sourceEvidence = buildExpiredActiveDirtyScopeExpansionRecoverySourceEvidence(sourceInput());
  const { planDigest, authorizationDigest } = recoveredLive();
  const plan = { planDigest, sourceEvidenceDigest: sourceEvidence.sourceEvidenceDigest, sourceEvidence };
  const intent = { planDigest, authorizationDigest };
  const pendingKey = expiredActiveDirtyScopeExpansionRecoveryOperationKey(
    plan, authorizationDigest, "cloud-recovered",
  );
  const pending = buildExpiredActiveDirtyScopeExpansionRecoveryPhaseObservation({
    plan, intent, phase: "cloud-recovered", operationKey: pendingKey,
    live: { ...sourceInput(), mutationAuthority: null },
  });
  assert.deepEqual(pending, { state: "pending" });

  const recovered = recoveredLive();
  const cloudObservation = buildExpiredActiveDirtyScopeExpansionRecoveryPhaseObservation({
    plan, intent, phase: "cloud-recovered", operationKey: pendingKey, live: recovered.live,
  });
  const classified = classifyExpiredActiveDirtyScopeExpansionRecoveryPhase(
    cloudObservation,
    { planDigest, phase: "cloud-recovered", operationKey: pendingKey },
  );
  assert.equal(classified.state, "complete");
  assert.equal(
    normalizeExpiredActiveDirtyScopeExpansionRecoveryPhaseObservation(
      cloudObservation,
      { planDigest, phase: "cloud-recovered", operationKey: pendingKey },
    ).observationDigest,
    cloudObservation.observationDigest,
  );
  assert.throws(
    () => normalizeExpiredActiveDirtyScopeExpansionRecoveryPhaseObservation(
      { ...cloudObservation, ignored: true },
      { planDigest, phase: "cloud-recovered", operationKey: pendingKey },
    ),
    /fields are not exact/u,
  );
  assert.throws(
    () => normalizeExpiredActiveDirtyScopeExpansionRecoveryPhaseObservation(
      { ...cloudObservation, values: { ...cloudObservation.values, ignored: true } },
      { planDigest, phase: "cloud-recovered", operationKey: pendingKey },
    ),
    /fields are not exact/u,
  );

  const later = recoveredLive({ local: true, projected: true, complete: true });
  const laterCloud = buildExpiredActiveDirtyScopeExpansionRecoveryPhaseObservation({
    plan, intent, phase: "cloud-recovered", operationKey: pendingKey, live: later.live,
  });
  assert.equal(laterCloud.observationDigest, cloudObservation.observationDigest);
  for (const phase of ["local-rebound", "pr-projected", "complete"]) {
    const operationKey = expiredActiveDirtyScopeExpansionRecoveryOperationKey(
      plan, authorizationDigest, phase,
    );
    const observation = buildExpiredActiveDirtyScopeExpansionRecoveryPhaseObservation({
      plan, intent, phase, operationKey, live: later.live,
    });
    assert.equal(observation.state, "complete");
  }
});

test("phase evidence rejects byte, peer, and recovery counter drift", () => {
  const sourceEvidence = buildExpiredActiveDirtyScopeExpansionRecoverySourceEvidence(sourceInput());
  const recovered = recoveredLive();
  const plan = {
    planDigest: recovered.planDigest,
    sourceEvidenceDigest: sourceEvidence.sourceEvidenceDigest,
    sourceEvidence,
  };
  const intent = { planDigest: recovered.planDigest, authorizationDigest: recovered.authorizationDigest };
  const operationKey = expiredActiveDirtyScopeExpansionRecoveryOperationKey(
    plan, recovered.authorizationDigest, "cloud-recovered",
  );
  const byteDrift = structuredClone(recovered.live);
  byteDrift.dirt.ownedDirtDigest = digest("changed-owned-dirt");
  assert.throws(
    () => buildExpiredActiveDirtyScopeExpansionRecoveryPhaseObservation({
      plan, intent, phase: "cloud-recovered", operationKey, live: byteDrift,
    }),
    /changed source bytes/u,
  );
  for (const [field, changed] of [
    ["headRefName", "agent/other/branch"],
    ["baseRepository", "other/repository"],
    ["baseRefOid", sha("changed base")],
  ]) {
    const pullRequestDrift = structuredClone(recovered.live);
    pullRequestDrift.pullRequest[field] = changed;
    assert.throws(
      () => buildExpiredActiveDirtyScopeExpansionRecoveryPhaseObservation({
        plan, intent, phase: "cloud-recovered", operationKey, live: pullRequestDrift,
      }),
      /changed source bytes/u,
    );
  }
  const mirrorLedger = structuredClone(recovered.live);
  mirrorLedger.cloud.ledgerRepository = "another/collaboration-ledger";
  assert.throws(
    () => buildExpiredActiveDirtyScopeExpansionRecoveryPhaseObservation({
      plan, intent, phase: "cloud-recovered", operationKey, live: mirrorLedger,
    }),
    /claim inventory changed/u,
  );
  const counterDrift = structuredClone(recovered.live);
  counterDrift.cloud.claim.heartbeatCounter += 1;
  assert.throws(
    () => buildExpiredActiveDirtyScopeExpansionRecoveryPhaseObservation({
      plan, intent, phase: "cloud-recovered", operationKey, live: counterDrift,
    }),
    /same-owner source identity/u,
  );
  const keyDrift = digest("wrong-operation");
  assert.throws(
    () => buildExpiredActiveDirtyScopeExpansionRecoveryPhaseObservation({
      plan, intent, phase: "cloud-recovered", operationKey: keyDrift, live: recovered.live,
    }),
    /operation identity drifted/u,
  );
  const leaseDrift = recoveredLive({ local: true });
  leaseDrift.live.lease.autoDelivery = true;
  leaseDrift.live.leaseDigest = writerLeaseDigest(leaseDrift.live.lease);
  const localKey = expiredActiveDirtyScopeExpansionRecoveryOperationKey(
    plan, recovered.authorizationDigest, "local-rebound",
  );
  assert.throws(
    () => buildExpiredActiveDirtyScopeExpansionRecoveryPhaseObservation({
      plan, intent, phase: "local-rebound", operationKey: localKey, live: leaseDrift.live,
    }),
    /does not rebind the exact cloud claim/u,
  );
});
