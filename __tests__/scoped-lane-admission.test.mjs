import test from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
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
function scopedAdmissionScriptFunction(name) {
  const source = readFileSync(
    new URL("../scripts/scoped-lane-admission.mjs", import.meta.url),
    "utf8",
  );
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf("\nfunction ", start + 1);
  assert.notEqual(start, -1, `${name} must exist in scoped-lane-admission.mjs`);
  assert.notEqual(end, -1, `${name} must be followed by another function`);
  return runInNewContext(`(${source.slice(start, end).trim()})`, { digestValue });
}
function manifestFor(paths = ["scripts/scoped-runtime"]) {
  return normalizeDeclaredWriteScopeManifest({ schema: "agentic-declared-write-scope/v1",
    semanticScope: "scoped-runtime", paths }, { expectedScope: "scoped-runtime" });
}

test("planned recovery separates exact downstream replay from root bootstrap", () => {
  const createPlanRecoveryReceipt = scopedAdmissionScriptFunction(
    "createPlanRecoveryReceipt",
  );
  const isRootSourceRecovery = scopedAdmissionScriptFunction(
    "isRootSourceRecovery",
  );
  const laneStateDigest = "3".repeat(64);
  const previousAdmission = {
    status: "planned",
    planReceiptDigest: "1".repeat(64),
    admissionReceiptDigest: "2".repeat(64),
    existingLaneStateDigest: laneStateDigest,
  };
  const report = {
    authoringAdmission: { status: "planned" },
    admissionReceipt: {
      status: "accepted",
      receiptDigest: "4".repeat(64),
    },
    reportDigest: "5".repeat(64),
    existingLaneStateDigest: laneStateDigest,
    rootSourceBootstrapAuthorization: null,
  };

  const downstream = createPlanRecoveryReceipt({
    previousAdmission,
    report,
    allowExactDownstreamRecovery: true,
  });
  const replay = createPlanRecoveryReceipt({
    previousAdmission,
    report,
    allowExactDownstreamRecovery: true,
  });
  assert.equal(downstream.schema, "agentic-lane-admission-plan-recovery/v2");
  assert.equal(downstream.status, "accepted");
  assert.equal(downstream.recoveryMode, "exact-downstream-finalization");
  assert.equal(downstream.reason, "exact-plan-replay");
  assert.equal(downstream.rootSourceBootstrapAuthorizationDigest, null);
  assert.equal(downstream.maintenanceSourcePath, null);
  assert.equal(replay.receiptDigest, downstream.receiptDigest);

  assert.throws(() => createPlanRecoveryReceipt({
    previousAdmission,
    report: { ...report, existingLaneStateDigest: "6".repeat(64) },
    allowExactDownstreamRecovery: true,
  }), /exact downstream evidence/u);
  const bootstrap = {
    authorizationDigest: "7".repeat(64),
    maintenanceSourcePath: "/workspace/root-maintenance",
  };
  assert.throws(() => createPlanRecoveryReceipt({
    previousAdmission,
    report: {
      ...report,
      existingLaneStateDigest: "6".repeat(64),
      rootSourceBootstrapAuthorization: bootstrap,
    },
    allowExactDownstreamRecovery: true,
  }), /exact downstream evidence/u);
  assert.throws(() => createPlanRecoveryReceipt({
    previousAdmission,
    report,
    allowExactDownstreamRecovery: false,
  }), /root-source bootstrap authorization/u);

  const root = createPlanRecoveryReceipt({
    previousAdmission,
    report: {
      ...report,
      existingLaneStateDigest: "6".repeat(64),
      rootSourceBootstrapAuthorization: bootstrap,
    },
    allowExactDownstreamRecovery: false,
  });
  assert.equal(root.recoveryMode, "root-source-bootstrap");
  assert.equal(root.reason, "operator-authorized-maintenance-replan");
  assert.equal(root.rootSourceBootstrapAuthorizationDigest, bootstrap.authorizationDigest);
  assert.equal(root.maintenanceSourcePath, bootstrap.maintenanceSourcePath);

  assert.equal(isRootSourceRecovery({
    targetRepository: "HuijooHwee/Agentic-Canvas-OS",
    ledgerRepository: "huijoohwee/agentic-canvas-os",
  }), true);
  assert.equal(isRootSourceRecovery({
    targetRepository: "huijoohwee/knowgrph",
    ledgerRepository: "huijoohwee/agentic-canvas-os",
  }), false);
  for (const invalid of [
    { previousAdmission: { ...previousAdmission, status: "admitted" }, report },
    { previousAdmission: { ...previousAdmission, existingLaneStateDigest: "" }, report },
    { previousAdmission, report: {
      ...report,
      authoringAdmission: { status: "admitted" },
    } },
    { previousAdmission, report: {
      ...report,
      admissionReceipt: { ...report.admissionReceipt, status: "rejected" },
    } },
  ]) {
    assert.throws(() => createPlanRecoveryReceipt({
      ...invalid,
      allowExactDownstreamRecovery: true,
    }), /exact downstream evidence/u);
  }
});
function publicClaim(manifest, overrides = {}) {
  const { claimId: suppliedClaimId, ...overrideFields } = overrides;
  const claim = {
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    operationReceiptDigest: "1".repeat(64),
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
    leaseEpoch: claim.leaseEpoch, repositoryId: claim.repositoryId,
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
    ledgerDigest: overrides.ledgerDigest || ledgerDigest,
    claimDigest: claim.fenceRevision,
    claim,
    findings: [],
    receipt: { ledgerDigest: overrides.ledgerDigest || ledgerDigest,
      receiptDigest: overrides.receiptDigest || "5".repeat(64), evaluationTime },
  };
}
function verificationResult({
  claim,
  claims,
  ledgerRevision: resultLedgerRevision = ledgerRevision,
  ledgerDigest: resultLedgerDigest = ledgerDigest,
  evaluationTime: resultEvaluationTime = evaluationTime,
  contractReceiptDigest = "5".repeat(64),
  subject = undefined,
} = {}) {
  const currentClaimInventoryCore = {
    schema: "agentic-cloud-collaboration-current-claim-inventory/v1",
    ledgerRevision: resultLedgerRevision,
    ledgerDigest: resultLedgerDigest,
    evaluationTime: resultEvaluationTime,
    claims,
  };
  const currentClaimInventory = {
    ...currentClaimInventoryCore,
    claimInventoryDigest: digestValue(currentClaimInventoryCore),
  };
  const receiptCore = {
    schema: "agentic-cloud-collaboration-github-verification/v1",
    ok: true,
    ledgerRevision: resultLedgerRevision,
    ledgerDigest: resultLedgerDigest,
    claimId: claim.claimId,
    claimDigest: claim.fenceRevision,
    contractReceiptDigest,
    claimInventoryDigest: currentClaimInventory.claimInventoryDigest,
    evaluationTime: resultEvaluationTime,
    findings: [],
  };
  return {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "verify",
    status: "ready",
    ledgerRevision: resultLedgerRevision,
    claimDigest: claim.fenceRevision,
    claim,
    currentClaimInventory,
    ...(subject ? { subject } : {}),
    findings: [],
    receipt: { ...receiptCore, receiptDigest: digestValue(receiptCore) },
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
    const inventoryClaims = (claims || [candidate]).map((claim) => {
      if (claim.claimId === candidate.claimId) return candidate;
      const { recordDigest, ...publicClaimShape } = claim;
      return publicClaimShape;
    });
  return verifyAdmissionCloudAuthority({
    authority,
    manifest,
    canonicalBaseSha: canonicalSha,
    inspect: () => ({ schema: "agentic-cloud-collaboration-result/v1", ok: true,
      action: "status", status: "ready", ledgerRevision: authority.ledgerRevision,
      ledgerDigest, claims: inventoryClaims }),
      invoke: () => verificationResult({
        claim: candidate,
        claims: inventoryClaims,
        ledgerRevision: authority.ledgerRevision,
        contractReceiptDigest: "5".repeat(64),
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
    ledgerDigest,
    claimLedgerRevision: claim.transitionDigest,
    entrySchema: claim.entrySchema,
    claimIdentitySchema: claim.claimIdentitySchema,
    operationReceiptDigest: claim.operationReceiptDigest,
    mutationAuthorityEligible:
      claim.entrySchema === "agentic-cloud-collaboration-entry/v2",
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
function deliveryPeerFixture(authority, {
  refreshed = true,
  heartbeatCount = 1,
  dirty = false,
} = {}) {
  const peerPath = "/workspace/.worktrees/repository/peer-delivery";
  const peerWriteSet = [
    "path:docs/peer-delivery",
    "semantic:peer-delivery",
  ];
  const reviewedHeadSha = "d".repeat(40);
  const observedHeadSha = refreshed ? "e".repeat(40) : reviewedHeadSha;
  const mainParentSha = "f".repeat(40);
  const peerTreeSha = "1".repeat(40);
  const historicalLedgerRevision = "6".repeat(40);
  const reviewRequestId = "github-pull-request:PR_peer";
  const focusedEvidenceDigest = "e".repeat(64);
  const identity = {
    actorId: "github-user:peer",
    deviceId: pseudonymousIdentifier("device", "peer"),
    sessionId: pseudonymousIdentifier("session", "peer-session"),
    repositoryId: "github-repository:R_peer",
    workItemId: "work-item:peer-delivery",
    canonicalBaseRevision: canonicalSha,
    declaredWriteScope: peerWriteSet,
    writeSetDigest: digestValue(peerWriteSet),
    laneRevision: reviewedHeadSha,
    leaseEpoch: 1,
    predecessorClaimId: null,
  };
  const peerClaimId = digestValue({
    actorId: identity.actorId,
    canonicalBaseRevision: identity.canonicalBaseRevision,
    deviceId: identity.deviceId,
    leaseEpoch: identity.leaseEpoch,
    repositoryId: identity.repositoryId,
    sessionId: identity.sessionId,
    workItemId: identity.workItemId,
    writeSetDigest: identity.writeSetDigest,
  });
  const claimCore = overrides => ({
    claimId: peerClaimId,
    ...identity,
    handoff: null,
    release: null,
    ...overrides,
  });
  const activeCore = claimCore({
    state: "active",
    transitionCounter: 1,
    heartbeatCounter: 0,
    expiresAt: future,
    evidenceDigest: null,
    reviewRequestId: null,
  });
  const reviewCore = claimCore({
    state: "review-ready",
    transitionCounter: 2,
    heartbeatCounter: 0,
    expiresAt: future,
    evidenceDigest: focusedEvidenceDigest,
    reviewRequestId,
  });
  const deliveryAuthorization = {
    focusedEvidenceDigest,
    integrationIntentDigest: "a".repeat(64),
    operatorDecisionDigest: "b".repeat(64),
    evaluationTime: "2026-07-30T00:00:03.000Z",
  };
  const deliveryCore = claimCore({
    state: "delivery-authorized",
    transitionCounter: 3,
    heartbeatCounter: 0,
    expiresAt: future,
    evidenceDigest: focusedEvidenceDigest,
    reviewRequestId,
    deliveryAuthorization,
  });
  const entries = [];
  entries.push(deliveryLedgerEntry({ action: "claim", core: activeCore, entries }));
  entries.push(deliveryLedgerEntry({ action: "review-ready", core: reviewCore, entries }));
  const historicalLedger = deliveryLedger(entries);
  entries.push(deliveryLedgerEntry({ action: "delivery-authorize", core: deliveryCore, entries }));
  for (let index = 0; index < heartbeatCount; index += 1) {
    entries.push(deliveryLedgerEntry({
      action: "heartbeat",
      core: claimCore({
        state: "delivery-authorized",
        transitionCounter: 4 + index,
        heartbeatCounter: 1 + index,
        expiresAt: "2099-08-01T00:00:00.000Z",
        evidenceDigest: focusedEvidenceDigest,
        reviewRequestId,
        deliveryAuthorization,
      }),
      entries,
    }));
  }
  const currentLedger = deliveryLedger(entries);
  const reviewedPeer = deliveryPublicClaim(historicalLedger.entries.at(-1));
  const deliveryPeer = deliveryPublicClaim(currentLedger.entries.at(-1));
  const localAuthority = {
    ...authorityForPublicClaim(authority, reviewedPeer),
    ledgerRevision: historicalLedgerRevision,
    focusedEvidenceDigest,
    reviewRequestId,
  };
  const lease = ownedLease({
    scope: "peer-delivery",
    lanePath: peerPath,
    writeSet: peerWriteSet,
    authority: localAuthority,
  });
  lease.status = "review_ready";
  lease.reviewHeadSha = reviewedHeadSha;
  lease.cloudAuthority = {
    ...lease.cloudAuthority,
    ...localAuthority,
    canonicalBaseSha: canonicalSha,
    laneRevision: reviewedHeadSha,
    cloudDeclaredWriteScope: peerWriteSet,
    writeSetDigest: digestValue(peerWriteSet),
    deviceId: "peer",
    sessionId: "peer-session",
  };
  const lane = laneState({
    lanePath: peerPath,
    laneBranch: "refs/heads/agent/peer/peer-delivery",
    head: observedHeadSha,
    treeSha: peerTreeSha,
    dirty,
    lease,
  });
  const pullRequest = {
    id: "PR_peer",
    url: lease.pullRequestUrl,
    state: "OPEN",
    isDraft: false,
    headRefName: lease.branch,
    headRefOid: observedHeadSha,
    headRepository: { nameWithOwner: authority.targetRepository },
    baseRefName: "main",
    baseRefOid: refreshed ? mainParentSha : canonicalSha,
  };
  return {
    peerPath,
    reviewedPeer,
    deliveryPeer,
    lease,
    lane,
    refreshed,
    reviewedHeadSha,
    observedHeadSha,
    mainParentSha,
    peerTreeSha,
    historicalLedgerRevision,
    historicalLedger,
    currentLedger,
    pullRequest,
    processCalls: { exec: 0, spawn: 0 },
  };
}

function deliveryLedgerEntry({ action, core, entries }) {
  const draft = {
    schema: "agentic-cloud-collaboration-entry/v1",
    sequence: entries.length + 1,
    parentDigest: entries.at(-1)?.digest || null,
    action,
    repositoryId: core.repositoryId,
    claimId: core.claimId,
    idempotencyKey: digestValue(`delivery-key:${entries.length + 1}`),
    requestDigest: digestValue(`delivery-request:${entries.length + 1}`),
    evaluationTime: `2026-07-30T00:00:0${entries.length + 1}.000Z`,
    claimCore: core,
    claimDigest: digestValue(core),
  };
  return { ...draft, digest: digestValue(draft) };
}

function deliveryLedger(entries) {
  return {
    schema: "agentic-cloud-collaboration-ledger/v1",
    ledgerRepositoryId: "github-repository:R_ledger",
    sequence: entries.length,
    headDigest: entries.at(-1)?.digest || null,
    entries: structuredClone(entries),
  };
}

function deliveryPublicClaim(entry) {
  const core = entry.claimCore;
  const claim = {
    claimId: core.claimId,
    entrySchema: "agentic-cloud-collaboration-entry/v1",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v1",
    operationReceiptDigest: null,
    mutationAuthorityEligible: false,
    state: core.state.replaceAll("-", "_"),
    actorId: core.actorId,
    repositoryId: core.repositoryId,
    workItemId: core.workItemId,
    canonicalBaseRevision: core.canonicalBaseRevision,
    laneRevision: core.laneRevision,
    declaredWriteScope: core.declaredWriteScope,
    writeSetDigest: core.writeSetDigest,
    leaseEpoch: core.leaseEpoch,
    transitionCounter: core.transitionCounter,
    heartbeatCounter: core.heartbeatCounter,
    reviewRequestId: core.reviewRequestId,
    expiresAt: core.expiresAt,
    fenceRevision: entry.claimDigest,
    transitionDigest: entry.digest,
  };
  return { ...claim, recordDigest: digestValue(claim) };
}

function deliveryVerifiedBundle(authority, manifest, fixture) {
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
  const ledgerDigest = fixture.currentLedger.headDigest;
  return verifyAdmissionCloudAuthority({
    authority,
    manifest,
    canonicalBaseSha: canonicalSha,
    inspect: () => ({
      schema: "agentic-cloud-collaboration-result/v1",
      ok: true,
      action: "status",
      status: "ready",
      ledgerRevision: authority.ledgerRevision,
      ledgerDigest,
      claims: [candidate, fixture.deliveryPeer],
    }),
      invoke: () => verificationResult({
        claim: {
          ...candidate,
          claimId: candidate.claimId,
          laneRevision: candidate.laneRevision,
          leaseEpoch: candidate.leaseEpoch,
          transitionCounter: candidate.transitionCounter,
          reviewRequestId: candidate.reviewRequestId,
          expiresAt: candidate.expiresAt,
          fenceRevision: candidate.fenceRevision,
          transitionDigest: candidate.transitionDigest,
        },
        claims: [candidate, fixture.deliveryPeer],
        ledgerRevision: authority.ledgerRevision,
        ledgerDigest,
        contractReceiptDigest: "5".repeat(64),
    }),
  });
}

function installDeliveryPeerProcessMocks(t, fixture) {
  t.mock.method(childProcess, "execFileSync", (command, args) => {
    fixture.processCalls.exec += 1;
    const key = args.join(" ");
    if (command === "git") {
      if (key === "rev-parse HEAD") return fixture.lane.head;
      if (key === "status --porcelain=v1 -z --untracked-files=all") {
        return fixture.lane.dirty ? " M tracked\0" : "";
      }
      if (key === `rev-list --parents -n 1 ${fixture.observedHeadSha}`) {
        return fixture.refreshParents
          || `${fixture.observedHeadSha} ${fixture.reviewedHeadSha} ${fixture.mainParentSha}`;
      }
      if (key === `merge-base --is-ancestor ${fixture.mainParentSha} origin/main`) {
        return "";
      }
      if (key === `merge-tree --write-tree --no-messages ${fixture.reviewedHeadSha} ${fixture.mainParentSha}`) {
        return fixture.peerTreeSha;
      }
      if (key === `rev-parse ${fixture.observedHeadSha}^{tree}`) {
        return fixture.peerTreeSha;
      }
    }
    if (command === "gh" && key.startsWith("pr view ")) {
      return JSON.stringify(fixture.pullRequest);
    }
    if (command === "gh" && args[0] === "api") {
      const revision = args.find(item => item.startsWith("ref="))?.slice(4);
      if (revision === fixture.historicalLedgerRevision) {
        return JSON.stringify(fixture.historicalLedger);
      }
      if (revision === ledgerRevision) {
        return JSON.stringify(fixture.currentLedger);
      }
    }
    throw new Error(`unexpected process command: ${command} :: ${key}`);
  });
  t.mock.method(childProcess, "spawnSync", (command, args) => {
    fixture.processCalls.spawn += 1;
    assert.equal(command, process.execPath);
    const request = JSON.parse(
      args.find(item => item.startsWith("--request-json="))
        .slice("--request-json=".length),
    );
    return {
      status: 0,
        stdout: JSON.stringify(verificationResult({
          claim: fixture.deliveryPeer,
          claims: [fixture.deliveryPeer],
        ledgerRevision: request.expectedLedgerRevision,
          ledgerDigest: fixture.currentLedger.headDigest,
          contractReceiptDigest: "8".repeat(64),
        subject: {
          repository: fixture.lease.cloudAuthority.targetRepository,
          pullRequestNumber: 9,
          branch: fixture.lease.branch,
          headSha: fixture.pullRequest.headRefOid,
          canonicalBaseSha: fixture.pullRequest.baseRefOid,
        },
        })),
      stderr: "",
    };
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
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
test("reviewed cloud authority outlives its expired replaceable local lease projection", () => {
  const manifest = manifestFor();
  const authority = authorityFor(manifest);
  const { peerPath, peer, lease } = peerFixture(authority);
  const reviewedPeer = { ...peer, state: "reviewed" };
  lease.status = "review_ready";
  lease.reviewHeadSha = fenceSha;
  lease.expiresAt = "2026-07-30T00:00:00.000Z";
  lease.cloudAuthority = {
    ...lease.cloudAuthority,
    state: "review_ready",
  };
  delete lease.cloudAuthority.entrySchema;
  delete lease.cloudAuthority.claimIdentitySchema;
  delete lease.cloudAuthority.mutationAuthorityEligible;
  const lane = laneState({
    lanePath: peerPath,
    laneBranch: "refs/heads/agent/peer/peer-docs",
    head: fenceSha,
    lease,
  });
  const verified = verifiedBundle(authority, manifest, [
    publicClaim(manifest),
    reviewedPeer,
  ]);
  const report = evaluate({
    manifest,
    authority,
    verification: verified.verification,
    lanes: [canonicalLane(), lane],
  });
  assert.equal(
    report.lanes.find(item => item.path === peerPath).classification,
    "disjoint-attributed",
  );
  assert.equal(report.authoringAdmission.status, "planned");
});
test("parked preserved review-ready retries accept owned-dirt protected refresh projection", () => {
  const manifest = manifestFor();
  const authority = authorityFor(manifest);
  const { peerPath, peer, lease } = peerFixture(authority);
  const reviewedHeadSha = "d".repeat(40);
  lease.status = "review_ready";
  lease.baseSha = reviewedHeadSha;
  lease.reviewHeadSha = fenceSha;
  lease.ownedDirtRecovery = {
    schema: "agentic-owned-dirt-resume/v1",
    sourceEpoch: 125,
    sourceSessionId: "peer-session",
    reviewHeadSha: reviewedHeadSha,
    evidenceDigest: "e".repeat(64),
    pathCount: 2,
  };
  lease.cloudAuthority = {
    ...lease.cloudAuthority,
    canonicalBaseSha: canonicalSha,
    laneRevision: fenceSha,
    state: "review_ready",
  };
  const parkedPeer = {
    ...peer,
    state: "parked",
    canonicalBaseRevision: canonicalSha,
    laneRevision: fenceSha,
  };
  const lane = laneState({
    lanePath: peerPath,
    laneBranch: "refs/heads/agent/peer/peer-docs",
    head: fenceSha,
    dirty: true,
    lease,
  });
  const verified = verifiedBundle(authority, manifest, [
    publicClaim(manifest),
    parkedPeer,
  ]);
  const report = evaluate({
    manifest,
    authority,
    verification: verified.verification,
    lanes: [canonicalLane(), lane],
  });
  assert.equal(
    report.lanes.find(item => item.path === peerPath).classification,
    "disjoint-attributed",
  );
  assert.equal(report.authoringAdmission.status, "planned");
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
test("raw v1 current peers remain historical-only and block new admission", () => {
  const manifest = manifestFor();
  const authority = authorityFor(manifest);
  const { peerPath, peer, lease } = peerFixture(authority);
  const historicalPeer = {
    ...peer,
    entrySchema: "agentic-cloud-collaboration-entry/v1",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v1",
    operationReceiptDigest: null,
  };
  const historicalLease = {
    ...lease,
    cloudAuthority: {
      ...lease.cloudAuthority,
      entrySchema: historicalPeer.entrySchema,
      claimIdentitySchema: historicalPeer.claimIdentitySchema,
      operationReceiptDigest: null,
      mutationAuthorityEligible: false,
    },
  };
  const historicalLane = laneState({
    lanePath: peerPath,
    laneBranch: "refs/heads/agent/peer/peer-docs",
    head: fenceSha,
    dirty: true,
    lease: historicalLease,
  });
  const verified = verifiedBundle(authority, manifest, [
    publicClaim(manifest),
    historicalPeer,
  ]);
  const report = evaluate({
    manifest,
    authority,
    verification: verified.verification,
    lanes: [canonicalLane(), historicalLane],
  });
  const observed = report.lanes.find(lane => lane.path === peerPath);
  assert.equal(observed.classification, "ambiguous");
  assert.deepEqual(observed.overlapReasons, ["missing-authoritative-owner"]);
  assert.equal(report.authoringAdmission.status, "blocked");
});
test("detached integrated completion lanes remain disjoint-attributed after merge", () => {
  const manifest = manifestFor();
  const authority = authorityFor(manifest);
  const integratedLane = laneState({
    lanePath: "/workspace/.worktrees/repository/integrated-runtime",
    laneBranch: null,
    head: canonicalSha,
    dirty: false,
    lease: {
      schema: "agentic-writer-lease/v2",
      status: "completing",
      epoch: 200,
      sessionId: "merge-session",
      device: "peer",
      scope: "integrated-runtime",
      branch: "agent/peer/integrated-runtime",
      worktreePath: "/workspace/.worktrees/repository/integrated-runtime",
      baseSha: fenceSha,
      fenceSha,
      pullRequestUrl: "https://github.test/owner/repository/pull/99",
      expiresAt: future,
      admission: {
        schema: "agentic-lane-admission-lease/v1",
        status: "admitted",
        semanticScope: "integrated-runtime",
        declaredWriteSet: manifest.declaredWriteSet,
        writeSetDigest: manifest.writeSetDigest,
        manifestDigest: "1".repeat(64),
        planReceiptDigest: "2".repeat(64),
        admissionReceiptDigest: "3".repeat(64),
        admittedReportDigest: "4".repeat(64),
        preservationReceiptDigest: "5".repeat(64),
        existingLaneStateDigest: "6".repeat(64),
      },
      completion: {
        mergeCommitSha: canonicalSha,
        mainSha: canonicalSha,
      },
    },
  });
  const verified = verifiedBundle(authority, manifest);
  const report = evaluate({
    manifest,
    authority: verified.authority,
    verification: verified.verification,
    lanes: [canonicalLane(), integratedLane],
  });
  const observed = report.lanes.find(lane => lane.path === integratedLane.path);
  assert.equal(observed.classification, "disjoint-attributed");
  assert.deepEqual(observed.overlapReasons, []);
  assert.equal(report.authoringAdmission.status, "planned");
});
test("delivery-authorized peers use canonical proof at reviewed and protected-refresh heads", async t => {
  for (const options of [
    { refreshed: false, heartbeatCount: 0 },
    { refreshed: true, heartbeatCount: 1 },
    { refreshed: true, heartbeatCount: 3 },
  ]) {
    await t.test(JSON.stringify(options), t => {
      const manifest = manifestFor();
      const authority = authorityFor(manifest);
      const fixture = deliveryPeerFixture(authority, options);
      const verified = deliveryVerifiedBundle(authority, manifest, fixture);
      installDeliveryPeerProcessMocks(t, fixture);
      const report = evaluate({
        manifest,
        authority: verified.authority,
        verification: verified.verification,
        lanes: [canonicalLane(), fixture.lane],
      });
      const observed = report.lanes.find(lane => lane.path === fixture.peerPath);
      assert.equal(observed.classification, "disjoint-attributed");
      assert.equal(report.authoringAdmission.status, "planned");
      assert.notEqual(observed.stateDigest, fixture.lane.stateDigest);
      assert.equal(fixture.processCalls.spawn, 2);
      assert.equal(
        Object.keys(observed).some(key => key.includes("deliveryPeer")),
        false,
      );
    });
  }
});

test("delivery-authorized peer proof rejects predecessor, provider, current, heartbeat, and refresh drift", async t => {
  const cases = [
    ["dirty lane", fixture => {
      fixture.lane.dirty = true;
    }],
    ["historical predecessor", fixture => {
      fixture.lease.cloudAuthority.claimDigest = "9".repeat(64);
    }],
    ["provider subject", fixture => {
      fixture.pullRequest.state = "CLOSED";
    }],
    ["current ledger record", fixture => {
      fixture.currentLedger.entries.at(-1).claimDigest = "9".repeat(64);
    }],
    ["non-heartbeat successor", fixture => {
      fixture.currentLedger.entries.at(-1).action = "bind";
    }],
    ["malformed protected refresh", fixture => {
      fixture.refreshParents = `${fixture.observedHeadSha} ${fixture.reviewedHeadSha}`;
    }],
  ];
  for (const [label, mutate] of cases) {
    await t.test(label, t => {
      const manifest = manifestFor();
      const authority = authorityFor(manifest);
      const fixture = deliveryPeerFixture(authority);
      mutate(fixture);
      const verified = deliveryVerifiedBundle(authority, manifest, fixture);
      installDeliveryPeerProcessMocks(t, fixture);
      const report = evaluate({
        manifest,
        authority: verified.authority,
        verification: verified.verification,
        lanes: [canonicalLane(), fixture.lane],
      });
      assert.equal(
        report.lanes.find(lane => lane.path === fixture.peerPath).classification,
        "ambiguous",
      );
      assert.equal(report.authoringAdmission.status, "blocked");
    });
  }
});

test("preservation reruns delivery-peer proof and rejects authority drift", t => {
  const manifest = manifestFor();
  const authority = authorityFor(manifest);
  const fixture = deliveryPeerFixture(authority, { heartbeatCount: 2 });
  const verified = deliveryVerifiedBundle(authority, manifest, fixture);
  installDeliveryPeerProcessMocks(t, fixture);
  let report = evaluate({
    manifest,
    authority: verified.authority,
    verification: verified.verification,
    lanes: [canonicalLane(), fixture.lane],
  });
  report = attachAdmissionReceipt({
    report,
    targetObservationDigest: "d".repeat(64),
    remoteAuthorityVerification: verified.verification,
  });
  const bound = {
    ...verified.authority,
    claimDigest: "e".repeat(64),
    claimLedgerRevision: "f".repeat(64),
    laneRevision: fenceSha,
    deviceId: "device",
    sessionId: "session",
    reviewRequestId: "github-pull-request:PR_1",
    transitionCounter: 2,
  };
  const boundVerified = deliveryVerifiedBundle(bound, manifest, fixture);
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
    admission: createAdmissionLeaseProjection(report),
    cloudAuthority: boundVerified.authority,
  };
  const baseTreeSha = "6".repeat(40);
  const candidate = laneState({
    lanePath: targetPath,
    laneBranch: `refs/heads/${branch}`,
    head: fenceSha,
    treeSha: baseTreeSha,
    lease,
  });
  const operationIdentity = {
    target: targetPath,
    baseSha: canonicalSha,
    baseTreeSha,
    expectedTargetObservationDigest: "d".repeat(64),
    beforeRegistrationInventoryDigest: "2".repeat(64),
    afterRegistrationInventoryDigest: "3".repeat(64),
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
    beforeRegistrationInventoryDigest: "2".repeat(64),
    afterRegistrationInventoryDigest: "3".repeat(64),
    mutationSet: ["candidate-registration"],
  };
  const operation = { ...operationCore, resultDigest: digestValue(operationCore) };
  const afterLanes = [canonicalLane(), fixture.lane, candidate];
  const beforeStableRerun = fixture.processCalls.spawn;
  const preservation = verifyPreservedLaneState(report, afterLanes, {
    lease,
    candidateCreateRegisterResult: operation,
    remoteAuthorityVerification: boundVerified.verification,
  });
  assert.equal(preservation.status, "preserved");
  assert.equal(fixture.processCalls.spawn, beforeStableRerun + 2);

  fixture.pullRequest.headRefOid = "9".repeat(40);
  const beforeDriftRerun = fixture.processCalls.exec;
  assert.throws(() => verifyPreservedLaneState(report, afterLanes, {
    lease,
    candidateCreateRegisterResult: operation,
    remoteAuthorityVerification: boundVerified.verification,
  }), /Existing lane (state|authority digest) changed during admission/);
  assert.ok(fixture.processCalls.exec > beforeDriftRerun);
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
test("clean canonical main behind origin is preserved for exact-base task admission", () => {
  const manifest = manifestFor();
  const authority = authorityFor(manifest);
  const verified = verifiedBundle(authority, manifest);
  const report = evaluate({
    manifest,
    authority,
    verification: verified.verification,
    canonicalSourceDisposition: "preserved-behind",
    lanes: [laneState({
      lanePath: canonicalPath,
      laneBranch: "refs/heads/main",
      head: "d".repeat(40),
    })],
  });
  assert.equal(report.authoringAdmission.status, "planned");
  assert.deepEqual(report.authoringAdmission.findings, []);
  assert.equal(report.lanes[0].classification, "canonical");
});
test("dirty or divergent canonical main still blocks task admission", () => {
  const manifest = manifestFor();
  const authority = authorityFor(manifest);
  const verified = verifiedBundle(authority, manifest);
  for (const [canonicalSourceDisposition, dirty] of [
    ["unsafe", false],
    ["preserved-behind", true],
  ]) {
    const report = evaluate({
      manifest,
      authority,
      verification: verified.verification,
      canonicalSourceDisposition,
      lanes: [laneState({
        lanePath: canonicalPath,
        laneBranch: "refs/heads/main",
        head: "d".repeat(40),
        dirty,
      })],
    });
    assert.equal(report.authoringAdmission.status, "blocked");
    assert.equal(
      report.authoringAdmission.findings.some(
        finding => finding.type === "canonical-base-drift",
      ),
      true,
    );
  }
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
  const currentCandidate = publicClaim(manifest, {
    claimId: bound.claimId,
    laneRevision: bound.laneRevision,
    leaseEpoch: bound.leaseEpoch,
    transitionCounter: bound.transitionCounter,
    reviewRequestId: bound.reviewRequestId,
    expiresAt: bound.expiresAt,
    fenceRevision: bound.claimDigest,
    transitionDigest: bound.claimLedgerRevision,
  });
  const disjointScope = ["path:docs/disjoint", "semantic:disjoint"];
  const disjointPeer = publicClaim({
    declaredWriteSet: disjointScope,
    writeSetDigest: digestValue(disjointScope),
  }, {
    claimId: "7".repeat(64),
    declaredWriteScope: disjointScope,
    writeSetDigest: digestValue(disjointScope),
    fenceRevision: "8".repeat(64),
    transitionDigest: "9".repeat(64),
  });
  const disjointVerified = verifiedBundle(bound, manifest, [
    currentCandidate,
    disjointPeer,
  ]);
  assert.doesNotThrow(() => assertAdmissionMutationAuthority({
    lease,
    cloudAuthority: bound,
    remoteAuthorityVerification: disjointVerified.verification,
    allowPlanned: true,
  }));
  const overlappingPeer = {
    ...disjointPeer,
    declaredWriteScope: manifest.declaredWriteSet,
    writeSetDigest: manifest.writeSetDigest,
  };
  const overlappingVerified = verifiedBundle(bound, manifest, [
    currentCandidate,
    overlappingPeer,
  ]);
  assert.throws(() => assertAdmissionMutationAuthority({
    lease,
    cloudAuthority: bound,
    remoteAuthorityVerification: overlappingVerified.verification,
    allowPlanned: true,
  }), /competing overlapping cloud authority/u);
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
  ), /competing overlapping cloud authority/);
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
test("lane collection proves a clean canonical ancestor as preserved-behind", () => {
  const behindSha = "d".repeat(40);
  const git = (_cwd, args) => {
    const key = args.join(" ");
    if (key === "worktree list --porcelain -z") {
      return `worktree ${repository}\0HEAD ${behindSha}\0branch refs/heads/main\0`;
    }
    if (key === "rev-parse origin/main") return canonicalSha;
    if (key === "rev-parse HEAD^{tree}") return behindSha;
    if (key === `merge-base --is-ancestor ${behindSha} ${canonicalSha}`) return "";
    if (key.includes("status --porcelain")) return "";
    if (key.startsWith("ls-files")) return "";
    throw new Error(`unexpected git command: ${key}`);
  };
  const snapshot = collectScopedLaneState({
    repository,
    git,
    readLeases: () => [],
  });
  assert.equal(snapshot.canonicalSourceDisposition, "preserved-behind");
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
