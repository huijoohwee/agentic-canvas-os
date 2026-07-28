import { frontmatterValue, missingFrontmatterKeys, scanFrontmatter } from "./frontmatter.mjs";
import { makeFinding } from "./finding.mjs";
import { createGuidelineModel, NORMATIVE_ELEMENT_CLASSES, NORMATIVE_ELEMENT_KINDS } from "./guideline-model.mjs";
import { consumeContinuation, continuationParagraph, markConsumed, splitDirectiveCandidate } from "./guideline-lines.mjs";
import { contentDigest, documentKeyFrom, elementIdFrom, headingAnchor, normalizeContent, slugify } from "./normalize.mjs";
const MODAL = /\b(?:must|must not|shall|shall not|required|require(?:s|d)?|never|do not|ensure|forbid(?:s|den)?|prohibit(?:s|ed)?)\b/iu;
const IMPERATIVE = /^(?:assign|derive|emit|every|express|group|limit|pair|record|set|state)\b/iu;
const ARTIFACT_REQUIRED = /\b(?:documents?|records?|tables?|diagrams?|schemas?|contracts?|artifacts?|files?|reports?|checks?|tests?|commands?|proofs?|evidence|metrics?|values?|fields?|statuses?|references?|matrices|entries|ids?|findings?|verdicts?|tasks?|vccs?|mechanisms?|dependencies|graphs?|outputs?|results?|budgets?|bounds?|changes?|grants?|scopes?|decisions?|approvals?|gates?|states?|transitions?|reasons?|returns?|dispatches?|runs?|writes?|transmissions?|credentials?|endpoints?|anchors?|propert(?:y|ies))\b/iu;
const ADVISORY = /\b(?:prefer|ideally|recommend|consider|guidance|framing|may|should)\b/iu;
export function parseGuidelineSet(docs, requiredKeys = []) {
  const prepared = prepareDocuments(docs, requiredKeys);
  const documents = new Map();
  const elements = [];
  const gates = [];
  const findings = [];
  for (const document of prepared) {
    if (document.readState !== "ok") continue;
    const documentKey = document.documentKey;
    for (const key of document.missingKeys) {
      findings.push(makeFinding({
        findingType: "missing-frontmatter-key",
        guidelineAnchor: `frontmatter:${key}`,
        artifactReference: documentKey,
        evidenceExcerpt: `Missing required frontmatter key: ${key}`,
        remediation: { class: "documentation-change",
          statement: `Declare the required frontmatter key ${key} in ${documentKey}.` },
      }));
    }
    const sections = splitSections(document.body);
    for (const section of sections) {
      section.gates = extractGateDeclarations(section);
      for (const gate of section.gates) {
        gates.push({ ...gate, documentKey, sectionAnchor: section.anchor, order: gates.length });
      }
    }
    const extracted = extractElements(document, sections);
    const sectionAnchors = sections
      .filter((section) => section.heading !== null)
      .map((section) => section.anchor);
    if (extracted.some((element) => element.sectionAnchor === "frontmatter"))
      sectionAnchors.unshift("frontmatter");
    if (extracted.some((element) => element.sectionAnchor === "preamble"))
      sectionAnchors.unshift("preamble");
    documents.set(documentKey, {
      documentKey,
      frontmatterKeys: [...document.frontmatter.keys()],
      sectionAnchors,
      universalScope: declaresUniversalScope(document),
    });
    elements.push(...extracted);
  }
  return { value: createGuidelineModel(documents, elements, gates),
    findings: findings.sort(findingOrder) };
}
export function parseGuidelineDigest(digest) {
  const scanned = scanFrontmatter(digest);
  if (scanned.readState !== "ok")
    return { value: createGuidelineModel(), findings: [], errors: [scanned.error] };
  if (frontmatterValue(scanned.frontmatter, "digest_schema") !== "guideline-digest/v1") {
    return { value: createGuidelineModel(), findings: [],
      errors: ["unsupported or missing digest_schema"] };
  }
  try {
    const parsed = parseDigestBody(scanned.body);
    return { value: createGuidelineModel(parsed.documents, parsed.elements, parsed.gates),
      findings: [] };
  } catch (error) {
    return { value: createGuidelineModel(), findings: [],
      errors: [error instanceof Error ? error.message : String(error)] };
  }
}
export function classifyNormativeElement(text) {
  const value = String(text ?? "");
  if (ARTIFACT_REQUIRED.test(value) && (MODAL.test(value) || !ADVISORY.test(value))) {
    return "artifact-bearing";
  }
  return "advisory";
}

function prepareDocuments(docs, requiredKeys) {
  const candidates = [...(docs ?? [])].map((doc, index) => prepareDocument(doc, index, requiredKeys));
  const occupied = new Set();
  for (const candidate of [...candidates].sort((left, right) =>
    `${left.requestedKey}\0${left.digest}`.localeCompare(
      `${right.requestedKey}\0${right.digest}`, "en"))) {
    let key = candidate.requestedKey;
    if (occupied.has(key))
      key = documentKeyFrom(candidate.frontmatter ?? {}, candidate.body, occupied);
    candidate.documentKey = key;
    occupied.add(key);
  }
  return candidates.sort((left, right) => left.documentKey.localeCompare(right.documentKey, "en"));
}

function prepareDocument(doc, index, requiredKeys) {
  const source = typeof doc === "string" ? { text: doc } : { ...(doc ?? {}) };
  const suppliedState = source.readState;
  const rawText = source.text ?? source.content;
  let frontmatter = source.frontmatter instanceof Map
    ? new Map(source.frontmatter)
    : source.frontmatter && typeof source.frontmatter === "object"
      ? new Map(Object.entries(source.frontmatter))
      : null;
  let body = typeof source.body === "string" ? normalizeContent(source.body) : "";
  let readState = suppliedState ?? "ok";
  let missingKeys = [];

  if (typeof rawText === "string" && frontmatter === null) {
    const scanned = scanFrontmatter(rawText, requiredKeys);
    frontmatter = scanned.frontmatter;
    body = scanned.body;
    readState = suppliedState ?? scanned.readState;
    missingKeys = scanned.missingKeys;
  } else if (frontmatter !== null) {
    missingKeys = missingFrontmatterKeys(frontmatter, requiredKeys);
  } else {
    readState = suppliedState ?? "malformed";
  }

  const digest = contentDigest(typeof rawText === "string" ? rawText : body);
  const requestedKey = source.documentKey
    ? String(source.documentKey)
    : documentKeyFrom(frontmatter ?? {}, body || digest);
  return { index, inputRole: String(source.inputRole ?? "guideline"), requestedKey,
    documentKey: requestedKey, frontmatter, body, readState, missingKeys, digest };
}

function splitSections(body) {
  const lines = normalizeContent(body).split("\n");
  const sections = [{ heading: null, anchor: "preamble", lines: [], sectionIndex: -1 }];
  const anchorCounts = new Map();
  let fence = null;
  for (const [lineIndex, line] of lines.entries()) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (fence) {
      sections.at(-1).lines.push({ text: "", lineIndex });
      if (marker && marker[1][0] === fence.character &&
          marker[1].length >= fence.length && marker[2].trim() === "") fence = null;
      continue;
    }
    if (marker) {
      fence = { character: marker[1][0], length: marker[1].length };
      sections.at(-1).lines.push({ text: "", lineIndex });
      continue;
    }
    const match = /^##(?!#)\s+(.+?)\s*$/u.exec(line);
    if (!match) {
      sections.at(-1).lines.push({ text: line, lineIndex });
      continue;
    }
    const explicit = /\s+\{#([^}]+)\}\s*$/u.exec(match[1]);
    const heading = match[1].replace(/\s+\{#[^}]+\}\s*$/u, "").trim();
    const baseAnchor = explicit?.[1] ?? headingAnchor(heading, "section");
    const count = anchorCounts.get(baseAnchor) ?? 0;
    anchorCounts.set(baseAnchor, count + 1);
    sections.push({
      heading,
      anchor: count === 0 ? baseAnchor : `${baseAnchor}-${count}`,
      lines: [],
      sectionIndex: sections.length - 1,
    });
  }
  return sections;
}

function extractElements(document, sections) {
  const extracted = [];
  const frontmatterDirective = frontmatterValue(
    document.frontmatter,
    "directive",
    "directives",
  );
  if (frontmatterDirective) {
    for (const [ordinal, text] of splitDeclaredList(frontmatterDirective).entries()) {
      const normalizedText = stripInlineMarkup(String(text).trim());
      extracted.push({
        elementId: elementIdFrom("frontmatter", normalizedText), documentKey: document.documentKey,
        sectionAnchor: "frontmatter", kind: "directive",
        class: classifyNormativeElement(normalizedText), gateId: null, ordinal, text: normalizedText,
      });
    }
  }

  for (const section of sections) {
    let context = section.heading ?? "";
    const sectionGates = section.gates ?? [];
    let gateId = sectionGates.length === 1 ? sectionGates[0].gateId : gateIdFrom(context);
    const used = new Set();
    const candidates = [];
    for (const gate of sectionGates) {
      for (const condition of gate.conditions) {
        candidates.push(
          candidate(
            section.anchor,
            "phase-gate-condition",
            gate.gateId,
            condition.position,
            `${condition.label}: ${condition.value}`,
          ),
        );
        markConsumed(used, condition.position, condition.endPosition);
      }
    }
    for (let index = 0; index < section.lines.length; index += 1) {
      if (used.has(index)) continue;
      const line = section.lines[index].text;
      const subheading = /^#{3,6}\s+(.+?)\s*$/u.exec(line);
      if (subheading) { context = subheading[1]; gateId = gateIdFrom(context) ?? gateId; continue; }
      const declaredGate = /^\s*(?:[-*+]\s+)?gate[ _-]?id\s*:\s*(.+?)\s*$/iu.exec(line);
      if (declaredGate) {
        gateId = slugify(stripInlineMarkup(declaredGate[1]), "gate");
        continue;
      }

      const prohibited = /^\s*(?:[-*+]\s+)?(?:\*\*)?(?:prohibited|anti-pattern|avoid)(?:\*\*)?\s*:\s*(.+?)\s*$/iu.exec(line);
      if (prohibited) {
        const next = section.lines[index + 1]?.text ?? "";
        const corrected = /^\s*(?:[-*+]\s+)?(?:\*\*)?(?:corrected|correction|preferred|replacement)(?:\*\*)?\s*:\s*(.+?)\s*$/iu.exec(next);
        if (corrected) {
          const text = `Prohibited: ${stripInlineMarkup(prohibited[1])}\nCorrected: ${stripInlineMarkup(corrected[1])}`;
          candidates.push(candidate(section.anchor, "anti-pattern-guard", gateId, index, text));
          used.add(index);
          used.add(index + 1);
          continue;
        }
      }
      const antiPattern = /^\s*[-*+]\s+anti-pattern\s*:\s*(.+?)\s*$/iu.exec(line);
      if (antiPattern) {
        const paragraph = continuationParagraph(section.lines, index, antiPattern[1]);
        candidates.push(
          candidate(
            section.anchor,
            "anti-pattern-guard",
            gateId,
            index,
            `Anti-pattern: ${paragraph.value}`,
          ),
        );
        markConsumed(used, index, paragraph.endPosition);
      }
    }

    context = section.heading ?? "";
    gateId = sectionGates.length === 1 ? sectionGates[0].gateId : gateIdFrom(context);
    for (let index = 0; index < section.lines.length; index += 1) {
      if (used.has(index)) continue;
      const line = section.lines[index].text;
      const subheading = /^#{3,6}\s+(.+?)\s*$/u.exec(line);
      if (subheading) { context = subheading[1]; gateId = gateIdFrom(context) ?? gateId; continue; }
      const labelledContext = /^\s*\*\*(directives?|guidance)\*\*\s*:\s*$/iu.exec(line);
      if (labelledContext) { context = labelledContext[1]; continue; }
      const declaredGate = /^\s*(?:[-*+]\s+)?gate[ _-]?id\s*:\s*(.+?)\s*$/iu.exec(line);
      if (declaredGate) {
        gateId = slugify(stripInlineMarkup(declaredGate[1]), "gate");
        continue;
      }

      const checklist = /^\s*[-*+]\s+\[[ xX]\]\s+(.+?)\s*$/u.exec(line);
      if (checklist) {
        candidates.push(
          candidate(section.anchor, "checklist-item", gateId, index,
            consumeContinuation(section.lines, used, index, checklist[1])),
        );
        continue;
      }
      const numbered = /^\s*\d+[.)]\s+(.+?)\s*$/u.exec(line);
      if (numbered && isPhaseContext(context, section.heading)) {
        candidates.push(
          candidate(section.anchor, "phase-gate-condition", gateId, index,
            consumeContinuation(section.lines, used, index, numbered[1])),
        );
        continue;
      }
      const gateStatement = /^\s*(?:[-*+]\s+)?(?:gate|entry condition|exit condition|required evidence(?: type)?)\s*:\s*(.+?)\s*$/iu.exec(line);
      if (gateStatement && isPhaseContext(context, section.heading)) {
        candidates.push(
          candidate(
            section.anchor,
            "phase-gate-condition",
            gateId,
            index,
            consumeContinuation(section.lines, used, index, gateStatement[1]),
          ),
        );
        continue;
      }
      const template = templateField(line);
      if (
        template &&
        (/template/iu.test(context) || /^\s*[-*+]\s+required field\s*:/iu.test(line))
      ) {
        candidates.push(
          candidate(section.anchor, "required-template-field", gateId, index, template),
        );
        continue;
      }
      const listItem = /^\s*[-*+]\s+(.+?)\s*$/u.exec(line);
      const labelledDirective = /^\s*[-*+]\s+directive\s*:\s*(.+?)\s*$/iu.exec(line);
      if (labelledDirective) {
        candidates.push(
          candidate(section.anchor, "directive", gateId, index,
            consumeContinuation(section.lines, used, index, labelledDirective[1])),
        );
        continue;
      }
      if (listItem && (
        /directive|guidance|rule|safeguard/iu.test(context) ||
        IMPERATIVE.test(listItem[1])
      )) {
        const item = candidate(section.anchor, "directive", gateId, index,
          consumeContinuation(section.lines, used, index, listItem[1]));
        if (/guidance/iu.test(context)) item.class = "advisory";
        candidates.push(item);
        continue;
      }
      if (MODAL.test(line) && !/^\s*(?:<!--|>|\|)/u.test(line)) {
        candidates.push(candidate(section.anchor, "directive", gateId, index,
          consumeContinuation(section.lines, used, index, listItem?.[1] ?? line.trim())));
      }
    }

    candidates.flatMap(splitDirectiveCandidate)
      .sort((left, right) => left.position - right.position || left.kind.localeCompare(right.kind))
      .forEach((item, ordinal) => {
        extracted.push({
          elementId: elementIdFrom(item.sectionAnchor, item.text),
          documentKey: document.documentKey,
          sectionAnchor: item.sectionAnchor,
          kind: item.kind,
          class: item.class ?? classifyNormativeElement(item.text),
          gateId: item.gateId,
          ordinal,
          text: item.text,
        });
      });
  }
  return extracted;
}

function candidate(sectionAnchor, kind, gateId, position, text) {
  return {
    sectionAnchor,
    kind,
    gateId,
    position,
    text: stripInlineMarkup(String(text).trim()),
  };
}

function templateField(line) {
  const bullet = /^\s*[-*+]\s+(?:\*\*)?([A-Za-z][\w -]*?)(?:\*\*)?\s*:\s*(.*?)\s*$/u.exec(line);
  if (bullet) return `${bullet[1].trim()}: ${bullet[2].trim() || "(empty)"}`;
  const plain = /^\s*([A-Za-z][\w -]*?)\s*:\s*(.*?)\s*$/u.exec(line);
  if (plain) return `${plain[1].trim()}: ${plain[2].trim() || "(empty)"}`;
  const table = /^\|\s*([^|]+?)\s*\|\s*(?:required|yes|true)\s*\|/iu.exec(line);
  return table && !/^field$/iu.test(table[1].trim())
    ? `${table[1].trim()}: required`
    : null;
}

function gateIdFrom(value) {
  const text = String(value ?? "").trim();
  if (/^phase\b/iu.test(text)) return headingAnchor(text, "gate");
  const match = /\bgate\s*(?:id)?\s*[:—-]\s*(.+)$/iu.exec(text);
  return match ? slugify(match[1], "gate") : null;
}

function extractGateDeclarations(section) {
  if (!section.heading) return [];
  const declarations = [];
  let context = section.heading;
  for (let index = 0; index < section.lines.length; index += 1) {
    const subheading = /^#{3,6}\s+(.+?)\s*$/u.exec(section.lines[index].text);
    if (subheading) { context = subheading[1]; continue; }
    const gateMatch = gateField(section.lines[index].text);
    if (!gateMatch || gateMatch.label !== "gate") continue;
    const gateValue = gateParagraph(section.lines, index, gateMatch.value);
    const fields = new Map();
    const conditions = [{
      label: gateMatch.rawLabel, value: gateValue.value,
      position: index, endPosition: gateValue.endPosition }];
    let cursor = gateValue.endPosition + 1;
    while (cursor < section.lines.length) {
      if (/^#{3,6}\s/u.test(section.lines[cursor].text)) break;
      const field = gateField(section.lines[cursor].text);
      if (field?.label === "gate") break;
      if (!field) { cursor += 1; continue; }
      const paragraph = gateParagraph(section.lines, cursor, field.value);
      fields.set(field.label, paragraph.value);
      conditions.push({
        label: field.rawLabel, value: paragraph.value,
        position: cursor, endPosition: paragraph.endPosition });
      cursor = paragraph.endPosition + 1;
    }
    const declaredId = fields.size > 0 || /^`?[A-Za-z0-9][A-Za-z0-9._-]*`?$/u.test(gateValue.value);
    declarations.push({
      gateId: declaredId ? slugify(stripInlineMarkup(gateValue.value), "gate")
        : gateIdFrom(context) ?? headingAnchor(context, "gate"),
      entryCondition: fields.get("entry condition") ?? "",
      exitCondition: fields.get("exit condition") ?? (declaredId ? "" : gateValue.value),
      requiredEvidenceType: fields.get("required evidence") ?? "",
      conditions });
    index = cursor - 1;
  }
  return declarations;
}

function gateField(line) {
  const match = /^\s*(?:[-*+]\s+)?(?:\*\*)?(gate|entry condition|exit condition|required evidence(?: type)?)(?:\*\*)?\s*:\s*(.*?)\s*$/iu.exec(line);
  if (!match) return null;
  return {
    rawLabel: match[1],
    label: match[1].toLocaleLowerCase("en-US")
      .replace("required evidence type", "required evidence"),
    value: match[2] };
}

function gateParagraph(lines, startIndex, initial) {
  const parts = [String(initial).trim()].filter(Boolean);
  let endPosition = startIndex;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index].text;
    if (line.trim() === "" || /^#{2,6}\s/u.test(line) ||
        /^\s*[-*+]\s/u.test(line) || gateField(line)) break;
    parts.push(line.trim());
    endPosition = index;
  }
  return { value: parts.join(" ").trim(), endPosition };
}

function isPhaseContext(context, sectionHeading) {
  return /phase|gate/iu.test(`${sectionHeading ?? ""} ${context ?? ""}`);
}

function stripInlineMarkup(value) {
  const text = String(value).trim();
  if (/^`[\s\S]*`$/u.test(text) || /^\*\*[\s\S]*\*\*$/u.test(text)) {
    return text.slice(text.startsWith("**") ? 2 : 1, text.endsWith("**") ? -2 : -1).trim();
  }
  return text;
}

function splitDeclaredList(value) {
  const text = String(value).trim().replace(/^\[|\]$/gu, "");
  return text
    .split(/\s*;\s*|\s*,\s*(?=[A-Za-z])/u)
    .map(stripInlineMarkup)
    .filter(Boolean);
}

function declaresUniversalScope(document) {
  const declared = frontmatterValue(
    document.frontmatter,
    "universal_scope",
    "universalScope",
    "scope",
  );
  if (declared !== undefined) return /^(?:true|universal|all)$/iu.test(String(declared).trim());
  return /appl(?:y|ies) to any (?:product|domain|language|runtime)|universal scope/iu.test(
    document.body,
  );
}

function parseDigestBody(body) {
  const lines = normalizeContent(body).split("\n");
  const documents = new Map();
  const elements = [];
  const gates = [];
  let index = 0;
  let documentKey = null;
  let sectionAnchor = null;

  while (index < lines.length) {
    const line = lines[index];
    const documentMatch = /^## Document: (.+)$/u.exec(line);
    if (documentMatch) {
      documentKey = documentMatch[1];
      const fields = readFieldTable(lines, index + 1);
      documents.set(documentKey, {
        documentKey,
        universalScope: fields.values.universal_scope === "true",
        frontmatterKeys: parseTokenList(fields.values.frontmatter_keys),
        sectionAnchors: parseTokenList(fields.values.section_anchors),
      });
      index = fields.nextIndex;
      continue;
    }
    const sectionMatch = /^### Section: (.+)$/u.exec(line);
    if (sectionMatch) {
      sectionAnchor = sectionMatch[1];
      index += 1;
      continue;
    }
    const gateMatch = /^### Gate Declaration: (.+)$/u.exec(line);
    if (gateMatch) {
      if (!documentKey) throw new Error("gate declaration outside document");
      const fields = readFieldTable(lines, index + 1);
      let cursor = nextNonEmpty(lines, fields.nextIndex);
      const entry = readNamedFence(lines, cursor, "gate-entry-condition");
      cursor = nextNonEmpty(lines, entry.nextIndex);
      const exit = readNamedFence(lines, cursor, "gate-exit-condition");
      cursor = nextNonEmpty(lines, exit.nextIndex);
      const evidence = readNamedFence(lines, cursor, "gate-required-evidence");
      gates.push({
        gateId: gateMatch[1],
        documentKey,
        sectionAnchor: unquoteToken(fields.values.section_anchor),
        order: Number.parseInt(fields.values.order, 10),
        entryCondition: entry.value,
        exitCondition: exit.value,
        requiredEvidenceType: evidence.value,
      });
      index = evidence.nextIndex;
      continue;
    }
    const elementMatch = /^#### Element: (.+)$/u.exec(line);
    if (elementMatch) {
      if (!documentKey || !sectionAnchor) throw new Error("element outside document section");
      const fields = readFieldTable(lines, index + 1);
      const fenceIndex = nextNonEmpty(lines, fields.nextIndex);
      const fenceMatch = /^(~{3,})element$/u.exec(lines[fenceIndex] ?? "");
      if (!fenceMatch) throw new Error(`missing element fence for ${elementMatch[1]}`);
      let closeIndex = fenceIndex + 1;
      while (closeIndex < lines.length && lines[closeIndex] !== fenceMatch[1]) closeIndex += 1;
      if (closeIndex >= lines.length) throw new Error(`unterminated element fence for ${elementMatch[1]}`);
      const kind = unquoteToken(fields.values.kind);
      const elementClass = unquoteToken(fields.values.class);
      if (!NORMATIVE_ELEMENT_KINDS.includes(kind)) throw new Error(`invalid element kind ${kind}`);
      if (!NORMATIVE_ELEMENT_CLASSES.includes(elementClass)) throw new Error(`invalid element class ${elementClass}`);
      elements.push({
        elementId: elementMatch[1],
        documentKey,
        sectionAnchor,
        kind,
        class: elementClass,
        gateId: fields.values.gate === "(none)" ? null : unquoteToken(fields.values.gate),
        ordinal: Number.parseInt(fields.values.ordinal, 10),
        text: lines.slice(fenceIndex + 1, closeIndex).join("\n"),
      });
      index = closeIndex + 1;
      continue;
    }
    index += 1;
  }
  return { documents, elements, gates };
}

function readFieldTable(lines, startIndex) {
  let index = nextNonEmpty(lines, startIndex);
  if (lines[index] !== "| field | value |" || !/^\|[-:| ]+\|$/u.test(lines[index + 1] ?? "")) {
    throw new Error(`expected field table at line ${index + 1}`);
  }
  index += 2;
  const values = {};
  while (index < lines.length) {
    const match = /^\|\s*([^|]+?)\s*\|\s*(.*?)\s*\|$/u.exec(lines[index]);
    if (!match) break;
    values[match[1].trim()] = match[2].trim();
    index += 1;
  }
  return { values, nextIndex: index };
}

function parseTokenList(value) {
  if (value === "(none)" || value === undefined) return [];
  return [...value.matchAll(/`((?:``|[^`])*)`/gu)].map((match) =>
    match[1].replace(/``/gu, "`"),
  );
}

function unquoteToken(value) {
  return /^`[\s\S]*`$/u.test(value ?? "") ? value.slice(1, -1).replace(/``/gu, "`") : value;
}

function nextNonEmpty(lines, start) {
  let index = start;
  while (index < lines.length && lines[index].trim() === "") index += 1;
  return index;
}

function readNamedFence(lines, startIndex, label) {
  const match = new RegExp(`^(~{3,})${label}$`, "u").exec(lines[startIndex] ?? "");
  if (!match) throw new Error(`missing ${label} fence`);
  let closeIndex = startIndex + 1;
  while (closeIndex < lines.length && lines[closeIndex] !== match[1]) closeIndex += 1;
  if (closeIndex >= lines.length) throw new Error(`unterminated ${label} fence`);
  return {
    value: lines.slice(startIndex + 1, closeIndex).join("\n"),
    nextIndex: closeIndex + 1,
  };
}

function findingOrder(left, right) {
  return (
    left.artifactReference.localeCompare(right.artifactReference, "en") ||
    left.evidenceExcerpt.localeCompare(right.evidenceExcerpt, "en")
  );
}
