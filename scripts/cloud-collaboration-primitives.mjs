import { createHash } from "node:crypto";

export const LEDGER_SCHEMA = "agentic-cloud-collaboration-ledger/v1";
export const RECEIPT_SCHEMA = "agentic-cloud-collaboration-receipt/v1";
export const ENTRY_SCHEMA = "agentic-cloud-collaboration-entry/v1";
export const CLOUD_COLLABORATION_BOUNDS = Object.freeze({
  ledgerEntries: 512,
  activeClaims: 128,
  writeScopeItems: 128,
  textCharacters: 512,
});
export const MUTATING_ACTIONS = new Set([
  "claim",
  "bind",
  "heartbeat",
  "review-ready",
  "handoff",
  "release",
]);

const CLAIM_STATES = new Set(["active", "review-ready", "parked", "released"]);
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

export function createEmptyLedger(ledgerRepository) {
  const { repositoryId: ledgerRepositoryId } = normalizeRepository(ledgerRepository);
  return { schema: LEDGER_SCHEMA, ledgerRepositoryId, sequence: 0, headDigest: null, entries: [] };
}

export function validateLedger(ledger) {
  const failures = [];
  if (!ledger || typeof ledger !== "object" || Array.isArray(ledger)) return ["ledger must be an object"];
  if (ledger.schema !== LEDGER_SCHEMA) failures.push(`ledger.schema must be ${LEDGER_SCHEMA}`);
  if (typeof ledger.ledgerRepositoryId !== "string" || !ledger.ledgerRepositoryId.trim()) {
    failures.push("ledger.ledgerRepositoryId is required");
  }
  if (!Array.isArray(ledger.entries)) return [...failures, "ledger.entries must be an array"];
  if (ledger.entries.length > CLOUD_COLLABORATION_BOUNDS.ledgerEntries) failures.push("ledger entry bound exceeded");
  if (ledger.sequence !== ledger.entries.length) failures.push("ledger.sequence must equal entries.length");
  let parentDigest = null;
  const latest = new Map();
  const keys = new Map();
  const epochs = new Map();
  for (let index = 0; index < ledger.entries.length; index += 1) {
    const entry = ledger.entries[index];
    const label = `entries[${index}]`;
    if (!entry || typeof entry !== "object") {
      failures.push(`${label} must be an object`);
      continue;
    }
    if (entry.schema !== ENTRY_SCHEMA) failures.push(`${label}.schema is invalid`);
    if (entry.sequence !== index + 1) failures.push(`${label}.sequence is invalid`);
    if (entry.parentDigest !== parentDigest) failures.push(`${label}.parentDigest is invalid`);
    if (typeof entry.repositoryId !== "string" || !entry.repositoryId.trim()) {
      failures.push(`${label}.repositoryId is invalid`);
    }
    if (!MUTATING_ACTIONS.has(entry.action)) failures.push(`${label}.action is invalid`);
    if (!DIGEST_PATTERN.test(entry.claimId ?? "")) failures.push(`${label}.claimId is invalid`);
    if (!DIGEST_PATTERN.test(entry.idempotencyKey ?? "")) failures.push(`${label}.idempotencyKey is invalid`);
    if (!DIGEST_PATTERN.test(entry.requestDigest ?? "")) failures.push(`${label}.requestDigest is invalid`);
    if (keys.has(entry.idempotencyKey)) {
      failures.push(`${label}.idempotencyKey duplicates an earlier transition`);
    }
    keys.set(entry.idempotencyKey, entry.requestDigest);
    try {
      if (instant(entry.evaluationTime, `${label}.evaluationTime`) !== entry.evaluationTime) {
        failures.push(`${label}.evaluationTime is not canonical`);
      }
    } catch {
      failures.push(`${label}.evaluationTime is invalid`);
    }
    if (!entry.claimCore || typeof entry.claimCore !== "object") {
      failures.push(`${label}.claimCore is invalid`);
    } else {
      const core = entry.claimCore;
      if (core.claimId !== entry.claimId) failures.push(`${label}.claimCore.claimId is invalid`);
      if (core.repositoryId !== entry.repositoryId) failures.push(`${label}.claimCore.repositoryId is invalid`);
      if (!CLAIM_STATES.has(core.state)) failures.push(`${label}.claimCore.state is invalid`);
      if (!Number.isSafeInteger(core.transitionCounter) || core.transitionCounter < 1) {
        failures.push(`${label}.claimCore.transitionCounter is invalid`);
      }
      if (!Number.isSafeInteger(core.heartbeatCounter) || core.heartbeatCounter < 0) {
        failures.push(`${label}.claimCore.heartbeatCounter is invalid`);
      }
      const previous = latest.get(entry.claimId);
      try {
        const normalizedScope = normalizeWriteSet(core.declaredWriteScope);
        if (
          canonicalJson(normalizedScope) !== canonicalJson(core.declaredWriteScope)
          || digestValue(normalizedScope) !== core.writeSetDigest
        ) failures.push(`${label}.claimCore write scope is invalid`);
        if (instant(core.expiresAt, `${label}.claimCore.expiresAt`) !== core.expiresAt) {
          failures.push(`${label}.claimCore.expiresAt is not canonical`);
        }
      } catch {
        failures.push(`${label}.claimCore scope or expiry is invalid`);
      }
      if (!previous && (entry.action !== "claim" || core.transitionCounter !== 1)) {
        failures.push(`${label} must start with claim counter 1`);
      }
      if (previous && (
        entry.action === "claim"
        || core.transitionCounter !== previous.claimCore.transitionCounter + 1
        || core.leaseEpoch !== previous.claimCore.leaseEpoch
        || core.writeSetDigest !== previous.claimCore.writeSetDigest
      )) {
        failures.push(`${label} violates monotonic claim history`);
      }
      if (previous) {
        const stableFields = [
          "actorId",
          "deviceId",
          "sessionId",
          "repositoryId",
          "workItemId",
          "canonicalBaseRevision",
          "declaredWriteScope",
          "writeSetDigest",
          "leaseEpoch",
          "predecessorClaimId",
        ];
        if (stableFields.some((field) => canonicalJson(core[field]) !== canonicalJson(previous.claimCore[field]))) {
          failures.push(`${label} changed immutable claim identity`);
        }
        if (entry.action !== "bind" && core.laneRevision !== previous.claimCore.laneRevision) {
          failures.push(`${label} changed lane outside bind`);
        }
        if (entry.action !== "heartbeat" && core.expiresAt !== previous.claimCore.expiresAt) {
          failures.push(`${label} changed expiry outside heartbeat`);
        }
      }
      if (entry.action === "heartbeat" && previous
        && core.heartbeatCounter !== previous.claimCore.heartbeatCounter + 1) {
        failures.push(`${label} violates heartbeat counter monotonicity`);
      }
      if (entry.action !== "heartbeat" && previous
        && core.heartbeatCounter !== previous.claimCore.heartbeatCounter) {
        failures.push(`${label} changed heartbeat counter outside heartbeat`);
      }
      if (entry.action === "claim") {
        const epochKey = canonicalJson([core.repositoryId, core.workItemId, core.writeSetDigest]);
        const expectedEpoch = (epochs.get(epochKey) ?? 0) + 1;
        if (core.leaseEpoch !== expectedEpoch) failures.push(`${label}.claimCore.leaseEpoch must be ${expectedEpoch}`);
        epochs.set(epochKey, Math.max(epochs.get(epochKey) ?? 0, core.leaseEpoch));
        const expectedClaimId = digestValue({
          actorId: core.actorId,
          canonicalBaseRevision: core.canonicalBaseRevision,
          deviceId: core.deviceId,
          leaseEpoch: core.leaseEpoch,
          repositoryId: core.repositoryId,
          sessionId: core.sessionId,
          workItemId: core.workItemId,
          writeSetDigest: core.writeSetDigest,
        });
        if (core.claimId !== expectedClaimId) failures.push(`${label}.claimCore.claimId is not content-derived`);
      }
      if (entry.action === "claim" && core.state !== "active") failures.push(`${label} claim state must be active`);
      if (entry.action === "bind" && (!previous || previous.claimCore.state !== "active" || core.state !== "active")) {
        failures.push(`${label} bind state is invalid`);
      }
      if (entry.action === "heartbeat" && previous && core.state !== previous.claimCore.state) {
        failures.push(`${label} heartbeat changed state`);
      }
      if (entry.action === "review-ready"
        && (!previous || previous.claimCore.state !== "active" || core.state !== "review-ready")) {
        failures.push(`${label} review-ready state is invalid`);
      }
      if (entry.action === "handoff" && core.state !== "parked") failures.push(`${label} handoff state is invalid`);
      if (entry.action === "release" && core.state !== "released") failures.push(`${label} release state is invalid`);
      latest.set(entry.claimId, entry);
    }
    const { digest: observedDigest, ...draft } = entry;
    let computedDigest = null;
    try {
      computedDigest = digestValue(draft);
      if (entry.claimCore && entry.claimDigest !== digestValue(entry.claimCore)) {
        failures.push(`${label}.claimDigest is invalid`);
      }
    } catch {
      failures.push(`${label} is not canonical JSON`);
    }
    if (observedDigest !== computedDigest) failures.push(`${label}.digest is invalid`);
    parentDigest = observedDigest;
  }
  if (ledger.headDigest !== parentDigest) failures.push("ledger.headDigest is invalid");
  const consumed = new Set([...latest.values()].map((entry) => entry.claimCore.predecessorClaimId).filter(Boolean));
  const evaluatedAt = ledger.entries.at(-1)?.evaluationTime;
  const activeClaims = [...latest.values()].filter((entry) => (
    !consumed.has(entry.claimId)
    && entry.claimCore.state !== "released"
    && (!evaluatedAt || Date.parse(entry.claimCore.expiresAt) > Date.parse(evaluatedAt))
  ));
  if (activeClaims.length > CLOUD_COLLABORATION_BOUNDS.activeClaims) failures.push("active claim bound exceeded");
  return failures;
}
