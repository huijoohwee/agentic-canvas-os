import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildPlan } from "../scripts/admitted-empty-abandoned-owner-retirement-contract.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
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
  const lease = { status: "active", sessionId: "session", branch, worktreePath: subject,
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
});
