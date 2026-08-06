import test from "node:test";
import assert from "node:assert/strict";

import {
  completeSession,
  createParkMessage,
  formatParkTimestamp,
  heartbeat,
  park,
  publish,
  resume,
  review,
  sanitize,
  sanitizeDevice,
  sanitizeScope,
  start,
} from "../scripts/device-branch-lib.mjs";
import {
  parseWriterLeasePullRequestBody,
  renderWriterLeasePullRequestBody,
} from "../scripts/writer-lease-lib.mjs";

const repo = process.cwd();
const detachedWorktree = `worktree ${repo}\nHEAD ${"a".repeat(40)}\ndetached\n`;
const branchWorktree = branch => `worktree ${repo}\nHEAD ${"a".repeat(40)}\nbranch refs/heads/${branch}\n`;
const pullJson = (url, branch, body = "", isDraft = true, state = "OPEN") => JSON.stringify({
  url, state, isDraft, headRefName: branch,
  headRefOid: "c".repeat(40), baseRefName: "main", body,
});
const publishDeclaredWriteSet = [
  "path:scripts/device-branch-lib.mjs",
  "semantic:runtime-leases",
];
const publishWriteSetDigest = "8".repeat(64);
const publishAdmission = Object.freeze({
  schema: "agentic-lane-admission-lease/v1",
  status: "admitted",
  semanticScope: "runtime-leases",
  declaredWriteSet: publishDeclaredWriteSet,
  writeSetDigest: publishWriteSetDigest,
  manifestDigest: "9".repeat(64),
  planReceiptDigest: "a".repeat(64),
  admissionReceiptDigest: "b".repeat(64),
  existingLaneStateDigest: "c".repeat(64),
  admittedReportDigest: "d".repeat(64),
  preservationReceiptDigest: "e".repeat(64),
});

function publishAuthority(overrides = {}) {
  return {
    schema: "agentic-lane-cloud-authority/v1",
    provider: "github",
    ledgerRepository: "example/ledger",
    targetRepository: "example/repo",
    claimId: "f".repeat(64),
    claimDigest: "0".repeat(64),
    ledgerRevision: "1".repeat(40),
    claimLedgerRevision: "2".repeat(64),
    canonicalBaseSha: "a".repeat(40),
    cloudDeclaredWriteScope: publishDeclaredWriteSet,
    writeSetDigest: publishWriteSetDigest,
    deviceId: "device",
    sessionId: "chat-a",
    manifestDigest: publishAdmission.manifestDigest,
    leaseEpoch: 1,
    transitionCounter: 1,
    state: "active",
    ...overrides,
  };
}

function createGitText(responses) {
  return args => {
    const key = args.join(" ");
    if (!(key in responses)) throw new Error(`unexpected git command: ${key}`);
    const value = responses[key];
    if (Array.isArray(value)) return value.shift() ?? "";
    return value;
  };
}

function createCompletionLeaseStore(overrides = {}) {
  const branch = "agent/device/scope";
  let lease = null;
  if (overrides !== null) {
    lease = {
      schema: "agentic-writer-lease/v2",
      status: "delivery",
      epoch: 4,
      sessionId: "chat-a",
      device: "device",
      scope: "scope",
      branch,
      worktreePath: repo,
      baseSha: "a".repeat(40),
      fenceSha: "f".repeat(40),
      pullRequestUrl: "https://github.com/example/repo/pull/42",
      heartbeatAt: "2026-07-20T10:00:00.000Z",
      expiresAt: "2026-07-20T10:00:00.000Z",
      ...overrides,
    };
  }
  return {
    read: requested => requested ? lease : { leases: { [branch]: lease } },
    recoverFromPullRequestMarker: ({ branch: requestedBranch, worktreePath, pullRequestUrl, pullRequestBody }) => {
      const recovered = parseWriterLeasePullRequestBody(pullRequestBody);
      if (!recovered || recovered.branch !== requestedBranch) {
        throw new Error(`No recoverable writer lease marker records ${requestedBranch}.`);
      }
      return (lease = { ...recovered, worktreePath, pullRequestUrl });
    },
    beginCompletion: ({ pullRequestUrl, mergeCommitSha, mainSha }) => (lease = {
      ...lease, status: "completing", pullRequestUrl, completion: { mergeCommitSha, mainSha },
    }),
    complete: ({ pullRequestUrl, mergeCommitSha, mainSha }) => (lease = {
      ...lease, status: "completed", pullRequestUrl, completion: { mergeCommitSha, mainSha },
    }),
  };
}

test("formatParkTimestamp emits git-friendly UTC stamps", () => {
  assert.equal(formatParkTimestamp(new Date("2026-07-14T22:30:45.123Z")), "20260714T223045Z");
  assert.equal(
    createParkMessage("agent/device/scope", new Date("2026-07-14T22:30:45.123Z")),
    "park: agent/device/scope 20260714T223045Z",
  );
});

test("device and scope sanitizers preserve hostname identity without widening scope grammar", () => {
  assert.equal(sanitize("Legacy.Scope_Value"), "legacy.scope_value");
  assert.equal(sanitizeDevice("Katrinas-MacBook-Pro.local"), "katrinas-macbook-pro.local");
  assert.equal(sanitizeDevice("build_host"), "build_host");
  assert.equal(sanitizeScope("Local_Branch.Runtime Contract"), "local-branch-runtime-contract");
  assert.throws(() => sanitizeDevice(".local"), /Device must have ASCII alphanumeric boundaries/);
});

test("start rejects an invalid device before checkout mutation", () => {
  const calls = [];
  const gitText = createGitText({
    "worktree list --porcelain -z": detachedWorktree,
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "status --porcelain": "",
    "branch --show-current": "",
  });
  assert.throws(() => start({
    scope: "runtime-leases",
    invocationPath: repo,
    repo,
    gitText,
    gitOptional: () => ".local",
    ghText: () => "[]",
    leaseStore: {},
    sessionId: "chat-a",
    run: (command, args) => calls.push([command, ...args]),
  }), /Device must have ASCII alphanumeric boundaries/);
  assert.deepEqual(calls, []);
});

test("start claims a lease and publishes a draft ownership PR before authoring", () => {
  const calls = [];
  const annotations = [];
  const logs = [];
  const pullRequestUrl = "https://github.test/pull/1";
  const gitText = createGitText({
    "worktree list --porcelain -z": detachedWorktree,
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "status --porcelain": "",
    "branch --show-current": "",
    "rev-parse origin/main": "a".repeat(40),
    "rev-parse HEAD": ["a".repeat(40), "a".repeat(40), "b".repeat(40)],
  });
  const leaseStore = {
    claim: values => ({
      schema: "agentic-writer-lease/v2",
      status: "active",
      epoch: 1,
      ...values,
      fenceSha: null,
      pullRequestUrl: null,
      heartbeatAt: "2026-07-17T10:00:00.000Z",
      expiresAt: "2026-07-17T10:30:00.000Z",
    }),
    annotate: ({ values }) => {
      annotations.push(values);
      return {
        schema: "agentic-writer-lease/v2",
        status: "active",
        epoch: 1,
        sessionId: "chat-a",
        device: "device",
        scope: "runtime-leases",
        branch: "agent/device/runtime-leases",
        worktreePath: repo,
        baseSha: "a".repeat(40),
        fenceSha: values.fenceSha || "b".repeat(40),
        pullRequestUrl: values.pullRequestUrl || null,
        heartbeatAt: "2026-07-17T10:00:00.000Z",
        expiresAt: "2026-07-17T10:30:00.000Z",
      };
    },
  };
  const branch = start({
    scope: "runtime-leases",
    invocationPath: repo,
    repo,
    gitText,
    gitOptional: args => args[0] === "config" ? "device" : "",
    ghText: args => args[1] === "list" ? "[]" : args[1] === "create" ? `${pullRequestUrl}\n` :
      pullJson(pullRequestUrl, "agent/device/runtime-leases"),
    leaseStore,
    sessionId: "chat-a",
    leaseTtlMs: 1_800_000,
    run: (command, args) => calls.push([command, ...args]),
    log: message => logs.push(message),
  });

  assert.equal(branch, "agent/device/runtime-leases");
  assert.deepEqual(calls.map(call => call.slice(0, 3)), [
    ["git", "fetch", "origin"],
    ["git", "switch", "--create"],
    ["git", "commit", "--allow-empty"],
    ["git", "push", "--set-upstream"],
  ]);
  assert.deepEqual(annotations, [
    { fenceSha: "b".repeat(40) },
    { pullRequestUrl: "https://github.test/pull/1" },
  ]);
  assert.equal(logs.length, 1);
  assert.doesNotMatch(logs[0], /chat-a/);
});

test("heartbeat rejects a session after the remote fencing commit advances", () => {
  const branch = "agent/device/runtime-leases";
  let renewed = false;
  const gitText = createGitText({
    "worktree list --porcelain -z": branchWorktree(branch),
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "branch --show-current": `${branch}\n`,
  });
  assert.throws(() => heartbeat({
    invocationPath: repo,
    repo,
    gitText,
    gitOptional: () => `${"c".repeat(40)}\trefs/heads/${branch}`,
    leaseStore: {
      verify: () => ({ fenceSha: "b".repeat(40), worktreePath: repo }),
      heartbeat: () => { renewed = true; },
    },
    sessionId: "chat-a",
    leaseTtlMs: 1_800_000,
    run: () => {},
  }), /session is stale/);
  assert.equal(renewed, false);
});

test("publish verifies the session lease and fencing ancestor before delivery", () => {
  const calls = [];
  const evidence = {
    dependencyClosureDigest: "1".repeat(64),
    namedChecksDigest: "2".repeat(64),
    handoffEvidenceDigest: "3".repeat(64),
    operatorDecisionDigest: "4".repeat(64),
    integrationIntentDigest: "5".repeat(64),
  };
  const focusedEvidenceDigest = "6".repeat(64);
  const reviewRequestId = "github-pull-request:PR_1";
  const branch = "agent/device/runtime-leases";
  const pullRequestUrl = "https://github.test/pull/1";
  const gitText = createGitText({
    "worktree list --porcelain -z": branchWorktree(branch),
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "status --porcelain": "",
    "branch --show-current": `${branch}\n`,
    "log -1 --pretty=%s": "fix: coordination runtime\n",
    "rev-parse HEAD": "c".repeat(40),
    [`rev-parse ${"c".repeat(40)}^{tree}`]: "d".repeat(40),
  });
  let releaseStatus = null;
  let isDraft = true;
  let body = "";
  let cloudMutation = null;
  let lease = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 1,
    sessionId: "chat-a",
    device: "device",
    scope: "runtime-leases",
    branch,
    worktreePath: repo,
    baseSha: "a".repeat(40),
    fenceSha: "b".repeat(40),
    pullRequestUrl,
    autoDelivery: false,
    runtimeRequired: false,
    admission: publishAdmission,
    cloudAuthority: publishAuthority(),
    acquiredAt: "2026-07-17T10:00:00.000Z",
    heartbeatAt: "2026-07-17T10:00:00.000Z",
    expiresAt: "2099-07-17T10:30:00.000Z",
  };

  const result = publish({
    invocationPath: repo,
    repo,
    gitText,
    ghText: args => args[1] === "list"
      ? JSON.stringify([{ number: 1, headRefName: branch, url: pullRequestUrl }])
      : args.includes("--jq") ? body : pullJson(pullRequestUrl, branch, body, isDraft),
    ghOptional: () => pullRequestUrl,
    leaseStore: {
      verify: () => lease,
      annotate: ({ values }) => (lease = { ...lease, ...values }),
      release: ({ status }) => {
        releaseStatus = status;
        return (lease = { ...lease, status });
      },
    },
    sessionId: "chat-a",
    reviewReadyCloudAuthority: ({ authority }) => ({
      authority: {
        ...authority,
        state: "review_ready",
        laneRevision: "c".repeat(40),
        reviewRequestId,
        focusedEvidenceDigest,
      },
    }),
    buildDeliveryEvidence: input => {
      assert.equal(input.operation, "publish");
      assert.equal(input.branch, branch);
      assert.equal(input.headSha, "c".repeat(40));
      assert.equal(input.headTreeSha, "d".repeat(40));
      assert.equal(input.pullRequestNumber, 1);
      assert.equal(input.deviceId, "device");
      assert.equal(input.sessionId, "chat-a");
      return evidence;
    },
    authorizeCloudDelivery: ({ authority, headSha, invoke, ...input }) => {
      assert.deepEqual(
        Object.fromEntries(Object.keys(evidence).map(key => [key, input[key]])),
        evidence,
      );
      invoke({
        action: "integrate",
        request: { idempotencyKey: "p".repeat(513) },
      });
      return {
        authority: {
          ...authority,
          state: "delivery_authorized",
          integrationReceiptDigest: "7".repeat(64),
          integration: {
            candidateRevision: headSha,
            reviewRequestId,
            focusedEvidenceDigest,
            ...evidence,
          },
        },
      };
    },
    invokeCloudMutation: input => {
      cloudMutation = input;
      return { ok: true };
    },
    verifyCloudAuthority: () => ({ ok: true }),
    run: (command, args) => {
      calls.push([command, ...args]);
      if (command === "gh" && args[1] === "ready") isDraft = false;
      const bodyIndex = args.indexOf("--body");
      if (command === "gh" && bodyIndex >= 0) body = args[bodyIndex + 1];
    },
    log: () => {},
  });

  assert.equal(result, pullRequestUrl);
  assert.match(cloudMutation.request.idempotencyKey, /^device-cloud-mutation:[0-9a-f]{64}$/u);
  assert.deepEqual(calls[0], ["git", "merge-base", "--is-ancestor", "b".repeat(40), "HEAD"]);
  assert.ok(calls.some(call => call[0] === "gh" && call[1] === "pr" && call[2] === "ready"));
  assert.equal(releaseStatus, "delivery");
});

test("publish rejects delivery evidence failure before review activation or merge authorization", () => {
  const calls = [];
  const branch = "agent/device/runtime-leases";
  const pullRequestUrl = "https://github.test/pull/1";
  const gitText = createGitText({
    "worktree list --porcelain -z": branchWorktree(branch),
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "status --porcelain": "",
    "branch --show-current": `${branch}\n`,
    "rev-parse HEAD": "c".repeat(40),
    [`rev-parse ${"c".repeat(40)}^{tree}`]: "d".repeat(40),
  });
  let authorized = false;
  let released = false;

  assert.throws(() => publish({
    invocationPath: repo,
    repo,
    gitText,
    ghText: args => args[1] === "list"
      ? JSON.stringify([{ number: 1, headRefName: branch, url: pullRequestUrl }])
      : args.includes("--jq") ? "" : pullJson(pullRequestUrl, branch),
    ghOptional: () => pullRequestUrl,
    leaseStore: {
      verify: () => ({
        branch,
        fenceSha: "b".repeat(40),
        pullRequestUrl,
        worktreePath: repo,
        device: "device",
        admission: { schema: "agentic-lane-admission-lease/v1", status: "admitted" },
        cloudAuthority: {
          schema: "agentic-lane-cloud-authority/v1",
          state: "active",
          canonicalBaseSha: "a".repeat(40),
        },
      }),
      annotate: () => {
        throw new Error("evidence failure must not annotate delivery");
      },
      release: () => {
        released = true;
        throw new Error("evidence failure must not release delivery");
      },
    },
    sessionId: "chat-a",
    reviewReadyCloudAuthority: ({ authority }) => ({
      authority: { ...authority, state: "review_ready" },
    }),
    buildDeliveryEvidence: () => {
      throw new Error("delivery evidence unavailable");
    },
    authorizeCloudDelivery: () => {
      authorized = true;
      throw new Error("must not authorize");
    },
    verifyCloudAuthority: () => ({ ok: true }),
    run: (command, args) => calls.push([command, ...args]),
    log: () => {},
  }), /delivery evidence unavailable/);

  assert.equal(authorized, false);
  assert.equal(released, false);
  assert.equal(calls.some(call => call[0] === "gh" && call[1] === "pr" && call[2] === "ready"), false);
  assert.equal(calls.some(call => call[0] === "gh" && call[1] === "pr" && call[2] === "merge"), false);
});

test("publish replays an exact checkpoint after remote authorization succeeds but its response is lost", () => {
  const calls = [];
  const branch = "agent/device/runtime-leases";
  const pullRequestUrl = "https://github.test/pull/1";
  const headSha = "c".repeat(40);
  const evidence = {
    dependencyClosureDigest: "1".repeat(64),
    namedChecksDigest: "2".repeat(64),
    handoffEvidenceDigest: "3".repeat(64),
    operatorDecisionDigest: "4".repeat(64),
    integrationIntentDigest: "5".repeat(64),
  };
  const reviewRequestId = "github-pull-request:PR_1";
  const focusedEvidenceDigest = "6".repeat(64);
  const gitText = createGitText({
    "worktree list --porcelain -z": branchWorktree(branch),
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "status --porcelain": "",
    "branch --show-current": `${branch}\n`,
    "log -1 --pretty=%s": "fix: replay protected delivery\n",
    "rev-parse HEAD": headSha,
    [`rev-parse ${headSha}^{tree}`]: "d".repeat(40),
  });
  let isDraft = true;
  let body = "";
  let reviewCalls = 0;
  let evidenceCalls = 0;
  let authorizationCalls = 0;
  let recordedIntegration = null;
  let released = false;
  let lease = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 1,
    sessionId: "chat-a",
    branch,
    scope: "runtime-leases",
    baseSha: "a".repeat(40),
    fenceSha: "b".repeat(40),
    pullRequestUrl,
    worktreePath: repo,
    device: "device",
    autoDelivery: false,
    runtimeRequired: false,
    admission: publishAdmission,
    cloudAuthority: publishAuthority(),
    acquiredAt: "2026-07-17T10:00:00.000Z",
    heartbeatAt: "2026-07-17T10:00:00.000Z",
    expiresAt: "2099-07-17T10:30:00.000Z",
  };
  const leaseStore = {
    verify: () => lease,
    annotate: ({ values }) => (lease = { ...lease, ...values }),
    release: ({ status }) => {
      released = true;
      return (lease = { ...lease, status });
    },
  };
  const input = {
    invocationPath: repo,
    repo,
    gitText,
    ghText: args => args[1] === "list"
      ? JSON.stringify([{ number: 1, headRefName: branch, url: pullRequestUrl }])
      : args.includes("--jq") ? body : pullJson(pullRequestUrl, branch, body, isDraft),
    ghOptional: () => pullRequestUrl,
    leaseStore,
    sessionId: "chat-a",
    reviewReadyCloudAuthority: ({ authority }) => {
      reviewCalls += 1;
      return {
        authority: {
          ...authority,
          state: "review_ready",
          laneRevision: headSha,
          reviewRequestId,
          focusedEvidenceDigest,
        },
      };
    },
    buildDeliveryEvidence: () => {
      evidenceCalls += 1;
      return evidence;
    },
    authorizeCloudDelivery: ({ authority, headSha: candidateRevision, ...subject }) => {
      authorizationCalls += 1;
      const supplied = Object.fromEntries(
        Object.keys(evidence).map(field => [field, subject[field]]),
      );
      if (!recordedIntegration) {
        recordedIntegration = supplied;
        throw new Error("simulated authorization response loss");
      }
      assert.deepEqual(supplied, recordedIntegration);
      return {
        authority: {
          ...authority,
          state: "delivery_authorized",
          integrationReceiptDigest: "7".repeat(64),
          integration: {
            candidateRevision,
            reviewRequestId,
            focusedEvidenceDigest,
            ...recordedIntegration,
          },
        },
      };
    },
    verifyCloudAuthority: () => ({ ok: true }),
    run: (command, args) => {
      calls.push([command, ...args]);
      if (command === "gh" && args[1] === "ready") isDraft = false;
      const bodyIndex = args.indexOf("--body");
      if (command === "gh" && bodyIndex >= 0) body = args[bodyIndex + 1];
    },
    log: () => {},
  };

  assert.throws(() => publish(input), /simulated authorization response loss/u);
  assert.equal(lease.deliveryHeadSha, headSha);
  assert.equal(lease.cloudAuthority.state, "review_ready");
  assert.equal(isDraft, false);
  assert.equal(released, false);

  assert.equal(publish(input), pullRequestUrl);
  assert.equal(reviewCalls, 1);
  assert.equal(evidenceCalls, 2);
  assert.equal(authorizationCalls, 2);
  assert.deepEqual(recordedIntegration, evidence);
  assert.equal(released, true);
  assert.equal(
    calls.filter(call => call[0] === "gh" && call[1] === "pr" && call[2] === "ready").length,
    1,
  );
  assert.equal(
    calls.filter(call => call[0] === "gh" && call[1] === "pr" && call[2] === "merge").length,
    1,
  );
});

test("publish rejects a replay authorization whose recorded integration changes one derived digest", () => {
  const calls = [];
  const branch = "agent/device/runtime-leases";
  const pullRequestUrl = "https://github.test/pull/1";
  const headSha = "c".repeat(40);
  const reviewRequestId = "github-pull-request:PR_1";
  const focusedEvidenceDigest = "6".repeat(64);
  const evidence = {
    dependencyClosureDigest: "1".repeat(64),
    namedChecksDigest: "2".repeat(64),
    handoffEvidenceDigest: "3".repeat(64),
    operatorDecisionDigest: "4".repeat(64),
    integrationIntentDigest: "5".repeat(64),
  };
  const gitText = createGitText({
    "worktree list --porcelain -z": branchWorktree(branch),
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "status --porcelain": "",
    "branch --show-current": `${branch}\n`,
    "log -1 --pretty=%s": "fix: replay protected delivery\n",
    "rev-parse HEAD": headSha,
    [`rev-parse ${headSha}^{tree}`]: "d".repeat(40),
  });
  let verified = false;
  let released = false;
  const authority = publishAuthority({
    state: "review_ready",
    laneRevision: headSha,
    reviewRequestId,
    focusedEvidenceDigest,
  });

  assert.throws(() => publish({
    invocationPath: repo,
    repo,
    gitText,
    ghText: args => args[1] === "list"
      ? JSON.stringify([{ number: 1, headRefName: branch, url: pullRequestUrl }])
      : args.includes("--jq") ? "" : pullJson(pullRequestUrl, branch, "", false),
    ghOptional: () => pullRequestUrl,
    leaseStore: {
      verify: () => ({
        schema: "agentic-writer-lease/v2",
        status: "active",
        branch,
        fenceSha: "b".repeat(40),
        pullRequestUrl,
        worktreePath: repo,
        device: "device",
        deliveryHeadSha: headSha,
        admission: { schema: "agentic-lane-admission-lease/v1", status: "admitted" },
        cloudAuthority: authority,
      }),
      annotate: () => {
        throw new Error("mismatched replay must not annotate delivery");
      },
      release: () => {
        released = true;
        throw new Error("mismatched replay must not release delivery");
      },
    },
    sessionId: "chat-a",
    reviewReadyCloudAuthority: () => {
      throw new Error("checkpoint replay must not repeat review transition");
    },
    buildDeliveryEvidence: () => evidence,
    authorizeCloudDelivery: () => ({
      authority: {
        ...authority,
        state: "delivery_authorized",
        integrationReceiptDigest: "7".repeat(64),
        integration: {
          candidateRevision: headSha,
          reviewRequestId,
          focusedEvidenceDigest,
          ...evidence,
          namedChecksDigest: "f".repeat(64),
        },
      },
    }),
    verifyCloudAuthority: () => {
      verified = true;
      throw new Error("must not verify mismatched authorization");
    },
    run: (command, args) => calls.push([command, ...args]),
    log: () => {},
  }), /does not record the exact derived delivery evidence and receipt/u);

  assert.equal(verified, false);
  assert.equal(released, false);
  assert.equal(
    calls.some(call => call[0] === "gh" && call[1] === "pr" && call[2] === "merge"),
    false,
  );
});

test("publish persists an authorized checkpoint before merge and replays without rebuilding evidence", () => {
  const branch = "agent/device/runtime-leases";
  const pullRequestUrl = "https://github.test/pull/1";
  const headSha = "c".repeat(40);
  const reviewRequestId = "github-pull-request:PR_1";
  const focusedEvidenceDigest = "6".repeat(64);
  const evidence = {
    dependencyClosureDigest: "1".repeat(64),
    namedChecksDigest: "2".repeat(64),
    handoffEvidenceDigest: "3".repeat(64),
    operatorDecisionDigest: "4".repeat(64),
    integrationIntentDigest: "5".repeat(64),
  };
  const gitText = createGitText({
    "worktree list --porcelain -z": branchWorktree(branch),
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "status --porcelain": "",
    "branch --show-current": `${branch}\n`,
    "log -1 --pretty=%s": "fix: checkpoint protected delivery\n",
    "rev-parse HEAD": headSha,
    [`rev-parse ${headSha}^{tree}`]: "d".repeat(40),
  });
  let body = "";
  let isDraft = true;
  let failAutomerge = true;
  let reviewCalls = 0;
  let evidenceCalls = 0;
  let authorizationCalls = 0;
  let releaseCalls = 0;
  const commands = [];
  let lease = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 1,
    sessionId: "chat-a",
    device: "device",
    scope: "runtime-leases",
    branch,
    worktreePath: repo,
    baseSha: "a".repeat(40),
    fenceSha: "b".repeat(40),
    pullRequestUrl,
    autoDelivery: false,
    runtimeRequired: false,
    admission: publishAdmission,
    cloudAuthority: publishAuthority(),
    acquiredAt: "2026-07-17T10:00:00.000Z",
    heartbeatAt: "2026-07-17T10:00:00.000Z",
    expiresAt: "2099-07-17T10:30:00.000Z",
  };
  const input = {
    invocationPath: repo,
    repo,
    gitText,
    ghText: args => args[1] === "list"
      ? JSON.stringify([{ number: 1, headRefName: branch, url: pullRequestUrl }])
      : args.includes("--jq") ? body : pullJson(pullRequestUrl, branch, body, isDraft),
    ghOptional: () => pullRequestUrl,
    leaseStore: {
      verify: () => lease,
      annotate: ({ values }) => (lease = { ...lease, ...values }),
      release: ({ status }) => {
        releaseCalls += 1;
        return (lease = { ...lease, status });
      },
    },
    sessionId: "chat-a",
    reviewReadyCloudAuthority: ({ authority }) => {
      reviewCalls += 1;
      return {
        authority: {
          ...authority,
          state: "review_ready",
          laneRevision: headSha,
          reviewRequestId,
          focusedEvidenceDigest,
        },
      };
    },
    buildDeliveryEvidence: () => {
      evidenceCalls += 1;
      return evidence;
    },
    authorizeCloudDelivery: ({ authority, headSha: candidateRevision, ...subject }) => {
      authorizationCalls += 1;
      assert.deepEqual(
        Object.fromEntries(Object.keys(evidence).map(field => [field, subject[field]])),
        evidence,
      );
      return {
        authority: {
          ...authority,
          state: "delivery_authorized",
          integrationReceiptDigest: "7".repeat(64),
          integration: {
            candidateRevision,
            reviewRequestId,
            focusedEvidenceDigest,
            ...evidence,
          },
        },
      };
    },
    verifyCloudAuthority: () => ({ ok: true }),
    run: (command, args) => {
      commands.push([command, ...args]);
      if (command === "gh" && args[1] === "ready") isDraft = false;
      const bodyIndex = args.indexOf("--body");
      if (command === "gh" && bodyIndex >= 0) body = args[bodyIndex + 1];
      if (command === "gh" && args.includes("--add-label") && failAutomerge) {
        failAutomerge = false;
        throw new Error("simulated merge-intent failure");
      }
    },
    log: () => {},
  };

  assert.throws(() => publish(input), /simulated merge-intent failure/u);
  assert.equal(lease.status, "active");
  assert.equal(lease.cloudAuthority.state, "delivery_authorized");
  assert.equal(parseWriterLeasePullRequestBody(body).cloudAuthority.state, "delivery_authorized");
  assert.equal(releaseCalls, 0);

  assert.equal(publish(input), pullRequestUrl);
  assert.equal(reviewCalls, 1);
  assert.equal(evidenceCalls, 1);
  assert.equal(authorizationCalls, 2);
  assert.equal(releaseCalls, 1);
  assert.equal(
    commands.filter(call => call[0] === "git" && call[1] === "push").length,
    1,
  );
  const authorizedProjectionIndex = commands.findIndex(call => {
    const bodyIndex = call.indexOf("--body");
    return bodyIndex >= 0
      && parseWriterLeasePullRequestBody(call[bodyIndex + 1])?.cloudAuthority?.state === "delivery_authorized";
  });
  const mergeIntentIndex = commands.findIndex(call => call.includes("--add-label"));
  assert.ok(authorizedProjectionIndex >= 0);
  assert.ok(authorizedProjectionIndex < mergeIntentIndex);
});

test("publish finalizes an already-merged authorized checkpoint without recreating merge intent", () => {
  const branch = "agent/device/runtime-leases";
  const pullRequestUrl = "https://github.test/pull/1";
  const headSha = "c".repeat(40);
  const reviewRequestId = "github-pull-request:PR_1";
  const focusedEvidenceDigest = "6".repeat(64);
  const evidence = {
    dependencyClosureDigest: "1".repeat(64),
    namedChecksDigest: "2".repeat(64),
    handoffEvidenceDigest: "3".repeat(64),
    operatorDecisionDigest: "4".repeat(64),
    integrationIntentDigest: "5".repeat(64),
  };
  const authority = publishAuthority({
    state: "delivery_authorized",
    laneRevision: headSha,
    reviewRequestId,
    focusedEvidenceDigest,
    integrationReceiptDigest: "7".repeat(64),
    integration: {
      candidateRevision: headSha,
      reviewRequestId,
      focusedEvidenceDigest,
      ...evidence,
    },
  });
  let lease = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 1,
    sessionId: "chat-a",
    device: "device",
    scope: "runtime-leases",
    branch,
    worktreePath: repo,
    baseSha: "a".repeat(40),
    fenceSha: "b".repeat(40),
    pullRequestUrl,
    autoDelivery: false,
    runtimeRequired: false,
    deliveryHeadSha: headSha,
    admission: publishAdmission,
    cloudAuthority: authority,
    acquiredAt: "2026-07-17T10:00:00.000Z",
    heartbeatAt: "2026-07-17T10:00:00.000Z",
    expiresAt: "2099-07-17T10:30:00.000Z",
  };
  let body = renderWriterLeasePullRequestBody(lease);
  const commands = [];
  let released = false;

  const result = publish({
    invocationPath: repo,
    repo,
    gitText: createGitText({
      "worktree list --porcelain -z": branchWorktree(branch),
      "diff --name-only --diff-filter=U": "",
      "ls-files -u": "",
      "status --porcelain": "",
      "branch --show-current": `${branch}\n`,
      "rev-parse HEAD": headSha,
    }),
    ghText: args => {
      if (args[1] === "list") throw new Error("merged replay must not inspect competing open pull requests");
      if (args.includes("--jq")) return body;
      return pullJson(pullRequestUrl, branch, body, false, "MERGED");
    },
    ghOptional: () => {
      throw new Error("merged replay must use its recorded pull-request URL");
    },
    leaseStore: {
      verify: () => lease,
      annotate: ({ values }) => (lease = { ...lease, ...values }),
      release: ({ status }) => {
        released = true;
        return (lease = { ...lease, status });
      },
    },
    sessionId: "chat-a",
    reviewReadyCloudAuthority: () => {
      throw new Error("authorized replay must not repeat review transition");
    },
    buildDeliveryEvidence: () => {
      throw new Error("authorized replay must not rebuild delivery evidence");
    },
    authorizeCloudDelivery: input => {
      assert.equal(input.authority, authority);
      assert.deepEqual(
        Object.fromEntries(Object.keys(evidence).map(field => [field, input[field]])),
        evidence,
      );
      return { authority };
    },
    verifyCloudAuthority: () => ({ ok: true }),
    run: (command, args) => {
      commands.push([command, ...args]);
      const bodyIndex = args.indexOf("--body");
      if (command === "gh" && bodyIndex >= 0) body = args[bodyIndex + 1];
    },
    log: () => {},
  });

  assert.equal(result, pullRequestUrl);
  assert.equal(released, true);
  assert.equal(lease.status, "delivery");
  assert.equal(commands.some(call => call[0] === "git" && call[1] === "push"), false);
  assert.equal(commands.some(call => call.includes("--add-label")), false);
  assert.equal(commands.some(call => call[0] === "gh" && call[1] === "pr" && call[2] === "ready"), false);
  assert.equal(commands.some(call => call[0] === "gh" && call[1] === "pr" && call[2] === "merge"), false);
});

test("resume fences parked and reviewed handoffs with a newer epoch", () => {
  for (const handoff of [
    { status: "parked", priorSessionId: "chat-old", sessionId: "chat-new" },
    { status: "review_ready", priorSessionId: "chat-new", sessionId: "chat-new" },
  ]) {
    const calls = [];
    const branch = "agent/old-device/runtime-leases";
    const pullRequestUrl = "https://github.test/pull/1";
    let isDraft = handoff.status === "parked";
    const priorLease = {
      schema: "agentic-writer-lease/v2",
      status: handoff.status,
      epoch: 4,
      sessionId: handoff.priorSessionId,
      device: "old-device",
      scope: "runtime-leases",
      branch,
      baseSha: "a".repeat(40),
      fenceSha: "b".repeat(40),
      ...(handoff.status === "parked" ? {
        parkHeadSha: "a".repeat(40),
        parkBranchHeadSha: "c".repeat(40),
        parkSourceEpoch: 4,
        parkSourceFenceSha: "b".repeat(40),
        parkStashRef: null,
        parkStashSha: null,
        parkStashMessage: null,
        parkStashStatus: null,
      } : {}),
      ...(handoff.status === "review_ready" ? { reviewHeadSha: "c".repeat(40) } : {}),
      ...(handoff.status === "delivery" ? { deliveryHeadSha: "c".repeat(40) } : {}),
      heartbeatAt: "2026-07-17T10:00:00.000Z",
      expiresAt: "2026-07-17T10:00:00.000Z",
    };
    const gitText = createGitText({
      "worktree list --porcelain -z": detachedWorktree,
      "diff --name-only --diff-filter=U": "",
      "ls-files -u": "",
      "status --porcelain": "",
      "branch --show-current": "",
      [`rev-parse origin/${branch}`]: "c".repeat(40),
      "rev-parse HEAD": "d".repeat(40),
    });
    let claimInput = null;
    const resumedLease = {
      ...priorLease,
      status: "active",
      epoch: 5,
      sessionId: handoff.sessionId,
      device: "new-device",
      worktreePath: repo,
      baseSha: "c".repeat(40),
      fenceSha: "d".repeat(40),
      pullRequestUrl,
      expiresAt: "2026-07-17T10:30:00.000Z",
    };

    const result = resume({
      branchName: branch,
      invocationPath: repo,
      repo,
      gitText,
      gitOptional: args => args[0] === "config" ? "new-device" : "",
      ghText: args => args[1] === "list"
        ? JSON.stringify([{ number: 1, headRefName: branch, url: pullRequestUrl }])
        : pullJson(pullRequestUrl, branch, renderWriterLeasePullRequestBody(priorLease), isDraft),
      leaseStore: {
        claim: input => { claimInput = input; return { ...resumedLease, fenceSha: null }; },
        annotate: () => resumedLease,
      },
      sessionId: handoff.sessionId,
      leaseTtlMs: 1_800_000,
      run: (command, args) => {
        calls.push([command, ...args]); if (command === "gh" && args[1] === "ready" && args[2] === "--undo") isDraft = true;
      },
      log: () => {},
      now: () => new Date("2026-07-17T10:05:00.000Z"),
    });

    assert.equal(claimInput.previousEpoch, 4);
    assert.equal(result.epoch, 5);
    assert.ok(calls.some(call => call.join(" ") === `git push origin ${branch}`));
    assert.ok(calls.some(call => call[0] === "gh" && call[1] === "pr" && call[2] === "edit"));
  }
});

test("same-session delivery resume carries its original integration into the successor fence", () => {
  const branch = "agent/device/runtime-leases";
  const pullRequestUrl = "https://github.test/pull/1";
  const sourceBaseSha = "a".repeat(40);
  const sourceFenceSha = "b".repeat(40);
  const deliveryHeadSha = "c".repeat(40);
  const deliveryTreeSha = "d".repeat(40);
  const successorFenceSha = "e".repeat(40);
  const changedPath = "scripts/delivery-continuation.mjs";
  const priorLease = {
    schema: "agentic-writer-lease/v2",
    status: "delivery",
    epoch: 4,
    sessionId: "chat-a",
    device: "device",
    scope: "runtime-leases",
    branch,
    worktreePath: repo,
    baseSha: sourceBaseSha,
    fenceSha: sourceFenceSha,
    pullRequestUrl,
    autoDelivery: false,
    runtimeRequired: false,
    deliveryHeadSha,
    heartbeatAt: "2026-07-17T10:00:00.000Z",
    expiresAt: "2026-07-17T10:00:00.000Z",
    integration: {
      schema: "agentic-integration-commit/v1",
      commitSha: deliveryHeadSha,
      treeSha: deliveryTreeSha,
      commitMessage: "feat: delivered source",
      manifestDigest: "1".repeat(64),
      stagedDiffDigest: "2".repeat(64),
      paths: [changedPath],
    },
  };
  let localLease = priorLease;
  let remoteHead = deliveryHeadSha;
  let head = deliveryHeadSha;
  let remoteBody = renderWriterLeasePullRequestBody(priorLease);
  let isDraft = false;
  let claimInput = null;
  const gitText = args => {
    const key = args.join(" ");
    const values = {
      "worktree list --porcelain -z": branchWorktree(branch),
      "diff --name-only --diff-filter=U": "",
      "ls-files -u": "",
      "status --porcelain": "",
      "branch --show-current": branch,
      [`rev-parse origin/${branch}`]: remoteHead,
      "rev-parse HEAD": head,
      [`rev-parse ${deliveryHeadSha}^{tree}`]: deliveryTreeSha,
      [`merge-base --is-ancestor ${sourceFenceSha} ${deliveryHeadSha}`]: "",
      [`merge-base --is-ancestor ${deliveryHeadSha} ${deliveryHeadSha}`]: "",
      [`diff --name-only -z ${sourceFenceSha} ${deliveryHeadSha} --`]:
        `${changedPath}\0`,
      [`diff --binary ${sourceFenceSha} ${deliveryHeadSha} --`]:
        "delivery continuation diff",
    };
    if (!(key in values)) throw new Error(`unexpected git command: ${key}`);
    return values[key];
  };

  const result = resume({
    branchName: branch,
    invocationPath: repo,
    repo,
    gitText,
    gitOptional: args => {
      if (args[0] === "config") return "device";
      if (args[0] === "ls-remote") {
        return `${remoteHead}\trefs/heads/${branch}`;
      }
      return "";
    },
    ghText: args => args[1] === "list"
      ? JSON.stringify([{
        number: 1,
        headRefName: branch,
        url: pullRequestUrl,
        body: remoteBody,
      }])
      : JSON.stringify({
        url: pullRequestUrl,
        state: "OPEN",
        isDraft,
        headRefName: branch,
        headRefOid: remoteHead,
        baseRefName: "main",
        body: remoteBody,
      }),
    leaseStore: {
      read: () => localLease,
      claim: input => {
        claimInput = input;
        localLease = {
          ...priorLease,
          status: "active",
          epoch: 5,
          baseSha: input.baseSha,
          fenceSha: null,
          pullRequestUrl: null,
          integration: input.integration,
          preClaimIntegrationContinuation:
            input.preClaimIntegrationContinuation,
        };
        return localLease;
      },
      annotate: ({ values }) => (localLease = { ...localLease, ...values }),
      verify: () => localLease,
    },
    sessionId: "chat-a",
    leaseTtlMs: 1_800_000,
    run: (command, args) => {
      if (
        command === "gh" &&
        args[0] === "pr" &&
        args[1] === "ready" &&
        args[2] === "--undo"
      ) {
        isDraft = true;
      } else if (command === "git" && args[0] === "commit") {
        head = successorFenceSha;
      } else if (command === "git" && args[0] === "push") {
        remoteHead = head;
      } else if (
        command === "gh" &&
        args[0] === "pr" &&
        args[1] === "edit"
      ) {
        remoteBody = args[args.indexOf("--body") + 1];
      }
    },
    log: () => {},
    now: () => new Date("2026-07-17T10:05:00.000Z"),
  });

  assert.equal(result.fenceSha, successorFenceSha);
  assert.equal(claimInput.baseSha, deliveryHeadSha);
  assert.equal(claimInput.integration.commitSha, deliveryHeadSha);
  assert.equal(claimInput.integration.validationRequired, true);
  assert.equal(
    claimInput.preClaimIntegrationContinuation.sourceStatus,
    "delivery",
  );
  assert.equal(
    parseWriterLeasePullRequestBody(remoteBody).integration.rangeDiffDigest,
    claimInput.integration.rangeDiffDigest,
  );
});

test("resume rejects a delivery revision claimed by another session", () => {
  const branch = "agent/device/runtime-leases";
  const priorLease = {
    schema: "agentic-writer-lease/v2",
    status: "delivery",
    epoch: 4,
    sessionId: "chat-old",
    device: "device",
    scope: "runtime-leases",
    branch,
    baseSha: "a".repeat(40),
    fenceSha: "b".repeat(40),
    heartbeatAt: "2026-07-17T10:00:00.000Z",
    expiresAt: "2026-07-17T10:00:00.000Z",
  };
  const gitText = createGitText({
    "worktree list --porcelain -z": detachedWorktree,
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "status --porcelain": "",
    "branch --show-current": "",
    [`rev-parse origin/${branch}`]: "b".repeat(40),
  });

  assert.throws(() => resume({
    branchName: branch,
    invocationPath: repo,
    repo,
    gitText,
    gitOptional: () => "",
    ghText: args => args[1] === "list"
      ? JSON.stringify([{ number: 1, headRefName: branch, url: "https://github.test/pull/1" }])
      : pullJson("https://github.test/pull/1", branch, renderWriterLeasePullRequestBody(priorLease), false),
    leaseStore: {},
    sessionId: "chat-new",
    leaseTtlMs: 1_800_000,
    run: () => {},
    now: () => new Date("2026-07-17T10:05:00.000Z"),
  }), /remains delivery under another session/);
});

test("main park merges and verifies the one fetched main object when the shared ref advances", () => {
  const pinnedMainSha = "b".repeat(40);
  const advancedMainSha = "c".repeat(40);
  let originMainSha = pinnedMainSha;
  let originReads = 0;
  const calls = [];
  const baseGitText = createGitText({
    "worktree list --porcelain -z": branchWorktree("main"),
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "branch --show-current": "main\n",
    "status --porcelain": "",
    "stash list --format=%H%x00%gs": "",
    "rev-parse HEAD": ["a".repeat(40), pinnedMainSha],
  });
  const gitText = args => {
    if (args.join(" ") === "rev-parse origin/main") {
      originReads += 1;
      return originMainSha;
    }
    return baseGitText(args);
  };

  const result = park({
    invocationPath: repo,
    repo,
    gitText,
    gitOptional: () => "",
    run: (command, args) => {
      calls.push([command, ...args]);
      if (command === "git" && args[0] === "merge") originMainSha = advancedMainSha;
    },
    log: () => {},
  });

  assert.equal(result.headSha, pinnedMainSha);
  assert.equal(originReads, 1);
  assert.ok(calls.some(call => call.join(" ") === `git merge --ff-only ${pinnedMainSha}`));
});

test("completeSession detaches the task worktree only after the task pull request is merged", () => {
  const calls = [];
  const logs = [];
  const gitText = createGitText({
    "worktree list --porcelain -z": branchWorktree("agent/device/scope"),
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "branch --show-current": "agent/device/scope\n",
    "stash list --format=%H%x00%gd%x00%gs": "",
    "status --porcelain": ["", ""],
    "rev-parse refs/heads/agent/device/scope": "fedcbafedcbafedcbafedcbafedcbafedcbafedc\n",
    "rev-parse HEAD": [
      "fedcbafedcbafedcbafedcbafedcbafedcbafedc\n",
      "1234567890abcdef1234567890abcdef12345678\n",
    ],
    "rev-parse origin/main": "1234567890abcdef1234567890abcdef12345678\n",
  });

  const summary = completeSession({
    invocationPath: repo,
    repo,
    gitText,
    ghText: () => JSON.stringify({
      state: "MERGED",
      baseRefName: "main",
      url: "https://github.com/example/repo/pull/42",
      mergeCommit: { oid: "abcdefabcdefabcdefabcdefabcdefabcdefabcd" },
      headRefOid: "fedcbafedcbafedcbafedcbafedcbafedcbafedc",
    }),
    leaseStore: createCompletionLeaseStore(),
    run: (command, args) => calls.push([command, ...args]),
    log: message => logs.push(message),
  });

  assert.deepEqual(calls, [
    ["git", "fetch", "origin", "main"],
    ["git", "merge-base", "--is-ancestor", "abcdefabcdefabcdefabcdefabcdefabcdefabcd", "1234567890abcdef1234567890abcdef12345678"],
    ["git", "switch", "--detach", "1234567890abcdef1234567890abcdef12345678"],
  ]);
  assert.deepEqual(summary, {
    completedBranch: "agent/device/scope",
    pullRequestUrl: "https://github.com/example/repo/pull/42",
    mergeCommitSha: "abcdefabcdefabcdefabcdefabcdefabcdefabcd",
    mainSha: "1234567890abcdef1234567890abcdef12345678",
    status: "ok",
  });
  assert.match(logs[0], /Restart the local runtime from this SHA/);
});

test("completeSession recovers a missing local lease from the merged pull request marker", () => {
  const calls = [];
  const recoveredLease = {
    schema: "agentic-writer-lease/v2",
    status: "review_ready",
    epoch: 118,
    sessionId: "20260802-origin-main-park-guidance",
    device: "katrinas-macbook-pro.local",
    scope: "origin-main-park-guidance",
    branch: "agent/device/scope",
    baseSha: "a".repeat(40),
    fenceSha: "f".repeat(40),
    autoDelivery: false,
    runtimeRequired: false,
    heartbeatAt: "2026-08-02T10:10:57.816Z",
    expiresAt: "2026-08-02T10:10:57.816Z",
    reviewHeadSha: "fedcbafedcbafedcbafedcbafedcbafedcbafedc",
  };
  const gitText = createGitText({
    "worktree list --porcelain -z": branchWorktree("agent/device/scope"),
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "branch --show-current": "agent/device/scope\n",
    "stash list --format=%H%x00%gd%x00%gs": "",
    "status --porcelain": ["", ""],
    "rev-parse refs/heads/agent/device/scope": "fedcbafedcbafedcbafedcbafedcbafedcbafedc\n",
    "rev-parse HEAD": [
      "fedcbafedcbafedcbafedcbafedcbafedcbafedc\n",
      "1234567890abcdef1234567890abcdef12345678\n",
    ],
    "rev-parse origin/main": "1234567890abcdef1234567890abcdef12345678\n",
  });

  const summary = completeSession({
    invocationPath: repo,
    repo,
    gitText,
    ghText: () => JSON.stringify({
      state: "MERGED",
      baseRefName: "main",
      url: "https://github.com/example/repo/pull/42",
      mergeCommit: { oid: "abcdefabcdefabcdefabcdefabcdefabcdefabcd" },
      headRefOid: "fedcbafedcbafedcbafedcbafedcbafedcbafedc",
      body: renderWriterLeasePullRequestBody(recoveredLease),
    }),
    leaseStore: createCompletionLeaseStore(null),
    run: (command, args) => calls.push([command, ...args]),
    log: () => {},
  });

  assert.deepEqual(summary, {
    completedBranch: "agent/device/scope",
    pullRequestUrl: "https://github.com/example/repo/pull/42",
    mergeCommitSha: "abcdefabcdefabcdefabcdefabcdefabcdefabcd",
    mainSha: "1234567890abcdef1234567890abcdef12345678",
    status: "ok",
  });
  assert.ok(calls.some(call => call.join(" ") === "git switch --detach 1234567890abcdef1234567890abcdef12345678"));
});

test("completeSession recovers a missing local lease from merged branch evidence when the PR has no marker", () => {
  const calls = [];
  let recovered = null;
  const gitText = createGitText({
    "worktree list --porcelain -z": branchWorktree("agent/device/scope"),
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "branch --show-current": "agent/device/scope\n",
    "stash list --format=%H%x00%gd%x00%gs": "",
    "status --porcelain": ["", ""],
    "rev-parse refs/heads/agent/device/scope": "fedcbafedcbafedcbafedcbafedcbafedcbafedc\n",
    "rev-parse HEAD": [
      "fedcbafedcbafedcbafedcbafedcbafedcbafedc\n",
      "1234567890abcdef1234567890abcdef12345678\n",
    ],
    "rev-parse origin/main": "1234567890abcdef1234567890abcdef12345678\n",
  });

  const summary = completeSession({
    invocationPath: repo,
    repo,
    gitText,
    ghText: () => JSON.stringify({
      state: "MERGED",
      baseRefName: "main",
      url: "https://github.com/example/repo/pull/42",
      mergeCommit: { oid: "abcdefabcdefabcdefabcdefabcdefabcdefabcd" },
      headRefOid: "fedcbafedcbafedcbafedcbafedcbafedcbafedc",
      body: "",
    }),
    leaseStore: {
      read: () => null,
      recoverFromPullRequestMarker: () => {
        throw new Error("No recoverable writer lease marker records agent/device/scope.");
      },
      recoverMergedPullRequestCompletion: (values) => {
        recovered = values;
        return {
          schema: "agentic-writer-lease/v2",
          status: "completed",
          epoch: 19,
          sessionId: "recovered-merged-pr:agent/device/scope",
          device: "device",
          scope: "scope",
          branch: values.branch,
          worktreePath: values.worktreePath,
          baseSha: values.mainSha,
          fenceSha: values.headSha,
          pullRequestUrl: values.pullRequestUrl,
          autoDelivery: false,
          runtimeRequired: false,
          reviewHeadSha: values.headSha,
          heartbeatAt: "2026-08-06T00:00:00.000Z",
          expiresAt: "2026-08-06T00:00:00.000Z",
          completion: {
            mergeCommitSha: values.mergeCommitSha,
            mainSha: values.mainSha,
          },
        };
      },
      complete: () => {
        throw new Error("Completed recovery must not request a second completion fence.");
      },
    },
    run: (command, args) => calls.push([command, ...args]),
    log: () => {},
  });

  assert.deepEqual(recovered, {
    branch: "agent/device/scope",
    worktreePath: repo,
    pullRequestUrl: "https://github.com/example/repo/pull/42",
    mergeCommitSha: "abcdefabcdefabcdefabcdefabcdefabcdefabcd",
    mainSha: "1234567890abcdef1234567890abcdef12345678",
    headSha: "fedcbafedcbafedcbafedcbafedcbafedcbafedc",
  });
  assert.deepEqual(summary, {
    completedBranch: "agent/device/scope",
    pullRequestUrl: "https://github.com/example/repo/pull/42",
    mergeCommitSha: "abcdefabcdefabcdefabcdefabcdefabcdefabcd",
    mainSha: "1234567890abcdef1234567890abcdef12345678",
    status: "ok",
  });
  assert.ok(calls.some(call => call.join(" ") === "git switch --detach 1234567890abcdef1234567890abcdef12345678"));
});

test("completeSession fails closed when a merged PR carries an invalid writer lease marker", () => {
  const gitText = createGitText({
    "worktree list --porcelain -z": branchWorktree("agent/device/scope"),
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "branch --show-current": "agent/device/scope\n",
    "stash list --format=%H%x00%gd%x00%gs": "",
    "status --porcelain": "",
    "rev-parse refs/heads/agent/device/scope": "fedcbafedcbafedcbafedcbafedcbafedcbafedc\n",
    "rev-parse HEAD": "fedcbafedcbafedcbafedcbafedcbafedcbafedc\n",
    "rev-parse origin/main": "1234567890abcdef1234567890abcdef12345678\n",
  });

  assert.throws(() => completeSession({
    invocationPath: repo,
    repo,
    gitText,
    ghText: () => JSON.stringify({
      state: "MERGED",
      baseRefName: "main",
      url: "https://github.com/example/repo/pull/42",
      mergeCommit: { oid: "abcdefabcdefabcdefabcdefabcdefabcdefabcd" },
      headRefOid: "fedcbafedcbafedcbafedcbafedcbafedcbafedc",
      body: "<!-- agentic-writer-lease/v2 {\"schema\":\"agentic-writer-lease/v2\",\"branch\":\"agent/device/scope\"} -->",
    }),
    leaseStore: {
      read: () => null,
      recoverFromPullRequestMarker: ({ branch }) => {
        throw new Error(`Writer lease marker for ${branch} is present but invalid.`);
      },
    },
    run: () => {},
  }), /present but invalid/);
});

test("completeSession refuses auto-delivery completion without canonical runtime reconciliation", () => {
  const gitText = createGitText({
    "worktree list --porcelain -z": branchWorktree("agent/device/scope"),
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "status --porcelain": "",
    "branch --show-current": "agent/device/scope",
  });
  assert.throws(() => completeSession({
    invocationPath: repo,
    repo,
    gitText,
    ghText: () => "",
    leaseStore: createCompletionLeaseStore({
      status: "review_ready",
      autoDelivery: true,
      runtimeRequired: true,
      reviewHeadSha: "c".repeat(40),
    }),
    run: () => {},
  }), /requires device:integrate/);
});

test("completeSession fails closed while the pull request is open", () => {
  const gitText = createGitText({
    "worktree list --porcelain -z": branchWorktree("agent/device/scope"),
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "branch --show-current": "agent/device/scope\n",
    "stash list --format=%H%x00%gd%x00%gs": "",
    "status --porcelain": "",
  });

  assert.throws(
    () => completeSession({
      invocationPath: repo,
      repo,
      gitText,
      ghText: () => JSON.stringify({
        state: "OPEN",
        baseRefName: "main",
        url: "https://github.com/example/repo/pull/42",
        mergeCommit: null,
        headRefOid: "fedcbafedcbafedcbafedcbafedcbafedcbafedc",
      }),
      leaseStore: createCompletionLeaseStore(),
      run: () => {},
    }),
    /remains pending.*not merged/,
  );
});

test("completeSession fails closed while task work remains parked", () => {
  const gitText = createGitText({
    "worktree list --porcelain -z": branchWorktree("agent/device/scope"),
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "branch --show-current": "agent/device/scope\n",
    "stash list --format=%H%x00%gd%x00%gs": `${"f".repeat(40)}\0stash@{0}\0On agent/device/scope: park: agent/device/scope 20260717T010203Z\n`,
    "status --porcelain": "",
  });

  assert.throws(
    () => completeSession({
      invocationPath: repo,
      repo,
      gitText,
      ghText: () => "",
      leaseStore: createCompletionLeaseStore(),
      run: () => {},
    }),
    /remains parked in a named stash/,
  );
});

test("completeSession emits machine-readable merge and main evidence", () => {
  const logs = [];
  const gitText = createGitText({
    "worktree list --porcelain -z": branchWorktree("agent/device/scope"),
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "branch --show-current": "agent/device/scope\n",
    "stash list --format=%H%x00%gd%x00%gs": "",
    "status --porcelain": ["", ""],
    "rev-parse refs/heads/agent/device/scope": "fedcbafedcbafedcbafedcbafedcbafedcbafedc\n",
    "rev-parse HEAD": [
      "fedcbafedcbafedcbafedcbafedcbafedcbafedc\n",
      "1234567890abcdef1234567890abcdef12345678\n",
    ],
    "rev-parse origin/main": "1234567890abcdef1234567890abcdef12345678\n",
  });

  const summary = completeSession({
    invocationPath: repo,
    repo,
    gitText,
    ghText: () => JSON.stringify({
      state: "MERGED",
      baseRefName: "main",
      url: "https://github.com/example/repo/pull/42",
      mergeCommit: { oid: "abcdefabcdefabcdefabcdefabcdefabcdefabcd" },
      headRefOid: "fedcbafedcbafedcbafedcbafedcbafedcbafedc",
    }),
    leaseStore: createCompletionLeaseStore(),
    run: () => {},
    log: message => logs.push(message),
    json: true,
  });

  assert.deepEqual(summary, {
    completedBranch: "agent/device/scope",
    pullRequestUrl: "https://github.com/example/repo/pull/42",
    mergeCommitSha: "abcdefabcdefabcdefabcdefabcdefabcdefabcd",
    mainSha: "1234567890abcdef1234567890abcdef12345678",
    status: "ok",
  });
  assert.equal(
    logs[0],
    JSON.stringify(summary),
  );
});

test("device:end succeeds as a no-op when already on clean canonical main", () => {
  const logs = [];
  const gitText = createGitText({
    "worktree list --porcelain -z": branchWorktree("main"),
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "branch --show-current": "main\n",
    "status --porcelain": "",
    "rev-parse HEAD": "1234567890abcdef1234567890abcdef12345678\n",
    "rev-parse origin/main": "1234567890abcdef1234567890abcdef12345678\n",
  });

  const summary = completeSession({
    invocationPath: repo,
    repo,
    gitText,
    ghText: () => "",
    leaseStore: createCompletionLeaseStore(null),
    run: () => {
      throw new Error("device:end clean-main noop must not mutate the repository.");
    },
    log: message => logs.push(message),
    json: true,
    allowAlreadyOnCleanMain: true,
  });

  assert.deepEqual(summary, {
    completedBranch: null,
    pullRequestUrl: null,
    mergeCommitSha: null,
    mainSha: "1234567890abcdef1234567890abcdef12345678",
    status: "ok",
    disposition: "already_on_clean_main",
  });
  assert.equal(logs[0], JSON.stringify(summary));
});

test("device:end fails on main when canonical main is stale", () => {
  const gitText = createGitText({
    "worktree list --porcelain -z": branchWorktree("main"),
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "branch --show-current": "main\n",
    "status --porcelain": "",
    "rev-parse HEAD": "1234567890abcdef1234567890abcdef12345678\n",
    "rev-parse origin/main": "abcdefabcdefabcdefabcdefabcdefabcdefabcd\n",
  });

  assert.throws(
    () => completeSession({
      invocationPath: repo,
      repo,
      gitText,
      ghText: () => "",
      leaseStore: createCompletionLeaseStore(null),
      run: () => {},
      allowAlreadyOnCleanMain: true,
    }),
    /requires clean canonical main/,
  );
});

test("device:end fails on main while an active lease still owns the worktree", () => {
  const gitText = createGitText({
    "worktree list --porcelain -z": branchWorktree("main"),
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "branch --show-current": "main\n",
    "status --porcelain": "",
  });

  assert.throws(
    () => completeSession({
      invocationPath: repo,
      repo,
      gitText,
      ghText: () => "",
      leaseStore: createCompletionLeaseStore({ status: "active" }),
      run: () => {},
      allowAlreadyOnCleanMain: true,
    }),
    /remains active/,
  );
});

test("completeSession pins fetched origin/main when another worktree advances the shared ref", () => {
  const oldMain = "1".repeat(40);
  const newMain = "2".repeat(40);
  const calls = [];
  let originReads = 0;
  const baseGitText = createGitText({
    "worktree list --porcelain -z": branchWorktree("agent/device/scope"),
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "branch --show-current": ["agent/device/scope", "agent/device/scope"],
    "stash list --format=%H%x00%gd%x00%gs": "",
    "status --porcelain": ["", ""],
    "rev-parse refs/heads/agent/device/scope": "fedcbafedcbafedcbafedcbafedcbafedcbafedc",
    "rev-parse HEAD": [
      "fedcbafedcbafedcbafedcbafedcbafedcbafedc",
      oldMain,
    ],
  });
  const gitText = args => args.join(" ") === "rev-parse origin/main"
    ? (++originReads === 1 ? oldMain : newMain)
    : baseGitText(args);
  const summary = completeSession({
    invocationPath: repo,
    repo,
    gitText,
    ghText: () => JSON.stringify({
      state: "MERGED", baseRefName: "main",
      url: "https://github.com/example/repo/pull/42",
      mergeCommit: { oid: "abcdefabcdefabcdefabcdefabcdefabcdefabcd" },
      headRefOid: "fedcbafedcbafedcbafedcbafedcbafedcbafedc",
    }),
    leaseStore: createCompletionLeaseStore(),
    run: (command, args) => calls.push([command, ...args]),
    log: () => {},
  });

  assert.equal(summary.mainSha, oldMain);
  assert.equal(originReads, 1);
  assert.deepEqual(calls.filter(call => call[0] === "git" && call[1] === "switch"), [
    ["git", "switch", "--detach", oldMain],
  ]);
  assert.ok(calls.some(call => call.join(" ") ===
    `git merge-base --is-ancestor abcdefabcdefabcdefabcdefabcdefabcdefabcd ${oldMain}`));
});

test("completeSession rejects partial parked-stash completion evidence", () => {
  const gitText = createGitText({
    "worktree list --porcelain -z": branchWorktree("agent/device/scope"),
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "branch --show-current": "agent/device/scope",
    "stash list --format=%H%x00%gd%x00%gs": "",
    "status --porcelain": "",
  });
  assert.throws(() => completeSession({
    invocationPath: repo,
    repo,
    gitText,
    ghText: () => "",
    leaseStore: createCompletionLeaseStore({ parkStashSha: "f".repeat(40), parkStashStatus: null }),
    run: () => {},
  }), /Parked stash evidence is incomplete/);
});
