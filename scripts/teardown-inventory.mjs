#!/usr/bin/env node
// Responsibility: Build the evidence-first, total capability inventory for teardown decisions.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inventoryRoots = ["scripts", "__tests__", "docs", "agent-api/src"];
const evidenceKeys = ["packageScripts", "staticImports", "workflowSteps", "githooks", "markdownReferences"];
const staticImportRouteHandler = "POST /api/auth/session";

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  try {
    const options = parseOptions(process.argv.slice(2));
    const output = path.resolve(required(options.out, "--out"));
    const inventory = buildInventory({ commit: required(options.commit, "--commit") });
    assertTotality(inventory);
    writeFileSync(output, `${JSON.stringify(inventory, null, 2)}\n`, { flag: "wx" });
    process.stdout.write(`${JSON.stringify({ status: "ok", output, entries: inventory.entries.length })}\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

export function buildInventory({
  commit, gitText = defaultGitText, now = () => new Date(),
  siblingInspector = inspectSiblingRepository,
}) {
  const preTeardownCommit = gitText(["rev-parse", `${commit}^{commit}`]);
  const tracked = gitLines(gitText, ["ls-tree", "-r", "--name-only", preTeardownCommit]);
  const inventoryPaths = tracked.filter(file => inventoryRoots.some(root => file === root || file.startsWith(`${root}/`)));
  const source = new Map(tracked.map(file => [file, readAt(preTeardownCommit, file, gitText)]));
  const entries = new Map(inventoryPaths.map(file => [file, baseEntry(file)]));
  addPackageEvidence(entries, tracked, source.get("package.json") || "");
  addImportEvidence(entries, tracked, source);
  addWorkflowEvidence(entries, tracked, source);
  addHookEvidence(entries, tracked, source);
  addMarkdownEvidence(entries, source);
  const importGraph = buildImportGraph(tracked, source);
  const proven = provenPaths({ tracked, source, importGraph });
  for (const entry of entries.values()) {
    entry.provenPath = proven.get(entry.path) || emptyProvenPath();
    const fileSource = source.get(entry.path) || "";
    if (isLaneLifecycle(entry.path, fileSource)) entry.laneLifecycle = lifecycleEvidence(entry.path, fileSource);
    const decision = classifyEntry(entry, { source: fileSource });
    entry.classification = decision.classification;
    if (decision.gitOrGithubReplacement) entry.gitOrGithubReplacement = decision.gitOrGithubReplacement;
    if (decision.constraint) entry.constraint = decision.constraint;
    entry.notes = decision.retentionReason || "Classified by the ordered repository-teardown decision procedure.";
  }
  const inventory = {
    schema: "agentic-teardown-capability-inventory/v1", preTeardownCommit,
    generatedAt: now().toISOString(), entries: [...entries.values()].sort(byPath),
    countsByDirectory: countDirectories(entries.values()),
    refs: enumerateRefs(gitText), siblingRepository: siblingInspector(),
    agentRunRouteClassification: {
      route: "POST /api/agent/run", classification: null,
      operatorDecisionRequired: true,
      citation: "worker/index.js; docs/LIVE-AGENT-PROVIDER-PROOF.md; README.md",
    },
  };
  assertTotality(inventory);
  return inventory;
}

export function classifyEntry(entry, { source = "", concurrencyDiffers = false, readinessKey = false, configuredFalse = false, constraint = null } = {}) {
  const hasEvidence = evidenceKeys.some(key => entry.evidence[key].length > 0);
  const replacement = gitReplacement(source);
  if (entry.provenPath.isProvenPath) return retained("Proven Path evidence requires retention.");
  if (entry.unresolvedReferences.length) return retained("At least one reference is unresolved or ambiguous.");
  if (readinessKey) return retained("Module implements a readiness key.");
  if (concurrencyDiffers) return constrained("concurrency", constraint);
  if (constraint) return constrained(constraint.kind || "other", constraint);
  if (entry.laneLifecycle?.knowgrph.invokesKnowgrph) {
    return hasEvidence ? constrained("cross-repository", { statement: "Invokes sibling knowgrph." }) : { classification: "dead" };
  }
  if (configuredFalse) return constraint ? constrained("other", constraint) : { classification: "dead" };
  if (!hasEvidence) return { classification: "dead" };
  if (replacement.gitCommand || replacement.githubFeature) return { classification: "redundant", gitOrGithubReplacement: replacement };
  return retained("Ambiguous capability without a complete Git or GitHub replacement.");
}

export function extractImports(source) {
  const results = [];
  const literal = /\b(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/gu;
  for (const match of source.matchAll(literal)) results.push({ specifier: match[1] || match[2], line: lineAt(source, match.index), dynamic: false });
  for (const match of source.matchAll(/\bimport\(\s*([^"'\s][^)]*)\)/gu)) results.push({ specifier: match[1].trim(), line: lineAt(source, match.index), dynamic: true });
  return results;
}

export function tokenizeCommand(command) {
  return String(command).match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/gu)?.map(token => token.replace(/^["']|["']$/gu, "")) || [];
}

export function resolveReference(specifier, importer, tracked) {
  if (!specifier.startsWith(".")) return [];
  const raw = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier));
  const candidates = [raw, `${raw}.js`, `${raw}.mjs`, `${raw}/index.js`, `${raw}/index.mjs`];
  return [...new Set(candidates.filter(candidate => tracked.includes(candidate)))];
}

export function assertTotality(inventory) {
  const entryPaths = new Set(inventory.entries.map(entry => entry.path));
  if (entryPaths.size !== inventory.entries.length) throw new Error("Inventory contains duplicate paths.");
  for (const [directory, counts] of Object.entries(inventory.countsByDirectory)) {
    const sum = counts.redundant + counts.constrained + counts.dead + counts.retained;
    if (sum !== counts.trackedFileCount) throw new Error(`Classification totality failed for ${directory}.`);
  }
}

export function deletionDecision(entry, { archiveCovered = true } = {}) {
  if (!entry || !archiveCovered) return Object.freeze({ removable: false, reason: !entry ? "missing-inventory" : "missing-archive" });
  if (entry.unresolvedReferences?.length) return Object.freeze({ removable: false, reason: "unresolved-reference" });
  if (entry.classification === "dead") return Object.freeze({ removable: true, reason: "dead" });
  if (entry.classification === "redundant" && entry.gitOrGithubReplacement
    && (entry.gitOrGithubReplacement.gitCommand || entry.gitOrGithubReplacement.githubFeature)) {
    return Object.freeze({ removable: true, reason: "redundant-with-replacement" });
  }
  return Object.freeze({ removable: false, reason: entry.classification || "invalid-classification" });
}

export function validateLifecycleKeyTransition({ before, after, assignedStageReached }) {
  const pattern = /^(?:device:|runtime:session:|turn:end$|canonical:main:|workspace:legacy-|worktree:lifecycle:|lifecycle:conformance|history:lifecycle|alignment-audit:|agentic-sdlc:)/u;
  const beforeKeys = Object.keys(before).filter(key => pattern.test(key)).sort();
  const afterKeys = Object.keys(after).filter(key => pattern.test(key)).sort();
  return assignedStageReached
    ? afterKeys.length === 0
    : JSON.stringify(beforeKeys.map(key => [key, before[key]]))
      === JSON.stringify(afterKeys.map(key => [key, after[key]]));
}

export function validateSurvivingSetDisjointness({ survivingPaths, lifecyclePaths }) {
  const lifecycle = new Set(lifecyclePaths);
  return survivingPaths.every(file => !lifecycle.has(file));
}

function addPackageEvidence(entries, tracked, packageSource) {
  let packageJson; try { packageJson = JSON.parse(packageSource); } catch { return; }
  for (const [name, command] of Object.entries(packageJson.scripts || {})) {
    for (const token of tokenizeCommand(command)) {
      for (const match of matchToken(token, tracked)) if (entries.has(match)) entries.get(match).evidence.packageScripts.push(name);
    }
  }
}

function addImportEvidence(entries, tracked, source) {
  for (const [importer, body] of source) {
    if (!/\.(?:m?js|cjs)$/u.test(importer)) continue;
    for (const imported of extractImports(body)) {
      if (imported.dynamic) {
        if (entries.has(importer)) entries.get(importer).unresolvedReferences.push(`dynamic import at ${importer}:${imported.line}`);
        continue;
      }
      const resolved = resolveReference(imported.specifier, importer, tracked);
      if (resolved.length === 1 && entries.has(resolved[0])) entries.get(resolved[0]).evidence.staticImports.push(`${importer}:${imported.line}`);
      if (resolved.length !== 1 && imported.specifier.startsWith(".") && entries.has(importer)) entries.get(importer).unresolvedReferences.push(`${imported.specifier} at ${importer}:${imported.line}`);
    }
  }
}

function addWorkflowEvidence(entries, tracked, source) {
  for (const [file, body] of source) {
    if (!/^\.github\/workflows\/.*\.ya?ml$/u.test(file)) continue;
    let job = "unknown"; let step = 0;
    const workflowLines = body.split("\n");
    for (let index = 0; index < workflowLines.length; index += 1) {
      const line = workflowLines[index];
      const jobMatch = line.match(/^  ([\w-]+):\s*$/u); if (jobMatch) job = jobMatch[1];
      if (/^\s*-\s+(?:name:|run:|uses:)/u.test(line)) step += 1;
      const run = line.match(/^(\s*)(?:-\s*)?run:\s*(.*)$/u);
      if (!run) continue;
      const commandLines = [];
      if (!["|", ">", "|-", ">-"].includes(run[2].trim())) {
        commandLines.push(run[2]);
      } else {
        const runIndent = run[1].length;
        while (index + 1 < workflowLines.length) {
          const candidate = workflowLines[index + 1];
          if (candidate.trim() && candidate.match(/^\s*/u)[0].length <= runIndent) break;
          commandLines.push(candidate.trim());
          index += 1;
        }
      }
      for (const token of tokenizeCommand(commandLines.join("\n"))) {
        for (const match of matchToken(token, tracked)) if (entries.has(match)) entries.get(match).evidence.workflowSteps.push(`${file}:${job}:${step}`);
      }
    }
  }
}

function addHookEvidence(entries, tracked, source) {
  for (const [file, body] of source) {
    if (!file.startsWith(".githooks/")) continue;
    for (const token of tokenizeCommand(body)) for (const match of matchToken(token, tracked)) if (entries.has(match)) entries.get(match).evidence.githooks.push(file);
  }
}

function addMarkdownEvidence(entries, source) {
  for (const [markdown, body] of source) {
    if (!markdown.endsWith(".md")) continue;
    for (const [candidate, entry] of entries) if (markdown !== candidate && body.includes(candidate)) entry.evidence.markdownReferences.push(markdown);
  }
}

function buildImportGraph(tracked, source) {
  const graph = new Map();
  for (const [file, body] of source) graph.set(file, extractImports(body).flatMap(item => item.dynamic ? [] : resolveReference(item.specifier, file, tracked)));
  return graph;
}

function provenPaths({ tracked, source, importGraph }) {
  const result = new Map(); const queue = ["worker/index.js"].filter(file => tracked.includes(file)); const previous = new Map();
  while (queue.length) {
    const current = queue.shift();
    if (result.has(current)) continue;
    const chain = []; let cursor = current; while (cursor) { chain.unshift(cursor); cursor = previous.get(cursor); }
    result.set(current, { isProvenPath: true, routeHandlerPath: staticImportRouteHandler, importChain: chain, liveProofRecord: null, liveProofFrontmatterKey: null });
    for (const target of importGraph.get(current) || []) if (!result.has(target)) { if (!previous.has(target)) previous.set(target, current); queue.push(target); }
  }
  for (const proof of ["docs/LIVE-REVIEWED-FUNCTION-PROOF.md", "docs/LIVE-AGENT-PROVIDER-PROOF.md"]) {
    const body = source.get(proof) || "";
    for (const file of tracked) for (const key of ["runtime_owner", "runtime_proof"]) if (body.match(new RegExp(`^${key}:.*${escapeRegex(file)}`, "mu"))) result.set(file, { isProvenPath: true, routeHandlerPath: null, importChain: [], liveProofRecord: proof, liveProofFrontmatterKey: key });
  }
  return result;
}

function lifecycleEvidence(file, source) {
  const linesList = source.split("\n");
  const outsideSites = []; const knowgrphSites = []; const acquires = []; const releases = [];
  linesList.forEach((line, index) => {
    if (/\.\.[/\\]|homedir\(|\/Users\/|\/tmp\//u.test(line)) outsideSites.push({ path: line.trim().slice(0, 160), file, line: index + 1, mode: /write|mkdir|rm|rename|copy/iu.test(line) ? "write" : "read" });
    if (/knowgrph/iu.test(line)) knowgrphSites.push({ target: line.trim().slice(0, 160), file, line: index + 1, kind: /mcp/iu.test(line) ? "mcp" : /git|repo/iu.test(line) ? "repo" : "command" });
    if (/acquir|lock|lease|claim|park/iu.test(line)) acquires.push({ file, line: index + 1 });
    if (/releas|unlock|unclaim|unpark/iu.test(line)) releases.push({ file, line: index + 1 });
  });
  const mechanism = acquires.length || releases.length;
  const mechanismKind = /park/iu.test(source) ? "parking"
    : /claim/iu.test(source) ? "claim"
      : /lock/iu.test(source) ? "lock" : "lease";
  return {
    isLaneLifecycleLayer: true,
    outOfRoot: { outsideRepositoryRoot: outsideSites.length > 0, sites: outsideSites },
    knowgrph: { invokesKnowgrph: knowgrphSites.length > 0, sites: knowgrphSites },
    protectedResource: mechanism ? { operatesMechanism: true, resource: "repository lane state", mechanism: mechanismKind, acquires, releases, gitOrGithubEquivalent: null, concurrencyTrialId: null } : { operatesMechanism: false, statement: "No protected-resource mechanism detected textually." },
  };
}

function baseEntry(file) { return { path: file, directory: directoryOf(file), classification: "retained", evidence: Object.fromEntries(evidenceKeys.map(key => [key, []])), unresolvedReferences: [], provenPath: emptyProvenPath(), notes: "" }; }
function emptyProvenPath() { return { isProvenPath: false, routeHandlerPath: null, importChain: [], liveProofRecord: null, liveProofFrontmatterKey: null }; }
function directoryOf(file) { return file.startsWith("scripts/") ? "scripts/" : file.startsWith("__tests__/") ? "__tests__/" : file.startsWith("docs/") ? "docs/" : "agent-api/src/"; }
function countDirectories(entries) { const result = Object.fromEntries(["scripts/", "__tests__/", "docs/", "agent-api/src/"].map(directory => [directory, { redundant: 0, constrained: 0, dead: 0, retained: 0, trackedFileCount: 0 }])); for (const entry of entries) { result[entry.directory][entry.classification] += 1; result[entry.directory].trackedFileCount += 1; } return result; }
function enumerateRefs(gitText) {
  const worktrees = new Map(parseWorktrees(
    gitText(["worktree", "list", "--porcelain"]),
  ).filter(item => item.branch).map(item => [item.branch, item.path]));
  return gitLines(gitText, [
    "for-each-ref", "--format=%(refname) %(objectname)", "refs/heads", "refs/remotes",
  ]).map(line => {
    const [name, tipSha] = line.split(" ");
    const containingOriginMain = gitLines(gitText, [
      "for-each-ref", `--contains=${tipSha}`, "--format=%(refname)",
      "refs/remotes/origin/main",
    ]);
    return {
      name, tipSha,
      containedInOriginMain: containingOriginMain.includes("refs/remotes/origin/main"),
      checkedOutInWorktree: worktrees.get(name) || null,
    };
  });
}
export function inspectSiblingRepository({
  checkedPath = defaultSiblingRepositoryPath(),
  pathExists = existsSync,
  listTracked = repository => execFileSync(
    "git", ["ls-files"], { cwd: repository, encoding: "utf8" },
  ).trim().split("\n").filter(Boolean),
  read = file => readFileSync(file, "utf8"),
} = {}) {
  if (!pathExists(checkedPath)) return { checkedPath, repositoryPresent: false, readsExternalStateDirectory: null, determination: "undetermined", readingFileCount: 0, readingFiles: [] };
  const siblingFiles = listTracked(checkedPath);
  const readingFiles = siblingFiles.flatMap(file => {
    let body = "";
    try { body = read(path.join(checkedPath, file)); } catch { return []; }
    const matches = [...body.matchAll(/(?:\.agentic-[\w./-]+|AGENTIC_[A-Z_]*STATE[A-Z_]*)/gu)];
    return matches.map(match => ({ path: file, externalStatePath: match[0], replacementSource: null }));
  });
  return { checkedPath, repositoryPresent: true, readsExternalStateDirectory: readingFiles.length > 0, determination: "determined", readingFileCount: new Set(readingFiles.map(item => item.path)).size, readingFiles };
}
function defaultSiblingRepositoryPath() {
  const commonDirectory = defaultGitText(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return resolveSiblingRepositoryPath({ commonDirectory });
}
export function resolveSiblingRepositoryPath({ commonDirectory, pathExists = existsSync }) {
  const canonicalRepository = path.dirname(path.resolve(commonDirectory));
  const immediateSibling = path.resolve(canonicalRepository, "..", "knowgrph");
  let ancestor = path.dirname(canonicalRepository);
  while (true) {
    const candidate = path.join(ancestor, "knowgrph");
    if (pathExists(path.join(candidate, ".git"))) return candidate;
    const parent = path.dirname(ancestor);
    if (parent === ancestor) return immediateSibling;
    ancestor = parent;
  }
}
function gitReplacement(source) { if (/git\s+worktree/iu.test(source)) return { gitCommand: "git worktree", githubFeature: null }; if (/git\s+(?:branch|status|rev-parse|merge-base)/iu.test(source)) return { gitCommand: "git branch/status/rev-parse/merge-base", githubFeature: null }; if (/pull request|github api|gh\s+pr/iu.test(source)) return { gitCommand: null, githubFeature: "GitHub pull requests" }; return { gitCommand: null, githubFeature: null }; }
function retained(retentionReason) { return { classification: "retained", retentionReason }; }
function constrained(kind, constraint = {}) { constraint ||= {}; const reducedForm = constraint.reducedForm || null; return { classification: "constrained", constraint: { statement: constraint.statement || "Observed repository constraint.", kind, evidenceGitCannotExpress: constraint.evidenceGitCannotExpress || "Requires recorded runtime evidence.", observableFailureWhenUnenforced: constraint.observableFailureWhenUnenforced || "Not yet observed.", reducedForm }, retentionReason: reducedForm ? null : "Constrained entry has no recorded reduced form." }; }
function isLaneLifecycle(file, source) { return /lane|lifecycle|worktree|lease|claim|parking|cloud-admission/iu.test(`${file}\n${source.slice(0, 1000)}`); }
function matchToken(token, tracked) {
  const normalized = token.replace(/^\.\//u, "").replace(/[;,)]$/u, "");
  if (["*", "?"].includes(normalized)) return [];
  if (/[*?]/u.test(normalized)) {
    const regex = new RegExp(`^${escapeRegex(normalized)
      .replace(/\\\*/gu, ".*").replace(/\\\?/gu, ".")}$`, "u");
    return tracked.filter(file => regex.test(file));
  }
  return tracked.includes(normalized) ? [normalized] : [];
}
function parseWorktrees(value) { const output = []; let current; for (const line of value.split("\n")) { if (line.startsWith("worktree ")) { current = { path: line.slice(9), branch: null }; output.push(current); } else if (current && line.startsWith("branch ")) current.branch = line.slice(7); } return output; }
function readAt(commit, file, gitText) { try { return gitText(["show", `${commit}:${file}`], false); } catch { return ""; } }
function gitLines(gitText, args) { return String(gitText(args) || "").split("\n").filter(Boolean); }
function lineAt(source, index) { return source.slice(0, index).split("\n").length; }
function byPath(left, right) { return left.path.localeCompare(right.path); }
function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"); }
function defaultGitText(args, trim = true) { const value = execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 }); return trim ? value.trim() : value; }
function parseOptions(args) { const output = {}; for (let index = 0; index < args.length; index += 1) { const arg = args[index]; if (arg.startsWith("--") && args[index + 1]) output[arg.slice(2)] = args[++index]; else throw new Error(`Unsupported argument ${arg}.`); } return output; }
function required(value, label) { if (!String(value || "").trim()) throw new Error(`${label} is required.`); return String(value); }
