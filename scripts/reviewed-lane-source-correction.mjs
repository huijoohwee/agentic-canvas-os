#!/usr/bin/env node
// Responsibility: Expose read-only planning and exact-authority execution for source correction.
import { pathToFileURL } from "node:url";

import {
  createReviewedLaneSourceCorrectionController,
} from "./reviewed-lane-source-correction-controller.mjs";
import {
  createReviewedLaneSourceCorrectionRepositoryAdapter,
} from "./reviewed-lane-source-correction-repository-adapter.mjs";

const OPTIONS = new Set([
  "authorize", "operator-session", "pull-request", "repository", "source-session", "ttl-seconds",
]);

export async function main(argumentsList = process.argv.slice(2), dependencies = {}) {
  const [command, ...tail] = argumentsList;
  if (!new Set(["plan", "run"]).has(command)) throw new Error(usage());
  const options = parseOptions(tail);
  const operatorSessionId = required(options, "operator-session");
  const adapter = (dependencies.createAdapter
    || createReviewedLaneSourceCorrectionRepositoryAdapter)({
    repository: required(options, "repository"),
    sourceSessionId: required(options, "source-session"),
    pullRequestNumber: positiveInteger(required(options, "pull-request"), "pull request"),
    ttlSeconds: options.has("ttl-seconds")
      ? positiveInteger(options.get("ttl-seconds"), "TTL") : 3_600,
  }, dependencies.adapterDependencies || {});
  const controller = (dependencies.createController
    || createReviewedLaneSourceCorrectionController)({ adapter });
  if (command === "plan") {
    if (options.has("authorize")) throw new Error("plan does not accept --authorize.");
    return controller.plan({ operatorSessionId });
  }
  return controller.run({
    operatorSessionId,
    authorization: required(options, "authorize"),
  });
}

export async function runCli(argumentsList = process.argv.slice(2)) {
  try {
    console.log(JSON.stringify(await main(argumentsList)));
    return 0;
  } catch (error) {
    console.log(JSON.stringify({
      schema: "agentic-reviewed-lane-source-correction-result/v1",
      status: "blocked",
      error: publicMessage(error),
    }));
    return 1;
  }
}

function parseOptions(argumentsList) {
  const values = new Map();
  for (const argument of argumentsList) {
    const match = argument.match(/^--([a-z0-9-]+)=(.*)$/u);
    if (!match || !OPTIONS.has(match[1])) throw new Error(`Unsupported option: ${argument}`);
    if (values.has(match[1])) throw new Error(`--${match[1]} must be provided once.`);
    if (!match[2]) throw new Error(`--${match[1]} requires a value.`);
    values.set(match[1], match[2]);
  }
  return values;
}
function required(options, name) {
  const value = options.get(name);
  if (!value) throw new Error(`--${name}=<value> is required.`);
  return value;
}
function positiveInteger(value, label) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label} must be positive.`);
  return result;
}
function publicMessage(error) {
  return String(error?.message || error || "blocked")
    .replace(/(?:ghp|github_pat)_[A-Za-z0-9_]+/gu, "[redacted]")
    .replaceAll(process.env.HOME || "\0", "[home]")
    .slice(0, 1_000);
}
function usage() {
  return "Usage: reviewed-lane-source-correction.mjs plan|run "
    + "--repository=<registered-worktree> --source-session=<id> "
    + "--operator-session=<id> --pull-request=<number> "
    + "[--ttl-seconds=3600] [--authorize=<exact statement>]";
}

const isEntrypoint = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isEntrypoint) process.exitCode = await runCli();
