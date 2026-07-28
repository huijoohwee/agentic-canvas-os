import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { contentDigest } from "./normalize.mjs";

export function createNodeSourceReader(defaultRoots = []) {
  const descriptors = new Map();

  return Object.freeze({
    async list(roots = defaultRoots) {
      const entries = [];
      for (const root of roots ?? []) {
        entries.push(...(await enumerateRoot(root)));
      }
      entries.sort(compareDescriptors);
      for (const entry of entries) descriptors.set(entry.readHandle, entry);
      return entries;
    },

    async read(subject) {
      const descriptor = normalizeSubject(subject, descriptors);
      try {
        const content = await readFile(descriptor.readHandle, "utf8");
        return {
          ...descriptor,
          content,
          text: content,
          contentDigest: contentDigest(content),
          readState: "ok",
          error: null,
        };
      } catch (error) {
        return unreadable(descriptor, error);
      }
    },
  });
}

export function createInMemorySourceReader(documents = new Map(), options = {}) {
  const entries = normalizeMemoryDocuments(documents, options);
  const byHandle = new Map(entries.map((entry) => [entry.readHandle, entry]));

  return Object.freeze({
    async list(roots = []) {
      const surfaces = new Set((roots ?? []).map((root) => root.auditSurface).filter(Boolean));
      const selected =
        surfaces.size === 0
          ? entries
          : entries.filter((entry) => !entry.auditSurface || surfaces.has(entry.auditSurface));
      return [...selected].sort(compareDescriptors).map(stripMemoryContent);
    },

    async read(subject) {
      const descriptor = normalizeSubject(subject, byHandle);
      const entry = byHandle.get(descriptor.readHandle);
      if (!entry || entry.readState === "unreadable") {
        return unreadable(descriptor, entry?.error ?? new Error("source is unreadable"));
      }
      const content = String(entry.content ?? entry.text ?? "");
      return {
        ...stripMemoryContent(entry),
        content,
        text: content,
        contentDigest: contentDigest(content),
        readState: "ok",
        error: null,
      };
    },
  });
}

export const createMemorySourceReader = createInMemorySourceReader;

async function enumerateRoot(root) {
  const normalized = normalizeRoot(root);
  const info = await stat(normalized.locator);
  if (info.isFile()) {
    return matchesGlobs(path.basename(normalized.locator), normalized)
      ? [descriptorFrom(normalized, normalized.locator, path.basename(normalized.locator))]
      : [];
  }
  if (!info.isDirectory()) return [];

  const entries = [];
  await walk(normalized.locator, "");
  return entries;

  async function walk(directory, relativeDirectory) {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const child of children) {
      const relativeName = toPosix(path.join(relativeDirectory, child.name));
      const absoluteName = path.join(directory, child.name);
      if (child.isDirectory()) {
        await walk(absoluteName, relativeName);
      } else if (child.isFile() && matchesGlobs(relativeName, normalized)) {
        entries.push(descriptorFrom(normalized, absoluteName, relativeName));
      }
    }
  }
}

function normalizeMemoryDocuments(documents, options) {
  const values =
    documents instanceof Map
      ? [...documents.entries()].map(([readHandle, value]) => ({ readHandle, value }))
      : Array.isArray(documents)
        ? documents.map((value, index) => ({
            readHandle: value?.readHandle ?? value?.handle ?? `memory-${index}`,
            value,
          }))
        : Object.entries(documents ?? {}).map(([readHandle, value]) => ({ readHandle, value }));

  return values.map(({ readHandle, value }, index) => {
    const object =
      value && typeof value === "object" && !Buffer.isBuffer(value)
        ? value
        : { content: value };
    return Object.freeze({
      readHandle: String(object.readHandle ?? readHandle),
      subject: String(object.subject ?? object.readHandle ?? readHandle),
      inputRole: String(object.inputRole ?? object.roleLabel ?? options.inputRole ?? "input"),
      roleLabel: String(object.roleLabel ?? object.inputRole ?? options.inputRole ?? "input"),
      auditSurface: object.auditSurface ?? object.surface ?? options.auditSurface ?? null,
      relativeName: object.relativeName ?? null,
      revisionIdentifier: object.revisionIdentifier ?? null,
      documentDefaults: object.documentDefaults ?? options.documentDefaults ?? null,
      ordinal: index,
      content: object.content ?? object.text ?? "",
      text: object.text ?? object.content ?? "",
      readState: object.readState ?? (object.unreadable ? "unreadable" : "ok"),
      error: object.error ?? null,
    });
  });
}

function normalizeRoot(root) {
  if (typeof root === "string") {
    return {
      locator: path.resolve(root),
      roleLabel: "input",
      inputRole: "input",
      auditSurface: null,
      includeGlobs: ["**/*"],
      excludeGlobs: [],
      revisionIdentifier: null,
    };
  }
  return {
    ...root,
    locator: path.resolve(root.locator),
    roleLabel: root.roleLabel ?? root.inputRole ?? "input",
    inputRole: root.inputRole ?? root.roleLabel ?? "input",
    auditSurface: root.auditSurface ?? root.surface ?? null,
    includeGlobs: root.includeGlobs ?? ["**/*"],
    excludeGlobs: root.excludeGlobs ?? [],
    revisionIdentifier: root.revisionIdentifier ?? null,
  };
}

function descriptorFrom(root, absoluteName, relativeName) {
  return Object.freeze({
    readHandle: path.resolve(absoluteName),
    subject: `${root.roleLabel}:${toPosix(relativeName)}`,
    inputRole: root.inputRole,
    roleLabel: root.roleLabel,
    auditSurface: root.auditSurface,
    relativeName: toPosix(relativeName),
    revisionIdentifier: root.revisionIdentifier,
    documentDefaults: root.documentDefaults ?? null,
  });
}

function normalizeSubject(subject, descriptors) {
  if (typeof subject === "string") {
    return descriptors.get(subject) ?? {
      readHandle: subject,
      subject,
      inputRole: "input",
      roleLabel: "input",
      auditSurface: null,
      revisionIdentifier: null,
    };
  }
  if (!subject || typeof subject !== "object") {
    throw new TypeError("SourceReader.read expects a read handle or descriptor");
  }
  return subject;
}

function matchesGlobs(relativeName, root) {
  const included =
    root.includeGlobs.length === 0 ||
    root.includeGlobs.some((glob) => globToRegExp(glob).test(relativeName));
  return (
    included &&
    !root.excludeGlobs.some((glob) => globToRegExp(glob).test(relativeName))
  );
}

function globToRegExp(glob) {
  const normalized = toPosix(glob);
  let source = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === "*" && normalized[index + 1] === "*") {
      index += 1;
      if (normalized[index + 1] === "/") {
        index += 1;
        source += "(?:.*/)?";
      } else {
        source += ".*";
      }
    } else if (character === "*") {
      source += "[^/]*";
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += character.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&");
    }
  }
  return new RegExp(`${source}$`, "u");
}

function unreadable(descriptor, error) {
  return {
    ...descriptor,
    content: null,
    text: null,
    contentDigest: null,
    readState: "unreadable",
    error: error instanceof Error ? error.message : String(error),
  };
}

function stripMemoryContent(entry) {
  const { content: _content, text: _text, error: _error, ordinal: _ordinal, ...descriptor } =
    entry;
  return { ...descriptor };
}

function compareDescriptors(left, right) {
  return (
    String(left.auditSurface ?? "").localeCompare(String(right.auditSurface ?? ""), "en") ||
    String(left.roleLabel ?? "").localeCompare(String(right.roleLabel ?? ""), "en") ||
    String(left.subject ?? left.readHandle).localeCompare(
      String(right.subject ?? right.readHandle),
      "en",
    )
  );
}

function toPosix(value) {
  return String(value).split(path.sep).join("/");
}
