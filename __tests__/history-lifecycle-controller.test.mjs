// Responsibility: Prove history audit and planning require stable evidence and never emit mutation authority.

import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { createHistoryLifecycleController } from "../scripts/history-lifecycle-controller.mjs";
import { HISTORY_LIFECYCLE_EVIDENCE_SCHEMA } from "../scripts/history-lifecycle-contract.mjs";

test("audit accepts stable consecutive captures and emits no effects or authority", async () => {
  const evidence = fixtureEvidence();
  let captures = 0;
  const result = await createHistoryLifecycleController({
    adapter: { async captureEvidence() { captures += 1; return evidence; } },
  }).audit();

  assert.equal(captures, 2);
  assert.equal(result.status, "audited");
  assert.equal(result.plan, null);
  assert.deepEqual(result.effects, []);
  assert.equal(result.mutationAuthorized, false);
  assert.equal(result.mutationAuthority, null);
});

test("repository adapters may verify a pinned capture without repeating heavy analysis", async () => {
  const evidence = fixtureEvidence();
  let captures = 0; let verifications = 0;
  const result = await createHistoryLifecycleController({ adapter: {
    async captureEvidence() { captures += 1; return evidence; },
    async verifyEvidence(captured) { verifications += 1;
      assert.equal(captured.evidenceDigest, evidence.evidenceDigest); return captured; },
  } }).plan();
  assert.equal(captures, 1);
  assert.equal(verifications, 1);
  assert.equal(result.status, "planned");
});

test("plan rejects evidence drift across captures", async () => {
  const captures = [fixtureEvidence(), fixtureEvidence({ comparisonRevision: "3".repeat(40) })];
  const controller = createHistoryLifecycleController({
    adapter: { async captureEvidence() { return captures.shift(); } },
  });
  await assert.rejects(controller.plan(), /drifted between consecutive captures/u);
});

test("plan embeds the stable evidence and remains structurally advisory", async () => {
  const evidence = fixtureEvidence();
  const result = await createHistoryLifecycleController({
    adapter: { async captureEvidence() { return evidence; } },
  }).plan();

  assert.equal(result.status, "planned");
  assert.equal(result.plan.evidenceDigest, evidence.evidenceDigest);
  assert.deepEqual(result.plan.effects, []);
  assert.equal(result.plan.mutationAuthorized, false);
  assert.equal(result.plan.mutationAuthority, null);
  assert.equal(Object.hasOwn(result.plan, "exactAuthorization"), false);
});

function fixtureEvidence({ comparisonRevision = "1".repeat(40) } = {}) {
  const frontierCore = {
    comparisonRevision,
    refsDigest: "a".repeat(64),
    worktreesDigest: "b".repeat(64),
    leaseSourceDigest: null,
    statusDigest: "c".repeat(64),
    remoteDigest: null,
    providerDigest: null,
  };
  const frontier = { ...frontierCore, digest: digestValue(frontierCore) };
  const core = {
    schema: HISTORY_LIFECYCLE_EVIDENCE_SCHEMA,
    repository: {
      root: "/workspace/repository",
      gitCommonDir: "/workspace/repository/.git",
      objectFormat: "sha1",
      shallow: { present: false, digest: null },
      replaceRefs: [],
      grafts: { present: false, digest: null },
    },
    comparison: {
      ref: "refs/heads/main",
      revision: comparisonRevision,
      tree: "2".repeat(40),
      clean: false,
      frontierBefore: frontier,
      frontierAfter: frontier,
      stable: true,
      remote: null,
      provider: null,
    },
    worktrees: [{ path: "/workspace/repository", head: comparisonRevision, branch: "refs/heads/main",
      detached: false, bare: false, locked: false, prunable: false }],
    branches: [{ ref: "refs/heads/main", revision: comparisonRevision, tree: "2".repeat(40),
      upstreamRef: null, remoteRevision: null, relationship: "same", ahead: 0, behind: 0,
      reflog: { complete: true, entryCount: 1, digest: "d".repeat(64),
        uniqueRevisions: [comparisonRevision] },
      patch: { status: "not-evaluated", id: null, advisory: "non-authoritative" } }],
    stashes: [],
    recoveryAnchors: [],
    leases: { schema: null, revision: null, digest: null, entries: [] },
    providerChanges: [],
    completeness: { refs: true, worktrees: true, stashes: true, recoveryAnchors: true,
      leases: true, providerChanges: false, bounded: true, corruptionFree: true,
      raceFree: true, reasons: ["provider-not-requested", "remote-not-requested"] },
  };
  return { ...core, evidenceDigest: digestValue(core) };
}
