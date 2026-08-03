import assert from "node:assert/strict";
import test from "node:test";

import {
  createGitHubCloudCollaborationAdapter,
} from "../scripts/github-cloud-collaboration-adapter.mjs";

const ledgerRepository = "owner/ledger";
const targetRepository = "owner/target";
const targetMainSha = "3".repeat(40);
const pullHeadSha = "4".repeat(40);
const evidenceDigest = "e".repeat(64);
const operatorDecisionDigest = "d".repeat(64);
const integrationIntentDigest = "a".repeat(64);

test("adapter bootstraps the ledger, advances only by non-forced CAS, and replays exactly", async () => {
  const github = createFakeGitHub();
  const adapter = createAdapter(github);
  const input = claimInput();

  const first = await adapter.execute("claim", input);
  assert.equal(first.ok, true);
  assert.equal(first.status, "active");
  assert.equal(first.replayed, false);
  assert.match(first.ledgerRevision, /^[0-9a-f]{40}$/u);
  assert.match(first.claimDigest, /^[0-9a-f]{64}$/u);
  assert.equal(JSON.stringify(first).includes(input.deviceId), false);
  assert.equal(JSON.stringify(first).includes(input.sessionId), false);
  assert.equal(JSON.stringify(first).includes(input.workItemId), false);

  const updateCalls = github.calls.filter((call) => (
    call.method === "PATCH"
    && call.path.includes("/git/refs/heads/agentic/collaboration-ledger")
  ));
  assert.equal(updateCalls.length, 1);
  assert.deepEqual(updateCalls[0].body.force, false);

  const writesBeforeReplay = github.mutationCount();
  const replay = await adapter.execute("claim", input);
  assert.equal(replay.replayed, true);
  assert.equal(replay.claimDigest, first.claimDigest);
  assert.equal(replay.ledgerRevision, first.ledgerRevision);
  assert.equal(github.mutationCount(), writesBeforeReplay);
});

test("adapter does not depend on immediate ref visibility after bootstrap", async () => {
  const github = createFakeGitHub({ hiddenLedgerRefReadsAfterCreate: 1 });
  const result = await createAdapter(github).execute("claim", claimInput());

  assert.equal(result.ok, true);
  assert.equal(result.attempts, 1);
  const ledgerRefReads = github.calls.filter((call) => (
    call.method === "GET"
    && call.path.endsWith("/git/ref/heads/agentic/collaboration-ledger")
  ));
  assert.equal(ledgerRefReads.length, 1);
  assert.equal(github.calls.filter((call) => call.method === "POST" && call.path.endsWith("/git/refs")).length, 1);
  assert.equal(github.calls.filter((call) => call.method === "PATCH" && call.body.force === false).length, 1);
});

test("adapter retries a transient update-side ref visibility failure", async () => {
  const github = createFakeGitHub({ conflicts: [404] });
  const result = await createAdapter(github).execute("claim", claimInput());

  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  const updates = github.calls.filter((call) => call.method === "PATCH");
  assert.equal(updates.length, 2);
  assert.ok(updates.every((call) => call.body.force === false));
});

test("adapter retries a same-parent CAS conflict with a frozen server-time intent", async () => {
  const github = createFakeGitHub({ conflicts: [409] });
  const adapter = createAdapter(github);
  const result = await adapter.execute("claim", claimInput());

  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  const updates = github.calls.filter((call) => call.method === "PATCH");
  assert.equal(updates.length, 2);
  assert.ok(updates.every((call) => call.body.force === false));
  const candidateLedgers = github.createdLedgerValues();
  assert.equal(candidateLedgers.at(-1).entries[0].claimCore.expiresAt, candidateLedgers.at(-2).entries[0].claimCore.expiresAt);
});

test("adapter exhausts bounded CAS conflicts without force or target mutation", async () => {
  const github = createFakeGitHub({ conflicts: [409, 422, 409] });
  const adapter = createAdapter(github, { maxAttempts: 3 });

  await assert.rejects(
    adapter.execute("claim", claimInput()),
    /compare-and-swap exhausted 3 attempts/u,
  );
  const updates = github.calls.filter((call) => call.method === "PATCH");
  assert.equal(updates.length, 3);
  assert.ok(updates.every((call) => call.body.force === false));
  assert.equal(
    github.calls.some((call) => call.method !== "GET" && call.path.startsWith(`/repos/${targetRepository}/`)),
    false,
  );
});

test("adapter binds and verifies one exact review-ready PR without mutation", async () => {
  const github = createFakeGitHub();
  const adapter = createAdapter(github);
  const claimed = await adapter.execute("claim", claimInput());
  const bound = await adapter.execute("bind", fencedInput(claimed, {
    idempotencyKey: "bind-run-1",
    expectedTransitionCounter: 1,
    pullRequestNumber: 17,
  }));
  const ready = await adapter.execute("review-ready", fencedInput(bound, {
    idempotencyKey: "review-run-1",
    expectedTransitionCounter: 2,
    pullRequestNumber: 17,
    focusedEvidenceDigest: evidenceDigest,
  }));
  assert.equal(ready.status, "review-ready");

  const writesBeforeVerify = github.mutationCount();
  const verification = await adapter.execute("verify", {
    targetRepository,
    pullRequestNumber: 17,
    branch: "agent/device/cloud-scope",
    headSha: pullHeadSha,
    canonicalBaseSha: targetMainSha,
    requiredState: "review-ready",
    expectedClaimDigest: ready.claimDigest,
    expectedLedgerRevision: ready.ledgerRevision,
  });

  assert.equal(verification.ok, true);
  assert.equal(verification.status, "ready");
  assert.equal(verification.claim.state, "review-ready");
  assert.equal(verification.claim.laneRevision, pullHeadSha);
  assert.deepEqual(verification.subject, {
    repository: targetRepository,
    pullRequestNumber: 17,
    branch: "agent/device/cloud-scope",
    headSha: pullHeadSha,
    canonicalBaseSha: targetMainSha,
  });
  assert.equal(github.mutationCount(), writesBeforeVerify);
});

test("adapter lists internal claims, resolves commit pull requests, and accepts normalized owner ids for release", async () => {
  const github = createFakeGitHub();
  const adapter = createAdapter(github);
  const claimed = await adapter.execute("claim", claimInput());
  const bound = await adapter.execute("bind", fencedInput(claimed, {
    idempotencyKey: "bind-run-2",
    expectedTransitionCounter: 1,
    pullRequestNumber: 17,
  }));
  const ready = await adapter.execute("review-ready", fencedInput(bound, {
    idempotencyKey: "review-run-2",
    expectedTransitionCounter: 2,
    pullRequestNumber: 17,
    focusedEvidenceDigest: evidenceDigest,
  }));
  const authorized = await adapter.execute("delivery-authorize", fencedInput(ready, {
    idempotencyKey: "delivery-authorize-run-2",
    expectedTransitionCounter: 3,
    pullRequestNumber: 17,
    laneRevision: pullHeadSha,
    focusedEvidenceDigest: evidenceDigest,
    operatorDecisionDigest,
    integrationIntentDigest,
  }));
  assert.equal(authorized.status, "delivery-authorized");

  const claims = await adapter.listClaims({ targetRepository });
  assert.equal(claims.length, 1);
  assert.equal(claims[0].state, "delivery-authorized");
  assert.match(claims[0].deviceId, /^device:[0-9a-f]{64}$/u);
  assert.match(claims[0].sessionId, /^session:[0-9a-f]{64}$/u);

  const pulls = await adapter.pullRequestsForCommit({
    targetRepository,
    commitSha: targetMainSha,
  });
  assert.equal(pulls.length, 1);
  assert.equal(pulls[0].number, 17);

  const released = await adapter.execute("release", {
    targetRepository,
    pullRequestNumber: 17,
    claimId: claims[0].claimId,
    expectedFenceRevision: claims[0].fenceRevision,
    expectedTransitionCounter: claims[0].transitionCounter,
    deviceId: claims[0].deviceId,
    sessionId: claims[0].sessionId,
    reason: "integrated",
    evidenceDigest,
    integrationReceiptDigest: "f".repeat(64),
    idempotencyKey: "release-run-2",
  });
  assert.equal(released.status, "released");
});

test("adapter rejects pull-request head drift and malformed ledger bytes before mutation", async () => {
  const github = createFakeGitHub();
  const adapter = createAdapter(github);
  await adapter.execute("claim", claimInput());
  await assert.rejects(
    adapter.execute("verify", {
      targetRepository,
      pullRequestNumber: 17,
      headSha: "9".repeat(40),
      branch: "agent/device/cloud-scope",
    }),
    /head revision does not match/u,
  );

  github.tamperLedger();
  const writesBeforeRead = github.mutationCount();
  await assert.rejects(
    adapter.execute("status", { targetRepository }),
    /failed validation/u,
  );
  assert.equal(github.mutationCount(), writesBeforeRead);
});

function createAdapter(github, options = {}) {
  return createGitHubCloudCollaborationAdapter({
    ledgerRepository,
    request: github.request,
    ...options,
  });
}

function claimInput() {
  return {
    targetRepository,
    workItemId: "cloud collaboration implementation",
    scopeId: "cloud-collaboration",
    branch: "agent/device/cloud-scope",
    canonicalBaseRevision: targetMainSha,
    laneRevision: targetMainSha,
    declaredWriteScope: ["scripts/cloud/", "docs/cloud.md"],
    deviceId: "personal-device-name",
    sessionId: "private-chat-session",
    ttlSeconds: 1_800,
    leaseEpoch: 1,
    idempotencyKey: "claim-run-1",
  };
}

function fencedInput(result, overrides) {
  return {
    targetRepository,
    claimId: result.claim.claimId,
    expectedFenceRevision: result.claimDigest,
    deviceId: "personal-device-name",
    sessionId: "private-chat-session",
    ...overrides,
  };
}

function createFakeGitHub({ conflicts = [], hiddenLedgerRefReadsAfterCreate = 0 } = {}) {
  const calls = [];
  const repositories = {
    [ledgerRepository]: repositoryValue(1, "L_ledger", ledgerRepository),
    [targetRepository]: repositoryValue(2, "R_target", targetRepository),
  };
  const refs = new Map([
    [`${ledgerRepository}:main`, "1".repeat(40)],
    [`${targetRepository}:main`, targetMainSha],
  ]);
  const commits = new Map([
    ["1".repeat(40), { tree: "2".repeat(40), parents: [] }],
  ]);
  const trees = new Map([["2".repeat(40), { content: null }]]);
  const blobs = new Map();
  const createdLedgers = [];
  let nextObject = 16;
  let conflictIndex = 0;
  let hiddenLedgerRefReads = 0;

  async function request({ method = "GET", path, body }) {
    calls.push({ method, path, body });
    const date = "Thu, 30 Jul 2026 05:00:00 GMT";
    const repositoryMatch = path.match(/^\/repos\/([^/]+\/[^/]+)$/u);
    if (method === "GET" && repositoryMatch) {
      return response(200, repositories[repositoryMatch[1]], date);
    }
    if (method === "GET" && path === "/user") {
      return response(200, { id: 7, login: "operator" }, date);
    }
    const refMatch = path.match(/^\/repos\/([^/]+\/[^/]+)\/git\/ref\/heads\/(.+)$/u);
    if (method === "GET" && refMatch) {
      const sha = refs.get(`${refMatch[1]}:${refMatch[2]}`);
      if (sha && refMatch[2] === "agentic/collaboration-ledger" && hiddenLedgerRefReads > 0) {
        hiddenLedgerRefReads -= 1;
        return response(404, { message: "Not Found" }, date);
      }
      return sha
        ? response(200, { object: { sha } }, date)
        : response(404, { message: "Not Found" }, date);
    }
    const commitMatch = path.match(/^\/repos\/([^/]+\/[^/]+)\/git\/commits\/([0-9a-f]{40})$/u);
    if (method === "GET" && commitMatch) {
      const commit = commits.get(commitMatch[2]);
      return commit
        ? response(200, { tree: { sha: commit.tree }, parents: commit.parents.map((sha) => ({ sha })) }, date)
        : response(404, { message: "Not Found" }, date);
    }
    const contentMatch = path.match(/^\/repos\/([^/]+\/[^/]+)\/contents\/[^?]+\?ref=(.+)$/u);
    if (method === "GET" && contentMatch) {
      const revision = decodeURIComponent(contentMatch[2]);
      const commit = commits.get(revision);
      const content = commit ? trees.get(commit.tree)?.content : null;
      return content === null || content === undefined
        ? response(404, { message: "Not Found" }, date)
        : response(200, {
          encoding: "base64",
          content: Buffer.from(content).toString("base64"),
        }, date);
    }
    if (method === "GET" && path === `/repos/${targetRepository}/pulls/17`) {
      return response(200, pullRequestValue(), date);
    }
    const commitPullsMatch = path.match(/^\/repos\/([^/]+\/[^/]+)\/commits\/([0-9a-f]{40})\/pulls$/u);
    if (method === "GET" && commitPullsMatch && commitPullsMatch[1] === targetRepository) {
      if (commitPullsMatch[2] === targetMainSha) {
        return response(200, [pullRequestValue({ state: "closed" })], date);
      }
      return response(200, [], date);
    }
    if (method === "POST" && path === `/repos/${ledgerRepository}/git/blobs`) {
      const sha = objectSha();
      blobs.set(sha, body.content);
      try {
        createdLedgers.push(JSON.parse(body.content));
      } catch {
        // Bootstrap and transition content is always JSON; a malformed value is tested on read.
      }
      return response(201, { sha }, date);
    }
    if (method === "POST" && path === `/repos/${ledgerRepository}/git/trees`) {
      const sha = objectSha();
      trees.set(sha, { content: blobs.get(body.tree[0].sha) });
      return response(201, { sha }, date);
    }
    if (method === "POST" && path === `/repos/${ledgerRepository}/git/commits`) {
      const sha = objectSha();
      commits.set(sha, { tree: body.tree, parents: [...body.parents] });
      return response(201, { sha }, date);
    }
    if (method === "POST" && path === `/repos/${ledgerRepository}/git/refs`) {
      const key = `${ledgerRepository}:agentic/collaboration-ledger`;
      if (refs.has(key)) return response(422, { message: "Reference already exists" }, date);
      refs.set(key, body.sha);
      hiddenLedgerRefReads = hiddenLedgerRefReadsAfterCreate;
      return response(201, { object: { sha: body.sha } }, date);
    }
    if (
      method === "PATCH"
      && path === `/repos/${ledgerRepository}/git/refs/heads/agentic/collaboration-ledger`
    ) {
      if (conflictIndex < conflicts.length) {
        const status = conflicts[conflictIndex];
        conflictIndex += 1;
        return response(status, { message: "Update is not a fast forward" }, date);
      }
      const key = `${ledgerRepository}:agentic/collaboration-ledger`;
      const current = refs.get(key);
      const candidate = commits.get(body.sha);
      if (body.force !== false || candidate?.parents[0] !== current) {
        return response(422, { message: "Update is not a fast forward" }, date);
      }
      refs.set(key, body.sha);
      return response(200, { object: { sha: body.sha } }, date);
    }
    const compareMatch = path.match(/^\/repos\/[^/]+\/[^/]+\/compare\/([0-9a-f]{40})\.\.\.([0-9a-f]{40})$/u);
    if (method === "GET" && compareMatch) {
      return response(200, {
        status: isAncestor(compareMatch[1], compareMatch[2]) ? "ahead" : "diverged",
      }, date);
    }
    return response(404, { message: `Unhandled fake route: ${method} ${path}` }, date);
  }

  function objectSha() {
    const sha = nextObject.toString(16).padStart(40, "0");
    nextObject += 1;
    return sha;
  }

  function isAncestor(ancestor, descendant) {
    let current = descendant;
    while (current) {
      if (current === ancestor) return true;
      current = commits.get(current)?.parents[0] || null;
    }
    return false;
  }

  return {
    calls,
    request,
    mutationCount: () => calls.filter((call) => call.method !== "GET").length,
    createdLedgerValues: () => createdLedgers,
    tamperLedger() {
      const revision = refs.get(`${ledgerRepository}:agentic/collaboration-ledger`);
      const tree = trees.get(commits.get(revision).tree);
      const value = JSON.parse(tree.content);
      value.sequence += 1;
      tree.content = `${JSON.stringify(value)}\n`;
    },
  };
}

function repositoryValue(id, nodeId, fullName) {
  return {
    id,
    node_id: nodeId,
    full_name: fullName,
    default_branch: "main",
  };
}

function pullRequestValue(overrides = {}) {
  return {
    id: 17,
    node_id: "PR_17",
    number: 17,
    html_url: `https://github.test/${targetRepository}/pull/17`,
    state: "open",
    draft: false,
    head: {
      ref: "agent/device/cloud-scope",
      sha: pullHeadSha,
      repo: { full_name: targetRepository },
    },
    base: {
      ref: "main",
      sha: targetMainSha,
      repo: { full_name: targetRepository },
    },
    ...overrides,
  };
}

function response(status, value, date) {
  return { status, value, date };
}
