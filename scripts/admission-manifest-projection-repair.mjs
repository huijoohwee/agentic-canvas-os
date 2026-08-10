#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createAdmissionManifestProjectionRepairController } from "./admission-manifest-projection-repair-controller.mjs";
import { createRepositoryAdmissionManifestProjectionRepairAdapter } from "./admission-manifest-projection-repair-repository-adapter.mjs";
import { sanitizeCloudAuthorityDiagnostic } from "./cloud-authority-scope-expansion-lineage-contract.mjs";

export function runAdmissionManifestProjectionRepair({ mode, repository, pullRequestNumber, plan, authorization } = {}) {
  const controller = createAdmissionManifestProjectionRepairController({
    adapter: createRepositoryAdmissionManifestProjectionRepairAdapter({ repository, pullRequestNumber }),
  });
  if (mode === "plan") return controller.plan();
  if (mode === "run") return controller.run({ plan, authorization });
  throw new Error("Admission manifest projection repair mode must be plan or run.");
}

function parseArguments(argumentsList) {
  const mode = argumentsList.shift();
  const entries = argumentsList.map(argument => {
    const match = argument.match(/^--([^=]+)=(.*)$/u);
    if (!match) throw new Error(`Invalid projection-repair argument: ${argument}`);
    return [match[1], match[2]];
  });
  const options = Object.fromEntries(entries);
  const allowed = new Set(["repository", "pull-request", ...(mode === "run" ? ["plan-file", "authorize"] : [])]);
  if (!["plan", "run"].includes(mode) || entries.length !== Object.keys(options).length
    || Object.keys(options).some(key => !allowed.has(key))) throw new Error("Projection-repair arguments are invalid or duplicated.");
  const repository = realpathSync(path.resolve(required(options.repository, "repository")));
  const pullRequestNumber = Number(required(options["pull-request"], "pull-request"));
  if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber < 1) throw new Error("pull-request must be positive.");
  const plan = mode === "run" ? JSON.parse(readFileSync(path.resolve(required(options["plan-file"], "plan-file")), "utf8")) : null;
  return { mode, repository, pullRequestNumber, plan, authorization: options.authorize || null };
}
function required(value, label) { if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`); return value; }
async function main() {
  try { process.stdout.write(`${JSON.stringify(runAdmissionManifestProjectionRepair(parseArguments(process.argv.slice(2))), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${sanitizeCloudAuthorityDiagnostic(error)}\n`); process.exitCode = 1; }
}
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
