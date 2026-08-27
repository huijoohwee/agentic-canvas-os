#!/usr/bin/env node

import { realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createReviewedForwardChildController } from "./reviewed-forward-child-recovery-controller.mjs";
import {
  createReviewedForwardChildRepositoryAdapter,
} from "./reviewed-forward-child-recovery-repository-adapter.mjs";

export async function runReviewedForwardChildRecovery({
  mode,
  repository,
  sourceSessionId,
  pullRequestNumber,
  operatorSessionId,
  taskAuthorityFile = null,
  authorization = null,
  ttlSeconds = 3_600,
} = {}) {
  if (!["plan", "run"].includes(mode)) {
    throw new Error("Reviewed forward-child recovery mode must be plan or run.");
  }
  const adapter = createReviewedForwardChildRepositoryAdapter({
    repository,
    sourceSessionId,
    pullRequestNumber,
    operatorSessionId,
    taskAuthorityFile,
    ttlSeconds,
  });
  const controller = createReviewedForwardChildController({ adapter });
  return mode === "plan"
    ? controller.plan({ operatorSessionId })
    : controller.run({ operatorSessionId, authorization });
}

async function main() {
  const values = parseArguments(process.argv.slice(2));
  const result = await runReviewedForwardChildRecovery(values);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function parseArguments(argumentsList) {
  const mode = argumentsList.shift();
  const options = Object.fromEntries(argumentsList.map(argument => {
    const match = argument.match(/^--([^=]+)=(.*)$/u);
    if (!match) throw new Error(`Invalid recovery argument: ${argument}`);
    return [match[1], match[2]];
  }));
  const repository = realpathSync(path.resolve(required(options.repository, "repository")));
  const pullRequestNumber = Number(required(options["pull-request"], "pull-request"));
  const ttlSeconds = Number(options.ttl || 3_600);
  if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber < 1) {
    throw new Error("pull-request must be a positive integer.");
  }
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 300 || ttlSeconds > 86_400) {
    throw new Error("ttl must be an integer from 300 through 86400.");
  }
  return {
    mode,
    repository,
    sourceSessionId: required(options["source-session"], "source-session"),
    pullRequestNumber,
    operatorSessionId: required(options["operator-session"], "operator-session"),
    taskAuthorityFile: mode === "run"
      ? realpathSync(path.resolve(required(options["task-authority"], "task-authority")))
      : null,
    authorization: options.authorize || null,
    ttlSeconds,
  };
}

function required(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    throw new Error(`${label} is required and whitespace-exact.`);
  }
  return value;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
