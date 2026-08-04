import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  inspectRootSourceMaintenance,
  normalizeMaintenanceSourceProof,
} from "../scripts/scoped-lane-bootstrap-maintenance.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("root-source maintenance proof binds one registered lane and exact authored bytes", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "root-source-maintenance-"));
  const repository = path.join(root, "repository");
  const manifestPath = path.join(root, "manifest.json");
  try {
    execFileSync("git", ["init", "--initial-branch=main", repository]);
    const registeredRepository = realpathSync(repository);
    execFileSync("git", ["-C", registeredRepository, "config", "user.name", "Test Owner"]);
    execFileSync("git", ["-C", registeredRepository, "config", "user.email", "owner@example.test"]);
    writeFileSync(path.join(registeredRepository, "README.md"), "source\n");
    execFileSync("git", ["-C", registeredRepository, "add", "README.md"]);
    execFileSync("git", ["-C", registeredRepository, "commit", "-m", "source"]);
    writeFileSync(path.join(registeredRepository, "scripts.mjs"), "export const ready = true;\n");
    const manifestBytes = Buffer.from(JSON.stringify({
      schema: "agentic-write-scope-manifest/v1",
      semanticScope: "bootstrap-maintenance",
      declaredWriteSet: [
        "path:scripts.mjs",
        "semantic:bootstrap-maintenance",
      ],
    }, null, 2) + "\n");
    writeFileSync(manifestPath, manifestBytes);
    const manifestDigest = sha256(manifestBytes);
    const proof = inspectRootSourceMaintenance({
      lanePath: registeredRepository,
      manifestPath,
      expectedManifestDigest: manifestDigest,
    });
    assert.equal(proof.registered, true);
    assert.equal(proof.dirty, true);
    assert.equal(proof.leaseCount, 0);
    assert.deepEqual(proof.changedPaths, ["scripts.mjs"]);
    assert.equal(
      normalizeMaintenanceSourceProof(proof, {
        expectedManifestDigest: manifestDigest,
      }).stateDigest,
      proof.stateDigest,
    );
    assert.throws(() => normalizeMaintenanceSourceProof({
      ...proof,
      changedPaths: ["../escaped"],
    }, { expectedManifestDigest: manifestDigest }), /repository-relative/);
    writeFileSync(manifestPath, `${manifestBytes.toString("utf8")} `);
    assert.throws(() => inspectRootSourceMaintenance({
      lanePath: registeredRepository,
      manifestPath,
      expectedManifestDigest: manifestDigest,
    }), /manifest bytes drifted/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
