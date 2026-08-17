// Skill_Proposer harness for the native skill creation harness.
//
// Runs a bounded agentic loop over an injected model adapter and writes at
// most one status:proposed draft per call. It holds no write capability to
// the active Agent Definition registry, imports nothing from
// skill-registry-gate.js or adapter-registration.js, and never calls a
// provider directly: the provider call is the injected proposeCandidate
// adapter, which keeps every test network-free and keeps provider credentials
// outside this module.

import { normalizeJson } from "./json-contract.js";

export class SkillProposalBlock extends Error {
  constructor(reasonCode, message, details = {}) {
    super(message);
    this.name = "SkillProposalBlock";
    this.reasonCode = reasonCode;
    this.details = details;
  }
}

export const SKILL_PROPOSER_DEFAULTS = Object.freeze({
  iterationBound: 5,
  circuitBreakerConsecutiveNoCandidate: 2,
  maxPromptTokens: 800,
  maxCompletionTokens: 400,
  cacheHitTarget: 0.4,
  p95GapToDraftMs: 12000,
  perIterationMs: 2500,
  draftTtlMs: 30 * 24 * 60 * 60 * 1000,
});

export const SKILL_PROPOSER_IDENTITY = "acos-skill-proposer";
export const SKILL_PROPOSER_MODULE = "agent-api/src/skill-proposer.js";
export const SKILL_DRAFT_SCHEMA = "acos-skill-draft/v1";
export const GAP_SIGNAL_SCHEMA = "acos-gap-signal/v1";
export const SKILL_PROPOSER_TRACE_SCHEMA = "acos-skill-proposer-trace/v1";
// Literal because the proposer holds no approval capability: the unapproved
// terminal outcome is the normal one, so the value cannot read otherwise.
export const SKILL_PROPOSAL_APPROVAL_STATUS = "skill-creation: unapproved";
export const PER_CALL_COST_BUDGET_USD = 0.004;

const GAP_SIGNAL_KEYS = ["schema", "signal_id", "adapter_id", "capability", "missing_tool_names", "denial_reason_code", "observed_at_ms", "evidence_reference"];

function assertExactKeys(value, allowedKeys, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object.`);
  }
  const unknown = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unknown.length) throw new TypeError(`${field} contains unsupported fields: ${unknown.join(", ")}.`);
}

function assertIdentifier(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} must be a non-empty string.`);
  return value.trim();
}

function assertNullableIdentifier(value, field) {
  if (value === null || value === undefined) return null;
  return assertIdentifier(value, field);
}

function assertFiniteInteger(value, field) {
  if (!Number.isInteger(value)) throw new TypeError(`${field} must be a finite integer.`);
  return value;
}

export function normalizeGapSignal(value) {
  assertExactKeys(value, GAP_SIGNAL_KEYS, "gap_signal");
  if (value.schema !== GAP_SIGNAL_SCHEMA) throw new TypeError("gap_signal.schema is unsupported.");
  if (!Array.isArray(value.missing_tool_names) || value.missing_tool_names.length === 0) {
    throw new TypeError("gap_signal.missing_tool_names must be a non-empty array.");
  }
  const toolNames = value.missing_tool_names.map((name, index) => assertIdentifier(name, `gap_signal.missing_tool_names[${index}]`));
  if (new Set(toolNames).size !== toolNames.length) {
    throw new TypeError("gap_signal.missing_tool_names contains a duplicate entry.");
  }
  return normalizeJson({
    schema: value.schema,
    signal_id: assertIdentifier(value.signal_id, "gap_signal.signal_id"),
    adapter_id: assertIdentifier(value.adapter_id, "gap_signal.adapter_id"),
    capability: assertIdentifier(value.capability, "gap_signal.capability"),
    missing_tool_names: toolNames,
    denial_reason_code: assertNullableIdentifier(value.denial_reason_code, "gap_signal.denial_reason_code"),
    observed_at_ms: assertFiniteInteger(value.observed_at_ms, "gap_signal.observed_at_ms"),
    evidence_reference: assertNullableIdentifier(value.evidence_reference, "gap_signal.evidence_reference"),
  }, "gap_signal");
}

// Pure helper mapping an observed tool-search denial plus caller context into
// a Gap_Signal. Nothing in the repository calls this today: tool-search.js
// emits no gap signal, and whether the caller is the function-calling gateway
// path, a scheduled audit, or an explicit operator invocation is unresolved.
export function gapSignalFromToolSearchDenial(denial, context) {
  if (!denial || typeof denial !== "object" || denial.authorized !== false || typeof denial.reasonCode !== "string") {
    throw new TypeError("denial must be an unauthorized tool-search result carrying a reasonCode.");
  }
  return normalizeGapSignal({
    schema: GAP_SIGNAL_SCHEMA,
    signal_id: assertIdentifier(context?.signal_id, "context.signal_id"),
    adapter_id: assertIdentifier(context?.adapter_id, "context.adapter_id"),
    capability: assertIdentifier(context?.capability, "context.capability"),
    missing_tool_names: context.missing_tool_names,
    denial_reason_code: denial.reasonCode,
    observed_at_ms: Number.isInteger(context?.observed_at_ms) ? context.observed_at_ms : Date.now(),
    evidence_reference: context?.evidence_reference ?? null,
  });
}

function normalizeCandidate(value) {
  if (!value || typeof value !== "object") throw new TypeError("candidate must be an object.");
  if (!value.agent_definition || typeof value.agent_definition !== "object") {
    throw new TypeError("candidate.agent_definition must be an object.");
  }
  if (typeof value.agent_definition.id !== "string" || !value.agent_definition.id.trim()) {
    throw new TypeError("candidate.agent_definition.id must be a non-empty string.");
  }
  const rationale = assertIdentifier(value.rationale, "candidate.rationale");
  if (!Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) {
    throw new TypeError("candidate.confidence must be between 0 and 1.");
  }
  return { agent_definition: value.agent_definition, rationale, confidence: value.confidence };
}

// Cost_Log_Entry with a key set of exactly the five universal harness fields.
// An absent usage report maps to model "unreported" with null numerics,
// following the tool-search.js convention.
export function normalizeCostEntry(usage) {
  if (!usage || typeof usage !== "object") {
    return Object.freeze({ model: "unreported", prompt_tokens: null, completion_tokens: null, cache_hits: null, estimated_cost_usd: null });
  }
  const numeric = (value) => (Number.isFinite(value) ? value : null);
  return Object.freeze({
    model: typeof usage.model === "string" && usage.model.trim() ? usage.model.trim() : "unreported",
    prompt_tokens: numeric(usage.prompt_tokens),
    completion_tokens: numeric(usage.completion_tokens),
    cache_hits: numeric(usage.cache_hits),
    estimated_cost_usd: numeric(usage.estimated_cost_usd),
  });
}

// Pure p95 sampler and breach boolean against the declared per-call budget.
export function p95CostDecision(entries, budgetUsd = PER_CALL_COST_BUDGET_USD) {
  const costs = entries
    .map((entry) => entry?.estimated_cost_usd)
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (costs.length === 0) return Object.freeze({ sampleCount: 0, p95: null, breach: false });
  const index = Math.min(costs.length - 1, Math.ceil(0.95 * costs.length) - 1);
  const p95 = costs[index];
  return Object.freeze({ sampleCount: costs.length, p95, breach: p95 > budgetUsd });
}

// Rough token estimate from JSON byte length (about four bytes per token).
// Deliberately pessimistic: the pre-call check must stop before the adapter
// call, so an overestimate fails closed rather than under.
function estimatePromptTokens(promptContext) {
  return Math.ceil(JSON.stringify(promptContext).length / 4);
}

export function createSkillProposerRuntime({
  draftStore,
  proposeCandidate,
  emitCostLog,
  emitTrace,
  now = () => Date.now(),
  iterationBound = SKILL_PROPOSER_DEFAULTS.iterationBound,
  circuitBreakerConsecutiveNoCandidate = SKILL_PROPOSER_DEFAULTS.circuitBreakerConsecutiveNoCandidate,
  maxPromptTokens = SKILL_PROPOSER_DEFAULTS.maxPromptTokens,
  maxCompletionTokens = SKILL_PROPOSER_DEFAULTS.maxCompletionTokens,
  draftTtlMs = SKILL_PROPOSER_DEFAULTS.draftTtlMs,
} = {}) {
  let proposalCount = 0;
  let draftedCount = 0;
  let budgetBreachCount = 0;

  // Requirement 5.2 declares a per-call budget of at most 800 prompt and at
  // most 400 completion tokens; a configuration above the declared ceiling is
  // rejected at construction so no call can silently exceed it.
  if (maxPromptTokens > SKILL_PROPOSER_DEFAULTS.maxPromptTokens
    || maxCompletionTokens > SKILL_PROPOSER_DEFAULTS.maxCompletionTokens) {
    throw new SkillProposalBlock(
      "budget_ceiling_exceeded",
      "The declared per-call token budget cannot exceed the harness ceiling of 800 prompt and 400 completion tokens.",
    );
  }

  async function emitTraceSafe(entry) {
    if (typeof emitTrace !== "function") return;
    try {
      await emitTrace(entry);
    } catch {
      // An observer failure never changes a terminal outcome.
    }
  }

  async function emitCostLogSafe(entry) {
    if (typeof emitCostLog !== "function") return true;
    try {
      await emitCostLog(entry);
      return true;
    } catch {
      return false;
    }
  }

  async function propose(gapSignalValue) {
    const startedAt = now();
    proposalCount += 1;

    let gapSignal;
    try {
      gapSignal = normalizeGapSignal(gapSignalValue);
    } catch (error) {
      // Zero iterations, zero adapter calls, zero Cost_Log_Entry values.
      await emitTraceSafe(Object.freeze({
        schema: SKILL_PROPOSER_TRACE_SCHEMA,
        gap_signal_id: null,
        draft_id: null,
        iteration_count: 0,
        iteration_bound: iterationBound,
        circuit_breaker: "not_tripped",
        stop_reason: "gap_signal_invalid",
        approval_status: SKILL_PROPOSAL_APPROVAL_STATUS,
        elapsed_ms: Math.max(0, now() - startedAt),
        cost_log_emitted: false,
        observation_gap: null,
      }));
      throw new SkillProposalBlock("gap_signal_invalid", error.message, { field: "gap_signal" });
    }

    let consecutiveNoCandidate = 0;
    let iterations = 0;
    let costLogEmitted = false;
    let observationGap = null;

    const traceEntry = (stopReason, circuitBreaker, draftId) => Object.freeze({
      schema: SKILL_PROPOSER_TRACE_SCHEMA,
      gap_signal_id: gapSignal.signal_id,
      draft_id: draftId,
      iteration_count: iterations,
      iteration_bound: iterationBound,
      circuit_breaker: circuitBreaker,
      stop_reason: stopReason,
      approval_status: SKILL_PROPOSAL_APPROVAL_STATUS,
      elapsed_ms: Math.max(0, now() - startedAt),
      cost_log_emitted: costLogEmitted,
      observation_gap: observationGap,
    });

    while (iterations < iterationBound) {
      const promptContext = { gap_signal: gapSignal, iteration: iterations + 1 };
      const estimatedPromptTokens = estimatePromptTokens(promptContext);
      if (estimatedPromptTokens > maxPromptTokens) {
        budgetBreachCount += 1;
        // Stop before the adapter call: zero spend, draft store unchanged.
        await emitTraceSafe(traceEntry("budget_breach", "not_tripped", null));
        return Object.freeze({
          status: "no-draft",
          reason_code: "budget_breach",
          iteration_count: iterations,
          estimated_prompt_tokens: estimatedPromptTokens,
        });
      }

      iterations += 1;
      let rawCandidate;
      try {
        rawCandidate = await proposeCandidate(promptContext);
      } catch {
        await emitTraceSafe(traceEntry("provider_unreachable", "not_tripped", null));
        return Object.freeze({ status: "no-draft", reason_code: "provider_unreachable", iteration_count: iterations });
      }

      if (!(await emitCostLogSafe(normalizeCostEntry(rawCandidate?.usage)))) {
        observationGap = "cost log emission failed; cost evidence is an observation gap";
      } else {
        costLogEmitted = true;
      }

      let candidate;
      try {
        candidate = normalizeCandidate(rawCandidate);
      } catch {
        // A malformed candidate is discarded before any store call.
        consecutiveNoCandidate += 1;
        if (consecutiveNoCandidate >= circuitBreakerConsecutiveNoCandidate) {
          await emitTraceSafe(traceEntry("circuit_breaker_tripped", "tripped", null));
          return Object.freeze({ status: "no-draft", reason_code: "circuit_breaker_tripped", iteration_count: iterations });
        }
        continue;
      }

      const createdAt = now();
      const draft = normalizeJson({
        schema: SKILL_DRAFT_SCHEMA,
        draft_id: `${gapSignal.signal_id}:${createdAt}`,
        status: "proposed",
        adapter_id: gapSignal.adapter_id,
        gap_signal_id: gapSignal.signal_id,
        agent_definition: { ...candidate.agent_definition, status: "proposed" },
        rationale: candidate.rationale,
        confidence: candidate.confidence,
        proposing_mechanism: Object.freeze({ module: SKILL_PROPOSER_MODULE, identity: SKILL_PROPOSER_IDENTITY }),
        tool_names: [...gapSignal.missing_tool_names],
        created_at_ms: createdAt,
        expires_at_ms: createdAt + draftTtlMs,
        consumed: false,
      }, "draft");

      await draftStore.put(draft);
      await draftStore.indexAppend(gapSignal.adapter_id, draft.draft_id);
      draftedCount += 1;
      await emitTraceSafe(traceEntry("candidate_accepted", "not_tripped", draft.draft_id));
      // Exactly the three declared fields: the success shape is the contract.
      return Object.freeze({
        draft_agent_definition: draft.agent_definition,
        rationale: draft.rationale,
        confidence: draft.confidence,
      });
    }

    await emitTraceSafe(traceEntry("iteration_bound_reached", "not_tripped", null));
    return Object.freeze({ status: "no-draft", reason_code: "iteration_bound_reached", iteration_count: iterations });
  }

  return Object.freeze({
    propose,
    stats: () => Object.freeze({
      draftStoreConfigured: Boolean(draftStore && typeof draftStore.put === "function"),
      modelAdapterConfigured: typeof proposeCandidate === "function",
      registryWriteCapability: false,
      iterationBound,
      circuitBreakerConsecutiveNoCandidate,
      maxPromptTokens,
      maxCompletionTokens,
      cacheHitTarget: SKILL_PROPOSER_DEFAULTS.cacheHitTarget,
      p95GapToDraftMs: SKILL_PROPOSER_DEFAULTS.p95GapToDraftMs,
      proposalCount,
      draftedCount,
      budgetBreachCount,
    }),
  });
}
