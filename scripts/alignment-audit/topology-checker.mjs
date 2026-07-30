import { makeFinding } from "./finding.mjs";
import { collectDeployMutationMatches } from "./deploy-gate.mjs";

const REQUIRED_LANES = Object.freeze(["development", "production-mirror", "edge-delivery"]);

export function checkTopology(docs = [], index = {}, operatorInstruction = null) {
  const findings = [];
  const lanes = collectLanes(docs, index);
  for (const lane of REQUIRED_LANES) {
    if (lanes.has(lane)) continue;
    findings.push(createFinding("missing-lane", {
      guidelineAnchor: `lane:${lane}`,
      artifactReference: "lane-topology",
      evidenceExcerpt: `Missing Lane declaration: ${lane}`,
      statement: `Document the ${lane} Lane.`,
    }));
  }

  for (const transition of collectTransitions(docs, index)) {
    const missing = [
      !populated(transition.deployBoundary ?? transition.boundary) && "Deploy_Boundary",
      !populated(transition.evidenceReference ?? transition.evidence) && "Evidence_Reference",
      !populated(transition.rollback ?? transition.rollbackStatement) && "rollback statement",
    ].filter(Boolean);
    if (missing.length > 0) {
      findings.push(createFinding("incomplete-lane-transition", {
        guidelineAnchor: `transition:${transition.id ?? transition.name ?? "lane-transition"}`,
        artifactReference: transition.id ?? transition.name ?? "lane-transition",
        evidenceExcerpt: `Lane transition omits: ${missing.join(", ")}.`,
        statement: "Document the named boundary, evidence reference, and rollback statement.",
      }));
    }
    if (!requiresOperatorApproval(
      transition.operatorApproval ?? transition.approvalStatement,
    )) {
      findings.push(createFinding("ungated-promotion", {
        guidelineAnchor: `transition:${transition.id ?? transition.name ?? "lane-transition"}`,
        artifactReference: transition.id ?? transition.name ?? "lane-transition",
        evidenceExcerpt: "Lane transition omits an explicit operator approval statement.",
        statement: "Require an explicit operator instruction before promotion.",
      }));
    }
  }

  for (const node of collectNodes(docs, index)) {
    const missing = [
      !populated(node.connectionType ?? node.connection) && "connection type",
      !populated(node.dataResidency ?? node.residency) && "data residency",
    ].filter(Boolean);
    if (missing.length === 0 && !node.membershipIssue) continue;
    findings.push(createFinding("incomplete-topology-node", {
      guidelineAnchor: `node:${node.id ?? node.name ?? node.component ?? "topology-node"}`,
      artifactReference: node.id ?? node.name ?? node.component ?? "topology-node",
      evidenceExcerpt: node.membershipIssue ??
        `Topology node omits: ${missing.join(", ")}.`,
      statement: "Record both connection type and data residency for this runtime component.",
    }));
  }

  for (const breach of collectBoundaryBreaches(docs)) {
    findings.push(createFinding("deploy-boundary-breach", {
      artifactReference: breach.subject,
      evidenceExcerpt: breach.statement,
      statement: "Remove production or edge mutation from the development command and require a governed deploy boundary.",
    }));
  }

  return {
    findings: findings.sort(compareFindingIdentity),
    deployBoundaryState: hasInstruction(operatorInstruction) ? "open" : "closed",
  };
}

function collectLanes(docs, index) {
  const lanes = new Set();
  for (const candidate of [
    ...docs.flatMap((doc) => arrayOf(doc.lanes)),
    ...arrayOf(index.lanes),
    ...arrayOf(index.entries).flatMap((entry) => arrayOf(entry.lanes)),
  ]) {
    const normalized = normalizeLane(candidate.name ?? candidate.id ?? candidate);
    if (normalized) lanes.add(normalized);
  }
  for (const doc of docs) {
    const content = documentContent(doc);
    for (const lane of REQUIRED_LANES) {
      if (lanePattern(lane).test(content)) lanes.add(lane);
    }
    for (const table of markdownTables(content)) {
      const laneIndex = headerIndex(table.headers, /^lane$/u);
      if (laneIndex < 0) continue;
      for (const row of table.rows) {
        const normalized = normalizeLane(row[laneIndex]);
        if (normalized) lanes.add(normalized);
      }
    }
  }
  return lanes;
}

function collectTransitions(docs, index) {
  const structured = [
    ...docs.flatMap((doc) => arrayOf(doc.transitions ?? doc.laneTransitions)),
    ...arrayOf(index.transitions ?? index.laneTransitions),
    ...arrayOf(index.entries).flatMap((entry) =>
      arrayOf(entry.transitions ?? entry.laneTransitions)),
  ];
  for (const doc of docs) {
    const content = documentContent(doc);
    structured.push(...declaredTransitions(content));
    for (const table of markdownTables(content)) {
      const transitionIndex = headerIndex(table.headers, /^transition$/u);
      if (transitionIndex < 0) continue;
      const boundaryIndex = headerIndex(table.headers, /^deploy_boundary$/u);
      const evidenceIndex = headerIndex(table.headers, /^evidence_reference$/u);
      const rollbackIndex = headerIndex(table.headers, /^rollback$/u);
      const approvalIndex = headerIndex(table.headers, /^operator_approval$/u);
      for (const row of table.rows) {
        structured.push({
          id: row[transitionIndex],
          deployBoundary: cellAt(row, boundaryIndex),
          evidenceReference: cellAt(row, evidenceIndex),
          rollback: cellAt(row, rollbackIndex),
          operatorApproval: cellAt(row, approvalIndex),
        });
      }
    }
  }
  return structured;
}

function declaredTransitions(content) {
  const transitions = [];
  for (const line of String(content).split("\n")) {
    if (/^\s*\|/u.test(line) || isTransitionMetarule(line)) continue;
    const labelled = /^\s*(?:[-*]\s*)?(?:lane\s+)?transition\s*:\s*(.+?)\s*$/iu
      .exec(line);
    if (labelled) {
      transitions.push({ id: labelled[1] });
      continue;
    }
    const prose = /\b(?:transition|promotion)\s+from\s+(.+?)\s+to\s+(.+?)(?:[.;]|$)/iu
      .exec(line);
    if (prose) transitions.push({ id: `${prose[1]} -> ${prose[2]}` });
  }
  return transitions;
}

function isTransitionMetarule(line) {
  return /\b(?:when|if)\s+(?:an? )?(?:audited |documented )?(?:lane )?transition\b/iu
    .test(line) ||
    /\b(?:checker|finding|acceptance criterion|requirement)\b/iu.test(line);
}

function collectNodes(docs, index) {
  const tableNodes = [
    ...docs.flatMap((doc) => arrayOf(doc.topologyNodes)),
    ...arrayOf(index.topologyNodes),
    ...arrayOf(index.entries).flatMap((entry) => arrayOf(entry.topologyNodes)),
  ];
  const declared = [
    ...docs.flatMap((doc) => arrayOf(doc.runtimeComponents)),
    ...arrayOf(index.runtimeComponents),
    ...arrayOf(index.entries).flatMap((entry) => arrayOf(entry.runtimeComponents)),
  ].map(componentIdentity).filter(Boolean);
  for (const candidate of [
    ...docs.flatMap((doc) => arrayOf(doc.runtimeComponents)),
    ...arrayOf(index.runtimeComponents),
    ...arrayOf(index.entries).flatMap((entry) => arrayOf(entry.runtimeComponents)),
  ]) {
    if (typeof candidate === "object" &&
        populated(candidate.connectionType ?? candidate.connection) &&
        populated(candidate.dataResidency ?? candidate.residency)) {
      tableNodes.push(candidate);
    }
  }
  for (const doc of docs) {
    const content = documentContent(doc);
    declared.push(...declaredComponents(content));
    for (const table of markdownTables(content)) {
      const componentIndex = headerIndex(table.headers, /^component$/u);
      if (componentIndex < 0) continue;
      const connectionIndex = headerIndex(table.headers, /^connection_type$/u);
      const residencyIndex = headerIndex(table.headers, /^data_residency$/u);
      for (const row of table.rows) {
        tableNodes.push({
          id: row[componentIndex],
          connectionType: cellAt(row, connectionIndex),
          dataResidency: cellAt(row, residencyIndex),
        });
      }
    }
  }
  const normalizedNodes = tableNodes.map(normalizeTopologyNode);
  const counts = new Map();
  for (const node of normalizedNodes) {
    const key = normalizeComponentIdentity(componentIdentity(node));
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const membershipFindings = [];
  for (const component of [...new Set(declared.map(normalizeComponentIdentity).filter(Boolean))]) {
    const count = counts.get(component) ?? 0;
    if (count === 1) continue;
    membershipFindings.push({
      id: component,
      membershipIssue: count === 0
        ? `Runtime component ${component} is absent from the topology table.`
        : `Runtime component ${component} appears in ${count} topology table rows.`,
    });
  }
  return [...normalizedNodes, ...membershipFindings];
}

function declaredComponents(content) {
  const text = String(content);
  const components = [];
  for (const line of text.split("\n")) {
    if (/^\s*\|/u.test(line) || isComponentMetarule(line)) continue;
    const labelled = /^\s*(?:[-*]\s*)?(?:runtime\s+)?component\s*:\s*(.+?)\s*$/iu
      .exec(line);
    if (labelled) components.push(labelled[1]);
    const prose = /\bThe\s+(.+?)\s+is\s+(?:an?\s+)?runtime\s+component\b/iu
      .exec(line);
    if (prose) components.push(prose[1]);
  }
  return components.map(componentIdentity).filter(Boolean);
}

function isComponentMetarule(line) {
  return /\b(?:when|if)\s+(?:an? )?(?:audited |documented )?(?:runtime )?component\b/iu
    .test(line) ||
    /\b(?:checker|finding|acceptance criterion|requirement)\b/iu.test(line);
}

function normalizeTopologyNode(value) {
  if (value && typeof value === "object") return value;
  return { id: componentIdentity(value) };
}

function componentIdentity(value) {
  if (value && typeof value === "object") {
    return String(value.id ?? value.name ?? value.component ?? "").trim();
  }
  return String(value ?? "").trim();
}

function normalizeComponentIdentity(value) {
  return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function collectBoundaryBreaches(docs) {
  const breaches = [];
  for (const doc of docs) {
    const subject = String(doc.documentKey ?? doc.id ?? "document");
    for (const command of arrayOf(doc.developmentCommands)) {
      const statement = String(command.statement ?? command.command ?? command);
      if (isBoundaryBreach(statement)) breaches.push({ subject, statement });
    }
    for (const statement of boundaryBreachStatements(documentContent(doc))) {
      breaches.push({ subject, statement });
    }
  }
  const unique = new Map(breaches.map((breach) =>
    [`${breach.subject}\0${breach.statement}`, breach]));
  return [...unique.values()].sort((left, right) =>
    left.subject.localeCompare(right.subject, "en") ||
    left.statement.localeCompare(right.statement, "en"));
}

function isBoundaryBreach(statement, context = "") {
  const text = String(statement);
  if (isBoundaryMetarule(text)) return false;
  const scope = `${String(context)} ${text}`;
  const development = /\b(?:development|dev) (?:commands?|scripts?|operations?)\b/iu
    .test(scope);
  const target = /\b(?:production(?: surface| mirror)?|prod mirror|edge(?: surface| delivery)?)\b/iu
    .test(scope);
  if (!development || !target) return false;
  return collectDeployMutationMatches(text).some((match) =>
    !mutationIsNegated(text, match.index ?? 0));
}

function isBoundaryMetarule(statement) {
  return /\b(?:deploy-boundary-breach|Finding(?:_Type)?|acceptance criterion|checker|detect(?:ion|s|ed)?)\b/iu
    .test(statement) ||
    /\b(?:when|if)\s+(?:an? )?(?:audited )?document\b/iu.test(statement) ||
    /^\s*(?:["'`]|(?:const|let|return|assert|body|statement|evidenceExcerpt)\s*[:=])/iu
      .test(statement);
}

function boundaryBreachStatements(content) {
  const lines = String(content).split("\n");
  const candidates = lines.filter((line) => line.trim()).map((line) => line.trim());
  const sectionCandidates = [];
  let heading = "";
  let body = [];
  const flush = () => {
    if (heading && body.length > 0) {
      const statement = body.join(" ");
      if (isBoundaryBreach(statement, heading)) sectionCandidates.push(statement);
    }
    body = [];
  };
  for (const line of lines) {
    const match = /^#{1,6}\s+(.+?)\s*$/u.exec(line);
    if (match) {
      flush();
      heading = match[1].trim();
    } else if (heading) {
      if (line.trim()) body.push(line.trim());
    }
  }
  flush();
  return [...new Set([
    ...candidates.filter((statement) => isBoundaryBreach(statement)),
    ...sectionCandidates,
  ])];
}

function mutationIsNegated(statement, index) {
  const prefix = statement.slice(Math.max(0, index - 64), index);
  return /(?:\b(?:do(?:es)?|must|shall|will|can|may)\s+not|\bnever)\s+(?:[\p{Letter}\p{Number}_-]+\s+){0,2}$/iu
    .test(prefix) ||
    /\b(?:cannot|can't)\s+(?:[\p{Letter}\p{Number}_-]+\s+){0,2}$/iu.test(prefix) ||
    /\b(?:forbid\w*|prohibit\w*|prevent\w*)\s+(?:(?:[\p{Letter}\p{Number}_-]+|from)\s+){0,3}$/iu
      .test(prefix) ||
    /\brefus\w*\s+to\s+(?:[\p{Letter}\p{Number}_-]+\s+){0,2}$/iu.test(prefix) ||
    /\bno\s+(?:development|dev)\s+(?:commands?|scripts?|operations?)\s+(?:[\p{Letter}\p{Number}_-]+\s+){0,2}$/iu
      .test(prefix);
}

function requiresOperatorApproval(value) {
  if (!populated(value)) return false;
  if (typeof value === "object") {
    const statement = value.statement ?? value.required;
    if (populated(statement) && !requiresOperatorApproval(statement)) return false;
    return populated(
      value.instructionReference ?? value.operatorInstructionRef ??
      value.reference ?? value.id,
    ) || requiresOperatorApproval(statement);
  }
  const text = String(value).trim().toLowerCase();
  if (/^(?:none|no|false|not required|optional|automatic(?:ally)?|waived)$/u.test(text) ||
      approvalIsDisclaimed(text)) {
    return false;
  }
  if (/^(?:required|yes|true)$/u.test(text)) return true;
  const approvalSubject = /\b(?:operator\s+(?:approval|instruction)|approval)\b/u;
  const explicitRequirement =
    /\b(?:explicit(?:ly)?|mandatory|required?|requires?|must|shall)\b/u;
  return approvalSubject.test(text) && explicitRequirement.test(text);
}

function approvalIsDisclaimed(text) {
  const subject = String.raw`(?:operator\s+)?(?:approval|instruction)`;
  return new RegExp(
    String.raw`\b(?:automatic(?:ally)?|optional(?:ly)?)\s+${subject}\b`,
    "u",
  ).test(text) ||
    new RegExp(
      String.raw`\b${subject}\s+(?:(?:is|remains?)\s+)?(?:automatic|optional|waived|absent|not\s+required)\b`,
      "u",
    ).test(text) ||
    new RegExp(
      String.raw`\b(?:no|without)\s+${subject}\b|\bdoes\s+not\s+require\s+${subject}\b`,
      "u",
    ).test(text) ||
    new RegExp(
      String.raw`\b${subject}\s+(?:is|must|shall|should|will|can)\s+(?:(?:never|not)\s+(?:be\s+)?required|(?:be\s+)?(?:waived|absent|automatic|optional))\b`,
      "u",
    ).test(text);
}

function normalizeLane(value) {
  const text = String(value ?? "").trim().toLowerCase().replace(/[_ ]+/gu, "-");
  if (/^(?:dev|development)$/u.test(text)) return "development";
  if (/^(?:prod(?:uction)?-mirror|production)$/u.test(text)) return "production-mirror";
  if (/^(?:edge|edge-delivery)$/u.test(text)) return "edge-delivery";
  return null;
}

function lanePattern(lane) {
  return {
    development: /\bdevelopment Lane\b/iu,
    "production-mirror": /\bproduction mirror Lane\b/iu,
    "edge-delivery": /\bedge delivery Lane\b/iu,
  }[lane];
}

function markdownTables(content) {
  const lines = String(content).split("\n");
  const tables = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!lines[index].trim().startsWith("|") ||
        !/^\s*\|?(?:\s*:?-+:?\s*\|)+\s*$/u.test(lines[index + 1])) continue;
    const headers = tableCells(lines[index]).map(normalizeHeader);
    const rows = [];
    let rowIndex = index + 2;
    while (rowIndex < lines.length && lines[rowIndex].trim().startsWith("|")) {
      rows.push(tableCells(lines[rowIndex]));
      rowIndex += 1;
    }
    tables.push({ headers, rows });
    index = rowIndex - 1;
  }
  return tables;
}

function tableCells(line) {
  return line.trim().replace(/^\||\|$/gu, "").split("|").map((cell) =>
    cell.trim().replace(/^`|`$/gu, ""));
}

function normalizeHeader(value) {
  return String(value).trim().toLowerCase().replace(/[- ]+/gu, "_");
}

function headerIndex(headers, pattern) {
  return headers.findIndex((header) => pattern.test(header));
}

function cellAt(row, index) {
  return index >= 0 ? row[index] : "";
}

function hasInstruction(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return populated(value.reference ?? value.id);
}

function populated(value) {
  return value !== undefined && value !== null && typeof value !== "symbol" &&
    String(value).trim().length > 0;
}

function documentContent(doc) {
  return String(doc.body ?? doc.content ?? doc.text ?? "");
}

function arrayOf(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function compareFindingIdentity(left, right) {
  return left.findingType.localeCompare(right.findingType, "en") ||
    left.artifactReference.localeCompare(right.artifactReference, "en") ||
    left.evidenceExcerpt.localeCompare(right.evidenceExcerpt, "en");
}

function createFinding(findingType, fields) {
  return makeFinding({
    findingType,
    guidelineAnchor: fields.guidelineAnchor ?? "-",
    artifactReference: fields.artifactReference,
    evidenceExcerpt: fields.evidenceExcerpt,
    remediation: {
      class: "documentation-change",
      statement: fields.statement,
      state: "proposed",
      operatorInstructionRef: null,
    },
  });
}
