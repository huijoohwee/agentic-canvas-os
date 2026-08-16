import test from "node:test";
import assert from "node:assert/strict";
import { buildLocalReleaseProjection, isReleasedProjection } from "../scripts/planned-admission-owner-release-store.mjs";
test("local projection retains the complete original lease", () => { const originalLease = { schema: "agentic-writer-lease/v2", status: "active", nested: { proof: true } };
  const plan = { planDigest: "a".repeat(64), claim: { claimId: "b".repeat(64) }, pullRequest: { url: "https://e/p/1" },
    preservedLane: { stateDigest: "c".repeat(64) }, staleLeaseDigest: "" };
  const release = buildLocalReleaseProjection({ plan, originalLease, cloud: { receiptDigest: "d".repeat(64) },
    provider: { disposition: "closed-unmerged" }, completedAt: "2026-08-16T00:00:00.000Z" });
  plan.staleLeaseDigest = release.originalLeaseDigest; const lease = { status: "released", plannedAdmissionOwnerRelease: release };
  assert.deepEqual(release.originalLease, originalLease); assert.equal(isReleasedProjection(lease, plan), true); });
