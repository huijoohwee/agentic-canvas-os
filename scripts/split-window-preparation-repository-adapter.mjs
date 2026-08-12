// Responsibility: provider-neutral repository capture and authority-fenced import ports.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { createBundle } from "./split-window-preparation-contract.mjs";
import { digestValue } from "./cloud-collaboration-primitives.mjs";

export function createPreparationSource({ repository, target, components, boundsPolicyDigest }) {
  const root = realDirectory(repository);
  return Object.freeze({ capture() {
    const before = captureRepositoryState(root); const payloads = new Map(); const artifacts = [];
    for (const component of components) {
      const file = safeRepositoryFile(root, component.path); const bytes = fs.readFileSync(file); const digest = sha256(bytes); payloads.set(digest, bytes);
      artifacts.push({ kind: component.kind, digest, sizeBytes: bytes.length, mediaType: component.mediaType,
        paths: component.declaredPaths || [] });
    }
    const after = captureRepositoryState(root); if (before.stateDigest !== after.stateDigest) throw new Error("Repository changed during capture.");
    const bundle = createBundle({ bundleId: digestValue({ source: before.stateDigest, target, artifacts }), source: {
      repositoryIdentityDigest: before.repositoryIdentityDigest, baseRevision: before.head,
      baseTreeDigest: before.tree, sourceStateDigest: before.stateDigest }, target,
      paths: components.flatMap(item => item.declaredPaths || []), artifacts, boundsPolicyDigest });
    return Object.freeze({ bundle, payloads, mutationAuthority: false });
  } });
}

export function createRepositoryImportTarget({ repository, store, authorityPort, verifierPort, clock = Date }) {
  const root = realDirectory(repository);
  return Object.freeze({
    inspect(bundle, input, authority = null) { const state = captureRepositoryState(root); return Object.freeze({ ...state,
      targetIdentityDigest: digestValue({ repositoryIdentityDigest: state.repositoryIdentityDigest, branch: state.branch,
        registrationDigest: state.registrationDigest }), authorityObservation: authority?.observation || authorityPort.observe(bundle, input) }); },
    preflight(bundle, observation) { return verifierPort.preflight({ root, bundle, observation, readPayload: digest => store.readPayload(bundle.bundleDigest, digest) }); },
    withJoinedMutationFence(bundle, input, callback) { return authorityPort.withJoinedMutationFence({ root, bundle, input, clock }, callback); },
    apply(bundle, before, input) { return authorityPort.applyPreparedBundle({ root, bundle, before, input,
      readPayload: digest => store.readPayload(bundle.bundleDigest, digest) }); },
    reconcile(bundle, before, input) { return authorityPort.reconcilePreparedBundle({ root, bundle, before, input,
      readPayload: digest => store.readPayload(bundle.bundleDigest, digest) }); },
    verify(bundle, applied, input, authority) { return verifierPort.verify({ root, bundle, applied, input, authority }); },
  });
}

export function assertExternalStoreIsolation({ storeRoot, repositoryRoots, commonDirectories, worktrees }) {
  const candidate = path.resolve(storeRoot); for (const boundary of [...repositoryRoots, ...commonDirectories, ...worktrees].map(value => path.resolve(value))) {
    if (candidate === boundary || candidate.startsWith(`${boundary}${path.sep}`) || boundary.startsWith(`${candidate}${path.sep}`)) {
      throw new Error("Split-window store is not isolated from a repository boundary.");
    }
  }
}

function captureRepositoryState(root) {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0" }; const git = args => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", env }).trim();
  const head = git(["rev-parse", "HEAD"]); const tree = git(["rev-parse", "HEAD^{tree}"]); const branch = git(["branch", "--show-current"]);
  const status = execFileSync("git", ["-C", root, "status", "--porcelain=v2", "-z", "--untracked-files=all"], { env });
  const common = fs.realpathSync(path.resolve(root, git(["rev-parse", "--git-common-dir"])));
  const gitDir = fs.realpathSync(path.resolve(root, git(["rev-parse", "--git-dir"])));
  const registration = targetWorktreeRecord(execFileSync("git", ["-C", root, "worktree", "list", "--porcelain", "-z"], { env }), root);
  const core = { repositoryIdentityDigest: digestValue({ common, origin: git(["remote", "get-url", "origin"]) }),
    head, tree, branch, statusDigest: sha256(status), registrationDigest: digestValue(registration), gitDirIdentityDigest: identityDigest(gitDir) };
  return Object.freeze({ ...core, stateDigest: digestValue(core) });
}
function safeRepositoryFile(root, relative) { if (path.isAbsolute(relative) || path.posix.normalize(relative) !== relative || relative.startsWith("../") || relative === ".git" || relative.startsWith(".git/")) throw new Error("Unsafe component path.");
  const file = path.join(root, relative); let current = root; for (const part of relative.split("/").slice(0, -1)) { current = path.join(current, part); if (fs.lstatSync(current).isSymbolicLink()) throw new Error("Component path has a symlink ancestor."); } return file; }
function identityDigest(value) { const stat = fs.lstatSync(value); return digestValue({ dev: String(stat.dev), ino: String(stat.ino), mode: stat.mode, birthtimeMs: stat.birthtimeMs }); }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function realDirectory(value) { const result = fs.realpathSync(value); if (!fs.statSync(result).isDirectory()) throw new Error("Repository root is not a directory."); return result; }
function targetWorktreeRecord(buffer, root) {
  const fields = buffer.toString("utf8").split("\0"); const records = []; let current = null;
  for (const field of fields) {
    if (field.startsWith("worktree ")) { if (current) records.push(current); current = { worktree: field.slice(9) }; }
    else if (field && current) { const offset = field.indexOf(" "); current[offset < 0 ? field : field.slice(0, offset)] = offset < 0 ? true : field.slice(offset + 1); }
  }
  if (current) records.push(current);
  const matches = records.filter(record => { try { return fs.realpathSync(record.worktree) === root; } catch { return false; } });
  if (matches.length !== 1) throw new Error("Target worktree registration is missing or ambiguous.");
  return matches[0];
}
