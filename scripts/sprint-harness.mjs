#!/usr/bin/env node
// Responsibility: Expose the deterministic, effect-free sprint harness contract.
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  canonicalStringify,
  demoPlan,
  planSprint,
} from "./sprint-harness-contract.mjs";

export const SPRINT_HARNESS_ERROR_SCHEMA = "agentic-sprint-harness-error/v1";

export function runSprintHarness(argumentsList, { readFile = readFileSync, readStdin = readFileSync } = {}) {
  if (!Array.isArray(argumentsList)) throw new Error("Sprint harness arguments must be an array.");
  const [command, ...operands] = argumentsList;
  if (command === "demo" && operands.length === 0) return planSprint(demoPlan());
  if (command === "plan" && operands.length === 1) {
    const input = operands[0] === "-"
      ? readStdin(0, "utf8")
      : readFile(path.resolve(operands[0]), "utf8");
    return planSprint(parseJson(input));
  }
  throw new Error("Usage: sprint-harness.mjs demo | plan <file|->");
}

export function sprintHarnessError(error) {
  return Object.freeze({
    schema: SPRINT_HARNESS_ERROR_SCHEMA,
    ok: false,
    mutation: false,
    error: { message: String(error?.message || error).slice(0, 500) },
  });
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("Sprint harness input must be valid JSON.");
  }
}

function isEntrypoint() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

if (isEntrypoint()) {
  try {
    process.stdout.write(`${canonicalStringify(runSprintHarness(process.argv.slice(2)))}\n`);
  } catch (error) {
    process.stderr.write(`${canonicalStringify(sprintHarnessError(error))}\n`);
    process.exitCode = 1;
  }
}
