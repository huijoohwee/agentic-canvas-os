// Responsibility: Persist private external plans and journals with inode-bound durable CAS.
import { execFileSync } from "node:child_process";
import {
  closeSync, existsSync, fstatSync, fsyncSync, lstatSync, openSync,
  readFileSync, realpathSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { withPrivateOperationLock } from "./private-operation-lock.mjs";
import { normalizeDormantOwnerContinuationJournal }
  from "./successor-rollover-dormant-owner-continuation-contract.mjs";

export function readPrivateContinuationJson(file, label, { forbiddenRoots = [] } = {}) {
  const target = requireExternalPath(file, forbiddenRoots, label).target;
  const stat = lstatSync(target);
  requirePrivateFile(stat, label);
  return JSON.parse(readFileSync(target, "utf8"));
}

export function writePrivateContinuationJsonExclusive(
  file,
  value,
  { forbiddenRoots = [] } = {},
) {
  const target = requireExternalPath(file, forbiddenRoots, "private output").target;
  const descriptor = openSync(target, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  syncDirectory(path.dirname(target));
  return target;
}

export function createDormantOwnerContinuationJournalStore({
  journalPath,
  forbiddenRoots = [],
} = {}) {
  const initial = requireExternalPath(journalPath, forbiddenRoots, "continuation journal");
  const target = initial.target;
  const parentIdentity = initial.parentIdentity;
  const canonicalForbiddenRoots = forbiddenRoots.map(root => realpathSync(path.resolve(root)));
  const lockPath = stableLockPath(target, parentIdentity);
  function currentTarget() {
    const current = requireExternalPath(
      journalPath,
      forbiddenRoots,
      "continuation journal",
    );
    if (current.target !== target || !sameIdentity(current.parentIdentity, parentIdentity)) {
      throw new Error("Continuation journal parent directory identity changed.");
    }
    return current.target;
  }
  function read() {
    const current = currentTarget();
    if (!existsSync(current)) return null;
    return normalizeDormantOwnerContinuationJournal(readPrivateContinuationJson(
      current,
      "continuation journal",
      { forbiddenRoots },
    ));
  }
  async function write(value, expectedDigest = null) {
    const journal = normalizeDormantOwnerContinuationJournal(value);
    currentTarget();
    execFileSync(process.execPath, [fileURLToPath(import.meta.url), "--internal-cas"], {
      cwd: path.dirname(target),
      input: JSON.stringify({
        targetName: path.basename(target),
        targetDigest: digestValue(target),
        parentIdentity,
        forbiddenRoots: canonicalForbiddenRoots,
        lockPath,
        expectedDigest,
        journal,
      }),
      encoding: "utf8",
      stdio: ["pipe", "ignore", "pipe"],
      maxBuffer: 4 * 1024 * 1024,
    });
    currentTarget();
    return journal;
  }
  return Object.freeze({ path: target, lockPath, read, write });
}

async function internalCas() {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const targetName = String(input.targetName || "");
  if (targetName !== path.basename(targetName) || [".", "..", ""].includes(targetName)) {
    throw new Error("Continuation journal anchored target name is invalid.");
  }
  const parentIdentity = normalizeIdentity(input.parentIdentity);
  const forbiddenRoots = normalizeForbiddenRoots(input.forbiddenRoots);
  requireCwdExternalIdentity(parentIdentity, forbiddenRoots);
  const journal = normalizeDormantOwnerContinuationJournal(input.journal);
  await withPrivateOperationLock({
    file: String(input.lockPath || ""),
    context: {
      operation: "successor-rollover-dormant-owner-continuation-journal-cas",
      targetDigest: String(input.targetDigest || ""),
      expectedDigest: input.expectedDigest ?? null,
      parentIdentity,
    },
    action: async () => {
      requireCwdExternalIdentity(parentIdentity, forbiddenRoots);
      const current = readAnchoredJournal(targetName);
      if ((current?.journalDigest ?? null) !== (input.expectedDigest ?? null)) {
        throw new Error("Continuation journal changed before private compare-and-swap.");
      }
      const temporary = `.${targetName}.${process.pid}.${Date.now()}.tmp`;
      let descriptor;
      try {
        requireCwdExternalIdentity(parentIdentity, forbiddenRoots);
        descriptor = openSync(temporary, "wx", 0o600);
        requireCwdExternalIdentity(parentIdentity, forbiddenRoots);
        writeFileSync(descriptor, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
        requireCwdExternalIdentity(parentIdentity, forbiddenRoots);
        fsyncSync(descriptor);
        const durable = fstatSync(descriptor);
        requirePrivateFile(durable, "continuation journal temporary");
        requireCwdExternalIdentity(parentIdentity, forbiddenRoots);
        closeSync(descriptor);
        descriptor = null;
        requireCwdExternalIdentity(parentIdentity, forbiddenRoots);
        renameSync(temporary, targetName);
        requireCwdExternalIdentity(parentIdentity, forbiddenRoots);
        syncDirectory(".");
        requireCwdExternalIdentity(parentIdentity, forbiddenRoots);
      } finally {
        if (descriptor !== undefined && descriptor !== null) closeSync(descriptor);
        rmSync(temporary, { force: true });
      }
    },
  });
}

function readAnchoredJournal(targetName) {
  if (!existsSync(targetName)) return null;
  const stat = lstatSync(targetName);
  requirePrivateFile(stat, "continuation journal");
  return normalizeDormantOwnerContinuationJournal(JSON.parse(readFileSync(targetName, "utf8")));
}

function requireExternalPath(file, forbiddenRoots, label) {
  if (!path.isAbsolute(String(file || ""))) throw new Error(`${label} path must be absolute.`);
  const requested = path.resolve(file);
  const requestedParent = path.dirname(requested);
  let parentStat;
  try { parentStat = lstatSync(requestedParent, { bigint: true }); }
  catch { throw new Error(`${label} parent directory must already exist.`); }
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new Error(`${label} parent path must be a real directory.`);
  }
  const canonicalParent = realpathSync(requestedParent);
  const target = path.join(canonicalParent, path.basename(requested));
  for (const rootValue of forbiddenRoots) {
    const root = realpathSync(path.resolve(rootValue));
    const relative = path.relative(root, target);
    if (relative === "" || (!relative.startsWith(`..${path.sep}`)
      && relative !== ".." && !path.isAbsolute(relative))) {
      throw new Error(`${label} must remain outside repositories and Git directories.`);
    }
  }
  return { target, parentIdentity: identity(parentStat) };
}

function stableLockPath(target, parentIdentity) {
  const root = realpathSync(os.tmpdir());
  return path.join(root, `.agentic-dormant-owner-continuation-${digestValue({
    target,
    parentIdentity,
  })}.lock`);
}
export function requireCwdExternalIdentity(expected, forbiddenRoots = []) {
  const observed = identity(lstatSync(".", { bigint: true }));
  if (!sameIdentity(observed, expected)) {
    throw new Error("Continuation journal anchored directory identity changed.");
  }
  let anchoredPath;
  try { anchoredPath = realpathSync("."); }
  catch {
    throw new Error("Continuation journal anchored directory moved or became unresolvable.");
  }
  for (const root of normalizeForbiddenRoots(forbiddenRoots)) {
    const relative = path.relative(root, anchoredPath);
    if (relative === "" || (!relative.startsWith(`..${path.sep}`)
      && relative !== ".." && !path.isAbsolute(relative))) {
      throw new Error("Continuation journal anchored directory moved inside a forbidden root.");
    }
  }
}
function identity(stat) { return Object.freeze({ dev: String(stat.dev), ino: String(stat.ino) }); }
function normalizeIdentity(value) {
  if (!value || !/^\d+$/u.test(value.dev) || !/^\d+$/u.test(value.ino)) {
    throw new Error("Continuation journal parent identity is invalid.");
  }
  return Object.freeze({ dev: value.dev, ino: value.ino });
}
function sameIdentity(left, right) { return left.dev === right.dev && left.ino === right.ino; }
function normalizeForbiddenRoots(values) {
  if (!Array.isArray(values)) throw new Error("Continuation journal forbidden roots are invalid.");
  return Object.freeze(values.map(value => {
    const root = String(value || "");
    if (!path.isAbsolute(root)) throw new Error("Continuation journal forbidden root is invalid.");
    return path.resolve(root);
  }));
}
function requirePrivateFile(stat, label) {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1
    || (stat.mode & 0o777) !== 0o600) {
    throw new Error(`${label} must be a private regular single-link 0600 file.`);
  }
}
function syncDirectory(directory) {
  const descriptor = openSync(directory, "r");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
  && process.argv[2] === "--internal-cas") {
  await internalCas();
}
