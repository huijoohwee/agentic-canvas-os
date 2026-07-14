#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";

const apply = process.argv.includes("--apply");
const repo = ghText(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim();
const checks = ["CI / test", "CI / build", "CI / docs-contract", "CI / collaboration-integration"];

if (!apply) {
  console.log(`Dry run for ${repo}`);
  console.log("Would enable auto-merge, branch updates, squash-only merges, branch deletion, CODEOWNERS routing, conversation resolution, strict CI checks, and the production environment.");
  console.log("Run `npm run github:configure -- --apply` after these workflow files are present on origin/main.");
  process.exit(0);
}

const workflow = gh(["api", `repos/${repo}/contents/.github/workflows/ci.yml?ref=main`], { allowFailure: true });
if (workflow.status !== 0) {
  throw new Error("Refusing to protect unpublished check names. Merge .github/workflows/ci.yml to origin/main first.");
}

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
  required_status_checks: { strict: true, contexts: checks },
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

ghJson("PUT", `repos/${repo}/environments/production`, {
  wait_timer: 0,
  reviewers: [],
  deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
});

const variable = gh(["api", `repos/${repo}/actions/variables/PROD_DEPLOY_ENABLED`], { allowFailure: true });
if (variable.status !== 0) {
  ghJson("POST", `repos/${repo}/actions/variables`, { name: "PROD_DEPLOY_ENABLED", value: "false" });
}

console.log(`Configured ${repo}. Production deployment remains disabled until PROD_DEPLOY_ENABLED is explicitly set to true.`);

function ghJson(method, endpoint, body) {
  const input = JSON.stringify(body);
  execFileSync("gh", ["api", "--method", method, endpoint, "--input", "-"], { input, stdio: ["pipe", "inherit", "inherit"] });
}

function ghText(args) {
  return execFileSync("gh", args, { encoding: "utf8" });
}

function gh(args, { allowFailure = false } = {}) {
  const result = spawnSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (!allowFailure && result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result;
}
