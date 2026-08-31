import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  LEDGER_REF_BARRIER_RECEIPT_SCHEMA,
  LEDGER_REF_BARRIER_SCHEMA,
  buildGithubCloudCollaborationLedgerRefBarrierRequest,
  establishGithubCloudCollaborationLedgerRefBarrier,
  normalizeGithubCloudCollaborationLedgerRefBarrierRequest,
  normalizeGithubCloudCollaborationLedgerRefBarrierReceipt,
} from "../scripts/github-cloud-collaboration-ledger-ref-barrier.mjs";

const S = character => character.repeat(40);
const D = label => digestValue({ label });
const A = S("a");
const B = S("b");
const C = S("c");
const CHILD = S("d");
const TREE = S("e");
const BLOB = S("f");

function requestFixture() {
  return buildGithubCloudCollaborationLedgerRefBarrierRequest({
    operation: "active-dirty-scope-expansion-intent-supersession",
    operationDigest: D("operation"),
    repository: "example/repository",
    ref: "refs/heads/agentic/collaboration-ledger",
    sourceRevision: A,
    sourceTreeSha: TREE,
    ledgerBlobSha: BLOB,
    rawDigest: D("raw"),
    ledgerDigest: D("ledger"),
    sequence: 83,
  });
}

function providerFixture({ mode = "success", initial = A } = {}) {
  const request = requestFixture();
  const commits = new Map([
    [A, { sha: A, treeSha: TREE, parentShas: [S("9")], message: "source" }],
    [B, { sha: B, treeSha: TREE, parentShas: [A], message: request.message }],
    [C, { sha: C, treeSha: TREE, parentShas: [A], message: "competing cloud effect" }],
    [CHILD, { sha: CHILD, treeSha: TREE, parentShas: [B], message: "later no-op" }],
  ]);
  const calls = [];
  let ref = initial;
  const provider = {
    async readReference() { calls.push(["readReference", ref]); return ref; },
    async readCommit(sha) { calls.push(["readCommit", sha]); return commits.get(sha); },
    async createCommit(value) {
      calls.push(["createCommit", value]);
      assert.deepEqual(value, { message: request.message, treeSha: TREE, parentSha: A });
      return commits.get(B);
    },
    async updateReference(value) {
      calls.push(["updateReference", value]);
      assert.deepEqual(value, { sha: B, force: false });
      if (mode === "sibling-race") {
        ref = C;
        throw new Error("non-fast-forward");
      }
      ref = B;
      if (mode === "response-loss") throw new Error("socket closed");
    },
    async readLedgerSnapshot(revision) {
      calls.push(["readLedgerSnapshot", revision]);
      return {
        revision,
        treeSha: TREE,
        blobSha: BLOB,
        rawDigest: D("raw"),
        ledgerDigest: D("ledger"),
        sequence: 83,
        ledger: { schema: "agentic-cloud-collaboration-ledger/v1", sequence: 83 },
      };
    },
  };
  return { request, provider, calls };
}

test("projects one identical-tree barrier through a non-forced ref CAS", async () => {
  const fixture = providerFixture();
  const { receipt } = await establishGithubCloudCollaborationLedgerRefBarrier(fixture);
  assert.equal(receipt.disposition, "projected");
  assert.equal(receipt.commitCreationAcknowledged, true);
  assert.equal(receipt.refUpdateAcknowledged, true);
  assert.equal(receipt.sourceRevision, A);
  assert.equal(receipt.barrierRevision, B);
  assert.equal(receipt.observedRevision, B);
  assert.equal(receipt.sourceTreeSha, receipt.barrierTreeSha);
  assert.equal(normalizeGithubCloudCollaborationLedgerRefBarrierReceipt(receipt)
    .receiptDigest, receipt.receiptDigest);
  assert.deepEqual(fixture.calls.find(call => call[0] === "updateReference")[1], {
    sha: B,
    force: false,
  });
});

test("request and receipt schemas and rebuilt sealed digests are closed", async () => {
  const fixture = providerFixture();
  const { receipt } = await establishGithubCloudCollaborationLedgerRefBarrier(fixture);
  assert.equal(normalizeGithubCloudCollaborationLedgerRefBarrierRequest(fixture.request).schema,
    LEDGER_REF_BARRIER_SCHEMA);
  assert.throws(() => normalizeGithubCloudCollaborationLedgerRefBarrierRequest({
    ...fixture.request,
    schema: "agentic-github-cloud-collaboration-ledger-ref-barrier/v0",
  }), /sealed metadata/u);
  assert.throws(() => normalizeGithubCloudCollaborationLedgerRefBarrierRequest({
    ...fixture.request,
    metadataDigest: D("foreign-metadata"),
  }), /sealed metadata/u);
  assert.throws(() => normalizeGithubCloudCollaborationLedgerRefBarrierRequest({
    ...fixture.request,
    messageDigest: D("foreign-message"),
  }), /sealed metadata/u);

  for (const patch of [
    { schema: "agentic-github-cloud-collaboration-ledger-ref-barrier-receipt/v0" },
    { metadataDigest: D("foreign-metadata") },
    { messageDigest: D("foreign-message") },
  ]) {
    const { receiptDigest: _old, ...core } = { ...receipt, ...patch };
    const resealed = { ...core, receiptDigest: digestValue(core) };
    assert.throws(
      () => normalizeGithubCloudCollaborationLedgerRefBarrierReceipt(resealed),
      /schema|rebuilt sealed request/u,
    );
  }
  assert.equal(receipt.schema, LEDGER_REF_BARRIER_RECEIPT_SCHEMA);
});

test("adopts an exact barrier after update response loss", async () => {
  const fixture = providerFixture({ mode: "response-loss" });
  const { receipt } = await establishGithubCloudCollaborationLedgerRefBarrier(fixture);
  assert.equal(receipt.disposition, "adopted-response-loss");
  assert.equal(receipt.commitCreationAcknowledged, true);
  assert.equal(receipt.refUpdateAcknowledged, false);
  assert.equal(receipt.barrierRevision, B);
});

test("rejects a sibling winner instead of clearing behind an old cloud effect", async () => {
  const fixture = providerFixture({ mode: "sibling-race" });
  await assert.rejects(
    () => establishGithubCloudCollaborationLedgerRefBarrier(fixture),
    /lost its non-fast-forward CAS/u,
  );
  assert.equal(fixture.calls.filter(call => call[0] === "updateReference").length, 1);
});

test("replays through an exact descendant without another provider mutation", async () => {
  const fixture = providerFixture({ initial: CHILD });
  const { receipt } = await establishGithubCloudCollaborationLedgerRefBarrier(fixture);
  assert.equal(receipt.disposition, "replayed");
  assert.equal(receipt.commitCreationAcknowledged, false);
  assert.equal(receipt.refUpdateAcknowledged, false);
  assert.equal(receipt.barrierRevision, B);
  assert.equal(receipt.observedRevision, CHILD);
  assert.equal(fixture.calls.some(call => call[0] === "createCommit"), false);
  assert.equal(fixture.calls.some(call => call[0] === "updateReference"), false);
});

test("fails closed on barrier message, tree, or ledger-payload drift", async () => {
  for (const mutation of [
    provider => { provider.readCommit = async sha => sha === B
      ? { sha: B, treeSha: TREE, parentShas: [A], message: "forged" }
      : { sha: A, treeSha: TREE, parentShas: [S("9")], message: "source" }; },
    provider => { provider.readLedgerSnapshot = async revision => ({
      revision,
      treeSha: TREE,
      blobSha: BLOB,
      rawDigest: D("different"),
      ledgerDigest: D("ledger"),
      sequence: 83,
      ledger: {},
    }); },
  ]) {
    const fixture = providerFixture({ initial: B });
    mutation(fixture.provider);
    await assert.rejects(
      () => establishGithubCloudCollaborationLedgerRefBarrier(fixture),
      /sealed parent\/tree\/message|sealed ledger payload/u,
    );
  }
});
