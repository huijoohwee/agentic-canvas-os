import {
  assertPlainObject,
  deepFreeze,
  sha256,
  stableStringify,
} from "./canonical.js";
import {
  createEntity,
  createIr,
  createReference,
  diagnostic,
  spanFromTokens,
} from "./ir.js";
import { tokenize } from "./tokenizer.js";

export const GRAMMAR_SCHEMA = "agentic-parser-grammar/v1";
export const ARTIFACT_SCHEMA = "agentic-parser-artifact/v1";
export const IR_SCHEMA = "agentic-parser-ir/v1";

const MAX_RULES = 64;
const MAX_ATOMS = 24;
const MAX_LIST_ITEMS = 64;
const MAX_STRING = 128;
export const PARSER_LIMITS = deepFreeze({
  sourceChars: 2 * 1024 * 1024,
  sourceBytes: 2 * 1024 * 1024,
  lineChars: 64 * 1024,
  tokens: 200_000,
  workUnits: 2_000_000,
  matches: 10_000,
  entities: 6_000,
  references: 8_000,
  diagnostics: 1_000,
});
const WORK_EXHAUSTED = Symbol("work-exhausted");
const TOP_LEVEL_KEYS = new Set([
  "schema", "id", "version", "extensions", "caseSensitive", "commentPrefixes", "rules",
]);
const RULE_KEYS = new Set([
  "id", "emit", "kind", "relation", "targetKind", "sequence", "scope", "source",
  "opensBlock",
]);
const TYPES = new Set(["identifier", "string", "number", "symbol"]);

export function compileGrammar(spec) {
  assertPlainObject(spec, "grammar");
  assertClosedKeys(spec, TOP_LEVEL_KEYS, "grammar");
  if (spec.schema !== GRAMMAR_SCHEMA) {
    throw new TypeError(`grammar.schema must equal "${GRAMMAR_SCHEMA}"`);
  }

  const caseSensitive = spec.caseSensitive ?? true;
  if (typeof caseSensitive !== "boolean") {
    throw new TypeError("grammar.caseSensitive must be a boolean");
  }
  const extensions = normalizeUniqueStrings(spec.extensions, "grammar.extensions", {
    normalize: (value) => caseSensitive ? value : value.toLowerCase(),
  });
  const commentPrefixes = normalizeUniqueStrings(
    spec.commentPrefixes ?? [],
    "grammar.commentPrefixes",
    { forbidNewline: true },
  ).sort((left, right) => right.length - left.length || ordinalCompare(left, right));

  if (!Array.isArray(spec.rules) || spec.rules.length === 0 || spec.rules.length > MAX_RULES) {
    throw new TypeError(`grammar.rules must contain between 1 and ${MAX_RULES} rules`);
  }
  const ruleIds = new Set();
  const rules = spec.rules.map((rule, index) => {
    const normalized = normalizeRule(rule, index, caseSensitive);
    if (ruleIds.has(normalized.id)) throw new TypeError(`duplicate rule id "${normalized.id}"`);
    ruleIds.add(normalized.id);
    return normalized;
  });

  const grammar = {
    schema: GRAMMAR_SCHEMA,
    id: safeIdentifier(spec.id, "grammar.id", /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/),
    version: boundedString(spec.version, "grammar.version"),
    extensions: extensions.sort(ordinalCompare),
    caseSensitive,
    commentPrefixes,
    rules,
  };
  const unsigned = { schema: ARTIFACT_SCHEMA, grammar };
  return deepFreeze({ ...unsigned, digest: sha256(stableStringify(unsigned)) });
}

export function parseWithGrammar(artifact, input) {
  const compiled = validateArtifact(artifact);
  assertPlainObject(input, "parse input");
  assertClosedKeys(input, new Set(["source", "path"]), "parse input");
  if (typeof input.source !== "string") throw new TypeError("parse input.source must be a string");
  if (typeof input.path !== "string" || input.path.length === 0) {
    throw new TypeError("parse input.path must be a non-empty string");
  }
  if (input.source.length > PARSER_LIMITS.sourceChars) {
    throw parserLimitError(
      "parser_source_character_limit",
      `parse input.source exceeds ${PARSER_LIMITS.sourceChars} characters`,
      PARSER_LIMITS.sourceChars,
      input.source.length,
    );
  }
  const sourceBytes = Buffer.byteLength(input.source, "utf8");
  if (sourceBytes > PARSER_LIMITS.sourceBytes) {
    throw parserLimitError(
      "parser_source_byte_limit",
      `parse input.source exceeds ${PARSER_LIMITS.sourceBytes} UTF-8 bytes`,
      PARSER_LIMITS.sourceBytes,
      sourceBytes,
    );
  }

  const { grammar, digest: artifactDigest } = compiled;
  const ast = [];
  const entities = [];
  const references = [];
  const diagnostics = [];
  const activeBlocks = [];
  const pendingExactBlocks = new Map();
  let braceDepth = 0;
  let tokenCount = 0;
  let matchCount = 0;
  const work = { used: 0 };

  parseLines:
  for (const line of sourceLines(input.source)) {
    if (line.contentEnd - line.start > PARSER_LIMITS.lineChars) {
      diagnostics.push(limitDiagnostic({
        code: "parser_line_limit",
        message: `Generated parser stopped at the ${PARSER_LIMITS.lineChars}-character line limit.`,
        limit: PARSER_LIMITS.lineChars,
        observed: line.contentEnd - line.start,
        span: spanFromLine(line, false),
      }));
      break;
    }
    const lineTokensWithNewline = tokenize(input.source.slice(line.start, line.end), {
      commentPrefixes: grammar.commentPrefixes,
      caseSensitive: grammar.caseSensitive,
    });
    offsetTokens(lineTokensWithNewline, line.start, line.number, grammar.caseSensitive);
    if (tokenCount + lineTokensWithNewline.length > PARSER_LIMITS.tokens) {
      diagnostics.push(limitDiagnostic({
        code: "parser_token_limit",
        message: `Generated parser stopped at the ${PARSER_LIMITS.tokens}-token limit.`,
        limit: PARSER_LIMITS.tokens,
        observed: tokenCount + lineTokensWithNewline.length,
        span: spanFromLine(line, true),
      }));
      break;
    }
    tokenCount += lineTokensWithNewline.length;
    const lineTokens = lineTokensWithNewline.filter((token) => token.value !== "\n");
    if (lineTokens.length === 0) continue;
    let matchedLine = false;

    for (let tokenIndex = 0; tokenIndex < lineTokens.length; tokenIndex += 1) {
      const token = lineTokens[tokenIndex];
      if (token.type === "symbol" && token.value === "}") {
        braceDepth = Math.max(0, braceDepth - 1);
        while (activeBlocks.length > 0
          && activeBlocks[activeBlocks.length - 1].openDepth > braceDepth) {
          activeBlocks.pop();
        }
      }

      for (let ruleIndex = 0; ruleIndex < grammar.rules.length; ruleIndex += 1) {
        const rule = grammar.rules[ruleIndex];
        const match = matchRule(rule, lineTokens, tokenIndex, grammar.caseSensitive, work);
        if (match === WORK_EXHAUSTED) {
          diagnostics.push(limitDiagnostic({
            code: "parser_work_limit",
            message: `Generated parser stopped at the ${PARSER_LIMITS.workUnits}-unit work limit.`,
            limit: PARSER_LIMITS.workUnits,
            observed: work.used + 1,
            span: spanFromToken(token),
          }));
          break parseLines;
        }
        if (!match) continue;
        if (matchCount >= PARSER_LIMITS.matches) {
          diagnostics.push(limitDiagnostic({
            code: "parser_match_limit",
            message: `Generated parser stopped at the ${PARSER_LIMITS.matches}-match limit.`,
            limit: PARSER_LIMITS.matches,
            observed: matchCount + 1,
            span: sourceSpan(match.tokens),
          }));
          break parseLines;
        }
        if (rule.emit === "entity" && entities.length >= PARSER_LIMITS.entities) {
          diagnostics.push(limitDiagnostic({
            code: "parser_entity_limit",
            message: `Generated parser stopped at the ${PARSER_LIMITS.entities}-entity limit.`,
            limit: PARSER_LIMITS.entities,
            observed: entities.length + 1,
            span: sourceSpan(match.tokens),
          }));
          break parseLines;
        }
        if (rule.emit === "reference" && references.length >= PARSER_LIMITS.references) {
          diagnostics.push(limitDiagnostic({
            code: "parser_reference_limit",
            message: `Generated parser stopped at the ${PARSER_LIMITS.references}-reference limit.`,
            limit: PARSER_LIMITS.references,
            observed: references.length + 1,
            span: sourceSpan(match.tokens),
          }));
          break parseLines;
        }
        matchCount += 1;
        matchedLine = true;
        const parent = activeBlocks[activeBlocks.length - 1]?.entity ?? null;
        const captures = normalizeCaptures(match.captures);
        const span = sourceSpan(match.tokens);

        if (rule.emit === "entity") {
          const nameCapture = match.captures.name;
          const entity = {
            ...createEntity({
              path: input.path,
              kind: rule.kind,
              name: nameCapture.value,
              span,
              ruleId: rule.id,
              parentId: parent?.id ?? null,
              properties: { depth: activeBlocks.length },
            }),
            nameSpan: spanFromToken(nameCapture.token),
            depth: activeBlocks.length,
          };
          entities.push(entity);
          ast.push({
            type: "entity",
            id: entity.id,
            ruleId: rule.id,
            span,
            parentId: entity.parentId,
            captures,
            ruleIndex,
          });
          if (rule.opensBlock) {
            const expectedBrace = match.tokens.find((candidate) => (
              candidate.type === "symbol" && candidate.value === "{"
            ));
            const exact = pendingExactBlocks.get(expectedBrace.start) ?? [];
            exact.push({ entity });
            pendingExactBlocks.set(expectedBrace.start, exact);
          }
        } else {
          const targetCapture = match.captures.target;
          const sourceId = rule.source === "file" ? null : parent?.id ?? null;
          const reference = {
            ...createReference({
              path: input.path,
              relation: rule.relation,
              targetKind: rule.targetKind,
              target: targetCapture.value,
              span,
              ruleId: rule.id,
              sourceId,
              properties: { sourceMode: rule.source },
            }),
            source: rule.source,
            targetSpan: spanFromToken(targetCapture.token),
          };
          references.push(reference);
          ast.push({
            type: "reference",
            id: reference.id,
            ruleId: rule.id,
            span,
            parentId: parent?.id ?? null,
            captures,
            ruleIndex,
          });
        }
      }

      if (token.type === "symbol" && token.value === "{") {
        braceDepth += 1;
        const opening = pendingExactBlocks.get(token.start) ?? [];
        pendingExactBlocks.delete(token.start);
        for (const pending of opening) {
          activeBlocks.push({ entity: pending.entity, openDepth: braceDepth });
        }
      }
    }

    if (!matchedLine) {
      if (diagnostics.length >= PARSER_LIMITS.diagnostics - 1) {
        diagnostics.push(limitDiagnostic({
          code: "parser_diagnostic_limit",
          message: `Generated parser stopped at the ${PARSER_LIMITS.diagnostics}-diagnostic limit.`,
          limit: PARSER_LIMITS.diagnostics,
          observed: diagnostics.length + 1,
          span: sourceSpan(lineTokens),
        }));
        break;
      }
      const span = sourceSpan(lineTokens);
      diagnostics.push(diagnostic({
        code: "no_match",
        message: "No grammar rule matched this line.",
        severity: "info",
        span,
        detail: { line: lineTokens[0].line },
      }));
    }
  }

  const ruleIndexes = new Map(grammar.rules.map((rule, index) => [rule.id, index]));
  const compareRecords = (left, right) => (
    left.span.start.offset - right.span.start.offset
    || (left.ruleIndex ?? ruleIndexes.get(left.ruleId))
      - (right.ruleIndex ?? ruleIndexes.get(right.ruleId))
    || ordinalCompare(left.id, right.id)
  );
  ast.sort(compareRecords);
  entities.sort(compareRecords);
  references.sort(compareRecords);
  for (const node of ast) delete node.ruleIndex;

  const ir = createIr({
    path: input.path,
    source: input.source,
    parser: {
      id: grammar.id,
      version: grammar.version,
      digest: artifactDigest,
    },
    astChildren: ast,
    entities,
    references,
    diagnostics,
  });
  return deepFreeze({ ...ir, artifactDigest });
}

function normalizeRule(rule, index, caseSensitive) {
  const label = `grammar.rules[${index}]`;
  assertPlainObject(rule, label);
  assertClosedKeys(rule, RULE_KEYS, label);
  const emit = boundedString(rule.emit, `${label}.emit`);
  if (emit !== "entity" && emit !== "reference") {
    throw new TypeError(`${label}.emit must be "entity" or "reference"`);
  }
  if (!Array.isArray(rule.sequence) || rule.sequence.length === 0
      || rule.sequence.length > MAX_ATOMS) {
    throw new TypeError(`${label}.sequence must contain between 1 and ${MAX_ATOMS} atoms`);
  }

  const captures = new Set();
  const sequence = rule.sequence.map((atom, atomIndex) => {
    const normalized = normalizeAtom(atom, `${label}.sequence[${atomIndex}]`, caseSensitive);
    if (normalized.capture) {
      if (captures.has(normalized.capture)) {
        throw new TypeError(`${label} has duplicate "${normalized.capture}" capture`);
      }
      captures.add(normalized.capture);
    }
    return normalized;
  });
  const scope = rule.scope ?? "line";
  if (scope !== "line") throw new TypeError(`${label}.scope must be "line"`);
  const opensBlock = rule.opensBlock ?? false;
  if (typeof opensBlock !== "boolean") throw new TypeError(`${label}.opensBlock must be a boolean`);
  if (opensBlock && !sequence.some((atom) => atom.literal === "{")) {
    throw new TypeError(`${label}.opensBlock requires a literal "{" atom`);
  }

  if (emit === "entity") {
    rejectFields(rule, ["relation", "targetKind", "source"], label);
    if (!captures.has("name")) throw new TypeError(`${label} must contain a "name" capture`);
    if (captures.has("target")) throw new TypeError(`${label} entity must not capture "target"`);
    return {
      id: safeIdentifier(rule.id, `${label}.id`),
      emit,
      kind: safeIdentifier(rule.kind, `${label}.kind`),
      sequence,
      scope,
      opensBlock,
    };
  }

  rejectFields(rule, ["kind"], label);
  if (opensBlock) throw new TypeError(`${label} reference cannot open a block`);
  if (!captures.has("target")) throw new TypeError(`${label} must contain a "target" capture`);
  if (captures.has("name")) throw new TypeError(`${label} reference must not capture "name"`);
  const source = rule.source ?? "enclosing";
  if (source !== "enclosing" && source !== "file") {
    throw new TypeError(`${label}.source must be "enclosing" or "file"`);
  }
  return {
    id: safeIdentifier(rule.id, `${label}.id`),
    emit,
    relation: safeIdentifier(rule.relation, `${label}.relation`),
    targetKind: safeIdentifier(rule.targetKind, `${label}.targetKind`),
    sequence,
    scope,
    source,
    opensBlock: false,
  };
}

function normalizeAtom(atom, label, caseSensitive) {
  assertPlainObject(atom, label);
  if (Object.hasOwn(atom, "literal")) {
    assertClosedKeys(atom, new Set(["literal"]), label);
    const literal = boundedString(atom.literal, `${label}.literal`);
    return { literal: caseSensitive ? literal : literal.toLowerCase() };
  }
  assertClosedKeys(atom, new Set(["type", "capture"]), label);
  if (!TYPES.has(atom.type)) {
    throw new TypeError(`${label}.type must be identifier, string, number, or symbol`);
  }
  if (atom.capture !== undefined && atom.capture !== "name" && atom.capture !== "target") {
    throw new TypeError(`${label}.capture must be "name" or "target"`);
  }
  return atom.capture ? { type: atom.type, capture: atom.capture } : { type: atom.type };
}

function matchRule(rule, tokens, start, caseSensitive, work) {
  if (!spendWork(work)) return WORK_EXHAUSTED;
  if (start + rule.sequence.length > tokens.length) return null;
  let nameToken = null;
  let targetToken = null;
  for (let index = 0; index < rule.sequence.length; index += 1) {
    if (!spendWork(work)) return WORK_EXHAUSTED;
    const atom = rule.sequence[index];
    const token = tokens[start + index];
    if (Object.hasOwn(atom, "literal")) {
      const comparable = caseSensitive ? token.value : token.comparisonValue;
      if (comparable !== atom.literal) return null;
    } else if (token.type !== atom.type) {
      return null;
    }
    if (atom.capture === "name") nameToken = token;
    if (atom.capture === "target") targetToken = token;
  }
  const captures = {};
  if (nameToken) captures.name = { value: nameToken.value, token: nameToken };
  if (targetToken) captures.target = { value: targetToken.value, token: targetToken };
  return {
    tokens: tokens.slice(start, start + rule.sequence.length),
    captures,
  };
}

function spendWork(work) {
  if (work.used >= PARSER_LIMITS.workUnits) return false;
  work.used += 1;
  return true;
}

function validateArtifact(artifact) {
  assertPlainObject(artifact, "artifact");
  assertClosedKeys(artifact, new Set(["schema", "grammar", "digest"]), "artifact");
  if (artifact.schema !== ARTIFACT_SCHEMA) {
    throw new TypeError(`artifact.schema must equal "${ARTIFACT_SCHEMA}"`);
  }
  if (typeof artifact.digest !== "string" || !/^[0-9a-f]{64}$/.test(artifact.digest)) {
    throw new TypeError("artifact.digest must be a lowercase SHA-256 digest");
  }
  const compiled = compileGrammar(artifact.grammar);
  if (stableStringify(compiled.grammar) !== stableStringify(artifact.grammar)) {
    throw new TypeError("artifact grammar is not canonical");
  }
  if (compiled.digest !== artifact.digest) throw new TypeError("artifact digest mismatch");
  return compiled;
}

function normalizeUniqueStrings(value, label, options = {}) {
  if (!Array.isArray(value) || value.length > MAX_LIST_ITEMS) {
    throw new TypeError(`${label} must be an array with at most ${MAX_LIST_ITEMS} entries`);
  }
  const seen = new Set();
  return value.map((item, index) => {
    let normalized = boundedString(item, `${label}[${index}]`);
    if (options.forbidNewline && /[\r\n]/.test(normalized)) {
      throw new TypeError(`${label}[${index}] must not contain a newline`);
    }
    normalized = options.normalize ? options.normalize(normalized) : normalized;
    if (seen.has(normalized)) throw new TypeError(`${label} contains duplicate "${normalized}"`);
    seen.add(normalized);
    return normalized;
  });
}

function normalizeCaptures(captures) {
  const result = {};
  for (const key of ["name", "target"]) {
    const capture = captures[key];
    if (capture) result[key] = { value: capture.value, span: spanFromToken(capture.token) };
  }
  return result;
}

function* sourceLines(source) {
  let start = 0;
  let number = 1;
  while (start < source.length) {
    let contentEnd = start;
    while (contentEnd < source.length
      && source[contentEnd] !== "\n" && source[contentEnd] !== "\r") {
      contentEnd += 1;
    }
    let end = contentEnd;
    if (source[end] === "\r") end += source[end + 1] === "\n" ? 2 : 1;
    else if (source[end] === "\n") end += 1;
    yield { start, contentEnd, end, number };
    start = end;
    number += 1;
  }
}

function offsetTokens(tokens, offset, lineNumber, caseSensitive) {
  for (const token of tokens) {
    token.line += lineNumber - 1;
    token.start += offset;
    token.end += offset;
    if (!caseSensitive) token.comparisonValue = token.value.toLowerCase();
  }
}

function sourceSpan(tokens) {
  return spanFromTokens(tokens[0], tokens[tokens.length - 1]);
}

function spanFromToken(token) {
  return spanFromTokens(token);
}

function spanFromLine(line, includeNewline) {
  const includesBreak = includeNewline && line.end > line.contentEnd;
  return spanFromTokens(
    { line: line.number, column: 1, start: line.start },
    {
      line: line.number + (includesBreak ? 1 : 0),
      column: includesBreak ? 1 : line.contentEnd - line.start + 1,
      end: includeNewline ? line.end : line.contentEnd,
      raw: "",
    },
  );
}

function limitDiagnostic({ code, message, limit, observed, span }) {
  return diagnostic({
    code,
    message,
    severity: "warning",
    span,
    detail: { limit, observed, partial: true },
  });
}

function parserLimitError(code, message, limit, observed) {
  const error = new RangeError(message);
  error.code = code;
  error.detail = deepFreeze({ limit, observed, partial: false });
  return error;
}

function boundedString(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_STRING) {
    throw new TypeError(`${label} must be a non-empty string of at most ${MAX_STRING} characters`);
  }
  return value;
}

function safeIdentifier(value, label, pattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/) {
  const text = boundedString(value, label);
  if (!pattern.test(text)) throw new TypeError(`${label} must be a safe ASCII identifier`);
  return text;
}

function rejectFields(object, fields, label) {
  for (const field of fields) {
    if (Object.hasOwn(object, field)) throw new TypeError(`${label}.${field} is not allowed`);
  }
}

function assertClosedKeys(object, allowed, label) {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) throw new TypeError(`${label} has unknown key "${key}"`);
  }
}

function ordinalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
