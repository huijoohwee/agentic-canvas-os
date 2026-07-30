import { deepFreeze, sha256, stableStringify } from "./canonical.js";

export const IR_SCHEMA = "agentic-parser-ir/v1";
export const SPAN_SCHEMA = "agentic-source-span/v1";

export function parserIdentity(id, version, definition = {}) {
  const normalized = { id: requireText(id, "parser id"), version: requireText(version, "parser version") };
  return deepFreeze({ ...normalized, digest: sha256(stableStringify({ ...normalized, definition })) });
}

export function spanFromTokens(startToken, endToken = startToken) {
  if (!startToken || !endToken) throw new TypeError("span tokens are required");
  const raw = typeof endToken.raw === "string" ? endToken.raw : String(endToken.value ?? "");
  return deepFreeze({
    schema: SPAN_SCHEMA,
    start: {
      line: startToken.line,
      column: startToken.column,
      offset: startToken.start,
    },
    end: {
      line: endToken.line,
      column: endToken.column + raw.length,
      offset: endToken.end,
    },
  });
}

export function spanFromOffsets(source, start, end) {
  validateOffsets(source, start, end);
  const startPoint = pointAt(source, start);
  const endPoint = pointAt(source, end);
  return deepFreeze({
    schema: SPAN_SCHEMA,
    start: { ...startPoint, offset: start },
    end: { ...endPoint, offset: end },
  });
}

export function createSpanLocator(source) {
  if (typeof source !== "string") throw new TypeError("span source must be a string");
  const lineStarts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") lineStarts.push(index + 1);
  }
  return Object.freeze((start, end) => {
    validateOffsets(source, start, end);
    return deepFreeze({
      schema: SPAN_SCHEMA,
      start: { ...indexedPointAt(lineStarts, start), offset: start },
      end: { ...indexedPointAt(lineStarts, end), offset: end },
    });
  });
}

export function createEntity({
  path,
  kind,
  name,
  span,
  ruleId,
  parentId = null,
  properties = {},
}) {
  const identity = {
    path: requireText(path, "entity path"),
    kind: requireText(kind, "entity kind"),
    name: requireText(name, "entity name"),
    start: span?.start?.offset,
    ruleId: requireText(ruleId, "entity rule id"),
  };
  return deepFreeze({
    id: `local:${sha256(stableStringify(identity)).slice(0, 24)}`,
    kind: identity.kind,
    name: identity.name,
    span: requireSpan(span),
    ruleId: identity.ruleId,
    parentId: parentId === null ? null : requireText(parentId, "parent id"),
    properties: normalizeProperties(properties),
  });
}

export function createReference({
  path,
  relation,
  targetKind,
  target,
  span,
  ruleId,
  sourceId = null,
  certainty = "observed",
  properties = {},
}) {
  const normalized = {
    path: requireText(path, "reference path"),
    relation: requireText(relation, "reference relation"),
    targetKind: requireText(targetKind, "reference target kind"),
    target: requireText(target, "reference target"),
    span: requireSpan(span),
    ruleId: requireText(ruleId, "reference rule id"),
    sourceId: sourceId === null ? null : requireText(sourceId, "reference source id"),
    certainty: normalizeCertainty(certainty),
    properties: normalizeProperties(properties),
  };
  return deepFreeze({
    id: `reference:${sha256(stableStringify({
      path: normalized.path,
      relation: normalized.relation,
      targetKind: normalized.targetKind,
      target: normalized.target,
      start: normalized.span.start.offset,
      ruleId: normalized.ruleId,
      sourceId: normalized.sourceId,
    })).slice(0, 24)}`,
    ...normalized,
  });
}

export function createIr({
  path,
  source,
  sourceDigest = null,
  sourceBytes = null,
  parser,
  astChildren = [],
  entities = [],
  references = [],
  diagnostics = [],
}) {
  const sourceText = typeof source === "string" ? source : "";
  const calculatedDigest = sha256(Buffer.from(sourceText, "utf8"));
  const calculatedBytes = Buffer.byteLength(sourceText);
  const digest = sourceDigest ?? calculatedDigest;
  const bytes = sourceBytes ?? calculatedBytes;
  if (typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest)) {
    throw new TypeError("IR source digest must be a lowercase SHA-256 digest");
  }
  if (!Number.isInteger(bytes) || bytes < 0) throw new TypeError("IR source bytes must be a non-negative integer");
  const normalizedEntities = [...entities].sort(compareLocated);
  const normalizedReferences = [...references].sort(compareLocated);
  const normalizedDiagnostics = [...diagnostics].map(normalizeDiagnostic).sort(compareLocated);
  const ast = {
    type: "document",
    path: requireText(path, "IR path"),
    children: [...astChildren].sort(compareLocated),
  };
  return deepFreeze({
    schema: IR_SCHEMA,
    parser,
    source: { path, digest, bytes },
    ast,
    entities: normalizedEntities,
    references: normalizedReferences,
    diagnostics: normalizedDiagnostics,
  });
}

export function diagnostic({ code, message, severity = "warning", span = null, detail = null }) {
  if (!["info", "warning", "error"].includes(severity)) throw new TypeError("invalid diagnostic severity");
  return deepFreeze({
    code: requireText(code, "diagnostic code"),
    message: requireText(message, "diagnostic message"),
    severity,
    span: span === null ? null : requireSpan(span),
    detail,
  });
}

export function excerptForSpan(source, span, maxChars = 240) {
  const start = span?.start?.offset;
  const end = span?.end?.offset;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return "";
  const raw = source.slice(start, end).replace(/\s+/g, " ").trim();
  return raw.length <= maxChars ? raw : `${raw.slice(0, maxChars - 1)}…`;
}

function pointAt(source, offset) {
  let line = 1;
  let column = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source[index] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

function indexedPointAt(lineStarts, offset) {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (lineStarts[middle] <= offset) low = middle + 1;
    else high = middle - 1;
  }
  return { line: high + 1, column: offset - lineStarts[high] + 1 };
}

function validateOffsets(source, start, end) {
  if (typeof source !== "string") throw new TypeError("span source must be a string");
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > source.length) {
    throw new RangeError("invalid source offsets");
  }
}

function requireSpan(value) {
  if (!value || value.schema !== SPAN_SCHEMA
    || !Number.isInteger(value.start?.offset) || !Number.isInteger(value.end?.offset)
    || value.start.offset < 0 || value.end.offset < value.start.offset) {
    throw new TypeError("invalid source span");
  }
  return value;
}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} is required`);
  return value.trim();
}

function normalizeCertainty(value) {
  if (!["observed", "resolved", "ambiguous"].includes(value)) throw new TypeError("invalid certainty");
  return value;
}

function normalizeProperties(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("properties must be an object");
  return deepFreeze(Object.fromEntries(Object.entries(value).sort(([left], [right]) => compareText(left, right))));
}

function normalizeDiagnostic(value) {
  return diagnostic(value);
}

function compareLocated(left, right) {
  const leftOffset = left.span?.start?.offset ?? Number.MAX_SAFE_INTEGER;
  const rightOffset = right.span?.start?.offset ?? Number.MAX_SAFE_INTEGER;
  return leftOffset - rightOffset
    || compareText(left.kind ?? left.code ?? left.type ?? "", right.kind ?? right.code ?? right.type ?? "")
    || compareText(left.name ?? left.target ?? left.message ?? "", right.name ?? right.target ?? right.message ?? "");
}

function compareText(left, right) {
  return Buffer.compare(Buffer.from(String(left), "utf8"), Buffer.from(String(right), "utf8"));
}
