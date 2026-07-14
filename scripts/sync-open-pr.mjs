#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { assertNoCompetingPullRequests } from "./repository-guards.mjs";

const repo = requiredEnv("GITHUB_REPOSITORY");
const pulls = ghJson(["api", "--method", "GET", `repos/${repo}/pulls`, "-f", "state=open", "-f", "base=main", "-f", "sort=created", "-f", "direction=asc", "-f", "per_page=100"]);
if (pulls.length > 0) {
  assertNoCompetingPullRequests(
    pulls.map((candidate) => ({ number: candidate.number, headRefName: candidate.head?.ref })),
    pulls[0].head?.ref,
  );
}
const pull = pulls.find((candidate) =>
  !candidate.draft &&
  candidate.head?.repo?.full_name === repo &&
  candidate.labels?.some((label) => label.name === "automerge") &&
  !candidate.labels?.some((label) => label.name === "automerge/conflict")
);

if (!pull) {
  console.log("No eligible automerge PR needs synchronization.");
  process.exit(0);
}

const current = awaitMergeability(pull.number);
const number = current.number;
const headSha = current.head.sha;
const headRef = current.head.ref;
console.log(`Synchronizing PR #${number} (${headRef}@${headSha.slice(0, 12)}; state=${current.mergeable_state}).`);

if (current.mergeable_state === "dirty") {
  resolveKnownConflicts({ number, headRef, headSha });
} else if (current.mergeable_state === "behind") {
  const updated = gh(["api", "--method", "PUT", `repos/${repo}/pulls/${number}/update-branch`, "-f", `expected_head_sha=${headSha}`], { allowFailure: true });
  if (updated.status !== 0) {
    console.log("GitHub's update-branch API did not update the PR; falling back to a guarded local merge.");
    resolveKnownConflicts({ number, headRef, headSha });
  } else {
    console.log(`Requested an update of PR #${number} to current main.`);
  }
}

gh(["pr", "edit", String(number), "--remove-label", "automerge/conflict"], { allowFailure: true });
const auto = gh(["pr", "merge", String(number), "--repo", repo, "--auto", "--squash"], { allowFailure: true });
if (auto.status !== 0 && !/already.*auto-merge|auto-merge.*enabled/i.test(`${auto.stdout}\n${auto.stderr}`)) {
  throw new Error(`Could not enable auto-merge for PR #${number}: ${auto.stderr || auto.stdout}`);
}

function resolveKnownConflicts({ number, headRef, headSha }) {
  git(["config", "user.name", "github-actions[bot]"]);
  git(["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]);
  git(["fetch", "--no-tags", "origin", "main", headRef]);
  git(["checkout", "--detach", headSha]);
  const merge = git(["merge", "--no-edit", "origin/main"], { allowFailure: true });
  if (merge.status === 0) return pushMerge(number, headRef);

  const conflicts = gitText(["diff", "--name-only", "--diff-filter=U"])
    .trim().split("\n").filter(Boolean);
  const appendOnly = /^(memory|todo)\/\d{4}-\d{2}\.md$/;
  const allowed = conflicts.every((file) => appendOnly.test(file) || file === "package-lock.json");
  if (!allowed || conflicts.length === 0) {
    git(["merge", "--abort"], { allowFailure: true });
    block(number, `Automatic update stopped on semantic conflicts: ${conflicts.join(", ") || "unknown paths"}. Resolve them on the device branch and remove the \`automerge/conflict\` label.`);
    process.exit(0);
  }

  for (const file of conflicts.filter((name) => appendOnly.test(name))) {
    const base = gitBuffer(["show", `:1:${file}`]);
    const branch = gitBuffer(["show", `:2:${file}`]);
    const main = gitBuffer(["show", `:3:${file}`]);
    if (!startsWith(branch, base) || !startsWith(main, base)) {
      git(["merge", "--abort"], { allowFailure: true });
      block(number, `Append-only reconciliation rejected ${file}: one side changed committed history instead of appending.`);
      process.exit(0);
    }
    writeFileSync(file, Buffer.concat([main, branch.subarray(base.length)]));
    git(["add", "--", file]);
  }

  if (conflicts.includes("package-lock.json")) {
    git(["checkout", "--theirs", "--", "package-lock.json"]);
    git(["add", "--", "package-lock.json"]);
    run("npm", ["install", "--package-lock-only", "--ignore-scripts"]);
    git(["add", "--", "package-lock.json"]);
  }

  if (gitText(["diff", "--name-only", "--diff-filter=U"]).trim()) {
    throw new Error("Conflict resolver left unmerged paths.");
  }
  git(["commit", "--no-edit"]);
  pushMerge(number, headRef);
}

function pushMerge(number, headRef) {
  const pushed = git(["push", "origin", `HEAD:refs/heads/${headRef}`], { allowFailure: true });
  if (pushed.status !== 0) {
    block(number, "The device branch advanced while CI was reconciling it. The next synchronization run will retry from the new head.");
    process.exit(0);
  }
  console.log(`Pushed a safe merge update to PR #${number}.`);
}

function block(number, message) {
  gh(["pr", "edit", String(number), "--repo", repo, "--add-label", "automerge/conflict"], { allowFailure: true });
  const marker = "<!-- agentic-automerge-conflict -->";
  const comments = ghJson(["api", "--method", "GET", `repos/${repo}/issues/${number}/comments`, "-f", "per_page=100"]);
  if (!comments.some((comment) => String(comment.body).includes(marker))) {
    gh(["pr", "comment", String(number), "--repo", repo, "--body", `${marker}\n${message}`]);
  }
  console.log(message);
}

function awaitMergeability(number) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const value = ghJson(["api", `repos/${repo}/pulls/${number}`]);
    if (value.mergeable !== null) return value;
    execFileSync("sleep", ["1"]);
  }
  throw new Error(`GitHub did not compute mergeability for PR #${number}.`);
}

function startsWith(value, prefix) {
  return value.length >= prefix.length && value.subarray(0, prefix.length).equals(prefix);
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function ghJson(args) {
  const result = gh(args);
  return JSON.parse(result.stdout || "null");
}

function gh(args, options = {}) {
  return run("gh", args, options);
}

function git(args, options = {}) {
  return run("git", args, options);
}

function gitText(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function gitBuffer(args) {
  return execFileSync("git", args);
}

function run(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result;
}
