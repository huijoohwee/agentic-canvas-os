import { createHash } from "node:crypto";

import { PROTECTED_HEAD_REFRESH_REQUIRED_CI_CONTEXTS } from "./protected-head-refresh-shared.mjs";

export const PROTECTED_HEAD_REFRESH_REPOSITORY_POLICY_SCHEMA =
  "agentic-protected-head-refresh-repository-policy/v1";

const WORKFLOW_PATTERN = /^[A-Za-z0-9_.-]+\.ya?ml$/u;
const CONTEXT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _./:-]{0,127}$/u;
const MAX_ITEMS = 16;

export const DEFAULT_PROTECTED_HEAD_REFRESH_REPOSITORY_POLICY = Object.freeze(
  buildPolicy({
    ciWorkflow: "ci.yml",
    requiredCiContexts: PROTECTED_HEAD_REFRESH_REQUIRED_CI_CONTEXTS,
    classicRequiredChecks: [
      "test",
      "build",
      "docs-contract",
      "collaboration-integration",
      "cloud-collaboration",
    ],
    rulesetRequiredChecks: ["agentic-sdlc-policy-runtime"],
    auditedWorkflows: ["auto-delivery.yml", "cloud-collaboration.yml"],
  }),
);

export function readProtectedHeadRefreshRepositoryPolicy({ environment = process.env } = {}) {
  return buildPolicy({
    ciWorkflow: environment.PROTECTED_HEAD_REFRESH_CI_WORKFLOW
      || DEFAULT_PROTECTED_HEAD_REFRESH_REPOSITORY_POLICY.ciWorkflow,
    requiredCiContexts: readArray(
      environment.PROTECTED_HEAD_REFRESH_REQUIRED_CI_CONTEXTS_JSON,
      DEFAULT_PROTECTED_HEAD_REFRESH_REPOSITORY_POLICY.requiredCiContexts,
      "required CI contexts",
    ),
    classicRequiredChecks: readArray(
      environment.PROTECTED_HEAD_REFRESH_CLASSIC_REQUIRED_CHECKS_JSON,
      DEFAULT_PROTECTED_HEAD_REFRESH_REPOSITORY_POLICY.classicRequiredChecks,
      "classic required checks",
      { allowEmpty: true },
    ),
    rulesetRequiredChecks: readArray(
      environment.PROTECTED_HEAD_REFRESH_RULESET_REQUIRED_CHECKS_JSON,
      DEFAULT_PROTECTED_HEAD_REFRESH_REPOSITORY_POLICY.rulesetRequiredChecks,
      "ruleset required checks",
      { allowEmpty: true },
    ),
    auditedWorkflows: readArray(
      environment.PROTECTED_HEAD_REFRESH_AUDITED_WORKFLOWS_JSON,
      DEFAULT_PROTECTED_HEAD_REFRESH_REPOSITORY_POLICY.auditedWorkflows,
      "audited workflows",
    ),
  });
}

function buildPolicy({
  ciWorkflow,
  requiredCiContexts,
  classicRequiredChecks,
  rulesetRequiredChecks,
  auditedWorkflows,
}) {
  const normalizedClassicRequiredChecks = contexts(
    classicRequiredChecks,
    "classic required checks",
    { allowEmpty: true },
  );
  const normalizedRulesetRequiredChecks = contexts(
    rulesetRequiredChecks,
    "ruleset required checks",
    { allowEmpty: true },
  );
  if (
    normalizedClassicRequiredChecks.length === 0
    && normalizedRulesetRequiredChecks.length === 0
  ) {
    throw new Error(
      "Protected-head refresh requires at least one classic or ruleset required check.",
    );
  }
  const core = {
    schema: PROTECTED_HEAD_REFRESH_REPOSITORY_POLICY_SCHEMA,
    ciWorkflow: workflow(ciWorkflow, "CI workflow"),
    requiredCiContexts: contexts(requiredCiContexts, "required CI contexts"),
    classicRequiredChecks: normalizedClassicRequiredChecks,
    rulesetRequiredChecks: normalizedRulesetRequiredChecks,
    auditedWorkflows: workflows(auditedWorkflows, "audited workflows"),
  };
  return Object.freeze({
    ...core,
    policyDigest: createHash("sha256").update(JSON.stringify(core)).digest("hex"),
  });
}

function readArray(value, fallback, label, options = {}) {
  if (value === undefined || value === "") return fallback;
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`Protected-head refresh ${label} must be valid JSON.`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Protected-head refresh ${label} must be a JSON array.`);
  }
  if (!options.allowEmpty && parsed.length === 0) {
    throw new Error(`Protected-head refresh ${label} cannot be empty.`);
  }
  return parsed;
}

function contexts(values, label, { allowEmpty = false } = {}) {
  return exactList(values, label, { allowEmpty, normalize: value => {
    if (typeof value !== "string" || !CONTEXT_PATTERN.test(value)) {
      throw new Error(`Protected-head refresh ${label} contains an invalid context.`);
    }
    return value;
  } });
}

function workflows(values, label) {
  return exactList(values, label, { normalize: value => workflow(value, label) });
}

function workflow(value, label) {
  if (typeof value !== "string" || !WORKFLOW_PATTERN.test(value)) {
    throw new Error(`Protected-head refresh ${label} must be a safe workflow filename.`);
  }
  return value;
}

function exactList(values, label, { allowEmpty = false, normalize }) {
  if (!Array.isArray(values) || (!allowEmpty && values.length === 0) || values.length > MAX_ITEMS) {
    throw new Error(`Protected-head refresh ${label} has an invalid bounded cardinality.`);
  }
  const normalized = values.map(normalize);
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`Protected-head refresh ${label} must be unique.`);
  }
  return Object.freeze(normalized);
}
