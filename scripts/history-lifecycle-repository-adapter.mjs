// Responsibility: Capture bounded, stable, read-only repository history evidence for advisory lifecycle planning.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { HISTORY_LIFECYCLE_EVIDENCE_SCHEMA } from "./history-lifecycle-contract.mjs";
const DEFAULT_BOUNDS = Object.freeze({
  maxRefs: 4_096, maxBranches: 1_024, maxWorktrees: 256, maxStashes: 512,
  maxAnchors: 2_048, maxLeaseEntries: 2_048, maxProviderChanges: 512,
  maxDeltaEntries: 20_000, maxAggregateEntries: 100_000, maxCommands: 20_000,
  maxAggregateBytes: 256 * 1024 * 1024, maxFileBytes: 16 * 1024 * 1024,
  maxOutputBytes: 32 * 1024 * 1024,
});
const READ_ONLY_GIT = new Set([
  "rev-parse", "for-each-ref", "worktree", "status", "merge-base", "rev-list",
  "cherry", "reflog", "show", "diff-tree", "ls-tree", "ls-remote",
]);
const TERMINAL = new Set(["completed"]); const NONTERMINAL = new Set([
  "active", "admitted", "review_ready", "review-ready", "delivery", "delivery_authorized",
  "delivery-authorized", "parked", "completing", "successor_recovery", "recovered",
]);
export function createHistoryLifecycleRepositoryAdapter(options = {}, dependencies = {}) {
  const runtime = createRuntime(options, dependencies); return Object.freeze({ captureEvidence: runtime.captureEvidence,
    verifyEvidence: runtime.verifyEvidence });
}
export function captureHistoryLifecycleEvidence(options = {}, dependencies = {}) {
  return createHistoryLifecycleRepositoryAdapter(options, dependencies).captureEvidence(); }
function createRuntime(options, dependencies) {
  const repository = realpathSync(path.resolve(required(options.repository, "repository")));
  const comparisonRef = fullRef(options.comparisonRef, "comparison ref");
  const remoteName = optionalName(options.remoteName, "remote name");
  const providerRepository = optionalRepository(options.providerRepository);
  const providerKind = providerRepository ? required(dependencies.providerKind
    || (dependencies.providerChanges ? "" : "github"), "provider kind") : null;
  const bounds = normalizeBounds(options.bounds);
  const inheritedEnvironment = { ...(dependencies.environment || process.env) };
  for (const name of Object.keys(inheritedEnvironment)) if (name.startsWith("GIT_")) delete inheritedEnvironment[name];
  const environment = Object.freeze({ ...inheritedEnvironment, GIT_OPTIONAL_LOCKS: "0",
    GIT_NO_REPLACE_OBJECTS: "1", GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0",
    GIT_PAGER: "cat", LC_ALL: "C", LANG: "C" });
  const execute = dependencies.execute || ((command, args, settings = {}) => execFileSync(command, args, {
    cwd: repository, encoding: null, maxBuffer: bounds.maxOutputBytes,
    stdio: ["ignore", "pipe", "pipe"], ...settings,
  }));
  const providerReader = dependencies.providerChanges || null;
  let commandCount = 0; let aggregateEntries = 0; let aggregateBytes = 0;
  function command(command, args, { cwd = repository, allow = [] } = {}) {
    if (++commandCount > bounds.maxCommands) fail("aggregate command bound");
    if (command === "git") assertReadOnlyGit(args);
    try {
      const output = execute(command, args, { cwd, env: environment, encoding: null,
        maxBuffer: bounds.maxOutputBytes, stdio: ["ignore", "pipe", "pipe"] });
      const bytes = Buffer.isBuffer(output) ? output : Buffer.from(String(output || "")); countBytes(bytes.length);
      return { status: 0, output: bytes };
    } catch (error) {
      const status = Number(error?.status);
      if (allow.includes(status)) {
        const output = error?.stdout || Buffer.alloc(0);
        const bytes = Buffer.isBuffer(output) ? output : Buffer.from(String(output)); countBytes(bytes.length);
        return { status, output: bytes };
      }
      throw new Error(`${command} ${args[0] || "command"} failed read-only (${Number.isFinite(status) ? status : "unknown"}).`);
    }
  }
  const gitRaw = (args, settings) => command("git", args, settings).output;
  const gitText = (args, settings) => strictText(gitRaw(args, settings), `git ${args[0]} output`).trim();
  const topLevel = realpathSync(gitText(["rev-parse", "--show-toplevel"]));
  if (topLevel !== repository) fail("repository root");
  const gitCommonDir = realpathSync(path.resolve(repository, gitText(["rev-parse", "--git-common-dir"])));
  const objectFormat = gitText(["rev-parse", "--show-object-format"]);
  if (!new Set(["sha1", "sha256"]).has(objectFormat)) fail("object format");
  const oidPattern = objectFormat === "sha1" ? /^[0-9a-f]{40}$/u : /^[0-9a-f]{64}$/u;
  const oid = (value, label, zero = false) => requireOid(value, oidPattern, label, zero);
  function captureEvidence() {
    commandCount = 0; aggregateEntries = 0; aggregateBytes = 0;
    const before = frontier();
    const pinned = before.comparisonRevision;
    const comparisonAncestors = commitSet(["rev-list", pinned], "comparison ancestry");
    const knownCommits = commitSet(["rev-list", "--all", "--reflog"], "repository commits");
    const leaseAnalysis = normalizeLeases(before.leaseFile, bounds, oidPattern);
    const recoveryAnchors = normalizeAnchors(before.refs, bounds, oidPattern);
    countEntries(leaseAnalysis.rawEntries.length + recoveryAnchors.length, "lease and anchor entries");
    const branches = analyzeBranches(before, pinned, comparisonAncestors, knownCommits);
    const stashes = analyzeStashes(before, recoveryAnchors, leaseAnalysis.rawEntries);
    const providerChanges = analyzeProviderChanges(before.providerChanges, pinned);
    const after = frontier();
    if (before.frontier.digest !== after.frontier.digest) throw new Error(
      "History lifecycle repository frontier drifted during pinned analysis.");
    const rootWorktree = before.worktrees.find(item => samePath(item.path, repository));
    if (!rootWorktree) fail("root worktree registration");
    const reasons = [];
    if (!remoteName) reasons.push("remote-not-requested"); if (!providerRepository) reasons.push("provider-not-requested");
    if (before.shallow.present) reasons.push("shallow-history"); if (before.grafts.present) reasons.push("grafts-present");
    if (before.refs.some(item => item.ref.startsWith("refs/replace/"))) reasons.push("replace-refs-present");
    if (providerChanges.some(item => !item.complete)) reasons.push("provider-object-incomplete");
    const core = {
      schema: HISTORY_LIFECYCLE_EVIDENCE_SCHEMA,
      repository: {
        root: repository, gitCommonDir, objectFormat, shallow: publicFile(before.shallow),
        replaceRefs: before.refs.filter(item => item.ref.startsWith("refs/replace/"))
          .map(item => ({ ref: item.ref, revision: item.revision })),
        grafts: publicFile(before.grafts),
      },
      comparison: {
        ref: comparisonRef, revision: pinned, tree: objectTree(pinned),
        clean: rootWorktree.head === pinned && rootWorktree.branch === comparisonRef
          && before.statuses.get(rootWorktree.path)?.length === 0,
        frontierBefore: before.frontier, frontierAfter: after.frontier, stable: true,
        remote: before.remoteComparison,
        provider: providerRepository ? { kind: providerKind, repository: providerRepository } : null,
      },
      worktrees: before.worktrees, branches, stashes, recoveryAnchors,
      leases: leaseAnalysis.projection, providerChanges,
      completeness: {
        refs: true, worktrees: true, stashes: true, recoveryAnchors: true, leases: true,
        providerChanges: Boolean(providerRepository) && providerChanges.every(item => item.complete),
        bounded: true, corruptionFree: true, raceFree: true,
        reasons: byteSort(reasons),
      },
    };
    return deepFreeze({ ...core, evidenceDigest: digestValue(core) });
  }
  function verifyEvidence(evidence) {
    commandCount = 0; aggregateEntries = 0; aggregateBytes = 0;
    if (!evidence || typeof evidence !== "object" || !evidence.comparison?.frontierAfter?.digest) fail("verification evidence");
    const current = frontier();
    if (current.frontier.digest !== evidence.comparison.frontierAfter.digest) throw new Error(
      "History lifecycle repository frontier drifted after evidence capture.");
    return evidence;
  }
  function frontier() {
    const comparisonRevision = oid(gitText(["rev-parse", "--verify", `${comparisonRef}^{commit}`]), "comparison revision");
    const refs = readRefs();
    const worktreeRaw = gitRaw(["worktree", "list", "--porcelain", "-z"]);
    const worktrees = normalizeWorktrees(parseWorktreeBytes(worktreeRaw), bounds, oidPattern);
    countEntries(worktrees.length, "worktrees");
    const statuses = new Map(worktrees.map(item => [item.path, worktreeStatus(item)]));
    const leaseFile = metadataFile(path.join(gitCommonDir, "agentic-canvas-os", "writer-leases.json"));
    const shallow = metadataFile(path.join(gitCommonDir, "shallow"));
    const grafts = metadataFile(path.join(gitCommonDir, "info", "grafts"));
    const reflogs = readReflogSources(refs);
    const remoteHeads = remoteName ? readRemoteHeads(remoteName) : [];
    const remoteRef = remoteName ? comparisonRemoteRef(comparisonRef, remoteName) : null;
    const remoteRevision = remoteRef ? remoteHeads.find(item => item.ref === remoteRef)?.revision || null : null;
    if (remoteName && (!remoteRef || !remoteRevision)) fail("remote comparison ref");
    const providerChanges = providerRepository ? readProviderChanges(refs) : [];
    const statusProjection = worktrees.map(item => ({ path: item.path,
      statusDigest: statuses.get(item.path) ? hash(statuses.get(item.path)) : null }));
    const parts = {
      comparisonRevision,
      refsDigest: digestValue({ refs, reflogSources: reflogs.public,
        shallow: publicFile(shallow), grafts: publicFile(grafts) }),
      worktreesDigest: digestValue(worktrees),
      leaseSourceDigest: leaseFile.digest,
      statusDigest: digestValue(statusProjection),
      remoteDigest: remoteName ? digestValue(remoteHeads) : null,
      providerDigest: providerRepository ? digestValue(providerChanges) : null,
    };
    return {
      comparisonRevision, refs, worktrees, statuses, leaseFile, shallow, grafts, reflogs,
      remoteHeads, providerChanges,
      remoteComparison: remoteName ? { ref: remoteRef, revision: remoteRevision } : null,
      frontier: deepFreeze({ ...parts, digest: digestValue(parts) }),
    };
  }
  function readRefs() {
    const format = "%(refname)%00%(objectname)%00%(objecttype)%00%(*objectname)%00%(upstream)%00%(symref)";
    const rows = bufferLines(gitRaw(["for-each-ref", "--sort=refname", `--format=${format}`]))
      .map(bytes => strictText(bytes, "ref record")).filter(Boolean).map(line => {
        const [ref, revision, objectType, peeled, upstreamRef, symref] = line.split("\0");
        if (!ref || !objectType) fail("ref record");
        return { ref, revision: oid(revision, `${ref} revision`), objectType,
          peeledRevision: peeled ? oid(peeled, `${ref} peeled revision`) : null,
          upstreamRef: upstreamRef ? fullRef(upstreamRef, `${ref} upstream ref`) : null,
          symref: symref ? fullRef(symref, `${ref} symbolic target`) : null };
      });
    bounded(rows, bounds.maxRefs, "refs");
    countEntries(rows.length, "refs");
    const branches = rows.filter(item => item.ref.startsWith("refs/heads/"));
    bounded(branches, bounds.maxBranches, "branches");
    return byteSort(rows, item => item.ref);
  }
  function readReflogSources(refs) {
    const relevant = new Set(refs.filter(item => item.ref === "refs/stash" || item.ref.startsWith("refs/heads/")).map(item => item.ref));
    const tokens = bufferParts(gitRaw(["reflog", "show", "--all", "--format=%gD%x00%H", "-z"])).filter(item => item.length);
    if (tokens.length % 2) fail("Git reflog inventory"); const inventory = new Map([...relevant].map(ref => [ref, []]));
    for (let index = 0; index < tokens.length; index += 2) {
      const selector = strictText(tokens[index], "Git reflog selector"); const match = selector.match(/^(.*)@\{([0-9]+)\}$/u);
      if (!match || !relevant.has(match[1])) continue;
      const position = Number(match[2]); if (position !== inventory.get(match[1]).length) fail("Git reflog order");
      inventory.get(match[1]).push(oid(strictText(tokens[index + 1], "Git reflog revision"), "Git reflog revision"));
    }
    countEntries([...inventory.values()].reduce((total, entries) => total + entries.length, 0), "Git reflog entries");
    const files = new Map(); const publicEntries = [];
    for (const ref of relevant) {
      const entries = inventory.get(ref);
      const source = metadataFile(path.join(gitCommonDir, "logs", ...ref.split("/")));
      files.set(ref, source); publicEntries.push({ ref, ...publicFile(source),
        gitDigest: digestValue(entries), entryCount: entries.length });
    }
    return { files, inventory, public: publicEntries };
  }
  function readRemoteHeads(name) {
    const rows = bufferLines(gitRaw(["ls-remote", "--heads", name]))
      .map(bytes => strictText(bytes, "remote head record")).filter(Boolean).map(line => {
      const match = line.match(/^([0-9a-f]+)\t(refs\/heads\/[^\s]+)$/u);
      if (!match) fail("remote head record");
      return { revision: oid(match[1], "remote head revision"), ref: fullRef(match[2], "remote head ref") };
    });
    bounded(rows, bounds.maxRefs, "remote heads");
    countEntries(rows.length, "remote heads");
    const sorted = byteSort(rows, item => item.ref);
    if (new Set(sorted.map(item => item.ref)).size !== sorted.length) fail("duplicate remote heads");
    return sorted;
  }
  function readReflog(ref, pinnedAncestors, knownCommits, sources) {
    const source = sources.files.get(ref); const observed = sources.inventory.get(ref) || []; let transitions; let reason = null;
    if (source?.present) {
      transitions = bufferLines(source.bytes).filter(line => line.length).map(line => {
        const fields = strictText(line, `${ref} reflog record`).split(" "); if (fields.length < 2) fail(`${ref} reflog record`);
        const oldRevision = oid(fields[0], `${ref} old revision`, true); return { oldRevision: /^0+$/u.test(oldRevision) ? null : oldRevision,
          newRevision: oid(fields[1], `${ref} new revision`) };
      });
      if (digestValue(transitions.map(item => item.newRevision).reverse()) !== digestValue(observed)) fail("reflog backend drift");
    } else transitions = observed.map((newRevision, index) => ({ newRevision, oldRevision: observed[index + 1] || null }));
    bounded(transitions, bounds.maxRefs, `${ref} reflog entries`); countEntries(transitions.length, "reflog entries");
    const revisions = transitions.flatMap(item => [item.oldRevision, item.newRevision]).filter(Boolean);
    const uniqueRevisions = byteSort([...new Set(revisions)]); const uncontainedRevisions = [];
    let complete = Boolean(source?.present && transitions.length); if (!complete) reason = transitions.length ? "initial-old-unobservable" : "absent";
    for (const revision of uniqueRevisions) {
      if (!knownCommits.has(revision)) {
        const result = command("git", ["rev-parse", "--verify", "--quiet", `${revision}^{commit}`], { allow: [1] });
        if (result.status === 1) { complete = false; reason = "non-commit-or-missing-entry"; continue; }
        knownCommits.add(revision);
      }
      if (!pinnedAncestors.has(revision)) uncontainedRevisions.push(revision);
    }
    return { complete, reason: complete ? null : reason, entryCount: transitions.length,
      digest: digestValue(transitions), uniqueRevisions, uncontainedRevisions };
  }
  function analyzeBranches(snapshot, pinned, pinnedAncestors, knownCommits) {
    const remote = new Map(snapshot.remoteHeads.map(item => [item.ref, item.revision]));
    return snapshot.refs.filter(item => item.ref.startsWith("refs/heads/")).map(item => {
      const counts = gitText(["rev-list", "--left-right", "--count", `${pinned}...${item.revision}`]).split(/\s+/u).map(Number);
      if (counts.length !== 2 || counts.some(value => !Number.isSafeInteger(value) || value < 0)) fail("branch counts");
      const relationship = relationshipTo(item.revision, pinned);
      const patch = patchAdvisory(item.revision, pinned, relationship);
      const short = item.ref.slice("refs/heads/".length);
      return {
        ref: item.ref,
        revision: item.revision,
        tree: objectTree(item.revision),
        upstreamRef: item.upstreamRef,
        remoteRevision: remote.get(`refs/heads/${short}`) || null,
        relationship,
        ahead: counts[1],
        behind: counts[0],
        reflog: readReflog(item.ref, pinnedAncestors, knownCommits, snapshot.reflogs),
        patch,
      };
    });
  }
  function relationshipTo(revision, pinned) {
    if (revision === pinned) return "same";
    if (isAncestor(revision, pinned)) return "ancestor";
    if (isAncestor(pinned, revision)) return "ahead";
    const base = command("git", ["merge-base", revision, pinned], { allow: [1] });
    return base.status === 0 && base.output.toString("utf8").trim() ? "diverged" : "unrelated";
  }
  function isAncestor(older, newer) {
    return command("git", ["merge-base", "--is-ancestor", older, newer], { allow: [1] }).status === 0;
  }
  function patchAdvisory(revision, pinned, relationship) {
    const advisory = "non-authoritative";
    if (["same", "ancestor"].includes(relationship)) return { status: "not-evaluated", id: null, advisory,
      localOnlyCount: 0, accountedCount: 0 };
    const commitRows = gitText(["rev-list", "--parents", `${pinned}..${revision}`]).split(/\r?\n/u).filter(Boolean);
    bounded(commitRows, bounds.maxRefs, "patch commits"); countEntries(commitRows.length, "patch commits");
    const commits = new Set(); let singleParent = true;
    for (const row of commitRows) {
      const values = row.split(" ").map(value => oid(value, "patch commit ancestry"));
      if (values.length !== 2) singleParent = false;
      commits.add(values[0]);
    }
    const lines = gitText(["cherry", pinned, revision]).split(/\r?\n/u).filter(Boolean);
    bounded(lines, bounds.maxRefs, "patch rows"); countEntries(lines.length, "patch rows");
    const accounted = new Set();
    for (const line of lines) {
      const match = line.match(/^([+-]) ([0-9a-f]+)$/u);
      if (!match) fail("patch row");
      const commit = oid(match[2], "patch row commit");
      if (!commits.has(commit) || accounted.has(commit)) fail("patch accounting");
      accounted.add(commit);
    }
    const fullyAccounted = commitRows.length > 0 && singleParent && accounted.size === commits.size;
    return { status: fullyAccounted ? (lines.every(line => line.startsWith("- ")) ? "equivalent" : "different") : "incomplete",
      id: fullyAccounted ? digestValue(lines) : null, advisory,
      localOnlyCount: commits.size, accountedCount: accounted.size };
  }
  function analyzeStashes(snapshot, anchors, rawLeases) {
    const stashRef = snapshot.refs.find(item => item.ref === "refs/stash");
    if (!stashRef) return [];
    const rows = bufferLines(gitRaw(["reflog", "show", "--format=%H%x00%gd%x00%gs", "refs/stash"]))
      .map(bytes => strictText(bytes, "stash reflog record")).filter(Boolean).map(line => {
        const [revision, selector, subject] = line.split("\0");
        if (!selector || subject === undefined) fail("stash reflog record");
        return { revision: oid(revision, "stash revision"), selector, subject };
      });
    bounded(rows, bounds.maxStashes, "stashes");
    countEntries(rows.length, "stashes");
    const groups = new Map();
    for (const row of rows) {
      const group = groups.get(row.revision) || { selectors: [], subjects: [] };
      group.selectors.push(row.selector); group.subjects.push(row.subject); groups.set(row.revision, group);
    }
    return byteSort([...groups].map(([revision, group]) => {
      const commit = gitText(["show", "-s", "--format=%P%x00%T", revision]).split("\0");
      const parents = commit[0].split(" ").filter(Boolean).map(value => oid(value, "stash parent"));
      if (![2, 3].includes(parents.length)) fail("stash parent anatomy");
      const indexParents = gitText(["show", "-s", "--format=%P", parents[1]]).split(" ").filter(Boolean)
        .map(value => oid(value, "stash index parent"));
      const untrackedParents = parents[2]
        ? gitText(["show", "-s", "--format=%P", parents[2]]).split(" ").filter(Boolean) : [];
      if (indexParents.length !== 1 || indexParents[0] !== parents[0] || untrackedParents.length !== 0) {
        fail("stash index or untracked anatomy");
      }
      const trees = { head: objectTree(parents[0]), index: objectTree(parents[1]),
        worktree: oid(commit[1], "stash worktree tree"), untracked: parents[2] ? objectTree(parents[2]) : null };
      const bindings = [
        ...anchors.filter(anchor => anchor.revision === revision || anchor.peeledRevision === revision)
          .map(anchor => ({ kind: "anchor", id: anchor.ref, status: "exact" })),
        ...rawLeases.filter(item => item.lease.status === "parked" && item.lease.parkStashSha === revision
          && item.lease.parkStashStatus === "pending")
          .map(item => ({ kind: "lease", id: item.branchRef, status: item.lease.parkStashStatus })),
      ];
      return {
        revision,
        selectors: byteSort(group.selectors),
        parents,
        anatomy: { status: "canonical", reason: null },
        trees,
        messageDigest: digestValue(byteSort([...new Set(group.subjects)])),
        deltas: {
          headToIndex: treeDelta(trees.head, trees.index),
          indexToWorktree: treeDelta(trees.index, trees.worktree),
          headToWorktree: treeDelta(trees.head, trees.worktree),
        },
        untrackedEntries: trees.untracked ? treeEntries(trees.untracked) : [],
        bindings: byteSort(bindings, item => `${item.kind}\0${item.id}`),
        projection: { status: "unknown", digest: null },
      };
    }), item => item.revision);
  }
  function treeDelta(oldTree, newTree) {
    const tokens = bufferParts(gitRaw(["diff-tree", "--raw", "-z", "--no-abbrev", "--no-renames", "-r", oldTree, newTree]))
      .map(bytes => strictText(bytes, "stash delta record")).filter(Boolean);
    const entries = [];
    for (let index = 0; index < tokens.length; index += 2) {
      const match = tokens[index].match(/^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])$/u);
      const filePath = tokens[index + 1];
      if (!match || filePath === undefined) fail("stash delta record");
      entries.push({ path: filePath, status: match[5], oldMode: match[1], oldOid: oid(match[3], "old delta object", true),
        newMode: match[2], newOid: oid(match[4], "new delta object", true) });
    }
    bounded(entries, bounds.maxDeltaEntries, "stash delta entries");
    countEntries(entries.length, "stash delta entries");
    const sorted = byteSort(entries, item => item.path);
    return { digest: digestValue(sorted), entries: sorted };
  }
  function treeEntries(tree) {
    const entries = bufferParts(gitRaw(["ls-tree", "-rz", "--full-tree", tree]))
      .map(bytes => strictText(bytes, "untracked tree entry")).filter(Boolean).map(row => {
      const match = row.match(/^([0-7]{6}) [^ ]+ ([0-9a-f]+)\t([\s\S]+)$/u);
      if (!match) fail("untracked tree entry");
      return { path: match[3], mode: match[1], oid: oid(match[2], "untracked object") };
    });
    bounded(entries, bounds.maxDeltaEntries, "untracked entries");
    countEntries(entries.length, "untracked entries");
    return byteSort(entries, item => item.path);
  }
  function analyzeProviderChanges(changes, pinned) {
    return byteSort(changes.map(change => {
      const sourceRevision = oid(change.sourceRevision, `${change.id} source revision`);
      const integrationRevision = change.integrationRevision
        ? oid(change.integrationRevision, `${change.id} integration revision`) : null;
      const sourceTree = optionalObjectTree(sourceRevision);
      const integrationTree = optionalObjectTree(integrationRevision);
      const integratedInComparison = integrationRevision
        ? optionalAncestor(integrationRevision, pinned)
        : false;
      return { ...change, sourceRevision, integrationRevision, sourceTree, integrationTree, integratedInComparison,
        complete: change.complete && Boolean(sourceTree) && (!integrationRevision || Boolean(integrationTree))
          && (change.state !== "merged" || Boolean(integrationRevision)) };
    }), item => item.id);
  }
  function readProviderChanges(refs) {
    const sourceRefs = byteSort(refs.filter(item => item.ref.startsWith("refs/heads/")).map(item => item.ref));
  const input = providerReader
      ? providerReader({ repository, providerRepository, sourceRefs, limit: bounds.maxProviderChanges + 1 })
      : defaultProviderChanges({ providerRepository, sourceRefs, limit: bounds.maxProviderChanges + 1,
        readPulls: () => strictText(command("gh", ["pr", "list", "--repo", providerRepository,
          "--state", "all", "--limit", String(bounds.maxProviderChanges + 1),
          "--json", PROVIDER_FIELDS]).output, "provider output") });
  const normalized = byteSort(normalizeProviderInput(input, bounds), item => item.id); countEntries(normalized.length, "provider changes");
  if (new Set(normalized.map(item => item.id)).size !== normalized.length || normalized.some(item => item.provider !== providerKind)) fail("provider identity drift");
  return normalized;
  }
  function objectTree(revision) { return oid(gitText(["rev-parse", "--verify", `${revision}^{tree}`]), "tree revision"); }
  function optionalObjectTree(revision) {
    if (!revision) return null; const result = command("git", ["rev-parse", "--verify", "--quiet",
      `${revision}^{commit}`], { allow: [1] }); return result.status === 0 ? objectTree(revision) : null; }
  function optionalAncestor(older, newer) {
    const exists = command("git", ["rev-parse", "--verify", "--quiet", `${older}^{commit}`], { allow: [1] });
    return exists.status === 0 && isAncestor(older, newer); }
  function worktreeStatus(item) { return item.bare || item.prunable ? null
    : gitRaw(["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd: item.path }); }
  function metadataFile(filePath) {
    try {
      const stat = lstatSync(filePath);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > bounds.maxFileBytes) fail("metadata file");
      const bytes = readFileSync(filePath);
      countBytes(bytes.length);
      return { present: true, digest: hash(bytes), bytes };
    } catch (error) {
      if (error?.code === "ENOENT") return { present: false, digest: null, bytes: null };
      throw error;
    }
  }
  function countEntries(count, label) { aggregateEntries += count;
    if (aggregateEntries > bounds.maxAggregateEntries) fail(`${label} aggregate bound`); }
  function commitSet(args, label) {
    const rows = gitText(args).split(/\r?\n/u).filter(Boolean).map(value => oid(value, label));
    countEntries(rows.length, label); return new Set(rows);
  }
  function countBytes(count) { aggregateBytes += count;
    if (aggregateBytes > bounds.maxAggregateBytes) fail("aggregate byte bound"); }
  return { captureEvidence, verifyEvidence };
}
function normalizeLeases(source, bounds, oidPattern) {
  if (!source.present) return { projection: { schema: null, revision: null, digest: null, entries: [] }, rawEntries: [] };
  let registry;
  try { registry = JSON.parse(strictText(source.bytes, "writer lease registry")); } catch { fail("writer lease registry JSON"); }
  if (!registry || Array.isArray(registry) || typeof registry !== "object"
    || typeof registry.schema !== "string" || !Number.isSafeInteger(registry.revision) || registry.revision < 0
    || !registry.leases || Array.isArray(registry.leases) || typeof registry.leases !== "object") fail("writer lease registry");
  const rawEntries = Object.entries(registry.leases).map(([branch, lease]) => {
    if (!lease || Array.isArray(lease) || typeof lease !== "object") fail("writer lease entry");
    const branchRef = fullRef(branch.startsWith("refs/heads/") ? branch : `refs/heads/${branch}`, "lease branch");
    const status = required(lease.status, "writer lease status");
    const parkStashSha = lease.parkStashSha
      ? requireOid(lease.parkStashSha, oidPattern, "lease park stash revision") : null;
    const parkStashStatus = lease.parkStashStatus ? required(lease.parkStashStatus, "lease park stash status") : null;
    return { branchRef, lease, projection: { branchRef, status, leaseDigest: digestValue(lease),
      authority: TERMINAL.has(status) ? "terminal" : NONTERMINAL.has(status) ? "nonterminal" : "unknown",
      parkStashSha, parkStashStatus } };
  });
  bounded(rawEntries, bounds.maxLeaseEntries, "lease entries");
  const sorted = byteSort(rawEntries, item => item.branchRef);
  if (new Set(sorted.map(item => item.branchRef)).size !== sorted.length) fail("duplicate lease branches");
  return { projection: { schema: registry.schema, revision: registry.revision, digest: source.digest,
    entries: sorted.map(item => item.projection) }, rawEntries: sorted };
}
function normalizeWorktrees(records, bounds, oidPattern) {
  bounded(records, bounds.maxWorktrees, "worktrees");
  return byteSort(records.map(item => {
    const bare = Boolean(item.bare); const prunable = Boolean(item.prunable);
    if (!path.isAbsolute(item.path) || (!item.head && !bare && !prunable)) fail("worktree record");
    return { path: path.resolve(item.path), head: item.head ? requireOid(item.head, oidPattern, "worktree head") : null,
      branch: item.branch ? fullRef(item.branch, "worktree branch") : null,
      detached: Boolean(item.detached), bare, locked: Boolean(item.locked), prunable };
  }), item => item.path);
}
function normalizeAnchors(refs, bounds, oidPattern) {
  const anchors = refs.filter(item => item.ref.startsWith("refs/heads/") || item.ref.startsWith("refs/tags/")
    || /^refs\/agentic-canvas-os\/(?:history-retirement|parked|recovery|rescue)\//u.test(item.ref)
    || item.ref.startsWith("refs/original/")).map(item => ({
    ref: item.ref,
    revision: requireOid(item.revision, oidPattern, "anchor revision"),
    peeledRevision: item.peeledRevision || item.revision,
    kind: item.ref.startsWith("refs/heads/") ? "head" : item.ref.startsWith("refs/tags/") ? "tag"
      : item.ref.startsWith("refs/original/") ? "original"
        : item.ref.split("/")[2],
  }));
  bounded(anchors, bounds.maxAnchors, "recovery anchors");
  return byteSort(anchors, item => item.ref);
}
function normalizeProviderInput(value, bounds) {
  if (!Array.isArray(value)) fail("provider changes");
  if (value.length > bounds.maxProviderChanges) fail("provider changes bound");
  return value.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) fail("provider change");
    exactKeys(item, ["complete", "draft", "id", "integrationRevision", "provider", "sourceRef", "sourceRevision", "state", "targetRef"], "provider change");
    if (typeof item.draft !== "boolean" || typeof item.complete !== "boolean") fail("provider change booleans");
    return {
      id: required(item.id, "provider change id"), provider: required(item.provider, "provider"),
      state: required(item.state, "provider state"), draft: item.draft,
      sourceRef: fullRef(item.sourceRef, "provider source ref"),
      sourceRevision: item.sourceRevision || null,
      targetRef: fullRef(item.targetRef, "provider target ref"),
      integrationRevision: item.integrationRevision || null,
      complete: item.complete,
    };
  });
}
const PROVIDER_FIELDS = "number,url,state,isDraft,headRefName,headRefOid,baseRefName,baseRefOid,mergeCommit";
function defaultProviderChanges({ providerRepository, sourceRefs, limit, readPulls }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(providerRepository)) fail("GitHub provider repository");
  let rows;
  try { rows = JSON.parse(readPulls()); } catch { fail("provider JSON"); }
  if (!Array.isArray(rows) || rows.length >= limit) fail("provider pagination bound");
  const allowed = new Set(sourceRefs.map(ref => ref.slice("refs/heads/".length))); const byId = new Map();
  for (const item of rows.filter(candidate => allowed.has(candidate.headRefName))) {
    if (!Number.isSafeInteger(item.number) || item.number < 1 || typeof item.url !== "string"
      || typeof item.state !== "string" || typeof item.isDraft !== "boolean"
      || typeof item.headRefName !== "string" || typeof item.headRefOid !== "string"
      || typeof item.baseRefName !== "string" || (item.mergeCommit !== null
        && (typeof item.mergeCommit !== "object" || typeof item.mergeCommit.oid !== "string"))) fail("GitHub provider row");
    const id = `github-pull-request:${item.number}`; const prior = byId.get(id);
    if (prior && digestValue(prior) !== digestValue(item)) fail("provider duplicate drift");
    byId.set(id, item);
  }
  return [...byId.values()].map(item => ({ id: `github-pull-request:${item.number}`, provider: "github",
    state: typeof item.state === "string" ? item.state.toLowerCase() : item.state, draft: item.isDraft,
    sourceRef: `refs/heads/${item.headRefName}`, sourceRevision: item.headRefOid,
    targetRef: `refs/heads/${item.baseRefName}`, integrationRevision: item.mergeCommit?.oid || null,
    complete: Boolean(item.url && item.headRefName && item.headRefOid && item.baseRefName) }));
}
function normalizeBounds(input = {}) {
  const result = {};
  for (const [key, fallback] of Object.entries(DEFAULT_BOUNDS)) {
    const value = input?.[key] ?? fallback;
    if (!Number.isSafeInteger(value) || value < 1 || value > fallback) fail(`${key} bound`); result[key] = value;
  }
  return Object.freeze(result); }
function comparisonRemoteRef(ref, remoteName) {
  if (ref.startsWith("refs/heads/")) return ref;
  const prefix = `refs/remotes/${remoteName}/`;
  if (ref.startsWith(prefix)) return `refs/heads/${ref.slice(prefix.length)}`;
  return null;
}
function assertReadOnlyGit(args) {
  if (!Array.isArray(args) || !READ_ONLY_GIT.has(args[0])) fail("mutating Git command");
  if (args[0] === "worktree" && args[1] !== "list") fail("mutating worktree command");
  if (args[0] === "reflog" && !new Set(["exists", "show"]).has(args[1])) fail("mutating reflog command");
}
function publicFile(value) { return { present: value.present, digest: value.digest }; }
function exactKeys(value, keys, label) { if (byteSort(Object.keys(value)).join("\0") !== byteSort(keys).join("\0")) fail(`${label} fields`); }
function fullRef(value, label) {
  const text = required(value, label); const parts = text.split("/");
  if (!text.startsWith("refs/") || text.endsWith("/") || text.includes("..") || text.includes("@{")
    || /[\u0000-\u0020\u007f~^:?*\\\[]/u.test(text)
    || parts.some(part => !part || part === "." || part.endsWith(".lock"))) fail(label);
  return text;
}
function optionalName(value, label) { if (value === undefined || value === null || value === "") return null; const text = required(value, label); if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(text)) fail(label); return text; }
function optionalRepository(value) { if (value === undefined || value === null || value === "") return null; const text = required(value, "provider repository"); if (text.length > 512 || /[\u0000-\u001f\u007f]/u.test(text)) fail("provider repository"); return text; }
function required(value, label) { if (typeof value !== "string" || !value || value !== value.trim()) fail(label); return value; }
function bounded(values, maximum, label) { if (values.length > maximum) fail(`${label} exceed bound`); return values; }
function hash(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function byteSort(values, key = value => value) { return [...values].sort((a, b) => Buffer.compare(Buffer.from(String(key(a))), Buffer.from(String(key(b))))); }
function bufferParts(bytes, separator = 0) {
  const values = []; let start = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === separator) { values.push(bytes.subarray(start, index)); start = index + 1; }
  }
  if (start < bytes.length) values.push(bytes.subarray(start));
  return values;
}
function bufferLines(bytes) { return bufferParts(bytes, 10); }
function strictText(bytes, label) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!Buffer.from(text, "utf8").equals(Buffer.from(bytes))) fail(label); return text;
  } catch { fail(`${label} UTF-8`); } }
function parseWorktreeBytes(bytes) {
  const records = []; let current = null;
  for (const token of bufferParts(bytes)) {
    if (!token.length) continue;
    const line = strictText(token, "worktree record");
    if (line.startsWith("worktree ")) {
      if (current) records.push(current);
      current = { path: line.slice(9) };
    } else if (!current) fail("worktree record order");
    else if (line.startsWith("HEAD ")) current.head = line.slice(5);
    else if (line.startsWith("branch ")) current.branch = line.slice(7);
    else if (line === "detached") current.detached = true;
    else if (line === "bare") current.bare = true;
    else if (line === "locked" || line.startsWith("locked ")) current.locked = true;
    else if (line === "prunable" || line.startsWith("prunable ")) current.prunable = true;
    else fail("unknown worktree field");
  }
  if (current) records.push(current);
  return records;
}
function samePath(a, b) { return path.resolve(a) === path.resolve(b); }
function requireOid(value, pattern, label, zero = false) { if (!(pattern.test(String(value)) || (zero && /^0+$/.test(String(value))))) fail(label); return String(value); }
function deepFreeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const item of Object.values(value)) deepFreeze(item); } return value; }
function fail(label) { throw new Error(`History lifecycle evidence rejected ${label}.`); }
