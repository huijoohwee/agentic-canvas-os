#!/usr/bin/env node

import {
  LOCAL_RUNTIME_SCHEMA,
  endLocalRuntimeTurn,
  ensureLocalRuntime,
  readLocalRuntimeStatus,
  stopLocalRuntime,
} from "./local-runtime-lib.mjs";

const [action, ...args] = process.argv.slice(2);
const json = args.includes("--json");

try {
  if (!["ensure", "status", "stop", "turn-end"].includes(action)) usage();
  const options = {
    repository: readOption(args, "repository"),
    agenticCanvasOsRoot: readOption(args, "agentic-canvas-os-root") || process.cwd(),
    timeoutMs: Number(readOption(args, "timeout-ms") || 120_000),
  };
  const result = action === "ensure"
    ? await ensureLocalRuntime(options)
    : action === "status"
      ? await readLocalRuntimeStatus(options)
      : action === "stop"
        ? await stopLocalRuntime(options)
        : await endLocalRuntimeTurn(options);
  if (json) console.log(JSON.stringify(result));
  else printHuman(result);
  if ((action === "status" || action === "turn-end") && !result.ready) process.exitCode = 1;
} catch (error) {
  const result = {
    schema: LOCAL_RUNTIME_SCHEMA,
    status: "error",
    ready: false,
    error: { code: "local_runtime_failed", message: error instanceof Error ? error.message : String(error) },
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
  if (!result.ready) {
    console.log(`Knowgrph local runtime ${result.status}.`);
    if (result.reason) console.log(result.reason);
    return;
  }
  console.log(`Knowgrph Home Apex runtime-ready at http://${result.host}:${result.ports.apex}/`);
  console.log(`Knowgrph ${result.source.revision}`);
  console.log(`Agentic Canvas OS and catalog ${result.agenticCanvasOs.revision}`);
  console.log(`Storage proxy HTTP ${result.probes.storageProxy}`);
}

function usage() {
  console.error("Usage: node scripts/local-runtime.mjs <ensure|status|stop|turn-end> [--repository=<canonical-knowgrph-root>] [--timeout-ms=120000] [--json]");
  process.exit(2);
}
