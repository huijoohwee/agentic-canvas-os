import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  CHANGE_MANIFEST_SCHEMA,
  DEVICE_INTEGRATION_RESULT_SCHEMA,
  integrateSession,
  resolveRuntimeRepositories,
} from "../scripts/device-integrate-lib.mjs";
import { CLOUD_COLLABORATION_BOUNDS } from "../scripts/cloud-collaboration-primitives.mjs";

const branch = "agent/device/runtime-integration";
const baseSha = "a".repeat(40);
const fenceSha = "b".repeat(40);
const commitSha = "c".repeat(40);
const treeSha = "d".repeat(40);
const mergeSha = "e".repeat(40);
const mainSha = "f".repeat(40);
const knowgrphSha = "1".repeat(40);
const pullRequestUrl = "https://github.test/example/repo/pull/42";
const protectedSquashSubject = "fix: bind exact protected squash subjects";
const oversizedReviewedMergeSubject =
  "Merge remote-tracking branch 'origin/main' into agent/huis-macbook-pro-3/lark-readonly-knowledge-ingestion";
const oversizedRefreshedMergeSubject =
  "Merge branch 'main' into agent/huis-macbook-pro-3/lark-readonly-knowledge-ingestion";
const deliveryEvidence = Object.freeze({
  dependencyClosureDigest: "1".repeat(64),
  namedChecksDigest: "2".repeat(64),
  handoffEvidenceDigest: "3".repeat(64),
  operatorDecisionDigest: "4".repeat(64),
  integrationIntentDigest: "5".repeat(64),
});
const reviewRequestId = "github-pull-request:PR_42";
const focusedEvidenceDigest = "6".repeat(64);

test("runtime repository identity is independent from the isolated canonical directory name", () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agentic-runtime-identity-"));
  const isolatedCanonicalRoot = path.join(workspace, "isolated-acos-canonical");
  const knowgrphRoot = path.join(workspace, "knowgrph-runtime");
  mkdirSync(isolatedCanonicalRoot, { recursive: true });
  mkdirSync(knowgrphRoot, { recursive: true });
  writeFileSync(
    path.join(isolatedCanonicalRoot, "package.json"),
    JSON.stringify({ name: "agentic-canvas-os" }),
  );
  writeFileSync(path.join(knowgrphRoot, "package.json"), JSON.stringify({ name: "knowgrph" }));

  try {
    assert.deepEqual(resolveRuntimeRepositories({
      canonicalRoot: isolatedCanonicalRoot,
      runtimeRepository: knowgrphRoot,
    }), {
      integratedRepository: "agentic-canvas-os",
      agenticCanvasOsRoot: isolatedCanonicalRoot,
      knowgrphRoot,
    });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("runtime repository identity falls back to origin metadata and rejects unsupported identities", () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agentic-runtime-origin-"));
  const isolatedCanonicalRoot = path.join(workspace, "isolated-knowgrph-canonical");
  const agenticCanvasOsRoot = path.join(workspace, "agentic-canvas-os");
  mkdirSync(isolatedCanonicalRoot, { recursive: true });
  mkdirSync(agenticCanvasOsRoot, { recursive: true });
  writeFileSync(path.join(isolatedCanonicalRoot, "package.json"), JSON.stringify({ private: true }));
  writeFileSync(
    path.join(agenticCanvasOsRoot, "package.json"),
    JSON.stringify({ name: "agentic-canvas-os" }),
  );

  try {
    assert.deepEqual(resolveRuntimeRepositories({
      canonicalRoot: isolatedCanonicalRoot,
      readOriginRemote: () => "git@github.com:huijoohwee/knowgrph.git",
    }), {
      integratedRepository: "knowgrph",
      agenticCanvasOsRoot,
      knowgrphRoot: isolatedCanonicalRoot,
    });
    assert.throws(() => resolveRuntimeRepositories({
      canonicalRoot: isolatedCanonicalRoot,
      readOriginRemote: () => "https://github.com/example/unsupported-runtime.git",
    }), /Unsupported canonical integration repository identity/u);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

function deliveryAuthorizedAuthority(authority, headSha = commitSha, overrides = {}) {
  return {
    ...authority,
    state: "delivery_authorized",
    integrationReceiptDigest: "7".repeat(64),
    integration: {
      candidateRevision: headSha,
      reviewRequestId,
      focusedEvidenceDigest,
      ...deliveryEvidence,
      ...overrides,
    },
  };
}

test("dirty integration validates an exact manifest, commits, publishes, completes, and proves runtime readiness", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-"));
  const manifestPath = path.join(os.tmpdir(), `agentic-manifest-${process.pid}.json`);
  const paths = ["package.json", "scripts/runtime.mjs"];
  const canonicalAgenticRoot = path.join(repo, "canonical", "isolated-acos-canonical");
  const canonicalKnowgrphRoot = path.join(repo, "canonical", "knowgrph");
  mkdirSync(canonicalAgenticRoot, { recursive: true });
  mkdirSync(canonicalKnowgrphRoot, { recursive: true });
  writeFileSync(path.join(canonicalAgenticRoot, "package.json"), JSON.stringify({ name: "agentic-canvas-os" }));
  writeFileSync(path.join(canonicalKnowgrphRoot, "package.json"), JSON.stringify({ name: "knowgrph" }));
  writeFileSync(manifestPath, JSON.stringify({ schema: CHANGE_MANIFEST_SCHEMA, branch, baseSha, paths }));
  let head = fenceSha;
  let lease = createLease({ repo, status: "active" });
  const commands = [];
  const runtimeCommands = [];
  const gitText = args => {
    const key = args.join(" ");
    if (key === "branch --show-current") return `${branch}\n`;
    if (key === "worktree list --porcelain -z") {
      return canonicalWorktree(repo, "isolated-acos-canonical");
    }
    if (key === "diff --name-only -z HEAD --") return `${paths.join("\0")}\0`;
    if (key === "ls-files --others --exclude-standard -z") return "";
    if (key === "diff --name-only -z") return "";
    if (key === "diff --cached --name-only -z") return `${paths.join("\0")}\0`;
    if (key === "diff --cached --binary") return "fixture staged diff";
    if (key === "status --porcelain") return "";
    if (key === "rev-parse HEAD") return head;
    if (key === "rev-parse HEAD^{tree}") return treeSha;
    throw new Error(`unexpected git command: ${key}`);
  };
  const leaseStore = {
    read: requested => requested ? lease : { leases: { [branch]: lease } },
    annotate: ({ values }) => (lease = { ...lease, ...values }),
  };

  try {
    const result = integrateSession({
      invocationPath: repo,
      repo,
      gitText,
      ghText: () => JSON.stringify({
        url: pullRequestUrl,
        state: "MERGED",
        baseRefName: "main",
        headRefOid: commitSha,
        mergeCommit: { oid: mergeSha },
      }),
      leaseStore,
      sessionId: "session-a",
      authorizeCloudDelivery: ({ authority }) => ({
        authority: { ...authority, state: "delivery_authorized" },
      }),
      verifyCloudAuthority: () => ({ ok: true }),
      run: (command, args) => {
        commands.push([command, ...args]);
        if (command === "git" && args[0] === "commit") head = commitSha;
      },
      runText: (command, args, options) => {
        runtimeCommands.push({ command, args, options });
        if (command === "git") return `${mainSha}\n`;
        if (command === "node" && args[0].endsWith("worktree-lifecycle.mjs")) {
          return JSON.stringify({
            schema: "agentic-worktree-lifecycle-report/v1",
            status: "cleaned",
            removedWorktree: repo,
            preservedBranch: branch,
          });
        }
        if (command === "node") return "";
        return JSON.stringify({
          schema: "agentic-local-runtime-readiness/v1",
          ready: true,
          status: "runtime-ready",
          source: { repository: "huijoohwee/knowgrph", revision: knowgrphSha },
          agenticCanvasOs: { repository: "huijoohwee/agentic-canvas-os", revision: mainSha },
        });
      },
      controllerRoot: repo,
      publishTask: () => {
        lease = { ...lease, status: "delivery", deliveryHeadSha: commitSha };
      },
      completeTask: () => {
        lease = { ...lease, status: "completed", completion: { mergeCommitSha: mergeSha, mainSha } };
        return lease.completion;
      },
      commitMessage: "feat: integrate the canonical runtime",
      pathsManifest: manifestPath,
      waitSeconds: 1,
      pollSeconds: 0.1,
      log: () => {},
    });

    assert.equal(result.schema, DEVICE_INTEGRATION_RESULT_SCHEMA);
    assert.equal(result.status, "runtime_ready");
    assert.equal(result.mainSha, mainSha);
    assert.equal(result.commit.commitSha, commitSha);
    assert.deepEqual(result.commit.paths, paths);
    assert.ok(commands.some(call => call.join(" ") ===
      "git add -- :(literal)package.json :(literal)scripts/runtime.mjs"));
    assert.ok(commands.some(call => call.join(" ") ===
      "git commit -m feat: integrate the canonical runtime"));
    assert.ok(commands.some(call => call.join(" ") === "npm run check"));
    assert.ok(commands.some(call => call.join(" ") === "git fetch origin main"));
    assert.ok(commands.some(call => call.join(" ") === "git merge --no-edit origin/main"));
    assert.equal(result.runtime.integratedSource.mainSha, mainSha);
    assert.equal(result.runtime.integratedSource.repository, "agentic-canvas-os");
    assert.equal(result.runtime.readiness.source.revision, knowgrphSha);
    assert.deepEqual(runtimeCommands[0], {
      command: "git",
      args: ["merge-tree", "--write-tree", "HEAD", "origin/main"],
      options: { cwd: repo },
    });
    assert.equal(runtimeCommands[1].command, "node");
    assert.equal(runtimeCommands[1].options.cwd, canonicalAgenticRoot);
    assert.deepEqual(runtimeCommands[2], {
      command: "git",
      args: ["rev-parse", "HEAD"],
      options: { cwd: canonicalAgenticRoot },
    });
    assert.equal(runtimeCommands[3].command, "npm");
    assert.ok(runtimeCommands[3].args.includes(`--repository=${canonicalKnowgrphRoot}`));
    assert.equal(runtimeCommands[3].options.cwd, canonicalAgenticRoot);
    assert.equal(runtimeCommands[4].command, "node");
    assert.ok(runtimeCommands[4].args.includes(`--worktree=${repo}`));
    assert.equal(result.cleanup.status, "cleaned");
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(manifestPath, { force: true });
  }
});

test("integration rejects dirty paths outside the explicit manifest before validation or staging", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-"));
  const manifestPath = path.join(os.tmpdir(), `agentic-manifest-mismatch-${process.pid}.json`);
  writeFileSync(manifestPath, JSON.stringify({
    schema: CHANGE_MANIFEST_SCHEMA,
    branch,
    baseSha,
    paths: ["package.json"],
  }));
  let lease = createLease({ repo, status: "active" });
  const commands = [];
  try {
    assert.throws(() => integrateSession({
      invocationPath: repo,
      repo,
      gitText: args => {
        const key = args.join(" ");
        if (key === "branch --show-current") return branch;
        if (key === "worktree list --porcelain -z") return canonicalWorktree(repo);
        if (key === "diff --name-only -z HEAD --") return "package.json\0scripts/unapproved.mjs\0";
        if (key === "ls-files --others --exclude-standard -z") return "";
        throw new Error(`unexpected git command: ${key}`);
      },
      ghText: () => "",
      leaseStore: {
        read: requested => requested ? lease : { leases: { [branch]: lease } },
        annotate: ({ values }) => (lease = { ...lease, ...values }),
      },
      sessionId: "session-a",
      run: (command, args) => commands.push([command, ...args]),
      runText: () => "",
      publishTask: () => {},
      completeTask: () => {},
      commitMessage: "fix: bounded integration",
      pathsManifest: manifestPath,
      waitSeconds: 1,
      pollSeconds: 0.1,
      log: () => {},
    }), /do not match the approved manifest/);
    assert.deepEqual(commands, [["git", "merge-base", "--is-ancestor", fenceSha, "HEAD"]]);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(manifestPath, { force: true });
  }
});

test("bounded merge waiting preserves delivery state for replay", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-"));
  const lease = createLease({
    repo,
    status: "delivery",
    deliveryHeadSha: commitSha,
    integration: { commitSha },
  });
  let clock = 0;
  let completed = false;
  try {
    assert.throws(() => integrateSession({
      invocationPath: repo,
      repo,
      gitText: args => {
        const key = args.join(" ");
        if (key === "branch --show-current") return branch;
        if (key === "worktree list --porcelain -z") return canonicalWorktree(repo);
        throw new Error(`unexpected git command: ${key}`);
      },
      ghText: () => JSON.stringify({
        url: pullRequestUrl,
        state: "OPEN",
        baseRefName: "main",
        headRefOid: commitSha,
        mergeCommit: null,
      }),
      leaseStore: { read: requested => requested ? lease : { leases: { [branch]: lease } } },
      sessionId: "session-a",
      run: () => {},
      runText: () => "",
      publishTask: () => {},
      completeTask: () => { completed = true; },
      waitSeconds: 1,
      pollSeconds: 0.1,
      now: () => new Date(clock),
      sleep: milliseconds => { clock += milliseconds; },
      log: () => {},
    }), /delivery lease is preserved for replay/);
    assert.equal(completed, false);
    assert.equal(lease.status, "delivery");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("delivery aggregates sequential tree-equivalent refreshes before completion", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-"));
  const canonicalAgenticRoot = path.join(repo, "canonical", "agentic-canvas-os");
  const canonicalKnowgrphRoot = path.join(repo, "canonical", "knowgrph");
  mkdirSync(canonicalAgenticRoot, { recursive: true });
  mkdirSync(canonicalKnowgrphRoot, { recursive: true });
  writeFileSync(path.join(canonicalAgenticRoot, "package.json"), JSON.stringify({ name: "agentic-canvas-os" }));
  writeFileSync(path.join(canonicalKnowgrphRoot, "package.json"), JSON.stringify({ name: "knowgrph" }));
  const firstRefreshedHeadSha = "2".repeat(40);
  const firstRefreshedMainSha = "3".repeat(40);
  const firstRefreshedTreeSha = "4".repeat(40);
  const refreshedHeadSha = "5".repeat(40);
  const refreshedMainSha = "6".repeat(40);
  const refreshedTreeSha = "7".repeat(40);
  let head = commitSha;
  let pullRequestRead = 0;
  let pullHeadFetch = 0;
  let clock = 0;
  let lease = createLease({
    repo,
    status: "delivery",
    deliveryHeadSha: commitSha,
    integration: { commitSha },
  });
  const commands = [];
  try {
    const result = integrateSession({
      invocationPath: repo,
      repo,
      gitText: args => {
        const key = args.join(" ");
        if (key === "branch --show-current") return branch;
        if (key === "worktree list --porcelain -z") return canonicalWorktree(repo);
        if (key === "rev-parse FETCH_HEAD") {
          return pullHeadFetch === 1 ? firstRefreshedHeadSha : refreshedHeadSha;
        }
        if (key === `rev-list --parents -n 1 ${firstRefreshedHeadSha}`) {
          return `${firstRefreshedHeadSha} ${commitSha} ${firstRefreshedMainSha}`;
        }
        if (key === `merge-base --is-ancestor ${firstRefreshedMainSha} origin/main`) return "";
        if (key ===
          `merge-tree --write-tree --no-messages ${commitSha} ${firstRefreshedMainSha}`) {
          return firstRefreshedTreeSha;
        }
        if (key === `rev-parse ${firstRefreshedHeadSha}^{tree}`) {
          return firstRefreshedTreeSha;
        }
        if (key === `rev-list --parents -n 1 ${refreshedHeadSha}`) {
          return `${refreshedHeadSha} ${firstRefreshedHeadSha} ${refreshedMainSha}`;
        }
        if (key === `merge-base --is-ancestor ${refreshedMainSha} origin/main`) return "";
        if (key ===
          `merge-tree --write-tree --no-messages ${firstRefreshedHeadSha} ${refreshedMainSha}`) {
          return refreshedTreeSha;
        }
        if (key === `rev-parse ${refreshedHeadSha}^{tree}`) return refreshedTreeSha;
        if (key === "rev-parse HEAD") return head;
        if (key === "status --porcelain") return "";
        throw new Error(`unexpected git command: ${key}`);
      },
      ghText: () => JSON.stringify(pullRequestRead++ === 0 ? {
        url: pullRequestUrl,
        state: "OPEN",
        baseRefName: "main",
        headRefOid: firstRefreshedHeadSha,
        mergeCommit: null,
      } : {
        url: pullRequestUrl,
        state: "MERGED",
        baseRefName: "main",
        headRefOid: refreshedHeadSha,
        mergeCommit: { oid: mergeSha },
      }),
      leaseStore: {
        read: requested => requested ? lease : { leases: { [branch]: lease } },
      },
      sessionId: "session-a",
      run: (command, args) => {
        commands.push([command, ...args]);
        if (command === "git" && args.join(" ") ===
          "fetch origin refs/pull/42/head") {
          pullHeadFetch += 1;
        }
        if (command === "git" && args.join(" ") === "merge --ff-only FETCH_HEAD") {
          head = head === commitSha ? firstRefreshedHeadSha : refreshedHeadSha;
        }
      },
      runText: (command, args) => {
        if (command === "git" && args[0] === "rev-parse") return `${mainSha}\n`;
        if (command === "node" && args[0].endsWith("worktree-lifecycle.mjs")) {
          return JSON.stringify({
            schema: "agentic-worktree-lifecycle-report/v1",
            status: "cleaned",
            removedWorktree: repo,
          });
        }
        return "";
      },
      publishTask: () => {},
      completeTask: () => {
        lease = { ...lease, status: "completed", completion: { mergeCommitSha: mergeSha, mainSha } };
        return lease.completion;
      },
      runtime: "none",
      controllerRoot: repo,
      waitSeconds: 1,
      pollSeconds: 0.1,
      now: () => new Date(clock),
      sleep: milliseconds => { clock += milliseconds; },
      log: () => {},
    });

    assert.deepEqual(result.protectedMainRefresh, {
      schema: "agentic-protected-main-refresh-chain/v1",
      deliveredHeadSha: commitSha,
      refreshedHeadSha,
      refreshCount: 2,
      refreshes: [
        {
          previousHeadSha: commitSha,
          refreshedHeadSha: firstRefreshedHeadSha,
          mainParentSha: firstRefreshedMainSha,
          treeSha: firstRefreshedTreeSha,
        },
        {
          previousHeadSha: firstRefreshedHeadSha,
          refreshedHeadSha,
          mainParentSha: refreshedMainSha,
          treeSha: refreshedTreeSha,
        },
      ],
    });
    assert.ok(commands.some(call => call.join(" ") === "git fetch origin main"));
    assert.ok(commands.some(call => call.join(" ") === "git fetch origin refs/pull/42/head"));
    assert.equal(commands.filter(call => call.join(" ") ===
      "git merge --ff-only FETCH_HEAD").length, 2);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("delivery rejects authored advancement instead of treating it as a protected-main refresh", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-"));
  const refreshedHeadSha = "2".repeat(40);
  const authoredParentSha = "3".repeat(40);
  const lease = createLease({
    repo,
    status: "delivery",
    deliveryHeadSha: commitSha,
    integration: { commitSha },
  });
  let completed = false;
  try {
    assert.throws(() => integrateSession({
      invocationPath: repo,
      repo,
      gitText: args => {
        const key = args.join(" ");
        if (key === "branch --show-current") return branch;
        if (key === "worktree list --porcelain -z") return canonicalWorktree(repo);
        if (key === "rev-parse FETCH_HEAD") return refreshedHeadSha;
        if (key === `rev-list --parents -n 1 ${refreshedHeadSha}`) {
          return `${refreshedHeadSha} ${authoredParentSha}`;
        }
        throw new Error(`unexpected git command: ${key}`);
      },
      ghText: () => JSON.stringify({
        url: pullRequestUrl,
        state: "OPEN",
        baseRefName: "main",
        headRefOid: refreshedHeadSha,
        mergeCommit: null,
      }),
      leaseStore: { read: requested => requested ? lease : { leases: { [branch]: lease } } },
      sessionId: "session-a",
      run: () => {},
      runText: () => "",
      publishTask: () => {},
      completeTask: () => { completed = true; },
      runtime: "none",
      controllerRoot: repo,
      waitSeconds: 1,
      pollSeconds: 0.1,
      log: () => {},
    }), /advanced beyond an exact protected-main refresh chain/);
    assert.equal(completed, false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("a protected-main merge preserves the approved authored commit evidence", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-"));
  const canonicalAgenticRoot = path.join(repo, "canonical", "agentic-canvas-os");
  const canonicalKnowgrphRoot = path.join(repo, "canonical", "knowgrph");
  mkdirSync(canonicalAgenticRoot, { recursive: true });
  mkdirSync(canonicalKnowgrphRoot, { recursive: true });
  writeFileSync(path.join(canonicalAgenticRoot, "package.json"), JSON.stringify({ name: "agentic-canvas-os" }));
  writeFileSync(path.join(canonicalKnowgrphRoot, "package.json"), JSON.stringify({ name: "knowgrph" }));
  const refreshedHeadSha = "2".repeat(40);
  const integration = {
    schema: "agentic-integration-commit/v1",
    commitSha,
    treeSha,
    manifestDigest: "3".repeat(64),
    stagedDiffDigest: "4".repeat(64),
    paths: ["scripts/device-integrate-lib.mjs"],
  };
  let lease = createLease({ repo, integration });
  const commands = [];
  try {
    const result = integrateSession({
      invocationPath: repo,
      repo,
      gitText: args => {
        const key = args.join(" ");
        if (key === "branch --show-current") return branch;
        if (key === "worktree list --porcelain -z") return canonicalWorktree(repo);
        if (key === "diff --name-only -z HEAD --" || key === "ls-files --others --exclude-standard -z" ||
            key === "status --porcelain") return "";
        if (key === "rev-parse HEAD") return refreshedHeadSha;
        throw new Error(`unexpected git command: ${key}`);
      },
      ghText: () => JSON.stringify({
        url: pullRequestUrl,
        state: "MERGED",
        baseRefName: "main",
        headRefOid: refreshedHeadSha,
        mergeCommit: { oid: mergeSha },
      }),
      leaseStore: {
        read: requested => requested ? lease : { leases: { [branch]: lease } },
      },
      sessionId: "session-a",
      run: (command, args) => commands.push([command, ...args]),
      runText: (command, args) => {
        if (command === "git" && args[0] === "rev-parse") return `${mainSha}\n`;
        if (command === "node" && args[0].endsWith("worktree-lifecycle.mjs")) {
          return JSON.stringify({
            schema: "agentic-worktree-lifecycle-report/v1",
            status: "cleaned",
            removedWorktree: repo,
          });
        }
        return "merge preflight";
      },
      publishTask: () => {
        lease = { ...lease, status: "delivery", deliveryHeadSha: refreshedHeadSha };
      },
      completeTask: () => {
        lease = { ...lease, status: "completed", completion: { mergeCommitSha: mergeSha, mainSha } };
        return lease.completion;
      },
      runtime: "none",
      controllerRoot: repo,
      waitSeconds: 1,
      pollSeconds: 0.1,
      log: () => {},
    });

    assert.deepEqual(result.commit, integration);
    assert.ok(commands.some(call => call.join(" ") ===
      `git merge-base --is-ancestor ${commitSha} HEAD`));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("review-ready delivery reuses the exact reviewed head for authorization and merge completion", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-review-ready-"));
  const canonicalAgenticRoot = path.join(repo, "canonical", "agentic-canvas-os");
  const canonicalKnowgrphRoot = path.join(repo, "canonical", "knowgrph");
  mkdirSync(canonicalAgenticRoot, { recursive: true });
  mkdirSync(canonicalKnowgrphRoot, { recursive: true });
  writeFileSync(path.join(canonicalAgenticRoot, "package.json"), JSON.stringify({ name: "agentic-canvas-os" }));
  writeFileSync(path.join(canonicalKnowgrphRoot, "package.json"), JSON.stringify({ name: "knowgrph" }));
  const lease = createLease({
    repo,
    status: "review_ready",
    autoDelivery: false,
    runtimeRequired: false,
    reviewHeadSha: commitSha,
  });
  const verifiedHeads = [];
  const commands = [];
  let cloudMutation = null;
  let completed = false;
  let commitSubjectRead = false;
  let pullRequestRead = 0;
  try {
    const result = integrateSession({
      invocationPath: repo,
      repo,
      gitText: args => {
        const key = args.join(" ");
        if (key === "branch --show-current") return branch;
        if (key === "worktree list --porcelain -z") return canonicalWorktree(repo);
        if (key === `rev-parse ${commitSha}^{tree}`) return treeSha;
        if (key === `log --first-parent --no-merges -1 --format=%s ${baseSha}..${commitSha}`) {
          return protectedSquashSubject;
        }
        if (key === `log -1 --pretty=%s ${commitSha}`) {
          commitSubjectRead = true;
          return oversizedReviewedMergeSubject;
        }
        throw new Error(`unexpected git command: ${key}`);
      },
      ghText: args => {
        pullRequestRead += 1;
        assert.equal(
          args.join(" "),
          `pr view ${pullRequestUrl} --json state,baseRefName,url,headRefOid,mergeCommit`,
        );
        return JSON.stringify({
          url: pullRequestUrl,
          state: "MERGED",
          baseRefName: "main",
          headRefOid: commitSha,
          mergeCommit: { oid: mergeSha },
        });
      },
      leaseStore: { read: requested => requested ? lease : { leases: { [branch]: lease } } },
      sessionId: "session-a",
      buildDeliveryEvidence: input => {
        assert.deepEqual(input, {
          operation: "integrate",
          branch,
          headSha: commitSha,
          headTreeSha: treeSha,
          pullRequestNumber: 42,
          deviceId: "device-a",
          sessionId: "session-a",
          manifest: lease.admission,
          authority: lease.cloudAuthority,
        });
        return deliveryEvidence;
      },
      authorizeCloudDelivery: ({ authority, headSha, invoke, ...input }) => {
        assert.equal(headSha, commitSha);
        assert.deepEqual(deliveryDigests(input), deliveryEvidence);
        invoke({
          action: "integrate",
          request: { idempotencyKey: "oversized:" + "a".repeat(600) },
        });
        return { authority: deliveryAuthorizedAuthority(authority, headSha) };
      },
      invokeCloudMutation: input => {
        cloudMutation = input;
        return { ok: true };
      },
      verifyCloudAuthority: ({ headSha }) => {
        verifiedHeads.push(headSha);
        assert.equal(headSha, commitSha);
        return { ok: true };
      },
      run: (command, args) => {
        commands.push([command, ...args]);
      },
      runText: (command, args) => {
        if (command === "git" && args[0] === "rev-parse") return `${mainSha}\n`;
        if (command === "node" && args[0].endsWith("worktree-lifecycle.mjs")) {
          return JSON.stringify({
            schema: "agentic-worktree-lifecycle-report/v1",
            status: "cleaned",
            removedWorktree: repo,
          });
        }
        return "";
      },
      publishTask: () => {
        throw new Error("review-ready delivery should not republish authored work");
      },
      completeTask: () => {
        completed = true;
        lease.status = "completed";
        lease.completion = { mergeCommitSha: mergeSha, mainSha };
        return lease.completion;
      },
      runtime: "none",
      controllerRoot: repo,
      waitSeconds: 1,
      pollSeconds: 0.1,
      log: () => {},
    });

    assert.equal(result.status, "integrated");
    assert.equal(completed, true);
    assert.equal(commitSubjectRead, false);
    assert.equal(pullRequestRead, 2);
    assert.match(cloudMutation.request.idempotencyKey, /^device-cloud-mutation:[0-9a-f]{64}$/u);
    assert.ok(
      cloudMutation.request.idempotencyKey.length
        <= CLOUD_COLLABORATION_BOUNDS.textCharacters,
    );
    assert.deepEqual(verifiedHeads, [commitSha, commitSha, commitSha]);
    assert.ok(commands.some(call => call.join(" ") ===
      `gh pr merge --auto --squash --subject ${protectedSquashSubject} ${pullRequestUrl}`));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("review-ready delivery rejects local base drift before subject selection or authorization", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-base-drift-"));
  const lease = createLease({
    repo,
    status: "review_ready",
    autoDelivery: false,
    runtimeRequired: false,
    reviewHeadSha: commitSha,
  });
  lease.cloudAuthority = {
    ...lease.cloudAuthority,
    canonicalBaseSha: "0".repeat(40),
  };
  const commands = [];
  let subjectRead = false;
  let evidenceBuilt = false;
  let authorized = false;
  try {
    assert.throws(() => integrateSession({
      invocationPath: repo,
      repo,
      gitText: args => {
        const key = args.join(" ");
        if (key === "branch --show-current") return branch;
        if (key === "worktree list --porcelain -z") return canonicalWorktree(repo);
        if (key.startsWith("log ")) subjectRead = true;
        throw new Error(`unexpected git command: ${key}`);
      },
      ghText: () => JSON.stringify({
        url: pullRequestUrl,
        state: "OPEN",
        baseRefName: "main",
        headRefOid: commitSha,
        mergeCommit: null,
      }),
      leaseStore: { read: requested => requested ? lease : { leases: { [branch]: lease } } },
      sessionId: "session-a",
      buildDeliveryEvidence: () => {
        evidenceBuilt = true;
        return deliveryEvidence;
      },
      authorizeCloudDelivery: ({ authority, headSha }) => {
        authorized = true;
        return { authority: deliveryAuthorizedAuthority(authority, headSha) };
      },
      verifyCloudAuthority: () => ({ ok: true }),
      run: (command, args) => commands.push([command, ...args]),
      runText: () => "",
      publishTask: () => {},
      completeTask: () => {},
      runtime: "none",
      controllerRoot: repo,
      waitSeconds: 1,
      pollSeconds: 0.1,
      log: () => {},
    }), /Reviewed lease base .* does not match cloud-authoritative base/u);
    assert.equal(subjectRead, false);
    assert.equal(evidenceBuilt, false);
    assert.equal(authorized, false);
    assert.equal(commands.some(call => call.join(" ").includes("gh pr merge")), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("review-ready delivery rejects an invalid reviewed authored subject before authorization", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-invalid-subject-"));
  const lease = createLease({
    repo,
    status: "review_ready",
    autoDelivery: false,
    runtimeRequired: false,
    reviewHeadSha: commitSha,
  });
  const commands = [];
  let evidenceBuilt = false;
  let authorized = false;
  try {
    assert.throws(() => integrateSession({
      invocationPath: repo,
      repo,
      gitText: args => {
        const key = args.join(" ");
        if (key === "branch --show-current") return branch;
        if (key === "worktree list --porcelain -z") return canonicalWorktree(repo);
        if (key === `log --first-parent --no-merges -1 --format=%s ${baseSha}..${commitSha}`) {
          return "x".repeat(73);
        }
        if (key === `log -1 --pretty=%s ${commitSha}`) return protectedSquashSubject;
        throw new Error(`unexpected git command: ${key}`);
      },
      ghText: args => {
        assert.equal(
          args.join(" "),
          `pr view ${pullRequestUrl} --json state,baseRefName,url,headRefOid,mergeCommit`,
        );
        return JSON.stringify({
          url: pullRequestUrl,
          state: "OPEN",
          baseRefName: "main",
          headRefOid: commitSha,
          mergeCommit: null,
        });
      },
      leaseStore: { read: requested => requested ? lease : { leases: { [branch]: lease } } },
      sessionId: "session-a",
      buildDeliveryEvidence: () => {
        evidenceBuilt = true;
        return deliveryEvidence;
      },
      authorizeCloudDelivery: ({ authority, headSha }) => {
        authorized = true;
        return { authority: deliveryAuthorizedAuthority(authority, headSha) };
      },
      verifyCloudAuthority: () => ({ ok: true }),
      run: (command, args) => commands.push([command, ...args]),
      runText: () => "",
      publishTask: () => {},
      completeTask: () => {},
      runtime: "none",
      controllerRoot: repo,
      waitSeconds: 1,
      pollSeconds: 0.1,
      log: () => {},
    }), /Reviewed authored commit subject exceeds 72 characters \(73\)/u);
    assert.equal(evidenceBuilt, false);
    assert.equal(authorized, false);
    assert.equal(commands.some(call => call.join(" ").includes("gh pr merge")), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("review-ready delivery reclaims a dormant preserved review authority before authorization", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-dormant-review-"));
  const canonicalAgenticRoot = path.join(repo, "canonical", "agentic-canvas-os");
  const canonicalKnowgrphRoot = path.join(repo, "canonical", "knowgrph");
  mkdirSync(canonicalAgenticRoot, { recursive: true });
  mkdirSync(canonicalKnowgrphRoot, { recursive: true });
  writeFileSync(path.join(canonicalAgenticRoot, "package.json"), JSON.stringify({ name: "agentic-canvas-os" }));
  writeFileSync(path.join(canonicalKnowgrphRoot, "package.json"), JSON.stringify({ name: "knowgrph" }));
  let lease = createLease({
    repo,
    status: "review_ready",
    autoDelivery: false,
    runtimeRequired: false,
    reviewHeadSha: commitSha,
    cloudAuthority: {
      schema: "agentic-lane-cloud-authority/v1",
      state: "review_ready",
      canonicalBaseSha: baseSha,
      laneRevision: commitSha,
      reviewRequestId,
      focusedEvidenceDigest,
      transitionCounter: 4,
      claimDigest: "8".repeat(64),
      claimLedgerRevision: "9".repeat(64),
      ledgerRevision: baseSha,
      expiresAt: "2026-08-06T06:18:06.000Z",
    },
  });
  const seenTransitionCounters = [];
  const authorizeTransitions = [];
  let reclaimCount = 0;
  let completed = false;
  try {
    const result = integrateSession({
      invocationPath: repo,
      repo,
      gitText: args => {
        const key = args.join(" ");
        if (key === "branch --show-current") return branch;
        if (key === "worktree list --porcelain -z") return canonicalWorktree(repo);
        if (key === `rev-parse ${commitSha}^{tree}`) return treeSha;
        if (key === `log --first-parent --no-merges -1 --format=%s ${baseSha}..${commitSha}`) {
          return protectedSquashSubject;
        }
        throw new Error(`unexpected git command: ${key}`);
      },
      ghText: () => JSON.stringify({
        url: pullRequestUrl,
        state: "MERGED",
        baseRefName: "main",
        headRefOid: commitSha,
        mergeCommit: { oid: mergeSha },
      }),
      leaseStore: {
        read: requested => requested ? lease : { leases: { [branch]: lease } },
      },
      sessionId: "session-a",
      buildDeliveryEvidence: ({ authority }) => {
        seenTransitionCounters.push(authority.transitionCounter);
        return deliveryEvidence;
      },
      authorizeCloudDelivery: ({ authority, headSha }) => {
        authorizeTransitions.push(authority.transitionCounter);
        if (authorizeTransitions.length === 1) {
          throw new Error("Cloud collaboration integrate failed: Cloud reconciliation cannot recover claim state dormant_preserved.");
        }
        return { authority: deliveryAuthorizedAuthority(authority, headSha) };
      },
      continueReviewReadyCloudAuthority: ({ branch: continuedBranch, sessionId }) => {
        reclaimCount += 1;
        assert.equal(continuedBranch, branch);
        assert.equal(sessionId, "session-a");
        lease = {
          ...lease,
          cloudAuthority: {
            ...lease.cloudAuthority,
            transitionCounter: 5,
            claimDigest: "a".repeat(64),
            claimLedgerRevision: "b".repeat(64),
            expiresAt: "2026-08-06T06:48:06.000Z",
          },
        };
        return { outcome: "reclaimed-live" };
      },
      verifyCloudAuthority: () => ({ ok: true }),
      run: () => {},
      runText: (command, args) => {
        if (command === "git" && args[0] === "rev-parse") return `${mainSha}\n`;
        if (command === "node" && args[0].endsWith("worktree-lifecycle.mjs")) {
          return JSON.stringify({
            schema: "agentic-worktree-lifecycle-report/v1",
            status: "cleaned",
            removedWorktree: repo,
          });
        }
        return "";
      },
      publishTask: () => {
        throw new Error("review-ready delivery should not republish authored work");
      },
      completeTask: () => {
        completed = true;
        lease = { ...lease, status: "completed", completion: { mergeCommitSha: mergeSha, mainSha } };
        return lease.completion;
      },
      runtime: "none",
      controllerRoot: repo,
      waitSeconds: 1,
      pollSeconds: 0.1,
      log: () => {},
    });

    assert.equal(result.status, "integrated");
    assert.equal(reclaimCount, 1);
    assert.equal(completed, true);
    assert.deepEqual(authorizeTransitions, [4, 5]);
    assert.deepEqual(seenTransitionCounters, [4, 5]);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("review-ready delivery rejects evidence failure before authorization or protected auto-merge", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-evidence-failure-"));
  const lease = createLease({
    repo,
    status: "review_ready",
    autoDelivery: false,
    runtimeRequired: false,
    reviewHeadSha: commitSha,
  });
  const commands = [];
  let authorized = false;
  let completed = false;
  try {
    assert.throws(() => integrateSession({
      invocationPath: repo,
      repo,
      gitText: args => {
        const key = args.join(" ");
        if (key === "branch --show-current") return branch;
        if (key === "worktree list --porcelain -z") return canonicalWorktree(repo);
        if (key === `rev-parse ${commitSha}^{tree}`) return treeSha;
        if (key === `log --first-parent --no-merges -1 --format=%s ${baseSha}..${commitSha}`) {
          return protectedSquashSubject;
        }
        throw new Error(`unexpected git command: ${key}`);
      },
      ghText: () => JSON.stringify({
        url: pullRequestUrl,
        state: "OPEN",
        baseRefName: "main",
        headRefOid: commitSha,
        mergeCommit: null,
      }),
      leaseStore: { read: requested => requested ? lease : { leases: { [branch]: lease } } },
      sessionId: "session-a",
      buildDeliveryEvidence: () => {
        throw new Error("delivery evidence could not be derived");
      },
      authorizeCloudDelivery: () => {
        authorized = true;
        return { authority: lease.cloudAuthority };
      },
      verifyCloudAuthority: () => ({ ok: true }),
      run: (command, args) => commands.push([command, ...args]),
      runText: () => "",
      publishTask: () => {},
      completeTask: () => { completed = true; },
      runtime: "none",
      controllerRoot: repo,
      waitSeconds: 1,
      pollSeconds: 0.1,
      log: () => {},
    }), /delivery evidence could not be derived/);
    assert.equal(authorized, false);
    assert.equal(completed, false);
    assert.equal(commands.some(call => call.join(" ").includes("gh pr merge")), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("review-ready delivery rejects authorization that changes one derived evidence digest", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-evidence-drift-"));
  const lease = createLease({
    repo,
    status: "review_ready",
    autoDelivery: false,
    runtimeRequired: false,
    reviewHeadSha: commitSha,
  });
  const commands = [];
  let verified = false;
  let completed = false;
  try {
    assert.throws(() => integrateSession({
      invocationPath: repo,
      repo,
      gitText: args => {
        const key = args.join(" ");
        if (key === "branch --show-current") return branch;
        if (key === "worktree list --porcelain -z") return canonicalWorktree(repo);
        if (key === `rev-parse ${commitSha}^{tree}`) return treeSha;
        if (key === `log --first-parent --no-merges -1 --format=%s ${baseSha}..${commitSha}`) {
          return protectedSquashSubject;
        }
        throw new Error(`unexpected git command: ${key}`);
      },
      ghText: () => JSON.stringify({
        url: pullRequestUrl,
        state: "OPEN",
        baseRefName: "main",
        headRefOid: commitSha,
        mergeCommit: null,
      }),
      leaseStore: { read: requested => requested ? lease : { leases: { [branch]: lease } } },
      sessionId: "session-a",
      buildDeliveryEvidence: () => deliveryEvidence,
      authorizeCloudDelivery: ({ authority, headSha }) => ({
        authority: deliveryAuthorizedAuthority(authority, headSha, {
          namedChecksDigest: "f".repeat(64),
        }),
      }),
      verifyCloudAuthority: () => {
        verified = true;
        throw new Error("drifted authorization must not be verified");
      },
      run: (command, args) => commands.push([command, ...args]),
      runText: () => "",
      publishTask: () => {},
      completeTask: () => { completed = true; },
      runtime: "none",
      controllerRoot: repo,
      waitSeconds: 1,
      pollSeconds: 0.1,
      log: () => {},
    }), /does not record the exact derived delivery evidence and receipt/u);
    assert.equal(verified, false);
    assert.equal(completed, false);
    assert.equal(commands.some(call => call.join(" ").includes("gh pr merge")), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("review-ready delivery accepts an exact protected-main refresh while keeping cloud verification pinned to the reviewed head", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-review-ready-refresh-"));
  const canonicalAgenticRoot = path.join(repo, "canonical", "agentic-canvas-os");
  const canonicalKnowgrphRoot = path.join(repo, "canonical", "knowgrph");
  mkdirSync(canonicalAgenticRoot, { recursive: true });
  mkdirSync(canonicalKnowgrphRoot, { recursive: true });
  writeFileSync(path.join(canonicalAgenticRoot, "package.json"), JSON.stringify({ name: "agentic-canvas-os" }));
  writeFileSync(path.join(canonicalKnowgrphRoot, "package.json"), JSON.stringify({ name: "knowgrph" }));
  const refreshedHeadSha = "2".repeat(40);
  const refreshedMainSha = "3".repeat(40);
  const refreshedTreeSha = "4".repeat(40);
  let head = commitSha;
  let pullRequestRead = 0;
  const commitSubjectReads = [];
  const verifiedHeads = [];
  const commands = [];
  const lease = createLease({
    repo,
    status: "review_ready",
    autoDelivery: false,
    runtimeRequired: false,
    reviewHeadSha: commitSha,
  });
  let completed = false;
  try {
    const result = integrateSession({
      invocationPath: repo,
      repo,
      gitText: args => {
        const key = args.join(" ");
        if (key === "branch --show-current") return branch;
        if (key === "worktree list --porcelain -z") return canonicalWorktree(repo);
        if (key === "rev-parse FETCH_HEAD") return refreshedHeadSha;
        if (key === `rev-list --parents -n 1 ${refreshedHeadSha}`) {
          return `${refreshedHeadSha} ${commitSha} ${refreshedMainSha}`;
        }
        if (key === `merge-base --is-ancestor ${refreshedMainSha} origin/main`) return "";
        if (key === `merge-tree --write-tree --no-messages ${commitSha} ${refreshedMainSha}`) {
          return refreshedTreeSha;
        }
        if (key === `rev-parse ${commitSha}^{tree}`) return treeSha;
        if (key === `rev-parse ${refreshedHeadSha}^{tree}`) return refreshedTreeSha;
        if (key === `log --first-parent --no-merges -1 --format=%s ${baseSha}..${commitSha}`) {
          return protectedSquashSubject;
        }
        if (key === `log -1 --pretty=%s ${commitSha}`) {
          commitSubjectReads.push(commitSha);
          return oversizedReviewedMergeSubject;
        }
        if (key === `log -1 --pretty=%s ${refreshedHeadSha}`) {
          commitSubjectReads.push(refreshedHeadSha);
          return oversizedRefreshedMergeSubject;
        }
        if (key === "rev-parse HEAD") return head;
        if (key === "status --porcelain") return "";
        throw new Error(`unexpected git command: ${key}`);
      },
      ghText: args => {
        assert.equal(
          args.join(" "),
          `pr view ${pullRequestUrl} --json state,baseRefName,url,headRefOid,mergeCommit`,
        );
        return JSON.stringify(pullRequestRead++ === 0 ? {
          url: pullRequestUrl,
          state: "OPEN",
          baseRefName: "main",
          headRefOid: refreshedHeadSha,
          mergeCommit: null,
        } : {
          url: pullRequestUrl,
          state: "MERGED",
          baseRefName: "main",
          headRefOid: refreshedHeadSha,
          mergeCommit: { oid: mergeSha },
        });
      },
      leaseStore: { read: requested => requested ? lease : { leases: { [branch]: lease } } },
      sessionId: "session-a",
      buildDeliveryEvidence: () => deliveryEvidence,
      authorizeCloudDelivery: ({ authority, headSha }) => {
        assert.equal(headSha, commitSha);
        return { authority: deliveryAuthorizedAuthority(authority, headSha) };
      },
      verifyCloudAuthority: ({ headSha }) => {
        verifiedHeads.push(headSha);
        assert.equal(headSha, commitSha);
        return { ok: true };
      },
      run: (command, args) => {
        commands.push([command, ...args]);
        if (command === "git" && args.join(" ") === "merge --ff-only FETCH_HEAD") {
          head = refreshedHeadSha;
        }
      },
      runText: (command, args) => {
        if (command === "git" && args[0] === "rev-parse") return `${mainSha}\n`;
        if (command === "node" && args[0].endsWith("worktree-lifecycle.mjs")) {
          return JSON.stringify({
            schema: "agentic-worktree-lifecycle-report/v1",
            status: "cleaned",
            removedWorktree: repo,
          });
        }
        return "";
      },
      publishTask: () => {
        throw new Error("review-ready delivery should not republish authored work");
      },
      completeTask: () => {
        completed = true;
        lease.status = "completed";
        lease.completion = { mergeCommitSha: mergeSha, mainSha };
        return lease.completion;
      },
      runtime: "none",
      controllerRoot: repo,
      waitSeconds: 1,
      pollSeconds: 0.1,
      log: () => {},
    });

    assert.equal(result.status, "integrated");
    assert.equal(completed, true);
    assert.deepEqual(commitSubjectReads, []);
    assert.deepEqual(verifiedHeads, [commitSha, commitSha, commitSha, commitSha]);
    assert.deepEqual(result.protectedMainRefresh, {
      schema: "agentic-protected-main-refresh/v1",
      deliveredHeadSha: commitSha,
      refreshedHeadSha,
      mainParentSha: refreshedMainSha,
    });
    assert.ok(commands.some(call => call.join(" ") ===
      `gh pr merge --auto --squash --subject ${protectedSquashSubject} ${pullRequestUrl}`));
    assert.ok(commands.some(call => call.join(" ") === "git fetch origin refs/pull/42/head"));
    assert.ok(commands.some(call => call.join(" ") === "git merge --ff-only FETCH_HEAD"));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("authorized auto-delivery completes only through canonical runtime readiness", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-auto-"));
  const canonicalAgenticRoot = path.join(repo, "canonical", "agentic-canvas-os");
  const canonicalKnowgrphRoot = path.join(repo, "canonical", "knowgrph");
  mkdirSync(canonicalAgenticRoot, { recursive: true });
  mkdirSync(canonicalKnowgrphRoot, { recursive: true });
  writeFileSync(path.join(canonicalAgenticRoot, "package.json"), JSON.stringify({ name: "agentic-canvas-os" }));
  writeFileSync(path.join(canonicalKnowgrphRoot, "package.json"), JSON.stringify({ name: "knowgrph" }));
  let lease = createLease({
    repo,
    status: "review_ready",
    autoDelivery: true,
    runtimeRequired: true,
    reviewHeadSha: commitSha,
  });
  let publishCalled = false;
  let runtimeProven = false;
  let completedAfterRuntime = false;
  try {
    const result = integrateSession({
      invocationPath: repo,
      repo,
      gitText: args => {
        const key = args.join(" ");
        if (key === "branch --show-current") return branch;
        if (key === "worktree list --porcelain -z") return canonicalWorktree(repo);
        if (key === `rev-parse ${commitSha}^{tree}`) return treeSha;
        if (key === `log --first-parent --no-merges -1 --format=%s ${baseSha}..${commitSha}`) {
          return protectedSquashSubject;
        }
        throw new Error(`unexpected git command: ${key}`);
      },
      ghText: () => JSON.stringify({
        url: pullRequestUrl,
        state: "MERGED",
        baseRefName: "main",
        headRefOid: commitSha,
        mergeCommit: { oid: mergeSha },
      }),
      leaseStore: {
        read: requested => requested ? lease : { leases: { [branch]: lease } },
        complete: values => {
          assert.equal(runtimeProven, true);
          completedAfterRuntime = true;
          lease = { ...lease, status: "completed", completion: {
            mergeCommitSha: values.mergeCommitSha,
            mainSha: values.mainSha,
          } };
          return lease;
        },
      },
      sessionId: "session-a",
      buildDeliveryEvidence: () => deliveryEvidence,
      authorizeCloudDelivery: ({ authority }) => ({
        authority: deliveryAuthorizedAuthority(authority),
      }),
      verifyCloudAuthority: () => ({ ok: true }),
      run: () => {},
      runText: (command, args) => {
        if (command === "git" && args[0] === "rev-parse") return `${mainSha}\n`;
        if (command === "node" && args[0].endsWith("worktree-lifecycle.mjs")) {
          return JSON.stringify({
            schema: "agentic-worktree-lifecycle-report/v1",
            status: "cleaned",
            removedWorktree: repo,
          });
        }
        if (command === "node") return "";
        runtimeProven = true;
        return JSON.stringify({
          schema: "agentic-local-runtime-readiness/v1",
          ready: true,
          status: "runtime-ready",
          source: { repository: "huijoohwee/knowgrph", revision: knowgrphSha },
          agenticCanvasOs: { repository: "huijoohwee/agentic-canvas-os", revision: mainSha },
        });
      },
      publishTask: () => { publishCalled = true; },
      completeTask: () => {
        lease = { ...lease, status: "completing", completion: { mergeCommitSha: mergeSha, mainSha } };
        return lease.completion;
      },
      controllerRoot: repo,
      waitSeconds: 1,
      pollSeconds: 0.1,
      log: () => {},
    });

    assert.equal(result.status, "runtime_ready");
    assert.equal(result.commit, null);
    assert.equal(publishCalled, false);
    assert.equal(completedAfterRuntime, true);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("authorized auto-delivery rejects integration without canonical runtime proof", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-auto-"));
  const lease = createLease({
    repo,
    status: "review_ready",
    autoDelivery: true,
    runtimeRequired: true,
    reviewHeadSha: commitSha,
  });
  try {
    assert.throws(() => integrateSession({
      invocationPath: repo,
      repo,
      gitText: args => {
        const key = args.join(" ");
        if (key === "branch --show-current") return branch;
        if (key === "worktree list --porcelain -z") return canonicalWorktree(repo);
        throw new Error(`unexpected git command: ${key}`);
      },
      ghText: () => "",
      leaseStore: { read: requested => requested ? lease : { leases: { [branch]: lease } } },
      sessionId: "session-a",
      run: () => {},
      runText: () => "",
      publishTask: () => {},
      completeTask: () => {},
      runtime: "none",
      controllerRoot: repo,
      log: () => {},
    }), /requires canonical runtime readiness/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

function createLease({ repo, ...overrides }) {
  const lease = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 1,
    sessionId: "session-a",
    device: "device-a",
    branch,
    worktreePath: repo,
    baseSha,
    fenceSha,
    pullRequestUrl,
    ...overrides,
  };
  if (lease.status === "review_ready") {
    lease.admission = lease.admission || {
      schema: "agentic-lane-admission-lease/v1",
      status: "admitted",
    };
    lease.cloudAuthority = lease.cloudAuthority || {
      schema: "agentic-lane-cloud-authority/v1",
      state: "review_ready",
      canonicalBaseSha: baseSha,
      laneRevision: lease.reviewHeadSha,
      reviewRequestId,
      focusedEvidenceDigest,
    };
  }
  return lease;
}

function deliveryDigests(value) {
  return Object.fromEntries(Object.keys(deliveryEvidence).map(key => [key, value[key]]));
}

function canonicalWorktree(repo, canonicalDirectory = "agentic-canvas-os") {
  return `worktree ${path.join(repo, "canonical", canonicalDirectory)}\0HEAD ${baseSha}\0branch refs/heads/main\0\0` +
    `worktree ${repo}\0HEAD ${fenceSha}\0branch refs/heads/${branch}\0\0`;
}
