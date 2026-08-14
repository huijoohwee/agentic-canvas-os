import { digestValue, normalizeWriteSet, writeSetsOverlap } from "./cloud-collaboration-primitives.mjs";

export const LEGACY_LANE_PRESERVATION_RECEIPT_SCHEMA =
  "agentic-legacy-lane-preservation-receipt/v1";
export const LEGACY_AUTHORITY_RETIREMENT_RECEIPT_SCHEMA =
  "agentic-legacy-authority-retirement-receipt/v1";
export const LEGACY_AUTHORITY_EVALUATION_RESULT_SCHEMA =
  "agentic-legacy-authority-evaluation-result/v1";

const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

export function createLegacyReviewAdapter({ adapterId, readReviewState }) {
  const normalizedAdapterId = requireText(adapterId, "adapterId");
  if (typeof readReviewState !== "function") {
    throw new Error("Legacy review adapter must provide readReviewState.");
  }
  return Object.freeze({
    adapterId: normalizedAdapterId,
    async observe(authority) {
      const observed = await readReviewState({
        reviewRequestId: authority.reviewRequestId,
        branchId: authority.branchId,
        laneRevision: authority.laneRevision,
      });
      return normalizeReviewObservation(observed);
    },
  });
}

export function createLegacyLanePreservationReceipt({
  authority,
  successorAuthority = null,
  captureAdapterId,
  capturedAt,
}) {
  const legacy = normalizeAuthority(authority, "legacy authority");
  const successor = successorAuthority
    ? normalizeSuccessorAuthority(successorAuthority, "successor authority")
    : null;
  const overlapClass = classifyOverlap(
    legacy.declaredWriteSet,
    successor?.declaredWriteSet ?? null,
  );
  requireText(captureAdapterId, "captureAdapterId");
  requireInstant(capturedAt, "capturedAt");
  return receipt({
    schema: LEGACY_LANE_PRESERVATION_RECEIPT_SCHEMA,
    status: "retained-legacy",
    claimId: legacy.claimId,
    claimDigest: legacy.claimDigest,
    scopeId: legacy.scopeId,
    branchId: legacy.branchId,
    laneRevision: legacy.laneRevision,
    fenceRevision: legacy.fenceRevision,
    reviewRequestId: legacy.reviewRequestId,
    declaredWriteSet: legacy.declaredWriteSet,
    writeSetDigest: legacy.writeSetDigest,
    stateDigest: legacy.stateDigest,
    overlapClass,
    successorScopeId: successor?.scopeId ?? null,
    successorWriteSetDigest: successor?.writeSetDigest ?? null,
    captureAdapterId,
    capturedAt,
  });
}

export function createLegacyAuthorityRetirementReceipt(preservationReceipt, {
  authority,
  reviewObservation,
  authorizationSelectionDigest,
  reviewAdapterId,
  retiredAt,
}) {
  const preservation = validateLegacyLanePreservationReceipt(
    preservationReceipt,
  );
  const legacy = normalizeAuthority(authority, "legacy authority");
  const observation = normalizeReviewObservation(reviewObservation);
  requireDigest(
    authorizationSelectionDigest,
    "authorizationSelectionDigest",
  );
  requireText(reviewAdapterId, "reviewAdapterId");
  requireInstant(retiredAt, "retiredAt");
  if (Date.parse(retiredAt) < Date.parse(preservation.capturedAt)) {
    throw new Error("Legacy authority retirement cannot predate preservation.");
  }
  if (Date.parse(retiredAt) < Date.parse(observation.observedAt)) {
    throw new Error("Legacy authority retirement cannot predate review observation.");
  }
  requireLegacyAuthorityMatchesPreservation(legacy, preservation);
  requireReviewObservationMatchesAuthority(observation, legacy);
  if (!legacy.reviewRequestId) {
    throw new Error("Legacy authority retirement requires a reviewRequestId.");
  }
  return receipt({
    schema: LEGACY_AUTHORITY_RETIREMENT_RECEIPT_SCHEMA,
    status: "retired-preserved",
    legacyLanePreservationReceiptDigest: preservation.receiptDigest,
    claimId: legacy.claimId,
    claimDigest: legacy.claimDigest,
    scopeId: legacy.scopeId,
    branchId: legacy.branchId,
    laneRevision: legacy.laneRevision,
    fenceRevision: legacy.fenceRevision,
    reviewRequestId: legacy.reviewRequestId,
    stateDigest: legacy.stateDigest,
    overlapClass: preservation.overlapClass,
    successorScopeId: preservation.successorScopeId,
    successorWriteSetDigest: preservation.successorWriteSetDigest,
    authorizationSelectionDigest,
    reviewAdapterId,
    reviewObservationDigest: digestValue(observation),
    retiredAt,
  });
}

export async function evaluateLegacyAuthority(input, { reviewAdapter = null } = {}) {
  const request = normalizeEvaluationRequest(input);
  const blockingFindings = validateAuthorityDrift(
    request.expectedAuthority,
    request.observedAuthority,
  );
  if (
    request.authorization.expectedOverlapClass
    && request.authorization.expectedOverlapClass !== request.overlapClass
  ) {
    blockingFindings.push(finding(
      "overlap-class-drift",
      `Authorization expected overlap ${request.authorization.expectedOverlapClass}, received ${request.overlapClass}.`,
    ));
  }

  let preservationReceipt = null;
  let retirementReceipt = null;

  if (request.authorization.selection === "retain") {
    if (blockingFindings.length === 0) {
      preservationReceipt = createLegacyLanePreservationReceipt({
        authority: request.expectedAuthority,
        successorAuthority: request.successorAuthority,
        captureAdapterId: request.captureAdapterId,
        capturedAt: request.authorization.selectedAt,
      });
    }
  } else {
    if (!request.preservationReceipt) {
      blockingFindings.push(finding(
        "missing-preservation-receipt",
        "Retiring legacy authority requires an exact Legacy Lane Preservation Receipt.",
      ));
    }
    if (!request.expectedAuthority.reviewRequestId) {
      blockingFindings.push(finding(
        "missing-review-request",
        "Retiring legacy authority requires an exact reviewRequestId.",
      ));
    }
    if (!reviewAdapter?.observe || !reviewAdapter?.adapterId) {
      blockingFindings.push(finding(
        "missing-review-adapter",
        "Retiring legacy authority requires a replaceable review adapter.",
      ));
    }
    if (request.preservationReceipt) {
      try {
        requireLegacyAuthorityMatchesPreservation(
          request.expectedAuthority,
          validateLegacyLanePreservationReceipt(request.preservationReceipt),
        );
        preservationReceipt = request.preservationReceipt;
      } catch (error) {
        blockingFindings.push(finding(
          "preservation-receipt-drift",
          error.message,
        ));
      }
    }
    if (blockingFindings.length === 0) {
      try {
        const reviewObservation = await reviewAdapter.observe(
          request.expectedAuthority,
        );
        retirementReceipt = createLegacyAuthorityRetirementReceipt(
          preservationReceipt,
          {
            authority: request.expectedAuthority,
            reviewObservation,
            authorizationSelectionDigest: request.authorizationSelectionDigest,
            reviewAdapterId: reviewAdapter.adapterId,
            retiredAt: request.authorization.selectedAt,
          },
        );
      } catch (error) {
        blockingFindings.push(finding(
          "review-observation-drift",
          error.message,
        ));
      }
    }
  }

  const status = blockingFindings.length > 0
    ? "blocked"
    : request.authorization.selection === "retain"
      ? "retained-legacy"
      : "retired-preserved";
  const result = Object.freeze({
    schema: LEGACY_AUTHORITY_EVALUATION_RESULT_SCHEMA,
    status,
    transition: request.authorization.selection,
    replayed: false,
    idempotencyKeyDigest: request.idempotencyKeyDigest,
    requestDigest: request.requestDigest,
    overlapClass: request.overlapClass,
    blockingFindings: Object.freeze(blockingFindings.sort(compareFindings)),
    legacyLanePreservationReceipt: preservationReceipt,
    legacyAuthorityRetirementReceipt: retirementReceipt,
  });
  return replayExactResult(request.replay, result);
}

function normalizeEvaluationRequest(input) {
  requireObject(input, "Legacy authority evaluation input");
  const expectedAuthority = normalizeAuthority(
    input.expectedAuthority,
    "expectedAuthority",
  );
  const observedAuthority = normalizeAuthority(
    input.observedAuthority,
    "observedAuthority",
  );
  const successorAuthority = input.successorAuthority == null
    ? null
    : normalizeSuccessorAuthority(input.successorAuthority, "successorAuthority");
  const authorization = normalizeAuthorization(input.authorization);
  const overlapClass = classifyOverlap(
    expectedAuthority.declaredWriteSet,
    successorAuthority?.declaredWriteSet ?? null,
  );
  const captureAdapterId = requireText(
    input.captureAdapterId ?? "adapter:legacy-authority-evaluator",
    "captureAdapterId",
  );
  const idempotencyKeyDigest = digestValue(authorization.idempotencyKey);
  const authorizationSelectionDigest = digestValue({
    selection: authorization.selection,
    selectedBy: authorization.selectedBy,
    selectedAt: authorization.selectedAt,
    expectedOverlapClass: authorization.expectedOverlapClass,
    idempotencyKeyDigest,
  });
  return Object.freeze({
    expectedAuthority,
    observedAuthority,
    successorAuthority,
    authorization,
    authorizationSelectionDigest,
    idempotencyKeyDigest,
    overlapClass,
    captureAdapterId,
    preservationReceipt: input.preservationReceipt ?? null,
    replay: input.replay ?? null,
    requestDigest: digestValue({
      expectedAuthority,
      observedAuthority,
      successorAuthority,
      authorizationSelectionDigest,
      preservationReceiptDigest: input.preservationReceipt?.receiptDigest ?? null,
      captureAdapterId,
    }),
  });
}

function validateAuthorityDrift(expectedAuthority, observedAuthority) {
  const findings = [];
  for (const [field, code] of [
    ["claimId", "claim-drift"],
    ["claimDigest", "claim-digest-drift"],
    ["scopeId", "scope-drift"],
    ["branchId", "branch-drift"],
    ["laneRevision", "lane-revision-drift"],
    ["fenceRevision", "fence-drift"],
    ["reviewRequestId", "review-request-drift"],
    ["writeSetDigest", "write-set-drift"],
    ["stateDigest", "state-digest-drift"],
  ]) {
    if (expectedAuthority[field] !== observedAuthority[field]) {
      findings.push(finding(
        code,
        `Observed ${field} drifted from the expected legacy authority.`,
      ));
    }
  }
  if (
    JSON.stringify(expectedAuthority.declaredWriteSet)
    !== JSON.stringify(observedAuthority.declaredWriteSet)
  ) {
    findings.push(finding(
      "declared-write-set-drift",
      "Observed declared write set drifted from the expected legacy authority.",
    ));
  }
  return findings;
}

function requireLegacyAuthorityMatchesPreservation(authority, preservation) {
  for (const field of [
    "claimId",
    "claimDigest",
    "scopeId",
    "branchId",
    "laneRevision",
    "fenceRevision",
    "reviewRequestId",
    "writeSetDigest",
    "stateDigest",
  ]) {
    if (authority[field] !== preservation[field]) {
      throw new Error(
        `Legacy preservation receipt drifted from ${field}.`,
      );
    }
  }
  if (
    JSON.stringify(authority.declaredWriteSet)
    !== JSON.stringify(preservation.declaredWriteSet)
  ) {
    throw new Error(
      "Legacy preservation receipt drifted from the declared write set.",
    );
  }
}

function requireReviewObservationMatchesAuthority(observation, authority) {
  if (!authority.reviewRequestId) {
    throw new Error("Legacy authority lacks a reviewRequestId.");
  }
  for (const field of ["reviewRequestId", "branchId", "laneRevision"]) {
    const expected = field === "reviewRequestId"
      ? authority.reviewRequestId
      : authority[field];
    if (observation[field] !== expected) {
      throw new Error(`Review observation drifted from ${field}.`);
    }
  }
}

function validateLegacyLanePreservationReceipt(value) {
  return validateReceipt(
    value,
    LEGACY_LANE_PRESERVATION_RECEIPT_SCHEMA,
    "retained-legacy",
    [
      "claimId",
      "claimDigest",
      "scopeId",
      "branchId",
      "laneRevision",
      "fenceRevision",
      "reviewRequestId",
      "declaredWriteSet",
      "writeSetDigest",
      "stateDigest",
      "overlapClass",
      "successorScopeId",
      "successorWriteSetDigest",
      "captureAdapterId",
      "capturedAt",
    ],
  );
}

function normalizeAuthority(value, label) {
  requireObject(value, label);
  const declaredWriteSet = normalizeWriteSet(value.declaredWriteSet);
  const writeSetDigest = requireDigest(value.writeSetDigest, `${label}.writeSetDigest`);
  if (writeSetDigest !== digestValue(declaredWriteSet)) {
    throw new Error(`${label}.writeSetDigest does not match declaredWriteSet.`);
  }
  return Object.freeze({
    claimId: requireDigest(value.claimId, `${label}.claimId`),
    claimDigest: requireDigest(value.claimDigest, `${label}.claimDigest`),
    scopeId: requireText(value.scopeId, `${label}.scopeId`),
    branchId: requireText(value.branchId, `${label}.branchId`),
    laneRevision: requireDigest(value.laneRevision, `${label}.laneRevision`),
    fenceRevision: requireText(value.fenceRevision, `${label}.fenceRevision`),
    reviewRequestId: requireOptionalText(
      value.reviewRequestId,
      `${label}.reviewRequestId`,
    ),
    declaredWriteSet,
    writeSetDigest,
    stateDigest: requireDigest(value.stateDigest, `${label}.stateDigest`),
  });
}

function normalizeSuccessorAuthority(value, label) {
  requireObject(value, label);
  const declaredWriteSet = normalizeWriteSet(value.declaredWriteSet);
  const writeSetDigest = requireDigest(value.writeSetDigest, `${label}.writeSetDigest`);
  if (writeSetDigest !== digestValue(declaredWriteSet)) {
    throw new Error(`${label}.writeSetDigest does not match declaredWriteSet.`);
  }
  return Object.freeze({
    scopeId: requireText(value.scopeId, `${label}.scopeId`),
    declaredWriteSet,
    writeSetDigest,
  });
}

function normalizeReviewObservation(value) {
  requireObject(value, "review observation");
  return Object.freeze({
    reviewRequestId: requireText(value.reviewRequestId, "review observation reviewRequestId"),
    branchId: requireText(value.branchId, "review observation branchId"),
    laneRevision: requireDigest(value.laneRevision, "review observation laneRevision"),
    observedAt: requireInstant(value.observedAt, "review observation observedAt"),
  });
}

function normalizeAuthorization(value) {
  requireObject(value, "authorization");
  const selection = requireEnum(
    value.selection,
    ["retain", "retire"],
    "authorization selection",
  );
  return Object.freeze({
    selection,
    selectedBy: requireText(value.selectedBy, "authorization selectedBy"),
    selectedAt: requireInstant(value.selectedAt, "authorization selectedAt"),
    idempotencyKey: requireText(
      value.idempotencyKey,
      "authorization idempotencyKey",
    ),
    expectedOverlapClass: value.expectedOverlapClass == null
      ? null
      : requireEnum(
        value.expectedOverlapClass,
        ["none", "disjoint", "overlapping"],
        "authorization expectedOverlapClass",
      ),
  });
}

function replayExactResult(replay, result) {
  if (replay == null) return result;
  if (
    !replay
    || replay.schema !== LEGACY_AUTHORITY_EVALUATION_RESULT_SCHEMA
  ) {
    return blockedReplayResult(
      result,
      finding("replay-result-drift", "Replay result is malformed."),
    );
  }
  if (replay.idempotencyKeyDigest !== result.idempotencyKeyDigest) {
    return blockedReplayResult(
      result,
      finding("replay-idempotency-drift", "Replay idempotency key drifted."),
    );
  }
  if (replay.requestDigest !== result.requestDigest) {
    return blockedReplayResult(
      result,
      finding("replay-request-drift", "Replay request drifted from the exact authority evaluation input."),
    );
  }
  if (
    replay.status !== result.status
    || replay.transition !== result.transition
    || replay.overlapClass !== result.overlapClass
    || JSON.stringify(replay.blockingFindings)
      !== JSON.stringify(result.blockingFindings)
    || replay.legacyLanePreservationReceipt?.receiptDigest
      !== result.legacyLanePreservationReceipt?.receiptDigest
    || replay.legacyAuthorityRetirementReceipt?.receiptDigest
      !== result.legacyAuthorityRetirementReceipt?.receiptDigest
  ) {
    return blockedReplayResult(
      result,
      finding("replay-result-drift", "Replay result drifted from the exact authority evaluation outcome."),
    );
  }
  return Object.freeze({ ...replay, replayed: true });
}

function blockedReplayResult(result, replayFinding) {
  return Object.freeze({
    ...result,
    status: "blocked",
    replayed: false,
    blockingFindings: Object.freeze(
      [...result.blockingFindings, replayFinding].sort(compareFindings),
    ),
    legacyLanePreservationReceipt: null,
    legacyAuthorityRetirementReceipt: null,
  });
}

function classifyOverlap(leftWriteSet, rightWriteSet) {
  if (!rightWriteSet) return "none";
  return writeSetsOverlap(leftWriteSet, rightWriteSet)
    ? "overlapping"
    : "disjoint";
}

function validateReceipt(value, schema, status, fields) {
  requireObject(value, schema);
  const actual = Object.keys(value).sort();
  const expected = [...fields, "schema", "status", "receiptDigest"].sort();
  if (
    actual.length !== expected.length
    || actual.some((field, index) => field !== expected[index])
  ) {
    throw new Error(`${schema} contains missing or unknown fields.`);
  }
  if (value.schema !== schema || value.status !== status) {
    throw new Error(`${schema} has invalid schema or status.`);
  }
  const { receiptDigest, ...evidence } = value;
  requireDigest(receiptDigest, `${schema} receiptDigest`);
  if (receiptDigest !== digestValue(evidence)) {
    throw new Error(`${schema} digest does not match its evidence.`);
  }
  return Object.freeze(value);
}

function receipt(evidence) {
  return Object.freeze({
    ...evidence,
    receiptDigest: digestValue(evidence),
  });
}

function finding(code, message) {
  return Object.freeze({
    code: requireText(code, "finding code"),
    message: requireText(message, "finding message"),
  });
}

function compareFindings(left, right) {
  return digestValue(left).localeCompare(digestValue(right));
}

function requireEnum(value, options, label) {
  const text = requireText(value, label);
  if (!options.includes(text)) {
    throw new Error(`${label} must be one of: ${options.join(", ")}.`);
  }
  return text;
}

function requireOptionalText(value, label) {
  if (value == null || value === "") return null;
  return requireText(value, label);
}

function requireDigest(value, label) {
  const text = requireText(value, label);
  if (!DIGEST_PATTERN.test(text)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return text;
}

function requireInstant(value, label) {
  const text = requireText(value, label);
  if (Number.isNaN(Date.parse(text))) {
    throw new Error(`${label} must be an ISO timestamp.`);
  }
  return text;
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be non-empty.`);
  }
  return value.trim();
}
