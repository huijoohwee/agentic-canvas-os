import { inflateSync } from "node:zlib";
import { deepFreeze, sha256 } from "./canonical.js";
import { createEntity, createIr, createSpanLocator, diagnostic, parserIdentity } from "./ir.js";
const VERSION = "1.0.0";
const MAX_STREAMS = 512;
const MAX_STREAM_BYTES = 1024 * 1024;
const MAX_EXPANDED_BYTES = 8 * 1024 * 1024;
const MAX_DICTIONARY_BYTES = 64 * 1024;
const MAX_CONTENT_TOKENS = 200_000;
const MAX_MALFORMED_DIAGNOSTICS = 512;
const MAX_OPERANDS = 4_096;
const MAX_TEXT_REGIONS = 10_000;
const RULE_ID = "pdf.text-operator";
const TEXT_OPERATORS = new Set(["Tj", "TJ", "'", '"']);
const PARSER = parserIdentity("builtin.pdf.text", VERSION, {
  filters: ["none", "FlateDecode"],
  limits: { contentTokens: MAX_CONTENT_TOKENS, expandedBytes: MAX_EXPANDED_BYTES,
    malformedDiagnostics: MAX_MALFORMED_DIAGNOSTICS, operands: MAX_OPERANDS,
    streamBytes: MAX_STREAM_BYTES, streams: MAX_STREAMS, textRegions: MAX_TEXT_REGIONS },
  operators: [...TEXT_OPERATORS],
});
export const PDF_EXTENSIONS = deepFreeze([".pdf"]);
export function supportsPdfPath(path) { return typeof path === "string" && path.toLowerCase().endsWith(".pdf"); }
export function parsePdf({ path, bytes }) {
  if (!supportsPdfPath(path)) throw new TypeError(`unsupported PDF path: ${path}`);
  const input = toBuffer(bytes);
  const source = input.toString("latin1");
  const locateSpan = createSpanLocator(source);
  const diagnostics = [];
  const entities = [];
  const astChildren = [];
  const headerOffset = source.indexOf("%PDF-");
  if (headerOffset < 0 || headerOffset > 1024) {
    diagnostics.push(diagnostic({
      code: "pdf_malformed_header",
      message: "The input does not contain a PDF header in the first 1,024 bytes.",
      severity: "error",
      span: locateSpan(0, Math.min(source.length, 5)),
    }));
    return makeIr({ path, source, entities, astChildren, diagnostics });
  }
  const encryptedAt = encryptionOffset(source);
  if (encryptedAt >= 0) {
    diagnostics.push(diagnostic({
      code: "pdf_encrypted",
      message: "Encrypted PDF content is not supported by the deterministic text parser.",
      severity: "error",
      span: locateSpan(encryptedAt, Math.min(source.length, encryptedAt + 8)),
    }));
    return makeIr({ path, source, entities, astChildren, diagnostics });
  }
  const streams = scanStreams(source, diagnostics, locateSpan);
  let contentTokens = 0;
  let expandedBytes = 0;
  let malformedDiagnostics = 0;
  let regionCount = 0;
  let malformedLimitReported = false;
  let operandLimitReported = false;
  let regionLimitReported = false;
  let tokenLimitReported = false;
  for (const stream of streams) {
    const decoded = decodeStream({ input, stream, diagnostics, locateSpan });
    if (!decoded) continue;
    if (expandedBytes + decoded.length > MAX_EXPANDED_BYTES) {
      diagnostics.push(streamDiagnostic({
        stream, locateSpan,
        code: "pdf_expanded_bytes_limit",
        message: `Expanded stream data exceeds the ${MAX_EXPANDED_BYTES}-byte document limit.`,
      }));
      break;
    }
    expandedBytes += decoded.length;
    const parsed = extractTextRegions(decoded, {
      maxMalformed: Math.max(0, MAX_MALFORMED_DIAGNOSTICS - malformedDiagnostics),
      maxRegions: Math.max(0, MAX_TEXT_REGIONS - regionCount),
      maxTokens: Math.max(0, MAX_CONTENT_TOKENS - contentTokens),
    });
    contentTokens += parsed.tokenCount;
    if (parsed.tokenTruncated && !tokenLimitReported) {
      diagnostics.push(limitDiagnostic(locateSpan, stream, "pdf_content_token_limit",
        `PDF content scanning stopped at the ${MAX_CONTENT_TOKENS}-token document limit.`,
        MAX_CONTENT_TOKENS, contentTokens + 1));
      tokenLimitReported = true;
    }
    if (parsed.operandTruncated && !operandLimitReported) {
      diagnostics.push(limitDiagnostic(locateSpan, stream, "pdf_text_operand_limit",
        `PDF text operand collection was truncated at ${MAX_OPERANDS} operands.`, MAX_OPERANDS));
      operandLimitReported = true;
    }
    for (const malformed of parsed.malformed) {
      diagnostics.push(diagnostic({
        code: "pdf_text_operand_malformed",
        message: `Malformed ${malformed.kind} text operand in PDF stream ${stream.index}.`,
        severity: "warning",
        span: regionSpan(locateSpan, stream, malformed.start, malformed.end),
        detail: { decodedByteEnd: malformed.end, decodedByteStart: malformed.start, streamIndex: stream.index },
      }));
    }
    malformedDiagnostics += parsed.malformed.length;
    if (parsed.malformedTruncated && !malformedLimitReported) {
      diagnostics.push(limitDiagnostic(locateSpan, stream, "pdf_malformed_diagnostic_limit",
        `Malformed PDF text diagnostics were truncated at ${MAX_MALFORMED_DIAGNOSTICS} records.`,
        MAX_MALFORMED_DIAGNOSTICS));
      malformedLimitReported = true;
    }

    for (const region of parsed.regions) {
      if (!hasVisibleText(region.text)) continue;
      const index = regionCount;
      const name = `pdf-region-${pad(stream.index, 4)}-${pad(region.index, 6)}`;
      const span = regionSpan(locateSpan, stream, region.start, region.end);
      const sourceBytes = sourceByteRange(stream, region);
      const properties = {
        decodedByteEnd: region.end, decodedByteStart: region.start,
        encoding: stream.flate ? "flate" : "plain", operator: region.operator,
        regionIndex: region.index, sourceByteEnd: sourceBytes.end,
        sourceByteStart: sourceBytes.start, streamIndex: stream.index, text: region.text,
      };
      const entity = createEntity({
        path, kind: "pdf-region", name, span, ruleId: RULE_ID, parentId: null, properties,
      });
      entities.push(entity);
      astChildren.push({
        type: "pdf-region", id: entity.id, name, parentId: null, ruleId: RULE_ID,
        span, streamIndex: stream.index, text: region.text,
      });
      regionCount = index + 1;
    }
    if (parsed.regionTruncated && !regionLimitReported) {
      diagnostics.push(limitDiagnostic(locateSpan, stream, "pdf_text_region_limit",
        `PDF text extraction stopped at ${MAX_TEXT_REGIONS} regions.`, MAX_TEXT_REGIONS));
      regionLimitReported = true;
    }
    if (regionLimitReported || tokenLimitReported) break;
  }
  if (entities.length === 0) {
    const imageOnly = /\/Subtype\s*\/Image\b/.test(source);
    diagnostics.push(diagnostic({
      code: imageOnly ? "pdf_image_only" : "pdf_no_text",
      message: imageOnly
        ? "The PDF contains image content but no supported text regions."
        : "No supported PDF text regions were observed.",
      severity: "info",
      detail: { streamsInspected: streams.length },
    }));
  }

  return makeIr({ path, source, entities, astChildren, diagnostics });
}
function makeIr({ path, source, entities, astChildren, diagnostics }) {
  const bytes = Buffer.from(source, "latin1");
  return createIr({
    path, source, sourceDigest: sha256(bytes), sourceBytes: bytes.length,
    parser: PARSER, astChildren, entities, references: [], diagnostics,
  });
}
function toBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return Buffer.from(bytes);
  if (bytes instanceof ArrayBuffer) return Buffer.from(bytes.slice(0));
  if (ArrayBuffer.isView(bytes)) {
    return Buffer.from(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  }
  throw new TypeError("PDF bytes must be a Buffer, ArrayBuffer, or typed array");
}
function encryptionOffset(source) {
  const pattern = /\/Encrypt\b/g;
  for (const match of source.matchAll(pattern)) {
    const open = source.lastIndexOf("<<", match.index);
    const close = source.lastIndexOf(">>", match.index);
    if (open > close) return match.index;
  }
  return -1;
}
function scanStreams(source, diagnostics, locateSpan) {
  const records = [];
  let cursor = 0;
  let candidates = 0;
  while (cursor < source.length) {
    const marker = findStreamMarker(source, cursor);
    if (!marker) break;
    candidates += 1;
    if (candidates > MAX_STREAMS) {
      diagnostics.push(diagnostic({
        code: "pdf_stream_limit",
        message: `PDF stream scanning stopped at the ${MAX_STREAMS}-stream limit.`,
        severity: "warning",
        span: locateSpan(marker.start, marker.end),
      }));
      break;
    }
    const dictionary = findDictionaryBefore(source, marker.start);
    if (!dictionary) {
      diagnostics.push(diagnostic({
        code: "pdf_stream_malformed",
        message: `PDF stream ${records.length} has no bounded object dictionary.`,
        severity: "warning",
        span: locateSpan(marker.start, marker.end),
      }));
      cursor = marker.end;
      continue;
    }
    const ending = findStreamEnd(source, marker.end, dictionary.text);
    if (!ending) {
      diagnostics.push(diagnostic({
        code: "pdf_stream_malformed",
        message: `PDF stream ${records.length} has no terminating endstream keyword.`,
        severity: "warning",
        span: locateSpan(dictionary.start, marker.end),
      }));
      break;
    }
    const filters = readFilters(dictionary.text);
    records.push({
      index: records.length,
      dictionary,
      bodyStart: marker.end,
      bodyEnd: ending.bodyEnd,
      objectEnd: ending.keywordEnd,
      filters,
      flate: filters.names.length === 1 && filters.names[0] === "FlateDecode",
    });
    if (ending.lengthMismatch) {
      diagnostics.push(diagnostic({
        code: "pdf_stream_length_mismatch",
        message: `PDF stream ${records.length - 1} did not end at its declared direct length.`,
        severity: "warning",
        span: locateSpan(dictionary.start, ending.keywordEnd),
      }));
    }
    cursor = ending.keywordEnd;
  }
  return records;
}
function findStreamMarker(source, from) {
  let cursor = from;
  while (cursor < source.length) {
    const start = source.indexOf("stream", cursor);
    if (start < 0) return null;
    const before = start === 0 ? "" : source[start - 1];
    const after = start + 6;
    const boundary = start === 0 || isWhite(before);
    if (boundary && source.startsWith("\r\n", after)) return { start, end: after + 2 };
    if (boundary && (source[after] === "\n" || source[after] === "\r")) {
      return { start, end: after + 1 };
    }
    cursor = after;
  }
  return null;
}
function findDictionaryBefore(source, markerStart) {
  let end = markerStart;
  while (end > 0 && isWhite(source[end - 1])) end -= 1;
  if (source.slice(end - 2, end) !== ">>") return null;
  let depth = 0;
  const minimum = Math.max(0, end - MAX_DICTIONARY_BYTES);
  for (let index = end - 2; index >= minimum; index -= 1) {
    const pair = source.slice(index, index + 2);
    if (pair === ">>") {
      depth += 1;
      index -= 1;
    } else if (pair === "<<") {
      depth -= 1;
      if (depth === 0) return { start: index, end, text: source.slice(index, end) };
      index -= 1;
    }
  }
  return null;
}
function findStreamEnd(source, bodyStart, dictionary) {
  const lengthEntry = /\/Length\s+(\d+)(?:\s+(\d+)\s+R\b)?/.exec(dictionary);
  const lengthMatch = lengthEntry && lengthEntry[2] === undefined ? lengthEntry : null;
  let lengthMismatch = false;
  if (lengthMatch) {
    const length = Number(lengthMatch[1]);
    const bodyEnd = bodyStart + length;
    const keywordStart = skipWhite(source, bodyEnd);
    if (Number.isSafeInteger(length) && bodyEnd <= source.length
      && source.startsWith("endstream", keywordStart)
      && keywordBoundary(source, keywordStart, "endstream")) {
      return { bodyEnd, keywordEnd: keywordStart + 9, lengthMismatch: false };
    }
    lengthMismatch = true;
  }
  let cursor = bodyStart;
  while (cursor < source.length) {
    const keywordStart = source.indexOf("endstream", cursor);
    if (keywordStart < 0) return null;
    if (keywordBoundary(source, keywordStart, "endstream")) {
      return {
        bodyEnd: trimStreamEol(source, bodyStart, keywordStart),
        keywordEnd: keywordStart + 9,
        lengthMismatch,
      };
    }
    cursor = keywordStart + 9;
  }
  return null;
}
function readFilters(dictionary) {
  const match = /\/Filter\b/.exec(dictionary);
  if (!match) return { names: [], present: false };
  const tail = dictionary.slice(match.index + match[0].length).trimStart();
  if (tail.startsWith("[")) {
    const close = tail.indexOf("]");
    if (close < 0 || close > 4096) return { names: [], present: true };
    return { names: [...tail.slice(1, close).matchAll(/\/([^\s<>\[\]()/%]+)/g)].map((entry) => entry[1]), present: true };
  }
  const name = /^\/([^\s<>\[\]()/%]+)/.exec(tail);
  return { names: name ? [name[1]] : [], present: true };
}
function decodeStream({ input, stream, diagnostics, locateSpan }) {
  if (stream.filters.present
    && !(stream.filters.names.length === 1 && stream.filters.names[0] === "FlateDecode")) {
    diagnostics.push(streamDiagnostic({
      stream, locateSpan,
      code: "pdf_filter_unsupported",
      message: `PDF stream ${stream.index} uses unsupported filters.`,
      detail: { filters: stream.filters.names, streamIndex: stream.index },
    }));
    return null;
  }
  const encoded = input.subarray(stream.bodyStart, stream.bodyEnd);
  if (!stream.flate) {
    if (encoded.length > MAX_STREAM_BYTES) {
      diagnostics.push(streamDiagnostic({
        stream, locateSpan,
        code: "pdf_stream_expansion_limit",
        message: `PDF stream ${stream.index} exceeds the ${MAX_STREAM_BYTES}-byte expanded stream limit.`,
      }));
      return null;
    }
    return Buffer.from(encoded);
  }
  try {
    const decoded = inflateSync(encoded, { maxOutputLength: MAX_STREAM_BYTES + 1 });
    if (decoded.length > MAX_STREAM_BYTES) {
      diagnostics.push(streamDiagnostic({
        stream, locateSpan,
        code: "pdf_stream_expansion_limit",
        message: `PDF stream ${stream.index} exceeds the ${MAX_STREAM_BYTES}-byte expanded stream limit.`,
      }));
      return null;
    }
    return decoded;
  } catch (error) {
    const overLimit = error?.code === "ERR_BUFFER_TOO_LARGE";
    diagnostics.push(streamDiagnostic({
      stream, locateSpan,
      code: overLimit ? "pdf_stream_expansion_limit" : "pdf_stream_decode_failed",
      message: overLimit
        ? `PDF stream ${stream.index} exceeds the ${MAX_STREAM_BYTES}-byte expanded stream limit.`
        : `PDF stream ${stream.index} could not be expanded.`,
      severity: "warning",
    }));
    return null;
  }
}
function extractTextRegions(buffer, { maxMalformed, maxRegions, maxTokens }) {
  const tokenized = tokenizeContent(buffer.toString("latin1"), maxTokens);
  const regions = [];
  const malformed = [];
  let operands = [];
  let malformedTruncated = false;
  let operandOverflow = false;
  let operandTruncated = false;
  let regionTruncated = false;
  for (const token of tokenized.tokens) {
    if (token.malformed) {
      if (malformed.length < maxMalformed) malformed.push(token);
      else malformedTruncated = true;
    }
    if (token.kind !== "word") {
      if (!operandOverflow && operands.length < MAX_OPERANDS) operands.push(token);
      else {
        operandOverflow = true;
        operandTruncated = true;
      }
      continue;
    }
    if (TEXT_OPERATORS.has(token.value)) {
      const strings = operandOverflow ? [] : textOperands(token.value, operands);
      if (strings.length > 0) {
        if (regions.length >= maxRegions) {
          regionTruncated = true;
          break;
        }
        regions.push({
          index: regions.length,
          operator: token.value,
          start: strings[0].start,
          end: token.end,
          text: strings.map((item) => item.value).join(""),
        });
      }
      operands = [];
      operandOverflow = false;
    } else if (isPrimitiveOperand(token.value)) {
      if (!operandOverflow && operands.length < MAX_OPERANDS) operands.push(token);
      else {
        operandOverflow = true;
        operandTruncated = true;
      }
    } else {
      operands = [];
      operandOverflow = false;
    }
  }
  return {
    regions,
    malformed,
    malformedTruncated,
    operandTruncated,
    regionTruncated,
    tokenCount: tokenized.tokens.length,
    tokenTruncated: tokenized.truncated,
  };
}
function textOperands(operator, operands) {
  if (operator !== "TJ") {
    const value = [...operands].reverse().find((token) => token.kind === "string");
    return value ? [value] : [];
  }
  let depth = 0;
  let start = -1;
  let lastRange = null;
  for (let index = 0; index < operands.length; index += 1) {
    if (operands[index].kind === "open-array") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (operands[index].kind === "close-array" && depth > 0) {
      depth -= 1;
      if (depth === 0) lastRange = [start, index];
    }
  }
  if (!lastRange) return [];
  return operands.slice(lastRange[0] + 1, lastRange[1]).filter((token) => token.kind === "string");
}
function tokenizeContent(source, maxTokens) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    if (tokens.length >= maxTokens) return { tokens, truncated: true };
    const char = source[index];
    if (isWhite(char)) {
      index += 1;
    } else if (char === "%") {
      while (index < source.length && !["\r", "\n"].includes(source[index])) index += 1;
    } else if (char === "(") {
      const token = readLiteral(source, index);
      tokens.push(token);
      index = token.end;
    } else if (char === "<" && source[index + 1] !== "<") {
      const token = readHex(source, index);
      tokens.push(token);
      index = token.end;
    } else if (char === "[") {
      tokens.push({ kind: "open-array", start: index, end: index + 1 });
      index += 1;
    } else if (char === "]") {
      tokens.push({ kind: "close-array", start: index, end: index + 1 });
      index += 1;
    } else if (isDelimiter(char)) {
      tokens.push({ kind: "punctuation", value: char, start: index, end: index + 1 });
      index += 1;
    } else {
      const start = index;
      while (index < source.length && !isWhite(source[index]) && !isDelimiter(source[index])) index += 1;
      tokens.push({ kind: "word", value: source.slice(start, index), start, end: index });
    }
  }
  return { tokens, truncated: false };
}
function readLiteral(source, start) {
  const output = [];
  let depth = 1;
  let index = start + 1;
  while (index < source.length) {
    const code = source.charCodeAt(index);
    if (code === 0x5c) {
      const escaped = readEscape(source, index);
      output.push(...escaped.bytes);
      index = escaped.end;
    } else if (code === 0x28) {
      depth += 1;
      output.push(code);
      index += 1;
    } else if (code === 0x29) {
      depth -= 1;
      index += 1;
      if (depth === 0) {
        return { kind: "string", value: decodeTextBytes(output), start, end: index, malformed: false };
      }
      output.push(code);
    } else {
      output.push(code & 0xff);
      index += 1;
    }
  }
  return { kind: "string", value: decodeTextBytes(output), start, end: index, malformed: true };
}
function readEscape(source, start) {
  let index = start + 1;
  if (index >= source.length) return { bytes: [], end: index };
  if (source[index] === "\r" || source[index] === "\n") {
    if (source[index] === "\r" && source[index + 1] === "\n") index += 1;
    return { bytes: [], end: index + 1 };
  }
  const octal = /^[0-7]{1,3}/.exec(source.slice(index, index + 3));
  if (octal) return { bytes: [Number.parseInt(octal[0], 8) & 0xff], end: index + octal[0].length };
  const escapes = { b: 0x08, f: 0x0c, n: 0x0a, r: 0x0d, t: 0x09 };
  const char = source[index];
  return { bytes: [escapes[char] ?? source.charCodeAt(index) & 0xff], end: index + 1 };
}
function readHex(source, start) {
  let index = start + 1;
  let digits = "";
  let malformed = false;
  while (index < source.length && source[index] !== ">") {
    if (!isWhite(source[index])) {
      if (/[0-9A-Fa-f]/.test(source[index])) digits += source[index];
      else malformed = true;
    }
    index += 1;
  }
  if (source[index] === ">") index += 1;
  else malformed = true;
  if (digits.length % 2 === 1) digits += "0";
  const output = [];
  for (let cursor = 0; cursor < digits.length; cursor += 2) {
    output.push(Number.parseInt(digits.slice(cursor, cursor + 2), 16));
  }
  return { kind: "string", value: decodeTextBytes(output), start, end: index, malformed };
}
function decodeTextBytes(values) {
  const bytes = Buffer.from(values);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    let result = "";
    for (let index = 2; index + 1 < bytes.length; index += 2) {
      result += String.fromCharCode((bytes[index] << 8) | bytes[index + 1]);
    }
    return result;
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString("utf16le");
  return bytes.toString("latin1");
}
function sourceByteRange(stream, region) {
  if (stream.flate) return { start: stream.bodyStart, end: stream.bodyEnd };
  return { start: Math.min(stream.bodyEnd, stream.bodyStart + region.start),
    end: Math.min(stream.bodyEnd, stream.bodyStart + region.end) };
}
function regionSpan(locateSpan, stream, start, end) {
  const range = stream.flate
    ? { start: stream.bodyStart, end: stream.bodyEnd }
    : {
        start: Math.min(stream.bodyEnd, stream.bodyStart + start),
        end: Math.min(stream.bodyEnd, stream.bodyStart + end),
      };
  return locateSpan(range.start, Math.max(range.start, range.end));
}
function streamDiagnostic({ stream, locateSpan, code, message, severity = "warning", detail = null }) {
  return diagnostic({
    code, message, severity,
    span: locateSpan(stream.dictionary.start, stream.objectEnd),
    detail: detail ?? { streamIndex: stream.index },
  });
}
function limitDiagnostic(locateSpan, stream, code, message, limit, observed = null) {
  return streamDiagnostic({
    stream, locateSpan, code, message,
    detail: { limit, ...(observed === null ? {} : { observed }), partial: true,
      streamIndex: stream.index },
  });
}
function keywordBoundary(source, start, keyword) {
  const before = start === 0 || isWhite(source[start - 1]) || isDelimiter(source[start - 1]);
  const end = start + keyword.length;
  const after = end >= source.length || isWhite(source[end]) || isDelimiter(source[end]);
  return before && after;
}
function trimStreamEol(source, bodyStart, end) {
  if (end > bodyStart && source[end - 1] === "\n") {
    return end > bodyStart + 1 && source[end - 2] === "\r" ? end - 2 : end - 1;
  }
  if (end > bodyStart && source[end - 1] === "\r") return end - 1;
  return end;
}
function skipWhite(source, from) {
  let index = from;
  while (index < source.length && isWhite(source[index])) index += 1;
  return index;
}
function isPrimitiveOperand(value) { return /^(?:[+-]?(?:\d+\.?\d*|\.\d+)|true|false|null)$/.test(value); }
function hasVisibleText(value) { return value.replace(/\0/g, "").trim().length > 0; }
function isWhite(char) {
  return char === "\0" || char === "\t" || char === "\n"
    || char === "\f" || char === "\r" || char === " ";
}
function isDelimiter(char) { return ["(", ")", "<", ">", "[", "]", "{", "}", "/", "%"].includes(char); }
function pad(value, width) { return String(value).padStart(width, "0"); }
