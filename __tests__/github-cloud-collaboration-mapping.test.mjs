import assert from "node:assert/strict";
import test from "node:test";

import { prepareMutationRequest } from "../scripts/github-cloud-collaboration-mapping.mjs";

test("claim mapping preserves the repository-proven canonical descendant subject", () => {
  const canonicalDescendantProof = Object.freeze({
    schema: "agentic-legacy-review-current-base-disjoint-proof/v1",
    evidenceDigest: "e".repeat(64),
  });
  const mapped = prepareMutationRequest({
    action: "claim",
    input: {
      deviceId: "device",
      sessionId: "session",
      idempotencyKey: "claim:historical-base",
      workItemId: "historical-base",
      canonicalBaseRevision: "a".repeat(40),
      laneRevision: "b".repeat(40),
      declaredWriteScope: ["path:scripts/a.mjs"],
      leaseEpoch: 2,
      predecessorClaimId: "c".repeat(64),
      canonicalDescendantProof,
      ttlSeconds: 1_800,
    },
    actor: { id: 1 },
    repository: { nodeId: "repository" },
    pullRequest: null,
    evaluationTime: "2026-08-20T00:00:00.000Z",
  });
  assert.equal(mapped.canonicalDescendantProof, canonicalDescendantProof);
});
