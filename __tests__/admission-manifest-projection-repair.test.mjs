import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAdmissionManifestProjectionRepairPlan,
  beginAdmissionManifestProjectionRepairEffect,
  createAdmissionManifestProjectionRepairIntent,
  deriveAdmissionManifestProjection,
} from "../scripts/admission-manifest-projection-repair-contract.mjs";
import { createAdmissionManifestProjectionRepairController } from "../scripts/admission-manifest-projection-repair-controller.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";

const hex = (character, length) => character.repeat(length);

function evidence() {
  const declaredWriteSet = ["path:scripts/recovery.mjs", "semantic:reviewed-recovery"];
  const projection = deriveAdmissionManifestProjection({ semanticScope: "reviewed-recovery", declaredWriteSet });
  return {
    repository: { nameWithOwner: "owner/repo", nodeId: "R_repo", actorId: "github-user:1" },
    canonical: { headSha: hex("1", 40), clean: true },
    pullRequest: { number: 380, url: "https://example.test/pull/380", state: "OPEN", isDraft: false,
      branch: "agent/device/reviewed-recovery", headSha: hex("2", 40), baseBranch: "main", baseSha: hex("3", 40),
      reviewRequestId: "github-pull-request:PR_380" },
    lease: { status: "review_ready", epoch: 4, sessionId: "session", branch: "agent/device/reviewed-recovery",
      reviewHeadSha: hex("2", 40), worktreePath: "/tmp/reviewed-recovery", claimId: hex("4", 64) },
    claim: { claimId: hex("4", 64), state: "reviewed", writeAuthority: false, scopeReserved: true,
      laneRevision: hex("2", 40), transitionCounter: 3, fenceRevision: hex("5", 64),
      operationReceiptDigest: hex("6", 64), ledgerRevision: hex("7", 40), ledgerDigest: hex("8", 64) },
    projection: { semanticScope: "reviewed-recovery", declaredWriteSet, ...projection,
      registryRevision: 12, registryDigest: hex("9", 64), oldLeaseDigest: hex("a", 64), newLeaseDigest: hex("b", 64),
      oldMarkerDigest: hex("c", 64), newMarkerDigest: hex("d", 64), oldBodyDigest: hex("e", 64), newBodyDigest: hex("f", 64) },
  };
}

function harness({ providerAlreadyApplied = false } = {}) {
  let intent = null, provider = providerAlreadyApplied ? "new" : "old", registry = "old";
  const adapter = {
    readPlanEvidence: evidence,
    withOperationLock(_value, action) { return action(); },
    readIntent() { return intent; },
    writeIntent({ expected, value }) { assert.equal(digestValue(intent), digestValue(expected)); intent = value; },
    revalidate({ phase }) {
      if (phase === "provider-projected") assert.deepEqual([provider, registry], ["old", "old"]);
      else assert.deepEqual([provider, registry], ["new", "old"]);
    },
    reconcile({ phase }) {
      if (phase === "provider-projected" && provider === "new") return { bodyDigest: hex("f", 64), markerDigest: hex("d", 64) };
      if (phase === "registry-projected" && registry === "new") return { registryDigest: hex("0", 64), leaseDigest: hex("b", 64) };
      return null;
    },
    projectProvider() { provider = "new"; },
    projectRegistry() { registry = "new"; },
    verify() {
      assert.deepEqual([provider, registry], ["new", "new"]);
      return { providerBodyDigest: hex("f", 64), registryDigest: hex("0", 64), leaseDigest: hex("b", 64) };
    },
  };
  return { adapter, read: () => ({ intent, provider, registry }) };
}

test("derives the canonical source manifest and identifies the legacy transport projection", () => {
  const projection = deriveAdmissionManifestProjection({ semanticScope: "reviewed-recovery",
    declaredWriteSet: ["semantic:reviewed-recovery", "path:scripts/recovery.mjs"] });
  assert.equal(projection.canonicalManifestDigest, digestValue({ schema: "agentic-declared-write-scope/v1",
    semanticScope: "reviewed-recovery", paths: ["scripts/recovery.mjs"] }));
  assert.equal(projection.legacyManifestDigest, digestValue({ schema: "agentic-declared-write-scope/v1",
    semanticScope: "reviewed-recovery", declaredWriteSet: projection.declaredWriteSet }));
  assert.notEqual(projection.canonicalManifestDigest, projection.legacyManifestDigest);
});

test("requires exact authorization and emits a no-source no-claim receipt", () => {
  const source = harness(), controller = createAdmissionManifestProjectionRepairController({ adapter: source.adapter });
  const plan = controller.plan();
  assert.throws(() => controller.run({ plan, authorization: "authorize wrong" }), /authorization/);
  const receipt = controller.run({ plan, authorization: plan.exactAuthorization });
  assert.equal(receipt.status, "repaired");
  assert.equal(receipt.claimMutation, false);
  assert.equal(receipt.refMutation, false);
  assert.equal(receipt.sourceMutation, false);
  assert.deepEqual([source.read().provider, source.read().registry], ["new", "new"]);
});

test("reconciles a provider response loss before the registry CAS", () => {
  const source = harness({ providerAlreadyApplied: true });
  const plan = buildAdmissionManifestProjectionRepairPlan(evidence());
  const prepared = beginAdmissionManifestProjectionRepairEffect(
    createAdmissionManifestProjectionRepairIntent(plan),
    "provider-projected",
  );
  source.adapter.writeIntent({ expected: null, value: prepared });
  const receipt = createAdmissionManifestProjectionRepairController({ adapter: source.adapter })
    .run({ plan, authorization: plan.exactAuthorization });
  assert.equal(receipt.status, "repaired");
  assert.equal(source.read().registry, "new");
});

test("fails closed when projection evidence is arbitrary", () => {
  const source = evidence(); source.projection.legacyManifestDigest = hex("0", 64);
  assert.throws(() => buildAdmissionManifestProjectionRepairPlan(source), /legacyManifestDigest/);
});
