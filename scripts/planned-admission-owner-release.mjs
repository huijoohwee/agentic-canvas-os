#!/usr/bin/env node
// Responsibility: Expose read-only planning and exact-authorized execution.
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRepositoryAdapter } from "./planned-admission-owner-release-repository-adapter.mjs";
import { planPlannedAdmissionOwnerRelease, runPlannedAdmissionOwnerRelease } from "./planned-admission-owner-release-controller.mjs";

const [action, ...args] = process.argv.slice(2);
const json = args.includes("--json");
try {
  if (!new Set(["plan", "run"]).has(action)) throw new Error("Action must be plan or run.");
  const adapter = createRepositoryAdapter({ repository: required("repository"),
    preservedWorktree: required("preserved-worktree"), staleBranch: required("stale-branch"),
    pullRequestNumber: Number(required("pull-request")), ledgerRepository: option("ledger-repository"),
    targetRepository: option("target-repository") });
  const result = action === "plan"
    ? await planPlannedAdmissionOwnerRelease({ adapter })
    : await runPlannedAdmissionOwnerRelease({ adapter, plan: readJson(required("plan")), authorization: required("authorization") });
  process.stdout.write(`${JSON.stringify({ schema: "agentic-planned-admission-owner-release-result/v1",
    ok: true, action, status: action === "plan" ? "planned" : "completed", result }, null, json ? 0 : 2)}\n`);
} catch (error) {
  const result = { schema: "agentic-planned-admission-owner-release-result/v1", ok: false, action: action || null,
    status: "error", error: { code: "planned_admission_owner_release_failed", message: String(error?.message || error).slice(0, 500) } };
  if (!json) throw error; process.stdout.write(`${JSON.stringify(result)}\n`); process.exitCode = 1;
}
function option(name) { const prefix = `--${name}=`; return args.find(item => item.startsWith(prefix))?.slice(prefix.length); }
function required(name) { const value = option(name); if (!value) throw new Error(`--${name}=<value> is required.`); return value; }
function readJson(file) { return JSON.parse(readFileSync(path.resolve(file), "utf8")); }
