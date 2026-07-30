#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  evaluateLifecycleStage,
} from "./lifecycle-conformance-gate.mjs";
import {
  lifecyclePolicyIdentity,
} from "./lifecycle-conformance-policy.mjs";

const scriptPath = fileURLToPath(import.meta.url);

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
  const evaluate = dependencies.evaluate ?? evaluateLifecycleStage;
  const write = dependencies.write ??
    ((value) => process.stdout.write(`${value}\n`));
  const locator = path.resolve(currentDirectory, options.evidencePath);
  const operation = JSON.parse(await readText(locator));
  assertPinnedPolicy(operation?.policy);
  const receipt = evaluate(operation);
  write(JSON.stringify(receipt, null, options.pretty ? 2 : 0));
  return Object.freeze({
    exitCode: receipt.ready ? 0 : 1,
    locator,
    receipt,
  });
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
    process.stderr.write(
      `[lifecycle-conformance] ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode =
      error?.code === "AGENTIC_SDLC_POLICY_IDENTITY_UNAVAILABLE" ? 3 : 2;
  }
}
