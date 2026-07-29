import {
  ABSENT,
  ARTIFACT_ENTRY_KINDS,
  createArtifactIndex,
  INVOCATION_SURFACES,
} from "./artifact-index.mjs";
import { frontmatterValue, scanFrontmatter } from "./frontmatter.mjs";
import { extractDeclaredElementIds } from "./element-linkage.mjs";
import { makeFinding } from "./finding.mjs";
import {
  contentDigest,
  documentKeyFrom,
  entryIdFrom,
  normalizeContent,
  slugify,
} from "./normalize.mjs";

const FIELD_ALIASES = Object.freeze({
  capabilityId: ["capability_id", "capabilityId", "capability", "feature"],
  status: ["status", "readiness", "readiness_status", "readinessLevel"],
  scope: ["runtime_scope", "runtimeScope", "scope"],
  owner: ["owner", "contract_owner", "contractOwner"],
  proof: ["proof_reference", "proofReference", "proof", "evidence_reference"],
  schema: ["contract_schema", "contractSchema", "schema"],
  command: ["validation_command", "validationCommand", "check_command", "command"],
  routes: ["invocation_routes", "invocationRoutes", "routes"],
  tools: ["tool_identities", "toolIdentities", "mcp_tools", "mcpTools"],
  contractRole: ["contract_role", "contractRole", "doc_type", "docType"],
});

export function buildArtifactIndex(docs, ladder = []) {
  const prepared = prepareDocuments(docs);
  const entries = [];
  const findings = [];
  const validStatuses = new Set((ladder ?? []).map(String));

  for (const document of prepared) {
    if (document.readState !== "ok") continue;
    const declarations = extractDeclarations(document);
    const ambient = ambientFields(document, declarations);
    const invocation = extractInvocationMetadata(document, declarations);
    const documentEntry = makeEntry(document, {
      entryKind: "markdown-document",
      discriminator: ["document", document.digest],
      excerpt: document.body,
      ...ambient,
      invocationRoutes: invocation.routes,
      toolIdentities: invocation.tools,
      federatedToolIdentities: invocation.federated,
      cataloguedToolIdentities: invocation.catalogued,
      documentedStageOrder: extractStageOrder(document.body),
    });
    entries.push(documentEntry);

    for (const declaration of declarations) {
      if (!["contract-schema", "validation-command", "readiness-status"].includes(declaration.kind)) {
        continue;
      }
      const rowAmbient = {
        capabilityId: present(declaration.fields.capabilityId, ambient.capabilityId),
        declaredRuntimeScope: present(declaration.fields.scope, ambient.declaredRuntimeScope),
        declaredOwner: present(declaration.fields.owner, ambient.declaredOwner),
        declaredProofReference: present(declaration.fields.proof, ambient.declaredProofReference),
        contractRole: ambient.contractRole,
      };
      const entry = makeEntry(document, {
        entryKind: declaration.kind,
        discriminator: [declaration.kind, declaration.position, declaration.value],
        excerpt: declaration.excerpt,
        declaredStatus:
          declaration.kind === "readiness-status" ? declaration.value : ambient.declaredStatus,
        commandText:
          declaration.kind === "validation-command" ? declaration.value : ABSENT,
        invocationRoutes: [],
        toolIdentities: [],
        federatedToolIdentities: [],
        cataloguedToolIdentities: [],
        documentedStageOrder: [],
        ...rowAmbient,
      });
      entries.push(entry);
      if (
        declaration.kind === "readiness-status" &&
        !validStatuses.has(declaration.value)
      ) {
        findings.push(
          makeFinding({
            findingType: "unknown-status",
            guidelineAnchor: "-",
            artifactReference: entry.entryId,
            evidenceExcerpt: `Unknown declared status: ${declaration.value}`,
            remediation: {
              class: "documentation-change",
              statement: `Replace ${declaration.value} with a configured Readiness_Level or extend the configured ladder.`,
            },
          }),
        );
      }
    }
  }

  return {
    value: createArtifactIndex(entries),
    findings: findings.sort(
      (left, right) =>
        left.artifactReference.localeCompare(right.artifactReference, "en") ||
        left.evidenceExcerpt.localeCompare(right.evidenceExcerpt, "en"),
    ),
  };
}

export function parseArtifactIndexMarkdown(text) {
  const scanned = scanFrontmatter(text);
  if (scanned.readState !== "ok") {
    return { value: createArtifactIndex(), findings: [], errors: [scanned.error] };
  }
  if (frontmatterValue(scanned.frontmatter, "index_schema") !== "artifact-index/v1") {
    return {
      value: createArtifactIndex(),
      findings: [],
      errors: ["unsupported or missing index_schema"],
    };
  }

  try {
    return { value: createArtifactIndex(parseIndexBody(scanned.body)), findings: [] };
  } catch (error) {
    return {
      value: createArtifactIndex(),
      findings: [],
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function prepareDocuments(docs) {
  const candidates = [...(docs ?? [])].map((doc) => prepareDocument(doc));
  const occupied = new Set();
  for (const candidate of [...candidates].sort((left, right) =>
    `${left.requestedKey}\0${left.digest}`.localeCompare(
      `${right.requestedKey}\0${right.digest}`,
      "en",
    ),
  )) {
    let key = candidate.requestedKey;
    if (occupied.has(key)) key = documentKeyFrom(candidate.frontmatter ?? {}, candidate.body, occupied);
    candidate.documentKey = key;
    occupied.add(key);
  }
  return candidates.sort((left, right) => left.documentKey.localeCompare(right.documentKey, "en"));
}

function prepareDocument(doc) {
  const source = typeof doc === "string" ? { text: doc } : { ...(doc ?? {}) };
  const rawText = source.text ?? source.content;
  let frontmatter = source.frontmatter instanceof Map
    ? new Map(source.frontmatter)
    : source.frontmatter && typeof source.frontmatter === "object"
      ? new Map(Object.entries(source.frontmatter))
      : null;
  let body = typeof source.body === "string" ? normalizeContent(source.body) : "";
  let readState = source.readState ?? "ok";
  if (typeof rawText === "string" && frontmatter === null) {
    const scanned = scanFrontmatter(rawText);
    frontmatter = scanned.frontmatter;
    body = scanned.body;
    readState = source.readState ?? scanned.readState;
  } else if (frontmatter === null) {
    readState = source.readState ?? "malformed";
  }
  const digest = contentDigest(typeof rawText === "string" ? rawText : body);
  const requestedKey = source.documentKey
    ? String(source.documentKey)
    : documentKeyFrom(frontmatter ?? {}, body || digest);
  return {
    requestedKey,
    documentKey: requestedKey,
    inputRole: String(source.inputRole ?? "runtime"),
    contractRole: source.contractRole,
    frontmatter,
    body,
    readState,
    digest,
  };
}

function ambientFields(document, declarations) {
  const declared = (name) => declaredFrontmatter(document.frontmatter, FIELD_ALIASES[name]);
  const first = (kind) => declarations.find((declaration) => declaration.kind === kind)?.value;
  const firstField = (name) =>
    declarations.map((item) => item.fields[name]).find((value) => value !== undefined);
  const scope = present(declared("scope"), firstField("scope"));
  const capabilityId = present(
    declared("capabilityId"),
    firstField("capabilityId"),
    scope,
    document.documentKey,
  );
  return {
    capabilityId,
    declaredStatus: present(declared("status"), first("readiness-status")),
    declaredRuntimeScope: scope,
    declaredOwner: present(declared("owner"), firstField("owner")),
    declaredProofReference: present(declared("proof"), firstField("proof")),
    commandText: ABSENT,
    contractRole: canonicalContractRole(present(document.contractRole, declared("contractRole"))),
    elementIds: extractDeclaredElementIds(document.frontmatter, document.body),
  };
}

function extractDeclarations(document) {
  const declarations = [];
  const push = (kind, value, position, excerpt, fields = {}) => {
    const declaredValue = unwrapDeclared(value);
    if (declaredValue === "") return;
    declarations.push({ kind, value: declaredValue, position, excerpt, fields });
  };

  for (const [kind, aliases] of [
    ["contract-schema", FIELD_ALIASES.schema],
    ["validation-command", FIELD_ALIASES.command],
    ["readiness-status", FIELD_ALIASES.status],
  ]) {
    const value = declaredFrontmatter(document.frontmatter, aliases);
    if (value !== undefined) push(kind, value, `frontmatter:${aliases[0]}`, `${aliases[0]}: ${value}`);
  }

  const lines = document.body.split("\n");
  for (const [index, line] of lines.entries()) {
    const label = /^\s*(?:[-*+]\s+)?(?:\*\*)?([A-Za-z][A-Za-z _-]*?)(?:\*\*)?\s*:\s*(.+?)\s*$/u.exec(line);
    if (!label) continue;
    const key = slugify(label[1], "").replace(/-/gu, "_");
    const fields = {};
    for (const [name, aliases] of Object.entries(FIELD_ALIASES)) {
      if (aliases.some((alias) => slugify(alias, "").replace(/-/gu, "_") === key)) {
        fields[name] = unwrapDeclared(label[2]);
      }
    }
    if (fields.schema !== undefined) push("contract-schema", fields.schema, index, line, fields);
    if (fields.command !== undefined) push("validation-command", fields.command, index, line, fields);
    if (fields.status !== undefined) push("readiness-status", fields.status, index, line, fields);
    if (Object.keys(fields).length > 0 &&
        fields.schema === undefined &&
        fields.command === undefined &&
        fields.status === undefined) {
      push("ambient", label[2], index, line, fields);
    }
  }

  for (const table of parseTables(lines)) {
    for (const row of table.rows) {
      const fields = fieldsFromRow(row.values);
      if (fields.schema !== undefined) push("contract-schema", fields.schema, row.lineIndex, row.raw, fields);
      if (fields.command !== undefined) push("validation-command", fields.command, row.lineIndex, row.raw, fields);
      if (fields.status !== undefined) push("readiness-status", fields.status, row.lineIndex, row.raw, fields);
      if (Object.keys(fields).length > 0 &&
          fields.schema === undefined &&
          fields.command === undefined &&
          fields.status === undefined) {
        push("ambient", Object.values(fields)[0], row.lineIndex, row.raw, fields);
      }
    }
  }
  return declarations.sort((left, right) =>
    String(left.position).localeCompare(String(right.position), "en", { numeric: true }),
  );
}

function makeEntry(document, input) {
  const entryKind = input.entryKind;
  if (!ARTIFACT_ENTRY_KINDS.includes(entryKind)) throw new TypeError(`invalid entry kind ${entryKind}`);
  return {
    entryId: entryIdFrom(document.documentKey, entryKind, input.discriminator),
    documentKey: document.documentKey,
    entryKind,
    capabilityId: present(input.capabilityId, document.documentKey),
    declaredStatus: present(input.declaredStatus),
    declaredRuntimeScope: present(input.declaredRuntimeScope),
    declaredOwner: present(input.declaredOwner),
    declaredProofReference: present(input.declaredProofReference),
    commandText: present(input.commandText),
    contractRole: present(input.contractRole),
    elementIds: input.elementIds ?? [],
    invocationRoutes: input.invocationRoutes ?? [],
    toolIdentities: input.toolIdentities ?? [],
    federatedToolIdentities: input.federatedToolIdentities ?? [],
    cataloguedToolIdentities: input.cataloguedToolIdentities ?? [],
    documentedStageOrder: input.documentedStageOrder ?? [],
    excerpt: input.excerpt ?? "",
  };
}

function extractInvocationMetadata(document, declarations) {
  const values = [];
  const frontmatterRoutes = declaredFrontmatter(document.frontmatter, FIELD_ALIASES.routes);
  if (frontmatterRoutes !== undefined) values.push(frontmatterRoutes);
  for (const declaration of declarations) {
    if (declaration.fields.routes !== undefined) values.push(declaration.fields.routes);
  }
  for (const line of document.body.split("\n")) {
    const match = /^\s*(?:[-*+]\s+)?(?:invocation routes?|routes?|slash routes?|hash tags?|at bindings?|mcp routes?)\s*:\s*(.+)$/iu.exec(line);
    if (match) values.push(match[1]);
  }
  const routes = [];
  for (const value of values) routes.push(...parseRoutes(value));
  for (const table of parseTables(document.body.split("\n"))) {
    if (!table.headers.includes("surface") || !table.headers.includes("token")) continue;
    for (const row of table.rows) {
      const surface = unwrapDeclared(row.values.surface).toLocaleLowerCase("en-US");
      const token = unwrapDeclared(row.values.token);
      const owner = unwrapDeclared(row.values.owner ?? "");
      if (INVOCATION_SURFACES.includes(surface) && token) {
        routes.push(owner ? { surface, token, owner } : { surface, token });
      }
    }
  }

  const toolValues = [];
  const frontmatterTools = declaredFrontmatter(document.frontmatter, FIELD_ALIASES.tools);
  if (frontmatterTools !== undefined) toolValues.push(frontmatterTools);
  for (const declaration of declarations) {
    if (declaration.fields.tools !== undefined) toolValues.push(declaration.fields.tools);
  }
  const federated = [];
  const catalogued = [];
  for (const line of document.body.split("\n")) {
    const match = /^\s*(?:[-*+]\s+)?(?:mcp tools?|tool identities)\s*:\s*(.+)$/iu.exec(line);
    if (match) toolValues.push(match[1]);
    const federation = /^\s*Federation contract tool\s*:\s*(.+)$/iu.exec(line);
    if (federation) federated.push(unwrapDeclared(federation[1]));
    const catalog = /^\s*Capability catalog tool\s*:\s*(.+)$/iu.exec(line);
    if (catalog) catalogued.push(unwrapDeclared(catalog[1]));
  }
  const mcpRoutes = routes
    .filter((route) => route.surface === "mcp")
    .map((route) => route.token);
  const tools = [
    ...toolValues.flatMap(splitList).map(unwrapDeclared),
    ...federated,
    ...catalogued,
    ...mcpRoutes,
  ].filter(Boolean);
  return {
    routes,
    tools: [...new Set(tools)],
    federated: [...new Set(federated)],
    catalogued: [...new Set(catalogued)],
  };
}

function parseRoutes(value) {
  const text = String(value);
  const routes = [];
  for (const match of text.matchAll(/(?:^|[\s,])mcp:([A-Za-z0-9_.:/-]+)/giu)) {
    routes.push({ surface: "mcp", token: match[1] });
  }
  for (const [surface, pattern] of [
    ["slash", /(?:^|[\s,])(\/[A-Za-z0-9][A-Za-z0-9._~:/-]*)/gu],
    ["hash", /(?:^|[\s,])(#[A-Za-z0-9][A-Za-z0-9._~-]*)/gu],
    ["at", /(?:^|[\s,])(@[A-Za-z0-9][A-Za-z0-9._~-]*)/gu],
  ]) {
    for (const match of text.matchAll(pattern)) routes.push({ surface, token: match[1] });
  }
  return routes.filter((route) => INVOCATION_SURFACES.includes(route.surface));
}

function parseTables(lines) {
  const tables = [];
  for (let index = 0; index + 1 < lines.length; index += 1) {
    if (!/^\s*\|.*\|\s*$/u.test(lines[index])) continue;
    if (!/^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/u.test(lines[index + 1])) continue;
    const headers = splitTableRow(lines[index]).map((header) =>
      slugify(header, "").replace(/-/gu, "_"),
    );
    const rows = [];
    let rowIndex = index + 2;
    while (rowIndex < lines.length && /^\s*\|.*\|\s*$/u.test(lines[rowIndex])) {
      const cells = splitTableRow(lines[rowIndex]);
      const values = Object.fromEntries(headers.map((header, cell) => [header, cells[cell] ?? ""]));
      rows.push({ values, raw: lines[rowIndex], lineIndex: rowIndex });
      rowIndex += 1;
    }
    tables.push({ headers, rows });
    index = rowIndex - 1;
  }
  return tables;
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\||\|$/gu, "")
    .split(/(?<!\\)\|/u)
    .map((cell) => cell.trim().replace(/\\\|/gu, "|"));
}

function fieldsFromRow(row) {
  const fields = {};
  for (const [name, aliases] of Object.entries(FIELD_ALIASES)) {
    const keys = aliases.map((alias) => slugify(alias, "").replace(/-/gu, "_"));
    const value = keys.map((key) => row[key]).find((candidate) => candidate !== undefined);
    if (value !== undefined && value !== "") fields[name] = unwrapDeclared(value);
  }
  return fields;
}

function declaredFrontmatter(frontmatter, aliases) {
  for (const alias of aliases) {
    const value = frontmatterValue(frontmatter, alias);
    if (value !== undefined) return unwrapDeclared(value);
  }
  return undefined;
}

function present(...values) {
  const value = values.find(
    (candidate) => candidate !== undefined && candidate !== null && candidate !== ABSENT,
  );
  return value === undefined ? ABSENT : value;
}

function canonicalContractRole(value) {
  if (value === ABSENT || value === undefined || value === null) return ABSENT;
  const role = slugify(String(value), "");
  if (role.includes("federation")) return "federation";
  if (role === "catalog" || role.includes("capability-catalog")) return "catalog";
  return "document";
}

function unwrapDeclared(value) {
  const text = String(value ?? "").trim();
  if (
    (text.startsWith("`") && text.endsWith("`")) ||
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

function splitList(value) {
  return String(value)
    .replace(/^\[|\]$/gu, "")
    .split(/\s*,\s*|\s*;\s*/u);
}

function extractStageOrder(body) {
  const lines = String(body).split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\s*stage_order\s*:\s*(.*)$/iu.exec(lines[index]);
    if (!match) continue;
    const parts = [match[1]];
    while (index + 1 < lines.length && lines[index + 1].trim() !== "") {
      index += 1;
      parts.push(lines[index].trim());
    }
    return parts
      .join(" ")
      .split(/\s*,\s*/u)
      .map(unwrapDeclared)
      .filter(Boolean);
  }
  return [];
}

function parseIndexBody(body) {
  const lines = normalizeContent(body).split("\n");
  const entries = [];
  let index = 0;
  while (index < lines.length) {
    const match = /^## Entry: (.+)$/u.exec(lines[index]);
    if (!match) {
      index += 1;
      continue;
    }
    const fields = readFieldTable(lines, index + 1);
    const fenced = {};
    index = fields.nextIndex;
    while (true) {
      index = nextNonEmpty(lines, index);
      const fenceMatch = /^(~{3,})value:([a-z_]+)$/u.exec(lines[index] ?? "");
      if (!fenceMatch) break;
      const block = readFence(lines, index, fenceMatch[1]);
      fenced[fenceMatch[2]] = block.value;
      index = block.nextIndex;
    }
    index = nextNonEmpty(lines, index);
    const excerptFence = /^(~{3,})excerpt$/u.exec(lines[index] ?? "");
    if (!excerptFence) throw new Error(`missing excerpt for ${match[1]}`);
    const excerpt = readFence(lines, index, excerptFence[1]);
    entries.push({
      entryId: match[1],
      documentKey: parseScalarField("document_key", fields.values, fenced),
      entryKind: parseScalarField("entry_kind", fields.values, fenced),
      capabilityId: parseScalarField("capability_id", fields.values, fenced),
      declaredStatus: parseScalarField("declared_status", fields.values, fenced),
      declaredRuntimeScope: parseScalarField("declared_runtime_scope", fields.values, fenced),
      declaredOwner: parseScalarField("declared_owner", fields.values, fenced),
      declaredProofReference: parseScalarField("declared_proof_reference", fields.values, fenced),
      commandText: parseScalarField("command_text", fields.values, fenced),
      contractRole: parseScalarField("contract_role", fields.values, fenced),
      elementIds: parseTokenListField(
        fields.values.element_ids,
        fenced.element_ids,
      ),
      invocationRoutes: parseRouteList(fields.values.invocation_routes, fenced),
      toolIdentities: parseTokenListField(
        fields.values.tool_identities,
        fenced.tool_identities,
      ),
      documentedStageOrder: parseTokenListField(
        fields.values.documented_stage_order,
        fenced.documented_stage_order,
      ),
      federatedToolIdentities: parseTokenListField(
        fields.values.federated_tool_identities,
        fenced.federated_tool_identities,
      ),
      cataloguedToolIdentities: parseTokenListField(
        fields.values.catalogued_tool_identities,
        fenced.catalogued_tool_identities,
      ),
      excerpt: excerpt.value,
    });
    index = excerpt.nextIndex;
  }
  return entries;
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

function readFence(lines, startIndex, fence) {
  let close = startIndex + 1;
  while (close < lines.length && lines[close] !== fence) close += 1;
  if (close >= lines.length) throw new Error(`unterminated ${lines[startIndex]} fence`);
  return { value: lines.slice(startIndex + 1, close).join("\n"), nextIndex: close + 1 };
}

function parseScalarField(name, values, fenced) {
  const value = values[name];
  if (value === "(absent)" || value === undefined) return ABSENT;
  if (value === "(empty)") return "";
  if (value === `(fenced:${name})`) return fenced[name] ?? "";
  return /^`[\s\S]*`$/u.test(value) ? value.slice(1, -1) : value;
}

function parseRouteList(value, fenced) {
  if (value === "(fenced:invocation_routes)") {
    return JSON.parse(fenced.invocation_routes ?? "[]");
  }
  return parseTokenList(value).map((pair) => {
    const separator = pair.indexOf(":");
    return { surface: pair.slice(0, separator), token: pair.slice(separator + 1) };
  });
}

function parseTokenListField(value, fencedValue) {
  if (/^\(fenced:[a-z_]+\)$/u.test(value ?? "")) {
    return JSON.parse(fencedValue ?? "[]");
  }
  return parseTokenList(value);
}

function parseTokenList(value) {
  if (!value || value === "(none)") return [];
  return [...value.matchAll(/`((?:``|[^`])*)`/gu)].map((match) =>
    match[1].replace(/``/gu, "`"),
  );
}

function nextNonEmpty(lines, start) {
  let index = start;
  while (index < lines.length && lines[index].trim() === "") index += 1;
  return index;
}
