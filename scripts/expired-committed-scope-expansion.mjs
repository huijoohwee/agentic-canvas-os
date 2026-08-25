#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";

import { normalizeDeclaredWriteScopeManifest } from "./scoped-lane-admission-lib.mjs";
import { createExpiredCommittedScopeExpansionRepositoryAdapter }
  from "./expired-committed-scope-expansion-repository-adapter.mjs";

const [command, ...args] = process.argv.slice(2);
const json = args.includes("--json");

try {
  if (!["plan", "run"].includes(command)) usage();
  const repository = path.resolve(requiredOption(args, "source-repository"));
  const manifestPath = path.resolve(requiredOption(args, "target-manifest"));
  const targetManifest = normalizeDeclaredWriteScopeManifest(
    JSON.parse(readFileSync(manifestPath, "utf8")),
  );
  const adapter = createExpiredCommittedScopeExpansionRepositoryAdapter({
    sourceRepository: repository,
    sessionId: requiredOption(args, "session"),
    targetManifest,
    taskAuthorityFile: requiredOption(args, "task-authority"),
  });
  const captured = adapter.capturePlan();
  if (command === "plan") {
    output({
      schema: "agentic-expired-committed-scope-expansion-command/v1",
      ok: true,
      action: "plan",
      status: "authorization-required",
      plan: captured.plan,
      requiredAuthorization: `authorize expired-committed-scope-expansion ${captured.plan.planDigest}`,
    });
  } else {
    const result = await adapter.execute({ authorization: requiredOption(args, "authorize") });
    output({
      schema: "agentic-expired-committed-scope-expansion-command/v1",
      ok: true,
      action: "run",
      status: "complete",
      result,
    });
  }
} catch (error) {
  output({
    schema: "agentic-expired-committed-scope-expansion-command/v1",
    ok: false,
    action: command || null,
    status: "error",
    error: { code: "expired_committed_scope_expansion_failed", message: error.message },
  }, 1);
}

function requiredOption(values, name) {
  const prefix = `--${name}=`;
  const value = values.find(item => item.startsWith(prefix))?.slice(prefix.length);
  if (!value) throw new Error(`--${name} is required.`);
  return value;
}

function output(value, exitCode = 0) {
  process[exitCode ? "stderr" : "stdout"].write(`${JSON.stringify(value, null, json ? 2 : 0)}\n`);
  process.exit(exitCode);
}

function usage() {
  throw new Error("Usage: expired-committed-scope-expansion.mjs plan|run --source-repository=<path> --target-manifest=<path> --session=<id> --task-authority=<external-capability> [--authorize=<exact>] [--json]");
}
