import { printArtifactIndex } from "./artifact-printer.mjs";
import { compareFindings, FINDING_TYPES } from "./finding.mjs";
import { printGuidelineModel } from "./guideline-printer.mjs";
import { OUT_OF_SCOPE_DEPLOYMENT_RECORD } from "./deploy-gate.mjs";
import { incrementPatchVersion } from "./output-boundary.mjs";

export function renderAuditReport(run = {}, metadata = {}) {
  const version = String(metadata.version ?? run.version ?? "1.0.0");
  const date = reportDate(metadata.date ?? run.date);
  const title = String(metadata.title ?? run.title ?? "Guideline Runtime Alignment Audit");
  const docType = String(metadata.docType ?? run.docType ?? "Alignment Audit Report");
  const lang = String(metadata.lang ?? run.lang ?? "en-US");
  const findings = [...arrayOf(run.findings)].sort(compareFindings);
  const assignments = [...arrayOf(run.readiness?.assignments ?? run.readinessAssignments)]
    .sort((left, right) =>
      String(left.capabilityId ?? "").localeCompare(String(right.capabilityId ?? ""), "en"));
  const gates = [...arrayOf(run.gates?.gates ?? run.pipelineGates)]
    .sort((left, right) =>
      numberOf(left.order) - numberOf(right.order) ||
      String(left.gateId ?? "").localeCompare(String(right.gateId ?? ""), "en"));
  const lines = [
    "---",
    `title: ${yamlScalar(title)}`,
    `doc_type: ${yamlScalar(docType)}`,
    `version: ${yamlScalar(version)}`,
    `date: ${yamlScalar(date)}`,
    `lang: ${yamlScalar(lang)}`,
    "---",
    "",
    "# Guideline Runtime Alignment Audit",
    "",
    "## Alignment Summary",
    "",
    "| metric | value |",
    "|---|---:|",
    ...summaryRows(run, findings),
    "",
    "### Vendor Coupling By Input Role",
    "",
    "| input role | findings |",
    "|---|---:|",
    ...vendorRows(run.vendorCouplingCountByRole),
    "",
    "## Input Revisions",
    "",
    "| surface | role | revision |",
    "|---|---|---|",
    ...revisionRows(run.inputRevisions),
    "",
    "## Readiness Gap Matrix",
    "",
    "| capability | assigned level | local readiness | deployed readiness | gap statement | priority | exit criterion |",
    "|---|---|---|---|---|---|---|",
    ...readinessRows(assignments),
    "",
    "## Finding Type Counts",
    "",
    "| finding type | count |",
    "|---|---:|",
    ...findingTypeCountRows(run.findingTypeCounts, findings),
    "",
    "## Findings",
    "",
    "| severity | finding type | guideline anchor | artifact reference | evidence excerpt | remediation class | remediation state | remediation |",
    "|---|---|---|---|---|---|---|---|",
    ...findingRows(findings),
    "",
    "## Pipeline Gate States",
    "",
    "| order | gate | state | entry condition | exit condition | required evidence |",
    "|---:|---|---|---|---|---|",
    ...gateRows(gates),
    "",
    "## Source Integrity",
    "",
    `Baseline verified: ${run.baselineVerified === true ? "yes" : "no"}`,
    "",
    `Modified outside output count: ${integerOf(run.modifiedOutsideOutputCount)}`,
    "",
    ...baselineRows(run.baseline),
    "## Deployment Boundary",
    "",
    `State: ${String(run.deployBoundaryState ?? "closed")}`,
    "",
    OUT_OF_SCOPE_DEPLOYMENT_RECORD,
    "",
  ];
  return `${lines.join("\n").replace(/\n+$/u, "")}\n`;
}

export async function writeReport(run, sink, options = {}) {
  if (!sink || typeof sink.write !== "function" ||
      typeof sink.listPublished !== "function") {
    throw new TypeError("writeReport expects a version-aware WriteSink");
  }

  const { beforeReport, afterReport, ...reportMetadata } = options;
  let version = await nextAvailableVersion(sink, String(options.startVersion ?? "1.0.0"));
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const names = artifactNames(version);
    const attemptArtifacts = [];
    try {
      const guidelineDigest =
        run.guidelineDigest ?? printGuidelineModel(run.guidelineModel ?? run.model ?? {});
      const artifactIndexMarkdown =
        run.artifactIndexMarkdown ?? printArtifactIndex(run.artifactIndex ?? run.index ?? {});
      const guidelineArtifact = await sink.write(names.guidelineDigest, guidelineDigest);
      attemptArtifacts.push(assertDiscardable(guidelineArtifact));
      const indexArtifact = await sink.write(names.artifactIndex, artifactIndexMarkdown);
      attemptArtifacts.push(assertDiscardable(indexArtifact));
      const reportRun = typeof beforeReport === "function"
        ? await beforeReport(run) ?? run
        : run;
      const reportText = renderAuditReport(reportRun, { ...reportMetadata, version });
      const reportArtifact = await sink.write(names.report, reportText);
      attemptArtifacts.push(assertDiscardable(reportArtifact));
      const written = Object.freeze({
        version,
        reportText,
        guidelineDigest,
        artifactIndexMarkdown,
        artifacts: Object.freeze([reportArtifact, guidelineArtifact, indexArtifact]),
      });
      if (typeof afterReport === "function") await afterReport(written);
      return written;
    } catch (error) {
      const cleanupError = await discardAttempt(attemptArtifacts);
      if (cleanupError) {
        error.cleanupError = cleanupError;
        throw error;
      }
      if (error?.code !== "EEXIST") throw error;
      version = await nextAvailableVersion(sink, incrementPatchVersion(version));
    }
  }
  throw new Error("could not allocate an Audit_Report version");
}

function assertDiscardable(artifact) {
  if (!artifact || typeof artifact.discard !== "function") {
    throw new TypeError("WriteSink artifacts must expose discard()");
  }
  return artifact;
}

async function discardAttempt(artifacts) {
  const failures = [];
  for (const artifact of [...artifacts].reverse()) {
    try {
      await artifact.discard();
    } catch (error) {
      failures.push(error);
    }
  }
  return failures.length === 0
    ? null
    : new AggregateError(failures, "failed to discard an unpublished report bundle");
}

async function nextAvailableVersion(sink, minimumVersion) {
  const versions = (await sink.listPublished())
    .map((name) => /^(?:alignment-audit-report|guideline-digest|artifact-index)-v(\d+\.\d+\.\d+)\.md$/u
      .exec(String(name))?.[1])
    .filter(Boolean);
  const maximum = versions.sort(compareVersions).at(-1);
  return maximum && compareVersions(maximum, minimumVersion) >= 0
    ? incrementPatchVersion(maximum)
    : minimumVersion;
}

function compareVersions(left, right) {
  const a = String(left).split(".").map(Number);
  const b = String(right).split(".").map(Number);
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

export function artifactNames(version) {
  const normalized = String(version);
  if (!/^\d+\.\d+\.\d+$/u.test(normalized)) {
    throw new TypeError(`invalid report semantic version: ${normalized}`);
  }
  return Object.freeze({
    report: `alignment-audit-report-v${normalized}.md`,
    guidelineDigest: `guideline-digest-v${normalized}.md`,
    artifactIndex: `artifact-index-v${normalized}.md`,
  });
}

function summaryRows(run, findings) {
  const coverage = run.coverage ?? {};
  const routeCounts = run.routeCounts ?? {};
  const counts = run.counts ?? {};
  return [
    row("audited documents", integerOf(counts.auditedDocuments)),
    row("normative elements", integerOf(counts.normativeElements)),
    row("artifact entries", integerOf(counts.artifactEntries)),
    row("artifact-bearing total", integerOf(coverage.artifactBearingTotal)),
    row("artifact-bearing linked", integerOf(coverage.artifactBearingLinked)),
    row("linked ratio", decimalOf(coverage.linkedRatio, 1)),
    row("advisory rules", integerOf(coverage.advisoryCount ?? counts.advisoryElements)),
    row("documented invocation routes", integerOf(routeCounts.documented)),
    row("resolved invocation routes", integerOf(routeCounts.resolved)),
    row("findings", findings.length),
    row("finding bound", integerOf(run.findingBound)),
    row("finding bound satisfied", run.findingBoundSatisfied === true ? "yes" : "no"),
    row("deploy boundary state", run.deployBoundaryState ?? "closed"),
    row("elapsed ms", decimalOf(run.elapsedMs, 0)),
    row("modified outside output count", integerOf(run.modifiedOutsideOutputCount)),
  ];
}

function findingTypeCountRows(counts, findings) {
  const supplied = counts && typeof counts === "object"
    ? counts
    : Object.fromEntries(FINDING_TYPES.map((findingType) => [findingType, 0]));
  if (!counts) {
    for (const finding of findings) {
      if (finding.findingType in supplied) supplied[finding.findingType] += 1;
    }
  }
  return FINDING_TYPES.map(
    (findingType) => `| ${cell(findingType)} | ${integerOf(supplied[findingType])} |`,
  );
}

function vendorRows(counts = {}) {
  const entries = Object.entries(counts ?? {})
    .sort(([left], [right]) => left.localeCompare(right, "en"));
  return entries.length > 0
    ? entries.map(([role, count]) => `| ${cell(role)} | ${integerOf(count)} |`)
    : ["| (none) | 0 |"];
}

function revisionRows(revisions = []) {
  const entries = Array.isArray(revisions)
    ? revisions
    : Object.entries(revisions ?? {}).map(([surface, revisionIdentifier]) => ({
        surface,
        roleLabel: surface,
        revisionIdentifier,
      }));
  return entries.length > 0
    ? entries
      .sort((left, right) =>
        `${left.surface}\0${left.roleLabel}`.localeCompare(
          `${right.surface}\0${right.roleLabel}`,
          "en",
        ))
      .map((entry) =>
        `| ${cell(entry.surface)} | ${cell(entry.roleLabel)} | ${cell(entry.revisionIdentifier ?? "(unprovided)")} |`)
    : ["| (none) | (none) | (unprovided) |"];
}

function readinessRows(assignments) {
  return assignments.length > 0
    ? assignments.map((assignment) =>
        `| ${cell(assignment.capabilityId)} | ${cell(assignment.assignedLevel)} | ${cell(assignment.localReadiness)} | ${cell(assignment.deployedReadiness)} | ${cell(assignment.gapStatement)} | ${cell(assignment.priority)} | ${cell(criterionText(assignment.exitCriterion))} |`)
    : ["| (none) | undocumented | undocumented | undocumented | (none) | (none) | (none) |"];
}

function findingRows(findings) {
  return findings.length > 0
    ? findings.map((finding) =>
        `| ${cell(finding.severity)} | ${cell(finding.findingType)} | ${cell(finding.guidelineAnchor)} | ${cell(finding.artifactReference)} | ${cell(finding.evidenceExcerpt)} | ${cell(finding.remediation.class)} | ${cell(finding.remediation.state)} | ${cell(finding.remediation.statement)} |`)
    : ["| (none) | (none) | - | - | (none) | (none) | (none) | (none) |"];
}

function gateRows(gates) {
  return gates.length > 0
    ? gates.map((gate) =>
        `| ${integerOf(gate.order)} | ${cell(gate.gateId)} | ${cell(gate.state)} | ${cell(gate.entryCondition)} | ${cell(gate.exitCondition)} | ${cell(gate.requiredEvidenceType)} |`)
    : ["| 0 | (none) | unmet | (none) | (none) | (none) |"];
}

function baselineRows(baseline) {
  const entries = baseline?.entries instanceof Map
    ? [...baseline.entries.values()]
    : arrayOf(baseline?.entries);
  if (entries.length === 0) return [];
  return [
    "### Content Baseline",
    "",
    "| subject | bytes | digest |",
    "|---|---:|---|",
    ...entries
      .sort((left, right) => String(left.subject).localeCompare(String(right.subject), "en"))
      .map((entry) =>
        `| ${cell(entry.subject)} | ${integerOf(entry.byteLength)} | ${cell(entry.digest)} |`),
    "",
  ];
}

function criterionText(value) {
  if (value === undefined || value === null) return "(none)";
  if (typeof value === "string") return value;
  return [
    `condition_id=${value.conditionId ?? value.id ?? "(none)"}`,
    `end_state=${value.endState ?? "(none)"}`,
    `stated_check=${value.statedCheck ?? value.check ?? "(none)"}`,
    `constraint=${value.constraint ?? "(none)"}`,
    `bound=${value.bound ?? "(none)"}`,
  ].join("; ");
}

function yamlScalar(value) {
  return JSON.stringify(String(value));
}

function reportDate(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string" && value.length > 0) return value;
  return new Date().toISOString().slice(0, 10);
}

function row(label, value) {
  return `| ${cell(label)} | ${cell(value)} |`;
}

function cell(value) {
  return String(value ?? "(none)")
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replace(/\r?\n/gu, "<br>");
}

function integerOf(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function numberOf(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function decimalOf(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function arrayOf(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}
