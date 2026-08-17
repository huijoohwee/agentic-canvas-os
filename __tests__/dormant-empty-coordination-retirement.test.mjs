import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  buildDormantEmptyCoordinationRetirementEvidence,
} from "../scripts/dormant-empty-coordination-retirement-evidence.mjs";
import {
  createDormantEmptyCoordinationRetirementController,
} from "../scripts/dormant-empty-coordination-retirement-controller.mjs";
import {
  advanceDormantEmptyCoordinationRetirementIntent,
  authorizeDormantEmptyCoordinationRetirement,
  buildDormantEmptyCoordinationRetirementPlan,
  createDormantEmptyCoordinationRetirementIntent,
  dormantEmptyCoordinationRetirementOperationKey,
} from "../scripts/dormant-empty-coordination-retirement-contract.mjs";
import {
  createRepositoryDormantEmptyCoordinationRetirementAdapter,
} from "../scripts/dormant-empty-coordination-retirement-repository-adapter.mjs";
import {
  createDormantEmptyCoordinationRetirementStore,
} from "../scripts/dormant-empty-coordination-retirement-store.mjs";
import { pseudonymousIdentifier } from
  "../scripts/github-cloud-collaboration-mapping.mjs";
import { main as cliMain } from "../scripts/dormant-empty-coordination-retirement.mjs";

const DIGEST = Object.freeze({
  claim: "1".repeat(64), successor: "2".repeat(64), write: "3".repeat(64),
  transition: "4".repeat(64), operation: "5".repeat(64), marker: "6".repeat(64),
  body: "7".repeat(64), root: "8".repeat(64), runtime: "9".repeat(64),
  ledger: "a".repeat(64), inventory: "b".repeat(64), sourceEntry: "c".repeat(64),
  successorEntry: "d".repeat(64), local: "e".repeat(64), receipt: "f".repeat(64),
});
const SHA = Object.freeze({ base: "1".repeat(40), head: "2".repeat(40),
  main: "3".repeat(40), tree: "4".repeat(40), controller: "5".repeat(40),
  controllerTree: "6".repeat(40), ledger: "7".repeat(40) });

test("wrong exact authorization has zero effects", async () => {
  const fixture = fakeRuntime();
  const plan = await fixture.controller.plan();
  await assert.rejects(fixture.controller.run({ planDigest: plan.planDigest,
    authorization: `${plan.exactAuthorization}-wrong` }), /Exact authorization required/u);
  assert.deepEqual(fixture.effects, []);
  assert.equal(fixture.readIntent(), null);
});

test("retires before close, adopts after-effect response loss, and terminal replay is inert", async () => {
  const fixture = fakeRuntime({ loseResponses: true });
  const plan = await fixture.controller.plan();
  const receipt = await fixture.controller.run({ planDigest: plan.planDigest,
    authorization: plan.exactAuthorization });

  assert.equal(receipt.status, "complete");
  assert.equal(receipt.cloudMutation, true);
  assert.equal(receipt.providerMutation, false);
  assert.deepEqual(fixture.effects, ["retire-claim", "close-pr", "verify"]);
  assert.equal(fixture.readIntent().phases["claim-retired"].values.disposition, "adopted");
  assert.equal(fixture.readIntent().phases["pr-closed"].values.disposition, "adopted");

  const replay = await fixture.controller.run({ planDigest: plan.planDigest,
    authorization: plan.exactAuthorization });
  assert.equal(replay.receiptDigest, receipt.receiptDigest);
  assert.deepEqual(fixture.effects, ["retire-claim", "close-pr", "verify", "verify"]);
});

test("precompleted targets are adopted without claiming a provider mutation", async () => {
  const fixture = fakeRuntime({ claimRetired: true, pullRequestClosed: true });
  const plan = await fixture.controller.plan();
  const receipt = await fixture.controller.run({ planDigest: plan.planDigest,
    authorization: plan.exactAuthorization });
  assert.equal(receipt.cloudMutation, false);
  assert.equal(receipt.providerMutation, false);
  assert.deepEqual(fixture.effects, ["verify"]);
});

test("a confirmed close reports the provider mutation", async () => {
  const fixture = fakeRuntime();
  const plan = await fixture.controller.plan();
  const receipt = await fixture.controller.run({ planDigest: plan.planDigest,
    authorization: plan.exactAuthorization });
  assert.equal(receipt.providerMutation, true);
  assert.deepEqual(fixture.effects, ["retire-claim", "close-pr", "verify"]);
});

test("a third classifier state and subject drift fail closed", async t => {
  await t.test("third state", async () => {
    const fixture = fakeRuntime({ claimClassification: "foreign" });
    const plan = await fixture.controller.plan();
    await assert.rejects(fixture.controller.run({ planDigest: plan.planDigest,
      authorization: plan.exactAuthorization }), /classification is malformed/u);
    assert.deepEqual(fixture.effects, []);
  });
  await t.test("live subject drift", async () => {
    const fixture = fakeRuntime({ driftAtClaim: true });
    const plan = await fixture.controller.plan();
    await assert.rejects(fixture.controller.run({ planDigest: plan.planDigest,
      authorization: plan.exactAuthorization }), /subject drifted/u);
    assert.deepEqual(fixture.effects, []);
  });
});

test("CLI binds exact subject options and forwards only plan or authorized run", async () => {
  const calls = [];
  const controller = { plan: async () => ({ status: "planned" }),
    run: async input => (calls.push(input), { status: "complete" }) };
  const common = ["--repository=/tmp/controller", "--target-repository=owner/repo",
    "--pull-request=509", `--claim-id=${DIGEST.claim}`,
    `--waiting-successor-claim-id=${DIGEST.successor}`, "--json"];
  assert.deepEqual(await cliMain(["plan", ...common], {
    createAdapter: options => (calls.push(options), {}),
    createController: () => controller,
  }), { status: "planned" });
  assert.deepEqual(await cliMain(["run", ...common, `--plan-digest=${DIGEST.ledger}`,
    `--authorize=authorize dormant-empty-coordination-retirement ${DIGEST.ledger}`], {
    createAdapter: () => ({}), createController: () => controller,
  }), { status: "complete" });
  assert.deepEqual(calls.at(-1), { planDigest: DIGEST.ledger,
    authorization: `authorize dormant-empty-coordination-retirement ${DIGEST.ledger}` });
});

test("durable store creates an absent parent, enforces exact CAS, and rejects a live lock", async t => {
  const temporary = mkdtempSync(path.join(tmpdir(), "dormant-retirement-store-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const statePath = path.join(temporary, "absent", "journal", "retirement.json");
  const plan = buildDormantEmptyCoordinationRetirementPlan(evidenceFixture());
  const authorizationReceipt = authorizeDormantEmptyCoordinationRetirement({
    plan, authorization: plan.exactAuthorization,
  });
  const authorized = createDormantEmptyCoordinationRetirementIntent({
    plan, authorizationReceipt,
  });
  const prepared = advanceDormantEmptyCoordinationRetirementIntent(authorized, {
    status: "prepared", values: { operationKey:
      dormantEmptyCoordinationRetirementOperationKey(plan, "prepared"),
    evidenceDigest: plan.evidence.evidenceDigest },
  });
  const store = createDormantEmptyCoordinationRetirementStore({ statePath });
  assert.equal(existsSync(path.dirname(statePath)), false);
  assert.equal(store.readIntent(), null);
  assert.equal(store.writeIntent({ expectedIntent: null, nextIntent: authorized }).intentDigest,
    authorized.intentDigest);
  assert.equal(existsSync(path.dirname(statePath)), true);
  assert.equal(store.writeIntent({ expectedIntent: authorized, nextIntent: prepared }).intentDigest,
    prepared.intentDigest);
  assert.throws(() => store.writeIntent({ expectedIntent: authorized, nextIntent: prepared }),
    /compare-and-swap/u);

  await store.withOperationLock({ planDigest: plan.planDigest }, async () => {
    await assert.rejects(store.withOperationLock({ planDigest: plan.planDigest }, async () => {}),
      /locked by a live controller/u);
  });
});

test("real repository adapter rejects protected-controller drift before replay effects", async () => {
  const evidence = evidenceFixture();
  const plan = buildDormantEmptyCoordinationRetirementPlan(evidence);
  const authorizationReceipt = authorizeDormantEmptyCoordinationRetirement({
    plan, authorization: plan.exactAuthorization,
  });
  const authorized = createDormantEmptyCoordinationRetirementIntent({ plan, authorizationReceipt });
  const prepared = advanceDormantEmptyCoordinationRetirementIntent(authorized, {
    status: "prepared", values: { operationKey:
      dormantEmptyCoordinationRetirementOperationKey(plan, "prepared"),
    evidenceDigest: plan.evidence.evidenceDigest },
  });
  const calls = [];
  const repository = path.resolve(new URL("..", import.meta.url).pathname);
  const intentStore = { withOperationLock: async (_context, action) => action(),
    readIntent: () => prepared, writeIntent: () => { throw new Error("unexpected journal write"); } };
  const git = argumentsList => {
    calls.push(`git:${argumentsList.join(" ")}`);
    if (argumentsList[0] === "rev-parse" && argumentsList.includes("--git-common-dir")) return ".git";
    if (argumentsList.join(" ") === "rev-parse HEAD") return "9".repeat(40);
    if (argumentsList.join(" ") === "rev-parse origin/main") return "9".repeat(40);
    if (argumentsList.join(" ") === "rev-parse HEAD^{tree}") return SHA.controllerTree;
    throw new Error(`unexpected git call ${argumentsList.join(" ")}`);
  };
  const adapter = createRepositoryDormantEmptyCoordinationRetirementAdapter({
    repository, controllerRoot: repository, targetRepository: "owner/repo",
    ledgerRepository: "owner/ledger", pullRequestNumber: 509,
    claimId: DIGEST.claim, waitingSuccessorClaimId: DIGEST.successor,
  }, { git, gitRaw: () => "", intentStore, leaseStore: { read: () => ({ revision: 1,
    leases: {} }) }, captureEvidence: () => evidence,
  readCloud: () => { throw new Error("cloud must not be read after controller drift"); } });
  const controller = createDormantEmptyCoordinationRetirementController({ adapter });
  await assert.rejects(controller.run({ planDigest: plan.planDigest,
    authorization: plan.exactAuthorization }), /Protected retirement controller drifted/u);
  assert.equal(calls.some(call => call === "git:rev-parse HEAD"), true);
});

function fakeRuntime({ loseResponses = false, claimRetired = false,
  pullRequestClosed = false, claimClassification = null, driftAtClaim = false } = {}) {
  const evidence = evidenceFixture();
  const effects = [];
  let intent = null;
  let claimState = claimRetired ? "retired" : "dormant-preserved";
  let pullRequestState = pullRequestClosed ? "CLOSED" : "OPEN";
  const mutationValues = () => cumulative(intent);
  const adapter = {
    withOperationLock: async (_context, action) => action(Object.freeze({ fence: "exact" })),
    readPlanEvidence: async () => evidence,
    readIntent: async () => intent,
    writeIntent: async ({ expectedIntent, nextIntent }) => {
      assert.equal(intent?.intentDigest || null, expectedIntent?.intentDigest || null);
      intent = nextIntent; return intent;
    },
    classifyClaimRetired: async () => {
      if (driftAtClaim) throw new Error("source subject drifted");
      if (claimClassification) return { state: claimClassification };
      return { state: claimState === "retired" ? "complete" : "pending",
        values: { claimId: DIGEST.claim, disposition: claimState === "retired" ? "adopted" : "projected",
          ...mutationValues() } };
    },
    retireClaim: async () => {
      effects.push("retire-claim"); claimState = "retired";
      if (loseResponses) throw new Error("cloud response lost after effect");
      return { operationKey: DIGEST.operation,
        disposition: "projected",
        cloudMutation: true, providerMutation: false,
        operationReceiptDigest: DIGEST.receipt };
    },
    classifyPullRequestClosed: async () => {
      if (claimState !== "retired") throw new Error("closure attempted before retirement");
      return { state: pullRequestState === "CLOSED" ? "complete" : "pending",
        values: { disposition: pullRequestState === "CLOSED" ? "adopted" : "projected",
          ...mutationValues() } };
    },
    closePullRequest: async () => {
      assert.equal(claimState, "retired"); effects.push("close-pr"); pullRequestState = "CLOSED";
      if (loseResponses) throw new Error("provider response lost after effect");
      return { operationKey: DIGEST.operation,
        disposition: "projected",
        cloudMutation: mutationValues().cloudMutation, providerMutation: true };
    },
    verifyTerminal: async ({ intent: current }) => {
      assert.equal(claimState, "retired"); assert.equal(pullRequestState, "CLOSED");
      effects.push("verify");
      return { terminalDigest: digestValue({ claimState, pullRequestState }), ...cumulative(current) };
    },
  };
  return { effects, readIntent: () => intent,
    controller: createDormantEmptyCoordinationRetirementController({ adapter }) };
}

function cumulative(intent) {
  let cloudMutation = false;
  let providerMutation = false;
  for (const phase of Object.values(intent?.phases || {})) {
    cloudMutation ||= phase.values.cloudMutation === true;
    providerMutation ||= phase.values.providerMutation === true;
  }
  return { cloudMutation, providerMutation };
}

function evidenceFixture() {
  const repository = "owner/repo";
  const ledgerRepository = "owner/ledger";
  const device = "device-one";
  const session = "session-one";
  const writeScope = ["path:scripts/fix.mjs", "semantic:epoch-fix"];
  const markerAuthority = { claimId: DIGEST.claim, claimDigest: DIGEST.claim,
    operationReceiptDigest: DIGEST.operation, ledgerRepository, targetRepository: repository,
    canonicalBaseSha: SHA.base, laneRevision: SHA.head, declaredWriteScope: writeScope,
    writeSetDigest: DIGEST.write, deviceId: pseudonymousIdentifier("device", device),
    sessionId: pseudonymousIdentifier("session", session),
    reviewRequestId: "PR_node_509", leaseEpoch: 2, transitionCounter: 3, integration: null };
  const claim = { claimId: DIGEST.claim, claimDigest: DIGEST.claim,
    transitionDigest: DIGEST.transition, operationReceiptDigest: DIGEST.operation,
    state: "dormant-preserved", recordedState: "reviewed", writeAuthority: false,
    scopeReserved: true, actorId: "actor:one", repositoryId: "repo:one",
    workItemId: "work:509", deviceId: pseudonymousIdentifier("device", device),
    sessionId: pseudonymousIdentifier("session", session), canonicalBaseRevision: SHA.base,
    laneRevision: SHA.head, declaredWriteScope: writeScope, writeSetDigest: DIGEST.write,
    leaseEpoch: 2, transitionCounter: 4, predecessorClaimId: DIGEST.operation,
    reviewRequestId: "PR_node_509", evidenceDigest: null, integration: null, retirement: null };
  return buildDormantEmptyCoordinationRetirementEvidence({
    schema: "agentic-dormant-empty-coordination-retirement-evidence/v1",
    observedAt: "2026-08-16T00:00:00.000Z",
    controller: { repository: ledgerRepository, rootDigest: DIGEST.root,
      headSha: SHA.controller, treeSha: SHA.controllerTree, originMainSha: SHA.controller,
      runtimeDigest: DIGEST.runtime, clean: true, protected: true },
    canonical: { repository, branch: "main", sha: SHA.main, treeSha: SHA.tree,
      containsBase: true },
    pullRequest: { number: 509, nodeId: "PR_node_509", url: "https://example.test/pr/509",
      repository, state: "OPEN", isDraft: true, mergedAt: null, closedAt: null,
      autoMergeRequest: null, inMergeQueue: false, headRepository: repository,
      headBranch: "agent/empty", headSha: SHA.head, headTreeSha: SHA.tree,
      parentShas: [SHA.base], baseRepository: repository, baseBranch: "main",
      baseSha: SHA.base, baseTreeSha: SHA.tree, changedPaths: [], bodyDigest: DIGEST.body,
      reviewRequestId: "PR_node_509", markerClaimId: DIGEST.claim,
      markerDigest: DIGEST.marker, markerAuthority,
      providerVersion: "2026-08-16T00:00:00.000Z" },
    claim,
    waitingSuccessor: { ...claim, claimId: DIGEST.successor,
      claimDigest: DIGEST.successor, state: "waiting-successor", recordedState: "waiting-successor",
      writeAuthority: false, scopeReserved: false, leaseEpoch: 3, transitionCounter: 1,
      predecessorClaimId: DIGEST.claim, reviewRequestId: null },
    localAbsence: { gitCommonDirectoryDigest: DIGEST.local, registryRevision: 10,
      branchPresent: false, worktreePresent: false, leasePresent: false,
      matchingRefCount: 0, matchingWorktreeCount: 0, matchingLeaseCount: 0 },
    cloud: { ledgerRepository, ledgerRevision: SHA.ledger, ledgerDigest: DIGEST.ledger,
      sequence: 100, inventoryDigest: DIGEST.inventory,
      validatedLedgerDigest: DIGEST.ledger, sourceEntryDigest: DIGEST.sourceEntry,
      successorEntryDigest: DIGEST.successorEntry, sourceCardinality: 1,
      successorCardinality: 1 },
  });
}
