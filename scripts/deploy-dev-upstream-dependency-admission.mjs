import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: options.capture ? "utf8" : undefined,
    stdio: options.capture ? "pipe" : "inherit",
    env: options.env || process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status ?? 1}.`);
  }
  return options.capture ? result.stdout.trim() : "";
}

export function buildDevUpstreamDependencyAdmissionDeployArgs(revision) {
  if (!/^[0-9a-f]{40}$/.test(String(revision))) {
    throw new Error("A full 40-character canonical revision is required.");
  }
  return Object.freeze([
    "exec",
    "--",
    "wrangler",
    "deploy",
    "--env",
    "dev",
    "--keep-vars",
    "--strict",
    "--message",
    `upstream-dependency-admission:${revision}`,
  ]);
}

export function assertExactCanonicalMain() {
  if (run("git", ["status", "--porcelain"], { capture: true })) {
    throw new Error("Dev deployment requires a clean worktree.");
  }
  if (run("git", ["branch", "--show-current"], { capture: true }) !== "main") {
    throw new Error("Dev deployment requires the canonical main branch.");
  }
  run("git", ["fetch", "origin", "main", "--quiet"]);
  const head = run("git", ["rev-parse", "HEAD"], { capture: true });
  const upstream = run("git", ["rev-parse", "origin/main"], { capture: true });
  if (head !== upstream) {
    throw new Error("Dev deployment requires HEAD to equal origin/main.");
  }
  return head;
}

export function deployDevUpstreamDependencyAdmission(env = process.env) {
  const revision = assertExactCanonicalMain();
  run("npm", ["run", "upstream-dependency-admission:application:check"], { env });
  run("npm", buildDevUpstreamDependencyAdmissionDeployArgs(revision), { env });
  return revision;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  deployDevUpstreamDependencyAdmission();
}
