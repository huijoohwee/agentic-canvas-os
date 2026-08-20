import { digestValue, listCurrentClaims } from "./cloud-collaboration-contract.mjs";

export const CLOUD_RESULT_SCHEMA = "agentic-cloud-collaboration-result/v1";
export const CURRENT_CLAIM_INVENTORY_SCHEMA =
  "agentic-cloud-collaboration-current-claim-inventory/v1";

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_CURRENT_CLAIMS = 128;
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
    deviceId: normalizeOwnerIdentifier("device", input.deviceId),
    sessionId: normalizeOwnerIdentifier("session", input.sessionId),
  };
}

export function prepareMutationRequest({
  action,
  input,
  actor,
  repository,
  pullRequest,
  evaluationTime,
  fixedExpiresAt = null,
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
      workItemId: normalizeWorkItemIdentifier(
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
      expiresAt: fixedExpiresAt || expiryFromServer(evaluationTime, input.ttlSeconds),
      expectedLedgerDigest: input.expectedLedgerDigest ?? null,
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
    expectedLedgerDigest: requiredDigest(input.expectedLedgerDigest, "expectedLedgerDigest"),
  };
  if (action === "continue") {
    const mode = requiredText(input.mode, "mode");
    return {
      ...expected,
      mode,
      laneRevision: optionalText(first(pullRequest?.headSha, input.laneRevision, input.headSha)),
      reviewRequestId: optionalText(first(
        pullRequest ? reviewRequestIdentity(pullRequest) : null,
        input.reviewRequestId,
      )),
      expiresAt: ["renewal", "recovery", "promote"].includes(mode)
        ? fixedExpiresAt || expiryFromServer(evaluationTime, input.ttlSeconds)
        : null,
      focusedEvidenceDigest: optionalDigest(input.focusedEvidenceDigest, "focusedEvidenceDigest"),
      handoffEvidenceDigest: optionalDigest(input.handoffEvidenceDigest, "handoffEvidenceDigest"),
      recoveryEvidenceDigest: optionalDigest(input.recoveryEvidenceDigest, "recoveryEvidenceDigest"),
    };
  }
  if (action === "integrate") {
    return {
      ...expected,
      candidateRevision: requiredText(
        first(pullRequest?.headSha, input.candidateRevision, input.laneRevision, input.headSha),
        "candidateRevision",
      ),
      reviewRequestId: requiredText(
        first(pullRequest ? reviewRequestIdentity(pullRequest) : null, input.reviewRequestId),
        "reviewRequestId",
      ),
      focusedEvidenceDigest: requiredDigest(input.focusedEvidenceDigest, "focusedEvidenceDigest"),
      dependencyClosureDigest: requiredDigest(input.dependencyClosureDigest, "dependencyClosureDigest"),
      namedChecksDigest: requiredDigest(input.namedChecksDigest, "namedChecksDigest"),
      handoffEvidenceDigest: requiredDigest(input.handoffEvidenceDigest, "handoffEvidenceDigest"),
      operatorDecisionDigest: requiredDigest(input.operatorDecisionDigest, "operatorDecisionDigest"),
      integrationIntentDigest: requiredDigest(input.integrationIntentDigest, "integrationIntentDigest"),
    };
  }
  if (action === "retire") {
    return {
      ...expected,
      reason: requiredText(input.reason, "reason"),
      finalRevision: requiredText(
        first(input.finalRevision, pullRequest?.headSha, input.laneRevision, input.headSha),
        "finalRevision",
      ),
      reviewRequestId: optionalText(first(
        pullRequest ? reviewRequestIdentity(pullRequest) : null,
        input.reviewRequestId,
      )),
      bytesDigest: requiredDigest(input.bytesDigest, "bytesDigest"),
      namedChecksDigest: requiredDigest(input.namedChecksDigest, "namedChecksDigest"),
      handoffEvidenceDigest: requiredDigest(input.handoffEvidenceDigest, "handoffEvidenceDigest"),
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
  const allowProtectedMainRefresh = input.allowProtectedMainRefresh === true;
  const resolvedCanonicalBaseRevision = allowProtectedMainRefresh
    ? first(input.canonicalBaseRevision, input.canonicalBaseSha, pullRequest?.baseSha)
    : first(pullRequest?.baseSha, input.canonicalBaseRevision, input.canonicalBaseSha);
  const resolvedLaneRevision = allowProtectedMainRefresh
    ? first(input.laneRevision, input.headSha, pullRequest?.headSha)
    : first(pullRequest?.headSha, input.laneRevision, input.headSha);
  const request = {
    repositoryId: repository ? contractRepository(repository).repositoryId : undefined,
    claimId: input.claimId,
    workItemId: input.workItemId
      ? normalizeWorkItemIdentifier(input.workItemId)
      : undefined,
    canonicalBaseRevision: resolvedCanonicalBaseRevision,
    laneRevision: resolvedLaneRevision,
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
    allowRetiredIntegratedPreserved: input.allowRetiredIntegratedPreserved === true,
    integrationReceiptDigest: input.integrationReceiptDigest === undefined
      ? undefined
      : requiredDigest(input.integrationReceiptDigest, "integrationReceiptDigest"),
    transitionCounter: input.transitionCounter === undefined
      ? undefined
      : boundedInteger(input.transitionCounter, "transitionCounter", 1),
    observedChangedPaths: input.observedChangedPaths,
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
    entrySchema: claim.entrySchema,
    claimIdentitySchema: claim.claimIdentitySchema,
    state: claim.state,
    writeAuthority: claim.writeAuthority,
    scopeReserved: claim.scopeReserved,
    actorId: claim.actorId,
    deviceId: claim.deviceId,
    sessionId: claim.sessionId,
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
    predecessorClaimId: claim.predecessorClaimId,
    expiresAt: claim.expiresAt,
    fenceRevision: claim.fenceRevision,
    transitionDigest: claim.ledgerRevision,
    operationReceiptDigest: claim.operationReceiptDigest,
    integrationReceiptDigest: claim.integrationReceiptDigest,
    integration: claim.integration ?? null,
    recovery: claim.recovery ?? null,
  };
}

export function createPublicResult({ action, transition, ledgerRevision, evaluationTime, attempts }) {
  const claim = transition.claim || null;
  const receipt = {
    schema: "agentic-cloud-collaboration-github-receipt/v1",
    action,
    ledgerRevision,
    ledgerDigest: transition.ledger.headDigest,
    claimId: claim?.claimId || null,
    claimDigest: transition.claimDigest || null,
    contractReceiptDigest: transition.receipt?.receiptDigest || null,
    sequence: transition.ledger.sequence,
    evaluationTime,
  };
  return {
    schema: CLOUD_RESULT_SCHEMA,
    ok: true,
    action,
    status: claim?.state || "retired",
    replayed: Boolean(transition.replayed),
    attempts,
    ledgerRevision,
    claim: claim ? projectPublicClaim(claim) : null,
    claimDigest: transition.claimDigest || null,
    operationReceipt: transition.receipt || null,
    receipt: { ...receipt, receiptDigest: digestValue(receipt) },
  };
}

export function verificationResult({
  verification,
  snapshot,
  evaluationTime,
  context,
  claims,
}) {
  const claimDigest = verification.claimDigest || verification.claim?.fenceRevision || null;
  const currentClaimInventory = buildCurrentClaimInventory({
    claims,
    snapshot,
    evaluationTime,
  });
  const receipt = {
    schema: "agentic-cloud-collaboration-github-verification/v1",
    ok: verification.ok,
    ledgerRevision: snapshot.revision,
    ledgerDigest: snapshot.ledger.headDigest,
    claimId: verification.claimId,
    claimDigest,
    contractReceiptDigest: verification.receiptDigest,
    claimInventoryDigest: currentClaimInventory.claimInventoryDigest,
    evaluationTime,
    findings: verification.findings,
  };
  return {
    schema: CLOUD_RESULT_SCHEMA,
    ok: verification.ok,
    action: "verify",
    status: verification.ok ? "ready" : "blocked",
    ledgerRevision: snapshot.revision,
    claimDigest,
    claim: verification.claim ? projectPublicClaim(verification.claim) : null,
    currentClaimInventory,
    ...(context.pullRequest ? {
      subject: {
        repository: context.repository.fullName,
        pullRequestNumber: context.pullRequest.number,
        branch: context.pullRequest.branch,
        headSha: context.pullRequest.headSha,
        canonicalBaseSha: context.pullRequest.baseSha,
      },
    } : {}),
    findings: verification.findings,
    receipt: { ...receipt, receiptDigest: digestValue(receipt) },
  };
}

function buildCurrentClaimInventory({ claims, snapshot, evaluationTime }) {
  if (!Array.isArray(claims) || claims.length > MAX_CURRENT_CLAIMS) {
    throw new Error(
      `Cloud verification current-claim inventory must contain 0 to ${MAX_CURRENT_CLAIMS} claims.`,
    );
  }
  const projectedClaims = claims.map(projectPublicClaim)
    .sort((left, right) => left.claimId.localeCompare(right.claimId));
  if (new Set(projectedClaims.map((claim) => claim.claimId)).size !== projectedClaims.length) {
    throw new Error("Cloud verification current-claim inventory contains duplicate claim identities.");
  }
  const core = {
    schema: CURRENT_CLAIM_INVENTORY_SCHEMA,
    ledgerRevision: snapshot.revision,
    ledgerDigest: snapshot.ledger.headDigest,
    evaluationTime,
    claims: projectedClaims,
  };
  return {
    ...core,
    claimInventoryDigest: digestValue(core),
  };
}

export function publicSnapshot(snapshot) {
  const claims = listCurrentClaims(snapshot.ledger, snapshot.evaluationTime).map(projectPublicClaim);
  return {
    schema: CLOUD_RESULT_SCHEMA,
    ok: true,
    action: "status",
    status: "ready",
    ledgerRevision: snapshot.revision,
    ledgerDigest: snapshot.ledger.headDigest,
    sequence: snapshot.ledger.sequence,
    claims,
  };
}

export function emptyResult(action) {
  return {
    schema: CLOUD_RESULT_SCHEMA,
    ok: action === "status",
    action,
    status: action === "status" ? "empty" : "blocked",
    ledgerRevision: null,
    claims: [],
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
  const allowProtectedMainRefresh = input.allowProtectedMainRefresh === true;
  const requiredState = normalizeRequiredState(first(input.requiredState, input.requireStatus));
  if (allowProtectedMainRefresh) {
    if (requiredState !== "integrated-preserved") {
      throw new Error(
        "Protected-main refresh projection is limited to integrated-preserved verification.",
      );
    }
    if (!first(input.claimId, input.reviewRequestId)) {
      throw new Error(
        "Protected-main refresh projection requires an exact claim or review request identity.",
      );
    }
  }
  const comparisons = [
    ["branch", input.branch, pullRequest.branch],
    ...(
      allowProtectedMainRefresh
        ? []
        : [
          ["head revision", first(input.laneRevision, input.headSha), pullRequest.headSha],
          ["canonical base", first(input.canonicalBaseRevision, input.canonicalBaseSha), pullRequest.baseSha],
        ]
    ),
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

function normalizeRequiredState(value) {
  if (value === undefined || value === null || value === "") return undefined;
  return String(value).trim().replaceAll("_", "-");
}

export function pseudonymousIdentifier(namespace, value) {
  return `${namespace}:${digestValue({ namespace, value })}`;
}

function normalizeWorkItemIdentifier(value) {
  const text = requiredText(value, "workItemId");
  const prefix = "work-item:";
  if (text.startsWith(prefix) && SHA256_PATTERN.test(text.slice(prefix.length))) {
    return text;
  }
  return pseudonymousIdentifier("work-item", text);
}

function normalizeOwnerIdentifier(namespace, value) {
  const text = requiredText(value, `${namespace}Id`);
  const prefix = `${namespace}:`;
  if (text.startsWith(prefix) && SHA256_PATTERN.test(text.slice(prefix.length))) {
    return text;
  }
  return pseudonymousIdentifier(namespace, text);
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
