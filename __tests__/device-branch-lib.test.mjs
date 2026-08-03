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
const pullJson = (url, branch, body = "", isDraft = true) => JSON.stringify({
  url, state: "OPEN", isDraft, headRefName: branch,
  headRefOid: "c".repeat(40), baseRefName: "main", body,
});

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
  });
  let releaseStatus = null;
  let isDraft = true;

  const result = publish({
    invocationPath: repo,
    repo,
    gitText,
    ghText: args => args[1] === "list"
      ? JSON.stringify([{ number: 1, headRefName: branch, url: pullRequestUrl }])
      : args.includes("--jq") ? "" : pullJson(pullRequestUrl, branch, "", isDraft),
    ghOptional: () => pullRequestUrl,
    leaseStore: {
      verify: () => ({
        branch, fenceSha: "b".repeat(40), pullRequestUrl, worktreePath: repo,
        device: "device",
        admission: { schema: "agentic-lane-admission-lease/v1", status: "admitted" },
        cloudAuthority: {
          schema: "agentic-lane-cloud-authority/v1",
          state: "active",
          canonicalBaseSha: "a".repeat(40),
        },
      }),
      annotate: () => ({ branch, fenceSha: "b".repeat(40), pullRequestUrl, worktreePath: repo }),
      release: ({ status }) => {
        releaseStatus = status;
        return {
          schema: "agentic-writer-lease/v2",
          status,
          epoch: 1,
          sessionId: "chat-a",
          device: "device",
          scope: "runtime-leases",
          branch,
          baseSha: "a".repeat(40),
          fenceSha: "b".repeat(40),
          heartbeatAt: "2026-07-17T10:00:00.000Z",
          expiresAt: "2026-07-17T10:00:00.000Z",
        };
      },
    },
    sessionId: "chat-a",
    reviewReadyCloudAuthority: ({ authority }) => ({
      authority: { ...authority, state: "review_ready" },
    }),
    authorizeCloudDelivery: ({ authority }) => ({
      authority: { ...authority, state: "delivery_authorized" },
    }),
    verifyCloudAuthority: () => ({ ok: true }),
    run: (command, args) => {
      calls.push([command, ...args]); if (command === "gh" && args[1] === "ready") isDraft = false;
    },
    log: () => {},
  });

  assert.equal(result, pullRequestUrl);
  assert.deepEqual(calls[0], ["git", "merge-base", "--is-ancestor", "b".repeat(40), "HEAD"]);
  assert.ok(calls.some(call => call[0] === "gh" && call[1] === "pr" && call[2] === "ready"));
  assert.equal(releaseStatus, "delivery");
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
