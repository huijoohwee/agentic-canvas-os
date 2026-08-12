// Responsibility: normalize inert split-window bundles and journal transitions.
import path from "node:path";
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";

export const BUNDLE_SCHEMA = "agentic-split-window-bundle/v1";
export const OPERATION_SCHEMA = "agentic-split-window-operation/v1";
export const IMPORT_PLAN_SCHEMA = "agentic-split-window-import-plan/v1";
export const IMPORT_RECEIPT_SCHEMA = "agentic-split-window-import-receipt/v1";
const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const KINDS = new Set(["patch", "blob", "evidence", "test-plan"]);
const STATES = Object.freeze(["sealed", "planned", "armed", "applied", "verified", "complete"]);

export function createBundle(input) {
  const paths = normalizedPaths(input.paths);
  const artifacts = input.artifacts.map(normalizeArtifact).sort(byDigest);
  unique(artifacts.map(item => item.digest), "artifact digest");
  const artifactPaths = [...new Set(artifacts.flatMap(item => item.paths))].sort();
  if (canonicalJson(artifactPaths) !== canonicalJson(paths)) {
    throw new Error("Bundle paths must exactly equal the artifact path union.");
  }
  const core = {
    schema: BUNDLE_SCHEMA,
    bundleId: requiredText(input.bundleId, "bundle ID"),
    source: normalizeSource(input.source),
    target: normalizeTarget(input.target),
    paths,
    pathsDigest: digestValue(paths),
    artifacts,
    artifactsDigest: digestValue(artifacts),
    boundsPolicyDigest: requiredDigest(input.boundsPolicyDigest, "bounds policy digest"),
    authority: Object.freeze({ kind: "none", mutationCapabilities: [] }),
  };
  return freeze({ ...core, bundleDigest: digestValue(core) });
}

export function normalizeBundle(value) {
  exactKeys(value, ["schema", "bundleId", "source", "target", "paths", "pathsDigest",
    "artifacts", "artifactsDigest", "boundsPolicyDigest", "authority", "bundleDigest"], "bundle");
  const rebuilt = createBundle(value);
  exact(rebuilt, value, "Split-window bundle");
  return rebuilt;
}

export function createOperation({ bundleDigest, operationId, phases = [] }) {
  const normalized = phases.map((phase, index) => normalizePhase(phase, index));
  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized[index].state !== STATES[index]) throw new Error("Operation phases are not an ordered prefix.");
    const expected = index === 0 ? null : normalized[index - 1].phaseDigest;
    if (normalized[index].previousPhaseDigest !== expected) throw new Error("Operation phase chain is broken.");
  }
  const core = { schema: OPERATION_SCHEMA, operationId: requiredText(operationId, "operation ID"),
    bundleDigest: requiredDigest(bundleDigest, "bundle digest"), phases: normalized };
  return freeze({ ...core, operationDigest: digestValue(core) });
}

export function appendOperationPhase(operation, state, values) {
  const current = normalizeOperation(operation);
  const nextIndex = current.phases.length;
  if (STATES[nextIndex] !== state) throw new Error("Operation phase is out of order.");
  const phase = buildPhase({ sequence: nextIndex + 1, state,
    previousPhaseDigest: nextIndex ? current.phases[nextIndex - 1].phaseDigest : null,
    values: plainObject(values, "phase values") });
  return createOperation({ bundleDigest: current.bundleDigest,
    operationId: current.operationId, phases: [...current.phases, phase] });
}

export function normalizeOperation(value) {
  exactKeys(value, ["schema", "operationId", "bundleDigest", "phases", "operationDigest"], "operation");
  const rebuilt = createOperation(value);
  exact(rebuilt, value, "Split-window operation");
  return rebuilt;
}

export function createImportPlan(input) {
  const core = {
    schema: IMPORT_PLAN_SCHEMA,
    bundleDigest: requiredDigest(input.bundleDigest, "bundle digest"),
    importRequestDigest: requiredDigest(input.importRequestDigest, "import request digest"),
    targetIdentityDigest: requiredDigest(input.targetIdentityDigest, "target identity digest"),
    targetPreStateDigest: requiredDigest(input.targetPreStateDigest, "target pre-state digest"),
    expectedPostStateDigest: requiredDigest(input.expectedPostStateDigest, "expected post-state digest"),
    verifierProfileDigests: input.verifierProfileDigests.map(value => requiredDigest(value, "verifier profile digest")).sort(),
    authorityObservation: normalizeAuthorityObservation(input.authorityObservation),
  };
  unique(core.verifierProfileDigests, "verifier profile digest");
  return freeze({ ...core, planDigest: digestValue(core) });
}

export function createImportReceipt(input) {
  const core = {
    schema: IMPORT_RECEIPT_SCHEMA,
    operationId: requiredText(input.operationId, "operation ID"),
    bundleDigest: requiredDigest(input.bundleDigest, "bundle digest"),
    planDigest: requiredDigest(input.planDigest, "plan digest"),
    preStateDigest: requiredDigest(input.preStateDigest, "pre-state digest"),
    postStateDigest: requiredDigest(input.postStateDigest, "post-state digest"),
    authorityReceiptDigests: input.authorityReceiptDigests.map(value => requiredDigest(value, "authority receipt digest")).sort(),
    effectReceiptDigest: requiredDigest(input.effectReceiptDigest, "effect receipt digest"),
    verifierReceiptDigests: input.verifierReceiptDigests.map(value => requiredDigest(value, "verifier receipt digest")).sort(),
    mutationAuthority: false,
  };
  unique(core.authorityReceiptDigests, "authority receipt digest");
  unique(core.verifierReceiptDigests, "verifier receipt digest");
  return freeze({ ...core, receiptDigest: digestValue(core) });
}

export function normalizeImportReceipt(value) {
  exactKeys(value, ["schema", "operationId", "bundleDigest", "planDigest", "preStateDigest",
    "postStateDigest", "authorityReceiptDigests", "effectReceiptDigest", "verifierReceiptDigests",
    "mutationAuthority", "receiptDigest"], "import receipt");
  if (value.schema !== IMPORT_RECEIPT_SCHEMA || value.mutationAuthority !== false) {
    throw new Error("Import receipt schema or authority boundary is invalid.");
  }
  const rebuilt = createImportReceipt(value); exact(rebuilt, value, "Import receipt"); return rebuilt;
}

export function nextState(operation) {
  const normalized = normalizeOperation(operation);
  return STATES[normalized.phases.length] || null;
}

function normalizeSource(value) {
  exactKeys(value, ["repositoryIdentityDigest", "baseRevision", "baseTreeDigest", "sourceStateDigest"], "source");
  return freeze({ repositoryIdentityDigest: requiredDigest(value.repositoryIdentityDigest, "source repository identity"),
    baseRevision: requiredSha(value.baseRevision, "source base revision"),
    baseTreeDigest: requiredSha(value.baseTreeDigest, "source base tree"),
    sourceStateDigest: requiredDigest(value.sourceStateDigest, "source state digest") });
}
function normalizeTarget(value) {
  exactKeys(value, ["repositoryIdentityDigest", "semanticScope", "canonicalBaseSha", "manifestDigest", "writeSetDigest"], "target");
  return freeze({ repositoryIdentityDigest: requiredDigest(value.repositoryIdentityDigest, "target repository identity"),
    semanticScope: requiredText(value.semanticScope, "semantic scope"), canonicalBaseSha: requiredSha(value.canonicalBaseSha, "canonical base"),
    manifestDigest: requiredDigest(value.manifestDigest, "manifest digest"), writeSetDigest: requiredDigest(value.writeSetDigest, "write-set digest") });
}
function normalizeArtifact(value) {
  exactKeys(value, ["kind", "digest", "sizeBytes", "mediaType", "paths"], "artifact");
  if (!KINDS.has(value.kind)) throw new Error("Artifact kind is unsupported.");
  return freeze({ kind: value.kind, digest: requiredDigest(value.digest, "artifact digest"),
    sizeBytes: positiveInteger(value.sizeBytes, "artifact size"), mediaType: requiredText(value.mediaType, "artifact media type"),
    paths: normalizedPaths(value.paths) });
}
function normalizeAuthorityObservation(value) {
  exactKeys(value, ["cloudVerificationDigest", "writerLeaseDigest", "registryRevision", "mutationAuthorityReceiptDigest", "evaluatedAt", "expiresAt"], "authority observation");
  return freeze({ cloudVerificationDigest: requiredDigest(value.cloudVerificationDigest, "cloud verification digest"),
    writerLeaseDigest: requiredDigest(value.writerLeaseDigest, "writer lease digest"), registryRevision: positiveInteger(value.registryRevision, "registry revision"),
    mutationAuthorityReceiptDigest: requiredDigest(value.mutationAuthorityReceiptDigest, "mutation-authority receipt digest"),
    evaluatedAt: requiredText(value.evaluatedAt, "evaluation time"), expiresAt: requiredText(value.expiresAt, "expiry") });
}
function buildPhase({ sequence, state, previousPhaseDigest, values }) {
  if (!STATES.includes(state)) throw new Error("Unknown operation phase.");
  const core = { sequence: positiveInteger(sequence, "phase sequence"), state,
    previousPhaseDigest: previousPhaseDigest === null ? null : requiredDigest(previousPhaseDigest, "previous phase digest"),
    values: normalizePhaseValues(state, values) };
  return freeze({ ...core, phaseDigest: digestValue(core) });
}
function normalizePhase(value, index) {
  exactKeys(value, ["sequence", "state", "previousPhaseDigest", "values", "phaseDigest"], "phase");
  const rebuilt = buildPhase(value);
  if (rebuilt.sequence !== index + 1) throw new Error("Phase sequence is invalid.");
  exact(rebuilt, value, "Operation phase"); return rebuilt;
}
function normalizedPaths(values) { const result = values.map(safePath).sort(); unique(result, "path");
  const folded = result.map(value => value.normalize("NFC").toLowerCase()); unique(folded, "case-folded path"); return result; }
function safePath(value) { const result = String(value || ""); if (!result || path.isAbsolute(result) || path.posix.normalize(result) !== result
  || result === "." || result.startsWith("../") || result === ".git" || result.startsWith(".git/") || result.includes("\0")) throw new Error("Bundle path is unsafe."); return result; }
function byDigest(a, b) { return a.digest.localeCompare(b.digest); }
function exactKeys(value, keys, label) { plainObject(value, label); if (canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) throw new Error(`${label} fields are malformed.`); }
function exact(left, right, label) { if (canonicalJson(left) !== canonicalJson(right)) throw new Error(`${label} is malformed or drifted.`); }
function plainObject(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`); return value; }
function requiredText(value, label) { if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`); return value; }
function requiredDigest(value, label) { if (!DIGEST.test(String(value))) throw new Error(`${label} must be a digest.`); return value; }
function requiredSha(value, label) { if (!SHA.test(String(value))) throw new Error(`${label} must be a SHA.`); return value; }
function positiveInteger(value, label) { if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`); return value; }
function unique(values, label) { if (new Set(values).size !== values.length) throw new Error(`${label} values must be unique.`); }
function freeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } return value; }

function normalizePhaseValues(state, value) {
  const schemas = {
    sealed: ["bundleDigest"],
    planned: ["planDigest", "importRequestDigest", "targetIdentityDigest", "preflightReceiptDigest",
      "targetPreStateDigest", "expectedPostStateDigest", "verifierProfileDigests"],
    armed: ["planDigest", "authorityReceiptDigest", "beforeStateDigest", "expectedPostStateDigest"],
    applied: ["beforeStateDigest", "postStateDigest", "effectReceiptDigest", "expectedPostStateDigest", "replayed"],
    verified: ["postStateDigest", "verifierReceiptDigests"],
    complete: ["receiptDigest"],
  };
  exactKeys(value, schemas[state], `${state} phase values`);
  if (state === "sealed") return freeze({ bundleDigest: requiredDigest(value.bundleDigest, "phase bundle digest") });
  if (state === "planned") return freeze({ planDigest: requiredDigest(value.planDigest, "phase plan digest"),
    importRequestDigest: requiredDigest(value.importRequestDigest, "phase import-request digest"),
    targetIdentityDigest: requiredDigest(value.targetIdentityDigest, "phase target identity digest"),
    preflightReceiptDigest: requiredDigest(value.preflightReceiptDigest, "preflight receipt digest"),
    targetPreStateDigest: requiredDigest(value.targetPreStateDigest, "target pre-state digest"),
    expectedPostStateDigest: requiredDigest(value.expectedPostStateDigest, "expected post-state digest"),
    verifierProfileDigests: normalizedDigests(value.verifierProfileDigests, "verifier profile digest") });
  if (state === "armed") return freeze({ planDigest: requiredDigest(value.planDigest, "phase plan digest"),
    authorityReceiptDigest: requiredDigest(value.authorityReceiptDigest, "authority receipt digest"),
    beforeStateDigest: requiredDigest(value.beforeStateDigest, "armed pre-state digest"),
    expectedPostStateDigest: requiredDigest(value.expectedPostStateDigest, "armed post-state digest") });
  if (state === "applied") return freeze({ beforeStateDigest: requiredDigest(value.beforeStateDigest, "effect pre-state digest"),
    postStateDigest: requiredDigest(value.postStateDigest, "effect post-state digest"),
    effectReceiptDigest: requiredDigest(value.effectReceiptDigest, "effect receipt digest"),
    expectedPostStateDigest: requiredDigest(value.expectedPostStateDigest, "expected post-state digest"),
    replayed: requiredBoolean(value.replayed, "effect replay flag") });
  if (state === "verified") {
    const verifierReceiptDigests = normalizedDigests(value.verifierReceiptDigests, "verifier receipt digest");
    return freeze({ postStateDigest: requiredDigest(value.postStateDigest, "verified post-state digest"), verifierReceiptDigests });
  }
  return freeze({ receiptDigest: requiredDigest(value.receiptDigest, "completion receipt digest") });
}

function requiredBoolean(value, label) { if (typeof value !== "boolean") throw new Error(`${label} must be boolean.`); return value; }
function normalizedDigests(value, label) { if (!Array.isArray(value)) throw new Error(`${label} values must be an array.`);
  const result = value.map(item => requiredDigest(item, label)).sort(); unique(result, label); return freeze(result); }
