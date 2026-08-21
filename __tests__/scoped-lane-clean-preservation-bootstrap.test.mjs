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
  normalizeBootstrapRetirementReceiptDigest,
  normalizeRootSourceMaintenanceProof,
  selectRootSourceBootstrapPreservedLanes,
  writeRootSourceBootstrapMaintenanceManifest,
} from "../scripts/scoped-lane-bootstrap-maintenance.mjs";
import { buildRetiredPlannedAdmissionOwnerReceipt } from "../scripts/retired-planned-admission-owner-lib.mjs";

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

test("bootstrap maintenance binds the normalized planned-admission retirement receipt owner", () => {
  const receipt = buildRetiredPlannedAdmissionOwnerReceipt({
    authorizationDigest: digest("a"),
    source: {
      path: "/tmp/retired-source",
      branch: "agent/fixture.local/retired-source",
      head: sha("b"),
      treeSha: sha("c"),
      stateDigest: digest("d"),
      remoteHeadSha: sha("e"),
      lease: { schema: "fixture-lease", status: "active" },
    },
    candidate: {
      claimId: digest("f"),
      branch: "agent/fixture.local/candidate",
      sessionId: "fixture-session",
      admissionReceiptDigest: digest("1"),
    },
    cloud: {
      ledgerRevision: sha("2"),
      ledgerDigest: digest("3"),
      verificationReceiptDigest: digest("4"),
      sourceClaimId: digest("5"),
      sourceClaimAbsent: true,
    },
    provider: {
      url: "https://example.invalid/pull/1",
      number: 1,
      state: "CLOSED",
      draft: true,
      mergedAt: null,
      closedAt: "2026-08-15T00:00:00.000Z",
      headBranch: "agent/fixture.local/retired-source",
      headSha: sha("e"),
      baseBranch: "main",
      baseSha: sha("6"),
    },
    retiredAt: "2026-08-15T00:00:00.000Z",
  });
  assert.equal(normalizeBootstrapRetirementReceiptDigest({
    admissionOwnerRetirement: receipt,
  }), receipt.receiptDigest);
  assert.throws(() => normalizeBootstrapRetirementReceiptDigest({
    admissionOwnerRetirement: receipt,
    localReviewRetirement: {},
  }), /one exact retirement receipt owner/);
});

test("bootstrap maintenance binds the normalized planned-recovery local release receipt owner", () => {
  const core = {
    schema: "agentic-planned-recovery-pr-marker-local-release/v1",
    planDigest: digest("a"),
    claimId: digest("b"),
    pullRequestUrl: "https://example.invalid/pull/2",
    completedAt: "2026-08-15T00:00:00.000Z",
  };
  const receipt = { ...core, receiptDigest: digestValue(core) };
  assert.equal(normalizeBootstrapRetirementReceiptDigest({
    plannedRecoveryMarkerReconciliation: receipt,
  }), receipt.receiptDigest);
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
