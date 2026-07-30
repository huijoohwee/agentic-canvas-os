#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";

const apply = process.argv.includes("--apply");
const repo = ghText(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim();
const checks = ["test", "build", "docs-contract", "collaboration-integration", "cloud-collaboration"];
const ledgerRef = "refs/heads/agentic/collaboration-ledger";
const ledgerRulesetName = "Cloud collaboration ledger";

if (!apply) {
  console.log(`Dry run for ${repo}`);
  console.log("Would enforce app-bound strict checks, configure the protected fast-forward-only collaboration ledger, and preserve the disabled production boundary.");
  console.log("Run `npm run github:configure -- --apply` only after the workflows and ledger ref exist on origin/main.");
  process.exit(0);
}

const workflow = gh(["api", `repos/${repo}/contents/.github/workflows/ci.yml?ref=main`], { allowFailure: true });
if (workflow.status !== 0) {
  throw new Error("Refusing to protect unpublished check names. Merge .github/workflows/ci.yml to origin/main first.");
}
const cloudWorkflow = gh(["api", `repos/${repo}/contents/.github/workflows/cloud-collaboration.yml?ref=main`], { allowFailure: true });
if (cloudWorkflow.status !== 0) {
  throw new Error("Refusing to protect the unpublished cloud-collaboration check.");
}
const ledger = gh(["api", `repos/${repo}/git/ref/heads/agentic/collaboration-ledger`], { allowFailure: true });
if (ledger.status !== 0) {
  throw new Error(`Refusing configuration until ${ledgerRef} has been seeded by the runtime.`);
}
const actionsAppId = resolveTrustedActionsAppId({ repo, checks });

ghJson("PATCH", `repos/${repo}`, {
  allow_auto_merge: true,
  allow_update_branch: true,
  delete_branch_on_merge: true,
  allow_squash_merge: true,
  allow_merge_commit: false,
  allow_rebase_merge: false,
});

for (const [name, color, description] of [
  ["automerge", "0e8a16", "Eligible for protected serialized auto-merge"],
  ["automerge/conflict", "b60205", "Automatic reconciliation stopped; manual resolution required"],
]) {
  gh(["label", "create", name, "--repo", repo, "--color", color, "--description", description, "--force"]);
}

ghJson("PUT", `repos/${repo}/branches/main/protection`, {
  required_status_checks: {
    strict: true,
    checks: checks.map((context) => ({ context, app_id: actionsAppId })),
  },
  enforce_admins: true,
  required_pull_request_reviews: {
    dismiss_stale_reviews: false,
    // A solo owner cannot approve their own PR. CODEOWNERS still routes file
    // ownership, while strict required checks and the single-PR guard provide
    // the enforceable integration gate.
    require_code_owner_reviews: false,
    require_last_push_approval: false,
    required_approving_review_count: 0,
  },
  restrictions: null,
  required_linear_history: true,
  allow_force_pushes: false,
  allow_deletions: false,
  block_creations: false,
  required_conversation_resolution: true,
  lock_branch: false,
  allow_fork_syncing: true,
});

upsertLedgerRuleset({ repo, name: ledgerRulesetName });

ghJson("PUT", `repos/${repo}/environments/production`, {
  wait_timer: 0,
  reviewers: [],
  deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
});

const variable = gh(["api", `repos/${repo}/actions/variables/PROD_DEPLOY_ENABLED`], { allowFailure: true });
if (variable.status !== 0) {
  ghJson("POST", `repos/${repo}/actions/variables`, { name: "PROD_DEPLOY_ENABLED", value: "false" });
}

console.log(`Configured ${repo} with app-bound checks and ${ledgerRulesetName}. Production deployment remains disabled until PROD_DEPLOY_ENABLED is explicitly set to true.`);

function resolveTrustedActionsAppId({ repo, checks: requiredChecks }) {
  const response = ghValue([
    "api",
    "--method",
    "GET",
    `repos/${repo}/commits/main/check-runs`,
    "-f",
    "per_page=100",
  ]);
  const observed = new Map();
  for (const run of response.check_runs || []) {
    if (!requiredChecks.includes(run.name) || observed.has(run.name)) continue;
    if (run.conclusion !== "success" || run.app?.slug !== "github-actions" ||
        !Number.isInteger(Number(run.app?.id))) continue;
    observed.set(run.name, Number(run.app.id));
  }
  const missing = requiredChecks.filter((name) => !observed.has(name));
  if (missing.length) {
    throw new Error(`Trusted successful main checks are missing: ${missing.join(", ")}.`);
  }
  const appIds = new Set(observed.values());
  if (appIds.size !== 1) throw new Error("Required checks do not share one trusted GitHub Actions app id.");
  return [...appIds][0];
}

function upsertLedgerRuleset({ repo, name }) {
  const ruleset = {
    name,
    target: "branch",
    enforcement: "active",
    bypass_actors: [],
    conditions: {
      ref_name: {
        include: [ledgerRef],
        exclude: [],
      },
    },
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
    ],
  };
  const existing = ghValue(["api", "--method", "GET", `repos/${repo}/rulesets`])
    .find((candidate) => candidate.name === name);
  if (existing) {
    ghJson("PUT", `repos/${repo}/rulesets/${existing.id}`, ruleset);
    return;
  }
  ghJson("POST", `repos/${repo}/rulesets`, ruleset);
}

function ghJson(method, endpoint, body) {
  const input = JSON.stringify(body);
  execFileSync("gh", ["api", "--method", method, endpoint, "--input", "-"], { input, stdio: ["pipe", "inherit", "inherit"] });
}

function ghText(args) {
  return execFileSync("gh", args, { encoding: "utf8" });
}

function ghValue(args) {
  return JSON.parse(ghText(args));
}

function gh(args, { allowFailure = false } = {}) {
  const result = spawnSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (!allowFailure && result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result;
}
