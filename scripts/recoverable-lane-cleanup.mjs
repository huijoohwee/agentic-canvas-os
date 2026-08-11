#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { createRecoverableLaneCleanupController } from "./recoverable-lane-cleanup-controller.mjs";
import { createRecoverableLaneCleanupRepositoryAdapter } from "./recoverable-lane-cleanup-repository-adapter.mjs";

const scriptPath = fileURLToPath(import.meta.url);

export function parseRecoverableLaneCleanupArguments(argv = []) {
  const [mode, ...values] = argv;
  if (!new Set(["plan", "run", "observe"]).has(mode)) usage();
  const allowed = new Set({
    plan: [
      "repository", "worktree", "recovery-directory", "session",
      "operator-decision-digest", "supersede-preservation", "json",
    ],
    run: [
      "repository", "worktree", "recovery-directory", "session",
      "operator-decision-digest", "supersede-preservation", "plan-digest",
      "authorize", "json",
    ],
    observe: ["repository", "worktree", "recovery-directory", "plan-digest", "json"],
  }[mode]);
  const options = new Map();
  const repeated = new Map();
  for (const value of values) {
    if (value === "--json") {
      if (options.has("json")) throw new Error("Duplicate recoverable cleanup argument: --json");
      options.set("json", "true");
      continue;
    }
    const match = /^--([a-z0-9-]+)=(.*)$/u.exec(value);
    if (!match) throw new Error(`Invalid recoverable cleanup argument: ${value}`);
    const [, name, raw] = match;
    if (!allowed.has(name) || name === "json") {
      throw new Error(`Unsupported ${mode} argument: --${name}`);
    }
    if (name === "supersede-preservation") {
      repeated.set(name, [...(repeated.get(name) || []), raw]);
    } else if (options.has(name)) {
      throw new Error(`Duplicate recoverable cleanup argument: --${name}`);
    } else {
      options.set(name, raw);
    }
  }
  const input = {
    repository: required(options, "repository"),
    worktree: required(options, "worktree"),
    recoveryDirectory: required(options, "recovery-directory"),
    sessionId: options.get("session") || "",
    operatorDecisionDigest: options.get("operator-decision-digest") || "",
    supersededPreservationDigests: repeated.get("supersede-preservation") || [],
    planDigest: options.get("plan-digest") || "",
    authorization: options.get("authorize") || "",
  };
  if (mode === "plan") {
    if (!input.sessionId || !input.operatorDecisionDigest) {
      throw new Error("plan requires --session and --operator-decision-digest.");
    }
  }
  if (mode === "run") {
    if (!input.sessionId || !input.operatorDecisionDigest
      || !input.planDigest || !input.authorization) {
      throw new Error("run requires session, operator decision, plan digest, and exact authorization.");
    }
  }
  return Object.freeze({ mode, input, json: options.has("json") });
}

export function runRecoverableLaneCleanupCli(argv = process.argv.slice(2), dependencies = {}) {
  const parsed = parseRecoverableLaneCleanupArguments(argv);
  const adapter = dependencies.adapter || createRecoverableLaneCleanupRepositoryAdapter({
    repository: parsed.input.repository,
    worktree: parsed.input.worktree,
    recoveryDirectory: parsed.input.recoveryDirectory,
  });
  const controller = dependencies.controller || createRecoverableLaneCleanupController({ adapter });
  const result = controller[parsed.mode](parsed.input);
  (dependencies.write || (text => process.stdout.write(text)))(`${JSON.stringify(result, null, parsed.json ? 2 : 0)}\n`);
  return result;
}

function required(options, name) {
  const value = options.get(name);
  if (!value) throw new Error(`--${name}=<value> is required.`);
  if (["repository", "worktree", "recovery-directory"].includes(name)
    && (!path.isAbsolute(value) || path.normalize(value) !== value)) {
    throw new Error(`--${name} must be a normalized absolute path.`);
  }
  return value;
}

function usage() {
  throw new Error(
    "Usage: recoverable-lane-cleanup.mjs <plan|run|observe> "
    + "--repository=<canonical-root> --worktree=<registered-clean-lane> "
    + "--recovery-directory=<external-absent-directory> "
    + "[--session=<id> --operator-decision-digest=<sha256>] "
    + "[--supersede-preservation=<sha256> ...] "
    + "[--plan-digest=<sha256> --authorize='authorize recoverable-lane-cleanup <sha256>'] [--json]",
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    runRecoverableLaneCleanupCli();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
