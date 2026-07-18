import { createHash, randomUUID } from "node:crypto";

import { normalizeJson, serializedJsonLength } from "./json-contract.js";

const DEFAULT_MAX_VALUE_CHARS = 200_000;
const DEFAULT_MAX_REFERENCES = 64;
const DEFAULT_MAX_PENDING_REVIEWS = 256;
const DEFAULT_REVIEW_TTL_MS = 86_400_000;
const GUARDRAIL_STAGES = new Set(["input", "output", "tool-input", "tool-output"]);
const REVIEW_DECISIONS = new Set(["approve", "reject", "edit"]);

export class GuardrailsHumanReviewBlock extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = "GuardrailsHumanReviewBlock";
    this.reasonCode = reasonCode;
  }
}

function assertPositiveInteger(value, field) {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${field} must be a positive integer.`);
  return value;
}

function assertIdentifier(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} must be a non-empty string.`);
  const normalized = value.trim();
  if (normalized.length > 256) throw new RangeError(`${field} exceeds 256 characters.`);
  return normalized;
}

function assertText(value, field, maxChars = 2_000) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} must be a non-empty string.`);
  if (value.length > maxChars) throw new RangeError(`${field} exceeds ${maxChars} characters.`);
  return value.trim();
}

function assertExactKeys(value, allowedKeys, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${field} must be an object.`);
  const unknown = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unknown.length) throw new TypeError(`${field} contains unsupported fields: ${unknown.join(", ")}.`);
}

function assertOwner(value, methods, field) {
  if (!value || typeof value !== "object") throw new TypeError(`${field} must be an object.`);
  for (const method of methods) {
    if (typeof value[method] !== "function") throw new TypeError(`${field}.${method} must be a function.`);
  }
}

function normalizeAgent(value) {
  assertExactKeys(value, ["agentId", "revision"], "agent");
  return Object.freeze({
    agentId: assertIdentifier(value.agentId, "agent.agentId"),
    revision: assertIdentifier(value.revision, "agent.revision"),
  });
}

function normalizeBoundedJson(value, field, maxChars) {
  const normalized = normalizeJson(value, field);
  if (serializedJsonLength(normalized) > maxChars) throw new RangeError(`${field} exceeds ${maxChars} serialized characters.`);
  return normalized;
}

function normalizeReferences(value, stage, maxReferences) {
  if (!Array.isArray(value)) throw new TypeError("guardrails must be an array.");
  if (value.length > maxReferences) throw new RangeError(`guardrails must contain at most ${maxReferences} entries.`);
  const names = new Set();
  return Object.freeze(value.map((reference, index) => {
    const field = `guardrails[${index}]`;
    assertExactKeys(reference, ["name", "stage"], field);
    const name = assertIdentifier(reference.name, `${field}.name`);
    if (reference.stage !== stage) throw new TypeError(`${field}.stage must equal ${stage}.`);
    if (names.has(name)) throw new TypeError(`guardrails contains duplicate ${name}.`);
    names.add(name);
    return Object.freeze({ name, stage });
  }));
}

function normalizeTool(value, stage) {
  if (!stage.startsWith("tool-")) {
    if (value !== undefined) throw new TypeError("tool is valid only for a tool guardrail stage.");
    return undefined;
  }
  assertExactKeys(value, ["callId", "name", "riskClass"], "tool");
  return Object.freeze({
    callId: assertIdentifier(value.callId, "tool.callId"),
    name: assertIdentifier(value.name, "tool.name"),
    riskClass: assertIdentifier(value.riskClass, "tool.riskClass"),
  });
}

function normalizeValidationRequest(value, limits) {
  assertExactKeys(
    value,
    ["runId", "conversationId", "agent", "stage", "guardrails", "value", "tool"],
    "request",
  );
  if (!GUARDRAIL_STAGES.has(value.stage)) throw new TypeError("request.stage is unsupported.");
  return Object.freeze({
    runId: assertIdentifier(value.runId, "request.runId"),
    conversationId: assertIdentifier(value.conversationId, "request.conversationId"),
    agent: normalizeAgent(value.agent),
    stage: value.stage,
    guardrails: normalizeReferences(value.guardrails, value.stage, limits.maxReferences),
    value: normalizeBoundedJson(value.value, "request.value", limits.maxValueChars),
    tool: normalizeTool(value.tool, value.stage),
  });
}

function normalizeGuardrailVerdict(value, field, currentValue, maxValueChars) {
  assertExactKeys(value, ["passed", "value", "reasonCode", "message", "evidence"], field);
  if (typeof value.passed !== "boolean") throw new TypeError(`${field}.passed must be boolean.`);
  const nextValue = value.value === undefined
    ? currentValue
    : normalizeBoundedJson(value.value, `${field}.value`, maxValueChars);
  return Object.freeze({
    passed: value.passed,
    value: nextValue,
    transformed: value.value !== undefined,
    reasonCode: value.reasonCode === undefined ? "guardrail_rejected" : assertIdentifier(value.reasonCode, `${field}.reasonCode`),
    message: value.message === undefined ? "An application guardrail rejected the value." : assertText(value.message, `${field}.message`),
    ...(value.evidence === undefined
      ? {}
      : { evidence: normalizeBoundedJson(value.evidence, `${field}.evidence`, maxValueChars) }),
  });
}

function blockedValidation(request, reasonCode, message, checks = []) {
  return Object.freeze({
    status: "blocked",
    stage: request.stage,
    runId: request.runId,
    conversationId: request.conversationId,
    agent: request.agent,
    reasonCode,
    message,
    checks: Object.freeze(checks),
  });
}

function actionDigest(action) {
  return createHash("sha256").update(JSON.stringify(action)).digest("hex");
}

function normalizeAction(value, maxValueChars) {
  assertExactKeys(value, ["actionId", "kind", "name", "riskClass", "payload"], "action");
  return Object.freeze({
    actionId: assertIdentifier(value.actionId, "action.actionId"),
    kind: assertIdentifier(value.kind, "action.kind"),
    name: assertIdentifier(value.name, "action.name"),
    riskClass: assertIdentifier(value.riskClass, "action.riskClass"),
    payload: normalizeBoundedJson(value.payload, "action.payload", maxValueChars),
  });
}

function normalizeReviewRequest(value, maxValueChars) {
  assertExactKeys(value, ["runId", "conversationId", "agent", "action", "message"], "request");
  return Object.freeze({
    runId: assertIdentifier(value.runId, "request.runId"),
    conversationId: assertIdentifier(value.conversationId, "request.conversationId"),
    agent: normalizeAgent(value.agent),
    action: normalizeAction(value.action, maxValueChars),
    message: assertText(value.message, "request.message"),
  });
}

function normalizeResumeState(value) {
  assertExactKeys(value, ["schema", "reviewId", "runId", "conversationId", "actionDigest"], "state");
  if (value.schema !== "agentic-human-review-state/v1") throw new TypeError("state.schema is unsupported.");
  return Object.freeze({
    schema: value.schema,
    reviewId: assertIdentifier(value.reviewId, "state.reviewId"),
    runId: assertIdentifier(value.runId, "state.runId"),
    conversationId: assertIdentifier(value.conversationId, "state.conversationId"),
    actionDigest: assertIdentifier(value.actionDigest, "state.actionDigest"),
  });
}

function normalizeStoredReview(value, maxValueChars) {
  assertExactKeys(
    value,
    ["reviewId", "runId", "conversationId", "agent", "action", "message", "actionDigest", "createdAt", "expiresAt"],
    "storedReview",
  );
  if (!Number.isFinite(value.createdAt) || !Number.isFinite(value.expiresAt) || value.expiresAt <= value.createdAt) {
    throw new TypeError("storedReview timestamps are invalid.");
  }
  return Object.freeze({
    reviewId: assertIdentifier(value.reviewId, "storedReview.reviewId"),
    runId: assertIdentifier(value.runId, "storedReview.runId"),
    conversationId: assertIdentifier(value.conversationId, "storedReview.conversationId"),
    agent: normalizeAgent(value.agent),
    action: normalizeAction(value.action, maxValueChars),
    message: assertText(value.message, "storedReview.message"),
    actionDigest: assertIdentifier(value.actionDigest, "storedReview.actionDigest"),
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
  });
}

function normalizeResolution(value, maxValueChars) {
  assertExactKeys(value, ["reviewId", "decision", "reviewerEvidence", "reason", "editedPayload"], "resolution");
  if (!REVIEW_DECISIONS.has(value.decision)) throw new TypeError("resolution.decision is unsupported.");
  if (value.decision === "edit" && value.editedPayload === undefined) {
    throw new TypeError("resolution.editedPayload is required for an edit decision.");
  }
  if (value.decision !== "edit" && value.editedPayload !== undefined) {
    throw new TypeError("resolution.editedPayload is valid only for an edit decision.");
  }
  return Object.freeze({
    reviewId: assertIdentifier(value.reviewId, "resolution.reviewId"),
    decision: value.decision,
    reviewerEvidence: normalizeBoundedJson(value.reviewerEvidence, "resolution.reviewerEvidence", maxValueChars),
    ...(value.reason === undefined ? {} : { reason: assertText(value.reason, "resolution.reason") }),
    ...(value.editedPayload === undefined
      ? {}
      : { editedPayload: normalizeBoundedJson(value.editedPayload, "resolution.editedPayload", maxValueChars) }),
  });
}

function normalizeReviewerAuthentication(value) {
  assertExactKeys(value, ["authenticated", "subjectId", "evidenceId", "assurance"], "reviewerAuthentication");
  if (value.authenticated !== true) return Object.freeze({ authenticated: false });
  return Object.freeze({
    authenticated: true,
    subjectId: assertIdentifier(value.subjectId, "reviewerAuthentication.subjectId"),
    evidenceId: assertIdentifier(value.evidenceId, "reviewerAuthentication.evidenceId"),
    assurance: assertIdentifier(value.assurance, "reviewerAuthentication.assurance"),
  });
}

export function createMemoryHumanReviewStore({ maxPendingReviews = DEFAULT_MAX_PENDING_REVIEWS } = {}) {
  assertPositiveInteger(maxPendingReviews, "maxPendingReviews");
  const records = new Map();
  return Object.freeze({
    put(record) {
      if (records.has(record.reviewId)) return false;
      if (records.size >= maxPendingReviews) throw new GuardrailsHumanReviewBlock("review_capacity", "Human-review capacity is exhausted.");
      records.set(record.reviewId, record);
      return true;
    },
    take(reviewId) {
      const record = records.get(reviewId);
      if (!record) return null;
      records.delete(reviewId);
      return record;
    },
    stats: () => Object.freeze({ pendingReviews: records.size, persistence: "isolate-memory" }),
  });
}

export function createGuardrailsHumanReviewRuntime({
  evaluateGuardrail,
  authenticateReviewer,
  reviewStore = createMemoryHumanReviewStore(),
  createReviewId = randomUUID,
  now = Date.now,
  maxValueChars = DEFAULT_MAX_VALUE_CHARS,
  maxReferences = DEFAULT_MAX_REFERENCES,
  reviewTtlMs = DEFAULT_REVIEW_TTL_MS,
} = {}) {
  if (evaluateGuardrail !== undefined && typeof evaluateGuardrail !== "function") {
    throw new TypeError("evaluateGuardrail must be a function when provided.");
  }
  if (authenticateReviewer !== undefined && typeof authenticateReviewer !== "function") {
    throw new TypeError("authenticateReviewer must be a function when provided.");
  }
  assertOwner(reviewStore, ["put", "take"], "reviewStore");
  if (typeof createReviewId !== "function") throw new TypeError("createReviewId must be a function.");
  if (typeof now !== "function") throw new TypeError("now must be a function.");
  const limits = {
    maxValueChars: assertPositiveInteger(maxValueChars, "maxValueChars"),
    maxReferences: assertPositiveInteger(maxReferences, "maxReferences"),
    reviewTtlMs: assertPositiveInteger(reviewTtlMs, "reviewTtlMs"),
  };
  let validations = 0;
  let passedValidations = 0;
  let blockedValidations = 0;
  let guardrailCalls = 0;
  let requestedReviews = 0;
  let approvedReviews = 0;
  let rejectedReviews = 0;
  let editedReviews = 0;
  let blockedReviews = 0;
  let authenticatedReviews = 0;

  async function validate(value = {}) {
    const request = normalizeValidationRequest(value, limits);
    validations += 1;
    if (request.guardrails.length === 0) {
      passedValidations += 1;
      return Object.freeze({ ...request, status: "passed", checks: Object.freeze([]) });
    }
    if (typeof evaluateGuardrail !== "function") {
      blockedValidations += 1;
      return blockedValidation(request, "guardrail_evaluator_unconfigured", "Application guardrails require an evaluator.");
    }
    const checks = [];
    let currentValue = request.value;
    for (const guardrail of request.guardrails) {
      guardrailCalls += 1;
      let verdict;
      try {
        verdict = normalizeGuardrailVerdict(
          await evaluateGuardrail(Object.freeze({ ...request, guardrail, value: currentValue })),
          `guardrail.${guardrail.name}`,
          currentValue,
          maxValueChars,
        );
      } catch (error) {
        blockedValidations += 1;
        return blockedValidation(
          request,
          "guardrail_failed",
          `Guardrail ${guardrail.name} failed: ${error instanceof Error ? error.message : String(error)}`,
          checks,
        );
      }
      checks.push(Object.freeze({ name: guardrail.name, passed: verdict.passed, transformed: verdict.transformed }));
      if (!verdict.passed) {
        blockedValidations += 1;
        return blockedValidation(request, verdict.reasonCode, verdict.message, checks);
      }
      currentValue = verdict.value;
    }
    passedValidations += 1;
    return Object.freeze({
      status: "passed",
      stage: request.stage,
      runId: request.runId,
      conversationId: request.conversationId,
      agent: request.agent,
      value: currentValue,
      checks: Object.freeze(checks),
    });
  }

  async function requestReview(value = {}) {
    const request = normalizeReviewRequest(value, maxValueChars);
    const reviewId = assertIdentifier(createReviewId(), "reviewId");
    const createdAt = now();
    if (!Number.isFinite(createdAt)) throw new TypeError("now must return a finite timestamp.");
    const digest = actionDigest(request.action);
    const record = Object.freeze({
      reviewId,
      ...request,
      actionDigest: digest,
      createdAt,
      expiresAt: createdAt + reviewTtlMs,
    });
    try {
      if (await reviewStore.put(record) !== true) throw new GuardrailsHumanReviewBlock("review_conflict", "Human-review identity already exists.");
    } catch (error) {
      blockedReviews += 1;
      throw error;
    }
    requestedReviews += 1;
    return Object.freeze({
      status: "paused",
      interruptions: Object.freeze([Object.freeze({
        id: reviewId,
        kind: "approval",
        message: request.message,
        metadata: Object.freeze({ action: request.action, expiresAt: record.expiresAt }),
      })]),
      resumeState: Object.freeze({
        schema: "agentic-human-review-state/v1",
        reviewId,
        runId: request.runId,
        conversationId: request.conversationId,
        actionDigest: digest,
      }),
    });
  }

  async function resolveReview({ state, resolution } = {}) {
    let safeState;
    let safeResolution;
    try {
      safeState = normalizeResumeState(state);
      safeResolution = normalizeResolution(resolution, maxValueChars);
    } catch {
      blockedReviews += 1;
      return Object.freeze({ status: "blocked", reasonCode: "review_resolution_invalid", stateConsumed: false });
    }
    if (safeState.reviewId !== safeResolution.reviewId) {
      blockedReviews += 1;
      return Object.freeze({ status: "blocked", reasonCode: "review_identity_mismatch", stateConsumed: false });
    }
    if (typeof authenticateReviewer !== "function") {
      blockedReviews += 1;
      return Object.freeze({ status: "blocked", reasonCode: "reviewer_authenticator_unconfigured", stateConsumed: false });
    }
    let reviewer;
    try {
      reviewer = normalizeReviewerAuthentication(await authenticateReviewer(Object.freeze({
        state: safeState,
        reviewId: safeResolution.reviewId,
        evidence: safeResolution.reviewerEvidence,
      })));
    } catch {
      blockedReviews += 1;
      return Object.freeze({ status: "blocked", reasonCode: "reviewer_authentication_failed", stateConsumed: false });
    }
    if (!reviewer.authenticated) {
      blockedReviews += 1;
      return Object.freeze({ status: "blocked", reasonCode: "reviewer_unauthenticated", stateConsumed: false });
    }
    authenticatedReviews += 1;
    const storedRecord = await reviewStore.take(safeState.reviewId);
    if (!storedRecord) {
      blockedReviews += 1;
      return Object.freeze({ status: "blocked", reasonCode: "review_missing_or_consumed", stateConsumed: true });
    }
    let record;
    try {
      record = normalizeStoredReview(storedRecord, maxValueChars);
    } catch {
      blockedReviews += 1;
      return Object.freeze({ status: "blocked", reasonCode: "review_state_invalid", stateConsumed: true });
    }
    if (
      record.runId !== safeState.runId
      || record.conversationId !== safeState.conversationId
      || record.actionDigest !== safeState.actionDigest
    ) {
      blockedReviews += 1;
      return Object.freeze({ status: "blocked", reasonCode: "review_state_mismatch", stateConsumed: true });
    }
    const decidedAt = now();
    if (!Number.isFinite(decidedAt) || decidedAt > record.expiresAt) {
      blockedReviews += 1;
      return Object.freeze({ status: "blocked", reasonCode: "review_expired", stateConsumed: true });
    }
    const audit = Object.freeze({
      schema: "agentic-human-review-audit/v1",
      reviewId: record.reviewId,
      runId: record.runId,
      conversationId: record.conversationId,
      actionId: record.action.actionId,
      decision: safeResolution.decision,
      reviewerSubjectId: reviewer.subjectId,
      reviewerEvidenceId: reviewer.evidenceId,
      reviewerAssurance: reviewer.assurance,
      decidedAt,
      ...(safeResolution.reason === undefined ? {} : { reason: safeResolution.reason }),
    });
    if (safeResolution.decision === "reject") {
      rejectedReviews += 1;
      return Object.freeze({ status: "rejected", audit, stateConsumed: true });
    }
    const edited = safeResolution.decision === "edit";
    if (edited) editedReviews += 1;
    else approvedReviews += 1;
    const action = edited
      ? Object.freeze({ ...record.action, payload: safeResolution.editedPayload })
      : record.action;
    return Object.freeze({ status: "approved", action, edited, requiresValidation: edited, audit, stateConsumed: true });
  }

  function stats() {
    const storeStats = typeof reviewStore.stats === "function" ? reviewStore.stats() : {};
    return Object.freeze({
      guardrailEvaluatorConfigured: typeof evaluateGuardrail === "function",
      reviewerAuthenticatorConfigured: typeof authenticateReviewer === "function",
      reviewStoreConfigured: true,
      automaticStages: Object.freeze([...GUARDRAIL_STAGES]),
      reviewDecisions: Object.freeze([...REVIEW_DECISIONS]),
      validations,
      passedValidations,
      blockedValidations,
      guardrailCalls,
      requestedReviews,
      approvedReviews,
      rejectedReviews,
      editedReviews,
      authenticatedReviews,
      blockedReviews,
      ...storeStats,
      ...limits,
    });
  }

  return Object.freeze({ validate, requestReview, resolveReview, stats });
}

export const GUARDRAILS_HUMAN_REVIEW_DEFAULTS = Object.freeze({
  maxValueChars: DEFAULT_MAX_VALUE_CHARS,
  maxReferences: DEFAULT_MAX_REFERENCES,
  maxPendingReviews: DEFAULT_MAX_PENDING_REVIEWS,
  reviewTtlMs: DEFAULT_REVIEW_TTL_MS,
});
