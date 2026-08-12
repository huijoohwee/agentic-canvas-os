// Responsibility: Read bounded provider-neutral lifecycle observations from local JSON artifacts.
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import path from "node:path";

import {
  normalizeLifecycleMonitorCheckpoint,
  normalizeLifecycleMonitorObservation,
  normalizeLifecycleMonitorRequest,
} from "./lifecycle-monitor-contract.mjs";

export const LIFECYCLE_MONITOR_JSON_MAXIMUM_BYTES = 256 * 1024;

export function createJsonLifecycleObservationReader({
  observationPath,
  maximumBytes = LIFECYCLE_MONITOR_JSON_MAXIMUM_BYTES,
  readJson = readBoundedJson,
} = {}) {
  const source = absolutePath(observationPath, "observation path");
  boundedBytes(maximumBytes);
  if (typeof readJson !== "function") {
    throw new Error("Lifecycle monitor JSON readJson must be a function.");
  }
  return async function readObservation() {
    return normalizeLifecycleMonitorObservation(readJson(source, { maximumBytes }));
  };
}

export function readLifecycleMonitorRequest(requestPath, options = {}) {
  return normalizeLifecycleMonitorRequest(readBoundedJson(
    absolutePath(requestPath, "request path"),
    options,
  ));
}

export function readLifecycleMonitorCheckpoint(checkpointPath, { request, ...options } = {}) {
  return normalizeLifecycleMonitorCheckpoint(readBoundedJson(
    absolutePath(checkpointPath, "checkpoint path"),
    options,
  ), { request });
}

export function readBoundedJson(filePath, {
  maximumBytes = LIFECYCLE_MONITOR_JSON_MAXIMUM_BYTES,
} = {}) {
  const source = absolutePath(filePath, "JSON path");
  boundedBytes(maximumBytes);
  let descriptor;
  try {
    descriptor = openSync(source, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile()) throw new Error("source must be one regular file");
    if (metadata.size > maximumBytes) {
      throw new Error(`source exceeds ${maximumBytes} bytes`);
    }
    const bytes = readFileSync(descriptor);
    if (bytes.length > maximumBytes) throw new Error(`source exceeds ${maximumBytes} bytes`);
    const parsed = JSON.parse(bytes.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("source must contain one JSON object");
    }
    return parsed;
  } catch (error) {
    throw new Error(`Lifecycle monitor could not read ${source}: ${publicMessage(error)}`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function absolutePath(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Lifecycle monitor ${label} is required.`);
  }
  return path.resolve(value);
}

function boundedBytes(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1024 * 1024) {
    throw new Error("Lifecycle monitor JSON maximumBytes must be between 1 and 1048576.");
  }
  return value;
}

function publicMessage(error) {
  return String(error?.message || error || "invalid JSON").slice(0, 1_000);
}
