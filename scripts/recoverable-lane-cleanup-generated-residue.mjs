// Responsibility: inventory the one repository-declared ignored generated-output profile.
import { createHash } from "node:crypto";
import {
  closeSync, fsyncSync, lstatSync, openSync, readFileSync, readlinkSync, readdirSync, statSync,
} from "node:fs";
import path from "node:path";

import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";

export const GENERATED_RESIDUE_SCHEMA =
  "agentic-recoverable-lane-cleanup-generated-residue/v1";
export const GENERATED_RESIDUE_ROOTS = Object.freeze(["node_modules/", "web/dist/"]);

export function captureRecoverableLaneGeneratedResidue({ root, git, observeEntry }) {
  const ignored = nulList(git(root, [
    "ls-files", "--others", "--ignored", "--exclude-standard", "-z",
  ])).sort();
  const roots = generatedRootState(root);
  const inventory = combinedInventory(root, { observeEntry });
  const extraEmptyDirectories = inventory.emptyDirectoryPaths.filter(
    candidate => !isGeneratedPath(candidate),
  );
  if (extraEmptyDirectories.length) {
    throw new Error("Empty directories are outside the generated residue profile.");
  }
  if (!ignored.length && !roots.present) return emptyProfile(root, inventory.checkout);
  if (!roots.exact) throw new Error("Generated residue must contain both exact roots.");
  if (GENERATED_RESIDUE_ROOTS.some(prefix => !ignored.some(candidate => candidate.startsWith(prefix)))) {
    throw new Error("Each generated residue root must contain at least one ignored entry.");
  }
  for (const candidate of ignored) assertAllowedPath(candidate);
  const { checkout, generated } = inventory;
  const core = {
    schema: GENERATED_RESIDUE_SCHEMA,
    mode: "preserve-exact-generated-roots",
    roots: [...GENERATED_RESIDUE_ROOTS],
    ignoredPathCount: ignored.length,
    ignoredPathsDigest: digestValue(ignored),
    entryCount: generated.entryCount,
    totalBytes: generated.totalBytes,
    inventoryDigest: generated.inventoryDigest,
    checkoutEntryCount: checkout.entryCount,
    checkoutInventoryDigest: checkout.inventoryDigest,
  };
  return Object.freeze({ ...core, profileDigest: digestValue(core) });
}

export function assertRecoverableLaneGeneratedResidueSnapshot({ root, expected }) {
  if (!expected) return null;
  let profile;
  let observed;
  try {
    profile = normalizeRecoverableLaneGeneratedResidue(expected);
    observed = profile.mode === "none" ? emptyProfile(root) : snapshotProfile(root, profile);
  } catch (error) {
    if (error?.code) throw error;
    error.code = "RECOVERABLE_GENERATED_RESIDUE_DRIFT";
    throw error;
  }
  if (canonicalJson(observed) !== canonicalJson(profile)) {
    const error = new Error("Generated residue or checkout bytes drifted before quarantine sealing.");
    error.code = "RECOVERABLE_GENERATED_RESIDUE_DRIFT";
    throw error;
  }
  return observed;
}

export function inspectRecoverableLaneCleanupTree(
  root, { durable = false, normalizeGitdir = false } = {},
) {
  if (!recoverableLanePathExists(root)) {
    return { exists: false, digest: null, generationDigest: null };
  }
  const rootMetadata = lstatSync(root);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error("Cleanup recovery snapshot is not one real directory.");
  }
  const entries = [];
  const visit = (directory, prefix = "") => {
    for (const name of readdirSync(directory).sort()) {
      const absolute = path.join(directory, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      const metadata = lstatSync(absolute);
      const mode = metadata.mode & 0o7777;
      if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
        entries.push({ path: relative, type: "directory", mode });
        visit(absolute, relative);
        if (durable) syncRecoverableLaneDirectory(absolute);
      } else if (metadata.isFile() && !metadata.isSymbolicLink()) {
        if (durable) syncRecoverableLaneFile(absolute);
        entries.push({
          path: relative, type: "file", mode,
          sizeBytes: normalizeGitdir && relative === "gitdir" ? 0 : metadata.size,
          sha256: normalizeGitdir && relative === "gitdir"
            ? digestValue("normalized-gitdir-backlink") : sha256(readFileSync(absolute)),
        });
      } else if (metadata.isSymbolicLink()) {
        entries.push({ path: relative, type: "symlink", mode,
          target: readlinkSync(absolute) });
      } else throw new Error(`Cleanup snapshot contains unsupported entry: ${relative}`);
    }
  };
  visit(root);
  if (durable) syncRecoverableLaneDirectory(root);
  return { exists: true, generationDigest: recoverableLaneDirectoryGenerationDigest(root),
    digest: digestValue({ schema: "agentic-recoverable-lane-cleanup-tree/v1", entries }) };
}

export function recoverableLaneDirectoryGenerationDigest(directory) {
  const metadata = statSync(directory);
  return digestValue({ device: String(metadata.dev), inode: String(metadata.ino),
    birthtimeMs: String(metadata.birthtimeMs) });
}
export function recoverableLanePathExists(filePath) {
  try { lstatSync(filePath); return true; }
  catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error?.code)) return false;
    throw error;
  }
}
export function syncRecoverableLaneFile(filePath) {
  const descriptor = openSync(filePath, "r");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}
export function syncRecoverableLaneDirectory(directory) {
  const descriptor = openSync(directory, "r");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

export function normalizeRecoverableLaneGeneratedResidue(value) {
  requiredObject(value, "generated residue profile");
  const mode = requiredText(value.mode, "generated residue mode");
  const keys = ["schema", "mode", "roots", "ignoredPathCount", "ignoredPathsDigest",
    "entryCount", "totalBytes", "inventoryDigest", "checkoutEntryCount",
    "checkoutInventoryDigest", "profileDigest"];
  exactObject(value, "generated residue profile", keys);
  if (value.schema !== GENERATED_RESIDUE_SCHEMA
    || !new Set(["none", "preserve-exact-generated-roots"]).has(mode)) {
    throw new Error("Generated residue schema or mode is invalid.");
  }
  const roots = exactRoots(value.roots, mode);
  const core = {
    schema: value.schema,
    mode,
    roots,
    ignoredPathCount: nonNegativeInteger(value.ignoredPathCount, "ignored path count"),
    ignoredPathsDigest: digest(value.ignoredPathsDigest, "ignored paths digest"),
    entryCount: nonNegativeInteger(value.entryCount, "generated entry count"),
    totalBytes: nonNegativeInteger(value.totalBytes, "generated byte count"),
    inventoryDigest: digest(value.inventoryDigest, "generated inventory digest"),
    checkoutEntryCount: positiveInteger(value.checkoutEntryCount, "checkout entry count"),
    checkoutInventoryDigest: digest(value.checkoutInventoryDigest, "checkout inventory digest"),
  };
  if (mode === "none" && (core.ignoredPathCount || core.entryCount || core.totalBytes)) {
    throw new Error("Empty generated residue evidence must have zero generated entries.");
  }
  if (mode !== "none" && (!core.ignoredPathCount || !core.entryCount)) {
    throw new Error("Generated residue evidence must contain both exact roots.");
  }
  if (value.profileDigest !== digestValue(core)) {
    throw new Error("Generated residue profile digest is invalid.");
  }
  return Object.freeze({ ...core, profileDigest: value.profileDigest });
}

function snapshotProfile(root, expected) {
  const { checkout: inventory, generated } = combinedInventory(root);
  const core = {
    schema: GENERATED_RESIDUE_SCHEMA,
    mode: expected.mode,
    roots: [...GENERATED_RESIDUE_ROOTS],
    ignoredPathCount: expected.ignoredPathCount,
    ignoredPathsDigest: expected.ignoredPathsDigest,
    entryCount: generated.entryCount,
    totalBytes: generated.totalBytes,
    inventoryDigest: generated.inventoryDigest,
    checkoutEntryCount: inventory.entryCount,
    checkoutInventoryDigest: inventory.inventoryDigest,
  };
  return Object.freeze({ ...core, profileDigest: digestValue(core) });
}

function emptyProfile(root, inventory = combinedInventory(root).checkout) {
  const core = {
    schema: GENERATED_RESIDUE_SCHEMA,
    mode: "none",
    roots: [],
    ignoredPathCount: 0,
    ignoredPathsDigest: digestValue([]),
    entryCount: 0,
    totalBytes: 0,
    inventoryDigest: digestValue([]),
    checkoutEntryCount: inventory.entryCount,
    checkoutInventoryDigest: inventory.inventoryDigest,
  };
  return Object.freeze({ ...core, profileDigest: digestValue(core) });
}

function combinedInventory(root, { observeEntry = () => {} } = {}) {
  const checkoutEntries = [];
  const generatedEntries = [];
  const emptyDirectoryPaths = [];
  for (const name of readdirSync(root).sort()) {
    if (name === ".git") continue;
    walk(path.join(root, name), name, checkoutEntries,
      { root, generatedEntries, emptyDirectoryPaths, observeEntry });
  }
  return Object.freeze({
    checkout: sealInventory(checkoutEntries), generated: sealInventory(generatedEntries),
    emptyDirectoryPaths,
  });
}

function generatedRootState(root) {
  const states = GENERATED_RESIDUE_ROOTS.map(relative => {
    try {
      const stat = lstatSync(path.join(root, relative));
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error(`Generated residue root must be an ordinary directory: ${relative}`);
      }
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
  });
  return { present: states.some(Boolean), exact: states.every(Boolean) };
}

function walk(
  absolute, relative, entries, { root, generatedEntries, emptyDirectoryPaths, observeEntry } = {},
) {
  const stat = lstatSync(absolute);
  const mode = (stat.mode & 0o7777).toString(8).padStart(4, "0");
  const generated = generatedEntries && isGeneratedPath(relative);
  let entry;
  if (stat.isSymbolicLink()) {
    const target = readlinkSync(absolute, "utf8");
    if (generated) assertRelocationStableLink({ root, absolute, relative, target });
    entry = { path: relative, type: "symlink", mode, sizeBytes: Buffer.byteLength(target),
      contentDigest: sha256(Buffer.from(target)) };
  } else if (stat.isFile()) {
    const bytes = readFileSync(absolute);
    entry = { path: relative, type: "file", mode, sizeBytes: bytes.length,
      contentDigest: sha256(bytes) };
  } else if (stat.isDirectory()) {
    entry = { path: `${relative}/`, type: "directory", mode, sizeBytes: 0,
      contentDigest: sha256(Buffer.alloc(0)) };
  } else {
    throw new Error(`Unsupported checkout entry type: ${relative}`);
  }
  entries.push(entry);
  if (generated) generatedEntries.push(entry);
  observeEntry(relative);
  if (!stat.isDirectory()) return;
  const children = readdirSync(absolute).sort();
  if (!children.length) emptyDirectoryPaths?.push(relative);
  for (const child of children) {
    walk(path.join(absolute, child), `${relative}/${child}`, entries,
      { root, generatedEntries, emptyDirectoryPaths, observeEntry });
  }
}

function isGeneratedPath(relative) {
  return GENERATED_RESIDUE_ROOTS.some(root => {
    const normalized = root.replace(/\/$/u, "");
    return relative === normalized || relative.startsWith(`${normalized}/`);
  });
}
function assertRelocationStableLink({ root, absolute, relative, target }) {
  const resolved = path.resolve(path.dirname(absolute), target);
  if (path.isAbsolute(target) || !sameOrContains(root, resolved)) {
    throw new Error(`Generated residue symlink escapes its relocated checkout: ${relative}`);
  }
  let cursor = root;
  for (const segment of path.relative(root, resolved).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    try {
      if (lstatSync(cursor).isSymbolicLink()) {
        throw new Error(`Generated residue symlink traverses another link: ${relative}`);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      throw new Error(`Generated residue symlink target does not resolve: ${relative}`);
    }
  }
}

function sealInventory(entries) {
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return Object.freeze({
    entryCount: entries.length,
    totalBytes: entries.reduce((sum, entry) => sum + entry.sizeBytes, 0),
    inventoryDigest: digestValue(entries),
  });
}

function nulList(value) { return value.split("\0").filter(Boolean); }
function assertAllowedPath(candidate) {
  if (!GENERATED_RESIDUE_ROOTS.some(root => candidate.startsWith(root))) {
    throw new Error(`Ignored path is outside the generated residue profile: ${candidate}`);
  }
}
function exactRoots(value, mode) {
  if (!Array.isArray(value)) throw new Error("Generated residue roots must be an array.");
  const expected = mode === "none" ? [] : GENERATED_RESIDUE_ROOTS;
  if (canonicalJson(value) !== canonicalJson(expected)) {
    throw new Error("Generated residue roots are not exact.");
  }
  return [...value];
}
function sameOrContains(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function digest(value, label) {
  const text = requiredText(value, label);
  if (!/^[0-9a-f]{64}$/u.test(text)) throw new Error(`${label} must be a SHA-256 digest.`);
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
function requiredText(value, label) {
  if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
  return value;
}
function requiredObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is required.`);
}
function exactObject(value, label, keys) {
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) {
    throw new Error(`${label} fields are malformed or incomplete.`);
  }
}
