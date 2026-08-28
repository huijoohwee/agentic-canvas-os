import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { readAuthoredRange, scanPrivateTaskRoot }
  from "../scripts/orphaned-absent-authored-lane-retirement-repository-adapter.mjs";
import { retirementOperationReceipt, retirementRequest, retirementRequestDigest }
  from "../scripts/orphaned-absent-authored-lane-retirement-store.mjs";

const sha = value => value.repeat(40).slice(0, 40);
const digest = value => value.repeat(64).slice(0, 64);

test("authored range proves an empty coordination fence and NUL-safe strict linear commits", () => {
  const baseSha = sha("1"), fenceSha = sha("2"), headSha = sha("3");
  const baseTree = sha("4"), headTree = sha("5");
  const calls = [];
  const git = argumentsList => {
    calls.push(argumentsList);
    const command = argumentsList.join(" ");
    if (command === `merge-base --is-ancestor ${fenceSha} ${headSha}`) return "";
    if (command === `rev-list --reverse --ancestry-path ${fenceSha}..${headSha}`) return headSha;
    if (command === `show -s --format=%P ${headSha}`) return fenceSha;
    if (command === `rev-parse ${headSha}^{tree}`) return headTree;
    if (command === `diff-tree --no-commit-id --name-only --no-renames -r -z ${headSha}`) {
      return " docs/leading.md\0docs/a file.md\0docs/runtime.md\0docs/trailing.md \0";
    }
    if (command === `show -s --format=%B ${headSha}`) return "subject\n\nAgentic-Task: scope";
    if (command === `show -s --format=%P ${fenceSha}`) return baseSha;
    if (command === `rev-parse ${fenceSha}^{tree}` || command === `rev-parse ${baseSha}^{tree}`) return baseTree;
    throw new Error(`unexpected git call: ${command}`);
  };

  const range = readAuthoredRange({ git, claim: {
    laneRevision: fenceSha, canonicalBaseRevision: baseSha,
  }, headSha });

  assert.equal(range.fenceParentSha, baseSha);
  assert.equal(range.fenceTreeSha, range.baseTreeSha);
  assert.deepEqual(range.changedPaths,
    [" docs/leading.md", "docs/a file.md", "docs/runtime.md", "docs/trailing.md "]);
  assert.ok(calls.some(call => call.includes("-z") && call.includes("--no-renames")));

  assert.throws(() => readAuthoredRange({ git: argumentsList => {
    const command = argumentsList.join(" ");
    if (command.startsWith("merge-base ")) return "";
    if (command.startsWith("rev-list ")) return headSha;
    if (command === `show -s --format=%P ${headSha}`) return `${fenceSha} ${baseSha}`;
    throw new Error("should stop at merge parent");
  }, claim: { laneRevision: fenceSha, canonicalBaseRevision: baseSha }, headSha }),
  /not strictly linear/u);
});

test("private task scan detects both the raw owner session and matching public authority", () => {
  const root = mkdtempSync(path.join(tmpdir(), "agentic-retirement-task-root-"));
  try {
    const sessionId = "owner-session";
    const authoritySubjectId = "urn:agentic-task:owner";
    const lane = path.join(root, sessionId, "lane");
    mkdirSync(lane, { recursive: true });
    writeFileSync(path.join(lane, "task-authority.json"), JSON.stringify({ authoritySubjectId }));

    const result = scanPrivateTaskRoot(root, {
      sessionId, taskAuthority: { authoritySubjectId },
    });
    assert.deepEqual(result.matches,
      ["matching-authority-subject", "matching-session-directory"]);
    assert.match(result.inventoryDigest, /^[0-9a-f]{64}$/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cloud retirement keeps finalRevision at the claim fence and seals semantic evidence", () => {
  const plan = { planDigest: digest("1"), evidence: {
    repository: { fullName: "owner/repository" },
    claim: { claimId: digest("2"), claimDigest: digest("3"), transitionCounter: 2,
      laneRevision: sha("4"), reviewRequestId: "github-pull-request:node",
      repositoryId: "github-repository:node", actorId: "github-user:1",
      deviceId: `device:${digest("4")}`, sessionId: `session:${digest("5")}` },
    marker: { device: "raw-device", sessionId: "raw-session",
      taskAuthority: { bindingDigest: digest("6") } },
    pullRequest: { immutableDigest: digest("7") },
    authoredRange: { rangeDigest: digest("8"), headSha: sha("9"), headTreeSha: sha("a"),
      changedPaths: ["docs/runtime.md"] },
    absence: { absenceDigest: digest("b") },
  } };
  const request = retirementRequest(plan, { ledgerDigest: digest("c") });

  assert.equal(request.finalRevision, plan.evidence.claim.laneRevision);
  assert.notEqual(request.finalRevision, plan.evidence.authoredRange.headSha);
  assert.equal(request.reason, "abandoned");
  assert.equal(request.integrationReceiptDigest, null);
  assert.match(retirementRequestDigest(plan), /^[0-9a-f]{64}$/u);
  assert.equal(request.bytesDigest, digestValue({ rangeDigest: plan.evidence.authoredRange.rangeDigest,
    headSha: plan.evidence.authoredRange.headSha,
    treeSha: plan.evidence.authoredRange.headTreeSha }));
  const entry = { action: "retire", repositoryId: plan.evidence.claim.repositoryId,
    claimId: plan.evidence.claim.claimId, claimDigest: digest("d"), digest: digest("e"),
    sequence: 10, idempotencyKey: digest("f"), requestDigest: retirementRequestDigest(plan),
    evaluationTime: "2026-08-28T15:47:00.000Z" };
  assert.match(retirementOperationReceipt(entry).receiptDigest, /^[0-9a-f]{64}$/u);
  assert.equal(Object.hasOwn(entry, "operationReceiptDigest"), false);
});
