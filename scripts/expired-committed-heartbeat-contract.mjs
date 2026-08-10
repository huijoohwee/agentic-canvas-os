import {
  digestValue,
  normalizeWriteSet,
} from "./cloud-collaboration-primitives.mjs";

export const GITHUB_PULL_REQUEST_BODY_MAX_BYTES = 65_536;

export function assertPullRequestBodyWithinGitHubLimit(body) {
  const byteLength = Buffer.byteLength(String(body || ""), "utf8");
  if (byteLength > GITHUB_PULL_REQUEST_BODY_MAX_BYTES) {
    throw new Error(
      `Expired committed recovery pull-request body requires ${byteLength} bytes and exceeds the ${GITHUB_PULL_REQUEST_BODY_MAX_BYTES}-byte GitHub limit before local CAS.`,
    );
  }
  return byteLength;
}

export function reconcileHeartbeatManifestProjection({
  renewed,
  admittedManifestDigest,
}) {
  if (renewed?.manifestDigest === admittedManifestDigest) return renewed;
  const transportManifestDigest = digestValue({
    declaredWriteSet: renewed?.cloudDeclaredWriteScope,
    writeSetDigest: renewed?.writeSetDigest,
  });
  if (renewed?.manifestDigest !== transportManifestDigest) return renewed;
  return Object.freeze({
    ...renewed,
    manifestDigest: admittedManifestDigest,
  });
}

export function requireCloudAdmission({
  lease,
  instant,
  requireLive = true,
}) {
  const authority = reconcileHeartbeatManifestProjection({
    renewed: lease.cloudAuthority,
    admittedManifestDigest: lease.admission?.manifestDigest,
  });
  const declaredWriteSet = normalizeWriteSet(
    lease.admission?.declaredWriteSet || [],
  );
  const cloudExpiry = Date.parse(authority?.expiresAt);
  if (authority?.manifestDigest !== lease.admission?.manifestDigest) {
    throw new Error(
      "Expired committed recovery source cloud manifest differs from its admitted manifest.",
    );
  }
  if (
    lease.admission?.schema !== "agentic-lane-admission-lease/v1" ||
    lease.admission.status !== "admitted" ||
    authority?.schema !== "agentic-lane-cloud-authority/v1" ||
    authority.state !== "active" ||
    authority.deviceId !== lease.device ||
    authority.sessionId !== lease.sessionId ||
    authority.canonicalBaseSha !== lease.baseSha ||
    authority.laneRevision !== lease.fenceSha ||
    authority.writeSetDigest !== lease.admission.writeSetDigest ||
    !Number.isFinite(cloudExpiry) ||
    (requireLive && cloudExpiry <= instant.getTime()) ||
    digestValue(declaredWriteSet) !== lease.admission.writeSetDigest ||
    JSON.stringify(authority.cloudDeclaredWriteScope) !==
      JSON.stringify(declaredWriteSet)
  ) {
    throw new Error(
      `Expired committed recovery requires its exact ${requireLive ? "live " : ""}admitted cloud claim.`,
    );
  }
}

export function assertSameCloudSubject({ source, renewed, lease, now }) {
  const admittedManifestDigest = lease.admission?.manifestDigest;
  const normalizedSource = reconcileHeartbeatManifestProjection({
    renewed: source,
    admittedManifestDigest,
  });
  const normalizedRenewed = reconcileHeartbeatManifestProjection({
    renewed,
    admittedManifestDigest,
  });
  const immutableFields = [
    "schema",
    "provider",
    "ledgerRepository",
    "targetRepository",
    "claimId",
    "canonicalBaseSha",
    "laneRevision",
    "writeSetDigest",
    "deviceId",
    "sessionId",
    "reviewRequestId",
    "leaseEpoch",
    "state",
    "manifestDigest",
  ];
  if (
    !normalizedRenewed ||
    immutableFields.some(
      field => normalizedRenewed[field] !== normalizedSource?.[field],
    ) ||
    JSON.stringify(normalizedRenewed.cloudDeclaredWriteScope) !==
      JSON.stringify(normalizedSource.cloudDeclaredWriteScope) ||
    normalizedRenewed.state !== "active" ||
    normalizedRenewed.laneRevision !== lease.fenceSha ||
    normalizedRenewed.transitionCounter !== source.transitionCounter + 1 ||
    Date.parse(normalizedRenewed.expiresAt) <= now.getTime()
  ) {
    throw new Error("Cloud heartbeat changed the expired lease claim subject.");
  }
}
