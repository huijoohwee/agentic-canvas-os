#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateExecutionRun } from "./agentic-sdlc/index.mjs";

const scriptPath = fileURLToPath(import.meta.url);

export function parseArguments(argumentsList = []) {
  let runPath = "";
  let pretty = false;
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = String(argumentsList[index]);
    if (argument === "--run") {
      runPath = requiredValue(argumentsList[index + 1], "--run");
      index += 1;
    } else if (argument.startsWith("--run=")) {
      runPath = requiredValue(argument.slice("--run=".length), "--run");
    } else if (argument === "--pretty") {
      pretty = true;
    } else {
      throw new Error(`unsupported argument: ${argument}`);
    }
  }
  if (!runPath) throw new Error("--run is required");
  return Object.freeze({ pretty, runPath });
}

export async function main(argumentsList = process.argv.slice(2), dependencies = {}) {
  const options = parseArguments(argumentsList);
  const currentDirectory = path.resolve(
    dependencies.currentDirectory ?? process.cwd(),
  );
  const readText = dependencies.readText ?? ((locator) => readFile(locator, "utf8"));
  const evaluate = dependencies.validateRun ?? validateExecutionRun;
  const writeOutput =
    dependencies.writeOutput ?? ((value) => process.stdout.write(`${value}\n`));
  const locator = path.resolve(currentDirectory, options.runPath);
  const artifact = JSON.parse(await readText(locator));
  const result = evaluate(artifact);
  writeOutput(JSON.stringify(result, null, options.pretty ? 2 : 0));
  return Object.freeze({
    exitCode: result?.runtimeReady === true ? 0 : 1,
    locator,
    result,
  });
}

function requiredValue(value, flag) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${flag} requires a value`);
  return normalized;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    const outcome = await main();
    process.exitCode = outcome.exitCode;
  } catch (error) {
    process.stderr.write(
      `[agentic-sdlc] ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 2;
  }
}
