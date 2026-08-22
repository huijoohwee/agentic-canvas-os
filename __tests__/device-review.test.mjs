import test from "node:test";
import assert from "node:assert/strict";
import { heartbeat, park, resume, review } from "../scripts/device-branch-lib.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { markOperationDerivedCloudVerification } from "../scripts/scoped-lane-admission-lib.mjs";
import { reconcileCloudAuthorityProjection } from "../scripts/scoped-lane-cloud-reconciliation.mjs";
import { renderWriterLeasePullRequestBody } from "../scripts/writer-lease-lib.mjs";
const repo = process.cwd(), branch = "agent/device/managed-run";
const pullRequestUrl = "https://github.test/org/repo/pull/42", headSha = "c".repeat(40);
const lease = {
  schema: "agentic-writer-lease/v2",
  status: "active",
  epoch: 3,
  sessionId: "session-a",
  device: "device",
  scope: "managed-run",
  branch,
  worktreePath: repo,
  baseSha: "a".repeat(40),
  fenceSha: "b".repeat(40),
  pullRequestUrl,
  acquiredAt: "2026-07-22T00:00:00.000Z",
  heartbeatAt: "2026-07-22T00:01:00.000Z",
  expiresAt: "2026-07-22T00:31:00.000Z",
};
function gitText(args) {
  const values = {
    "worktree list --porcelain -z": `worktree ${repo}\0HEAD ${headSha}\0branch refs/heads/${branch}\0`,
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "status --porcelain": "",
    "branch --show-current": branch,
    "rev-parse HEAD": headSha,
    "log -1 --pretty=%s": "feat: managed autonomous run",
  };
  const key = args.join(" ");
  if (!(key in values)) throw new Error(`unexpected git command: ${key}`);
  return values[key];
}

test("heartbeat fails closed before renewal when an active ownership PR was manually readied", () => {
  let renewed = false;
  const calls = [];
  assert.throws(() => heartbeat({
    invocationPath: repo,
    repo,
    gitText,
    gitOptional: () => `${lease.fenceSha}\trefs/heads/${branch}`,
    ghText: () => pullRequestJson({ body: renderWriterLeasePullRequestBody(lease), isDraft: false }),
    leaseStore: {
      verify: () => lease,
      heartbeat: () => { renewed = true; },
    },
    sessionId: "session-a",
    leaseTtlMs: 1_800_000,
    run: (command, args) => calls.push([command, ...args]),
  }), /must be draft/);
  assert.equal(renewed, false);
  assert.deepEqual(calls, []);
});

test("review validates, pushes, and marks the matching PR ready without merge", () => {
  const calls = [];
  const originalBody = "## Work item\n\nAcceptance stays visible.";
  let remoteBody = originalBody;
  let isDraft = true;
  let pullRequestHeadSha = lease.fenceSha;
  let saved = lease;
  const result = review({
    invocationPath: repo,
    repo,
    gitText,
    gitOptional: () => "",
    ghText: args => args[1] === "list"
      ? JSON.stringify([{ number: 42, headRefName: branch, url: pullRequestUrl }])
      : pullRequestJson({ body: remoteBody, isDraft, headRefOid: pullRequestHeadSha }),
    ghOptional: () => pullRequestUrl,
    leaseStore: {
      read: () => saved,
      verify: () => saved,
      annotate: ({ values }) => { saved = { ...saved, ...values }; return saved; },
      release: ({ status }) => { saved = { ...saved, status }; return saved; },
    },
    sessionId: "session-a",
    run: (command, args) => {
      calls.push([command, ...args]);
      if (command === "git" && args[0] === "push") pullRequestHeadSha = headSha;
      if (command === "gh" && args[0] === "pr" && args[1] === "ready") isDraft = false;
      if (command === "gh" && args[0] === "pr" && args[1] === "edit") remoteBody = args[args.indexOf("--body") + 1];
    },
    log: () => {},
  });

  assert.equal(result, pullRequestUrl);
  assert.equal(saved.status, "review_ready");
  assert.equal(saved.reviewHeadSha, headSha);
  assert.equal(isDraft, false);
  assert.ok(calls.some(call => call.join(" ") === "npm run check"));
  assert.ok(calls.some(call => call[0] === "git" && call[1] === "push"));
  assert.ok(calls.some(call => call.join(" ") === `gh pr ready ${pullRequestUrl}`));
  const commandTrace = calls.map(call => call.join(" ")).join("\n");
  assert.doesNotMatch(commandTrace, /gh pr merge|--auto|automerge|--add-label/);
  const bodyEdit = calls.find(call => call[0] === "gh" && call.includes("--body"));
  assert.match(bodyEdit[bodyEdit.indexOf("--body") + 1], /Acceptance stays visible/);
  assert.ok(bodyEdit.includes("--title"));
});

test("review waits for the pushed SHA before marking the ownership PR ready", () => {
  const calls = [];
  let isDraft = true;
  let readsAfterPush = 0;
  let pushed = false;
  let saved = lease;
  review({
    invocationPath: repo,
    repo,
    gitText,
    gitOptional: () => "",
    ghText: args => {
      if (args[1] === "list") {
        return JSON.stringify([{ number: 42, headRefName: branch, url: pullRequestUrl }]);
      }
      if (pushed) readsAfterPush += 1;
      return pullRequestJson({
        body: "## Work item",
        isDraft,
        headRefOid: readsAfterPush >= 3 ? headSha : lease.fenceSha,
      });
    },
    ghOptional: () => pullRequestUrl,
    leaseStore: {
      read: () => saved,
      verify: () => saved,
      annotate: ({ values }) => { saved = { ...saved, ...values }; return saved; },
      release: ({ status }) => { saved = { ...saved, status }; return saved; },
    },
    sessionId: "session-a",
    run: (command, args) => {
      calls.push([command, ...args]);
      if (command === "git" && args[0] === "push") pushed = true;
      if (command === "gh" && args[0] === "pr" && args[1] === "ready") isDraft = false;
    },
    wait: milliseconds => calls.push(["wait", String(milliseconds)]),
    log: () => {},
  });

  assert.equal(readsAfterPush >= 3, true);
  assert.equal(isDraft, false);
  assert.equal(calls.filter(call => call[0] === "wait").length, 2);
  const readyIndex = calls.findIndex(call => call.join(" ") === `gh pr ready ${pullRequestUrl}`);
  const lastWaitIndex = calls.findLastIndex(call => call[0] === "wait");
  assert.ok(readyIndex > lastWaitIndex);
});

test("review readiness leaves immutable auto-delivery dormant until explicit integration", () => {
  const calls = [];
  let remoteBody = "## Work item";
  let isDraft = true;
  let saved = { ...lease, autoDelivery: true, runtimeRequired: true };
  const result = review({
    invocationPath: repo,
    repo,
    gitText,
    gitOptional: () => "",
    ghText: args => args[1] === "list"
      ? JSON.stringify([{ number: 42, headRefName: branch, url: pullRequestUrl }])
      : pullRequestJson({ body: remoteBody, isDraft }),
    ghOptional: () => pullRequestUrl,
    leaseStore: {
      read: () => saved,
      verify: () => saved,
      annotate: ({ values }) => { saved = { ...saved, ...values }; return saved; },
      release: ({ status }) => { saved = { ...saved, status }; return saved; },
    },
    sessionId: "session-a",
    run: (command, args) => {
      calls.push([command, ...args]);
      if (command === "gh" && args[0] === "pr" && args[1] === "ready") isDraft = false;
      if (command === "gh" && args[0] === "pr" && args[1] === "edit" && args.includes("--body")) {
        remoteBody = args[args.indexOf("--body") + 1];
      }
    },
    log: () => {},
  });

  assert.equal(result, pullRequestUrl);
  assert.equal(saved.status, "review_ready");
  assert.equal(saved.reviewHeadSha, headSha);
  assert.equal(
    calls.some(call => call.join(" ") === `gh pr edit ${pullRequestUrl} --add-label agentic/auto-delivery`),
    false,
  );
  assert.doesNotMatch(calls.map(call => call.join(" ")).join("\n"), /gh pr merge|--auto|agentic\/auto-delivery/);
});

test("review replays an exact same-session ready handoff without verification or push", () => {
  const calls = [];
  const ready = { ...lease, status: "review_ready", reviewHeadSha: headSha };
  const result = review({
    invocationPath: repo,
    repo,
    gitText,
    gitOptional: () => `${headSha}\trefs/heads/${branch}`,
    ghText: args => args[1] === "list"
      ? JSON.stringify([{ number: 42, headRefName: branch, url: pullRequestUrl }])
      : pullRequestJson({ body: "## Work item\n\nPreserve me.", isDraft: false }),
    ghOptional: () => pullRequestUrl,
    leaseStore: { read: () => ready },
    sessionId: "session-a",
    run: (command, args) => calls.push([command, ...args]),
    log: () => {},
  });

  assert.equal(result, pullRequestUrl);
  assert.equal(calls.some(call => call[0] === "npm" || call[1] === "push"), false);
  assert.deepEqual(calls.map(call => call.slice(0, 3)), [
    ["git", "merge-base", "--is-ancestor"],
    ["gh", "pr", "edit"],
  ]);
});

test("review replays and upgrades a ready legacy root-source lane into cloud authority", () => {
  const calls = [];
  let saved = { ...lease, status: "review_ready", reviewHeadSha: headSha };
  let remoteBody = "## Work item\n\nPreserve me.";
  const result = review({
    invocationPath: repo,
    repo,
    gitText: args => {
      const key = args.join(" ");
      const values = {
        "worktree list --porcelain -z": `worktree ${repo}\0HEAD ${headSha}\0branch refs/heads/${branch}\0`,
        "diff --name-only --diff-filter=U": "",
        "ls-files -u": "",
        "status --porcelain": "",
        "branch --show-current": branch,
        "rev-parse HEAD": headSha,
        "rev-parse origin/main": lease.baseSha,
        "log -1 --pretty=%s": "feat: managed autonomous run",
        [`diff --name-only ${lease.baseSha}..${headSha} --`]: "scripts/device-branch-lib.mjs\n",
      };
      if (!(key in values)) throw new Error(`unexpected git command: ${key}`);
      return values[key];
    },
    gitOptional: args => {
      if (args[0] === "config" && args[2] === "remote.origin.url") {
        return "git@github.com:huijoohwee/agentic-canvas-os.git";
      }
      if (args[0] === "ls-remote") return `${headSha}\trefs/heads/${branch}`;
      return "";
    },
    ghText: args => args[1] === "list"
      ? JSON.stringify([{ number: 42, headRefName: branch, url: pullRequestUrl }])
      : pullRequestJson({ body: remoteBody, isDraft: false }),
    ghOptional: () => pullRequestUrl,
    leaseStore: {
      read: () => saved,
      annotate: ({ values }) => (saved = { ...saved, ...values }),
    },
    sessionId: "session-a",
    claimLegacyReviewCloudAuthority: ({ headSha: claimedHeadSha }) => {
      const local = cloudLease({ state: "active", laneRevision: claimedHeadSha });
      return {
        authority: local.cloudAuthority,
        verification: operationVerification(local.cloudAuthority),
      };
    },
    reviewReadyCloudAuthority: ({ authority, headSha: reviewedHeadSha }) => ({
      authority: {
        ...authority,
        state: "review_ready",
        laneRevision: reviewedHeadSha,
        focusedEvidenceDigest: "9".repeat(64),
      },
    }),
    verifyReviewReadyCloudAuthority: ({ authority }) => ({ authority }),
    run: (command, args) => {
      calls.push([command, ...args]);
      if (command === "gh" && args[0] === "pr" && args[1] === "edit") {
        remoteBody = args[args.indexOf("--body") + 1];
      }
    },
    log: () => {},
  });

  assert.equal(result, pullRequestUrl);
  assert.equal(saved.cloudAuthority.state, "review_ready");
  assert.equal(saved.admission.status, "admitted");
  assert.equal(calls.some(call => call[0] === "npm" || call[1] === "push"), false);
  assert.deepEqual(calls.map(call => call.slice(0, 3)), [
    ["git", "merge-base", "--is-ancestor"],
    ["gh", "pr", "edit"],
  ]);
});

test("resume reactivates an attached reviewed handoff under a new fenced session", () => {
  const calls = [];
  const prior = { ...lease, status: "review_ready", reviewHeadSha: headSha };
  const nextFence = "d".repeat(40);
  let headReads = 0;
  let claimInput = null;
  let isDraft = false;
  let remoteBody = renderWriterLeasePullRequestBody(prior);
  const resumed = { ...prior, status: "active", epoch: 4, sessionId: "session-b", fenceSha: nextFence };
  const result = resume({
    branchName: branch,
    invocationPath: repo,
    repo,
    gitText: args => {
      const key = args.join(" ");
      const values = {
        "worktree list --porcelain -z": `worktree ${repo}\0HEAD ${headSha}\0branch refs/heads/${branch}\0`,
        "diff --name-only --diff-filter=U": "",
        "ls-files -u": "",
        "status --porcelain": "",
        "branch --show-current": branch,
        [`rev-parse origin/${branch}`]: headSha,
      };
      if (key === "rev-parse HEAD") return headReads++ === 0 ? headSha : nextFence;
      if (!(key in values)) throw new Error(`unexpected git command: ${key}`);
      return values[key];
    },
    gitOptional: args => args[0] === "config" ? "device-b" : "",
    ghText: args => args[1] === "list" ? JSON.stringify([{
      number: 42,
      headRefName: branch,
      url: pullRequestUrl,
      body: remoteBody,
    }]) : pullRequestJson({ body: remoteBody, isDraft }),
    leaseStore: {
      read: () => prior,
      claim: input => { calls.push(["lease", "claim"]); claimInput = input; return { ...resumed, fenceSha: null }; },
      annotate: () => resumed,
    },
    sessionId: "session-b",
    leaseTtlMs: 1_800_000,
    run: (command, args) => {
      calls.push([command, ...args]);
      if (command === "gh" && args[0] === "pr" && args[1] === "ready" && args.includes("--undo")) isDraft = true;
      if (command === "gh" && args[0] === "pr" && args[1] === "edit") remoteBody = args[args.indexOf("--body") + 1];
    },
    log: () => {},
  });

  assert.equal(claimInput.previousEpoch, 3);
  assert.equal(claimInput.sessionId, "session-b");
  assert.equal(result.fenceSha, nextFence);
  assert.equal(isDraft, true);
  assert.ok(calls.findIndex(call => call.join(" ") === `gh pr ready --undo ${pullRequestUrl}`) <
    calls.findIndex(call => call.join(" ") === "lease claim"));
  assert.equal(calls.some(call => call[1] === "switch"), false);
  assert.ok(calls.some(call => call.join(" ") === `git push origin ${branch}`));

  const parkCalls = [];
  const mainSha = "a".repeat(40);
  let parkedLease = null;
  let parkHeadReads = 0;
  const parked = park({
    invocationPath: repo,
    repo,
    gitText: args => {
      const values = {
        "worktree list --porcelain -z": `worktree ${repo}\0HEAD ${nextFence}\0branch refs/heads/${branch}\0`,
        "diff --name-only --diff-filter=U": "",
        "ls-files -u": "",
        "branch --show-current": branch,
        "status --porcelain": "",
        "stash list --format=%H%x00%gs": "",
        "rev-parse origin/main": mainSha,
        "rev-parse HEAD": nextFence,
      };
      const key = args.join(" ");
      if (key === "rev-parse HEAD") return parkHeadReads++ ? mainSha : nextFence;
      if (!(key in values)) throw new Error(`unexpected park git command: ${key}`);
      return values[key];
    },
    gitOptional: args => args[0] === "ls-remote" ? `${nextFence}\trefs/heads/${branch}` : "",
    ghText: () => pullRequestJson({ body: remoteBody, isDraft }),
    leaseStore: {
      read: () => resumed,
      verify: () => resumed,
      release: input => (parkedLease = { ...input.expectedLease, ...input.values, status: "parked" }),
    },
    sessionId: "session-b",
    run: (command, args) => {
      parkCalls.push([command, ...args]);
      if (command === "gh" && args[0] === "pr" && args[1] === "edit") remoteBody = args[args.indexOf("--body") + 1];
    },
    log: () => {},
    now: () => new Date("2026-07-22T00:05:00.000Z"),
  });
  assert.equal(parked.branch, branch);
  assert.equal(parkedLease.status, "parked");
  assert.equal(isDraft, true);
  assert.equal(parkCalls.some(call => call[0] === "gh" && call[1] === "pr" && call[2] === "ready"), false);
});

test("review upgrades a legacy root-source lane into cloud-authoritative review", () => {
  const events = [];
  let isDraft = true;
  let remoteBody = "## Work item";
  let remoteHead = lease.fenceSha;
  let saved = { ...lease };
  const reviewResult = review({
    invocationPath: repo,
    repo,
    gitText: args => {
      const key = args.join(" ");
      const values = {
        "worktree list --porcelain -z": `worktree ${repo}\0HEAD ${headSha}\0branch refs/heads/${branch}\0`,
        "diff --name-only --diff-filter=U": "",
        "ls-files -u": "",
        "status --porcelain": "",
        "branch --show-current": branch,
        "rev-parse HEAD": headSha,
        "rev-parse origin/main": lease.baseSha,
        "log -1 --pretty=%s": "feat: managed autonomous run",
        [`diff --name-only ${lease.baseSha}..${headSha} --`]: "scripts/device-branch-lib.mjs\n",
      };
      if (!(key in values)) throw new Error(`unexpected git command: ${key}`);
      return values[key];
    },
    gitOptional: args => (
      args[0] === "config" && args[2] === "remote.origin.url"
        ? "git@github.com:huijoohwee/agentic-canvas-os.git"
        : ""
    ),
    ghText: args => args[1] === "list"
      ? JSON.stringify([{ number: 42, headRefName: branch, url: pullRequestUrl }])
      : pullRequestJson({ body: remoteBody, isDraft, headRefOid: remoteHead }),
    ghOptional: () => pullRequestUrl,
    leaseStore: {
      read: () => saved,
      verify: () => saved,
      annotate: ({ values }) => {
        saved = { ...saved, ...values };
        events.push(`lease:annotate:${Object.keys(values).sort().join(",")}`);
        return saved;
      },
      release: ({ status }) => {
        saved = { ...saved, status };
        events.push(`lease:release:${status}`);
        return saved;
      },
    },
    sessionId: "session-a",
    claimLegacyReviewCloudAuthority: ({ manifest, headSha: claimedHeadSha }) => {
      events.push(`bootstrap:${claimedHeadSha}:${manifest.writeSetDigest}`);
      const local = cloudLease({ state: "active", laneRevision: claimedHeadSha });
      return {
        authority: local.cloudAuthority,
        verification: operationVerification(local.cloudAuthority),
      };
    },
    reconcileCloudAuthority: ({ authority }) => {
      events.push(`reconcile:${authority.state}:${authority.laneRevision}`);
      return { authority, verification: operationVerification(authority) };
    },
    reviewReadyCloudAuthority: ({ authority, headSha: reviewedHeadSha }) => {
      events.push(`transition:${reviewedHeadSha}`);
      return {
        authority: {
          ...authority,
          state: "review_ready",
          laneRevision: reviewedHeadSha,
          focusedEvidenceDigest: "9".repeat(64),
        },
      };
    },
    verifyReviewReadyCloudAuthority: ({ authority }) => {
      events.push(`verify:${authority.state}:${authority.laneRevision}`);
      return { authority };
    },
    run: (command, args) => {
      const trace = `${command} ${args.join(" ")}`;
      events.push(`run:${trace}`);
      if (command === "git" && args[0] === "push") remoteHead = headSha;
      if (command === "gh" && args[0] === "pr" && args[1] === "ready") isDraft = false;
      if (command === "gh" && args[0] === "pr" && args[1] === "edit") {
        remoteBody = args[args.indexOf("--body") + 1];
      }
    },
    log: () => {},
  });

  assert.equal(reviewResult, pullRequestUrl);
  assert.equal(saved.status, "review_ready");
  assert.equal(saved.cloudAuthority.state, "review_ready");
  assert.equal(saved.admission.status, "admitted");
  assert.equal(saved.admission.semanticScope, lease.scope);
  assert.match(saved.admission.manifestDigest, /^[0-9a-f]{64}$/u);
  assert.ok(events.indexOf(`bootstrap:${lease.fenceSha}:${saved.admission.writeSetDigest}`) < events.indexOf("run:npm run check"));
  assert.ok(events.some(event => event === `transition:${headSha}`));
});

test("cloud-admitted review verifies around check and transitions the pushed head before local release", () => {
  const events = [];
  const initial = cloudLease();
  let reconciliations = 0;
  const outcome = runCloudReview({
    initial,
    events,
    reconcileCloudAuthority: ({ authority }) => {
      events.push(`cloud:active:${++reconciliations}`);
      const recovered = reconciliations === 2
        ? { ...authority, laneRevision: headSha, transitionCounter: 3,
          claimDigest: "f".repeat(64), claimLedgerRevision: "0".repeat(64) }
        : authority;
      return { authority: recovered, verification: operationVerification(recovered) };
    },
    reviewReadyCloudAuthority: ({ authority, headSha: pushedHead, pullRequestNumber }) => {
      events.push(`cloud:transition-and-reverify:${pushedHead}`);
      assert.equal(pushedHead, headSha);
      assert.equal(pullRequestNumber, 42);
      return {
        authority: {
          ...authority,
          state: "review_ready",
          laneRevision: pushedHead,
          focusedEvidenceDigest: "9".repeat(64),
        },
      };
    },
    verifyReviewReadyCloudAuthority: () => {
      throw new Error("new transition must own its review-ready verification");
    },
  });

  assert.equal(reconciliations, 2);
  assert.ok(events.indexOf("cloud:active:1") < events.indexOf("run:npm run check"));
  assert.ok(events.indexOf("run:npm run check") < events.indexOf("cloud:active:2"));
  assert.ok(events.indexOf("cloud:active:2") < events.indexOf(`run:git push --set-upstream origin ${branch}`));
  const transitioned = `cloud:transition-and-reverify:${headSha}`;
  assert.ok(events.indexOf(`run:git push --set-upstream origin ${branch}`) < events.indexOf(transitioned));
  assert.ok(events.indexOf(transitioned) < events.indexOf("lease:release:review_ready"));
  assert.equal(outcome.saved.cloudAuthority.state, "review_ready");
  assert.equal(outcome.saved.cloudAuthority.laneRevision, headSha);
});

test("cloud-admitted review accepts an already projected active lane before the final push", () => {
  const events = [];
  const projectedHead = "9".repeat(40);
  const initial = cloudLease({ laneRevision: projectedHead });
  const outcome = runCloudReview({
    initial,
    events,
    reconcileCloudAuthority: ({ authority }) => {
      events.push(`cloud:active:${authority.laneRevision}`);
      return {
        authority: {
          ...authority,
          laneRevision: projectedHead,
          state: "active",
        },
        verification: operationVerification({
          ...authority,
          laneRevision: projectedHead,
          state: "active",
        }),
      };
    },
    reviewReadyCloudAuthority: ({ authority, headSha: pushedHead }) => {
      events.push(`cloud:transition:${pushedHead}`);
      return {
        authority: {
          ...authority,
          state: "review_ready",
          laneRevision: pushedHead,
          focusedEvidenceDigest: "9".repeat(64),
        },
      };
    },
    verifyReviewReadyCloudAuthority: ({ authority }) => ({ authority }),
  });

  assert.equal(outcome.saved.cloudAuthority.state, "review_ready");
  assert.equal(outcome.saved.cloudAuthority.laneRevision, headSha);
  assert.ok(events.includes(`cloud:active:${projectedHead}`));
  assert.ok(events.includes(`cloud:transition:${headSha}`));
});

test("cloud transition crash reconciles the exact pushed review-ready head before local release", () => {
  const events = [];
  const initial = cloudLease();
  let readyVerifications = 0;
  runCloudReview({
    initial,
    events,
    reconcileCloudAuthority: () => {
      const authority = cloudLease({
        state: "review_ready",
        laneRevision: headSha,
      }).cloudAuthority;
      events.push(`cloud:ready:${++readyVerifications}:${headSha}`);
      return { authority };
    },
    reviewReadyCloudAuthority: () => {
      throw new Error("review-ready retry must not transition twice");
    },
    verifyReviewReadyCloudAuthority: ({ authority, headSha: verifiedHead }) => {
      events.push(`cloud:ready:${++readyVerifications}:${verifiedHead}`);
      assert.equal(verifiedHead, headSha);
      return { authority };
    },
  });

  const push = `run:git push --set-upstream origin ${branch}`;
  const finalVerification = `cloud:ready:3:${headSha}`;
  assert.equal(readyVerifications, 3);
  assert.ok(events.indexOf(`cloud:ready:2:${headSha}`) < events.indexOf(push));
  assert.ok(events.indexOf(push) < events.indexOf(finalVerification));
  assert.ok(events.indexOf(finalVerification) < events.indexOf("lease:release:review_ready"));
});

test("expired local review replay adopts an exact live review-ready cloud projection", () => {
  const events = [];
  const initial = cloudLease({ state: "review_ready", laneRevision: headSha });
  const outcome = runCloudReview({
    initial,
    events,
    verifyLease: () => {
      throw new Error(`Writer lease expired at ${initial.expiresAt}.`);
    },
    reconcileCloudAuthority: ({ authority }) => ({
      authority,
      verification: operationVerification(authority),
    }),
    reviewReadyCloudAuthority: () => {
      throw new Error("review-ready recovery must not transition twice");
    },
    verifyReviewReadyCloudAuthority: ({ authority }) => ({ authority }),
  });

  assert.equal(outcome.saved.status, "review_ready");
  assert.equal(outcome.saved.reviewHeadSha, headSha);
  assert.equal(outcome.saved.cloudAuthority.state, "review_ready");
  assert.ok(events.includes("lease:release:review_ready"));
});

test("cloud-backed resume fails closed before any mutation", () => {
  const mutations = [];
  assert.throws(() => resume({
    branchName: branch,
    invocationPath: repo,
    repo,
    gitText,
    gitOptional: () => "",
    ghText: () => { mutations.push("gh"); return "[]"; },
    leaseStore: {
      read: () => cloudLease({ state: "review_ready", laneRevision: headSha }),
      claim: () => mutations.push("claim"),
      annotate: () => mutations.push("annotate"),
    },
    sessionId: "session-b",
    leaseTtlMs: 1_800_000,
    run: (...args) => mutations.push(args),
    log: () => {},
  }), /cloud handoff\/reclaim protocol/);
  assert.deepEqual(mutations, []);
});

test("cloud-backed park fails closed before local mutation", () => {
  const mutations = [];
  assert.throws(() => park({
    invocationPath: repo, repo, gitText, gitOptional: () => "",
    ghText: () => { mutations.push("gh"); return ""; },
    leaseStore: { read: () => cloudLease() }, sessionId: "session-a", log: () => {},
    run: (...args) => mutations.push(args),
  }), /cloud handoff\/reclaim protocol/);
  assert.deepEqual(mutations, []);
});

test("cloud heartbeat returns a post-local verification receipt", () => {
  let saved = cloudLease();
  let verifications = 0;
  const result = heartbeat({
    invocationPath: repo, repo, gitText,
    gitOptional: () => `${saved.fenceSha}\trefs/heads/${branch}`,
    ghText: () => pullRequestJson({
      body: renderWriterLeasePullRequestBody(saved), isDraft: true,
    }),
    leaseStore: { verify: () => saved, heartbeat: () => saved,
      annotate: ({ values }) => (saved = { ...saved, ...values }) },
    sessionId: "session-a", leaseTtlMs: 1_800_000,
    heartbeatCloudAuthority: () => ({ authority: saved.cloudAuthority,
      verification: operationVerification(saved.cloudAuthority) }),
    verifyActiveCloudAuthority: ({ authority }) => {
      verifications += 1;
      return { authority, verification: operationVerification(authority) };
    },
    run: () => {}, log: () => {},
  });
  assert.equal(verifications, 1);
  assert.equal(result.mutationAuthorityReceipt.status, "ready");
});

test("cloud reconciliation accepts only an exact advanced review-ready claim", () => {
  const initial = cloudLease();
  const ready = { ...initial.cloudAuthority, state: "review_ready", laneRevision: headSha,
    transitionCounter: 3, claimDigest: "f".repeat(64),
    claimLedgerRevision: "0".repeat(64), ledgerRevision: "e".repeat(40) };
  const result = reconcileCloudAuthorityProjection({
    authority: initial.cloudAuthority, manifest: initial.admission,
    branch, headSha, pullRequestNumber: 42,
    statusResult: { schema: "agentic-cloud-collaboration-result/v1", ok: true,
      action: "status", status: "ready", ledgerRevision: ready.ledgerRevision,
      ledgerDigest: "1".repeat(64),
      claims: [{ ...operationClaim(ready), heartbeatCounter: 0 }] },
    now: new Date("2026-07-22T00:03:00.000Z"),
  });
  assert.equal(result.authority.state, "review_ready");
  assert.equal(result.authority.laneRevision, headSha);
});

function cloudLease({ state = "active", laneRevision = lease.fenceSha } = {}) {
  const declaredWriteSet = ["path:scripts/device-branch-lib.mjs", "semantic:managed-run"];
  const writeSetDigest = digestValue(declaredWriteSet);
  const claimId = digestValue({
    actorId: "github-user:1", canonicalBaseRevision: lease.baseSha,
    leaseEpoch: 1, repositoryId: "github-repository:1",
    workItemId: "work-item:1", writeSetDigest,
  });
  return {
    ...lease,
    admission: {
      schema: "agentic-lane-admission-lease/v1", status: "admitted",
      semanticScope: "managed-run", declaredWriteSet, writeSetDigest,
      manifestDigest: "5".repeat(64),
      planReceiptDigest: "6".repeat(64),
      admissionReceiptDigest: "7".repeat(64),
      existingLaneStateDigest: "8".repeat(64),
      admittedReportDigest: "9".repeat(64),
      preservationReceiptDigest: "a".repeat(64),
    },
    cloudAuthority: {
      schema: "agentic-lane-cloud-authority/v1", provider: "github",
      ledgerRepository: "org/ledger", targetRepository: "org/repo", claimId,
      claimDigest: "2".repeat(64),
      ledgerRevision: "d".repeat(40),
      ledgerDigest: "b".repeat(64),
      claimLedgerRevision: "3".repeat(64),
      entrySchema: "agentic-cloud-collaboration-entry/v2",
      claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
      operationReceiptDigest: "4".repeat(64),
      mutationAuthorityEligible: true,
      canonicalBaseSha: lease.baseSha, laneRevision,
      cloudDeclaredWriteScope: declaredWriteSet, writeSetDigest,
      deviceId: lease.device, sessionId: lease.sessionId, reviewRequestId: "42",
      leaseEpoch: 1, transitionCounter: 2, state,
      expiresAt: "2026-07-22T01:00:00.000Z",
      ...(state === "review_ready" ? { focusedEvidenceDigest: "9".repeat(64) } : {}),
    },
  };
}

function operationVerification(authority) {
  const ledgerDigest = "b".repeat(64);
  const inventoryDigest = "c".repeat(64);
  return markOperationDerivedCloudVerification({
    schema: "agentic-lane-cloud-verification/v1", status: "ready",
    claimId: authority.claimId, claimDigest: authority.claimDigest,
    ledgerRevision: authority.ledgerRevision, ledgerDigest,
    canonicalBaseSha: authority.canonicalBaseSha, laneRevision: authority.laneRevision,
    writeSetDigest: authority.writeSetDigest, reviewRequestId: authority.reviewRequestId,
    remoteClaimInventoryDigest: inventoryDigest,
    inventory: {
      schema: "agentic-cloud-claim-inventory/v1",
      inventoryDigest,
      observedLedgerHeadRevision: authority.ledgerRevision,
      ledgerDigest,
      claims: [operationClaim(authority)],
    },
    receiptDigest: "e".repeat(64),
    verifiedAt: "2026-07-22T00:02:00.000Z",
  });
}

function operationClaim(authority) {
  return {
    claimId: authority.claimId, state: authority.state, actorId: "github-user:1",
    entrySchema: authority.entrySchema,
    claimIdentitySchema: authority.claimIdentitySchema,
    operationReceiptDigest: authority.operationReceiptDigest,
    mutationAuthorityEligible: authority.mutationAuthorityEligible,
    repositoryId: "github-repository:1", workItemId: "work-item:1",
    canonicalBaseRevision: authority.canonicalBaseSha, laneRevision: authority.laneRevision,
    declaredWriteScope: authority.cloudDeclaredWriteScope, writeSetDigest: authority.writeSetDigest,
    leaseEpoch: authority.leaseEpoch, transitionCounter: authority.transitionCounter,
    reviewRequestId: authority.reviewRequestId, expiresAt: authority.expiresAt,
    fenceRevision: authority.claimDigest, transitionDigest: authority.claimLedgerRevision,
  };
}

function runCloudReview({
  initial, events, reconcileCloudAuthority,
  reviewReadyCloudAuthority, verifyReviewReadyCloudAuthority,
  verifyLease,
}) {
  let saved = initial;
  let isDraft = true;
  let remoteHead = initial.fenceSha;
  let remoteBody = renderWriterLeasePullRequestBody(initial);
  review({
    invocationPath: repo,
    repo,
    gitText,
    gitOptional: () => "",
    ghText: args => args[1] === "list"
      ? JSON.stringify([{ number: 42, headRefName: branch, url: pullRequestUrl }])
      : pullRequestJson({ body: remoteBody, isDraft, headRefOid: remoteHead }),
    ghOptional: () => pullRequestUrl,
    leaseStore: {
      read: () => saved,
      verify: verifyLease || (() => saved),
      annotate: ({ values }) => {
        events.push(`lease:annotate:${values.cloudAuthority?.state || "local"}`);
        saved = { ...saved, ...values };
        return saved;
      },
      release: ({ status }) => {
        events.push(`lease:release:${status}`);
        saved = { ...saved, status };
        return saved;
      },
    },
    sessionId: "session-a",
    reconcileCloudAuthority,
    reviewReadyCloudAuthority,
    verifyReviewReadyCloudAuthority,
    run: (command, args) => {
      events.push(`run:${[command, ...args].join(" ")}`);
      if (command === "git" && args[0] === "push") remoteHead = headSha;
      if (command === "gh" && args[0] === "pr" && args[1] === "ready") isDraft = false;
      if (command === "gh" && args[0] === "pr" && args[1] === "edit") {
        remoteBody = args[args.indexOf("--body") + 1];
      }
    },
    log: () => {},
  });
  return { saved, isDraft };
}

function pullRequestJson({ body, isDraft, headRefOid = headSha }) {
  return JSON.stringify({
    url: pullRequestUrl, state: "OPEN", isDraft,
    headRefName: branch, headRefOid, baseRefName: "main", body,
  });
}
