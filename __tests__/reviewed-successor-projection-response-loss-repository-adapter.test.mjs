import test from "node:test";
import assert from "node:assert/strict";

import { reviewedSuccessorMarkerHeadSha }
  from "../scripts/reviewed-successor-projection-response-loss-repository-adapter.mjs";

const SHA = value => value.repeat(40);

test("review-ready partial-local markers use the reviewed head instead of a stale fence", () => {
  const reviewedHeadSha = SHA("c");
  const marker = {
    status: "review_ready",
    fenceSha: SHA("7"),
    reviewHeadSha: reviewedHeadSha,
  };

  assert.equal(reviewedSuccessorMarkerHeadSha(marker), reviewedHeadSha);
});

test("a changed review-ready marker head cannot satisfy the sealed lane head", () => {
  const sealedHeadSha = SHA("c");
  const marker = {
    status: "review_ready",
    fenceSha: SHA("7"),
    reviewHeadSha: SHA("d"),
  };

  assert.notEqual(reviewedSuccessorMarkerHeadSha(marker), sealedHeadSha);
});

test("active markers continue to use their fencing head", () => {
  const fenceSha = SHA("7");
  const marker = {
    status: "active",
    fenceSha,
    reviewHeadSha: SHA("c"),
  };

  assert.equal(reviewedSuccessorMarkerHeadSha(marker), fenceSha);
});
