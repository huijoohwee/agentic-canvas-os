import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildLifecycleMonitorObservation,
  LIFECYCLE_MONITOR_OBSERVATION_SCHEMA,
  LIFECYCLE_MONITOR_REQUEST_SCHEMA,
} from "../scripts/lifecycle-monitor-contract.mjs";
import {
  createJsonLifecycleObservationReader,
  readBoundedJson,
} from "../scripts/lifecycle-monitor-json-adapter.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.resolve(repositoryRoot, "scripts/lifecycle-monitor.mjs");
const identityDigest = "c".repeat(64);

function request() {
  return {
    schema: LIFECYCLE_MONITOR_REQUEST_SCHEMA,
    subject: { subjectId: "subject:json", identityDigest },
    target: { state: "complete", minimumGeneration: 4, minimumHeartbeatSequence: 8 },
    schedule: {
      minimumDelayMs: 10,
      maximumDelayMs: 1_000,
      multiplierPermille: 2_000,
      jitterPermille: 0,
      unchangedGrowthThreshold: 1,
      maximumClockSkewMs: 60_000,
    },
    budget: { maximumAttempts: 2, maximumElapsedMs: 5_000, maximumReadUnits: 5 },
  };
}

function observation() {
  return buildLifecycleMonitorObservation({
    schema: LIFECYCLE_MONITOR_OBSERVATION_SCHEMA,
    observedAt: new Date().toISOString(),
    subjectId: "subject:json",
    identityDigest,
    sourceRevision: "opaque-json-revision",
    generation: 4,
    heartbeatSequence: 8,
    state: "complete",
    readUnits: 1,
    retryAfterMs: null,
    error: null,
  });
}

test("the JSON CLI reaches an exact target without writing source or granting authority", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "lifecycle-monitor-cli-"));
  try {
    const requestPath = path.join(directory, "request.json");
    const observationPath = path.join(directory, "observation.json");
    writeFileSync(requestPath, JSON.stringify(request()));
    writeFileSync(observationPath, JSON.stringify(observation()));

    const output = execFileSync(process.execPath, [
      cliPath,
      `--request=${requestPath}`,
      `--observation=${observationPath}`,
    ], { encoding: "utf8" });
    const result = JSON.parse(output);
    assert.equal(result.status, "ready");
    assert.equal(result.classification, "target-observed");
    assert.equal(result.mutationAuthority, false);
    assert.equal(result.resumeSignal.mutationAuthority, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the JSON adapter normalizes repeatable observations and rejects symlink input", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "lifecycle-monitor-adapter-"));
  try {
    const source = path.join(directory, "observation.json");
    const link = path.join(directory, "observation-link.json");
    writeFileSync(source, JSON.stringify(observation()));
    symlinkSync(source, link);
    const reader = createJsonLifecycleObservationReader({ observationPath: source });
    assert.deepEqual(await reader(), await reader());
    assert.throws(() => readBoundedJson(link), /could not read/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("invalid invocation fails closed with a bounded JSON result", () => {
  const result = spawnSync(process.execPath, [cliPath, "--unknown=value"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout);
  assert.equal(output.schema, "agentic-lifecycle-monitor-invocation-error/v1");
  assert.equal(output.status, "blocked");
  assert.equal(output.classification, "invalid-invocation");
  assert.equal(output.mutationAuthority, false);
});
