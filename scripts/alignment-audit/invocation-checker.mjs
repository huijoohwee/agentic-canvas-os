import { makeFinding } from "./finding.mjs";

const ROUTE_SURFACES = new Set(["slash", "hash", "at"]);

export function checkInvocation(index = {}) {
  const entries = arrayOf(index.entries);
  const ownerDocuments = collectOwnerDocuments(entries);
  const routeMap = new Map();
  for (const entry of entries) {
    for (const route of [
      ...arrayOf(entry.invocationRoutes),
      ...routesFromExcerpt(entry.excerpt),
    ]) {
      const normalized = normalizeRoute(route);
      if (!normalized || !ROUTE_SURFACES.has(normalized.surface)) continue;
      const key = `${normalized.surface}\0${normalized.token}`;
      const record = routeMap.get(key) ?? { ...normalized, owners: new Set() };
      for (const owner of routeOwners(entry, route, ownerDocuments)) record.owners.add(owner);
      routeMap.set(key, record);
    }
  }

  const findings = [];
  let resolved = 0;
  let orphan = 0;
  let ambiguous = 0;
  for (const route of [...routeMap.values()].sort(compareRoutes)) {
    if (route.owners.size === 1) {
      resolved += 1;
    } else if (route.owners.size === 0) {
      orphan += 1;
      findings.push(createFinding("orphan-route", route.token,
        `Invocation route ${route.token} resolves to zero owner documents.`,
        "Declare exactly one owner document for this invocation route."));
    } else {
      ambiguous += 1;
      findings.push(createFinding("ambiguous-route", route.token,
        `Invocation route ${route.token} resolves to owners: ${[...route.owners].sort().join(", ")}.`,
        "Retain exactly one canonical owner document for this invocation route."));
    }
  }

  const membership = toolMembership(index, entries);
  for (const tool of membership.documented) {
    if (!membership.federated.has(tool)) {
      findings.push(createFinding("unfederated-tool", tool,
        `Tool identity is absent from the federation contract: ${tool}`,
        "Add the tool identity to the federation contract document."));
    }
    if (!membership.catalogued.has(tool)) {
      findings.push(createFinding("uncatalogued-tool", tool,
        `Tool identity is absent from the capability catalog: ${tool}`,
        "Add the tool identity to the capability catalog document."));
    }
  }

  return {
    findings: findings.sort(compareFindingIdentity),
    routeCounts: {
      documented: routeMap.size,
      resolved,
      orphan,
      ambiguous,
    },
  };
}

function normalizeRoute(route) {
  if (typeof route === "string") {
    const surface = route.startsWith("/") ? "slash" :
      route.startsWith("#") ? "hash" :
        route.startsWith("@") ? "at" : null;
    return surface ? { surface, token: route.trim() } : null;
  }
  if (!route || typeof route !== "object") return null;
  const surface = String(route.surface ?? "").toLowerCase();
  const token = String(route.token ?? route.route ?? "").trim();
  return surface && token ? { surface, token } : null;
}

function routeOwners(entry, route, ownerDocuments) {
  const explicitDocumentKeys = [
    ...arrayOf(route.ownerDocumentKeys),
    ...arrayOf(route.ownerDocumentKey),
  ].filter(populated).map(String);
  if (explicitDocumentKeys.length > 0) return explicitDocumentKeys;
  const explicitOwnerLabels = arrayOf(route.owner).filter(populated).map(String);
  if (explicitOwnerLabels.length > 0) {
    return explicitOwnerLabels.flatMap((label) => [...(ownerDocuments.get(label) ?? [])]);
  }
  const owningDocument = [entry.documentKey ?? entry.entryId].filter(populated).map(String);
  if (arrayOf(entry.ownedRoutes).some((owned) =>
    String(owned.token ?? owned) === String(route.token ?? route))) {
    return owningDocument;
  }
  if (populated(entry.declaredOwner)) {
    return owningDocument;
  }
  return [];
}

function collectOwnerDocuments(entries) {
  const owners = new Map();
  for (const entry of entries) {
    const documentKey = entry.documentKey ?? entry.entryId;
    if (!populated(documentKey)) continue;
    for (const label of arrayOf(entry.declaredOwner).filter(populated).map(String)) {
      const documents = owners.get(label) ?? new Set();
      documents.add(String(documentKey));
      owners.set(label, documents);
    }
  }
  return owners;
}

function toolMembership(index, entries) {
  const documented = new Set(arrayOf(index.documentedToolIdentities ?? index.toolIdentities).map(String));
  const federated = new Set(arrayOf(index.federatedToolIdentities).map(String));
  const catalogued = new Set(arrayOf(index.cataloguedToolIdentities).map(String));

  for (const entry of entries) {
    const role = contractRoleOf(entry);
    const tools = arrayOf(entry.toolIdentities).map(String);
    if (role === "federation") {
      for (const tool of tools) federated.add(tool);
    } else if (role === "catalog") {
      for (const tool of tools) catalogued.add(tool);
    } else {
      for (const tool of tools) documented.add(tool);
    }
    const extracted = toolsFromExcerpt(entry.excerpt);
    for (const tool of extracted.documented) documented.add(tool);
    for (const tool of extracted.federated) federated.add(tool);
    for (const tool of extracted.catalogued) catalogued.add(tool);
  }
  return {
    documented: [...documented].sort(),
    federated,
    catalogued,
  };
}

function routesFromExcerpt(excerpt) {
  const text = String(excerpt ?? "");
  const lines = text.split("\n");
  const routes = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!/^\s*\|\s*surface\s*\|\s*token\s*\|\s*owner\s*\|\s*$/iu.test(lines[index]) ||
        !/^\s*\|?(?:\s*:?-+:?\s*\|)+\s*$/u.test(lines[index + 1])) continue;
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      if (!lines[rowIndex].trim().startsWith("|")) break;
      const [surface, token, owner] = tableCells(lines[rowIndex]);
      if (surface && token) routes.push({ surface, token, owner });
    }
  }
  return routes;
}

function toolsFromExcerpt(excerpt) {
  const text = String(excerpt ?? "");
  const documented = [];
  const federated = [];
  const catalogued = [];
  for (const match of text.matchAll(
    /(?:^|\n)\s*Federation contract tool\s*:\s*`?([A-Za-z0-9._-]+)`?/giu,
  )) {
    federated.push(match[1]);
    documented.push(match[1]);
  }
  for (const match of text.matchAll(
    /(?:^|\n)\s*Capability catalog tool\s*:\s*`?([A-Za-z0-9._-]+)`?/giu,
  )) {
    catalogued.push(match[1]);
    documented.push(match[1]);
  }
  for (const route of routesFromExcerpt(text)) {
    if (String(route.surface).toLowerCase() === "mcp") documented.push(route.token);
  }
  return { documented, federated, catalogued };
}

function tableCells(line) {
  return line.trim().replace(/^\||\|$/gu, "").split("|").map((cell) =>
    cell.trim().replace(/^`|`$/gu, ""));
}

function inferContractRole(entry) {
  const documentKey = populated(entry.documentKey) ? String(entry.documentKey) : "";
  const runtimeScope = populated(entry.declaredRuntimeScope)
    ? String(entry.declaredRuntimeScope)
    : "";
  const text = `${documentKey} ${runtimeScope}`.toLowerCase();
  if (/\bfederation\b/u.test(text)) return "federation";
  if (/\b(?:capability[- ]catalog|catalog)\b/u.test(text)) return "catalog";
  return "document";
}

function contractRoleOf(entry) {
  if (!populated(entry.contractRole)) return inferContractRole(entry);
  const role = String(entry.contractRole).toLowerCase();
  if (/\bfederation\b/u.test(role)) return "federation";
  if (/\b(?:capability[- ]catalog|catalog)\b/u.test(role)) return "catalog";
  return "document";
}

function compareRoutes(left, right) {
  return left.surface.localeCompare(right.surface, "en") ||
    left.token.localeCompare(right.token, "en");
}

function populated(value) {
  return value !== undefined && value !== null && typeof value !== "symbol" &&
    String(value).trim().length > 0;
}

function arrayOf(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function compareFindingIdentity(left, right) {
  return left.findingType.localeCompare(right.findingType, "en") ||
    left.artifactReference.localeCompare(right.artifactReference, "en");
}

function createFinding(findingType, artifactReference, evidenceExcerpt, statement) {
  return makeFinding({
    findingType,
    guidelineAnchor: "-",
    artifactReference,
    evidenceExcerpt,
    remediation: {
      class: "documentation-change",
      statement,
      state: "proposed",
      operatorInstructionRef: null,
    },
  });
}
