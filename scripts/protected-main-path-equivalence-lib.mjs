import { digestValue } from "./cloud-collaboration-primitives.mjs";

export const PROTECTED_MAIN_PATH_EQUIVALENCE_SCHEMA =
  "agentic-protected-main-path-equivalence/v1";
export const PROTECTED_MAIN_SHARED_ANCESTOR_PATH_EQUIVALENCE_SCHEMA =
  "agentic-protected-main-shared-ancestor-path-equivalence/v1";
export const PROTECTED_MAIN_REMOTE_REF = "refs/remotes/origin/main";
export const RECOVERY_PATH_EVIDENCE_MAX_PATHS = 128;
export const RECOVERY_PATH_EVIDENCE_MAX_BYTES = 16 * 1024;

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const MODE_PATTERN = /^(?:100644|100755|120000)$/;
const EVIDENCE_KEYS = Object.freeze([
  "baseSha",
  "entries",
  "exemptPathCount",
  "exemptPathsDigest",
  "headSha",
  "headTreeSha",
  "protectedMainRef",
  "protectedMainSha",
  "protectedMainTreeSha",
  "schema",
]);
const ENTRY_KEYS = Object.freeze([
  "headBlobSha",
  "headMode",
  "path",
  "protectedBlobSha",
  "protectedMode",
]);
const SHARED_ANCESTOR_EVIDENCE_KEYS = Object.freeze([
  "baseSha",
  "entries",
  "exemptPathCount",
  "exemptPathsDigest",
  "headSha",
  "headTreeSha",
  "protectedMainRef",
  "protectedMainSha",
  "protectedMainTreeSha",
  "schema",
  "sharedAncestorSha",
  "sharedAncestorTreeSha",
]);
const SHARED_ANCESTOR_ENTRY_KEYS = Object.freeze([
  "headBlobSha",
  "headMode",
  "path",
  "sharedAncestorBlobSha",
  "sharedAncestorMode",
]);

export function fetchProtectedMain({ run }) {
  run("git", [
    "fetch",
    "--no-tags",
    "origin",
    "+refs/heads/main:refs/remotes/origin/main",
  ]);
}

export function captureProtectedMainPathEquivalence({
  baseSha,
  headSha,
  exemptPaths,
  gitText,
  worktreeHeadSha = headSha,
}) {
  requireSha(baseSha, "Protected-main equivalence source base");
  requireSha(headSha, "Protected-main equivalence descendant head");
  requireSha(worktreeHeadSha, "Protected-main equivalence worktree head");
  const paths = normalizeExemptPaths(exemptPaths);
  const observedHeadSha = gitText(["rev-parse", "HEAD"]).trim();
  if (observedHeadSha !== worktreeHeadSha) {
    throw new Error(
      "Protected-main equivalence descendant HEAD drifted during evidence capture.",
    );
  }
  const headTreeSha = requireSha(
    gitText(["rev-parse", `${headSha}^{tree}`]).trim(),
    "Protected-main equivalence descendant tree",
  );
  const protectedMainSha = requireSha(
    gitText(["rev-parse", PROTECTED_MAIN_REMOTE_REF]).trim(),
    "Fetched protected-main revision",
  );
  gitText(["merge-base", "--is-ancestor", baseSha, protectedMainSha]);
  const protectedMainTreeSha = requireSha(
    gitText(["rev-parse", `${protectedMainSha}^{tree}`]).trim(),
    "Fetched protected-main tree",
  );
  const entries = paths.map(relativePath => {
    const head = readTreeBlobEntry({
      gitText,
      treeish: headSha,
      relativePath,
      label: "Descendant HEAD",
    });
    const protectedMain = readTreeBlobEntry({
      gitText,
      treeish: protectedMainSha,
      relativePath,
      label: "Fetched protected main",
    });
    if (
      head.mode !== protectedMain.mode ||
      head.blobSha !== protectedMain.blobSha
    ) {
      throw new Error(
        `Expired committed recovery path is outside declared write scope and differs from fetched protected main: ${relativePath}`,
      );
    }
    return Object.freeze({
      path: relativePath,
      headMode: head.mode,
      headBlobSha: head.blobSha,
      protectedMode: protectedMain.mode,
      protectedBlobSha: protectedMain.blobSha,
    });
  });
  const finalHeadSha = gitText(["rev-parse", "HEAD"]).trim();
  const finalHeadTreeSha = gitText([
    "rev-parse",
    `${headSha}^{tree}`,
  ]).trim();
  const finalProtectedMainSha = gitText([
    "rev-parse",
    PROTECTED_MAIN_REMOTE_REF,
  ]).trim();
  const finalProtectedMainTreeSha = gitText([
    "rev-parse",
    `${protectedMainSha}^{tree}`,
  ]).trim();
  if (
    finalHeadSha !== worktreeHeadSha ||
    finalHeadTreeSha !== headTreeSha ||
    finalProtectedMainSha !== protectedMainSha ||
    finalProtectedMainTreeSha !== protectedMainTreeSha
  ) {
    throw new Error(
      "Protected-main path-equivalence ref or tree drifted during evidence capture.",
    );
  }
  return normalizeProtectedMainPathEquivalenceEvidence({
    schema: PROTECTED_MAIN_PATH_EQUIVALENCE_SCHEMA,
    baseSha,
    headSha,
    headTreeSha,
    protectedMainRef: PROTECTED_MAIN_REMOTE_REF,
    protectedMainSha,
    protectedMainTreeSha,
    exemptPathCount: paths.length,
    exemptPathsDigest: digestValue(paths),
    entries,
  });
}

export function assertProtectedMainPathEquivalence({
  evidence,
  baseSha,
  headSha,
  exemptPaths,
  gitText,
  worktreeHeadSha = headSha,
}) {
  const expected = normalizeProtectedMainPathEquivalenceEvidence(evidence);
  const observed = captureProtectedMainPathEquivalence({
    baseSha,
    headSha,
    exemptPaths,
    gitText,
    worktreeHeadSha,
  });
  if (digestValue(observed) !== digestValue(expected)) {
    throw new Error(
      "Protected-main path-equivalence evidence drifted from its exact fetched ref, tree, mode, or blob subject.",
    );
  }
  return observed;
}

export function captureProtectedMainSharedAncestorPathEquivalence({
  baseSha,
  headSha,
  exemptPaths,
  gitText,
  worktreeHeadSha = headSha,
}) {
  requireSha(baseSha, "Protected-main shared-ancestor source base");
  requireSha(headSha, "Protected-main shared-ancestor descendant head");
  requireSha(worktreeHeadSha, "Protected-main shared-ancestor worktree head");
  const paths = normalizeExemptPaths(exemptPaths);
  const observedHeadSha = gitText(["rev-parse", "HEAD"]).trim();
  if (observedHeadSha !== worktreeHeadSha) {
    throw new Error(
      "Protected-main shared-ancestor descendant HEAD drifted during evidence capture.",
    );
  }
  const headTreeSha = requireSha(
    gitText(["rev-parse", `${headSha}^{tree}`]).trim(),
    "Protected-main shared-ancestor descendant tree",
  );
  const protectedMainSha = requireSha(
    gitText(["rev-parse", PROTECTED_MAIN_REMOTE_REF]).trim(),
    "Fetched protected-main revision",
  );
  const sharedAncestorSha = resolveSingleSharedAncestor({
    headSha,
    protectedMainSha,
    gitText,
  });
  gitText(["merge-base", "--is-ancestor", baseSha, sharedAncestorSha]);
  gitText([
    "merge-base",
    "--is-ancestor",
    sharedAncestorSha,
    protectedMainSha,
  ]);
  gitText(["merge-base", "--is-ancestor", sharedAncestorSha, headSha]);
  const protectedMainTreeSha = requireSha(
    gitText(["rev-parse", `${protectedMainSha}^{tree}`]).trim(),
    "Fetched protected-main tree",
  );
  const sharedAncestorTreeSha = requireSha(
    gitText(["rev-parse", `${sharedAncestorSha}^{tree}`]).trim(),
    "Protected-main shared-ancestor tree",
  );
  const entries = paths.map(relativePath => {
    const head = readTreeBlobEntry({
      gitText,
      treeish: headSha,
      relativePath,
      label: "Published remote head",
    });
    const sharedAncestor = readTreeBlobEntry({
      gitText,
      treeish: sharedAncestorSha,
      relativePath,
      label: "Protected-main shared ancestor",
    });
    if (
      head.mode !== sharedAncestor.mode ||
      head.blobSha !== sharedAncestor.blobSha
    ) {
      throw new Error(
        `Expired committed recovery published-prefix path is outside declared write scope and differs from its protected-main shared ancestor: ${relativePath}`,
      );
    }
    return Object.freeze({
      path: relativePath,
      headMode: head.mode,
      headBlobSha: head.blobSha,
      sharedAncestorMode: sharedAncestor.mode,
      sharedAncestorBlobSha: sharedAncestor.blobSha,
    });
  });
  const finalHeadSha = gitText(["rev-parse", "HEAD"]).trim();
  const finalHeadTreeSha = gitText([
    "rev-parse",
    `${headSha}^{tree}`,
  ]).trim();
  const finalProtectedMainSha = gitText([
    "rev-parse",
    PROTECTED_MAIN_REMOTE_REF,
  ]).trim();
  const finalProtectedMainTreeSha = gitText([
    "rev-parse",
    `${protectedMainSha}^{tree}`,
  ]).trim();
  const finalSharedAncestorSha = resolveSingleSharedAncestor({
    headSha,
    protectedMainSha: finalProtectedMainSha,
    gitText,
  });
  const finalSharedAncestorTreeSha = gitText([
    "rev-parse",
    `${sharedAncestorSha}^{tree}`,
  ]).trim();
  if (
    finalHeadSha !== worktreeHeadSha ||
    finalHeadTreeSha !== headTreeSha ||
    finalProtectedMainSha !== protectedMainSha ||
    finalProtectedMainTreeSha !== protectedMainTreeSha ||
    finalSharedAncestorSha !== sharedAncestorSha ||
    finalSharedAncestorTreeSha !== sharedAncestorTreeSha
  ) {
    throw new Error(
      "Protected-main shared-ancestor path-equivalence ref, merge-base, or tree drifted during evidence capture.",
    );
  }
  return normalizeProtectedMainSharedAncestorPathEquivalenceEvidence({
    schema: PROTECTED_MAIN_SHARED_ANCESTOR_PATH_EQUIVALENCE_SCHEMA,
    baseSha,
    headSha,
    headTreeSha,
    protectedMainRef: PROTECTED_MAIN_REMOTE_REF,
    protectedMainSha,
    protectedMainTreeSha,
    sharedAncestorSha,
    sharedAncestorTreeSha,
    exemptPathCount: paths.length,
    exemptPathsDigest: digestValue(paths),
    entries,
  });
}

export function assertProtectedMainSharedAncestorPathEquivalence({
  evidence,
  baseSha,
  headSha,
  exemptPaths,
  gitText,
  worktreeHeadSha = headSha,
}) {
  const expected =
    normalizeProtectedMainSharedAncestorPathEquivalenceEvidence(evidence);
  const observed = captureProtectedMainSharedAncestorPathEquivalence({
    baseSha,
    headSha,
    exemptPaths,
    gitText,
    worktreeHeadSha,
  });
  if (digestValue(observed) !== digestValue(expected)) {
    throw new Error(
      "Protected-main shared-ancestor path-equivalence evidence drifted from its exact fetched ref, merge-base, tree, mode, or blob subject.",
    );
  }
  return observed;
}

export function normalizeProtectedMainPathEquivalenceEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Protected-main path-equivalence evidence is malformed.");
  }
  const keys = Object.keys(value).sort();
  const entries = Array.isArray(value.entries) ? value.entries : [];
  const paths = entries.map(entry => entry?.path);
  const invalid = (
    JSON.stringify(keys) !== JSON.stringify(EVIDENCE_KEYS) ||
    value.schema !== PROTECTED_MAIN_PATH_EQUIVALENCE_SCHEMA ||
    value.protectedMainRef !== PROTECTED_MAIN_REMOTE_REF ||
    !SHA_PATTERN.test(String(value.baseSha || "")) ||
    !SHA_PATTERN.test(String(value.headSha || "")) ||
    !SHA_PATTERN.test(String(value.headTreeSha || "")) ||
    !SHA_PATTERN.test(String(value.protectedMainSha || "")) ||
    !SHA_PATTERN.test(String(value.protectedMainTreeSha || "")) ||
    !Array.isArray(value.entries) ||
    !Number.isSafeInteger(value.exemptPathCount) ||
    value.exemptPathCount < 0 ||
    value.exemptPathCount > RECOVERY_PATH_EVIDENCE_MAX_PATHS ||
    value.exemptPathCount !== entries.length ||
    Buffer.byteLength(paths.join("\0"), "utf8") >
      RECOVERY_PATH_EVIDENCE_MAX_BYTES ||
    value.exemptPathsDigest !== digestValue(paths) ||
    JSON.stringify(paths) !== JSON.stringify(normalizeExemptPaths(paths)) ||
    entries.some(entry => !validEntry(entry))
  );
  if (invalid) {
    throw new Error("Protected-main path-equivalence evidence is malformed.");
  }
  return Object.freeze({
    schema: value.schema,
    baseSha: value.baseSha,
    headSha: value.headSha,
    headTreeSha: value.headTreeSha,
    protectedMainRef: value.protectedMainRef,
    protectedMainSha: value.protectedMainSha,
    protectedMainTreeSha: value.protectedMainTreeSha,
    exemptPathCount: value.exemptPathCount,
    exemptPathsDigest: value.exemptPathsDigest,
    entries: Object.freeze(entries.map(entry => Object.freeze({
      path: entry.path,
      headMode: entry.headMode,
      headBlobSha: entry.headBlobSha,
      protectedMode: entry.protectedMode,
      protectedBlobSha: entry.protectedBlobSha,
    }))),
  });
}

export function normalizeProtectedMainSharedAncestorPathEquivalenceEvidence(
  value,
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      "Protected-main shared-ancestor path-equivalence evidence is malformed.",
    );
  }
  const keys = Object.keys(value).sort();
  const entries = Array.isArray(value.entries) ? value.entries : [];
  const paths = entries.map(entry => entry?.path);
  const invalid = (
    JSON.stringify(keys) !==
      JSON.stringify(SHARED_ANCESTOR_EVIDENCE_KEYS) ||
    value.schema !==
      PROTECTED_MAIN_SHARED_ANCESTOR_PATH_EQUIVALENCE_SCHEMA ||
    value.protectedMainRef !== PROTECTED_MAIN_REMOTE_REF ||
    !SHA_PATTERN.test(String(value.baseSha || "")) ||
    !SHA_PATTERN.test(String(value.headSha || "")) ||
    !SHA_PATTERN.test(String(value.headTreeSha || "")) ||
    !SHA_PATTERN.test(String(value.protectedMainSha || "")) ||
    !SHA_PATTERN.test(String(value.protectedMainTreeSha || "")) ||
    !SHA_PATTERN.test(String(value.sharedAncestorSha || "")) ||
    !SHA_PATTERN.test(String(value.sharedAncestorTreeSha || "")) ||
    !Array.isArray(value.entries) ||
    !Number.isSafeInteger(value.exemptPathCount) ||
    value.exemptPathCount < 0 ||
    value.exemptPathCount > RECOVERY_PATH_EVIDENCE_MAX_PATHS ||
    value.exemptPathCount !== entries.length ||
    Buffer.byteLength(paths.join("\0"), "utf8") >
      RECOVERY_PATH_EVIDENCE_MAX_BYTES ||
    value.exemptPathsDigest !== digestValue(paths) ||
    JSON.stringify(paths) !== JSON.stringify(normalizeExemptPaths(paths)) ||
    entries.some(entry => !validSharedAncestorEntry(entry))
  );
  if (invalid) {
    throw new Error(
      "Protected-main shared-ancestor path-equivalence evidence is malformed.",
    );
  }
  return Object.freeze({
    schema: value.schema,
    baseSha: value.baseSha,
    headSha: value.headSha,
    headTreeSha: value.headTreeSha,
    protectedMainRef: value.protectedMainRef,
    protectedMainSha: value.protectedMainSha,
    protectedMainTreeSha: value.protectedMainTreeSha,
    sharedAncestorSha: value.sharedAncestorSha,
    sharedAncestorTreeSha: value.sharedAncestorTreeSha,
    exemptPathCount: value.exemptPathCount,
    exemptPathsDigest: value.exemptPathsDigest,
    entries: Object.freeze(entries.map(entry => Object.freeze({
      path: entry.path,
      headMode: entry.headMode,
      headBlobSha: entry.headBlobSha,
      sharedAncestorMode: entry.sharedAncestorMode,
      sharedAncestorBlobSha: entry.sharedAncestorBlobSha,
    }))),
  });
}

export function readTreeBlobEntry({
  gitText,
  treeish,
  relativePath,
  label,
}) {
  const records = String(gitText([
    "ls-tree",
    "-z",
    treeish,
    "--",
    relativePath,
  ]) || "").split("\0").filter(Boolean);
  if (records.length !== 1) {
    throw new Error(`${label} does not contain exactly one tracked blob ${relativePath}.`);
  }
  const separator = records[0].indexOf("\t");
  const header = separator < 0 ? "" : records[0].slice(0, separator);
  const observedPath = separator < 0 ? "" : records[0].slice(separator + 1);
  const match = header.match(/^([0-7]{6}) (blob) ([0-9a-f]{40})$/);
  if (!match || !MODE_PATTERN.test(match[1]) || observedPath !== relativePath) {
    throw new Error(`${label} does not contain tracked blob ${relativePath}.`);
  }
  return Object.freeze({ mode: match[1], blobSha: match[3] });
}

function validEntry(entry) {
  return (
    entry &&
    typeof entry === "object" &&
    !Array.isArray(entry) &&
    JSON.stringify(Object.keys(entry).sort()) === JSON.stringify(ENTRY_KEYS) &&
    safePath(entry.path) &&
    MODE_PATTERN.test(String(entry.headMode || "")) &&
    MODE_PATTERN.test(String(entry.protectedMode || "")) &&
    SHA_PATTERN.test(String(entry.headBlobSha || "")) &&
    SHA_PATTERN.test(String(entry.protectedBlobSha || "")) &&
    entry.headMode === entry.protectedMode &&
    entry.headBlobSha === entry.protectedBlobSha
  );
}

function validSharedAncestorEntry(entry) {
  return (
    entry &&
    typeof entry === "object" &&
    !Array.isArray(entry) &&
    JSON.stringify(Object.keys(entry).sort()) ===
      JSON.stringify(SHARED_ANCESTOR_ENTRY_KEYS) &&
    safePath(entry.path) &&
    MODE_PATTERN.test(String(entry.headMode || "")) &&
    MODE_PATTERN.test(String(entry.sharedAncestorMode || "")) &&
    SHA_PATTERN.test(String(entry.headBlobSha || "")) &&
    SHA_PATTERN.test(String(entry.sharedAncestorBlobSha || "")) &&
    entry.headMode === entry.sharedAncestorMode &&
    entry.headBlobSha === entry.sharedAncestorBlobSha
  );
}

function resolveSingleSharedAncestor({ headSha, protectedMainSha, gitText }) {
  const candidates = String(gitText([
    "merge-base",
    "--all",
    headSha,
    protectedMainSha,
  ]) || "").trim().split(/\s+/).filter(Boolean);
  if (candidates.length !== 1 || !SHA_PATTERN.test(candidates[0])) {
    throw new Error(
      "Protected-main path equivalence requires exactly one shared ancestor.",
    );
  }
  return candidates[0];
}

function normalizeExemptPaths(values) {
  if (!Array.isArray(values)) {
    throw new Error("Protected-main equivalence exempt paths must be an array.");
  }
  for (const value of values) requireSafePath(value);
  return [...new Set(values)].sort();
}

function requireSafePath(value) {
  if (!safePath(value)) {
    throw new Error(`Protected-main equivalence path is unsafe: ${value}`);
  }
}

function safePath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.includes("\0") &&
    !value.includes("\\") &&
    !value.startsWith("/") &&
    value !== "." &&
    !value.split("/").some(part => !part || part === "." || part === "..")
  );
}

function requireSha(value, label) {
  if (!SHA_PATTERN.test(String(value || ""))) {
    throw new Error(`${label} must be an exact lowercase 40-character Git SHA.`);
  }
  return value;
}
