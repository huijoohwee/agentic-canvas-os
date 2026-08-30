#!/usr/bin/env node
// Responsibility: Run current-base reanchoring through GitHub's cooperative body-projection port.
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runActiveOwnedDirtCurrentBaseReanchorCli }
  from "./active-owned-dirt-current-base-reanchor.mjs";
import { createGitHubCooperativePullBodyProjectionPort }
  from "./github-cooperative-pull-body-projection.mjs";

const COMMAND_SCHEMA =
  "agentic-active-owned-dirt-current-base-reanchor-github-command/v1";

export async function runActiveOwnedDirtCurrentBaseReanchorGitHubCli(
  argumentsList = process.argv.slice(2),
  dependencies = {},
) {
  const runReanchorCli = dependencies.runReanchorCli
    || runActiveOwnedDirtCurrentBaseReanchorCli;
  const reanchorDependencies = { ...(dependencies.reanchorDependencies || {}) };
  if (reanchorDependencies.createConditionalPullBodyPort) {
    throw new Error("GitHub reanchor wrapper owns the cooperative pull-body port.");
  }
  reanchorDependencies.createConditionalPullBodyPort =
    dependencies.createPullBodyPort
    || createGitHubCooperativePullBodyProjectionPort;
  return runReanchorCli(argumentsList, reanchorDependencies);
}

if (process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runActiveOwnedDirtCurrentBaseReanchorGitHubCli();
    process.stdout.write(`${JSON.stringify(
      result,
      null,
      process.argv.includes("--json") ? 2 : 0,
    )}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      schema: COMMAND_SCHEMA,
      ok: false,
      status: "blocked",
      error: String(error?.message || error).slice(0, 1_000),
    })}\n`);
    process.exitCode = 1;
  }
}
