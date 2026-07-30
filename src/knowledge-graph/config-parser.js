import { tokenize } from "./tokenizer.js";
import {
  createEntity,
  createIr,
  createReference,
  createSpanLocator,
  diagnostic,
  parserIdentity,
  spanFromTokens,
} from "./ir.js";

const VERSION = "1.0.0";
const MAX_JSON_DEPTH = 256;
const MAX_CONFIG_LINES = 50_000;
const MAX_CONFIG_RECORDS = 10_000;
const EXTENSIONS = [
  ".json", ".jsonc", ".yaml", ".yml", ".toml", ".ini", ".env",
  ".properties", ".conf", ".cfg", "dockerfile", "makefile",
];
const DEPENDENCY_SECTIONS = new Set([
  "dependencies", "devdependencies", "peerdependencies", "optionaldependencies",
  "bundleddependencies", "plugins",
]);
const PATH_KEYS = new Set(["$ref", "extends", "include", "schema", "config", "preset"]);

export const CONFIG_EXTENSIONS = Object.freeze(EXTENSIONS);

export function supportsConfigPath(path) {
  const lower = path.toLowerCase();
  return EXTENSIONS.some((extension) => lower.endsWith(extension))
    || /(^|\/)(dockerfile|makefile)$/i.test(path);
}

export function parseConfig({ path, source }) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".json") || lower.endsWith(".jsonc")) return parseJsonConfig({ path, source, comments: lower.endsWith(".jsonc") });
  return parseLineConfig({ path, source, format: formatFor(lower) });
}

function parseJsonConfig({ path, source, comments }) {
  const entities = [];
  const references = [];
  const diagnostics = [];
  const recordState = { count: 0, truncated: false };
  let ast;
  try {
    const syntaxSource = prepareJsonSyntax(source, comments);
    JSON.parse(syntaxSource);
    const tokens = tokenize(syntaxSource, { commentPrefixes: [], caseSensitive: true });
    const cursor = { tokens: tokens.filter((token) => token.value !== "\n"), index: 0 };
    ast = parseJsonValue(cursor, 0);
    if (cursor.index !== cursor.tokens.length) throw new SyntaxError("unexpected trailing JSON tokens");
    emitJsonFacts({
      path, node: ast, pathParts: [], parentId: null,
      entities, references, recordState,
    });
    if (recordState.truncated) diagnostics.push(recordLimitDiagnostic());
  } catch (error) {
    entities.length = 0;
    references.length = 0;
    diagnostics.push(diagnostic({
      code: "config_json_invalid",
      message: error instanceof Error ? error.message : String(error),
      severity: "error",
    }));
    ast = { type: "invalid-json", children: [] };
  }
  return createIr({
    path,
    source,
    parser: parserIdentity("builtin.config.json", VERSION, {
      comments, maxDepth: MAX_JSON_DEPTH, maxRecords: MAX_CONFIG_RECORDS,
    }),
    astChildren: ast.children ?? [ast],
    entities,
    references,
    diagnostics,
  });
}

function parseJsonValue(cursor, depth) {
  if (depth > MAX_JSON_DEPTH) {
    throw new SyntaxError(`JSON nesting exceeds ${MAX_JSON_DEPTH} levels`);
  }
  const token = cursor.tokens[cursor.index];
  if (!token) throw new SyntaxError("unexpected end of JSON input");
  if (token.value === "{") return parseJsonObject(cursor, depth);
  if (token.value === "[") return parseJsonArray(cursor, depth);
  cursor.index += 1;
  if (token.type === "string") {
    return { type: "string", value: decodeString(token.raw ?? token.value), span: spanFromTokens(token) };
  }
  if (token.type === "number") return { type: "number", value: Number(token.value), span: spanFromTokens(token) };
  if (["true", "false", "null"].includes(token.value)) {
    return { type: token.value === "null" ? "null" : "boolean", value: token.value === "true" ? true : token.value === "false" ? false : null, span: spanFromTokens(token) };
  }
  throw new SyntaxError(`unexpected JSON token ${token.raw ?? token.value}`);
}

function parseJsonObject(cursor, depth) {
  const open = consume(cursor, "{");
  const children = [];
  while (peek(cursor)?.value !== "}") {
    const keyToken = peek(cursor);
    if (!keyToken || keyToken.type !== "string") throw new SyntaxError("JSON object key must be a string");
    cursor.index += 1;
    consume(cursor, ":");
    const value = parseJsonValue(cursor, depth + 1);
    children.push({
      type: "property",
      key: decodeString(keyToken.raw ?? keyToken.value),
      keySpan: spanFromTokens(keyToken),
      value,
      span: mergeSpan(keyToken, value),
    });
    if (peek(cursor)?.value !== ",") break;
    cursor.index += 1;
  }
  const close = consume(cursor, "}");
  return { type: "object", children, span: spanFromTokens(open, close) };
}

function parseJsonArray(cursor, depth) {
  const open = consume(cursor, "[");
  const children = [];
  while (peek(cursor)?.value !== "]") {
    children.push(parseJsonValue(cursor, depth + 1));
    if (peek(cursor)?.value !== ",") break;
    cursor.index += 1;
  }
  const close = consume(cursor, "]");
  return { type: "array", children, span: spanFromTokens(open, close) };
}

function emitJsonFacts({
  path, node, pathParts, parentId, entities, references, recordState,
}) {
  if (recordState.truncated) return;
  if (node.type === "object") {
    for (const property of node.children) {
      const keyPath = [...pathParts, property.key];
      if (!claimRecord(recordState)) return;
      const entity = createEntity({
        path,
        kind: "config-key",
        name: jsonPointer(keyPath),
        span: property.span,
        ruleId: "config.json.property",
        parentId,
        properties: { valueType: property.value.type },
      });
      entities.push(entity);
      emitConfigReferences({
        path,
        keyPath,
        value: primitiveValue(property.value),
        span: property.value.span,
        sourceId: entity.id,
        references,
        recordState,
      });
      emitJsonFacts({
        path,
        node: property.value,
        pathParts: keyPath,
        parentId: entity.id,
        entities,
        references,
        recordState,
      });
      if (recordState.truncated) return;
    }
  } else if (node.type === "array") {
    for (let index = 0; index < node.children.length; index += 1) {
      emitJsonFacts({
        path, node: node.children[index], pathParts: [...pathParts, String(index)],
        parentId, entities, references, recordState,
      });
      if (recordState.truncated) return;
    }
  }
}

function parseLineConfig({ path, source, format }) {
  const locateSpan = createSpanLocator(source);
  const entities = [];
  const references = [];
  const diagnostics = [];
  const astChildren = [];
  const sections = [];
  const indentScopes = [];
  const recordState = { count: 0, truncated: false };
  let blockScalarIndent = null;
  let lineCount = 0;

  for (const { rawLine, lineStart } of configLines(source)) {
    if (lineCount >= MAX_CONFIG_LINES) {
      diagnostics.push(diagnostic({
        code: "config_line_limit",
        message: `Config parsing stopped at the ${MAX_CONFIG_LINES}-line limit.`,
        severity: "warning",
        span: locateSpan(lineStart, lineStart + rawLine.length),
        detail: { limit: MAX_CONFIG_LINES, partial: true },
      }));
      break;
    }
    lineCount += 1;
    const trimmed = rawLine.trim();
    const indent = rawLine.length - rawLine.trimStart().length;
    if (format === "yaml" && blockScalarIndent !== null) {
      if (!trimmed || indent > blockScalarIndent) continue;
      blockScalarIndent = null;
    }
    if (!trimmed || commentLine(trimmed, format)) continue;
    const section = parseSection(trimmed, format);
    if (section) {
      if (!claimRecord(recordState)) break;
      sections.length = 0;
      sections.push(...section.parts);
      indentScopes.length = 0;
      astChildren.push({ type: "section", name: sections.join("."), span: locateSpan(lineStart, lineStart + rawLine.length) });
      continue;
    }
    const pair = parsePair(rawLine, format);
    if (!pair) {
      if (!claimRecord(recordState)) break;
      diagnostics.push(diagnostic({
        code: "config_line_unsupported",
        message: `Unsupported ${format} line.`,
        severity: "info",
        span: locateSpan(lineStart, lineStart + rawLine.length),
      }));
      continue;
    }
    if (!claimRecord(recordState)) break;
    if (format === "yaml") {
      while (indentScopes.length > 0 && indent <= indentScopes.at(-1).indent) indentScopes.pop();
    }
    const prefix = format === "yaml"
      ? [...sections, ...indentScopes.map((scope) => scope.key)]
      : sections;
    const keyPath = [...prefix, pair.key];
    const keyStart = lineStart + pair.keyOffset;
    const valueStart = lineStart + pair.valueOffset;
    const entitySpan = locateSpan(keyStart, lineStart + rawLine.length);
    const parentId = format === "yaml" ? indentScopes.at(-1)?.entity.id ?? null : null;
    const entity = createEntity({
      path,
      kind: "config-key",
      name: keyPath.join("."),
      span: entitySpan,
      ruleId: `config.${format}.pair`,
      parentId,
      properties: { valueType: inferValueType(pair.value) },
    });
    entities.push(entity);
    astChildren.push({ type: "property", name: entity.name, id: entity.id, span: entity.span });
    const valueSpan = locateSpan(valueStart, lineStart + rawLine.length);
    emitConfigReferences({
      path, keyPath,
      value: normalizeScalar(pair.value),
      span: valueSpan,
      sourceId: entity.id,
      references,
      recordState,
    });
    if (format === "dockerfile") emitDockerfileReference({
      path, pair, span: valueSpan, sourceId: entity.id, references, recordState,
    });
    if (format === "yaml" && isYamlBlockScalar(pair.value)) blockScalarIndent = indent;
    if (format === "yaml" && pair.value === "") indentScopes.push({ indent, key: pair.key, entity });
    if (recordState.truncated) break;
  }
  if (recordState.truncated) diagnostics.push(recordLimitDiagnostic());

  return createIr({
    path,
    source,
    parser: parserIdentity(`builtin.config.${format}`, VERSION, {
      format, maxLines: MAX_CONFIG_LINES, maxRecords: MAX_CONFIG_RECORDS,
    }),
    astChildren,
    entities,
    references,
    diagnostics,
  });
}

function emitConfigReferences({
  path, keyPath, value, span, sourceId, references, recordState,
}) {
  if (typeof value !== "string") return;
  const key = keyPath.at(-1)?.toLowerCase() ?? "";
  const parent = keyPath.at(-2)?.toLowerCase() ?? "";
  const append = (options) => {
    if (!claimRecord(recordState)) return false;
    references.push(createReference(options));
    return true;
  };
  if (DEPENDENCY_SECTIONS.has(parent) && keyPath.at(-1)) {
    if (!append({
      path,
      relation: "depends-on",
      targetKind: "module",
      target: keyPath.at(-1),
      span,
      ruleId: "config.dependency-entry",
      sourceId,
      certainty: "observed",
      properties: { requirement: value },
    })) return;
  }
  if (PATH_KEYS.has(key) && looksLikePath(value)) {
    if (!append({
      path,
      relation: "configures-from",
      targetKind: "document",
      target: value,
      span,
      ruleId: "config.path-reference",
      sourceId,
      certainty: "observed",
    })) return;
  }
  for (const match of value.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
    if (!append({
      path,
      relation: "reads-config",
      targetKind: "config-key",
      target: match[1],
      span,
      ruleId: "config.environment-reference",
      sourceId,
      certainty: "observed",
    })) return;
  }
}

function parseSection(trimmed, format) {
  if (format === "toml" || format === "ini") {
    const match = /^\[([^\]]+)\]$/.exec(trimmed);
    if (match) return { parts: match[1].split(".").map((part) => unquote(part.trim())) };
  }
  return null;
}

function parsePair(rawLine, format) {
  if (format === "dockerfile") {
    const directive = /^(\s*)([A-Za-z][A-Za-z0-9_-]*)[ \t]+(.*\S)[ \t]*$/.exec(rawLine);
    if (directive) {
      const value = directive[3].trim();
      return {
        key: directive[2].toLowerCase(),
        value,
        keyOffset: directive[1].length,
        valueOffset: rawLine.indexOf(value, directive[1].length + directive[2].length),
        directive: directive[2].toLowerCase(),
      };
    }
  }
  const separator = format === "yaml" ? ":" : "=";
  let index = rawLine.indexOf(separator);
  if (format === "properties" && index < 0) index = rawLine.indexOf(":");
  if (index < 0) return null;
  const before = rawLine.slice(0, index);
  const after = rawLine.slice(index + 1);
  const key = unquote(before.trim());
  if (!key) return null;
  const keyOffset = before.indexOf(before.trim());
  const valueLeading = after.length - after.trimStart().length;
  return {
    key,
    value: stripInlineComment(after.trim(), format),
    keyOffset,
    valueOffset: index + 1 + valueLeading,
  };
}

function emitDockerfileReference({
  path, pair, span, sourceId, references, recordState,
}) {
  if (pair.directive !== "from") return;
  const target = pair.value.split(/\s+/u).find((part) => !part.startsWith("--"));
  if (!target || !claimRecord(recordState)) return;
  references.push(createReference({
    path,
    relation: "depends-on",
    targetKind: "module",
    target,
    span,
    ruleId: "config.dockerfile.from",
    sourceId,
    certainty: "observed",
    properties: { requirement: "container-image" },
  }));
}

function isYamlBlockScalar(value) {
  return /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?$/.test(value);
}

function formatFor(path) {
  if (path.endsWith(".yaml") || path.endsWith(".yml")) return "yaml";
  if (path.endsWith(".toml")) return "toml";
  if (path.endsWith(".ini") || path.endsWith(".cfg") || path.endsWith(".conf")) return "ini";
  if (path.endsWith(".properties")) return "properties";
  if (path.endsWith(".env")) return "environment";
  if (/(^|\/)dockerfile$/i.test(path)) return "dockerfile";
  if (/(^|\/)makefile$/i.test(path)) return "makefile";
  return "properties";
}

function commentLine(trimmed, format) {
  if (format === "ini" && trimmed.startsWith(";")) return true;
  return trimmed.startsWith("#") || trimmed.startsWith("//");
}

function stripInlineComment(value, format) {
  if (!["yaml", "toml"].includes(format)) return value;
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === quote && value[index - 1] !== "\\") quote = null;
    } else if (char === "'" || char === '"') quote = char;
    else if (char === "#" && (index === 0 || /\s/.test(value[index - 1]))) return value.slice(0, index).trimEnd();
  }
  return value;
}

function primitiveValue(node) {
  if (["string", "number", "boolean", "null"].includes(node.type)) return node.value;
  return null;
}

function jsonPointer(parts) {
  return `/${parts.map((part) => String(part).replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`;
}

function claimRecord(state) {
  if (state.count >= MAX_CONFIG_RECORDS) {
    state.truncated = true;
    return false;
  }
  state.count += 1;
  return true;
}

function recordLimitDiagnostic() {
  return diagnostic({
    code: "config_record_limit",
    message: `Config extraction stopped at the ${MAX_CONFIG_RECORDS}-record limit.`,
    severity: "warning",
    detail: { limit: MAX_CONFIG_RECORDS, partial: true },
  });
}

function* configLines(source) {
  let start = 0;
  while (start <= source.length) {
    const newline = source.indexOf("\n", start);
    const end = newline < 0 ? source.length : newline;
    yield { rawLine: source.slice(start, end), lineStart: start };
    if (newline < 0) break;
    start = newline + 1;
  }
}

function inferValueType(value) {
  const normalized = normalizeScalar(value);
  if (normalized === null) return "null";
  if (Array.isArray(normalized)) return "array";
  return typeof normalized;
}

function normalizeScalar(value) {
  const text = String(value).trim();
  if (!text) return "";
  if (/^(true|false)$/i.test(text)) return text.toLowerCase() === "true";
  if (/^(null|~)$/i.test(text)) return null;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) return Number(text);
  if (text.startsWith("[") && text.endsWith("]")) {
    return text.slice(1, -1).split(",").map((item) => normalizeScalar(item));
  }
  return unquote(text);
}

function looksLikePath(value) {
  return /^\.{0,2}\//.test(value) || /[\\/][^\\/]+/.test(value) || /\.[A-Za-z0-9]{1,8}$/.test(value);
}

function decodeString(raw) {
  return JSON.parse(raw);
}

function prepareJsonSyntax(source, comments) {
  if (!comments) return source;
  const characters = source.split("");
  let inString = false;
  let escaped = false;
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "/" && characters[index + 1] === "/") {
      characters[index] = " ";
      characters[index + 1] = " ";
      index += 2;
      while (index < characters.length && characters[index] !== "\n" && characters[index] !== "\r") {
        characters[index] = " ";
        index += 1;
      }
      index -= 1;
    } else if (character === "/" && characters[index + 1] === "*") {
      characters[index] = " ";
      characters[index + 1] = " ";
      index += 2;
      let closed = false;
      while (index < characters.length) {
        if (characters[index] === "*" && characters[index + 1] === "/") {
          characters[index] = " ";
          characters[index + 1] = " ";
          index += 1;
          closed = true;
          break;
        }
        if (characters[index] !== "\n" && characters[index] !== "\r") characters[index] = " ";
        index += 1;
      }
      if (!closed) throw new SyntaxError("unterminated JSON block comment");
    }
  }
  inString = false;
  escaped = false;
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === ",") {
      let next = index + 1;
      while (next < characters.length && /\s/.test(characters[next])) next += 1;
      if (characters[next] === "}" || characters[next] === "]") characters[index] = " ";
    }
  }
  return characters.join("");
}

function unquote(value) {
  const text = String(value).trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) return text.slice(1, -1);
  return text;
}

function consume(cursor, value) {
  const token = peek(cursor);
  if (!token || token.value !== value) throw new SyntaxError(`expected ${value}`);
  cursor.index += 1;
  return token;
}

function peek(cursor) {
  return cursor.tokens[cursor.index];
}

function mergeSpan(startToken, node) {
  const end = {
    line: node.span.end.line,
    column: node.span.end.column,
    start: node.span.end.offset,
    end: node.span.end.offset,
    raw: "",
  };
  return spanFromTokens(startToken, end);
}
