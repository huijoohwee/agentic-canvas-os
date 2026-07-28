import {
  entryIdFrom,
  normalizeContent,
  stableSerialize,
} from "./normalize.mjs";

export const ABSENT = Symbol.for("alignment-audit.absent");

export const ARTIFACT_ENTRY_KINDS = Object.freeze([
  "markdown-document",
  "contract-schema",
  "validation-command",
  "readiness-status",
]);

export const INVOCATION_SURFACES = Object.freeze(["slash", "hash", "at", "mcp"]);

export function isAbsent(value) {
  return value === ABSENT;
}

export function createArtifactIndex(entriesOrIndex = []) {
  const source = Array.isArray(entriesOrIndex)
    ? { entries: entriesOrIndex }
    : entriesOrIndex ?? { entries: [] };
  const entries = source.entries ?? [];
  const normalizedEntries = entries.map(normalizeArtifactEntry).sort(compareArtifactEntries);
  const firstStageOrder =
    source.documentedStageOrder ??
    normalizedEntries.find((entry) => entry.documentedStageOrder.length > 0)
      ?.documentedStageOrder ??
    [];
  return {
    entries: normalizedEntries,
    documentedStageOrder: firstStageOrder.map(String),
    documentedToolIdentities: uniqueSorted([
      ...(source.documentedToolIdentities ?? []),
      ...normalizedEntries.flatMap((entry) => entry.toolIdentities),
    ]),
    federatedToolIdentities: uniqueSorted([
      ...(source.federatedToolIdentities ?? []),
      ...normalizedEntries.flatMap((entry) => entry.federatedToolIdentities),
    ]),
    cataloguedToolIdentities: uniqueSorted([
      ...(source.cataloguedToolIdentities ?? []),
      ...normalizedEntries.flatMap((entry) => entry.cataloguedToolIdentities),
    ]),
  };
}

export function normalizeArtifactEntry(entry) {
  if (!entry || typeof entry !== "object") {
    throw new TypeError("Artifact_Entry must be an object");
  }
  const entryKind = String(entry.entryKind ?? "");
  if (!ARTIFACT_ENTRY_KINDS.includes(entryKind)) {
    throw new TypeError(`unknown Artifact_Entry kind: ${entryKind}`);
  }
  const documentKey = String(entry.documentKey ?? "");
  const scalar = (value) =>
    value === undefined || value === null || value === ABSENT ? ABSENT : String(value);
  const invocationRoutes = canonicalInvocationRoutes(entry.invocationRoutes ?? []);
  const toolIdentities = [...new Set((entry.toolIdentities ?? []).map(String))].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  const elementIds = uniqueSorted(entry.elementIds ?? []);
  const discriminator = {
    capabilityId: comparableScalar(scalar(entry.capabilityId)),
    declaredStatus: comparableScalar(scalar(entry.declaredStatus)),
    commandText: comparableScalar(scalar(entry.commandText)),
    excerpt: normalizeContent(String(entry.excerpt ?? "")),
  };

  return {
    entryId: String(
      entry.entryId ?? entryIdFrom(documentKey, entryKind, discriminator),
    ),
    documentKey,
    entryKind,
    capabilityId: scalar(entry.capabilityId),
    declaredStatus: scalar(entry.declaredStatus),
    declaredRuntimeScope: scalar(entry.declaredRuntimeScope),
    declaredOwner: scalar(entry.declaredOwner),
    declaredProofReference: scalar(entry.declaredProofReference),
    commandText: scalar(entry.commandText),
    contractRole: scalar(entry.contractRole),
    elementIds,
    invocationRoutes,
    toolIdentities,
    documentedStageOrder: (entry.documentedStageOrder ?? []).map(String),
    federatedToolIdentities: uniqueSorted(entry.federatedToolIdentities ?? []),
    cataloguedToolIdentities: uniqueSorted(entry.cataloguedToolIdentities ?? []),
    excerpt: normalizeContent(String(entry.excerpt ?? "")),
  };
}

export function canonicalInvocationRoutes(routes) {
  const seen = new Set();
  const normalized = [];
  for (const route of routes ?? []) {
    if (!route || typeof route !== "object") continue;
    const surface = String(route.surface ?? "");
    if (!INVOCATION_SURFACES.includes(surface)) {
      throw new TypeError(`unknown Invocation_Route surface: ${surface}`);
    }
    const token = String(route.token ?? "");
    const owner =
      route.owner === undefined || route.owner === null ? null : String(route.owner);
    const key = stableSerialize([surface, token, owner]);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(owner === null ? { surface, token } : { surface, token, owner });
  }
  return normalized.sort(
    (left, right) =>
      left.surface.localeCompare(right.surface, "en") ||
      left.token.localeCompare(right.token, "en") ||
      String(left.owner ?? "").localeCompare(String(right.owner ?? ""), "en"),
  );
}

export function compareArtifactEntries(left, right) {
  return String(left.entryId).localeCompare(String(right.entryId), "en");
}

export function artifactIndexesEqual(leftInput, rightInput) {
  const left = unwrapArtifactIndex(leftInput);
  const right = unwrapArtifactIndex(rightInput);
  const tuples = (index) =>
    new Set(
      (index.entries ?? []).map((rawEntry) => {
        const entry = normalizeArtifactEntry(rawEntry);
        return stableSerialize([
          entry.entryId,
          entry.documentKey,
          entry.entryKind,
          comparableScalar(entry.capabilityId),
          comparableScalar(entry.declaredStatus),
          comparableScalar(entry.declaredRuntimeScope),
          comparableScalar(entry.declaredOwner),
          comparableScalar(entry.declaredProofReference),
          comparableScalar(entry.commandText),
          comparableScalar(entry.contractRole),
          entry.elementIds,
          entry.invocationRoutes,
          entry.toolIdentities,
          entry.documentedStageOrder,
          entry.federatedToolIdentities,
          entry.cataloguedToolIdentities,
          normalizeContent(entry.excerpt),
        ]);
      }),
    );
  const leftSet = tuples(left);
  const rightSet = tuples(right);
  return leftSet.size === rightSet.size && [...leftSet].every((value) => rightSet.has(value));
}

export function unwrapArtifactIndex(indexOrResult) {
  return indexOrResult?.value?.entries ? indexOrResult.value : indexOrResult ?? { entries: [] };
}

export function entryCapabilityId(entry) {
  if (!isAbsent(entry.capabilityId) && String(entry.capabilityId).trim()) {
    return String(entry.capabilityId);
  }
  if (!isAbsent(entry.declaredRuntimeScope) && String(entry.declaredRuntimeScope).trim()) {
    return String(entry.declaredRuntimeScope);
  }
  return String(entry.documentKey);
}

function comparableScalar(value) {
  return value === ABSENT ? ["absent"] : ["string", normalizeContent(String(value))];
}

function uniqueSorted(values) {
  return [...new Set(values.map(String))].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
}
