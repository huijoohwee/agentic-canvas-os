import { digestValue } from "./cloud-collaboration-contract.mjs";

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_TTL_SECONDS = 86_400;
const MIN_TTL_SECONDS = 60;
const DEFAULT_TTL_SECONDS = 1_800;

export function contractRepository(repository, canonicalRevision = null) {
  if (!repository?.nodeId) throw new Error("Resolved repository node identity is required.");
  return {
    repositoryId: `github-repository:${repository.nodeId}`,
    canonicalRevision,
  };
}

export function contractActor(actor, input) {
  if (!Number.isInteger(actor?.id) || actor.id <= 0) {
    throw new Error("Resolved actor identity is required.");
  }
  return {
    actorId: `github-user:${actor.id}`,
    deviceId: pseudonymousIdentifier("device", requiredText(input.deviceId, "deviceId")),
    sessionId: pseudonymousIdentifier("session", requiredText(input.sessionId, "sessionId")),
  };
}

export function prepareMutationRequest({
  action,
  input,
  actor,
  repository,
  pullRequest,
  evaluationTime,
}) {
  assertPullRequestProjection(input, pullRequest);
  const owner = contractActor(actor, input);
  const common = {
    deviceId: owner.deviceId,
    sessionId: owner.sessionId,
    idempotencyKey: requiredText(input.idempotencyKey, "idempotencyKey"),
  };
  if (action === "claim") {
    const canonicalBaseRevision = first(
      pullRequest?.baseSha,
      input.canonicalBaseRevision,
      input.canonicalBaseSha,
    );
    const laneRevision = first(
      pullRequest?.headSha,
      input.laneRevision,
      input.headSha,
      input.branchFenceSha,
      canonicalBaseRevision,
    );
    return {
      ...common,
      workItemId: pseudonymousIdentifier(
        "work-item",
        requiredText(
          first(input.workItemId, input.taskId, input.scopeId, input.branch),
          "workItemId",
        ),
      ),
      canonicalBaseRevision: requiredText(canonicalBaseRevision, "canonicalBaseRevision"),
      declaredWriteScope: declaredWriteScope(input),
      laneRevision: requiredText(laneRevision, "laneRevision"),
      leaseEpoch: boundedInteger(first(input.leaseEpoch, 1), "leaseEpoch", 1),
      predecessorClaimId: optionalDigest(input.predecessorClaimId, "predecessorClaimId"),
      expiresAt: expiryFromServer(evaluationTime, input.ttlSeconds),
      ...(input.claimId ? { claimId: requiredDigest(input.claimId, "claimId") } : {}),
    };
  }

  const expected = {
    ...common,
    claimId: requiredDigest(input.claimId, "claimId"),
    expectedFenceRevision: requiredDigest(
      first(input.expectedFenceRevision, input.expectedClaimDigest),
      "expectedFenceRevision",
    ),
    expectedTransitionCounter: boundedInteger(
      input.expectedTransitionCounter,
      "expectedTransitionCounter",
      1,
    ),
  };
  if (action === "bind") {
    return {
      ...expected,
      laneRevision: requiredText(
        first(pullRequest?.headSha, input.laneRevision, input.headSha),
        "laneRevision",
      ),
      reviewRequestId: optionalText(
        first(pullRequest ? reviewRequestIdentity(pullRequest) : null, input.reviewRequestId),
      ),
    };
  }
  if (action === "heartbeat") {
    return {
      ...expected,
      expiresAt: expiryFromServer(evaluationTime, input.ttlSeconds),
    };
  }
  if (action === "review-ready") {
    return {
      ...expected,
      laneRevision: requiredText(
        first(pullRequest?.headSha, input.laneRevision, input.headSha),
        "laneRevision",
      ),
      reviewRequestId: requiredText(
        first(pullRequest ? reviewRequestIdentity(pullRequest) : null, input.reviewRequestId),
        "reviewRequestId",
      ),
      focusedEvidenceDigest: requiredDigest(
        input.focusedEvidenceDigest,
        "focusedEvidenceDigest",
      ),
    };
  }
  if (action === "handoff") {
    const recipientMode = requiredText(
      first(input.recipientMode, input.handoffMode),
      "recipientMode",
    );
    return {
      ...expected,
      recipientMode,
      nextActorId: recipientMode === "actor"
        ? normalizeNextActor(input.nextActorId)
        : null,
      evidenceDigest: requiredDigest(input.evidenceDigest, "evidenceDigest"),
    };
  }
  if (action === "release") {
    return {
      ...expected,
      reason: requiredText(first(input.reason, input.releaseReason), "reason"),
      evidenceDigest: requiredDigest(input.evidenceDigest, "evidenceDigest"),
      integrationReceiptDigest: optionalDigest(
        input.integrationReceiptDigest,
        "integrationReceiptDigest",
      ),
    };
  }
  throw new Error(`Unsupported cloud collaboration mutation: ${action}`);
}

export function prepareReadRequest({ input, repository, pullRequest }) {
  assertPullRequestProjection(input, pullRequest);
  const request = {
    repositoryId: repository ? contractRepository(repository).repositoryId : undefined,
    claimId: input.claimId,
    workItemId: input.workItemId
      ? pseudonymousIdentifier("work-item", input.workItemId)
      : undefined,
    canonicalBaseRevision: first(pullRequest?.baseSha, input.canonicalBaseRevision, input.canonicalBaseSha),
    laneRevision: first(pullRequest?.headSha, input.laneRevision, input.headSha),
    reviewRequestId: first(
      pullRequest ? reviewRequestIdentity(pullRequest) : null,
      input.reviewRequestId,
    ),
    writeSetDigest: input.writeSetDigest,
    leaseEpoch: input.leaseEpoch === undefined
      ? undefined
      : boundedInteger(input.leaseEpoch, "leaseEpoch", 1),
    fenceRevision: first(input.expectedFenceRevision, input.expectedClaimDigest),
    focusedEvidenceDigest: input.focusedEvidenceDigest,
    requiredState: normalizeRequiredState(first(input.requiredState, input.requireStatus)),
  };
  return removeUndefined(request);
}

export function selectVerificationClaim(claims, request) {
  if (request.claimId) return request.claimId;
  const candidates = claims.filter((claim) => (
    (!request.repositoryId || claim.repositoryId === request.repositoryId)
    && (!request.workItemId || claim.workItemId === request.workItemId)
    && (!request.canonicalBaseRevision || claim.canonicalBaseRevision === request.canonicalBaseRevision)
    && (!request.laneRevision || claim.laneRevision === request.laneRevision)
    && (!request.reviewRequestId || claim.reviewRequestId === request.reviewRequestId)
  ));
  if (candidates.length === 1) return candidates[0].claimId;
  if (candidates.length === 0) return null;
  throw new Error("Cloud verification matched more than one current claim.");
}

export function projectPublicClaim(claim) {
  return {
    claimId: claim.claimId,
    state: claim.state,
    actorId: claim.actorId,
    repositoryId: claim.repositoryId,
    workItemId: claim.workItemId,
    canonicalBaseRevision: claim.canonicalBaseRevision,
    laneRevision: claim.laneRevision,
    declaredWriteScope: claim.declaredWriteScope,
    writeSetDigest: claim.writeSetDigest,
    leaseEpoch: claim.leaseEpoch,
    transitionCounter: claim.transitionCounter,
    heartbeatCounter: claim.heartbeatCounter,
    reviewRequestId: claim.reviewRequestId,
    expiresAt: claim.expiresAt,
    fenceRevision: claim.fenceRevision,
    transitionDigest: claim.ledgerRevision,
  };
}

function declaredWriteScope(input) {
  const explicit = first(input.declaredWriteScope, input.declaredWriteSet);
  if (Array.isArray(explicit) && explicit.length > 0) return explicit;
  if (input.scopeId) return [`semantic:${String(input.scopeId).trim().toLowerCase()}`];
  throw new Error("declaredWriteScope must be a non-empty array.");
}

function expiryFromServer(evaluationTime, rawTtlSeconds) {
  const serverMilliseconds = Date.parse(requiredText(evaluationTime, "evaluationTime"));
  if (!Number.isFinite(serverMilliseconds)) throw new Error("evaluationTime must be a valid server instant.");
  const ttlSeconds = boundedInteger(
    first(rawTtlSeconds, DEFAULT_TTL_SECONDS),
    "ttlSeconds",
    MIN_TTL_SECONDS,
    MAX_TTL_SECONDS,
  );
  return new Date(serverMilliseconds + ttlSeconds * 1_000).toISOString();
}

function assertPullRequestProjection(input, pullRequest) {
  if (!pullRequest) return;
  const comparisons = [
    ["branch", input.branch, pullRequest.branch],
    ["head revision", first(input.laneRevision, input.headSha), pullRequest.headSha],
    ["canonical base", first(input.canonicalBaseRevision, input.canonicalBaseSha), pullRequest.baseSha],
  ];
  for (const [label, expected, observed] of comparisons) {
    if (expected !== undefined && expected !== null && String(expected) !== observed) {
      throw new Error(`Supplied ${label} does not match the resolved pull request.`);
    }
  }
}

function reviewRequestIdentity(pullRequest) {
  return `github-pull-request:${pullRequest.nodeId}`;
}

function normalizeNextActor(value) {
  const text = requiredText(value, "nextActorId");
  return text.startsWith("github-user:") ? text : `github-user:${text}`;
}

function normalizeRequiredState(value) {
  if (value === undefined || value === null || value === "") return undefined;
  return String(value).trim().replaceAll("_", "-");
}

function pseudonymousIdentifier(namespace, value) {
  return `${namespace}:${digestValue({ namespace, value })}`;
}

function boundedInteger(value, label, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return number;
}

function requiredDigest(value, label) {
  const digest = requiredText(value, label);
  if (!SHA256_PATTERN.test(digest)) throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  return digest;
}

function optionalDigest(value, label) {
  if (value === undefined || value === null || value === "") return null;
  return requiredDigest(value, label);
}

function requiredText(value, label) {
  const text = String(value ?? "").normalize("NFC").trim();
  if (!text) throw new Error(`${label} is required.`);
  if (text.length > 512) throw new Error(`${label} exceeds 512 characters.`);
  return text;
}

function optionalText(value) {
  if (value === undefined || value === null || value === "") return null;
  return requiredText(value, "value");
}

function first(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function removeUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
