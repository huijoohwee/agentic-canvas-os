import { tokenize } from "./tokenizer.js";
import {
  createEntity,
  createIr,
  createReference,
  diagnostic,
  parserIdentity,
  spanFromTokens,
} from "./ir.js";

const VERSION = "1.0.0";
const EXTENSIONS = [".sql", ".ddl", ".dml"];
const CONSTRAINT_START = new Set(["constraint", "foreign", "primary", "unique", "check"]);

export const SQL_EXTENSIONS = Object.freeze(EXTENSIONS);

export function supportsSqlPath(path) {
  const lower = path.toLowerCase();
  return EXTENSIONS.some((extension) => lower.endsWith(extension));
}

export function parseSql({ path, source }) {
  const tokens = tokenize(source, { commentPrefixes: ["--"], caseSensitive: false });
  const statements = splitStatements(tokens);
  const entities = [];
  const references = [];
  const diagnostics = [];
  const astChildren = [];

  for (const statement of statements) {
    const significant = statement.filter((token) => token.value !== "\n");
    if (significant.length === 0) continue;
    const parsed = parseStatement({ path, tokens: significant });
    if (!parsed) {
      diagnostics.push(diagnostic({
        code: "sql_statement_unsupported",
        message: `Unsupported SQL statement beginning with ${significant[0].raw || significant[0].value}.`,
        severity: "info",
        span: spanFromTokens(significant[0], significant.at(-1)),
      }));
      continue;
    }
    entities.push(...parsed.entities);
    references.push(...parsed.references);
    astChildren.push(parsed.ast);
    diagnostics.push(...parsed.diagnostics);
  }

  return createIr({
    path,
    source,
    parser: parserIdentity("builtin.sql.ddl", VERSION, { statements: ["table", "view", "index", "alter-table"] }),
    astChildren,
    entities,
    references,
    diagnostics,
  });
}

function parseStatement({ path, tokens }) {
  const words = tokens.map((token) => normalized(token));
  if (words[0] === "create") {
    const typeIndex = words.findIndex((word) => ["table", "view", "index"].includes(word));
    if (typeIndex < 0) return null;
    if (words[typeIndex] === "table") return parseCreateTable({ path, tokens, typeIndex });
    if (words[typeIndex] === "view") return parseCreateView({ path, tokens, typeIndex });
    return parseCreateIndex({ path, tokens, typeIndex });
  }
  if (words[0] === "alter" && words[1] === "table") return parseAlterTable({ path, tokens });
  return null;
}

function parseCreateTable({ path, tokens, typeIndex }) {
  const nameRecord = readQualified(tokens, skipIfNotExists(tokens, typeIndex + 1));
  if (!nameRecord) return null;
  const openIndex = tokens.findIndex((token, index) => index > nameRecord.endIndex && token.value === "(");
  const closeIndex = findMatching(tokens, openIndex, "(", ")");
  const table = createEntity({
    path,
    kind: "table",
    name: nameRecord.value,
    span: spanFromTokens(tokens[0], tokens[Math.max(nameRecord.endIndex, closeIndex)] ?? tokens.at(-1)),
    ruleId: "sql.create-table",
    properties: {},
  });
  const entities = [table];
  const references = [];
  const diagnostics = [];
  const children = [];

  if (openIndex < 0 || closeIndex < 0) {
    diagnostics.push(diagnostic({
      code: "sql_table_columns_unavailable",
      message: `Table ${nameRecord.value} has no balanced column list.`,
      severity: "warning",
      span: table.span,
    }));
  } else {
    const segments = splitTopLevel(tokens.slice(openIndex + 1, closeIndex), ",");
    for (const segment of segments) {
      const parsed = parseTableSegment({ path, table, tokens: segment });
      entities.push(...parsed.entities);
      references.push(...parsed.references);
      children.push(...parsed.children);
      diagnostics.push(...parsed.diagnostics);
    }
  }

  return {
    entities,
    references,
    diagnostics,
    ast: { type: "create-table", name: table.name, id: table.id, span: table.span, children },
  };
}

function parseTableSegment({ path, table, tokens }) {
  const significant = tokens.filter((token) => token.value !== "\n");
  if (significant.length === 0) return emptyParsed();
  const first = normalized(significant[0]);
  if (CONSTRAINT_START.has(first)) return parseTableConstraint({ path, table, tokens: significant });
  const nameToken = significant[0];
  if (!isNameToken(nameToken)) return emptyParsed();
  const typeTokens = [];
  for (const token of significant.slice(1)) {
    if (["constraint", "primary", "references", "not", "null", "unique", "check", "default"].includes(normalized(token))) break;
    typeTokens.push(token);
  }
  const column = createEntity({
    path,
    kind: "column",
    name: `${table.name}.${unquote(nameToken.raw ?? nameToken.value)}`,
    span: spanFromTokens(nameToken, significant.at(-1)),
    ruleId: "sql.column-definition",
    parentId: table.id,
    properties: {
      constraints: inlineConstraintTypes(significant).map((record) => record.type),
      dataType: typeTokens.map((token) => token.raw ?? token.value).join(" ") || "unspecified",
    },
  });
  const constraintEntities = inlineConstraintTypes(significant).map((record) => createEntity({
    path,
    kind: "constraint",
    name: `${column.name}.${record.type}`,
    span: spanFromTokens(record.startToken, record.endToken),
    ruleId: `sql.inline-${record.type}`,
    parentId: column.id,
    properties: { constraintType: record.type },
  }));
  const references = [];
  const referenceIndex = significant.findIndex((token) => normalized(token) === "references");
  if (referenceIndex >= 0) {
    const target = readQualified(significant, referenceIndex + 1);
    if (target) {
      const targetColumn = readParenthesizedName(significant, target.endIndex + 1);
      references.push(createReference({
        path,
        relation: "foreign-key",
        targetKind: targetColumn ? "column" : "table",
        target: targetColumn ? `${target.value}.${targetColumn.value}` : target.value,
        span: spanFromTokens(significant[referenceIndex], targetColumn?.endToken ?? target.endToken),
        ruleId: "sql.inline-reference",
        sourceId: column.id,
        certainty: "observed",
      }));
    }
  }
  return {
    entities: [column, ...constraintEntities],
    references,
    diagnostics: [],
    children: [{ type: "column", id: column.id, name: column.name, span: column.span }],
  };
}

function parseTableConstraint({ path, table, tokens }) {
  const foreignIndex = tokens.findIndex((token) => normalized(token) === "foreign");
  const referencesIndex = tokens.findIndex((token) => normalized(token) === "references");
  const words = tokens.map((token) => normalized(token));
  const type = foreignIndex >= 0 ? "foreign-key"
    : words.includes("primary") && words.includes("key") ? "primary-key"
      : words.includes("unique") ? "unique"
        : words.includes("check") ? "check" : "constraint";
  const explicitName = words[0] === "constraint" && isNameToken(tokens[1])
    ? unquote(tokens[1].raw ?? tokens[1].value) : null;
  const constraint = createEntity({
    path,
    kind: "constraint",
    name: explicitName ?? `${table.name}.${type}`,
    span: spanFromTokens(tokens[0], tokens.at(-1)),
    ruleId: `sql.table-${type}`,
    parentId: table.id,
    properties: { constraintName: explicitName, constraintType: type },
  });
  const base = {
    entities: [constraint],
    references: [],
    diagnostics: [],
    children: [{ type: "constraint", id: constraint.id, name: constraint.name, span: constraint.span }],
  };
  if (foreignIndex < 0 || referencesIndex < 0) return base;
  const localColumn = readParenthesizedName(tokens, foreignIndex + 1);
  const targetTable = readQualified(tokens, referencesIndex + 1);
  const targetColumn = targetTable ? readParenthesizedName(tokens, targetTable.endIndex + 1) : null;
  if (!localColumn || !targetTable) return base;
  const target = targetColumn ? `${targetTable.value}.${targetColumn.value}` : targetTable.value;
  const sourceName = `${table.name}.${localColumn.value}`;
  return {
    entities: [constraint],
    references: [createReference({
      path,
      relation: "foreign-key",
      targetKind: targetColumn ? "column" : "table",
      target,
      span: spanFromTokens(tokens[foreignIndex], targetColumn?.endToken ?? targetTable.endToken),
      ruleId: "sql.table-reference",
      sourceId: `deferred:${sourceName}`,
      certainty: "observed",
      properties: { sourceName },
    })],
    diagnostics: [],
    children: [
      ...base.children,
      { type: "foreign-key", source: sourceName, target, span: spanFromTokens(tokens[foreignIndex], tokens.at(-1)) },
    ],
  };
}

function parseCreateView({ path, tokens, typeIndex }) {
  const nameRecord = readQualified(tokens, skipIfNotExists(tokens, typeIndex + 1));
  if (!nameRecord) return null;
  const view = createEntity({
    path,
    kind: "view",
    name: nameRecord.value,
    span: spanFromTokens(tokens[0], tokens.at(-1)),
    ruleId: "sql.create-view",
    properties: {},
  });
  const references = [];
  for (let index = nameRecord.endIndex + 1; index < tokens.length; index += 1) {
    if (!["from", "join"].includes(normalized(tokens[index]))) continue;
    const target = readQualified(tokens, index + 1);
    if (!target) continue;
    references.push(createReference({
      path,
      relation: "reads-from",
      targetKind: "table",
      target: target.value,
      span: spanFromTokens(tokens[index], target.endToken),
      ruleId: `sql.view-${normalized(tokens[index])}`,
      sourceId: view.id,
      certainty: "observed",
    }));
  }
  return {
    entities: [view],
    references,
    diagnostics: [],
    ast: { type: "create-view", id: view.id, name: view.name, span: view.span, children: [] },
  };
}

function parseCreateIndex({ path, tokens, typeIndex }) {
  const nameRecord = readQualified(tokens, skipIfNotExists(tokens, typeIndex + 1));
  const onIndex = tokens.findIndex((token, index) => index > typeIndex && normalized(token) === "on");
  const tableRecord = onIndex >= 0 ? readQualified(tokens, onIndex + 1) : null;
  if (!nameRecord || !tableRecord) return null;
  const indexEntity = createEntity({
    path,
    kind: "index",
    name: nameRecord.value,
    span: spanFromTokens(tokens[0], tokens.at(-1)),
    ruleId: "sql.create-index",
    properties: {},
  });
  return {
    entities: [indexEntity],
    references: [createReference({
      path,
      relation: "indexes",
      targetKind: "table",
      target: tableRecord.value,
      span: spanFromTokens(tokens[onIndex], tableRecord.endToken),
      ruleId: "sql.index-target",
      sourceId: indexEntity.id,
      certainty: "observed",
    })],
    diagnostics: [],
    ast: { type: "create-index", id: indexEntity.id, name: indexEntity.name, span: indexEntity.span, children: [] },
  };
}

function parseAlterTable({ path, tokens }) {
  const tableRecord = readQualified(tokens, 2);
  if (!tableRecord) return null;
  const referencesIndex = tokens.findIndex((token) => normalized(token) === "references");
  if (referencesIndex < 0) return null;
  const targetTable = readQualified(tokens, referencesIndex + 1);
  if (!targetTable) return null;
  const localForeignIndex = tokens.findIndex((token) => normalized(token) === "foreign");
  const localColumn = localForeignIndex >= 0 ? readParenthesizedName(tokens, localForeignIndex + 1) : null;
  const targetColumn = readParenthesizedName(tokens, targetTable.endIndex + 1);
  const sourceName = localColumn ? `${tableRecord.value}.${localColumn.value}` : tableRecord.value;
  const target = targetColumn ? `${targetTable.value}.${targetColumn.value}` : targetTable.value;
  return {
    entities: [],
    references: [createReference({
      path,
      relation: "foreign-key",
      targetKind: targetColumn ? "column" : "table",
      target,
      span: spanFromTokens(tokens[0], tokens.at(-1)),
      ruleId: "sql.alter-table-reference",
      sourceId: `deferred:${sourceName}`,
      certainty: "observed",
      properties: { sourceName },
    })],
    diagnostics: [],
    ast: { type: "alter-table", name: tableRecord.value, span: spanFromTokens(tokens[0], tokens.at(-1)), children: [] },
  };
}

function inlineConstraintTypes(tokens) {
  const values = [];
  const words = tokens.map((token) => normalized(token));
  const add = (type, start, end = start) => {
    if (start >= 0) values.push({ type, startToken: tokens[start], endToken: tokens[end] ?? tokens[start] });
  };
  const primary = words.findIndex((word, index) => word === "primary" && words[index + 1] === "key");
  add("primary-key", primary, primary + 1);
  add("unique", words.indexOf("unique"));
  add("check", words.indexOf("check"), tokens.length - 1);
  const notNull = words.findIndex((word, index) => word === "not" && words[index + 1] === "null");
  add("not-null", notNull, notNull + 1);
  add("foreign-key", words.indexOf("references"), tokens.length - 1);
  return values.sort((left, right) => left.startToken.start - right.startToken.start);
}

function splitStatements(tokens) {
  return splitTopLevel(tokens, ";");
}

function splitTopLevel(tokens, delimiter) {
  const records = [];
  let current = [];
  let depth = 0;
  for (const token of tokens) {
    if (token.value === "(") depth += 1;
    if (token.value === ")") depth = Math.max(0, depth - 1);
    if (token.value === delimiter && depth === 0) {
      records.push(current);
      current = [];
    } else {
      current.push(token);
    }
  }
  if (current.length > 0) records.push(current);
  return records;
}

function readQualified(tokens, startIndex) {
  const parts = [];
  let endIndex = startIndex - 1;
  let expectName = true;
  for (let index = startIndex; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.value === "\n") continue;
    if (expectName && isNameToken(token)) {
      parts.push(unquote(token.raw ?? token.value));
      endIndex = index;
      expectName = false;
      continue;
    }
    if (!expectName && token.value === "." && parts.length > 0) {
      endIndex = index;
      expectName = true;
      continue;
    }
    break;
  }
  if (parts.length === 0 || expectName) return null;
  return { value: parts.join("."), endIndex, endToken: tokens[endIndex] };
}

function readParenthesizedName(tokens, startIndex) {
  const openIndex = tokens.findIndex((token, index) => index >= startIndex && token.value === "(");
  if (openIndex < 0) return null;
  const nameToken = tokens.slice(openIndex + 1).find((token) => isNameToken(token));
  if (!nameToken) return null;
  const endToken = tokens.slice(tokens.indexOf(nameToken) + 1).find((token) => token.value === ")") ?? nameToken;
  return { value: unquote(nameToken.raw ?? nameToken.value), endToken };
}

function skipIfNotExists(tokens, startIndex) {
  const words = tokens.slice(startIndex, startIndex + 3).map((token) => normalized(token));
  return words.join(" ") === "if not exists" ? startIndex + 3 : startIndex;
}

function findMatching(tokens, startIndex, open, close) {
  if (startIndex < 0) return -1;
  let depth = 0;
  for (let index = startIndex; index < tokens.length; index += 1) {
    if (tokens[index].value === open) depth += 1;
    if (tokens[index].value === close) depth -= 1;
    if (depth === 0) return index;
  }
  return -1;
}

function isNameToken(token) {
  return token?.type === "identifier" || token?.type === "string";
}

function normalized(token) {
  return unquote(token?.raw ?? token?.value ?? "").toLowerCase();
}

function unquote(value) {
  const text = String(value);
  if ((text.startsWith('"') && text.endsWith('"'))
    || (text.startsWith("'") && text.endsWith("'"))
    || (text.startsWith("`") && text.endsWith("`"))
    || (text.startsWith("[") && text.endsWith("]"))) {
    return text.slice(1, -1);
  }
  return text;
}

function emptyParsed() {
  return { entities: [], references: [], diagnostics: [], children: [] };
}
