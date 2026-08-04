import {
  digestValue,
  normalizeWriteSet,
} from "./cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "./github-cloud-collaboration-mapping.mjs";
import { LANE_CLOUD_AUTHORITY_SCHEMA } from "./scoped-lane-admission-lib.mjs";

const RESULT_SCHEMA = "agentic-cloud-collaboration-result/v1";
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

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
    || statusResult.claims.length > 128
  ) {
    throw new Error("Cloud reconciliation requires a complete bounded status result.");
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
  const identityDigest = digestValue({
    actorId: claim.actorId,
    canonicalBaseRevision: claim.canonicalBaseRevision,
    deviceId: pseudonymousIdentifier(
      "device", requiredText(authority.deviceId, "authority deviceId"),
    ),
    leaseEpoch: claim.leaseEpoch,
    repositoryId: claim.repositoryId,
    sessionId: pseudonymousIdentifier(
      "session", requiredText(authority.sessionId, "authority sessionId"),
    ),
    workItemId: claim.workItemId,
    writeSetDigest: claim.writeSetDigest,
  });
  if (
    identityDigest !== claim.claimId
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
    claimLedgerRevision: claim.transitionDigest,
    laneRevision: claim.laneRevision,
    cloudDeclaredWriteScope: claim.declaredWriteScope,
    writeSetDigest: claim.writeSetDigest,
    reviewRequestId: claim.reviewRequestId,
    transitionCounter: claim.transitionCounter,
    state: claim.state,
    expiresAt: claim.expiresAt,
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
  inventoryResult,
  verificationResult,
  authority,
}) {
  if (
    inventoryResult?.schema !== RESULT_SCHEMA
    || inventoryResult.ok !== true
    || inventoryResult.action !== "status"
    || inventoryResult.status !== "ready"
    || !Array.isArray(inventoryResult.claims)
    || inventoryResult.claims.length > 128
  ) {
    throw new Error("Cloud status did not return a complete bounded current-claim inventory.");
  }
  const ledgerRevision = requiredSha(
    inventoryResult.ledgerRevision,
    "inventory ledger revision",
  );
  const ledgerDigest = requiredDigest(
    inventoryResult.ledgerDigest,
    "inventory ledger digest",
  );
  if (
    verificationResult?.ledgerRevision !== ledgerRevision
    || verificationResult.receipt?.ledgerDigest !== ledgerDigest
  ) {
    throw new Error("Cloud status and verification did not observe one ledger revision and digest.");
  }
  const evaluationTime = requiredInstant(
    verificationResult.receipt?.evaluationTime,
    "inventory evaluation time",
  );
  const claims = inventoryResult.claims.map(source => {
    const core = {
      claimId: requiredDigest(source.claimId, "inventory claimId"),
      state: requiredCurrentState(source.state),
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
      || Date.parse(core.expiresAt) <= Date.parse(evaluationTime)
    ) {
      throw new Error(`Cloud inventory claim ${core.claimId} is stale or has an invalid write-set digest.`);
    }
    return Object.freeze({ ...core, recordDigest: digestValue(core) });
  }).sort((left, right) => left.claimId.localeCompare(right.claimId));
  if (new Set(claims.map(claim => claim.claimId)).size !== claims.length) {
    throw new Error("Cloud current-claim inventory contains duplicate claim identities.");
  }
  const candidate = claims.filter(claim => claim.claimId === authority.claimId);
  if (
    candidate.length !== 1
    || candidate[0].fenceRevision !== verificationResult.claimDigest
    || candidate[0].transitionDigest !== verificationResult.claim.transitionDigest
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

function normalizeClaim(source) {
  const claim = {
    claimId: requiredDigest(source.claimId, "claimId"),
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
  };
  return Object.freeze(claim);
}

function requireAuthority(value) {
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

function requiredText(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function requiredSha(value, label) {
  const normalized = requiredText(value, label);
  if (!SHA_PATTERN.test(normalized)) throw new Error(`${label} must be a Git SHA.`);
  return normalized;
}

function requiredDigest(value, label) {
  const normalized = requiredText(value, label);
  if (!DIGEST_PATTERN.test(normalized)) throw new Error(`${label} must be a SHA-256 digest.`);
  return normalized;
}

function requiredInstant(value, label) {
  const normalized = requiredText(value, label);
  const milliseconds = Date.parse(normalized);
  if (!Number.isFinite(milliseconds)) throw new Error(`${label} must be an ISO instant.`);
  return new Date(milliseconds).toISOString();
}

function positiveInteger(value, label) {
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

function requiredState(value) {
  const state = requiredText(value, "claim state").replaceAll("-", "_");
  if (!["active", "review_ready", "delivery_authorized"].includes(state)) {
    throw new Error(`Cloud reconciliation cannot recover claim state ${state}.`);
  }
  return state;
}

function requiredCurrentState(value) {
  const state = requiredText(value, "inventory state").replaceAll("-", "_");
  if (!["active", "review_ready", "delivery_authorized", "parked"].includes(state)) {
    throw new Error(`Cloud inventory claim state ${state} is not current.`);
  }
  return state;
}
