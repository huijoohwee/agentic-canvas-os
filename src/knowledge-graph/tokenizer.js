const IDENTIFIER_START = /[\p{L}\p{Nl}_$]/u;
const IDENTIFIER_PART = /[\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}\p{Pc}$]/u;
const MULTI_SYMBOLS = Object.freeze([
  ">>>=", "===", "!==", "**=", "<<=", ">>=", "...", "=>", "->", "::", "==", "!=",
  "<=", ">=", "&&", "||", "??", "?.", "++", "--", "**", "<<", ">>", "+=", "-=",
  "*=", "/=", "%=", "&=", "|=", "^=",
]);
export const TOKENIZER_TOKEN_LIMIT = 200_000;

export function tokenize(source, options = {}) {
  if (typeof source !== "string") throw new TypeError("source must be a string");
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("options must be a plain object");
  }
  const optionsPrototype = Object.getPrototypeOf(options);
  if (optionsPrototype !== Object.prototype && optionsPrototype !== null) {
    throw new TypeError("options must be a plain object");
  }
  const allowedOptions = new Set(["commentPrefixes", "caseSensitive"]);
  for (const key of Object.keys(options)) {
    if (!allowedOptions.has(key)) throw new TypeError(`options has unknown key "${key}"`);
  }

  const caseSensitive = options.caseSensitive ?? true;
  if (typeof caseSensitive !== "boolean") throw new TypeError("caseSensitive must be a boolean");
  const prefixes = normalizePrefixes(options.commentPrefixes ?? []);
  const tokens = [];
  let index = 0;
  let line = 1;
  let column = 1;

  const emit = (type, value, raw, start, startLine, startColumn) => {
    if (tokens.length >= TOKENIZER_TOKEN_LIMIT) {
      const error = new RangeError(`tokenizer exceeds ${TOKENIZER_TOKEN_LIMIT} tokens`);
      error.code = "tokenizer_token_limit";
      error.detail = Object.freeze({ limit: TOKENIZER_TOKEN_LIMIT, observed: tokens.length + 1, partial: false });
      throw error;
    }
    tokens.push({ type, value, raw, line: startLine, column: startColumn, start, end: index });
  };

  while (index < source.length) {
    const start = index;
    const startLine = line;
    const startColumn = column;
    const newline = readNewline(source, index);
    if (newline) {
      index += newline.length;
      line += 1;
      column = 1;
      emit("symbol", "\n", newline, start, startLine, startColumn);
      continue;
    }

    const commentPrefix = prefixes.find((prefix) => source.startsWith(prefix, index));
    if (commentPrefix) {
      while (index < source.length && !readNewline(source, index)) {
        const character = readCharacter(source, index);
        index += character.length;
        column += character.length;
      }
      continue;
    }

    const character = readCharacter(source, index);
    if (isHorizontalWhitespace(character)) {
      index += character.length;
      column += character.length;
      continue;
    }

    if (character === "\"" || character === "'" || character === "`") {
      const stringToken = readString(source, index, line, column, character);
      index = stringToken.end;
      line = stringToken.nextLine;
      column = stringToken.nextColumn;
      emit("string", stringToken.value, stringToken.raw, start, startLine, startColumn);
      continue;
    }

    if (isIdentifierStart(character)) {
      index += character.length;
      column += character.length;
      while (index < source.length) {
        const next = readCharacter(source, index);
        if (!isIdentifierPart(next)) break;
        index += next.length;
        column += next.length;
      }
      const raw = source.slice(start, index);
      emit("identifier", caseSensitive ? raw : raw.toLowerCase(), raw, start, startLine, startColumn);
      continue;
    }

    const numberRaw = readNumber(source, index);
    if (numberRaw) {
      index += numberRaw.length;
      column += numberRaw.length;
      emit("number", numberRaw, numberRaw, start, startLine, startColumn);
      continue;
    }

    const symbol = MULTI_SYMBOLS.find((candidate) => source.startsWith(candidate, index))
      ?? character;
    index += symbol.length;
    column += symbol.length;
    emit("symbol", symbol, symbol, start, startLine, startColumn);
  }

  return tokens;
}

function normalizePrefixes(value) {
  if (!Array.isArray(value)) throw new TypeError("commentPrefixes must be an array");
  const seen = new Set();
  const prefixes = value.map((prefix, index) => {
    if (typeof prefix !== "string" || prefix.length === 0 || prefix.length > 128) {
      throw new TypeError(`commentPrefixes[${index}] must be a non-empty string of at most 128 characters`);
    }
    if (prefix.includes("\n") || prefix.includes("\r")) {
      throw new TypeError(`commentPrefixes[${index}] must not contain a newline`);
    }
    if (seen.has(prefix)) throw new TypeError(`duplicate comment prefix "${prefix}"`);
    seen.add(prefix);
    return prefix;
  });
  return prefixes.sort((left, right) => right.length - left.length || ordinalCompare(left, right));
}

function readString(source, start, line, column, quote) {
  let index = start + quote.length;
  let nextLine = line;
  let nextColumn = column + quote.length;
  let value = "";

  while (index < source.length) {
    const newline = readNewline(source, index);
    if (newline) break;
    const character = readCharacter(source, index);
    if (character === quote) {
      index += character.length;
      nextColumn += character.length;
      break;
    }
    if (character === "\\" && index + 1 < source.length) {
      const escape = readEscape(source, index);
      value += escape.value;
      index += escape.length;
      nextColumn += escape.length;
      continue;
    }
    value += character;
    index += character.length;
    nextColumn += character.length;
  }

  return {
    value,
    raw: source.slice(start, index),
    end: index,
    nextLine,
    nextColumn,
  };
}

function readEscape(source, index) {
  const marker = source[index + 1];
  const simple = {
    "0": "\0", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v",
    "\\": "\\", "\"": "\"", "'": "'", "`": "`",
  };
  if (Object.hasOwn(simple, marker)) return { value: simple[marker], length: 2 };
  const hex = marker === "x" ? source.slice(index + 2, index + 4) : "";
  if (/^[0-9a-fA-F]{2}$/.test(hex)) {
    return { value: String.fromCodePoint(Number.parseInt(hex, 16)), length: 4 };
  }
  const unicode = marker === "u" ? source.slice(index + 2, index + 6) : "";
  if (/^[0-9a-fA-F]{4}$/.test(unicode)) {
    return { value: String.fromCodePoint(Number.parseInt(unicode, 16)), length: 6 };
  }
  return { value: marker, length: 2 };
}

function readNumber(source, index) {
  const tail = source.slice(index);
  return tail.match(/^(?:0[xX][0-9a-fA-F](?:_?[0-9a-fA-F])*|0[bB][01](?:_?[01])*|0[oO][0-7](?:_?[0-7])*|\d(?:_?\d)*(?:\.\d(?:_?\d)*)?(?:[eE][+-]?\d(?:_?\d)*)?|\.\d(?:_?\d)*(?:[eE][+-]?\d(?:_?\d)*)?)/)?.[0] || "";
}

function readNewline(source, index) {
  if (source[index] === "\r") return source[index + 1] === "\n" ? "\r\n" : "\r";
  return source[index] === "\n" ? "\n" : "";
}

function readCharacter(source, index) {
  const codePoint = source.codePointAt(index);
  return codePoint === undefined ? "" : String.fromCodePoint(codePoint);
}

function isIdentifierStart(character) {
  return IDENTIFIER_START.test(character);
}

function isIdentifierPart(character) {
  return IDENTIFIER_PART.test(character);
}

function isHorizontalWhitespace(character) {
  return character !== "\n" && character !== "\r" && /\s/u.test(character);
}

function ordinalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
