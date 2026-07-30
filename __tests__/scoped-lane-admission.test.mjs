import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "../scripts/github-cloud-collaboration-mapping.mjs";
import { createAdmissionLeaseProjection, evaluateScopedLaneAdmission, normalizeCloudAuthority, normalizeDeclaredWriteScopeManifest } from "../scripts/scoped-lane-admission-lib.mjs";
import { verifyAdmissionCloudAuthority } from "../scripts/scoped-lane-cloud-authority.mjs";
import { assertAdmissionMutationAuthority, assertWorkspaceGuardsReady, attachAdmissionReceipt, collectScopedLaneState, finalizeScopedLaneAdmission, verifyPreservedLaneState } from "../scripts/scoped-lane-admission-state.mjs";
import { createWriterLeaseStore } from "../scripts/writer-lease-lib.mjs";
const canonicalSha = "a".repeat(40), fenceSha = "b".repeat(40);
const claimDigest = "2".repeat(64), claimLedgerRevision = "3".repeat(64), ledgerRevision = "c".repeat(40);
const ledgerDigest = "4".repeat(64), future = "2099-07-31T00:00:00.000Z", evaluationTime = "2026-07-30T00:00:00.000Z";
const repository = "/workspace/repository", canonicalPath = repository;
const targetPath = "/workspace/.worktrees/repository/scoped-runtime", branch = "agent/device/scoped-runtime";
function manifestFor(paths = ["scripts/scoped-runtime"]) {
  return normalizeDeclaredWriteScopeManifest({ schema: "agentic-declared-write-scope/v1",
    semanticScope: "scoped-runtime", paths }, { expectedScope: "scoped-runtime" });
}
function publicClaim(manifest, overrides = {}) {
  const { claimId: suppliedClaimId, ...overrideFields } = overrides;
  const claim = {
    state: "active",
    actorId: "github-user:1",
    deviceId: "device",
    sessionId: "session",
    repositoryId: "github-repository:R_1",
    workItemId: "work-item:scope",
    canonicalBaseRevision: canonicalSha,
    laneRevision: canonicalSha,
    declaredWriteScope: manifest.declaredWriteSet,
    writeSetDigest: manifest.writeSetDigest,
    leaseEpoch: 1,
    transitionCounter: 1,
    heartbeatCounter: 0,
    reviewRequestId: null,
    expiresAt: future,
    fenceRevision: claimDigest,
    transitionDigest: claimLedgerRevision,
    ...overrideFields,
  };
  const claimId = suppliedClaimId || digestValue({
    actorId: claim.actorId, canonicalBaseRevision: claim.canonicalBaseRevision,
    deviceId: pseudonymousIdentifier("device", claim.deviceId),
    leaseEpoch: claim.leaseEpoch, repositoryId: claim.repositoryId,
    sessionId: pseudonymousIdentifier("session", claim.sessionId),
    workItemId: claim.workItemId, writeSetDigest: claim.writeSetDigest,
  });
  return { claimId, ...claim };
}
function cloudResult(manifest, overrides = {}) {
  const claim = publicClaim(manifest, overrides.claim || {});
  return {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: overrides.action || "claim",
    status: "active",
    ledgerRevision: overrides.ledgerRevision || ledgerRevision,
    claimDigest: claim.fenceRevision,
    claim,
    findings: [],
    receipt: { ledgerDigest: overrides.ledgerDigest || ledgerDigest,
      receiptDigest: overrides.receiptDigest || "5".repeat(64), evaluationTime },
  };
}
function authorityFor(manifest, overrides = {}) {
  return Object.freeze({
    ...normalizeCloudAuthority(cloudResult(manifest), {
      ledgerRepository: "owner/agentic-canvas-os", targetRepository: "owner/repository",
      manifest, canonicalBaseSha: canonicalSha, now: new Date(evaluationTime),
    }),
    ...overrides,
  });
}
function verifiedBundle(authority, manifest, claims = null) {
  const candidate = publicClaim(manifest, {
    claimId: authority.claimId,
    laneRevision: authority.laneRevision,
    leaseEpoch: authority.leaseEpoch,
    transitionCounter: authority.transitionCounter,
    reviewRequestId: authority.reviewRequestId,
    expiresAt: authority.expiresAt,
    fenceRevision: authority.claimDigest,
    transitionDigest: authority.claimLedgerRevision,
  });
  const inventoryClaims = claims || [candidate];
  return verifyAdmissionCloudAuthority({
    authority,
    manifest,
    canonicalBaseSha: canonicalSha,
    inspect: () => ({ schema: "agentic-cloud-collaboration-result/v1", ok: true,
      action: "status", status: "ready", ledgerRevision: authority.ledgerRevision,
      ledgerDigest, claims: inventoryClaims }),
    invoke: () => cloudResult(manifest, {
      action: "verify", ledgerRevision: authority.ledgerRevision, claim: candidate,
    }),
  });
}
function laneState({ lanePath, laneBranch, head = canonicalSha, treeSha = canonicalSha,
  dirty = false, lease = null, invalid = false }) {
  const state = { path: lanePath, head, branch: laneBranch, detached: !laneBranch,
    dirty, invalid, treeSha, indexDigest: digestValue(""),
    workingTreeDigest: digestValue({ status: "", workingFiles: [] }),
    leaseAmbiguous: false, lease };
  return { ...state, stateDigest: digestValue(state) };
}
function ownedLease({ scope, lanePath, writeSet, authority, epoch = 126 }) {
  const laneBranch = `agent/peer/${scope}`;
  return {
    schema: "agentic-writer-lease/v2",
    status: "active", epoch, sessionId: "peer-session", device: "peer", scope,
    branch: laneBranch, worktreePath: lanePath, baseSha: canonicalSha, fenceSha,
    pullRequestUrl: "https://github.test/owner/repository/pull/9",
    expiresAt: future,
    admission: {
      schema: "agentic-lane-admission-lease/v1", status: "admitted",
      semanticScope: scope, declaredWriteSet: writeSet,
      writeSetDigest: digestValue(writeSet),
      manifestDigest: "6".repeat(64),
      planReceiptDigest: "7".repeat(64),
      admissionReceiptDigest: "8".repeat(64),
      admittedReportDigest: "9".repeat(64),
      preservationReceiptDigest: "a".repeat(64),
      existingLaneStateDigest: "b".repeat(64),
    },
    cloudAuthority: {
      ...authority,
      canonicalBaseSha: canonicalSha, laneRevision: fenceSha,
      cloudDeclaredWriteScope: writeSet,
      writeSetDigest: digestValue(writeSet),
      deviceId: "peer", sessionId: "peer-session",
      reviewRequestId: "github-pull-request:PR_peer",
      leaseEpoch: 1, expiresAt: future,
    },
  };
}
function authorityForPublicClaim(authority, claim) {
  return {
    ...authority,
    claimId: claim.claimId, claimDigest: claim.fenceRevision,
    claimLedgerRevision: claim.transitionDigest,
    canonicalBaseSha: claim.canonicalBaseRevision,
    laneRevision: claim.laneRevision,
    cloudDeclaredWriteScope: claim.declaredWriteScope,
    writeSetDigest: claim.writeSetDigest,
    leaseEpoch: claim.leaseEpoch, transitionCounter: claim.transitionCounter,
    state: claim.state.replaceAll("-", "_"),
    expiresAt: claim.expiresAt,
  };
}
function peerFixture(authority) {
  const peerPath = "/workspace/.worktrees/repository/peer-docs";
  const peerWriteSet = ["path:docs/peer", "semantic:peer-docs"];
  const peer = publicClaim({
    declaredWriteSet: peerWriteSet, writeSetDigest: digestValue(peerWriteSet),
  }, {
    deviceId: "peer", sessionId: "peer-session",
    laneRevision: fenceSha,
    fenceRevision: "f".repeat(64), transitionDigest: "0".repeat(64),
    transitionCounter: 2, reviewRequestId: "github-pull-request:PR_peer",
  });
  const lease = ownedLease({ scope: "peer-docs", lanePath: peerPath,
    writeSet: peerWriteSet, authority: authorityForPublicClaim(authority, peer) });
  const lane = laneState({ lanePath: peerPath,
    laneBranch: "refs/heads/agent/peer/peer-docs", head: fenceSha, dirty: true, lease });
  return { peerPath, peer, lease, lane };
}
function evaluate({ manifest, lanes, authority, verification, ...overrides }) {
  return evaluateScopedLaneAdmission({
    repository, canonicalPath,
    canonicalBaseSha: canonicalSha,
    targetPath, branch,
    semanticScope: "scoped-runtime",
    targetSafe: true,
    manifest, lanes,
    cloudAuthority: authority,
    remoteAuthorityRequired: true,
    remoteAuthorityVerification: verification,
    evaluatedAt: evaluationTime,
    mode: "check",
    ...overrides,
  });
}
function canonicalLane() {
  return laneState({ lanePath: canonicalPath, laneBranch: "refs/heads/main" });
}
test("manifest maps public declaredWriteSet deterministically", () => {
  const manifest = manifestFor([
    "scripts/scoped-runtime/file.mjs",
    "docs/scoped-runtime.md",
  ]);
  assert.deepEqual(manifest.declaredWriteSet, [
    "path:docs/scoped-runtime.md",
    "path:scripts/scoped-runtime/file.mjs",
    "semantic:scoped-runtime",
  ]);
  assert.deepEqual(authorityFor(manifest).cloudDeclaredWriteScope, manifest.declaredWriteSet);
  assert.throws(() => manifestFor(["scripts/**"]), /wildcards/);
});
test("pre-provision check remains planned and emits an Admission Receipt", () => {
  const manifest = manifestFor();
  const authority = authorityFor(manifest);
  const verified = verifiedBundle(authority, manifest);
  let report = evaluate({
    manifest,
    authority,
    verification: verified.verification,
    lanes: [canonicalLane()],
  });
  assert.equal(report.authoringAdmission.status, "planned");
  assert.equal(report.runtimeReadiness.status, "unevaluated");
  assert.equal(report.lifecycleReadiness.status, "unevaluated");
  assert.equal(report.admissionRuntimeConformance.status, "unevaluated");
  report = attachAdmissionReceipt({
    report,
    targetObservationDigest: "d".repeat(64),
    remoteAuthorityVerification: verified.verification,
  });
  const projection = createAdmissionLeaseProjection(report);
  assert.equal(projection.status, "planned");
  assert.equal(projection.admissionReceiptDigest, report.admissionReceipt.receiptDigest);
});
test("complete operation-derived remote inventory is emitted and overlap blocks", () => {
  const manifest = manifestFor(["scripts/scoped-runtime/child"]);
  const authority = authorityFor(manifest);
  const peerManifest = normalizeDeclaredWriteScopeManifest({
    schema: "agentic-declared-write-scope/v1",
    semanticScope: "peer",
    paths: ["scripts/scoped-runtime"],
  });
  const peer = publicClaim(peerManifest, {
    claimId: "e".repeat(64),
    fenceRevision: "f".repeat(64),
    transitionDigest: "0".repeat(64),
  });
  const candidate = publicClaim(manifest);
  const verified = verifiedBundle(authority, manifest, [candidate, peer]);
  const report = evaluate({
    manifest,
    authority,
    verification: verified.verification,
    lanes: [canonicalLane()],
  });
  assert.equal(verified.verification.inventory.claims.length, 2);
  assert.equal(report.remoteClaimInventoryDigest, verified.verification.remoteClaimInventoryDigest);
  assert.equal(report.authoringAdmission.status, "blocked");
  assert.ok(report.authoringAdmission.findings.some(
    finding => finding.type === "scope-admission-collision",
  ));
});
test("disjoint attributed dirty lane preserves independent local and cloud epochs", () => {
  const manifest = manifestFor();
  const authority = authorityFor(manifest);
  const { peerPath, peer, lease, lane } = peerFixture(authority);
  const verified = verifiedBundle(authority, manifest, [publicClaim(manifest), peer]);
  const report = evaluate({
    manifest,
    authority,
    verification: verified.verification,
    lanes: [canonicalLane(), lane],
  });
  assert.equal(report.authoringAdmission.status, "planned");
  assert.equal(report.lanes.find(lane => lane.path === peerPath).classification, "disjoint-attributed");
  assert.equal(lease.epoch, 126);
  assert.equal(lease.cloudAuthority.leaseEpoch, 1);
});
test("peer attribution requires an exact current operation-derived remote join", () => {
  const manifest = manifestFor();
  const authority = authorityFor(manifest);
  const { peerPath, peer, lane } = peerFixture(authority);
  const fabricatedScope = ["path:docs/fabricated", "semantic:peer-docs"];
  const remoteVariants = [
    ["missing", []],
    ["fabricated identity", [{ ...peer, claimId: "d".repeat(64) }]],
    ["stale fence", [{ ...peer, fenceRevision: "d".repeat(64) }]],
    ["stale transition", [{ ...peer, transitionDigest: "d".repeat(64) }]],
    ["stale base", [{ ...peer, canonicalBaseRevision: "d".repeat(40) }]],
    ["stale lane", [{ ...peer, laneRevision: "d".repeat(40) }]],
    ["fabricated scope", [{
      ...peer,
      declaredWriteScope: fabricatedScope,
      writeSetDigest: digestValue(fabricatedScope),
    }]],
    ["stale cloud epoch", [{ ...peer, leaseEpoch: 2 }]],
    ["stale transition counter", [{ ...peer, transitionCounter: 3 }]],
    ["stale state", [{ ...peer, state: "review-ready" }]],
    ["stale expiry", [{ ...peer, expiresAt: "2099-08-01T00:00:00.000Z" }]],
  ];
  for (const [label, remotePeers] of remoteVariants) {
    const verified = verifiedBundle(authority, manifest, [
      publicClaim(manifest),
      ...remotePeers,
    ]);
    const report = evaluate({
      manifest,
      authority,
      verification: verified.verification,
      lanes: [canonicalLane(), lane],
    });
    const observed = report.lanes.find(lane => lane.path === peerPath);
    assert.equal(observed.classification, "ambiguous", label);
    assert.equal(report.authoringAdmission.status, "blocked", label);
    assert.equal(report.admissionRuntimeConformance.status, "unevaluated", label);
  }
});
test("semantic equality, parent-child overlap, and ambiguous legacy lanes block", () => {
  const manifest = manifestFor(["scripts/scoped-runtime/child"]);
  const authority = authorityFor(manifest);
  const verified = verifiedBundle(authority, manifest);
  for (const { scope, writeSet, legacy = false } of [
    {
      scope: "scoped-runtime",
      writeSet: ["path:docs/disjoint", "semantic:scoped-runtime"],
    },
    {
      scope: "peer",
      writeSet: ["path:scripts/scoped-runtime", "semantic:peer"],
    },
    {
      scope: "legacy",
      writeSet: ["path:docs/legacy", "semantic:legacy"],
      legacy: true,
    },
  ]) {
    const peerPath = `/workspace/.worktrees/repository/${scope}`;
    const lease = ownedLease({ scope, lanePath: peerPath, writeSet, authority });
    if (legacy) {
      delete lease.admission;
      delete lease.cloudAuthority;
    }
    const report = evaluate({
      manifest,
      authority,
      verification: verified.verification,
      lanes: [
        canonicalLane(),
        laneState({
          lanePath: peerPath,
          laneBranch: `refs/heads/agent/peer/${scope}`,
          lease,
        }),
      ],
    });
    assert.equal(report.authoringAdmission.status, "blocked");
  }
});
test("canonical drift and caller-supplied verification fail closed", () => {
  const manifest = manifestFor();
  const authority = authorityFor(manifest);
  const report = evaluate({
    manifest,
    authority,
    verification: {
      schema: "agentic-lane-cloud-verification/v1",
      status: "ready",
    },
    lanes: [laneState({
      lanePath: canonicalPath,
      laneBranch: "refs/heads/main",
      head: "d".repeat(40),
    })],
  });
  assert.equal(report.authoringAdmission.status, "blocked");
  assert.deepEqual(
    report.authoringAdmission.findings.map(item => item.type).sort(),
    ["canonical-base-drift", "cloud-authority-unproven"],
  );
});
test("joined receipts finalize admitted while peer drift blocks", () => {
  const manifest = manifestFor();
  const fresh = authorityFor(manifest);
  const freshVerified = verifiedBundle(fresh, manifest);
  let report = evaluate({
    manifest,
    authority: fresh,
    verification: freshVerified.verification,
    lanes: [canonicalLane()],
  });
  report = attachAdmissionReceipt({
    report,
    targetObservationDigest: "d".repeat(64),
    remoteAuthorityVerification: freshVerified.verification,
  });
  const bound = {
    ...fresh,
    claimDigest: "e".repeat(64),
    claimLedgerRevision: "f".repeat(64),
    laneRevision: fenceSha,
    deviceId: "device",
    sessionId: "session",
    reviewRequestId: "github-pull-request:PR_1",
    transitionCounter: 2,
  };
  const boundVerified = verifiedBundle(bound, manifest);
  const plannedAdmission = createAdmissionLeaseProjection(report);
  const lease = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 126,
    sessionId: "session",
    device: "device",
    scope: "scoped-runtime",
    branch,
    worktreePath: targetPath,
    baseSha: canonicalSha,
    fenceSha,
    pullRequestUrl: "https://github.test/owner/repository/pull/42",
    expiresAt: future,
    admission: plannedAdmission,
    cloudAuthority: bound,
  };
  for (const drift of [
    { state: "review_ready" }, { expiresAt: "2099-08-01T00:00:00.000Z" },
    { leaseEpoch: 2 }, { transitionCounter: 3 }, { reviewRequestId: "other" },
    { writeSetDigest: "0".repeat(64) },
    { cloudDeclaredWriteScope: ["path:other", "semantic:scoped-runtime"] },
    { canonicalBaseSha: "d".repeat(40) }, { laneRevision: "d".repeat(40) },
    { claimId: "d".repeat(64) },
  ]) {
    const driftedAuthority = { ...bound, ...drift };
    assert.throws(() => assertAdmissionMutationAuthority({
      lease: { ...lease, cloudAuthority: driftedAuthority },
      cloudAuthority: driftedAuthority,
      remoteAuthorityVerification: boundVerified.verification,
      allowPlanned: true,
    }), /current joined cloud and local lease authority/);
  }
  const baseTreeSha = "6".repeat(40);
  const candidate = laneState({ lanePath: targetPath,
    laneBranch: `refs/heads/${branch}`, head: fenceSha, treeSha: baseTreeSha, lease });
  const beforeRegistrationInventoryDigest = "2".repeat(64);
  const afterRegistrationInventoryDigest = "3".repeat(64);
  const operationIdentity = {
    target: targetPath, baseSha: canonicalSha, baseTreeSha,
    expectedTargetObservationDigest: "d".repeat(64),
    beforeRegistrationInventoryDigest, afterRegistrationInventoryDigest,
  };
  const operationCore = {
    schema: "agentic-candidate-create-register-result/v1",
    status: "created",
    operationId: digestValue(operationIdentity),
    targetPath,
    baseSha: canonicalSha,
    baseTreeSha,
    candidateRegistrationDigest: "4".repeat(64),
    expectedTargetObservationDigest: "d".repeat(64),
    beforeRegistrationInventoryDigest,
    afterRegistrationInventoryDigest,
    mutationSet: ["candidate-registration"],
  };
  const operation = { ...operationCore, resultDigest: digestValue(operationCore) };
  const preservation = verifyPreservedLaneState(
    report,
    [canonicalLane(), candidate],
    {
      lease,
      candidateCreateRegisterResult: operation,
      remoteAuthorityVerification: boundVerified.verification,
    },
  );
  const admitted = finalizeScopedLaneAdmission({
    report,
    lease,
    preservationReceipt: preservation,
    cloudAuthority: bound,
    remoteAuthorityVerification: boundVerified.verification,
  });
  assert.equal(admitted.authoringAdmission.status, "admitted");
  assert.equal(admitted.admissionRuntimeConformance.status, "unevaluated");
  assert.equal(createAdmissionLeaseProjection(admitted).status, "admitted");
  const schema = JSON.parse(readFileSync(
    new URL("../docs/schemas/scoped-lane-admission-report.v1.schema.json", import.meta.url),
    "utf8",
  ));
  const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
  assert.equal(validate(report), true, JSON.stringify(validate.errors));
  assert.equal(validate(admitted), true, JSON.stringify(validate.errors));
  const missingEvidence = ["planReportDigest", "mutationAuthorityReceipt"].map(field => {
    const invalid = structuredClone(admitted);
    delete invalid[field];
    return invalid;
  });
  const wrongStatus = structuredClone(admitted);
  wrongStatus.authoringAdmission.status = "planned";
  for (const invalid of [
    ...missingEvidence,
    { ...admitted, admissionReceipt: null },
    { ...admitted, preservationReceipt: null },
    { ...admitted, mode: "check" },
    wrongStatus,
  ]) assert.equal(validate(invalid), false);
  const peer = publicClaim(manifest, {
    claimId: "9".repeat(64),
    fenceRevision: "8".repeat(64),
    transitionDigest: "7".repeat(64),
  });
  const drifted = verifiedBundle(bound, manifest, [
    boundVerified.verification.inventory.claims[0],
    peer,
  ]);
  assert.throws(() => verifyPreservedLaneState(
    report,
    [canonicalLane(), candidate],
    {
      lease,
      candidateCreateRegisterResult: operation,
      remoteAuthorityVerification: drifted.verification,
    },
  ), /peer-operation receipt/);
});
test("lane collection rejects torn snapshots and guard check never rewrites hooks", () => {
  let reads = 0;
  const git = (_cwd, args) => {
    const key = args.join(" ");
    if (key === "worktree list --porcelain -z") {
      reads += 1;
      const head = reads === 1 ? canonicalSha : "d".repeat(40);
      return `worktree ${repository}\0HEAD ${head}\0branch refs/heads/main\0`;
    }
    if (key === "rev-parse origin/main") return canonicalSha;
    if (key === "rev-parse HEAD^{tree}") return canonicalSha;
    if (key.includes("status --porcelain")) return "";
    if (key.startsWith("ls-files")) return "";
    throw new Error(`unexpected git command: ${key}`);
  };
  assert.throws(() => collectScopedLaneState({
    repository,
    git,
    readLeases: () => [],
  }), /changed during admission inspection/);
  const root = mkdtempSync(path.join(os.tmpdir(), "lane-guards-"));
  const controller = path.join(root, "controller");
  const configured = path.join(root, "installed", ".githooks");
  const source = path.join(controller, ".githooks");
  try {
    mkdirSync(configured, { recursive: true });
    mkdirSync(source, { recursive: true });
    for (const hook of ["git-guarded", "pre-commit", "pre-push", "reference-transaction"]) {
      writeFileSync(path.join(configured, hook), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      writeFileSync(path.join(source, hook), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    }
    const calls = [];
    const readiness = options => assertWorkspaceGuardsReady({
      repository: root,
      controllerRoot: controller,
      git: (_cwd, args) => {
        calls.push(args);
        return options.hooksPath;
      },
    });
    assert.throws(() => readiness({ hooksPath: configured }), /canonical controller hook source/);
    assert.equal(readiness({ hooksPath: source }).hooksPath, source);
    assert.equal(calls.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("writer heartbeat expiry is cloud-capped with independent local epoch", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "lease-cap-"));
  const now = new Date("2026-07-30T00:00:00.000Z");
  try {
    const store = createWriterLeaseStore({ gitCommonDir: root, now: () => now });
    const cap = "2026-07-30T00:02:00.000Z";
    const lease = store.claim({
      sessionId: "session",
      device: "device",
      scope: "scoped-runtime",
      branch,
      worktreePath: targetPath,
      baseSha: canonicalSha,
      previousEpoch: 125,
      ttlMs: 30 * 60_000,
      expiresAtCap: cap,
    });
    assert.equal(lease.epoch, 126);
    assert.equal(lease.expiresAt, cap);
    assert.equal(store.heartbeat({
      sessionId: "session", branch, ttlMs: 30 * 60_000, expiresAtCap: cap,
    }).expiresAt, cap);
    const lockPath = path.join(root, "agentic-canvas-os", "writer-leases.lock");
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, token: "live" }));
    utimesSync(lockPath, new Date(now.getTime() - 60_000), new Date(now.getTime() - 60_000));
    assert.throws(() => store.withRegistryLock(() => {}), /in progress/);
    unlinkSync(lockPath);
    writeFileSync(lockPath, JSON.stringify({ pid: 999_999_999, token: "abandoned" }));
    assert.throws(() => store.withRegistryLock(() => {}), /owner-led recovery/);
    unlinkSync(lockPath);
    store.withRegistryLock(() => {
      unlinkSync(lockPath);
      writeFileSync(lockPath, JSON.stringify({ pid: process.pid, token: "replacement" }));
    });
    assert.equal(existsSync(lockPath), true);
    unlinkSync(lockPath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
