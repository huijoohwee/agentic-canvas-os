#!/usr/bin/env node

import { realpathSync } from "node:fs";
import path from "node:path";

import {
  buildActiveOwnedDirtRecoveryPlan,
  normalizeActiveOwnedDirtRecoveryPlan,
} from "./active-owned-dirt-recovery-contract.mjs";
import {
  createRepositoryActiveOwnedDirtRecoveryAdapter,
  runActiveOwnedDirtRecovery,
} from "./active-owned-dirt-recovery-controller.mjs";

const [command = "plan", ...args] = process.argv.slice(2);
const json = args.includes("--json");

try {
  if (!["plan", "execute"].includes(command)) usage();
  const repository = realpathSync(path.resolve(requiredOption("repository")));
  const sessionId = requiredOption("session");
  const ttlSeconds = option("ttl-seconds") === null
    ? 1_800
    : boundedTtl(option("ttl-seconds"));
  const adapter = createRepositoryActiveOwnedDirtRecoveryAdapter({
    repository,
    sessionId,
    ttlSeconds,
  });
  let result;
  if (command === "plan") {
    const state = await adapter.readState();
    const plan = state.intent?.planSnapshot
      ? normalizeActiveOwnedDirtRecoveryPlan(state.intent.planSnapshot)
      : buildActiveOwnedDirtRecoveryPlan({ source: state.source, ttlSeconds });
    result = Object.freeze({
      schema: "agentic-active-owned-dirt-recovery-plan-result/v1",
      status: "planned",
      plan,
      exactAuthorization: `authorize active-owned-dirt-reclaim ${plan.planDigest}`,
    });
  } else {
    result = await runActiveOwnedDirtRecovery({
      authorization: option("authorize"),
    }, { adapter });
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  const message = publicMessage(error);
  const result = {
    schema: "agentic-active-owned-dirt-recovery-result/v1",
    status: "blocked",
    error: message,
  };
  if (json) process.stdout.write(`${JSON.stringify(result)}\n`);
  else process.stderr.write(`[active-owned-dirt-recovery] ${message}\n`);
  process.exitCode = 1;
}

function publicMessage(error) {
  if (error && typeof error === "object"
    && ("stderr" in error || "stdout" in error || "status" in error)) {
    return "Recovery subprocess failed.";
  }
  return String(error?.message || error || "Recovery failed.")
    .replace(/(?:gh[pousr]|github_pat)_[A-Za-z0-9_]+/gu, "[redacted]")
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/giu, "$1[redacted]@")
    .replace(/\/(?:Users|home)\/[^\s"']+/gu, "[local-path]")
    .replace(/[A-Za-z]:\\Users\\[^\s"']+/gu, "[local-path]")
    .slice(0, 300);
}

function option(name) {
  const prefix = `--${name}=`;
  const argument = args.find(value => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : null;
}

function requiredOption(name) {
  const value = option(name);
  if (!value) throw new Error(`--${name}=... is required.`);
  return value;
}

function boundedTtl(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 60 || parsed > 86_400) {
    throw new Error("--ttl-seconds must be an integer from 60 through 86400.");
  }
  return parsed;
}

function usage() {
  throw new Error(
    "Usage: active-owned-dirt-recovery.mjs plan|execute --repository=<path> --session=<source-session> [--ttl-seconds=1800] [--authorize=<exact text>] [--json]",
  );
}
