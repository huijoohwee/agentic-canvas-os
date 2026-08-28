// Responsibility: Seal the pair-relevant proof for two inert, overlapping claims with mixed identities.
import {
  canonicalJson, digestValue, normalizeWriteSet,
} from "./cloud-collaboration-primitives.mjs";

export const MIXED_IDENTITY_PAIR_RETIREMENT_EVIDENCE_SCHEMA =
  "agentic-claim-only-mixed-identity-pair-retirement-evidence/v1";

const DIGEST = /^[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40}$/u;
const MIXED_FIELDS = Object.freeze([
  "workItemId", "deviceId", "sessionId", "writeSetDigest", "declaredWriteScope",
]);

export function buildMixedIdentityPairRetirementEvidence(value) {
  const core = normalizeCore(value);
  return deepFreeze({ ...core, evidenceDigest: digestValue(core) });
}

export function normalizeMixedIdentityPairRetirementEvidence(value) {
  object(value, "mixed-identity pair evidence");
  const rebuilt = buildMixedIdentityPairRetirementEvidence(value);
  if (value.evidenceDigest !== rebuilt.evidenceDigest
    || canonicalJson(value) !== canonicalJson(rebuilt)) {
    invalid("evidence seal");
  }
  return rebuilt;
}

export function stableMixedIdentityPairEvidence(value) {
  const evidence = normalizeMixedIdentityPairRetirementEvidence(value);
  return deepFreeze({
    repository: evidence.repository,
    controller: evidence.controller,
    canonical: evidence.canonical,
    source: evidence.source,
    waitingSuccessor: evidence.waitingSuccessor,
    sourceEntry: evidence.sourceEntry,
    waitingSuccessorEntry: evidence.waitingSuccessorEntry,
    sourceLineageCount: evidence.sourceLineageCount,
    waitingSuccessorLineageCount: evidence.waitingSuccessorLineageCount,
    identityComparison: evidence.identityComparison,
    scopeComparison: evidence.scopeComparison,
    associations: evidence.associations,
    overlap: evidence.overlap,
  });
}

export function stableMixedIdentityPairEvidenceDigest(value) {
  return digestValue(stableMixedIdentityPairEvidence(value));
}

export function buildMixedIdentityScopeComparison(sourceScope, waitingScope) {
  const source = normalizeWriteSet(sourceScope);
  const waitingSuccessor = normalizeWriteSet(waitingScope);
  const sourceSet = new Set(source);
  const waitingSet = new Set(waitingSuccessor);
  const union = normalizeWriteSet([...source, ...waitingSuccessor]);
  const intersection = source.filter(item => waitingSet.has(item));
  const sourceOnly = source.filter(item => !waitingSet.has(item));
  const waitingSuccessorOnly = waitingSuccessor.filter(item => !sourceSet.has(item));
  const semantic = values => values.filter(item => item.startsWith("semantic:"));
  const core = {
    source,
    waitingSuccessor,
    union,
    intersection,
    sourceOnly,
    waitingSuccessorOnly,
    semanticUnion: semantic(union),
    semanticIntersection: semantic(intersection),
    semanticSourceOnly: semantic(sourceOnly),
    semanticWaitingSuccessorOnly: semantic(waitingSuccessorOnly),
  };
  const digests = Object.fromEntries(Object.entries(core).map(([name, values]) =>
    [`${name}Digest`, digestValue(values)]));
  return deepFreeze({ ...core, ...digests, comparisonDigest: digestValue({ core, digests }) });
}

export function projectMixedIdentityPairClaim(value, recordedState = value?.recordedState) {
  object(value, "claim projection");
  const result = {
    claimId: digest(value.claimId, "claim ID"),
    claimDigest: digest(value.fenceRevision || value.claimDigest, "claim fence"),
    transitionDigest: digest(value.transitionDigest || value.ledgerRevision,
      "claim transition"),
    operationReceiptDigest: digest(value.operationReceiptDigest, "claim operation receipt"),
    entrySchema: text(value.entrySchema, "claim entry schema"),
    claimIdentitySchema: text(value.claimIdentitySchema, "claim identity schema"),
    state: text(value.state, "claim state"),
    recordedState: text(recordedState, "claim recorded state"),
    writeAuthority: boolean(value.writeAuthority, "claim write authority"),
    scopeReserved: boolean(value.scopeReserved, "claim scope reservation"),
    actorId: text(value.actorId, "claim actor"),
    repositoryId: text(value.repositoryId, "claim repository"),
    workItemId: text(value.workItemId, "claim work item"),
    deviceId: text(value.deviceId, "claim device"),
    sessionId: text(value.sessionId, "claim session"),
    canonicalBaseRevision: sha(value.canonicalBaseRevision, "claim canonical base"),
    laneRevision: sha(value.laneRevision, "claim lane revision"),
    declaredWriteScope: normalizeWriteSet(value.declaredWriteScope),
    writeSetDigest: digest(value.writeSetDigest, "claim write-set digest"),
    leaseEpoch: positive(value.leaseEpoch, "claim lease epoch"),
    transitionCounter: positive(value.transitionCounter, "claim transition counter"),
    heartbeatCounter: nonnegative(value.heartbeatCounter, "claim heartbeat counter"),
    reviewRequestId: nullableText(value.reviewRequestId, "claim review request"),
    predecessorClaimId: nullableDigest(value.predecessorClaimId, "claim predecessor"),
    expiresAt: instant(value.expiresAt, "claim expiry"),
    eligibleSince: value.eligibleSince == null ? null
      : instant(value.eligibleSince, "claim eligible-since time"),
    evidenceDigest: nullableDigest(value.evidenceDigest, "claim evidence"),
    handoff: value.handoff ?? null,
    release: value.release ?? null,
    canonicalDescendantProof: value.canonicalDescendantProof ?? null,
    recovery: value.recovery ?? null,
    integration: value.integration ?? null,
    retirement: value.retirement ?? null,
  };
  if (result.writeSetDigest !== digestValue(result.declaredWriteScope)) {
    invalid("claim normalized write-set digest");
  }
  return deepFreeze(result);
}

export function projectMixedIdentityPairEntry(value) {
  object(value, "claim entry");
  return deepFreeze({
    schema: text(value.schema, "entry schema"),
    action: text(value.action, "entry action"),
    sequence: positive(value.sequence, "entry sequence"),
    claimId: digest(value.claimId, "entry claim ID"),
    claimDigest: digest(value.claimDigest, "entry claim digest"),
    digest: digest(value.digest, "entry digest"),
    repositoryId: text(value.repositoryId, "entry repository"),
    idempotencyKey: digest(value.idempotencyKey, "entry operation key"),
    requestDigest: digest(value.requestDigest, "entry request digest"),
    evaluationTime: instant(value.evaluationTime, "entry evaluation time"),
    state: text(value.state ?? value.claimCore?.state, "entry state"),
    transitionCounter: positive(value.transitionCounter ?? value.claimCore?.transitionCounter,
      "entry transition counter"),
    heartbeatCounter: nonnegative(value.heartbeatCounter ?? value.claimCore?.heartbeatCounter,
      "entry heartbeat counter"),
    predecessorClaimId: nullableDigest(
      value.predecessorClaimId ?? value.claimCore?.predecessorClaimId,
      "entry predecessor",
    ),
    reviewRequestId: nullableText(
      value.reviewRequestId ?? value.claimCore?.reviewRequestId,
      "entry review request",
    ),
  });
}

function normalizeCore(value) {
  object(value, "mixed-identity pair evidence");
  if (value.schema !== MIXED_IDENTITY_PAIR_RETIREMENT_EVIDENCE_SCHEMA) {
    invalid("evidence schema");
  }
  const source = projectMixedIdentityPairClaim(value.source, value.source?.recordedState);
  const waitingSuccessor = projectMixedIdentityPairClaim(
    value.waitingSuccessor, value.waitingSuccessor?.recordedState,
  );
  const sourceEntry = projectMixedIdentityPairEntry(value.sourceEntry);
  const waitingSuccessorEntry = projectMixedIdentityPairEntry(value.waitingSuccessorEntry);
  const identityComparison = compareIdentities(source, waitingSuccessor);
  const scopeComparison = buildMixedIdentityScopeComparison(
    source.declaredWriteScope, waitingSuccessor.declaredWriteScope,
  );
  requireCanonicalProjection(value.identityComparison, identityComparison, "identity comparison");
  requireCanonicalProjection(value.scopeComparison, scopeComparison, "scope comparison");
  const associations = normalizeAssociations(value.associations);
  const overlap = normalizeOverlap(value.overlap);
  assertClaimOnlySubjects({
    source,
    waitingSuccessor,
    sourceEntry,
    waitingSuccessorEntry,
    sourceLineageCount: positive(value.sourceLineageCount, "source lineage count"),
    waitingSuccessorLineageCount: positive(
      value.waitingSuccessorLineageCount, "waiting-successor lineage count",
    ),
    identityComparison,
    associations,
    overlap,
  });
  const observedAt = instant(value.observedAt, "observation time");
  if (Date.parse(source.expiresAt) > Date.parse(observedAt)
    || Date.parse(waitingSuccessor.expiresAt) > Date.parse(observedAt)) {
    invalid("expired claim-only pair");
  }
  return {
    schema: MIXED_IDENTITY_PAIR_RETIREMENT_EVIDENCE_SCHEMA,
    observedAt,
    repository: normalizeRepository(value.repository),
    controller: normalizeController(value.controller),
    canonical: normalizeCanonical(value.canonical),
    cloud: normalizeCloud(value.cloud),
    source,
    waitingSuccessor,
    sourceEntry,
    waitingSuccessorEntry,
    sourceLineageCount: value.sourceLineageCount,
    waitingSuccessorLineageCount: value.waitingSuccessorLineageCount,
    identityComparison,
    scopeComparison,
    associations,
    overlap,
    disjointMovement: normalizeDisjointMovement(value.disjointMovement),
  };
}

function compareIdentities(source, waitingSuccessor) {
  const equalFields = [], differentFields = [];
  for (const field of MIXED_FIELDS) {
    const equal = field === "declaredWriteScope"
      ? canonicalJson(source[field]) === canonicalJson(waitingSuccessor[field])
      : source[field] === waitingSuccessor[field];
    (equal ? equalFields : differentFields).push(field);
  }
  return deepFreeze({
    actorIdEqual: source.actorId === waitingSuccessor.actorId,
    repositoryIdEqual: source.repositoryId === waitingSuccessor.repositoryId,
    equalFields,
    differentFields,
    comparisonDigest: digestValue({ equalFields, differentFields }),
  });
}

function assertClaimOnlySubjects(value) {
  const { source, waitingSuccessor, sourceEntry, waitingSuccessorEntry,
    identityComparison, associations, overlap } = value;
  if (value.sourceLineageCount !== 1 || sourceEntry.action !== "claim"
    || sourceEntry.claimId !== source.claimId || sourceEntry.state !== "current"
    || sourceEntry.claimDigest !== source.claimDigest
    || sourceEntry.digest !== source.transitionDigest
    || sourceEntry.repositoryId !== source.repositoryId
    || sourceEntry.transitionCounter !== 1 || sourceEntry.heartbeatCounter !== 0
    || sourceEntry.predecessorClaimId !== null || sourceEntry.reviewRequestId !== null
    || source.state !== "dormant-preserved" || source.recordedState !== "current"
    || source.writeAuthority || !source.scopeReserved || source.leaseEpoch !== 1
    || source.transitionCounter !== 1 || source.heartbeatCounter !== 0
    || source.canonicalBaseRevision !== source.laneRevision
    || source.reviewRequestId !== null || source.predecessorClaimId !== null
    || source.eligibleSince !== null || source.handoff !== null || source.release !== null
    || source.canonicalDescendantProof !== null
    || source.evidenceDigest !== null || source.recovery !== null
    || source.integration !== null || source.retirement !== null) {
    invalid("claim-only source");
  }
  if (value.waitingSuccessorLineageCount !== 1
    || waitingSuccessorEntry.action !== "claim"
    || waitingSuccessorEntry.claimId !== waitingSuccessor.claimId
    || waitingSuccessorEntry.state !== "waiting-successor"
    || waitingSuccessorEntry.claimDigest !== waitingSuccessor.claimDigest
    || waitingSuccessorEntry.digest !== waitingSuccessor.transitionDigest
    || waitingSuccessorEntry.repositoryId !== waitingSuccessor.repositoryId
    || waitingSuccessorEntry.transitionCounter !== 1
    || waitingSuccessorEntry.heartbeatCounter !== 0
    || waitingSuccessorEntry.predecessorClaimId !== source.claimId
    || waitingSuccessorEntry.reviewRequestId !== null
    || waitingSuccessor.state !== "waiting-successor"
    || waitingSuccessor.recordedState !== "waiting-successor"
    || waitingSuccessor.writeAuthority || waitingSuccessor.scopeReserved
    || waitingSuccessor.leaseEpoch !== 1 || waitingSuccessor.transitionCounter !== 1
    || waitingSuccessor.heartbeatCounter !== 0
    || waitingSuccessor.canonicalBaseRevision !== waitingSuccessor.laneRevision
    || waitingSuccessor.predecessorClaimId !== source.claimId
    || waitingSuccessor.eligibleSince === null
    || waitingSuccessor.handoff !== null || waitingSuccessor.release !== null
    || waitingSuccessor.reviewRequestId !== null || waitingSuccessor.evidenceDigest !== null
    || waitingSuccessor.recovery !== null || waitingSuccessor.integration !== null
    || waitingSuccessor.retirement !== null) {
    invalid("claim-only waiting successor");
  }
  if (!identityComparison.actorIdEqual || !identityComparison.repositoryIdEqual
    || identityComparison.differentFields.length === 0) {
    invalid("mixed identity boundary");
  }
  if (source.actorId !== waitingSuccessor.actorId
    || source.repositoryId !== waitingSuccessor.repositoryId) {
    invalid("mandatory actor/repository equality");
  }
  if (Object.values(associations).some(subject =>
    Object.values(subject).some(matches => matches.length !== 0))) {
    invalid("claim-bound authored association closure");
  }
  const expectedOverlap = [source.claimId, waitingSuccessor.claimId].sort();
  if (canonicalJson(overlap.overlappingClaimIds) !== canonicalJson(expectedOverlap)
    || canonicalJson(overlap.reservedClaimIds) !== canonicalJson([source.claimId])
    || canonicalJson(overlap.waitingClaimIds) !== canonicalJson([waitingSuccessor.claimId])
    || overlap.higherPriorityWaitingClaimIds.length !== 0) {
    invalid("pair-bounded overlap closure");
  }
}

function normalizeRepository(value) {
  object(value, "repository evidence");
  return deepFreeze({
    targetRepository: repository(value.targetRepository, "target repository"),
    ledgerRepository: repository(value.ledgerRepository, "ledger repository"),
    providerRepositoryId: text(value.providerRepositoryId, "provider repository ID"),
    topLevelDigest: digest(value.topLevelDigest, "repository top-level digest"),
    gitCommonDirectoryDigest: digest(value.gitCommonDirectoryDigest,
      "repository common-directory digest"),
    originUrlDigest: digest(value.originUrlDigest, "repository origin digest"),
  });
}

function normalizeController(value) {
  object(value, "controller evidence");
  const result = {
    repository: repository(value.repository, "controller repository"),
    branch: text(value.branch, "controller branch"),
    headSha: sha(value.headSha, "controller HEAD"),
    originMainSha: sha(value.originMainSha, "controller origin/main"),
    remoteMainSha: sha(value.remoteMainSha, "controller remote main"),
    runtimeDigest: digest(value.runtimeDigest, "controller runtime digest"),
    policyDigest: digest(value.policyDigest ?? value.protectionDigest,
      "controller policy digest"),
    clean: boolean(value.clean, "controller cleanliness"),
    protected: boolean(value.protected, "controller protection"),
  };
  if (result.branch !== "main" || !result.clean || !result.protected
    || result.headSha !== result.originMainSha || result.headSha !== result.remoteMainSha) {
    invalid("clean protected controller parity");
  }
  return deepFreeze(result);
}

function normalizeCloud(value) {
  object(value, "cloud observation");
  return deepFreeze({
    ledgerRevision: sha(value.ledgerRevision, "ledger revision"),
    ledgerDigest: digest(value.ledgerDigest, "ledger digest"),
    validatedLedgerDigest: digest(value.validatedLedgerDigest, "validated ledger digest"),
    sequence: positive(value.sequence, "ledger sequence"),
    inventoryDigest: digest(value.inventoryDigest, "inventory digest"),
  });
}

function normalizeCanonical(value) {
  object(value, "canonical evidence");
  const result = {
    mainSha: sha(value.mainSha, "canonical main"),
    sourceBaseContained: boolean(value.sourceBaseContained, "source base ancestry"),
    waitingSuccessorBaseContained: boolean(value.waitingSuccessorBaseContained,
      "waiting-successor base ancestry"),
  };
  if (!result.sourceBaseContained || !result.waitingSuccessorBaseContained) {
    invalid("canonical ancestry");
  }
  return deepFreeze(result);
}

function normalizeAssociations(value) {
  object(value, "association evidence");
  return deepFreeze(Object.fromEntries(["source", "waitingSuccessor"].map(subject => {
    object(value[subject], `${subject} association evidence`);
    return [subject, Object.fromEntries([
      "writerLeaseMatches", "pullRequestMarkerMatches", "authoredRevisionAssociations",
    ].map(name => [name, normalizeObjectArray(value[subject][name], `${subject} ${name}`)]))];
  })));
}

function normalizeOverlap(value) {
  object(value, "overlap evidence");
  return deepFreeze(Object.fromEntries([
    "overlappingClaimIds", "reservedClaimIds", "waitingClaimIds",
    "higherPriorityWaitingClaimIds",
  ].map(name => [name, digestArray(value[name], `overlap ${name}`)])));
}

function normalizeDisjointMovement(value) {
  object(value, "disjoint movement evidence");
  if (value.classification !== "keep") invalid("disjoint movement classification");
  return deepFreeze({
    classification: "keep",
    currentClaimCount: nonnegative(value.currentClaimCount, "disjoint claim count"),
    inventoryDigest: digest(value.inventoryDigest, "disjoint inventory digest"),
  });
}

function normalizeObjectArray(value, label) {
  if (!Array.isArray(value)) invalid(label);
  return deepFreeze(value.map((item, index) => {
    object(item, `${label} ${index}`);
    return deepFreeze(JSON.parse(canonicalJson(item)));
  }).sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))));
}

function digestArray(value, label) {
  if (!Array.isArray(value)) invalid(label);
  const result = value.map(item => digest(item, label)).sort();
  if (new Set(result).size !== result.length) invalid(`${label} uniqueness`);
  return result;
}

function requireCanonicalProjection(actual, expected, label) {
  if (canonicalJson(actual) !== canonicalJson(expected)) invalid(label);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  return value;
}
function text(value, label) {
  if (typeof value !== "string" || !value || value.trim() !== value) invalid(label);
  return value;
}
function repository(value, label) {
  const result = text(value, label);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(result)) invalid(label);
  return result;
}
function digest(value, label) {
  if (!DIGEST.test(String(value || ""))) invalid(label);
  return value;
}
function nullableDigest(value, label) {
  return value == null ? null : digest(value, label);
}
function sha(value, label) {
  if (!SHA.test(String(value || ""))) invalid(label);
  return value;
}
function positive(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) invalid(label);
  return value;
}
function nonnegative(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) invalid(label);
  return value;
}
function boolean(value, label) {
  if (typeof value !== "boolean") invalid(label);
  return value;
}
function nullableText(value, label) {
  return value == null ? null : text(value, label);
}
function instant(value, label) {
  if (typeof value !== "string" || new Date(value).toISOString() !== value) invalid(label);
  return value;
}
function invalid(label) {
  throw new Error(`Mixed-identity pair ${label} is invalid.`);
}
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const member of Object.values(value)) deepFreeze(member);
  return value;
}
