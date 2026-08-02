#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { sanitizeDevice, sanitizeScope } from "./device-branch-identity.mjs";
import {
  evaluateScopedLaneAdmission,
  normalizeCloudAuthority,
  normalizeDeclaredWriteScopeManifest,
} from "./scoped-lane-admission-lib.mjs";
import { verifyAdmissionCloudAuthority } from "./scoped-lane-cloud-authority.mjs";
import {
  attachAdmissionReceipt,
  collectScopedLaneState,
} from "./scoped-lane-admission-state.mjs";
import { inspectTaskWorktreeTarget } from "./task-worktree-provision.mjs";

const [rawMode, ...argumentsList] = process.argv.slice(2);
const json = argumentsList.includes("--json");

try {
  if (!["plan", "check"].includes(rawMode)) usage();
  const repository = path.resolve(
    option("repository") || process.env.AGENTIC_TARGET_REPOSITORY || process.cwd(),
  );
  const scope = sanitizeScope(requiredOption("scope"));
  const targetPath = path.resolve(requiredOption("worktree"));
  const manifestPath = path.resolve(requiredOption("write-scope-manifest"));
  const manifest = normalizeDeclaredWriteScopeManifest(
    readJson(manifestPath, "declared write-scope manifest"),
    { expectedScope: scope },
  );
  const snapshot = collectScopedLaneState({ repository });
  const canonicalLane = snapshot.lanes.filter(
    lane => lane.branch === "refs/heads/main",
  );
  if (canonicalLane.length !== 1) {
    throw new Error(`Expected one registered canonical main worktree; found ${canonicalLane.length}.`);
  }
  const canonicalPath = canonicalLane[0].path;
  const target = withWorkingDirectory(canonicalPath, () => (
    inspectTaskWorktreeTarget({
      invocationPath: canonicalPath,
      repoRoot: canonicalPath,
      targetPath,
      gitText,
    })
  ));
  const device = sanitizeDevice(
    gitOptional(canonicalPath, ["config", "--get", "agentic.device"])
    || os.hostname(),
  );
  const branch = `agent/${device}/${scope}`;
  let cloudAuthority = null;
  let remoteAuthorityVerification = null;
  if (rawMode === "check") {
    const authorityPath = path.resolve(requiredOption("cloud-authority"));
    const source = readJson(authorityPath, "cloud authority");
    cloudAuthority = normalizeCloudAuthority(source, {
      ledgerRepository: option("ledger-repository")
        || process.env.AGENTIC_LEDGER_REPOSITORY
        || "huijoohwee/agentic-canvas-os",
      targetRepository: option("target-repository")
        || gitHubRepository(canonicalPath),
      manifest,
      canonicalBaseSha: snapshot.canonicalBaseSha,
    });
    const verified = verifyAdmissionCloudAuthority({
      authority: cloudAuthority,
      manifest,
      canonicalBaseSha: snapshot.canonicalBaseSha,
    });
    cloudAuthority = verified.authority;
    remoteAuthorityVerification = verified.verification;
  }
  let report = evaluateScopedLaneAdmission({
    repository,
    canonicalPath,
    canonicalBaseSha: snapshot.canonicalBaseSha,
    targetPath: target.target,
    branch,
    semanticScope: scope,
    targetSafe: true,
    manifest,
    lanes: snapshot.lanes,
    cloudAuthority,
    remoteAuthorityRequired: rawMode === "check",
    remoteAuthorityVerification,
    mode: rawMode,
  });
  if (rawMode === "check" && report.authoringAdmission.status === "planned") {
    report = attachAdmissionReceipt({
      report,
      targetObservationDigest: target.targetObservationDigest,
      remoteAuthorityVerification,
    });
  }
  process.stdout.write(`${JSON.stringify(report, null, json ? 0 : 2)}\n`);
  if (report.authoringAdmission.status === "blocked") process.exitCode = 1;
} catch (error) {
  const output = {
    schema: "agentic-lane-admission-error/v1",
    ok: false,
    mode: rawMode || null,
    status: "error",
    error: {
      code: "lane_admission_failed",
      message: publicMessage(error),
    },
  };
  if (!json) throw error;
  process.stdout.write(`${JSON.stringify(output)}\n`);
  process.exitCode = 2;
}

function requiredOption(name) {
  const value = option(name);
  if (!value) throw new Error(`--${name}=<value> is required.`);
  return value;
}

function option(name) {
  const prefix = `--${name}=`;
  const inline = argumentsList.find(value => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = argumentsList.indexOf(`--${name}`);
  return index >= 0 ? argumentsList[index + 1] : "";
}

function readJson(file, label) {
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${label} must be a JSON object.`);
    }
    return value;
  } catch (error) {
    throw new Error(`Could not read ${label} at ${file}: ${publicMessage(error)}`);
  }
}

function gitText(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function gitOptional(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

function gitHubRepository(cwd) {
  const result = execFileSync("gh", [
    "repo",
    "view",
    "--json",
    "nameWithOwner",
    "--jq",
    ".nameWithOwner",
  ], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (!result) throw new Error("Could not resolve the target GitHub repository.");
  return result;
}

function withWorkingDirectory(directory, action) {
  const previous = process.cwd();
  process.chdir(directory);
  try {
    return action();
  } finally {
    process.chdir(previous);
  }
}

function publicMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(?:ghp|github_pat)_[A-Za-z0-9_]+/gu, "[redacted]")
    .replace(/\/(?:Users|home)\/[^\s"']+/gu, "[local-path]")
    .slice(0, 500);
}

function usage() {
  throw new Error(
    "Usage: scoped-lane-admission.mjs <plan|check> --scope=<semantic-scope> --repository=<canonical-root> --worktree=<new-path> --write-scope-manifest=<json> [--cloud-authority=<json> --ledger-repository=<owner/repo> --target-repository=<owner/repo>] [--json]",
  );
}
