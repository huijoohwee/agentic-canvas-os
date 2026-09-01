// Responsibility: Orchestrate two exact, replay-safe claim-only C3 transactions.
import {
  RETIREMENT_OPERATION, ROLLOVER_OPERATION, advanceClaimOnlyJournal,
  authorizeClaimOnlyPlan, buildClaimOnlyCompletionReceipt,
  buildClaimOnlyTerminalVerification, buildRetirementPlan, buildRolloverPlan,
  claimOnlyOperationKey, createClaimOnlyJournal, normalizeClaimOnlyJournal,
  phaseReceipt, startClaimOnlyJournal,
} from "./claim-only-partial-start-retirement-contract.mjs";
import { canonicalJson, digestValue, normalizeWriteSet } from "./cloud-collaboration-primitives.mjs";
import { applyCloudTransition } from "./cloud-collaboration-contract.mjs";
import { normalizeCloudAuthority } from "./scoped-lane-admission-lib.mjs";
import { verifyAdmissionCloudAuthority } from "./scoped-lane-cloud-authority.mjs";
import { parseWriterLeasePullRequestBody } from "./writer-lease-lib.mjs";
import {
  buildClaimOnlyRetirementRequest, claimOnlyOperationReceiptForEntry,
  claimOnlyRetirementRequestDigest, projectClaimOnlyClaim,
} from "./claim-only-partial-start-retirement-store.mjs";
const ENTRY_SCHEMA = "agentic-cloud-collaboration-entry/v2";
const METHODS = Object.freeze([
  "withOperationLock", "readJournal", "writeJournal", "observeRetirement",
  "observeRollover", "prepare", "classifySourceRetired", "retireSource",
  "classifyStaleSuccessorRetired", "retireStaleSuccessor",
  "classifyReplacementClaimed", "claimReplacement", "verifyRetirement", "verifyRollover",
]);
export function createClaimOnlyPartialStartRetirementController({ adapter } = {}) {
  const runtime = requireAdapter(adapter);
  return Object.freeze({
    planRetirement: () => plan(runtime, RETIREMENT_OPERATION),
    runRetirement: input => run(runtime, RETIREMENT_OPERATION, input),
    planRollover: () => plan(runtime, ROLLOVER_OPERATION),
    runRollover: input => run(runtime, ROLLOVER_OPERATION, input)
  });
}
async function plan(adapter, operation) {
  return adapter.withOperationLock({ operation, action: "plan" }, async () => {
    const existing = await adapter.readJournal();
    if (existing) {
      const journal = normalizeClaimOnlyJournal(existing);
      requireOperation(journal, operation);
      return journal.plan;
    }
    const evidence = operation === RETIREMENT_OPERATION
      ? await adapter.observeRetirement() : await adapter.observeRollover();
    const candidate = operation === RETIREMENT_OPERATION ? buildRetirementPlan(evidence) : buildRolloverPlan(evidence);
    const next = createClaimOnlyJournal(candidate);
    const stored = await adapter.writeJournal({ expected: null, next });
    return normalizeClaimOnlyJournal(stored || next).plan;
  });
}
async function run(adapter, operation, { planDigest, authorization } = {}) {
  requireDigest(planDigest, "plan digest");
  return adapter.withOperationLock({ operation, planDigest, action: "run" }, async () => {
    let journal = normalizeClaimOnlyJournal(await adapter.readJournal());
    requireOperation(journal, operation);
    if (journal.plan.planDigest !== planDigest) {
      throw new Error("Run digest does not match the private claim-only plan.");
    }
    authorizeClaimOnlyPlan(journal.plan, authorization);
    if (!journal.state) {
      journal = await persist(adapter, journal, startClaimOnlyJournal(journal, authorization));
    }
    return execute(adapter, journal);
  });
}
async function execute(adapter, initial) {
  let journal = initial;
  const { operation, plan } = journal;
  if (journal.state.phase === "complete") {
    const fresh = await verifyTerminal(adapter, operation, plan, journal);
    joinFreshTerminal(journal, fresh);
    return buildClaimOnlyCompletionReceipt(journal);
  }
  if (journal.state.phase === "authorized") {
    const prepared = object(await adapter.prepare({ plan, journal }), "prepared frame");
    journal = await advance(adapter, journal, "prepared", {
      operationKey: claimOnlyOperationKey(plan, "prepared"),
      freshFrameDigest: requireDigest(prepared.freshFrameDigest, "fresh frame digest")
    });
  }
  if (operation === RETIREMENT_OPERATION) {
    if (journal.state.phase === "prepared") {
      journal = await converge({
        adapter, journal,
        phase: "source-retired",
        classify: adapter.classifySourceRetired, effect: adapter.retireSource,
        label: "source retirement",
      });
    } else if (["source-retired", "verified"].includes(journal.state.phase)) {
      await requireComplete(
        adapter.classifySourceRetired,
        effectContext(journal, "source-retired"),
        "source retirement",
      );
    }
  } else {
    if (journal.state.phase === "prepared") {
      journal = await converge({
        adapter, journal,
        phase: "stale-successor-retired",
        classify: adapter.classifyStaleSuccessorRetired,
        effect: adapter.retireStaleSuccessor, label: "stale successor retirement",
      });
    } else if (["stale-successor-retired", "replacement-claimed", "verified"].includes(journal.state.phase)) {
      await requireComplete(
        adapter.classifyStaleSuccessorRetired,
        effectContext(journal, "stale-successor-retired"),
        "stale successor retirement",
      );
    }
    if (journal.state.phase === "stale-successor-retired") {
      journal = await converge({
        adapter, journal,
        phase: "replacement-claimed",
        classify: adapter.classifyReplacementClaimed, effect: adapter.claimReplacement,
        label: "replacement claim",
      });
    } else if (["replacement-claimed", "verified"].includes(journal.state.phase)) {
      await requireComplete(
        adapter.classifyReplacementClaimed,
        effectContext(journal, "replacement-claimed"),
        "replacement claim",
      );
    }
  }
  const terminalPhase = operation === RETIREMENT_OPERATION ? "source-retired" : "replacement-claimed";
  if (journal.state.phase === terminalPhase) {
    const terminal = await verifyTerminal(adapter, operation, plan, journal);
    journal = await advance(adapter, journal, "verified", joinFreshTerminal(journal, terminal));
  }
  if (journal.state.phase === "verified") {
    const receipt = buildClaimOnlyCompletionReceipt(journal);
    journal = await advance(adapter, journal, "complete", { receipt });
  }
  if (journal.state.phase !== "complete") {
    throw new Error(`Claim-only operation stopped at ${journal.state.phase}.`);
  }
  return journal.state.receipts.complete.receipt;
}
async function converge({ adapter, journal, phase, classify, effect, label }) {
  const context = effectContext(journal, phase);
  const before = await classification(classify(context), label);
  if (before.state === "complete") return advance(adapter, journal, phase, before.values);
  let failure = null;
  try {
    await effect(context);
  } catch (error) {
    failure = error;
  }
  const after = await classification(classify(context), label);
  if (after.state !== "complete") {
    if (failure) throw failure;
    throw new Error(`${label} did not converge durably.`);
  }
  return advance(adapter, journal, phase, after.values);
}
async function requireComplete(classify, context, label) {
  const result = await classification(classify(context), label);
  if (result.state !== "complete") throw new Error(`${label} is no longer complete.`);
  return result.values;
}
async function classification(value, label) {
  const result = await value;
  if (!result || !["pending", "complete"].includes(result.state)) {
    throw new Error(`${label} classification is malformed.`);
  }
  if (result.state === "complete") object(result.values, `${label} values`);
  return result;
}
function effectContext(journal, phase) {
  return Object.freeze({
    plan: journal.plan, journal, phase,
    operationKey: claimOnlyOperationKey(journal.plan, phase),
  });
}
async function verifyTerminal(adapter, operation, plan, journal) {
  const verify = operation === RETIREMENT_OPERATION ? adapter.verifyRetirement : adapter.verifyRollover;
  return object(await verify({ plan, journal }), "terminal verification");
}
function joinFreshTerminal(journal, actual) {
  const fresh = object(actual, "terminal verification");
  const expected = buildClaimOnlyTerminalVerification(journal);
  for (const name of ["effectReceiptDigest", "terminalEvidenceDigest", "preservationDigest"]) {
    requireDigest(fresh[name], `fresh ${name}`);
  }
  if (canonicalJson(fresh) !== canonicalJson(expected)) {
    throw new Error("Fresh terminal verification does not join the sealed effects.");
  }
  return expected;
}
async function advance(adapter, journal, phase, values) {
  // Building the phase receipt first keeps adapter output validation fail-closed.
  phaseReceipt(phase, values);
  return persist(adapter, journal, advanceClaimOnlyJournal(journal, phase, values));
}
async function persist(adapter, expected, next) {
  const stored = await adapter.writeJournal({ expected, next });
  return normalizeClaimOnlyJournal(stored || next);
}
function requireAdapter(adapter) {
  for (const method of METHODS) {
    if (typeof adapter?.[method] !== "function") {
      throw new Error(`Claim-only controller adapter requires ${method}().`);
    }
  }
  return Object.freeze(Object.fromEntries(METHODS.map(name => [name, adapter[name]])));
}
function requireOperation(journal, operation) {
  if (journal.operation !== operation) {
    throw new Error(`Private journal belongs to ${journal.operation}, not ${operation}.`);
  }
}
function requireDigest(value, label) {
  if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be one object.`);
  }
  return value;
}
export function stableClaimOnlyEvidence(value, operation) {
  const common = {
    repository: value.repository, controller: value.controller,
    canonical: { ...value.canonical,
      sourceBaseStrictAncestorOfSuccessorBase:
        value.canonical.sourceBaseStrictAncestorOfSuccessorBase ?? false },
    source: value.source, successor: value.successor,
    sourceEntry: value.sourceEntry, successorEntry: value.successorEntry,
    associations: value.associations, preservation: value.preservation,
    overlap: value.overlap,
  };
  return operation === ROLLOVER_OPERATION ? {
    ...common,
    retirement: value.retirement, replacement: value.replacement,
    sourceCurrentCount: value.sourceCurrentCount,
  } : common;
}
export function requireStableClaimOnlyPlanEvidence(expected, actual, operation) {
  if (digestValue(stableClaimOnlyEvidence(expected, operation))
    !== digestValue(stableClaimOnlyEvidence(actual, operation))) {
    throw new Error("Claim-only fresh prepared frame drift is invalid.");
  }
}
export function requireStableClaimOnlyTerminalBase(expected, frame, operation) {
  if (digestValue(expected.repository) !== digestValue(frame.repositoryIdentity)
    || digestValue(expected.controller) !== digestValue(frame.controller)
    || expected.canonical.mainSha !== frame.mainSha
    || digestValue(expected.preservation) !== digestValue(frame.preservation)
    || canonicalJson(expected.associations) !== canonicalJson(frame.associations)) {
    throw new Error(`Claim-only ${operation} preservation drift is invalid.`);
  }
}
export function requireLiveClaimOnlyClaim(expected, matches, genesis, label) {
  if (matches.length !== 1 || canonicalJson(projectClaimOnlyClaim(matches[0], genesis)) !== canonicalJson(expected)) {
    throw new Error(`Claim-only ${label} live subject drift is invalid.`);
  }
}
export function assertClaimOnlyRetirementOverlap(overlap, plan, phase) {
  assertClaimOnlyOverlap(overlap, phase === "source-retired" ? {
    reservedClaimIds: [plan.evidence.source.claimId],
    waitingClaimIds: [plan.evidence.successor.claimId]
  } : {
    reservedClaimIds: [],
    waitingClaimIds: [plan.evidence.successor.claimId]
  });
}
export function buildClaimOnlyObservedEvidence({
  frame, schema, targetRepository, ledgerRepository,
}) {
  return {
    schema,
    observedAt: frame.observedAt,
    repository: frame.repositoryIdentity, controller: frame.controller,
    canonical: {
      targetRepository, mainSha: frame.mainSha,
      sourceBaseContained: frame.sourceBaseContained,
      successorBaseContained: frame.successorBaseContained,
      sourceBaseStrictAncestorOfSuccessorBase:
        frame.sourceBaseStrictAncestorOfSuccessorBase === true
    },
    cloud: {
      ledgerRepository, ledgerRevision: frame.status.ledgerRevision,
      ledgerDigest: frame.status.ledgerDigest, sequence: frame.status.sequence,
      validatedLedgerDigest: digestValue(frame.ledger),
      inventoryDigest: digestValue(frame.status.claims)
    },
    source: frame.source, successor: frame.successor,
    sourceEntry: frame.sourceEntry, successorEntry: frame.successorEntry,
    sourceLineageCount: frame.sourceEntries.length,
    successorLineageCount: frame.successorEntries.length,
    overlap: frame.overlap, associations: frame.associations,
    preservation: frame.preservation,
  };
}
export function projectClaimOnlyProviderPulls(pulls) {
  const projected = pulls.map(pull => ({
    number: pull.number, nodeId: pull.id, state: pull.state, isDraft: pull.isDraft,
    mergedAt: pull.mergedAt, closedAt: pull.closedAt,
    headRefName: pull.headRefName, headRefOid: pull.headRefOid,
    baseRefName: pull.baseRefName, baseRefOid: pull.baseRefOid,
    bodyDigest: digestValue(String(pull.body || "")),
  })).sort((left, right) => left.number - right.number);
  const associations = claimId => pulls.flatMap(pull => {
    const marker = parseWriterLeasePullRequestBody(String(pull.body || ""));
    return marker?.cloudAuthority?.claimId === claimId ? [{
      number: pull.number, nodeId: pull.id, markerDigest: digestValue(marker),
    }] : [];
  });
  return Object.freeze({
    projected,
    associations
  });
}
export function preflightClaimOnlyRollover({
  plan,
  status,
  ledger,
  simulationTime
}) {
  const stale = plan.evidence.successor;
  const target = plan.evidence.replacement;
  const repository = {
    repositoryId: stale.repositoryId,
    canonicalRevision: target.canonicalBaseRevision
  };
  const actor = subject => ({
    actorId: subject.actorId,
    deviceId: subject.deviceId,
    sessionId: subject.sessionId
  });
  const retired = applyCloudTransition({
    ledger,
    action: "retire",
    actor: actor(stale),
    repository,
    evaluationTime: simulationTime,
    request: buildClaimOnlyRetirementRequest(
      plan,
      stale,
      "stale-successor-retired",
      claimOnlyOperationKey(plan, "stale-successor-retired"),
      status.ledgerDigest,
    ),
  });
  const expiresAt = new Date(Date.parse(simulationTime) + target.ttlSeconds * 1_000).toISOString();
  const claimed = applyCloudTransition({
    ledger: retired.ledger,
    action: "claim",
    actor: actor(target),
    repository,
    evaluationTime: simulationTime,
    request: {
      workItemId: target.workItemId,
      canonicalBaseRevision: target.canonicalBaseRevision,
      laneRevision: target.laneRevision,
      declaredWriteScope: target.declaredWriteScope,
      predecessorClaimId: target.predecessorClaimId,
      canonicalDescendantProof: plan.evidence.canonical.canonicalDescendantProof,
      leaseEpoch: target.leaseEpoch,
      expiresAt,
      expectedLedgerDigest: retired.ledger.headDigest,
      idempotencyKey: claimOnlyOperationKey(plan, "replacement-claimed")
    }
  });
  assertClaimOnlyReplacement(claimed.claim, target);
}
export function validateClaimOnlyRawAuthority({
  raw,
  plan,
  ledgerRepository,
  targetRepository,
  now,
  environment,
  verify
}) {
  const target = plan.evidence.replacement;
  const operationKey = claimOnlyOperationKey(plan, "replacement-claimed");
  if (raw?.schema !== "agentic-cloud-collaboration-result/v1" || raw.ok !== true
    || raw.action !== "claim" || raw.claim?.claimId !== target.expectedClaimId
    || raw.operationReceipt?.operation !== "claim"
    || raw.operationReceipt?.idempotencyKey !== digestValue(operationKey)
    || !/^[0-9a-f]{64}$/u.test(raw.operationReceipt?.receiptDigest || "")) {
    throw new Error("Claim-only claim operation result is invalid.");
  }
  const manifest = {
    declaredWriteSet: target.declaredWriteScope,
    writeSetDigest: target.writeSetDigest
  };
  const authority = normalizeCloudAuthority(raw, {
    ledgerRepository,
    targetRepository,
    manifest,
    canonicalBaseSha: target.canonicalBaseRevision,
    now
  });
  if (authority.claimId !== target.expectedClaimId || authority.leaseEpoch !== 2
    || authority.deviceId !== target.deviceId || authority.sessionId !== target.sessionId) {
    throw new Error("Claim-only normalized replacement authority is invalid.");
  }
  const independentlyVerified = verifyAdmissionCloudAuthority({
    authority,
    manifest,
    canonicalBaseSha: target.canonicalBaseRevision,
    environment,
    invoke: verify
  });
  if (independentlyVerified.authority.claimId !== target.expectedClaimId) {
    throw new Error("Claim-only independent replacement verification is invalid.");
  }
  return independentlyVerified.authority;
}
export function assertClaimOnlyReplacement(claim, target) {
  const fields = [
    ["claimId", target.expectedClaimId], ["state", "current"], ["leaseEpoch", 2],
    ["actorId", target.actorId], ["repositoryId", target.repositoryId],
    ["workItemId", target.workItemId], ["deviceId", target.deviceId],
    ["sessionId", target.sessionId], ["predecessorClaimId", target.predecessorClaimId],
    ["canonicalBaseRevision", target.canonicalBaseRevision],
    ["laneRevision", target.laneRevision], ["writeSetDigest", target.writeSetDigest],
  ];
  const mismatch = fields.some(([name, expected]) => claim?.[name] !== expected);
  if (mismatch || claim.writeAuthority !== true || claim.scopeReserved !== true
    || canonicalJson(normalizeWriteSet(claim.declaredWriteScope))
      !== canonicalJson(target.declaredWriteScope)) {
    throw new Error("Claim-only replacement cloud claim is invalid.");
  }
}
export function validateClaimOnlyRetirementTerminal({
  entry,
  plan,
  claim,
  phase,
  operationKey,
  result = null
}) {
  const requestDigest = claimOnlyRetirementRequestDigest(plan, claim, phase);
  const request = buildClaimOnlyRetirementRequest(plan, claim, phase, "unused", digestValue("unused"));
  const expectedCore = {
    claimId: claim.claimId, actorId: claim.actorId,
    deviceId: claim.deviceId, sessionId: claim.sessionId,
    repositoryId: claim.repositoryId, workItemId: claim.workItemId,
    canonicalBaseRevision: claim.canonicalBaseRevision,
    declaredWriteScope: claim.declaredWriteScope,
    writeSetDigest: claim.writeSetDigest, laneRevision: claim.laneRevision,
    leaseEpoch: claim.leaseEpoch,
    transitionCounter: claim.transitionCounter + 1,
    heartbeatCounter: claim.heartbeatCounter, state: "retired",
    expiresAt: claim.expiresAt,
    evidenceDigest: claim.evidenceDigest ?? null,
    reviewRequestId: null,
    predecessorClaimId: claim.predecessorClaimId,
    eligibleSince: claim.eligibleSince ?? null, handoff: claim.handoff ?? null,
    release: claim.release ?? null, recovery: claim.recovery ?? null,
    integration: claim.integration ?? null,
    canonicalDescendantProof: claim.canonicalDescendantProof ?? null,
    retirement: {
      reason: request.reason, finalRevision: request.finalRevision,
      reviewRequestId: null, bytesDigest: request.bytesDigest,
      namedChecksDigest: request.namedChecksDigest,
      handoffEvidenceDigest: request.handoffEvidenceDigest,
      integrationReceiptDigest: null, retiredAt: entry?.evaluationTime,
    }
  };
  const comparableCore = {
    ...entry?.claimCore,
    canonicalDescendantProof: entry?.claimCore?.canonicalDescendantProof ?? null,
    recovery: entry?.claimCore?.recovery ?? null,
    integration: entry?.claimCore?.integration ?? null,
  };
  if (!entry || entry.schema !== ENTRY_SCHEMA || entry.action !== "retire"
    || entry.repositoryId !== claim.repositoryId || entry.claimId !== claim.claimId
    || entry.idempotencyKey !== digestValue(operationKey)
    || entry.requestDigest !== requestDigest
    || canonicalJson(comparableCore) !== canonicalJson(expectedCore)
    || entry.claimDigest !== digestValue(entry.claimCore)) {
    throw new Error("Claim-only retirement terminal semantics are invalid.");
  }
  requireEntrySeal(entry);
  const receipt = claimOnlyOperationReceiptForEntry(entry, "retired");
  if (result) requireMutationResult(result, entry, receipt, "retired");
  return Object.freeze({
    requestDigest,
    operationReceiptDigest: receipt.receiptDigest,
    terminalEntryDigest: entry.digest
  });
}
export function validateClaimOnlyReplacementTerminal(frame, plan, operationKey, raw) {
  const target = plan.evidence.replacement;
  const entries = frame.ledger.entries.filter(entry => entry.claimId === target.expectedClaimId);
  const matches = frame.status.claims.filter(claim => claim.claimId === target.expectedClaimId);
  if (entries.length !== 1 || matches.length !== 1) {
    throw new Error("Claim-only replacement lineage cardinality is invalid.");
  }
  const entry = entries[0];
  assertClaimOnlyReplacement(matches[0], target);
  const expiresAt = new Date(Date.parse(entry.evaluationTime) + target.ttlSeconds * 1_000).toISOString();
  const intent = {
    repositoryId: target.repositoryId, actorId: target.actorId,
    deviceId: target.deviceId, sessionId: target.sessionId,
    workItemId: target.workItemId,
    canonicalBaseRevision: target.canonicalBaseRevision,
    declaredWriteScope: target.declaredWriteScope,
    writeSetDigest: target.writeSetDigest, laneRevision: target.laneRevision,
    leaseEpoch: target.leaseEpoch,
    predecessorClaimId: target.predecessorClaimId,
    canonicalDescendantProof: plan.evidence.canonical.canonicalDescendantProof,
    expiresAt, claimId: target.expectedClaimId,
  };
  const expectedCore = {
    claimId: target.expectedClaimId, actorId: target.actorId,
    deviceId: target.deviceId, sessionId: target.sessionId,
    repositoryId: target.repositoryId, workItemId: target.workItemId,
    canonicalBaseRevision: target.canonicalBaseRevision,
    declaredWriteScope: target.declaredWriteScope,
    writeSetDigest: target.writeSetDigest, laneRevision: target.laneRevision,
    leaseEpoch: 2, transitionCounter: 1, heartbeatCounter: 0,
    state: "current", expiresAt,
    evidenceDigest: null,
    reviewRequestId: null,
    predecessorClaimId: target.predecessorClaimId,
    canonicalDescendantProof: plan.evidence.canonical.canonicalDescendantProof,
    eligibleSince: null, handoff: null, release: null,
  };
  if (entry.schema !== ENTRY_SCHEMA || entry.action !== "claim"
    || entry.repositoryId !== target.repositoryId
    || entry.idempotencyKey !== digestValue(operationKey)
    || entry.requestDigest !== digestValue({
    action: "claim",
    intent
    }) || canonicalJson(entry.claimCore) !== canonicalJson(expectedCore)
    || entry.claimDigest !== digestValue(entry.claimCore)) {
    throw new Error("Claim-only replacement terminal semantics are invalid.");
  }
  requireEntrySeal(entry);
  requireMutationResult(raw, entry, claimOnlyOperationReceiptForEntry(entry, "current"), "current");
  return entry;
}
export function assertClaimOnlyOverlap(overlap, {
  reservedClaimIds,
  waitingClaimIds
}) {
  if (canonicalJson(overlap?.reservedClaimIds) !== canonicalJson(reservedClaimIds)
    || canonicalJson(overlap?.waitingClaimIds) !== canonicalJson(waitingClaimIds)
    || overlap?.higherPriorityWaitingClaimIds?.length !== 0) {
    throw new Error("Claim-only exact overlap fence is invalid.");
  }
}
function requireEntrySeal(entry) {
  const draft = {
    ...entry
  };
  delete draft.digest;
  if (entry.digest !== digestValue(draft)) {
    throw new Error("Claim-only terminal ledger entry seal is invalid.");
  }
}
function requireMutationResult(result, entry, receipt, state) {
  const claim = result?.claim;
  const transport = result?.receipt;
  const transportCore = transport && {
    ...transport
  };
  if (transportCore) delete transportCore.receiptDigest;
  const fields = [
    "claimId", "actorId", "deviceId", "sessionId", "repositoryId", "workItemId",
    "canonicalBaseRevision", "laneRevision", "writeSetDigest", "leaseEpoch",
    "transitionCounter", "heartbeatCounter", "reviewRequestId", "predecessorClaimId",
    "expiresAt",
  ];
  const mismatch = fields.some(name => claim?.[name] !== entry.claimCore?.[name]);
  if (result?.schema !== "agentic-cloud-collaboration-result/v1" || result.ok !== true
    || result.action !== entry.action || result.status !== state
    || canonicalJson(result.operationReceipt) !== canonicalJson(receipt)
    || result.claimDigest !== entry.claimDigest || claim?.state !== state
    || claim?.entrySchema !== ENTRY_SCHEMA || claim?.claimIdentitySchema !== ENTRY_SCHEMA
    || claim?.writeAuthority !== (state === "current")
    || claim?.scopeReserved !== (state === "current")
    || claim?.fenceRevision !== entry.claimDigest || claim?.transitionDigest !== entry.digest
    || claim?.operationReceiptDigest !== receipt.receiptDigest
    || claim?.integrationReceiptDigest !== null || mismatch
    || canonicalJson(claim?.integration ?? null)
      !== canonicalJson(entry.claimCore.integration ?? null)
    || canonicalJson(claim?.recovery ?? null)
      !== canonicalJson(entry.claimCore.recovery ?? null)
    || canonicalJson(normalizeWriteSet(claim?.declaredWriteScope))
      !== canonicalJson(entry.claimCore.declaredWriteScope)
    || transport?.schema !== "agentic-cloud-collaboration-github-receipt/v1"
    || transport?.action !== entry.action || transport?.claimId !== entry.claimId
    || transport?.claimDigest !== entry.claimDigest
    || transport?.contractReceiptDigest !== receipt.receiptDigest
    || transport?.receiptDigest !== digestValue(transportCore)) {
    throw new Error(`Claim-only ${entry.action} operation result is invalid.`);
  }
}
