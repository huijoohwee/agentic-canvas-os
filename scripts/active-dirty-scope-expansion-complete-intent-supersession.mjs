#!/usr/bin/env node
// Responsibility: Expose read-only planning and exact-authorized completed-intent supersession.
import { readFileSync } from "node:fs";

import {
  createActiveDirtyScopeExpansionCompleteIntentSupersessionRepositoryController,
} from "./active-dirty-scope-expansion-complete-intent-supersession-repository-adapter.mjs";
import { normalizeDeclaredWriteScopeManifest }
  from "./scoped-lane-admission-lib.mjs";

const [command = "plan", ...argumentsList] = process.argv.slice(2);
const options = parseOptions(argumentsList);

try {
  if (!["plan", "run"].includes(command)) usage();
  const targetManifest = normalizeDeclaredWriteScopeManifest(JSON.parse(
    readFileSync(required(options.targetManifest, "--target-manifest"), "utf8"),
  ));
  const controller =
    createActiveDirtyScopeExpansionCompleteIntentSupersessionRepositoryController({
      sourceRepository: required(options.sourceRepository, "--source-repository"),
      sessionId: required(options.session, "--session"),
      pullRequestNumber: positive(options.pullRequest, "--pull-request"),
      targetManifest,
      taskAuthorityFile: options.taskAuthority || null,
    });
  const result = command === "plan"
    ? await controller.plan()
    : await controller.run({ authorization: options.authorization });
  process.stdout.write(`${JSON.stringify(result, null, options.json ? 2 : 0)}\n`);
} catch (error) {
  const result = {
    schema: "agentic-active-dirty-scope-expansion-complete-intent-supersession-cli-result/v1",
    status: "blocked",
    error: String(error?.message || error),
  };
  if (!options.json) throw error;
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = 1;
}

function parseOptions(values) {
  const parsed = {};
  for (const value of values) {
    if (value === "--json") {
      parsed.json = true;
      continue;
    }
    const match = /^--([a-z-]+)=(.*)$/u.exec(value);
    if (!match) usage();
    parsed[match[1].replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = match[2];
  }
  return parsed;
}

function required(value, option) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${option}=... is required.`);
  }
  return value.trim();
}

function positive(value, option) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error(`${option}=... must be a positive integer.`);
  }
  return number;
}

function usage() {
  throw new Error(
    "Usage: active-dirty-scope-expansion-complete-intent-supersession.mjs "
    + "<plan|run> --source-repository=<worktree> --session=<id> "
    + "--pull-request=<number> --target-manifest=<path> "
    + "[--task-authority=<path> --authorization=<exact text>] [--json]",
  );
}
