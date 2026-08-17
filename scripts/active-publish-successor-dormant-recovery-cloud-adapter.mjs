// Responsibility: Perform one claim-preserving dormant recovery through an injected cloud boundary.
import {
  canonicalJson,
  digestValue,
  normalizeWriteSet,
  writeSetsOverlap,
} from "./cloud-collaboration-primitives.mjs";
import { invokeRepositoryCloudAction } from "./scoped-lane-cloud-authority.mjs";
import { normalizeBoundAuthority } from "./scoped-lane-cloud-reconciliation.mjs";
import {
  normalizeActivePublishSuccessorDormantRecoveryEvidence,
  projectActivePublishSuccessorDormantCloudEvidence,
} from "./active-publish-successor-dormant-recovery-evidence.mjs";

export const ACTIVE_PUBLISH_SUCCESSOR_DORMANT_RECOVERY_CLOUD_REQUEST_SCHEMA =
  "agentic-active-publish-successor-dormant-recovery-cloud-request/v1";
export const ACTIVE_PUBLISH_SUCCESSOR_DORMANT_RECOVERY_CLOUD_RESULT_SCHEMA =
  "agentic-active-publish-successor-dormant-recovery-cloud-result/v1";

const DIGEST = /^[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40}$/u;
const MINIMUM_TTL_SECONDS = 60;
const MAXIMUM_TTL_SECONDS = 86_400;

export function createActivePublishSuccessorDormantRecoveryCloudAdapter(
  dependencies = {},
) {
  const invoke = dependencies.invokeCloudAction || invokeRepositoryCloudAction;
  const readSource = dependencies.readSourceEvidence;
  const environment = dependencies.environment || process.env;
  if (typeof invoke !== "function") throw new Error("Dormant recovery requires a cloud adapter.");
  return Object.freeze({
    inspectSource(input = {}) {
      const source = input.evidence ?? (typeof readSource === "function" ? readSource() : null);
      if (source) return normalizeActivePublishSuccessorDormantRecoveryEvidence(source);
      return inspectActivePublishSuccessorDormantRecoveryCloud({
        ...input,
        ledgerRepository: input.ledgerRepository ?? dependencies.ledgerRepository,
        targetRepository: input.targetRepository ?? dependencies.targetRepository,
        inspect: invoke,
        environment,
      });
    },
    inspectDormant(input = {}) {
      return inspectActivePublishSuccessorDormantRecoveryCloud({
        ...input,
        ledgerRepository: input.ledgerRepository ?? dependencies.ledgerRepository,
        targetRepository: input.targetRepository ?? dependencies.targetRepository,
        inspect: invoke,
        environment,
      });
    },
    sealRequest(plan) {
      return sealActivePublishSuccessorDormantRecoveryCloudRequest(plan, dependencies);
    },
    recover({ plan, sealedRequest }) {
      return recoverActivePublishSuccessorDormantCloudClaim({
        plan,
        sealedRequest,
        invoke,
        environment,
        location: dependencies,
      });
    },
    verifyRecovered({ plan, authority }) {
      return verifyActivePublishSuccessorDormantRecoveryCloud({
        plan,
        authority,
        inspect: invoke,
        environment,
        location: dependencies,
      });
    },
  });
}

export function inspectActivePublishSuccessorDormantRecoveryCloud({
  sourceEvidence,
  sourceAuthority,
  authority: authorityInput,
  sourceLease,
  declaredWriteSet,
  ledgerRepository,
  targetRepository,
  inspect = invokeRepositoryCloudAction,
  environment = process.env,
}) {
  const rawSourceAuthority = sourceAuthority ?? authorityInput;
  const source = sourceEvidence
    ? normalizeActivePublishSuccessorDormantRecoveryEvidence(sourceEvidence)
    : null;
  const authority = source?.cloud ?? {
    ledgerRepository: requiredRepository(ledgerRepository, "ledger repository"),
    targetRepository: requiredRepository(targetRepository, "target repository"),
  };
  const first = readStatus(inspect, authority, environment);
  const second = readStatus(inspect, authority, environment);
  assertStableReadback(first, second);
  const claimId = source?.cloud.claim.claimId
    ?? requiredDigest(rawSourceAuthority?.claimId, "source claim ID");
  const claim = exactClaim(second.claims, claimId);
  if (source) assertDormantSourceClaim(source.cloud.claim, claim);
  else assertRawDormantSubject({
    authority: rawSourceAuthority,
    claim,
    lease: sourceLease,
    writeSet: declaredWriteSet,
  });
  return buildCloudEvidence(
    second,
    claim,
    source?.lease.declaredWriteSet ?? declaredWriteSet,
    authority,
  );
}

export function sealActivePublishSuccessorDormantRecoveryCloudRequest(plan, location = {}) {
  const source = planSource(plan);
  const sourceEvidence = normalizeActivePublishSuccessorDormantRecoveryEvidence(source);
  const ttlSeconds = boundedTtl(plan.ttlSeconds);
  const recoveryEvidenceDigest = digestValue({
    schema: "agentic-active-publish-successor-dormant-recovery-cloud-evidence/v1",
    planDigest: requiredDigest(plan.planDigest, "plan digest"),
    sourceEvidenceDigest: sourceEvidence.evidenceDigest,
  });
  const request = {
    claimId: sourceEvidence.cloud.claim.claimId,
    expectedFenceRevision: sourceEvidence.cloud.claim.fenceRevision,
    expectedLedgerRevision: sourceEvidence.cloud.ledgerRevision,
    expectedLedgerDigest: sourceEvidence.cloud.ledgerDigest,
    expectedTransitionCounter: sourceEvidence.cloud.claim.transitionCounter,
    mode: "recovery",
    ttlSeconds,
    recoveryEvidenceDigest,
    deviceId: sourceEvidence.lease.device,
    sessionId: sourceEvidence.lease.sessionId,
    idempotencyKey: digestValue(
      `active-publish-successor-dormant-recovery:${plan.planDigest}`,
    ),
  };
  const core = {
    schema: ACTIVE_PUBLISH_SUCCESSOR_DORMANT_RECOVERY_CLOUD_REQUEST_SCHEMA,
    planDigest: plan.planDigest,
    sourceEvidenceDigest: sourceEvidence.evidenceDigest,
    ledgerRepository: requiredRepository(
      location.ledgerRepository
        ?? sourceEvidence.cloud.ledgerRepository
        ?? plan.ledgerRepository,
      "ledger repository",
    ),
    targetRepository: requiredRepository(
      location.targetRepository
        ?? sourceEvidence.cloud.targetRepository
        ?? plan.targetRepository,
      "target repository",
    ),
    request: Object.freeze(request),
  };
  return deepFreeze({ ...core, requestDigest: digestValue(core) });
}

export function normalizeActivePublishSuccessorDormantRecoveryCloudRequest(value) {
  object(value, "sealed cloud request");
  const request = object(value.request, "cloud request");
  const core = {
    schema: value.schema,
    planDigest: requiredDigest(value.planDigest, "request plan digest"),
    sourceEvidenceDigest: requiredDigest(
      value.sourceEvidenceDigest,
      "request source-evidence digest",
    ),
    ledgerRepository: requiredRepository(value.ledgerRepository, "ledger repository"),
    targetRepository: requiredRepository(value.targetRepository, "target repository"),
    request: Object.freeze({
      claimId: requiredDigest(request.claimId, "request claim ID"),
      expectedFenceRevision: requiredDigest(request.expectedFenceRevision, "expected fence"),
      expectedLedgerRevision: requiredSha(request.expectedLedgerRevision, "expected ledger revision"),
      expectedLedgerDigest: requiredDigest(request.expectedLedgerDigest, "expected ledger digest"),
      expectedTransitionCounter: positive(request.expectedTransitionCounter, "expected transition"),
      mode: request.mode,
      ttlSeconds: boundedTtl(request.ttlSeconds),
      recoveryEvidenceDigest: requiredDigest(request.recoveryEvidenceDigest, "recovery evidence"),
      deviceId: requiredText(request.deviceId, "request device"),
      sessionId: requiredText(request.sessionId, "request session"),
      idempotencyKey: requiredDigest(request.idempotencyKey, "request idempotency key"),
    }),
  };
  if (core.schema !== ACTIVE_PUBLISH_SUCCESSOR_DORMANT_RECOVERY_CLOUD_REQUEST_SCHEMA
    || core.request.mode !== "recovery" || value.requestDigest !== digestValue(core)) {
    throw new Error("Dormant recovery cloud request is not exact.");
  }
  return deepFreeze({ ...core, requestDigest: value.requestDigest });
}

export function recoverActivePublishSuccessorDormantCloudClaim({
  plan,
  sealedRequest,
  invoke = invokeRepositoryCloudAction,
  environment = process.env,
  location = {},
}) {
  const expected = sealActivePublishSuccessorDormantRecoveryCloudRequest(plan, location);
  const sealed = normalizeActivePublishSuccessorDormantRecoveryCloudRequest(sealedRequest);
  if (canonicalJson(sealed) !== canonicalJson(expected)) {
    throw new Error("Dormant recovery request changed after sealing.");
  }
  const result = invoke({
    action: "continue",
    ledgerRepository: sealed.ledgerRepository,
    request: { targetRepository: sealed.targetRepository, ...sealed.request },
    environment,
  });
  return verifyRecoveryResult({ plan, sealed, result });
}

export function verifyActivePublishSuccessorDormantRecoveryCloud({
  plan,
  authority,
  inspect = invokeRepositoryCloudAction,
  environment = process.env,
  location = {},
}) {
  const sealed = sealActivePublishSuccessorDormantRecoveryCloudRequest(plan, location);
  const recovered = normalizeRecoveryAuthority(authority);
  assertRecoveredClaim(planSource(plan).cloud.claim, recovered.claim, sealed);
  const first = readStatus(inspect, sealed, environment);
  const second = readStatus(inspect, sealed, environment);
  assertStableReadback(first, second);
  const claim = exactClaim(second.claims, sealed.request.claimId);
  assertRecoveredClaim(planSource(plan).cloud.claim, claim, sealed);
  if (claim.fenceRevision !== recovered.claim.fenceRevision
    || claim.operationReceiptDigest !== recovered.claim.operationReceiptDigest) {
    throw new Error("Recovered cloud readback changed the exact recovery transition.");
  }
  const cloud = buildCloudEvidence(second, claim, planSource(plan).lease.declaredWriteSet, {
    requiredState: "current",
    ledgerRepository: sealed.ledgerRepository,
    targetRepository: sealed.targetRepository,
  });
  const core = {
    schema: ACTIVE_PUBLISH_SUCCESSOR_DORMANT_RECOVERY_CLOUD_RESULT_SCHEMA,
    planDigest: sealed.planDigest,
    requestDigest: sealed.requestDigest,
    sourceClaimId: sealed.request.claimId,
    sourceTransitionCounter: sealed.request.expectedTransitionCounter,
    targetTransitionCounter: claim.transitionCounter,
    authority: recovered.authority,
    cloud,
    operationReceiptDigest: recovered.operationReceiptDigest,
    providerReceiptDigest: recovered.providerReceiptDigest,
  };
  return deepFreeze({ ...core, resultDigest: digestValue(core) });
}

export function buildActivePublishSuccessorDormantOverlapProof(claims, subject) {
  if (!Array.isArray(claims)) throw new Error("Cloud overlap proof requires a complete claim set.");
  const subjectWriteSet = normalizeWriteSet(subject.declaredWriteScope);
  const competitors = claims.filter(candidate => candidate?.claimId !== subject.claimId
    && candidate?.scopeReserved === true
    && writeSetsOverlap(subjectWriteSet, normalizeWriteSet(candidate.declaredWriteScope)));
  const competingClaimIds = competitors.map(item => requiredDigest(item.claimId, "competitor claim ID"))
    .sort();
  const core = {
    subjectClaimId: requiredDigest(subject.claimId, "overlap subject claim ID"),
    subjectWriteSetDigest: requiredDigest(subject.writeSetDigest, "overlap write-set digest"),
    competingClaimIds: Object.freeze(competingClaimIds),
    noOverlappingCompetitor: competingClaimIds.length === 0,
  };
  if (!core.noOverlappingCompetitor) {
    throw new Error("A live scope-reserved cloud claim overlaps the dormant successor.");
  }
  return deepFreeze({ ...core, overlapProofDigest: digestValue(core) });
}

function verifyRecoveryResult({ plan, sealed, result }) {
  const source = planSource(plan);
  const claim = object(result?.claim, "recovered claim");
  if (result?.schema !== "agentic-cloud-collaboration-result/v1"
    || result.ok !== true || result.action !== "continue" || result.status !== "current"
    || ![true, false].includes(result.replayed)) {
    throw new Error("Cloud dormant recovery returned no exact current result.");
  }
  assertRecoveredClaim(source.cloud.claim, claim, sealed);
  const operation = object(result.operationReceipt, "recovery operation receipt");
  const { receiptDigest: operationReceiptDigest, ...operationCore } = operation;
  if (operation.schema !== "agentic-collaboration-continuation-receipt/v1"
    || operation.operation !== "continue" || operation.status !== "current"
    || operation.claimId !== claim.claimId || operation.claimDigest !== claim.fenceRevision
    || operation.ledgerRevision !== claim.transitionDigest
    || operation.idempotencyKey !== sealed.request.idempotencyKey
    || operation.receiptDigest !== claim.operationReceiptDigest
    || operationReceiptDigest !== digestValue(operationCore)) {
    throw new Error("Dormant recovery operation receipt changed its exact subject.");
  }
  const provider = object(result.receipt, "cloud provider receipt");
  const { receiptDigest: providerReceiptDigest, ...providerCore } = provider;
  if (provider.action !== "continue" || provider.claimId !== claim.claimId
    || provider.claimDigest !== claim.fenceRevision
    || provider.ledgerRevision !== result.ledgerRevision
    || provider.contractReceiptDigest !== operation.receiptDigest
    || providerReceiptDigest !== digestValue(providerCore)) {
    throw new Error("Cloud provider receipt does not join the dormant recovery.");
  }
  const recoveredAt = requiredInstant(operation.evaluationTime, "recovery instant");
  const expiresAt = requiredInstant(claim.expiresAt, "recovered expiry");
  if (Date.parse(expiresAt) !== Date.parse(recoveredAt) + sealed.request.ttlSeconds * 1_000) {
    throw new Error("Recovered cloud expiry changed from the sealed TTL.");
  }
  const ledgerDigest = requiredDigest(
    result.ledgerDigest ?? provider.ledgerDigest,
    "recovered ledger digest",
  );
  const authority = normalizeBoundAuthority({
    result: { ...result, ledgerDigest },
    authority: {
      ledgerRepository: sealed.ledgerRepository,
      targetRepository: sealed.targetRepository,
      deviceId: source.lease.device,
      sessionId: source.lease.sessionId,
    },
    manifest: {
      declaredWriteSet: source.lease.declaredWriteSet,
      writeSetDigest: source.lease.writeSetDigest,
      manifestDigest: source.lease.manifestDigest,
    },
    deviceId: source.lease.device,
    sessionId: source.lease.sessionId,
  });
  const core = {
    schema: ACTIVE_PUBLISH_SUCCESSOR_DORMANT_RECOVERY_CLOUD_RESULT_SCHEMA,
    planDigest: sealed.planDigest,
    requestDigest: sealed.requestDigest,
    authority,
    claim,
    ledgerRevision: requiredSha(result.ledgerRevision, "recovered ledger revision"),
    ledgerDigest,
    recoveredAt,
    expiresAt,
    sourceTransitionCounter: sealed.request.expectedTransitionCounter,
    recoveredTransitionCounter: claim.transitionCounter,
    semanticOperationDigest: sealed.request.recoveryEvidenceDigest,
    idempotencyKey: sealed.request.idempotencyKey,
    operationReceiptDigest: requiredDigest(operation.receiptDigest, "operation receipt"),
    providerReceiptDigest: requiredDigest(provider.receiptDigest, "provider receipt"),
    disposition: result.replayed ? "adopted" : "projected",
    cloudMutation: result.replayed !== true,
  };
  return deepFreeze({ ...core, resultDigest: digestValue(core) });
}

function assertDormantSourceClaim(expected, observed) {
  assertStableClaim(expected, observed);
  if (observed.state !== "dormant-preserved" || observed.writeAuthority !== false
    || observed.scopeReserved !== true
    || observed.transitionCounter !== expected.transitionCounter
    || observed.fenceRevision !== expected.fenceRevision
    || observed.operationReceiptDigest !== expected.operationReceiptDigest) {
    throw new Error("Cloud source is not the sealed dormant successor transition.");
  }
}

function assertRawDormantSubject({ authority, claim, lease, writeSet }) {
  object(authority, "source cloud authority");
  object(lease, "source writer lease");
  const normalizedWriteSet = normalizeWriteSet(
    writeSet ?? lease.admission?.declaredWriteSet,
  );
  const expected = {
    claimId: requiredDigest(authority.claimId, "source claim ID"),
    fenceRevision: requiredDigest(
      authority.claimDigest ?? authority.fenceRevision,
      "source claim digest",
    ),
    transitionCounter: positive(authority.transitionCounter, "source transition counter"),
    operationReceiptDigest: requiredDigest(
      authority.operationReceiptDigest,
      "source operation receipt",
    ),
    canonicalBaseRevision: requiredSha(
      authority.canonicalBaseSha ?? authority.canonicalBaseRevision,
      "source canonical base",
    ),
    laneRevision: requiredSha(authority.laneRevision, "source lane revision"),
    writeSetDigest: requiredDigest(authority.writeSetDigest, "source write-set digest"),
    leaseEpoch: positive(authority.leaseEpoch, "source lease epoch"),
  };
  if (claim.claimId !== expected.claimId || claim.fenceRevision !== expected.fenceRevision
    || claim.transitionCounter !== expected.transitionCounter
    || claim.operationReceiptDigest !== expected.operationReceiptDigest
    || claim.canonicalBaseRevision !== expected.canonicalBaseRevision
    || claim.laneRevision !== expected.laneRevision
    || claim.writeSetDigest !== expected.writeSetDigest
    || claim.leaseEpoch !== expected.leaseEpoch
    || claim.state !== "dormant-preserved" || claim.writeAuthority !== false
    || claim.scopeReserved !== true || lease.baseSha !== claim.canonicalBaseRevision
    || lease.fenceSha !== claim.laneRevision || lease.epoch !== claim.leaseEpoch
    || lease.status !== "active" || lease.admission?.status !== "admitted"
    || lease.admission?.writeSetDigest !== claim.writeSetDigest
    || canonicalJson(normalizedWriteSet)
      !== canonicalJson(normalizeWriteSet(claim.declaredWriteScope))) {
    throw new Error("Raw cloud inspection changed the clean admitted dormant subject.");
  }
}

function assertRecoveredClaim(source, target, sealed) {
  assertStableClaim(source, target);
  if (target.claimId !== sealed.request.claimId || target.state !== "current"
    || target.writeAuthority !== true || target.scopeReserved !== true
    || target.transitionCounter !== source.transitionCounter + 1
    || target.heartbeatCounter !== source.heartbeatCounter
    || target.fenceRevision === source.fenceRevision
    || target.transitionDigest === source.transitionDigest
    || target.operationReceiptDigest === source.operationReceiptDigest) {
    throw new Error("Cloud transition is not a dormant same-claim N-to-N-plus-one recovery.");
  }
}

function assertStableClaim(source, target) {
  const fields = ["claimId", "actorId", "deviceId", "sessionId", "repositoryId",
    "workItemId", "canonicalBaseRevision", "laneRevision", "writeSetDigest",
    "leaseEpoch", "predecessorClaimId", "reviewRequestId"];
  if (fields.some(field => (source[field] ?? null) !== (target[field] ?? null))
    || canonicalJson(normalizeWriteSet(source.declaredWriteScope))
      !== canonicalJson(normalizeWriteSet(target.declaredWriteScope))) {
    throw new Error("Dormant recovery changed stable claim identity.");
  }
}

function buildCloudEvidence(status, claim, writeSet, options = {}) {
  const overlapProof = buildActivePublishSuccessorDormantOverlapProof(status.claims, claim);
  const cloud = projectActivePublishSuccessorDormantCloudEvidence({
    ledgerRepository: requiredRepository(options.ledgerRepository, "cloud ledger repository"),
    targetRepository: requiredRepository(options.targetRepository, "cloud target repository"),
    ledgerRevision: status.ledgerRevision,
    ledgerDigest: status.ledgerDigest,
    ledgerSequence: status.sequence,
    inventoryDigest: status.inventoryDigest ?? digestValue(status.claims),
    verificationReceiptDigest: status.verificationReceiptDigest
      ?? status.receiptDigest ?? digestValue({
        ledgerRevision: status.ledgerRevision,
        ledgerDigest: status.ledgerDigest,
        sequence: status.sequence,
        claims: status.claims,
      }),
    claim,
    overlapProof,
  }, { requiredState: options.requiredState ?? "dormant-preserved" });
  if (canonicalJson(normalizeWriteSet(writeSet))
    !== canonicalJson(cloud.claim.declaredWriteScope)
    || (options.requiredState && cloud.claim.state !== options.requiredState)) {
    throw new Error("Cloud evidence changed the admitted write set or required state.");
  }
  return cloud;
}

function readStatus(inspect, authority, environment) {
  const result = inspect({
    action: "status",
    ledgerRepository: authority.ledgerRepository,
    request: { targetRepository: authority.targetRepository },
    environment,
  });
  if (result?.schema !== "agentic-cloud-collaboration-result/v1"
    || result.ok !== true || result.action !== "status" || result.status !== "ready"
    || !Array.isArray(result.claims) || !SHA.test(String(result.ledgerRevision || ""))
    || !DIGEST.test(String(result.ledgerDigest || ""))
    || !Number.isSafeInteger(result.sequence) || result.sequence < 1) {
    throw new Error("Cloud status did not return a complete live ledger readback.");
  }
  return result;
}

function assertStableReadback(first, second) {
  const projection = value => ({
    ledgerRevision: value.ledgerRevision,
    ledgerDigest: value.ledgerDigest,
    sequence: value.sequence,
    claims: value.claims,
  });
  if (canonicalJson(projection(first)) !== canonicalJson(projection(second))) {
    throw new Error("Cloud ledger changed across the bounded live readback.");
  }
}

function exactClaim(claims, claimId) {
  const matches = claims.filter(claim => claim?.claimId === claimId);
  if (matches.length !== 1) throw new Error("Cloud inventory lacks one exact successor claim.");
  return matches[0];
}

function normalizeRecoveryAuthority(value) {
  object(value, "recovered cloud authority");
  const authority = object(value.authority, "recovered lane cloud authority");
  const claim = object(value.claim, "recovered authority claim");
  if (authority.schema !== "agentic-lane-cloud-authority/v1"
    || authority.claimId !== claim.claimId || authority.claimDigest !== claim.fenceRevision
    || authority.claimLedgerRevision !== claim.transitionDigest
    || authority.transitionCounter !== claim.transitionCounter
    || authority.operationReceiptDigest !== claim.operationReceiptDigest) {
    throw new Error("Recovered lane cloud authority does not join its exact claim.");
  }
  return deepFreeze({
    authority,
    claim,
    operationReceiptDigest: requiredDigest(
      value.operationReceiptDigest,
      "recovered operation receipt",
    ),
    providerReceiptDigest: requiredDigest(
      value.providerReceiptDigest,
      "recovered provider receipt",
    ),
  });
}

function planSource(plan) {
  object(plan, "recovery plan");
  return normalizeActivePublishSuccessorDormantRecoveryEvidence(
    plan.sourceEvidence ?? plan.evidence,
  );
}

function boundedTtl(value) {
  if (!Number.isSafeInteger(value)
    || value < MINIMUM_TTL_SECONDS || value > MAXIMUM_TTL_SECONDS) {
    throw new Error("Dormant recovery TTL must be between 60 and 86400 seconds.");
  }
  return value;
}
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}
function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is invalid.`);
  return value;
}
function requiredRepository(value, label) {
  const result = requiredText(value, label);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(result)) {
    throw new Error(`${label} is invalid.`);
  }
  return result;
}
function requiredDigest(value, label) {
  if (!DIGEST.test(String(value || ""))) throw new Error(`${label} is invalid.`);
  return value;
}
function requiredSha(value, label) {
  if (!SHA.test(String(value || ""))) throw new Error(`${label} is invalid.`);
  return value;
}
function requiredInstant(value, label) {
  if (!value || new Date(value).toISOString() !== value) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}
function positive(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} is invalid.`);
  return value;
}
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
