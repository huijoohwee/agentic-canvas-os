import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildPlan } from "../scripts/admitted-empty-abandoned-owner-retirement-contract.mjs";
import { createController } from "../scripts/admitted-empty-abandoned-owner-retirement-controller.mjs";
import { applyCloudTransition, createEmptyLedger }
  from "../scripts/cloud-collaboration-contract.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "../scripts/github-cloud-collaboration-mapping.mjs";
import { createRepositoryAdapter } from "../scripts/admitted-empty-abandoned-owner-retirement-repository-adapter.mjs";

test("repository adapter rejects a relative state path before any observation", () => {
  assert.throws(() => createRepositoryAdapter({ repository: process.cwd(), subjectWorktree: process.cwd(),
    authoredWorktree: process.cwd(), targetRepository: "owner/repo", pullRequestNumber: 1,
    claimId: "a".repeat(64), statePath: "relative.json" }), /absolute JSON/u);
});

test("repository observation joins an expired planned fence commit to a distinct authored lane", async t => {
  const temporary = mkdtempSync(path.join(tmpdir(), "empty-owner-adapter-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const repository = "/repo", subject = "/subject", authored = "/authored";
  const base = "1".repeat(40), head = "2".repeat(40), tree = "3".repeat(40), authoredHead = "4".repeat(40);
  const claimId = "a".repeat(64), branch = "agent/device/empty";
  const lease = { status: "active", device: "device", sessionId: "session", branch, worktreePath: subject,
    baseSha: base, fenceSha: head, expiresAt: "2026-08-23T10:00:00.000Z",
    admission: { status: "planned" }, cloudAuthority: { claimId } };
  const git = (cwd, args) => { const command = args.join(" ");
    if (command === "rev-parse --path-format=absolute --git-common-dir") return "/git-common";
    if (cwd === subject && command === "branch --show-current") return branch;
    if (cwd === subject && command === "rev-parse HEAD") return head;
    if (cwd === subject && command === "rev-parse HEAD^{tree}") return tree;
    if (cwd === subject && command === "show -s --format=%P HEAD") return base;
    if (cwd === subject && command === `rev-parse ${base}^{tree}`) return tree;
    if (cwd === subject && command === "diff-tree --no-commit-id --name-only -r HEAD") return "";
    if (cwd === authored && command === "branch --show-current") return "agent/device/authored";
    if (cwd === authored && command === "rev-parse HEAD") return authoredHead;
    if (cwd === authored && command === "rev-parse HEAD^{tree}") return "5".repeat(40);
    if (cwd === repository && command === `ls-remote --heads origin ${branch}`) return `${head}\trefs/heads/${branch}`;
    if (command === "rev-parse HEAD" || command === "rev-parse origin/main") return "6".repeat(40);
    if (command === "rev-parse HEAD^{tree}") return "7".repeat(40);
    throw new Error(`unexpected git ${cwd} ${command}`); };
  const gitRaw = (cwd, args) => { const command = args.join(" ");
    if (cwd === repository && command === "worktree list --porcelain -z") return `worktree ${subject}\0HEAD ${head}\0branch refs/heads/${branch}\0worktree ${authored}\0HEAD ${authoredHead}\0branch refs/heads/agent/device/authored\0`;
    if (command === "status --porcelain=v1 --untracked-files=all") return "";
    throw new Error(`unexpected raw git ${cwd} ${command}`); };
  const cloud = { schema: "agentic-cloud-collaboration-result/v1", ok: true, claims: [{ claimId,
    fenceRevision: "b".repeat(64), state: "dormant-preserved", writeAuthority: false, scopeReserved: true,
    deviceId: pseudonymousIdentifier("device", "device"),
    sessionId: pseudonymousIdentifier("session", "session"),
    laneRevision: base, canonicalBaseRevision: base, transitionCounter: 1, reviewRequestId: null,
    expiresAt: "2026-08-23T10:00:00.000Z" }], sequence: 4, ledgerRevision: "8".repeat(40), ledgerDigest: "9".repeat(64) };
  const adapter = createRepositoryAdapter({ repository, subjectWorktree: subject, authoredWorktree: authored,
    targetRepository: "owner/repo", pullRequestNumber: 7, claimId,
    statePath: path.join(temporary, "state.json") }, { git, gitRaw, leaseStore: { read: () => lease },
    readCloud: () => cloud, now: () => new Date("2026-08-23T11:00:00.000Z"),
    gh: () => JSON.stringify({ number: 7, id: "PR_7", url: "https://example.test/pull/7", state: "OPEN",
      isDraft: true, mergedAt: null, closedAt: null, headRefName: branch, headRefOid: head,
      baseRefName: "main", baseRefOid: base }) });
  const plan = buildPlan(await adapter.observe());
  assert.equal(plan.subject.changedPaths.length, 0);
  assert.equal(plan.subject.lease.digest, digestValue(lease));
  assert.equal(plan.authoredLane.headSha, authoredHead);

  cloud.claims[0].deviceId = "foreign-device";
  await assert.rejects(adapter.observe(), /device identity/u);
  cloud.claims[0].deviceId = pseudonymousIdentifier("device", "device");
  cloud.claims[0].sessionId = "foreign-session";
  await assert.rejects(adapter.observe(), /session identity/u);
});

test("PR-bound retirement preserves Git projections and replays terminally", async t => {
  const temporary = mkdtempSync(path.join(tmpdir(), "empty-owner-pr-bound-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const repository = "/repo", subject = "/subject", authored = "/authored";
  const base = "1".repeat(40), head = "2".repeat(40), tree = "3".repeat(40);
  const authoredHead = "4".repeat(40), branch = "agent/device/empty";
  const nodeId = "PR_7", reviewRequestId = `github-pull-request:${nodeId}`;
  const actor = { actorId: "actor:owner", deviceId: "device", sessionId: "session" };
  const cloudRepository = { repositoryId: "repository:target", canonicalRevision: base };
  const declaredWriteScope = ["path:docs/empty.md", "semantic:empty-owner"];
  let transition = applyCloudTransition({ ledger: createEmptyLedger("owner/ledger"), action: "claim",
    actor, repository: cloudRepository, evaluationTime: "2026-08-23T08:00:00.000Z",
    request: { workItemId: "work:empty-owner", canonicalBaseRevision: base,
      declaredWriteScope, laneRevision: base, leaseEpoch: 1,
      expiresAt: "2026-08-23T10:00:00.000Z", expectedLedgerDigest: null,
      idempotencyKey: "claim:empty-owner" } });
  transition = applyCloudTransition({ ledger: transition.ledger, action: "continue", actor,
    repository: cloudRepository, evaluationTime: "2026-08-23T08:10:00.000Z",
    request: { claimId: transition.claim.claimId,
      expectedFenceRevision: transition.claim.fenceRevision,
      expectedTransitionCounter: transition.claim.transitionCounter,
      expectedLedgerDigest: transition.ledger.headDigest, mode: "projection",
      laneRevision: head, reviewRequestId, idempotencyKey: "project:empty-owner" } });
  const claimId = transition.claim.claimId;
  let ledger = transition.ledger, retired = false, pullClosed = false, closeCalls = 0;
  const retireRequests = [], gitMutations = [];
  let lease = { status: "active", device: "device", sessionId: "session", branch,
    worktreePath: subject, baseSha: base, fenceSha: head,
    expiresAt: "2026-08-23T10:00:00.000Z", admission: { status: "planned" },
    cloudAuthority: { claimId } };
  const git = (cwd, args) => { const command = args.join(" ");
    if (command === "rev-parse --path-format=absolute --git-common-dir") return "/git-common";
    if (cwd === subject && command === "branch --show-current") return branch;
    if (cwd === subject && command === "rev-parse HEAD") return head;
    if (cwd === subject && command === "rev-parse HEAD^{tree}") return tree;
    if (cwd === subject && command === "show -s --format=%P HEAD") return base;
    if (cwd === subject && command === `rev-parse ${base}^{tree}`) return tree;
    if (cwd === subject && command === "diff-tree --no-commit-id --name-only -r HEAD") return "";
    if (cwd === authored && command === "branch --show-current") return "agent/device/authored";
    if (cwd === authored && command === "rev-parse HEAD") return authoredHead;
    if (cwd === authored && command === "rev-parse HEAD^{tree}") return "5".repeat(40);
    if (cwd === repository && command === `ls-remote --heads origin ${branch}`) {
      return `${head}\trefs/heads/${branch}`;
    }
    if (command === "rev-parse HEAD" || command === "rev-parse origin/main") return "6".repeat(40);
    if (command === "rev-parse HEAD^{tree}") return "7".repeat(40);
    throw new Error(`unexpected git ${cwd} ${command}`); };
  const gitRaw = (cwd, args) => { const command = args.join(" ");
    if (cwd === repository && command === "worktree list --porcelain -z") {
      return `worktree ${subject}\0HEAD ${head}\0branch refs/heads/${branch}\0worktree ${authored}\0HEAD ${authoredHead}\0branch refs/heads/agent/device/authored\0`;
    }
    if (command === "status --porcelain=v1 --untracked-files=all") return "";
    throw new Error(`unexpected raw git ${cwd} ${command}`); };
  const readCloud = () => ({ schema: "agentic-cloud-collaboration-result/v1", ok: true,
    claims: retired ? [] : [{ ...transition.claim, state: "dormant-preserved",
      writeAuthority: false, scopeReserved: true,
      deviceId: pseudonymousIdentifier("device", lease.device),
      sessionId: pseudonymousIdentifier("session", lease.sessionId) }],
    sequence: ledger.sequence, ledgerRevision: "8".repeat(40), ledgerDigest: ledger.headDigest });
  const adapter = createRepositoryAdapter({ repository, subjectWorktree: subject,
    authoredWorktree: authored, targetRepository: "owner/repo", pullRequestNumber: 7,
    claimId, statePath: path.join(temporary, "state.json") }, { git, gitRaw,
    leaseStore: { read: () => lease, release: ({ expectedLease, status, timestamp, values }) => {
      assert.deepEqual(lease, expectedLease); lease = { ...lease, status, releasedAt: timestamp, ...values };
    } }, readCloud, readLedger: () => ledger,
    now: () => new Date("2026-08-23T11:00:00.000Z"),
    gh: () => JSON.stringify({ number: 7, id: nodeId, url: "https://example.test/pull/7",
      state: pullClosed ? "CLOSED" : "OPEN", isDraft: true, mergedAt: null,
      closedAt: pullClosed ? "2026-08-23T11:00:00.000Z" : null,
      headRefName: branch, headRefOid: head, baseRefName: "main", baseRefOid: base }),
    execute: (command, args) => { if (command !== "gh" || args[0] !== "pr" || args[1] !== "close") {
      gitMutations.push([command, ...args]); throw new Error("unexpected mutation");
    }
    closeCalls += 1; pullClosed = true; return ""; },
    invokeCloud: ({ action, request }) => { assert.equal(action, "retire"); retireRequests.push(request);
      transition = applyCloudTransition({ ledger, action: "retire", actor,
        repository: cloudRepository, evaluationTime: "2026-08-23T11:00:00.000Z",
        request: { ...request, expectedLedgerDigest: ledger.headDigest } });
      ledger = transition.ledger; retired = true;
      return { ok: true, operationReceipt: transition.operationReceipt }; } });
  const controller = createController({ adapter }), plan = await controller.plan();
  assert.equal(plan.subject.claim.laneRevision, head);
  assert.equal(plan.subject.claim.reviewRequestId, reviewRequestId);
  const receipt = await controller.run({ planDigest: plan.planDigest,
    authorization: plan.exactAuthorization });
  const replay = await controller.run({ planDigest: plan.planDigest,
    authorization: plan.exactAuthorization });
  assert.equal(replay.receiptDigest, receipt.receiptDigest);
  assert.equal(retireRequests.length, 1);
  assert.equal(retireRequests[0].finalRevision, head);
  assert.equal(retireRequests[0].reviewRequestId, reviewRequestId);
  assert.equal(closeCalls, 1);
  assert.deepEqual(gitMutations, []);
  assert.equal(lease.status, "released");
});
