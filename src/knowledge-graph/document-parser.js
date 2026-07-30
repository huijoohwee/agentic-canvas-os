import {
  createEntity,
  createIr,
  createReference,
  createSpanLocator,
  diagnostic,
  parserIdentity,
} from "./ir.js";

const VERSION = "1.0.0";
const MAX_HEADING_CHARS = 240;
const MAX_PARAGRAPH_CHARS = 480;
const MAX_DOCUMENT_LINES = 10_000;
const MAX_DOCUMENT_REFERENCES = 10_000;
const EXTENSIONS = [".md", ".mdx", ".txt", ".rst", ".adoc"];
const DOCUMENT_TARGET = String.raw`(?:md|mdx|txt|rst|adoc|pdf)`;
const EMAIL_TARGET = String.raw`[A-Za-z0-9.!#$%&'*+/=?^_{}|~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}`;

export const DOCUMENT_EXTENSIONS = Object.freeze(EXTENSIONS);

export function supportsDocumentPath(path) {
  if (typeof path !== "string") return false;
  const lower = path.toLowerCase();
  return EXTENSIONS.some((extension) => lower.endsWith(extension));
}

export function parseDocument({ path, source }) {
  if (!supportsDocumentPath(path)) throw new TypeError(`unsupported document path: ${path}`);
  if (typeof source !== "string") throw new TypeError("document source must be a string");

  const format = formatFor(path);
  const lineScan = sourceLines(source);
  const lines = lineScan.lines;
  const referenceSpan = createSpanLocator(source);
  const referenceState = { truncated: false };
  const entities = [];
  const references = [];
  const diagnostics = [];
  if (lineScan.truncated) diagnostics.push(diagnostic({
    code: "document_line_limit",
    message: `Document parsing stopped at the ${MAX_DOCUMENT_LINES}-line limit.`,
    severity: "warning",
    span: referenceSpan(lineScan.nextOffset, lineScan.nextOffset),
    detail: { limit: MAX_DOCUMENT_LINES, partial: true },
  }));
  const astChildren = [];
  const sections = [];
  const rstLevels = new Map();
  const frontmatterEnd = markdownFrontmatterEnd(lines, format);
  let paragraph = null;
  let paragraphOrdinal = 0;

  const attachAst = (node) => {
    const parent = sections.at(-1)?.ast;
    if (parent) parent.children.push(node);
    else astChildren.push(node);
  };

  const flushParagraph = () => {
    if (!paragraph) return;
    const parent = sections.at(-1)?.entity ?? null;
    const chunks = paragraphChunks(source, paragraph.start, paragraph.end);
    const emitted = [];
    for (const chunk of chunks) {
      paragraphOrdinal += 1;
      const entity = createEntity({
        path,
        kind: "paragraph",
        name: `paragraph-${paragraphOrdinal}`,
        span: referenceSpan(chunk.start, chunk.end),
        ruleId: "document.paragraph.chunk",
        parentId: parent?.id ?? null,
        properties: {
          ordinal: paragraphOrdinal,
          text: boundedNormalizedText(chunk.text, MAX_PARAGRAPH_CHARS),
        },
      });
      entities.push(entity);
      emitted.push(entity);
      attachAst(astNode(entity, { children: [] }));
    }
    emitReferences({
      path,
      source,
      start: paragraph.start,
      end: paragraph.end,
      references,
      diagnostics,
      referenceSpan,
      referenceState,
      sourceIdForOffset: (offset) => parent?.id
        ?? emitted.find((entity) => entity.span.start.offset <= offset
          && offset < entity.span.end.offset)?.id
        ?? emitted.at(-1)?.id
        ?? null,
    });
    paragraph = null;
  };

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    const heading = headingAt(lines, index, format, rstLevels, frontmatterEnd);
    if (heading) {
      flushParagraph();
      while (sections.length > 0 && sections.at(-1).level >= heading.level) sections.pop();
      const parentId = sections.at(-1)?.entity.id ?? null;
      const entity = createEntity({
        path,
        kind: "section",
        name: boundedNormalizedText(heading.name, MAX_HEADING_CHARS),
        span: referenceSpan(heading.start, heading.end),
        ruleId: heading.ruleId,
        parentId,
        properties: {
          level: heading.level,
          text: boundedNormalizedText(heading.name, MAX_HEADING_CHARS),
        },
      });
      const node = astNode(entity, { children: [], level: heading.level });
      if (sections.length > 0) sections.at(-1).ast.children.push(node);
      else astChildren.push(node);
      sections.push({ level: heading.level, entity, ast: node });
      entities.push(entity);
      emitReferences({
        path,
        source,
        start: heading.titleStart,
        end: heading.titleEnd,
        references,
        diagnostics,
        referenceSpan,
        referenceState,
        sourceIdForOffset: () => entity.id,
      });
      index += heading.consumed;
      continue;
    }

    const opener = fenceLine(line.text);
    if (opener) {
      flushParagraph();
      const block = fencedBlock(lines, index, opener, source, diagnostics, referenceSpan);
      const parent = sections.at(-1)?.entity ?? null;
      const entity = createEntity({
        path,
        kind: "code-block",
        name: block.language ? `${block.language} code block` : "code block",
        span: referenceSpan(line.start, block.end),
        ruleId: "document.fenced-code-block",
        parentId: parent?.id ?? null,
        properties: {
          fence: opener.marker.repeat(opener.length),
          language: block.language,
        },
      });
      entities.push(entity);
      attachAst(astNode(entity, { children: [], language: block.language }));
      index = block.nextIndex;
      continue;
    }

    if (!line.text.trim()) {
      flushParagraph();
    } else if (paragraph) {
      paragraph.end = line.end;
    } else {
      paragraph = { start: line.start, end: line.end };
    }
    index += 1;
  }
  flushParagraph();

  if (!source.trim()) {
    diagnostics.push(diagnostic({
      code: "document_empty",
      message: "Document contains no non-whitespace text.",
      severity: "info",
    }));
  }

  return createIr({
    path,
    source,
    parser: parserIdentity(`builtin.document.${format}`, VERSION, {
      format,
      headingChars: MAX_HEADING_CHARS,
      lineLimit: MAX_DOCUMENT_LINES,
      paragraphChars: MAX_PARAGRAPH_CHARS,
      referenceLimit: MAX_DOCUMENT_REFERENCES,
    }),
    astChildren,
    entities,
    references: uniqueById(references),
    diagnostics,
  });
}

function formatFor(path) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".mdx")) return "markdown";
  if (lower.endsWith(".rst")) return "restructured-text";
  if (lower.endsWith(".adoc")) return "asciidoc";
  return "text";
}

function sourceLines(source) {
  const lines = [];
  let start = 0;
  while (start < source.length) {
    if (lines.length >= MAX_DOCUMENT_LINES) return { lines, nextOffset: start, truncated: true };
    const newline = source.indexOf("\n", start);
    const rawEnd = newline < 0 ? source.length : newline;
    const end = rawEnd > start && source[rawEnd - 1] === "\r" ? rawEnd - 1 : rawEnd;
    lines.push({ start, end, text: source.slice(start, end) });
    if (newline < 0) break;
    start = newline + 1;
  }
  return { lines, nextOffset: source.length, truncated: false };
}

function markdownFrontmatterEnd(lines, format) {
  if (format !== "markdown" || lines[0]?.text.trim() !== "---") return -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (["---", "..."].includes(lines[index].text.trim())) return index;
  }
  return -1;
}

function headingAt(lines, index, format, rstLevels, frontmatterEnd) {
  const line = lines[index];
  if (!line || index <= frontmatterEnd) return null;

  if (format === "asciidoc") {
    const match = /^(={1,6})[ \t]+(.+?)\s*$/.exec(line.text);
    if (match) return inlineHeading(line, match, match[1].length, "document.asciidoc.heading");
    return null;
  }

  const atx = /^[ \t]{0,3}(#{1,6})(?:[ \t]+|$)(.*)$/.exec(line.text);
  if (atx) {
    const withoutClosing = atx[2].replace(/[ \t]+#+[ \t]*$/, "").trim();
    if (withoutClosing) {
      const titleStart = line.start + line.text.indexOf(atx[2]) + atx[2].indexOf(withoutClosing);
      return {
        consumed: 1,
        start: line.start,
        end: line.end,
        titleStart,
        titleEnd: titleStart + withoutClosing.length,
        level: atx[1].length,
        name: withoutClosing,
        ruleId: "document.markdown.atx-heading",
      };
    }
  }

  const underline = lines[index + 1];
  const title = line.text.trim();
  if (!title || !underline) return null;
  const marker = underlineMarker(underline.text, format);
  if (!marker) return null;
  const level = format === "restructured-text"
    ? rstHeadingLevel(rstLevels, marker)
    : marker === "=" ? 1 : 2;
  const leading = line.text.length - line.text.trimStart().length;
  return {
    consumed: 2,
    start: line.start + leading,
    end: underline.end,
    titleStart: line.start + leading,
    titleEnd: line.start + leading + title.length,
    level,
    name: title,
    ruleId: format === "restructured-text"
      ? "document.restructured-text.underlined-heading"
      : "document.markdown.setext-heading",
  };
}

function inlineHeading(line, match, level, ruleId) {
  const title = match[2].trim();
  const titleAt = line.text.indexOf(match[2]);
  const leading = match[2].length - match[2].trimStart().length;
  const titleStart = line.start + titleAt + leading;
  return {
    consumed: 1,
    start: line.start,
    end: line.end,
    titleStart,
    titleEnd: titleStart + title.length,
    level,
    name: title,
    ruleId,
  };
}

function underlineMarker(text, format) {
  const match = /^[ \t]*([=\-~^"'*+#:._`])\1{2,}[ \t]*$/.exec(text);
  if (!match) return null;
  if (format !== "restructured-text" && !["=", "-"].includes(match[1])) return null;
  return match[1];
}

function rstHeadingLevel(levels, marker) {
  if (!levels.has(marker)) levels.set(marker, Math.min(levels.size + 1, 6));
  return levels.get(marker);
}

function fenceLine(text) {
  let cursor = 0;
  while (text[cursor] === " " && cursor < 4) cursor += 1;
  if (cursor > 3) return null;
  const marker = text[cursor];
  if (marker !== "`" && marker !== "~") return null;
  let end = cursor;
  while (text[end] === marker) end += 1;
  const length = end - cursor;
  if (length < 3) return null;
  return { marker, length, rest: text.slice(end) };
}

function fencedBlock(lines, openIndex, opener, source, diagnostics, locateSpan) {
  const openLine = lines[openIndex];
  const info = opener.rest.trim();
  if (opener.marker === "`" && info.includes("`")) {
    diagnostics.push(fenceDiagnostic(
      "document_fence_malformed",
      "Backtick fence metadata cannot contain a backtick.",
      locateSpan,
      openLine,
    ));
  }

  for (let index = openIndex + 1; index < lines.length; index += 1) {
    const candidate = fenceLine(lines[index].text);
    if (!candidate) continue;
    if (candidate.marker === opener.marker
      && candidate.length >= opener.length
      && !candidate.rest.trim()) {
      return {
        end: lines[index].end,
        language: fenceLanguage(info),
        nextIndex: index + 1,
      };
    }
    diagnostics.push(fenceDiagnostic(
      "document_fence_malformed",
      "Fence-like delimiter does not close the active code block.",
      locateSpan,
      lines[index],
    ));
  }

  diagnostics.push(fenceDiagnostic(
    "document_fence_unclosed",
    "Fenced code block is not closed.",
    locateSpan,
    openLine,
  ));
  return {
    end: source.length,
    language: fenceLanguage(info),
    nextIndex: lines.length,
  };
}

function fenceLanguage(info) {
  if (!info) return "";
  const first = info.split(/\s+/u)[0];
  const attribute = /^\{\.([A-Za-z0-9_+-]+)(?:[}\s]|$)/.exec(first);
  return boundedNormalizedText(attribute?.[1] ?? first, 64);
}

function fenceDiagnostic(code, message, locateSpan, line) {
  return diagnostic({
    code,
    message,
    severity: "warning",
    span: locateSpan(line.start, line.end),
  });
}

function paragraphChunks(source, start, end) {
  const words = [...source.slice(start, end).matchAll(/\S+/gu)].map((match) => ({
    start: start + match.index,
    end: start + match.index + match[0].length,
    text: match[0],
  }));
  const chunks = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    chunks.push({
      start: current.start,
      end: current.end,
      text: source.slice(current.start, current.end),
    });
    current = null;
  };

  for (const word of words) {
    if (word.text.length > MAX_PARAGRAPH_CHARS) {
      flush();
      for (let offset = 0; offset < word.text.length; offset += MAX_PARAGRAPH_CHARS) {
        const text = word.text.slice(offset, offset + MAX_PARAGRAPH_CHARS);
        chunks.push({
          start: word.start + offset,
          end: word.start + offset + text.length,
          text,
        });
      }
      continue;
    }
    const nextLength = current ? current.normalizedLength + 1 + word.text.length : word.text.length;
    if (current && nextLength > MAX_PARAGRAPH_CHARS) flush();
    if (!current) {
      current = {
        start: word.start,
        end: word.end,
        normalizedLength: word.text.length,
      };
    } else {
      current.end = word.end;
      current.normalizedLength += 1 + word.text.length;
    }
  }
  flush();
  return chunks;
}

function boundedNormalizedText(value, limit) {
  return String(value).normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, limit);
}
function emitReferences({
  path, source, start, end, references, diagnostics,
  referenceSpan, referenceState, sourceIdForOffset,
}) {
  if (end <= start || referenceState.truncated) return;
  const text = source.slice(start, end);
  const excluded = inlineCodeRanges(text).map(([left, right]) => [start + left, start + right]);
  const linkRanges = [];
  const overlapsExcluded = orderedOverlapTester(excluded);
  const links = /!?\[[^\]\n]*\]\(\s*(?:<(?<angle>[^>\n]+)>|(?<plain>[^\s)"']+))(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\)/gd;
  for (const match of text.matchAll(links)) {
    const wholeRange = [start + match.indices[0][0], start + match.indices[0][1]];
    if (overlapsExcluded(...wholeRange)) continue;
    linkRanges.push(wholeRange);
    if (match[0].startsWith("!")) continue;
    const range = match.indices.groups.angle ?? match.indices.groups.plain;
    const targetStart = start + range[0];
    const targetEnd = start + range[1];
    if (!emitReference({
      path,
      target: source.slice(targetStart, targetEnd),
      targetStart,
      targetEnd,
      syntax: "markdown-link",
      ruleId: "document.markdown.inline-link",
      references,
      diagnostics,
      referenceSpan,
      referenceState,
      sourceId: sourceIdForOffset(targetStart),
    })) return;
  }
  let claimed = mergeSortedIntervals(excluded, linkRanges);
  const autolinkRanges = [];
  const overlapsClaimed = orderedOverlapTester(claimed);
  const autolinks = new RegExp(
    String.raw`<([A-Za-z][A-Za-z0-9+.-]*:[^<>\s]+|${EMAIL_TARGET}|(?:\.{1,2}\/|[A-Za-z0-9_.-]+\/)?[A-Za-z0-9_.-]+\.${DOCUMENT_TARGET}(?:#[A-Za-z0-9_.:-]+)?)>`,
    "gd",
  );
  for (const match of text.matchAll(autolinks)) {
    const wholeStart = start + match.indices[0][0];
    const wholeEnd = start + match.indices[0][1];
    if (overlapsClaimed(wholeStart, wholeEnd)) continue;
    autolinkRanges.push([wholeStart, wholeEnd]);
    const targetStart = start + match.indices[1][0];
    const targetEnd = start + match.indices[1][1];
    if (!emitReference({
      path,
      target: match[1],
      targetStart,
      targetEnd,
      syntax: "autolink",
      ruleId: "document.markdown.autolink",
      references,
      diagnostics,
      referenceSpan,
      referenceState,
      sourceId: sourceIdForOffset(targetStart),
    })) return;
  }
  claimed = mergeSortedIntervals(claimed, autolinkRanges);
  const overlapsKnownSyntax = orderedOverlapTester(claimed);
  const relativePaths = new RegExp(
    String.raw`(?:^|[\s("'` + "`" + String.raw`])((?:(?:\.{1,2}|[A-Za-z0-9_.-]+)\/)*[A-Za-z0-9_.-]+\.${DOCUMENT_TARGET}(?:#[A-Za-z0-9_.:-]+)?)(?=$|[\s),.;:'"` + "`" + String.raw`])`,
    "gdu",
  );
  for (const match of text.matchAll(relativePaths)) {
    const targetStart = start + match.indices[1][0];
    const targetEnd = start + match.indices[1][1];
    if (overlapsKnownSyntax(targetStart, targetEnd)) continue;
    if (!emitReference({
      path,
      target: match[1],
      targetStart,
      targetEnd,
      syntax: "relative-path",
      ruleId: "document.relative-document-target",
      references,
      diagnostics,
      referenceSpan,
      referenceState,
      sourceId: sourceIdForOffset(targetStart),
    })) return;
  }
}
function inlineCodeRanges(text) {
  const ranges = [];
  const pattern = /(`+)([^`\n]*?)\1/gd;
  for (const match of text.matchAll(pattern)) ranges.push(match.indices[0]);
  return ranges;
}
function emitReference({
  path, target, targetStart, targetEnd, syntax, ruleId,
  references, diagnostics, referenceSpan, referenceState, sourceId,
}) {
  if (references.length >= MAX_DOCUMENT_REFERENCES) {
    diagnostics.push(diagnostic({
      code: "document_references_truncated",
      message: `Document references exceed the ${MAX_DOCUMENT_REFERENCES} reference limit.`,
      severity: "warning",
      span: referenceSpan(targetStart, targetEnd),
      detail: { limit: MAX_DOCUMENT_REFERENCES, partial: true },
    }));
    referenceState.truncated = true;
    return false;
  }
  references.push(createReference({
    path,
    relation: "links-to",
    targetKind: /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)
      || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target) ? "url" : "document",
    target,
    span: referenceSpan(targetStart, targetEnd),
    ruleId,
    sourceId,
    certainty: "observed",
    properties: { syntax },
  }));
  return true;
}
function orderedOverlapTester(ranges) {
  let cursor = 0;
  return (start, end) => {
    while (cursor < ranges.length && ranges[cursor][1] <= start) cursor += 1;
    return cursor < ranges.length && ranges[cursor][0] < end;
  };
}
function mergeSortedIntervals(left, right) {
  const merged = [];
  let leftIndex = 0; let rightIndex = 0;
  while (leftIndex < left.length || rightIndex < right.length) {
    const takeLeft = rightIndex >= right.length
      || (leftIndex < left.length && left[leftIndex][0] <= right[rightIndex][0]);
    const interval = takeLeft ? left[leftIndex++] : right[rightIndex++];
    const previous = merged.at(-1);
    if (previous && interval[0] <= previous[1]) previous[1] = Math.max(previous[1], interval[1]);
    else merged.push([...interval]);
  }
  return merged;
}
function astNode(entity, extra) {
  return {
    type: entity.kind,
    id: entity.id,
    name: entity.name,
    span: entity.span,
    ruleId: entity.ruleId,
    parentId: entity.parentId,
    ...extra,
  };
}

function uniqueById(values) {
  const seen = new Set();
  return values.filter((value) => {
    if (seen.has(value.id)) return false;
    seen.add(value.id);
    return true;
  });
}
