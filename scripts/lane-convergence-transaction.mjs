#!/usr/bin/env node
// Responsibility: Expose stable planning and one-authorized execution for lane convergence.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

import {
  buildLaneConvergencePlan,
  normalizeLaneConvergencePlan,
} from "./lane-convergence-transaction-contract.mjs";
import { createLaneConvergenceController } from "./lane-convergence-transaction-controller.mjs";
import { createLaneConvergenceJournal } from "./lane-convergence-transaction-journal.mjs";

const [command, ...argumentsList] = process.argv.slice(2);
const json = argumentsList.includes("--json");

try {
  if (command === "plan") emit(await plan());
  else if (command === "run") emit(await run());
  else usage();
} catch (error) {
  if (!json) throw error;
  console.log(JSON.stringify({ schema: "agentic-lane-convergence-command-result/v1",
    ok: false, command: command || null, error: { code: "lane_convergence_failed",
      message: publicError(error) } }));
  process.exitCode = 1;
}

async function plan() {
  const modulePath = absoluteFile("adapter");
  const configurationPath = absoluteFile("configuration");
  const adapterModule = await loadAdapterModule(modulePath);
  const description = adapterModule.describe();
  const request = readJson(absoluteFile("request"));
  const convergencePlan = buildLaneConvergencePlan({ request, adapter: {
    ...description,
    moduleDigest: fileDigest(modulePath),
    configurationDigest: fileDigest(configurationPath),
  } });
  return { schema: "agentic-lane-convergence-command-result/v1", ok: true,
    command: "plan", status: "planned", plan: convergencePlan,
    planDigest: convergencePlan.planDigest,
    exactAuthorization: convergencePlan.exactAuthorization };
}

async function run() {
  const modulePath = absoluteFile("adapter");
  const configurationPath = absoluteFile("configuration");
  const convergencePlan = normalizeLaneConvergencePlan(readJson(absoluteFile("plan")));
  if (fileDigest(modulePath) !== convergencePlan.adapter.moduleDigest
    || fileDigest(configurationPath) !== convergencePlan.adapter.configurationDigest) {
    throw new Error("Lane-convergence adapter module or configuration drifted from the plan.");
  }
  const adapterModule = await loadAdapterModule(modulePath);
  const description = adapterModule.describe();
  if (description.id !== convergencePlan.adapter.id
    || description.version !== convergencePlan.adapter.version) {
    throw new Error("Lane-convergence adapter identity drifted from the plan.");
  }
  const configuration = readJson(configurationPath);
  const adapter = await adapterModule.createAdapter({ plan: convergencePlan, configuration });
  const journal = createLaneConvergenceJournal({ statePath: absoluteFile("state"),
    plan: convergencePlan });
  const controller = createLaneConvergenceController({ adapter, journal });
  const receipt = await controller.run({ plan: convergencePlan,
    authorization: requiredOption("authorize") });
  return { schema: "agentic-lane-convergence-command-result/v1", ok: true,
    command: "run", status: "complete", receipt };
}

async function loadAdapterModule(file) {
  const imported = await import(`${pathToFileURL(file).href}?digest=${fileDigest(file)}`);
  if (typeof imported.describe !== "function" || typeof imported.createAdapter !== "function") {
    throw new Error("Lane-convergence adapter module must export describe() and createAdapter().");
  }
  return imported;
}

function fileDigest(file) { return createHash("sha256").update(readFileSync(file)).digest("hex"); }
function readJson(file) { const value = JSON.parse(readFileSync(file, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid JSON object: ${file}`);
  return value; }
function absoluteFile(name) { const value = requiredOption(name);
  if (!path.isAbsolute(value) || path.normalize(value) !== value) {
    throw new Error(`--${name} must be an absolute normalized path.`);
  }
  return value; }
function requiredOption(name) { const prefix = `--${name}=`;
  const match = argumentsList.find((item) => item.startsWith(prefix));
  if (!match || match.slice(prefix.length).length === 0) throw new Error(`Missing --${name}.`);
  return match.slice(prefix.length); }
function emit(value) { console.log(JSON.stringify(value)); }
function publicError(error) { return String(error?.message || error).replaceAll(/[\r\n]+/gu, " ").slice(0, 1000); }
function usage() { throw new Error("Usage: lane-convergence-transaction.mjs <plan|run> --adapter=<absolute-module> --configuration=<absolute-json> [--request=<absolute-json> | --plan=<absolute-json> --state=<absolute-json> --authorize='authorize lane-convergence-transaction <digest>'] [--json]"); }
