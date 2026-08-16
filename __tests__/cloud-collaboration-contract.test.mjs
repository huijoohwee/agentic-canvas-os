import assert from "node:assert/strict";
import test from "node:test";

import {
  CLOUD_COLLABORATION_BOUNDS,
  ENTRY_SCHEMA,
  LEGACY_ENTRY_SCHEMA,
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

const T0 = "2026-08-04T00:00:00.000Z";
const T1 = "2026-08-04T00:10:00.000Z";
const T2 = "2026-08-04T00:20:00.000Z";
const T3 = "2026-08-04T00:30:00.000Z";
const T4 = "2026-08-04T00:40:00.000Z";
const T5 = "2026-08-04T00:50:00.000Z";
const T6 = "2026-08-04T01:00:00.000Z";

const repository = Object.freeze({
  repositoryId: "repository:acos",
  canonicalRevision: revision("canonical"),
});
const owner = actor("owner", "device-a", "session-a");

function actor(actorId, deviceId, sessionId) {
  return { actorId: `actor:${actorId}`, deviceId, sessionId };
}

function revision(label) {
  return digestValue({ label }).slice(0, 40);
}

function evidence(label) {
  return digestValue({ evidence: label });
}

function claim(ledger, {
  identity = owner,
  targetRepository = repository,
  workItemId = "work:item",
  scope = ["path:docs/a.md"],
  leaseEpoch = 1,
  predecessorClaimId = null,
  time = T0,
  expiresAt = T4,
  laneRevision = targetRepository.canonicalRevision,
  idempotencyKey = `claim:${workItemId}:${leaseEpoch}`,
  expectedLedgerDigest = ledger.headDigest,
} = {}) {
  return applyCloudTransition({
    ledger,
    action: "claim",
    actor: identity,
    repository: targetRepository,
    evaluationTime: time,
    request: {
      workItemId,
      canonicalBaseRevision: targetRepository.canonicalRevision,
      declaredWriteScope: scope,
      laneRevision,
      leaseEpoch,
      ...(predecessorClaimId ? { predecessorClaimId } : {}),
      expiresAt,
      expectedLedgerDigest,
      idempotencyKey,
    },
  });
}

function continueClaim(ledger, current, {
  identity = owner,
  mode,
  time = T1,
  idempotencyKey = `continue:${mode}:${current.claimId}:${current.transitionCounter}`,
  ...request
}) {
  return applyCloudTransition({
    ledger,
    action: "continue",
    actor: identity,
    repository,
    evaluationTime: time,
    request: {
      claimId: current.claimId,
      expectedFenceRevision: current.fenceRevision,
      expectedTransitionCounter: current.transitionCounter,
      expectedLedgerDigest: ledger.headDigest,
      mode,
      idempotencyKey,
      ...request,
    },
  });
}

function retire(ledger, current, {
  identity = owner,
  reason = "abandoned",
  integrationReceiptDigest,
  time = T5,
} = {}) {
  return applyCloudTransition({
    ledger,
    action: "retire",
    actor: identity,
    repository,
    evaluationTime: time,
    request: {
      claimId: current.claimId,
      expectedFenceRevision: current.fenceRevision,
      expectedTransitionCounter: current.transitionCounter,
      expectedLedgerDigest: ledger.headDigest,
      reason,
      finalRevision: current.laneRevision,
      reviewRequestId: current.reviewRequestId,
      bytesDigest: evidence("bytes"),
      namedChecksDigest: evidence("checks"),
      handoffEvidenceDigest: evidence("handoff"),
      ...(integrationReceiptDigest ? { integrationReceiptDigest } : {}),
      idempotencyKey: `retire:${reason}:${current.claimId}`,
    },
  });
}

function throwsCode(callback, code) {
  assert.throws(callback, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

function replaceLast(ledger, change) {
  const entries = [...ledger.entries], previous = entries.at(-1);
  const core = structuredClone(previous.claimCore);
  change(core);
  const { digest: ignored, ...priorDraft } = previous;
  const draft = { ...priorDraft, claimCore: core, claimDigest: digestValue(core) };
  const entry = { ...draft, digest: digestValue(draft) };
  entries[entries.length - 1] = entry;
  return { ...ledger, headDigest: entry.digest, entries };
}

function appendForged(ledger, claimId, { action = "continue", time, label, change }) {
  const previous = ledger.entries.findLast((entry) => entry.claimId === claimId);
  const core = structuredClone(previous.claimCore);
  core.transitionCounter += 1;
  change(core);
  const draft = {
    schema: ENTRY_SCHEMA, sequence: ledger.sequence + 1, parentDigest: ledger.headDigest,
    action, repositoryId: core.repositoryId, claimId, idempotencyKey: evidence(`forged-id:${label}`),
    requestDigest: evidence(`forged-request:${label}`), evaluationTime: time,
    claimCore: core, claimDigest: digestValue(core),
  };
  const entry = { ...draft, digest: digestValue(draft) };
  return { ...ledger, sequence: entry.sequence, headDigest: entry.digest, entries: [...ledger.entries, entry] };
}

test("canonical scope logic is deterministic and bounded per claim", () => {
  assert.equal(canonicalJson({ z: 1, a: -0 }), '{"a":0,"z":1}');
  assert.deepEqual(normalizeWriteSet(["docs/a.md", "path:docs/a.md"]), ["path:docs/a.md"]);
  assert.equal(writeSetsOverlap(["path:docs"], ["path:docs/a.md"]), true);
  assert.deepEqual(CLOUD_COLLABORATION_BOUNDS, { writeScopeItems: 128, textCharacters: 512 });
  throwsCode(() => normalizeWriteSet(Array.from({ length: 129 }, (_, index) => `path:${index}`)), "bound_exceeded");
});

test("public mutations are exactly claim, continue, integrate, and retire", () => {
  const initial = createEmptyLedger("ledger:repository");
  const claimed = claim(initial);
  assert.equal(claimed.ledger.entries[0].schema, ENTRY_SCHEMA);
  assert.equal(claimed.claim.state, "current");
  assert.equal(claimed.claim.writeAuthority, true);
  assert.equal(claimed.receipt.schema, "agentic-collaboration-claim-receipt/v1");
  for (const action of ["bind", "heartbeat", "review-ready", "delivery-authorize", "handoff", "release"]) {
    throwsCode(() => applyCloudTransition({
      ledger: claimed.ledger,
      action,
      actor: owner,
      repository,
      evaluationTime: T1,
      request: {},
    }), "invalid_action");
  }
});

test("claim is CAS-fenced, device-neutral, replay-safe, and actor-authenticated", () => {
  const initial = createEmptyLedger("ledger:repository");
  const options = { idempotencyKey: "claim:stable" };
  const first = claim(initial, options);
  const otherProjection = claim(initial, {
    ...options,
    identity: actor("owner", "device-b", "session-b"),
  });
  assert.equal(first.claim.claimId, otherProjection.claim.claimId);
  const replay = claim(first.ledger, {
    ...options,
    idempotencyKey: "claim:stable",
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.claimDigest, first.claimDigest);
  throwsCode(() => claim(first.ledger, {
    workItemId: "work:other",
    idempotencyKey: "claim:stale-cas",
    expectedLedgerDigest: evidence("stale"),
  }), "stale_ledger_digest");
  const request = {
    claimId: first.claim.claimId,
    expectedFenceRevision: first.claim.fenceRevision,
    expectedTransitionCounter: first.claim.transitionCounter,
    expectedLedgerDigest: first.ledger.headDigest,
    mode: "renewal",
    expiresAt: T5,
    idempotencyKey: "continue:wrong-actor",
  };
  throwsCode(() => applyCloudTransition({
    ledger: first.ledger,
    action: "continue",
    actor: actor("intruder", "device-a", "session-a"),
    repository,
    evaluationTime: T1,
    request,
  }), "claim_owner_mismatch");
  throwsCode(() => applyCloudTransition({
    ledger: first.ledger,
    action: "continue",
    actor: owner,
    repository,
    evaluationTime: T1,
    request: { ...request, expectedLedgerDigest: evidence("stale") },
  }), "stale_ledger_digest");
});

test("unlimited disjoint authorities have no policy cardinality cap", () => {
  let ledger = createEmptyLedger("ledger:repository");
  for (let index = 0; index < 140; index += 1) {
    ledger = claim(ledger, {
      workItemId: `work:${index}`,
      scope: [`path:shards/${index}.md`],
      idempotencyKey: `claim:shard:${index}`,
    }).ledger;
  }
  const claims = listCurrentClaims(ledger, T1);
  assert.equal(claims.length, 140);
  assert.equal(claims.every((item) => item.state === "current"), true);
  assert.deepEqual(validateLedger(ledger), []);
});

test("overlapping claims wait and only the deterministic successor can promote", () => {
  const first = claim(createEmptyLedger("ledger:repository"), { workItemId: "work:a" });
  const second = claim(first.ledger, { workItemId: "work:b", time: T1, idempotencyKey: "claim:b" });
  const third = claim(second.ledger, { workItemId: "work:c", time: T2, idempotencyKey: "claim:c" });
  assert.equal(second.claim.state, "waiting-successor");
  assert.equal(third.claim.state, "waiting-successor");
  const retired = retire(third.ledger, first.claim, { time: T3 });
  throwsCode(() => continueClaim(retired.ledger, third.claim, {
    mode: "promote",
    time: T4,
    expiresAt: T6,
  }), "successor_not_selected");
  const promoted = continueClaim(retired.ledger, second.claim, {
    mode: "promote",
    time: T4,
    expiresAt: T6,
  });
  assert.equal(promoted.claim.state, "current");
  throwsCode(() => continueClaim(promoted.ledger, third.claim, {
    mode: "promote",
    time: T5,
    expiresAt: "2026-08-04T02:00:00.000Z",
  }), "overlap_still_reserved");
});

test("an actor can retire its orphaned waiting successor without the expired device lease", () => {
  const current = claim(createEmptyLedger("ledger:repository"), { workItemId: "work:current" });
  const waiting = claim(current.ledger, {
    workItemId: "work:waiting",
    time: T1,
    idempotencyKey: "claim:orphaned-waiting",
  });
  assert.equal(waiting.claim.state, "waiting-successor");
  throwsCode(() => retire(waiting.ledger, waiting.claim, {
    identity: actor("intruder", "device-recovered", "session-recovered"),
    time: T2,
  }), "claim_owner_mismatch");
  const retired = retire(waiting.ledger, waiting.claim, {
    identity: actor("owner", "device-recovered", "session-recovered"),
    time: T2,
  });
  assert.equal(retired.claim.state, "retired");
});

test("a named predecessor must resolve to the exact preserved matching authority", () => {
  const initial = createEmptyLedger("ledger:repository");
  throwsCode(() => claim(initial, {
    predecessorClaimId: evidence("invented-predecessor"),
    idempotencyKey: "claim:invented-predecessor",
  }), "predecessor_identity_mismatch");
  const first = claim(initial);
  const retired = retire(first.ledger, first.claim, { time: T1 });
  const successor = claim(retired.ledger, {
    leaseEpoch: 2,
    predecessorClaimId: first.claim.claimId,
    time: T2,
    expiresAt: T6,
    idempotencyKey: "claim:retired-predecessor",
  });
  assert.equal(successor.claim.state, "current");
  assert.equal(successor.claim.predecessorClaimId, first.claim.claimId);
});

test("expiry is dormant-preserved and recovery ignores the expired device lease", () => {
  const first = claim(createEmptyLedger("ledger:repository"), { expiresAt: T1 });
  const dormant = listCurrentClaims(first.ledger, T2)[0];
  assert.equal(dormant.state, "dormant-preserved");
  assert.equal(dormant.writeAuthority, false);
  assert.equal(dormant.scopeReserved, true);
  const waiting = claim(first.ledger, { workItemId: "work:successor", time: T2, expiresAt: T6 });
  assert.equal(waiting.claim.state, "waiting-successor");
  const recovered = continueClaim(waiting.ledger, dormant, {
    identity: actor("owner", "device-recovered", "session-recovered"),
    mode: "recovery",
    time: T3,
    expiresAt: T6,
    recoveryEvidenceDigest: evidence("recovery"),
  });
  assert.equal(recovered.claim.state, "current");
  assert.equal(recovered.claim.deviceId, "device-recovered");
});

test("review identity is immutable; integrate preserves; retire joins the typed receipt", () => {
  const first = claim(createEmptyLedger("ledger:repository"));
  const projected = continueClaim(first.ledger, first.claim, {
    mode: "projection",
    laneRevision: revision("candidate"),
    reviewRequestId: "review:1",
  });
  const reviewed = continueClaim(projected.ledger, projected.claim, {
    mode: "review",
    time: T2,
    laneRevision: projected.claim.laneRevision,
    reviewRequestId: "review:1",
    focusedEvidenceDigest: evidence("focused"),
  });
  assert.equal(reviewed.claim.state, "reviewed");
  assert.equal(reviewed.claim.writeAuthority, false);
  throwsCode(() => continueClaim(reviewed.ledger, reviewed.claim, {
    mode: "review",
    time: T3,
    laneRevision: reviewed.claim.laneRevision,
    reviewRequestId: "review:2",
    focusedEvidenceDigest: evidence("other"),
  }), "stale_review_identity");
  const integrated = applyCloudTransition({
    ledger: reviewed.ledger,
    action: "integrate",
    actor: owner,
    repository,
    evaluationTime: T3,
    request: {
      claimId: reviewed.claim.claimId,
      expectedFenceRevision: reviewed.claim.fenceRevision,
      expectedTransitionCounter: reviewed.claim.transitionCounter,
      expectedLedgerDigest: reviewed.ledger.headDigest,
      candidateRevision: reviewed.claim.laneRevision,
      reviewRequestId: reviewed.claim.reviewRequestId,
      focusedEvidenceDigest: reviewed.claim.evidenceDigest,
      dependencyClosureDigest: evidence("dependencies"),
      namedChecksDigest: evidence("named-checks"),
      handoffEvidenceDigest: evidence("handoff"),
      operatorDecisionDigest: evidence("operator"),
      integrationIntentDigest: evidence("intent"),
      idempotencyKey: "integrate:review-1",
    },
  });
  assert.equal(integrated.claim.state, "integrated-preserved");
  assert.equal(integrated.receipt.schema, "agentic-collaboration-integration-receipt/v1");
  throwsCode(() => retire(integrated.ledger, integrated.claim, {
    reason: "integrated",
    integrationReceiptDigest: evidence("not-the-receipt"),
  }), "integration_receipt_mismatch");
  const retired = retire(integrated.ledger, integrated.claim, {
    reason: "integrated",
    integrationReceiptDigest: integrated.receipt.receiptDigest,
  });
  assert.equal(retired.claim.state, "retired");
  assert.equal(retired.receipt.schema, "agentic-collaboration-retirement-receipt/v1");
});

test("verification can recover one exact integrated entry followed by its valid retirement", () => {
  const claimed = claim(createEmptyLedger("ledger:repository"), { expiresAt: T4 });
  const projected = continueClaim(claimed.ledger, claimed.claim, {
    mode: "projection",
    laneRevision: revision("historical-candidate"),
    reviewRequestId: "review:historical",
  });
  const reviewed = continueClaim(projected.ledger, projected.claim, {
    mode: "review",
    time: T2,
    laneRevision: projected.claim.laneRevision,
    reviewRequestId: projected.claim.reviewRequestId,
    focusedEvidenceDigest: evidence("historical-focused"),
  });
  const integrated = applyCloudTransition({
    ledger: reviewed.ledger,
    action: "integrate",
    actor: owner,
    repository,
    evaluationTime: T3,
    request: {
      claimId: reviewed.claim.claimId,
      expectedFenceRevision: reviewed.claim.fenceRevision,
      expectedTransitionCounter: reviewed.claim.transitionCounter,
      expectedLedgerDigest: reviewed.ledger.headDigest,
      candidateRevision: reviewed.claim.laneRevision,
      reviewRequestId: reviewed.claim.reviewRequestId,
      focusedEvidenceDigest: reviewed.claim.evidenceDigest,
      dependencyClosureDigest: evidence("historical-dependencies"),
      namedChecksDigest: evidence("historical-checks"),
      handoffEvidenceDigest: evidence("historical-handoff"),
      operatorDecisionDigest: evidence("historical-operator"),
      integrationIntentDigest: evidence("historical-intent"),
      idempotencyKey: "integrate:historical",
    },
  });
  const retired = retire(integrated.ledger, integrated.claim, {
    reason: "integrated",
    integrationReceiptDigest: integrated.receipt.receiptDigest,
  });
  const request = {
    claimId: integrated.claim.claimId,
    fenceRevision: integrated.claim.fenceRevision,
    requiredState: "integrated-preserved",
    allowRetiredIntegratedPreserved: true,
    integrationReceiptDigest: integrated.receipt.receiptDigest,
    transitionCounter: integrated.claim.transitionCounter,
  };
  const verified = verifyCloudClaim({
    ledger: retired.ledger,
    request,
    evaluationTime: T5,
  });
  assert.equal(verified.ok, true);
  assert.equal(verified.claim.state, "integrated-preserved");
  assert.equal(verified.claimDigest, integrated.claim.fenceRevision);

  for (const mutation of [
    { allowRetiredIntegratedPreserved: false },
    { integrationReceiptDigest: evidence("wrong-integration") },
    { transitionCounter: integrated.claim.transitionCounter - 1 },
  ]) {
    const blocked = verifyCloudClaim({
      ledger: retired.ledger,
      request: { ...request, ...mutation },
      evaluationTime: T5,
    });
    assert.equal(blocked.ok, false);
  }
});

test("ledger validation rejects hash-consistent forged authority semantics", () => {
  const first = claim(createEmptyLedger("ledger:repository"), { expiresAt: T6 });
  const waiting = claim(first.ledger, { workItemId: "work:waiting", time: T1, expiresAt: T6 });
  const admission = replaceLast(waiting.ledger, (core) => { core.state = "current"; core.eligibleSince = null; });
  assert.match(validateLedger(admission).join("; "), /claim queue admission|overlapping scope/);

  const third = claim(waiting.ledger, { workItemId: "work:third", time: T2, expiresAt: T6 });
  const predecessorRetired = retire(third.ledger, first.claim, { time: T3 });
  const priority = appendForged(predecessorRetired.ledger, third.claim.claimId, {
    time: T4, label: "priority", change(core) { core.state = "current"; core.expiresAt = T6; core.promotedAt = T4; },
  });
  assert.match(validateLedger(priority).join("; "), /successor promotion/);

  const projected = continueClaim(first.ledger, first.claim, {
    mode: "projection", time: T1, laneRevision: revision("reviewed"), reviewRequestId: "review:forged",
  });
  const reviewed = continueClaim(projected.ledger, projected.claim, {
    mode: "review", time: T2, laneRevision: projected.claim.laneRevision,
    reviewRequestId: projected.claim.reviewRequestId, focusedEvidenceDigest: evidence("reviewed"),
  });
  const identity = appendForged(reviewed.ledger, reviewed.claim.claimId, {
    time: T3, label: "review-identity", change(core) {
      core.laneRevision = revision("rewritten"); core.reviewRequestId = "review:rewritten"; core.evidenceDigest = evidence("rewritten");
    },
  });
  assert.match(validateLedger(identity).join("; "), /reviewed continuation/);
  const integration = appendForged(reviewed.ledger, reviewed.claim.claimId, {
    action: "integrate", time: T3, label: "integration", change(core) { core.state = "integrated-preserved"; },
  });
  assert.match(validateLedger(integration).join("; "), /typed integration evidence/);

  const preservation = appendForged(first.ledger, first.claim.claimId, {
    time: T1, label: "preservation", change(core) { core.state = "dormant-preserved"; },
  });
  assert.match(validateLedger(preservation).join("; "), /preservation evidence/);
  const expired = claim(createEmptyLedger("ledger:repository"), { expiresAt: T1 });
  const recovery = appendForged(expired.ledger, expired.claim.claimId, {
    time: T2, label: "recovery", change(core) { core.state = "current"; core.expiresAt = T6; },
  });
  assert.match(validateLedger(recovery).join("; "), /dormant recovery/);
  const retirement = appendForged(first.ledger, first.claim.claimId, {
    action: "retire", time: T1, label: "retirement", change(core) { core.state = "retired"; },
  });
  assert.match(validateLedger(retirement).join("; "), /typed retirement evidence/);

  const backwardsBase = claim(createEmptyLedger("ledger:repository"), { time: T2, expiresAt: T6 });
  const backwards = appendForged(backwardsBase.ledger, backwardsBase.claim.claimId, {
    time: T1, label: "time", change() {},
  });
  assert.match(validateLedger(backwards).join("; "), /evaluationTime is not monotonic/);
  const staleState = replaceLast(first.ledger, (core) => { core.state = "integrating"; });
  assert.match(validateLedger(staleState).join("; "), /claimCore.state is invalid/);
});

test("historical v1 bytes validate unchanged and continue one-way into v2", () => {
  const legacy = legacyLedger();
  const bytes = canonicalJson(legacy);
  assert.deepEqual(validateLedger(legacy), []);
  assert.equal(canonicalJson(legacy), bytes);
  const previous = legacy.entries.at(-1);
  const continued = applyCloudTransition({
    ledger: legacy,
    action: "continue",
    actor: owner,
    repository: { repositoryId: repository.repositoryId },
    evaluationTime: T2,
    request: {
      claimId: previous.claimId,
      expectedFenceRevision: previous.claimDigest,
      expectedTransitionCounter: 2,
      expectedLedgerDigest: legacy.headDigest,
      mode: "renewal",
      expiresAt: T6,
      idempotencyKey: "legacy-to-v2",
    },
  });
  assert.equal(continued.ledger.entries.at(-1).schema, ENTRY_SCHEMA);
  assert.equal(continued.claim.claimIdentitySchema, LEGACY_ENTRY_SCHEMA);
  assert.equal(continued.claim.state, "current");
  assert.deepEqual(validateLedger(continued.ledger), []);

  const reviewedLegacy = legacyReviewedLedger();
  const reviewedEntry = reviewedLegacy.entries.at(-1);
  const integrated = applyCloudTransition({
    ledger: reviewedLegacy,
    action: "integrate",
    actor: owner,
    repository: { repositoryId: repository.repositoryId },
    evaluationTime: T3,
    request: {
      claimId: reviewedEntry.claimId,
      expectedFenceRevision: reviewedEntry.claimDigest,
      expectedTransitionCounter: 3,
      expectedLedgerDigest: reviewedLegacy.headDigest,
      candidateRevision: reviewedEntry.claimCore.laneRevision,
      reviewRequestId: reviewedEntry.claimCore.reviewRequestId,
      focusedEvidenceDigest: reviewedEntry.claimCore.evidenceDigest,
      dependencyClosureDigest: evidence("legacy-dependencies"),
      namedChecksDigest: evidence("legacy-checks"),
      handoffEvidenceDigest: evidence("legacy-handoff"),
      operatorDecisionDigest: evidence("legacy-operator"),
      integrationIntentDigest: evidence("legacy-integration"),
      idempotencyKey: "legacy-review-to-v2",
    },
  });
  assert.equal(integrated.claim.state, "integrated-preserved");
  assert.deepEqual(validateLedger(integrated.ledger), []);

  const overlap = legacyOverlapLedger();
  const target = listCurrentClaims(overlap, T3).find((claim) => claim.workItemId === "legacy:work");
  const projected = continueClaim(overlap, target, { mode: "projection", time: T3,
    laneRevision: revision("legacy-migration"), reviewRequestId: "review:legacy-migration" });
  const renewed = continueClaim(projected.ledger, projected.claim, { mode: "renewal", time: T3, expiresAt: T6 });
  assert.deepEqual(validateLedger(renewed.ledger), []);
});

function legacyOverlapLedger() {
  const ledger = legacyLedger(), core = { ...ledger.entries[0].claimCore,
    workItemId: "legacy:peer", transitionCounter: 1, heartbeatCounter: 0, state: "active", expiresAt: T2 };
  core.claimId = digestValue({ actorId: core.actorId, canonicalBaseRevision: core.canonicalBaseRevision,
    deviceId: core.deviceId, leaseEpoch: core.leaseEpoch, repositoryId: core.repositoryId,
    sessionId: core.sessionId, workItemId: core.workItemId, writeSetDigest: core.writeSetDigest });
  const claimed = legacyEntry({ action: "claim", core, sequence: 3, parentDigest: ledger.headDigest, time: T1 });
  const reviewedCore = { ...core, transitionCounter: 2, state: "review-ready",
    evidenceDigest: evidence("legacy-peer"), reviewRequestId: "review:legacy-peer" };
  const reviewed = legacyEntry({ action: "review-ready", core: reviewedCore, sequence: 4, parentDigest: claimed.digest, time: T2 });
  return { ...ledger, sequence: 4, headDigest: reviewed.digest, entries: [...ledger.entries, claimed, reviewed] };
}

function legacyReviewedLedger() {
  const ledger = legacyLedger();
  const previous = ledger.entries.at(-1);
  const core = {
    ...previous.claimCore,
    transitionCounter: 3,
    state: "review-ready",
    evidenceDigest: evidence("legacy-review"),
    reviewRequestId: "review:legacy",
  };
  const entry = legacyEntry({
    action: "review-ready",
    core,
    sequence: 3,
    parentDigest: previous.digest,
    time: T2,
  });
  return { ...ledger, sequence: 3, headDigest: entry.digest, entries: [...ledger.entries, entry] };
}

function legacyLedger() {
  const declaredWriteScope = normalizeWriteSet(["path:legacy.md"]);
  const writeSetDigest = digestValue(declaredWriteScope);
  const claimId = digestValue({
    actorId: owner.actorId,
    canonicalBaseRevision: repository.canonicalRevision,
    deviceId: owner.deviceId,
    leaseEpoch: 1,
    repositoryId: repository.repositoryId,
    sessionId: owner.sessionId,
    workItemId: "legacy:work",
    writeSetDigest,
  });
  const initialCore = {
    claimId,
    actorId: owner.actorId,
    deviceId: owner.deviceId,
    sessionId: owner.sessionId,
    repositoryId: repository.repositoryId,
    workItemId: "legacy:work",
    canonicalBaseRevision: repository.canonicalRevision,
    declaredWriteScope,
    writeSetDigest,
    laneRevision: repository.canonicalRevision,
    leaseEpoch: 1,
    transitionCounter: 1,
    heartbeatCounter: 0,
    state: "active",
    expiresAt: T3,
    evidenceDigest: null,
    reviewRequestId: null,
    predecessorClaimId: null,
    handoff: null,
    release: null,
  };
  const first = legacyEntry({ action: "claim", core: initialCore, sequence: 1, parentDigest: null, time: T0 });
  const renewedCore = {
    ...initialCore,
    transitionCounter: 2,
    heartbeatCounter: 1,
    expiresAt: T4,
  };
  const second = legacyEntry({ action: "heartbeat", core: renewedCore, sequence: 2, parentDigest: first.digest, time: T1 });
  return {
    schema: "agentic-cloud-collaboration-ledger/v1",
    ledgerRepositoryId: "ledger:repository",
    sequence: 2,
    headDigest: second.digest,
    entries: [first, second],
  };
}

function legacyEntry({ action, core, sequence, parentDigest, time }) {
  const draft = {
    schema: LEGACY_ENTRY_SCHEMA,
    sequence,
    parentDigest,
    action,
    repositoryId: core.repositoryId,
    claimId: core.claimId,
    idempotencyKey: evidence(`legacy-idempotency:${sequence}`),
    requestDigest: evidence(`legacy-request:${sequence}`),
    evaluationTime: time,
    claimCore: core,
    claimDigest: digestValue(core),
  };
  return { ...draft, digest: digestValue(draft) };
}
