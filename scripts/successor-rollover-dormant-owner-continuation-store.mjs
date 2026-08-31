// Responsibility: Persist private external plans and journals with exact file fences.
import {
  closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync,
  realpathSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import { normalizeDormantOwnerContinuationJournal }
  from "./successor-rollover-dormant-owner-continuation-contract.mjs";

export function readPrivateContinuationJson(file, label, { forbiddenRoots = [] } = {}) {
  const target = requireExternalPath(file, forbiddenRoots, label);
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1
    || (stat.mode & 0o777) !== 0o600) {
    throw new Error(`${label} must be a private regular single-link 0600 file.`);
  }
  return JSON.parse(readFileSync(target, "utf8"));
}

export function writePrivateContinuationJsonExclusive(
  file,
  value,
  { forbiddenRoots = [] } = {},
) {
  const target = requireExternalPath(file, forbiddenRoots, "private output");
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const descriptor = openSync(target, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  } finally {
    closeSync(descriptor);
  }
  return target;
}

export function createDormantOwnerContinuationJournalStore({
  journalPath,
  forbiddenRoots = [],
} = {}) {
  const target = requireExternalPath(journalPath, forbiddenRoots, "continuation journal");
  function read() {
    if (!existsSync(target)) return null;
    return normalizeDormantOwnerContinuationJournal(readPrivateContinuationJson(
      target,
      "continuation journal",
      { forbiddenRoots },
    ));
  }
  function write(value, expectedDigest = null) {
    const journal = normalizeDormantOwnerContinuationJournal(value);
    mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    const lock = `${target}.lock`;
    let descriptor;
    try {
      descriptor = openSync(lock, "wx", 0o600);
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw new Error("Continuation journal compare-and-swap lock is already held.");
      }
      throw error;
    }
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    try {
      const current = read();
      if ((current?.journalDigest ?? null) !== expectedDigest) {
        throw new Error("Continuation journal changed before private compare-and-swap.");
      }
      writeFileSync(temporary, `${JSON.stringify(journal, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      renameSync(temporary, target);
      return journal;
    } finally {
      rmSync(temporary, { force: true });
      closeSync(descriptor);
      rmSync(lock, { force: true });
    }
  }
  return Object.freeze({ path: target, read, write });
}

function requireExternalPath(file, forbiddenRoots, label) {
  if (!path.isAbsolute(String(file || ""))) throw new Error(`${label} path must be absolute.`);
  const requested = path.resolve(file);
  const existingParent = nearestExisting(path.dirname(requested));
  const target = path.resolve(
    realpathSync(existingParent),
    path.relative(existingParent, requested),
  );
  for (const rootValue of forbiddenRoots) {
    const root = realpathSync(path.resolve(rootValue));
    const relative = path.relative(root, target);
    if (relative === "" || (!relative.startsWith(`..${path.sep}`)
      && relative !== ".." && !path.isAbsolute(relative))) {
      throw new Error(`${label} must remain outside repositories and Git directories.`);
    }
  }
  const canonicalParent = nearestExisting(path.dirname(target));
  if (lstatSync(canonicalParent).isSymbolicLink()) {
    throw new Error(`${label} parent path must not be a symbolic link.`);
  }
  return target;
}

function nearestExisting(candidate) {
  let current = path.resolve(candidate);
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error("Private output has no existing ancestor.");
    current = parent;
  }
  return current;
}
