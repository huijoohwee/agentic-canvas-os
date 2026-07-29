import { createHash } from "node:crypto";

import { validateProductionRuntimeReadiness } from "./production-runtime-readiness-contract.mjs";

export const LOCAL_REVIEW_CANDIDATE_SCHEMA = "agentic-local-review-candidate/v1";
export const PRODUCTION_RELEASE_CANDIDATE_SCHEMA = "agentic-production-release-candidate/v1";
export const PRODUCTION_RELEASE_AUTHORIZATION_SCHEMA = "agentic-production-release-authorization/v1";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export function createLocalReviewCandidate(runtime, trees) {
  if (runtime?.status !== "runtime-ready" || runtime.ready !== true) {
    throw new Error("Local review requires runtime-ready evidence.");
  }
  if (runtime.source?.revision !== trees?.source?.revision ||
      runtime.agenticCanvasOs?.revision !== trees?.agenticCanvasOs?.revision ||
      runtime.catalogRevision !== trees?.agenticCanvasOs?.revision) {
    throw new Error("Local review runtime identity drifted from the canonical candidate.");
  }
  assertShaTree(trees.source, "source");
  assertShaTree(trees.agenticCanvasOs, "Agentic Canvas OS");
  if (Object.values(runtime.probes || {}).some(status => status !== 200) ||
      Object.keys(runtime.probes || {}).length < 3) {
    throw new Error("Local review requires all canonical runtime probes to return HTTP 200.");
  }
  const evidence = {
    schema: LOCAL_REVIEW_CANDIDATE_SCHEMA,
    status: "review-ready",
    source: {
      repository: runtime.source.repository,
      revision: trees.source.revision,
      tree: trees.source.tree,
    },
    agenticCanvasOs: {
      repository: runtime.agenticCanvasOs.repository,
      revision: trees.agenticCanvasOs.revision,
      tree: trees.agenticCanvasOs.tree,
    },
    catalogRevision: runtime.catalogRevision,
    runtimeEvidenceDigest: digest({
      source: runtime.source,
      agenticCanvasOs: runtime.agenticCanvasOs,
      catalogRevision: runtime.catalogRevision,
      probes: runtime.probes,
      protectedChecks: runtime.protectedChecks,
      ownershipTokenDigest: runtime.ownershipTokenDigest,
    }),
  };
  return Object.freeze({ ...evidence, candidateDigest: digest(evidence) });
}

export function createProductionReleaseCandidate(localReview, readiness) {
  validateLocalReviewCandidate(localReview);
  validateProductionRuntimeReadiness(readiness);
  if (readiness.source.revision !== localReview.source.revision ||
      readiness.source.tree !== localReview.source.tree ||
      readiness.agenticCanvasOs.revision !== localReview.agenticCanvasOs.revision ||
      readiness.catalogRevision !== localReview.catalogRevision) {
    throw new Error("Production build drifted from the localhost-reviewed source candidate.");
  }
  const evidence = {
    schema: PRODUCTION_RELEASE_CANDIDATE_SCHEMA,
    status: "awaiting-human-authorization",
    source: localReview.source,
    agenticCanvasOs: localReview.agenticCanvasOs,
    catalogRevision: localReview.catalogRevision,
    artifact: readiness.artifact,
    immutableManifest: readiness.immutableManifest,
    localReviewCandidateDigest: localReview.candidateDigest,
  };
  return Object.freeze({ ...evidence, candidateDigest: digest(evidence) });
}

export function validateProductionReleaseAuthorization(candidate, authorization, current) {
  validateProductionReleaseCandidate(candidate);
  if (!isExactObject(authorization, [
    "schema",
    "status",
    "environment",
    "reviewer",
    "authorizedAt",
    "candidateDigest",
  ]) ||
      authorization.schema !== PRODUCTION_RELEASE_AUTHORIZATION_SCHEMA ||
      authorization.status !== "authorized" ||
      authorization.environment !== "production" ||
      typeof authorization.reviewer !== "string" ||
      !authorization.reviewer.trim() ||
      typeof authorization.authorizedAt !== "string" ||
      Number.isNaN(Date.parse(authorization.authorizedAt)) ||
      authorization.candidateDigest !== candidate.candidateDigest) {
    throw new Error("Production authorization is missing, malformed, or bound to another candidate.");
  }
  validateProductionRuntimeReadiness(current?.readiness);
  const rebuilt = createProductionReleaseCandidate(current.localReview, current.readiness);
  if (rebuilt.candidateDigest !== candidate.candidateDigest ||
      current.originMainSha !== candidate.source.revision ||
      current.localMainSha !== candidate.source.revision ||
      current.agenticCanvasOsSha !== candidate.agenticCanvasOs.revision) {
    throw new Error("Production authorization is invalid because source, artifact, manifest, or runtime identity drifted.");
  }
  return true;
}

export function validateLocalReviewCandidate(value) {
  if (!isExactObject(value, [
    "schema",
    "status",
    "source",
    "agenticCanvasOs",
    "catalogRevision",
    "runtimeEvidenceDigest",
    "candidateDigest",
  ]) ||
      value.schema !== LOCAL_REVIEW_CANDIDATE_SCHEMA ||
      value.status !== "review-ready" ||
      value.catalogRevision !== value.agenticCanvasOs?.revision ||
      !SHA256_PATTERN.test(String(value.runtimeEvidenceDigest || ""))) {
    throw new Error("Local review candidate is malformed.");
  }
  assertShaTree(value.source, "source");
  assertShaTree(value.agenticCanvasOs, "Agentic Canvas OS");
  const { candidateDigest, ...evidence } = value;
  if (candidateDigest !== digest(evidence)) throw new Error("Local review candidate digest does not match its evidence.");
  return value;
}

export function validateProductionReleaseCandidate(value) {
  if (!isExactObject(value, [
    "schema",
    "status",
    "source",
    "agenticCanvasOs",
    "catalogRevision",
    "artifact",
    "immutableManifest",
    "localReviewCandidateDigest",
    "candidateDigest",
  ]) ||
      value.schema !== PRODUCTION_RELEASE_CANDIDATE_SCHEMA ||
      value.status !== "awaiting-human-authorization" ||
      value.catalogRevision !== value.agenticCanvasOs?.revision ||
      !SHA256_PATTERN.test(String(value.localReviewCandidateDigest || ""))) {
    throw new Error("Production release candidate is malformed.");
  }
  assertShaTree(value.source, "source");
  assertShaTree(value.agenticCanvasOs, "Agentic Canvas OS");
  assertDigest(value.artifact, "artifact");
  assertDigest(value.immutableManifest, "immutable manifest");
  const { candidateDigest, ...evidence } = value;
  if (candidateDigest !== digest(evidence)) throw new Error("Production release candidate digest does not match its evidence.");
  return value;
}

function assertShaTree(value, label) {
  if (!isExactObject(value, ["repository", "revision", "tree"]) ||
      typeof value.repository !== "string" ||
      !value.repository.includes("/") ||
      !SHA_PATTERN.test(String(value.revision || "")) ||
      !SHA_PATTERN.test(String(value.tree || ""))) {
    throw new Error(`${label} must contain exact commit and tree SHAs.`);
  }
}

function assertDigest(value, label) {
  if (!isExactObject(value, ["algorithm", "digest"]) ||
      value.algorithm !== "sha256" ||
      !SHA256_PATTERN.test(String(value.digest || ""))) {
    throw new Error(`${label} must contain an exact SHA-256 digest.`);
  }
}

function digest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function isExactObject(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
