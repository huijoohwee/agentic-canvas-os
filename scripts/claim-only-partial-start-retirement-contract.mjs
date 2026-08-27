// Responsibility: Seal two separately authorized claim-only cloud lifecycle transactions.
import {
  canonicalJson, digestValue, normalizeCanonicalDescendantProof, normalizeWriteSet,
} from "./cloud-collaboration-primitives.mjs";
import {
  claimOnlyOperationKeyFromDigest,
  claimOnlyOperationReceiptForEntry,
  claimOnlyRetirementRequestDigest,
  claimOnlyTerminalEffects,
  claimOnlyTerminalVerification,
  validateClaimOnlyJournalSemantics,
} from "./claim-only-partial-start-retirement-store.mjs";

export const RETIREMENT_OPERATION = "claim-only-partial-start-retirement";
export const ROLLOVER_OPERATION = "claim-only-successor-rollover";
export const RETIREMENT_PHASES = Object.freeze([
  "authorized", "prepared", "source-retired", "verified", "complete",
]);
export const ROLLOVER_PHASES = Object.freeze([
  "authorized", "prepared", "stale-successor-retired", "replacement-claimed",
  "verified", "complete",
]);
export const PLAN_SCHEMAS = Object.freeze({
  [RETIREMENT_OPERATION]: "agentic-claim-only-partial-start-retirement-plan/v1",
  [ROLLOVER_OPERATION]: "agentic-claim-only-successor-rollover-plan/v1",
});
export const JOURNAL_SCHEMA = "agentic-claim-only-partial-start-retirement-journal/v1";
export const RECEIPT_SCHEMAS = Object.freeze({
  [RETIREMENT_OPERATION]: "agentic-claim-only-partial-start-retirement-receipt/v1",
  [ROLLOVER_OPERATION]: "agentic-claim-only-successor-rollover-receipt/v1",
});

const ENTRY_SCHEMA = "agentic-cloud-collaboration-entry/v2";
const DIGEST = /^[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40}$/u;
const EFFECTS = Object.freeze({
  [RETIREMENT_OPERATION]: Object.freeze(["retire-source-cloud-claim"]),
  [ROLLOVER_OPERATION]: Object.freeze([
    "retire-stale-successor-cloud-claim", "claim-epoch-2-replacement",
  ]),
});
const PRESERVATION = Object.freeze({
  source: "unchanged", git: "unchanged", refs: "unchanged", worktrees: "unchanged",
  writerRegistry: "unchanged", pullRequests: "unchanged", provider: "unchanged",
  deployment: "not-performed",
});

export function buildRetirementPlan(evidence) {
  const normalized = normalizeRetirementEvidence(evidence);
  return sealPlan(RETIREMENT_OPERATION, normalized);
}

export function buildRolloverPlan(evidence) {
  const normalized = normalizeRolloverEvidence(evidence);
  return sealPlan(ROLLOVER_OPERATION, normalized);
}

export function normalizeClaimOnlyPlan(value) {
  object(value, "claim-only plan");
  const rebuilt = value.operation === RETIREMENT_OPERATION
    ? buildRetirementPlan(value.evidence) : value.operation === ROLLOVER_OPERATION
      ? buildRolloverPlan(value.evidence) : invalid("plan operation");
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("plan drift");
  return rebuilt;
}

export function authorizeClaimOnlyPlan(plan, authorization) {
  const normalized = normalizeClaimOnlyPlan(plan);
  if (authorization !== normalized.exactAuthorization) {
    throw new Error(`Exact authorization required: ${normalized.exactAuthorization}`);
  }
  return digestValue({ operation: normalized.operation,
    planDigest: normalized.planDigest, authorization });
}

export function createClaimOnlyJournal(plan) {
  const normalized = normalizeClaimOnlyPlan(plan);
  return sealJournal({ schema: JOURNAL_SCHEMA, operation: normalized.operation,
    plan: normalized, state: null });
}

export function startClaimOnlyJournal(journal, authorization) {
  const current = normalizeClaimOnlyJournal(journal);
  if (current.state !== null) throw new Error("Claim-only journal is already authorized.");
  const authorizationDigest = authorizeClaimOnlyPlan(current.plan, authorization);
  const authorized = phaseReceipt("authorized", { authorizationDigest });
  return normalizeClaimOnlyJournal(sealJournal({
    schema: JOURNAL_SCHEMA,
    operation: current.operation,
    plan: current.plan,
    state: { phase: "authorized", receipts: { authorized } },
  }));
}

export function advanceClaimOnlyJournal(journal, phase, values) {
  const current = normalizeClaimOnlyJournal(journal);
  if (!current.state) throw new Error("Claim-only journal is not authorized.");
  const phases = phasesFor(current.operation);
  const currentIndex = phases.indexOf(current.state.phase);
  const nextIndex = phases.indexOf(phase);
  if (nextIndex !== currentIndex + 1) {
    throw new Error(`Claim-only operation cannot advance from ${current.state.phase} to ${phase}.`);
  }
  const receipt = phaseReceipt(phase, values);
  return normalizeClaimOnlyJournal(sealJournal({
    schema: JOURNAL_SCHEMA,
    operation: current.operation,
    plan: current.plan,
    state: { phase, receipts: { ...current.state.receipts, [phase]: receipt } },
  }));
}

export function normalizeClaimOnlyJournal(value) {
  object(value, "claim-only journal");
  const plan = normalizeClaimOnlyPlan(value.plan);
  if (value.schema !== JOURNAL_SCHEMA || value.operation !== plan.operation) invalid("journal identity");
  const state = value.state === null ? null : normalizeState(value.state, plan);
  const core = { schema: JOURNAL_SCHEMA, operation: plan.operation, plan, state };
  if (value.journalDigest !== digestValue(core)
    || canonicalJson(value) !== canonicalJson({ ...core, journalDigest: value.journalDigest })) {
    invalid("journal seal");
  }
  return freeze({ ...core, journalDigest: value.journalDigest });
}

export function claimOnlyOperationKey(plan, phase) {
  const normalized = normalizeClaimOnlyPlan(plan);
  if (!phasesFor(normalized.operation).includes(phase) || phase === "authorized") {
    invalid("operation phase");
  }
  return claimOnlyOperationKeyFromDigest(normalized.operation, normalized.planDigest, phase);
}

export function buildClaimOnlyCompletionReceipt(journal) {
  const current = normalizeClaimOnlyJournal(journal);
  if (!["verified", "complete"].includes(current.state?.phase)) {
    throw new Error("Completion requires an exact verified claim-only journal.");
  }
  return completionReceipt(current.plan, current.state.receipts);
}

export function buildClaimOnlyTerminalVerification(
  journal,
  { effects = null, preservation = null } = {},
) {
  const current = normalizeClaimOnlyJournal(journal);
  const expectedEffects = claimOnlyTerminalEffects(
    current.plan, current.state?.receipts || {},
  );
  if (effects && canonicalJson(effects) !== canonicalJson(expectedEffects)) {
    invalid("fresh terminal effects");
  }
  return claimOnlyTerminalVerification(
    current.plan,
    current.state.receipts,
    preservation || current.plan.evidence.preservation,
  );
}

function completionReceipt(plan, receipts) {
  const authorized = receipts.authorized;
  const verified = receipts.verified;
  const effectName = plan.operation === RETIREMENT_OPERATION
    ? "source-retired" : "stale-successor-retired";
  const effect = receipts[effectName];
  const core = {
    schema: RECEIPT_SCHEMAS[plan.operation], status: "complete",
    operation: plan.operation, planDigest: plan.planDigest,
    authorizationDigest: authorized.authorizationDigest,
    sourceClaimId: plan.evidence.source.claimId,
    successorClaimId: plan.evidence.successor.claimId,
    cloudRetirementOperationKey: effect.operationKey,
    cloudRetirementRequestDigest: effect.requestDigest,
    cloudRetirementReceiptDigest: effect.operationReceiptDigest,
    cloudRetirementEntryDigest: effect.terminalEntryDigest,
    terminalEffectReceiptDigest: verified.effectReceiptDigest,
    terminalEvidenceDigest: verified.terminalEvidenceDigest,
    preservationDigest: verified.preservationDigest,
    effects: EFFECTS[plan.operation], preservation: PRESERVATION,
    ...(plan.operation === ROLLOVER_OPERATION ? {
      sourceRetirementReceiptDigest: plan.evidence.retirement.receipt.receiptDigest,
      replacementClaimId: receipts["replacement-claimed"].replacementClaimId,
      replacementOperationReceiptDigest:
        receipts["replacement-claimed"].operationReceiptDigest,
      replacementOperationKey: receipts["replacement-claimed"].operationKey,
      replacementRequestDigest: receipts["replacement-claimed"].requestDigest,
      replacementEntryDigest: receipts["replacement-claimed"].terminalEntryDigest,
      rawClaimResultDigest: receipts["replacement-claimed"].rawClaimResultDigest,
      claimOutputReceiptDigest:
        receipts["replacement-claimed"].outputReceiptDigest,
      authorityDigest: receipts["replacement-claimed"].authorityDigest,
    } : {}),
  };
  return freeze({ ...core, receiptDigest: digestValue(core) });
}

export function normalizeClaimOnlyCompletionReceipt(value, operation = value?.operation) {
  object(value, "completion receipt");
  const schema = RECEIPT_SCHEMAS[operation];
  if (!schema || value.schema !== schema || value.status !== "complete") invalid("receipt identity");
  const core = { ...value }; delete core.receiptDigest;
  if (value.receiptDigest !== digestValue(core)
    || canonicalJson(core.effects) !== canonicalJson(EFFECTS[operation])
    || canonicalJson(core.preservation) !== canonicalJson(PRESERVATION)) invalid("receipt seal");
  for (const name of ["planDigest", "authorizationDigest", "sourceClaimId",
    "successorClaimId", "cloudRetirementOperationKey", "cloudRetirementRequestDigest",
    "cloudRetirementReceiptDigest", "cloudRetirementEntryDigest",
    "terminalEffectReceiptDigest", "terminalEvidenceDigest", "preservationDigest"]) {
    digest(core[name], `receipt ${name}`);
  }
  if (operation === ROLLOVER_OPERATION) {
    for (const name of ["sourceRetirementReceiptDigest", "replacementClaimId",
      "replacementOperationReceiptDigest", "replacementOperationKey",
      "replacementRequestDigest", "replacementEntryDigest", "rawClaimResultDigest",
      "claimOutputReceiptDigest", "authorityDigest"]) digest(core[name], `receipt ${name}`);
  }
  return freeze({ ...core, receiptDigest: value.receiptDigest });
}

export function phaseReceipt(phase, values) {
  object(values, `${phase} values`);
  const core = { phase, ...structuredClone(values) };
  normalizePhaseCore(core, phase);
  return freeze({ ...core, receiptDigest: digestValue(core) });
}
function sealPlan(operation, evidence) {
  const core = { schema: PLAN_SCHEMAS[operation], operation,
    action: operation, evidence, effects: EFFECTS[operation], preservation: PRESERVATION,
    phases: phasesFor(operation) };
  const planDigest = digestValue(core);
  return freeze({ ...core, planDigest,
    exactAuthorization: `authorize ${operation} ${planDigest}` });
}
function normalizeRetirementEvidence(value) {
  const evidence = normalizeSharedEvidence(value,
    "agentic-claim-only-partial-start-retirement-evidence/v1");
  assertGenesisSource(evidence);
  assertWaitingSuccessor(evidence);
  assertLineageIdentity(evidence.source, evidence.successor);
  if (Date.parse(evidence.source.expiresAt) > Date.parse(evidence.observedAt)) {
    invalid("source claim must be expired");
  }
  if (!evidence.canonical.sourceBaseContained || !evidence.canonical.successorBaseContained) {
    invalid("protected-main ancestry");
  }
  assertNoBoundAssociations(evidence.associations);
  assertExactOverlap(evidence.overlap, evidence.source.claimId, evidence.successor.claimId, true);
  return evidence;
}
function normalizeRolloverEvidence(value) {
  const evidence = normalizeSharedEvidence(value,
    "agentic-claim-only-successor-rollover-evidence/v1", { sourceTerminal: true });
  assertWaitingSuccessor(evidence);
  assertLineageIdentity(evidence.source, evidence.successor);
  if (Date.parse(evidence.successor.expiresAt) > Date.parse(evidence.observedAt)) {
    invalid("waiting successor must be stale before rollover");
  }
  if (evidence.sourceCurrentCount !== 0) invalid("retired source current cardinality");
  assertExactOverlap(evidence.overlap, evidence.source.claimId, evidence.successor.claimId, false);
  assertNoBoundAssociations(evidence.associations);
  const receipt = normalizeClaimOnlyCompletionReceipt(
    evidence.retirement.receipt, RETIREMENT_OPERATION);
  const terminal = evidence.retirement.sourceTerminalEntry;
  const terminalReceipt = claimOnlyOperationReceiptForEntry(terminal, "retired");
  const expectedOperationKey = claimOnlyOperationKeyFromDigest(
    RETIREMENT_OPERATION, receipt.planDigest, "source-retired");
  const expectedRetirement = retirementSemantics(
    receipt.planDigest, "source-retired", evidence.source,
    evidence.successor.claimId, terminal.evaluationTime);
  const terminalPlan = { planDigest: receipt.planDigest, evidence };
  const expectedRequestDigest = claimOnlyRetirementRequestDigest(
    terminalPlan, evidence.source, "source-retired");
  if (receipt.sourceClaimId !== evidence.source.claimId
    || receipt.successorClaimId !== evidence.successor.claimId
    || receipt.cloudRetirementOperationKey !== expectedOperationKey
    || receipt.cloudRetirementRequestDigest !== expectedRequestDigest
    || terminal.requestDigest !== expectedRequestDigest
    || receipt.cloudRetirementReceiptDigest !== terminalReceipt.receiptDigest
    || receipt.cloudRetirementEntryDigest !== terminal.digest) {
    invalid("source retirement lineage");
  }
  if (terminal.schema !== ENTRY_SCHEMA || terminal.action !== "retire"
    || terminal.claimId !== evidence.source.claimId || terminal.state !== "retired"
    || terminal.repositoryId !== evidence.source.repositoryId
    || terminal.idempotencyKey !== digestValue(expectedOperationKey)
    || canonicalJson(terminal.retirement) !== canonicalJson(expectedRetirement)) {
    invalid("source terminal entry");
  }
  const proof = normalizeCanonicalDescendantProof({
    value: evidence.canonical.canonicalDescendantProof,
    sourceBaseSha: evidence.successor.canonicalBaseRevision,
    protectedRevision: evidence.canonical.mainSha,
  });
  if (!proof || evidence.canonical.mainSha !== evidence.replacement.canonicalBaseRevision
    || evidence.replacement.canonicalBaseRevision !== evidence.replacement.laneRevision
    || evidence.replacement.predecessorClaimId !== evidence.successor.claimId
    || evidence.replacement.leaseEpoch !== 2
    || evidence.replacement.actorId !== evidence.successor.actorId
    || evidence.replacement.repositoryId !== evidence.successor.repositoryId
    || evidence.replacement.workItemId !== evidence.successor.workItemId
    || evidence.replacement.writeSetDigest !== evidence.successor.writeSetDigest
    || canonicalJson(evidence.replacement.declaredWriteScope)
      !== canonicalJson(evidence.successor.declaredWriteScope)) invalid("replacement identity");
  const expectedClaimId = digestValue({ actorId: evidence.replacement.actorId,
    canonicalBaseRevision: evidence.replacement.canonicalBaseRevision,
    leaseEpoch: 2, repositoryId: evidence.replacement.repositoryId,
    workItemId: evidence.replacement.workItemId,
    writeSetDigest: evidence.replacement.writeSetDigest });
  if (evidence.replacement.expectedClaimId !== expectedClaimId) invalid("replacement claim ID");
  return freeze({ ...evidence, retirement: freeze({ ...evidence.retirement, receipt }),
    canonical: freeze({ ...evidence.canonical, canonicalDescendantProof: proof }) });
}
function normalizeSharedEvidence(value, schema, { sourceTerminal = false } = {}) {
  const source = object(value, "claim-only evidence");
  if (source.schema !== schema) invalid("evidence schema");
  const normalized = clone(source);
  instant(normalized.observedAt, "observedAt");
  normalizeController(normalized.controller);
  normalizeRepositoryEvidence(normalized.repository);
  normalizeCanonical(normalized.canonical);
  normalizeCloud(normalized.cloud);
  assertRepositoryIdentity(normalized);
  normalized.source = normalizeClaim(normalized.source, "source");
  normalized.successor = normalizeClaim(normalized.successor, "successor");
  normalized.sourceEntry = normalizeEntry(normalized.sourceEntry, "source entry");
  normalized.successorEntry = normalizeEntry(normalized.successorEntry, "successor entry");
  positive(normalized.sourceLineageCount, "source lineage count");
  positive(normalized.successorLineageCount, "successor lineage count");
  normalizeAssociations(normalized.associations);
  normalizePreservation(normalized.preservation);
  normalizeOverlap(normalized.overlap);
  if (sourceTerminal) {
    integer(normalized.sourceCurrentCount, "source current count", 0);
    object(normalized.retirement, "retirement evidence");
    normalized.retirement.sourceTerminalEntry = normalizeEntry(
      normalized.retirement.sourceTerminalEntry, "terminal source entry");
    normalized.replacement = normalizeReplacement(normalized.replacement);
  }
  return freeze(normalized);
}
function assertGenesisSource(evidence) {
  const claim = evidence.source, entry = evidence.sourceEntry;
  if (evidence.sourceLineageCount !== 1 || entry.schema !== ENTRY_SCHEMA
    || entry.action !== "claim" || entry.claimId !== claim.claimId || entry.state !== "current"
    || claim.entrySchema !== ENTRY_SCHEMA || claim.claimIdentitySchema !== ENTRY_SCHEMA
    || claim.state !== "dormant-preserved" || claim.recordedState !== "current"
    || claim.writeAuthority || !claim.scopeReserved
    || claim.canonicalBaseRevision !== claim.laneRevision || claim.leaseEpoch !== 1
    || claim.transitionCounter !== 1 || claim.heartbeatCounter !== 0
    || claim.reviewRequestId !== null || claim.predecessorClaimId !== null
    || claim.evidenceDigest !== null || claim.recovery !== null || claim.integration !== null
    || claim.retirement !== null || entry.transitionCounter !== 1
    || entry.heartbeatCounter !== 0 || entry.reviewRequestId !== null
    || entry.predecessorClaimId !== null) invalid("genesis claim-only source");
}
function assertWaitingSuccessor(evidence) {
  const claim = evidence.successor, entry = evidence.successorEntry;
  if (evidence.successorLineageCount !== 1 || entry.schema !== ENTRY_SCHEMA
    || entry.action !== "claim" || entry.claimId !== claim.claimId
    || entry.state !== "waiting-successor" || claim.state !== "waiting-successor"
    || claim.recordedState !== "waiting-successor" || claim.writeAuthority || claim.scopeReserved
    || claim.canonicalBaseRevision !== claim.laneRevision || claim.leaseEpoch !== 1
    || claim.transitionCounter !== 1 || claim.heartbeatCounter !== 0
    || claim.predecessorClaimId !== evidence.source.claimId || claim.reviewRequestId !== null
    || claim.evidenceDigest !== null || claim.recovery !== null || claim.integration !== null
    || claim.retirement !== null || entry.transitionCounter !== 1
    || entry.heartbeatCounter !== 0 || entry.predecessorClaimId !== evidence.source.claimId
    || entry.reviewRequestId !== null) invalid("direct waiting successor");
}
function assertLineageIdentity(source, successor) {
  for (const name of ["actorId", "repositoryId", "workItemId", "deviceId", "sessionId",
    "writeSetDigest"]) {
    if (source[name] !== successor[name]) invalid(`source/successor ${name}`);
  }
  if (canonicalJson(source.declaredWriteScope)
    !== canonicalJson(successor.declaredWriteScope)) invalid("source/successor declared write scope");
}
function normalizeClaim(value, label) {
  const result = clone(object(value, label));
  for (const name of ["claimId", "claimDigest", "transitionDigest", "operationReceiptDigest",
    "writeSetDigest"]) digest(result[name], `${label} ${name}`);
  for (const name of ["canonicalBaseRevision", "laneRevision"]) sha(result[name], `${label} ${name}`);
  for (const name of ["actorId", "repositoryId", "workItemId", "deviceId", "sessionId",
    "state", "recordedState", "entrySchema", "claimIdentitySchema"]) text(result[name], `${label} ${name}`);
  result.declaredWriteScope = normalizeWriteSet(result.declaredWriteScope);
  if (result.writeSetDigest !== digestValue(result.declaredWriteScope)) {
    invalid(`${label} normalized write-set digest`);
  }
  positive(result.leaseEpoch, `${label} epoch`); positive(result.transitionCounter, `${label} transition`);
  integer(result.heartbeatCounter, `${label} heartbeat`, 0); instant(result.expiresAt, `${label} expiry`);
  result.eligibleSince ??= null; result.handoff ??= null; result.release ??= null;
  result.canonicalDescendantProof ??= null;
  if (result.eligibleSince !== null) instant(result.eligibleSince, `${label} eligible since`);
  if (typeof result.writeAuthority !== "boolean" || typeof result.scopeReserved !== "boolean") {
    invalid(`${label} authority booleans`);
  }
  return freeze(result);
}
function normalizeEntry(value, label) {
  const result = clone(object(value, label));
  for (const name of ["claimId", "claimDigest", "digest", "idempotencyKey"]) {
    digest(result[name], `${label} ${name}`);
  }
  positive(result.sequence, `${label} sequence`); positive(result.transitionCounter, `${label} transition`);
  integer(result.heartbeatCounter, `${label} heartbeat`, 0);
  for (const name of ["schema", "action", "state"]) text(result[name], `${label} ${name}`);
  instant(result.recordedExpiresAt, `${label} expiry`);
  if (Object.hasOwn(result, "repositoryId")) text(result.repositoryId, `${label} repository`);
  if (Object.hasOwn(result, "requestDigest")) digest(result.requestDigest, `${label} request`);
  if (Object.hasOwn(result, "evaluationTime")) instant(result.evaluationTime, `${label} evaluation`);
  return freeze(result);
}
function normalizeRepositoryEvidence(value) {
  const result = object(value, "repository evidence");
  for (const name of ["targetRepository", "providerRepositoryId", "nameWithOwner"]) {
    text(result[name], `repository ${name}`);
  }
  for (const name of ["topLevelDigest", "gitCommonDirectoryDigest", "originUrlDigest"]) {
    digest(result[name], `repository ${name}`);
  }
  if (result.targetRepository !== result.nameWithOwner) invalid("provider repository identity");
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
    invalid("clean provider-protected controller main");
  }
}
function assertRepositoryIdentity(evidence) {
  const names = [
    evidence.repository.targetRepository,
    evidence.repository.nameWithOwner,
    evidence.controller.repository,
    evidence.controller.nameWithOwner,
    evidence.canonical.targetRepository,
    evidence.cloud.ledgerRepository,
  ];
  if (new Set(names).size !== 1
    || evidence.repository.providerRepositoryId !== evidence.controller.providerRepositoryId) {
    invalid("target/controller/ledger repository identity");
  }
}
function normalizeCanonical(value) {
  const result = object(value, "canonical evidence");
  text(result.targetRepository, "target repository"); sha(result.mainSha, "canonical main");
  if (result.sourceBaseContained !== true || result.successorBaseContained !== true) {
    invalid("canonical ancestry");
  }
}
function normalizeCloud(value) {
  const result = object(value, "cloud evidence");
  text(result.ledgerRepository, "ledger repository"); sha(result.ledgerRevision, "ledger revision");
  for (const name of ["ledgerDigest", "validatedLedgerDigest", "inventoryDigest"]) {
    digest(result[name], `cloud ${name}`);
  }
  positive(result.sequence, "cloud sequence");
}
function normalizeAssociations(value) {
  const result = object(value, "association evidence");
  for (const name of ["sourceRegistryMatches", "sourcePullRequestMarkerMatches",
    "successorRegistryMatches", "successorPullRequestMarkerMatches"]) {
    if (!Array.isArray(result[name])) invalid(`association ${name}`);
  }
}
function assertNoBoundAssociations(value) {
  if (Object.values(value).some(matches => matches.length !== 0)) invalid("bound projection association");
}
function normalizePreservation(value) {
  const result = object(value, "preservation evidence");
  for (const name of ["gitRefsDigest", "gitWorktreesDigest", "registryDigest", "providerDigest"]) {
    digest(result[name], `preservation ${name}`);
  }
}
function normalizeOverlap(value) {
  const result = object(value, "overlap evidence");
  for (const name of ["reservedClaimIds", "waitingClaimIds", "higherPriorityWaitingClaimIds"]) {
    if (!Array.isArray(result[name])) invalid(`overlap ${name}`);
    result[name].forEach(item => digest(item, `overlap ${name}`));
  }
}
function assertExactOverlap(value, sourceId, successorId, sourceReserved) {
  const expectedReserved = sourceReserved ? [sourceId] : [];
  if (canonicalJson(value.reservedClaimIds) !== canonicalJson(expectedReserved)
    || canonicalJson(value.waitingClaimIds) !== canonicalJson([successorId])
    || value.higherPriorityWaitingClaimIds.length !== 0) invalid("overlap cardinality or priority");
}
function normalizeReplacement(value) {
  const result = clone(object(value, "replacement evidence"));
  for (const name of ["expectedClaimId", "writeSetDigest", "predecessorClaimId"]) {
    digest(result[name], `replacement ${name}`);
  }
  for (const name of ["canonicalBaseRevision", "laneRevision"]) sha(result[name], `replacement ${name}`);
  for (const name of ["actorId", "repositoryId", "workItemId", "deviceId", "sessionId"]) {
    text(result[name], `replacement ${name}`);
  }
  result.declaredWriteScope = normalizeWriteSet(result.declaredWriteScope);
  positive(result.leaseEpoch, "replacement epoch"); positive(result.ttlSeconds, "replacement TTL");
  return freeze(result);
}
function retirementFields(planDigest, phase, successorClaimId) {
  return { reason: "superseded",
    bytesDigest: digestValue({ planDigest, phase, kind: "bytes" }),
    namedChecksDigest: digestValue({ planDigest, phase, kind: "checks" }),
    handoffEvidenceDigest: digestValue({ planDigest, phase, successorClaimId, kind: "handoff" }) };
}
function retirementSemantics(planDigest, phase, claim, successorClaimId, retiredAt) {
  return { ...retirementFields(planDigest, phase, successorClaimId),
    finalRevision: claim.laneRevision, reviewRequestId: null,
    integrationReceiptDigest: null, retiredAt };
}
function normalizeState(value, plan) {
  const source = object(value, "journal state");
  const phases = phasesFor(plan.operation), phase = text(source.phase, "journal phase");
  const index = phases.indexOf(phase);
  if (index < 0) invalid("journal phase");
  const receipts = object(source.receipts, "journal receipts"), normalized = {};
  for (let cursor = 0; cursor <= index; cursor += 1) {
    const name = phases[cursor];
    normalized[name] = normalizePhaseReceipt(receipts[name], name, plan.operation);
  }
  if (Object.keys(receipts).some(name => !Object.hasOwn(normalized, name))) invalid("journal phase ordering");
  validateClaimOnlyJournalSemantics({
    plan,
    phase,
    receipts: normalized,
    completionReceipt: phase === "complete" ? completionReceipt(plan, normalized) : null,
  });
  return freeze({ phase, receipts: freeze(normalized) });
}
function normalizePhaseReceipt(value, phase, operation) {
  const source = object(value, `${phase} receipt`), core = { ...source }; delete core.receiptDigest;
  normalizePhaseCore(core, phase, operation);
  if (source.receiptDigest !== digestValue(core)) invalid(`${phase} receipt seal`);
  return freeze({ ...core, receiptDigest: source.receiptDigest });
}
function normalizePhaseCore(core, phase, operation = null) {
  if (core.phase !== phase) invalid(`${phase} receipt identity`);
  const shapes = {
    authorized: ["authorizationDigest"], prepared: ["operationKey", "freshFrameDigest"],
    "source-retired": ["operationKey", "requestDigest", "operationReceiptDigest",
      "terminalEntryDigest", "disposition", "cloudMutation"],
    "stale-successor-retired": ["operationKey", "requestDigest", "operationReceiptDigest",
      "terminalEntryDigest", "disposition", "cloudMutation"],
    "replacement-claimed": ["operationKey", "operationReceiptDigest", "terminalEntryDigest",
      "requestDigest", "replacementClaimId", "rawClaimResultDigest", "outputReceiptDigest",
      "authorityDigest", "disposition", "cloudMutation"],
    verified: ["effectReceiptDigest", "terminalEvidenceDigest", "preservationDigest"],
    complete: ["receipt"],
  };
  const expected = ["phase", ...(shapes[phase] || invalid("phase receipt"))].sort();
  if (canonicalJson(Object.keys(core).sort()) !== canonicalJson(expected)) invalid(`${phase} receipt shape`);
  if (phase === "complete") {
    normalizeClaimOnlyCompletionReceipt(core.receipt, operation || core.receipt?.operation);
    return;
  }
  for (const [name, value] of Object.entries(core)) {
    if (name.endsWith("Digest") || name.endsWith("Key") || name === "replacementClaimId") {
      digest(value, `${phase} ${name}`);
    }
  }
  if (Object.hasOwn(core, "cloudMutation") && typeof core.cloudMutation !== "boolean") {
    invalid(`${phase} cloud mutation`);
  }
  if (Object.hasOwn(core, "disposition") && !["projected", "adopted"].includes(core.disposition)) {
    invalid(`${phase} disposition`);
  }
}


function phasesFor(operation) {
  if (operation === RETIREMENT_OPERATION) return RETIREMENT_PHASES;
  if (operation === ROLLOVER_OPERATION) return ROLLOVER_PHASES;
  return invalid("operation");
}
function sealJournal(core) {
  const frozen = freeze(core);
  return freeze({ ...frozen, journalDigest: digestValue(frozen) });
}
function clone(value) { return JSON.parse(canonicalJson(value)); }
function object(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label); return value; }
function text(value, label) { if (typeof value !== "string" || !value.trim()) invalid(label); return value; }
function digest(value, label) { if (!DIGEST.test(String(value || ""))) invalid(label); return value; }
function sha(value, label) { if (!SHA.test(String(value || ""))) invalid(label); return value; }
function positive(value, label) { return integer(value, label, 1); }
function integer(value, label, minimum) { if (!Number.isSafeInteger(value) || value < minimum) invalid(label); return value; }
function instant(value, label) { if (typeof value !== "string" || new Date(value).toISOString() !== value) invalid(label); return value; }
function invalid(label) { throw new Error(`Claim-only ${label} is invalid.`); }
function freeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value); for (const child of Object.values(value)) freeze(child); return value; }
