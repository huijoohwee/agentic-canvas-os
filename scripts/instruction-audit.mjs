#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import {
  auditInstructionDocuments,
  DEFAULT_INSTRUCTION_POLICIES,
} from "./instruction-audit-lib.mjs";

const execFileAsync = promisify(execFile);
const options = parseArguments(process.argv.slice(2));
const root = path.resolve(options.root ?? process.cwd());
const files = Object.keys(DEFAULT_INSTRUCTION_POLICIES);
const documents = await readDocuments(root, files);
const baselineDocuments = options.baselineRef
  ? await readGitDocuments(root, options.baselineRef, files)
  : null;
const report = auditInstructionDocuments({ documents, baselineDocuments });

if (options.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const reduction = report.baseline
    ? `; baseline reduction ${report.baseline.reducedCharacters} chars (${report.baseline.reductionPercent}%)`
    : "";
  console.log(
    `instruction audit ${report.status}: ${report.summary.auditedFiles} files, `
    + `${report.summary.bodyWords} body words, ${report.summary.estimatedTokens} estimated tokens, `
    + `${report.summary.violations} violations${reduction}`,
  );
  for (const issue of report.violations) {
    console.error(`${issue.file}: ${issue.code}: ${issue.message}`);
  }
}

if (report.status !== "passed") process.exitCode = 1;

function parseArguments(args) {
  const result = { json: false, root: null, baselineRef: null };
  for (const argument of args) {
    if (argument === "--json") result.json = true;
    else if (argument.startsWith("--root=")) result.root = argument.slice("--root=".length);
    else if (argument.startsWith("--baseline-ref=")) result.baselineRef = argument.slice("--baseline-ref=".length);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return result;
}

async function readDocuments(repositoryRoot, relativePaths) {
  return Object.fromEntries(await Promise.all(relativePaths.map(async (relativePath) => [
    relativePath,
    await readFile(path.join(repositoryRoot, relativePath), "utf8"),
  ])));
}

async function readGitDocuments(repositoryRoot, reference, relativePaths) {
  return Object.fromEntries(await Promise.all(relativePaths.map(async (relativePath) => {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", repositoryRoot, "show", `${reference}:${relativePath}`],
      { maxBuffer: 2_000_000 },
    );
    return [relativePath, stdout];
  })));
}
