import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

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
  createWriterLeaseStore,
  parseWriterLeasePullRequestBody,
  renderWriterLeasePullRequestBody,
} from "../scripts/writer-lease-lib.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { markOperationDerivedCloudVerification } from "../scripts/scoped-lane-admission-lib.mjs";
import {
  createTaskAuthorityBinding,
  createTaskAuthorityCapability,
} from "../scripts/task-bound-lane-authority-contract.mjs";
import {
  acquireReviewedLaneEntrypointFence,
  advanceReviewedLaneRevisionIntent,
  assertReviewedLaneEntrypointFence,
  beginReviewedLaneRevisionIntent,
  readReviewedLaneRevisionIntent,
  releaseReviewedLaneEntrypointFence,
} from "../scripts/reviewed-lane-revision-fence.mjs";

const repo = process.cwd();
const detachedWorktree = `worktree ${repo}\nHEAD ${"a".repeat(40)}\ndetached\n`;
const branchWorktree = branch => `worktree ${repo}\nHEAD ${"a".repeat(40)}\nbranch refs/heads/${branch}\n`;
const pullJson = (
  url,
  branch,
  body = "",
  isDraft = true,
  state = "OPEN",
  baseRefOid = "a".repeat(40),
) => JSON.stringify({
  url, state, isDraft, headRefName: branch,
  headRefOid: "c".repeat(40), baseRefName: "main", baseRefOid, body,
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

function createReviewedLaneFenceFixture() {
  const gitCommonDir = mkdtempSync(path.join(os.tmpdir(), "agentic-reviewed-fence-"));
  const registryRoot = path.join(gitCommonDir, "agentic-canvas-os");
  const fixtureBranch = "agent/device/reviewed-fence";
  const sourceClaimId = "1".repeat(64);
  const lease = {
    schema: "agentic-writer-lease/v2",
    status: "review_ready",
    epoch: 7,
    sessionId: "session-reviewed-fence",
    device: "device",
    scope: "reviewed-fence",
    branch: fixtureBranch,
    worktreePath: repo,
    baseSha: "a".repeat(40),
    fenceSha: "b".repeat(40),
    reviewHeadSha: "b".repeat(40),
    pullRequestUrl: "https://github.com/example/repo/pull/77",
    autoDelivery: false,
    runtimeRequired: false,
    admission: {
      status: "admitted",
      declaredWriteSet: ["path:scripts/reviewed.mjs", "semantic:reviewed-fence"],
    },
    acquiredAt: "2026-08-09T09:00:00.000Z",
    heartbeatAt: "2026-08-09T10:00:00.000Z",
    expiresAt: "2026-08-09T11:00:00.000Z",
    cloudAuthority: { claimId: sourceClaimId },
  };
  mkdirSync(registryRoot, { recursive: true });
  writeFileSync(path.join(registryRoot, "writer-leases.json"), `${JSON.stringify({
    schema: "agentic-writer-lease-registry/v2",
    revision: 1,
    leases: { [fixtureBranch]: lease },
  }, null, 2)}\n`);
  return {
    branch: fixtureBranch,
    gitCommonDir,
    lease,
    leaseStore: createWriterLeaseStore({ gitCommonDir }),
    sourceClaimId,
  };
}

test("reviewed-lane entrypoint fence is durable across independent lease-store instances", () => {
  const fixture = createReviewedLaneFenceFixture();
  const operationDigest = "2".repeat(64);
  const options = {
    leaseStore: fixture.leaseStore,
    branch: fixture.branch,
    entrypoint: "review",
    operationDigest,
    expectedLeaseDigest: digestValue(fixture.lease),
    expectedClaimId: fixture.sourceClaimId,
  };
  try {
    const fence = acquireReviewedLaneEntrypointFence(options);
    assert.equal(assertReviewedLaneEntrypointFence({
      fence,
      leaseStore: createWriterLeaseStore({ gitCommonDir: fixture.gitCommonDir }),
    }).fenceDigest, fence.fenceDigest);
    assert.throws(() => acquireReviewedLaneEntrypointFence({
      ...options,
      leaseStore: createWriterLeaseStore({ gitCommonDir: fixture.gitCommonDir }),
    }), /already fences/u);
    assert.equal(releaseReviewedLaneEntrypointFence(fence), true);
    assert.equal(fixture.leaseStore.readRegistry()
      .reviewedLaneEntrypointFences?.[fixture.branch], undefined);
  } finally {
    rmSync(fixture.gitCommonDir, { recursive: true, force: true });
  }
});

test("durable review and publish reject an invalid subject before provider or registry mutation", () => {
  for (const entrypoint of [review, publish]) {
    const fixture = createReviewedLaneFenceFixture();
    const before = fixture.leaseStore.readRegistry();
    const mutations = [];
    const earlyGitText = args => {
      const key = args.join(" ");
      const values = {
        "worktree list --porcelain -z": branchWorktree(fixture.branch),
        "diff --name-only --diff-filter=U": "",
        "ls-files -u": "",
        "status --porcelain": "",
        "branch --show-current": fixture.branch,
        "rev-parse HEAD": fixture.lease.reviewHeadSha,
        "log -1 --pretty=%s": "x".repeat(73),
      };
      if (!(key in values)) throw new Error(`unexpected git command: ${key}`);
      return values[key];
    };
    try {
      assert.throws(() => entrypoint({
        invocationPath: repo,
        repo,
        gitText: earlyGitText,
        gitOptional: args => { mutations.push(["gitOptional", ...args]); return ""; },
        ghText: args => { mutations.push(["ghText", ...args]); return ""; },
        ghOptional: args => { mutations.push(["ghOptional", ...args]); return ""; },
        leaseStore: fixture.leaseStore,
        sessionId: fixture.lease.sessionId,
        run: (command, args) => mutations.push([command, ...args]),
      }), /exceeds 72 characters \(73\)/u);
      assert.deepEqual(mutations, []);
      assert.deepEqual(fixture.leaseStore.readRegistry(), before);
    } finally {
      rmSync(fixture.gitCommonDir, { recursive: true, force: true });
    }
  }
});

test("reviewed-lane lease_updated journals and projects the successor lease atomically", () => {
  const fixture = createReviewedLaneFenceFixture();
  const operationDigest = "3".repeat(64);
  const planDigest = "4".repeat(64);
  const expectedLeaseDigest = digestValue(fixture.lease);
  const identity = {
    leaseStore: fixture.leaseStore,
    branch: fixture.branch,
    entrypoint: "reviewed-lane-revision",
    operationDigest,
    expectedLeaseDigest,
    expectedClaimId: fixture.sourceClaimId,
    planDigest,
  };
  let fence;
  try {
    fence = acquireReviewedLaneEntrypointFence(identity);
    let journal = beginReviewedLaneRevisionIntent(identity);
    for (const phase of [
      "successor_waiting", "commit_created", "local_ref_updated", "remote_ref_updated",
      "source_retired", "successor_current", "successor_bound", "successor_review_ready",
    ]) {
      journal = advanceReviewedLaneRevisionIntent({
        ...identity,
        phase,
        evidenceDigest: digestValue({ phase }),
        expectedIntentDigest: journal.intentDigest,
      });
    }
    const successorClaimId = "5".repeat(64);
    const leaseProjection = {
      ...fixture.lease,
      fenceSha: "c".repeat(40),
      reviewHeadSha: "c".repeat(40),
      cloudAuthority: { claimId: successorClaimId },
    };
    const before = fixture.leaseStore.readRegistry();
    assert.throws(() => advanceReviewedLaneRevisionIntent({
      ...identity,
      phase: "lease_updated",
      evidenceDigest: "6".repeat(64),
      expectedIntentDigest: journal.intentDigest,
      values: { leaseProjection, leaseProjectionDigest: "0".repeat(64) },
    }), /projection digest is invalid/u);
    assert.deepEqual(fixture.leaseStore.readRegistry(), before);

    for (const [field, value] of Object.entries({
      epoch: fixture.lease.epoch + 1,
      baseSha: "d".repeat(40),
      admission: { ...fixture.lease.admission, declaredWriteSet: ["path:other.mjs"] },
      autoDelivery: true,
      acquiredAt: "2026-08-09T09:00:01.000Z",
      unrelatedProjection: "forbidden",
    })) {
      const driftedProjection = { ...leaseProjection, [field]: value };
      assert.throws(() => advanceReviewedLaneRevisionIntent({
        ...identity,
        phase: "lease_updated",
        evidenceDigest: digestValue({ field }),
        expectedIntentDigest: journal.intentDigest,
        leaseProjection: driftedProjection,
        values: {
          leaseProjection: driftedProjection,
          leaseProjectionDigest: digestValue(driftedProjection),
        },
      }), /changed (?:fields outside the authorized successor projection|the source lease field set)/u);
      assert.deepEqual(fixture.leaseStore.readRegistry(), before);
    }

    const { expiresAt: _removedExpiry, ...missingExpiryProjection } = leaseProjection;
    assert.throws(() => advanceReviewedLaneRevisionIntent({
      ...identity,
      phase: "lease_updated",
      evidenceDigest: digestValue({ missing: "expiresAt" }),
      expectedIntentDigest: journal.intentDigest,
      leaseProjection: missingExpiryProjection,
      values: {
        leaseProjection: missingExpiryProjection,
        leaseProjectionDigest: digestValue(missingExpiryProjection),
      },
    }), /changed the source lease field set/u);
    assert.deepEqual(fixture.leaseStore.readRegistry(), before);

    const leaseUpdateValues = {
      revisionIntent: {
        phases: {
          lease_updated: {
            values: { leaseProjection, leaseProjectionDigest: digestValue(leaseProjection) },
          },
        },
      },
    };
    journal = advanceReviewedLaneRevisionIntent({
      ...identity,
      phase: "lease_updated",
      evidenceDigest: "6".repeat(64),
      expectedIntentDigest: journal.intentDigest,
      leaseProjection,
      values: leaseUpdateValues,
    });
    const registry = fixture.leaseStore.readRegistry();
    assert.deepEqual(registry.leases[fixture.branch], leaseProjection);
    assert.equal(registry.reviewedLaneRevisionIntents[fixture.branch].intentDigest,
      journal.intentDigest);
    assert.equal(journal.currentLeaseDigest, digestValue(leaseProjection));
    assert.equal(journal.currentClaimId, successorClaimId);
    assert.equal(readReviewedLaneRevisionIntent({
      leaseStore: fixture.leaseStore,
      branch: fixture.branch,
    }).phase, "lease_updated");
    assertReviewedLaneEntrypointFence({ fence, leaseStore: fixture.leaseStore });
    const replayIdentity = { ...identity,
      expectedLeaseDigest: digestValue(leaseProjection), expectedClaimId: successorClaimId };
    assert.equal(advanceReviewedLaneRevisionIntent({
      ...replayIdentity, phase: "lease_updated", evidenceDigest: "6".repeat(64),
      expectedIntentDigest: journal.intentDigest, leaseProjection, values: leaseUpdateValues,
    }).intentDigest, journal.intentDigest);
    for (const [evidenceDigest, values] of [
      ["7".repeat(64), leaseUpdateValues],
      ["6".repeat(64), { ...leaseUpdateValues, replayDrift: true }],
    ]) {
      assert.throws(() => advanceReviewedLaneRevisionIntent({
        ...replayIdentity, phase: "lease_updated", evidenceDigest,
        expectedIntentDigest: journal.intentDigest, leaseProjection, values,
      }), /same-phase replay changed its evidence or values/u);
      assert.deepEqual(fixture.leaseStore.readRegistry(), registry);
    }
  } finally {
    if (fence) releaseReviewedLaneEntrypointFence(fence);
    rmSync(fixture.gitCommonDir, { recursive: true, force: true });
  }
});

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

test("review recovers an expired planned cloud-bound lane into review-ready authority", () => {
  const scope = "delivery-base-recovery-protected-source-advance";
  const branch = `agent/device/${scope}`;
  const pullRequestUrl = "https://github.test/pull/42";
  const headSha = "c".repeat(40);
  const declaredWriteSet = [
    "path:scripts/device-branch-lib.mjs",
    "semantic:runtime-leases",
  ];
  const writeSetDigest = digestValue(declaredWriteSet);
  let isDraft = true;
  let body = "";
  let annotateCount = 0;
  let firstAnnotateUsedAllowExpired = false;
  let readyVerificationHead = null;
  const gitText = createGitText({
    "worktree list --porcelain -z": branchWorktree(branch),
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "status --porcelain": "",
    "branch --show-current": `${branch}\n`,
    "rev-parse HEAD": headSha,
    [`merge-base --is-ancestor ${headSha} HEAD`]: "",
    "log -1 --pretty=%s": `chore(coordination): claim ${scope} lease 7\n`,
  });
  let lease = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 7,
    sessionId: "chat-a",
    device: "device",
    scope,
    branch,
    worktreePath: repo,
    baseSha: "a".repeat(40),
    fenceSha: headSha,
    pullRequestUrl,
    autoDelivery: false,
    runtimeRequired: false,
    heartbeatAt: "2026-08-06T08:22:43.384Z",
    expiresAt: "2026-08-06T08:40:33.000Z",
    admission: {
      schema: "agentic-lane-admission-lease/v1",
      status: "planned",
      semanticScope: "runtime-leases",
      declaredWriteSet,
      writeSetDigest,
      manifestDigest: "2".repeat(64),
      planReceiptDigest: "3".repeat(64),
      admissionReceiptDigest: "4".repeat(64),
      existingLaneStateDigest: "5".repeat(64),
    },
    cloudAuthority: {
      schema: "agentic-lane-cloud-authority/v1",
      provider: "github",
      ledgerRepository: "example/ledger",
      targetRepository: "example/repo",
      claimId: "6".repeat(64),
      claimDigest: "7".repeat(64),
      ledgerRevision: "8".repeat(40),
      ledgerDigest: "9".repeat(64),
      claimLedgerRevision: "a".repeat(64),
      entrySchema: "agentic-cloud-collaboration-entry/v2",
      claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
      operationReceiptDigest: "b".repeat(64),
      mutationAuthorityEligible: true,
      canonicalBaseSha: "a".repeat(40),
      laneRevision: headSha,
      cloudDeclaredWriteScope: declaredWriteSet,
      writeSetDigest,
      deviceId: "device",
      sessionId: "chat-a",
      reviewRequestId: "github-pull-request:PR_42",
      leaseEpoch: 1,
      transitionCounter: 4,
      state: "active",
      expiresAt: "2026-08-06T09:05:47.000Z",
      manifestDigest: "2".repeat(64),
    },
  };
  body = renderWriterLeasePullRequestBody(lease);

  const result = review({
    invocationPath: repo,
    repo,
    sessionId: "chat-a",
    gitText,
    gitOptional: args => {
      const key = args.join(" ");
      if (key === `ls-remote --heads origin refs/heads/${branch}`) {
        return `${headSha}\trefs/heads/${branch}`;
      }
      return "";
    },
    ghText: args => {
      if (args[1] === "list") {
        return JSON.stringify([{ number: 42, headRefName: branch, url: pullRequestUrl }]);
      }
      return pullJson(pullRequestUrl, branch, body, isDraft);
    },
    ghOptional: () => pullRequestUrl,
    leaseStore: {
      read: requested => requested === branch ? lease : null,
      verify: () => {
        throw new Error("Writer lease expired at 2026-08-06T08:40:33.000Z; renew or hand off before mutation.");
      },
      annotate: ({ allowExpired = false, values }) => {
        annotateCount += 1;
        if (annotateCount === 1) firstAnnotateUsedAllowExpired = allowExpired;
        lease = { ...lease, ...values };
        return lease;
      },
      release: ({ status }) => {
        lease = { ...lease, status };
        return lease;
      },
    },
    heartbeatCloudAuthority: ({ authority }) => ({
      authority: {
        ...authority,
        claimDigest: "c".repeat(64),
        ledgerRevision: "d".repeat(40),
        ledgerDigest: "e".repeat(64),
        claimLedgerRevision: "f".repeat(64),
        transitionCounter: 5,
        expiresAt: "2099-08-06T09:05:47.000Z",
      },
      verification: {
        verifiedAt: "2026-08-06T08:45:00.000Z",
        receiptDigest: "0".repeat(64),
      },
    }),
    reconcileCloudAuthority: ({ authority }) => ({
      authority: {
        ...authority,
        laneRevision: headSha,
        reviewRequestId: "github-pull-request:PR_42",
        state: "active",
      },
      verification: markOperationDerivedCloudVerification({
        schema: "agentic-lane-cloud-verification/v1",
        status: "ready",
        claimId: authority.claimId,
        claimDigest: authority.claimDigest,
        ledgerRevision: authority.ledgerRevision,
        ledgerDigest: authority.ledgerDigest,
        canonicalBaseSha: authority.canonicalBaseSha,
        laneRevision: headSha,
        writeSetDigest: authority.writeSetDigest,
        reviewRequestId: "github-pull-request:PR_42",
        remoteClaimInventoryDigest: "1".repeat(64),
        inventory: {
          schema: "agentic-cloud-claim-inventory/v1",
          inventoryDigest: "1".repeat(64),
          observedLedgerHeadRevision: authority.ledgerRevision,
          ledgerDigest: authority.ledgerDigest,
          claims: [{
            claimId: authority.claimId,
            state: "active",
            actorId: "github-user:1",
            entrySchema: authority.entrySchema,
            claimIdentitySchema: authority.claimIdentitySchema,
            operationReceiptDigest: authority.operationReceiptDigest,
            mutationAuthorityEligible: authority.mutationAuthorityEligible,
            repositoryId: "github-repository:1",
            workItemId: "work-item:1",
            canonicalBaseRevision: authority.canonicalBaseSha,
            laneRevision: headSha,
            declaredWriteScope: declaredWriteSet,
            writeSetDigest,
            leaseEpoch: authority.leaseEpoch,
            transitionCounter: authority.transitionCounter,
            reviewRequestId: "github-pull-request:PR_42",
            expiresAt: authority.expiresAt,
            fenceRevision: authority.claimDigest,
            transitionDigest: authority.claimLedgerRevision,
          }],
        },
        verifiedAt: "2026-08-06T08:45:01.000Z",
        receiptDigest: "1".repeat(64),
      }),
    }),
    reviewReadyCloudAuthority: ({ authority }) => ({
      authority: {
        ...authority,
        laneRevision: headSha,
        state: "review_ready",
        reviewRequestId: "github-pull-request:PR_42",
      },
    }),
    verifyReviewReadyCloudAuthority: ({ authority, headSha: verifiedHead }) => {
      readyVerificationHead = verifiedHead;
      return { authority };
    },
    run: (command, args) => {
      if (command === "gh" && args[0] === "pr" && args[1] === "ready") {
        isDraft = false;
      }
      const bodyIndex = args.indexOf("--body");
      if (command === "gh" && bodyIndex >= 0) {
        body = args[bodyIndex + 1];
      }
    },
    log: () => {},
  });

  assert.equal(result, pullRequestUrl);
  assert.equal(firstAnnotateUsedAllowExpired, true);
  assert.equal(lease.admission.status, "admitted");
  assert.equal(lease.cloudAuthority.state, "review_ready");
  assert.equal(lease.status, "review_ready");
  assert.equal(readyVerificationHead, null);
});

test("review adopts an exact current root-source cloud claim before bootstrapping a duplicate", () => {
  const branch = "agent/device/runtime-leases";
  const pullRequestUrl = "https://github.test/pull/42";
  const canonicalBaseSha = "a".repeat(40);
  const headSha = "c".repeat(40);
  const declaredPaths = [
    "__tests__/device-branch-lib.test.mjs",
    "scripts/device-branch-lib.mjs",
  ];
  const declaredWriteSet = [
    "path:__tests__/device-branch-lib.test.mjs",
    "path:scripts/device-branch-lib.mjs",
    "semantic:runtime-leases",
  ];
  const writeSetDigest = digestValue(declaredWriteSet);
  let isDraft = true;
  let body = "";
  let inspectCount = 0;
  let firstAnnotateUsedAllowExpired = false;
  let annotateCount = 0;
  const gitText = createGitText({
    "worktree list --porcelain -z": branchWorktree(branch),
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "status --porcelain": "",
    "branch --show-current": `${branch}\n`,
    "rev-parse HEAD": headSha,
    "rev-parse origin/main": canonicalBaseSha,
    [`diff --name-only ${canonicalBaseSha}..${headSha} --`]:
      `${declaredPaths.join("\n")}\n`,
    [`merge-base --is-ancestor ${headSha} HEAD`]: "",
    "log -1 --pretty=%s": "fix: recover planned review authority\n",
  });
  let lease = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 7,
    sessionId: "chat-a",
    device: "device",
    scope: "runtime-leases",
    branch,
    worktreePath: repo,
    baseSha: canonicalBaseSha,
    fenceSha: headSha,
    pullRequestUrl,
    autoDelivery: false,
    runtimeRequired: false,
    heartbeatAt: "2026-08-06T08:22:43.384Z",
    expiresAt: "2026-08-06T08:40:33.000Z",
  };
  body = renderWriterLeasePullRequestBody(lease);

  const result = review({
    invocationPath: repo,
    repo,
    sessionId: "chat-a",
    gitText,
    gitOptional: args => {
      const key = args.join(" ");
      if (key === "config --get remote.origin.url") {
        return "https://github.com/huijoohwee/agentic-canvas-os.git";
      }
      if (key === `ls-remote --heads origin refs/heads/${branch}`) {
        return `${headSha}\trefs/heads/${branch}`;
      }
      return "";
    },
    ghText: args => {
      if (args[1] === "list") {
        return JSON.stringify([{ number: 42, headRefName: branch, url: pullRequestUrl }]);
      }
      if (args[1] === "view" && args.includes("--jq")) {
        return body;
      }
      return pullJson(pullRequestUrl, branch, body, isDraft, "OPEN", canonicalBaseSha);
    },
    ghOptional: () => pullRequestUrl,
    leaseStore: {
      read: requested => requested === branch ? lease : null,
      verify: () => {
        throw new Error("Writer lease expired at 2026-08-06T08:40:33.000Z; renew or hand off before mutation.");
      },
      annotate: ({ allowExpired = false, values }) => {
        annotateCount += 1;
        if (annotateCount === 1) firstAnnotateUsedAllowExpired = allowExpired;
        lease = { ...lease, ...values };
        return lease;
      },
      release: ({ status }) => {
        lease = { ...lease, status };
        return lease;
      },
    },
    inspectCloudStatus: ({ action, ledgerRepository, request }) => {
      inspectCount += 1;
      assert.equal(action, "status");
      assert.equal(ledgerRepository, "huijoohwee/agentic-canvas-os");
      assert.deepEqual(request, { targetRepository: "huijoohwee/agentic-canvas-os" });
      return {
        schema: "agentic-cloud-collaboration-result/v1",
        ok: true,
        action: "status",
        status: "ready",
        ledgerRevision: "d".repeat(40),
        ledgerDigest: "e".repeat(64),
        claims: [{
          claimId: "6".repeat(64),
          entrySchema: "agentic-cloud-collaboration-entry/v2",
          claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
          state: "current",
          actorId: "github-user:1",
          repositoryId: "github-repository:1",
          workItemId: "work-item:1",
          canonicalBaseRevision: canonicalBaseSha,
          laneRevision: canonicalBaseSha,
          declaredWriteScope: declaredWriteSet,
          writeSetDigest,
          leaseEpoch: 1,
          transitionCounter: 2,
          reviewRequestId: null,
          expiresAt: "2099-08-06T09:05:47.000Z",
          fenceRevision: "7".repeat(64),
          transitionDigest: "8".repeat(64),
          operationReceiptDigest: "9".repeat(64),
          integrationReceiptDigest: null,
          integration: null,
        }],
      };
    },
    heartbeatCloudAuthority: ({ authority }) => ({
      authority: {
        ...authority,
        claimDigest: "a".repeat(64),
        ledgerRevision: "b".repeat(40),
        ledgerDigest: "c".repeat(64),
        claimLedgerRevision: "d".repeat(64),
        transitionCounter: authority.transitionCounter + 1,
        expiresAt: "2099-08-06T09:45:00.000Z",
      },
      verification: {
        verifiedAt: "2026-08-06T08:44:30.000Z",
        receiptDigest: "e".repeat(64),
      },
    }),
    verifyActiveCloudAuthority: ({ authority, manifest, canonicalBaseSha: verifiedBaseSha }) => {
      assert.equal(authority.claimId, "6".repeat(64));
      assert.equal(authority.laneRevision, canonicalBaseSha);
      assert.equal(manifest.writeSetDigest, writeSetDigest);
      assert.equal(verifiedBaseSha, canonicalBaseSha);
      return {
        authority,
        verification: {
          receiptDigest: "1".repeat(64),
          verifiedAt: "2026-08-06T08:45:00.000Z",
        },
      };
    },
    reconcileCloudAuthority: ({ authority }) => ({
      authority,
      verification: markOperationDerivedCloudVerification({
        schema: "agentic-lane-cloud-verification/v1",
        status: "ready",
        claimId: authority.claimId,
        claimDigest: authority.claimDigest,
        ledgerRevision: authority.ledgerRevision,
        ledgerDigest: authority.ledgerDigest,
        canonicalBaseSha: authority.canonicalBaseSha,
        laneRevision: authority.laneRevision,
        writeSetDigest: authority.writeSetDigest,
        reviewRequestId: authority.reviewRequestId,
        remoteClaimInventoryDigest: "2".repeat(64),
        inventory: {
          schema: "agentic-cloud-claim-inventory/v1",
          inventoryDigest: "2".repeat(64),
          observedLedgerHeadRevision: authority.ledgerRevision,
          ledgerDigest: authority.ledgerDigest,
          claims: [],
        },
        verifiedAt: "2026-08-06T08:45:01.000Z",
        receiptDigest: "3".repeat(64),
      }),
    }),
    reviewReadyCloudAuthority: ({ authority }) => ({
      authority: {
        ...authority,
        laneRevision: headSha,
        state: "review_ready",
        reviewRequestId: "github-pull-request:PR_42",
      },
    }),
    verifyReviewReadyCloudAuthority: ({ authority }) => ({ authority }),
    claimLegacyReviewCloudAuthority: () => {
      throw new Error("review should adopt the exact current claim before bootstrapping");
    },
    run: (command, args) => {
      if (command === "gh" && args[0] === "pr" && args[1] === "ready") {
        isDraft = false;
      }
      const bodyIndex = args.indexOf("--body");
      if (command === "gh" && bodyIndex >= 0) {
        body = args[bodyIndex + 1];
      }
    },
    log: () => {},
  });

  assert.equal(result, pullRequestUrl);
  assert.equal(inspectCount, 1);
  assert.equal(firstAnnotateUsedAllowExpired, true);
  assert.equal(lease.admission.status, "admitted");
  assert.equal(lease.cloudAuthority.state, "review_ready");
  assert.equal(lease.status, "review_ready");
});

test("review upgrades a resumed legacy root-source ready lane using authored paths from main diff", () => {
  const branch = "agent/device/merged-no-lease-completion";
  const pullRequestUrl = "https://github.test/pull/288";
  const reviewHeadSha = "c".repeat(40);
  const canonicalBaseSha = "a".repeat(40);
  const livePullRequestBaseSha = "d".repeat(40);
  let pullRequestBody = renderWriterLeasePullRequestBody({
    schema: "agentic-writer-lease/v2",
    status: "review_ready",
    epoch: 172,
    sessionId: "chat-a",
    device: "device",
    scope: "merged-no-lease-completion",
    branch,
    baseSha: reviewHeadSha,
    fenceSha: "b".repeat(40),
    autoDelivery: false,
    runtimeRequired: false,
    heartbeatAt: "2026-08-06T05:38:23.089Z",
    expiresAt: "2026-08-06T05:38:23.089Z",
    reviewHeadSha,
  });
  let annotatedLease = null;
  let claimedManifest = null;
  let claimedCanonicalBaseSha = null;
  let verifiedHead = null;
  const gitText = createGitText({
    "worktree list --porcelain -z": branchWorktree(branch),
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "status --porcelain": "",
    "branch --show-current": `${branch}\n`,
    "rev-parse HEAD": reviewHeadSha,
    "rev-parse origin/main": canonicalBaseSha,
    [`diff --name-only ${reviewHeadSha}..${reviewHeadSha} --`]: "",
    [`diff --name-only origin/main...${reviewHeadSha} --`]:
      "__tests__/writer-lease-lib.test.mjs\nscripts/device-complete-lib.mjs\nscripts/writer-lease-lib.mjs\n",
    [`merge-base --is-ancestor ${"b".repeat(40)} HEAD`]: "",
    "log -1 --pretty=%s": "fix: recover merged worktrees without lease markers\n",
  });
  const baseLease = {
    schema: "agentic-writer-lease/v2",
    status: "review_ready",
    epoch: 172,
    sessionId: "chat-a",
    device: "device",
    scope: "merged-no-lease-completion",
    branch,
    worktreePath: repo,
    baseSha: reviewHeadSha,
    fenceSha: "b".repeat(40),
    pullRequestUrl,
    autoDelivery: false,
    runtimeRequired: false,
    heartbeatAt: "2026-08-06T05:38:23.089Z",
    expiresAt: "2026-08-06T05:38:23.089Z",
    reviewHeadSha,
  };
  const leaseStore = {
    read: requested => requested === branch ? (annotatedLease || baseLease) : null,
    annotate: ({ values }) => (annotatedLease = { ...(annotatedLease || baseLease), ...values }),
  };

  const result = review({
    invocationPath: repo,
    repo,
    gitText,
    gitOptional: args => {
      const key = args.join(" ");
      if (key === "config --get remote.origin.url") {
        return "https://github.com/huijoohwee/agentic-canvas-os.git";
      }
      if (key === `ls-remote --heads origin refs/heads/${branch}`) {
        return `${reviewHeadSha}\trefs/heads/${branch}`;
      }
      return "";
    },
    ghText: args => {
      if (args[1] === "list") {
        return JSON.stringify([{ number: 288, headRefName: branch, url: pullRequestUrl }]);
      }
      if (args[1] === "view" && args.includes("--jq")) {
        return pullRequestBody;
      }
        return pullJson(pullRequestUrl, branch, pullRequestBody, false, "OPEN", livePullRequestBaseSha);
    },
    ghOptional: () => pullRequestUrl,
    leaseStore,
    sessionId: "chat-a",
    claimLegacyReviewCloudAuthority: input => {
      claimedManifest = input.manifest;
        claimedCanonicalBaseSha = input.canonicalBaseSha;
      return {
        authority: {
          schema: "agentic-lane-cloud-authority/v1",
          provider: "github",
          ledgerRepository: "huijoohwee/agentic-canvas-os",
          targetRepository: "huijoohwee/agentic-canvas-os",
          claimId: "1".repeat(64),
          claimDigest: "2".repeat(64),
          ledgerRevision: "3".repeat(40),
          claimLedgerRevision: "4".repeat(64),
          operationReceiptDigest: "5".repeat(64),
          mutationAuthorityEligible: true,
            canonicalBaseSha: input.canonicalBaseSha,
          laneRevision: reviewHeadSha,
          cloudDeclaredWriteScope: input.manifest.declaredWriteSet,
          writeSetDigest: input.manifest.writeSetDigest,
          deviceId: "device",
          sessionId: "chat-a",
          reviewRequestId: null,
          leaseEpoch: 1,
          transitionCounter: 1,
          state: "active",
          expiresAt: "2099-08-06T05:38:23.089Z",
          manifestDigest: input.manifest.manifestDigest,
        },
        verification: {
          receiptDigest: "6".repeat(64),
        },
      };
    },
    reviewReadyCloudAuthority: ({ authority, headSha }) => ({
      authority: {
        ...authority,
        laneRevision: headSha,
        state: "review_ready",
        reviewRequestId: "github-pull-request:PR_288",
      },
    }),
    verifyReviewReadyCloudAuthority: ({ authority, headSha }) => {
      verifiedHead = headSha;
      return { authority };
    },
    run: (command, args) => {
      const bodyIndex = args.indexOf("--body");
      if (command === "gh" && args[1] === "pr" && args[2] === "edit" && bodyIndex >= 0) {
        pullRequestBody = args[bodyIndex + 1];
      }
    },
    log: () => {},
  });

  assert.equal(result, pullRequestUrl);
  assert.deepEqual(claimedManifest.paths, [
    "__tests__/writer-lease-lib.test.mjs",
    "scripts/device-complete-lib.mjs",
    "scripts/writer-lease-lib.mjs",
  ]);
  assert.equal(claimedCanonicalBaseSha, livePullRequestBaseSha);
  assert.equal(verifiedHead, reviewHeadSha);
  assert.equal(annotatedLease.admission.status, "admitted");
  assert.equal(annotatedLease.cloudAuthority.state, "review_ready");
});

test("review refreshes a stale cloud base while deriving scope from the preserved base when live base diverges", () => {
  const branch = "agent/device/merged-no-lease-completion";
  const pullRequestUrl = "https://github.test/pull/288";
  const staleCanonicalBaseSha = "a".repeat(40);
  const livePullRequestBaseSha = "d".repeat(40);
  const fenceSha = "b".repeat(40);
  const reviewHeadSha = "c".repeat(40);
  let isDraft = true;
  let pullRequestBody = renderWriterLeasePullRequestBody({
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 173,
    sessionId: "chat-a",
    device: "device",
    scope: "merged-no-lease-completion",
    branch,
    baseSha: "9".repeat(40),
    fenceSha,
    pullRequestUrl,
    autoDelivery: false,
    runtimeRequired: false,
    heartbeatAt: "2026-08-06T05:47:42.108Z",
    expiresAt: "2099-08-06T06:17:42.108Z",
  });
  let lease = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 173,
    sessionId: "chat-a",
    device: "device",
    scope: "merged-no-lease-completion",
    branch,
    worktreePath: repo,
    baseSha: "9".repeat(40),
    fenceSha,
    pullRequestUrl,
    autoDelivery: false,
    runtimeRequired: false,
    heartbeatAt: "2026-08-06T05:47:42.108Z",
    expiresAt: "2099-08-06T06:17:42.108Z",
    admission: {
      schema: "agentic-lane-admission-lease/v1",
      status: "admitted",
      semanticScope: "merged-no-lease-completion",
      declaredWriteSet: [
        "path:scripts/device-branch-lib.mjs",
        "semantic:merged-no-lease-completion",
      ],
      writeSetDigest: "1".repeat(64),
      manifestDigest: "2".repeat(64),
      planReceiptDigest: "3".repeat(64),
      admissionReceiptDigest: "4".repeat(64),
      existingLaneStateDigest: "5".repeat(64),
      admittedReportDigest: "6".repeat(64),
      preservationReceiptDigest: "7".repeat(64),
    },
    cloudAuthority: {
      schema: "agentic-lane-cloud-authority/v1",
      provider: "github",
      ledgerRepository: "huijoohwee/agentic-canvas-os",
      targetRepository: "huijoohwee/agentic-canvas-os",
      claimId: "8".repeat(64),
      claimDigest: "9".repeat(64),
      ledgerRevision: "e".repeat(40),
      claimLedgerRevision: "f".repeat(64),
      operationReceiptDigest: "0".repeat(64),
      mutationAuthorityEligible: true,
      canonicalBaseSha: staleCanonicalBaseSha,
      laneRevision: fenceSha,
      cloudDeclaredWriteScope: [
        "path:scripts/device-branch-lib.mjs",
        "semantic:merged-no-lease-completion",
      ],
      writeSetDigest: "1".repeat(64),
      deviceId: "device",
      sessionId: "chat-a",
      reviewRequestId: null,
      leaseEpoch: 173,
      transitionCounter: 1,
      state: "active",
      expiresAt: "2099-08-06T06:17:42.108Z",
      manifestDigest: "2".repeat(64),
    },
  };
  let refreshedCanonicalBaseSha = null;
  const gitCalls = [];
  const fixtureGitText = createGitText({
    "worktree list --porcelain -z": branchWorktree(branch),
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "status --porcelain": "",
    "branch --show-current": `${branch}\n`,
    "rev-parse HEAD": reviewHeadSha,
    "rev-parse origin/main": staleCanonicalBaseSha,
    [`diff --name-only ${"9".repeat(40)}..${reviewHeadSha} --`]:
      "scripts/device-branch-lib.mjs\n__tests__/device-branch-lib.test.mjs\n",
    [`merge-base --is-ancestor ${fenceSha} HEAD`]: "",
    "log -1 --pretty=%s": "fix: bind legacy review admission to live PR base\n",
  });
  const gitText = args => {
    gitCalls.push(args.join(" "));
    if (args.join(" ") === `merge-base --is-ancestor ${livePullRequestBaseSha} ${reviewHeadSha}`) {
      throw new Error("live pull-request base is not an ancestor of the preserved review head");
    }
    return fixtureGitText(args);
  };

  const result = review({
    invocationPath: repo,
    repo,
    gitText,
    gitOptional: args => {
      const key = args.join(" ");
      if (key === "config --get remote.origin.url") {
        return "https://github.com/huijoohwee/agentic-canvas-os.git";
      }
      return "";
    },
    ghText: args => {
      if (args[1] === "list") {
        return JSON.stringify([{ number: 288, headRefName: branch, url: pullRequestUrl }]);
      }
      if (args[1] === "view" && args.includes("--jq")) {
        return pullRequestBody;
      }
      return pullJson(pullRequestUrl, branch, pullRequestBody, isDraft, "OPEN", livePullRequestBaseSha);
    },
    ghOptional: () => pullRequestUrl,
    leaseStore: {
      read: requested => requested === branch ? lease : null,
      verify: () => lease,
      annotate: ({ values }) => (lease = { ...lease, ...values }),
      release: ({ status }) => (lease = { ...lease, status }),
    },
    sessionId: "chat-a",
    reconcileCloudAuthority: ({ authority }) => ({
      authority,
      verification: { receiptDigest: "a".repeat(64) },
    }),
    claimLegacyReviewCloudAuthority: input => {
      refreshedCanonicalBaseSha = input.canonicalBaseSha;
      return {
        authority: {
          ...lease.cloudAuthority,
          claimId: "b".repeat(64),
          claimDigest: "c".repeat(64),
          ledgerRevision: "d".repeat(40),
          claimLedgerRevision: "e".repeat(64),
          operationReceiptDigest: "f".repeat(64),
          canonicalBaseSha: input.canonicalBaseSha,
          laneRevision: fenceSha,
          cloudDeclaredWriteScope: input.manifest.declaredWriteSet,
          writeSetDigest: input.manifest.writeSetDigest,
          manifestDigest: input.manifest.manifestDigest,
        },
        verification: {
          receiptDigest: "1".repeat(64),
        },
      };
    },
    reviewReadyCloudAuthority: ({ authority, headSha }) => ({
      authority: {
        ...authority,
        canonicalBaseSha: livePullRequestBaseSha,
        laneRevision: headSha,
        state: "review_ready",
        reviewRequestId: "github-pull-request:PR_288",
      },
    }),
    verifyReviewReadyCloudAuthority: ({ authority }) => ({ authority }),
    run: (command, args) => {
      if (command === "gh" && args[0] === "pr" && args[1] === "ready") {
        isDraft = false;
      }
      const bodyIndex = args.indexOf("--body");
      if (command === "gh" && args[1] === "pr" && args[2] === "edit" && bodyIndex >= 0) {
        pullRequestBody = args[bodyIndex + 1];
      }
    },
    log: () => {},
  });

  assert.equal(result, pullRequestUrl);
  assert.equal(refreshedCanonicalBaseSha, livePullRequestBaseSha);
  assert.ok(gitCalls.includes(
    `diff --name-only ${"9".repeat(40)}..${reviewHeadSha} --`,
  ));
  assert.ok(!gitCalls.includes(
    `diff --name-only ${livePullRequestBaseSha}..${reviewHeadSha} --`,
  ));
  assert.equal(lease.cloudAuthority.canonicalBaseSha, livePullRequestBaseSha);
  assert.equal(lease.cloudAuthority.state, "review_ready");
});

test("review refreshes an expired admitted active lane with allowExpired recovery annotations", () => {
  const branch = "agent/device/merged-no-lease-completion";
  const pullRequestUrl = "https://github.test/pull/288";
  const staleCanonicalBaseSha = "a".repeat(40);
  const livePullRequestBaseSha = "d".repeat(40);
  const fenceSha = "b".repeat(40);
  const reviewHeadSha = "c".repeat(40);
  let isDraft = true;
  let pullRequestBody = renderWriterLeasePullRequestBody({
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 173,
    sessionId: "chat-a",
    device: "device",
    scope: "merged-no-lease-completion",
    branch,
    baseSha: "9".repeat(40),
    fenceSha,
    pullRequestUrl,
    autoDelivery: false,
    runtimeRequired: false,
    heartbeatAt: "2026-08-06T05:47:42.108Z",
    expiresAt: "2026-08-06T06:17:42.108Z",
  });
  let annotateCount = 0;
  let lease = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 173,
    sessionId: "chat-a",
    device: "device",
    scope: "merged-no-lease-completion",
    branch,
    worktreePath: repo,
    baseSha: "9".repeat(40),
    fenceSha,
    pullRequestUrl,
    autoDelivery: false,
    runtimeRequired: false,
    heartbeatAt: "2026-08-06T05:47:42.108Z",
    expiresAt: "2026-08-06T06:17:42.108Z",
    admission: {
      schema: "agentic-lane-admission-lease/v1",
      status: "admitted",
      semanticScope: "merged-no-lease-completion",
      declaredWriteSet: [
        "path:scripts/device-branch-lib.mjs",
        "semantic:merged-no-lease-completion",
      ],
      writeSetDigest: "1".repeat(64),
      manifestDigest: "2".repeat(64),
      planReceiptDigest: "3".repeat(64),
      admissionReceiptDigest: "4".repeat(64),
      existingLaneStateDigest: "5".repeat(64),
      admittedReportDigest: "6".repeat(64),
      preservationReceiptDigest: "7".repeat(64),
    },
    cloudAuthority: {
      schema: "agentic-lane-cloud-authority/v1",
      provider: "github",
      ledgerRepository: "huijoohwee/agentic-canvas-os",
      targetRepository: "huijoohwee/agentic-canvas-os",
      claimId: "8".repeat(64),
      claimDigest: "9".repeat(64),
      ledgerRevision: "e".repeat(40),
      claimLedgerRevision: "f".repeat(64),
      operationReceiptDigest: "0".repeat(64),
      mutationAuthorityEligible: true,
      canonicalBaseSha: staleCanonicalBaseSha,
      laneRevision: fenceSha,
      cloudDeclaredWriteScope: [
        "path:scripts/device-branch-lib.mjs",
        "semantic:merged-no-lease-completion",
      ],
      writeSetDigest: "1".repeat(64),
      deviceId: "device",
      sessionId: "chat-a",
      reviewRequestId: null,
      leaseEpoch: 173,
      transitionCounter: 1,
      state: "active",
      expiresAt: "2099-08-06T06:17:42.108Z",
      manifestDigest: "2".repeat(64),
    },
  };
  lease.taskAuthority = createTaskAuthorityBinding({
    capability: createTaskAuthorityCapability({
      authoritySubjectId: `urn:agentic-task:${"a".repeat(64)}`,
      issuedAt: "2026-08-06T05:47:42.108Z",
    }),
    lease,
    bindingMode: "continuation",
    boundAt: "2026-08-06T05:47:42.108Z",
    priorBindingDigest: "3".repeat(64),
  });
  const gitText = createGitText({
    "worktree list --porcelain -z": branchWorktree(branch),
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "status --porcelain": "",
    "branch --show-current": `${branch}\n`,
    "rev-parse HEAD": reviewHeadSha,
    "rev-parse origin/main": staleCanonicalBaseSha,
    [`diff --name-only ${"9".repeat(40)}..${reviewHeadSha} --`]:
      "scripts/device-branch-lib.mjs\n__tests__/device-branch-lib.test.mjs\n",
    [`diff --name-only ${livePullRequestBaseSha}..${reviewHeadSha} --`]:
      "scripts/device-branch-lib.mjs\n__tests__/device-branch-lib.test.mjs\n",
    [`merge-base --is-ancestor ${fenceSha} HEAD`]: "",
    "log -1 --pretty=%s": "fix: bind legacy review admission to live PR base\n",
  });

  const result = review({
    invocationPath: repo,
    repo,
    gitText,
    gitOptional: args => {
      const key = args.join(" ");
      if (key === "config --get remote.origin.url") {
        return "https://github.com/huijoohwee/agentic-canvas-os.git";
      }
      return "";
    },
    ghText: args => {
      if (args[1] === "list") {
        return JSON.stringify([{ number: 288, headRefName: branch, url: pullRequestUrl }]);
      }
      if (args[1] === "view" && args.includes("--jq")) {
        return pullRequestBody;
      }
      return pullJson(pullRequestUrl, branch, pullRequestBody, isDraft, "OPEN", livePullRequestBaseSha);
    },
    ghOptional: () => pullRequestUrl,
    leaseStore: {
      read: requested => requested === branch ? lease : null,
      verify: () => {
        throw new Error("Writer lease expired at 2026-08-06T06:17:42.108Z; renew or hand off before mutation.");
      },
      annotate: ({ allowExpired = false, values }) => {
        annotateCount += 1;
        assert.equal(allowExpired, true);
        lease = { ...lease, ...values };
        return lease;
      },
      release: ({ status }) => (lease = { ...lease, status }),
    },
    sessionId: "chat-a",
    reconcileCloudAuthority: ({ authority, headSha }) => ({
      authority: {
        ...authority,
        laneRevision: headSha,
      },
      verification: markOperationDerivedCloudVerification({
        schema: "agentic-lane-cloud-verification/v1",
        status: "ready",
        claimId: authority.claimId,
        claimDigest: authority.claimDigest,
        ledgerRevision: authority.ledgerRevision,
        ledgerDigest: authority.ledgerDigest,
        canonicalBaseSha: authority.canonicalBaseSha,
        laneRevision: headSha,
        writeSetDigest: authority.writeSetDigest,
        reviewRequestId: authority.reviewRequestId,
        remoteClaimInventoryDigest: "a".repeat(64),
        inventory: {
          schema: "agentic-cloud-claim-inventory/v1",
          inventoryDigest: "a".repeat(64),
          observedLedgerHeadRevision: authority.ledgerRevision,
          ledgerDigest: authority.ledgerDigest,
          claims: [],
        },
        verifiedAt: "2026-08-06T08:45:01.000Z",
        receiptDigest: "b".repeat(64),
      }),
    }),
    claimLegacyReviewCloudAuthority: () => {
      throw new Error("task-authority review recovery should not use legacy root-source refresh");
    },
    reviewReadyCloudAuthority: ({ authority, headSha }) => ({
      authority: {
        ...authority,
        laneRevision: headSha,
        state: "review_ready",
        reviewRequestId: "github-pull-request:PR_288",
      },
    }),
    verifyReviewReadyCloudAuthority: ({ authority }) => ({ authority }),
    run: (command, args) => {
      if (command === "gh" && args[0] === "pr" && args[1] === "ready") {
        isDraft = false;
      }
      const bodyIndex = args.indexOf("--body");
      if (command === "gh" && args[1] === "pr" && args[2] === "edit" && bodyIndex >= 0) {
        pullRequestBody = args[bodyIndex + 1];
      }
    },
    log: () => {},
  });

  assert.equal(result, pullRequestUrl);
  assert.ok(annotateCount >= 2);
  assert.equal(lease.cloudAuthority.canonicalBaseSha, staleCanonicalBaseSha);
  assert.equal(lease.cloudAuthority.state, "review_ready");
  assert.equal(lease.status, "review_ready");
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

test("publish refreshes a stale active admission to the live pull-request base", () => {
  const source = readFileSync(new URL("../scripts/device-branch-lib.mjs", import.meta.url), "utf8");
  const publishBody = source.slice(source.indexOf("function publishUnfenced"),
    source.indexOf("function resolvePublishHeadTreeSha"));
  assert.match(publishBody, /maybeRefreshLegacyRootSourceReviewAdmission/u);
  assert.match(publishBody, /claimLegacyReviewCloudAuthority/u);
  assert.match(publishBody, /Refreshed active delivery admission for live PR base/u);
  assert.ok(publishBody.indexOf('run("git", ["push"')
    < publishBody.indexOf("maybeRefreshLegacyRootSourceReviewAdmission"));
  assert.ok(publishBody.indexOf("requirePullRequestHead")
    < publishBody.indexOf("maybeRefreshLegacyRootSourceReviewAdmission"));
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
