import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  assertRootSourceBootstrapCurrent,
  createRootSourceBootstrapAuthorization,
} from "../scripts/scoped-lane-bootstrap-authorization.mjs";

const BASE_SHA = "1".repeat(40);
const CLAIM_ID = "2".repeat(64);
const LEDGER_REVISION = "3".repeat(40);
const LEDGER_DIGEST = "4".repeat(64);
const MANIFEST_DIGEST = "5".repeat(64);
const WRITE_SET_DIGEST = "6".repeat(64);
const MAINTENANCE_MANIFEST_DIGEST = "7".repeat(64);
const CONTENT_DIGEST = "8".repeat(64);
const EVALUATED_AT = "2026-08-30T00:00:00.000Z";
const ROOT = path.resolve("/workspace/agentic-canvas-os");
const TARGET = path.resolve("/workspace/.worktrees/agentic-canvas-os/core");
const MAINTENANCE = path.resolve(
  "/workspace/.worktrees/agentic-canvas-os/maintenance",
);

test("canonical dirty main authorizes an exact zero preserved-lane bootstrap", () => {
  const fixture = createFixture({ mode: "canonical-dirty-main" });
  const authorization = buildAuthorization(fixture);

  assert.deepEqual(authorization.preservedLanes, []);
  assert.equal(authorization.maintenanceMode, "canonical-dirty-main");
  assert.equal(assertRootSourceBootstrapCurrent({
    report: reportFor(authorization, fixture),
    remoteAuthorityVerification: fixture.remoteAuthorityVerification,
    inspectMaintenanceSource: () => fixture.maintenanceProof,
  }), authorization.authorizationDigest);
});

test("zero preserved lanes remain forbidden for separate maintenance", () => {
  for (const mode of ["separate-dirty", "separate-clean-retired"]) {
    const fixture = createFixture({ mode });
    assert.throws(
      () => buildAuthorization(fixture),
      /requires at least one preserved lane unless maintenance is canonical-dirty-main/u,
      mode,
    );
  }
});

test("an explicit malformed preserved-lane collection cannot collapse to zero", () => {
  const fixture = createFixture({ mode: "canonical-dirty-main" });
  assert.throws(
    () => buildAuthorization(fixture, { preservedLanes: {} }),
    /preservedLanes must be an array/u,
  );
});

test("zero-lane bootstrap revalidation rejects canonical maintenance drift", () => {
  const fixture = createFixture({ mode: "canonical-dirty-main" });
  const authorization = buildAuthorization(fixture);
  const report = reportFor(authorization, fixture);

  for (const drift of [
    { dirty: false, changedPaths: [] },
    { leaseCount: 1 },
    { branch: "refs/heads/agent/operator/main", semanticScope: "main" },
  ]) {
    const changed = maintenanceProof({
      path: ROOT,
      branch: "refs/heads/main",
      semanticScope: "main",
      dirty: true,
      retiredPreserved: false,
      leaseCount: 0,
      changedPaths: ["retained/doc.md"],
      ...drift,
    });
    assert.throws(() => assertRootSourceBootstrapCurrent({
      report,
      remoteAuthorityVerification: fixture.remoteAuthorityVerification,
      inspectMaintenanceSource: () => changed,
    }), /maintenance manifest or changed paths drifted/u);
  }
});

function createFixture({ mode }) {
  const canonical = lane(ROOT, {
    branch: "refs/heads/main",
    dirty: mode === "canonical-dirty-main",
  });
  const isCanonical = mode === "canonical-dirty-main";
  const cleanRetired = mode === "separate-clean-retired";
  const proofPath = isCanonical ? ROOT : MAINTENANCE;
  const proofScope = isCanonical ? "main" : "maintenance";
  const changedPaths = cleanRetired ? [] : [
    isCanonical ? "retained/doc.md" : "scripts/maintenance.mjs",
  ];
  const proof = maintenanceProof({
    path: proofPath,
    branch: isCanonical
      ? "refs/heads/main"
      : "refs/heads/agent/operator/maintenance",
    semanticScope: proofScope,
    dirty: !cleanRetired,
    retiredPreserved: cleanRetired,
    leaseCount: cleanRetired ? 1 : 0,
    changedPaths,
  });
  const candidateClaim = Object.freeze({
    claimId: CLAIM_ID,
    actorId: "github-user:operator",
    declaredWriteScope: ["path:scripts/core.mjs", "semantic:core"],
  });
  const remoteAuthorityVerification = Object.freeze({
    status: "ready",
    verifiedAt: EVALUATED_AT,
    ledgerRevision: LEDGER_REVISION,
    ledgerDigest: LEDGER_DIGEST,
    inventory: Object.freeze({ claims: [candidateClaim] }),
  });
  const cloudAuthority = Object.freeze({
    claimId: CLAIM_ID,
    canonicalBaseSha: BASE_SHA,
    targetRepository: "owner/agentic-canvas-os",
    expiresAt: "2026-08-30T00:10:00.000Z",
  });
  return Object.freeze({
    canonicalPath: ROOT,
    targetPath: TARGET,
    maintenanceSourcePath: proofPath,
    lanes: isCanonical
      ? [canonical]
      : [canonical, lane(MAINTENANCE, {
        branch: "refs/heads/agent/operator/maintenance",
        dirty: !cleanRetired,
      })],
    manifest: Object.freeze({
      manifestDigest: MANIFEST_DIGEST,
      writeSetDigest: WRITE_SET_DIGEST,
    }),
    cloudAuthority,
    remoteAuthorityVerification,
    maintenanceProof: proof,
  });
}

function buildAuthorization(fixture, overrides = {}) {
  return createRootSourceBootstrapAuthorization({
    lanes: fixture.lanes,
    canonicalPath: fixture.canonicalPath,
    canonicalBaseSha: BASE_SHA,
    targetPath: fixture.targetPath,
    branch: "agent/operator/core",
    semanticScope: "core",
    manifest: fixture.manifest,
    cloudAuthority: fixture.cloudAuthority,
    remoteAuthorityVerification: fixture.remoteAuthorityVerification,
    maintenanceSourcePath: fixture.maintenanceSourcePath,
    maintenanceManifestPath: "/workspace/maintenance-write-scope.json",
    maintenanceManifestDigest: MAINTENANCE_MANIFEST_DIGEST,
    inspectMaintenanceSource: () => fixture.maintenanceProof,
    evaluatedAt: new Date(EVALUATED_AT),
    ...overrides,
  });
}

function reportFor(authorization, fixture) {
  return Object.freeze({
    repository: ROOT,
    canonicalBaseSha: BASE_SHA,
    cloudAuthority: fixture.cloudAuthority,
    candidate: Object.freeze({
      semanticScope: "core",
      branch: "agent/operator/core",
      targetPath: TARGET,
      manifestDigest: MANIFEST_DIGEST,
      writeSetDigest: WRITE_SET_DIGEST,
    }),
    rootSourceBootstrapAuthorization: authorization,
  });
}

function lane(lanePath, { branch, dirty }) {
  const core = {
    path: lanePath,
    head: BASE_SHA,
    branch,
    dirty,
    detached: false,
    invalid: false,
    leaseAmbiguous: false,
    lease: null,
  };
  return Object.freeze({ ...core, stateDigest: digestValue(core) });
}

function maintenanceProof({
  path: maintenancePath,
  branch,
  semanticScope,
  dirty,
  retiredPreserved,
  leaseCount,
  changedPaths,
}) {
  const core = {
    path: maintenancePath,
    repositoryRoot: maintenancePath,
    head: BASE_SHA,
    branch,
    registered: true,
    detached: false,
    invalid: false,
    dirty,
    retiredPreserved,
    leaseCount,
    manifestDigest: MAINTENANCE_MANIFEST_DIGEST,
    semanticScope,
    declaredWriteSet: [
      ...changedPaths.map(changedPath => `path:${changedPath}`),
      `semantic:${semanticScope}`,
    ],
    changedPaths,
    contentDigest: CONTENT_DIGEST,
  };
  return Object.freeze({ ...core, stateDigest: digestValue(core) });
}
