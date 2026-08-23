import assert from "node:assert/strict";
import test from "node:test";
import { createController } from "../scripts/admitted-empty-abandoned-owner-retirement-controller.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";

const sha = value => value.repeat(40).slice(0, 40), digest = value => value.repeat(64).slice(0, 64);
function fixture() { const base = sha("1"), head = sha("2"), tree = sha("3"), branch = "agent/device/empty";
  return { observedAt: "2026-08-23T11:00:00.000Z", subject: { repository: "owner/repo", path: "/work/empty",
    branch, headSha: head, headTreeSha: tree, baseSha: base, baseTreeSha: tree, parentShas: [base], changedPaths: [],
    clean: true, registered: true, remoteHeadSha: head, stateDigest: digest("c"), lease: { status: "active",
      sessionId: "session", branch, worktreePath: "/work/empty", baseSha: base, fenceSha: head,
      expiresAt: "2026-08-23T10:00:00.000Z", admissionStatus: "planned", claimId: digest("a"), digest: digest("b") },
    claim: { claimId: digest("a"), claimDigest: digest("d"), state: "dormant-preserved", writeAuthority: false,
      scopeReserved: true, laneRevision: base, canonicalBaseRevision: base, transitionCounter: 1,
      reviewRequestId: null, expiresAt: "2026-08-23T10:00:00.000Z" }, pullRequest: { number: 7, nodeId: "PR_7",
      url: "https://example.test/pull/7", state: "OPEN", isDraft: true, mergedAt: null,
      headBranch: branch, headSha: head, baseBranch: "main", baseSha: base } },
    authoredLane: { path: "/work/authored", branch: "agent/device/authored", headSha: sha("4"), treeSha: sha("5"),
      clean: true, registered: true, statusDigest: digest("e"), stateDigest: digest("f") },
    controller: { headSha: sha("6"), originMainSha: sha("6"), treeSha: sha("7"), runtimeDigest: digest("8"), clean: true, protected: true },
    cloud: { ledgerRepository: "owner/ledger", ledgerRevision: sha("9"), ledgerDigest: digest("9"), sequence: 3 } }; }

test("plan persists once and run reuses that exact authorization subject", async () => {
  const calls = [], evidence = fixture(); let state = null, claim = true, pull = true, owner = true;
  const adapter = { observe: async () => evidence, readState: async () => state,
    writeState: async ({ expected, next }) => { assert.equal(state?.stateDigest || null, expected?.stateDigest || null); state = next; return state; },
    withLock: async (_context, action) => action(),
    classifyClaim: async () => claim ? { state: "pending" } : { state: "complete", values: { cloudMutation: true } },
    retireClaim: async () => { calls.push("cloud"); claim = false; },
    classifyPullRequest: async () => pull ? { state: "pending" } : { state: "complete", values: { providerMutation: true } },
    closePullRequest: async () => { calls.push("provider"); pull = false; },
    classifyOwnerReleased: async () => owner ? { state: "pending" } : { state: "complete", values: { localMutation: true } },
    releaseOwner: async () => { calls.push("local"); owner = false; },
    verifyTerminal: async () => ({ terminalEvidenceDigest: digestValue({ terminal: true }) }) };
  const controller = createController({ adapter }), plan = await controller.plan();
  evidence.observedAt = "2026-08-23T12:00:00.000Z";
  const receipt = await controller.run({ planDigest: plan.planDigest, authorization: plan.exactAuthorization });
  assert.deepEqual(calls, ["cloud", "provider", "local"]); assert.equal(receipt.planDigest, plan.planDigest);
  assert.equal(state.phase, "complete");
});

test("wrong authorization has zero effects", async () => { let state = null, effects = 0; const evidence = fixture();
  const adapter = { observe: async () => evidence, readState: async () => state,
    writeState: async ({ next }) => (state = next), withLock: async (_context, action) => action(),
    classifyClaim: async () => { effects += 1; }, retireClaim: async () => {}, classifyPullRequest: async () => {},
    closePullRequest: async () => {}, classifyOwnerReleased: async () => {}, releaseOwner: async () => {}, verifyTerminal: async () => ({}) };
  const controller = createController({ adapter }), plan = await controller.plan();
  await assert.rejects(controller.run({ planDigest: plan.planDigest, authorization: "wrong" }), /Exact authorization/u);
  assert.equal(effects, 0);
});
