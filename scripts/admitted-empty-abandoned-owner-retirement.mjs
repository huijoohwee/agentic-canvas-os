#!/usr/bin/env node
// Responsibility: Retire one exact empty admitted owner into retired-preserved state.
import path from "node:path";

import {
  ADMITTED_EMPTY_ABANDONED_OWNER_RETIREMENT_RESULT_SCHEMA,
  normalizeAdmittedEmptyAbandonedOwnerRetirementRequest,
} from "./admitted-empty-abandoned-owner-retirement-contract.mjs";
import { retireAdmittedEmptyAbandonedOwner } from "./admitted-empty-abandoned-owner-retirement-controller.mjs";
import { createAdmittedEmptyAbandonedOwnerRetirementRepositoryAdapter } from "./admitted-empty-abandoned-owner-retirement-repository-adapter.mjs";

const argumentsList = process.argv.slice(2);
const json = argumentsList.includes("--json");

try {
  if (!argumentsList.includes("--acknowledge-admitted-empty-abandoned-owner-retirement")) {
    throw new Error("Explicit --acknowledge-admitted-empty-abandoned-owner-retirement is required.");
  }
  const repository = path.resolve(requiredOption("repository"));
  const request = normalizeAdmittedEmptyAbandonedOwnerRetirementRequest({
    repository,
    targetRepository: requiredOption("target-repository"),
    ledgerRepository: option("ledger-repository") || requiredOption("target-repository"),
    branch: requiredOption("branch"),
    sourceSessionId: requiredOption("source-session"),
    expectedHead: requiredOption("expected-head"),
    expectedPullRequest: Number(requiredOption("expected-pr")),
    expectedPullRequestUrl: requiredOption("expected-pr-url"),
    evaluatedAt: new Date().toISOString(),
  });
  const adapter = createAdmittedEmptyAbandonedOwnerRetirementRepositoryAdapter({ request });
  const result = retireAdmittedEmptyAbandonedOwner(request, adapter);
  process.stdout.write(`${JSON.stringify(result, null, json ? 0 : 2)}\n`);
} catch (error) {
  if (!json) throw error;
  process.stdout.write(`${JSON.stringify({
    schema: ADMITTED_EMPTY_ABANDONED_OWNER_RETIREMENT_RESULT_SCHEMA,
    ok: false,
    status: "error",
    error: { message: String(error?.message || error).slice(0, 500) },
  })}\n`);
  process.exitCode = 1;
}

function option(name) {
  const prefix = `--${name}=`;
  return argumentsList.find(item => item.startsWith(prefix))?.slice(prefix.length) || null;
}

function requiredOption(name) {
  const value = option(name);
  if (!value) throw new Error(`--${name}=<value> is required.`);
  return value;
}
