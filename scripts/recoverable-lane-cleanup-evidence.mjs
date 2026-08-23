// Responsibility: normalize stable provider-neutral evidence for recoverable lane cleanup.
import path from "node:path";

import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import { normalizeRecoverableLaneGeneratedResidue } from "./recoverable-lane-cleanup-generated-residue.mjs";

export const RECOVERABLE_LANE_CLEANUP_EVIDENCE_SCHEMA =
  "agentic-recoverable-lane-cleanup-evidence/v2";
const LEGACY_EVIDENCE_SCHEMA = "agentic-recoverable-lane-cleanup-evidence/v1";
const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;

export function normalizeRecoverableLaneCleanupEvidence(value) {
  exactObject(value, "Cleanup evidence", [
    "schema", "repository", "canonical", "target", "authority",
    "remoteBranch", "evidenceDigest",
  ]);
  const core = {
    schema: requiredText(value.schema, "evidence schema"),
    repository: normalizeRepository(value.repository),
    canonical: normalizeCanonical(value.canonical),
    target: normalizeTarget(value.target, value.schema),
    authority: normalizeAuthority(value.authority),
    remoteBranch: normalizeRemoteBranch(value.remoteBranch),
  };
  if (![LEGACY_EVIDENCE_SCHEMA, RECOVERABLE_LANE_CLEANUP_EVIDENCE_SCHEMA]
    .includes(core.schema)) {
    throw new Error("Cleanup evidence schema is unsupported.");
  }
  if (core.repository.root === core.target.worktreePath
    || core.canonical.worktreePath === core.target.worktreePath
    || core.target.branch === "refs/heads/main") {
    throw new Error("Recoverable cleanup cannot target the canonical worktree or main branch.");
  }
  if (core.canonical.headSha !== core.canonical.originMainSha
    || core.canonical.headSha !== core.canonical.remoteMainSha) {
    throw new Error("Recoverable cleanup requires exact canonical origin/main parity.");
  }
  if (core.target.branch !== null && core.target.headSha !== core.target.branchHeadSha) {
    throw new Error("Cleanup target branch and worktree HEAD must be identical.");
  }
  if (core.target.branch === null && (core.target.branchHeadSha !== null
    || core.remoteBranch.ref !== null || core.remoteBranch.sha !== null
    || core.authority.priorLease !== null
    || core.authority.preservationReceiptDigests.length === 0
    || core.authority.remoteAuthority.targetClaims.length > 0)) {
    throw new Error("Detached cleanup requires ref-less terminal authority and exact preservation receipts.");
  }
  if (!core.target.clean || core.target.unmergedEntries
    || core.target.operationMarkers.length) {
    throw new Error("Recoverable cleanup requires a clean target with no operation state.");
  }
  if (core.authority.currentLocalWriter
    || core.authority.remoteAuthority.currentRemoteWriter
    || core.authority.remoteAuthority.waitingSuccessors > 0
    || !["unowned-terminal", "released-terminal", "retired-preserved-terminal"]
      .includes(core.authority.disposition)) {
    throw new Error("Recoverable cleanup requires terminal local and remote authority.");
  }
  if (core.remoteBranch.ref !== core.target.branch) {
    throw new Error("Remote branch observation must name the exact target branch.");
  }
  if (value.evidenceDigest !== digestValue(core)) {
    throw new Error("Cleanup evidence digest is invalid.");
  }
  return deepFreeze({ ...core, evidenceDigest: value.evidenceDigest });
}

function normalizeRepository(value) {
  exactObject(value, "Repository evidence", ["root", "gitCommonDir", "identityDigest"]);
  return {
    root: absolutePath(value.root, "repository root"),
    gitCommonDir: absolutePath(value.gitCommonDir, "Git common directory"),
    identityDigest: requiredDigest(value.identityDigest, "repository identity digest"),
  };
}
function normalizeCanonical(value) {
  exactObject(value, "Canonical evidence", [
    "worktreePath", "headSha", "treeSha", "originMainSha", "remoteMainSha", "clean",
  ]);
  if (value.clean !== true) throw new Error("Canonical worktree must be clean.");
  return {
    worktreePath: absolutePath(value.worktreePath, "canonical worktree"),
    headSha: requiredSha(value.headSha, "canonical HEAD"),
    treeSha: requiredSha(value.treeSha, "canonical tree"),
    originMainSha: requiredSha(value.originMainSha, "origin/main"),
    remoteMainSha: requiredSha(value.remoteMainSha, "remote main"),
    clean: true,
  };
}
function normalizeTarget(value, schema) {
  const legacy = schema === LEGACY_EVIDENCE_SCHEMA;
  const keys = [
    "worktreePath", "branch", "headSha", "branchHeadSha", "treeSha",
    "worktreeGenerationDigest", "gitDir", "gitDirIdentityDigest",
    "gitDirGenerationDigest", "clean", ...(legacy ? [] : ["generatedResidue"]), "unmergedEntries",
    "operationMarkers", "stateDigest",
  ];
  exactObject(value, "Target evidence", keys);
  const target = {
    worktreePath: absolutePath(value.worktreePath, "target worktree"),
    branch: value.branch === null ? null : requiredBranch(value.branch),
    headSha: requiredSha(value.headSha, "target HEAD"),
    branchHeadSha: value.branchHeadSha === null
      ? null : requiredSha(value.branchHeadSha, "target branch HEAD"),
    treeSha: requiredSha(value.treeSha, "target tree"),
    worktreeGenerationDigest: requiredDigest(value.worktreeGenerationDigest, "worktree generation"),
    gitDir: absolutePath(value.gitDir, "target Git directory"),
    gitDirIdentityDigest: requiredDigest(value.gitDirIdentityDigest, "Git-directory identity"),
    gitDirGenerationDigest: requiredDigest(value.gitDirGenerationDigest, "Git-directory generation"),
    clean: requiredBoolean(value.clean, "target clean flag"),
    unmergedEntries: nonNegativeInteger(value.unmergedEntries, "unmerged entry count"),
    operationMarkers: normalizeTextList(value.operationMarkers, "operation marker"),
    stateDigest: requiredDigest(value.stateDigest, "target state digest"),
  };
  if (!legacy) target.generatedResidue = normalizeRecoverableLaneGeneratedResidue(value.generatedResidue);
  return target;
}
function normalizeAuthority(value) {
  exactObject(value, "Authority evidence", [
    "lifecycleState", "leaseStatus", "currentLocalWriter", "disposition",
    "priorLease", "priorLeaseDigest", "preservationReceiptDigests",
    "remoteAuthority", "authorityDigest",
  ]);
  const priorLease = value.priorLease === null
    ? null : requiredObject(value.priorLease, "prior writer lease");
  const core = {
    lifecycleState: requiredText(value.lifecycleState, "lifecycle state"),
    leaseStatus: value.leaseStatus === null ? null : requiredText(value.leaseStatus, "lease status"),
    currentLocalWriter: requiredBoolean(value.currentLocalWriter, "current local writer flag"),
    disposition: requiredText(value.disposition, "authority disposition"),
    priorLease,
    priorLeaseDigest: value.priorLeaseDigest === null
      ? null : requiredDigest(value.priorLeaseDigest, "prior lease digest"),
    preservationReceiptDigests: normalizeDigests(value.preservationReceiptDigests, "preservation receipt"),
    remoteAuthority: normalizeRemoteAuthority(value.remoteAuthority),
  };
  if ((priorLease === null) !== (core.priorLeaseDigest === null)
    || (priorLease && digestValue(priorLease) !== core.priorLeaseDigest)
    || value.authorityDigest !== digestValue(core)) {
    throw new Error("Authority evidence digest or prior lease is invalid.");
  }
  return { ...core, authorityDigest: value.authorityDigest };
}
function normalizeRemoteAuthority(value) {
  exactObject(value, "Remote authority", [
    "provider", "ledgerRepository", "targetRepository", "targetClaims",
    "currentRemoteWriter", "waitingSuccessors", "verificationReceiptDigest",
  ]);
  const targetClaims = value.targetClaims.map(claim => {
    exactObject(claim, "Remote claim", [
      "claimId", "state", "laneRevision", "transitionCounter",
      "writeAuthority", "scopeReserved",
    ]);
    return {
      claimId: requiredDigest(claim.claimId, "claim ID"),
      state: requiredText(claim.state, "claim state"),
      laneRevision: requiredSha(claim.laneRevision, "claim lane revision"),
      transitionCounter: positiveInteger(claim.transitionCounter, "claim counter"),
      writeAuthority: requiredBoolean(claim.writeAuthority, "claim write authority"),
      scopeReserved: requiredBoolean(claim.scopeReserved, "claim scope reservation"),
    };
  }).sort((left, right) => left.claimId.localeCompare(right.claimId));
  const core = {
    provider: requiredText(value.provider, "authority provider"),
    ledgerRepository: requiredText(value.ledgerRepository, "ledger repository"),
    targetRepository: requiredText(value.targetRepository, "target repository"),
    targetClaims,
    currentRemoteWriter: requiredBoolean(value.currentRemoteWriter, "remote writer flag"),
    waitingSuccessors: nonNegativeInteger(value.waitingSuccessors, "waiting successor count"),
  };
  if (core.currentRemoteWriter !== targetClaims.some(claim => claim.writeAuthority)
    || core.waitingSuccessors !== targetClaims.filter(claim => claim.state === "waiting-successor").length
    || value.verificationReceiptDigest !== digestValue(core)) {
    throw new Error("Remote authority verification is invalid.");
  }
  return { ...core, verificationReceiptDigest: value.verificationReceiptDigest };
}
function normalizeRemoteBranch(value) {
  exactObject(value, "Remote branch evidence", ["ref", "sha"]);
  return { ref: value.ref === null ? null : requiredBranch(value.ref),
    sha: value.sha === null ? null : requiredSha(value.sha, "remote branch SHA") };
}

function requiredBranch(value) {
  const text = requiredText(value, "branch ref");
  if (!text.startsWith("refs/heads/") || text === "refs/heads/main") {
    throw new Error("Cleanup requires an exact non-main branch ref.");
  }
  return text;
}
function requiredSha(value, label) {
  const text = requiredText(value, label);
  if (!SHA.test(text)) throw new Error(`${label} must be an exact Git SHA.`);
  return text;
}
function requiredDigest(value, label) {
  const text = requiredText(value, label);
  if (!DIGEST.test(text)) throw new Error(`${label} must be a SHA-256 digest.`);
  return text;
}
function normalizeDigests(values, label) {
  if (!Array.isArray(values)) throw new Error(`${label} values must be an array.`);
  const normalized = values.map(value => requiredDigest(value, label)).sort();
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} values must be unique.`);
  return normalized;
}
function normalizeTextList(values, label) {
  if (!Array.isArray(values)) throw new Error(`${label} values must be an array.`);
  const normalized = values.map(value => requiredText(value, label)).sort();
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} values must be unique.`);
  return normalized;
}
function absolutePath(value, label) {
  const text = requiredText(value, label);
  if (!path.isAbsolute(text) || path.normalize(text) !== text) {
    throw new Error(`${label} must be a normalized absolute path.`);
  }
  return text;
}
function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be positive.`);
  return value;
}
function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be non-negative.`);
  return value;
}
function requiredBoolean(value, label) {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean.`);
  return value;
}
function requiredText(value, label) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(`${label} is required.`);
  return text;
}
function requiredObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is required.`);
  }
  return value;
}
function exactObject(value, label, keys) {
  requiredObject(value, label);
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) {
    throw new Error(`${label} fields are malformed or incomplete.`);
  }
}
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
