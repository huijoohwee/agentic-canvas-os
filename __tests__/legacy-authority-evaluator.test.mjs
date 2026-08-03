import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  LEGACY_AUTHORITY_EVALUATION_RESULT_SCHEMA,
  LEGACY_AUTHORITY_RETIREMENT_RECEIPT_SCHEMA,
  LEGACY_LANE_PRESERVATION_RECEIPT_SCHEMA,
  createLegacyAuthorityRetirementReceipt,
  createLegacyLanePreservationReceipt,
  createLegacyReviewAdapter,
  evaluateLegacyAuthority,
} from "../scripts/legacy-authority-evaluator.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";

const lifecycleDoc = readFileSync(
  new URL("../docs/CANONICAL-LIFECYCLE.md", import.meta.url),
  "utf8",
);

const digest = (character) => character.repeat(64);

function authority(overrides = {}) {
  return {
    claimId: digest("1"),
    claimDigest: digest("2"),
    scopeId: "scope:legacy-authority",
    branchId: "agent/device/legacy-authority",
    laneRevision: digest("3"),
    fenceRevision: "legacy-fence-revision",
    reviewRequestId: "review-request:42",
    declaredWriteSet: [
      "path:docs/CANONICAL-LIFECYCLE.md",
      "path:scripts/legacy-authority-evaluator.mjs",
      "semantic:legacy-authority-evaluator",
    ],
    writeSetDigest: digest("a"),
    stateDigest: digest("b"),
    ...overrides,
  };
}

function successor(overrides = {}) {
  return {
    scopeId: "scope:successor",
    declaredWriteSet: [
      "path:scripts/legacy-authority-evaluator.mjs",
      "semantic:successor",
    ],
    writeSetDigest: digest("c"),
    ...overrides,
  };
}

function authorization(selection, overrides = {}) {
  return {
    selection,
    selectedBy: "operator:release-reviewer",
    selectedAt: "2026-08-03T07:22:00.000Z",
    idempotencyKey: `legacy-authority-${selection}`,
    expectedOverlapClass: "overlapping",
    ...overrides,
  };
}

function withExactDigests(record) {
  if (record.declaredWriteSet) {
    const normalized = [...record.declaredWriteSet].sort();
    record = {
      ...record,
      declaredWriteSet: normalized,
      writeSetDigest: digestValue(normalized),
    };
  }
  return record;
}

test("contract constructors emit deterministic legacy preservation and retirement receipts", () => {
  const preserved = createLegacyLanePreservationReceipt({
    authority: withExactDigests(authority()),
    successorAuthority: withExactDigests(successor()),
    captureAdapterId: "adapter:legacy-capture",
    capturedAt: "2026-08-03T07:20:00.000Z",
  });
  assert.equal(preserved.schema, LEGACY_LANE_PRESERVATION_RECEIPT_SCHEMA);
  assert.equal(preserved.status, "retained-legacy");
  assert.equal(preserved.overlapClass, "overlapping");

  const retired = createLegacyAuthorityRetirementReceipt(preserved, {
    authority: withExactDigests(authority()),
    reviewObservation: {
      reviewRequestId: "review-request:42",
      branchId: "agent/device/legacy-authority",
      laneRevision: digest("3"),
      observedAt: "2026-08-03T07:21:00.000Z",
    },
    authorizationSelectionDigest: digest("4"),
    reviewAdapterId: "adapter:review",
    retiredAt: "2026-08-03T07:22:00.000Z",
  });
  assert.equal(retired.schema, LEGACY_AUTHORITY_RETIREMENT_RECEIPT_SCHEMA);
  assert.equal(retired.status, "retired-preserved");
  assert.equal(
    retired.legacyLanePreservationReceiptDigest,
    preserved.receiptDigest,
  );
});

test("replaceable review adapters validate the exact review projection before retirement", async () => {
  const preserved = createLegacyLanePreservationReceipt({
    authority: withExactDigests(authority()),
    successorAuthority: withExactDigests(successor()),
    captureAdapterId: "adapter:legacy-capture",
    capturedAt: "2026-08-03T07:20:00.000Z",
  });
  const reviewAdapter = createLegacyReviewAdapter({
    adapterId: "adapter:provider-neutral-review",
    async readReviewState(input) {
      return {
        reviewRequestId: input.reviewRequestId,
        branchId: input.branchId,
        laneRevision: input.laneRevision,
        observedAt: "2026-08-03T07:21:00.000Z",
      };
    },
  });

  const result = await evaluateLegacyAuthority({
    expectedAuthority: withExactDigests(authority()),
    observedAuthority: withExactDigests(authority()),
    successorAuthority: withExactDigests(successor()),
    authorization: authorization("retire"),
    preservationReceipt: preserved,
  }, { reviewAdapter });

  assert.equal(result.schema, LEGACY_AUTHORITY_EVALUATION_RESULT_SCHEMA);
  assert.equal(result.status, "retired-preserved");
  assert.equal(result.overlapClass, "overlapping");
  assert.equal(
    result.legacyAuthorityRetirementReceipt.reviewAdapterId,
    "adapter:provider-neutral-review",
  );
});

test("lifecycle evaluation replays the exact prior result without widening authority", async () => {
  const input = {
    expectedAuthority: withExactDigests(authority({ reviewRequestId: null })),
    observedAuthority: withExactDigests(authority({ reviewRequestId: null })),
    successorAuthority: withExactDigests(successor()),
    authorization: authorization("retain"),
  };
  const first = await evaluateLegacyAuthority(input);
  const replayed = await evaluateLegacyAuthority({
    ...input,
    replay: first,
  });

  assert.equal(first.status, "retained-legacy");
  assert.equal(first.replayed, false);
  assert.equal(replayed.status, "retained-legacy");
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.requestDigest, first.requestDigest);
  assert.equal(
    replayed.legacyLanePreservationReceipt.receiptDigest,
    first.legacyLanePreservationReceipt.receiptDigest,
  );
});

test("adversarial drift, overlap, replay, and missing receipt cases fail closed", async () => {
  const retained = await evaluateLegacyAuthority({
    expectedAuthority: withExactDigests(authority({ reviewRequestId: null })),
    observedAuthority: withExactDigests(authority({ reviewRequestId: null })),
    successorAuthority: withExactDigests(successor()),
    authorization: authorization("retain"),
  });

  const cases = [
    [
      "claim drift",
      async () => evaluateLegacyAuthority({
        expectedAuthority: withExactDigests(authority()),
        observedAuthority: withExactDigests(authority({ claimId: digest("9") })),
        successorAuthority: withExactDigests(successor()),
        authorization: authorization("retain"),
      }),
      "claim-drift",
    ],
    [
      "missing preservation receipt",
      async () => evaluateLegacyAuthority({
        expectedAuthority: withExactDigests(authority()),
        observedAuthority: withExactDigests(authority()),
        successorAuthority: withExactDigests(successor()),
        authorization: authorization("retire"),
      }, {
        reviewAdapter: createLegacyReviewAdapter({
          adapterId: "adapter:review",
          async readReviewState(input) {
            return {
              reviewRequestId: input.reviewRequestId,
              branchId: input.branchId,
              laneRevision: input.laneRevision,
              observedAt: "2026-08-03T07:21:00.000Z",
            };
          },
        }),
      }),
      "missing-preservation-receipt",
    ],
    [
      "overlap expectation drift",
      async () => evaluateLegacyAuthority({
        expectedAuthority: withExactDigests(authority({ reviewRequestId: null })),
        observedAuthority: withExactDigests(authority({ reviewRequestId: null })),
        successorAuthority: withExactDigests(successor()),
        authorization: authorization("retain", {
          expectedOverlapClass: "disjoint",
        }),
      }),
      "overlap-class-drift",
    ],
    [
      "review observation drift",
      async () => evaluateLegacyAuthority({
        expectedAuthority: withExactDigests(authority()),
        observedAuthority: withExactDigests(authority()),
        successorAuthority: withExactDigests(successor()),
        authorization: authorization("retire"),
        preservationReceipt: createLegacyLanePreservationReceipt({
          authority: withExactDigests(authority()),
          successorAuthority: withExactDigests(successor()),
          captureAdapterId: "adapter:legacy-capture",
          capturedAt: "2026-08-03T07:20:00.000Z",
        }),
      }, {
        reviewAdapter: createLegacyReviewAdapter({
          adapterId: "adapter:review",
          async readReviewState(input) {
            return {
              reviewRequestId: input.reviewRequestId,
              branchId: "agent/device/other",
              laneRevision: input.laneRevision,
              observedAt: "2026-08-03T07:21:00.000Z",
            };
          },
        }),
      }),
      "review-observation-drift",
    ],
    [
      "replay request drift",
      async () => evaluateLegacyAuthority({
        expectedAuthority: withExactDigests(authority({ reviewRequestId: null })),
        observedAuthority: withExactDigests(authority({ reviewRequestId: null })),
        successorAuthority: withExactDigests(successor()),
        authorization: authorization("retain"),
        replay: {
          ...retained,
          requestDigest: digest("0"),
        },
      }),
      "replay-request-drift",
    ],
  ];

  for (const [label, invoke, findingCode] of cases) {
    const result = await invoke();
    assert.equal(result.status, "blocked", label);
    assert.ok(
      result.blockingFindings.some((finding) => finding.code === findingCode),
      label,
    );
  }
});

test("canonical lifecycle documentation records legacy preservation and retirement semantics", () => {
  for (const term of [
    "Legacy Lane Preservation Receipt",
    "Legacy Authority Retirement Receipt",
    "retained-legacy",
    "retired-preserved",
    "replaceable review adapter",
  ]) {
    assert.match(lifecycleDoc, new RegExp(term.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(
    lifecycleDoc,
    /Authorization may choose retain or retire\s+but never synthesize missing claim, fence, scope, revision, or receipt\./u,
  );
});
