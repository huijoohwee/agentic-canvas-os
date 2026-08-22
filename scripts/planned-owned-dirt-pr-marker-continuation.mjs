#!/usr/bin/env node
// Responsibility: Expose read-only plan and exact-authorized run transports.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createController }
  from "./planned-owned-dirt-pr-marker-continuation-controller.mjs";
import { createRepositoryAdapter }
  from "./planned-owned-dirt-pr-marker-continuation-repository-adapter.mjs";

export function parseArguments(values) {
  const [mode, ...args] = values;
  if (!['plan', 'run'].includes(mode)) throw new Error(usage());
  const option = name => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  const input = { mode, repository: required(option("repository"), "repository"),
    sourceSessionId: required(option("source-session"), "source-session"),
    originalPlanDigest: required(option("original-plan-digest"), "original-plan-digest"),
    pullRequestNumber: Number(required(option("pull-request"), "pull-request")),
    taskAuthorityFile: required(option("task-authority"), "task-authority"),
    json: args.includes("--json") };
  if (!Number.isSafeInteger(input.pullRequestNumber) || input.pullRequestNumber < 1) {
    throw new Error("--pull-request must be a positive integer.");
  }
  if (mode === "plan") input.output = required(option("output"), "output");
  if (mode === "run") {
    input.planFile = required(option("plan-file"), "plan-file");
    input.authorization = required(option("authorize"), "authorize");
  }
  return input;
}

export async function runCli(values = process.argv.slice(2), dependencies = {}) {
  const input = parseArguments(values);
  const adapter = (dependencies.createAdapter || createRepositoryAdapter)(input,
    dependencies.adapterDependencies);
  const controller = (dependencies.createController || createController)(adapter);
  if (input.mode === "plan") {
    external(input.output, input.repository);
    const plan = await controller.plan();
    writeFileSync(path.resolve(input.output), `${JSON.stringify(plan, null, 2)}\n`,
      { mode: 0o600, flag: "wx" });
    return { schema: "agentic-planned-owned-dirt-pr-marker-continuation-result/v1",
      ok: true, status: "planned", plan,
      exactAuthorization: `authorize planned-owned-dirt-pr-marker-continuation ${plan.planDigest}` };
  }
  external(input.planFile, input.repository);
  const receipt = await controller.run({
    plan: JSON.parse(readFileSync(path.resolve(input.planFile), "utf8")),
    authorization: input.authorization,
  });
  return { schema: "agentic-planned-owned-dirt-pr-marker-continuation-result/v1",
    ok: true, status: "complete", receipt };
}

function required(value, name) { if (!value) throw new Error(`--${name}=<value> is required.`); return value; }
function external(candidate, repository) { const file = path.resolve(candidate), root = `${path.resolve(repository)}${path.sep}`;
  if (file === path.resolve(repository) || file.startsWith(root)) throw new Error("Continuation artifacts must remain outside the source repository."); }
function usage() { return "Usage: planned-owned-dirt-pr-marker-continuation.mjs plan|run --repository=<source> --source-session=<id> --original-plan-digest=<digest> --pull-request=<number> --task-authority=<external-capability> [--output=<external-plan>|--plan-file=<external-plan> --authorize=<exact-text>] [--json]"; }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await runCli())); }
  catch (error) { console.log(JSON.stringify({ schema: "agentic-planned-owned-dirt-pr-marker-continuation-result/v1",
    ok: false, status: "blocked", error: String(error?.message || error).slice(0, 500) })); process.exitCode = 1; }
}
