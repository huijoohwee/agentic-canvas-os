import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  captureHistoryLifecycleEvidence,
  createHistoryLifecycleRepositoryAdapter,
} from "../scripts/history-lifecycle-repository-adapter.mjs";
import { normalizeHistoryLifecycleEvidence } from "../scripts/history-lifecycle-contract.mjs";

const gitEnvironment = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", LC_ALL: "C", LANG: "C" };

function git(repository, ...args) {
  return execFileSync("git", args, { cwd: repository, env: gitEnvironment, encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function makeRepository({ remote = false, objectFormat = "sha1", refFormat = "files" } = {}) {
  const container = mkdtempSync(path.join(os.tmpdir(), "history-lifecycle-adapter-"));
  const repository = path.join(container, "repository"); mkdirSync(repository);
  git(repository, "init", "-b", "main", `--object-format=${objectFormat}`, `--ref-format=${refFormat}`);
  git(repository, "config", "user.name", "Lifecycle Fixture");
  git(repository, "config", "user.email", "fixture@example.invalid");
  writeFileSync(path.join(repository, "base.txt"), "base\n");
  git(repository, "add", "base.txt"); git(repository, "commit", "-m", "base");
  const base = git(repository, "rev-parse", "HEAD");
  git(repository, "branch", "ancestor", base);
  writeFileSync(path.join(repository, "main.txt"), "main\n");
  git(repository, "add", "main.txt"); git(repository, "commit", "-m", "main advance");
  git(repository, "switch", "-c", "patch", base);
  writeFileSync(path.join(repository, "same.txt"), "same\n");
  git(repository, "add", "same.txt"); git(repository, "commit", "-m", "equivalent patch");
  const patchRevision = git(repository, "rev-parse", "HEAD");
  git(repository, "switch", "main");
  writeFileSync(path.join(repository, "same.txt"), "same\n");
  git(repository, "add", "same.txt"); git(repository, "commit", "-m", "same patch on main");
  git(repository, "switch", "-c", "unique");
  writeFileSync(path.join(repository, "unique.txt"), "unique\n");
  git(repository, "add", "unique.txt"); git(repository, "commit", "-m", "unique patch");
  const uniqueRevision = git(repository, "rev-parse", "HEAD");
  git(repository, "switch", "main");
  for (const branch of ["z-order", "\uE000-order", "😀-order"]) git(repository, "branch", branch);
  git(repository, "branch", "no-message");
  const mainAtReflog = git(repository, "rev-parse", "HEAD");
  const resetOnlyTip = execFileSync("git", ["commit-tree", `${mainAtReflog}^{tree}`, "-p", mainAtReflog], {
    cwd: repository, env: gitEnvironment, input: "raw old-only recovery tip\n", encoding: "utf8" }).trim();
  git(repository, "branch", "reset-only");
  if (refFormat === "files") {
    writeFileSync(path.join(repository, ".git", "logs", "refs", "heads", "no-message"),
      `${"0".repeat(mainAtReflog.length)} ${mainAtReflog} Fixture <fixture@example.invalid> 1 +0000\n`);
    writeFileSync(path.join(repository, ".git", "logs", "refs", "heads", "reset-only"),
      `${resetOnlyTip} ${mainAtReflog} Fixture <fixture@example.invalid> 2 +0000\n`);
    rmSync(path.join(repository, ".git", "logs", "refs", "heads", "ancestor"));
  }
  writeFileSync(path.join(repository, "same.txt"), "same\nstaged\n"); git(repository, "add", "same.txt");
  writeFileSync(path.join(repository, "same.txt"), "same\nstaged\nunstaged\n");
  writeFileSync(path.join(repository, "untracked.txt"), "untracked\n");
  git(repository, "stash", "push", "-u", "-m", "fixture stash");
  const stash = git(repository, "rev-parse", "refs/stash");
  git(repository, "update-ref", "refs/agentic-canvas-os/parked/fixture", stash);
  git(repository, "update-ref", "refs/agentic-canvas-os/original/not-durable", stash);
  git(repository, "update-ref", "refs/transient/not-durable", stash);
  git(repository, "tag", "-a", "stash-anchor", stash, "-m", "stash anchor");
  const registryDirectory = path.join(repository, ".git", "agentic-canvas-os"); mkdirSync(registryDirectory);
  writeFileSync(path.join(registryDirectory, "writer-leases.json"), JSON.stringify({
    schema: "agentic-writer-lease-registry/v1", revision: 7,
    leases: { "agent/device.local/fixture": { status: "parked", epoch: 1,
      parkStashSha: stash, parkStashStatus: "pending" } },
  }));
  let remotePath = null;
  if (remote) {
    remotePath = path.join(container, "origin.git"); git(container, "init", "--bare", remotePath);
    git(repository, "remote", "add", "origin", remotePath); git(repository, "push", "origin", "--all");
  }
  return { container, repository, base, patchRevision, uniqueRevision, resetOnlyTip,
    mainRevision: git(repository, "rev-parse", "refs/heads/main"), stash, remotePath,
    cleanup: () => rmSync(container, { recursive: true, force: true }) };
}

function repositoryState(repository) {
  return [git(repository, "show-ref"), git(repository, "status", "--porcelain=v1", "-z"),
    git(repository, "reflog", "show", "--format=%H", "refs/stash"),
    git(repository, "worktree", "list", "--porcelain")];
}

test("captures deterministic bounded history anatomy without mutating repository state", () => {
  const fixture = makeRepository(); const calls = [];
  try {
    const before = repositoryState(fixture.repository);
    const execute = (command, args, settings) => {
      calls.push({ command, args: [...args], settings });
      return execFileSync(command, args, settings);
    };
    const adapter = createHistoryLifecycleRepositoryAdapter({ repository: fixture.repository,
      comparisonRef: "refs/heads/main" }, { execute,
      environment: { ...process.env, GIT_DIR: "/wrong", GIT_NAMESPACE: "wrong", GIT_TRACE: "/wrong/trace" } });
    const evidence = normalizeHistoryLifecycleEvidence(adapter.captureEvidence());
    assert.deepEqual(repositoryState(fixture.repository), before);
    assert.equal(adapter.verifyEvidence(evidence), evidence);
    assert.equal(evidence.comparison.stable, true);
    assert.equal(evidence.comparison.clean, true);
    const branches = new Map(evidence.branches.map(item => [item.ref, item]));
    assert.equal(branches.get("refs/heads/ancestor").relationship, "ancestor");
    assert.deepEqual([branches.get("refs/heads/ancestor").reflog.complete,
      branches.get("refs/heads/ancestor").reflog.reason], [false, "absent"]);
    assert.equal(branches.get("refs/heads/patch").patch.status, "equivalent");
    assert.equal(branches.get("refs/heads/patch").patch.localOnlyCount, 1);
    assert.equal(branches.get("refs/heads/unique").patch.status, "different");
    assert.ok(branches.get("refs/heads/unique").reflog.uncontainedRevisions.includes(fixture.uniqueRevision));
    assert.equal(branches.get("refs/heads/no-message").reflog.entryCount, 1);
    assert.ok(branches.get("refs/heads/reset-only").reflog.uncontainedRevisions.includes(fixture.resetOnlyTip));
    const sorted = [...evidence.branches].sort((a, b) => Buffer.compare(Buffer.from(a.ref), Buffer.from(b.ref)));
    assert.deepEqual(evidence.branches.map(item => item.ref), sorted.map(item => item.ref));
    const stash = evidence.stashes.find(item => item.revision === fixture.stash);
    assert.equal(stash.parents.length, 3); assert.equal(stash.anatomy.status, "canonical");
    assert.ok(stash.untrackedEntries.some(item => item.path === "untracked.txt"));
    assert.ok(stash.bindings.some(item => item.kind === "anchor" && item.id === "refs/tags/stash-anchor"));
    assert.ok(stash.bindings.some(item => item.kind === "lease" && item.status === "pending"));
    assert.equal(evidence.leases.entries[0].parkStashSha, fixture.stash);
    assert.equal(evidence.recoveryAnchors.some(item => item.ref === "refs/transient/not-durable"), false);
    assert.equal(evidence.recoveryAnchors.some(item => item.ref.includes("/original/not-durable")), false);
    assert.ok(evidence.recoveryAnchors.some(item => item.ref === "refs/heads/main"));
    assert.ok(calls.every(call => call.command !== "git" || !new Set(["add", "branch", "commit", "fetch", "push",
      "reset", "update-ref"]).has(call.args[0])));
    assert.ok(calls.every(call => call.settings.env.GIT_OPTIONAL_LOCKS === "0"
      && call.settings.env.GIT_NO_LAZY_FETCH === "1" && call.settings.env.LC_ALL === "C" && !("GIT_DIR" in call.settings.env)
      && !("GIT_NAMESPACE" in call.settings.env) && !("GIT_TRACE" in call.settings.env)));
  } finally { fixture.cleanup(); }
});

test("joins one explicit remote and injected provider while filtering to local source refs", () => {
  const fixture = makeRepository({ remote: true }); let reads = 0;
  try {
    const adapter = createHistoryLifecycleRepositoryAdapter({ repository: fixture.repository,
      comparisonRef: "refs/heads/main", remoteName: "origin", providerRepository: "opaque/project" }, {
      providerKind: "fixture", providerChanges: ({ sourceRefs, limit }) => {
        reads += 1; assert.ok(sourceRefs.includes("refs/heads/unique")); assert.ok(limit > 2);
        const rows = [
          { id: "fixture:z", provider: "fixture", state: "open", draft: true,
            sourceRef: "refs/heads/unique", sourceRevision: fixture.uniqueRevision,
            targetRef: "refs/heads/main", integrationRevision: null, complete: true },
          { id: "fixture:a", provider: "fixture", state: "merged", draft: false,
            sourceRef: "refs/heads/patch", sourceRevision: fixture.patchRevision,
            targetRef: "refs/heads/main", integrationRevision: fixture.mainRevision, complete: true },
        ]; return reads % 2 ? rows : rows.reverse();
      },
    });
    const evidence = normalizeHistoryLifecycleEvidence(adapter.captureEvidence());
    assert.equal(reads, 2); assert.equal(evidence.comparison.remote.revision, fixture.mainRevision);
    assert.deepEqual(evidence.comparison.provider, { kind: "fixture", repository: "opaque/project" });
    assert.deepEqual(evidence.providerChanges.map(item => item.id), ["fixture:a", "fixture:z"]);
    assert.equal(evidence.providerChanges[0].integratedInComparison, true);
    adapter.verifyEvidence(evidence); assert.equal(reads, 3);
    assert.throws(() => captureHistoryLifecycleEvidence({ repository: fixture.repository,
      comparisonRef: "refs/heads/main", providerRepository: "opaque/project" }, {
      providerKind: "fixture", providerChanges: () => [{ id: "fixture:bad", provider: "fixture", state: "open",
        draft: "false", sourceRef: "refs/heads/main", sourceRevision: fixture.mainRevision,
        targetRef: "refs/heads/main", integrationRevision: null }],
    }), /provider change/u);
    const duplicate = { id: "fixture:duplicate", provider: "fixture", state: "open", draft: false,
      sourceRef: "refs/heads/main", sourceRevision: fixture.mainRevision, targetRef: "refs/heads/main",
      integrationRevision: null, complete: true };
    assert.throws(() => captureHistoryLifecycleEvidence({ repository: fixture.repository,
      comparisonRef: "refs/heads/main", providerRepository: "opaque/project" }, {
      providerKind: "fixture", providerChanges: () => [duplicate, { ...duplicate }],
    }), /provider identity drift/u);
  } finally { fixture.cleanup(); }
});

test("default provider boundary performs one fixed bounded inventory read per frontier", () => {
  const fixture = makeRepository(); let providerCalls = 0;
  try {
    const execute = (command, args, settings) => {
      if (command !== "gh") return execFileSync(command, args, settings);
      providerCalls += 1;
      assert.deepEqual(args.slice(0, 6), ["pr", "list", "--repo", "owner/repository", "--state", "all"]);
      assert.equal(args.includes("--head"), false);
      return Buffer.from(JSON.stringify([
        { number: 2, url: "https://provider.invalid/2", state: "OPEN", isDraft: true,
          headRefName: "unique", headRefOid: fixture.uniqueRevision, baseRefName: "main", mergeCommit: null },
        { number: 1, url: "https://provider.invalid/1", state: "OPEN", isDraft: true,
          headRefName: "absent-local", headRefOid: fixture.base, baseRefName: "main", mergeCommit: null },
      ]));
    };
    const adapter = createHistoryLifecycleRepositoryAdapter({ repository: fixture.repository,
      comparisonRef: "refs/heads/main", providerRepository: "owner/repository" }, { execute });
    const evidence = normalizeHistoryLifecycleEvidence(adapter.captureEvidence());
    assert.equal(providerCalls, 2); assert.deepEqual(evidence.providerChanges.map(item => item.id), ["github-pull-request:2"]);
    adapter.verifyEvidence(evidence); assert.equal(providerCalls, 3);
  } finally { fixture.cleanup(); }
});

test("captures SHA-256 object repositories with the same read-only contract", () => {
  const fixture = makeRepository({ objectFormat: "sha256" });
  try {
    const evidence = normalizeHistoryLifecycleEvidence(captureHistoryLifecycleEvidence({
      repository: fixture.repository, comparisonRef: "refs/heads/main",
    }));
    assert.equal(evidence.repository.objectFormat, "sha256");
    assert.equal(evidence.comparison.revision.length, 64);
    assert.ok(evidence.branches.every(item => item.revision.length === 64 && item.tree.length === 64));
  } finally { fixture.cleanup(); }
});

test("uses Git-visible reftable reflogs and remains conservative about the unobservable initial old OID", () => {
  const fixture = makeRepository({ refFormat: "reftable" });
  try {
    const evidence = normalizeHistoryLifecycleEvidence(captureHistoryLifecycleEvidence({
      repository: fixture.repository, comparisonRef: "refs/heads/main",
    }));
    const branch = evidence.branches.find(item => item.ref === "refs/heads/unique");
    assert.ok(branch.reflog.entryCount > 0); assert.equal(branch.reflog.complete, false);
    assert.equal(branch.reflog.reason, "initial-old-unobservable");
    assert.ok(branch.reflog.uniqueRevisions.includes(fixture.uniqueRevision));
  } finally { fixture.cleanup(); }
});

test("fails closed on frontier drift, bounds, metadata symlinks, and non-absence Git errors", () => {
  const fixture = makeRepository();
  try {
    let refReads = 0;
    const drift = (command, args, settings) => {
      const output = execFileSync(command, args, settings);
      if (command === "git" && args[0] === "for-each-ref" && ++refReads === 2) {
        const row = `refs/heads/drift\0${fixture.mainRevision}\0commit\0\0\0\0\n`;
        return Buffer.concat([output, Buffer.from(row)]);
      }
      return output;
    };
    assert.throws(() => captureHistoryLifecycleEvidence({ repository: fixture.repository,
      comparisonRef: "refs/heads/main" }, { execute: drift }), /frontier drifted/u);
    assert.throws(() => captureHistoryLifecycleEvidence({ repository: fixture.repository,
      comparisonRef: "refs/heads/main", bounds: { maxBranches: 1 } }), /branches/u);
    assert.throws(() => captureHistoryLifecycleEvidence({ repository: fixture.repository,
      comparisonRef: "refs/heads/main", bounds: { maxAggregateEntries: 1 } }), /aggregate bound/u);
    const statusFailure = (command, args, settings) => {
      if (command === "git" && args[0] === "merge-base" && args[1] === "--is-ancestor") {
        const error = new Error("injected"); error.status = 128; error.stdout = Buffer.alloc(0); throw error;
      }
      return execFileSync(command, args, settings);
    };
    assert.throws(() => captureHistoryLifecycleEvidence({ repository: fixture.repository,
      comparisonRef: "refs/heads/main" }, { execute: statusFailure }), /failed read-only \(128\)/u);
    const registry = path.join(fixture.repository, ".git", "agentic-canvas-os", "writer-leases.json");
    const target = path.join(fixture.container, "registry.json"); writeFileSync(target, readFileSync(registry));
    rmSync(registry); symlinkSync(target, registry);
    assert.throws(() => captureHistoryLifecycleEvidence({ repository: fixture.repository,
      comparisonRef: "refs/heads/main" }), /metadata file/u);
  } finally { fixture.cleanup(); }
});
