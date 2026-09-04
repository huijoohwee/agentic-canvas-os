export const COMMERCE_DEPLOYMENT_IDENTITY_SCHEMA = "acos-cloudflare-deployment-identity/v1";
export const ACOS_PRODUCTION_VERSION_TAG_PREFIX = "acos-prod-";

const IDENTITY_KEYS = Object.freeze([
  "candidateDigest",
  "schema",
  "sourceRevision",
  "versionId",
  "versionTag",
  "versionTimestamp",
]);
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u;

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

function validTimestamp(value) {
  return typeof value === "string" && UTC_TIMESTAMP_PATTERN.test(value) && Number.isFinite(Date.parse(value));
}

export function productionVersionTag(candidateDigest) {
  if (!DIGEST_PATTERN.test(candidateDigest ?? "")) return null;
  return `${ACOS_PRODUCTION_VERSION_TAG_PREFIX}${candidateDigest}`;
}

export function readCommerceDeploymentIdentity(value) {
  if (!exactKeys(value, IDENTITY_KEYS) || value.schema !== COMMERCE_DEPLOYMENT_IDENTITY_SCHEMA) return null;
  if (!SHA_PATTERN.test(value.sourceRevision ?? "")
    || !DIGEST_PATTERN.test(value.candidateDigest ?? "")
    || !UUID_PATTERN.test(value.versionId ?? "")
    || value.versionTag !== productionVersionTag(value.candidateDigest)
    || !validTimestamp(value.versionTimestamp)) return null;
  return Object.freeze({ ...value });
}

export function resolveCommerceDeploymentIdentity(env = {}) {
  return readCommerceDeploymentIdentity({
    schema: COMMERCE_DEPLOYMENT_IDENTITY_SCHEMA,
    sourceRevision: env?.ACOS_SOURCE_REVISION,
    candidateDigest: env?.ACOS_CANDIDATE_DIGEST,
    versionId: env?.CF_VERSION_METADATA?.id,
    versionTag: env?.CF_VERSION_METADATA?.tag,
    versionTimestamp: env?.CF_VERSION_METADATA?.timestamp,
  });
}
