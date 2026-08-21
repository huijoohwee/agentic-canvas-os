import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  assertRootSourceBootstrapCurrent,
  evaluateScopedLaneAdmission,
  markOperationDerivedCloudVerification,
  normalizeCloudAuthority,
  normalizeDeclaredWriteScopeManifest,
} from "../scripts/scoped-lane-admission-lib.mjs";
import {
  buildRootSourceBootstrapOperatorDecision,
  createRootSourceBootstrapAuthorization,
  ROOT_SOURCE_BOOTSTRAP_MAX_PRESERVED_LANES,
} from "../scripts/scoped-lane-bootstrap-authorization.mjs";

const BASE = "1".repeat(40);
const CANDIDATE_ID = "2".repeat(64);
const CANDIDATE_FENCE = "3".repeat(64);
const CANDIDATE_TRANSITION = "4".repeat(64);
const LEDGER_REVISION = "5".repeat(40);
const LEDGER_DIGEST = "6".repeat(64);
const ACTOR_ID = "github-user:operator";
const EVALUATED_AT = "2026-08-04T12:00:00.000Z";
const CLAIM_EXPIRES_AT = "2026-08-04T12:30:00.000Z";
const AUTHORIZATION_EXPIRES_AT = "2026-08-04T12:10:00.000Z";
const ROOT = path.resolve("/workspace/agentic-canvas-os");
const TARGET = path.resolve("/workspace/.worktrees/agentic-canvas-os/core");
const MAINTENANCE = path.resolve("/workspace/.worktrees/agentic-canvas-os/maintenance");
const DIRTY_BOOTSTRAP = path.resolve("/workspace/.worktrees/agentic-canvas-os/bootstrap");
const RETIRED = path.resolve("/workspace/.worktrees/agentic-canvas-os/retired");
const DORMANT = path.resolve("/workspace/.worktrees/agentic-canvas-os/dormant");

function buildMaintenanceProof(overrides = {}) {
  const core = {
    path: MAINTENANCE,
    repositoryRoot: MAINTENANCE,
    head: BASE,
    branch: "refs/heads/agent/operator/maintenance",
    registered: true,
    detached: false,
    invalid: false,
    dirty: true,
    leaseCount: 0,
    manifestDigest: "2".repeat(64),
    semanticScope: "maintenance",
    declaredWriteSet: [
      "path:scripts/maintenance.mjs",
      "semantic:maintenance",
    ],
    changedPaths: ["scripts/maintenance.mjs"],
    contentDigest: "3".repeat(64),
    ...overrides,
  };
  return { ...core, stateDigest: digestValue(core) };
}

function buildOperatorDecision(overrides = {}) {
  const base = buildRootSourceBootstrapOperatorDecision({
    actorId: ACTOR_ID,
    candidateClaimId: CANDIDATE_ID,
  });
  const { decisionDigest: _decisionDigest, ...core } = { ...base, ...overrides };
  return { ...core, decisionDigest: digestValue(core) };
}

function fixture() {
  const manifest = normalizeDeclaredWriteScopeManifest({
    schema: "agentic-declared-write-scope/v1",
    semanticScope: "core",
    paths: ["scripts/core.mjs"],
  });
  const candidateClaim = claim({
    claimId: CANDIDATE_ID,
    laneRevision: BASE,
    declaredWriteScope: manifest.declaredWriteSet,
    writeSetDigest: manifest.writeSetDigest,
    actorId: ACTOR_ID,
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    operationReceiptDigest: "7".repeat(64),
    mutationAuthorityEligible: true,
    state: "active",
    leaseEpoch: 1,
    transitionCounter: 1,
    expiresAt: CLAIM_EXPIRES_AT,
    fenceRevision: CANDIDATE_FENCE,
    transitionDigest: CANDIDATE_TRANSITION,
  });
  const dormantScope = ["path:docs/dormant.md", "semantic:dormant"];
  const dormantClaim = claim({
    claimId: "8".repeat(64),
    laneRevision: "9".repeat(40),
    declaredWriteScope: dormantScope,
    writeSetDigest: digestValue(dormantScope),
    actorId: "github-user:peer",
    entrySchema: "agentic-cloud-collaboration-entry/v1",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v1",
    operationReceiptDigest: "a".repeat(64),
    mutationAuthorityEligible: false,
    state: "parked",
    leaseEpoch: 3,
    transitionCounter: 2,
    expiresAt: "2026-08-04T11:00:00.000Z",
    fenceRevision: "b".repeat(64),
    transitionDigest: "c".repeat(64),
  });
  const inventoryCore = {
    schema: "agentic-cloud-claim-inventory/v1",
    observedLedgerHeadRevision: LEDGER_REVISION,
    ledgerDigest: LEDGER_DIGEST,
    evaluationTime: EVALUATED_AT,
    claims: [candidateClaim, dormantClaim].sort(
      (left, right) => left.claimId.localeCompare(right.claimId),
    ),
  };
  const inventory = {
    ...inventoryCore,
    inventoryDigest: digestValue(inventoryCore),
  };
  const cloudAuthority = {
    schema: "agentic-lane-cloud-authority/v1",
    provider: "github",
    ledgerRepository: "owner/agentic-canvas-os",
    targetRepository: "owner/agentic-canvas-os",
    claimId: CANDIDATE_ID,
    claimDigest: CANDIDATE_FENCE,
    ledgerRevision: LEDGER_REVISION,
    ledgerDigest: LEDGER_DIGEST,
    claimLedgerRevision: CANDIDATE_TRANSITION,
    entrySchema: candidateClaim.entrySchema,
    claimIdentitySchema: candidateClaim.claimIdentitySchema,
    operationReceiptDigest: candidateClaim.operationReceiptDigest,
    mutationAuthorityEligible: true,
    canonicalBaseSha: BASE,
    laneRevision: BASE,
    cloudDeclaredWriteScope: manifest.declaredWriteSet,
    writeSetDigest: manifest.writeSetDigest,
    deviceId: "operator-device",
    sessionId: "operator-session",
    reviewRequestId: null,
    leaseEpoch: 1,
    transitionCounter: 1,
    state: "active",
    expiresAt: CLAIM_EXPIRES_AT,
  };
  const verification = markOperationDerivedCloudVerification(Object.freeze({
    schema: "agentic-lane-cloud-verification/v1",
    status: "ready",
    claimId: CANDIDATE_ID,
    claimDigest: CANDIDATE_FENCE,
    ledgerRevision: LEDGER_REVISION,
    ledgerDigest: LEDGER_DIGEST,
    canonicalBaseSha: BASE,
    laneRevision: BASE,
    writeSetDigest: manifest.writeSetDigest,
    reviewRequestId: null,
    remoteClaimInventoryDigest: inventory.inventoryDigest,
    inventory,
    receiptDigest: "d".repeat(64),
    verifiedAt: EVALUATED_AT,
  }));
  const retiredScope = manifest.declaredWriteSet;
  const maintenanceManifestDigest = "2".repeat(64);
  const maintenanceProof = buildMaintenanceProof({
    manifestDigest: maintenanceManifestDigest,
  });
  const lanes = [
    lane(ROOT, { branch: "refs/heads/main" }),
    lane(MAINTENANCE, { branch: "refs/heads/agent/operator/maintenance", dirty: true }),
    lane(DIRTY_BOOTSTRAP, {
      branch: "refs/heads/agent/operator/bootstrap",
      dirty: true,
      head: "e".repeat(40),
    }),
    lane(RETIRED, {
      branch: "refs/heads/agent/operator/retired",
      head: "f".repeat(40),
      dirty: true,
      lease: admittedLease({
        lanePath: RETIRED,
        branch: "agent/operator/retired",
        scope: "retired",
        head: "f".repeat(40),
        claimId: "0".repeat(64),
        declaredWriteScope: retiredScope,
        writeSetDigest: manifest.writeSetDigest,
      }),
    }),
    lane(DORMANT, {
      branch: "refs/heads/agent/operator/dormant",
      head: dormantClaim.laneRevision,
      lease: admittedLease({
        lanePath: DORMANT,
        branch: "agent/operator/dormant",
        scope: "dormant",
        head: dormantClaim.laneRevision,
        claimId: dormantClaim.claimId,
        declaredWriteScope: dormantScope,
        writeSetDigest: dormantClaim.writeSetDigest,
        leaseEpoch: 3,
      }),
    }),
  ];
  const authorization = {
    schema: "agentic-root-source-bootstrap-preservation-authorization/v1",
    operatorDecision: buildOperatorDecision(),
    actorId: ACTOR_ID,
    candidateClaimId: CANDIDATE_ID,
    canonicalBaseSha: BASE,
    semanticScope: "core",
    branch: "agent/operator/core",
    targetPath: TARGET,
    manifestDigest: manifest.manifestDigest,
    writeSetDigest: manifest.writeSetDigest,
    ledgerRevision: LEDGER_REVISION,
    ledgerDigest: LEDGER_DIGEST,
    maintenanceSourcePath: MAINTENANCE,
    maintenanceManifestDigest,
    maintenanceManifestPath: path.resolve("/workspace/maintenance-write-scope.json"),
    expiresAt: AUTHORIZATION_EXPIRES_AT,
    preservedLanes: [DIRTY_BOOTSTRAP, RETIRED].map(lanePath => ({
      path: lanePath,
      stateDigest: lanes.find(item => item.path === lanePath).stateDigest,
    })),
  };
  return {
    authorization,
    cloudAuthority,
    manifest,
    verification,
    lanes,
    maintenanceProof,
  };
}

test("candidate-bound cross-repository bootstrap preserves exact lanes and dormant peers", () => {
  const input = fixture();
  const report = evaluate(input);
  assert.deepEqual(report.authoringAdmission.findings, []);
  assert.equal(report.authoringAdmission.status, "planned");
  assert.match(
    report.lanes.find(item => item.path === DIRTY_BOOTSTRAP).overlapReasons[0],
    /^root-source-bootstrap-preserved:[0-9a-f]{64}$/u,
  );
  assert.match(report.lanes.find(item => item.path === MAINTENANCE).overlapReasons[0], /^root-source-bootstrap-maintenance:[0-9a-f]{64}$/u);
  assert.equal(
    report.lanes.find(item => item.path === RETIRED).classification,
    "disjoint-attributed",
  );
  assert.deepEqual(
    report.lanes.find(item => item.path === DORMANT).overlapReasons,
    [],
  );
  assert.equal(
    report.rootSourceBootstrapAuthorization.actorId,
    ACTOR_ID,
  );
  assert.equal(
    report.rootSourceBootstrapAuthorization.maintenanceSourcePath,
    MAINTENANCE,
  );
  assert.equal(
    report.lanes.find(item => item.path === RETIRED).dirty,
    true,
  );
});

test("canonical dirty main may be the exact root-bootstrap maintenance source", () => {
  const input = fixture();
  input.lanes = input.lanes
    .filter(item => item.path !== MAINTENANCE)
    .map(item => (
      item.path === ROOT
        ? lane(ROOT, { branch: "refs/heads/main", dirty: true })
        : item
    ));
  input.maintenanceProof = buildMaintenanceProof({
    path: ROOT,
    repositoryRoot: ROOT,
    branch: "refs/heads/main",
    semanticScope: "main",
    declaredWriteSet: ["path:docs/retained.md", "semantic:main"],
    changedPaths: ["docs/retained.md"],
  });
  input.authorization = {
    ...input.authorization,
    maintenanceSourcePath: ROOT,
  };

  const report = evaluate({
    ...input,
    canonicalSourceDisposition: "root-bootstrap-dirty",
  });
  assert.deepEqual(report.authoringAdmission.findings, []);
  assert.equal(report.authoringAdmission.status, "planned");
  assert.equal(
    report.rootSourceBootstrapAuthorization.maintenanceMode,
    "canonical-dirty-main",
  );
});

test("bootstrap authorization builder auto-discovers eligible preserved lanes", () => {
  const input = fixture();
  const built = createRootSourceBootstrapAuthorization({
    lanes: input.lanes,
    canonicalPath: ROOT,
    canonicalBaseSha: BASE,
    targetPath: TARGET,
    branch: "agent/operator/core",
    semanticScope: "core",
    manifest: input.manifest,
    cloudAuthority: input.cloudAuthority,
    remoteAuthorityVerification: input.verification,
    maintenanceSourcePath: MAINTENANCE,
    maintenanceManifestPath: "/workspace/maintenance-write-scope.json",
    maintenanceManifestDigest: "2".repeat(64),
    inspectMaintenanceSource: () => input.maintenanceProof,
    evaluatedAt: new Date(EVALUATED_AT),
  });
  assert.equal(built.schema, "agentic-root-source-bootstrap-preservation-authorization/v1");
  assert.deepEqual(
    built.preservedLanes.map(lane => lane.path),
    [DIRTY_BOOTSTRAP, RETIRED],
  );
  assert.equal(built.operatorDecision.actorId, ACTOR_ID);
  assert.equal(built.operatorDecision.candidateClaimId, CANDIDATE_ID);
});

test("bootstrap authorization builder supports the expanded preserved lane bound", () => {
  const input = fixture();
  const extraLanes = Array.from({ length: ROOT_SOURCE_BOOTSTRAP_MAX_PRESERVED_LANES - 2 }, (_, index) => {
    const lanePath = path.resolve(`/workspace/.worktrees/agentic-canvas-os/extra-${index}`);
    return lane(lanePath, {
      branch: `refs/heads/agent/operator/extra-${index}`,
      head: `${(index + 2).toString(16)}`.repeat(40).slice(0, 40),
      dirty: true,
    });
  });
  input.lanes.push(...extraLanes);
  const built = createRootSourceBootstrapAuthorization({
    lanes: input.lanes,
    canonicalPath: ROOT,
    canonicalBaseSha: BASE,
    targetPath: TARGET,
    branch: "agent/operator/core",
    semanticScope: "core",
    manifest: input.manifest,
    cloudAuthority: input.cloudAuthority,
    remoteAuthorityVerification: input.verification,
    maintenanceSourcePath: MAINTENANCE,
    maintenanceManifestPath: "/workspace/maintenance-write-scope.json",
    maintenanceManifestDigest: "2".repeat(64),
    inspectMaintenanceSource: () => input.maintenanceProof,
    evaluatedAt: new Date(EVALUATED_AT),
  });
  assert.equal(
    built.preservedLanes.length,
    ROOT_SOURCE_BOOTSTRAP_MAX_PRESERVED_LANES,
  );
});

test("explicit preserve lanes extend auto-discovered preserved lanes", () => {
  const input = fixture();
  const explicitPath = path.resolve("/workspace/.worktrees/agentic-canvas-os/explicit-clean");
  input.lanes.push(lane(explicitPath, {
    branch: "refs/heads/agent/operator/explicit-clean",
    head: "7".repeat(40),
    dirty: false,
    lease: {
      schema: "agentic-writer-lease/v2",
      status: "review_ready",
      epoch: 9,
      sessionId: "explicit-clean-session",
      device: "operator",
      scope: "explicit-clean",
      branch: "agent/operator/explicit-clean",
      worktreePath: explicitPath,
      baseSha: BASE,
      fenceSha: "8".repeat(40),
      pullRequestUrl: "https://github.test/owner/repository/pull/123",
      expiresAt: AUTHORIZATION_EXPIRES_AT,
      reviewHeadSha: "7".repeat(40),
    },
  }));
  const built = createRootSourceBootstrapAuthorization({
    lanes: input.lanes,
    canonicalPath: ROOT,
    canonicalBaseSha: BASE,
    targetPath: TARGET,
    branch: "agent/operator/core",
    semanticScope: "core",
    manifest: input.manifest,
    cloudAuthority: input.cloudAuthority,
    remoteAuthorityVerification: input.verification,
    maintenanceSourcePath: MAINTENANCE,
    maintenanceManifestPath: "/workspace/maintenance-write-scope.json",
    maintenanceManifestDigest: "2".repeat(64),
    preservedLanes: [{
      path: explicitPath,
      stateDigest: input.lanes.find(item => item.path === explicitPath).stateDigest,
    }],
    inspectMaintenanceSource: () => input.maintenanceProof,
    evaluatedAt: new Date(EVALUATED_AT),
  });
  assert.deepEqual(
    built.preservedLanes.map(lane => lane.path).sort(),
    [DIRTY_BOOTSTRAP, RETIRED, explicitPath].sort(),
  );
});

test("candidate-bound bootstrap preserves a dirty planned owner after its cloud claim retires", () => {
  const input = fixture();
  const retiredLane = input.lanes.find(item => item.path === RETIRED);
  retiredLane.lease.admission.status = "planned";
  retiredLane.stateDigest = digestValue({
    lanePath: retiredLane.path,
    head: retiredLane.head,
    branch: retiredLane.branch,
    dirty: retiredLane.dirty,
    lease: retiredLane.lease,
  });
  input.authorization.preservedLanes = input.authorization.preservedLanes.map(item => (
    item.path === RETIRED
      ? { ...item, stateDigest: retiredLane.stateDigest }
      : item
  ));

  const report = evaluate(input);
  assert.equal(report.authoringAdmission.status, "planned");
  assert.equal(
    report.lanes.find(item => item.path === RETIRED).classification,
    "disjoint-attributed",
  );
});

test("dirty admitted owners still block while their cloud claim remains current", () => {
  const input = fixture();
  const retiredLane = input.lanes.find(item => item.path === RETIRED);
  const authority = retiredLane.lease.cloudAuthority;
  const currentOwner = claim({
    claimId: authority.claimId,
    laneRevision: retiredLane.head,
    declaredWriteScope: authority.cloudDeclaredWriteScope,
    writeSetDigest: authority.writeSetDigest,
    actorId: ACTOR_ID,
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    operationReceiptDigest: "1".repeat(64),
    mutationAuthorityEligible: true,
    state: "active",
    leaseEpoch: authority.leaseEpoch,
    transitionCounter: authority.transitionCounter,
    expiresAt: CLAIM_EXPIRES_AT,
    fenceRevision: authority.claimDigest,
    transitionDigest: authority.claimLedgerRevision,
  });
  const inventoryCore = {
    ...input.verification.inventory,
    claims: [...input.verification.inventory.claims, currentOwner].sort(
      (left, right) => left.claimId.localeCompare(right.claimId),
    ),
  };
  delete inventoryCore.inventoryDigest;
  const inventory = {
    ...inventoryCore,
    inventoryDigest: digestValue(inventoryCore),
  };
  input.verification = markOperationDerivedCloudVerification(Object.freeze({
    ...input.verification,
    inventory,
    remoteClaimInventoryDigest: inventory.inventoryDigest,
  }));
  assert.throws(() => evaluate(input), /cannot replace current cloud ownership/u);
});

test("overlapping waiting successor stays queued behind the current authority", () => {
  const input = fixture();
  const successorClaim = claim({
    claimId: "a".repeat(64),
    laneRevision: BASE,
    declaredWriteScope: input.manifest.declaredWriteSet,
    writeSetDigest: input.manifest.writeSetDigest,
    actorId: ACTOR_ID,
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    operationReceiptDigest: "b".repeat(64),
    mutationAuthorityEligible: true,
    state: "waiting-successor",
    leaseEpoch: 1,
    transitionCounter: 1,
    expiresAt: CLAIM_EXPIRES_AT,
    fenceRevision: "c".repeat(64),
    transitionDigest: "d".repeat(64),
  });
  const inventoryCore = {
    ...input.verification.inventory,
    claims: [...input.verification.inventory.claims, successorClaim].sort(
      (left, right) => left.claimId.localeCompare(right.claimId),
    ),
  };
  delete inventoryCore.inventoryDigest;
  const inventory = {
    ...inventoryCore,
    inventoryDigest: digestValue(inventoryCore),
  };
  input.verification = markOperationDerivedCloudVerification(Object.freeze({
    ...input.verification,
    inventory,
    remoteClaimInventoryDigest: inventory.inventoryDigest,
  }));
  const report = evaluate(input);
  assert.equal(report.authoringAdmission.status, "planned");
  const successor = report.remoteClaims.find(item => item.claimId === "a".repeat(64));
  assert.equal(successor.classification, "waiting-successor");
  assert.deepEqual(successor.overlapReasons, ["waiting-behind-current-authority"]);
});

test("live root claim and continuation projections accept root state and receipt ledger digest", () => {
  const input = fixture();
  const candidate = input.verification.inventory.claims.find(
    claim => claim.claimId === CANDIDATE_ID,
  );
  for (const action of ["claim", "continue"]) {
    const authority = normalizeCloudAuthority({
      schema: "agentic-cloud-collaboration-result/v1",
      ok: true,
      action,
      ledgerRevision: LEDGER_REVISION,
      claimDigest: CANDIDATE_FENCE,
      claim: { ...candidate, state: "current" },
      receipt: { ledgerDigest: LEDGER_DIGEST },
    }, {
      ledgerRepository: "owner/agentic-canvas-os",
      targetRepository: "owner/agentic-canvas-os",
      manifest: input.manifest,
      canonicalBaseSha: BASE,
      now: new Date(EVALUATED_AT),
    });
    assert.equal(authority.state, "active");
    assert.equal(authority.ledgerDigest, LEDGER_DIGEST);
  }
});

test("bootstrap authorization fails closed on actor, lane, or live-owner drift", () => {
  const actorDrift = fixture();
  actorDrift.authorization.actorId = "github-user:someone-else";
  assert.throws(() => evaluate(actorDrift), /candidate bindings/u);

  const laneDrift = fixture();
  laneDrift.authorization.preservedLanes[0].stateDigest = "f".repeat(64);
  assert.throws(() => evaluate(laneDrift), /drifted/u);

  const liveOwner = fixture();
  const retiredLane = liveOwner.lanes.find(item => item.path === RETIRED);
  const liveRetiredClaim = claim({
    ...liveOwner.verification.inventory.claims[0],
    claimId: retiredLane.lease.cloudAuthority.claimId,
    laneRevision: retiredLane.head,
    declaredWriteScope: retiredLane.lease.admission.declaredWriteSet,
    writeSetDigest: retiredLane.lease.admission.writeSetDigest,
  });
  liveOwner.verification.inventory.claims.push(liveRetiredClaim);
  assert.throws(() => evaluate(liveOwner), /cannot replace current cloud ownership/u);

  const unownedMaintenancePath = fixture();
  unownedMaintenancePath.maintenanceProof = buildMaintenanceProof({
    changedPaths: ["scripts/not-owned.mjs"],
  });
  assert.throws(
    () => evaluate(unownedMaintenancePath),
    /maintenance bytes are not exactly allowlisted/u,
  );

  const leasedMaintenance = fixture();
  leasedMaintenance.maintenanceProof = buildMaintenanceProof({ leaseCount: 1 });
  assert.throws(
    () => evaluate(leasedMaintenance),
    /separate registered, dirty, unleased maintenance source lane/u,
  );
});

test("typed operator decision is exact, claim-bound, and digest-bound", () => {
  const input = fixture();
  const report = evaluate(input);
  assert.equal(
    report.rootSourceBootstrapAuthorization.operatorDecisionDigest,
    input.authorization.operatorDecision.decisionDigest,
  );

  for (const [field, value] of [
    ["authorizationToken", "AUTHORIZE SOMETHING ELSE"],
    ["explicit", false],
    ["approved", false],
    ["actorId", "github-user:someone-else"],
    ["candidateClaimId", "f".repeat(64)],
    ["maintenanceWorktreeCount", 2],
    ["preservationPolicy", "selected-lanes"],
    ["requiredSuccessor", "manual-lane"],
  ]) {
    const drifted = fixture();
    drifted.authorization.operatorDecision = buildOperatorDecision({ [field]: value });
    assert.throws(() => evaluate(drifted), /root-source bootstrap/iu);
  }

  const weakenedChanges = fixture();
  weakenedChanges.authorization.operatorDecision = buildOperatorDecision({
    allowedMaintenanceChanges: ["focused-tests"],
  });
  assert.throws(() => evaluate(weakenedChanges), /authorized values exactly/u);

  const weakenedForbiddance = fixture();
  weakenedForbiddance.authorization.operatorDecision = buildOperatorDecision({
    forbiddenOperations: ["cleanup", "deployment", "merge"],
  });
  assert.throws(() => evaluate(weakenedForbiddance), /authorized values exactly/u);

  const extraField = fixture();
  extraField.authorization.operatorDecision = buildOperatorDecision({ unexpected: true });
  assert.throws(() => evaluate(extraField), /fields are not exact/u);

  const forgedDigest = fixture();
  forgedDigest.authorization.operatorDecision.decisionDigest = "0".repeat(64);
  assert.throws(() => evaluate(forgedDigest), /decision digest is invalid/u);
});

test("without exact bootstrap authority unattributed and retired-overlap lanes block", () => {
  const input = fixture();
  input.authorization = null;
  const report = evaluate(input);
  assert.equal(report.authoringAdmission.status, "blocked");
  assert.ok(report.authoringAdmission.findings.some(
    finding => finding.type === "unattributed-lane-ambiguity",
  ));
  assert.ok(report.authoringAdmission.findings.some(
    finding => finding.type === "scope-admission-collision",
  ));
});

test("bootstrap authority is rechecked against the final cloud actor and expiry", () => {
  const input = fixture();
  const report = evaluate(input);
  assert.match(assertRootSourceBootstrapCurrent({
    report,
    remoteAuthorityVerification: input.verification,
    inspectMaintenanceSource: () => input.maintenanceProof,
  }), /^[0-9a-f]{64}$/u);
  assert.throws(() => assertRootSourceBootstrapCurrent({
    report,
    remoteAuthorityVerification: {
      ...input.verification,
      verifiedAt: AUTHORIZATION_EXPIRES_AT,
    },
    inspectMaintenanceSource: () => input.maintenanceProof,
  }), /expired or drifted/u);

  const decisionDrift = structuredClone(report);
  decisionDrift.rootSourceBootstrapAuthorization.operatorDecision.approved = false;
  assert.throws(() => assertRootSourceBootstrapCurrent({
    report: decisionDrift,
    remoteAuthorityVerification: input.verification,
    inspectMaintenanceSource: () => input.maintenanceProof,
  }), /approved decision must be true/u);
});

test("combined provisioning wires canonical-behind and canonical hook ownership", () => {
  const source = readFileSync(
    new URL("../scripts/device-branch.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /evaluateScopedLaneAdmission\(\{[\s\S]*canonicalSourceDisposition:\s*before\.canonicalSourceDisposition/u);
  assert.match(source, /bindControllerHooksEnvironment\(scriptControllerRoot\);[\s\S]*controllerRoot:\s*scriptControllerRoot/u);
  assert.match(source, /assertRootSourceBootstrapCurrent\(\{/u);
  assert.doesNotMatch(source, /Peer claim inventory changed after the Preservation Receipt/u);
});

function evaluate({
  authorization,
  cloudAuthority,
  manifest,
  verification,
  lanes,
  maintenanceProof,
  canonicalSourceDisposition = "exact",
}) {
  return evaluateScopedLaneAdmission({
    repository: ROOT,
    canonicalPath: ROOT,
    canonicalBaseSha: BASE,
    canonicalSourceDisposition,
    targetPath: TARGET,
    branch: "agent/operator/core",
    semanticScope: "core",
    targetSafe: true,
    manifest,
    lanes,
    cloudAuthority,
    remoteAuthorityRequired: true,
    remoteAuthorityVerification: verification,
    rootSourceBootstrapAuthorization: authorization,
    inspectRootSourceMaintenance: () => maintenanceProof,
    mode: "check",
    evaluatedAt: EVALUATED_AT,
  });
}

function lane(lanePath, {
  head = BASE,
  branch,
  dirty = false,
  lease = null,
} = {}) {
  return {
    path: lanePath,
    head,
    branch,
    detached: false,
    dirty,
    invalid: false,
    leaseAmbiguous: false,
    lease,
    stateDigest: digestValue({ lanePath, head, branch, dirty, lease }),
  };
}

function claim(source) {
  const core = {
    claimId: source.claimId,
    entrySchema: source.entrySchema,
    claimIdentitySchema: source.claimIdentitySchema,
    operationReceiptDigest: source.operationReceiptDigest,
    mutationAuthorityEligible: source.mutationAuthorityEligible,
    state: source.state,
    actorId: source.actorId,
    repositoryId: "github-repository:test",
    workItemId: `work-item:${source.claimId.slice(0, 16)}`,
    canonicalBaseRevision: BASE,
    laneRevision: source.laneRevision,
    declaredWriteScope: source.declaredWriteScope,
    writeSetDigest: source.writeSetDigest,
    leaseEpoch: source.leaseEpoch,
    transitionCounter: source.transitionCounter,
    heartbeatCounter: 0,
    reviewRequestId: null,
    expiresAt: source.expiresAt,
    fenceRevision: source.fenceRevision,
    transitionDigest: source.transitionDigest,
  };
  return Object.freeze({ ...core, recordDigest: digestValue(core) });
}

function admittedLease({
  lanePath,
  branch,
  scope,
  head,
  claimId,
  declaredWriteScope,
  writeSetDigest,
  leaseEpoch = 1,
}) {
  return {
    schema: "agentic-writer-lease/v2",
    status: "review_ready",
    branch,
    scope,
    device: "operator",
    sessionId: "peer-session",
    epoch: 1,
    worktreePath: lanePath,
    baseSha: BASE,
    fenceSha: head,
    reviewHeadSha: head,
    pullRequestUrl: "https://github.test/owner/repository/pull/1",
    admission: {
      schema: "agentic-lane-admission-lease/v1",
      status: "admitted",
      semanticScope: scope,
      declaredWriteSet: declaredWriteScope,
      writeSetDigest,
      admissionReceiptDigest: "3".repeat(64),
      preservationReceiptDigest: "4".repeat(64),
    },
    cloudAuthority: {
      schema: "agentic-lane-cloud-authority/v1",
      targetRepository: "owner/agentic-canvas-os",
      claimId,
      claimDigest: "5".repeat(64),
      claimLedgerRevision: "6".repeat(64),
      canonicalBaseSha: BASE,
      laneRevision: head,
      cloudDeclaredWriteScope: declaredWriteScope,
      writeSetDigest,
      leaseEpoch,
      transitionCounter: 2,
      state: "review_ready",
    },
  };
}
