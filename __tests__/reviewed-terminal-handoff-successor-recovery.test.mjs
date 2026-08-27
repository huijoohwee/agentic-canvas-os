import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  authorizeRecovery,
  buildRecoveryPlan,
  createRecoveryIntent,
  createRecoveryJournalStore,
} from "../scripts/reviewed-terminal-handoff-successor-recovery-contract.mjs";
import { createReviewedTerminalHandoffSuccessorRecoveryController }
  from "../scripts/reviewed-terminal-handoff-successor-recovery-controller.mjs";
import {
  assertNoLiveReviewedTerminalOverlap,
  selectReviewedTerminalHandoffProof,
} from "../scripts/reviewed-terminal-handoff-successor-recovery-evidence.mjs";

const hex = value => digestValue(value);
const sha = value => hex(value).slice(0, 40);

test("proves the exact reviewed-superseded to unprojected-handoff lineage", () => {
  const fixture = sourceFixture();
  const proof = selectReviewedTerminalHandoffProof(fixture);
  assert.equal(proof.reviewedSource.claimId, fixture.lease.cloudAuthority.claimId);
  assert.equal(proof.reviewedSource.retirementReason, "superseded");
  assert.equal(proof.handoffSource.predecessorClaimId, proof.reviewedSource.claimId);
  assert.equal(proof.handoffSource.retirementReason, "handoff");
  assert.equal(proof.handoffSource.leaseEpoch, fixture.lease.cloudAuthority.leaseEpoch + 1);
});

test("rejects a non-handoff direct successor and live overlap", () => {
  const fixture = sourceFixture();
  const altered = fixture.entries.map(entry => (
    entry.claimId === fixture.handoffClaimId && entry.claimCore.state === "retired"
      ? { ...entry, claimCore: { ...entry.claimCore,
        retirement: { ...entry.claimCore.retirement, reason: "abandoned" } } }
      : entry
  ));
  assert.throws(() => selectReviewedTerminalHandoffProof({
    entries: altered,
    lease: fixture.lease,
  }), /terminal-handoff/u);
  const proof = selectReviewedTerminalHandoffProof(fixture);
  assert.throws(() => assertNoLiveReviewedTerminalOverlap({
    claims: [{
      claimId: hex("overlap"),
      scopeReserved: true,
      declaredWriteScope: proof.handoffSource.declaredWriteScope,
    }],
    ...proof,
  }), /overlaps/u);
});

test("requires byte-exact authorization", () => {
  const plan = buildRecoveryPlan({
    evidence: evidenceFixture(),
    operatorSessionId: "successor-session",
  });
  assert.throws(() => authorizeRecovery({ plan, authorization: "authorize recovery" }),
    /exact authorization/u);
  assert.equal(authorizeRecovery({ plan, authorization: plan.exactAuthorization }).planDigest,
    plan.planDigest);
});

test("journals exact intent CAS and fences concurrent recovery", async t => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "reviewed-terminal-recovery-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const plan = buildRecoveryPlan({
    evidence: evidenceFixture(),
    operatorSessionId: "successor-session",
  });
  const intent = createRecoveryIntent(plan, plan.exactAuthorization);
  const store = createRecoveryJournalStore({
    commonDirectory: temporary,
    branch: plan.evidence.branch,
  });
  assert.equal(store.read(), null);
  store.write({ expected: null, value: intent });
  assert.deepEqual(store.read(), intent);
  assert.throws(() => store.write({ expected: null, value: intent }), /changed before CAS/u);
  await store.withFence(async () => {
    await assert.rejects(store.withFence(async () => null), /already fenced/u);
  });
});

test("runs and replays the ordered review-ready successor phases without source effects", async () => {
  const evidence = evidenceFixture();
  const plan = buildRecoveryPlan({
    evidence,
    operatorSessionId: "successor-session",
    ttlSeconds: 1800,
  });
  let journal = null;
  const calls = [];
  const successor = hex("successor");
  const effects = {
    claimSuccessor: { claimId: successor, receiptDigest: hex("claim") },
    bindSuccessor: { authority: { claimId: successor }, receiptDigest: hex("bind") },
    markSuccessorReviewReady: {
      authority: { claimId: successor, state: "review_ready" },
      receiptDigest: hex("review"),
    },
    projectLocal: { receiptDigest: hex("local") },
    projectPullRequest: { receiptDigest: hex("marker") },
    verifyTerminal: { receiptDigest: hex("terminal") },
  };
  const adapter = {
    withFence: action => action(),
    captureEvidence: async () => evidence,
    readIntent: async () => journal,
    writeIntent: async ({ expected, value }) => {
      assert.equal(expected, journal);
      journal = value;
    },
    reconcile: async () => null,
    ...Object.fromEntries(Object.entries(effects).map(([name, value]) => [name, async () => {
      calls.push(name);
      return value;
    }])),
  };
  const controller = createReviewedTerminalHandoffSuccessorRecoveryController(adapter);
  const completion = await controller.run({
    plan,
    operatorSessionId: "successor-session",
    authorization: plan.exactAuthorization,
  });
  assert.equal(completion.status, "successor-review-ready");
  assert.equal(completion.integrationAuthorityRestored, false);
  assert.equal(completion.sourceBytesChanged, false);
  assert.deepEqual(calls, [
    "claimSuccessor", "bindSuccessor", "markSuccessorReviewReady",
    "projectLocal", "projectPullRequest", "verifyTerminal",
  ]);
  assert.equal(journal.phase, "complete");
  assert.deepEqual(await controller.run({
    plan,
    operatorSessionId: "successor-session",
    authorization: plan.exactAuthorization,
  }), completion);
});

function sourceFixture() {
  const reviewedClaimId = hex("reviewed-claim");
  const handoffClaimId = hex("handoff-claim");
  const head = sha("head");
  const base = sha("base");
  const declaredWriteScope = ["path:src/a.ts", "semantic:reviewed-lane"];
  const writeSetDigest = digestValue(declaredWriteScope);
  const reviewRequestId = "github-pull-request:reviewed-lane";
  const authority = {
    claimId: reviewedClaimId,
    claimDigest: hex("reviewed-fence"),
    canonicalBaseSha: base,
    laneRevision: head,
    writeSetDigest,
    reviewRequestId,
    leaseEpoch: 2,
  };
  const lease = { reviewHeadSha: head, cloudAuthority: authority };
  const common = {
    repositoryId: "repository:1",
    actorId: "actor:1",
    workItemId: "work-item:1",
    canonicalBaseRevision: base,
    laneRevision: head,
    declaredWriteScope,
    writeSetDigest,
  };
  const reviewed = {
    ...common,
    claimId: reviewedClaimId,
    leaseEpoch: 2,
    reviewRequestId,
    state: "reviewed",
    transitionCounter: 5,
  };
  const reviewedTerminal = {
    ...reviewed,
    state: "retired",
    transitionCounter: 6,
    retirement: {
      reason: "superseded",
      finalRevision: head,
      reviewRequestId,
      retiredAt: "2026-08-23T00:00:00.000Z",
    },
  };
  const handoff = {
    ...common,
    claimId: handoffClaimId,
    predecessorClaimId: reviewedClaimId,
    leaseEpoch: 3,
    reviewRequestId: null,
  };
  const entries = [
    ledgerEntry(reviewedClaimId, authority.claimDigest, reviewed, 10, "reviewed"),
    ledgerEntry(reviewedClaimId, hex("reviewed-terminal-fence"), reviewedTerminal, 11,
      "reviewed-terminal"),
    ledgerEntry(handoffClaimId, hex("waiting-fence"), {
      ...handoff, state: "waiting-successor", transitionCounter: 1,
    }, 12, "waiting"),
    ledgerEntry(handoffClaimId, hex("current-fence"), {
      ...handoff, state: "current", transitionCounter: 2,
    }, 13, "current"),
    ledgerEntry(handoffClaimId, hex("handoff-terminal-fence"), {
      ...handoff,
      state: "retired",
      transitionCounter: 3,
      retirement: {
        reason: "handoff",
        finalRevision: head,
        reviewRequestId: null,
        retiredAt: "2026-08-24T00:00:00.000Z",
      },
    }, 14, "handoff-terminal"),
  ];
  return { entries, lease, handoffClaimId };
}

function ledgerEntry(claimId, claimDigest, claimCore, sequence, label) {
  return {
    claimId,
    claimDigest,
    claimCore,
    repositoryId: claimCore.repositoryId,
    digest: hex(`${label}-transition`),
    sequence,
    idempotencyKey: hex(`${label}-idempotency`),
    requestDigest: hex(`${label}-request`),
    evaluationTime: `2026-08-${String(sequence).padStart(2, "0")}T00:00:00.000Z`,
  };
}

function evidenceFixture() {
  const fixture = sourceFixture();
  const lineage = selectReviewedTerminalHandoffProof(fixture);
  const lease = {
    schema: "agentic-writer-lease/v2",
    status: "review_ready",
    sessionId: "source-session",
    branch: "agent/device/reviewed-lane",
    reviewHeadSha: fixture.lease.reviewHeadSha,
    cloudAuthority: fixture.lease.cloudAuthority,
  };
  const core = {
    schema: "agentic-reviewed-terminal-handoff-successor-recovery-evidence/v1",
    branch: lease.branch,
    headSha: lease.reviewHeadSha,
    treeSha: sha("tree"),
    lease,
    leaseDigest: hex("lease"),
    reviewedSource: lineage.reviewedSource,
    handoffSource: lineage.handoffSource,
    clean: { kind: "clean", evidenceDigest: hex("clean") },
    cleanEvidenceDigest: hex("clean"),
    pullRequest: {},
    pullRequestMarkerDigest: hex("marker"),
    liveInventory: {},
    targetCapability: {},
    targetCapabilityDigest: hex("capability"),
  };
  return { ...core, evidenceDigest: digestValue(core) };
}
