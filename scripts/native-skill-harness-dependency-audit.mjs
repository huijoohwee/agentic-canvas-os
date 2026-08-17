#!/usr/bin/env node
// Forbidden dependency audit for the native skill creation harness.
//
// The Forbidden_Dependency_Set is any external self-improving agent-runtime
// package (Hermes Agent and equivalents) in every form: package.json
// dependency fields, source imports and requires across worker/, src/,
// agent-api/src/, and adapters/, and outbound network call targets. A
// documentation reference naming such a project as a pattern is permitted;
// copied code, prompts, schemas, tests, fixtures, or prose is not.

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FORBIDDEN_IDENTIFIERS = Object.freeze(["hermes-agent", "hermes_agent", "hermesagent"]);
const PACKAGE_FIELDS = Object.freeze([
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "overrides",
]);
const SOURCE_TREES = Object.freeze(["worker", "src", "agent-api/src", "adapters"]);

function namesForbiddenDependency(value) {
  if (typeof value !== "string") return false;
  const normalized = value.toLowerCase();
  return FORBIDDEN_IDENTIFIERS.some((identifier) => normalized.includes(identifier));
}

async function collectSourceFiles(directory, files = []) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectSourceFiles(entryPath, files);
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(entryPath);
    else if (entry.isFile() && entry.name.endsWith(".mjs")) files.push(entryPath);
  }
  return files;
}

async function run() {
  const failures = [];

  const packageJson = JSON.parse(await readFile(path.join(REPOSITORY_ROOT, "package.json"), "utf8"));
  for (const field of PACKAGE_FIELDS) {
    const entries = packageJson[field] ?? {};
    for (const [name, version] of Object.entries(entries)) {
      if (namesForbiddenDependency(name) || namesForbiddenDependency(String(version))) {
        failures.push(`package.json ${field} declares forbidden dependency ${name}@${version}`);
      }
    }
  }

  for (const tree of SOURCE_TREES) {
    const files = await collectSourceFiles(path.join(REPOSITORY_ROOT, tree));
    for (const file of files) {
      const text = await readFile(file, "utf8");
      const relativePath = path.relative(REPOSITORY_ROOT, file);
      const importMatches = [...text.matchAll(/(?:import\s+[^;]*?from\s+|require\(|import\()\s*["']([^"']+)["']/g)].map((match) => match[1]);
      for (const specifier of importMatches) {
        if (namesForbiddenDependency(specifier)) {
          failures.push(`${relativePath} imports forbidden dependency ${specifier}`);
        }
      }
      const urlMatches = [...text.matchAll(/https?:\/\/[^\s"'`)]+/g)].map((match) => match[0]);
      for (const target of urlMatches) {
        if (namesForbiddenDependency(target)) {
          failures.push(`${relativePath} names forbidden network call target ${target}`);
        }
      }
      // A vendored copy would appear as a directory or file name; scan the
      // file's own path too.
      if (namesForbiddenDependency(relativePath)) {
        failures.push(`${relativePath} is a vendored copy of a forbidden dependency`);
      }
    }
  }

  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log(`dependency audit ok: zero Forbidden_Dependency_Set entries across package.json and the ${SOURCE_TREES.length} source trees`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await run();
}
