import { makeFinding } from "./finding.mjs";

export function detectDrift(
  _model = {},
  index = {},
  chainsInput = [],
  _gates = [],
  _readiness = [],
) {
  const entries = arrayOf(index.entries);
  const chains = Array.isArray(chainsInput)
    ? chainsInput
    : chainsInput?.chains ?? [];
  const findings = [
    ...statusConflicts(entries),
    ...staleEvidence(entries, chains),
    ...duplicateOwners(entries),
    ...blendedStatuses(entries),
    ...missingCompanions(entries),
  ];
  return findings.sort(compareFindingIdentity);
}

function statusConflicts(entries) {
  const findings = [];
  for (const [capabilityId, group] of groupByCapability(entries)) {
    const statuses = new Map();
    for (const entry of group) {
      const status = populated(entry.declaredStatus);
      if (!status) continue;
      const list = statuses.get(status) ?? [];
      list.push(entry);
      statuses.set(status, list);
    }
    if (statuses.size < 2) continue;
    const declarations = [...statuses.entries()].flatMap(([status, statusEntries]) =>
      statusEntries.map((entry) => ({
        status,
        documentKey: String(entry.documentKey ?? entry.entryId ?? "-"),
      })));
    const crossDocumentConflict = declarations.some((left, index) =>
      declarations.slice(index + 1).some((right) =>
        left.documentKey !== right.documentKey && left.status !== right.status));
    if (!crossDocumentConflict) continue;
    const subjects = [...new Set(declarations.map(({ documentKey }) => documentKey))]
      .sort((left, right) => left.localeCompare(right, "en"));
    findings.push(createFinding("status-conflict", {
      artifactReference: subjects.join(" <> "),
      evidenceExcerpt: `Capability ${capabilityId} declares conflicting statuses: ${[...statuses.keys()].sort().join(", ")}.`,
      statement: "Choose one evidence-derived readiness status for this capability in every owning document.",
    }));
  }
  return findings;
}

function staleEvidence(entries, chains) {
  const indexedCommands = new Set(entries
    .filter((entry) => String(entry.entryKind ?? "") === "validation-command")
    .map((entry) => populated(entry.commandText))
    .filter(Boolean));
  const findings = [];
  for (const chain of chains) {
    for (const evidence of arrayOf(chain.evidence)) {
      const command = populated(
        evidence.validationCommand ??
        evidence.commandText ??
        evidence.checkName,
      );
      if (!command || indexedCommands.has(command)) continue;
      findings.push(createFinding("stale-evidence", {
        guidelineAnchor: chain.links?.[0]?.elementId ?? "-",
        artifactReference: String(chain.capabilityId ?? "-"),
        evidenceExcerpt: `Evidence names an unindexed validation command: ${command}`,
        statement: "Index the declared validation command or update the Evidence Reference.",
      }));
    }
  }
  return findings;
}

function duplicateOwners(entries) {
  const findings = [];
  for (const [capabilityId, group] of groupByCapability(entries)) {
    const ownerEntries = group.filter((entry) => populated(entry.declaredOwner));
    const documents = new Set(ownerEntries.map((entry) => String(entry.documentKey ?? entry.entryId)));
    if (documents.size < 2) continue;
    findings.push(createFinding("duplicate-owner", {
      artifactReference: [...documents].sort().join(" <> "),
      evidenceExcerpt: `Capability ${capabilityId} has multiple owner documents: ${[...documents].sort().join(", ")}.`,
      statement: "Designate one canonical owner document for the capability contract.",
    }));
  }
  return findings;
}

function blendedStatuses(entries) {
  return entries.flatMap((entry) => {
    const status = populated(entry.declaredStatus);
    if (!status || !isBlendedStatus(status)) return [];
    return [createFinding("blended-status", {
      artifactReference: entrySubject(entry),
      evidenceExcerpt: status,
      statement: "Split local readiness and deployed readiness into separate fields.",
    })];
  });
}

function missingCompanions(entries) {
  const available = new Set(entries.flatMap((entry) =>
    referenceAliases(entry.documentKey)));
  const findings = [];
  for (const entry of entries) {
    for (const companion of companionsFrom(entry)) {
      if (referenceAliases(companion).some((identity) => available.has(identity))) continue;
      findings.push(createFinding("missing-companion", {
        artifactReference: entrySubject(entry),
        evidenceExcerpt: `Required companion is absent: ${companion}`,
        statement: "Add the required companion document or remove the current-authority declaration.",
      }));
    }
  }
  return findings;
}

function referenceAliases(value) {
  const populatedValue = populated(value);
  if (!populatedValue) return [];
  const leaf = populatedValue
    .split("#")[0]
    .replaceAll("\\", "/")
    .split("/")
    .at(-1)
    .replace(/\.(?:md|json|ya?ml)$/iu, "");
  const canonical = leaf.toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-|-$/gu, "");
  const semantic = canonical.replace(
    /(?:-[0-9a-f]{8,64})+$/u,
    "",
  );
  return [...new Set([canonical, semantic].filter(Boolean))];
}

function companionsFrom(entry) {
  const explicit = [
    ...arrayOf(entry.requiredCompanions),
    ...arrayOf(entry.companionDocuments),
  ].map(String);
  const excerpt = String(entry.excerpt ?? "");
  for (const match of excerpt.matchAll(
    /(?:required[_ -]companion|companion[_ -]document)\s*[:|]\s*`?([^`\n|,]+)`?/giu,
  )) {
    explicit.push(match[1].trim());
  }
  return [...new Set(explicit.filter(Boolean))].sort();
}

function isBlendedStatus(status) {
  const text = status.toLowerCase();
  const local = /\b(?:undocumented|spec-complete|dev-proven|runtime-ready|local(?:ly)?[- ]proven)\b/u.test(text);
  const deployed = /\b(?:production(?:-verified)?|deployed|deployment|prod(?:uction)? mirror|edge)\b/u.test(text);
  return local && deployed;
}

function groupByCapability(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const key = populated(entry.capabilityId) ??
      populated(entry.declaredRuntimeScope) ??
      populated(entry.documentKey) ??
      populated(entry.entryId) ??
      "unknown-capability";
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right, "en"));
}

function populated(value) {
  if (value === undefined || value === null || typeof value === "symbol") return null;
  const text = String(value).trim();
  return text || null;
}

function entrySubject(entry) {
  return populated(entry.entryId) ?? populated(entry.documentKey) ?? "-";
}

function compareEntries(left, right) {
  return entrySubject(left).localeCompare(entrySubject(right), "en");
}

function compareFindingIdentity(left, right) {
  return left.findingType.localeCompare(right.findingType, "en") ||
    left.guidelineAnchor.localeCompare(right.guidelineAnchor, "en") ||
    left.artifactReference.localeCompare(right.artifactReference, "en");
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
