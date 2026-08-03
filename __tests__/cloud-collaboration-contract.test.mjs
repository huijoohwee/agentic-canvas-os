import test from "node:test";
import assert from "node:assert/strict";

import {
  CLOUD_COLLABORATION_BOUNDS,
  CloudCollaborationError,
  LEDGER_SCHEMA,
  RECEIPT_SCHEMA,
  applyCloudTransition,
  canonicalJson,
  createEmptyLedger,
  digestValue,
  listCurrentClaims,
  normalizeWriteSet,
  validateLedger,
  verifyCloudClaim,
  writeSetsOverlap,
} from "../scripts/cloud-collaboration-contract.mjs";

const LEDGER_REPOSITORY = {
  id: 1,
  nodeId: "ledger-node",
  fullName: "example/ledger",
  defaultBranch: "main",
};
const TARGET_A = {
  id: 2,
  nodeId: "target-a-node",
  fullName: "example/target-a",
  defaultBranch: "main",
  canonicalRevision: "base-a",
};
const TARGET_B = {
  id: 3,
  nodeId: "target-b-node",
  fullName: "example/target-b",
  defaultBranch: "main",
  canonicalRevision: "base-a",
};
const ACTOR_A = { id: 11, login: "actor-a" };
const ACTOR_B = { id: 12, login: "actor-b" };
const START = "2026-07-30T01:00:00.000Z";
const LATER = "2026-07-30T01:05:00.000Z";
const EXPIRES = "2026-07-30T01:30:00.000Z";
const EXTENDED = "2026-07-30T02:00:00.000Z";
const EVIDENCE = digestValue("focused-evidence");
const INTEGRATION = digestValue("integration-receipt");
const OPERATOR_DECISION = digestValue("operator-decision");
const INTEGRATION_INTENT = digestValue("integration-intent");

function emptyLedger() {
  return createEmptyLedger(LEDGER_REPOSITORY);
}

function claimRequest(overrides = {}) {
  return {
    workItemId: "work-1",
    canonicalBaseRevision: "base-a",
    declaredWriteScope: ["src/feature"],
    leaseEpoch: 1,
    expiresAt: EXPIRES,
    deviceId: "device-a",
    sessionId: "session-a",
    idempotencyKey: "claim-work-1-epoch-1",
    ...overrides,
  };
}

function mutate(ledger, action, request, {
  actor = ACTOR_A,
  repository = TARGET_A,
  evaluationTime = START,
} = {}) {
  return applyCloudTransition({ ledger, action, request, actor, repository, evaluationTime });
}

function expected(claim, idempotencyKey, overrides = {}) {
  return {
    claimId: claim.claimId,
    expectedFenceRevision: claim.fenceRevision,
    expectedTransitionCounter: claim.transitionCounter,
    deviceId: claim.deviceId,
    sessionId: claim.sessionId,
    idempotencyKey,
    ...overrides,
  };
}

function throwsCode(callback, code) {
  assert.throws(callback, (error) => {
    assert.equal(error instanceof CloudCollaborationError, true);
    assert.equal(error.code, code);
    return true;
  });
}

test("canonical JSON, digests, and write scopes are deterministic", () => {
  assert.equal(canonicalJson({ z: 1, a: { y: true, x: null } }), '{"a":{"x":null,"y":true},"z":1}');
  assert.equal(digestValue({ b: 2, a: 1 }), digestValue({ a: 1, b: 2 }));
  assert.deepEqual(normalizeWriteSet([
    "src\\feature\\file.js",
    "path:src/feature/./file.js",
    "semantic:Generated_Output",
  ]), ["path:src/feature/file.js", "semantic:generated_output"]);
  assert.equal(writeSetsOverlap(["src"], ["src/feature/file.js"]), true);
  assert.equal(writeSetsOverlap(["src/a"], ["src/b"]), false);
  assert.equal(writeSetsOverlap(["semantic:bundle"], ["semantic:BUNDLE"]), true);
  assert.equal(writeSetsOverlap(["path:."], ["docs/file.md"]), true);
  throwsCode(() => normalizeWriteSet(["../outside"]), "invalid_write_scope");
  throwsCode(() => normalizeWriteSet(["src/**"]), "invalid_write_scope");
  throwsCode(
    () => normalizeWriteSet(Array.from({ length: 129 }, (_, index) => `file-${index}`)),
    "bound_exceeded",
  );
});

test("an empty ledger is bounded, provider-neutral, and valid", () => {
  assert.deepEqual(emptyLedger(), {
    schema: LEDGER_SCHEMA,
    ledgerRepositoryId: "ledger-node",
    sequence: 0,
    headDigest: null,
    entries: [],
  });
  assert.deepEqual(validateLedger(emptyLedger()), []);
  assert.deepEqual(CLOUD_COLLABORATION_BOUNDS, {
    ledgerEntries: 512,
    activeClaims: 128,
    writeScopeItems: 128,
    textCharacters: 512,
  });
});

test("claim is immutable, hash-chained, replay-safe, and conflict-safe", () => {
  const ledger = emptyLedger();
  const request = claimRequest();
  const snapshot = structuredClone(request);
  const first = mutate(ledger, "claim", request);

  assert.deepEqual(request, snapshot);
  assert.notEqual(first.ledger, ledger);
  assert.equal(ledger.sequence, 0);
  assert.equal(first.ledger.sequence, 1);
  assert.equal(first.ledger.headDigest, first.ledger.entries[0].digest);
  assert.equal(first.ledger.entries[0].repositoryId, "target-a-node");
  assert.equal(first.ledger.entries[0].idempotencyKey, digestValue(request.idempotencyKey));
  assert.equal(first.ledger.entries[0].idempotencyKey.includes(request.idempotencyKey), false);
  assert.equal(first.claim.repositoryId, "target-a-node");
  assert.equal(first.claim.state, "active");
  assert.equal(first.claim.transitionCounter, 1);
  assert.equal(first.claim.heartbeatCounter, 0);
  assert.equal(first.receipt.schema, RECEIPT_SCHEMA);
  assert.deepEqual(validateLedger(first.ledger), []);

  const replay = mutate(first.ledger, "claim", request, { evaluationTime: LATER });
  assert.equal(replay.replayed, true);
  assert.equal(replay.ledger, first.ledger);
  assert.deepEqual(replay.receipt, first.receipt);

  throwsCode(
    () => mutate(first.ledger, "claim", { ...request, expiresAt: EXTENDED }),
    "idempotency_conflict",
  );
});

test("one ledger arbitrates multiple target repositories without cross-repository collisions", () => {
  const first = mutate(emptyLedger(), "claim", claimRequest());
  const second = mutate(
    first.ledger,
    "claim",
    claimRequest({
      workItemId: "work-b",
      deviceId: "device-b",
      sessionId: "session-b",
      idempotencyKey: "target-b-claim",
    }),
    { actor: ACTOR_B, repository: TARGET_B },
  );
  assert.deepEqual(second.ledger.entries.map((entry) => entry.repositoryId), [
    "target-a-node",
    "target-b-node",
  ]);
  assert.equal(second.ledger.ledgerRepositoryId, "ledger-node");
  assert.deepEqual(
    listCurrentClaims(second.ledger, START, { repositoryId: "target-a-node" }).map((claim) => claim.claimId),
    [first.claim.claimId],
  );
  const status = applyCloudTransition({
    ledger: second.ledger,
    action: "status",
    request: {},
    evaluationTime: START,
  });
  assert.equal(status.claim, null);
  assert.equal(status.claims.length, 2);
});

test("overlapping claims serialize while disjoint claims can proceed", () => {
  const winner = mutate(emptyLedger(), "claim", claimRequest());
  const competing = claimRequest({
    workItemId: "work-2",
    declaredWriteScope: ["src/feature/file.js"],
    deviceId: "device-b",
    sessionId: "session-b",
    idempotencyKey: "claim-work-2",
  });
  const sameParentCandidate = mutate(emptyLedger(), "claim", competing, { actor: ACTOR_B });
  assert.notEqual(sameParentCandidate.ledger.headDigest, winner.ledger.headDigest);
  throwsCode(
    () => mutate(winner.ledger, "claim", competing, { actor: ACTOR_B }),
    "parallel_scope_collision",
  );

  const disjoint = mutate(
    winner.ledger,
    "claim",
    { ...competing, declaredWriteScope: ["docs/feature.md"], idempotencyKey: "claim-work-2-docs" },
    { actor: ACTOR_B },
  );
  assert.equal(disjoint.ledger.sequence, 2);
  assert.deepEqual(validateLedger(disjoint.ledger), []);
});

test("bind, heartbeat, review-ready, delivery authorization, verify, and integrated release are fenced", () => {
  const claimed = mutate(emptyLedger(), "claim", claimRequest());
  const bound = mutate(claimed.ledger, "bind", expected(claimed.claim, "bind-lane", {
    laneRevision: "lane-a",
  }));
  assert.equal(bound.claim.laneRevision, "lane-a");
  assert.equal(bound.claim.transitionCounter, 2);

  const heartbeat = mutate(bound.ledger, "heartbeat", expected(bound.claim, "heartbeat-1", {
    expiresAt: EXTENDED,
  }), { evaluationTime: LATER });
  assert.equal(heartbeat.claim.heartbeatCounter, 1);
  assert.equal(heartbeat.claim.transitionCounter, 3);

  const ready = mutate(heartbeat.ledger, "review-ready", expected(heartbeat.claim, "review-ready-1", {
    laneRevision: "lane-a",
    reviewRequestId: "review-17",
    focusedEvidenceDigest: EVIDENCE,
  }), { evaluationTime: LATER });
  assert.equal(ready.claim.state, "review-ready");
  assert.equal(ready.claim.transitionCounter, 4);

  const verificationRequest = {
    claimId: ready.claim.claimId,
    repositoryId: "target-a-node",
    workItemId: "work-1",
    canonicalBaseRevision: "base-a",
    laneRevision: "lane-a",
    writeSetDigest: ready.claim.writeSetDigest,
    leaseEpoch: 1,
    fenceRevision: ready.claim.fenceRevision,
    ledgerRevision: ready.claim.ledgerRevision,
    requiredState: "review-ready",
    reviewRequestId: "review-17",
    focusedEvidenceDigest: EVIDENCE,
  };
  const verified = verifyCloudClaim({
    ledger: ready.ledger,
    request: verificationRequest,
    evaluationTime: LATER,
  });
  assert.equal(verified.ok, true);
  assert.equal(verified.verdict, "ready");
  assert.equal(verified.claimDigest, ready.claim.fenceRevision);
  assert.deepEqual(verified.findings, []);
  assert.deepEqual(Object.values(verified.findingCounts), [0, 0, 0, 0, 0]);

  const authorized = mutate(ready.ledger, "delivery-authorize", expected(ready.claim, "authorize-delivery-1", {
    laneRevision: "lane-a",
    reviewRequestId: "review-17",
    focusedEvidenceDigest: EVIDENCE,
    operatorDecisionDigest: OPERATOR_DECISION,
    integrationIntentDigest: INTEGRATION_INTENT,
  }), { evaluationTime: LATER });
  assert.equal(authorized.claim.state, "delivery-authorized");
  assert.equal(authorized.claim.transitionCounter, 5);

  throwsCode(
    () => mutate(authorized.ledger, "release", expected(authorized.claim, "stale-release", {
      expectedFenceRevision: claimed.claim.fenceRevision,
      reason: "integrated",
      evidenceDigest: EVIDENCE,
      integrationReceiptDigest: INTEGRATION,
    }), { evaluationTime: LATER }),
    "stale_collaboration_fence",
  );
  const released = mutate(authorized.ledger, "release", expected(authorized.claim, "release-integrated", {
    reason: "integrated",
    evidenceDigest: EVIDENCE,
    integrationReceiptDigest: INTEGRATION,
  }), { evaluationTime: LATER });
  assert.equal(released.claim.state, "released");
  assert.deepEqual(validateLedger(released.ledger), []);
});

test("integrated release can retire an expired delivery-authorized claim owned by the same actor", () => {
  const claimed = mutate(emptyLedger(), "claim", claimRequest());
  const bound = mutate(claimed.ledger, "bind", expected(claimed.claim, "bind-expired-release", {
    laneRevision: "lane-expired",
  }));
  const ready = mutate(bound.ledger, "review-ready", expected(bound.claim, "review-ready-expired", {
    laneRevision: "lane-expired",
    reviewRequestId: "review-expired",
    focusedEvidenceDigest: EVIDENCE,
  }), { evaluationTime: LATER });
  const authorized = mutate(ready.ledger, "delivery-authorize", expected(ready.claim, "authorize-expired", {
    laneRevision: "lane-expired",
    reviewRequestId: "review-expired",
    focusedEvidenceDigest: EVIDENCE,
    operatorDecisionDigest: OPERATOR_DECISION,
    integrationIntentDigest: INTEGRATION_INTENT,
  }), { evaluationTime: LATER });

  const released = mutate(authorized.ledger, "release", expected(authorized.claim, "release-expired-integrated", {
    reason: "integrated",
    evidenceDigest: EVIDENCE,
    integrationReceiptDigest: INTEGRATION,
  }), {
    evaluationTime: "2026-07-30T03:00:00.000Z",
  });
  assert.equal(released.claim.state, "released");
  assert.deepEqual(validateLedger(released.ledger), []);
});

test("delivery authorization is idempotent and rejects reviewed-source drift", () => {
  const claimed = mutate(emptyLedger(), "claim", claimRequest());
  const bound = mutate(claimed.ledger, "bind", expected(claimed.claim, "bind-delivery-proof", {
    laneRevision: "lane-reviewed",
  }));
  const ready = mutate(bound.ledger, "review-ready", expected(bound.claim, "ready-delivery-proof", {
    laneRevision: "lane-reviewed",
    reviewRequestId: "review-proof",
    focusedEvidenceDigest: EVIDENCE,
  }));
  const request = expected(ready.claim, "authorize-delivery-proof", {
    laneRevision: "lane-reviewed",
    reviewRequestId: "review-proof",
    focusedEvidenceDigest: EVIDENCE,
    operatorDecisionDigest: OPERATOR_DECISION,
    integrationIntentDigest: INTEGRATION_INTENT,
  });
  const authorized = mutate(ready.ledger, "delivery-authorize", request);
  const replayed = mutate(authorized.ledger, "delivery-authorize", request);
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.claim.fenceRevision, authorized.claim.fenceRevision);

  throwsCode(() => mutate(ready.ledger, "delivery-authorize", {
    ...request,
    idempotencyKey: "authorize-drifted-lane",
    laneRevision: "lane-edited-after-review",
  }), "delivery_authority_unjoined");
  throwsCode(() => mutate(ready.ledger, "bind", expected(ready.claim, "edit-after-review", {
    laneRevision: "lane-edited-after-review",
  })), "invalid_transition");
  throwsCode(() => mutate(ready.ledger, "release", expected(ready.claim, "integrate-without-authority", {
    reason: "integrated",
    evidenceDigest: EVIDENCE,
    integrationReceiptDigest: INTEGRATION,
  })), "invalid_transition");
});

test("handoff preserves immutable work and increments the lease epoch", () => {
  const claimed = mutate(emptyLedger(), "claim", claimRequest());
  const bound = mutate(claimed.ledger, "bind", expected(claimed.claim, "bind-for-handoff", {
    laneRevision: "lane-handoff",
  }));
  const handed = mutate(bound.ledger, "handoff", expected(bound.claim, "handoff-to-b", {
    recipientMode: "actor",
    nextActorId: "12",
    evidenceDigest: EVIDENCE,
  }), { evaluationTime: LATER });
  assert.equal(handed.claim.state, "parked");

  const successorRequest = claimRequest({
    laneRevision: "lane-handoff",
    leaseEpoch: 2,
    predecessorClaimId: handed.claim.claimId,
    deviceId: "device-b",
    sessionId: "session-b",
    idempotencyKey: "claim-successor",
  });
  throwsCode(
    () => mutate(handed.ledger, "claim", successorRequest, { actor: { id: 13, login: "actor-c" } }),
    "handoff_recipient_mismatch",
  );
  const successor = mutate(handed.ledger, "claim", successorRequest, { actor: ACTOR_B });
  assert.equal(successor.claim.leaseEpoch, 2);
  assert.equal(successor.claim.predecessorClaimId, handed.claim.claimId);
  assert.deepEqual(listCurrentClaims(successor.ledger, LATER), [successor.claim]);

  const released = mutate(successor.ledger, "release", expected(handed.claim, "release-handoff", {
    reason: "handoff",
    evidenceDigest: EVIDENCE,
  }), { evaluationTime: LATER });
  assert.equal(released.claim.state, "released");
  assert.deepEqual(listCurrentClaims(released.ledger, LATER), [successor.claim]);
});

test("explicit evaluation time expires claims and produces only canonical findings", () => {
  const claimed = mutate(emptyLedger(), "claim", claimRequest());
  const atExpiry = applyCloudTransition({
    ledger: claimed.ledger,
    action: "status",
    request: { claimId: claimed.claim.claimId },
    evaluationTime: EXPIRES,
  });
  assert.equal(atExpiry.claim.state, "expired");
  const verification = verifyCloudClaim({
    ledger: claimed.ledger,
    request: { claimId: claimed.claim.claimId, fenceRevision: claimed.claim.fenceRevision },
    evaluationTime: EXPIRES,
  });
  assert.equal(verification.ok, false);
  assert.deepEqual(verification.findings.map((item) => item.type), ["stale-collaboration-fence"]);

  const successor = mutate(claimed.ledger, "claim", claimRequest({
    leaseEpoch: 2,
    predecessorClaimId: claimed.claim.claimId,
    deviceId: "device-b",
    sessionId: "session-b",
    idempotencyKey: "expired-successor",
    expiresAt: EXTENDED,
  }), { actor: ACTOR_B, evaluationTime: EXPIRES });
  assert.equal(successor.claim.leaseEpoch, 2);
});

test("chain validation rejects tampering and non-monotonic counters", () => {
  const claimed = mutate(emptyLedger(), "claim", claimRequest());
  const tampered = structuredClone(claimed.ledger);
  tampered.entries[0].claimCore.laneRevision = "forged-lane";
  assert.equal(validateLedger(tampered).some((failure) => failure.includes("claimDigest")), true);

  const forgedCounter = structuredClone(claimed.ledger);
  forgedCounter.entries[0].claimCore.transitionCounter = 2;
  forgedCounter.entries[0].claimDigest = digestValue(forgedCounter.entries[0].claimCore);
  const { digest: ignored, ...entryDraft } = forgedCounter.entries[0];
  forgedCounter.entries[0].digest = digestValue(entryDraft);
  forgedCounter.headDigest = forgedCounter.entries[0].digest;
  assert.equal(validateLedger(forgedCounter).some((failure) => failure.includes("counter 1")), true);
});
