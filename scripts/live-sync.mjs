#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { assertMainWorktree } from "./repository-guards.mjs";

const RESULT_SCHEMA = "agentic-live-sync-result/v1";
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const args = process.argv.slice(2);
const watch = args.includes("--watch");
const json = args.includes("--json");
let expectedOriginHead = "";
let requiredOriginAncestor = "";
const intervalArg = args.find((arg) => arg.startsWith("--interval="));
const intervalSeconds = Math.max(5, Math.min(300, Number(intervalArg?.split("=")[1] || 20)));
let root = "";

try {
  expectedOriginHead = readOption("expected-origin-head");
  requiredOriginAncestor = readOption("required-origin-ancestor");
  requireOptionalSha(expectedOriginHead, "Expected origin/main HEAD");
  requireOptionalSha(requiredOriginAncestor, "Required origin/main ancestor");
  if (expectedOriginHead && requiredOriginAncestor) {
    throw new Error("--expected-origin-head and --required-origin-ancestor are mutually exclusive.");
  }
  root = gitText(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
  emit(await syncOnce());
  if (watch) {
    if (!json) console.log(`Watching origin/main every ${intervalSeconds}s. Stop with Ctrl-C.`);
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
      emit(await syncOnce());
    }
  }
} catch (error) {
  if (!json) throw error;
  process.stdout.write(`${JSON.stringify(withDigest({
    schema: RESULT_SCHEMA,
    status: "error",
    expectedOriginHead: expectedOriginHead || null,
    requiredOriginAncestor: requiredOriginAncestor || null,
    error: {
      name: boundedText(error?.name || "Error", 80),
      message: boundedText(error?.message || String(error), 1_024),
    },
  }))}\n`);
  process.exitCode = 1;
}

async function syncOnce() {
  assertMainWorktree({
    cwd: root,
    porcelain: gitText(root, ["worktree", "list", "--porcelain", "-z"]),
  });

  run(root, "git", ["fetch", "--quiet", "origin", "main"]);
  const branch = gitText(root, ["branch", "--show-current"]).trim();
  if (branch !== "main") throw new Error(`Live sync updates canonical main only; current branch is ${branch || "detached"}`);
  const status = gitText(root, ["status", "--porcelain"]).trim();
  if (status) {
    throw new Error(`Canonical checkout is dirty; commit or restore the owned changes before live sync: ${root}`);
  }
  const before = gitText(root, ["rev-parse", "HEAD"]).trim();
  const after = gitText(root, ["rev-parse", "origin/main"]).trim();
  requireSha(before, "Canonical checkout HEAD");
  requireSha(after, "Fetched origin/main HEAD");
  if (expectedOriginHead && after !== expectedOriginHead) {
    throw new Error(
      `Fetched origin/main ${after} differs from the exact expected head ${expectedOriginHead}; canonical fast-forward refused.`,
    );
  }
  if (requiredOriginAncestor) assertAncestor(root, requiredOriginAncestor, after);
  if (before === after) {
    const integrated = gitText(root, ["rev-parse", "HEAD"]).trim();
    if (integrated !== after || gitText(root, ["status", "--porcelain"]).trim()) {
      throw new Error(`Canonical checkout did not retain the exact pinned main object ${after}.`);
    }
    return liveSyncReceipt({ status: "current", before, after, integrated });
  }
  run(root, "git", ["merge", "--ff-only", after]);
  const integrated = gitText(root, ["rev-parse", "HEAD"]).trim();
  if (integrated !== after || gitText(root, ["status", "--porcelain"]).trim()) {
    throw new Error(`Canonical checkout did not integrate the exact pinned main object ${after}.`);
  }
  return liveSyncReceipt({ status: "updated", before, after, integrated });
}

function liveSyncReceipt({ status, before, after, integrated }) {
  return withDigest({
    schema: RESULT_SCHEMA,
    status,
    expectedOriginHead: expectedOriginHead || null,
    requiredOriginAncestor: requiredOriginAncestor || null,
    beforeSha: before,
    originHeadSha: after,
    integratedSha: integrated,
  });
}

function emit(receipt) {
  if (json) {
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  } else if (receipt.status === "updated") {
    console.log(
      `Canonical checkout updated ${receipt.beforeSha.slice(0, 12)} -> ${receipt.originHeadSha.slice(0, 12)}.`,
    );
  }
}

function gitText(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout;
}

function run(cwd, command, args) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: json ? ["ignore", "ignore", "inherit"] : "inherit",
  });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
}

function assertAncestor(cwd, ancestor, descendant) {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
    cwd,
    encoding: "utf8",
  });
  if (result.status === 0) return;
  if (result.status === 1) {
    throw new Error(
      `Fetched origin/main ${descendant} does not descend from required origin ancestor ${ancestor}; ` +
      "canonical fast-forward refused.",
    );
  }
  throw new Error(result.stderr || result.stdout || "Unable to verify the required origin/main ancestor.");
}

function readOption(name) {
  const prefix = `--${name}=`;
  const matches = args.filter(value => value.startsWith(prefix));
  if (matches.length > 1) throw new Error(`--${name} must be supplied at most once.`);
  return matches.length ? matches[0].slice(prefix.length).trim() : "";
}

function requireOptionalSha(value, label) {
  if (value && !SHA_PATTERN.test(value)) throw new Error(`${label} must be an exact commit SHA.`);
}

function requireSha(value, label) {
  if (!SHA_PATTERN.test(value)) throw new Error(`${label} must be an exact commit SHA.`);
  return value;
}

function withDigest(value) {
  return Object.freeze({ ...value, receiptDigest: digestValue(value) });
}

function boundedText(value, maximumLength) {
  return String(value || "").slice(0, maximumLength);
}
