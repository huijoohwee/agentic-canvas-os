import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTIVE_DEPLOYMENT_SCHEMA,
  DEPLOYMENT_RECEIPT_SCHEMA,
  PRESERVE_RECEIPT_SCHEMA,
  PRODUCTION_AUTHORITY_SCHEMA,
  VERSION_EVIDENCE_SCHEMA,
  createPreserveReceipt,
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
const BINDINGS = "e".repeat(64);
const WEB = "f".repeat(64);
const UNMANAGED = "1".repeat(64);
const OLD_VERSION = "06c0961f-5ca1-47c5-819a-b8a825d761d4";
const NEW_VERSION = "2c6dfa54-cf90-44dd-8642-78bfdd725f1f";
const TIMESTAMP = "2026-09-03T04:05:06.123Z";
const GRAPH = Object.freeze({
  authorityRef: "authority://agentic-graph/commerce-admission/production",
  operatorInstructionRef: "operator://agentic-graph/commerce-adapter-admission/production",
  issuerRevision: "9".repeat(40),
  evidenceDigest: "8".repeat(64),
});

function authorizedReleaseCandidate() {
  const unsigned = {
    schema: "agentic-production-release-candidate/v1",
    status: "awaiting-human-authorization",
    source: {
      repository: "huijoohwee/agentic-graph",
      revision: "2".repeat(40),
      tree: "3".repeat(40),
    },
    agenticCanvasOs: {
      repository: "huijoohwee/agentic-canvas-os",
      revision: SOURCE,
      tree: TREE,
    },
    catalogRevision: SOURCE,
    artifact: { algorithm: "sha256", digest: "4".repeat(64) },
    immutableManifest: { algorithm: "sha256", digest: "5".repeat(64) },
    localReviewCandidateDigest: "6".repeat(64),
  };
  return Object.freeze({ ...unsigned, candidateDigest: digestValue(unsigned) });
}

function candidate() {
  return createProductionCandidate({
    sourceRevision: SOURCE,
    sourceTree: TREE,
    configurationDigest: CONFIG,
    bindingTopologyDigest: BINDINGS,
    storageCompatibilityRevision: STORAGE,
    webArtifactDigest: WEB,
    requiredSecrets: [
      "ACOS_RELEASE_PROBE_TOKEN",
      "AGENTIC_OS_ADMISSION_AUTHORITY_HMAC_SECRET",
    ],
    releaseCandidate: authorizedReleaseCandidate(),
    graphAuthority: GRAPH,
    publicReadyOrigin: "https://airvio.co",
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
    jobStartedAt: "2026-09-03T04:00:00.000Z",
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

function active(versionId = OLD_VERSION, deploymentId = "deployment-old", unmanaged = UNMANAGED) {
  return {
    schema: ACTIVE_DEPLOYMENT_SCHEMA,
    deploymentId,
    versionId,
    percentage: 100,
    unmanagedBindingsDigest: unmanaged,
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
    graphAuthority: value.graphAuthority,
    bindingTopologyDigest: value.bindingTopologyDigest,
    baselineUnmanagedBindingsDigest: UNMANAGED,
    preservedUnmanagedBindingsDigest: UNMANAGED,
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

function readiness(value = candidate()) {
  return {
    ok: true,
    contract: "commerce.agentic-os-admission-provider/v3",
    receiptSchema: "agentic-os-adapter-registration/v2",
    operations: ["register-fenced"],
    productionReady: true,
    deploymentIdentity: identity(value),
    authority: {
      schema: "agentic-graph-commerce-admission-authority-projection/v1",
      authority_ref: value.graphAuthority.authorityRef,
      admission_inputs_digest: "a".repeat(64),
      admission_request_digest: "b".repeat(64),
      evidence_digest: value.graphAuthority.evidenceDigest,
      issuer_repository: "huijoohwee/agentic-graph",
      issuer_revision: value.graphAuthority.issuerRevision,
      permit_digest: "c".repeat(64),
      expires_at_ms: 1_800_000_000_000,
    },
  };
}

function createAdapters({
  authorityEvidence,
  versionEvidence,
  existing = [],
  baseline = active(),
  postVersion,
  uploadError,
  activationError,
  activationEvidence,
  readinessEvidence,
  finalActive,
  recoveryReceipt = null,
} = {}) {
  const value = candidate();
  const calls = [];
  let activeReads = 0;
  const activated = active(NEW_VERSION, "deployment-new");
  return {
    calls,
    readProductionAuthority: async () => {
      calls.push("authority");
      return authorityEvidence ?? authority(value);
    },
    readActiveDeployment: async () => {
      calls.push("active");
      activeReads += 1;
      if (activeReads === 1) return baseline;
      if (activeReads === 2) return postVersion ?? baseline;
      return finalActive ?? (baseline.versionId === NEW_VERSION ? baseline : activated);
    },
    findVersionsByTag: async () => {
      calls.push("find-tag");
      return existing;
    },
    readForwardRecoveryReceipt: async () => {
      calls.push("recovery-receipt");
      return recoveryReceipt;
    },
    readVersionById: async ({ versionId, unmanagedBindingsDigest }) => {
      calls.push(`reuse:${versionId}`);
      assert.equal(unmanagedBindingsDigest, baseline.unmanagedBindingsDigest);
      return versionEvidence ?? version(value);
    },
    uploadInactive: async ({ flags, tag, unmanagedBindingsDigest }) => {
      calls.push(`upload:${flags.join(",")}:${tag}`);
      assert.equal(unmanagedBindingsDigest, baseline.unmanagedBindingsDigest);
      if (uploadError) throw new Error(uploadError);
      return versionEvidence ?? version(value);
    },
    activateExact: async ({ expected, targetVersionId }) => {
      calls.push(`activate:${expected.versionId}:${targetVersionId}`);
      if (activationError) throw Object.assign(new Error("activation uncertain"), { code: activationError });
      return activationEvidence ?? activated;
    },
    probeProductionReadiness: async () => {
      calls.push("readyz");
      return readinessEvidence ?? readiness(value);
    },
  };
}

test("exact authority uploads inactive, activates exact version, and seals joined receipt", async () => {
  const value = candidate();
  const adapters = createAdapters();
  const receipt = await executeAcosProductionRelease({
    candidate: value,
    adapters,
    now: () => TIMESTAMP,
  });
  assert.equal(receipt.schema, DEPLOYMENT_RECEIPT_SCHEMA);
  assert.equal(receipt.status, "deployed");
  assert.equal(receipt.candidateDigest, value.candidateDigest);
  assert.equal(receipt.authorizedReleaseCandidateDigest, value.releaseCandidate.candidateDigest);
  assert.equal(receipt.artifactDigest, value.releaseCandidate.artifact.digest);
  assert.equal(receipt.immutableManifestDigest, value.releaseCandidate.immutableManifest.digest);
  assert.equal(receipt.webArtifactDigest, WEB);
  assert.equal(receipt.runtimeReadiness.authority.evidence_digest, GRAPH.evidenceDigest);
  assert.equal(receipt.receiptDigest, digestValue(Object.fromEntries(
    Object.entries(receipt).filter(([key]) => key !== "receiptDigest"),
  )));
  assert.deepEqual(adapters.calls.slice(0, 5), [
    "authority",
    "active",
    "find-tag",
    "recovery-receipt",
    `upload:--strict,--keep-vars:${productionVersionTag(value.candidateDigest)}`,
  ]);
});

test("a fresh approved dispatch reuses an exact tagged active version for forward recovery", async () => {
  const value = candidate();
  const preserved = createPreserveReceipt({
    candidate: value,
    baseline: active(),
    observedActive: active(NEW_VERSION, "deployment-existing"),
    failure: "production_readiness_probe_failed",
    versionId: NEW_VERSION,
    completedAt: TIMESTAMP,
  });
  const adapters = createAdapters({
    existing: [NEW_VERSION],
    baseline: active(NEW_VERSION, "deployment-existing"),
    recoveryReceipt: preserved,
  });
  const receipt = await executeAcosProductionRelease({
    candidate: candidate(),
    adapters,
    now: () => TIMESTAMP,
  });
  assert.equal(receipt.status, "deployed");
  assert.equal(receipt.recoveryReceiptDigest, preserved.receiptDigest);
  assert.equal(receipt.predecessorVersionId, OLD_VERSION);
  assert.equal(adapters.calls.includes(`reuse:${NEW_VERSION}`), true);
  assert.equal(adapters.calls.some((call) => call.startsWith("upload:")), false);
  assert.equal(adapters.calls.some((call) => call.startsWith("activate:")), false);
});

test("an existing tag without its exact preserve receipt cannot be reused", async () => {
  const adapters = createAdapters({ existing: [NEW_VERSION] });
  await assert.rejects(
    executeAcosProductionRelease({ candidate: candidate(), adapters }),
    (error) => error.code === "forward_recovery_receipt_invalid",
  );
  assert.equal(adapters.calls.some((call) => call.startsWith("reuse:")), false);
});

test("an unconfirmed upload seals a consumable artifact before a fresh approved recovery", async () => {
  const firstAdapters = createAdapters({ uploadError: "transport ended after request" });
  const preserved = await executeAcosProductionRelease({
    candidate: candidate(),
    adapters: firstAdapters,
    now: () => TIMESTAMP,
  });
  assert.equal(preserved.schema, PRESERVE_RECEIPT_SCHEMA);
  assert.equal(preserved.failure, "upload_unconfirmed");
  assert.equal(preserved.candidateVersionId, null);
  assert.equal(firstAdapters.calls.some((call) => call.startsWith("activate:")), false);

  const recoveryAdapters = createAdapters({ recoveryReceipt: preserved });
  const deployed = await executeAcosProductionRelease({
    candidate: candidate(),
    adapters: recoveryAdapters,
    now: () => TIMESTAMP,
  });
  assert.equal(deployed.status, "deployed");
  assert.equal(deployed.recoveryReceiptDigest, preserved.receiptDigest);
  assert.equal(deployed.predecessorVersionId, OLD_VERSION);
  assert.equal(recoveryAdapters.calls.some((call) => call.startsWith("upload:")), true);
});

for (const [name, change] of [
  ["rerun attempt", { runAttempt: 2 }],
  ["wrong source", { headSha: "7".repeat(40) }],
  ["unprotected branch", { branchProtected: false }],
  ["wrong environment", { environment: "staging" }],
  ["wrong workflow", { workflowPath: ".github/workflows/ci.yml" }],
  ["bot reviewer", { reviewerLogin: "release[bot]" }],
]) {
  test(`production mutation is absent for ${name}`, async () => {
    const value = candidate();
    const adapters = createAdapters({ authorityEvidence: { ...authority(value), ...change } });
    await assert.rejects(
      executeAcosProductionRelease({ candidate: value, adapters }),
      (error) => error instanceof ProductionReleaseRefusal
        && error.code === "production_authority_invalid",
    );
    assert.deepEqual(adapters.calls, ["authority"]);
  });
}

test("parallel artifact or manifest authority cannot be substituted", async () => {
  const value = structuredClone(candidate());
  value.releaseCandidate.artifact.digest = "0".repeat(64);
  value.candidateDigest = digestValue(Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "candidateDigest"),
  ));
  const adapters = createAdapters();
  await assert.rejects(
    executeAcosProductionRelease({ candidate: value, adapters }),
    (error) => error.code === "candidate_invalid",
  );
  assert.deepEqual(adapters.calls, []);
});

for (const [name, mutate] of [
  ["tag", (evidence) => { evidence.versionTag = `acos-prod-${"0".repeat(64)}`; }],
  ["source", (evidence) => { evidence.sourceRevision = "0".repeat(40); }],
  ["candidate", (evidence) => { evidence.candidateDigest = "0".repeat(64); }],
  ["Graph authority", (evidence) => { evidence.graphAuthority.evidenceDigest = "0".repeat(64); }],
  ["binding topology", (evidence) => { evidence.bindingTopologyDigest = "0".repeat(64); }],
  ["unmanaged bindings", (evidence) => { evidence.preservedUnmanagedBindingsDigest = "0".repeat(64); }],
  ["secret preservation", (evidence) => { evidence.secretNames = ["ACOS_RELEASE_PROBE_TOKEN"]; }],
]) {
  test(`version readback preserves ${name} drift before activation`, async () => {
    const evidence = structuredClone(version());
    mutate(evidence);
    const adapters = createAdapters({ versionEvidence: evidence });
    const receipt = await executeAcosProductionRelease({ candidate: candidate(), adapters });
    assert.equal(receipt.schema, PRESERVE_RECEIPT_SCHEMA);
    assert.equal(receipt.failure, "candidate_version_identity_invalid");
    assert.equal(adapters.calls.some((call) => call.startsWith("activate:")), false);
  });
}

test("post-upload active drift preserves the inactive version without activation", async () => {
  const adapters = createAdapters({
    postVersion: active(OLD_VERSION, "deployment-drifted"),
  });
  const receipt = await executeAcosProductionRelease({ candidate: candidate(), adapters });
  assert.equal(receipt.schema, PRESERVE_RECEIPT_SCHEMA);
  assert.equal(receipt.failure, "active_baseline_drift");
  assert.equal(receipt.candidateVersionId, NEW_VERSION);
  assert.equal(adapters.calls.some((call) => call.startsWith("activate:")), false);
});

test("activation uncertainty preserves observed state for exact-version forward recovery", async () => {
  const adapters = createAdapters({ activationError: "activation_unconfirmed" });
  const receipt = await executeAcosProductionRelease({
    candidate: candidate(),
    adapters,
    now: () => TIMESTAMP,
  });
  assert.equal(receipt.schema, PRESERVE_RECEIPT_SCHEMA);
  assert.equal(receipt.status, "preserve-required");
  assert.equal(receipt.failure, "activation_unconfirmed");
  assert.equal(receipt.forwardRecovery.mode, "reuse-exact-candidate-version");
  assert.equal(receipt.candidateVersionId, NEW_VERSION);
});

test("readyz identity or Graph mismatch preserves the new version and never rolls back", async () => {
  const drifted = readiness();
  drifted.authority = { ...drifted.authority, evidence_digest: "0".repeat(64) };
  const adapters = createAdapters({ readinessEvidence: drifted });
  const receipt = await executeAcosProductionRelease({
    candidate: candidate(),
    adapters,
    now: () => TIMESTAMP,
  });
  assert.equal(receipt.schema, PRESERVE_RECEIPT_SCHEMA);
  assert.equal(receipt.failure, "production_readiness_identity_mismatch");
  assert.equal(receipt.activeDeployment.versionId, NEW_VERSION);
  assert.equal("rollbackIfBaseline" in adapters, false);
});

test("post-readyz active drift emits preserve-required instead of a false deployment receipt", async () => {
  const adapters = createAdapters({
    finalActive: active(OLD_VERSION, "deployment-after-readyz"),
  });
  const receipt = await executeAcosProductionRelease({
    candidate: candidate(),
    adapters,
    now: () => TIMESTAMP,
  });
  assert.equal(receipt.schema, PRESERVE_RECEIPT_SCHEMA);
  assert.equal(receipt.failure, "post_readiness_active_drift");
  assert.equal(receipt.activeDeployment.versionId, OLD_VERSION);
});
