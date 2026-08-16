#!/usr/bin/env node
// Responsibility: Measure teardown surfaces identically at baseline and completion.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseline = Object.freeze({
  "worker+src+agent-api/src": { files: 78, lines: 19228 },
  "scripts/": { files: 361, lines: 110186 },
  "__tests__/": { files: 296, lines: 89206 },
  "docs/*.md": { files: 100, lines: 17924 },
});
const thresholds = Object.freeze({
  "worker+src+agent-api/src.lines": 8000, "agentApiModules": 20,
  "scripts/.files": 15, "scripts/.lines": 3000,
  "__tests__/.files": 20, "__tests__/.lines": 3000,
  "docs/*.md.files": 12, "docs/*.md.lines": 2500,
  packageJsonScripts: 20, worktrees: 2, localBranches: 5, remoteBranches: 10,
  combinedLifecycleLines: 32597,
});

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  try {
    const options = parseOptions(process.argv.slice(2));
    const reportPath = path.resolve(required(options.report, "--report"));
    const priorReport = existsSync(reportPath) ? readEmbeddedReport(reportPath) : null;
    const report = measure({ commit: required(options.commit, "--commit"),
      final: "final" in options, priorReport });
    writeFileSync(reportPath, renderReport(report));
    process.stdout.write(`${JSON.stringify({ status: report.status, report: reportPath })}\n`);
    if (report.status === "incomplete") process.exitCode = 1;
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

export function measure({ commit, final = false, gitText = defaultGitText, priorReport = null }) {
  const resolvedCommit = gitText(["rev-parse", `${commit}^{commit}`]);
  const surfaces = Object.entries(baseline).map(([surface, denominator]) => {
    const files = surfaceFiles(surface, resolvedCommit, gitText);
    const lines = files.reduce((sum, file) => sum + lineCount(gitText(["show", `${resolvedCommit}:${file}`], false)), 0);
    return {
      surface, baselineFiles: denominator.files, baselineLines: denominator.lines,
      currentFiles: files.length, currentLines: lines,
      percentFileReduction: percentage(denominator.files, files.length),
      percentLineReduction: percentage(denominator.lines, lines),
    };
  });
  const packageJson = JSON.parse(gitText(["show", `${resolvedCommit}:package.json`], false));
  const agentModules = listFiles(resolvedCommit, ["agent-api/src"], gitText).filter(file => file.endsWith(".js")).length;
  const counts = [
    countRow("packageJsonScripts", Object.keys(packageJson.scripts || {}).length, 116),
    countRow("agentApiModules", agentModules, 59),
    countRow("worktrees", porcelainCount(gitText(["worktree", "list", "--porcelain"]), "worktree "), null),
    countRow("localBranches", lines(gitText(["branch", "--format=%(refname:short)"])).length, 306),
    countRow("remoteBranches", lines(gitText(["branch", "-r", "--format=%(refname:short)"])).filter(value => value !== "origin/HEAD").length, 86),
  ];
  const lifecycleRows = surfaces.filter(row => ["scripts/", "__tests__/", "docs/*.md"].includes(row.surface));
  const measured = new Map([
    ...surfaces.flatMap(row => [[`${row.surface}.files`, row.currentFiles], [`${row.surface}.lines`, row.currentLines]]),
    ...counts.map(row => [row.metric, row.current]),
    ["combinedLifecycleLines", lifecycleRows.reduce((sum, row) => sum + row.currentLines, 0)],
  ]);
  const retained = priorReport || {};
  const warnings = [...(retained.warnings || []), ...baselineWarnings({ surfaces, counts })];
  const finalExtras = final ? finalEvidenceBreaches(retained) : [];
  const unmetThresholds = final
    ? [...thresholdBreaches(measured), ...finalExtras]
    : [...(retained.unmetThresholds || [])];
  return {
    schema: "agentic-teardown-reduction-report/v1",
    stagesCompleted: retained.stagesCompleted || 0,
    finalCommit: final ? resolvedCommit : null,
    status: final ? (unmetThresholds.length ? "incomplete" : "complete") : "in-progress",
    surfaces, counts,
    classificationTotals: retained.classificationTotals
      || { redundant: 0, constrained: 0, dead: 0, retained: 0, total: 0 },
    constrainedWithoutReducedForm: retained.constrainedWithoutReducedForm || 0,
    archive: retained.archive
      || { tagName: "", bundlePath: "", manifestPath: "", manifestEntryCount: 0 },
    servedRoutes: retained.servedRoutes || [],
    readinessDifferences: retained.readinessDifferences || [],
    warnings: uniqueRows(warnings), unmetThresholds: uniqueRows(unmetThresholds),
    retentions: retained.retentions || [], revertedStages: retained.revertedStages || [],
  };
}

export function thresholdBreaches(measured) {
  return Object.entries(thresholds).flatMap(([threshold, requiredMaximum]) => {
    const value = measured.get(threshold);
    return value > requiredMaximum ? [{ threshold, measured: value, required: `<= ${requiredMaximum}` }] : [];
  });
}

export function reductionPercentage(before, after) {
  if (!Number.isSafeInteger(before) || before < 1
    || !Number.isSafeInteger(after) || after < 0 || after > before) {
    throw new Error("Reduction counts are invalid.");
  }
  return ((before - after) / before) * 100;
}

export function baselineReductionPercentage(before, after) {
  if (!Number.isSafeInteger(before) || before < 1
    || !Number.isSafeInteger(after) || after < 0) {
    throw new Error("Baseline measurement counts are invalid.");
  }
  return ((before - after) / before) * 100;
}

export function validateStageSequence(stages) {
  if (!Array.isArray(stages) || stages.some(stage => !Number.isSafeInteger(stage))) {
    return false;
  }
  return stages.every((stage, index) => stage === index + 1);
}

export function worktreeRemovalDecision(porcelain) {
  const lines = String(porcelain || "").split("\n").filter(Boolean);
  return Object.freeze({ allowed: lines.length === 0, lineCount: lines.length });
}

export function externalStateMoveDecision(exitStatus) {
  if (!Number.isSafeInteger(exitStatus)) throw new Error("State move exit status is invalid.");
  return Object.freeze({
    removable: exitStatus === 0,
    stop: exitStatus !== 0,
    ...(exitStatus === 0 ? {} : { retentionReason: `state move exited ${exitStatus}` }),
  });
}

export function validateImportClosure({ survivingPaths, importsByPath }) {
  const survivors = new Set(survivingPaths);
  for (const [importer, importedPaths] of Object.entries(importsByPath)) {
    if (!survivors.has(importer)) continue;
    if (!Array.isArray(importedPaths)
      || importedPaths.some(imported => !survivors.has(imported))) return false;
  }
  return true;
}

export function validateReferenceClosure({ removedPaths, references }) {
  const removed = new Set(removedPaths);
  return references.every(reference => !removed.has(reference));
}

export function validateSurfaceCoverage({ surface, covered }) {
  const coverage = new Set(covered);
  return new Set(surface).size === surface.length
    && surface.every(subject => coverage.has(subject));
}

export function renderReport(report) {
  const rows = report.surfaces.map(row => `| ${row.surface} | ${row.baselineFiles} | ${row.baselineLines} | ${row.currentFiles} | ${row.currentLines} |`).join("\n");
  return `# Repository teardown reduction report\n\nStatus: **${report.status}**\n\n| Surface | Baseline files | Baseline lines | Current files | Current lines |\n|---|---:|---:|---:|---:|\n${rows}\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`;
}

export function readEmbeddedReport(reportPath) {
  const source = readFileSync(reportPath, "utf8");
  const match = source.match(/```json\n([\s\S]*?)\n```/u);
  if (!match) throw new Error("Reduction report has no embedded JSON record.");
  const report = JSON.parse(match[1]);
  if (report?.schema !== "agentic-teardown-reduction-report/v1") {
    throw new Error("Reduction report schema is invalid.");
  }
  return report;
}

function baselineWarnings({ surfaces, counts }) {
  const rows = [];
  for (const row of surfaces) {
    if (row.currentFiles !== row.baselineFiles) rows.push({ metric: `${row.surface}.files`, measured: row.currentFiles, baseline: row.baselineFiles });
    if (row.currentLines !== row.baselineLines) rows.push({ metric: `${row.surface}.lines`, measured: row.currentLines, baseline: row.baselineLines });
  }
  for (const row of counts) {
    if (row.baseline !== null && row.current !== row.baseline) rows.push({ metric: row.metric, measured: row.current, baseline: row.baseline });
  }
  return rows;
}

export function finalEvidenceBreaches(report) {
  const totals = report.classificationTotals || {};
  const classificationSum = ["redundant", "constrained", "dead", "retained"]
    .reduce((sum, key) => sum + (Number(totals[key]) || 0), 0);
  return [
    ...(!Number.isSafeInteger(totals.total) || totals.total < 1
      || classificationSum !== totals.total
      ? [{ threshold: "classificationTotals", measured: classificationSum,
        required: "positive and equal to the Capability Inventory entry total" }] : []),
    ...((report.constrainedWithoutReducedForm || 0) !== 0
      ? [{ threshold: "constrainedWithoutReducedForm",
        measured: report.constrainedWithoutReducedForm, required: "= 0" }] : []),
    ...((report.servedRoutes || []).length !== 17
      ? [{ threshold: "servedRoutes", measured: (report.servedRoutes || []).length,
        required: "= 17" }] : []),
    ...(!report.archive?.tagName || !report.archive?.bundlePath
      || !report.archive?.manifestPath || report.archive?.manifestEntryCount < 1
      ? [{ threshold: "archive", measured: report.archive?.manifestEntryCount || 0,
        required: ">= 1 with tag, bundle, and manifest" }] : []),
  ];
}

function uniqueRows(rows) {
  const seen = new Set();
  return rows.filter(row => {
    const key = JSON.stringify(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function surfaceFiles(surface, commit, gitText) {
  if (surface === "docs/*.md") return listFiles(commit, ["docs"], gitText).filter(file => /^docs\/[^/]+\.md$/u.test(file));
  if (surface === "worker+src+agent-api/src") return listFiles(commit, ["worker", "src", "agent-api/src"], gitText);
  return listFiles(commit, [surface.replace(/\/$/u, "")], gitText);
}
function listFiles(commit, paths, gitText) { return lines(gitText(["ls-tree", "-r", "--name-only", commit, "--", ...paths])); }
function lineCount(value) { if (!value) return 0; return value.split("\n").length - (value.endsWith("\n") ? 1 : 0); }
function percentage(before, after) { return Number(baselineReductionPercentage(before, after).toFixed(2)); }
function lines(value) { return String(value || "").split("\n").filter(Boolean); }
function porcelainCount(value, prefix) { return lines(value).filter(line => line.startsWith(prefix)).length; }
function countRow(metric, current, initial) { return { metric, baseline: initial, current }; }
function defaultGitText(args, trim = true) { const value = execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); return trim ? value.trim() : value; }
function parseOptions(args) { const output = {}; for (let index = 0; index < args.length; index += 1) { const arg = args[index]; if (arg === "--final") output.final = true; else if (arg.startsWith("--") && args[index + 1]) output[arg.slice(2)] = args[++index]; else throw new Error(`Unsupported argument ${arg}.`); } return output; }
function required(value, label) { if (!String(value || "").trim()) throw new Error(`${label} is required.`); return String(value); }
