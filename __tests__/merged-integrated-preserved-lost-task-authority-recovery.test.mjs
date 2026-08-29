import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  OPERATION,
  buildMergedIntegratedPreservedLostAuthorityEvidence,
  buildMergedIntegratedPreservedLostAuthorityPlan,
} from "../scripts/merged-integrated-preserved-lost-task-authority-recovery-contract.mjs";
import { createMergedIntegratedPreservedLostAuthorityRecoveryController }
  from "../scripts/merged-integrated-preserved-lost-task-authority-recovery-controller.mjs";

const hex = (char, size = 64) => char.repeat(size);
const sha = char => hex(char, 40);
const subject = char => `urn:agentic-task:${hex(char)}`;

function sourceEvidence() {
  return buildMergedIntegratedPreservedLostAuthorityEvidence({
    schema: `agentic-${OPERATION}-evidence/v1`,
    target: {
      repository: "huijoohwee/knowgrph",
      branch: "agent/huis-macbook-pro-3/invocation-executor-runtime",
      worktreePath: "/private/target",
      headSha: sha("a"),
      treeSha: sha("b"),
      clean: true,
      status: "review_ready",
    },
    sourceLeaseDigest: hex("c"),
    claimId: hex("d"),
    reviewHeadSha: sha("e"),
    sourceBinding: {
      authoritySubjectId: subject("f"),
      generation: 1,
      bindingDigest: hex("1"),
    },
    mergedPullRequest: {
      state: "MERGED",
      number: 873,
      id: "PR_node",
      url: "https://github.com/huijoohwee/knowgrph/pull/873",
      branch: "agent/huis-macbook-pro-3/invocation-executor-runtime",
      headSha: sha("e"),
      mergeCommitSha: sha("2"),
      mergedAt: "2026-08-29T00:00:00.000Z",
    },
    protectedMainRefresh: null,
    deliveryEvidence: {
      dependencyClosureDigest: hex("3"),
      namedChecksDigest: hex("4"),
      handoffEvidenceDigest: hex("5"),
      operatorDecisionDigest: hex("6"),
      integrationIntentDigest: hex("7"),
    },
    integratedTerminal: {
      state: "pending",
      integrationEntryDigest: hex("8"),
      integrationReceiptDigest: hex("9"),
      ledgerDigest: hex("a"),
      ledgerRevision: sha("b"),
      runDigest: hex("c"),
      currentClaimDigest: hex("d"),
      transitionCounter: 7,
      subjectDigest: hex("e"),
    },
  });
}

function targetCapability() {
  return {
    authoritySubjectId: subject("0"),
    proofAdapterId: "urn:agentic-proof:ed25519-file:v1",
    generation: 2,
    publicKey: "test-public-key",
    publicKeyDigest: digestValue("test-public-key"),
  };
}
function receipt(kind) {
  const core = { schema: "test-receipt/v1", kind };
  return { ...core, receiptDigest: digestValue(core) };
}

test("requires literal plan authorization before a journal or CAS", async () => {
  const evidence = sourceEvidence();
  const plan = buildMergedIntegratedPreservedLostAuthorityPlan({
    evidence,
    targetCapability: targetCapability(),
    plannedAt: "2026-08-29T00:00:00.000Z",
  });
  let writes = 0;
  const controller = createMergedIntegratedPreservedLostAuthorityRecoveryController({
    adapter: fakeAdapter(evidence, targetCapability(), () => {}),
  });
  await assert.rejects(
    controller.run({ plan, authorization: "proceed", journalStore: {
      read: () => null,
      write: value => { writes += 1; return value; },
    } }),
    /exact authorization/u,
  );
  assert.equal(writes, 0);
});

test("journals before one CAS and accepts only its idempotent replay", async () => {
  const evidence = sourceEvidence();
  const capability = targetCapability();
  const plan = buildMergedIntegratedPreservedLostAuthorityPlan({
    evidence,
    targetCapability: capability,
    plannedAt: "2026-08-29T00:00:00.000Z",
  });
  const events = [];
  const adapter = fakeAdapter(evidence, capability, event => events.push(event));
  let stored = null;
  const journalStore = {
    read: () => stored,
    write: value => { events.push(`journal:${value.phase}`); stored = value; return value; },
  };
  const controller = createMergedIntegratedPreservedLostAuthorityRecoveryController({ adapter });
  const result = await controller.run({
    plan,
    authorization: plan.exactAuthorization,
    journalStore,
  });
  assert.equal(result.status, "complete");
  assert.deepEqual(events, [
    "journal:prepared", "journal:prechecked", "journal:cas-attempted",
    "cas", "journal:local-cas", "terminal", "journal:verified", "journal:complete",
  ]);
  await controller.run({ plan, authorization: plan.exactAuthorization, journalStore });
  assert.equal(events.filter(event => event === "cas").length, 1);
});

test("allows disjoint ledger movement after authorization", async () => {
  const evidence = sourceEvidence();
  const capability = targetCapability();
  const plan = buildMergedIntegratedPreservedLostAuthorityPlan({
    evidence,
    targetCapability: capability,
    plannedAt: "2026-08-29T00:00:00.000Z",
  });
  const ledgerMoved = buildMergedIntegratedPreservedLostAuthorityEvidence({
    ...evidence,
    integratedTerminal: {
      ...evidence.integratedTerminal,
      ledgerDigest: hex("f"),
      ledgerRevision: sha("0"),
    },
  });
  const events = [];
  const controller = createMergedIntegratedPreservedLostAuthorityRecoveryController({
    adapter: fakeAdapter(evidence, capability, event => events.push(event), [ledgerMoved, ledgerMoved]),
  });
  let stored = null;
  const result = await controller.run({
    plan,
    authorization: plan.exactAuthorization,
    journalStore: {
      read: () => stored,
      write: value => { stored = value; return value; },
    },
  });
  assert.equal(result.status, "complete");
  assert.deepEqual(events, ["cas", "terminal"]);
});

test("rejects same-claim fence and transition changes before CAS", async () => {
  const evidence = sourceEvidence();
  const capability = targetCapability();
  const plan = buildMergedIntegratedPreservedLostAuthorityPlan({
    evidence,
    targetCapability: capability,
    plannedAt: "2026-08-29T00:00:00.000Z",
  });
  for (const integratedTerminal of [
    { ...evidence.integratedTerminal, currentClaimDigest: hex("f") },
    { ...evidence.integratedTerminal, transitionCounter: 8 },
  ]) {
    const events = [];
    const controller = createMergedIntegratedPreservedLostAuthorityRecoveryController({
      adapter: fakeAdapter(evidence, capability, event => events.push(event), [
        buildMergedIntegratedPreservedLostAuthorityEvidence({ ...evidence, integratedTerminal }),
      ]),
    });
    await assert.rejects(
      controller.run({
        plan,
        authorization: plan.exactAuthorization,
        journalStore: { read: () => null, write: value => value },
      }),
      /Recovery evidence drifted/u,
    );
    assert.deepEqual(events, []);
  }
});

test("rejects a replacement that does not advance exactly one generation", () => {
  const capability = { ...targetCapability(), generation: 1 };
  assert.throws(() => buildMergedIntegratedPreservedLostAuthorityPlan({
    evidence: sourceEvidence(), targetCapability: capability,
  }), /advance exactly one/u);
  assert.throws(() => buildMergedIntegratedPreservedLostAuthorityPlan({
    evidence: sourceEvidence(), targetCapability: {
      ...targetCapability(), authoritySubjectId: subject("f"),
    },
  }), /distinct subject/u);
});

function fakeAdapter(evidence, capability, record, captures = [evidence]) {
  const target = {
    binding: { bindingDigest: hex("0") },
    proofReceipt: receipt("proof"),
  };
  let captureIndex = 0;
  return {
    captureSource: async () => captures[Math.min(captureIndex++, captures.length - 1)],
    readTargetCapabilityProjection: async () => capability,
    createTargetBinding: async () => target,
    replaceLocalBinding: async () => {
      record("cas");
      return receipt("local-cas");
    },
    observeLocalBinding: async () => null,
    verifyTerminal: async () => {
      record("terminal");
      return receipt("terminal");
    },
  };
}
