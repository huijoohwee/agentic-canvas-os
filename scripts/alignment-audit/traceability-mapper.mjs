import { makeFinding } from "./finding.mjs";
import { isSuccessfulRecordedResult } from "./evidence-result.mjs";
import {
  hasRequiredTokenOverlap,
  selectEvidenceForElement,
  significantTokens,
} from "./evidence-linkage.mjs";
import {
  normalizeElementIds,
  parseElementIdList,
} from "./element-linkage.mjs";
import {
  looksLikeDocumentReference,
  referenceAliases,
  resolveSuppliedReference,
} from "./reference-inventory.mjs";

export function mapTraceability(model = {}, index = {}, options = {}) {
  const elements = arrayOf(model.elements);
  const entries = arrayOf(index.entries);
  const links = [];
  const linkedElementIds = new Set();
  const linkedEntryIds = new Set();
  const advisoryCoverage = [];
  const findings = [];

  for (const element of elements) {
    const matches = entries.filter((entry) => entrySatisfiesElement(entry, element));
    if (matches.length === 0) {
      if (isArtifactBearing(element)) {
        findings.push(createFinding("unimplemented-guideline", {
          guidelineAnchor: element.elementId ?? element.sectionAnchor,
          artifactReference: "-",
          evidenceExcerpt: firstPopulated(
            element.text,
            "Artifact-bearing guideline has no matching artifact.",
          ),
          statement: "Document or specify the runtime artifact required by this guideline element.",
        }));
      } else {
        advisoryCoverage.push(String(element.elementId ?? element.sectionAnchor ?? "-"));
      }
      continue;
    }

    linkedElementIds.add(elementKey(element));
    for (const entry of matches) {
      linkedEntryIds.add(entryKey(entry));
      const proofTarget = resolveProofTarget(
        entry,
        entries,
        options.referenceInventory,
      );
      const evidenceSources = proofTarget && proofTarget !== entry
        ? [entry, proofTarget]
        : [entry];
      const evidence = selectEvidenceForElement(
        element,
        evidenceSources.flatMap(evidenceFrom),
        evidenceSources.flatMap(conditionsFrom),
      );
      links.push({
        elementId: String(element.elementId ?? "-"),
        artifactReference: String(entry.entryId ?? entry.documentKey ?? "-"),
        evidenceReference: evidence ?? null,
        capabilityId: capabilityKey(entry),
      });
    }
  }

  for (const entry of entries) {
    if (!linkedEntryIds.has(entryKey(entry))) {
      findings.push(createFinding("unguided-artifact", {
        guidelineAnchor: "-",
        artifactReference: entry.entryId ?? entry.documentKey,
        evidenceExcerpt: firstPopulated(
          entry.excerpt,
          entry.body,
          "Artifact has no linked guideline element.",
        ),
        statement: "Document the guideline authority for this runtime artifact.",
      }));
    }
  }

  const unresolved = collectUnresolvableReferences(
    index,
    entries,
    options.referenceInventory,
  );
  for (const reference of unresolved) {
    findings.push(createFinding("unresolvable-reference", {
      guidelineAnchor: reference.guidelineAnchor ?? "-",
      artifactReference: reference.artifactReference ?? reference.documentKey ?? "-",
      evidenceExcerpt: firstPopulated(
        reference.reference,
        reference.value,
        String(reference),
        "Unresolvable reference.",
      ),
      statement: "Correct the reference or add its target to a configured input root.",
    }));
  }

  const chains = buildChains(
    entries,
    links,
    advisoryCoverage,
    options.referenceInventory,
  );
  for (const entry of entries) {
    if (String(valueOf(entry.declaredStatus)).toLowerCase() !== "runtime-ready") continue;
    const chain = chains.find((candidate) => candidate.capabilityId === capabilityKey(entry));
    if (!chain || !isEvidenceClosed(chain.conditions, chain.evidence)) {
      findings.push(createFinding("unproven-claim", {
        guidelineAnchor: links.find((link) =>
          link.artifactReference === String(entry.entryId ?? entry.documentKey ?? "-"))?.elementId ?? "-",
        artifactReference: entry.entryId ?? entry.documentKey,
        evidenceExcerpt: `Declared runtime-ready without a nonempty evidence-closed VCC set: ${entry.documentKey ?? entry.entryId ?? "-"}`,
        statement: "Add a Verifiable Completion Condition and a recorded Evidence Reference for every condition.",
      }));
    }
  }

  const artifactBearing = elements.filter(isArtifactBearing);
  const artifactBearingLinked = artifactBearing.filter((element) =>
    linkedElementIds.has(elementKey(element))).length;
  const artifactBearingTotal = artifactBearing.length;
  const coverage = {
    artifactBearingTotal,
    artifactBearingLinked,
    linkedRatio: artifactBearingTotal === 0
      ? 1
      : artifactBearingLinked / artifactBearingTotal,
  };

  return {
    chains,
    links,
    advisoryCoverage: [...new Set(advisoryCoverage)].sort(),
    coverage,
    findings,
  };
}

export function isEvidenceClosed(conditions, evidence) {
  const conditionList = arrayOf(conditions).filter(Boolean);
  if (
    conditionList.length === 0 ||
    conditionList.some((condition) => !isCompleteCondition(condition))
  ) return false;
  const evidenceList = arrayOf(evidence);
  return conditionList.every((condition) =>
    evidenceList.some((item) => evidenceCoversCondition(item, condition)));
}

function buildChains(entries, links, advisoryCoverage, referenceInventory) {
  const byCapability = new Map();
  for (const entry of entries) {
    const capabilityId = capabilityKey(entry);
    const chain = byCapability.get(capabilityId) ?? {
      capabilityId,
      entryIds: [],
      links: [],
      conditions: [],
      evidence: [],
      advisoryCoverage: [],
    };
    chain.entryIds.push(String(entry.entryId ?? entry.documentKey ?? "-"));
    chain.conditions.push(...conditionsFrom(entry));
    chain.evidence.push(...evidenceFrom(entry));
    const proofTarget = resolveProofTarget(entry, entries, referenceInventory);
    if (proofTarget && proofTarget !== entry) {
      chain.conditions.push(...conditionsFrom(proofTarget));
      chain.evidence.push(...evidenceFrom(proofTarget));
    }
    byCapability.set(capabilityId, chain);
  }

  for (const link of links) {
    const chain = byCapability.get(link.capabilityId);
    if (!chain) continue;
    chain.links.push({
      elementId: link.elementId,
      artifactReference: link.artifactReference,
      evidenceReference: link.evidenceReference,
    });
    if (link.evidenceReference) chain.evidence.push(link.evidenceReference);
  }

  const chains = [...byCapability.values()].map((chain) => ({
    ...chain,
    entryIds: uniqueSorted(chain.entryIds),
    links: [...chain.links].sort(compareLinks),
    conditions: uniqueBy(chain.conditions.filter(Boolean), conditionKey),
    evidence: uniqueBy(chain.evidence.filter(Boolean), evidenceKey),
    advisoryCoverage: uniqueSorted(advisoryCoverage),
  }));
  return chains.sort((left, right) => left.capabilityId.localeCompare(right.capabilityId, "en"));
}

function conditionsFrom(entry) {
  const direct = [
    ...arrayOf(entry.conditions),
    ...arrayOf(entry.verifiableCompletionConditions),
    ...arrayOf(entry.completionConditions),
  ];
  const proof = valueOf(entry.declaredProofReference);
  if (proof && typeof proof === "object") {
    direct.push(...arrayOf(proof.conditions ?? proof.condition ?? proof.vcc));
  }
  direct.push(...parseConditionsFromExcerpt(entry.excerpt ?? entry.body ?? entry.content ?? ""));
  return direct.map(normalizeCondition).filter(Boolean);
}

function evidenceFrom(entry) {
  const direct = [
    ...arrayOf(entry.evidence),
    ...arrayOf(entry.evidenceReferences),
  ];
  const proof = valueOf(entry.declaredProofReference);
  if (proof && typeof proof === "object") {
    direct.push(...arrayOf(proof.evidence ?? proof.evidenceReferences));
  }
  direct.push(...parseEvidenceFromExcerpt(entry.excerpt ?? entry.body ?? entry.content ?? ""));
  for (const condition of conditionsFrom(entry)) {
    direct.push(...arrayOf(condition.evidence ?? condition.evidenceReference));
  }
  return direct.map(normalizeEvidence).filter(Boolean);
}

function normalizeCondition(condition) {
  if (!condition || typeof condition !== "object") return null;
  return {
    ...condition,
    conditionId: String(condition.conditionId ?? condition.id ?? ""),
    endState: String(condition.endState ?? condition.end_state ?? ""),
    statedCheck: String(condition.statedCheck ?? condition.stated_check ?? condition.check ?? ""),
    constraint: String(condition.constraint ?? condition.scopeConstraint ?? ""),
    bound: condition.bound ?? null,
  };
}

function normalizeEvidence(evidence) {
  if (!evidence || typeof evidence !== "object") return null;
  const elementIds = normalizeElementIds([
    ...parseElementIdList(evidence.elementIds ?? evidence.element_ids),
    ...parseElementIdList(
      evidence.guidelineElementIds ?? evidence.guideline_element_ids,
    ),
    evidence.elementId ?? evidence.element_id,
    evidence.guidelineElementId ?? evidence.guideline_element_id,
  ].filter(Boolean));
  return {
    ...evidence,
    conditionId: evidence.conditionId ?? evidence.condition_id ?? null,
    checkName: String(evidence.checkName ?? evidence.check_name ?? evidence.command ?? ""),
    recordedResult: String(evidence.recordedResult ?? evidence.recorded_result ?? evidence.result ?? ""),
    reproducible: String(evidence.reproducible ?? evidence.surface ?? "unproven"),
    elementIds,
  };
}

function evidenceCoversCondition(evidence, condition) {
  const item = normalizeEvidence(evidence);
  if (!item || !isSuccessfulRecordedResult(item)) return false;
  const check = String(condition.statedCheck ?? condition.check ?? "").trim();
  if (check.length === 0 || item.checkName.trim() !== check) return false;
  if (!["local", "production"].includes(item.reproducible.trim().toLowerCase())) {
    return false;
  }
  const conditionId = String(condition.conditionId ?? condition.id ?? "");
  if (conditionId.length > 0) {
    return String(item.conditionId ?? "") === conditionId;
  }
  return true;
}

function isCompleteCondition(condition) {
  return Boolean(condition) &&
    String(condition.conditionId ?? condition.id ?? "").trim().length > 0 &&
    String(condition.endState ?? "").trim().length > 0 &&
    String(condition.statedCheck ?? condition.check ?? "").trim().length > 0 &&
    String(condition.constraint ?? "").trim().length > 0;
}

function entrySatisfiesElement(entry, element) {
  if (arrayOf(entry.elementIds).map(String).includes(String(element.elementId))) return true;
  const descriptor = String(
    element.requiredArtifactDescriptor ?? element.artifactDescriptor ?? element.text ?? "",
  );
  const corpus = [
    valueOf(entry.declaredRuntimeScope),
    valueOf(entry.declaredOwner),
    entry.body,
    entry.content,
    entry.excerpt,
    ...arrayOf(entry.requiredArtifactDescriptors),
  ].filter((value) => typeof value === "string").join(" ");
  const descriptorTokens = significantTokens(descriptor);
  if (descriptorTokens.size === 0) return false;
  const corpusTokens = significantTokens(corpus);
  return hasRequiredTokenOverlap(descriptorTokens, corpusTokens);
}

function collectUnresolvableReferences(index, entries, referenceInventory) {
  const explicit = [
    ...arrayOf(index.unresolvableReferences),
    ...entries.flatMap((entry) => arrayOf(entry.unresolvableReferences)),
  ];
  for (const entry of entries) {
    const proof = valueOf(entry.declaredProofReference);
    if (proof && typeof proof === "object" &&
        (proof.resolved === false || proof.targetExists === false || proof.resolvable === false)) {
      explicit.push({
        artifactReference: entry.entryId ?? entry.documentKey,
        reference: proof.reference ?? proof.path ?? proof.target ?? "unresolvable proof reference",
      });
    } else if (typeof proof === "string" && looksLikeDocumentReference(proof) &&
        !suppliedReferenceIsPresent(entry, proof, referenceInventory) &&
        !resolveProofTarget(entry, entries, referenceInventory)) {
      explicit.push({
        artifactReference: entry.entryId ?? entry.documentKey,
        reference: proof,
      });
    }
  }
  return explicit;
}

function suppliedReferenceIsPresent(entry, proof, referenceInventory) {
  const supplied = resolveSuppliedReference(entry, proof, referenceInventory);
  return supplied.inventoried && supplied.documentKey !== null;
}

function parseConditionsFromExcerpt(excerpt) {
  const text = String(excerpt ?? "");
  const conditions = [];
  for (const table of markdownTables(text)) {
    const idIndex = tableHeaderIndex(table.headers, /^(?:condition[_ ]?id|vcc[_ ]?id)$/iu);
    const endIndex = tableHeaderIndex(table.headers, /^end[_ ]?state$/iu);
    const checkIndex = tableHeaderIndex(table.headers, /^(?:stated[_ ]?check|check)$/iu);
    const constraintIndex = tableHeaderIndex(table.headers, /^(?:scope[_ ]?)?constraint$/iu);
    if ([idIndex, endIndex, checkIndex, constraintIndex].every((index) => index >= 0)) {
      for (const row of table.rows) {
        conditions.push({
          conditionId: row[idIndex],
          endState: row[endIndex],
          statedCheck: row[checkIndex],
          constraint: row[constraintIndex],
        });
      }
    }
  }

  const blocks = labelledBlocks(text, [
    "condition_id",
    "end_state",
    "stated_check",
    "constraint",
  ]);
  conditions.push(...blocks.map((block) => ({
    conditionId: block.condition_id,
    endState: block.end_state,
    statedCheck: block.stated_check,
    constraint: block.constraint,
  })));

  for (const [index, match] of [...text.matchAll(
    /(?:^|\n)\s*(?:VCC|Verifiable Completion Condition)(?:\s+([A-Za-z0-9._-]+))?\s*:\s*([^|\n]+)\|\s*([^|\n]+)\|\s*([^\n]+)/giu,
  )].entries()) {
    conditions.push({
      conditionId: match[1] || contentOnlyId("vcc", match[0], index),
      endState: match[2].trim(),
      statedCheck: match[3].trim(),
      constraint: match[4].trim(),
    });
  }
  return conditions;
}

function parseEvidenceFromExcerpt(excerpt) {
  const text = String(excerpt ?? "");
  const evidence = [];
  for (const table of markdownTables(text)) {
    const idIndex = tableHeaderIndex(table.headers, /^(?:condition[_ ]?id|vcc[_ ]?id)$/iu);
    const checkIndex = tableHeaderIndex(table.headers, /^(?:check[_ ]?name|validation[_ ]?command|check)$/iu);
    const resultIndex = tableHeaderIndex(table.headers, /^recorded[_ ]?result$/iu);
    const reproducibleIndex = tableHeaderIndex(table.headers, /^(?:reproducible|surface)$/iu);
    const elementIndex = tableHeaderIndex(
      table.headers,
      /^(?:(?:guideline_)?element_ids?)$/iu,
    );
    if ([idIndex, checkIndex, resultIndex].every((index) => index >= 0)) {
      for (const row of table.rows) {
        evidence.push({
          conditionId: row[idIndex],
          checkName: row[checkIndex],
          recordedResult: row[resultIndex],
          reproducible: reproducibleIndex >= 0 ? row[reproducibleIndex] : "unproven",
          elementIds: elementIndex >= 0 ? parseElementIdList(row[elementIndex]) : [],
        });
      }
    }
  }
  const blocks = labelledBlocks(text, [
    "condition_id",
    "evidence_check",
    "recorded_result",
    "reproducible",
  ]);
  evidence.push(...blocks.map((block) => ({
    conditionId: block.condition_id,
    checkName: block.evidence_check,
    recordedResult: block.recorded_result,
    reproducible: block.reproducible,
  })));
  return evidence;
}

function resolveProofTarget(entry, entries, referenceInventory) {
  const proof = valueOf(entry.declaredProofReference);
  if (typeof proof !== "string" || !looksLikeDocumentReference(proof)) return null;
  const supplied = resolveSuppliedReference(entry, proof, referenceInventory);
  if (supplied.inventoried) {
    return supplied.documentKey === null
      ? null
      : entries.find((candidate) =>
          String(candidate.documentKey) === supplied.documentKey) ?? null;
  }
  const targets = new Set(referenceAliases(proof));
  return entries.find((candidate) => {
    const identities = [
      candidate.documentKey,
      candidate.entryId,
      candidate.declaredIdentity,
      candidate.title,
    ].filter((value) => typeof value === "string").flatMap(referenceAliases);
    return identities.some((identity) => targets.has(identity));
  }) ?? null;
}

function labelledBlocks(text, labels) {
  const result = [];
  let current = {};
  for (const line of String(text).split("\n")) {
    const match = /^\s*(?:[-*]\s*)?([A-Za-z_ ]+)\s*:\s*(.+?)\s*$/u.exec(line);
    if (!match) continue;
    const key = match[1].trim().toLowerCase().replaceAll(" ", "_");
    if (!labels.includes(key)) continue;
    if (key === labels[0] && Object.keys(current).length > 0) {
      if (labels.every((label) => current[label])) result.push(current);
      current = {};
    }
    current[key] = match[2].replace(/^`|`$/gu, "").trim();
    if (labels.every((label) => current[label])) {
      result.push(current);
      current = {};
    }
  }
  return result;
}

function markdownTables(text) {
  const lines = String(text).split("\n");
  const tables = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!lines[index].trim().startsWith("|") ||
        !/^\s*\|?(?:\s*:?-+:?\s*\|)+\s*$/u.test(lines[index + 1])) continue;
    const headers = tableCells(lines[index]);
    const rows = [];
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      if (!lines[rowIndex].trim().startsWith("|")) break;
      rows.push(tableCells(lines[rowIndex]));
    }
    tables.push({ headers, rows });
    index += rows.length + 1;
  }
  return tables;
}

function tableCells(line) {
  return line.trim().replace(/^\||\|$/gu, "").split("|").map((cell) =>
    cell.trim().replace(/^`([^`]*)`$/u, "$1"));
}

function tableHeaderIndex(headers, pattern) {
  return headers.findIndex((header) =>
    pattern.test(header.toLowerCase().replace(/[- ]+/gu, "_")));
}

function contentOnlyId(prefix, value, ordinal) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${ordinal}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function isArtifactBearing(element) {
  return String(element?.class ?? element?.classification ?? "") === "artifact-bearing";
}

function capabilityKey(entry) {
  return String(entry.capabilityId ??
    valueOf(entry.declaredRuntimeScope) ??
    valueOf(entry.declaredOwner) ??
    entry.documentKey ??
    entry.entryId ??
    "unknown-capability");
}

function entryKey(entry) {
  return String(entry.entryId ?? entry.documentKey ?? JSON.stringify(entry));
}

function elementKey(element) {
  return String(element.elementId ?? `${element.sectionAnchor}:${element.text}`);
}

function valueOf(value) {
  if (typeof value === "symbol" || value === undefined || value === null) return "";
  return value;
}

function firstPopulated(...values) {
  return values.map((value) => String(value ?? "").trim())
    .find((value) => value.length > 0) ?? "-";
}

function arrayOf(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "en"));
}

function uniqueBy(values, keyFrom) {
  const map = new Map();
  for (const value of values) map.set(keyFrom(value), value);
  return [...map.values()].sort((left, right) => keyFrom(left).localeCompare(keyFrom(right), "en"));
}

function conditionKey(condition) {
  return String(condition.conditionId ?? condition.id ?? JSON.stringify(condition));
}

function evidenceKey(evidence) {
  return JSON.stringify([
    evidence.conditionId ?? null,
    evidence.checkName ?? "",
    evidence.recordedResult ?? "",
    evidence.reproducible ?? "",
  ]);
}

function compareLinks(left, right) {
  return left.elementId.localeCompare(right.elementId, "en") ||
    left.artifactReference.localeCompare(right.artifactReference, "en");
}

function createFinding(findingType, fields) {
  return makeFinding({
    findingType,
    guidelineAnchor: fields.guidelineAnchor ?? "-",
    artifactReference: fields.artifactReference ?? "-",
    evidenceExcerpt: fields.evidenceExcerpt,
    remediation: {
      class: "documentation-change",
      statement: fields.statement,
      state: "proposed",
      operatorInstructionRef: null,
    },
  });
}
