import { mkdir, open, readdir, realpath, unlink } from "node:fs/promises";
import path from "node:path";

export class OutputBoundaryViolation extends Error {
  constructor(relativeName) {
    super(`output path must be a strict descendant: ${String(relativeName)}`);
    this.name = "OutputBoundaryViolation";
    this.relativeName = relativeName;
  }
}

export async function createWriteSink(outputRoot) {
  const unresolvedRoot = path.resolve(populated(outputRoot, "output root"));
  await mkdir(unresolvedRoot, { recursive: true });
  const root = await realpath(unresolvedRoot);

  return Object.freeze({
    async listPublished() {
      return (await readdir(root)).sort((left, right) => left.localeCompare(right, "en"));
    },
    async write(relativeName, content) {
      const target = await resolveWriteTarget(root, relativeName);
      const prospectiveParent = await canonicalizeProspectiveParent(
        path.dirname(target.absolutePath),
      );
      if (!isSameOrDescendant(prospectiveParent, root)) {
        throw new OutputBoundaryViolation(relativeName);
      }
      await mkdir(path.dirname(target.absolutePath), { recursive: true });
      await assertCanonicalParent(root, path.dirname(target.absolutePath), relativeName);

      const handle = await open(target.absolutePath, "wx");
      let failure = null;
      let text;
      try {
        text = typeof content === "string" ? content : String(content);
        await handle.writeFile(text, "utf8");
        await handle.sync();
      } catch (error) {
        failure = error;
      }
      try {
        await handle.close();
      } catch (error) {
        failure ??= error;
      }
      if (failure) {
        try {
          await discardFile(root, target, relativeName);
        } catch (cleanupError) {
          failure.cleanupError = cleanupError;
        }
        throw failure;
      }
      let discarded = false;
      return Object.freeze({
        relativeName: target.relativeName,
        absolutePath: target.absolutePath,
        byteLength: Buffer.byteLength(text, "utf8"),
        async discard() {
          if (discarded) return false;
          await discardFile(root, target, relativeName);
          discarded = true;
          return true;
        },
      });
    },
  });
}

export function createInMemoryWriteSink() {
  const files = new Map();
  const writes = [];
  return Object.freeze({
    files,
    writes,
    async listPublished() {
      return [...files.keys()].sort((left, right) => left.localeCompare(right, "en"));
    },
    async write(relativeName, content) {
      const normalized = normalizeMemoryName(relativeName);
      if (files.has(normalized)) {
        const error = new Error(`output already exists: ${normalized}`);
        error.code = "EEXIST";
        throw error;
      }
      const text = typeof content === "string" ? content : String(content);
      files.set(normalized, text);
      let discarded = false;
      const artifact = Object.freeze({
        relativeName: normalized,
        absolutePath: null,
        byteLength: Buffer.byteLength(text, "utf8"),
        async discard() {
          if (discarded) return false;
          files.delete(normalized);
          discarded = true;
          return true;
        },
      });
      writes.push(artifact);
      return artifact;
    },
  });
}

export function incrementPatchVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(String(version ?? ""));
  if (!match) throw new TypeError(`invalid semantic version: ${String(version)}`);
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

async function resolveWriteTarget(root, relativeName) {
  const normalized = populated(relativeName, "relative output name").replaceAll("\\", "/");
  if (
    path.posix.isAbsolute(normalized) ||
    /^[A-Za-z]:\//u.test(normalized) ||
    normalized.startsWith("//")
  ) {
    throw new OutputBoundaryViolation(relativeName);
  }
  const absolutePath = path.resolve(root, normalized);
  if (!isStrictDescendant(absolutePath, root)) {
    throw new OutputBoundaryViolation(relativeName);
  }
  return {
    relativeName: path.relative(root, absolutePath).split(path.sep).join("/"),
    absolutePath,
  };
}

async function assertCanonicalParent(root, parent, relativeName) {
  const canonicalParent = await realpath(parent);
  if (!isSameOrDescendant(canonicalParent, root)) {
    throw new OutputBoundaryViolation(relativeName);
  }
}

async function canonicalizeProspectiveParent(parent) {
  let cursor = path.resolve(parent);
  const suffix = [];
  while (true) {
    try {
      const existing = await realpath(cursor);
      return path.join(existing, ...suffix.reverse());
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const ancestor = path.dirname(cursor);
      if (ancestor === cursor) throw error;
      suffix.push(path.basename(cursor));
      cursor = ancestor;
    }
  }
}

async function discardFile(root, target, relativeName) {
  try {
    await assertCanonicalParent(root, path.dirname(target.absolutePath), relativeName);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  try {
    await unlink(target.absolutePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function normalizeMemoryName(relativeName) {
  const normalized = populated(relativeName, "relative output name").replaceAll("\\", "/");
  if (
    path.posix.isAbsolute(normalized) ||
    /^[A-Za-z]:\//u.test(normalized) ||
    normalized.startsWith("//")
  ) {
    throw new OutputBoundaryViolation(relativeName);
  }
  const collapsed = path.posix.normalize(normalized);
  if (collapsed === "." || collapsed === ".." || collapsed.startsWith("../")) {
    throw new OutputBoundaryViolation(relativeName);
  }
  return collapsed;
}

function isStrictDescendant(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isSameOrDescendant(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function populated(value, label) {
  const text = String(value ?? "").trim();
  if (text.length === 0) throw new TypeError(`${label} must be non-empty`);
  return text;
}
