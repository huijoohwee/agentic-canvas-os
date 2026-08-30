// Responsibility: Seal the two separately authorized waiting-bridge recovery transactions.
import {
  canonicalJson, digestValue, normalizeWriteSet, writeSetsOverlap,
} from "./cloud-collaboration-primitives.mjs";
import {
  claimOnlyOperationKeyFromDigest, claimOnlyOperationReceiptForEntry,
  claimOnlyRetirementRequestDigest,
} from "./claim-only-partial-start-retirement-store.mjs";

export const BRIDGE_RETIREMENT_OPERATION = "claim-only-waiting-bridge-retirement";
export const SUCCESSOR_PROMOTION_OPERATION = "claim-only-existing-successor-promotion";
export const BRIDGE_RETIREMENT_PHASES = Object.freeze([
  "authorized", "prepared", "retirement-intent", "bridge-retired", "verified", "complete",
]);
export const SUCCESSOR_PROMOTION_PHASES = Object.freeze([
  "authorized", "prepared", "promotion-intent", "successor-promoted", "verified", "complete",
]);
export const WAITING_BRIDGE_PLAN_SCHEMAS = Object.freeze({
  [BRIDGE_RETIREMENT_OPERATION]:
    "agentic-claim-only-waiting-bridge-retirement-plan/v1",
  [SUCCESSOR_PROMOTION_OPERATION]:
    "agentic-claim-only-existing-successor-promotion-plan/v1",
});
export const WAITING_BRIDGE_JOURNAL_SCHEMA =
  "agentic-claim-only-waiting-bridge-reconciliation-journal/v1";
export const WAITING_BRIDGE_RESULT_SCHEMAS = Object.freeze({
  [BRIDGE_RETIREMENT_OPERATION]:
    "agentic-claim-only-waiting-bridge-retirement-result/v1",
  [SUCCESSOR_PROMOTION_OPERATION]:
    "agentic-claim-only-existing-successor-promotion-result/v1",
});
export const BRIDGE_RETIREMENT_EVIDENCE_SCHEMA =
  "agentic-claim-only-waiting-bridge-retirement-evidence/v1";
export const SUCCESSOR_PROMOTION_EVIDENCE_SCHEMA =
  "agentic-claim-only-existing-successor-promotion-evidence/v1";

const DIGEST = /^[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40}$/u;
const ENTRY_SCHEMA = "agentic-cloud-collaboration-entry/v2";
const FORBIDDEN_EFFECTS = Object.freeze([
  "source-byte", "git-object", "git-ref", "branch", "worktree", "writer-lease",
  "pull-request", "pull-request-marker", "new-claim", "release", "integration",
  "deployment", "cleanup", "rollback",
]);

export function buildBridgeRetirementPlan(value) {
  return sealPlan(BRIDGE_RETIREMENT_OPERATION, normalizeRetirementEvidence(value));
}

export function buildExistingSuccessorPromotionPlan(value) {
  return sealPlan(SUCCESSOR_PROMOTION_OPERATION, normalizePromotionEvidence(value));
}

export const buildClaimOnlyWaitingBridgeRetirementPlan = buildBridgeRetirementPlan;
export const buildClaimOnlyExistingSuccessorPromotionPlan =
  buildExistingSuccessorPromotionPlan;

export function normalizeWaitingBridgePlan(value) {
  object(value, "plan");
  const rebuilt = value.operation === BRIDGE_RETIREMENT_OPERATION
    ? buildBridgeRetirementPlan(value.evidence)
    : value.operation === SUCCESSOR_PROMOTION_OPERATION
      ? buildExistingSuccessorPromotionPlan(value.evidence)
      : invalid("plan operation");
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("plan seal");
  return rebuilt;
}

export function authorizeWaitingBridgePlan(plan, authorization) {
  const normalized = normalizeWaitingBridgePlan(plan);
  if (authorization !== normalized.exactAuthorization) {
    throw new Error(`Exact authorization required: ${normalized.exactAuthorization}`);
  }
  return digestValue({
    schema: "agentic-claim-only-waiting-bridge-authorization/v1",
    operation: normalized.operation,
    planDigest: normalized.planDigest,
    authorization,
  });
}

export function createWaitingBridgeJournal(plan) {
  const normalized = normalizeWaitingBridgePlan(plan);
  return sealJournal({
    schema: WAITING_BRIDGE_JOURNAL_SCHEMA,
    operation: normalized.operation,
    plan: normalized,
    state: null,
  });
}

export function startWaitingBridgeJournal(journal, authorization) {
  const current = normalizeWaitingBridgeJournal(journal);
  if (current.state !== null) throw new Error("Waiting-bridge journal is already authorized.");
  return sealJournal({
    schema: WAITING_BRIDGE_JOURNAL_SCHEMA,
    operation: current.operation,
    plan: current.plan,
    state: {
      phase: "authorized",
      receipts: {
        authorized: phaseReceipt(current.plan, "authorized", {
          authorizationDigest: authorizeWaitingBridgePlan(current.plan, authorization),
        }),
      },
    },
  });
}

export function advanceWaitingBridgeJournal(journal, phase, values) {
  const current = normalizeWaitingBridgeJournal(journal);
  if (!current.state) throw new Error("Waiting-bridge journal is not authorized.");
  const phases = phasesFor(current.operation);
  if (phases.indexOf(phase) !== phases.indexOf(current.state.phase) + 1) {
    throw new Error(`Waiting-bridge operation cannot advance from ${current.state.phase} to ${phase}.`);
  }
  return sealJournal({
    schema: WAITING_BRIDGE_JOURNAL_SCHEMA,
    operation: current.operation,
    plan: current.plan,
    state: {
      phase,
      receipts: {
        ...current.state.receipts,
        [phase]: phaseReceipt(current.plan, phase, values, current.state.receipts),
      },
    },
  });
}

export function normalizeWaitingBridgeJournal(value) {
  object(value, "journal");
  const plan = normalizeWaitingBridgePlan(value.plan);
  if (value.schema !== WAITING_BRIDGE_JOURNAL_SCHEMA || value.operation !== plan.operation) {
    invalid("journal identity");
  }
  let state = null;
  if (value.state !== null) {
    object(value.state, "journal state");
    const phases = phasesFor(plan.operation);
    const index = phases.indexOf(value.state.phase);
    if (index < 0) invalid("journal phase");
    object(value.state.receipts, "journal receipts");
    const receipts = {};
    for (let cursor = 0; cursor <= index; cursor += 1) {
      const phase = phases[cursor];
      receipts[phase] = normalizePhaseReceipt(
        plan, phase, value.state.receipts[phase], receipts,
      );
    }
    if (Object.keys(receipts).length !== Object.keys(value.state.receipts).length) {
      invalid("journal phase ordering");
    }
    state = deepFreeze({ phase: value.state.phase, receipts });
  }
  const core = {
    schema: WAITING_BRIDGE_JOURNAL_SCHEMA,
    operation: plan.operation,
    plan,
    state,
  };
  if (value.journalDigest !== digestValue(core)
    || canonicalJson(value) !== canonicalJson({ ...core, journalDigest: value.journalDigest })) {
    invalid("journal seal");
  }
  return deepFreeze({ ...core, journalDigest: value.journalDigest });
}

export function waitingBridgeOperationKey(plan, phase) {
  const normalized = normalizeWaitingBridgePlan(plan);
  if (!phasesFor(normalized.operation).includes(phase) || phase === "authorized") {
    invalid("operation phase");
  }
  return claimOnlyOperationKeyFromDigest(normalized.operation, normalized.planDigest, phase);
}

export function bridgeRetirementRequestDigest(plan) {
  const normalized = normalizeWaitingBridgePlan(plan);
  if (normalized.operation !== BRIDGE_RETIREMENT_OPERATION) invalid("retirement request plan");
  return claimOnlyRetirementRequestDigest(
    normalized, normalized.evidence.bridge, "bridge-retired",
  );
}

export function successorPromotionTemplateDigest(plan) {
  const normalized = normalizeWaitingBridgePlan(plan);
  if (normalized.operation !== SUCCESSOR_PROMOTION_OPERATION) invalid("promotion request plan");
  const claim = normalized.evidence.successor;
  return digestValue({
    action: "continue",
    request: {
      claimId: claim.claimId,
      expectedFenceRevision: claim.claimDigest,
      expectedTransitionCounter: 1,
      mode: "promote",
      ttlSeconds: normalized.evidence.ttlSeconds,
      deviceId: claim.deviceId,
      sessionId: claim.sessionId,
      idempotencyKey: waitingBridgeOperationKey(normalized, "successor-promoted"),
    },
  });
}

export function successorPromotionEntryRequestDigest(plan, expiresAt) {
  const normalized = normalizeWaitingBridgePlan(plan);
  if (normalized.operation !== SUCCESSOR_PROMOTION_OPERATION) invalid("promotion request plan");
  instant(expiresAt, "promotion expiry");
  const claim = normalized.evidence.successor;
  return digestValue({
    action: "continue",
    intent: {
      repositoryId: claim.repositoryId,
      actorId: claim.actorId,
      deviceId: claim.deviceId,
      sessionId: claim.sessionId,
      claimId: claim.claimId,
      expectedFenceRevision: claim.claimDigest,
      expectedTransitionCounter: 1,
      mode: "promote",
      laneRevision: null,
      reviewRequestId: null,
      expiresAt,
      focusedEvidenceDigest: null,
      handoffEvidenceDigest: null,
      recoveryEvidenceDigest: null,
    },
  });
}

export function waitingBridgeEffectDigest(values) {
  const effect = effectProjection(values);
  return digestValue(effect);
}

export function waitingBridgeTerminalRelevantDigest(plan, values) {
  const normalized = normalizeWaitingBridgePlan(plan);
  const effect = effectProjection(values);
  return digestValue({
    operation: normalized.operation,
    planDigest: normalized.planDigest,
    anchor: normalized.evidence.anchor,
    anchorEntry: normalized.evidence.anchorEntry,
    anchorLineageCount: normalized.evidence.anchorLineageCount,
    bridgeGenesis: normalized.evidence.bridgeEntry,
    successorGenesis: normalized.evidence.successorEntry,
    effect,
  });
}

export function waitingBridgePreservationDigest(plan) {
  return digestValue(normalizeWaitingBridgePlan(plan).evidence.preservation);
}

export function buildWaitingBridgeResult(journal) {
  const current = normalizeWaitingBridgeJournal(journal);
  if (!current.state || !["verified", "complete"].includes(current.state.phase)) {
    throw new Error("Waiting-bridge completion requires an exact verified journal.");
  }
  return completionResult(current.plan, current.state.receipts);
}

export function normalizeWaitingBridgeResult(value, operation = value?.operation) {
  object(value, "result");
  const schema = WAITING_BRIDGE_RESULT_SCHEMAS[operation];
  const core = { ...value };
  delete core.resultDigest;
  if (!schema || value.schema !== schema || value.status !== "complete"
    || value.operation !== operation || value.resultDigest !== digestValue(core)
    || canonicalJson(value.forbiddenEffects) !== canonicalJson(FORBIDDEN_EFFECTS)) {
    invalid("result seal");
  }
  const expectedKeys = ["anchorClaimId", "authorizationDigest", "bridgeClaimId",
    "effect", "effectDigest", "forbiddenEffects", "operation", "planDigest",
    "preservationDigest", "schema", "status", "successorClaimId",
    "terminalRelevantDigest"].sort();
  if (canonicalJson(Object.keys(core).sort()) !== canonicalJson(expectedKeys)) {
    invalid("result fields");
  }
  for (const name of ["anchorClaimId", "authorizationDigest", "bridgeClaimId",
    "effectDigest", "planDigest", "preservationDigest", "successorClaimId",
    "terminalRelevantDigest"]) digest(core[name], `result ${name}`);
  const effectKeys = operation === BRIDGE_RETIREMENT_OPERATION
    ? ["claimId", "operationKey", "operationReceiptDigest", "requestDigest",
      "terminalClaimDigest", "terminalEntryDigest"]
    : ["authorityOutputDigest", "claimId", "evaluationTime", "expiresAt",
      "operationKey", "operationReceiptDigest", "requestDigest",
      "terminalClaimDigest", "terminalEntryDigest"];
  if (canonicalJson(Object.keys(object(core.effect, "result effect")).sort())
    !== canonicalJson(effectKeys.sort()) || core.effectDigest !== digestValue(core.effect)) {
    invalid("result effect");
  }
  for (const [name, member] of Object.entries(core.effect)) {
    if (name.endsWith("Digest") || name.endsWith("Key") || name === "claimId") {
      digest(member, `result effect ${name}`);
    }
  }
  if (operation === SUCCESSOR_PROMOTION_OPERATION) {
    instant(core.effect.evaluationTime, "result promotion evaluation");
    instant(core.effect.expiresAt, "result promotion expiry");
  }
  return deepFreeze({ ...core, resultDigest: value.resultDigest });
}

function sealPlan(operation, evidence) {
  const phases = phasesFor(operation);
  const core = {
    schema: WAITING_BRIDGE_PLAN_SCHEMAS[operation],
    operation,
    anchorClaimId: evidence.anchor.claimId,
    bridgeClaimId: evidence.bridge.claimId,
    successorClaimId: evidence.successor.claimId,
    evidence,
    effect: operation === BRIDGE_RETIREMENT_OPERATION
      ? "retire-bridge-cloud-claim" : "promote-existing-successor-cloud-claim",
    forbiddenEffects: FORBIDDEN_EFFECTS,
    phases,
  };
  const planDigest = digestValue(core);
  return deepFreeze({
    ...core,
    planDigest,
    exactAuthorization: `authorize ${operation} ${planDigest}`,
  });
}

function completionResult(plan, receipts) {
  const effectPhase = plan.operation === BRIDGE_RETIREMENT_OPERATION
    ? "bridge-retired" : "successor-promoted";
  const effect = effectProjection(receipts[effectPhase]);
  const verified = receipts.verified;
  if (verified.effectDigest !== digestValue(effect)) invalid("verified effect join");
  const core = {
    schema: WAITING_BRIDGE_RESULT_SCHEMAS[plan.operation],
    status: "complete",
    operation: plan.operation,
    planDigest: plan.planDigest,
    authorizationDigest: receipts.authorized.authorizationDigest,
    anchorClaimId: plan.anchorClaimId,
    bridgeClaimId: plan.bridgeClaimId,
    successorClaimId: plan.successorClaimId,
    effect,
    effectDigest: verified.effectDigest,
    terminalRelevantDigest: verified.terminalRelevantDigest,
    preservationDigest: verified.preservationDigest,
    forbiddenEffects: FORBIDDEN_EFFECTS,
  };
  return deepFreeze({ ...core, resultDigest: digestValue(core) });
}

function phaseReceipt(plan, phase, values, prior = {}) {
  const normalized = normalizePhaseValues(plan, phase, values, prior);
  const core = { phase, ...normalized };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function normalizePhaseReceipt(plan, phase, value, prior) {
  object(value, `${phase} receipt`);
  const { phase: received, receiptDigest, ...values } = value;
  const rebuilt = phaseReceipt(plan, phase, values, prior);
  if (received !== phase || receiptDigest !== rebuilt.receiptDigest
    || canonicalJson(value) !== canonicalJson(rebuilt)) invalid(`${phase} receipt seal`);
  return rebuilt;
}

function normalizePhaseValues(plan, phase, value, prior) {
  object(value, `${phase} values`);
  if (phase === "authorized") {
    return exactKeys({
      authorizationDigest: exact(value.authorizationDigest, digestValue({
        schema: "agentic-claim-only-waiting-bridge-authorization/v1",
        operation: plan.operation,
        planDigest: plan.planDigest,
        authorization: plan.exactAuthorization,
      }), "authorization digest"),
    }, value, phase);
  }
  const operationKey = digest(value.operationKey, `${phase} operation key`);
  if (operationKey !== waitingBridgeOperationKey(plan, phase)) invalid(`${phase} operation key`);
  if (phase === "prepared") {
    return exactKeys({
      operationKey,
      stableFrameDigest: digest(value.stableFrameDigest, "prepared stable frame"),
    }, value, phase);
  }
  if (phase === "retirement-intent") {
    const requestDigest = bridgeRetirementRequestDigest(plan);
    return exactKeys({
      operationKey,
      effectOperationKey: exact(value.effectOperationKey,
        waitingBridgeOperationKey(plan, "bridge-retired"), "retirement effect key"),
      claimId: exact(value.claimId, plan.bridgeClaimId, "retirement claim"),
      expectedFenceRevision: exact(value.expectedFenceRevision,
        plan.evidence.bridge.claimDigest, "retirement fence"),
      expectedTransitionCounter: exact(value.expectedTransitionCounter, 1,
        "retirement transition"),
      requestDigest: exact(value.requestDigest, requestDigest, "retirement request"),
      intentDigest: exact(value.intentDigest, digestValue({
        operationKey: value.effectOperationKey, claimId: value.claimId,
        expectedFenceRevision: value.expectedFenceRevision,
        expectedTransitionCounter: value.expectedTransitionCounter, requestDigest,
      }), "retirement intent"),
    }, value, phase);
  }
  if (phase === "promotion-intent") {
    const requestTemplateDigest = successorPromotionTemplateDigest(plan);
    return exactKeys({
      operationKey,
      effectOperationKey: exact(value.effectOperationKey,
        waitingBridgeOperationKey(plan, "successor-promoted"), "promotion effect key"),
      claimId: exact(value.claimId, plan.successorClaimId, "promotion claim"),
      expectedFenceRevision: exact(value.expectedFenceRevision,
        plan.evidence.successor.claimDigest, "promotion fence"),
      expectedTransitionCounter: exact(value.expectedTransitionCounter, 1,
        "promotion transition"),
      ttlSeconds: exact(value.ttlSeconds, plan.evidence.ttlSeconds, "promotion TTL"),
      requestTemplateDigest: exact(value.requestTemplateDigest,
        requestTemplateDigest, "promotion request template"),
      intentDigest: exact(value.intentDigest, digestValue({
        operationKey: value.effectOperationKey, claimId: value.claimId,
        expectedFenceRevision: value.expectedFenceRevision,
        expectedTransitionCounter: value.expectedTransitionCounter,
        ttlSeconds: value.ttlSeconds, requestTemplateDigest,
      }), "promotion intent"),
    }, value, phase);
  }
  if (["bridge-retired", "successor-promoted"].includes(phase)) {
    const claim = phase === "bridge-retired" ? plan.evidence.bridge : plan.evidence.successor;
    const normalized = {
      operationKey,
      claimId: exact(value.claimId, claim.claimId, `${phase} claim`),
      requestDigest: digest(value.requestDigest, `${phase} request`),
      operationReceiptDigest: digest(value.operationReceiptDigest,
        `${phase} operation receipt`),
      terminalEntryDigest: digest(value.terminalEntryDigest, `${phase} terminal entry`),
      terminalClaimDigest: digest(value.terminalClaimDigest, `${phase} terminal claim`),
      transportReceiptDigest: value.transportReceiptDigest === null ? null
        : digest(value.transportReceiptDigest, `${phase} transport receipt`),
      disposition: enumeration(value.disposition,
        ["projected", "adopted-response-loss"], `${phase} disposition`),
      providerMutation: boolean(value.providerMutation, `${phase} provider mutation`),
      ...(phase === "successor-promoted" ? {
        authorityOutputDigest: digest(value.authorityOutputDigest,
          "successor promotion authority output"),
        evaluationTime: instant(value.evaluationTime, "successor promotion evaluation"),
        expiresAt: instant(value.expiresAt, "successor promotion expiry"),
      } : {}),
      effectDigest: digest(value.effectDigest, `${phase} effect`),
    };
    if (normalized.providerMutation !== (normalized.disposition === "projected")) {
      invalid(`${phase} disposition/mutation join`);
    }
    if (phase === "bridge-retired"
      && normalized.requestDigest !== bridgeRetirementRequestDigest(plan)) {
      invalid("bridge retirement request join");
    }
    if (phase === "successor-promoted" && (
      Date.parse(normalized.expiresAt) - Date.parse(normalized.evaluationTime)
        !== plan.evidence.ttlSeconds * 1_000
      || normalized.requestDigest
        !== successorPromotionEntryRequestDigest(plan, normalized.expiresAt)
    )) invalid("successor promotion request/TTL join");
    if (normalized.effectDigest !== digestValue(effectProjection(normalized))) {
      invalid(`${phase} effect digest`);
    }
    return exactKeys(normalized, value, phase);
  }
  if (phase === "verified") {
    const effectPhase = plan.operation === BRIDGE_RETIREMENT_OPERATION
      ? "bridge-retired" : "successor-promoted";
    return exactKeys({
      operationKey,
      effectDigest: exact(value.effectDigest,
        waitingBridgeEffectDigest(prior[effectPhase]), "verified effect"),
      terminalRelevantDigest: exact(value.terminalRelevantDigest,
        waitingBridgeTerminalRelevantDigest(plan, prior[effectPhase]),
        "terminal relevant digest"),
      preservationDigest: exact(value.preservationDigest,
        waitingBridgePreservationDigest(plan), "terminal preservation"),
    }, value, phase);
  }
  if (phase === "complete") {
    const result = normalizeWaitingBridgeResult(value.result, plan.operation);
    if (canonicalJson(result) !== canonicalJson(completionResult(plan, prior))) {
      invalid("completion result journal join");
    }
    return exactKeys({ operationKey, result }, value, phase);
  }
  return invalid("phase values");
}

function normalizeRetirementEvidence(value) {
  const evidence = normalizeSharedEvidence(value, BRIDGE_RETIREMENT_EVIDENCE_SCHEMA);
  assertAnchor(evidence);
  assertOriginalWaiter(evidence.bridge, evidence.bridgeEntry,
    evidence.bridgeLineageCount, evidence.anchor.claimId, "bridge");
  assertOriginalWaiter(evidence.successor, evidence.successorEntry,
    evidence.successorLineageCount, evidence.bridge.claimId, "successor");
  assertChain(evidence);
  assertOriginalTopology(evidence);
  assertAssociations(evidence.associations, evidence.anchor);
  assertPeerFrame(evidence.peerFrame, evidence);
  return evidence;
}

function normalizePromotionEvidence(value) {
  const evidence = normalizeSharedEvidence(value, SUCCESSOR_PROMOTION_EVIDENCE_SCHEMA);
  integer(evidence.ttlSeconds, "promotion TTL", 60, 86_400);
  assertAnchor(evidence);
  assertOriginalWaiter(evidence.successor, evidence.successorEntry,
    evidence.successorLineageCount, evidence.bridge.claimId, "successor");
  assertChain(evidence);
  assertOriginalTopology(evidence);
  assertAssociations(evidence.associations, evidence.anchor);
  object(evidence.phaseA, "Phase A binding");
  const retirementPlan = normalizeWaitingBridgePlan(evidence.phaseA.plan);
  const retirementResult = normalizeWaitingBridgeResult(
    evidence.phaseA.result, BRIDGE_RETIREMENT_OPERATION,
  );
  const terminal = normalizeEntry(evidence.phaseA.bridgeRetirementEntry,
    "Phase A bridge retirement entry");
  const terminalReceipt = claimOnlyOperationReceiptForEntry(terminal, "retired");
  const phaseAEffect = retirementResult.effect;
  if (retirementPlan.operation !== BRIDGE_RETIREMENT_OPERATION
    || retirementResult.planDigest !== retirementPlan.planDigest
    || retirementResult.anchorClaimId !== retirementPlan.anchorClaimId
    || retirementResult.bridgeClaimId !== retirementPlan.bridgeClaimId
    || retirementResult.successorClaimId !== retirementPlan.successorClaimId
    || retirementResult.authorizationDigest !== digestValue({
      schema: "agentic-claim-only-waiting-bridge-authorization/v1",
      operation: retirementPlan.operation,
      planDigest: retirementPlan.planDigest,
      authorization: retirementPlan.exactAuthorization,
    })
    || retirementResult.resultDigest !== evidence.phaseA.resultDigest
    || retirementResult.effectDigest !== evidence.phaseA.effectDigest
    || terminal.action !== "retire" || terminal.claimId !== evidence.bridge.claimId
    || terminal.digest !== retirementResult.effect.terminalEntryDigest
    || terminal.requestDigest !== bridgeRetirementRequestDigest(retirementPlan)
    || terminal.claimDigest !== retirementResult.effect.terminalClaimDigest
    || terminal.transitionCounter !== 2 || terminal.state !== "retired"
    || terminal.retirement?.reason !== "superseded"
    || terminal.retirement?.finalRevision !== evidence.bridge.laneRevision
    || terminal.retirement?.reviewRequestId !== null
    || terminal.retirement?.integrationReceiptDigest !== null
    || phaseAEffect.operationKey !== waitingBridgeOperationKey(
      retirementPlan, "bridge-retired")
    || phaseAEffect.claimId !== evidence.bridge.claimId
    || phaseAEffect.requestDigest !== terminal.requestDigest
    || phaseAEffect.operationReceiptDigest !== terminalReceipt.receiptDigest
    || phaseAEffect.terminalEntryDigest !== terminal.digest
    || phaseAEffect.terminalClaimDigest !== terminal.claimDigest
    || retirementResult.effectDigest !== digestValue(phaseAEffect)
    || retirementResult.terminalRelevantDigest
      !== waitingBridgeTerminalRelevantDigest(retirementPlan, phaseAEffect)
    || retirementResult.preservationDigest
      !== waitingBridgePreservationDigest(retirementPlan)
    || terminal.idempotencyKey !== digestValue(waitingBridgeOperationKey(
      retirementPlan, "bridge-retired"))
    || retirementPlan.anchorClaimId !== evidence.anchor.claimId
    || retirementPlan.bridgeClaimId !== evidence.bridge.claimId
    || retirementPlan.successorClaimId !== evidence.successor.claimId
    || canonicalJson(retirementPlan.evidence.anchor) !== canonicalJson(evidence.anchor)
    || canonicalJson(retirementPlan.evidence.anchorEntry) !== canonicalJson(evidence.anchorEntry)
    || retirementPlan.evidence.anchorLineageCount !== evidence.anchorLineageCount
    || canonicalJson(retirementPlan.evidence.associations)
      !== canonicalJson(evidence.associations)
    || canonicalJson(retirementPlan.evidence.preservation)
      !== canonicalJson(evidence.preservation)
    || canonicalJson(retirementPlan.evidence.bridge) !== canonicalJson(evidence.bridge)
    || canonicalJson(retirementPlan.evidence.successor) !== canonicalJson(evidence.successor)) {
    invalid("Phase A plan/result/entry/effect binding");
  }
  if (evidence.bridgeCurrentCount !== 0 || evidence.bridgeLineageCount !== 2) {
    invalid("retired bridge lineage cardinality");
  }
  assertPriority(evidence.priority, evidence.successor);
  return deepFreeze({
    ...evidence,
    phaseA: deepFreeze({
      ...evidence.phaseA,
      plan: retirementPlan,
      result: retirementResult,
      bridgeRetirementEntry: terminal,
    }),
  });
}

function assertAnchor(evidence) {
  const claim = evidence.anchor;
  const entry = evidence.anchorEntry;
  if (claim.entrySchema !== ENTRY_SCHEMA || claim.claimIdentitySchema !== ENTRY_SCHEMA
    || claim.state !== "dormant-preserved" || claim.writeAuthority !== false
    || claim.scopeReserved !== true || entry.schema !== ENTRY_SCHEMA
    || entry.claimId !== claim.claimId || entry.claimDigest !== claim.claimDigest
    || entry.digest !== claim.transitionDigest || entry.repositoryId !== claim.repositoryId
    || entry.actorId !== claim.actorId || entry.deviceId !== claim.deviceId
    || entry.sessionId !== claim.sessionId || entry.workItemId !== claim.workItemId
    || entry.canonicalBaseRevision !== claim.canonicalBaseRevision
    || entry.laneRevision !== claim.laneRevision
    || entry.writeSetDigest !== claim.writeSetDigest
    || canonicalJson(entry.declaredWriteScope) !== canonicalJson(claim.declaredWriteScope)
    || entry.leaseEpoch !== claim.leaseEpoch || entry.recordedExpiresAt !== claim.expiresAt
    || entry.eligibleSince !== claim.eligibleSince
    || entry.transitionCounter !== claim.transitionCounter
    || entry.heartbeatCounter !== claim.heartbeatCounter) {
    invalid("dormant reserving anchor");
  }
}

function normalizeSharedEvidence(value, schema) {
  const evidence = clone(object(value, "evidence"));
  if (evidence.schema !== schema) invalid("evidence schema");
  instant(evidence.observedAt, "observedAt");
  evidence.anchor = normalizeClaim(evidence.anchor, "anchor");
  evidence.bridge = normalizeClaim(evidence.bridge, "bridge");
  evidence.successor = normalizeClaim(evidence.successor, "successor");
  evidence.anchorEntry = normalizeEntry(evidence.anchorEntry, "anchor entry");
  evidence.bridgeEntry = normalizeEntry(evidence.bridgeEntry, "bridge entry");
  evidence.successorEntry = normalizeEntry(evidence.successorEntry, "successor entry");
  positive(evidence.anchorLineageCount, "anchor lineage count");
  positive(evidence.bridgeLineageCount, "bridge lineage count");
  positive(evidence.successorLineageCount, "successor lineage count");
  normalizeRepository(evidence.repository);
  normalizeController(evidence.controller);
  normalizeCanonical(evidence.canonical);
  normalizeCloud(evidence.cloud);
  normalizePreservation(evidence.preservation);
  object(evidence.associations, "associations");
  object(evidence.topology, "topology");
  if (evidence.repository.targetRepository !== evidence.repository.nameWithOwner
    || evidence.repository.targetRepository !== evidence.controller.repository
    || evidence.repository.targetRepository !== evidence.controller.nameWithOwner
    || evidence.repository.targetRepository !== evidence.canonical.targetRepository
    || evidence.repository.targetRepository !== evidence.cloud.ledgerRepository
    || evidence.repository.providerRepositoryId !== evidence.controller.providerRepositoryId) {
    invalid("repository identity");
  }
  return deepFreeze(evidence);
}

function assertOriginalWaiter(claim, entry, count, predecessor, label) {
  if (count !== 1 || claim.entrySchema !== ENTRY_SCHEMA
    || claim.claimIdentitySchema !== ENTRY_SCHEMA || entry.schema !== ENTRY_SCHEMA
    || entry.action !== "claim" || entry.claimId !== claim.claimId
    || entry.claimDigest !== claim.claimDigest || entry.digest !== claim.transitionDigest
    || entry.repositoryId !== claim.repositoryId || entry.actorId !== claim.actorId
    || entry.deviceId !== claim.deviceId || entry.sessionId !== claim.sessionId
    || entry.workItemId !== claim.workItemId
    || entry.canonicalBaseRevision !== claim.canonicalBaseRevision
    || entry.laneRevision !== claim.laneRevision
    || entry.writeSetDigest !== claim.writeSetDigest
    || canonicalJson(entry.declaredWriteScope) !== canonicalJson(claim.declaredWriteScope)
    || entry.leaseEpoch !== claim.leaseEpoch
    || entry.recordedExpiresAt !== claim.expiresAt
    || entry.eligibleSince !== claim.eligibleSince
    || entry.state !== "waiting-successor" || claim.state !== "waiting-successor"
    || claim.recordedState !== "waiting-successor" || claim.writeAuthority !== false
    || claim.scopeReserved !== false || claim.transitionCounter !== 1
    || claim.heartbeatCounter !== 0 || claim.predecessorClaimId !== predecessor
    || entry.predecessorClaimId !== predecessor || entry.transitionCounter !== 1
    || entry.heartbeatCounter !== 0 || claim.reviewRequestId !== null
    || entry.reviewRequestId !== null || claim.evidenceDigest !== null
    || claim.recovery !== null || claim.integration !== null || claim.retirement !== null
    || claim.handoff !== null || claim.release !== null) {
    invalid(`original ${label} waiter`);
  }
}

function assertChain(evidence) {
  const claims = [evidence.anchor, evidence.bridge, evidence.successor];
  if (new Set(claims.map(claim => claim.claimId)).size !== 3
    || new Set(claims.map(claim => claim.actorId)).size !== 1
    || new Set(claims.map(claim => claim.repositoryId)).size !== 1
    || evidence.bridge.deviceId !== evidence.successor.deviceId
    || evidence.bridge.predecessorClaimId !== evidence.anchor.claimId
    || evidence.successor.predecessorClaimId !== evidence.bridge.claimId
    || Date.parse(evidence.bridge.expiresAt) > Date.parse(evidence.observedAt)
    || Date.parse(evidence.successor.expiresAt) > Date.parse(evidence.observedAt)) {
    invalid("exact chain identity or expiry");
  }
}

function assertOriginalTopology(evidence) {
  const actual = {
    anchorBridge: writeSetsOverlap(evidence.anchor.declaredWriteScope,
      evidence.bridge.declaredWriteScope),
    bridgeSuccessor: writeSetsOverlap(evidence.bridge.declaredWriteScope,
      evidence.successor.declaredWriteScope),
    anchorSuccessor: writeSetsOverlap(evidence.anchor.declaredWriteScope,
      evidence.successor.declaredWriteScope),
  };
  const expected = { anchorBridge: true, bridgeSuccessor: true, anchorSuccessor: false };
  if (canonicalJson(actual) !== canonicalJson(expected)
    || canonicalJson(evidence.topology) !== canonicalJson(expected)) {
    invalid("bridge-chain overlap topology");
  }
}

function assertAssociations(value, anchor) {
  for (const name of ["anchorRegistryMatches", "anchorPullRequestMarkerMatches",
    "bridgeRegistryMatches", "bridgePullRequestMarkerMatches",
    "successorRegistryMatches", "successorPullRequestMarkerMatches"]) {
    if (!Array.isArray(value[name])) invalid(`association ${name}`);
  }
  if (value.anchorRegistryMatches.length !== 1
    || value.anchorPullRequestMarkerMatches.length !== 1
    || value.bridgeRegistryMatches.length !== 0
    || value.bridgePullRequestMarkerMatches.length !== 0
    || value.successorRegistryMatches.length !== 0
    || value.successorPullRequestMarkerMatches.length !== 0) {
    invalid("exact association matches");
  }
  const registry = object(value.anchorRegistryMatches[0], "anchor registry association");
  const pull = object(value.anchorPullRequestMarkerMatches[0], "anchor PR association");
  if (registry.claimId !== anchor.claimId || pull.claimId !== anchor.claimId
    || registry.cloudClaimDigest !== anchor.claimDigest
    || pull.markerClaimDigest !== anchor.claimDigest) {
    invalid("anchor association claim identity");
  }
  digest(registry.claimId, "anchor registry claim");
  digest(registry.cloudClaimDigest, "anchor registry fence");
  digest(pull.claimId, "anchor PR claim");
  digest(pull.markerClaimDigest, "anchor PR fence");
  text(registry.branch, "anchor registry branch");
  digest(registry.leaseDigest, "anchor lease digest");
  text(registry.pullRequestUrl, "anchor ownership PR URL");
  positive(pull.number, "anchor ownership PR number");
  for (const name of ["nodeId", "state", "headRefName", "baseRefName", "markerBranch"]) {
    text(pull[name], `anchor ownership PR ${name}`);
  }
  for (const name of ["bodyDigest", "markerDigest"]) {
    digest(pull[name], `anchor ownership PR ${name}`);
  }
  if (typeof pull.isDraft !== "boolean") invalid("anchor ownership PR draft flag");
  const match = /\/pull\/(\d+)(?:\/?$)/u.exec(registry.pullRequestUrl);
  if (!match || Number(match[1]) !== pull.number || registry.branch !== pull.markerBranch
    || registry.branch !== pull.headRefName) invalid("anchor registry/ownership-PR join");
}

function assertPeerFrame(value, evidence) {
  object(value, "peer frame");
  for (const name of ["reservedClaimIds", "waitingClaimIds", "relevantClaimIds",
    "predecessorConnectedClaimIds", "bridgeDirectSuccessorClaimIds"]) {
    if (!Array.isArray(value[name])) invalid(`peer frame ${name}`);
    value[name].forEach(claimId => digest(claimId, `peer frame ${name}`));
  }
  const reserved = [...value.reservedClaimIds].sort();
  const waiting = [...value.waitingClaimIds].sort();
  const relevant = [...value.relevantClaimIds].sort();
  const connected = [...value.predecessorConnectedClaimIds].sort();
  if (canonicalJson(reserved) !== canonicalJson([evidence.anchor.claimId])
    || canonicalJson(waiting) !== canonicalJson([
      evidence.bridge.claimId, evidence.successor.claimId,
    ].sort())
    || canonicalJson(relevant) !== canonicalJson([
      evidence.anchor.claimId, evidence.bridge.claimId, evidence.successor.claimId,
    ].sort())
    || canonicalJson(connected) !== canonicalJson([
      evidence.anchor.claimId, evidence.bridge.claimId, evidence.successor.claimId,
    ].sort())
    || canonicalJson([...value.bridgeDirectSuccessorClaimIds].sort())
      !== canonicalJson([evidence.successor.claimId])) {
    invalid("unknown same-repository reserved/waiting peer");
  }
}

function assertPriority(value, successor) {
  object(value, "promotion priority");
  if (!Array.isArray(value.reservedOverlapClaimIds)
    || !Array.isArray(value.eligibleWaiting)) invalid("promotion priority arrays");
  const sorted = [...value.eligibleWaiting].sort((left, right) => (
    String(left.eligibleSince).localeCompare(String(right.eligibleSince))
      || left.ledgerSequence - right.ledgerSequence
      || left.claimId.localeCompare(right.claimId)
  ));
  if (value.reservedOverlapClaimIds.length !== 0 || sorted.length !== 1
    || sorted[0].claimId !== successor.claimId
    || sorted[0].eligibleSince !== successor.eligibleSince
    || sorted[0].ledgerSequence !== value.successorLedgerSequence
    || value.selectedClaimId !== successor.claimId
    || canonicalJson(sorted) !== canonicalJson(value.eligibleWaiting)) {
    invalid("first eligible successor");
  }
  instant(sorted[0].eligibleSince, "successor eligible since");
  positive(sorted[0].ledgerSequence, "successor ledger sequence");
  positive(value.successorLedgerSequence, "sealed successor ledger sequence");
}

function normalizeClaim(value, label) {
  const result = clone(object(value, label));
  for (const name of ["claimId", "claimDigest", "transitionDigest",
    "operationReceiptDigest", "writeSetDigest"]) digest(result[name], `${label} ${name}`);
  for (const name of ["canonicalBaseRevision", "laneRevision"]) {
    sha(result[name], `${label} ${name}`);
  }
  for (const name of ["actorId", "repositoryId", "workItemId", "deviceId", "sessionId",
    "state", "recordedState", "entrySchema", "claimIdentitySchema"]) {
    text(result[name], `${label} ${name}`);
  }
  result.declaredWriteScope = normalizeWriteSet(result.declaredWriteScope);
  if (result.writeSetDigest !== digestValue(result.declaredWriteScope)) {
    invalid(`${label} write-set digest`);
  }
  positive(result.leaseEpoch, `${label} epoch`);
  positive(result.transitionCounter, `${label} transition`);
  integer(result.heartbeatCounter, `${label} heartbeat`, 0);
  instant(result.expiresAt, `${label} expiry`);
  result.eligibleSince ??= null;
  result.handoff ??= null;
  result.release ??= null;
  result.evidenceDigest ??= null;
  result.recovery ??= null;
  result.integration ??= null;
  result.retirement ??= null;
  if (result.eligibleSince !== null) instant(result.eligibleSince, `${label} eligible since`);
  if (typeof result.writeAuthority !== "boolean" || typeof result.scopeReserved !== "boolean") {
    invalid(`${label} authority flags`);
  }
  return deepFreeze(result);
}

function normalizeEntry(value, label) {
  const result = clone(object(value, label));
  for (const name of ["claimId", "claimDigest", "digest", "idempotencyKey"]) {
    digest(result[name], `${label} ${name}`);
  }
  positive(result.sequence, `${label} sequence`);
  positive(result.transitionCounter, `${label} transition`);
  integer(result.heartbeatCounter, `${label} heartbeat`, 0);
  for (const name of ["schema", "action", "state"]) text(result[name], `${label} ${name}`);
  instant(result.recordedExpiresAt, `${label} expiry`);
  if (result.evaluationTime !== undefined) instant(result.evaluationTime, `${label} evaluation`);
  if (result.requestDigest !== undefined) digest(result.requestDigest, `${label} request`);
  if (result.repositoryId !== undefined) text(result.repositoryId, `${label} repository`);
  for (const name of ["actorId", "deviceId", "sessionId", "workItemId"]) {
    if (result[name] !== undefined) text(result[name], `${label} ${name}`);
  }
  for (const name of ["canonicalBaseRevision", "laneRevision"]) {
    if (result[name] !== undefined) sha(result[name], `${label} ${name}`);
  }
  if (result.writeSetDigest !== undefined) digest(result.writeSetDigest, `${label} write set`);
  if (result.declaredWriteScope !== undefined) {
    result.declaredWriteScope = normalizeWriteSet(result.declaredWriteScope);
  }
  if (result.leaseEpoch !== undefined) positive(result.leaseEpoch, `${label} epoch`);
  result.eligibleSince ??= null;
  if (result.eligibleSince !== null) instant(result.eligibleSince, `${label} eligible since`);
  return deepFreeze(result);
}

function normalizeRepository(value) {
  const result = object(value, "repository evidence");
  for (const name of ["targetRepository", "providerRepositoryId", "nameWithOwner"]) {
    text(result[name], `repository ${name}`);
  }
  for (const name of ["topLevelDigest", "gitCommonDirectoryDigest", "originUrlDigest"]) {
    digest(result[name], `repository ${name}`);
  }
}

function normalizeController(value) {
  const result = object(value, "controller evidence");
  for (const name of ["repository", "providerRepositoryId", "nameWithOwner"]) {
    text(result[name], `controller ${name}`);
  }
  for (const name of ["headSha", "originMainSha", "remoteMainSha"]) sha(result[name], `controller ${name}`);
  for (const name of ["runtimeDigest", "protectionDigest"]) digest(result[name], `controller ${name}`);
  if (result.branch !== "main" || result.clean !== true || result.protected !== true
    || result.headSha !== result.originMainSha || result.headSha !== result.remoteMainSha) {
    invalid("clean protected controller");
  }
}

function normalizeCanonical(value) {
  const result = object(value, "canonical evidence");
  text(result.targetRepository, "canonical repository");
  sha(result.mainSha, "canonical main");
  if (result.anchorBaseContained !== true || result.bridgeBaseContained !== true
    || result.successorBaseContained !== true) invalid("canonical ancestry");
}

function normalizeCloud(value) {
  const result = object(value, "cloud evidence");
  text(result.ledgerRepository, "ledger repository");
  sha(result.ledgerRevision, "ledger revision");
  for (const name of ["ledgerDigest", "validatedLedgerDigest", "inventoryDigest"]) {
    digest(result[name], `cloud ${name}`);
  }
  positive(result.sequence, "cloud sequence");
}

function normalizePreservation(value) {
  const result = object(value, "preservation evidence");
  for (const name of ["gitRefsDigest", "gitWorktreesDigest", "registryDigest",
    "providerDigest", "associationDigest"]) {
    digest(result[name], `preservation ${name}`);
  }
}

function effectProjection(value) {
  object(value, "effect receipt");
  return deepFreeze({
    operationKey: value.operationKey,
    claimId: value.claimId,
    requestDigest: value.requestDigest,
    operationReceiptDigest: value.operationReceiptDigest,
    terminalEntryDigest: value.terminalEntryDigest,
    terminalClaimDigest: value.terminalClaimDigest,
    ...(value.authorityOutputDigest ? {
      authorityOutputDigest: value.authorityOutputDigest,
      evaluationTime: value.evaluationTime,
      expiresAt: value.expiresAt,
    } : {}),
  });
}

function phasesFor(operation) {
  if (operation === BRIDGE_RETIREMENT_OPERATION) return BRIDGE_RETIREMENT_PHASES;
  if (operation === SUCCESSOR_PROMOTION_OPERATION) return SUCCESSOR_PROMOTION_PHASES;
  return invalid("operation");
}

function sealJournal(core) {
  return normalizeWaitingBridgeJournal({ ...core, journalDigest: digestValue(core) });
}
function exactKeys(normalized, source, label) {
  if (canonicalJson(Object.keys(normalized).sort())
    !== canonicalJson(Object.keys(source).sort())) invalid(`${label} fields`);
  return deepFreeze(normalized);
}
function clone(value) { return JSON.parse(canonicalJson(value)); }
function object(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label); return value; }
function text(value, label) { if (typeof value !== "string" || !value.trim()) invalid(label); return value; }
function digest(value, label) { if (!DIGEST.test(String(value || ""))) invalid(label); return value; }
function sha(value, label) { if (!SHA.test(String(value || ""))) invalid(label); return value; }
function positive(value, label) { return integer(value, label, 1); }
function integer(value, label, minimum, maximum = Number.MAX_SAFE_INTEGER) { if (!Number.isSafeInteger(value) || value < minimum || value > maximum) invalid(label); return value; }
function instant(value, label) { if (typeof value !== "string" || new Date(value).toISOString() !== value) invalid(label); return value; }
function exact(value, expected, label) { if (value !== expected) invalid(label); return value; }
function enumeration(value, allowed, label) { if (!allowed.includes(value)) invalid(label); return value; }
function boolean(value, label) { if (typeof value !== "boolean") invalid(label); return value; }
function invalid(label) { throw new Error(`Waiting-bridge ${label} is invalid.`); }
function deepFreeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); return value; }
