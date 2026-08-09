// Responsibility: Verify device CLI machine output and admission-gate ordering.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  TEXT_COMMAND_MAX_BUFFER_BYTES,
  textCommandOptions,
} from "../scripts/command-text-options.mjs";

const script = path.resolve("scripts/device-branch.mjs");

test("dormant preservation authorization is revalidated before provisioning", () => {
  const source = readFileSync(script, "utf8");
  const verify = source.indexOf("dormantGate.verify(");
  const admission = source.indexOf("admissionReport = evaluateScopedLaneAdmission(");
  const lock = source.indexOf("admissionLeaseStore.withRegistryLock(");
  const revalidate = source.indexOf("dormantGate.revalidate(");
  const provision = source.indexOf("return provisionTaskWorktree(");
  const continuationGate = source.indexOf("const continuationGate =");
  const continuation = source.indexOf("admissionContinuation = continuePlannedAdmissionFromRepository(");
  const injectedVerifier = source.indexOf("verifyDormant: continuationGate?.verifyDormant");
  const injectedCloudVerifier = source.indexOf("verifyCloudAuthority: continuationGate?.verifyCloudAuthority");

  assert.ok(verify >= 0 && verify < admission);
  assert.ok(admission < lock && lock < revalidate);
  assert.ok(revalidate < provision);
  assert.ok(continuationGate >= 0 && continuationGate < continuation);
  assert.ok(continuation < injectedVerifier);
  assert.ok(injectedVerifier < injectedCloudVerifier);
});

test("text commands retain integration evidence larger than Node's default buffer", () => {
  const outputBytes = 2 * 1024 * 1024;
  const output = execFileSync(process.execPath, [
    "-e",
    'process.stdout.write("x".repeat(Number(process.argv[1])))',
    String(outputBytes),
  ], textCommandOptions());

  assert.equal(output.length, outputBytes);
  assert.ok(TEXT_COMMAND_MAX_BUFFER_BYTES > outputBytes);
});

test("device CLI emits exactly one JSON object on machine success and failure", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "agentic-device-cli-"));
  const remote = path.join(root, "origin.git");
  const repo = path.join(root, "repo");
  try {
    git(root, ["init", "--bare", "--initial-branch=main", remote]);
    git(root, ["init", "--initial-branch=main", repo]);
    git(repo, ["config", "user.email", "tests@example.invalid"]);
    git(repo, ["config", "user.name", "Device CLI Test"]);
    writeFileSync(path.join(repo, "README.md"), "fixture\n");
    git(repo, ["add", "README.md"]);
    git(repo, ["commit", "-m", "test: seed"]);
    git(repo, ["remote", "add", "origin", remote]);
    git(repo, ["push", "--set-upstream", "origin", "main"]);
    const canonicalRepo = realpathSync(repo);

    const success = spawnSync(process.execPath, [script, "park", `--repository=${canonicalRepo}`, "--json"], {
      encoding: "utf8",
    });
    assert.equal(success.status, 0, `${success.stderr}\n${success.stdout}`);
    assert.equal(success.stdout.trim().split("\n").length, 1);
    const result = JSON.parse(success.stdout);
    assert.equal(result.schema, "agentic-device-command-result/v1");
    assert.equal(result.action, "park");
    assert.equal(result.status, "main");
    assert.equal(result.worktreePath, canonicalRepo);

    const failure = spawnSync(process.execPath, [
      script,
      "park",
      `--repository=${canonicalRepo}`,
      "--ttl-seconds=invalid",
      "--json",
    ], { encoding: "utf8" });
    assert.equal(failure.status, 1);
    assert.equal(failure.stdout.trim().split("\n").length, 1);
    const error = JSON.parse(failure.stdout);
    assert.equal(error.ok, false);
    assert.equal(error.status, "error");
    assert.match(error.error.message, /positive number/);

    const wrongAction = spawnSync(process.execPath, [
      script,
      "park",
      `--repository=${canonicalRepo}`,
      "--recover-owned-dirt",
      "--json",
    ], { encoding: "utf8" });
    assert.equal(wrongAction.status, 1);
    assert.match(
      JSON.parse(wrongAction.stdout).error.message,
      /accepted only by device:resume/,
    );

    const wrongController = spawnSync(process.execPath, [
      script,
      "park",
      `--repository=${canonicalRepo}`,
      `--workspace-guard-controller=${canonicalRepo}`,
      "--json",
    ], { encoding: "utf8" });
    assert.equal(wrongController.status, 1);
    assert.match(
      JSON.parse(wrongController.stdout).error.message,
      /clean protected main checkout of this controller repository/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("device:end returns one JSON no-op result on clean main", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "agentic-device-cli-end-"));
  const remote = path.join(root, "origin.git");
  const repo = path.join(root, "repo");
  try {
    git(root, ["init", "--bare", "--initial-branch=main", remote]);
    git(root, ["init", "--initial-branch=main", repo]);
    git(repo, ["config", "user.email", "tests@example.invalid"]);
    git(repo, ["config", "user.name", "Device CLI End Test"]);
    writeFileSync(path.join(repo, "README.md"), "fixture\n");
    git(repo, ["add", "README.md"]);
    git(repo, ["commit", "-m", "test: seed"]);
    git(repo, ["remote", "add", "origin", remote]);
    git(repo, ["push", "--set-upstream", "origin", "main"]);
    const canonicalRepo = realpathSync(repo);

    const result = spawnSync(process.execPath, [script, "end", `--repository=${canonicalRepo}`, "--json"], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    assert.equal(result.stdout.trim().split("\n").length, 1);
    assert.deepEqual(JSON.parse(result.stdout), {
      completedBranch: null,
      pullRequestUrl: null,
      mergeCommitSha: null,
      mainSha: git(canonicalRepo, ["rev-parse", "HEAD"]).trim(),
      status: "ok",
      disposition: "already_on_clean_main",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
