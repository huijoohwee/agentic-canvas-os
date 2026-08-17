import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateScopedLaneAdmission,
  normalizeCloudAuthority,
  normalizeDeclaredWriteScopeManifest,
} from "../scripts/scoped-lane-admission-lib.mjs";
import { verifyAdmissionCloudAuthority } from "../scripts/scoped-lane-cloud-authority.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";

const canonicalSha = "a".repeat(40);
const claimDigest = "2".repeat(64);
const claimLedgerRevision = "3".repeat(64);
const ledgerRevision = "c".repeat(40);
const ledgerDigest = "4".repeat(64);
const future = "2099-07-31T00:00:00.000Z";
const evaluationTime = "2026-07-30T00:00:00.000Z";
const repository = "/workspace/repository";
const targetPath = "/workspace/.worktrees/repository/scoped-runtime";
const branch = "agent/device/scoped-runtime";

function manifestFor() {
  return normalizeDeclaredWriteScopeManifest({
    schema: "agentic-declared-write-scope/v1",
    semanticScope: "scoped-runtime",
    paths: ["scripts/scoped-runtime"],
  }, { expectedScope: "scoped-runtime" });
}

function publicClaim(manifest, overrides = {}) {
  const claim = {
    claimId: "1".repeat(64),
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    operationReceiptDigest: "5".repeat(64),
    mutationAuthorityEligible: true,
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
    ...overrides,
  };
  return { ...claim, recordDigest: digestValue(claim) };
}

function authorityFor(manifest) {
  return Object.freeze(normalizeCloudAuthority({
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "claim",
    status: "active",
    ledgerRevision,
    ledgerDigest,
    claimDigest,
    claim: publicClaim(manifest),
    receipt: {
      ledgerDigest,
      receiptDigest: "6".repeat(64),
      evaluationTime,
    },
  }, {
    ledgerRepository: "owner/agentic-canvas-os",
    targetRepository: "owner/repository",
    manifest,
    canonicalBaseSha: canonicalSha,
    now: new Date(evaluationTime),
  }));
}

function verificationResult({
  claim,
  claims,
  resultLedgerRevision,
  resultLedgerDigest = ledgerDigest,
  resultEvaluationTime = evaluationTime,
  contractReceiptDigest = "7".repeat(64),
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
    findings: [],
    receipt: {
      ...receiptCore,
      receiptDigest: digestValue(receiptCore),
    },
  };
}

function verifiedBundle(authority, manifest) {
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
      claims: [candidate],
    }),
    invoke: () => verificationResult({
      claim: candidate,
      claims: [candidate],
      resultLedgerRevision: authority.ledgerRevision,
    }),
  });
}

function canonicalLane() {
  const state = {
    path: repository,
    head: canonicalSha,
    branch: "refs/heads/main",
    detached: false,
    dirty: false,
    invalid: false,
    leaseAmbiguous: false,
    lease: null,
  };
  return { ...state, stateDigest: digestValue(state) };
}

function laneState({
  lanePath,
  laneBranch,
  head = canonicalSha,
  dirty = false,
  lease = null,
}) {
  const state = {
    path: lanePath,
    head,
    branch: laneBranch,
    detached: !laneBranch,
    dirty,
    invalid: false,
    leaseAmbiguous: false,
    lease,
  };
  return { ...state, stateDigest: digestValue(state) };
}

test("detached integrated completion lanes remain disjoint-attributed after merge", () => {
  const manifest = manifestFor();
  const authority = authorityFor(manifest);
  const verified = verifiedBundle(authority, manifest);
  const integratedLane = laneState({
    lanePath: "/workspace/.worktrees/repository/integrated-runtime",
    laneBranch: null,
    head: canonicalSha,
    lease: {
      schema: "agentic-writer-lease/v2",
      status: "completing",
      epoch: 200,
      sessionId: "merge-session",
      device: "peer",
      scope: "integrated-runtime",
      branch: "agent/peer/integrated-runtime",
      worktreePath: "/workspace/.worktrees/repository/integrated-runtime",
      baseSha: "b".repeat(40),
      fenceSha: "b".repeat(40),
      pullRequestUrl: "https://github.test/owner/repository/pull/99",
      expiresAt: future,
      admission: {
        schema: "agentic-lane-admission-lease/v1",
        status: "admitted",
        semanticScope: "integrated-runtime",
        declaredWriteSet: manifest.declaredWriteSet,
        writeSetDigest: manifest.writeSetDigest,
        manifestDigest: "8".repeat(64),
        planReceiptDigest: "9".repeat(64),
        admissionReceiptDigest: "a".repeat(64),
        admittedReportDigest: "b".repeat(64),
        preservationReceiptDigest: "c".repeat(64),
        existingLaneStateDigest: "d".repeat(64),
      },
      completion: {
        mergeCommitSha: canonicalSha,
        mainSha: canonicalSha,
      },
    },
  });
  const report = evaluateScopedLaneAdmission({
    repository,
    canonicalPath: repository,
    canonicalBaseSha: canonicalSha,
    canonicalSourceDisposition: "exact",
    targetPath,
    branch,
    semanticScope: "scoped-runtime",
    targetSafe: true,
    manifest,
    lanes: [canonicalLane(), integratedLane],
    cloudAuthority: verified.authority,
    remoteAuthorityRequired: true,
    remoteAuthorityVerification: verified.verification,
    mode: "check",
    evaluatedAt: evaluationTime,
  });
  const observed = report.lanes.find(lane => lane.path === integratedLane.path);
  assert.equal(observed.classification, "disjoint-attributed");
  assert.deepEqual(observed.overlapReasons, []);
  assert.equal(report.authoringAdmission.status, "planned");
});
