#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import {
  planReviewedLaneRevision,
  runReviewedLaneRevision,
} from "./reviewed-lane-revision-controller.mjs";
import {
  createReviewedLaneRevisionRepositoryAdapter,
} from "./reviewed-lane-revision-repository-adapter.mjs";

export async function mainReviewedLaneRevision(
  argv = process.argv.slice(2),
  dependencies = {},
) {
  const [command, ...argumentsList] = argv;
  if (!command || !["plan", "run"].includes(command)) {
    throw new Error(usage());
  }
  const options = parseOptions(argumentsList);
  const replacementSubject = required(options, "replacement-subject");
  const adapter = (dependencies.createAdapter
    || createReviewedLaneRevisionRepositoryAdapter)({
    environment: dependencies.environment || process.env,
    ledgerRepository: options["ledger-repository"],
    pullRequestNumber: optionalPositiveInteger(options, "pull-request"),
    repository: required(options, "repository"),
    sessionId: required(options, "session"),
  }, dependencies);

  if (command === "plan") {
    const plan = await planReviewedLaneRevision({ replacementSubject }, { adapter });
    return Object.freeze({
      schema: "agentic-reviewed-lane-revision-plan-result/v1",
      status: "planned",
      exactAuthorization: plan.exactAuthorization
        || `authorize reviewed-lane-revision ${plan.planDigest}`,
      plan,
    });
  }
  return runReviewedLaneRevision({
    authorization: required(options, "authorize"),
    replacementSubject,
  }, { adapter });
}

function parseOptions(argumentsList) {
  const options = {};
  for (const argument of argumentsList) {
    if (!argument.startsWith("--") || !argument.includes("=")) {
      throw new Error(`Unsupported argument: ${publicText(argument)}.`);
    }
    const separator = argument.indexOf("=");
    const name = argument.slice(2, separator);
    const value = argument.slice(separator + 1);
    if (!name || !value || Object.hasOwn(options, name)) {
      throw new Error(`Invalid or duplicate --${publicText(name)} option.`);
    }
    options[name] = value;
  }
  const supported = new Set([
    "authorize",
    "ledger-repository",
    "pull-request",
    "replacement-subject",
    "repository",
    "session",
  ]);
  for (const name of Object.keys(options)) {
    if (!supported.has(name)) throw new Error(`Unsupported --${publicText(name)} option.`);
  }
  return Object.freeze(options);
}

function required(options, name) {
  const value = String(options[name] || "");
  if (!value) throw new Error(`--${name}=... is required.`);
  return value;
}

function optionalPositiveInteger(options, name) {
  if (!Object.hasOwn(options, name)) return null;
  const value = Number(options[name]);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`--${name}=... must be a positive integer.`);
  }
  return value;
}

function usage() {
  return "Usage: reviewed-lane-revision.mjs plan|run --repository=<registered-worktree> --session=<id> --replacement-subject=<exact-subject> [--pull-request=<number>] [--ledger-repository=<owner/repo>] [--authorize=<exact-plan-authorization>]";
}

function publicText(value) {
  return String(value || "blocked")
    .replace(/(?:ghp|github_pat)_[A-Za-z0-9_]+/gu, "[redacted]")
    .replace(/\/(?:Users|home)(?:\/[^\s"']*)?/gu, "[local-path]")
    .slice(0, 500);
}

async function runAsCommand() {
  try {
    console.log(JSON.stringify(await mainReviewedLaneRevision()));
  } catch (error) {
    console.log(JSON.stringify({
      schema: "agentic-reviewed-lane-revision-result/v1",
      status: "blocked",
      error: publicText(error?.message || error),
    }));
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  await runAsCommand();
}
