import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTIVE_DEPLOYMENT_SCHEMA,
  DEPLOYMENT_RECEIPT_SCHEMA,
  PRESERVE_RECEIPT_SCHEMA,
  PRODUCTION_AUTHORITY_SCHEMA,
  ROLLBACK_RECEIPT_SCHEMA,
  VERSION_EVIDENCE_SCHEMA,
  createProductionCandidate,
  digestValue,
  productionVersionTag,
} from "../scripts/acos-production-release-contract.mjs";
import {
  ProductionReleaseRefusal,
  executeAcosProductionRelease,
} from "../scripts/acos-production-release-controller.mjs";

const SOURCE = "a".repeat(40);
const TREE = "b".repeat(40);
const CONFIG = "c".repeat(64);
const STORAGE = "d".repeat(64);
const BINDINGS = "f".repeat(64);
const UNMANAGED = "1".repeat(64);
const OLD_VERSION = "06c0961f-5ca1-47c5-819a-b8a825d761d4";
const NEW_VERSION = "2c6dfa54-cf90-44dd-8642-78bfdd725f1f";
const TIMESTAMP = "2026-09-03T04:05:06.123Z";

function candidate() {
  return createProductionCandidate({
    sourceRevision: SOURCE,
    sourceTree: TREE,
    configurationDigest: CONFIG,
    bindingTopologyDigest: BINDINGS,
    storageCompatibilityRevision: STORAGE,
    requiredSecrets: ["AGENT_API_JWT_SECRET", "AGENT_REVIEW_JWT_SECRET"],
  });
}

function authority(value = candidate()) {
  return {
    schema: PRODUCTION_AUTHORITY_SCHEMA,
    repository: "huijoohwee/agentic-canvas-os",
    environment: "production",
    environmentId: 91,
    reviewerId: 42,
    reviewerLogin: "release-owner",
    reviewedAt: "2026-09-03T04:00:00.000Z",
    runId: 1001,
    runAttempt: 1,
    event: "workflow_dispatch",
    headBranch: "main",
    headSha: value.sourceRevision,
    workflowPath: ".github/workflows/production-release.yml",
    jobId: 1002,
    jobName: "production-release",
    jobStatus: "in_progress",
    branchProtected: true,
  };
}

function active(
  versionId = OLD_VERSION,
  storageCompatibilityRevision = STORAGE,
  deploymentId = "deployment-old",
  {
    releaseManaged = true,
    unmanagedBindingsDigest = UNMANAGED,
    unmanagedBindingsAttestationDigest = releaseManaged ? unmanagedBindingsDigest : null,
  } = {},
) {
  return {
    schema: ACTIVE_DEPLOYMENT_SCHEMA,
    deploymentId,
    versionId,
    percentage: 100,
    storageCompatibilityRevision,
    releaseManaged,
    unmanagedBindingsDigest,
    unmanagedBindingsAttestationDigest,
  };
}

function version(value = candidate()) {
  return {
    schema: VERSION_EVIDENCE_SCHEMA,
    versionId: NEW_VERSION,
    versionTag: productionVersionTag(value.candidateDigest),
    versionTimestamp: TIMESTAMP,
    sourceRevision: value.sourceRevision,
    candidateDigest: value.candidateDigest,
    configurationDigest: value.configurationDigest,
    bindingTopologyDigest: value.bindingTopologyDigest,
    baselineUnmanagedBindingsDigest: UNMANAGED,
    preservedUnmanagedBindingsDigest: UNMANAGED,
    unmanagedBindingsAttestationDigest: UNMANAGED,
    storageCompatibilityRevision: value.storageCompatibilityRevision,
    versionMetadataBindings: 1,
    secretNames: [...value.requiredSecrets],
  };
}

function identity(value = candidate()) {
  return {
    schema: "acos-cloudflare-deployment-identity/v1",
    sourceRevision: value.sourceRevision,
    candidateDigest: value.candidateDigest,
    versionId: NEW_VERSION,
    versionTag: productionVersionTag(value.candidateDigest),
    versionTimestamp: TIMESTAMP,
  };
}

function createAdapters({
  authorityEvidence,
  uploadEvidence,
  baselineStorage = STORAGE,
  baselineReleaseManaged = true,
  baselineUnmanagedBindingsDigest = UNMANAGED,
  baselineUnmanagedBindingsAttestationDigest = baselineReleaseManaged
    ? baselineUnmanagedBindingsDigest
    : null,
  postUploadDrift = false,
  publicBody,
  privateBody,
  activationError,
  activationEvidence,
  rollbackError,
} = {}) {
  const value = candidate();
  const calls = [];
  let reads = 0;
  const initial = active(OLD_VERSION, baselineStorage, "deployment-old", {
    releaseManaged: baselineReleaseManaged,
    unmanagedBindingsDigest: baselineUnmanagedBindingsDigest,
    unmanagedBindingsAttestationDigest: baselineUnmanagedBindingsAttestationDigest,
  });
  const activated = active(NEW_VERSION, value.storageCompatibilityRevision, "deployment-new");
  const expectedIdentity = identity(value);
  return {
    calls,
    readProductionAuthority: async () => { calls.push("authority"); return authorityEvidence ?? authority(value); },
    readActiveDeployment: async () => {
      calls.push("baseline");
      reads += 1;
      return postUploadDrift && reads > 1 ? active(OLD_VERSION, baselineStorage, "deployment-drift") : initial;
    },
    findVersionsByTag: async () => { calls.push("unique-tag"); return []; },
    uploadInactive: async ({ flags, tag, unmanagedBindingsDigest }) => {
      assert.equal(unmanagedBindingsDigest, baselineUnmanagedBindingsDigest);
      calls.push(`upload:${flags.join(",")}:${tag}`);
      return uploadEvidence ?? version(value);
    },
    activateIfBaseline: async ({ expected, targetVersionId }) => {
      calls.push(`activate:${expected.versionId}:${targetVersionId}`);
      if (activationError) throw Object.assign(new Error("activation race"), { code: activationError });
      return activationEvidence ?? activated;
    },
    probePublicReadiness: async () => {
      calls.push("public-ready");
      return publicBody ?? {
        configured: true,
        auth: { configured: true },
        controlPlane: { configured: true },
        modelProviders: { configured: true },
        productionReady: true,
        deploymentIdentity: expectedIdentity,
      };
    },
    probePrivateAdmissionReadiness: async () => {
      calls.push("private-ready");
      return privateBody ?? {
        ok: true,
        contract: "commerce.acos-admission-provider/v3",
        receiptSchema: "acos-adapter-registration/v2",
        operations: ["register-fenced"],
        productionReady: true,
        deploymentIdentity: expectedIdentity,
      };
    },
    rollbackIfBaseline: async ({ expected, targetVersionId }) => {
      calls.push(`rollback:${expected.versionId}:${targetVersionId}`);
      if (rollbackError) return active(NEW_VERSION, STORAGE, "deployment-still-new");
      return active(OLD_VERSION, baselineStorage, "deployment-restored");
    },
  };
}

test("an exact first-attempt authority uploads inactive, CAS activates, and seals typed readiness evidence", async () => {
  const value = candidate();
  const adapters = createAdapters();
  const receipt = await executeAcosProductionRelease({ candidate: value, adapters, now: () => TIMESTAMP });
  assert.equal(receipt.schema, DEPLOYMENT_RECEIPT_SCHEMA);
  assert.equal(receipt.status, "deployed");
  assert.equal(receipt.versionId, NEW_VERSION);
  assert.equal(receipt.publicReadiness.deploymentIdentity.candidateDigest, value.candidateDigest);
  assert.equal(receipt.privateReadiness.contract, "commerce.acos-admission-provider/v3");
  assert.deepEqual(receipt.unmanagedBindingBaseline, {
    digest: UNMANAGED,
    authority: "predecessor-attested",
  });
  assert.equal(receipt.receiptDigest, digestValue(Object.fromEntries(
    Object.entries(receipt).filter(([key]) => key !== "receiptDigest"),
  )));
  assert.deepEqual(adapters.calls.slice(0, 4), [
    "authority", "baseline", "unique-tag",
    `upload:--strict,--keep-vars:${productionVersionTag(value.candidateDigest)}`,
  ]);
});

test("a bootstrap predecessor truthfully establishes the first unmanaged binding attestation", async () => {
  const adapters = createAdapters({ baselineReleaseManaged: false });
  const receipt = await executeAcosProductionRelease({ candidate: candidate(), adapters, now: () => TIMESTAMP });
  assert.equal(receipt.schema, DEPLOYMENT_RECEIPT_SCHEMA);
  assert.deepEqual(receipt.unmanagedBindingBaseline, {
    digest: UNMANAGED,
    authority: "bootstrap-established",
  });
});

test("steady-state unmanaged binding drift refuses before upload with zero Cloudflare mutation", async () => {
  const adapters = createAdapters({
    baselineUnmanagedBindingsDigest: "2".repeat(64),
    baselineUnmanagedBindingsAttestationDigest: UNMANAGED,
  });
  await assert.rejects(
    executeAcosProductionRelease({ candidate: candidate(), adapters }),
    (error) => error instanceof ProductionReleaseRefusal
      && error.code === "baseline_unmanaged_binding_drift",
  );
  assert.deepEqual(adapters.calls, ["authority", "baseline"]);
});

for (const [name, change] of [
  ["rerun attempt", { runAttempt: 2 }],
  ["wrong source", { headSha: "e".repeat(40) }],
  ["unprotected branch", { branchProtected: false }],
  ["wrong environment", { environment: "staging" }],
  ["bot reviewer", { reviewerLogin: "release[bot]" }],
  ["wrong job", { jobName: "seal-candidate" }],
]) {
  test(`production mutation is absent for ${name}`, async () => {
    const value = candidate();
    const adapters = createAdapters({ authorityEvidence: { ...authority(value), ...change } });
    await assert.rejects(
      executeAcosProductionRelease({ candidate: value, adapters }),
      (error) => error instanceof ProductionReleaseRefusal && error.code === "production_authority_invalid",
    );
    assert.deepEqual(adapters.calls, ["authority"]);
  });
}

for (const [name, mutate] of [
  ["UUID", (evidence) => { evidence.versionId = "wrong"; }],
  ["tag", (evidence) => { evidence.versionTag = `acos-prod-${"e".repeat(64)}`; }],
  ["source", (evidence) => { evidence.sourceRevision = "e".repeat(40); }],
  ["candidate", (evidence) => { evidence.candidateDigest = "e".repeat(64); }],
  ["timestamp", (evidence) => { evidence.versionTimestamp = "not-time"; }],
  ["secret preservation", (evidence) => { evidence.secretNames = ["AGENT_API_JWT_SECRET"]; }],
  ["version metadata binding", (evidence) => { evidence.versionMetadataBindings = 0; }],
  ["managed binding topology", (evidence) => { evidence.bindingTopologyDigest = "0".repeat(64); }],
  ["unmanaged baseline preservation", (evidence) => { evidence.preservedUnmanagedBindingsDigest = "2".repeat(64); }],
  ["unmanaged baseline attestation", (evidence) => { evidence.unmanagedBindingsAttestationDigest = "2".repeat(64); }],
]) {
  test(`inactive upload refuses ${name} readback drift before activation`, async () => {
    const value = candidate();
    const evidence = version(value);
    mutate(evidence);
    const adapters = createAdapters({ uploadEvidence: evidence });
    await assert.rejects(
      executeAcosProductionRelease({ candidate: value, adapters }),
      (error) => error.code === "uploaded_version_identity_invalid",
    );
    assert.equal(adapters.calls.some((entry) => entry.startsWith("activate:")), false);
  });
}

test("post-upload baseline drift refuses activation", async () => {
  const adapters = createAdapters({ postUploadDrift: true });
  await assert.rejects(
    executeAcosProductionRelease({ candidate: candidate(), adapters }),
    (error) => error.code === "active_baseline_drift",
  );
  assert.equal(adapters.calls.some((entry) => entry.startsWith("activate:")), false);
});

test("readiness failure rolls back only to an exact storage-compatible predecessor", async () => {
  const adapters = createAdapters({ publicBody: { productionReady: false } });
  const receipt = await executeAcosProductionRelease({ candidate: candidate(), adapters, now: () => TIMESTAMP });
  assert.equal(receipt.schema, ROLLBACK_RECEIPT_SCHEMA);
  assert.equal(receipt.status, "rolled-back");
  assert.equal(receipt.restoredVersionId, OLD_VERSION);
  assert.equal(adapters.calls.some((entry) => entry.startsWith("rollback:")), true);
});

test("identity alone cannot seal an otherwise unconfigured public runtime", async () => {
  const publicBody = {
    configured: false,
    auth: { configured: true },
    controlPlane: { configured: true },
    modelProviders: { configured: true },
    productionReady: true,
    deploymentIdentity: identity(),
  };
  const adapters = createAdapters({ publicBody });
  const receipt = await executeAcosProductionRelease({ candidate: candidate(), adapters, now: () => TIMESTAMP });
  assert.equal(receipt.schema, ROLLBACK_RECEIPT_SCHEMA);
  assert.equal(receipt.readinessFailureCode, "public_readiness_identity_mismatch");
});

test("an uncertain rollback always seals preserve-required forward recovery evidence", async () => {
  const adapters = createAdapters({ publicBody: { productionReady: false }, rollbackError: true });
  const receipt = await executeAcosProductionRelease({ candidate: candidate(), adapters, now: () => TIMESTAMP });
  assert.equal(receipt.schema, PRESERVE_RECEIPT_SCHEMA);
  assert.equal(receipt.readinessFailureCode, "rollback_compare_and_swap_unconfirmed");
  assert.equal(receipt.activeState, "observed");
  assert.equal(receipt.activeDeployment.versionId, NEW_VERSION);
  assert.equal(receipt.storageCompatibility.compatible, true);
});

test("storage drift or an uncertain CAS emits preserve-required forward recovery evidence", async () => {
  const unsafe = createAdapters({ baselineStorage: "e".repeat(64), publicBody: { productionReady: false } });
  const unsafeReceipt = await executeAcosProductionRelease({ candidate: candidate(), adapters: unsafe, now: () => TIMESTAMP });
  assert.equal(unsafeReceipt.schema, PRESERVE_RECEIPT_SCHEMA);
  assert.equal(unsafeReceipt.forwardRecoveryRequired, true);
  assert.equal(unsafeReceipt.storageCompatibility.compatible, false);
  assert.equal(unsafe.calls.some((entry) => entry.startsWith("rollback:")), false);

  const raced = createAdapters({ activationError: "active_baseline_compare_failed" });
  const racedReceipt = await executeAcosProductionRelease({ candidate: candidate(), adapters: raced, now: () => TIMESTAMP });
  assert.equal(racedReceipt.schema, PRESERVE_RECEIPT_SCHEMA);
  assert.equal(racedReceipt.readinessFailureCode, "active_baseline_compare_failed");
  assert.equal(racedReceipt.activeState, "unknown");
  assert.equal(racedReceipt.activeDeployment, null);
  assert.equal(racedReceipt.storageCompatibility.compatible, true);
});

test("a mismatched activation readback records only the actually observed deployment", async () => {
  const observed = active(OLD_VERSION, STORAGE, "deployment-observed-old");
  const adapters = createAdapters({ activationEvidence: observed });
  const receipt = await executeAcosProductionRelease({ candidate: candidate(), adapters, now: () => TIMESTAMP });
  assert.equal(receipt.schema, PRESERVE_RECEIPT_SCHEMA);
  assert.equal(receipt.activeState, "observed");
  assert.equal(receipt.activeDeployment.versionId, OLD_VERSION);
  assert.notEqual(receipt.activeDeployment.versionId, NEW_VERSION);
});
