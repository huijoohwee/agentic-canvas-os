#!/usr/bin/env node
// Responsibility: Measure teardown surfaces identically at baseline and completion.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseline = Object.freeze({
  "worker+src+agent-api/src": { files: 78, lines: 19228 },
  "scripts/": { files: 296, lines: 110186 },
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
    const report = measure({ commit: required(options.commit, "--commit"), final: "final" in options });
    const reportPath = path.resolve(required(options.report, "--report"));
    writeFileSync(reportPath, renderReport(report), { flag: "wx" });
    process.stdout.write(`${JSON.stringify({ status: report.status, report: reportPath })}\n`);
    if (report.status === "incomplete") process.exitCode = 1;
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

export function measure({ commit, final = false, gitText = defaultGitText }) {
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
    countRow("packageJsonScripts", Object.keys(packageJson.scripts || {}).length, 71),
    countRow("agentApiModules", agentModules, 48),
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
  const unmetThresholds = final ? thresholdBreaches(measured) : [];
  return {
    schema: "agentic-teardown-reduction-report/v1", stagesCompleted: 0,
    finalCommit: final ? resolvedCommit : null,
    status: final ? (unmetThresholds.length ? "incomplete" : "complete") : "in-progress",
    surfaces, counts,
    classificationTotals: { redundant: 0, constrained: 0, dead: 0, retained: 0, total: 0 },
    constrainedWithoutReducedForm: 0,
    archive: { tagName: "", bundlePath: "", manifestPath: "", manifestEntryCount: 0 },
    servedRoutes: [], readinessDifferences: [], warnings: [], unmetThresholds,
    retentions: [], revertedStages: [],
  };
}

export function thresholdBreaches(measured) {
  return Object.entries(thresholds).flatMap(([threshold, requiredMaximum]) => {
    const value = measured.get(threshold);
    return value > requiredMaximum ? [{ threshold, measured: value, required: `<= ${requiredMaximum}` }] : [];
  });
}

export function renderReport(report) {
  const rows = report.surfaces.map(row => `| ${row.surface} | ${row.baselineFiles} | ${row.baselineLines} | ${row.currentFiles} | ${row.currentLines} |`).join("\n");
  return `# Repository teardown reduction report\n\nStatus: **${report.status}**\n\n| Surface | Baseline files | Baseline lines | Current files | Current lines |\n|---|---:|---:|---:|---:|\n${rows}\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`;
}

function surfaceFiles(surface, commit, gitText) {
  if (surface === "docs/*.md") return listFiles(commit, ["docs"], gitText).filter(file => /^docs\/[^/]+\.md$/u.test(file));
  if (surface === "worker+src+agent-api/src") return listFiles(commit, ["worker", "src", "agent-api/src"], gitText);
  return listFiles(commit, [surface.replace(/\/$/u, "")], gitText);
}
function listFiles(commit, paths, gitText) { return lines(gitText(["ls-tree", "-r", "--name-only", commit, "--", ...paths])); }
function lineCount(value) { if (!value) return 0; return value.split("\n").length - (value.endsWith("\n") ? 1 : 0); }
function percentage(before, after) { return before ? Number((((before - after) / before) * 100).toFixed(2)) : 0; }
function lines(value) { return String(value || "").split("\n").filter(Boolean); }
function porcelainCount(value, prefix) { return lines(value).filter(line => line.startsWith(prefix)).length; }
function countRow(metric, current, initial) { return { metric, baseline: initial, current }; }
function defaultGitText(args, trim = true) { const value = execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); return trim ? value.trim() : value; }
function parseOptions(args) { const output = {}; for (let index = 0; index < args.length; index += 1) { const arg = args[index]; if (arg === "--final") output.final = true; else if (arg.startsWith("--") && args[index + 1]) output[arg.slice(2)] = args[++index]; else throw new Error(`Unsupported argument ${arg}.`); } return output; }
function required(value, label) { if (!String(value || "").trim()) throw new Error(`${label} is required.`); return String(value); }
