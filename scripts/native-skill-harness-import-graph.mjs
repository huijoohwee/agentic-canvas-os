#!/usr/bin/env node
// Import-graph independence check for the native skill creation harness.
//
// Parses the local import specifier lists of the four touched agent-api
// modules and asserts the structural trust boundaries: the transitive local
// graph rooted at the proposer reaches neither the gate nor
// adapter-registration nor agent-definitions; the graph rooted at the gate
// reaches neither the proposer nor any provider adapter module; and
// agent-definitions imports none of the three new modules.

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODULES_ROOT = path.join(REPOSITORY_ROOT, "agent-api/src");
const PROPOSER = "skill-proposer.js";
const GATE = "skill-registry-gate.js";
const REGISTRATION = "adapter-registration.js";
const DEFINITIONS = "agent-definitions.js";
const PROVIDER_ADAPTER_PATTERN = /(openai|model-provider|provider-adapter)/;

async function localImports(moduleName, seen = new Set()) {
  if (seen.has(moduleName)) return seen;
  seen.add(moduleName);
  const text = await readFile(path.join(MODULES_ROOT, moduleName), "utf8");
  const specifiers = [...text.matchAll(/from\s+"(\.[^"]+)"/g)].map((match) => match[1]);
  for (const specifier of specifiers) {
    const resolved = path.basename(specifier);
    if (specifier.startsWith("./") && !specifier.endsWith(".js")) continue;
    await localImports(resolved, seen);
  }
  return seen;
}

async function directImports(moduleName) {
  const text = await readFile(path.join(MODULES_ROOT, moduleName), "utf8");
  return [...text.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
}

async function run() {
  const failures = [];
  const proposerGraph = await localImports(PROPOSER);
  const gateGraph = await localImports(GATE);
  const definitionsImports = await directImports(DEFINITIONS);
  const gateImports = await directImports(GATE);

  if (proposerGraph.has(GATE)) failures.push(`${PROPOSER} transitively imports ${GATE}`);
  if (proposerGraph.has(REGISTRATION)) failures.push(`${PROPOSER} transitively imports ${REGISTRATION}`);
  if (proposerGraph.has(DEFINITIONS)) failures.push(`${PROPOSER} transitively imports ${DEFINITIONS}`);
  if (gateGraph.has(PROPOSER)) failures.push(`${GATE} transitively imports ${PROPOSER}`);
  if (gateGraph.has(REGISTRATION)) failures.push(`${GATE} transitively imports ${REGISTRATION}`);
  for (const specifier of gateImports) {
    if (PROVIDER_ADAPTER_PATTERN.test(specifier)) {
      failures.push(`${GATE} imports the provider adapter module ${specifier}`);
    }
  }
  for (const moduleName of [PROPOSER, REGISTRATION]) {
    if (definitionsImports.some((specifier) => specifier.includes(moduleName))) {
      failures.push(`${DEFINITIONS} imports ${moduleName}; the dependency direction is one way, into the registry`);
    }
  }
  for (const specifier of gateImports) {
    if (specifier.includes(PROPOSER)) failures.push(`${GATE} imports ${PROPOSER}`);
  }
  const proposerDirect = await directImports(PROPOSER);
  for (const specifier of proposerDirect) {
    if (specifier.includes(GATE) || specifier.includes(REGISTRATION) || specifier.includes(DEFINITIONS)) {
      failures.push(`${PROPOSER} imports ${specifier}`);
    }
  }

  // No provider credential surface: neither proposer nor gate references a
  // fetch call or an OPENAI/ANTHROPIC environment name.
  for (const moduleName of [PROPOSER, GATE]) {
    const text = await readFile(path.join(MODULES_ROOT, moduleName), "utf8");
    if (/OPENAI|ANTHROPIC|_API_KEY/.test(text)) {
      failures.push(`${moduleName} references a provider credential environment name`);
    }
  }

  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
    return;
  }
  const moduleCount = (await readdir(MODULES_ROOT)).filter((name) => name.endsWith(".js")).length;
  console.log(`import graph ok: proposer, gate, and registry boundaries hold across ${moduleCount} agent-api modules`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await run();
}
