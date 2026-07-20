import {
  AGENT_TOOLKIT_DEFAULTS,
  AgentToolkitBlock,
  assertIdentifier,
  normalizeAccessContext,
  normalizeAuthorization,
  normalizeCompareRequest,
  normalizeComparisonPolicy,
  normalizeCompleteRequest,
  normalizeEvaluateRequest,
  normalizeEvaluationOutcome,
  normalizeInstrumentOutcome,
  normalizeProposalRequest,
  normalizeReasonCode,
  normalizeSpanFinishRequest,
  normalizeSpanStartRequest,
  normalizeStartRequest,
} from "./agent-toolkit-contract.js";
import {
  appendToolkitProposal,
  appendToolkitSample,
  assertToolkitCohort,
  assertToolkitOwner,
  cohortRecordId,
  commitToolkitEvaluation,
  compareToolkitCohort,
  completeToolkitRun,
  createToolkitCohort,
  createToolkitRun,
  digestToolkitEvidence,
  failToolkitEvaluation,
  finishToolkitSpan,
  projectToolkitRun,
  reserveToolkitEvaluation,
  runRecordId,
  startToolkitSpan,
} from "./agent-toolkit-ledger.js";
import { createAgentToolkitMemoryStore } from "./agent-toolkit-store.js";
import { normalizeJson } from "./json-contract.js";
import { RunningAgentBlock, withDeadline } from "./running-agent-contract.js";

function blocked(reasonCode, status = "blocked") {
  return Object.freeze({ status, reasonCode });
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function publicRequest(request) {
  const result = { ...request };
  delete result.signal;
  return result;
}

const LIMIT_FIELDS = new Set([
  "maxSpans", "maxSamples", "maxProposals", "maxRecordChars", "runTtlMs", "cohortTtlMs",
  "operationTimeoutMs", "evaluationLeaseMs", "storeClaimTtlMs", "storeClaimAttempts",
  "storeClaimRetryMs", "maxEvaluationAttempts", "comparison",
]);
const TIMER_MAX_MS = 2_147_483_647;

function normalizeLimits(overrides) {
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
    "maxSpans", "maxSamples", "maxProposals", "maxRecordChars", "runTtlMs", "cohortTtlMs",
    "operationTimeoutMs", "evaluationLeaseMs", "storeClaimTtlMs", "storeClaimAttempts",
    "maxEvaluationAttempts",
  ]) {
    if (!Number.isSafeInteger(limits[field]) || limits[field] < 1) {
      throw new TypeError(`${field} must be a positive safe integer.`);
    }
  }
  if (!Number.isSafeInteger(limits.storeClaimRetryMs) || limits.storeClaimRetryMs < 0) {
    throw new TypeError("storeClaimRetryMs must be a non-negative safe integer.");
  }
  for (const field of [
    "runTtlMs", "cohortTtlMs", "operationTimeoutMs", "evaluationLeaseMs",
    "storeClaimTtlMs", "storeClaimRetryMs",
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

function safeReason(error, fallback, extras = []) {
  if (!(error instanceof RunningAgentBlock) && !(error instanceof AgentToolkitBlock)) return fallback;
  if (extras.includes(error.reasonCode)) return error.reasonCode;
  try {
    return normalizeReasonCode(error.reasonCode);
  } catch {
    return fallback;
  }
}

function trustedContext(access) {
  const context = normalizeAccessContext(access);
  return Object.freeze({ ...context, telemetryTrust: "server-observed" });
}

export function createAgentToolkitRuntime({
  stateStore,
  authorize,
  evaluate: evaluateAdapter,
  now = () => Date.now(),
  ...overrides
} = {}) {
  if (typeof now !== "function") throw new TypeError("now must be a function.");
  const limits = normalizeLimits(overrides);
  const store = stateStore || createAgentToolkitMemoryStore({ now });
  const configured = typeof authorize === "function";
  const evaluatorConfigured = typeof evaluateAdapter === "function";

  function instant() {
    const value = Number(now());
    if (!Number.isFinite(value)) throw new TypeError("now must return a finite timestamp.");
    return value;
  }

  async function claimRecord(recordId, operationId, transform) {
    for (let attempt = 1; attempt <= limits.storeClaimAttempts; attempt += 1) {
      const at = instant();
      const claimId = `toolkit-claim-${digestToolkitEvidence([recordId, operationId, at, attempt]).slice(0, 48)}`;
      const record = await store.claim(recordId, claimId, at + limits.storeClaimTtlMs);
      if (!record) {
        if (!(await store.get(recordId))) return { missing: true };
        if (attempt < limits.storeClaimAttempts) await pause(limits.storeClaimRetryMs);
        continue;
      }
      try {
        const transformed = await transform(record, at);
        const replacement = transformed?.record || record;
        if (!(await store.replace(recordId, claimId, replacement))) {
          throw new AgentToolkitBlock("state_conflict", "Agent Toolkit state claim became stale.");
        }
        return { missing: false, value: transformed?.value, record: replacement };
      } catch (error) {
        await store.release(recordId, claimId);
        throw error;
      }
    }
    throw new AgentToolkitBlock("state_busy", "Agent Toolkit state remained busy.");
  }

  async function authorizeAction(action, request, context) {
    if (!configured) throw new AgentToolkitBlock("runtime_unconfigured", "Agent Toolkit authorizer is not configured.");
    const verdict = await authorize({
      action,
      principalId: context.principalId,
      request: publicRequest(request),
    });
    return normalizeAuthorization(verdict);
  }

  async function ensureCohort(request, context, at) {
    const recordId = cohortRecordId(context.principalId, request.cohortId);
    let cohort = await store.get(recordId);
    if (!cohort) {
      await store.put(createToolkitCohort({ request, principalId: context.principalId, limits, at }));
      cohort = await store.get(recordId);
    }
    if (!cohort) throw new AgentToolkitBlock("cohort_unavailable", "Agent Toolkit cohort could not be reserved.");
    assertToolkitCohort(cohort, request, context.principalId);
    return cohort;
  }

  async function mutateRun(runId, operationId, context, transform) {
    const result = await claimRecord(runRecordId(context.principalId, runId), operationId, async (record, at) => {
      assertToolkitOwner(record, context.principalId);
      const replacement = await transform(record, at);
      return { record: replacement, value: projectToolkitRun(replacement) };
    });
    if (result.missing) throw new AgentToolkitBlock("run_not_found", "Agent Toolkit run was not found.");
    return result.value;
  }

  async function syncSample(run, context, operationId) {
    if (!run.completion) return;
    const result = await claimRecord(cohortRecordId(context.principalId, run.cohortId), operationId, async (cohort, at) => {
      assertToolkitOwner(cohort, context.principalId);
      if (digestToolkitEvidence(cohort.target) !== digestToolkitEvidence(run.target)
        || digestToolkitEvidence(cohort.adapter) !== digestToolkitEvidence(run.adapter)
        || cohort.operation !== run.operation
        || digestToolkitEvidence(cohort.profile) !== digestToolkitEvidence(run.profile)) {
        throw new AgentToolkitBlock("cohort_mismatch", "Run no longer matches its cohort provenance.");
      }
      return { record: appendToolkitSample(cohort, run, limits, at) };
    });
    if (result.missing) throw new AgentToolkitBlock("cohort_not_found", "Agent Toolkit cohort was not found.");
    const synchronized = result.record.samples.find((sample) => sample.runId === run.runId);
    if (synchronized?.quality?.status === "invalid"
      && synchronized.quality.reasonCode === "evidence_reused") {
      throw new AgentToolkitBlock("evidence_reused", "Evaluation source evidence was already counted.");
    }
  }

  async function start(value, access = {}) {
    const request = normalizeStartRequest(value);
    const context = normalizeAccessContext(access);
    const at = instant();
    if (context.principalExpiresAt !== undefined && context.principalExpiresAt < at + limits.runTtlMs) {
      return blocked("session_too_short");
    }
    let authorization;
    try {
      authorization = await authorizeAction("observe", request, context);
      await ensureCohort(request, context, at);
      const stored = await store.put(createToolkitRun({
        request,
        authorization,
        principalId: context.principalId,
        telemetryTrust: context.telemetryTrust,
        limits,
        at,
      }));
      if (!stored) return blocked("run_reused");
      return projectToolkitRun(await store.get(runRecordId(context.principalId, request.runId)));
    } catch (error) {
      if (error instanceof AgentToolkitBlock) return blocked(error.reasonCode);
      return blocked("authorization_failed");
    }
  }

  async function startSpan(value, access = {}) {
    const request = normalizeSpanStartRequest(value);
    const context = normalizeAccessContext(access);
    try {
      return await mutateRun(request.runId, `span-start:${request.spanId}`, context, (record, at) => (
        startToolkitSpan(record, request, limits, at)
      ));
    } catch (error) {
      if (error instanceof AgentToolkitBlock) return blocked(error.reasonCode);
      throw error;
    }
  }

  async function finishSpan(value, access = {}) {
    const request = normalizeSpanFinishRequest(value);
    const context = normalizeAccessContext(access);
    try {
      return await mutateRun(request.runId, `span-finish:${request.spanId}`, context, (record, at) => (
        finishToolkitSpan(record, request, limits, at)
      ));
    } catch (error) {
      if (error instanceof AgentToolkitBlock) return blocked(error.reasonCode);
      throw error;
    }
  }

  async function complete(value, access = {}) {
    const request = normalizeCompleteRequest(value);
    const context = normalizeAccessContext(access);
    try {
      await mutateRun(request.runId, `complete:${request.operationId}`, context, (record, at) => (
        completeToolkitRun(record, request, limits, at)
      ));
      const run = await store.get(runRecordId(context.principalId, request.runId));
      assertToolkitOwner(run, context.principalId);
      await syncSample(run, context, `sample:${request.operationId}`);
      return projectToolkitRun(run);
    } catch (error) {
      if (error instanceof AgentToolkitBlock) return blocked(error.reasonCode);
      throw error;
    }
  }

  async function evaluate(value, access = {}) {
    const request = normalizeEvaluateRequest(value);
    const context = normalizeAccessContext(access);
    if (!evaluatorConfigured) return blocked("evaluator_unconfigured");
    const initial = await store.get(runRecordId(context.principalId, request.runId));
    if (!initial) return blocked("run_not_found");
    try {
      assertToolkitOwner(initial, context.principalId);
      await authorizeAction("evaluate", request, context);
      let reservationId;
      const reserved = await claimRecord(
        runRecordId(context.principalId, request.runId),
        `evaluate:${request.operationId}`,
        (record, at) => {
        assertToolkitOwner(record, context.principalId);
        const reservation = reserveToolkitEvaluation(record, {
          operationId: request.operationId,
          evidence: request.evidence,
          limits,
          at,
        });
        reservationId = reservation.reservationId;
        return { record: reservation.record, value: reservation };
        },
      );
      if (reserved.missing) return blocked("run_not_found");
      if (reserved.value.replay) {
        await syncSample(reserved.record, context, `sample-evaluation-replay:${request.operationId}`);
        return projectToolkitRun(reserved.record);
      }

      let outcome;
      try {
        const expectedMetric = normalizeJson(reserved.record.profile.metric, "expected evaluation metric");
        const evaluatorMetadata = normalizeJson({
          target: reserved.record.target,
          candidate: reserved.record.candidate,
          adapter: reserved.record.adapter,
          profile: reserved.record.profile,
          evidence: request.evidence,
          idempotencyKey: reserved.value.idempotencyKey,
        }, "evaluator input");
        const controller = new AbortController();
        const raw = await withDeadline(
          () => evaluateAdapter(Object.freeze({
            ...evaluatorMetadata,
            signal: controller.signal,
          })),
          request.signal,
          limits.operationTimeoutMs,
          controller,
        );
        outcome = normalizeEvaluationOutcome(raw, expectedMetric);
      } catch (error) {
        const reasonCode = safeReason(error, "evaluation_failed", ["evaluation_metric_mismatch"]);
        await mutateRun(request.runId, `evaluation-fail:${reservationId}`, context, (record, at) => (
          failToolkitEvaluation(record, reservationId, reasonCode, limits, at)
        ));
        const failed = await store.get(runRecordId(context.principalId, request.runId));
        await syncSample(failed, context, `sample-evaluation-fail:${reservationId}`);
        return blocked(reasonCode);
      }

      const committed = await mutateRun(
        request.runId,
        `evaluation-commit:${reservationId}`,
        context,
        (record, at) => commitToolkitEvaluation(record, reservationId, outcome, limits, at),
      );
      const run = await store.get(runRecordId(context.principalId, request.runId));
      await syncSample(run, context, `sample-evaluation:${reservationId}`);
      return committed;
    } catch (error) {
      if (error instanceof AgentToolkitBlock) return blocked(error.reasonCode);
      return blocked("evaluation_failed");
    }
  }

  async function status(runId, access = {}) {
    const context = normalizeAccessContext(access);
    const normalizedRunId = assertIdentifier(runId, "runId");
    const record = await store.get(runRecordId(context.principalId, normalizedRunId));
    if (!record) return blocked("run_not_found");
    try {
      assertToolkitOwner(record, context.principalId);
      return projectToolkitRun(record);
    } catch (error) {
      return blocked(error.reasonCode);
    }
  }

  async function compare(value, access = {}) {
    const request = normalizeCompareRequest(value, limits.comparison);
    const context = normalizeAccessContext(access);
    const cohort = await store.get(cohortRecordId(context.principalId, request.cohortId));
    if (!cohort) return blocked("cohort_not_found");
    try {
      assertToolkitOwner(cohort, context.principalId);
      return compareToolkitCohort(cohort, request);
    } catch (error) {
      if (error instanceof AgentToolkitBlock) return blocked(error.reasonCode);
      throw error;
    }
  }

  async function propose(value, access = {}) {
    const request = normalizeProposalRequest(value, limits.comparison);
    const context = normalizeAccessContext(access);
    const initial = await store.get(cohortRecordId(context.principalId, request.cohortId));
    if (!initial) return blocked("cohort_not_found");
    try {
      assertToolkitOwner(initial, context.principalId);
      await authorizeAction("propose", request, context);
      const result = await claimRecord(
        cohortRecordId(context.principalId, request.cohortId),
        `proposal:${request.operationId}`,
        (cohort, at) => {
          assertToolkitOwner(cohort, context.principalId);
          const comparison = compareToolkitCohort(cohort, request);
          const appended = appendToolkitProposal(cohort, request, comparison, limits, at);
          return { record: appended.cohort, value: appended.proposal };
        },
      );
      if (result.missing) return blocked("cohort_not_found");
      return result.value;
    } catch (error) {
      if (error instanceof AgentToolkitBlock) return blocked(error.reasonCode);
      return blocked("proposal_failed");
    }
  }

  async function instrument(value, operation, access = {}) {
    if (typeof operation !== "function") throw new TypeError("operation must be a function.");
    const request = normalizeStartRequest(value);
    const context = trustedContext(access);
    const transitionResult = async (reasonCode) => {
      const observation = await status(request.runId, context);
      if (["completed", "failed", "canceled"].includes(observation.status)) {
        return Object.freeze({
          status: observation.status,
          ...(observation.completion?.reasonCode
            ? { reasonCode: observation.completion.reasonCode }
            : {}),
          observation,
        });
      }
      return Object.freeze({ status: "blocked", reasonCode, observation });
    };
    const started = await start(request, context);
    if (started.status !== "running") return started;
    const rootSpan = {
      runId: request.runId,
      spanId: "root",
      kind: request.target.kind,
      operation: request.operation,
      component: {
        id: request.target.id,
        revision: request.target.revision,
        digest: request.target.digest,
      },
    };
    const spanStarted = await startSpan(rootSpan, context);
    if (spanStarted.status === "blocked") return transitionResult(spanStarted.reasonCode);
    try {
      const controller = new AbortController();
      const raw = await withDeadline(
        () => operation({
          signal: controller.signal,
          target: request.target,
          candidate: request.candidate,
          adapter: request.adapter,
        }),
        request.signal,
        limits.operationTimeoutMs,
        controller,
      );
      const outcome = normalizeInstrumentOutcome(raw);
      const spanFinished = await finishSpan({
        runId: request.runId, spanId: "root", status: "completed",
      }, context);
      if (spanFinished.status === "blocked") return transitionResult(spanFinished.reasonCode);
      const completion = await complete({
        runId: request.runId,
        operationId: "instrument-complete",
        status: "completed",
        ...(outcome.costLog ? { costLog: outcome.costLog } : {}),
      }, context);
      if (completion.status === "blocked"
        || completion.completion?.operationId !== "instrument-complete"
        || completion.completion?.status !== "completed") {
        return transitionResult(completion.reasonCode || "run_terminal");
      }
      if (outcome.evidence && evaluatorConfigured) {
        await evaluate({
          runId: request.runId,
          operationId: "instrument-evaluate",
          evidence: outcome.evidence,
          signal: request.signal,
        }, context);
      }
      const observation = await status(request.runId, context);
      return Object.freeze({
        status: observation.status,
        value: outcome.value,
        observation,
      });
    } catch (error) {
      const reasonCode = safeReason(error, "adapter_failed");
      const spanFinished = await finishSpan({
        runId: request.runId, spanId: "root", status: "failed", reasonCode,
      }, context);
      if (spanFinished.status === "blocked") return transitionResult(spanFinished.reasonCode);
      const completion = await complete({
        runId: request.runId,
        operationId: "instrument-complete",
        status: "failed",
        reasonCode,
      }, context);
      if (completion.status === "blocked"
        || completion.completion?.operationId !== "instrument-complete") {
        return transitionResult(completion.reasonCode || "run_terminal");
      }
      return Object.freeze({ status: completion.status, reasonCode, observation: completion });
    }
  }

  return Object.freeze({
    start,
    startSpan,
    finishSpan,
    complete,
    evaluate,
    status,
    compare,
    propose,
    instrument,
    stats: () => Object.freeze({
      configured,
      evaluatorConfigured,
      instrumentation: "server-timed-metadata-only",
      comparison: "same-cohort-deterministic-thresholds",
      learning: "review-pending-proposal-only",
      defaultEgress: false,
      externalRuntimeDependency: false,
      runTtlMs: limits.runTtlMs,
      cohortTtlMs: limits.cohortTtlMs,
      stateStore: store.stats(),
    }),
  });
}

export { createAgentToolkitMemoryStore } from "./agent-toolkit-store.js";
