#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runAudit } from "./alignment-audit/alignment-auditor.mjs";
import { resolveAuditConfig } from "./alignment-audit/config.mjs";
import { ALIGNMENT_AUDIT_INVOCATION_SURFACE } from "./alignment-audit/invocation-surface.mjs";
import {
  createInMemoryWriteSink,
  createWriteSink,
} from "./alignment-audit/output-boundary.mjs";
import { createNodeSourceReader } from "./alignment-audit/source-reader.mjs";

const scriptPath = fileURLToPath(import.meta.url);

export function parseArguments(argumentsList = []) {
  const positional = [];
  let mode = null;

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = String(argumentsList[index]);
    if (argument === "--mode") {
      if (mode !== null) throw new Error("--mode may be supplied only once");
      mode = argumentsList[index + 1];
      index += 1;
    } else if (argument.startsWith("--mode=")) {
      if (mode !== null) throw new Error("--mode may be supplied only once");
      mode = argument.slice("--mode=".length);
    } else if (argument.startsWith("-")) {
      throw new Error(`unsupported argument: ${argument}`);
    } else {
      positional.push(argument);
    }
  }

  if (positional.length !== 1) {
    throw new Error("usage: alignment-audit <config.json> --mode <run|verify>");
  }
  if (mode !== "run" && mode !== "verify") {
    throw new Error("--mode must be run or verify");
  }
  return Object.freeze({ configPath: positional[0], mode });
}

export async function main(argumentsList = process.argv.slice(2), dependencies = {}) {
  const options = parseArguments(argumentsList);
  const currentDirectory = dependencies.currentDirectory ?? process.cwd();
  const environment = dependencies.environment ?? process.env;
  const readText = dependencies.readText ?? ((file) => readFile(file, "utf8"));
  const resolveConfig = dependencies.resolveConfig ?? resolveAuditConfig;
  const createReader = dependencies.createReader ?? createNodeSourceReader;
  const createRunSink = dependencies.createRunSink ?? createWriteSink;
  const createVerifySink =
    dependencies.createVerifySink ?? createInMemoryWriteSink;
  const executeAudit = dependencies.executeAudit ?? runAudit;
  const writeOutput =
    dependencies.writeOutput ?? ((text) => process.stdout.write(`${text}\n`));

  const configPath = path.resolve(currentDirectory, options.configPath);
  const suppliedConfig = JSON.parse(await readText(configPath));
  const resolvedConfig = await resolveConfig(suppliedConfig, {
    baseDirectory: currentDirectory,
    environment,
  });

  // Port construction deliberately follows configuration resolution. Invalid
  // configuration therefore cannot enumerate a source or create output.
  const reader = createReader();
  const sink =
    options.mode === "verify"
      ? createVerifySink()
      : await createRunSink(resolvedConfig.auditOutputDirectory);
  const result = await executeAudit(resolvedConfig, reader, sink, { resolved: true });

  writeOutput(
    [
      ALIGNMENT_AUDIT_INVOCATION_SURFACE.capabilityId,
      options.mode,
      `${result.counts.auditedDocuments} documents`,
      `${result.counts.findings} findings`,
      `${formatElapsed(result.elapsedMs)} ms`,
      `Deploy_Boundary ${result.deployBoundaryState}`,
    ].join(": "),
  );

  if (result.modifiedOutsideOutputCount !== 0) {
    throw new Error(
      `source integrity mismatch: ${result.modifiedOutsideOutputCount} input file(s) changed`,
    );
  }
  return result;
}

function formatElapsed(value) {
  const elapsed = Number(value);
  return Number.isFinite(elapsed) ? elapsed.toFixed(2) : "0.00";
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `[alignment-audit] ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
