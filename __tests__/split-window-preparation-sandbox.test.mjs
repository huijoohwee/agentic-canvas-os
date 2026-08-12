import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { normalizeVerifierProfiles, withPreparationSandbox } from "../scripts/split-window-preparation-sandbox.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "split-sandbox-source-"));
  execFileSync("git", ["init", "-q", root]); execFileSync("git", ["-C", root, "config", "user.name", "Test"]);
  execFileSync("git", ["-C", root, "config", "user.email", "test@example.com"]);
  fs.writeFileSync(path.join(root, "value.txt"), "source\n"); execFileSync("git", ["-C", root, "add", "value.txt"]);
  execFileSync("git", ["-C", root, "commit", "-qm", "source"]);
  return { root, head: execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() };
}

test("sandbox is detached, credential-free, remote-free, and disposable", () => {
  const source = fixture(); let workspace;
  try {
    const result = withPreparationSandbox({ sourceRepository: source.root, baseRevision: source.head,
      profiles: { inspect: { executable: "/usr/bin/git", args: ["status", "--porcelain=v2"], timeoutMs: 5_000 } } }, sandbox => {
      workspace = sandbox.workspace; assert.equal(sandbox.identity.baseRevision, source.head);
      assert.deepEqual(sandbox.identity.credentialEnvironment, []);
      const receipt = sandbox.runProfile("inspect"); assert.equal(receipt.status, "passed");
      fs.writeFileSync(path.join(workspace, "prepared.txt"), "inert\n"); return receipt.receiptDigest;
    });
    assert.match(result, /^[0-9a-f]{64}$/u); assert.equal(fs.existsSync(workspace), false);
    assert.equal(fs.existsSync(path.join(source.root, "prepared.txt")), false);
  } finally { fs.rmSync(source.root, { recursive: true, force: true }); }
});

test("sandbox rejects malformed verifier profiles and source ref mutation", () => {
  assert.throws(() => normalizeVerifierProfiles({ bad: { executable: "sh", args: [], timeoutMs: 1 } }), /malformed/);
  assert.throws(() => normalizeVerifierProfiles({ shell: { executable: "/bin/sh", args: ["-c", "true"], timeoutMs: 1 } }), /malformed/);
  const source = fixture();
  try {
    assert.throws(() => withPreparationSandbox({ sourceRepository: source.root, baseRevision: source.head }, sandbox => {
      execFileSync("git", ["-C", sandbox.workspace, "checkout", "-b", "forbidden"]);
    }), /detached source/);
  } finally { fs.rmSync(source.root, { recursive: true, force: true }); }
});
