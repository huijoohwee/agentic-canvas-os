#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { repoRoot } from "agentic-os/src/git.mjs";

import { cleanupIntegratedLane } from "./worktree-lifecycle.mjs";

const SUPPORTED_COMMAND = "complete";

export function completeDeviceLane({ repository } = {}) {
  const target = repoRoot(path.resolve(repository || process.cwd()));
  const cleanup = cleanupIntegratedLane({ repository: target, target });
  return {
    schema: "agentic-os-device-completion/v1",
    status: "ok",
    completedBranch: cleanup.branch,
    mainSha: cleanup.canonicalSha,
    integrationProof: cleanup.proof,
    cleanup,
  };
}

function readOption(args, name) {
  const prefix = `--${name}=`;
  return args.find(value => value.startsWith(prefix))?.slice(prefix.length).trim() || "";
}

function usage() {
  return "Usage: node scripts/device-branch.mjs complete [--repository=<lane-worktree>] [--json]";
}

function main(args = process.argv.slice(2)) {
  const [command, ...options] = args;
  const json = options.includes("--json");
  if (command !== SUPPORTED_COMMAND) {
    const received = command || "<missing>";
    throw new Error(
      `Unsupported legacy device command ${received}. ADLC preserves only device:complete. ${usage()}`,
    );
  }
  const result = completeDeviceLane({
    repository: readOption(options, "repository") || process.cwd(),
  });
  if (json) {
    console.log(JSON.stringify(result));
  } else {
    console.log(
      `ADLC retired ${result.completedBranch} after ${result.integrationProof.kind} `
        + `integration proof at ${result.mainSha.slice(0, 12)}.`,
    );
  }
  return 0;
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`device-branch: ${error.message}`);
    process.exitCode = 1;
  }
}
