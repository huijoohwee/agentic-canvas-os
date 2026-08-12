#!/usr/bin/env node
// Responsibility: Expose same-session planned clean-committed cloud recovery.
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { textCommandOptions } from "./command-text-options.mjs";
import { recoverPlannedCleanCommitted } from "./planned-clean-committed-recovery-lib.mjs";
import { createWriterLeaseStore, DEFAULT_WRITER_LEASE_TTL_MS } from "./writer-lease-lib.mjs";
const args = process.argv.slice(2), json = args.includes("--json");
const invocationPath = path.resolve(option("repository") || process.cwd());
const sessionId = option("session") || process.env.AGENTIC_SESSION_ID || "";
const ttlSeconds = Number(option("ttl-seconds") || DEFAULT_WRITER_LEASE_TTL_MS / 1_000);
let repo = null;
try {
  const unknown = args.filter(value => value !== "--json" && !value.startsWith("--repository=")
    && !value.startsWith("--session=") && !value.startsWith("--ttl-seconds="));
  if (unknown.length) throw new Error(`Unsupported recovery option: ${unknown[0]}`);
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 86_400) {
    throw new Error("--ttl-seconds must be between 60 and 86400 seconds.");
  }
  process.chdir(invocationPath);
  repo = gitText(["rev-parse", "--show-toplevel"]).trim();
  const common = path.resolve(repo, gitText(["rev-parse", "--git-common-dir"]).trim());
  const result = recoverPlannedCleanCommitted({ invocationPath, repo, gitText, gitOptional, ghText,
    leaseStore: createWriterLeaseStore({ gitCommonDir: common }), sessionId,
    leaseTtlMs: ttlSeconds * 1_000, run });
  console.log(JSON.stringify(result));
} catch (error) {
  const result = { schema: "agentic-planned-clean-committed-recovery-result/v1", ok: false,
    status: "error", deployment: false, repoRoot: repo,
    error: { code: "planned_clean_committed_recovery_failed", message: String(error?.message || error).slice(0, 500) } };
  if (json) console.log(JSON.stringify(result)); else console.error(result.error.message);
  process.exitCode = 1;
}
function option(name) { const prefix = `--${name}=`; return args.find(value => value.startsWith(prefix))?.slice(prefix.length).trim() || ""; }
function gitText(commandArgs) { return execFileSync("git", commandArgs, textCommandOptions()); }
function gitOptional(commandArgs) { const result = spawnSync("git", commandArgs, textCommandOptions()); return result.status === 0 ? result.stdout.trim() : ""; }
function ghText(commandArgs) { return execFileSync("gh", commandArgs, textCommandOptions()); }
function run(command, commandArgs) { const result = spawnSync(command, commandArgs, { stdio: json ? ["ignore", "ignore", "inherit"] : "inherit" }); if (result.status !== 0) throw new Error(`${command} ${commandArgs.join(" ")} failed`); }
