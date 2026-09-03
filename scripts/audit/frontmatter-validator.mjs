// Responsibility: Validate the authored portability document contract without mutating source bytes.

import { scanFrontmatter } from "../alignment-audit/frontmatter.mjs";
import { normalizeRepositoryPath } from "./path-portability-auditor.mjs";

export const FRONTMATTER_VALIDATION_SCHEMA =
  "agentic-game-os-frontmatter-validation/v1";
export const AUTHORED_DOCUMENT_PATH =
  "huijoohwee.github.io/docs/documents/agentic-game-os-apple-vision-os-prd-tad-adr.md";
export const AUTHORED_DOCUMENT_FIELDS = Object.freeze([
  "title",
  "doc_type",
  "version",
  "date",
  "lang",
  "frontmatter_contract",
  "owner",
  "local_rung",
  "delivered_rung",
  "lane",
  "universal_scope",
]);
export const READINESS_RANKS = Object.freeze({
  undocumented: 1,
  "spec-complete": 2,
  "runtime-ready": 3,
});
export const GLOSSARY_COMPONENTS = Object.freeze([
  "Invocation_SSOT",
  "Invocation_Resolver",
  "Shared_Substrate",
  "Frontend_Surface",
  "Game_Mode",
  "Portability_Layer",
  "Capability_Tier",
  "Capability_Detector",
  "Browser_Runtime",
  "Native_Adapter",
  "Capability_Parity_Matrix",
  "Scene_Manifest",
  "Scene_Manifest_Parser",
  "Scene_Manifest_Printer",
  "Continuity_Store",
  "Pipeline_Controller",
  "Dev_Runtime",
  "Prod_Mirror",
  "Delivery_Surface",
  "Deploy_Gate",
  "Authored_Document",
  "Sibling_Document",
  "Frontmatter_Validator",
  "Duplicate_Logic_Auditor",
  "Path_Portability_Auditor",
  "File_Size_Auditor",
  "Cost_Observer",
]);
export const SIBLING_DOCUMENT_PATHS = Object.freeze([
  "huijoohwee.github.io/docs/documents/agentic-game-os-prd-tad-adr.md",
  "huijoohwee.github.io/docs/documents/sandbox-prd-tad-adr.md",
  "agentic-graph/docs/documents/agentic-graph-ar-vr-xr-prd-tad-adr.md",
]);

const REQUIREMENT_CRITERION_COUNTS = Object.freeze([
  12, 8, 9, 10, 11, 12, 11, 12, 11, 12, 11, 10, 9, 8,
]);
export const ACCEPTANCE_CRITERION_IDS = Object.freeze(
  REQUIREMENT_CRITERION_COUNTS.flatMap((count, requirementIndex) => (
    Array.from({ length: count }, (_, criterionIndex) => (
      `${requirementIndex + 1}.${criterionIndex + 1}`
    ))
  )),
);

const PARTS = Object.freeze([
  ["product-requirements", /\bproduct requirements\b/iu],
  ["technical-architecture", /\btechnical architecture\b/iu],
  ["architectural-decision-record", /\barchitectural decision record\b/iu],
]);
const VERSIONED_STACK_PATTERN =
  /\b(?:iOS|iPadOS|Safari|Swift|visionOS|Xcode)\s+v?\d+(?:\.\d+){0,2}\b/gu;
const NAMED_STACK_PATTERN =
  /\b(?:IndexedDB|Reality Composer Pro|RealityKit|SwiftUI|Three\.js)\b/gu;
const BACKTICK_PATH_PATTERN =
  /`((?:(?:\$GITHUB_ROOT)?\/)?(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+\.[A-Za-z0-9]+)`/gu;
const GITHUB_ROOT_REFERENCE_PATTERN = /\$GITHUB_ROOT(?:\/[A-Za-z0-9._-]+)+/gu;

export function validateAuthoredDocument(input = {}) {
  return validateDocument(normalizeInput(input), { full: true });
}

export function validateFrontmatterContract(input = {}) {
  return validateDocument(normalizeInput(input), { full: false });
}

export const validateFrontmatterDocument = validateAuthoredDocument;

export function validateReadinessRungs({
  localRung,
  deliveredRung,
  componentRungs = [],
  expectedComponents = [],
} = {}) {
  const normalizedInput = normalizeComponentRungs(componentRungs);
  const normalized = normalizedInput.entries;
  const byComponent = new Map();
  const duplicateComponents = [];
  for (const entry of normalized) {
    if (byComponent.has(entry.component)) duplicateComponents.push(entry.component);
    else byComponent.set(entry.component, entry);
  }
  const expected = normalizeExpectedComponents(expectedComponents);
  const missingComponents = expected
    .filter((component) => !byComponent.has(component)).sort(compareText);
  const unexpectedComponents = expected.length === 0 ? [] : normalized
    .map(({ component }) => component)
    .filter((component) => !expected.includes(component))
    .filter((component, index, values) => values.indexOf(component) === index)
    .sort(compareText);
  const invalidComponents = [...normalizedInput.invalid, ...normalized
    .filter(({ rung }) => !READINESS_RANKS[rung])
    .map(({ component, rung }) => ({ component, rung })), ...normalized
    .filter(({ matrixValid }) => matrixValid === false)
    .map(({ component, rung }) => ({ component, rung, reason: "readiness-gap-row" }))];
  const evidenceInvalid = normalized.flatMap((entry) => (
    entry.rung === "runtime-ready" && !completeRuntimeEvidence(entry.evidence)
      ? [{ component: entry.component, rung: entry.rung }]
      : []
  ));
  const localRank = READINESS_RANKS[localRung] ?? null;
  const deliveredRank = READINESS_RANKS[deliveredRung] ?? null;
  const componentRanks = normalized
    .map(({ rung }) => READINESS_RANKS[rung])
    .filter(Boolean);
  const lowestComponentRank = componentRanks.length > 0
    ? Math.min(...componentRanks)
    : null;
  const orderingInvalid = Boolean(
    localRank
    && deliveredRank
    && (deliveredRank > localRank
      || (lowestComponentRank !== null && deliveredRank > lowestComponentRank)),
  );
  const valid = Boolean(
    localRank
    && deliveredRank
    && !orderingInvalid
    && missingComponents.length === 0
    && unexpectedComponents.length === 0
    && duplicateComponents.length === 0
    && invalidComponents.length === 0
    && evidenceInvalid.length === 0,
  );
  return {
    valid,
    localRung,
    localRank,
    deliveredRung,
    deliveredRank,
    lowestComponentRank,
    orderingInvalid,
    missingComponents,
    unexpectedComponents,
    duplicateComponents: [...new Set(duplicateComponents)].sort(compareText),
    invalidComponents,
    evidenceInvalid,
  };
}

function validateDocument(source, { full }) {
  const path = normalizeRepositoryPath(source.path ?? AUTHORED_DOCUMENT_PATH);
  if (source.exists === false || source.text === null || source.text === undefined) {
    return report({
      path: path ?? AUTHORED_DOCUMENT_PATH,
      violations: [{
        code: "document-missing",
        path: path ?? AUTHORED_DOCUMENT_PATH,
      }],
      frontmatter: null,
    });
  }
  if (!path || typeof source.text !== "string") {
    return report({
      path: path ?? "<invalid-repository-path>",
      violations: [{
        code: "document-invalid",
        fields: ["path"],
        missingParts: [],
        duplicateParts: [],
        parseErrors: ["document path or text is invalid"],
      }],
      frontmatter: null,
    });
  }

  const inspected = inspectFrontmatter(source.text);
  const markdown = markdownStructure(source.text);
  const parts = inspectParts(markdown.headings);
  const invalid = {
    code: "document-invalid",
    fields: [
      ...inspected.failingFields,
      ...(full && path !== AUTHORED_DOCUMENT_PATH ? ["path"] : []),
    ].sort(compareText),
    missingParts: parts.missing,
    duplicateParts: parts.duplicates,
    parseErrors: inspected.parseErrors,
    missingRequirementReferences: full
      ? missingRequirementReferences(markdown.bodyText)
      : [],
    missingSiblingReferences: full
      ? missingSiblingReferences(
        markdown.bodyText,
        source.requiredSiblingPaths ?? SIBLING_DOCUMENT_PATHS,
      )
      : [],
  };
  const violations = documentInvalid(invalid) ? [invalid] : [];
  const values = inspected.values;
  const componentRungs = source.componentRungs
    ?? parseReadinessMatrix(markdown);
  const rung = validateReadinessRungs({
    localRung: values.local_rung,
    deliveredRung: values.delivered_rung,
    componentRungs,
    expectedComponents: full
      ? source.expectedComponents ?? GLOSSARY_COMPONENTS
      : source.expectedComponents ?? [],
  });
  if (!rung.valid) violations.push({ code: "rung-combination", ...rung });
  const evidenceInvalid = [...rung.evidenceInvalid];
  const surfacedEvidence = completeRuntimeEvidence(source.deliveredEvidence)
    || hasSurfacedEvidence(componentRungs);
  if (full && !surfacedEvidence && (
    values.local_rung !== "spec-complete"
    || values.delivered_rung !== "undocumented"
  )) evidenceInvalid.push({
    component: "document_readiness",
    localRung: values.local_rung,
    deliveredRung: values.delivered_rung,
  });

  const placements = inspectReferencePlacement(markdown, source.concreteReferences);
  if (placements.length > 0) violations.push({
    code: "placement-violation",
    references: placements,
  });

  if (full) {
    const requiredCriterionIds = source.requiredCriterionIds
      ?? ACCEPTANCE_CRITERION_IDS;
    const covered = checklistCriterionIds(markdown);
    const uncoveredCriterionIds = requiredCriterionIds
      .filter((criterion) => !covered.has(criterion));
    if (uncoveredCriterionIds.length > 0) violations.push({
      code: "coverage-gap",
      uncoveredCriterionIds,
    });
    if (evidenceInvalid.length > 0) violations.push({
      code: "evidence-invalid",
      components: evidenceInvalid,
    });
  }
  return report({ path, violations, frontmatter: inspected.valid ? values : null });
}

function inspectFrontmatter(text) {
  const scanned = scanFrontmatter(text, AUTHORED_DOCUMENT_FIELDS);
  const raw = rawFrontmatter(text);
  const counts = new Map();
  const values = {};
  const parseErrors = scanned.readState === "ok" ? [] : [scanned.error];
  if (raw !== null) {
    for (const [index, line] of raw.split("\n").entries()) {
      if (!line.trim()) continue;
      const match = /^([A-Za-z_][A-Za-z0-9_.-]*):(?:[ \t]*(.*))?$/u.exec(line);
      if (!match) {
        parseErrors.push(`invalid frontmatter line ${index + 1}`);
        continue;
      }
      const [, field, value = ""] = match;
      counts.set(field, (counts.get(field) ?? 0) + 1);
      if (!Object.hasOwn(values, field)) values[field] = unquote(value.trim());
    }
  }
  if (scanned.readState === "ok") {
    for (const [field, value] of scanned.frontmatter) values[field] = String(value);
  }
  const failing = new Set();
  for (const field of AUTHORED_DOCUMENT_FIELDS) {
    if ((counts.get(field) ?? 0) !== 1 || !String(values[field] ?? "").trim()) {
      failing.add(field);
    }
  }
  for (const [field, count] of counts) {
    if (!AUTHORED_DOCUMENT_FIELDS.includes(field) || count !== 1) failing.add(field);
  }
  return {
    valid: failing.size === 0 && parseErrors.length === 0,
    values,
    failingFields: [...failing].sort(compareText),
    parseErrors: [...new Set(parseErrors.filter(Boolean))],
  };
}

function rawFrontmatter(text) {
  const normalized = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  if (!normalized.startsWith("---\n")) return null;
  const closing = normalized.indexOf("\n---\n", 4);
  return closing < 0 ? null : normalized.slice(4, closing);
}

function markdownStructure(text) {
  const normalized = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const lines = normalized.split("\n");
  const closing = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
  const bodyStart = closing >= 0 ? closing + 1 : 0;
  const headings = [];
  const visibleLines = [];
  let fence = null;
  for (let index = bodyStart; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/u.exec(line);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0];
      else if (fence === fenceMatch[1][0]) fence = null;
      continue;
    }
    if (fence) continue;
    visibleLines.push({ line: index + 1, text: line });
    const heading = /^(#{1,6})\s+(.+?)\s*#*$/u.exec(line);
    if (heading) headings.push({
      level: heading[1].length,
      text: heading[2].trim(),
      line: index + 1,
    });
  }
  return {
    lines: visibleLines,
    headings,
    bodyText: visibleLines.map(({ text: line }) => line).join("\n"),
  };
}

function inspectParts(headings) {
  const missing = [];
  const duplicates = [];
  for (const [id, pattern] of PARTS) {
    const count = headings.filter(({ level, text }) => level === 1 && pattern.test(text)).length;
    if (count === 0) missing.push(id);
    if (count > 1) duplicates.push(id);
  }
  return { missing, duplicates };
}

function missingRequirementReferences(body) {
  const observed = new Set([...body.matchAll(/\bRequirement\s+(1[0-4]|[2-9])\b/giu)]
    .map((match) => Number(match[1])));
  return Array.from({ length: 13 }, (_, index) => index + 2)
    .filter((requirement) => !observed.has(requirement));
}

function missingSiblingReferences(body, paths) {
  return paths.filter((path) => (
    !body.includes(path) && !body.includes(`$GITHUB_ROOT/${path}`)
  ));
}

function inspectReferencePlacement(markdown, explicitReferences) {
  const references = [];
  let nearestHeading = null;
  for (const entry of markdown.lines) {
    const heading = markdown.headings.find(({ line }) => line === entry.line);
    if (heading) nearestHeading = heading;
    const literals = explicitReferences
      ? exactReferences(entry.text, explicitReferences)
      : detectedReferences(entry.text);
    for (const literal of literals) {
      if (!nearestHeading || !/reference implementation/iu.test(nearestHeading.text)) {
        references.push({
          literal,
          line: entry.line,
          nearestHeading: nearestHeading?.text ?? null,
        });
      }
    }
  }
  return uniqueReferences(references);
}

function detectedReferences(line) {
  const values = [];
  for (const pattern of [
    VERSIONED_STACK_PATTERN,
    NAMED_STACK_PATTERN,
    GITHUB_ROOT_REFERENCE_PATTERN,
  ]) {
    pattern.lastIndex = 0;
    for (const match of line.matchAll(pattern)) values.push(match[0]);
  }
  BACKTICK_PATH_PATTERN.lastIndex = 0;
  for (const match of line.matchAll(BACKTICK_PATH_PATTERN)) values.push(match[1]);
  return [...new Set(values)];
}

function exactReferences(line, values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => typeof value === "string" && value && line.includes(value)))];
}

function parseReadinessMatrix(markdown) {
  const section = sectionLines(markdown, /readiness gap matrix/iu);
  return section.flatMap(({ text }) => {
    if (!/^\s*\|/u.test(text)) return [];
    const cells = text.split("|").slice(1, -1).map(cleanTableCell);
    if (cells.length < 2 || /^(?:component|-+)$/iu.test(cells[0])) return [];
    const blockers = tableEntries(cells[3]);
    const commands = tableEntries(cells[4]);
    return [{
      component: cells[0],
      rung: cells[1],
      evidence: null,
      matrixValid: cells.length >= 5 && cells[2] === "runtime-ready"
        && blockers.length > 0 && blockers.length === commands.length,
    }];
  });
}

function checklistCriterionIds(markdown) {
  const section = sectionLines(markdown, /validation checklist/iu);
  return new Set(section.flatMap(({ text }) => {
    const commands = [...text.matchAll(/\bcommand\s*:\s*`[^`]+`/giu)];
    const observations = [...text.matchAll(
      /\bobserved (?:exit status|output)\s*:\s*(?:`[^`]+`|[^;|]+)/giu,
    )];
    if (commands.length !== 1 || observations.length !== 1) return [];
    return [...text.matchAll(/\b(1[0-4]|[1-9])\.(\d{1,2})\b/gu)]
      .map((match) => `${Number(match[1])}.${Number(match[2])}`);
  }));
}

function sectionLines(markdown, headingPattern) {
  const heading = markdown.headings.find(({ text }) => headingPattern.test(text));
  if (!heading) return [];
  const next = markdown.headings.find((candidate) => (
    candidate.line > heading.line && candidate.level <= heading.level
  ));
  return markdown.lines.filter(({ line }) => (
    line > heading.line && (!next || line < next.line)
  ));
}

function normalizeComponentRungs(values) {
  const source = Array.isArray(values)
    ? values
    : values && typeof values === "object"
      ? Object.entries(values).map(([component, value]) => (
        typeof value === "string" ? { component, rung: value } : { ...value, component }
      ))
      : [];
  const entries = [];
  const invalid = [];
  for (const [index, entry] of source.entries()) {
    if (
      entry
      && typeof entry.component === "string"
      && entry.component.length > 0
      && typeof entry.rung === "string"
      && entry.rung.length > 0
    ) {
      entries.push({
        component: entry.component,
        rung: entry.rung,
        evidence: entry.evidence ?? null,
        matrixValid: entry.matrixValid,
      });
    } else {
      invalid.push({
        component: typeof entry?.component === "string"
          ? entry.component
          : `<component-${index + 1}>`,
        rung: typeof entry?.rung === "string" ? entry.rung : null,
      });
    }
  }
  if (values !== undefined && values !== null && !Array.isArray(values)
    && typeof values !== "object") {
    invalid.push({ component: "<component-rungs>", rung: null });
  }
  return { entries, invalid };
}

function normalizeExpectedComponents(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => typeof value === "string" && value.length > 0))]
    .sort(compareText);
}

function completeRuntimeEvidence(value) {
  return Boolean(
    value
    && typeof value.command === "string" && value.command.trim()
    && typeof value.revision === "string" && value.revision.trim()
    && typeof value.observedOutput === "string" && value.observedOutput.trim()
    && ((typeof value.exitStatus === "string" && value.exitStatus.trim())
      || Number.isInteger(value.exitStatus))
    && Array.isArray(value.criterionIds) && value.criterionIds.length > 0
    && value.criterionIds.every((criterion) => (
      typeof criterion === "string" && ACCEPTANCE_CRITERION_IDS.includes(criterion)
    )),
  );
}

function hasSurfacedEvidence(values) {
  return normalizeComponentRungs(values).entries
    .some(({ evidence }) => completeRuntimeEvidence(evidence));
}

function documentInvalid(value) {
  return value.fields.length > 0
    || value.missingParts.length > 0
    || value.duplicateParts.length > 0
    || value.parseErrors.length > 0
    || value.missingRequirementReferences.length > 0
    || value.missingSiblingReferences.length > 0;
}

function report({ path, violations, frontmatter }) {
  const ordered = [...violations].sort((left, right) => (
    left.code.localeCompare(right.code, "en")
  ));
  return {
    schema: FRONTMATTER_VALIDATION_SCHEMA,
    status: ordered.length === 0 ? "passed" : "failed",
    outcome: ordered.length === 0 ? "document-valid" : ordered[0].code,
    path,
    frontmatter,
    violations: ordered,
  };
}

function normalizeInput(input) {
  if (typeof input === "string") return { text: input };
  return input && typeof input === "object" ? input : { text: input };
}

function unquote(value) {
  if (value.length >= 2 && (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  )) return value.slice(1, -1);
  return value;
}

function cleanTableCell(value) {
  return value.trim().replaceAll("`", "").replaceAll("**", "");
}

function tableEntries(value) {
  return String(value ?? "").split(/<br\s*\/?>/giu).map((entry) => entry.trim())
    .filter((entry) => entry && !/^(?:-|—|n\/a|none)$/iu.test(entry));
}

function uniqueReferences(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = `${value.line}\0${value.literal}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compareText(left, right) {
  return left.localeCompare(right, "en");
}
