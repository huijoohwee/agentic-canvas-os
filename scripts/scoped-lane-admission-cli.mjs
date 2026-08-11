// Responsibility: Provide CLI-only repository and public-error adapters.
import { execFileSync } from "node:child_process";

export function ghText(args) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function gitHubRepository(cwd) {
  const result = execFileSync("gh", [
    "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner",
  ], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (!result) throw new Error("Could not resolve the target GitHub repository.");
  return result;
}

export function withWorkingDirectory(directory, action) {
  const previous = process.cwd();
  process.chdir(directory);
  try {
    return action();
  } finally {
    process.chdir(previous);
  }
}

export function publicMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(?:ghp|github_pat)_[A-Za-z0-9_]+/gu, "[redacted]")
    .replace(/\/(?:Users|home)\/[^\s"']+/gu, "[local-path]")
    .slice(0, 500);
}

export function scopedLaneAdmissionUsage() {
  throw new Error(
    "Usage: scoped-lane-admission.mjs <plan|check|recover|bootstrap> --scope=<semantic-scope> --repository=<canonical-root> --worktree=<path> --write-scope-manifest=<json> [--cloud-authority=<json> --ledger-repository=<owner/repo> --target-repository=<owner/repo> --root-source-bootstrap=<json>|--root-source-bootstrap-file=<json> --maintenance-source=<path> --maintenance-manifest-output=<json> [--preserve=<comma-separated-worktree-paths>]] [--session=<id>] [--json]",
  );
}
