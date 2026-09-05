// Responsibility: Resolve exact invocation tokens through one prefix-selected canonical dictionary without aliases, provider calls, or mutation.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  canonicalInvocationToken,
  malformedInvocationRuleFor,
} from "agentic-os/invocation";

export { canonicalInvocationToken, malformedInvocationRuleFor };

export const INVOCATION_RESOLUTION_SCHEMA = "agentic-game-os-invocation-resolution/v1";

const DEFAULT_DEADLINE_MILLISECONDS = 1_900;
const DEFAULT_DICTIONARY_ROOT = fileURLToPath(new URL("../docs/", import.meta.url));
const DICTIONARIES = Object.freeze([
  Object.freeze({
    prefix: "/",
    fileName: "DICTIONARY-COMMAND.md",
    tableHeading: "Commands",
    sourceDocumentPath: "agentic-canvas-os/docs/DICTIONARY-COMMAND.md",
  }),
  Object.freeze({
    prefix: "#",
    fileName: "DICTIONARY-SEMANTIC.md",
    tableHeading: "Tags",
    sourceDocumentPath: "agentic-canvas-os/docs/DICTIONARY-SEMANTIC.md",
  }),
  Object.freeze({
    prefix: "@",
    fileName: "DICTIONARY-BINDING.md",
    tableHeading: "Bindings",
    sourceDocumentPath: "agentic-canvas-os/docs/DICTIONARY-BINDING.md",
  }),
]);

const descriptorsByPrefix = new Map(DICTIONARIES.map((descriptor) => [descriptor.prefix, descriptor]));
const dictionaryPaths = () => DICTIONARIES.map(({ prefix, sourceDocumentPath }) => ({
  prefix,
  sourceDocumentPath,
}));

const normalizeTokens = (input) => {
  if (Array.isArray(input)) {
    return input.length > 0
      ? input.map((token) => typeof token === "string" ? token : String(token ?? ""))
      : [""];
  }
  if (typeof input !== "string") return [String(input ?? "")];
  const trimmed = input.trim();
  return trimmed ? trimmed.split(/\s+/u) : [""];
};

const malformedRuleFor = malformedInvocationRuleFor;

const splitMarkdownTableRow = (row) => {
  const cells = [];
  let cell = "";
  let escaped = false;
  const body = String(row).replace(/^\s*\|/u, "").replace(/\|\s*$/u, "");
  for (const character of body) {
    if (character === "|" && !escaped) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += character;
    escaped = character === "\\" && !escaped;
    if (character !== "\\") escaped = false;
  }
  cells.push(cell.trim());
  return cells;
};

const parseFrontmatterScalar = (value) => {
  const normalized = String(value ?? "").trim();
  const quoted = normalized.match(/^(?:"([^"]*)"|'([^']*)')$/u);
  return (quoted?.[1] ?? quoted?.[2] ?? normalized).trim();
};

const dictionaryMetadata = (markdown) => {
  const lines = String(markdown).split(/\r?\n/u);
  if (lines[0] !== "---") throw new Error("dictionary frontmatter is missing");
  const frontmatterEnd = lines.indexOf("---", 1);
  if (frontmatterEnd < 0) throw new Error("dictionary frontmatter is unterminated");
  const frontmatter = lines.slice(1, frontmatterEnd);
  const prefixLines = frontmatter.filter((line) => /^prefix:\s*/u.test(line));
  const prefixRoleLines = frontmatter.filter((line) => /^prefix_role:\s*/u.test(line));
  if (prefixLines.length !== 1 || prefixRoleLines.length !== 1) {
    throw new Error("dictionary prefix metadata is invalid");
  }
  const prefix = parseFrontmatterScalar(prefixLines[0].replace(/^prefix:\s*/u, ""));
  const prefixRole = parseFrontmatterScalar(prefixRoleLines[0].replace(/^prefix_role:\s*/u, ""));
  if (!prefixRole) throw new Error("dictionary prefix_role is missing");
  const entrySectionIndexes = frontmatter
    .map((line, index) => /^dictionary_entries:\s*$/u.test(line) ? index : -1)
    .filter((index) => index >= 0);
  if (entrySectionIndexes.length !== 1) throw new Error("dictionary_entries is invalid");
  const [start] = entrySectionIndexes;

  const tokens = [];
  for (const line of frontmatter.slice(start + 1)) {
    if (/^[a-zA-Z0-9_-]+:\s*/u.test(line)) break;
    const match = line.match(/^\s{2}-\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*$/u);
    const token = match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
    if (token) tokens.push(token);
  }
  return { prefix, prefixRole, tokens };
};

const tableRowsForToken = (markdown, tableHeading, token) => {
  const lines = String(markdown).split(/\r?\n/u);
  const headingIndexes = lines
    .map((line, index) => line.trim() === `## ${tableHeading}` ? index : -1)
    .filter((index) => index >= 0);
  if (headingIndexes.length !== 1) throw new Error("dictionary table heading is invalid");
  const [headingIndex] = headingIndexes;
  const nextHeadingOffset = lines
    .slice(headingIndex + 1)
    .findIndex((line) => /^##\s+/u.test(line));
  const sectionEnd = nextHeadingOffset < 0
    ? lines.length
    : headingIndex + 1 + nextHeadingOffset;
  return lines
    .slice(headingIndex + 1, sectionEnd)
    .filter((line) => {
      if (!/^\s*\|/u.test(line)) return false;
      const firstCell = splitMarkdownTableRow(line)[0] ?? "";
      return firstCell === `\`${token}\``;
    });
};

const readBeforeDeadline = (readDictionary, absolutePath, deadlineMilliseconds) => new Promise(
  (resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("dictionary read deadline exceeded")),
      deadlineMilliseconds,
    );
    Promise.resolve()
      .then(() => readDictionary(absolutePath))
      .then(resolve, reject)
      .finally(() => clearTimeout(timeout));
  },
);

const zeroCostRecord = (token) => ({
  token,
  modelIdentity: null,
  promptTokenCount: 0,
  completionTokenCount: 0,
  estimatedCost: 0,
});

const resolveToken = async ({
  token,
  descriptor,
  dictionaryRoot,
  readDictionary,
  deadlineMilliseconds,
}) => {
  const absolutePath = path.join(dictionaryRoot, descriptor.fileName);
  let markdown;
  try {
    markdown = String(await readBeforeDeadline(readDictionary, absolutePath, deadlineMilliseconds));
  } catch {
    return {
      status: "unresolved",
      code: "unresolved",
      token,
      reason: "dictionary-unreadable",
      dictionaryPaths: dictionaryPaths(),
      costRecord: zeroCostRecord(token),
    };
  }

  const declaredToken = canonicalInvocationToken(token);
  let metadata;
  let rows;
  try {
    metadata = dictionaryMetadata(markdown);
    if (metadata.prefix !== descriptor.prefix) throw new Error("dictionary prefix does not match its path");
    rows = tableRowsForToken(markdown, descriptor.tableHeading, declaredToken);
  } catch {
    return {
      status: "unresolved",
      code: "unresolved",
      token,
      reason: "dictionary-unreadable",
      dictionaryPaths: dictionaryPaths(),
      costRecord: zeroCostRecord(token),
    };
  }

  const entryCount = metadata.tokens.filter((listedToken) => listedToken === declaredToken).length;
  if (entryCount > 1 || rows.length > 1) {
    return {
      status: "rejected",
      code: "ambiguous-entry",
      token,
      dictionaryPath: descriptor.sourceDocumentPath,
      count: Math.max(entryCount, rows.length),
      costRecord: zeroCostRecord(token),
    };
  }
  if (entryCount === 0) {
    return {
      status: "unresolved",
      code: "unresolved",
      token,
      reason: "absent",
      dictionaryPaths: dictionaryPaths(),
      costRecord: zeroCostRecord(token),
    };
  }
  if (rows.length !== 1) {
    return {
      status: "unresolved",
      code: "unresolved",
      token,
      reason: "dictionary-unreadable",
      dictionaryPaths: dictionaryPaths(),
      costRecord: zeroCostRecord(token),
    };
  }

  const summary = splitMarkdownTableRow(rows[0])[1]?.replace(/\s+/gu, " ").trim() ?? "";
  if (!summary) {
    return {
      status: "unresolved",
      code: "unresolved",
      token,
      reason: "dictionary-unreadable",
      dictionaryPaths: dictionaryPaths(),
      costRecord: zeroCostRecord(token),
    };
  }
  return {
    status: "resolved",
    token,
    entry: {
      token: declaredToken,
      prefixRole: metadata.prefixRole,
      summary,
      sourceDocumentPath: descriptor.sourceDocumentPath,
    },
    costRecord: zeroCostRecord(token),
  };
};

export async function resolveInvocation(input, {
  dictionaryRoot = DEFAULT_DICTIONARY_ROOT,
  readDictionary = (absolutePath) => readFile(absolutePath, "utf8"),
  deadlineMilliseconds = DEFAULT_DEADLINE_MILLISECONDS,
  now = () => performance.now(),
} = {}) {
  const startedAt = now();
  const tokens = normalizeTokens(input);
  const malformed = tokens
    .map((token) => ({ token, violatedRule: malformedRuleFor(token) }))
    .find(({ violatedRule }) => violatedRule);
  if (malformed) {
    return {
      schema: INVOCATION_RESOLUTION_SCHEMA,
      ok: false,
      status: "rejected",
      code: "malformed-token",
      tokens,
      error: { code: "malformed-token", ...malformed },
      results: [],
      costRecords: [],
      elapsedMilliseconds: Math.max(0, now() - startedAt),
    };
  }

  const duplicatedPrefixes = DICTIONARIES
    .map(({ prefix }) => ({ prefix, tokens: tokens.filter((token) => token.startsWith(prefix)) }))
    .filter(({ tokens: matchingTokens }) => matchingTokens.length > 1);
  if (tokens.length > 3 || duplicatedPrefixes.length > 0) {
    return {
      schema: INVOCATION_RESOLUTION_SCHEMA,
      ok: false,
      status: "rejected",
      code: "duplicate-prefix",
      tokens,
      error: {
        code: "duplicate-prefix",
        reason: tokens.length > 3 ? "token-limit-exceeded" : "prefix-limit-exceeded",
        duplicatedPrefixes,
      },
      results: [],
      costRecords: [],
      elapsedMilliseconds: Math.max(0, now() - startedAt),
    };
  }

  const requestedDeadline = Number(deadlineMilliseconds);
  const boundedDeadline = Number.isFinite(requestedDeadline)
    ? Math.max(1, Math.min(DEFAULT_DEADLINE_MILLISECONDS, requestedDeadline))
    : DEFAULT_DEADLINE_MILLISECONDS;
  const results = await Promise.all(tokens.map((token) => resolveToken({
    token,
    descriptor: descriptorsByPrefix.get(token[0]),
    dictionaryRoot,
    readDictionary,
    deadlineMilliseconds: boundedDeadline,
  })));
  const status = results.some((result) => result.status === "rejected")
    ? "rejected"
    : results.some((result) => result.status === "unresolved") ? "unresolved" : "resolved";
  const costRecords = results.map(({ costRecord }) => costRecord);
  const publicResults = results.map(({ costRecord: _costRecord, ...result }) => result);

  return {
    schema: INVOCATION_RESOLUTION_SCHEMA,
    ok: status === "resolved",
    status,
    tokens,
    results: publicResults,
    costRecords,
    elapsedMilliseconds: Math.max(0, now() - startedAt),
  };
}

const isDirectExecution = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  const result = await resolveInvocation(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}
