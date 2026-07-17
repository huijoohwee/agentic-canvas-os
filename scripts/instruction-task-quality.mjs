#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  evaluateInstructionTaskQuality,
  validateInstructionTaskQualitySuite,
} from "./instruction-task-quality-lib.mjs";

const options = parseArguments(process.argv.slice(2));
const root = path.resolve(options.root ?? process.cwd());
const suitePath = path.resolve(root, options.suite ?? "evals/instruction-task-quality-cases.json");
const suite = await readJson(suitePath);

if (options.validateSuite) {
  const validationErrors = validateInstructionTaskQualitySuite(suite);
  const result = {
    status: validationErrors.length === 0 ? "ready" : "invalid",
    suiteId: suite?.suiteId ?? null,
    cases: Array.isArray(suite?.cases) ? suite.cases.length : 0,
    validationErrors,
    modelInvokedByEvaluator: false,
  };
  printResult(result, options.json, `instruction quality suite ${result.status}: ${result.cases} cases`);
  if (validationErrors.length > 0) process.exitCode = 1;
} else {
  if (!options.candidate) throw new Error("--candidate=<path> is required unless --validate-suite is used");
  const candidate = await readJson(path.resolve(root, options.candidate));
  const report = evaluateInstructionTaskQuality({ suite, candidate });
  printResult(
    report,
    options.json,
    `instruction task quality ${report.status}: ${report.summary.passedCases}/${report.summary.totalCases} cases, score ${report.summary.score}`,
  );
  if (report.status !== "passed") process.exitCode = 1;
}

function parseArguments(args) {
  const result = { json: false, validateSuite: false, root: null, suite: null, candidate: null };
  for (const argument of args) {
    if (argument === "--json") result.json = true;
    else if (argument === "--validate-suite") result.validateSuite = true;
    else if (argument.startsWith("--root=")) result.root = argument.slice("--root=".length);
    else if (argument.startsWith("--suite=")) result.suite = argument.slice("--suite=".length);
    else if (argument.startsWith("--candidate=")) result.candidate = argument.slice("--candidate=".length);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return result;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function printResult(result, json, summary) {
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(summary);
    for (const error of result.validationErrors ?? []) console.error(error);
    for (const testCase of Array.isArray(result.cases) ? result.cases : []) {
      if (testCase.status !== "passed") console.error(`${testCase.id}: ${testCase.status} (${testCase.score})`);
    }
  }
}
