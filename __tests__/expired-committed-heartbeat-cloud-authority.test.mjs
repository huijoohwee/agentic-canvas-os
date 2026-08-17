// Responsibility: Prove exact current renewal and dormant recovery selection and replay.
import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCloudTransition,
  createEmptyLedger,
  digestValue,
} from "../scripts/cloud-collaboration-contract.mjs";
import {
  continueExpiredCommittedHeartbeatCloudAuthority,
  expiredCommittedCloudRecoveryEvidenceDigest,
  preserveSourceManifestProjection,
} from "../scripts/expired-committed-heartbeat-cloud-authority.mjs";
import { resolveExpiredCommittedRecoveryReplayEvidenceChain } from
  "../scripts/expired-committed-heartbeat-replay-evidence.mjs";

const digest = character => character.repeat(64);
const sha = character => character.repeat(40);
const declaredWriteSet = [
  "path:scripts/recovery.mjs",
  "semantic:expired-committed-recovery",
];
const manifest = {
  manifestDigest: digest("1"),
  declaredWriteSet,
  writeSetDigest: digestValue(declaredWriteSet),
};
const evidenceDigest = expiredCommittedCloudRecoveryEvidenceDigest({
  snapshotDigest: digest("2"),
  recoveryEvidence: {
    sourceClaimId: digest("a"),
    headSha: sha("c"),
    rangeDiffDigest: digest("3"),
  },
});

test("an exact current claim uses ordinary renewal only", () => {
  const source = authority();
  let renewals = 0;
  let recoveries = 0;
  const result = continueExpiredCommittedHeartbeatCloudAuthority({
    ...common(source, currentClaim(source)),
    renew: input => {
      renewals += 1;
      assert.equal(input.authority, source);
      return verifiedResult(renewedAuthority(source), 10);
    },
    invoke: () => {
      recoveries += 1;
      throw new Error("current authority must not recover");
    },
  });
  assert.equal(renewals, 1);
  assert.equal(recoveries, 0);
  assert.equal(result.authority.transitionCounter, 12);
  assert.equal(result.authority.heartbeatCounter, 10);
});

test("an exact dormant claim uses authenticated recovery and seals its operation receipt", () => {
  const source = authority();
  let request = null;
  const result = continueExpiredCommittedHeartbeatCloudAuthority({
    ...common(source, dormantClaim(source)),
    invoke: input => {
      request = input.request;
      return recoveryResult(source, { replayed: false });
    },
    renew: () => {
      throw new Error("dormant authority must not renew");
    },
    verify: ({ authority: projected }) => verifiedResult(projected, 9),
  });
  assert.equal(request.mode, "recovery");
  assert.equal(request.expectedFenceRevision, source.claimDigest);
  assert.equal(request.expectedTransitionCounter, 11);
  assert.equal(request.recoveryEvidenceDigest, evidenceDigest);
  assert.equal(request.deviceId, source.deviceId);
  assert.equal(request.sessionId, source.sessionId);
  assert.equal(result.authority.transitionCounter, 12);
  assert.equal(result.authority.heartbeatCounter, 9);
});

test("a lost dormant-recovery response replays the exact key before fresh renewal", () => {
  const source = authority();
  const advanced = { ...recoveryClaim(source), state: "dormant-preserved",
    writeAuthority: false };
  let recoveries = 0;
  let resolutions = 0;
  const result = continueExpiredCommittedHeartbeatCloudAuthority({
    ...common(source, advanced),
    recoveryEvidenceDigest: digest("2"),
    resolveReplayEvidenceChain: input => {
      resolutions += 1;
      assert.equal(input.source, source);
      assert.equal(input.liveClaim, advanced);
      return [evidenceDigest];
    },
    invoke: input => {
      recoveries += 1;
      assert.equal(input.request.mode, "recovery");
      if (recoveries === 1) return recoveryResult(source, { replayed: true });
      const intermediate = { ...source, claimDigest: digest("b"),
        claimLedgerRevision: digest("c"), operationReceiptDigest: digest("d"),
        transitionCounter: 12 };
      return recoveryResult(intermediate, { replayed: false,
        recoveryEvidence: digest("2"),
        claimOverride: publicClaim(intermediate, { state: "current",
          writeAuthority: true, scopeReserved: true, transitionCounter: 13,
          heartbeatCounter: 9, fenceRevision: digest("5"),
          transitionDigest: digest("6"), operationReceiptDigest: digest("7") }) });
    },
    renew: () => {
      throw new Error("recovered authority must replay recovery, not renew");
    },
    verify: ({ authority: projected }) => verifiedResult(projected, 9),
  });
  assert.equal(recoveries, 2);
  assert.equal(resolutions, 1);
  assert.equal(result.authority.claimDigest, digest("5"));
  assert.equal(result.authority.heartbeatCounter, 9);
});

test("an expired replay transition recovers once more from current evidence", () => {
  const source = authority();
  const advanced = { ...recoveryClaim(source), state: "dormant-preserved",
    writeAuthority: false, expiresAt: "2026-08-12T09:00:00.000Z" };
  const currentEvidence = digest("2");
  let recoveries = 0;
  const result = continueExpiredCommittedHeartbeatCloudAuthority({
    ...common(source, advanced),
    recoveryEvidenceDigest: currentEvidence,
    resolveReplayEvidenceChain: () => [evidenceDigest],
    invoke: input => {
      recoveries += 1;
      if (recoveries === 1) {
        assert.equal(input.request.recoveryEvidenceDigest, evidenceDigest);
        return recoveryResult(source, { replayed: true,
          findings: null,
          expiresAt: "2026-08-12T09:00:00.000Z",
          claimOverride: { ...recoveryClaim(source), state: "dormant-preserved",
            writeAuthority: false, expiresAt: "2026-08-12T09:00:00.000Z" } });
      }
      assert.equal(input.request.expectedFenceRevision, digest("b"));
      assert.equal(input.request.expectedTransitionCounter, 12);
      assert.equal(input.request.recoveryEvidenceDigest, currentEvidence);
      const intermediate = { ...source, claimDigest: digest("b"),
        claimLedgerRevision: digest("c"), operationReceiptDigest: digest("d"),
        transitionCounter: 12, expiresAt: "2026-08-12T09:00:00.000Z" };
      return recoveryResult(intermediate, { replayed: false,
        recoveryEvidence: currentEvidence,
        claimOverride: publicClaim(intermediate, { state: "current",
          writeAuthority: true, scopeReserved: true, transitionCounter: 13,
          heartbeatCounter: 9, fenceRevision: digest("5"),
          transitionDigest: digest("6"), operationReceiptDigest: digest("7"),
          expiresAt: "2099-08-12T10:00:00.000Z" }) });
    },
    renew: () => { throw new Error("recovery chain must not renew"); },
    verify: ({ authority: projected }) => verifiedResult(projected, 9),
  });
  assert.equal(recoveries, 2);
  assert.equal(result.authority.transitionCounter, 13);
  assert.equal(result.authority.claimDigest, digest("5"));
});

test("a lost ordinary-renewal response replays renewal without a recovery call", () => {
  const source = authority();
  const advanced = renewalClaim(source);
  let renewals = 0;
  let recoveries = 0;
  const result = continueExpiredCommittedHeartbeatCloudAuthority({
    ...common(source, advanced),
    invoke: () => {
      recoveries += 1;
      throw new Error("heartbeat counters make recovery replay unambiguous");
    },
    renew: () => {
      renewals += 1;
      return verifiedResult(renewedAuthority(source), 10);
    },
  });
  assert.equal(renewals, 1);
  assert.equal(recoveries, 0);
  assert.equal(result.authority.heartbeatCounter, 10);
});

test("claim drift and unknown extra transitions fail before either continuation", () => {
  const source = authority();
  for (const claim of [
    { ...dormantClaim(source), laneRevision: sha("9") },
    { ...currentClaim(source), transitionCounter: 13 },
    { ...currentClaim(source), scopeReserved: false },
  ]) {
    let mutations = 0;
    assert.throws(() => continueExpiredCommittedHeartbeatCloudAuthority({
      ...common(source, claim),
      invoke: () => {
        mutations += 1;
      },
      renew: () => {
        mutations += 1;
      },
    }), /drifted from the expired committed recovery subject/u);
    assert.equal(mutations, 0);
  }
});

test("ambiguous response loss probes only exact replay keys and rejects foreign progress", () => {
  const source = { ...authority() };
  delete source.heartbeatCounter;
  const advanced = { ...recoveryClaim(source) };
  delete advanced.heartbeatCounter;
  let recoveries = 0;
  let renewals = 0;
  assert.throws(() => continueExpiredCommittedHeartbeatCloudAuthority({
    ...common(source, advanced),
    resolveReplayEvidenceChain: () => [evidenceDigest],
    invoke: () => {
      recoveries += 1;
      throw new Error("expectedFenceRevision is stale");
    },
    renew: () => {
      renewals += 1;
      throw new Error("expectedTransitionCounter is stale");
    },
  }), /expectedTransitionCounter is stale/u);
  assert.equal(recoveries, 1);
  assert.equal(renewals, 1);
});

test("sealed ledger evidence resolves every ordered recovery key after snapshot drift", () => {
  const repository = { repositoryId: "repository:one",
    canonicalRevision: sha("a") };
  const actor = { actorId: "actor:one", deviceId: "device", sessionId: "session" };
  const claimed = applyCloudTransition({
    ledger: createEmptyLedger(repository), action: "claim", actor, repository,
    evaluationTime: "2026-08-12T09:00:00.000Z",
    request: { workItemId: "work:item", canonicalBaseRevision: sha("a"),
      declaredWriteScope: declaredWriteSet, laneRevision: sha("b"), leaseEpoch: 1,
      expiresAt: "2026-08-12T09:01:00.000Z", expectedLedgerDigest: null,
      idempotencyKey: "claim:one" },
  });
  const recovered = applyCloudTransition({
    ledger: claimed.ledger, action: "continue", actor, repository,
    evaluationTime: "2026-08-12T09:02:00.000Z",
    request: { claimId: claimed.claim.claimId,
      expectedFenceRevision: claimed.claim.fenceRevision,
      expectedTransitionCounter: claimed.claim.transitionCounter,
      expectedLedgerDigest: claimed.ledger.headDigest, mode: "recovery",
      expiresAt: "2026-08-12T09:03:00.000Z",
      recoveryEvidenceDigest: evidenceDigest, idempotencyKey: "recover:one" },
  });
  const laterEvidenceDigest = digest("4");
  const recoveredAgain = applyCloudTransition({
    ledger: recovered.ledger, action: "continue", actor, repository,
    evaluationTime: "2026-08-12T09:04:00.000Z",
    request: { claimId: recovered.claim.claimId,
      expectedFenceRevision: recovered.claim.fenceRevision,
      expectedTransitionCounter: recovered.claim.transitionCounter,
      expectedLedgerDigest: recovered.ledger.headDigest, mode: "recovery",
      expiresAt: "2026-08-12T09:05:00.000Z",
      recoveryEvidenceDigest: laterEvidenceDigest, idempotencyKey: "recover:two" },
  });
  const source = { ...authority(), claimId: claimed.claim.claimId,
    laneRevision: claimed.claim.laneRevision, leaseEpoch: claimed.claim.leaseEpoch,
    transitionCounter: claimed.claim.transitionCounter,
    heartbeatCounter: claimed.claim.heartbeatCounter,
    deviceId: actor.deviceId, sessionId: actor.sessionId, reviewRequestId: null };
  const liveClaim = { ...recoveredAgain.claim,
    transitionDigest: recoveredAgain.claim.ledgerRevision };
  const revision = sha("f");
  assert.deepEqual(resolveExpiredCommittedRecoveryReplayEvidenceChain({
    source, liveClaim,
    status: { ledgerRevision: revision, ledgerDigest: recoveredAgain.ledger.headDigest },
    readLedger: () => ({ ledger: recoveredAgain.ledger, revision }),
  }), [evidenceDigest, laterEvidenceDigest]);
  assert.throws(() => resolveExpiredCommittedRecoveryReplayEvidenceChain({
    source, liveClaim: { ...liveClaim, fenceRevision: digest("9") },
    status: { ledgerRevision: revision, ledgerDigest: recoveredAgain.ledger.headDigest },
    readLedger: () => ({ ledger: recoveredAgain.ledger, revision }),
  }), /does not match the live claim/u);
});

test("writer CAS projection preserves the source manifest transport identity", () => {
  const source = authority();
  assert.equal(preserveSourceManifestProjection(source, source), source);
  const projected = preserveSourceManifestProjection(source, {
    ...source,
    manifestDigest: digest("9"),
  });
  assert.equal(projected.manifestDigest, source.manifestDigest);
});

function common(source, liveClaim) {
  return {
    authority: source,
    manifest,
    recoveryEvidenceDigest: evidenceDigest,
    ttlSeconds: 1_800,
    inspect: () => ({
      schema: "agentic-cloud-collaboration-result/v1",
      ok: true,
      action: "status",
      status: "ready",
      claims: [liveClaim],
    }),
  };
}

function authority() {
  return {
    schema: "agentic-lane-cloud-authority/v1",
    provider: "github",
    ledgerRepository: "owner/ledger",
    targetRepository: "owner/repository",
    claimId: digest("a"),
    claimDigest: digest("4"),
    ledgerRevision: sha("4"),
    ledgerDigest: digest("5"),
    claimLedgerRevision: digest("6"),
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    operationReceiptDigest: digest("7"),
    mutationAuthorityEligible: true,
    canonicalBaseSha: sha("a"),
    laneRevision: sha("b"),
    cloudDeclaredWriteScope: declaredWriteSet,
    writeSetDigest: manifest.writeSetDigest,
    deviceId: "device",
    sessionId: "session",
    reviewRequestId: "github-pull-request:PR_1",
    leaseEpoch: 1,
    transitionCounter: 11,
    heartbeatCounter: 9,
    state: "active",
    expiresAt: "2099-08-12T09:00:00.000Z",
    integrationReceiptDigest: null,
    integration: null,
    manifestDigest: manifest.manifestDigest,
  };
}

function currentClaim(source) {
  return publicClaim(source, {
    state: "current",
    writeAuthority: true,
    scopeReserved: true,
  });
}

function dormantClaim(source) {
  return publicClaim(source, {
    state: "dormant-preserved",
    writeAuthority: false,
    scopeReserved: true,
  });
}

function renewalClaim(source) {
  return publicClaim(source, {
    state: "current",
    writeAuthority: true,
    scopeReserved: true,
    transitionCounter: source.transitionCounter + 1,
    heartbeatCounter: 10,
    fenceRevision: digest("8"),
    transitionDigest: digest("9"),
    operationReceiptDigest: digest("0"),
  });
}

function recoveryClaim(source) {
  return publicClaim(source, {
    state: "current",
    writeAuthority: true,
    scopeReserved: true,
    transitionCounter: source.transitionCounter + 1,
    heartbeatCounter: 9,
    fenceRevision: digest("b"),
    transitionDigest: digest("c"),
    operationReceiptDigest: digest("d"),
  });
}

function publicClaim(source, values) {
  return {
    claimId: source.claimId,
    entrySchema: source.entrySchema,
    claimIdentitySchema: source.claimIdentitySchema,
    canonicalBaseRevision: source.canonicalBaseSha,
    laneRevision: source.laneRevision,
    declaredWriteScope: declaredWriteSet,
    writeSetDigest: source.writeSetDigest,
    leaseEpoch: source.leaseEpoch,
    reviewRequestId: source.reviewRequestId,
    transitionCounter: source.transitionCounter,
    heartbeatCounter: source.heartbeatCounter,
    fenceRevision: source.claimDigest,
    transitionDigest: source.claimLedgerRevision,
    operationReceiptDigest: source.operationReceiptDigest,
    expiresAt: source.expiresAt,
    ...values,
  };
}

function recoveryResult(source, { replayed, expiresAt = null, findings = [],
  recoveryEvidence = evidenceDigest, claimOverride = null }) {
  const claim = claimOverride || { ...recoveryClaim(source),
    ...(expiresAt ? { expiresAt } : {}) };
  const operationKey = [
    "device-expired-committed-recovery",
    source.claimId,
    source.transitionCounter,
    source.claimDigest,
    recoveryEvidence,
  ].join(":");
  const operationReceipt = {
    schema: "agentic-collaboration-continuation-receipt/v1",
    operation: "continue",
    status: "current",
    repositoryId: "repository:opaque",
    claimId: source.claimId,
    claimDigest: claim.fenceRevision,
    fenceRevision: claim.fenceRevision,
    ledgerRevision: claim.transitionDigest,
    ledgerSequence: 12,
    idempotencyKey: digestValue(operationKey),
    requestDigest: digest("e"),
    evaluationTime: "2099-08-12T09:00:00.000Z",
    receiptDigest: claim.operationReceiptDigest,
  };
  return {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "continue",
    status: "current",
    replayed,
    attempts: 1,
    ledgerRevision: sha("c"),
    ledgerDigest: digest("f"),
    claim,
    claimDigest: claim.fenceRevision,
    findings,
    operationReceipt,
    receipt: { ledgerDigest: digest("f") },
  };
}

function renewedAuthority(source) {
  return {
    ...source,
    claimDigest: digest("8"),
    ledgerRevision: sha("8"),
    ledgerDigest: digest("8"),
    claimLedgerRevision: digest("9"),
    operationReceiptDigest: digest("0"),
    transitionCounter: source.transitionCounter + 1,
    heartbeatCounter: 10,
    expiresAt: "2099-08-12T10:00:00.000Z",
  };
}

function verifiedResult(authority, heartbeatCounter) {
  return {
    authority,
    verification: {
      status: "ready",
      claimId: authority.claimId,
      claimDigest: authority.claimDigest,
      inventory: {
        claims: [{
          claimId: authority.claimId,
          state: "active",
          fenceRevision: authority.claimDigest,
          transitionCounter: authority.transitionCounter,
          heartbeatCounter,
        }],
      },
    },
  };
}
