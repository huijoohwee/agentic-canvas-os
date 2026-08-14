// Responsibility: Capture bounded recovery evidence and expose one same-filesystem atomic rename port.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync,
  closeSync, fsyncSync, openSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import { RECOVERY_ARTIFACT_RETIREMENT_EVIDENCE_SCHEMA,
  normalizeRecoveryArtifactRetirementIntent,
  normalizeRecoveryArtifactRetirementReceipt } from "./recovery-artifact-retirement-contract.mjs";
import { normalizeRecoverableLaneCleanupIntent,
  normalizeRecoverableLaneCleanupReceipt,
  buildRecoverableLaneCleanupReceipt } from "./recoverable-lane-cleanup-contract.mjs";
import { createRecoveryArtifactRetirementStore } from "./recovery-artifact-retirement-store.mjs";

const MAX_ENTRIES = 20_000;
const MAX_BYTES = 512 * 1024 * 1024;

export function createRecoveryArtifactRetirementRepositoryAdapter({ repository, source,
  archiveRoot, subjectRepository, git = runGit, checkpoint = () => {} } = {}) {
  const owner = realDirectory(repository, "journal owner repository");
  const subject = realDirectory(subjectRepository, "subject repository");
  const sourcePath = normalizedAbsolute(source, "recovery source");
  const archive = realDirectory(archiveRoot, "archive root");
  const commonDir = realDirectory(resolveGitPath(owner,
    git(owner, ["rev-parse", "--git-common-dir"]).trim()), "Git common directory");
  const subjectCommonDir = realDirectory(resolveGitPath(subject,
    git(subject, ["rev-parse", "--git-common-dir"]).trim()), "subject Git common directory");
  assertPathIsolation({ owner, subject, sourcePath, archive, commonDir, subjectCommonDir });
  const storageKey = digestValue({ schema: "agentic-recovery-artifact-retirement-storage/v1",
    ownerIdentityDigest: identity(owner, commonDir, git).identityDigest, source: sourcePath });
  const store = createRecoveryArtifactRetirementStore({ commonDir, subjectKey: storageKey,
    normalizeIntent: normalizeRecoveryArtifactRetirementIntent,
    normalizeReceipt: normalizeRecoveryArtifactRetirementReceipt });
  const context = { owner, subject, sourcePath, archive, commonDir, subjectCommonDir, git };
  return Object.freeze({
    captureEvidence: () => captureEvidence(context),
    withSubjectFence: store.withSubjectFence,
    readIntent: store.readIntent, writeIntent: store.writeIntent,
    readReceipt: store.readReceipt, writeReceipt: store.writeReceipt,
    archive(plan) {
      const before = locate(plan); checkpoint("before-rename", before);
      if (before === "archive") return observe(plan);
      const fresh = captureEvidence(context);
      if (canonicalJson(fresh) !== canonicalJson(plan.evidence)) {
        throw new Error("Recovery evidence drifted immediately before archive rename.");
      }
      const sourceDevice = statSync(sourcePath).dev;
      const archiveDevice = statSync(archive).dev;
      if (sourceDevice !== archiveDevice) throw new Error("Recovery source and archive root are not on the same filesystem.");
      renameSync(sourcePath, plan.archivePath);
      syncDirectory(path.dirname(sourcePath));
      if (path.dirname(sourcePath) !== archive) syncDirectory(archive);
      checkpoint("after-rename", plan);
      return observe(plan);
    },
    observeArchive: observe,
  });
  function locate(plan) {
    const sourceExists = existsSync(sourcePath); const archiveExists = existsSync(plan.archivePath);
    if (sourceExists === archiveExists) throw new Error("Retirement requires exactly one of source or exact archive to exist.");
    return sourceExists ? "source" : "archive";
  }
  function observe(plan) {
    if (locate(plan) !== "archive") throw new Error("Recovery artifact has not reached its exact archive.");
    const live = buildManifest(plan.archivePath);
    if (live.manifestDigest !== plan.evidence.manifest.manifestDigest) throw new Error("Archived recovery manifest drifted.");
    validateArtifacts({ ...context, sourcePath: plan.archivePath }, live, plan.evidence.cleanup);
    return Object.freeze({ sourceAbsent: true, archivePath: plan.archivePath,
      archivePresent: true, manifestDigest: live.manifestDigest });
  }
}

function captureEvidence(context) {
  const { owner, subject, sourcePath, archive, commonDir, subjectCommonDir, git } = context;
  safeDirectory(sourcePath, "recovery source"); safeDirectory(archive, "archive root");
  if (realpathSync(sourcePath) !== sourcePath) throw new Error("Recovery source realpath differs from its requested path.");
  const canonicalStatus = git(subject, ["status", "--porcelain=v2", "-z", "--untracked-files=all"]);
  if (canonicalStatus) throw new Error("Subject canonical worktree must be clean.");
  const branch = git(subject, ["symbolic-ref", "--quiet", "HEAD"]).trim();
  if (branch !== "refs/heads/main") throw new Error("Subject repository must use its canonical main worktree.");
  if (sourcePath === archive || sourcePath.startsWith(`${archive}/`) || archive.startsWith(`${sourcePath}/`)) {
    throw new Error("Recovery source and archive root must be disjoint.");
  }
  const liveManifest = buildManifest(sourcePath);
  const subjectIdentity = identity(subject, subjectCommonDir, git);
  const cleanup = readCleanup(sourcePath, { subject, subjectCommonDir, subjectIdentity });
  const validated = validateArtifacts(context, liveManifest, cleanup);
  const canonicalSha = sha(git(subject, ["rev-parse", "refs/remotes/origin/main"]).trim(), "canonical SHA");
  const localMainSha = sha(git(subject, ["rev-parse", "refs/heads/main"]).trim(), "local main SHA");
  const headSha = sha(git(subject, ["rev-parse", "HEAD"]).trim(), "canonical HEAD");
  const remoteMainSha = remoteSha(subject, git);
  if (canonicalSha !== remoteMainSha || localMainSha !== canonicalSha || headSha !== canonicalSha) {
    throw new Error("Subject HEAD, local main, origin/main, and fresh remote main must be identical.");
  }
  const canonicalTreeSha = sha(git(subject, ["rev-parse", `${canonicalSha}^{tree}`]).trim(), "canonical tree");
  let disposition; let parentSha = null;
  if (isAncestor(subject, validated.bundle.headSha, canonicalSha, git)) disposition = "ancestor";
  else {
    const parents = git(subject, ["show", "-s", "--format=%P", validated.bundle.headSha]).trim().split(/\s+/u).filter(Boolean);
    if (parents.length !== 1) throw new Error("Unintegrated recovery head is not one single-parent coordination commit.");
    parentSha = sha(parents[0], "coordination parent");
    if (git(subject, ["rev-parse", `${parentSha}^{tree}`]).trim() !== validated.bundle.treeSha
      || !isAncestor(subject, parentSha, canonicalSha, git)) throw new Error("Recovery head is neither integrated nor empty coordination over integrated history.");
    disposition = "empty-coordination";
  }
  const core = {
    schema: RECOVERY_ARTIFACT_RETIREMENT_EVIDENCE_SCHEMA,
    owner: identity(owner, commonDir, git), subjectRepository: subjectIdentity,
    source: sourcePath, archiveRoot: archive, cleanup, manifest: liveManifest,
    bundle: validated.bundle,
    integration: { canonicalRef: "refs/remotes/origin/main", canonicalSha,
      canonicalTreeSha, remoteMainSha, headSha: validated.bundle.headSha,
      treeSha: validated.bundle.treeSha, disposition, parentSha },
  };
  return Object.freeze({ ...core, evidenceDigest: digestValue(core) });
}

function readCleanup(source, { subject, subjectCommonDir, subjectIdentity }) {
  const intentPath = path.join(source, "cleanup-intent.json");
  const receiptPath = path.join(source, "cleanup-receipt.json");
  const intentRaw = safeFile(intentPath, "cleanup intent");
  const intent = normalizeRecoverableLaneCleanupIntent(JSON.parse(intentRaw.toString("utf8")));
  if (!["complete", "reservation_released"].includes(intent.status)
    || intent.plan?.recovery?.directory !== source
    || intent.plan.evidence.repository.root !== subject
    || intent.plan.evidence.repository.gitCommonDir !== subjectCommonDir
    || intent.plan.evidence.repository.identityDigest !== subjectIdentity.identityDigest
    || intent.phases?.bundle_verified?.bundle?.path !== path.join(source, "lane.bundle")
    || intent.phases?.reservation_released?.release?.planDigest !== intent.planDigest) {
    throw new Error("Cleanup intent is incomplete, malformed, or not bound to this source.");
  }
  const receiptRaw = existsSync(receiptPath) ? safeFile(receiptPath, "cleanup receipt") : null;
  const receipt = receiptRaw ? normalizeRecoverableLaneCleanupReceipt(
    JSON.parse(receiptRaw.toString("utf8")),
  ) : null;
  if (intent.status === "complete") {
    const predecessorCore = { schema: intent.schema, status: "reservation_released",
      plan: intent.plan, planDigest: intent.planDigest, subjectKey: intent.subjectKey,
      authorizationDigest: intent.authorizationDigest,
      phases: Object.fromEntries(Object.entries(intent.phases).filter(([phase]) => phase !== "complete")) };
    const predecessor = normalizeRecoverableLaneCleanupIntent({
      ...predecessorCore, intentDigest: digestValue(predecessorCore),
    });
    const candidate = buildRecoverableLaneCleanupReceipt({
      intent: predecessor,
      bundle: intent.phases.bundle_verified.bundle,
      finalObservation: receipt?.finalObservation,
    });
    if (!receipt || canonicalJson(receipt) !== canonicalJson(candidate)
      || receipt.receiptDigest !== intent.phases?.complete?.receiptDigest) {
      throw new Error("Completed cleanup receipt does not join its intent.");
    }
  } else if (receipt) throw new Error("Reservation-released cleanup cannot carry an unjoined receipt.");
  const bundled = intent.phases.bundle_verified.bundle;
  const drift = intent.status === "reservation_released" ? digestValue({
    schema: "agentic-recovery-artifact-retirement-drift/v1",
    intentRawSha256: hash(intentRaw), intentDigest: intent.intentDigest,
    status: intent.status, releaseReceiptDigest: intent.phases.reservation_released.release.receiptDigest,
  }) : null;
  return Object.freeze({ kind: receipt ? "complete-receipt" : "reservation-released-journal",
    sourceDirectory: source, intentStatus: intent.status, intentRawSha256: hash(intentRaw),
    receiptRawSha256: receiptRaw ? hash(receiptRaw) : null, cleanupPlanDigest: intent.planDigest,
    subjectKey: intent.subjectKey, bundleSha256: bundled.sha256, headSha: bundled.headSha,
    treeSha: bundled.treeSha, headRef: bundled.headRef, requiredDriftAcknowledgement: drift });
}

function validateArtifacts({ subject, sourcePath, git }, manifest, cleanup) {
  if (manifest.entries.every(entry => entry.path !== "cleanup-intent.json")
    || manifest.entries.every(entry => entry.path !== "lane.bundle")) throw new Error("Recovery manifest lacks required artifacts.");
  const bundlePath = path.join(sourcePath, "lane.bundle");
  const bytes = safeFile(bundlePath, "recovery bundle");
  if (hash(bytes) !== cleanup.bundleSha256) throw new Error("Recovery bundle bytes differ from cleanup journal.");
  git(subject, ["bundle", "verify", bundlePath]);
  const heads = git(subject, ["bundle", "list-heads", bundlePath]).trim().split(/\r?\n/u);
  if (!heads.includes(`${cleanup.headSha} ${cleanup.headRef}`)) throw new Error("Recovery bundle lacks its exact cleanup head.");
  const tree = git(subject, ["rev-parse", `${cleanup.headSha}^{tree}`]).trim();
  if (tree !== cleanup.treeSha) throw new Error("Recovery bundle head tree differs from cleanup journal.");
  return { bundle: Object.freeze({ path: path.join(cleanup.sourceDirectory, "lane.bundle"),
    sha256: hash(bytes), sizeBytes: bytes.length, headSha: cleanup.headSha,
    treeSha: cleanup.treeSha, headRef: cleanup.headRef, verified: true }) };
}

function buildManifest(root) {
  const entries = []; let totalBytes = 0; const rootDevice = lstatSync(root).dev;
  function visit(directory, prefix = "") {
    const names = readdirSync(directory).sort();
    for (const name of names) {
      if (name === "." || name === "..") throw new Error("Unsafe recovery entry name.");
      const absolute = path.join(directory, name); const relative = prefix ? `${prefix}/${name}` : name;
      const stats = lstatSync(absolute);
      if (stats.isSymbolicLink() || (!stats.isDirectory() && !stats.isFile())) throw new Error(`Unsupported recovery artifact entry: ${relative}`);
      // Mounted subdirectories break the parent-directory rename guarantee, but some
      // Linux runners report file device ids differently for ordinary files.
      if (stats.isDirectory() && stats.dev !== rootDevice) throw new Error(`Recovery artifact crosses a filesystem mount: ${relative}`);
      if (stats.isFile() && stats.nlink !== 1) throw new Error(`Recovery artifact contains a hardlinked file: ${relative}`);
      if (entries.length >= MAX_ENTRIES) throw new Error("Recovery artifact manifest entry bound exceeded.");
      if (stats.isDirectory()) { entries.push({ path: relative, type: "directory", mode: stats.mode & 0o777, sizeBytes: 0, sha256: null }); visit(absolute, relative); }
      else { const bytes = safeFile(absolute, relative); totalBytes += bytes.length; if (totalBytes > MAX_BYTES) throw new Error("Recovery artifact byte bound exceeded.");
        entries.push({ path: relative, type: "file", mode: stats.mode & 0o777, sizeBytes: bytes.length, sha256: hash(bytes) }); }
    }
  }
  visit(root); entries.sort((a, b) => Buffer.compare(Buffer.from(a.path, "utf8"), Buffer.from(b.path, "utf8")));
  const core = { schema: "agentic-recovery-artifact-manifest/v1", entryCount: entries.length,
    fileCount: entries.filter(entry => entry.type === "file").length, totalBytes, entries };
  return Object.freeze({ ...core, manifestDigest: digestValue(core) });
}
function identity(root, commonDir, git) { const originUrl = git(root, ["remote", "get-url", "origin"]).trim();
  return Object.freeze({ root, gitCommonDir: commonDir, identityDigest: digestValue({ commonDir, originUrl }) }); }
function safeFile(file, label) { const stats = lstatSync(file); if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_BYTES) throw new Error(`${label} is unsafe or too large.`); return readFileSync(file); }
function safeDirectory(directory, label) { const stats = lstatSync(directory); if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error(`${label} is unsafe.`); }
function realDirectory(value, label) { const absolute = normalizedAbsolute(value, label); safeDirectory(absolute, label); return realpathSync(absolute); }
function normalizedAbsolute(value, label) { if (typeof value !== "string" || !path.isAbsolute(value) || path.normalize(value) !== value || value === path.parse(value).root || value.endsWith(path.sep)) throw new Error(`${label} must be one normalized non-root absolute path.`); return value; }
function resolveGitPath(root, value) { return path.isAbsolute(value) ? value : path.resolve(root, value); }
function hash(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function sha(value, label) { if (!/^[0-9a-f]{40}$/u.test(value)) throw new Error(`${label} is invalid.`); return value; }
function remoteSha(root, git) { const output = git(root, ["ls-remote", "--refs", "origin", "refs/heads/main"]).trim(); const [value, ref] = output.split(/\s+/u); if (ref !== "refs/heads/main") throw new Error("Fresh remote main is unavailable."); return sha(value, "remote main"); }
function isAncestor(root, older, newer, git) { try { git(root, ["merge-base", "--is-ancestor", older, newer]); return true; } catch (error) { if (error?.status === 1) return false; throw error; } }
function runGit(cwd, args) { return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }); }
function syncDirectory(directory) { const descriptor = openSync(directory, "r"); try { fsyncSync(descriptor); } finally { closeSync(descriptor); } }
function overlaps(left, right) { return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`); }
function assertPathIsolation({ owner, subject, sourcePath, archive, commonDir, subjectCommonDir }) {
  const sourceParent = path.dirname(sourcePath);
  const existingAncestor = nearestExistingAncestor(sourceParent);
  if (realpathSync(existingAncestor) !== existingAncestor) {
    throw new Error("Recovery source parent contains unresolved links.");
  }
  for (const protectedPath of new Set([owner, subject, commonDir, subjectCommonDir])) {
    if (overlaps(sourcePath, protectedPath) || overlaps(archive, protectedPath)) {
      throw new Error("Recovery source and archive must be outside repository and Git metadata paths.");
    }
  }
}
function nearestExistingAncestor(candidate) { let current = candidate; while (!existsSync(current)) { const parent = path.dirname(current); if (parent === current) throw new Error("Recovery source has no existing ancestor."); current = parent; } return current; }
