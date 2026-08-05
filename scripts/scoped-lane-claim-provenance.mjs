const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

export const CURRENT_CLAIM_ENTRY_SCHEMA = "agentic-cloud-collaboration-entry/v2";
export const HISTORICAL_CLAIM_ENTRY_SCHEMA = "agentic-cloud-collaboration-entry/v1";

export function normalizeClaimProvenance(source, label = "claim") {
  const entrySchema = requiredEntrySchema(source?.entrySchema, `${label} entrySchema`);
  const claimIdentitySchema = requiredIdentitySchema(
    source?.claimIdentitySchema,
    entrySchema,
    `${label} claimIdentitySchema`,
  );
  const operationReceiptDigest = source?.operationReceiptDigest
    ? requiredDigest(source.operationReceiptDigest, `${label} operationReceiptDigest`)
    : null;
  if (entrySchema === CURRENT_CLAIM_ENTRY_SCHEMA && !operationReceiptDigest) {
    throw new Error(`${label} current entry requires an operation receipt digest.`);
  }
  return Object.freeze({
    entrySchema,
    claimIdentitySchema,
    operationReceiptDigest,
    mutationAuthorityEligible: entrySchema === CURRENT_CLAIM_ENTRY_SCHEMA,
  });
}

export function claimProvenanceMatches(
  remoteClaim,
  localAuthority,
  { requireCurrentEntry = true } = {},
) {
  try {
    const remote = normalizeClaimProvenance(remoteClaim, "remote claim");
    const local = normalizeClaimProvenance(localAuthority, "local authority");
    return (!requireCurrentEntry
        || (remote.mutationAuthorityEligible && local.mutationAuthorityEligible))
      && requiredDigest(remoteClaim?.claimId, "remote claimId")
        === requiredDigest(localAuthority?.claimId, "local claimId")
      && remote.entrySchema === local.entrySchema
      && remote.claimIdentitySchema === local.claimIdentitySchema
      && remote.operationReceiptDigest === local.operationReceiptDigest;
  } catch {
    return false;
  }
}

function requiredEntrySchema(value, label) {
  const schema = String(value || "").trim();
  if (![CURRENT_CLAIM_ENTRY_SCHEMA, HISTORICAL_CLAIM_ENTRY_SCHEMA].includes(schema)) {
    throw new Error(`${label} is unsupported.`);
  }
  return schema;
}

function requiredIdentitySchema(value, entrySchema, label) {
  const schema = requiredEntrySchema(value, label);
  if (entrySchema === HISTORICAL_CLAIM_ENTRY_SCHEMA
    && schema !== HISTORICAL_CLAIM_ENTRY_SCHEMA) {
    throw new Error(`${label} cannot postdate its historical entry.`);
  }
  return schema;
}

function requiredDigest(value, label) {
  const digest = String(value || "").trim();
  if (!DIGEST_PATTERN.test(digest)) {
    throw new Error(`${label} must be a SHA-256 digest.`);
  }
  return digest;
}
