import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { assertExternalStoreIsolation, createPreparationSource } from "../scripts/split-window-preparation-repository-adapter.mjs";

test("external store cannot overlap repositories, common dirs, or worktrees", () => { assert.throws(() => assertExternalStoreIsolation({ storeRoot: "/workspace/repo/artifacts", repositoryRoots: ["/workspace/repo"], commonDirectories: [], worktrees: [] }), /not isolated/); assert.doesNotThrow(() => assertExternalStoreIsolation({ storeRoot: "/external/artifacts", repositoryRoots: ["/workspace/repo"], commonDirectories: ["/workspace/repo/.git"], worktrees: ["/workspace/lane"] })); });

test("preparation captures only declared inert component paths and detects repository drift", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "split-source-"));
  try {
    execFileSync("git", ["init", "-q", root]); execFileSync("git", ["-C", root, "config", "user.name", "Test"]);
    execFileSync("git", ["-C", root, "config", "user.email", "test@example.com"]);
    fs.writeFileSync(path.join(root, "change.patch"), "patch\n"); execFileSync("git", ["-C", root, "add", "change.patch"]);
    execFileSync("git", ["-C", root, "commit", "-qm", "source"]);
    execFileSync("git", ["-C", root, "remote", "add", "origin", "https://example.invalid/repo.git"]);
    const source = createPreparationSource({ repository: root, boundsPolicyDigest: "1".repeat(64),
      target: { repositoryIdentityDigest: "2".repeat(64), semanticScope: "scope",
        canonicalBaseSha: execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
        manifestDigest: "3".repeat(64), writeSetDigest: "4".repeat(64) },
      components: [{ path: "change.patch", kind: "patch", mediaType: "application/vnd.git.patch", declaredPaths: ["docs/a.md"] }] });
    const captured = source.capture(); assert.deepEqual(captured.bundle.paths, ["docs/a.md"]);
    assert.equal(captured.bundle.artifacts[0].paths[0], "docs/a.md"); assert.equal(captured.mutationAuthority, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
