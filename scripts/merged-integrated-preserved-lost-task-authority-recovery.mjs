// Responsibility: expose the isolated merged-authority recovery without ambient authority.
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createMergedIntegratedPreservedLostAuthorityRecoveryController }
  from "./merged-integrated-preserved-lost-task-authority-recovery-controller.mjs";
import {
  createMergedIntegratedPreservedLostAuthorityJournalStore,
  createMergedIntegratedPreservedLostAuthorityRecoveryRepositoryAdapter,
} from "./merged-integrated-preserved-lost-task-authority-recovery-repository-adapter.mjs";
import { writeTaskAuthorityCapability } from "./task-bound-lane-authority-store.mjs";

export async function runMergedIntegratedPreservedLostAuthorityRecovery(argv = process.argv.slice(2)) {
  const [action, ...rest] = argv;
  const options = parseOptions(rest);
  const repository = requiredOption(options, "repository");
  if (action === "create-capability") {
    const result = writeTaskAuthorityCapability({
      outputPath: requiredOption(options, "target-capability"),
      generation: positiveInteger(requiredOption(options, "generation"), "generation"),
    });
    return { schema: "agentic-task-authority-capability-create-result/v1", ...result };
  }
  if (!new Set(["plan", "run"]).has(action)) usage();
  const adapter = createMergedIntegratedPreservedLostAuthorityRecoveryRepositoryAdapter({
    repository,
    targetCapabilityPath: requiredOption(options, "target-capability"),
    branch: options.get("branch") || undefined,
  });
  const controller = createMergedIntegratedPreservedLostAuthorityRecoveryController({ adapter });
  if (action === "plan") {
    const plan = await controller.plan();
    const outputPath = requiredOption(options, "plan-output");
    writePrivateJson(outputPath, plan);
    return {
      schema: "agentic-merged-integrated-preserved-lost-task-authority-recovery-plan-result/v1",
      status: "planned",
      planPath: path.resolve(outputPath),
      plan,
    };
  }
  const plan = readJson(requiredOption(options, "plan"), "recovery plan");
  const journalStore = createMergedIntegratedPreservedLostAuthorityJournalStore({
    repository,
    journalPath: requiredOption(options, "journal"),
  });
  const result = await controller.run({
    plan,
    authorization: requiredOption(options, "authorize"),
    journalStore,
  });
  return {
    schema: "agentic-merged-integrated-preserved-lost-task-authority-recovery-command-result/v1",
    status: "complete",
    journalPath: journalStore.path,
    result,
  };
}

function parseOptions(args) {
  const values = new Map();
  for (const argument of args) {
    if (argument === "--json") continue;
    const match = argument.match(/^--([a-z-]+)=(.+)$/u);
    if (!match || values.has(match[1])) usage();
    values.set(match[1], match[2]);
  }
  return values;
}
function writePrivateJson(outputPath, value) {
  const target = path.resolve(requiredText(outputPath, "plan output"));
  if (!path.isAbsolute(outputPath)) throw new Error("Plan output must be absolute.");
  if (existsSync(target)) throw new Error("Plan output already exists; preserve it and choose a new path.");
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const descriptor = openSync(target, "wx", 0o600);
  try { writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`); }
  finally { closeSync(descriptor); }
}
function readJson(filePath, label) {
  const target = path.resolve(requiredText(filePath, label));
  try { return JSON.parse(readFileSync(target, "utf8")); }
  catch (error) { throw new Error(`Could not read ${label}: ${error.message}`); }
}
function requiredOption(options, name) {
  return requiredText(options.get(name), `--${name}`);
}
function requiredText(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}
function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${label} must be a positive integer.`);
  return number;
}
function usage() {
  throw new Error(
    "Usage: merged-integrated-preserved-lost-task-authority-recovery.mjs "
      + "<create-capability|plan|run> --repository=<path> --target-capability=<absolute path> ...",
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMergedIntegratedPreservedLostAuthorityRecovery().then(
    result => process.stdout.write(`${JSON.stringify(result)}\n`),
    error => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    },
  );
}
