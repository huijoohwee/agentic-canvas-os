#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ADMISSION_ENFORCED_STAGES,
  ADMISSION_UNEVALUATED_STAGES,
  evaluateAdmissionEvidence,
} from "./agentic-sdlc/admission-evaluator.mjs";
import {
  resolveLifecycleConformanceIdentities,
} from "./lifecycle-conformance-identity.mjs";

const scriptPath = fileURLToPath(import.meta.url);
export const LIFECYCLE_CONFORMANCE_ENFORCED_STAGES =
  ADMISSION_ENFORCED_STAGES;
export const LIFECYCLE_CONFORMANCE_UNEVALUATED_STAGES =
  ADMISSION_UNEVALUATED_STAGES;

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
  const resolveIdentities = dependencies.resolveIdentities ??
    (() => resolveLifecycleConformanceIdentities());
  const evaluate = dependencies.evaluate ?? evaluateAdmissionEvidence;
  const write = dependencies.write ??
    ((value) => process.stdout.write(value));
  const locator = path.resolve(currentDirectory, options.evidencePath);
  const operation = JSON.parse(await readText(locator));
  const identities = await resolveIdentities();
  const receipt = await evaluate(operation, identities);
  write(`${JSON.stringify(receipt, null, options.pretty ? 2 : 0)}\n`);
  return Object.freeze({
    exitCode: receipt.ready ? 0 : 1,
    locator,
    receipt,
  });
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
      : LIFECYCLE_CONFORMANCE_ENFORCED_STAGES,
    unevaluatedStages: Array.isArray(error?.unevaluatedStages)
      ? error.unevaluatedStages
      : LIFECYCLE_CONFORMANCE_UNEVALUATED_STAGES,
  });
}

export function lifecycleConformanceFailureExitCode(error) {
  return [
    "AGENTIC_SDLC_POLICY_IDENTITY_UNAVAILABLE",
    "AGENTIC_SDLC_EVALUATOR_IDENTITY_UNAVAILABLE",
    "AGENTIC_SDLC_SCHEMA_IDENTITY_UNAVAILABLE",
    "AGENTIC_SDLC_SOURCE_IDENTITY_UNAVAILABLE",
    "AGENTIC_SDLC_DEPENDENCY_IDENTITY_UNAVAILABLE",
  ].includes(error?.code)
    ? 3
    : 2;
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
    process.exitCode = lifecycleConformanceFailureExitCode(error);
  }
}
