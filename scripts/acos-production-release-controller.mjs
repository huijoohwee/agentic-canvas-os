import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readCommerceReleaseProofEnvelope } from "../agent-api/src/commerce-release-proof.js";
import {
  createDeploymentReceipt,
  createPreserveReceipt,
  deploymentIdentityFromVersion,
  exactDeployment,
  productionVersionTag,
  readActiveDeployment,
  readProductionAuthority,
  readProductionCandidate,
  readPreserveReceipt,
  readVersionEvidence,
} from "./acos-production-release-contract.mjs";

export const REQUIRED_UPLOAD_FLAGS = Object.freeze(["--strict", "--keep-vars"]);
const MAXIMUM_INPUT_BYTES = 256 * 1024;
const VERSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

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

function validateRuntimeReadiness(body, identity, candidate) {
  const evidence = readCommerceReleaseProofEnvelope(body);
  if (!evidence
    || !exactIdentity(evidence.deploymentIdentity, identity)
    || evidence.authority.authority_ref !== candidate.graphAuthority.authorityRef
    || evidence.authority.evidence_digest !== candidate.graphAuthority.evidenceDigest
    || evidence.authority.issuer_revision !== candidate.graphAuthority.issuerRevision) {
    refuse(
      "production_readiness_identity_mismatch",
      "Authenticated readyz did not attest the exact deployment and Graph authority.",
    );
  }
  return evidence;
}

function requireAdapters(adapters) {
  for (const name of [
    "readProductionAuthority",
    "readActiveDeployment",
    "findVersionsByTag",
    "readForwardRecoveryReceipt",
    "readVersionById",
    "uploadInactive",
    "activateExact",
    "probeProductionReadiness",
  ]) {
    if (typeof adapters?.[name] !== "function") {
      refuse("release_adapter_missing", `Release adapter is missing ${name}.`);
    }
  }
}

async function observedActive(adapters) {
  try { return readActiveDeployment(await adapters.readActiveDeployment()); } catch { return null; }
}

export async function executeAcosProductionRelease({
  candidate: rawCandidate,
  adapters,
  now = () => new Date().toISOString(),
}) {
  const candidate = readProductionCandidate(rawCandidate);
  if (!candidate) refuse("candidate_invalid", "The production candidate is malformed or digest-drifted.");
  requireAdapters(adapters);

  const authority = readProductionAuthority(await adapters.readProductionAuthority(candidate), candidate);
  if (!authority) {
    refuse("production_authority_invalid", "Authenticated first-attempt production authorization is absent or drifted.");
  }
  const baseline = readActiveDeployment(await adapters.readActiveDeployment());
  if (!baseline) refuse("active_baseline_invalid", "The active Cloudflare baseline is not one exact 100% version.");

  const tag = productionVersionTag(candidate.candidateDigest);
  const existing = await adapters.findVersionsByTag(tag);
  if (!Array.isArray(existing) || existing.length > 1) {
    refuse("candidate_version_not_unique", "The candidate tag is ambiguous.");
  }
  const rawRecoveryReceipt = await adapters.readForwardRecoveryReceipt(candidate);
  const recoveryReceipt = rawRecoveryReceipt === null
    ? null
    : readPreserveReceipt(rawRecoveryReceipt, candidate);
  const unknownUploadRecovery = recoveryReceipt?.candidateVersionId === null;
  if ((existing.length === 0 && rawRecoveryReceipt !== null && !unknownUploadRecovery)
    || (existing.length === 1 && (!recoveryReceipt
      || (recoveryReceipt.candidateVersionId !== null
        && recoveryReceipt.candidateVersionId !== existing[0])))) {
    refuse(
      "forward_recovery_receipt_invalid",
      "Tagged-version recovery requires its exact preserve-required receipt.",
    );
  }
  let rawVersion;
  if (existing.length === 1) {
    rawVersion = await adapters.readVersionById({
      candidate,
      versionId: existing[0],
      unmanagedBindingsDigest: baseline.unmanagedBindingsDigest,
    });
  } else {
    try {
      rawVersion = await adapters.uploadInactive({
        candidate,
        tag,
        flags: REQUIRED_UPLOAD_FLAGS,
        unmanagedBindingsDigest: baseline.unmanagedBindingsDigest,
      });
    } catch {
      return createPreserveReceipt({
        candidate,
        baseline,
        observedActive: await observedActive(adapters),
        failure: "upload_unconfirmed",
        completedAt: now(),
      });
    }
  }
  const version = readVersionEvidence(rawVersion, candidate);
  if (!version) {
    return createPreserveReceipt({
      candidate,
      baseline,
      observedActive: await observedActive(adapters),
      failure: "candidate_version_identity_invalid",
      versionId: VERSION_ID_PATTERN.test(rawVersion?.versionId ?? "") ? rawVersion.versionId : null,
      completedAt: now(),
    });
  }

  const postVersionBaseline = await observedActive(adapters);
  if (!postVersionBaseline || !exactDeployment(baseline, postVersionBaseline)) {
    return createPreserveReceipt({
      candidate,
      baseline,
      observedActive: postVersionBaseline,
      failure: "active_baseline_drift",
      versionId: version.versionId,
      completedAt: now(),
    });
  }

  let active = postVersionBaseline;
  if (active.versionId !== version.versionId) {
    try {
      active = readActiveDeployment(await adapters.activateExact({
        expected: postVersionBaseline,
        targetVersionId: version.versionId,
      }));
    } catch (error) {
      return createPreserveReceipt({
        candidate,
        baseline,
        observedActive: await observedActive(adapters),
        failure: error?.code ?? "activation_unconfirmed",
        versionId: version.versionId,
        completedAt: now(),
      });
    }
    if (!active || active.versionId !== version.versionId
      || active.unmanagedBindingsDigest !== baseline.unmanagedBindingsDigest) {
      return createPreserveReceipt({
        candidate,
        baseline,
        observedActive: active,
        failure: "activation_readback_mismatch",
        versionId: version.versionId,
        completedAt: now(),
      });
    }
  }

  const identity = deploymentIdentityFromVersion(version);
  let runtimeReadiness;
  try {
    runtimeReadiness = validateRuntimeReadiness(
      await adapters.probeProductionReadiness(candidate),
      identity,
      candidate,
    );
  } catch (error) {
    return createPreserveReceipt({
      candidate,
      baseline,
      observedActive: await observedActive(adapters),
      failure: error?.code ?? "production_readiness_probe_failed",
      versionId: version.versionId,
      completedAt: now(),
    });
  }

  const finalActive = await observedActive(adapters);
  if (!finalActive || !exactDeployment(active, finalActive)
    || finalActive.versionId !== version.versionId) {
    return createPreserveReceipt({
      candidate,
      baseline,
      observedActive: finalActive,
      failure: "post_readiness_active_drift",
      versionId: version.versionId,
      completedAt: now(),
    });
  }
  return createDeploymentReceipt({
    candidate,
    authority,
    baseline,
    active: finalActive,
    version,
    runtimeReadiness,
    recoveryReceipt,
    completedAt: now(),
  });
}

function argumentValue(argv, flag) {
  const indexes = argv.flatMap((value, index) => (value === flag ? [index] : []));
  if (indexes.length !== 1 || indexes[0] === argv.length - 1) {
    throw new ProductionReleaseRefusal("arguments_invalid", `${flag} must appear exactly once.`);
  }
  return argv[indexes[0] + 1];
}

async function readBoundedJson(file, label) {
  const text = await readFile(file, "utf8");
  if (Buffer.byteLength(text) > MAXIMUM_INPUT_BYTES) {
    throw new ProductionReleaseRefusal("input_oversized", `${label} exceeds the bounded input limit.`);
  }
  try { return JSON.parse(text); } catch {
    throw new ProductionReleaseRefusal("input_invalid", `${label} is not JSON.`);
  }
}

async function writeExclusive(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}

export async function runProductionReleaseCli(argv, {
  repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  env = process.env,
} = {}) {
  const command = argv[0];
  const live = await import("./acos-production-release-live.mjs");
  if (command === "prepare" && argv.length === 3) {
    const output = argumentValue(argv, "--output");
    const candidate = await live.createCandidateFromProtectedMain({ repositoryRoot, env });
    await writeExclusive(output, candidate);
    return 0;
  }
  if (command === "release" && argv.length === 5) {
    const candidatePath = argumentValue(argv, "--candidate");
    const receiptPath = argumentValue(argv, "--receipt");
    const candidate = await readBoundedJson(candidatePath, "production candidate");
    const receipt = await executeAcosProductionRelease({
      candidate,
      adapters: live.createLiveReleaseAdapters({ repositoryRoot, env }),
    });
    await writeExclusive(receiptPath, receipt);
    return receipt.status === "deployed" ? 0 : 2;
  }
  throw new ProductionReleaseRefusal(
    "arguments_invalid",
    "Usage: prepare --output <path> | release --candidate <path> --receipt <path>.",
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await runProductionReleaseCli(process.argv.slice(2));
  } catch (error) {
    console.error(`production release refused: ${error?.code ?? "release_failed"}`);
    process.exitCode = 1;
  }
}
