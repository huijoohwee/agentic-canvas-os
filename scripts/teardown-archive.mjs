#!/usr/bin/env node
// Responsibility: Create and verify the reversible pre-teardown ref archive.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_REF_COUNT = 392;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [command, ...argumentsList] = process.argv.slice(2);

if (import.meta.url === new URL(`file://${path.resolve(process.argv[1] || "")}`).href) {
  try {
    const result = run(command, parseOptions(argumentsList));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status !== "ok") process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

export function run(mode, options, dependencies = defaultDependencies()) {
  if (mode === "create") return createArchive(options, dependencies);
  if (mode === "verify") return verifyArchive(options, dependencies);
  if (mode === "contains") return containsArchive(options, dependencies);
  throw new Error("Usage: teardown-archive.mjs create|verify|contains [exact options]");
}

export function createArchive(options, dependencies) {
  const tag = required(options.tag, "--tag");
  const bundle = path.resolve(required(options.bundle, "--bundle"));
  if (existsSync(bundle) || existsSync(`${bundle}.json`)) throw new Error("Archive output already exists.");
  const refs = enumerateRefs(dependencies.gitText);
  if (refs.length !== EXPECTED_REF_COUNT) {
    throw new Error(`Archive requires ${EXPECTED_REF_COUNT} refs; observed ${refs.length}.`);
  }
  const preTeardownCommit = dependencies.gitText(["rev-parse", "HEAD"]);
  const worktrees = parseWorktrees(dependencies.gitText(["worktree", "list", "--porcelain"]));
  dependencies.git(["tag", "-a", tag, preTeardownCommit, "-m", `Repository teardown archive ${preTeardownCommit}`]);
  try {
    dependencies.git(["bundle", "create", bundle, ...refs.map(item => item.fullName), `refs/tags/${tag}`]);
    const manifest = {
      schema: "agentic-teardown-archive/v1", tag, preTeardownCommit,
      createdAt: new Date().toISOString(), refs, worktrees,
    };
    writeFileSync(`${bundle}.json`, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    dependencies.git(["push", "origin", `refs/tags/${tag}`]);
    verifyArchive({ tag, bundle }, dependencies);
    return { status: "ok", tag, bundle, refCount: refs.length, worktreeCount: worktrees.length };
  } catch (error) {
    dependencies.gitOptional(["tag", "-d", tag]);
    for (const target of [bundle, `${bundle}.json`]) if (existsSync(target)) unlinkSync(target);
    throw error;
  }
}

export function verifyArchive(options, dependencies) {
  const tag = required(options.tag, "--tag");
  const bundle = path.resolve(required(options.bundle, "--bundle"));
  dependencies.git(["bundle", "verify", bundle]);
  const localTagSha = dependencies.gitText(["rev-parse", `refs/tags/${tag}`]);
  const remote = dependencies.gitText(["ls-remote", "--tags", "origin", `refs/tags/${tag}`]);
  if (!remote.split("\n").some(line => line === `${localTagSha}\trefs/tags/${tag}`)) {
    throw new Error(`Archive tag ${tag} is absent or changed at origin.`);
  }
  const manifest = JSON.parse(readFileSync(`${bundle}.json`, "utf8"));
  if (manifest.refs.length !== EXPECTED_REF_COUNT) throw new Error("Archive manifest ref count drifted.");
  if (manifest.tag !== tag || manifest.preTeardownCommit !== dependencies.gitText(["rev-parse", `${tag}^{commit}`])) {
    throw new Error("Archive manifest tag subject drifted.");
  }
  const bundleHeads = new Map(parseBundleHeads(
    dependencies.gitText(["bundle", "list-heads", bundle]),
  ).map(item => [item.ref, item.sha]));
  for (const ref of manifest.refs) {
    if (bundleHeads.get(ref.fullName) !== ref.tipSha) {
      throw new Error(`Archive bundle omits exact ref ${ref.fullName}.`);
    }
  }
  return { status: "ok", tag, bundle, localTagSha, refCount: manifest.refs.length };
}

export function containsArchive(options, dependencies) {
  const bundle = path.resolve(required(options.bundle, "--bundle"));
  const heads = parseBundleHeads(dependencies.gitText(["bundle", "list-heads", bundle]));
  if (options.ref) {
    const match = heads.find(item => item.ref === options.ref);
    return { status: match ? "ok" : "missing", query: { ref: options.ref }, match: match || null };
  }
  const sha = required(options.sha, "--sha");
  const contained = heads.some(head => dependencies.isAncestor(sha, head.sha));
  return { status: contained ? "ok" : "missing", query: { sha } };
}

export function validateArchiveCoverage({ targets, coveredRefs, coveredShas }) {
  const refs = new Set(coveredRefs);
  const shas = new Set(coveredShas);
  return targets.map(target => Object.freeze({
    ...target,
    covered: refs.has(target.ref) && shas.has(target.sha),
  }));
}

export function validateRemovalManifest({ deletedPaths, rows, stage, stageCommit }) {
  const deleted = [...new Set(deletedPaths)];
  if (deleted.length !== deletedPaths.length || rows.length !== deleted.length) return false;
  const byPath = new Map();
  for (const row of rows) {
    if (!row || byPath.has(row.path) || row.stage !== stage
      || row.stageCommit !== stageCommit
      || !/^[0-9a-f]{40}$/u.test(row.preTeardownBlobSha || "")
      || !new Set(["redundant", "constrained", "dead", "retained"])
        .has(row.classification)) return false;
    byPath.set(row.path, row);
  }
  return deleted.every(file => byPath.has(file));
}

export function enumerateRefs(gitText) {
  const names = gitText(["branch", "-a", "--format=%(refname)"]).split("\n").filter(Boolean);
  return [...new Set(names)].sort().map(fullName => ({
    name: fullName.replace(/^refs\/heads\//u, "").replace(/^refs\/remotes\//u, "remotes/"),
    fullName, tipSha: gitText(["rev-parse", fullName]),
  }));
}

function parseWorktrees(value) {
  const results = []; let current = null;
  for (const line of value.split("\n")) {
    if (line.startsWith("worktree ")) { if (current) results.push(current); current = { path: line.slice(9), headSha: null, branch: null }; }
    else if (current && line.startsWith("HEAD ")) current.headSha = line.slice(5);
    else if (current && line.startsWith("branch ")) current.branch = line.slice(7);
  }
  if (current) results.push(current);
  return results;
}
function parseBundleHeads(value) { return value.split("\n").filter(Boolean).map(line => { const [sha, ref] = line.split(/\s+/u); return { sha, ref }; }); }
export function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const inline = argument.match(/^--([^=]+)=(.+)$/u);
    if (inline) {
      options[inline[1]] = inline[2];
      continue;
    }
    if (!argument.startsWith("--") || index + 1 >= args.length
      || args[index + 1].startsWith("--")) {
      throw new Error(`Unsupported argument ${argument}.`);
    }
    options[argument.slice(2)] = args[index + 1];
    index += 1;
  }
  return options;
}
function required(value, label) { if (!String(value || "").trim()) throw new Error(`${label} is required.`); return String(value); }
function defaultDependencies() {
  const execute = (args, allowFailure = false) => { const result = spawnSync("git", args, { cwd: repositoryRoot, encoding: "utf8" }); if (!allowFailure && result.status !== 0) throw new Error(result.stderr.trim() || `git ${args[0]} failed.`); return result; };
  return {
    git: args => execute(args), gitOptional: args => execute(args, true),
    gitText: args => execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" }).trim(),
    isAncestor: (ancestor, descendant) => execute(["merge-base", "--is-ancestor", ancestor, descendant], true).status === 0,
  };
}
