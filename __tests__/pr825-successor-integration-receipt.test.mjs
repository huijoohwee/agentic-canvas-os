import assert from "node:assert/strict";
import test from "node:test";

import {
  PR825_SUCCESSOR_INTEGRATION_RECEIPT_SCHEMA,
  readPr825SuccessorIntegrationReceipt,
} from "../scripts/pr825-successor-integration-receipt.mjs";

test("replays the published PR825 successor integration receipt from the exact authority ref", async () => {
  const record = await readPr825SuccessorIntegrationReceipt();

  assert.equal(record.schema, PR825_SUCCESSOR_INTEGRATION_RECEIPT_SCHEMA);
  assert.equal(
    record.coordinate,
    "17cf6632dc3c951d4600325e79dada1ac05b318b84a8bdf9931b27cb3daa5b15",
  );
  assert.equal(
    record.authorityRef,
    "refs/remotes/origin/adlc/authority/17cf6632dc3c951d4600325e79dada1ac05b318b84a8bdf9931b27cb3daa5b15",
  );
  assert.equal(
    record.storedTransitionDigest,
    "869dad420b7bec0728cfad35c5c2957eac74a608ec4bd09e967a2d2d51b481e2",
  );
  assert.equal(
    record.operationInputDigest,
    "241a0e1dba3d7c0e314229b4f953ca31c5dd01af57169edd89091c90274b2080",
  );
  assert.equal(
    record.planByteDigest,
    "c1c36b4f3a17fcfa70316e9c2c396a2417dd0465702227a23ce368f4f8f8d152",
  );
  assert.equal(
    record.providerProofDigest,
    "9ab7c7755abb0f078c89a9a9e209a52d5b5ac512200c82156b7572a645773a96",
  );
  assert.equal(
    record.publicationDigest,
    "6649e0ea577203535ac634720d205599defdf74edcb1385d1363c6daf63bf56a",
  );
  assert.equal(
    record.receipt.transitionReceipt.receiptDigest,
    "2613662bfebba6e7b84d6a479f592844a12368be3f8fa0882e89a6dc98ddbc11",
  );
  assert.equal(
    record.receipt.receiptDigest,
    "dfcfc9813f5be7b893b7e892b7e835438409c8f6ea1af9f2a4fe96b9c939cdbc",
  );
  assert.equal(
    record.receipt.transitionReceipt.resultFenceRevision,
    "17cf6632dc3c951d4600325e79dada1ac05b318b84a8bdf9931b27cb3daa5b15",
  );
  assert.equal(record.receipt.transitionReceipt.resultLeaseEpoch, 2);
  assert.equal(record.sourcePublishedAt, "2026-09-03T08:27:10.000Z");
  assert.equal(record.sourceExpiresAt, "2026-09-03T08:41:35.861Z");
  assert.match(record.recordDigest, /^[0-9a-f]{64}$/u);
});
