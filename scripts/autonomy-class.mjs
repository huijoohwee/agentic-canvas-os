#!/usr/bin/env node
// Responsibility: Derive a candidate's autonomy class from its normalized write
// set, so a promotion ceiling is computed rather than claimed.
//
// Owner of the rules: huijoohwee.github.io/guidelines/
//   agentic-sdlc-production-release-lifecycle.md, "Autonomy Classes and
//   Standing Authorization"
//
// The class is never declared by the run that benefits from it. A mixed write set
// resolves to its highest class, and `authority-controlling` escalates at every
// promotion regardless of check state, standing grant, or urgency: a system that
// can autonomously merge changes to the gates constraining it has no boundary,
// only a delay.
//
// This file and its pattern table are themselves `authority-controlling`, so
// autonomy can never widen its own definition. That is asserted by test, not
// left to good intentions.
//
// Deterministic: no clock, no randomness, no network, no model call, no write.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CLASS_DOCS_ONLY = "docs-only";
export const CLASS_TEST_ONLY = "test-only";
export const CLASS_ADDITIVE_CONTRACT = "additive-contract";
export const CLASS_BEHAVIORAL = "behavioral";
export const CLASS_AUTHORITY_CONTROLLING = "authority-controlling";

// Ascending ceiling order. A mixed write set resolves to the last match.
export const CLASS_ORDER = Object.freeze([
  CLASS_DOCS_ONLY,
  CLASS_TEST_ONLY,
  CLASS_ADDITIVE_CONTRACT,
  CLASS_BEHAVIORAL,
  CLASS_AUTHORITY_CONTROLLING,
]);

export const ESCALATING_CLASSES = Object.freeze([CLASS_AUTHORITY_CONTROLLING]);

// Anything that decides who may write, merge, publish, or deploy -- plus the
// classifier and the hooks that enforce it.
export const AUTHORITY_PATTERNS = Object.freeze([
  /^\.githooks\//,
  /^\.github\/workflows\//,
  /^scripts\/autonomy-class\.mjs$/,
  /^scripts\/(?:writer-lease|task-bound-lane-authority)/,
  /^scripts\/device-(?:branch|start|resume|park|integrate|pull-request)/,
  /^scripts\/(?:scoped-lane-admission|cloud-collaboration|workspace-guard|repository-guards)/,
  /^scripts\/install-workspace-guards\.mjs$/,
  /^scripts\/lane-projection-reconciliation\.mjs$/,
  /(?:^|\/)(?:release|publish|deploy)[a-z-]*-(?:controller|authority|policy)\.mjs$/,
  /^\.agentic-runtime\//,
  /(?:^|\/)(?:credentials|secrets)(?:\.|\/|$)/,
]);

const DOCS_PATTERNS = Object.freeze([/^docs\//, /\.md$/, /^llms\.txt$/]);
const TEST_PATTERNS = Object.freeze([/^__tests__\//, /\.test\.mjs$/, /^fixtures\//]);

export function classifyPath(relativePath) {
  const candidate = String(relativePath || "").trim().replace(/^\.\//, "");
  if (!candidate) return null;
  if (AUTHORITY_PATTERNS.some((pattern) => pattern.test(candidate))) {
    return CLASS_AUTHORITY_CONTROLLING;
  }
  if (TEST_PATTERNS.some((pattern) => pattern.test(candidate))) return CLASS_TEST_ONLY;
  if (DOCS_PATTERNS.some((pattern) => pattern.test(candidate))) return CLASS_DOCS_ONLY;
  return null;
}

// `added` distinguishes an additive contract from a behavioral change: a new
// module alters nothing that already ran, a modified one does.
export function classifyWriteSet(entries) {
  const perPath = [];
  for (const entry of entries) {
    const relativePath = typeof entry === "string" ? entry : entry.path;
    const added = typeof entry === "string" ? false : Boolean(entry.added);
    const known = classifyPath(relativePath);
    perPath.push({
      path: relativePath,
      class: known ?? (added ? CLASS_ADDITIVE_CONTRACT : CLASS_BEHAVIORAL),
    });
  }
  const highest = perPath.reduce((rank, item) => Math.max(rank, CLASS_ORDER.indexOf(item.class)), -1);
  const derived = highest < 0 ? CLASS_DOCS_ONLY : CLASS_ORDER[highest];
  return Object.freeze({
    class: derived,
    escalates: ESCALATING_CLASSES.includes(derived),
    paths: Object.freeze(perPath),
    escalatingPaths: Object.freeze(
      perPath.filter((item) => ESCALATING_CLASSES.includes(item.class)).map((item) => item.path),
    ),
  });
}

export function coversClass({ grantCeiling, derivedClass }) {
  const ceiling = CLASS_ORDER.indexOf(grantCeiling);
  const derived = CLASS_ORDER.indexOf(derivedClass);
  if (ceiling < 0 || derived < 0) return false;
  // An escalating class is never covered, however generous the grant.
  if (ESCALATING_CLASSES.includes(derivedClass)) return false;
  return derived <= ceiling;
}

export function collectWriteSet({ repository, base, head, git = runGit }) {
  const output = git(repository, ["diff", "--name-status", `${base}..${head}`]);
  return output.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const [status, ...rest] = line.split(/\s+/);
    return { path: rest[rest.length - 1], added: status.startsWith("A") };
  });
}

function runGit(repository, args) {
  return execFileSync("git", ["-C", repository, ...args], { encoding: "utf8" });
}

async function runCli() {
  const argumentOf = (name) => {
    const found = process.argv.find((value) => value.startsWith(`--${name}=`));
    return found ? found.slice(name.length + 3) : null;
  };
  const repository = path.resolve(argumentOf("repository") || process.cwd());
  const base = argumentOf("base") || "origin/main";
  const head = argumentOf("head") || "HEAD";
  const report = classifyWriteSet(collectWriteSet({ repository, base, head }));
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({
      schema: "agentic-autonomy-class/v1",
      base,
      head,
      class: report.class,
      escalates: report.escalates,
      escalatingPaths: report.escalatingPaths,
      pathCount: report.paths.length,
    }, null, 2));
    return;
  }
  console.log(`autonomy class: ${report.class} (${report.paths.length} paths, ${base}..${head})`);
  if (report.escalates) {
    console.log(
      `escalates at every promotion; ${report.escalatingPaths.length} authority-controlling path(s):`,
    );
    for (const escalating of report.escalatingPaths) console.log(`  ${escalating}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}
