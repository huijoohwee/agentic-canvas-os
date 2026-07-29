import { buildArtifactIndex } from "./artifact-indexer.mjs";
import { resolveAuditConfig } from "./config.mjs";
import {
  captureContentBaseline,
  verifyContentBaseline,
} from "./content-baseline.mjs";
import { detectDrift } from "./drift-detector.mjs";
import { checkEconomics } from "./economics-checker.mjs";
import { finalizeFindings } from "./finding-pipeline.mjs";
import { FINDING_TYPES, makeFinding } from "./finding.mjs";
import { scanFrontmatter } from "./frontmatter.mjs";
import { evaluateGates } from "./gate-evaluator.mjs";
import { parseGuidelineSet } from "./guideline-parser.mjs";
import { checkInvocation } from "./invocation-checker.mjs";
import { checkNeutrality } from "./neutrality-checker.mjs";
import { documentKeyFrom, normalizeContent } from "./normalize.mjs";
import { evaluateReadiness } from "./readiness-evaluator.mjs";
import { createSuppliedReferenceInventory } from "./reference-inventory.mjs";
import { writeReport } from "./report-writer.mjs";
import { checkTopology } from "./topology-checker.mjs";
import { mapTraceability } from "./traceability-mapper.mjs";

export class SourceIntegrityViolation extends Error {
  constructor(integrity) {
    super(
      `source integrity mismatch: ${integrity.modifiedOutsideOutputCount} input file(s) changed`,
    );
    this.name = "SourceIntegrityViolation";
    this.integrity = integrity;
  }
}

export async function runAudit(config, reader, sink, options = {}) {
  const startedAt = now();
  const resolvedConfig =
    config?.resolved === true
      ? config
      : await resolveAuditConfig(config, options.configOptions);
  assertPort(reader, "SourceReader", ["list", "read"]);
  assertPort(sink, "WriteSink", ["listPublished", "write"]);

  const roots = configuredRoots(resolvedConfig);
  const descriptors = await reader.list(roots);
  const rawDocuments = await Promise.all(
    descriptors.map(async (descriptor) => {
      try {
        return normalizeReadResult(descriptor, await reader.read(descriptor));
      } catch (error) {
        return normalizeReadResult(descriptor, {
          content: null,
          text: null,
          readState: "unreadable",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  );
  const baseline = captureContentBaseline(rawDocuments, roots);
  const prepared = prepareAuditDocuments(rawDocuments);
  const guidelineDocs = prepared.documents.filter(
    (document) =>
      document.auditSurface === "guideline" && document.readState === "ok",
  );
  const runtimeDocs = prepared.documents.filter(
    (document) =>
      document.auditSurface === "runtime" && document.readState === "ok",
  );
  const componentFindings = [...prepared.findings];

  const guideline = runComponent(
    "Guideline_Parser",
    () => parseGuidelineSet(guidelineDocs, resolvedConfig.requiredFrontmatterKeys),
    { value: { documents: new Map(), elements: [] }, findings: [] },
    componentFindings,
  );
  const artifact = runComponent(
    "Artifact_Indexer",
    () => buildArtifactIndex(runtimeDocs, resolvedConfig.readinessLadder),
    { value: { entries: [] }, findings: [] },
    componentFindings,
  );
  componentFindings.push(...arrayOf(guideline.findings), ...arrayOf(artifact.findings));

  const mapped = runComponent(
    "Traceability_Mapper",
    () => mapTraceability(guideline.value, artifact.value, {
      referenceInventory: createSuppliedReferenceInventory(prepared.documents),
    }),
    {
      chains: [],
      links: [],
      coverage: {
        artifactBearingTotal: 0,
        artifactBearingLinked: 0,
        linkedRatio: 1,
      },
      findings: [],
    },
    componentFindings,
  );
  componentFindings.push(...arrayOf(mapped.findings));

  const readiness = runComponent(
    "Readiness_Evaluator",
    () => evaluateReadiness(mapped.chains, resolvedConfig.operatorDeployInstruction),
    { assignments: [], findings: [] },
    componentFindings,
  );
  componentFindings.push(...arrayOf(readiness.findings));

  const gates = runComponent(
    "Gate_Evaluator",
    () => evaluateGates(guideline.value, artifact.value, mapped.chains),
    { gates: [], findings: [] },
    componentFindings,
  );
  componentFindings.push(...arrayOf(gates.findings));

  const drift = runComponent(
    "Drift_Detector",
    () => detectDrift(
      guideline.value,
      artifact.value,
      mapped.chains,
      gates.gates,
      readiness.assignments,
    ),
    [],
    componentFindings,
  );
  componentFindings.push(...arrayOf(drift));

  const allHealthyDocs = prepared.documents.filter(
    (document) => document.readState === "ok",
  );
  const universalScope = new Set(
    [...mapEntries(guideline.value.documents)]
      .filter(([, metadata]) => metadata?.universalScope)
      .map(([documentKey]) => String(documentKey)),
  );
  const neutrality = runComponent(
    "Neutrality_Checker",
    () => checkNeutrality(allHealthyDocs, universalScope),
    { findings: [], vendorCouplingCountByRole: {} },
    componentFindings,
  );
  componentFindings.push(...arrayOf(neutrality.findings));

  const economics = runComponent(
    "Economics_Checker",
    () => checkEconomics(allHealthyDocs, resolvedConfig.economicsStatements),
    [],
    componentFindings,
  );
  componentFindings.push(...arrayOf(economics));

  const invocation = runComponent(
    "Invocation_Checker",
    () => checkInvocation(artifact.value),
    {
      findings: [],
      routeCounts: { documented: 0, resolved: 0, orphan: 0, ambiguous: 0 },
    },
    componentFindings,
  );
  componentFindings.push(...arrayOf(invocation.findings));

  const topology = runComponent(
    "Topology_Checker",
    () => checkTopology(
      allHealthyDocs,
      artifact.value,
      resolvedConfig.operatorDeployInstruction,
    ),
    { findings: [], deployBoundaryState: "closed" },
    componentFindings,
  );
  componentFindings.push(...arrayOf(topology.findings));

  const normativeElementCount = arrayOf(guideline.value?.elements).length;
  const advisoryElementCount = arrayOf(guideline.value?.elements)
    .filter((element) => element?.class === "advisory").length;
  const artifactEntryCount = arrayOf(artifact.value?.entries).length;
  const findings = finalizeFindings(componentFindings, {
    normativeElementCount,
    artifactEntryCount,
    operatorInstruction: resolvedConfig.operatorDeployInstruction,
    enforceBound: false,
  });
  const bound = normativeElementCount + artifactEntryCount;
  const findingBoundSatisfied = findings.length <= bound;
  const findingTypeCounts = Object.fromEntries(
    FINDING_TYPES.map((findingType) => [findingType, 0]),
  );
  for (const finding of findings) {
    findingTypeCounts[finding.findingType] += 1;
  }
  const integrityBeforeEmit = await verifyContentBaseline(baseline, reader);
  assertSourceIntegrity(integrityBeforeEmit);
  const elapsedBeforeEmit = now() - startedAt;
  const run = {
    config: resolvedConfig,
    sourceDocuments: prepared.documents,
    guidelineModel: guideline.value,
    artifactIndex: artifact.value,
    mapping: mapped,
    coverage: {
      ...mapped.coverage,
      advisoryCount: advisoryElementCount,
    },
    readiness,
    gates,
    routeCounts: invocation.routeCounts,
    vendorCouplingCountByRole: neutrality.vendorCouplingCountByRole,
    findings,
    findingTypeCounts,
    findingBoundSatisfied,
    findingBound: bound,
    baseline,
    baselineVerified: integrityBeforeEmit.baselineVerified,
    modifiedOutsideOutputCount: integrityBeforeEmit.modifiedOutsideOutputCount,
    integrityMismatches: integrityBeforeEmit.mismatches,
    deployBoundaryState:
      resolvedConfig.operatorDeployInstruction === null
        ? "closed"
        : topology.deployBoundaryState,
    inputRevisions: inputRevisions(resolvedConfig),
    counts: {
      auditedDocuments: descriptors.length,
      normativeElements: normativeElementCount,
      advisoryElements: advisoryElementCount,
      artifactEntries: artifactEntryCount,
      findings: findings.length,
    },
    elapsedMs: elapsedBeforeEmit,
  };

  let integrityAfterEmit = null;
  const written = await writeReport(run, sink, {
    ...options.reportOptions,
    beforeReport: async () => {
      const integrityBeforeReport = await verifyContentBaseline(baseline, reader);
      assertSourceIntegrity(integrityBeforeReport);
      return {
        ...run,
        baselineVerified: integrityBeforeReport.baselineVerified,
        modifiedOutsideOutputCount: integrityBeforeReport.modifiedOutsideOutputCount,
        integrityMismatches: integrityBeforeReport.mismatches,
      };
    },
    afterReport: async () => {
      integrityAfterEmit = await verifyContentBaseline(baseline, reader);
      assertSourceIntegrity(integrityAfterEmit);
    },
  });
  const elapsedMs = now() - startedAt;
  return Object.freeze({
    ...run,
    version: written.version,
    elapsedMs,
    baselineVerified: integrityAfterEmit.baselineVerified,
    modifiedOutsideOutputCount: integrityAfterEmit.modifiedOutsideOutputCount,
    integrityMismatches: integrityAfterEmit.mismatches,
    report: written.reportText,
    reportText: written.reportText,
    guidelineDigest: written.guidelineDigest,
    artifactIndexMarkdown: written.artifactIndexMarkdown,
    artifacts: written.artifacts,
    writtenArtifacts: written.artifacts,
  });
}

export function prepareAuditDocuments(rawDocuments = []) {
  const prepared = rawDocuments.map((document) => prepareOneDocument(document));
  assignDocumentKeys(
    prepared.filter((document) =>
      document.auditSurface === "guideline" && document.readState === "ok"),
  );
  assignDocumentKeys(
    prepared.filter((document) =>
      document.auditSurface === "runtime" && document.readState === "ok"),
  );
  const findings = [];
  for (const document of prepared) {
    if (document.readState === "unreadable") {
      findings.push(inputFinding("unreadable-input", document, document.error));
    } else if (document.readState === "malformed") {
      findings.push(inputFinding("malformed-document", document, document.error));
    }
  }
  return {
    documents: prepared.sort(compareDocuments),
    findings,
  };
}

function prepareOneDocument(document) {
  if (document.readState === "ok" && typeof document.content !== "string") {
    return {
      ...document,
      documentKey: null,
      frontmatter: null,
      body: "",
      readState: "malformed",
      error: "readable input did not contain string content",
    };
  }
  if (document.readState !== "ok" || typeof document.content !== "string") {
    return {
      ...document,
      documentKey: null,
      frontmatter: null,
      body: "",
    };
  }
  const scanned = scanFrontmatter(document.content);
  if (
    scanned.readState !== "ok" &&
    scanned.error === "missing opening frontmatter delimiter" &&
    document.documentDefaults &&
    typeof document.documentDefaults === "object"
  ) {
    return {
      ...document,
      documentKey: null,
      frontmatter: new Map(Object.entries(document.documentDefaults)),
      body: normalizeContent(document.content),
      rawFrontmatter: null,
      readState: "ok",
      error: null,
      contentAdaptedFromConfiguredDefaults: true,
    };
  }
  return {
    ...document,
    documentKey: null,
    frontmatter: scanned.frontmatter,
    body: scanned.body,
    rawFrontmatter: scanned.raw,
    readState: scanned.readState,
    error: scanned.error,
  };
}

function assignDocumentKeys(documents) {
  const occupied = new Set();
  const ordered = [...documents].sort((left, right) =>
    String(left.contentDigest ?? "").localeCompare(String(right.contentDigest ?? ""), "en"));
  for (const document of ordered) {
    document.documentKey = documentKeyFrom(
      document.frontmatter ?? {},
      document.body || document.content || "",
      occupied,
    );
    occupied.add(document.documentKey);
  }
}

function configuredRoots(config) {
  return [
    ...config.guidelineRoots.map((root) => ({
      ...root,
      auditSurface: "guideline",
      inputRole: root.roleLabel,
    })),
    ...config.runtimeRoots.map((root) => ({
      ...root,
      auditSurface: "runtime",
      inputRole: root.roleLabel,
    })),
  ];
}

function normalizeReadResult(descriptor, result) {
  if (typeof result === "string") {
    return {
      ...descriptor,
      content: result,
      text: result,
      readState: "ok",
      error: null,
    };
  }
  const normalized = {
    ...descriptor,
    ...(result ?? {}),
    auditSurface: result?.auditSurface ?? descriptor.auditSurface ?? null,
    inputRole:
      result?.inputRole ??
      descriptor.inputRole ??
      descriptor.roleLabel ??
      descriptor.auditSurface ??
      "input",
  };
  const content = typeof normalized.content === "string"
    ? normalized.content
    : typeof normalized.text === "string"
      ? normalized.text
      : null;
  const declaredState = String(normalized.readState ?? "").trim().toLowerCase();
  if (declaredState === "unreadable") {
    return {
      ...normalized,
      content: null,
      text: null,
      readState: "unreadable",
      error: String(normalized.error ?? "source is unreadable"),
    };
  }
  if (content === null || (declaredState && declaredState !== "ok")) {
    return {
      ...normalized,
      content: null,
      text: null,
      readState: "malformed",
      error: String(
        normalized.error ??
        (content === null
          ? "readable input did not contain string content"
          : `unsupported read state: ${declaredState}`),
      ),
    };
  }
  return {
    ...normalized,
    content,
    text: content,
    readState: "ok",
    error: null,
  };
}

function runComponent(name, operation, fallback, findings) {
  try {
    return operation();
  } catch (error) {
    findings.push(
      makeFinding({
        findingType: "malformed-document",
        guidelineAnchor: "-",
        artifactReference: name,
        evidenceExcerpt: error instanceof Error ? error.message : String(error),
        remediation: {
          class: "local-reproducible-check",
          statement: `Repair ${name} and rerun the locally reproducible audit check.`,
        },
      }),
    );
    return fallback;
  }
}

function inputFinding(findingType, document, excerpt) {
  return makeFinding({
    findingType,
    guidelineAnchor: "-",
    artifactReference:
      document.subject ??
      document.documentKey ??
      document.readHandle ??
      "unavailable-input",
    evidenceExcerpt: String(excerpt ?? `${findingType} input`),
    remediation: {
      class: "documentation-change",
      statement:
        findingType === "unreadable-input"
          ? "Restore readable access to the configured input."
          : "Repair the document structure and rerun the audit.",
    },
  });
}

function inputRevisions(config) {
  return [
    ...config.guidelineRoots.map((root) => ({
      surface: "guideline",
      roleLabel: root.roleLabel,
      revisionIdentifier: root.revisionIdentifier,
    })),
    ...config.runtimeRoots.map((root) => ({
      surface: "runtime",
      roleLabel: root.roleLabel,
      revisionIdentifier: root.revisionIdentifier,
    })),
  ];
}

function mapEntries(value) {
  if (value instanceof Map) return value.entries();
  return Object.entries(value ?? {});
}

function assertPort(port, name, methods) {
  if (!port || methods.some((method) => typeof port[method] !== "function")) {
    throw new TypeError(`${name} must expose ${methods.join(" and ")}`);
  }
}

function compareDocuments(left, right) {
  return (
    String(left.auditSurface ?? "").localeCompare(String(right.auditSurface ?? ""), "en") ||
    String(left.documentKey ?? left.subject ?? "").localeCompare(
      String(right.documentKey ?? right.subject ?? ""),
      "en",
    )
  );
}

function arrayOf(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function assertSourceIntegrity(integrity) {
  if (integrity.baselineVerified !== true ||
      integrity.modifiedOutsideOutputCount !== 0) {
    throw new SourceIntegrityViolation(integrity);
  }
}
