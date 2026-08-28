#!/usr/bin/env node
// Responsibility: Expose persisted planning and file-transported exact retirement authorization.
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createController } from "./admitted-empty-abandoned-owner-retirement-controller.mjs";
import { createRepositoryAdapter } from "./admitted-empty-abandoned-owner-retirement-repository-adapter.mjs";

const OPTIONS = new Set(["auth-file", "claim-id", "controller-root", "ledger-repository",
  "plan-digest", "pull-request", "repository", "source-state-path", "state-path", "subject-worktree",
  "task-authority",
  "authored-worktree", "target-repository", "json"]);

export async function main(argumentsList = process.argv.slice(2), dependencies = {}) {
  const [action = "plan", ...tail] = argumentsList;
  if (!new Set(["plan", "run", "resume-plan", "resume-run"]).has(action)) throw new Error(usage());
  const options = parse(tail);
  const createAdapter = dependencies.createAdapter || createRepositoryAdapter;
  const createRuntime = dependencies.createController || createController;
  const adapter = createAdapter({ repository: required(options, "repository"),
    subjectWorktree: required(options, "subject-worktree"),
    authoredWorktree: required(options, "authored-worktree"),
    targetRepository: required(options, "target-repository"),
    ledgerRepository: options.get("ledger-repository"),
    controllerRoot: options.get("controller-root"),
    pullRequestNumber: integer(required(options, "pull-request"), "pull request"),
    claimId: exactDigest(required(options, "claim-id"), "claim ID"),
    statePath: required(options, "state-path"),
    sourceStatePath: options.get("source-state-path"),
    taskAuthorityFile: options.get("task-authority") });
  const controller = createRuntime({ adapter });
  if (action === "plan") {
    if (options.has("auth-file") || options.has("plan-digest") || options.has("source-state-path")) {
      throw new Error("plan forbids run or resume authorization options.");
    }
    return controller.plan();
  }
  if (action === "resume-plan") {
    if (options.has("auth-file") || options.has("plan-digest")) {
      throw new Error("resume-plan forbids run authorization options.");
    }
    required(options, "source-state-path"); required(options, "task-authority");
    return controller.resumePlan();
  }
  const input = { planDigest: exactDigest(required(options, "plan-digest"), "plan digest"),
    authorization: readAuthorization(required(options, "auth-file")) };
  if (action === "resume-run") {
    required(options, "source-state-path"); required(options, "task-authority");
    return controller.resumeRun(input);
  }
  if (options.has("source-state-path")) throw new Error("run forbids resume source state.");
  return controller.run(input);
}

export async function runCli(argumentsList = process.argv.slice(2)) {
  try { process.stdout.write(`${JSON.stringify({ schema: "agentic-admitted-empty-abandoned-owner-retirement-result/v1",
    status: "complete", result: await main(argumentsList) })}\n`); return 0; }
  catch (error) { process.stdout.write(`${JSON.stringify({ schema: "agentic-admitted-empty-abandoned-owner-retirement-result/v1",
    status: "blocked", error: String(error?.message || error).slice(0, 1_000) })}\n`); return 1; }
}

function readAuthorization(file) { const resolved = path.resolve(file), stat = lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error("Authorization file must be private and regular.");
  const value = readFileSync(resolved, "utf8");
  if (value.endsWith("\n") && !value.slice(0, -1).includes("\n")) return value.slice(0, -1);
  if (!value.includes("\n")) return value;
  throw new Error("Authorization file must contain exactly one line."); }
function parse(args) { const result = new Map(); for (const argument of args) { if (argument === "--json") { result.set("json", "true"); continue; }
  const match = argument.match(/^--([a-z0-9-]+)=(.*)$/u); if (!match || !OPTIONS.has(match[1]) || !match[2]) throw new Error(`Unsupported option: ${argument}`);
  if (result.has(match[1])) throw new Error(`--${match[1]} must be provided once.`); result.set(match[1], match[2]); } return result; }
function required(options, name) { const value = options.get(name); if (!value) throw new Error(`--${name}=<value> is required.`); return value; }
function integer(value, label) { const result = Number(value); if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label} is invalid.`); return result; }
function exactDigest(value, label) { if (!/^[0-9a-f]{64}$/u.test(value)) throw new Error(`${label} is invalid.`); return value; }
function usage() { return "Usage: admitted-empty-abandoned-owner-retirement.mjs plan|run|resume-plan|resume-run --repository=<path> --subject-worktree=<path> --authored-worktree=<path> --target-repository=<owner/name> --pull-request=<number> --claim-id=<digest> --state-path=<private-json> [--source-state-path=<private-json>] [--task-authority=<private-capability>] [--ledger-repository=<owner/name>] [--controller-root=<protected-main>] [--plan-digest=<digest> --auth-file=<private-text>] [--json]"; }

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) process.exitCode = await runCli();
