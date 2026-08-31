import assert from "node:assert/strict";
import test from "node:test";

import {
  BRIDGE_RETIREMENT_OPERATION, SUCCESSOR_PROMOTION_OPERATION,
  bridgeRetirementRequestDigest, buildBridgeRetirementPlan,
  buildExistingSuccessorPromotionPlan,
  successorPromotionEntryRequestDigest, waitingBridgeEffectDigest,
  waitingBridgeOperationKey, waitingBridgePreservationDigest,
  waitingBridgeTerminalRelevantDigest,
} from "../scripts/claim-only-waiting-bridge-reconciliation-contract.mjs";
import { createClaimOnlyWaitingBridgeReconciliationController,
  stableWaitingBridgeEvidenceDigest }
  from "../scripts/claim-only-waiting-bridge-reconciliation-controller.mjs";
import {
  buildWaitingBridgePromotionAuthorityOutput, projectWaitingBridgeProviderInventory,
  isLiveWaitingSuccessorClaim, projectWaitingBridgeDirectSuccessorTopology,
  readAllWaitingBridgeProviderPullRequests,
} from "../scripts/claim-only-waiting-bridge-reconciliation-repository-adapter.mjs";
import { normalizeCloudAuthority } from "../scripts/scoped-lane-admission-lib.mjs";
import { canonicalJson, digestValue }
  from "../scripts/cloud-collaboration-primitives.mjs";
import { claimOnlyOperationReceiptForEntry as operationReceipt }
  from "../scripts/claim-only-partial-start-retirement-store.mjs";

const D = value => digestValue(String(value));
const SHA = character => character.repeat(40);
const T0 = "2026-08-31T00:00:00.000Z";
const T1 = "2026-08-31T00:01:00.000Z";
const T2 = "2026-08-31T00:02:00.000Z";
const T3 = "2026-08-31T00:03:00.000Z";
const T4 = "2026-08-31T01:00:00.000Z";
const REPOSITORY = "owner/repository";
const REPOSITORY_ID = "github-repository:R_test";
const ACTOR = "github-user:42";
const ANCHOR = D("anchor");
const BRIDGE = D("bridge");
const SUCCESSOR = D("successor");
const ANCHOR_SCOPE = ["path:zones/anchor"];
const BRIDGE_SCOPE = ["path:zones/anchor", "path:zones/successor"];
const SUCCESSOR_SCOPE = ["path:zones/successor"];
const FORBIDDEN = ["source-byte", "git-object", "git-ref", "branch", "worktree",
  "writer-lease", "pull-request", "pull-request-marker", "new-claim", "release",
  "integration", "deployment", "cleanup", "rollback"];

test("live waiting-successor selection uses the public cloud status field", () => {
  assert.equal(isLiveWaitingSuccessorClaim({ state: "waiting-successor" }), true);
  for (const claim of [
    {},
    { state: "current" },
    { state: "dormant-preserved" },
    { recordedState: "waiting-successor" },
    { state: "current", recordedState: "waiting-successor" },
  ]) {
    assert.equal(isLiveWaitingSuccessorClaim(claim), false);
  }
});

test("retirement seals the exact three-claim bridge topology and separate authorization", () => {
  const plan = buildBridgeRetirementPlan(retirementEvidence());
  assert.equal(plan.operation, BRIDGE_RETIREMENT_OPERATION);
  assert.equal(plan.exactAuthorization,
    `authorize claim-only-waiting-bridge-retirement ${plan.planDigest}`);
  assert.throws(() => buildBridgeRetirementPlan(mutate(retirementEvidence(), value => {
    value.successor.deviceId = "device:other";
    value.successorEntry.deviceId = "device:other";
  })), /chain identity/u);
  assert.throws(() => buildBridgeRetirementPlan(mutate(retirementEvidence(), value => {
    value.successor.declaredWriteScope = ["path:zones/anchor"];
    value.successor.writeSetDigest = digestValue(value.successor.declaredWriteScope);
    value.successorEntry.declaredWriteScope = value.successor.declaredWriteScope;
    value.successorEntry.writeSetDigest = value.successor.writeSetDigest;
  })), /overlap topology/u);
  assert.throws(() => buildBridgeRetirementPlan(mutate(retirementEvidence(), value => {
    value.peerFrame.relevantClaimIds.push(D("foreign-overlap"));
  })), /unknown same-repository/u);
  assert.throws(() => buildBridgeRetirementPlan(mutate(retirementEvidence(), value => {
    value.peerFrame.bridgeDirectSuccessorClaimIds = [];
  })), /unknown same-repository/u);
  assert.throws(() => buildBridgeRetirementPlan(mutate(retirementEvidence(), value => {
    value.associations.bridgeRegistryMatches.push({ claimId: BRIDGE });
  })), /association/u);
  assert.doesNotThrow(() => buildBridgeRetirementPlan(mutate(retirementEvidence(), value => {
    value.associations.anchorRegistryMatches = [];
  })), "a unique exact provider marker may preserve an absent local anchor association");
  assert.throws(() => buildBridgeRetirementPlan(mutate(retirementEvidence(), value => {
    value.associations.anchorRegistryMatches = [];
    value.associations.anchorRegistryBranchCollisions.push({ branch: "agent/device/anchor" });
  })), /association/u);
  assert.throws(() => buildBridgeRetirementPlan(mutate(retirementEvidence(), value => {
    value.associations.anchorPullRequestMarkerMatches[0].markerLaneRevision = SHA("b");
  })), /anchor association/u);
  assert.throws(() => buildBridgeRetirementPlan(mutate(retirementEvidence(), value => {
    value.associations.anchorPullRequestMarkerMatches[0].isDraft = false;
  })), /draft flag/u);

  const historical = mutate(retirementEvidence(), value => {
    const terminal = terminalDirectSuccessor();
    value.directSuccessorTopology.bridgeDirectSuccessorClaimIds.push(terminal.claimId);
    value.directSuccessorTopology.bridgeDirectSuccessorClaimIds.sort();
    value.directSuccessorTopology.bridgeTerminalDirectSuccessors.push(terminal);
    value.peerFrame.bridgeDirectSuccessorClaimIds =
      [...value.directSuccessorTopology.bridgeDirectSuccessorClaimIds];
    value.peerFrame.bridgeTerminalDirectSuccessors = [terminal];
  });
  assert.doesNotThrow(() => buildBridgeRetirementPlan(historical));
  assert.throws(() => buildBridgeRetirementPlan(mutate(historical, value => {
    value.directSuccessorTopology.bridgeTerminalDirectSuccessors[0]
      .terminalTransitionCounter = 3;
    value.peerFrame.bridgeTerminalDirectSuccessors[0].terminalTransitionCounter = 3;
  })), /terminal direct-successor lifecycle/u);
  assert.throws(() => buildBridgeRetirementPlan(mutate(historical, value => {
    const competitor = D("live-competitor");
    value.directSuccessorTopology.bridgeDirectSuccessorClaimIds.push(competitor);
    value.directSuccessorTopology.bridgeDirectSuccessorClaimIds.sort();
    value.directSuccessorTopology.bridgeLiveDirectSuccessorClaimIds.push(competitor);
    value.directSuccessorTopology.bridgeLiveDirectSuccessorClaimIds.sort();
    Object.assign(value.peerFrame, structuredClone(value.directSuccessorTopology));
  })), /sole live direct successor/u);
  assert.throws(() => buildBridgeRetirementPlan(mutate(historical, value => {
    value.directSuccessorTopology.bridgeDirectSuccessorClaimIds.reverse();
    value.peerFrame.bridgeDirectSuccessorClaimIds.reverse();
  })), /complete direct-successor partition/u);

  const twoHistorical = mutate(historical, value => {
    const terminal = terminalDirectSuccessor("historical-second");
    value.directSuccessorTopology.bridgeDirectSuccessorClaimIds.push(terminal.claimId);
    value.directSuccessorTopology.bridgeDirectSuccessorClaimIds.sort();
    value.directSuccessorTopology.bridgeTerminalDirectSuccessors.push(terminal);
    value.directSuccessorTopology.bridgeTerminalDirectSuccessors.sort((left, right) =>
      left.claimId.localeCompare(right.claimId));
    Object.assign(value.peerFrame, structuredClone(value.directSuccessorTopology));
  });
  assert.doesNotThrow(() => buildBridgeRetirementPlan(twoHistorical));
  assert.throws(() => buildBridgeRetirementPlan(mutate(twoHistorical, value => {
    value.directSuccessorTopology.bridgeTerminalDirectSuccessors.reverse();
    value.peerFrame.bridgeTerminalDirectSuccessors.reverse();
  })), /complete direct-successor partition/u);
});

test("controller runs both intent-before-effect phases and terminal replay is cloud-free", async () => {
  const runtime = harness();
  const controller = createClaimOnlyWaitingBridgeReconciliationController({
    adapter: runtime.adapter,
  });
  const retirementPlan = await controller.planRetirement();
  const wrongEffectCount = runtime.effectCount;
  await assert.rejects(controller.runRetirement({
    planDigest: retirementPlan.planDigest,
    authorization: "authorize something broader",
  }), /Exact authorization required/u);
  assert.equal(runtime.effectCount, wrongEffectCount);
  const retirement = await controller.runRetirement({
    planDigest: retirementPlan.planDigest,
    authorization: retirementPlan.exactAuthorization,
  });
  assert.equal(retirement.status, "complete");
  assert.equal(runtime.journal(BRIDGE_RETIREMENT_OPERATION).state.phase, "complete");
  assert.ok(runtime.journal(BRIDGE_RETIREMENT_OPERATION)
    .state.receipts["retirement-intent"]);

  const promotionPlan = await controller.planPromotion();
  assert.equal(promotionPlan.exactAuthorization,
    `authorize claim-only-existing-successor-promotion ${promotionPlan.planDigest}`);
  await assert.rejects(controller.runPromotion({
    planDigest: promotionPlan.planDigest,
    authorization: retirementPlan.exactAuthorization,
  }), /Exact authorization required/u);
  assert.equal(runtime.effectCount, 1);
  const promotion = await controller.runPromotion({
    planDigest: promotionPlan.planDigest,
    authorization: promotionPlan.exactAuthorization,
  });
  assert.equal(promotion.operation, SUCCESSOR_PROMOTION_OPERATION);
  assert.deepEqual(retirement.forbiddenEffects, FORBIDDEN);
  assert.deepEqual(promotion.forbiddenEffects, FORBIDDEN);
  const authority = promotionAuthorityOutput(promotionPlan, promotion.effect);
  assert.equal(authority.authorityDigest, promotion.effect.authorityOutputDigest);
  assert.equal(runtime.effectCount, 2, "only retire and promote may mutate externally");
  assert.ok(runtime.journal(SUCCESSOR_PROMOTION_OPERATION)
    .state.receipts["promotion-intent"]);
  const classifications = runtime.classificationCount;
  assert.deepEqual(await controller.runPromotion({
    planDigest: promotionPlan.planDigest,
    authorization: promotionPlan.exactAuthorization,
  }), promotion);
  assert.equal(runtime.classificationCount, classifications,
    "complete replay must not inspect current cloud state");
});

test("response loss after either mutation adopts exact history with a stable result", async () => {
  const projected = harness();
  const projectedController = createClaimOnlyWaitingBridgeReconciliationController({
    adapter: projected.adapter,
  });
  const plan = await projectedController.planRetirement();
  const direct = await projectedController.runRetirement({
    planDigest: plan.planDigest, authorization: plan.exactAuthorization,
  });
  const directPromotionPlan = await projectedController.planPromotion();
  const directPromotion = await projectedController.runPromotion({
    planDigest: directPromotionPlan.planDigest,
    authorization: directPromotionPlan.exactAuthorization,
  });

  const lost = harness({ loseRetirementResponse: true });
  const lostController = createClaimOnlyWaitingBridgeReconciliationController({
    adapter: lost.adapter,
  });
  const lostPlan = await lostController.planRetirement();
  const adopted = await lostController.runRetirement({
    planDigest: lostPlan.planDigest, authorization: lostPlan.exactAuthorization,
  });
  assert.deepEqual(adopted, direct);
  assert.equal(lost.journal(BRIDGE_RETIREMENT_OPERATION)
    .state.receipts["bridge-retired"].disposition, "adopted-response-loss");
  assert.equal(lost.journal(BRIDGE_RETIREMENT_OPERATION)
    .state.receipts["bridge-retired"].providerMutation, false);

  const promotionPlan = await lostController.planPromotion();
  lost.losePromotionResponse();
  const promoted = await lostController.runPromotion({
    planDigest: promotionPlan.planDigest,
    authorization: promotionPlan.exactAuthorization,
  });
  assert.equal(promoted.status, "complete");
  assert.equal(promoted.resultDigest, directPromotion.resultDigest);
  assert.equal(lost.journal(SUCCESSOR_PROMOTION_OPERATION)
    .state.receipts["successor-promoted"].disposition, "adopted-response-loss");
});

test("promotion rejects priority, Phase A, and semantic request drift", async () => {
  const runtime = harness();
  const controller = createClaimOnlyWaitingBridgeReconciliationController({
    adapter: runtime.adapter,
  });
  const retirementPlan = await controller.planRetirement();
  await controller.runRetirement({
    planDigest: retirementPlan.planDigest,
    authorization: retirementPlan.exactAuthorization,
  });
  const evidence = runtime.promotionEvidence();
  assert.throws(() => buildExistingSuccessorPromotionPlan(mutate(evidence, value => {
    value.priority.eligibleWaiting[0].ledgerSequence += 1;
  })), /first eligible/u);
  assert.throws(() => buildExistingSuccessorPromotionPlan(mutate(evidence, value => {
    value.phaseA.effectDigest = D("forged-effect");
  })), /Phase A/u);
  const plan = buildExistingSuccessorPromotionPlan(evidence);
  const expiry = new Date(Date.parse(T4) + plan.evidence.ttlSeconds * 1_000).toISOString();
  assert.notEqual(successorPromotionEntryRequestDigest(plan, expiry), D("arbitrary-request"));
});

test("promotion authority output is directly consumable by admission normalization", async () => {
  const runtime = harness();
  const controller = createClaimOnlyWaitingBridgeReconciliationController({
    adapter: runtime.adapter,
  });
  const retirementPlan = await controller.planRetirement();
  await controller.runRetirement({
    planDigest: retirementPlan.planDigest,
    authorization: retirementPlan.exactAuthorization,
  });
  const plan = await controller.planPromotion();
  const evaluationTime = T4;
  const expiresAt = new Date(Date.parse(evaluationTime)
    + plan.evidence.ttlSeconds * 1_000).toISOString();
  const terminal = {
    schema: "agentic-cloud-collaboration-entry/v2", action: "continue", sequence: 5,
    claimId: SUCCESSOR, claimDigest: D("promoted-fence"), digest: D("promoted-entry"),
    evaluationTime,
    claimCore: {
      actorId: ACTOR, repositoryId: REPOSITORY_ID,
      workItemId: plan.evidence.successor.workItemId,
      deviceId: plan.evidence.successor.deviceId,
      sessionId: plan.evidence.successor.sessionId,
      canonicalBaseRevision: plan.evidence.successor.canonicalBaseRevision,
      laneRevision: plan.evidence.successor.laneRevision,
      declaredWriteScope: plan.evidence.successor.declaredWriteScope,
      writeSetDigest: plan.evidence.successor.writeSetDigest,
      leaseEpoch: 1, transitionCounter: 2, heartbeatCounter: 0,
      state: "current", expiresAt, evidenceDigest: null, reviewRequestId: null,
      predecessorClaimId: BRIDGE, eligibleSince: plan.evidence.successor.eligibleSince,
      handoff: null, release: null, promotedAt: evaluationTime,
    },
  };
  const receipt = operationReceipt({
    ...terminal,
    repositoryId: REPOSITORY_ID,
    idempotencyKey: digestValue(waitingBridgeOperationKey(plan, "successor-promoted")),
    requestDigest: successorPromotionEntryRequestDigest(plan, expiresAt),
  }, "current");
  const output = buildWaitingBridgePromotionAuthorityOutput({
    plan, terminal, receipt,
    status: { ledgerRevision: SHA("d"), ledgerDigest: D("promotion-head"), sequence: 5 },
    ledgerRepository: REPOSITORY, targetRepository: REPOSITORY,
  });
  const normalized = normalizeCloudAuthority(output, {
    ledgerRepository: REPOSITORY, targetRepository: REPOSITORY,
    manifest: {
      declaredWriteSet: plan.evidence.successor.declaredWriteScope,
      writeSetDigest: plan.evidence.successor.writeSetDigest,
    },
    canonicalBaseSha: plan.evidence.successor.canonicalBaseRevision,
    now: new Date(evaluationTime),
  });
  assert.equal(normalized.claimId, SUCCESSOR);
  assert.equal(normalized.claimDigest, terminal.claimDigest);
  assert.equal(normalized.transitionCounter, 2);
});

test("disjoint ledger movement and provider reordering preserve stable evidence", () => {
  const first = retirementEvidence();
  const moved = structuredClone(first);
  moved.observedAt = "2026-08-31T01:01:00.000Z";
  moved.cloud.ledgerRevision = SHA("d");
  moved.cloud.ledgerDigest = D("disjoint-head");
  moved.cloud.sequence = 99;
  assert.equal(stableWaitingBridgeEvidenceDigest(first, BRIDGE_RETIREMENT_OPERATION),
    stableWaitingBridgeEvidenceDigest(moved, BRIDGE_RETIREMENT_OPERATION));
  const pulls = [pull(9, "PR_9"), pull(2, "PR_2")];
  const project = list => projectWaitingBridgeProviderInventory({
    pulls: list, pageCount: 2, totalCount: 2,
  }).projected;
  assert.deepEqual(project(pulls), project([...pulls].reverse()));
});

test("provider inventory pagination is complete, unique, advancing, and fail-closed", () => {
  const pages = [
    page([pull(1, "PR_1")], true, "cursor-1", 2),
    page([pull(2, "PR_2")], false, null, 2),
  ];
  const complete = readAllWaitingBridgeProviderPullRequests({
    targetRepository: REPOSITORY,
    gh: () => JSON.stringify(pages.shift()),
  });
  assert.equal(complete.totalCount, 2);
  assert.equal(complete.pageCount, 2);
  assert.throws(() => readAllWaitingBridgeProviderPullRequests({
    targetRepository: REPOSITORY,
    gh: () => JSON.stringify(page([pull(1, "PR_1")], false, null, 2)),
  }), /total inventory/u);
  const duplicatePages = [
    page([pull(1, "PR_1")], true, "same", 2),
    page([pull(1, "PR_1")], false, null, 2),
  ];
  assert.throws(() => readAllWaitingBridgeProviderPullRequests({
    targetRepository: REPOSITORY,
    gh: () => JSON.stringify(duplicatePages.shift()),
  }), /duplicate pull request/u);
  for (const [ambiguous, pattern] of [
    [[page([], true, "a", 1), page([], false, null, 2)], /total count changed/u],
    [[page([], true, "same", 0), page([], true, "same", 0)], /cursor did not advance/u],
  ]) {
    assert.throws(() => readAllWaitingBridgeProviderPullRequests({
      targetRepository: REPOSITORY, gh: () => JSON.stringify(ambiguous.shift()),
    }), pattern);
  }
  let pageCalls = 0;
  assert.throws(() => readAllWaitingBridgeProviderPullRequests({
    targetRepository: REPOSITORY,
    gh: () => JSON.stringify(page([], true, `cursor-${++pageCalls}`, 0)),
  }), /exceeded 1000 pages/u);
  assert.equal(pageCalls, 1_000);
  assert.throws(() => projectWaitingBridgeProviderInventory({
    pulls: [pull(1, "PR_1", "<!-- agentic-writer-lease/v2 {not-json} -->")],
    pageCount: 1, totalCount: 1,
  }), /malformed.*ownership marker|malformed or duplicate/u);
  const marker = `<!-- agentic-writer-lease/v2 {"schema":"agentic-writer-lease/v2",`
    + `"epoch":1,"branch":"agent/device/scope","baseSha":"${SHA("a")}",`
    + `"fenceSha":"${SHA("b")}","expiresAt":"${T4}"} -->`;
  assert.throws(() => projectWaitingBridgeProviderInventory({
    pulls: [pull(1, "PR_1", `${marker}\n${marker}`)], pageCount: 1, totalCount: 1,
  }), /malformed.*ownership marker|malformed or duplicate/u);
  assert.throws(() => projectWaitingBridgeProviderInventory({
    pulls: [pull(1, "PR_1", `${marker}\nagentic-writer-lease/v2 malformed`)],
    pageCount: 1, totalCount: 1,
  }), /malformed.*ownership marker|malformed or duplicate/u);

  const unrelatedClaim = D("unrelated-stale-marker");
  const staleMarker = writerMarker({
    schema: "agentic-writer-lease/v2", epoch: 1,
    branch: "agent/device/unrelated", baseSha: SHA("a"), fenceSha: SHA("b"),
    expiresAt: T4, cloudAuthority: { claimId: unrelatedClaim },
  });
  const stale = projectWaitingBridgeProviderInventory({
    pulls: [pull(3, "PR_3", staleMarker)], pageCount: 1, totalCount: 1,
  }, { targetClaimIds: [ANCHOR] });
  assert.equal(stale.projected[0].markerClaimId, unrelatedClaim);
  assert.equal(stale.projected[0].markerDisposition, "semantic-stale-unrelated");
  assert.throws(() => projectWaitingBridgeProviderInventory({
    pulls: [pull(3, "PR_3", staleMarker)], pageCount: 1, totalCount: 1,
  }, { targetClaimIds: [unrelatedClaim] }), /target or unattributed semantic-stale/u);
  assert.throws(() => projectWaitingBridgeProviderInventory({
    pulls: [pull(3, "PR_3", staleMarker)], pageCount: 1, totalCount: 1,
  }, { targetClaimIds: [BRIDGE, unrelatedClaim] }),
  /target or unattributed semantic-stale/u,
  "a ledger-discovered direct sibling remains canonical-strict");
  assert.throws(() => projectWaitingBridgeProviderInventory({
    pulls: [pull(3, "PR_3", staleMarker), pull(4, "PR_4", staleMarker)],
    pageCount: 1, totalCount: 2,
  }, { targetClaimIds: [ANCHOR] }), /duplicate claim pull-request marker/u);
});

test("direct-successor topology admits only exact unassociated retired siblings", () => {
  const selected = claim({
    claimId: SUCCESSOR, scope: SUCCESSOR_SCOPE, state: "waiting-successor",
    recordedState: "waiting-successor", writeAuthority: false, scopeReserved: false,
    predecessorClaimId: BRIDGE, eligibleSince: T2, expiresAt: T3,
    deviceId: "device:chain", sessionId: "session:successor", sequence: 3,
  });
  const retired = claim({
    claimId: D("historical-direct"), scope: SUCCESSOR_SCOPE, state: "waiting-successor",
    recordedState: "waiting-successor", writeAuthority: false, scopeReserved: false,
    predecessorClaimId: BRIDGE, eligibleSince: T1, expiresAt: T2,
    deviceId: "device:old", sessionId: "session:old", sequence: 1,
  });
  const selectedGenesis = rawGenesis(selected);
  const retiredGenesis = rawGenesis(retired);
  const retiredTerminal = rawRetirement(retiredGenesis);
  const input = {
    ledger: { entries: [retiredGenesis, retiredTerminal, selectedGenesis] },
    statusClaims: [selected.claim], bridgeClaimId: BRIDGE, successorClaimId: SUCCESSOR,
  };
  const topology = projectWaitingBridgeDirectSuccessorTopology(input);
  assert.deepEqual(topology.bridgeLiveDirectSuccessorClaimIds, [SUCCESSOR]);
  assert.equal(topology.bridgeTerminalDirectSuccessors.length, 1);
  assert.equal(topology.bridgeTerminalDirectSuccessors[0].claimId, retired.claim.claimId);
  assert.throws(() => projectWaitingBridgeDirectSuccessorTopology({
    ...input,
    ledger: { entries: [retiredGenesis, mutate(retiredTerminal, value => {
      value.claimCore.retirement.reason = "abandoned";
    }), selectedGenesis] },
  }), /nonterminal direct-successor history/u);
  assert.throws(() => projectWaitingBridgeDirectSuccessorTopology({
    ...input, statusClaims: [selected.claim, retired.claim],
  }), /sole live direct successor/u);
  assert.throws(() => projectWaitingBridgeDirectSuccessorTopology({
    ...input,
    providerAssociations: claimId => claimId === retired.claim.claimId ? [{}] : [],
  }), /terminal direct-successor association/u);
});

function harness({ loseRetirementResponse = false } = {}) {
  const journals = new Map();
  let bridgeDone = false;
  let successorDone = false;
  let losePromotion = false;
  let effects = 0;
  let classifications = 0;
  const retirement = retirementEvidence();
  const adapter = {
    withOperationLock(_context, action) { return action(); },
    readJournal(operation) { return journals.get(operation) || null; },
    writeJournal({ operation, expected, next }) {
      const current = journals.get(operation) || null;
      if (canonicalJson(current) !== canonicalJson(expected)) throw new Error("CAS drift");
      journals.set(operation, next);
      return next;
    },
    observeRetirement() { return structuredClone(retirement); },
    observePromotion() { return promotionEvidence(); },
    prepare({ plan }) {
      return { stableFrameDigest: stableWaitingBridgeEvidenceDigest(plan.evidence, plan.operation) };
    },
    classifyBridgeRetired(context) {
      classifications += 1;
      return bridgeDone ? { state: "complete", values: bridgeValues(context.plan,
        loseRetirementResponse) } : { state: "pending" };
    },
    retireBridge() {
      effects += 1;
      bridgeDone = true;
      if (loseRetirementResponse) throw new Error("response lost after retirement");
    },
    classifySuccessorPromoted(context) {
      classifications += 1;
      return successorDone ? { state: "complete", values: promotionValues(context.plan,
        losePromotion) } : { state: "pending" };
    },
    promoteSuccessor() {
      effects += 1;
      successorDone = true;
      if (losePromotion) throw new Error("response lost after promotion");
    },
    verifyTerminal({ plan, journal }) {
      const phase = plan.operation === BRIDGE_RETIREMENT_OPERATION
        ? "bridge-retired" : "successor-promoted";
      const values = journal.state.receipts[phase];
      return {
        effectDigest: waitingBridgeEffectDigest(values),
        terminalRelevantDigest: waitingBridgeTerminalRelevantDigest(plan, values),
        preservationDigest: waitingBridgePreservationDigest(plan),
      };
    },
  };
  function retirementResult() {
    return journals.get(BRIDGE_RETIREMENT_OPERATION)?.state?.receipts?.complete?.result;
  }
  function promotionEvidence() {
    const journal = journals.get(BRIDGE_RETIREMENT_OPERATION);
    if (!journal?.state?.receipts?.complete) throw new Error("Phase A incomplete");
    const result = retirementResult();
    return {
      ...structuredClone(retirement),
      schema: "agentic-claim-only-existing-successor-promotion-evidence/v1",
      observedAt: T4,
      bridgeLineageCount: 2,
      bridgeCurrentCount: 0,
      ttlSeconds: 1_800,
      priority: {
        reservedOverlapClaimIds: [],
        eligibleWaiting: [{
          claimId: SUCCESSOR,
          eligibleSince: retirement.successor.eligibleSince,
          ledgerSequence: retirement.successorEntry.sequence,
        }],
        selectedClaimId: SUCCESSOR,
        successorLedgerSequence: retirement.successorEntry.sequence,
      },
      phaseA: {
        plan: journal.plan,
        result,
        resultDigest: result.resultDigest,
        bridgeRetirementEntry: phaseARetirementEntry(journal.plan),
        effectDigest: result.effectDigest,
      },
    };
  }
  return {
    adapter,
    get effectCount() { return effects; },
    get classificationCount() { return classifications; },
    journal: operation => journals.get(operation),
    promotionEvidence,
    losePromotionResponse() { losePromotion = true; },
  };
}

function bridgeValues(plan, responseLost) {
  const entry = phaseARetirementEntry(plan);
  const receipt = operationReceipt(entry, "retired");
  const values = {
    operationKey: waitingBridgeOperationKey(plan, "bridge-retired"),
    claimId: BRIDGE,
    requestDigest: bridgeRetirementRequestDigest(plan),
    operationReceiptDigest: receipt.receiptDigest,
    terminalEntryDigest: entry.digest,
    terminalClaimDigest: entry.claimDigest,
    transportReceiptDigest: responseLost ? null : D("retirement-transport"),
    disposition: responseLost ? "adopted-response-loss" : "projected",
    providerMutation: !responseLost,
  };
  return { ...values, effectDigest: waitingBridgeEffectDigest(values) };
}

function promotionValues(plan, responseLost) {
  const evaluationTime = T4;
  const expiresAt = new Date(Date.parse(evaluationTime)
    + plan.evidence.ttlSeconds * 1_000).toISOString();
  const values = {
    operationKey: waitingBridgeOperationKey(plan, "successor-promoted"),
    claimId: SUCCESSOR,
    requestDigest: successorPromotionEntryRequestDigest(plan, expiresAt),
    operationReceiptDigest: D(`promotion-receipt:${plan.planDigest}`),
    terminalEntryDigest: D(`promotion-entry:${plan.planDigest}`),
    terminalClaimDigest: D(`promotion-claim:${plan.planDigest}`),
    transportReceiptDigest: responseLost ? null : D("promotion-transport"),
    disposition: responseLost ? "adopted-response-loss" : "projected",
    providerMutation: !responseLost,
    evaluationTime,
    expiresAt,
  };
  values.authorityOutputDigest = promotionAuthorityOutput(plan, values).authorityDigest;
  return { ...values, effectDigest: waitingBridgeEffectDigest(values) };
}

function promotionAuthorityOutput(plan, effect) {
  const core = {
    schema: "agentic-claim-only-existing-successor-promotion-authority/v1",
    status: "current", operation: SUCCESSOR_PROMOTION_OPERATION,
    planDigest: plan.planDigest, claimId: effect.claimId,
    claimDigest: effect.terminalClaimDigest, transitionDigest: effect.terminalEntryDigest,
    operationReceiptDigest: effect.operationReceiptDigest, transitionCounter: 2,
    expiresAt: effect.expiresAt,
  };
  return { ...core, authorityDigest: digestValue(core) };
}

function phaseARetirementEntry(plan) {
  const bridge = plan.evidence.bridge;
  const operationKey = waitingBridgeOperationKey(plan, "bridge-retired");
  return {
    schema: "agentic-cloud-collaboration-entry/v2",
    action: "retire",
    sequence: 4,
    claimId: bridge.claimId,
    claimDigest: D(`retired-claim:${plan.planDigest}`),
    digest: D(`retired-entry:${plan.planDigest}`),
    repositoryId: bridge.repositoryId,
    idempotencyKey: digestValue(operationKey),
    requestDigest: bridgeRetirementRequestDigest(plan),
    evaluationTime: T3,
    state: "retired",
    transitionCounter: 2,
    heartbeatCounter: 0,
    recordedExpiresAt: bridge.expiresAt,
    predecessorClaimId: ANCHOR,
    reviewRequestId: null,
    retirement: {
      reason: "superseded",
      finalRevision: bridge.laneRevision,
      reviewRequestId: null,
      bytesDigest: D("retirement-bytes"),
      namedChecksDigest: D("retirement-checks"),
      handoffEvidenceDigest: D("retirement-handoff"),
      integrationReceiptDigest: null,
      retiredAt: T3,
    },
    actorId: bridge.actorId,
    deviceId: bridge.deviceId,
    sessionId: bridge.sessionId,
    workItemId: bridge.workItemId,
    canonicalBaseRevision: bridge.canonicalBaseRevision,
    laneRevision: bridge.laneRevision,
    declaredWriteScope: bridge.declaredWriteScope,
    writeSetDigest: bridge.writeSetDigest,
    leaseEpoch: 1,
    eligibleSince: bridge.eligibleSince,
  };
}

function retirementEvidence() {
  const anchor = claim({
    claimId: ANCHOR, scope: ANCHOR_SCOPE, state: "dormant-preserved",
    recordedState: "current", writeAuthority: false, scopeReserved: true,
    predecessorClaimId: null, eligibleSince: null, expiresAt: T1,
    deviceId: "device:anchor", sessionId: "session:anchor", sequence: 1,
  });
  const bridge = claim({
    claimId: BRIDGE, scope: BRIDGE_SCOPE, state: "waiting-successor",
    recordedState: "waiting-successor", writeAuthority: false, scopeReserved: false,
    predecessorClaimId: ANCHOR, eligibleSince: T1, expiresAt: T2,
    deviceId: "device:chain", sessionId: "session:bridge", sequence: 2,
  });
  const successor = claim({
    claimId: SUCCESSOR, scope: SUCCESSOR_SCOPE, state: "waiting-successor",
    recordedState: "waiting-successor", writeAuthority: false, scopeReserved: false,
    predecessorClaimId: BRIDGE, eligibleSince: T2, expiresAt: T3,
    deviceId: "device:chain", sessionId: "session:successor", sequence: 3,
  });
  return {
    schema: "agentic-claim-only-waiting-bridge-retirement-evidence/v1",
    observedAt: T4,
    repository: {
      targetRepository: REPOSITORY, providerRepositoryId: "R_test", nameWithOwner: REPOSITORY,
      topLevelDigest: D("top"), gitCommonDirectoryDigest: D("common"),
      originUrlDigest: D("origin"),
    },
    controller: {
      repository: REPOSITORY, providerRepositoryId: "R_test", nameWithOwner: REPOSITORY,
      branch: "main", headSha: SHA("a"), originMainSha: SHA("a"), remoteMainSha: SHA("a"),
      runtimeDigest: D("runtime"), clean: true, protected: true,
      protectionDigest: D("protection"),
    },
    canonical: {
      targetRepository: REPOSITORY, mainSha: SHA("a"), anchorBaseContained: true,
      bridgeBaseContained: true, successorBaseContained: true,
    },
    cloud: {
      ledgerRepository: REPOSITORY, ledgerRevision: SHA("b"), ledgerDigest: D("ledger"),
      sequence: 3, validatedLedgerDigest: D("validated"), inventoryDigest: D("inventory"),
    },
    anchor: anchor.claim, bridge: bridge.claim, successor: successor.claim,
    anchorEntry: anchor.entry, bridgeEntry: bridge.entry, successorEntry: successor.entry,
    anchorLineageCount: 1, bridgeLineageCount: 1, successorLineageCount: 1,
    associations: {
      anchorRegistryMatches: [{
        claimId: ANCHOR, cloudClaimDigest: anchor.claim.claimDigest,
        branch: "agent/device/anchor", leaseDigest: D("lease"),
        pullRequestUrl: "https://github.com/owner/repository/pull/808",
      }],
      anchorPullRequestMarkerMatches: [{
        claimId: ANCHOR, markerClaimDigest: anchor.claim.claimDigest,
        number: 808, nodeId: "PR_808", state: "OPEN", isDraft: true,
        headRefName: "agent/device/anchor", headRefOid: SHA("a"),
        baseRefName: "main", baseRefOid: SHA("a"), bodyDigest: D("body"),
        markerDigest: D("marker"), markerBranch: "agent/device/anchor",
        markerLaneRevision: SHA("a"), markerFenceSha: SHA("a"),
      }],
      anchorRegistryBranchCollisions: [], anchorRegistryPullRequestCollisions: [],
      bridgeRegistryMatches: [], bridgePullRequestMarkerMatches: [],
      successorRegistryMatches: [], successorPullRequestMarkerMatches: [],
    },
    preservation: {
      gitRefsDigest: D("refs"), gitWorktreesDigest: D("worktrees"),
      registryDigest: D("registry"), providerDigest: D("provider"),
      associationDigest: D("associations"),
    },
    topology: { anchorBridge: true, bridgeSuccessor: true, anchorSuccessor: false },
    directSuccessorTopology: {
      bridgeDirectSuccessorClaimIds: [SUCCESSOR],
      bridgeLiveDirectSuccessorClaimIds: [SUCCESSOR],
      bridgeTerminalDirectSuccessors: [],
    },
    peerFrame: {
      reservedClaimIds: [ANCHOR], waitingClaimIds: [BRIDGE, SUCCESSOR].sort(),
      relevantClaimIds: [ANCHOR, BRIDGE, SUCCESSOR].sort(),
      predecessorConnectedClaimIds: [ANCHOR, BRIDGE, SUCCESSOR].sort(),
      bridgeDirectSuccessorClaimIds: [SUCCESSOR],
      bridgeLiveDirectSuccessorClaimIds: [SUCCESSOR],
      bridgeTerminalDirectSuccessors: [],
    },
  };
}

function claim({
  claimId, scope, state, recordedState, writeAuthority, scopeReserved,
  predecessorClaimId, eligibleSince, expiresAt, deviceId, sessionId, sequence,
}) {
  const normalizedScope = [...scope].sort();
  const claimDigest = D(`claim:${claimId}`);
  const transitionDigest = D(`entry:${claimId}`);
  const common = {
    actorId: ACTOR, repositoryId: REPOSITORY_ID, workItemId: `work-item:${claimId}`,
    deviceId, sessionId, canonicalBaseRevision: SHA("a"), laneRevision: SHA("a"),
    declaredWriteScope: normalizedScope, writeSetDigest: digestValue(normalizedScope),
    leaseEpoch: 1, transitionCounter: 1, heartbeatCounter: 0, expiresAt,
    reviewRequestId: null, predecessorClaimId, eligibleSince,
  };
  return {
    claim: {
      claimId, claimDigest, transitionDigest, operationReceiptDigest: D(`receipt:${claimId}`),
      entrySchema: "agentic-cloud-collaboration-entry/v2",
      claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
      state, recordedState, writeAuthority, scopeReserved, ...common,
      evidenceDigest: null, recovery: null, integration: null, retirement: null,
      handoff: null, release: null, canonicalDescendantProof: null,
    },
    entry: {
      schema: "agentic-cloud-collaboration-entry/v2", action: "claim", sequence,
      claimId, claimDigest, digest: transitionDigest, repositoryId: REPOSITORY_ID,
      idempotencyKey: D(`key:${claimId}`), requestDigest: D(`request:${claimId}`),
      evaluationTime: sequence === 1 ? T0 : sequence === 2 ? T1 : T2,
      state: recordedState, transitionCounter: 1, heartbeatCounter: 0,
      recordedExpiresAt: expiresAt, predecessorClaimId, reviewRequestId: null,
      ...common,
    },
  };
}

function terminalDirectSuccessor(label = "historical-direct") {
  return {
    claimId: D(label), lineageCount: 2,
    lineageDigest: D(`${label}:lineage`),
    genesisEntryDigest: D(`${label}:genesis`),
    terminalEntryDigest: D(`${label}:terminal`),
    terminalClaimDigest: D(`${label}:claim`),
    predecessorClaimId: BRIDGE, terminalAction: "retire", terminalState: "retired",
    terminalTransitionCounter: 2, retirementReason: "superseded",
    finalRevision: SHA("a"), registryAssociationDigest: digestValue([]),
    pullRequestMarkerAssociationDigest: digestValue([]),
  };
}

function rawGenesis(pair) {
  const source = pair.claim;
  return {
    schema: "agentic-cloud-collaboration-entry/v2", action: "claim",
    sequence: pair.entry.sequence, claimId: source.claimId,
    claimDigest: source.claimDigest, digest: source.transitionDigest,
    claimCore: {
      claimId: source.claimId, actorId: source.actorId, repositoryId: source.repositoryId,
      workItemId: source.workItemId, deviceId: source.deviceId, sessionId: source.sessionId,
      canonicalBaseRevision: source.canonicalBaseRevision,
      laneRevision: source.laneRevision, declaredWriteScope: source.declaredWriteScope,
      writeSetDigest: source.writeSetDigest, leaseEpoch: source.leaseEpoch,
      transitionCounter: 1, heartbeatCounter: 0, state: "waiting-successor",
      expiresAt: source.expiresAt, evidenceDigest: null, reviewRequestId: null,
      predecessorClaimId: source.predecessorClaimId, eligibleSince: source.eligibleSince,
      handoff: null, release: null,
    },
  };
}

function rawRetirement(genesis) {
  const terminal = structuredClone(genesis);
  terminal.action = "retire";
  terminal.sequence += 1;
  terminal.claimDigest = D(`retired:${genesis.claimId}`);
  terminal.digest = D(`retirement:${genesis.claimId}`);
  terminal.claimCore.transitionCounter = 2;
  terminal.claimCore.state = "retired";
  terminal.claimCore.retirement = {
    reason: "superseded", finalRevision: genesis.claimCore.laneRevision,
    reviewRequestId: null, integrationReceiptDigest: null, retiredAt: T4,
    bytesDigest: D("retirement-bytes"), namedChecksDigest: D("retirement-checks"),
    handoffEvidenceDigest: D("retirement-handoff"),
  };
  return terminal;
}

function writerMarker(value) {
  return `<!-- agentic-writer-lease/v2 ${JSON.stringify(value)} -->`;
}

function pull(number, id, body = "") {
  return {
    number, id, state: "OPEN", isDraft: true, mergedAt: null, closedAt: null,
    headRefName: `branch-${number}`, headRefOid: SHA("c"), baseRefName: "main",
    baseRefOid: SHA("a"), body,
  };
}
function page(nodes, hasNextPage, endCursor, totalCount) {
  return { data: { repository: { pullRequests: {
    totalCount, nodes, pageInfo: { hasNextPage, endCursor },
  } } } };
}
function mutate(value, action) {
  const clone = structuredClone(value);
  action(clone);
  return clone;
}
