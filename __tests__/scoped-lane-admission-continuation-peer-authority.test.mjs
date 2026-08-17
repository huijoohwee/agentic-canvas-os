import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "../scripts/github-cloud-collaboration-mapping.mjs";
import {
  normalizeDeclaredWriteScopeManifest,
} from "../scripts/scoped-lane-admission-lib.mjs";
import {
  continuePlannedScopedLaneAdmission,
} from "../scripts/scoped-lane-admission-continuation.mjs";
import { verifyDormantPreservation } from "../scripts/scoped-lane-authority-state.mjs";
import { verifyAdmissionCloudAuthority } from "../scripts/scoped-lane-cloud-authority.mjs";
import {
  verifyDeliveryAuthorizedPeerAuthorities,
} from "../scripts/scoped-lane-delivery-peer-authority.mjs";

const BASE_SHA = "a".repeat(40);
const CANDIDATE_SHA = "b".repeat(40);
const PEER_SHA = "c".repeat(40);
const LEDGER_SHA = "d".repeat(40);
const LEDGER_DIGEST = "e".repeat(64);
const EVALUATED_AT = "2026-08-14T04:00:00.000Z";
const FUTURE_EXPIRY = "2099-08-14T05:00:00.000Z";
const PAST_EXPIRY = "2026-08-14T03:00:00.000Z";
const OPERATOR_DECISION_DIGEST = "f".repeat(64);
const REPOSITORY = "/workspace/repository";
const TARGET_REPOSITORY = "owner/repository";
const CANDIDATE_PATH = "/workspace/worktrees/candidate";
const DORMANT_PATH = "/workspace/worktrees/dormant";
const PEER_PATH = "/workspace/worktrees/peer";
const CANDIDATE_BRANCH = "agent/candidate-device/continuation";
const CANDIDATE_SESSION = "candidate-session";
const CANDIDATE_DEVICE = "candidate-device";
const PEER_BRANCH = "agent/peer-device/peer-scope";
const PEER_SESSION = "peer-session";
const PEER_DEVICE = "peer-device";

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
    deviceId: pseudonymousIdentifier("device", CANDIDATE_DEVICE),
    leaseEpoch: 1,
    repositoryId: "github-repository:R_1",
    sessionId: pseudonymousIdentifier("session", CANDIDATE_SESSION),
    workItemId: "work-item:continuation",
    writeSetDigest: manifest.writeSetDigest,
  };
  return {
    claimId: digestValue(identity),
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    operationReceiptDigest: "1".repeat(64),
    state: "active",
    actorId: identity.actorId,
    repositoryId: identity.repositoryId,
    workItemId: identity.workItemId,
    canonicalBaseRevision: BASE_SHA,
    laneRevision: CANDIDATE_SHA,
    declaredWriteScope: manifest.declaredWriteSet,
    writeSetDigest: manifest.writeSetDigest,
    leaseEpoch: 1,
    transitionCounter: 2,
    heartbeatCounter: 1,
    reviewRequestId: "github-pull-request:PR_candidate",
    expiresAt: FUTURE_EXPIRY,
    fenceRevision: "2".repeat(64),
    transitionDigest: "3".repeat(64),
  };
}

function peerClaim({
  declaredWriteScope = ["path:docs/peer", "semantic:peer-scope"],
  expiresAt = FUTURE_EXPIRY,
} = {}) {
  return {
    claimId: "4".repeat(64),
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    operationReceiptDigest: "5".repeat(64),
    state: "active",
    actorId: "github-user:2",
    repositoryId: "github-repository:R_1",
    workItemId: "work-item:peer",
    canonicalBaseRevision: BASE_SHA,
    laneRevision: PEER_SHA,
    declaredWriteScope,
    writeSetDigest: digestValue(declaredWriteScope),
    leaseEpoch: 4,
    transitionCounter: 8,
    heartbeatCounter: 3,
    reviewRequestId: "github-pull-request:PR_peer",
    expiresAt,
    fenceRevision: "6".repeat(64),
    transitionDigest: "7".repeat(64),
  };
}
function verificationResult({
  claim,
  claims,
  ledgerRevision = LEDGER_SHA,
  ledgerDigest = LEDGER_DIGEST,
  evaluationTime = EVALUATED_AT,
  contractReceiptDigest = "8".repeat(64),
  subject = undefined,
} = {}) {
  const currentClaimInventoryCore = {
    schema: "agentic-cloud-collaboration-current-claim-inventory/v1",
    ledgerRevision,
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
    ledgerRevision,
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
    ledgerRevision,
    claimDigest: claim.fenceRevision,
    claim,
    currentClaimInventory,
    ...(subject ? { subject } : {}),
    findings: [],
    receipt: { ...receiptCore, receiptDigest: digestValue(receiptCore) },
  };
}

function verifiedAuthority(manifest, peerClaims, ledgerDigest = LEDGER_DIGEST) {
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
    laneRevision: CANDIDATE_SHA,
    cloudDeclaredWriteScope: manifest.declaredWriteSet,
    writeSetDigest: manifest.writeSetDigest,
    deviceId: CANDIDATE_DEVICE,
    sessionId: CANDIDATE_SESSION,
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
      ledgerDigest,
      claims: [claim, ...peerClaims],
    }),
      invoke: () => verificationResult({
        claim,
        claims: [claim, ...peerClaims],
        ledgerDigest,
    }),
  });
}

function lane({
  lanePath,
  branch,
  head = BASE_SHA,
  dirty = false,
  lease = null,
  stateDigest = "9".repeat(64),
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
    indexDigest: "a".repeat(64),
    workingTreeDigest: "b".repeat(64),
    stateDigest,
  };
}

function peerLease({
  claim,
  branch = PEER_BRANCH,
  scope = "peer-scope",
  expiresAt = claim.expiresAt,
  claimLedgerRevision = claim.transitionDigest,
} = {}) {
  return {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: claim.leaseEpoch,
    sessionId: PEER_SESSION,
    device: PEER_DEVICE,
    scope,
    branch,
    worktreePath: PEER_PATH,
    baseSha: BASE_SHA,
    fenceSha: PEER_SHA,
    pullRequestUrl: "https://github.test/owner/repository/pull/98",
    expiresAt,
    admission: {
      schema: "agentic-lane-admission-lease/v1",
      status: "admitted",
      semanticScope: scope,
      declaredWriteSet: claim.declaredWriteScope,
      writeSetDigest: claim.writeSetDigest,
      manifestDigest: "c".repeat(64),
      admissionReceiptDigest: "d".repeat(64),
      preservationReceiptDigest: "e".repeat(64),
    },
    cloudAuthority: {
      schema: "agentic-lane-cloud-authority/v1",
      provider: "github",
      ledgerRepository: "owner/ledger",
      targetRepository: TARGET_REPOSITORY,
      claimId: claim.claimId,
      claimDigest: claim.fenceRevision,
      ledgerRevision: LEDGER_SHA,
      claimLedgerRevision,
      canonicalBaseSha: BASE_SHA,
      laneRevision: PEER_SHA,
      cloudDeclaredWriteScope: claim.declaredWriteScope,
      writeSetDigest: claim.writeSetDigest,
      deviceId: PEER_DEVICE,
      sessionId: PEER_SESSION,
      reviewRequestId: claim.reviewRequestId,
      leaseEpoch: claim.leaseEpoch,
      transitionCounter: claim.transitionCounter,
      state: "active",
      expiresAt: claim.expiresAt,
      mutationAuthorityEligible: true,
    },
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

function scenario({
  peerClaims = [], peerLane, driftDormant = false,
  ledgerDigest = LEDGER_DIGEST,
} = {}) {
  const manifest = manifestFixture();
  const verified = verifiedAuthority(manifest, peerClaims, ledgerDigest);
  const dormantLane = lane({
    lanePath: DORMANT_PATH,
    branch: "refs/heads/agent/old-device/dormant",
    dirty: true,
    stateDigest: "1".repeat(64),
  });
  const dormantPreservationReceipt = verifyDormantPreservation({
    repository: REPOSITORY,
    targetRepository: TARGET_REPOSITORY,
    lanes: [dormantLane],
    worktreePaths: [DORMANT_PATH],
    operatorDecisionDigest: OPERATOR_DECISION_DIGEST,
    sessionId: CANDIDATE_SESSION,
    remoteAuthorityVerification: verified.verification,
    ghJson: githubIdentity,
    verifiedAt: EVALUATED_AT,
  });
  const candidateLease = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 23,
    sessionId: CANDIDATE_SESSION,
    device: CANDIDATE_DEVICE,
    scope: manifest.semanticScope,
    branch: CANDIDATE_BRANCH,
    worktreePath: CANDIDATE_PATH,
    baseSha: BASE_SHA,
    fenceSha: CANDIDATE_SHA,
    pullRequestUrl: "https://github.test/owner/repository/pull/97",
    expiresAt: FUTURE_EXPIRY,
    admission: {
      schema: "agentic-lane-admission-lease/v1",
      status: "planned",
      semanticScope: manifest.semanticScope,
      declaredWriteSet: manifest.declaredWriteSet,
      writeSetDigest: manifest.writeSetDigest,
      manifestDigest: manifest.manifestDigest,
      planReceiptDigest: "2".repeat(64),
      admissionReceiptDigest: "3".repeat(64),
      existingLaneStateDigest: "4".repeat(64),
    },
    cloudAuthority: verified.authority,
  };
  const observedDormant = driftDormant
    ? { ...dormantLane, stateDigest: "5".repeat(64) }
    : dormantLane;
  const lanes = [
    lane({
      lanePath: REPOSITORY,
      branch: "refs/heads/main",
      stateDigest: "6".repeat(64),
    }),
    lane({
      lanePath: CANDIDATE_PATH,
      branch: `refs/heads/${CANDIDATE_BRANCH}`,
      head: CANDIDATE_SHA,
      lease: candidateLease,
      stateDigest: "7".repeat(64),
    }),
    observedDormant,
    ...(peerLane ? [peerLane] : []),
  ];
  return {
    manifest,
    verified,
    dormantPreservationReceipt,
    candidateLease,
    lanes,
  };
}

function continueScenario(source, overrides = {}) {
  return continuePlannedScopedLaneAdmission({
    lease: source.candidateLease,
    cloudAuthority: source.verified.authority,
    remoteAuthorityVerification: source.verified.verification,
    manifest: source.manifest,
    lanes: source.lanes,
    protectedRevision: BASE_SHA,
    dormantPreservationReceipt: source.dormantPreservationReceipt,
    operatorDecisionDigest: OPERATOR_DECISION_DIGEST,
    ...overrides,
  });
}

function peerLaneForLease(lease, stateDigest = "8".repeat(64)) {
  return lane({
    lanePath: PEER_PATH,
    branch: `refs/heads/${lease.branch}`,
    head: PEER_SHA,
    lease,
    stateDigest,
  });
}

function operationProvenOverlappingDeliveryPeer() {
  const declaredWriteScope = manifestFixture().declaredWriteSet;
  const writeSetDigest = digestValue(declaredWriteScope);
  const focusedEvidenceDigest = "a".repeat(64);
  const identity = {
    actorId: "github-user:2", repositoryId: "github-repository:R_1",
    workItemId: "work-item:delivery-peer", canonicalBaseRevision: BASE_SHA,
    deviceId: pseudonymousIdentifier("device", PEER_DEVICE),
    sessionId: pseudonymousIdentifier("session", PEER_SESSION),
    declaredWriteScope, writeSetDigest, laneRevision: PEER_SHA, leaseEpoch: 4,
    predecessorClaimId: null,
  };
  const claimId = digestValue({
    actorId: identity.actorId, canonicalBaseRevision: BASE_SHA,
    deviceId: identity.deviceId, leaseEpoch: 4,
    repositoryId: identity.repositoryId, sessionId: identity.sessionId,
    workItemId: identity.workItemId, writeSetDigest,
  });
  const entries = [];
  const append = (action, state, transitionCounter, { reviewed = false } = {}) => {
    const claimCore = {
      claimId, ...identity, state, transitionCounter, heartbeatCounter: 0,
      reviewRequestId: reviewed ? "github-pull-request:PR_peer" : null,
      evidenceDigest: reviewed ? focusedEvidenceDigest : null,
      expiresAt: FUTURE_EXPIRY, handoff: null, release: null,
      ...(state === "delivery-authorized" ? {
        deliveryAuthorization: {
          focusedEvidenceDigest, integrationIntentDigest: "b".repeat(64),
          operatorDecisionDigest: "c".repeat(64), evaluationTime: EVALUATED_AT,
        },
      } : {}),
    };
    const draft = {
      schema: "agentic-cloud-collaboration-entry/v1",
      sequence: entries.length + 1,
      parentDigest: entries.at(-1)?.digest || null,
      action, repositoryId: identity.repositoryId, claimId,
      idempotencyKey: digestValue(`key:${entries.length + 1}`),
      requestDigest: digestValue(`request:${entries.length + 1}`),
      evaluationTime: `2026-08-14T04:00:0${entries.length + 1}.000Z`,
      claimCore, claimDigest: digestValue(claimCore),
    };
    entries.push({ ...draft, digest: digestValue(draft) });
  };
  const ledger = source => ({
    schema: "agentic-cloud-collaboration-ledger/v1",
    ledgerRepositoryId: "github-repository:R_ledger",
    sequence: source.length, headDigest: source.at(-1).digest,
    entries: structuredClone(source),
  });
  append("claim", "active", 1);
  append("review-ready", "review-ready", 2, { reviewed: true });
  const historicalLedger = ledger(entries);
  append("delivery-authorize", "delivery-authorized", 3, { reviewed: true });
  const currentLedger = ledger(entries);
  const currentEntry = currentLedger.entries.at(-1);
  const currentClaim = {
    ...currentEntry.claimCore, state: "delivery_authorized",
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    operationReceiptDigest: "f".repeat(64),
    fenceRevision: currentEntry.claimDigest,
    transitionDigest: currentEntry.digest,
  };
  const cloudAuthority = {
    schema: "agentic-lane-cloud-authority/v1", state: "review_ready", provider: "github",
    ledgerRepository: "owner/ledger",
    targetRepository: TARGET_REPOSITORY,
    claimId, claimDigest: historicalLedger.entries.at(-1).claimDigest,
    ledgerRevision: "1".repeat(40),
    claimLedgerRevision: historicalLedger.headDigest,
    canonicalBaseSha: BASE_SHA, laneRevision: PEER_SHA,
    cloudDeclaredWriteScope: declaredWriteScope, writeSetDigest,
    deviceId: PEER_DEVICE, sessionId: PEER_SESSION,
    reviewRequestId: "github-pull-request:PR_peer",
    leaseEpoch: 4, transitionCounter: 2, expiresAt: FUTURE_EXPIRY,
    focusedEvidenceDigest,
  };
  const baseLease = peerLease({
    claim: currentClaim, branch: CANDIDATE_BRANCH, scope: "continuation",
  });
  const lease = {
    ...baseLease, status: "review_ready", reviewHeadSha: PEER_SHA,
    cloudAuthority,
  };
  const peerLane = peerLaneForLease(lease);
  const pullRequest = {
    id: "PR_peer", url: lease.pullRequestUrl, state: "OPEN", isDraft: false,
    headRefName: lease.branch, headRefOid: PEER_SHA,
    headRepository: { nameWithOwner: TARGET_REPOSITORY },
    baseRefName: "main", baseRefOid: BASE_SHA,
  };
  const verifyDeliveryPeers = input => verifyDeliveryAuthorizedPeerAuthorities({
    ...input,
    gitText: (_path, argumentsList) => {
      if (argumentsList[0] === "rev-parse") return PEER_SHA;
      if (argumentsList[0] === "status") return "";
      throw new Error(`Unexpected Git invocation: ${argumentsList.join(" ")}`);
    },
    ghText: () => JSON.stringify(pullRequest),
    readLedger: ({ revision }) => structuredClone(
      revision === cloudAuthority.ledgerRevision ? historicalLedger : currentLedger,
    ),
      invokeCloudVerifier: ({ request }) => verificationResult({
        claim: currentClaim,
        claims: [currentClaim],
      ledgerRevision: request.expectedLedgerRevision,
        ledgerDigest: currentLedger.headDigest,
      subject: {
        repository: TARGET_REPOSITORY, pullRequestNumber: 98,
        branch: lease.branch, headSha: PEER_SHA, canonicalBaseSha: BASE_SHA,
      },
    }),
  });
  return { currentClaim, currentLedger, peerLane, verifyDeliveryPeers };
}

test("current disjoint unselected peer continues with planner-parity authority state", () => {
  const claim = peerClaim();
  const lease = peerLease({ claim });
  const source = scenario({
    peerClaims: [claim],
    peerLane: peerLaneForLease(lease),
  });
  const result = continueScenario(source);
  const expectedState = [
    {
      path: REPOSITORY,
      stateDigest: "6".repeat(64),
      authorityState: "canonical",
      dormantPreservationReceiptDigest: null,
    },
    {
      path: DORMANT_PATH,
      stateDigest: "1".repeat(64),
      authorityState: "dormant-preserved",
      dormantPreservationReceiptDigest:
        source.dormantPreservationReceipt.receiptDigest,
    },
    {
      path: PEER_PATH,
      stateDigest: "8".repeat(64),
      authorityState: "current",
      dormantPreservationReceiptDigest: null,
    },
  ].sort((left, right) => left.path.localeCompare(right.path));

  assert.equal(result.admission.status, "admitted");
  assert.equal(result.admission.existingLaneStateDigest, digestValue(expectedState));
  assert.match(result.deliveryPeerAuthorityReceiptDigest, /^[0-9a-f]{64}$/u);
  assert.equal(
    result.continuationReceipt.deliveryPeerAuthorityReceiptDigest,
    result.deliveryPeerAuthorityReceiptDigest,
  );
});

test("stale local-to-cloud peer join fails with exact attribution reason", () => {
  const claim = peerClaim();
  const lease = peerLease({
    claim,
    claimLedgerRevision: "0".repeat(64),
  });
  const source = scenario({
    peerClaims: [claim],
    peerLane: peerLaneForLease(lease),
  });

  assert.throws(
    () => continueScenario(source),
    /peer lanes: .*classification=ambiguous; reasons=missing-authoritative-owner/u,
  );
});

test("expired admitted disjoint peer remains attributable without a current claim", () => {
  const claim = peerClaim({ expiresAt: PAST_EXPIRY });
  const lease = peerLease({ claim, expiresAt: PAST_EXPIRY });
  const source = scenario({ peerLane: peerLaneForLease(lease) });
  const result = continueScenario(source);

  assert.equal(result.admission.status, "admitted");
});

test("lease-less peer remains fail-closed", () => {
  const source = scenario({
    peerLane: lane({
      lanePath: PEER_PATH,
      branch: `refs/heads/${PEER_BRANCH}`,
      head: PEER_SHA,
    }),
  });

  assert.throws(
    () => continueScenario(source),
    /classification=ambiguous; reasons=missing-authoritative-owner/u,
  );
});

test("operation-proven delivery peer cannot erase pre-bind overlap", () => {
  const proof = operationProvenOverlappingDeliveryPeer();
  const source = scenario({
    peerClaims: [proof.currentClaim],
    peerLane: proof.peerLane,
    ledgerDigest: proof.currentLedger.headDigest,
  });
  let verificationCalls = 0;

  assert.throws(() => continueScenario(source, {
    verifyDeliveryPeers: input => {
      verificationCalls += 1;
      const verification = proof.verifyDeliveryPeers(input);
      assert.equal(verification.peers.length, 1);
      return verification;
    },
  }), error => ["same-branch", "same-semantic-scope", "write-set-overlap"]
    .every(reason => error.message.includes(reason)));
  assert.equal(verificationCalls, 1);
});

test("selected dormant peer must retain the operator-bound state digest", () => {
  const source = scenario({ driftDormant: true });

  assert.throws(
    () => continueScenario(source),
    /classification=ambiguous; reasons=missing-authoritative-owner/u,
  );
});
