// Responsibility: Verify read-only planning, exact authority, durable phases, and crash replay.
import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import * as Contract from "../scripts/retired-handoff-successor-disposition-contract.mjs";
import {
  createRetiredHandoffSuccessorDispositionController,
} from "../scripts/retired-handoff-successor-disposition-controller.mjs";

const digest = label => digestValue({ label });
const sha = label => digest(label).slice(0, 40);

test("plan is read-only and seals the exact authorization from complete input", async () => {
  const harness = createHarness();
  const result = await harness.controller.plan({ portDecision: harness.portDecision });

  assert.equal(result.status, "planned");
  assert.equal(result.planDigest, result.plan.planDigest);
  assert.equal(result.exactAuthorization,
    `authorize retired-handoff-successor-disposition ${result.planDigest}`);
  assert.deepEqual(harness.counts, {
    evidenceReads: 1, fences: 0, intentReads: 1, intentWrites: 0,
    receiptReads: 0, receiptWrites: 0,
  });
});

test("plan returns a typed non-authority residual template when no decision exists", async () => {
  const harness = createHarness({ supplyPortDecision: false });
  const result = await harness.controller.plan({ portDecision: null });

  assert.equal(result.status, "operator-input-required");
  assert.equal(result.evidenceDigest, result.residualTemplate.evidenceDigest);
  assert.equal(result.residualTemplate.schema,
    Contract.RETIRED_HANDOFF_SUCCESSOR_PORT_DECISION_TEMPLATE_SCHEMA);
  assert.equal(result.residualTemplate.status, "operator-input-required");
  assert.equal(result.planDigest, undefined);
  assert.deepEqual(harness.counts, {
    evidenceReads: 1, fences: 0, intentReads: 1, intentWrites: 0,
    receiptReads: 0, receiptWrites: 0,
  });
});

test("run without a decision fails before the subject fence or writes", async () => {
  const harness = createHarness({ supplyPortDecision: false });
  await assert.rejects(harness.controller.run({
    portDecision: null,
    planDigest: digest("unsealed plan"),
    authorization: `authorize retired-handoff-successor-disposition ${digest("unsealed plan")}`,
  }), /requires a complete port decision/u);
  assert.deepEqual(harness.counts, {
    evidenceReads: 1, fences: 0, intentReads: 1, intentWrites: 0,
    receiptReads: 0, receiptWrites: 0,
  });
});

test("observe without a decision uses read-only intent lookup then returns the residual", async () => {
  const harness = createHarness({ supplyPortDecision: false });
  const result = await harness.controller.observe({ portDecision: null });

  assert.equal(result.status, "operator-input-required");
  assert.equal(result.residualTemplate.status, "operator-input-required");
  assert.equal(harness.counts.intentReads, 1);
  assert.equal(harness.counts.receiptReads, 0);
  assert.equal(harness.counts.fences, 0);
});

test("run rejects an inexact token before the fence or writes", async () => {
  const harness = createHarness();
  const planned = await harness.controller.plan({ portDecision: harness.portDecision });
  resetCounts(harness.counts);

  await assert.rejects(harness.controller.run({
    portDecision: harness.portDecision,
    planDigest: planned.planDigest,
    authorization: "authorize retired-handoff-successor-disposition inexact",
  }), /requires exact authorization/u);
  assert.deepEqual(harness.counts, {
    evidenceReads: 1, fences: 0, intentReads: 1, intentWrites: 0,
    receiptReads: 0, receiptWrites: 0,
  });
});

test("run rejects a stale plan digest before the fence or writes", async () => {
  const harness = createHarness();
  const planned = await harness.controller.plan({ portDecision: harness.portDecision });
  resetCounts(harness.counts);

  await assert.rejects(harness.controller.run({
    portDecision: harness.portDecision,
    planDigest: digest("stale plan"),
    authorization: planned.exactAuthorization,
  }), /plan digest is not exact-current/u);
  assert.equal(harness.counts.evidenceReads, 1);
  assert.equal(harness.counts.fences, 0);
  assert.equal(harness.counts.intentReads, 1);
  assert.equal(harness.counts.receiptReads, 0);
});

test("first authorization blocks evidence drift inside the fence before writing", async () => {
  const harness = createHarness({
    driftBeforeFence: true,
    driftEvidence: volatileDriftEvidence,
  });
  const planned = await harness.controller.plan({ portDecision: harness.portDecision });

  await assert.rejects(
    harness.controller.run(runInput(planned, harness.portDecision)),
    /evidence changed before its authorized journal/u,
  );
  assert.equal(harness.counts.fences, 1);
  assert.equal(harness.counts.intentWrites, 0);
  assert.equal(harness.counts.receiptWrites, 0);
});

test("run journals authorized, verified, immutable receipt, then complete", async () => {
  const harness = createHarness();
  const planned = await harness.controller.plan({ portDecision: harness.portDecision });
  const input = runInput(planned, harness.portDecision);
  const result = await harness.controller.run(input);

  assert.equal(result.status, "complete");
  assert.equal(result.planDigest, planned.planDigest);
  assert.equal(result.receipt.admissionEffect, "suppress-exact-provider-subject");
  assert.equal(result.receipt.cleanupEligible, false);
  assert.deepEqual(harness.persistedStatuses, ["authorized", "verified", "complete"]);
  assert.equal(harness.counts.receiptWrites, 1);

  const writes = {
    intentWrites: harness.counts.intentWrites,
    receiptWrites: harness.counts.receiptWrites,
  };
  const observation = await harness.controller.observe({
    portDecision: harness.portDecision,
    planDigest: planned.planDigest,
  });
  assert.equal(observation.status, "complete");
  assert.equal(observation.receipt.receiptDigest, result.receipt.receiptDigest);
  assert.equal(harness.counts.intentWrites, writes.intentWrites);
  assert.equal(harness.counts.receiptWrites, writes.receiptWrites);
});

test("complete replay performs no duplicate journal effect", async () => {
  const harness = createHarness();
  const planned = await harness.controller.plan({ portDecision: harness.portDecision });
  const input = runInput(planned, harness.portDecision);

  const first = await harness.controller.run(input);
  const writes = {
    intentWrites: harness.counts.intentWrites,
    receiptWrites: harness.counts.receiptWrites,
  };
  const second = await harness.controller.run(input);
  assert.equal(second.receipt.receiptDigest, first.receipt.receiptDigest);
  assert.equal(harness.counts.intentWrites, writes.intentWrites);
  assert.equal(harness.counts.receiptWrites, writes.receiptWrites);
});

for (const lostResponse of [
  "authorized-intent", "verified-intent", "receipt", "complete-intent",
]) {
  test(`a lost ${lostResponse} response is recovered without duplicate effect`, async () => {
    const harness = createHarness({ lostResponse });
    const planned = await harness.controller.plan({ portDecision: harness.portDecision });
    const input = runInput(planned, harness.portDecision);

    const first = await harness.controller.run(input);
    assert.equal(first.status, "complete");
    assert.equal(harness.counts.receiptWrites, 1);
    assert.equal(harness.intent.status, "complete");
    const receiptDigest = harness.receipt.receiptDigest;
    assert.equal((await harness.controller.run(input)).receipt.receiptDigest, receiptDigest);
    assert.equal(harness.counts.receiptWrites, 1);
  });
}

for (const crashAfter of ["authorized", "verified", "receipt"]) {
  test(`restart after ${crashAfter} tolerates volatile drift exactly once`, async () => {
    const harness = createHarness({ crashAfter });
    const planned = await harness.controller.plan({ portDecision: harness.portDecision });
    const input = runInput(planned, harness.portDecision);
    await assert.rejects(harness.controller.run(input), /simulated process crash/u);
    assert.equal(harness.intent.status, crashAfter === "authorized" ? "authorized" : "verified");
    assert.equal(harness.counts.receiptWrites, crashAfter === "receipt" ? 1 : 0);
    harness.setEvidence(volatileDriftEvidence(harness.evidence));
    const result = await harness.controller.run(input);

    assert.equal(result.status, "complete");
    assert.equal(result.planDigest, planned.planDigest);
    assert.equal(result.receipt.evidenceDigest, planned.plan.evidenceDigest);
    assert.equal(harness.counts.receiptWrites, 1);
  });
}

test("complete replay, plan, and observe tolerate unrelated volatile drift without writes", async () => {
  const harness = createHarness();
  const planned = await harness.controller.plan({ portDecision: harness.portDecision });
  const input = runInput(planned, harness.portDecision);
  const first = await harness.controller.run(input);
  harness.setEvidence(volatileDriftEvidence(harness.evidence));
  const writes = {
    intentWrites: harness.counts.intentWrites,
    receiptWrites: harness.counts.receiptWrites,
  };

  const replanned = await harness.controller.plan({
    portDecision: harness.portDecision,
    planDigest: planned.planDigest,
  });
  const observed = await harness.controller.observe({
    portDecision: harness.portDecision,
    planDigest: planned.planDigest,
  });
  const replayed = await harness.controller.run(input);
  assert.equal(replanned.planDigest, planned.planDigest);
  assert.equal(observed.status, "complete");
  assert.equal(replayed.receipt.receiptDigest, first.receipt.receiptDigest);
  assert.equal(harness.counts.intentWrites, writes.intentWrites);
  assert.equal(harness.counts.receiptWrites, writes.receiptWrites);
});

test("volatile replay still rejects an invalid token before fence or writes", async () => {
  const harness = createHarness();
  const planned = await harness.controller.plan({ portDecision: harness.portDecision });
  const input = runInput(planned, harness.portDecision);
  await harness.controller.run(input);
  harness.setEvidence(volatileDriftEvidence(harness.evidence));
  const before = { ...harness.counts };

  await assert.rejects(
    harness.controller.run({ ...input, authorization: "authorize invalid" }),
    /requires exact authorization/u,
  );
  assert.equal(harness.counts.fences, before.fences);
  assert.equal(harness.counts.intentWrites, before.intentWrites);
  assert.equal(harness.counts.receiptWrites, before.receiptWrites);
});

test("durable drift immediately after authorization blocks before verification", async () => {
  const harness = createHarness({
    driftAfter: "authorized",
    driftEvidence: evidence => durableDriftEvidence(evidence, "local"),
  });
  const planned = await harness.controller.plan({ portDecision: harness.portDecision });
  await assert.rejects(
    harness.controller.run(runInput(planned, harness.portDecision)),
    /durable subject changed/u,
  );
  assert.equal(harness.intent.status, "authorized");
  assert.equal(harness.counts.receiptWrites, 0);
});

test("an authorized intent with an orphan receipt fails before any phase write", async () => {
  const harness = createHarness({
    driftAfter: "authorized",
    driftEvidence: evidence => durableDriftEvidence(evidence, "local"),
  });
  const planned = await harness.controller.plan({ portDecision: harness.portDecision });
  const input = runInput(planned, harness.portDecision);
  await assert.rejects(harness.controller.run(input), /durable subject changed/u);
  harness.setEvidence(planned.plan.evidence);
  const verified = Contract.advanceRetiredHandoffSuccessorDispositionIntent(
    harness.intent,
    {
      status: "verified",
      values: {
        operationKey: Contract.retiredHandoffSuccessorDispositionOperationKey({
          planDigest: planned.planDigest,
          subjectKey: planned.plan.subjectKey,
          phase: "verified",
        }),
        evidenceDigest: planned.plan.evidenceDigest,
      },
    },
  );
  harness.setReceipt(Contract.buildRetiredHandoffSuccessorDispositionReceipt({
    plan: planned.plan,
    intent: verified,
    evidence: planned.plan.evidence,
  }));
  const before = { ...harness.counts };

  await assert.rejects(harness.controller.run(input), /receipt exists before its verified intent/u);
  assert.equal(harness.counts.intentWrites, before.intentWrites);
  assert.equal(harness.counts.receiptWrites, before.receiptWrites);
});

test("a complete intent cannot name a different valid receipt", async () => {
  const harness = createHarness();
  const planned = await harness.controller.plan({ portDecision: harness.portDecision });
  await harness.controller.run(runInput(planned, harness.portDecision));
  const forgedCore = structuredClone(harness.intent);
  delete forgedCore.intentDigest;
  forgedCore.phases.complete.values.receiptDigest = digest("forged receipt");
  harness.setIntent({ ...forgedCore, intentDigest: digestValue(forgedCore) });
  const before = { ...harness.counts };

  await assert.rejects(harness.controller.observe({
    portDecision: harness.portDecision,
    planDigest: planned.planDigest,
  }), /receipt drifted from its exact subject/u);
  assert.equal(harness.counts.intentWrites, before.intentWrites);
  assert.equal(harness.counts.receiptWrites, before.receiptWrites);
});
test("observe cannot report a complete intent without its receipt", async () => {
  const harness = createHarness();
  const planned = await harness.controller.plan({ portDecision: harness.portDecision });
  await harness.controller.run(runInput(planned, harness.portDecision));
  harness.setReceipt(null);
  await assert.rejects(harness.controller.observe({ portDecision: harness.portDecision }),
    /complete disposition intent has no receipt/iu);
});
for (const kind of ["source", "claim", "successor", "local", "commit"]) {
  test(`complete replay blocks ${kind} durable drift without writes`, async () => {
    const harness = createHarness();
    const planned = await harness.controller.plan({ portDecision: harness.portDecision });
    const input = runInput(planned, harness.portDecision);
    await harness.controller.run(input);
    harness.setEvidence(durableDriftEvidence(harness.evidence, kind));
    const before = { ...harness.counts };

    await assert.rejects(harness.controller.run(input), /durable subject changed/u);
    assert.equal(harness.counts.fences, before.fences);
    assert.equal(harness.counts.intentWrites, before.intentWrites);
    assert.equal(harness.counts.receiptWrites, before.receiptWrites);
  });
}

test("subject-key drift cannot reuse the old journal as a fresh candidate", async () => {
  const harness = createHarness();
  const planned = await harness.controller.plan({ portDecision: harness.portDecision });
  await harness.controller.run(runInput(planned, harness.portDecision));
  harness.setEvidence(subjectKeyDriftEvidence(harness.evidence));
  const freshDecision = portDecisionFixture(harness.evidence);
  const before = { ...harness.counts };

  await assert.rejects(harness.controller.run({
    portDecision: freshDecision,
    planDigest: planned.planDigest,
    authorization: planned.exactAuthorization,
  }), /plan digest is not exact-current/u);
  assert.equal(harness.counts.fences, before.fences);
  assert.equal(harness.counts.intentWrites, before.intentWrites);
  assert.equal(harness.counts.receiptWrites, before.receiptWrites);
});

function createHarness({
  crashAfter = null,
  driftAfter = null,
  driftBeforeFence = false,
  driftEvidence = value => value,
  evidence = evidenceFixture(),
  lostResponse = null,
  supplyPortDecision = true,
} = {}) {
  const portDecision = portDecisionFixture(evidence);
  let liveEvidence = evidence;
  let intent = null;
  let receipt = null;
  let crashTriggered = false;
  let driftApplied = false;
  let responseLost = false;
  const persistedStatuses = [];
  const counts = {
    evidenceReads: 0, fences: 0, intentReads: 0, intentWrites: 0,
    receiptReads: 0, receiptWrites: 0,
  };
  function applyDrift(phase) {
    if (driftAfter === phase && !driftApplied) {
      liveEvidence = driftEvidence(liveEvidence);
      driftApplied = true;
    }
  }
  const adapter = {
    async withSubjectFence(_context, callback) {
      counts.fences += 1;
      if (driftBeforeFence && !driftApplied) {
        liveEvidence = driftEvidence(liveEvidence);
        driftApplied = true;
      }
      return callback({ fenceDigest: digest("fence") });
    },
    async readEvidence(readContext = {}) {
      counts.evidenceReads += 1;
      if (!crashTriggered && readContext.operation === `after-${crashAfter}`) {
        crashTriggered = true;
        throw new Error(`simulated process crash after ${crashAfter}`);
      }
      const requestedDecision = Object.hasOwn(readContext, "portDecision")
        ? readContext.portDecision
        : supplyPortDecision ? portDecision : null;
      return {
        evidence: liveEvidence,
        portDecision: requestedDecision,
      };
    },
    async readIntent(subjectKey) {
      counts.intentReads += 1;
      return intent?.subjectKey === subjectKey ? intent : null;
    },
    async writeIntent({ expectedIntent, nextIntent }) {
      counts.intentWrites += 1;
      assert.equal(expectedIntent?.intentDigest || null, intent?.intentDigest || null);
      intent = nextIntent;
      persistedStatuses.push(intent.status);
      applyDrift(intent.status);
      if (lostResponse === `${intent.status}-intent` && !responseLost) {
        responseLost = true;
        throw new Error(`simulated lost ${intent.status}-intent response`);
      }
      return intent;
    },
    async readReceipt(subjectKey) {
      counts.receiptReads += 1;
      return receipt?.subjectKey === subjectKey ? receipt : null;
    },
    async writeReceipt({ expectedReceipt, nextReceipt }) {
      counts.receiptWrites += 1;
      assert.equal(expectedReceipt, null);
      assert.equal(receipt, null);
      receipt = nextReceipt;
      applyDrift("receipt");
      if (lostResponse === "receipt" && !responseLost) {
        responseLost = true;
        throw new Error("simulated lost receipt response");
      }
      return receipt;
    },
  };
  return {
    controller: createRetiredHandoffSuccessorDispositionController({ adapter }),
    counts,
    get evidence() { return liveEvidence; },
    get intent() { return intent; },
    persistedStatuses,
    portDecision,
    get receipt() { return receipt; },
    setEvidence(value) { liveEvidence = value; },
    setIntent(value) { intent = value; },
    setReceipt(value) { receipt = value; },
  };
}

function runInput(planned, portDecision) {
  return {
    portDecision,
    planDigest: planned.planDigest,
    authorization: planned.exactAuthorization,
  };
}

function resetCounts(counts) {
  for (const key of Object.keys(counts)) counts[key] = 0;
}

function evidenceFixture() {
  const sourceCommit = {
    sha: sha("retired final revision"),
    patchId: sha("stable patch"),
    changedPathsDigest: digest("source paths"),
  };
  const successorCommit = {
    sha: sha("successor commit"),
    patchId: sourceCommit.patchId,
    changedPathsDigest: digest("successor paths"),
  };
  const core = {
    schema: Contract.RETIRED_HANDOFF_SUCCESSOR_DISPOSITION_EVIDENCE_SCHEMA,
    provider: "github",
    repositoryId: "github-repository:R_target",
    controller: {
      repository: "owner/agentic-canvas-os",
      rootRealpath: "/workspace/controller",
      runtimeModuleRootRealpath: "/workspace/controller",
      headSha: sha("controller head"), headTreeSha: sha("controller tree"),
      mainSha: sha("controller head"), originMainSha: sha("controller head"),
      remoteMainSha: sha("controller head"),
      remoteMainTreeSha: sha("controller tree"),
      originUrlDigest: digest("controller origin"),
      statusDigest: digest("controller status"), clean: true,
      runtimeFileSetDigest: digest("controller runtime files"),
    },
    ledger: {
      repository: "owner/agentic-canvas-os",
      revision: sha("ledger revision"), blobSha: sha("ledger blob"),
      rawDigest: digest("ledger raw"), rereadRevision: sha("ledger revision"),
      rereadBlobSha: sha("ledger blob"), rereadRawDigest: digest("ledger raw"),
      digest: digest("ledger head"), sequence: 1453,
    },
    claim: {
      claimId: digest("claim"), claimDigest: digest("claim record"),
      transitionDigest: digest("claim transition"), transitionCounter: 4,
      state: "retired", retirementReason: "handoff",
      finalRevision: sourceCommit.sha, reviewRequestId: "github-pull-request:PR_712",
      handoffEvidenceDigest: digest("handoff evidence"),
      entryDigest: digest("claim transition"),
    },
    source: {
      repository: "owner/knowgrph", pullRequestNumber: 712,
      pullRequestNodeId: "PR_712", state: "OPEN", isDraft: true,
      branch: "agent/device/retired-source", headSha: sha("source head"),
      baseSha: sha("source base"), bodyDigest: digest("source body"),
      providerVersion: "source-etag", remoteHeadSha: sha("source head"),
      handoffMarkerFinalRevision: sourceCommit.sha, retiredRevisionReachable: true,
    },
    successor: {
      pullRequestNumber: 742, pullRequestNodeId: "PR_742", state: "MERGED",
      branch: "agent/device/successor", headSha: sha("successor head"),
      mergeCommitSha: sha("successor merge"), protectedMainSha: sha("main head"),
      protectedMainContainsMerge: true, requiredChecksDigest: digest("checks"),
    },
    local: {
      projectionDigest: digest("local projection"), worktreeCount: 2,
      branchPresent: true, leasePresent: false, cleanupEligible: false,
    },
    functionalSourceCommits: [sourceCommit],
    successorCommits: [successorCommit],
  };
  return Object.freeze({ ...core, evidenceDigest: digestValue(core) });
}

function portDecisionFixture(evidence) {
  const core = {
    schema: Contract.RETIRED_HANDOFF_SUCCESSOR_PORT_DECISION_SCHEMA,
    evidenceDigest: evidence.evidenceDigest,
    entries: [{
      sourceCommitSha: evidence.functionalSourceCommits[0].sha,
      kind: "patch-identical",
      successorCommitShas: [evidence.successorCommits[0].sha],
      rationale: null,
    }],
  };
  return Object.freeze({ ...core, decisionDigest: digestValue(core) });
}

function volatileDriftEvidence(evidence) {
  const controllerHead = sha("changed controller head");
  const controllerTree = sha("changed controller tree");
  return resealEvidence({
    ...structuredClone(evidence),
    controller: {
      ...evidence.controller,
      headSha: controllerHead, headTreeSha: controllerTree,
      mainSha: controllerHead, originMainSha: controllerHead,
      remoteMainSha: controllerHead, remoteMainTreeSha: controllerTree,
      originUrlDigest: digest("changed controller origin"),
      statusDigest: digest("changed controller status"),
      runtimeFileSetDigest: digest("changed controller files"),
    },
    ledger: {
      ...evidence.ledger,
      revision: sha("changed ledger revision"),
      blobSha: sha("changed ledger blob"), rawDigest: digest("changed ledger raw"),
      rereadRevision: sha("changed ledger revision"),
      rereadBlobSha: sha("changed ledger blob"),
      rereadRawDigest: digest("changed ledger raw"),
      digest: digest("changed ledger head"), sequence: evidence.ledger.sequence + 1,
    },
    source: {
      ...evidence.source,
      baseSha: sha("changed source base"), providerVersion: "changed-source-etag",
    },
    successor: {
      ...evidence.successor,
      protectedMainSha: sha("changed protected main"),
      requiredChecksDigest: digest("changed checks"),
    },
  });
}

function durableDriftEvidence(evidence, kind) {
  const changed = structuredClone(evidence);
  if (kind === "source") changed.source.branch = "agent/device/changed-source";
  else if (kind === "claim") {
    changed.claim.handoffEvidenceDigest = digest("changed handoff evidence");
  } else if (kind === "successor") {
    changed.successor.branch = "agent/device/changed-successor";
  } else if (kind === "local") {
    changed.local.projectionDigest = digest("changed local projection");
  } else if (kind === "commit") {
    changed.functionalSourceCommits[0].changedPathsDigest = digest("changed paths");
  } else {
    throw new Error(`Unsupported durable drift fixture: ${kind}`);
  }
  return resealEvidence(changed);
}

function subjectKeyDriftEvidence(evidence) {
  const changed = structuredClone(evidence);
  changed.source.headSha = sha("changed source head");
  changed.source.remoteHeadSha = changed.source.headSha;
  return resealEvidence(changed);
}

function resealEvidence(value) {
  const core = structuredClone(value);
  delete core.evidenceDigest;
  return Object.freeze({ ...core, evidenceDigest: digestValue(core) });
}
