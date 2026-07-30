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
const CONTROL_CALLS = new Set([
  "catch", "do", "else", "for", "if", "match", "new", "return", "sizeof",
  "switch", "throw", "typeof", "while", "with", "yield",
]);

const PROFILES = Object.freeze([
  profile([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"], "ecmascript", {
    comments: ["//"],
    declarations: {
      class: "class", interface: "interface", enum: "enum", type: "type",
      function: "function", namespace: "namespace", module: "module",
    },
    functionKeywords: ["function"],
    imports: ["import", "require"],
    inheritance: ["extends", "implements"],
  }),
  profile([".py", ".pyi"], "python", {
    comments: ["#"],
    declarations: { class: "class", def: "function" },
    functionKeywords: ["def"],
    imports: ["import", "from"],
    inheritance: [],
    indentation: true,
  }),
  profile([".go"], "go", {
    comments: ["//"],
    declarations: { func: "function", type: "type" },
    functionKeywords: ["func"],
    imports: ["import"],
    inheritance: [],
  }),
  profile([".rs"], "rust", {
    comments: ["//"],
    declarations: {
      fn: "function", struct: "struct", enum: "enum", trait: "interface",
      mod: "module", type: "type", impl: "implementation",
    },
    functionKeywords: ["fn"],
    imports: ["use", "mod"],
    inheritance: [],
  }),
  profile([".java", ".kt", ".kts", ".scala", ".cs"], "jvm-clr", {
    comments: ["//"],
    declarations: {
      class: "class", interface: "interface", enum: "enum", record: "record",
      object: "object", fun: "function",
    },
    functionKeywords: ["fun"],
    imports: ["import", "using", "package"],
    inheritance: ["extends", "implements"],
    cFunctions: true,
  }),
  profile([".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".hh"], "c-family", {
    comments: ["//"],
    declarations: { struct: "struct", enum: "enum", union: "union", typedef: "type" },
    functionKeywords: [],
    imports: ["include"],
    inheritance: [],
    cFunctions: true,
  }),
  profile([".swift"], "swift", {
    comments: ["//"],
    declarations: {
      class: "class", struct: "struct", enum: "enum", protocol: "interface",
      actor: "actor", func: "function", extension: "extension",
    },
    functionKeywords: ["func"],
    imports: ["import"],
    inheritance: [],
  }),
  profile([".rb"], "ruby", {
    comments: ["#"],
    declarations: { class: "class", module: "module", def: "function" },
    functionKeywords: ["def"],
    imports: ["require", "require_relative", "load"],
    inheritance: [],
    indentation: true,
    endBlocks: true,
  }),
  profile([".php"], "php", {
    comments: ["//", "#"],
    declarations: {
      class: "class", interface: "interface", trait: "trait",
      enum: "enum", function: "function", namespace: "namespace",
    },
    functionKeywords: ["function"],
    imports: ["include", "require", "use"],
    inheritance: ["extends", "implements"],
  }),
  profile([".sh", ".bash", ".zsh"], "shell", {
    comments: ["#"],
    declarations: { function: "function" },
    functionKeywords: ["function"],
    imports: ["source"],
    inheritance: [],
  }),
]);

export const CODE_EXTENSIONS = Object.freeze(PROFILES.flatMap((entry) => entry.extensions));

export function supportsCodePath(path) {
  return Boolean(findProfile(path));
}

export function parseCode({ path, source }) {
  const selected = findProfile(path);
  if (!selected) throw new TypeError(`unsupported code path: ${path}`);
  const stringsMasked = selected.id === "python" ? maskPythonTripleStrings(source) : source;
  const masked = maskBlockComments(stringsMasked, { protectRegexOpen: selected.id === "ecmascript" });
  const tokens = tokenize(masked, { commentPrefixes: selected.comments, caseSensitive: true });
  const lines = groupLines(tokens);
  const entities = []; const references = []; const diagnostics = []; const scope = [];
  let braceDepth = 0; let pendingScope = null;

  for (const line of lines) {
    const significant = line.tokens.filter((token) => token.value !== "\n");
    if (significant.length === 0) continue;
    const indent = lineIndent(source, significant[0].start);
    closeScopes(scope, { braceDepth, indent, selected, significant });
    if (pendingScope) {
      if (significant[0].value === "{") scope.push({ ...pendingScope, braceDepth: braceDepth + 1 });
      pendingScope = null;
    }
    const declaration = findDeclaration(significant, selected);
    let declared = null;

    if (declaration) {
      const parentId = scope.at(-1)?.entity.id ?? null;
      declared = createEntity({
        path,
        kind: declaration.kind,
        name: declaration.nameToken.value,
        span: spanFromTokens(declaration.startToken, declaration.endToken),
        ruleId: `code.${selected.id}.${declaration.rule}`,
        parentId,
        properties: { language: selected.id },
      });
      entities.push(declared);
      const braceDelta = countToken(significant, "{") - countToken(significant, "}");
      const opens = opensScope(significant, selected, declaration);
      if (opens
        && (selected.indentation || selected.endBlocks || braceDelta > 0)) {
        scope.push({
          entity: declared,
          braceDepth: braceDepth + braceDelta,
          indent,
        });
      } else if (!opens && !selected.indentation && !selected.endBlocks
        && !significant.some((token) => token.value === ";")) {
        pendingScope = { entity: declared, indent };
      }
      for (const inherited of findInheritance(significant, selected, declaration)) {
        references.push(createReference({
          path,
          relation: "inherits",
          targetKind: "symbol",
          target: inherited.value,
          span: spanFromTokens(inherited),
          ruleId: `code.${selected.id}.inheritance`,
          sourceId: declared.id,
          certainty: "observed",
        }));
      }
    }

    for (const imported of findImports(significant, selected)) {
      references.push(createReference({
        path,
        relation: imported.relation,
        targetKind: "module",
        target: imported.target,
        span: spanFromTokens(imported.startToken, imported.endToken),
        ruleId: `code.${selected.id}.${imported.rule}`,
        sourceId: scope.at(-1)?.entity.id ?? null,
        certainty: "observed",
      }));
    }

    for (const call of findCalls(significant, declaration, selected)) {
      references.push(createReference({
        path,
        relation: "calls",
        targetKind: "symbol",
        target: call.value,
        span: spanFromTokens(call),
        ruleId: `code.${selected.id}.call-expression`,
        sourceId: declared?.id ?? scope.at(-1)?.entity.id ?? null,
        certainty: "observed",
      }));
    }

    braceDepth += countToken(significant, "{") - countToken(significant, "}");
    while (scope.length > 0 && !selected.indentation && braceDepth < scope.at(-1).braceDepth) scope.pop();
  }

  if (entities.length === 0) {
    diagnostics.push(diagnostic({
      code: "code_no_declarations",
      message: `No supported ${selected.id} declarations were observed.`,
      severity: "info",
    }));
  }

  const parser = parserIdentity(`builtin.code.${selected.id}`, VERSION, selected);
  return createIr({
    path,
    source,
    parser,
    astChildren: entities.map((entity) => ({
      type: entity.kind,
      name: entity.name,
      span: entity.span,
      ruleId: entity.ruleId,
      id: entity.id,
      parentId: entity.parentId,
    })),
    entities,
    references: uniqueReferences(references),
    diagnostics,
  });
}

function profile(extensions, id, options) {
  return Object.freeze({ extensions, id, ...options });
}

function findProfile(path) {
  const lower = path.toLowerCase();
  return PROFILES.find((entry) => entry.extensions.some((extension) => lower.endsWith(extension))) ?? null;
}

function groupLines(tokens) {
  const lines = [];
  let current = [];
  let line = 1;
  for (const token of tokens) {
    if (token.value === "\n" || token.raw === "\n") {
      lines.push({ line, tokens: current });
      current = [];
      line += 1;
    } else {
      current.push(token);
      line = token.line;
    }
  }
  if (current.length > 0) lines.push({ line, tokens: current });
  return lines;
}

function findDeclaration(tokens, selected) {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const keyword = token.value;
    const kind = selected.declarations[keyword];
    if (!kind) continue;
    if (keyword === "type" && selected.id === "go" && tokens[index + 1]?.value === "(") continue;
    const nameIndex = declarationNameIndex(tokens, index, keyword, selected);
    if (nameIndex < 0) continue;
    const nameToken = tokens[nameIndex];
    if (!nameToken) continue;
    return {
      kind,
      nameToken,
      startToken: token,
      endToken: declarationEnd(tokens, nameIndex),
      rule: `${keyword}-declaration`,
    };
  }

  const arrow = findArrowFunction(tokens);
  if (arrow) return arrow;
  if (selected.id === "ecmascript") {
    const method = findBraceMethod(tokens);
    if (method) return method;
  }
  if (selected.cFunctions) return findCFunction(tokens);
  if (selected.id === "shell") return findShellFunction(tokens);
  return null;
}

function declarationNameIndex(tokens, keywordIndex, keyword, selected) {
  let nameIndex = keywordIndex + 1;
  if (selected.id === "go" && keyword === "func" && tokens[nameIndex]?.value === "(") {
    const receiverEnd = matchingTokenIndexes(tokens, "(", ")").get(nameIndex);
    if (receiverEnd === undefined) return -1;
    nameIndex = receiverEnd + 1;
  }
  while (tokens[nameIndex] && tokens[nameIndex].type !== "identifier") nameIndex += 1;
  return tokens[nameIndex] ? nameIndex : -1;
}

function findBraceMethod(tokens) {
  const methodIndexes = braceMethodIndexes(tokens);
  const nameIndex = methodIndexes.values().next().value;
  if (nameIndex === undefined) return null;
  const nameToken = tokens[nameIndex];
  return {
    kind: "function",
    nameToken,
    startToken: nameToken,
    endToken: declarationEnd(tokens, nameIndex),
    rule: "method-declaration",
  };
}

function findArrowFunction(tokens) {
  const arrowIndex = tokens.findIndex((token) => token.value === "=>");
  if (arrowIndex < 0) return null;
  const equalsIndex = tokens.findIndex((token, index) => index < arrowIndex && token.value === "=");
  if (equalsIndex <= 0) return null;
  const nameToken = [...tokens.slice(0, equalsIndex)].reverse().find((token) => token.type === "identifier");
  if (!nameToken) return null;
  return {
    kind: "function",
    nameToken,
    startToken: nameToken,
    endToken: declarationEnd(tokens, arrowIndex),
    rule: "arrow-function-declaration",
  };
}

function findCFunction(tokens) {
  const openIndex = tokens.findIndex((token) => token.value === "(");
  const closeIndex = matchingTokenIndexes(tokens, "(", ")").get(openIndex);
  const hasBrace = tokens.some((token) => token.value === "{");
  if (openIndex <= 0 || closeIndex === undefined) return null;
  const nameToken = tokens[openIndex - 1];
  if (nameToken?.type !== "identifier" || CONTROL_CALLS.has(nameToken.value)) return null;
  if (tokens.slice(0, openIndex).some((token) => ["class", "interface", "new"].includes(token.value))) return null;
  if (!hasBrace && (openIndex < 2 || closeIndex !== tokens.length - 1
    || tokens.slice(0, openIndex - 1).some((token) => [".", "->", "=", "return"].includes(token.value)))) return null;
  return {
    kind: "function",
    nameToken,
    startToken: tokens[0],
    endToken: declarationEnd(tokens, openIndex),
    rule: "typed-function-declaration",
  };
}

function findShellFunction(tokens) {
  if (tokens[0]?.type === "identifier" && tokens[1]?.value === "(" && tokens[2]?.value === ")") {
    return {
      kind: "function",
      nameToken: tokens[0],
      startToken: tokens[0],
      endToken: declarationEnd(tokens, 2),
      rule: "shell-function-declaration",
    };
  }
  return null;
}

function findImports(tokens, selected) {
  const results = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const value = tokens[index].value;
    if (!selected.imports.includes(value)) continue;
    if (value === "from") {
      const stop = tokens.findIndex((token, candidate) => candidate > index && token.value === "import");
      const targetTokens = tokens.slice(index + 1, stop < 0 ? tokens.length : stop);
      const target = joinTarget(targetTokens);
      if (target) results.push(importRecord("imports", target, tokens[index], targetTokens.at(-1), "from-import"));
      continue;
    }
    const stringToken = tokens.slice(index + 1).find((token) => token.type === "string");
    if (stringToken) {
      results.push(importRecord("imports", unquote(stringToken.raw ?? stringToken.value), tokens[index], stringToken, `${value}-import`));
      continue;
    }
    const targetTokens = tokens.slice(index + 1).filter((token) => token.type === "identifier" || token.value === "." || token.value === "::");
    const target = joinTarget(targetTokens);
    if (target) results.push(importRecord(value === "package" ? "declares-package" : "imports", target, tokens[index], targetTokens.at(-1), `${value}-import`));
  }
  return results;
}

function importRecord(relation, target, startToken, endToken, rule) {
  return { relation, target, startToken, endToken: endToken ?? startToken, rule };
}

function findInheritance(tokens, selected, declaration) {
  const results = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (!selected.inheritance.includes(tokens[index].value)) continue;
    for (const token of tokens.slice(index + 1)) {
      if (token.type === "identifier" && token.value !== declaration.nameToken.value) results.push(token);
      if (token.value === "{") break;
    }
  }
  if (selected.id === "python") {
    const start = tokens.findIndex((token) => token.value === "(");
    const end = tokens.findIndex((token, index) => index > start && token.value === ")");
    if (start >= 0 && end > start) {
      results.push(...tokens.slice(start + 1, end).filter((token) => token.type === "identifier"));
    }
  }
  return results;
}

function findCalls(tokens, declaration, selected) {
  const calls = [];
  const declarationStart = declaration ? tokens.indexOf(declaration.startToken) : -1;
  const declarationEndIndex = declaration ? tokens.indexOf(declaration.endToken) : -1;
  const methods = selected.id === "ecmascript" ? braceMethodIndexes(tokens) : new Set();
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index];
    if (token.type !== "identifier" || tokens[index + 1].value !== "(") continue;
    if (declarationStart >= 0 && index >= declarationStart && index <= declarationEndIndex) continue;
    if (methods.has(index)) continue;
    if (CONTROL_CALLS.has(token.value) || token.value === declaration?.nameToken?.value) continue;
    if (["def", "fn", "func", "function"].includes(tokens[index - 1]?.value)) continue;
    calls.push(token);
  }
  return calls;
}

function braceMethodIndexes(tokens) {
  const result = new Set();
  const closingParentheses = matchingTokenIndexes(tokens, "(", ")");
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index];
    if (token.type !== "identifier" || CONTROL_CALLS.has(token.value)
      || tokens[index + 1]?.value !== "(") {
      continue;
    }
    const closeIndex = closingParentheses.get(index + 1);
    if (closeIndex !== undefined && tokens[closeIndex + 1]?.value === "{") result.add(index);
  }
  return result;
}

function matchingTokenIndexes(tokens, open, close) {
  const result = new Map();
  const stack = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value === open) {
      stack.push(index);
    } else if (tokens[index].value === close && stack.length > 0) {
      result.set(stack.pop(), index);
    }
  }
  return result;
}

function opensScope(tokens, selected, declaration) {
  if (selected.indentation || selected.endBlocks) return ["class", "module", "function"].includes(declaration.kind);
  return tokens.some((token) => token.value === "{");
}

function closeScopes(scope, { braceDepth, indent, selected, significant }) {
  if (selected.endBlocks && significant[0]?.value === "end") {
    scope.pop();
    return;
  }
  if (selected.indentation) {
    while (scope.length > 0 && indent <= scope.at(-1).indent) scope.pop();
    return;
  }
  while (scope.length > 0 && braceDepth < scope.at(-1).braceDepth) scope.pop();
}

function declarationEnd(tokens, index) {
  const terminator = tokens.slice(index).find((token) => ["{", ":", ";"].includes(token.value));
  return terminator ?? tokens.at(-1);
}

function lineIndent(source, offset) {
  const start = source.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  let width = 0;
  while (source[start + width] === " " || source[start + width] === "\t") width += source[start + width] === "\t" ? 2 : 1;
  return width;
}

function countToken(tokens, value) {
  return tokens.reduce((count, token) => count + Number(token.value === value), 0);
}

function joinTarget(tokens) {
  return tokens.map((token) => unquote(token.raw ?? token.value)).join("").trim();
}

function unquote(value) {
  const text = String(value);
  return /^(['"]).*\1$/s.test(text) ? text.slice(1, -1) : text;
}

function uniqueReferences(references) {
  return [...new Map(references.map((reference) => [reference.id, reference])).values()];
}

function maskPythonTripleStrings(source) {
  const output = source.split("");
  let index = 0; let quote = null; let escaped = false;
  while (index < source.length) {
    const char = source[index];
    if (quote?.length === 3) {
      if (!escaped && source.startsWith(quote, index)) {
        output.fill(" ", index, index + 3);
        index += 3;
        quote = null;
        continue;
      }
      if (char !== "\n" && char !== "\r") output[index] = " ";
      if (char === "\n" || char === "\r") escaped = false;
      else if (escaped) escaped = false;
      else escaped = char === "\\";
      index += 1;
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote || char === "\n" || char === "\r") quote = null;
      index += 1;
      continue;
    }
    if (char === "#") {
      while (index < source.length && !["\n", "\r"].includes(source[index])) index += 1;
      continue;
    }
    const triple = source.startsWith('"""', index) ? '"""' : source.startsWith("'''", index) ? "'''" : null;
    if (triple) {
      quote = triple;
      output.fill(" ", index, index + 3);
      index += 3;
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    index += 1;
  }
  return output.join("");
}

function maskBlockComments(source, { protectRegexOpen = false } = {}) {
  let output = "";
  let index = 0;
  let quote = null;
  let escaped = false;
  let block = false;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (block) {
      if (char === "*" && next === "/") {
        output += "  ";
        index += 2;
        block = false;
      } else {
        output += char === "\n" ? "\n" : " ";
        index += 1;
      }
      continue;
    }
    if (!quote && char === "/" && next === "*"
      && !(protectRegexOpen && (isEscapedAt(source, index) || isRegexCharacterClassAt(source, index)))) {
      output += "  ";
      index += 2;
      block = true;
      continue;
    }
    output += char;
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
    } else if (char === "'" || char === '"' || char === "`") {
      quote = char;
    }
    index += 1;
  }
  return output;
}

function isRegexCharacterClassAt(source, index) {
  const window = source.slice(Math.max(0, index - 128), index); const prefix = window.slice(Math.max(window.lastIndexOf("\n"), window.lastIndexOf("\r")) + 1);
  const open = prefix.lastIndexOf("["); if (open < 0 || prefix.lastIndexOf("]") > open) return false;
  const before = prefix.slice(0, open); const slash = before.lastIndexOf("/");
  if (slash < 0) return false;
  const lead = before.slice(0, slash).trimEnd();
  return !lead || /[=(:,!&|?{};\[]$/.test(lead) || /\b(?:return|throw|case)$/.test(lead);
}

function isEscapedAt(source, index) {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}
