import { elementIdFrom, normalizeContent, stableSerialize } from "./normalize.mjs";

export const NORMATIVE_ELEMENT_KINDS = Object.freeze([
  "directive",
  "phase-gate-condition",
  "checklist-item",
  "required-template-field",
  "anti-pattern-guard",
]);

export const NORMATIVE_ELEMENT_CLASSES = Object.freeze([
  "artifact-bearing",
  "advisory",
]);

export function createGuidelineModel(documents = new Map(), elements = [], gates = []) {
  const documentMap = new Map(
    [...asDocumentEntries(documents)]
      .map(([key, meta]) => [String(key), normalizeDocumentMeta(key, meta)])
      .sort(([left], [right]) => left.localeCompare(right, "en")),
  );
  const normalizedElements = elements.map(normalizeNormativeElement);
  return {
    documents: documentMap,
    elements: canonicalGuidelineElements({ documents: documentMap, elements: normalizedElements }),
    gates: gates.map(normalizeGateDeclaration).sort(compareGateDeclarations),
  };
}

export function normalizeDocumentMeta(documentKey, meta = {}) {
  return {
    documentKey: String(meta.documentKey ?? documentKey),
    frontmatterKeys: [...new Set(meta.frontmatterKeys ?? [])]
      .map(String)
      .sort((left, right) => left.localeCompare(right, "en")),
    sectionAnchors: (meta.sectionAnchors ?? []).map(String),
    universalScope: Boolean(meta.universalScope),
  };
}

export function normalizeNormativeElement(element) {
  if (!element || typeof element !== "object") {
    throw new TypeError("Normative_Element must be an object");
  }
  const kind = String(element.kind ?? "");
  if (!NORMATIVE_ELEMENT_KINDS.includes(kind)) {
    throw new TypeError(`unknown Normative_Element kind: ${kind}`);
  }
  const elementClass = String(element.class ?? "");
  if (!NORMATIVE_ELEMENT_CLASSES.includes(elementClass)) {
    throw new TypeError(`unknown Normative_Element class: ${elementClass}`);
  }
  const sectionAnchor = String(element.sectionAnchor ?? "");
  const text = normalizeContent(String(element.text ?? ""));
  const ordinal = Number(element.ordinal);
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) {
    throw new TypeError("Normative_Element ordinal must be a non-negative integer");
  }
  return {
    elementId: String(element.elementId ?? elementIdFrom(sectionAnchor, text)),
    documentKey: String(element.documentKey ?? ""),
    sectionAnchor,
    kind,
    class: elementClass,
    gateId:
      element.gateId === undefined || element.gateId === null
        ? null
        : String(element.gateId),
    ordinal,
    text,
  };
}

export function normalizeGateDeclaration(gate) {
  if (!gate || typeof gate !== "object") {
    throw new TypeError("Pipeline_Gate declaration must be an object");
  }
  const order = Number(gate.order);
  if (!Number.isSafeInteger(order) || order < 0) {
    throw new TypeError("Pipeline_Gate order must be a non-negative integer");
  }
  return {
    gateId: String(gate.gateId ?? gate.id ?? ""),
    documentKey: String(gate.documentKey ?? ""),
    sectionAnchor: String(gate.sectionAnchor ?? ""),
    order,
    entryCondition: String(gate.entryCondition ?? ""),
    exitCondition: String(gate.exitCondition ?? ""),
    requiredEvidenceType: String(
      gate.requiredEvidenceType ?? gate.evidenceType ?? "",
    ),
  };
}

export function compareGateDeclarations(left, right) {
  return (
    left.order - right.order ||
    left.documentKey.localeCompare(right.documentKey, "en") ||
    left.gateId.localeCompare(right.gateId, "en")
  );
}

export function canonicalGuidelineElements(modelOrResult) {
  const model = unwrapModel(modelOrResult);
  const documents = model.documents instanceof Map ? model.documents : new Map();
  return [...(model.elements ?? [])].sort((left, right) => {
    const keyOrder = String(left.documentKey).localeCompare(String(right.documentKey), "en");
    if (keyOrder !== 0) return keyOrder;
    const anchors = documents.get(left.documentKey)?.sectionAnchors ?? [];
    const leftIndex = sectionIndex(anchors, left.sectionAnchor);
    const rightIndex = sectionIndex(anchors, right.sectionAnchor);
    return (
      leftIndex - rightIndex ||
      Number(left.ordinal) - Number(right.ordinal) ||
      String(left.elementId).localeCompare(String(right.elementId), "en")
    );
  });
}

export function guidelineModelsEqual(leftInput, rightInput) {
  const left = unwrapModel(leftInput);
  const right = unwrapModel(rightInput);
  const leftDocuments = new Map(asDocumentEntries(left.documents));
  const rightDocuments = new Map(asDocumentEntries(right.documents));
  const leftKeys = [...leftDocuments.keys()].sort();
  const rightKeys = [...rightDocuments.keys()].sort();
  if (!arraysEqual(leftKeys, rightKeys)) return false;

  for (const key of leftKeys) {
    const leftMeta = normalizeDocumentMeta(key, leftDocuments.get(key));
    const rightMeta = normalizeDocumentMeta(key, rightDocuments.get(key));
    if (leftMeta.universalScope !== rightMeta.universalScope) return false;
    if (!arraysEqual(leftMeta.frontmatterKeys, rightMeta.frontmatterKeys)) return false;
    if (!arraysEqual(leftMeta.sectionAnchors, rightMeta.sectionAnchors)) return false;
  }

  const tuples = (model) =>
    new Set(
      (model.elements ?? []).map((element) => {
        const normalized = normalizeNormativeElement(element);
        return stableSerialize([
          normalized.elementId,
          normalized.documentKey,
          normalized.sectionAnchor,
          normalized.kind,
          normalized.class,
          normalized.gateId,
          normalized.ordinal,
          normalized.text,
        ]);
      }),
    );
  if (!setsEqual(tuples(left), tuples(right))) return false;
  const gateTuples = (model) =>
    new Set(
      (model.gates ?? []).map((gate) => {
        const normalized = normalizeGateDeclaration(gate);
        return stableSerialize([
          normalized.gateId,
          normalized.documentKey,
          normalized.sectionAnchor,
          normalized.order,
          normalized.entryCondition,
          normalized.exitCondition,
          normalized.requiredEvidenceType,
        ]);
      }),
    );
  return setsEqual(gateTuples(left), gateTuples(right));
}

export function unwrapGuidelineModel(modelOrResult) {
  return unwrapModel(modelOrResult);
}

function unwrapModel(modelOrResult) {
  return modelOrResult?.value?.documents ? modelOrResult.value : modelOrResult ?? {};
}

function asDocumentEntries(documents) {
  if (documents instanceof Map) return documents.entries();
  return Object.entries(documents ?? {});
}

function sectionIndex(anchors, anchor) {
  const index = anchors.indexOf(anchor);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function setsEqual(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}
