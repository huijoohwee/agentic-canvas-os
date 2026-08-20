import {
  digestValue,
  normalizeWriteSet,
} from "./cloud-collaboration-primitives.mjs";
import { CURRENT_CLAIM_INVENTORY_SCHEMA } from "./github-cloud-collaboration-mapping.mjs";
import {
  LANE_CLOUD_AUTHORITY_SCHEMA,
  normalizeCloudAuthority,
} from "./scoped-lane-admission-lib.mjs";
import {
  claimProvenanceMatches,
  normalizeClaimProvenance,
} from "./scoped-lane-claim-provenance.mjs";
import {
  projectRootState,
  rootStateForProjection,
} from "./cloud-collaboration-state-projection.mjs";

export { projectRootState, rootStateForProjection };

const RESULT_SCHEMA = "agentic-cloud-collaboration-result/v1";
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

export function attachCloudHeartbeatMachineEvidence(response, { lease, result } = {}) {
  if (!result?.mutationAuthorityReceipt) return response;
  if (!lease?.admission || !lease.cloudAuthority) {
    throw new Error("Cloud heartbeat lost its joined admission projection.");
  }
  response.admission = lease.admission;
  response.cloudAuthority = lease.cloudAuthority;
  response.mutationAuthorityReceipt = result.mutationAuthorityReceipt;
  return response;
}

export function cloudAuthorityFromResult(source, options) {
  const direct = source?.schema === RESULT_SCHEMA;
  const result = direct ? source : source?.result;
  const projectedResult = result ? {
    ...result,
    claim: result.claim ? { ...result.claim, state: projectRootState(result.claim.state) } : result.claim,
  } : result;
  return normalizeCloudAuthority(direct
    ? projectedResult
    : { ...source, result: projectedResult }, options);
}

export function reconcileCloudAuthorityProjection({
  authority,
  manifest,
  statusResult,
  branch,
  headSha,
  pullRequestNumber,
  allowPriorLaneRevision = false,
  now = new Date(),
} = {}) {
  requireAuthority(authority);
  requireManifest(manifest);
  if (
    statusResult?.schema !== RESULT_SCHEMA
    || statusResult.ok !== true
    || statusResult.action !== "status"
    || statusResult.status !== "ready"
    || !Array.isArray(statusResult.claims)
  ) {
    throw new Error("Cloud reconciliation requires a complete status result.");
  }
  const matches = statusResult.claims.filter(
    claim => claim?.claimId === authority.claimId,
  );
  if (matches.length !== 1) {
    throw new Error("Cloud reconciliation requires exactly one live candidate claim.");
  }
  const claim = normalizeClaim(matches[0]);
  const normalizedHead = requiredSha(headSha, "reconciliation headSha");
  const expectedWriteSet = normalizeWriteSet(manifest.declaredWriteSet);
  const priorLaneAllowed = (
    allowPriorLaneRevision
    && claim.state === "active"
    && claim.laneRevision === authority.laneRevision
  );
  const unchangedTransitionDrift = (
    claim.transitionCounter === authority.transitionCounter
    && (
      claim.fenceRevision !== authority.claimDigest
      || claim.transitionDigest !== authority.claimLedgerRevision
      || claim.laneRevision !== authority.laneRevision
      || claim.state !== authority.state
      || claim.expiresAt !== authority.expiresAt
      || claim.reviewRequestId !== authority.reviewRequestId
    )
  );
  if (
    !claimProvenanceMatches(claim, authority, {
      ignoreOperationReceiptDigest: true,
    })
    || claim.canonicalBaseRevision !== authority.canonicalBaseSha
    || claim.writeSetDigest !== manifest.writeSetDigest
    || claim.writeSetDigest !== digestValue(claim.declaredWriteScope)
    || JSON.stringify(claim.declaredWriteScope) !== JSON.stringify(expectedWriteSet)
    || claim.leaseEpoch !== authority.leaseEpoch
    || claim.transitionCounter < authority.transitionCounter
    || unchangedTransitionDrift
    || (!priorLaneAllowed && claim.laneRevision !== normalizedHead)
    || Date.parse(claim.expiresAt) <= now.getTime()
    || (["review_ready", "delivery_authorized"].includes(claim.state) && !claim.reviewRequestId)
  ) {
    throw new Error("Live cloud claim drifted from the recoverable admission subject.");
  }
  const focusedEvidenceDigest = ["review_ready", "delivery_authorized"].includes(claim.state)
    ? pullRequestNumber
      ? digestValue({
        schema: "agentic-focused-review-evidence/v1",
        command: "npm run check",
        branch: requiredText(branch, "branch"),
        headSha: normalizedHead,
        pullRequestNumber: positiveInteger(
          pullRequestNumber,
          "pullRequestNumber",
        ),
        admittedReportDigest: requiredDigest(
          manifest.admittedReportDigest,
          "admittedReportDigest",
        ),
      })
      : requiredDigest(
        authority.focusedEvidenceDigest,
        "authority focusedEvidenceDigest",
      )
    : null;
  const projection = Object.freeze({
    ...authority,
    claimDigest: claim.fenceRevision,
    ledgerRevision: requiredSha(
      statusResult.ledgerRevision,
      "status ledgerRevision",
    ),
    ledgerDigest: requiredDigest(statusResult.ledgerDigest, "status ledgerDigest"),
    claimLedgerRevision: claim.transitionDigest,
    entrySchema: claim.entrySchema,
    claimIdentitySchema: claim.claimIdentitySchema,
    operationReceiptDigest: claim.operationReceiptDigest,
    mutationAuthorityEligible: claim.mutationAuthorityEligible,
    laneRevision: claim.laneRevision,
    cloudDeclaredWriteScope: claim.declaredWriteScope,
    writeSetDigest: claim.writeSetDigest,
    reviewRequestId: claim.reviewRequestId,
    transitionCounter: claim.transitionCounter,
    state: claim.state,
    expiresAt: claim.expiresAt,
    integrationReceiptDigest: claim.integrationReceiptDigest,
    integration: claim.integration,
    ...(focusedEvidenceDigest ? { focusedEvidenceDigest } : {}),
  });
  return Object.freeze({
    authority: projection,
    focusedEvidenceDigest,
    ledgerDigest: requiredDigest(
      statusResult.ledgerDigest,
      "status ledgerDigest",
    ),
  });
}

export function normalizeCurrentClaimInventory({
  verificationResult,
  authority,
}) {
  const source = verificationResult?.currentClaimInventory;
  if (
    verificationResult?.schema !== RESULT_SCHEMA
    || verificationResult.ok !== true
    || verificationResult.action !== "verify"
    || verificationResult.status !== "ready"
    || source?.schema !== CURRENT_CLAIM_INVENTORY_SCHEMA
    || !hasExactKeys(source, [
      "claimInventoryDigest",
      "claims",
      "evaluationTime",
      "ledgerDigest",
      "ledgerRevision",
      "schema",
    ])
    || !Array.isArray(source.claims)
    || source.claims.length > 128
  ) {
    throw new Error("Cloud verification did not return one complete bounded current-claim inventory.");
  }
  const ledgerRevision = requiredSha(
    source.ledgerRevision,
    "inventory ledger revision",
  );
  const ledgerDigest = requiredDigest(
    source.ledgerDigest,
    "inventory ledger digest",
  );
  const evaluationTime = requiredInstant(
    source.evaluationTime,
    "inventory evaluation time",
  );
  const claimInventoryDigest = requiredDigest(
    source.claimInventoryDigest,
    "current-claim inventory digest",
  );
  const receipt = normalizeVerificationReceipt(verificationResult.receipt);
  const sealedInventory = {
    schema: CURRENT_CLAIM_INVENTORY_SCHEMA,
    ledgerRevision,
    ledgerDigest,
    evaluationTime,
    claims: source.claims,
  };
  if (
    verificationResult?.ledgerRevision !== ledgerRevision
    || receipt.ledgerRevision !== ledgerRevision
    || receipt.ledgerDigest !== ledgerDigest
    || receipt.evaluationTime !== evaluationTime
    || receipt.claimInventoryDigest !== claimInventoryDigest
    || receipt.claimId !== authority.claimId
    || receipt.claimDigest !== verificationResult.claimDigest
    || digestValue(sealedInventory) !== claimInventoryDigest
  ) {
    throw new Error("Cloud verification current-claim inventory seal or observation metadata drifted.");
  }
  const claims = source.claims.map(claim => normalizeInventoryClaim(claim, evaluationTime))
    .sort((left, right) => left.claimId.localeCompare(right.claimId));
  if (new Set(claims.map(claim => claim.claimId)).size !== claims.length) {
    throw new Error("Cloud current-claim inventory contains duplicate claim identities.");
  }
  const sourceCandidate = source.claims.filter(claim => claim?.claimId === authority.claimId);
  const candidate = claims.filter(claim => claim.claimId === authority.claimId);
  const verifiedCandidate = normalizeInventoryClaim(
    verificationResult.claim,
    evaluationTime,
  );
  if (
    sourceCandidate.length !== 1
    || candidate.length !== 1
    || candidate[0].fenceRevision !== verificationResult.claimDigest
    || candidate[0].recordDigest !== verifiedCandidate.recordDigest
    || digestValue(sourceCandidate[0]) !== digestValue(verificationResult.claim)
  ) {
    throw new Error("Cloud current-claim inventory does not contain the exact verified candidate claim.");
  }
  const inventory = {
    schema: "agentic-cloud-claim-inventory/v1",
    observedLedgerHeadRevision: ledgerRevision,
    ledgerDigest,
    evaluationTime,
    claims,
  };
  return Object.freeze({ ...inventory, inventoryDigest: digestValue(inventory) });
}

function normalizeVerificationReceipt(value) {
  if (!hasExactKeys(value, [
    "claimDigest",
    "claimId",
    "claimInventoryDigest",
    "contractReceiptDigest",
    "evaluationTime",
    "findings",
    "ledgerDigest",
    "ledgerRevision",
    "ok",
    "receiptDigest",
    "schema",
  ]) || value.ok !== true || !Array.isArray(value.findings)) {
    throw new Error("Cloud verification receipt is incomplete or malformed.");
  }
  const core = {
    schema: requiredText(value.schema, "verification receipt schema"),
    ok: value.ok,
    ledgerRevision: requiredSha(value.ledgerRevision, "verification receipt ledger revision"),
    ledgerDigest: requiredDigest(value.ledgerDigest, "verification receipt ledger digest"),
    claimId: requiredDigest(value.claimId, "verification receipt claim ID"),
    claimDigest: requiredDigest(value.claimDigest, "verification receipt claim digest"),
    contractReceiptDigest: requiredDigest(
      value.contractReceiptDigest,
      "verification contract receipt digest",
    ),
    claimInventoryDigest: requiredDigest(
      value.claimInventoryDigest,
      "verification claim inventory digest",
    ),
    evaluationTime: requiredInstant(value.evaluationTime, "verification receipt time"),
    findings: value.findings,
  };
  if (core.schema !== "agentic-cloud-collaboration-github-verification/v1"
    || value.receiptDigest !== digestValue(core)) {
    throw new Error("Cloud verification receipt seal drifted.");
  }
  return Object.freeze({ ...core, receiptDigest: value.receiptDigest });
}

function normalizeInventoryClaim(source, evaluationTime) {
  const provenance = normalizeClaimProvenance(source, "inventory claim");
  const state = requiredCurrentState(source.state);
  const expectedAuthority = {
    active: { writeAuthority: true, scopeReserved: true },
    "waiting-successor": { writeAuthority: false, scopeReserved: false },
    review_ready: { writeAuthority: false, scopeReserved: true },
    delivery_authorized: { writeAuthority: false, scopeReserved: true },
    parked: { writeAuthority: false, scopeReserved: true },
  }[state];
  const core = {
    claimId: requiredDigest(source.claimId, "inventory claimId"),
    ...provenance,
    state,
    writeAuthority: source.writeAuthority === undefined
      ? expectedAuthority.writeAuthority
      : requiredBoolean(source.writeAuthority, "inventory writeAuthority"),
    scopeReserved: source.scopeReserved === undefined
      ? expectedAuthority.scopeReserved
      : requiredBoolean(source.scopeReserved, "inventory scopeReserved"),
    actorId: requiredText(source.actorId, "inventory actorId"),
    repositoryId: requiredText(source.repositoryId, "inventory repositoryId"),
    workItemId: requiredText(source.workItemId, "inventory workItemId"),
    canonicalBaseRevision: requiredSha(
      source.canonicalBaseRevision,
      "inventory canonicalBaseRevision",
    ),
    laneRevision: requiredSha(source.laneRevision, "inventory laneRevision"),
    declaredWriteScope: normalizeWriteSet(source.declaredWriteScope),
    writeSetDigest: requiredDigest(
      source.writeSetDigest,
      "inventory writeSetDigest",
    ),
    leaseEpoch: positiveInteger(source.leaseEpoch, "inventory leaseEpoch"),
    transitionCounter: positiveInteger(
      source.transitionCounter,
      "inventory transitionCounter",
    ),
    heartbeatCounter: nonnegativeInteger(
      source.heartbeatCounter,
      "inventory heartbeatCounter",
    ),
    reviewRequestId: source.reviewRequestId
      ? requiredText(source.reviewRequestId, "inventory reviewRequestId")
      : null,
    expiresAt: requiredInstant(source.expiresAt, "inventory expiresAt"),
    fenceRevision: requiredDigest(
      source.fenceRevision,
      "inventory fenceRevision",
    ),
    transitionDigest: requiredDigest(
      source.transitionDigest,
      "inventory transitionDigest",
    ),
  };
  if (
    digestValue(core.declaredWriteScope) !== core.writeSetDigest
    || core.writeAuthority !== expectedAuthority.writeAuthority
    || core.scopeReserved !== expectedAuthority.scopeReserved
    || (!["parked", "waiting-successor"].includes(core.state)
      && Date.parse(core.expiresAt) <= Date.parse(evaluationTime))
  ) {
    throw new Error(`Cloud inventory claim ${core.claimId} is stale or has an invalid write-set digest.`);
  }
  return Object.freeze({ ...core, recordDigest: digestValue(core) });
}

function hasExactKeys(value, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

export function normalizeBoundAuthority({
  result, authority, manifest,
  deviceId = authority.deviceId,
  sessionId = authority.sessionId,
  focusedEvidenceDigest = authority.focusedEvidenceDigest || null,
}) {
  return Object.freeze({
    schema: LANE_CLOUD_AUTHORITY_SCHEMA,
    provider: "github",
    ledgerRepository: authority.ledgerRepository,
    targetRepository: authority.targetRepository,
    claimId: requiredDigest(result.claim.claimId, "claimId"),
    claimDigest: requiredDigest(result.claimDigest, "claimDigest"),
    ledgerRevision: requiredSha(result.ledgerRevision, "ledgerRevision"),
    ledgerDigest: requiredDigest(result.ledgerDigest, "ledgerDigest"),
    claimLedgerRevision: requiredDigest(result.claim.transitionDigest, "claimLedgerRevision"),
    ...normalizeClaimProvenance(result.claim),
    canonicalBaseSha: requiredSha(result.claim.canonicalBaseRevision, "canonicalBaseRevision"),
    laneRevision: requiredSha(result.claim.laneRevision, "laneRevision"),
    cloudDeclaredWriteScope: normalizeWriteSet(result.claim.declaredWriteScope),
    writeSetDigest: requiredDigest(result.claim.writeSetDigest, "writeSetDigest"),
    deviceId: requiredText(deviceId, "deviceId"),
    sessionId: requiredText(sessionId, "sessionId"),
    reviewRequestId: result.claim.reviewRequestId
      ? requiredText(result.claim.reviewRequestId, "reviewRequestId")
      : null,
    leaseEpoch: positiveInteger(result.claim.leaseEpoch, "leaseEpoch"),
    transitionCounter: positiveInteger(result.claim.transitionCounter, "transitionCounter"),
    state: projectRootState(result.claim.state),
    expiresAt: requiredInstant(result.claim.expiresAt, "expiresAt"),
    operationReceiptDigest: requiredDigest(result.claim.operationReceiptDigest, "operationReceiptDigest"),
    integrationReceiptDigest: result.claim.integrationReceiptDigest
      ? requiredDigest(result.claim.integrationReceiptDigest, "integrationReceiptDigest")
      : null,
    integration: normalizeIntegrationEvidence(result.claim.integration),
    ...(focusedEvidenceDigest ? {
      focusedEvidenceDigest: requiredDigest(focusedEvidenceDigest, "focusedEvidenceDigest"),
    } : {}),
    manifestDigest: manifest.manifestDigest || digestValue({
      declaredWriteSet: manifest.declaredWriteSet,
      writeSetDigest: manifest.writeSetDigest,
    }),
  });
}

export function requireReadyResult(result, {
  authority, manifest, canonicalBaseSha, expectedState,
  expectedLaneRevision = authority.laneRevision,
}) {
  if (!result || result.schema !== RESULT_SCHEMA || result.ok !== true
    || !["verify", "continue", "integrate"].includes(result.action)) {
    throw new Error("Cloud collaboration did not return a successful authoritative result.");
  }
  const claim = result.claim;
  if (claim?.claimId !== authority.claimId
    || claim.canonicalBaseRevision !== canonicalBaseSha
    || claim.laneRevision !== expectedLaneRevision
    || projectRootState(claim.state) !== expectedState
    || claim.writeSetDigest !== manifest.writeSetDigest
    || JSON.stringify(normalizeWriteSet(claim.declaredWriteScope)) !== JSON.stringify(manifest.declaredWriteSet)
    || !Array.isArray(result.findings || [])
    || (result.findings || []).length > 0) {
    throw new Error("Cloud collaboration result drifted from the scoped admission subject.");
  }
  requiredSha(result.ledgerRevision, "ledgerRevision");
  requiredDigest(result.claimDigest, "claimDigest");
  if (Date.parse(claim.expiresAt) <= Date.now()) {
    throw new Error(`Cloud collaboration claim expired at ${claim.expiresAt}.`);
  }
}

function normalizeClaim(source) {
  const claim = {
    claimId: requiredDigest(source.claimId, "claimId"),
    ...normalizeClaimProvenance(source),
    state: requiredState(source.state),
    actorId: requiredText(source.actorId, "actorId"),
    repositoryId: requiredText(source.repositoryId, "repositoryId"),
    workItemId: requiredText(source.workItemId, "workItemId"),
    canonicalBaseRevision: requiredSha(
      source.canonicalBaseRevision,
      "canonicalBaseRevision",
    ),
    laneRevision: requiredSha(source.laneRevision, "laneRevision"),
    declaredWriteScope: normalizeWriteSet(source.declaredWriteScope),
    writeSetDigest: requiredDigest(source.writeSetDigest, "writeSetDigest"),
    leaseEpoch: positiveInteger(source.leaseEpoch, "leaseEpoch"),
    transitionCounter: positiveInteger(
      source.transitionCounter,
      "transitionCounter",
    ),
    reviewRequestId: source.reviewRequestId
      ? requiredText(source.reviewRequestId, "reviewRequestId")
      : null,
    expiresAt: requiredInstant(source.expiresAt, "expiresAt"),
    fenceRevision: requiredDigest(source.fenceRevision, "fenceRevision"),
    transitionDigest: requiredDigest(
      source.transitionDigest,
      "transitionDigest",
    ),
    integrationReceiptDigest: source.integrationReceiptDigest
      ? requiredDigest(source.integrationReceiptDigest, "integrationReceiptDigest")
      : null,
    integration: normalizeIntegrationEvidence(source.integration),
  };
  return Object.freeze(claim);
}

function normalizeIntegrationEvidence(value) {
  if (value === undefined || value === null) return null;
  const normalized = {
    candidateRevision: requiredSha(value.candidateRevision, "integration candidateRevision"),
    reviewRequestId: requiredText(value.reviewRequestId, "integration reviewRequestId"),
    focusedEvidenceDigest: requiredDigest(value.focusedEvidenceDigest, "integration focusedEvidenceDigest"),
    dependencyClosureDigest: requiredDigest(value.dependencyClosureDigest, "integration dependencyClosureDigest"),
    namedChecksDigest: requiredDigest(value.namedChecksDigest, "integration namedChecksDigest"),
    handoffEvidenceDigest: requiredDigest(value.handoffEvidenceDigest, "integration handoffEvidenceDigest"),
    operatorDecisionDigest: requiredDigest(value.operatorDecisionDigest, "integration operatorDecisionDigest"),
    integrationIntentDigest: requiredDigest(value.integrationIntentDigest, "integration integrationIntentDigest"),
    integratedAt: requiredInstant(value.integratedAt, "integration integratedAt"),
  };
  if (Object.keys(value).length !== Object.keys(normalized).length) {
    throw new Error("Integration evidence contains unsupported fields.");
  }
  return Object.freeze(normalized);
}

export function requireAuthority(value) {
  if (!value || value.schema !== LANE_CLOUD_AUTHORITY_SCHEMA) {
    throw new Error("A normalized lane cloud authority projection is required.");
  }
}

function requireManifest(value) {
  if (
    !value
    || !Array.isArray(value.declaredWriteSet)
    || !DIGEST_PATTERN.test(String(value.writeSetDigest || ""))
  ) {
    throw new Error("Cloud reconciliation requires the admitted write-set manifest.");
  }
}

export function requiredText(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

export function requiredSha(value, label) {
  const normalized = requiredText(value, label);
  if (!SHA_PATTERN.test(normalized)) throw new Error(`${label} must be a Git SHA.`);
  return normalized;
}

export function requiredDigest(value, label) {
  const normalized = requiredText(value, label);
  if (!DIGEST_PATTERN.test(normalized)) throw new Error(`${label} must be a SHA-256 digest.`);
  return normalized;
}

export function requiredInstant(value, label) {
  const normalized = requiredText(value, label);
  const milliseconds = Date.parse(normalized);
  if (!Number.isFinite(milliseconds)) throw new Error(`${label} must be an ISO instant.`);
  return new Date(milliseconds).toISOString();
}

export function positiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return normalized;
}

function nonnegativeInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 0) {
    throw new Error(`${label} must be a nonnegative integer.`);
  }
  return normalized;
}

function requiredBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean.`);
  }
  return value;
}

function requiredState(value) {
  const state = requiredText(value, "claim state").replaceAll("-", "_");
  const projected = {
    active: "active",
    current: "active",
    review_ready: "review_ready",
    reviewed: "review_ready",
    delivery_authorized: "delivery_authorized",
    integrated_preserved: "delivery_authorized",
    parked: "parked",
    dormant_preserved: "parked",
  }[state];
  if (!projected || projected === "parked") {
    throw new Error(`Cloud reconciliation cannot recover claim state ${state}.`);
  }
  return projected;
}

function requiredCurrentState(value) {
  const state = requiredText(value, "inventory state").replaceAll("-", "_");
  const projected = {
    active: "active",
    current: "active",
    waiting_successor: "waiting-successor",
    review_ready: "review_ready",
    reviewed: "review_ready",
    delivery_authorized: "delivery_authorized",
    integrated_preserved: "delivery_authorized",
    parked: "parked",
    dormant_preserved: "parked",
  }[state];
  if (!projected) {
    throw new Error(`Cloud inventory claim state ${state} is not current.`);
  }
  return projected;
}
