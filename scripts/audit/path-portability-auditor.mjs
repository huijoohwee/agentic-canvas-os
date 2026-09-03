// Responsibility: Select repository-authored text and report non-portable path or account literals.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
export const PATH_PORTABILITY_AUDIT_SCHEMA =
  "agentic-game-os-path-portability-audit/v1";
export const AUDITED_REPOSITORY_NAMES = Object.freeze([
  "agentic-canvas-os",
  "agentic-graph",
  "GameXR",
]);
export function digestAuthoredText(text) {
  return typeof text === "string"
    ? createHash("sha256").update(text, "utf8").digest("hex")
    : null;
}
const GIT_INVENTORY_TIMEOUT_MS = 30_000;
const GIT_INVENTORY_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".wrangler",
  "DerivedData",
  "Pods",
  "build",
  "coverage",
  "dist",
  "generated",
  "node_modules",
  "vendor",
]);
const LOCKFILE_NAMES = new Set([
  "Package.resolved",
  "Podfile.lock",
  "bun.lock",
  "bun.lockb",
  "composer.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);
const CODE_LIKE_PATH_EXTENSIONS = new Set(["cjs", "js", "jsx", "mjs", "ts", "tsx"]);
const POSIX_ROOT_PATTERN =
  /(?:^|[\s"'`=:\[]|(?<!\])\()(\/(?:Applications|Library|Network|System|Users|Volumes|bin|boot|cores|dev|etc|home|lib|lib32|lib64|media|mnt|net|nix|opt|private|proc|root|run|sbin|snap|srv|sys|tmp|usr|var)(?=\/|$|[\s"'`<>{}|()[\].,;:!?])(?:\/[^\s\/"'`<>{}|()[\]]+)*)/gu;
const WINDOWS_DRIVE_PATTERN =
  /(?:^|[\s("'`=\[])(([A-Za-z]:[\\/])(?:[^\s"'`<>{}|()[\]]+)?)/gu;
const WINDOWS_UNC_PATTERN =
  /(?:^|[\s("'`=\[])((?:\\\\)[A-Za-z0-9._$-]+(?:\\[^\s"'`<>{}|()[\]]+)+)/gu;
const GITHUB_ROOT_PATTERN = /\$GITHUB_ROOT(?:\/[A-Za-z0-9._-]+)+/gu;
const REPOSITORY_PATH_PATTERN =
  /(?:^|[\s("'`=:\[])((?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+)/gu;
export function normalizeRepositoryPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    return null;
  }
  if (
    value.startsWith("/")
    || value.startsWith("\\\\")
    || /^[A-Za-z]:[\\/]/u.test(value)
  ) return null;
  const segments = value.replaceAll("\\", "/").split("/");
  const normalized = [];
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (normalized.length === 0) return null;
      normalized.pop();
      continue;
    }
    normalized.push(segment);
  }
  return normalized.length > 0 ? normalized.join("/") : null;
}
export function isAuthoredTextPath(value) {
  const relativePath = normalizeRepositoryPath(value);
  if (!relativePath) return false;
  const segments = relativePath.split("/");
  if (segments.some((segment) => EXCLUDED_DIRECTORIES.has(segment))) return false;
  return !LOCKFILE_NAMES.has(segments.at(-1));
}
export function normalizeAuthoredFiles(files, { includeExcluded = false } = {}) {
  const entries = Array.isArray(files)
    ? files
    : files && typeof files === "object"
      ? Object.entries(files).map(([path, value]) => (
        value && typeof value === "object" && !Array.isArray(value)
          ? { ...value, path }
          : { path, text: value }
      ))
      : [];
  return entries.map((entry, index) => {
    const source = entry && typeof entry === "object" ? entry : {};
    const path = normalizeRepositoryPath(source.path ?? source.file);
    const text = source.text ?? source.content;
    return {
      ...source,
      path,
      text: typeof text === "string" ? text : null,
      readError: source.readError
        ?? (!path ? `files[${index}] is not repository-relative`
          : typeof text !== "string" ? "text is unavailable" : null),
    };
  }).filter((entry) => (
    !entry.path
    || includeExcluded
    || (isAuthoredTextPath(entry.path) && !entry.text?.includes("\0"))
  )).sort(comparePaths);
}
export function auditPathPortability({
  files = [],
  accountNames = [],
  repositoryPaths,
} = {}) {
  const violations = [];
  const unscannedFiles = [];
  let scannedFileCount = 0;
  const normalizedFiles = normalizeAuthoredFiles(files);
  const knownInventory = normalizeKnownPaths(repositoryPaths);
  const knownPaths = knownInventory.paths;
  const accounts = normalizeAccounts(accountNames);
  if (normalizedFiles.length === 0) unscannedFiles.push({
    path: "<audit-scope>",
    reason: "authored tracked-file scope is empty",
  });
  if (knownInventory.error) unscannedFiles.push({
    path: "<repository-inventory>",
    reason: knownInventory.error,
  });
  for (const file of normalizedFiles) {
    if (!file.path || file.readError || file.text === null) {
      unscannedFiles.push({
        path: file.path ?? "<invalid-repository-path>",
        reason: file.readError ?? "text is unavailable",
      });
      continue;
    }
    if (/\.(?:jsx|swift|tsx)$/iu.test(file.path)) {
      unscannedFiles.push({ path: file.path,
        reason: "path lexical grammar is unsupported for this source format" });
      continue;
    }
    const unsupportedLexicalGrammar = scanFile({ file, accounts, knownPaths, violations });
    if (unsupportedLexicalGrammar) {
      unscannedFiles.push({ path: file.path,
        reason: "template-interpolation path grammar is unsupported" });
      continue;
    }
    scannedFileCount += 1;
  }
  violations.sort(compareViolations);
  const uniqueUnscannedFiles = normalizeUnscannedSubjects(unscannedFiles);
  const status = uniqueUnscannedFiles.length > 0
    ? "incomplete"
    : violations.length > 0 ? "failed" : "passed";
  return {
    schema: PATH_PORTABILITY_AUDIT_SCHEMA,
    status,
    outcome: status === "passed"
      ? "portable"
      : status === "failed" ? "path-portability" : "audit-incomplete",
    violations,
    unscannedFiles: uniqueUnscannedFiles,
    summary: {
      scannedFileCount,
      violationCount: violations.length,
      unscannedFileCount: uniqueUnscannedFiles.length,
    },
  };
}
export const auditAuthoredPaths = auditPathPortability;
export function normalizeUnscannedSubjects(values) {
  const byKey = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    const key = `${value.path}\0${value.reason}`;
    if (!byKey.has(key)) byKey.set(key, value);
  }
  return [...byKey.values()].sort(comparePaths);
}
export function auditTrackedPathPortability({
  githubRoot,
  repositoryNames = AUDITED_REPOSITORY_NAMES,
  accountNames = [],
} = {}) {
  const inventory = collectTrackedAuthoredFiles({ githubRoot, repositoryNames });
  const audit = auditPathPortability({
    files: inventory.files,
    repositoryPaths: inventory.repositoryPaths,
    accountNames: [...accountNames, ...inventory.accountNames],
  });
  return {
    ...audit,
    scope: inventory.scope,
  };
}
export function collectTrackedAuthoredFiles({
  githubRoot,
  repositoryNames = AUDITED_REPOSITORY_NAMES,
} = {}) {
  const names = normalizeRepositoryNames(repositoryNames);
  const root = typeof githubRoot === "string" && isAbsolute(githubRoot)
    ? resolve(githubRoot)
    : null;
  const files = [];
  const repositoryPaths = [];
  const repositories = [];
  if (!root || names.length === 0) {
    files.push({
      path: "<audit-scope>",
      text: null,
      readError: !root
        ? "GITHUB_ROOT must be an absolute directory"
        : "repository scope is empty",
    });
    return trackedInventory({
      root, files, repositoryPaths, repositories, expectedRepositoryCount: names.length,
    });
  }
  for (const name of names) {
    const repositoryRoot = resolve(root, name);
    if (!pathIsWithinRoot(repositoryRoot, root)) {
      files.push({ path: name, text: null, readError: "repository escapes GITHUB_ROOT" });
      continue;
    }
    const trackedPaths = readGitTrackedPaths(repositoryRoot);
    if (!trackedPaths) {
      files.push({
        path: name,
        text: null,
        readError: "repository is missing or is not bound to its declared Git root",
      });
      continue;
    }
    repositories.push({ name, trackedFileCount: trackedPaths.length });
    if (trackedPaths.length === 0) {
      files.push({ path: name, text: null, readError: "tracked-file inventory is empty" });
      continue;
    }
    for (const trackedPath of trackedPaths) {
      const repositoryPath = normalizeRepositoryPath(`${name}/${trackedPath}`);
      if (!repositoryPath) {
        files.push({
          path: name,
          text: null,
          readError: "Git returned a non-relative tracked path",
        });
        continue;
      }
      repositoryPaths.push(repositoryPath);
      if (!isAuthoredTextPath(repositoryPath)) continue;
      const text = readTrackedText(repositoryRoot, trackedPath);
      if (text === undefined) {
        files.push({
          path: repositoryPath,
          text: null,
          readError: "tracked file could not be read",
        });
      } else if (text !== null) {
        files.push({ path: repositoryPath, text });
      }
    }
  }
  includeExistingRootReferences({ root, files, repositoryPaths });
  return trackedInventory({
    root, files, repositoryPaths, repositories, expectedRepositoryCount: names.length,
  });
}
function includeExistingRootReferences({ root, files, repositoryPaths }) {
  for (const file of files) {
    if (typeof file.text !== "string") continue;
    GITHUB_ROOT_PATTERN.lastIndex = 0;
    for (const match of file.text.matchAll(GITHUB_ROOT_PATTERN)) {
      const path = normalizeRepositoryPath(
        trimPathPunctuation(match[0]).slice("$GITHUB_ROOT/".length),
      );
      if (!path) continue;
      const candidate = resolve(root, path);
      if (!pathIsWithinRoot(candidate, root)) continue;
      try {
        lstatSync(candidate);
        repositoryPaths.push(path);
      } catch {
        // Absence is reported later as an unresolved repository reference.
      }
    }
  }
}
function scanFile({ file, accounts, knownPaths, violations }) {
  const seen = new Set();
  const lines = splitLines(file.text);
  const lexicalLines = codeLikePath(file.path) ? scanEcmascriptLexicalLines(lines) : null;
  for (const [lineIndex, line] of lines.entries()) {
    for (const [kind, pattern] of [
      ["filesystem-root", POSIX_ROOT_PATTERN],
      ["filesystem-root", WINDOWS_DRIVE_PATTERN],
      ["filesystem-root", WINDOWS_UNC_PATTERN],
    ]) {
      pattern.lastIndex = 0;
      for (const match of line.matchAll(pattern)) {
        const columnIndex = match.index + match[0].indexOf(match[1]);
        if (!inAuditedLiteral(lexicalLines, lineIndex, columnIndex)) continue;
        addViolation({ violations, seen, file, lineIndex, line,
          kind, literal: match[1], column: columnIndex + 1 });
        const account = accountFromRootedPath(match[1]);
        if (account) addViolation({ violations, seen, file, lineIndex, line,
          kind: "account-name", literal: account,
          column: line.indexOf(account, match.index) + 1 });
      }
    }
    for (const account of accounts) {
      for (const column of accountAssignmentColumns(line, account)) {
        if (!inAuditedLiteral(lexicalLines, lineIndex, column - 1)) continue;
        addViolation({ violations, seen, file, lineIndex, line,
          kind: "account-name", literal: account, column });
      }
    }
    GITHUB_ROOT_PATTERN.lastIndex = 0;
    for (const match of line.matchAll(GITHUB_ROOT_PATTERN)) {
      if (!inAuditedLiteral(lexicalLines, lineIndex, match.index)) continue;
      const literal = trimPathPunctuation(match[0]);
      const repositoryPath = normalizeRepositoryPath(literal.slice("$GITHUB_ROOT/".length));
      const invalid = !repositoryPath;
      const unresolved = knownPaths && repositoryPath
        ? !resolvesKnownPath(repositoryPath, knownPaths)
        : false;
      if (invalid || unresolved) addViolation({ violations, seen, file, lineIndex, line,
        kind: invalid ? "invalid-github-root-reference" : "unresolved-github-root-reference",
        literal, column: match.index + 1 });
    }
    if (knownPaths) {
      REPOSITORY_PATH_PATTERN.lastIndex = 0;
      for (const match of line.matchAll(REPOSITORY_PATH_PATTERN)) {
        const literal = trimPathPunctuation(match[1]);
        const repositoryPath = normalizeRepositoryPath(literal);
        if (!repositoryPath || !resolvesKnownPath(repositoryPath, knownPaths)) continue;
        const columnIndex = match.index + match[0].indexOf(literal);
        if (!inAuditedLiteral(lexicalLines, lineIndex, columnIndex)) continue;
        addViolation({ violations, seen, file, lineIndex, line,
          kind: "unrooted-repository-reference", literal, column: columnIndex + 1 });
      }
    }
  }
  return Boolean(lexicalLines?.some(({ unsupported }) => unsupported));
}
function codeLikePath(path) {
  const extension = String(path ?? "").split(".").at(-1)?.toLowerCase();
  return CODE_LIKE_PATH_EXTENSIONS.has(extension);
}
function rangeContains(ranges, index) {
  return ranges.some(([start, end]) => index >= start && index < end);
}
function inAuditedLiteral(lexicalLines, lineIndex, columnIndex) {
  return !lexicalLines
    || rangeContains(lexicalLines[lineIndex].literalRanges, columnIndex);
}
export function scanEcmascriptLexicalLines(lines) {
  let state = null;
  let escaped = false;
  let templateDepth = 0;
  return lines.map((line) => {
    const code = line.split("");
    const ranges = [];
    let start = state && state !== "template-expression" ? 0 : null;
    let regularExpression = false;
    let characterClass = false;
    let unsupported = state === "template-expression";
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      const next = line[index + 1];
      if (state === "block-comment") {
        code[index] = " ";
        if (character === "*" && next === "/") {
          code[index + 1] = " ";
          ranges.push([start, index + 2]);
          state = null; start = null;
          index += 1;
        }
        continue;
      }
      if (state === "template-expression") {
        code[index] = " ";
        if (character === "{") templateDepth += 1;
        else if (character === "}") {
          templateDepth -= 1;
          if (templateDepth === 0) { state = "`"; start = index + 1; }
        }
        continue;
      }
      if (state) {
        code[index] = " ";
        if (state === "`" && !escaped && character === "$" && next === "{") {
          code[index + 1] = " ";
          ranges.push([start, index]);
          state = "template-expression"; templateDepth = 1;
          unsupported = true; start = null;
          index += 1;
          continue;
        }
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === state) {
          ranges.push([start, index + 1]);
          state = null; start = null;
        }
        continue;
      }
      if (regularExpression) {
        code[index] = " ";
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === "[") characterClass = true;
        else if (character === "]") characterClass = false;
        else if (character === "/" && !characterClass) regularExpression = false;
        continue;
      }
      if (character === "/" && next === "/") {
        code.fill(" ", index);
        ranges.push([index, line.length]);
        break;
      }
      if (character === "/" && next === "*") {
        code[index] = " "; code[index + 1] = " ";
        state = "block-comment"; start = index;
        index += 1;
        continue;
      }
      if (["'", '"', "`"].includes(character)) {
        code[index] = " "; state = character; start = index;
        continue;
      }
      if (character === "/" && canStartRegularExpression(code.slice(0, index).join(""))) {
        code[index] = " ";
        regularExpression = true;
      }
    }
    if (state && start !== null) ranges.push([start, line.length]);
    if (!["`", "block-comment", "template-expression"].includes(state) && !escaped) state = null;
    return { code: code.join(""), literalRanges: ranges, unsupported };
  });
}
function canStartRegularExpression(prefix) {
  const value = prefix.trimEnd();
  return value.length === 0
    || /[([{=,:;!?&|+*%^~<>-]$/u.test(value)
    || /\b(?:await|case|delete|in|instanceof|of|return|throw|typeof|void|yield)$/u.test(value);
}
function addViolation({
  violations, seen, file, lineIndex, line, kind, literal, column,
}) {
  const key = `${file.path}\0${lineIndex}\0${column}\0${kind}\0${literal}`;
  if (seen.has(key)) return;
  seen.add(key);
  violations.push({
    code: "path-portability",
    kind,
    path: file.path,
    line: lineIndex + 1,
    column,
    literal,
    excerpt: line.trim().slice(0, 240),
  });
}
function accountFromRootedPath(literal) {
  const posix = /^\/(?:Users|home)\/([^/]+)/u.exec(literal)?.[1];
  if (posix) return posix;
  return /^[A-Za-z]:[\\/]Users[\\/]([^\\/]+)/iu.exec(literal)?.[1] ?? null;
}
function normalizeAccounts(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => value.trim()))].sort((left, right) => left.localeCompare(right));
}
function accountAssignmentColumns(line, literal) {
  const escaped = literal.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(
    `\\b(?:USER|USERNAME|LOGNAME|account(?:_name)?|os_account)["']?\\s*[:=]\\s*["']?(${escaped})(?![A-Za-z0-9_.-])`,
    "giu",
  );
  return [...line.matchAll(pattern)].map((match) => (
    match.index + match[0].lastIndexOf(match[1]) + 1
  ));
}
function normalizeKnownPaths(values) {
  if (values === undefined || values === null) return {
    paths: null,
    error: "authoritative repository path inventory is required",
  };
  const source = Array.isArray(values)
    ? values
    : values instanceof Set ? [...values] : null;
  if (!source) return {
    paths: null,
    error: "repository path inventory must be an array or Set",
  };
  const normalized = source
    .map(normalizeRepositoryPath)
    .filter(Boolean);
  if (normalized.length !== source.length) return {
    paths: new Set(normalized),
    error: "repository path inventory contains a non-relative path",
  };
  return { paths: new Set(normalized), error: null };
}
function resolvesKnownPath(reference, knownPaths) {
  if (knownPaths.has(reference)) return true;
  return [...knownPaths].some((known) => known.startsWith(`${reference}/`));
}
function splitLines(text) {
  return text === "" ? [] : text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
}
function trimPathPunctuation(value) {
  return value.replace(/[.,;:!?]+$/gu, "");
}
function normalizeRepositoryNames(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.flatMap((value) => {
    const path = normalizeRepositoryPath(value);
    return path && !path.includes("/") ? [path] : [];
  }))].sort((left, right) => left.localeCompare(right, "en"));
}
function readGitTrackedPaths(repositoryRoot) {
  try {
    const declaredRoot = execFileSync(
      "git",
      ["-C", repositoryRoot, "rev-parse", "--show-toplevel"],
      gitOptions(),
    ).trim();
    if (realpathSync(declaredRoot) !== realpathSync(repositoryRoot)) return null;
    const output = execFileSync(
      "git",
      ["-C", repositoryRoot, "ls-files", "--cached", "-z"],
      gitOptions(),
    );
    return output.split("\0").filter(Boolean).sort((left, right) => (
      left.localeCompare(right, "en")
    ));
  } catch {
    return null;
  }
}
function gitOptions() {
  return {
    encoding: "utf8",
    timeout: GIT_INVENTORY_TIMEOUT_MS,
    maxBuffer: GIT_INVENTORY_MAX_BUFFER_BYTES,
    stdio: ["ignore", "pipe", "ignore"],
  };
}
function readTrackedText(repositoryRoot, trackedPath) {
  const path = resolve(repositoryRoot, trackedPath);
  if (!pathIsWithinRoot(path, repositoryRoot)) return undefined;
  try {
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) return readlinkSync(path, "utf8");
    if (!stats.isFile()) return null;
    const bytes = readFileSync(path);
    return bytes.includes(0) ? null : bytes.toString("utf8");
  } catch {
    return undefined;
  }
}
function pathIsWithinRoot(path, root) {
  const remainder = relative(root, path);
  return remainder.length > 0 && !remainder.startsWith("..") && !isAbsolute(remainder);
}
function trackedInventory({
  root, files, repositoryPaths, repositories, expectedRepositoryCount,
}) {
  const account = root ? accountFromRootedPath(root) : null;
  return {
    files,
    repositoryPaths: [...new Set(repositoryPaths)].sort((left, right) => (
      left.localeCompare(right, "en")
    )),
    accountNames: account ? [account] : [],
    scope: {
      rootBound: Boolean(
        root && expectedRepositoryCount > 0 && repositories.length === expectedRepositoryCount,
      ),
      repositories: [...repositories].sort((left, right) => (
        left.name.localeCompare(right.name, "en")
      )),
    },
  };
}
function comparePaths(left, right) {
  return String(left.path ?? "").localeCompare(String(right.path ?? ""), "en")
    || String(left.reason ?? "").localeCompare(String(right.reason ?? ""), "en");
}
function compareViolations(left, right) {
  return left.path.localeCompare(right.path, "en")
    || left.line - right.line
    || left.column - right.column
    || left.kind.localeCompare(right.kind, "en");
}
