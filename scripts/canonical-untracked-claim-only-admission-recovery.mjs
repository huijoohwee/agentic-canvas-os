#!/usr/bin/env node
// Responsibility: Expose plan/run without weakening exact authorization or private-file boundaries.
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { createCanonicalUntrackedClaimOnlyAdmissionRecoveryController }
  from "./canonical-untracked-claim-only-admission-recovery-controller.mjs";
import { normalizeCanonicalUntrackedClaimOnlyAdmissionRecoveryPlan }
  from "./canonical-untracked-claim-only-admission-recovery-contract.mjs";
import {
  createCanonicalUntrackedClaimOnlyAdmissionRecoveryRepositoryAdapter,
  validateCanonicalUntrackedClaimOnlyPathRoles,
}
  from "./canonical-untracked-claim-only-admission-recovery-repository-adapter.mjs";
import {
  createCanonicalUntrackedClaimOnlyAdmissionRecoveryStore,
  writeCanonicalUntrackedClaimOnlyPrivateJson,
} from "./canonical-untracked-claim-only-admission-recovery-store.mjs";

let parsed;
try {
  parsed = parse(process.argv.slice(2));
  const common = {
    repository: option("repository"),
    recoveryDirectory: option("recovery"),
    targetWorktree: option("target-worktree"),
    controllerRoot: option("controller-root"),
    manifestFile: option("manifest"),
    cloudAuthorityFile: option("cloud-authority"),
    device: option("device"),
    sessionId: option("session"),
    scope: option("scope"),
  };
  const statePath = absoluteOption("state", "journal path");
  const store = createCanonicalUntrackedClaimOnlyAdmissionRecoveryStore({ statePath });

  if (parsed.command === "plan") {
    rejectOptions(["authorize", "task-authority", "authority-output", "plan-file"]);
    const output = absoluteOption("output", "plan output path");
    validateCanonicalUntrackedClaimOnlyPathRoles({ ...common, statePath, planOutput: output });
    const adapter = createCanonicalUntrackedClaimOnlyAdmissionRecoveryRepositoryAdapter(common);
    const controller = createCanonicalUntrackedClaimOnlyAdmissionRecoveryController({ adapter, store });
    const plan = await controller.plan({ ttlSeconds: numberOption("ttl-seconds", 3_600) });
    writeCanonicalUntrackedClaimOnlyPrivateJson(output, plan);
    emit(plan);
  } else if (parsed.command === "run") {
    rejectOptions(["output", "ttl-seconds"]);
    const planFile = absoluteOption("plan-file", "plan file");
    const taskAuthorityFile = absoluteOption("task-authority", "task authority capability path");
    const authorityOutput = absoluteOption("authority-output", "authority output path");
    validateCanonicalUntrackedClaimOnlyPathRoles({
      ...common, statePath, planFile, taskAuthorityFile, authorityOutput,
    });
    const plan = readPrivatePlan(planFile);
    const adapter = createCanonicalUntrackedClaimOnlyAdmissionRecoveryRepositoryAdapter({
      ...common,
      taskAuthorityFile,
    });
    const controller = createCanonicalUntrackedClaimOnlyAdmissionRecoveryController({ adapter, store });
    const completion = await controller.run({
      plan,
      authorization: option("authorize"),
    });
    writeCanonicalUntrackedClaimOnlyPrivateJson(authorityOutput, completion.authority, { replace: true });
    emit(completion.authority);
  } else {
    usage("Command must be plan or run.");
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}

function parse(argv) {
  const [command, ...rest] = argv;
  const options = new Map();
  let json = false;
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--json") { json = true; continue; }
    if (!token?.startsWith("--") || token.includes("=")) usage(`Invalid option: ${token || "missing"}`);
    const name = token.slice(2);
    const value = rest[index + 1];
    if (!value || value.startsWith("--") || options.has(name)) usage(`Option --${name} requires one value.`);
    options.set(name, value);
    index += 1;
  }
  const known = new Set([
    "repository", "recovery", "target-worktree", "controller-root", "manifest",
    "cloud-authority", "device", "session",
    "scope", "state", "ttl-seconds", "output", "plan-file", "task-authority",
    "authorize", "authority-output",
  ]);
  for (const key of options.keys()) if (!known.has(key)) usage(`Unknown option: --${key}`);
  return { command, options, json };
}

function option(name) {
  const value = parsed.options.get(name);
  if (typeof value !== "string" || !value || value !== value.trim()) usage(`--${name} is required.`);
  return value;
}
function absoluteOption(name, label) { const value = option(name); if (!path.isAbsolute(value)) throw new Error(`${label} must be absolute.`); return path.resolve(value); }
function numberOption(name, fallback) { if (!parsed.options.has(name)) return fallback; const value = Number(option(name)); if (!Number.isSafeInteger(value)) usage(`--${name} must be an integer.`); return value; }
function rejectOptions(names) { for (const name of names) if (parsed.options.has(name)) usage(`--${name} is not valid for ${parsed.command}.`); }
function readPrivatePlan(file) { const stat = lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600) throw new Error("Plan file must be a private regular file."); return normalizeCanonicalUntrackedClaimOnlyAdmissionRecoveryPlan(JSON.parse(readFileSync(file, "utf8"))); }
function emit(value) { process.stdout.write(`${JSON.stringify(value, null, parsed.json ? 2 : 0)}\n`); }
function usage(message) { throw new Error(`${message}\nUsage: canonical-untracked-claim-only-admission-recovery.mjs <plan|run> [options]`); }
