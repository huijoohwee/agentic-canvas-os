// Responsibility: Prove one zero-effect prepared active-publish intent may follow a disjoint protected-base advance.
import {
  digestValue,
  normalizeWriteSet,
  writeSetsOverlap,
} from "./cloud-collaboration-primitives.mjs";
import { assertActivePublishPathsAdmitted } from "./active-publish-write-scope.mjs";

export const ACTIVE_PUBLISH_PREPARED_BASE_ROLLOVER_PROOF_V1_SCHEMA =
  "agentic-active-publish-prepared-base-rollover-proof/v1";
export const ACTIVE_PUBLISH_PREPARED_BASE_ROLLOVER_PROOF_SCHEMA =
  "agentic-active-publish-prepared-base-rollover-proof/v2";

const ACTIVE_PUBLISH_SUCCESSOR_INTENT_V1 =
  "agentic-active-publish-successor-intent/v1";
const ACTIVE_PUBLISH_SUCCESSOR_INTENT_V2 =
  "agentic-active-publish-successor-intent/v2";
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_CHANGED_PATHS = 256;

export function deriveActivePublishPreparedBaseExpectation(intent) {
  if (!intent || intent.status !== "prepared") {
    throw new Error("Active publish prepared-base expectation requires a prepared intent.");
  }
  if (intent.schema === ACTIVE_PUBLISH_SUCCESSOR_INTENT_V1) {
    return Object.freeze({
      kind: "prepared-v1",
      historicalBaseSha: sha(intent.targetCanonicalBaseSha, "historical base"),
      requiredProtectedBaseSha: null,
    });
  }
  if (intent.schema === ACTIVE_PUBLISH_SUCCESSOR_INTENT_V2 &&
      intent.supersededIntent?.schema === ACTIVE_PUBLISH_SUCCESSOR_INTENT_V1 &&
      intent.supersededIntent.status === "prepared") {
    const historicalBaseSha = sha(
      intent.supersededIntent.targetCanonicalBaseSha,
      "historical base",
    );
    const requiredProtectedBaseSha = sha(intent.targetCanonicalBaseSha, "protected base");
    if (historicalBaseSha === requiredProtectedBaseSha) {
      throw new Error("Active publish prepared-base expectation requires a strict protected advance.");
    }
    return Object.freeze({
      kind: "prepared-v2",
      historicalBaseSha,
      requiredProtectedBaseSha,
    });
  }
  throw new Error("Active publish prepared-base expectation requires an exact v1 or v2 intent.");
}

export function captureActivePublishPreparedBaseRolloverProof({
  sourceIntentDigest,
  historicalBaseSha,
  protectedBaseSha,
  headSha,
  admission,
  sourceClaimId,
  sourceClaimProjectionDigest,
  sourceLedgerDigest,
  gitText,
} = {}) {
  const sourceDigest = digest(sourceIntentDigest, "source intent");
  const historical = sha(historicalBaseSha, "historical base");
  const protectedBase = sha(protectedBaseSha, "protected base");
  const head = sha(headSha, "head");
  if (historical === protectedBase) {
    throw new Error("Active publish prepared-base rollover requires a strict protected advance.");
  }
  if (typeof gitText !== "function") {
    throw new Error("Active publish prepared-base rollover requires Git evidence.");
  }
  const mergeBases = String(gitText([
    "merge-base", "--all", protectedBase, head,
  ]) || "").trim().split(/\s+/u).filter(Boolean);
  if (mergeBases.length !== 1 || mergeBases[0] !== historical) {
    throw new Error("Active publish prepared-base rollover requires the exact historical merge base.");
  }
  const authoredPaths = changedPaths(gitText([
    "diff", "--name-only", "--no-renames", "-z", `${historical}..${head}`, "--",
  ]), "authored");
  const protectedPaths = changedPaths(gitText([
    "diff", "--name-only", "--no-renames", "-z", `${historical}..${protectedBase}`, "--",
  ]), "protected");
  assertActivePublishPathsAdmitted({ paths: authoredPaths, admission });
  const protectedWriteSet = protectedPaths.length
    ? normalizeWriteSet(protectedPaths.map(item => `path:${item}`))
    : [];
  if (protectedWriteSet.length && writeSetsOverlap(
    protectedWriteSet,
    admission?.declaredWriteSet,
  )) {
    throw new Error("Active publish prepared-base rollover protected paths overlap admission.");
  }
  const sourceId = digest(sourceClaimId, "source claim");
  const sourceProjectionDigest = digest(
    sourceClaimProjectionDigest,
    "source claim projection",
  );
  const sourceLedger = digest(sourceLedgerDigest, "source ledger");
  const core = {
    schema: ACTIVE_PUBLISH_PREPARED_BASE_ROLLOVER_PROOF_SCHEMA,
    sourceIntentDigest: sourceDigest,
    historicalBaseSha: historical,
    protectedBaseSha: protectedBase,
    headSha: head,
    mergeBaseSha: historical,
    authoredPaths,
    authoredPathsDigest: digestValue(authoredPaths),
    protectedPaths,
    protectedPathsDigest: digestValue(protectedPaths),
    sourceClaimId: sourceId,
    sourceClaimProjectionDigest: sourceProjectionDigest,
    sourceLedgerDigest: sourceLedger,
    cloudDisposition: "exact-source-only",
    disposition: "disjoint-zero-effect",
  };
  return Object.freeze({ ...core, evidenceDigest: digestValue(core) });
}

export function normalizeActivePublishPreparedBaseRolloverProof(value, {
  admission = null,
} = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Active publish prepared-base rollover proof is missing.");
  }
  const isV1 = value.schema === ACTIVE_PUBLISH_PREPARED_BASE_ROLLOVER_PROOF_V1_SCHEMA;
  const isV2 = value.schema === ACTIVE_PUBLISH_PREPARED_BASE_ROLLOVER_PROOF_SCHEMA;
  if (!isV1 && !isV2) {
    throw new Error("Active publish prepared-base rollover proof is invalid.");
  }
  exactKeys(value, [
    "schema", "sourceIntentDigest", "historicalBaseSha", "protectedBaseSha", "headSha",
    "mergeBaseSha", "authoredPaths", "authoredPathsDigest", "protectedPaths",
    "protectedPathsDigest", "sourceClaimId", "sourceClaimProjectionDigest",
    ...(isV2 ? ["sourceLedgerDigest"] : []),
    "cloudDisposition", "disposition", "evidenceDigest",
  ]);
  const authoredPaths = normalizedPaths(value.authoredPaths, "authored");
  const protectedPaths = normalizedPaths(value.protectedPaths, "protected");
  const core = {
    schema: value.schema,
    sourceIntentDigest: digest(value.sourceIntentDigest, "source intent"),
    historicalBaseSha: sha(value.historicalBaseSha, "historical base"),
    protectedBaseSha: sha(value.protectedBaseSha, "protected base"),
    headSha: sha(value.headSha, "head"),
    mergeBaseSha: sha(value.mergeBaseSha, "merge base"),
    authoredPaths,
    authoredPathsDigest: digest(value.authoredPathsDigest, "authored paths"),
    protectedPaths,
    protectedPathsDigest: digest(value.protectedPathsDigest, "protected paths"),
    sourceClaimId: digest(value.sourceClaimId, "source claim"),
    sourceClaimProjectionDigest: digest(value.sourceClaimProjectionDigest, "source claim projection"),
    ...(isV2 ? { sourceLedgerDigest: digest(value.sourceLedgerDigest, "source ledger") } : {}),
    cloudDisposition: value.cloudDisposition,
    disposition: value.disposition,
  };
  const exact = core.historicalBaseSha !== core.protectedBaseSha &&
    core.mergeBaseSha === core.historicalBaseSha &&
    core.authoredPathsDigest === digestValue(authoredPaths) &&
    core.protectedPathsDigest === digestValue(protectedPaths) &&
    core.cloudDisposition === "exact-source-only" &&
    core.disposition === "disjoint-zero-effect" &&
    value.evidenceDigest === digestValue(core);
  if (!exact) throw new Error("Active publish prepared-base rollover proof is invalid.");
  if (admission) {
    assertActivePublishPathsAdmitted({ paths: authoredPaths, admission });
    const protectedWriteSet = protectedPaths.length
      ? normalizeWriteSet(protectedPaths.map(item => `path:${item}`))
      : [];
    if (protectedWriteSet.length && writeSetsOverlap(
      protectedWriteSet,
      admission.declaredWriteSet,
    )) {
      throw new Error("Active publish prepared-base rollover protected paths overlap admission.");
    }
  }
  return Object.freeze({ ...core, evidenceDigest: value.evidenceDigest });
}

function changedPaths(value, label) {
  return normalizedPaths(String(value || "").split("\0").filter(Boolean), label);
}

function normalizedPaths(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`Active publish prepared-base rollover ${label} paths are malformed.`);
  }
  const paths = value.map(item => String(item || ""));
  if (paths.length > MAX_CHANGED_PATHS || paths.some(item => !item || item.startsWith("/") ||
      item !== item.normalize("NFC") || item !== item.trim() || item.includes("\\") ||
      item.split("/").some(part => !part || part === "." || part === ".."))) {
    throw new Error(`Active publish prepared-base rollover ${label} paths are malformed.`);
  }
  const normalized = [...new Set(paths)].sort();
  if (normalized.length !== paths.length) {
    throw new Error(`Active publish prepared-base rollover ${label} paths are ambiguous.`);
  }
  return Object.freeze(normalized);
}

function exactKeys(value, expected) {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(keys) !== JSON.stringify(wanted)) {
    throw new Error("Active publish prepared-base rollover proof fields are invalid.");
  }
}

function sha(value, label) {
  if (!SHA_PATTERN.test(String(value || ""))) {
    throw new Error(`Active publish prepared-base rollover ${label} must be a commit SHA.`);
  }
  return String(value);
}

function digest(value, label) {
  if (!DIGEST_PATTERN.test(String(value || ""))) {
    throw new Error(`Active publish prepared-base rollover ${label} digest is malformed.`);
  }
  return String(value);
}
