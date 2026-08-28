import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJson, digestValue, normalizeWriteSet }
  from "../scripts/cloud-collaboration-primitives.mjs";
import {
  buildMixedIdentityPairRetirementEvidence,
  buildMixedIdentityScopeComparison,
} from "../scripts/claim-only-mixed-identity-pair-retirement-evidence.mjs";
import {
  buildMixedIdentityPairRetirementPlan,
  mixedIdentityPairEffectReceiptDigest,
  mixedIdentityPairRetirementOperationKey,
  normalizeMixedIdentityPairRetirementJournal,
} from "../scripts/claim-only-mixed-identity-pair-retirement-contract.mjs";
import { createMixedIdentityPairRetirementController }
  from "../scripts/claim-only-mixed-identity-pair-retirement-controller.mjs";
import {
  convergeRetirementAtFreshLedger,
  projectMixedIdentityPairRepositoryEvidence,
}
  from "../scripts/claim-only-mixed-identity-pair-retirement-repository-adapter.mjs";
import {
  mixedIdentityPairRetirementRequestDigest,
  operationReceiptForEntry,
  validateMixedIdentityPairRetirementTerminal,
} from "../scripts/claim-only-mixed-identity-pair-retirement-store.mjs";

const SOURCE_ID = digestValue("mixed-source");
const WAITING_ID = digestValue("mixed-waiting");
const REPOSITORY_ID = "github-repository:R_test";
const ACTOR_ID = "github-user:42";
const BASE = "a".repeat(40);
const SOURCE_SCOPE = normalizeWriteSet([
  "path:shared/a", "path:source/b", "path:source/c", "path:source/d",
  "path:source/e", "semantic:source-retirement",
]);
const WAITING_SCOPE = normalizeWriteSet([
  "path:shared/a", "semantic:source-retirement",
  ...Array.from({ length: 15 }, (_, index) => `path:waiting/${index + 1}`),
  "semantic:waiting-retirement",
]);

test("seals the live mixed identity and complete 22-item scope algebra", () => {
  const evidence = fixtureEvidence();
  assert.equal(evidence.scopeComparison.source.length, 6);
  assert.equal(evidence.scopeComparison.waitingSuccessor.length, 18);
  assert.equal(evidence.scopeComparison.intersection.length, 2);
  assert.equal(evidence.scopeComparison.union.length, 22);
  assert.deepEqual(evidence.identityComparison.equalFields, ["deviceId"]);
  assert.deepEqual(evidence.identityComparison.differentFields,
    ["workItemId", "sessionId", "writeSetDigest", "declaredWriteScope"]);
  assert.equal(evidence.associations.source.authoredRevisionAssociations.length, 0);
});

test("rejects owner, predecessor, expiry, genesis, association, and overlap drift", () => {
  const cases = [
    value => { value.waitingSuccessor.actorId = "github-user:foreign"; },
    value => { value.waitingSuccessor.predecessorClaimId = digestValue("foreign"); },
    value => { value.waitingSuccessor.expiresAt = "2026-08-28T11:00:00.000Z"; },
    value => { value.source.transitionCounter = 2; },
    value => { value.associations.source.writerLeaseMatches.push({ branch: "agent/owned" }); },
    value => { value.overlap.overlappingClaimIds.push(digestValue("foreign-overlap")); },
  ];
  for (const mutate of cases) {
    const raw = rawEvidence();
    mutate(raw);
    assert.throws(() => buildMixedIdentityPairRetirementEvidence(raw), /invalid/u);
  }
});

test("plan seals scope disclosure and emits one exact authorization", () => {
  const plan = buildMixedIdentityPairRetirementPlan(fixtureEvidence());
  assert.equal(plan.exactAuthorization,
    `authorize claim-only-mixed-identity-pair-retirement ${plan.planDigest}`);
  assert.equal(plan.evidence.scopeComparison.union.length, 22);
  const tampered = structuredClone(plan.evidence);
  tampered.scopeComparison.union.pop();
  assert.throws(() => buildMixedIdentityPairRetirementPlan(tampered), /invalid/u);
});

test("planning and wrong authorization have zero cloud effects", async () => {
  const runtime = mockRuntime();
  const controller = createMixedIdentityPairRetirementController({ adapter: runtime.adapter });
  const plan = await controller.plan();
  assert.deepEqual(runtime.order, []);
  await assert.rejects(controller.run({ planDigest: plan.planDigest,
    authorization: "authorize something broad" }), /Exact authorization required/u);
  assert.deepEqual(runtime.order, []);
});

test("retires the waiting successor before source and seals only two cloud effects", async () => {
  const runtime = mockRuntime();
  const controller = createMixedIdentityPairRetirementController({ adapter: runtime.adapter });
  const plan = await controller.plan();
  const receipt = await controller.run({
    planDigest: plan.planDigest, authorization: plan.exactAuthorization,
  });
  assert.deepEqual(runtime.order, ["waiting-successor-retired", "source-retired"]);
  assert.deepEqual(receipt.orderedEffects, [
    "retire-waiting-successor-cloud-claim", "retire-source-cloud-claim",
  ]);
  assert.equal(receipt.affectedScope.length, 22);
  assert.equal(receipt.preservation.git, "unchanged");
  assert.equal(receipt.preservation.pullRequests, "unchanged");
  assert.equal(receipt.preservation.deployment, "not-performed");
  assert.equal(Object.values(receipt).includes("claim"), false);
});

test("independent response loss after either effect is adopted and replay is effect-free", async () => {
  for (const lostPhase of ["waiting-successor-retired", "source-retired"]) {
    const runtime = mockRuntime({ lostPhase });
    const controller = createMixedIdentityPairRetirementController({ adapter: runtime.adapter });
    const plan = await controller.plan();
    const receipt = await controller.run({
      planDigest: plan.planDigest, authorization: plan.exactAuthorization,
    });
    assert.equal(receipt[lostPhase === "waiting-successor-retired"
      ? "waitingSuccessorEffect" : "sourceEffect"].disposition, "adopted");
    const order = [...runtime.order];
    const replay = await controller.run({
      planDigest: plan.planDigest, authorization: plan.exactAuthorization,
    });
    assert.equal(replay.receiptDigest, receipt.receiptDigest);
    assert.deepEqual(runtime.order, order);
  }
});

test("retries an unrelated ledger CAS advance with a fresh head", async () => {
  let reads = 0, invokes = 0;
  const result = await convergeRetirementAtFreshLedger({
    readFrame: () => ({ ledger: ++reads, subjectRetired: reads >= 4,
      disjointMovementClassification: "keep" }),
    classify: frame => ({ state: frame.subjectRetired ? "complete" : "pending" }),
    invoke: frame => {
      invokes += 1;
      if (frame.ledger === 1) throw new Error("stale_ledger_digest");
      return { ok: true };
    },
  });
  assert.equal(result.state, "complete");
  assert.equal(invokes, 2);
});

test("stable repository evidence excludes provider display metadata", () => {
  const expected = rawEvidence().repository;
  const projected = projectMixedIdentityPairRepositoryEvidence({
    ...expected,
    nameWithOwner: expected.targetRepository,
  }, expected.ledgerRepository);
  assert.deepEqual(projected, expected);
  assert.equal(Object.hasOwn(projected, "nameWithOwner"), false);
});

test("relevant subject drift blocks before source retirement", async () => {
  const runtime = mockRuntime({ sourceDrift: true });
  const controller = createMixedIdentityPairRetirementController({ adapter: runtime.adapter });
  const plan = await controller.plan();
  await assert.rejects(controller.run({
    planDigest: plan.planDigest, authorization: plan.exactAuthorization,
  }), /source fence drift/u);
  assert.deepEqual(runtime.order, ["waiting-successor-retired"]);
});

test("terminal adoption rejects foreign operation keys and request digests", () => {
  const plan = buildMixedIdentityPairRetirementPlan(fixtureEvidence());
  const phase = "waiting-successor-retired";
  const operationKey = mixedIdentityPairRetirementOperationKey(plan, phase);
  const entry = terminalEntry(plan, plan.evidence.waitingSuccessor, phase, operationKey);
  assert.doesNotThrow(() => validateMixedIdentityPairRetirementTerminal({
    plan, claim: plan.evidence.waitingSuccessor, phase, operationKey, entry,
  }));
  for (const mutate of [
    value => { value.idempotencyKey = digestValue("foreign-operation"); },
    value => { value.requestDigest = digestValue("foreign-request"); },
    value => { value.claimCore.transitionCounter = 9; },
  ]) {
    const foreign = structuredClone(entry);
    mutate(foreign);
    assert.throws(() => validateMixedIdentityPairRetirementTerminal({
      plan, claim: plan.evidence.waitingSuccessor, phase, operationKey, entry: foreign,
    }), /invalid/u);
  }
});

test("terminal validation rejects fully resealed eligible-since, handoff, and release forgeries", () => {
  const plan = buildMixedIdentityPairRetirementPlan(fixtureEvidence());
  const phase = "waiting-successor-retired";
  const operationKey = mixedIdentityPairRetirementOperationKey(plan, phase);
  const entry = terminalEntry(plan, plan.evidence.waitingSuccessor, phase, operationKey);
  for (const mutate of [
    core => { core.eligibleSince = "2026-08-28T08:00:01.000Z"; },
    core => { core.handoff = { invented: true }; },
    core => { core.release = { invented: true }; },
  ]) {
    const forged = structuredClone(entry);
    mutate(forged.claimCore);
    resealEntry(forged);
    assert.throws(() => validateMixedIdentityPairRetirementTerminal({
      plan, claim: plan.evidence.waitingSuccessor, phase, operationKey, entry: forged,
    }), /invalid/u);
  }
});

test("terminal core preserves real v2 omission semantics for absent optional lineage fields", () => {
  const plan = buildMixedIdentityPairRetirementPlan(fixtureEvidence());
  const sourcePhase = "source-retired";
  const sourceKey = mixedIdentityPairRetirementOperationKey(plan, sourcePhase);
  const sourceEntry = terminalEntry(plan, plan.evidence.source, sourcePhase, sourceKey);
  for (const field of ["recovery", "integration", "canonicalDescendantProof"]) {
    assert.equal(Object.hasOwn(sourceEntry.claimCore, field), false);
  }
  assert.doesNotThrow(() => validateMixedIdentityPairRetirementTerminal({
    plan, claim: plan.evidence.source, phase: sourcePhase, operationKey: sourceKey,
    entry: sourceEntry,
  }));
  for (const field of ["recovery", "integration", "canonicalDescendantProof"]) {
    const forged = structuredClone(sourceEntry);
    forged.claimCore[field] = null;
    resealEntry(forged);
    assert.throws(() => validateMixedIdentityPairRetirementTerminal({
      plan, claim: plan.evidence.source, phase: sourcePhase, operationKey: sourceKey,
      entry: forged,
    }), /invalid/u);
  }
  const waitingPhase = "waiting-successor-retired";
  const waitingKey = mixedIdentityPairRetirementOperationKey(plan, waitingPhase);
  const waitingEntry = terminalEntry(
    plan, plan.evidence.waitingSuccessor, waitingPhase, waitingKey,
  );
  assert.equal(Object.hasOwn(waitingEntry.claimCore, "canonicalDescendantProof"), true);
  delete waitingEntry.claimCore.canonicalDescendantProof;
  resealEntry(waitingEntry);
  assert.throws(() => validateMixedIdentityPairRetirementTerminal({
    plan, claim: plan.evidence.waitingSuccessor, phase: waitingPhase,
    operationKey: waitingKey, entry: waitingEntry,
  }), /invalid/u);
});

test("cloud results require exact operation, projected claim, and self-sealed provider receipts", () => {
  const plan = buildMixedIdentityPairRetirementPlan(fixtureEvidence());
  const phase = "waiting-successor-retired";
  const operationKey = mixedIdentityPairRetirementOperationKey(plan, phase);
  const entry = terminalEntry(plan, plan.evidence.waitingSuccessor, phase, operationKey);
  const valid = mutationResult(entry);
  assert.doesNotThrow(() => validateMixedIdentityPairRetirementTerminal({
    plan, claim: plan.evidence.waitingSuccessor, phase, operationKey, entry, result: valid,
  }));
  const mutations = [
    result => { result.action = "continue"; },
    result => { result.status = "current"; },
    result => { result.operationReceipt.requestDigest = digestValue("foreign-operation"); },
    result => { result.claim.fenceRevision = digestValue("foreign-fence"); },
    result => { result.claim.transitionDigest = digestValue("foreign-transition"); },
    result => { result.receipt.schema = "foreign-provider-receipt/v1"; resealProvider(result); },
    result => { result.receipt.action = "continue"; resealProvider(result); },
    result => { result.receipt.claimId = digestValue("foreign-claim"); resealProvider(result); },
    result => { result.receipt.contractReceiptDigest = digestValue("foreign-contract");
      resealProvider(result); },
    result => { result.receipt.receiptDigest = digestValue("broken-seal"); },
  ];
  for (const mutate of mutations) {
    const foreign = structuredClone(valid);
    mutate(foreign);
    assert.throws(() => validateMixedIdentityPairRetirementTerminal({
      plan, claim: plan.evidence.waitingSuccessor, phase, operationKey, entry,
      result: foreign,
    }), /invalid/u);
  }
});

test("complete journal rejects an altered completion receipt even when every outer seal is rebuilt", async () => {
  const runtime = mockRuntime();
  const controller = createMixedIdentityPairRetirementController({ adapter: runtime.adapter });
  const plan = await controller.plan();
  await controller.run({ planDigest: plan.planDigest, authorization: plan.exactAuthorization });
  const forged = structuredClone(runtime.journal);
  const complete = forged.state.receipts.complete;
  complete.receipt.sourceClaimId = digestValue("foreign-completion-source");
  const receiptCore = { ...complete.receipt }; delete receiptCore.receiptDigest;
  complete.receipt.receiptDigest = digestValue(receiptCore);
  const phaseCore = { ...complete }; delete phaseCore.receiptDigest;
  complete.receiptDigest = digestValue(phaseCore);
  const journalCore = { ...forged }; delete journalCore.journalDigest;
  forged.journalDigest = digestValue(journalCore);
  assert.throws(() => normalizeMixedIdentityPairRetirementJournal(forged),
    /completion receipt journal join/u);
});

function fixtureEvidence() {
  return buildMixedIdentityPairRetirementEvidence(rawEvidence());
}

function rawEvidence() {
  const source = genesisClaim({
    claimId: SOURCE_ID, workItemId: "work-item:source", sessionId: "session:source",
    scope: SOURCE_SCOPE, state: "current", predecessorClaimId: null, eligibleSince: null,
  });
  const waiting = genesisClaim({
    claimId: WAITING_ID, workItemId: "work-item:waiting", sessionId: "session:waiting",
    scope: WAITING_SCOPE, state: "waiting-successor", predecessorClaimId: SOURCE_ID,
    eligibleSince: "2026-08-28T08:00:00.000Z",
    canonicalDescendantProof: {
      schema: "agentic-canonical-descendant-proof/v1", sourceBaseSha: "b".repeat(40),
      targetBaseSha: BASE, protectedMainSha: BASE, changedPaths: ["docs/example.md"],
      preservedPaths: [],
    },
  });
  const identityComparison = compareIdentity(source.claim, waiting.claim);
  const scopeComparison = buildMixedIdentityScopeComparison(SOURCE_SCOPE, WAITING_SCOPE);
  return {
    schema: "agentic-claim-only-mixed-identity-pair-retirement-evidence/v1",
    observedAt: "2026-08-28T10:00:00.000Z",
    repository: {
      targetRepository: "owner/repository", ledgerRepository: "owner/ledger",
      providerRepositoryId: "R_test", topLevelDigest: digestValue("top"),
      gitCommonDirectoryDigest: digestValue("common"), originUrlDigest: digestValue("origin"),
    },
    controller: {
      repository: "owner/ledger", branch: "main", headSha: BASE, originMainSha: BASE,
      remoteMainSha: BASE, runtimeDigest: digestValue("runtime"),
      policyDigest: digestValue("policy"), clean: true, protected: true,
    },
    canonical: { mainSha: BASE, sourceBaseContained: true,
      waitingSuccessorBaseContained: true },
    cloud: { ledgerRevision: BASE, ledgerDigest: digestValue("ledger"),
      validatedLedgerDigest: digestValue("validated"), sequence: 2,
      inventoryDigest: digestValue("inventory") },
    source: source.claim,
    waitingSuccessor: waiting.claim,
    sourceEntry: source.entry,
    waitingSuccessorEntry: waiting.entry,
    sourceLineageCount: 1,
    waitingSuccessorLineageCount: 1,
    identityComparison,
    scopeComparison,
    associations: emptyAssociations(),
    overlap: { overlappingClaimIds: [SOURCE_ID, WAITING_ID].sort(),
      reservedClaimIds: [SOURCE_ID], waitingClaimIds: [WAITING_ID],
      higherPriorityWaitingClaimIds: [] },
    disjointMovement: { classification: "keep", currentClaimCount: 7,
      inventoryDigest: digestValue("disjoint") },
  };
}

function genesisClaim({ claimId, workItemId, sessionId, scope, state,
  predecessorClaimId, eligibleSince, canonicalDescendantProof = null }) {
  const claimCore = {
    claimId, actorId: ACTOR_ID, deviceId: "device:same", sessionId,
    repositoryId: REPOSITORY_ID, workItemId, canonicalBaseRevision: BASE,
    declaredWriteScope: scope, writeSetDigest: digestValue(scope), laneRevision: BASE,
    leaseEpoch: 1, transitionCounter: 1, heartbeatCounter: 0, state,
    expiresAt: "2026-08-28T09:00:00.000Z", evidenceDigest: null,
    reviewRequestId: null, predecessorClaimId, eligibleSince, handoff: null, release: null,
    ...(canonicalDescendantProof ? { canonicalDescendantProof } : {}),
  };
  const claimDigest = digestValue(claimCore);
  const entryCore = {
    schema: "agentic-cloud-collaboration-entry/v2", sequence: state === "current" ? 1 : 2,
    parentDigest: digestValue(`${claimId}-parent`), action: "claim", repositoryId: REPOSITORY_ID,
    claimId, idempotencyKey: digestValue(`${claimId}-operation`),
    requestDigest: digestValue(`${claimId}-request`), evaluationTime: "2026-08-28T07:00:00.000Z",
    claimCore, claimDigest,
  };
  const entry = { ...entryCore, digest: digestValue(entryCore) };
  return {
    entry: projectEntry(entry),
    claim: {
      claimId, claimDigest, transitionDigest: entry.digest,
      operationReceiptDigest: digestValue(`${claimId}-receipt`),
      entrySchema: entry.schema, claimIdentitySchema: entry.schema,
      state: state === "current" ? "dormant-preserved" : state, recordedState: state,
      writeAuthority: false, scopeReserved: state === "current", actorId: ACTOR_ID,
      repositoryId: REPOSITORY_ID, workItemId, deviceId: "device:same", sessionId,
      canonicalBaseRevision: BASE, laneRevision: BASE, declaredWriteScope: scope,
      writeSetDigest: digestValue(scope), leaseEpoch: 1, transitionCounter: 1,
      heartbeatCounter: 0, reviewRequestId: null, predecessorClaimId,
      expiresAt: claimCore.expiresAt, eligibleSince, evidenceDigest: null,
      handoff: null, release: null, canonicalDescendantProof,
      recovery: null, integration: null, retirement: null,
    },
  };
}

function projectEntry(entry) {
  return { schema: entry.schema, action: entry.action, sequence: entry.sequence,
    claimId: entry.claimId, claimDigest: entry.claimDigest, digest: entry.digest,
    repositoryId: entry.repositoryId, idempotencyKey: entry.idempotencyKey,
    requestDigest: entry.requestDigest, evaluationTime: entry.evaluationTime,
    state: entry.claimCore.state, transitionCounter: entry.claimCore.transitionCounter,
    heartbeatCounter: entry.claimCore.heartbeatCounter,
    predecessorClaimId: entry.claimCore.predecessorClaimId,
    reviewRequestId: entry.claimCore.reviewRequestId };
}

function compareIdentity(source, waiting) {
  const fields = ["workItemId", "deviceId", "sessionId", "writeSetDigest",
    "declaredWriteScope"];
  const equalFields = fields.filter(name => canonicalJson(source[name]) === canonicalJson(waiting[name]));
  const differentFields = fields.filter(name => !equalFields.includes(name));
  return { actorIdEqual: true, repositoryIdEqual: true, equalFields, differentFields,
    comparisonDigest: digestValue({ equalFields, differentFields }) };
}

function emptyAssociations() {
  const subject = () => ({ writerLeaseMatches: [], pullRequestMarkerMatches: [],
    authoredRevisionAssociations: [] });
  return { source: subject(), waitingSuccessor: subject() };
}

function mockRuntime({ lostPhase = null, sourceDrift = false } = {}) {
  let journal = null, waitingRetired = false, sourceRetired = false;
  const order = [];
  const evidence = fixtureEvidence();
  const adapter = {
    withOperationLock: (_context, action) => action(),
    readJournal: () => journal,
    writeJournal: ({ expected, next }) => {
      if (expected === null) assert.equal(journal, null);
      else assert.equal(digestValue(expected), digestValue(journal));
      journal = next; return journal;
    },
    observePlan: () => evidence,
    prepare: () => ({ relevantFrameDigest: digestValue("relevant"),
      disjointMovementDigest: digestValue("disjoint-prepared"),
      disjointMovementClassification: "keep" }),
    classifyWaitingSuccessorRetired: context => waitingRetired
      ? { state: "complete", values: effectValues(context, "waiting-successor-retired",
        lostPhase === "waiting-successor-retired" ? "adopted" : "projected") }
      : { state: "pending" },
    retireWaitingSuccessor: () => {
      waitingRetired = true; order.push("waiting-successor-retired");
      if (lostPhase === "waiting-successor-retired") throw new Error("response lost");
    },
    classifySourceRetired: context => {
      if (sourceDrift && waitingRetired && !sourceRetired) throw new Error("source fence drift");
      return sourceRetired
        ? { state: "complete", values: effectValues(context, "source-retired",
          lostPhase === "source-retired" ? "adopted" : "projected") }
        : { state: "pending" };
    },
    retireSource: () => {
      sourceRetired = true; order.push("source-retired");
      if (lostPhase === "source-retired") throw new Error("response lost");
    },
    verifyTerminal: ({ journal: current }) => ({
      effectReceiptDigest: mixedIdentityPairEffectReceiptDigest(current.state.receipts),
      terminalRelevantDigest: digestValue("terminal-relevant"),
      disjointMovementDigest: digestValue(`disjoint-${Date.now()}`),
      disjointMovementClassification: "keep",
    }),
  };
  return { adapter, order, get journal() { return journal; } };
}

function effectValues(context, phase, disposition) {
  const claim = phase === "waiting-successor-retired"
    ? context.plan.evidence.waitingSuccessor : context.plan.evidence.source;
  return { operationKey: context.operationKey, claimId: claim.claimId,
    requestDigest: mixedIdentityPairRetirementRequestDigest({ plan: context.plan, claim, phase }),
    operationReceiptDigest: digestValue(`${phase}-receipt`),
    terminalEntryDigest: digestValue(`${phase}-entry`),
    terminalClaimDigest: digestValue(`${phase}-claim`), transportReceiptDigest: null,
    disposition, cloudMutation: true };
}

function terminalEntry(plan, claim, phase, operationKey) {
  const retiredAt = "2026-08-28T10:01:00.000Z";
  const requestDigest = mixedIdentityPairRetirementRequestDigest({ plan, claim, phase });
  const effectDigest = kind => digestValue({
    schema: "agentic-claim-only-mixed-identity-pair-effect-evidence/v1",
    planDigest: plan.planDigest, phase, kind, sourceClaimId: plan.sourceClaimId,
    waitingSuccessorClaimId: plan.waitingSuccessorClaimId,
    sourceScope: plan.evidence.source.declaredWriteScope,
    waitingSuccessorScope: plan.evidence.waitingSuccessor.declaredWriteScope,
    affectedScope: plan.evidence.scopeComparison.union,
  });
  const claimCore = {
    claimId: claim.claimId, actorId: claim.actorId, deviceId: claim.deviceId,
    sessionId: claim.sessionId, repositoryId: claim.repositoryId,
    workItemId: claim.workItemId, canonicalBaseRevision: claim.canonicalBaseRevision,
    declaredWriteScope: claim.declaredWriteScope, writeSetDigest: claim.writeSetDigest,
    laneRevision: claim.laneRevision, leaseEpoch: claim.leaseEpoch,
    transitionCounter: claim.transitionCounter + 1, heartbeatCounter: claim.heartbeatCounter,
    state: "retired", expiresAt: claim.expiresAt, evidenceDigest: claim.evidenceDigest,
    reviewRequestId: null, predecessorClaimId: claim.predecessorClaimId,
    eligibleSince: claim.eligibleSince, handoff: claim.handoff, release: claim.release,
    ...(claim.canonicalDescendantProof == null ? {}
      : { canonicalDescendantProof: claim.canonicalDescendantProof }),
    retirement: { reason: "abandoned", finalRevision: claim.laneRevision,
      reviewRequestId: null, bytesDigest: effectDigest("bytes"),
      namedChecksDigest: effectDigest("named-checks"),
      handoffEvidenceDigest: effectDigest("handoff"), integrationReceiptDigest: null, retiredAt },
  };
  const claimDigest = digestValue(claimCore);
  const core = { schema: "agentic-cloud-collaboration-entry/v2", sequence: 3,
    parentDigest: digestValue("terminal-parent"), action: "retire",
    repositoryId: claim.repositoryId, claimId: claim.claimId,
    idempotencyKey: digestValue(operationKey), requestDigest, evaluationTime: retiredAt,
    claimCore, claimDigest };
  return { ...core, digest: digestValue(core) };
}

function resealEntry(entry) {
  entry.claimDigest = digestValue(entry.claimCore);
  const core = { ...entry }; delete core.digest;
  entry.digest = digestValue(core);
}

function mutationResult(entry) {
  const operationReceipt = operationReceiptForEntry(entry);
  const claim = {
    ...entry.claimCore,
    entrySchema: entry.schema,
    claimIdentitySchema: entry.schema,
    writeAuthority: false,
    scopeReserved: false,
    fenceRevision: entry.claimDigest,
    transitionDigest: entry.digest,
    operationReceiptDigest: operationReceipt.receiptDigest,
    integrationReceiptDigest: null,
  };
  const receiptCore = {
    schema: "agentic-cloud-collaboration-github-receipt/v1",
    action: "retire",
    ledgerRevision: "c".repeat(40),
    ledgerDigest: entry.digest,
    claimId: entry.claimId,
    claimDigest: entry.claimDigest,
    contractReceiptDigest: operationReceipt.receiptDigest,
    sequence: entry.sequence,
    evaluationTime: entry.evaluationTime,
  };
  return {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "retire",
    status: "retired",
    claim,
    claimDigest: entry.claimDigest,
    operationReceipt,
    receipt: { ...receiptCore, receiptDigest: digestValue(receiptCore) },
  };
}

function resealProvider(result) {
  const core = { ...result.receipt }; delete core.receiptDigest;
  result.receipt.receiptDigest = digestValue(core);
}
