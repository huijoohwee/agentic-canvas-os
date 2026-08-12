#!/usr/bin/env node
// Responsibility: Expose the provider-neutral read-only lifecycle monitor through JSON files.
import { pathToFileURL } from "node:url";

import { monitorLifecycle } from "./lifecycle-monitor-controller.mjs";
import {
  createJsonLifecycleObservationReader,
  readLifecycleMonitorCheckpoint,
  readLifecycleMonitorRequest,
} from "./lifecycle-monitor-json-adapter.mjs";

const OPTIONS = new Set(["request", "observation", "checkpoint"]);

export async function main(argumentsList = process.argv.slice(2), {
  monitor = monitorLifecycle,
  createReader = createJsonLifecycleObservationReader,
} = {}) {
  const options = parseOptions(argumentsList);
  const request = readLifecycleMonitorRequest(required(options, "request"));
  const checkpoint = options.has("checkpoint")
    ? readLifecycleMonitorCheckpoint(options.get("checkpoint"), { request }) : null;
  const abortController = new AbortController();
  const stop = () => abortController.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    return await monitor({
      request,
      checkpoint,
      readObservation: createReader({ observationPath: required(options, "observation") }),
      signal: abortController.signal,
    });
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

export async function runCli(argumentsList = process.argv.slice(2)) {
  try {
    process.stdout.write(`${JSON.stringify(await main(argumentsList))}\n`);
    return 0;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      schema: "agentic-lifecycle-monitor-invocation-error/v1",
      status: "blocked",
      classification: "invalid-invocation",
      mutationAuthority: false,
      error: publicMessage(error),
    })}\n`);
    return 1;
  }
}

function parseOptions(argumentsList) {
  const options = new Map();
  for (const argument of argumentsList) {
    const match = argument.match(/^--([a-z0-9-]+)=(.*)$/u);
    if (!match || !OPTIONS.has(match[1])) throw new Error(`Unsupported option: ${argument}`);
    if (!match[2] || options.has(match[1])) {
      throw new Error(`--${match[1]} must be provided exactly once with a value.`);
    }
    options.set(match[1], match[2]);
  }
  return options;
}

function required(options, name) {
  const value = options.get(name);
  if (!value) throw new Error(`--${name}=<path> is required.`);
  return value;
}

function publicMessage(error) {
  return String(error?.message || error || "blocked")
    .replace(/\b(token|secret|password)=\S+/giu, "$1=[redacted]").slice(0, 1_000);
}

const isEntrypoint = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isEntrypoint) process.exitCode = await runCli();
