// Responsibility: Prove frozen source joins, one-heartbeat lineage, and terminal observations.
import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCloudTransition,
  listCurrentClaims,
} from "../scripts/cloud-collaboration-contract.mjs";
import {
  createEmptyLedger,
  digestValue,
} from "../scripts/cloud-collaboration-primitives.mjs";
import { projectPublicClaim, pseudonymousIdentifier }
  from "../scripts/github-cloud-collaboration-mapping.mjs";
import {
  buildActiveDirtyScopeExpansionIntentRecoverySourceEvidence,
  buildActiveDirtyScopeExpansionIntentRecoveryTerminalObservation,
  classifyActiveDirtyScopeExpansionIntentRecoveryTerminal,
  normalizeActiveDirtyScopeExpansionIntentRecoverySourceEvidence,
  normalizeActiveDirtyScopeExpansionIntentRecoveryTerminalObservation,
  verifyExactScopeExpansionHeartbeatSuffix,
} from "../scripts/active-dirty-scope-expansion-intent-recovery-evidence.mjs";
import { projectWriterLeasePullRequestMarker }
  from "../scripts/writer-lease-lib.mjs";
import { writerLeaseDigest }
  from "../scripts/writer-lease-registry-cas.mjs";

const T0 = "2026-08-12T00:00:00.000Z";
const T1 = "2026-08-12T00:10:00.000Z";
const T2 = "2026-08-12T00:20:00.000Z";
const T3 = "2026-08-12T00:30:00.000Z";
const T4 = "2026-08-12T01:30:00.000Z";
const OBSERVED = "2026-08-12T00:31:00.000Z";
const BRANCH = "agent/device/scope-recovery";
const SCOPE = "scope-recovery";
const REVIEW = "github-pull-request:PR_node";
const REPOSITORY = {
  repositoryId: "github-repository:R_acos",
  canonicalRevision: sha("base"),
};

test("source evidence binds frozen C3 intent to joined local/cloud/PR C4", () => {
  const fixture = recoveryFixture();
  const source = buildActiveDirtyScopeExpansionIntentRecoverySourceEvidence(
    fixture.sourceInput,
  );
  assert.deepEqual(
    normalizeActiveDirtyScopeExpansionIntentRecoverySourceEvidence(source),
    source,
  );
  assert.equal(source.scopeExpansionIntent.boundAuthority.transitionCounter, 3);
  assert.equal(source.currentAuthority.transitionCounter, 4);
  assert.equal(source.ledgerLineage.currentHeartbeatCounter, 1);
  assert.equal(source.pullRequest.markerDigest, digestValue(source.pullRequest.marker));

  const projectedManifest = structuredClone(fixture.sourceInput);
  projectedManifest.targetManifest = {
    schema: source.targetManifest.schema,
    semanticScope: source.targetManifest.semanticScope,
    declaredWriteSet: source.targetManifest.declaredWriteSet,
    writeSetDigest: source.targetManifest.writeSetDigest,
    manifestDigest: source.targetManifest.manifestDigest,
  };
  assert.equal(
    buildActiveDirtyScopeExpansionIntentRecoverySourceEvidence(projectedManifest)
      .targetManifest.manifestDigest,
    source.targetManifest.manifestDigest,
  );

  const changedIntent = structuredClone(fixture.sourceInput);
  changedIntent.scopeExpansionIntent.boundAuthority =
    changedIntent.currentAuthority;
  assert.throws(
    () => buildActiveDirtyScopeExpansionIntentRecoverySourceEvidence(changedIntent),
    /intent digest drifted|historical|exact local\/cloud\/PR join/u,
  );

  const changedMarker = structuredClone(fixture.sourceInput);
  changedMarker.pullRequest.marker.heartbeatAt = T0;
  changedMarker.pullRequest.markerDigest = digestValue(changedMarker.pullRequest.marker);
  assert.throws(
    () => buildActiveDirtyScopeExpansionIntentRecoverySourceEvidence(changedMarker),
    /exact local\/cloud\/PR join/u,
  );
});

test("heartbeat verifier admits one exact target renewal and unrelated suffix only", () => {
  const fixture = recoveryFixture();
  const lineage = verifyExactScopeExpansionHeartbeatSuffix({
    historicalLedger: fixture.historicalLedger,
    currentLedger: fixture.currentLedger,
    boundAuthority: fixture.boundAuthority,
    currentClaim: fixture.currentClaim,
  });
  assert.equal(lineage.historicalTransitionCounter, 3);
  assert.equal(lineage.currentTransitionCounter, 4);
  assert.equal(lineage.currentHeartbeatCounter, 1);

  const forgedPhase = structuredClone(fixture.historicalSuccessors);
  forgedPhase.targetReviewRequestId = "github-pull-request:forged";
  assert.throws(
    () => verifyExactScopeExpansionHeartbeatSuffix({
      historicalLedger: fixture.historicalLedger,
      currentLedger: fixture.currentLedger,
      boundAuthority: fixture.boundAuthority,
      currentClaim: fixture.currentClaim,
      historicalSuccessors: forgedPhase,
    }),
    /C3 successor phase/u,
  );

  const twice = continueClaim(
    fixture.currentLedger,
    fixture.currentClaim,
    { time: "2026-08-12T00:40:00.000Z", expiresAt: "2026-08-12T02:00:00.000Z" },
  );
  const twiceClaim = listCurrentClaims(twice.ledger, "2026-08-12T00:41:00.000Z", {
    repositoryId: REPOSITORY.repositoryId,
  })[0];
  assert.throws(
    () => verifyExactScopeExpansionHeartbeatSuffix({
      historicalLedger: fixture.historicalLedger,
      currentLedger: twice.ledger,
      boundAuthority: fixture.boundAuthority,
      currentClaim: twiceClaim,
    }),
    /exactly one target heartbeat/u,
  );

  const nonPrefix = structuredClone(fixture.currentLedger);
  nonPrefix.entries[0].requestDigest = digest("forged prefix");
  assert.throws(
    () => verifyExactScopeExpansionHeartbeatSuffix({
      historicalLedger: fixture.historicalLedger,
      currentLedger: nonPrefix,
      boundAuthority: fixture.boundAuthority,
      currentClaim: fixture.currentClaim,
    }),
    /Current ledger is invalid|historical prefix/u,
  );

});

test("terminal observation seals current C4 evidence and recovered original intent", () => {
  const fixture = recoveryFixture();
  const sourceEvidence = buildActiveDirtyScopeExpansionIntentRecoverySourceEvidence(
    fixture.sourceInput,
  );
  const planCore = {
    schema: "agentic-active-dirty-scope-expansion-intent-recovery-plan/v1",
    operation: "active-dirty-scope-expansion-intent-recovery",
    sourceEvidence,
    sourceEvidenceDigest: sourceEvidence.sourceEvidenceDigest,
  };
  const planDigest = digestValue(planCore);
  const plan = {
    ...planCore,
    planDigest,
    exactAuthorization:
      `authorize active-dirty-scope-expansion-intent-recovery ${planDigest}`,
  };
  const operationKey = digest("operation");
  const recovered = terminalIntent(fixture.sourceIntent, fixture);
  const observation = buildActiveDirtyScopeExpansionIntentRecoveryTerminalObservation({
    plan,
    operationKey,
    recoveredScopeExpansionIntent: recovered,
  });
  assert.deepEqual(
    normalizeActiveDirtyScopeExpansionIntentRecoveryTerminalObservation(
      observation,
      {
        planDigest,
        operationKey,
        sourceEvidenceDigest: sourceEvidence.sourceEvidenceDigest,
        sourceEvidence,
      },
    ),
    observation,
  );
  assert.equal(
    classifyActiveDirtyScopeExpansionIntentRecoveryTerminal(observation, {
      planDigest,
      operationKey,
      sourceEvidenceDigest: sourceEvidence.sourceEvidenceDigest,
      sourceEvidence,
    }).state,
    "complete",
  );
  assert.deepEqual(
    classifyActiveDirtyScopeExpansionIntentRecoveryTerminal(null),
    { state: "pending", observation: null },
  );
  const forged = { ...observation, currentAuthorityDigest: digest("forged") };
  delete forged.observationDigest;
  forged.observationDigest = digestValue(forged);
  assert.throws(
    () => normalizeActiveDirtyScopeExpansionIntentRecoveryTerminalObservation(
      forged,
      {
        planDigest,
        operationKey,
        sourceEvidenceDigest: sourceEvidence.sourceEvidenceDigest,
        sourceEvidence,
      },
    ),
    /observation drifted/u,
  );
});

export function recoveryFixture() {
  const actor = { actorId: "github-user:42", deviceId: pseudonymousIdentifier("device", "device-a"),
    sessionId: pseudonymousIdentifier("session", "session-a") };
  const scope = ["path:scripts/one.mjs", "path:scripts/two.mjs", `semantic:${SCOPE}`];
  let ledger = createEmptyLedger("github-repository:ledger");
  const sourceActor = { actorId: "github-user:source", deviceId: "device-source", sessionId: "session-source" };
  const source = mutate(ledger, "claim", sourceActor, "2026-08-11T23:50:00.000Z", {
    workItemId: pseudonymousIdentifier("work-item", "source-scope-recovery"),
    canonicalBaseRevision: REPOSITORY.canonicalRevision,
    declaredWriteScope: [`semantic:${SCOPE}`], laneRevision: sha("head"),
    leaseEpoch: 1, expiresAt: "2026-08-12T01:00:00.000Z",
    idempotencyKey: "claim-source",
  });
  ledger = source.ledger;
  const claimed = mutate(ledger, "claim", actor, T0, {
    workItemId: pseudonymousIdentifier("work-item", SCOPE),
    canonicalBaseRevision: REPOSITORY.canonicalRevision,
    declaredWriteScope: scope,
    laneRevision: sha("head"),
    predecessorClaimId: source.claim.claimId,
    leaseEpoch: 1,
    expiresAt: "2026-08-12T01:00:00.000Z",
    idempotencyKey: "claim-target",
  });
  ledger = claimed.ledger;
  const retired = mutate(ledger, "retire", sourceActor, "2026-08-12T00:05:00.000Z", {
    claimId: source.claim.claimId,
    expectedFenceRevision: source.claim.fenceRevision,
    expectedTransitionCounter: source.claim.transitionCounter,
    reason: "superseded", finalRevision: source.claim.laneRevision,
    bytesDigest: digest("source bytes"), namedChecksDigest: digest("source checks"),
    handoffEvidenceDigest: digest("source handoff"), idempotencyKey: "retire-source",
  });
  ledger = retired.ledger;
  const projected = mutate(ledger, "continue", actor, T1, {
    claimId: claimed.claim.claimId,
    expectedFenceRevision: claimed.claim.fenceRevision,
    expectedTransitionCounter: claimed.claim.transitionCounter,
    mode: "promote", expiresAt: "2026-08-12T01:00:00.000Z",
    idempotencyKey: "project-target-1",
  });
  ledger = projected.ledger;
  const bound = mutate(ledger, "continue", actor, T2, {
    claimId: projected.claim.claimId,
    expectedFenceRevision: projected.claim.fenceRevision,
    expectedTransitionCounter: projected.claim.transitionCounter,
    mode: "projection",
    laneRevision: sha("head"),
    reviewRequestId: REVIEW,
    idempotencyKey: "project-target-2",
  });
  const historicalLedger = bound.ledger;
  const boundAuthority = authorityFromClaim(bound.claim, historicalLedger, "session-a");
  const historicalSuccessors = {
    waiting: successorReceipt(claimed),
    promoted: successorReceipt(projected),
    bound: boundAuthority,
    sourceClaimId: source.claim.claimId,
    targetReviewRequestId: REVIEW,
  };
  const renewed = continueClaim(historicalLedger, bound.claim, {
    identity: actor,
    time: T3,
    expiresAt: T4,
  });
  const currentLedger = renewed.ledger;
  const currentClaim = listCurrentClaims(currentLedger, OBSERVED, {
    repositoryId: REPOSITORY.repositoryId,
  })[0];
  const currentAuthority = authorityFromClaim(currentClaim, currentLedger, "session-a");
  const ledgerLineage = verifyExactScopeExpansionHeartbeatSuffix({
    historicalLedger, currentLedger, boundAuthority, currentClaim, historicalSuccessors,
  });
  const targetManifest = {
    schema: "agentic-declared-write-scope/v1",
    semanticScope: SCOPE,
    paths: ["scripts/one.mjs", "scripts/two.mjs"],
  };
  const declaredWriteSet = scope.slice().sort();
  const manifestDigest = digestValue(targetManifest);
  const targetWriteSetDigest = digestValue(declaredWriteSet);
  const planCore = {
    schema: "agentic-active-dirty-scope-expansion-plan/v1",
    sourceBranch: BRANCH,
    sourceFenceSha: sha("head"),
    sourceLeaseDigest: digest("old lease"),
    sourceClaimId: source.claim.claimId,
    sourceClaimDigest: digest("old claim fence"),
    sourceClaimTransitionCounter: 8,
    sourceReviewRequestId: REVIEW,
    sourceWriteSetDigest: digest("old write set"),
    sourceManifestDigest: digest("old manifest"),
    sourceDirtyDigest: digest("dirty"),
    sourceChangedPaths: ["scripts/one.mjs"],
    targetCanonicalBaseSha: REPOSITORY.canonicalRevision,
    targetManifestDigest: manifestDigest,
    targetWriteSetDigest,
    targetDeclaredWriteSet: declaredWriteSet,
    targetCloudLeaseEpoch: 1,
  };
  const planSnapshot = { ...planCore, planDigest: digestValue(planCore) };
  const sourceIntent = {
    schema: "agentic-active-dirty-scope-expansion-intent/v1",
    status: "successor-bound",
    branch: BRANCH,
    sourceLeaseDigest: planSnapshot.sourceLeaseDigest,
    sourceClaimId: planSnapshot.sourceClaimId,
    sourceFenceSha: planSnapshot.sourceFenceSha,
    targetWriteSetDigest,
    targetManifestDigest: manifestDigest,
    planDigest: planSnapshot.planDigest,
    targetClaimId: bound.claim.claimId,
    targetClaimDigest: bound.claim.fenceRevision,
    targetLeaseEpoch: 1,
    targetCanonicalBaseSha: REPOSITORY.canonicalRevision,
    targetReviewRequestId: REVIEW,
    completedReceiptDigest: null,
    waiting: successorReceipt(claimed),
    waitingReceiptDigest: digest("waiting receipt"),
    sourceRetirementReceiptDigest: digest("retirement receipt"),
    promoted: successorReceipt(projected),
    promotedReceiptDigest: digest("promoted receipt"),
    boundAuthority,
    boundReceiptDigest: digest("bound receipt"),
    localProjection: null,
    localProjectionReceiptDigest: null,
    pullRequestProjection: null,
    pullRequestProjectionReceiptDigest: null,
    finalReceiptDigest: null,
    planSnapshot,
  };
  const admission = {
    schema: "agentic-lane-admission-lease/v1",
    status: "admitted",
    semanticScope: SCOPE,
    declaredWriteSet,
    writeSetDigest: targetWriteSetDigest,
    manifestDigest,
    planReceiptDigest: planSnapshot.planDigest,
    admissionReceiptDigest: digest("admission receipt"),
    existingLaneStateDigest: digest("lane state"),
    admittedReportDigest: digest("admitted report"),
    preservationReceiptDigest: digest("preservation receipt"),
  };
  const lease = {
    schema: "agentic-writer-lease/v2", status: "active", epoch: 4,
    sessionId: "session-a", device: "device-a", scope: SCOPE, branch: BRANCH,
    baseSha: REPOSITORY.canonicalRevision, fenceSha: sha("head"),
    autoDelivery: false, runtimeRequired: false, heartbeatAt: T3, expiresAt: T4,
    worktreePath: "/tmp/scope-recovery", pullRequestUrl: "https://github.com/o/r/pull/440",
    admission, cloudAuthority: currentAuthority,
  };
  const marker = projectWriterLeasePullRequestMarker(lease);
  const mutationCore = {
    schema: "agentic-active-dirty-scope-expansion-intent-recovery-mutation-authority/v1",
    status: "ready",
    claimId: currentAuthority.claimId, claimDigest: currentAuthority.claimDigest,
    claimLedgerRevision: currentAuthority.claimLedgerRevision,
    localAuthorityDigest: digestValue(currentAuthority),
    localLeaseDigest: writerLeaseDigest(lease), localLeaseEpoch: lease.epoch,
    localFenceSha: lease.fenceSha, globalLedgerRevision: currentAuthority.ledgerRevision,
    globalLedgerDigest: currentAuthority.ledgerDigest,
    currentClaimDigest: digestValue(projectPublicClaim(currentClaim)),
    currentClaimInventoryDigest: digest("current inventory"),
    cloudVerificationReceiptDigest: digest("cloud verification"),
    evaluatedAt: OBSERVED, expiresAt: T4,
  };
  const mutationAuthority = { ...mutationCore, receiptDigest: digestValue(mutationCore) };
  const sourceInput = {
    controller: {
      path: "/tmp/controller", origin: "https://github.com/o/r.git",
      targetRepository: "o/r", headSha: sha("main"), originMainSha: sha("main"),
      remoteMainSha: sha("main"), treeSha: sha("main tree"), clean: true,
      implementationDigest: digest("implementation"),
    },
    lane: {
      path: "/tmp/scope-recovery", branch: BRANCH, headSha: sha("head"),
      remoteHeadSha: sha("head"), dirty: true,
      changedPaths: ["scripts/one.mjs"], untrackedPaths: [], dirtyDigest: digest("dirty"),
    },
    lease, leaseDigest: writerLeaseDigest(lease), scopeExpansionIntent: sourceIntent,
    scopeExpansionIntentDigest: digestValue(sourceIntent), targetManifest,
    currentAuthority, currentClaim, ledgerLineage,
    pullRequest: {
      number: 440, nodeId: "PR_node", url: lease.pullRequestUrl,
      state: "OPEN", isDraft: true, baseRepository: "o/r", baseRefName: "main",
      baseRefOid: sha("main"), headRepository: "o/r", headRefName: BRANCH,
      headRefOid: sha("head"), marker, markerDigest: digestValue(marker),
      bodyDigest: digest("PR body"),
    },
    dirt: { changedPaths: ["scripts/one.mjs"], untrackedPaths: [], dirtyDigest: digest("dirty") },
    mutationAuthority,
  };
  return {
    sourceInput, sourceIntent, historicalLedger, currentLedger, currentClaim,
    currentAuthority, boundAuthority, mutationAuthority, historicalSuccessors,
  };
}

function terminalIntent(source, fixture) {
  const markerDigest = fixture.sourceInput.pullRequest.markerDigest;
  const mutationDigest = fixture.mutationAuthority.receiptDigest;
  const pullRequestProjectionReceiptDigest = digestValue({
    schema: "agentic-active-dirty-scope-expansion-pr-projection/v1",
    planDigest: source.planDigest,
    pullRequestUrl: fixture.sourceInput.pullRequest.url,
    markerDigest,
  });
  const finalReceiptDigest = digestValue({
    schema: "agentic-active-dirty-scope-expansion-complete/v1",
    planDigest: source.planDigest,
    mutationAuthorityReceiptDigest: mutationDigest,
    pullRequestMarkerDigest: markerDigest,
  });
  return {
    ...source,
    status: "complete",
    localProjection: {
      leaseDigest: fixture.sourceInput.leaseDigest,
      claimId: fixture.currentAuthority.claimId,
      receiptDigest: mutationDigest,
    },
    localProjectionReceiptDigest: mutationDigest,
    pullRequestProjection: { markerDigest },
    pullRequestProjectionReceiptDigest,
    finalReceiptDigest,
  };
}

function authorityFromClaim(claim, ledger, sessionId) {
  const entry = ledger.entries.findLast(candidate => candidate.claimId === claim.claimId);
  return {
    schema: "agentic-lane-cloud-authority/v1", provider: "github",
    ledgerRepository: "o/ledger", targetRepository: "o/r",
    claimId: claim.claimId, claimDigest: claim.fenceRevision,
    ledgerRevision: sha(`ledger-${ledger.sequence}`), ledgerDigest: ledger.headDigest,
    claimLedgerRevision: claim.transitionDigest ?? entry.digest,
    canonicalBaseSha: claim.canonicalBaseRevision,
    laneRevision: claim.laneRevision, cloudDeclaredWriteScope: claim.declaredWriteScope,
    writeSetDigest: claim.writeSetDigest, deviceId: "device-a", sessionId,
    reviewRequestId: REVIEW, leaseEpoch: claim.leaseEpoch,
    transitionCounter: claim.transitionCounter, heartbeatCounter: claim.heartbeatCounter,
    state: "active", expiresAt: claim.expiresAt,
    entrySchema: claim.entrySchema, claimIdentitySchema: claim.claimIdentitySchema,
    operationReceiptDigest: claim.operationReceiptDigest,
    integrationReceiptDigest: null, integration: null,
    manifestDigest: digestValue({ schema: "agentic-declared-write-scope/v1",
      semanticScope: SCOPE, paths: ["scripts/one.mjs", "scripts/two.mjs"] }),
  };
}

function successorReceipt(result) {
  return { claimId: result.claim.claimId, claimDigest: result.claim.fenceRevision,
    ledgerRevision: sha(`ledger-${result.ledger.sequence}`),
    claimLedgerRevision: result.claim.transitionDigest ?? result.claim.ledgerRevision,
    transitionCounter: result.claim.transitionCounter, expiresAt: result.claim.expiresAt };
}

function continueClaim(ledger, claim, {
  identity = { actorId: "github-user:42", deviceId: pseudonymousIdentifier("device", "device-a"),
    sessionId: pseudonymousIdentifier("session", "session-a") },
  time,
  expiresAt,
}) {
  return mutate(ledger, "continue", identity, time, {
    claimId: claim.claimId, expectedFenceRevision: claim.fenceRevision,
    expectedTransitionCounter: claim.transitionCounter, mode: "renewal", expiresAt,
    idempotencyKey: `renew-${claim.transitionCounter}`,
  });
}

function mutate(ledger, action, actor, evaluationTime, request) {
  return applyCloudTransition({
    ledger, action, actor, repository: REPOSITORY, evaluationTime,
    request: { ...request, expectedLedgerDigest: ledger.headDigest },
  });
}

function digest(label) { return digestValue({ label }); }
function sha(label) { return digest(label).slice(0, 40); }
