#!/usr/bin/env node
// Responsibility: Expose explicit plan/run entrypoints for same-claim dormant reviewed continuation.
import { readFileSync } from "node:fs";
import path from "node:path";
import { createSameClaimDormantReviewedContinuationController } from "./same-claim-dormant-reviewed-continuation-controller.mjs";
import { createRepositorySameClaimDormantReviewedContinuationAdapter } from "./same-claim-dormant-reviewed-continuation-repository-adapter.mjs";

const args = process.argv.slice(2); const command = args.shift(); const json = args.includes("--json");
try {
  if (!new Set(["plan", "run"]).has(command)) throw new Error("Expected plan or run.");
  const allowed = new Set(["json", "repository", "authority-repository", "pull-request", "authority-session", "ttl-seconds", "plan-file", "authorize", "task-authority"]);
  for (const value of args) { const name = value.replace(/^--/u, "").split("=")[0]; if (!allowed.has(name)) throw new Error(`Unsupported option: ${value}`); }
  const adapter = createRepositorySameClaimDormantReviewedContinuationAdapter({ repository: option("repository"), authorityRepository: option("authority-repository") || process.cwd(), pullRequestNumber: Number(option("pull-request")), authoritySessionId: option("authority-session"), ttlSeconds: Number(option("ttl-seconds") || 1800) });
  const controller = createSameClaimDormantReviewedContinuationController(adapter);
  const result = command === "plan" ? controller.plan() : controller.run({ plan: JSON.parse(readFileSync(path.resolve(required(option("plan-file"), "plan-file")), "utf8")), authorization: required(option("authorize"), "authorize"), taskAuthorityFile: path.resolve(required(option("task-authority"), "task-authority")) });
  process.stdout.write(`${JSON.stringify(result, null, json ? 0 : 2)}\n`);
} catch (error) { if (!json) throw error; process.stdout.write(`${JSON.stringify({ ok: false, status: "error", sourceMutation: false, pullRequestMutation: false, gitRefMutation: false, mergeMutation: false, integrationMutation: false, deployMutation: false, error: { code: "same_claim_dormant_reviewed_continuation_failed", message: error instanceof Error ? error.message : String(error) } })}\n`); process.exitCode = 1; }
function option(name) { const prefix = `--${name}=`; return args.find(value => value.startsWith(prefix))?.slice(prefix.length).trim() || ""; }
function required(value, label) { if (!value) throw new Error(`--${label} is required.`); return value; }
