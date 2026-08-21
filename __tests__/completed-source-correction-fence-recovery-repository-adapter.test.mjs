import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { recoveredCloudAuthorityAlreadyProjected } from "../scripts/completed-source-correction-fence-recovery-repository-adapter.mjs";

test("repository adapter limits its protected effects", () => {
  const source = readFileSync(new URL("../scripts/completed-source-correction-fence-recovery-repository-adapter.mjs", import.meta.url), "utf8");
  assert.match(source, /authorizeTaskBoundLeaseMutation/u);
  assert.match(source, /currentSuccessorRepair/u);
  assert.match(source, /successorTaskBindingSourceLeaseDigest/u);
  assert.match(source, /recoverPlannedAdmissionCloudAuthority/u);
  assert.match(source, /casWriterLeaseProjection/u);
  assert.match(source, /updateWriterLeasePullRequestBody/u);
  assert.doesNotMatch(source, /git", \["push/u);
  assert.doesNotMatch(source, /git", \["commit/u);
  assert.doesNotMatch(source, /wrangler|pages deploy/u);
});

test("same-claim recovery requires the complete cloud authority projection", () => {
  const current = {
    claimId: "a".repeat(64),
    claimDigest: "b".repeat(64),
    transitionCounter: 3,
    operationReceiptDigest: "c".repeat(64),
  };
  assert.equal(recoveredCloudAuthorityAlreadyProjected(current, current), true);
  assert.equal(recoveredCloudAuthorityAlreadyProjected(current, {
    ...current,
    transitionCounter: 4,
    operationReceiptDigest: "d".repeat(64),
  }), false);
});
