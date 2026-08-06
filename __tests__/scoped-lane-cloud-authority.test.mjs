import assert from "node:assert/strict";
import test from "node:test";

import { digestValue, normalizeWriteSet } from "../scripts/cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "../scripts/github-cloud-collaboration-mapping.mjs";
import {
  attachCloudHeartbeatMachineEvidence,
  authorizeDeliveryAdmissionCloudAuthority,
  bindAdmissionCloudAuthority,
  claimLegacyReviewAdmissionCloudAuthority,
  cloudAuthorityFromResult,
  heartbeatAdmissionCloudAuthority,
  reviewReadyAdmissionCloudAuthority,
} from "../scripts/scoped-lane-cloud-authority.mjs";
import {
  normalizeCurrentClaimInventory,
  reconcileCloudAuthorityProjection,
} from "../scripts/scoped-lane-cloud-reconciliation.mjs";

const BASE_SHA = "1".repeat(40);
const HEAD_SHA = "2".repeat(40);
const LEDGER_SHA = "3".repeat(40);
const NEXT_LEDGER_SHA = "4".repeat(40);
const EXPIRES_AT = "2099-08-05T08:00:00.000Z";
const EVALUATED_AT = "2026-08-04T08:00:00.000Z";
const BRANCH = "agent/device/git-guidelines-companion";
const PULL_REQUEST_NUMBER = 261;
const REVIEW_REQUEST_ID = "github-pull-request:PR_261";
const ACTOR_ID = "github-user:7";
const REPOSITORY_ID = "github-repository:R_target";
const WORK_ITEM_ID = "work-item:git-guidelines-companion";
const DEVICE_ID = "device-a";
const SESSION_ID = "session-a";
const DECLARED_WRITE_SET = normalizeWriteSet([
  "path:scripts/cloud-collaboration-contract.mjs",
  "semantic:git-guidelines-companion",
]);
const WRITE_SET_DIGEST = digestValue(DECLARED_WRITE_SET);
const CLAIM_ID = digestValue({
  actorId: ACTOR_ID,
  canonicalBaseRevision: BASE_SHA,
  leaseEpoch: 1,
  repositoryId: REPOSITORY_ID,
  workItemId: WORK_ITEM_ID,
  writeSetDigest: WRITE_SET_DIGEST,
});
const LEGACY_CLAIM_ID = digestValue({
  actorId: ACTOR_ID,
  canonicalBaseRevision: BASE_SHA,
  deviceId: pseudonymousIdentifier("device", DEVICE_ID),
  leaseEpoch: 1,
  repositoryId: REPOSITORY_ID,
  sessionId: pseudonymousIdentifier("session", SESSION_ID),
  workItemId: WORK_ITEM_ID,
  writeSetDigest: WRITE_SET_DIGEST,
});
const MANIFEST = Object.freeze({
  schema: "agentic-declared-write-scope/v1",
  semanticScope: "git-guidelines-companion",
  declaredWriteSet: DECLARED_WRITE_SET,
  writeSetDigest: WRITE_SET_DIGEST,
  manifestDigest: digestValue({ declaredWriteSet: DECLARED_WRITE_SET }),
  admittedReportDigest: "a".repeat(64),
});

function focusedEvidenceDigest() {
  return digestValue({
    schema: "agentic-focused-review-evidence/v1",
    command: "npm run check",
    branch: BRANCH,
    headSha: HEAD_SHA,
    pullRequestNumber: PULL_REQUEST_NUMBER,
    admittedReportDigest: MANIFEST.admittedReportDigest,
  });
}

function rootClaim({
  claimId = CLAIM_ID,
  claimIdentitySchema = "agentic-cloud-collaboration-entry/v2",
  state = "current",
  laneRevision = HEAD_SHA,
  transitionCounter = 2,
  fenceRevision = "b".repeat(64),
  transitionDigest = "c".repeat(64),
  reviewRequestId = null,
  integration = null,
  integrationReceiptDigest = null,
} = {}) {
  return {
    claimId,
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema,
    state,
    writeAuthority: state === "current",
    scopeReserved: state !== "waiting-successor",
    actorId: ACTOR_ID,
    repositoryId: REPOSITORY_ID,
    workItemId: WORK_ITEM_ID,
    canonicalBaseRevision: BASE_SHA,
    laneRevision,
    declaredWriteScope: DECLARED_WRITE_SET,
    writeSetDigest: WRITE_SET_DIGEST,
    leaseEpoch: 1,
    transitionCounter,
    heartbeatCounter: 0,
    reviewRequestId,
    predecessorClaimId: null,
    expiresAt: EXPIRES_AT,
    fenceRevision,
    transitionDigest,
    operationReceiptDigest: "d".repeat(64),
    integrationReceiptDigest,
    integration,
  };
}

function localAuthority({
  claimId = CLAIM_ID,
  claimIdentitySchema = "agentic-cloud-collaboration-entry/v2",
  state = "active",
  laneRevision = BASE_SHA,
  transitionCounter = 1,
  claimDigest = "e".repeat(64),
  claimLedgerRevision = "f".repeat(64),
  ledgerRevision = LEDGER_SHA,
  ledgerDigest = "2".repeat(64),
  reviewRequestId = null,
  focusedEvidence = null,
} = {}) {
  return Object.freeze({
    schema: "agentic-lane-cloud-authority/v1",
    provider: "github",
    ledgerRepository: "owner/ledger",
    targetRepository: "owner/target",
    claimId,
    claimDigest,
    ledgerRevision,
    ledgerDigest,
    claimLedgerRevision,
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema,
    operationReceiptDigest: "d".repeat(64),
    canonicalBaseSha: BASE_SHA,
    laneRevision,
    cloudDeclaredWriteScope: DECLARED_WRITE_SET,
    writeSetDigest: WRITE_SET_DIGEST,
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    reviewRequestId,
    leaseEpoch: 1,
    transitionCounter,
    state,
    expiresAt: EXPIRES_AT,
    ...(focusedEvidence ? { focusedEvidenceDigest: focusedEvidence } : {}),
    manifestDigest: MANIFEST.manifestDigest,
  });
}

function mutationResult(action, claim, ledgerRevision = NEXT_LEDGER_SHA) {
  return {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action,
    status: claim.state,
    ledgerRevision,
    claim,
    claimDigest: claim.fenceRevision,
    receipt: {
      receiptDigest: "1".repeat(64),
      ledgerDigest: "2".repeat(64),
    },
  };
}

function statusResult(claim, ledgerRevision = NEXT_LEDGER_SHA) {
  return {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "status",
    status: "ready",
    ledgerRevision,
    ledgerDigest: "2".repeat(64),
    claims: [claim],
  };
}

function verificationResult(claim, ledgerRevision = NEXT_LEDGER_SHA) {
  return {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "verify",
    status: "ready",
    ledgerRevision,
    claimDigest: claim.fenceRevision,
    claim,
    findings: [],
    receipt: {
      receiptDigest: "3".repeat(64),
      ledgerDigest: "2".repeat(64),
      evaluationTime: EVALUATED_AT,
    },
  };
}

function projectionHarness(initialClaim) {
  let current = initialClaim;
  const calls = [];
  return {
    calls,
    inspect: () => statusResult(current),
    verify: () => verificationResult(current),
    invoke: ({ action, request }) => {
      calls.push({ action, request });
      const state = action === "integrate"
        ? "integrated-preserved"
        : request.mode === "review"
          ? "reviewed"
          : "current";
      current = rootClaim({
        state,
        laneRevision: request.headSha || current.laneRevision,
        transitionCounter: current.transitionCounter + 1,
        fenceRevision: digestValue({ action, request }),
        transitionDigest: digestValue({ transition: calls.length }),
        reviewRequestId: request.reviewRequestId || current.reviewRequestId,
        integration: action === "integrate" ? {
          candidateRevision: request.headSha,
          reviewRequestId: REVIEW_REQUEST_ID,
          focusedEvidenceDigest: request.focusedEvidenceDigest,
          dependencyClosureDigest: request.dependencyClosureDigest,
          namedChecksDigest: request.namedChecksDigest,
          handoffEvidenceDigest: request.handoffEvidenceDigest,
          operatorDecisionDigest: request.operatorDecisionDigest,
          integrationIntentDigest: request.integrationIntentDigest,
          integratedAt: EVALUATED_AT,
        } : current.integration,
        integrationReceiptDigest: action === "integrate" ? "e".repeat(64) : current.integrationReceiptDigest,
      });
      return mutationResult(action, current);
    },
  };
}

function waitingSuccessorHarness({
  predecessorState = "dormant-preserved",
} = {}) {
  let predecessor = rootClaim({
    claimId: "6".repeat(64),
    state: predecessorState,
    laneRevision: "5".repeat(40),
    transitionCounter: 4,
    fenceRevision: "7".repeat(64),
    transitionDigest: "8".repeat(64),
    reviewRequestId: REVIEW_REQUEST_ID,
  });
  let waiting = {
    ...rootClaim({
      claimId: "9".repeat(64),
      laneRevision: BASE_SHA,
      transitionCounter: 1,
      fenceRevision: "a".repeat(64),
      transitionDigest: "b".repeat(64),
    }),
    state: "waiting-successor",
    writeAuthority: false,
    scopeReserved: false,
    predecessorClaimId: predecessor.claimId,
  };
  let staleWaiting = {
    ...rootClaim({
      claimId: "c".repeat(64),
      laneRevision: BASE_SHA,
      transitionCounter: 1,
      fenceRevision: "d".repeat(64),
      transitionDigest: "e".repeat(64),
    }),
    state: "waiting-successor",
    writeAuthority: false,
    scopeReserved: false,
    predecessorClaimId: predecessor.claimId,
    declaredWriteScope: normalizeWriteSet([
      "path:scripts/older-legacy-refresh.mjs",
      "semantic:git-guidelines-companion",
    ]),
    writeSetDigest: digestValue(normalizeWriteSet([
      "path:scripts/older-legacy-refresh.mjs",
      "semantic:git-guidelines-companion",
    ])),
  };
  let current = waiting;
  const calls = [];
  return {
    calls,
    inspect: () => (
      current.state === "waiting-successor"
        ? {
          ...statusResult(predecessor, NEXT_LEDGER_SHA),
          claims: [predecessor, staleWaiting, waiting],
        }
        : statusResult(current, NEXT_LEDGER_SHA)
    ),
    verify: () => verificationResult(current, NEXT_LEDGER_SHA),
    invoke: ({ action, request }) => {
      calls.push({ action, request });
      if (action === "claim") {
        current = waiting;
        return mutationResult("claim", waiting, NEXT_LEDGER_SHA);
      }
      if (action === "retire" && request.claimId === staleWaiting.claimId) {
        staleWaiting = {
          ...staleWaiting,
          state: "retired",
          transitionCounter: staleWaiting.transitionCounter + 1,
          fenceRevision: digestValue({ action, request }),
          transitionDigest: digestValue({ retireQueued: calls.length }),
        };
        return mutationResult("retire", staleWaiting, NEXT_LEDGER_SHA);
      }
      if (action === "retire") {
        predecessor = {
          ...predecessor,
          state: "retired",
          transitionCounter: predecessor.transitionCounter + 1,
          fenceRevision: digestValue({ action, request }),
          transitionDigest: digestValue({ retire: calls.length }),
        };
        return mutationResult("retire", predecessor, NEXT_LEDGER_SHA);
      }
      if (action === "continue" && request.mode === "promote") {
        current = rootClaim({
          claimId: waiting.claimId,
          laneRevision: BASE_SHA,
          transitionCounter: waiting.transitionCounter + 1,
          fenceRevision: digestValue({ action, request }),
          transitionDigest: digestValue({ promote: calls.length }),
        });
        return mutationResult("continue", current, NEXT_LEDGER_SHA);
      }
      if (action === "continue" && request.mode === "projection") {
        current = rootClaim({
          claimId: current.claimId,
          laneRevision: request.headSha,
          transitionCounter: current.transitionCounter + 1,
          fenceRevision: digestValue({ action, request }),
          transitionDigest: digestValue({ projection: calls.length }),
          reviewRequestId: request.reviewRequestId || current.reviewRequestId,
        });
        return mutationResult("continue", current, NEXT_LEDGER_SHA);
      }
      throw new Error(`Unexpected action ${action}:${request.mode || "none"}`);
    },
  };
}

test("claim projection accepts v2 logical identity without device/session in claimId", () => {
  const claim = rootClaim({ laneRevision: BASE_SHA, transitionCounter: 1 });
  const authority = cloudAuthorityFromResult({
    ledgerRepository: "owner/ledger",
    targetRepository: "owner/target",
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    result: mutationResult("claim", claim, LEDGER_SHA),
  }, {
    manifest: MANIFEST,
    canonicalBaseSha: BASE_SHA,
    now: new Date(EVALUATED_AT),
  });
  assert.equal(authority.state, "active");
  assert.equal(authority.claimId, CLAIM_ID);
});

test("review reconciliation preserves exact v1 claim identity after a v2 continuation", () => {
  const claim = rootClaim({
    claimId: LEGACY_CLAIM_ID,
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v1",
    transitionCounter: 17,
  });
  const authority = localAuthority({
    claimId: LEGACY_CLAIM_ID,
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v1",
    transitionCounter: 13,
  });
  const reconciled = reconcileCloudAuthorityProjection({
    authority,
    manifest: MANIFEST,
    statusResult: statusResult(claim),
    branch: BRANCH,
    headSha: HEAD_SHA,
    pullRequestNumber: PULL_REQUEST_NUMBER,
    allowPriorLaneRevision: true,
    now: new Date(EVALUATED_AT),
  });
  assert.equal(reconciled.authority.claimId, LEGACY_CLAIM_ID);
  assert.equal(reconciled.authority.transitionCounter, 17);
  assert.throws(() => reconcileCloudAuthorityProjection({
    authority,
    manifest: MANIFEST,
    statusResult: statusResult({
      ...claim,
      claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    }),
    branch: BRANCH,
    headSha: HEAD_SHA,
    pullRequestNumber: PULL_REQUEST_NUMBER,
    allowPriorLaneRevision: true,
    now: new Date(EVALUATED_AT),
  }), /recoverable admission subject/u);
});

test("current-claim inventory preserves an expired non-writing waiting successor", () => {
  const incumbent = rootClaim();
  const waiting = {
    ...rootClaim({ fenceRevision: "8".repeat(64), transitionDigest: "9".repeat(64) }),
    claimId: "7".repeat(64),
    state: "waiting-successor",
    writeAuthority: false,
    scopeReserved: false,
    workItemId: "work-item:waiting-successor",
    expiresAt: "2026-08-04T07:00:00.000Z",
  };
  const inventory = normalizeCurrentClaimInventory({
    inventoryResult: { ...statusResult(incumbent), claims: [incumbent, waiting] },
    verificationResult: verificationResult(incumbent),
    authority: localAuthority({ claimDigest: incumbent.fenceRevision, claimLedgerRevision: incumbent.transitionDigest, laneRevision: HEAD_SHA, transitionCounter: 2 }),
  });
  assert.deepEqual(inventory.claims.map((claim) => claim.state).sort(), ["active", "waiting-successor"]);
});

test("bind and heartbeat helpers are explicit continue projections", () => {
  const bindHarness = projectionHarness(rootClaim({ laneRevision: BASE_SHA, transitionCounter: 1 }));
  const bound = bindAdmissionCloudAuthority({
    authority: localAuthority(),
    manifest: MANIFEST,
    branch: BRANCH,
    headSha: HEAD_SHA,
    pullRequestNumber: PULL_REQUEST_NUMBER,
    reviewRequestId: REVIEW_REQUEST_ID,
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    invoke: bindHarness.invoke,
    inspect: bindHarness.inspect,
    verify: bindHarness.verify,
  });
  assert.equal(bindHarness.calls[0].action, "continue");
  assert.equal(bindHarness.calls[0].request.mode, "projection");
  assert.equal(bound.state, "active");

  const heartbeatHarness = projectionHarness(rootClaim({ transitionCounter: bound.transitionCounter }));
  const renewed = heartbeatAdmissionCloudAuthority({
    authority: bound,
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    ttlSeconds: 3_600,
    invoke: heartbeatHarness.invoke,
    inspect: heartbeatHarness.inspect,
    verify: heartbeatHarness.verify,
  });
  assert.equal(heartbeatHarness.calls[0].action, "continue");
  assert.equal(heartbeatHarness.calls[0].request.mode, "renewal");
  assert.equal(renewed.authority.state, "active");
});

test("legacy review bootstrap claims at base and binds the exact reviewed head", () => {
  const harness = projectionHarness(rootClaim({
    laneRevision: BASE_SHA,
    transitionCounter: 1,
  }));
  const bootstrapped = claimLegacyReviewAdmissionCloudAuthority({
    ledgerRepository: "owner/ledger",
    targetRepository: "owner/target",
    manifest: MANIFEST,
    canonicalBaseSha: BASE_SHA,
    branch: BRANCH,
    headSha: HEAD_SHA,
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    invoke: harness.invoke,
    inspect: harness.inspect,
    verify: harness.verify,
  });
  assert.equal(harness.calls[0].action, "claim");
  assert.equal(harness.calls[0].request.headSha, BASE_SHA);
  assert.equal(harness.calls[1].action, "continue");
  assert.equal(harness.calls[1].request.mode, "projection");
  assert.equal(bootstrapped.authority.state, "active");
  assert.equal(bootstrapped.authority.laneRevision, HEAD_SHA);
});

test("legacy review bootstrap supersedes a preserved predecessor before promoting its waiting successor", () => {
  const harness = waitingSuccessorHarness();
  const bootstrapped = claimLegacyReviewAdmissionCloudAuthority({
    ledgerRepository: "owner/ledger",
    targetRepository: "owner/target",
    manifest: MANIFEST,
    canonicalBaseSha: BASE_SHA,
    branch: BRANCH,
    headSha: HEAD_SHA,
    pullRequestNumber: PULL_REQUEST_NUMBER,
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    invoke: harness.invoke,
    inspect: harness.inspect,
    verify: harness.verify,
  });
  assert.deepEqual(
    harness.calls.map(call => [call.action, call.request.mode || null]),
    [
      ["claim", null],
      ["retire", null],
      ["retire", null],
      ["continue", "promote"],
      ["continue", "projection"],
    ],
  );
  assert.equal(harness.calls[1].request.reason, "superseded");
  assert.equal(harness.calls[2].request.reason, "superseded");
  assert.equal(bootstrapped.authority.state, "active");
  assert.equal(bootstrapped.authority.laneRevision, HEAD_SHA);
});

test("legacy review bootstrap supersedes a current predecessor before promoting its waiting successor", () => {
  const harness = waitingSuccessorHarness({
    predecessorState: "current",
  });
  const bootstrapped = claimLegacyReviewAdmissionCloudAuthority({
    ledgerRepository: "owner/ledger",
    targetRepository: "owner/target",
    manifest: MANIFEST,
    canonicalBaseSha: BASE_SHA,
    branch: BRANCH,
    headSha: HEAD_SHA,
    pullRequestNumber: PULL_REQUEST_NUMBER,
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    invoke: harness.invoke,
    inspect: harness.inspect,
    verify: harness.verify,
  });
  assert.deepEqual(
    harness.calls.map(call => [call.action, call.request.mode || null]),
    [
      ["claim", null],
      ["retire", null],
      ["retire", null],
      ["continue", "promote"],
      ["continue", "projection"],
    ],
  );
  assert.equal(harness.calls[1].request.reason, "superseded");
  assert.equal(bootstrapped.authority.state, "active");
  assert.equal(bootstrapped.authority.laneRevision, HEAD_SHA);
});

test("review helper records continue(review) without changing candidate identity", () => {
  const initial = rootClaim({ laneRevision: HEAD_SHA, transitionCounter: 2 });
  const harness = projectionHarness(initial);
  const ready = reviewReadyAdmissionCloudAuthority({
    authority: localAuthority({
      laneRevision: HEAD_SHA,
      transitionCounter: 2,
      claimDigest: initial.fenceRevision,
      claimLedgerRevision: initial.transitionDigest,
      ledgerRevision: NEXT_LEDGER_SHA,
    }),
    manifest: MANIFEST,
    branch: BRANCH,
    headSha: HEAD_SHA,
    pullRequestNumber: PULL_REQUEST_NUMBER,
    reviewRequestId: REVIEW_REQUEST_ID,
    focusedEvidenceDigest: focusedEvidenceDigest(),
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    invoke: harness.invoke,
    inspect: harness.inspect,
    verify: harness.verify,
  });
  assert.equal(harness.calls.at(-1).action, "continue");
  assert.equal(harness.calls.at(-1).request.mode, "review");
  assert.equal(ready.authority.state, "review_ready");
  assert.equal(ready.authority.laneRevision, HEAD_SHA);
  assert.equal(ready.authority.reviewRequestId, REVIEW_REQUEST_ID);
});

test("integration projection requires explicit operator and joined evidence", () => {
  const evidence = focusedEvidenceDigest();
  const reviewedClaim = rootClaim({
    state: "reviewed",
    laneRevision: HEAD_SHA,
    transitionCounter: 3,
    reviewRequestId: REVIEW_REQUEST_ID,
  });
  const authority = localAuthority({
    state: "review_ready",
    laneRevision: HEAD_SHA,
    transitionCounter: 3,
    reviewRequestId: REVIEW_REQUEST_ID,
    focusedEvidence: evidence,
    claimDigest: reviewedClaim.fenceRevision,
    claimLedgerRevision: reviewedClaim.transitionDigest,
    ledgerRevision: NEXT_LEDGER_SHA,
  });
  const explicitEvidence = {
    dependencyClosureDigest: "4".repeat(64), namedChecksDigest: "5".repeat(64),
    handoffEvidenceDigest: "6".repeat(64), operatorDecisionDigest: "7".repeat(64),
    integrationIntentDigest: "8".repeat(64),
  };
  const missing = projectionHarness(reviewedClaim);
  for (const field of Object.keys(explicitEvidence)) {
    const incomplete = { ...explicitEvidence };
    delete incomplete[field];
    assert.throws(() => authorizeDeliveryAdmissionCloudAuthority({ authority, manifest: MANIFEST, branch: BRANCH, headSha: HEAD_SHA, pullRequestNumber: PULL_REQUEST_NUMBER,
      deviceId: DEVICE_ID, sessionId: SESSION_ID, invoke: missing.invoke, inspect: missing.inspect, verify: missing.verify, ...incomplete }), new RegExp(field, "u"));
  }
  assert.equal(missing.calls.length, 0);

  const harness = projectionHarness(reviewedClaim);
  const integrated = authorizeDeliveryAdmissionCloudAuthority({
    authority,
    manifest: MANIFEST,
    branch: BRANCH,
    headSha: HEAD_SHA,
    pullRequestNumber: PULL_REQUEST_NUMBER,
    ...explicitEvidence,
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    invoke: harness.invoke,
    inspect: harness.inspect,
    verify: harness.verify,
  });
  assert.equal(harness.calls[0].action, "integrate");
  assert.equal(harness.calls[0].request.operatorDecisionDigest, "7".repeat(64));
  assert.equal(integrated.authority.state, "delivery_authorized");
  const replay = authorizeDeliveryAdmissionCloudAuthority({ authority: integrated.authority, manifest: MANIFEST, branch: BRANCH, headSha: HEAD_SHA,
    pullRequestNumber: PULL_REQUEST_NUMBER, deviceId: DEVICE_ID, sessionId: SESSION_ID, invoke: harness.invoke, inspect: harness.inspect, verify: harness.verify, ...explicitEvidence });
  assert.equal(replay.authority.integrationReceiptDigest, "e".repeat(64));
  assert.equal(harness.calls.length, 1);
  assert.throws(() => authorizeDeliveryAdmissionCloudAuthority({ authority: integrated.authority, manifest: MANIFEST, branch: BRANCH, headSha: HEAD_SHA,
    pullRequestNumber: PULL_REQUEST_NUMBER, deviceId: DEVICE_ID, sessionId: SESSION_ID, invoke: harness.invoke, inspect: harness.inspect, verify: harness.verify,
    ...explicitEvidence, operatorDecisionDigest: "9".repeat(64) }), /exact integration evidence/u);
});

test("heartbeat machine envelope carries only joined authority evidence", () => {
  const response = { ok: true };
  const lease = { admission: { status: "admitted" }, cloudAuthority: localAuthority() };
  const result = { mutationAuthorityReceipt: { status: "ready" } };
  assert.deepEqual(attachCloudHeartbeatMachineEvidence(response, { lease, result }), {
    ok: true,
    admission: lease.admission,
    cloudAuthority: lease.cloudAuthority,
    mutationAuthorityReceipt: result.mutationAuthorityReceipt,
  });
});
