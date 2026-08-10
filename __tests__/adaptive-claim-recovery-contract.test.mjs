import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAdaptiveClaimRecoveryDecision,
  normalizeAdaptiveClaimRecoveryDecision,
} from "../scripts/adaptive-claim-recovery-contract.mjs";

const sha = character => character.repeat(40);
const digest = character => character.repeat(64);

function evidence(overrides = {}) {
  const base = {
    subject: {
      repositoryId: "repository:neutral",
      workItemId: "work-item:42",
      candidateHeadSha: sha("a"),
      protectedMainSha: sha("b"),
    },
    claim: {
      claimId: digest("1"),
      state: "integrated-preserved",
      writeAuthority: false,
      scopeReserved: true,
      fenceRevision: digest("2"),
      transitionCounter: 42,
      heartbeatCounter: 4,
      heartbeatAt: "2026-08-11T02:01:30.000Z",
      expiresAt: "2026-08-11T03:00:00.000Z",
    },
    operation: {
      operationId: "provider-neutral-operation:41",
      state: "terminal",
      conclusion: "failed",
      immutable: true,
      candidateHeadSha: sha("a"),
      protectedMainSha: sha("b"),
      fenceRevision: digest("3"),
      generation: 41,
      heartbeatAt: "2026-08-11T02:01:00.000Z",
      terminalAt: "2026-08-11T02:02:00.000Z",
      terminalReceiptDigest: digest("4"),
      revokedAt: null,
      revocationReceiptDigest: null,
      evidenceDigest: digest("5"),
    },
    observation: {
      observedAt: "2026-08-11T02:03:00.000Z",
      latestFenceRevision: digest("2"),
      latestTransitionCounter: 42,
      latestHeartbeatCounter: 4,
      expectedHeartbeatSeconds: 30,
      missedHeartbeatTolerance: 3,
    },
  };
  return {
    ...base,
    ...overrides,
    subject: { ...base.subject, ...overrides.subject },
    claim: { ...base.claim, ...overrides.claim },
    operation: { ...base.operation, ...overrides.operation },
    observation: { ...base.observation, ...overrides.observation },
  };
}

test("terminal immutable operation recovers immediately through a newer fence generation", () => {
  const decision = buildAdaptiveClaimRecoveryDecision(evidence());
  assert.equal(decision.status, "recoverable-now");
  assert.equal(decision.reason, "terminal-operation-fenced");
  assert.equal(decision.recoveryGeneration, 42);
  assert.equal(decision.mutationAuthority, false);
  assert.equal(decision.nextEvaluationAt, null);
  assert.deepEqual(normalizeAdaptiveClaimRecoveryDecision(decision), decision);
});

test("explicit revocation is equivalent only when a newer fence rejects the old generation", () => {
  const decision = buildAdaptiveClaimRecoveryDecision(evidence({
    operation: {
      state: "revoked",
      conclusion: null,
      terminalAt: null,
      terminalReceiptDigest: null,
      revokedAt: "2026-08-11T02:02:00.000Z",
      revocationReceiptDigest: digest("6"),
    },
  }));
  assert.equal(decision.status, "recoverable-now");
  assert.equal(decision.reason, "revoked-operation-fenced");
});

test("heartbeat timing schedules evidence refresh but never infers early mutation authority", () => {
  const decision = buildAdaptiveClaimRecoveryDecision(evidence({
    operation: {
      state: "running",
      conclusion: null,
      terminalAt: null,
      terminalReceiptDigest: null,
      heartbeatAt: "2026-08-11T02:02:30.000Z",
    },
  }));
  assert.equal(decision.status, "wait");
  assert.equal(decision.reason, "operation-not-deterministically-terminal");
  assert.equal(decision.nextEvaluationAt, "2026-08-11T02:04:00.000Z");
  assert.equal(decision.mutationAuthority, false);

  const successful = buildAdaptiveClaimRecoveryDecision(evidence({
    operation: { conclusion: "succeeded" },
  }));
  assert.equal(successful.status, "wait");
});

test("terminal evidence without monotonic fencing remains fail-closed", () => {
  const unchangedFence = buildAdaptiveClaimRecoveryDecision(evidence({
    operation: { fenceRevision: digest("2") },
  }));
  assert.equal(unchangedFence.status, "wait");
  assert.equal(unchangedFence.reason, "terminal-operation-not-fenced");

  const unchangedGeneration = buildAdaptiveClaimRecoveryDecision(evidence({
    operation: { generation: 42 },
  }));
  assert.equal(unchangedGeneration.status, "wait");
  assert.equal(unchangedGeneration.reason, "terminal-operation-not-fenced");

  const mutableOperation = buildAdaptiveClaimRecoveryDecision(evidence({
    operation: { immutable: false },
  }));
  assert.equal(mutableOperation.status, "wait");
  assert.equal(mutableOperation.reason, "terminal-operation-not-fenced");
});

test("candidate, protected-main, live-fence, or post-terminal heartbeat drift blocks recovery", () => {
  for (const changed of [
    { operation: { candidateHeadSha: sha("c") } },
    { operation: { protectedMainSha: sha("c") } },
    { observation: { latestFenceRevision: digest("9") } },
    { observation: { latestHeartbeatCounter: 5 } },
    { claim: { writeAuthority: true } },
    { claim: { scopeReserved: false } },
    { operation: { heartbeatAt: "2026-08-11T02:02:30.000Z" } },
    { claim: { heartbeatAt: "2026-08-11T02:02:30.000Z" } },
  ]) {
    const decision = buildAdaptiveClaimRecoveryDecision(evidence(changed));
    assert.equal(decision.status, "blocked");
    assert.equal(decision.reason, "identity-or-fence-drift");
  }
});

test("fixed expiry remains the fallback for an exact dormant preserved claim", () => {
  const decision = buildAdaptiveClaimRecoveryDecision(evidence({
    claim: {
      state: "dormant-preserved",
      expiresAt: "2026-08-11T02:00:00.000Z",
    },
    operation: {
      state: "unknown",
      conclusion: null,
      terminalAt: null,
      terminalReceiptDigest: null,
      heartbeatAt: null,
    },
  }));
  assert.equal(decision.status, "recoverable-now");
  assert.equal(decision.reason, "lease-expiry-fallback");
});

test("decision projection is content-bound and rejects added or changed fields", () => {
  const decision = buildAdaptiveClaimRecoveryDecision(evidence());
  assert.match(decision.decisionDigest, /^[0-9a-f]{64}$/u);
  assert.throws(() => normalizeAdaptiveClaimRecoveryDecision({
    ...decision,
    mutationAuthority: true,
  }), /decision projection/u);
  assert.throws(() => normalizeAdaptiveClaimRecoveryDecision({
    ...decision,
    extra: true,
  }), /decision/u);
});
