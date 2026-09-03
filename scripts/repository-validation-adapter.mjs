// Responsibility: Seal and execute one closed, repository-neutral validation policy.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
export const REPOSITORY_VALIDATION_POLICY_SCHEMA = "agentic-repository-validation-policy/v2";
export const REPOSITORY_VALIDATION_RESULT_SCHEMA = "agentic-repository-validation-result/v2";
export const REPOSITORY_VALIDATION_ADAPTERS = Object.freeze(["git-content/v1", "npm-check/v1"]);
export const REPOSITORY_VALIDATION_BOUNDS = Object.freeze({
  maxEntries: 256, maxFileBytes: 1_048_576, maxTotalBytes: 8_388_608,
  maxGitOutputBytes: 16_777_216, maxCommandOutputBytes: 1_048_576, timeoutMs: 600_000,
});
const MODES = new Set(["precommit", "postcommit"]);
const SOURCES = new Set(["git-blob", "working-tree"]);
const REGULAR_MODES = new Set(["100644", "100755"]);
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const MARKDOWN = /\.(?:md|markdown)$/iu;
const CONFLICT_MARKER = /^(?:<<<<<<<(?: |$)|=======\s*$|>>>>>>>(?: |$))/mu;
const UTF8 = new TextDecoder("utf-8", { fatal: true });
const RECOGNIZED_MANIFESTS = new Set([
  "Cargo.toml", "Gemfile", "Pipfile", "build.gradle", "build.gradle.kts",
  "bun.lock", "bun.lockb", "composer.json", "deno.json", "deno.jsonc", "go.mod",
  "npm-shrinkwrap.json", "package-lock.json", "package.json", "pnpm-lock.yaml",
  "poetry.lock", "pom.xml", "pyproject.toml", "requirements.txt", "yarn.lock",
]);
const COMMANDS = Object.freeze({
  "git-content/v1": null,
  "npm-check/v1": Object.freeze({ executable: "npm", argv: Object.freeze(["run", "check"]), shell: false }),
});
export function buildRepositoryValidationPolicy(input) {
  exactKeys(input, ["adapter", "baseSha", "candidateSha", "candidateTreeSha", "entries", "manifest", "mode"],
    "repository validation policy input");
  return sealPolicy(input);
}
export function normalizeRepositoryValidationPolicy(value) {
  exactKeys(value, ["adapter", "baseSha", "candidateSha", "candidateTreeSha", "command", "entries",
    "entriesDigest", "limits", "manifest", "manifestDigest", "mode", "policyDigest", "schema"],
  "repository validation policy");
  const rebuilt = sealPolicy(value);
  if (canonicalJson(value) !== canonicalJson(rebuilt)) {
    throw new Error("Repository validation policy is invalid or drifted.");
  }
  return rebuilt;
}
export function runRepositoryValidation({ repository, policy: policyValue } = {}, dependencies = {}) {
  const policy = normalizeRepositoryValidationPolicy(policyValue);
  const execute = dependencies.execute || defaultExecute;
  const root = repositoryRoot(repository, execute);
  const before = observeRepository({ root, policy, execute });
  const validation = policy.adapter === "npm-check/v1"
    ? runNpmCheck({ root, policy, execute })
    : contentValidation(before.entries);
  const after = observeRepository({ root, policy, execute });
  if (before.invariantDigest !== after.invariantDigest
    || before.subjectDigest !== after.subjectDigest) {
    throw new Error("Repository validation subject drifted during validation.");
  }
  const invariants = Object.freeze({
    beforeDigest: before.invariantDigest,
    afterDigest: after.invariantDigest,
    unchanged: true,
  });
  return sealResult({
    adapter: policy.adapter,
    mode: policy.mode,
    baseSha: policy.baseSha,
    candidateSha: policy.candidateSha,
    candidateTreeSha: policy.candidateTreeSha,
    policyDigest: policy.policyDigest,
    entriesDigest: policy.entriesDigest,
    manifestDigest: policy.manifestDigest,
    validation,
    invariants,
  });
}
export function normalizeRepositoryValidationResult(value) {
  exactKeys(value, ["adapter", "baseSha", "candidateSha", "candidateTreeSha", "entriesDigest",
    "invariants", "manifestDigest", "mode", "policyDigest", "receiptDigest", "schema", "status",
    "validation"], "repository validation result");
  if (value.schema !== REPOSITORY_VALIDATION_RESULT_SCHEMA || value.status !== "passed") {
    throw new Error("Repository validation result is not a passed v2 receipt.");
  }
  const adapter = adapterId(value.adapter);
  const mode = validationMode(value.mode);
  const core = {
    schema: REPOSITORY_VALIDATION_RESULT_SCHEMA,
    status: "passed",
    adapter,
    mode,
    baseSha: gitSha(value.baseSha, "result base SHA"),
    candidateSha: gitSha(value.candidateSha, "result candidate SHA"),
    candidateTreeSha: gitSha(value.candidateTreeSha, "result candidate tree SHA"),
    policyDigest: sha256(value.policyDigest, "result policy digest"),
    entriesDigest: sha256(value.entriesDigest, "result entries digest"),
    manifestDigest: sha256(value.manifestDigest, "result manifest digest"),
    validation: normalizeValidation(value.validation, adapter),
    invariants: normalizeInvariants(value.invariants),
  };
  if (value.receiptDigest !== digestValue(core)) {
    throw new Error("Repository validation result digest is invalid.");
  }
  return deepFreeze({ ...core, receiptDigest: value.receiptDigest });
}
function sealPolicy(input) {
  const adapter = adapterId(input.adapter);
  const mode = validationMode(input.mode);
  const entries = normalizeEntries(input.entries);
  const sources = new Set(entries.map(entry => entry.source));
  if (sources.size !== 1) throw new Error("Repository validation entries cannot mix sources.");
  const expectedSource = mode === "precommit" ? "working-tree" : "git-blob";
  if (!sources.has(expectedSource)) {
    throw new Error(`Repository validation ${mode} entries must use ${expectedSource}.`);
  }
  const baseSha = gitSha(input.baseSha, "validation base SHA");
  const candidateSha = gitSha(input.candidateSha, "validation candidate SHA");
  if (mode === "precommit" && baseSha !== candidateSha) {
    throw new Error("Precommit validation requires base and candidate to be exact HEAD.");
  }
  if (adapter === "git-content/v1" && entries.some(entry => !MARKDOWN.test(entry.path))) {
    throw new Error("git-content/v1 accepts only Markdown paths.");
  }
  if (adapter === "npm-check/v1" && mode !== "postcommit") {
    throw new Error("npm-check/v1 accepts only an exact committed candidate.");
  }
  const manifest = normalizeManifest(input.manifest, adapter);
  const command = COMMANDS[adapter];
  const core = {
    schema: REPOSITORY_VALIDATION_POLICY_SCHEMA,
    adapter,
    mode,
    baseSha,
    candidateSha,
    candidateTreeSha: gitSha(input.candidateTreeSha, "validation candidate tree SHA"),
    entries,
    entriesDigest: digestValue(entries),
    manifest,
    manifestDigest: digestValue(manifest),
    command,
    limits: REPOSITORY_VALIDATION_BOUNDS,
  };
  return deepFreeze({ ...core, policyDigest: digestValue(core) });
}
function normalizeEntries(value) {
  if (!Array.isArray(value) || value.length === 0
    || value.length > REPOSITORY_VALIDATION_BOUNDS.maxEntries) {
    throw new Error(`Validation entries must contain 1-${REPOSITORY_VALIDATION_BOUNDS.maxEntries} files.`);
  }
  const entries = value.map((entry, index) => normalizeEntry(entry, `entries[${index}]`));
  entries.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  if (new Set(entries.map(entry => entry.path)).size !== entries.length
    || new Set(entries.map(entry => entry.path.toLocaleLowerCase("en-US"))).size !== entries.length) {
    throw new Error("Validation entries contain duplicate or case-colliding paths.");
  }
  const total = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (total > REPOSITORY_VALIDATION_BOUNDS.maxTotalBytes) {
    throw new Error("Validation entries exceed the aggregate byte bound.");
  }
  return Object.freeze(entries);
}
function normalizeEntry(value, label) {
  exactKeys(value, ["blobSha", "contentDigest", "mode", "path", "size", "source"], label);
  const source = SOURCES.has(value.source) ? value.source : invalid(`${label} source is unsupported.`);
  const mode = String(value.mode || "");
  if (!REGULAR_MODES.has(mode)) {
    throw new Error(`${label} must be a regular Git file, not a symlink or submodule.`);
  }
  const size = boundedInteger(value.size, `${label} size`, REPOSITORY_VALIDATION_BOUNDS.maxFileBytes);
  return Object.freeze({
    path: repositoryPath(value.path, `${label} path`),
    source,
    mode,
    blobSha: gitSha(value.blobSha, `${label} blob SHA`),
    contentDigest: sha256(value.contentDigest, `${label} content digest`),
    size,
  });
}
function normalizeManifest(value, adapter) {
  if (adapter === "git-content/v1") {
    if (value !== null) throw new Error("git-content/v1 requires an exact no-manifest policy.");
    return null;
  }
  exactKeys(value, ["packageJson", "packageLock"], "npm manifest");
  const packageJson = normalizeEntry(value.packageJson, "npm manifest packageJson");
  const packageLock = normalizeEntry(value.packageLock, "npm manifest packageLock");
  if (packageJson.path !== "package.json" || packageLock.path !== "package-lock.json"
    || packageJson.source !== "git-blob" || packageLock.source !== "git-blob") {
    throw new Error("npm-check/v1 requires exact root package.json and package-lock.json Git blobs.");
  }
  return Object.freeze({ packageJson, packageLock });
}
function observeRepository({ root, policy, execute }) {
  const headSha = gitText(execute, root, ["rev-parse", "HEAD"]);
  const headTreeSha = gitText(execute, root, ["rev-parse", "HEAD^{tree}"]);
  if (headSha !== policy.candidateSha || headTreeSha !== policy.candidateTreeSha) {
    throw new Error("Validation candidate is not the exact repository HEAD and tree.");
  }
  if (!isAncestor(execute, root, policy.baseSha, policy.candidateSha)) {
    throw new Error("Validation base is not an ancestor of the candidate.");
  }
  const status = gitBuffer(execute, root, ["status", "--porcelain=v2", "-z", "--untracked-files=all"]);
  const unmerged = gitBuffer(execute, root, ["ls-files", "-u", "-z"]);
  if (unmerged.length > 0) throw new Error("Repository contains unmerged entries.");
  const ignored = observeIgnoredState(execute, root);
  const manifestPaths = recognizedManifestPaths(execute, root, policy.candidateSha, status,
    ignored.entries.map(entry => entry.path));
  const entries = policy.mode === "precommit"
    ? observeWorkingTreeEntries({ execute, root, policy, status })
    : observeGitEntries({ execute, root, policy, status });
  validateAdapterSelection({ policy, entries, manifestPaths });
  const subject = {
    headSha,
    headTreeSha,
    entries: entries.map(entry => entry.observed),
    manifestPaths,
    manifest: observeManifest(policy, entries, execute, root),
  };
  const invariant = {
    headSha,
    headTreeSha,
    statusDigest: digestBytes(status),
    statusBytes: status.length,
    unmergedDigest: digestBytes(unmerged),
    ignoredDigest: ignored.digest,
  };
  return deepFreeze({
    entries,
    invariantDigest: digestValue(invariant),
    subjectDigest: digestValue(subject),
  });
}
function observeGitEntries({ execute, root, policy, status }) {
  if (status.length !== 0) throw new Error("Postcommit validation requires a clean repository.");
  const changedPaths = nullList(gitBuffer(execute, root,
    ["diff", "--name-only", "-z", "--no-renames", policy.baseSha, policy.candidateSha, "--"]),
  "changed path");
  requireExactPathSet(changedPaths, policy.entries.map(entry => entry.path));
  return policy.entries.map(expected => {
    const record = gitBuffer(execute, root,
      ["ls-tree", "-z", policy.candidateSha, "--", expected.path]);
    const observedTree = parseTreeRecord(record, expected.path);
    const size = Number(gitText(execute, root, ["cat-file", "-s", observedTree.blobSha]));
    if (!Number.isSafeInteger(size) || size > REPOSITORY_VALIDATION_BOUNDS.maxFileBytes) {
      throw new Error(`Validation file exceeds its byte bound: ${expected.path}`);
    }
    const bytes = gitBuffer(execute, root, ["cat-file", "blob", observedTree.blobSha]);
    const observed = { ...observedTree, source: "git-blob", contentDigest: digestBytes(bytes), size };
    requireEntry(expected, observed);
    return { observed: Object.freeze(observed), bytes };
  });
}
function observeWorkingTreeEntries({ execute, root, policy, status }) {
  const records = nullList(status, "status entry");
  if (records.some(record => !record.startsWith("? "))) {
    throw new Error("Precommit validation accepts only exact untracked files.");
  }
  const paths = records.map(record => repositoryPath(record.slice(2), "untracked path"));
  requireExactPathSet(paths, policy.entries.map(entry => entry.path));
  return policy.entries.map(expected => {
    const file = readSecureWorkingTreeFile(root, expected.path);
    const bytes = file.bytes;
    const blobSha = gitText(execute, root, ["hash-object", "--no-filters", "--stdin"], bytes);
    const observed = {
      path: expected.path,
      source: "working-tree",
      mode: file.mode,
      blobSha,
      contentDigest: digestBytes(bytes),
      size: bytes.length,
    };
    requireEntry(expected, observed);
    return { observed: Object.freeze(observed), bytes };
  });
}
function validateAdapterSelection({ policy, entries, manifestPaths }) {
  if (policy.adapter === "git-content/v1") {
    if (manifestPaths.length > 0) {
      throw new Error("git-content/v1 is forbidden when a recognized repository manifest exists.");
    }
    for (const entry of entries) validateMarkdown(entry.observed.path, entry.bytes);
    return;
  }
  if (canonicalJson(manifestPaths) !== canonicalJson(["package-lock.json", "package.json"])) {
    throw new Error("npm-check/v1 requires exactly root package.json and package-lock.json manifests.");
  }
}
function observeManifest(policy, entries, execute, root) {
  if (policy.manifest === null) return null;
  const available = new Map(entries.map(entry => [entry.observed.path, entry]));
  const observe = expected => {
    const selected = available.get(expected.path);
    if (!selected) return observeOneGitBlob({ execute, root, candidateSha: policy.candidateSha, expected });
    requireEntry(expected, selected.observed);
    return selected;
  };
  const packageJson = observe(policy.manifest.packageJson);
  const packageLock = observe(policy.manifest.packageLock);
  validateJsonManifest(packageJson.bytes, "package.json", true);
  validateJsonManifest(packageLock.bytes, "package-lock.json", false);
  return { packageJson: packageJson.observed, packageLock: packageLock.observed };
}
function observeOneGitBlob({ execute, root, candidateSha, expected }) {
  const tree = parseTreeRecord(gitBuffer(execute, root,
    ["ls-tree", "-z", candidateSha, "--", expected.path]), expected.path);
  const size = Number(gitText(execute, root, ["cat-file", "-s", tree.blobSha]));
  if (!Number.isSafeInteger(size) || size > REPOSITORY_VALIDATION_BOUNDS.maxFileBytes) {
    throw new Error(`Manifest exceeds its byte bound: ${expected.path}`);
  }
  const bytes = gitBuffer(execute, root, ["cat-file", "blob", tree.blobSha]);
  const observed = { ...tree, source: "git-blob", contentDigest: digestBytes(bytes), size };
  requireEntry(expected, observed);
  return { observed, bytes };
}
function observeIgnoredState(execute, root) {
  const capture = () => {
    const paths = nullList(gitBuffer(execute, root,
      ["ls-files", "--others", "--ignored", "--exclude-standard", "-z", "--"]), "ignored path")
      .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
    if (paths.length > REPOSITORY_VALIDATION_BOUNDS.maxEntries
      || new Set(paths.map(value => value.toLocaleLowerCase("en-US"))).size !== paths.length) {
      throw new Error("Ignored inventory exceeds its bound or contains path collisions.");
    }
    let totalBytes = 0;
    const entries = paths.map(filePath => {
      const file = readSecureWorkingTreeFile(root, filePath);
      totalBytes += file.bytes.length;
      if (totalBytes > REPOSITORY_VALIDATION_BOUNDS.maxTotalBytes) {
        throw new Error("Ignored inventory exceeds its aggregate byte bound.");
      }
      return { path: filePath, mode: file.mode, size: file.bytes.length,
        contentDigest: digestBytes(file.bytes) };
    });
    return { entries, totalBytes, digest: digestValue(entries) };
  };
  const before = capture();
  const after = capture();
  if (before.digest !== after.digest) throw new Error("Ignored repository state is unstable.");
  return after;
}
function recognizedManifestPaths(execute, root, candidateSha, status, ignoredPaths) {
  const treePaths = nullList(gitBuffer(execute, root,
    ["ls-tree", "-r", "-z", "--name-only", candidateSha, "--"]), "tree path");
  const untracked = nullList(status, "status entry")
    .filter(record => record.startsWith("? "))
    .map(record => repositoryPath(record.slice(2), "untracked path"));
  return [...new Set([...treePaths, ...untracked, ...ignoredPaths]
    .filter(candidate => RECOGNIZED_MANIFESTS.has(path.posix.basename(candidate))))]
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
}
function runNpmCheck({ root, policy, execute }) {
  const command = policy.command;
  try {
    execute(command.executable, [...command.argv], {
      cwd: root,
      encoding: null,
      maxBuffer: policy.limits.maxCommandOutputBytes,
      shell: false,
      timeout: policy.limits.timeoutMs,
    });
  } catch {
    throw new Error("npm-check/v1 command failed or exceeded its closed execution bounds.");
  }
  const core = { kind: "command", command, exitCode: 0 };
  return Object.freeze({ ...core, executionDigest: digestValue(core) });
}
function contentValidation(entries) {
  const projection = entries.map(({ observed }) => ({
    path: observed.path,
    mode: observed.mode,
    blobSha: observed.blobSha,
    contentDigest: observed.contentDigest,
    size: observed.size,
  }));
  return Object.freeze({
    kind: "content",
    checkedEntries: projection.length,
    checkedBytes: projection.reduce((sum, entry) => sum + entry.size, 0),
    contentDigest: digestValue(projection),
  });
}
function validateMarkdown(filePath, bytes) {
  if (!MARKDOWN.test(filePath)) throw new Error(`Non-Markdown path is not content-validatable: ${filePath}`);
  if (bytes.includes(0)) throw new Error(`Markdown file contains NUL or binary content: ${filePath}`);
  let text;
  try { text = UTF8.decode(bytes); } catch { throw new Error(`Markdown file is not bounded UTF-8 text: ${filePath}`); }
  if (CONFLICT_MARKER.test(text)) throw new Error(`Markdown file contains conflict markers: ${filePath}`);
}
function validateJsonManifest(bytes, label, requireCheck) {
  if (bytes.includes(0)) throw new Error(`${label} contains binary content.`);
  let value;
  try { value = JSON.parse(UTF8.decode(bytes)); } catch { throw new Error(`${label} is not valid bounded UTF-8 JSON.`); }
  if (requireCheck && (typeof value?.scripts?.check !== "string" || !value.scripts.check.trim())) {
    throw new Error("package.json does not define one npm check script.");
  }
}
function parseTreeRecord(buffer, expectedPath) {
  const records = nullList(buffer, "tree entry");
  if (records.length !== 1) throw new Error(`Candidate path is missing or ambiguous: ${expectedPath}`);
  const tab = records[0].indexOf("\t");
  const header = records[0].slice(0, tab).split(" ");
  const observedPath = tab >= 0 ? repositoryPath(records[0].slice(tab + 1), "tree path") : null;
  if (header.length !== 3 || header[1] !== "blob" || observedPath !== expectedPath) {
    throw new Error(`Candidate path is not one regular blob: ${expectedPath}`);
  }
  if (!REGULAR_MODES.has(header[0])) {
    throw new Error(`Candidate path is a symlink, submodule, or unsupported mode: ${expectedPath}`);
  }
  return { path: observedPath, mode: header[0], blobSha: gitSha(header[2], "tree blob SHA") };
}
function readSecureWorkingTreeFile(root, relativePath) {
  if (!Number.isInteger(constants.O_NOFOLLOW)) throw new Error("Secure validation requires O_NOFOLLOW.");
  let current = root;
  const segments = relativePath.split("/");
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    const ancestor = lstatSync(current, { bigint: true });
    if (!ancestor.isDirectory() || ancestor.isSymbolicLink()) {
      throw new Error(`Working-tree path contains a symlink or non-directory: ${relativePath}`);
    }
  }
  const absolute = path.join(current, segments.at(-1));
  const before = lstatSync(absolute, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || realpathSync(absolute) !== absolute) {
    throw new Error(`Working-tree path contains a symlink or is not one canonical regular file: ${relativePath}`);
  }
  const descriptor = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || stableStat(opened) !== stableStat(before)) {
      throw new Error(`Working-tree path changed before secure read: ${relativePath}`);
    }
    const maximum = REPOSITORY_VALIDATION_BOUNDS.maxFileBytes;
    if (opened.size > BigInt(maximum)) throw new Error(`Validation file exceeds its byte bound: ${relativePath}`);
    const storage = Buffer.allocUnsafe(maximum + 1);
    let length = 0;
    while (length < storage.length) {
      const count = readSync(descriptor, storage, length, storage.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length > maximum) throw new Error(`Validation file exceeds its byte bound: ${relativePath}`);
    const after = fstatSync(descriptor, { bigint: true });
    const atPath = lstatSync(absolute, { bigint: true });
    if (stableStat(opened) !== stableStat(after) || stableStat(after) !== stableStat(atPath)
      || after.size !== BigInt(length) || realpathSync(absolute) !== absolute) {
      throw new Error(`Working-tree path changed during secure read: ${relativePath}`);
    }
    return { bytes: storage.subarray(0, length), mode: Number(after.mode & 0o111n) ? "100755" : "100644" };
  } finally { closeSync(descriptor); }
}
function stableStat(value) {
  return [value.dev, value.ino, value.mode, value.size, value.mtimeNs, value.ctimeNs].join(":");
}
function requireEntry(expected, observed) {
  if (canonicalJson(expected) !== canonicalJson(observed)) {
    throw new Error(`Validation path, source, mode, blob, content, or size drifted: ${expected.path}`);
  }
}
function requireExactPathSet(observed, expected) {
  const sorted = values => [...values].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  if (canonicalJson(sorted(observed)) !== canonicalJson(sorted(expected))) {
    throw new Error("Validation policy does not close the exact changed path set.");
  }
}
function repositoryRoot(value, execute) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new Error("Validation repository must be an absolute path.");
  }
  const resolved = path.resolve(value);
  const stat = lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(resolved) !== resolved) {
    throw new Error("Validation repository must be one physical non-symlink directory.");
  }
  const top = realpathSync(gitText(execute, resolved, ["rev-parse", "--show-toplevel"]));
  if (top !== resolved) throw new Error("Validation repository must be the exact Git worktree root.");
  return resolved;
}
function isAncestor(execute, root, baseSha, candidateSha) {
  try {
    gitBuffer(execute, root, ["merge-base", "--is-ancestor", baseSha, candidateSha]);
    return true;
  } catch (error) {
    if (error?.status === 1) return false;
    throw new Error("Unable to prove validation base ancestry.");
  }
}
function gitText(execute, root, args, input) {
  return UTF8.decode(gitBuffer(execute, root, args, input)).trim();
}
function gitBuffer(execute, root, args, input) {
  const value = execute("git", args, {
    cwd: root,
    encoding: null,
    input,
    maxBuffer: REPOSITORY_VALIDATION_BOUNDS.maxGitOutputBytes,
    shell: false,
    timeout: REPOSITORY_VALIDATION_BOUNDS.timeoutMs,
  });
  return Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ""));
}
function defaultExecute(command, args, options) {
  return execFileSync(command, args, options);
}
function nullList(buffer, label) {
  if (buffer.length === 0) return [];
  if (buffer[buffer.length - 1] !== 0) throw new Error(`${label} output is not NUL-terminated.`);
  let decoded;
  try { decoded = UTF8.decode(buffer.subarray(0, -1)); }
  catch { throw new Error(`${label} output is not canonical UTF-8.`); }
  return decoded.split("\0").map(value => {
    if (label === "status entry" || label === "tree entry") {
      if (!value || value !== value.normalize("NFC") || Buffer.byteLength(value) > 2_048) {
        throw new Error(`${label} is malformed or exceeds its bound.`);
      }
      return value;
    }
    return repositoryPath(value, label);
  });
}
function repositoryPath(value, label) {
  if (typeof value !== "string" || value.length === 0 || value !== value.normalize("NFC")
    || value.includes("\\") || value.includes("\0") || /[\u0000-\u001f\u007f]/u.test(value)
    || Buffer.byteLength(value) > 1_024) throw new Error(`${label} is not a canonical repository path.`);
  if (value.startsWith("/") || /^[A-Za-z]:/u.test(value)) throw new Error(`${label} must be relative.`);
  const segments = value.split("/");
  if (segments.some(segment => !segment || segment === "." || segment === "..")) {
    throw new Error(`${label} contains traversal or empty segments.`);
  }
  return value;
}
function sealResult(value) {
  const core = { schema: REPOSITORY_VALIDATION_RESULT_SCHEMA, status: "passed", ...value };
  return normalizeRepositoryValidationResult({ ...core, receiptDigest: digestValue(core) });
}
function normalizeValidation(value, adapter) {
  if (adapter === "npm-check/v1") {
    exactKeys(value, ["command", "executionDigest", "exitCode", "kind"], "command validation");
    if (value.kind !== "command" || value.exitCode !== 0
      || canonicalJson(value.command) !== canonicalJson(COMMANDS[adapter])) {
      throw new Error("Command validation result is invalid.");
    }
    const core = { kind: "command", command: COMMANDS[adapter], exitCode: 0 };
    if (value.executionDigest !== digestValue(core)) throw new Error("Command execution digest is invalid.");
    return Object.freeze({ ...core, executionDigest: value.executionDigest });
  }
  exactKeys(value, ["checkedBytes", "checkedEntries", "contentDigest", "kind"], "content validation");
  if (value.kind !== "content") throw new Error("Content validation result is invalid.");
  const checkedEntries = boundedInteger(
    value.checkedEntries,
    "checked entries",
    REPOSITORY_VALIDATION_BOUNDS.maxEntries,
  );
  if (checkedEntries === 0) throw new Error("Content validation result must cover at least one entry.");
  return Object.freeze({
    kind: "content",
    checkedEntries,
    checkedBytes: boundedInteger(value.checkedBytes, "checked bytes", REPOSITORY_VALIDATION_BOUNDS.maxTotalBytes),
    contentDigest: sha256(value.contentDigest, "content validation digest"),
  });
}
function normalizeInvariants(value) {
  exactKeys(value, ["afterDigest", "beforeDigest", "unchanged"], "repository invariants");
  const beforeDigest = sha256(value.beforeDigest, "before invariant digest");
  const afterDigest = sha256(value.afterDigest, "after invariant digest");
  if (value.unchanged !== true || beforeDigest !== afterDigest) {
    throw new Error("Repository validation invariants are not unchanged.");
  }
  return Object.freeze({ beforeDigest, afterDigest, unchanged: true });
}
function adapterId(value) {
  if (!REPOSITORY_VALIDATION_ADAPTERS.includes(value)) throw new Error("Repository validation adapter is unsupported.");
  return value;
}
function validationMode(value) { if (!MODES.has(value)) throw new Error("Repository validation mode is unsupported."); return value; }
function gitSha(value, label) { if (!SHA.test(String(value || ""))) throw new Error(`${label} is invalid.`); return value; }
function sha256(value, label) { if (!DIGEST.test(String(value || ""))) throw new Error(`${label} is invalid.`); return value; }
function boundedInteger(value, label, maximum) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new Error(`${label} is out of bounds.`);
  return value;
}
function digestBytes(value) { return createHash("sha256").update(value).digest("hex"); }
function invalid(message) { throw new Error(message); }
function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) {
    throw new Error(`${label} has unexpected or missing fields.`);
  }
}
function deepFreeze(value) {
  if (value && typeof value === "object" && !ArrayBuffer.isView(value) && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}
