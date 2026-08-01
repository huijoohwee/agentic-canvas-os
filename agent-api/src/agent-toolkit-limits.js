import {
  AGENT_TOOLKIT_DEFAULTS,
  normalizeComparisonPolicy,
} from "./agent-toolkit-contract.js";

const LIMIT_FIELDS = new Set([
  "maxSpans",
  "maxSamples",
  "maxProposals",
  "maxOptimizationCandidates",
  "maxRecordChars",
  "runTtlMs",
  "cohortTtlMs",
  "operationTimeoutMs",
  "evaluationLeaseMs",
  "storeClaimTtlMs",
  "storeClaimAttempts",
  "storeClaimRetryMs",
  "maxEvaluationAttempts",
  "requestWindowMs",
  "maxRequestsPerWindow",
  "maxPrincipalRuns",
  "maxPrincipalCohorts",
  "principalShardCount",
  "maxPrincipalsPerShard",
  "comparison",
]);
const TIMER_MAX_MS = 2_147_483_647;

export function normalizeAgentToolkitLimits(overrides) {
  const unknown = Object.keys(overrides).filter((key) => !LIMIT_FIELDS.has(key));
  if (unknown.length) throw new TypeError(`Unsupported Agent Toolkit limits: ${unknown.join(", ")}.`);
  const limits = {
    ...AGENT_TOOLKIT_DEFAULTS,
    ...overrides,
    comparison: normalizeComparisonPolicy(
      overrides.comparison === undefined
        ? undefined
        : { ...AGENT_TOOLKIT_DEFAULTS.comparison, ...overrides.comparison },
      AGENT_TOOLKIT_DEFAULTS.comparison,
    ),
  };
  for (const field of [
    "maxSpans",
    "maxSamples",
    "maxProposals",
    "maxOptimizationCandidates",
    "maxRecordChars",
    "runTtlMs",
    "cohortTtlMs",
    "operationTimeoutMs",
    "evaluationLeaseMs",
    "storeClaimTtlMs",
    "storeClaimAttempts",
    "maxEvaluationAttempts",
    "requestWindowMs",
    "maxRequestsPerWindow",
    "maxPrincipalRuns",
    "maxPrincipalCohorts",
    "principalShardCount",
    "maxPrincipalsPerShard",
  ]) {
    if (!Number.isSafeInteger(limits[field]) || limits[field] < 1) {
      throw new TypeError(`${field} must be a positive safe integer.`);
    }
  }
  if (!Number.isSafeInteger(limits.storeClaimRetryMs) || limits.storeClaimRetryMs < 0) {
    throw new TypeError("storeClaimRetryMs must be a non-negative safe integer.");
  }
  for (const field of [
    "runTtlMs",
    "cohortTtlMs",
    "operationTimeoutMs",
    "evaluationLeaseMs",
    "storeClaimTtlMs",
    "storeClaimRetryMs",
    "requestWindowMs",
  ]) {
    if (limits[field] > TIMER_MAX_MS) throw new RangeError(`${field} exceeds the supported timer range.`);
  }
  if (limits.evaluationLeaseMs <= limits.operationTimeoutMs + limits.storeClaimTtlMs) {
    throw new RangeError("evaluationLeaseMs must exceed operationTimeoutMs plus storeClaimTtlMs.");
  }
  if (limits.runTtlMs <= limits.evaluationLeaseMs + limits.storeClaimTtlMs) {
    throw new RangeError("runTtlMs must cover an evaluation lease and state claim.");
  }
  return Object.freeze(limits);
}
