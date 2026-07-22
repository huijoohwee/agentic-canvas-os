#!/usr/bin/env node

import {
  DEFAULT_REVIEWED_RUNTIME_HOST,
  DEFAULT_REVIEWED_RUNTIME_PORT,
  endReviewedRuntimeTurn,
  readReviewedRuntimeStatus,
  serveReviewedRuntime,
  stopReviewedRuntime,
} from "./reviewed-runtime-lib.mjs";

const [action, ...args] = process.argv.slice(2);
const json = args.includes("--json");

try {
  if (!["start", "handoff", "status", "stop"].includes(action)) usage();
  const options = {
    repository: readOption(args, "repository") || process.env.AGENTIC_TARGET_REPOSITORY || "",
    host: readOption(args, "host") || DEFAULT_REVIEWED_RUNTIME_HOST,
    port: Number(readOption(args, "port") || (action === "handoff" ? 5173 : DEFAULT_REVIEWED_RUNTIME_PORT)),
    timeoutMs: Number(readOption(args, "timeout-ms") || 90_000),
    allowCanonicalPort: action === "handoff" || args.includes("--allow-canonical-port"),
  };
  const result = action === "start"
    ? await serveReviewedRuntime(options)
    : action === "handoff"
      ? await endReviewedRuntimeTurn(options)
    : action === "status"
      ? await readReviewedRuntimeStatus(options)
      : await stopReviewedRuntime(options);
  if (json) console.log(JSON.stringify(result));
  else printHuman(result);
  if ((action === "status" || action === "handoff") && !result.ready) process.exitCode = 1;
} catch (error) {
  const result = {
    schema: "agentic-reviewed-runtime/v1",
    status: "error",
    ready: false,
    error: { code: "reviewed_runtime_failed", message: error instanceof Error ? error.message : String(error) },
  };
  if (json) console.log(JSON.stringify(result));
  else console.error(result.error.message);
  process.exitCode = 1;
}

function readOption(values, name) {
  const prefix = `--${name}=`;
  const match = values.find(value => value.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : "";
}

function printHuman(result) {
  if (result.ready) {
    console.log(`Reviewed runtime ready at ${result.url}`);
    console.log(`Knowgrph ${result.reviewHeadSha} from ${result.branch}`);
    console.log(`Agentic Canvas OS ${result.agenticCanvasOsRevision}`);
    console.log(`PID ${result.listenerPid}; log ${result.logPath}`);
    return;
  }
  console.log(`Reviewed runtime ${result.status} on port ${result.port}.`);
  if (result.reason) console.log(result.reason);
}

function usage() {
  console.error("Usage: node scripts/reviewed-runtime.mjs <start|handoff|status|stop> --repository=<review-ready-worktree> [--port=5176] [--timeout-ms=90000] [--allow-canonical-port] [--json]");
  process.exit(2);
}
