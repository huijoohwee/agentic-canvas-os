import {
  createDeploymentReceipt,
  createPreserveReceipt,
  createRollbackReceipt,
  deploymentIdentityFromVersion,
  exactDeployment,
  productionVersionTag,
  readActiveDeployment,
  readProductionAuthority,
  readProductionCandidate,
  readVersionEvidence,
} from "./acos-production-release-contract.mjs";

export const REQUIRED_UPLOAD_FLAGS = Object.freeze(["--strict", "--keep-vars"]);

export class ProductionReleaseRefusal extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ProductionReleaseRefusal";
    this.code = code;
  }
}

function refuse(code, message) {
  throw new ProductionReleaseRefusal(code, message);
}

function exactIdentity(actual, expected) {
  return actual?.schema === expected.schema
    && actual?.sourceRevision === expected.sourceRevision
    && actual?.candidateDigest === expected.candidateDigest
    && actual?.versionId === expected.versionId
    && actual?.versionTag === expected.versionTag
    && actual?.versionTimestamp === expected.versionTimestamp;
}

function validatePublicReadiness(body, identity) {
  if (!body || typeof body !== "object" || Array.isArray(body)
    || body.configured !== true
    || body.auth?.configured !== true
    || body.controlPlane?.configured !== true
    || body.modelProviders?.configured !== true
    || body.productionReady !== true
    || !exactIdentity(body.deploymentIdentity, identity)) {
    refuse("public_readiness_identity_mismatch", "Public readiness did not attest the activated deployment identity.");
  }
  return Object.freeze({
    configured: true,
    authConfigured: true,
    controlPlaneConfigured: true,
    modelProvidersConfigured: true,
    productionReady: true,
    deploymentIdentity: identity,
  });
}

function validatePrivateReadiness(body, identity) {
  const expectedKeys = [
    "contract", "deploymentIdentity", "ok", "operations", "productionReady", "receiptSchema",
  ];
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).sort().join("|") !== expectedKeys.sort().join("|")
    || body.ok !== true
    || body.contract !== "commerce.acos-admission-provider/v3"
    || body.receiptSchema !== "acos-adapter-registration/v2"
    || body.productionReady !== true
    || !Array.isArray(body.operations)
    || body.operations.length !== 1
    || body.operations[0] !== "register-fenced"
    || !exactIdentity(body.deploymentIdentity, identity)) {
    refuse("private_admission_readiness_mismatch", "Private service-bound admission readiness drifted.");
  }
  return Object.freeze({
    contract: body.contract,
    receiptSchema: body.receiptSchema,
    productionReady: true,
    deploymentIdentity: identity,
  });
}

function requireAdapters(adapters) {
  for (const name of [
    "readProductionAuthority", "readActiveDeployment", "findVersionsByTag", "uploadInactive",
    "activateIfBaseline", "probePublicReadiness", "probePrivateAdmissionReadiness", "rollbackIfBaseline",
  ]) {
    if (typeof adapters?.[name] !== "function") refuse("release_adapter_missing", `Release adapter is missing ${name}.`);
  }
}

export async function executeAcosProductionRelease({ candidate: rawCandidate, adapters, now = () => new Date().toISOString() }) {
  const candidate = readProductionCandidate(rawCandidate);
  if (!candidate) refuse("candidate_invalid", "The production candidate is malformed or no longer digest-exact.");
  requireAdapters(adapters);

  const authority = readProductionAuthority(await adapters.readProductionAuthority(candidate), candidate);
  if (!authority) refuse("production_authority_invalid", "Authenticated first-attempt production authorization is absent or drifted.");
  const baseline = readActiveDeployment(await adapters.readActiveDeployment());
  if (!baseline) refuse("active_baseline_invalid", "The active Cloudflare baseline is not one exact 100% version.");
  if (baseline.releaseManaged
    && baseline.unmanagedBindingsAttestationDigest !== baseline.unmanagedBindingsDigest) {
    refuse(
      "baseline_unmanaged_binding_drift",
      "The active Cloudflare bindings differ from the predecessor-attested unmanaged baseline.",
    );
  }

  const tag = productionVersionTag(candidate.candidateDigest);
  const existing = await adapters.findVersionsByTag(tag);
  if (!Array.isArray(existing) || existing.length !== 0) {
    refuse("candidate_version_not_unique", "A Cloudflare version already owns the candidate tag.");
  }

  const version = readVersionEvidence(await adapters.uploadInactive({
    candidate,
    tag,
    flags: REQUIRED_UPLOAD_FLAGS,
    unmanagedBindingsDigest: baseline.unmanagedBindingsDigest,
  }), candidate);
  if (!version || version.versionId === baseline.versionId) {
    refuse("uploaded_version_identity_invalid", "Inactive upload readback did not match the candidate exactly.");
  }
  const postUploadBaseline = readActiveDeployment(await adapters.readActiveDeployment());
  if (!postUploadBaseline || !exactDeployment(baseline, postUploadBaseline)) {
    refuse("active_baseline_drift", "The active baseline changed after inactive upload.");
  }

  let activated;
  try {
    activated = readActiveDeployment(await adapters.activateIfBaseline({
      expected: postUploadBaseline,
      targetVersionId: version.versionId,
    }));
  } catch (error) {
    return createPreserveReceipt({
      candidate,
      baseline,
      observedActive: null,
      failure: error?.code ?? "activation_unconfirmed",
      completedAt: now(),
    });
  }
  if (!activated || activated.versionId !== version.versionId) {
    return createPreserveReceipt({
      candidate,
      baseline,
      observedActive: activated,
      failure: "activation_compare_and_swap_unconfirmed",
      completedAt: now(),
    });
  }

  const identity = deploymentIdentityFromVersion(version);
  try {
    const publicReadiness = validatePublicReadiness(
      await adapters.probePublicReadiness(identity),
      identity,
    );
    const privateReadiness = validatePrivateReadiness(
      await adapters.probePrivateAdmissionReadiness(identity),
      identity,
    );
    return createDeploymentReceipt({
      candidate,
      authority,
      baseline,
      version,
      publicReadiness,
      privateReadiness,
      completedAt: now(),
    });
  } catch (error) {
    const failure = error?.code ?? "readiness_probe_failed";
    if (baseline.storageCompatibilityRevision !== candidate.storageCompatibilityRevision) {
      return createPreserveReceipt({ candidate, baseline, observedActive: activated, failure, completedAt: now() });
    }
    let rolledBack;
    try {
      rolledBack = readActiveDeployment(await adapters.rollbackIfBaseline({
        expected: activated,
        targetVersionId: baseline.versionId,
      }));
    } catch {
      rolledBack = null;
    }
    if (!rolledBack || rolledBack.versionId !== baseline.versionId) {
      return createPreserveReceipt({
        candidate,
        baseline,
        observedActive: rolledBack,
        failure: "rollback_compare_and_swap_unconfirmed",
        completedAt: now(),
      });
    }
    return createRollbackReceipt({ candidate, baseline, version, failure, completedAt: now() });
  }
}
