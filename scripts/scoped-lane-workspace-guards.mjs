import { existsSync, lstatSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

import { digestValue } from "./cloud-collaboration-primitives.mjs";

const REQUIRED_HOOKS = Object.freeze([
  "git-guarded",
  "pre-commit",
  "pre-push",
  "reference-transaction",
]);

export function assertWorkspaceGuardsReady({
  repository,
  controllerRoot = repository,
  git = runGit,
  pathExists = existsSync,
  pathStat = lstatSync,
  readFile = readFileSync,
} = {}) {
  const root = path.resolve(repository || process.cwd());
  let configured = "";
  try {
    configured = git(root, ["config", "--get", "core.hooksPath"]).trim();
  } catch {
    configured = "";
  }
  if (!configured) {
    throw new Error(
      "Workspace guards are not ready: core.hooksPath is unset; run the repository-owned workspace guard installer.",
    );
  }
  const expectedHooksRoot = path.resolve(controllerRoot, ".githooks");
  const configuredHooksRoot = path.isAbsolute(configured)
    ? path.resolve(configured)
    : path.resolve(root, configured);
  if (configuredHooksRoot !== expectedHooksRoot) {
    throw new Error(
      "Workspace guards are not ready: core.hooksPath must reference the canonical controller hook source.",
    );
  }
  for (const hook of REQUIRED_HOOKS) {
    const hookPath = path.join(expectedHooksRoot, hook);
    const configuredHookPath = path.join(configuredHooksRoot, hook);
    if (
      !pathExists(hookPath)
      || !pathExists(configuredHookPath)
      || (pathStat(configuredHookPath).mode & 0o111) === 0
      || digestValue(readFile(configuredHookPath, "utf8"))
        !== digestValue(readFile(hookPath, "utf8"))
    ) {
      throw new Error(
        `Workspace guards are not ready: ${configuredHookPath} is missing, non-executable, or differs from the controller source; run the repository-owned workspace guard installer.`,
      );
    }
  }
  return Object.freeze({
    schema: "agentic-workspace-guard-readiness/v1",
    status: "ready",
    hooksPath: configuredHooksRoot,
  });
}

function runGit(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}
