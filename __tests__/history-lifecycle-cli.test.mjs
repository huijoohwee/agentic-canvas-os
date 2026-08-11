// Responsibility: Prove the history CLI rejects mutation syntax before execution and emits sanitized typed errors.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  parseHistoryLifecycleArguments,
  sanitizeHistoryLifecycleError,
} from "../scripts/history-lifecycle.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "scripts", "history-lifecycle.mjs");

test("mutation modes and mutation-shaped flags are rejected by argument parsing", () => {
  assert.throws(() => parseHistoryLifecycleArguments(["run"]), /mode must be audit or plan/u);
  assert.throws(() => parseHistoryLifecycleArguments([
    "plan", `--repository=${ROOT}`, "--comparison-ref=refs/heads/main", "--delete=yes",
  ]), /Unsupported history lifecycle option/u);
  assert.throws(() => parseHistoryLifecycleArguments([
    "plan", `--repository=${ROOT}`, "--comparison-ref=main",
  ]), /fully qualified/u);
});

test("error sanitization covers generic POSIX, Windows, UNC, URL, token, and child diagnostics", () => {
  const sanitized = sanitizeHistoryLifecycleError(new Error(
    "failed /private/tmp/operator/secret C:\\tenant\\private \\\\server\\share\\private https://alice:secret@example.invalid/a?token=plain-secret ghp_abcdefghijklmnopqrstuvwxyz123456",
  ));
  for (const secret of ["/private", "operator", "C:\\tenant", "server", "alice", "plain-secret", "ghp_"]) {
    assert.equal(sanitized.includes(secret), false, secret);
  }
  assert.equal(sanitizeHistoryLifecycleError({ stderr: "/tmp/private" }),
    "External command failed without public diagnostics.");
});

test("CLI emits one typed redacted JSON object for a missing repository", () => {
  const privatePath = "/tmp/history-lifecycle-secret-path/absent";
  const result = spawnSync(process.execPath, [CLI, "audit", `--repository=${privatePath}`,
    "--comparison-ref=refs/heads/main", "--json"], { cwd: ROOT, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  const lines = result.stdout.trim().split(/\r?\n/u);
  assert.equal(lines.length, 1);
  const output = JSON.parse(lines[0]);
  assert.equal(output.schema, "agentic-history-lifecycle-error/v1");
  assert.equal(output.mutationAuthorized, false);
  assert.equal(output.mutationAuthority, null);
  assert.equal(result.stdout.includes(privatePath), false);
  assert.equal(result.stdout.includes("history-lifecycle-secret-path"), false);
});
