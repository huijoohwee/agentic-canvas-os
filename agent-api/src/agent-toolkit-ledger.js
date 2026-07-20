import { createHash } from "node:crypto";

import {
  AGENT_TOOLKIT_COHORT_SCHEMA,
  AGENT_TOOLKIT_RUN_SCHEMA,
  AgentToolkitBlock,
  assertRecordSize,
} from "./agent-toolkit-contract.js";
import { aggregateCosts } from "./running-agent-contract.js";
import { normalizeJson } from "./json-contract.js";

function iso(at) {
  return new Date(at).toISOString();
}

export function digestToolkitEvidence(value) {
  return createHash("sha256").update(JSON.stringify(normalizeJson(value, "digest evidence"))).digest("hex");
}

function same(left, right) {
  return digestToolkitEvidence(left) === digestToolkitEvidence(right);
}

function touch(record, limits, at) {
  record.updatedAt = iso(at);
  return assertRecordSize(record, limits);
}

function principalScope(principalId) {
  return createHash("sha256").update(principalId).digest("hex");
}

export function runRecordId(principalId, runId) {
  return `run:${principalScope(principalId)}:${runId}`;
}

export function cohortRecordId(principalId, cohortId) {
  return `cohort:${principalScope(principalId)}:${cohortId}`;
}

export function assertToolkitOwner(record, principalId) {
  if (record.ownerPrincipalId !== principalId) {
    throw new AgentToolkitBlock("run_forbidden", "Agent Toolkit evidence belongs to another principal.");
  }
}

export function createToolkitRun({ request, authorization, principalId, telemetryTrust, limits, at }) {
  const record = {
    schema: AGENT_TOOLKIT_RUN_SCHEMA,
    recordId: runRecordId(principalId, request.runId),
    runId: request.runId,
    cohortId: request.cohortId,
    target: request.target,
    candidate: request.candidate,
    adapter: request.adapter,
    operation: request.operation,
    profile: request.profile,
    authorization,
    ownerPrincipalId: principalId,
    telemetryTrust,
    status: "running",
    createdAt: iso(at),
    admittedAt: at,
    updatedAt: iso(at),
    deadlineAt: at + limits.runTtlMs,
    expiresAt: at + limits.runTtlMs,
    spans: [],
    traceTruncated: false,
    completion: null,
    evaluation: { status: "pending", attempts: 0 },
  };
  return assertRecordSize(record, limits);
}

export function startToolkitSpan(record, request, limits, at) {
  if (record.status !== "running") throw new AgentToolkitBlock("run_terminal", "Agent Toolkit run is terminal.");
  if (at >= record.deadlineAt) throw new AgentToolkitBlock("run_expired", "Agent Toolkit run deadline elapsed.");
  const existing = record.spans.find((span) => span.spanId === request.spanId);
  if (existing) {
    const identity = {
      runId: record.runId,
      spanId: existing.spanId,
      ...(existing.parentSpanId ? { parentSpanId: existing.parentSpanId } : {}),
      kind: existing.kind,
      operation: existing.operation,
      component: existing.component,
    };
    if (!same(identity, request)) throw new AgentToolkitBlock("span_reused", "Span identity was reused with different metadata.");
    return touch(record, limits, at);
  }
  if (record.spans.length >= limits.maxSpans) {
    throw new AgentToolkitBlock("span_limit", "Agent Toolkit span limit reached.");
  }
  if (request.parentSpanId !== undefined) {
    const parent = record.spans.find((span) => span.spanId === request.parentSpanId);
    if (!parent || parent.status !== "running") {
      throw new AgentToolkitBlock("span_parent_invalid", "Parent span must exist and remain open.");
    }
  }
  record.spans.push({
    spanId: request.spanId,
    ...(request.parentSpanId === undefined ? {} : { parentSpanId: request.parentSpanId }),
    kind: request.kind,
    operation: request.operation,
    component: request.component,
    status: "running",
    startedAt: iso(at),
    startedAtMs: at,
  });
  return touch(record, limits, at);
}

export function finishToolkitSpan(record, request, limits, at) {
  const span = record.spans.find((candidate) => candidate.spanId === request.spanId);
  if (!span) throw new AgentToolkitBlock("span_not_found", "Agent Toolkit span was not found.");
  if (span.status !== "running") {
    if (span.status === request.status && span.reasonCode === request.reasonCode) return touch(record, limits, at);
    throw new AgentToolkitBlock("span_terminal", "Agent Toolkit span is already terminal.");
  }
  if (record.status !== "running") throw new AgentToolkitBlock("run_terminal", "Agent Toolkit run is terminal.");
  if (record.spans.some((candidate) => candidate.parentSpanId === span.spanId && candidate.status === "running")) {
    throw new AgentToolkitBlock("span_children_running", "Finish child spans before their parent.");
  }
  span.status = request.status;
  span.completedAt = iso(at);
  span.durationMs = Math.max(0, at - span.startedAtMs);
  delete span.startedAtMs;
  if (request.reasonCode) span.reasonCode = request.reasonCode;
  return touch(record, limits, at);
}

export function completeToolkitRun(record, request, limits, at) {
  if (record.completion) {
    if (record.completion.operationId === request.operationId
      && record.completion.requestDigest === digestToolkitEvidence(request)) return touch(record, limits, at);
    if (record.completion.operationId === request.operationId) {
      throw new AgentToolkitBlock("completion_reused", "Completion operation identity was reused with different evidence.");
    }
    throw new AgentToolkitBlock("run_terminal", "Agent Toolkit run is already terminal.");
  }
  for (const span of record.spans) {
    if (span.status !== "running") continue;
    span.status = "canceled";
    span.reasonCode = "run_terminal";
    span.completedAt = iso(at);
    span.durationMs = Math.max(0, at - span.startedAtMs);
    delete span.startedAtMs;
  }
  record.status = request.status;
  record.completion = {
    operationId: request.operationId,
    requestDigest: digestToolkitEvidence(request),
    status: request.status,
    ...(request.reasonCode ? { reasonCode: request.reasonCode } : {}),
    completedAt: iso(at),
    durationMs: Math.max(0, at - record.admittedAt),
    cost: aggregateCosts([request.costLog], 1),
  };
  return touch(record, limits, at);
}

function sameEvaluationRequest(evaluation, operationId, evidence) {
  return evaluation.operationId === operationId && same(evaluation.subjectEvidence, evidence);
}

export function reserveToolkitEvaluation(record, { operationId, evidence, limits, at }) {
  if (!record.completion) throw new AgentToolkitBlock("run_not_terminal", "Complete the observed run before evaluation.");
  if (record.evaluation.status === "reported" || record.evaluation.status === "unreported") {
    if (!sameEvaluationRequest(record.evaluation, operationId, evidence)) {
      throw new AgentToolkitBlock("evaluation_reused", "Evaluation operation identity or source evidence changed.");
    }
    return { record: touch(record, limits, at), replay: true, reservationId: null };
  }
  if (["running", "in_doubt"].includes(record.evaluation.status)
    && record.evaluation.leaseExpiresAt > at) {
    throw new AgentToolkitBlock("evaluation_busy", "Agent Toolkit evaluation is already running.");
  }
  if (record.evaluation.subjectEvidence
    && !sameEvaluationRequest(record.evaluation, operationId, evidence)) {
    throw new AgentToolkitBlock("evaluation_reused", "Evaluation operation identity or source evidence changed.");
  }
  if (record.expiresAt <= at + limits.evaluationLeaseMs + limits.storeClaimTtlMs) {
    throw new AgentToolkitBlock("run_deadline_capacity", "Run retention cannot cover another evaluation lease.");
  }
  const idempotencyKey = record.evaluation.idempotencyKey
    || `evaluation-${digestToolkitEvidence([
      record.ownerPrincipalId, record.runId, record.profile, evidence,
    ]).slice(0, 48)}`;
  if (record.evaluation.attempts >= limits.maxEvaluationAttempts) {
    record.evaluation = {
      status: "unreported",
      attempts: record.evaluation.attempts,
      operationId,
      subjectEvidence: evidence,
      idempotencyKey,
      reasonCode: "evaluation_attempts_exhausted",
      completedAt: iso(at),
    };
    return { record: touch(record, limits, at), replay: true, reservationId: null };
  }
  const attempt = record.evaluation.attempts + 1;
  const reservationId = `reservation-${digestToolkitEvidence([idempotencyKey, attempt]).slice(0, 48)}`;
  record.evaluation = {
    status: "running",
    attempts: attempt,
    operationId,
    reservationId,
    idempotencyKey,
    subjectEvidence: evidence,
    leaseExpiresAt: at + limits.evaluationLeaseMs,
  };
  return { record: touch(record, limits, at), replay: false, reservationId, idempotencyKey };
}

export function commitToolkitEvaluation(record, reservationId, outcome, limits, at) {
  if (record.evaluation.status !== "running" || record.evaluation.reservationId !== reservationId) {
    throw new AgentToolkitBlock("evaluation_stale", "Agent Toolkit evaluation reservation is stale.");
  }
  if (record.evaluation.leaseExpiresAt <= at) {
    throw new AgentToolkitBlock("evaluation_stale", "Agent Toolkit evaluation reservation expired.");
  }
  record.evaluation = {
    status: outcome.status,
    attempts: record.evaluation.attempts,
    operationId: record.evaluation.operationId,
    idempotencyKey: record.evaluation.idempotencyKey,
    subjectEvidence: record.evaluation.subjectEvidence,
    metric: outcome.metric,
    ...(outcome.status === "reported" ? { score: outcome.score } : {}),
    evidence: outcome.evidence,
    cost: aggregateCosts([outcome.costLog], 1),
    completedAt: iso(at),
  };
  return touch(record, limits, at);
}

export function failToolkitEvaluation(record, reservationId, reasonCode, limits, at) {
  if (record.evaluation.status !== "running" || record.evaluation.reservationId !== reservationId) {
    return touch(record, limits, at);
  }
  const uncertain = reasonCode === "timeout" || reasonCode === "aborted";
  const exhausted = !uncertain && record.evaluation.attempts >= limits.maxEvaluationAttempts;
  record.evaluation = {
    status: uncertain ? "in_doubt" : exhausted ? "unreported" : "pending",
    attempts: record.evaluation.attempts,
    operationId: record.evaluation.operationId,
    idempotencyKey: record.evaluation.idempotencyKey,
    subjectEvidence: record.evaluation.subjectEvidence,
    reasonCode,
    ...(uncertain ? {
      reservationId: record.evaluation.reservationId,
      leaseExpiresAt: record.evaluation.leaseExpiresAt,
    } : {}),
    ...(exhausted ? { completedAt: iso(at) } : {}),
  };
  return touch(record, limits, at);
}

export function projectToolkitRun(record) {
  const completion = record.completion ? { ...record.completion } : null;
  if (completion) delete completion.requestDigest;
  const evaluation = { ...record.evaluation };
  delete evaluation.idempotencyKey;
  delete evaluation.reservationId;
  delete evaluation.leaseExpiresAt;
  return Object.freeze({
    schema: record.schema,
    runId: record.runId,
    cohortId: record.cohortId,
    target: record.target,
    candidate: record.candidate,
    adapter: record.adapter,
    operation: record.operation,
    profile: record.profile,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    deadlineAt: record.deadlineAt,
    expiresAt: record.expiresAt,
    spans: record.spans.map((span) => {
      const sanitized = { ...span };
      delete sanitized.startedAtMs;
      return sanitized;
    }),
    traceTruncated: record.traceTruncated,
    completion,
    telemetryTrust: record.telemetryTrust,
    evaluation: ["running", "in_doubt"].includes(record.evaluation.status)
      ? {
        status: record.evaluation.status,
        attempts: record.evaluation.attempts,
        ...(record.evaluation.reasonCode ? { reasonCode: record.evaluation.reasonCode } : {}),
      }
      : evaluation,
    telemetryPolicy: "metadata-only-no-default-egress",
  });
}

export function createToolkitCohort({ request, principalId, limits, at }) {
  const record = {
    schema: AGENT_TOOLKIT_COHORT_SCHEMA,
    recordId: cohortRecordId(principalId, request.cohortId),
    cohortId: request.cohortId,
    ownerPrincipalId: principalId,
    target: request.target,
    adapter: request.adapter,
    operation: request.operation,
    profile: request.profile,
    createdAt: iso(at),
    updatedAt: iso(at),
    expiresAt: at + limits.cohortTtlMs,
    samples: [],
    proposals: [],
  };
  return assertRecordSize(record, limits);
}

export function assertToolkitCohort(record, request, principalId) {
  assertToolkitOwner(record, principalId);
  if (!same(record.target, request.target)
    || !same(record.adapter, request.adapter)
    || record.operation !== request.operation
    || !same(record.profile, request.profile)) {
    throw new AgentToolkitBlock("cohort_mismatch", "Cohort target, adapter, operation, or evaluation provenance changed.");
  }
}

function sampleFromRun(run) {
  return {
    runId: run.runId,
    candidate: run.candidate,
    adapter: run.adapter,
    operation: run.operation,
    telemetryTrust: run.telemetryTrust,
    status: run.status,
    durationMs: run.completion.durationMs,
    cost: run.completion.cost,
    quality: run.evaluation.status === "reported" || run.evaluation.status === "unreported"
      ? run.evaluation
      : { status: "pending" },
    completedAt: run.completion.completedAt,
  };
}

export function appendToolkitSample(cohort, run, limits, at) {
  const sample = sampleFromRun(run);
  const index = cohort.samples.findIndex((candidate) => candidate.runId === run.runId);
  if (index >= 0) {
    const existing = cohort.samples[index];
    if (!same(existing.candidate, sample.candidate)
      || !same(existing.adapter, sample.adapter)
      || existing.operation !== sample.operation
      || existing.telemetryTrust !== sample.telemetryTrust
      || existing.status !== sample.status) {
      throw new AgentToolkitBlock("sample_mismatch", "Immutable cohort sample identity changed.");
    }
    if (existing.quality.status === "pending" && sample.quality.status !== "pending") {
      const reused = cohort.samples.some((candidate) => candidate.runId !== run.runId
        && candidate.quality?.subjectEvidence?.digest === sample.quality.subjectEvidence?.digest);
      cohort.samples[index] = reused
        ? { ...sample, quality: { ...sample.quality, status: "invalid", reasonCode: "evidence_reused" } }
        : sample;
    }
  } else {
    if (sample.quality.status !== "pending") {
      const reused = cohort.samples.some((candidate) => (
        candidate.quality?.subjectEvidence?.digest === sample.quality.subjectEvidence?.digest
      ));
      if (reused) sample.quality = { ...sample.quality, status: "invalid", reasonCode: "evidence_reused" };
    }
    cohort.samples.push(sample);
    while (cohort.samples.length > limits.maxSamples) cohort.samples.shift();
  }
  cohort.expiresAt = at + limits.cohortTtlMs;
  return touch(cohort, limits, at);
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function candidateSamples(cohort, candidate) {
  const matching = cohort.samples.filter((sample) => sample.status === "completed"
    && sample.quality.status !== "invalid"
    && same(sample.candidate, candidate));
  const remoteUnverified = matching.filter((sample) => sample.telemetryTrust === "remote-unverified").length;
  const trusted = matching.filter((sample) => sample.telemetryTrust !== "remote-unverified");
  const unique = [];
  const evidenceDigests = new Set();
  let duplicates = 0;
  for (const sample of trusted) {
    const digest = sample.quality?.subjectEvidence?.digest;
    if (digest && evidenceDigests.has(digest)) {
      duplicates += 1;
      continue;
    }
    if (digest) evidenceDigests.add(digest);
    unique.push(sample);
  }
  return Object.freeze({ samples: unique, remoteUnverified, duplicates });
}

function ratio(candidate, baseline) {
  if (baseline === 0) return candidate === 0 ? 1 : null;
  return candidate / baseline;
}

export function compareToolkitCohort(cohort, request) {
  const baselineEvidence = candidateSamples(cohort, request.baseline);
  const candidateEvidence = candidateSamples(cohort, request.candidate);
  const baselineSamples = baselineEvidence.samples;
  const candidateSet = candidateEvidence.samples;
  const sampleCounts = { baseline: baselineSamples.length, candidate: candidateSet.length };
  const untrustedSampleCounts = {
    baseline: baselineEvidence.remoteUnverified,
    candidate: candidateEvidence.remoteUnverified,
  };
  const duplicateEvidenceCounts = {
    baseline: baselineEvidence.duplicates,
    candidate: candidateEvidence.duplicates,
  };
  const insufficient = (reasonCode) => Object.freeze({
    status: "insufficient-evidence",
    reasonCode,
    recommendation: "hold",
    reviewRequired: true,
    applied: false,
    cohortId: cohort.cohortId,
    baseline: request.baseline,
    candidate: request.candidate,
    policy: request.policy,
    sampleCounts,
    untrustedSampleCounts,
    duplicateEvidenceCounts,
  });
  if (Math.min(...Object.values(sampleCounts)) < request.policy.minSamples) {
    return insufficient("trusted_sample_count");
  }
  const baselineQuality = baselineSamples.filter((sample) => sample.quality.status === "reported");
  const candidateQuality = candidateSet.filter((sample) => sample.quality.status === "reported");
  if (Math.min(baselineQuality.length, candidateQuality.length) < request.policy.minSamples) {
    return insufficient("quality_unreported");
  }
  const baselineCost = baselineSamples.filter((sample) => sample.cost.status === "reported");
  const candidateCost = candidateSet.filter((sample) => sample.cost.status === "reported");
  if (Math.min(baselineCost.length, candidateCost.length) < request.policy.minSamples) {
    return insufficient("cost_unreported");
  }
  const baselineMetrics = {
    quality: mean(baselineQuality.map((sample) => sample.quality.score)),
    latencyMs: mean(baselineSamples.map((sample) => sample.durationMs)),
    costUsd: mean(baselineCost.map((sample) => sample.cost.estimated_cost_usd)),
  };
  const candidateMetrics = {
    quality: mean(candidateQuality.map((sample) => sample.quality.score)),
    latencyMs: mean(candidateSet.map((sample) => sample.durationMs)),
    costUsd: mean(candidateCost.map((sample) => sample.cost.estimated_cost_usd)),
  };
  const direction = cohort.profile.metric.direction;
  const improvement = direction === "maximize"
    ? candidateMetrics.quality - baselineMetrics.quality
    : baselineMetrics.quality - candidateMetrics.quality;
  const qualityBoundaryPassed = direction === "maximize"
    ? candidateMetrics.quality >= request.policy.qualityBoundary
    : candidateMetrics.quality <= request.policy.qualityBoundary;
  const latencyRatio = ratio(candidateMetrics.latencyMs, baselineMetrics.latencyMs);
  const costRatio = ratio(candidateMetrics.costUsd, baselineMetrics.costUsd);
  const checks = {
    qualityBoundary: qualityBoundaryPassed,
    qualityImprovement: improvement >= request.policy.minimumQualityImprovement,
    latencyRegression: latencyRatio !== null && latencyRatio <= request.policy.maxLatencyRegressionRatio,
    costRegression: costRatio !== null && costRatio <= request.policy.maxCostRegressionRatio,
  };
  const recommendation = Object.values(checks).every(Boolean) ? "propose" : "hold";
  const result = {
    status: "completed",
    recommendation,
    reviewRequired: true,
    applied: false,
    cohortId: cohort.cohortId,
    baseline: request.baseline,
    candidate: request.candidate,
    metric: cohort.profile.metric,
    evaluator: cohort.profile.evaluator,
    dataset: cohort.profile.dataset,
    adapter: cohort.adapter,
    operation: cohort.operation,
    policy: request.policy,
    sampleCounts,
    untrustedSampleCounts,
    duplicateEvidenceCounts,
    baselineMetrics,
    candidateMetrics,
    observed: { qualityImprovement: improvement, latencyRatio, costRatio },
    checks,
  };
  result.comparisonDigest = digestToolkitEvidence(result);
  return Object.freeze(result);
}

export function appendToolkitProposal(cohort, request, comparison, limits, at) {
  if (comparison.recommendation !== "propose") {
    throw new AgentToolkitBlock("proposal_not_supported", "Evidence does not support a learning proposal.");
  }
  const existing = cohort.proposals.find((proposal) => proposal.operationId === request.operationId);
  if (existing) {
    if (!same(existing.baseline, request.baseline)
      || !same(existing.candidate, request.candidate)
      || existing.comparisonDigest !== comparison.comparisonDigest) {
      throw new AgentToolkitBlock("proposal_reused", "Proposal operation identity was reused with different evidence.");
    }
    return { cohort: touch(cohort, limits, at), proposal: existing };
  }
  const proposal = {
    proposalId: `toolkit-proposal-${digestToolkitEvidence([
      cohort.cohortId, request.operationId, comparison.comparisonDigest,
    ]).slice(0, 48)}`,
    operationId: request.operationId,
    status: "review_pending",
    baseline: request.baseline,
    candidate: request.candidate,
    comparisonDigest: comparison.comparisonDigest,
    reviewRequired: true,
    applied: false,
    createdAt: iso(at),
  };
  cohort.proposals.push(proposal);
  while (cohort.proposals.length > limits.maxProposals) cohort.proposals.shift();
  cohort.expiresAt = at + limits.cohortTtlMs;
  return { cohort: touch(cohort, limits, at), proposal: Object.freeze(proposal) };
}
