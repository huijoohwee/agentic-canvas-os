import { digestValue, normalizeWriteSet, validateLedger,
  writeSetsOverlap } from "./cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "./github-cloud-collaboration-mapping.mjs";
export const SCOPE_EXPANSION_LINEAGE_PLAN_SCHEMA = "agentic-cloud-authority-scope-expansion-lineage-plan/v1";
export const SCOPE_EXPANSION_LINEAGE_ADMISSION_SCHEMA = "agentic-cloud-authority-scope-expansion-lineage-admission/v1";
export const SCOPE_EXPANSION_LINEAGE_RECEIPT_SCHEMA = "agentic-cloud-authority-scope-expansion-lineage-receipt/v1";
export const SCOPE_EXPANSION_LINEAGE_EXECUTION_INTENT_SCHEMA = "agentic-cloud-authority-scope-expansion-lineage-execution-intent/v1";
const ENTRY_SCHEMA = "agentic-cloud-collaboration-entry/v2";
const RESULT_SCHEMA = "agentic-cloud-collaboration-result/v1";
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const REVIEW_STATES = new Set(["reviewed", "dormant-preserved"]);
const ACTIVE_DIRTY_LINEAGE = "active-dirty-scope-expansion";
const REVIEWED_RECOVERY_LINEAGE = "reviewed-terminal-handoff-scope-expansion-recovery";
const HISTORICAL_LINEAGES = new Set([ACTIVE_DIRTY_LINEAGE, REVIEWED_RECOVERY_LINEAGE]);
const VERIFIED_LINEAGES = new WeakSet();
const VERIFIED_ADMISSIONS = new WeakSet();
const VERIFIED_AUTHORIZATIONS = new WeakSet();
const AUTHORITY_PARITY_FIELDS = Object.freeze([
  "schema", "provider", "ledgerRepository", "targetRepository", "claimId", "claimDigest", "ledgerRevision",
  "ledgerDigest", "claimLedgerRevision", "entrySchema", "claimIdentitySchema", "operationReceiptDigest",
  "mutationAuthorityEligible", "canonicalBaseSha", "laneRevision", "writeSetDigest", "deviceId", "sessionId",
  "reviewRequestId", "leaseEpoch", "transitionCounter",
  "state", "expiresAt", "integrationReceiptDigest", "integration", "focusedEvidenceDigest",
  "manifestDigest",
]);
export function buildScopeExpansionLineageMigrationPlan(input) {
  return inspectLineage({ ...input, expectedPlan: null }).plan;
}
export function verifyScopeExpansionLineageMigrationPlan({ plan, ...input }) {
  return inspectLineage({ ...input, expectedPlan: normalizePlan(plan) });
}

export function authorizeScopeExpansionLineageMigration({ plan, authorization, executionIntent }) {
  const normalized = normalizePlan(plan);
  const intent = normalizeExecutionIntent(executionIntent);
  if (intent.planDigest !== normalized.planDigest) throw new Error("Lineage authorization intent drifted from its plan.");
  const expected = `authorize lineage-migration ${normalized.planDigest}`;
  if (String(authorization || "").trim() !== expected) {
    throw new Error(`Lineage migration requires the exact typed authorization: ${expected}`);
  }
  const core = {
    schema: "agentic-cloud-authority-scope-expansion-lineage-authorization/v1",
    planDigest: normalized.planDigest,
    executionIntentDigest: intent.executionIntentDigest,
    authorization: expected,
  };
  return freezeVerified({ ...core, authorizationDigest: digestValue(core) }, VERIFIED_AUTHORIZATIONS);
}

export function buildScopeExpansionLineageAdmission({ verified, authorization, executionIntent, lane, status }) {
  if (!VERIFIED_LINEAGES.has(verified)
    || !["legacy", "integrated-replay-recovered"].includes(verified.state)) {
    throw new Error("Lineage admission requires a freshly verified recoverable ledger proof.");
  }
  const normalized = verified.plan;
  const intent = normalizeExecutionIntent(executionIntent);
  if (!VERIFIED_AUTHORIZATIONS.has(authorization)
    || authorization.planDigest !== normalized.planDigest
    || authorization.executionIntentDigest !== intent.executionIntentDigest) {
    throw new Error("Lineage admission requires the branded authorization for its exact execution intent.");
  }
  const claim = uniqueClaim(status, normalized.legacyClaimId, "legacy migration claim");
  const core = {
    schema: SCOPE_EXPANSION_LINEAGE_ADMISSION_SCHEMA,
    plan: normalized,
    planDigest: normalized.planDigest,
    authorizationDigest: requiredDigest(authorization.authorizationDigest, "authorization digest"),
    executionIntent: intent,
    executionIntentDigest: intent.executionIntentDigest,
    claimId: claim.claimId,
    claimDigest: requiredDigest(claim.fenceRevision, "legacy claim digest"),
    transitionDigest: requiredDigest(claim.transitionDigest, "legacy transition digest"),
    transitionCounter: positiveInteger(claim.transitionCounter, "legacy transition counter"),
    expiresAt: requiredInstant(claim.expiresAt, "legacy expiry"),
    ledgerRevision: requiredSha(status?.ledgerRevision, "current ledger revision"),
    ledgerDigest: requiredDigest(status?.ledgerDigest, "current ledger digest"),
    localAuthorityDigest: digestValue(lane?.authority),
  };
  return freezeVerified({ ...core, admissionDigest: digestValue(core) }, VERIFIED_ADMISSIONS);
}

export function scopeExpansionLineageAdmissionMatches({ admission, claim, lane, status, repositoryId, request }) {
  try {
    if (!VERIFIED_ADMISSIONS.has(admission)) return false;
    const normalized = normalizeAdmission(admission);
    const plan = normalized.plan;
    return Boolean(
      claim?.claimId === plan.legacyClaimId
      && claim.claimId === normalized.claimId
      && claim.predecessorClaimId === plan.sourceClaimId
      && claim.leaseEpoch === 1
      && claim.actorId === plan.actorId
      && claim.repositoryId === plan.repositoryId
      && repositoryId === plan.repositoryId
      && claim.workItemId === plan.workItemId
      && claim.canonicalBaseRevision === plan.canonicalBaseSha
      && claim.laneRevision === plan.reviewedHeadSha
      && claim.writeSetDigest === plan.writeSetDigest
      && sameWriteSet(claim.declaredWriteScope, plan.declaredWriteSet)
      && claim.reviewRequestId === plan.reviewRequestId
      && claim.fenceRevision === normalized.claimDigest
      && claim.transitionDigest === normalized.transitionDigest
      && claim.transitionCounter === normalized.transitionCounter
      && claim.expiresAt === normalized.expiresAt
      && lane?.authority?.claimId === claim.claimId
      && lane.authority.leaseEpoch === 1
      && digestValue(lane.authority) === normalized.localAuthorityDigest
      && status?.ledgerRevision === normalized.ledgerRevision
      && status?.ledgerDigest === normalized.ledgerDigest
      && executionIntentMatchesRequest(normalized.executionIntent, request)
      && request.sessionId === lane.lease.sessionId
      && request.successorSessionId === lane.lease.sessionId
      && request.successorDeviceId === lane.lease.device
      && laneExact(lane, plan, claim.claimId)
    );
  } catch {
    return false;
  }
}

export function verifyMigratedScopeExpansionLineage({ plan, lane, status }) {
  const normalized = normalizePlan(plan);
  requireStatus(status);
  const authority = lane?.authority;
  const claim = uniqueClaim(status, authority?.claimId, "migrated successor claim");
  const integratedReplay = authority?.claimId === normalized.legacyClaimId;
  const projectionMatchesClaim = integratedReplay
    ? authority?.state === "review_ready"
    : authority?.claimDigest === claim.fenceRevision
      && authority.claimLedgerRevision === claim.transitionDigest
      && authority.operationReceiptDigest === claim.operationReceiptDigest
      && authority.transitionCounter === claim.transitionCounter
      && authority.expiresAt === claim.expiresAt;
  const exactIdentity = (
    authority?.leaseEpoch === (integratedReplay ? 1 : normalized.successorLeaseEpoch)
    && claim.leaseEpoch === (integratedReplay ? 1 : normalized.successorLeaseEpoch)
    && claim.actorId === normalized.actorId
    && claim.repositoryId === normalized.repositoryId
    && claim.workItemId === normalized.workItemId
    && claim.canonicalBaseRevision === normalized.canonicalBaseSha
    && claim.laneRevision === normalized.reviewedHeadSha
    && claim.writeSetDigest === normalized.writeSetDigest
    && sameWriteSet(claim.declaredWriteScope, normalized.declaredWriteSet)
    && claim.reviewRequestId === normalized.reviewRequestId
    && (integratedReplay
      ? claim.state === "integrated-preserved" && claim.integration && claim.integrationReceiptDigest
      : REVIEW_STATES.has(claim.state))
    && projectionMatchesClaim
    && authority.reviewRequestId === claim.reviewRequestId
    && laneExact(lane, normalized, authority.claimId)
  );
  const exactLineage = integratedReplay
    ? claim.predecessorClaimId === normalized.sourceClaimId
    : claim.predecessorClaimId === normalized.legacyClaimId;
  if (!exactIdentity || !exactLineage) {
    throw new Error("Continued lineage did not preserve its exact standard successor or integrated replay identity.");
  }
  rejectCompetingClaims(status, normalized, new Set([normalized.legacyClaimId, claim.claimId]));
  return buildReceipt(integratedReplay ? "integrated-replay-recovered" : "migrated", {
    planDigest: normalized.planDigest,
    predecessorClaimId: normalized.legacyClaimId,
    successorClaimId: claim.claimId,
    successorLeaseEpoch: claim.leaseEpoch,
    successorClaimDigest: claim.fenceRevision,
    successorTransitionDigest: claim.transitionDigest,
    ledgerRevision: status.ledgerRevision,
    ledgerDigest: status.ledgerDigest,
  });
}

export function buildScopeExpansionLineageReceipt(kind, payload) {
  return buildReceipt(kind, payload);
}

export function normalizeScopeExpansionLineageMigrationPlan(value) {
  return normalizePlan(value);
}

export function sanitizeCloudAuthorityDiagnostic(error) {
  if (error && typeof error === "object" && ("stderr" in error || "stdout" in error)) {
    return "External command failed without public diagnostics.";
  }
  const message = error instanceof Error ? error.message : String(error || "Operation failed.");
  return message
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/gu, "[redacted]")
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+(?::[^/\s@]*)?@/giu, "$1[redacted]@")
    .replace(/\/(?:Users|home|private|tmp|var\/folders)\/[^"'\r\n]*/gu, "[local-path]")
    .replace(/[A-Za-z]:\\Users\\[^"'\r\n]*/gu, "[local-path]")
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .trim().slice(0, 240) || "Operation failed.";
}

function inspectLineage({ lane, actor, status, ledger, expectedPlan }) {
  requireStatus(status);
  const failures = validateLedger(ledger);
  if (failures.length > 0) throw new Error(`Lineage migration requires a valid ledger: ${failures.join("; ")}`);
  if (ledger?.headDigest !== status.ledgerDigest) {
    throw new Error("Observed ledger bytes do not match the current cloud status digest.");
  }
  if (expectedPlan && expectedPlan.observedLedgerDigest !== status.ledgerDigest
    && !ledger.entries.some(entry => entry.digest === expectedPlan.observedLedgerDigest)) {
    throw new Error("Authorized lineage plan is not an ancestor of the current append-only ledger.");
  }
  const localClaimId = lane?.authority?.claimId;
  const legacyClaimId = expectedPlan?.legacyClaimId || localClaimId;
  const targetEntries = entriesFor(ledger, legacyClaimId);
  const genesis = targetEntries.find(entry => entry.action === "claim");
  const statusMatches = status.claims.filter(claim => claim?.claimId === legacyClaimId);
  const anchor = expectedPlan
    ? targetEntries.find(entry => entry.digest === expectedPlan.legacyTransitionDigest)
    : targetEntries.at(-1);
  const legacyClaim = expectedPlan
    ? claimFromEntry(anchor, genesis)
    : statusMatches.length === 1 ? statusMatches[0] : claimFromEntry(anchor, genesis);
  if (!genesis || !anchor || statusMatches.length > 1
    || targetEntries.filter(entry => entry.action === "claim").length !== 1) {
    throw new Error("Legacy scope-expansion claim requires one exact ledger identity origin.");
  }
  if (localClaimId === legacyClaimId) {
    validateLocalProjectionJoin({ lane, targetEntries, anchor, legacyClaimId });
  }
  const sourceClaimId = requiredDigest(genesis.claimCore?.predecessorClaimId, "source claim ID");
  const sourceEntries = entriesFor(ledger, sourceClaimId);
  const sourceRetirement = sourceEntries.findLast(entry => (
    entry.action === "retire" && entry.sequence > genesis.sequence
  ));
  const expansionPlanDigest = requiredDigest(
    lane?.lease?.admission?.planReceiptDigest,
    "scope-expansion plan receipt digest",
  );
  const historicalVariant = validateHistoricalShape({
    lane, actor, status, legacyClaim, genesis, latest: anchor, sourceEntries,
    targetEntries, sourceRetirement, expansionPlanDigest,
  });
  const reviewedHeadSha = requiredSha(legacyClaim.laneRevision, "reviewed head SHA");
  const deliveryHeadSha = requiredSha(
    lane?.refreshedHeadSha || lane?.headSha,
    "delivery head SHA",
  );
  const protectedMainRefresh = normalizeProtectedMainRefresh(
    lane?.protectedMainRefresh,
    reviewedHeadSha,
    deliveryHeadSha,
  );
  const core = {
    schema: SCOPE_EXPANSION_LINEAGE_PLAN_SCHEMA,
    kind: "historical-scope-expansion",
    historicalVariant,
    branch: requiredText(lane.branch, "branch"),
    ledgerRepository: requiredText(lane.authority.ledgerRepository, "ledger repository"),
    targetRepository: requiredText(lane.authority.targetRepository, "target repository"),
    repositoryId: requiredText(status.repositoryId, "repository identity"),
    actorId: authenticatedActorId(actor),
    reviewRequestId: requiredText(legacyClaim.reviewRequestId, "review request ID"),
    canonicalBaseSha: requiredSha(legacyClaim.canonicalBaseRevision, "canonical base SHA"),
    reviewedHeadSha,
    deliveryHeadSha,
    protectedMainRefresh,
    manifestDigest: requiredDigest(lane.manifest.manifestDigest, "manifest digest"),
    writeSetDigest: requiredDigest(legacyClaim.writeSetDigest, "write-set digest"),
    declaredWriteSet: normalizeWriteSet(legacyClaim.declaredWriteScope),
    workItemId: requiredText(legacyClaim.workItemId, "work-item ID"),
    legacyClaimId,
    legacyClaimDigest: requiredDigest(legacyClaim.fenceRevision, "legacy claim digest"),
    legacyTransitionDigest: requiredDigest(legacyClaim.transitionDigest, "legacy transition digest"),
    legacyTransitionCounter: positiveInteger(legacyClaim.transitionCounter, "legacy transition counter"),
    legacyExpiresAt: requiredInstant(legacyClaim.expiresAt, "legacy expiry"),
    sourceClaimId,
    sourceWorkItemId: requiredText(sourceRetirement.claimCore.workItemId, "source work-item ID"),
    sourceWriteSetDigest: requiredDigest(sourceRetirement.claimCore.writeSetDigest, "source write-set digest"),
    scopeExpansionPlanDigest: expansionPlanDigest,
    targetGenesisEntryDigest: requiredDigest(genesis.digest, "target genesis entry digest"),
    sourceRetirementEntryDigest: requiredDigest(sourceRetirement.digest, "source retirement entry digest"),
    observedLedgerRevision: expectedPlan?.observedLedgerRevision
      || requiredSha(status.ledgerRevision, "observed ledger revision"),
    observedLedgerDigest: expectedPlan?.observedLedgerDigest
      || requiredDigest(status.ledgerDigest, "observed ledger digest"),
    successorLeaseEpoch: 2,
  };
  const plan = Object.freeze({ ...core, planDigest: digestValue(core) });
  if (expectedPlan && digestValue(expectedPlan) !== digestValue(plan)) {
    throw new Error("Lineage migration plan drifted from its exact historical evidence.");
  }
  const successor = findStandardSuccessor(status, plan);
  rejectCompetingClaims(status, plan, new Set([legacyClaimId, ...(successor ? [successor.claimId] : [])]));
  const currentLegacyClaim = statusMatches.length === 1 ? statusMatches[0] : null;
  const integratedReplayRecovered = Boolean(
    expectedPlan
    && localClaimId === legacyClaimId
    && currentLegacyClaim?.integration
    && currentLegacyClaim.integrationReceiptDigest
    && currentLegacyClaim.transitionDigest !== plan.legacyTransitionDigest
  );
  const state = integratedReplayRecovered
    ? "integrated-replay-recovered"
    : localClaimId === legacyClaimId ? "legacy" : "migrated";
  if (state === "legacy" && !laneExact(lane, plan, legacyClaimId)) {
    throw new Error("Legacy lane projection drifted from its migration plan.");
  }
  if (state === "migrated" && (!successor || successor.claimId !== localClaimId || !laneExact(lane, plan, localClaimId))) {
    throw new Error("Local projection names no exact standard migration successor.");
  }
  if (state === "integrated-replay-recovered" && !laneExact(lane, plan, legacyClaimId)) {
    throw new Error("Recovered integrated replay projection drifted from its migration plan.");
  }
  return freezeVerified({
    plan,
    state,
    legacyClaim,
    successor,
    continuationMode: anchor.action === "integrate"
      ? "integrated-replay" : "standard-successor",
  }, VERIFIED_LINEAGES);
}

function validateLocalProjectionJoin({ lane, targetEntries, anchor, legacyClaimId }) {
  const authority = lane?.authority;
  const localEntry = targetEntries.find(entry => entry.digest === authority?.claimLedgerRevision);
  if (!localEntry || localEntry.claimId !== legacyClaimId
    || localEntry.claimDigest !== authority.claimDigest
    || localEntry.claimCore?.transitionCounter !== authority.transitionCounter
    || localEntry.claimCore?.leaseEpoch !== 1) {
    throw new Error("Local authority is not an exact transition in the legacy claim lineage.");
  }
  if (anchor.action !== "integrate") return;
  if (authority.state === "review_ready") {
    const localIndex = targetEntries.indexOf(localEntry);
    const anchorIndex = targetEntries.indexOf(anchor);
    if (localEntry.action !== "continue" || localEntry.claimCore?.state !== "reviewed"
      || localIndex + 1 !== anchorIndex
      || anchor.claimCore?.transitionCounter !== localEntry.claimCore.transitionCounter + 1
      || anchor.claimCore?.reviewRequestId !== localEntry.claimCore.reviewRequestId
      || anchor.claimCore?.laneRevision !== localEntry.claimCore.laneRevision
      || anchor.claimCore?.evidenceDigest !== localEntry.claimCore.evidenceDigest) {
      throw new Error("Integrated lineage is not the exact child of the local reviewed projection.");
    }
    return;
  }
  if (authority.state !== "delivery_authorized"
    || localEntry.sequence <= anchor.sequence
    || localEntry.claimCore?.integrationReceiptDigest !== anchor.claimCore?.integrationReceiptDigest
    || digestValue(localEntry.claimCore?.integration) !== digestValue(anchor.claimCore?.integration)) {
    throw new Error("Integrated replay recovery does not descend from the authorized integration transition.");
  }
}

function validateHistoricalShape({
  lane, actor, status, legacyClaim, genesis, latest, sourceEntries, targetEntries,
  sourceRetirement, expansionPlanDigest,
}) {
  const sourceGenesis = sourceEntries.find(entry => entry.action === "claim");
  const source = sourceRetirement?.claimCore;
  const target = genesis.claimCore;
  const actorId = authenticatedActorId(actor);
  const commonExact = (
    genesis.schema === ENTRY_SCHEMA
    && target?.leaseEpoch === 1
    && target.transitionCounter === 1
    && target.state === "waiting-successor"
    && target.reviewRequestId === null
    && sourceGenesis?.schema === ENTRY_SCHEMA
    && sourceGenesis.sequence < genesis.sequence
    && genesis.sequence < sourceRetirement?.sequence
    && sourceRetirement.sequence <= latest.sequence
    && sourceGenesis.claimId === source?.claimId
    && genesis.claimId === target.claimId
    && targetEntries[0]?.digest === genesis.digest
    && sourceRetirement?.schema === ENTRY_SCHEMA
    && sourceRetirement.action === "retire"
    && source?.state === "retired"
    && source.retirement?.reason === "superseded"
    && source.retirement.finalRevision === target.laneRevision
    && source.retirement.reviewRequestId === legacyClaim.reviewRequestId
    && source.actorId === target.actorId
    && source.actorId === actorId
    && source.deviceId === target.deviceId
    && source.repositoryId === target.repositoryId
    && target.repositoryId === status.repositoryId
    && source.canonicalBaseRevision === target.canonicalBaseRevision
    && strictSubset(source.declaredWriteScope, target.declaredWriteScope)
    && target.claimId === legacyClaim.claimId
    && target.predecessorClaimId === source.claimId
    && latest.digest === legacyClaim.transitionDigest
    && latest.claimDigest === legacyClaim.fenceRevision
    && lane?.pullRequest?.authorLogin === actor?.login
  );
  if (!commonExact) {
    throw new Error("Claim is not the exact receipt-bound historical scope-expansion shape.");
  }
  const activeDirtyIdentity = source.sessionId === target.sessionId
    && source.workItemId !== target.workItemId;
  const reviewedRecoveryIdentity = source.sessionId !== target.sessionId
    && source.workItemId === target.workItemId
    && target.sessionId === pseudonymousIdentifier("session", lane.lease.sessionId);
  if (activeDirtyIdentity) {
    validateActiveDirtyRetirement({ source, target, expansionPlanDigest });
    return ACTIVE_DIRTY_LINEAGE;
  }
  if (reviewedRecoveryIdentity) {
    validateReviewedRecoveryRetirement({ source, target, expansionPlanDigest });
    return REVIEWED_RECOVERY_LINEAGE;
  }
  throw new Error("Claim is not a recognized receipt-bound historical scope-expansion variant.");
}

function validateActiveDirtyRetirement({ source, target, expansionPlanDigest }) {
  const evidence = {
    schema: "agentic-active-dirty-scope-expansion-cloud-evidence/v1",
    phase: "source-retired",
    planDigest: expansionPlanDigest,
    sourceClaimId: source.claimId,
    successorClaimId: target.claimId,
    sourceFenceSha: target.laneRevision,
    targetWriteSetDigest: target.writeSetDigest,
  };
  for (const [field, kind] of [
    ["bytesDigest", "bytes"], ["namedChecksDigest", "checks"],
    ["handoffEvidenceDigest", "handoff"],
  ]) {
    if (source.retirement[field] !== digestValue({ ...evidence, kind })) {
      throw new Error(`Scope-expansion retirement ${field} does not bind the portable plan receipt.`);
    }
  }
}

function validateReviewedRecoveryRetirement({ source, target, expansionPlanDigest }) {
  const phase = "source-retired";
  const operationKey = `${REVIEWED_RECOVERY_LINEAGE}:${phase}:${digestValue({
    planDigest: expansionPlanDigest, phase,
  })}`;
  const expected = {
    bytesDigest: digestValue({ operationKey, kind: "bytes" }),
    namedChecksDigest: digestValue({ operationKey, kind: "checks" }),
    handoffEvidenceDigest: digestValue({ operationKey, successor: target.claimId }),
  };
  for (const [field, digest] of Object.entries(expected)) {
    if (source.retirement[field] !== digest) {
      throw new Error(`Reviewed scope-recovery retirement ${field} does not bind its operation receipt.`);
    }
  }
}

function normalizePlan(value) {
  if (!value || value.schema !== SCOPE_EXPANSION_LINEAGE_PLAN_SCHEMA) {
    throw new Error("Scope-expansion lineage migration plan is malformed.");
  }
  const reviewedHeadSha = requiredSha(value.reviewedHeadSha, "reviewed head SHA");
  const deliveryHeadSha = requiredSha(value.deliveryHeadSha, "delivery head SHA");
  const core = {
    schema: SCOPE_EXPANSION_LINEAGE_PLAN_SCHEMA,
    kind: value.kind === "historical-scope-expansion" ? value.kind : invalid("migration kind"),
    historicalVariant: HISTORICAL_LINEAGES.has(value.historicalVariant)
      ? value.historicalVariant : invalid("historical lineage variant"),
    branch: requiredText(value.branch, "branch"),
    ledgerRepository: requiredText(value.ledgerRepository, "ledger repository"),
    targetRepository: requiredText(value.targetRepository, "target repository"),
    repositoryId: requiredText(value.repositoryId, "repository identity"),
    actorId: requiredText(value.actorId, "actor identity"),
    reviewRequestId: requiredText(value.reviewRequestId, "review request ID"),
    canonicalBaseSha: requiredSha(value.canonicalBaseSha, "canonical base SHA"),
    reviewedHeadSha,
    deliveryHeadSha,
    protectedMainRefresh: normalizeProtectedMainRefresh(
      value.protectedMainRefresh,
      reviewedHeadSha,
      deliveryHeadSha,
    ),
    manifestDigest: requiredDigest(value.manifestDigest, "manifest digest"),
    writeSetDigest: requiredDigest(value.writeSetDigest, "write-set digest"),
    declaredWriteSet: normalizeWriteSet(value.declaredWriteSet),
    workItemId: requiredText(value.workItemId, "work-item ID"),
    legacyClaimId: requiredDigest(value.legacyClaimId, "legacy claim ID"),
    legacyClaimDigest: requiredDigest(value.legacyClaimDigest, "legacy claim digest"),
    legacyTransitionDigest: requiredDigest(value.legacyTransitionDigest, "legacy transition digest"),
    legacyTransitionCounter: positiveInteger(value.legacyTransitionCounter, "legacy transition counter"),
    legacyExpiresAt: requiredInstant(value.legacyExpiresAt, "legacy expiry"),
    sourceClaimId: requiredDigest(value.sourceClaimId, "source claim ID"),
    sourceWorkItemId: requiredText(value.sourceWorkItemId, "source work-item ID"),
    sourceWriteSetDigest: requiredDigest(value.sourceWriteSetDigest, "source write-set digest"),
    scopeExpansionPlanDigest: requiredDigest(value.scopeExpansionPlanDigest, "scope-expansion plan digest"),
    targetGenesisEntryDigest: requiredDigest(value.targetGenesisEntryDigest, "target genesis entry digest"),
    sourceRetirementEntryDigest: requiredDigest(value.sourceRetirementEntryDigest, "source retirement entry digest"),
    observedLedgerRevision: requiredSha(value.observedLedgerRevision, "observed ledger revision"),
    observedLedgerDigest: requiredDigest(value.observedLedgerDigest, "observed ledger digest"),
    successorLeaseEpoch: positiveInteger(value.successorLeaseEpoch, "successor lease epoch"),
  };
  if (core.successorLeaseEpoch !== 2 || value.planDigest !== digestValue(core)) {
    throw new Error("Scope-expansion lineage migration plan digest or successor epoch is invalid.");
  }
  return Object.freeze({ ...core, planDigest: value.planDigest });
}

function normalizeAdmission(value) {
  if (!value || value.schema !== SCOPE_EXPANSION_LINEAGE_ADMISSION_SCHEMA) {
    throw new Error("Scope-expansion lineage admission is malformed.");
  }
  const core = {
    schema: SCOPE_EXPANSION_LINEAGE_ADMISSION_SCHEMA,
    plan: normalizePlan(value.plan),
    planDigest: requiredDigest(value.planDigest, "plan digest"),
    authorizationDigest: requiredDigest(value.authorizationDigest, "authorization digest"),
    executionIntent: normalizeExecutionIntent(value.executionIntent),
    executionIntentDigest: requiredDigest(value.executionIntentDigest, "execution intent digest"),
    claimId: requiredDigest(value.claimId, "claim ID"),
    claimDigest: requiredDigest(value.claimDigest, "claim digest"),
    transitionDigest: requiredDigest(value.transitionDigest, "transition digest"),
    transitionCounter: positiveInteger(value.transitionCounter, "transition counter"),
    expiresAt: requiredInstant(value.expiresAt, "claim expiry"),
    ledgerRevision: requiredSha(value.ledgerRevision, "ledger revision"),
    ledgerDigest: requiredDigest(value.ledgerDigest, "ledger digest"),
    localAuthorityDigest: requiredDigest(value.localAuthorityDigest, "local authority digest"),
  };
  if (core.planDigest !== core.plan.planDigest || core.executionIntentDigest !== core.executionIntent.executionIntentDigest
    || core.executionIntent.planDigest !== core.planDigest || value.admissionDigest !== digestValue(core)) {
    throw new Error("Scope-expansion lineage admission digest is invalid.");
  }
  return Object.freeze({ ...core, admissionDigest: value.admissionDigest });
}

function findStandardSuccessor(status, plan) {
  const matches = status.claims.filter(claim => (
    claim?.claimId !== plan.legacyClaimId
    && claim?.predecessorClaimId === plan.legacyClaimId
    && claim?.leaseEpoch === plan.successorLeaseEpoch
    && claim?.actorId === plan.actorId
    && claim?.repositoryId === plan.repositoryId
    && claim?.workItemId === plan.workItemId
    && claim?.canonicalBaseRevision === plan.canonicalBaseSha
    && claim?.laneRevision === plan.reviewedHeadSha
    && claim?.writeSetDigest === plan.writeSetDigest
    && sameWriteSet(claim?.declaredWriteScope, plan.declaredWriteSet)
  ));
  if (matches.length > 1) throw new Error("Migration successor lineage is ambiguous.");
  return matches[0] || null;
}

function laneExact(lane, plan, claimId) {
  const reviewHead = lane?.lease?.reviewHeadSha;
  const authority = lane?.authority;
  const lease = lane?.lease;
  const remote = lane?.remoteLease;
  let protectedMainRefresh;
  try {
    protectedMainRefresh = normalizeProtectedMainRefresh(
      lane?.protectedMainRefresh,
      plan.reviewedHeadSha,
      lane?.refreshedHeadSha || lane?.headSha,
    );
  } catch { return false; }
  return Boolean(
    lane?.clean
    && lane.branch === plan.branch
    && lane.baseSha === plan.canonicalBaseSha
    && lane.headSha === plan.reviewedHeadSha
    && (lane.refreshedHeadSha || lane.headSha) === plan.deliveryHeadSha
    && lane.remoteHeadSha === plan.deliveryHeadSha
    && digestValue(protectedMainRefresh) === digestValue(plan.protectedMainRefresh)
    && reviewHead === plan.reviewedHeadSha
    && lane.pullRequest?.state === "OPEN"
    && lane.pullRequest.isDraft === false
    && lane.pullRequest.headRefOid === plan.deliveryHeadSha
    && lane.pullRequest.baseRefName === "main"
    && lease.status === "review_ready"
    && lease.branch === plan.branch
    && lease.baseSha === plan.canonicalBaseSha
    && lease.sessionId === authority.sessionId
    && lease.device === authority.deviceId
    && authority.claimId === claimId
    && authority.reviewRequestId === plan.reviewRequestId
    && authorityProjectionExact(lease.cloudAuthority, authority)
    && remote?.status === "review_ready"
    && remote.branch === plan.branch
    && remote.baseSha === plan.canonicalBaseSha
    && remote.reviewHeadSha === plan.reviewedHeadSha
    && remote.sessionId === authority.sessionId
    && remote.device === authority.deviceId
    && authorityProjectionExact(remote.cloudAuthority, authority)
    && lane.manifest.writeSetDigest === plan.writeSetDigest
    && lane.manifest.manifestDigest === plan.manifestDigest
    && sameWriteSet(lane.manifest.declaredWriteSet, plan.declaredWriteSet)
  );
}

function normalizeProtectedMainRefresh(value, reviewedHeadSha, deliveryHeadSha) {
  const reviewed = requiredSha(reviewedHeadSha, "refresh reviewed head SHA");
  const delivery = requiredSha(deliveryHeadSha, "refresh delivery head SHA");
  if (delivery === reviewed) {
    if (value !== null && value !== undefined) {
      throw new Error("Unrefreshed lineage cannot carry a protected-main refresh receipt.");
    }
    return null;
  }
  const normalized = {
    schema: value?.schema === "agentic-protected-main-refresh/v1"
      ? value.schema : invalid("protected-main refresh schema"),
    deliveredHeadSha: requiredSha(value?.deliveredHeadSha, "refresh delivered head SHA"),
    refreshedHeadSha: requiredSha(value?.refreshedHeadSha, "refresh head SHA"),
    mainParentSha: requiredSha(value?.mainParentSha, "refresh main parent SHA"),
  };
  if (normalized.deliveredHeadSha !== reviewed || normalized.refreshedHeadSha !== delivery) {
    throw new Error("Protected-main refresh receipt does not join the reviewed and delivery heads.");
  }
  return Object.freeze(normalized);
}

function authorityProjectionExact(candidate, authority) {
  try {
    return digestValue(normalizeAuthorityProjection(candidate))
      === digestValue(normalizeAuthorityProjection(authority));
  } catch { return false; }
}

function normalizeAuthorityProjection(value) {
  if (!value) throw new Error("Authority projection is required.");
  const normalized = Object.fromEntries(AUTHORITY_PARITY_FIELDS.map(field => {
    if (value[field] === undefined) throw new Error(`Authority projection ${field} is required.`);
    return [field, value[field]];
  }));
  normalized.cloudDeclaredWriteScope = normalizeWriteSet(value.cloudDeclaredWriteScope);
  return normalized;
}

function normalizeExecutionIntent(value) {
  if (!value || value.schema !== SCOPE_EXPANSION_LINEAGE_EXECUTION_INTENT_SCHEMA) {
    throw new Error("Scope-expansion lineage execution intent is malformed.");
  }
  const core = {
    schema: SCOPE_EXPANSION_LINEAGE_EXECUTION_INTENT_SCHEMA,
    planDigest: requiredDigest(value.planDigest, "execution plan digest"),
    transition: value.transition === "reclaim" ? value.transition : invalid("execution transition"),
    branch: requiredText(value.branch, "execution branch"),
    sessionId: requiredText(value.sessionId, "execution session ID"),
    successorSessionId: requiredText(value.successorSessionId, "successor session ID"),
    successorDeviceId: requiredText(value.successorDeviceId, "successor device ID"),
    ttlSeconds: positiveInteger(value.ttlSeconds, "execution TTL seconds"),
  };
  if (value.executionIntentDigest !== digestValue(core)) {
    throw new Error("Scope-expansion lineage execution intent digest is invalid.");
  }
  return Object.freeze({ ...core, executionIntentDigest: value.executionIntentDigest });
}

function executionIntentMatchesRequest(intent, request) {
  return Boolean(request && intent.transition === request.transition
    && intent.branch === request.branch && intent.sessionId === request.sessionId
    && intent.successorSessionId === request.successorSessionId
    && intent.successorDeviceId === request.successorDeviceId
    && intent.ttlSeconds === request.ttlSeconds);
}

function rejectCompetingClaims(status, plan, allowed) {
  const conflicts = status.claims.filter(claim => {
    if (allowed.has(claim?.claimId)) return false;
    try {
      return writeSetsOverlap(claim.declaredWriteScope, plan.declaredWriteSet)
        || claim.reviewRequestId === plan.reviewRequestId;
    } catch { return true; }
  });
  if (conflicts.length > 0) throw new Error("A competing live claim blocks lineage migration.");
}

function buildReceipt(kind, payload) {
  const core = {
    schema: SCOPE_EXPANSION_LINEAGE_RECEIPT_SCHEMA,
    kind: requiredText(kind, "receipt kind"),
    payload,
  };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}

function entriesFor(ledger, claimId) {
  return ledger.entries.filter(entry => entry?.claimId === claimId)
    .sort((left, right) => left.sequence - right.sequence);
}

function claimFromEntry(entry, genesis) {
  if (!entry || !genesis) return null;
  return {
    ...entry.claimCore,
    fenceRevision: entry.claimDigest,
    transitionDigest: entry.digest,
    entrySchema: entry.schema,
    claimIdentitySchema: genesis.schema,
  };
}

function uniqueClaim(status, claimId, label) {
  requireStatus(status);
  const matches = status.claims.filter(claim => claim?.claimId === claimId);
  if (matches.length !== 1) throw new Error(`${label} must appear exactly once in current cloud status.`);
  return matches[0];
}

function requireStatus(status) {
  if (status?.schema !== RESULT_SCHEMA || status.ok !== true || status.action !== "status"
    || status.status !== "ready" || !Array.isArray(status.claims)) {
    throw new Error("Lineage migration requires complete current cloud status.");
  }
}

function strictSubset(left, right) {
  const source = normalizeWriteSet(left), target = normalizeWriteSet(right);
  return source.length < target.length && source.every(value => target.includes(value));
}

function sameWriteSet(left, right) {
  try { return JSON.stringify(normalizeWriteSet(left)) === JSON.stringify(normalizeWriteSet(right)); }
  catch { return false; }
}

function authenticatedActorId(actor) {
  const id = Number(actor?.id);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("Authenticated actor identity is invalid.");
  return `github-user:${id}`;
}

function requiredText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function requiredSha(value, label) {
  const sha = requiredText(value, label);
  if (!SHA_PATTERN.test(sha)) throw new Error(`${label} must be a 40-character SHA.`);
  return sha;
}

function requiredDigest(value, label) {
  const digest = requiredText(value, label);
  if (!DIGEST_PATTERN.test(digest)) throw new Error(`${label} must be a SHA-256 digest.`);
  return digest;
}

function positiveInteger(value, label) {
  const integer = Number(value);
  if (!Number.isSafeInteger(integer) || integer < 1) throw new Error(`${label} must be a positive integer.`);
  return integer;
}

function requiredInstant(value, label) {
  const instant = requiredText(value, label);
  if (!Number.isFinite(Date.parse(instant))) throw new Error(`${label} must be an ISO-8601 instant.`);
  return instant;
}

function invalid(label) {
  throw new Error(`${label} is invalid.`);
}

function freezeVerified(value, identities) {
  const frozen = Object.freeze(value);
  identities.add(frozen);
  return frozen;
}
