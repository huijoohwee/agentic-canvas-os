// Responsibility: Capture and normalize the disjoint protected-main proof for stale-base scope expansion.
import { digestValue, normalizeWriteSet }
  from "./cloud-collaboration-primitives.mjs";
import { captureProtectedMainAdvance }
  from "./device-branch-ownership-lib.mjs";
import { proveLegacyReviewCanonicalDescendant }
  from "./legacy-clean-committed-lane-bootstrap-adapter-lib.mjs";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

export function captureActiveDirtyScopeExpansionProtectedMain({
  sourceBaseSha,
  pullRequestBaseSha,
  protectedMainSha,
  targetDeclaredWriteSet,
  gitText,
} = {}) {
  const declaredWriteSet = normalizeWriteSet(targetDeclaredWriteSet);
  const protectedMainAdvance = captureProtectedMainAdvance({
    baseSha: sourceBaseSha,
    pullRequestBaseSha,
    protectedMainSha,
    declaredWriteSet,
    gitText,
  });
  if (sourceBaseSha === protectedMainSha) {
    return Object.freeze({ protectedMainAdvance, canonicalDescendantProof: null });
  }
  const canonicalChangedPaths = String(gitText([
    "diff", "--name-only", "--no-renames", "-z", sourceBaseSha, protectedMainSha, "--",
  ]) || "").split("\0").filter(Boolean);
  const preservedChangedPaths = declaredWriteSet
    .filter(value => value.startsWith("path:"))
    .map(value => value.slice("path:".length));
  const canonicalDescendantProof = proveLegacyReviewCanonicalDescendant({
    sourceBaseSha,
    targetBaseSha: protectedMainSha,
    protectedMainSha,
    canonicalChangedPaths,
    preservedChangedPaths,
    sourceIsAncestor: true,
    targetIsProtectedAncestor: true,
  });
  return Object.freeze({ protectedMainAdvance, canonicalDescendantProof });
}

export function normalizeActiveDirtyScopeExpansionCanonicalDescendantProof(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Scope-expansion canonical-descendant proof is required.");
  }
  const canonicalChangedPaths = normalizePaths(value.canonicalChangedPaths, "canonical paths");
  const preservedChangedPaths = normalizePaths(value.preservedChangedPaths, "preserved paths");
  const core = {
    schema: value.schema,
    sourceBaseSha: sha(value.sourceBaseSha, "source base"),
    targetBaseSha: sha(value.targetBaseSha, "target base"),
    protectedMainSha: sha(value.protectedMainSha, "protected main"),
    canonicalChangedPaths,
    canonicalChangedPathsDigest: digest(value.canonicalChangedPathsDigest, "canonical paths"),
    preservedChangedPaths,
    preservedChangedPathsDigest: digest(value.preservedChangedPathsDigest, "preserved paths"),
    ancestry: value.ancestry,
    overlap: value.overlap,
  };
  if (core.schema !== "agentic-legacy-review-current-base-disjoint-proof/v1"
    || core.sourceBaseSha === core.targetBaseSha
    || core.targetBaseSha !== core.protectedMainSha
    || core.ancestry !== "source-base-to-current-protected-main"
    || core.overlap !== "none"
    || core.canonicalChangedPathsDigest !== digestValue(canonicalChangedPaths)
    || core.preservedChangedPathsDigest !== digestValue(preservedChangedPaths)
    || value.evidenceDigest !== digestValue(core)) {
    throw new Error("Scope-expansion canonical-descendant proof is invalid.");
  }
  return Object.freeze({ ...core, evidenceDigest: value.evidenceDigest });
}

function normalizePaths(value, label) {
  if (!Array.isArray(value)) throw new Error(`Scope-expansion ${label} are invalid.`);
  const paths = value.map(item => String(item || "").replaceAll("\\", "/"));
  if (paths.some(item => !item || item.startsWith("/")
    || item.split("/").some(part => !part || part === "." || part === ".."))) {
    throw new Error(`Scope-expansion ${label} are invalid.`);
  }
  const normalized = [...new Set(paths)].sort();
  if (normalized.length !== paths.length) throw new Error(`Scope-expansion ${label} are invalid.`);
  return Object.freeze(normalized);
}

function sha(value, label) {
  if (!SHA_PATTERN.test(String(value || ""))) throw new Error(`Scope-expansion ${label} must be a SHA.`);
  return value;
}

function digest(value, label) {
  if (!DIGEST_PATTERN.test(String(value || ""))) throw new Error(`Scope-expansion ${label} digest is invalid.`);
  return value;
}
