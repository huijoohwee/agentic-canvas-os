#!/usr/bin/env node
// Responsibility: Expose exact plan/run commands for planned-marker terminal reconciliation.
import { createRepositoryAdapter } from "./planned-recovery-pr-marker-reconciliation-repository-adapter.mjs";
import { planReconciliation, runReconciliation } from "./planned-recovery-pr-marker-reconciliation-controller.mjs";

const args = process.argv.slice(2), action = args.shift();
const option = name => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
try {
  const adapter = createRepositoryAdapter({ repository: required("repository"),
    sourceWorktree: required("source-worktree") });
  const sessionId = required("session");
  const operatorDecisionDigest = required("operator-decision-digest");
  const plan = await planReconciliation({ adapter, sessionId, operatorDecisionDigest });
  if (action === "plan") process.stdout.write(`${JSON.stringify({ schema: "agentic-planned-recovery-pr-marker-reconciliation-result/v1", status: "planned", planDigest: plan.planDigest, exactAuthorization: plan.exactAuthorization, plan })}\n`);
  else if (action === "run") process.stdout.write(`${JSON.stringify(await runReconciliation({ adapter, plan,
    authorization: required("authorize") }))}\n`);
  else throw new Error("Usage: planned-recovery-pr-marker-reconciliation.mjs plan|run --repository=<root> --source-worktree=<path> --session=<id> --operator-decision-digest=<digest> [--authorize=<exact-text>]");
} catch (error) {
  process.stdout.write(`${JSON.stringify({ schema: "agentic-planned-recovery-pr-marker-reconciliation-result/v1", status: "blocked", error: String(error?.message || error) })}\n`);
  process.exitCode = 1;
}
function required(name) { const value = option(name); if (!value) throw new Error(`--${name}=<value> is required.`); return value; }
