#!/usr/bin/env node
// Responsibility: Expose private planning and exact-authorized reviewed descendant recovery.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeReviewedDormantDescendantScopeRecoveryPlan }
  from "./reviewed-dormant-descendant-scope-recovery-contract.mjs";
import { createReviewedDormantDescendantScopeRecoveryController }
  from "./reviewed-dormant-descendant-scope-recovery-controller.mjs";
import { createReviewedDormantDescendantScopeRecoveryRepositoryAdapter }
  from "./reviewed-dormant-descendant-scope-recovery-repository-adapter.mjs";
import {
  readPrivateContinuationJson,
  writePrivateContinuationJsonExclusive,
} from "./successor-rollover-dormant-owner-continuation-store.mjs";

const OPTIONS = new Set([
  "authorization", "controller-root", "journal", "operator-session", "output", "plan",
  "pull-request", "repository", "session", "task-authority", "ttl-seconds",
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
  const operatorSessionId = required(options, "operator-session");
  const ttlSeconds = positive(options.get("ttl-seconds") || 1_800, "TTL seconds");
  if (command === "plan") {
    for (const forbidden of ["authorization", "plan", "task-authority"]) {
      if (options.has(forbidden)) throw new Error(`plan does not accept --${forbidden}.`);
    }
    const adapter = createAdapter(null);
    const controller = (dependencies.createController
      || createReviewedDormantDescendantScopeRecoveryController)({ adapter });
    const plan = await controller.plan({ operatorSessionId, ttlSeconds });
    const outputPath = writePrivateContinuationJsonExclusive(
      required(options, "output"),
      plan,
      { forbiddenRoots },
    );
    return Object.freeze({
      schema: "agentic-reviewed-dormant-descendant-scope-recovery-command/v1",
      status: "authorization-required",
      planDigest: plan.planDigest,
      requiredAuthorization: plan.exactAuthorization,
      outputPath,
    });
  }
  if (options.has("output")) throw new Error("run does not accept --output.");
  const plan = normalizeReviewedDormantDescendantScopeRecoveryPlan(readPrivateContinuationJson(
    required(options, "plan"),
    "reviewed descendant recovery plan",
    { forbiddenRoots },
  ));
  if (options.has("ttl-seconds") && ttlSeconds !== plan.ttlSeconds) {
    throw new Error("Runtime TTL seconds must equal the plan-sealed TTL seconds.");
  }
  const adapter = createAdapter(required(options, "task-authority"));
  const controller = (dependencies.createController
    || createReviewedDormantDescendantScopeRecoveryController)({ adapter });
  const result = await controller.run({
    plan,
    operatorSessionId,
    authorization: required(options, "authorization"),
  });
  return Object.freeze({
    schema: "agentic-reviewed-dormant-descendant-scope-recovery-command/v1",
    status: "complete",
    result,
  });

  function createAdapter(taskAuthorityFile) {
    return (dependencies.createAdapter
      || createReviewedDormantDescendantScopeRecoveryRepositoryAdapter)({
      repository,
      sourceSessionId: required(options, "session"),
      pullRequestNumber: positive(required(options, "pull-request"), "pull request"),
      taskAuthorityFile,
      controllerRoot,
      journalPath: path.resolve(required(options, "journal")),
      forbiddenRoots,
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
      schema: "agentic-reviewed-dormant-descendant-scope-recovery-command/v1",
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
  const value = options.get(name);
  if (!value) throw new Error(`--${name}=<value> is required.`);
  return value;
}
function positive(value, label) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label} is invalid.`);
  return result;
}
function publicMessage(error) {
  return String(error?.message || error || "blocked")
    .replace(/(?:ghp|github_pat)_[A-Za-z0-9_]+/gu, "[redacted]").slice(0, 1_000);
}
function usage() {
  return "Usage: reviewed-dormant-descendant-scope-recovery.mjs plan|run "
    + "--repository=<worktree> --session=<source-session> --pull-request=<number> "
    + "--controller-root=<clean-main> --journal=<private-state> "
    + "--operator-session=<new-session> [--ttl-seconds=1800] "
    + "[--output=<private-plan>|--plan=<private-plan> --task-authority=<private-capability> "
    + "--authorization='authorize reviewed-dormant-descendant-scope-recovery <digest>']";
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = await runCli();
}
