#!/usr/bin/env node

import {
  LOCAL_RUNTIME_SCHEMA,
  endLocalRuntimeTurn,
  ensureLocalRuntime,
  readLocalRuntimeStatus,
  readSessionRuntimeStatus,
  startSessionRuntime,
  stopSessionRuntime,
  stopLocalRuntime,
} from "./local-runtime-lib.mjs";

const [action, ...args] = process.argv.slice(2);
const json = args.includes("--json");

try {
  if (!["ensure", "status", "stop", "turn-end", "session-start", "session-status", "session-stop"].includes(action)) usage();
  const options = {
    repository: readOption(args, "repository"),
    agenticCanvasOsRoot: readOption(args, "agentic-canvas-os-root") || process.cwd(),
    timeoutMs: Number(readOption(args, "timeout-ms") || 120_000),
    sessionId: readOption(args, "session") || process.env.AGENTIC_SESSION_ID || "",
  };
  const result = action === "ensure"
    ? await ensureLocalRuntime(options)
    : action === "status"
      ? await readLocalRuntimeStatus(options)
      : action === "stop"
        ? await stopLocalRuntime(options)
        : action === "turn-end"
          ? await endLocalRuntimeTurn(options)
          : action === "session-start"
            ? await startSessionRuntime(options)
            : action === "session-status"
              ? await readSessionRuntimeStatus(options)
              : await stopSessionRuntime(options);
  if (json) console.log(JSON.stringify(result));
  else printHuman(result);
  if ((action === "status" || action === "turn-end") && !result.ready) process.exitCode = 1;
  if (action === "session-status" && result.status !== "session-dev") process.exitCode = 1;
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
  if (result.status === "session-dev") {
    console.log(`Knowgrph session-owned Vite is available at http://${result.host}:${result.ports.apex}/.`);
    return;
  }
  if (result.status === "session-stopped") {
    console.log("Knowgrph session-owned Vite is stopped.");
    return;
  }
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
  console.error("Usage: node scripts/local-runtime.mjs <ensure|status|stop|turn-end|session-start|session-status|session-stop> [--repository=<canonical-knowgrph-root>] [--session=<stable-session-id>] [--timeout-ms=120000] [--json]");
  process.exit(2);
}
