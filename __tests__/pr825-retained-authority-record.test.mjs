import assert from "node:assert/strict";
import test from "node:test";

import {
  PR825_RETAINED_AUTHORITY,
  readPr825RetainedAuthorityRecord,
} from "../scripts/pr825-retained-authority-record.mjs";

const FIXED_NOW = "2026-09-03T05:02:33.000Z";

test("reconstructs the exact retained PR825 authority issuance", async () => {
  const record = await readPr825RetainedAuthorityRecord({
    now: () => new Date(FIXED_NOW),
  });

  assert.equal(record.schema, "agentic-canvas-os/pr825-retained-authority-record/v1");
  assert.equal(record.reviewLocator, PR825_RETAINED_AUTHORITY.reviewLocator);
  assert.equal(record.authorityRef, PR825_RETAINED_AUTHORITY.authorityRef);
  assert.equal(record.evidencePath, PR825_RETAINED_AUTHORITY.evidencePath);
  assert.equal(record.sourceBranch, PR825_RETAINED_AUTHORITY.branch);
  assert.equal(record.sourceBaseSha, PR825_RETAINED_AUTHORITY.baseSha);
  assert.equal(record.sourceHeadSha, PR825_RETAINED_AUTHORITY.headSha);
  assert.equal(record.protectedMergeSha, PR825_RETAINED_AUTHORITY.mergeSha);
  assert.equal(record.retrospectiveRecovery, true);
  assert.equal(record.reviewMerged, true);
  assert.equal(record.evaluatedAt, FIXED_NOW);
  assert.equal(record.currentStartWindowOpen, false);
  assert.equal(record.predecessorExpiresAt, "2026-09-03T02:41:01.955Z");
  assert.equal(record.millisecondsPastExpiry, 8_491_045);
  for (const key of [
    "storedDigest",
    "publicationReceiptDigest",
    "transitionReceiptDigest",
    "issuanceDigest",
  ]) {
    assert.match(record[key], /^[0-9a-f]{64}$/u, key);
  }
});
