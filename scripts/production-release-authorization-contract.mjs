import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  AUTHORIZATION_INTERACTION_RECEIPT_SCHEMA, CANDIDATE_MANIFEST_SCHEMA,
  HUMAN_AUTHORIZATION_RECEIPT_SCHEMA, INTEGRATION_RECEIPT_SCHEMA,
  OVERLAP_DISPOSITION_RECEIPT_SCHEMA, OVERLAP_PRESERVATION_RECEIPT_SCHEMA,
  RUNTIME_REVIEW_RECEIPT_SCHEMA, createCandidateManifest, createIntegrationReceipt,
  createOverlapDispositionReceipt, createOverlapPreservationReceipt, createRuntimeReviewReceipt,
} from "./collaborative-release-lifecycle-contract.mjs";
import { COLLABORATIVE_RELEASE_LIFECYCLE_JSON_SCHEMA } from "./agentic-sdlc/schema-validation.mjs";
import { validateProductionRuntimeReadiness } from "./production-runtime-readiness-contract.mjs";
export const LOCAL_REVIEW_CANDIDATE_SCHEMA = "agentic-local-review-candidate/v1";
export const PRODUCTION_RELEASE_CANDIDATE_SCHEMA = "agentic-production-release-candidate/v1";
export const PRODUCTION_RELEASE_AUTHORIZATION_SCHEMA = "agentic-production-release-authorization/v1";
export const PRODUCTION_AUTHORIZATION_PROMPT_SCHEMA = "agentic-production-authorization-prompt/v1";
export const PROVIDER_NEUTRAL_PRODUCTION_AUTHORIZATION_AUTHORITY_SCHEMA = "agentic-provider-neutral-production-authorization-authority/v1";
export const PROVIDER_NEUTRAL_PRODUCTION_AUTHORIZATION_READINESS_SCHEMA = "agentic-provider-neutral-production-authorization-readiness/v1";
export const PROVIDER_NEUTRAL_PRODUCTION_AUTHORIZATION_PROMPT_SCHEMA = "agentic-provider-neutral-production-authorization-prompt/v1";
export const PRODUCTION_AUTHORIZATION_FORMATTER_PATH = "agentic-canvas-os/scripts/production-release-authorization-contract.mjs";
export const PRODUCTION_AUTHORIZATION_LOCAL_FORMATTER_PATH = fileURLToPath(import.meta.url);
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const lifecycleAjv = new Ajv2020({ allErrors: true, strict: true });
lifecycleAjv.addFormat("date-time", {
  type: "string",
  validate: value => !Number.isNaN(Date.parse(value)),
});
const validateLifecycleCarrierSchema = lifecycleAjv.compile(COLLABORATIVE_RELEASE_LIFECYCLE_JSON_SCHEMA);
export function createLocalReviewCandidate(runtime, trees) {
  if (runtime?.status !== "runtime-ready" || runtime.ready !== true) {
    throw new Error("Local review requires runtime-ready evidence.");
  }
  const localhostReviewUrl = resolveLocalhostReviewUrl(runtime);
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
      localhostReviewUrl,
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
export function createProductionAuthorizationPrompt(runtime, localReview, candidate, input) {
  if (!isExactObject(input, ["runRef"])) {
    throw new Error("Production authorization prompt input is malformed.");
  }
  validateLocalReviewCandidate(localReview);
  validateProductionReleaseCandidate(candidate);
  validatePromptRuntimeIdentity(runtime, localReview);
  if (candidate.localReviewCandidateDigest !== localReview.candidateDigest ||
      candidate.source.revision !== localReview.source.revision ||
      candidate.agenticCanvasOs.revision !== localReview.agenticCanvasOs.revision) {
    throw new Error("Production authorization prompt drifted from runtime-ready localhost review.");
  }
  const runRef = requirePromptReference(input.runRef);
  const evidence = {
    schema: PRODUCTION_AUTHORIZATION_PROMPT_SCHEMA,
    status: "awaiting-human-authorization",
    candidateDigest: candidate.candidateDigest,
    sourceRevision: candidate.source.revision,
    runRef,
    localhostReviewUrl: resolveLocalhostReviewUrl(runtime),
    authorizationReply: `authorize ${candidate.candidateDigest}`,
  };
  return Object.freeze({ ...evidence, promptDigest: digest(evidence) });
}
export function formatProductionAuthorizationPrompt(value) {
  validateProductionAuthorizationPrompt(value);
  return [
    "The release is verified and awaiting fresh human authorization.",
    "",
    `Candidate: \`${value.candidateDigest}\``,
    `Source: \`${value.sourceRevision}\``,
    `Run: \`${value.runRef}\``,
    `localhost: \`${value.localhostReviewUrl}\``,
    `Local formatter source: \`${PRODUCTION_AUTHORIZATION_LOCAL_FORMATTER_PATH}\``,
    "",
    `Template: \`${PRODUCTION_AUTHORIZATION_FORMATTER_PATH}\``,
    "",
    "Reply exactly:",
    "",
    `\`${value.authorizationReply}\``,
  ].join("\n");
}
export function validateProductionAuthorizationPrompt(value) {
  if (!isExactObject(value, [
    "schema",
    "status",
    "candidateDigest",
    "sourceRevision",
    "runRef",
    "localhostReviewUrl",
    "authorizationReply",
    "promptDigest",
  ]) ||
      value.schema !== PRODUCTION_AUTHORIZATION_PROMPT_SCHEMA ||
      value.status !== "awaiting-human-authorization" ||
      !SHA256_PATTERN.test(String(value.candidateDigest || "")) ||
      !SHA_PATTERN.test(String(value.sourceRevision || "")) ||
      value.localhostReviewUrl !== requireLocalhostUrl(value.localhostReviewUrl) ||
      value.runRef !== requirePromptReference(value.runRef) ||
      value.authorizationReply !== `authorize ${value.candidateDigest}`) {
    throw new Error("Production authorization prompt is malformed.");
  }
  const { promptDigest, ...evidence } = value;
  if (promptDigest !== digest(evidence)) {
    throw new Error("Production authorization prompt digest does not match its evidence.");
  }
  return value;
}
export function createProviderNeutralProductionAuthorizationPrompt(releaseLifecycle, authority, readiness, input) {
  if (!isExactObject(input, ["candidateDigest", "runRef"]) ||
      !SHA256_PATTERN.test(String(input.candidateDigest || ""))) {
    throw new Error("Provider-neutral authorization prompt input is malformed.");
  }
  const chain = resolveProviderNeutralReceiptChain(releaseLifecycle, input.candidateDigest);
  const promptedAt = new Date(Date.now()).toISOString();
  const currentAuthority = validateProviderNeutralAuthority(releaseLifecycle, authority, chain);
  const review = validateProviderNeutralReadiness(currentAuthority, readiness, chain, promptedAt);
  const runRef = requireProviderNeutralReference(input.runRef);
  const evidence = {
    schema: PROVIDER_NEUTRAL_PRODUCTION_AUTHORIZATION_PROMPT_SCHEMA, status: "awaiting-human-authorization",
    releaseLifecycleSchemaId: COLLABORATIVE_RELEASE_LIFECYCLE_JSON_SCHEMA.$id,
    candidateDigest: chain.candidate.receiptDigest, targetDigest: chain.candidate.targetDigest,
    sourceRevision: chain.integration.sourceRevision, runtimeReviewReceiptDigest: chain.review.receiptDigest,
    runRef, reviewSurfaceLocator: review.reviewSurfaceLocator,
    reviewSurfaceDigest: chain.review.reviewSurfaceDigest, probesDigest: chain.review.probesDigest,
    lifecycleAuthorityDigest: currentAuthority.authorityDigest,
    readinessDigest: digest(readiness), reviewObservedAt: review.observedAt,
    promptedAt, reviewExpiresAt: chain.review.expiresAt,
    authorizationReply: `authorize ${chain.candidate.receiptDigest}`,
  };
  return Object.freeze({ ...evidence, promptDigest: digest(evidence) });
}
export function formatProviderNeutralProductionAuthorizationPrompt(value) {
  validateProviderNeutralProductionAuthorizationPrompt(value);
  return [
    "The release is verified and awaiting fresh human authorization.",
    "",
    `Candidate: \`${value.candidateDigest}\``,
    `Target: \`${value.targetDigest}\``,
    `Source: \`${value.sourceRevision}\``,
    `Run: \`${value.runRef}\``,
    `Review surface: \`${value.reviewSurfaceLocator}\``,
    "",
    `Template: \`${PRODUCTION_AUTHORIZATION_FORMATTER_PATH}\``,
    "",
    "Reply exactly:",
    "",
    `\`${value.authorizationReply}\``,
  ].join("\n");
}
export function validateProviderNeutralProductionAuthorizationPrompt(value) {
  if (!isExactObject(value, [
    "schema", "status", "releaseLifecycleSchemaId", "candidateDigest", "targetDigest",
    "sourceRevision", "runtimeReviewReceiptDigest", "runRef", "reviewSurfaceLocator",
    "reviewSurfaceDigest", "probesDigest", "lifecycleAuthorityDigest", "readinessDigest", "reviewObservedAt",
    "promptedAt", "reviewExpiresAt", "authorizationReply", "promptDigest",
  ]) ||
      value.schema !== PROVIDER_NEUTRAL_PRODUCTION_AUTHORIZATION_PROMPT_SCHEMA ||
      value.status !== "awaiting-human-authorization" ||
      value.releaseLifecycleSchemaId !== COLLABORATIVE_RELEASE_LIFECYCLE_JSON_SCHEMA.$id ||
      !SHA256_PATTERN.test(String(value.candidateDigest || "")) ||
      !SHA256_PATTERN.test(String(value.targetDigest || "")) ||
      !SHA256_PATTERN.test(String(value.runtimeReviewReceiptDigest || "")) ||
      !SHA256_PATTERN.test(String(value.reviewSurfaceDigest || "")) ||
      !SHA256_PATTERN.test(String(value.probesDigest || "")) ||
      !SHA256_PATTERN.test(String(value.lifecycleAuthorityDigest || "")) ||
      !SHA256_PATTERN.test(String(value.readinessDigest || "")) ||
      value.sourceRevision !== requireProviderNeutralReference(value.sourceRevision) ||
      value.runRef !== requireProviderNeutralReference(value.runRef) ||
      value.reviewSurfaceLocator !== requireReviewSurfaceLocator(value.reviewSurfaceLocator) ||
      ![value.reviewObservedAt, value.promptedAt, value.reviewExpiresAt].every(isInstant) ||
      Date.parse(value.reviewObservedAt) > Date.parse(value.promptedAt) ||
      Date.parse(value.promptedAt) > Date.parse(value.reviewExpiresAt) ||
      value.authorizationReply !== `authorize ${value.candidateDigest}`) {
    throw new Error("Provider-neutral production authorization prompt is malformed.");
  }
  const { promptDigest, ...evidence } = value;
  if (promptDigest !== digest(evidence)) {
    throw new Error("Provider-neutral authorization prompt digest does not match its evidence.");
  }
  return value;
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
function resolveProviderNeutralReceiptChain(releaseLifecycle, candidateDigest) {
  if (!validateLifecycleCarrierSchema(releaseLifecycle)) {
    throw new Error("Provider-neutral release lifecycle carrier is malformed.");
  }
  const receipts = releaseLifecycle.receipts;
  const candidate = requireUniqueReceipt(
    receipts,
    CANDIDATE_MANIFEST_SCHEMA,
    receipt => receipt.receiptDigest === candidateDigest,
    "candidate",
  );
  if (receipts.some(receipt =>
    [AUTHORIZATION_INTERACTION_RECEIPT_SCHEMA, HUMAN_AUTHORIZATION_RECEIPT_SCHEMA]
      .includes(receipt.schema) &&
    receipt.candidateDigest === candidate.receiptDigest)) {
    throw new Error("Provider-neutral candidate already has authorization interaction evidence.");
  }
  const review = requireUniqueReceipt(
    receipts,
    RUNTIME_REVIEW_RECEIPT_SCHEMA,
    receipt => receipt.receiptDigest === candidate.runtimeReviewReceiptDigest,
    "runtime review",
  );
  const integration = requireUniqueReceipt(
    receipts,
    INTEGRATION_RECEIPT_SCHEMA,
    receipt => receipt.receiptDigest === review.integrationReceiptDigest,
    "integration",
  );
  const preservation = requireUniqueReceipt(
    receipts,
    OVERLAP_PRESERVATION_RECEIPT_SCHEMA,
    receipt => receipt.receiptDigest === integration.preservationReceiptDigest,
    "overlap preservation",
  );
  const disposition = requireUniqueReceipt(
    receipts,
    OVERLAP_DISPOSITION_RECEIPT_SCHEMA,
    receipt => receipt.receiptDigest === integration.overlapDispositionReceiptDigest,
    "overlap disposition",
  );
  assertExactReceipt(preservation, createOverlapPreservationReceipt(receiptInput(preservation)));
  assertExactReceipt(disposition, createOverlapDispositionReceipt(preservation, receiptInput(disposition)));
  assertExactReceipt(integration, createIntegrationReceipt(
      preservation,
      disposition,
      receiptInput(integration, ["preservationReceiptDigest", "overlapDispositionReceiptDigest"]),
  ));
  assertExactReceipt(review, createRuntimeReviewReceipt(
      integration,
      receiptInput(review, ["integrationReceiptDigest", "sourceDigest", "dependencyClosureDigest"]),
  ));
  assertExactReceipt(candidate, createCandidateManifest(
      review,
      receiptInput(candidate, [
        "runtimeReviewReceiptDigest",
        "sourceDigest",
        "dependencyClosureDigest",
        "policyDigest",
      ]),
  ));
  return Object.freeze({ preservation, disposition, integration, review, candidate });
}
function validateProviderNeutralAuthority(releaseLifecycle, authority, chain) {
  const fields = [
    "schema", "status", "lifecycleSnapshotDigest", "candidateDigest", "competingCandidateDigest",
    "authorizationState", "authorizationInteractionReceiptDigest", "humanAuthorizationReceiptDigest",
    "canonicalSourceRevision", "releaseOwnerSourceRevision", "observedAt", "authorityDigest",
  ];
  if (!isExactObject(authority, fields) || !isInstant(authority.observedAt)) {
    throw new Error("Provider-neutral authorization requires current controller authority evidence.");
  }
  const { authorityDigest, ...evidence } = authority;
  if (!SHA256_PATTERN.test(String(authorityDigest || "")) || authorityDigest !== digest(evidence)) throw new Error(
    "Provider-neutral controller authority digest does not match its evidence.",
  );
  const expected = {
    schema: PROVIDER_NEUTRAL_PRODUCTION_AUTHORIZATION_AUTHORITY_SCHEMA, status: "current",
    lifecycleSnapshotDigest: digestLifecycleSnapshot(releaseLifecycle),
    candidateDigest: chain.candidate.receiptDigest, competingCandidateDigest: null,
    authorizationState: "uninitiated", authorizationInteractionReceiptDigest: null,
    humanAuthorizationReceiptDigest: null, canonicalSourceRevision: chain.integration.sourceRevision,
    releaseOwnerSourceRevision: chain.integration.sourceRevision,
  };
  for (const [field, value] of Object.entries(expected)) if (authority[field] !== value) throw new Error(
    `Provider-neutral authority ${field} drifted.`,
  );
  requireProviderNeutralReference(authority.canonicalSourceRevision);
  requireProviderNeutralReference(authority.releaseOwnerSourceRevision);
  return authority;
}
function validateProviderNeutralReadiness(authority, readiness, chain, promptedAt) {
  const fields = [
    "schema", "status", "ready", "canonicalSourceRevision", "releaseOwnerSourceRevision",
    "lifecycleAuthorityDigest", "lifecycleSnapshotDigest", "candidateDigest",
    "competingCandidateDigest", "authorizationState", "authorizationInteractionReceiptDigest",
    "humanAuthorizationReceiptDigest", "integrationReceiptDigest", "runtimeReviewReceiptDigest",
    "sourceDigest", "dependencyClosureDigest", "checksDigest", "integrationTargetDigest",
    "policyDigest", "targetDigest", "artifactDigest", "manifestDigest", "rollbackTargetDigest",
    "reviewSurfaceDigest", "probesDigest", "reviewSurface", "probes", "observedAt",
  ];
  if (!isExactObject(readiness, fields) ||
      !isExactObject(readiness.reviewSurface, ["locator"]) ||
      !isPassedProbeSet(readiness.probes) ||
      !isInstant(readiness.observedAt)) {
    throw new Error("Provider-neutral authorization requires strict runtime-ready readiness evidence.");
  }
  const expected = {
    schema: PROVIDER_NEUTRAL_PRODUCTION_AUTHORIZATION_READINESS_SCHEMA, status: "runtime-ready", ready: true,
    canonicalSourceRevision: authority.canonicalSourceRevision,
    releaseOwnerSourceRevision: authority.releaseOwnerSourceRevision,
    lifecycleAuthorityDigest: authority.authorityDigest,
    lifecycleSnapshotDigest: authority.lifecycleSnapshotDigest,
    candidateDigest: authority.candidateDigest, competingCandidateDigest: authority.competingCandidateDigest,
    authorizationState: authority.authorizationState,
    authorizationInteractionReceiptDigest: authority.authorizationInteractionReceiptDigest,
    humanAuthorizationReceiptDigest: authority.humanAuthorizationReceiptDigest,
    integrationReceiptDigest: chain.integration.receiptDigest,
    runtimeReviewReceiptDigest: chain.review.receiptDigest, sourceDigest: chain.integration.sourceDigest,
    dependencyClosureDigest: chain.integration.dependencyClosureDigest, checksDigest: chain.integration.checksDigest,
    integrationTargetDigest: chain.integration.integrationTargetDigest, policyDigest: chain.review.policyDigest,
    targetDigest: chain.candidate.targetDigest, artifactDigest: chain.candidate.artifactDigest,
    manifestDigest: chain.candidate.manifestDigest, rollbackTargetDigest: chain.candidate.rollbackTargetDigest,
    reviewSurfaceDigest: chain.review.reviewSurfaceDigest, probesDigest: chain.review.probesDigest,
  };
  for (const [field, value] of Object.entries(expected)) if (readiness[field] !== value) throw new Error(
    `Provider-neutral readiness ${field} drifted.`,
  );
  requireProviderNeutralReference(readiness.canonicalSourceRevision);
  requireProviderNeutralReference(readiness.releaseOwnerSourceRevision);
  const reviewSurfaceLocator = requireReviewSurfaceLocator(readiness.reviewSurface.locator);
  if (digest(readiness.reviewSurface) !== readiness.reviewSurfaceDigest) throw new Error(
    "Provider-neutral readiness review surface drifted.",
  );
  if (digest(readiness.probes) !== readiness.probesDigest) throw new Error(
    "Provider-neutral readiness probes drifted.",
  );
  const times = [
    chain.integration.integratedAt,
    chain.review.issuedAt,
    chain.candidate.builtAt,
    readiness.observedAt,
    authority.observedAt,
    promptedAt,
    chain.review.expiresAt,
  ].map(value => Date.parse(value));
  if (times.some((value, index) => index > 0 && value < times[index - 1])) throw new Error(
    "Provider-neutral review evidence is outside the joined candidate review window.",
  );
  return Object.freeze({ reviewSurfaceLocator, observedAt: readiness.observedAt });
}
function requireUniqueReceipt(receipts, schema, predicate, label) {
  const matches = receipts.filter(receipt => receipt.schema === schema && predicate(receipt));
  if (matches.length !== 1) {
    throw new Error(`Provider-neutral release lifecycle requires one exact ${label} receipt.`);
  }
  return matches[0];
}
function digestLifecycleSnapshot(releaseLifecycle) {
  return digest({ receipts: [...releaseLifecycle.receipts]
    .sort((left, right) => left.receiptDigest.localeCompare(right.receiptDigest, "en")) });
}
function receiptInput(receipt, derivedFields = []) {
  const input = { ...receipt };
  for (const field of ["schema", "status", "receiptDigest", ...derivedFields]) delete input[field];
  return input;
}
function assertExactReceipt(actual, rebuilt) {
  if (canonicalJson(actual) !== canonicalJson(rebuilt)) {
    throw new Error(`${actual.schema} is forged or not canonical.`);
  }
}
function isPassedProbeSet(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length > 0 &&
    entries.length <= 128 &&
    entries.every(([name, status]) =>
      name === requireProviderNeutralReference(name) && status === "passed");
}
function requireReviewSurfaceLocator(value) {
  if (typeof value !== "string" || /[\s`]/.test(value)) {
    throw new Error("Review surface must be a canonical HTTPS or loopback HTTP URL.");
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Review surface must be a canonical HTTPS or loopback HTTP URL.");
  }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  const loopbackHttp = url.protocol === "http:" && loopback;
  const allowedProtocol = url.protocol === "https:" || loopbackHttp;
  const loopbackPort = !loopbackHttp || (url.port && Number(url.port) >= 1 && Number(url.port) <= 65535);
  if (!allowedProtocol || !loopbackPort || url.username || url.password ||
      url.search || url.hash || url.href !== value) {
    throw new Error("Review surface must be a canonical HTTPS or loopback HTTP URL.");
  }
  return value;
}
function isInstant(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
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
function validatePromptRuntimeIdentity(runtime, localReview) {
  if (runtime?.status !== "runtime-ready" || runtime.ready !== true) {
    throw new Error("Production authorization prompt requires runtime-ready localhost review.");
  }
  resolveLocalhostReviewUrl(runtime);
  if (runtime.source?.repository !== localReview.source.repository ||
      runtime.source?.revision !== localReview.source.revision ||
      runtime.agenticCanvasOs?.repository !== localReview.agenticCanvasOs.repository ||
      runtime.agenticCanvasOs?.revision !== localReview.agenticCanvasOs.revision ||
      runtime.catalogRevision !== localReview.catalogRevision) {
    throw new Error("Production authorization prompt drifted from runtime-ready localhost review.");
  }
  if (Object.values(runtime.probes || {}).some(status => status !== 200) ||
      Object.keys(runtime.probes || {}).length < 3) {
    throw new Error("Production authorization prompt requires all localhost probes to return HTTP 200.");
  }
}
function resolveLocalhostReviewUrl(runtime) {
  const host = runtime?.host;
  const port = runtime?.ports?.apex;
  if (!["127.0.0.1", "localhost", "::1"].includes(host) ||
      !Number.isSafeInteger(port) ||
      port < 1 ||
      port > 65535) {
    throw new Error("Local review requires a bound loopback Apex surface.");
  }
  return `http://${host === "::1" ? "[::1]" : host}:${port}/`;
}
function requireLocalhostUrl(value) {
  const match = /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):([1-9][0-9]{0,4})\/$/.exec(String(value || ""));
  if (!match) {
    throw new Error("Production authorization prompt requires a loopback localhost URL.");
  }
  const port = Number(match[1]);
  if (!Number.isSafeInteger(port) || port > 65535) {
    throw new Error("Production authorization prompt requires a valid localhost port.");
  }
  return value;
}
function requirePromptReference(value) {
  if (typeof value !== "string" ||
      value.length < 1 ||
      value.length > 2048 ||
      /[\s`]/.test(value)) {
    throw new Error("Production authorization prompt requires one bounded run reference.");
  }
  return value;
}
function requireProviderNeutralReference(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 2048 ||
      !/^[\x21-\x5f\x61-\x7e]+$/u.test(value)) {
    throw new Error("Provider-neutral prompt requires one bounded printable reference.");
  }
  return value;
}
const digest = digestValue;
function isExactObject(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
