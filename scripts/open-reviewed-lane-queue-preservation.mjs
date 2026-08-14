#!/usr/bin/env node
// Responsibility: Expose plan and authorized run modes for queue-preserving reviewed-lane rehydration.
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { sanitizeCloudAuthorityDiagnostic } from "./cloud-authority-scope-expansion-lineage-contract.mjs";
import { createOpenReviewedLaneQueuePreservationController } from "./open-reviewed-lane-queue-preservation-controller.mjs";
import { createRepositoryOpenReviewedLaneQueuePreservationAdapter } from "./open-reviewed-lane-queue-preservation-repository-adapter.mjs";

export function runOpenReviewedLaneQueuePreservation({ mode, repository, targetPath,
  pullRequestNumber, plan = null, authorization = null } = {}, dependencies = {}) {
  const createAdapter = dependencies.createAdapter
    || createRepositoryOpenReviewedLaneQueuePreservationAdapter;
  const createController = dependencies.createController
    || createOpenReviewedLaneQueuePreservationController;
  const controller = createController({
    adapter: createAdapter({ repository, targetPath, pullRequestNumber }, dependencies.adapterDependencies),
  });
  if (mode === "plan") return controller.plan();
  if (mode === "run") return controller.run({ plan, authorization });
  throw new Error("Open reviewed lane queue preservation mode must be plan or run.");
}

export function parseOpenReviewedLaneQueuePreservationArguments(argumentsList) {
  const [mode, ...rawArguments] = argumentsList;
  const entries = rawArguments.map(argument => {
    const match = argument.match(/^--([^=]+)=(.*)$/u);
    if (!match) throw new Error(`Invalid queue-preservation argument: ${argument}`);
    return [match[1], match[2]];
  });
  const options = Object.fromEntries(entries);
  const allowed = new Set(["repository", "worktree", "pull-request",
    ...(mode === "run" ? ["plan-file", "authorize"] : [])]);
  if (!["plan", "run"].includes(mode) || entries.length !== Object.keys(options).length
    || Object.keys(options).some(key => !allowed.has(key))) {
    throw new Error("Queue-preservation arguments are invalid or duplicated.");
  }
  const repository = realpathSync(path.resolve(required(options.repository, "repository")));
  const targetPath = path.resolve(required(options.worktree, "worktree"));
  const pullRequestNumber = Number(required(options["pull-request"], "pull-request"));
  if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber < 1) {
    throw new Error("pull-request must be a positive integer.");
  }
  const plan = mode === "run"
    ? JSON.parse(readFileSync(path.resolve(required(options["plan-file"], "plan-file")), "utf8"))
    : null;
  return { mode, repository, targetPath, pullRequestNumber, plan,
    authorization: options.authorize || null };
}

function required(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value;
}

async function main() {
  try {
    const input = parseOpenReviewedLaneQueuePreservationArguments(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(runOpenReviewedLaneQueuePreservation(input), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${sanitizeCloudAuthorityDiagnostic(error)}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
