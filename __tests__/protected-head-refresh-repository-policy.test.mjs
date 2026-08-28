import assert from "node:assert/strict";
import test from "node:test";

import {
  readProtectedHeadRefreshRepositoryPolicy,
} from "../scripts/protected-head-refresh-repository-policy.mjs";

const baseEnvironment = Object.freeze({
  PROTECTED_HEAD_REFRESH_CI_WORKFLOW: "integration.yml",
  PROTECTED_HEAD_REFRESH_REQUIRED_CI_CONTEXTS_JSON: '["Integration Gate"]',
  PROTECTED_HEAD_REFRESH_AUDITED_WORKFLOWS_JSON: '["auto-delivery.yml"]',
});

test("repository policy accepts ruleset-only protected consumers", () => {
  const policy = readProtectedHeadRefreshRepositoryPolicy({ environment: {
    ...baseEnvironment,
    PROTECTED_HEAD_REFRESH_CLASSIC_REQUIRED_CHECKS_JSON: "[]",
    PROTECTED_HEAD_REFRESH_RULESET_REQUIRED_CHECKS_JSON: '["Policy Gate"]',
  } });

  assert.deepEqual(policy.classicRequiredChecks, []);
  assert.deepEqual(policy.rulesetRequiredChecks, ["Policy Gate"]);
});

test("repository policy rejects a consumer with no protection gate", () => {
  assert.throws(() => readProtectedHeadRefreshRepositoryPolicy({ environment: {
    ...baseEnvironment,
    PROTECTED_HEAD_REFRESH_CLASSIC_REQUIRED_CHECKS_JSON: "[]",
    PROTECTED_HEAD_REFRESH_RULESET_REQUIRED_CHECKS_JSON: "[]",
  } }), /at least one classic or ruleset required check/u);
});
