#!/usr/bin/env node
// Responsibility: Hold the <600 authored line budget non-increasing for tracked
// source files so the rule that docs already satisfy stops being unenforced in
// code.
//
// The repository states "keep authored files under 600 lines" in
// docs/PROJECT-RULES.md, and scripts/docs-contract.mjs enforces it for every
// Markdown artifact under docs/. Nothing enforced it for scripts/, __tests__/,
// src/, worker/, web/, agent-api/, or adapters/.
//
// Retrofitting every existing offender is not MVP work, so this contract is a
// ratchet, not a sweep:
//   - a tracked authored file already over budget must not grow,
//   - a tracked authored file at or under budget must not cross it,
//   - a baseline entry that drops to or below budget must leave the baseline.
// The baseline is recorded evidence of debt, not permission to add more.
//
// Generated and vendored trees are out of scope because they are not authored.

import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = path.join(REPOSITORY_ROOT, "scripts", "authored-line-budget.baseline.json");

export const AUTHORED_LINE_BUDGET = 600;
export const AUTHORED_EXTENSIONS = Object.freeze([".mjs", ".js", ".ts", ".tsx", ".jsonc", ".css"]);
export const EXCLUDED_PREFIXES = Object.freeze([
  "node_modules/",
  "web/dist/",
  ".wrangler/",
]);
export const EXCLUDED_FILES = Object.freeze(["package-lock.json"]);

export function isAuthoredPath(relativePath) {
  if (EXCLUDED_FILES.includes(relativePath)) return false;
  if (EXCLUDED_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) return false;
  return AUTHORED_EXTENSIONS.includes(path.extname(relativePath).toLowerCase());
}

export function countLines(text) {
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

export function evaluateLineBudget({ measured, baseline }) {
  const failures = [];
  const overBudget = new Map();

  for (const [relativePath, lineCount] of measured) {
    const allowance = baseline[relativePath];
    if (lineCount > AUTHORED_LINE_BUDGET) overBudget.set(relativePath, lineCount);

    if (allowance === undefined) {
      if (lineCount > AUTHORED_LINE_BUDGET) {
        failures.push(
          `${relativePath}: ${lineCount} lines crosses the <${AUTHORED_LINE_BUDGET} authored line `
          + "budget; split by responsibility instead of adding a baseline entry",
        );
      }
      continue;
    }
    if (lineCount > allowance) {
      failures.push(
        `${relativePath}: ${lineCount} lines exceeds its recorded ceiling of ${allowance}; `
        + "the authored line budget is non-increasing",
      );
    } else if (lineCount <= AUTHORED_LINE_BUDGET) {
      failures.push(
        `${relativePath}: ${lineCount} lines is now within the <${AUTHORED_LINE_BUDGET} budget; `
        + "remove its baseline entry with --write",
      );
    }
  }

  for (const relativePath of Object.keys(baseline)) {
    if (!measured.has(relativePath)) {
      failures.push(
        `${relativePath}: recorded in the baseline but absent from the tracked authored set; `
        + "remove its baseline entry with --write",
      );
    }
  }

  return { failures, overBudget };
}

export async function measureAuthoredFiles({ repositoryRoot = REPOSITORY_ROOT } = {}) {
  const { stdout } = await execFileAsync("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    maxBuffer: 64 * 1024 * 1024,
  });
  const measured = new Map();
  for (const relativePath of stdout.split("\0")) {
    if (!relativePath || !isAuthoredPath(relativePath)) continue;
    let text;
    try {
      text = await readFile(path.join(repositoryRoot, relativePath), "utf8");
    } catch {
      continue;
    }
    measured.set(relativePath, countLines(text));
  }
  return new Map([...measured].sort(([left], [right]) => left.localeCompare(right)));
}

async function readBaseline() {
  try {
    return JSON.parse(await readFile(BASELINE_PATH, "utf8")).ceilings ?? {};
  } catch {
    return {};
  }
}

async function runCli() {
  const write = process.argv.includes("--write");
  const measured = await measureAuthoredFiles();
  const baseline = await readBaseline();
  const { failures, overBudget } = evaluateLineBudget({ measured, baseline });

  if (write) {
    const ceilings = Object.fromEntries([...overBudget].sort(([left], [right]) => left.localeCompare(right)));
    await writeFile(
      BASELINE_PATH,
      `${JSON.stringify({
        budget: AUTHORED_LINE_BUDGET,
        note: "Recorded debt, not permission. Entries may only shrink or leave.",
        ceilings,
      }, null, 2)}\n`,
      "utf8",
    );
    console.log(`authored line budget baseline written: ${Object.keys(ceilings).length} files over ${AUTHORED_LINE_BUDGET} lines`);
    return;
  }

  if (failures.length > 0) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log(
    `authored line budget ok: ${measured.size} tracked authored files; `
    + `${overBudget.size} held at recorded ceilings above ${AUTHORED_LINE_BUDGET} lines`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}
