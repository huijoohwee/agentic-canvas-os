import { createHash } from "node:crypto";
export const LEDGER_SCHEMA = "agentic-cloud-collaboration-ledger/v1";
export const RECEIPT_SCHEMA = "agentic-cloud-collaboration-receipt/v1";
export const ENTRY_SCHEMA = "agentic-cloud-collaboration-entry/v2";
export const LEGACY_ENTRY_SCHEMA = "agentic-cloud-collaboration-entry/v1";
export const CLOUD_COLLABORATION_BOUNDS = Object.freeze({
  writeScopeItems: 128,
  textCharacters: 512,
});
export const ROOT_OPERATIONS = Object.freeze([
  "claim",
  "continue",
  "integrate",
  "retire",
]);
export const MUTATING_ACTIONS = new Set(ROOT_OPERATIONS);
// Historical names remain valid only when verifying already-published immutable
// entries. They are never accepted as new operations or mapped to root aliases.
const HISTORICAL_ACTIONS = new Set([
  "bind",
  "heartbeat",
  "review-ready",
  "delivery-authorize",
  "handoff",
  "release",
]);
const CLAIM_STATES = new Set([
  "current",
  "waiting-successor",
  "reviewed",
  "integrated-preserved",
  "dormant-preserved",
  "retired",
  "active",
  "review-ready",
  "delivery-authorized",
  "parked",
  "released",
]);
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
export class CloudCollaborationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CloudCollaborationError";
    this.code = code;
  }
}
export function fail(code, message) {
  throw new CloudCollaborationError(code, message);
}
export function text(value, field, { optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === "")) return null;
  if (typeof value !== "string") fail("invalid_request", `${field} must be a string`);
  const normalized = value.normalize("NFC").trim();
  if (!normalized) fail("invalid_request", `${field} must not be empty`);
  if (normalized.length > CLOUD_COLLABORATION_BOUNDS.textCharacters) {
    fail("bound_exceeded", `${field} exceeds ${CLOUD_COLLABORATION_BOUNDS.textCharacters} characters`);
  }
  return normalized;
}
export function integer(value, field, { minimum = 0 } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail("invalid_request", `${field} must be an integer greater than or equal to ${minimum}`);
  }
  return value;
}
export function digest(value, field, { optional = false } = {}) {
  const normalized = text(value, field, { optional });
  if (normalized === null) return null;
  if (!DIGEST_PATTERN.test(normalized)) fail("invalid_request", `${field} must be a lowercase SHA-256 digest`);
  return normalized;
}
export function instant(value, field) {
  const normalized = text(value, field);
  const milliseconds = Date.parse(normalized);
  if (!Number.isFinite(milliseconds)) fail("invalid_request", `${field} must be an ISO-8601 instant`);
  return new Date(milliseconds).toISOString();
}
function normalizeCanonical(value, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("invalid_canonical_value", "canonical numbers must be finite");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((item) => normalizeCanonical(item, seen));
  if (typeof value !== "object" || value === undefined) {
    fail("invalid_canonical_value", "canonical values must be JSON-compatible");
  }
  if (seen.has(value)) fail("invalid_canonical_value", "canonical values must not contain cycles");
  seen.add(value);
  const normalized = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) fail("invalid_canonical_value", `canonical field ${key} is undefined`);
    normalized[key] = normalizeCanonical(value[key], seen);
  }
  seen.delete(value);
  return normalized;
}
export function canonicalJson(value) {
  return JSON.stringify(normalizeCanonical(value));
}
export function digestValue(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
function normalizePathScope(rawValue) {
  let value = rawValue.replaceAll("\\", "/").normalize("NFC").trim();
  if (!value) fail("invalid_write_scope", "path scope must not be empty");
  if (/[*?[\]{}!]/u.test(value)) fail("invalid_write_scope", "wildcards are ambiguous write scopes");
  if (value.startsWith("/") || /^[A-Za-z]:\//u.test(value)) {
    fail("invalid_write_scope", "path scope must be repository-relative");
  }
  const segments = [];
  for (const segment of value.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") fail("invalid_write_scope", "path scope must not traverse its repository");
    segments.push(segment);
  }
  value = segments.length === 0 ? "." : segments.join("/");
  return `path:${value}`;
}
function normalizeSemanticScope(rawValue) {
  const value = rawValue.normalize("NFC").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._:/-]*$/u.test(value)) {
    fail("invalid_write_scope", "semantic scope must use letters, digits, dot, colon, slash, underscore, or dash");
  }
  return `semantic:${value}`;
}
export function normalizeWriteSet(values) {
  if (!Array.isArray(values) || values.length === 0) {
    fail("invalid_write_scope", "declaredWriteScope must be a non-empty array");
  }
  if (values.length > CLOUD_COLLABORATION_BOUNDS.writeScopeItems) {
    fail("bound_exceeded", `declaredWriteScope exceeds ${CLOUD_COLLABORATION_BOUNDS.writeScopeItems} items`);
  }
  const normalized = values.map((item, index) => {
    const value = text(item, `declaredWriteScope[${index}]`);
    if (value.startsWith("semantic:")) return normalizeSemanticScope(value.slice("semantic:".length));
    if (value.startsWith("path:")) return normalizePathScope(value.slice("path:".length));
    return normalizePathScope(value);
  });
  return [...new Set(normalized)].sort();
}
function pathScopesOverlap(left, right) {
  const leftPath = left.slice("path:".length);
  const rightPath = right.slice("path:".length);
  if (leftPath === "." || rightPath === ".") return true;
  return leftPath === rightPath
    || leftPath.startsWith(`${rightPath}/`)
    || rightPath.startsWith(`${leftPath}/`);
}
export function writeSetsOverlap(leftValues, rightValues) {
  const left = normalizeWriteSet(leftValues);
  const right = normalizeWriteSet(rightValues);
  return left.some((leftScope) => right.some((rightScope) => {
    if (leftScope.startsWith("path:") && rightScope.startsWith("path:")) {
      return pathScopesOverlap(leftScope, rightScope);
    }
    return leftScope === rightScope;
  }));
}
export function normalizeCanonicalDescendantProof({ value, sourceBaseSha, protectedRevision = null }) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid_request", "canonicalDescendantProof must be an object");
  }
  const expectedKeys = ["ancestry", "canonicalChangedPaths", "canonicalChangedPathsDigest",
    "evidenceDigest", "overlap", "preservedChangedPaths", "preservedChangedPathsDigest",
    "protectedMainSha", "schema", "sourceBaseSha", "targetBaseSha"];
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedKeys.sort())) {
    fail("invalid_request", "canonicalDescendantProof has unexpected fields");
  }
  const canonicalChangedPaths = normalizeProofPaths(value.canonicalChangedPaths, "canonical changed paths");
  const preservedChangedPaths = normalizeProofPaths(value.preservedChangedPaths, "preserved changed paths");
  const core = { schema: value.schema, sourceBaseSha: value.sourceBaseSha,
    targetBaseSha: value.targetBaseSha, protectedMainSha: value.protectedMainSha,
    canonicalChangedPaths, canonicalChangedPathsDigest: value.canonicalChangedPathsDigest,
    preservedChangedPaths, preservedChangedPathsDigest: value.preservedChangedPathsDigest,
    ancestry: value.ancestry, overlap: value.overlap };
  const validSha = candidate => /^[0-9a-f]{40}$/u.test(String(candidate || ""));
  if (core.schema !== "agentic-legacy-review-current-base-disjoint-proof/v1"
    || !validSha(core.sourceBaseSha) || !validSha(core.targetBaseSha)
    || core.sourceBaseSha !== sourceBaseSha || core.targetBaseSha !== core.protectedMainSha
    || (protectedRevision && core.targetBaseSha !== protectedRevision)
    || core.sourceBaseSha === core.targetBaseSha
    || core.ancestry !== "source-base-to-current-protected-main" || core.overlap !== "none"
    || core.canonicalChangedPathsDigest !== digestValue(canonicalChangedPaths)
    || core.preservedChangedPathsDigest !== digestValue(preservedChangedPaths)
    || writeSetsOverlap(canonicalChangedPaths.map(path => `path:${path}`),
      preservedChangedPaths.map(path => `path:${path}`))
    || value.evidenceDigest !== digestValue(core)) {
    fail("invalid_request", "canonicalDescendantProof is not an exact disjoint protected descendant proof");
  }
  return Object.freeze({ ...core, evidenceDigest: value.evidenceDigest });
}
function normalizeProofPaths(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    fail("invalid_request", `${label} must be a non-empty array`);
  }
  return normalizeWriteSet(value.map(path => `path:${text(path, label)}`))
    .map(scope => scope.slice("path:".length));
}
export function findUncoveredPathScopes(declaredWriteScope, changedPaths) {
  const declared = normalizeWriteSet(declaredWriteScope);
  if (!Array.isArray(changedPaths)) {
    fail("invalid_request", "observedChangedPaths must be an array");
  }
  if (changedPaths.length === 0) return [];
  if (changedPaths.length > 100_000) {
    fail("bound_exceeded", "observedChangedPaths exceeds 100000 items");
  }
  const observed = [...new Set(changedPaths.map((value, index) => {
    const normalized = text(value, `observedChangedPaths[${index}]`);
    return normalized.startsWith("path:")
      ? normalizePathScope(normalized.slice("path:".length))
      : normalizePathScope(normalized);
  }))].sort();
  return observed.filter((scope) => !writeSetsOverlap(declared, [scope]));
}
export function normalizeRepository(repository) {
  if (typeof repository === "string") {
    return { repositoryId: text(repository, "repositoryId"), canonicalRevision: null };
  }
  if (!repository || typeof repository !== "object" || Array.isArray(repository)) {
    fail("invalid_request", "repository must be an id string or object");
  }
  const opaqueId = repository.repositoryId ?? repository.nodeId ?? repository.id ?? repository.fullName;
  return {
    repositoryId: text(opaqueId === undefined ? undefined : String(opaqueId), "repositoryId"),
    canonicalRevision: text(repository.canonicalRevision, "canonicalRevision", { optional: true }),
  };
}
export function normalizeActor(actor, request = {}) {
  if (!actor || typeof actor !== "object" || Array.isArray(actor)) {
    fail("invalid_request", "actor must carry actorId, deviceId, and sessionId");
  }
  const opaqueId = actor.actorId ?? actor.id;
  return {
    actorId: text(opaqueId === undefined ? undefined : String(opaqueId), "actorId"),
    deviceId: text(actor.deviceId ?? request.deviceId, "deviceId"),
    sessionId: text(actor.sessionId ?? request.sessionId, "sessionId"),
  };
}
export function normalizeRootIntent(action, request, actor, repositoryId) {
  const common = { repositoryId, ...actor };
  if (action === "claim") return normalizeClaimIntent(request, common);
  const expected = {
    claimId: digest(request.claimId, "claimId"),
    expectedFenceRevision: digest(request.expectedFenceRevision, "expectedFenceRevision"),
    expectedTransitionCounter: integer(request.expectedTransitionCounter, "expectedTransitionCounter", { minimum: 1 }),
    expectedLedgerDigest: digest(request.expectedLedgerDigest, "expectedLedgerDigest"),
  };
  if (action === "continue") return normalizeContinuationIntent(request, common, expected);
  if (action === "integrate") return normalizeIntegrationIntent(request, common, expected);
  if (action === "retire") return normalizeRetirementIntent(request, common, expected);
  fail("invalid_action", `unsupported mutation action: ${action}`);
}
function normalizeClaimIntent(request, common) {
  const declaredWriteScope = normalizeWriteSet(request.declaredWriteScope);
  const intent = {
    ...common,
    workItemId: text(request.workItemId, "workItemId"),
    canonicalBaseRevision: text(request.canonicalBaseRevision, "canonicalBaseRevision"),
    declaredWriteScope,
    writeSetDigest: digestValue(declaredWriteScope),
    laneRevision: text(request.laneRevision ?? request.canonicalBaseRevision, "laneRevision"),
    leaseEpoch: integer(request.leaseEpoch, "leaseEpoch", { minimum: 1 }),
    predecessorClaimId: digest(request.predecessorClaimId, "predecessorClaimId", { optional: true }),
    canonicalDescendantProof: request.canonicalDescendantProof ?? null,
    expiresAt: instant(request.expiresAt, "expiresAt"),
    expectedLedgerDigest: request.expectedLedgerDigest === null
      ? null
      : digest(request.expectedLedgerDigest, "expectedLedgerDigest"),
  };
  const claimId = digestValue({
    actorId: common.actorId,
    canonicalBaseRevision: intent.canonicalBaseRevision,
    leaseEpoch: intent.leaseEpoch,
    repositoryId: common.repositoryId,
    workItemId: intent.workItemId,
    writeSetDigest: intent.writeSetDigest,
  });
  if (request.claimId !== undefined && digest(request.claimId, "claimId") !== claimId) {
    fail("claim_identity_mismatch", "claimId does not match the normalized claim identity");
  }
  return { ...intent, claimId };
}
function normalizeContinuationIntent(request, common, expected) {
  const mode = text(request.mode, "mode");
  if (!["projection", "renewal", "review", "preserve", "recovery", "promote"].includes(mode)) {
    fail("invalid_request", "continue mode must be projection, renewal, review, preserve, recovery, or promote");
  }
  return {
    ...common, ...expected, mode,
    laneRevision: text(request.laneRevision, "laneRevision", { optional: true }),
    reviewRequestId: text(request.reviewRequestId, "reviewRequestId", { optional: true }),
    expiresAt: request.expiresAt ? instant(request.expiresAt, "expiresAt") : null,
    focusedEvidenceDigest: digest(request.focusedEvidenceDigest, "focusedEvidenceDigest", { optional: true }),
    handoffEvidenceDigest: digest(request.handoffEvidenceDigest, "handoffEvidenceDigest", { optional: true }),
    recoveryEvidenceDigest: digest(request.recoveryEvidenceDigest, "recoveryEvidenceDigest", { optional: true }),
  };
}
function normalizeIntegrationIntent(request, common, expected) {
  return {
    ...common, ...expected,
    candidateRevision: text(request.candidateRevision, "candidateRevision"),
    reviewRequestId: text(request.reviewRequestId, "reviewRequestId"),
    focusedEvidenceDigest: digest(request.focusedEvidenceDigest, "focusedEvidenceDigest"),
    dependencyClosureDigest: digest(request.dependencyClosureDigest, "dependencyClosureDigest"),
    namedChecksDigest: digest(request.namedChecksDigest, "namedChecksDigest"),
    handoffEvidenceDigest: digest(request.handoffEvidenceDigest, "handoffEvidenceDigest"),
    operatorDecisionDigest: digest(request.operatorDecisionDigest, "operatorDecisionDigest"),
    integrationIntentDigest: digest(request.integrationIntentDigest, "integrationIntentDigest"),
  };
}
function normalizeRetirementIntent(request, common, expected) {
  const reason = text(request.reason, "reason");
  if (!["integrated", "abandoned", "handoff", "superseded"].includes(reason)) {
    fail("invalid_request", "retire reason must be integrated, abandoned, handoff, or superseded");
  }
  return {
    ...common, ...expected, reason,
    finalRevision: text(request.finalRevision, "finalRevision"),
    reviewRequestId: text(request.reviewRequestId, "reviewRequestId", { optional: true }),
    bytesDigest: digest(request.bytesDigest, "bytesDigest"),
    namedChecksDigest: digest(request.namedChecksDigest, "namedChecksDigest"),
    handoffEvidenceDigest: digest(request.handoffEvidenceDigest, "handoffEvidenceDigest"),
    integrationReceiptDigest: digest(request.integrationReceiptDigest, "integrationReceiptDigest", {
      optional: reason !== "integrated",
    }),
  };
}
export const FINDING_TYPES = Object.freeze([
  "declared-write-scope-unproven",
  "parallel-scope-collision",
  "stale-collaboration-fence",
  "delivery-authority-unjoined",
  "evidence-without-run",
  "runtime-readiness-unproven",
]);
export function collaborationFinding(type, ledger, claim, expected = {}, evidenceDigest = null, remediation = "re-evaluate") {
  return {
    type,
    severity: type === "evidence-without-run" ? "major" : "blocker",
    repositoryId: claim?.repositoryId ?? expected.repositoryId ?? null,
    workItemId: claim?.workItemId ?? expected.workItemId ?? null,
    scope: claim?.declaredWriteScope ?? expected.declaredWriteScope ?? [],
    leaseEpoch: claim?.leaseEpoch ?? expected.leaseEpoch ?? null,
    expectedFence: expected.fenceRevision ?? null,
    observedFence: claim?.fenceRevision ?? null,
    affectedRevisions: [claim?.canonicalBaseRevision, claim?.laneRevision, ledger.headDigest].filter(Boolean),
    evidenceDigest,
    remediation,
  };
}
export function createEmptyLedger(ledgerRepository) {
  const { repositoryId: ledgerRepositoryId } = normalizeRepository(ledgerRepository);
  return { schema: LEDGER_SCHEMA, ledgerRepositoryId, sequence: 0, headDigest: null, entries: [] };
}
const CURRENT_CORE_REQUIRED = ["claimId", "actorId", "deviceId", "sessionId", "repositoryId", "workItemId", "canonicalBaseRevision", "declaredWriteScope", "writeSetDigest", "laneRevision", "leaseEpoch", "transitionCounter", "heartbeatCounter", "state", "expiresAt", "evidenceDigest", "reviewRequestId", "predecessorClaimId", "eligibleSince", "handoff", "release"];
const CURRENT_CORE_OPTIONAL = ["canonicalDescendantProof", "handoffEvidenceDigest", "promotedAt", "recovery", "integration", "retirement"];
const RESERVATION_STATES = new Set(["current", "reviewed", "integrated-preserved", "dormant-preserved"]);
const LEGACY_STATES = Object.freeze({ active: "current", "review-ready": "reviewed", "delivery-authorized": "reviewed", parked: "dormant-preserved", released: "retired" });
const IDENTITY_FIELDS = ["actorId", "repositoryId", "workItemId", "canonicalBaseRevision", "canonicalDescendantProof", "declaredWriteScope", "writeSetDigest", "leaseEpoch", "predecessorClaimId"];
const REVIEW_FIELDS = ["laneRevision", "reviewRequestId", "evidenceDigest"];
const PROJECTION_FIELDS = ["deviceId", "sessionId", "eligibleSince", "handoffEvidenceDigest", "promotedAt", "recovery"];
const OVERLAP_CACHE = new Map(), OVERLAP_CACHE_LIMIT = 4096;
function exactRecord(value, required, optional = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
}
function validInstant(value) {
  const milliseconds = Date.parse(value);
  return typeof value === "string" && Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}
function same(left, right) {
  return left === undefined || right === undefined ? left === right : canonicalJson(left) === canonicalJson(right);
}
function changed(core, previous, fields) {
  return fields.some((field) => !same(core[field], previous[field]));
}
function recordedState(entry) {
  return LEGACY_STATES[entry?.claimCore?.state] ?? entry?.claimCore?.state;
}
function effectiveState(entry, evaluationTime) {
  const state = recordedState(entry);
  return RESERVATION_STATES.has(state) && Date.parse(evaluationTime) >= Date.parse(entry.claimCore.expiresAt)
    ? "dormant-preserved" : state;
}
function currentRecords(latest, legacyLineages, evaluationTime, excludedClaimId = null) {
  const consumed = new Set([...latest.values()].filter((entry) => legacyLineages.has(entry.claimId))
    .map((entry) => entry.claimCore.predecessorClaimId).filter(Boolean));
  return [...latest.values()].filter((entry) => entry.claimId !== excludedClaimId && !consumed.has(entry.claimId))
    .map((entry) => ({ entry, core: entry.claimCore, state: effectiveState(entry, evaluationTime) }));
}
function overlapping(records, core) {
  return records.filter(({ entry }) => entry.repositoryId === core.repositoryId
    && cachedOverlap(entry.claimCore, core));
}
function cachedOverlap(left, right) {
  if (!Array.isArray(left.declaredWriteScope) || !Array.isArray(right.declaredWriteScope)) return false;
  const digests = [left.writeSetDigest, right.writeSetDigest].sort(), key = digests.join(":");
  if (DIGEST_PATTERN.test(digests[0] ?? "") && OVERLAP_CACHE.has(key)) return OVERLAP_CACHE.get(key);
  const result = left.declaredWriteScope.some((leftScope) => right.declaredWriteScope.some((rightScope) => (
    leftScope.startsWith("path:") && rightScope.startsWith("path:")
      ? pathScopesOverlap(leftScope, rightScope) : leftScope === rightScope
  )));
  if (DIGEST_PATTERN.test(digests[0] ?? "")) {
    if (OVERLAP_CACHE.size >= OVERLAP_CACHE_LIMIT) OVERLAP_CACHE.clear();
    OVERLAP_CACHE.set(key, result);
  }
  return result;
}
function waitingOrder(left, right) {
  return left.core.eligibleSince.localeCompare(right.core.eligibleSince)
    || left.entry.sequence - right.entry.sequence || left.entry.claimId.localeCompare(right.entry.claimId);
}
function validCurrentCoreShape(core) {
  const textFields = ["actorId", "deviceId", "sessionId", "repositoryId", "workItemId", "canonicalBaseRevision", "laneRevision"];
  if (!exactRecord(core, CURRENT_CORE_REQUIRED, CURRENT_CORE_OPTIONAL)
    || !textFields.every((key) => typeof core[key] === "string" && core[key].trim()) || !Number.isSafeInteger(core.leaseEpoch) || core.leaseEpoch < 1
    || core.handoff !== null || core.release !== null || (core.evidenceDigest !== null && !DIGEST_PATTERN.test(core.evidenceDigest))
    || (core.reviewRequestId !== null && (typeof core.reviewRequestId !== "string" || !core.reviewRequestId.trim())) || (core.predecessorClaimId !== null && !DIGEST_PATTERN.test(core.predecessorClaimId))
    || (core.eligibleSince !== null && !validInstant(core.eligibleSince)) || (core.handoffEvidenceDigest !== undefined && !DIGEST_PATTERN.test(core.handoffEvidenceDigest))
    || (core.promotedAt !== undefined && !validInstant(core.promotedAt))) return false;
  if (core.recovery !== undefined && (!exactRecord(core.recovery, ["evidenceDigest", "recoveredAt"])
    || !DIGEST_PATTERN.test(core.recovery.evidenceDigest) || !validInstant(core.recovery.recoveredAt))) return false;
  const integrationKeys = ["candidateRevision", "reviewRequestId", "focusedEvidenceDigest", "dependencyClosureDigest", "namedChecksDigest", "handoffEvidenceDigest", "operatorDecisionDigest", "integrationIntentDigest", "integratedAt"];
  if (core.integration !== undefined && (!exactRecord(core.integration, integrationKeys)
    || !["candidateRevision", "reviewRequestId"].every((key) => typeof core.integration[key] === "string" && core.integration[key].trim())
    || !integrationKeys.slice(2, -1).every((key) => DIGEST_PATTERN.test(core.integration[key])) || !validInstant(core.integration.integratedAt))) return false;
  const retirementKeys = ["reason", "finalRevision", "reviewRequestId", "bytesDigest", "namedChecksDigest", "handoffEvidenceDigest", "integrationReceiptDigest", "retiredAt"];
  return core.retirement === undefined || (exactRecord(core.retirement, retirementKeys)
    && ["integrated", "abandoned", "handoff", "superseded"].includes(core.retirement.reason)
    && typeof core.retirement.finalRevision === "string" && core.retirement.finalRevision.trim()
    && (core.retirement.reviewRequestId === null || (typeof core.retirement.reviewRequestId === "string" && core.retirement.reviewRequestId.trim()))
    && ["bytesDigest", "namedChecksDigest", "handoffEvidenceDigest"].every((key) => DIGEST_PATTERN.test(core.retirement[key]))
    && (core.retirement.integrationReceiptDigest === null || DIGEST_PATTERN.test(core.retirement.integrationReceiptDigest)) && validInstant(core.retirement.retiredAt));
}
function integrationReceiptDigest(entry) {
  return digestValue({ schema: "agentic-collaboration-integration-receipt/v1", operation: "integrate", status: "integrated-preserved", repositoryId: entry.repositoryId,
    claimId: entry.claimId, claimDigest: entry.claimDigest, fenceRevision: entry.claimDigest, ledgerRevision: entry.digest, ledgerSequence: entry.sequence,
    idempotencyKey: entry.idempotencyKey, requestDigest: entry.requestDigest, evaluationTime: entry.evaluationTime });
}
function checkClaim(entry, records, latest, failures, label) {
  const core = entry.claimCore, evaluatedAt = Date.parse(entry.evaluationTime);
  const peers = overlapping(records, core);
  const reservations = peers.filter(({ state }) => RESERVATION_STATES.has(state)).sort((a, b) => a.entry.claimId.localeCompare(b.entry.claimId));
  const waiters = peers.filter(({ state }) => state === "waiting-successor").sort(waitingOrder);
  const queued = reservations.length + waiters.length > 0;
  const predecessor = reservations[0]?.entry.claimId ?? waiters[0]?.entry.claimId ?? null;
  if (core.state !== (queued ? "waiting-successor" : "current") || core.eligibleSince !== (queued ? entry.evaluationTime : null)) {
    failures.push(`${label} claim queue admission is invalid`);
  }
  if (queued && core.predecessorClaimId !== predecessor) failures.push(`${label} claim predecessor priority is invalid`);
  if (!queued && core.predecessorClaimId) {
    const prior = latest.get(core.predecessorClaimId), priorCore = prior?.claimCore;
    const divergentBase = priorCore?.canonicalBaseRevision !== core.canonicalBaseRevision;
    let validDescendantProof = false;
    if (divergentBase && core.canonicalDescendantProof) {
      try {
        validDescendantProof = Boolean(normalizeCanonicalDescendantProof({
          value: core.canonicalDescendantProof,
          sourceBaseSha: core.canonicalBaseRevision,
        }));
      } catch {}
    }
    if (!prior || !["dormant-preserved", "retired"].includes(effectiveState(prior, entry.evaluationTime))
      || changed(core, priorCore, ["repositoryId", "workItemId", "writeSetDigest", "laneRevision"])
      || (divergentBase && !validDescendantProof) || (!divergentBase && core.canonicalDescendantProof)) {
      failures.push(`${label} claim predecessor identity is invalid`);
    }
  }
  if (evaluatedAt >= Date.parse(core.expiresAt) || core.heartbeatCounter !== 0 || core.evidenceDigest !== null || core.reviewRequestId !== null
    || CURRENT_CORE_OPTIONAL.some((field) => field !== "canonicalDescendantProof" && Object.hasOwn(core, field))) failures.push(`${label} claim evidence is invalid`);
}
function checkPromotion(entry, previous, records, latest, failures, label) {
  const core = entry.claimCore, prior = previous.claimCore;
  const peers = overlapping(records, core), reserved = peers.some(({ entry: peer, state }) => peer.claimId !== entry.claimId && RESERVATION_STATES.has(state));
  const eligible = peers
    .filter(({ state }) => state === "waiting-successor").sort(waitingOrder);
  const predecessor = latest.get(prior.predecessorClaimId);
  if (!predecessor || effectiveState(predecessor, entry.evaluationTime) !== "retired" || reserved
    || eligible[0]?.entry.claimId !== entry.claimId || core.promotedAt !== entry.evaluationTime
    || Date.parse(core.expiresAt) <= Date.parse(entry.evaluationTime)
    || changed(core, prior, [...REVIEW_FIELDS, ...PROJECTION_FIELDS.filter((field) => field !== "promotedAt"), "heartbeatCounter", "integration", "retirement"])) {
    failures.push(`${label} successor promotion is invalid`);
  }
}
function checkContinue(entry, previous, records, latest, failures, label) {
  if (!previous) return failures.push(`${label} continue state is invalid`);
  const core = entry.claimCore, prior = { ...previous.claimCore, eligibleSince: previous.claimCore.eligibleSince ?? null }, state = effectiveState(previous, entry.evaluationTime);
  const recorded = recordedState(previous), heartbeatDelta = core.heartbeatCounter - prior.heartbeatCounter;
  const stableProjection = [...PROJECTION_FIELDS, "integration", "retirement"];
  if (state === "waiting-successor" && core.state === "current") return checkPromotion(entry, previous, records, latest, failures, label);
  if (state === "dormant-preserved") {
    const restored = ["reviewed", "integrated-preserved"].includes(recorded) ? recorded : "current";
    const peerReservation = overlapping(records, core)
      .some(({ entry: peer, state: peerState }) => peer.claimId !== entry.claimId && RESERVATION_STATES.has(peerState));
    if (core.state !== restored || !core.recovery || core.recovery.recoveredAt !== entry.evaluationTime
      || Date.parse(core.expiresAt) <= Date.parse(entry.evaluationTime) || peerReservation || heartbeatDelta !== 0
      || changed(core, prior, [...REVIEW_FIELDS, "eligibleSince", "handoffEvidenceDigest", "promotedAt", "integration", "retirement"])) {
      failures.push(`${label} dormant recovery is invalid`);
    }
    return;
  }
  if (state === "current" && core.state === "current") {
    const projection = heartbeatDelta === 0 && core.expiresAt === prior.expiresAt
      && !changed(core, prior, ["deviceId", "sessionId", "eligibleSince", "handoffEvidenceDigest", "promotedAt", "recovery", "integration", "retirement", "evidenceDigest"]);
    const renewal = heartbeatDelta === 1 && Date.parse(core.expiresAt) > Date.parse(prior.expiresAt)
      && !changed(core, prior, [...REVIEW_FIELDS, ...stableProjection]);
    if (!projection && !renewal) failures.push(`${label} current continuation is invalid`);
    return;
  }
  if (state === "current" && core.state === "reviewed") {
    if (!core.reviewRequestId || !core.evidenceDigest || core.laneRevision !== prior.laneRevision
      || (prior.reviewRequestId && core.reviewRequestId !== prior.reviewRequestId) || heartbeatDelta !== 0 || core.expiresAt !== prior.expiresAt
      || changed(core, prior, stableProjection)) failures.push(`${label} review continuation is invalid`);
    return;
  }
  if (state === "current" && core.state === "dormant-preserved") {
    if (!core.handoffEvidenceDigest || heartbeatDelta !== 0 || core.expiresAt !== prior.expiresAt
      || changed(core, prior, [...REVIEW_FIELDS, "deviceId", "sessionId", "eligibleSince", "promotedAt", "recovery", "integration", "retirement"])) {
      failures.push(`${label} preservation evidence is invalid`);
    }
    return;
  }
  if (state === "reviewed" && core.state === "reviewed") {
    const repeated = heartbeatDelta === 0 && core.expiresAt === prior.expiresAt;
    const renewal = heartbeatDelta === 1 && Date.parse(core.expiresAt) > Date.parse(prior.expiresAt);
    if ((!repeated && !renewal) || changed(core, prior, [...REVIEW_FIELDS, ...stableProjection])) failures.push(`${label} reviewed continuation is invalid`);
    return;
  }
  if (state === "integrated-preserved" && core.state === "integrated-preserved") {
    if (heartbeatDelta !== 1 || Date.parse(core.expiresAt) <= Date.parse(prior.expiresAt)
      || changed(core, prior, [...REVIEW_FIELDS, ...stableProjection])) failures.push(`${label} integrated continuation is invalid`);
    return;
  }
  failures.push(`${label} continue state is invalid`);
}
function checkIntegrate(entry, previous, failures, label) {
  const core = entry.claimCore, prior = previous && { ...previous.claimCore, eligibleSince: previous.claimCore.eligibleSince ?? null }, integration = core.integration;
  if (!previous || effectiveState(previous, entry.evaluationTime) !== "reviewed" || core.state !== "integrated-preserved" || !integration
    || integration.candidateRevision !== core.laneRevision || integration.reviewRequestId !== core.reviewRequestId
    || integration.focusedEvidenceDigest !== core.evidenceDigest || integration.integratedAt !== entry.evaluationTime
    || changed(core, prior, [...REVIEW_FIELDS, ...PROJECTION_FIELDS, "expiresAt", "heartbeatCounter", "retirement"])) {
    failures.push(`${label} typed integration evidence is invalid`);
  }
}
function checkRetire(entry, previous, receipt, failures, label) {
  const core = entry.claimCore, prior = previous && { ...previous.claimCore, eligibleSince: previous.claimCore.eligibleSince ?? null }, retirement = core.retirement;
  const integrated = recordedState(previous) === "integrated-preserved";
  if (!previous || effectiveState(previous, entry.evaluationTime) === "retired" || core.state !== "retired" || !retirement
    || retirement.finalRevision !== core.laneRevision || retirement.reviewRequestId !== core.reviewRequestId || retirement.retiredAt !== entry.evaluationTime
    || integrated !== (retirement.reason === "integrated") || retirement.integrationReceiptDigest !== (integrated ? receipt : null)
    || changed(core, prior, [...REVIEW_FIELDS, ...PROJECTION_FIELDS, "expiresAt", "heartbeatCounter", "integration"])) {
    failures.push(`${label} typed retirement evidence is invalid`);
  }
}
function checkHistorical(entry, previous, failures, label) {
  const core = entry.claimCore, prior = previous?.claimCore, delta = previous ? core.heartbeatCounter - prior.heartbeatCounter : 0;
  if (entry.action === "claim" && core.state !== "active") failures.push(`${label} claim state is invalid`);
  if (entry.action === "bind" && (!previous || prior.state !== "active" || core.state !== "active")) failures.push(`${label} bind state is invalid`);
  if (entry.action === "heartbeat" && (!previous || core.state !== prior.state || delta !== 1)) failures.push(`${label} heartbeat state is invalid`);
  if (entry.action === "review-ready" && (!previous || prior.state !== "active" || core.state !== "review-ready")) failures.push(`${label} review-ready state is invalid`);
  if (entry.action === "delivery-authorize" && (!previous || prior.state !== "review-ready" || core.state !== "delivery-authorized")) failures.push(`${label} delivery-authorize state is invalid`);
  if (entry.action === "handoff" && core.state !== "parked") failures.push(`${label} handoff state is invalid`);
  if (entry.action === "release" && core.state !== "released") failures.push(`${label} release state is invalid`);
  if (previous && !["heartbeat"].includes(entry.action) && delta !== 0) failures.push(`${label} changed heartbeat counter outside heartbeat`);
  if (previous && !["bind"].includes(entry.action) && core.laneRevision !== prior.laneRevision) failures.push(`${label} changed lane outside bind`);
  if (previous && entry.action !== "heartbeat" && core.expiresAt !== prior.expiresAt) failures.push(`${label} changed expiry outside heartbeat`);
}
export function validateLedger(ledger) {
  const failures = [];
  if (!ledger || typeof ledger !== "object" || Array.isArray(ledger)) return ["ledger must be an object"];
  if (!exactRecord(ledger, ["schema", "ledgerRepositoryId", "sequence", "headDigest", "entries"])) failures.push("ledger shape is invalid");
  if (ledger.schema !== LEDGER_SCHEMA) failures.push(`ledger.schema must be ${LEDGER_SCHEMA}`);
  if (typeof ledger.ledgerRepositoryId !== "string" || !ledger.ledgerRepositoryId.trim()) failures.push("ledger.ledgerRepositoryId is required");
  if (!Array.isArray(ledger.entries)) return [...failures, "ledger.entries must be an array"];
  if (ledger.sequence !== ledger.entries.length) failures.push("ledger.sequence must equal entries.length");
  let parentDigest = null, previousEvaluation = -Infinity;
  const latest = new Map(), keys = new Set(), epochs = new Map(), integrationReceipts = new Map(), legacyLineages = new Set();
  for (let index = 0; index < ledger.entries.length; index += 1) {
    const entry = ledger.entries[index], label = `entries[${index}]`;
    if (!entry || typeof entry !== "object") { failures.push(`${label} must be an object`); continue; }
    const currentEntry = entry.schema === ENTRY_SCHEMA, historicalEntry = entry.schema === LEGACY_ENTRY_SCHEMA;
    if (historicalEntry && entry.action === "claim") legacyLineages.add(entry.claimId);
    if (!currentEntry && !historicalEntry) failures.push(`${label}.schema is invalid`);
    if (currentEntry && !exactRecord(entry, ["schema", "sequence", "parentDigest", "action", "repositoryId", "claimId", "idempotencyKey", "requestDigest", "evaluationTime", "claimCore", "claimDigest", "digest"])) failures.push(`${label} shape is invalid`);
    if (entry.sequence !== index + 1) failures.push(`${label}.sequence is invalid`);
    if (entry.parentDigest !== parentDigest) failures.push(`${label}.parentDigest is invalid`);
    if (typeof entry.repositoryId !== "string" || !entry.repositoryId.trim()) failures.push(`${label}.repositoryId is invalid`);
    if ((currentEntry && !MUTATING_ACTIONS.has(entry.action)) || (historicalEntry && entry.action !== "claim" && !HISTORICAL_ACTIONS.has(entry.action)) || (!currentEntry && !historicalEntry)) failures.push(`${label}.action is invalid`);
    for (const field of ["claimId", "idempotencyKey", "requestDigest"]) if (!DIGEST_PATTERN.test(entry[field] ?? "")) failures.push(`${label}.${field} is invalid`);
    if (keys.has(entry.idempotencyKey)) failures.push(`${label}.idempotencyKey duplicates an earlier transition`);
    keys.add(entry.idempotencyKey);
    const evaluation = Date.parse(entry.evaluationTime);
    if (!validInstant(entry.evaluationTime)) failures.push(`${label}.evaluationTime is invalid`);
    else if (evaluation < previousEvaluation) failures.push(`${label}.evaluationTime is not monotonic`);
    if (Number.isFinite(evaluation)) previousEvaluation = Math.max(previousEvaluation, evaluation);
    const core = entry.claimCore, previous = latest.get(entry.claimId);
    if (!core || typeof core !== "object") failures.push(`${label}.claimCore is invalid`);
    else {
      if (currentEntry && !validCurrentCoreShape(core)) failures.push(`${label}.claimCore shape is invalid`);
      if (core.claimId !== entry.claimId) failures.push(`${label}.claimCore.claimId is invalid`);
      if (core.repositoryId !== entry.repositoryId) failures.push(`${label}.claimCore.repositoryId is invalid`);
      const validState = historicalEntry ? Object.hasOwn(LEGACY_STATES, core.state) : CLAIM_STATES.has(core.state) && !Object.hasOwn(LEGACY_STATES, core.state);
      if (!validState) failures.push(`${label}.claimCore.state is invalid`);
      if (!Number.isSafeInteger(core.transitionCounter) || core.transitionCounter < 1 || !Number.isSafeInteger(core.heartbeatCounter) || core.heartbeatCounter < 0) failures.push(`${label}.claimCore counters are invalid`);
      try {
        const scope = normalizeWriteSet(core.declaredWriteScope);
        if (!same(scope, core.declaredWriteScope) || digestValue(scope) !== core.writeSetDigest) failures.push(`${label}.claimCore write scope is invalid`);
        if (!validInstant(core.expiresAt)) failures.push(`${label}.claimCore.expiresAt is invalid`);
      } catch { failures.push(`${label}.claimCore scope or expiry is invalid`); }
      if (!previous && (entry.action !== "claim" || core.transitionCounter !== 1)) failures.push(`${label} must start with claim counter 1`);
      if (previous && (entry.action === "claim" || core.transitionCounter !== previous.claimCore.transitionCounter + 1
        || core.leaseEpoch !== previous.claimCore.leaseEpoch || core.writeSetDigest !== previous.claimCore.writeSetDigest)) failures.push(`${label} violates monotonic claim history`);
      if (previous) {
        const immutable = [...IDENTITY_FIELDS, ...(historicalEntry ? ["deviceId", "sessionId"] : [])];
        if (changed(core, previous.claimCore, immutable) || (currentEntry && core.eligibleSince !== (previous.claimCore.eligibleSince ?? null))) failures.push(`${label} changed immutable claim identity`);
      }
      if (entry.action === "claim") {
        const epochKey = canonicalJson([core.repositoryId, core.workItemId, core.writeSetDigest]), expectedEpoch = (epochs.get(epochKey) ?? 0) + 1;
        if (core.leaseEpoch !== expectedEpoch) failures.push(`${label}.claimCore.leaseEpoch must be ${expectedEpoch}`);
        epochs.set(epochKey, Math.max(epochs.get(epochKey) ?? 0, core.leaseEpoch));
        const identity = { actorId: core.actorId, canonicalBaseRevision: core.canonicalBaseRevision, leaseEpoch: core.leaseEpoch, repositoryId: core.repositoryId, workItemId: core.workItemId, writeSetDigest: core.writeSetDigest };
        const expectedClaimId = digestValue(historicalEntry ? { ...identity, deviceId: core.deviceId, sessionId: core.sessionId } : identity);
        if (core.claimId !== expectedClaimId) failures.push(`${label}.claimCore.claimId is not content-derived`);
      }
      const records = currentRecords(latest, legacyLineages, entry.evaluationTime);
      if (historicalEntry) checkHistorical(entry, previous, failures, label);
      else if (entry.action === "claim") checkClaim(entry, records, latest, failures, label);
      else if (entry.action === "continue") checkContinue(entry, previous, records, latest, failures, label);
      else if (entry.action === "integrate") checkIntegrate(entry, previous, failures, label);
      else checkRetire(entry, previous, integrationReceipts.get(entry.claimId) ?? null, failures, label);
      const introducesReservation = !previous || !RESERVATION_STATES.has(effectiveState(previous, entry.evaluationTime));
      if (currentEntry && introducesReservation && RESERVATION_STATES.has(effectiveState(entry, entry.evaluationTime))) {
        const collision = overlapping(records, core)
          .some(({ entry: peer, state }) => peer.claimId !== entry.claimId && RESERVATION_STATES.has(state));
        if (collision) failures.push(`${label} creates overlapping scope reservations`);
      }
      if (currentEntry && entry.action === "integrate") integrationReceipts.set(entry.claimId, integrationReceiptDigest(entry));
      latest.set(entry.claimId, entry);
    }
    const { digest: observedDigest, ...draft } = entry;
    try {
      if (entry.claimCore && entry.claimDigest !== digestValue(entry.claimCore)) failures.push(`${label}.claimDigest is invalid`);
      if (observedDigest !== digestValue(draft)) failures.push(`${label}.digest is invalid`);
    } catch { failures.push(`${label} is not canonical JSON`); }
    parentDigest = observedDigest;
  }
  if (ledger.headDigest !== parentDigest) failures.push("ledger.headDigest is invalid");
  return failures;
}
