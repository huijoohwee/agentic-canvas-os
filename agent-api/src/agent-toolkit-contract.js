import { normalizeJson, serializedJsonLength } from "./json-contract.js";
import { normalizeCostLog } from "./running-agent-contract.js";

export const AGENT_TOOLKIT_RUN_SCHEMA = "agent-toolkit-run/v1";
export const AGENT_TOOLKIT_COHORT_SCHEMA = "agent-toolkit-cohort/v1";

export const AGENT_TOOLKIT_DEFAULTS = Object.freeze({
  maxSpans: 128,
  maxSamples: 64,
  maxProposals: 16,
  maxRecordChars: 300_000,
  runTtlMs: 30 * 60_000,
  cohortTtlMs: 7 * 24 * 60 * 60_000,
  operationTimeoutMs: 60_000,
  evaluationLeaseMs: 90_000,
  storeClaimTtlMs: 10_000,
  storeClaimAttempts: 8,
  storeClaimRetryMs: 5,
  maxEvaluationAttempts: 2,
  comparison: Object.freeze({
    minSamples: 2,
    qualityBoundary: 0,
    minimumQualityImprovement: 0,
    maxLatencyRegressionRatio: 1,
    maxCostRegressionRatio: 1,
  }),
});

const TARGET_KINDS = new Set(["agent", "team"]);
const SPAN_KINDS = new Set(["agent", "team", "workflow", "model", "tool", "evaluator", "other"]);
const TERMINAL_STATUSES = new Set(["completed", "failed", "canceled"]);
const DIRECTIONS = new Set(["maximize", "minimize"]);
const TELEMETRY_TRUST = new Set(["server-observed", "application-verified", "remote-unverified"]);
const REASON_CODES = new Set([
  "aborted", "adapter_failed", "component_failed", "cost_log_invalid", "model_failed",
  "operator_cancelled", "run_terminal", "timeout", "tool_failed", "workflow_failed",
]);
const MACHINE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]*$/;
const MAX_METRIC_MAGNITUDE = 1_000_000_000_000;
const MAX_TOKEN_COUNT = 1_000_000_000_000;
const MAX_COST_USD = 1_000_000_000;

export class AgentToolkitBlock extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = "AgentToolkitBlock";
    this.reasonCode = reasonCode;
  }
}

export function assertExactKeys(value, keys, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${field} must be an object.`);
  const unknown = Object.keys(value).filter((key) => !keys.includes(key));
  if (unknown.length) throw new TypeError(`${field} contains unsupported fields: ${unknown.join(", ")}.`);
}

export function assertIdentifier(value, field, maxChars = 256) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} must be a non-empty string.`);
  const normalized = value.trim();
  if (normalized.length > maxChars) throw new RangeError(`${field} exceeds ${maxChars} characters.`);
  if (!MACHINE_TOKEN.test(normalized)) throw new TypeError(`${field} must be an opaque machine token.`);
  return normalized;
}

function assertDigest(value, field) {
  const digest = assertIdentifier(value, field, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new TypeError(`${field} must be a SHA-256 digest.`);
  return digest;
}

function normalizeSignal(value, field) {
  if (value !== undefined && (
    typeof value?.aborted !== "boolean"
    || typeof value?.addEventListener !== "function"
    || typeof value?.removeEventListener !== "function"
  )) throw new TypeError(`${field} must be an AbortSignal when provided.`);
  return value;
}

export function normalizeAccessContext(value = {}) {
  assertExactKeys(value, ["principalId", "principalExpiresAt", "telemetryTrust"], "access context");
  if (value.principalExpiresAt !== undefined && !Number.isFinite(value.principalExpiresAt)) {
    throw new TypeError("access context.principalExpiresAt must be a finite timestamp when provided.");
  }
  const telemetryTrust = value.telemetryTrust ?? "application-verified";
  if (!TELEMETRY_TRUST.has(telemetryTrust)) throw new TypeError("access context.telemetryTrust is unsupported.");
  return Object.freeze({
    principalId: assertIdentifier(value.principalId ?? "application-local", "access context.principalId"),
    ...(value.principalExpiresAt === undefined ? {} : { principalExpiresAt: value.principalExpiresAt }),
    telemetryTrust,
  });
}

function normalizeRevisionRef(value, field) {
  assertExactKeys(value, ["id", "revision", "digest"], field);
  return Object.freeze({
    id: assertIdentifier(value.id, `${field}.id`),
    revision: assertIdentifier(value.revision, `${field}.revision`),
    digest: assertDigest(value.digest, `${field}.digest`),
  });
}

export function normalizeCandidate(value, field = "candidate") {
  assertExactKeys(value, ["id", "revision", "digest"], field);
  return Object.freeze({
    id: assertIdentifier(value.id, `${field}.id`),
    revision: assertIdentifier(value.revision, `${field}.revision`),
    digest: assertDigest(value.digest, `${field}.digest`),
  });
}

function normalizeTarget(value) {
  assertExactKeys(value, ["kind", "id", "revision", "digest"], "request.target");
  if (!TARGET_KINDS.has(value.kind)) throw new TypeError("request.target.kind must be agent or team.");
  return Object.freeze({
    kind: value.kind,
    id: assertIdentifier(value.id, "request.target.id"),
    revision: assertIdentifier(value.revision, "request.target.revision"),
    digest: assertDigest(value.digest, "request.target.digest"),
  });
}

function normalizeMetric(value, field = "request.profile.metric") {
  assertExactKeys(value, ["id", "revision", "digest", "direction"], field);
  if (!DIRECTIONS.has(value.direction)) throw new TypeError(`${field}.direction is unsupported.`);
  return Object.freeze({
    id: assertIdentifier(value.id, `${field}.id`),
    revision: assertIdentifier(value.revision, `${field}.revision`),
    digest: assertDigest(value.digest, `${field}.digest`),
    direction: value.direction,
  });
}

function normalizeProfile(value) {
  assertExactKeys(value, ["evaluator", "dataset", "metric"], "request.profile");
  return Object.freeze({
    evaluator: normalizeRevisionRef(value.evaluator, "request.profile.evaluator"),
    dataset: normalizeRevisionRef(value.dataset, "request.profile.dataset"),
    metric: normalizeMetric(value.metric),
  });
}

export function normalizeStartRequest(value) {
  assertExactKeys(value, [
    "runId", "cohortId", "target", "candidate", "adapter", "operation", "profile", "signal",
  ], "request");
  return Object.freeze({
    runId: assertIdentifier(value.runId, "request.runId"),
    cohortId: assertIdentifier(value.cohortId, "request.cohortId"),
    target: normalizeTarget(value.target),
    candidate: normalizeCandidate(value.candidate, "request.candidate"),
    adapter: normalizeRevisionRef(value.adapter, "request.adapter"),
    operation: assertIdentifier(value.operation, "request.operation"),
    profile: normalizeProfile(value.profile),
    signal: normalizeSignal(value.signal, "request.signal"),
  });
}

export function normalizeSpanStartRequest(value) {
  assertExactKeys(value, ["runId", "spanId", "parentSpanId", "kind", "operation", "component"], "request");
  if (!SPAN_KINDS.has(value.kind)) throw new TypeError("request.kind is unsupported.");
  return Object.freeze({
    runId: assertIdentifier(value.runId, "request.runId"),
    spanId: assertIdentifier(value.spanId, "request.spanId"),
    ...(value.parentSpanId === undefined
      ? {}
      : { parentSpanId: assertIdentifier(value.parentSpanId, "request.parentSpanId") }),
    kind: value.kind,
    operation: assertIdentifier(value.operation, "request.operation"),
    component: normalizeRevisionRef(value.component, "request.component"),
  });
}

export function normalizeSpanFinishRequest(value) {
  assertExactKeys(value, ["runId", "spanId", "status", "reasonCode"], "request");
  if (!TERMINAL_STATUSES.has(value.status)) throw new TypeError("request.status is unsupported.");
  if (value.status === "completed" && value.reasonCode !== undefined) {
    throw new TypeError("Completed spans cannot include a reasonCode.");
  }
  return Object.freeze({
    runId: assertIdentifier(value.runId, "request.runId"),
    spanId: assertIdentifier(value.spanId, "request.spanId"),
    status: value.status,
    ...(value.reasonCode === undefined ? {} : { reasonCode: normalizeReasonCode(value.reasonCode, "request.reasonCode") }),
  });
}

export function normalizeCompleteRequest(value) {
  assertExactKeys(value, ["runId", "operationId", "status", "reasonCode", "costLog"], "request");
  if (!TERMINAL_STATUSES.has(value.status)) throw new TypeError("request.status is unsupported.");
  if (value.status === "completed" && value.reasonCode !== undefined) {
    throw new TypeError("Completed runs cannot include a reasonCode.");
  }
  return Object.freeze({
    runId: assertIdentifier(value.runId, "request.runId"),
    operationId: assertIdentifier(value.operationId, "request.operationId"),
    status: value.status,
    ...(value.reasonCode === undefined ? {} : { reasonCode: normalizeReasonCode(value.reasonCode, "request.reasonCode") }),
    costLog: normalizeToolkitCostLog(value.costLog),
  });
}

export function normalizeEvidenceRef(value, field = "request.evidence") {
  assertExactKeys(value, ["id", "digest"], field);
  return Object.freeze({
    id: assertIdentifier(value.id, `${field}.id`),
    digest: assertDigest(value.digest, `${field}.digest`),
  });
}

export function normalizeEvaluateRequest(value) {
  assertExactKeys(value, ["runId", "operationId", "evidence", "signal"], "request");
  return Object.freeze({
    runId: assertIdentifier(value.runId, "request.runId"),
    operationId: assertIdentifier(value.operationId, "request.operationId"),
    evidence: normalizeEvidenceRef(value.evidence),
    signal: normalizeSignal(value.signal, "request.signal"),
  });
}

export function normalizeEvaluationOutcome(value, expectedMetric) {
  assertExactKeys(value, ["status", "score", "metric", "evidence", "costLog"], "evaluation outcome");
  if (!["reported", "unreported"].includes(value.status)) {
    throw new TypeError("evaluation outcome.status is unsupported.");
  }
  const metric = normalizeMetric(value.metric, "evaluation outcome.metric");
  if (metric.id !== expectedMetric.id
    || metric.revision !== expectedMetric.revision
    || metric.digest !== expectedMetric.digest
    || metric.direction !== expectedMetric.direction) {
    throw new AgentToolkitBlock("evaluation_metric_mismatch", "Evaluator metric provenance changed.");
  }
  if (value.status === "reported" && (
    !Number.isFinite(value.score) || Math.abs(value.score) > MAX_METRIC_MAGNITUDE
  )) {
    throw new TypeError("evaluation outcome.score must be finite and bounded when reported.");
  }
  if (value.status === "unreported" && value.score !== undefined) {
    throw new TypeError("Unreported evaluation outcomes cannot include a score.");
  }
  return Object.freeze({
    status: value.status,
    metric,
    ...(value.status === "reported" ? { score: value.score } : {}),
    evidence: normalizeEvidenceRef(value.evidence, "evaluation outcome.evidence"),
    costLog: normalizeToolkitCostLog(value.costLog),
  });
}

export function normalizeComparisonPolicy(value, defaults) {
  const source = value === undefined ? defaults : value;
  assertExactKeys(source, [
    "minSamples", "qualityBoundary", "minimumQualityImprovement",
    "maxLatencyRegressionRatio", "maxCostRegressionRatio",
  ], "request.policy");
  if (!Number.isInteger(source.minSamples) || source.minSamples < 1 || source.minSamples > 4_096) {
    throw new TypeError("request.policy.minSamples must be an integer from 1 through 4096.");
  }
  for (const field of [
    "qualityBoundary", "minimumQualityImprovement", "maxLatencyRegressionRatio", "maxCostRegressionRatio",
  ]) {
    if (!Number.isFinite(source[field])
      || Math.abs(source[field]) > MAX_METRIC_MAGNITUDE
      || (field !== "qualityBoundary" && source[field] < 0)) {
      throw new TypeError(`request.policy.${field} must be finite and non-negative.`);
    }
  }
  return Object.freeze({ ...source });
}

export function normalizeCompareRequest(value, defaults) {
  assertExactKeys(value, ["cohortId", "baseline", "candidate", "policy"], "request");
  const baseline = normalizeCandidate(value.baseline, "request.baseline");
  const candidate = normalizeCandidate(value.candidate, "request.candidate");
  if (JSON.stringify(baseline) === JSON.stringify(candidate)) {
    throw new TypeError("request.candidate must differ from request.baseline.");
  }
  return Object.freeze({
    cohortId: assertIdentifier(value.cohortId, "request.cohortId"),
    baseline,
    candidate,
    policy: normalizeComparisonPolicy(value.policy, defaults),
  });
}

export function normalizeProposalRequest(value, defaults) {
  assertExactKeys(value, ["cohortId", "baseline", "candidate", "policy", "operationId"], "request");
  const comparison = normalizeCompareRequest({
    cohortId: value.cohortId,
    baseline: value.baseline,
    candidate: value.candidate,
    policy: value.policy,
  }, defaults);
  return Object.freeze({
    ...comparison,
    operationId: assertIdentifier(value.operationId, "request.operationId"),
  });
}

export function normalizeAuthorization(value) {
  assertExactKeys(value, ["allowed", "authorizationId", "reasonCode"], "authorization");
  if (value.allowed !== true) {
    throw new AgentToolkitBlock(
      "toolkit_denied",
      "Application policy denied the Agent Toolkit operation.",
    );
  }
  return Object.freeze({ authorizationId: assertIdentifier(value.authorizationId, "authorization.authorizationId") });
}

export function normalizeInstrumentOutcome(value) {
  assertExactKeys(value, ["value", "costLog", "evidence"], "instrument outcome");
  return Object.freeze({
    value: value.value,
    costLog: normalizeToolkitCostLog(value.costLog),
    ...(value.evidence === undefined ? {} : { evidence: normalizeEvidenceRef(value.evidence, "instrument outcome.evidence") }),
  });
}

export function normalizeReasonCode(value, field = "reasonCode") {
  const reasonCode = assertIdentifier(value, field, 64);
  if (!REASON_CODES.has(reasonCode)) throw new TypeError(`${field} is unsupported.`);
  return reasonCode;
}

export function normalizeToolkitCostLog(value) {
  const costLog = normalizeCostLog(value);
  if (!costLog) return null;
  assertIdentifier(costLog.model, "costLog.model", 128);
  for (const field of ["prompt_tokens", "completion_tokens", "cache_hits"]) {
    if (!Number.isSafeInteger(costLog[field]) || costLog[field] > MAX_TOKEN_COUNT) {
      throw new AgentToolkitBlock("cost_log_invalid", `costLog.${field} exceeds the Agent Toolkit bound.`);
    }
  }
  if (costLog.estimated_cost_usd > MAX_COST_USD) {
    throw new AgentToolkitBlock("cost_log_invalid", "costLog.estimated_cost_usd exceeds the Agent Toolkit bound.");
  }
  return costLog;
}

export function assertRecordSize(value, limits) {
  const normalized = normalizeJson(value, "agent toolkit record");
  if (serializedJsonLength(normalized) > limits.maxRecordChars) {
    throw new RangeError(`Agent Toolkit record exceeds ${limits.maxRecordChars} characters.`);
  }
  return normalized;
}
