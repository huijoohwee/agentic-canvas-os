import {
  assertExactKeys,
  assertIdentifier,
  normalizeCandidate,
  normalizeComparisonPolicy,
} from "./agent-toolkit-contract.js";
import { compareToolkitCohort, digestToolkitEvidence } from "./agent-toolkit-ledger.js";

const SCHEMA = "agent-toolkit-optimization/v1";

export function normalizeOptimizationRequest(value, limits) {
  assertExactKeys(value, ["cohortId", "baseline", "candidates", "policy"], "request");
  const baseline = normalizeCandidate(value.baseline, "request.baseline");
  if (!Array.isArray(value.candidates) || value.candidates.length < 1) {
    throw new TypeError("request.candidates must be a non-empty array.");
  }
  if (value.candidates.length > limits.maxOptimizationCandidates) {
    throw new RangeError(`request.candidates exceeds ${limits.maxOptimizationCandidates}.`);
  }
  const candidates = value.candidates.map((candidate, index) => (
    normalizeCandidate(candidate, `request.candidates[${index}]`)
  ));
  const digests = candidates.map((candidate) => digestToolkitEvidence(candidate));
  if (new Set(digests).size !== digests.length) {
    throw new TypeError("request.candidates must contain unique exact revisions.");
  }
  if (digests.includes(digestToolkitEvidence(baseline))) {
    throw new TypeError("request.candidates cannot include request.baseline.");
  }
  return Object.freeze({
    cohortId: assertIdentifier(value.cohortId, "request.cohortId"),
    baseline,
    candidates: Object.freeze(candidates),
    policy: normalizeComparisonPolicy(value.policy, limits.comparison),
  });
}

function rank(left, right) {
  return right.observed.qualityImprovement - left.observed.qualityImprovement
    || left.observed.latencyRatio - right.observed.latencyRatio
    || left.observed.costRatio - right.observed.costRatio
    || digestToolkitEvidence(left.candidate).localeCompare(digestToolkitEvidence(right.candidate));
}

export function optimizeToolkitCohort(cohort, request) {
  const comparisons = request.candidates.map((candidate) => (
    compareToolkitCohort(cohort, {
      cohortId: request.cohortId,
      baseline: request.baseline,
      candidate,
      policy: request.policy,
    })
  ));
  const eligible = comparisons
    .filter((comparison) => comparison.status === "completed" && comparison.recommendation === "propose")
    .sort(rank);
  const selected = eligible[0] || null;
  return Object.freeze({
    schema: SCHEMA,
    status: selected ? "completed" : "insufficient-evidence",
    recommendation: selected ? "propose" : "hold",
    reviewRequired: true,
    applied: false,
    cohortId: request.cohortId,
    baseline: request.baseline,
    objectiveOrder: Object.freeze([
      "quality-improvement-desc",
      "latency-ratio-asc",
      "cost-ratio-asc",
      "candidate-digest-asc",
    ]),
    selected: selected
      ? Object.freeze({
        candidate: selected.candidate,
        comparisonDigest: selected.comparisonDigest,
        observed: selected.observed,
      })
      : null,
    candidates: Object.freeze(comparisons.map((comparison) => Object.freeze({
      candidate: comparison.candidate,
      status: comparison.status,
      recommendation: comparison.recommendation,
      ...(comparison.reasonCode ? { reasonCode: comparison.reasonCode } : {}),
      ...(comparison.observed ? { observed: comparison.observed } : {}),
      ...(comparison.comparisonDigest ? { comparisonDigest: comparison.comparisonDigest } : {}),
    }))),
  });
}
