const SUITE_SCHEMA = "agentic-instruction-task-quality-suite/v1";
const CANDIDATE_SCHEMA = "agentic-instruction-task-quality-candidate/v1";
const MAX_CASES = 32;
const MAX_RESPONSE_CHARS = 20_000;
const USAGE_FIELDS = new Set(["prompt_tokens", "completion_tokens", "total_tokens", "estimated_cost_usd"]);

export const INSTRUCTION_TASK_QUALITY_SCHEMA = "agentic-instruction-task-quality/v1";
export const INSTRUCTION_TASK_QUALITY_SUITE_SCHEMA = SUITE_SCHEMA;
export const INSTRUCTION_TASK_QUALITY_CANDIDATE_SCHEMA = CANDIDATE_SCHEMA;

export function validateInstructionTaskQualitySuite(suite) {
  const errors = [];
  if (!isObject(suite) || suite.schema !== SUITE_SCHEMA) {
    errors.push("suite schema must be agentic-instruction-task-quality-suite/v1");
    return errors;
  }
  if (!isNonEmptyString(suite.suiteId)) errors.push("suiteId must be a non-empty string");
  if (!Array.isArray(suite.cases) || suite.cases.length === 0) {
    errors.push("cases must be a non-empty array");
    return errors;
  }
  if (suite.cases.length > MAX_CASES) errors.push(`cases must contain at most ${MAX_CASES} entries`);

  const caseIds = new Set();
  for (const [index, testCase] of suite.cases.entries()) {
    const path = `cases[${index}]`;
    if (!isObject(testCase)) {
      errors.push(`${path} must be an object`);
      continue;
    }
    if (!isNonEmptyString(testCase.id)) errors.push(`${path}.id must be a non-empty string`);
    else if (caseIds.has(testCase.id)) errors.push(`${path}.id must be unique: ${testCase.id}`);
    else caseIds.add(testCase.id);
    if (!isBoundedString(testCase.prompt, 2_000)) errors.push(`${path}.prompt must be a non-empty string of at most 2000 characters`);
    if (!Number.isInteger(testCase.maxWords) || testCase.maxWords < 20 || testCase.maxWords > 400) {
      errors.push(`${path}.maxWords must be an integer from 20 to 400`);
    }
    validateRules(testCase.criteria, `${path}.criteria`, "anyOf", errors, true);
    validateRules(testCase.forbidden, `${path}.forbidden`, "phrases", errors, false);
  }
  return errors;
}

export function evaluateInstructionTaskQuality({ suite, candidate } = {}) {
  const suiteErrors = validateInstructionTaskQualitySuite(suite);
  const candidateErrors = validateCandidate(candidate, suite);
  const validationErrors = [...suiteErrors, ...candidateErrors];
  if (validationErrors.length > 0) return invalidReport(suite, candidate, validationErrors);

  const cases = suite.cases.map((testCase) => scoreCase(testCase, candidate.responses[testCase.id]));
  const passedCases = cases.filter(({ status }) => status === "passed").length;
  const score = round(cases.reduce((sum, result) => sum + result.score, 0) / cases.length);

  return {
    schema: INSTRUCTION_TASK_QUALITY_SCHEMA,
    status: passedCases === cases.length ? "passed" : "failed",
    suiteId: suite.suiteId,
    candidate: candidateIdentity(candidate),
    summary: {
      totalCases: cases.length,
      passedCases,
      failedCases: cases.length - passedCases,
      score,
    },
    cases,
    validationErrors: [],
    execution: evaluatorExecution(candidate),
    deployBoundary: unchangedDeployBoundary(),
  };
}

function validateCandidate(candidate, suite) {
  const errors = [];
  if (!isObject(candidate) || candidate.schema !== CANDIDATE_SCHEMA) {
    errors.push("candidate schema must be agentic-instruction-task-quality-candidate/v1");
    return errors;
  }
  if (!isBoundedString(candidate.candidateId, 200)) errors.push("candidateId must be a non-empty string of at most 200 characters");
  if (!isBoundedString(candidate.instructionRevision, 200)) errors.push("instructionRevision must be a non-empty string of at most 200 characters");
  if (!isObject(candidate.provenance) || !["recorded", "live"].includes(candidate.provenance.mode)) {
    errors.push("provenance.mode must be recorded or live");
  } else {
    if (candidate.provenance.model !== undefined && !isBoundedString(candidate.provenance.model, 200)) {
      errors.push("provenance.model must be a non-empty string of at most 200 characters when present");
    }
    validateUsage(candidate.provenance.usage, errors);
  }
  if (!isObject(candidate.responses)) {
    errors.push("responses must be a case-id-to-final-answer object");
    return errors;
  }
  if (Array.isArray(suite?.cases)) {
    const expected = new Set(suite.cases.map(({ id }) => id));
    for (const id of expected) {
      if (!isBoundedString(candidate.responses[id], MAX_RESPONSE_CHARS)) {
        errors.push(`response is missing or exceeds ${MAX_RESPONSE_CHARS} characters for case: ${id}`);
      }
    }
    for (const id of Object.keys(candidate.responses)) {
      if (!expected.has(id)) errors.push(`response has unknown case: ${id}`);
    }
  }
  return errors;
}

function validateRules(rules, path, phraseField, errors, required) {
  if (!Array.isArray(rules) || (required && rules.length === 0)) {
    errors.push(`${path} must be ${required ? "a non-empty" : "an"} array`);
    return;
  }
  if (rules.length > 32) errors.push(`${path} must contain at most 32 rules`);
  const ids = new Set();
  for (const [index, rule] of rules.entries()) {
    const rulePath = `${path}[${index}]`;
    if (!isObject(rule) || !isNonEmptyString(rule.id)) {
      errors.push(`${rulePath}.id must be a non-empty string`);
      continue;
    }
    if (ids.has(rule.id)) errors.push(`${rulePath}.id must be unique: ${rule.id}`);
    ids.add(rule.id);
    if (!Array.isArray(rule[phraseField]) || rule[phraseField].length === 0 || rule[phraseField].length > 16
      || !rule[phraseField].every((phrase) => isBoundedString(phrase, 200))) {
      errors.push(`${rulePath}.${phraseField} must contain 1 to 16 strings of at most 200 characters`);
    }
  }
}

function scoreCase(testCase, response) {
  const normalized = normalize(response);
  const wordCount = response.trim().split(/\s+/).filter(Boolean).length;
  const criteria = testCase.criteria.map((criterion) => ({
    id: criterion.id,
    passed: criterion.anyOf.some((phrase) => normalized.includes(normalize(phrase))),
  }));
  const forbidden = testCase.forbidden.map((rule) => ({
    id: rule.id,
    triggered: rule.phrases.some((phrase) => normalized.includes(normalize(phrase))),
  }));
  const criteriaPassed = criteria.filter(({ passed }) => passed).length;
  const safetyPassed = forbidden.every(({ triggered }) => !triggered);
  const concisionPassed = wordCount <= testCase.maxWords;
  const denominator = criteria.length + 2;
  const score = round(100 * (criteriaPassed + Number(safetyPassed) + Number(concisionPassed)) / denominator);
  const status = criteriaPassed === criteria.length && safetyPassed && concisionPassed ? "passed" : "failed";

  return {
    id: testCase.id,
    status,
    score,
    wordCount,
    maxWords: testCase.maxWords,
    criteria,
    forbidden,
    concisionPassed,
  };
}

function invalidReport(suite, candidate, validationErrors) {
  return {
    schema: INSTRUCTION_TASK_QUALITY_SCHEMA,
    status: "invalid",
    suiteId: isNonEmptyString(suite?.suiteId) ? suite.suiteId : null,
    candidate: candidateIdentity(candidate),
    summary: { totalCases: 0, passedCases: 0, failedCases: 0, score: 0 },
    cases: [],
    validationErrors,
    execution: evaluatorExecution(candidate),
    deployBoundary: unchangedDeployBoundary(),
  };
}

function candidateIdentity(candidate) {
  return {
    candidateId: isNonEmptyString(candidate?.candidateId) ? candidate.candidateId : null,
    instructionRevision: isNonEmptyString(candidate?.instructionRevision) ? candidate.instructionRevision : null,
    provenanceMode: candidate?.provenance?.mode ?? null,
    model: isNonEmptyString(candidate?.provenance?.model) ? candidate.provenance.model : null,
  };
}

function evaluatorExecution(candidate) {
  return {
    modelInvokedByEvaluator: false,
    candidateUsage: sanitizeUsage(candidate?.provenance?.usage),
    privateReasoningInspected: false,
  };
}

function unchangedDeployBoundary() {
  return { prodMirrorAttempted: false, cloudflareAttempted: false };
}

function normalize(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isBoundedString(value, maxLength) {
  return isNonEmptyString(value) && value.length <= maxLength;
}

function validateUsage(usage, errors) {
  if (usage === undefined) return;
  if (!isObject(usage)) {
    errors.push("provenance.usage must be an object when present");
    return;
  }
  for (const [field, value] of Object.entries(usage)) {
    if (!USAGE_FIELDS.has(field)) errors.push(`provenance.usage has unknown field: ${field}`);
    else if (!Number.isFinite(value) || value < 0) errors.push(`provenance.usage.${field} must be a non-negative number`);
  }
}

function sanitizeUsage(usage) {
  if (!isObject(usage)) return null;
  const sanitized = Object.fromEntries(Object.entries(usage).filter(([field, value]) => (
    USAGE_FIELDS.has(field) && Number.isFinite(value) && value >= 0
  )));
  return Object.keys(sanitized).length > 0 ? sanitized : null;
}
