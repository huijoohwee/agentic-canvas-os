import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { CLOUD_COLLABORATION_BOUNDS, ENTRY_SCHEMA, LEGACY_ENTRY_SCHEMA, applyCloudTransition,
  canonicalJson, createEmptyLedger, digestValue, findUncoveredPathScopes, listCurrentClaims,
  normalizeWriteSet, validateLedger, verifyCloudClaim, writeSetsOverlap,
} from "../scripts/cloud-collaboration-contract.mjs";
import { claimOnlySuccessorBaseRolloverPredecessor as rolloverPredecessor,
  validateLedger as validatePrimitiveLedger, } from "../scripts/cloud-collaboration-primitives.mjs";
const T0 = "2026-08-04T00:00:00.000Z";
const T1 = "2026-08-04T00:10:00.000Z";
const T2 = "2026-08-04T00:20:00.000Z";
const T3 = "2026-08-04T00:30:00.000Z";
const T4 = "2026-08-04T00:40:00.000Z";
const T5 = "2026-08-04T00:50:00.000Z";
const T6 = "2026-08-04T01:00:00.000Z";
const repository = Object.freeze({ repositoryId: "repository:acos",
  canonicalRevision: revision("canonical"), });
const owner = actor("owner", "device-a", "session-a");
function actor(actorId, deviceId, sessionId) {
  return { actorId: `actor:${actorId}`, deviceId, sessionId }; }
function revision(label) { return digestValue({ label }).slice(0, 40); }
function evidence(label) { return digestValue({ evidence: label }); }
function canonicalDescendantProof({ sourceBaseSha, targetBaseSha,
  canonicalChangedPaths = ["docs/current.md"],
  preservedChangedPaths = ["scripts/preserved.mjs"] }) { const core = {
    schema: "agentic-legacy-review-current-base-disjoint-proof/v1", sourceBaseSha, targetBaseSha,
    protectedMainSha: targetBaseSha, canonicalChangedPaths,
    canonicalChangedPathsDigest: digestValue(canonicalChangedPaths), preservedChangedPaths,
    preservedChangedPathsDigest: digestValue(preservedChangedPaths),
    ancestry: "source-base-to-current-protected-main", overlap: "none", };
  return { ...core, evidenceDigest: digestValue(core) }; }
function claim(ledger, { identity = owner, targetRepository = repository, workItemId = "work:item",
  scope = ["path:docs/a.md"], leaseEpoch = 1, predecessorClaimId = null,
  canonicalBaseRevision = targetRepository.canonicalRevision, canonicalDescendantProof = null,
  time = T0, expiresAt = T4, laneRevision = canonicalBaseRevision,
  idempotencyKey = `claim:${workItemId}:${leaseEpoch}`, expectedLedgerDigest = ledger.headDigest,
} = {}) { return applyCloudTransition({ ledger, action: "claim", actor: identity,
    repository: targetRepository, evaluationTime: time, request: { workItemId,
      canonicalBaseRevision, declaredWriteScope: scope, laneRevision, leaseEpoch,
      ...(predecessorClaimId ? { predecessorClaimId } : {}),
      ...(canonicalDescendantProof ? { canonicalDescendantProof } : {}), expiresAt,
      expectedLedgerDigest, idempotencyKey, }, }); }
function continueClaim(ledger, current, { identity = owner, mode, time = T1,
  idempotencyKey = `continue:${mode}:${current.claimId}:${current.transitionCounter}`, ...request
}) { return applyCloudTransition({ ledger, action: "continue", actor: identity, repository,
    evaluationTime: time, request: { claimId: current.claimId,
      expectedFenceRevision: current.fenceRevision,
      expectedTransitionCounter: current.transitionCounter, expectedLedgerDigest: ledger.headDigest,
      mode, idempotencyKey, ...request, }, }); }
function retire(ledger, current, { identity = owner, reason = "abandoned", integrationReceiptDigest,
  time = T5, } = {}) { return applyCloudTransition({ ledger, action: "retire", actor: identity,
    repository, evaluationTime: time, request: { claimId: current.claimId,
      expectedFenceRevision: current.fenceRevision,
      expectedTransitionCounter: current.transitionCounter, expectedLedgerDigest: ledger.headDigest,
      reason, finalRevision: current.laneRevision, reviewRequestId: current.reviewRequestId,
      bytesDigest: evidence("bytes"), namedChecksDigest: evidence("checks"),
      handoffEvidenceDigest: evidence("handoff"),
      ...(integrationReceiptDigest ? { integrationReceiptDigest } : {}),
      idempotencyKey: `retire:${reason}:${current.claimId}`, }, }); }
function claimOnlyRolloverFixture({ waiterLaneRevision = revision("claim-only-historical-base"),
  retirementReason = "superseded", } = {}) {
  const historicalBase = revision("claim-only-historical-base");
  const historicalRepository = { ...repository, canonicalRevision: historicalBase };
  const scope = ["path:docs/claim-only.md", "semantic:claim-only-rollover"];
  const anchor = claim(createEmptyLedger("ledger:repository"), {
    targetRepository: historicalRepository, workItemId: "work:claim-only-anchor",
    scope: ["path:docs/claim-only.md", "semantic:claim-only-anchor"],
    canonicalBaseRevision: historicalBase, laneRevision: historicalBase, });
  const waiting = claim(anchor.ledger, { targetRepository: historicalRepository,
    workItemId: "work:claim-only-rollover", scope, canonicalBaseRevision: historicalBase,
    laneRevision: waiterLaneRevision, time: T1, idempotencyKey: "claim:claim-only-waiter", });
  const anchorRetired = retire(waiting.ledger, anchor.claim, { reason: "superseded", time: T2, });
  const predecessorRetired = retire(anchorRetired.ledger, waiting.claim, { reason: retirementReason,
    time: T3, }); const proof = canonicalDescendantProof({ sourceBaseSha: historicalBase,
    targetBaseSha: repository.canonicalRevision, canonicalChangedPaths: ["docs/protected-main.md"],
    preservedChangedPaths: ["docs/claim-only.md"], });
  return { anchorRetired, historicalBase, predecessorRetired, proof, scope, waiting }; }
function claimOnlyRollover(fixture, overrides = {}) {
  return claim(fixture.predecessorRetired.ledger, { workItemId: "work:claim-only-rollover",
    scope: fixture.scope, leaseEpoch: 2, predecessorClaimId: fixture.waiting.claim.claimId,
    canonicalBaseRevision: repository.canonicalRevision, canonicalDescendantProof: fixture.proof,
    laneRevision: repository.canonicalRevision, time: T4, expiresAt: T6,
    idempotencyKey: "claim:claim-only-rollover", ...overrides, }); }
function throwsCode(callback, code) { assert.throws(callback, (error) => {
    assert.equal(error.code, code); return true; }); }
function replaceLast(ledger, change) {
  const entries = [...ledger.entries], previous = entries.at(-1);
  const core = structuredClone(previous.claimCore); change(core);
  const { digest: ignored, ...priorDraft } = previous;
  const draft = { ...priorDraft, claimCore: core, claimDigest: digestValue(core) };
  const entry = { ...draft, digest: digestValue(draft) }; entries[entries.length - 1] = entry;
  return { ...ledger, headDigest: entry.digest, entries }; }
function appendForged(ledger, claimId, { action = "continue", time, label, change }) {
  const previous = ledger.entries.findLast((entry) => entry.claimId === claimId);
  const core = structuredClone(previous.claimCore); core.transitionCounter += 1; change(core);
  const draft = {
    schema: ENTRY_SCHEMA, sequence: ledger.sequence + 1, parentDigest: ledger.headDigest,
    action, repositoryId: core.repositoryId, claimId, idempotencyKey: evidence(`forged-id:${label}`),
    requestDigest: evidence(`forged-request:${label}`), evaluationTime: time,
    claimCore: core, claimDigest: digestValue(core), };
  const entry = { ...draft, digest: digestValue(draft) };
  return { ...ledger, sequence: entry.sequence, headDigest: entry.digest, entries: [...ledger.entries, entry] };
}
test("canonical scope logic is deterministic and bounded per claim", () => {
  assert.equal(canonicalJson({ z: 1, a: -0 }), '{"a":0,"z":1}');
  assert.deepEqual(normalizeWriteSet(["docs/a.md", "path:docs/a.md"]), ["path:docs/a.md"]);
  assert.equal(writeSetsOverlap(["path:docs"], ["path:docs/a.md"]), true); assert.deepEqual(
    findUncoveredPathScopes(["path:docs", "path:scripts/cloud"], ["docs/a.md", "__tests__/escaped.test.mjs"]),
    ["path:__tests__/escaped.test.mjs"], );
  assert.deepEqual(CLOUD_COLLABORATION_BOUNDS, { writeScopeItems: 128, textCharacters: 512 });
  throwsCode(() => normalizeWriteSet(Array.from({ length: 129 }, (_, index) => `path:${index}`)), "bound_exceeded");
});
test("public mutations are exactly claim, continue, integrate, and retire", () => {
  const initial = createEmptyLedger("ledger:repository"); const claimed = claim(initial);
  assert.equal(claimed.ledger.entries[0].schema, ENTRY_SCHEMA);
  assert.equal(claimed.claim.state, "current"); assert.equal(claimed.claim.writeAuthority, true);
  assert.equal(claimed.receipt.schema, "agentic-collaboration-claim-receipt/v1");
  for (const action of ["bind", "heartbeat", "review-ready", "delivery-authorize", "handoff", "release"]) {
    throwsCode(() => applyCloudTransition({ ledger: claimed.ledger, action, actor: owner,
      repository, evaluationTime: T1, request: {}, }), "invalid_action"); } });
test("claim is CAS-fenced, device-neutral, replay-safe, and actor-authenticated", () => {
  const initial = createEmptyLedger("ledger:repository");
  const options = { idempotencyKey: "claim:stable" }; const first = claim(initial, options);
  const otherProjection = claim(initial, { ...options,
    identity: actor("owner", "device-b", "session-b"), });
  assert.equal(first.claim.claimId, otherProjection.claim.claimId);
  const replay = claim(first.ledger, { ...options, idempotencyKey: "claim:stable", });
  assert.equal(replay.replayed, true); assert.equal(replay.claimDigest, first.claimDigest);
  throwsCode(() => claim(first.ledger, { workItemId: "work:other",
    idempotencyKey: "claim:stale-cas", expectedLedgerDigest: evidence("stale"),
  }), "stale_ledger_digest"); const request = { claimId: first.claim.claimId,
    expectedFenceRevision: first.claim.fenceRevision,
    expectedTransitionCounter: first.claim.transitionCounter,
    expectedLedgerDigest: first.ledger.headDigest, mode: "renewal", expiresAt: T5,
    idempotencyKey: "continue:wrong-actor", }; throwsCode(() => applyCloudTransition({
    ledger: first.ledger, action: "continue", actor: actor("intruder", "device-a", "session-a"),
    repository, evaluationTime: T1, request, }), "claim_owner_mismatch");
  throwsCode(() => applyCloudTransition({ ledger: first.ledger, action: "continue", actor: owner,
    repository, evaluationTime: T1,
    request: { ...request, expectedLedgerDigest: evidence("stale") }, }), "stale_ledger_digest");
});
test("an exact idempotent proof-bearing claim replays after ledger and protected main advance", () => {
  const fixture = claimOnlyRolloverFixture();
  const sealedParent = fixture.predecessorRetired.ledger.headDigest;
  const claimed = claimOnlyRollover(fixture);
  const later = claim(claimed.ledger, {
    workItemId: "work:after-sealed-proof-replay",
    scope: ["path:docs/after-sealed-proof-replay.md"],
    time: T5,
    expiresAt: T6,
    idempotencyKey: "claim:after-sealed-proof-replay",
  });
  const request = {
    workItemId: "work:claim-only-rollover",
    canonicalBaseRevision: repository.canonicalRevision,
    declaredWriteScope: fixture.scope,
    laneRevision: repository.canonicalRevision,
    leaseEpoch: 2,
    predecessorClaimId: fixture.waiting.claim.claimId,
    canonicalDescendantProof: fixture.proof,
    expiresAt: T6,
    expectedLedgerDigest: sealedParent,
    idempotencyKey: "claim:claim-only-rollover",
  };
  const advancedRepository = {
    ...repository,
    canonicalRevision: revision("advanced-after-sealed-proof-claim"),
  };
  const ledgerBytes = canonicalJson(later.ledger);
  const replay = applyCloudTransition({
    ledger: later.ledger,
    action: "claim",
    actor: owner,
    repository: advancedRepository,
    evaluationTime: T5,
    request,
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.claimDigest, claimed.claimDigest);
  assert.strictEqual(replay.ledger, later.ledger);
  assert.equal(canonicalJson(replay.ledger), ledgerBytes);
  throwsCode(() => applyCloudTransition({
    ledger: later.ledger,
    action: "claim",
    actor: owner,
    repository: advancedRepository,
    evaluationTime: T5,
    request: { ...request, expiresAt: "2026-08-04T02:00:00.000Z" },
  }), "idempotency_conflict");
  throwsCode(() => applyCloudTransition({
    ledger: later.ledger,
    action: "continue",
    actor: owner,
    repository: advancedRepository,
    evaluationTime: T5,
    request: {
      claimId: claimed.claim.claimId,
      expectedFenceRevision: claimed.claim.fenceRevision,
      expectedTransitionCounter: claimed.claim.transitionCounter,
      expectedLedgerDigest: later.ledger.headDigest,
      mode: "projection",
      laneRevision: claimed.claim.laneRevision,
      idempotencyKey: request.idempotencyKey,
    },
  }), "idempotency_conflict");
  for (const equivalentObservation of [
    { ...request, expectedLedgerDigest: claimed.ledger.headDigest },
    { ...request, expectedLedgerDigest: null },
  ]) {
    const equivalentReplay = applyCloudTransition({
      ledger: later.ledger,
      action: "claim",
      actor: owner,
      repository: advancedRepository,
      evaluationTime: T5,
      request: equivalentObservation,
    });
    assert.equal(equivalentReplay.replayed, true);
  }
  assert.throws(() => applyCloudTransition({
    ledger: later.ledger,
    action: "claim",
    actor: owner,
    repository: advancedRepository,
    evaluationTime: T5,
    request: { ...request, idempotencyKey: "claim:absent-idempotent-proof-replay" },
  }));
  assert.equal(canonicalJson(later.ledger), ledgerBytes);
});
test("claim observation rebases across disjoint audit entries but not a changed conflict set", () => {
  const baseline = claim(createEmptyLedger("ledger:repository"), {
    workItemId: "work:baseline",
    scope: ["path:docs/baseline.md"],
    idempotencyKey: "claim:baseline",
  });
  const observedHead = baseline.ledger.headDigest;
  const disjoint = claim(baseline.ledger, {
    workItemId: "work:disjoint-peer",
    scope: ["path:docs/disjoint-peer.md"],
    time: T1,
    idempotencyKey: "claim:disjoint-peer",
  });
  const rebased = claim(disjoint.ledger, {
    workItemId: "work:rebased-candidate",
    scope: ["path:scripts/rebased-candidate.mjs"],
    time: T2,
    expectedLedgerDigest: observedHead,
    idempotencyKey: "claim:rebased-candidate",
  });
  assert.equal(rebased.acceptedParentDigest, disjoint.ledger.headDigest);
  assert.match(rebased.conflictSetDigest, /^[0-9a-f]{64}$/u);

  const empty = createEmptyLedger("ledger:repository");
  const overlapping = claim(empty, {
    workItemId: "work:overlapping-peer",
    scope: ["path:scripts/shared.mjs"],
    idempotencyKey: "claim:overlapping-peer",
  });
  throwsCode(() => claim(overlapping.ledger, {
    workItemId: "work:overlapping-candidate",
    scope: ["path:scripts/shared.mjs"],
    time: T1,
    expectedLedgerDigest: null,
    idempotencyKey: "claim:overlapping-candidate",
  }), "stale_ledger_digest");

  const sameWork = claim(empty, {
    workItemId: "work:shared-identity",
    scope: ["path:docs/one.md"],
    idempotencyKey: "claim:same-work-peer",
  });
  throwsCode(() => claim(sameWork.ledger, {
    workItemId: "work:shared-identity",
    scope: ["path:docs/two.md"],
    time: T1,
    expectedLedgerDigest: null,
    idempotencyKey: "claim:same-work-candidate",
  }), "stale_ledger_digest");
});
test("unlimited disjoint authorities have no policy cardinality cap", () => {
  let ledger = createEmptyLedger("ledger:repository");
  for (let index = 0; index < 140; index += 1) { ledger = claim(ledger, {
      workItemId: `work:${index}`, scope: [`path:shards/${index}.md`],
      idempotencyKey: `claim:shard:${index}`, }).ledger; }
  const claims = listCurrentClaims(ledger, T1); assert.equal(claims.length, 140);
  assert.equal(claims.every((item) => item.state === "current"), true);
  assert.deepEqual(validateLedger(ledger), []); });
test("overlapping claims wait and only the deterministic successor can promote", () => {
  const first = claim(createEmptyLedger("ledger:repository"), { workItemId: "work:a" });
  const second = claim(first.ledger, { workItemId: "work:b", time: T1, idempotencyKey: "claim:b" });
  const third = claim(second.ledger, { workItemId: "work:c", time: T2, idempotencyKey: "claim:c" });
  assert.equal(second.claim.state, "waiting-successor");
  assert.equal(third.claim.state, "waiting-successor");
  const retired = retire(third.ledger, first.claim, { time: T3 });
  throwsCode(() => continueClaim(retired.ledger, third.claim, { mode: "promote", time: T4,
    expiresAt: T6, }), "successor_not_selected");
  const promoted = continueClaim(retired.ledger, second.claim, { mode: "promote", time: T4,
    expiresAt: T6, }); assert.equal(promoted.claim.state, "current");
  throwsCode(() => continueClaim(promoted.ledger, third.claim, { mode: "promote", time: T5,
    expiresAt: "2026-08-04T02:00:00.000Z", }), "overlap_still_reserved"); });
test("an actor can retire its orphaned waiting successor without the expired device lease", () => {
  const current = claim(createEmptyLedger("ledger:repository"), { workItemId: "work:current" });
  const waiting = claim(current.ledger, { workItemId: "work:waiting", time: T1,
    idempotencyKey: "claim:orphaned-waiting", });
  assert.equal(waiting.claim.state, "waiting-successor");
  throwsCode(() => retire(waiting.ledger, waiting.claim, {
    identity: actor("intruder", "device-recovered", "session-recovered"), time: T2,
  }), "claim_owner_mismatch"); const retired = retire(waiting.ledger, waiting.claim, {
    identity: actor("owner", "device-recovered", "session-recovered"), time: T2, });
  assert.equal(retired.claim.state, "retired"); });
test("a named predecessor must resolve to the exact preserved matching authority", () => {
  const initial = createEmptyLedger("ledger:repository"); throwsCode(() => claim(initial, {
    predecessorClaimId: evidence("invented-predecessor"),
    idempotencyKey: "claim:invented-predecessor", }), "predecessor_identity_mismatch");
  const first = claim(initial); const retired = retire(first.ledger, first.claim, { time: T1 });
  const successor = claim(retired.ledger, { leaseEpoch: 2, predecessorClaimId: first.claim.claimId,
    time: T2, expiresAt: T6, idempotencyKey: "claim:retired-predecessor", });
  assert.equal(successor.claim.state, "current");
  assert.equal(successor.claim.predecessorClaimId, first.claim.claimId); });
test("a terminal matching subject admits its historical PR base only with exact disjoint descendant proof", async () => {
  const predecessorBase = revision("predecessor-base");
  const historicalBase = revision("historical-pr-base");
  const laneRevision = revision("preserved-head");
  const predecessorRepository = { ...repository, canonicalRevision: predecessorBase };
  const first = claim(createEmptyLedger("ledger:repository"), {
    targetRepository: predecessorRepository, laneRevision, });
  const retired = retire(first.ledger, first.claim, { time: T1 });
  const proof = canonicalDescendantProof({ sourceBaseSha: historicalBase,
    targetBaseSha: repository.canonicalRevision }); const successor = claim(retired.ledger, {
    canonicalBaseRevision: historicalBase, canonicalDescendantProof: proof,
    predecessorClaimId: first.claim.claimId, laneRevision, leaseEpoch: 2, time: T2, expiresAt: T6,
    idempotencyKey: "claim:historical-pr-base", }); assert.equal(successor.claim.state, "current");
  assert.equal(successor.claim.canonicalBaseRevision, historicalBase);
  const schema = JSON.parse(await readFile(new URL(
    "../docs/schemas/cloud-collaboration-ledger.v1.schema.json", import.meta.url, ), "utf8"));
  const validate = new Ajv2020({ strict: false, formats: { "date-time": true } }).compile(schema);
  assert.equal(validate(successor.ledger), true, JSON.stringify(validate.errors));
  for (const invalidProof of [ { ...proof, targetBaseSha: revision("foreign-protected") },
    canonicalDescendantProof({ sourceBaseSha: historicalBase,
      targetBaseSha: repository.canonicalRevision,
      canonicalChangedPaths: ["scripts/preserved.mjs"] }),
    { ...proof, evidenceDigest: evidence("forged-proof") }, ]) {
    assert.throws(() => claim(retired.ledger, { canonicalBaseRevision: historicalBase,
      canonicalDescendantProof: invalidProof, predecessorClaimId: first.claim.claimId, laneRevision,
      leaseEpoch: 2, time: T2, expiresAt: T6,
      idempotencyKey: `claim:invalid-proof:${invalidProof.evidenceDigest}`,
    }), error => error?.code === "invalid_request"); } });
test("a retired claim-only waiting successor rolls to the exact current protected base", async () => {
  const fixture = claimOnlyRolloverFixture(); const successor = claimOnlyRollover(fixture);
  assert.equal(successor.claim.state, "current");
  assert.equal(successor.claim.predecessorClaimId, fixture.waiting.claim.claimId);
  assert.equal(successor.claim.canonicalBaseRevision, repository.canonicalRevision);
  assert.equal(successor.claim.laneRevision, repository.canonicalRevision);
  assert.equal(successor.claim.leaseEpoch, 2);
  assert.strictEqual(validateLedger, validatePrimitiveLedger);
  assert.deepEqual(validateLedger(successor.ledger), []);
  assert.deepEqual(validatePrimitiveLedger(successor.ledger), []);
  const later = claim(successor.ledger, { workItemId: "work:after-claim-only-rollover",
    scope: ["path:docs/after-claim-only.md"], time: T5, expiresAt: T6,
    idempotencyKey: "claim:after-claim-only-rollover", });
  assert.deepEqual(validatePrimitiveLedger(later.ledger), []);
  const schema = JSON.parse(await readFile(new URL(
    "../docs/schemas/cloud-collaboration-ledger.v1.schema.json", import.meta.url, ), "utf8"));
  const validate = new Ajv2020({ strict: false, formats: { "date-time": true } }).compile(schema);
  assert.equal(validate(successor.ledger), true, JSON.stringify(validate.errors)); });
test("claim-only rollover rejects authored, heartbeat, review, evidence, recovery, integration, and intermediate history", () => {
  const fixture = claimOnlyRolloverFixture(); const intent = claimOnlyRollover(fixture).claim;
  const history = fixture.predecessorRetired.ledger.entries
    .filter(entry => entry.claimId === fixture.waiting.claim.claimId);
  const match = predecessorHistory => rolloverPredecessor({
    predecessorHistory, intent, protectedRevision: repository.canonicalRevision, });
  assert.equal(match(history)?.claimId, fixture.waiting.claim.claimId);
  for (const entries of [{}, "not-an-array", [null], [undefined]]) assert.equal(rolloverPredecessor({
    ledger: { entries }, intent, protectedRevision: repository.canonicalRevision, }), null);
  const mutations = [
    ["authored", source => { source.laneRevision = revision("authored-waiter"); }],
    ["heartbeat", source => { source.heartbeatCounter = 1; }],
    ["review", source => { source.reviewRequestId = "review:forbidden"; }],
    ["evidence", source => { source.evidenceDigest = evidence("forbidden"); }],
    ["recovery", source => { source.recovery = { evidenceDigest: evidence("recovery") }; }],
    ["integration", source => { source.integration = { candidateRevision: source.laneRevision }; }],
    ["intermediate", (_source, altered) => { altered.splice(1, 0, structuredClone(altered[0])); }],
  ]; for (const [label, mutate] of mutations) { const altered = structuredClone(history);
    mutate(altered[0].claimCore, altered); assert.equal(match(altered), null, label); } });
test("claim-only successor base rollover preserves exact identity, scope, and epoch", () => {
  const fixture = claimOnlyRolloverFixture(); const identityMismatches = [
    { identity: actor("intruder", "device-a", "session-a") },
    { identity: actor("owner", "device-b", "session-a") },
    { identity: actor("owner", "device-a", "session-b") },
    { workItemId: "work:other", leaseEpoch: 1 },
    { scope: ["path:docs/other.md", "semantic:other"], leaseEpoch: 1 },
    { targetRepository: { repositoryId: "repository:other",
      canonicalRevision: repository.canonicalRevision }, leaseEpoch: 1 }, ];
  for (const [index, mismatch] of identityMismatches.entries()) {
    throwsCode(() => claimOnlyRollover(fixture, {
      idempotencyKey: `claim:claim-only-identity-negative:${index}`, ...mismatch,
    }), "invalid_request"); } throwsCode(() => claimOnlyRollover(fixture, { leaseEpoch: 3,
    idempotencyKey: "claim:claim-only-epoch-negative", }), "invalid_request"); });
test("claim-only successor base rollover requires exact proof and terminal predecessor state", () => {
  const fixture = claimOnlyRolloverFixture(); const invalidProofs = [ canonicalDescendantProof({
      sourceBaseSha: revision("wrong-source"), targetBaseSha: repository.canonicalRevision, }),
    canonicalDescendantProof({ sourceBaseSha: fixture.historicalBase,
      targetBaseSha: revision("wrong-target"), }), canonicalDescendantProof({
      sourceBaseSha: fixture.historicalBase, targetBaseSha: repository.canonicalRevision,
      canonicalChangedPaths: ["docs/claim-only.md"], preservedChangedPaths: ["docs/claim-only.md"],
    }), { ...fixture.proof, evidenceDigest: evidence("forged-claim-only-proof") }, ];
  for (const [index, proof] of invalidProofs.entries()) {
    throwsCode(() => claimOnlyRollover(fixture, { canonicalDescendantProof: proof,
      idempotencyKey: `claim:claim-only-proof-negative:${index}`, }), "invalid_request"); }
  const nonRetired = claim(fixture.anchorRetired.ledger, { workItemId: "work:claim-only-rollover",
    scope: fixture.scope, leaseEpoch: 2, predecessorClaimId: fixture.waiting.claim.claimId,
    canonicalBaseRevision: repository.canonicalRevision, laneRevision: repository.canonicalRevision,
    time: T4, expiresAt: T6, idempotencyKey: "claim:claim-only-non-retired-negative", });
  assert.equal(nonRetired.claim.state, "waiting-successor");
  assert.equal(nonRetired.claim.writeAuthority, false);
  const abandoned = claimOnlyRolloverFixture({ retirementReason: "abandoned" });
  assert.throws(() => claimOnlyRollover(abandoned));
  const nonCurrent = revision("non-current-target");
  const nonCurrentProof = canonicalDescendantProof({ sourceBaseSha: fixture.historicalBase,
    targetBaseSha: nonCurrent, }); assert.throws(() => claimOnlyRollover(fixture, {
    canonicalBaseRevision: nonCurrent, canonicalDescendantProof: nonCurrentProof,
    laneRevision: nonCurrent, idempotencyKey: "claim:claim-only-non-current-negative", }));
  assert.throws(() => claimOnlyRollover(fixture, { targetRepository: "repository:acos",
    idempotencyKey: "claim:claim-only-unresolved-current-negative", })); });
test("a current predecessor admits a stale-base strict-superset waiting successor only with proof", () => {
  const historicalBase = revision("strict-superset-historical-base");
  const laneRevision = revision("strict-superset-lane");
  const historicalRepository = { ...repository, canonicalRevision: historicalBase };
  const predecessor = claim(createEmptyLedger("ledger:repository"), {
    targetRepository: historicalRepository, workItemId: "work:scope-expansion",
    scope: ["path:src/owned", "semantic:scope-expansion"], canonicalBaseRevision: historicalBase,
    laneRevision, }); const expandedScope = [
    "path:src/new-runtime", "path:src/owned", "semantic:scope-expansion", ];
  const proof = canonicalDescendantProof({ sourceBaseSha: historicalBase,
    targetBaseSha: repository.canonicalRevision, canonicalChangedPaths: ["docs/current.md"],
    preservedChangedPaths: ["src/new-runtime", "src/owned"], });
  const successor = claim(predecessor.ledger, { workItemId: "work:scope-expansion",
    scope: expandedScope, canonicalBaseRevision: historicalBase, canonicalDescendantProof: proof,
    predecessorClaimId: predecessor.claim.claimId, laneRevision, time: T1,
    idempotencyKey: "claim:strict-superset-descendant", });
  assert.equal(successor.claim.state, "waiting-successor");
  assert.equal(successor.claim.predecessorClaimId, predecessor.claim.claimId);
  assert.deepEqual(successor.claim.declaredWriteScope, normalizeWriteSet(expandedScope));
  throwsCode(() => claim(predecessor.ledger, { workItemId: "work:scope-expansion",
    scope: expandedScope, canonicalBaseRevision: historicalBase,
    predecessorClaimId: predecessor.claim.claimId, laneRevision, time: T1,
    idempotencyKey: "claim:strict-superset-without-proof", }), "stale_canonical_base"); });
test("a reviewed predecessor admits only its exact unchanged-scope successor on the recorded base", () => {
  const historicalBase = revision("reviewed-predecessor-base");
  const laneRevision = revision("reviewed-predecessor-lane");
  const historicalRepository = { ...repository, canonicalRevision: historicalBase };
  const claimed = claim(createEmptyLedger("ledger:repository"), {
    targetRepository: historicalRepository, workItemId: "work:reviewed-correction",
    canonicalBaseRevision: historicalBase, laneRevision, });
  const projected = continueClaim(claimed.ledger, claimed.claim, { mode: "projection", laneRevision,
    reviewRequestId: "review:reviewed-correction", });
  const reviewed = continueClaim(projected.ledger, projected.claim, { mode: "review", time: T2,
    laneRevision, reviewRequestId: projected.claim.reviewRequestId,
    focusedEvidenceDigest: evidence("reviewed-correction"), });
  const successor = claim(reviewed.ledger, { workItemId: reviewed.claim.workItemId,
    scope: reviewed.claim.declaredWriteScope, canonicalBaseRevision: historicalBase,
    predecessorClaimId: reviewed.claim.claimId, laneRevision, leaseEpoch: 2, time: T3,
    expiresAt: T6, idempotencyKey: "claim:reviewed-correction-successor", });
  assert.equal(successor.claim.state, "waiting-successor");
  assert.equal(successor.claim.predecessorClaimId, reviewed.claim.claimId);
  throwsCode(() => claim(reviewed.ledger, { workItemId: "work:foreign-correction",
    scope: reviewed.claim.declaredWriteScope, canonicalBaseRevision: historicalBase,
    predecessorClaimId: reviewed.claim.claimId, laneRevision, leaseEpoch: 2, time: T3,
    expiresAt: T6, idempotencyKey: "claim:foreign-reviewed-correction", }), "stale_canonical_base");
  throwsCode(() => claim(reviewed.ledger, { workItemId: reviewed.claim.workItemId,
    scope: [...reviewed.claim.declaredWriteScope, "path:docs/expanded.md"],
    canonicalBaseRevision: historicalBase, predecessorClaimId: reviewed.claim.claimId, laneRevision,
    leaseEpoch: 2, time: T3, expiresAt: T6, idempotencyKey: "claim:expanded-reviewed-correction",
  }), "stale_canonical_base"); });
test("expiry is dormant-preserved and recovery ignores the expired device lease", () => {
  const first = claim(createEmptyLedger("ledger:repository"), { expiresAt: T1 });
  const dormant = listCurrentClaims(first.ledger, T2)[0];
  assert.equal(dormant.state, "dormant-preserved"); assert.equal(dormant.writeAuthority, false);
  assert.equal(dormant.scopeReserved, true);
  const waiting = claim(first.ledger, { workItemId: "work:successor", time: T2, expiresAt: T6 });
  assert.equal(waiting.claim.state, "waiting-successor");
  const recovered = continueClaim(waiting.ledger, dormant, {
    identity: actor("owner", "device-recovered", "session-recovered"), mode: "recovery", time: T3,
    expiresAt: T6, recoveryEvidenceDigest: evidence("recovery"), });
  assert.equal(recovered.claim.state, "current");
  assert.equal(recovered.claim.deviceId, "device-recovered"); });
test("review identity is immutable; integrate preserves; retire joins the typed receipt", () => {
  const first = claim(createEmptyLedger("ledger:repository"));
  const projected = continueClaim(first.ledger, first.claim, { mode: "projection",
    laneRevision: revision("candidate"), reviewRequestId: "review:1", });
  const reviewed = continueClaim(projected.ledger, projected.claim, { mode: "review", time: T2,
    laneRevision: projected.claim.laneRevision, reviewRequestId: "review:1",
    focusedEvidenceDigest: evidence("focused"), }); assert.equal(reviewed.claim.state, "reviewed");
  assert.equal(reviewed.claim.writeAuthority, false);
  throwsCode(() => continueClaim(reviewed.ledger, reviewed.claim, { mode: "review", time: T3,
    laneRevision: reviewed.claim.laneRevision, reviewRequestId: "review:2",
    focusedEvidenceDigest: evidence("other"), }), "stale_review_identity");
  const integrated = applyCloudTransition({ ledger: reviewed.ledger, action: "integrate",
    actor: owner, repository, evaluationTime: T3, request: { claimId: reviewed.claim.claimId,
      expectedFenceRevision: reviewed.claim.fenceRevision,
      expectedTransitionCounter: reviewed.claim.transitionCounter,
      expectedLedgerDigest: reviewed.ledger.headDigest,
      candidateRevision: reviewed.claim.laneRevision,
      reviewRequestId: reviewed.claim.reviewRequestId,
      focusedEvidenceDigest: reviewed.claim.evidenceDigest,
      dependencyClosureDigest: evidence("dependencies"),
      namedChecksDigest: evidence("named-checks"), handoffEvidenceDigest: evidence("handoff"),
      operatorDecisionDigest: evidence("operator"), integrationIntentDigest: evidence("intent"),
      idempotencyKey: "integrate:review-1", }, });
  assert.equal(integrated.claim.state, "integrated-preserved");
  assert.equal(integrated.receipt.schema, "agentic-collaboration-integration-receipt/v1");
  throwsCode(() => retire(integrated.ledger, integrated.claim, { reason: "integrated",
    integrationReceiptDigest: evidence("not-the-receipt"), }), "integration_receipt_mismatch");
  const retired = retire(integrated.ledger, integrated.claim, { reason: "integrated",
    integrationReceiptDigest: integrated.receipt.receiptDigest, });
  assert.equal(retired.claim.state, "retired");
  assert.equal(retired.receipt.schema, "agentic-collaboration-retirement-receipt/v1"); });
test("verification can recover one exact integrated entry through renewal and valid retirement", () => {
  const claimed = claim(createEmptyLedger("ledger:repository"), { expiresAt: T4 });
  const projected = continueClaim(claimed.ledger, claimed.claim, { mode: "projection",
    laneRevision: revision("historical-candidate"), reviewRequestId: "review:historical", });
  const reviewed = continueClaim(projected.ledger, projected.claim, { mode: "review", time: T2,
    laneRevision: projected.claim.laneRevision, reviewRequestId: projected.claim.reviewRequestId,
    focusedEvidenceDigest: evidence("historical-focused"), });
  const integrated = applyCloudTransition({ ledger: reviewed.ledger, action: "integrate",
    actor: owner, repository, evaluationTime: T3, request: { claimId: reviewed.claim.claimId,
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
      idempotencyKey: "integrate:historical", }, });
  const renewed = continueClaim(integrated.ledger, integrated.claim, { mode: "renewal",
    time: "2026-08-04T00:35:00.000Z", expiresAt: T6, });
  const retired = retire(renewed.ledger, renewed.claim, { reason: "integrated",
    integrationReceiptDigest: integrated.receipt.receiptDigest, }); const request = {
    claimId: integrated.claim.claimId, fenceRevision: integrated.claim.fenceRevision,
    requiredState: "integrated-preserved", allowRetiredIntegratedPreserved: true,
    integrationReceiptDigest: integrated.receipt.receiptDigest,
    transitionCounter: integrated.claim.transitionCounter, }; const verified = verifyCloudClaim({
    ledger: retired.ledger, request, evaluationTime: T5, }); assert.equal(verified.ok, true);
  assert.equal(verified.claim.state, "integrated-preserved");
  assert.equal(verified.claimDigest, integrated.claim.fenceRevision);
  for (const mutation of [ { allowRetiredIntegratedPreserved: false },
    { integrationReceiptDigest: evidence("wrong-integration") },
    { transitionCounter: integrated.claim.transitionCounter - 1 }, ]) {
    const blocked = verifyCloudClaim({ ledger: retired.ledger, request: { ...request, ...mutation },
      evaluationTime: T5, }); assert.equal(blocked.ok, false); } });
test("verification accepts only same-identity integrated-preserved continuations", () => {
  const claimed = claim(createEmptyLedger("ledger:repository"), { expiresAt: T4 });
  const projected = continueClaim(claimed.ledger, claimed.claim, { mode: "projection",
    laneRevision: revision("heartbeat-candidate"), reviewRequestId: "review:heartbeat", });
  const reviewed = continueClaim(projected.ledger, projected.claim, { mode: "review", time: T2,
    laneRevision: projected.claim.laneRevision, reviewRequestId: projected.claim.reviewRequestId,
    focusedEvidenceDigest: evidence("heartbeat-focused"), });
  const integrated = applyCloudTransition({ ledger: reviewed.ledger, action: "integrate",
    actor: owner, repository, evaluationTime: T3, request: { claimId: reviewed.claim.claimId,
      expectedFenceRevision: reviewed.claim.fenceRevision,
      expectedTransitionCounter: reviewed.claim.transitionCounter,
      expectedLedgerDigest: reviewed.ledger.headDigest,
      candidateRevision: reviewed.claim.laneRevision,
      reviewRequestId: reviewed.claim.reviewRequestId,
      focusedEvidenceDigest: reviewed.claim.evidenceDigest,
      dependencyClosureDigest: evidence("heartbeat-dependencies"),
      namedChecksDigest: evidence("heartbeat-checks"),
      handoffEvidenceDigest: evidence("heartbeat-handoff"),
      operatorDecisionDigest: evidence("heartbeat-operator"),
      integrationIntentDigest: evidence("heartbeat-intent"), idempotencyKey: "integrate:heartbeat",
    }, }); const renewed = continueClaim(integrated.ledger, integrated.claim, { mode: "renewal",
    time: "2026-08-04T00:35:00.000Z", expiresAt: T6, }); const request = {
    claimId: integrated.claim.claimId, fenceRevision: integrated.claim.fenceRevision,
    requiredState: "integrated-preserved",
    integrationReceiptDigest: integrated.receipt.receiptDigest,
    transitionCounter: integrated.claim.transitionCounter, }; const verified = verifyCloudClaim({
    ledger: renewed.ledger, request, evaluationTime: T5, }); assert.equal(verified.ok, true);
  assert.equal(verified.claim.fenceRevision, integrated.claim.fenceRevision);
  const dormant = listCurrentClaims(integrated.ledger, T5)[0];
  const recovered = continueClaim(integrated.ledger, dormant, { mode: "recovery", time: T5,
    expiresAt: "2026-08-04T02:00:00.000Z",
    recoveryEvidenceDigest: evidence("same-identity-integrated-recovery"), });
  const recoveredVerification = verifyCloudClaim({ ledger: recovered.ledger, request,
    evaluationTime: T6, }); assert.equal(recoveredVerification.ok, true);
  const transferredRecovery = continueClaim(integrated.ledger, dormant, {
    identity: actor("owner", "device-recovered", "session-recovered"), mode: "recovery", time: T5,
    expiresAt: "2026-08-04T02:00:00.000Z",
    recoveryEvidenceDigest: evidence("transferred-integrated-recovery"), });
  const blocked = verifyCloudClaim({ ledger: transferredRecovery.ledger, request,
    evaluationTime: T6, }); assert.equal(blocked.ok, false); });
test("verification blocks a reviewed claim whose observed pull-request paths escape its declared scope", () => {
  const claimed = claim(createEmptyLedger("ledger:repository"), {
    scope: ["path:docs", "path:scripts/cloud"], });
  const projected = continueClaim(claimed.ledger, claimed.claim, { mode: "projection",
    laneRevision: revision("scope-reviewed"), reviewRequestId: "review:scope-reviewed", });
  const reviewed = continueClaim(projected.ledger, projected.claim, { mode: "review", time: T2,
    laneRevision: projected.claim.laneRevision, reviewRequestId: projected.claim.reviewRequestId,
    focusedEvidenceDigest: evidence("scope-reviewed"), }); const blocked = verifyCloudClaim({
    ledger: reviewed.ledger, request: { claimId: reviewed.claim.claimId, requiredState: "reviewed",
      reviewRequestId: reviewed.claim.reviewRequestId,
      focusedEvidenceDigest: reviewed.claim.evidenceDigest, observedChangedPaths: [
        "docs/ACTIVE-PUBLISH-SUCCESSOR-DORMANT-RECOVERY.md",
        "__tests__/expired-committed-heartbeat-recovery.test.mjs", ], }, evaluationTime: T2, });
  assert.equal(blocked.ok, false); assert.equal(
    blocked.findings.some((finding) => finding.type === "declared-write-scope-unproven"), true, );
  assert.deepEqual(
    blocked.findings.find((finding) => finding.type === "declared-write-scope-unproven")?.scope,
    ["path:__tests__/expired-committed-heartbeat-recovery.test.mjs"], ); });
test("ledger validation rejects hash-consistent forged authority semantics", () => {
  const first = claim(createEmptyLedger("ledger:repository"), { expiresAt: T6 });
  const waiting = claim(first.ledger, { workItemId: "work:waiting", time: T1, expiresAt: T6 });
  const admission = replaceLast(waiting.ledger, (core) => { core.state = "current"; core.eligibleSince = null; });
  assert.match(validateLedger(admission).join("; "), /claim queue admission|overlapping scope/);
  const third = claim(waiting.ledger, { workItemId: "work:third", time: T2, expiresAt: T6 });
  const predecessorRetired = retire(third.ledger, first.claim, { time: T3 });
  const priority = appendForged(predecessorRetired.ledger, third.claim.claimId, {
    time: T4, label: "priority", change(core) { core.state = "current"; core.expiresAt = T6; core.promotedAt = T4; },
  }); assert.match(validateLedger(priority).join("; "), /successor promotion/);
  const projected = continueClaim(first.ledger, first.claim, {
    mode: "projection", time: T1, laneRevision: revision("reviewed"), reviewRequestId: "review:forged",
  }); const reviewed = continueClaim(projected.ledger, projected.claim, {
    mode: "review", time: T2, laneRevision: projected.claim.laneRevision,
    reviewRequestId: projected.claim.reviewRequestId, focusedEvidenceDigest: evidence("reviewed"),
  }); const identity = appendForged(reviewed.ledger, reviewed.claim.claimId, {
    time: T3, label: "review-identity", change(core) {
      core.laneRevision = revision("rewritten"); core.reviewRequestId = "review:rewritten"; core.evidenceDigest = evidence("rewritten");
    }, }); assert.match(validateLedger(identity).join("; "), /reviewed continuation/);
  const integration = appendForged(reviewed.ledger, reviewed.claim.claimId, {
    action: "integrate", time: T3, label: "integration", change(core) { core.state = "integrated-preserved"; },
  }); assert.match(validateLedger(integration).join("; "), /typed integration evidence/);
  const preservation = appendForged(first.ledger, first.claim.claimId, {
    time: T1, label: "preservation", change(core) { core.state = "dormant-preserved"; }, });
  assert.match(validateLedger(preservation).join("; "), /preservation evidence/);
  const expired = claim(createEmptyLedger("ledger:repository"), { expiresAt: T1 });
  const recovery = appendForged(expired.ledger, expired.claim.claimId, {
    time: T2, label: "recovery", change(core) { core.state = "current"; core.expiresAt = T6; }, });
  assert.match(validateLedger(recovery).join("; "), /dormant recovery/);
  const retirement = appendForged(first.ledger, first.claim.claimId, {
    action: "retire", time: T1, label: "retirement", change(core) { core.state = "retired"; }, });
  assert.match(validateLedger(retirement).join("; "), /typed retirement evidence/);
  const backwardsBase = claim(createEmptyLedger("ledger:repository"), { time: T2, expiresAt: T6 });
  const backwards = appendForged(backwardsBase.ledger, backwardsBase.claim.claimId, {
    time: T1, label: "time", change() {}, });
  assert.match(validateLedger(backwards).join("; "), /evaluationTime is not monotonic/);
  const staleState = replaceLast(first.ledger, (core) => { core.state = "integrating"; });
  assert.match(validateLedger(staleState).join("; "), /claimCore.state is invalid/); });
test("historical v1 bytes validate unchanged and continue one-way into v2", () => {
  const legacy = legacyLedger(); const bytes = canonicalJson(legacy);
  assert.deepEqual(validateLedger(legacy), []); assert.equal(canonicalJson(legacy), bytes);
  const previous = legacy.entries.at(-1); const continued = applyCloudTransition({ ledger: legacy,
    action: "continue", actor: owner, repository: { repositoryId: repository.repositoryId },
    evaluationTime: T2, request: { claimId: previous.claimId,
      expectedFenceRevision: previous.claimDigest, expectedTransitionCounter: 2,
      expectedLedgerDigest: legacy.headDigest, mode: "renewal", expiresAt: T6,
      idempotencyKey: "legacy-to-v2", }, });
  assert.equal(continued.ledger.entries.at(-1).schema, ENTRY_SCHEMA);
  assert.equal(continued.claim.claimIdentitySchema, LEGACY_ENTRY_SCHEMA);
  assert.equal(continued.claim.state, "current");
  assert.deepEqual(validateLedger(continued.ledger), []);
  const reviewedLegacy = legacyReviewedLedger();
  const reviewedEntry = reviewedLegacy.entries.at(-1); const integrated = applyCloudTransition({
    ledger: reviewedLegacy, action: "integrate", actor: owner,
    repository: { repositoryId: repository.repositoryId }, evaluationTime: T3, request: {
      claimId: reviewedEntry.claimId, expectedFenceRevision: reviewedEntry.claimDigest,
      expectedTransitionCounter: 3, expectedLedgerDigest: reviewedLegacy.headDigest,
      candidateRevision: reviewedEntry.claimCore.laneRevision,
      reviewRequestId: reviewedEntry.claimCore.reviewRequestId,
      focusedEvidenceDigest: reviewedEntry.claimCore.evidenceDigest,
      dependencyClosureDigest: evidence("legacy-dependencies"),
      namedChecksDigest: evidence("legacy-checks"),
      handoffEvidenceDigest: evidence("legacy-handoff"),
      operatorDecisionDigest: evidence("legacy-operator"),
      integrationIntentDigest: evidence("legacy-integration"),
      idempotencyKey: "legacy-review-to-v2", }, });
  assert.equal(integrated.claim.state, "integrated-preserved");
  assert.deepEqual(validateLedger(integrated.ledger), []);
  const overlap = legacyOverlapLedger();
  const target = listCurrentClaims(overlap, T3).find((claim) => claim.workItemId === "legacy:work");
  const projected = continueClaim(overlap, target, { mode: "projection", time: T3,
    laneRevision: revision("legacy-migration"), reviewRequestId: "review:legacy-migration" });
  const renewed = continueClaim(projected.ledger, projected.claim, { mode: "renewal", time: T3, expiresAt: T6 });
  assert.deepEqual(validateLedger(renewed.ledger), []); });
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
function legacyReviewedLedger() { const ledger = legacyLedger();
  const previous = ledger.entries.at(-1); const core = { ...previous.claimCore,
    transitionCounter: 3, state: "review-ready", evidenceDigest: evidence("legacy-review"),
    reviewRequestId: "review:legacy", }; const entry = legacyEntry({ action: "review-ready", core,
    sequence: 3, parentDigest: previous.digest, time: T2, });
  return { ...ledger, sequence: 3, headDigest: entry.digest, entries: [...ledger.entries, entry] };
}
function legacyLedger() { const declaredWriteScope = normalizeWriteSet(["path:legacy.md"]);
  const writeSetDigest = digestValue(declaredWriteScope); const claimId = digestValue({
    actorId: owner.actorId, canonicalBaseRevision: repository.canonicalRevision,
    deviceId: owner.deviceId, leaseEpoch: 1, repositoryId: repository.repositoryId,
    sessionId: owner.sessionId, workItemId: "legacy:work", writeSetDigest, }); const initialCore = {
    claimId, actorId: owner.actorId, deviceId: owner.deviceId, sessionId: owner.sessionId,
    repositoryId: repository.repositoryId, workItemId: "legacy:work",
    canonicalBaseRevision: repository.canonicalRevision, declaredWriteScope, writeSetDigest,
    laneRevision: repository.canonicalRevision, leaseEpoch: 1, transitionCounter: 1,
    heartbeatCounter: 0, state: "active", expiresAt: T3, evidenceDigest: null,
    reviewRequestId: null, predecessorClaimId: null, handoff: null, release: null, };
  const first = legacyEntry({ action: "claim", core: initialCore, sequence: 1, parentDigest: null, time: T0 });
  const renewedCore = { ...initialCore, transitionCounter: 2, heartbeatCounter: 1, expiresAt: T4, };
  const second = legacyEntry({ action: "heartbeat", core: renewedCore, sequence: 2, parentDigest: first.digest, time: T1 });
  return { schema: "agentic-cloud-collaboration-ledger/v1", ledgerRepositoryId: "ledger:repository",
    sequence: 2, headDigest: second.digest, entries: [first, second], }; }
function legacyEntry({ action, core, sequence, parentDigest, time }) { const draft = {
    schema: LEGACY_ENTRY_SCHEMA, sequence, parentDigest, action, repositoryId: core.repositoryId,
    claimId: core.claimId, idempotencyKey: evidence(`legacy-idempotency:${sequence}`),
    requestDigest: evidence(`legacy-request:${sequence}`), evaluationTime: time, claimCore: core,
    claimDigest: digestValue(core), }; return { ...draft, digest: digestValue(draft) }; }
