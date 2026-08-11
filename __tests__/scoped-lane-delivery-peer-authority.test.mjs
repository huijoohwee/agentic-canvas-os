import assert from "node:assert/strict";
import test from "node:test";

import {
  digestValue,
} from "../scripts/cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "../scripts/github-cloud-collaboration-mapping.mjs";
import {
  isOperationDerivedDeliveryPeerVerification,
  verifyDeliveryAuthorizedPeerAuthorities,
} from "../scripts/scoped-lane-delivery-peer-authority.mjs";

const canonicalSha = "a".repeat(40);
const reviewedSha = "b".repeat(40);
const refreshedSha = "c".repeat(40);
const mainParentSha = "d".repeat(40);
const treeSha = "e".repeat(40);
const historicalRevision = "1".repeat(40);
const currentRevision = "2".repeat(40);
const advancedRevision = "6".repeat(40);
const oldExpiry = "2099-07-31T00:00:00.000Z";
const newExpiry = "2099-08-01T00:00:00.000Z";
const evaluatedAt = "2026-08-04T00:00:00.000Z";
const repository = "owner/repository";
const ledgerRepository = "owner/ledger";
const peerPath = "/workspace/peer";
const branch = "agent/peer/delivery-peer";
const pullRequestUrl = `https://github.com/${repository}/pull/17`;
const reviewRequestId = "github-pull-request:PR_peer";
const focusedEvidenceDigest = "3".repeat(64);
const writeSet = ["path:docs/peer", "semantic:delivery-peer"];
const writeSetDigest = digestValue(writeSet);
const identity = {
  actorId: "github-user:1",
  deviceId: pseudonymousIdentifier("device", "peer"),
  sessionId: pseudonymousIdentifier("session", "peer-session"),
  repositoryId: "github-repository:R_peer",
  workItemId: "work-item:peer",
  canonicalBaseRevision: canonicalSha,
  declaredWriteScope: writeSet,
  writeSetDigest,
  laneRevision: reviewedSha,
  leaseEpoch: 1,
  predecessorClaimId: null,
};
const claimId = digestValue({
  actorId: identity.actorId,
  canonicalBaseRevision: identity.canonicalBaseRevision,
  deviceId: identity.deviceId,
  leaseEpoch: identity.leaseEpoch,
  repositoryId: identity.repositoryId,
  sessionId: identity.sessionId,
  workItemId: identity.workItemId,
  writeSetDigest: identity.writeSetDigest,
});

function fixture({ refreshed = true, heartbeatCount = 1, rootLedger = false } = {}) {
  const activeCore = claimCore({
    state: "active",
    transitionCounter: 1,
    heartbeatCounter: 0,
    expiresAt: oldExpiry,
    evidenceDigest: null,
    reviewRequestId: null,
  });
  const reviewCore = claimCore({
    state: "review-ready",
    transitionCounter: 2,
    heartbeatCounter: 0,
    expiresAt: oldExpiry,
    evidenceDigest: focusedEvidenceDigest,
    reviewRequestId,
  });
  const deliveryCore = claimCore({
    state: "delivery-authorized",
    transitionCounter: 3,
    heartbeatCounter: 0,
    expiresAt: oldExpiry,
    evidenceDigest: focusedEvidenceDigest,
    reviewRequestId,
    deliveryAuthorization: {
      focusedEvidenceDigest,
      integrationIntentDigest: "4".repeat(64),
      operatorDecisionDigest: "5".repeat(64),
      evaluationTime: "2026-08-04T00:00:03.000Z",
    },
  });
  const entries = [
    entry({ action: "claim", core: activeCore, entries: [] }),
  ];
  entries.push(entry({
    action: rootLedger ? "continue" : "review-ready",
    core: rootLedger ? { ...reviewCore, state: "reviewed" } : reviewCore,
    entries,
    schema: rootLedger ? "agentic-cloud-collaboration-entry/v2" : undefined,
  }));
  const historicalLedger = ledger(entries);
  entries.push(entry({
    action: rootLedger ? "integrate" : "delivery-authorize",
    core: rootLedger ? { ...deliveryCore, state: "integrated-preserved" } : deliveryCore,
    entries,
    schema: rootLedger ? "agentic-cloud-collaboration-entry/v2" : undefined,
  }));
  for (let index = 0; index < heartbeatCount; index += 1) {
    entries.push(entry({
      action: rootLedger ? "continue" : "heartbeat",
      core: claimCore({
        state: rootLedger ? "integrated-preserved" : "delivery-authorized",
        transitionCounter: 4 + index,
        heartbeatCounter: 1 + index,
        expiresAt: newExpiry,
        evidenceDigest: focusedEvidenceDigest,
        reviewRequestId,
        deliveryAuthorization: deliveryCore.deliveryAuthorization,
      }),
      entries,
      schema: rootLedger ? "agentic-cloud-collaboration-entry/v2" : undefined,
    }));
  }
  const currentLedger = ledger(entries);
  const currentEntry = entries.at(-1);
  const current = publicClaim(currentEntry);
  const inventoryCore = {
    schema: "agentic-cloud-claim-inventory/v1",
    observedLedgerHeadRevision: currentRevision,
    ledgerDigest: currentLedger.headDigest,
    evaluationTime: evaluatedAt,
    claims: [current],
  };
  const inventory = {
    ...inventoryCore,
    inventoryDigest: digestValue(inventoryCore),
  };
  const remoteAuthorityVerification = {
    schema: "agentic-lane-cloud-verification/v1",
    status: "ready",
    ledgerRevision: currentRevision,
    ledgerDigest: currentLedger.headDigest,
    remoteClaimInventoryDigest: inventory.inventoryDigest,
    verifiedAt: evaluatedAt,
    inventory,
  };
  const cloudAuthority = {
    schema: "agentic-lane-cloud-authority/v1",
    state: "review_ready",
    provider: "github",
    ledgerRepository,
    targetRepository: repository,
    claimId,
    claimDigest: historicalLedger.entries.at(-1).claimDigest,
    ledgerRevision: historicalRevision,
    claimLedgerRevision: historicalLedger.headDigest,
    canonicalBaseSha: canonicalSha,
    laneRevision: reviewedSha,
    cloudDeclaredWriteScope: writeSet,
    writeSetDigest,
    deviceId: "peer",
    sessionId: "peer-session",
    reviewRequestId,
    leaseEpoch: 1,
    transitionCounter: 2,
    expiresAt: oldExpiry,
    focusedEvidenceDigest,
  };
  const lane = {
    path: peerPath,
    head: refreshed ? refreshedSha : reviewedSha,
    branch: `refs/heads/${branch}`,
    dirty: false,
    invalid: false,
    leaseAmbiguous: false,
    lease: {
      status: "review_ready",
      branch,
      worktreePath: peerPath,
      pullRequestUrl,
      reviewHeadSha: reviewedSha,
      cloudAuthority,
    },
  };
  const pullRequest = {
    id: "PR_peer",
    url: pullRequestUrl,
    state: "OPEN",
    isDraft: false,
    headRefName: branch,
    headRefOid: lane.head,
    headRepository: { nameWithOwner: repository },
    baseRefName: "main",
    baseRefOid: refreshed ? mainParentSha : canonicalSha,
  };
  const operations = {
    gitText: (_cwd, args) => gitResponse(args, { lane, refreshed }),
    ghText: () => JSON.stringify(pullRequest),
    readLedger: ({ revision }) => structuredClone(
      revision === historicalRevision ? historicalLedger : currentLedger,
    ),
    invokeCloudVerifier: ({ request }) => cloudVerificationResult({
      request,
      current,
      currentLedger,
      pullRequest,
    }),
  };
  return {
    lane,
    cloudAuthority,
    current,
    historicalLedger,
    currentLedger,
    pullRequest,
    remoteAuthorityVerification,
    operations,
  };
}

function claimCore(overrides) {
  return {
    claimId,
    ...identity,
    handoff: null,
    release: null,
    ...overrides,
  };
}

function entry({ action, core, entries, schema = "agentic-cloud-collaboration-entry/v1" }) {
  const draft = {
    schema,
    sequence: entries.length + 1,
    parentDigest: entries.at(-1)?.digest || null,
    action,
    repositoryId: identity.repositoryId,
    claimId,
    idempotencyKey: digestValue(`key:${entries.length + 1}`),
    requestDigest: digestValue(`request:${entries.length + 1}`),
    evaluationTime: `2026-08-04T00:00:0${entries.length + 1}.000Z`,
    claimCore: core,
    claimDigest: digestValue(core),
  };
  return { ...draft, digest: digestValue(draft) };
}

function ledger(entries) {
  return {
    schema: "agentic-cloud-collaboration-ledger/v1",
    ledgerRepositoryId: "github-repository:R_ledger",
    sequence: entries.length,
    headDigest: entries.at(-1)?.digest || null,
    entries: structuredClone(entries),
  };
}

function publicClaim(source) {
  const core = source.claimCore;
  const state = {
    reviewed: "review_ready",
    "integrated-preserved": "delivery_authorized",
  }[core.state] || core.state.replaceAll("-", "_");
  const claim = {
    claimId: core.claimId,
    state,
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
    fenceRevision: source.claimDigest,
    transitionDigest: source.digest,
  };
  return { ...claim, recordDigest: digestValue(claim) };
}

function gitResponse(args, { lane, refreshed }) {
  const key = args.join(" ");
  if (key === "rev-parse HEAD") return lane.head;
  if (key === "status --porcelain=v1 -z --untracked-files=all") return "";
  if (!refreshed) throw new Error(`unexpected git command: ${key}`);
  if (key === `rev-list --parents -n 1 ${refreshedSha}`) {
    return `${refreshedSha} ${reviewedSha} ${mainParentSha}`;
  }
  if (key === `merge-base --is-ancestor ${mainParentSha} origin/main`) return "";
  if (key === `merge-tree --write-tree --no-messages ${reviewedSha} ${mainParentSha}`) {
    return treeSha;
  }
  if (key === `rev-parse ${refreshedSha}^{tree}`) return treeSha;
  throw new Error(`unexpected git command: ${key}`);
}

function cloudVerificationResult({ request, current, currentLedger, pullRequest }) {
  assert.equal(request.expectedClaimDigest, current.fenceRevision);
  return {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "verify",
    status: "ready",
    ledgerRevision: request.expectedLedgerRevision,
    claimDigest: current.fenceRevision,
    claim: current,
    subject: {
      repository,
      pullRequestNumber: 17,
      branch,
      headSha: pullRequest.headRefOid,
      canonicalBaseSha: pullRequest.baseRefOid,
    },
    receipt: { ledgerDigest: currentLedger.headDigest },
  };
}

function appendUnrelatedClaim(subject) {
  const otherIdentity = {
    actorId: "github-user:other",
    deviceId: pseudonymousIdentifier("device", "other"),
    sessionId: pseudonymousIdentifier("session", "other-session"),
    repositoryId: "github-repository:R_other",
    workItemId: "work-item:other",
    canonicalBaseRevision: canonicalSha,
    declaredWriteScope: ["path:docs/other", "semantic:other"],
    leaseEpoch: 1,
    predecessorClaimId: null,
  };
  otherIdentity.writeSetDigest = digestValue(otherIdentity.declaredWriteScope);
  const otherClaimId = digestValue({
    actorId: otherIdentity.actorId,
    canonicalBaseRevision: otherIdentity.canonicalBaseRevision,
    deviceId: otherIdentity.deviceId,
    leaseEpoch: otherIdentity.leaseEpoch,
    repositoryId: otherIdentity.repositoryId,
    sessionId: otherIdentity.sessionId,
    workItemId: otherIdentity.workItemId,
    writeSetDigest: otherIdentity.writeSetDigest,
  });
  const core = {
    claimId: otherClaimId,
    ...otherIdentity,
    laneRevision: reviewedSha,
    state: "active",
    transitionCounter: 1,
    heartbeatCounter: 0,
    reviewRequestId: null,
    evidenceDigest: null,
    expiresAt: newExpiry,
    handoff: null,
    release: null,
  };
  const draft = {
    schema: "agentic-cloud-collaboration-entry/v1",
    sequence: subject.currentLedger.entries.length + 1,
    parentDigest: subject.currentLedger.headDigest,
    action: "claim",
    repositoryId: otherIdentity.repositoryId,
    claimId: otherClaimId,
    idempotencyKey: digestValue("key:unrelated"),
    requestDigest: digestValue("request:unrelated"),
    evaluationTime: "2026-08-04T00:00:09.000Z",
    claimCore: core,
    claimDigest: digestValue(core),
  };
  const unrelatedEntry = { ...draft, digest: digestValue(draft) };
  subject.currentLedger.entries.push(unrelatedEntry);
  subject.currentLedger.sequence = subject.currentLedger.entries.length;
  subject.currentLedger.headDigest = unrelatedEntry.digest;
  const claims = [subject.current, publicClaim(unrelatedEntry)]
    .sort((left, right) => left.claimId.localeCompare(right.claimId));
  const inventoryCore = {
    schema: "agentic-cloud-claim-inventory/v1",
    observedLedgerHeadRevision: advancedRevision,
    ledgerDigest: subject.currentLedger.headDigest,
    evaluationTime: evaluatedAt,
    claims,
  };
  const inventory = {
    ...inventoryCore,
    inventoryDigest: digestValue(inventoryCore),
  };
  subject.remoteAuthorityVerification = {
    ...subject.remoteAuthorityVerification,
    ledgerRevision: advancedRevision,
    ledgerDigest: subject.currentLedger.headDigest,
    remoteClaimInventoryDigest: inventory.inventoryDigest,
    inventory,
  };
}

function verify(subject) {
  return verifyDeliveryAuthorizedPeerAuthorities({
    lanes: [subject.lane],
    remoteAuthorityVerification: subject.remoteAuthorityVerification,
    ...subject.operations,
  });
}

test("operation-derived proof accepts reviewed or protected-refresh heads and heartbeat-only suffixes", () => {
  for (const options of [
    { refreshed: false, heartbeatCount: 0 },
    { refreshed: true, heartbeatCount: 1 },
    { refreshed: true, heartbeatCount: 3 },
  ]) {
    const result = verify(fixture(options));
    assert.equal(result.peers.length, 1);
    assert.equal(result.peers[0].heartbeatSuffixCount, options.heartbeatCount);
    assert.equal(result.peers[0].provider.headSha, result.peers[0].observedHeadSha);
    assert.equal(isOperationDerivedDeliveryPeerVerification(result), true);
    assert.equal(
      isOperationDerivedDeliveryPeerVerification(structuredClone(result)),
      false,
    );
  }
});

test("operation-derived proof projects exact root v2 review and delivery entries", () => {
  const result = verify(fixture({ rootLedger: true, heartbeatCount: 1 }));
  assert.equal(result.peers.length, 1);
  assert.equal(result.peers[0].deliveryAuthorizationCounter, 3);
  assert.equal(result.peers[0].heartbeatSuffixCount, 1);
});

test("root v2 projection accepts a bounded continue heartbeat suffix", () => {
  const result = verify(fixture({ rootLedger: true, heartbeatCount: 2 }));
  assert.equal(result.peers.length, 1);
  assert.equal(result.peers[0].deliveryAuthorizationCounter, 3);
  assert.equal(result.peers[0].heartbeatSuffixCount, 2);
});

test("peer authority stays stable across unrelated ledger appends while the operation receipt advances", () => {
  const subject = fixture();
  const before = verify(subject);
  appendUnrelatedClaim(subject);
  const after = verify(subject);
  assert.equal(after.peers.length, 1);
  assert.equal(after.peerSetDigest, before.peerSetDigest);
  assert.equal(after.peers[0].authorityDigest, before.peers[0].authorityDigest);
  assert.notEqual(after.peers[0].currentLedgerRevision, before.peers[0].currentLedgerRevision);
  assert.notEqual(after.operationReceiptDigest, before.operationReceiptDigest);
});

test("operation-derived proof graph is deeply immutable", () => {
  const result = verify(fixture());
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.peers), true);
  assert.equal(Object.isFrozen(result.peers[0].provider), true);
  assert.equal(Object.isFrozen(result.peers[0].protectedMainRefresh.refreshes), true);
  assert.throws(() => result.peers.push({}), TypeError);
  assert.throws(() => {
    result.peers[0].provider.state = "CLOSED";
  }, TypeError);
});

test("peer verifier strips ambient request projection before cloud verification", () => {
  const subject = fixture();
  subject.operations.environment = {
    PATH: "/usr/bin",
    GH_TOKEN: "retained-auth",
    AGENTIC_CLOUD_CLAIM_ID: "9".repeat(64),
    AGENTIC_CLOUD_EXPECTED_LEDGER_REVISION: "9".repeat(40),
    AGENTIC_CLOUD_HEAD_SHA: "9".repeat(40),
    AGENTIC_TARGET_REPOSITORY: "other/repository",
    NODE_OPTIONS: "--require=/tmp/poison.cjs",
  };
  const invoke = subject.operations.invokeCloudVerifier;
  subject.operations.invokeCloudVerifier = input => {
    assert.equal(input.environment.PATH, "/usr/bin");
    assert.equal(input.environment.GH_TOKEN, "retained-auth");
    assert.equal(
      Object.keys(input.environment).some(key => key.startsWith("AGENTIC_")),
      false,
    );
    assert.equal("NODE_OPTIONS" in input.environment, false);
    return invoke(input);
  };
  assert.equal(verify(subject).peers.length, 1);
});

test("historical, current, provider, refresh, and double-read drift fail closed", () => {
  const cases = [
    ["predecessor-claim", subject => {
      subject.cloudAuthority.claimDigest = "9".repeat(64);
    }],
    ["predecessor-transition", subject => {
      subject.cloudAuthority.claimLedgerRevision = "9".repeat(64);
    }],
    ["provider-closed", subject => {
      subject.pullRequest.state = "CLOSED";
    }],
    ["provider-draft", subject => {
      subject.pullRequest.isDraft = true;
    }],
    ["provider-fork", subject => {
      subject.pullRequest.headRepository.nameWithOwner = "other/repository";
    }],
    ["provider-head", subject => {
      subject.pullRequest.headRefOid = "9".repeat(40);
    }],
    ["unreconciled-pr-base", subject => {
      subject.lane.head = reviewedSha;
      subject.pullRequest.headRefOid = reviewedSha;
      subject.pullRequest.baseRefOid = mainParentSha;
      subject.operations.gitText = (_cwd, args) => gitResponse(args, {
        lane: subject.lane,
        refreshed: false,
      });
    }],
    ["current-record", subject => {
      subject.currentLedger.entries.at(-1).claimDigest = "9".repeat(64);
    }],
    ["non-heartbeat-suffix", subject => {
      subject.currentLedger.entries.at(-1).action = "handoff";
    }],
    ["cloud-subject", subject => {
      subject.operations.invokeCloudVerifier = input => ({
        ...cloudVerificationResult({
          request: input.request,
          current: subject.current,
          currentLedger: subject.currentLedger,
          pullRequest: subject.pullRequest,
        }),
        subject: {
          repository,
          pullRequestNumber: 17,
          branch,
          headSha: "9".repeat(40),
          canonicalBaseSha: mainParentSha,
        },
      });
    }],
    ["malformed-refresh", subject => {
      subject.operations.gitText = (_cwd, args) => {
        if (args.join(" ") === `rev-list --parents -n 1 ${refreshedSha}`) {
          return `${refreshedSha} ${reviewedSha}`;
        }
        return gitResponse(args, { lane: subject.lane, refreshed: true });
      };
    }],
  ];
  for (const [label, mutate] of cases) {
    const subject = fixture();
    mutate(subject);
    assert.equal(verify(subject).peers.length, 0, label);
  }
  const torn = fixture();
  let reads = 0;
  torn.operations.ghText = () => {
    reads += 1;
    return JSON.stringify({
      ...torn.pullRequest,
      baseRefOid: reads > 1 ? "8".repeat(40) : mainParentSha,
    });
  };
  assert.equal(verify(torn).peers.length, 0, "torn provider reads");
});

test("dirty lanes, expired current claims, and caller-shaped results cannot gain authority", () => {
  const dirty = fixture();
  dirty.lane.dirty = true;
  assert.equal(verify(dirty).peers.length, 0);
  const expired = fixture();
  expired.current.expiresAt = "2026-08-03T00:00:00.000Z";
  const { recordDigest: _expiredRecordDigest, ...expiredRecordCore } = expired.current;
  expired.current.recordDigest = digestValue(expiredRecordCore);
  const {
    inventoryDigest: _expiredInventoryDigest,
    ...expiredInventoryCore
  } = expired.remoteAuthorityVerification.inventory;
  expired.remoteAuthorityVerification.inventory.inventoryDigest =
    digestValue(expiredInventoryCore);
  expired.remoteAuthorityVerification.remoteClaimInventoryDigest =
    expired.remoteAuthorityVerification.inventory.inventoryDigest;
  assert.equal(verify(expired).peers.length, 0);
  const recordDrift = fixture();
  recordDrift.current.recordDigest = "9".repeat(64);
  assert.throws(() => verify(recordDrift), /mutated cloud claim record/u);
  const inventoryDrift = fixture();
  inventoryDrift.remoteAuthorityVerification.inventory.inventoryDigest = "9".repeat(64);
  inventoryDrift.remoteAuthorityVerification.remoteClaimInventoryDigest = "9".repeat(64);
  assert.throws(() => verify(inventoryDrift), /mutated cloud inventory/u);
  assert.equal(isOperationDerivedDeliveryPeerVerification({
    schema: "agentic-delivery-peer-authority-verification/v1",
    status: "ready",
    peers: [],
  }), false);
});
