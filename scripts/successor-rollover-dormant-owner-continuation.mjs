#!/usr/bin/env node
// Responsibility: Expose private planning and exact-authorized dormant-owner continuation.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildDormantOwnerContinuationPlan,
  normalizeDormantOwnerContinuationPlan,
} from "./successor-rollover-dormant-owner-continuation-contract.mjs";
import { createDormantOwnerContinuationController }
  from "./successor-rollover-dormant-owner-continuation-controller.mjs";
import { createRepositoryDormantOwnerContinuationAdapter }
  from "./successor-rollover-dormant-owner-continuation-repository-adapter.mjs";
import {
  createDormantOwnerContinuationJournalStore,
  readPrivateContinuationJson,
  writePrivateContinuationJsonExclusive,
} from "./successor-rollover-dormant-owner-continuation-store.mjs";

const OPTIONS = new Set([
  "authorization", "controller-root", "journal", "output", "plan", "pull-request",
  "repository", "rollover-journal", "rollover-plan", "session",
  "successor-promotion-journal", "task-authority", "ttl-seconds",
]);

export async function main(argumentsList = process.argv.slice(2), dependencies = {}) {
  const [command, ...tail] = argumentsList;
  if (!new Set(["plan", "run"]).has(command)) throw new Error(usage());
  const options = parse(tail);
  const repository = realpathSync(path.resolve(required(options, "repository")));
  const commonDirectory = realpathSync(path.resolve(repository, execFileSync(
    "git", ["rev-parse", "--git-common-dir"], { cwd: repository, encoding: "utf8" },
  ).trim()));
  const controllerRoot = realpathSync(path.resolve(required(options, "controller-root")));
  const forbiddenRoots = [...new Set([repository, commonDirectory, controllerRoot])];
  const journalPath = path.resolve(required(options, "journal"));
  const journalStore = (dependencies.createJournalStore
    || createDormantOwnerContinuationJournalStore)({ journalPath, forbiddenRoots });
  if (command === "plan") {
    for (const forbidden of ["authorization", "plan", "task-authority"]) {
      if (options.has(forbidden)) throw new Error(`plan does not accept --${forbidden}.`);
    }
    if (journalStore.read()) throw new Error("Planning requires an unused private journal path.");
    const ttlSeconds = positive(options.get("ttl-seconds") || 1_800, "TTL seconds");
    const adapter = createAdapter({ ttlSeconds, taskAuthorityFile: null });
    const plan = buildDormantOwnerContinuationPlan({
      evidence: await adapter.captureEvidence(),
      ttlSeconds,
    });
    const outputPath = writePrivateContinuationJsonExclusive(
      required(options, "output"),
      plan,
      { forbiddenRoots },
    );
    return Object.freeze({
      schema: "agentic-successor-rollover-dormant-owner-continuation-command/v1",
      status: "authorization-required",
      planDigest: plan.planDigest,
      requiredAuthorization: plan.exactAuthorization,
      outputPath,
      journalPath,
    });
  }
  for (const forbidden of ["output"]) {
    if (options.has(forbidden)) throw new Error(`run does not accept --${forbidden}.`);
  }
  const plan = normalizeDormantOwnerContinuationPlan(readPrivateContinuationJson(
    required(options, "plan"),
    "continuation plan",
    { forbiddenRoots },
  ));
  if (options.has("ttl-seconds")
    && positive(options.get("ttl-seconds"), "TTL seconds") !== plan.ttlSeconds) {
    throw new Error("Runtime TTL seconds must equal the plan-sealed TTL seconds.");
  }
  const adapter = createAdapter({
    ttlSeconds: plan.ttlSeconds,
    taskAuthorityFile: required(options, "task-authority"),
  });
  const controller = (dependencies.createController
    || createDormantOwnerContinuationController)({ adapter, journalStore });
  const result = await controller.run({
    plan,
    authorization: required(options, "authorization"),
  });
  return Object.freeze({
    schema: "agentic-successor-rollover-dormant-owner-continuation-command/v1",
    status: "complete",
    result,
  });

  function createAdapter({ ttlSeconds, taskAuthorityFile }) {
    return (dependencies.createAdapter
      || createRepositoryDormantOwnerContinuationAdapter)({
      repository,
      sessionId: required(options, "session"),
      pullRequestNumber: positive(required(options, "pull-request"), "pull request"),
      rolloverPlanFile: required(options, "rollover-plan"),
      rolloverJournalFile: required(options, "rollover-journal"),
      successorPromotionJournalFile: required(options, "successor-promotion-journal"),
      taskAuthorityFile,
      controllerRoot,
      ttlSeconds,
    });
  }
}

export async function runCli(argumentsList = process.argv.slice(2)) {
  try {
    console.log(JSON.stringify(await main(argumentsList)));
    return 0;
  } catch (error) {
    console.log(JSON.stringify({
      schema: "agentic-successor-rollover-dormant-owner-continuation-command/v1",
      status: "blocked",
      error: publicMessage(error),
    }));
    return 1;
  }
}

function parse(values) {
  const result = new Map();
  for (const value of values) {
    if (value === "--json") continue;
    const match = value.match(/^--([a-z0-9-]+)=(.*)$/u);
    if (!match || !OPTIONS.has(match[1]) || result.has(match[1]) || !match[2]) {
      throw new Error(`Unsupported or duplicate option: ${value}`);
    }
    result.set(match[1], match[2]);
  }
  return result;
}
function required(options, name) {
  const value = options.get(name); if (!value) throw new Error(`--${name}=<value> is required.`); return value;
}
function positive(value, label) {
  const result = Number(value); if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label} is invalid.`); return result;
}
function publicMessage(error) {
  return String(error?.message || error || "blocked")
    .replace(/(?:ghp|github_pat)_[A-Za-z0-9_]+/gu, "[redacted]").slice(0, 1_000);
}
function usage() {
  return "Usage: successor-rollover-dormant-owner-continuation.mjs plan|run "
    + "--repository=<worktree> --session=<source-session> --pull-request=<number> "
    + "--rollover-plan=<private> --rollover-journal=<private> "
    + "--successor-promotion-journal=<private> --controller-root=<clean-main> "
    + "--journal=<private-state> [--output=<private-plan>|--plan=<private-plan> "
    + "--task-authority=<private-capability> --authorization=<exact>]";
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = await runCli();
}
