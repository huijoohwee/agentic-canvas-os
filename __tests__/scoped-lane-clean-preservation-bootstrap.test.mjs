import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  hasCurrentRootSourceMaintenanceAuthority,
  isEligibleRootSourceMaintenance,
  normalizeRootSourceMaintenanceProof,
  selectRootSourceBootstrapPreservedLanes,
  writeRootSourceBootstrapMaintenanceManifest,
} from "../scripts/scoped-lane-bootstrap-maintenance.mjs";

const digest = character => character.repeat(64);
const sha = character => character.repeat(40);

test("explicit clean preservation does not require manufactured dirty auto-discovery", () => {
  assert.deepEqual(selectRootSourceBootstrapPreservedLanes({
    lanes: [],
    canonicalPath: "/workspace/repository",
    targetPath: "/workspace/candidate",
    maintenanceSourcePath: "/workspace/maintenance",
    branch: "agent/device/candidate",
    currentRemoteClaims: [],
  }), []);
});

test("clean retired-preserved evidence is eligible without manufacturing maintenance dirt", () => {
  const source = proof({
    dirty: false,
    retiredPreserved: true,
    leaseCount: 1,
    changedPaths: [],
    declaredWriteSet: ["semantic:retired-source"],
  });
  const normalized = normalizeRootSourceMaintenanceProof(source, {
    expectedManifestDigest: source.manifestDigest,
  });
  assert.equal(isEligibleRootSourceMaintenance(normalized), true);
  assert.equal(normalized.retiredPreserved, true);
  assert.deepEqual(normalized.changedPaths, []);
});

test("current overlapping cloud authority invalidates clean retirement evidence", () => {
  const source = normalizeRootSourceMaintenanceProof(proof({
    retiredPreserved: true,
    leaseCount: 1,
    declaredWriteSet: ["semantic:retired-source"],
  }), { expectedManifestDigest: digest("b") });
  assert.equal(hasCurrentRootSourceMaintenanceAuthority(source, [{
    declaredWriteScope: ["path:docs/other.md", "semantic:other-source"],
  }]), false);
  assert.equal(hasCurrentRootSourceMaintenanceAuthority(source, [{
    declaredWriteScope: ["path:docs/recovery.md", "semantic:retired-source"],
  }]), true);
});

test("clean unattributed, clean changed, and leased dirty sources remain blocked", () => {
  const cases = [
    proof({ dirty: false, retiredPreserved: false, leaseCount: 0, changedPaths: [] }),
    proof({ dirty: false, retiredPreserved: true, leaseCount: 1,
      changedPaths: ["scripts/drift.mjs"] }),
    proof({ dirty: true, retiredPreserved: false, leaseCount: 1,
      changedPaths: ["scripts/owned.mjs"] }),
  ];
  for (const source of cases) {
    const normalized = normalizeRootSourceMaintenanceProof(source, {
      expectedManifestDigest: source.manifestDigest,
    });
    assert.equal(isEligibleRootSourceMaintenance(normalized), false);
  }
});

test("dirty unleased maintenance remains eligible and old proof digests remain verifiable", () => {
  const current = proof({
    dirty: true,
    retiredPreserved: false,
    leaseCount: 0,
    changedPaths: ["scripts/focused-fix.mjs"],
  });
  assert.equal(isEligibleRootSourceMaintenance(normalizeRootSourceMaintenanceProof(current, {
    expectedManifestDigest: current.manifestDigest,
  })), true);

  const { retiredPreserved: _newField, stateDigest: _newDigest, ...legacyCore } = current;
  const legacy = { ...legacyCore, stateDigest: digestValue(legacyCore) };
  const normalizedLegacy = normalizeRootSourceMaintenanceProof(legacy, {
    expectedManifestDigest: legacy.manifestDigest,
  });
  assert.equal(normalizedLegacy.retiredPreserved, false);
  assert.equal(isEligibleRootSourceMaintenance(normalizedLegacy), true);
});

test("a clean ordinary worktree produces an empty semantic manifest but no authority", () => {
  const repository = mkdtempSync(path.join(os.tmpdir(), "clean-bootstrap-"));
  runGit(repository, ["init", "-b", "main"]);
  runGit(repository, ["config", "user.name", "Fixture"]);
  runGit(repository, ["config", "user.email", "fixture@example.com"]);
  runGit(repository, ["commit", "--allow-empty", "-m", "fixture"]);
  runGit(repository, ["branch", "agent/fixture.local/clean-source"]);
  runGit(repository, ["switch", "agent/fixture.local/clean-source"]);
  const outputPath = path.join(repository, "..", `${path.basename(repository)}.json`);
  const result = writeRootSourceBootstrapMaintenanceManifest({
    lanePath: repository,
    outputPath,
  });
  assert.deepEqual(result.changedPaths, []);
  assert.deepEqual(result.manifest.declaredWriteSet, ["semantic:clean-source"]);
  assert.equal(JSON.parse(readFileSync(outputPath, "utf8")).semanticScope, "clean-source");
});

function proof(overrides = {}) {
  const core = {
    path: "/tmp/retired-source",
    repositoryRoot: "/tmp/retired-source",
    head: sha("a"),
    branch: "refs/heads/agent/fixture.local/retired-source",
    registered: true,
    detached: false,
    invalid: false,
    dirty: false,
    retiredPreserved: false,
    leaseCount: 0,
    manifestDigest: digest("b"),
    semanticScope: "retired-source",
    declaredWriteSet: ["semantic:retired-source"],
    changedPaths: [],
    contentDigest: digest("c"),
    ...overrides,
  };
  return Object.freeze({ ...core, stateDigest: digestValue(core) });
}

function runGit(repository, args) {
  execFileSync("git", ["-C", repository, ...args], {
    stdio: "pipe",
  });
}
