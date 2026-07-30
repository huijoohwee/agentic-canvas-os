#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  LIFECYCLE_STAGES,
} from "./lifecycle-conformance-gate.mjs";
import {
  lifecyclePolicyIdentity,
} from "./lifecycle-conformance-policy.mjs";

const scriptPath = fileURLToPath(import.meta.url);
export const LIFECYCLE_CONFORMANCE_ENFORCED_STAGES = Object.freeze([]);
export const LIFECYCLE_CONFORMANCE_UNEVALUATED_STAGES =
  Object.freeze([...LIFECYCLE_STAGES]);

export function parseLifecycleConformanceArguments(values = []) {
  let evidencePath = "";
  let pretty = false;
  for (let index = 0; index < values.length; index += 1) {
    const value = String(values[index]);
    if (value === "--evidence") {
      evidencePath = requireValue(values[index + 1], "--evidence");
      index += 1;
    } else if (value.startsWith("--evidence=")) {
      evidencePath = requireValue(value.slice("--evidence=".length), "--evidence");
    } else if (value === "--pretty") {
      pretty = true;
    } else {
      throw new Error(`unsupported argument: ${value}`);
    }
  }
  if (!evidencePath) throw new Error("--evidence is required");
  return Object.freeze({ evidencePath, pretty });
}

export async function runLifecycleConformance(
  values = process.argv.slice(2),
  dependencies = {},
) {
  const options = parseLifecycleConformanceArguments(values);
  const currentDirectory = path.resolve(
    dependencies.currentDirectory ?? process.cwd(),
  );
  const readText = dependencies.readText ??
    ((locator) => readFile(locator, "utf8"));
  const locator = path.resolve(currentDirectory, options.evidencePath);
  const operation = JSON.parse(await readText(locator));
  assertPinnedPolicy(operation?.policy);
  throw createEvidenceAdapterUnavailableError(locator);
}

function assertPinnedPolicy(actual) {
  const expected = lifecyclePolicyIdentity();
  for (const field of Object.keys(expected)) {
    if (actual?.[field] !== expected[field]) {
      const error = new Error(
        `Lifecycle policy ${field} does not match the pinned repository-owned policy.`,
      );
      error.code = "AGENTIC_SDLC_POLICY_IDENTITY_UNAVAILABLE";
      throw error;
    }
  }
}

export function createEvidenceAdapterUnavailableError(locator = "") {
  const error = new Error(
    "Operation-derived lifecycle evidence adapters, evaluator identity, and schema closure are unavailable; the repository currently proves policy-runtime readiness only.",
  );
  error.code = "AGENTIC_SDLC_EVIDENCE_ADAPTER_UNAVAILABLE";
  error.locator = String(locator);
  error.enforcedStages = LIFECYCLE_CONFORMANCE_ENFORCED_STAGES;
  error.unevaluatedStages = LIFECYCLE_CONFORMANCE_UNEVALUATED_STAGES;
  return error;
}

export function formatLifecycleConformanceFailure(error) {
  return JSON.stringify({
    schema: "agentic-sdlc-conformance-error/v1",
    status: "error",
    code: String(error?.code || "AGENTIC_SDLC_EVALUATOR_FAILURE"),
    message: typeof error?.message === "string"
      ? error.message
      : String(error),
    enforcedStages: Array.isArray(error?.enforcedStages)
      ? error.enforcedStages
      : [],
    unevaluatedStages: Array.isArray(error?.unevaluatedStages)
      ? error.unevaluatedStages
      : [],
  });
}

function requireValue(value, option) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${option} requires a value`);
  return normalized;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    const outcome = await runLifecycleConformance();
    process.exitCode = outcome.exitCode;
  } catch (error) {
    process.stderr.write(`${formatLifecycleConformanceFailure(error)}\n`);
    process.exitCode =
      [
        "AGENTIC_SDLC_POLICY_IDENTITY_UNAVAILABLE",
        "AGENTIC_SDLC_EVIDENCE_ADAPTER_UNAVAILABLE",
      ].includes(error?.code)
        ? 3
        : 2;
  }
}
