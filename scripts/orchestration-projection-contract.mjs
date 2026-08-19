// Responsibility: Own orchestration projection schema identifiers, failure reasons, receipt descriptors, and structural validation.
export const PROJECTION_SCHEMA_ID = "agentic-orchestration-projection/v1";

export const FAILURE_REASONS = Object.freeze([
  "input-absent",
  "malformed-json",
  "schema-id-mismatch",
  "schema-validation-failed",
  "stale-observation",
  "budget-exceeded",
]);

export const LANE_CLAIM_STATES = Object.freeze([
  "current",
  "waiting-successor",
  "reviewed",
  "integrated-preserved",
  "dormant-preserved",
  "retired",
]);

export const RECEIPT_INPUTS = Object.freeze([
  {
    schemaId: "agentic-collaboration-gate-result/v2",
    slug: "collaboration-gate-result.v2",
    formal: false,
    timestampPath: null,
    consumedFields: ["schema", "status"],
    redactedFields: [],
  },
  {
    schemaId: "agentic-coordination-scheduler-report/v1",
    slug: "coordination-scheduler-report.v1",
    formal: true,
    schemaPath: "docs/schemas/coordination-scheduler-report.v1.schema.json",
    timestampPath: null,
    consumedFields: ["schema", "summary", "waves", "ready", "waiting", "blocked"],
    redactedFields: [],
  },
  {
    schemaId: "agentic-local-runtime-readiness/v1",
    slug: "local-runtime-readiness.v1",
    formal: true,
    schemaPath: "docs/schemas/local-runtime-readiness.v1.schema.json",
    timestampPath: ["verifiedAt", "startedAt"],
    consumedFields: ["schema", "status", "source", "agenticCanvasOs", "verifiedAt", "startedAt"],
    redactedFields: ["ownershipTokenDigest"],
  },
  {
    schemaId: "agentic-workspace-parallelism-report/v1",
    slug: "workspace-parallelism-report.v1",
    formal: false,
    timestampPath: "generatedAt",
    consumedFields: ["schema", "generatedAt", "repositories", "lanes", "summary"],
    redactedFields: [],
  },
  {
    schemaId: "agentic-worktree-lifecycle-report/v1",
    slug: "worktree-lifecycle-report.v1",
    formal: false,
    timestampPath: null,
    consumedFields: ["schema", "repository", "canonicalSha", "status", "worktrees"],
    redactedFields: [],
  },
  {
    schemaId: "agentic-writer-lease-registry/v2",
    slug: "writer-lease-registry.v2",
    formal: false,
    timestampPath: "leases[].heartbeatAt",
    consumedFields: ["schema", "leases"],
    redactedFields: ["sessionId", "ownershipTokenDigest"],
  },
]);

export const RECEIPT_BY_SCHEMA = new Map(RECEIPT_INPUTS.map((input) => [input.schemaId, input]));

export function validateStructural(schemaId, value) {
  const descriptor = RECEIPT_BY_SCHEMA.get(schemaId);
  if (!descriptor) return failure("schema-id-mismatch", { expected: [...RECEIPT_BY_SCHEMA.keys()], observed: schemaId });
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return failure("schema-validation-failed", { expected: "object", observed: typeof value });
  }
  if (value.schema !== schemaId) {
    return failure("schema-id-mismatch", { expected: schemaId, observed: value.schema ?? null });
  }
  for (const field of descriptor.consumedFields) {
    if (!(field in value)) return failure("schema-validation-failed", { expected: field, observed: "absent" });
  }
  if (schemaId === "agentic-writer-lease-registry/v2") {
    const leases = Array.isArray(value.leases) ? value.leases : [];
    for (const lease of leases) {
      if (lease?.state && !LANE_CLAIM_STATES.includes(lease.state)) {
        return failure("schema-validation-failed", { expected: "Lane_Claim_State", observed: lease.state });
      }
      const redactionFailure = validateRedactedFields(schemaId, lease);
      if (redactionFailure) return redactionFailure;
    }
  }
  return validateRedactedFields(schemaId, value);
}

export function validateRedactedFields(schemaId, value) {
  const descriptor = RECEIPT_BY_SCHEMA.get(schemaId);
  for (const field of descriptor?.redactedFields || []) {
    const observed = value?.[field];
    if (typeof observed === "string" && observed.trim() && !isRedactedValue(observed)) {
      return failure("schema-validation-failed", { expected: field + " redacted", observed: field });
    }
  }
  return null;
}

export function observationTimestampFor(schemaId, value) {
  if (schemaId === "agentic-local-runtime-readiness/v1") return value.verifiedAt || value.startedAt || null;
  if (schemaId === "agentic-workspace-parallelism-report/v1") return value.generatedAt || null;
  if (schemaId === "agentic-writer-lease-registry/v2") {
    return (Array.isArray(value.leases) ? value.leases : [])
      .map((lease) => lease.heartbeatAt || lease.acquiredAt || lease.expiresAt || null)
      .filter(Boolean)
      .sort()
      .at(-1) || null;
  }
  return null;
}

function isRedactedValue(value) {
  return value === "<redacted>" || value === "[redacted]";
}
function failure(reason, detail) { return { reason, detail }; }
