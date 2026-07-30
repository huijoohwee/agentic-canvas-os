import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

import { deepFreeze, sha256 } from "./canonical.js";

const DEFAULT_IGNORED_DIRECTORIES = new Set([
  ".git", ".hg", ".svn", ".idea", ".vscode", ".next", ".cache",
  "node_modules", "vendor", "coverage", "dist", "build", "out", "target",
  ".agentic-canvas-os",
]);

export const DEFAULT_ADMISSION_BOUNDS = deepFreeze({
  maxEntries: 20_000,
  maxFiles: 2_000,
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 50 * 1024 * 1024,
  maxDepth: 32,
  maxDurationMs: 20_000,
});

export function admitWorkspace({
  root,
  supportedExtensions,
  bounds = {},
  exclude = [],
}) {
  if (typeof root !== "string" || !root.trim()) throw admissionError("workspace_root_required", "workspace root is required");
  const absoluteRoot = path.resolve(root);
  const rootStat = lstatSync(absoluteRoot, { throwIfNoEntry: false });
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
    throw admissionError("workspace_root_invalid", "workspace root must be a real directory");
  }
  const realRoot = realpathSync(absoluteRoot);
  const limits = normalizeBounds(bounds);
  const extensions = normalizeExtensions(supportedExtensions);
  const callerExcludes = normalizeExcludes(exclude);
  const ignoreRules = loadIgnoreRules(realRoot);
  const started = performance.now();
  const diagnostics = [];
  const candidates = [];
  let scannedEntries = 0;
  let entryLimitReached = false;
  walk(realRoot, "", 0);
  candidates.sort((left, right) => compareBytes(left.relativePath, right.relativePath));

  const sources = [];
  let totalBytes = 0;
  for (const candidate of candidates) {
    ensureDeadline(started, limits.maxDurationMs);
    if (sources.length >= limits.maxFiles) {
      diagnostics.push(skip(candidate.relativePath, "file_limit", `File limit ${limits.maxFiles} reached.`));
      continue;
    }
    if (candidate.size > limits.maxFileBytes) {
      diagnostics.push(skip(candidate.relativePath, "file_too_large", `File exceeds ${limits.maxFileBytes} bytes.`));
      continue;
    }
    if (totalBytes + candidate.size > limits.maxTotalBytes) {
      diagnostics.push(skip(candidate.relativePath, "total_byte_limit", `Workspace byte limit ${limits.maxTotalBytes} reached.`));
      continue;
    }
    const bytes = readStableCandidate(candidate);
    if (!candidate.relativePath.toLowerCase().endsWith(".pdf") && looksBinary(bytes)) {
      diagnostics.push(skip(candidate.relativePath, "binary_unsupported", "Binary source is not parser-supported."));
      continue;
    }
    let source = null;
    if (!candidate.relativePath.toLowerCase().endsWith(".pdf")) {
      try {
        source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        diagnostics.push(skip(candidate.relativePath, "invalid_utf8", "Text source is not valid UTF-8."));
        continue;
      }
    }
    totalBytes += bytes.length;
    sources.push(deepFreeze({
      path: candidate.relativePath,
      absolutePath: candidate.absolutePath,
      digest: sha256(bytes),
      bytes: bytes.length,
      source,
      contentBase64: source === null ? bytes.toString("base64") : null,
    }));
  }

  return deepFreeze({
    root: realRoot,
    sources,
    diagnostics: diagnostics.sort((left, right) => compareBytes(left.path, right.path) || compareBytes(left.code, right.code)),
    manifest: {
      admittedFiles: sources.length,
      admittedBytes: totalBytes,
      skippedFiles: diagnostics.length,
      scannedEntries,
      limits,
    },
  });

  function walk(directory, relativeDirectory, depth) {
    ensureDeadline(started, limits.maxDurationMs);
    if (depth > limits.maxDepth) {
      diagnostics.push(skip(relativeDirectory || ".", "directory_depth_limit", `Directory depth limit ${limits.maxDepth} reached.`));
      return;
    }
    const names = readDirectoryNames(directory);
    for (const name of names) {
      if (scannedEntries >= limits.maxEntries) {
        if (!entryLimitReached) {
          diagnostics.push(skip(relativeDirectory || ".", "entry_limit", `Workspace entry limit ${limits.maxEntries} reached.`));
          entryLimitReached = true;
        }
        return;
      }
      scannedEntries += 1;
      const relativePath = relativeDirectory ? `${relativeDirectory}/${name}` : name;
      if (isExcluded(relativePath, name, callerExcludes, ignoreRules)) continue;
      const absolutePath = path.join(directory, name);
      const entry = lstatSync(absolutePath, { throwIfNoEntry: false });
      if (!entry) continue;
      if (entry.isSymbolicLink()) {
        diagnostics.push(skip(relativePath, "symlink_ignored", "Symbolic links are not followed."));
      } else if (entry.isDirectory()) {
        walk(absolutePath, relativePath, depth + 1);
      } else if (entry.isFile()) {
        const extension = path.extname(name).toLowerCase();
        if (extensions.has(extension) || extensions.has(name.toLowerCase())) {
          const resolvedParent = realpathSync(path.dirname(absolutePath));
          if (!isDescendant(realRoot, resolvedParent)) {
            throw admissionError("path_escape", `Source parent escaped workspace: ${relativePath}`);
          }
          candidates.push({
            relativePath,
            absolutePath,
            dev: entry.dev,
            ino: entry.ino,
            size: entry.size,
            mtimeMs: entry.mtimeMs,
            ctimeMs: entry.ctimeMs,
          });
        } else {
          diagnostics.push(skip(relativePath, "extension_unsupported", "No parser is registered for this file."));
        }
      }
    }
  }
}

function readDirectoryNames(directory) {
  const entries = readdirSync(directory);
  return entries.sort(compareBytes);
}

function loadIgnoreRules(root) {
  const file = path.join(root, ".gitignore");
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024) return [];
  const bytes = readStableCandidate({
    relativePath: ".gitignore",
    absolutePath: file,
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  });
  return bytes.toString("utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .slice(0, 2_000)
    .map(compileIgnoreRule)
    .filter(Boolean);
}

function compileIgnoreRule(pattern) {
  const negated = pattern.startsWith("!");
  const source = negated ? pattern.slice(1) : pattern;
  if (!source || source.length > 256) return null;
  const directoryOnly = source.endsWith("/");
  const anchored = source.startsWith("/");
  const clean = source.replace(/^\/|\/$/g, "");
  const expression = clean
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\u0000/g, ".*");
  const prefix = anchored ? "^" : "(?:^|/)";
  const suffix = directoryOnly ? "(?:/|$)" : "$";
  return { negated, regex: new RegExp(`${prefix}${expression}${suffix}`) };
}

function isExcluded(relativePath, name, callerExcludes, ignoreRules) {
  if (DEFAULT_IGNORED_DIRECTORIES.has(name)) return true;
  if (callerExcludes.some((prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`))) return true;
  let ignored = false;
  for (const rule of ignoreRules) {
    if (rule.regex.test(relativePath)) ignored = !rule.negated;
  }
  return ignored;
}

function normalizeExtensions(values) {
  if (!Array.isArray(values) || values.length === 0) throw admissionError("parser_catalog_empty", "at least one parser extension is required");
  return new Set(values.map((value) => {
    if (typeof value !== "string" || !value.trim()) throw admissionError("parser_extension_invalid", "parser extensions must be strings");
    const normalized = value.trim().toLowerCase();
    return normalized.startsWith(".") ? normalized : normalized;
  }));
}

function normalizeBounds(overrides) {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw admissionError("admission_bounds_invalid", "admission bounds must be an object");
  }
  const unknown = Object.keys(overrides).filter((key) => !(key in DEFAULT_ADMISSION_BOUNDS));
  if (unknown.length > 0) throw admissionError("admission_bounds_invalid", `unsupported admission bounds: ${unknown.join(", ")}`);
  const result = { ...DEFAULT_ADMISSION_BOUNDS };
  for (const [key, value] of Object.entries(overrides)) {
    if (!Number.isInteger(value) || value < 1 || value > DEFAULT_ADMISSION_BOUNDS[key]) {
      throw admissionError("admission_bounds_invalid", `${key} must be an integer from 1 to ${DEFAULT_ADMISSION_BOUNDS[key]}`);
    }
    result[key] = value;
  }
  return deepFreeze(result);
}

function normalizeExcludes(values) {
  if (!Array.isArray(values) || values.length > 128) throw admissionError("exclude_invalid", "exclude must be an array of at most 128 paths");
  return values.map((value) => {
    if (typeof value !== "string" || !value.trim() || path.isAbsolute(value) || value.includes("..")) {
      throw admissionError("exclude_invalid", "exclude entries must be safe relative paths");
    }
    return value.replace(/\\/g, "/").replace(/^\.\/|\/$/g, "");
  });
}

function looksBinary(bytes) {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8_192));
  return sample.includes(0);
}

function readStableCandidate(candidate) {
  if (!Number.isInteger(constants.O_NOFOLLOW)) {
    throw admissionError("nofollow_unavailable", "safe no-follow file admission is unavailable");
  }
  let descriptor;
  try {
    descriptor = openSync(candidate.absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw sourceDrift(candidate.relativePath);
  }
  try {
    const before = fstatSync(descriptor);
    if (!sameCandidate(before, candidate) || !before.isFile()) throw sourceDrift(candidate.relativePath);
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    const final = lstatSync(candidate.absolutePath, { throwIfNoEntry: false });
    if (!sameCandidate(after, candidate) || !sameCandidate(final, candidate)
      || final?.isSymbolicLink() || !final?.isFile() || bytes.length !== before.size) {
      throw sourceDrift(candidate.relativePath);
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

function sameCandidate(stat, candidate) {
  return stat && stat.dev === candidate.dev && stat.ino === candidate.ino
    && stat.size === candidate.size && stat.mtimeMs === candidate.mtimeMs
    && stat.ctimeMs === candidate.ctimeMs;
}

function sourceDrift(relativePath) {
  return admissionError("source_drift", `Source changed during admission: ${relativePath}`, { path: relativePath });
}

function isDescendant(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function ensureDeadline(started, maxDurationMs) {
  if (performance.now() - started > maxDurationMs) throw admissionError("admission_deadline", "workspace admission deadline exceeded");
}

function skip(pathValue, code, message) {
  return deepFreeze({ path: pathValue, code, message });
}

function compareBytes(left, right) {
  return Buffer.compare(Buffer.from(String(left), "utf8"), Buffer.from(String(right), "utf8"));
}

function admissionError(code, message, data = undefined) {
  const error = new Error(message);
  error.name = "KnowledgeGraphAdmissionError";
  error.code = code;
  if (data !== undefined) error.data = data;
  return error;
}
