import { isSuccessfulRecordedResult } from "./evidence-result.mjs";
import { makeFinding } from "./finding.mjs";

const REQUIRED_GATE_COVERAGE = Object.freeze([
  "problem-validation",
  "requirements-authoring",
  "architecture-authoring",
  "alignment-review",
  "implementation",
  "local-proof",
  "release-readiness",
]);

export function evaluateGates(model = {}, index = {}, chainsInput = []) {
  const chains = Array.isArray(chainsInput)
    ? chainsInput
    : chainsInput?.chains ?? [];
  const declarations = deriveGateDeclarations(model);
  const elements = arrayOf(model.elements);
  const evidenceByElement = collectEvidenceByElement(chains);
  const findings = [];
  const documentCount = model.documents instanceof Map
    ? model.documents.size
    : Object.keys(model.documents ?? {}).length;
  if (documentCount > 0 || elements.length > 0) {
    const declaredIds = declarations.map((declaration) =>
      String(declaration.gateId ?? declaration.id ?? ""));
    const missing = REQUIRED_GATE_COVERAGE.filter((gateId) =>
      !declaredIds.includes(gateId));
    const duplicate = REQUIRED_GATE_COVERAGE.filter((gateId) =>
      declaredIds.filter((value) => value === gateId).length > 1);
    const coveredOrder = declaredIds.filter((gateId) =>
      REQUIRED_GATE_COVERAGE.includes(gateId));
    const misordered = coveredOrder.some((gateId, index) =>
      gateId !== REQUIRED_GATE_COVERAGE[index]);
    if (missing.length > 0 || duplicate.length > 0 || misordered) {
      findings.push(createFinding("malformed-document", {
        artifactReference: "guideline-gate-model",
        evidenceExcerpt: [
          missing.length > 0 && `Missing Pipeline_Gates: ${missing.join(", ")}`,
          duplicate.length > 0 && `Duplicate Pipeline_Gates: ${duplicate.join(", ")}`,
          misordered && `Required Pipeline_Gate order: ${REQUIRED_GATE_COVERAGE.join(" -> ")}`,
        ].filter(Boolean).join("; "),
        statement: "Declare the complete ordered from-0-to-1 gate sequence in the Guideline_Set.",
      }));
    }
  }
  const gates = declarations.map((declaration, order) => {
    const gateId = String(declaration.gateId ?? declaration.id ?? declaration.name ?? `gate-${order}`);
    const mappedElements = uniqueSorted([
      ...arrayOf(declaration.mappedElements).map(String),
      ...elements
        .filter((element) =>
          String(element.gateId ?? "") === gateId ||
          (!element.gateId && String(element.sectionAnchor ?? "") === gateId))
        .map((element) => String(element.elementId ?? "")),
    ].filter(Boolean));
    const evidencedCount = mappedElements.filter((elementId) =>
      (evidenceByElement.get(elementId) ?? 0) > 0).length;
    const declarationComplete = [
      declaration.entryCondition,
      declaration.exitCondition,
      declaration.requiredEvidenceType ?? declaration.evidenceType,
    ].every((value) => String(value ?? "").trim().length > 0);
    const state = declarationComplete &&
      mappedElements.length > 0 && evidencedCount === mappedElements.length
      ? "met"
      : declarationComplete && evidencedCount > 0
        ? "partially-met"
        : "unmet";
    return {
      gateId,
      order,
      entryCondition: populatedCondition(declaration.entryCondition, gateId, "entry"),
      exitCondition: populatedCondition(declaration.exitCondition, gateId, "exit"),
      requiredEvidenceType: populatedCondition(
        declaration.requiredEvidenceType ?? declaration.evidenceType,
        gateId,
        "evidence",
      ),
      mappedElements,
      declarationComplete,
      state,
    };
  });

  const derivedOrder = gates.map(({ gateId }) => gateId);
  for (const declaration of documentedStageOrders(index)) {
    if (!arraysEqual(declaration.order, derivedOrder)) {
      findings.push(createFinding("gate-order-drift", {
        artifactReference: declaration.subject,
        evidenceExcerpt: `Guideline order: ${derivedOrder.join(" -> ")}; runtime order: ${declaration.order.join(" -> ")}`,
        statement: "Align the documented runtime stage order with the Guideline_Set-derived order.",
      }));
    }
  }

  const violation = firstSequenceViolation(gates);
  if (violation) {
    findings.push(createFinding("gate-sequence-violation", {
      guidelineAnchor: violation.later.gateId,
      artifactReference: violation.earlier.gateId,
      evidenceExcerpt: `${violation.later.gateId} is met after unmet gate ${violation.earlier.gateId}.`,
      statement: "Close the earlier gate before claiming a later gate is met.",
    }));
  }

  return { gates, findings };
}

export function deriveGateDeclarations(model = {}) {
  const explicit = arrayOf(model.gates ?? model.pipelineGates);
  const declared = explicit.length > 0
    ? explicit
    : declarationsFromElements(model.elements);
  const byGate = new Map();
  for (const declaration of [...declared].sort((left, right) =>
    numericOrder(left) - numericOrder(right))) {
    const gateId = String(declaration.gateId ?? declaration.id ?? "");
    if (!gateId) continue;
    const current = byGate.get(gateId);
    byGate.set(gateId, current
      ? {
          ...current,
          mappedElements: uniqueSorted([
            ...arrayOf(current.mappedElements),
            ...arrayOf(declaration.mappedElements),
          ].map(String)),
        }
      : declaration);
  }
  return [...byGate.entries()].map(([gateId, declaration], order) => ({
    ...declaration,
    gateId: String(gateId),
    order,
    mappedElements: arrayOf(declaration.mappedElements).map(String),
  }));
}

function declarationsFromElements(elementsInput) {
  const declarations = new Map();
  for (const element of arrayOf(elementsInput)) {
    const evidenceDeclaration = /^Required evidence:\s*(.+)$/imu.exec(String(element.text ?? ""));
    const gateId = String(element.gateId ??
      (evidenceDeclaration ? element.sectionAnchor : ""));
    if (!gateId) continue;
    const current = declarations.get(gateId) ?? {
      gateId,
      order: Number.isFinite(element.gateOrder) ? element.gateOrder : declarations.size,
      entryCondition: element.gateEntryCondition ?? element.entryCondition,
      exitCondition: element.gateExitCondition ?? element.exitCondition,
      requiredEvidenceType: element.requiredEvidenceType ?? evidenceDeclaration?.[1]?.trim(),
      mappedElements: [],
    };
    current.mappedElements.push(String(element.elementId ?? ""));
    declarations.set(gateId, current);
  }
  return [...declarations.values()];
}

function collectEvidenceByElement(chains) {
  const result = new Map();
  for (const chain of chains) {
    for (const link of arrayOf(chain.links)) {
      if (!link?.elementId || !hasRecordedEvidence(link.evidenceReference)) continue;
      result.set(String(link.elementId), (result.get(String(link.elementId)) ?? 0) + 1);
    }
  }
  return result;
}

function hasRecordedEvidence(evidence) {
  if (!evidence || typeof evidence !== "object") return false;
  return String(evidence.checkName ?? evidence.check_name ?? evidence.command ?? "").trim().length > 0 &&
    isSuccessfulRecordedResult(evidence) &&
    ["local", "production"].includes(
      String(evidence.reproducible ?? evidence.surface ?? "").trim().toLowerCase(),
    );
}

function documentedStageOrders(index) {
  const declarations = [];
  for (const entry of arrayOf(index.entries)) {
    const order = entry.documentedStageOrder ?? entry.stageOrder ?? entry.declaredStageOrder;
    if (arrayOf(order).length > 0) {
      declarations.push({
        subject: String(entry.entryId ?? entry.documentKey ?? "runtime-stage-order"),
        order: arrayOf(order).map(String),
      });
      continue;
    }
    const parsed = parseStageOrder(entry.excerpt);
    if (parsed.length > 0) {
      declarations.push({
        subject: String(entry.entryId ?? entry.documentKey ?? "runtime-stage-order"),
        order: parsed,
      });
    }
  }
  if (declarations.length > 0) return declarations;
  const direct = index.documentedStageOrder ?? index.stageOrder ?? index.declaredStageOrder;
  return arrayOf(direct).length > 0
    ? [{ subject: "runtime-stage-order", order: arrayOf(direct).map(String) }]
    : [];
}

function parseStageOrder(excerpt) {
  const match = /(?:^|\n)\s*stage_order\s*:\s*([^\n]*(?:\n(?!\s*\n|#{1,6}\s)[^\n]*)*)/iu
    .exec(String(excerpt ?? ""));
  if (!match) return [];
  const quoted = [...match[1].matchAll(/`([^`]+)`/gu)].map((item) => item[1].trim());
  if (quoted.length > 0) return quoted;
  return match[1].split(",").map((value) => value.trim()).filter(Boolean);
}

function firstSequenceViolation(gates) {
  for (let laterIndex = 0; laterIndex < gates.length; laterIndex += 1) {
    if (gates[laterIndex].state !== "met") continue;
    const earlier = gates.slice(0, laterIndex).find((gate) => gate.state === "unmet");
    if (earlier) return { earlier, later: gates[laterIndex] };
  }
  return null;
}

function populatedCondition(value, gateId, kind) {
  const text = String(value ?? "").trim();
  return text || "(undeclared)";
}

function numericOrder(value) {
  return Number.isFinite(value.order) ? value.order : Number.MAX_SAFE_INTEGER;
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "en"));
}

function arrayOf(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
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
