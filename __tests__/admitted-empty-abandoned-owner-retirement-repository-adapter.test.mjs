import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildPlan } from "../scripts/admitted-empty-abandoned-owner-retirement-contract.mjs";
import { createController } from "../scripts/admitted-empty-abandoned-owner-retirement-controller.mjs";
import { applyCloudTransition, createEmptyLedger }
  from "../scripts/cloud-collaboration-contract.mjs";
import { canonicalJson, digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "../scripts/github-cloud-collaboration-mapping.mjs";
import { createRepositoryAdapter } from "../scripts/admitted-empty-abandoned-owner-retirement-repository-adapter.mjs";

test("repository adapter rejects a relative state path before any observation", () => {
  assert.throws(() => createRepositoryAdapter({ repository: process.cwd(), subjectWorktree: process.cwd(),
    authoredWorktree: process.cwd(), targetRepository: "owner/repo", pullRequestNumber: 1,
    claimId: "a".repeat(64), statePath: "relative.json" }), /absolute JSON/u);
});

test("repository adapter rejects a relative task authority capability", () => {
  assert.throws(() => createRepositoryAdapter({ repository: process.cwd(), subjectWorktree: process.cwd(),
    authoredWorktree: process.cwd(), targetRepository: "owner/repo", pullRequestNumber: 1,
    claimId: "a".repeat(64), statePath: path.join(tmpdir(), "retirement-state.json"),
    taskAuthorityFile: "relative-capability.json" }), /capability path must be absolute/u);
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
  cloud.claims[0].sessionId = pseudonymousIdentifier("session", "session");
  delete cloud.claims[0].deviceId;
  await assert.rejects(adapter.observe(), /device identity/u);
  cloud.claims[0].deviceId = pseudonymousIdentifier("device", "device");
  delete cloud.claims[0].sessionId;
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
  let failRetireBeforeEffect = true;
  const retireRequests = [], gitMutations = [], statePath = path.join(temporary, "state.json");
  const taskAuthorityFile = path.join(temporary, "task-authority.json");
  writeFileSync(taskAuthorityFile, "{}\n", { mode: 0o600 }); chmodSync(taskAuthorityFile, 0o600);
  const sourceControllerHead = "6".repeat(40), sourceControllerTree = "7".repeat(40);
  let controllerHead = sourceControllerHead, controllerTree = sourceControllerTree;
  let authorityCalls = 0, sourceHasV1Lock = false;
  let lease = { schema: "agentic-writer-lease/v2", status: "active",
    device: "device", sessionId: "session", branch,
    worktreePath: subject, baseSha: base, fenceSha: head,
    expiresAt: "2026-08-23T10:00:00.000Z", admission: { status: "planned" },
    cloudAuthority: { claimId }, taskAuthority: { bindingDigest: "f".repeat(64) } };
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
    if (command === "branch --show-current") return "main";
    if (command === "ls-remote --heads origin main") return `${controllerHead}\trefs/heads/main`;
    if (command === `ls-tree --name-only ${sourceControllerHead} -- scripts/private-operation-lock.mjs`) {
      return sourceHasV1Lock ? "scripts/private-operation-lock.mjs" : "";
    }
    if (command === `rev-parse ${sourceControllerHead}^{tree}`) return sourceControllerTree;
    if (command.startsWith("merge-base --is-ancestor ")) return "";
    if (command === "rev-parse HEAD" || command === "rev-parse origin/main") return controllerHead;
    if (command === "rev-parse HEAD^{tree}") return controllerTree;
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
  const readPull = () => JSON.stringify({ number: 7, id: nodeId,
    url: "https://example.test/pull/7", state: pullClosed ? "CLOSED" : "OPEN",
    isDraft: true, mergedAt: null, closedAt: pullClosed ? "2026-08-23T11:00:00.000Z" : null,
    headRefName: branch, headRefOid: head, baseRefName: "main",
    baseRefOid: retired ? controllerHead : base });
  const leaseStore = { read: () => lease,
    assertTaskAuthority: () => { authorityCalls += 1; return lease; },
    withRegistryLock: action => action({ leases: { [branch]: lease } }),
    release: ({ expectedLease, status, timestamp, values }) => {
      assert.deepEqual(lease, expectedLease);
      lease = { ...lease, ...values, status, heartbeatAt: timestamp, expiresAt: timestamp };
    } };
  const adapter = createRepositoryAdapter({ repository, subjectWorktree: subject,
    authoredWorktree: authored, targetRepository: "owner/repo", pullRequestNumber: 7,
    claimId, statePath, taskAuthorityFile }, { git, gitRaw,
    leaseStore, readCloud, readLedger: () => ledger,
    now: () => new Date("2026-08-23T11:00:00.000Z"),
    gh: readPull,
    execute: (command, args) => { if (command !== "gh" || args[0] !== "pr" || args[1] !== "close") {
      gitMutations.push([command, ...args]); throw new Error("unexpected mutation");
    }
    closeCalls += 1; pullClosed = true; return ""; },
    invokeCloud: ({ action, request }) => { assert.equal(action, "retire"); retireRequests.push(request);
      assert.equal(request.deviceId, lease.device);
      assert.equal(request.sessionId, lease.sessionId);
      if (failRetireBeforeEffect) {
        failRetireBeforeEffect = false;
        throw new Error("synthetic cloud retirement failure before effect");
      }
      transition = applyCloudTransition({ ledger, action: "retire", actor,
        repository: cloudRepository, evaluationTime: "2026-08-23T11:00:00.000Z",
        request: { ...request, expectedLedgerDigest: ledger.headDigest } });
      ledger = transition.ledger; retired = true;
      return { ok: true, operationReceipt: transition.operationReceipt }; } });
  const controller = createController({ adapter }), plan = await controller.plan();
  assert.equal(plan.subject.claim.laneRevision, head);
  assert.equal(plan.subject.claim.reviewRequestId, reviewRequestId);
  await assert.rejects(controller.run({ planDigest: plan.planDigest,
    authorization: plan.exactAuthorization }), /synthetic cloud retirement failure/u);
  const partial = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(partial.phase, "authorized");
  assert.equal(retired, false);
  assert.equal(pullClosed, false);
  assert.equal(lease.status, "active");
  transition = applyCloudTransition({ ledger, action: "retire", actor,
    repository: cloudRepository, evaluationTime: "2026-08-23T11:00:00.000Z",
    request: { ...retireRequests[0], expectedLedgerDigest: ledger.headDigest } });
  ledger = transition.ledger; retired = true;
  controllerHead = "8".repeat(40); controllerTree = "9".repeat(40);
  const lockPath = `${statePath}.lock`;
  writeFileSync(lockPath, `${canonicalJson({ context: { planDigest: plan.planDigest },
    pid: 2_147_483_647, token: "provably-dead-owner" })}\n`, { mode: 0o600 });
  chmodSync(lockPath, 0o600);
  sourceHasV1Lock = true;
  await assert.rejects(controller.run({ planDigest: plan.planDigest,
    authorization: plan.exactAuthorization }), /not authored by a pre-v1 controller/u);
  sourceHasV1Lock = false;
  writeFileSync(lockPath, `${canonicalJson({ context: { planDigest: "0".repeat(64) },
    pid: 2_147_483_647, token: "wrong-context" })}\n`, { mode: 0o600 });
  await assert.rejects(controller.run({ planDigest: plan.planDigest,
    authorization: plan.exactAuthorization }), /malformed or foreign/u);
  writeFileSync(lockPath, `${canonicalJson({ context: { planDigest: plan.planDigest },
    pid: process.pid, token: "live-owner" })}\n`, { mode: 0o600 });
  await assert.rejects(controller.run({ planDigest: plan.planDigest,
    authorization: plan.exactAuthorization }), /owner is live/u);
  writeFileSync(lockPath, `${canonicalJson({ context: { planDigest: plan.planDigest },
    pid: 2_147_483_647, token: "provably-dead-owner" })}\n`, { mode: 0o600 });
  const unprivileged = createController({ adapter: createRepositoryAdapter({ repository,
    subjectWorktree: subject, authoredWorktree: authored, targetRepository: "owner/repo",
    pullRequestNumber: 7, claimId, statePath }, { git, gitRaw,
    leaseStore, readCloud, readLedger: () => ledger, gh: readPull }) });
  await assert.rejects(unprivileged.run({ planDigest: plan.planDigest,
    authorization: plan.exactAuthorization }), /original task authority capability/u);
  const receipt = await controller.run({ planDigest: plan.planDigest,
    authorization: plan.exactAuthorization });
  const exactReleasedLease = structuredClone(lease);
  lease.admission = { status: "planned" };
  await assert.rejects(controller.run({ planDigest: plan.planDigest,
    authorization: plan.exactAuthorization }), /Local lease drifted/u);
  lease = structuredClone(exactReleasedLease);
  lease.admittedEmptyAbandonedOwnerRetirement.receiptDigest = "0".repeat(64);
  await assert.rejects(controller.run({ planDigest: plan.planDigest,
    authorization: plan.exactAuthorization }), /Local lease drifted/u);
  lease = exactReleasedLease;
  const replay = await controller.run({ planDigest: plan.planDigest,
    authorization: plan.exactAuthorization });
  assert.equal(replay.receiptDigest, receipt.receiptDigest);
  assert.equal(retireRequests.length, 1);
  assert.equal(retireRequests[0].finalRevision, head);
  assert.equal(retireRequests[0].reviewRequestId, reviewRequestId);
  assert.equal(retireRequests[0].deviceId, actor.deviceId);
  assert.equal(retireRequests[0].sessionId, actor.sessionId);
  assert.equal(closeCalls, 1);
  assert.deepEqual(gitMutations, []);
  assert.equal(lease.status, "released");
  assert.equal(authorityCalls > 0, true);
  assert.equal(readFileSync(statePath, "utf8").includes("protected-main-descendant"), true);
  assert.equal(existsSync(lockPath), false);
});

test("partial remote retirement follows canonical authored main and replays terminally", async t => {
  const temporary = mkdtempSync(path.join(tmpdir(), "empty-owner-resume-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const repository = "/repo", subject = "/subject", authored = path.resolve(".");
  const base = "1".repeat(40), head = "2".repeat(40), tree = "3".repeat(40);
  const branch = "agent/device/empty";
  const nodeId = "PR_7", reviewRequestId = `github-pull-request:${nodeId}`;
  const actor = { actorId: "actor:owner", deviceId: "device", sessionId: "session" };
  const cloudRepository = { repositoryId: "repository:target", canonicalRevision: base };
  let transition = applyCloudTransition({ ledger: createEmptyLedger("owner/ledger"), action: "claim",
    actor, repository: cloudRepository, evaluationTime: "2026-08-23T08:00:00.000Z",
    request: { workItemId: "work:empty-owner-resume", canonicalBaseRevision: base,
      declaredWriteScope: ["path:docs/empty.md", "semantic:empty-owner-resume"],
      laneRevision: base, leaseEpoch: 1, expiresAt: "2026-08-23T10:00:00.000Z",
      expectedLedgerDigest: null, idempotencyKey: "claim:empty-owner-resume" } });
  transition = applyCloudTransition({ ledger: transition.ledger, action: "continue", actor,
    repository: cloudRepository, evaluationTime: "2026-08-23T08:10:00.000Z",
    request: { claimId: transition.claim.claimId, expectedFenceRevision: transition.claim.fenceRevision,
      expectedTransitionCounter: transition.claim.transitionCounter,
      expectedLedgerDigest: transition.ledger.headDigest, mode: "projection", laneRevision: head,
      reviewRequestId, idempotencyKey: "project:empty-owner-resume" } });
  const claimId = transition.claim.claimId, sourceStatePath = path.join(temporary, "source.json");
  const resumeStatePath = path.join(temporary, "resume.json");
  const taskAuthorityFile = path.join(temporary, "task-authority.json");
  writeFileSync(taskAuthorityFile, "{}\n", { mode: 0o600 }); chmodSync(taskAuthorityFile, 0o600);
  let ledger = transition.ledger, retired = false, pullClosed = false;
  let controllerHead = "6".repeat(40), controllerTree = "7".repeat(40), unrelatedClaim = null;
  let authoredBranch = "main", mergeBaseAccepted = true;
  let authorityProofs = 0, releaseAttempts = 0, closeCalls = 0, cloudRetireCalls = 0;
  let lease = { status: "active", device: actor.deviceId, sessionId: actor.sessionId, branch,
    worktreePath: subject, baseSha: base, fenceSha: head,
    expiresAt: "2026-08-23T10:00:00.000Z", admission: { status: "planned" },
    cloudAuthority: { claimId }, taskAuthority: { bindingDigest: "f".repeat(64) } };
  const git = (cwd, args) => { const command = args.join(" ");
    if (command === "rev-parse --path-format=absolute --git-common-dir") return "/git-common";
    if (cwd === subject && command === "branch --show-current") return branch;
    if (cwd === subject && command === "rev-parse HEAD") return head;
    if (cwd === subject && command === "rev-parse HEAD^{tree}") return tree;
    if (cwd === subject && command === "show -s --format=%P HEAD") return base;
    if (cwd === subject && command === `rev-parse ${base}^{tree}`) return tree;
    if (cwd === subject && command === "diff-tree --no-commit-id --name-only -r HEAD") return "";
    if ((cwd === authored || cwd === "/foreign-authored") && command === "branch --show-current") {
      return authoredBranch;
    }
    if ((cwd === authored || cwd === "/foreign-authored") && command === "rev-parse HEAD") {
      return controllerHead;
    }
    if ((cwd === authored || cwd === "/foreign-authored") && command === "rev-parse HEAD^{tree}") {
      return controllerTree;
    }
    if (cwd === repository && command === `ls-remote --heads origin ${branch}`) {
      return `${head}\trefs/heads/${branch}`;
    }
    if (command.startsWith("merge-base --is-ancestor ")) {
      if (!mergeBaseAccepted) throw new Error("not an ancestor");
      return "";
    }
    if (command === "rev-parse HEAD" || command === "rev-parse origin/main") return controllerHead;
    if (command === "rev-parse HEAD^{tree}") return controllerTree;
    throw new Error(`unexpected git ${cwd} ${command}`); };
  const gitRaw = (cwd, args) => { const command = args.join(" ");
    if (cwd === repository && command === "worktree list --porcelain -z") {
      return `worktree ${subject}\0HEAD ${head}\0branch refs/heads/${branch}\0worktree ${authored}\0HEAD ${controllerHead}\0branch refs/heads/${authoredBranch}\0worktree /foreign-authored\0HEAD ${controllerHead}\0branch refs/heads/${authoredBranch}\0`;
    }
    if (command === "status --porcelain=v1 --untracked-files=all") return "";
    throw new Error(`unexpected raw git ${cwd} ${command}`); };
  const readCloud = () => ({ schema: "agentic-cloud-collaboration-result/v1", ok: true,
    claims: retired ? (unrelatedClaim ? [unrelatedClaim] : []) : [{ ...transition.claim,
      state: "dormant-preserved", writeAuthority: false, scopeReserved: true,
      deviceId: pseudonymousIdentifier("device", actor.deviceId),
      sessionId: pseudonymousIdentifier("session", actor.sessionId) }],
    sequence: ledger.sequence, ledgerRevision: controllerHead, ledgerDigest: ledger.headDigest });
  const leaseStore = { read: () => lease,
    assertTaskAuthority: () => { authorityProofs += 1; return lease; },
    release: ({ expectedLease, status, timestamp, values }) => {
      releaseAttempts += 1;
      assert.deepEqual(lease, expectedLease);
      if (!values.admittedEmptyAbandonedOwnerRetirement?.resumePlanDigest) {
        throw new Error("task authority capability path must be absolute");
      }
      lease = { ...lease, ...values, status, heartbeatAt: timestamp, expiresAt: timestamp };
      return lease;
    } };
  const dependencies = { git, gitRaw, leaseStore, readCloud, readLedger: () => ledger,
    now: () => new Date("2026-08-23T11:00:00.000Z"),
    gh: () => JSON.stringify({ number: 7, id: nodeId, url: "https://example.test/pull/7",
      state: pullClosed ? "CLOSED" : "OPEN", isDraft: true, mergedAt: null,
      closedAt: pullClosed ? "2026-08-23T11:00:00.000Z" : null,
      headRefName: branch, headRefOid: head, baseRefName: "main", baseRefOid: base }),
    execute: (command, args) => { assert.equal(command, "gh"); assert.equal(args[1], "close");
      closeCalls += 1; pullClosed = true; return ""; },
    invokeCloud: ({ action, request }) => { assert.equal(action, "retire"); cloudRetireCalls += 1;
      transition = applyCloudTransition({ ledger, action: "retire", actor,
        repository: cloudRepository, evaluationTime: "2026-08-23T11:00:00.000Z",
        request: { ...request, expectedLedgerDigest: ledger.headDigest } });
      ledger = transition.ledger; retired = true;
      return { ok: true, operationReceipt: transition.operationReceipt }; } };
  const sourceAdapter = createRepositoryAdapter({ repository, subjectWorktree: subject,
    authoredWorktree: authored, targetRepository: "owner/repo", ledgerRepository: "owner/ledger",
    pullRequestNumber: 7, claimId, statePath: sourceStatePath }, dependencies);
  const sourceController = createController({ adapter: sourceAdapter });
  const sourcePlan = await sourceController.plan();
  await assert.rejects(sourceController.run({ planDigest: sourcePlan.planDigest,
    authorization: sourcePlan.exactAuthorization }), /capability path must be absolute/u);
  const sourceBytes = readFileSync(sourceStatePath, "utf8");
  assert.equal(JSON.parse(sourceBytes).phase, "pull-request-closed");
  assert.equal(cloudRetireCalls, 1); assert.equal(closeCalls, 1); assert.equal(releaseAttempts, 1);

  controllerHead = "a".repeat(40); controllerTree = "b".repeat(40);
  authoredBranch = "agent/device/foreign";
  const wrongBranchAdapter = createRepositoryAdapter({ repository, subjectWorktree: subject,
    authoredWorktree: authored, targetRepository: "owner/repo", ledgerRepository: "owner/ledger",
    pullRequestNumber: 7, claimId, statePath: path.join(temporary, "wrong-branch.json"),
    sourceStatePath, taskAuthorityFile }, dependencies);
  assert.throws(() => wrongBranchAdapter.observeResume(), /canonical authored lane/u);
  authoredBranch = "main";

  const wrongPathAdapter = createRepositoryAdapter({ repository, subjectWorktree: subject,
    authoredWorktree: "/foreign-authored", targetRepository: "owner/repo",
    ledgerRepository: "owner/ledger", pullRequestNumber: 7, claimId,
    statePath: path.join(temporary, "wrong-path.json"), sourceStatePath,
    taskAuthorityFile }, dependencies);
  assert.throws(() => wrongPathAdapter.observeResume(), /canonical authored lane/u);

  mergeBaseAccepted = false;
  assert.throws(() => wrongBranchAdapter.observeResume(), /not a protected descendant/u);
  mergeBaseAccepted = true;
  const resumeAdapter = createRepositoryAdapter({ repository, subjectWorktree: subject,
    authoredWorktree: authored, targetRepository: "owner/repo", ledgerRepository: "owner/ledger",
    pullRequestNumber: 7, claimId, statePath: resumeStatePath, sourceStatePath,
    taskAuthorityFile }, dependencies);
  const resumeController = createController({ adapter: resumeAdapter });
  const resumePlan = await resumeController.resumePlan();
  assert.equal(resumePlan.recovery.pullRequestClosedAt, "2026-08-23T11:00:00.000Z");
  assert.equal(resumePlan.recovery.taskAuthorityBindingDigest, lease.taskAuthority.bindingDigest);
  assert.equal(resumePlan.recovery.authoredLaneDisposition, "protected-main-descendant");
  assert.equal(resumePlan.recovery.authoredLaneHeadSha, controllerHead);

  controllerHead = "e".repeat(40); controllerTree = "f".repeat(40);
  await assert.rejects(resumeController.resumeRun({ planDigest: resumePlan.planDigest,
    authorization: resumePlan.exactAuthorization }), /evidence drifted|controller drifted/u);
  controllerHead = "a".repeat(40); controllerTree = "b".repeat(40);

  const unrelatedActor = { actorId: "actor:peer", deviceId: "peer-device", sessionId: "peer-session" };
  const unrelated = applyCloudTransition({ ledger, action: "claim", actor: unrelatedActor,
    repository: cloudRepository, evaluationTime: "2026-08-23T11:01:00.000Z",
    request: { workItemId: "work:unrelated", canonicalBaseRevision: base,
      declaredWriteScope: ["path:docs/unrelated.md", "semantic:unrelated"], laneRevision: base,
      leaseEpoch: 1, expiresAt: "2026-08-23T12:00:00.000Z",
      expectedLedgerDigest: ledger.headDigest, idempotencyKey: "claim:unrelated" } });
  ledger = unrelated.ledger; unrelatedClaim = unrelated.claim;
  const receipt = await resumeController.resumeRun({ planDigest: resumePlan.planDigest,
    authorization: resumePlan.exactAuthorization });
  assert.equal(receipt.sourceStateDigest, JSON.parse(sourceBytes).stateDigest);
  assert.equal(readFileSync(sourceStatePath, "utf8"), sourceBytes);
  assert.equal(cloudRetireCalls, 1); assert.equal(closeCalls, 1); assert.equal(releaseAttempts, 2);
  assert.equal(lease.status, "released"); assert.equal(lease.admission, null);
  assert.equal(lease.cloudAuthority, null);

  controllerHead = "c".repeat(40); controllerTree = "d".repeat(40);
  const replay = await resumeController.resumeRun({ planDigest: resumePlan.planDigest,
    authorization: resumePlan.exactAuthorization });
  assert.equal(replay.receiptDigest, receipt.receiptDigest);
  assert.equal(releaseAttempts, 2);
  assert.ok(authorityProofs >= 2);

  lease.admittedEmptyAbandonedOwnerRetirement.completedAt = "2026-08-23T11:05:00.000Z";
  const changedReceipt = { ...lease.admittedEmptyAbandonedOwnerRetirement };
  delete changedReceipt.receiptDigest;
  lease.admittedEmptyAbandonedOwnerRetirement.receiptDigest = digestValue(changedReceipt);
  await assert.rejects(resumeController.resumeRun({ planDigest: resumePlan.planDigest,
    authorization: resumePlan.exactAuthorization }), /terminal evidence drifted/u);

  const currentResumeState = JSON.parse(readFileSync(resumeStatePath, "utf8"));
  assert.throws(() => resumeAdapter.writeState({ expected: currentResumeState,
    next: JSON.parse(sourceBytes) }), /schema cannot change/u);
});
