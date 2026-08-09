// Responsibility: Enforce authored-file line limits and structural responsibility ownership.

import {
  AUDITED_REPOSITORY_NAMES,
  collectTrackedAuthoredFiles,
  digestAuthoredText,
  normalizeAuthoredFiles,
  normalizeRepositoryPath,
  normalizeUnscannedSubjects,
  scanEcmascriptLexicalLines,
} from "./path-portability-auditor.mjs";

export const FILE_SIZE_AUDIT_SCHEMA = "agentic-game-os-file-size-audit/v1";
export const DEFAULT_AUTHORED_FILE_LINE_LIMIT = 600;

const SLASH_MARKER = /^\/\/ Responsibility: (\S(?:.*\S)?)$/u;
const MARKDOWN_MARKER = /^<!-- Responsibility: (\S(?:.*\S)?) -->$/u;
const HASH_MARKER = /^# Responsibility: (\S(?:.*\S)?)$/u;
const BLOCK_MARKER = /^\/\* Responsibility: (\S(?:.*\S)?) \*\/$/u;
const JSON_MARKER = /^\s*(?:\{\s*)?"responsibility"\s*:\s*"(\S(?:[^"]*\S)?)"\s*[,}]?\s*$/u;
const PLAIN_MARKER = /^Responsibility: (\S(?:.*\S)?)$/u;
const SLASH_EXTENSIONS = new Set([
  "c", "cc", "cpp", "cs", "cjs", "dart", "go", "java", "js", "jsx", "kt", "kts",
  "mjs", "php", "rs", "scala", "swift", "ts", "tsx",
]);
const MARKDOWN_EXTENSIONS = new Set(["htm", "html", "md", "mdx", "svg", "xml"]);
const HASH_EXTENSIONS = new Set([
  "bash", "conf", "ini", "properties", "py", "rb", "sh", "toml", "yaml", "yml", "zsh",
]);
const BLOCK_EXTENSIONS = new Set(["css", "less", "sass", "scss"]);
const JSON_EXTENSIONS = new Set(["json", "jsonl"]);
const ECMASCRIPT_EXTENSIONS = new Set(["mjs"]);
const MODULE_GRAMMAR_EXTENSIONS = new Set([
  "bash", "c", "cc", "cjs", "cpp", "cs", "dart", "go", "java", "js", "jsx", "kt", "kts",
  "mdx", "php", "py", "rb", "rs", "scala", "sh", "swift", "ts", "tsx", "zsh",
]);

export function countNewlineSeparatedLines(text) {
  if (typeof text !== "string" || text.length === 0) return 0;
  const lines = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  return text.endsWith("\n") || text.endsWith("\r") ? lines.length - 1 : lines.length;
}

export function parseResponsibilityContract({ path, text } = {}) {
  const extension = String(path ?? "").split(".").at(-1)?.toLowerCase() ?? "";
  const lines = typeof text === "string"
    ? text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n")
    : [];
  const markerPattern = responsibilityPattern(extension);

  const statements = [];
  for (const [index, line] of lines.entries()) {
    const match = markerPattern.exec(line);
    if (match) statements.push({ line: index + 1, statement: match[1] });
  }
  const expectedLine = expectedResponsibilityLine(extension, lines);
  const marker = statements.length === 1 ? statements[0] : null;
  const placementValid = Boolean(marker && marker.line === expectedLine);
  const exportScan = exportedSymbols(lines, extension);
  const exports = exportScan.symbols;
  const offendingExports = statements.length === 1
    ? exports.filter((entry) => entry.line < marker.line)
    : exports;
  return {
    applicable: true,
    marker,
    statementCount: statements.length,
    markerLines: statements.map(({ line }) => line),
    placementValid,
    exports,
    unsupportedExports: exportScan.unsupported,
    exportGrammar: exportScan.grammar,
    offendingExports,
  };
}

export function auditFileSizes({
  files = [],
  lineLimit = DEFAULT_AUTHORED_FILE_LINE_LIMIT,
  requireResponsibility = true,
  authoritativeAssignments,
} = {}) {
  const normalizedLimit = Number.isSafeInteger(lineLimit) && lineLimit > 0
    ? lineLimit
    : DEFAULT_AUTHORED_FILE_LINE_LIMIT;
  const normalizedFiles = normalizeAuthoredFiles(files);
  const violations = [];
  const unscannedFiles = [];
  const measurements = [];
  const assignments = normalizeResponsibilityAssignments(authoritativeAssignments);
  unscannedFiles.push(...assignments.invalid);

  if (normalizedFiles.length === 0) unscannedFiles.push({
    path: "<audit-scope>",
    reason: "authored tracked-file scope is empty",
  });

  for (const file of normalizedFiles) {
    if (!file.path || file.readError || file.text === null) {
      unscannedFiles.push({
        path: file.path ?? "<invalid-repository-path>",
        reason: file.readError ?? "text is unavailable",
      });
      continue;
    }
    const lineCount = countNewlineSeparatedLines(file.text);
    const responsibility = parseResponsibilityContract(file);
    measurements.push({ path: file.path, lineCount });
    if (lineCount > normalizedLimit) violations.push({
      code: "file-size",
      path: file.path,
      lineCount,
      limit: normalizedLimit,
    });
    const exportBinding = requireResponsibility
      ? validateExportBinding({
        file,
        responsibility,
        assignment: assignments.byPath.get(file.path),
      })
      : { incompleteReason: null, responsibilityMismatch: false, detail: null };
    if (exportBinding.incompleteReason) unscannedFiles.push({
      path: file.path,
      reason: exportBinding.incompleteReason,
    });
    if (requireResponsibility && responsibility.applicable && (
      responsibility.statementCount !== 1
      || !responsibility.placementValid
      || responsibility.offendingExports.length > 0
      || exportBinding.responsibilityMismatch
    )) violations.push({
      code: "single-responsibility",
      path: file.path,
      statementCount: responsibility.statementCount,
      markerLines: responsibility.markerLines,
      placementValid: responsibility.placementValid,
      offendingExports: exportBinding.responsibilityMismatch
        ? exportBinding.offendingExports
        : responsibility.offendingExports,
      exportBinding: exportBinding.detail,
    });
  }

  measurements.sort(comparePaths);
  violations.sort(compareViolations);
  const uniqueUnscannedFiles = normalizeUnscannedSubjects(unscannedFiles);
  const status = uniqueUnscannedFiles.length > 0
    ? "incomplete"
    : violations.length > 0 ? "failed" : "passed";
  return {
    schema: FILE_SIZE_AUDIT_SCHEMA,
    status,
    outcome: status === "passed"
      ? "within-bounds"
      : status === "failed" ? violations[0].code : "audit-incomplete",
    lineLimit: normalizedLimit,
    measurements,
    violations,
    unscannedFiles: uniqueUnscannedFiles,
    summary: {
      scannedFileCount: measurements.length,
      oversizedFileCount: violations.filter(({ code }) => code === "file-size").length,
      responsibilityViolationCount:
        violations.filter(({ code }) => code === "single-responsibility").length,
      unscannedFileCount: uniqueUnscannedFiles.length,
    },
  };
}

export const auditFileSize = auditFileSizes;

export function auditTrackedFileSizes({
  githubRoot,
  repositoryNames = AUDITED_REPOSITORY_NAMES,
  lineLimit = DEFAULT_AUTHORED_FILE_LINE_LIMIT,
  requireResponsibility = true,
  authoritativeAssignments,
} = {}) {
  const inventory = collectTrackedAuthoredFiles({ githubRoot, repositoryNames });
  const audit = auditFileSizes({
    files: inventory.files,
    lineLimit,
    requireResponsibility,
    authoritativeAssignments,
  });
  return { ...audit, scope: inventory.scope };
}

function firstSlashMarkerLine(lines) {
  let index = 0;
  if (lines[0]?.startsWith("#!")) index = 1;
  while (lines[index]?.trim() === "") index += 1;
  return index + 1;
}

function firstMarkdownMarkerLine(lines) {
  let index = 0;
  if (lines[0] === "---") {
    const closingOffset = lines.slice(1).findIndex((line) => line === "---");
    if (closingOffset >= 0) index = closingOffset + 2;
  }
  while (lines[index]?.trim() === "") index += 1;
  return index + 1;
}

function responsibilityPattern(extension) {
  if (SLASH_EXTENSIONS.has(extension)) return SLASH_MARKER;
  if (MARKDOWN_EXTENSIONS.has(extension)) return MARKDOWN_MARKER;
  if (HASH_EXTENSIONS.has(extension)) return HASH_MARKER;
  if (BLOCK_EXTENSIONS.has(extension)) return BLOCK_MARKER;
  if (JSON_EXTENSIONS.has(extension)) return JSON_MARKER;
  return PLAIN_MARKER;
}

function expectedResponsibilityLine(extension, lines) {
  if (SLASH_EXTENSIONS.has(extension) || HASH_EXTENSIONS.has(extension)) {
    return firstSlashMarkerLine(lines);
  }
  if (["md", "mdx"].includes(extension)) return firstMarkdownMarkerLine(lines);
  let index = 0;
  while (lines[index]?.trim() === "") index += 1;
  if (JSON_EXTENSIONS.has(extension) && lines[index]?.trim() === "{") index += 1;
  while (lines[index]?.trim() === "") index += 1;
  return index + 1;
}

function exportedSymbols(lines, extension) {
  const symbols = [];
  const unsupported = [];
  if (MODULE_GRAMMAR_EXTENSIONS.has(extension)) return {
    symbols,
    unsupported: [{ line: 1, syntax: `${extension}-export-grammar` }],
    grammar: "unsupported",
  };
  if (!ECMASCRIPT_EXTENSIONS.has(extension)) {
    return { symbols, unsupported, grammar: "none" };
  }
  const codeLines = scanEcmascriptLexicalLines(lines).map(({ code }) => code);
  for (let index = 0; index < lines.length; index += 1) {
    const sourceLine = lines[index];
    const line = codeLines[index];
    if (/\bmodule\.exports\b|^\s*exports\.[A-Za-z_$]/u.test(line)) {
      unsupported.push({ line: index + 1, syntax: "commonjs-export" });
      continue;
    }
    if (!/^\s*export\b/u.test(sourceLine)) {
      if (/\bexport\b/u.test(line)) unsupported.push({
        line: index + 1,
        syntax: "non-leading-export",
      });
      continue;
    }
    if ([...line.matchAll(/\bexport\b/gu)].length !== 1) {
      unsupported.push({ line: index + 1, syntax: "multiple-export-statements" });
      continue;
    }
    const declaration = /^\s*export\s+(?:(?:abstract|async|declare)\s+)*(const|class|enum|function|interface|let|namespace|type|var)\s+([A-Za-z_$][\w$]*)/u.exec(line);
    if (declaration) {
      if (["const", "let", "var"].includes(declaration[1]) && line.includes(",")) {
        unsupported.push({ line: index + 1, syntax: "multi-declarator-export" });
        continue;
      }
      symbols.push({ symbol: declaration[2], line: index + 1 });
      continue;
    }
    if (/^\s*export\s+default\b/u.test(line)) {
      symbols.push({ symbol: "default", line: index + 1 });
      continue;
    }
    const namespace = /^\s*export\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\b/u.exec(line);
    if (namespace) {
      symbols.push({ symbol: namespace[1], line: index + 1 });
      continue;
    }
    if (/^\s*export\s+\*/u.test(line)) {
      unsupported.push({ line: index + 1, syntax: "wildcard-re-export" });
      continue;
    }
    let statement = line;
    let closingLine = index;
    while (statement.includes("{") && !statement.includes("}")
      && closingLine + 1 < lines.length) {
      closingLine += 1;
      statement += `\n${codeLines[closingLine]}`;
    }
    const list = /^\s*export\s+(?:type\s+)?\{([\s\S]*?)\}/u.exec(statement)?.[1];
    if (list !== undefined) {
      for (const entry of list.split(",")) {
        const symbol = entry.trim().replace(/^type\s+/u, "")
          .split(/\s+as\s+/u).at(-1);
        if (symbol) symbols.push({ symbol, line: index + 1 });
      }
      index = closingLine;
      continue;
    }
    unsupported.push({ line: index + 1, syntax: "unrecognized-export" });
  }
  return {
    symbols: symbols.filter((value, index, values) => values.findIndex((candidate) => (
      candidate.symbol === value.symbol
    )) === index).sort((left, right) => left.symbol.localeCompare(right.symbol, "en")),
    unsupported,
    grammar: "ecmascript",
  };
}

function normalizeResponsibilityAssignments(values) {
  const source = Array.isArray(values)
    ? values
    : values && typeof values === "object"
      ? Object.entries(values).map(([path, value]) => ({ ...value, path }))
      : [];
  const byPath = new Map();
  const invalid = [];
  for (const [index, value] of source.entries()) {
    const path = normalizeRepositoryPath(value?.path);
    const exports = Array.isArray(value?.exports) ? value.exports.map((entry) => ({
      symbol: entry?.symbol,
      responsibilityStatement: entry?.responsibilityStatement,
    })).sort((left, right) => String(left.symbol).localeCompare(String(right.symbol), "en")) : null;
    const symbols = exports?.map(({ symbol }) => symbol) ?? [];
    const valid = Boolean(
      path && !byPath.has(path) && /^[a-f0-9]{64}$/u.test(value?.sourceDigest)
      && typeof value?.responsibilityStatement === "string"
      && value.responsibilityStatement.trim() && exports
      && exports.every(({ symbol, responsibilityStatement }) => (
        typeof symbol === "string" && symbol
        && typeof responsibilityStatement === "string" && responsibilityStatement.trim()
      ))
      && new Set(symbols).size === symbols.length,
    );
    if (!valid) invalid.push({
      path: path ?? `<responsibility-assignment-${index + 1}>`,
      reason: "digest-bound responsibility/export assignment is malformed or duplicated",
    });
    else byPath.set(path, { ...value, exports });
  }
  return { byPath, invalid };
}

function validateExportBinding({ file, responsibility, assignment }) {
  const exports = [...new Set(responsibility.exports.map(({ symbol }) => symbol))]
    .sort((left, right) => left.localeCompare(right, "en"));
  if (responsibility.unsupportedExports.length > 0) return {
    incompleteReason: `unsupported export grammar at lines ${responsibility.unsupportedExports
      .map(({ line }) => line).join(", ")}`,
    responsibilityMismatch: false,
    detail: null,
    offendingExports: [],
  };
  if (responsibility.exportGrammar !== "ecmascript") return {
    incompleteReason: null, responsibilityMismatch: false, detail: null, offendingExports: [],
  };
  if (!assignment) return {
    incompleteReason: "digest-bound responsibility/export assignment is absent",
    responsibilityMismatch: false,
    detail: null,
    offendingExports: [],
  };
  if (assignment.sourceDigest !== digestAuthoredText(file.text)) return {
    incompleteReason: "responsibility/export assignment source digest is stale",
    responsibilityMismatch: false,
    detail: null,
    offendingExports: [],
  };
  const assignedSymbols = assignment.exports.map(({ symbol }) => symbol);
  if (assignedSymbols.length !== exports.length
    || assignedSymbols.some((symbol, index) => symbol !== exports[index])) return {
    incompleteReason: "responsibility/export assignment does not enumerate exact exports",
    responsibilityMismatch: false,
    detail: null,
    offendingExports: [],
  };
  const marker = responsibility.marker?.statement;
  const offendingSymbols = new Set(assignment.exports
    .filter((entry) => entry.responsibilityStatement !== marker)
    .map(({ symbol }) => symbol));
  const responsibilityMismatch = assignment.responsibilityStatement !== marker
    || offendingSymbols.size > 0;
  return {
    incompleteReason: null,
    responsibilityMismatch,
    offendingExports: responsibility.exports.filter(({ symbol }) => offendingSymbols.has(symbol)),
    detail: !responsibilityMismatch ? null : {
      required: true,
      sourceDigestMatched: true,
      responsibilityMatched: false,
      declaredExports: assignment.exports,
      observedExports: exports,
    },
  };
}

function comparePaths(left, right) {
  return left.path.localeCompare(right.path, "en");
}

function compareViolations(left, right) {
  return left.path.localeCompare(right.path, "en")
    || left.code.localeCompare(right.code, "en");
}
