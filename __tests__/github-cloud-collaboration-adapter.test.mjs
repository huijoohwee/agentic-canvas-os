import assert from "node:assert/strict";
import test from "node:test";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  createGitHubCloudCollaborationAdapter,
  shouldUseSmartGitLedgerTransport,
  SMART_GIT_LEDGER_THRESHOLD_BYTES,
} from "../scripts/github-cloud-collaboration-adapter.mjs";
import {
  CURRENT_CLAIM_INVENTORY_SCHEMA,
  pseudonymousIdentifier,
} from "../scripts/github-cloud-collaboration-mapping.mjs";
const ledgerRepository = "owner/ledger";
const targetRepository = "owner/target";
const targetMainSha = "3".repeat(40);
const pullHeadSha = "4".repeat(40);
const evidenceDigest = "e".repeat(64), operatorDecisionDigest = "d".repeat(64);
const integrationIntentDigest = "a".repeat(64);
const workflowContext = { trustedSource: "github-actions", runId: 17, runAttempt: 1,
  repository: targetRepository, repositoryId: 2, revision: targetMainSha };
test("adapter selects smart Git transport before an oversized blob request", () => {
  const oversized = "x".repeat(SMART_GIT_LEDGER_THRESHOLD_BYTES);
  assert.equal(shouldUseSmartGitLedgerTransport(oversized), true);
  assert.equal(shouldUseSmartGitLedgerTransport(oversized.slice(1)), false);
  assert.equal(shouldUseSmartGitLedgerTransport(oversized, 0), false);
});
test("adapter bootstraps the ledger, advances only by non-forced CAS, and replays exactly", async () => {
  const github = createFakeGitHub();
  const adapter = createAdapter(github);
  const input = claimInput();
  const first = await adapter.execute("claim", input);
  assert.equal(first.ok, true);
  assert.equal(first.status, "current");
  assert.equal(first.claim.claimIdentitySchema, "agentic-cloud-collaboration-entry/v2");
  assert.equal(first.claim.workItemId, pseudonymousIdentifier("work-item", input.workItemId));
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
test("adapter preserves canonical work-item identifiers without a second pseudonymization", async () => {
  const github = createFakeGitHub();
  const adapter = createAdapter(github);
  const workItemId = `work-item:${"a".repeat(64)}`;
  const claimed = await adapter.execute("claim", claimInput({
    workItemId,
    idempotencyKey: "canonical-work-item-identity",
  }));
  assert.equal(claimed.claim.workItemId, workItemId);
  const status = await adapter.execute("status", { targetRepository, workItemId });
  assert.equal(status.claims.length, 1);
  assert.equal(status.claims[0].workItemId, workItemId);
});
test("adapter rejects actor metadata that does not match the authenticated token", async () => {
  const github = createFakeGitHub();
  await assert.rejects(createAdapter(github).execute("claim", claimInput({ actorId: 999, actorLogin: "impersonated" })), /authenticated GitHub token identity/u);
  assert.equal(github.mutationCount(), 0);
});
test("adapter falls back to GraphQL viewer when REST actor resolution is temporarily unavailable", async () => {
  const github = createFakeGitHub({ userStatus: 503 });
  const result = await createAdapter(github).execute("claim", claimInput({ actorId: 7, actorLogin: "operator" }));
  assert.equal(result.ok, true);
  assert.equal(
    github.calls.some((call) => call.method === "POST" && call.path === "/graphql"),
    true,
  );
});
test("workflow actor is joined to the authenticated in-progress run", async () => {
  const github = createFakeGitHub({ userStatus: 403 });
  assert.equal((await createAdapter(github, { workflowContext }).execute("claim", claimInput({ actorId: 7, actorLogin: "operator" }))).ok, true);
  await assert.rejects(createAdapter(createFakeGitHub({ userStatus: 403 }), { workflowContext }).execute("claim", claimInput({ actorId: 999 })), /authenticated GitHub run identity/u);
});
test("workflow actor fallback rejects repository identity drift before mutation", async () => {
  const github = createFakeGitHub({ userStatus: 403 });
  await assert.rejects(
    createAdapter(github, {
      workflowContext: { ...workflowContext, repositoryId: 999 },
    }).execute("claim", claimInput({ actorId: 7, actorLogin: "operator" })),
    /authenticated GitHub run identity/u,
  );
  assert.equal(github.mutationCount(), 0);
});
test("workflow fallback is unavailable to untrusted or non-installation callers", async () => {
  await assert.rejects(createAdapter(createFakeGitHub({ userStatus: 403 })).execute("claim", claimInput()), /trusted GitHub Actions runtime context/u);
  await assert.rejects(createAdapter(createFakeGitHub({ userStatus: 401 }), { workflowContext }).execute("claim", claimInput()), /could not resolve authenticated actor/u);
  await assert.rejects(createAdapter(createFakeGitHub(), { workflowContext }).execute("claim", claimInput({ actorId: 999 })), /authenticated GitHub token identity/u);
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
  const github = createFakeGitHub({ conflicts: [409], advanceSeconds: 1 });
  const adapter = createAdapter(github);
  const result = await adapter.execute("claim", claimInput());
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  const updates = github.calls.filter((call) => call.method === "PATCH");
  assert.equal(updates.length, 2);
  assert.ok(updates.every((call) => call.body.force === false));
  const candidateLedgers = github.createdLedgerValues();
  assert.equal(candidateLedgers.at(-1).entries[0].claimCore.expiresAt, candidateLedgers.at(-2).entries[0].claimCore.expiresAt);
  assert.notEqual(candidateLedgers.at(-1).entries[0].evaluationTime, candidateLedgers.at(-2).entries[0].evaluationTime);
});
test("adapter preserves ordinary dynamic claim CAS when the caller seal is absent or null", async () => {
  for (const expectedLedgerDigest of [undefined, null]) {
    const github = createFakeGitHub({ conflicts: [409] });
    const input = claimInput({
      idempotencyKey: `dynamic-claim-${expectedLedgerDigest === null ? "null" : "absent"}`,
      ...(expectedLedgerDigest === null ? { expectedLedgerDigest } : {}),
    });
    const result = await createAdapter(github).execute("claim", input);
    assert.equal(result.ok, true);
    assert.equal(result.attempts, 2);
    assert.equal(github.calls.filter(call => call.method === "PATCH").length, 2);
  }
});
test("adapter rejects a sealed claim against a missing ledger without bootstrapping", async () => {
  const github = createFakeGitHub();
  await assert.rejects(
    createAdapter(github).execute("claim", claimInput({
      expectedLedgerDigest: "a".repeat(64),
    })),
    /expectedLedgerDigest is stale/u,
  );
  assert.equal(github.mutationCount(), 0);
});
test("adapter retries a sealed claim while a same-parent conflict leaves its seal current", async () => {
  const github = createFakeGitHub();
  const adapter = createAdapter(github);
  const predecessor = await adapter.execute("claim", claimInput());
  const sealed = (await adapter.execute("status", { targetRepository })).ledgerDigest;
  github.queueConflict(409);
  const patchesBefore = github.calls.filter(call => call.method === "PATCH").length;
  const candidatesBefore = github.createdLedgerValues().length;
  const result = await adapter.execute("claim",
    successorClaimInput(predecessor, sealed, "sealed-same-parent-retry"));
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.equal(github.calls.filter(call => call.method === "PATCH").length,
    patchesBefore + 2);
  const candidates = github.createdLedgerValues().slice(candidatesBefore);
  assert.equal(candidates.length, 2);
  assert.ok(candidates.every(ledger => ledger.entries.at(-1).parentDigest === sealed));
});
test("adapter does not rebase a sealed claim after a competing head wins its CAS", async () => {
  const github = createFakeGitHub();
  const adapter = createAdapter(github);
  const predecessor = await adapter.execute("claim", claimInput());
  const sealed = (await adapter.execute("status", { targetRepository })).ledgerDigest;
  github.queueConflict(409, { advanceLedger: true });
  const patchesBefore = github.calls.filter(call => call.method === "PATCH").length;
  const candidatesBefore = github.createdLedgerValues().length;
  await assert.rejects(
    adapter.execute("claim",
      successorClaimInput(predecessor, sealed, "sealed-competing-head")),
    /expectedLedgerDigest is stale/u,
  );
  assert.equal(github.calls.filter(call => call.method === "PATCH").length,
    patchesBefore + 1);
  assert.equal(github.createdLedgerValues().length, candidatesBefore + 1);
});
test("adapter rejects a stale sealed claim before creating a ledger candidate", async () => {
  const github = createFakeGitHub();
  const adapter = createAdapter(github);
  const predecessor = await adapter.execute("claim", claimInput());
  const sealed = (await adapter.execute("status", { targetRepository })).ledgerDigest;
  await adapter.execute("claim", claimInput({
    workItemId: "disjoint sealed-fence peer",
    declaredWriteScope: ["path:docs/disjoint-sealed-fence-peer.md"],
    idempotencyKey: "disjoint-sealed-fence-peer",
  }));
  const writesBefore = github.mutationCount();
  const candidatesBefore = github.createdLedgerValues().length;
  await assert.rejects(
    adapter.execute("claim", successorClaimInput(predecessor, sealed, "stale-sealed-successor")),
    /expectedLedgerDigest is stale/u,
  );
  assert.equal(github.mutationCount(), writesBefore);
  assert.equal(github.createdLedgerValues().length, candidatesBefore);
});
test("adapter replays an exact sealed claim after ledger and protected-head advance without writes", async () => {
  const github = createFakeGitHub();
  const adapter = createAdapter(github);
  const predecessor = await adapter.execute("claim", claimInput());
  const sealed = (await adapter.execute("status", { targetRepository })).ledgerDigest;
  const input = successorClaimInput(predecessor, sealed, "sealed-successor-replay");
  const claimed = await adapter.execute("claim", input);
  const claimEntry = github.createdLedgerValues().at(-1).entries.at(-1);
  assert.equal(claimEntry.parentDigest, sealed);
  const later = await adapter.execute("claim", claimInput({
    workItemId: "later disjoint claim",
    declaredWriteScope: ["path:docs/later-disjoint-claim.md"],
    idempotencyKey: "later-disjoint-claim",
  }));
  github.setMainRevision("5".repeat(40));
  const writesBefore = github.mutationCount();
  const replay = await adapter.execute("claim", input);
  assert.equal(replay.replayed, true);
  assert.equal(replay.claimDigest, claimed.claimDigest);
  assert.equal(replay.ledgerRevision, later.ledgerRevision);
  assert.equal(github.mutationCount(), writesBefore);
});
test("adapter rejects an idempotent claim replay whose entry parent differs from its seal", async () => {
  const github = createFakeGitHub();
  const adapter = createAdapter(github);
  const predecessor = await adapter.execute("claim", claimInput());
  const originalSeal = (await adapter.execute("status", { targetRepository })).ledgerDigest;
  const input = successorClaimInput(predecessor, originalSeal, "wrong-parent-replay");
  await adapter.execute("claim", input);
  const wrongSeal = (await adapter.execute("status", { targetRepository })).ledgerDigest;
  const writesBefore = github.mutationCount();
  await assert.rejects(
    adapter.execute("claim", { ...input, expectedLedgerDigest: wrongSeal }),
    /expectedLedgerDigest is stale/u,
  );
  assert.equal(github.mutationCount(), writesBefore);
});
test("adapter retains semantic and action idempotency checks for a parent-matched sealed replay", async () => {
  const github = createFakeGitHub();
  const adapter = createAdapter(github);
  const predecessor = await adapter.execute("claim", claimInput());
  const sealed = (await adapter.execute("status", { targetRepository })).ledgerDigest;
  const input = successorClaimInput(predecessor, sealed, "sealed-semantic-conflict");
  const claimed = await adapter.execute("claim", input);
  const writesBefore = github.mutationCount();
  await assert.rejects(
    adapter.execute("claim", { ...input, laneRevision: pullHeadSha }),
    /idempotencyKey was already used for a different transition/u,
  );
  await assert.rejects(
    adapter.execute("continue", fencedInput(claimed, {
      expectedTransitionCounter: 1,
      mode: "projection",
      laneRevision: claimed.claim.laneRevision,
      idempotencyKey: input.idempotencyKey,
    })),
    /idempotencyKey was already used for a different transition/u,
  );
  assert.equal(github.mutationCount(), writesBefore);
});
test("adapter adopts a response-lost sealed claim only from its exact sealed parent", async () => {
  const github = createFakeGitHub();
  const adapter = createAdapter(github);
  const predecessor = await adapter.execute("claim", claimInput());
  const sealed = (await adapter.execute("status", { targetRepository })).ledgerDigest;
  github.loseNextPatchResponse();
  const patchesBefore = github.calls.filter(call => call.method === "PATCH").length;
  const result = await adapter.execute("claim",
    successorClaimInput(predecessor, sealed, "response-lost-sealed-successor"));
  assert.equal(result.replayed, true);
  assert.equal(result.attempts, 2);
  assert.equal(github.calls.filter(call => call.method === "PATCH").length,
    patchesBefore + 1);
  assert.equal(github.createdLedgerValues().at(-1).entries.at(-1).parentDigest, sealed);
});
test("adapter replays relative-TTL intent across fresh process instances", async () => {
  const github = createFakeGitHub({ advanceSeconds: 1 });
  const input = claimInput({ idempotencyKey: "cross-process-replay" });
  const first = await createAdapter(github).execute("claim", input);
  const writes = github.mutationCount();
  const replay = await createAdapter(github).execute("claim", input);
  assert.equal(replay.replayed, true);
  assert.equal(replay.claimDigest, first.claimDigest);
  assert.equal(github.mutationCount(), writes);
});
test("adapter aborts when protected source or pull-request identity drifts during CAS", async () => {
  await assert.rejects(
    createAdapter(createFakeGitHub({ conflicts: [409], advanceMainOnConflict: true })).execute("claim", claimInput()),
    /Mutation subject changed/u,
  );
  await assert.rejects(
    createAdapter(createFakeGitHub({ conflicts: [409], advancePullOnConflict: true })).execute("claim", claimInput({ pullRequestNumber: 17, laneRevision: pullHeadSha })),
    /Mutation subject changed/u,
  );
});
test("adapter replays a committed update after its response is lost", async () => {
  const github = createFakeGitHub({ advanceSeconds: 1, lostPatchResponses: 1 });
  const result = await createAdapter(github).execute("claim", claimInput());
  assert.equal(result.attempts, 2);
  assert.equal(result.replayed, true);
  assert.equal(github.calls.filter((call) => call.method === "PATCH").length, 1);
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
test("adapter continues and verifies one exact reviewed PR without mutation", async () => {
  const github = createFakeGitHub();
  const adapter = createAdapter(github);
  const ready = await reviewClaim(adapter, "1");
  assert.equal(ready.status, "reviewed");
  const peer = await adapter.execute("claim", claimInput({
    workItemId: "disjoint cloud collaboration peer",
    scopeId: "disjoint-cloud-collaboration-peer",
    branch: "agent/device/disjoint-cloud-peer",
    declaredWriteScope: ["scripts/disjoint-peer/", "docs/disjoint-peer.md"],
    idempotencyKey: "claim-disjoint-peer-run-1",
  }));
  const writesBeforeVerify = github.mutationCount();
  const verification = await adapter.execute("verify", {
    targetRepository,
    pullRequestNumber: 17,
    branch: "agent/device/cloud-scope",
    headSha: pullHeadSha,
    canonicalBaseSha: targetMainSha,
    requiredState: "reviewed",
    expectedClaimDigest: ready.claimDigest,
    expectedLedgerRevision: ready.ledgerRevision,
  });
  assert.equal(verification.ok, true);
  assert.equal(verification.status, "ready");
  assert.equal(verification.claim.state, "reviewed");
  assert.equal(verification.claim.laneRevision, pullHeadSha);
  const { claimInventoryDigest, ...inventoryCore } = verification.currentClaimInventory;
  assert.equal(inventoryCore.schema, CURRENT_CLAIM_INVENTORY_SCHEMA);
  assert.equal(inventoryCore.ledgerRevision, verification.ledgerRevision);
  assert.equal(inventoryCore.ledgerDigest, verification.receipt.ledgerDigest);
  assert.equal(inventoryCore.evaluationTime, verification.receipt.evaluationTime);
  assert.deepEqual(
    inventoryCore.claims.map((claim) => claim.claimId),
    [ready.claim.claimId, peer.claim.claimId].sort(),
  );
  assert.equal(claimInventoryDigest, digestValue(inventoryCore));
  assert.equal(verification.receipt.claimInventoryDigest, claimInventoryDigest);
  assert.deepEqual(verification.subject, {
    repository: targetRepository, pullRequestNumber: 17, branch: "agent/device/cloud-scope",
    headSha: pullHeadSha, canonicalBaseSha: targetMainSha,
  });
  assert.equal(github.mutationCount(), writesBeforeVerify);
});
test("adapter blocks verification when the live pull-request file set escapes the reviewed scope", async () => {
  const github = createFakeGitHub();
  github.setPullRequestFiles([
    { filename: "scripts/cloud/example.mjs", status: "modified" },
    { filename: "docs/cloud.md", status: "modified" },
    { filename: "__tests__/expired-committed-heartbeat-recovery.test.mjs", status: "modified" },
  ]);
  const adapter = createAdapter(github);
  const ready = await reviewClaim(adapter, "scope-mismatch");
  const verification = await adapter.execute("verify", {
    targetRepository,
    pullRequestNumber: 17,
    branch: "agent/device/cloud-scope",
    headSha: pullHeadSha,
    canonicalBaseSha: targetMainSha,
    requiredState: "reviewed",
    expectedClaimDigest: ready.claimDigest,
    expectedLedgerRevision: ready.ledgerRevision,
  });
  assert.equal(verification.ok, false);
  assert.equal(verification.status, "blocked");
  assert.equal(
    verification.findings.some((finding) => finding.type === "declared-write-scope-unproven"),
    true,
  );
});
test("adapter reads large ledgers through Git trees and blobs instead of contents transport", async () => {
  const github = createFakeGitHub();
  const adapter = createAdapter(github);
  for (let i = 0; i < 48; i += 1) {
    const suffix = `${i}`.padStart(2, "0");
    const declaredWriteScope = Array.from({ length: 128 }, (_, index) => (
      `path:docs/collaboration/${suffix}/${`${index}`.padStart(3, "0")}-${"segment-".repeat(8)}proof.md`
    ));
    const claimed = await adapter.execute("claim", claimInput({
      workItemId: `cloud-collaboration-${suffix}`, scopeId: `cloud-collaboration-${suffix}`,
      branch: `agent/device/cloud-scope-${suffix}`, declaredWriteScope, idempotencyKey: `claim-run-${suffix}`,
    }));
    await adapter.execute("retire", fencedInput(claimed, {
      expectedTransitionCounter: claimed.claim.transitionCounter, reason: "abandoned",
      finalRevision: claimed.claim.laneRevision, bytesDigest: evidenceDigest,
      namedChecksDigest: evidenceDigest, handoffEvidenceDigest: evidenceDigest,
      idempotencyKey: `retire-run-${suffix}`,
    }));
  }
  assert.ok(github.currentLedgerBytes() > 900_000);
  const status = await adapter.execute("status", { targetRepository });
  assert.equal(status.status, "ready");
  assert.equal(
    github.calls.some((call) => call.path.includes("/contents/.agentic/collaboration-ledger.json")),
    false,
  );
  assert.ok(
    github.calls.some((call) => call.path.includes(`/repos/${ledgerRepository}/git/trees/`)),
  );
  assert.ok(
    github.calls.some((call) => call.path.includes(`/repos/${ledgerRepository}/git/blobs/`)),
  );
});
test("adapter lists claims, resolves pull requests, integrates, and retires by exact receipt", async () => {
  const github = createFakeGitHub();
  const adapter = createAdapter(github);
  const authorized = await integrateClaim(adapter, "2");
  assert.equal(authorized.status, "integrated-preserved");
  assert.equal(authorized.operationReceipt.schema, "agentic-collaboration-integration-receipt/v1");
  assert.equal(authorized.operationReceipt.operation, "integrate");
  assert.equal(authorized.operationReceipt.receiptDigest, authorized.claim.operationReceiptDigest);
  const renewed = await adapter.execute("continue", fencedInput(authorized, {
    mode: "renewal", idempotencyKey: "renew-integrated-run-2", expectedTransitionCounter: 4,
    ttlSeconds: 3_600,
  }));
  assert.equal(renewed.status, "integrated-preserved");
  assert.equal(renewed.claim.integrationReceiptDigest, authorized.operationReceipt.receiptDigest);
  assert.notEqual(renewed.claim.operationReceiptDigest, renewed.claim.integrationReceiptDigest);
  const claims = await adapter.listClaims({ targetRepository });
  assert.equal(claims.length, 1);
  assert.equal(claims[0].state, "integrated-preserved");
  assert.match(claims[0].deviceId, /^device:[0-9a-f]{64}$/u);
  assert.match(claims[0].sessionId, /^session:[0-9a-f]{64}$/u);
  const pulls = await adapter.pullRequestsForCommit({
    targetRepository,
    commitSha: targetMainSha,
  });
  assert.equal(pulls.length, 1);
  assert.equal(pulls[0].number, 17);
  const released = await adapter.execute("retire", {
    targetRepository,
    pullRequestNumber: 17,
    claimId: claims[0].claimId,
    expectedFenceRevision: claims[0].fenceRevision,
    expectedTransitionCounter: claims[0].transitionCounter,
    deviceId: claims[0].deviceId,
    sessionId: claims[0].sessionId,
    reason: "integrated",
    finalRevision: claims[0].laneRevision,
    reviewRequestId: claims[0].reviewRequestId,
    bytesDigest: evidenceDigest,
    namedChecksDigest: evidenceDigest,
    handoffEvidenceDigest: evidenceDigest,
    integrationReceiptDigest: claims[0].integrationReceiptDigest,
    idempotencyKey: "retire-run-2",
  });
  assert.equal(released.status, "retired");
  assert.equal(released.operationReceipt.schema, "agentic-collaboration-retirement-receipt/v1");
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
test("adapter verifies an integrated-preserved candidate after protected-main refresh", async () => {
  const github = createFakeGitHub();
  const adapter = createAdapter(github);
  const authorized = await integrateClaim(adapter, "refresh");
  github.setPullRequestValue({
    head: {
      ref: "agent/device/cloud-scope",
      sha: "5".repeat(40),
      repo: { full_name: targetRepository },
    },
    base: {
      ref: "main",
      sha: "6".repeat(40),
      repo: { full_name: targetRepository },
    },
  });
  const verification = await adapter.execute("verify", {
    targetRepository,
    pullRequestNumber: 17,
    branch: "agent/device/cloud-scope",
    headSha: pullHeadSha,
    canonicalBaseSha: targetMainSha,
    requireStatus: "integrated-preserved",
    claimId: authorized.claim.claimId,
    expectedClaimDigest: authorized.claimDigest,
    expectedLedgerRevision: authorized.ledgerRevision,
    allowProtectedMainRefresh: true,
  });
  assert.equal(verification.ok, true);
  assert.equal(verification.claim.state, "integrated-preserved");
  assert.equal(verification.claim.laneRevision, pullHeadSha);
});

test("adapter verifies exact historical integration after its valid retirement", async () => {
  const github = createFakeGitHub();
  const adapter = createAdapter(github);
  const integrated = await integrateClaim(adapter, "retired-refresh");
  const retired = await adapter.execute("retire", {
    targetRepository,
    pullRequestNumber: 17,
    claimId: integrated.claim.claimId,
    expectedFenceRevision: integrated.claim.fenceRevision,
    expectedTransitionCounter: integrated.claim.transitionCounter,
    deviceId: claimInput().deviceId,
    sessionId: claimInput().sessionId,
    reason: "integrated",
    finalRevision: integrated.claim.laneRevision,
    reviewRequestId: integrated.claim.reviewRequestId,
    bytesDigest: evidenceDigest,
    namedChecksDigest: evidenceDigest,
    handoffEvidenceDigest: evidenceDigest,
    integrationReceiptDigest: integrated.claim.integrationReceiptDigest,
    idempotencyKey: "retire-run-retired-refresh",
  });
  assert.equal(retired.status, "retired");
  const verification = await adapter.execute("verify", {
    targetRepository,
    pullRequestNumber: 17,
    branch: "agent/device/cloud-scope",
    headSha: pullHeadSha,
    canonicalBaseSha: targetMainSha,
    requireStatus: "integrated-preserved",
    claimId: integrated.claim.claimId,
    expectedClaimDigest: integrated.claimDigest,
    expectedLedgerRevision: integrated.ledgerRevision,
    allowProtectedMainRefresh: true,
    allowRetiredIntegratedPreserved: true,
    integrationReceiptDigest: integrated.claim.integrationReceiptDigest,
    transitionCounter: integrated.claim.transitionCounter,
  });
  assert.equal(verification.ok, true);
  assert.equal(verification.claim.state, "integrated-preserved");
  assert.equal(verification.claimDigest, integrated.claimDigest);
});
function createAdapter(github, options = {}) {
  return createGitHubCloudCollaborationAdapter({ ledgerRepository, request: github.request, ...options });
}
async function reviewClaim(adapter, suffix) {
  const claimed = await adapter.execute("claim", claimInput());
  const bound = await adapter.execute("continue", fencedInput(claimed, {
    mode: "projection", idempotencyKey: `projection-run-${suffix}`,
    expectedTransitionCounter: 1, pullRequestNumber: 17,
  }));
  return adapter.execute("continue", fencedInput(bound, {
    mode: "review", idempotencyKey: `review-run-${suffix}`,
    expectedTransitionCounter: 2, pullRequestNumber: 17, focusedEvidenceDigest: evidenceDigest,
  }));
}
async function integrateClaim(adapter, suffix) {
  const ready = await reviewClaim(adapter, suffix);
  return adapter.execute("integrate", fencedInput(ready, {
    idempotencyKey: `integrate-run-${suffix}`, expectedTransitionCounter: 3,
    pullRequestNumber: 17, laneRevision: pullHeadSha, focusedEvidenceDigest: evidenceDigest,
    dependencyClosureDigest: evidenceDigest, namedChecksDigest: evidenceDigest,
    handoffEvidenceDigest: evidenceDigest, operatorDecisionDigest, integrationIntentDigest,
  }));
}
function claimInput(overrides = {}) {
  return {
    targetRepository, workItemId: "cloud collaboration implementation", scopeId: "cloud-collaboration",
    branch: "agent/device/cloud-scope", canonicalBaseRevision: targetMainSha, laneRevision: targetMainSha,
    declaredWriteScope: ["scripts/cloud/", "docs/cloud.md"],
    deviceId: "personal-device-name", sessionId: "private-chat-session",
    ttlSeconds: 1_800, leaseEpoch: 1, idempotencyKey: "claim-run-1", ...overrides,
  };
}
function fencedInput(result, overrides) {
  return {
    targetRepository, claimId: result.claim.claimId, expectedFenceRevision: result.claimDigest,
    deviceId: "personal-device-name", sessionId: "private-chat-session", ...overrides,
  };
}
function successorClaimInput(predecessor, expectedLedgerDigest, idempotencyKey) {
  return claimInput({
    leaseEpoch: 2,
    predecessorClaimId: predecessor.claim.claimId,
    expectedLedgerDigest,
    idempotencyKey,
  });
}
function createFakeGitHub({
  conflicts = [], hiddenLedgerRefReadsAfterCreate = 0, advanceSeconds = 0,
  lostPatchResponses = 0, userStatus = 200, graphQlViewerStatus = 200,
  advanceMainOnConflict = false, advancePullOnConflict = false,
  advanceLedgerOnConflict = false,
} = {}) {
  const calls = [];
  let pullRequest = pullRequestValue();
  let pullRequestFiles = pullRequestFilesValue();
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
  const trees = new Map([["2".repeat(40), { entries: [] }]]);
  const blobs = new Map();
  const createdLedgers = [];
  let nextObject = 16;
  let conflictIndex = 0;
  const conflictAdvancesLedger = conflicts.map(() => advanceLedgerOnConflict);
  let hiddenLedgerRefReads = 0;
  let lostResponses = 0;
  let lostResponseLimit = lostPatchResponses;
  async function request({ method = "GET", path, body }) {
    calls.push({ method, path, body });
    const date = new Date(Date.parse("Thu, 30 Jul 2026 05:00:00 GMT") + calls.length * advanceSeconds * 1_000).toUTCString();
    const repositoryMatch = path.match(/^\/repos\/([^/]+\/[^/]+)$/u);
    if (method === "GET" && repositoryMatch) {
      return response(200, repositories[repositoryMatch[1]], date);
    }
    if (method === "GET" && path === "/user") {
      return userStatus === 200
        ? response(200, { id: 7, login: "operator" }, date)
        : response(userStatus, { message: "Resource not accessible by integration" }, date);
    }
    if (method === "POST" && path === "/graphql") {
      return graphQlViewerStatus === 200
        ? response(200, { data: { viewer: { login: "operator", databaseId: 7 } } }, date)
        : response(graphQlViewerStatus, { message: "GraphQL viewer unavailable" }, date);
    }
    if (method === "GET" && path === `/repos/${targetRepository}/actions/runs/17`) {
      return response(200, { actor: { id: 7, login: "operator" }, repository: repositoryIdentityValue(2, "R_target", targetRepository), head_sha: targetMainSha, status: "in_progress", run_attempt: 1 }, date);
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
      const content = ledgerContentForRevision(revision);
      return content === null || content === undefined
        ? response(404, { message: "Not Found" }, date)
        : response(200, {
          encoding: "base64",
          content: Buffer.from(content).toString("base64"),
        }, date);
    }
    const treeMatch = path.match(/^\/repos\/([^/]+\/[^/]+)\/git\/trees\/([0-9a-f]{40})$/u);
    if (method === "GET" && treeMatch) {
      const tree = trees.get(treeMatch[2]);
      return tree
        ? response(200, { tree: tree.entries.map((entry) => ({ ...entry })) }, date)
        : response(404, { message: "Not Found" }, date);
    }
    const blobMatch = path.match(/^\/repos\/([^/]+\/[^/]+)\/git\/blobs\/([0-9a-f]{40})$/u);
    if (method === "GET" && blobMatch) {
      const content = blobs.get(blobMatch[2]);
      return content === undefined
        ? response(404, { message: "Not Found" }, date)
        : response(200, {
          encoding: "base64",
          content: Buffer.from(content).toString("base64"),
        }, date);
    }
    if (method === "GET" && path === `/repos/${targetRepository}/pulls/17`) {
      return response(200, pullRequest, date);
    }
    const pullFilesMatch = path.match(
      /^\/repos\/([^/]+\/[^/]+)\/pulls\/([1-9]\d*)\/files\?per_page=(\d+)&page=(\d+)$/u,
    );
    if (method === "GET" && pullFilesMatch && pullFilesMatch[1] === targetRepository && Number(pullFilesMatch[2]) === 17) {
      const perPage = Number(pullFilesMatch[3]);
      const page = Number(pullFilesMatch[4]);
      const start = (page - 1) * perPage;
      return response(200, pullRequestFiles.slice(start, start + perPage), date);
    }
    const commitPullsMatch = path.match(/^\/repos\/([^/]+\/[^/]+)\/commits\/([0-9a-f]{40})\/pulls$/u);
    if (method === "GET" && commitPullsMatch && commitPullsMatch[1] === targetRepository) {
      if (commitPullsMatch[2] === targetMainSha) {
        return response(200, [{ ...pullRequest, state: "closed" }], date);
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
      const treeEntry = body.tree[0];
      const segments = String(treeEntry.path || "").split("/").filter(Boolean);
      const rootEntries = [];
      let blobSha = treeEntry.sha;
      for (let index = segments.length - 1; index >= 0; index -= 1) {
        const segment = segments[index];
        if (index === segments.length - 1) {
          rootEntries.unshift({ path: segment, mode: "100644", type: "blob", sha: blobSha });
          continue;
        }
        const subtreeSha = objectSha();
        trees.set(subtreeSha, { entries: [...rootEntries] });
        blobSha = subtreeSha;
        rootEntries.length = 0;
        rootEntries.push({ path: segment, mode: "040000", type: "tree", sha: subtreeSha });
      }
      trees.set(sha, { entries: [...rootEntries] });
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
        const advanceLedger = conflictAdvancesLedger[conflictIndex];
        conflictIndex += 1;
        if (advanceMainOnConflict) refs.set(`${targetRepository}:main`, "5".repeat(40));
        if (advancePullOnConflict) pullRequest = pullRequestValue({
          head: { ref: "agent/device/cloud-scope", sha: "5".repeat(40), repo: { full_name: targetRepository } },
        });
        if (advanceLedger) advanceLedgerWithCompetingEntry(body.sha, conflictIndex);
        return response(status, { message: "Update is not a fast forward" }, date);
      }
      const key = `${ledgerRepository}:agentic/collaboration-ledger`;
      const current = refs.get(key);
      const candidate = commits.get(body.sha);
      if (body.force !== false || candidate?.parents[0] !== current) {
        return response(422, { message: "Update is not a fast forward" }, date);
      }
      refs.set(key, body.sha);
      if (lostResponses < lostResponseLimit) {
        lostResponses += 1;
        throw new Error("simulated lost update response");
      }
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
    queueConflict(status, { advanceLedger = false } = {}) {
      conflicts.push(status);
      conflictAdvancesLedger.push(advanceLedger);
    },
    loseNextPatchResponse() {
      lostResponseLimit += 1;
    },
    setMainRevision(revision) {
      refs.set(`${targetRepository}:main`, revision);
    },
    setPullRequestValue(overrides = {}) {
      pullRequest = pullRequestValue(overrides);
    },
    setPullRequestFiles(files) {
      pullRequestFiles = pullRequestFilesValue(files);
    },
    currentLedgerBytes() {
      const revision = refs.get(`${ledgerRepository}:agentic/collaboration-ledger`);
      const content = ledgerContentForRevision(revision);
      return content ? Buffer.byteLength(content) : 0;
    },
    tamperLedger() {
      const revision = refs.get(`${ledgerRepository}:agentic/collaboration-ledger`);
      const content = ledgerContentForRevision(revision);
      const value = JSON.parse(content);
      value.sequence += 1;
      replaceLedgerContent(revision, `${JSON.stringify(value)}\n`);
    },
  };
  function advanceLedgerWithCompetingEntry(candidateRevision, ordinal) {
    const ledger = JSON.parse(ledgerContentForRevision(candidateRevision));
    const candidateEntry = ledger.entries.at(-1);
    const { digest: _digest, ...candidateDraft } = candidateEntry;
    const competingDraft = {
      ...candidateDraft,
      idempotencyKey: digestValue(`competing-ledger-entry:${ordinal}`),
      requestDigest: digestValue(`competing-ledger-request:${ordinal}`),
    };
    const competingEntry = { ...competingDraft, digest: digestValue(competingDraft) };
    ledger.entries[ledger.entries.length - 1] = competingEntry;
    ledger.headDigest = competingEntry.digest;
    const blobSha = objectSha();
    blobs.set(blobSha, `${JSON.stringify(ledger, null, 2)}\n`);
    const directoryTreeSha = objectSha();
    trees.set(directoryTreeSha, { entries: [{
      path: "collaboration-ledger.json", mode: "100644", type: "blob", sha: blobSha,
    }] });
    const rootTreeSha = objectSha();
    trees.set(rootTreeSha, { entries: [{
      path: ".agentic", mode: "040000", type: "tree", sha: directoryTreeSha,
    }] });
    const commitSha = objectSha();
    const key = `${ledgerRepository}:agentic/collaboration-ledger`;
    commits.set(commitSha, { tree: rootTreeSha, parents: [refs.get(key)] });
    refs.set(key, commitSha);
  }
  function ledgerContentForRevision(revision) {
    const commit = commits.get(revision);
    const rootTree = commit ? trees.get(commit.tree) : null;
    const directory = rootTree?.entries.find((entry) => entry.path === ".agentic");
    const directoryTree = directory ? trees.get(directory.sha) : null;
    const file = directoryTree?.entries.find((entry) => entry.path === "collaboration-ledger.json");
    return file ? blobs.get(file.sha) : null;
  }
  function replaceLedgerContent(revision, content) {
    const commit = commits.get(revision);
    const rootTree = commit ? trees.get(commit.tree) : null;
    const directory = rootTree?.entries.find((entry) => entry.path === ".agentic");
    const directoryTree = directory ? trees.get(directory.sha) : null;
    const file = directoryTree?.entries.find((entry) => entry.path === "collaboration-ledger.json");
    if (!file) return;
    blobs.set(file.sha, content);
  }
}
function repositoryIdentityValue(id, nodeId, fullName) {
  return { id, node_id: nodeId, full_name: fullName };
}
function repositoryValue(id, nodeId, fullName) {
  return { ...repositoryIdentityValue(id, nodeId, fullName), default_branch: "main" };
}
function pullRequestValue(overrides = {}) {
  return {
    id: 17, node_id: "PR_17", number: 17,
    html_url: `https://github.test/${targetRepository}/pull/17`, state: "open", draft: false,
    head: { ref: "agent/device/cloud-scope", sha: pullHeadSha, repo: { full_name: targetRepository } },
    base: { ref: "main", sha: targetMainSha, repo: { full_name: targetRepository } }, ...overrides,
  };
}
function pullRequestFilesValue(overrides = null) {
  if (Array.isArray(overrides)) return overrides.map((value) => ({ ...value }));
  return [
    { filename: "scripts/cloud/example.mjs", status: "modified" },
    { filename: "docs/cloud.md", status: "modified" },
  ];
}
function response(status, value, date) { return { status, value, date }; }
