import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "../scripts/github-cloud-collaboration-mapping.mjs";
import {
  normalizeDeclaredWriteScopeManifest,
} from "../scripts/scoped-lane-admission-lib.mjs";
import {
  assertPlannedContinuationIdentity,
  continuePlannedAdmissionFromRepository,
  continuePlannedScopedLaneAdmission,
  selectedPreservationMatchesLane,
} from "../scripts/scoped-lane-admission-continuation.mjs";
import {
  verifyDormantPreservation,
} from "../scripts/scoped-lane-authority-state.mjs";
import {
  verifyAdmissionCloudAuthority,
} from "../scripts/scoped-lane-cloud-authority.mjs";

const BASE_SHA = "a".repeat(40);
const FENCE_SHA = "b".repeat(40);
const INTEGRATION_SHA = "4".repeat(40);
const INTEGRATION_TREE_SHA = "5".repeat(40);
const PROTECTED_SHA = "c".repeat(40);
const LEDGER_SHA = "d".repeat(40);
const CLAIM_FENCE = "e".repeat(64);
const CLAIM_TRANSITION = "f".repeat(64);
const LEDGER_DIGEST = "1".repeat(64);
const VERIFICATION_RECEIPT = "2".repeat(64);
const OPERATOR_DECISION_DIGEST = "3".repeat(64);
const OPERATION_RECEIPT = "9".repeat(64);
const EVALUATED_AT = "2026-08-04T00:00:00.000Z";
const LATER_EVALUATION = "2026-08-04T00:00:01.000Z";
const LOCAL_EXPIRY = "2099-08-03T00:00:00.000Z";
const CLOUD_EXPIRY = "2099-08-04T00:00:00.000Z";
const REPOSITORY = "/workspace/repository";
const TARGET_REPOSITORY = "owner/repository";
const CANDIDATE_PATH = "/workspace/worktrees/continuation";
const DORMANT_PATH = "/workspace/worktrees/dormant";
const BRANCH = "agent/device/continuation";
const SESSION_ID = "continuation-session";
const DEVICE_ID = "device";

function manifestFixture() {
  return normalizeDeclaredWriteScopeManifest({
    schema: "agentic-declared-write-scope/v1",
    semanticScope: "continuation",
    paths: ["scripts/continuation"],
  });
}

function candidateClaim(manifest) {
  const identity = {
    actorId: "github-user:1",
    canonicalBaseRevision: BASE_SHA,
    deviceId: pseudonymousIdentifier("device", DEVICE_ID),
    leaseEpoch: 1,
    repositoryId: "github-repository:R_1",
    sessionId: pseudonymousIdentifier("session", SESSION_ID),
    workItemId: "work-item:continuation",
    writeSetDigest: manifest.writeSetDigest,
  };
  return {
    claimId: digestValue(identity),
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    operationReceiptDigest: OPERATION_RECEIPT,
    state: "active",
    actorId: identity.actorId,
    repositoryId: identity.repositoryId,
    workItemId: identity.workItemId,
    canonicalBaseRevision: BASE_SHA,
    laneRevision: FENCE_SHA,
    declaredWriteScope: manifest.declaredWriteSet,
    writeSetDigest: manifest.writeSetDigest,
    leaseEpoch: 1,
    transitionCounter: 2,
    heartbeatCounter: 1,
    reviewRequestId: "github-pull-request:PR_continuation",
    expiresAt: CLOUD_EXPIRY,
    fenceRevision: CLAIM_FENCE,
    transitionDigest: CLAIM_TRANSITION,
  };
}

function peerClaim({ overlapping = false, heartbeatCounter = 3 } = {}) {
  const declaredWriteScope = overlapping
    ? ["path:scripts/continuation/peer", "semantic:peer"]
    : ["path:docs/peer", "semantic:peer"];
  return {
    claimId: "4".repeat(64),
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    operationReceiptDigest: "8".repeat(64),
    state: "active",
    actorId: "github-user:2",
    repositoryId: "github-repository:R_1",
    workItemId: "work-item:peer",
    canonicalBaseRevision: BASE_SHA,
    laneRevision: "5".repeat(40),
    declaredWriteScope,
    writeSetDigest: digestValue(declaredWriteScope),
    leaseEpoch: 4,
    transitionCounter: 8,
    heartbeatCounter,
    reviewRequestId: "github-pull-request:PR_peer",
    expiresAt: CLOUD_EXPIRY,
    fenceRevision: "6".repeat(64),
    transitionDigest: "7".repeat(64),
  };
}
function verificationResult({
  claim,
  claims,
  ledgerDigest = LEDGER_DIGEST,
  evaluationTime = EVALUATED_AT,
  contractReceiptDigest = VERIFICATION_RECEIPT,
} = {}) {
  const currentClaimInventoryCore = {
    schema: "agentic-cloud-collaboration-current-claim-inventory/v1",
    ledgerRevision: LEDGER_SHA,
    ledgerDigest,
    evaluationTime,
    claims,
  };
  const currentClaimInventory = {
    ...currentClaimInventoryCore,
    claimInventoryDigest: digestValue(currentClaimInventoryCore),
  };
  const receiptCore = {
    schema: "agentic-cloud-collaboration-github-verification/v1",
    ok: true,
    ledgerRevision: LEDGER_SHA,
    ledgerDigest,
    claimId: claim.claimId,
    claimDigest: claim.fenceRevision,
    contractReceiptDigest,
    claimInventoryDigest: currentClaimInventory.claimInventoryDigest,
    evaluationTime,
    findings: [],
  };
  return {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "verify",
    status: "ready",
    ledgerRevision: LEDGER_SHA,
    claimDigest: claim.fenceRevision,
    claim,
    currentClaimInventory,
    findings: [],
    receipt: { ...receiptCore, receiptDigest: digestValue(receiptCore) },
  };
}

function verifiedAuthority(manifest, peer = peerClaim(), {
  evaluationTime = EVALUATED_AT,
  verificationReceipt = VERIFICATION_RECEIPT,
} = {}) {
  const claim = candidateClaim(manifest);
  const authority = Object.freeze({
    schema: "agentic-lane-cloud-authority/v1",
    provider: "github",
    ledgerRepository: "owner/ledger",
    targetRepository: TARGET_REPOSITORY,
    claimId: claim.claimId,
    entrySchema: claim.entrySchema,
    claimIdentitySchema: claim.claimIdentitySchema,
    operationReceiptDigest: claim.operationReceiptDigest,
    claimDigest: claim.fenceRevision,
    ledgerRevision: LEDGER_SHA,
    claimLedgerRevision: claim.transitionDigest,
    canonicalBaseSha: BASE_SHA,
    laneRevision: FENCE_SHA,
    cloudDeclaredWriteScope: manifest.declaredWriteSet,
    writeSetDigest: manifest.writeSetDigest,
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    reviewRequestId: claim.reviewRequestId,
    leaseEpoch: claim.leaseEpoch,
    transitionCounter: claim.transitionCounter,
    state: "active",
    expiresAt: claim.expiresAt,
  });
  return verifyAdmissionCloudAuthority({
    authority,
    manifest,
    canonicalBaseSha: BASE_SHA,
    inspect: () => ({
      schema: "agentic-cloud-collaboration-result/v1",
      ok: true,
      action: "status",
      status: "ready",
      ledgerRevision: LEDGER_SHA,
      ledgerDigest: LEDGER_DIGEST,
      claims: [claim, peer],
    }),
      invoke: () => verificationResult({
        claim,
        claims: [claim, peer],
        evaluationTime,
        contractReceiptDigest: verificationReceipt,
    }),
  });
}

function lane({
  lanePath,
  branch,
  head = BASE_SHA,
  dirty = false,
  lease = null,
  stateDigest = "8".repeat(64),
} = {}) {
  return {
    path: lanePath,
    branch,
    head,
    treeSha: head,
    detached: !branch,
    dirty,
    invalid: false,
    leaseAmbiguous: false,
    lease,
    indexDigest: "6".repeat(64),
    workingTreeDigest: "7".repeat(64),
    stateDigest,
  };
}

function githubIdentity(argumentsList) {
  if (argumentsList[0] === "api") return { id: 1, login: "owner" };
  if (argumentsList[0] === "repo") {
    return {
      id: "R_1",
      nameWithOwner: TARGET_REPOSITORY,
      owner: { login: "owner" },
    };
  }
  throw new Error(`Unexpected GitHub invocation: ${argumentsList.join(" ")}`);
}

function fixture({ overlappingRemotePeer = false } = {}) {
  const manifest = manifestFixture();
  const verified = verifiedAuthority(
    manifest,
    peerClaim({ overlapping: overlappingRemotePeer }),
  );
  const dormantLane = lane({
    lanePath: DORMANT_PATH,
    branch: "refs/heads/agent/old-device/dormant",
    dirty: true,
    stateDigest: "9".repeat(64),
  });
  const dormantPreservationReceipt = verifyDormantPreservation({
    repository: REPOSITORY,
    targetRepository: TARGET_REPOSITORY,
    lanes: [dormantLane],
    worktreePaths: [DORMANT_PATH],
    operatorDecisionDigest: OPERATOR_DECISION_DIGEST,
    sessionId: SESSION_ID,
    remoteAuthorityVerification: verified.verification,
    ghJson: githubIdentity,
    verifiedAt: EVALUATED_AT,
  });
  const lease = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 23,
    sessionId: SESSION_ID,
    device: DEVICE_ID,
    scope: manifest.semanticScope,
    branch: BRANCH,
    worktreePath: CANDIDATE_PATH,
    baseSha: BASE_SHA,
    fenceSha: FENCE_SHA,
    pullRequestUrl: "https://github.test/owner/repository/pull/97",
    expiresAt: LOCAL_EXPIRY,
    admission: {
      schema: "agentic-lane-admission-lease/v1",
      status: "planned",
      semanticScope: manifest.semanticScope,
      declaredWriteSet: manifest.declaredWriteSet,
      writeSetDigest: manifest.writeSetDigest,
      manifestDigest: manifest.manifestDigest,
      planReceiptDigest: "a".repeat(64),
      admissionReceiptDigest: "b".repeat(64),
      existingLaneStateDigest: "c".repeat(64),
    },
    cloudAuthority: verified.authority,
  };
  const lanes = [
    lane({
      lanePath: REPOSITORY,
      branch: "refs/heads/main",
      head: PROTECTED_SHA,
      stateDigest: "d".repeat(64),
    }),
    lane({
      lanePath: CANDIDATE_PATH,
      branch: `refs/heads/${BRANCH}`,
      head: FENCE_SHA,
      lease,
      stateDigest: "e".repeat(64),
    }),
    dormantLane,
  ];
  return {
    manifest,
    verified,
    dormantPreservationReceipt,
    lease,
    lanes,
  };
}

function continueFixture(source, overrides = {}) {
  return continuePlannedScopedLaneAdmission({
    lease: source.lease,
    cloudAuthority: source.verified.authority,
    remoteAuthorityVerification: source.verified.verification,
    manifest: source.manifest,
    lanes: source.lanes,
    protectedRevision: PROTECTED_SHA,
    protectedDeltaPaths: ["docs/protected-advance.md"],
    dormantPreservationReceipt: source.dormantPreservationReceipt,
    operatorDecisionDigest: OPERATOR_DECISION_DIGEST,
    ...overrides,
  });
}

function repositoryContinuationFixture(source, {
  gitText = defaultRepositoryGitText,
  annotate = ({ values }) => ({ ...source.lease, ...values }),
  finalSnapshotOverrides = {},
  cloudVerifications = [source.verified, source.verified],
} = {}) {
  const counters = {
    annotate: 0,
    collectLaneState: 0,
    verifyCloudAuthority: 0,
    verifyDormant: 0,
  };
  const snapshot = Object.freeze({
    repository: REPOSITORY,
    canonicalBaseSha: PROTECTED_SHA,
    lanes: source.lanes,
    laneStateDigest: "4".repeat(64),
    registryDigest: "5".repeat(64),
  });
  const finalSnapshot = Object.freeze({ ...snapshot, ...finalSnapshotOverrides });
  const leaseStore = {
    verify: ({ sessionId, branch }) => {
      assert.equal(sessionId, SESSION_ID);
      assert.equal(branch, BRANCH);
      return source.lease;
    },
    annotate: input => {
      counters.annotate += 1;
      return annotate(input);
    },
  };
  const options = {
    repository: REPOSITORY,
    branch: BRANCH,
    sessionId: SESSION_ID,
    leaseStore,
    manifestSource: {
      schema: "agentic-declared-write-scope/v1",
      semanticScope: source.manifest.semanticScope,
      paths: source.manifest.paths,
    },
    dormantWorktreePaths: [DORMANT_PATH],
    dormantPullRequests: [],
    operatorDecisionDigest: OPERATOR_DECISION_DIGEST,
    gitText,
    verifyCloudAuthority: () => {
      const verification = cloudVerifications[counters.verifyCloudAuthority]
        || cloudVerifications.at(-1);
      counters.verifyCloudAuthority += 1;
      return verification;
    },
    collectLaneState: () => {
      counters.collectLaneState += 1;
      return counters.collectLaneState === 1 ? snapshot : finalSnapshot;
    },
    verifyDormant: () => {
      counters.verifyDormant += 1;
      return source.dormantPreservationReceipt;
    },
  };
  return { counters, options };
}

function defaultRepositoryGitText(argumentsList) {
  if (argumentsList[0] === "fetch") return "";
  if (argumentsList[0] === "merge-base") return "";
  if (argumentsList[0] === "diff") {
    assert.deepEqual(argumentsList, [
      "diff", "--name-only", "-z", "--no-renames", BASE_SHA, PROTECTED_SHA,
    ]);
    return "docs/protected-advance.md\0";
  }
  throw new Error(`Unexpected git invocation: ${argumentsList.join(" ")}`);
}

test("same-session planned admission continues with current operation-derived preservation", () => {
  const source = fixture();
  const continued = continueFixture(source);

  assert.equal(continued.admission.status, "admitted");
  assert.equal(continued.continuationReceipt.status, "admitted");
  assert.equal(continued.continuationReceipt.claimId, source.verified.authority.claimId);
  assert.equal(
    continued.continuationReceipt.dormantPreservationReceiptDigest,
    source.dormantPreservationReceipt.receiptDigest,
  );
  assert.equal(continued.protectedAdvance.disposition, "disjoint-preserved");
  assert.deepEqual(
    continued.protectedAdvance.changedWriteScope,
    ["path:docs/protected-advance.md"],
  );
  assert.equal(continued.peerOperationReceipts.length, 1);
  assert.equal(
    continued.peerOperationReceipts[0].classification,
    "disjoint-attributed",
  );
  assert.equal(continued.mutationAuthorityReceipt.status, "ready");
});

test("continuation rejects an overlapping protected-source delta", () => {
  const source = fixture();
  assert.throws(
    () => continueFixture(source, {
      protectedDeltaPaths: ["scripts/continuation/child.mjs"],
    }),
    /Protected-source advance overlaps/u,
  );
});

test("continuation rejects protected canonical identity drift", () => {
  const source = fixture();
  for (const canonical of [
    { head: BASE_SHA },
    { dirty: true },
    { branch: "refs/heads/not-main" },
  ]) {
    const lanes = source.lanes.map(item => item.path === REPOSITORY
      ? { ...item, ...canonical }
      : item);
    assert.throws(
      () => continueFixture(source, { lanes }),
      /clean verified protected canonical lane/u,
    );
  }
});

test("planned identity accepts one proven live protected controller descendant", () => {
  const manifest = manifestFixture();
  const historicalTree = "1".repeat(40);
  const protectedTree = "2".repeat(40);
  const controller = {
    path: REPOSITORY,
    origin: "https://github.test/owner/repository.git",
    headSha: PROTECTED_SHA,
    originMainSha: PROTECTED_SHA,
    remoteMainSha: PROTECTED_SHA,
    treeSha: protectedTree,
    clean: true,
    deviceBranchScriptDigest: "4".repeat(64),
  };
  const candidate = {
    semanticScope: manifest.semanticScope,
    branch: BRANCH,
    sessionId: SESSION_ID,
    targetPath: CANDIDATE_PATH,
    manifest,
    candidateClaim: { claimId: "5".repeat(64) },
    selectionFileDigest: "6".repeat(64),
    manifestFileDigest: "7".repeat(64),
    cloudAuthorityFileDigest: "8".repeat(64),
  };
  const source = {
    sourceEvidenceDigest: "9".repeat(64),
    controller: {
      ...controller,
      headSha: BASE_SHA,
      originMainSha: BASE_SHA,
      remoteMainSha: BASE_SHA,
      treeSha: historicalTree,
    },
    canonical: { headSha: BASE_SHA, treeSha: historicalTree },
    candidate,
  };
  const input = {
    plan: {
      planDigest: "a".repeat(64),
      sourceEvidenceDigest: source.sourceEvidenceDigest,
      sourceEvidence: source,
    },
    controller,
    candidateLease: {
      worktreePath: CANDIDATE_PATH,
      branch: BRANCH,
      sessionId: SESSION_ID,
      scope: manifest.semanticScope,
      baseSha: BASE_SHA,
      fenceSha: FENCE_SHA,
      admission: {
        status: "planned",
        manifestDigest: manifest.manifestDigest,
        writeSetDigest: manifest.writeSetDigest,
      },
      cloudAuthority: { claimId: candidate.candidateClaim.claimId },
    },
    candidateLineage: {
      headSha: FENCE_SHA,
      parentSha: BASE_SHA,
      parentCount: 1,
      treeSha: historicalTree,
    },
    manifest,
    files: {
      selectionFileDigest: candidate.selectionFileDigest,
      manifestFileDigest: candidate.manifestFileDigest,
      cloudAuthorityFileDigest: candidate.cloudAuthorityFileDigest,
    },
    gitText: argumentsList => {
      if (argumentsList[0] === "merge-base") return "";
      if (argumentsList[0] === "diff") return "docs/protected.md\0";
      if (argumentsList[0] === "rev-parse") return protectedTree;
      throw new Error("unexpected git operation");
    },
  };
  assert.equal(assertPlannedContinuationIdentity(input), true);
  for (const controllerDrift of [
    { clean: false },
    { path: "/workspace/other" },
    { origin: "https://github.test/other/repository.git" },
    { originMainSha: BASE_SHA },
    { remoteMainSha: BASE_SHA },
    { treeSha: "3".repeat(40) },
    { deviceBranchScriptDigest: "f".repeat(64) },
  ]) {
    assert.throws(
      () => assertPlannedContinuationIdentity({
        ...input,
        controller: { ...controller, ...controllerDrift },
      }),
      /immutable planned identity/u,
    );
  }
  assert.throws(
    () => assertPlannedContinuationIdentity({
      ...input,
      gitText: argumentsList => {
        if (argumentsList[0] === "merge-base") throw new Error("not descendant");
        return "";
      },
    }),
    /immutable planned identity/u,
  );
});

test("selected preservation retains an exact retired-preserved owner", () => {
  const rawLane = lane({
    lanePath: DORMANT_PATH,
    branch: "refs/heads/agent/old-device/dormant",
    head: FENCE_SHA,
    stateDigest: "9".repeat(64),
  });
  const projection = {
    path: rawLane.path,
    branch: rawLane.branch,
    detached: rawLane.detached,
    dirty: rawLane.dirty,
    headSha: rawLane.head,
    treeSha: rawLane.treeSha,
    indexDigest: rawLane.indexDigest,
    workingTreeDigest: rawLane.workingTreeDigest,
    stateDigest: rawLane.stateDigest,
    projectedClaimId: null,
  };
  const retired = {
    ...rawLane,
    classification: "disjoint-attributed",
    authorityState: "retired-preserved",
    dormantPreservationReceiptDigest: null,
  };
  const receipt = { receiptDigest: "a".repeat(64), worktrees: [projection] };
  assert.equal(selectedPreservationMatchesLane({
    lane: retired,
    rawLane,
    dormantPreservationReceipt: receipt,
  }), true);
  for (const drifted of [
    { lane: { ...retired, classification: "ambiguous" }, rawLane, receipt },
    { lane: { ...retired, authorityState: "unattributed" }, rawLane, receipt },
    { lane: { ...retired, dormantPreservationReceiptDigest: receipt.receiptDigest }, rawLane, receipt },
    { lane: retired, rawLane: { ...rawLane, stateDigest: "b".repeat(64) }, receipt },
  ]) {
    assert.equal(selectedPreservationMatchesLane({
      lane: drifted.lane,
      rawLane: drifted.rawLane,
      dormantPreservationReceipt: drifted.receipt,
    }), false);
  }
});

test("continuation rejects an overlapping current remote peer", () => {
  const source = fixture({ overlappingRemotePeer: true });
  assert.throws(
    () => continueFixture(source),
    /overlaps current claim/u,
  );
});

test("continuation rejects a dirty candidate", () => {
  const source = fixture();
  const dirtyCandidate = source.lanes.map(item => (
    item.path === CANDIDATE_PATH ? { ...item, dirty: true } : item
  ));
  assert.throws(
    () => continueFixture(source, { lanes: dirtyCandidate }),
    /candidate drifted from its clean registered fence/u,
  );
});

test("continuation accepts the exact clean controller-prepared integration commit", () => {
  const source = fixture();
  const integration = {
    schema: "agentic-integration-commit/v1",
    commitSha: INTEGRATION_SHA,
    treeSha: INTEGRATION_TREE_SHA,
    commitMessage: "fix(continuation): preserve prepared integration",
    manifestDigest: "a".repeat(64),
    stagedDiffDigest: "b".repeat(64),
    paths: source.manifest.paths,
    recordedAt: EVALUATED_AT,
  };
  const lease = { ...source.lease, integration };
  const lanes = source.lanes.map(item => item.path === CANDIDATE_PATH
    ? {
      ...item,
      head: INTEGRATION_SHA,
      treeSha: INTEGRATION_TREE_SHA,
      lease,
    }
    : item);
  const continued = continueFixture({ ...source, lease, lanes });

  assert.equal(continued.continuationReceipt.candidateRevision, INTEGRATION_SHA);
  assert.equal(continued.continuationReceipt.candidateTreeSha, INTEGRATION_TREE_SHA);
  assert.equal(
    continued.continuationReceipt.preparedIntegrationReceiptDigest,
    digestValue(integration),
  );
});

test("continuation accepts prepared integration files under a declared directory scope", () => {
  const manifest = normalizeDeclaredWriteScopeManifest({
    schema: "agentic-declared-write-scope/v1",
    semanticScope: "continuation",
    paths: [".kiro/specs/native-skill-creation-harness"],
  });
  const verified = verifiedAuthority(manifest, peerClaim());
  const dormantLane = lane({
    lanePath: DORMANT_PATH,
    branch: "refs/heads/agent/old-device/dormant",
    dirty: true,
    stateDigest: "9".repeat(64),
  });
  const dormantPreservationReceipt = verifyDormantPreservation({
    repository: REPOSITORY,
    targetRepository: TARGET_REPOSITORY,
    lanes: [dormantLane],
    worktreePaths: [DORMANT_PATH],
    operatorDecisionDigest: OPERATOR_DECISION_DIGEST,
    sessionId: SESSION_ID,
    remoteAuthorityVerification: verified.verification,
    ghJson: githubIdentity,
    verifiedAt: EVALUATED_AT,
  });
  const integration = {
    schema: "agentic-integration-commit/v1",
    commitSha: INTEGRATION_SHA,
    treeSha: INTEGRATION_TREE_SHA,
    commitMessage: "fix(continuation): preserve directory scoped integration",
    manifestDigest: "a".repeat(64),
    stagedDiffDigest: "b".repeat(64),
    paths: [
      ".kiro/specs/native-skill-creation-harness/design.md",
      ".kiro/specs/native-skill-creation-harness/requirements.md",
      ".kiro/specs/native-skill-creation-harness/tasks.md",
    ],
    recordedAt: EVALUATED_AT,
  };
  const lease = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 23,
    sessionId: SESSION_ID,
    device: DEVICE_ID,
    scope: manifest.semanticScope,
    branch: BRANCH,
    worktreePath: CANDIDATE_PATH,
    baseSha: BASE_SHA,
    fenceSha: FENCE_SHA,
    pullRequestUrl: "https://github.test/owner/repository/pull/97",
    expiresAt: LOCAL_EXPIRY,
    admission: {
      schema: "agentic-lane-admission-lease/v1",
      status: "planned",
      semanticScope: manifest.semanticScope,
      declaredWriteSet: manifest.declaredWriteSet,
      writeSetDigest: manifest.writeSetDigest,
      manifestDigest: manifest.manifestDigest,
      planReceiptDigest: "a".repeat(64),
      admissionReceiptDigest: "b".repeat(64),
      existingLaneStateDigest: "c".repeat(64),
    },
    cloudAuthority: verified.authority,
    integration,
  };
  const lanes = [
    lane({
      lanePath: REPOSITORY,
      branch: "refs/heads/main",
      stateDigest: "d".repeat(64),
    }),
    {
      ...lane({
        lanePath: CANDIDATE_PATH,
        branch: `refs/heads/${BRANCH}`,
        head: INTEGRATION_SHA,
        lease,
        stateDigest: "e".repeat(64),
      }),
      treeSha: INTEGRATION_TREE_SHA,
    },
    dormantLane,
  ];
  const continued = continuePlannedScopedLaneAdmission({
    lease,
    cloudAuthority: verified.authority,
    remoteAuthorityVerification: verified.verification,
    manifest,
    lanes,
    protectedRevision: BASE_SHA,
    protectedDeltaPaths: [],
    dormantPreservationReceipt,
    operatorDecisionDigest: OPERATOR_DECISION_DIGEST,
  });

  assert.equal(continued.continuationReceipt.candidateRevision, INTEGRATION_SHA);
  assert.equal(
    continued.continuationReceipt.preparedIntegrationReceiptDigest,
    digestValue(integration),
  );
});

test("continuation rejects prepared integration identity or declared-path drift", () => {
  const source = fixture();
  for (const integration of [
    {
      schema: "agentic-integration-commit/v1",
      commitSha: INTEGRATION_SHA,
      treeSha: "6".repeat(40),
      commitMessage: "fix(continuation): wrong tree",
      manifestDigest: "a".repeat(64),
      stagedDiffDigest: "b".repeat(64),
      paths: source.manifest.paths,
    },
    {
      schema: "agentic-integration-commit/v1",
      commitSha: INTEGRATION_SHA,
      treeSha: INTEGRATION_TREE_SHA,
      commitMessage: "fix(continuation): wrong path",
      manifestDigest: "a".repeat(64),
      stagedDiffDigest: "b".repeat(64),
      paths: ["docs/out-of-scope.md"],
    },
  ]) {
    const lease = { ...source.lease, integration };
    const lanes = source.lanes.map(item => item.path === CANDIDATE_PATH
      ? {
        ...item,
        head: INTEGRATION_SHA,
        treeSha: INTEGRATION_TREE_SHA,
        lease,
      }
      : item);
    assert.throws(
      () => continueFixture({ ...source, lease, lanes }),
      /exact prepared integration commit/u,
    );
  }
});

test("continuation rejects an uncovered local peer", () => {
  const source = fixture();
  const uncovered = lane({
    lanePath: "/workspace/worktrees/uncovered",
    branch: "refs/heads/agent/other/uncovered",
    stateDigest: "f".repeat(64),
  });
  assert.throws(
    () => continueFixture(source, { lanes: [...source.lanes, uncovered] }),
    /unattributed peer lanes/u,
  );
});

test("repository continuation rejects exact planned-lease drift before annotation", () => {
  const source = fixture();
  const changedLease = {
    ...source.lease,
    expiresAt: "2099-08-02T00:00:00.000Z",
  };
  assert.equal(changedLease.sessionId, source.lease.sessionId);
  assert.equal(changedLease.epoch, source.lease.epoch);
  let annotationInput;
  const wrapper = repositoryContinuationFixture(source, {
    annotate: input => {
      annotationInput = input;
      if (
        !input.expectedLease
        || digestValue(input.expectedLease) !== digestValue(changedLease)
      ) {
        throw new Error("Exact planned writer lease changed before annotation.");
      }
      return { ...changedLease, ...input.values };
    },
  });

  assert.throws(
    () => continuePlannedAdmissionFromRepository(wrapper.options),
    /exact planned writer lease changed/iu,
  );
  assert.deepEqual(annotationInput.expectedLease, source.lease);
  assert.equal(wrapper.counters.verifyCloudAuthority, 2);
  assert.equal(wrapper.counters.collectLaneState, 2);
  assert.equal(wrapper.counters.annotate, 1);
});

test("repository continuation joins cloud observations by canonical current claims", () => {
  const source = fixture();
  const later = verifiedAuthority(source.manifest, peerClaim(), {
    evaluationTime: LATER_EVALUATION,
    verificationReceipt: "a".repeat(64),
  });
  assert.equal(source.verified.verification.ledgerRevision, later.verification.ledgerRevision);
  assert.equal(source.verified.verification.ledgerDigest, later.verification.ledgerDigest);
  assert.equal(
    digestValue(source.verified.verification.inventory.claims),
    digestValue(later.verification.inventory.claims),
  );
  assert.notEqual(
    source.verified.verification.remoteClaimInventoryDigest,
    later.verification.remoteClaimInventoryDigest,
  );
  const accepted = repositoryContinuationFixture(source, {
    cloudVerifications: [source.verified, later],
  });
  const result = continuePlannedAdmissionFromRepository(accepted.options);
  assert.equal(result.admission.status, "admitted");
  assert.equal(accepted.counters.verifyCloudAuthority, 2);

  const changedClaims = verifiedAuthority(
    source.manifest,
    peerClaim({ heartbeatCounter: 4 }),
    {
      evaluationTime: LATER_EVALUATION,
      verificationReceipt: "b".repeat(64),
    },
  );
  assert.notEqual(
    digestValue(source.verified.verification.inventory.claims),
    digestValue(changedClaims.verification.inventory.claims),
  );
  const rejected = repositoryContinuationFixture(source, {
    cloudVerifications: [source.verified, changedClaims],
  });
  assert.throws(
    () => continuePlannedAdmissionFromRepository(rejected.options),
    /dormant preservation does not join the current cloud inventory/iu,
  );
  assert.equal(rejected.counters.annotate, 0);
});

test("repository continuation rejects a non-descendant protected revision", () => {
  const source = fixture();
  let annotationCalls = 0;
  const wrapper = repositoryContinuationFixture(source, {
    gitText: argumentsList => {
      if (argumentsList[0] === "fetch") return "";
      if (argumentsList[0] === "merge-base") {
        assert.deepEqual(argumentsList, [
          "merge-base", "--is-ancestor", BASE_SHA, PROTECTED_SHA,
        ]);
        throw new Error("Protected revision is not a monotonic descendant.");
      }
      throw new Error(`Unexpected git invocation: ${argumentsList.join(" ")}`);
    },
    annotate: () => {
      annotationCalls += 1;
      throw new Error("annotation must not run");
    },
  });

  assert.throws(
    () => continuePlannedAdmissionFromRepository(wrapper.options),
    /monotonic protected-source descendant/iu,
  );
  assert.equal(annotationCalls, 0);
  assert.equal(wrapper.counters.annotate, 0);
});

test("repository continuation rejects post-check registered-lane drift", () => {
  const source = fixture();
  const wrapper = repositoryContinuationFixture(source, {
    finalSnapshotOverrides: { laneStateDigest: "6".repeat(64) },
    annotate: () => {
      throw new Error("annotation must not run");
    },
  });

  assert.throws(
    () => continuePlannedAdmissionFromRepository(wrapper.options),
    /registered lane or protected-source state changed/iu,
  );
  assert.equal(wrapper.counters.collectLaneState, 2);
  assert.equal(wrapper.counters.verifyCloudAuthority, 1);
  assert.equal(wrapper.counters.annotate, 0);
});

test("repository continuation rejects an unproven protected fetch", () => {
  const source = fixture();
  const wrapper = repositoryContinuationFixture(source, {
    gitText: argumentsList => {
      assert.equal(argumentsList[0], "fetch");
      throw new Error("Repository owner has not fetched origin/main.");
    },
    annotate: () => {
      throw new Error("annotation must not run");
    },
  });

  assert.throws(
    () => continuePlannedAdmissionFromRepository(wrapper.options),
    /has not fetched origin\/main/u,
  );
  assert.equal(wrapper.counters.verifyCloudAuthority, 0);
  assert.equal(wrapper.counters.collectLaneState, 0);
  assert.equal(wrapper.counters.annotate, 0);
});
