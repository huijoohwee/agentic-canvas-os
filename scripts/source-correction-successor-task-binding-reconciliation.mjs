#!/usr/bin/env node
// Responsibility: Expose the plan/run interface for source-correction successor binding repair.
import { readFileSync } from "node:fs";
import path from "node:path";
import { createSourceCorrectionSuccessorTaskBindingReconciliationController }
  from "./source-correction-successor-task-binding-reconciliation-controller.mjs";
import { createRepositorySourceCorrectionSuccessorTaskBindingReconciliationAdapter }
  from "./source-correction-successor-task-binding-reconciliation-repository-adapter.mjs";

const [mode, ...argumentsList] = process.argv.slice(2);
const json = argumentsList.includes("--json");
try {
  if (!["plan", "run"].includes(mode)) usage();
  const repository = path.resolve(required("repository"));
  const adapter = createRepositorySourceCorrectionSuccessorTaskBindingReconciliationAdapter({
    repository,
    branch: required("branch"),
    pullRequestNumber: Number(required("pull-request")),
    sessionId: required("source-session"),
  });
  const controller = createSourceCorrectionSuccessorTaskBindingReconciliationController(adapter);
  const result = mode === "plan"
    ? controller.plan()
    : controller.run({
      plan: JSON.parse(readFileSync(path.resolve(required("plan-file")), "utf8")),
      authorization: required("authorize"),
      taskAuthorityFile: path.resolve(required("task-authority")),
    });
  process.stdout.write(`${JSON.stringify(result, null, json ? 0 : 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}

function option(name) {
  const prefix = `--${name}=`;
  return argumentsList.find(value => value.startsWith(prefix))?.slice(prefix.length) || null;
}
function required(name) {
  const value = option(name);
  if (!value) usage();
  return value;
}
function usage() {
  throw new Error(
    "Usage: source-correction-successor-task-binding-reconciliation.mjs plan|run "
    + "--repository=<root> --branch=<branch> --pull-request=<number> "
    + "--source-session=<id> [--plan-file=<json> --authorize=<exact> "
    + "--task-authority=<capability>] [--json]",
  );
}
