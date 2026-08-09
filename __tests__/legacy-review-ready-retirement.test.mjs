import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  isRetiredPreservedLane,
  parseLocalReviewRetirementMarker,
  renderLocalReviewRetirementMarker,
} from "../scripts/legacy-review-ready-retirement-lib.mjs";
import {
  buildConditionalPullRequestCloseRequest,
  closeProviderUnderLeaseFence,
  parseGitHubIncludedResponse,
  retireLegacyReviewReadyLane,
} from "../scripts/legacy-review-ready-retirement.mjs";
import {
  projectWriterLeasePullRequestMarker,
  updateWriterLeasePullRequestBody,
  WRITER_LEASE_SCHEMA,
} from "../scripts/writer-lease-lib.mjs";

const HEAD = "a".repeat(40);
const TREE = "b".repeat(40);
const BASE = "c".repeat(40);
const FENCE = "d".repeat(40);
const DIGEST = "e".repeat(64);
const RETIRED_AT = "2026-08-08T12:00:00.000Z";
const WORKTREE = "/workspace/legacy-review";
const BRANCH = "agent/old-device/legacy-review";
const REPOSITORY = "owner/repository";
const SOURCE_SESSION = "legacy-source-session";
const OPERATOR_SESSION = "repository-operator-session";

test("retires an expired local-only review lane provider-first without changing Git bytes", () => {
  const fixture = createFixture();
  const before = projectGitBytes(fixture.state);
  const output = retireLegacyReviewReadyLane(fixture.request, fixture.adapter);

  assert.equal(output.status, "retired-preserved");
  assert.equal(output.cleanupEligible, false);
  assert.equal(output.replayed, false);
  assert.deepEqual(fixture.operations, [
    "preserve", "write:prepared", "close", "preserve", "release", "write:completed",
  ]);
  assert.equal(fixture.state.pullRequest.state, "CLOSED");
  assert.equal(fixture.state.lease.status, "released");
  assert.deepEqual(projectGitBytes(fixture.state), before);
  assert.equal(
    isRetiredPreservedLane({ lane: fixture.state.lane, lease: fixture.state.lease }),
    true,
  );
  const marker = parseLocalReviewRetirementMarker(fixture.state.pullRequest.body);
  assert.equal(marker.intentDigest, fixture.state.lease.localReviewRetirement.intentDigest);
  assert.equal(fixture.receipt.status, "completed");
});

test("retains every source lease field while changing only terminal fields and evidence", () => {
  const fixture = createFixture();
  fixture.state.lease.repositoryOwnedLegacyEvidence = {
    claim: "preserve-exactly", counter: 3,
  };
  fixture.state.lane.lease = fixture.state.lease;
  fixture.state.pullRequest.body = renderWriterMarker(fixture.state.lease);
  const source = structuredClone(fixture.state.lease);
  retireLegacyReviewReadyLane(fixture.request, fixture.adapter);

  for (const [key, value] of Object.entries(source)) {
    if (["status", "heartbeatAt", "expiresAt"].includes(key)) continue;
    assert.deepEqual(fixture.state.lease[key], value, `preserved lease field ${key}`);
  }
  assert.deepEqual(fixture.state.lease.repositoryOwnedLegacyEvidence, {
    claim: "preserve-exactly", counter: 3,
  });
  assert.equal(fixture.state.lease.localReviewRetirement.status, "completed");
});

test("fails closed for live, dirty, admitted, cloud-backed, or identity-drifted lanes", () => {
  const cases = [
    [state => { state.lease.expiresAt = "2099-01-01T00:00:00.000Z"; }, /still live/],
    [state => { state.lane.dirty = true; }, /exact clean local-only/],
    [state => { state.lease.admission = { status: "admitted" }; }, /exact clean local-only/],
    [state => { state.lease.cloudAuthority = { state: "review_ready" }; }, /exact clean local-only/],
    [state => { state.lease.localReviewRetirement = {}; }, /exact clean local-only/],
    [state => { state.lease.expiresAt = "not-an-instant"; }, /ISO-8601 instant/],
    [state => { state.remoteHeadSha = "f".repeat(40); }, /pull request|preserved lane identity/],
    [state => { state.pullRequest.headRepository = "foreign/fork"; }, /preserved lane identity/],
  ];
  for (const [mutate, pattern] of cases) {
    const fixture = createFixture();
    mutate(fixture.state);
    fixture.state.lane.lease = fixture.state.lease;
    assert.throws(
      () => retireLegacyReviewReadyLane(fixture.request, fixture.adapter),
      pattern,
    );
    assert.equal(fixture.state.pullRequest.state, "OPEN");
    assert.notEqual(fixture.state.lease.status, "released");
  }
});

test("blocks when operation-derived preservation reports current cloud authority", () => {
  const fixture = createFixture();
  fixture.adapter.verifyPreservation = () => {
    fixture.operations.push("preserve");
    throw new Error("Dormant preservation matched current cloud authority: claim-id");
  };
  assert.throws(
    () => retireLegacyReviewReadyLane(fixture.request, fixture.adapter),
    /matched current cloud authority/,
  );
  assert.deepEqual(fixture.operations, ["preserve"]);
});

test("keeps legacy source ownership distinct from repository operator proof", () => {
  const fixture = createFixture();
  assert.notEqual(fixture.request.sourceSessionId, fixture.request.operatorSessionId);
  fixture.request.operatorSessionId = "different-operator";
  assert.throws(
    () => retireLegacyReviewReadyLane(fixture.request, fixture.adapter),
    /Dormant preservation proof does not bind/,
  );
  assert.equal(fixture.state.pullRequest.state, "OPEN");

  const wrongSource = createFixture();
  wrongSource.request.sourceSessionId = wrongSource.request.operatorSessionId;
  assert.throws(
    () => retireLegacyReviewReadyLane(wrongSource.request, wrongSource.adapter),
    /exact clean local-only review_ready owner/,
  );
  assert.equal(wrongSource.state.pullRequest.state, "OPEN");
});

test("reverifies cloud authority after provider closure and before local release", () => {
  const fixture = createFixture();
  let checks = 0;
  fixture.adapter.verifyPreservation = source => {
    fixture.operations.push("preserve");
    checks += 1;
    if (checks === 2) throw new Error("fresh inventory found a current claim");
    return preservation(source);
  };
  assert.throws(
    () => retireLegacyReviewReadyLane(fixture.request, fixture.adapter),
    /fresh inventory found a current claim/,
  );
  assert.equal(fixture.state.pullRequest.state, "CLOSED");
  assert.equal(fixture.state.lease.status, "review_ready");
  assert.deepEqual(fixture.operations, [
    "preserve", "write:prepared", "close", "preserve",
  ]);
});

test("fences the exact source lease before mutating the provider", () => {
  const fixture = createFixture({
    beforeClose: state => {
      state.lease = { ...state.lease, heartbeatAt: "2026-08-08T11:59:59.000Z" };
      state.lane.lease = state.lease;
    },
  });
  assert.throws(
    () => retireLegacyReviewReadyLane(fixture.request, fixture.adapter),
    /Writer lease changed before provider closure/,
  );
  assert.equal(fixture.state.pullRequest.state, "OPEN");
  assert.equal(fixture.operations.includes("close"), false);
});

test("does not overwrite a provider revision that changed before conditional close", () => {
  const fixture = createFixture({
    beforeClose: state => {
      state.pullRequest.body = `${state.pullRequest.body}\nexternal provider edit`;
      state.pullRequest.providerVersion = '"etag-raced"';
    },
  });
  assert.throws(
    () => retireLegacyReviewReadyLane(fixture.request, fixture.adapter),
    /provider version changed before provider closure/,
  );
  assert.equal(fixture.state.pullRequest.state, "OPEN");
  assert.equal(fixture.state.pullRequest.providerVersion, '"etag-raced"');
  assert.match(fixture.state.pullRequest.body, /external provider edit/);
  assert.equal(fixture.operations.includes("close"), false);
});

test("requires one exact source writer marker", () => {
  for (const mutate of [
    state => { state.pullRequest.body += `\n${renderWriterMarker(state.lease)}`; },
    state => {
      state.pullRequest.body += `\n<!-- ${WRITER_LEASE_SCHEMA} {\n"schema":"conflict"\n} -->`;
    },
    state => {
      state.pullRequest.body = renderWriterMarker({ ...state.lease, epoch: 8 });
    },
  ]) {
    const fixture = createFixture();
    mutate(fixture.state);
    assert.throws(
      () => retireLegacyReviewReadyLane(fixture.request, fixture.adapter),
      /one exact writer lease marker/,
    );
    assert.equal(fixture.state.pullRequest.state, "OPEN");
  }
});

test("production close primitives track exact ETags on reads and avoid unsupported close headers", () => {
  const response = [
    "HTTP/2.0 200 OK", 'etag: "etag-exact"', "",
    JSON.stringify({ state: "open" }),
  ].join("\r\n");
  assert.deepEqual(parseGitHubIncludedResponse(response), {
    payload: { state: "open" }, providerVersion: '"etag-exact"',
  });
  const request = buildConditionalPullRequestCloseRequest({
    repository: REPOSITORY,
    expected: { number: 737, providerVersion: '"etag-exact"' },
    body: "bounded body",
  });
  assert.deepEqual(request.args, [
    "api", "--method", "PATCH", `repos/${REPOSITORY}/pulls/737`,
    "--input", "-",
  ]);
  assert.deepEqual(JSON.parse(request.input), { body: "bounded body", state: "closed" });

  const expectedLease = { branch: BRANCH, status: "review_ready", epoch: 7 };
  let closes = 0;
  const leaseStore = lease => ({
    withRegistryLock: action => action({ leases: { [BRANCH]: lease } }),
  });
  assert.equal(closeProviderUnderLeaseFence({
    leaseStore: leaseStore(structuredClone(expectedLease)), expectedLease,
    close: () => { closes += 1; return "closed"; },
  }), "closed");
  assert.throws(() => closeProviderUnderLeaseFence({
    leaseStore: leaseStore({ ...expectedLease, epoch: 8 }), expectedLease,
    close: () => { closes += 1; },
  }), /Writer lease changed before provider closure/);
  assert.equal(closes, 1);
});

test("post-close and released replay reject duplicate retirement markers", () => {
  const closing = createFixture({
    afterCloseBody: body => `${body}\n${retirementMarkerFrom(body)}`,
  });
  assert.throws(
    () => retireLegacyReviewReadyLane(closing.request, closing.adapter),
    /multiple local review retirement markers/,
  );
  assert.equal(closing.state.pullRequest.state, "CLOSED");
  assert.equal(closing.state.lease.status, "review_ready");

  const released = createFixture();
  retireLegacyReviewReadyLane(released.request, released.adapter);
  released.state.pullRequest.body +=
    `\n${retirementMarkerFrom(released.state.pullRequest.body)}`;
  assert.throws(
    () => retireLegacyReviewReadyLane(released.request, released.adapter),
    /multiple local review retirement markers/,
  );
});

test("rejects duplicate writer markers introduced by provider projection", () => {
  const fixture = createFixture();
  fixture.adapter.updateWriterBody = (body, lease) => [
    updateWriterLeasePullRequestBody(body, lease), renderWriterMarker(lease),
  ].join("\n");
  assert.throws(
    () => retireLegacyReviewReadyLane(fixture.request, fixture.adapter),
    /one exact writer lease marker/,
  );
  assert.equal(fixture.state.pullRequest.state, "OPEN");
});

test("resumes after provider closure and replays a fully released receipt idempotently", () => {
  const fixture = createFixture({ releaseFailures: 1 });
  assert.throws(
    () => retireLegacyReviewReadyLane(fixture.request, fixture.adapter),
    /simulated release failure/,
  );
  assert.equal(fixture.state.pullRequest.state, "CLOSED");
  assert.equal(fixture.state.lease.status, "review_ready");
  assert.equal(fixture.receipt.status, "prepared");

  const completed = retireLegacyReviewReadyLane(fixture.request, fixture.adapter);
  assert.equal(completed.status, "retired-preserved");
  const digest = completed.receiptDigest;
  fixture.receipt = null;
  const replay = retireLegacyReviewReadyLane(fixture.request, fixture.adapter);
  assert.equal(replay.replayed, true);
  assert.equal(replay.receiptDigest, digest);
  assert.equal(fixture.receipt.receiptDigest, digest);
  assert.equal(fixture.operations.filter(item => item === "close").length, 1);
  assert.equal(fixture.operations.filter(item => item === "release").length, 1);
});

test("rejects an already closed pull request without the exact terminal marker", () => {
  const fixture = createFixture();
  fixture.state.pullRequest.state = "CLOSED";
  fixture.state.pullRequest.closedAt = RETIRED_AT;
  assert.throws(
    () => retireLegacyReviewReadyLane(fixture.request, fixture.adapter),
    /exact writer lease marker|exact closed, preserved checkpoint/,
  );
  assert.equal(fixture.state.lease.status, "review_ready");
});

test("serialized receipts cannot change provider subject behind a recomputed outer digest", () => {
  const fixture = createFixture();
  retireLegacyReviewReadyLane(fixture.request, fixture.adapter);
  const receipt = structuredClone(fixture.state.lease.localReviewRetirement);
  fixture.state.lease.localReviewRetirement = receipt;
  receipt.provider.headSha = "f".repeat(40);
  const { receiptDigest: _prior, ...core } = receipt;
  receipt.receiptDigest = digestValue(core);
  assert.equal(
    isRetiredPreservedLane({ lane: fixture.state.lane, lease: fixture.state.lease }),
    false,
  );
});

test("serialized receipts reject every provider and cloud cross-object drift", () => {
  const mutations = [
    receipt => { receipt.cloud.ledgerRepository = "other/ledger"; },
    receipt => { receipt.provider.markerDigest = "f".repeat(64); },
    receipt => { receipt.provider.marker.releasedWriterMarkerDigest = "f".repeat(64); },
  ];
  for (const mutate of mutations) {
    const fixture = createFixture();
    retireLegacyReviewReadyLane(fixture.request, fixture.adapter);
    const receipt = structuredClone(fixture.state.lease.localReviewRetirement);
    fixture.state.lease.localReviewRetirement = receipt;
    mutate(receipt);
    const { receiptDigest: _prior, ...core } = receipt;
    receipt.receiptDigest = digestValue(core);
    assert.equal(isRetiredPreservedLane({
      lane: fixture.state.lane, lease: fixture.state.lease,
    }), false);
  }
});

test("retired attribution verifies all original lease fields and source timing", () => {
  const fixture = createFixture();
  fixture.state.lease.parkStashRef = "refs/stash";
  fixture.state.lane.lease = fixture.state.lease;
  retireLegacyReviewReadyLane(fixture.request, fixture.adapter);

  fixture.state.lease.parkStashRef = "refs/changed";
  assert.equal(isRetiredPreservedLane({
    lane: fixture.state.lane, lease: fixture.state.lease,
  }), false);

  const second = createFixture();
  retireLegacyReviewReadyLane(second.request, second.adapter);
  const receipt = structuredClone(second.state.lease.localReviewRetirement);
  second.state.lease.localReviewRetirement = receipt;
  receipt.intent.source.lease.heartbeatAt = "2026-07-31T23:59:59.000Z";
  resealReceipt(receipt);
  assert.equal(isRetiredPreservedLane({
    lane: second.state.lane, lease: second.state.lease,
  }), false);
});

test("retired attribution joins the current released writer projection", () => {
  const fixture = createFixture();
  retireLegacyReviewReadyLane(fixture.request, fixture.adapter);
  const receipt = structuredClone(fixture.state.lease.localReviewRetirement);
  fixture.state.lease.localReviewRetirement = receipt;
  receipt.provider.marker.releasedWriterMarkerDigest = "f".repeat(64);
  receipt.provider.releasedWriterMarkerDigest = "f".repeat(64);
  resealReceipt(receipt);
  assert.equal(isRetiredPreservedLane({
    lane: fixture.state.lane, lease: fixture.state.lease,
  }), false);
});

function createFixture({
  releaseFailures = 0, beforeClose = null, afterCloseBody = body => body,
} = {}) {
  const lease = {
    schema: WRITER_LEASE_SCHEMA,
    status: "review_ready",
    epoch: 7,
    sessionId: SOURCE_SESSION,
    device: "old-device",
    scope: "legacy-review",
    branch: BRANCH,
    worktreePath: WORKTREE,
    baseSha: BASE,
    fenceSha: FENCE,
    pullRequestUrl: `https://github.com/${REPOSITORY}/pull/737`,
    reviewHeadSha: HEAD,
    heartbeatAt: "2026-08-01T00:00:00.000Z",
    expiresAt: "2026-08-01T00:00:00.000Z",
  };
  const state = {
    lane: {
      path: WORKTREE,
      head: HEAD,
      treeSha: TREE,
      branch: `refs/heads/${BRANCH}`,
      detached: false,
      invalid: false,
      leaseAmbiguous: false,
      dirty: false,
      indexDigest: "1".repeat(64),
      workingTreeDigest: "2".repeat(64),
      stateDigest: "3".repeat(64),
      lease,
    },
    lease,
    remoteHeadSha: HEAD,
    pullRequest: {
      url: `https://github.com/${REPOSITORY}/pull/737`,
      number: 737,
      nodeId: "PR_node_737",
      providerVersion: '"etag-open"',
      state: "OPEN",
      draft: false,
      merged: false,
      closedAt: null,
      body: renderWriterMarker(lease),
      headRepository: REPOSITORY,
      headBranch: BRANCH,
      headSha: HEAD,
      baseRepository: REPOSITORY,
      baseBranch: "main",
      baseSha: BASE,
    },
  };
  const request = {
    repository: WORKTREE,
    targetRepository: REPOSITORY,
    ledgerRepository: "owner/ledger",
    branch: BRANCH,
    sourceSessionId: lease.sessionId,
    operatorSessionId: OPERATOR_SESSION,
    expectedHead: HEAD,
    expectedPullRequest: 737,
    expectedPullRequestUrl: lease.pullRequestUrl,
    operatorDecisionDigest: DIGEST,
    evaluatedAt: RETIRED_AT,
  };
  const operations = [];
  let receipt = null;
  let remainingReleaseFailures = releaseFailures;
  const fixture = { state, request, operations, receipt };
  fixture.adapter = {
    capture: () => structuredClone(state),
    now: () => RETIRED_AT,
    readReceipt: () => structuredClone(fixture.receipt),
    writeReceipt: value => {
      fixture.receipt = structuredClone(value);
      operations.push(`write:${value.status}`);
    },
    projectWriterMarker: renderWriterMarker,
    updateWriterBody: updateWriterLeasePullRequestBody,
    verifyPreservation: source => {
      operations.push("preserve");
      return preservation(source);
    },
    closePullRequest: ({ expected, expectedLease, body }) => {
      beforeClose?.(state);
      if (digestValue(state.lease) !== digestValue(expectedLease)) {
        throw new Error("Writer lease changed before provider closure.");
      }
      for (const field of ["state", "providerVersion", "body"]) {
        if (state.pullRequest[field] !== expected[field]) {
          throw new Error(`Pull request ${field.replaceAll("providerVersion", "provider version")} changed before provider closure.`);
        }
      }
      state.pullRequest = {
        ...state.pullRequest,
        state: "CLOSED",
        closedAt: RETIRED_AT,
        providerVersion: '"etag-closed"',
        body: afterCloseBody(body),
      };
      operations.push("close");
      return structuredClone(state.pullRequest);
    },
    releaseLease: ({ expectedLease, status, timestamp, values }) => {
      if (remainingReleaseFailures > 0) {
        remainingReleaseFailures -= 1;
        throw new Error("simulated release failure");
      }
      assert.equal(digestValue(state.lease), digestValue(expectedLease));
      state.lease = {
        ...state.lease,
        ...values,
        status,
        heartbeatAt: timestamp,
        expiresAt: timestamp,
      };
      state.lane.lease = state.lease;
      operations.push("release");
      return structuredClone(state.lease);
    },
  };
  return fixture;
}

function preservation(source) {
  return {
    cloudVerification: {
      ledgerRevision: "4".repeat(40),
      ledgerDigest: "5".repeat(64),
      remoteClaimInventoryDigest: "6".repeat(64),
      receiptDigest: "7".repeat(64),
    },
    dormantReceipt: {
      status: "dormant-preserved",
      operatorDecisionDigest: DIGEST,
      sessionId: OPERATOR_SESSION,
      receiptDigest: "8".repeat(64),
      worktrees: [{
        path: source.lane.path,
        branch: source.lane.branch,
        headSha: source.lane.head,
        stateDigest: source.lane.stateDigest,
      }],
      pullRequests: [{
        url: source.pullRequest.url,
        headSha: source.pullRequest.headSha,
        nodeId: source.pullRequest.nodeId,
      }],
    },
  };
}

function resealReceipt(receipt) {
  const { intentDigest: _priorIntent, ...intentCore } = receipt.intent;
  receipt.intent.intentDigest = digestValue(intentCore);
  receipt.intentDigest = receipt.intent.intentDigest;
  receipt.provider.marker.intentDigest = receipt.intent.intentDigest;
  receipt.provider.markerDigest = digestValue(
    renderLocalReviewRetirementMarker(receipt.provider.marker),
  );
  const { receiptDigest: _priorReceipt, ...receiptCore } = receipt;
  receipt.receiptDigest = digestValue(receiptCore);
}

function renderWriterMarker(lease) {
  return `<!-- ${WRITER_LEASE_SCHEMA} ${JSON.stringify(projectWriterLeasePullRequestMarker(lease))} -->`;
}

function retirementMarkerFrom(body) {
  return String(body).match(
    /<!--\s*agentic-local-review-retirement-intent\/v1\s+\{[^\n]*\}\s*-->/u,
  )?.[0] || "";
}

function projectGitBytes(state) {
  return {
    path: state.lane.path,
    branch: state.lane.branch,
    head: state.lane.head,
    tree: state.lane.treeSha,
    index: state.lane.indexDigest,
    working: state.lane.workingTreeDigest,
    remoteHead: state.remoteHeadSha,
  };
}
